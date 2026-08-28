// typecast-file-boundary: Search cursor payloads are purpose-verified and structurally validated here before provider-specific continuation types are restored.
import {
  canonicalJsonStrictV1Policy,
  canonicalJsonV1Value,
  type JsonValue,
} from '@applik8s/core';
import {
  createRollingSignedEnvelopeCodec,
  signedEnvelopeUtf8Key,
  staticSignedEnvelopeKeyProvider,
} from '@applik8s/runtime/signed-envelope';
import { observeApplicationRuntimeIntegrityEnvelope } from './application-telemetry-runtime.js';

export const applicationSearchCursorProtocol = 'applik8s.search-cursor/v1' as const;
export const applicationSearchCursorPurpose = 'applik8s.search-cursor/v1' as const;
export const defaultApplicationSearchCursorLifetimeMs = 15 * 60 * 1_000;

const legacyOffsetProtocol = 'applik8s.search-cursor/v1alpha1';
const legacyOrderedValuesProtocol = 'applik8s.opensearch-cursor/v1alpha1';
const maximumCursorLifetimeMs = 24 * 60 * 60 * 1_000;
const maximumEncodedCursorBytes = 64 * 1_024;

export type ApplicationSearchCursorContinuation =
  | { readonly kind: 'offset'; readonly offset: number }
  | { readonly kind: 'orderedValues'; readonly values: readonly JsonValue[] };

export interface ApplicationSearchCursor {
  readonly protocol: typeof applicationSearchCursorProtocol;
  readonly logicalIndex: string;
  readonly indexRevision: string;
  readonly physicalGeneration: string;
  readonly checkpoint: number;
  readonly principalId: string;
  readonly contextDigest: string;
  readonly authorizationVersion: string;
  readonly queryDigest: string;
  readonly continuation: ApplicationSearchCursorContinuation;
}

export interface ApplicationSearchCursorExpected {
  readonly logicalIndex: string;
  readonly indexRevision: string;
  readonly physicalGeneration: string;
  readonly checkpoint: number;
  readonly principalId: string;
  readonly contextDigest: string;
  readonly authorizationVersion: string;
  readonly queryDigest: string;
  readonly legacyQueryDigests?: readonly string[];
  readonly continuationKind: ApplicationSearchCursorContinuation['kind'];
}

export interface ApplicationSearchCursorCodec {
  encode(cursor: Omit<ApplicationSearchCursor, 'protocol'>): Promise<string>;
  decode(token: string, expected: ApplicationSearchCursorExpected): Promise<ApplicationSearchCursor>;
}

export interface ApplicationSearchCursorCodecOptions {
  readonly secret: string;
  readonly now?: () => number;
  readonly lifetimeMs?: number;
  /** Release A writes legacy so v0.7 readers remain safe during rolling deploys. */
  readonly writer?: 'legacy' | 'v1';
}

export class ApplicationSearchCursorError extends Error {
  readonly code = 'APPLIK8S_SEARCH_CURSOR_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'ApplicationSearchCursorError';
  }
}

/**
 * Framework-owned cursor codec shared by deterministic, PostgreSQL, and
 * OpenSearch providers. Providers contribute only continuation state.
 */
export function createApplicationSearchCursorCodec(
  options: ApplicationSearchCursorCodecOptions,
): ApplicationSearchCursorCodec {
  const key = signedEnvelopeUtf8Key(options.secret);
  const now = options.now ?? Date.now;
  const lifetimeMs = boundedLifetime(options.lifetimeMs ?? defaultApplicationSearchCursorLifetimeMs);
  const writer = options.writer ?? 'legacy';
  const envelope = createRollingSignedEnvelopeCodec<ApplicationSearchCursor, LegacySearchCursor>({
    purpose: applicationSearchCursorPurpose,
    keys: staticSignedEnvelopeKeyProvider({
      current: { id: 'search-cursor-current', key },
    }),
    now,
    maximumLifetimeMs: maximumCursorLifetimeMs,
    maximumEncodedBytes: maximumEncodedCursorBytes,
    validatePayload: validateCanonicalCursor,
    observe: observeApplicationRuntimeIntegrityEnvelope,
    writer,
    legacy: {
      key,
      validatePayload: validateLegacyCursor,
      toCurrent: (payload) => normalizeLegacyCursor(payload, now()),
      fromCurrent: (payload, timing) => legacyPayload(
        payload,
        timing.issuedAt,
        timing.expiresAt ?? timing.issuedAt + lifetimeMs,
      ),
    },
  });

  const codec: ApplicationSearchCursorCodec = {
    async encode(cursor) {
      const payload = validateCanonicalCursor({
        protocol: applicationSearchCursorProtocol,
        ...cursor,
      });
      const issuedAt = now();
      const expiresAt = issuedAt + lifetimeMs;
      return envelope.sign(payload, { issuedAt, expiresAt });
    },

    async decode(token, expected) {
      let cursor: ApplicationSearchCursor;
      try {
        cursor = await envelope.verify(token);
      } catch (cause) {
        throw invalidCursor(cause);
      }
      validateExpected(cursor, expected);
      return cursor;
    },
  };
  return Object.freeze(codec);
}

