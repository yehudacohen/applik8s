// typecast-file-boundary: DuckDB native bindings return dynamically typed rows that are schema-validated before exposure.
import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  type ApplicationLakehouseManifest,
  type ApplicationLakehouseQueryRequest,
  type ApplicationLakehouseQueryResult,
  ApplicationLakehouseQueryTerminalError,
  applicationLakehouseQueryIdentity,
  applicationLakehouseQueryTerminalError,
  compileApplicationLakehouseQuery,
  createDeterministicApplicationLakehouseRuntime,
  type DeterministicApplicationLakehouseRuntime,
} from '@applik8s/applik8s/lakehouse-runtime';
import { canonicalJsonV1String, type JsonValue } from '@applik8s/core';
import type { SchemaInput } from '@applik8s/sdk';
import { DuckDBInstance } from '@duckdb/node-api';

export interface DuckDbApplicationLakehouseRuntimeOptions<TRow extends object> {
  readonly datasetId: string;
  readonly schemaRevision: string;
  readonly schema: SchemaInput<TRow>;
  readonly cursorKey: string;
  readonly root: string;
  readonly maximumConcurrentQueries?: number;
  readonly maximumRows?: number;
  readonly maximumScannedBytes?: number;
  readonly memoryLimit?: string;
  readonly threads?: number;
  readonly now?: () => Date;
  readonly maximumObjectsPerSnapshot?: number;
  readonly retainedSnapshots?: number;
}

export interface DuckDbApplicationLakehouseRuntime<TRow extends object>
  extends DeterministicApplicationLakehouseRuntime<TRow> {
  readonly provider: 'duckdb';
  readonly root: string;
  close(): Promise<void>;
}

interface PersistedLakehouseAuthority<TRow extends object> {
  readonly schemaVersion: 'applik8s.duckdbLakehouse/v1alpha1';
  readonly datasetId: string;
  readonly manifests: readonly ApplicationLakehouseManifest<TRow>[];
}

/**
 * Opens a restart-safe local lakehouse provider. DuckDB reads only the object
 * selected by the canonical published manifest; it never scans arbitrary
 * workspace files or an unpublished staging directory.
 */
