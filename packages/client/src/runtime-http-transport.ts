// typecast-file-boundary: Browser fetch responses are validated as protocol envelopes before conversion to generic operation results.
import type { ApplicationOperationContract, ApplicationOperationRuntime } from './operations.js';
import { boundFetch } from './bound-fetch.js';

export interface HttpApplicationRuntimeTransportOptions {
  readonly baseUrl?: string;
  readonly credentials?: RequestCredentials;
  readonly headers?: Readonly<Record<string, string>> | (() => Readonly<Record<string, string>> | Promise<Readonly<Record<string, string>>>);
  readonly fetch?: typeof globalThis.fetch;
  readonly maxResponseBytes?: number;
}

/** Bounded HTTP transport for immediate, server-authoritative operations such as signed object intents. */
export function createHttpApplicationRuntimeTransport(options: HttpApplicationRuntimeTransportOptions = {}): ApplicationOperationRuntime {
  const request = boundFetch(options.fetch);
  const baseUrl = (options.baseUrl ?? '').replace(/\/$/, '');
  const maxResponseBytes = options.maxResponseBytes ?? 256 * 1024;
  return {
    async execute<TInput, TOutput>(operation: ApplicationOperationContract, input: TInput): Promise<TOutput> {
      if (operation.transport !== 'runtime') throw new Error(`Application runtime transport cannot execute ${operation.transport} operation ${operation.id}.`);
      const response = await request(`${baseUrl}/runtime/${encodeURIComponent(operation.id)}`, {
        method: 'POST',
        credentials: options.credentials ?? 'same-origin',
        headers: { 'content-type': 'application/json', accept: 'application/json', ...await resolvedHeaders(options.headers) },
        body: JSON.stringify({ input }),
      });
      const text = await boundedText(response, response.ok ? maxResponseBytes : Math.min(maxResponseBytes, 16 * 1024));
      if (!response.ok) throw new Error(`Runtime operation ${operation.id} failed: HTTP ${response.status}${text ? `: ${text}` : ''}`);
      const envelope = JSON.parse(text) as unknown;
      if (!envelope || typeof envelope !== 'object'
        || Reflect.get(envelope, 'protocol') !== 'applik8s.runtime/v1alpha1'
        || Reflect.get(envelope, 'operation') !== operation.id
        || !Object.hasOwn(envelope, 'result')) {
        throw new Error(`Runtime operation ${operation.id} returned an invalid Applik8s runtime protocol response.`);
      }
      return Reflect.get(envelope, 'result') as TOutput;
    },
  };
}

async function resolvedHeaders(headers: HttpApplicationRuntimeTransportOptions['headers']): Promise<Readonly<Record<string, string>>> {
  if (!headers) return {};
  return typeof headers === 'function' ? headers() : headers;
}

async function boundedText(response: Response, maxBytes: number): Promise<string> {
  const body = response.body;
  if (!body) return '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) throw new Error(`HTTP response exceeded the ${maxBytes}-byte Applik8s runtime-client limit.`);
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}
