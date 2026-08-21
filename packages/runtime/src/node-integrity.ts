import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export interface NodeKeyedDigestOptions {
  readonly key: string | Uint8Array;
  readonly purpose: string;
  readonly value: string | Uint8Array;
}

export interface NodeLegacyHmacOptions {
  readonly key: string | Uint8Array;
  readonly value: string | Uint8Array;
}

/**
 * Synchronous Node compatibility adapter for purpose-separated keyed digests.
 * It is not an envelope and cannot encode or decode payloads.
 */
export function nodeKeyedDigestBase64Url(
  options: NodeKeyedDigestOptions,
): string {
  return nodeKeyedDigest(options).digest('base64url');
}

export function nodeKeyedDigestHex(
  options: NodeKeyedDigestOptions,
): string {
  return nodeKeyedDigest(options).digest('hex');
}

function nodeKeyedDigest(options: NodeKeyedDigestOptions) {
  if (!options.purpose.trim()) {
    throw new TypeError('Keyed digest purpose must be non-empty.');
  }
  const key = typeof options.key === 'string'
    ? new TextEncoder().encode(options.key)
    : options.key;
  if (key.byteLength < 32) {
    throw new TypeError('Keyed digest keys must contain at least 256 bits.');
  }
  const value = typeof options.value === 'string'
    ? new TextEncoder().encode(options.value)
    : options.value;
  return createHmac('sha256', key)
    .update(`${options.purpose}\0`)
    .update(value);
}

/**
 * Compatibility-only adapter for released HMAC inputs that predate purpose
 * separation. It deliberately preserves historical key acceptance; the owning
 * compatibility boundary remains responsible for its existing validation.
 * New protocols must use nodeKeyedDigest* or Signed Envelope v1.
 */
export function nodeLegacyHmacBase64Url(options: NodeLegacyHmacOptions): string {
  return nodeLegacyHmac(options).digest('base64url');
}

/** Compatibility-only hexadecimal form for released durable digest keys. */
export function nodeLegacyHmacHex(options: NodeLegacyHmacOptions): string {
  return nodeLegacyHmac(options).digest('hex');
}

/** Compares arbitrary text without exposing a length-dependent comparison. */
export function nodeConstantTimeTextEqual(left: string, right: string): boolean {
  const leftDigest = createHash('sha256').update(left).digest();
  const rightDigest = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function nodeLegacyHmac(options: NodeLegacyHmacOptions) {
  const key = typeof options.key === 'string'
    ? new TextEncoder().encode(options.key)
    : options.key;
  const value = typeof options.value === 'string'
    ? new TextEncoder().encode(options.value)
    : options.value;
  return createHmac('sha256', key).update(value);
}
