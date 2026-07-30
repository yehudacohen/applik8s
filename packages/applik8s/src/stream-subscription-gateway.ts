import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  type ApplicationAuthorizationReceipt,
  validateApplicationAuthorizationReceipt,
} from '@applik8s/core';
import { applicationOperationInputDigest } from './application-operation-runtime.js';
import type { ApplicationQueryPrincipal } from './application-queries.js';
import type { ApplicationStreamBinding } from './application-reactive.js';
import type { ApplicationReplayableStream, ApplicationReplayPage } from './projection-runtime-clickhouse.js';
import type { ApplicationSubscriptionLimiter } from './query-gateway.js';
import { createApplicationSubscriptionLimiter } from './query-gateway.js';

export interface ApplicationStreamSubscriptionIdentity<TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal> {
  readonly principal: TPrincipal;
  readonly authorizationVersion: string;
  /** Opaque HMAC digest of provider-admitted context; raw context never enters cursors or stream SQL. */
  readonly contextDigest: string;
}

export interface ApplicationStreamSubscriptionRuntimeBinding<TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal> {
  readonly name: string;
  readonly stream: ApplicationStreamBinding<object, TPrincipal>;
  authorize(principal: TPrincipal): boolean | Promise<boolean>;
  open(identity: ApplicationStreamSubscriptionIdentity<TPrincipal>): ApplicationReplayableStream<object> & { close?(): Promise<void> };
}

export interface ApplicationStreamSubscriptionGatewayOptions<TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal> {
  readonly subscriptions: readonly ApplicationStreamSubscriptionRuntimeBinding<TPrincipal>[];
  readonly authenticate: (request: Request) => ApplicationStreamSubscriptionIdentity<TPrincipal> | Promise<ApplicationStreamSubscriptionIdentity<TPrincipal>>;
  readonly cursorSecret: string;
  readonly cursorTtlSeconds?: number;
  readonly pollIntervalMs?: number;
  readonly heartbeatMs?: number;
  readonly maxSessionMs?: number;
  readonly pageSize?: number;
  readonly maxRequestBytes?: number;
  readonly subscriptionLimits?: { readonly perPrincipal?: number; readonly total?: number };
  readonly subscriptionLimiter?: ApplicationSubscriptionLimiter;
  readonly now?: () => Date;
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly audit?: (record: { readonly event: 'replay' | 'opened' | 'closed' | 'reset' | 'denied'; readonly subscription: string; readonly principal: string; readonly reason?: string }) => void;
  readonly authorizeOperation?: (request: {
    readonly boundary: 'admission' | 'subscription-resume';
    readonly subscription: ApplicationStreamSubscriptionRuntimeBinding<TPrincipal>;
    readonly identity: ApplicationStreamSubscriptionIdentity<TPrincipal>;
    readonly inputDigest: string;
    readonly trustedContextDigest: string;
  }) => ApplicationAuthorizationReceipt | false | Promise<ApplicationAuthorizationReceipt | false>;
}

interface StreamCursor {
  readonly version: 2;
  readonly subscription: string;
  readonly principalBinding: string;
  readonly authorizationBinding: string;
  readonly contextBinding: string;
  readonly applicationBinding?: string;
  readonly operationId?: string;
  readonly operationVersion?: string;
  readonly catalogRevision?: string;
  readonly authorityRevision?: string;
  readonly sequence: number;
  readonly expiresAt: number;
}

