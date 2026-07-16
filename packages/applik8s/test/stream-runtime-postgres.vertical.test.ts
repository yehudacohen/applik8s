// typecast-file-boundary: PostgreSQL stream doubles return untyped rows that the production runtime must validate.
import { app, createPostgresApplicationStream } from '@applik8s/applik8s';
import { stream, type } from '@applik8s/applik8s/dsl';
import { describe, expect, test, vi } from 'vitest';

describe('PostgreSQL replayable application stream', () => {
  test('reads a bounded, context-scoped, schema-validated outbox page', async () => {
    const catalog = app('stream-runtime');
    const database = catalog.database.postgres('catalog', { schema: {} });
    const Changed = stream('cards.changed.v1', { payload: type({ cardId: 'string' }) });
    const binding = catalog.stream(Changed, { database, retention: { maxAgeSeconds: 3600 }, partitionBy: (payload) => payload.cardId, authorize: ({ principal }) => principal.id === 'allowed' });
    const unsafe = vi.fn(async (query: string, ..._args: unknown[]) => query.includes('min(sequence)')
      ? [{ retention_floor: 7 }]
      : [{ id: 'event-1', sequence: 7, partition_key: 'card-1', recorded_at: new Date('2026-07-15T00:00:00Z'), payload: { cardId: 'card-1' } }]);
    const source = createPostgresApplicationStream({ stream: binding, sql: { unsafe } as never, principal: { id: 'allowed' }, contextDigest: 'opaque-digest' });
    await expect(source.read(5, 10)).resolves.toEqual({ items: [{ id: 'event-1', stream: { name: 'cards.changed', version: 'v1' }, sequence: 7, partitionKey: 'card-1', recordedAt: '2026-07-15T00:00:00.000Z', payload: { cardId: 'card-1' } }], nextSequence: 7, exhausted: true, retentionFloor: 7 });
    expect(unsafe).toHaveBeenCalledWith(expect.stringContaining('context_digest = $5'), ['cards.changed', 'v1', 5, 11, 'opaque-digest']);
  });

  test('fails authorization before touching PostgreSQL', async () => {
    const catalog = app('stream-denied');
    const database = catalog.database.postgres('catalog', { schema: {} });
    const Changed = stream('cards.changed.v1', { payload: type({ cardId: 'string' }) });
    const binding = catalog.stream(Changed, { database, retention: { maxAgeSeconds: 3600 }, partitionBy: (payload) => payload.cardId, authorize: () => false });
    const unsafe = vi.fn();
    const source = createPostgresApplicationStream({ stream: binding, sql: { unsafe } as never, principal: { id: 'denied' } });
    await expect(source.read(0, 10)).rejects.toMatchObject({ code: 'APPLIK8S_STREAM_FORBIDDEN' });
    expect(unsafe).not.toHaveBeenCalled();
  });
});
