// typecast-file-boundary: Athena, Glue, and S3 responses cross SDK JSON boundaries and are validated before hydration.
import { createHash } from 'node:crypto';
import {
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  StartQueryExecutionCommand,
  StopQueryExecutionCommand,
  AthenaClient,
} from '@aws-sdk/client-athena';
import { AlreadyExistsException, CreateTableCommand, GetTableCommand, GlueClient } from '@aws-sdk/client-glue';
import { GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  applicationLakehouseQueryIdentity,
  applicationLakehouseQueryTerminalError,
  compileApplicationLakehouseQuery,
  createApplicationLakehouseCursorCodec,
  createDeterministicApplicationLakehouseRuntime,
  verifyApplicationLakehouseManifest,
  type ApplicationLakehouseManifest,
  type ApplicationLakehouseCursorPayload,
  type ApplicationLakehousePublicationRuntime,
  type ApplicationLakehouseQueryRequest,
  type ApplicationLakehouseQueryResult,
  type ApplicationLakehouseQueryRuntime,
  type ApplicationLakehouseScalar,
} from '@applik8s/applik8s/lakehouse-runtime';
import { normalizeSchema, type SchemaInput } from '@applik8s/sdk';

export interface AwsApplicationLakehouseDatasetConfiguration<TRow extends object> {
  readonly datasetId: string;
  readonly bucket: string;
  readonly prefix: string;
  readonly catalogDatabase: string;
  readonly schemaRevision: string;
  readonly schema: SchemaInput<TRow>;
  readonly cursorKey: string;
  readonly region?: string;
  readonly maximumObjectsPerSnapshot?: number;
  readonly retainedSnapshots?: number;
  /** Test/custom transport seam; normal callers rely on the region-configured SDK client. */
  readonly s3Client?: S3Client;
  /** Test/custom transport seam; normal callers rely on the region-configured SDK client. */
  readonly glueClient?: GlueClient;
}

export interface AwsApplicationLakehouseQueryConfiguration {
  readonly workgroup: string;
  readonly region?: string;
  readonly maximumConcurrentQueries?: number;
  readonly maximumRows?: number;
  readonly maximumScannedBytes?: number;
  /** Bounded reconciliation window after requesting Athena cancellation. */
  readonly cancellationConfirmationTimeoutMs?: number;
  readonly datasets: Readonly<Record<string, AwsApplicationLakehouseDatasetConfiguration<object>>>;
  readonly athenaClient?: AthenaClient;
  readonly s3Client?: S3Client;
}

interface AwsLakehouseAuthority<TRow extends object> {
  readonly schemaVersion: 'applik8s.awsLakehouse/v1alpha1';
  readonly datasetId: string;
  readonly schemaRevision: string;
  readonly manifests: readonly ApplicationLakehouseManifest<TRow>[];
}