/** Authenticated replay and bounded SSE delivery for explicit public stream subscriptions. */
export function createApplicationStreamSubscriptionGateway<TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal>(options: ApplicationStreamSubscriptionGatewayOptions<TPrincipal>): { handle(request: Request): Promise<Response | undefined> } {
  if (options.cursorSecret.length < 32) throw new Error('Application stream subscription gateway cursorSecret must contain at least 32 characters.');
  const subscriptions = new Map(options.subscriptions.map((subscription) => [subscription.name, subscription]));
  if (subscriptions.size !== options.subscriptions.length) throw new Error('Application stream subscription registrations must be unique.');
  const now = options.now ?? (() => new Date());
  const cursorTtlSeconds = options.cursorTtlSeconds ?? 15 * 60;
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  const heartbeatMs = options.heartbeatMs ?? 15_000;
  const maxSessionMs = options.maxSessionMs ?? 5 * 60_000;
  const pageSize = options.pageSize ?? 100;
  const maxRequestBytes = options.maxRequestBytes ?? 1024 * 1024;
  const sleep = options.sleep ?? abortableSleep;
  const limits = { perPrincipal: options.subscriptionLimits?.perPrincipal ?? 20, total: options.subscriptionLimits?.total ?? 1_000 };
  const limiter = options.subscriptionLimiter ?? createApplicationSubscriptionLimiter(limits);
  if (cursorTtlSeconds < 30 || pollIntervalMs < 10 || heartbeatMs < pollIntervalMs || maxSessionMs < heartbeatMs || pageSize < 1 || pageSize > 1_000) throw new Error('Application stream subscription polling, heartbeat, cursor, session, or page bounds are invalid.');

  return {
    async handle(request) {
      const route = streamRoute(request);
      if (!route) return undefined;
      if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
      const body = await boundedJson(request, maxRequestBytes);
      if (!body.ok) return body.response;
      const subscription = subscriptions.get(route.subscription);
      if (!subscription) return json({ error: 'not_found' }, 404);
      try {
        const identity = await admitted(options, request);
        if (!await subscription.authorize(identity.principal)) {
          options.audit?.({ event: 'denied', subscription: subscription.name, principal: identity.principal.id });
          return json({ error: 'forbidden' }, 403);
        }
        const receipt = await authorizeStreamOperation(options, 'admission', subscription, identity);
        const cursor = cursorForRequest(options.cursorSecret, subscription.name, identity, receipt, body.value.cursor, now().getTime(), cursorTtlSeconds);
        if (route.operation === 'replay') {
          const requestedLimit = body.value.limit === undefined ? pageSize : Number(body.value.limit);
          if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > pageSize) return json({ error: 'invalid_limit' }, 400);
          const source = subscription.open(identity);
          try {
            const page = await source.read(cursor.sequence, requestedLimit);
            const gap = retentionGap(cursor.sequence, page);
            if (gap) {
              options.audit?.({ event: 'reset', subscription: subscription.name, principal: identity.principal.id, reason: 'retentionGap' });
              return json({ protocol: 'applik8s.stream/v1alpha1', kind: 'reset', subscription: subscription.name, reason: 'retentionGap' }, 409);
            }
            const next = advanceCursor(cursor, page.nextSequence, now().getTime(), cursorTtlSeconds);
            options.audit?.({ event: 'replay', subscription: subscription.name, principal: identity.principal.id });
            return json({ protocol: 'applik8s.stream/v1alpha1', kind: 'replay', subscription: subscription.name, items: page.items, cursor: encodeCursor(options.cursorSecret, next), exhausted: page.exhausted, retentionFloor: page.retentionFloor }, 200);
          } finally {
            await source.close?.();
          }
        }
        if (!limiter.acquire(identity.principal.id)) return json({ error: 'subscription_limit' }, 429, { 'retry-after': '5' });
        const encoder = new TextEncoder();
        const session = new AbortController();
        const abortSession = () => session.abort();
        request.signal.addEventListener('abort', abortSession, { once: true });
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const source = subscription.open(identity);
            let current = cursor;
            let heartbeatAt = now().getTime();
            const startedAt = heartbeatAt;
            options.audit?.({ event: 'opened', subscription: subscription.name, principal: identity.principal.id });
            try {
              while (!session.signal.aborted && now().getTime() - startedAt < maxSessionMs) {
                const currentIdentity = await admitted(options, request);
                const currentReceipt = await authorizeStreamOperation(options, 'subscription-resume', subscription, currentIdentity);
                if (!sameIdentity(identity, currentIdentity)
                  || !sameReceiptRevision(receipt, currentReceipt)
                  || !await subscription.authorize(currentIdentity.principal)) {
                  enqueue(controller, encoder, 'reset', { protocol: 'applik8s.stream/v1alpha1', kind: 'reset', subscription: subscription.name, reason: 'authorizationChanged' });
                  options.audit?.({ event: 'reset', subscription: subscription.name, principal: identity.principal.id, reason: 'authorizationChanged' });
                  break;
                }
                const page = await source.read(current.sequence, pageSize);
                if (retentionGap(current.sequence, page)) {
                  enqueue(controller, encoder, 'reset', { protocol: 'applik8s.stream/v1alpha1', kind: 'reset', subscription: subscription.name, reason: 'retentionGap' });
                  options.audit?.({ event: 'reset', subscription: subscription.name, principal: identity.principal.id, reason: 'retentionGap' });
                  break;
                }
                if (page.items.length > 0) {
                  current = advanceCursor(current, page.nextSequence, now().getTime(), cursorTtlSeconds);
                  enqueue(controller, encoder, 'events', { protocol: 'applik8s.stream/v1alpha1', kind: 'events', subscription: subscription.name, items: page.items, cursor: encodeCursor(options.cursorSecret, current) });
                  heartbeatAt = now().getTime();
                  if (!page.exhausted) continue;
                } else if (now().getTime() - heartbeatAt >= heartbeatMs) {
                  current = advanceCursor(current, current.sequence, now().getTime(), cursorTtlSeconds);
                  enqueue(controller, encoder, 'keepalive', { protocol: 'applik8s.stream/v1alpha1', kind: 'keepalive', subscription: subscription.name, cursor: encodeCursor(options.cursorSecret, current) });
                  heartbeatAt = now().getTime();
                }
                await sleep(pollIntervalMs, session.signal);
              }
              controller.close();
            } catch (error) {
              controller.error(error);
            } finally {
              await source.close?.();
              limiter.release(identity.principal.id);
              request.signal.removeEventListener('abort', abortSession);
              options.audit?.({ event: 'closed', subscription: subscription.name, principal: identity.principal.id });
            }
          },
          cancel() {
            session.abort();
          },
        });
        return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store, no-transform', connection: 'keep-alive', 'x-content-type-options': 'nosniff' } });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return /cursor|identity|authentication|required/i.test(message) ? json({ error: 'invalid_request' }, 400) : json({ error: 'internal_error' }, 500);
      }
    },
  };
}

