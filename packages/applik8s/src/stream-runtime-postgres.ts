// typecast-file-boundary: PostgreSQL result rows are checked by the runtime contract before restoring stream event shapes.

import { validateApplicationTelemetryEnvelopeV1 } from '@applik8s/core';
import { normalizeSchema } from '@applik8s/sdk/schema-runtime';
import type { ApplicationQueryPrincipal } from './application-queries.js';
import type { ApplicationStreamBinding } from './application-reactive.js';
import { applicationPublicStreamCommitScope } from './application-stream-commit.js';
import { applicationCommandPrincipal, applicationCommandTrustedContext } from './command-principal.js';
import type { ApplicationPostgresSql } from './postgres-runtime-contract.js';
import { createApplicationPostgresSql } from './postgres-runtime-loader.js';
import type { ApplicationReplayableStream, ApplicationReplayPage, ApplicationStreamEnvelope } from './projection-runtime-clickhouse.js';

export interface PostgresApplicationStreamOptions<TPayload extends object, TPrincipal extends ApplicationQueryPrincipal> {
  readonly stream: ApplicationStreamBinding<TPayload, TPrincipal>;
  readonly databaseUrl?: string;
  readonly sql?: ApplicationPostgresSql;
  readonly principal: TPrincipal;
  /** Digest of provider-admitted context. Raw access values never enter replay filters or cursors. */
  readonly contextDigest?: string;
  /** Internal processor mode. Public subscriptions and replay APIs must leave this disabled. */
  readonly includeTrustedContext?: boolean;
  /**
   * Compiler-issued read authority for a graph-declared internal consumer.
   * Public replay/subscription paths must omit this and pass stream authorization.
   */
  readonly internalConsumer?: { readonly kind: 'processor' | 'projection'; readonly name: string };
}

export interface PostgresApplicationStream<TPayload extends object> extends ApplicationReplayableStream<TPayload> {
  close(): Promise<void>;
}

export interface PostgresApplicationStreamRetentionOptions<TPayload extends object> {
  readonly stream: ApplicationStreamBinding<TPayload>;
  readonly databaseUrl?: string;
  readonly sql?: ApplicationPostgresSql;
  readonly now?: Date;
  readonly batchSize?: number;
}

/** Durable PostgreSQL outbox replay authority for an explicit public stream. */
// typecast-boundary: the PostgreSQL client is selected after the sql-or-URL invariant and payloads are schema-validated.
export function createPostgresApplicationStream<TPayload extends object, TPrincipal extends ApplicationQueryPrincipal>(options: PostgresApplicationStreamOptions<TPayload, TPrincipal>): PostgresApplicationStream<TPayload> {
  if (options.stream.authority !== 'postgres-outbox') throw new Error(`Stream ${options.stream.definition.id} is not backed by the PostgreSQL outbox authority.`);
  if (!options.sql && !options.databaseUrl) throw new Error(`Stream ${options.stream.definition.id} requires sql or databaseUrl.`);
  const ownsClient = !options.sql;
  const client = options.sql ? Promise.resolve(options.sql) : createApplicationPostgresSql(options.databaseUrl as string, { max: 4, idle_timeout: 20, connect_timeout: 10, prepare: false });
  return {
    async read(afterSequence, limit) {
      if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) throw new Error('Application stream replay sequence must be a non-negative safe integer.');
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) throw new Error('Application stream replay limit must be between 1 and 1000.');
      if (options.internalConsumer) {
        const expectedPrincipal = `applik8s:${options.internalConsumer.kind}:${options.internalConsumer.name}`;
        if (options.principal.id !== expectedPrincipal) throw new ApplicationStreamAuthorizationError(options.stream.definition.id);
      } else if (!await options.stream.authorize(options.principal, 'replay')) {
        throw new ApplicationStreamAuthorizationError(options.stream.definition.id);
      }
      const [name, version] = [options.stream.definition.name, options.stream.definition.version];
      return (await client).begin(async (transaction) => {
        await transaction.unsafe('SELECT pg_advisory_xact_lock_shared(hashtextextended($1, 0))', [applicationPublicStreamCommitScope(name, version)]);
        const contextClause = options.contextDigest ? ' AND context_digest = $5' : '';
        const parameters = [name, version, afterSequence, limit + 1, ...(options.contextDigest ? [options.contextDigest] : [])];
        const floorParameters = [name, version, options.contextDigest ?? ''];
        const [floorRows, rows] = await Promise.all([
          transaction.unsafe('SELECT coalesce(max(deleted_through), 0) AS retention_floor FROM applik8s_public_stream_retention_floors WHERE contract_name = $1 AND contract_version = $2 AND context_digest = $3', floorParameters),
          transaction.unsafe(`SELECT id, sequence, partition_key, recorded_at, context_digest, payload${options.includeTrustedContext ? ', envelope' : ''} FROM applik8s_public_stream_events WHERE contract_name = $1 AND contract_version = $2 AND sequence > $3${contextClause} ORDER BY sequence ASC LIMIT $4`, parameters),
        ]);
        const pageRows = rows.slice(0, limit);
        const items = pageRows.map((row) => streamEnvelope<TPayload>(options.stream, row, options.includeTrustedContext === true));
        const retentionFloor = Number(floorRows[0]?.retention_floor ?? 0);
        if (!Number.isSafeInteger(retentionFloor) || retentionFloor < 0) throw new Error(`PostgreSQL returned an invalid ${options.stream.definition.id} retention floor.`);
        return { items, nextSequence: items.at(-1)?.sequence ?? afterSequence, exhausted: rows.length <= limit, retentionFloor } satisfies ApplicationReplayPage<TPayload>;
      });
    },
    async close() {
      if (ownsClient) await (await client).end({ timeout: 5 });
    },
  };
}

