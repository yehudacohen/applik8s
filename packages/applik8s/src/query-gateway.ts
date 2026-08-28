// typecast-file-boundary: Authenticated HTTP query input, cursor payloads, and provider results are validated at this transport boundary before typed dispatch.
import { randomUUID } from 'node:crypto';
import { type ApplicationQueryEvent, type ApplicationQueryMultiplexErrorFrame, type ApplicationQueryMultiplexFrame, type ApplicationQueryMultiplexSubscription, type ApplicationQuerySnapshot, queryInputKey } from '@applik8s/client';
import { type ApplicationAdmissionInvocationContextV1, type ApplicationAuthorizationReceipt, applicationAdmissionInvocationView, canonicalJsonV1Value, createApplicationRequestAdmissionContextV1, type JsonValue, validateApplicationAuthorizationReceipt } from '@applik8s/core';
import {
  applicationAdmissionRejectionCodeV1,
  deliverApplicationAdmissionObservationV1,
  type ApplicationAdmissionObserverV1,
} from '@applik8s/core/admission';
import type { ApplicationInternalOperationInvocation } from '@applik8s/operations';
import { nodeKeyedDigestBase64Url } from '@applik8s/runtime/node-integrity';
import { createRollingSignedEnvelopeCodec, type RollingSignedEnvelopeCodec, signedEnvelopeUtf8Key, staticSignedEnvelopeKeyProvider } from '@applik8s/runtime/signed-envelope';
import { applicationOperationInputDigest } from './application-operation-runtime.js';
import type { ApplicationQueryBinding, ApplicationQueryPrincipal } from './application-queries.js';
import { validateQueryInput, validateQueryOutput } from './application-query-runtime.js';
import { observeApplicationRuntimeIntegrityEnvelope, runApplicationTelemetryBoundary } from './application-telemetry-runtime.js';
import { applicationRequestContextValues } from './command-principal.js';
import { type ApplicationAdmittedContext, type ApplicationRelationalContext, applicationAdmittedContextDigest } from './relational-runtime.js';
import { validateTrustedContextValue } from './trusted-context.js';

export interface ApplicationGatewayIdentity<TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal> {
  readonly principal: TPrincipal;
  readonly admittedContext: ApplicationAdmittedContext;
  /** Canonical framework admission after request evidence has been verified. */
  readonly admission?: ApplicationAdmissionInvocationContextV1;
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
  /** Framework-owned bounded evidence sink; failures never alter the query result. */
  readonly observeAdmission?: ApplicationAdmissionObserverV1;
  /**
   * Installs the admitted query invocation as the active managed-execution
   * scope while application-authored query code runs. Generated Node gateways
   * use this boundary to hydrate function-native callables without putting
   * AsyncLocalStorage or provider implementations in this portable runtime.
   */
  readonly execute?: <T>(request: {
    readonly query: ApplicationQueryBinding<unknown, unknown, TPrincipal>;
    readonly identity: ApplicationGatewayIdentity<TPrincipal>;
    readonly authorizationReceipt?: ApplicationAuthorizationReceipt;
    readonly operation: 'snapshot' | 'invoke';
  }, run: () => Promise<T>) => Promise<T>;
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
  /**
   * Exact-instance admission for capability-bearing query output. The gateway
   * discovers reserved signal references after schema validation and before
   * returning either a public or internal result.
   */
  readonly authorizeOutputCapability?: (request: {
    readonly query: ApplicationQueryBinding<unknown, unknown, TPrincipal>;
    readonly identity: ApplicationGatewayIdentity<TPrincipal>;
    readonly capability: ApplicationQuerySignalCapability;
  }) => boolean | Promise<boolean>;
}

export interface ApplicationQuerySignalCapability {
  readonly kind: 'signalReference';
  readonly contract: {
    readonly id: string;
    readonly name: string;
    readonly version: string;
  };
  readonly issuance: { readonly id: string };
  readonly expiresAt: string;
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
  /** Executes an admitted internal transport invocation through the existing query binding. */
  invoke(input: {
    readonly query: string;
    readonly input: JsonValue;
    readonly invocation: ApplicationInternalOperationInvocation;
  }): Promise<JsonValue>;
}

