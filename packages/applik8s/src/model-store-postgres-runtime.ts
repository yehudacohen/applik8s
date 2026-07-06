import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import type { ApplicationModelCreateInput, ApplicationModelIndexOptions, ApplicationModelObject, ApplicationModelPatch, ApplicationModelQueryOptions, ApplicationModelQueryPage, ApplicationModelRef, ApplicationRuntimeModelContract } from './application-models.js';

interface ModelStoreConnection {
  readonly client: postgres.Sql;
  readonly db: ReturnType<typeof drizzle>;
}

interface PostgresErrorLike {
  readonly code?: string;
  readonly constraint?: string;
  readonly detail?: string;
  readonly cause?: unknown;
}

interface ModelStoreDiagnosticError extends Error {
  statusCode?: number;
  diagnostic?: Readonly<Record<string, unknown>>;
  cause?: unknown;
}

const modelStoreConnections = new Map<string, ModelStoreConnection>();
const modelStoreTables = new Map<string, ReturnType<typeof modelTable>>();

export async function closePostgresModelClients(): Promise<void> {
  const connections = [...modelStoreConnections.values()];
  modelStoreConnections.clear();
  modelStoreTables.clear();
  await Promise.all(connections.map((connection) => connection.client.end({ timeout: 1 })));
}

export function createPostgresModelClient<TSpec extends object, TStatus extends object = Record<string, never>>(model: ApplicationRuntimeModelContract) {
  return {
    async create(input: ApplicationModelCreateInput<TSpec>): Promise<ApplicationModelObject<TSpec, TStatus>> {
      const table = modelTableFor(model);
      const object = modelObjectFromInput<TSpec, TStatus>(input);
      try {
        await modelDatabase(model).insert(table).values(modelRowFromObject(object));
      } catch (error) {
        throw modelStoreError(model, error);
      }
      return object;
    },
    async get(ref: ApplicationModelRef): Promise<ApplicationModelObject<TSpec, TStatus> | undefined> {
      const table = modelTableFor(model);
      try {
        const rows = await modelDatabase(model).select().from(table).where(eq(table.id, ref.id)).limit(1);
        return rows[0] ? modelObjectFromRow<TSpec, TStatus>(rows[0]) : undefined;
      } catch (error) {
        throw modelStoreError(model, error);
      }
    },
    async query(query: ApplicationModelQueryOptions<TSpec> = {}): Promise<ApplicationModelQueryPage<TSpec, TStatus>> {
      const table = modelTableFor(model);
      const clauses = modelWhereClauses(table, query.where ?? {});
      const offset = query.cursor ? Number(query.cursor) : 0;
      const normalizedOffset = Number.isFinite(offset) && offset > 0 ? offset : 0;
      const limit = Math.max(1, Math.min(Number(query.limit ?? 50), 500));
      const builder = modelDatabase(model).select().from(table);
      try {
        const rows = await (clauses.length > 0 ? builder.where(and(...clauses)) : builder).limit(limit).offset(normalizedOffset);
        const items = rows.map((row) => modelObjectFromRow<TSpec, TStatus>(row));
        const nextCursor = items.length === limit ? String(normalizedOffset + items.length) : undefined;
        return { items, ...(nextCursor ? { nextCursor } : {}) };
      } catch (error) {
        throw modelStoreError(model, error);
      }
    },
    async patch(ref: ApplicationModelRef, patch: ApplicationModelPatch<TSpec, TStatus>): Promise<ApplicationModelObject<TSpec, TStatus>> {
      const existing = await this.get(ref);
      if (!existing) {
        throw new Error(`Model ${model.name} object ${ref.id} was not found.`);
      }
      const next: ApplicationModelObject<TSpec, TStatus> = {
        id: existing.id,
        spec: { ...existing.spec, ...(patch.spec ?? {}) },
        ...modelStatusPatch(existing.status, patch.status),
        revision: nextModelRevision(),
      };
      const table = modelTableFor(model);
      try {
        await modelDatabase(model).update(table).set({ spec: next.spec, status: next.status ?? null, revision: next.revision ?? nextModelRevision(), updatedAt: new Date() }).where(eq(table.id, ref.id));
      } catch (error) {
        throw modelStoreError(model, error);
      }
      return next;
    },
    async delete(ref: ApplicationModelRef): Promise<void> {
      const table = modelTableFor(model);
      try {
        await modelDatabase(model).delete(table).where(eq(table.id, ref.id));
      } catch (error) {
        throw modelStoreError(model, error);
      }
    },
    index(indexName: string, indexOptions: ApplicationModelIndexOptions<TSpec, TStatus> = {}) {
      return {
        name: indexName,
        async query(partition: string, query: Omit<ApplicationModelQueryOptions<TSpec>, 'where'> = {}): Promise<ApplicationModelQueryPage<TSpec, TStatus>> {
          const declared = model.indexes.find((index) => index.name === indexName);
          const partitionBy = String(indexOptions.partitionBy ?? declared?.fields[0] ?? '');
          if (!partitionBy) {
            throw new Error(`Model index ${model.name}.${indexName} requires partitionBy before it can be queried.`);
          }
          // typecast: partitionBy is provided by typed index options or generated model index metadata for this model spec.
          const where = { [partitionBy]: partition } as Partial<TSpec>;
          return createPostgresModelClient<TSpec, TStatus>(model).query({ ...query, where });
        },
      };
    },
  };
}

