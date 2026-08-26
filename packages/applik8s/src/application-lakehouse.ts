// typecast-file-boundary: Lakehouse rows and cursors cross provider-neutral schema boundaries and are validated before materialization.
import { createHash } from 'node:crypto';
import { requireApplicationInvocationAdmission } from '@applik8s/client';
import { type ApplicationLakehousePublicationNode, canonicalJsonV1Value, type JsonValue } from '@applik8s/core';
import {
  createRollingSignedEnvelopeCodec,
  type RollingSignedEnvelopeCodec,
  signedEnvelopeUtf8Key,
  staticSignedEnvelopeKeyProvider,
} from '@applik8s/runtime/signed-envelope';
import type { SchemaInput } from '@applik8s/sdk';
import type {
  ApplicationLakehouseQueryProvider,
  ApplicationQualifiedProviderToken,
} from './application-providers.js';
import { declaredSchema, validateMessage } from './application-schema-runtime.js';
import { runApplicationTelemetryBoundary } from './application-telemetry-runtime.js';
import type { ApplicationMessageEnvelope, EventDefinition } from './dsl.js';

export interface QualifiedLakehouseDatasetRef {
  readonly name: string;
  readonly qualification?: { readonly name: string; readonly compatibilityRevision?: string };
}

export interface ApplicationLakehousePublication<TRow extends object> {
  readonly kind: 'applicationLakehousePublication';
  readonly event: EventDefinition<object>;
  readonly dataset: QualifiedLakehouseDatasetRef;
  readonly row: ReturnType<typeof declaredSchema>;
  readonly graphNode: ApplicationLakehousePublicationNode;
  readonly transform: (event: object) => TRow;
  readonly partition?: (row: TRow) => Readonly<Record<string, string>>;
  partitionBy(partition: (row: TRow) => Readonly<Record<string, string>>): ApplicationLakehousePublication<TRow>;
}

export interface ApplicationLakehousePublicationRuntime<TRow extends object = object> {
  append(options: {
    readonly frontier: string;
    readonly rows: readonly TRow[];
    readonly partitions?: readonly Readonly<Record<string, string>>[];
    readonly expectedSnapshot?: string;
  }): Promise<ApplicationLakehouseManifest<TRow>>;
}

type ErasedApplicationLakehousePublicationRuntime = ApplicationLakehousePublicationRuntime<object>;

const lakehousePublicationRuntimeResolvers: Array<(
  qualification: string,
) => ErasedApplicationLakehousePublicationRuntime | undefined> = [];

export function installApplicationLakehousePublicationRuntimeResolver<TRow extends object>(
  resolver: (qualification: string) => ApplicationLakehousePublicationRuntime<TRow> | undefined,
): () => void {
  const erasedResolver = (qualification: string): ErasedApplicationLakehousePublicationRuntime | undefined =>
    resolver(qualification) as unknown as ErasedApplicationLakehousePublicationRuntime | undefined;
  lakehousePublicationRuntimeResolvers.push(erasedResolver);
  return () => {
    const index = lakehousePublicationRuntimeResolvers.lastIndexOf(erasedResolver);
    if (index >= 0) lakehousePublicationRuntimeResolvers.splice(index, 1);
  };
}

/** Framework worker entrypoint for one admitted source fact. */
export async function executeApplicationLakehousePublication<TRow extends object>(
  publication: ApplicationLakehousePublication<TRow>,
  envelope: Pick<ApplicationMessageEnvelope<object>, 'id' | 'payload'>,
): Promise<ApplicationLakehouseManifest<TRow>> {
  const qualification = publication.dataset.qualification?.name;
  if (!qualification) throw new Error('Lakehouse publication lost its qualified dataset identity.');
  const payload = validateMessage(publication.event.payload, envelope.payload, `${publication.event.id}.payload`);
  const row = publication.transform(payload);
  const partitions = publication.partition ? [validateLakehousePartition(publication.partition(row))] : undefined;
  for (let index = lakehousePublicationRuntimeResolvers.length - 1; index >= 0; index -= 1) {
    const runtime = lakehousePublicationRuntimeResolvers[index]?.(qualification) as unknown as ApplicationLakehousePublicationRuntime<TRow> | undefined;
    if (runtime) {
      // The broker consumer owns the one retry-aware semantic event boundary.
      // This function owns only idempotent publication into the selected
      // dataset so direct calls and consumer retries cannot double-count the
      // same event as nested business spans.
      return runtime.append({ frontier: envelope.id, rows: [row], ...(partitions ? { partitions } : {}) });
    }
  }
  throw new Error(`No LakehouseDataset publication runtime is installed for qualified provider ${qualification}.`);
}

export type ApplicationLakehouseScalar = string | number | boolean | null;

export interface ApplicationLakehousePredicate {
  readonly kind: 'applicationLakehousePredicate';
  and(other: ApplicationLakehousePredicate): ApplicationLakehousePredicate;
  or(other: ApplicationLakehousePredicate): ApplicationLakehousePredicate;
}

export interface ApplicationLakehouseOrder {
  readonly kind: 'applicationLakehouseOrder';
}

export type ApplicationLakehouseFieldExpression<T> = {
  eq(value: T): ApplicationLakehousePredicate;
  ne(value: T): ApplicationLakehousePredicate;
  lt(value: T): ApplicationLakehousePredicate;
  lte(value: T): ApplicationLakehousePredicate;
  gt(value: T): ApplicationLakehousePredicate;
  gte(value: T): ApplicationLakehousePredicate;
  asc(): ApplicationLakehouseOrder;
  desc(): ApplicationLakehouseOrder;
};

