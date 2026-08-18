// typecast-file-boundary: Database driver rows are schema-validated before being exposed through typed relational runtime contracts.
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac, randomUUID } from 'node:crypto';
import { and, eq, getTableColumns, type InferInsertModel, type InferSelectModel, sql } from 'drizzle-orm';
import type { AnyPgTable } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { JsonValue } from '@applik8s/core';
import type { ApplicationDatabaseBinding } from './application.js';
import { applicationModelFacet, getRequiredDrizzleApplicationModelFacet } from './native-model-runtime.js';
import type { ApplicationModelSnapshot, PromotedDrizzleTable } from './native-models.js';
import { applicationModelChangeCommitScope } from './relational-runtime-contract.js';
import { validateTrustedContextValue } from './trusted-context.js';

type ApplicationDatabaseDirectMember =
  | '$with'
  | 'count'
  | 'delete'
  | 'execute'
  | 'insert'
  | 'query'
  | 'refreshMaterializedView'
  | 'select'
  | 'selectDistinct'
  | 'selectDistinctOn'
  | 'transaction'
  | 'update'
  | 'with';

/**
 * The schema-preserving Drizzle surface supported equally by an execution
 * client and a declared database handle.
 *
 * Drizzle's driver object also exposes adapter internals such as `_`, `$cache`,
 * and `$count`. Those are not portable query capabilities and requiring them
 * made an otherwise valid direct handle incompatible with ordinary helpers.
 */
export type ApplicationDatabaseClient<TSchema extends Readonly<Record<string, unknown>>> =
  Pick<PostgresJsDatabase<TSchema>, Extract<keyof PostgresJsDatabase<TSchema>, ApplicationDatabaseDirectMember>>;

const applicationDatabaseDirectMembers = new Set<PropertyKey>([
  '$with',
  'count',
  'delete',
  'execute',
  'insert',
  'query',
  'refreshMaterializedView',
  'select',
  'selectDistinct',
  'selectDistinctOn',
  'transaction',
  'update',
  'with',
]);

/** A declared database that becomes an ordinary Drizzle client inside managed execution. */
export type ApplicationDatabaseHandle<TSchema extends Readonly<Record<string, unknown>>> =
  ApplicationDatabaseBinding<TSchema>
  & ApplicationDatabaseClient<TSchema>;

type ApplicationDatabaseRuntimeResolver = <TSchema extends Readonly<Record<string, unknown>>>(
  binding: ApplicationDatabaseBinding<TSchema>,
) => ApplicationDatabaseClient<TSchema>;

const applicationDatabaseRuntime = new AsyncLocalStorage<ApplicationDatabaseRuntimeResolver>();

/**
 * Hydrates a declared database through the current managed execution without
 * leaking the relational context into domain code.
 */
export function applicationDatabaseHandle<TSchema extends Readonly<Record<string, unknown>>>(
  binding: ApplicationDatabaseBinding<TSchema>,
): ApplicationDatabaseHandle<TSchema> {
  return new Proxy(binding as ApplicationDatabaseHandle<TSchema>, {
    get(target, property, receiver) {
      if (Reflect.has(target, property)) return Reflect.get(target, property, receiver);
      if (!applicationDatabaseDirectMembers.has(property)) return undefined;
      const resolve = applicationDatabaseRuntime.getStore();
      if (!resolve) {
        throw new Error(
          `Application database ${binding.name} is only callable inside a managed query, command, event, or workflow execution.`,
        );
      }
      const database = resolve(binding);
      const value = Reflect.get(database, property, database);
      return typeof value === 'function' ? value.bind(database) : value;
    },
  });
}

/** Installs the execution-local database resolver used by direct bindings. */
export function withApplicationDatabaseRuntimeResolver<TResult>(
  resolve: ApplicationDatabaseRuntimeResolver,
  operation: () => TResult,
): TResult {
  return applicationDatabaseRuntime.run(resolve, operation);
}

