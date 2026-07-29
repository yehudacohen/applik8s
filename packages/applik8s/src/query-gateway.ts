import { createHmac, timingSafeEqual } from 'node:crypto';
import { queryInputKey, type ApplicationQueryEvent, type ApplicationQueryMultiplexErrorFrame, type ApplicationQueryMultiplexFrame, type ApplicationQueryMultiplexSubscription, type ApplicationQuerySnapshot } from '@applik8s/client';
import { validateApplicationAuthorizationReceipt, type ApplicationAuthorizationReceipt } from '@applik8s/core';
import type { ApplicationQueryBinding, ApplicationQueryPrincipal } from './application-queries.js';
import { validateQueryInput, validateQueryOutput } from './application-query-runtime.js';
import { applicationOperationInputDigest } from './application-operation-runtime.js';
import { applicationAdmittedContextDigest, type ApplicationAdmittedContext, type ApplicationRelationalContext } from './relational-runtime.js';
import { validateTrustedContextValue } from './trusted-context.js';

export interface ApplicationGatewayIdentity<TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal> {
  readonly principal: TPrincipal;
  readonly admittedContext: ApplicationAdmittedContext;
  /** Changes whenever permissions or membership relevant to public queries change. */
  readonly authorizationVersion: string;
}

export interface ApplicationQueryGatewayOptions<TRequest, TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal> {
  readonly queries: readonly ApplicationQueryBinding<unknown, unknown, TPrincipal>[];
  readonly authenticate: (request: TRequest, query: ApplicationQueryBinding<unknown, unknown, TPrincipal>, input: unknown) => ApplicationGatewayIdentity<TPrincipal> | Promise<ApplicationGatewayIdentity<TPrincipal>>;
  readonly context: (identity: ApplicationGatewayIdentity<TPrincipal>) => ApplicationRelationalContext;
  readonly cursorSecret: string;
  readonly cursorTtlSeconds?: number;
  readonly pollIntervalMs?: number;
  readonly heartbeatMs?: number;
  readonly maxSessionMs?: number;
  readonly changePageSize?: number;
  readonly now?: () => Date;
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly subscriptionLimits?: { readonly perPrincipal?: number; readonly total?: number };
  readonly subscriptionLimiter?: ApplicationSubscriptionLimiter;
  readonly audit?: (record: ApplicationQueryGatewayAuditRecord) => void;
  /**
   * Canonical operation-authority boundary. Generated production gateways
   * provide this in addition to the query's domain predicate; the returned
   * receipt is pinned into every cursor and revalidated on resume.
   */
  readonly authorizeOperation?: (request: {
    readonly boundary: 'admission' | 'subscription-resume';
    readonly query: ApplicationQueryBinding<unknown, unknown, TPrincipal>;
    readonly input: unknown;
    readonly identity: ApplicationGatewayIdentity<TPrincipal>;
    readonly inputDigest: string;
    readonly trustedContextDigest: string;
  }) => ApplicationAuthorizationReceipt | false | Promise<ApplicationAuthorizationReceipt | false>;
}

export interface ApplicationSubscriptionLimiter {
  acquire(principal: string): boolean;
  release(principal: string): void;
}

export function createApplicationSubscriptionLimiter(limits: { readonly perPrincipal: number; readonly total: number }): ApplicationSubscriptionLimiter {
  if (!Number.isSafeInteger(limits.perPrincipal) || !Number.isSafeInteger(limits.total) || limits.perPrincipal < 1 || limits.total < limits.perPrincipal) throw new Error('Application gateway subscription limits are invalid.');
  const activeByPrincipal = new Map<string, number>();
  let activeTotal = 0;
  return {
    acquire(principal) {
      const active = activeByPrincipal.get(principal) ?? 0;
      if (activeTotal >= limits.total || active >= limits.perPrincipal) return false;
      activeTotal += 1;
      activeByPrincipal.set(principal, active + 1);
      return true;
    },
    release(principal) {
      const active = activeByPrincipal.get(principal) ?? 0;
      if (active < 1 || activeTotal < 1) throw new Error('Application subscription limiter release was not paired with an acquisition.');
      activeTotal -= 1;
      if (active === 1) activeByPrincipal.delete(principal);
      else activeByPrincipal.set(principal, active - 1);
    },
  };
}

