// typecast-file-boundary: this live test restores Drizzle generics after connecting through PostgreSQL's untyped wire protocol.
import type { ApplicationDatabaseBinding, ApplicationDatabaseClient } from '@applik8s/applik8s';
import { applicationRelationalChangeScopeDigest, applicationRelationalChangeScopes, applicationRelationalFrameworkMigrationSql, createApplicationRelationalContext, postgres as postgresAccess, promoteDrizzleTable, trustedContext } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import { eq } from 'drizzle-orm';
import { pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { applicationModelChangeCommitScope } from '../src/relational-runtime-contract.js';

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

  test('does not miss a late commit whose change sequence was allocated before a concurrent commit', async () => {
    const context = relationalContext(org1);
    const admitted = { values: { organizationId: org1 }, digestSecret: 'v06-live-context-digest-secret' } as const;
    const digest = applicationRelationalChangeScopeDigest(applicationRelationalChangeScopes(admitted), 'organizationId');
    const firstId = '10000000-0000-0000-0000-000000000010';
    const secondId = '10000000-0000-0000-0000-000000000011';
    let releaseFirst: (() => void) | undefined;
    let firstAllocated: (() => void) | undefined;
    const release = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const allocated = new Promise<void>((resolve) => { firstAllocated = resolve; });

    const first = sql.begin(async (transaction) => {
      await transaction.unsafe('SELECT set_config($1, $2, true)', ['applik8s.context.organizationId', org1]);
      await transaction.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [applicationModelChangeCommitScope(digest)]);
      await transaction.unsafe('INSERT INTO cards (id, organization_id, name, revision) VALUES ($1::uuid, $2::uuid, $3, $4)', [firstId, org1, 'late-first', 'r1']);
      await transaction.unsafe(
        `WITH next_commit AS (
          UPDATE applik8s_model_change_commit_frontier
          SET position = position + 1
          WHERE singleton = true
          RETURNING position
        )
        INSERT INTO applik8s_model_changes
          (commit_position, model, operation, identity, revision, context_digest, changed_fields, recorded_at)
        SELECT position, $1, $2, $3::jsonb, $4, $5, $6::jsonb, now()
        FROM next_commit`,
        ['Card', 'insert', JSON.stringify(firstId), 'r1', digest, JSON.stringify(['name'])],
      );
      firstAllocated?.();
      await release;
    });

    await allocated;
    const second = context.transaction(database, async ({ db: transaction, changes }) => {
      await transaction.insert(Card).values({ id: secondId, organizationId: org1, name: 'second', revision: 'r1' });
      changes.invalidate(Card, { identity: secondId, revision: 'r1', changedFields: ['name'] });
    });
    const snapshotPromise = context.snapshot(database, () => context.database(database).select().from(Card));

    await new Promise((resolve) => setTimeout(resolve, 100));
    releaseFirst?.();
    const snapshot = await snapshotPromise;
    await Promise.all([first, second]);

    const after = await context.changes(database, snapshot.sequence, 100);
    const visibleAtSnapshot = new Set(snapshot.value.map((row) => row.id));
    const visibleAfterSnapshot = new Set(after.items.map((change) => String(change.identity)));
    expect(visibleAtSnapshot.has(firstId) || visibleAfterSnapshot.has(firstId)).toBe(true);
    expect(visibleAtSnapshot.has(secondId) || visibleAfterSnapshot.has(secondId)).toBe(true);
  });

  function relationalContext(organizationId: string) {
    return createApplicationRelationalContext({
      databases: [{ binding: database, db: db as unknown as ApplicationDatabaseClient<typeof schema> }],
      admittedContext: { values: { organizationId }, digestSecret: 'v06-live-context-digest-secret' },
    });
  }
});