/**
 * Enforces a public stream's independently declared history bounds.
 *
 * Transport outbox cleanup must never call this path: the public stream is a
 * separate replay authority and is trimmed only by its own retention contract.
 */
// typecast-boundary: the PostgreSQL client is selected after the sql-or-URL invariant for this bounded retention operation.
export async function enforcePostgresApplicationStreamRetention<TPayload extends object>(options: PostgresApplicationStreamRetentionOptions<TPayload>): Promise<{ readonly deleted: number }> {
  if (!options.sql && !options.databaseUrl) throw new Error(`Stream ${options.stream.definition.id} retention requires sql or databaseUrl.`);
  const batchSize = options.batchSize ?? 1_000;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 10_000) throw new Error('Application stream retention batchSize must be between 1 and 10000.');
  const ownsClient = !options.sql;
  const client = options.sql ? Promise.resolve(options.sql) : createApplicationPostgresSql(options.databaseUrl as string, { max: 1, idle_timeout: 20, connect_timeout: 10, prepare: false });
  const [name, version] = [options.stream.definition.name, options.stream.definition.version];
  const now = (options.now ?? new Date()).toISOString();
  const maxMessages = options.stream.retention.maxMessages ?? null;
  try {
    const rows = await (await client).begin(async (transaction) => {
      await transaction.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [applicationPublicStreamCommitScope(name, version)]);
      return transaction.unsafe(`WITH ranked AS (
  SELECT id, sequence, context_digest, recorded_at, row_number() OVER (ORDER BY sequence DESC) AS retained_rank
  FROM applik8s_public_stream_events
  WHERE contract_name = $1 AND contract_version = $2
), candidates AS (
  SELECT id FROM ranked
  WHERE recorded_at < $3::timestamptz - make_interval(secs => $4)
     OR ($5::bigint IS NOT NULL AND retained_rank > $5::bigint)
  ORDER BY recorded_at ASC, id ASC
  LIMIT $6
), deleted AS (
DELETE FROM applik8s_public_stream_events events
USING candidates
WHERE events.id = candidates.id
RETURNING events.id, events.sequence, events.context_digest
), global_floor AS (
  INSERT INTO applik8s_public_stream_retention_floors (contract_name, contract_version, context_digest, deleted_through, updated_at)
  SELECT $1, $2, '', max(sequence), now() FROM deleted HAVING count(*) > 0
  ON CONFLICT (contract_name, contract_version, context_digest) DO UPDATE
  SET deleted_through = greatest(applik8s_public_stream_retention_floors.deleted_through, EXCLUDED.deleted_through), updated_at = now()
), context_floors AS (
  INSERT INTO applik8s_public_stream_retention_floors (contract_name, contract_version, context_digest, deleted_through, updated_at)
  SELECT $1, $2, context_digest, max(sequence), now() FROM deleted GROUP BY context_digest
  ON CONFLICT (contract_name, contract_version, context_digest) DO UPDATE
  SET deleted_through = greatest(applik8s_public_stream_retention_floors.deleted_through, EXCLUDED.deleted_through), updated_at = now()
)
SELECT id FROM deleted`, [name, version, now, options.stream.retention.maxAgeSeconds, maxMessages, batchSize]);
    });
    return { deleted: rows.length };
  } finally {
    if (ownsClient) await (await client).end({ timeout: 5 });
  }
}