export interface ApplicationQueryGatewayAuditRecord {
  readonly event: 'snapshot' | 'subscription-admitted' | 'subscription-denied' | 'subscription-reset' | 'subscription-closed' | 'authorization-denied';
  readonly query: string;
  readonly principal?: string;
  readonly reason?: string;
}

export interface ApplicationQueryGateway<TRequest> {
  snapshot<TValue = unknown>(request: TRequest, query: string, input: unknown): Promise<ApplicationQuerySnapshot<TValue>>;
  subscribe(request: TRequest, query: string, input: unknown, cursor: string, options?: { readonly signal?: AbortSignal }): AsyncIterable<ApplicationQueryEvent>;
}

export interface ApplicationQueryGatewayHttpOptions {
  readonly basePath?: string;
  readonly maxRequestBytes?: number;
  /** Maximum logical subscriptions admitted through one physical SSE response. */
  readonly maxMultiplexSubscriptions?: number;
}

interface CursorPayload {
  readonly version: 2 | 3;
  readonly query: string;
  readonly inputKey: string;
  readonly contextBinding: string;
  readonly authorizationBinding: string;
  readonly applicationBinding?: string;
  readonly principalBinding?: string;
  readonly operationId?: string;
  readonly operationVersion?: string;
  readonly catalogRevision?: string;
  readonly authorityRevision?: string;
  readonly receiptId?: string;
  readonly sequence: number;
  /** Provider checkpoint/generation bound into the HMAC for non-relational snapshot authorities. */
  readonly providerRevision?: string;
  readonly expiresAt: number;
}