export interface ApplicationQueryGatewayHttpOptions {
  readonly basePath?: string;
  readonly maxRequestBytes?: number;
  /** Maximum logical subscriptions admitted through one physical SSE response. */
  readonly maxMultiplexSubscriptions?: number;
  /**
   * Operational diagnostics boundary. The HTTP response remains deliberately
   * redacted while generated runtimes can report the underlying failure.
   */
  readonly onError?: (error: unknown, context: {
    readonly query?: string;
    readonly operation?: 'snapshot' | 'subscribe';
  }) => void;
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
  if (cursorTtlSeconds < 30 || cursorTtlSeconds > 24 * 60 * 60 || pollIntervalMs < 10 || heartbeatMs < pollIntervalMs || maxSessionMs < heartbeatMs || changePageSize < 1 || changePageSize > 1_000) throw new Error('Application query gateway polling, heartbeat, cursor, session, or page bounds are invalid.');
  const cursorKey = signedEnvelopeUtf8Key(options.cursorSecret);
  const cursorCodec = createRollingSignedEnvelopeCodec<CursorPayload, CursorPayload>({
    purpose: 'applik8s.query-cursor/v1',
    keys: staticSignedEnvelopeKeyProvider({
      current: { id: 'query-cursor-current', key: cursorKey },
    }),
    now: () => now().getTime(),
    maximumLifetimeMs: cursorTtlSeconds * 1_000,
    maximumEncodedBytes: 64 * 1_024,
    validatePayload: validateCursorPayload,
    observe: observeApplicationRuntimeIntegrityEnvelope,
    writer: 'legacy',
    legacy: {
      key: cursorKey,
      validatePayload: validateCursorPayload,
      toCurrent: (payload) => payload,
      fromCurrent: (payload) => canonicalJsonV1Value(payload),
    },
  });