interface LegacySearchCursorBase {
  readonly protocol: typeof legacyOffsetProtocol | typeof legacyOrderedValuesProtocol;
  readonly logicalIndex: string;
  readonly indexRevision: string;
  readonly physicalGeneration: string;
  readonly checkpoint: number;
  readonly principalId: string;
  readonly contextDigest: string;
  readonly authorizationVersion: string;
  readonly queryDigest: string;
  readonly issuedAt?: number;
  readonly expiresAt?: number;
}

type LegacySearchCursor = LegacySearchCursorBase & (
  | { readonly protocol: typeof legacyOffsetProtocol; readonly offset: number }
  | { readonly protocol: typeof legacyOrderedValuesProtocol; readonly searchAfter: readonly JsonValue[] }
);

function legacyPayload(
  cursor: ApplicationSearchCursor,
  issuedAt: number,
  expiresAt: number,
): JsonValue {
  const common = {
    logicalIndex: cursor.logicalIndex,
    indexRevision: cursor.indexRevision,
    physicalGeneration: cursor.physicalGeneration,
    checkpoint: cursor.checkpoint,
    principalId: cursor.principalId,
    contextDigest: cursor.contextDigest,
    authorizationVersion: cursor.authorizationVersion,
    queryDigest: cursor.queryDigest,
    issuedAt,
    expiresAt,
  };
  return cursor.continuation.kind === 'offset'
    ? {
        protocol: legacyOffsetProtocol,
        ...common,
        offset: cursor.continuation.offset,
      }
    : {
        protocol: legacyOrderedValuesProtocol,
        ...common,
        searchAfter: cursor.continuation.values,
      };
}

function validateCanonicalCursor(value: JsonValue): ApplicationSearchCursor {
  if (!isRecord(value) || value.protocol !== applicationSearchCursorProtocol) {
    throw new TypeError('Search cursor protocol is invalid.');
  }
  const common = validateCommon(value);
  const continuation = value.continuation;
  if (!isRecord(continuation)) throw new TypeError('Search cursor continuation is invalid.');
  if (continuation.kind === 'offset') {
    if (!isNonNegativeSafeInteger(continuation.offset)) {
      throw new TypeError('Search cursor offset is invalid.');
    }
    return { protocol: applicationSearchCursorProtocol, ...common, continuation: { kind: 'offset', offset: continuation.offset } };
  }
  if (continuation.kind === 'orderedValues' && Array.isArray(continuation.values)) {
    const values = canonicalJsonV1Value(
      continuation.values,
      canonicalJsonStrictV1Policy,
    );
    if (!Array.isArray(values)) throw new TypeError('Search cursor ordered values are invalid.');
    return { protocol: applicationSearchCursorProtocol, ...common, continuation: { kind: 'orderedValues', values } };
  }
  throw new TypeError('Search cursor continuation kind is invalid.');
}

function validateLegacyCursor(value: JsonValue): LegacySearchCursor {
  if (!isRecord(value)) throw new TypeError('Legacy search cursor is invalid.');
  const common = validateCommon(value);
  const timing = validateLegacyTiming(value);
  if (value.protocol === legacyOffsetProtocol && isNonNegativeSafeInteger(value.offset)) {
    return { protocol: legacyOffsetProtocol, ...common, ...timing, offset: value.offset };
  }
  if (value.protocol === legacyOrderedValuesProtocol && Array.isArray(value.searchAfter)) {
    const searchAfter = canonicalJsonV1Value(value.searchAfter, canonicalJsonStrictV1Policy);
    if (!Array.isArray(searchAfter)) throw new TypeError('Legacy search cursor values are invalid.');
    return { protocol: legacyOrderedValuesProtocol, ...common, ...timing, searchAfter };
  }
  throw new TypeError('Legacy search cursor continuation is invalid.');
}

