import {
  canonicalJsonV1Bytes,
  canonicalJsonV1String,
  canonicalJsonV1Value,
  type JsonValue,
  type SignedEnvelopeV1Protected,
  SignedEnvelopeV1ValidationError,
  signedEnvelopeAlgorithm,
  signedEnvelopeVersion,
  validateSignedEnvelopeV1Protected,
} from '@applik8s/core';

export type SignedEnvelopeKeyMaterial = CryptoKey | Uint8Array;

export interface SignedEnvelopeSigningKey {
  readonly id: string;
  readonly key: SignedEnvelopeKeyMaterial;
}

export interface SignedEnvelopeKeyProvider {
  signingKey(purpose: string): Promise<SignedEnvelopeSigningKey>;
  verificationKey(
    purpose: string,
    keyId: string,
  ): Promise<SignedEnvelopeKeyMaterial | undefined>;
}

export interface SignedEnvelopeCodecOptions<TPayload> {
  readonly purpose: string;
  readonly keys: SignedEnvelopeKeyProvider;
  readonly validatePayload: (value: JsonValue) => TPayload;
  readonly maximumEncodedBytes?: number;
  readonly maximumLifetimeMs?: number;
  readonly now?: () => number;
}

export interface SignedEnvelopeSignOptions {
  readonly issuedAt?: number;
  readonly expiresAt?: number;
  readonly expiresInMs?: number;
}

export interface SignedEnvelopeCodec<TPayload> {
  sign(payload: TPayload, options?: SignedEnvelopeSignOptions): Promise<string>;
  verify(token: string): Promise<SignedEnvelopeV1Protected<TPayload>>;
}

export interface LegacyCompactHmacJsonOptions<TPayload> {
  readonly key: SignedEnvelopeKeyMaterial;
  readonly validatePayload: (value: JsonValue) => TPayload;
  readonly maximumEncodedBytes?: number;
}

export interface LegacyCompactHmacJsonSigningOptions {
  readonly key: SignedEnvelopeKeyMaterial;
  readonly maximumEncodedBytes?: number;
}

export interface RollingSignedEnvelopeLegacyAdapter<TPayload, TLegacyPayload> {
  readonly key: SignedEnvelopeKeyMaterial;
  readonly validatePayload: (value: JsonValue) => TLegacyPayload;
  readonly toCurrent: (payload: TLegacyPayload, now: number) => TPayload;
  readonly fromCurrent: (
    payload: TPayload,
    timing: { readonly issuedAt: number; readonly expiresAt?: number },
  ) => JsonValue;
}

export interface RollingSignedEnvelopeCodecOptions<TPayload, TLegacyPayload>
  extends SignedEnvelopeCodecOptions<TPayload> {
  readonly writer: 'legacy' | 'v1';
  readonly legacy: RollingSignedEnvelopeLegacyAdapter<TPayload, TLegacyPayload>;
}

export interface RollingSignedEnvelopeCodec<TPayload> {
  sign(payload: TPayload, options?: SignedEnvelopeSignOptions): Promise<string>;
  verify(token: string): Promise<TPayload>;
}

export type SignedEnvelopeRuntimeErrorCode =
  | 'SIGNED_ENVELOPE_CRYPTO_UNAVAILABLE'
  | 'SIGNED_ENVELOPE_KEY_INVALID'
  | 'SIGNED_ENVELOPE_KEY_UNKNOWN'
  | 'SIGNED_ENVELOPE_MALFORMED'
  | 'SIGNED_ENVELOPE_OVERSIZED'
  | 'SIGNED_ENVELOPE_SIGNATURE_INVALID';

export class SignedEnvelopeRuntimeError extends Error {
  constructor(
    readonly code: SignedEnvelopeRuntimeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SignedEnvelopeRuntimeError';
  }
}

