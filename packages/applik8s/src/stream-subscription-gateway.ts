// typecast-file-boundary: authenticated subscription requests and provider-neutral cursor payloads are validated before typed stream delivery.
import { randomUUID } from 'node:crypto';
import {
  type ApplicationAuthorizationReceipt,
  canonicalJsonV1Value,
  createApplicationAdmissionContextV1,
  type JsonValue,
  validateApplicationAuthorizationReceipt,
} from '@applik8s/core';
import { nodeKeyedDigestBase64Url } from '@applik8s/runtime/node-integrity';
import {
  createRollingSignedEnvelopeCodec,
  type RollingSignedEnvelopeCodec,
  signedEnvelopeUtf8Key,
  staticSignedEnvelopeKeyProvider,
} from '@applik8s/runtime/signed-envelope';
import { applicationOperationInputDigest } from './application-operation-runtime.js';
import type { ApplicationQueryPrincipal } from './application-queries.js';
import type { ApplicationStreamBinding } from './application-reactive.js';
import type { ApplicationReplayableStream, ApplicationReplayPage, ApplicationStreamEnvelope } from './projection-runtime-clickhouse.js';
import type { ApplicationSubscriptionLimiter } from './query-gateway.js';
import { createApplicationSubscriptionLimiter } from './query-gateway.js';