export class ApplicationStreamAuthorizationError extends Error {
  readonly code = 'APPLIK8S_STREAM_FORBIDDEN';
  constructor(readonly stream: string) {
    super(`Application stream ${stream} replay is not authorized for the established principal.`);
    this.name = 'ApplicationStreamAuthorizationError';
  }
}

// typecast-boundary: normalizeSchema validates the opaque PostgreSQL JSON payload before it enters the stream envelope.
function streamEnvelope<TPayload extends object>(stream: ApplicationStreamBinding<TPayload>, row: Record<string, unknown>, includeTrustedContext: boolean): ApplicationStreamEnvelope<TPayload> {
  const sequence = Number(row.sequence);
  const recordedAt = row.recorded_at instanceof Date ? row.recorded_at.toISOString() : String(row.recorded_at);
  const rawPayload = postgresStreamJsonValue(row.payload);
  if (typeof row.id !== 'string' || !Number.isSafeInteger(sequence) || sequence < 1 || typeof row.partition_key !== 'string' || !rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) throw new Error(`PostgreSQL returned an invalid ${stream.definition.id} outbox row.`);
  const payload = normalizeSchema(stream.definition.payload, `${stream.definition.id}.payload`).validate(rawPayload as never);
  if (!payload.ok) throw new Error(`PostgreSQL returned an invalid ${stream.definition.id} payload: ${payload.error.message}`);
  const contextDigest = typeof row.context_digest === 'string' && row.context_digest.length > 0 ? row.context_digest : undefined;
  const durableContext = includeTrustedContext
    ? durableEnvelopeContext(postgresStreamJsonValue(row.envelope))
    : undefined;
  const principal = applicationCommandPrincipal(durableContext);
  const trustedContext = durableContext ? applicationCommandTrustedContext(durableContext) : undefined;
  const changeScopes = durableContext?.changeScopes;
  const telemetry = includeTrustedContext
    ? durableEnvelopeTelemetry(postgresStreamJsonValue(row.envelope))
    : undefined;
  return {
    id: row.id,
    stream: { name: stream.definition.name, version: stream.definition.version },
    sequence,
    partitionKey: row.partition_key,
    recordedAt,
    ...(contextDigest ? { contextDigest } : {}),
    ...(principal ? { principal } : {}),
    ...(trustedContext ? { trustedContext } : {}),
    ...(changeScopes ? { changeScopes } : {}),
    ...(telemetry ? { telemetry } : {}),
    payload: payload.value,
  };
}

function durableEnvelopeTelemetry(
  envelope: unknown,
): import('@applik8s/core').ApplicationTelemetryEnvelopeV1 | undefined {
  if (!envelope || typeof envelope !== 'object') return undefined;
  const telemetry = Reflect.get(envelope, 'telemetry');
  try {
    validateApplicationTelemetryEnvelopeV1(telemetry);
    return telemetry;
  } catch {
    // Telemetry evidence never becomes application delivery authority. An
    // invalid carrier is dropped while the durable event remains consumable.
    return undefined;
  }
}

function postgresStreamJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function durableEnvelopeContext(envelope: unknown): {
  readonly values: Readonly<Record<string, import('@applik8s/core').JsonValue>>;
  readonly digest?: string;
  readonly changeScopes?: Readonly<Record<string, string>>;
} | undefined {
  if (!envelope || typeof envelope !== 'object') return undefined;
  const context = Reflect.get(envelope, 'trustedContext');
  if (!context || typeof context !== 'object') return undefined;
  const values = Reflect.get(context, 'values');
  if (!values || typeof values !== 'object' || Array.isArray(values)) return undefined;
  const digest = Reflect.get(context, 'digest');
  const rawScopes = Reflect.get(context, 'changeScopes');
  const changeScopes = validChangeScopes(rawScopes) ? rawScopes : undefined;
  return {
    values: values as Readonly<Record<string, import('@applik8s/core').JsonValue>>,
    ...(typeof digest === 'string' && /^[a-f0-9]{64}$/i.test(digest) ? { digest } : {}),
    ...(changeScopes ? { changeScopes } : {}),
  };
}

function validChangeScopes(value: unknown): value is Readonly<Record<string, string>> {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.values(value).every((digest) => typeof digest === 'string' && /^[a-f0-9]{64}$/i.test(digest)),
  );
}