export function createSignedEnvelopeCodec<TPayload>(
  options: SignedEnvelopeCodecOptions<TPayload>,
): SignedEnvelopeCodec<TPayload> {
  if (!options.purpose.trim()) throw new TypeError('Signed envelope purpose must be non-empty.');
  const maximumEncodedBytes = options.maximumEncodedBytes ?? 16_384;
  if (!Number.isSafeInteger(maximumEncodedBytes) || maximumEncodedBytes < 256) {
    throw new TypeError('Signed envelope maximum encoded size must be at least 256 bytes.');
  }
  const now = options.now ?? Date.now;

  const codec: SignedEnvelopeCodec<TPayload> = {
    async sign(payload: TPayload, signOptions: SignedEnvelopeSignOptions = {}) {
      const issuedAt = signOptions.issuedAt ?? now();
      if (
        signOptions.expiresAt !== undefined
        && signOptions.expiresInMs !== undefined
      ) {
        throw new TypeError('Signed envelope expiry must use expiresAt or expiresInMs, not both.');
      }
      const expiresAt = signOptions.expiresAt
        ?? (signOptions.expiresInMs === undefined
          ? undefined
          : issuedAt + signOptions.expiresInMs);
      const signingKey = await options.keys.signingKey(options.purpose);
      const protectedBody = validateSignedEnvelopeV1Protected({
        version: signedEnvelopeVersion,
        purpose: options.purpose,
        algorithm: signedEnvelopeAlgorithm,
        keyId: signingKey.id,
        issuedAt,
        ...(expiresAt === undefined ? {} : { expiresAt }),
        payload,
      }, {
        purpose: options.purpose,
        now: issuedAt,
        ...(options.maximumLifetimeMs === undefined
          ? {}
          : { maximumLifetimeMs: options.maximumLifetimeMs }),
        validatePayload: options.validatePayload,
      });
      const body = ownedBytes(canonicalJsonV1Bytes(protectedBody));
      const signature = new Uint8Array(await subtle().sign(
        'HMAC',
        await hmacKey(signingKey.key, ['sign']),
        body,
      ));
      const token = `${base64UrlEncode(body)}.${base64UrlEncode(signature)}`;
      assertEncodedSize(token, maximumEncodedBytes);
      return token;
    },

    async verify(token: string) {
      assertEncodedSize(token, maximumEncodedBytes);
      const parts = token.split('.');
      if (parts.length !== 2 || !parts[0] || !parts[1]) throw malformed();
      const body = ownedBytes(base64UrlDecode(parts[0]));
      const signature = ownedBytes(base64UrlDecode(parts[1]));
      if (signature.byteLength !== 32) {
        throw new SignedEnvelopeRuntimeError(
          'SIGNED_ENVELOPE_SIGNATURE_INVALID',
          'Signed envelope signature is invalid.',
        );
      }
      let parsed: unknown;
      let serialized: string;
      try {
        serialized = new TextDecoder('utf-8', { fatal: true }).decode(body);
        parsed = JSON.parse(serialized) as unknown;
      } catch {
        throw malformed();
      }
      // The compact body has one canonical byte representation. This rejects
      // duplicate/unsorted keys and alternate whitespace before key use.
      try {
        if (canonicalJsonV1String(parsed) !== serialized) throw malformed();
      } catch (error) {
        if (error instanceof SignedEnvelopeRuntimeError) throw error;
        throw malformed();
      }
      const keyId = untrustedKeyId(parsed);
      const key = await options.keys.verificationKey(
        options.purpose,
        keyId,
      );
      if (!key) {
        throw new SignedEnvelopeRuntimeError(
          'SIGNED_ENVELOPE_KEY_UNKNOWN',
          'Signed envelope key identity is unknown.',
        );
      }
      const valid = await subtle().verify(
        'HMAC',
        await hmacKey(key, ['verify']),
        signature,
        body,
      );
      if (!valid) {
        throw new SignedEnvelopeRuntimeError(
          'SIGNED_ENVELOPE_SIGNATURE_INVALID',
          'Signed envelope signature is invalid.',
        );
      }
      return validateSignedEnvelopeV1Protected(parsed, {
        purpose: options.purpose,
        now: now(),
        ...(options.maximumLifetimeMs === undefined
          ? {}
          : { maximumLifetimeMs: options.maximumLifetimeMs }),
        validatePayload: options.validatePayload,
      });
    },
  };
  return Object.freeze(codec);
}

/**
 * Coordinates the accepted Release-A/B/C migration without allowing payload
 * owners to duplicate format probing or cryptography.
 */