export type ApplicationLakehouseRowExpression<TRow extends object> = {
  readonly [K in keyof TRow]-?: TRow[K] extends ApplicationLakehouseScalar
    ? ApplicationLakehouseFieldExpression<TRow[K]>
    : TRow[K] extends object
      ? ApplicationLakehouseRowExpression<TRow[K]>
      : never;
};

export interface ApplicationLakehouseComparisonExpression {
  readonly kind: 'comparison';
  readonly path: readonly string[];
  readonly operator: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte';
  readonly value: ApplicationLakehouseScalar;
}

export interface ApplicationLakehouseLogicalExpression {
  readonly kind: 'and' | 'or';
  readonly operands: readonly ApplicationLakehouseFilterExpression[];
}

export type ApplicationLakehouseFilterExpression = ApplicationLakehouseComparisonExpression | ApplicationLakehouseLogicalExpression;

export interface ApplicationLakehouseOrderExpression {
  readonly path: readonly string[];
  readonly direction: 'asc' | 'desc';
}

export interface CompiledApplicationLakehouseQuery {
  readonly where?: ApplicationLakehouseFilterExpression;
  readonly orderBy: readonly ApplicationLakehouseOrderExpression[];
}

export interface ApplicationLakehouseQueryRequest<TRow extends object> {
  readonly dataset: { readonly name: string; readonly qualification?: { readonly name: string } };
  readonly snapshot?: 'latest-published' | string;
  readonly where?: (row: ApplicationLakehouseRowExpression<TRow>) => ApplicationLakehousePredicate;
  readonly orderBy?: (row: ApplicationLakehouseRowExpression<TRow>) => readonly ApplicationLakehouseOrder[];
  readonly page?: { readonly size: number; readonly cursor?: string };
  readonly timeout?: string;
  /** @internal Framework-derived cursor scope. Application code uses ApplicationLakehouseQueryInput. */
  readonly principalScope?: string;
  readonly signal?: AbortSignal;
}

export type ApplicationLakehouseQueryInput<TRow extends object> = Omit<
  ApplicationLakehouseQueryRequest<TRow>,
  'principalScope'
>;

export type ApplicationLakehouseQueryTerminalState =
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timed-out'
  | 'cancellation-pending'
  | 'outcome-unknown'
  | 'expired';

export interface ApplicationLakehouseQueryReceipt {
  readonly schemaVersion: 'applik8s.lakehouseQueryReceipt/v1alpha1';
  /** Stable admission identity. Provider execution identities remain evidence. */
  readonly queryId: string;
  readonly dataset: string;
  readonly state: ApplicationLakehouseQueryTerminalState;
  readonly snapshot?: string;
  readonly schemaRevision?: string;
  readonly provider?: 'deterministic' | 'duckdb' | 'athena';
  readonly providerQueryId?: string;
  readonly diagnostic?: string;
}

export type ApplicationLakehouseQueryFailureReceipt = ApplicationLakehouseQueryReceipt & {
  readonly state: Exclude<ApplicationLakehouseQueryTerminalState, 'succeeded'>;
};

/**
 * A failed query remains an ordinary rejected Promise, but carries the durable,
 * provider-neutral terminal receipt needed by retries, UIs, and reconciliation.
 */
export class ApplicationLakehouseQueryTerminalError extends Error {
  readonly code = 'APPLIK8S_LAKEHOUSE_QUERY_TERMINAL';

  constructor(readonly receipt: ApplicationLakehouseQueryFailureReceipt, options: { readonly cause?: unknown } = {}) {
    super(receipt.diagnostic ?? `Lakehouse query ${receipt.queryId} ended in ${receipt.state}.`, options);
    this.name = receipt.state === 'cancelled'
      ? 'AbortError'
      : receipt.state === 'timed-out'
        ? 'TimeoutError'
        : 'ApplicationLakehouseQueryTerminalError';
  }
}

export interface ApplicationLakehouseQueryResult<TRow extends object> {
  readonly state: 'succeeded';
  readonly queryId: string;
  readonly snapshot: string;
  readonly schemaRevision: string;
  readonly rows: readonly TRow[];
  readonly cursor?: string;
  readonly scannedBytes: number;
  readonly receipt: ApplicationLakehouseQueryReceipt & {
    readonly state: 'succeeded';
    readonly snapshot: string;
    readonly schemaRevision: string;
  };
  readonly evidence?: {
    readonly provider: 'deterministic' | 'duckdb' | 'athena';
    readonly target?: 'local' | 'aws-local' | 'aws' | 'kubernetes';
    readonly durationMs: number;
    readonly cost: { readonly kind: 'unavailable' | 'scanned-bytes'; readonly scannedBytes: number };
  };
}

export function applicationLakehouseQueryIdentity(value: {
  readonly dataset: string;
  readonly snapshot?: string;
  readonly queryShape?: string;
  readonly offset?: number;
}): string {
  return `query_${stableDigest(value).slice(7)}`;
}

export function applicationLakehouseQueryTerminalError(
  receipt: Omit<ApplicationLakehouseQueryFailureReceipt, 'schemaVersion'>,
  cause?: unknown,
): ApplicationLakehouseQueryTerminalError {
  return new ApplicationLakehouseQueryTerminalError(Object.freeze({
    schemaVersion: 'applik8s.lakehouseQueryReceipt/v1alpha1',
    ...receipt,
  }), cause === undefined ? {} : { cause });
}

export interface ApplicationLakehouseQueryRuntime<TRow extends object = object> {
  query(request: ApplicationLakehouseQueryRequest<TRow>): Promise<ApplicationLakehouseQueryResult<TRow>>;
}