  return {
    async snapshot<TValue>(request: TRequest, queryId: string, rawInput: unknown): Promise<ApplicationQuerySnapshot<TValue>> {
      const query = requiredQuery(queries, queryId);
      const input = validateQueryInput(query, rawInput);
      const identity = await admittedIdentity(options, request, query, input, 'snapshot');
      if (!await query.authorize(identity.principal, input, identity.admittedContext.values)) {
        options.audit?.({ event: 'authorization-denied', query: query.id, principal: identity.principal.id });
        throw new ApplicationQueryAuthorizationError(query.id);
      }
      const receipt = await authorizeQueryOperation(options, 'admission', query, input, identity);
      if (!query.database) throw new Error(`Application query ${query.id} has no snapshot authority. Bind its first implementation to a registered database or declare reset-only provider behavior.`);
      const context = options.context(identity);
      const result = await withTimeout(executeAdmittedQuery(options, {
        query,
        identity,
        ...(receipt ? { authorizationReceipt: receipt } : {}),
        operation: 'snapshot',
      }, () => context.snapshot(query.database!, async () => {
        if (!query.sourceRuntime) return query.run(context, identity.principal, input);
        return query.sourceRuntime.snapshot(async (source) => query.run(context, identity.principal, input, source));
      })), query.budgets.timeoutMs, `Application query ${query.id} exceeded its ${query.budgets.timeoutMs}ms execution budget.`);
      const providerSnapshot = query.sourceRuntime
        ? result.value as { readonly value: unknown; readonly revision: string }
        : undefined;
      const resultValue = providerSnapshot?.value ?? result.value;
      const output = validateQueryOutput(query, resultValue);
      enforceResultBudget(query, output);
      await authorizeQueryOutputCapabilities(options, query, identity, output);
      const inputKey = queryInputKey(input);
      const cursorPayload: CursorPayload = {
        version: receipt ? 3 : 2,
        query: query.id,
        inputKey,
        contextBinding: cursorBinding(options.cursorSecret, 'context', applicationAdmittedContextDigest(identity.admittedContext)),
        authorizationBinding: cursorBinding(options.cursorSecret, 'authorization', identity.principal.authorityRevision),
        ...(receipt ? receiptCursorFields(options.cursorSecret, receipt) : {}),
        sequence: result.sequence,
        ...(providerSnapshot ? { providerRevision: providerSnapshot.revision } : {}),
        expiresAt: now().getTime() + cursorTtlSeconds * 1_000,
      };
      const cursor = await cursorCodec.sign(cursorPayload, {
        expiresAt: cursorPayload.expiresAt,
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
      const identity = await admittedIdentity(options, request, query, input, 'subscribe');
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
        cursor = await decodeCursor(cursorCodec, options.cursorSecret, encoded, {
          query: query.id,
          inputKey: queryInputKey(input),
          contextDigest: applicationAdmittedContextDigest(identity.admittedContext),
          authorizationVersion: identity.principal.authorityRevision,
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
        const currentIdentity = await admittedIdentity(options, request, query, input, 'subscribe');
        const currentReceipt = await authorizeQueryOperation(options, 'subscription-resume', query, input, currentIdentity);
        if (currentIdentity.principal.authorityRevision !== identity.principal.authorityRevision
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
          const nextCursor = await cursorCodec.sign(cursor, {
            expiresAt: cursor.expiresAt,
          });
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
          yield { kind: 'keepalive', protocol: 'applik8s.query/v1alpha1', id: `${query.id}:heartbeat:${now().getTime()}`, sequence: cursor.sequence, query: query.id, cursor: await cursorCodec.sign(cursor, { expiresAt: cursor.expiresAt }) };
          lastHeartbeat = now().getTime();
        }
        await sleep(pollIntervalMs, subscribeOptions.signal);
      }
      } finally {
        limiter.release(identity.principal.id);
        options.audit?.({ event: 'subscription-closed', query: query.id, principal: identity.principal.id });
      }
    },
    async invoke(request) {
      const query = requiredQuery(queries, request.query);
      const input = validateQueryInput(query, request.input);
      return runApplicationTelemetryBoundary({
        kind: 'query',
        identity: query.id,
        definition: 'invoke',
        relationship: 'synchronous',
      }, async () => {
      // typecast-boundary: the internal handler has already validated the
      // canonical principal; generated query bindings use that common
      // principal contract rather than transport-specific credential shapes.
      const principal =
        request.invocation.admission.principal as TPrincipal;
      const trustedContext = request.invocation.admission.trustedContext;
      const admittedContext: ApplicationAdmittedContext = {
        values: applicationRequestContextValues(
          principal,
          principal.authorityRevision,
          trustedContext,
        ),
        digestSecret: options.cursorSecret,
      };
      if (!await query.authorize(principal, input, admittedContext.values)) {
        options.audit?.({
          event: 'authorization-denied',
          query: query.id,
          principal: principal.id,
        });
        throw new ApplicationQueryAuthorizationError(query.id);
      }
      if (!query.database) {
        throw new Error(
          `Application query ${query.id} has no snapshot authority.`,
        );
      }
      const identity: ApplicationGatewayIdentity<TPrincipal> = {
        principal,
        admittedContext,
        admission: applicationAdmissionInvocationView(request.invocation.context),
      };
      const context = options.context(identity);
      const result = await withTimeout(
        executeAdmittedQuery(options, {
          query,
          identity,
          authorizationReceipt: request.invocation.authorizationReceipt,
          operation: 'invoke',
        }, () => context.snapshot(query.database!, async () => {
          if (!query.sourceRuntime) {
            return query.run(context, principal, input);
          }
          return query.sourceRuntime.snapshot(async (source) =>
            query.run(context, principal, input, source),
          );
        })),
        query.budgets.timeoutMs,
        `Application query ${query.id} exceeded its ${query.budgets.timeoutMs}ms execution budget.`,
      );
      const providerSnapshot = query.sourceRuntime
        ? result.value as { readonly value: unknown }
        : undefined;
      const output = validateQueryOutput(
        query,
        providerSnapshot?.value ?? result.value,
      );
      enforceResultBudget(query, output);
      await authorizeQueryOutputCapabilities(options, query, identity, output);
      return jsonValue(output);
      });
    },
  };
}

async function executeAdmittedQuery<
  TRequest,
  TPrincipal extends ApplicationQueryPrincipal,
  T,
>(
  options: ApplicationQueryGatewayOptions<TRequest, TPrincipal>,
  request: {
    readonly query: ApplicationQueryBinding<unknown, unknown, TPrincipal>;
    readonly identity: ApplicationGatewayIdentity<TPrincipal>;
    readonly authorizationReceipt?: ApplicationAuthorizationReceipt;
    readonly operation: 'snapshot' | 'invoke';
  },
  run: () => Promise<T>,
): Promise<T> {
  return options.execute ? options.execute(request, run) : run();
}

async function authorizeQueryOutputCapabilities<
  TRequest,
  TPrincipal extends ApplicationQueryPrincipal,
>(
  options: ApplicationQueryGatewayOptions<TRequest, TPrincipal>,
  query: ApplicationQueryBinding<unknown, unknown, TPrincipal>,
  identity: ApplicationGatewayIdentity<TPrincipal>,
  output: unknown,
): Promise<void> {
  const capabilities = applicationQuerySignalCapabilities(output);
  if (capabilities.length === 0) return;
  if (!options.authorizeOutputCapability) {
    throw new ApplicationQueryAuthorizationError(query.id);
  }
  for (const capability of capabilities) {
    if (!await options.authorizeOutputCapability({
      query,
      identity,
      capability,
    })) {
      options.audit?.({
        event: 'authorization-denied',
        query: query.id,
        principal: identity.principal.id,
        reason: 'output-capability',
      });
      throw new ApplicationQueryAuthorizationError(query.id);
    }
  }
}

function applicationQuerySignalCapabilities(
  output: unknown,
): readonly ApplicationQuerySignalCapability[] {
  const capabilities = new Map<string, ApplicationQuerySignalCapability>();
  const pending: unknown[] = [output];
  const seen = new Set<object>();
  let visited = 0;
  while (pending.length > 0) {
    const value = pending.pop();
    visited += 1;
    if (visited > 100_000) {
      throw new Error(
        'Application query output capability scan exceeded its bounded node budget.',
      );
    }
    if (!value || typeof value !== 'object') continue;
    if (seen.has(value)) continue;
    seen.add(value);
    if (Array.isArray(value)) {
      pending.push(...value);
      continue;
    }
    const candidate = signalCapability(value);
    if (candidate) {
      capabilities.set(
        `${candidate.contract.id}\0${candidate.issuance.id}`,
        candidate,
      );
      continue;
    }
    pending.push(...Object.values(value));
  }
  return [...capabilities.values()];
}

function signalCapability(
  value: object,
): ApplicationQuerySignalCapability | undefined {
  if (Reflect.get(value, '$type') !== 'applik8s.signal/v1') return undefined;
  const contract = Reflect.get(value, 'contract');
  const issuance = Reflect.get(value, 'issuance');
  const expiresAt = Reflect.get(value, 'expiresAt');
  const contractId = contract && typeof contract === 'object'
    ? Reflect.get(contract, 'id')
    : undefined;
  const contractName = contract && typeof contract === 'object'
    ? Reflect.get(contract, 'name')
    : undefined;
  const contractVersion = contract && typeof contract === 'object'
    ? Reflect.get(contract, 'version')
    : undefined;
  const issuanceId = issuance && typeof issuance === 'object'
    ? Reflect.get(issuance, 'id')
    : undefined;
  if (
    !contract
    || typeof contract !== 'object'
    || !issuance
    || typeof issuance !== 'object'
    || typeof contractId !== 'string'
    || typeof contractName !== 'string'
    || typeof contractVersion !== 'string'
    || typeof issuanceId !== 'string'
    || typeof expiresAt !== 'string'
  ) {
    throw new Error(
      'Application query returned a malformed reserved signal capability.',
    );
  }
  return {
    kind: 'signalReference',
    contract: {
      id: contractId,
      name: contractName,
      version: contractVersion,
    },
    issuance: { id: issuanceId },
    expiresAt,
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

function jsonValue(value: unknown): JsonValue {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, jsonValue(item)]),
    );
  }
  throw new Error('Application query result is not JSON serializable.');
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
    let query: string | undefined;
    let operation: string | undefined;
    try {
      if (request.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
      const url = new URL(request.url);
      if (!url.pathname.startsWith(basePath)) return jsonResponse({ error: 'not_found' }, 404);
      const tail = url.pathname.slice(basePath.length).split('/').filter(Boolean);
      const multiplex = tail.length === 1 && tail[0] === 'multiplex';
      query = tail[0] ? decodeURIComponent(tail[0]) : undefined;
      operation = tail[1];
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
      if (operation === 'snapshot') {
        return await runApplicationTelemetryBoundary({
          kind: 'query', identity: query, definition: 'snapshot', relationship: 'synchronous',
        }, async () => jsonResponse(await gateway.snapshot(request, query!, body.input), 200));
      }
      const cursor = Reflect.get(body, 'cursor');
      if (typeof cursor !== 'string') return jsonResponse({ error: 'missing_cursor' }, 400);
      const iterator = gateway.subscribe(request, query, body.input, cursor, { signal: request.signal })[Symbol.asyncIterator]();
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            await runApplicationTelemetryBoundary({
              kind: 'query', identity: query!, definition: 'subscribe', relationship: 'synchronous',
            }, async () => {
              while (true) {
                const next = await iterator.next();
                if (next.done) break;
                controller.enqueue(encoder.encode(`event: ${next.value.kind}\ndata: ${JSON.stringify(next.value)}\n\n`));
              }
            });
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
      options.onError?.(error, {
        ...(query ? { query } : {}),
        ...(operation === 'snapshot' || operation === 'subscribe' ? { operation } : {}),
      });
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
          await runApplicationTelemetryBoundary({
            kind: 'query', identity: subscription.query, definition: 'subscribe', relationship: 'synchronous',
          }, async () => {
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
          });
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

async function admittedIdentity<TRequest, TPrincipal extends ApplicationQueryPrincipal>(
  options: ApplicationQueryGatewayOptions<TRequest, TPrincipal>,
  request: TRequest,
  query: ApplicationQueryBinding<unknown, unknown, TPrincipal>,
  input: unknown,
  action: 'snapshot' | 'subscribe',
): Promise<ApplicationGatewayIdentity<TPrincipal>> {
  try {
    const identity = await options.authenticate(request, query, input);
    const traceparent = request instanceof Request
      ? request.headers.get('traceparent') ?? undefined
      : undefined;
    const tracestate = request instanceof Request
      ? request.headers.get('tracestate') ?? undefined
      : undefined;
    const admission = createApplicationRequestAdmissionContextV1({
      admission: {
        principal: identity.principal,
        // typecast-boundary: the canonical admission constructor validates every
        // value before exposing the normalized context.
        trustedContext: identity.admittedContext.values as Readonly<Record<string, JsonValue>>,
      },
      operation: {
        id: `applik8s://queries/${query.id}/${action}`,
        transport: 'http',
      },
      correlationId: request instanceof Request
        ? request.headers.get('x-request-id')?.trim() || randomUUID()
        : randomUUID(),
      ...(traceparent
        ? { trace: { traceparent, ...(tracestate ? { tracestate } : {}) } }
        : {}),
    });
    for (const context of query.trustedContext) {
      const value = admission.trustedContext.values[context.name];
      if (value === undefined) throw new Error(`Application query ${query.id} requires trusted context ${context.name}, but the identity/application provider did not establish it.`);
      validateTrustedContextValue(context, value);
    }
    await deliverApplicationAdmissionObservationV1(options.observeAdmission, {
      state: 'admitted',
      boundary: 'request',
      admission,
    });
    return {
      ...identity,
      // typecast-boundary: validation above preserves the caller's principal
      // subtype while normalizing it through the canonical admission contract.
      principal: admission.principal as TPrincipal,
      admittedContext: {
        ...identity.admittedContext,
        values: admission.trustedContext.values,
      },
      admission: applicationAdmissionInvocationView(admission),
    };
  } catch (error) {
    await deliverApplicationAdmissionObservationV1(options.observeAdmission, {
      state: 'rejected',
      boundary: 'request',
      transport: 'http',
      rejectionCode: applicationAdmissionRejectionCodeV1(error),
    });
    throw error;
  }
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

async function decodeCursor(
  codec: RollingSignedEnvelopeCodec<CursorPayload>,
  secret: string,
  cursor: string,
  expected: {
  readonly query: string;
  readonly inputKey: string;
  readonly contextDigest: string;
  readonly authorizationVersion: string;
  readonly now: number;
  readonly receipt?: ApplicationAuthorizationReceipt;
  },
): Promise<CursorPayload> {
  let payload: CursorPayload;
  try {
    payload = await codec.verify(cursor);
  } catch {
    throw new CursorValidationError('cursorInvalid');
  }
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

function validateCursorPayload(value: JsonValue): CursorPayload {
  if (!isJsonObject(value)) {
    throw new TypeError('Query cursor payload is invalid.');
  }
  if (
    (value.version !== 2 && value.version !== 3)
    || typeof value.query !== 'string'
    || typeof value.inputKey !== 'string'
    || !Number.isSafeInteger(value.sequence)
    || Number(value.sequence) < 0
    || !opaqueCursorField(value.contextBinding)
    || !opaqueCursorField(value.authorizationBinding)
    || !Number.isSafeInteger(value.expiresAt)
    || Number(value.expiresAt) < 0
  ) {
    throw new TypeError('Query cursor contract is invalid.');
  }
  if (value.providerRevision !== undefined && (
    typeof value.providerRevision !== 'string'
    || value.providerRevision.length < 1
    || value.providerRevision.length > 512
  )) {
    throw new TypeError('Query cursor provider revision is invalid.');
  }
  const optionalStrings = [
    'applicationBinding',
    'principalBinding',
    'operationId',
    'operationVersion',
    'catalogRevision',
    'authorityRevision',
    'receiptId',
  ] as const;
  for (const field of optionalStrings) {
    if (value[field] !== undefined && typeof value[field] !== 'string') {
      throw new TypeError(`Query cursor ${field} is invalid.`);
    }
  }
  return value as unknown as CursorPayload;
}

function isJsonObject(value: JsonValue): value is Readonly<Record<string, JsonValue>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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

function cursorBinding(secret: string, domain: 'application' | 'authorization' | 'context' | 'principal', value: string): string {
  return nodeKeyedDigestBase64Url({
    key: secret,
    purpose: `applik8s.query-cursor.${domain}`,
    value,
  });
}
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
