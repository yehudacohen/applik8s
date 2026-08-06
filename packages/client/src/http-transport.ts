import type { ApplicationQueryEvent, ApplicationQueryMultiplexFrame, ApplicationQuerySnapshot, ApplicationQueryTransport } from './protocol.js';
import { boundFetch } from './bound-fetch.js';

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
  const request = boundFetch(options.fetch);
  const baseUrl = (options.baseUrl ?? '').replace(/\/$/, '');
  const maxSnapshotBytes = options.maxSnapshotBytes ?? 2 * 1024 * 1024;
  const maxEventBytes = options.maxEventBytes ?? 64 * 1024;
  const multiplex = createHttpQueryMultiplexer({ options, request, baseUrl, maxEventBytes });
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
    subscribe<TInput>(query: string, input: TInput, cursor: string, requestOptions: { readonly signal: AbortSignal; readonly onEvent: (event: ApplicationQueryEvent) => void; readonly onError: (error: Error) => void }): void {
      multiplex.subscribe(query, input, cursor, requestOptions);
    },
  };
}

interface HttpMultiplexSubscription {
  readonly id: string;
  readonly query: string;
  readonly input: unknown;
  cursor: string;
  readonly signal: AbortSignal;
  readonly onEvent: (event: ApplicationQueryEvent) => void;
  readonly onError: (error: Error) => void;
  readonly abortListener: () => void;
}

function createHttpQueryMultiplexer(input: {
  readonly options: HttpApplicationQueryTransportOptions;
  readonly request: typeof globalThis.fetch;
  readonly baseUrl: string;
  readonly maxEventBytes: number;
}): {
  subscribe<TInput>(query: string, queryInput: TInput, cursor: string, options: { readonly signal: AbortSignal; readonly onEvent: (event: ApplicationQueryEvent) => void; readonly onError: (error: Error) => void }): void;
} {
  const subscriptions = new Map<string, HttpMultiplexSubscription>();
  let nextId = 0;
  let active: {
    readonly controller: AbortController;
    readonly completed: Promise<void>;
  } | undefined;
  let restartQueued = false;
  let restartRevision = 0;
  let reconciledRevision = 0;
  let reconciling: Promise<void> | undefined;

  return {
    subscribe(query, queryInput, cursor, options) {
      if (options.signal.aborted) return;
      const id = `subscription-${++nextId}`;
      const abortListener = () => {
        const current = subscriptions.get(id);
        if (!current) return;
        subscriptions.delete(id);
        current.signal.removeEventListener('abort', current.abortListener);
        scheduleRestart();
      };
      subscriptions.set(id, { id, query, input: queryInput, cursor, signal: options.signal, onEvent: options.onEvent, onError: options.onError, abortListener });
      options.signal.addEventListener('abort', abortListener, { once: true });
      scheduleRestart();
    },
  };

  function scheduleRestart(): void {
    restartRevision += 1;
    queueReconcile();
  }

  function queueReconcile(): void {
    if (restartQueued) return;
    restartQueued = true;
    queueMicrotask(() => {
      restartQueued = false;
      if (!reconciling) {
        reconciling = reconcile().finally(() => {
          reconciling = undefined;
          if (restartRevision !== reconciledRevision) queueReconcile();
        });
      }
    });
  }

  async function reconcile(): Promise<void> {
    while (reconciledRevision !== restartRevision) {
      const revision = restartRevision;
      const previous = active;
      if (previous) {
        previous.controller.abort();
        await previous.completed;
      }
      if (revision !== restartRevision) continue;
      reconciledRevision = revision;
      if (subscriptions.size === 0) {
        active = undefined;
        continue;
      }
      const controller = new AbortController();
      const included = [...subscriptions.values()];
      const completed = run(controller, included);
      active = { controller, completed };
    }
  }

  async function run(controller: AbortController, included: readonly HttpMultiplexSubscription[]): Promise<void> {
    try {
      const response = await input.request(`${input.baseUrl}/queries/multiplex`, {
        method: 'POST',
        credentials: input.options.credentials ?? 'same-origin',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream', ...await resolvedHeaders(input.options.headers) },
        body: JSON.stringify({ subscriptions: included.map((subscription) => ({ id: subscription.id, query: subscription.query, input: subscription.input, cursor: subscription.cursor })) }),
        signal: controller.signal,
      });
      if (!response.ok) throw await responseError(response, 'Multiplexed query subscription request failed');
      if (!response.body) throw new Error('Multiplexed query subscription response has no streaming body.');
      for await (const data of sseData(response.body, input.maxEventBytes, controller.signal)) {
        const frame: unknown = JSON.parse(data);
        if (!validMultiplexFrame(frame)) throw new Error('Multiplexed query subscription frame violates the Applik8s protocol.');
        const subscription = subscriptions.get(frame.subscriptionId);
        if (!subscription || !included.includes(subscription)) continue;
        if (frame.kind === 'error') {
          fail(subscription, new Error(`Subscription for ${subscription.query} failed: ${frame.error}${frame.retryAfterSeconds ? `; retry after ${frame.retryAfterSeconds}s` : ''}.`));
          continue;
        }
        if (!validQueryEvent(frame.event, subscription.query)) {
          fail(subscription, new Error(`Subscription event for ${subscription.query} violates the Applik8s query protocol.`));
          continue;
        }
        if (frame.event.kind !== 'reset') subscription.cursor = frame.event.cursor;
        subscription.onEvent(frame.event);
      }
      if (!controller.signal.aborted && active?.controller === controller) failIncluded(included, new Error('Multiplexed query subscription ended before cancellation.'));
    } catch (error) {
      if (!controller.signal.aborted && active?.controller === controller) failIncluded(included, error instanceof Error ? error : new Error(String(error)));
    } finally {
      if (active?.controller === controller) active = undefined;
    }
  }

  function failIncluded(included: readonly HttpMultiplexSubscription[], error: Error): void {
    for (const subscription of included) {
      if (subscriptions.get(subscription.id) === subscription) fail(subscription, error);
    }
  }

  function fail(subscription: HttpMultiplexSubscription, error: Error): void {
    if (subscriptions.get(subscription.id) !== subscription) return;
    subscriptions.delete(subscription.id);
    subscription.signal.removeEventListener('abort', subscription.abortListener);
    subscription.onError(error);
  }
}

