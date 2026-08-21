import {
  canonicalJsonV1Bytes,
  canonicalJsonV1String,
  type JsonValue,
  type SignedEnvelopeV1Protected,
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

export interface SignedEnvelopeCodecOptions<TPayload extends JsonValue> {
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

export interface SignedEnvelopeCodec<TPayload extends JsonValue> {
  sign(payload: TPayload, options?: SignedEnvelopeSignOptions): Promise<string>;
  verify(token: string): Promise<SignedEnvelopeV1Protected<TPayload>>;
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

export function createSignedEnvelopeCodec<TPayload extends JsonValue>(
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
      const preliminary = validateSignedEnvelopeV1Protected(parsed, {
        purpose: options.purpose,
        now: now(),
        ...(options.maximumLifetimeMs === undefined
          ? {}
          : { maximumLifetimeMs: options.maximumLifetimeMs }),
        validatePayload(value) { return value; },
      });
      const key = await options.keys.verificationKey(
        options.purpose,
        preliminary.keyId,
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
