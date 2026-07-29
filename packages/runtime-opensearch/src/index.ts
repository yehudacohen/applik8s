import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import type {
  ApplicationSearchAdmissionScope,
  ApplicationSearchChangePage,
  ApplicationSearchChangeSource,
  ApplicationSearchCommittedChange,
  ApplicationSearchComparison,
  ApplicationSearchHydratedDocument,
  ApplicationSearchHydration,
  ApplicationSearchProjectionState,
  ApplicationSearchRebuildResult,
  ApplicationSearchRebuildValidation,
  ApplicationSearchRequest,
  ApplicationSearchResult,
  ApplicationSearchRuntime,
  ApplicationSearchRuntimeField,
  ApplicationSearchRuntimeFields,
  ApplicationSearchSnapshotSource,
} from '@applik8s/applik8s';
import {
  ApplicationSearchCursorError,
  ApplicationSearchFanOutError,
  ApplicationSearchHistoryLossError,
} from '@applik8s/applik8s';

const STATE_DOCUMENT_ID = '__applik8s_search_state';
const INTERNAL_KIND_FIELD = '__applik8s_kind';
const DOCUMENT_KIND = 'document';
const STATE_KIND = 'state';
const CHANGE_KIND = 'change';

export interface OpenSearchBasicAuthentication {
  readonly username: string;
  readonly password: string;
}

export interface OpenSearchApplicationSearchRuntimeOptions<
  TDocument extends object,
> {
  readonly logicalIndex: string;
  readonly indexRevision: string;
  readonly endpoint: string;
  readonly authentication?: OpenSearchBasicAuthentication;
  readonly headers?: Readonly<Record<string, string>>;
  /**
   * Injectable transport for mTLS, private CAs, service meshes, tests, and
   * non-Node runtimes. The runtime never weakens TLS verification itself.
   */
  readonly fetch?: typeof globalThis.fetch;
  readonly requestTimeoutMilliseconds?: number;
  readonly indexPrefix?: string;
  readonly initialGeneration?: string;
  readonly initialCheckpoint?: number;
  readonly sourceProjectionRevision?: string;
  readonly cursorSecret: string;
  readonly fields: ApplicationSearchRuntimeFields<TDocument>;
  readonly hydration: ApplicationSearchHydration<TDocument>;
  readonly changes: ApplicationSearchChangeSource;
  readonly snapshot: ApplicationSearchSnapshotSource<TDocument>;
  readonly fanOutCeiling: number;
  readonly maximumFacetBuckets?: number;
  readonly maximumValidationDocuments?: number;
  readonly now?: () => number;
}

export interface OpenSearchGenerationSnapshotOptions {
  readonly repository: string;
  readonly snapshot: string;
  readonly waitForCompletion?: boolean;
}

export interface OpenSearchApplicationSearchRuntime<
  TDocument extends object,
> extends ApplicationSearchRuntime<TDocument> {
  refresh(): Promise<ApplicationSearchProjectionState>;
  snapshotGeneration(
    options: OpenSearchGenerationSnapshotOptions,
  ): Promise<Readonly<Record<string, unknown>>>;
  close(): Promise<void>;
}

export class ApplicationOpenSearchHttpError extends Error {
  readonly code = 'APPLIK8S_OPENSEARCH_HTTP_ERROR';

  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly response: unknown,
  ) {
    super(
      `OpenSearch ${method} ${path} returned HTTP ${status}.`,
    );
    this.name = 'ApplicationOpenSearchHttpError';
  }
}

export class ApplicationOpenSearchSearchUnavailableError extends Error {
  readonly code = 'APPLIK8S_OPENSEARCH_SEARCH_UNAVAILABLE';

  constructor(readonly logicalIndex: string, readonly reason: string) {
    super(`Search index ${logicalIndex} is unavailable: ${reason}`);
    this.name = 'ApplicationOpenSearchSearchUnavailableError';
  }
}

interface OpenSearchCursor {
  readonly protocol: 'applik8s.opensearch-cursor/v1alpha1';
  readonly logicalIndex: string;
  readonly indexRevision: string;
  readonly physicalGeneration: string;
  readonly checkpoint: number;
  readonly principalId: string;
  readonly contextDigest: string;
  readonly authorizationVersion: string;
  readonly queryDigest: string;
  readonly searchAfter: readonly unknown[];
}

interface InFlightChange {
  readonly position: number;
  readonly changeId: string;
  readonly token: string;
  readonly claimedAt: string;
}

interface OpenSearchDurableState {
  readonly [INTERNAL_KIND_FIELD]: typeof STATE_KIND;
  readonly logicalIndex: string;
  readonly indexRevision: string;
  readonly generation: string;
  readonly checkpoint: number;
  readonly state: ApplicationSearchProjectionState['state'];
  readonly retentionFloor: number;
  readonly sourceHighWatermark: number;
  readonly lastAppliedRecordedAt?: string;
  readonly rebuildingGeneration?: string;
  readonly previousGenerations: readonly string[];
  readonly inFlight?: InFlightChange;
}

interface VersionedState {
  readonly index: string;
  readonly state: OpenSearchDurableState;
  readonly sequenceNumber: number;
  readonly primaryTerm: number;
}

interface OpenSearchDocumentSource<TDocument extends object> {
  readonly [INTERNAL_KIND_FIELD]: typeof DOCUMENT_KIND;
  readonly documentIdentity: string;
  readonly document: TDocument;
  readonly sourceProjectionRevision: string;
}

interface OpenSearchChangeSource {
  readonly [INTERNAL_KIND_FIELD]: typeof CHANGE_KIND;
  readonly commitPosition: number;
  readonly changeId: string;
}

interface OpenSearchSearchHit<TSource = unknown> {
  readonly _id?: unknown;
  readonly _score?: unknown;
  readonly _source?: TSource;
  readonly sort?: readonly unknown[];
  readonly highlight?: Readonly<Record<string, readonly string[]>>;
}

interface OpenSearchResponseHits<TSource = unknown> {
  readonly hits?: {
    readonly hits?: readonly OpenSearchSearchHit<TSource>[];
  };
  readonly aggregations?: Readonly<Record<string, unknown>>;
  readonly pit_id?: unknown;
}

interface OpenSearchBulkResponse {
  readonly errors?: unknown;
  readonly items?: readonly Readonly<Record<string, {
    readonly status?: unknown;
    readonly error?: unknown;
  }>>[];
}

interface OpenSearchClient {
  request(
    method: string,
    path: string,
    body?: unknown,
    options?: {
      readonly contentType?: string;
      readonly expected?: readonly number[];
      readonly signal?: AbortSignal;
    },
  ): Promise<unknown>;
}

export async function createOpenSearchApplicationSearchRuntime<
  TDocument extends object,