/** S3/Glue publication provider with immutable snapshots and an S3 CAS frontier. */
export function createAwsApplicationLakehouseDatasetRuntime<TRow extends object>(
  configuration: AwsApplicationLakehouseDatasetConfiguration<TRow>,
): ApplicationLakehousePublicationRuntime<TRow> {
  validateDataset(configuration);
  const s3 = configuration.s3Client ?? new S3Client(configuration.region ? { region: configuration.region } : {});
  const glue = configuration.glueClient ?? new GlueClient(configuration.region ? { region: configuration.region } : {});
  return {
    async append(request) {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const current = await readAuthority<TRow>(s3, configuration);
        const prior = current.authority.manifests.find((manifest) => manifest.frontier.includes(request.frontier));
        if (prior) return prior;
        const deterministic = createDeterministicApplicationLakehouseRuntime({
          datasetId: configuration.datasetId,
          schemaRevision: configuration.schemaRevision,
          schema: configuration.schema,
          cursorKey: configuration.cursorKey,
          snapshots: current.authority.manifests,
          ...(configuration.maximumObjectsPerSnapshot ? { maximumObjectsPerSnapshot: configuration.maximumObjectsPerSnapshot } : {}),
          ...(configuration.retainedSnapshots ? { retainedSnapshots: configuration.retainedSnapshots } : {}),
        });
        const manifest = await deterministic.append(request);
        for (const object of manifest.objects) {
          await putImmutableObject(s3, configuration, dataObjectKey(configuration, object.objectId), physicalRows(manifest, object), 'application/x-ndjson');
        }
        await putImmutableObject(s3, configuration, snapshotLinkKey(configuration, manifest.snapshotId), manifest.objects.map(({ objectId }) => `s3://${configuration.bucket}/${dataObjectKey(configuration, objectId)}`).join('\n') + '\n', 'text/plain');
        await putImmutableObject(s3, configuration, manifestObjectKey(configuration, manifest.snapshotId), `${JSON.stringify(manifest)}\n`, 'application/json');
        await ensureSnapshotTable(glue, configuration, manifest);
        const next: AwsLakehouseAuthority<TRow> = {
          schemaVersion: 'applik8s.awsLakehouse/v1alpha1',
          datasetId: configuration.datasetId,
          schemaRevision: configuration.schemaRevision,
          manifests: deterministic.snapshots(),
        };
        try {
          await s3.send(new PutObjectCommand({
            Bucket: configuration.bucket,
            Key: authorityKey(configuration),
            Body: `${JSON.stringify(next)}\n`,
            ContentType: 'application/json',
            ...(current.etag ? { IfMatch: current.etag } : { IfNoneMatch: '*' }),
          }));
          return manifest;
        } catch (cause) {
          if (!isPreconditionFailed(cause) || attempt === 7) throw cause;
        }
      }
      throw new Error(`AWS lakehouse dataset ${configuration.datasetId} could not advance its publication frontier.`);
    },
  };
}

