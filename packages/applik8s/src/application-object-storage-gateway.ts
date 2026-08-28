// typecast-file-boundary: HTTP and object-store payloads are validated before conversion at this protocol adapter boundary.
import { createHash, randomUUID } from 'node:crypto';
import { canonicalJsonV1Value, createApplicationRequestAdmissionContextV1, type JsonValue } from '@applik8s/core';
import {
  applicationAdmissionRejectionCodeV1,
  deliverApplicationAdmissionObservationV1,
  type ApplicationAdmissionObserverV1,
} from '@applik8s/core/admission';
import { nodeKeyedDigestHex } from '@applik8s/runtime/node-integrity';
import { createRollingSignedEnvelopeCodec, type RollingSignedEnvelopeCodec, signedEnvelopeUtf8Key, staticSignedEnvelopeKeyProvider } from '@applik8s/runtime/signed-envelope';
import type { ApplicationObjectStorageRuntime, ApplicationSignedObjectIntent, ApplicationVerifiedObjectCompletion } from './application-object-storage.js';
import type { ApplicationIdentityProvider, ApplicationRequestAdmission } from './application-providers.js';
import { observeApplicationRuntimeIntegrityEnvelope } from './application-telemetry-runtime.js';

export interface ApplicationObjectStoreGatewayBinding {
  readonly name: string;
  readonly enabled?: boolean;
  readonly mode: 'immutable' | 'mutable';
  readonly maxObjectBytes: number;
  readonly contentTypes: readonly string[];
  readonly browser: {
    readonly upload: 'none' | 'signed';
    readonly download: 'none' | 'signed';
    readonly downloadAccess: 'owner' | 'authenticated';
    readonly ttlSeconds: number;
  };
  readonly runtime: ApplicationObjectStorageRuntime;
}

export interface ApplicationObjectStorageGatewayOptions {
  readonly identity: ApplicationIdentityProvider;
  readonly cursorSecret: string;
  readonly stores: readonly ApplicationObjectStoreGatewayBinding[];
  readonly basePath?: string;
  readonly now?: () => Date;
  readonly id?: () => string;
  /** Framework-owned bounded evidence sink; failures never alter object operations. */
  readonly observeAdmission?: ApplicationAdmissionObserverV1;
}

export interface ApplicationObjectStorageGateway {
  handle(request: Request): Promise<Response | undefined>;
}

interface ObjectIntentToken {
  readonly protocol: 'applik8s.object-intent/v1alpha1';
  readonly action: 'upload' | 'complete' | 'download';
  readonly store: string;
  readonly key: string;
  readonly principalScope: string;
  readonly admissionScope: string;
  readonly expiresAt: number;
  readonly contentType?: string;
  readonly size?: number;
  readonly sha256?: string;
}

export interface ApplicationObjectCompletionReceiptVerification {
  readonly receipt: string;
  readonly secret: string;
  readonly principalId: string;
  readonly authorizationVersion: string;
  readonly store: string;
  readonly objectId: string;
  readonly key: string;
  readonly contentType: string;
  readonly size: number;
  readonly sha256: string;
  readonly now?: Date;
}

/**
 * Verifies that a durable mutation describes the exact provider-authoritative
 * object completed by the same admitted principal. The proof is deliberately
 * short-lived and is not an object-store credential.
 */
export async function verifyApplicationObjectCompletionReceipt(options: ApplicationObjectCompletionReceiptVerification): Promise<boolean> {
  if (options.secret.length < 32 || !options.principalId || !options.authorizationVersion) return false;
  const currentTime = (options.now ?? new Date()).getTime();
  const token = await decodeObjectIntentToken(
    objectIntentCodec(options.secret, () => currentTime, 24 * 60 * 60),
    options.receipt,
  );
  if (token?.action !== 'complete' || token.expiresAt <= currentTime) return false;
  const contentType = options.contentType.trim().toLowerCase();
  const sha256 = options.sha256.trim().replace(/^sha256:/i, '').toLowerCase();
  return token.store === options.store
    && token.key === options.key
    && objectIdForKey(token.key) === options.objectId
    && token.principalScope === principalObjectScope(options.secret, options.principalId)
    && token.admissionScope === admittedObjectScope(options.secret, options.principalId, options.authorizationVersion)
    && token.contentType === contentType
    && token.size === options.size
    && token.sha256 === sha256;
}

