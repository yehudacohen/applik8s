// typecast-file-boundary: Signed operation envelopes are parsed and validated before their typed fields are consumed.
import { canonicalJsonV1String } from '@applik8s/core';
import { nodeConstantTimeTextEqual, nodeLegacyHmacBase64Url } from '@applik8s/runtime/node-integrity';

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
  return nodeLegacyHmacBase64Url({ key: secret, value: payload });
}

export function internalTransportSignatureMatches(
  left: string,
  right: string,
): boolean {
  return nodeConstantTimeTextEqual(left, right);
}

export function canonicalInternalJson(value: unknown): string {
  return canonicalJsonV1String(value);
}