/** Athena query provider pinned to one S3 authority snapshot per admission. */
export function createAwsApplicationLakehouseQueryRuntime(
  configuration: AwsApplicationLakehouseQueryConfiguration,
): ApplicationLakehouseQueryRuntime<object> {
  if (!configuration.workgroup.trim()) throw new Error('AWS lakehouse query workgroup is required.');
  const athena = configuration.athenaClient ?? new AthenaClient(configuration.region ? { region: configuration.region } : {});
  const s3 = configuration.s3Client ?? new S3Client(configuration.region ? { region: configuration.region } : {});
  const semaphore = createSemaphore(configuration.maximumConcurrentQueries ?? 4);
  const maximumRows = boundedInteger(configuration.maximumRows ?? 1_000, 1, 100_000, 'AWS lakehouse maximumRows');
  const maximumScannedBytes = boundedInteger(configuration.maximumScannedBytes ?? 10_000_000_000, 1, Number.MAX_SAFE_INTEGER, 'AWS lakehouse maximumScannedBytes');
  const cancellationConfirmationTimeoutMs = boundedInteger(configuration.cancellationConfirmationTimeoutMs ?? 2_000, 1, 30_000, 'AWS lakehouse cancellationConfirmationTimeoutMs');
  return {
    async query(request) {
      const startedAt = Date.now();
      const qualification = request.dataset.qualification?.name;
      if (!qualification) throw new Error('AWS lakehouse query requires a qualified dataset.');
      const dataset = configuration.datasets[qualification];
      if (!dataset) throw new Error(`AWS lakehouse query has no dataset binding for ${qualification}.`);
      const release = await semaphore.acquire(request.signal);
      try {
        const authority = (await readAuthority(s3, dataset)).authority;
        const snapshot = request.snapshot && request.snapshot !== 'latest-published'
          ? authority.manifests.find(({ snapshotId }) => snapshotId === request.snapshot)
          : authority.manifests.at(-1);
        if (!snapshot) throw new Error(`Published AWS lakehouse snapshot ${request.snapshot ?? 'latest-published'} does not exist.`);
        const pageSize = boundedInteger(request.page?.size ?? 200, 1, Math.min(1_000, maximumRows), 'AWS lakehouse page size');
        const compiled = compileApplicationLakehouseQuery(request);
        const queryShape = digest({ dataset: qualification, snapshot: snapshot.snapshotId, compiled, pageSize, principalScope: request.principalScope ?? 'anonymous' });
        const cursorQueryId = applicationLakehouseQueryIdentity({ dataset: qualification, snapshot: snapshot.snapshotId, queryShape });
        const cursorCodec = createApplicationLakehouseCursorCodec(dataset.cursorKey);
        const offset = request.page?.cursor
          ? await decodeCursor(cursorCodec, request.page.cursor, {
            dataset: qualification,
            snapshot: snapshot.snapshotId,
            schemaRevision: snapshot.schemaRevision,
            queryShape,
            principalScope: request.principalScope ?? 'anonymous',
            queryId: cursorQueryId,
          })
          : 0;
        const stableQueryId = applicationLakehouseQueryIdentity({ dataset: qualification, snapshot: snapshot.snapshotId, queryShape, offset });
        const terminalError = (
          state: 'failed' | 'cancelled' | 'timed-out' | 'cancellation-pending' | 'outcome-unknown',
          diagnostic: string,
          providerQueryId?: string,
          cause?: unknown,
        ) => applicationLakehouseQueryTerminalError({
          queryId: stableQueryId,
          dataset: qualification,
          snapshot: snapshot.snapshotId,
          schemaRevision: snapshot.schemaRevision,
          provider: 'athena',
          ...(providerQueryId ? { providerQueryId } : {}),
          state,
          diagnostic: redactedDiagnostic(diagnostic),
        }, cause);
        if (request.signal?.aborted) throw terminalError('cancelled', 'AWS lakehouse query was cancelled before provider admission.', undefined, request.signal.reason);
        if (offset > 0 && compiled.orderBy.length === 0) throw new Error('AWS lakehouse pagination requires deterministic orderBy fields.');
        const sql = athenaSql(snapshotTableName(dataset, snapshot.snapshotId), snapshot.schema.jsonSchema, compiled, pageSize + 1, offset);
        const started = await athena.send(new StartQueryExecutionCommand({
            QueryString: sql,
            QueryExecutionContext: { Database: dataset.catalogDatabase },
            WorkGroup: configuration.workgroup,
            ClientRequestToken: digest({ queryShape, offset }).slice(0, 64),
          })).catch((cause: unknown) => {
          throw terminalError('failed', 'Athena rejected or failed query admission.', undefined, cause);
        });
        const queryId = started.QueryExecutionId;
        if (!queryId) throw terminalError('outcome-unknown', 'Athena admitted the query without returning an execution identity.');
        let terminal: AthenaQueryObservation;
        try {
          terminal = await waitForAthena(athena, queryId, request.timeout, request.signal, cancellationConfirmationTimeoutMs);
        } catch (cause) {
          throw terminalError('outcome-unknown', 'Athena query state could not be reconciled.', queryId, cause);
        }
        if (terminal.state !== 'SUCCEEDED') {
          const state = terminal.state === 'CANCELLED'
            ? terminal.requested === 'timed-out' ? 'timed-out' : 'cancelled'
            : terminal.state === 'CANCELLATION_PENDING'
              ? 'cancellation-pending'
              : terminal.state === 'OUTCOME_UNKNOWN'
                ? 'outcome-unknown'
                : 'failed';
          throw terminalError(state, terminal.reason ?? `Athena query ended in ${terminal.state}.`, queryId);
        }
        if (terminal.scannedBytes > maximumScannedBytes) {
          throw new AwsApplicationLakehouseLimitError('scannedBytes', maximumScannedBytes, terminal.scannedBytes, queryId);
        }
        const response = await athena.send(new GetQueryResultsCommand({ QueryExecutionId: queryId, MaxResults: pageSize + 2 })).catch((cause: unknown) => {
          throw terminalError('failed', 'Athena completed but its result object could not be read.', queryId, cause);
        });
        const columns = response.ResultSet?.ResultSetMetadata?.ColumnInfo?.map(({ Name }) => Name ?? '') ?? [];
        const providerRows = (response.ResultSet?.Rows ?? []).slice(1).map((row) => Object.fromEntries(columns.map((name, index) => [name, scalarValue(row.Data?.[index]?.VarCharValue, schemaProperty(snapshot.schema.jsonSchema, name))])));
        const hasMore = providerRows.length > pageSize;
        if (hasMore && compiled.orderBy.length === 0) throw new Error('AWS lakehouse result requires pagination but the query has no deterministic orderBy.');
        const rows = providerRows.slice(0, pageSize);
        const nextOffset = offset + rows.length;
        return {
          state: 'succeeded',
          queryId: stableQueryId,
          snapshot: snapshot.snapshotId,
          schemaRevision: snapshot.schemaRevision,
          rows,
          ...(hasMore ? { cursor: await encodeCursor(cursorCodec, { snapshot: snapshot.snapshotId, queryShape, principalScope: request.principalScope ?? 'anonymous', offset: nextOffset, expiresAt: Date.now() + 900_000 }) } : {}),
          scannedBytes: terminal.scannedBytes,
          receipt: {
            schemaVersion: 'applik8s.lakehouseQueryReceipt/v1alpha1',
            queryId: stableQueryId,
            dataset: qualification,
            state: 'succeeded',
            snapshot: snapshot.snapshotId,
            schemaRevision: snapshot.schemaRevision,
            provider: 'athena',
            providerQueryId: queryId,
          },
          evidence: {
            provider: 'athena',
            durationMs: Math.max(0, Date.now() - startedAt),
            cost: { kind: 'scanned-bytes', scannedBytes: terminal.scannedBytes },
          },
        } satisfies ApplicationLakehouseQueryResult<object>;
      } finally {
        release();
      }
    },
  };
}

