// typecast-file-boundary: reactive vertical fixtures inspect erased graph metadata after checking node identities and discriminators.
import { AnalyticalDatabase, ApplicationHost, actor, app, applicationGraphFor, Certificate, DnsPublication, defineApplicationProvider, event, HttpExposure, IdentityProvider, IndexStore, stream, WorkflowEngine, workflow } from '@applik8s/applik8s';
import { bindApplicationCallableDependencies } from '@applik8s/applik8s/provider-extension-runtime';
import { validateApplicationGraph, validateApplicationGraphCompatibilityPolicy, withDerivedApplicationGraphFoundation } from '@applik8s/core';
import { type } from 'arktype';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { testApplicationAdmission } from '../../../test-support/application-principal.js';
import { expandApplicationCallbackDependencies } from '../src/application-callback.js';

const AccountChanged = stream('accounts.changed.v1', {
  payload: type({ accountId: 'string', balance: 'number', revision: 'string' }),
});

describe('v0.6 streams, subscriptions, and projections', () => {
  it('reuses a model lifecycle stream when the same fact enters the event catalog', () => {
    const records = pgTable('catalog_lifecycle_records', {
      id: text('id').primaryKey(),
      revision: text('revision').notNull(),
    });
    const application = app('catalog-lifecycle-reuse');
    const database = application.database.postgres('catalog', { schema: { records } });
    const Record = application.model(records, { name: 'Record', database });

    Record.on.create(
      'observe-record-create',
      { processor: { replicas: 1, concurrency: 1 } },
      async function observeRecordCreate(created) {
        void created.identity;
      },
    );
    application.events.from(Record);

    const lifecycleStreams = applicationGraphFor(application.composition)?.nodes.filter(
      (node) => node.kind === 'stream' && node.name === 'models.Record.created',
    );
    expect(lifecycleStreams).toHaveLength(1);
    expect(applicationGraphFor(application.composition)?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'streamProcessor',
        name: 'observe-record-create',
        source: { nodeId: 'stream.models.record.created.v1' },
      }),
      expect.objectContaining({
        kind: 'stream',
        catalog: expect.objectContaining({ selection: 'from' }),
      }),
    ]));
  });

  it('builds a revision-pinned event catalog over explicit and model lifecycle facts', () => {
    const posts = pgTable('catalog_posts', {
      id: text('id').primaryKey(),
      state: text('state').notNull(),
      revision: text('revision').notNull(),
    });
    const PostPublished = event('posts.published.v1', {
      payload: type({ postId: 'string', state: "'published'" }),
    });
    const application = app('event-catalog');
    const database = application.database.postgres('catalog', { schema: { posts } });
    const Post = application.model(posts, { name: 'Post', database });

    application.events
      .of(PostPublished, Post.events.updated)
      .where((fact) => fact.contract.id !== '')
      .onEvent(async function auditApplicationFact(fact) {
        void fact.contract.id;
        void fact.detail;
      });

    const graph = applicationGraphFor(application.composition);
    if (!graph) throw new Error('Expected event-catalog application graph.');
    const selection = graph.nodes.find(
      (node) => node.kind === 'stream' && node.catalog?.selection === 'of' && node.catalog.predicateSource,
    );
    expect(selection?.kind).toBe('stream');
    if (selection?.kind !== 'stream' || !selection.catalog) throw new Error('Expected filtered event-catalog selection.');
    expect(selection.catalog.lowering).toBe('postgres-native-filter');
    expect(selection.catalog.sources.map((source) => ({
      contractId: source.contract.id,
      producer: source.producer,
    }))).toEqual([
      { contractId: 'models.Post.updated.v1', producer: { kind: 'model', id: 'Post' } },
      { contractId: 'posts.published.v1', producer: { kind: 'event', id: 'posts.published.v1' } },
    ]);
    expect(graph.nodes.some((node) => node.kind === 'stream' && node.name === 'models.Post.updated')).toBe(true);
    expect(graph.nodes.some((node) => node.kind === 'stream' && node.name === 'posts.published')).toBe(true);
    expect(graph.nodes.some((node) => node.kind === 'streamProcessor'
      && node.name === 'audit-application-fact'
      && node.source.nodeId === selection.id)).toBe(true);
    expect(graph.edges.some((edge) => edge.from.nodeId === selection.id && edge.relationship === 'reads')).toBe(true);
    expect(validateApplicationGraph(graph)).toEqual([]);

    const malformed = {
      ...graph,
      nodes: graph.nodes.map((node) => node.id === selection.id && node.kind === 'stream' && node.catalog
        ? {
            ...node,
            catalog: {
              ...node.catalog,
              sources: node.catalog.sources.map((source, index) => index === 0
                ? { ...source, contract: { ...source.contract, version: 'v999' } }
                : source),
            },
          }
        : node),
    };
    const malformedSelection = malformed.nodes.find((node) => node.id === selection?.id);
    if (malformedSelection?.kind !== 'stream' || !malformedSelection.catalog) throw new Error('Expected catalog selection fixture.');
    const malformedContract = malformedSelection.catalog.sources[0];
    if (!malformedContract) throw new Error('Expected malformed catalog contract fixture.');
    expect(validateApplicationGraph(malformed).map((diagnostic) => diagnostic.message)).toContain(
      `Application event-catalog stream ${selection.id} source ${malformedContract.contract.id} must reference the exact pinned physical stream contract.`,
    );

    const malformedSource = {
      ...graph,
      nodes: graph.nodes.map((node) => node.id === selection.id && node.kind === 'stream' && node.catalog
        ? {
            ...node,
            catalog: {
              ...node.catalog,
              sources: [{} as never, ...node.catalog.sources.slice(1)],
            },
          }
        : node),
    };
    expect(validateApplicationGraph(malformedSource).map((diagnostic) => diagnostic.message)).toContain(
      `Application event-catalog stream ${selection.id} contains a malformed source contract.`,
    );
  });

  it('binds an immutable Kubernetes application host with hydrateable service facts', () => {
    const guestbook = app('hosted-guestbook', { namespace: 'guestbook' });
    const host = guestbook.provide(ApplicationHost, ApplicationHost.managed({ replicas: 2, port: 3000 }));
    const exposure = guestbook.expose('web', {
      service: host,
      hostnames: ['guestbook.localhost'],
      tls: { mode: 'disabled' },
      dns: { mode: 'disabled' },
    });
    expect(host).toMatchObject({
      kind: 'applicationHost',
      service: { name: 'hosted-guestbook-web', namespace: 'guestbook', port: 3000 },
      status: { state: 'pendingBuild', ready: false },
      image: { state: 'pendingBuild' },
      url: { internal: 'http://hosted-guestbook-web.guestbook.svc:3000' },
    });
    expect(exposure).toMatchObject({ publicUrl: 'http://guestbook.localhost', resourceName: 'web-ingress' });
    const graph = applicationGraphFor(guestbook.composition);
    expect(graph?.nodes.find((node) => node.kind === 'provider' && node.interface === 'ApplicationHost')).toMatchObject({
      implementation: 'managed-application-host',
      config: { host: { kind: 'managed-application-host', replicas: 2, port: 3000 } },
    });
  });

  it('declares a bounded local NodePort without pretending it terminates TLS or manages DNS', () => {
    const guestbook = app('local-guestbook', { namespace: 'guestbook' });
    guestbook.provide(HttpExposure, HttpExposure.nodePort({ host: '127.0.0.1', nodePort: 30_080 }));
    const host = guestbook.provide(ApplicationHost, ApplicationHost.kubernetes({ port: 3000 }));
    const exposure = guestbook.expose('web', { service: host, hostnames: ['guestbook.localhost'] });

    expect(exposure).toMatchObject({
      publicUrl: 'http://127.0.0.1:30080',
      resourceName: 'web-node-port',
      readiness: { ingress: 'notRequested', service: 'resourceApplied', loadBalancer: 'notRequested' },
    });
    expect(applicationGraphFor(guestbook.composition)?.nodes.find((node) => node.kind === 'exposure')).toMatchObject({
      transport: { kind: 'node-port', host: '127.0.0.1', nodePort: 30_080 },
      generatedResources: [expect.objectContaining({
        resource: { apiVersion: 'v1', kind: 'Service', name: 'web-node-port', namespace: 'guestbook' },
      })],
    });
    expect(guestbook.composition.resources).toContainEqual(expect.objectContaining({
      kind: 'Service',
      metadata: expect.objectContaining({
        name: 'web-node-port',
        annotations: { 'applik8s.dev/public-url': 'http://127.0.0.1:30080' },
      }),
      spec: expect.objectContaining({ type: 'NodePort', ports: [expect.objectContaining({ nodePort: 30_080 })] }),
    }));
    expect(guestbook.composition.factory('kro').toYaml()).not.toMatch(/includeWhen:\s*\n\s*-\s*["']?true/);
    expect(() => guestbook.expose('secure', { service: host, tls: { mode: 'managed' } })).toThrow(/cannot terminate TLS/);
  });

  it('exposes a generated query gateway through managed HTTPS without manually reconstructing its Service', () => {
    const entries = pgTable('guestbook_entries', {
      id: text('id').primaryKey(),
      message: text('message').notNull(),
      revision: text('revision').notNull(),
    });
    const guestbook = app('reactive-guestbook', { namespace: 'guestbook' });
    guestbook.provide(
      IdentityProvider,
      IdentityProvider.deterministic({
        mode: 'starter',
        application: 'reactive-guestbook',
        subject: 'guest',
        audience: ['reactive-guestbook'],
        catalogRevision: 'catalog-v1',
        authorityRevision: 'v1',
      }),
    );
    const database = guestbook.database.postgres('guestbook', { schema: { entries } });
    const Entry = guestbook.model(entries, { name: 'GuestBookEntry', database });
    const published = guestbook.query('guestbook.entries.v1', {
      input: type({}),
      output: Entry.$model.schema.select.array(),
      database,
      reads: [Entry],
      authorize: () => true,
      run: async ({ context }) => context.database(database).select().from(Entry),
    });
    const gateway = guestbook.gateway('public', {
      queries: [published],
      deployment: {
        namespace: 'guestbook',
        port: 8443,
        cursorSecret: { name: 'guestbook-cursor', key: 'secret' },
      },
    });
    guestbook.provide(Certificate, Certificate.certManager({ issuerRef: { name: 'letsencrypt-prod', kind: 'ClusterIssuer' } }));
    guestbook.provide(DnsPublication, DnsPublication.externalDns());
    const exposure = guestbook.expose('public', {
      service: gateway,
      hostnames: ['guestbook.example.com'],
      tls: { mode: 'managed' },
      dns: { mode: 'managed', ttlSeconds: 120 },
    });

    expect(gateway).toMatchObject({ serviceName: 'reactive-guestbook-public', namespace: 'guestbook', port: 8443 });
    const gatewayNode = applicationGraphFor(guestbook.composition)?.nodes.find(
      (node) => node.kind === 'gateway' && node.name === 'public',
    );
    expect(gatewayNode).toMatchObject({
      authenticationSource: expect.stringContaining('"subject":"guest"'),
    });
    expect(gatewayNode).not.toHaveProperty('authenticationUnresolved');
    expect(exposure).toMatchObject({ publicUrl: 'https://guestbook.example.com', tlsIntent: { mode: 'managed', secretName: 'public-tls' } });
    expect(guestbook.composition.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'Ingress', spec: expect.objectContaining({ rules: [expect.objectContaining({ http: { paths: [expect.objectContaining({ backend: { service: { name: 'reactive-guestbook-public', port: { number: 8443 } } } })] } })] }) }),
      expect.objectContaining({ apiVersion: 'cert-manager.io/v1', kind: 'Certificate', spec: expect.objectContaining({ secretName: 'public-tls', issuerRef: expect.objectContaining({ name: 'letsencrypt-prod', kind: 'ClusterIssuer' }) }) }),
    ]));
  });

  it('retains provider captures on query nodes for placement and least-privilege runtime access', () => {
    const records = pgTable('provider_query_records', {
      id: text('id').primaryKey(),
      revision: text('revision').notNull(),
    });
    const application = app('provider-query-captures', {
      spec: type({ profile: "'starter' | 'dedicated'" }),
      status: type({ ready: 'boolean' }),
    });
    const database = application.database.postgres('records', { schema: { records } });
    const Record = application.model(records, { name: 'ProviderQueryRecord', database });
    const AcquisitionProvider = defineApplicationProvider({
      interface: 'QueryAcquisitionProvider',
      version: 'v1alpha1',
      runtime: {
        operations: {
          acquire: {
            module: '@fixture/acquisition/runtime',
            export: 'acquireItem',
            access: {
              kind: 'provider',
              operations: ['connection.use', 'network.connect'],
            },
          },
        },
      },
      accepts: (candidate): candidate is {
        readonly kind: 'query-acquisition';
        acquire(input: { readonly id: string }): Promise<{ readonly value: string }>;
      } => Boolean(
        candidate
          && typeof candidate === 'object'
          && Reflect.get(candidate, 'kind') === 'query-acquisition'
          && typeof Reflect.get(candidate, 'acquire') === 'function',
      ),
    }).named('history');
    application.profile(application.installation.spec, 'profile')
      .provide(AcquisitionProvider)
      .starter(() => ({
        kind: 'query-acquisition' as const,
        async acquire({ id }: { readonly id: string }) {
          return { value: id };
        },
      }))
      .dedicated(() => ({
        kind: 'query-acquisition' as const,
        async acquire({ id }: { readonly id: string }) {
          return { value: `dedicated:${id}` };
        },
      }))
      .exhaustive();
    const acquire = application.inject(AcquisitionProvider).acquire;
    const run = async ({ input }: { readonly input: { readonly id: string } }) => {
      const result = await acquire(input);
      return { value: result.value };
    };
    bindApplicationCallableDependencies(run, [
      { identifier: 'acquire', value: acquire },
    ]);

    application.query('records.acquired.v1', {
      input: type({ id: 'string' }),
      output: type({ value: 'string' }),
      database,
      reads: [Record],
      authorize: () => true,
      run,
    });

    const graph = applicationGraphFor(application.composition);
    if (!graph) throw new Error('Expected provider query graph.');
    const query = graph.nodes.find(
      (node) => node.kind === 'query' && node.name === 'records.acquired',
    );
    // Derive the foundation before matcher traversal. Bun's asymmetric nested
    // matcher currently mutates the inspected array in place.
    const founded = withDerivedApplicationGraphFoundation(graph);
    expect(query).toMatchObject({
      providerBindings: [expect.objectContaining({
        identifier: 'acquire',
        provider: expect.objectContaining({
          interface: 'QueryAcquisitionProvider',
          nodeId: 'provider.query-acquisition-provider.v1alpha1.history',
        }),
        operation: expect.objectContaining({ member: 'acquire' }),
      })],
    });
    expect(graph.edges).toContainEqual({
      from: { nodeId: 'provider.query-acquisition-provider.v1alpha1.history' },
      to: { nodeId: 'query.records.acquired.v1' },
      relationship: 'provides',
    });
    expect(founded.foundation?.runtimeAccess).toEqual(expect.arrayContaining([
      expect.objectContaining({
        consumer: expect.objectContaining({ nodeId: 'query.records.acquired.v1' }),
        target: expect.objectContaining({
          operation: 'network.connect',
          capabilityId: 'provider.query-acquisition-provider.v1alpha1.history',
        }),
      }),
    ]));
  });

  it('fails closed when exposure targets a runtime-only gateway with no generated Service', () => {
    const entries = pgTable('runtime_only_entries', { id: text('id').primaryKey(), revision: text('revision').notNull() });
    const guestbook = app('runtime-only-guestbook');
    const database = guestbook.database.postgres('guestbook', { schema: { entries } });
    const Entry = guestbook.model(entries, { name: 'RuntimeOnlyEntry', database });
    const query = guestbook.query('guestbook.runtime-only.v1', { input: type({}), output: Entry.$model.schema.select.array(), database, reads: [Entry], authorize: () => true, run: async () => [] });
    const gateway = guestbook.gateway('public', { queries: [query] });

    expect(() => guestbook.expose('public', { service: gateway, hostnames: ['guestbook.example.com'] })).toThrow(/runtime-only gateway.*deployment options/);
  });

  it('records explicit replay, delivery, ClickHouse, and rebuild semantics', () => {
    const catalog = app('reactive-catalog', { namespace: 'catalog' });
    const database = catalog.database.postgres('catalog', { schema: {} });
    catalog.defaults({ analytics: AnalyticalDatabase.clickhouse({ name: 'catalog-analytics', provision: false, endpoint: 'http://clickhouse.catalog.svc:8123' }) });
    const changes = catalog.stream(AccountChanged, {
      database,
      retention: { maxAgeSeconds: 604_800, maxMessages: 1_000_000 },
      partitionBy: (payload) => payload.accountId,
      authorize: ({ principal }) => principal.id.length > 0,
    });
    changes.process('account-change-audit', {
      processor: { concurrency: 4 },
      retry: { maxAttempts: 4, initialDelayMs: 10, maxDelayMs: 1_000, deadLetter: true },
      budgets: { timeoutMs: 5_000, maxInputBytes: 16_000 },
    }, async (_payload, context) => { void context.idempotencyKey; });
    changes.subscribe('account-updates', {
      delivery: 'sse',
      authorize: ({ principal }) => principal.id.length > 0,
    });
    changes.project('account-balances', {
      output: type({ eventId: 'string', accountId: 'string', balance: 'number', revision: 'string' }),
      project: (payload, event) => ({ eventId: event.id, ...payload }),
    });

    const graph = applicationGraphFor(catalog.composition);
    expect(graph).toBeDefined();
    if (!graph) throw new Error('Expected reactive ApplicationGraph.');
    expect(graph?.nodes.find((node) => node.kind === 'stream')).toMatchObject({ replay: 'supported', delivery: 'at-least-once', authorization: 'application-defined' });
    expect(graph?.nodes.find((node) => node.kind === 'streamProcessor')).toMatchObject({ delivery: 'at-least-once', checkpoint: 'postgres', failure: 'deadLetter', deployment: { replicas: 1, concurrency: 4 } });
    expect(graph?.nodes.find((node) => node.kind === 'subscription')).toMatchObject({
      delivery: 'sse',
      suspension: 'bounded-failures',
      authority: expect.objectContaining({ classification: 'application-policy' }),
    });
    expect(graph?.nodes.find((node) => node.kind === 'projection')).toMatchObject({ rebuildable: true, duplicateHandling: 'idempotent', rebuild: 'full-replay' });
    expect(graph?.nodes.find((node) => node.kind === 'provider' && node.interface === 'AnalyticalDatabase')).toMatchObject({ implementation: 'clickhouse' });
    expect(validateApplicationGraph(graph)).toEqual([]);
    expect(validateApplicationGraphCompatibilityPolicy(graph)).toEqual([]);
  });

  it('derives processor and projection identities from named callbacks', () => {
    const catalog = app('function-native-reactive');
    const database = catalog.database.postgres('catalog', { schema: {} });
    catalog.defaults({ analytics: AnalyticalDatabase.clickhouse({ name: 'catalog-analytics', provision: false, endpoint: 'http://clickhouse.catalog.svc:8123' }) });
    const changes = catalog.stream(AccountChanged, {
      database,
      retention: { maxAgeSeconds: 3_600 },
      partitionBy: ({ accountId }) => accountId,
      authorize: () => false,
    });
    const processor = changes.onEvent(
      { processor: { concurrency: 2 } },
      async function auditAccountChange(_payload, context) { void context.idempotencyKey; },
    );
    const observer = changes.onEvent(async function observeAccountChange(_payload, context) {
      void context.event.id;
    });
    const projection = changes.project(
      type({ eventId: 'string', accountId: 'string', balance: 'number', revision: 'string' }),
      function accountBalances(payload, output) {
        return output.append({ eventId: output.sourceId, ...payload });
      },
    );

    expect(processor.name).toBe('audit-account-change');
    expect(observer.name).toBe('observe-account-change');
    expect(projection.name).toBe('account-balances');
    expect(projection.storage).toBe('analytical');
    expect(projection.project(
      { accountId: 'account-1', balance: 10, revision: 'revision-1' },
      { id: 'event-1', sequence: 1, recordedAt: '2026-07-31T00:00:00.000Z', partitionKey: 'account-1' },
    )).toEqual([{
      eventId: 'event-1',
      accountId: 'account-1',
      balance: 10,
      revision: 'revision-1',
    }]);
    const graph = applicationGraphFor(catalog.composition);
    expect(graph?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'streamProcessor', name: 'audit-account-change' }),
      expect.objectContaining({ kind: 'streamProcessor', name: 'observe-account-change' }),
    ]));
    expect(() => changes.onEvent(async () => undefined)).toThrow(/cannot infer stable identity/);
    expect(() => changes.process({}, async () => undefined)).toThrow(/cannot infer stable identity/);
    expect(() => changes.project({
      output: type({ eventId: 'string' }),
      project: () => ({ eventId: 'anonymous' }),
    })).toThrow(/cannot infer stable identity/);
  });

  it('infers a function-native model transaction through callback dependencies', () => {
    const posts = pgTable('function_native_posts', {
      id: text('id').primaryKey(),
      accountId: text('account_id').notNull(),
      state: text('state').notNull(),
      revision: text('revision').notNull(),
    });
    const accounts = pgTable('function_native_accounts', {
      id: text('id').primaryKey(),
      revision: text('revision').notNull(),
    });
    const application = app('function-native-model-transaction');
    const database = application.database.postgres('application', {
      schema: { posts, accounts },
    });
    const Post = application.model(posts, { name: 'Post', database });
    const Account = application.model(accounts, { name: 'Account', database });
    const PostRequested = event('posts.requested.v1', {
      payload: type({ postId: 'string' }),
    });
    const PostChanged = event('posts.changed.v1', {
      payload: type({ postId: 'string' }),
    });
    const requests = application.stream(PostRequested, {
      database,
      retention: { maxAgeSeconds: 3_600 },
      partitionBy: ({ postId }) => postId,
      authorize: () => false,
    });

    requests.onEvent(
      {
        // Compiler-owned capture metadata is explicit only because this unit
        // fixture bypasses entrypoint instrumentation.
        __generatedCalls: [Post.edit, Account.require, PostChanged],
        __generatedBindings: {
          PostEdit: Post.edit,
          AccountRequire: Account.require,
          PostChanged,
        },
      },
      async function publishPost(event) {
        return Post.edit(event.postId, async (post) => {
          await Account.require(post.accountId);
          await post.update({ state: 'published' });
          PostChanged.emit({ postId: post.id });
        });
      },
    );

    const graph = applicationGraphFor(application.composition);
    const processor = graph?.nodes.find(
      (node) =>
        node.kind === 'streamProcessor' && node.name === 'publish-post',
    );
    expect(processor).toMatchObject({
      functionNativeTransaction: {
        primaryModel: { nodeId: 'model.post' },
        models: [{ nodeId: 'model.account' }, { nodeId: 'model.post' }],
        modelBindings: [
          {
            identifier: 'AccountRequire',
            model: { nodeId: 'model.account' },
            access: 'read',
          },
          {
            identifier: 'PostEdit',
            model: { nodeId: 'model.post' },
            access: 'write',
          },
        ],
        eventBindings: [
          {
            identifier: 'PostChanged',
            event: { nodeId: 'event.posts.changed.v1' },
          },
        ],
        outbox: [{ nodeId: 'event.posts.changed.v1' }],
        idempotency: 'source-event-id',
      },
    });
    expect(graph?.edges).toEqual(expect.arrayContaining([
      {
        from: { nodeId: 'streamProcessor.publish-post' },
        to: { nodeId: 'model.post' },
        relationship: 'dependsOn',
      },
      {
        from: { nodeId: 'streamProcessor.publish-post' },
        to: { nodeId: 'model.account' },
        relationship: 'dependsOn',
      },
      {
        from: { nodeId: 'streamProcessor.publish-post' },
        to: { nodeId: 'event.posts.changed.v1' },
        relationship: 'emits',
      },
    ]));
    if (!graph) throw new Error('Expected function-native transaction graph.');
    expect(validateApplicationGraph(graph)).toEqual([]);
  });

  it('expands maintained dependency metadata attached directly to a processor handler', () => {
    const records = pgTable('maintained_reactive_records', {
      id: text('id').primaryKey(),
      revision: text('revision').notNull(),
    });
    const receipts = pgTable('maintained_reactive_receipts', {
      id: text('id').primaryKey(),
      revision: text('revision').notNull(),
    });
    const application = app('maintained-reactive-handler');
    const database = application.database.postgres('main', {
      schema: { records, receipts },
    });
    const Record = application.model(records, {
      name: 'Record',
      database,
    });
    const Receipt = application.model(receipts, {
      name: 'Receipt',
      database,
    });
    async function persistReceipt(event: {
      readonly identity: string;
      readonly revision?: string;
    }) {
      await Receipt.create({
        id: event.identity,
        revision: event.revision ?? 'initial',
      });
    }
    bindApplicationCallableDependencies(persistReceipt, [
      { identifier: 'Receipt.create', value: Receipt.create },
    ], { id: 'notifications.request.v1' });
    const expanded = expandApplicationCallbackDependencies({
      bindings: { 'Receipts.persist': persistReceipt },
    });
    expect(expanded.bindings['Receipt.create']).toBe(Receipt.create);
    expect(expanded.callables).toEqual([{
      identifier: 'Receipts.persist',
      runtime: 'notifications.request.v1',
      dependencies: ['Receipt.create'],
    }]);
    Record.on.create(
      {
        processor: { replicas: 1, concurrency: 1 },
        __generatedBindings: { 'Receipts.persist': persistReceipt },
      },
      async function persistReceiptFromEvent(event) {
        await persistReceipt(event);
      },
    );

    const processor = applicationGraphFor(application.composition)?.nodes.find(
      (node) =>
        node.kind === 'streamProcessor'
        && node.operationBindings?.some(
          ({ identifier }) => identifier === 'Receipt.create',
        ),
    );
    expect(processor).toMatchObject({
      callableBindings: [{
        identifier: 'Receipts.persist',
        runtime: 'notifications.request.v1',
        dependencies: ['Receipt.create'],
      }],
      operationBindings: [{
        identifier: 'Receipt.create',
        operation: { model: 'Receipt', operation: 'create' },
        handler: { nodeId: 'command-handler.receipt-models.receipt.create.v1' },
      }],
    });
  });

  it('preserves source-attributed helper paths across recursive callback dependencies', () => {
    const leaf = async () => undefined;
    const nested = async () => leaf();
    const root = async () => nested();
    const declarationSource = Symbol.for('applik8s.applicationCallbackDeclarationSource');
    const dependencies = Symbol.for('applik8s.applicationCallbackDependencies');

    Object.defineProperty(leaf, declarationSource, {
      value: { file: '/workspace/src/model.ts', line: 19, column: 3, name: 'createRecord' },
    });
    Object.defineProperty(nested, declarationSource, {
      value: { file: '/workspace/src/helpers.ts', line: 11, column: 1, name: 'persistRecord' },
    });
    Object.defineProperty(root, declarationSource, {
      value: { file: '/workspace/src/handlers.ts', line: 7, column: 1, name: 'handleRecord' },
    });
    Object.defineProperty(nested, dependencies, {
      value: [{ identifier: 'Record.create', value: leaf, awaited: true, returned: true }],
    });
    Object.defineProperty(root, dependencies, {
      value: [{ identifier: 'persistRecord', value: nested, awaited: true, returned: true }],
    });

    const expanded = expandApplicationCallbackDependencies({
      bindings: { handleRecord: root },
    });

    expect(expanded.bindings['Record.create']).toBe(leaf);
    expect(expanded.provenance).toEqual([
      {
        identifier: 'handleRecord',
        helperPath: ['handleRecord'],
        source: { file: '/workspace/src/handlers.ts', line: 7, column: 1, name: 'handleRecord' },
      },
      {
        identifier: 'persistRecord',
        helperPath: ['handleRecord', 'persistRecord'],
        source: { file: '/workspace/src/helpers.ts', line: 11, column: 1, name: 'persistRecord' },
      },
      {
        identifier: 'Record.create',
        helperPath: ['handleRecord', 'persistRecord', 'Record.create'],
        source: { file: '/workspace/src/model.ts', line: 19, column: 3, name: 'createRecord' },
      },
    ]);
  });

  it('records directly called relational views as bounded processor query dependencies', () => {
    const records = pgTable('processor_view_records', {
      id: text('id').primaryKey(),
      revision: text('revision').notNull(),
    });
    const application = app('processor-view-capture');
    const database = application.database.postgres('main', {
      schema: { records },
    });
    const Record = application.model(records, { name: 'Record', database });
    const RecordExists = Record.view({
      input: type({ id: 'string' }),
      output: type({ exists: 'boolean' }),
      database,
      reads: [Record],
      authorize: ({ principal }) => principal.kind === 'execution',
      budgets: { timeoutMs: 1_000, maxRows: 1, maxResultBytes: 1_024 },
    }, async function recordExists(input) {
      return { exists: input.id.length > 0 };
    });
    Record.on.create({
      processor: { replicas: 1, concurrency: 1 },
      __generatedBindings: { RecordExists },
    }, async function inspectCreatedRecord(event) {
      await RecordExists({ id: event.identity });
    });

    const processor = applicationGraphFor(application.composition)?.nodes.find(
      (node) => node.kind === 'streamProcessor' && node.name === 'inspect-created-record-create',
    );
    expect(processor).toMatchObject({
      queryBindings: [{
        identifier: 'RecordExists',
        query: { nodeId: 'query.Record.recordExists' },
      }],
    });
  });

  it('records exact direct actor members as bounded processor dependencies', () => {
    const records = pgTable('processor_actor_records', {
      id: text('id').primaryKey(),
      revision: text('revision').notNull(),
    });
    const application = app('processor-actor-capture');
    const Workspace = application.actor('workspace.v1', {
      key: type('string'),
      state: type({ count: 'number.integer >= 0' }),
      protocol: {
        observe: actor.message(type({ recordId: 'string' })),
      },
    });
    Workspace.on.initialize(() => ({ count: 0 }));
    Workspace.on.observe(async (turn) => {
      const current = await turn.state();
      await turn.setState({ count: current.count + 1 });
    });
    const database = application.database.postgres('main', {
      schema: { records },
    });
    const Record = application.model(records, { name: 'Record', database });
    Record.on.create({
      processor: { replicas: 1, concurrency: 1 },
      __generatedBindings: { 'Workspace.observe.send': Workspace.observe.send },
    }, async function observeCreatedRecord(event) {
      await Workspace.observe.send(event.identity, { recordId: event.identity });
    });

    const processor = applicationGraphFor(application.composition)?.nodes.find(
      (node) => node.kind === 'streamProcessor' && node.name === 'observe-created-record-create',
    );
    expect(processor).toMatchObject({
      actorBindings: [{
        identifier: 'Workspace.observe.send',
        actor: { nodeId: 'actor.workspace.v1' },
        member: 'observe',
        memberKind: 'message',
      }],
    });
  });

  it('fails discovery when a lifecycle callback does not await a direct model operation', () => {
    const parents = pgTable('unawaited_lifecycle_parents', {
      id: text('id').primaryKey(),
      revision: text('revision').notNull(),
    });
    const children = pgTable('unawaited_lifecycle_children', {
      id: text('id').primaryKey(),
      parentId: text('parent_id').notNull(),
      revision: text('revision').notNull(),
    });
    const application = app('unawaited-lifecycle-operation');
    const database = application.database.postgres('main', {
      schema: { parents, children },
    });
    const Parent = application.model(parents, {
      name: 'UnawaitedParent',
      database,
    });
    const Child = application.model(children, {
      name: 'UnawaitedChild',
      database,
    });
    async function createChild(event: { readonly identity: string }) {
      void Child.create({
        id: event.identity,
        parentId: event.identity,
        revision: event.identity,
      });
    }
    bindApplicationCallableDependencies(createChild, [
      {
        identifier: 'Child.create',
        value: Child.create,
        awaited: false,
      },
    ]);

    expect(() => Parent.on.create(createChild)).toThrow(
      /must await direct model operations \(Child\.create\).*provisional result.*roll back.*context\.send/s,
    );
  });

  it('accepts compiler-recorded awaited model operations in lifecycle callbacks', () => {
    const parents = pgTable('awaited_lifecycle_parents', {
      id: text('id').primaryKey(),
      revision: text('revision').notNull(),
    });
    const children = pgTable('awaited_lifecycle_children', {
      id: text('id').primaryKey(),
      parentId: text('parent_id').notNull(),
      revision: text('revision').notNull(),
    });
    const application = app('awaited-lifecycle-operation');
    const database = application.database.postgres('main', {
      schema: { parents, children },
    });
    const Parent = application.model(parents, {
      name: 'AwaitedParent',
      database,
    });
    const Child = application.model(children, {
      name: 'AwaitedChild',
      database,
    });

    const processor = Parent.on.create(
      {
        __generatedBindings: { 'Child.create': Child.create },
        __generatedAwaitedCalls: { 'Child.create': Child.create },
      },
      async function createChild(event) {
        await Child.create({
          id: event.identity,
          parentId: event.identity,
          revision: event.identity,
        });
      },
    );

    const graphProcessor = applicationGraphFor(application.composition)?.nodes.find(
      (node) => node.kind === 'streamProcessor' && node.name === processor.name,
    );
    expect(graphProcessor).toMatchObject({
      operationBindings: [
        {
          identifier: 'Child.create',
          operation: { model: 'AwaitedChild', operation: 'create' },
        },
      ],
      idempotency: 'source-event-id',
    });
  });

  it('omits unconditional ClickHouse includeWhen literals that KRO cannot parse', () => {
    const catalog = app('clickhouse-conditional-contract', { namespace: 'catalog' });
    const database = catalog.database.postgres('catalog', { schema: {} });
    catalog.defaults({ analytics: AnalyticalDatabase.clickhouse({ name: 'catalog-analytics' }) });
    const changes = catalog.stream(AccountChanged, {
      database,
      retention: { maxAgeSeconds: 604_800 },
      partitionBy: ({ accountId }) => accountId,
      authorize: () => true,
    });
    changes.project('account-balances', {
      output: type({ accountId: 'string', balance: 'number', revision: 'string' }),
      project: (payload) => payload,
    });

    const yaml = catalog.composition.factory('kro').toYaml();
    expect(yaml).toContain('kind: ClickHouseInstallation');
    expect(yaml).not.toMatch(/includeWhen:\s*\n\s*-\s*["']?true/);
  });

  it('declares a generation-scoped online projection through provider-neutral IndexStore semantics', async () => {
    const catalog = app('online-catalog', { namespace: 'catalog' });
    const database = catalog.database.postgres('catalog', { schema: {} });
    catalog.provide(IndexStore, IndexStore.valkey({ name: 'catalog-index', namespace: 'catalog', host: 'valkey.catalog.svc', provision: false }));
    const changes = catalog.stream(AccountChanged, {
      database,
      retention: { maxAgeSeconds: 604_800, maxMessages: 1_000_000 },
      partitionBy: ({ accountId }) => accountId,
      authorize: () => true,
    });
    const balances = changes.project('account-balance-index', {
      store: IndexStore,
      output: type({ accountId: 'string', balance: 'number', revision: 'string' }),
      map: (payload) => payload,
      partitionBy: ({ accountId }) => accountId,
      key: ({ accountId }) => accountId,
      score: ({ balance }) => balance,
      value: ({ accountId, balance, revision }) => ({ accountId, balance, revision }),
      removeWhen: ({ balance }) => balance < 0,
      retention: { maxItemsPerPartition: 1_000 },
      generationScoped: true,
      rebuild: { checkpoint: 'durable' },
    });

    expect(balances).toMatchObject({ storage: 'online', generationScoped: true, provider: { kind: 'valkey', host: 'valkey.catalog.svc' } });
    expect(balances.map({ accountId: 'a', balance: 2, revision: 'r1' }, { id: 'e1', sequence: 1, recordedAt: '2026-07-19T00:00:00Z', partitionKey: 'a' })).toEqual({ accountId: 'a', balance: 2, revision: 'r1' });
    const graph = applicationGraphFor(catalog.composition);
    const projection = graph?.nodes.find((node) => node.kind === 'projection');
    expect(projection).toMatchObject({
      storage: 'online', provider: { interface: 'IndexStore', nodeId: 'provider.index-store' },
      output: { jsonSchema: expect.objectContaining({ type: 'object' }) },
      online: {
        generationScoped: true,
        retention: { maxItemsPerPartition: 1_000, maxPartitions: 100_000 },
        scoreUnit: 'arbitrary',
        rebuild: { checkpoint: 'durable' },
      },
    });
    expect(graph?.providerRequirements).toEqual(expect.arrayContaining([expect.objectContaining({ interface: 'IndexStore', purpose: 'onlineIndex' })]));
    expect(graph ? validateApplicationGraph(graph) : ['missing']).toEqual([]);
  });

  it('lowers a function-native projection into provider-specific online mechanics', () => {
    const catalog = app('function-native-projection', { namespace: 'catalog' });
    const database = catalog.database.postgres('catalog', { schema: {} });
    catalog.provide(IndexStore, IndexStore.valkey({
      name: 'catalog-index',
      namespace: 'catalog',
      host: 'valkey.catalog.svc',
      provision: false,
    }));
    const changes = catalog.stream(AccountChanged, {
      database,
      retention: { maxAgeSeconds: 604_800 },
      partitionBy: ({ accountId }) => accountId,
      authorize: () => true,
    });

    const balances = changes
      .project(
        type({ accountId: 'string', balance: 'number', revision: 'string' }),
        function accountBalanceIndex(payload, write) {
          return payload.balance < 0
            ? write.remove({ partition: payload.accountId, key: payload.accountId })
            : write.upsert({
                partition: payload.accountId,
                key: payload.accountId,
                score: Date.parse(write.recordedAt),
                value: payload,
              });
        },
      )
      .rebuildFromReplay()
      .retain({ maxItemsPerPartition: 1_000, maxAge: '30d' });

    expect(balances.name).toBe('account-balance-index');
    expect(balances.map(
      { accountId: 'a', balance: 2, revision: 'r1' },
      { id: 'event-1', sequence: 7, recordedAt: '2026-07-19T00:00:00Z', partitionKey: 'a' },
    )).toEqual([{
      kind: 'upsert',
      partition: 'a',
      key: 'a',
      score: Date.parse('2026-07-19T00:00:00Z'),
      value: { accountId: 'a', balance: 2, revision: 'r1' },
    }]);
    expect(balances.map(
      { accountId: 'a', balance: -1, revision: 'r2' },
      { id: 'event-2', sequence: 8, recordedAt: '2026-07-19T00:00:01Z', partitionKey: 'a' },
    )).toEqual([{ kind: 'remove', partition: 'a', key: 'a' }]);
    expect(applicationGraphFor(catalog.composition)?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'projection',
        name: 'account-balance-index',
        handlerSource: expect.stringContaining('write.upsert'),
        online: expect.objectContaining({
          scoreUnit: 'epochMilliseconds',
          retention: {
            maxItemsPerPartition: 1_000,
            maxPartitions: 100_000,
            maxAgeSeconds: 2_592_000,
          },
        }),
      }),
    ]));
  });

  it('rejects async and transitively effectful projection transforms at registration', () => {
    const application = app('pure-projection-contract', {
      spec: type({ profile: "'starter' | 'dedicated'" }),
      status: type({ ready: 'boolean' }),
    });
    const database = application.database.postgres('events', { schema: {} });
    const changes = application.stream(AccountChanged, {
      database,
      retention: { maxAgeSeconds: 3_600 },
      partitionBy: ({ accountId }) => accountId,
      authorize: () => true,
    });
    const AcquisitionProvider = defineApplicationProvider({
      interface: 'ProjectionAcquisitionProvider',
      version: 'v1alpha1',
      runtime: {
        operations: {
          acquire: {
            module: '@fixture/acquisition/runtime',
            export: 'acquireItem',
            access: {
              kind: 'provider',
              operations: ['connection.use', 'network.connect'],
            },
          },
        },
      },
      accepts: (candidate): candidate is {
        readonly kind: 'projection-acquisition';
        acquire(input: { readonly id: string }): Promise<{ readonly value: string }>;
      } => Boolean(
        candidate
          && typeof candidate === 'object'
          && Reflect.get(candidate, 'kind') === 'projection-acquisition'
          && typeof Reflect.get(candidate, 'acquire') === 'function',
      ),
    }).named('primary');
    application.profile(application.installation.spec, 'profile')
      .provide(AcquisitionProvider)
      .starter(() => ({
        kind: 'projection-acquisition' as const,
        async acquire({ id }: { readonly id: string }) {
          return { value: id };
        },
      }))
      .dedicated(() => ({
        kind: 'projection-acquisition' as const,
        async acquire({ id }: { readonly id: string }) {
          return { value: `dedicated:${id}` };
        },
      }))
      .exhaustive();
    const provider = application.inject(AcquisitionProvider);
    const acquire = provider.acquire;

    async function acquireThroughHelper(id: string) {
      return acquire({ id });
    }
    bindApplicationCallableDependencies(acquireThroughHelper, [
      { identifier: 'acquire', value: acquire },
    ]);
    function effectfulProjection(
      payload: { readonly accountId: string; readonly balance: number },
      output: { append(value: { readonly accountId: string; readonly balance: number }): unknown },
    ) {
      void acquireThroughHelper(payload.accountId);
      return output.append(payload);
    }
    bindApplicationCallableDependencies(effectfulProjection, [
      { identifier: 'acquireThroughHelper', value: acquireThroughHelper },
    ]);

    expect(() => changes.project(
      type({ accountId: 'string', balance: 'number' }),
      // typecast: adversarial runtime test proves JavaScript consumers fail
      // closed even when they bypass the projection write return signature.
      effectfulProjection as never,
    )).toThrow(/must be a pure source-to-write transformation.*acquire.*ProjectionAcquisitionProvider.*Stream\.onEvent/s);

    async function asynchronousProjection(
      payload: { readonly accountId: string; readonly balance: number },
      output: { append(value: { readonly accountId: string; readonly balance: number }): unknown },
    ) {
      return output.append(payload);
    }
    expect(() => changes.project(
      type({ accountId: 'string', balance: 'number' }),
      // typecast: adversarial runtime test proves JavaScript consumers fail
      // closed even when they bypass the synchronous TypeScript signature.
      asynchronousProjection as never,
    )).toThrow(/must be synchronous and pure.*Stream\.onEvent/s);
  });

  it('uses the broad default Valkey implementation and fails closed on a wrong capability or unsafe bounds', () => {
    const catalog = app('invalid-online-catalog');
    const database = catalog.database.postgres('catalog', { schema: {} });
    const changes = catalog.stream(AccountChanged, { database, retention: { maxAgeSeconds: 60 }, partitionBy: ({ accountId }) => accountId, authorize: () => true });
    const options = {
      store: IndexStore,
      output: type({ accountId: 'string' }),
      map: ({ accountId }: { readonly accountId: string }) => ({ accountId }),
      partitionBy: ({ accountId }: { readonly accountId: string }) => accountId,
      key: ({ accountId }: { readonly accountId: string }) => accountId,
      score: () => 1,
      value: ({ accountId }: { readonly accountId: string }) => ({ accountId }),
      retention: { maxItemsPerPartition: 10 },
      generationScoped: true as const,
    };
    expect(changes.project('default-store', options)).toMatchObject({ storage: 'online', provider: { kind: 'valkey' } });
    expect(() => changes.project('wrong-capability', { ...options, store: { ...IndexStore } })).toThrow(/provider-neutral IndexStore/);
    expect(() => changes.project('invalid-bounds', { ...options, retention: { maxItemsPerPartition: 0 } })).toThrow(/maxItemsPerPartition/);
    expect(() => changes.project('invalid-age-score', { ...options, retention: { maxItemsPerPartition: 10, maxAgeSeconds: 60 } })).toThrow(/scoreUnit/);
  });

  it('promotes a committed event to replay without redeclaring its payload schema', () => {
    const catalog = app('event-replay-catalog');
    const database = catalog.database.postgres('catalog', { schema: {} });
    const PostPublished = event('posts.published.v1', { payload: type({ postId: 'string', authorId: 'string' }) });
    const replay = catalog.stream(PostPublished, {
      database,
      retention: { maxAgeSeconds: 86_400 },
      partitionBy: ({ authorId }) => authorId,
      authorize: () => true,
    });

    expect(replay.definition).toBe(PostPublished);
    expect(applicationGraphFor(catalog.composition)?.nodes.find((node) => node.kind === 'stream')).toMatchObject({
      name: 'posts.published',
      version: 'v1',
    });
  });

  it('validates payloads and fails closed on invalid retention and empty partitions', async () => {
    const catalog = app('reactive-validation');
    const database = catalog.database.postgres('catalog', { schema: {} });
    expect(() => catalog.stream(AccountChanged, { database, retention: { maxAgeSeconds: 0 }, partitionBy: (payload) => payload.accountId, authorize: () => true })).toThrow(/maxAgeSeconds/);
    const changes = catalog.stream(AccountChanged, { database, retention: { maxAgeSeconds: 60 }, partitionBy: () => '', authorize: () => true });
    expect(() => changes.partition({ accountId: 'account-1', balance: 1, revision: 'r1' })).toThrow(/must not be empty/);
    await expect(changes.authorize(testApplicationAdmission('principal-1').principal, 'replay')).resolves.toBe(true);
  });

  it('injects provider-neutral recurring schedule targets into bounded stream processors', () => {
    const automation = app('automation-schedule-fixture', { namespace: 'automation-system' });
    automation.provide(WorkflowEngine, WorkflowEngine.hatchet({
      namespace: 'automation-system',
      workerTokenSecret: { apiVersion: 'v1', kind: 'Secret', name: 'automation-worker-token', namespace: 'automation-system' },
    }));
    const database = automation.database.postgres('automation', { schema: {} });
    const Execute = workflow('automation.execute.v1', {
      input: type({ automationId: 'string' }),
      output: type({ accepted: 'boolean' }),
    });
    const execute = automation.workflow(Execute, { retries: 1 }, async () => ({ accepted: true }));
    const DesiredSchedule = event('automation.schedule-desired.v1', {
      payload: type({ automationId: 'string', expression: 'string', enabled: 'boolean' }),
    });
    const desired = automation.stream(DesiredSchedule, {
      database,
      retention: { maxAgeSeconds: 86_400 },
      partitionBy: ({ automationId }) => automationId,
      authorize: () => false,
    });
    desired.process('reconcile-schedules', {
      enabled: false,
      schedules: { execute },
      budgets: { timeoutMs: 20_000, maxInputBytes: 8_192 },
    }, async (change, context) => {
      await context.schedules.execute.reconcile({
        id: change.automationId,
        expression: change.expression,
        revision: String(context.event.sequence),
        enabled: change.enabled,
        input: { automationId: change.automationId },
      });
    });

    const graph = applicationGraphFor(automation.composition);
    expect(graph?.nodes.find((node) => node.kind === 'streamProcessor' && node.name === 'reconcile-schedules')).toMatchObject({
      enabled: false,
      schedules: [{
        alias: 'execute',
        target: { nodeId: 'workflow.automation.execute.v1' },
        contract: { name: 'automation.execute', version: 'v1', input: expect.objectContaining({ jsonSchema: expect.any(Object) }) },
      }],
      workflowEngine: { interface: 'WorkflowEngine', nodeId: 'provider.workflow-engine' },
    });
    expect(graph?.edges).toContainEqual({ from: { nodeId: 'streamProcessor.reconcile-schedules' }, to: { nodeId: 'workflow.automation.execute.v1' }, relationship: 'dependsOn' });
    if (!graph) throw new Error('Expected recurring schedule graph.');
    expect(validateApplicationGraph(graph)).toEqual([]);
  });

  it('lowers callback-native onBatch into bounded frozen whole-batch delivery', () => {
    const catalog = app('batch-catalog', { namespace: 'catalog' });
    const database = catalog.database.postgres('catalog', { schema: {} });
    const changes = catalog.stream(AccountChanged, {
      database,
      retention: { maxAgeSeconds: 604_800 },
      partitionBy: (payload) => payload.accountId,
      authorize: () => true,
    });

    async function indexAccountChanges(batch: {
      readonly id: string;
      readonly events: readonly { readonly value: { readonly accountId: string } }[];
    }) {
      void batch.id;
      void batch.events.map((event) => event.value.accountId);
    }

    changes.onBatch(
      {
        batch: { maxItems: 500, maxBytes: '4MiB', maxWait: '1s' },
        ordering: 'partition',
        concurrency: 8,
      },
      indexAccountChanges,
    );

    const graph = applicationGraphFor(catalog.composition);
    const processor = graph?.nodes.find(
      (node) => node.kind === 'streamProcessor',
    );
    expect(processor).toMatchObject({
      name: 'index-account-changes',
      invocation: 'batch',
      idempotency: 'frozen-batch-id',
      delivery: 'at-least-once',
      checkpoint: 'postgres',
      deployment: { concurrency: 8, replicas: 1 },
      budgets: { maxInputBytes: 4 * 1_024 * 1_024 },
      batch: {
        maxItems: 500,
        maxBytes: 4 * 1_024 * 1_024,
        maxWaitMs: 1_000,
        ordering: 'partition',
        acknowledgement: 'wholeBatch',
        membership: 'durableFrozenManifest',
      },
    });
    expect(graph ? validateApplicationGraph(graph) : []).toEqual([]);
  });

	it('injects typed one-shot durable tasks into bounded stream processors', () => {
		const application = app('stream-task-fixture', { namespace: 'stream-task-system' });
		application.provide(WorkflowEngine, WorkflowEngine.hatchet({ namespace: 'stream-task-system' }));
		const database = application.database.postgres('stream-task', { schema: {} });
			const Inspect = workflow('media.inspect.v1', {
			input: type({ objectKey: 'string' }),
			output: type({ state: "'ready' | 'rejected'" }),
		});
			const inspect = application.workflow(Inspect, { retries: 1 }, async () => ({ state: 'ready' as const }));
		const Uploaded = event('media.uploaded.v1', { payload: type({ objectKey: 'string' }) });
		const uploaded = application.stream(Uploaded, {
			database,
			retention: { maxAgeSeconds: 86_400 },
			partitionBy: ({ objectKey }) => objectKey,
			authorize: () => false,
		});
			uploaded.process('inspect-media', {
				// Compiler-owned capture metadata is stated explicitly only because
				// this graph-level test bypasses entrypoint instrumentation.
				__generatedCalls: [inspect],
				__generatedBindings: { inspect },
			}, async (value, context) => {
				const result = await inspect({ objectKey: value.objectKey }, { correlationId: context.event.id });
			if (result.state !== 'ready') throw new Error('media inspection rejected');
		});

		const graph = applicationGraphFor(application.composition);
		expect(graph?.nodes.find((node) => node.kind === 'streamProcessor' && node.name === 'inspect-media')).toMatchObject({
			tasks: [{
				alias: 'inspect', target: { nodeId: 'workflow.media.inspect.v1' },
				contract: { name: 'media.inspect', version: 'v1', input: expect.any(Object), output: expect.any(Object) },
			}],
			workflowEngine: { interface: 'WorkflowEngine', nodeId: 'provider.workflow-engine' },
		});
		expect(graph?.edges).toContainEqual({ from: { nodeId: 'streamProcessor.inspect-media' }, to: { nodeId: 'workflow.media.inspect.v1' }, relationship: 'dependsOn' });
		if (!graph) throw new Error('Expected stream task graph.');
		expect(validateApplicationGraph(graph)).toEqual([]);
	});
});
