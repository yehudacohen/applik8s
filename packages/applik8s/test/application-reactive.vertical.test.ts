// typecast-file-boundary: reactive vertical fixtures inspect erased graph metadata after checking node identities and discriminators.
import { ApplicationHost, app, applicationGraphFor, Certificate, DnsPublication, event, HttpExposure, IndexStore, AnalyticalDatabase, stream, task, WorkflowEngine } from '@applik8s/applik8s';
import { validateApplicationGraph, validateApplicationGraphCompatibilityPolicy } from '@applik8s/core';
import { type } from 'arktype';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

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
        authenticate: async () => ({ principal: { id: 'guest' }, trustedContext: {}, authorizationVersion: 'v1' }),
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
    expect(graph?.nodes.find((node) => node.kind === 'subscription')).toMatchObject({ delivery: 'sse', suspension: 'bounded-failures' });
    expect(graph?.nodes.find((node) => node.kind === 'projection')).toMatchObject({ rebuildable: true, duplicateHandling: 'idempotent', rebuild: 'full-replay' });
    expect(graph?.nodes.find((node) => node.kind === 'provider' && node.interface === 'AnalyticalDatabase')).toMatchObject({ implementation: 'clickhouse' });
    expect(validateApplicationGraph(graph)).toEqual([]);
    expect(validateApplicationGraphCompatibilityPolicy(graph)).toEqual([]);
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
    expect(balances.map({ accountId: 'a', balance: 2, revision: 'r1' }, { id: 'e1', recordedAt: '2026-07-19T00:00:00Z', partitionKey: 'a' })).toEqual({ accountId: 'a', balance: 2, revision: 'r1' });
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
    await expect(changes.authorize({ id: 'principal-1' }, 'replay')).resolves.toBe(true);
  });

  it('injects provider-neutral recurring schedule targets into bounded stream processors', () => {
    const automation = app('automation-schedule-fixture', { namespace: 'automation-system' });
    automation.provide(WorkflowEngine, WorkflowEngine.hatchet({
      namespace: 'automation-system',
      workerTokenSecret: { apiVersion: 'v1', kind: 'Secret', name: 'automation-worker-token', namespace: 'automation-system' },
    }));
    const database = automation.database.postgres('automation', { schema: {} });
    const Execute = task('automation.execute.v1', {
      input: type({ automationId: 'string' }),
      output: type({ accepted: 'boolean' }),
    });
    const execute = automation.task(Execute, {}, async () => ({ accepted: true }));
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
        target: { nodeId: 'task.automation.execute.v1' },
        contract: { name: 'automation.execute', version: 'v1', input: expect.objectContaining({ jsonSchema: expect.any(Object) }) },
      }],
      workflowEngine: { interface: 'WorkflowEngine', nodeId: 'provider.workflow-engine' },
    });
    expect(graph?.edges).toContainEqual({ from: { nodeId: 'streamProcessor.reconcile-schedules' }, to: { nodeId: 'task.automation.execute.v1' }, relationship: 'dependsOn' });
    if (!graph) throw new Error('Expected recurring schedule graph.');
    expect(validateApplicationGraph(graph)).toEqual([]);
  });

	it('injects typed one-shot durable tasks into bounded stream processors', () => {
		const application = app('stream-task-fixture', { namespace: 'stream-task-system' });
		application.provide(WorkflowEngine, WorkflowEngine.hatchet({ namespace: 'stream-task-system' }));
		const database = application.database.postgres('stream-task', { schema: {} });
		const Inspect = task('media.inspect.v1', {
			input: type({ objectKey: 'string' }),
			output: type({ state: "'ready' | 'rejected'" }),
		});
		const inspect = application.task(Inspect, {}, async () => ({ state: 'ready' }));
		const Uploaded = event('media.uploaded.v1', { payload: type({ objectKey: 'string' }) });
		const uploaded = application.stream(Uploaded, {
			database,
			retention: { maxAgeSeconds: 86_400 },
			partitionBy: ({ objectKey }) => objectKey,
			authorize: () => false,
		});
		uploaded.process('inspect-media', { tasks: { inspect } }, async (value, context) => {
			const result = await context.tasks.inspect({ objectKey: value.objectKey }, { correlationId: context.event.id });
			if (result.state !== 'ready') throw new Error('media inspection rejected');
		});

		const graph = applicationGraphFor(application.composition);
		expect(graph?.nodes.find((node) => node.kind === 'streamProcessor' && node.name === 'inspect-media')).toMatchObject({
			tasks: [{
				alias: 'inspect', target: { nodeId: 'task.media.inspect.v1' },
				contract: { name: 'media.inspect', version: 'v1', input: expect.any(Object), output: expect.any(Object) },
			}],
			workflowEngine: { interface: 'WorkflowEngine', nodeId: 'provider.workflow-engine' },
		});
		expect(graph?.edges).toContainEqual({ from: { nodeId: 'streamProcessor.inspect-media' }, to: { nodeId: 'task.media.inspect.v1' }, relationship: 'dependsOn' });
		if (!graph) throw new Error('Expected stream task graph.');
		expect(validateApplicationGraph(graph)).toEqual([]);
	});
});
