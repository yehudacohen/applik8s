// typecast-file-boundary: negative fixtures cross overload boundaries deliberately to assert fail-closed diagnostics.
import { type ApplicationModelCreateEvent, app, applicationGraphFor, applicationModelFacet, type ModelEvent, postgres, trustedContext } from '@applik8s/applik8s';
import {
  authenticatedPrincipalId,
  causalPrincipalId,
  field,
  model as relationalModel,
} from '@applik8s/applik8s/drizzle';
import { command, entity, event, type } from '@applik8s/applik8s/dsl';
import { type ApplicationCommandNode, type JsonValue, serializeApplicationGraph, validateApplicationGraphStructure } from '@applik8s/core';
import { eq, relations } from 'drizzle-orm';
import { pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { describe, expect, expectTypeOf, test } from 'vitest';
import { withApplicationManagedEffects } from '../src/application-managed-effects.js';
import {
  withApplicationNativeModelClients,
  withApplicationNativeModelTransactionRuntime,
} from '../src/native-model-execution.js';
import {
  applicationModelCommandBindingForOperation,
  nativeApplicationModelCommandRegistrar,
} from '../src/native-models.js';

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
  test('derives defaultRandom model identity from the durable message without browser ceremony', () => {
    const requests = relationalModel('default_random_requests', {
      id: field.uuid('id').defaultRandom().primaryKey(),
      note: field.text('note').notNull(),
      revision: field.text('revision').notNull().default(''),
    });
    const catalog = app('default-random-model-identity');
    catalog.database.postgres('catalog', { schema: { requests } });
    const create = applicationModelCommandBindingForOperation(requests.create);
    const messageId = '3c1fb125-c213-43c4-846a-2206bcbaa5d1';
    if (!create) {
      throw new Error('The generated create operation must have a durable command binding.');
    }

    expect(create.route({ note: 'framework-owned identity' }, messageId)).toEqual({
      targetKey: messageId,
      idempotencyKey: messageId,
    });
    expect(create.route({
      id: 'a7dc6d3d-9bb9-45df-8a5e-aeab839820ec',
      note: 'caller-supplied identity remains valid',
    }, messageId)).toMatchObject({
      targetKey: 'a7dc6d3d-9bb9-45df-8a5e-aeab839820ec',
    });

    const handler = applicationGraphFor(catalog.composition)?.nodes.find(
      (node) => node.kind === 'commandHandler'
        && node.key.source.includes('durable message identity'),
    );
    expect(handler && handler.kind === 'commandHandler'
      ? handler.key.source
      : '').toContain('messageId');
  });

  test('executes Model.require and Model.edit through the inferred transaction-scoped participant', async () => {
    const schema = catalogSchema();
    const catalog = app('function-native-edit');
    const Database = catalog.database.postgres('catalog', { schema });
    const Card = catalog.model(schema.cards, { name: 'Card', database: Database });
    let value = {
      id: 'card-1',
      organizationId: 'organization-1',
      setId: 'set-1',
      name: 'Draft',
      revision: '1',
    };
    const calls: string[] = [];
    const client = {
      async get() {
        calls.push('get');
        return { id: value.id, spec: value, revision: value.revision };
      },
      async query() {
        return { items: [] };
      },
      async create() {
        throw new Error('not used');
      },
      async patch(_ref: { readonly id: string }, patch: { readonly spec?: Partial<typeof value> }) {
        calls.push('patch');
        value = { ...value, ...patch.spec, revision: '2' };
        return { id: value.id, spec: value, revision: value.revision };
      },
      async delete() {
        calls.push('delete');
      },
    };

    const result = await withApplicationNativeModelClients(
      { Card: client },
      async () => {
        const required = await Card.require('card-1');
        expect(required.value.name).toBe('Draft');
        return Card.edit('card-1', async card => {
          expectTypeOf(card.name).toEqualTypeOf<string>();
          expectTypeOf(card.identity).toEqualTypeOf<string>();
          expect(card.name).toBe('Draft');
          await card.update({ name: 'Published' });
          expect(card.name).toBe('Published');
          expect(card.revision).toBe('2');
          return { name: card.name, revision: card.revision };
        });
      },
    );

    expect(result).toEqual({ name: 'Published', revision: '2' });
    expect(calls).toEqual(['get', 'get', 'patch']);
    const lowered = await withApplicationNativeModelTransactionRuntime(
      {
        async edit(request) {
          expect(request.model).toBe('Card');
          expect(request.identity).toBe('card-1');
          const target = {
            ...value,
            identity: value.id,
            value,
            revision: value.revision,
            async update() {},
            async delete() {},
          };
          // typecast: this test runtime receives the Card-bound request and supplies that exact fixture shape.
          return request.handler(target as never);
        },
      },
      () => Card.edit('card-1', async card => ({
        id: card.identity,
        name: card.name,
      })),
    );
    expect(lowered).toEqual({ id: 'card-1', name: 'Published' });
    await expect(Card.edit('card-1', async () => undefined)).rejects.toThrow(
      /not available in this managed transaction/,
    );
  });

  test('singularizes database schema keys without corrupting common es plurals', () => {
    const engagementBatches = relationalModel('engagement_batches', {
      id: text('id').primaryKey(),
      revision: text('revision').notNull(),
    });
    const searchIndexes = relationalModel('search_indexes', {
      id: text('id').primaryKey(),
      revision: text('revision').notNull(),
    });
    const application = app('auto-model-names');
    application.database.postgres('application', {
      schema: { engagementBatches, searchIndexes },
    });

    const names = applicationGraphFor(application.composition)?.nodes
      .filter((node) => node.kind === 'model')
      .map((node) => node.name)
      .sort();
    expect(names).toEqual(['EngagementBatch', 'SearchIndex']);
  });

  test('stages direct event and model-operation calls in the ambient transaction', async () => {
    const records = pgTable('ambient_effect_records', {
      id: text('id').primaryKey(),
      message: text('message').notNull(),
      revision: text('revision').notNull(),
    });
    const application = app('ambient-effects');
    const Database = application.database.postgres('ambient', {
      schema: { records },
    });
    const RecordModel = application.model(records, {
      name: 'AmbientRecord',
      database: Database,
    });
    const RecordChanged = event('ambient-record.changed.v1', {
      payload: type({ id: 'string' }),
    });
    const effects: Array<{ effect: 'event' | 'command'; contract: string }> = [];

    const staged = withApplicationManagedEffects(
      {
        commandId: 'outer-command',
        routingContext: {},
        emit(contract) {
          const id = Reflect.get(contract, 'id') as string;
          effects.push({ effect: 'event', contract: id });
          return {
            kind: 'applicationStagedEffect',
            effect: 'event',
            contract: id,
            sequence: effects.length - 1,
          };
        },
        invoke(operation, _input, route) {
          expect(route('nested-command')).toEqual({
            targetKey: 'record-1',
            idempotencyKey: 'nested-command',
          });
          effects.push({ effect: 'command', contract: String(operation.id) });
          return {
            kind: 'applicationStagedEffect',
            effect: 'command',
            contract: String(operation.id),
            sequence: effects.length - 1,
          };
        },
      },
      () => {
        RecordChanged.emit({ id: 'record-1' });
        return RecordModel.create({
          id: 'record-1',
          message: 'hello',
          revision: 'revision-1',
        });
      },
    );

    expect(effects).toEqual([
      { effect: 'event', contract: 'ambient-record.changed.v1' },
      { effect: 'command', contract: 'AmbientRecord.create' },
    ]);
    expect(() => staged.then()).toThrow(/cannot be awaited before commit/);
  });

  test('derives a defaulted scalar identity from the admitted principal without an undefined command key', () => {
    const accounts = pgTable('principal_accounts', {
      id: text('id').default(authenticatedPrincipalId).primaryKey(),
      handle: text('handle').notNull(),
      revision: text('revision').notNull().default(''),
    });
    const principalApp = app('principal-model', { namespace: 'principal-system' });
    const Database = principalApp.database.postgres('principal', { schema: { accounts }, migrations: { path: './drizzle' } });
    const Account = principalApp.model(accounts, { name: 'Account', database: Database });
    const graph = applicationGraphFor(principalApp.composition);
    const create = graph?.nodes.find((node): node is ApplicationCommandNode => node.kind === 'command' && node.name === 'models.Account.create.v1');
    expect(create?.contract.input.jsonSchema.required).toEqual(['handle']);
    const handler = graph?.nodes.find((node) => node.kind === 'commandHandler' && node.command.nodeId === create?.id);
    expect(handler).toMatchObject({
      key: { kind: 'function', source: expect.stringContaining('context?.principal?.id') },
      missing: 'initialize',
    });
    expect(handler && 'initializeSource' in handler ? handler.initializeSource : undefined).toContain('targetKey');
    expect(Account.create).toBeTypeOf('function');
  });

  test('derives causal ownership without collapsing the execution actor into the requester', () => {
    const documents = relationalModel('causal_documents', {
      ownerId: field.text('owner_id').default(causalPrincipalId).primaryKey(),
      body: field.text('body').notNull(),
    });
    const causalApp = app('causal-model', { namespace: 'causal-system' });
    const Database = causalApp.database.postgres('causal', {
      schema: { documents },
      migrations: { path: './drizzle' },
    });
    causalApp.model(documents, { name: 'Document', database: Database });
    const graph = applicationGraphFor(causalApp.composition);
    const create = graph?.nodes.find(
      (node): node is ApplicationCommandNode =>
        node.kind === 'command'
        && node.name === 'models.Document.create.v1',
    );
    expect(create?.contract.input.jsonSchema.required).toEqual(['body']);
    const handler = graph?.nodes.find(
      (node) =>
        node.kind === 'commandHandler'
        && node.command.nodeId === create?.id,
    );
    expect(handler).toMatchObject({
      key: {
        kind: 'function',
        source: expect.stringContaining('causalPrincipalId'),
      },
      missing: 'initialize',
    });
    expect(handler && 'initializeSource' in handler
      ? handler.initializeSource
      : undefined).toContain('targetKey');
  });

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
    nativeApplicationModelCommandRegistrar(Card)!(RenameCard, {
      key: ({ cardId }) => cardId,
      history: true,
      events: [CardChanged],
      transaction: { models: [SetModel] },
    }, async (card, input, context) => {
      const updated = await context.update(card, { name: input.name }, { ifRevision: input.expectedRevision });
      context.emit(CardChanged, { cardId: card.id, revision: updated.value.revision ?? input.expectedRevision });
      return { changed: updated.changed, revision: updated.value.revision ?? input.expectedRevision };
    });
    const CatalogImport = catalog.crd(entity('CatalogImport', {
      spec: type({ setId: SetModel.ref(), sourceUrl: 'string' }),
      status: type({ phase: "'Pending' | 'Completed'" }),
    }), { apiVersion: 'catalog.example/v1alpha1' });
    const PublicCard = Card.schema.select.pick('id', 'setId', 'name');
    const CardsForSet = catalog.query('cards.for-set.v1', {
      input: type({ setId: SetModel.ref() }),
      output: PublicCard.array(),
      database: Database,
      context: [OrganizationId],
      reads: [Card.relations.set as NonNullable<typeof Card.relations.set>],
      authorize: ({ principal, input }) => principal.identity.subject === input.setId,
      run: async ({ context, input }) => {
        const db = context.database(Database);
        return db.select({ id: Card.id, setId: Card.setId, name: Card.name }).from(Card).where(eq(Card.setId, input.setId));
      },
    });
    expect(SetModel).toBe(schema.sets);
    expect(Card).toBe(schema.cards);
    expect(Card.schema.select).toBeTypeOf('function');
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
    expect(graph?.nodes.find((node) => node.kind === 'commandHandler' && node.name === 'Card-cards.rename.v1')).toMatchObject({
      model: { nodeId: 'model.card' },
      effectBoundary: 'transactionSafeOnly',
      transaction: { models: [{ nodeId: 'model.card' }, { nodeId: 'model.set' }] },
    });
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
    const resourceGraph = catalog.composition.toYaml();
    expect(resourceGraph.match(/\n\s+kind: Cluster\b/g)).toHaveLength(1);
    expect(resourceGraph).toContain('database: catalog');
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
    Card.published.public();

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
      authority: expect.objectContaining({ classification: 'public', grantable: false }),
    });
  });

  test('derives a first-class view identity from its named implementation', () => {
    const schema = catalogSchema();
    const catalog = app('function-native-view-fixture');
    const Database = catalog.database.postgres('catalog', { schema });
    const Card = catalog.model(schema.cards, { name: 'Card', database: Database });
    const PublishedCards = Card.view(
      {
        input: type({ limit: 'number.integer >= 1' }),
        output: type({ id: 'string', name: 'string' }).array(),
        database: Database,
        authorize: () => true,
      },
      async function publishedCards() {
        return [];
      },
    );

    expect(PublishedCards.operation).toMatchObject({
      id: 'Card.publishedCards',
      model: 'Card',
      name: 'publishedCards',
      operation: 'query',
    });
    expect(applicationGraphFor(catalog.composition)?.nodes.find(
      (node) => node.kind === 'query' && node.publicId === 'Card.publishedCards',
    )).toBeDefined();
    expect(() => Card.view({
      input: type({}),
      output: type({}).array(),
      database: Database,
      authorize: () => true,
      run: async () => [],
    })).toThrow(/requires a named implementation/);
  });

  test('declares a distinct function-native one-shot model query', () => {
    const schema = catalogSchema();
    const catalog = app('function-native-query-fixture');
    const Database = catalog.database.postgres('catalog', { schema });
    const Card = catalog.model(schema.cards, { name: 'Card', database: Database });
    const PublishedCards = Card.query(
      {
        input: type({ limit: 'number.integer >= 1' }),
        output: type({ id: 'string', name: 'string' }).array(),
        database: Database,
        authorize: () => true,
        budgets: { timeoutMs: 2_000, maxRows: 100 },
      },
      async function publishedCards(input) {
        return [{ id: String(input.limit), name: 'published' }];
      },
    );

    expect(PublishedCards.operation).toMatchObject({
      id: 'Card.publishedCards',
      model: 'Card',
      name: 'publishedCards',
      operation: 'query',
    });
    expect(applicationGraphFor(catalog.composition)?.nodes.find(
      (node) => node.kind === 'query' && node.publicId === 'Card.publishedCards',
    )).toMatchObject({
      modelOperation: {
        model: { nodeId: 'model.card' },
        name: 'publishedCards',
        kind: 'query',
      },
      budgets: { timeoutMs: 2_000, maxRows: 100 },
    });
  });

  test('uses compiler-instrumented view identity after bundling removes the function name', () => {
    const schema = catalogSchema();
    const catalog = app('instrumented-function-native-view-fixture');
    const Database = catalog.database.postgres('catalog', { schema });
    const Card = catalog.model(schema.cards, { name: 'Card', database: Database });
    const minified = Object.defineProperty(
      async function (input: { limit: number }) {
        return [{ id: String(input.limit), name: 'card' }];
      },
      'name',
      { value: '' },
    );
    Reflect.set(
      minified,
      Symbol.for('applik8s.applicationCallbackSource'),
      {
        file: '/workspace/models.ts',
        line: 10,
        column: 1,
        name: 'cardsByLimit',
        source: 'async function cardsByLimit(input) { return [{ id: String(input.limit), name: "card" }]; }',
        generated: true,
      },
    );

    const CardsByLimit = Card.view(
      {
        input: type({ limit: 'number.integer >= 1' }),
        output: type({ id: 'string', name: 'string' }).array(),
        database: Database,
        authorize: () => true,
      },
      minified,
    );

    expect(CardsByLimit.operation).toMatchObject({
      id: 'Card.cardsByLimit',
      model: 'Card',
      name: 'cardsByLimit',
      operation: 'query',
    });
  });

  test('keeps compiler-owned custom command registration off the public model surface', () => {
    const schema = catalogSchema();
    const catalog = app('native-command-fixture');
    const Database = catalog.database.postgres('catalog', { schema });
    const BaseCard = catalog.model(schema.cards, { name: 'Card', database: Database });
    const RenameCard = command('cards.rename.v1', {
      input: type({ cardId: 'string', name: 'string' }),
      output: type({ changed: 'boolean' }),
    });
    nativeApplicationModelCommandRegistrar(BaseCard)!(RenameCard, {
      key: ({ cardId }) => cardId,
    }, async (card, input) => ({ changed: card.value.name !== input.name }));

    expect(Reflect.has(BaseCard, 'command')).toBe(false);
    expect(Reflect.has(BaseCard, 'operation')).toBe(false);
    expect(Reflect.has(BaseCard, 'action')).toBe(false);
    const graph = applicationGraphFor(catalog.composition);
    expect(graph?.nodes.find((node) => node.kind === 'model' && node.name === 'Card')).toMatchObject({
      common: {
        operations: expect.arrayContaining([
          expect.objectContaining({ publicId: 'cards.rename.v1', authorization: 'application-defined' }),
        ]),
      },
    });
    const completed = graph?.nodes.find(
      (node) =>
        node.kind === 'event'
        && node.name === 'models.Card.rename.completed.v1',
    );
    expect(completed).toMatchObject({
      contract: {
        name: 'models.Card.rename.completed',
        version: 'v1',
        payload: {
          jsonSchema: expect.objectContaining({
            required: [
              'current',
              'identity',
              'operation',
              'previous',
              'result',
              'revision',
            ],
          }),
        },
      },
    });
    expect(
      graph?.nodes.find(
        (node) =>
          node.kind === 'commandHandler'
          && node.command.nodeId === 'command.cards.rename.v1',
      ),
    ).toMatchObject({
      completionEvent: { nodeId: completed?.id },
      transaction: {
        outbox: expect.arrayContaining([{ nodeId: completed?.id }]),
      },
    });
  });

  test('derives durable CRUD operations and typed committed lifecycle events directly from the model', () => {
    const schema = catalogSchema();
    const catalog = app('native-create-lifecycle');
    const Database = catalog.database.postgres('catalog', { schema });
    const Card = catalog.model(schema.cards, { name: 'Card', database: Database });
    const Initialized = Card.on.create('initialize-card', {
      processor: { replicas: 1, concurrency: 4 },
      retry: { maxAttempts: 4, initialDelayMs: 100, maxDelayMs: 2_000, deadLetter: true },
      budgets: { timeoutMs: 2_000, maxInputBytes: 32_000 },
    }, async (created) => {
      expectTypeOf(created.operation).toEqualTypeOf<'create'>();
      expectTypeOf(created.identity).toEqualTypeOf<string>();
      expectTypeOf(created.value.name).toEqualTypeOf<string>();
    });
    const Reindexed = Card.on.update('reindex-card', {
      processor: { replicas: 1, concurrency: 4 },
      budgets: { timeoutMs: 2_000, maxInputBytes: 32_000 },
    }, async (updated) => {
      expectTypeOf(updated.operation).toEqualTypeOf<'update'>();
      expectTypeOf(updated.identity).toEqualTypeOf<string>();
      expectTypeOf(updated.previous.name).toEqualTypeOf<string>();
      expectTypeOf(updated.current.name).toEqualTypeOf<string>();
    });
    const Removed = Card.on.delete('remove-card-index', {
      processor: { replicas: 1, concurrency: 4 },
      budgets: { timeoutMs: 2_000, maxInputBytes: 32_000 },
    }, async (deleted) => {
      expectTypeOf(deleted.operation).toEqualTypeOf<'delete'>();
      expectTypeOf(deleted.identity).toEqualTypeOf<string>();
      expectTypeOf(deleted.previous.name).toEqualTypeOf<string>();
      expectTypeOf(deleted.tombstone.deleted).toEqualTypeOf<true>();
    });
    const Gateway = catalog.gateway('card-writes', {
      commands: [Card.create, Card.update, Card.delete],
      authorizeCommand: () => true,
    });

    expect(Initialized.kind).toBe('applicationStreamProcessor');
    expect(Reindexed.kind).toBe('applicationStreamProcessor');
    expect(Removed.kind).toBe('applicationStreamProcessor');
    expect(Gateway.commands).toHaveLength(3);
    expect(Gateway.commands[0]).toMatchObject({ command: 'models.Card.create.v1', model: 'Card' });
    expect(Gateway.commands[1]).toMatchObject({ command: 'models.Card.update.v1', model: 'Card' });
    expect(Gateway.commands[2]).toMatchObject({ command: 'models.Card.delete.v1', model: 'Card' });
    expect(Card.create.authority.classification).toBe('application-policy');
    expect(Card.update.authority.classification).toBe('application-policy');
    expect(Card.delete.authority.classification).toBe('application-policy');
    const graph = applicationGraphFor(catalog.composition);
    expect(graph?.nodes.find((node) => node.kind === 'model' && node.name === 'Card')).toMatchObject({
      common: {
        operations: expect.arrayContaining([
          expect.objectContaining({
            name: 'create',
            publicId: 'models.Card.create.v1',
            authority: expect.objectContaining({ classification: 'application-policy' }),
          }),
        ]),
      },
    });
    expect(graph?.nodes.find((node) => node.kind === 'command' && node.name === 'models.Card.create.v1')).toBeDefined();
    expect(graph?.nodes.find((node) => node.kind === 'event' && node.name === 'models.Card.created.v1')).toBeDefined();
    expect(graph?.nodes.find((node) => node.kind === 'event' && node.name === 'models.Card.updated.v1')).toBeDefined();
    expect(graph?.nodes.find((node) => node.kind === 'event' && node.name === 'models.Card.deleted.v1')).toBeDefined();
    expect(graph?.nodes.find((node) => node.kind === 'stream' && node.name === 'models.Card.created')).toBeDefined();
    expect(graph?.nodes.find((node) => node.kind === 'streamProcessor' && node.name === 'initialize-card')).toMatchObject({
      source: { nodeId: 'stream.models.card.created.v1' },
    });
    expect(graph?.nodes.find((node) => node.kind === 'streamProcessor' && node.name === 'reindex-card')).toMatchObject({
      source: { nodeId: 'stream.models.card.updated.v1' },
    });
    expect(graph?.nodes.find((node) => node.kind === 'streamProcessor' && node.name === 'remove-card-index')).toMatchObject({
      source: { nodeId: 'stream.models.card.deleted.v1' },
    });
  });

  test('derives lifecycle identity from named handlers without author-supplied strings', () => {
    const schema = catalogSchema();
    const catalog = app('function-native-lifecycle');
    const Database = catalog.database.postgres('catalog', { schema });
    const Card = catalog.model(schema.cards, { name: 'Card', database: Database });

    async function initializeCard(created: ApplicationModelCreateEvent<typeof Card.$inferSelect>) {
      void created.value.name;
    }

    const Initialized = Card.on.create({
      processor: { replicas: 1, concurrency: 1 },
    }, initializeCard);

    expect(Initialized.name).toBe('initialize-card-create');
    expect(applicationGraphFor(catalog.composition)?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'streamProcessor.initialize-card-create',
        kind: 'streamProcessor',
        name: 'initialize-card-create',
      }),
    ]));
  });

  test('attaches transaction-authoritative policy to direct CRUD without creating a parallel action', () => {
    const schema = catalogSchema();
    const notifications = pgTable('notifications', {
      id: uuid('id').primaryKey(),
      cardId: uuid('card_id').notNull(),
      message: text('message').notNull(),
      revision: text('revision').notNull(),
    });
    const catalog = app('native-create-policy');
    const Database = catalog.database.postgres('catalog', { schema: { ...schema, notifications } });
    const SetModel = catalog.model(schema.sets, { name: 'Set', database: Database });
    const Card = catalog.model(schema.cards, { name: 'Card', database: Database });
    const Notification = catalog.model(notifications, { name: 'Notification', database: Database });
    const CreateNotification = Notification.create;
    const CardAccepted = event('cards.accepted.v1', { payload: type({ cardId: 'string', setId: 'string' }) });

    Card.create.beforeCommit({
      events: [CardAccepted],
      transaction: { models: [Card, SetModel], commands: [CreateNotification] },
      history: true,
    }, async (card, input, context) => {
      const _typedName: string = card.value.name;
      const _typedSetId: string = input.setId;
      void _typedName;
      void _typedSetId;
      const set = await context.models.Set?.get({ id: input.setId });
      if (!set) throw new Error('A card requires an existing set.');
      await context.models.Card?.get({ id: input.id });
      await context.models.Card?.query({ where: { setId: input.setId }, limit: 25 });
      context.emit(CardAccepted, { cardId: input.id, setId: input.setId });
      context.send(CreateNotification, {
        id: context.id('notification'),
        cardId: input.id,
        message: `Card ${input.name} was accepted`,
        revision: context.id('notification-revision'),
      }, { targetKey: input.id });
    });

    const graph = applicationGraphFor(catalog.composition);
    const handler = graph?.nodes.find((node) => node.kind === 'commandHandler' && node.name === 'Card-models.Card.create.v1');
    expect(handler).toMatchObject({
      transaction: {
        models: [{ nodeId: 'model.card' }, { nodeId: 'model.set' }],
        selfRead: true,
        outbox: [{ nodeId: 'event.cards.accepted.v1' }, { nodeId: 'event.models.card.created.v1' }],
        commands: [{ nodeId: 'command.models.notification.create.v1' }],
      },
      eventBindings: [
        {
          identifier: 'CardAccepted',
          event: { nodeId: 'event.cards.accepted.v1' },
        },
        {
          identifier: 'ModelCreated',
          event: { nodeId: 'event.models.card.created.v1' },
        },
      ],
      commandBindings: [{ identifier: 'CreateNotification', command: { nodeId: 'command.models.notification.create.v1' } }],
    });
    expect(handler && handler.kind === 'commandHandler' ? handler.handlerSource : '').toContain('__applik8sBeforeCommit');
    expect(handler && handler.kind === 'commandHandler' ? handler.handlerSource : '').toContain('__applik8sRunBeforeCommit');
    expect(handler && handler.kind === 'commandHandler' ? handler.beforeCommit?.source : '').toContain('CardAccepted');
    expect(graph?.nodes.find((node) => node.kind === 'command' && node.name === 'models.Card.create.v1')).toMatchObject({
      contract: {
        errors: [
          {
            name: 'policyRejected',
            schema: expect.objectContaining({
              jsonSchema: expect.objectContaining({
                required: ['message'],
              }),
            }),
          },
        ],
      },
    });
    expect(graph?.nodes.filter((node) => node.kind === 'commandHandler' && node.name === 'Card-models.Card.create.v1')).toHaveLength(1);
    expect(graph?.nodes.find((node) => node.kind === 'model' && node.name === 'Card')).toMatchObject({
      common: { operations: expect.arrayContaining([expect.objectContaining({ name: 'create', operation: 'create' })]) },
    });
    expect(() => Card.create.beforeCommit({}, async () => undefined)).toThrow('may be declared only once');
  });

  test('rejects an awaited staged command during application discovery with the lint-safe remedy', () => {
    const parents = pgTable('awaited_command_parents', {
      id: text('id').primaryKey(),
      revision: text('revision').notNull(),
    });
    const children = pgTable('awaited_command_children', {
      id: text('id').primaryKey(),
      parentId: text('parent_id').notNull(),
      revision: text('revision').notNull(),
    });
    const application = app('awaited-staged-command');
    const Database = application.database.postgres('awaited', {
      schema: { parents, children },
    });
    const Parent = application.model(parents, {
      name: 'AwaitedParent',
      database: Database,
    });
    const Child = application.model(children, {
      name: 'AwaitedChild',
      database: Database,
    });
    const CreateChild = Child.create;

    expect(() =>
      Parent.create.beforeCommit(
        {
          history: true,
          __generatedCalls: [CreateChild],
          __generatedModelBindings: { CreateChild },
          __generatedAwaitedCalls: { CreateChild },
        },
        async () => undefined,
      )).toThrow(
      'beforeCommit cannot await staged application command models.AwaitedChild.create.v1 through CreateChild(...)',
    );
  });

  test('binds CRUD and lifecycle behavior through the symbol API when native columns collide', () => {
    const records = pgTable('colliding_application_records', {
      id: uuid('id').primaryKey(),
      create: text('create').notNull(),
      on: text('on').notNull(),
      revision: text('revision').notNull(),
    });
    const application = app('native-collision-fixture');
    const Database = application.database.postgres('catalog', { schema: { records } });
    const RecordModel = application.model(records, { name: 'RecordModel', database: Database });
    const modelApi = RecordModel[applicationModelFacet].api;
    const processor = modelApi.on.create('initialize-colliding-record', {}, async (created) => {
      void created.value.create;
      void created.value.on;
    });
    const Gateway = application.gateway('colliding-record-writes', {
      commands: [modelApi.create, modelApi.update, modelApi.delete],
      authorizeCommand: () => true,
    });

    expect(RecordModel.create).toBe(records.create);
    expect(RecordModel.on).toBe(records.on);
    expect(processor.kind).toBe('applicationStreamProcessor');
    expect(Gateway.commands.map((binding) => binding.command)).toEqual([
      'models.RecordModel.create.v1',
      'models.RecordModel.update.v1',
      'models.RecordModel.delete.v1',
    ]);
    expect(applicationGraphFor(application.composition)?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'streamProcessor.initialize-colliding-record' }),
      expect.objectContaining({ id: 'command.models.record-model.create.v1' }),
    ]));
  });

  test('materializes direct typed Kubernetes create, update, and delete handlers as app-owned operators', () => {
    const catalog = app('native-kubernetes-lifecycle', { namespace: 'catalog-system' });
    const Policy = catalog.crd(entity('ModerationPolicy', {
      spec: type({ maxRisk: 'number', blockedTerms: 'string[]' }),
      status: type({ 'phase?': "'Ready' | 'Invalid'" }),
    }), { apiVersion: 'catalog.example/v1alpha1' });

    type PolicyScope = ModelEvent<typeof Policy, 'create'>;

    async function initializePolicy(policy: PolicyScope) {
      expectTypeOf(policy.spec.maxRisk).toEqualTypeOf<number>();
      policy.status.phase = policy.spec.maxRisk <= 1 ? 'Ready' : 'Invalid';
    }
    async function reapplyPolicy(policy: PolicyScope) {
      expectTypeOf(policy.spec.blockedTerms).toEqualTypeOf<string[]>();
      policy.status.phase = policy.spec.maxRisk >= 0 ? 'Ready' : 'Invalid';
    }
    async function removePolicy(policy: PolicyScope) {
      expectTypeOf(policy.metadata.name).toEqualTypeOf<string>();
    }

    const initialized = Policy.on.create({ namespace: 'catalog-system' }, initializePolicy);
    const reapplied = Policy.on.update({ namespace: 'catalog-system' }, reapplyPolicy);
    const removed = Policy.on.delete({ namespace: 'catalog-system' }, removePolicy);

    expect(initialized.operatorName).toBe('initialize-policy-create');
    expect(reapplied.operatorName).toBe('reapply-policy-update');
    expect(removed.operatorName).toBe('remove-policy-delete');
    expect(applicationGraphFor(catalog.composition)?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'operator.initialize-policy-create', kind: 'operator', name: 'initialize-policy-create' }),
      expect.objectContaining({ id: 'operator.reapply-policy-update', kind: 'operator', name: 'reapply-policy-update' }),
      expect.objectContaining({ id: 'operator.remove-policy-delete', kind: 'operator', name: 'remove-policy-delete' }),
    ]));
  });

  test('preserves an installation-derived namespace for Kubernetes query execution and RBAC lowering', () => {
    const catalog = app('native-kubernetes-query', {
      controlPlaneNamespace: 'catalog-control',
      apiVersion: 'applications.catalog.example/v1alpha1',
      kind: 'CatalogInstallation',
      spec: type({ name: 'string' }),
      status: type({ ready: 'boolean' }),
      namespace: (spec) => spec.name,
    });
    const Policy = catalog.crd(entity('ModerationPolicy', {
      spec: type({ maxRisk: 'number' }),
      status: type({ 'phase?': "'Ready' | 'Invalid'" }),
    }), {
      apiVersion: 'catalog.example/v1alpha1',
      create: {
        authorize: ({ input, context }) => {
          expectTypeOf(input.maxRisk).toEqualTypeOf<number>();
          expectTypeOf(context).toEqualTypeOf<Readonly<Record<string, JsonValue>>>();
          return input.maxRisk >= 0;
        },
        place: ({ input, context }) => {
          expectTypeOf(input.maxRisk).toEqualTypeOf<number>();
          expectTypeOf(context).toEqualTypeOf<Readonly<Record<string, JsonValue>>>();
          return { namespace: 'catalog-system' };
        },
      },
    });
    const CurrentPolicy = Policy.view(
      {
        input: type({}),
        output: type({ name: 'string', maxRisk: 'number' }).array(),
        authorize: ({ input, principal }) => {
          expectTypeOf(input).toEqualTypeOf<object>();
          expectTypeOf(principal.id).toEqualTypeOf<string>();
          return true;
        },
        select: {
          namespace: catalog.installation.spec.name,
          fieldSelector: (input) => {
            expectTypeOf(input).toEqualTypeOf<object>();
            return 'metadata.name=default';
          },
          limit: (input) => {
            expectTypeOf(input).toEqualTypeOf<object>();
            return 1;
          },
        },
        budgets: { timeoutMs: 2_000, maxRows: 1, maxResultBytes: 16_000 },
      },
      function current(policy) {
        expectTypeOf(policy.spec.maxRisk).toEqualTypeOf<number>();
        return { name: policy.metadata.name, maxRisk: policy.spec.maxRisk };
      },
    );

    expect(applicationGraphFor(catalog.composition)?.nodes.find((node) => node.kind === 'query' && node.name === 'ModerationPolicy.current')).toMatchObject({
      kubernetes: {
        invocation: 'model-native',
        namespace: '${schema.spec.name}',
        resource: { plural: 'moderationpolicies', scope: 'Namespaced' },
      },
    });
    expect(CurrentPolicy.operation.id).toBe('ModerationPolicy.current');
  });

  test('does not install the retired exceptional-operation registry', () => {
    const schema = catalogSchema();
    const catalog = app('native-action-fixture');
    const Database = catalog.database.postgres('catalog', { schema });
    const Card = catalog.model(schema.cards, { name: 'Card', database: Database });
    expect(Reflect.has(Card, 'operation')).toBe(false);
    expect(Reflect.has(Card, 'action')).toBe(false);
    expect(Reflect.has(Card.on, 'operation')).toBe(false);
    expect(Reflect.has(Card.on, 'action')).toBe(false);
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
