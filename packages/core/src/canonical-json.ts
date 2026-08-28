// typecast-file-boundary: Canonical JSON recursively validates supported values before restoring the closed JSON algebra at this serialization boundary.
import type { JsonValue } from './common.js';

export const canonicalJsonVersion = 'applik8s.canonical-json/v1' as const;

export type CanonicalJsonUndefinedPolicy = 'reject' | 'omit' | 'null';

export interface CanonicalJsonV1Policy {
  readonly version: typeof canonicalJsonVersion;
  readonly name: string;
  readonly objectUndefined: Exclude<CanonicalJsonUndefinedPolicy, 'null'>;
  readonly arrayUndefined: Exclude<CanonicalJsonUndefinedPolicy, 'omit'>;
  readonly rootUndefined: 'reject';
}

export const canonicalJsonStrictV1Policy: CanonicalJsonV1Policy = Object.freeze({
  version: canonicalJsonVersion,
  name: 'strict',
  objectUndefined: 'reject',
  arrayUndefined: 'reject',
  rootUndefined: 'reject',
});

export const canonicalJsonCompatibleV1Policy: CanonicalJsonV1Policy = Object.freeze({
  version: canonicalJsonVersion,
  name: 'json-compatible',
  objectUndefined: 'omit',
  arrayUndefined: 'null',
  rootUndefined: 'reject',
});

export type CanonicalJsonV1ErrorCode =
  | 'CANONICAL_JSON_CYCLE'
  | 'CANONICAL_JSON_NON_FINITE_NUMBER'
  | 'CANONICAL_JSON_UNDEFINED'
  | 'CANONICAL_JSON_UNSUPPORTED_VALUE';

export class CanonicalJsonV1Error extends TypeError {
  readonly version = canonicalJsonVersion;

  constructor(
    readonly code: CanonicalJsonV1ErrorCode,
    readonly path: string,
    readonly policy: string,
    message: string,
  ) {
    super(`${message} at ${path} under ${policy}.`);
    this.name = 'CanonicalJsonV1Error';
  }
}

/**
 * Converts a runtime value into the platform-neutral Canonical JSON v1
 * algebra. Adapters must translate provider/compiler reference values before
 * they cross this boundary.
 */
export function canonicalJsonV1Value(
  value: unknown,
  policy: CanonicalJsonV1Policy = canonicalJsonStrictV1Policy,
): JsonValue {
  validatePolicy(policy);
  const ancestors = new WeakSet<object>();
  const normalized = normalize(value, '$', policy, ancestors, 'root');
  if (normalized === omitted) {
    throw new CanonicalJsonV1Error(
      'CANONICAL_JSON_UNDEFINED',
      '$',
      policy.name,
      'Canonical JSON cannot represent undefined',
    );
  }
  return normalized;
}

export function canonicalJsonV1String(
  value: unknown,
  policy: CanonicalJsonV1Policy = canonicalJsonStrictV1Policy,
): string {
  return serialize(canonicalJsonV1Value(value, policy));
}

export function canonicalJsonV1Bytes(
  value: unknown,
  policy: CanonicalJsonV1Policy = canonicalJsonStrictV1Policy,
): Uint8Array {
  return new TextEncoder().encode(canonicalJsonV1String(value, policy));
}

const omitted = Symbol('canonical-json-omitted');

function normalize(
  value: unknown,
  path: string,
  policy: CanonicalJsonV1Policy,
  ancestors: WeakSet<object>,
  position: 'root' | 'object' | 'array',
): JsonValue | typeof omitted {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new CanonicalJsonV1Error(
        'CANONICAL_JSON_NON_FINITE_NUMBER',
        path,
        policy.name,
        'Canonical JSON requires a finite number',
      );
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (value === undefined) {
    const behavior = position === 'object'
      ? policy.objectUndefined
      : position === 'array'
        ? policy.arrayUndefined
        : policy.rootUndefined;
    if (behavior === 'omit') return omitted;
    if (behavior === 'null') return null;
    throw new CanonicalJsonV1Error(
      'CANONICAL_JSON_UNDEFINED',
      path,
      policy.name,
      'Canonical JSON cannot represent undefined',
    );
  }
  if (typeof value !== 'object') {
    throw unsupported(path, policy, value);
  }
  if (ancestors.has(value)) {
    throw new CanonicalJsonV1Error(
      'CANONICAL_JSON_CYCLE',
      path,
      policy.name,
      'Canonical JSON cannot represent a cycle',
    );
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry, index) => {
        const normalized = normalize(entry, `${path}[${index}]`, policy, ancestors, 'array');
        return normalized === omitted ? null : normalized;
      });
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw unsupported(path, policy, value);
    }
    const normalized: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort()) {
      const entry = normalize(
        Reflect.get(value, key),
        `${path}${propertyPath(key)}`,
        policy,
        ancestors,
        'object',
      );
      if (entry !== omitted) normalized[key] = entry;
    }
    return normalized;
  } finally {
    ancestors.delete(value);
  }
}

function serialize(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(serialize).join(',')}]`;
  const object = value as Readonly<Record<string, JsonValue>>;
  return `{${Object.keys(object).sort().map((key) =>
    `${JSON.stringify(key)}:${serialize(object[key] as JsonValue)}`).join(',')}}`;
}

function propertyPath(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(key)
    ? `.${key}`
    : `[${JSON.stringify(key)}]`;
}

function unsupported(
  path: string,
  policy: CanonicalJsonV1Policy,
  value: unknown,
): CanonicalJsonV1Error {
  const kind = value === null
    ? 'null'
    : typeof value === 'object'
      ? Object.prototype.toString.call(value)
      : typeof value;
  return new CanonicalJsonV1Error(
    'CANONICAL_JSON_UNSUPPORTED_VALUE',
    path,
    policy.name,
    `Canonical JSON cannot represent ${kind}`,
  );
}

function validatePolicy(policy: CanonicalJsonV1Policy): void {
  if (policy.version !== canonicalJsonVersion || !policy.name.trim()) {
    throw new TypeError('Canonical JSON policy must name the v1 contract.');
  }
}