// typecast-boundary: authenticated query data is schema-validated before crossing generic snapshot and client protocol boundaries.
export function createApplicationQueryGateway<TRequest, TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal>(options: ApplicationQueryGatewayOptions<TRequest, TPrincipal>): ApplicationQueryGateway<TRequest> {
  if (options.cursorSecret.length < 32) throw new Error('Application query gateway cursorSecret must contain at least 32 characters.');
  const queries = new Map(options.queries.map((query) => [query.id, query]));
  if (queries.size !== options.queries.length) throw new Error('Application query gateway query registrations must have unique versioned IDs.');
  const now = options.now ?? (() => new Date());
  const cursorTtlSeconds = options.cursorTtlSeconds ?? 15 * 60;
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  const heartbeatMs = options.heartbeatMs ?? 15_000;
  const maxSessionMs = options.maxSessionMs ?? 5 * 60_000;
  const changePageSize = options.changePageSize ?? 100;
  const sleep = options.sleep ?? abortableSleep;
  const limits = { perPrincipal: options.subscriptionLimits?.perPrincipal ?? 20, total: options.subscriptionLimits?.total ?? 1_000 };
  if (!Number.isSafeInteger(limits.perPrincipal) || !Number.isSafeInteger(limits.total) || limits.perPrincipal < 1 || limits.total < limits.perPrincipal) throw new Error('Application query gateway subscription limits are invalid.');
  const limiter = options.subscriptionLimiter ?? createApplicationSubscriptionLimiter(limits);
  if (cursorTtlSeconds < 30 || pollIntervalMs < 10 || heartbeatMs < pollIntervalMs || maxSessionMs < heartbeatMs || changePageSize < 1 || changePageSize > 1_000) throw new Error('Application query gateway polling, heartbeat, cursor, session, or page bounds are invalid.');

  return {
    async snapshot<TValue>(request: TRequest, queryId: string, rawInput: unknown): Promise<ApplicationQuerySnapshot<TValue>> {
      const query = requiredQuery(queries, queryId);
      const input = validateQueryInput(query, rawInput);
      const identity = await admittedIdentity(options, request, query, input);
      if (!await query.authorize(identity.principal, input, identity.admittedContext.values)) {
        options.audit?.({ event: 'authorization-denied', query: query.id, principal: identity.principal.id });
        throw new ApplicationQueryAuthorizationError(query.id);
      }
      const receipt = await authorizeQueryOperation(options, 'admission', query, input, identity);
      if (!query.database) throw new Error(`Application query ${query.id} has no snapshot authority. Bind its first implementation to a registered database or declare reset-only provider behavior.`);
      const context = options.context(identity);
      const result = await withTimeout(context.snapshot(query.database, async () => {
        if (!query.sourceRuntime) return query.run(context, identity.principal, input);
        return query.sourceRuntime.snapshot(async (source) => query.run(context, identity.principal, input, source));
      }), query.budgets.timeoutMs, `Application query ${query.id} exceeded its ${query.budgets.timeoutMs}ms execution budget.`);
      const providerSnapshot = query.sourceRuntime
        ? result.value as { readonly value: unknown; readonly revision: string }
        : undefined;
      const resultValue = providerSnapshot?.value ?? result.value;
      const output = validateQueryOutput(query, resultValue);
      enforceResultBudget(query, output);
      const inputKey = queryInputKey(input);
      const cursor = encodeCursor(options.cursorSecret, {
        version: receipt ? 3 : 2,
        query: query.id,
        inputKey,
        contextBinding: cursorBinding(options.cursorSecret, 'context', applicationAdmittedContextDigest(identity.admittedContext)),
        authorizationBinding: cursorBinding(options.cursorSecret, 'authorization', identity.authorizationVersion),
        ...(receipt ? receiptCursorFields(options.cursorSecret, receipt) : {}),
        sequence: result.sequence,
        ...(providerSnapshot ? { providerRevision: providerSnapshot.revision } : {}),
        expiresAt: now().getTime() + cursorTtlSeconds * 1_000,
      });
      const snapshot = {
        kind: 'snapshot',
        protocol: 'applik8s.query/v1alpha1',
        query: query.id,
        inputKey,
        value: output as TValue,
        cursor,
        capability: 'resumableInvalidation',
        generatedAt: now().toISOString(),
      } as ApplicationQuerySnapshot<TValue>;
      options.audit?.({ event: 'snapshot', query: query.id, principal: identity.principal.id });
      return snapshot;
    },
    async *subscribe(request: TRequest, queryId: string, rawInput: unknown, encoded: string, subscribeOptions: { readonly signal?: AbortSignal } = {}): AsyncIterable<ApplicationQueryEvent> {
      const query = requiredQuery(queries, queryId);
      const input = validateQueryInput(query, rawInput);
      const identity = await admittedIdentity(options, request, query, input);
      if (!await query.authorize(identity.principal, input, identity.admittedContext.values)) {
        options.audit?.({ event: 'authorization-denied', query: query.id, principal: identity.principal.id });
        throw new ApplicationQueryAuthorizationError(query.id);
      }
      const receipt = await authorizeQueryOperation(options, 'subscription-resume', query, input, identity);
      if (!limiter.acquire(identity.principal.id)) {
        options.audit?.({ event: 'subscription-denied', query: query.id, principal: identity.principal.id, reason: 'limit' });
        throw new ApplicationQuerySubscriptionLimitError(query.id);
      }
      options.audit?.({ event: 'subscription-admitted', query: query.id, principal: identity.principal.id });
      try {
      if (!query.database) {
        yield resetEvent(query.id, 'providerReset', now());
        return;
      }
      let cursor: CursorPayload;
      try {
        cursor = decodeCursor(options.cursorSecret, encoded, {
          query: query.id,
          inputKey: queryInputKey(input),
          contextDigest: applicationAdmittedContextDigest(identity.admittedContext),
          authorizationVersion: identity.authorizationVersion,
          ...(receipt ? { receipt } : {}),
          now: now().getTime(),
        });
      } catch (error) {
        yield resetEvent(query.id, error instanceof CursorValidationError ? error.reason : 'cursorInvalid', now());
        return;
      }
      const context = options.context(identity);
      const relevantModels = queryModelNames(query);
      const started = now().getTime();
      let lastHeartbeat = started;
      while (!subscribeOptions.signal?.aborted && now().getTime() - started < maxSessionMs) {
        const currentIdentity = await admittedIdentity(options, request, query, input);
        const currentReceipt = await authorizeQueryOperation(options, 'subscription-resume', query, input, currentIdentity);
        if (currentIdentity.authorizationVersion !== identity.authorizationVersion
          || applicationAdmittedContextDigest(currentIdentity.admittedContext) !== applicationAdmittedContextDigest(identity.admittedContext)
          || !sameReceiptRevision(receipt, currentReceipt)
          || !await query.authorize(currentIdentity.principal, input, currentIdentity.admittedContext.values)) {
          options.audit?.({ event: 'subscription-reset', query: query.id, principal: identity.principal.id, reason: 'authorizationChanged' });
          yield resetEvent(query.id, 'authorizationChanged', now());
          return;
        }
        const [page, providerRevision] = await Promise.all([
          context.changes(query.database, cursor.sequence, changePageSize),
          query.sourceRuntime?.revision(),
        ]);
        if (cursor.sequence > 0 && page.retentionFloor > cursor.sequence + 1) {
          yield resetEvent(query.id, 'retentionGap', now());
          return;
        }
        const providerChanged = providerRevision !== undefined && providerRevision !== cursor.providerRevision;
        if (page.items.length > 0 || providerChanged) {
          const sequence = page.items[page.items.length - 1]?.sequence ?? cursor.sequence;
          cursor = {
            ...cursor,
            sequence,
            ...(providerRevision === undefined ? {} : { providerRevision }),
            expiresAt: now().getTime() + cursorTtlSeconds * 1_000,
          };
          const nextCursor = encodeCursor(options.cursorSecret, cursor);
          const relevant = page.items.filter((change) => relevantModels.has(change.model));
          if (relevant.some((change) => change.operation === 'reset')) {
            yield resetEvent(query.id, 'providerReset', now());
            return;
          }
          if (relevant.length > 0 || providerChanged) {
            const changedModels = providerChanged
              ? [...new Set([...relevantModels, ...relevant.map((change) => change.model)])].sort()
              : [...new Set(relevant.map((change) => change.model))].sort();
            yield { kind: 'invalidate', protocol: 'applik8s.query/v1alpha1', id: providerRevision ? `${query.id}:${sequence}:${providerRevision}` : `${query.id}:${sequence}`, sequence, query: query.id, cursor: nextCursor, models: changedModels };
          } else {
            yield { kind: 'keepalive', protocol: 'applik8s.query/v1alpha1', id: `${query.id}:advance:${sequence}`, sequence, query: query.id, cursor: nextCursor };
          }
          lastHeartbeat = now().getTime();
          if (page.items.length === changePageSize) continue;
        } else if (now().getTime() - lastHeartbeat >= heartbeatMs) {
          cursor = { ...cursor, expiresAt: now().getTime() + cursorTtlSeconds * 1_000 };
          yield { kind: 'keepalive', protocol: 'applik8s.query/v1alpha1', id: `${query.id}:heartbeat:${now().getTime()}`, sequence: cursor.sequence, query: query.id, cursor: encodeCursor(options.cursorSecret, cursor) };
          lastHeartbeat = now().getTime();
        }
        await sleep(pollIntervalMs, subscribeOptions.signal);
      }
      } finally {
        limiter.release(identity.principal.id);
        options.audit?.({ event: 'subscription-closed', query: query.id, principal: identity.principal.id });
      }
    },
  };
}

