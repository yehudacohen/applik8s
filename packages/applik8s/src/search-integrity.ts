import { createHash } from 'node:crypto';
import {
  canonicalJsonStrictV1Policy,
  canonicalJsonV1String,
  canonicalJsonV1Value,
  type CanonicalJsonV1Policy,
} from '@applik8s/core/canonical-json';

export const applicationSearchCanonicalJsonV1Policy: CanonicalJsonV1Policy = Object.freeze({
  ...canonicalJsonStrictV1Policy,
  name: 'application-search-value',
});

/**
 * Search providers share one portable value projection before hashing.
 * Dates are logical application values and use their ISO representation;
 * every other non-JSON runtime object remains unsupported and fails closed.
 */
export function adaptApplicationSearchCanonicalJsonV1(value: unknown): unknown {
  return adaptSearchValue(value, new WeakMap<object, object>());
}

export function applicationSearchCanonicalJsonV1Value(value: unknown) {
  return canonicalJsonV1Value(
    adaptApplicationSearchCanonicalJsonV1(value),
    applicationSearchCanonicalJsonV1Policy,
  );
}

export function applicationSearchCanonicalJsonV1String(value: unknown): string {
  return canonicalJsonV1String(
    adaptApplicationSearchCanonicalJsonV1(value),
    applicationSearchCanonicalJsonV1Policy,
  );
}

export function applicationSearchDigest(value: unknown): string {
  return createHash('sha256')
    .update(applicationSearchCanonicalJsonV1String(value))
    .digest('hex');
}

function adaptSearchValue(
  value: unknown,
  seen: WeakMap<object, object>,
): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value === null || typeof value !== 'object') return value;
  const previous = seen.get(value);
  if (previous) return previous;
  if (Array.isArray(value)) {
    const adapted: unknown[] = [];
    seen.set(value, adapted);
    for (const entry of value) adapted.push(adaptSearchValue(entry, seen));
    return adapted;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  const adapted: Record<string, unknown> = {};
  seen.set(value, adapted);
  for (const [key, entry] of Object.entries(value)) {
    adapted[key] = adaptSearchValue(entry, seen);
  }
  return adapted;
}
