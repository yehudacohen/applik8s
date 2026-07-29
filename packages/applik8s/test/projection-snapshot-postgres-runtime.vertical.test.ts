// typecast-file-boundary: Snapshot tests use controlled SQL fakes and generic payload fixtures to validate the runtime's checked boundary.
import { type } from 'arktype';
import { describe, expect, test, vi } from 'vitest';
import { createPostgresApplicationProjectionSnapshotSource } from '../src/projection-snapshot-postgres-runtime.js';

describe('PostgreSQL authoritative projection snapshots', () => {
  test('holds the committed stream frontier while scanning bounded native-model pages', async () => {
    const unsafe = vi.fn(async (query: string, _parameters?: readonly unknown[]) => {
      if (query.includes('max(sequence)')) return [{ sequence: '12', recorded_at: new Date('2026-07-20T00:02:00.000Z') }];
      if (query.includes('FROM "public"."posts"')) return [
        { id: 'post-1', authorId: 'author-1', publishedAt: new Date('2026-07-20T00:00:00.000Z') },
        { id: 'post-2', authorId: 'author-2', publishedAt: new Date('2026-07-20T00:01:00.000Z') },
      ];
      return [];
    });
    const source = createPostgresApplicationProjectionSnapshotSource({
      sql: transactionalSql(unsafe),
      model: {
        name: 'Post', tableName: 'posts',
        nativeRelational: {
          schema: 'public',
          identity: { property: 'id', column: 'id' },
          columns: [
            { property: 'id', column: 'id' },
            { property: 'authorId', column: 'author_id' },
            { property: 'publishedAt', column: 'published_at' },
          ],
        },
      },
      stream: { name: 'posts.timeline-changed', version: 'v1' },
      payload: type({ postId: 'string', authorId: 'string', publishedAt: 'string' }),
      map: (row: { readonly id: string; readonly authorId: string; readonly publishedAt: string }) => ({ postId: row.id, authorId: row.authorId, publishedAt: row.publishedAt }),
    });
    const pages: unknown[] = [];
    await expect(source.scan({ batchSize: 2, maxItems: 10, visit: (page) => { pages.push(page); } })).resolves.toEqual({ watermark: 12, recordedAt: '2026-07-20T00:02:00.000Z', items: 2, pages: 1 });
    expect(pages).toEqual([{
      ordinal: 0,
      watermark: 12,
      recordedAt: '2026-07-20T00:02:00.000Z',
      items: [
        { id: 'post-1:0', payload: { postId: 'post-1', authorId: 'author-1', publishedAt: '2026-07-20T00:00:00.000Z' } },
        { id: 'post-2:0', payload: { postId: 'post-2', authorId: 'author-2', publishedAt: '2026-07-20T00:01:00.000Z' } },
      ],
    }]);
    expect(unsafe.mock.calls.map(([query]) => String(query))).toEqual([
      expect.stringContaining('REPEATABLE READ READ ONLY'),
      expect.stringContaining('max(sequence)'),
      expect.stringContaining('"author_id" AS "authorId"'),
    ]);
    expect(unsafe.mock.calls[1]?.[1]).toEqual(['posts.timeline-changed', 'v1']);
    expect(unsafe.mock.calls.some(([query]) => String(query).includes('pg_advisory'))).toBe(false);
  });

  test('fails closed on invalid snapshot payloads and row bounds', async () => {
    const rows = [{ id: 'one' }, { id: 'two' }];
    const source = createPostgresApplicationProjectionSnapshotSource({
      sql: transactionalSql(vi.fn(async (query: string) => query.includes('max(sequence)') ? [{ sequence: 0, recorded_at: new Date(0) }] : query.includes('FROM') ? rows : [])),
      model: { name: 'Post', tableName: 'posts', nativeRelational: { identity: { property: 'id', column: 'id' }, columns: [{ property: 'id', column: 'id' }] } },
      stream: { name: 'posts', version: 'v1' }, payload: type({ id: 'string' }), map: (row: { readonly id: string }) => ({ id: row.id }),
    });
    await expect(source.scan({ batchSize: 1, maxItems: 1, visit: () => {} })).rejects.toThrow(/exceeded its 1-row bound/);

    const invalid = createPostgresApplicationProjectionSnapshotSource({
      sql: transactionalSql(vi.fn(async (query: string) => query.includes('max(sequence)') ? [{ sequence: 0, recorded_at: new Date(0) }] : query.includes('FROM') ? [{ id: 'one' }] : [])),
      model: { name: 'Post', tableName: 'posts', nativeRelational: { identity: { property: 'id', column: 'id' }, columns: [{ property: 'id', column: 'id' }] } },
      stream: { name: 'posts', version: 'v1' }, payload: type({ id: 'string' }), map: () => ({ id: 42 }) as never,
    });
    await expect(invalid.scan({ batchSize: 1, maxItems: 2, visit: () => {} })).rejects.toThrow(/invalid stream payload/);
  });
});

function transactionalSql(unsafe: ReturnType<typeof vi.fn>): never {
  return { unsafe, begin: (handler: (transaction: { unsafe: typeof unsafe }) => unknown) => handler({ unsafe }) } as never;
}
