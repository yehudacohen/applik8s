// typecast-file-boundary: ClickHouse JSON wire values are validated and normalized at this analytical-database adapter boundary.
import type { SchemaInput } from '@applik8s/sdk';
import { normalizeSchema } from '@applik8s/sdk/schema-runtime';
import type { JsonValue } from '@applik8s/core';
import type { ApplicationCommandPrincipal } from './command-principal.js';
import type {
  ApplicationAnalyticalMeasure,
  ApplicationAnalyticalQueryRuntimeSource,
} from './application-queries.js';

export interface ApplicationStreamEnvelope<TPayload extends object = object> {
  readonly id: string;
  readonly stream: { readonly name: string; readonly version: string };
  readonly sequence: number;
  readonly partitionKey: string;
  readonly recordedAt: string;
  /** Opaque provider-admitted context scope. Raw trusted values are never exposed to replay consumers. */
  readonly contextDigest?: string;
  /** Present only for explicitly internal processor reads, never public replay/subscription reads. */
  readonly principal?: ApplicationCommandPrincipal;
  /** Present only for explicitly internal processor reads, with reserved identity keys removed. */
  readonly trustedContext?: Readonly<Record<string, JsonValue>>;
  readonly payload: TPayload;
}

export interface ApplicationReplayPage<TPayload extends object> {
  readonly items: readonly ApplicationStreamEnvelope<TPayload>[];
  readonly nextSequence: number;
  readonly exhausted: boolean;
  /**
   * Highest sequence actually deleted by this stream's retention policy.
   * Zero means no retained event is known to have been removed. Sequence IDs
   * are database-global and therefore cannot use min(available sequence) as a
   * loss signal for one filtered stream.
   */
  readonly retentionFloor: number;
}

export interface ApplicationReplayableStream<TPayload extends object> {
  read(afterSequence: number, limit: number): Promise<ApplicationReplayPage<TPayload>>;
}

export interface ApplicationProjectionCheckpoint {
  readonly projection: string;
  readonly stream: string;
  readonly sequence: number;
}

export interface ApplicationProjectionWriter<TRow extends object> {
  prepare(): Promise<void>;
  checkpoint(projection: string, stream: string): Promise<ApplicationProjectionCheckpoint>;
  write(events: readonly { readonly envelope: ApplicationStreamEnvelope; readonly rows: readonly TRow[] }[]): Promise<void>;
  advance(checkpoint: ApplicationProjectionCheckpoint): Promise<void>;
  reset(projection: string, stream: string): Promise<void>;
}

export interface ClickHouseAnalyticalProjectionWriterOptions<TRow extends object> {
  readonly endpoint: string;
  readonly database?: string;
  readonly table: string;
  readonly projection: string;
  readonly stream: string;
  readonly schema: SchemaInput<TRow>;
  readonly username?: string;
  readonly password?: string;
  readonly fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  readonly timeoutMs?: number;
}

export interface ClickHouseAnalyticalProjectionReaderOptions<TRow extends object> {
  readonly endpoint: string;
  readonly database?: string;
  readonly table: string;
  readonly projection: string;
  readonly schema: SchemaInput<TRow>;
  /** Allows one generated gateway to retain relational fallbacks when analytics is intentionally omitted. */
  readonly enabled?: boolean;
  readonly username?: string;
  readonly password?: string;
  readonly fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  readonly timeoutMs?: number;
}

/**
 * Creates a bounded analytical reader over one projection table.
 *
 * Application code supplies only schema-declared dimensions and measures. The
 * adapter owns SQL generation, identifier quoting, row limits, credentials,
 * and the provider revision used by resumable invalidation cursors.
 */