function streamRoute(request: Request): { readonly subscription: string; readonly operation: 'replay' | 'subscribe' } | undefined {
  const parts = new URL(request.url).pathname.split('/').filter(Boolean);
  if (parts.length !== 3 || parts[0] !== 'streams' || (parts[2] !== 'replay' && parts[2] !== 'subscribe')) return undefined;
  return { subscription: decodeURIComponent(parts[1] ?? ''), operation: parts[2] };
}

async function admitted<TPrincipal extends ApplicationQueryPrincipal>(options: ApplicationStreamSubscriptionGatewayOptions<TPrincipal>, request: Request): Promise<ApplicationStreamSubscriptionIdentity<TPrincipal>> {
  const identity = await options.authenticate(request);
  if (!identity.principal.id || !identity.authorizationVersion || !identity.contextDigest) throw new Error('Application stream subscription identity is incomplete.');
  return identity;
}

function cursorForRequest<TPrincipal extends ApplicationQueryPrincipal>(
  secret: string,
  subscription: string,
  identity: ApplicationStreamSubscriptionIdentity<TPrincipal>,
  receipt: ApplicationAuthorizationReceipt | undefined,
  value: unknown,
  now: number,
  ttlSeconds: number,
): StreamCursor {
  const bindings = streamCursorBindings(secret, identity, receipt);
  if (value === undefined || value === null || value === '') return { version: 2, subscription, ...bindings, sequence: 0, expiresAt: now + ttlSeconds * 1_000 };
  if (typeof value !== 'string') throw new Error('Application stream cursor must be a string.');
  const cursor = decodeCursor(secret, value, now);
  if (cursor.subscription !== subscription || !sameCursorBindings(cursor, bindings)) throw new Error('Application stream cursor identity is invalid.');
  return cursor;
}

function retentionGap(sequence: number, page: ApplicationReplayPage<object>): boolean { return sequence > 0 && page.retentionFloor > sequence; }
function advanceCursor(cursor: StreamCursor, sequence: number, now: number, ttlSeconds: number): StreamCursor { return { ...cursor, sequence, expiresAt: now + ttlSeconds * 1_000 }; }
function sameIdentity<TPrincipal extends ApplicationQueryPrincipal>(left: ApplicationStreamSubscriptionIdentity<TPrincipal>, right: ApplicationStreamSubscriptionIdentity<TPrincipal>): boolean { return left.principal.id === right.principal.id && left.authorizationVersion === right.authorizationVersion && left.contextDigest === right.contextDigest; }
function streamCursorBindings<TPrincipal extends ApplicationQueryPrincipal>(
  secret: string,
  identity: ApplicationStreamSubscriptionIdentity<TPrincipal>,
  receipt: ApplicationAuthorizationReceipt | undefined,
): Pick<StreamCursor, 'principalBinding' | 'authorizationBinding' | 'contextBinding' | 'applicationBinding' | 'operationId' | 'operationVersion' | 'catalogRevision' | 'authorityRevision'> {
  return {
    principalBinding: streamBinding(secret, 'principal', identity.principal.id),
    authorizationBinding: streamBinding(secret, 'authorization', identity.authorizationVersion),
    contextBinding: streamBinding(secret, 'context', identity.contextDigest),
    ...(receipt ? {
      applicationBinding: streamBinding(secret, 'application', receipt.application),
      operationId: receipt.operationId,
      operationVersion: receipt.operationVersion,
      catalogRevision: receipt.catalogRevision,
      authorityRevision: receipt.authorityRevision,
    } : {}),
  };
}

function sameCursorBindings(
  cursor: StreamCursor,
  expected: ReturnType<typeof streamCursorBindings>,
): boolean {
  return cursor.principalBinding === expected.principalBinding
    && cursor.authorizationBinding === expected.authorizationBinding
    && cursor.contextBinding === expected.contextBinding
    && cursor.applicationBinding === expected.applicationBinding
    && cursor.operationId === expected.operationId
    && cursor.operationVersion === expected.operationVersion
    && cursor.catalogRevision === expected.catalogRevision
    && cursor.authorityRevision === expected.authorityRevision;
}

