// typecast-file-boundary: provider-neutral search fixtures intentionally cross erased projection and cursor payload boundaries under validation.
import { describe, expect, test } from 'vitest';
import type { ApplicationSearchFieldHandle } from '../src/application-search.js';
import type {
  ApplicationSearchChangeSource,
  ApplicationSearchCommittedChange,
  ApplicationSearchHydratedDocument,
  ApplicationSearchHydration,
  ApplicationSearchSnapshotSource,
} from '../src/search-runtime.js';
import {
  ApplicationSearchCursorError,
  ApplicationSearchFanOutError,
  ApplicationSearchHistoryLossError,
  createDeterministicApplicationSearchRuntime,
} from '../src/search-runtime.js';

interface ProductDocument {
  readonly id: string;
  readonly organizationId: string;
  readonly title: string;
  readonly categoryName: string;
  readonly marketValue: number;
}

function requiredDocument(
  documents: ReadonlyMap<string, ProductDocument>,
  identity: string,
): ProductDocument {
  const candidate = documents.get(identity);
  if (!candidate) {
    throw new Error(`Expected search document ${identity}.`);
  }
  return candidate;
}

function change(
  commitPosition: number,
  sourceModel = 'Product',
  operation: ApplicationSearchCommittedChange['operation'] = 'update',
): ApplicationSearchCommittedChange {
  return {
    id: `change-${commitPosition}`,
    sourceModel,
    sourceIdentity: `${sourceModel.toLowerCase()}-${commitPosition}`,
    operation,
    commitPosition,
    transactionId: `transaction-${commitPosition}`,
    schemaRevision: 'schema-v1',
    recordedAt: `2026-07-29T00:00:${String(commitPosition).padStart(2, '0')}.000Z`,
  };
}

function fixture(options: {
  readonly changes?: ApplicationSearchCommittedChange[];
  readonly retentionFloor?: number;
  readonly fanOutCeiling?: number;
} = {}) {
  const documents = new Map<string, ProductDocument>([
    [
      'product-1',
      {
        id: 'product-1',
        organizationId: 'org-a',
        title: 'First edition Charizard',
        categoryName: 'Pokemon',
        marketValue: 500,
      },
    ],
    [
      'product-2',
      {
        id: 'product-2',
        organizationId: 'org-b',
        title: 'Charizard reprint',
        categoryName: 'Pokemon',
        marketValue: 50,
      },
    ],
  ]);
  const affected = new Map<string, readonly string[]>();
  const sourceChanges = [...(options.changes ?? [])];
  let retentionFloor = options.retentionFloor ?? 1;
  let snapshotFrontier = 0;
  const hydration: ApplicationSearchHydration<ProductDocument> = {
    async affectedRoots(committed, { maximum }) {
      const identities =
        affected.get(committed.id)
        ?? (committed.sourceModel === 'Product'
          ? [committed.sourceIdentity]
          : []);
      return {
        identities: identities.slice(0, maximum),
        complete: identities.length <= maximum,
      };
    },
    async hydrate(identities) {
      return identities.map((id) => ({
        id,
        document: documents.get(id) ?? null,
        sourceProjectionRevision: `source-${id}`,
      }));
    },
  };
  const changes: ApplicationSearchChangeSource = {
    async read(after, limit) {
      const items = sourceChanges
        .filter(({ commitPosition }) => commitPosition > after)
        .sort((left, right) => left.commitPosition - right.commitPosition)
        .slice(0, limit);
      const highWatermark = sourceChanges.at(-1)?.commitPosition ?? after;
      return {
        items,
        retentionFloor,
        highWatermark,
        exhausted:
          items.length === 0
          || (items.at(-1)?.commitPosition ?? after) >= highWatermark,
      };
    },
  };
  const snapshots = new Map<
    string,
    readonly ApplicationSearchHydratedDocument<ProductDocument>[]
  >();
  const snapshot: ApplicationSearchSnapshotSource<ProductDocument> = {
    async open() {
      const snapshotId = `snapshot-${snapshotFrontier}`;
      snapshots.set(
        snapshotId,
        [...documents.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([id, document]) => ({
            id,
            document: structuredClone(document),
            sourceProjectionRevision: `snapshot-${snapshotFrontier}`,
          })),
      );
      return { frontier: snapshotFrontier, snapshotId };
    },
    async read(snapshotId, cursor, limit) {
      const items = snapshots.get(snapshotId);
      if (!items) throw new Error(`Unknown snapshot ${snapshotId}.`);
      const offset = cursor ? Number(cursor) : 0;
      const page = items.slice(offset, offset + limit);
      const next = offset + page.length;
      return {
        items: page,
        ...(next < items.length ? { cursor: String(next) } : {}),
        exhausted: next >= items.length,
      };
    },
    async close(snapshotId) {
      snapshots.delete(snapshotId);
    },
  };
  const runtime = createDeterministicApplicationSearchRuntime<ProductDocument>({
    logicalIndex: 'products',
    indexRevision: 'revision-v1',
    cursorSecret: 'test-search-cursor-secret-with-at-least-32-bytes',
    fields: {
      id: { kind: 'filter' },
      organizationId: { kind: 'filter' },
      title: { kind: 'text', boost: 4 },
      categoryName: { kind: 'facet' },
      marketValue: { kind: 'sort' },
    },
    hydration,
    changes,
    snapshot,
    fanOutCeiling: options.fanOutCeiling ?? 100,
  });
  return {
    runtime,
    documents,
    affected,
    sourceChanges,
    setRetentionFloor(value: number) {
      retentionFloor = value;
    },
    setSnapshotFrontier(value: number) {
      snapshotFrontier = value;
    },
  };
}