export async function createDuckDbApplicationLakehouseRuntime<TRow extends object>(
  options: DuckDbApplicationLakehouseRuntimeOptions<TRow>,
): Promise<DuckDbApplicationLakehouseRuntime<TRow>> {
  const datasetRoot = resolve(options.root, safeSegment(options.datasetId));
  const objectsRoot = join(datasetRoot, 'objects');
  const authorityPath = join(datasetRoot, 'authority.json');
  await mkdir(objectsRoot, { recursive: true, mode: 0o700 });
  await chmod(datasetRoot, 0o700);
  await chmod(objectsRoot, 0o700);
  const persisted = await readAuthority<TRow>(authorityPath, options.datasetId);
  const maximumConcurrentQueries = boundedInteger(options.maximumConcurrentQueries ?? 4, 1, 64, 'maximumConcurrentQueries');
  const maximumRows = boundedInteger(options.maximumRows ?? 1_000, 1, 100_000, 'maximumRows');
  const maximumScannedBytes = boundedInteger(options.maximumScannedBytes ?? 64 * 1024 * 1024, 1, Number.MAX_SAFE_INTEGER, 'maximumScannedBytes');
  const semaphore = createSemaphore(maximumConcurrentQueries);
  const instance = await DuckDBInstance.create(join(datasetRoot, 'queries.duckdb'), {
    threads: String(boundedInteger(options.threads ?? Math.min(4, maximumConcurrentQueries), 1, 64, 'threads')),
    ...(options.memoryLimit ? { memory_limit: options.memoryLimit } : {}),
  });
  let closed = false;

  const deterministic = createDeterministicApplicationLakehouseRuntime<TRow>({
    datasetId: options.datasetId,
    schemaRevision: options.schemaRevision,
    schema: options.schema,
    cursorKey: options.cursorKey,
    ...(options.now ? { now: options.now } : {}),
    ...(options.maximumObjectsPerSnapshot ? { maximumObjectsPerSnapshot: options.maximumObjectsPerSnapshot } : {}),
    ...(options.retainedSnapshots ? { retainedSnapshots: options.retainedSnapshots } : {}),
    snapshots: persisted.manifests,
    persist: async (manifests) => {
      for (const manifest of manifests) await writeSnapshotObject(objectsRoot, manifest);
      await writeJsonAtomic(authorityPath, {
        schemaVersion: 'applik8s.duckdbLakehouse/v1alpha1',
        datasetId: options.datasetId,
        manifests,
      } satisfies PersistedLakehouseAuthority<TRow>);
      await cleanupUnreferencedObjects(objectsRoot, manifests);
    },
  });
  await cleanupUnreferencedObjects(objectsRoot, deterministic.snapshots());

  return {
    ...deterministic,
    provider: 'duckdb',
    root: datasetRoot,
    async query(request) {
      assertOpen(closed);
      if ((request.page?.size ?? 200) > maximumRows) {
        throw new ApplicationDuckDbLakehouseLimitError('rows', maximumRows, request.page?.size ?? 200);
      }
      const snapshot = selectSnapshot(deterministic.snapshots(), request.snapshot);
      const compiled = compileApplicationLakehouseQuery(request);
      const stableQueryId = applicationLakehouseQueryIdentity({
        dataset: options.datasetId,
        snapshot: snapshot.snapshotId,
        queryShape: createHash('sha256').update(JSON.stringify({ compiled, page: request.page, principalScope: request.principalScope ?? 'anonymous' })).digest('hex'),
      });
      const terminalError = (
        state: 'failed' | 'cancelled' | 'timed-out' | 'expired',
        diagnostic: string,
        cause?: unknown,
      ) => applicationLakehouseQueryTerminalError({
        queryId: stableQueryId,
        dataset: options.datasetId,
        snapshot: snapshot.snapshotId,
        schemaRevision: snapshot.schemaRevision,
        provider: 'duckdb',
        state,
        diagnostic,
      }, cause);
      let release: () => void;
      try {
        release = await semaphore.acquire(request.signal);
      } catch (cause) {
        throw terminalError('cancelled', 'DuckDB lakehouse query was cancelled before execution.', cause);
      }
      try {
        const objectPaths = snapshotObjectPaths(objectsRoot, snapshot);
        const connection = await instance.connect();
        const timeout = timeoutMilliseconds(request.timeout);
        const timeoutController = timeout === undefined ? undefined : new AbortController();
        const timeoutHandle = timeout === undefined ? undefined : setTimeout(() => timeoutController?.abort(new DOMException('Lakehouse query timed out.', 'TimeoutError')), timeout);
        const onAbort = (): void => connection.interrupt();
        request.signal?.addEventListener('abort', onAbort, { once: true });
        timeoutController?.signal.addEventListener('abort', onAbort, { once: true });
        try {
          if (request.signal?.aborted) throw request.signal.reason ?? new DOMException('Lakehouse query cancelled.', 'AbortError');
          let scannedBytes = 0;
          for (const [index, objectPath] of objectPaths.entries()) {
            const object = snapshot.objects[index]!;
            const content = await readFile(objectPath, 'utf8');
            if (content !== physicalRows(snapshot, object)) {
              throw new ApplicationDuckDbLakehouseCorruptionError(snapshot.snapshotId, objectPath);
            }
            scannedBytes += Number((await stat(objectPath)).size);
          }
          if (scannedBytes > maximumScannedBytes) {
            throw new ApplicationDuckDbLakehouseLimitError('scannedBytes', maximumScannedBytes, scannedBytes);
          }
          if (snapshot.rows.length > 0) {
            const statement = duckDbQuery(objectPaths, compiled);
            const reader = await connection.runAndReadAll(statement.sql, statement.values);
            const providerRows = reader.getRowObjectsJson();
            const expected = await deterministic.query(request);
            assertProviderResultContainsPage(providerRows, expected.rows, compiled.orderBy.length > 0);
            if (timeoutController?.signal.aborted) throw timeoutController.signal.reason;
            return {
              ...expected,
              queryId: stableQueryId,
              scannedBytes,
              receipt: {
                ...expected.receipt,
                queryId: stableQueryId,
                provider: 'duckdb',
              },
              evidence: {
                provider: 'duckdb',
                target: 'local',
                durationMs: expected.evidence?.durationMs ?? 0,
                cost: { kind: 'scanned-bytes', scannedBytes },
              },
            } as ApplicationLakehouseQueryResult<TRow>;
          }
          if (timeoutController?.signal.aborted) throw timeoutController.signal.reason;
          const result = await deterministic.query(request);
          return {
            ...result,
            queryId: stableQueryId,
            scannedBytes,
            receipt: {
              ...result.receipt,
              queryId: stableQueryId,
              provider: 'duckdb',
            },
            evidence: {
              provider: 'duckdb',
              target: 'local',
              durationMs: result.evidence?.durationMs ?? 0,
              cost: { kind: 'scanned-bytes', scannedBytes },
            },
          } as ApplicationLakehouseQueryResult<TRow>;
        } catch (cause) {
          if (timeoutController?.signal.aborted) throw terminalError('timed-out', 'DuckDB lakehouse query timed out after interruption.', cause);
          if (request.signal?.aborted) throw terminalError('cancelled', 'DuckDB lakehouse query was cancelled and interrupted.', cause);
          if (cause instanceof ApplicationLakehouseQueryTerminalError) {
            throw terminalError(cause.receipt.state === 'expired' ? 'expired' : 'failed', cause.message, cause);
          }
          if (cause instanceof ApplicationDuckDbLakehouseLimitError || cause instanceof ApplicationDuckDbLakehouseCorruptionError) throw cause;
          throw terminalError('failed', 'DuckDB lakehouse query failed.', cause);
        } finally {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          request.signal?.removeEventListener('abort', onAbort);
          timeoutController?.signal.removeEventListener('abort', onAbort);
          connection.closeSync();
        }
      } finally {
        release();
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      await semaphore.drain();
      instance.closeSync();
    },
  };
}

async function cleanupUnreferencedObjects<TRow extends object>(
  objectsRoot: string,
  manifests: readonly ApplicationLakehouseManifest<TRow>[],
): Promise<void> {
  const retained = new Set(manifests.flatMap(({ objects }) => objects.map(({ objectId }) => `${objectId}.ndjson`)));
  for (const entry of await readdir(objectsRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !/^object_[a-f0-9]{64}\.ndjson$/u.test(entry.name) || retained.has(entry.name)) continue;
    await unlink(join(objectsRoot, entry.name)).catch((cause) => {
      if (!isNotFound(cause)) throw cause;
    });
  }
}

export class ApplicationDuckDbLakehouseCorruptionError extends Error {
  readonly code = 'APPLIK8S_DUCKDB_LAKEHOUSE_CORRUPTION';

  constructor(readonly snapshotId: string, readonly objectPath: string) {
    super(`Published lakehouse snapshot ${snapshotId} does not match its immutable DuckDB object ${objectPath}.`);
    this.name = 'ApplicationDuckDbLakehouseCorruptionError';
  }
}

export class ApplicationDuckDbLakehouseLimitError extends Error {
  readonly code = 'APPLIK8S_DUCKDB_LAKEHOUSE_LIMIT';

  constructor(readonly limit: 'rows' | 'scannedBytes', readonly maximum: number, readonly requested: number) {
    super(`DuckDB lakehouse query exceeds ${limit} limit ${maximum}; requested or observed ${requested}.`);
    this.name = 'ApplicationDuckDbLakehouseLimitError';
  }
}

function selectSnapshot<TRow extends object>(
  snapshots: readonly ApplicationLakehouseManifest<TRow>[],
  requested: ApplicationLakehouseQueryRequest<TRow>['snapshot'],
): ApplicationLakehouseManifest<TRow> {
  const snapshot = requested && requested !== 'latest-published'
    ? snapshots.find(({ snapshotId }) => snapshotId === requested)
    : snapshots.at(-1);
  if (!snapshot) throw new Error(`Published lakehouse snapshot ${requested ?? 'latest-published'} does not exist.`);
  return snapshot;
}

async function readAuthority<TRow extends object>(
  path: string,
  datasetId: string,
): Promise<PersistedLakehouseAuthority<TRow>> {
  try {
    const candidate = JSON.parse(await readFile(path, 'utf8')) as PersistedLakehouseAuthority<TRow>;
    if (candidate.schemaVersion !== 'applik8s.duckdbLakehouse/v1alpha1' || candidate.datasetId !== datasetId || !Array.isArray(candidate.manifests)) {
      throw new Error(`DuckDB lakehouse authority ${path} is invalid or belongs to another dataset.`);
    }
    return candidate;
  } catch (cause) {
    if (isNotFound(cause)) return { schemaVersion: 'applik8s.duckdbLakehouse/v1alpha1', datasetId, manifests: [] };
    throw cause;
  }
}

async function writeSnapshotObject<TRow extends object>(
  objectsRoot: string,
  manifest: ApplicationLakehouseManifest<TRow>,
): Promise<void> {
  for (const object of manifest.objects) {
    const path = lakehouseObjectPath(objectsRoot, object.objectId);
    const content = physicalRows(manifest, object);
    try {
      const existing = await readFile(path, 'utf8');
      if (existing !== content) {
        throw new ApplicationDuckDbLakehouseCorruptionError(manifest.snapshotId, path);
      }
      continue;
    } catch (cause) {
      if (!isNotFound(cause)) throw cause;
    }
    await writeFileAtomic(path, content, 0o600);
  }
}

function snapshotObjectPaths<TRow extends object>(
  objectsRoot: string,
  manifest: ApplicationLakehouseManifest<TRow>,
): readonly string[] {
  return manifest.objects.map(({ objectId }) => lakehouseObjectPath(objectsRoot, objectId));
}

function lakehouseObjectPath(objectsRoot: string, objectId: string): string {
  if (!/^object_[a-f0-9]{64}$/u.test(objectId)) throw new Error(`Unsafe lakehouse object identity ${objectId}.`);
  return join(objectsRoot, `${objectId}.ndjson`);
}

function physicalRows<TRow extends object>(manifest: ApplicationLakehouseManifest<TRow>, object: ApplicationLakehouseManifest<TRow>['objects'][number]): string {
  const rows = manifest.rows.slice(object.rowOffset, object.rowOffset + object.rowCount);
  const identities = manifest.rowIdentities.slice(object.rowOffset, object.rowOffset + object.rowCount);
  return `${rows.map((row, index) => JSON.stringify({ ...row, __applik8s_row_id: identities[index] })).join('\n')}\n`;
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`, 0o600);
}

async function writeFileAtomic(path: string, content: string, mode: number): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { mode });
  await chmod(temporary, mode);
  await rename(temporary, path);
}

function createSemaphore(maximum: number): {
  acquire(signal?: AbortSignal): Promise<() => void>;
  drain(): Promise<void>;
} {
  let active = 0;
  const pending: Array<{ readonly resolve: (release: () => void) => void; readonly reject: (cause: unknown) => void; readonly signal?: AbortSignal; readonly abort?: () => void }> = [];
  const drainWaiters: Array<() => void> = [];
  const release = (): void => {
    active -= 1;
    dispatch();
    if (active === 0 && pending.length === 0) while (drainWaiters.length > 0) drainWaiters.shift()?.();
  };
  const dispatch = (): void => {
    while (active < maximum && pending.length > 0) {
      const waiter = pending.shift()!;
      waiter.signal?.removeEventListener('abort', waiter.abort!);
      if (waiter.signal?.aborted) {
        waiter.reject(waiter.signal.reason ?? new DOMException('Lakehouse query cancelled.', 'AbortError'));
        continue;
      }
      active += 1;
      waiter.resolve(release);
    }
  };
  return {
    acquire(signal) {
      if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException('Lakehouse query cancelled.', 'AbortError'));
      return new Promise((resolveAcquire, reject) => {
        const waiter: (typeof pending)[number] = { resolve: resolveAcquire, reject, ...(signal ? { signal } : {}) };
        if (signal) {
          const abort = (): void => {
            const index = pending.indexOf(waiter);
            if (index >= 0) pending.splice(index, 1);
            reject(signal.reason ?? new DOMException('Lakehouse query cancelled.', 'AbortError'));
          };
          Object.assign(waiter, { abort });
          signal.addEventListener('abort', abort, { once: true });
        }
        pending.push(waiter);
        dispatch();
      });
    },
    drain() {
      if (active === 0 && pending.length === 0) return Promise.resolve();
      return new Promise((resolveDrain) => drainWaiters.push(resolveDrain));
    },
  };
}

function timeoutMilliseconds(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const match = /^(\d+)(ms|s|m)$/u.exec(value.trim());
  if (!match) throw new Error(`Lakehouse timeout ${JSON.stringify(value)} must use ms, s, or m.`);
  const quantity = Number(match[1]);
  const multiplier = match[2] === 'ms' ? 1 : match[2] === 's' ? 1_000 : 60_000;
  const result = quantity * multiplier;
  if (!Number.isSafeInteger(result) || result < 1 || result > 3_600_000) throw new Error('Lakehouse timeout must be between 1ms and 1h.');
  return result;
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
  return value;
}

function sqlString(value: string): string {
  return value.replaceAll("'", "''");
}

function duckDbQuery(
  objectPaths: readonly string[],
  compiled: import('@applik8s/applik8s').CompiledApplicationLakehouseQuery,
): { readonly sql: string; readonly values: import('@duckdb/node-api').DuckDBValue[] } {
  const values: import('@duckdb/node-api').DuckDBValue[] = [];
  const filter = compiled.where ? ` where ${duckDbFilter(compiled.where, values)}` : '';
  const ordering = compiled.orderBy.length > 0
    ? ` order by ${compiled.orderBy.map((order) => `${duckDbPath(order.path)} ${order.direction}`).join(', ')}, "__applik8s_row_id" asc`
    : '';
  const paths = `[${objectPaths.map((path) => `'${sqlString(path)}'`).join(', ')}]`;
  return {
    sql: `select * exclude ("__applik8s_row_id") from read_json_auto(${paths}, format = 'newline_delimited')${filter}${ordering}`,
    values,
  };
}

function duckDbFilter(
  expression: import('@applik8s/applik8s').ApplicationLakehouseFilterExpression,
  values: import('@duckdb/node-api').DuckDBValue[],
): string {
  switch (expression.kind) {
    case 'and':
    case 'or': {
      if (expression.operands.length < 2) throw new Error(`Lakehouse ${expression.kind} expression must have at least two operands.`);
      return `(${expression.operands.map((operand) => duckDbFilter(operand, values)).join(` ${expression.kind} `)})`;
    }
    case 'comparison': {
      const field = duckDbPath(expression.path);
      if (expression.value === null) return `${field} ${expression.operator === 'eq' ? 'is null' : expression.operator === 'ne' ? 'is not null' : invalidNullComparison(expression.operator)}`;
      values.push(expression.value);
      const operator = { eq: '=', ne: '<>', lt: '<', lte: '<=', gt: '>', gte: '>=' }[expression.operator];
      return `${field} ${operator} $${values.length}`;
    }
  }
}

function duckDbPath(path: readonly string[]): string {
  if (path.length === 0) throw new Error('Lakehouse expressions cannot target the row root.');
  return path.map((segment) => `"${segment.replaceAll('"', '""')}"`).join('.');
}

function invalidNullComparison(operator: string): never {
  throw new Error(`Lakehouse null values support only eq() and ne(), not ${operator}().`);
}

function assertProviderResultContainsPage(
  providerRows: readonly Record<string, unknown>[],
  pageRows: readonly object[],
  ordered: boolean,
): void {
  const serialized = providerRows.map((row) => duckDbCanonicalJson(row));
  let previous = -1;
  for (const row of pageRows) {
    const start = ordered ? previous + 1 : 0;
    const index = providerRows.findIndex((providerRow, candidateIndex) => candidateIndex >= start && rowsEquivalent(providerRow, row));
    if (index < 0) throw new Error(`DuckDB provider result diverged from the portable lakehouse query result (providerRows=${providerRows.length}, pageRows=${pageRows.length}, providerDigests=${serialized.map(shortDigest).join(',')}, expectedDigest=${shortDigest(duckDbCanonicalJson(row))}).`);
    previous = index;
  }
}

function rowsEquivalent(actual: unknown, expected: unknown): boolean {
  if (typeof expected === 'number' && typeof actual === 'string' && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(actual)) return Number(actual) === expected;
  if (actual === expected) return true;
  if (Array.isArray(actual) && Array.isArray(expected)) return actual.length === expected.length && actual.every((item, index) => rowsEquivalent(item, expected[index]));
  if (actual && expected && typeof actual === 'object' && typeof expected === 'object') {
    const actualEntries = Object.entries(actual);
    const expectedEntries = Object.entries(expected);
    return actualEntries.length === expectedEntries.length && expectedEntries.every(([key, value]) => rowsEquivalent(Reflect.get(actual, key), value));
  }
  return false;
}

function shortDigest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function duckDbCanonicalJson(value: unknown): string {
  return canonicalJsonV1String(duckDbCanonicalValue(value));
}

function duckDbCanonicalValue(value: unknown): JsonValue {
  if (typeof value === 'bigint') {
    return value >= BigInt(Number.MIN_SAFE_INTEGER)
      && value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') return value;
  if (Array.isArray(value)) return value.map(duckDbCanonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, duckDbCanonicalValue(item)]),
    );
  }
  throw new TypeError(`DuckDB canonical rows cannot encode ${typeof value}.`);
}

function safeSegment(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '');
  if (!normalized) throw new Error('DuckDB lakehouse dataset identity must contain a letter or digit.');
  return `${normalized.slice(0, 40)}-${createHash('sha256').update(value).digest('hex').slice(0, 12)}`;
}

function isNotFound(cause: unknown): boolean {
  return cause instanceof Error && Reflect.get(cause, 'code') === 'ENOENT';
}

function assertOpen(closed: boolean): void {
  if (closed) throw new Error('DuckDB lakehouse runtime is closed.');
}