export interface ApplicationLakehouseCursorPayload {
  readonly snapshot: string;
  readonly queryShape: string;
  readonly principalScope: string;
  readonly offset: number;
  readonly expiresAt: number;
}

export function createApplicationLakehouseCursorCodec(
  key: string,
  now: () => number = Date.now,
): RollingSignedEnvelopeCodec<ApplicationLakehouseCursorPayload> {
  const keyBytes = signedEnvelopeUtf8Key(key);
  return createRollingSignedEnvelopeCodec<ApplicationLakehouseCursorPayload, ApplicationLakehouseCursorPayload>({
    purpose: 'applik8s.lakehouse-cursor/v1',
    keys: staticSignedEnvelopeKeyProvider({
      current: { id: 'lakehouse-cursor-current', key: keyBytes },
    }),
    now,
    maximumLifetimeMs: 15 * 60_000,
    maximumEncodedBytes: 64 * 1_024,
    validatePayload: validateApplicationLakehouseCursorPayload,
    writer: 'legacy',
    legacy: {
      key: keyBytes,
      validatePayload: validateApplicationLakehouseCursorPayload,
      toCurrent: (payload) => payload,
      fromCurrent: (payload) => canonicalJsonV1Value(payload),
    },
  });
}

export type ApplicationLakehouseQueryRegistrar = <TRow extends object>(
  request: ApplicationLakehouseQueryInput<TRow>,
) => Promise<ApplicationLakehouseQueryResult<TRow>>;

export interface ApplicationLakehouseDatasetQueryContract<TInput extends object, TOutput extends object> {
  readonly input: SchemaInput<TInput>;
  readonly output: SchemaInput<TOutput>;
}

/**
 * Ordinary validated TypeScript query composed around a lakehouse dataset.
 * The closure remains the application operation; provider calls captured by
 * it are discovered and lowered independently by the compiler.
 */
export function createApplicationLakehouseDatasetQuery<TInput extends object, TOutput extends object>(
  dataset: QualifiedLakehouseDatasetRef,
  contract: ApplicationLakehouseDatasetQueryContract<TInput, TOutput>,
  handler: (input: TInput) => TOutput | Promise<TOutput>,
): (input: TInput) => Promise<TOutput> {
  const qualification = dataset.qualification?.name;
  if (!qualification) throw new Error('Lakehouse dataset queries require LakehouseDataset.named(...).');
  return async (input) => {
    const admitted = validateMessage(contract.input, input, `${qualification}.query.input`);
    return runApplicationTelemetryBoundary({ kind: 'query', identity: `lakehouse.${qualification}` }, async () =>
      validateMessage(contract.output, await handler(admitted), `${qualification}.query.output`));
  };
}

type ErasedApplicationLakehouseQueryRuntime = ApplicationLakehouseQueryRuntime<object>;

const lakehouseRuntimeResolvers: Array<(qualification: string) => ErasedApplicationLakehouseQueryRuntime | undefined> = [];

export function installApplicationLakehouseQueryRuntimeResolver<TRow extends object>(
  resolver: (qualification: string) => ApplicationLakehouseQueryRuntime<TRow> | undefined,
): () => void {
  const erasedResolver = (qualification: string): ErasedApplicationLakehouseQueryRuntime | undefined =>
    resolver(qualification) as unknown as ErasedApplicationLakehouseQueryRuntime | undefined;
  lakehouseRuntimeResolvers.push(erasedResolver);
  return () => {
    const index = lakehouseRuntimeResolvers.lastIndexOf(erasedResolver);
    if (index >= 0) lakehouseRuntimeResolvers.splice(index, 1);
  };
}

export async function createApplicationLakehouseQuery<TRow extends object>(
  provider: ApplicationQualifiedProviderToken<ApplicationLakehouseQueryProvider>,
  request: ApplicationLakehouseQueryInput<TRow>,
): Promise<ApplicationLakehouseQueryResult<TRow>> {
  const qualification = provider.qualification.name;
  const admission = requireApplicationInvocationAdmission();
  const scopedRequest: ApplicationLakehouseQueryRequest<TRow> = {
    ...request,
    principalScope: `admission_${stableDigest({
      principalId: admission.principal.id,
      authorityRevision: admission.authorityRevision,
      trustedContextDigest: admission.trustedContext.digest,
    }).slice(7)}`,
  };
  for (let index = lakehouseRuntimeResolvers.length - 1; index >= 0; index -= 1) {
    const runtime = lakehouseRuntimeResolvers[index]?.(qualification);
    if (runtime) return (runtime as unknown as ApplicationLakehouseQueryRuntime<TRow>).query(scopedRequest);
  }
  throw new Error(`No LakehouseQuery runtime is installed for qualified provider ${qualification}.`);
}

const lakehouseExpression = Symbol('applik8s.lakehouseExpression');

type InternalPredicate = ApplicationLakehousePredicate & { readonly [lakehouseExpression]: ApplicationLakehouseFilterExpression };
type InternalOrder = ApplicationLakehouseOrder & { readonly [lakehouseExpression]: ApplicationLakehouseOrderExpression };

export function compileApplicationLakehouseQuery<TRow extends object>(
  request: Pick<ApplicationLakehouseQueryRequest<TRow>, 'where' | 'orderBy'>,
): CompiledApplicationLakehouseQuery {
  const row = lakehouseRowExpression([]) as ApplicationLakehouseRowExpression<TRow>;
  const predicate = request.where?.(row);
  const orders = request.orderBy?.(row) ?? [];
  const where = predicate === undefined ? undefined : internalPredicate(predicate);
  const orderBy = orders.map((order) => internalOrder(order));
  const identities = new Set<string>();
  for (const order of orderBy) {
    const identity = order.path.join('.');
    if (identities.has(identity)) throw new Error(`Lakehouse order repeats field ${identity}.`);
    identities.add(identity);
  }
  return Object.freeze({ ...(where ? { where } : {}), orderBy: Object.freeze(orderBy) });
}

