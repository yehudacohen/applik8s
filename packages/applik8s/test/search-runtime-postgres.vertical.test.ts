// typecast-file-boundary: PostgreSQL search test doubles return deliberately erased rows to exercise runtime validation and typed reconstruction.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApplicationPostgresSql } from '../src/postgres-runtime-contract.js';
import { createApplicationPostgresSql } from '../src/postgres-runtime-loader.js';
import type {
  ApplicationSearchCommittedChange,
  ApplicationSearchHydratedDocument,
} from '../src/search-runtime.js';
import {
  ApplicationPostgresSearchBoundError,
  createPostgresApplicationSearchRuntime,
  type PostgresApplicationSearchRuntime,
  postgresApplicationSearchFilterJsonText,
  postgresApplicationSearchMigrationSql,
} from '../src/search-runtime-postgres.js';

interface SearchDocument {
  readonly title: string;
  readonly tenant: string;
  readonly category: string;
  readonly rank: number;
}

const databaseUrl = process.env.APPLIK8S_POSTGRES_URL;
const live = databaseUrl ? describe : describe.skip;
const schema = `applik8s_search_live_${process.pid}`;
const documents = new Map<string, SearchDocument>();
const changes: ApplicationSearchCommittedChange[] = [];
let snapshotFrontier = 0;

function requiredChange(position: number): ApplicationSearchCommittedChange {
  const candidate = changes[position - 1];
  if (!candidate) {
    throw new Error(`Expected committed change ${position}.`);
  }
  return candidate;
}

function requiredDocument(identity: string): SearchDocument {
  const candidate = documents.get(identity);
  if (!candidate) {
    throw new Error(`Expected search document ${identity}.`);
  }
  return candidate;
}

function change(
  commitPosition: number,
  sourceIdentity: string,
  operation: ApplicationSearchCommittedChange['operation'] = 'update',
): ApplicationSearchCommittedChange {
  return {
    id: `change-${commitPosition}`,
    sourceModel: 'Article',
    sourceIdentity,
    operation,
    commitPosition,
    transactionId: `transaction-${commitPosition}`,
    schemaRevision: 'article-v1',
    recordedAt: new Date(1_800_000_000_000 + commitPosition).toISOString(),
  };
}

function runtimeOptions(sql?: ApplicationPostgresSql) {
  return {
    logicalIndex: 'Article.search',
    indexRevision: 'revision-1',
    ...(sql ? { sql } : { databaseUrl: databaseUrl as string }),
    schema,
    cursorSecret: 'live-search-cursor-secret',
    fields: {
      title: { kind: 'text' as const },
      tenant: { kind: 'filter' as const },
      category: { kind: 'facet' as const },
      rank: { kind: 'filter' as const },
    },
    hydration: {
      async affectedRoots(next: ApplicationSearchCommittedChange) {
        return { identities: [next.sourceIdentity], complete: true };
      },
      async hydrate(identities: readonly string[]) {
        return identities.map(
          (identity): ApplicationSearchHydratedDocument<SearchDocument> => ({
            id: identity,
            document: documents.get(identity) ?? null,
            sourceProjectionRevision: `source-${snapshotFrontier}`,
          }),
        );
      },
    },
    changes: {
      async read(afterCommitPosition: number, limit: number) {
        const items = changes
          .filter(({ commitPosition }) => commitPosition > afterCommitPosition)
          .slice(0, limit);
        return {
          items,
          retentionFloor: changes.length === 0 ? 0 : 1,
          highWatermark: changes.length,
          exhausted:
            items.length === 0
            || items.at(-1)?.commitPosition === changes.length,
        };
      },
    },
    snapshot: {
      async open() {
        return {
          frontier: snapshotFrontier,
          snapshotId: `snapshot-${snapshotFrontier}`,
        };
      },
      async read(
        _snapshotId: string,
        cursor: string | undefined,
        limit: number,
      ) {
        const entries = [...documents.entries()].sort(([left], [right]) =>
          left.localeCompare(right),
        );
        const offset = cursor ? Number.parseInt(cursor, 10) : 0;
        const page = entries.slice(offset, offset + limit);
        const nextOffset = offset + page.length;
        return {
          items: page.map(
            ([id, document]): ApplicationSearchHydratedDocument<SearchDocument> => ({
              id,
              document,
              sourceProjectionRevision: `source-${snapshotFrontier}`,
            }),
          ),
          ...(nextOffset < entries.length
            ? { cursor: String(nextOffset) }
            : {}),
          exhausted: nextOffset >= entries.length,
        };
      },
      async close() {},
    },
    fanOutCeiling: 8,
    maximumCandidateRows: 2,
  };
}