>(
  options: OpenSearchApplicationSearchRuntimeOptions<TDocument>,
): Promise<OpenSearchApplicationSearchRuntime<TDocument>> {
  assertStableIdentifier(options.logicalIndex, 'logicalIndex');
  assertStableIdentifier(options.indexRevision, 'indexRevision');
  if (!options.cursorSecret) {
    throw new Error(
      `Search index ${options.logicalIndex} requires a non-empty cursor secret.`,
    );
  }
  validateFields(options.fields);
  const initialGeneration = options.initialGeneration ?? 'initial';
  assertStableIdentifier(initialGeneration, 'initialGeneration');
  const initialCheckpoint = boundedInteger(
    options.initialCheckpoint ?? 0,
    0,
    Number.MAX_SAFE_INTEGER,
    'initialCheckpoint',
  );
  const fanOutCeiling = boundedInteger(
    options.fanOutCeiling,
    1,
    1_000_000,
    'fanOutCeiling',
  );
  const maximumFacetBuckets = boundedInteger(
    options.maximumFacetBuckets ?? 100,
    1,
    10_000,
    'maximumFacetBuckets',
  );
  const maximumValidationDocuments = boundedInteger(
    options.maximumValidationDocuments ?? 100_000,
    1,
    1_000_000,
    'maximumValidationDocuments',
  );
  const now = options.now ?? Date.now;
  const client = createClient(options);
  const alias = openSearchAliasName(
    options.indexPrefix ?? 'applik8s-search',
    options.logicalIndex,
    options.indexRevision,
  );

  await ensureInitialGeneration(
    client,
    alias,
    physicalIndexName(alias, initialGeneration),
    initialState(
      options.logicalIndex,
      options.indexRevision,
      initialGeneration,
      initialCheckpoint,
    ),
    options.fields,
  );

  let cached = await readActiveState(client, alias);

  const refresh = async (): Promise<ApplicationSearchProjectionState> => {
    cached = await readActiveState(client, alias);
    return publicState(cached.state);
  };

  const updateSourcePage = async (
    index: string,
    page: ApplicationSearchChangePage,
    checkpoint: number,
  ): Promise<void> => {
    validatePosition(page.retentionFloor, 'retentionFloor');
    validatePosition(page.highWatermark, 'highWatermark');
    await mutateState(client, index, (state) => ({
      ...state,
      retentionFloor: page.retentionFloor,
      sourceHighWatermark: Math.max(
        state.sourceHighWatermark,
        page.highWatermark,
      ),
      state:
        page.retentionFloor > checkpoint + 1
          ? 'rebuildRequired'
          : checkpoint >= Math.max(
                state.sourceHighWatermark,
                page.highWatermark,
              )
            ? 'current'
            : 'lagging',
    }));
    if (page.retentionFloor > checkpoint + 1) {
      throw new ApplicationSearchHistoryLossError(
        options.logicalIndex,
        checkpoint,
        page.retentionFloor,
      );
    }
  };

  const hydrate = async (
    change: ApplicationSearchCommittedChange,
    failureIndex: string,
  ): Promise<readonly ApplicationSearchHydratedDocument<TDocument>[]> => {
    validateChange(change);
    const affected = await options.hydration.affectedRoots(change, {
      maximum: fanOutCeiling + 1,
    });
    if (!affected.complete || affected.identities.length > fanOutCeiling) {
      await mutateState(client, failureIndex, (state) => ({
        ...state,
        state: 'lagging',
      }));
      await refresh();
      throw new ApplicationSearchFanOutError(
        options.logicalIndex,
        change.id,
        fanOutCeiling,
      );
    }
    const identities = [...new Set(affected.identities)].sort();
    const hydrated = await options.hydration.hydrate(identities, {
      frontier: change.commitPosition,
    });
    const candidates = new Map(
      hydrated.map((candidate) => [candidate.id, candidate]),
    );
    return identities.map(
      (identity) =>
        candidates.get(identity) ?? {
          id: identity,
          document: null,
          sourceProjectionRevision: '',
        },
    );
  };

  const applyToIndex = async (
    index: string,
    generation: string,
    change: ApplicationSearchCommittedChange,
    documents: readonly ApplicationSearchHydratedDocument<TDocument>[],
  ): Promise<boolean> => {
    const claimed = await claimChange(
      client,
      index,
      options.logicalIndex,
      generation,
      change,
      now,
    );
    if (!claimed) return false;
    const finalState: OpenSearchDurableState = {
      ...claimed.state,
      checkpoint: change.commitPosition,
      sourceHighWatermark: Math.max(
        claimed.state.sourceHighWatermark,
        change.commitPosition,
      ),
      lastAppliedRecordedAt: change.recordedAt,
      state:
        change.commitPosition >= claimed.state.sourceHighWatermark
          ? 'current'
          : 'lagging',
    };
    const {
      inFlight: _inFlight,
      ...completed
    } = finalState;
    const bulk = bulkChangeBody(
      index,
      documents,
      change,
      completed,
      claimed,
    );
    try {
      const response = await client.request(
        'POST',
        '/_bulk?refresh=wait_for',
        bulk,
        { contentType: 'application/x-ndjson' },
      ) as OpenSearchBulkResponse;
      assertBulkSucceeded(response, options.logicalIndex);
      return true;
    } catch (error) {
      const after = await readState(client, index);
      if (after.state.checkpoint >= change.commitPosition) {
        await validateAppliedChange(client, index, change);
        return false;
      }
      throw error;
    }
  };

  const runtime: OpenSearchApplicationSearchRuntime<TDocument> = {
    state() {
      return publicState(cached.state);
    },
    refresh,
    async apply(change) {
      cached = await readActiveState(client, alias);
      const documents = await hydrate(change, cached.index);
      await applyToIndex(
        cached.index,
        cached.state.generation,
        change,
        documents,
      );
      await refresh();
    },
    async synchronize(synchronizeOptions = {}) {
      const batchSize = boundedInteger(
        synchronizeOptions.batchSize ?? 250,
        1,
        1_000,
        'batchSize',
      );
      const maximumBatches = boundedInteger(
        synchronizeOptions.maximumBatches ?? 100,
        1,
        10_000,
        'maximumBatches',
      );
      let applied = 0;
      for (let batch = 0; batch < maximumBatches; batch += 1) {
        cached = await readActiveState(client, alias);
        const state = cached.state;
        if (state.state === 'rebuildRequired') {
          throw new ApplicationSearchHistoryLossError(
            options.logicalIndex,
            state.checkpoint,
            state.retentionFloor,
          );
        }
        const page = await options.changes.read(
          state.checkpoint,
          batchSize,
        );
        await updateSourcePage(cached.index, page, state.checkpoint);
        for (const change of page.items) {
          const documents = await hydrate(change, cached.index);
          if (
            await applyToIndex(
              cached.index,
              state.generation,
              change,
              documents,
            )
          ) {
            applied += 1;
          }
        }
        await refresh();
        if (page.exhausted) {
          return {
            applied,
            checkpoint: cached.state.checkpoint,
            exhausted: true,
          };
        }
      }
      return {
        applied,
        checkpoint: cached.state.checkpoint,
        exhausted: false,
      };
    },
    async rebuild(rebuildOptions): Promise<ApplicationSearchRebuildResult> {
      assertStableIdentifier(rebuildOptions.generation, 'generation');
      const batchSize = boundedInteger(
        rebuildOptions.batchSize ?? 500,
        1,
        2_000,
        'batchSize',
      );
      const maximumSnapshotPages = boundedInteger(
        rebuildOptions.maximumSnapshotPages ?? 10_000,
        1,
        100_000,
        'maximumSnapshotPages',
      );
      const maximumCatchupBatches = boundedInteger(
        rebuildOptions.maximumCatchupBatches ?? 10_000,
        1,
        100_000,
        'maximumCatchupBatches',
      );
      cached = await readActiveState(client, alias);
      if (rebuildOptions.generation === cached.state.generation) {
        throw new Error(
          `Search index ${options.logicalIndex} cannot rebuild its active generation in place.`,
        );
      }
      if (
        cached.state.rebuildingGeneration
        && cached.state.rebuildingGeneration !== rebuildOptions.generation
      ) {
        throw new Error(
          `Search index ${options.logicalIndex} is already rebuilding generation ${cached.state.rebuildingGeneration}.`,
        );
      }
      const activeAtStart = cached;
      await mutateState(client, activeAtStart.index, (state) => ({
        ...state,
        rebuildingGeneration: rebuildOptions.generation,
      }));
      const candidateIndex = physicalIndexName(
        alias,
        rebuildOptions.generation,
      );
      try {
        if (await indexExists(client, candidateIndex)) {
          await client.request(
            'DELETE',
            `/${encodeURIComponent(candidateIndex)}`,
          );
        }
        await createGenerationIndex(
          client,
          candidateIndex,
          initialState(
            options.logicalIndex,
            options.indexRevision,
            rebuildOptions.generation,
            0,
          ),
          options.fields,
        );
        const opened = await options.snapshot.open();
        validatePosition(opened.frontier, 'snapshot frontier');
        if (!opened.snapshotId) {
          throw new Error(
            `Search index ${options.logicalIndex} snapshot returned an empty identity.`,
          );
        }
        let cursor: string | undefined;
        let exhausted = false;
        try {
          for (
            let pageNumber = 0;
            pageNumber < maximumSnapshotPages;
            pageNumber += 1
          ) {
            const page = await options.snapshot.read(
              opened.snapshotId,
              cursor,
              batchSize,
            );
            await bulkSnapshotDocuments(
              client,
              candidateIndex,
              page.items,
            );
            cursor = page.cursor;
            if (page.exhausted) {
              exhausted = true;
              break;
            }
            if (!cursor) {
              throw new Error(
                `Search index ${options.logicalIndex} snapshot page is not exhausted and has no cursor.`,
              );
            }
          }
        } finally {
          await options.snapshot.close(opened.snapshotId);
        }
        if (!exhausted) {
          throw new Error(
            `Search index ${options.logicalIndex} rebuild exceeded its ${maximumSnapshotPages}-page snapshot bound.`,
          );
        }
        await mutateState(client, candidateIndex, (state) => ({
          ...state,
          checkpoint: opened.frontier,
          sourceHighWatermark: opened.frontier,
        }));

        let rebuildingCheckpoint = opened.frontier;
        let caughtUp = false;
        for (
          let batch = 0;
          batch < maximumCatchupBatches;
          batch += 1
        ) {
          const page = await options.changes.read(
            rebuildingCheckpoint,
            batchSize,
          );
          await updateSourcePage(
            candidateIndex,
            page,
            rebuildingCheckpoint,
          );
          for (const change of page.items) {
            const documents = await hydrate(change, candidateIndex);
            await applyToIndex(
              candidateIndex,
              rebuildOptions.generation,
              change,
              documents,
            );
            rebuildingCheckpoint = change.commitPosition;
          }
          if (
            page.exhausted
            && rebuildingCheckpoint >= page.highWatermark
          ) {
            caughtUp = true;
            break;
          }
        }
        if (!caughtUp) {
          throw new Error(
            `Search index ${options.logicalIndex} rebuild did not catch up within ${maximumCatchupBatches} bounded batches.`,
          );
        }

        const validation = await validateGeneration<TDocument>(
          client,
          candidateIndex,
          maximumValidationDocuments,
        );
        if (
          !validation.authorizationCompatible
          || !validation.schemaCompatible
        ) {
          throw new Error(
            `Search index ${options.logicalIndex} generation ${rebuildOptions.generation} failed schema or authorization validation.`,
          );
        }
        await rebuildOptions.validate?.(validation);

        const previousGeneration = activeAtStart.state.generation;
        const candidate = await mutateState(
          client,
          candidateIndex,
          (state) => {
            const {
              rebuildingGeneration: _rebuildingGeneration,
              ...withoutRebuild
            } = state;
            return {
              ...withoutRebuild,
              state: 'current',
              previousGenerations: [
                ...new Set([
                  ...activeAtStart.state.previousGenerations,
                  previousGeneration,
                ]),
              ],
            };
          },
        );
        await client.request('POST', '/_aliases', {
          actions: [
            {
              remove: {
                index: activeAtStart.index,
                alias,
              },
            },
            {
              add: {
                index: candidateIndex,
                alias,
                is_write_index: true,
              },
            },
          ],
        });
        cached = candidate;
        return {
          generation: rebuildOptions.generation,
          previousGeneration,
          sourceFrontier: opened.frontier,
          publishedCheckpoint: candidate.state.checkpoint,
          documents: validation.count,
          validation,
        };
      } catch (error) {
        if (await indexExists(client, candidateIndex)) {
          await client.request(
            'DELETE',
            `/${encodeURIComponent(candidateIndex)}`,
          );
        }
        if (await indexExists(client, activeAtStart.index)) {
          await mutateState(client, activeAtStart.index, (state) => {
            if (
              state.rebuildingGeneration
              !== rebuildOptions.generation
            ) {
              return state;
            }
            const {
              rebuildingGeneration: _rebuildingGeneration,
              ...withoutRebuild
            } = state;
            return withoutRebuild;
          });
        }
        await refresh();
        throw error;
      }
    },
    async retire(generation) {
      assertStableIdentifier(generation, 'generation');
      cached = await readActiveState(client, alias);
      if (generation === cached.state.generation) {
        throw new Error(
          `Search index ${options.logicalIndex} cannot retire its active generation.`,
        );
      }
      if (generation === cached.state.rebuildingGeneration) {
        throw new Error(
          `Search index ${options.logicalIndex} cannot retire its rebuilding generation.`,
        );
      }
      if (!cached.state.previousGenerations.includes(generation)) return;
      const index = physicalIndexName(alias, generation);
      if (await indexExists(client, index)) {
        await client.request(
          'DELETE',
          `/${encodeURIComponent(index)}`,
        );
      }
      cached = await mutateState(client, cached.index, (state) => ({
        ...state,
        previousGenerations: state.previousGenerations.filter(
          (candidate) => candidate !== generation,
        ),
      }));
    },
    async search(request, admission) {
      validateSearchRequest(request, options.fields);
      validateAdmission(admission, options.fields);
      const pit = await openPointInTime(client, alias);
      try {
        const state = await readStateFromPointInTime(client, pit);
        if (
          state.logicalIndex !== options.logicalIndex
          || state.indexRevision !== options.indexRevision
        ) {
          throw new ApplicationOpenSearchSearchUnavailableError(
            options.logicalIndex,
            'the active alias points at an incompatible projection',
          );
        }
        if (state.inFlight) {
          throw new ApplicationOpenSearchSearchUnavailableError(
            options.logicalIndex,
            `change ${state.inFlight.changeId} is still being published`,
          );
        }
        const queryDigest = digest({
          text: request.text ?? '',
          where: request.where ?? {},
          facets: request.facets?.map(({ name }) => name) ?? [],
          orderBy: request.orderBy ?? [],
          limit: request.limit ?? 20,
        });
        const cursor = request.cursor
          ? decodeCursor(request.cursor, options.cursorSecret)
          : undefined;
        if (cursor) {
          validateCursor(cursor, {
            logicalIndex: options.logicalIndex,
            indexRevision: options.indexRevision,
            physicalGeneration: state.generation,
            checkpoint: state.checkpoint,
            principalId: admission.principalId,
            contextDigest: admission.contextDigest,
            authorizationVersion: admission.authorizationVersion,
            queryDigest,
          });
        }
        const limit = boundedInteger(
          request.limit ?? 20,
          1,
          100,
          'limit',
        );
        const response = await client.request('POST', '/_search', {
          size: limit,
          pit: { id: pit, keep_alive: '1m' },
          track_total_hits: true,
          query: openSearchQuery(request, admission, options.fields),
          sort: openSearchSort(request),
          ...(cursor ? { search_after: cursor.searchAfter } : {}),
          ...(request.text
            ? {
                highlight: {
                  fields: Object.fromEntries(
                    textFieldNames(options.fields).map((field) => [
                      `document.${field}`,
                      {},
                    ]),
                  ),
                },
              }
            : {}),
          aggs: Object.fromEntries(
            (request.facets ?? []).map(({ name }) => [
              name,
              {
                terms: {
                  field: `document.${name}`,
                  size: maximumFacetBuckets,
                },
              },
            ]),
          ),
        }) as OpenSearchResponseHits<OpenSearchDocumentSource<TDocument>>;
        const hits = response.hits?.hits ?? [];
        const lastSort = hits.at(-1)?.sort;
        const nextCursor =
          hits.length === limit && lastSort
            ? encodeCursor(
                {
                  protocol: 'applik8s.opensearch-cursor/v1alpha1',
                  logicalIndex: options.logicalIndex,
                  indexRevision: options.indexRevision,
                  physicalGeneration: state.generation,
                  checkpoint: state.checkpoint,
                  principalId: admission.principalId,
                  contextDigest: admission.contextDigest,
                  authorizationVersion: admission.authorizationVersion,
                  queryDigest,
                  searchAfter: lastSort,
                },
                options.cursorSecret,
              )
            : undefined;
        const sourceProjectionRevision =
          hits.length === 0
            ? options.sourceProjectionRevision ?? ''
            : digest(
                hits.map((hit) =>
                  String(hit._source?.sourceProjectionRevision ?? ''),
                ),
              );
        cached = {
          index: physicalIndexName(alias, state.generation),
          state,
          sequenceNumber: 0,
          primaryTerm: 0,
        };
        return {
          hits: hits.map((hit) => {
            const source = requiredDocumentSource(hit);
            const highlights = normalizeHighlights(hit.highlight);
            return {
              document: structuredClone(source.document),
              ...(request.text !== undefined
                ? { score: finiteNumber(hit._score ?? 0, 'search score') }
                : {}),
              ...(Object.keys(highlights).length > 0
                ? { highlights }
                : {}),
            };
          }),
          facets: normalizeFacets(
            response.aggregations,
            request.facets?.map(({ name }) => name) ?? [],
          ) as ApplicationSearchResult<TDocument>['facets'],
          ...(nextCursor ? { cursor: nextCursor } : {}),
          logicalIndex: options.logicalIndex,
          indexRevision: options.indexRevision,
          physicalGeneration: state.generation,
          sourceProjectionRevision,
          lag: {
            changes: Math.max(
              0,
              state.sourceHighWatermark - state.checkpoint,
            ),
            milliseconds:
              state.state === 'current'
                ? 0
                : state.lastAppliedRecordedAt === undefined
                  ? 0
                  : Math.max(
                      0,
                      now() - Date.parse(state.lastAppliedRecordedAt),
                    ),
            state: state.state,
          },
        };
      } finally {
        await closePointInTime(client, pit);
      }
    },
    async snapshotGeneration(snapshotOptions) {
      assertStableIdentifier(snapshotOptions.repository, 'repository');
      assertStableIdentifier(snapshotOptions.snapshot, 'snapshot');
      cached = await readActiveState(client, alias);
      return await client.request(
        'PUT',
        `/_snapshot/${encodeURIComponent(snapshotOptions.repository)}/${encodeURIComponent(snapshotOptions.snapshot)}?wait_for_completion=${snapshotOptions.waitForCompletion !== false}`,
        {
          indices: cached.index,
          include_global_state: false,
          metadata: {
            logicalIndex: options.logicalIndex,
            indexRevision: options.indexRevision,
            physicalGeneration: cached.state.generation,
            checkpoint: cached.state.checkpoint,
          },
        },
        { expected: [200, 201, 202] },
      ) as Readonly<Record<string, unknown>>;
    },
    async close() {},
  };
  return runtime;
}