export function evaluateApplicationLakehouseFilter(row: object, expression: ApplicationLakehouseFilterExpression | undefined): boolean {
  if (!expression) return true;
  switch (expression.kind) {
    case 'and': return expression.operands.every((operand) => evaluateApplicationLakehouseFilter(row, operand));
    case 'or': return expression.operands.some((operand) => evaluateApplicationLakehouseFilter(row, operand));
    case 'comparison': {
      const actual = lakehousePathValue(row, expression.path);
      switch (expression.operator) {
        case 'eq': return actual === expression.value;
        case 'ne': return actual !== expression.value;
        case 'lt': return compareLakehouseScalar(actual, expression.value) < 0;
        case 'lte': return compareLakehouseScalar(actual, expression.value) <= 0;
        case 'gt': return compareLakehouseScalar(actual, expression.value) > 0;
        case 'gte': return compareLakehouseScalar(actual, expression.value) >= 0;
      }
    }
  }
}

export function compareApplicationLakehouseRows(
  left: object,
  right: object,
  orderBy: readonly ApplicationLakehouseOrderExpression[],
): number {
  for (const order of orderBy) {
    const comparison = compareLakehouseScalar(lakehousePathValue(left, order.path), lakehousePathValue(right, order.path));
    if (comparison !== 0) return order.direction === 'asc' ? comparison : -comparison;
  }
  return 0;
}

function lakehouseRowExpression(path: readonly string[]): object {
  return new Proxy(Object.create(null) as object, {
    get(_target, property) {
      if (typeof property !== 'string') return undefined;
      const next = [...path, property];
      if (['eq', 'ne', 'lt', 'lte', 'gt', 'gte'].includes(property)) {
        const operator = property as ApplicationLakehouseComparisonExpression['operator'];
        const fieldPath = path;
        return (value: ApplicationLakehouseScalar): InternalPredicate => predicateHandle({ kind: 'comparison', path: fieldPath, operator, value });
      }
      if (property === 'asc' || property === 'desc') {
        const direction: 'asc' | 'desc' = property;
        return (): InternalOrder => Object.freeze({ kind: 'applicationLakehouseOrder', [lakehouseExpression]: { path, direction } });
      }
      return lakehouseRowExpression(next);
    },
  });
}

function predicateHandle(expression: ApplicationLakehouseFilterExpression): InternalPredicate {
  const combine = (kind: 'and' | 'or', other: ApplicationLakehousePredicate): InternalPredicate => {
    const right = internalPredicate(other);
    const leftOperands = expression.kind === kind ? expression.operands : [expression];
    const rightOperands = right.kind === kind ? right.operands : [right];
    return predicateHandle({ kind, operands: [...leftOperands, ...rightOperands] });
  };
  return Object.freeze({
    kind: 'applicationLakehousePredicate',
    [lakehouseExpression]: expression,
    and: (other: ApplicationLakehousePredicate) => combine('and', other),
    or: (other: ApplicationLakehousePredicate) => combine('or', other),
  });
}

function internalPredicate(value: ApplicationLakehousePredicate): ApplicationLakehouseFilterExpression {
  const expression = (value as Partial<InternalPredicate>)[lakehouseExpression];
  if (!expression) throw new Error('Lakehouse where(...) must return a predicate created from the supplied row expression.');
  return expression;
}

function internalOrder(value: ApplicationLakehouseOrder): ApplicationLakehouseOrderExpression {
  const expression = (value as Partial<InternalOrder>)[lakehouseExpression];
  if (!expression) throw new Error('Lakehouse orderBy(...) must return asc()/desc() expressions created from the supplied row expression.');
  return expression;
}

function lakehousePathValue(row: object, path: readonly string[]): ApplicationLakehouseScalar | undefined {
  let value: unknown = row;
  for (const segment of path) {
    if (!value || typeof value !== 'object') return undefined;
    value = Reflect.get(value, segment);
  }
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null ? value : undefined;
}

function compareLakehouseScalar(left: ApplicationLakehouseScalar | undefined, right: ApplicationLakehouseScalar | undefined): number {
  if (left === right) return 0;
  if (left === undefined || left === null) return -1;
  if (right === undefined || right === null) return 1;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  if (typeof left === 'boolean' && typeof right === 'boolean') return Number(left) - Number(right);
  return String(left).localeCompare(String(right), 'en', { numeric: true });
}

export function validateLakehousePartition(value: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Lakehouse partition must be a string record.');
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) throw new Error('Lakehouse partition must contain at least one field.');
  const normalized: Record<string, string> = {};
  for (const [key, item] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(key)) throw new Error(`Lakehouse partition key ${JSON.stringify(key)} is invalid.`);
    if (typeof item !== 'string' || item.length === 0 || item.length > 256 || /[\0\r\n]/u.test(item)) {
      throw new Error(`Lakehouse partition ${key} must be a non-empty bounded string.`);
    }
    normalized[key] = item;
  }
  return Object.freeze(normalized);
}

