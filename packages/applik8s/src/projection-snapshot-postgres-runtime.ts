// typecast-file-boundary: native PostgreSQL rows are normalized through JSON and a declared stream schema before entering projection rebuilds.
import { createHash } from 'node:crypto';
import type { ApplicationModelRuntimeContract } from '@applik8s/core';
import type { SchemaInput } from '@applik8s/sdk';
import { normalizeSchema } from '@applik8s/sdk/schema-runtime';
import type { ApplicationPostgresSql } from './postgres-runtime-contract.js';
import { createApplicationPostgresSql } from './postgres-runtime-loader.js';

export interface ApplicationProjectionSnapshotItem<TPayload extends object> {
  readonly id: string;
  readonly payload: TPayload;
}

export interface ApplicationProjectionSnapshotSource<TPayload extends object> {
  /** Stable identity for the authoritative source, mapper, and output contract. */
  readonly definitionDigest: string;
  scan(options: {
    readonly batchSize: number;
    readonly maxItems: number;
    readonly maxDurationMs?: number;
    readonly visit: (page: {
      readonly ordinal: number;
      readonly watermark: number;
      readonly recordedAt: string;
      readonly items: readonly ApplicationProjectionSnapshotItem<TPayload>[];
    }) => void | Promise<void>;
  }): Promise<{ readonly watermark: number; readonly recordedAt: string; readonly items: number; readonly pages: number }>;
  close(): Promise<void>;
}

export interface PostgresApplicationProjectionSnapshotOptions<TModel extends object, TPayload extends object> {
  readonly databaseUrl?: string;
  readonly sql?: ApplicationPostgresSql;
  readonly model: Pick<ApplicationModelRuntimeContract, 'name' | 'tableName' | 'nativeRelational'>;
  readonly stream: { readonly name: string; readonly version: string };
  readonly payload: SchemaInput<TPayload>;
  readonly map: (model: TModel) => TPayload | readonly TPayload[] | Promise<TPayload | readonly TPayload[]>;
}

/**
 * Scans one promoted native model and the committed stream frontier from the
 * same repeatable-read MVCC snapshot. Command transactions serialize stream
 * sequence allocation with commit, so later commits are guaranteed to land
 * strictly after the captured watermark without blocking during the scan.
 */