export function createClickHouseAnalyticalProjectionReader<TRow extends object>(
  options: ClickHouseAnalyticalProjectionReaderOptions<TRow>,
): ApplicationAnalyticalQueryRuntimeSource<TRow> {
  const database = clickHouseIdentifier(options.database ?? 'default', 'database');
  const table = clickHouseIdentifier(options.table, 'table');
  const request = clickHouseRequester(options);
  const columns = new Map(clickHouseColumns(options.schema, `${options.projection}.output`).map((column) => [column.name, column]));
  const qualifiedTable = `${quoteIdentifier(database)}.${quoteIdentifier(table)}`;

  async function revision(): Promise<string> {
    if (options.enabled === false) return 'not-configured';
    const body = await request(`SELECT coalesce(max(\`_applik8s_source_sequence\`), 0) AS revision FROM ${qualifiedTable} FINAL FORMAT JSONEachRow`);
    const row = parseClickHouseRow(body, `${options.projection} revision`);
    const value = Number(row.revision ?? 0);
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`ClickHouse projection ${options.projection} returned an invalid revision.`);
    return String(value);
  }

  const source: ApplicationAnalyticalQueryRuntimeSource<TRow> = {
    revision,
    async snapshot(operation) {
      // Capture the revision first. A concurrent insert can cause at most one
      // redundant invalidation; it cannot be hidden behind a newer cursor.
      const capturedRevision = await revision();
      return { value: await operation(source), revision: capturedRevision };
    },
    async aggregate(optionsValue) {
      if (options.enabled === false) throw new ApplicationAnalyticalProjectionNotConfiguredError(options.projection);
      const limit = optionsValue.limit;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
        throw new Error(`ClickHouse projection ${options.projection} aggregate limit must be between 1 and 1000.`);
      }
      const dimensions = [...optionsValue.dimensions];
      if (new Set(dimensions).size !== dimensions.length) throw new Error(`ClickHouse projection ${options.projection} aggregate dimensions must be unique.`);
      for (const dimension of dimensions) requiredAnalyticalColumn(columns, dimension, options.projection);
      const measures = Object.entries(optionsValue.measures);
      if (measures.length < 1) throw new Error(`ClickHouse projection ${options.projection} aggregate requires at least one measure.`);
      for (const [alias, measure] of measures) validateAnalyticalMeasure(columns, alias, measure, options.projection, dimensions);
      const resultFields = new Set<string>([...dimensions, ...measures.map(([alias]) => alias)]);
      const orderBy = optionsValue.orderBy ?? [];
      for (const order of orderBy) {
        if (!resultFields.has(order.field)) throw new Error(`ClickHouse projection ${options.projection} aggregate cannot order by undeclared result field ${order.field}.`);
      }
      const select = [
        ...dimensions.map(quoteIdentifier),
        ...measures.map(([alias, measure]) => `${analyticalMeasureExpression(measure)} AS ${quoteIdentifier(alias)}`),
      ];
      const query = `SELECT ${select.join(', ')} FROM ${qualifiedTable} FINAL${dimensions.length > 0 ? ` GROUP BY ${dimensions.map(quoteIdentifier).join(', ')}` : ''}${orderBy.length > 0 ? ` ORDER BY ${orderBy.map((order) => `${quoteIdentifier(order.field)} ${order.direction.toUpperCase()}`).join(', ')}` : ''} LIMIT ${limit} FORMAT JSONEachRow`;
      const body = await request(query);
      const items = body.trim().length === 0 ? [] : body.trim().split('\n').map((line, index) => {
        const row = parseClickHouseRow(line, `${options.projection} aggregate row ${index}`);
        for (const dimension of dimensions) validateAnalyticalDimension(row[dimension], requiredAnalyticalColumn(columns, dimension, options.projection), `${options.projection}.${dimension}`);
        for (const [alias] of measures) {
          const value = Number(row[alias]);
          if (!Number.isFinite(value)) throw new Error(`ClickHouse projection ${options.projection} aggregate measure ${alias} is not finite.`);
          row[alias] = value;
        }
        return row;
      });
      return {
        // typecast: dimensions originate from TRow and each declared measure is normalized to a finite number above.
        items: items as never,
        projection: { revision: await revision(), degraded: false },
      };
    },
  };
  return source;
}

export class ApplicationAnalyticalProjectionNotConfiguredError extends Error {
  readonly code = 'APPLIK8S_ANALYTICAL_PROJECTION_NOT_CONFIGURED';

  constructor(readonly projection: string) {
    super(`Analytical projection ${projection} is not configured for this application installation.`);
    this.name = 'ApplicationAnalyticalProjectionNotConfiguredError';
  }
}

/**
 * Creates a ClickHouse analytical sink with idempotent source-event writes.
 *
 * ReplacingMergeTree deduplicates stable event IDs eventually. The durable source
 * and checkpoint remain authoritative; this adapter intentionally does not claim
 * a cross-system exactly-once transaction.
 */