const orgA = {
  principalId: 'principal-a',
  contextDigest: 'context-a',
  authorizationVersion: 'authority-1',
  where: { organizationId: 'org-a' },
} as const;

describe('search projection runtime', () => {
  test('applies whole-document changes idempotently and rehydrates related roots', async () => {
    const state = fixture();
    state.affected.set('change-1', ['product-1']);
    await state.runtime.apply(change(1));
    await state.runtime.apply(change(1));

    state.documents.set('product-1', {
      ...requiredDocument(state.documents, 'product-1'),
      categoryName: 'Collectibles',
    });
    state.affected.set('change-2', ['product-1']);
    await state.runtime.apply(change(2, 'Category'));
    expect(
      await state.runtime.search(
        { where: { categoryName: 'Collectibles' } },
        orgA,
      ),
    ).toMatchObject({
      hits: [{ document: { id: 'product-1', categoryName: 'Collectibles' } }],
      physicalGeneration: 'initial',
    });

    state.documents.delete('product-1');
    state.affected.set('change-3', ['product-1']);
    await state.runtime.apply(change(3, 'Product', 'delete'));
    expect((await state.runtime.search({}, orgA)).hits).toEqual([]);
    expect(state.runtime.state().checkpoint).toBe(3);
  });

  test('fails closed for non-contiguous work, fan-out, and retained-history loss', async () => {
    const state = fixture({ fanOutCeiling: 1 });
    await expect(state.runtime.apply(change(2))).rejects.toThrow(
      /non-contiguous commit position/,
    );

    state.affected.set('change-1', ['product-1', 'product-2']);
    await expect(state.runtime.apply(change(1, 'Category'))).rejects.toBeInstanceOf(
      ApplicationSearchFanOutError,
    );

    const retained = fixture({
      changes: [change(5)],
      retentionFloor: 5,
    });
    await expect(retained.runtime.synchronize()).rejects.toBeInstanceOf(
      ApplicationSearchHistoryLossError,
    );
    expect(retained.runtime.state().state).toBe('rebuildRequired');
  });

  test('rebuilds an inactive generation, catches up, validates, and cuts over atomically', async () => {
    const state = fixture();
    state.setSnapshotFrontier(0);
    state.sourceChanges.push(change(1), change(2));
    state.affected.set('change-1', ['product-1']);
    state.affected.set('change-2', ['product-2']);

    const result = await state.runtime.rebuild({
      generation: 'generation-2',
      batchSize: 1,
      validate(evidence) {
        expect(evidence).toMatchObject({
          count: 2,
          authorizationCompatible: true,
          schemaCompatible: true,
        });
      },
    });

    expect(result).toMatchObject({
      generation: 'generation-2',
      previousGeneration: 'initial',
      publishedCheckpoint: 2,
      documents: 2,
    });
    expect(state.runtime.state()).toMatchObject({
      activeGeneration: 'generation-2',
      checkpoint: 2,
      previousGenerations: ['initial'],
    });
    await state.runtime.retire('initial');
    expect(state.runtime.state().previousGenerations).toEqual([]);
  });

  test('discards an unvalidated generation and permits a clean retry', async () => {
    const state = fixture();
    await expect(
      state.runtime.rebuild({
        generation: 'candidate',
        validate() {
          throw new Error('independent validation failed');
        },
      }),
    ).rejects.toThrow(/independent validation failed/);

    expect(state.runtime.state()).toMatchObject({
      activeGeneration: 'initial',
      previousGenerations: [],
    });
    expect(state.runtime.state().rebuildingGeneration).toBeUndefined();

    await expect(
      state.runtime.rebuild({ generation: 'candidate' }),
    ).resolves.toMatchObject({
      generation: 'candidate',
      previousGeneration: 'initial',
    });
  });

  test('reports bounded committed-change lag until synchronization catches up', async () => {
    const state = fixture({
      changes: [change(1), change(2), change(3)],
    });
    for (const position of [1, 2, 3]) {
      state.affected.set(`change-${position}`, [`product-${position}`]);
    }

    await expect(
      state.runtime.synchronize({ batchSize: 1, maximumBatches: 1 }),
    ).resolves.toMatchObject({
      checkpoint: 1,
      exhausted: false,
    });
    expect((await state.runtime.search({}, orgA)).lag).toMatchObject({
      changes: 2,
      state: 'lagging',
    });

    await expect(state.runtime.synchronize()).resolves.toMatchObject({
      checkpoint: 3,
      exhausted: true,
    });
    expect((await state.runtime.search({}, orgA)).lag).toEqual({
      changes: 0,
      milliseconds: 0,
      state: 'current',
    });
  });

  test('intersects mandatory authorization before facets and binds cursors to context and generation', async () => {
    const state = fixture();
    state.setSnapshotFrontier(0);
    await state.runtime.rebuild({ generation: 'generation-2' });
    const categoryFacet = {
      name: 'categoryName',
      asc: () => ({ field: 'categoryName', direction: 'asc' as const }),
      desc: () => ({ field: 'categoryName', direction: 'desc' as const }),
    } satisfies ApplicationSearchFieldHandle<
      string,
      keyof ProductDocument & string
    >;
    const first = await state.runtime.search(
      {
        text: 'charizard',
        facets: [categoryFacet],
        orderBy: { field: 'marketValue', direction: 'desc' },
        limit: 1,
      },
      orgA,
    );
    expect(first.hits).toHaveLength(1);
    expect(first.hits[0]?.document.organizationId).toBe('org-a');
    expect(first.hits[0]?.score).toBe(4);
    expect(first.facets.categoryName).toEqual([
      { value: 'Pokemon', count: 1 },
    ]);
    expect(first.cursor).toBeUndefined();

    const bothOrganizations = {
      ...orgA,
      where: {},
    };
    const paged = await state.runtime.search(
      { orderBy: { field: 'marketValue', direction: 'desc' }, limit: 1 },
      bothOrganizations,
    );
    const pagedCursor = paged.cursor;
    if (!pagedCursor) throw new Error('Expected a second search page.');
    await expect(
      state.runtime.search(
        {
          orderBy: { field: 'marketValue', direction: 'desc' },
          limit: 1,
          cursor: pagedCursor,
        },
        { ...bothOrganizations, contextDigest: 'different-context' },
      ),
    ).rejects.toBeInstanceOf(ApplicationSearchCursorError);

    state.setSnapshotFrontier(0);
    await state.runtime.rebuild({ generation: 'generation-3' });
    await expect(
      state.runtime.search(
        {
          orderBy: { field: 'marketValue', direction: 'desc' },
          limit: 1,
          cursor: pagedCursor,
        },
        bothOrganizations,
      ),
    ).rejects.toThrow(/physicalGeneration/);
  });

  test('fails closed when mandatory admission references undeclared or non-filterable fields', async () => {
    const state = fixture();
    await state.runtime.rebuild({ generation: 'generation-2' });

    await expect(
      state.runtime.search(
        {},
        {
          ...orgA,
          where: { undeclared: 'value' },
        } as never,
      ),
    ).rejects.toThrow(/admission filter field undeclared is not indexed/);
    await expect(
      state.runtime.search(
        {},
        {
          ...orgA,
          where: { title: 'Charizard' },
        },
      ),
    ).rejects.toThrow(/title is not filterable for admission scope/);
  });

  test('rejects a cursor after its active generation advances to a new committed checkpoint', async () => {
    const state = fixture();
    state.setSnapshotFrontier(0);
    await state.runtime.rebuild({ generation: 'generation-2' });
    const admission = { ...orgA, where: {} };
    const first = await state.runtime.search(
      { orderBy: { field: 'marketValue', direction: 'desc' }, limit: 1 },
      admission,
    );
    const firstCursor = first.cursor;
    if (!firstCursor) throw new Error('Expected a second search page.');

    state.affected.set('change-1', ['product-1']);
    await state.runtime.apply(change(1));

    await expect(
      state.runtime.search(
        {
          orderBy: { field: 'marketValue', direction: 'desc' },
          limit: 1,
          cursor: firstCursor,
        },
        admission,
      ),
    ).rejects.toThrow(/checkpoint/);
  });
});
