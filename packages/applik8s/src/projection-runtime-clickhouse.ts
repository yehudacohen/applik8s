import type { SchemaInput } from '@applik8s/sdk';
import { normalizeSchema } from '@applik8s/sdk/schema-runtime';

export interface ApplicationStreamEnvelope<TPayload extends object = object> {
  readonly id: string;
  readonly stream: { readonly name: string; readonly version: string };
  readonly sequence: number;
  readonly partitionKey: string;
  readonly recordedAt: string;
  readonly payload: TPayload;
}

export interface ApplicationReplayPage<TPayload extends object> {
  readonly items: readonly ApplicationStreamEnvelope<TPayload>[];
  readonly nextSequence: number;
  readonly exhausted: boolean;
  /** Earliest sequence still available under the stream's declared retention. Zero means the stream is empty. */
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

export interface ApplicationProjectionStore<TRow extends object> {
  prepare(): Promise<void>;
  checkpoint(projection: string, stream: string): Promise<ApplicationProjectionCheckpoint>;
  write(events: readonly { readonly envelope: ApplicationStreamEnvelope; readonly rows: readonly TRow[] }[]): Promise<void>;
  advance(checkpoint: ApplicationProjectionCheckpoint): Promise<void>;
  reset(projection: string, stream: string): Promise<void>;
}

export interface ClickHouseProjectionStoreOptions<TRow extends object> {
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

/**
 * Creates a ClickHouse analytical sink with idempotent source-event writes.
 *
 * ReplacingMergeTree deduplicates stable event IDs eventually. The durable source
 * and checkpoint remain authoritative; this adapter intentionally does not claim
 * a cross-system exactly-once transaction.
 */
export function createClickHouseProjectionStore<TRow extends object>(options: ClickHouseProjectionStoreOptions<TRow>): ApplicationProjectionStore<TRow> {
  const database = clickHouseIdentifier(options.database ?? 'default', 'database');
  const table = clickHouseIdentifier(options.table, 'table');
  const checkpointTable = 'applik8s_projection_checkpoints';
  const request = clickHouseRequester(options);
  const columns = clickHouseColumns(options.schema, `${options.projection}.output`);
  const qualifiedTable = `${quoteIdentifier(database)}.${quoteIdentifier(table)}`;
  const qualifiedCheckpoints = `${quoteIdentifier(database)}.${quoteIdentifier(checkpointTable)}`;

  return {
    async prepare() {
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
  readonly store: ApplicationProjectionStore<TRow>;
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
    if (page.retentionFloor > checkpoint.sequence + 1) {
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

function validateProjectionRow<TRow extends object>(schema: SchemaInput<TRow>, value: unknown, name: string): TRow {
  // typecast: the normalized schema is the runtime authority at the projection provider boundary.
  const result = normalizeSchema(schema, name).validate(value as never);
  if (!result.ok) throw new Error(`ClickHouse projection ${name} validation failed: ${result.error.message}`);
  return result.value;
}

function clickHouseRequester(options: ClickHouseProjectionStoreOptions<object>): (query: string, parameters?: Readonly<Record<string, string>>, body?: string) => Promise<string> {
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
