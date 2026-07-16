import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac, randomUUID } from 'node:crypto';
import type { ApplicationModelSnapshot, PromotedDrizzleTable } from './native-models.js';
import type { ApplicationDatabaseBinding } from './application.js';
import { and, eq, getTableColumns, sql, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import type { AnyPgTable } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { applicationModelChangeCommitScope } from './relational-runtime-contract.js';
import { validateTrustedContextValue } from './trusted-context.js';

export type ApplicationDatabaseClient<TSchema extends Readonly<Record<string, unknown>>> = PostgresJsDatabase<TSchema>;

export interface ApplicationAdmittedContext {
  readonly values: Readonly<Record<string, unknown>>;
  /** Server-held secret used to prevent raw access-context values from entering generic change records. */
  readonly digestSecret: string;
}

export interface ApplicationModelChange {
  readonly model: string;
  readonly operation: 'insert' | 'update' | 'delete' | 'invalidate' | 'reset';
  readonly identity?: unknown;
  readonly revision?: string;
  readonly contextDigest: string;
  readonly changedFields?: readonly string[];
  readonly recordedAt: string;
}

export interface ApplicationChangeOptions {
  readonly identity?: unknown;
  readonly revision?: string;
  readonly changedFields?: readonly string[];
}

export interface ApplicationChangeCollector {
  invalidate<TTable extends AnyPgTable>(model: PromotedDrizzleTable<TTable>, options?: ApplicationChangeOptions): void;
  reset<TTable extends AnyPgTable>(model: PromotedDrizzleTable<TTable>): void;
}

export interface ApplicationObservableTransaction<TSchema extends Readonly<Record<string, unknown>>> {
  readonly db: ApplicationDatabaseClient<TSchema>;
  readonly changes: ApplicationChangeCollector;
}

export interface ApplicationUpdateOptions {
  readonly ifRevision?: string;
}

export interface ApplicationModelUpdateResult<TValue, TIdentity> {
  readonly identity: TIdentity;
  readonly value: TValue;
  readonly revision?: string;
  readonly changed: boolean;
}

export class ApplicationModelRevisionConflict extends Error {
  readonly code = 'APPLIK8S_MODEL_REVISION_CONFLICT';
  constructor(readonly model: string, readonly identity: unknown, readonly expectedRevision: string) {
    super(`Model ${model} identity ${JSON.stringify(identity)} no longer has expected revision ${expectedRevision}.`);
    this.name = 'ApplicationModelRevisionConflict';
  }
}

interface RegisteredDatabase<TSchema extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>> {
  readonly binding: ApplicationDatabaseBinding<TSchema>;
  readonly db: ApplicationDatabaseClient<TSchema>;
}

interface ActiveDatabaseScope {
  readonly database: string;
  readonly db: ApplicationDatabaseClient<Readonly<Record<string, unknown>>>;
  readonly changes?: MutableChangeCollector;
}

export interface ApplicationRelationalContext {
  database<TSchema extends Readonly<Record<string, unknown>>>(binding: ApplicationDatabaseBinding<TSchema>): ApplicationDatabaseClient<TSchema>;
  run<TSchema extends Readonly<Record<string, unknown>>, TResult>(binding: ApplicationDatabaseBinding<TSchema>, handler: () => TResult | Promise<TResult>): Promise<TResult>;
  snapshot<TSchema extends Readonly<Record<string, unknown>>, TResult>(binding: ApplicationDatabaseBinding<TSchema>, handler: () => TResult | Promise<TResult>): Promise<{ readonly value: TResult; readonly sequence: number }>;
  changes<TSchema extends Readonly<Record<string, unknown>>>(binding: ApplicationDatabaseBinding<TSchema>, afterSequence: number, limit?: number): Promise<{ readonly items: readonly (ApplicationModelChange & { readonly sequence: number })[]; readonly retentionFloor: number }>;
  transaction<TSchema extends Readonly<Record<string, unknown>>, TResult>(binding: ApplicationDatabaseBinding<TSchema>, handler: (scope: ApplicationObservableTransaction<TSchema>) => TResult | Promise<TResult>): Promise<TResult>;
  get<TTable extends AnyPgTable>(model: PromotedDrizzleTable<TTable>, identity: unknown): Promise<ApplicationModelSnapshot<InferSelectModel<TTable>, unknown> | undefined>;
  update<TTable extends AnyPgTable>(model: PromotedDrizzleTable<TTable>, snapshot: ApplicationModelSnapshot<InferSelectModel<TTable>, unknown>, patch: Partial<InferInsertModel<TTable>>, options?: ApplicationUpdateOptions): Promise<ApplicationModelUpdateResult<InferSelectModel<TTable>, unknown>>;
}

// typecast-boundary: registered Drizzle databases preserve schema identity while transactions are held behind a provider-neutral map.
export function createApplicationRelationalContext(options: {
  readonly databases: readonly RegisteredDatabase[];
  readonly admittedContext: ApplicationAdmittedContext;
  readonly now?: () => Date;
  readonly revision?: () => string;
}): ApplicationRelationalContext {
  const databases = new Map(options.databases.map((entry) => [entry.binding.name, entry]));
  const active = new AsyncLocalStorage<ActiveDatabaseScope>();
  const now = options.now ?? (() => new Date());
  const nextRevision = options.revision ?? randomUUID;

  const context: ApplicationRelationalContext = {
    database(binding) {
      const registered = registeredDatabase(databases, binding);
      const scope = active.getStore();
      if (scope?.database === binding.name) {
        return scope.db as ApplicationDatabaseClient<typeof binding.schema>;
      }
      if (registered.binding.access) {
        throw new Error(`context.database(${binding.name}) requires an active request or transaction scope so PostgreSQL trusted context can be installed with SET LOCAL. Use context.run(...) or context.transaction(...).`);
      }
      return registered.db as ApplicationDatabaseClient<typeof binding.schema>;
    },
    async run(binding, handler) {
      const registered = registeredDatabase(databases, binding);
      return registered.db.transaction(async (tx) => {
        await installTrustedContext(tx, registered.binding, options.admittedContext);
        return active.run({ database: binding.name, db: tx as ApplicationDatabaseClient<Readonly<Record<string, unknown>>> }, handler);
      });
    },
    async snapshot(binding, handler) {
      const registered = registeredDatabase(databases, binding);
      return registered.db.transaction(async (tx) => {
        await tx.execute(sql.raw('set transaction isolation level repeatable read read only'));
        await installTrustedContext(tx, registered.binding, options.admittedContext);
        await acquireApplicationModelChangeCommitLock(tx, contextDigest(options.admittedContext));
        const value = await active.run({ database: binding.name, db: tx as ApplicationDatabaseClient<Readonly<Record<string, unknown>>> }, handler);
        const digest = contextDigest(options.admittedContext);
        const rows = await tx.execute(sql`select coalesce(max(sequence), 0) as sequence from applik8s_model_changes where context_digest = ${digest}`);
        return { value, sequence: numericResult(rows, 'sequence') };
      });
    },
    async changes(binding, afterSequence, limit = 100) {
      if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) throw new Error('Application model change cursor sequence must be a non-negative safe integer.');
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) throw new Error('Application model change page limit must be between 1 and 1000.');
      return context.run(binding, async () => {
        const db = context.database(binding);
        const digest = contextDigest(options.admittedContext);
        const rows = await db.execute(sql`
          select sequence, model, operation, identity, revision, context_digest, changed_fields, recorded_at
          from applik8s_model_changes
          where context_digest = ${digest} and sequence > ${afterSequence}
          order by sequence asc
          limit ${limit}
        `);
        const floorRows = await db.execute(sql`select coalesce(min(sequence), 0) as floor from applik8s_model_changes where context_digest = ${digest}`);
        return { items: applicationChangeRows(rows), retentionFloor: numericResult(floorRows, 'floor') };
      });
    },
    async transaction(binding, handler) {
      const registered = registeredDatabase(databases, binding);
      return registered.db.transaction(async (tx) => {
        await installTrustedContext(tx, registered.binding, options.admittedContext);
        await acquireApplicationModelChangeCommitLock(tx, contextDigest(options.admittedContext));
        const collector = new MutableChangeCollector(registered.binding, options.admittedContext, now);
        // typecast: the transaction is created by the same schema-bound Drizzle database and preserves that schema at runtime.
        const typedTransaction = tx as unknown as ApplicationDatabaseClient<typeof binding.schema>;
        const result = await active.run({ database: binding.name, db: typedTransaction as ApplicationDatabaseClient<Readonly<Record<string, unknown>>>, changes: collector }, () => handler({ db: typedTransaction, changes: collector }));
        await persistApplicationChanges(tx, collector.pending());
        return result;
      });
    },
    async get<TTable extends AnyPgTable>(model: PromotedDrizzleTable<TTable>, identity: unknown): Promise<ApplicationModelSnapshot<InferSelectModel<TTable>, unknown> | undefined> {
      const binding = databaseForModel(databases, model);
      return context.run(binding, async () => {
        const db = context.database(binding);
        const identityField = model.$model.identity.fields[0];
        const identityColumn = identityField ? getTableColumns(model)[identityField] : undefined;
        if (!identityColumn) throw new Error(`Model ${model.$model.name} has no usable scalar identity column.`);
        const nativeTable: AnyPgTable = model;
        const rows = await db.select().from(nativeTable).where(eq(identityColumn, identity)).limit(1);
        // typecast: Drizzle selected the complete promoted native table; its row shape is the table's inferred select model.
        const value = rows[0] as InferSelectModel<TTable> | undefined;
        if (!value) return undefined;
        const revision = model.$model.revision ? String(Reflect.get(value, model.$model.revision.field)) : undefined;
        return { identity, value, ...(revision ? { revision } : {}) };
      });
    },
    async update<TTable extends AnyPgTable>(model: PromotedDrizzleTable<TTable>, snapshot: ApplicationModelSnapshot<InferSelectModel<TTable>, unknown>, patch: Partial<InferInsertModel<TTable>>, updateOptions: ApplicationUpdateOptions = {}): Promise<ApplicationModelUpdateResult<InferSelectModel<TTable>, unknown>> {
      const binding = databaseForModel(databases, model);
      const execute = async (): Promise<ApplicationModelUpdateResult<InferSelectModel<TTable>, unknown>> => {
        const db = context.database(binding);
        const scope = active.getStore();
        if (!scope?.changes) throw new Error(`Model ${model.$model.name} update requires an observable transaction scope.`);
        if (Object.keys(patch).length === 0) return { identity: snapshot.identity, value: snapshot.value, ...(snapshot.revision ? { revision: snapshot.revision } : {}), changed: false };
        const identityField = model.$model.identity.fields[0];
        const identityColumn = identityField ? getTableColumns(model)[identityField] : undefined;
        if (!identityColumn) throw new Error(`Model ${model.$model.name} has no usable scalar identity column.`);
        const revisionField = model.$model.revision?.field;
        const revisionColumn = revisionField ? getTableColumns(model)[revisionField] : undefined;
        if (updateOptions.ifRevision && !revisionColumn) throw new Error(`Model ${model.$model.name} does not declare a revision column.`);
        const revision = revisionColumn ? nextRevision() : undefined;
        const where = updateOptions.ifRevision && revisionColumn
          ? and(eq(identityColumn, snapshot.identity), eq(revisionColumn, updateOptions.ifRevision))
          : eq(identityColumn, snapshot.identity);
        const values = { ...patch, ...(revisionField && revision ? { [revisionField]: revision } : {}) };
        const nativeTable: TTable = model;
        const rows = await db.update(nativeTable).set(values).where(where).returning();
        // typecast: returning() selected the complete native table after the update.
        const value = rows[0] as InferSelectModel<TTable> | undefined;
        if (!value) {
          if (updateOptions.ifRevision) throw new ApplicationModelRevisionConflict(model.$model.name, snapshot.identity, updateOptions.ifRevision);
          throw new Error(`Model ${model.$model.name} identity ${JSON.stringify(snapshot.identity)} was not found.`);
        }
        scope.changes.record(model.$model.name, 'update', {
          identity: snapshot.identity,
          ...(revision ? { revision } : {}),
          changedFields: Object.keys(patch).sort(),
        });
        return { identity: snapshot.identity, value, ...(revision ? { revision } : {}), changed: true };
      };
      if (active.getStore()?.database === binding.name && active.getStore()?.changes) return execute();
      return context.transaction(binding, execute);
    },
  };
  return context;
}