export interface ApplicationLakehouseManifest<TRow extends object> {
  readonly schemaVersion: 'applik8s.lakehouseManifest/v1alpha1';
  readonly datasetId: string;
  readonly snapshotId: string;
  readonly schemaRevision: string;
  readonly schema: {
    readonly family: string;
    readonly revision: string;
    readonly fingerprint: string;
    readonly jsonSchema: Readonly<Record<string, unknown>>;
  };
  readonly parentSnapshotId?: string;
  readonly frontier: readonly string[];
  readonly rows: readonly TRow[];
  /** Stable framework-owned row identities used only as a pagination tie-breaker. */
  readonly rowIdentities: readonly string[];
  readonly objects: readonly {
    readonly objectId: string;
    readonly digest: string;
    readonly rowOffset: number;
    readonly rowCount: number;
    readonly bytes: number;
  }[];
  readonly partitions?: readonly Readonly<Record<string, string>>[];
  readonly publishedAt: string;
  readonly lifecycle: {
    readonly disposition: 'incremental' | 'compacted';
    readonly maximumObjectsPerSnapshot: number;
    readonly retainedSnapshots: number;
  };
  readonly digest: string;
}

export interface DeterministicApplicationLakehouseRuntime<TRow extends object> extends ApplicationLakehouseQueryRuntime<TRow> {
  append(options: { readonly frontier: string; readonly rows: readonly TRow[]; readonly partitions?: readonly Readonly<Record<string, string>>[]; readonly expectedSnapshot?: string }): Promise<ApplicationLakehouseManifest<TRow>>;
  current(): ApplicationLakehouseManifest<TRow> | undefined;
  snapshots(): readonly ApplicationLakehouseManifest<TRow>[];
}

export interface ApplicationLakehouseSchemaCompatibility {
  readonly compatible: boolean;
  readonly changes: readonly string[];
  readonly reasons: readonly string[];
}

/**
 * Proves the deliberately narrow v0.8 portable evolution rule: existing
 * fields keep identical JSON semantics and a new field must be optional.
 * Anything richer requires a rebuild or a new dataset identity.
 */
export function classifyApplicationLakehouseSchemaEvolution(
  previous: Readonly<Record<string, unknown>>,
  next: Readonly<Record<string, unknown>>,
): ApplicationLakehouseSchemaCompatibility {
  const previousProperties = lakehouseSchemaProperties(previous);
  const nextProperties = lakehouseSchemaProperties(next);
  const previousRequired = new Set(lakehouseRequiredFields(previous));
  const nextRequired = new Set(lakehouseRequiredFields(next));
  const changes: string[] = [];
  const reasons: string[] = [];
  for (const [name, property] of Object.entries(previousProperties)) {
    if (!(name in nextProperties)) {
      reasons.push(`existing field ${name} was removed`);
      continue;
    }
    if (stableJson(property) !== stableJson(nextProperties[name])) {
      reasons.push(`existing field ${name} changed its portable schema`);
    }
    if (previousRequired.has(name) !== nextRequired.has(name)) {
      reasons.push(`existing field ${name} changed requiredness`);
    }
  }
  for (const name of Object.keys(nextProperties).sort()) {
    if (name in previousProperties) continue;
    if (nextRequired.has(name)) reasons.push(`new field ${name} is required`);
    else changes.push(`added optional field ${name}`);
  }
  if (stableJson(previous.additionalProperties ?? false) !== stableJson(next.additionalProperties ?? false)) {
    reasons.push('additionalProperties semantics changed');
  }
  return Object.freeze({ compatible: reasons.length === 0, changes: Object.freeze(changes), reasons: Object.freeze(reasons) });
}

