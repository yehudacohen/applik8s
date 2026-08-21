// typecast-file-boundary: Task-query HTTP payloads are validated against signed admission and declared schemas before generic conversion.
import { queryInputKey } from '@applik8s/client';
import {
  type ApplicationIdentityReference,
  type ApplicationPrincipal,
  canonicalJsonCompatibleV1Policy,
  canonicalJsonV1String,
  canonicalJsonV1Value,
  type JsonObject,
  SignedEnvelopeV1ValidationError,
} from '@applik8s/core';
import {
  createSignedEnvelopeCodec,
  SignedEnvelopeRuntimeError,
  signedEnvelopeUtf8Key,
  signLegacyCompactHmacJsonForRollingMigration,
  staticSignedEnvelopeKeyProvider,
  verifyLegacyCompactHmacJson,
} from '@applik8s/runtime/signed-envelope';
import { normalizeSchema } from '@applik8s/sdk/schema-runtime';
import type { ApplicationTaskServicePrincipal } from './application-workflows.js';

const protocol = 'applik8s.task-query/v1alpha1';
const defaultTimeoutMs = 5_000;
const maximumTokenLifetimeMs = 60_000;
const maximumTokenBytes = 32 * 1_024;
const maximumEncodedTokenBytes = 64 * 1_024;
const tokenPurpose = 'applik8s.task-query-admission/v1';

export interface ApplicationTaskQueryRuntimeContract {
  readonly id: string;
  readonly audience: string;
  readonly endpoint: string;
  readonly inputSchema: JsonObject;
  readonly outputSchema: JsonObject;
  readonly timeoutMs: number;
  readonly maxResultBytes: number;
}

export interface ApplicationTaskQueryRuntime {
  bind(
    aliases: Readonly<Record<string, string>>,
    principal: ApplicationTaskServicePrincipal | undefined,
    metadata?: { readonly correlationId?: string; readonly causationId?: string; readonly traceparent?: string },
  ): Readonly<Record<string, (input?: object, options?: { readonly signal?: AbortSignal; readonly timeoutMs?: number }) => Promise<unknown>>>;
}

interface ApplicationTaskQueryToken {
  readonly protocol: typeof protocol;
  readonly audience: string;
  readonly query: string;
  readonly operation: 'snapshot';
  readonly inputKey: string;
  readonly principal: {
    readonly id: string;
    readonly identity?: ApplicationIdentityReference;
    readonly kind?: ApplicationPrincipal['kind'];
    readonly authenticationMethod?: string;
    readonly roles?: readonly string[];
    readonly attributes?: Readonly<Record<string, unknown>>;
  };
  readonly authorizationVersion: string;
  readonly trustedContext: Readonly<Record<string, unknown>>;
  readonly expiresAt: number;
}

