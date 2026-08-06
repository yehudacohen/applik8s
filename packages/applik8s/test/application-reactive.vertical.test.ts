// typecast-file-boundary: reactive vertical fixtures inspect erased graph metadata after checking node identities and discriminators.
import { AnalyticalDatabase, ApplicationHost, app, applicationGraphFor, Certificate, DnsPublication, event, HttpExposure, IdentityProvider, IndexStore, stream, WorkflowEngine, workflow } from '@applik8s/applik8s';
import { validateApplicationGraph, validateApplicationGraphCompatibilityPolicy } from '@applik8s/core';
import { type } from 'arktype';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { testApplicationAdmission } from '../../../test-support/application-principal.js';

const AccountChanged = stream('accounts.changed.v1', {
  payload: type({ accountId: 'string', balance: 'number', revision: 'string' }),
});

describe('v0.6 streams, subscriptions, and projections', () => {
  it('binds an immutable Kubernetes application host with hydrateable service facts', () => {
    const guestbook = app('hosted-guestbook', { namespace: 'guestbook' });
    const host = guestbook.provide(ApplicationHost, ApplicationHost.kubernetes({ replicas: 2, port: 3000 }));
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
      implementation: 'kubernetes-application-host',
      config: { host: { kind: 'kubernetes-application-host', replicas: 2, port: 3000 } },
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
