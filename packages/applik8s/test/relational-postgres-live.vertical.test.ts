// typecast-file-boundary: this live test restores Drizzle generics after connecting through PostgreSQL's untyped wire protocol.
import type { ApplicationDatabaseBinding, ApplicationDatabaseClient } from '@applik8s/applik8s';
import { applicationRelationalFrameworkMigrationSql, createApplicationRelationalContext, postgres as postgresAccess, promoteDrizzleTable, trustedContext } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import { eq } from 'drizzle-orm';
import { pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const databaseUrl = process.env.APPLIK8S_V06_POSTGRES_DATABASE_URL;

describe.runIf(databaseUrl)('v0.6 real PostgreSQL relational authority', () => {
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
    provider: { kind: 'postgres', name: 'catalog', database: 'v06_native', provision: false },
    schema,
    access: postgresAccess.rls({ context: OrganizationId, column: 'organizationId' }),
  };
  const Card = promoteDrizzleTable(cards, { name: 'Card', database: database.name, schema, revision: 'revision' });
  const sql = postgres(databaseUrl ?? '', { max: 8, prepare: false });
  const db = drizzle(sql, { schema });
  const org1 = '00000000-0000-0000-0000-000000000001';
  const org2 = '00000000-0000-0000-0000-000000000002';

  beforeAll(async () => {
    await sql.unsafe('DROP TABLE IF EXISTS applik8s_model_changes CASCADE; DROP TABLE IF EXISTS cards CASCADE;');
    await sql.unsafe('CREATE TABLE cards (id uuid PRIMARY KEY, organization_id uuid NOT NULL, name text NOT NULL, revision text NOT NULL);');
    await sql.unsafe(applicationRelationalFrameworkMigrationSql(database, [Card]));
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  test('enforces RLS, SET LOCAL pool cleanup, atomic invalidation, rollback, and scoped snapshot/resume', async () => {
    const context1 = relationalContext(org1);
    const context2 = relationalContext(org2);
    await context1.transaction(database, async ({ db: transaction, changes }) => {
      await transaction.insert(Card).values({ id: '10000000-0000-0000-0000-000000000001', organizationId: org1, name: 'one', revision: 'r1' });
      changes.invalidate(Card, { identity: '10000000-0000-0000-0000-000000000001', revision: 'r1', changedFields: ['name'] });
    });
    await context2.transaction(database, async ({ db: transaction, changes }) => {
      await transaction.insert(Card).values({ id: '20000000-0000-0000-0000-000000000002', organizationId: org2, name: 'two', revision: 'r1' });
      changes.invalidate(Card, { identity: '20000000-0000-0000-0000-000000000002', revision: 'r1' });
    });

    const alternating = await Promise.all(Array.from({ length: 24 }, (_, index) => (index % 2 === 0 ? context1 : context2).run(database, () => (index % 2 === 0 ? context1 : context2).database(database).select().from(Card))));
    expect(alternating.every((rows) => rows.length === 1)).toBe(true);
    expect(alternating[0]?.[0]?.organizationId).toBe(org1);
    expect(alternating[1]?.[0]?.organizationId).toBe(org2);
    expect(() => context1.database(database)).toThrow(/active request or transaction scope/);

    const org1Snapshot = await context1.get(Card, '10000000-0000-0000-0000-000000000001');
    expect(org1Snapshot?.value.name).toBe('one');
    await expect(context2.update(Card, org1Snapshot as NonNullable<typeof org1Snapshot>, { name: 'forbidden' }, { ifRevision: 'r1' })).rejects.toThrow();

    await expect(context1.transaction(database, async ({ db: transaction, changes }) => {
      await transaction.insert(Card).values({ id: '10000000-0000-0000-0000-000000000099', organizationId: org1, name: 'rollback', revision: 'r1' });
      changes.reset(Card);
      throw new Error('rollback-proof');
    })).rejects.toThrow('rollback-proof');
    await expect(context1.run(database, () => context1.database(database).select().from(Card).where(eq(Card.name, 'rollback')))).resolves.toHaveLength(0);

    const snapshot = await context1.snapshot(database, () => context1.database(database).select().from(Card));
    expect(snapshot.value).toHaveLength(1);
    expect(snapshot.sequence).toBeGreaterThan(0);
    const page = await context1.changes(database, 0, 10);
    expect(page.items).toEqual([expect.objectContaining({ model: 'Card', operation: 'invalidate', contextDigest: expect.stringMatching(/^[a-f0-9]{64}$/) })]);
    expect(page.items[0]?.contextDigest).not.toContain(org1);
  });

  function relationalContext(organizationId: string) {
    return createApplicationRelationalContext({
      databases: [{ binding: database, db: db as unknown as ApplicationDatabaseClient<typeof schema> }],
      admittedContext: { values: { organizationId }, digestSecret: 'v06-live-context-digest-secret' },
    });
  }
});