describe('PostgreSQL search runtime contract', () => {
  it('serializes scalar authorization filters as JSON text before PostgreSQL casts them', () => {
    expect(postgresApplicationSearchFilterJsonText('workspace-a')).toBe(
      '"workspace-a"',
    );
    expect(postgresApplicationSearchFilterJsonText(3)).toBe('3');
    expect(
      postgresApplicationSearchFilterJsonText({ state: 'ready' }),
    ).toBe('{"state":"ready"}');
    expect(() =>
      postgresApplicationSearchFilterJsonText(undefined),
    ).toThrow(/JSON-serializable/u);
  });

  it('emits durable state, GIN full-text, and JSONB index migrations', () => {
    const migration = postgresApplicationSearchMigrationSql('search_runtime');
    expect(migration.join('\n')).toContain(
      'CREATE TABLE IF NOT EXISTS "search_runtime"."applik8s_search_indexes"',
    );
    expect(migration.join('\n')).toContain(
      "to_tsvector('simple'::regconfig, search_text)",
    );
    expect(migration.join('\n')).toContain(
      'USING GIN (document jsonb_path_ops)',
    );
    expect(() =>
      postgresApplicationSearchMigrationSql('unsafe-name'),
    ).toThrow(/lowercase SQL identifier/);
  });
});

