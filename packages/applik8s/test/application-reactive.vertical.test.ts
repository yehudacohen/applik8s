import { app, ApplicationHost, applicationGraphFor, Certificate, DnsPublication, ProjectionStore, stream } from '@applik8s/applik8s';
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
      status: { ready: false },
      image: { digest: 'sha256:pending-build' },
      url: { internal: 'http://hosted-guestbook-web.guestbook.svc:3000' },
    });
    expect(exposure).toMatchObject({ publicUrl: 'http://guestbook.localhost', resourceName: 'web-ingress' });
    const graph = applicationGraphFor(guestbook.composition);
    expect(graph?.nodes.find((node) => node.kind === 'provider' && node.interface === 'ApplicationHost')).toMatchObject({
      implementation: 'kubernetes-application-host',
      config: { host: { kind: 'kubernetes-application-host', replicas: 2, port: 3000 } },
    });
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
    catalog.defaults({ projections: ProjectionStore.clickhouse({ name: 'catalog-analytics', provision: false, endpoint: 'http://clickhouse.catalog.svc:8123' }) });
    const changes = catalog.stream(AccountChanged, {
      database,
      retention: { maxAgeSeconds: 604_800, maxMessages: 1_000_000 },
      partitionBy: (payload) => payload.accountId,
      authorize: ({ principal }) => principal.id.length > 0,
    });
    catalog.subscription('account-updates', {
      source: changes,
      delivery: 'sse',
      authorize: ({ principal }) => principal.id.length > 0,
    });
    catalog.projection('account-balances', {
      source: changes,
      output: type({ eventId: 'string', accountId: 'string', balance: 'number', revision: 'string' }),
      project: (payload, event) => ({ eventId: event.id, ...payload }),
    });

    const graph = applicationGraphFor(catalog.composition);
    expect(graph).toBeDefined();
    if (!graph) throw new Error('Expected reactive ApplicationGraph.');
    expect(graph?.nodes.find((node) => node.kind === 'stream')).toMatchObject({ replay: 'supported', delivery: 'at-least-once', authorization: 'application-defined' });
    expect(graph?.nodes.find((node) => node.kind === 'subscription')).toMatchObject({ delivery: 'sse', suspension: 'bounded-failures' });
    expect(graph?.nodes.find((node) => node.kind === 'projection')).toMatchObject({ rebuildable: true, duplicateHandling: 'idempotent', rebuild: 'full-replay' });
    expect(graph?.nodes.find((node) => node.kind === 'provider' && node.interface === 'ProjectionStore')).toMatchObject({ implementation: 'clickhouse' });
    expect(validateApplicationGraph(graph)).toEqual([]);
    expect(validateApplicationGraphCompatibilityPolicy(graph)).toEqual([]);
  });

  it('validates payloads and fails closed on invalid retention and empty partitions', async () => {
    const catalog = app('reactive-validation');
    const database = catalog.database.postgres('catalog', { schema: {} });
    expect(() => catalog.stream(AccountChanged, { database, retention: { maxAgeSeconds: 0 }, partitionBy: (payload) => payload.accountId, authorize: () => true })).toThrow(/maxAgeSeconds/);
    const changes = catalog.stream(AccountChanged, { database, retention: { maxAgeSeconds: 60 }, partitionBy: () => '', authorize: () => true });
    expect(() => changes.partition({ accountId: 'account-1', balance: 1, revision: 'r1' })).toThrow(/must not be empty/);
    await expect(changes.authorize({ id: 'principal-1' }, 'replay')).resolves.toBe(true);
  });
});