function modelDatabase(model: ApplicationRuntimeModelContract): ReturnType<typeof drizzle> {
  const key = model.connectionEnvName;
  const existing = modelStoreConnections.get(key);
  if (existing) {
    return existing.db;
  }
  const url = process.env[key] || process.env.DATABASE_URL;
  if (!url) {
    throw modelStoreDiagnosticError({
      message: `applik8s-modelstore-missing-credentials: ModelStore ${model.name} requires database URL env ${key} or DATABASE_URL.`,
      statusCode: 500,
      diagnostic: { event: 'applik8s-modelstore-missing-credentials', model: model.name, env: key },
    });
  }
  const client = postgres(url, { max: 5 });
  const db = drizzle(client);
  modelStoreConnections.set(key, { client, db });
  return db;
}

function modelTableFor(model: ApplicationRuntimeModelContract): ReturnType<typeof modelTable> {
  const key = `${model.connectionEnvName}:${model.tableName}`;
  const existing = modelStoreTables.get(key);
  if (existing) {
    return existing;
  }
  const table = modelTable(model.tableName);
  modelStoreTables.set(key, table);
  return table;
}

function modelTable(tableName: string) {
  return pgTable(tableName, {
    id: text('id').primaryKey(),
    spec: jsonb('spec').notNull(),
    status: jsonb('status'),
    revision: text('revision').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  });
}

function modelWhereClauses(_table: ReturnType<typeof modelTable>, where: object) {
  return Object.entries(where).map(([field, value]) => sql.raw(`(${quoteIdentifier('spec')}->>${quoteLiteral(field)}) = ${quoteLiteral(String(value))}`));
}

function modelStoreError(model: ApplicationRuntimeModelContract, error: unknown): unknown {
  const postgresError = modelPostgresError(error);
  if (postgresError?.code === '23505') {
    const constraint = postgresError.constraint || modelConstraintNameFromDetail(postgresError.detail) || modelDefaultUniqueConstraint(model);
    return modelStoreDiagnosticError({
      message: `applik8s-model-duplicate-key: Model ${model.name} violates unique constraint ${constraint}.`,
      statusCode: 409,
      diagnostic: { event: 'applik8s-model-duplicate-key', model: model.name, constraint, postgresCode: '23505' },
      cause: error,
    });
  }
  if (postgresError?.code === '42P01') {
    return modelStoreDiagnosticError({
      message: `applik8s-model-migration-missing: ModelStore table ${model.tableName} is missing. Run generated migrations before serving model traffic.`,
      statusCode: 500,
      diagnostic: { event: 'applik8s-model-migration-missing', model: model.name, table: model.tableName, postgresCode: '42P01' },
      cause: error,
    });
  }
  return error;
}

function modelPostgresError(error: unknown): PostgresErrorLike | undefined {
  let current = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (!current || typeof current !== 'object') {
      return undefined;
    }
    if (typeof Reflect.get(current, 'code') === 'string') {
      // typecast: structural postgres error fields were checked above and are read-only diagnostic metadata.
      return current as PostgresErrorLike;
    }
    current = Reflect.get(current, 'cause');
  }
  return undefined;
}

function modelDefaultUniqueConstraint(model: ApplicationRuntimeModelContract): string {
  const constraints = model.constraints.filter((constraint) => constraint.kind === 'unique');
  if (constraints.length === 1) {
    return constraints[0]?.name ?? 'unique';
  }
  const indexes = model.indexes.filter((index) => index.unique);
  if (indexes.length === 1) {
    return indexes[0]?.name ?? 'unique';
  }
  return 'unique';
}

function modelConstraintNameFromDetail(detail: string | undefined): string | undefined {
  const match = detail?.match(/constraint "([^"]+)"/);
  return match?.[1];
}

function modelStoreDiagnosticError(options: { readonly message: string; readonly statusCode: number; readonly diagnostic: Readonly<Record<string, unknown>>; readonly cause?: unknown }): ModelStoreDiagnosticError {
  const error: ModelStoreDiagnosticError = new Error(options.message);
  error.statusCode = options.statusCode;
  error.diagnostic = options.diagnostic;
  if (options.cause) {
    error.cause = options.cause;
  }
  return error;
}

function modelObjectFromInput<TSpec extends object, TStatus extends object>(input: ApplicationModelCreateInput<TSpec>): ApplicationModelObject<TSpec, TStatus> {
  return { id: input.id || nextModelId(), spec: input.spec, revision: nextModelRevision() };
}

function modelRowFromObject<TSpec extends object, TStatus extends object>(object: ApplicationModelObject<TSpec, TStatus>) {
  return { id: object.id, spec: object.spec, status: object.status ?? null, revision: object.revision ?? nextModelRevision() };
}

function modelObjectFromRow<TSpec extends object, TStatus extends object>(row: { readonly id: string; readonly spec: unknown; readonly status: unknown; readonly revision: string }): ApplicationModelObject<TSpec, TStatus> {
  return {
    id: row.id,
    // typecast: rows come from the generated model table whose spec/status columns store this model's JSON payloads.
    spec: (row.spec ?? {}) as TSpec,
    ...modelStatusFromRow<TStatus>(row.status),
    revision: row.revision,
  };
}

function modelStatusPatch<TStatus extends object>(existing: TStatus | undefined, patch: Partial<TStatus> | undefined): { readonly status?: TStatus } {
  if (!existing && !patch) {
    return {};
  }
  // typecast: model status patches preserve the model's status JSON shape while allowing partial updates.
  return { status: { ...(existing ?? {}), ...(patch ?? {}) } as TStatus };
}

function modelStatusFromRow<TStatus extends object>(status: unknown): { readonly status?: TStatus } {
  if (!status) {
    return {};
  }
  // typecast: rows come from the generated model table whose status column stores this model's status JSON payload.
  return { status: status as TStatus };
}

function nextModelId(): string {
  return globalThis.crypto?.randomUUID?.() || `model-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function nextModelRevision(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function quoteIdentifier(value: string): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${String(value).replaceAll("'", "''")}'`;
}