/** Authenticated, bounded same-origin bridge for browser object operations. */
export function createApplicationObjectStorageGateway(options: ApplicationObjectStorageGatewayOptions): ApplicationObjectStorageGateway {
  if (options.cursorSecret.length < 32) throw new Error('Application object gateway cursorSecret must contain at least 32 characters.');
  const basePath = normalizeBasePath(options.basePath ?? '/__applik8s/v1');
  const now = options.now ?? (() => new Date());
  const id = options.id ?? randomUUID;
  const stores = new Map(options.stores.map((store) => {
    if (!/^[a-z][a-z0-9-]*$/.test(store.name)) throw new Error(`Application object gateway store ${JSON.stringify(store.name)} must be a lowercase DNS-style identifier.`);
    if (!Number.isSafeInteger(store.maxObjectBytes) || store.maxObjectBytes < 1) throw new Error(`Application object gateway store ${store.name} has an invalid object-size bound.`);
    if (!Number.isSafeInteger(store.browser.ttlSeconds) || store.browser.ttlSeconds < 30 || store.browser.ttlSeconds > 24 * 60 * 60) {
      throw new Error(`Application object gateway store ${store.name} browser intent lifetime must be between 30 seconds and 24 hours.`);
    }
    return [store.name, store] as const;
  }));
  if (stores.size !== options.stores.length) throw new Error('Application object gateway store names must be unique.');
  const intentCodec = objectIntentCodec(
    options.cursorSecret,
    () => now().getTime(),
    Math.max(...options.stores.map((store) => store.browser.ttlSeconds), 30),
  );

  return {
    async handle(request) {
      const url = new URL(request.url);
      if (!url.pathname.startsWith(`${basePath}/`)) return undefined;
      const path = url.pathname.slice(basePath.length).split('/').filter(Boolean).map(decodeURIComponent);
      if (path[0] === 'runtime' && path.length === 2) return runtimeOperation(request, path[1] ?? '');
      if (path[0] === 'objects' && path.length === 3 && (path[2] === 'upload' || path[2] === 'download')) {
        return transfer(request, path[1] ?? '', path[2], url.searchParams.get('token') ?? '');
      }
      return undefined;
    },
  };

  async function runtimeOperation(request: Request, operation: string): Promise<Response | undefined> {
    const parsed = /^objectStore\.([a-z][a-z0-9-]*)\.(createUpload|completeUpload|createDownload)$/.exec(operation);
    if (!parsed?.[1] || !parsed[2]) return undefined;
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
    const store = stores.get(parsed[1]);
    if (!store) return json({ error: 'not_found' }, 404);
    if (store.enabled === false) return json({ error: 'object_store_not_configured', store: store.name }, 503);
    const admission = await authenticate(request, `applik8s://objects/${store.name}/${parsed[2]}`);
    if (admission instanceof Response) return admission;
    const body = await readJsonObject(request, 64 * 1024).catch((error) => error instanceof Error ? error : new Error(String(error)));
    if (body instanceof Error) return json({ error: 'invalid_request', message: body.message }, 400);
    const input = objectValue(body.input);
    try {
      if (parsed[2] === 'createUpload') {
        if (store.browser.upload !== 'signed') return json({ error: 'upload_not_allowed', store: store.name }, 403);
        const contentType = allowedContentType(store, input.contentType);
        const size = boundedSize(store, input.size);
        const sha256 = requiredSha256(input.sha256);
        const principalScope = scopeForPrincipal(admission.principal.id);
        const key = `${principalScope}/${id()}`;
        const expiresAt = now().getTime() + store.browser.ttlSeconds * 1_000;
        const token = await signToken({
          protocol: 'applik8s.object-intent/v1alpha1', action: 'upload', store: store.name, key,
          principalScope, admissionScope: admittedScope(admission), expiresAt, contentType, size, sha256,
        });
        const intent: ApplicationSignedObjectIntent = {
          method: 'PUT',
          url: new URL(`${basePath}/objects/${encodeURIComponent(store.name)}/upload?token=${encodeURIComponent(token)}`, request.url).href,
          expiresAt: new Date(expiresAt).toISOString(),
          headers: { 'content-type': contentType, 'x-applik8s-content-sha256': sha256 },
          object: { store: store.name, key },
        };
        return runtimeResult(operation, intent);
      }
      if (parsed[2] === 'completeUpload') {
        const key = ownedKey(admission, input.key);
        const expected = {
          contentType: allowedContentType(store, input.contentType),
          size: boundedSize(store, input.size),
          sha256: requiredSha256(input.sha256),
        };
        const metadata = await store.runtime.head(key);
        if (!metadata) return json({ error: 'object_not_found', store: store.name, key }, 404);
        if (metadata.contentType.toLowerCase() !== expected.contentType || metadata.size !== expected.size || metadata.sha256.toLowerCase() !== expected.sha256) {
          await store.runtime.delete(key, metadata.version ? { ifVersion: metadata.version } : undefined).catch(() => undefined);
          return json({ error: 'object_integrity_mismatch', store: store.name, key }, 409);
        }
        const expiresAt = now().getTime() + store.browser.ttlSeconds * 1_000;
        const receipt = await signToken({
          protocol: 'applik8s.object-intent/v1alpha1', action: 'complete', store: store.name, key,
          principalScope: scopeForPrincipal(admission.principal.id),
          admissionScope: admittedScope(admission), expiresAt,
          contentType: metadata.contentType.toLowerCase(), size: metadata.size, sha256: metadata.sha256.toLowerCase(),
        });
        return runtimeResult(operation, {
          ...metadata,
          objectId: objectIdForKey(metadata.key),
          receipt,
        } satisfies ApplicationVerifiedObjectCompletion);
      }
      if (store.browser.download !== 'signed') return json({ error: 'download_not_allowed', store: store.name }, 403);
      const key = store.browser.downloadAccess === 'owner'
        ? ownedKey(admission, input.key)
        : safeKey(input.key);
      const metadata = await store.runtime.head(key);
      if (!metadata) return json({ error: 'object_not_found', store: store.name, key }, 404);
      const principalScope = scopeForPrincipal(admission.principal.id);
      const expiresAt = now().getTime() + store.browser.ttlSeconds * 1_000;
      const token = await signToken({
        protocol: 'applik8s.object-intent/v1alpha1', action: 'download', store: store.name, key,
        principalScope, admissionScope: admittedScope(admission), expiresAt,
      });
      return runtimeResult(operation, {
        method: 'GET',
        url: new URL(`${basePath}/objects/${encodeURIComponent(store.name)}/download?token=${encodeURIComponent(token)}`, request.url).href,
        expiresAt: new Date(expiresAt).toISOString(),
        headers: {},
        object: { store: store.name, key },
      } satisfies ApplicationSignedObjectIntent);
    } catch (error) {
      return objectFailure(store.name, error);
    }
  }

  async function transfer(request: Request, storeName: string, action: 'upload' | 'download', tokenValue: string): Promise<Response> {
    const store = stores.get(storeName);
    if (!store) return json({ error: 'not_found' }, 404);
    if (store.enabled === false) return json({ error: 'object_store_not_configured', store: store.name }, 503);
    if ((action === 'upload' && request.method !== 'PUT') || (action === 'download' && request.method !== 'GET')) {
      return json({ error: 'method_not_allowed' }, 405, { allow: action === 'upload' ? 'PUT' : 'GET' });
    }
    const admission = await authenticate(request, `applik8s://objects/${store.name}/${action}`);
    if (admission instanceof Response) return admission;
    const token = await verifyToken(tokenValue);
    if (!token || token.action !== action || token.store !== store.name || token.expiresAt <= now().getTime()
      || token.principalScope !== scopeForPrincipal(admission.principal.id) || token.admissionScope !== admittedScope(admission)) {
      return json({ error: 'object_intent_invalid' }, 401);
    }
    try {
      if (action === 'upload') {
        if (!token.contentType || token.size === undefined || !token.sha256) return json({ error: 'object_intent_invalid' }, 401);
        const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
        if (contentType !== token.contentType || request.headers.get('x-applik8s-content-sha256')?.trim().toLowerCase() !== token.sha256) {
          return json({ error: 'object_intent_headers_mismatch' }, 409);
        }
        const declaredLength = request.headers.get('content-length');
        if (declaredLength !== null && Number(declaredLength) !== token.size) return json({ error: 'object_size_mismatch' }, 409);
        const body = await readBoundedBody(request, Math.min(store.maxObjectBytes, token.size));
        if (body.byteLength !== token.size || createHash('sha256').update(body).digest('hex') !== token.sha256) {
          return json({ error: 'object_integrity_mismatch' }, 409);
        }
        const reference = await store.runtime.put({
          key: token.key, body, contentType: token.contentType, sha256: token.sha256,
          ...(store.mode === 'immutable' ? { ifAbsent: true } : {}),
        });
        return json(reference, 201);
      }
      const metadata = await store.runtime.head(token.key);
      if (!metadata) return json({ error: 'object_not_found' }, 404);
      const body = await store.runtime.get(token.key);
      if (!body) return json({ error: 'object_not_found' }, 404);
      return new Response(body as BodyInit, {
        status: 200,
        headers: {
          'content-type': metadata.contentType,
          'content-length': String(body.byteLength),
          'cache-control': store.mode === 'immutable' ? 'private, max-age=31536000, immutable' : 'private, no-cache',
          ...(metadata.etag ? { etag: `"${metadata.etag}"` } : {}),
        },
      });
    } catch (error) {
      return objectFailure(store.name, error);
    }
  }

  async function authenticate(request: Request, operationId: string): Promise<ApplicationRequestAdmission | Response> {
    try {
      const admission = await options.identity.authenticate(request);
      if (!admission?.principal?.id || !admission.principal.authorityRevision || !admission.trustedContext || typeof admission.trustedContext !== 'object') {
        throw new Error('Application object gateway identity admission is incomplete.');
      }
      const traceparent = request.headers.get('traceparent') ?? undefined;
      const tracestate = request.headers.get('tracestate') ?? undefined;
      const context = createApplicationRequestAdmissionContextV1({
        admission,
        operation: { id: operationId, transport: 'http' },
        correlationId: request.headers.get('x-request-id')?.trim() || id(),
        ...(traceparent ? { trace: { traceparent, ...(tracestate ? { tracestate } : {}) } } : {}),
      });
      await deliverApplicationAdmissionObservationV1(options.observeAdmission, {
        state: 'admitted',
        boundary: 'request',
        admission: context,
      });
      return {
        principal: context.principal,
        trustedContext: context.trustedContext.values,
      };
    } catch (error) {
      await deliverApplicationAdmissionObservationV1(options.observeAdmission, {
        state: 'rejected',
        boundary: 'request',
        transport: 'http',
        rejectionCode: applicationAdmissionRejectionCodeV1(error),
      });
      return json({ error: 'unauthorized' }, 401);
    }
  }

  function ownedKey(admission: ApplicationRequestAdmission, value: unknown): string {
    const key = safeKey(value);
    if (!key.startsWith(`${scopeForPrincipal(admission.principal.id)}/`)) {
      throw new ObjectRequestError('Object key is outside the authenticated principal scope.');
    }
    return key;
  }

  function safeKey(value: unknown): string {
    if (typeof value !== 'string' || !value || value.startsWith('/') || value.includes('..') || value.length > 1_024) {
      throw new ObjectRequestError('Object key is unsafe.');
    }
    return value;
  }

  function scopeForPrincipal(principalId: string): string {
    return principalObjectScope(options.cursorSecret, principalId);
  }

  function admittedScope(admission: ApplicationRequestAdmission): string {
    return admittedObjectScope(options.cursorSecret, admission.principal.id, admission.principal.authorityRevision);
  }

  function signToken(token: ObjectIntentToken): Promise<string> {
    return intentCodec.sign(token, { expiresAt: token.expiresAt });
  }

  function verifyToken(value: string): Promise<ObjectIntentToken | undefined> {
    return decodeObjectIntentToken(intentCodec, value);
  }
}