export function createRollingSignedEnvelopeCodec<TPayload, TLegacyPayload>(
  options: RollingSignedEnvelopeCodecOptions<TPayload, TLegacyPayload>,
): RollingSignedEnvelopeCodec<TPayload> {
  const current = createSignedEnvelopeCodec(options);
  const now = options.now ?? Date.now;
  const codec: RollingSignedEnvelopeCodec<TPayload> = {
    async sign(payload, signOptions = {}) {
      if (options.writer === 'v1') return current.sign(payload, signOptions);
      const timing = signedEnvelopeTiming(now(), signOptions);
      const normalized = validateSignedEnvelopeV1Protected({
        version: signedEnvelopeVersion,
        purpose: options.purpose,
        algorithm: signedEnvelopeAlgorithm,
        keyId: 'legacy-rolling-migration',
        issuedAt: timing.issuedAt,
        ...(timing.expiresAt === undefined
          ? {}
          : { expiresAt: timing.expiresAt }),
        payload,
      }, {
        purpose: options.purpose,
        now: timing.issuedAt,
        ...(options.maximumLifetimeMs === undefined
          ? {}
          : { maximumLifetimeMs: options.maximumLifetimeMs }),
        validatePayload: options.validatePayload,
      }).payload;
      return signLegacyCompactHmacJsonForRollingMigration(
        options.legacy.fromCurrent(normalized, timing),
        {
          key: options.legacy.key,
          ...(options.maximumEncodedBytes === undefined
            ? {}
            : { maximumEncodedBytes: options.maximumEncodedBytes }),
        },
      );
    },
    async verify(token) {
      try {
        return (await current.verify(token)).payload;
      } catch (cause) {
        if (!isLegacyCompactCandidate(cause)) throw cause;
      }
      const legacy = await verifyLegacyCompactHmacJson(token, {
        key: options.legacy.key,
        ...(options.maximumEncodedBytes === undefined
          ? {}
          : { maximumEncodedBytes: options.maximumEncodedBytes }),
        validatePayload: options.legacy.validatePayload,
      });
      return options.validatePayload(canonicalJsonV1Value(
        options.legacy.toCurrent(legacy, now()),
      ));
    },
  };
  return Object.freeze(codec);
}

function signedEnvelopeTiming(
  now: number,
  options: SignedEnvelopeSignOptions,
): { readonly issuedAt: number; readonly expiresAt?: number } {
  if (options.expiresAt !== undefined && options.expiresInMs !== undefined) {
    throw new TypeError('Signed envelope expiry must use expiresAt or expiresInMs, not both.');
  }
  const issuedAt = options.issuedAt ?? now;
  const expiresAt = options.expiresAt
    ?? (options.expiresInMs === undefined
      ? undefined
      : issuedAt + options.expiresInMs);
  return { issuedAt, ...(expiresAt === undefined ? {} : { expiresAt }) };
}

function isLegacyCompactCandidate(cause: unknown): boolean {
  return (
    cause instanceof SignedEnvelopeV1ValidationError
    && cause.code === 'SIGNED_ENVELOPE_VERSION_INVALID'
  ) || (
    cause instanceof SignedEnvelopeRuntimeError
    && cause.code === 'SIGNED_ENVELOPE_MALFORMED'
  );
}

function untrustedKeyId(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw malformed();
  const keyId = Reflect.get(value, 'keyId');
  if (typeof keyId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/u.test(keyId)) {
    throw malformed();
  }
  return keyId;
}

export function staticSignedEnvelopeKeyProvider(options: {
  readonly current: SignedEnvelopeSigningKey;
  readonly previous?: readonly SignedEnvelopeSigningKey[];
}): SignedEnvelopeKeyProvider {
  const keys = new Map(
    [options.current, ...(options.previous ?? [])].map((entry) => [entry.id, entry]),
  );
  if (keys.size !== 1 + (options.previous?.length ?? 0)) {
    throw new TypeError('Signed envelope key identities must be unique.');
  }
  const provider: SignedEnvelopeKeyProvider = {
    async signingKey(_purpose: string) { return options.current; },
    async verificationKey(_purpose: string, keyId: string) {
      return keys.get(keyId)?.key;
    },
  };
  return Object.freeze(provider);
}

/**
 * Temporary Release-A writer for durable formats following the accepted
 * three-release migration. The payload bytes are Canonical JSON v1, while the
 * compact signature remains readable by pre-v0.8 decoders.
 *
 * Do not use for new formats. Every caller must have a format-registry entry
 * with a release that switches the writer to Signed Envelope v1.
 */
export async function signLegacyCompactHmacJsonForRollingMigration(
  payload: JsonValue,
  options: LegacyCompactHmacJsonSigningOptions,
): Promise<string> {
  const maximumEncodedBytes = options.maximumEncodedBytes ?? 16_384;
  const encodedPayload = base64UrlEncode(
    new TextEncoder().encode(canonicalJsonV1String(payload)),
  );
  const signature = new Uint8Array(await subtle().sign(
    'HMAC',
    await hmacKey(options.key, ['sign']),
    new TextEncoder().encode(encodedPayload),
  ));
  const token = `${encodedPayload}.${base64UrlEncode(signature)}`;
  assertEncodedSize(token, maximumEncodedBytes);
  return token;
}