async function claimChange(
  client: OpenSearchClient,
  index: string,
  logicalIndex: string,
  generation: string,
  change: ApplicationSearchCommittedChange,
  now: () => number,
): Promise<VersionedState | undefined> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const before = await readState(client, index);
    if (change.commitPosition <= before.state.checkpoint) {
      await validateAppliedChange(client, index, change);
      return undefined;
    }
    if (before.state.state === 'rebuildRequired') {
      throw new ApplicationSearchHistoryLossError(
        logicalIndex,
        before.state.checkpoint,
        before.state.retentionFloor,
      );
    }
    if (change.commitPosition !== before.state.checkpoint + 1) {
      throw new Error(
        `Search index ${logicalIndex} cannot advance generation ${generation} from checkpoint ${before.state.checkpoint} to non-contiguous commit position ${change.commitPosition}.`,
      );
    }
    if (before.state.inFlight) {
      if (
        before.state.inFlight.position !== change.commitPosition
        || before.state.inFlight.changeId !== change.id
      ) {
        throw new ApplicationOpenSearchSearchUnavailableError(
          logicalIndex,
          `generation ${generation} is applying change ${before.state.inFlight.changeId}`,
        );
      }
      return before;
    }
    try {
      return await putState(
        client,
        index,
        {
          ...before.state,
          inFlight: {
            position: change.commitPosition,
            changeId: change.id,
            token: randomUUID(),
            claimedAt: new Date(now()).toISOString(),
          },
        },
        before,
        'wait_for',
      );
    } catch (error) {
      if (
        error instanceof ApplicationOpenSearchHttpError
        && error.status === 409
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new Error(
    `OpenSearch generation ${generation} change claim remained contended after 20 bounded retries.`,
  );
}

function createClient<TDocument extends object>(
  options: OpenSearchApplicationSearchRuntimeOptions<TDocument>,
): OpenSearchClient {
  let endpoint: URL;
  try {
    endpoint = new URL(options.endpoint);
  } catch {
    throw new Error('OpenSearch endpoint must be an absolute HTTP URL.');
  }
  if (endpoint.protocol !== 'https:' && endpoint.protocol !== 'http:') {
    throw new Error('OpenSearch endpoint must use HTTP or HTTPS.');
  }
  if (
    options.authentication
    && (
      !options.authentication.username
      || !options.authentication.password
    )
  ) {
    throw new Error(
      'OpenSearch basic authentication requires non-empty username and password.',
    );
  }
  const transport = options.fetch ?? globalThis.fetch;
  const timeout = boundedInteger(
    options.requestTimeoutMilliseconds ?? 30_000,
    1,
    300_000,
    'requestTimeoutMilliseconds',
  );
  const headers: Record<string, string> = {
    accept: 'application/json',
    ...options.headers,
  };
  if (options.authentication) {
    headers.authorization = `Basic ${Buffer.from(
      `${options.authentication.username}:${options.authentication.password}`,
    ).toString('base64')}`;
  }
  return {
    async request(method, path, body, requestOptions = {}) {
      const controller = new AbortController();
      const onAbort = () => controller.abort(requestOptions.signal?.reason);
      requestOptions.signal?.addEventListener('abort', onAbort, {
        once: true,
      });
      const timer = setTimeout(() => {
        controller.abort(
          new Error(`OpenSearch request exceeded ${timeout}ms.`),
        );
      }, timeout);
      try {
        const response = await transport(new URL(path, endpoint), {
          method,
          headers: {
            ...headers,
            ...(body !== undefined
              ? {
                  'content-type':
                    requestOptions.contentType ?? 'application/json',
                }
              : {}),
          },
          ...(body !== undefined
            ? {
                body:
                  typeof body === 'string'
                    ? body
                    : JSON.stringify(body),
              }
            : {}),
          signal: controller.signal,
        });
        const text = await response.text();
        let parsed: unknown;
        if (text) {
          try {
            parsed = JSON.parse(text) as unknown;
          } catch {
            parsed = text;
          }
        }
        const expected = requestOptions.expected ?? [200, 201];
        if (!expected.includes(response.status)) {
          throw new ApplicationOpenSearchHttpError(
            response.status,
            method,
            path,
            parsed,
          );
        }
        return parsed ?? {};
      } finally {
        clearTimeout(timer);
        requestOptions.signal?.removeEventListener('abort', onAbort);
      }
    },
  };
}

async function ensureInitialGeneration<TDocument extends object>(
  client: OpenSearchClient,
  alias: string,
  index: string,
  state: OpenSearchDurableState,
  fields: ApplicationSearchRuntimeFields<TDocument>,
): Promise<void> {
  if (await aliasExists(client, alias)) return;
  if (!await indexExists(client, index)) {
    await createGenerationIndex(client, index, state, fields);
  }
  try {
    await client.request('POST', '/_aliases', {
      actions: [
        {
          add: {
            index,
            alias,
            is_write_index: true,
          },
        },
      ],
    });
  } catch (error) {
    if (!await aliasExists(client, alias)) throw error;
  }
}

async function createGenerationIndex<TDocument extends object>(
  client: OpenSearchClient,
  index: string,
  state: OpenSearchDurableState,
  fields: ApplicationSearchRuntimeFields<TDocument>,
): Promise<void> {
  await client.request('PUT', `/${encodeURIComponent(index)}`, {
    settings: {
      index: {
        number_of_shards: 1,
        number_of_replicas: 0,
      },
    },
    mappings: {
      dynamic: 'strict',
      properties: {
        [INTERNAL_KIND_FIELD]: { type: 'keyword' },
        logicalIndex: { type: 'keyword', index: false },
        indexRevision: { type: 'keyword', index: false },
        generation: { type: 'keyword', index: false },
        checkpoint: { type: 'long', index: false },
        state: { type: 'keyword', index: false },
        retentionFloor: { type: 'long', index: false },
        sourceHighWatermark: { type: 'long', index: false },
        lastAppliedRecordedAt: { type: 'date', index: false },
        rebuildingGeneration: { type: 'keyword', index: false },
        previousGenerations: { type: 'keyword', index: false },
        inFlight: {
          properties: {
            position: { type: 'long', index: false },
            changeId: { type: 'keyword', index: false },
            token: { type: 'keyword', index: false },
            claimedAt: { type: 'date', index: false },
          },
        },
        commitPosition: { type: 'long', index: false },
        changeId: { type: 'keyword', index: false },
        sourceProjectionRevision: { type: 'keyword', index: false },
        documentIdentity: { type: 'keyword' },
        document: {
          dynamic: 'strict',
          properties: openSearchDocumentProperties(fields),
        },
      },
    },
  });
  await client.request(
    'PUT',
    `/${encodeURIComponent(index)}/_doc/${encodeURIComponent(STATE_DOCUMENT_ID)}?refresh=wait_for&op_type=create`,
    state,
  );
}

function openSearchDocumentProperties<TDocument extends object>(
  fields: ApplicationSearchRuntimeFields<TDocument>,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    (
      Object.entries(fields) as readonly [
        string,
        ApplicationSearchRuntimeField,
      ][]
    ).map(([name, field]) => [
      name,
      openSearchFieldMapping(field),
    ]),
  );
}

