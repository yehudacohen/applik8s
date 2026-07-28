import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { ApplicationModelCreateInput, ApplicationModelIndexOptions, ApplicationModelObject, ApplicationModelPatch, ApplicationModelQueryOptions, ApplicationModelQueryPage, ApplicationModelRef, ApplicationModelTransactionClient, ApplicationRuntimeModelContract } from './application-models.js';
import { createApplicationPostgresDrizzle } from './postgres-runtime-loader.js';
import type { ApplicationPostgresSql } from './postgres-runtime-contract.js';

interface ModelStoreConnection {
  readonly client: ApplicationPostgresSql;
  readonly db: PostgresJsDatabase;
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

type PostgresModelClient<TSpec extends object, TStatus extends object> = ApplicationModelTransactionClient<TSpec, TStatus> & {
  transaction<TResult>(handler: (model: ApplicationModelTransactionClient<TSpec, TStatus>) => TResult | Promise<TResult>): Promise<TResult>;
};

const modelStoreConnections = new Map<string, Promise<ModelStoreConnection>>();
const modelStoreTables = new Map<string, ReturnType<typeof modelTable>>();

export async function closePostgresModelClients(): Promise<void> {
  const connections = [...modelStoreConnections.values()];
  modelStoreConnections.clear();
  modelStoreTables.clear();
  await Promise.all(connections.map(async (connection) => (await connection).client.end({ timeout: 1 })));
}

export function createPostgresModelClient<TSpec extends object, TStatus extends object = Record<string, never>>(model: ApplicationRuntimeModelContract, databaseOverride?: PostgresJsDatabase): PostgresModelClient<TSpec, TStatus> {
  const client: PostgresModelClient<TSpec, TStatus> = {
    async create(input: ApplicationModelCreateInput<TSpec> | TSpec): Promise<ApplicationModelObject<TSpec, TStatus>> {
      const table = modelTableFor(model);
      const object = modelObjectFromInput<TSpec, TStatus>(input);
      try {
        await (await modelDatabaseForClient(model, databaseOverride)).insert(table).values(modelRowFromObject(object));
      } catch (error) {
        throw modelStoreError(model, error);
      }
      return object;
    },
    async get(ref: ApplicationModelRef): Promise<ApplicationModelObject<TSpec, TStatus> | undefined> {
      const table = modelTableFor(model);
      try {
        const clauses = [eq(table.id, ref.id), ...modelRetentionClauses(model)];
        const rows = await (await modelDatabaseForClient(model, databaseOverride)).select().from(table).where(and(...clauses)).limit(1);
        return rows[0] ? modelObjectFromRow<TSpec, TStatus>(rows[0]) : undefined;
      } catch (error) {
        throw modelStoreError(model, error);
      }
    },
    async query(query: ApplicationModelQueryOptions<TSpec> = {}): Promise<ApplicationModelQueryPage<TSpec, TStatus>> {
      return queryPostgresModel<TSpec, TStatus>(model, query, {}, databaseOverride);
    },
    async patch(ref: ApplicationModelRef, patch: ApplicationModelPatch<TSpec, TStatus>): Promise<ApplicationModelObject<TSpec, TStatus>> {
      const existing = await client.get(ref);
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
        await (await modelDatabaseForClient(model, databaseOverride)).update(table).set({ spec: next.spec, status: next.status ?? null, revision: next.revision ?? nextModelRevision(), updatedAt: new Date() }).where(eq(table.id, ref.id));
      } catch (error) {
        throw modelStoreError(model, error);
      }
      return next;
    },
    async delete(ref: ApplicationModelRef): Promise<void> {
      const table = modelTableFor(model);
      try {
        await (await modelDatabaseForClient(model, databaseOverride)).delete(table).where(eq(table.id, ref.id));
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
          if (hasUnsupportedIndexFilter(indexOptions.filter) || hasUnsupportedIndexFilter(Reflect.get(query, 'where'))) {
            throw new Error(`Model index ${model.name}.${indexName} filter is not supported by the Postgres ModelStore runtime yet; unsupported index filters fail closed until filtered index semantics are implemented.`);
          }
          const declaredOrderBy = indexOptions.orderBy ?? declared?.fields.slice(1) ?? [];
          // typecast: partitionBy is provided by typed index options or generated model index metadata for this model spec.
          const where = { [partitionBy]: partition } as Partial<TSpec>;
          return queryPostgresModel<TSpec, TStatus>(model, { ...query, where }, { allowedOrderBy: declaredOrderBy, defaultOrderBy: declaredOrderBy }, databaseOverride);
        },
      };
    },
    async transaction<TResult>(handler: (model: ApplicationModelTransactionClient<TSpec, TStatus>) => TResult | Promise<TResult>): Promise<TResult> {
      return (await modelDatabase(model)).transaction(async (transaction) => {
        // typecast: Drizzle transaction clients expose the same query-builder surface used by the generated ModelStore client.
        const transactionalClient = createPostgresModelClient<TSpec, TStatus>(model, transaction as unknown as PostgresJsDatabase);
        return handler(transactionalClient);
      });
    },
  };
  return client;
}

