import type { JsonValue } from './common.js';

export const signedEnvelopeVersion = 'applik8s.signed-envelope/v1' as const;
export const signedEnvelopeAlgorithm = 'HMAC-SHA-256' as const;

export interface SignedEnvelopeV1Protected<TPayload = JsonValue> {
  readonly version: typeof signedEnvelopeVersion;
  readonly purpose: string;
  readonly algorithm: typeof signedEnvelopeAlgorithm;
  readonly keyId: string;
  /** Unix epoch milliseconds. */
  readonly issuedAt: number;
  /** Unix epoch milliseconds. */
  readonly expiresAt?: number;
  readonly payload: TPayload;
}

export interface SignedEnvelopeV1Wire {
  readonly protected: string;
  readonly signature: string;
}

export type SignedEnvelopeV1ValidationCode =
  | 'SIGNED_ENVELOPE_ALGORITHM_INVALID'
  | 'SIGNED_ENVELOPE_EXPIRED'
  | 'SIGNED_ENVELOPE_ISSUED_AT_INVALID'
  | 'SIGNED_ENVELOPE_KEY_ID_INVALID'
  | 'SIGNED_ENVELOPE_LIFETIME_INVALID'
  | 'SIGNED_ENVELOPE_PAYLOAD_INVALID'
  | 'SIGNED_ENVELOPE_PURPOSE_INVALID'
  | 'SIGNED_ENVELOPE_SHAPE_INVALID'
  | 'SIGNED_ENVELOPE_VERSION_INVALID';

export class SignedEnvelopeV1ValidationError extends TypeError {
  constructor(
    readonly code: SignedEnvelopeV1ValidationCode,
    message: string,
  ) {
    super(message);
    this.name = 'SignedEnvelopeV1ValidationError';
  }
}

export interface SignedEnvelopeV1ValidationOptions<TPayload> {
  readonly purpose: string;
  readonly now?: number;
  readonly maximumLifetimeMs?: number;
  readonly validatePayload: (value: JsonValue) => TPayload;
}

export function validateSignedEnvelopeV1Protected<TPayload>(
  value: unknown,
  options: SignedEnvelopeV1ValidationOptions<TPayload>,
): SignedEnvelopeV1Protected<TPayload> {
  if (!isRecord(value) || Array.isArray(value)) {
    throw validationError('SIGNED_ENVELOPE_SHAPE_INVALID', 'Signed envelope protected body must be an object.');
  }
  if (value.version !== signedEnvelopeVersion) {
    throw validationError('SIGNED_ENVELOPE_VERSION_INVALID', 'Signed envelope version is unsupported.');
  }
  if (value.purpose !== options.purpose || !options.purpose.trim()) {
    throw validationError('SIGNED_ENVELOPE_PURPOSE_INVALID', 'Signed envelope purpose does not match the verifier.');
  }
  if (value.algorithm !== signedEnvelopeAlgorithm) {
    throw validationError('SIGNED_ENVELOPE_ALGORITHM_INVALID', 'Signed envelope algorithm is unsupported.');
  }
  if (typeof value.keyId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/u.test(value.keyId)) {
    throw validationError('SIGNED_ENVELOPE_KEY_ID_INVALID', 'Signed envelope key identity is invalid.');
  }
  if (!Number.isSafeInteger(value.issuedAt) || Number(value.issuedAt) < 0) {
    throw validationError('SIGNED_ENVELOPE_ISSUED_AT_INVALID', 'Signed envelope issuance time is invalid.');
  }
  const issuedAt = Number(value.issuedAt);
  const expiresAt = value.expiresAt;
  if (
    expiresAt !== undefined
    && (!Number.isSafeInteger(expiresAt) || Number(expiresAt) <= issuedAt)
  ) {
    throw validationError('SIGNED_ENVELOPE_LIFETIME_INVALID', 'Signed envelope expiry must follow issuance.');
  }
  if (
    expiresAt !== undefined
    && options.maximumLifetimeMs !== undefined
    && Number(expiresAt) - issuedAt > options.maximumLifetimeMs
  ) {
    throw validationError('SIGNED_ENVELOPE_LIFETIME_INVALID', 'Signed envelope exceeds its maximum lifetime.');
  }
  if (expiresAt !== undefined && Number(expiresAt) < (options.now ?? Date.now())) {
    throw validationError('SIGNED_ENVELOPE_EXPIRED', 'Signed envelope has expired.');
  }
  let payload: TPayload;
  try {
    payload = options.validatePayload(value.payload as JsonValue);
  } catch (cause) {
    throw new SignedEnvelopeV1ValidationError(
      'SIGNED_ENVELOPE_PAYLOAD_INVALID',
      `Signed envelope payload is invalid: ${publicErrorMessage(cause)}`,
    );
  }
  return Object.freeze({
    version: signedEnvelopeVersion,
    purpose: options.purpose,
    algorithm: signedEnvelopeAlgorithm,
    keyId: value.keyId,
    issuedAt,
    ...(expiresAt === undefined ? {} : { expiresAt: Number(expiresAt) }),
    payload,
  });
}

function validationError(
  code: SignedEnvelopeV1ValidationCode,
  message: string,
): SignedEnvelopeV1ValidationError {
  return new SignedEnvelopeV1ValidationError(code, message);
}

function publicErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'payload validation failed';
  return error.message.slice(0, 256);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}