export function createPostgresApplicationProjectionSnapshotSource<TModel extends object, TPayload extends object>(
  options: PostgresApplicationProjectionSnapshotOptions<TModel, TPayload>,
): ApplicationProjectionSnapshotSource<TPayload> {
  if (!options.sql && !options.databaseUrl) throw new Error(`Projection snapshot source ${options.model.name} requires sql or databaseUrl.`);
  const relation = options.model.nativeRelational;
  if (!relation || relation.columns.length === 0) throw new Error(`Projection snapshot source ${options.model.name} must be a promoted native relational model.`);
  const ownsClient = !options.sql;
  const client = options.sql ? Promise.resolve(options.sql) : createApplicationPostgresSql(options.databaseUrl as string, { max: 1, idle_timeout: 20, connect_timeout: 10, prepare: false });
  const payloadSchema = normalizeSchema(options.payload, `${options.stream.name}.${options.stream.version}.snapshot-payload`);
  const emittedPayload = payloadSchema.emitJsonSchema();
  const definitionDigest = createHash('sha256').update(JSON.stringify({
    protocol: 'applik8s.projection-snapshot.postgres/v1alpha1',
    model: {
      name: options.model.name,
      tableName: options.model.tableName,
      nativeRelational: relation,
    },
    stream: options.stream,
    payload: emittedPayload.ok ? emittedPayload.value.schema : payloadSchema.contract.source,
    map: options.map.toString(),
  })).digest('hex');
  const table = qualifiedIdentifier(relation.schema, options.model.tableName);
  const identity = quoteIdentifier(relation.identity.column);
  const columns = relation.columns.map(({ property, column }) => `${quoteIdentifier(column)} AS ${quoteIdentifier(property)}`).join(', ');

  return {
    definitionDigest,
    async scan(scan) {
      const batchSize = boundedInteger(scan.batchSize, 1, 1_000, 'batchSize');
      const maxItems = boundedInteger(scan.maxItems, 1, 100_000_000, 'maxItems');
      const maxDurationMs = boundedInteger(scan.maxDurationMs ?? 3_600_000, 1_000, 3_600_000, 'maxDurationMs');
      const startedAt = Date.now();
      return (await client).begin(async (transaction) => {
        await transaction.unsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const watermarkRows = await transaction.unsafe(
          "SELECT coalesce(max(sequence), 0) AS sequence, coalesce(max(recorded_at), to_timestamp(0)) AS recorded_at FROM applik8s_public_stream_events WHERE contract_name = $1 AND contract_version = $2",
          [options.stream.name, options.stream.version],
        );
        const watermark = nonNegativeInteger(watermarkRows[0]?.sequence, 'snapshot watermark');
        const recordedAt = timestamp(watermarkRows[0]?.recorded_at, 'snapshot recorded_at');
        let cursor: string | undefined;
        let modelRows = 0;
        let payloadItems = 0;
        let pages = 0;
        while (true) {
          if (Date.now() - startedAt > maxDurationMs) throw new Error(`Projection snapshot source ${options.model.name} exceeded its ${maxDurationMs}ms duration bound.`);
          const rows = cursor === undefined
            ? await transaction.unsafe(`SELECT ${columns} FROM ${table} ORDER BY ${identity} ASC LIMIT $1`, [batchSize + 1])
            : await transaction.unsafe(`SELECT ${columns} FROM ${table} WHERE ${identity} > $1 ORDER BY ${identity} ASC LIMIT $2`, [cursor, batchSize + 1]);
          const pageRows = rows.slice(0, batchSize);
          if (modelRows + pageRows.length > maxItems || (rows.length > batchSize && modelRows + batchSize >= maxItems)) {
            throw new Error(`Projection snapshot source ${options.model.name} exceeded its ${maxItems}-row bound.`);
          }
          if (pageRows.length === 0) break;
          const items: ApplicationProjectionSnapshotItem<TPayload>[] = [];
          for (const raw of pageRows) {
            const row = normalizePostgresValue(raw) as TModel;
            const mapped = await options.map(row);
            const values = Array.isArray(mapped) ? mapped : [mapped];
            for (const [index, value] of values.entries()) {
              const valid = payloadSchema.validate(value as never);
              if (!valid.ok) throw new Error(`Projection snapshot source ${options.model.name} produced an invalid stream payload: ${valid.error.message}`);
              items.push({ id: `${stableIdentity(Reflect.get(row, relation.identity.property))}:${index}`, payload: valid.value });
            }
          }
          if (payloadItems + items.length > maxItems) throw new Error(`Projection snapshot source ${options.model.name} mapper exceeded its ${maxItems}-item bound.`);
          await scan.visit({ ordinal: pages, watermark, recordedAt, items });
          modelRows += pageRows.length;
          payloadItems += items.length;
          pages += 1;
          cursor = identityCursor(Reflect.get(pageRows.at(-1) as object, relation.identity.property), options.model.name);
          if (rows.length <= batchSize) break;
        }
        return { watermark, recordedAt, items: payloadItems, pages };
      });
    },
    async close() {
      if (ownsClient) await (await client).end({ timeout: 5 });
    },
  };
}

function qualifiedIdentifier(schema: string | undefined, table: string): string {
  return schema ? `${quoteIdentifier(schema)}.${quoteIdentifier(table)}` : quoteIdentifier(table);
}

function quoteIdentifier(value: string): string {
  if (!value || value.includes('\0')) throw new Error('Projection snapshot PostgreSQL identifier is invalid.');
  return `"${value.replaceAll('"', '""')}"`;
}

function normalizePostgresValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(normalizePostgresValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalizePostgresValue(child)]));
  return value;
}

function stableIdentity(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') throw new Error('Projection snapshot model identity must be a scalar.');
  const normalized = String(value);
  if (!normalized || Buffer.byteLength(normalized) > 1_024) throw new Error('Projection snapshot model identity is empty or exceeds 1024 bytes.');
  return normalized;
}

function identityCursor(value: unknown, model: string): string {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') throw new Error(`Projection snapshot source ${model} returned an invalid identity cursor.`);
  return String(value);
}

function nonNegativeInteger(value: unknown, name: string): number {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Projection snapshot ${name} is invalid.`);
  return parsed;
}

function timestamp(value: unknown, name: string): string {
  const normalized = value instanceof Date ? value.toISOString() : typeof value === 'string' ? new Date(value).toISOString() : '';
  if (!normalized) throw new Error(`Projection snapshot ${name} is invalid.`);
  return normalized;
}

function boundedInteger(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`Projection snapshot ${name} must be between ${minimum} and ${maximum}.`);
  return value;
}