function principalObjectScope(secret: string, principalId: string): string {
  return nodeKeyedDigestHex({ key: secret, purpose: 'object-principal', value: principalId }).slice(0, 32);
}

function admittedObjectScope(secret: string, principalId: string, authorizationVersion: string): string {
  return nodeKeyedDigestHex({
    key: secret,
    purpose: 'object-admission',
    value: `${principalId}\0${authorizationVersion}`,
  });
}

function objectIdForKey(key: string): string {
  const objectId = key.split('/').at(-1);
  if (!objectId || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(objectId)) throw new ObjectRequestError('Object key has no safe logical identity.');
  return objectId;
}

function objectIntentCodec(
  secret: string,
  now: () => number,
  maximumLifetimeSeconds: number,
): RollingSignedEnvelopeCodec<ObjectIntentToken> {
  const key = signedEnvelopeUtf8Key(secret);
  return createRollingSignedEnvelopeCodec<ObjectIntentToken, ObjectIntentToken>({
    purpose: 'applik8s.object-intent/v1',
    keys: staticSignedEnvelopeKeyProvider({
      current: { id: 'object-intent-current', key },
    }),
    now,
    maximumLifetimeMs: maximumLifetimeSeconds * 1_000,
    maximumEncodedBytes: 64 * 1_024,
    validatePayload: validateObjectIntentToken,
    observe: observeApplicationRuntimeIntegrityEnvelope,
    writer: 'legacy',
    legacy: {
      key,
      validatePayload: validateObjectIntentToken,
      toCurrent: (payload) => payload,
      fromCurrent: (payload) => canonicalJsonV1Value(payload),
    },
  });
}