class MutableChangeCollector implements ApplicationChangeCollector {
  readonly #changes: ApplicationModelChange[] = [];
  readonly #contextDigest: string;
  constructor(readonly database: ApplicationDatabaseBinding, admitted: ApplicationAdmittedContext, readonly now: () => Date) {
    this.#contextDigest = contextDigest(admitted);
  }
  invalidate<TTable extends AnyPgTable>(model: PromotedDrizzleTable<TTable>, options: ApplicationChangeOptions = {}): void {
    assertModelDatabase(model, this.database);
    this.record(model.$model.name, 'invalidate', options);
  }
  reset<TTable extends AnyPgTable>(model: PromotedDrizzleTable<TTable>): void {
    assertModelDatabase(model, this.database);
    this.record(model.$model.name, 'reset', {});
  }
  record(model: string, operation: ApplicationModelChange['operation'], options: ApplicationChangeOptions): void {
    this.#changes.push(Object.freeze({
      model,
      operation,
      ...(options.identity !== undefined ? { identity: options.identity } : {}),
      ...(options.revision ? { revision: options.revision } : {}),
      contextDigest: this.#contextDigest,
      ...(options.changedFields ? { changedFields: [...new Set(options.changedFields)].sort() } : {}),
      recordedAt: this.now().toISOString(),
    }));
  }
  pending(): readonly ApplicationModelChange[] {
    return this.#changes;
  }
}