function openSearchFieldMapping(
  field: ApplicationSearchRuntimeField,
): Readonly<Record<string, unknown>> {
  if (field.kind === 'text') return { type: 'text' };
  switch (field.valueType) {
    case 'number':
      return { type: 'double' };
    case 'boolean':
      return { type: 'boolean' };
    case 'date':
      return { type: 'date' };
    case 'json':
    case 'unknown':
      return { type: 'flattened' };
    default:
      return { type: 'keyword' };
  }
}

async function aliasExists(
  client: OpenSearchClient,
  alias: string,
): Promise<boolean> {
  try {
    await client.request(
      'HEAD',
      `/_alias/${encodeURIComponent(alias)}`,
      undefined,
      { expected: [200] },
    );
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

async function indexExists(
  client: OpenSearchClient,
  index: string,
): Promise<boolean> {
  try {
    await client.request(
      'HEAD',
      `/${encodeURIComponent(index)}`,
      undefined,
      { expected: [200] },
    );
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof ApplicationOpenSearchHttpError
    && error.status === 404;
}

async function resolveAliasIndex(
  client: OpenSearchClient,
  alias: string,
): Promise<string> {
  const response = await client.request(
    'GET',
    `/_alias/${encodeURIComponent(alias)}`,
  );
  if (!isRecord(response)) {
    throw new ApplicationOpenSearchSearchUnavailableError(
      alias,
      'alias resolution returned a malformed response',
    );
  }
  const indexes = Object.keys(response);
  if (indexes.length !== 1) {
    throw new ApplicationOpenSearchSearchUnavailableError(
      alias,
      `alias must resolve to exactly one physical index, found ${indexes.length}`,
    );
  }
  const index = indexes[0];
  if (!index) {
    throw new ApplicationOpenSearchSearchUnavailableError(
      alias,
      'alias has no physical index',
    );
  }
  return index;
}

async function readActiveState(
  client: OpenSearchClient,
  alias: string,
): Promise<VersionedState> {
  const index = await resolveAliasIndex(client, alias);
  return await readState(client, index);
}

async function readState(
  client: OpenSearchClient,
  index: string,
): Promise<VersionedState> {
  const response = await client.request(
    'GET',
    `/${encodeURIComponent(index)}/_doc/${encodeURIComponent(STATE_DOCUMENT_ID)}`,
  );
  if (!isRecord(response)) {
    throw new Error(`OpenSearch index ${index} returned malformed state.`);
  }
  return {
    index,
    state: parseState(response._source),
    sequenceNumber: nonNegativeInteger(
      response._seq_no,
      'state sequence number',
    ),
    primaryTerm: nonNegativeInteger(
      response._primary_term,
      'state primary term',
    ),
  };
}

async function mutateState(
  client: OpenSearchClient,
  index: string,
  mutate: (state: OpenSearchDurableState) => OpenSearchDurableState,
): Promise<VersionedState> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const before = await readState(client, index);
    try {
      return await putState(
        client,
        index,
        mutate(before.state),
        before,
        'wait_for',
      );
    } catch (error) {
      if (
        error instanceof ApplicationOpenSearchHttpError
        && error.status === 409
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new Error(
    `OpenSearch index ${index} state remained contended after 20 bounded retries.`,
  );
}

async function putState(
  client: OpenSearchClient,
  index: string,
  state: OpenSearchDurableState,
  version: VersionedState,
  refresh: 'wait_for' | 'true' | 'false',
): Promise<VersionedState> {
  const response = await client.request(
    'PUT',
    `/${encodeURIComponent(index)}/_doc/${encodeURIComponent(STATE_DOCUMENT_ID)}?if_seq_no=${version.sequenceNumber}&if_primary_term=${version.primaryTerm}&refresh=${refresh}`,
    state,
  );
  if (!isRecord(response)) {
    throw new Error(`OpenSearch index ${index} state write was malformed.`);
  }
  return {
    index,
    state,
    sequenceNumber: nonNegativeInteger(
      response._seq_no,
      'state sequence number',
    ),
    primaryTerm: nonNegativeInteger(
      response._primary_term,
      'state primary term',
    ),
  };
}

function bulkChangeBody<TDocument extends object>(
  index: string,
  documents: readonly ApplicationSearchHydratedDocument<TDocument>[],
  change: ApplicationSearchCommittedChange,
  completedState: OpenSearchDurableState,
  version: VersionedState,
): string {
  const lines: string[] = [];
  for (const candidate of documents) {
    if (!candidate.id) {
      throw new Error('Search hydration returned an empty document identity.');
    }
    if (candidate.document === null) {
      lines.push(
        JSON.stringify({
          delete: { _index: index, _id: documentId(candidate.id) },
        }),
      );
      continue;
    }
    lines.push(
      JSON.stringify({
        index: { _index: index, _id: documentId(candidate.id) },
      }),
      JSON.stringify({
        [INTERNAL_KIND_FIELD]: DOCUMENT_KIND,
        documentIdentity: candidate.id,
        document: candidate.document,
        sourceProjectionRevision: candidate.sourceProjectionRevision,
      } satisfies OpenSearchDocumentSource<TDocument>),
    );
  }
  lines.push(
    JSON.stringify({
      index: { _index: index, _id: changeDocumentId(change.commitPosition) },
    }),
    JSON.stringify({
      [INTERNAL_KIND_FIELD]: CHANGE_KIND,
      commitPosition: change.commitPosition,
      changeId: change.id,
    } satisfies OpenSearchChangeSource),
    JSON.stringify({
      index: {
        _index: index,
        _id: STATE_DOCUMENT_ID,
        if_seq_no: version.sequenceNumber,
        if_primary_term: version.primaryTerm,
      },
    }),
    JSON.stringify(completedState),
  );
  return `${lines.join('\n')}\n`;
}

async function bulkSnapshotDocuments<TDocument extends object>(
  client: OpenSearchClient,
  index: string,
  documents: readonly ApplicationSearchHydratedDocument<TDocument>[],
): Promise<void> {
  if (documents.length === 0) return;
  const lines: string[] = [];
  for (const candidate of documents) {
    if (!candidate.id) {
      throw new Error('Search snapshot returned an empty document identity.');
    }
    if (candidate.document === null) continue;
    lines.push(
      JSON.stringify({
        index: { _index: index, _id: documentId(candidate.id) },
      }),
      JSON.stringify({
        [INTERNAL_KIND_FIELD]: DOCUMENT_KIND,
        documentIdentity: candidate.id,
        document: candidate.document,
        sourceProjectionRevision: candidate.sourceProjectionRevision,
      } satisfies OpenSearchDocumentSource<TDocument>),
    );
  }
  if (lines.length === 0) return;
  const response = await client.request(
    'POST',
    '/_bulk?refresh=wait_for',
    `${lines.join('\n')}\n`,
    { contentType: 'application/x-ndjson' },
  ) as OpenSearchBulkResponse;
  assertBulkSucceeded(response, index);
}

function assertBulkSucceeded(
  response: OpenSearchBulkResponse,
  logicalIndex: string,
): void {
  if (response.errors !== true) return;
  const failures = (response.items ?? [])
    .flatMap((item) =>
      Object.entries(item).map(([operation, result]) => ({
        operation,
        result,
      })),
    )
    .filter(
      ({ operation, result }) =>
        Number(result.status ?? 500) >= 300
        && !(operation === 'delete' && Number(result.status) === 404),
    )
    .slice(0, 5);
  throw new Error(
    `OpenSearch bulk write for ${logicalIndex} failed: ${JSON.stringify(failures)}.`,
  );
}

async function validateAppliedChange(
  client: OpenSearchClient,
  index: string,
  change: ApplicationSearchCommittedChange,
): Promise<void> {
  let response: unknown;
  try {
    response = await client.request(
      'GET',
      `/${encodeURIComponent(index)}/_doc/${encodeURIComponent(changeDocumentId(change.commitPosition))}`,
    );
  } catch (error) {
    if (isNotFound(error)) {
      throw new Error(
        `Search generation ${index} has checkpoint evidence for ${change.commitPosition} but no durable change marker.`,
      );
    }
    throw error;
  }
  if (
    !isRecord(response)
    || !isRecord(response._source)
    || response._source.changeId !== change.id
  ) {
    throw new Error(
      `Search generation ${index} commit position ${change.commitPosition} was applied under a different change identity.`,
    );
  }
}

async function openPointInTime(
  client: OpenSearchClient,
  index: string,
): Promise<string> {
  const response = await client.request(
    'POST',
    `/${encodeURIComponent(index)}/_search/point_in_time?keep_alive=1m`,
  );
  if (!isRecord(response) || typeof response.pit_id !== 'string') {
    throw new Error('OpenSearch did not return a point-in-time identity.');
  }
  return response.pit_id;
}

async function closePointInTime(
  client: OpenSearchClient,
  pit: string,
): Promise<void> {
  await client.request(
    'DELETE',
    '/_search/point_in_time',
    { pit_id: pit },
    { expected: [200, 404] },
  );
}

async function readStateFromPointInTime(
  client: OpenSearchClient,
  pit: string,
): Promise<OpenSearchDurableState> {
  const response = await client.request('POST', '/_search', {
    size: 1,
    pit: { id: pit, keep_alive: '1m' },
    query: { ids: { values: [STATE_DOCUMENT_ID] } },
  }) as OpenSearchResponseHits<OpenSearchDurableState>;
  const hit = response.hits?.hits?.[0];
  if (!hit?._source) {
    throw new Error('OpenSearch point-in-time snapshot has no state document.');
  }
  return parseState(hit._source);
}

function openSearchQuery<TDocument extends object>(
  request: ApplicationSearchRequest<TDocument>,
  admission: ApplicationSearchAdmissionScope<TDocument>,
  fields: ApplicationSearchRuntimeFields<TDocument>,
): Readonly<Record<string, unknown>> {
  const filter = [
    { term: { [INTERNAL_KIND_FIELD]: DOCUMENT_KIND } },
    ...openSearchWhere(admission.where),
    ...openSearchWhere(request.where ?? {}),
  ];
  return {
    bool: {
      filter,
      ...(request.text
        ? {
            must: [
              {
                simple_query_string: {
                  query: request.text,
                  fields: weightedTextFields(fields),
                  default_operator: 'and',
                },
              },
            ],
          }
        : {}),
    },
  };
}

function openSearchWhere<TDocument extends object>(
  where: ApplicationSearchAdmissionScope<TDocument>['where'],
): readonly Readonly<Record<string, unknown>>[] {
  return Object.entries(where).flatMap(([field, comparison]) =>
    openSearchComparison(
      `document.${field}`,
      comparison as ApplicationSearchComparison<unknown>,
    ),
  );
}

function openSearchComparison(
  field: string,
  comparison: ApplicationSearchComparison<unknown>,
): readonly Readonly<Record<string, unknown>>[] {
  if (
    comparison === null
    || typeof comparison !== 'object'
    || Array.isArray(comparison)
    || comparison instanceof Date
  ) {
    return [{ term: { [field]: normalizeValue(comparison) } }];
  }
  const operations = comparison as {
    readonly eq?: unknown;
    readonly ne?: unknown;
    readonly in?: readonly unknown[];
    readonly lt?: unknown;
    readonly lte?: unknown;
    readonly gt?: unknown;
    readonly gte?: unknown;
  };
  const filters: Readonly<Record<string, unknown>>[] = [];
  if ('eq' in operations) {
    filters.push({ term: { [field]: normalizeValue(operations.eq) } });
  }
  if ('in' in operations) {
    filters.push({
      terms: {
        [field]: (operations.in ?? []).map(normalizeValue),
      },
    });
  }
  if ('ne' in operations) {
    filters.push({
      bool: {
        must_not: [
          { term: { [field]: normalizeValue(operations.ne) } },
        ],
      },
    });
  }
  const range = Object.fromEntries(
    (['lt', 'lte', 'gt', 'gte'] as const)
      .filter((operator) => operator in operations)
      .map((operator) => [
        operator,
        normalizeValue(operations[operator]),
      ]),
  );
  if (Object.keys(range).length > 0) {
    filters.push({ range: { [field]: range } });
  }
  return filters;
}

function openSearchSort<TDocument extends object>(
  request: ApplicationSearchRequest<TDocument>,
): readonly unknown[] {
  const order = Array.isArray(request.orderBy)
    ? request.orderBy
    : request.orderBy
      ? [request.orderBy]
      : [];
  return [
    ...(order.length === 0
      ? request.text
        ? [{ _score: 'desc' }]
        : []
      : order.map((sort) => ({
          [`document.${sort.field}`]: {
            order: sort.direction,
            missing: '_last',
          },
        }))),
    { documentIdentity: 'asc' },
  ];
}

async function validateGeneration<TDocument extends object>(
  client: OpenSearchClient,
  index: string,
  maximum: number,
): Promise<ApplicationSearchRebuildValidation> {
  const pit = await openPointInTime(client, index);
  try {
    const values: {
      readonly id: string;
      readonly source: OpenSearchDocumentSource<TDocument>;
    }[] = [];
    let searchAfter: readonly unknown[] | undefined;
    for (;;) {
      const response = await client.request('POST', '/_search', {
        size: Math.min(500, maximum + 1),
        pit: { id: pit, keep_alive: '1m' },
        query: { term: { [INTERNAL_KIND_FIELD]: DOCUMENT_KIND } },
        sort: [{ documentIdentity: 'asc' }],
        ...(searchAfter ? { search_after: searchAfter } : {}),
      }) as OpenSearchResponseHits<OpenSearchDocumentSource<TDocument>>;
      const hits = response.hits?.hits ?? [];
      for (const hit of hits) {
        if (values.length >= maximum) {
          throw new Error(
            `OpenSearch generation ${index} exceeds its ${maximum}-document validation bound.`,
          );
        }
        const source = requiredDocumentSource(hit);
        values.push({ id: source.documentIdentity, source });
      }
      if (hits.length === 0) break;
      searchAfter = hits.at(-1)?.sort;
      if (!searchAfter) {
        throw new Error(
          `OpenSearch generation ${index} validation page has no search_after value.`,
        );
      }
    }
    return {
      count: values.length,
      checksum: digest(
        values.map(({ id, source }) => ({
          id,
          document: source.document,
          sourceProjectionRevision: source.sourceProjectionRevision,
        })),
      ),
      sampleIdentities: values.slice(0, 10).map(({ id }) => id),
      authorizationCompatible: true,
      schemaCompatible: true,
    };
  } finally {
    await closePointInTime(client, pit);
  }
}

function normalizeFacets(
  aggregations: Readonly<Record<string, unknown>> | undefined,
  requested: readonly string[],
): Readonly<Record<string, readonly {
  readonly value: unknown;
  readonly count: number;
}[]>> {
  return Object.fromEntries(
    requested.map((field) => {
      const aggregation = aggregations?.[field];
      const buckets =
        isRecord(aggregation) && Array.isArray(aggregation.buckets)
          ? aggregation.buckets
          : [];
      return [
        field,
        buckets.map((bucket) => {
          if (!isRecord(bucket)) {
            throw new Error(
              `OpenSearch facet ${field} returned a malformed bucket.`,
            );
          }
          return {
            value: bucket.key,
            count: nonNegativeInteger(
              bucket.doc_count,
              `facet ${field} count`,
            ),
          };
        }),
      ];
    }),
  );
}

function normalizeHighlights<TDocument extends object>(
  highlight: Readonly<Record<string, readonly string[]>> | undefined,
): Partial<Record<keyof TDocument, readonly string[]>> {
  if (!highlight) return {};
  return Object.fromEntries(
    Object.entries(highlight)
      .filter(([field, values]) =>
        field.startsWith('document.')
        && Array.isArray(values)
        && values.every((value) => typeof value === 'string'),
      )
      .map(([field, values]) => [
        field.slice('document.'.length),
        values,
      ]),
  ) as Partial<Record<keyof TDocument, readonly string[]>>;
}

function requiredDocumentSource<TDocument extends object>(
  hit: OpenSearchSearchHit<OpenSearchDocumentSource<TDocument>>,
): OpenSearchDocumentSource<TDocument> {
  const source = hit._source;
  if (
    !source
    || source[INTERNAL_KIND_FIELD] !== DOCUMENT_KIND
    || typeof source.documentIdentity !== 'string'
    || !source.documentIdentity
    || !isRecord(source.document)
    || typeof source.sourceProjectionRevision !== 'string'
  ) {
    throw new Error('OpenSearch returned a malformed search document.');
  }
  return source;
}

function initialState(
  logicalIndex: string,
  indexRevision: string,
  generation: string,
  checkpoint: number,
): OpenSearchDurableState {
  return {
    [INTERNAL_KIND_FIELD]: STATE_KIND,
    logicalIndex,
    indexRevision,
    generation,
    checkpoint,
    state: 'current',
    retentionFloor: 0,
    sourceHighWatermark: checkpoint,
    previousGenerations: [],
  };
}

function parseState(value: unknown): OpenSearchDurableState {
  if (
    !isRecord(value)
    || value[INTERNAL_KIND_FIELD] !== STATE_KIND
    || typeof value.logicalIndex !== 'string'
    || typeof value.indexRevision !== 'string'
    || typeof value.generation !== 'string'
    || (
      value.state !== 'current'
      && value.state !== 'lagging'
      && value.state !== 'rebuildRequired'
    )
    || !Array.isArray(value.previousGenerations)
    || value.previousGenerations.some(
      (candidate) => typeof candidate !== 'string',
    )
  ) {
    throw new Error('OpenSearch search state document is malformed.');
  }
  const checkpoint = nonNegativeInteger(value.checkpoint, 'checkpoint');
  const retentionFloor = nonNegativeInteger(
    value.retentionFloor,
    'retentionFloor',
  );
  const sourceHighWatermark = nonNegativeInteger(
    value.sourceHighWatermark,
    'sourceHighWatermark',
  );
  const inFlight = value.inFlight;
  if (
    inFlight !== undefined
    && (
      !isRecord(inFlight)
      || typeof inFlight.changeId !== 'string'
      || typeof inFlight.token !== 'string'
      || typeof inFlight.claimedAt !== 'string'
      || !Number.isFinite(Date.parse(inFlight.claimedAt))
    )
  ) {
    throw new Error('OpenSearch in-flight change state is malformed.');
  }
  return {
    [INTERNAL_KIND_FIELD]: STATE_KIND,
    logicalIndex: value.logicalIndex,
    indexRevision: value.indexRevision,
    generation: value.generation,
    checkpoint,
    state: value.state,
    retentionFloor,
    sourceHighWatermark,
    ...(typeof value.lastAppliedRecordedAt === 'string'
      ? { lastAppliedRecordedAt: value.lastAppliedRecordedAt }
      : {}),
    ...(typeof value.rebuildingGeneration === 'string'
      ? { rebuildingGeneration: value.rebuildingGeneration }
      : {}),
    previousGenerations: [...value.previousGenerations] as string[],
    ...(inFlight
      ? {
          inFlight: {
            position: nonNegativeInteger(
              inFlight.position,
              'in-flight commit position',
            ),
            changeId: inFlight.changeId as string,
            token: inFlight.token as string,
            claimedAt: inFlight.claimedAt as string,
          },
        }
      : {}),
  };
}

function publicState(
  state: OpenSearchDurableState,
): ApplicationSearchProjectionState {
  return {
    logicalIndex: state.logicalIndex,
    indexRevision: state.indexRevision,
    activeGeneration: state.generation,
    checkpoint: state.checkpoint,
    state: state.state,
    retentionFloor: state.retentionFloor,
    ...(state.rebuildingGeneration
      ? { rebuildingGeneration: state.rebuildingGeneration }
      : {}),
    previousGenerations: [...state.previousGenerations],
  };
}

function validateFields<TDocument extends object>(
  fields: ApplicationSearchRuntimeFields<TDocument>,
): void {
  for (
    const [name, field] of Object.entries(fields) as readonly [
      string,
      ApplicationSearchRuntimeField,
    ][]
  ) {
    if (
      field.boost !== undefined
      && (
        field.kind !== 'text'
        || !Number.isFinite(field.boost)
        || field.boost <= 0
      )
    ) {
      throw new Error(
        `Search field ${name} boost must be a positive finite number on a text field.`,
      );
    }
    if (
      field.kind !== 'text'
      && (
        field.valueType === undefined
        || field.valueType === 'unknown'
      )
    ) {
      throw new Error(
        `OpenSearch field ${name} requires an explicit valueType for deterministic mapping.`,
      );
    }
  }
}

function validateSearchRequest<TDocument extends object>(
  request: ApplicationSearchRequest<TDocument>,
  fields: ApplicationSearchRuntimeFields<TDocument>,
): void {
  if (request.text !== undefined && !request.text.trim()) {
    throw new Error('Search text must not be empty when supplied.');
  }
  if (
    request.text !== undefined
    && textFieldNames(fields).length === 0
  ) {
    throw new Error('Search text requires at least one declared text field.');
  }
  validateWhere(request.where ?? {}, fields, 'request');
  for (const facet of request.facets ?? []) {
    if (fields[facet.name]?.kind !== 'facet') {
      throw new Error(`Search field ${facet.name} is not facetable.`);
    }
  }
  const order = Array.isArray(request.orderBy)
    ? request.orderBy
    : request.orderBy
      ? [request.orderBy]
      : [];
  for (const sort of order) {
    if (!(sort.field in fields)) {
      throw new Error(`Search sort field ${sort.field} is not indexed.`);
    }
    if (Reflect.get(fields, sort.field)?.kind === 'text') {
      throw new Error(
        `Search text field ${sort.field} is not sortable without a dedicated sort field.`,
      );
    }
  }
}

function validateAdmission<TDocument extends object>(
  admission: ApplicationSearchAdmissionScope<TDocument>,
  fields: ApplicationSearchRuntimeFields<TDocument>,
): void {
  if (
    !admission.principalId
    || !admission.contextDigest
    || !admission.authorizationVersion
  ) {
    throw new Error(
      'Search requires an admitted principal, trusted-context digest, and authorization version.',
    );
  }
  validateWhere(admission.where, fields, 'admission');
}

function validateWhere<TDocument extends object>(
  where: ApplicationSearchAdmissionScope<TDocument>['where'],
  fields: ApplicationSearchRuntimeFields<TDocument>,
  source: 'admission' | 'request',
): void {
  for (const [name, comparison] of Object.entries(where)) {
    const field = Reflect.get(fields, name);
    if (!field) {
      throw new Error(
        `Search ${source} filter field ${name} is not indexed.`,
      );
    }
    if (
      !['filter', 'facet', 'minimum', 'maximum', 'count'].includes(
        field.kind,
      )
    ) {
      throw new Error(
        `Search field ${name} is not filterable for ${source} scope.`,
      );
    }
    validateComparison(
      comparison as ApplicationSearchComparison<unknown>,
      name,
    );
  }
}

function validateComparison(
  comparison: ApplicationSearchComparison<unknown>,
  field: string,
): void {
  if (comparison === undefined) {
    throw new Error(`Search filter field ${field} cannot be undefined.`);
  }
  if (
    comparison
    && typeof comparison === 'object'
    && !Array.isArray(comparison)
    && !(comparison instanceof Date)
  ) {
    const keys = Object.keys(comparison);
    const supported = new Set([
      'eq',
      'ne',
      'in',
      'lt',
      'lte',
      'gt',
      'gte',
    ]);
    if (keys.length === 0 || keys.some((key) => !supported.has(key))) {
      throw new Error(
        `Search filter field ${field} has an empty or unsupported comparison.`,
      );
    }
  }
}

function textFieldNames<TDocument extends object>(
  fields: ApplicationSearchRuntimeFields<TDocument>,
): readonly string[] {
  return (
    Object.entries(fields) as readonly [
      string,
      ApplicationSearchRuntimeField,
    ][]
  )
    .filter(([, field]) => field.kind === 'text')
    .map(([name]) => name);
}

function weightedTextFields<TDocument extends object>(
  fields: ApplicationSearchRuntimeFields<TDocument>,
): readonly string[] {
  return (
    Object.entries(fields) as readonly [
      string,
      ApplicationSearchRuntimeField,
    ][]
  )
    .filter(([, field]) => field.kind === 'text')
    .map(([name, field]) =>
      field.boost === undefined
        ? `document.${name}`
        : `document.${name}^${field.boost}`,
    );
}

function validateChange(change: ApplicationSearchCommittedChange): void {
  if (!change.id || !change.sourceModel || !change.sourceIdentity) {
    throw new Error(
      'Search committed changes require id, sourceModel, and sourceIdentity.',
    );
  }
  validatePosition(change.commitPosition, 'commitPosition');
  if (!change.transactionId || !change.schemaRevision) {
    throw new Error(
      `Search committed change ${change.id} requires transactionId and schemaRevision.`,
    );
  }
  if (!Number.isFinite(Date.parse(change.recordedAt))) {
    throw new Error(
      `Search committed change ${change.id} recordedAt must be an ISO timestamp.`,
    );
  }
}

function encodeCursor(cursor: OpenSearchCursor, secret: string): string {
  const payload = Buffer.from(JSON.stringify(cursor)).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

function decodeCursor(
  encoded: string,
  secret: string,
): OpenSearchCursor {
  const [payload, signature, extra] = encoded.split('.');
  if (!payload || !signature || extra !== undefined) {
    throw new ApplicationSearchCursorError('Search cursor is malformed.');
  }
  const expected = createHmac('sha256', secret).update(payload).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(signature, 'base64url');
  } catch {
    throw new ApplicationSearchCursorError(
      'Search cursor signature is malformed.',
    );
  }
  if (
    actual.length !== expected.length
    || !timingSafeEqual(actual, expected)
  ) {
    throw new ApplicationSearchCursorError(
      'Search cursor signature is invalid.',
    );
  }
  try {
    return JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as OpenSearchCursor;
  } catch {
    throw new ApplicationSearchCursorError(
      'Search cursor payload is invalid.',
    );
  }
}

function validateCursor(
  cursor: OpenSearchCursor,
  expected: Omit<
    OpenSearchCursor,
    'protocol' | 'searchAfter'
  >,
): void {
  if (
    cursor.protocol !== 'applik8s.opensearch-cursor/v1alpha1'
    || !Array.isArray(cursor.searchAfter)
  ) {
    throw new ApplicationSearchCursorError(
      'Search cursor contract is invalid.',
    );
  }
  for (const [key, value] of Object.entries(expected)) {
    if (Reflect.get(cursor, key) !== value) {
      throw new ApplicationSearchCursorError(
        `Search cursor ${key} does not match the current admitted query.`,
      );
    }
  }
}

function openSearchAliasName(
  prefix: string,
  logicalIndex: string,
  indexRevision: string,
): string {
  const normalizedPrefix = prefix
    .toLocaleLowerCase()
    .replace(/[^a-z0-9_-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  if (!normalizedPrefix) {
    throw new Error('OpenSearch indexPrefix must contain a safe name.');
  }
  return `${normalizedPrefix}-${digest({
    logicalIndex,
    indexRevision,
  }).slice(0, 20)}`.slice(0, 180);
}

function physicalIndexName(alias: string, generation: string): string {
  const normalized = generation
    .toLocaleLowerCase()
    .replace(/[^a-z0-9_-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 40);
  return `${alias}-${normalized}-${digest(generation).slice(0, 12)}`;
}

function documentId(identity: string): string {
  return `document:${Buffer.from(identity).toString('base64url')}`;
}

function changeDocumentId(position: number): string {
  return `change:${position}`;
}

function digest(value: unknown): string {
  return createHash('sha256')
    .update(canonicalJson(value))
    .digest('hex');
}

function canonicalJson(value: unknown): string {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Search digest cannot encode a non-finite number.');
    }
    return JSON.stringify(value);
  }
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, candidate]) =>
          `${JSON.stringify(key)}:${canonicalJson(candidate)}`,
      )
      .join(',')}}`;
  }
  return JSON.stringify(String(value));
}

function normalizeValue(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value: unknown, name: string): number {
  const parsed =
    typeof value === 'number' ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(parsed)) {
    throw new Error(`OpenSearch ${name} is not a finite number.`);
  }
  return parsed;
}

function nonNegativeInteger(value: unknown, name: string): number {
  const parsed =
    typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`OpenSearch ${name} must be a non-negative integer.`);
  }
  return parsed;
}

function validatePosition(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      `Search ${name} must be a non-negative safe integer.`,
    );
  }
}

function boundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  if (
    !Number.isSafeInteger(value)
    || value < minimum
    || value > maximum
  ) {
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}

function assertStableIdentifier(value: string, name: string): void {
  if (!value.trim() || value.length > 240) {
    throw new Error(
      `${name} must be a non-empty stable identifier up to 240 characters.`,
    );
  }
}