export function createDeterministicApplicationLakehouseRuntime<TRow extends object>(options: {
  readonly datasetId: string;
  readonly schemaRevision: string;
  readonly schema: SchemaInput<TRow>;
  readonly cursorKey: string;
  readonly now?: () => Date;
  readonly snapshots?: readonly ApplicationLakehouseManifest<TRow>[];
  readonly persist?: (snapshots: readonly ApplicationLakehouseManifest<TRow>[]) => void | Promise<void>;
  readonly maximumObjectsPerSnapshot?: number;
  readonly retainedSnapshots?: number;
}): DeterministicApplicationLakehouseRuntime<TRow> {
  if (!options.datasetId.trim() || !options.schemaRevision.trim()) throw new Error('Lakehouse dataset and schema revision must be non-empty.');
  if (options.cursorKey.length < 32) throw new Error('Lakehouse cursorKey must contain at least 32 characters.');
  // ArkType may lazily normalize its JSON-schema object after first use. The
  // published manifest must own an immutable value snapshot, never that live
  // authoring object, or later schema work can invalidate its signed digest.
  const schemaJson = deepFreezeJson(JSON.parse(JSON.stringify(declaredSchema(options.schema, `${options.datasetId}.row`).jsonSchema))) as Readonly<Record<string, unknown>>;
  const schemaFingerprint = stableDigest(schemaJson);
  const schemaFamily = options.datasetId;
  const maximumObjectsPerSnapshot = lakehouseBoundedInteger(options.maximumObjectsPerSnapshot ?? 64, 1, 10_000, 'maximumObjectsPerSnapshot');
  const retainedSnapshots = lakehouseBoundedInteger(options.retainedSnapshots ?? 256, 1, 100_000, 'retainedSnapshots');
  const orderedManifests = (options.snapshots ?? []).map((snapshot) => {
    const value = JSON.parse(JSON.stringify(snapshot)) as ApplicationLakehouseManifest<TRow>;
    verifyManifest(value, options.datasetId);
    return deepFreezeJson(value);
  });
  const manifests = new Map(orderedManifests.map((snapshot) => [snapshot.snapshotId, snapshot]));
  if (manifests.size !== orderedManifests.length) throw new Error(`Lakehouse dataset ${options.datasetId} restored duplicate snapshot identities.`);
  const frontier = new Map<string, ApplicationLakehouseManifest<TRow>>();
  for (const manifest of orderedManifests) {
    for (const identity of manifest.frontier) if (!frontier.has(identity)) frontier.set(identity, manifest);
  }
  let current = orderedManifests.at(-1);
  if (current) {
    if (current.schema.family !== schemaFamily) throw new Error(`Lakehouse dataset ${options.datasetId} changed schema family.`);
    if (current.schemaRevision === options.schemaRevision && current.schema.fingerprint !== schemaFingerprint) {
      throw new Error(`Lakehouse schema revision ${options.schemaRevision} changed without a new revision identity.`);
    }
    if (current.schemaRevision !== options.schemaRevision) {
      const evolution = classifyApplicationLakehouseSchemaEvolution(current.schema.jsonSchema, schemaJson);
      if (!evolution.compatible) {
        throw new Error(`Lakehouse schema ${current.schemaRevision} -> ${options.schemaRevision} requires an explicit rebuild or new dataset identity: ${evolution.reasons.join('; ')}.`);
      }
    }
  }
  const persist = async (values = [...manifests.values()]): Promise<void> => options.persist?.(values);
  const now = options.now ?? (() => new Date());
  const cursorCodec = createApplicationLakehouseCursorCodec(options.cursorKey, () => now().getTime());
  let publicationTail: Promise<void> = Promise.resolve();
  const serializePublication = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = publicationTail.then(operation, operation);
    publicationTail = result.then(() => undefined, () => undefined);
    return result;
  };
  return {
    append(request) {
      return serializePublication(async () => {
        if (!request.frontier.trim()) throw new Error('Lakehouse publication frontier must be non-empty.');
        const priorFrontier = frontier.get(request.frontier);
        if (priorFrontier) return priorFrontier;
        if (request.expectedSnapshot !== undefined && request.expectedSnapshot !== current?.snapshotId) {
          throw new Error(`Lakehouse publication conflict: expected ${request.expectedSnapshot}, current ${current?.snapshotId ?? 'none'}.`);
        }
        const rows = request.rows.map((row) => validateMessage(options.schema, row, `${options.datasetId}.row`));
        if (request.partitions && request.partitions.length !== rows.length) {
          throw new Error('Lakehouse publication must provide exactly one partition record per row.');
        }
        const partitions = request.partitions?.map(validateLakehousePartition);
        const publishedAt = now().toISOString();
        const allRows = [...(current?.rows ?? []), ...rows];
        const rowIdentities = [
          ...(current?.rowIdentities ?? []),
          ...rows.map((row, index) => stableDigest({ frontier: request.frontier, index, row })),
        ];
        const previousObjects = current?.objects ?? [];
        const appendedObject = rows.length > 0
          ? lakehouseObjectEvidence(rows, rowIdentities.slice(rowIdentities.length - rows.length), current?.rows.length ?? 0)
          : undefined;
        const compacted = previousObjects.length + (appendedObject ? 1 : 0) > maximumObjectsPerSnapshot;
        const objects = compacted
          ? (allRows.length > 0 ? [lakehouseObjectEvidence(allRows, rowIdentities, 0)] : [])
          : [...previousObjects, ...(appendedObject ? [appendedObject] : [])];
        const content = {
          datasetId: options.datasetId,
          schemaRevision: options.schemaRevision,
          schema: {
            family: schemaFamily,
            revision: options.schemaRevision,
            fingerprint: schemaFingerprint,
            jsonSchema: schemaJson,
          },
          ...(current?.snapshotId ? { parentSnapshotId: current.snapshotId } : {}),
          frontier: [...(current?.frontier ?? []), request.frontier].sort(),
          rows: allRows,
          rowIdentities,
          objects,
          ...(partitions ? { partitions: [...(current?.partitions ?? []), ...partitions] } : current?.partitions ? { partitions: current.partitions } : {}),
          publishedAt,
          lifecycle: {
            disposition: compacted ? 'compacted' as const : 'incremental' as const,
            maximumObjectsPerSnapshot,
            retainedSnapshots,
          },
        };
        const digest = stableDigest(content);
        const manifest: ApplicationLakehouseManifest<TRow> = deepFreezeJson({
          schemaVersion: 'applik8s.lakehouseManifest/v1alpha1',
          ...content,
          objects,
          snapshotId: `snapshot_${digest.slice(7)}`,
          digest,
        });
        const retained = [...manifests.values(), manifest].slice(-retainedSnapshots);
        await persist(retained);
        manifests.clear();
        for (const retainedManifest of retained) manifests.set(retainedManifest.snapshotId, retainedManifest);
        current = manifest;
        frontier.clear();
        for (const retainedManifest of retained) {
          for (const identity of retainedManifest.frontier) if (!frontier.has(identity)) frontier.set(identity, retainedManifest);
        }
        return manifest;
      });
    },
    async query(request) {
      const startedAt = Date.now();
      const qualification = request.dataset.qualification?.name;
      if (!qualification || qualification !== options.datasetId) throw new Error(`Lakehouse query targets ${qualification ?? '<unqualified>'}, not ${options.datasetId}.`);
      const snapshot = request.snapshot && request.snapshot !== 'latest-published'
        ? manifests.get(request.snapshot)
        : current;
      if (!snapshot) throw new Error(`Published lakehouse snapshot ${request.snapshot ?? 'latest-published'} does not exist.`);
      const pageSize = request.page?.size ?? 200;
      if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1_000) throw new Error('Lakehouse page size must be between 1 and 1000.');
      const compiled = compileApplicationLakehouseQuery(request);
      const queryShape = stableDigest({ dataset: options.datasetId, snapshot: snapshot.snapshotId, compiled, pageSize, principalScope: request.principalScope ?? 'anonymous' });
      const cursorIdentity = applicationLakehouseQueryIdentity({ dataset: options.datasetId, snapshot: snapshot.snapshotId, queryShape });
      const offset = request.page?.cursor ? await decodeCursor(cursorCodec, request.page.cursor, {
        dataset: options.datasetId,
        snapshot: snapshot.snapshotId,
        schemaRevision: snapshot.schemaRevision,
        queryShape,
        principalScope: request.principalScope ?? 'anonymous',
        queryId: cursorIdentity,
      }, now().getTime()) : 0;
      const queryId = applicationLakehouseQueryIdentity({ dataset: options.datasetId, snapshot: snapshot.snapshotId, queryShape, offset });
      if (request.signal?.aborted) {
        throw applicationLakehouseQueryTerminalError({
          queryId,
          dataset: options.datasetId,
          snapshot: snapshot.snapshotId,
          schemaRevision: snapshot.schemaRevision,
          provider: 'deterministic',
          state: 'cancelled',
          diagnostic: 'Lakehouse query was cancelled before execution.',
        }, request.signal.reason);
      }
      const encoded = JSON.stringify(snapshot.rows);
      let rows = snapshot.rows
        .map((row, index) => {
          const identity = snapshot.rowIdentities[index];
          if (!identity) throw new Error(`Lakehouse snapshot ${snapshot.snapshotId} is missing row identity ${index}.`);
          return { row, identity };
        })
        .filter(({ row }) => evaluateApplicationLakehouseFilter(row, compiled.where));
      if (compiled.orderBy.length > 0) rows = [...rows].sort((left, right) =>
        compareApplicationLakehouseRows(left.row, right.row, compiled.orderBy) || left.identity.localeCompare(right.identity));
      const page = rows.slice(offset, offset + pageSize).map(({ row }) => row);
      const nextOffset = offset + page.length;
      if (nextOffset < rows.length && compiled.orderBy.length === 0) {
        throw new Error('Lakehouse pagination requires deterministic orderBy fields.');
      }
      if (request.signal?.aborted) {
        throw applicationLakehouseQueryTerminalError({
          queryId,
          dataset: options.datasetId,
          snapshot: snapshot.snapshotId,
          schemaRevision: snapshot.schemaRevision,
          provider: 'deterministic',
          state: 'cancelled',
          diagnostic: 'Lakehouse query was cancelled.',
        }, request.signal.reason);
      }
      return {
        state: 'succeeded' as const,
        queryId,
        snapshot: snapshot.snapshotId,
        schemaRevision: snapshot.schemaRevision,
        rows: page,
        ...(nextOffset < rows.length ? { cursor: await encodeCursor(cursorCodec, { snapshot: snapshot.snapshotId, queryShape, principalScope: request.principalScope ?? 'anonymous', offset: nextOffset, expiresAt: now().getTime() + 900_000 }) } : {}),
        scannedBytes: Buffer.byteLength(encoded, 'utf8'),
        receipt: {
          schemaVersion: 'applik8s.lakehouseQueryReceipt/v1alpha1',
          queryId,
          dataset: options.datasetId,
          state: 'succeeded' as const,
          snapshot: snapshot.snapshotId,
          schemaRevision: snapshot.schemaRevision,
          provider: 'deterministic',
        },
        evidence: {
          provider: 'deterministic',
          durationMs: Math.max(0, Date.now() - startedAt),
          cost: { kind: 'scanned-bytes', scannedBytes: Buffer.byteLength(encoded, 'utf8') },
        },
      };
    },
    current: () => current,
    snapshots: () => [...manifests.values()],
  };
}