async function installTrustedContext<TSchema extends Readonly<Record<string, unknown>>>(db: ApplicationDatabaseClient<TSchema>, binding: ApplicationDatabaseBinding<TSchema>, admitted: ApplicationAdmittedContext): Promise<void> {
  if (!binding.access) return;
  const raw = admitted.values[binding.access.context.name];
  if (raw === undefined) throw new Error(`Required trusted context ${binding.access.context.name} is missing for database ${binding.name}.`);
  const value = validateTrustedContextValue(binding.access.context, raw);
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  await db.execute(sql`select set_config(${binding.access.setting}, ${serialized}, true)`);
}

async function persistApplicationChanges<TSchema extends Readonly<Record<string, unknown>>>(db: ApplicationDatabaseClient<TSchema>, changes: readonly ApplicationModelChange[]): Promise<void> {
  for (const change of changes) {
    await db.execute(sql`
      insert into applik8s_model_changes
        (model, operation, identity, revision, context_digest, changed_fields, recorded_at)
      values
        (${change.model}, ${change.operation}, ${change.identity === undefined ? null : JSON.stringify(change.identity)}::jsonb,
         ${change.revision ?? null}, ${change.contextDigest}, ${change.changedFields ? JSON.stringify(change.changedFields) : null}::jsonb,
         ${change.recordedAt}::timestamptz)
    `);
  }
}

