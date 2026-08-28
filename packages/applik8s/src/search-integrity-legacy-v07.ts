// typecast-file-boundary: This bounded compatibility reader validates retained v0.7 search material before adapting it to the v0.8 cursor contract.
import { createHash } from 'node:crypto';

/**
 * Release-A reader support for offset-provider query digests issued before
 * search values adopted Canonical JSON v1. Remove only with the registered
 * search-cursor legacy reader in 0.10.0 or later.
 */
export function applicationSearchLegacyOffsetDigestV07(value: unknown): string {
  return createHash('sha256')
    .update(encodeLegacyOffsetSearchValueV07(value))
    .digest('hex');
}

function encodeLegacyOffsetSearchValueV07(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(encodeLegacyOffsetSearchValueV07).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) =>
        `${JSON.stringify(key)}:${encodeLegacyOffsetSearchValueV07(nested)}`)
      .join(',')}}`;
  }
  // typecast: this intentionally preserves the pre-v0.8 encoder's runtime
  // behavior, including its root-undefined failure in createHash.update().
  return JSON.stringify(value) as string;
}