export interface ApplicationAdmittedContext {
  readonly values: Readonly<Record<string, unknown>>;
  /** Server-held secret used to prevent raw access-context values from entering generic change records. */
  readonly digestSecret: string;
}

export type ApplicationRelationalChangeScopes = Readonly<Record<string, string>>;

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
  /** Exact server-admitted context used to install database policy state. */
  readonly admittedContext: ApplicationAdmittedContext;
  /** Provider-admitted values with framework-reserved transport metadata removed. */
  readonly trustedContext: Readonly<Record<string, JsonValue>>;
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
    admittedContext: options.admittedContext,
    trustedContext: relationalTrustedContext(options.admittedContext),
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
        const changeScopes = relationalReadChangeScopeDigests(
          registered.binding,
          options.admittedContext,
        );
        for (const changeScope of changeScopes) {
          await acquireApplicationModelChangeCommitLock(tx, changeScope);
        }
        const value = await active.run({ database: binding.name, db: tx as ApplicationDatabaseClient<Readonly<Record<string, unknown>>> }, handler);
        const rows = await tx.execute(sql`select coalesce(max(sequence), 0) as sequence from applik8s_model_changes where context_digest in (${sql.join(changeScopes.map((scope) => sql`${scope}`), sql`, `)})`);
        return { value, sequence: numericResult(rows, 'sequence') };
      });
    },
    async changes(binding, afterSequence, limit = 100) {
      if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) throw new Error('Application model change cursor sequence must be a non-negative safe integer.');
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) throw new Error('Application model change page limit must be between 1 and 1000.');
      const registered = registeredDatabase(databases, binding);
      return context.run(binding, async () => {
        const db = context.database(binding);
        const digests = relationalReadChangeScopeDigests(
          registered.binding,
          options.admittedContext,
        );
        const rows = await db.execute(sql`
          select sequence, model, operation, identity, revision, context_digest, changed_fields, recorded_at
          from applik8s_model_changes
          where context_digest in (${sql.join(digests.map((digest) => sql`${digest}`), sql`, `)}) and sequence > ${afterSequence}
          order by sequence asc
          limit ${limit}
        `);
        const floorRows = await db.execute(sql`select coalesce(min(sequence), 0) as floor from applik8s_model_changes where context_digest in (${sql.join(digests.map((digest) => sql`${digest}`), sql`, `)})`);
        return { items: applicationChangeRows(rows), retentionFloor: numericResult(floorRows, 'floor') };
      });
    },
    async transaction(binding, handler) {
      const registered = registeredDatabase(databases, binding);
      return registered.db.transaction(async (tx) => {
        await installTrustedContext(tx, registered.binding, options.admittedContext);
        const changeScope = relationalChangeScopeDigest(registered.binding, options.admittedContext);
        await acquireApplicationModelChangeCommitLock(tx, changeScope);
        const collector = new MutableChangeCollector(registered.binding, changeScope, now);
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
        const facet = getRequiredDrizzleApplicationModelFacet(model);
        const identityField = facet.identity.fields[0];
        const identityColumn = identityField ? getTableColumns(model)[identityField] : undefined;
        if (!identityColumn) throw new Error(`Model ${facet.name} has no usable scalar identity column.`);
        const nativeTable: AnyPgTable = model;
        const rows = await db.select().from(nativeTable).where(eq(identityColumn, identity)).limit(1);
        // typecast: Drizzle selected the complete promoted native table; its row shape is the table's inferred select model.
        const value = rows[0] as InferSelectModel<TTable> | undefined;
        if (!value) return undefined;
        const revision = facet.revision ? String(Reflect.get(value, facet.revision.field)) : undefined;
        return { identity, value, ...(revision ? { revision } : {}) };
      });
    },
    async update<TTable extends AnyPgTable>(model: PromotedDrizzleTable<TTable>, snapshot: ApplicationModelSnapshot<InferSelectModel<TTable>, unknown>, patch: Partial<InferInsertModel<TTable>>, updateOptions: ApplicationUpdateOptions = {}): Promise<ApplicationModelUpdateResult<InferSelectModel<TTable>, unknown>> {
      const binding = databaseForModel(databases, model);
      const execute = async (): Promise<ApplicationModelUpdateResult<InferSelectModel<TTable>, unknown>> => {
        const db = context.database(binding);
        const facet = getRequiredDrizzleApplicationModelFacet(model);
        const scope = active.getStore();
        if (!scope?.changes) throw new Error(`Model ${facet.name} update requires an observable transaction scope.`);
        if (Object.keys(patch).length === 0) return { identity: snapshot.identity, value: snapshot.value, ...(snapshot.revision ? { revision: snapshot.revision } : {}), changed: false };
        const identityField = facet.identity.fields[0];
        const identityColumn = identityField ? getTableColumns(model)[identityField] : undefined;
        if (!identityColumn) throw new Error(`Model ${facet.name} has no usable scalar identity column.`);
        const revisionField = facet.revision?.field;
        const revisionColumn = revisionField ? getTableColumns(model)[revisionField] : undefined;
        if (updateOptions.ifRevision && !revisionColumn) throw new Error(`Model ${facet.name} does not declare a revision column.`);
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
          if (updateOptions.ifRevision) throw new ApplicationModelRevisionConflict(facet.name, snapshot.identity, updateOptions.ifRevision);
          throw new Error(`Model ${facet.name} identity ${JSON.stringify(snapshot.identity)} was not found.`);
        }
        scope.changes.record(facet.name, 'update', {
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
  constructor(
    readonly database: ApplicationDatabaseBinding,
    readonly contextDigest: string,
    readonly now: () => Date,
  ) {}
  invalidate<TTable extends AnyPgTable>(model: PromotedDrizzleTable<TTable>, options: ApplicationChangeOptions = {}): void {
    assertModelDatabase(model, this.database);
    this.record(getRequiredDrizzleApplicationModelFacet(model).name, 'invalidate', options);
  }
  reset<TTable extends AnyPgTable>(model: PromotedDrizzleTable<TTable>): void {
    assertModelDatabase(model, this.database);
    this.record(getRequiredDrizzleApplicationModelFacet(model).name, 'reset', {});
  }
  record(model: string, operation: ApplicationModelChange['operation'], options: ApplicationChangeOptions): void {
    this.#changes.push(Object.freeze({
      model,
      operation,
      ...(options.identity !== undefined ? { identity: options.identity } : {}),
      ...(options.revision ? { revision: options.revision } : {}),
      contextDigest: this.contextDigest,
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
      with next_commit as (
        update applik8s_model_change_commit_frontier
        set position = position + 1
        where singleton = true
        returning position
      )
      insert into applik8s_model_changes
        (commit_position, model, operation, identity, revision, context_digest, changed_fields, recorded_at)
      select
        position, ${change.model}, ${change.operation},
        ${change.identity === undefined ? null : JSON.stringify(change.identity)}::jsonb,
        ${change.revision ?? null}, ${change.contextDigest},
        ${change.changedFields ? JSON.stringify(change.changedFields) : null}::jsonb,
        ${change.recordedAt}::timestamptz
      from next_commit
    `);
  }
}

export function applicationRelationalFrameworkMigrationSql(database: ApplicationDatabaseBinding, models: readonly RelationalModelRuntimeTable[]): string {
  const statements = [
    `CREATE TABLE IF NOT EXISTS applik8s_model_change_commit_frontier (\n  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),\n  position bigint NOT NULL CHECK (position >= 0)\n);`,
    `INSERT INTO applik8s_model_change_commit_frontier (singleton, position)\nVALUES (true, 0)\nON CONFLICT (singleton) DO NOTHING;`,
    `CREATE TABLE IF NOT EXISTS applik8s_model_changes (\n  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,\n  commit_position bigint,\n  model text NOT NULL,\n  operation text NOT NULL CHECK (operation IN ('insert', 'update', 'delete', 'invalidate', 'reset')),\n  identity jsonb,\n  revision text,\n  context_digest text NOT NULL,\n  changed_fields jsonb,\n  recorded_at timestamptz NOT NULL\n);`,
    'ALTER TABLE applik8s_model_changes ADD COLUMN IF NOT EXISTS commit_position bigint;',
    `UPDATE applik8s_model_change_commit_frontier\nSET position = GREATEST(\n  position,\n  COALESCE((SELECT max(commit_position) FROM applik8s_model_changes), 0)\n)\nWHERE singleton = true;`,
    `WITH ordered AS (\n  SELECT sequence, row_number() OVER (ORDER BY sequence) AS position\n  FROM applik8s_model_changes\n  WHERE commit_position IS NULL\n), updated AS (\n  UPDATE applik8s_model_changes AS changes\n  SET commit_position = ordered.position + frontier.position\n  FROM ordered\n  CROSS JOIN applik8s_model_change_commit_frontier AS frontier\n  WHERE frontier.singleton = true\n    AND changes.sequence = ordered.sequence\n  RETURNING changes.commit_position\n)\nUPDATE applik8s_model_change_commit_frontier\nSET position = GREATEST(position, COALESCE((SELECT max(commit_position) FROM updated), position))\nWHERE singleton = true;`,
    'ALTER TABLE applik8s_model_changes ALTER COLUMN commit_position SET NOT NULL;',
    'CREATE UNIQUE INDEX IF NOT EXISTS applik8s_model_changes_commit_position ON applik8s_model_changes (commit_position);',
    'CREATE INDEX IF NOT EXISTS applik8s_model_changes_context_sequence ON applik8s_model_changes (context_digest, sequence);',
    'CREATE INDEX IF NOT EXISTS applik8s_model_changes_model_sequence ON applik8s_model_changes (model, sequence);',
    `CREATE TABLE IF NOT EXISTS applik8s_public_stream_retention_floors (\n  contract_name text NOT NULL,\n  contract_version text NOT NULL,\n  context_digest text NOT NULL,\n  deleted_through bigint NOT NULL CHECK (deleted_through >= 0),\n  updated_at timestamptz NOT NULL DEFAULT now(),\n  PRIMARY KEY (contract_name, contract_version, context_digest)\n);`,
  ];
  if (database.access) {
    for (const model of models) {
      assertModelDatabase(model, database);
      const facet = getRequiredDrizzleApplicationModelFacet(model);
      const column = getTableColumns(model)[database.access.column];
      if (!column) continue;
      const tableName = quoteSqlIdentifier(facet.table.name);
      const columnName = quoteSqlIdentifier(column.name);
      const policyName = quoteSqlIdentifier(`applik8s_${facet.table.name}_${database.access.context.name}`);
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
  const facet = getRequiredDrizzleApplicationModelFacet(model);
  const registered = databases.get(facet.database);
  if (!registered) throw new Error(`Model ${facet.name} references unregistered database ${facet.database}.`);
  return registered.binding;
}

function assertModelDatabase<TTable extends AnyPgTable>(model: PromotedDrizzleTable<TTable> | RelationalModelRuntimeTable, database: ApplicationDatabaseBinding): void {
  const facet = getRequiredDrizzleApplicationModelFacet(model);
  if (facet.database !== database.name) throw new Error(`Model ${facet.name} belongs to database ${facet.database}, not ${database.name}; cross-database atomic work fails closed.`);
}

type RelationalModelRuntimeTable = AnyPgTable & {
  readonly [applicationModelFacet]: unknown;
};

function contextDigest(admitted: ApplicationAdmittedContext): string {
  const providerContext = Object.fromEntries(
    Object.entries(admitted.values).filter(([name]) => !name.startsWith('applik8s.dev/')),
  );
  return createHmac('sha256', admitted.digestSecret).update(stableJson(providerContext)).digest('hex');
}

function relationalTrustedContext(
  admitted: ApplicationAdmittedContext,
): Readonly<Record<string, JsonValue>> {
  const providerContext = Object.fromEntries(
    Object.entries(admitted.values).filter(
      ([name]) => !name.startsWith('applik8s.dev/'),
    ),
  );
  // typecast-boundary: stableJson rejects non-JSON values before the admitted
  // provider context is exposed to application code.
  return Object.freeze(
    JSON.parse(stableJson(providerContext)) as Record<string, JsonValue>,
  );
}

/**
 * Change delivery follows the database's data-isolation boundary, not the
 * identity of the actor that happened to perform a write. Otherwise a worker,
 * controller, or administrator updating data on a user's behalf produces a
 * change that the user's live query can never observe.
 *
 * Global models therefore write one opaque invalidation scope. RLS-backed
 * models write one scope per validated access-context value, while readers of
 * an RLS-capable database follow both because one query may join scoped and
 * intentionally global models. Full principal, claims, authorization version,
 * and other trusted context remain bound into command/result and query cursors;
 * they are deliberately not change scopes.
 */
function relationalChangeScopeDigest(binding: ApplicationDatabaseBinding, admitted: ApplicationAdmittedContext): string {
  const access = binding.access;
  const scopes = applicationRelationalChangeScopes(admitted);
  if (!access) return applicationRelationalChangeScopeDigest(scopes);
  const raw = admitted.values[access.context.name];
  if (raw === undefined) throw new Error(`Required trusted context ${access.context.name} is missing for database ${binding.name}.`);
  validateTrustedContextValue(access.context, raw);
  return applicationRelationalChangeScopeDigest(scopes, access.context.name);
}

/**
 * A database with an access boundary may still contain framework or
 * application models that are intentionally global. A live query can join
 * those models with access-scoped rows, so its invalidation frontier must
 * follow both streams. The query result remains protected by PostgreSQL RLS;
 * observing a global sequence advance reveals no row data and only causes a
 * conservative authoritative requery.
 */
function relationalReadChangeScopeDigests(
  binding: ApplicationDatabaseBinding,
  admitted: ApplicationAdmittedContext,
): readonly string[] {
  const scopes = applicationRelationalChangeScopes(admitted);
  if (!binding.access) {
    return [applicationRelationalChangeScopeDigest(scopes)];
  }
  const raw = admitted.values[binding.access.context.name];
  if (raw === undefined) {
    throw new Error(
      `Required trusted context ${binding.access.context.name} is missing for database ${binding.name}.`,
    );
  }
  validateTrustedContextValue(binding.access.context, raw);
  return [
    applicationRelationalChangeScopeDigest(scopes),
    applicationRelationalChangeScopeDigest(scopes, binding.access.context.name),
  ].sort();
}

/**
 * Precomputes opaque invalidation scopes at a secret-holding admission
 * boundary. Durable workers can then select the data scope for their target
 * model without receiving the signing secret or copying raw tenancy values
 * into the generic change log.
 */
export function applicationRelationalChangeScopes(admitted: ApplicationAdmittedContext): ApplicationRelationalChangeScopes {
  const scopes: Record<string, string> = {
    global: createHmac('sha256', admitted.digestSecret).update('applik8s.relational-change-scope.global.v1').digest('hex'),
  };
  for (const [name, value] of Object.entries(admitted.values)) {
    if (name.startsWith('applik8s.dev/')) continue;
    scopes[`context:${name}`] = createHmac('sha256', admitted.digestSecret)
      .update('applik8s.relational-change-scope.context.v1\0')
      .update(name)
      .update('\0')
      .update(stableJson(value))
      .digest('hex');
  }
  return Object.freeze(scopes);
}

export function applicationRelationalChangeScopeDigest(scopes: ApplicationRelationalChangeScopes, accessContext?: string): string {
  const key = accessContext ? `context:${accessContext}` : 'global';
  const digest = scopes[key];
  if (!digest || !/^[a-f0-9]{64}$/.test(digest)) {
    throw new Error(accessContext
      ? `Application relational change scopes do not contain validated trusted context ${accessContext}.`
      : 'Application relational change scopes do not contain a validated global scope.');
  }
  return digest;
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