export class ApplicationQueryAuthorizationError extends Error {
  readonly code = 'APPLIK8S_QUERY_FORBIDDEN';
  constructor(readonly query: string) {
    super(`Application query ${query} is not authorized for the established principal and input.`);
    this.name = 'ApplicationQueryAuthorizationError';
  }
}

export class ApplicationQuerySubscriptionLimitError extends Error {
  readonly code = 'APPLIK8S_QUERY_SUBSCRIPTION_LIMIT';
  constructor(readonly query: string) {
    super(`Application query ${query} subscription limit was reached.`);
    this.name = 'ApplicationQuerySubscriptionLimitError';
  }
}

// typecast-boundary: bounded parsed request bodies remain unknown until the query binding validates them.
export function createApplicationQueryGatewayHttpHandler(gateway: ApplicationQueryGateway<Request>, options: ApplicationQueryGatewayHttpOptions = {}): (request: Request) => Promise<Response> {
  const basePath = `/${(options.basePath ?? 'queries').replace(/^\/+|\/+$/g, '')}/`;
  const maxRequestBytes = options.maxRequestBytes ?? 1024 * 1024;
  const maxMultiplexSubscriptions = options.maxMultiplexSubscriptions ?? 100;
  if (!Number.isSafeInteger(maxMultiplexSubscriptions) || maxMultiplexSubscriptions < 1 || maxMultiplexSubscriptions > 1_000) {
    throw new Error('Application query gateway maxMultiplexSubscriptions must be between 1 and 1000.');
  }
  return async (request) => {
    try {
      if (request.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
      const url = new URL(request.url);
      if (!url.pathname.startsWith(basePath)) return jsonResponse({ error: 'not_found' }, 404);
      const tail = url.pathname.slice(basePath.length).split('/').filter(Boolean);
      const multiplex = tail.length === 1 && tail[0] === 'multiplex';
      const query = tail[0] ? decodeURIComponent(tail[0]) : undefined;
      const operation = tail[1];
      if (!multiplex && (!query || (operation !== 'snapshot' && operation !== 'subscribe') || tail.length !== 2)) return jsonResponse({ error: 'not_found' }, 404);
      const contentLength = Number(request.headers.get('content-length') ?? 0);
      if (contentLength > maxRequestBytes) return jsonResponse({ error: 'request_too_large' }, 413);
      const bodyText = await request.text();
      if (new TextEncoder().encode(bodyText).byteLength > maxRequestBytes) return jsonResponse({ error: 'request_too_large' }, 413);
      let body: unknown;
      try { body = JSON.parse(bodyText) as unknown; } catch { return jsonResponse({ error: 'invalid_json' }, 400); }
      if (multiplex) {
        const subscriptions = validateMultiplexSubscriptions(body, maxMultiplexSubscriptions);
        if (!subscriptions) return jsonResponse({ error: 'invalid_subscriptions' }, 400);
        return multiplexQueryResponse(gateway, request, subscriptions);
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonResponse({ error: 'invalid_request' }, 400);
      if (!query) return jsonResponse({ error: 'not_found' }, 404);
      if (!('input' in body)) return jsonResponse({ error: 'missing_input' }, 400);
      if (operation === 'snapshot') return jsonResponse(await gateway.snapshot(request, query, body.input), 200);
      const cursor = Reflect.get(body, 'cursor');
      if (typeof cursor !== 'string') return jsonResponse({ error: 'missing_cursor' }, 400);
      const iterator = gateway.subscribe(request, query, body.input, cursor, { signal: request.signal })[Symbol.asyncIterator]();
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            while (true) {
              const next = await iterator.next();
              if (next.done) break;
              controller.enqueue(encoder.encode(`event: ${next.value.kind}\ndata: ${JSON.stringify(next.value)}\n\n`));
            }
            controller.close();
          } catch (error) {
            controller.error(error);
          }
        },
        async cancel() {
          await iterator.return?.();
        },
      });
      return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store, no-transform', connection: 'keep-alive', 'x-content-type-options': 'nosniff' } });
    } catch (error) {
      if (error instanceof ApplicationQueryAuthorizationError) return jsonResponse({ error: 'forbidden' }, 403);
      if (error instanceof ApplicationQuerySubscriptionLimitError) return jsonResponse({ error: 'subscription_limit' }, 429, { 'retry-after': '5' });
      if (isProjectionUnavailableError(error)) {
        return jsonResponse({ error: 'projection_unavailable' }, 503, { 'retry-after': '5' });
      }
      const message = error instanceof Error ? error.message : String(error);
      if (/Unknown application query/.test(message)) return jsonResponse({ error: 'not_found' }, 404);
      if (/validation failed|requires trusted context|identity provider returned/.test(message)) return jsonResponse({ error: 'invalid_request' }, 400);
      return jsonResponse({ error: 'internal_error' }, 500);
    }
  };
}