export interface ApplicationStreamSubscriptionIdentity<TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal> {
  readonly principal: TPrincipal;
  readonly trustedContext: Readonly<Record<string, JsonValue>>;
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

export interface ApplicationAuthorizedReplayableStreamOptions<
  TPayload extends object,
> {
  readonly source: ApplicationReplayableStream<TPayload> & {
    close?(): Promise<void>;
  };
  readonly authorize: (
    event: ApplicationStreamEnvelope<TPayload>,
  ) => boolean | Promise<boolean>;
  /** Bounds hidden-row scanning in one public request. */
  readonly maxScanPages?: number;
}

/**
 * Applies event-level authority without leaking unauthorized rows or stalling
 * the opaque cursor behind them. This is required for exact-instance signal
 * visibility and is also useful for other row-authorized event families.
 */
export function createApplicationAuthorizedReplayableStream<
  TPayload extends object,
>(
  options: ApplicationAuthorizedReplayableStreamOptions<TPayload>,
): ApplicationReplayableStream<TPayload> & { close?(): Promise<void> } {
  const maxScanPages = options.maxScanPages ?? 20;
  if (
    !Number.isSafeInteger(maxScanPages)
    || maxScanPages < 1
    || maxScanPages > 100
  ) {
    throw new Error('Authorized stream maxScanPages must be between 1 and 100.');
  }
  const closeSource = options.source.close?.bind(options.source);
  return {
    async read(afterSequence, limit) {
      let cursor = afterSequence;
      let retentionFloor = 0;
      let exhausted = false;
      const items: ApplicationStreamEnvelope<TPayload>[] = [];
      for (
        let pageIndex = 0;
        pageIndex < maxScanPages && items.length < limit && !exhausted;
        pageIndex += 1
      ) {
        const page = await options.source.read(
          cursor,
          Math.max(1, limit - items.length),
        );
        retentionFloor = Math.max(retentionFloor, page.retentionFloor);
        exhausted = page.exhausted;
        cursor = page.nextSequence;
        for (const event of page.items) {
          if (await options.authorize(event)) items.push(event);
        }
        if (page.items.length === 0 && !page.exhausted) {
          throw new Error(
            'Authorized stream source did not advance its cursor.',
          );
        }
      }
      return {
        items,
        nextSequence: cursor,
        exhausted,
        retentionFloor,
      };
    },
    ...(closeSource
      ? { close: () => closeSource() }
      : {}),
  };
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
  if (cursorTtlSeconds < 30 || cursorTtlSeconds > 24 * 60 * 60 || pollIntervalMs < 10 || heartbeatMs < pollIntervalMs || maxSessionMs < heartbeatMs || pageSize < 1 || pageSize > 1_000) throw new Error('Application stream subscription polling, heartbeat, cursor, session, or page bounds are invalid.');
  const cursorKey = signedEnvelopeUtf8Key(options.cursorSecret);
  const cursorCodec = createRollingSignedEnvelopeCodec<StreamCursor, StreamCursor>({
    purpose: 'applik8s.stream-cursor/v1',
    keys: staticSignedEnvelopeKeyProvider({
      current: { id: 'stream-cursor-current', key: cursorKey },
    }),
    now: () => now().getTime(),
    maximumLifetimeMs: cursorTtlSeconds * 1_000,
    maximumEncodedBytes: 64 * 1_024,
    validatePayload: validateStreamCursor,
    writer: 'legacy',
    legacy: {
      key: cursorKey,
      validatePayload: validateStreamCursor,
      toCurrent: (payload) => payload,
      fromCurrent: (payload) => canonicalJsonV1Value(payload),
    },
  });

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
        const identity = await admitted(options, request, subscription, route.operation);
        if (!await subscription.authorize(identity.principal)) {
          options.audit?.({ event: 'denied', subscription: subscription.name, principal: identity.principal.id });
          return json({ error: 'forbidden' }, 403);
        }
        const receipt = await authorizeStreamOperation(options, 'admission', subscription, identity);
        const cursor = await cursorForRequest(cursorCodec, options.cursorSecret, subscription.name, identity, receipt, body.value.cursor, now().getTime(), cursorTtlSeconds);
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
            return json({ protocol: 'applik8s.stream/v1alpha1', kind: 'replay', subscription: subscription.name, items: page.items, cursor: await encodeCursor(cursorCodec, next), exhausted: page.exhausted, retentionFloor: page.retentionFloor }, 200);
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
                const currentIdentity = await admitted(options, request, subscription, 'subscribe');
                const currentReceipt = await authorizeStreamOperation(options, 'subscription-resume', subscription, currentIdentity);
                if (!sameIdentityScope(identity, currentIdentity)
                  || !sameAuthorizationScope(identity, currentIdentity, receipt, currentReceipt)
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
                  enqueue(controller, encoder, 'events', { protocol: 'applik8s.stream/v1alpha1', kind: 'events', subscription: subscription.name, items: page.items, cursor: await encodeCursor(cursorCodec, current) });
                  heartbeatAt = now().getTime();
                  if (!page.exhausted) continue;
                } else if (now().getTime() - heartbeatAt >= heartbeatMs) {
                  current = advanceCursor(current, current.sequence, now().getTime(), cursorTtlSeconds);
                  enqueue(controller, encoder, 'keepalive', { protocol: 'applik8s.stream/v1alpha1', kind: 'keepalive', subscription: subscription.name, cursor: await encodeCursor(cursorCodec, current) });
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

async function admitted<TPrincipal extends ApplicationQueryPrincipal>(
  options: ApplicationStreamSubscriptionGatewayOptions<TPrincipal>,
  request: Request,
  subscription: ApplicationStreamSubscriptionRuntimeBinding<TPrincipal>,
  action: 'replay' | 'subscribe',
): Promise<ApplicationStreamSubscriptionIdentity<TPrincipal>> {
  const identity = await options.authenticate(request);
  if (!identity.contextDigest) throw new Error('Application stream subscription identity is incomplete.');
  const admission = createApplicationAdmissionContextV1({
    admission: { principal: identity.principal, trustedContext: identity.trustedContext },
    operation: {
      id: `applik8s://streams/${subscription.name}/${action}`,
      transport: 'http',
    },
    correlationId: request.headers.get('x-request-id')?.trim() || randomUUID(),
  });
  return {
    ...identity,
    principal: admission.principal as TPrincipal,
    trustedContext: admission.trustedContext.values,
  };
}

async function cursorForRequest<TPrincipal extends ApplicationQueryPrincipal>(
  codec: RollingSignedEnvelopeCodec<StreamCursor>,
  secret: string,
  subscription: string,
  identity: ApplicationStreamSubscriptionIdentity<TPrincipal>,
  receipt: ApplicationAuthorizationReceipt | undefined,
  value: unknown,
  now: number,
  ttlSeconds: number,
): Promise<StreamCursor> {
  const bindings = streamCursorBindings(secret, identity, receipt);
  if (value === undefined || value === null || value === '') return { version: 2, subscription, ...bindings, sequence: 0, expiresAt: now + ttlSeconds * 1_000 };
  if (typeof value !== 'string') throw new Error('Application stream cursor must be a string.');
  const cursor = await decodeCursor(codec, value, now);
  if (cursor.subscription !== subscription || !sameCursorBindings(cursor, bindings)) throw new Error('Application stream cursor identity is invalid.');
  return cursor;
}

function retentionGap(sequence: number, page: ApplicationReplayPage<object>): boolean { return sequence > 0 && page.retentionFloor > sequence; }
function advanceCursor(cursor: StreamCursor, sequence: number, now: number, ttlSeconds: number): StreamCursor { return { ...cursor, sequence, expiresAt: now + ttlSeconds * 1_000 }; }
function sameIdentityScope<TPrincipal extends ApplicationQueryPrincipal>(left: ApplicationStreamSubscriptionIdentity<TPrincipal>, right: ApplicationStreamSubscriptionIdentity<TPrincipal>): boolean { return left.principal.id === right.principal.id && left.contextDigest === right.contextDigest; }
function streamCursorBindings<TPrincipal extends ApplicationQueryPrincipal>(
  secret: string,
  identity: ApplicationStreamSubscriptionIdentity<TPrincipal>,
  receipt: ApplicationAuthorizationReceipt | undefined,
): Pick<StreamCursor, 'principalBinding' | 'authorizationBinding' | 'contextBinding' | 'applicationBinding' | 'operationId' | 'operationVersion' | 'catalogRevision' | 'authorityRevision'> {
  return {
    principalBinding: streamBinding(secret, 'principal', identity.principal.id),
    authorizationBinding: streamBinding(secret, 'authorization', identity.principal.authorityRevision),
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
  const sameScope = cursor.principalBinding === expected.principalBinding
    && cursor.contextBinding === expected.contextBinding
    && cursor.applicationBinding === expected.applicationBinding
    && cursor.operationId === expected.operationId
    && cursor.operationVersion === expected.operationVersion
    && cursor.catalogRevision === expected.catalogRevision;
  if (!sameScope) return false;
  // A fresh operation receipt proves the exact principal/context/operation is
  // still authorized at the current authority revision. Global authority
  // advancement by an unrelated grant or receipt must not invalidate a cursor
  // between replay and subscribe. Receipt-less integrations retain the
  // conservative principal-revision binding.
  return expected.authorityRevision !== undefined
    ? typeof cursor.authorityRevision === 'string'
    : cursor.authorityRevision === undefined
      && cursor.authorizationBinding === expected.authorizationBinding;
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

function sameAuthorizationScope<TPrincipal extends ApplicationQueryPrincipal>(
  admittedIdentity: ApplicationStreamSubscriptionIdentity<TPrincipal>,
  currentIdentity: ApplicationStreamSubscriptionIdentity<TPrincipal>,
  admitted: ApplicationAuthorizationReceipt | undefined,
  current: ApplicationAuthorizationReceipt | undefined,
): boolean {
  if (!admitted || !current) {
    return admitted === current
      && admittedIdentity.principal.authorityRevision
        === currentIdentity.principal.authorityRevision;
  }
  return admitted.application === current.application
    && admitted.operationId === current.operationId
    && admitted.operationVersion === current.operationVersion
    && admitted.catalogRevision === current.catalogRevision
    && admitted.principal.id === current.principal.id;
}

function streamBinding(secret: string, domain: 'application' | 'authorization' | 'context' | 'principal', value: string): string {
  return nodeKeyedDigestBase64Url({
    key: secret,
    purpose: `applik8s.stream-cursor.${domain}`,
    value,
  });
}

function encodeCursor(codec: RollingSignedEnvelopeCodec<StreamCursor>, cursor: StreamCursor): Promise<string> {
  return codec.sign(cursor, { expiresAt: cursor.expiresAt });
}

async function decodeCursor(codec: RollingSignedEnvelopeCodec<StreamCursor>, value: string, now: number): Promise<StreamCursor> {
  let cursor: StreamCursor;
  try {
    cursor = await codec.verify(value);
  } catch {
    throw new Error('Application stream cursor is invalid.');
  }
  if (cursor.expiresAt < now) throw new Error('Application stream cursor is invalid or expired.');
  return cursor;
}

function validateStreamCursor(value: JsonValue): StreamCursor {
  if (!isJsonObject(value)
    || value.version !== 2
    || typeof value.subscription !== 'string'
    || typeof value.principalBinding !== 'string'
    || typeof value.authorizationBinding !== 'string'
    || typeof value.contextBinding !== 'string'
    || !Number.isSafeInteger(value.sequence)
    || Number(value.sequence) < 0
    || !Number.isSafeInteger(value.expiresAt)
    || Number(value.expiresAt) < 0) {
    throw new TypeError('Application stream cursor contract is invalid.');
  }
  for (const field of ['applicationBinding', 'operationId', 'operationVersion', 'catalogRevision', 'authorityRevision'] as const) {
    if (value[field] !== undefined && typeof value[field] !== 'string') {
      throw new TypeError(`Application stream cursor ${field} is invalid.`);
    }
  }
  return value as unknown as StreamCursor;
}

function isJsonObject(value: JsonValue): value is Readonly<Record<string, JsonValue>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function enqueue(controller: ReadableStreamDefaultController<Uint8Array>, encoder: TextEncoder, event: string, value: unknown): void { controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`)); }
async function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> { if (signal?.aborted) return; await new Promise<void>((resolve) => { const timeout = setTimeout(done, ms); const abort = () => done(); function done() { clearTimeout(timeout); signal?.removeEventListener('abort', abort); resolve(); } signal?.addEventListener('abort', abort, { once: true }); }); }
// typecast-boundary: parsed JSON is proven to be a non-array object before the record-shaped body is returned.
async function boundedJson(request: Request, maxBytes: number): Promise<{ readonly ok: true; readonly value: Record<string, unknown> } | { readonly ok: false; readonly response: Response }> { const contentLength = Number(request.headers.get('content-length') ?? 0); if (contentLength > maxBytes) return { ok: false, response: json({ error: 'request_too_large' }, 413) }; const text = await request.text(); if (new TextEncoder().encode(text).byteLength > maxBytes) return { ok: false, response: json({ error: 'request_too_large' }, 413) }; try { const value: unknown = JSON.parse(text); return value && typeof value === 'object' && !Array.isArray(value) ? { ok: true, value: value as Record<string, unknown> } : { ok: false, response: json({ error: 'invalid_json' }, 400) }; } catch { return { ok: false, response: json({ error: 'invalid_json' }, 400) }; } }
function json(value: unknown, status: number, headers: Readonly<Record<string, string>> = {}): Response { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } }); }