/** Validates one persisted manifest before a provider may trust it as query authority. */
export function verifyApplicationLakehouseManifest<TRow extends object>(
  manifest: ApplicationLakehouseManifest<TRow>,
  datasetId: string,
): ApplicationLakehouseManifest<TRow> {
  if (manifest.schemaVersion !== 'applik8s.lakehouseManifest/v1alpha1' || manifest.datasetId !== datasetId) throw new Error('Lakehouse manifest belongs to another dataset or schema version.');
  const actualSchemaFingerprint = manifest.schema ? stableDigest(manifest.schema.jsonSchema) : undefined;
  if (!manifest.schema || manifest.schema.family !== datasetId || manifest.schema.revision !== manifest.schemaRevision || actualSchemaFingerprint !== manifest.schema.fingerprint) {
    throw new Error(`Lakehouse manifest ${manifest.snapshotId} has invalid schema authority${manifest.schema ? `: expected ${manifest.schema.fingerprint}, observed ${actualSchemaFingerprint}.` : '.'}`);
  }
  if (!Array.isArray(manifest.rowIdentities) || manifest.rowIdentities.length !== manifest.rows.length || manifest.rowIdentities.some((identity) => !/^sha256:[a-f0-9]{64}$/u.test(identity))) {
    throw new Error(`Lakehouse manifest ${manifest.snapshotId} has invalid stable row identities.`);
  }
  let expectedOffset = 0;
  if (!Array.isArray(manifest.objects) || (manifest.rows.length > 0 && manifest.objects.length === 0) || manifest.objects.some((object) => {
    if (object.rowOffset !== expectedOffset || object.rowCount < 1 || object.bytes < 0) return true;
    const end = object.rowOffset + object.rowCount;
    const rows = manifest.rows.slice(object.rowOffset, end);
    const identities = manifest.rowIdentities.slice(object.rowOffset, end);
    expectedOffset = end;
    const evidence = lakehouseObjectEvidence(rows, identities, object.rowOffset);
    return object.objectId !== evidence.objectId || object.digest !== evidence.digest || object.bytes !== evidence.bytes;
  }) || expectedOffset !== manifest.rows.length) {
    throw new Error(`Lakehouse manifest ${manifest.snapshotId} has invalid immutable object evidence.`);
  }
  const { digest, snapshotId: _snapshotId, schemaVersion: _schemaVersion, ...content } = manifest;
  if (stableDigest(content) !== digest) throw new Error(`Lakehouse manifest ${manifest.snapshotId} failed its integrity digest.`);
  return manifest;
}