function validateMultiplexSubscriptions(value: unknown, maximum: number): readonly ApplicationQueryMultiplexSubscription[] | undefined {
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
    if (typeof cursor !== 'string' || cursor.length < 1 || cursor.length > 16 * 1024) return undefined;
    if (!Reflect.has(item, 'input')) return undefined;
    ids.add(id);
    subscriptions.push({ id, query, cursor, input: Reflect.get(item, 'input') });
  }
  return subscriptions;
}

function multiplexQueryResponse(
  gateway: ApplicationQueryGateway<Request>,
  request: Request,
  subscriptions: readonly ApplicationQueryMultiplexSubscription[],
): Response {
  const abort = new AbortController();
  const abortFromRequest = () => abort.abort();
  request.signal.addEventListener('abort', abortFromRequest, { once: true });
  const iterators = subscriptions.map((subscription) => ({
    subscription,
    iterator: gateway.subscribe(request, subscription.query, subscription.input, subscription.cursor, { signal: abort.signal })[Symbol.asyncIterator](),
  }));
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enqueue = (frame: ApplicationQueryMultiplexFrame) => {
        if (!closed && !abort.signal.aborted) controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
      };
      const pumps = iterators.map(async ({ subscription, iterator }) => {
        try {
          while (!abort.signal.aborted) {
            const next = await iterator.next();
            if (next.done) break;
            enqueue({
              protocol: 'applik8s.query-multiplex/v1alpha1',
              kind: 'event',
              subscriptionId: subscription.id,
              event: next.value,
            });
          }
        } catch (error) {
          if (!abort.signal.aborted) enqueue(multiplexErrorFrame(subscription.id, error));
        } finally {
          await iterator.return?.().catch(() => undefined);
        }
      });
      void Promise.all(pumps).then(() => {
        if (closed) return;
        closed = true;
        request.signal.removeEventListener('abort', abortFromRequest);
        controller.close();
      }).catch((error: unknown) => {
        if (closed) return;
        closed = true;
        request.signal.removeEventListener('abort', abortFromRequest);
        controller.error(error);
      });
    },
    async cancel() {
      if (closed) return;
      closed = true;
      request.signal.removeEventListener('abort', abortFromRequest);
      abort.abort();
      await Promise.allSettled(iterators.map(({ iterator }) => iterator.return?.()));
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store, no-transform', connection: 'keep-alive', 'x-content-type-options': 'nosniff' },
  });
}

