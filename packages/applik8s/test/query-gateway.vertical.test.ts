// typecast-file-boundary: gateway fixtures emulate heterogeneous query and database results validated by the runtime.
import type { ApplicationModelChange, ApplicationOnlineQueryRuntimeSource, ApplicationOnlineQuerySource, ApplicationQueryBinding, ApplicationRelationalContext } from '@applik8s/applik8s';
import { app, createApplicationQueryGateway, createApplicationQueryGatewayHttpHandler, createApplicationStreamSubscriptionGateway, createApplicationSubscriptionLimiter, postgres, trustedContext } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import type { ApplicationAuthorizationReceipt } from '@applik8s/core';
import { pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { describe, expect, test } from 'vitest';
import { testApplicationPrincipal } from '../../../test-support/application-principal.js';

function queryFixture() {
  const cards = pgTable('cards', {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    name: text('name').notNull(),
    revision: text('revision').notNull(),
  });
  const schema = { cards };
  const OrganizationId = trustedContext('organizationId', { schema: type('string') });
  const catalog = app('query-gateway-fixture');
  const Database = catalog.database.postgres('catalog', { schema, access: postgres.rls({ context: OrganizationId, column: 'organizationId' }) });
  const Card = catalog.model(cards, { name: 'Card', database: Database });
  const query = catalog.query('cards.list.v1', {
    input: type({ limit: 'number.integer >= 1' }),
    output: type({ id: 'string', name: 'string' }).array(),
    database: Database,
    context: [OrganizationId],
    reads: [Card],
    budgets: { maxRows: 5, maxResultBytes: 1_000, timeoutMs: 1_000 },
    authorize: ({ principal }) => principal.id === 'allowed',
    run: async () => [{ id: 'card-1', name: 'First' }],
  });
  return { Database, OrganizationId, catalog, query };
}

function fakeContext(pages: readonly { readonly items: readonly (ApplicationModelChange & { readonly sequence: number })[]; readonly retentionFloor: number }[] = []): ApplicationRelationalContext {
  let page = 0;
  return {
    database() { throw new Error('not used'); },
    async run(_binding, handler) { return handler(); },
    async snapshot(_binding, handler) { return { value: await handler(), sequence: 5 }; },
    async changes() { return pages[page++] ?? { items: [], retentionFloor: 0 }; },
    async transaction(_binding, handler) { return handler({ db: undefined as never, changes: { invalidate() {}, reset() {} } }); },
    async get() { return undefined; },
    async update() { throw new Error('not used'); },
  };
}

function queryReceipt(
  principalId: string,
  authorityRevision: string,
  overrides: Partial<ApplicationAuthorizationReceipt> = {},
): ApplicationAuthorizationReceipt {
  const catalogRevision = overrides.catalogRevision ?? 'catalog-1';
  const trustedContextDigest = overrides.trustedContextDigest ?? 'trusted-context-1';
  return {
    apiVersion: 'applik8s.authorizationReceipt/v1alpha1',
    application: 'test',
    id: overrides.id ?? `receipt-${authorityRevision}`,
    operationId: overrides.operationId ?? 'applik8s://query-gateway-fixture/query/cards.list.v1@v1',
    operationVersion: overrides.operationVersion ?? 'v1',
    catalogRevision,
    authorityRevision,
    principal: overrides.principal ?? {
      id: principalId,
      identity: { id: `identity-${principalId}`, kind: 'human', issuer: 'fixture', subject: principalId },
      kind: 'human',
      authenticationMethod: 'fixture',
      audience: ['query-gateway'],
      trustedContextDigest,
      catalogRevision,
      authorityRevision,
      admittedAt: '2026-07-15T12:00:00.000Z',
    },
    trustedContextDigest,
    matchedPermissionIds: overrides.matchedPermissionIds ?? ['permission-query'],
    matchedGrantIds: overrides.matchedGrantIds ?? ['grant-query'],
    inputDigest: overrides.inputDigest ?? 'input-digest-1',
    target: overrides.target ?? { kind: 'all' },
    scopeEvidence: overrides.scopeEvidence ?? [{ kind: 'all' }],
    audience: overrides.audience ?? 'query-gateway',
    transport: overrides.transport ?? 'http',
    admittedAt: overrides.admittedAt ?? '2026-07-15T12:00:00.000Z',
    ...overrides,
  };
}

describe('v0.6 authenticated query gateway', () => {
  test('binds the app declaration directly to an authenticated Request/Response runtime', async () => {
    const { catalog, query } = queryFixture();
    const handler = catalog.gateway('public', { queries: [query] }).httpHandler({
      authenticate: async () => ({ principal: testApplicationPrincipal('allowed', { authorityRevision: 'permissions-1' }), admittedContext: { values: { organizationId: 'organization-1' }, digestSecret: 'context-digest-secret-context-digest-secret' } }),
      context: () => fakeContext(),
      cursorSecret: 'cursor-signing-secret-cursor-signing-secret',
    });
    const response = await handler(new Request('https://catalog.test/queries/cards.list.v1/snapshot', { method: 'POST', body: JSON.stringify({ input: { limit: 5 } }) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ kind: 'snapshot', query: 'cards.list.v1' });
  });

  test('returns a validated bounded snapshot and resumes an intervening relevant change', async () => {
    const { query } = queryFixture();
    const context = fakeContext([{ items: [{ sequence: 6, model: 'Card', operation: 'invalidate', contextDigest: 'digest', recordedAt: '2026-07-15T12:00:01.000Z' }], retentionFloor: 1 }]);
    const gateway = createApplicationQueryGateway({
      queries: [query as ApplicationQueryBinding<unknown, unknown>],
      authenticate: async () => ({ principal: testApplicationPrincipal('allowed', { authorityRevision: 'permissions-1' }), admittedContext: { values: { organizationId: 'organization-1' }, digestSecret: 'context-digest-secret-context-digest-secret' } }),
      context: () => context,
      cursorSecret: 'cursor-signing-secret-cursor-signing-secret',
      now: () => new Date('2026-07-15T12:00:00.000Z'),
      sleep: async () => undefined,
    });
    const snapshot = await gateway.snapshot<{ readonly id: string; readonly name: string }[]>({}, query.id, { limit: 5 });
    expect(snapshot).toMatchObject({ kind: 'snapshot', query: 'cards.list.v1', value: [{ id: 'card-1', name: 'First' }], capability: 'resumableInvalidation' });
    expect(snapshot.cursor).not.toContain('organization-1');
    const cursorBody = JSON.parse(Buffer.from(snapshot.cursor.split('.')[0] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;
    expect(cursorBody).toMatchObject({ version: 2, query: 'cards.list.v1' });
    expect(cursorBody).not.toHaveProperty('authorizationVersion');
    expect(cursorBody).not.toHaveProperty('contextDigest');
    expect(JSON.stringify(cursorBody)).not.toContain('permissions-1');
    expect(JSON.stringify(cursorBody)).not.toContain('organization-1');
    const iterator = gateway.subscribe({}, query.id, { limit: 5 }, snapshot.cursor)[Symbol.asyncIterator]();
    const event = await iterator.next();
    expect(event.value).toMatchObject({ kind: 'invalidate', id: 'cards.list.v1:6', models: ['Card'] });
  });

  test('pins canonical operation authority into opaque cursors and resets on revision change', async () => {
    const { query } = queryFixture();
    let authorityRevision = 'authority-1';
    const gateway = createApplicationQueryGateway({
      queries: [query as ApplicationQueryBinding<unknown, unknown>],
      authenticate: async () => ({
        principal: testApplicationPrincipal('allowed', { authorityRevision }),
        admittedContext: {
          values: { organizationId: 'organization-1' },
          digestSecret: 'context-digest-secret-context-digest-secret',
        },
      }),
      authorizeOperation: async ({ boundary, identity, inputDigest, trustedContextDigest }) => queryReceipt(
        identity.principal.id,
        authorityRevision,
        { id: `receipt-${boundary}-${authorityRevision}`, inputDigest, trustedContextDigest },
      ),
      context: () => fakeContext(),
      cursorSecret: 'cursor-signing-secret-cursor-signing-secret',
      now: () => new Date('2026-07-15T12:00:00.000Z'),
      sleep: async () => undefined,
    });

    const snapshot = await gateway.snapshot({}, query.id, { limit: 5 });
    const cursorBody = JSON.parse(
      Buffer.from(snapshot.cursor.split('.')[0] ?? '', 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    expect(cursorBody).toMatchObject({
      version: 3,
      operationId: 'applik8s://query-gateway-fixture/query/cards.list.v1@v1',
      operationVersion: 'v1',
      catalogRevision: 'catalog-1',
      authorityRevision: 'authority-1',
    });
    expect(cursorBody.applicationBinding).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cursorBody.principalBinding).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(cursorBody)).not.toContain('allowed');
    expect(JSON.stringify(cursorBody)).not.toContain('"test"');
    expect(JSON.stringify(cursorBody)).not.toContain('trusted-context-1');

    authorityRevision = 'authority-2';
    expect(
      (await gateway.subscribe({}, query.id, { limit: 5 }, snapshot.cursor)[Symbol.asyncIterator]().next()).value,
    ).toMatchObject({ kind: 'reset', reason: 'authorizationChanged' });
  });

  test('uses one query protocol for an online projection and invalidates again when its checkpoint catches up', async () => {
    const { query } = queryFixture();
    let revision = 'live:5';
    const sourceRuntime: ApplicationOnlineQueryRuntimeSource<{ readonly id: string; readonly name: string }> = {
      async page() {
        return { items: [{ id: 'card-projected', name: 'Projected' }], projection: { generation: 'live', eventWatermark: revision.split(':')[1] ?? '0', rebuilding: false, degraded: false } };
      },
      async revision() { return revision; },
      async snapshot<TResult>(operation: (source: ApplicationOnlineQuerySource<{ readonly id: string; readonly name: string }>) => Promise<TResult>) {
        return { value: await operation(sourceRuntime), revision };
      },
    };
    const projected = {
      ...query,
      sourceRuntime,
      async run(_context: ApplicationRelationalContext, _principal, _input: { readonly limit: number }, source: ApplicationOnlineQuerySource<object> = sourceRuntime) {
        // typecast: the concrete runtime reader schema is erased by the heterogeneous gateway binding list.
        return (await source.page({ partition: 'viewer-1', limit: 5 })).items as readonly { readonly id: string; readonly name: string }[];
      },
    } satisfies ApplicationQueryBinding<{ readonly limit: number }, readonly { readonly id: string; readonly name: string }[]>;
    const gateway = createApplicationQueryGateway({
      queries: [projected as ApplicationQueryBinding<unknown, unknown>],
      authenticate: async () => ({ principal: testApplicationPrincipal('allowed', { authorityRevision: 'permissions-1' }), admittedContext: { values: { organizationId: 'organization-1' }, digestSecret: 'context-digest-secret-context-digest-secret' } }),
      context: () => fakeContext(),
      cursorSecret: 'cursor-signing-secret-cursor-signing-secret',
      now: () => new Date('2026-07-15T12:00:00.000Z'),
      sleep: async () => undefined,
    });
    const snapshot = await gateway.snapshot({}, query.id, { limit: 5 });
    expect(snapshot).toMatchObject({ value: [{ id: 'card-projected', name: 'Projected' }] });

    revision = 'live:6';
    const event = await gateway.subscribe({}, query.id, { limit: 5 }, snapshot.cursor)[Symbol.asyncIterator]().next();
    expect(event.value).toMatchObject({ kind: 'invalidate', id: 'cards.list.v1:5:live:6', sequence: 5, models: ['Card'] });
  });

  test('resets safely for tampered, cross-context, stale-authorization, and expired cursors', async () => {
    const { query } = queryFixture();
    let organizationId = 'organization-1';
    let authorizationVersion = 'permissions-1';
    let current = new Date('2026-07-15T12:00:00.000Z');
    const gateway = createApplicationQueryGateway({
      queries: [query as ApplicationQueryBinding<unknown, unknown>],
      authenticate: async () => ({ principal: testApplicationPrincipal('allowed', { authorityRevision: authorizationVersion }), admittedContext: { values: { organizationId }, digestSecret: 'context-digest-secret-context-digest-secret' } }),
      context: () => fakeContext(),
      cursorSecret: 'cursor-signing-secret-cursor-signing-secret',
      cursorTtlSeconds: 30,
      now: () => current,
      sleep: async () => undefined,
    });
    const snapshot = await gateway.snapshot({}, query.id, { limit: 5 });
    const tampered = `${snapshot.cursor.slice(0, -1)}x`;
    expect((await gateway.subscribe({}, query.id, { limit: 5 }, tampered)[Symbol.asyncIterator]().next()).value).toMatchObject({ kind: 'reset', reason: 'cursorInvalid' });
    organizationId = 'organization-2';
    expect((await gateway.subscribe({}, query.id, { limit: 5 }, snapshot.cursor)[Symbol.asyncIterator]().next()).value).toMatchObject({ kind: 'reset', reason: 'contextChanged' });
    organizationId = 'organization-1';
    authorizationVersion = 'permissions-2';
    expect((await gateway.subscribe({}, query.id, { limit: 5 }, snapshot.cursor)[Symbol.asyncIterator]().next()).value).toMatchObject({ kind: 'reset', reason: 'authorizationChanged' });
    authorizationVersion = 'permissions-1';
    current = new Date('2026-07-15T12:01:00.000Z');
    expect((await gateway.subscribe({}, query.id, { limit: 5 }, snapshot.cursor)[Symbol.asyncIterator]().next()).value).toMatchObject({ kind: 'reset', reason: 'cursorExpired' });
  });

  test('denies before execution and enforces output row budgets', async () => {
    const { query } = queryFixture();
    const denied = createApplicationQueryGateway({
      queries: [query as ApplicationQueryBinding<unknown, unknown>],
      authenticate: async () => ({ principal: testApplicationPrincipal('denied', { authorityRevision: 'permissions-1' }), admittedContext: { values: { organizationId: 'organization-1' }, digestSecret: 'context-digest-secret-context-digest-secret' } }),
      context: () => fakeContext(),
      cursorSecret: 'cursor-signing-secret-cursor-signing-secret',
    });
    await expect(denied.snapshot({}, query.id, { limit: 5 })).rejects.toMatchObject({ code: 'APPLIK8S_QUERY_FORBIDDEN' });

    const oversized = { ...query, async run() { return Array.from({ length: 6 }, (_, index) => ({ id: `card-${index}`, name: 'Card' })); } } satisfies ApplicationQueryBinding<{ limit: number }, { id: string; name: string }[]>;
    const gateway = createApplicationQueryGateway({
      queries: [oversized as ApplicationQueryBinding<unknown, unknown>],
      authenticate: async () => ({ principal: testApplicationPrincipal('allowed', { authorityRevision: 'permissions-1' }), admittedContext: { values: { organizationId: 'organization-1' }, digestSecret: 'context-digest-secret-context-digest-secret' } }),
      context: () => fakeContext(),
      cursorSecret: 'cursor-signing-secret-cursor-signing-secret',
    });
    await expect(gateway.snapshot({}, query.id, { limit: 5 })).rejects.toThrow('exceeding maxRows 5');
  });

  test('lowers snapshots and subscriptions to bounded HTTP/SSE responses', async () => {
    const handler = createApplicationQueryGatewayHttpHandler({
      async snapshot<TValue>(_request: Request, query: string) { return { kind: 'snapshot' as const, protocol: 'applik8s.query/v1alpha1' as const, query, inputKey: 'key', value: [] as unknown as TValue, cursor: 'cursor', capability: 'resumableInvalidation' as const, generatedAt: '2026-07-15T00:00:00.000Z' }; },
      async *subscribe(_request, query) { yield { kind: 'invalidate', protocol: 'applik8s.query/v1alpha1', id: `${query}:1`, sequence: 1, query, cursor: 'next', models: ['Card'] }; },
    });
    const snapshot = await handler(new Request('https://catalog.test/queries/cards.list.v1/snapshot', { method: 'POST', body: JSON.stringify({ input: { limit: 5 } }) }));
    expect(snapshot.status).toBe(200);
    expect(await snapshot.json()).toMatchObject({ kind: 'snapshot', query: 'cards.list.v1' });
    const subscription = await handler(new Request('https://catalog.test/queries/cards.list.v1/subscribe', { method: 'POST', body: JSON.stringify({ input: { limit: 5 }, cursor: 'cursor' }) }));
    expect(subscription.headers.get('content-type')).toContain('text/event-stream');
    expect(await subscription.text()).toContain('event: invalidate');
    expect((await handler(new Request('https://catalog.test/queries/cards.list.v1/snapshot', { method: 'GET' }))).status).toBe(405);
  });

  test('multiplexes bounded logical subscriptions over one physical SSE response', async () => {
    const handler = createApplicationQueryGatewayHttpHandler({
      async snapshot<TValue>(_request: Request, query: string) { return { kind: 'snapshot' as const, protocol: 'applik8s.query/v1alpha1' as const, query, inputKey: 'key', value: [] as unknown as TValue, cursor: 'cursor', capability: 'resumableInvalidation' as const, generatedAt: '2026-07-15T00:00:00.000Z' }; },
      async *subscribe(_request, query) { yield { kind: 'invalidate', protocol: 'applik8s.query/v1alpha1', id: `${query}:1`, sequence: 1, query, cursor: `${query}:next`, models: ['Card'] }; },
    }, { maxMultiplexSubscriptions: 2 });
    const response = await handler(new Request('https://catalog.test/queries/multiplex', {
      method: 'POST',
      body: JSON.stringify({ subscriptions: [
        { id: 'first', query: 'cards.first.v1', input: { limit: 5 }, cursor: 'cursor-1' },
        { id: 'second', query: 'cards.second.v1', input: { limit: 5 }, cursor: 'cursor-2' },
      ] }),
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const body = await response.text();
    expect(body).toContain('"subscriptionId":"first"');
    expect(body).toContain('"subscriptionId":"second"');
    expect(body).toContain('"protocol":"applik8s.query-multiplex/v1alpha1"');

    const oversized = await handler(new Request('https://catalog.test/queries/multiplex', {
      method: 'POST',
      body: JSON.stringify({ subscriptions: [
        { id: 'first', query: 'cards.first.v1', input: {}, cursor: 'cursor-1' },
        { id: 'second', query: 'cards.second.v1', input: {}, cursor: 'cursor-2' },
        { id: 'third', query: 'cards.third.v1', input: {}, cursor: 'cursor-3' },
      ] }),
    }));
    expect(oversized.status).toBe(400);
  });

  test('reports known projection unavailability as an actionable retryable response without leaking provider details', async () => {
    const handler = createApplicationQueryGatewayHttpHandler({
      async snapshot() {
        throw Object.assign(new Error('secret provider endpoint and credential details'), {
          code: 'APPLIK8S_ONLINE_PROJECTION_UNAVAILABLE',
        });
      },
      async *subscribe() { yield* []; },
    });
    const response = await handler(new Request('https://catalog.test/queries/timeline.v1/snapshot', {
      method: 'POST', body: JSON.stringify({ input: {} }),
    }));
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('5');
    expect(await response.json()).toEqual({ error: 'projection_unavailable' });
  });

  test('shares one per-principal concurrency budget across query and public-stream SSE', async () => {
    const { query } = queryFixture();
    const limiter = createApplicationSubscriptionLimiter({ perPrincipal: 1, total: 2 });
    let admitted: (() => void) | undefined;
    const admittedPromise = new Promise<void>((resolve) => { admitted = resolve; });
    const abort = new AbortController();
    const identity = { principal: testApplicationPrincipal('allowed', { authorityRevision: 'permissions-1' }), admittedContext: { values: { organizationId: 'organization-1' }, digestSecret: 'context-digest-secret-context-digest-secret' } } as const;
    const queryGateway = createApplicationQueryGateway({
      queries: [query as ApplicationQueryBinding<unknown, unknown>],
      authenticate: async () => identity,
      context: () => fakeContext(),
      cursorSecret: 'cursor-signing-secret-cursor-signing-secret',
      subscriptionLimiter: limiter,
      pollIntervalMs: 10,
      heartbeatMs: 20,
      maxSessionMs: 1_000,
      sleep: async (_ms, signal) => new Promise<void>((resolve) => {
        if (signal?.aborted) resolve();
        else signal?.addEventListener('abort', () => resolve(), { once: true });
      }),
      audit(record) { if (record.event === 'subscription-admitted') admitted?.(); },
    });
    const snapshot = await queryGateway.snapshot({}, query.id, { limit: 1 });
    const queryIterator = queryGateway.subscribe({}, query.id, { limit: 1 }, snapshot.cursor, { signal: abort.signal })[Symbol.asyncIterator]();
    const pendingQueryEvent = queryIterator.next();
    await admittedPromise;

    const streamGateway = createApplicationStreamSubscriptionGateway({
      subscriptions: [{
        name: 'card-events',
        stream: {
          kind: 'applicationStream',
          // typecast: this test exercises the common limiter before payload validation or database behavior.
          definition: { kind: 'applik8sStream', id: 'cards.changed.v1', name: 'cards.changed', version: 'v1', payload: (() => undefined) as never },
          retention: { maxAgeSeconds: 3_600 },
          authority: 'postgres-outbox',
          replay: 'supported',
          // typecast: no stream source is opened when the shared limiter correctly denies admission.
          database: {} as never,
          partition: () => 'unused',
          authorize: async () => true,
          project: () => { throw new Error('not used by limiter fixture'); },
          subscribe: () => { throw new Error('not used by limiter fixture'); },
          process: () => { throw new Error('not used by limiter fixture'); },
        },
        authorize: async () => true,
        open: () => ({ async read() { return { items: [], nextSequence: 0, exhausted: true, retentionFloor: 0 }; } }),
      }],
      authenticate: async () => ({ principal: identity.principal, contextDigest: 'opaque-context-digest' }),
      cursorSecret: 'cursor-signing-secret-cursor-signing-secret',
      subscriptionLimiter: limiter,
    });
    const denied = await streamGateway.handle(new Request('https://catalog.test/streams/card-events/subscribe', { method: 'POST', body: '{}' }));
    expect(denied).toMatchObject({ status: 429 });

    abort.abort();
    await expect(pendingQueryEvent).resolves.toMatchObject({ done: true });
  });
});
