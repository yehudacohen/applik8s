import type {
  ApplicationSearchCommittedChange,
  ApplicationSearchHydratedDocument,
} from '@applik8s/applik8s';
import { describe, expect, test } from 'vitest';
import {
  ApplicationOpenSearchSearchUnavailableError,
  createOpenSearchApplicationSearchRuntime,
} from '../src/index.js';

interface SearchDocument {
  readonly title: string;
  readonly tenant: string;
  readonly category: string;
  readonly rank: number;
}

interface StoredDocument {
  source: Record<string, unknown>;
  sequence: number;
}

interface StoredIndex {
  readonly documents: Map<string, StoredDocument>;
  primaryTerm: number;
}

class FakeOpenSearch {
  readonly indexes = new Map<string, StoredIndex>();
  readonly aliases = new Map<string, string>();
  readonly snapshots: {
    readonly repository: string;
    readonly snapshot: string;
    readonly index: string;
  }[] = [];
  private readonly pointsInTime = new Map<
    string,
    Map<string, Record<string, unknown>>
  >();
  private nextPointInTime = 1;

  readonly fetch = (async (input, init = {}) => {
    const url = new URL(
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input
          : input.url,
    );
    const method = (init.method ?? 'GET').toUpperCase();
    const path = decodeURIComponent(url.pathname);
    const body = await requestBody(init.body);
    try {
      return await this.route(method, path, body, url.searchParams);
    } catch (error) {
      return jsonResponse(
        500,
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
  }) as typeof globalThis.fetch;

  private async route(
    method: string,
    path: string,
    body: unknown,
    parameters: URLSearchParams,
  ): Promise<Response> {
    if (method === 'HEAD' && path.startsWith('/_alias/')) {
      return new Response(null, {
        status: this.aliases.has(path.slice('/_alias/'.length)) ? 200 : 404,
      });
    }
    if (method === 'HEAD' && path.split('/').length === 2) {
      return new Response(null, {
        status: this.indexes.has(path.slice(1)) ? 200 : 404,
      });
    }
    if (method === 'PUT' && path.split('/').length === 2) {
      const index = path.slice(1);
      if (this.indexes.has(index)) {
        return jsonResponse(400, { error: 'resource_already_exists' });
      }
      this.indexes.set(index, {
        documents: new Map(),
        primaryTerm: 1,
      });
      return jsonResponse(200, { acknowledged: true });
    }
    if (method === 'DELETE' && path.split('/').length === 2) {
      const index = path.slice(1);
      this.indexes.delete(index);
      for (const [alias, candidate] of this.aliases) {
        if (candidate === index) this.aliases.delete(alias);
      }
      return jsonResponse(200, { acknowledged: true });
    }
    if (method === 'POST' && path === '/_aliases') {
      const request = requiredRecord(body);
      const actions = requiredArray(request.actions);
      for (const action of actions) {
        const value = requiredRecord(action);
        if (value.remove) {
          const remove = requiredRecord(value.remove);
          this.aliases.delete(String(remove.alias));
        }
        if (value.add) {
          const add = requiredRecord(value.add);
          this.aliases.set(String(add.alias), String(add.index));
        }
      }
      return jsonResponse(200, { acknowledged: true });
    }
    if (method === 'GET' && path.startsWith('/_alias/')) {
      const alias = path.slice('/_alias/'.length);
      const index = this.aliases.get(alias);
      return index
        ? jsonResponse(200, { [index]: { aliases: { [alias]: {} } } })
        : jsonResponse(404, { error: 'alias_not_found' });
    }
    const documentMatch = path.match(/^\/([^/]+)\/_doc\/(.+)$/u);
    if (documentMatch) {
      const indexName = documentMatch[1];
      const identity = documentMatch[2];
      if (!indexName || !identity) {
        return jsonResponse(400, { error: 'bad_document_path' });
      }
      const index = this.requiredIndex(indexName);
      if (method === 'GET') {
        const stored = index.documents.get(identity);
        return stored
          ? jsonResponse(200, {
              _source: structuredClone(stored.source),
              _seq_no: stored.sequence,
              _primary_term: index.primaryTerm,
            })
          : jsonResponse(404, { found: false });
      }
      if (method === 'PUT') {
        const ifSequence = queryInteger(parameters, 'if_seq_no');
        const current = index.documents.get(identity);
        if (
          ifSequence !== undefined
          && current?.sequence !== ifSequence
        ) {
          return jsonResponse(409, { error: 'version_conflict' });
        }
        const sequence = (current?.sequence ?? -1) + 1;
        index.documents.set(identity, {
          source: requiredRecord(body),
          sequence,
        });
        return jsonResponse(201, {
          _seq_no: sequence,
          _primary_term: index.primaryTerm,
        });
      }
    }
    if (
      method === 'POST'
      && path.endsWith('/_search/point_in_time')
    ) {
      const indexOrAlias = path.slice(
        1,
        -'/_search/point_in_time'.length,
      );
      const index = this.aliases.get(indexOrAlias) ?? indexOrAlias;
      const stored = this.requiredIndex(index);
      const pointInTime = `pit-${this.nextPointInTime++}`;
      this.pointsInTime.set(
        pointInTime,
        new Map(
          [...stored.documents].map(([id, document]) => [
            id,
            structuredClone(document.source),
          ]),
        ),
      );
      return jsonResponse(200, { pit_id: pointInTime });
    }
    if (method === 'DELETE' && path === '/_search/point_in_time') {
      const request = requiredRecord(body);
      this.pointsInTime.delete(String(request.pit_id));
      return jsonResponse(200, { succeeded: true });
    }
    if (method === 'POST' && path === '/_search') {
      return this.search(requiredRecord(body));
    }
    if (method === 'POST' && path === '/_bulk') {
      return this.bulk(String(body ?? ''));
    }
    if (method === 'PUT' && path.startsWith('/_snapshot/')) {
      const [, , repository, snapshot] = path.split('/');
      const request = requiredRecord(body);
      this.snapshots.push({
        repository: String(repository),
        snapshot: String(snapshot),
        index: String(request.indices),
      });
      return jsonResponse(200, {
        snapshot: { state: 'SUCCESS' },
      });
    }
    return jsonResponse(404, { error: `${method} ${path} not found` });
  }

  private bulk(body: string): Response {
    const lines = body.trim().split('\n').map((line) =>
      requiredRecord(JSON.parse(line) as unknown),
    );
    const items: Record<string, unknown>[] = [];
    let errors = false;
    for (let index = 0; index < lines.length; index += 1) {
      const action = lines[index];
      if (!action) continue;
      const [operation, rawMetadata] = Object.entries(action)[0] ?? [];
      const metadata = requiredRecord(rawMetadata);
      const indexName = String(metadata._index);
      const identity = String(metadata._id);
      const store = this.requiredIndex(indexName);
      if (operation === 'delete') {
        const deleted = store.documents.delete(identity);
        const status = deleted ? 200 : 404;
        items.push({ delete: { status } });
        continue;
      }
      if (operation !== 'index') {
        throw new Error(`Unsupported bulk operation ${operation}.`);
      }
      const source = lines[index + 1];
      if (!source) throw new Error('Bulk index action has no source.');
      index += 1;
      const current = store.documents.get(identity);
      if (
        metadata.if_seq_no !== undefined
        && Number(metadata.if_seq_no) !== current?.sequence
      ) {
        errors = true;
        items.push({
          index: {
            status: 409,
            error: { type: 'version_conflict_engine_exception' },
          },
        });
        continue;
      }
      const sequence = (current?.sequence ?? -1) + 1;
      store.documents.set(identity, {
        source,
        sequence,
      });
      items.push({ index: { status: 201 } });
    }
    return jsonResponse(200, { errors, items });
  }

  private search(request: Record<string, unknown>): Response {
    const pit = requiredRecord(request.pit);
    const documents = this.pointsInTime.get(String(pit.id));
    if (!documents) return jsonResponse(404, { error: 'pit_missing' });
    const query = requiredRecord(request.query);
    let hits = [...documents].map(([id, source]) => ({
      id,
      source,
      score: 0,
      sort: [] as unknown[],
      highlight: {} as Record<string, string[]>,
    }));
    if (query.ids) {
      const ids = requiredArray(requiredRecord(query.ids).values).map(String);
      hits = hits.filter(({ id }) => ids.includes(id));
    } else if (query.term) {
      hits = hits.filter(({ source }) =>
        matchesFilter(source, { term: query.term }),
      );
    } else {
      const bool = requiredRecord(query.bool);
      const filters = requiredArray(bool.filter);
      hits = hits.filter(({ source }) =>
        filters.every((filter) => matchesFilter(source, filter)),
      );
      const must = Array.isArray(bool.must) ? bool.must : [];
      if (must.length > 0) {
        const simple = requiredRecord(
          requiredRecord(must[0]).simple_query_string,
        );
        const queryText = String(simple.query).toLocaleLowerCase();
        const fields = requiredArray(simple.fields).map(String);
        hits = hits
          .map((hit) => {
            let score = 0;
            const highlight: Record<string, string[]> = {};
            for (const weighted of fields) {
              const [path, boostValue] = weighted.split('^');
              if (!path) continue;
              const value = nestedValue(hit.source, path);
              if (
                typeof value === 'string'
                && value.toLocaleLowerCase().includes(queryText)
              ) {
                score += Number(boostValue ?? 1);
                highlight[path] = [
                  value.replace(
                    new RegExp(queryText, 'giu'),
                    (match) => `<em>${match}</em>`,
                  ),
                ];
              }
            }
            return { ...hit, score, highlight };
          })
          .filter(({ score }) => score > 0);
      }
    }
    const requestedSort = Array.isArray(request.sort) ? request.sort : [];
    hits.sort((left, right) => compareHits(left, right, requestedSort));
    hits = hits.map((hit) => ({
      ...hit,
      sort: sortValues(hit, requestedSort),
    }));
    if (Array.isArray(request.search_after)) {
      const encoded = JSON.stringify(request.search_after);
      const position = hits.findIndex(
        ({ sort }) => JSON.stringify(sort) === encoded,
      );
      hits = position < 0 ? [] : hits.slice(position + 1);
    }
    const aggregationSource = [...hits];
    const size = Number(request.size ?? 10);
    const page = hits.slice(0, size);
    const aggregations = Object.fromEntries(
      Object.entries(
        isRecord(request.aggs) ? request.aggs : {},
      ).map(([name, aggregation]) => {
        const field = String(
          requiredRecord(requiredRecord(aggregation).terms).field,
        );
        const counts = new Map<unknown, number>();
        for (const hit of aggregationSource) {
          const value = nestedValue(hit.source, field);
          counts.set(value, (counts.get(value) ?? 0) + 1);
        }
        return [
          name,
          {
            buckets: [...counts].map(([key, count]) => ({
              key,
              doc_count: count,
            })),
          },
        ];
      }),
    );
    return jsonResponse(200, {
      hits: {
        hits: page.map((hit) => ({
          _id: hit.id,
          _score: hit.score,
          _source: structuredClone(hit.source),
          sort: hit.sort,
          ...(Object.keys(hit.highlight).length > 0
            ? { highlight: hit.highlight }
            : {}),
        })),
      },
      aggregations,
    });
  }

  private requiredIndex(name: string): StoredIndex {
    const index = this.indexes.get(name);
    if (!index) throw new Error(`Unknown index ${name}.`);
    return index;
  }
}

function change(position: number, identity: string) {
  return {
    id: `change-${position}`,
    sourceModel: 'Article',
    sourceIdentity: identity,
    operation: position === 1 ? 'create' : 'update',
    commitPosition: position,
    transactionId: `transaction-${position}`,
    schemaRevision: 'article-v1',
    recordedAt: new Date(1_800_000_000_000 + position).toISOString(),
  } satisfies ApplicationSearchCommittedChange;
}

function fixture() {
  const server = new FakeOpenSearch();
  const documents = new Map<string, SearchDocument>([
    [
      'a',
      {
        title: 'Alpha architecture',
        tenant: 'tenant-a',
        category: 'engineering',
        rank: 1,
      },
    ],
    [
      'b',
      {
        title: 'Alpha launch',
        tenant: 'tenant-a',
        category: 'news',
        rank: 2,
      },
    ],
    [
      'c',
      {
        title: 'Alpha private',
        tenant: 'tenant-b',
        category: 'news',
        rank: 3,
      },
    ],
  ]);
  const changes: ApplicationSearchCommittedChange[] = [];
  let snapshotFrontier = 0;
  let snapshotFails = false;
  const runtimeOptions = {
    logicalIndex: 'Article.search',
    indexRevision: 'revision-1',
    endpoint: 'https://opensearch.test',
    fetch: server.fetch,
    cursorSecret: 'cursor-secret',
    fields: {
      title: { kind: 'text' as const, valueType: 'string' as const, boost: 4 },
      tenant: { kind: 'filter' as const, valueType: 'string' as const },
      category: { kind: 'facet' as const, valueType: 'string' as const },
      rank: { kind: 'filter' as const, valueType: 'number' as const },
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
      async read(after: number, limit: number) {
        const items = changes
          .filter(({ commitPosition }) => commitPosition > after)
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
        if (snapshotFails) throw new Error('snapshot unavailable');
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
        const entries = [...documents].sort(([left], [right]) =>
          left.localeCompare(right),
        );
        const offset = cursor ? Number(cursor) : 0;
        const page = entries.slice(offset, offset + limit);
        const next = offset + page.length;
        return {
          items: page.map(([id, document]) => ({
            id,
            document,
            sourceProjectionRevision: `source-${snapshotFrontier}`,
          })),
          ...(next < entries.length ? { cursor: String(next) } : {}),
          exhausted: next >= entries.length,
        };
      },
      async close() {},
    },
    fanOutCeiling: 8,
  };
  return {
    server,
    documents,
    changes,
    runtimeOptions,
    setSnapshotFrontier(value: number) {
      snapshotFrontier = value;
    },
    setSnapshotFails(value: boolean) {
      snapshotFails = value;
    },
  };
}

function requiredChange(
  changes: readonly ApplicationSearchCommittedChange[],
  position: number,
): ApplicationSearchCommittedChange {
  const candidate = changes[position - 1];
  if (!candidate) throw new Error(`Expected committed change ${position}.`);
  return candidate;
}

const tenantA = {
  principalId: 'principal-a',
  contextDigest: 'context-a',
  authorizationVersion: 'authority-1',
  where: { tenant: 'tenant-a' },
} as const;

describe('OpenSearch application search runtime', () => {
  test('publishes idempotent changes and applies authorization before every observable result', async () => {
    const state = fixture();
    const runtime =
      await createOpenSearchApplicationSearchRuntime<SearchDocument>(
        state.runtimeOptions,
      );
    state.changes.push(
      change(1, 'a'),
      change(2, 'b'),
      change(3, 'c'),
    );
    state.setSnapshotFrontier(3);
    await expect(runtime.synchronize()).resolves.toMatchObject({
      applied: 3,
      checkpoint: 3,
      exhausted: true,
    });
    await expect(runtime.apply(requiredChange(state.changes, 3)))
      .resolves.toBeUndefined();

    const category = {
      name: 'category' as const,
      asc: () => ({
        field: 'category' as const,
        direction: 'asc' as const,
      }),
      desc: () => ({
        field: 'category' as const,
        direction: 'desc' as const,
      }),
    };
    const result = await runtime.search(
      {
        text: 'alpha',
        facets: [category],
        orderBy: { field: 'rank', direction: 'asc' },
        limit: 1,
      },
      tenantA,
    );
    expect(result.hits).toEqual([
      {
        document: expect.objectContaining({
          title: 'Alpha architecture',
          tenant: 'tenant-a',
        }),
        score: 4,
        highlights: {
          title: ['<em>Alpha</em> architecture'],
        },
      },
    ]);
    expect(result.facets).toEqual({
      category: [
        { value: 'engineering', count: 1 },
        { value: 'news', count: 1 },
      ],
    });
    expect(result.cursor).toEqual(expect.any(String));
    const cursor = result.cursor;
    if (!cursor) throw new Error('Expected a second search page.');

    state.documents.set('b', {
      title: 'Alpha launch updated',
      tenant: 'tenant-a',
      category: 'news',
      rank: 2,
    });
    state.changes.push(change(4, 'b'));
    state.setSnapshotFrontier(4);
    const secondRuntime =
      await createOpenSearchApplicationSearchRuntime<SearchDocument>(
        state.runtimeOptions,
      );
    await expect(
      Promise.all([
        runtime.apply(requiredChange(state.changes, 4)),
        secondRuntime.apply(requiredChange(state.changes, 4)),
      ]),
    ).resolves.toEqual([undefined, undefined]);
    await expect(
      runtime.search(
        {
          text: 'alpha',
          orderBy: { field: 'rank', direction: 'asc' },
          limit: 1,
          cursor,
        },
        tenantA,
      ),
    ).rejects.toThrow(/checkpoint/);
  });

  test('rebuilds an inactive generation, cuts over atomically, snapshots, and retires explicitly', async () => {
    const state = fixture();
    const runtime =
      await createOpenSearchApplicationSearchRuntime<SearchDocument>(
        state.runtimeOptions,
      );
    state.setSnapshotFrontier(0);
    const rebuilt = await runtime.rebuild({
      generation: 'generation-2',
      batchSize: 1,
    });
    expect(rebuilt).toMatchObject({
      generation: 'generation-2',
      previousGeneration: 'initial',
      documents: 3,
      validation: {
        count: 3,
        schemaCompatible: true,
        authorizationCompatible: true,
      },
    });
    expect(runtime.state()).toMatchObject({
      activeGeneration: 'generation-2',
      previousGenerations: ['initial'],
    });

    await runtime.snapshotGeneration({
      repository: 'backups',
      snapshot: 'generation-2',
    });
    expect(state.server.snapshots).toEqual([
      expect.objectContaining({
        repository: 'backups',
        snapshot: 'generation-2',
      }),
    ]);
    await runtime.retire('initial');
    expect(runtime.state().previousGenerations).toEqual([]);
  });

  test('cleans a failed candidate and leaves the active generation readable', async () => {
    const state = fixture();
    const runtime =
      await createOpenSearchApplicationSearchRuntime<SearchDocument>(
        state.runtimeOptions,
      );
    state.setSnapshotFails(true);
    await expect(
      runtime.rebuild({ generation: 'failed-generation' }),
    ).rejects.toThrow(/snapshot unavailable/);
    expect(runtime.state()).toMatchObject({
      activeGeneration: 'initial',
      previousGenerations: [],
    });
    expect(runtime.state().rebuildingGeneration).toBeUndefined();
    await expect(runtime.search({}, tenantA)).resolves.toMatchObject({
      physicalGeneration: 'initial',
    });
  });

  test('fails closed while a publication is in flight', async () => {
    const state = fixture();
    const runtime =
      await createOpenSearchApplicationSearchRuntime<SearchDocument>(
        state.runtimeOptions,
      );
    const index = [...state.server.indexes.keys()][0];
    if (!index) throw new Error('Expected an initialized OpenSearch index.');
    const stored = state.server.indexes
      .get(index)
      ?.documents.get('__applik8s_search_state');
    if (!stored) throw new Error('Expected durable OpenSearch state.');
    stored.source.inFlight = {
      position: 1,
      changeId: 'change-1',
      token: 'worker',
      claimedAt: new Date().toISOString(),
    };
    await expect(runtime.search({}, tenantA)).rejects.toBeInstanceOf(
      ApplicationOpenSearchSearchUnavailableError,
    );
  });
});

function matchesFilter(
  source: Record<string, unknown>,
  candidate: unknown,
): boolean {
  const filter = requiredRecord(candidate);
  if (filter.term) {
    const [field, expected] =
      Object.entries(requiredRecord(filter.term))[0] ?? [];
    return field !== undefined
      && Object.is(nestedValue(source, field), expected);
  }
  if (filter.terms) {
    const [field, expected] =
      Object.entries(requiredRecord(filter.terms))[0] ?? [];
    return field !== undefined
      && requiredArray(expected).includes(nestedValue(source, field));
  }
  if (filter.range) {
    const [field, rawRange] =
      Object.entries(requiredRecord(filter.range))[0] ?? [];
    if (!field) return false;
    const actual = nestedValue(source, field);
    const range = requiredRecord(rawRange);
    return Object.entries(range).every(([operator, expected]) => {
      if (operator === 'gte') return compare(actual, expected) >= 0;
      if (operator === 'gt') return compare(actual, expected) > 0;
      if (operator === 'lte') return compare(actual, expected) <= 0;
      if (operator === 'lt') return compare(actual, expected) < 0;
      return false;
    });
  }
  if (filter.bool) {
    const bool = requiredRecord(filter.bool);
    return !requiredArray(bool.must_not).some((nested) =>
      matchesFilter(source, nested),
    );
  }
  if (filter.ids) return true;
  throw new Error(`Unsupported fake filter ${JSON.stringify(filter)}.`);
}

function compareHits(
  left: {
    readonly id: string;
    readonly source: Record<string, unknown>;
    readonly score: number;
  },
  right: {
    readonly id: string;
    readonly source: Record<string, unknown>;
    readonly score: number;
  },
  sort: readonly unknown[],
): number {
  for (const raw of sort) {
    const [field, configuration] =
      Object.entries(requiredRecord(raw))[0] ?? [];
    if (!field) continue;
    const direction =
      typeof configuration === 'string'
        ? configuration
        : String(requiredRecord(configuration).order);
    const leftValue =
      field === '_score'
        ? left.score
        : field === 'documentIdentity'
          ? nestedValue(left.source, 'documentIdentity')
          : nestedValue(left.source, field);
    const rightValue =
      field === '_score'
        ? right.score
        : field === 'documentIdentity'
          ? nestedValue(right.source, 'documentIdentity')
          : nestedValue(right.source, field);
    const result = compare(leftValue, rightValue);
    if (result !== 0) return direction === 'desc' ? -result : result;
  }
  return left.id.localeCompare(right.id);
}

function sortValues(
  hit: {
    readonly id: string;
    readonly source: Record<string, unknown>;
    readonly score: number;
  },
  sort: readonly unknown[],
): unknown[] {
  return sort.map((raw) => {
    const field = Object.keys(requiredRecord(raw))[0];
    if (field === '_score') return hit.score;
    if (field === 'documentIdentity') {
      return nestedValue(hit.source, 'documentIdentity');
    }
    return field ? nestedValue(hit.source, field) : hit.id;
  });
}

function nestedValue(
  value: Record<string, unknown>,
  path: string,
): unknown {
  return path.split('.').reduce<unknown>(
    (current, segment) =>
      isRecord(current) ? current[segment] : undefined,
    value,
  );
}

function compare(left: unknown, right: unknown): number {
  if (Object.is(left, right)) return 0;
  if (left === undefined || left === null) return -1;
  if (right === undefined || right === null) return 1;
  return left < right ? -1 : 1;
}

async function requestBody(
  body: BodyInit | null | undefined,
): Promise<unknown> {
  if (body === undefined || body === null) return undefined;
  const text =
    typeof body === 'string'
      ? body
      : await new Response(body).text();
  if (!text) return undefined;
  if (text.includes('\n') && text.trim().split('\n').length > 1) {
    return text;
  }
  return JSON.parse(text) as unknown;
}

function jsonResponse(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function queryInteger(
  parameters: URLSearchParams,
  name: string,
): number | undefined {
  const value = parameters.get(name);
  return value === null ? undefined : Number(value);
}

function requiredRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error('Expected an object.');
  return value;
}

function requiredArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Expected an array.');
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