function multiplexErrorFrame(subscriptionId: string, error: unknown): ApplicationQueryMultiplexErrorFrame {
  if (error instanceof ApplicationQueryAuthorizationError) return { protocol: 'applik8s.query-multiplex/v1alpha1', kind: 'error', subscriptionId, error: 'forbidden' };
  if (error instanceof ApplicationQuerySubscriptionLimitError) return { protocol: 'applik8s.query-multiplex/v1alpha1', kind: 'error', subscriptionId, error: 'subscription_limit', retryAfterSeconds: 5 };
  if (isProjectionUnavailableError(error)) return { protocol: 'applik8s.query-multiplex/v1alpha1', kind: 'error', subscriptionId, error: 'projection_unavailable', retryAfterSeconds: 5 };
  const message = error instanceof Error ? error.message : String(error);
  if (/Unknown application query/.test(message)) return { protocol: 'applik8s.query-multiplex/v1alpha1', kind: 'error', subscriptionId, error: 'not_found' };
  if (/validation failed|requires trusted context|identity provider returned/.test(message)) return { protocol: 'applik8s.query-multiplex/v1alpha1', kind: 'error', subscriptionId, error: 'invalid_request' };
  return { protocol: 'applik8s.query-multiplex/v1alpha1', kind: 'error', subscriptionId, error: 'internal_error' };
}

function isProjectionUnavailableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = Reflect.get(error, 'code');
  return code === 'APPLIK8S_ONLINE_PROJECTION_UNAVAILABLE'
    || code === 'APPLIK8S_ANALYTICAL_PROJECTION_NOT_CONFIGURED';
}