export function createApplicationTaskQueryRuntime(options: {
  readonly queries: readonly ApplicationTaskQueryRuntimeContract[];
  readonly cursorSecret: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => Date;
}): ApplicationTaskQueryRuntime {
  assertSecret(options.cursorSecret);
  const now = options.now ?? (() => new Date());
  const request = options.fetch ?? globalThis.fetch;
  const queries = new Map(options.queries.map((query) => {
    if (!query.id || !query.audience || !/^https?:\/\//.test(query.endpoint)) throw new Error(`applik8s-task-query-contract-invalid: ${query.id || '<unnamed>'}`);
    if (!Number.isSafeInteger(query.timeoutMs) || query.timeoutMs < 1 || !Number.isSafeInteger(query.maxResultBytes) || query.maxResultBytes < 1) throw new Error(`applik8s-task-query-bounds-invalid: ${query.id}`);
    return [query.id, {
      ...query,
      input: runtimeSchema(query.inputSchema, `${query.id}.input`),
      emptyObjectInput: isEmptyObjectInputSchema(query.inputSchema),
      output: runtimeSchema(query.outputSchema, `${query.id}.output`),
    }] as const;
  }));
  if (queries.size !== options.queries.length) throw new Error('applik8s-task-query-contract-duplicate');
  return {
    bind(aliases, principal, metadata = {}) {
      if (Object.keys(aliases).length === 0) return Object.freeze({});
      const admitted = requiredServicePrincipal(principal);
      return Object.freeze(Object.fromEntries(Object.entries(aliases).map(([alias, queryId]) => {
        const contract = queries.get(queryId);
        if (!contract) throw new Error(`applik8s-task-query-undeclared: ${alias}`);
        return [alias, async (rawInput?: object, invokeOptions: { readonly signal?: AbortSignal; readonly timeoutMs?: number } = {}) => {
          const input = validate(
            contract.input,
            rawInput === undefined && contract.emptyObjectInput ? {} : rawInput,
            `${contract.id}.input`,
          );
          const timeoutMs = boundedTimeout(invokeOptions.timeoutMs ?? contract.timeoutMs);
          const issuedAt = now().getTime();
          const token = await encodeToken(options.cursorSecret, {
            protocol,
            audience: contract.audience,
            query: contract.id,
            operation: 'snapshot',
            inputKey: queryInputKey(input),
            principal: {
              id: admitted.id,
              ...(admitted.identity ? { identity: admitted.identity } : {}),
              ...(admitted.kind ? { kind: admitted.kind } : {}),
              ...(admitted.authenticationMethod
                ? { authenticationMethod: admitted.authenticationMethod }
                : {}),
              ...(admitted.roles ? { roles: admitted.roles } : {}),
              ...(admitted.attributes ? { attributes: admitted.attributes } : {}),
            },
            authorizationVersion: admitted.authorizationVersion,
            trustedContext: admitted.trustedContext ?? {},
            expiresAt: issuedAt + Math.min(timeoutMs + 5_000, maximumTokenLifetimeMs),
          });
          const response = await request(contract.endpoint, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-applik8s-task-query': token,
              ...(metadata.correlationId ? { 'x-applik8s-correlation-id': metadata.correlationId } : {}),
              ...(metadata.causationId ? { 'x-applik8s-causation-id': metadata.causationId } : {}),
              ...(metadata.traceparent ? { traceparent: metadata.traceparent } : {}),
            },
            body: JSON.stringify({ input }),
            signal: combinedSignal(invokeOptions.signal, timeoutMs),
          });
          const text = await boundedResponseText(response, contract.maxResultBytes + 64 * 1_024);
          if (!response.ok) throw new Error(`applik8s-task-query-failed: ${contract.id} returned ${response.status}: ${text.slice(0, 512)}`);
          let snapshot: unknown;
          try { snapshot = JSON.parse(text); }
          catch (cause) { throw new Error(`applik8s-task-query-response-invalid: ${contract.id}`, { cause }); }
          if (!snapshot || typeof snapshot !== 'object' || Reflect.get(snapshot, 'protocol') !== 'applik8s.query/v1alpha1' || Reflect.get(snapshot, 'kind') !== 'snapshot' || Reflect.get(snapshot, 'query') !== contract.id) {
            throw new Error(`applik8s-task-query-response-invalid: ${contract.id}`);
          }
          return validate(contract.output, Reflect.get(snapshot, 'value'), `${contract.id}.output`);
        }];
      })));
    },
  };
}

/** Verifies the compiler-owned service principal before application authentication runs. */
export async function verifyApplicationTaskQueryAdmission(options: {
  readonly request: Request;
  readonly cursorSecret: string;
  readonly audience: string;
  readonly query: string;
  readonly input: unknown;
  readonly now?: Date;
}): Promise<{
  readonly principal: {
    readonly id: string;
    readonly identity?: ApplicationIdentityReference;
    readonly kind?: ApplicationPrincipal['kind'];
    readonly authenticationMethod?: string;
    readonly roles?: readonly string[];
    readonly attributes?: Readonly<Record<string, unknown>>;
  };
  readonly authorizationVersion: string;
  readonly trustedContext: Readonly<Record<string, unknown>>;
} | undefined> {
  assertSecret(options.cursorSecret);
  const encoded = options.request.headers.get('x-applik8s-task-query');
  if (!encoded) return undefined;
  const timestamp = (options.now ?? new Date()).getTime();
  const token = await decodeToken(options.cursorSecret, encoded, timestamp);
  if (!token || token.audience !== options.audience || token.query !== options.query || token.operation !== 'snapshot' || token.inputKey !== queryInputKey(options.input) || token.expiresAt <= timestamp || token.expiresAt > timestamp + maximumTokenLifetimeMs) return undefined;
  try {
    if (!new URL(options.request.url).pathname.endsWith('/snapshot')) return undefined;
  } catch {
    return undefined;
  }
  if (!token.principal.id || !token.authorizationVersion) return undefined;
  return {
    principal: token.principal,
    authorizationVersion: token.authorizationVersion,
    trustedContext: token.trustedContext,
  };
}

async function encodeToken(
  secret: string,
  token: ApplicationTaskQueryToken,
): Promise<string> {
  const payload = canonicalJsonV1Value(
    token,
    canonicalJsonCompatibleV1Policy,
  );
  if (new TextEncoder().encode(canonicalJsonV1String(payload)).byteLength > maximumTokenBytes) {
    throw new Error('applik8s-task-query-principal-too-large');
  }
  return signLegacyCompactHmacJsonForRollingMigration(payload, {
    key: signedEnvelopeUtf8Key(secret),
    maximumEncodedBytes: maximumEncodedTokenBytes,
  });
}

