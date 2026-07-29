// typecast-file-boundary: Drizzle doubles erase schemas while assertions verify the runtime restoration boundary.
import type { ApplicationDatabaseBinding, ApplicationDatabaseClient } from '@applik8s/applik8s';
import { applicationRelationalFrameworkMigrationSql, createApplicationRelationalContext, postgres, promoteDrizzleTable, trustedContext } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import { PgDialect, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { describe, expect, test } from 'vitest';

function fixture() {
  const cards = pgTable('cards', {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    name: text('name').notNull(),
    revision: text('revision').notNull(),
  });
  const OrganizationId = trustedContext('organizationId', { schema: type('string') });
  const schema = { cards };
  const database: ApplicationDatabaseBinding<typeof schema> = {
    kind: 'applicationDatabase',
    name: 'catalog',
    provider: { kind: 'postgres', name: 'catalog', database: 'catalog', provision: false },
    schema,
    access: postgres.rls({ context: OrganizationId, column: 'organizationId' }),
  };
  const Card = promoteDrizzleTable(cards, { name: 'Card', database: database.name, schema });
  return { Card, OrganizationId, database, schema };
}

describe('v0.6 relational runtime', () => {
  test('generates framework change storage and fail-closed provider-wide RLS SQL', () => {
    const { Card, database } = fixture();
    const migration = applicationRelationalFrameworkMigrationSql(database, [Card]);
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS applik8s_model_changes');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS applik8s_public_stream_retention_floors');
    expect(migration).toContain('ALTER TABLE "cards" ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('ALTER TABLE "cards" FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('"organization_id"::text = current_setting(\'applik8s.context.organizationId\', true)');
    expect(migration).toContain('WITH CHECK');
  });

  test('installs admitted context with transaction-local set_config and commits bounded invalidation in the same transaction', async () => {
    const { Card, database } = fixture();
    const executed: unknown[] = [];
    const transaction = {
      async execute(statement: unknown) { executed.push(statement); return []; },
    };
    const db = {
      async transaction<TResult>(handler: (tx: typeof transaction) => Promise<TResult>) { return handler(transaction); },
    };
    const context = createApplicationRelationalContext({
      databases: [{ binding: database, db: db as unknown as ApplicationDatabaseClient<typeof database.schema> }],
      admittedContext: { values: { organizationId: '00000000-0000-0000-0000-000000000001' }, digestSecret: 'test-only-secret' },
      now: () => new Date('2026-07-15T12:00:00.000Z'),
    });
    await context.transaction(database, async ({ db: scoped, changes }) => {
      expect(context.database(database)).toBe(scoped);
      changes.invalidate(Card, { identity: 'card-1', revision: '2', changedFields: ['name', 'name'] });
    });
    expect(executed).toHaveLength(3);
    const dialect = new PgDialect();
    const setContext = dialect.sqlToQuery(executed[0] as never);
    expect(setContext.sql).toBe('select set_config($1, $2, true)');
    expect(setContext.params).toEqual(['applik8s.context.organizationId', '00000000-0000-0000-0000-000000000001']);
    const commitLock = dialect.sqlToQuery(executed[1] as never);
    expect(commitLock.sql).toContain('pg_advisory_xact_lock');
    expect(commitLock.params).toEqual([expect.stringMatching(/^applik8s:model-changes:v1:[a-f0-9]{64}$/)]);
    const change = dialect.sqlToQuery(executed[2] as never);
    expect(change.sql).toContain('insert into applik8s_model_changes');
    expect(change.params).toEqual(expect.arrayContaining(['Card', 'invalidate', '"card-1"', '2', '["name"]', '2026-07-15T12:00:00.000Z']));
    const digest = change.params.find((value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value));
    expect(digest).toBeTypeOf('string');
    expect(change.params).not.toContain('00000000-0000-0000-0000-000000000001');
  });

  test('scopes live-query changes to data isolation rather than the writing actor', async () => {
    const { Card, database } = fixture();
    const digestFor = async (
      binding: ApplicationDatabaseBinding,
      values: Readonly<Record<string, unknown>>,
    ): Promise<unknown> => {
      const executed: unknown[] = [];
      const transaction = { async execute(statement: unknown) { executed.push(statement); return []; } };
      const db = { async transaction<TResult>(handler: (tx: typeof transaction) => Promise<TResult>) { return handler(transaction); } };
      const context = createApplicationRelationalContext({
        databases: [{ binding, db: db as unknown as ApplicationDatabaseClient<Readonly<Record<string, unknown>>> }],
        admittedContext: { values, digestSecret: 'test-only-secret' },
      });
      await context.transaction(binding, async ({ changes }) => changes.invalidate(Card));
      const statement = new PgDialect().sqlToQuery(executed.at(-1) as never);
      return statement.params.find((value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value));
    };

    const { access: _access, ...globalDatabase } = database;
    const userChange = await digestFor(globalDatabase, {
      'applik8s.dev/principal': { id: 'user-1', claims: { role: 'user' } },
      'applik8s.dev/authorization-version': 'user-policy-4',
    });
    const workerChange = await digestFor(globalDatabase, {
      'applik8s.dev/principal': { id: 'worker-1', claims: { role: 'media-worker' } },
      'applik8s.dev/authorization-version': 'worker-policy-9',
      executionAuthority: 'workflow',
    });
    expect(workerChange).toBe(userChange);

    const firstTenantActor = await digestFor(database, {
      organizationId: 'organization-1',
      'applik8s.dev/principal': { id: 'user-1' },
      'applik8s.dev/authorization-version': 'user-policy-4',
    });
    const sameTenantWorker = await digestFor(database, {
      organizationId: 'organization-1',
      'applik8s.dev/principal': { id: 'worker-1' },
      'applik8s.dev/authorization-version': 'worker-policy-9',
    });
    const otherTenant = await digestFor(database, {
      organizationId: 'organization-2',
      'applik8s.dev/principal': { id: 'user-1' },
      'applik8s.dev/authorization-version': 'user-policy-4',
    });
    expect(sameTenantWorker).toBe(firstTenantActor);
    expect(otherTenant).not.toBe(firstTenantActor);
  });

  test('acquires the committed change frontier before evaluating a repeatable-read snapshot', async () => {
    const { database } = fixture();
    const executed: unknown[] = [];
    let handlerExecuted = false;
    const transaction = {
      async execute(statement: unknown) {
        executed.push(statement);
        return executed.length === 4 ? [{ sequence: 7 }] : [];
      },
    };
    const db = { async transaction<TResult>(handler: (tx: typeof transaction) => Promise<TResult>) { return handler(transaction); } };
    const context = createApplicationRelationalContext({
      databases: [{ binding: database, db: db as unknown as ApplicationDatabaseClient<typeof database.schema> }],
      admittedContext: { values: { organizationId: 'organization-private' }, digestSecret: 'test-only-secret' },
    });

    const snapshot = await context.snapshot(database, () => {
      handlerExecuted = true;
      expect(executed).toHaveLength(3);
      return 'snapshot-value';
    });

    const dialect = new PgDialect();
    expect(dialect.sqlToQuery(executed[0] as never).sql).toContain('set transaction isolation level repeatable read read only');
    expect(dialect.sqlToQuery(executed[1] as never).sql).toBe('select set_config($1, $2, true)');
    expect(dialect.sqlToQuery(executed[2] as never).sql).toContain('pg_advisory_xact_lock');
    expect(handlerExecuted).toBe(true);
    expect(snapshot).toEqual({ value: 'snapshot-value', sequence: 7 });
  });

  test('computes retention floors inside the admitted context instead of leaking global sequence state', async () => {
    const { database } = fixture();
    const executed: unknown[] = [];
    const transaction = {
      async execute(statement: unknown) {
        executed.push(statement);
        return executed.length === 2 ? [] : [{ floor: 0 }];
      },
    };
    const db = { async transaction<TResult>(handler: (tx: typeof transaction) => Promise<TResult>) { return handler(transaction); } };
    const context = createApplicationRelationalContext({
      databases: [{ binding: database, db: db as unknown as ApplicationDatabaseClient<typeof database.schema> }],
      admittedContext: { values: { organizationId: 'organization-private' }, digestSecret: 'test-only-secret' },
    });

    await context.changes(database, 0);

    const dialect = new PgDialect();
    const floor = dialect.sqlToQuery(executed[2] as never);
    expect(floor.sql).toContain('where context_digest = $1');
    expect(floor.params).toHaveLength(1);
    expect(floor.params).not.toContain('organization-private');
  });

  test('fails closed for missing trusted context and cross-database invalidation', async () => {
    const { Card, database } = fixture();
    const db = { async transaction<TResult>(handler: (tx: { execute(): Promise<never[]> }) => Promise<TResult>) { return handler({ async execute() { return []; } }); } };
    const missing = createApplicationRelationalContext({
      databases: [{ binding: database, db: db as unknown as ApplicationDatabaseClient<typeof database.schema> }],
      admittedContext: { values: {}, digestSecret: 'test-only-secret' },
    });
    await expect(missing.transaction(database, async () => undefined)).rejects.toThrow('Required trusted context organizationId is missing');

    const other = { ...database, name: 'other' } satisfies ApplicationDatabaseBinding<typeof database.schema>;
    const context = createApplicationRelationalContext({
      databases: [{ binding: other, db: db as unknown as ApplicationDatabaseClient<typeof database.schema> }],
      admittedContext: { values: { organizationId: 'organization-1' }, digestSecret: 'test-only-secret' },
    });
    await expect(context.transaction(other, async ({ changes }) => changes.invalidate(Card))).rejects.toThrow('belongs to database catalog, not other');
  });

  test('accepts the compiler reconstructed same-name database capability without depending on authoring object identity', async () => {
    const { database } = fixture();
    const db = { async transaction<TResult>(handler: (tx: { execute(): Promise<never[]> }) => Promise<TResult>) { return handler({ async execute() { return []; } }); } };
    const context = createApplicationRelationalContext({
      databases: [{ binding: database, db: db as unknown as ApplicationDatabaseClient<typeof database.schema> }],
      admittedContext: { values: { organizationId: 'organization-1' }, digestSecret: 'test-only-secret' },
    });
    // typecast: generated query modules reconstruct this minimal capability from the validated graph contract.
    const reconstructed = { kind: 'applicationDatabase', name: 'catalog', provider: { kind: 'postgres' }, schema: {} } as unknown as ApplicationDatabaseBinding;

    await expect(context.run(reconstructed, () => context.database(reconstructed))).resolves.toBeDefined();
  });
});