export class AwsApplicationLakehouseLimitError extends Error {
  readonly code = 'APPLIK8S_AWS_LAKEHOUSE_LIMIT';

  constructor(readonly limit: 'rows' | 'scannedBytes', readonly maximum: number, readonly observed: number, readonly queryId?: string) {
    super(`AWS lakehouse query${queryId ? ` ${queryId}` : ''} exceeds ${limit} limit ${maximum}; requested or observed ${observed}.`);
    this.name = 'AwsApplicationLakehouseLimitError';
  }
}

async function readAuthority<TRow extends object>(s3: S3Client, configuration: AwsApplicationLakehouseDatasetConfiguration<TRow>): Promise<{ readonly authority: AwsLakehouseAuthority<TRow>; readonly etag?: string }> {
  try {
    const response = await s3.send(new GetObjectCommand({ Bucket: configuration.bucket, Key: authorityKey(configuration) }));
    const text = await response.Body?.transformToString();
    if (!text) throw new Error(`AWS lakehouse authority for ${configuration.datasetId} is empty.`);
    const authority = JSON.parse(text) as AwsLakehouseAuthority<TRow>;
    if (authority.schemaVersion !== 'applik8s.awsLakehouse/v1alpha1' || authority.datasetId !== configuration.datasetId || !Array.isArray(authority.manifests)) {
      throw new Error(`AWS lakehouse authority for ${configuration.datasetId} has incompatible identity.`);
    }
    const verified: AwsLakehouseAuthority<TRow> = {
      ...authority,
      manifests: authority.manifests.map((manifest) =>
        verifyApplicationLakehouseManifest(manifest, configuration.datasetId)),
    };
    return { authority: verified, ...(response.ETag ? { etag: response.ETag } : {}) };
  } catch (cause) {
    if (!isNotFound(cause)) throw cause;
    return { authority: { schemaVersion: 'applik8s.awsLakehouse/v1alpha1', datasetId: configuration.datasetId, schemaRevision: configuration.schemaRevision, manifests: [] } };
  }
}

async function putImmutableObject(s3: S3Client, configuration: AwsApplicationLakehouseDatasetConfiguration<object>, key: string, body: string, contentType: string): Promise<void> {
  try {
    await s3.send(new PutObjectCommand({ Bucket: configuration.bucket, Key: key, Body: body, ContentType: contentType, IfNoneMatch: '*' }));
  } catch (cause) {
    if (!isPreconditionFailed(cause)) throw cause;
    const existing = await s3.send(new GetObjectCommand({ Bucket: configuration.bucket, Key: key }));
    if (await existing.Body?.transformToString() !== body) throw new Error(`Immutable AWS lakehouse object s3://${configuration.bucket}/${key} conflicts with different content.`);
  }
}