async function decodeToken(
  secret: string,
  encoded: string,
  now: number,
): Promise<ApplicationTaskQueryToken | undefined> {
  try {
    const envelope = await taskQueryTokenCodec(secret, now).verify(encoded);
    return validateTaskQueryToken(envelope.payload);
  } catch (cause) {
    const legacyCandidate = (
      cause instanceof SignedEnvelopeV1ValidationError
      && cause.code === 'SIGNED_ENVELOPE_VERSION_INVALID'
    ) || (
      cause instanceof SignedEnvelopeRuntimeError
      && cause.code === 'SIGNED_ENVELOPE_MALFORMED'
    );
    if (!legacyCandidate) return undefined;
  }
  try {
    const value = await verifyLegacyCompactHmacJson(encoded, {
      key: signedEnvelopeUtf8Key(secret),
      maximumEncodedBytes: maximumEncodedTokenBytes,
      validatePayload(value) {
        validateTaskQueryToken(value);
        return value;
      },
    });
    return validateTaskQueryToken(value);
  } catch {
    return undefined;
  }
}

function taskQueryTokenCodec(secret: string, now: number) {
  return createSignedEnvelopeCodec({
    purpose: tokenPurpose,
    keys: staticSignedEnvelopeKeyProvider({
      current: { id: 'task-query-current', key: signedEnvelopeUtf8Key(secret) },
    }),
    now: () => now,
    maximumLifetimeMs: maximumTokenLifetimeMs,
    maximumEncodedBytes: maximumEncodedTokenBytes,
    validatePayload(value) {
      validateTaskQueryToken(value);
      return value;
    },
  });
}

function validateTaskQueryToken(value: unknown): ApplicationTaskQueryToken {
  if (!value || typeof value !== 'object' || Reflect.get(value, 'protocol') !== protocol) {
    throw new TypeError('Task query token protocol is invalid.');
  }
  const principal = Reflect.get(value, 'principal');
  const trustedContext = Reflect.get(value, 'trustedContext');
  if (!principal || typeof principal !== 'object' || typeof Reflect.get(principal, 'id') !== 'string' || !trustedContext || typeof trustedContext !== 'object' || Array.isArray(trustedContext)) throw new TypeError('Task query token principal is invalid.');
  const identity = Reflect.get(principal, 'identity');
  if (identity !== undefined && (
    !identity
    || typeof identity !== 'object'
    || typeof Reflect.get(identity, 'id') !== 'string'
    || typeof Reflect.get(identity, 'kind') !== 'string'
    || typeof Reflect.get(identity, 'issuer') !== 'string'
    || typeof Reflect.get(identity, 'subject') !== 'string'
  )) throw new TypeError('Task query token identity is invalid.');
  const principalKind = Reflect.get(principal, 'kind');
  if (principalKind !== undefined && typeof principalKind !== 'string') throw new TypeError('Task query token principal kind is invalid.');
  const authenticationMethod = Reflect.get(principal, 'authenticationMethod');
  if (authenticationMethod !== undefined && typeof authenticationMethod !== 'string') throw new TypeError('Task query token authentication method is invalid.');
  if (typeof Reflect.get(value, 'audience') !== 'string' || typeof Reflect.get(value, 'query') !== 'string' || Reflect.get(value, 'operation') !== 'snapshot' || typeof Reflect.get(value, 'inputKey') !== 'string' || typeof Reflect.get(value, 'authorizationVersion') !== 'string' || typeof Reflect.get(value, 'expiresAt') !== 'number') throw new TypeError('Task query token contract is invalid.');
  return value as ApplicationTaskQueryToken;
}

function requiredServicePrincipal(principal: ApplicationTaskServicePrincipal | undefined): ApplicationTaskServicePrincipal {
  if (!principal?.id?.trim() || !principal.authorizationVersion?.trim()) throw new Error('applik8s-task-query-principal-invalid');
  return principal;
}

function validate<T extends object>(schema: ReturnType<typeof normalizeSchema<T>>, value: unknown, label: string): T {
  const result = schema.validate(value as never);
  if (!result.ok) throw new Error(`applik8s-task-query-schema-invalid: ${label}: ${result.error.message}`);
  return result.value;
}

function runtimeSchema(schema: JsonObject, name: string) {
  return normalizeSchema<object>({ kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: name }, schema }, name);
}

function isEmptyObjectInputSchema(schema: JsonObject): boolean {
  if (schema.type !== 'object') return false;
  const properties = schema.properties;
  const required = schema.required;
  return (!properties || (typeof properties === 'object' && !Array.isArray(properties) && Object.keys(properties).length === 0))
    && (!Array.isArray(required) || required.length === 0);
}

function boundedTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 60_000) throw new Error('applik8s-task-query-timeout-invalid');
  return value;
}

function combinedSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs || defaultTimeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function boundedResponseText(response: Response, maximumBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > maximumBytes) throw new Error(`applik8s-task-query-response-too-large: ${declared}`);
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel('applik8s-task-query-response-too-large');
        throw new Error(`applik8s-task-query-response-too-large: ${bytes}`);
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function assertSecret(secret: string): void {
  if (secret.length < 32) throw new Error('applik8s-task-query-secret-invalid');
}