async function decodeObjectIntentToken(codec: RollingSignedEnvelopeCodec<ObjectIntentToken>, value: string): Promise<ObjectIntentToken | undefined> {
  try {
    return await codec.verify(value);
  } catch {
    return undefined;
  }
}

function validateObjectIntentToken(value: JsonValue): ObjectIntentToken {
  if (!isJsonObject(value)) throw new TypeError('Application object intent is invalid.');
  const action = value.action;
  if (!(value.protocol === 'applik8s.object-intent/v1alpha1'
    && (action === 'upload' || action === 'complete' || action === 'download')
    && typeof value.store === 'string'
    && typeof value.key === 'string'
    && typeof value.principalScope === 'string'
    && typeof value.admissionScope === 'string'
    && Number.isSafeInteger(value.expiresAt)
    && Number(value.expiresAt) >= 0
    && (value.contentType === undefined || typeof value.contentType === 'string')
    && (value.size === undefined || (Number.isSafeInteger(value.size) && Number(value.size) >= 0))
    && (value.sha256 === undefined || typeof value.sha256 === 'string'))) {
    throw new TypeError('Application object intent contract is invalid.');
  }
  return value as unknown as ObjectIntentToken;
}

function isJsonObject(value: JsonValue): value is Readonly<Record<string, JsonValue>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

