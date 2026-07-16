import type { ApplicationQueryEvent, ApplicationQuerySnapshot, ApplicationQueryTransport } from './protocol.js';

export interface HttpApplicationQueryTransportOptions {
  readonly baseUrl?: string;
  readonly credentials?: RequestCredentials;
  readonly headers?: Readonly<Record<string, string>> | (() => Readonly<Record<string, string>> | Promise<Readonly<Record<string, string>>>);
  readonly fetch?: typeof globalThis.fetch;
  readonly maxSnapshotBytes?: number;
  readonly maxEventBytes?: number;
}

// typecast-boundary: bounded snapshot and SSE JSON are validated against the query protocol before callbacks receive them.
export function createHttpApplicationQueryTransport(options: HttpApplicationQueryTransportOptions = {}): ApplicationQueryTransport {
  const request = options.fetch ?? globalThis.fetch;
  const baseUrl = (options.baseUrl ?? '').replace(/\/$/, '');
  const maxSnapshotBytes = options.maxSnapshotBytes ?? 2 * 1024 * 1024;
  const maxEventBytes = options.maxEventBytes ?? 64 * 1024;
  return {
    async snapshot<TInput, TValue>(query: string, input: TInput, requestOptions: { readonly signal?: AbortSignal } = {}): Promise<ApplicationQuerySnapshot<TValue>> {
      const response = await request(`${baseUrl}/queries/${encodeURIComponent(query)}/snapshot`, {
        method: 'POST',
        credentials: options.credentials ?? 'same-origin',
        headers: { 'content-type': 'application/json', accept: 'application/json', ...await resolvedHeaders(options.headers) },
        body: JSON.stringify({ input }),
        ...(requestOptions.signal ? { signal: requestOptions.signal } : {}),
      });
      if (!response.ok) throw await responseError(response, `Snapshot request for ${query} failed`);
      const text = await boundedText(response, maxSnapshotBytes);
      const snapshot = JSON.parse(text) as ApplicationQuerySnapshot<TValue>;
      if (snapshot.kind !== 'snapshot' || snapshot.protocol !== 'applik8s.query/v1alpha1' || snapshot.query !== query || typeof snapshot.cursor !== 'string' || typeof snapshot.inputKey !== 'string' || typeof snapshot.generatedAt !== 'string' || !['atomicSnapshotResume', 'resumableInvalidation', 'resetOnly'].includes(snapshot.capability)) throw new Error(`Snapshot response for ${query} violates the Applik8s query protocol.`);
      return snapshot;
    },
    async subscribe<TInput>(query: string, input: TInput, cursor: string, requestOptions: { readonly signal: AbortSignal; readonly onEvent: (event: ApplicationQueryEvent) => void; readonly onError: (error: Error) => void }): Promise<void> {
      const response = await request(`${baseUrl}/queries/${encodeURIComponent(query)}/subscribe`, {
        method: 'POST',
        credentials: options.credentials ?? 'same-origin',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream', ...await resolvedHeaders(options.headers) },
        body: JSON.stringify({ input, cursor }),
        signal: requestOptions.signal,
      });
      if (!response.ok) throw await responseError(response, `Subscription request for ${query} failed`);
      if (!response.body) throw new Error(`Subscription response for ${query} has no streaming body.`);
      try {
        for await (const data of sseData(response.body, maxEventBytes, requestOptions.signal)) {
          const event = JSON.parse(data) as ApplicationQueryEvent;
          if (event.protocol !== 'applik8s.query/v1alpha1' || event.query !== query || typeof event.id !== 'string' || !['invalidate', 'reset', 'keepalive'].includes(event.kind) || (event.kind !== 'reset' && (typeof event.cursor !== 'string' || !Number.isSafeInteger(event.sequence) || event.sequence < 0))) throw new Error(`Subscription event for ${query} violates the Applik8s query protocol.`);
          requestOptions.onEvent(event);
        }
        if (!requestOptions.signal.aborted) requestOptions.onError(new Error(`Subscription for ${query} ended before cancellation.`));
      } catch (error) {
        if (!requestOptions.signal.aborted) requestOptions.onError(error instanceof Error ? error : new Error(String(error)));
      }
    },
  };
}

async function resolvedHeaders(headers: HttpApplicationQueryTransportOptions['headers']): Promise<Readonly<Record<string, string>>> {
  if (!headers) return {};
  return typeof headers === 'function' ? headers() : headers;
}

async function boundedText(response: Response, maxBytes: number): Promise<string> {
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error(`HTTP response exceeded the ${maxBytes}-byte Applik8s client limit.`);
  return text;
}

async function responseError(response: Response, prefix: string): Promise<Error> {
  const text = await boundedText(response, 16 * 1024).catch(() => 'response body exceeded diagnostic limit');
  return new Error(`${prefix}: HTTP ${response.status}${text ? `: ${text}` : ''}`);
}

async function* sseData(stream: ReadableStream<Uint8Array>, maxEventBytes: number, signal: AbortSignal): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (!signal.aborted) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      if (new TextEncoder().encode(buffer).byteLength > maxEventBytes * 2) throw new Error(`SSE buffer exceeded the bounded ${maxEventBytes * 2}-byte limit.`);
      let boundary = /\r?\n\r?\n/.exec(buffer);
      while (boundary?.index !== undefined) {
        const block = buffer.slice(0, boundary.index).replaceAll('\r', '');
        buffer = buffer.slice(boundary.index + boundary[0].length);
        if (new TextEncoder().encode(block).byteLength > maxEventBytes) throw new Error(`SSE event exceeded the bounded ${maxEventBytes}-byte limit.`);
        const data = block.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
        if (data) yield data;
        boundary = /\r?\n\r?\n/.exec(buffer);
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