async function ensureSnapshotTable<TRow extends object>(glue: GlueClient, configuration: AwsApplicationLakehouseDatasetConfiguration<TRow>, manifest: ApplicationLakehouseManifest<TRow>): Promise<void> {
  const name = snapshotTableName(configuration, manifest.snapshotId);
  const columns = [...schemaColumnsJson(manifest.schema.jsonSchema), { Name: '__applik8s_row_id', Type: 'string' }];
  const descriptor = {
    Columns: columns,
    Location: `s3://${configuration.bucket}/${snapshotLinkPrefix(configuration, manifest.snapshotId)}/`,
    InputFormat: 'org.apache.hadoop.hive.ql.io.SymlinkTextInputFormat',
    OutputFormat: 'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
    SerdeInfo: { SerializationLibrary: 'org.openx.data.jsonserde.JsonSerDe', Parameters: { 'ignore.malformed.json': 'false' } },
  };
  try {
    await glue.send(new CreateTableCommand({ DatabaseName: configuration.catalogDatabase, TableInput: {
      Name: name,
      Parameters: { 'applik8s.dataset': configuration.datasetId, 'applik8s.snapshot': manifest.snapshotId, classification: 'json' },
      StorageDescriptor: descriptor,
      TableType: 'EXTERNAL_TABLE',
    } }));
  } catch (cause) {
    if (!(cause instanceof AlreadyExistsException) && Reflect.get(cause as object, 'name') !== 'AlreadyExistsException') throw cause;
    const existing = await glue.send(new GetTableCommand({ DatabaseName: configuration.catalogDatabase, Name: name }));
    const actual = existing.Table;
    if (
      actual?.TableType !== 'EXTERNAL_TABLE'
      || actual.Parameters?.['applik8s.dataset'] !== configuration.datasetId
      || actual.Parameters?.['applik8s.snapshot'] !== manifest.snapshotId
      || actual.Parameters?.classification !== 'json'
      || stableJson(actual.StorageDescriptor ?? {}) !== stableJson(descriptor)
    ) {
      throw new Error(`AWS lakehouse snapshot table ${configuration.catalogDatabase}.${name} conflicts with another owner or storage descriptor.`);
    }
  }
}

function schemaColumns<TRow extends object>(schema: SchemaInput<TRow>): { Name: string; Type: string }[] {
  return schemaColumnsJson(schemaJson(schema));
}

function schemaColumnsJson(json: Readonly<Record<string, unknown>>): { Name: string; Type: string }[] {
  const properties = json.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) throw new Error('AWS lakehouse rows require an object JSON schema with explicit properties.');
  return Object.entries(properties).sort(([left], [right]) => left.localeCompare(right)).map(([name, property]) => ({ Name: name, Type: athenaType(property) }));
}

function schemaJson<TRow extends object>(schema: SchemaInput<TRow>): Record<string, unknown> {
  if (schema && typeof schema === 'object') {
    const generated = Reflect.get(schema as object, 'json');
    if (generated && typeof generated === 'object' && !Array.isArray(generated)) return generated as Record<string, unknown>;
    const direct = Reflect.get(schema as object, 'jsonSchema');
    if (direct && typeof direct === 'object' && !Array.isArray(direct)) return direct as Record<string, unknown>;
    const inferred = Reflect.get(schema as object, 'inferred');
    const inferredJson = inferred && typeof inferred === 'object' ? Reflect.get(inferred, 'jsonSchema') : undefined;
    if (inferredJson && typeof inferredJson === 'object' && !Array.isArray(inferredJson)) return inferredJson as Record<string, unknown>;
  }
  const emitted = normalizeSchema(schema, 'aws-lakehouse-row').emitJsonSchema();
  if (emitted.ok) return emitted.value.schema;
  throw new Error(`AWS lakehouse runtime requires normalized JSON schema metadata: ${emitted.error.message}`);
}

function athenaType(value: unknown): string {
  const property = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const type = Array.isArray(property.type) ? property.type.find((entry) => entry !== 'null') : property.type;
  if (type === 'string') return 'string';
  if (type === 'integer') return 'bigint';
  if (type === 'number') return 'double';
  if (type === 'boolean') return 'boolean';
  throw new Error(`AWS lakehouse schema type ${JSON.stringify(type)} is not supported by the portable v0.8 provider.`);
}

function athenaSql(table: string, schema: Readonly<Record<string, unknown>>, compiled: ReturnType<typeof compileApplicationLakehouseQuery>, limit: number, offset: number): string {
  const where = compiled.where ? ` WHERE ${athenaFilter(compiled.where)}` : '';
  const order = compiled.orderBy.length ? ` ORDER BY ${compiled.orderBy.map(({ path, direction }) => `${athenaPath(path)} ${direction.toUpperCase()}`).join(', ')}, "__applik8s_row_id" ASC` : '';
  const fields = Object.keys(schemaProperties(schema)).sort().map(identifier).join(', ');
  return `SELECT ${fields} FROM ${identifier(table)}${where}${order} LIMIT ${limit}${offset ? ` OFFSET ${offset}` : ''}`;
}