export function applicationRelationalFrameworkMigrationSql(database: ApplicationDatabaseBinding, models: readonly RelationalModelRuntimeTable[]): string {
  const statements = [
    `CREATE TABLE IF NOT EXISTS applik8s_model_changes (\n  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,\n  model text NOT NULL,\n  operation text NOT NULL CHECK (operation IN ('insert', 'update', 'delete', 'invalidate', 'reset')),\n  identity jsonb,\n  revision text,\n  context_digest text NOT NULL,\n  changed_fields jsonb,\n  recorded_at timestamptz NOT NULL\n);`,
    'CREATE INDEX IF NOT EXISTS applik8s_model_changes_context_sequence ON applik8s_model_changes (context_digest, sequence);',
    'CREATE INDEX IF NOT EXISTS applik8s_model_changes_model_sequence ON applik8s_model_changes (model, sequence);',
  ];
  if (database.access) {
    for (const model of models) {
      assertModelDatabase(model, database);
      const column = getTableColumns(model)[database.access.column];
      if (!column) continue;
      const tableName = quoteSqlIdentifier(model.$model.table.name);
      const columnName = quoteSqlIdentifier(column.name);
      const policyName = quoteSqlIdentifier(`applik8s_${model.$model.table.name}_${database.access.context.name}`);
      const setting = quoteSqlLiteral(database.access.setting);
      statements.push(`ALTER TABLE ${tableName} ENABLE ROW LEVEL SECURITY;`);
      statements.push(`ALTER TABLE ${tableName} FORCE ROW LEVEL SECURITY;`);
      statements.push(`DROP POLICY IF EXISTS ${policyName} ON ${tableName};`);
      statements.push(`CREATE POLICY ${policyName} ON ${tableName} USING (${columnName}::text = current_setting(${setting}, true)) WITH CHECK (${columnName}::text = current_setting(${setting}, true));`);
    }
  }
  return `${statements.join('\n\n')}\n`;
}