async function admittedIdentity<TRequest, TPrincipal extends ApplicationQueryPrincipal>(options: ApplicationQueryGatewayOptions<TRequest, TPrincipal>, request: TRequest, query: ApplicationQueryBinding<unknown, unknown, TPrincipal>, input: unknown): Promise<ApplicationGatewayIdentity<TPrincipal>> {
  const identity = await options.authenticate(request, query, input);
  if (!identity.principal.id || !identity.authorizationVersion) throw new Error('Application query gateway identity provider returned an incomplete principal or authorization version.');
  for (const context of query.trustedContext) {
    const value = identity.admittedContext.values[context.name];
    if (value === undefined) throw new Error(`Application query ${query.id} requires trusted context ${context.name}, but the identity/application provider did not establish it.`);
    validateTrustedContextValue(context, value);
  }
  return identity;
}

function requiredQuery<TPrincipal extends ApplicationQueryPrincipal>(queries: ReadonlyMap<string, ApplicationQueryBinding<unknown, unknown, TPrincipal>>, id: string): ApplicationQueryBinding<unknown, unknown, TPrincipal> {
  const query = queries.get(id);
  if (!query) throw new Error(`Unknown application query ${id}.`);
  return query;
}

function enforceResultBudget(query: ApplicationQueryBinding, value: unknown): void {
  if (Array.isArray(value) && value.length > query.budgets.maxRows) throw new Error(`Application query ${query.id} returned ${value.length} rows, exceeding maxRows ${query.budgets.maxRows}.`);
  const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  if (bytes > query.budgets.maxResultBytes) throw new Error(`Application query ${query.id} returned ${bytes} bytes, exceeding maxResultBytes ${query.budgets.maxResultBytes}.`);
}

function queryModelNames(query: ApplicationQueryBinding): Set<string> {
  const names = new Set<string>();
  for (const dependency of query.reads) {
    const source = Reflect.get(dependency, 'source');
    const target = Reflect.get(dependency, 'target');
    if (typeof source === 'string') names.add(source);
    if (typeof target === 'string') names.add(target);
    const facet = Reflect.get(dependency, '$model');
    const name = facet && typeof facet === 'object' ? Reflect.get(facet, 'name') : undefined;
    if (typeof name === 'string') names.add(name);
  }
  return names;
}

function encodeCursor(secret: string, payload: CursorPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

// typecast-boundary: HMAC verification precedes the closed cursor shape and every identity/version/expiry field is checked below.
function decodeCursor(secret: string, cursor: string, expected: {
  readonly query: string;
  readonly inputKey: string;
  readonly contextDigest: string;
  readonly authorizationVersion: string;
  readonly now: number;
  readonly receipt?: ApplicationAuthorizationReceipt;
}): CursorPayload {
  const [body, signature, extra] = cursor.split('.');
  if (!body || !signature || extra) throw new CursorValidationError('cursorInvalid');
  const calculated = createHmac('sha256', secret).update(body).digest();
  let supplied: Buffer;
  try { supplied = Buffer.from(signature, 'base64url'); } catch { throw new CursorValidationError('cursorInvalid'); }
  if (supplied.length !== calculated.length || !timingSafeEqual(supplied, calculated)) throw new CursorValidationError('cursorInvalid');
  let payload: CursorPayload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as CursorPayload; } catch { throw new CursorValidationError('cursorInvalid'); }
  if ((payload.version !== 2 && payload.version !== 3) || !Number.isSafeInteger(payload.sequence) || payload.sequence < 0 || !opaqueCursorField(payload.contextBinding) || !opaqueCursorField(payload.authorizationBinding)) throw new CursorValidationError('cursorInvalid');
  if (payload.providerRevision !== undefined && (typeof payload.providerRevision !== 'string' || payload.providerRevision.length < 1 || payload.providerRevision.length > 512)) throw new CursorValidationError('cursorInvalid');
  if (payload.query !== expected.query) throw new CursorValidationError('queryVersionChanged');
  if (payload.inputKey !== expected.inputKey) throw new CursorValidationError('cursorInvalid');
  if (payload.contextBinding !== cursorBinding(secret, 'context', expected.contextDigest)) throw new CursorValidationError('contextChanged');
  if (payload.authorizationBinding !== cursorBinding(secret, 'authorization', expected.authorizationVersion)) throw new CursorValidationError('authorizationChanged');
  if (expected.receipt) {
    const fields = receiptCursorFields(secret, expected.receipt);
    if (payload.version !== 3
      || payload.applicationBinding !== fields.applicationBinding
      || payload.principalBinding !== fields.principalBinding
      || payload.operationId !== fields.operationId
      || payload.operationVersion !== fields.operationVersion
      || payload.catalogRevision !== fields.catalogRevision
      || payload.authorityRevision !== fields.authorityRevision) {
      throw new CursorValidationError('authorizationChanged');
    }
  } else if (payload.version === 3) {
    throw new CursorValidationError('authorizationChanged');
  }
  if (payload.expiresAt < expected.now) throw new CursorValidationError('cursorExpired');
  return payload;
}