export function createClickHouseAnalyticalProjectionWriter<TRow extends object>(options: ClickHouseAnalyticalProjectionWriterOptions<TRow>): ApplicationProjectionWriter<TRow> {
  const database = clickHouseIdentifier(options.database ?? 'default', 'database');
  const table = clickHouseIdentifier(options.table, 'table');
  const checkpointTable = 'applik8s_projection_checkpoints';
  const request = clickHouseRequester(options);
  const columns = clickHouseColumns(options.schema, `${options.projection}.output`);
  const qualifiedTable = `${quoteIdentifier(database)}.${quoteIdentifier(table)}`;
  const qualifiedCheckpoints = `${quoteIdentifier(database)}.${quoteIdentifier(checkpointTable)}`;

  return {
    async prepare() {
      // A provisioned ClickHouse installation starts with only the default
      // database. The projection store owns its configured logical database
      // and must be able to bootstrap it on a clean cluster.
      await request(`CREATE DATABASE IF NOT EXISTS ${quoteIdentifier(database)}`);
      await request(`CREATE TABLE IF NOT EXISTS ${qualifiedTable} (${[
        '`_applik8s_event_id` String',
        '`_applik8s_row_index` UInt32',
        '`_applik8s_source_sequence` UInt64',
        '`_applik8s_partition_key` String',
        "`_applik8s_recorded_at` DateTime64(3, 'UTC')",
        ...columns.map((column) => `${quoteIdentifier(column.name)} ${column.type}`),
      ].join(', ')}) ENGINE = ReplacingMergeTree(_applik8s_source_sequence) ORDER BY (_applik8s_event_id, _applik8s_row_index)`);
      await request(`CREATE TABLE IF NOT EXISTS ${qualifiedCheckpoints} (\`projection\` String, \`stream\` String, \`sequence\` UInt64, \`updated_at\` DateTime64(3, 'UTC')) ENGINE = ReplacingMergeTree(\`sequence\`) ORDER BY (\`projection\`, \`stream\`)`);
    },
    async checkpoint(projection, stream) {
      const body = await request(`SELECT coalesce(max(\`sequence\`), 0) AS sequence FROM ${qualifiedCheckpoints} FINAL WHERE \`projection\` = {projection:String} AND \`stream\` = {stream:String} FORMAT JSONEachRow`, { projection, stream });
      // typecast: ClickHouse JSONEachRow is consumed only for the validated scalar sequence field.
      const row = body.trim() ? JSON.parse(body.trim().split('\n')[0] ?? '{}') as { readonly sequence?: unknown } : {};
      const sequence = Number(row.sequence ?? 0);
      if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error('ClickHouse projection checkpoint returned an invalid sequence.');
      return { projection, stream, sequence };
    },
    async write(events) {
      if (events.length === 0) return;
      const lines: string[] = [];
      for (const event of events) {
        for (const [rowIndex, row] of event.rows.entries()) {
          const validated = validateProjectionRow(options.schema, row, `${options.projection}.output`);
          lines.push(JSON.stringify({
            _applik8s_event_id: event.envelope.id,
            _applik8s_row_index: rowIndex,
            _applik8s_source_sequence: event.envelope.sequence,
            _applik8s_partition_key: event.envelope.partitionKey,
            _applik8s_recorded_at: event.envelope.recordedAt,
            ...validated,
          }));
        }
      }
      if (lines.length > 0) await request(`INSERT INTO ${qualifiedTable} FORMAT JSONEachRow`, undefined, `${lines.join('\n')}\n`);
    },
    async advance(checkpoint) {
      if (!Number.isSafeInteger(checkpoint.sequence) || checkpoint.sequence < 0) throw new Error('Projection checkpoint sequence must be a non-negative safe integer.');
      await request(`INSERT INTO ${qualifiedCheckpoints} FORMAT JSONEachRow`, undefined, `${JSON.stringify({ ...checkpoint, updated_at: new Date().toISOString() })}\n`);
    },
    async reset(projection, stream) {
      if (projection !== options.projection || stream !== options.stream) throw new Error('ClickHouse projection reset is scoped to its configured projection and stream.');
      await request(`TRUNCATE TABLE ${qualifiedTable}`);
      await request(`ALTER TABLE ${qualifiedCheckpoints} DELETE WHERE \`projection\` = {projection:String} AND \`stream\` = {stream:String} SETTINGS mutations_sync = 2`, { projection, stream });
    },
  };
}

export interface RunApplicationProjectionOptions<TPayload extends object, TRow extends object> {
  readonly projection: string;
  readonly streamName: string;
  readonly source: ApplicationReplayableStream<TPayload>;
  readonly store: ApplicationProjectionWriter<TRow>;
  readonly project: (payload: TPayload, event: { readonly id: string; readonly recordedAt: string; readonly partitionKey: string }) => TRow | readonly TRow[] | Promise<TRow | readonly TRow[]>;
  readonly batchSize?: number;
  readonly maxBatches?: number;
}

