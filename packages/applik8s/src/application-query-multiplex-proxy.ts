import type { ApplicationQueryMultiplexSubscription } from '@applik8s/client';

export interface ApplicationQueryMultiplexProxyTarget {
  /** Stable identity used to coalesce subscriptions that share one upstream. */
  readonly id: string;
  handle(request: Request): Promise<Response>;
}

export interface ApplicationQueryMultiplexProxyOptions {
  resolve(query: string): ApplicationQueryMultiplexProxyTarget | undefined;
  readonly maxRequestBytes?: number;
  readonly maxSubscriptions?: number;
  readonly onUpstreamError?: (error: unknown, targets: readonly string[]) => void;
}

/**
 * Fans one browser SSE connection into the bounded generated query gateways
 * that own its logical subscriptions, then merges their protocol frames.
 */
export async function proxyApplicationQueryMultiplex(
  request: Request,
  options: ApplicationQueryMultiplexProxyOptions,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === '__applik8s' && parts[1] === 'v1') parts.splice(0, 2);
  if (parts.length !== 2 || parts[0] !== 'queries' || parts[1] !== 'multiplex') return undefined;
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });

  const maxRequestBytes = options.maxRequestBytes ?? 1024 * 1024;
  const maxSubscriptions = options.maxSubscriptions ?? 100;
  if (!Number.isSafeInteger(maxSubscriptions) || maxSubscriptions < 1 || maxSubscriptions > 1_000) {
    throw new Error('Application query multiplex proxy maxSubscriptions must be between 1 and 1000.');
  }
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > maxRequestBytes) return json({ error: 'request_too_large' }, 413);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxRequestBytes) return json({ error: 'request_too_large' }, 413);
  let body: unknown;
  try { body = JSON.parse(text); } catch { return json({ error: 'invalid_json' }, 400); }
  const subscriptions = parseMultiplexSubscriptions(body, maxSubscriptions);
  if (!subscriptions) return json({ error: 'invalid_subscriptions' }, 400);

  const groups = new Map<string, { readonly target: ApplicationQueryMultiplexProxyTarget; readonly subscriptions: ApplicationQueryMultiplexSubscription[] }>();
  for (const subscription of subscriptions) {
    const target = options.resolve(subscription.query);
    if (!target) return json({ error: 'not_found' }, 404);
    const existing = groups.get(target.id);
    if (existing) existing.subscriptions.push(subscription);
    else groups.set(target.id, { target, subscriptions: [subscription] });
  }

  const abort = new AbortController();
  const abortFromRequest = () => abort.abort();
  if (request.signal.aborted) abort.abort();
  else request.signal.addEventListener('abort', abortFromRequest, { once: true });
  const upstreamHeaders = new Headers(request.headers);
  // The proxy replaces the request body for each upstream group. Entity-length
  // headers belong to the original aggregate body and must be recomputed by fetch.
  upstreamHeaders.delete('content-length');
  upstreamHeaders.delete('transfer-encoding');
  const targetGroups = [...groups.values()];
  const upstreamRequests = targetGroups.map(({ target, subscriptions: targetSubscriptions }) => Promise.resolve().then(() => {
    const targetRequest = new Request(request.url, {
      method: 'POST',
      headers: upstreamHeaders,
      body: JSON.stringify({ subscriptions: targetSubscriptions }),
      signal: abort.signal,
    });
    return target.handle(targetRequest);
  }));
  const settled = await Promise.allSettled(upstreamRequests);
  const rejected = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (rejected) {
    request.signal.removeEventListener('abort', abortFromRequest);
    abort.abort();
    notifyUpstreamError(options, rejected.reason, targetGroups.map(({ target }) => target.id));
    await Promise.allSettled(settled.flatMap((result) => result.status === 'fulfilled' ? [result.value.body?.cancel()] : []));
    return json({ error: 'upstream_unavailable' }, 502, { 'retry-after': '1' });
  }
  const responses = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
  const failed = responses.find((response) => !response.ok || !response.body);
  if (failed) {
    request.signal.removeEventListener('abort', abortFromRequest);
    abort.abort();
    await Promise.allSettled(responses.map((response) => response.body?.cancel()));
    return json({ error: 'upstream_subscription_failed' }, failed.status >= 400 && failed.status < 500 ? failed.status : 502, copyRetryAfter(failed));
  }

  const readers = responses.map((response) => {
    if (!response.body) throw new Error('Validated multiplex upstream response lost its streaming body.');
    return response.body.getReader();
  });
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const pumps = readers.map(async (reader) => {
        while (!abort.signal.aborted) {
          const next = await reader.read();
          if (next.done) break;
          controller.enqueue(next.value);
        }
      });
      void Promise.all(pumps).then(() => {
        if (closed) return;
        closed = true;
        request.signal.removeEventListener('abort', abortFromRequest);
        controller.close();
      }).catch(async (error: unknown) => {
        if (closed) return;
        closed = true;
        request.signal.removeEventListener('abort', abortFromRequest);
        const cancelled = request.signal.aborted
          || abort.signal.aborted
          || isAbortError(error);
        abort.abort();
        await Promise.allSettled(readers.map((reader) => reader.cancel()));
        if (cancelled) {
          try { controller.close(); } catch { /* The browser may already have cancelled its reader. */ }
          return;
        }
        notifyUpstreamError(options, error, targetGroups.map(({ target }) => target.id));
        controller.error(error);
      });
    },
    async cancel() {
      if (closed) return;
      closed = true;
      request.signal.removeEventListener('abort', abortFromRequest);
      abort.abort();
      await Promise.allSettled(readers.map((reader) => reader.cancel()));
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store, no-transform', connection: 'keep-alive', 'x-content-type-options': 'nosniff' },
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function notifyUpstreamError(options: ApplicationQueryMultiplexProxyOptions, error: unknown, targets: readonly string[]): void {
  try { options.onUpstreamError?.(error, targets); } catch { /* Diagnostics must not change the protocol response. */ }
}

function parseMultiplexSubscriptions(value: unknown, maximum: number): readonly ApplicationQueryMultiplexSubscription[] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = Reflect.get(value, 'subscriptions');
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > maximum) return undefined;
  const ids = new Set<string>();
  const subscriptions: ApplicationQueryMultiplexSubscription[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
    const id = Reflect.get(item, 'id');
    const query = Reflect.get(item, 'query');
    const cursor = Reflect.get(item, 'cursor');
    if (typeof id !== 'string' || id.length < 1 || id.length > 128 || ids.has(id)) return undefined;
    if (typeof query !== 'string' || query.length < 1 || query.length > 512) return undefined;
    if (typeof cursor !== 'string' || cursor.length < 1 || cursor.length > 16 * 1024 || !Reflect.has(item, 'input')) return undefined;
    ids.add(id);
    subscriptions.push({ id, query, cursor, input: Reflect.get(item, 'input') });
  }
  return subscriptions;
}

function copyRetryAfter(response: Response): Readonly<Record<string, string>> {
  const value = response.headers.get('retry-after');
  return value ? { 'retry-after': value } : {};
}

function json(value: unknown, status: number, headers: Readonly<Record<string, string>> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}