async function queryPostgresModel<TSpec extends object, TStatus extends object>(model: ApplicationRuntimeModelContract, query: ApplicationModelQueryOptions<TSpec> = {}, options: { readonly allowedOrderBy?: readonly string[]; readonly defaultOrderBy?: readonly string[] } = {}, databaseOverride?: PostgresJsDatabase): Promise<ApplicationModelQueryPage<TSpec, TStatus>> {
  const requestedOrderBy = query.orderBy ?? options.defaultOrderBy ?? [];
  if ((query.orderBy?.length ?? 0) > 0 && !options.allowedOrderBy) {
    throw new Error(`Model ${model.name} query orderBy is not supported by the Postgres ModelStore runtime yet; unsupported ordering fails closed until index/order semantics are implemented.`);
  }
  validateModelOrderBy(model, requestedOrderBy, options.allowedOrderBy ?? []);
  validateModelWhere(model, query.where ?? {});
  const table = modelTableFor(model);
  const clauses = [...modelWhereClauses(table, query.where ?? {}), ...modelRetentionClauses(model)];
  const orderClauses = modelOrderClauses(model, requestedOrderBy);
  const offset = query.cursor ? Number(query.cursor) : 0;
  const normalizedOffset = Number.isFinite(offset) && offset > 0 ? offset : 0;
  const limit = Math.max(1, Math.min(Number(query.limit ?? 50), 500));
  let builder = (await modelDatabaseForClient(model, databaseOverride)).select().from(table).$dynamic();
  if (clauses.length > 0) {
    builder = builder.where(and(...clauses));
  }
  if (orderClauses.length > 0) {
    builder = builder.orderBy(...orderClauses);
  }
  return builder.limit(limit).offset(normalizedOffset)
    .then((rows) => {
      const items = rows.map((row) => modelObjectFromRow<TSpec, TStatus>(row));
      const nextCursor = items.length === limit ? String(normalizedOffset + items.length) : undefined;
      return { items, ...(nextCursor ? { nextCursor } : {}) };
    })
    .catch((error: unknown) => {
      throw modelStoreError(model, error);
    });
}

function modelDatabaseForClient(model: ApplicationRuntimeModelContract, databaseOverride: PostgresJsDatabase | undefined): Promise<PostgresJsDatabase> {
  return databaseOverride ? Promise.resolve(databaseOverride) : modelDatabase(model);
}

function modelDatabase(model: ApplicationRuntimeModelContract): Promise<PostgresJsDatabase> {
  const key = model.connectionEnvName;
  const existing = modelStoreConnections.get(key);
  if (existing) {
    return existing.then((connection) => connection.db);
  }
  const url = process.env[key] || process.env.DATABASE_URL;
  if (!url) {
    throw modelStoreDiagnosticError({
      message: `applik8s-modelstore-missing-credentials: ModelStore ${model.name} requires database URL env ${key} or DATABASE_URL.`,
      statusCode: 500,
      diagnostic: { event: 'applik8s-modelstore-missing-credentials', model: model.name, env: key },
    });
  }
  const connection = createApplicationPostgresDrizzle(url, { max: 5 }).then(({ client, database }) => ({ client, db: database }));
  modelStoreConnections.set(key, connection);
  return connection.then((value) => value.db);
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

function modelRetentionClauses(model: ApplicationRuntimeModelContract) {
  if (model.retention.mode !== 'ttl') {
    return [];
  }
  const ttlSeconds = Math.max(1, Number(model.retention.ttlSeconds ?? 1));
  return [sql.raw(`${quoteIdentifier('created_at')} >= now() - (${ttlSeconds} * interval '1 second')`)];
}

function validateModelWhere(model: ApplicationRuntimeModelContract, where: object): void {
  for (const [field, value] of Object.entries(where)) {
    if (!/^[A-Za-z0-9_]+$/.test(field) || value === null || typeof value === 'object') {
      throw new Error(`Model ${model.name} query filter ${field} is not supported by the Postgres ModelStore runtime yet; unsupported filters fail closed until query semantics are implemented.`);
    }
  }
}

function hasUnsupportedIndexFilter(filter: unknown): boolean {
  return !!filter && typeof filter === 'object' && Object.keys(filter).length > 0;
}

function validateModelOrderBy(model: ApplicationRuntimeModelContract, orderBy: readonly string[], allowedOrderBy: readonly string[]): void {
  for (const field of orderBy) {
    if (!/^[A-Za-z0-9_]+$/.test(field) || !allowedOrderBy.includes(field)) {
      throw new Error(`Model ${model.name} index query orderBy ${field} is not part of the declared index orderBy fields; unsupported ordering fails closed.`);
    }
  }
}

function modelOrderClauses(_model: ApplicationRuntimeModelContract, orderBy: readonly string[]) {
  return orderBy.map((field) => sql.raw(`${modelOrderFieldSql(field)} ASC`));
}

function modelOrderFieldSql(field: string): string {
  if (field === 'createdAt') {
    return quoteIdentifier('created_at');
  }
  if (field === 'updatedAt') {
    return quoteIdentifier('updated_at');
  }
  return `(${quoteIdentifier('spec')}->>${quoteLiteral(field)})`;
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

function modelObjectFromInput<TSpec extends object, TStatus extends object>(input: ApplicationModelCreateInput<TSpec> | TSpec): ApplicationModelObject<TSpec, TStatus> {
  if (isExplicitModelCreateInput<TSpec>(input)) {
    return { id: input.id || nextModelId(), spec: input.spec, revision: nextModelRevision() };
  }
  return { id: nextModelId(), spec: input, revision: nextModelRevision() };
}

function isExplicitModelCreateInput<TSpec extends object>(input: ApplicationModelCreateInput<TSpec> | TSpec): input is ApplicationModelCreateInput<TSpec> {
  return Boolean(input && typeof input === 'object' && 'spec' in input);
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