class ObjectRequestError extends Error {}

function allowedContentType(store: ApplicationObjectStoreGatewayBinding, value: unknown): string {
  if (typeof value !== 'string') throw new ObjectRequestError('Object contentType must be a string.');
  const normalized = value.trim().toLowerCase();
  if (!store.contentTypes.includes(normalized)) throw new ObjectRequestError(`Object store ${store.name} does not allow content type ${JSON.stringify(value)}.`);
  return normalized;
}

function boundedSize(store: ApplicationObjectStoreGatewayBinding, value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > store.maxObjectBytes) {
    throw new ObjectRequestError(`Object store ${store.name} size must be between 1 and ${store.maxObjectBytes} bytes.`);
  }
  return value;
}

function requiredSha256(value: unknown): string {
  if (typeof value !== 'string') throw new ObjectRequestError('Object upload requires a SHA-256 checksum.');
  const normalized = value.trim().replace(/^sha256:/i, '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new ObjectRequestError('Object upload requires a SHA-256 checksum.');
  return normalized;
}

async function readJsonObject(request: Request, maxBytes: number): Promise<Readonly<Record<string, unknown>>> {
  const bytes = await readBoundedBody(request, maxBytes);
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Request body must be a JSON object.');
  return parsed as Readonly<Record<string, unknown>>;
}

async function readBoundedBody(request: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) throw new ObjectRequestError(`Request body exceeds the ${maxBytes}-byte limit.`);
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new ObjectRequestError(`Request body exceeds the ${maxBytes}-byte limit.`);
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function normalizeBasePath(value: string): string {
  const normalized = `/${value.split('/').filter(Boolean).join('/')}`;
  if (normalized === '/') throw new Error('Application object gateway basePath must not be the root path.');
  return normalized;
}

function objectValue(value: unknown): Readonly<Record<string, unknown>> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : {};
}

function runtimeResult(operation: string, result: unknown): Response {
  return json({ protocol: 'applik8s.runtime/v1alpha1', operation, result }, 200);
}

function objectFailure(store: string, error: unknown): Response {
  if (error instanceof ObjectRequestError) return json({ error: 'invalid_request', message: error.message }, 400);
  return json({ error: 'object_storage_unavailable', store }, 503);
}

function json(value: unknown, status: number, headers: Readonly<Record<string, string>> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}