/**
 * Bounded read-only compatibility decoder for the pre-v0.8
 * `base64url(JSON).base64url(HMAC(encodedBody))` format.
 *
 * New writers must use Signed Envelope v1. Payload owners are responsible for
 * recording the decoder lifetime and removal release in the format registry.
 */
export async function verifyLegacyCompactHmacJson<TPayload>(
  token: string,
  options: LegacyCompactHmacJsonOptions<TPayload>,
): Promise<TPayload> {
  const maximumEncodedBytes = options.maximumEncodedBytes ?? 16_384;
  assertEncodedSize(token, maximumEncodedBytes);
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw malformed();
  const signature = ownedBytes(base64UrlDecode(parts[1]));
  if (signature.byteLength !== 32) {
    throw new SignedEnvelopeRuntimeError(
      'SIGNED_ENVELOPE_SIGNATURE_INVALID',
      'Legacy signed JSON signature is invalid.',
    );
  }
  const valid = await subtle().verify(
    'HMAC',
    await hmacKey(options.key, ['verify']),
    signature,
    new TextEncoder().encode(parts[0]),
  );
  if (!valid) {
    throw new SignedEnvelopeRuntimeError(
      'SIGNED_ENVELOPE_SIGNATURE_INVALID',
      'Legacy signed JSON signature is invalid.',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(base64UrlDecode(parts[0])),
    ) as unknown;
  } catch {
    throw malformed();
  }
  try {
    return options.validatePayload(parsed as JsonValue);
  } catch {
    throw new SignedEnvelopeRuntimeError(
      'SIGNED_ENVELOPE_MALFORMED',
      'Legacy signed JSON payload is invalid.',
    );
  }
}

export function signedEnvelopeUtf8Key(value: string): Uint8Array {
  const key = new TextEncoder().encode(value);
  if (key.byteLength < 32) {
    throw new SignedEnvelopeRuntimeError(
      'SIGNED_ENVELOPE_KEY_INVALID',
      'Signed envelope HMAC keys must contain at least 256 bits.',
    );
  }
  return key;
}

async function hmacKey(
  value: SignedEnvelopeKeyMaterial,
  usage: readonly KeyUsage[],
): Promise<CryptoKey> {
  if (isCryptoKey(value)) {
    if (value.algorithm.name !== 'HMAC') {
      throw new SignedEnvelopeRuntimeError(
        'SIGNED_ENVELOPE_KEY_INVALID',
        'Signed envelope key algorithm is invalid.',
      );
    }
    return value;
  }
  if (value.byteLength < 32) {
    throw new SignedEnvelopeRuntimeError(
      'SIGNED_ENVELOPE_KEY_INVALID',
      'Signed envelope HMAC keys must contain at least 256 bits.',
    );
  }
  return subtle().importKey(
    'raw',
    ownedBytes(value),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [...usage],
  );
}

function subtle(): SubtleCrypto {
  const implementation = globalThis.crypto?.subtle;
  if (!implementation) {
    throw new SignedEnvelopeRuntimeError(
      'SIGNED_ENVELOPE_CRYPTO_UNAVAILABLE',
      'The runtime does not provide WebCrypto SubtleCrypto.',
    );
  }
  return implementation;
}

function isCryptoKey(value: SignedEnvelopeKeyMaterial): value is CryptoKey {
  return typeof CryptoKey !== 'undefined' && value instanceof CryptoKey;
}

function assertEncodedSize(value: string, maximum: number): void {
  if (new TextEncoder().encode(value).byteLength > maximum) {
    throw new SignedEnvelopeRuntimeError(
      'SIGNED_ENVELOPE_OVERSIZED',
      'Signed envelope exceeds its encoded size limit.',
    );
  }
}

function base64UrlEncode(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function base64UrlDecode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw malformed();
  const padding = value.length % 4;
  if (padding === 1) throw malformed();
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
    + (padding === 0 ? '' : '='.repeat(4 - padding));
  let binary: string;
  try {
    binary = atob(normalized);
  } catch {
    throw malformed();
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function malformed(): SignedEnvelopeRuntimeError {
  return new SignedEnvelopeRuntimeError(
    'SIGNED_ENVELOPE_MALFORMED',
    'Signed envelope is malformed.',
  );
}

function ownedBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy;
}