async function authorizeStreamOperation<TPrincipal extends ApplicationQueryPrincipal>(
  options: ApplicationStreamSubscriptionGatewayOptions<TPrincipal>,
  boundary: 'admission' | 'subscription-resume',
  subscription: ApplicationStreamSubscriptionRuntimeBinding<TPrincipal>,
  identity: ApplicationStreamSubscriptionIdentity<TPrincipal>,
): Promise<ApplicationAuthorizationReceipt | undefined> {
  if (!options.authorizeOperation) return undefined;
  const inputDigest = applicationOperationInputDigest({ subscription: subscription.name });
  const result = await options.authorizeOperation({
    boundary,
    subscription,
    identity,
    inputDigest,
    trustedContextDigest: identity.contextDigest,
  });
  if (!result) throw new Error(`Application stream subscription ${subscription.name} is forbidden.`);
  const diagnostics = validateApplicationAuthorizationReceipt(result);
  if (diagnostics.length > 0
    || result.principal.id !== identity.principal.id
    || result.inputDigest !== inputDigest
    || result.trustedContextDigest !== identity.contextDigest) {
    throw new Error(`Application stream subscription ${subscription.name} authority returned an invalid receipt: ${diagnostics.map((diagnostic) => diagnostic.message).join(' ')}`);
  }
  return result;
}

function sameReceiptRevision(
  admitted: ApplicationAuthorizationReceipt | undefined,
  current: ApplicationAuthorizationReceipt | undefined,
): boolean {
  if (!admitted || !current) return admitted === current;
  return admitted.application === current.application
    && admitted.operationId === current.operationId
    && admitted.operationVersion === current.operationVersion
    && admitted.catalogRevision === current.catalogRevision
    && admitted.authorityRevision === current.authorityRevision
    && admitted.principal.id === current.principal.id;
}

function streamBinding(secret: string, domain: 'application' | 'authorization' | 'context' | 'principal', value: string): string {
  return createHmac('sha256', secret).update(`applik8s.stream-cursor.${domain}\0`).update(value).digest('base64url');
}

function encodeCursor(secret: string, cursor: StreamCursor): string { const body = Buffer.from(JSON.stringify(cursor)).toString('base64url'); return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`; }
// typecast: the signed cursor is decoded only after HMAC verification and scoped sequence/expiry checks.
function decodeCursor(secret: string, value: string, now: number): StreamCursor { const [body, signature, extra] = value.split('.'); if (!body || !signature || extra) throw new Error('Application stream cursor is invalid.'); const expected = createHmac('sha256', secret).update(body).digest(); const supplied = Buffer.from(signature, 'base64url'); if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error('Application stream cursor is invalid.'); const parsed: unknown = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); if (!parsed || typeof parsed !== 'object') throw new Error('Application stream cursor is invalid.'); const cursor = parsed as StreamCursor; if (cursor.version !== 2 || !Number.isSafeInteger(cursor.sequence) || cursor.sequence < 0 || cursor.expiresAt < now) throw new Error('Application stream cursor is invalid or expired.'); return cursor; }

function enqueue(controller: ReadableStreamDefaultController<Uint8Array>, encoder: TextEncoder, event: string, value: unknown): void { controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`)); }
async function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> { if (signal?.aborted) return; await new Promise<void>((resolve) => { const timeout = setTimeout(done, ms); const abort = () => done(); function done() { clearTimeout(timeout); signal?.removeEventListener('abort', abort); resolve(); } signal?.addEventListener('abort', abort, { once: true }); }); }
// typecast-boundary: parsed JSON is proven to be a non-array object before the record-shaped body is returned.
async function boundedJson(request: Request, maxBytes: number): Promise<{ readonly ok: true; readonly value: Record<string, unknown> } | { readonly ok: false; readonly response: Response }> { const contentLength = Number(request.headers.get('content-length') ?? 0); if (contentLength > maxBytes) return { ok: false, response: json({ error: 'request_too_large' }, 413) }; const text = await request.text(); if (new TextEncoder().encode(text).byteLength > maxBytes) return { ok: false, response: json({ error: 'request_too_large' }, 413) }; try { const value: unknown = JSON.parse(text); return value && typeof value === 'object' && !Array.isArray(value) ? { ok: true, value: value as Record<string, unknown> } : { ok: false, response: json({ error: 'invalid_json' }, 400) }; } catch { return { ok: false, response: json({ error: 'invalid_json' }, 400) }; } }
function json(value: unknown, status: number, headers: Readonly<Record<string, string>> = {}): Response { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } }); }