export async function runApplicationProjection<TPayload extends object, TRow extends object>(options: RunApplicationProjectionOptions<TPayload, TRow>): Promise<{ readonly processed: number; readonly checkpoint: number; readonly exhausted: boolean }> {
  const batchSize = options.batchSize ?? 100;
  const maxBatches = options.maxBatches ?? 100;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1_000) throw new Error('Projection batchSize must be between 1 and 1000.');
  if (!Number.isSafeInteger(maxBatches) || maxBatches < 1 || maxBatches > 10_000) throw new Error('Projection maxBatches must be between 1 and 10000.');
  await options.store.prepare();
  let checkpoint = await options.store.checkpoint(options.projection, options.streamName);
  let processed = 0;
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const page = await options.source.read(checkpoint.sequence, batchSize);
    if (page.retentionFloor > checkpoint.sequence) {
      throw new ApplicationProjectionRetentionGapError(options.projection, options.streamName, checkpoint.sequence, page.retentionFloor);
    }
    const events = await Promise.all(page.items.map(async (envelope) => {
      const projected = await options.project(envelope.payload, { id: envelope.id, recordedAt: envelope.recordedAt, partitionKey: envelope.partitionKey });
      return { envelope, rows: projectionRows(projected) };
    }));
    await options.store.write(events);
    checkpoint = { ...checkpoint, sequence: page.nextSequence };
    await options.store.advance(checkpoint);
    processed += page.items.length;
    if (page.exhausted) return { processed, checkpoint: checkpoint.sequence, exhausted: true };
  }
  return { processed, checkpoint: checkpoint.sequence, exhausted: false };
}

export class ApplicationProjectionRetentionGapError extends Error {
  readonly code = 'APPLIK8S_PROJECTION_RETENTION_GAP';

  constructor(readonly projection: string, readonly stream: string, readonly checkpoint: number, readonly retentionFloor: number) {
    super(`Projection ${projection} checkpoint ${checkpoint} is behind retained stream ${stream} floor ${retentionFloor}. Rebuild from an authoritative snapshot or increase stream retention.`);
    this.name = 'ApplicationProjectionRetentionGapError';
  }
}

function projectionRows<TRow extends object>(value: TRow | readonly TRow[]): readonly TRow[] {
  if (Array.isArray(value)) {
    // typecast: Array.isArray proves the readonly projection result is the collection branch.
    return value as readonly TRow[];
  }
  // typecast: the non-array branch is the single projected row.
  return [value as TRow];
}

interface ClickHouseColumn {
  readonly name: string;
  readonly type: string;
}

function clickHouseColumns<TRow extends object>(schema: SchemaInput<TRow>, name: string): readonly ClickHouseColumn[] {
  const emitted = normalizeSchema(schema, name).emitJsonSchema();
  if (!emitted.ok) throw new Error(`ClickHouse projection ${name} schema is unsupported: ${emitted.error.message}`);
  const root = emitted.value.schema;
  const properties = root.properties;
  if (!properties || typeof properties !== 'object') throw new Error(`ClickHouse projection ${name} output must be an object schema.`);
  const required = new Set(Array.isArray(root.required) ? root.required.filter((field): field is string => typeof field === 'string') : []);
  return Object.entries(properties).sort(([left], [right]) => left.localeCompare(right)).map(([field, definition]) => ({ name: clickHouseIdentifier(field, 'column'), type: clickHouseType(definition, required.has(field), `${name}.${field}`) }));
}

function clickHouseType(definition: unknown, required: boolean, path: string): string {
  if (!definition || typeof definition !== 'object') throw new Error(`ClickHouse projection field ${path} has no supported JSON schema.`);
  const schemaType = Reflect.get(definition, 'type');
  const format = Reflect.get(definition, 'format');
  const base = schemaType === 'string' && format === 'date-time' ? "DateTime64(3, 'UTC')"
    : schemaType === 'string' ? 'String'
      : schemaType === 'integer' ? 'Int64'
        : schemaType === 'number' ? 'Float64'
          : schemaType === 'boolean' ? 'Bool'
            : undefined;
  if (!base) throw new Error(`ClickHouse projection field ${path} uses unsupported ${JSON.stringify(schemaType)} shape. Flatten analytical rows or provide a future explicit codec.`);
  return required ? base : `Nullable(${base})`;
}

function requiredAnalyticalColumn(columns: ReadonlyMap<string, ClickHouseColumn>, field: string, projection: string): ClickHouseColumn {
  const column = columns.get(field);
  if (!column) throw new Error(`ClickHouse projection ${projection} aggregate references unknown field ${field}.`);
  return column;
}

