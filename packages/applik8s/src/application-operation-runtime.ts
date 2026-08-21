import { createHash } from 'node:crypto';
import {
  canonicalJsonCompatibleV1Policy,
  canonicalJsonV1String,
} from '@applik8s/core';

/**
 * Canonical digest shared by operation-admission and revalidation boundaries.
 * Inputs have already crossed their declared JSON schema before reaching this
 * helper, but the serializer remains deterministic for every JSON value.
 */
export function applicationOperationInputDigest(value: unknown): string {
  return `sha256:${createHash('sha256')
    .update(canonicalJsonV1String(value, canonicalJsonCompatibleV1Policy))
    .digest('hex')}`;
}
