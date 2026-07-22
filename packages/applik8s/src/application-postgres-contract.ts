import type { ApplicationPostgresClusterSpec } from './application-providers.js';

type Rational = readonly [numerator: bigint, denominator: bigint];

const decimalSuffixExponents: Readonly<Record<string, number>> = {
  n: -9, u: -6, m: -3, '': 0, k: 3, K: 3, M: 6, G: 9, T: 12, P: 15, E: 18,
};

/**
 * Guard the mutable boundary of an already managed CloudNativePG Cluster.
 *
 * Replica count, resources, backup policy, and storage growth are ordinary
 * reconciliation. Database bootstrap identity, storage class, and shrinking
 * durable storage are migration operations and must never happen implicitly
 * during `applik8s deploy`.
 */
export function assertSafeManagedPostgresClusterUpdate(
  liveSpec: unknown,
  desiredSpec: ApplicationPostgresClusterSpec,
  resource: string,
): void {
  const live = requiredRecord(liveSpec, `${resource}.spec`);
  assertJsonSubset(live.bootstrap, desiredSpec.bootstrap, `${resource}.spec.bootstrap`);

  const liveStorage = requiredRecord(live.storage, `${resource}.spec.storage`);
  const liveStorageClass = optionalString(liveStorage.storageClass, `${resource}.spec.storage.storageClass`);
  const desiredStorageClass = desiredSpec.storage.storageClass;
  if (liveStorageClass !== desiredStorageClass) {
    throw new Error(
      `${resource}.spec.storage.storageClass cannot change implicitly from ${JSON.stringify(liveStorageClass)} to ${JSON.stringify(desiredStorageClass)}. `
      + 'Move the data through an explicit database migration instead.',
    );
  }

  const liveSize = requiredString(liveStorage.size, `${resource}.spec.storage.size`);
  const desiredSize = desiredSpec.storage.size;
  if (liveSize === desiredSize) return;
  const liveQuantity = storageQuantity(liveSize);
  const desiredQuantity = storageQuantity(desiredSize);
  if (!liveQuantity || !desiredQuantity) {
    throw new Error(
      `${resource}.spec.storage.size cannot be safely compared (${JSON.stringify(liveSize)} -> ${JSON.stringify(desiredSize)}). `
      + 'Use an explicit database migration for non-standard storage quantities.',
    );
  }
  if (compareRationals(desiredQuantity, liveQuantity) < 0) {
    throw new Error(
      `${resource}.spec.storage.size cannot shrink implicitly from ${liveSize} to ${desiredSize}. `
      + 'Move the data through an explicit database migration instead.',
    );
  }
}

function requiredRecord(value: unknown, path: string): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${path} must be a non-empty string.`);
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, path);
}

function assertJsonSubset(actual: unknown, expected: unknown, path: string): void {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) throw new Error(`${path} does not match the initialized database contract.`);
    expected.forEach((value, index) => {
      assertJsonSubset(actual[index], value, `${path}[${index}]`);
    });
    return;
  }
  if (expected && typeof expected === 'object') {
    const actualRecord = requiredRecord(actual, path);
    for (const [key, value] of Object.entries(expected)) assertJsonSubset(actualRecord[key], value, `${path}.${key}`);
    return;
  }
  if (actual !== expected) {
    throw new Error(`${path} is ${JSON.stringify(actual)}, expected the initialized value ${JSON.stringify(expected)}.`);
  }
}

function storageQuantity(value: string): Rational | undefined {
  const match = /^(\d+(?:\.\d*)?|\.\d+)([eE][+-]?\d+|[numkKMGTPE]|[KMGTPE]i)?$/.exec(value);
  if (!match) return undefined;
  const numeric = match[1];
  if (!numeric) return undefined;
  const decimal = decimalRational(numeric);
  if (!decimal) return undefined;
  const suffix = match[2] ?? '';
  if (/^[KMGTPE]i$/.test(suffix)) {
    const exponent = ['Ki', 'Mi', 'Gi', 'Ti', 'Pi', 'Ei'].indexOf(suffix) + 1;
    return [decimal[0] * (1024n ** BigInt(exponent)), decimal[1]];
  }
  const decimalExponent = suffix.startsWith('e') || suffix.startsWith('E')
    ? Number.parseInt(suffix.slice(1), 10)
    : decimalSuffixExponents[suffix];
  if (typeof decimalExponent !== 'number' || !Number.isSafeInteger(decimalExponent)) return undefined;
  return decimalExponent >= 0
    ? [decimal[0] * (10n ** BigInt(decimalExponent)), decimal[1]]
    : [decimal[0], decimal[1] * (10n ** BigInt(-decimalExponent))];
}

function decimalRational(value: string): Rational | undefined {
  const [whole = '', fraction = ''] = value.split('.');
  const digits = `${whole || '0'}${fraction}`;
  if (!/^\d+$/.test(digits)) return undefined;
  return [BigInt(digits), 10n ** BigInt(fraction.length)];
}

function compareRationals(left: Rational, right: Rational): number {
  const leftScaled = left[0] * right[1];
  const rightScaled = right[0] * left[1];
  return leftScaled < rightScaled ? -1 : leftScaled > rightScaled ? 1 : 0;
}
