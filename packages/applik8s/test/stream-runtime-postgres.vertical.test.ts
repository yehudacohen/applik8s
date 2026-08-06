// typecast-file-boundary: PostgreSQL stream doubles return untyped rows that the production runtime must validate.
import { app, createPostgresApplicationStream, enforcePostgresApplicationStreamRetention } from '@applik8s/applik8s';
import { stream, type } from '@applik8s/applik8s/dsl';
import { describe, expect, test, vi } from 'vitest';
import { applicationRequestContextValues } from '../src/command-principal.js';
import { testApplicationPrincipal } from '../../../test-support/application-principal.js';

describe('PostgreSQL replayable application stream', () => {
  test('reads a bounded, context-scoped, schema-validated outbox page', async () => {
    const catalog = app('stream-runtime');
    const database = catalog.database.postgres('catalog', { schema: {} });
    const Changed = stream('cards.changed.v1', { payload: type({ cardId: 'string' }) });
    const binding = catalog.stream(Changed, { database, retention: { maxAgeSeconds: 3600 }, partitionBy: (payload) => payload.cardId, authorize: ({ principal }) => principal.id === 'allowed' });
    const unsafe = vi.fn(async (query: string, ..._args: unknown[]) => query.includes('retention_floors')
      ? [{ retention_floor: 0 }]
      : [{ id: 'event-1', sequence: 7, partition_key: 'card-1', recorded_at: new Date('2026-07-15T00:00:00Z'), context_digest: 'opaque-digest', payload: { cardId: 'card-1' } }]);
    const source = createPostgresApplicationStream({ stream: binding, sql: transactionalSql(unsafe), principal: testApplicationPrincipal('allowed'), contextDigest: 'opaque-digest' });
    await expect(source.read(5, 10)).resolves.toEqual({ items: [{ id: 'event-1', stream: { name: 'cards.changed', version: 'v1' }, sequence: 7, partitionKey: 'card-1', recordedAt: '2026-07-15T00:00:00.000Z', contextDigest: 'opaque-digest', payload: { cardId: 'card-1' } }], nextSequence: 7, exhausted: true, retentionFloor: 0 });
    expect(unsafe).toHaveBeenCalledWith(expect.stringContaining('context_digest = $5'), ['cards.changed', 'v1', 5, 11, 'opaque-digest']);
    expect(unsafe).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock_shared'), ['applik8s:public-stream-commit:v1:cards.changed:v1']);
    expect(unsafe.mock.calls.find(([query]) => String(query).includes('SELECT id'))?.[0]).not.toContain(', envelope');
  });

  test('normalizes canonical JSON text returned for framework-authored JSONB rows', async () => {
    const catalog = app('stream-runtime-json-text');
    const database = catalog.database.postgres('catalog', { schema: {} });
    const Changed = stream('cards.json-text.v1', {
      payload: type({ cardId: 'string' }),
    });
    const binding = catalog.stream(Changed, {
      database,
      retention: { maxAgeSeconds: 3600 },
      partitionBy: (payload) => payload.cardId,
      authorize: () => true,
    });
    const unsafe = vi.fn(async (query: string) =>
      query.includes('retention_floors')
        ? [{ retention_floor: 0 }]
        : [{
            id: 'event-json-text',
            sequence: 8,
            partition_key: 'card-json-text',
            recorded_at: '2026-07-15T00:00:00.000Z',
            context_digest: 'opaque-digest',
            payload: JSON.stringify({ cardId: 'card-json-text' }),
          }]);
    const source = createPostgresApplicationStream({
      stream: binding,
      sql: transactionalSql(unsafe),
      principal: testApplicationPrincipal('allowed'),
      contextDigest: 'opaque-digest',
    });

    await expect(source.read(0, 10)).resolves.toMatchObject({
      items: [{ payload: { cardId: 'card-json-text' } }],
    });
  });

  test('hydrates admitted identity only for explicitly internal processor reads', async () => {
    const catalog = app('stream-runtime-internal-context');
    const database = catalog.database.postgres('catalog', { schema: {} });
    const Changed = stream('cards.internal-changed.v1', { payload: type({ cardId: 'string' }) });
    const binding = catalog.stream(Changed, { database, retention: { maxAgeSeconds: 3600 }, partitionBy: (payload) => payload.cardId, authorize: () => true });
    const values = applicationRequestContextValues(
      testApplicationPrincipal('author-1', { authorityRevision: 'authz-v3', trustedContext: { tenantId: 'tenant-1' } }),
      'authz-v3',
      { tenantId: 'tenant-1' },
    );
    const changeScopes = {
      global: 'a'.repeat(64),
      'context:tenantId': 'b'.repeat(64),
    };
    const unsafe = vi.fn(async (query: string, ..._args: unknown[]) => query.includes('retention_floors')
      ? [{ retention_floor: 0 }]
      : [{
          id: 'event-internal-1', sequence: 1, partition_key: 'card-1', recorded_at: '2026-07-15T00:00:00.000Z',
          context_digest: 'internal-digest', payload: { cardId: 'card-1' },
          envelope: {
            trustedContext: {
              values,
              digest: 'c'.repeat(64),
              changeScopes,
            },
          },
        }]);
    const source = createPostgresApplicationStream({
      stream: binding,
      sql: transactionalSql(unsafe),
      principal: testApplicationPrincipal('applik8s:processor:cards'),
      includeTrustedContext: true,
    });

    await expect(source.read(0, 10)).resolves.toMatchObject({
      items: [{
        principal: expect.objectContaining({ id: 'author-1', authorityRevision: 'authz-v3' }),
        trustedContext: { tenantId: 'tenant-1' },
        changeScopes,
      }],
    });
    expect(unsafe.mock.calls.find(([query]) => String(query).includes('SELECT id'))?.[0]).toContain(', envelope');
  });

  test('fails authorization before touching PostgreSQL', async () => {
    const catalog = app('stream-denied');
    const database = catalog.database.postgres('catalog', { schema: {} });
    const Changed = stream('cards.changed.v1', { payload: type({ cardId: 'string' }) });
    const binding = catalog.stream(Changed, { database, retention: { maxAgeSeconds: 3600 }, partitionBy: (payload) => payload.cardId, authorize: () => false });
    const unsafe = vi.fn();
    const source = createPostgresApplicationStream({ stream: binding, sql: transactionalSql(unsafe), principal: testApplicationPrincipal('denied') });
    await expect(source.read(0, 10)).rejects.toMatchObject({ code: 'APPLIK8S_STREAM_FORBIDDEN' });
    expect(unsafe).not.toHaveBeenCalled();
  });

  test('grants only the compiler-declared internal consumer identity', async () => {
    const catalog = app('stream-internal-authority');
    const database = catalog.database.postgres('catalog', { schema: {} });
    const Changed = stream('cards.internal.v1', { payload: type({ cardId: 'string' }) });
    const binding = catalog.stream(Changed, { database, retention: { maxAgeSeconds: 3600 }, partitionBy: (payload) => payload.cardId, authorize: () => false });
    const unsafe = vi.fn(async (query: string) => query.includes('retention_floors') ? [{ retention_floor: 0 }] : []);
    const allowed = createPostgresApplicationStream({
      stream: binding,
      sql: transactionalSql(unsafe),
      principal: testApplicationPrincipal('applik8s:processor:timeline'),
      internalConsumer: { kind: 'processor', name: 'timeline' },
    });
    await expect(allowed.read(0, 10)).resolves.toMatchObject({ items: [], exhausted: true });

    const deniedUnsafe = vi.fn();
    const denied = createPostgresApplicationStream({
      stream: binding,
      sql: transactionalSql(deniedUnsafe),
      principal: testApplicationPrincipal('applik8s:processor:other'),
      internalConsumer: { kind: 'processor', name: 'timeline' },
    });
    await expect(denied.read(0, 10)).rejects.toMatchObject({ code: 'APPLIK8S_STREAM_FORBIDDEN' });
    expect(deniedUnsafe).not.toHaveBeenCalled();
  });

  test('records durable global and context deletion watermarks instead of inferring a floor from global sequence allocation', async () => {
    const catalog = app('stream-retention-watermark');
    const database = catalog.database.postgres('catalog', { schema: {} });
    const Changed = stream('cards.retained.v1', { payload: type({ cardId: 'string' }) });
    const binding = catalog.stream(Changed, { database, retention: { maxAgeSeconds: 3_600, maxMessages: 500 }, partitionBy: (payload) => payload.cardId, authorize: () => true });
    const unsafe = vi.fn(async (_query: string, _parameters: readonly unknown[]) => [{ id: 'deleted-1' }, { id: 'deleted-2' }]);

    await expect(enforcePostgresApplicationStreamRetention({
      stream: binding,
      sql: transactionalSql(unsafe),
      now: new Date('2026-07-15T12:00:00.000Z'),
      batchSize: 25,
    })).resolves.toEqual({ deleted: 2 });

    expect(unsafe).toHaveBeenCalledTimes(2);
    expect(unsafe.mock.calls[0]?.[0]).toContain('pg_advisory_xact_lock');
    expect(unsafe.mock.calls[0]?.[1]).toEqual(['applik8s:public-stream-commit:v1:cards.retained:v1']);
    expect(unsafe.mock.calls[1]?.[0]).toContain('applik8s_public_stream_retention_floors');
    expect(unsafe.mock.calls[1]?.[0]).toContain("SELECT $1, $2, '', max(sequence)");
    expect(unsafe.mock.calls[1]?.[0]).toContain('GROUP BY context_digest');
    expect(unsafe.mock.calls[1]?.[1]).toEqual(['cards.retained', 'v1', '2026-07-15T12:00:00.000Z', 3_600, 500, 25]);
  });
});

function transactionalSql(unsafe: ReturnType<typeof vi.fn>): never {
  return { unsafe, begin: (handler: (transaction: { unsafe: typeof unsafe }) => unknown) => handler({ unsafe }) } as never;
}