function validMultiplexFrame(value: unknown): value is ApplicationQueryMultiplexFrame {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (Reflect.get(value, 'protocol') !== 'applik8s.query-multiplex/v1alpha1') return false;
  if (typeof Reflect.get(value, 'subscriptionId') !== 'string') return false;
  const kind = Reflect.get(value, 'kind');
  if (kind === 'event') return Boolean(Reflect.get(value, 'event'));
  if (kind !== 'error') return false;
  return ['forbidden', 'subscription_limit', 'projection_unavailable', 'invalid_request', 'not_found', 'internal_error'].includes(String(Reflect.get(value, 'error')))
    && (Reflect.get(value, 'retryAfterSeconds') === undefined || (Number.isSafeInteger(Reflect.get(value, 'retryAfterSeconds')) && Number(Reflect.get(value, 'retryAfterSeconds')) > 0));
}

function validQueryEvent(event: ApplicationQueryEvent, query: string): boolean {
  return event?.protocol === 'applik8s.query/v1alpha1'
    && event.query === query
    && typeof event.id === 'string'
    && ['invalidate', 'reset', 'keepalive'].includes(event.kind)
    && (event.kind === 'reset' || (typeof event.cursor === 'string' && Number.isSafeInteger(event.sequence) && event.sequence >= 0));
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
  let cancellation: Promise<void> | undefined;
  const abort = () => {
    cancellation ??= reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', abort, { once: true });
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
    signal.removeEventListener('abort', abort);
    cancellation ??= reader.cancel().catch(() => undefined);
    await cancellation;
  }
}