live('PostgreSQL search runtime live provider', () => {
  let administrativeSql: ApplicationPostgresSql;
  let runtime: PostgresApplicationSearchRuntime<SearchDocument>;

  beforeAll(async () => {
    administrativeSql = await createApplicationPostgresSql(
      databaseUrl as string,
      { max: 4, prepare: false },
    );
    await administrativeSql.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    runtime = await createPostgresApplicationSearchRuntime<SearchDocument>(
      runtimeOptions(administrativeSql),
    );
  });

  afterAll(async () => {
    await administrativeSql.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await administrativeSql.end({ timeout: 5 });
  });

  it('persists projection state and applies committed changes idempotently', async () => {
    documents.set('article-a', {
      title: 'Alpha launch',
      tenant: 'tenant-a',
      category: 'news',
      rank: 2,
    });
    documents.set('article-b', {
      title: 'Alpha architecture',
      tenant: 'tenant-a',
      category: 'engineering',
      rank: 1,
    });
    documents.set('article-c', {
      title: 'Alpha private',
      tenant: 'tenant-b',
      category: 'news',
      rank: 3,
    });
    changes.push(
      change(1, 'article-a', 'create'),
      change(2, 'article-b', 'create'),
      change(3, 'article-c', 'create'),
    );
    snapshotFrontier = 3;

    const synchronized = await runtime.synchronize();
    expect(synchronized).toMatchObject({
      applied: 3,
      checkpoint: 3,
      exhausted: true,
    });
    await expect(runtime.apply(requiredChange(3))).resolves.toBeUndefined();
    expect(runtime.state()).toMatchObject({
      activeGeneration: 'initial',
      checkpoint: 3,
      state: 'current',
    });

    const secondProcess =
      await createPostgresApplicationSearchRuntime<SearchDocument>(
        runtimeOptions(administrativeSql),
      );
    expect(secondProcess.state()).toMatchObject({
      activeGeneration: 'initial',
      checkpoint: 3,
    });
  });

  it('applies mandatory scope before facets, pagination, and results', async () => {
    const admission = {
      principalId: 'principal-a',
      contextDigest: 'context-a',
      authorizationVersion: 'grant-revision-1',
      where: { tenant: 'tenant-a' },
    } as const;
    const first = await runtime.search(
      {
        text: 'alpha',
        facets: [
          {
            name: 'category',
            asc: () => ({ field: 'category', direction: 'asc' as const }),
            desc: () => ({ field: 'category', direction: 'desc' as const }),
          },
        ],
        orderBy: { field: 'rank', direction: 'asc' },
        limit: 1,
      },
      admission,
    );
    expect(first.hits).toEqual([
      expect.objectContaining({
        document: expect.objectContaining({
          title: 'Alpha architecture',
          tenant: 'tenant-a',
        }),
      }),
    ]);
    expect(first.facets).toEqual({
      category: [
        { value: 'engineering', count: 1 },
        { value: 'news', count: 1 },
      ],
    });
    expect(first.cursor).toEqual(expect.any(String));
    const cursor = first.cursor;
    if (!cursor) throw new Error('Expected a second authorized search page.');

    documents.set('article-a', {
      ...requiredDocument('article-a'),
      rank: 4,
    });
    changes.push(change(4, 'article-a'));
    snapshotFrontier = 4;
    await runtime.apply(requiredChange(4));
    await expect(
      runtime.search(
        {
          text: 'alpha',
          facets: [],
          orderBy: { field: 'rank', direction: 'asc' },
          limit: 1,
          cursor,
        },
        admission,
      ),
    ).rejects.toMatchObject({
      code: 'APPLIK8S_SEARCH_CURSOR_INVALID',
    });

    await expect(
      runtime.search(
        { orderBy: { field: 'rank', direction: 'asc' } },
        {
          ...admission,
          where: {},
        },
      ),
    ).rejects.toBeInstanceOf(ApplicationPostgresSearchBoundError);
  });

  it('rebuilds, atomically cuts over, survives restart, and retires explicitly', async () => {
    const result = await runtime.rebuild({
      generation: 'generation-2',
      batchSize: 1,
    });
    expect(result).toMatchObject({
      generation: 'generation-2',
      previousGeneration: 'initial',
      sourceFrontier: 4,
      publishedCheckpoint: 4,
      documents: 3,
      validation: {
        count: 3,
        authorizationCompatible: true,
        schemaCompatible: true,
      },
    });
    expect(runtime.state()).toMatchObject({
      activeGeneration: 'generation-2',
      checkpoint: 4,
      previousGenerations: ['initial'],
    });

    const restarted =
      await createPostgresApplicationSearchRuntime<SearchDocument>(
        runtimeOptions(administrativeSql),
      );
    expect(restarted.state()).toMatchObject({
      activeGeneration: 'generation-2',
      checkpoint: 4,
      previousGenerations: ['initial'],
    });
    await restarted.retire('initial');
    expect(restarted.state().previousGenerations).toEqual([]);
    await expect(
      restarted.retire('generation-2'),
    ).rejects.toThrow(/cannot retire its active generation/);
  });

  it('serializes concurrent duplicate delivery across runtime processes', async () => {
    documents.set('article-b', {
      ...requiredDocument('article-b'),
      title: 'Alpha architecture revised',
    });
    changes.push(change(5, 'article-b'));
    snapshotFrontier = 5;
    const secondProcess =
      await createPostgresApplicationSearchRuntime<SearchDocument>(
        runtimeOptions(administrativeSql),
      );

    await expect(
      Promise.all([
        runtime.apply(requiredChange(5)),
        secondProcess.apply(requiredChange(5)),
      ]),
    ).resolves.toEqual([undefined, undefined]);
    await secondProcess.refresh();
    expect(secondProcess.state()).toMatchObject({
      activeGeneration: 'generation-2',
      checkpoint: 5,
    });
  });

  it('cleans durable rebuilding state when snapshot acquisition fails', async () => {
    const failingOptions = runtimeOptions(administrativeSql);
    const failing =
      await createPostgresApplicationSearchRuntime<SearchDocument>({
        ...failingOptions,
        logicalIndex: 'Article.snapshot-failure',
        snapshot: {
          ...failingOptions.snapshot,
          async open() {
            throw new Error('snapshot authority unavailable');
          },
        },
      });

    await expect(
      failing.rebuild({ generation: 'failed-generation' }),
    ).rejects.toThrow(/snapshot authority unavailable/);
    expect(failing.state().rebuildingGeneration).toBeUndefined();
    const rows = await administrativeSql.unsafe(
      `SELECT count(*)::int AS count
      FROM "${schema}"."applik8s_search_generations"
      WHERE logical_index = $1
        AND index_revision = $2
        AND generation = $3`,
      [
        'Article.snapshot-failure',
        'revision-1',
        'failed-generation',
      ],
    );
    expect(rows[0]?.count).toBe(0);
  });
});
