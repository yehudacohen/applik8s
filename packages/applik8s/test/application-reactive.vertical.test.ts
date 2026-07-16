import { app, applicationGraphFor, ProjectionStore, stream } from '@applik8s/applik8s';
import { validateApplicationGraph, validateApplicationGraphCompatibilityPolicy } from '@applik8s/core';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';

const AccountChanged = stream('accounts.changed.v1', {
  payload: type({ accountId: 'string', balance: 'number', revision: 'string' }),
});

describe('v0.6 streams, subscriptions, and projections', () => {
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