export function applicationAdmittedContextDigest(admitted: ApplicationAdmittedContext): string {
  return contextDigest(admitted);
}

async function acquireApplicationModelChangeCommitLock<TSchema extends Readonly<Record<string, unknown>>>(
  db: ApplicationDatabaseClient<TSchema>,
  contextDigestValue: string,
): Promise<void> {
  const scope = applicationModelChangeCommitScope(contextDigestValue);
  await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${scope}, 0))`);
}

function registeredDatabase(databases: ReadonlyMap<string, RegisteredDatabase>, binding: ApplicationDatabaseBinding): RegisteredDatabase {
  const registered = databases.get(binding.name);
  if (!registered || binding.kind !== 'applicationDatabase' || binding.provider.kind !== registered.binding.provider.kind) throw new Error(`Database ${binding.name} is not registered in this relational runtime context.`);
  return registered;
}

function databaseForModel<TTable extends AnyPgTable>(databases: ReadonlyMap<string, RegisteredDatabase>, model: PromotedDrizzleTable<TTable>): ApplicationDatabaseBinding {
  const registered = databases.get(model.$model.database);
  if (!registered) throw new Error(`Model ${model.$model.name} references unregistered database ${model.$model.database}.`);
  return registered.binding;
}

function assertModelDatabase<TTable extends AnyPgTable>(model: PromotedDrizzleTable<TTable> | RelationalModelRuntimeTable, database: ApplicationDatabaseBinding): void {
  if (model.$model.database !== database.name) throw new Error(`Model ${model.$model.name} belongs to database ${model.$model.database}, not ${database.name}; cross-database atomic work fails closed.`);
}

type RelationalModelRuntimeTable = AnyPgTable & {
  readonly $model: {
    readonly name: string;
    readonly database: string;
    readonly table: { readonly name: string; readonly schema?: string };
  };
};

function contextDigest(admitted: ApplicationAdmittedContext): string {
  return createHmac('sha256', admitted.digestSecret).update(stableJson(admitted.values)).digest('hex');
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`;
}

function numericResult(rows: unknown, field: string): number {
  const first = Array.isArray(rows) ? rows[0] : undefined;
  const value = first && typeof first === 'object' ? Reflect.get(first, field) : undefined;
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`PostgreSQL returned invalid ${field} cursor value.`);
  return number;
}

// typecast-boundary: every reflected PostgreSQL change field is checked before a normalized change record is returned.
function applicationChangeRows(rows: unknown): readonly (ApplicationModelChange & { readonly sequence: number })[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    if (!row || typeof row !== 'object') throw new Error('PostgreSQL returned an invalid application model change row.');
    const sequence = Number(Reflect.get(row, 'sequence'));
    const model = Reflect.get(row, 'model');
    const operation = Reflect.get(row, 'operation');
    const contextDigestValue = Reflect.get(row, 'context_digest');
    const recordedAt = Reflect.get(row, 'recorded_at');
    if (!Number.isSafeInteger(sequence) || sequence < 1 || typeof model !== 'string' || !['insert', 'update', 'delete', 'invalidate', 'reset'].includes(String(operation)) || typeof contextDigestValue !== 'string') {
      throw new Error('PostgreSQL returned an invalid application model change row.');
    }
    return {
      sequence,
      model,
      operation: operation as ApplicationModelChange['operation'],
      ...(Reflect.get(row, 'identity') !== null && Reflect.get(row, 'identity') !== undefined ? { identity: Reflect.get(row, 'identity') } : {}),
      ...(typeof Reflect.get(row, 'revision') === 'string' ? { revision: Reflect.get(row, 'revision') as string } : {}),
      contextDigest: contextDigestValue,
      ...(Array.isArray(Reflect.get(row, 'changed_fields')) ? { changedFields: Reflect.get(row, 'changed_fields') as string[] } : {}),
      recordedAt: recordedAt instanceof Date ? recordedAt.toISOString() : String(recordedAt),
    };
  });
}

function quoteSqlIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteSqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
