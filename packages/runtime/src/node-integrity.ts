import { createHmac } from 'node:crypto';

export interface NodeKeyedDigestOptions {
  readonly key: string | Uint8Array;
  readonly purpose: string;
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