function validateAnalyticalMeasure<TRow extends object>(
  columns: ReadonlyMap<string, ClickHouseColumn>,
  alias: string,
  measure: ApplicationAnalyticalMeasure<TRow>,
  projection: string,
  dimensions: readonly string[],
): void {
  clickHouseIdentifier(alias, 'measure alias');
  if (dimensions.includes(alias)) throw new Error(`ClickHouse projection ${projection} aggregate measure ${alias} collides with a dimension.`);
  if (measure.operation === 'count' && measure.field === undefined) return;
  const field = measure.field;
  if (!field) throw new Error(`ClickHouse projection ${projection} aggregate measure ${alias} requires a field.`);
  const column = requiredAnalyticalColumn(columns, field, projection);
  if (!/^(?:Nullable\()?(?:Int64|Float64)\)?$/.test(column.type)) {
    throw new Error(`ClickHouse projection ${projection} aggregate measure ${alias} requires a numeric field; ${field} is ${column.type}.`);
  }
}

function analyticalMeasureExpression<TRow extends object>(measure: ApplicationAnalyticalMeasure<TRow>): string {
  if (measure.operation === 'count' && measure.field === undefined) return 'count()';
  const field = quoteIdentifier(String(measure.field));
  switch (measure.operation) {
    case 'count': return `count(${field})`;
    case 'sum': return `sum(${field})`;
    case 'min': return `min(${field})`;
    case 'max': return `max(${field})`;
    case 'average': return `avg(${field})`;
  }
}

function validateAnalyticalDimension(value: unknown, column: ClickHouseColumn, path: string): void {
  if (value === null && column.type.startsWith('Nullable(')) return;
  const type = column.type.replace(/^Nullable\((.+)\)$/, '$1');
  const valid = type === 'String' || type.startsWith('DateTime') ? typeof value === 'string'
    : type === 'Bool' ? typeof value === 'boolean' || value === 0 || value === 1
      : type === 'Int64' || type === 'Float64' ? Number.isFinite(Number(value))
        : false;
  if (!valid) throw new Error(`ClickHouse projection aggregate dimension ${path} does not match ${column.type}.`);
}

function parseClickHouseRow(value: string, label: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value.trim().split('\n')[0] ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('expected an object');
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(`ClickHouse projection ${label} returned invalid JSONEachRow: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validateProjectionRow<TRow extends object>(schema: SchemaInput<TRow>, value: unknown, name: string): TRow {
  // typecast: the normalized schema is the runtime authority at the projection provider boundary.
  const result = normalizeSchema(schema, name).validate(value as never);
  if (!result.ok) throw new Error(`ClickHouse projection ${name} validation failed: ${result.error.message}`);
  return result.value;
}

function clickHouseRequester(options: {
  readonly endpoint: string;
  readonly username?: string;
  readonly password?: string;
  readonly fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  readonly timeoutMs?: number;
}): (query: string, parameters?: Readonly<Record<string, string>>, body?: string) => Promise<string> {
  const requestFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (timeoutMs < 1 || timeoutMs > 120_000) throw new Error('ClickHouse projection timeoutMs must be between 1 and 120000.');
  return async (query, parameters = {}, body) => {
    const url = new URL(options.endpoint);
    url.searchParams.set('query', query);
    url.searchParams.set('wait_end_of_query', '1');
    // Accept canonical JavaScript/JSON ISO-8601 timestamps for DateTime64 columns.
    url.searchParams.set('date_time_input_format', 'best_effort');
    for (const [name, value] of Object.entries(parameters)) url.searchParams.set(`param_${name}`, value);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const authorization = options.username === undefined ? undefined : `Basic ${base64(`${options.username}:${options.password ?? ''}`)}`;
      const response = await requestFetch(url, { method: 'POST', signal: controller.signal, headers: { 'content-type': 'text/plain; charset=utf-8', ...(authorization ? { authorization } : {}) }, ...(body !== undefined ? { body } : {}) });
      const responseBody = await response.text();
      if (!response.ok) throw new Error(`ClickHouse projection request failed (${response.status}): ${responseBody.slice(0, 1_000)}`);
      return responseBody;
    } finally {
      clearTimeout(timeout);
    }
  };
}

function clickHouseIdentifier(value: string, kind: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error(`ClickHouse projection ${kind} ${JSON.stringify(value)} is not a safe identifier.`);
  if (value.startsWith('_applik8s_')) throw new Error(`ClickHouse projection ${kind} ${JSON.stringify(value)} uses a reserved framework prefix.`);
  return value;
}

function quoteIdentifier(value: string): string {
  return `\`${value}\``;
}

function base64(value: string): string {
  if (typeof btoa === 'function') return btoa(value);
  return Buffer.from(value).toString('base64');
}