async function authorizeQueryOperation<TRequest, TPrincipal extends ApplicationQueryPrincipal>(
  options: ApplicationQueryGatewayOptions<TRequest, TPrincipal>,
  boundary: 'admission' | 'subscription-resume',
  query: ApplicationQueryBinding<unknown, unknown, TPrincipal>,
  input: unknown,
  identity: ApplicationGatewayIdentity<TPrincipal>,
): Promise<ApplicationAuthorizationReceipt | undefined> {
  if (!options.authorizeOperation) return undefined;
  const inputDigest = applicationOperationInputDigest(input);
  const trustedContextDigest = applicationAdmittedContextDigest(identity.admittedContext);
  const result = await options.authorizeOperation({
    boundary,
    query,
    input,
    identity,
    inputDigest,
    trustedContextDigest,
  });
  if (!result) throw new ApplicationQueryAuthorizationError(query.id);
  const diagnostics = validateApplicationAuthorizationReceipt(result);
  if (diagnostics.length > 0
    || result.principal.id !== identity.principal.id
    || result.inputDigest !== inputDigest
    || result.trustedContextDigest !== trustedContextDigest) {
    throw new Error(`Application query ${query.id} authority returned an invalid receipt: ${diagnostics.map((diagnostic) => diagnostic.message).join(' ')}`);
  }
  return result;
}

function receiptCursorFields(secret: string, receipt: ApplicationAuthorizationReceipt): Pick<
  CursorPayload,
  'applicationBinding' | 'principalBinding' | 'operationId' | 'operationVersion' | 'catalogRevision' | 'authorityRevision' | 'receiptId'
> {
  return {
    applicationBinding: cursorBinding(secret, 'application', receipt.application),
    principalBinding: cursorBinding(secret, 'principal', receipt.principal.id),
    operationId: receipt.operationId,
    operationVersion: receipt.operationVersion,
    catalogRevision: receipt.catalogRevision,
    authorityRevision: receipt.authorityRevision,
    receiptId: receipt.id,
  };
}

function sameReceiptRevision(
  admitted: ApplicationAuthorizationReceipt | undefined,
  current: ApplicationAuthorizationReceipt | undefined,
): boolean {
  if (!admitted || !current) return admitted === current;
  return admitted.operationId === current.operationId
    && admitted.application === current.application
    && admitted.operationVersion === current.operationVersion
    && admitted.catalogRevision === current.catalogRevision
    && admitted.authorityRevision === current.authorityRevision
    && admitted.principal.id === current.principal.id;
}

function cursorBinding(secret: string, domain: 'application' | 'authorization' | 'context' | 'principal', value: string): string { return createHmac('sha256', secret).update(`applik8s.query-cursor.${domain}\0`).update(value).digest('base64url'); }
function opaqueCursorField(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value); }

class CursorValidationError extends Error {
  constructor(readonly reason: Extract<ApplicationQueryEvent, { kind: 'reset' }>['reason']) { super(reason); }
}

function resetEvent(query: string, reason: Extract<ApplicationQueryEvent, { kind: 'reset' }>['reason'], now: Date): ApplicationQueryEvent {
  return { kind: 'reset', protocol: 'applik8s.query/v1alpha1', id: `${query}:reset:${now.getTime()}`, query, reason };
}

async function withTimeout<TValue>(promise: Promise<TValue>, timeoutMs: number, message: string): Promise<TValue> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error(message)), timeoutMs); })]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timeout); resolve(); }, { once: true });
  });
}

function jsonResponse(value: unknown, status: number, extraHeaders: Readonly<Record<string, string>> = {}): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extraHeaders } });
}