function athenaFilter(expression: import('@applik8s/applik8s').ApplicationLakehouseFilterExpression): string {
  if (expression.kind !== 'comparison') return `(${expression.operands.map(athenaFilter).join(` ${expression.kind.toUpperCase()} `)})`;
  const path = athenaPath(expression.path);
  if (expression.value === null) return `${path} ${expression.operator === 'eq' ? 'IS NULL' : expression.operator === 'ne' ? 'IS NOT NULL' : invalidNull()}`;
  return `${path} ${{ eq: '=', ne: '<>', lt: '<', lte: '<=', gt: '>', gte: '>=' }[expression.operator]} ${athenaLiteral(expression.value)}`;
}

function athenaPath(path: readonly string[]): string {
  if (path.length !== 1) throw new Error('AWS lakehouse v0.8 supports only top-level portable fields.');
  return identifier(path[0]!);
}
function identifier(value: string): string { return `"${value.replaceAll('"', '""')}"`; }
function athenaLiteral(value: ApplicationLakehouseScalar): string {
  if (value === null) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('AWS lakehouse query numbers must be finite.');
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return `'${value.replaceAll("'", "''")}'`;
}
function invalidNull(): never { throw new Error('AWS lakehouse null values support only eq() and ne().'); }

type AthenaQueryObservation = {
  readonly state: 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'CANCELLATION_PENDING' | 'OUTCOME_UNKNOWN';
  readonly requested?: 'cancelled' | 'timed-out';
  readonly reason?: string;
  readonly scannedBytes: number;
};

async function waitForAthena(
  client: AthenaClient,
  queryId: string,
  timeout: string | undefined,
  signal: AbortSignal | undefined,
  cancellationConfirmationTimeoutMs: number,
): Promise<AthenaQueryObservation> {
  const deadline = Date.now() + timeoutMs(timeout ?? '20s');
  while (true) {
    if (signal?.aborted || Date.now() >= deadline) {
      return reconcileAthenaCancellation(
        client,
        queryId,
        signal?.aborted ? 'cancelled' : 'timed-out',
        cancellationConfirmationTimeoutMs,
      );
    }
    const response = await client.send(new GetQueryExecutionCommand({ QueryExecutionId: queryId }));
    const state = response.QueryExecution?.Status?.State;
    if (state && ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(state)) {
      const reason = response.QueryExecution?.Status?.StateChangeReason;
      return { state: state as 'SUCCEEDED' | 'FAILED' | 'CANCELLED', ...(reason ? { reason } : {}), scannedBytes: Number(response.QueryExecution?.Statistics?.DataScannedInBytes ?? 0) };
    }
    try {
      await delay(Math.min(250, Math.max(1, deadline - Date.now())), signal);
    } catch (cause) {
      if (!signal?.aborted) throw cause;
    }
  }
}

async function reconcileAthenaCancellation(
  client: AthenaClient,
  queryId: string,
  requested: 'cancelled' | 'timed-out',
  confirmationTimeoutMs: number,
): Promise<AthenaQueryObservation> {
  try {
    await client.send(new StopQueryExecutionCommand({ QueryExecutionId: queryId }));
  } catch {
    return {
      state: 'OUTCOME_UNKNOWN',
      requested,
      reason: 'Athena cancellation could not be requested; provider outcome is unknown.',
      scannedBytes: 0,
    };
  }
  const confirmationDeadline = Date.now() + confirmationTimeoutMs;
  while (Date.now() < confirmationDeadline) {
    try {
      const response = await client.send(new GetQueryExecutionCommand({ QueryExecutionId: queryId }));
      const state = response.QueryExecution?.Status?.State;
      if (state && ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(state)) {
        const reason = response.QueryExecution?.Status?.StateChangeReason;
        return {
          state: state as 'SUCCEEDED' | 'FAILED' | 'CANCELLED',
          requested,
          ...(reason ? { reason } : {}),
          scannedBytes: Number(response.QueryExecution?.Statistics?.DataScannedInBytes ?? 0),
        };
      }
    } catch {
      return {
        state: 'OUTCOME_UNKNOWN',
        requested,
        reason: 'Athena cancellation was requested, but terminal state could not be reconciled.',
        scannedBytes: 0,
      };
    }
    await delay(Math.min(100, Math.max(1, confirmationDeadline - Date.now())));
  }
  return {
    state: 'CANCELLATION_PENDING',
    requested,
    reason: `Athena ${requested === 'timed-out' ? 'timeout' : 'cancellation'} was requested but provider completion is still pending.`,
    scannedBytes: 0,
  };
}

