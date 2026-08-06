// typecast-file-boundary: Signed operation envelopes are parsed and validated before their typed fields are consumed.
import { createHmac, timingSafeEqual } from 'node:crypto';

export function internalTransportSecret(value: string): string {
  if (new TextEncoder().encode(value).byteLength < 32) {
    throw new Error(
      'Internal transport secret must contain at least 32 bytes.',
    );
  }
  return value;
}

export function internalTransportSignature(
  secret: string,
  payload: string,
): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function internalTransportSignatureMatches(
  left: string,
  right: string,
): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length
    && timingSafeEqual(leftBytes, rightBytes);
}

export function canonicalInternalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalInternalJson(entry)).join(',')}]`;
  }
  return `{${Object.entries(value as Readonly<Record<string, unknown>>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) =>
      `${JSON.stringify(key)}:${canonicalInternalJson(entry)}`)
    .join(',')}}`;
}