const verifyManifest = verifyApplicationLakehouseManifest;

function lakehouseObjectEvidence<TRow extends object>(
  rows: readonly TRow[],
  rowIdentities: readonly string[],
  rowOffset: number,
): ApplicationLakehouseManifest<TRow>['objects'][number] {
  if (rows.length !== rowIdentities.length || rows.length === 0) throw new Error('Lakehouse immutable objects require one stable identity per row.');
  const content = rows.map((row, index) => ({ ...row, __applik8s_row_id: rowIdentities[index] }));
  const encoded = `${content.map((row) => JSON.stringify(row)).join('\n')}\n`;
  const digest = stableDigest(encoded);
  return Object.freeze({ objectId: `object_${digest.slice(7)}`, digest, rowOffset, rowCount: rows.length, bytes: Buffer.byteLength(encoded, 'utf8') });
}

function lakehouseBoundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`Lakehouse ${label} must be from ${minimum} through ${maximum}.`);
  return value;
}

function lakehouseSchemaProperties(schema: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  if (schema.type !== 'object' || !schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties)) {
    throw new Error('Lakehouse schema evolution requires a closed object schema with explicit properties.');
  }
  return schema.properties as Readonly<Record<string, unknown>>;
}

function lakehouseRequiredFields(schema: Readonly<Record<string, unknown>>): readonly string[] {
  if (schema.required === undefined) return [];
  if (!Array.isArray(schema.required) || schema.required.some((value) => typeof value !== 'string')) {
    throw new Error('Lakehouse schema required fields are invalid.');
  }
  return schema.required as readonly string[];
}

async function encodeCursor(
  codec: RollingSignedEnvelopeCodec<ApplicationLakehouseCursorPayload>,
  value: ApplicationLakehouseCursorPayload,
): Promise<string> {
  return codec.sign(value, { expiresAt: value.expiresAt });
}

async function decodeCursor(
  codec: RollingSignedEnvelopeCodec<ApplicationLakehouseCursorPayload>,
  value: string,
  expected: {
  readonly dataset: string;
  readonly snapshot: string;
  readonly schemaRevision: string;
  readonly queryShape: string;
  readonly principalScope: string;
  readonly queryId: string;
  },
  currentTime: number,
): Promise<number> {
  let cursor: ApplicationLakehouseCursorPayload;
  try {
    cursor = await codec.verify(value);
  } catch (cause) {
    if (isSignedEnvelopeExpiry(cause)) throw expiredLakehouseCursor(expected);
    throw new Error('Lakehouse cursor is malformed or has an invalid signature.', { cause });
  }
  if (cursor.snapshot !== expected.snapshot || cursor.queryShape !== expected.queryShape || cursor.principalScope !== expected.principalScope) throw new Error('Lakehouse cursor does not match this snapshot, query, or principal.');
  if (cursor.expiresAt < currentTime) throw expiredLakehouseCursor(expected);
  return cursor.offset;
}

function validateApplicationLakehouseCursorPayload(value: JsonValue): ApplicationLakehouseCursorPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Lakehouse cursor payload is invalid.');
  const cursor = value as Readonly<Record<string, JsonValue>>;
  if (
    typeof cursor.snapshot !== 'string'
    || typeof cursor.queryShape !== 'string'
    || typeof cursor.principalScope !== 'string'
    || !Number.isSafeInteger(cursor.offset)
    || Number(cursor.offset) < 0
    || !Number.isSafeInteger(cursor.expiresAt)
    || Number(cursor.expiresAt) < 0
  ) throw new TypeError('Lakehouse cursor payload is invalid.');
  return {
    snapshot: cursor.snapshot,
    queryShape: cursor.queryShape,
    principalScope: cursor.principalScope,
    offset: Number(cursor.offset),
    expiresAt: Number(cursor.expiresAt),
  };
}

function isSignedEnvelopeExpiry(cause: unknown): boolean {
  return !!cause && typeof cause === 'object' && Reflect.get(cause, 'code') === 'SIGNED_ENVELOPE_EXPIRED';
}

function expiredLakehouseCursor(expected: {
  readonly queryId: string;
  readonly dataset: string;
  readonly snapshot: string;
  readonly schemaRevision: string;
}): ApplicationLakehouseQueryTerminalError {
  return applicationLakehouseQueryTerminalError({
    queryId: expected.queryId,
    dataset: expected.dataset,
    snapshot: expected.snapshot,
    schemaRevision: expected.schemaRevision,
    provider: 'deterministic',
    state: 'expired',
    diagnostic: 'Lakehouse query result cursor expired.',
  });
}

function stableDigest(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableJson(value)).digest('hex')}`;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
}

function deepFreezeJson<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreezeJson(child);
    if (!Object.isFrozen(value)) Object.freeze(value);
  }
  return value;
}