function scalarValue(value: string | undefined, schema: unknown): unknown {
  if (value === undefined) return null;
  const property = schema && typeof schema === 'object' && !Array.isArray(schema) ? schema as Record<string, unknown> : {};
  const type = Array.isArray(property.type) ? property.type.find((entry) => entry !== 'null') : property.type;
  if (type === 'integer' || type === 'number') return Number(value);
  if (type === 'boolean') return value === 'true';
  return value;
}
function schemaProperty(schema: Readonly<Record<string, unknown>>, name: string): unknown { return (schema.properties as Record<string, unknown> | undefined)?.[name]; }

function authorityKey(configuration: { readonly prefix: string }): string { return `${cleanPrefix(configuration.prefix)}/authority.json`; }
function manifestObjectKey(configuration: { readonly prefix: string }, snapshot: string): string { return `${cleanPrefix(configuration.prefix)}/manifests/${snapshot}.json`; }
function dataObjectKey(configuration: { readonly prefix: string }, objectId: string): string { return `${cleanPrefix(configuration.prefix)}/objects/${objectId}.ndjson`; }
function snapshotLinkPrefix(configuration: { readonly prefix: string }, snapshot: string): string { return `${cleanPrefix(configuration.prefix)}/snapshot-links/${snapshot}`; }
function snapshotLinkKey(configuration: { readonly prefix: string }, snapshot: string): string { return `${snapshotLinkPrefix(configuration, snapshot)}/objects.symlink`; }
function cleanPrefix(value: string): string { return value.replace(/^\/+|\/+$/gu, '') || 'lakehouse'; }
function snapshotTableName(configuration: { readonly datasetId: string }, snapshot: string): string { return `a8s_${safeName(configuration.datasetId, 22)}_${snapshot.replace(/^snapshot_/u, '').slice(0, 24)}`; }
function safeName(value: string, maximum: number): string { return value.toLowerCase().replace(/[^a-z0-9_]+/gu, '_').replace(/^_+|_+$/gu, '').slice(0, maximum) || 'dataset'; }
function physicalRows<TRow extends object>(manifest: ApplicationLakehouseManifest<TRow>, object: ApplicationLakehouseManifest<TRow>['objects'][number]): string {
  const rows = manifest.rows.slice(object.rowOffset, object.rowOffset + object.rowCount);
  const identities = manifest.rowIdentities.slice(object.rowOffset, object.rowOffset + object.rowCount);
  return `${rows.map((row, index) => JSON.stringify({ ...row, __applik8s_row_id: identities[index] })).join('\n')}\n`;
}
function digest(value: unknown): string { return createHash('sha256').update(stableJson(value)).digest('hex'); }
function stableJson(value: unknown): string { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`; return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`; }

type ApplicationLakehouseCursorCodec = ReturnType<typeof createApplicationLakehouseCursorCodec>;

async function encodeCursor(
  codec: ApplicationLakehouseCursorCodec,
  value: ApplicationLakehouseCursorPayload,
): Promise<string> {
  return codec.sign(value, { expiresAt: value.expiresAt });
}

async function decodeCursor(codec: ApplicationLakehouseCursorCodec, value: string, expected: {
  readonly dataset: string;
  readonly snapshot: string;
  readonly schemaRevision: string;
  readonly queryShape: string;
  readonly principalScope: string;
  readonly queryId: string;
}): Promise<number> {
  let cursor: ApplicationLakehouseCursorPayload;
  try {
    cursor = await codec.verify(value);
  } catch (cause) {
    if (isSignedEnvelopeExpiry(cause)) throw expiredAwsLakehouseCursor(expected);
    throw new Error('AWS lakehouse cursor is malformed or has an invalid signature.', { cause });
  }
  if (cursor.snapshot !== expected.snapshot || cursor.queryShape !== expected.queryShape || cursor.principalScope !== expected.principalScope) throw new Error('AWS lakehouse cursor does not match this snapshot, query, or principal.');
  if (cursor.expiresAt < Date.now()) throw expiredAwsLakehouseCursor(expected);
  return cursor.offset;
}