function normalizeLegacyCursor(
  cursor: LegacySearchCursor,
  now: number,
): ApplicationSearchCursor {
  if (cursor.expiresAt !== undefined && cursor.expiresAt < now) {
    throw new TypeError('Legacy search cursor has expired.');
  }
  if (
    cursor.issuedAt !== undefined
    && cursor.expiresAt !== undefined
    && cursor.expiresAt - cursor.issuedAt > maximumCursorLifetimeMs
  ) {
    throw new TypeError('Legacy search cursor lifetime is invalid.');
  }
  const common = {
    logicalIndex: cursor.logicalIndex,
    indexRevision: cursor.indexRevision,
    physicalGeneration: cursor.physicalGeneration,
    checkpoint: cursor.checkpoint,
    principalId: cursor.principalId,
    contextDigest: cursor.contextDigest,
    authorizationVersion: cursor.authorizationVersion,
    queryDigest: cursor.queryDigest,
  };
  return cursor.protocol === legacyOffsetProtocol
    ? {
        protocol: applicationSearchCursorProtocol,
        ...common,
        continuation: { kind: 'offset', offset: cursor.offset },
      }
    : {
        protocol: applicationSearchCursorProtocol,
        ...common,
        continuation: { kind: 'orderedValues', values: cursor.searchAfter },
      };
}

function validateExpected(
  cursor: ApplicationSearchCursor,
  expected: ApplicationSearchCursorExpected,
): void {
  const { continuationKind, legacyQueryDigests = [], ...common } = expected;
  for (const [key, expectedValue] of Object.entries(common)) {
    if (
      key === 'queryDigest'
      && typeof Reflect.get(cursor, key) === 'string'
      && legacyQueryDigests.includes(Reflect.get(cursor, key) as string)
    ) {
      continue;
    }
    if (Reflect.get(cursor, key) !== expectedValue) {
      throw new ApplicationSearchCursorError(
        `Search cursor ${key} does not match the current admitted query.`,
      );
    }
  }
  if (cursor.continuation.kind !== continuationKind) {
    throw new ApplicationSearchCursorError(
      'Search cursor continuation does not match the current provider.',
    );
  }
}

function validateCommon(value: Readonly<Record<string, JsonValue>>): Omit<
  ApplicationSearchCursor,
  'protocol' | 'continuation'
> {
  const stringFields = [
    'logicalIndex',
    'indexRevision',
    'physicalGeneration',
    'principalId',
    'contextDigest',
    'authorizationVersion',
    'queryDigest',
  ] as const;
  for (const field of stringFields) {
    if (typeof value[field] !== 'string' || !value[field].trim()) {
      throw new TypeError(`Search cursor ${field} is invalid.`);
    }
  }
  if (!isNonNegativeSafeInteger(value.checkpoint)) {
    throw new TypeError('Search cursor checkpoint is invalid.');
  }
  return {
    logicalIndex: value.logicalIndex as string,
    indexRevision: value.indexRevision as string,
    physicalGeneration: value.physicalGeneration as string,
    checkpoint: value.checkpoint as number,
    principalId: value.principalId as string,
    contextDigest: value.contextDigest as string,
    authorizationVersion: value.authorizationVersion as string,
    queryDigest: value.queryDigest as string,
  };
}

function validateLegacyTiming(
  value: Readonly<Record<string, JsonValue>>,
): { readonly issuedAt?: number; readonly expiresAt?: number } {
  if (value.issuedAt === undefined && value.expiresAt === undefined) return {};
  if (!isNonNegativeSafeInteger(value.issuedAt) || !isNonNegativeSafeInteger(value.expiresAt)) {
    throw new TypeError('Legacy search cursor timing is invalid.');
  }
  if (value.expiresAt <= value.issuedAt) {
    throw new TypeError('Legacy search cursor expiry is invalid.');
  }
  return { issuedAt: value.issuedAt, expiresAt: value.expiresAt };
}

function invalidCursor(cause: unknown): ApplicationSearchCursorError {
  const reason = cause instanceof Error ? cause.message : 'cursor verification failed';
  return new ApplicationSearchCursorError(`Search cursor is invalid: ${reason}`);
}

function boundedLifetime(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1_000 || value > maximumCursorLifetimeMs) {
    throw new TypeError(`Search cursor lifetime must be an integer from 1000 to ${maximumCursorLifetimeMs} milliseconds.`);
  }
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, JsonValue>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
