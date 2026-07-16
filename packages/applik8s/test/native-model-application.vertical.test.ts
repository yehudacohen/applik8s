// typecast-file-boundary: negative fixtures cross overload boundaries deliberately to assert fail-closed diagnostics.
import { app, applicationGraphFor, postgres, trustedContext } from '@applik8s/applik8s';
import { command, entity, event, type } from '@applik8s/applik8s/dsl';
import { serializeApplicationGraph, validateApplicationGraphStructure } from '@applik8s/core';
import { eq, relations } from 'drizzle-orm';
import { pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { describe, expect, test } from 'vitest';

function catalogSchema() {
  const sets = pgTable('sets', {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    name: text('name').notNull(),
    revision: text('revision').notNull(),
  });
  const cards = pgTable('cards', {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    setId: uuid('set_id').notNull().references(() => sets.id),
    name: text('name').notNull(),
    revision: text('revision').notNull(),
  });
  const setsRelations = relations(sets, ({ many }) => ({ cards: many(cards) }));
  const cardsRelations = relations(cards, ({ one }) => ({ set: one(sets, { fields: [cards.setId], references: [sets.id] }) }));
  return { sets, cards, setsRelations, cardsRelations };
}

describe('v0.6 app-scoped native model promotion', () => {
  test('registers a native table, provider, relationship, access authority, and serializable common model contract', () => {
    const schema = catalogSchema();
    const OrganizationId = trustedContext('organizationId', { schema: type('string') });
    const catalog = app('native-catalog', { namespace: 'catalog-system' });
    const Database = catalog.database.postgres('catalog', {
      schema,
      migrations: { path: './drizzle', digest: 'sha256:catalog' },
      access: postgres.rls({ context: OrganizationId, column: 'organizationId' }),
    });
    const SetModel = catalog.model(schema.sets, { name: 'Set', database: Database });
    const Card = catalog.model(schema.cards, { name: 'Card', database: Database });
    const RenameCard = command('cards.rename.v1', { input: type({ cardId: 'string', name: 'string', expectedRevision: 'string' }), output: type({ changed: 'boolean', revision: 'string' }), errors: { revisionConflict: type({ expectedRevision: 'string', actualRevision: 'string | null' }) } });
    const CardChanged = event('cards.changed.v1', { payload: type({ cardId: 'string', revision: 'string' }) });
    Card.$model.on.command(RenameCard, {
      key: ({ cardId }) => cardId,
      history: true,
      events: [CardChanged],
    }, async (card, input, context) => {
      const updated = await context.update(card, { name: input.name }, { ifRevision: input.expectedRevision });
      context.emit(CardChanged, { cardId: card.id, revision: updated.value.revision ?? input.expectedRevision });
      return { changed: updated.changed, revision: updated.value.revision ?? input.expectedRevision };
    });
    const CatalogImport = catalog.crd(entity('CatalogImport', {
      spec: type({ setId: SetModel.$model.ref(), sourceUrl: 'string' }),
      status: type({ phase: "'Pending' | 'Completed'" }),
    }), { apiVersion: 'catalog.example/v1alpha1' });
    const PublicCard = Card.$model.schema.select.pick('id', 'setId', 'name');
    const CardsForSet = catalog.query('cards.for-set.v1', {
      input: type({ setId: SetModel.$model.ref() }),
      output: PublicCard.array(),
      database: Database,
      context: [OrganizationId],
      reads: [Card.$model.relations.set as NonNullable<typeof Card.$model.relations.set>],
      authorize: ({ principal, input }) => principal.can?.('read', SetModel, input.setId) ?? false,
      run: async ({ context, input }) => {
        const db = context.database(Database);
        return db.select({ id: Card.id, setId: Card.setId, name: Card.name }).from(Card).where(eq(Card.setId, input.setId));
      },
    });
    expect(SetModel).toBe(schema.sets);
    expect(Card).toBe(schema.cards);
    expect(Card.$model.schema.select).toBeTypeOf('function');
    expect(CatalogImport.$model.relationships).toEqual([
      { source: 'CatalogImport', name: 'setId', target: 'Set', cardinality: 'one', integrity: 'reconcile-checked', fields: ['setId'], references: ['id'] },
    ]);
    expect(CatalogImport.on.reconcile).toBeTypeOf('function');
    expect(CardsForSet.id).toBe('cards.for-set.v1');
    expect(CardsForSet.reads).toEqual([
      expect.objectContaining({ source: 'Card', name: 'set', target: 'Set' }),
    ]);

    const graph = applicationGraphFor(catalog.composition);
    expect(graph).toBeDefined();
    const card = graph?.nodes.find((node) => node.kind === 'model' && node.name === 'Card');
    expect(card).toMatchObject({
      stability: 'stable',
      native: {
        kind: 'drizzle-table',
        authority: 'postgres',
        artifact: { name: 'cards', database: 'catalog' },
        schemaAuthority: 'drizzle',
        runtimeSchema: 'derived-arktype',
        nativeApi: 'preserved',
      },
      common: {
        identity: { fields: ['id'], encoding: 'scalar' },
        revision: { field: 'revision', authority: 'postgres-row' },
        changes: { authority: 'postgres-change-log', rawWrites: 'explicit-invalidation-required' },
        relationships: [expect.objectContaining({ name: 'set', target: 'Set', integrity: 'foreign-key' })],
      },
      runtime: expect.objectContaining({
        tableName: 'cards',
        storageShape: 'native-relational',
        nativeRelational: expect.objectContaining({
          identity: { property: 'id', column: 'id' },
          revision: { property: 'revision', column: 'revision' },
          access: { context: 'organizationId', setting: 'applik8s.context.organizationId', property: 'organizationId', column: 'organization_id' },
        }),
      }),
    });
    expect(graph?.nodes.find((node) => node.kind === 'commandHandler' && node.name === 'Card-cards.rename.v1')).toMatchObject({ model: { nodeId: 'model.card' }, effectBoundary: 'transactionSafeOnly' });
    expect(graph?.nodes.find((node) => node.kind === 'processor' && node.name === 'Card-commands')).toBeDefined();
    expect(graph?.nodes.find((node) => node.kind === 'crd' && node.name === 'CatalogImport')).toMatchObject({
      native: { kind: 'kubernetes-resource', authority: 'kubernetes', nativeApi: 'preserved' },
      common: {
        identity: { fields: ['metadata.name'], encoding: 'scalar' },
        revision: { field: 'metadata.resourceVersion', authority: 'kubernetes-resource-version' },
        relationships: [{ name: 'setId', target: 'Set', integrity: 'reconcile-checked' }],
      },
    });
    expect(graph?.nodes.find((node) => node.kind === 'query' && node.id === 'query.cards.for-set.v1')).toMatchObject({
      version: 'v1',
      authorization: 'application-defined',
      trustedContext: ['organizationId'],
      incremental: 'invalidation-requery',
      snapshotResume: 'resumableInvalidation',
      reads: [{ model: { nodeId: 'model.card' }, relationship: 'set' }],
    });
    if (!graph) throw new Error('Expected native application graph.');
    expect(validateApplicationGraphStructure(graph)).toEqual([]);
    const serialized = serializeApplicationGraph(graph);
    expect(serialized).toContain('"native":{"artifact":{"database":"catalog","migrations":{"digest":"sha256:catalog","path":"./drizzle"},"name":"cards"}');
    expect(serialized).not.toContain('organizationId":{"kind"');
    expect(serialized).not.toContain('drizzle-arktype');
  });

  test('fails closed when required provider-wide context cannot be enforced', () => {
    const schema = catalogSchema();
    const globals = pgTable('globals', { id: text('id').primaryKey(), revision: text('revision').notNull() });
    const OrganizationId = trustedContext('organizationId', { schema: type('string') });
    const catalog = app('native-access');
    const Database = catalog.database.postgres('catalog', {
      schema: { ...schema, globals },
      access: postgres.rls({ context: OrganizationId, column: 'organizationId' }),
    });
    expect(() => catalog.model(globals, { database: Database })).toThrow('must declare column organizationId');
    expect(() => catalog.model(globals, { database: Database, access: 'global' })).not.toThrow();
  });

  test('records fluent model-native views as direct query operations', () => {
    const schema = catalogSchema();
    const catalog = app('native-view-fixture');
    const Database = catalog.database.postgres('catalog', { schema });
    const BaseCard = catalog.model(schema.cards, { name: 'Card', database: Database });
    const Card = BaseCard.view('published', {
      input: type({ limit: 'number.integer >= 1' }),
      output: type({ id: 'string', name: 'string' }).array(),
      database: Database,
      authorize: () => true,
      run: async () => [],
    });

    expect(Card.published.operation).toMatchObject({
      id: 'Card.published',
      model: 'Card',
      name: 'published',
      operation: 'query',
    });
    expect(applicationGraphFor(catalog.composition)?.nodes.find((node) => node.kind === 'query' && node.publicId === 'Card.published')).toMatchObject({
      name: 'Card.published',
      version: 'v1',
      modelOperation: {
        model: { nodeId: 'model.card' },
        name: 'published',
        kind: 'view',
      },
    });
  });

  test('fails closed when multiple registered databases make promotion ambiguous', () => {
    const firstSchema = catalogSchema();
    const secondSchema = catalogSchema();
    const catalog = app('native-ambiguous');
    catalog.database.postgres('first', { schema: firstSchema });
    catalog.database.postgres('second', { schema: secondSchema });
    expect(() => catalog.model(firstSchema.sets)).toThrow('ambiguous');
  });
});