function isSignedEnvelopeExpiry(cause: unknown): boolean {
  return !!cause && typeof cause === 'object' && Reflect.get(cause, 'code') === 'SIGNED_ENVELOPE_EXPIRED';
}

function expiredAwsLakehouseCursor(expected: {
  readonly queryId: string;
  readonly dataset: string;
  readonly snapshot: string;
  readonly schemaRevision: string;
}) {
  return applicationLakehouseQueryTerminalError({
    queryId: expected.queryId,
    dataset: expected.dataset,
    snapshot: expected.snapshot,
    schemaRevision: expected.schemaRevision,
    provider: 'athena',
    state: 'expired',
    diagnostic: 'AWS lakehouse query result cursor expired.',
  });
}

function validateDataset(value: AwsApplicationLakehouseDatasetConfiguration<object>): void {
  for (const field of ['datasetId', 'bucket', 'prefix', 'catalogDatabase', 'schemaRevision', 'cursorKey'] as const) if (!value[field].trim()) throw new Error(`AWS lakehouse dataset ${field} is required.`);
  if (value.cursorKey.length < 32) throw new Error('AWS lakehouse cursor key must contain at least 32 characters.');
  schemaColumns(value.schema);
  if (value.maximumObjectsPerSnapshot !== undefined) boundedInteger(value.maximumObjectsPerSnapshot, 1, 10_000, 'AWS lakehouse maximumObjectsPerSnapshot');
  if (value.retainedSnapshots !== undefined) boundedInteger(value.retainedSnapshots, 1, 100_000, 'AWS lakehouse retainedSnapshots');
}

function schemaProperties(schema: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const properties = schema.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) throw new Error('AWS lakehouse rows require an object JSON schema with explicit properties.');
  return properties as Readonly<Record<string, unknown>>;
}
function boundedInteger(value: number, minimum: number, maximum: number, label: string): number { if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${label} must be from ${minimum} through ${maximum}.`); return value; }
function timeoutMs(value: string): number { const match = /^(\d+)(ms|s|m)$/u.exec(value); if (!match) throw new Error(`AWS lakehouse timeout ${value} is invalid.`); return Number(match[1]) * (match[2] === 'ms' ? 1 : match[2] === 's' ? 1_000 : 60_000); }
function redactedDiagnostic(value: string): string { return value.replace(/[\r\n\t]+/gu, ' ').slice(0, 512); }
function isNotFound(cause: unknown): boolean { return cause instanceof NoSuchKey || Reflect.get(cause as object, 'name') === 'NoSuchKey' || Reflect.get(Reflect.get(cause as object, '$metadata') ?? {}, 'httpStatusCode') === 404; }
function isPreconditionFailed(cause: unknown): boolean { return Reflect.get(Reflect.get(cause as object, '$metadata') ?? {}, 'httpStatusCode') === 412 || Reflect.get(cause as object, 'name') === 'PreconditionFailed'; }
function delay(ms: number, signal?: AbortSignal): Promise<void> { return new Promise((resolve, reject) => { const timer = setTimeout(resolve, ms); signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true }); }); }
function createSemaphore(maximum: number): { acquire(signal?: AbortSignal): Promise<() => void> } {
  boundedInteger(maximum, 1, 64, 'AWS lakehouse maximumConcurrentQueries');
  let active = 0;
  const queue: Array<() => void> = [];
  return { async acquire(signal) { if (signal?.aborted) throw signal.reason; if (active >= maximum) await new Promise<void>((resolve, reject) => { const admitted = () => resolve(); queue.push(admitted); signal?.addEventListener('abort', () => { const index = queue.indexOf(admitted); if (index >= 0) queue.splice(index, 1); reject(signal.reason); }, { once: true }); }); active += 1; let released = false; return () => { if (released) return; released = true; active -= 1; queue.shift()?.(); }; } };
}
