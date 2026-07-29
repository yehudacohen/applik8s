import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type {
  ApplicationSearchComparison,
  ApplicationSearchRequest,
  ApplicationSearchResult,
} from './application-search.js';

export interface ApplicationSearchCommittedChange {
  /** Stable outbox/change-log identity. */
  readonly id: string;
  readonly sourceModel: string;
  readonly sourceIdentity: string;
  readonly operation: 'create' | 'update' | 'delete' | 'reparent';
  /**
   * Contiguous committed-source position. This is assigned only when commit
   * order is known; allocation sequences and timestamps are not valid inputs.
   */
  readonly commitPosition: number;
  readonly transactionId: string;
  readonly schemaRevision: string;
  readonly recordedAt: string;
  readonly previousRelationshipKeys?: Readonly<Record<string, string>>;
  readonly currentRelationshipKeys?: Readonly<Record<string, string>>;
}

export interface ApplicationSearchHydratedDocument<
  TDocument extends object,
> {
  readonly id: string;
  readonly document: TDocument | null;
  readonly sourceProjectionRevision: string;
}

export interface ApplicationSearchAffectedRoots {
  readonly identities: readonly string[];
  readonly complete: boolean;
}

export interface ApplicationSearchHydration<
  TDocument extends object,
> {
  affectedRoots(
    change: ApplicationSearchCommittedChange,
    options: { readonly maximum: number },
  ): Promise<ApplicationSearchAffectedRoots>;
  hydrate(
    identities: readonly string[],
    options: {
      readonly frontier: number;
      readonly signal?: AbortSignal;
    },
  ): Promise<readonly ApplicationSearchHydratedDocument<TDocument>[]>;
}

export interface ApplicationSearchChangePage {
  readonly items: readonly ApplicationSearchCommittedChange[];
  readonly retentionFloor: number;
  readonly highWatermark: number;
  readonly exhausted: boolean;
}

export interface ApplicationSearchChangeSource {
  read(
    afterCommitPosition: number,
    limit: number,
  ): Promise<ApplicationSearchChangePage>;
}

export interface ApplicationSearchSnapshotPage<TDocument extends object> {
  readonly items: readonly ApplicationSearchHydratedDocument<TDocument>[];
  readonly cursor?: string;
  readonly exhausted: boolean;
}

export interface ApplicationSearchSnapshotSource<TDocument extends object> {
  /**
   * Opens an authoritative committed snapshot and returns its source frontier.
   * Every subsequent page must observe this exact snapshot.
   */
  open(): Promise<{ readonly frontier: number; readonly snapshotId: string }>;
  read(
    snapshotId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<ApplicationSearchSnapshotPage<TDocument>>;
  close(snapshotId: string): Promise<void>;
}

export interface ApplicationSearchAdmissionScope<TDocument extends object> {
  readonly principalId: string;
  readonly contextDigest: string;
  readonly authorizationVersion: string;
  /**
   * Mandatory provider-executable filters. They are intersected with caller
   * filters and are never represented as a post-filter.
   */
  readonly where: {
    readonly [TKey in keyof TDocument]?: ApplicationSearchComparison<
      TDocument[TKey]
    >;
  };
}

export interface ApplicationSearchProjectionState {
  readonly logicalIndex: string;
  readonly indexRevision: string;
  readonly activeGeneration: string;
  readonly checkpoint: number;
  readonly state: 'current' | 'lagging' | 'rebuildRequired';
  readonly retentionFloor: number;
  readonly rebuildingGeneration?: string;
  readonly previousGenerations: readonly string[];
}

export interface ApplicationSearchRebuildValidation {
  readonly count: number;
  readonly checksum: string;
  readonly sampleIdentities: readonly string[];
  readonly authorizationCompatible: boolean;
  readonly schemaCompatible: boolean;
}

export interface ApplicationSearchRebuildResult {
  readonly generation: string;
  readonly previousGeneration: string;
  readonly sourceFrontier: number;
  readonly publishedCheckpoint: number;
  readonly documents: number;
  readonly validation: ApplicationSearchRebuildValidation;
}

export interface ApplicationSearchRuntime<TDocument extends object> {
  state(): ApplicationSearchProjectionState;
  apply(change: ApplicationSearchCommittedChange): Promise<void>;
  synchronize(options?: {
    readonly batchSize?: number;
    readonly maximumBatches?: number;
  }): Promise<{
    readonly applied: number;
    readonly checkpoint: number;
    readonly exhausted: boolean;
  }>;
  rebuild(options: {
    readonly generation: string;
    readonly batchSize?: number;
    readonly maximumSnapshotPages?: number;
    readonly maximumCatchupBatches?: number;
    readonly validate?: (
      evidence: ApplicationSearchRebuildValidation,
    ) => void | Promise<void>;
  }): Promise<ApplicationSearchRebuildResult>;
  retire(generation: string): void;
  search(
    request: ApplicationSearchRequest<TDocument>,
    admission: ApplicationSearchAdmissionScope<TDocument>,
  ): Promise<ApplicationSearchResult<TDocument>>;
}

export interface DeterministicApplicationSearchRuntimeOptions<
  TDocument extends object,
> {
  readonly logicalIndex: string;
  readonly indexRevision: string;
  readonly initialGeneration?: string;
  readonly initialCheckpoint?: number;
  readonly sourceProjectionRevision?: string;
  readonly cursorSecret: string;
  readonly fields: Readonly<Record<keyof TDocument & string, {
    readonly kind: 'text' | 'facet' | 'filter' | 'sort' | 'values' | 'minimum' | 'maximum' | 'count';
  }>>;
  readonly hydration: ApplicationSearchHydration<TDocument>;
  readonly changes: ApplicationSearchChangeSource;
  readonly snapshot: ApplicationSearchSnapshotSource<TDocument>;
  readonly fanOutCeiling: number;
  readonly maximumQueryDocuments?: number;
  readonly now?: () => number;
}

interface SearchGeneration<TDocument extends object> {
  readonly documents: Map<string, {
    readonly document: TDocument;
    readonly sourceProjectionRevision: string;
  }>;
  readonly applied: Map<number, string>;
  checkpoint: number;
}

interface SearchCursor {
  readonly protocol: 'applik8s.search-cursor/v1alpha1';
  readonly logicalIndex: string;
  readonly indexRevision: string;
  readonly physicalGeneration: string;
  /** Exact committed projection frontier used to construct this page. */
  readonly checkpoint: number;
  readonly principalId: string;
  readonly contextDigest: string;
  readonly authorizationVersion: string;
  readonly queryDigest: string;
  readonly offset: number;
}

export class ApplicationSearchHistoryLossError extends Error {
  readonly code = 'APPLIK8S_SEARCH_REBUILD_REQUIRED';

  constructor(
    readonly logicalIndex: string,
    readonly checkpoint: number,
    readonly retentionFloor: number,
  ) {
    super(
      `Search index ${logicalIndex} checkpoint ${checkpoint} is behind retained committed-change frontier ${retentionFloor}; a full rebuild is required.`,
    );
    this.name = 'ApplicationSearchHistoryLossError';
  }
}

export class ApplicationSearchFanOutError extends Error {
  readonly code = 'APPLIK8S_SEARCH_FANOUT_EXCEEDED';

  constructor(
    readonly logicalIndex: string,
    readonly changeId: string,
    readonly maximum: number,
  ) {
    super(
      `Search index ${logicalIndex} change ${changeId} exceeds its ${maximum}-root incremental fan-out ceiling and requires partitioned repair or rebuild.`,
    );
    this.name = 'ApplicationSearchFanOutError';
  }
}

export class ApplicationSearchCursorError extends Error {
  readonly code = 'APPLIK8S_SEARCH_CURSOR_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'ApplicationSearchCursorError';
  }
}

/**
 * Deterministic provider used by conformance suites and bounded local
 * applications. It implements the same generation, checkpoint, cursor, and
 * authorization semantics expected from PostgreSQL and OpenSearch adapters.
 */
export function createDeterministicApplicationSearchRuntime<
  TDocument extends object,
>(
  options: DeterministicApplicationSearchRuntimeOptions<TDocument>,
): ApplicationSearchRuntime<TDocument> {
  assertIdentifier(options.logicalIndex, 'logicalIndex');
  assertIdentifier(options.indexRevision, 'indexRevision');
  if (!options.cursorSecret) {
    throw new Error(
      `Search index ${options.logicalIndex} requires a non-empty cursor secret.`,
    );
  }
  const fanOutCeiling = boundedInteger(
    options.fanOutCeiling,
    1,
    1_000_000,
    'fanOutCeiling',
  );
  const maximumQueryDocuments = boundedInteger(
    options.maximumQueryDocuments ?? 10_000,
    1,
    1_000_000,
    'maximumQueryDocuments',
  );
  const initialGeneration = options.initialGeneration ?? 'initial';
  assertIdentifier(initialGeneration, 'initialGeneration');
  const generations = new Map<string, SearchGeneration<TDocument>>([
    [
      initialGeneration,
      {
        documents: new Map(),
        applied: new Map(),
        checkpoint: options.initialCheckpoint ?? 0,
      },
    ],
  ]);
  let activeGeneration = initialGeneration;
  let rebuildingGeneration: string | undefined;
  let retentionFloor = 0;
  let sourceHighWatermark = options.initialCheckpoint ?? 0;
  let lastAppliedRecordedAt: number | undefined;
  let projectionState: ApplicationSearchProjectionState['state'] = 'current';
  const previousGenerations: string[] = [];
  const now = options.now ?? Date.now;

  const currentGeneration = () => {
    const generation = generations.get(activeGeneration);
    if (!generation) {
      throw new Error(
        `Search index ${options.logicalIndex} active generation ${activeGeneration} is missing.`,
      );
    }
    return generation;
  };

  const markHistoryLoss = (checkpoint: number, floor: number): never => {
    retentionFloor = floor;
    projectionState = 'rebuildRequired';
    throw new ApplicationSearchHistoryLossError(
      options.logicalIndex,
      checkpoint,
      floor,
    );
  };

  const applyToGeneration = async (
    generation: SearchGeneration<TDocument>,
    change: ApplicationSearchCommittedChange,
    updateActiveState = true,
  ): Promise<boolean> => {
    validateChange(change);
    if (change.commitPosition <= generation.checkpoint) {
      const appliedId = generation.applied.get(change.commitPosition);
      if (appliedId === undefined || appliedId === change.id) return false;
      throw new Error(
        `Search index ${options.logicalIndex} commit position ${change.commitPosition} was already applied as ${appliedId ?? '<retired evidence>'}, not ${change.id}.`,
      );
    }
    if (change.commitPosition !== generation.checkpoint + 1) {
      throw new Error(
        `Search index ${options.logicalIndex} cannot advance from checkpoint ${generation.checkpoint} to non-contiguous commit position ${change.commitPosition}.`,
      );
    }
    const affected = await options.hydration.affectedRoots(change, {
      maximum: fanOutCeiling + 1,
    });
    if (
      !affected.complete
      || affected.identities.length > fanOutCeiling
    ) {
      projectionState = 'lagging';
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
    for (const identity of identities) {
      const candidate = candidates.get(identity);
      if (!candidate || candidate.document === null) {
        generation.documents.delete(identity);
      } else {
        generation.documents.set(identity, {
          document: structuredClone(candidate.document),
          sourceProjectionRevision: candidate.sourceProjectionRevision,
        });
      }
    }
    generation.applied.set(change.commitPosition, change.id);
    generation.checkpoint = change.commitPosition;
    sourceHighWatermark = Math.max(sourceHighWatermark, change.commitPosition);
    lastAppliedRecordedAt = Date.parse(change.recordedAt);
    if (updateActiveState) {
      projectionState =
        generation.checkpoint >= sourceHighWatermark ? 'current' : 'lagging';
    }
    return true;
  };

  return {
    state() {
      const generation = currentGeneration();
      return {
        logicalIndex: options.logicalIndex,
        indexRevision: options.indexRevision,
        activeGeneration,
        checkpoint: generation.checkpoint,
        state: projectionState,
        retentionFloor,
        ...(rebuildingGeneration ? { rebuildingGeneration } : {}),
        previousGenerations: [...previousGenerations],
      };
    },
    async apply(change) {
      if (projectionState === 'rebuildRequired') {
        throw new ApplicationSearchHistoryLossError(
          options.logicalIndex,
          currentGeneration().checkpoint,
          retentionFloor,
        );
      }
      await applyToGeneration(currentGeneration(), change);
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
        const generation = currentGeneration();
        const page = await options.changes.read(
          generation.checkpoint,
          batchSize,
        );
        sourceHighWatermark = Math.max(sourceHighWatermark, page.highWatermark);
        if (page.retentionFloor > generation.checkpoint + 1) {
          markHistoryLoss(generation.checkpoint, page.retentionFloor);
        }
        retentionFloor = page.retentionFloor;
        for (const change of page.items) {
          if (await applyToGeneration(generation, change)) applied += 1;
        }
        if (page.exhausted) {
          return {
            applied,
            checkpoint: generation.checkpoint,
            exhausted: true,
          };
        }
      }
      return {
        applied,
        checkpoint: currentGeneration().checkpoint,
        exhausted: false,
      };
    },
    async rebuild(rebuildOptions) {
      assertIdentifier(rebuildOptions.generation, 'generation');
      if (rebuildOptions.generation === activeGeneration) {
        throw new Error(
          `Search index ${options.logicalIndex} cannot rebuild its active generation in place.`,
        );
      }
      if (
        rebuildingGeneration
        && rebuildingGeneration !== rebuildOptions.generation
      ) {
        throw new Error(
          `Search index ${options.logicalIndex} is already rebuilding generation ${rebuildingGeneration}.`,
        );
      }
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
      const opened = await options.snapshot.open();
      validatePosition(opened.frontier, 'snapshot frontier');
      if (!opened.snapshotId) {
        throw new Error(
          `Search index ${options.logicalIndex} snapshot returned an empty identity.`,
        );
      }
      const generation: SearchGeneration<TDocument> = {
        documents: new Map(),
        applied: new Map(),
        checkpoint: opened.frontier,
      };
      generations.set(rebuildOptions.generation, generation);
      rebuildingGeneration = rebuildOptions.generation;
      try {
        let cursor: string | undefined;
        let snapshotExhausted = false;
        try {
          for (let pageNumber = 0; pageNumber < maximumSnapshotPages; pageNumber += 1) {
            const page = await options.snapshot.read(
              opened.snapshotId,
              cursor,
              batchSize,
            );
            for (const item of page.items) {
              if (item.document === null) generation.documents.delete(item.id);
              else {
                generation.documents.set(item.id, {
                  document: structuredClone(item.document),
                  sourceProjectionRevision: item.sourceProjectionRevision,
                });
              }
            }
            cursor = page.cursor;
            if (page.exhausted) {
              snapshotExhausted = true;
              break;
            }
            if (!cursor) {
              throw new Error(
                `Search index ${options.logicalIndex} snapshot page is not exhausted and has no cursor.`,
              );
            }
          }
          if (!snapshotExhausted) {
            throw new Error(
              `Search index ${options.logicalIndex} rebuild exceeded its ${maximumSnapshotPages}-page snapshot bound.`,
            );
          }
        } finally {
          await options.snapshot.close(opened.snapshotId);
        }

        let caughtUp = false;
        for (let batch = 0; batch < maximumCatchupBatches; batch += 1) {
          const page = await options.changes.read(generation.checkpoint, batchSize);
          sourceHighWatermark = Math.max(sourceHighWatermark, page.highWatermark);
          retentionFloor = page.retentionFloor;
          if (page.retentionFloor > generation.checkpoint + 1) {
            markHistoryLoss(generation.checkpoint, page.retentionFloor);
          }
          for (const change of page.items) {
            await applyToGeneration(generation, change, false);
          }
          if (page.exhausted && generation.checkpoint >= page.highWatermark) {
            caughtUp = true;
            break;
          }
        }
        if (!caughtUp) {
          throw new Error(
            `Search index ${options.logicalIndex} rebuild did not catch up within ${maximumCatchupBatches} bounded batches.`,
          );
        }

        const validation = validationEvidence(generation.documents);
        if (!validation.schemaCompatible || !validation.authorizationCompatible) {
          throw new Error(
            `Search index ${options.logicalIndex} generation ${rebuildOptions.generation} failed schema or authorization validation.`,
          );
        }
        await rebuildOptions.validate?.(validation);
        const previousGeneration = activeGeneration;
        activeGeneration = rebuildOptions.generation;
        rebuildingGeneration = undefined;
        projectionState = 'current';
        retentionFloor = Math.min(retentionFloor, generation.checkpoint + 1);
        previousGenerations.push(previousGeneration);
        return {
          generation: rebuildOptions.generation,
          previousGeneration,
          sourceFrontier: opened.frontier,
          publishedCheckpoint: generation.checkpoint,
          documents: generation.documents.size,
          validation,
        };
      } catch (error) {
        generations.delete(rebuildOptions.generation);
        rebuildingGeneration = undefined;
        throw error;
      }
    },
    retire(generation) {
      if (generation === activeGeneration) {
        throw new Error(
          `Search index ${options.logicalIndex} cannot retire its active generation.`,
        );
      }
      generations.delete(generation);
      const index = previousGenerations.indexOf(generation);
      if (index >= 0) previousGenerations.splice(index, 1);
    },
    async search(request, admission) {
      validateSearchRequest(request, options.fields);
      validateAdmission(admission);
      const generation = currentGeneration();
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
          physicalGeneration: activeGeneration,
          checkpoint: generation.checkpoint,
          principalId: admission.principalId,
          contextDigest: admission.contextDigest,
          authorizationVersion: admission.authorizationVersion,
          queryDigest,
        });
      }
      const callerWhere = request.where ?? {};
      const mandatoryWhere = admission.where;
      const all = [...generation.documents.entries()];
      if (all.length > maximumQueryDocuments) {
        throw new Error(
          `Search index ${options.logicalIndex} deterministic provider refuses to inspect ${all.length} documents above its ${maximumQueryDocuments}-document bound.`,
        );
      }
      const visible = all
        .filter(([, value]) =>
          matchesWhere(value.document, mandatoryWhere)
          && matchesWhere(value.document, callerWhere),
        )
        .map(([id, value]) => ({
          id,
          document: value.document,
          sourceProjectionRevision: value.sourceProjectionRevision,
          score: scoreDocument(value.document, request.text, options.fields),
        }))
        .filter(({ score }) => request.text === undefined || score > 0);
      const order = Array.isArray(request.orderBy)
        ? request.orderBy
        : request.orderBy
          ? [request.orderBy]
          : [];
      visible.sort((left, right) =>
        compareSearchRows(left, right, order),
      );
      const offset = cursor?.offset ?? 0;
      const limit = boundedInteger(request.limit ?? 20, 1, 100, 'limit');
      const page = visible.slice(offset, offset + limit);
      const nextOffset = offset + page.length;
      const nextCursor =
        nextOffset < visible.length
          ? encodeCursor(
              {
                protocol: 'applik8s.search-cursor/v1alpha1',
                logicalIndex: options.logicalIndex,
                indexRevision: options.indexRevision,
                physicalGeneration: activeGeneration,
                checkpoint: generation.checkpoint,
                principalId: admission.principalId,
                contextDigest: admission.contextDigest,
                authorizationVersion: admission.authorizationVersion,
                queryDigest,
                offset: nextOffset,
              },
              options.cursorSecret,
            )
          : undefined;
      const requestedFacets = request.facets?.map(({ name }) => name) ?? [];
      const facets = Object.fromEntries(
        requestedFacets.map((field) => [
          field,
          facetBuckets(visible.map(({ document }) => document), field),
        ]),
      ) as ApplicationSearchResult<TDocument>['facets'];
      const sourceProjectionRevision =
        page.length === 0
          ? options.sourceProjectionRevision ?? ''
          : digest(
              page.map(({ sourceProjectionRevision: revision }) => revision),
            );
      return {
        hits: page.map(({ document, score }) => ({
          document: structuredClone(document),
          ...(request.text !== undefined ? { score } : {}),
        })),
        facets,
        ...(nextCursor ? { cursor: nextCursor } : {}),
        logicalIndex: options.logicalIndex,
        indexRevision: options.indexRevision,
        physicalGeneration: activeGeneration,
        sourceProjectionRevision,
        lag: {
          changes: Math.max(0, sourceHighWatermark - generation.checkpoint),
          milliseconds:
            projectionState === 'current'
              ? 0
              : lastAppliedRecordedAt === undefined
                ? 0
                : Math.max(0, now() - lastAppliedRecordedAt),
          state: projectionState,
        },
      };
    },
  };
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

function validateSearchRequest<TDocument extends object>(
  request: ApplicationSearchRequest<TDocument>,
  fields: DeterministicApplicationSearchRuntimeOptions<TDocument>['fields'],
): void {
  if (request.text !== undefined && !request.text.trim()) {
    throw new Error('Search text must not be empty when supplied.');
  }
  for (const key of Object.keys(request.where ?? {})) {
    if (!(key in fields)) throw new Error(`Search filter field ${key} is not indexed.`);
    const kind = Reflect.get(fields, key)?.kind;
    if (!['filter', 'facet', 'minimum', 'maximum', 'count'].includes(kind)) {
      throw new Error(`Search field ${key} is not filterable.`);
    }
  }
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
  }
}

function validateAdmission<TDocument extends object>(
  admission: ApplicationSearchAdmissionScope<TDocument>,
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
}

function matchesWhere<TDocument extends object>(
  document: TDocument,
  where: ApplicationSearchAdmissionScope<TDocument>['where'],
): boolean {
  return Object.entries(where).every(([field, comparison]) =>
    matchesComparison(
      Reflect.get(document, field),
      comparison as ApplicationSearchComparison<unknown>,
    ),
  );
}

function matchesComparison(
  actual: unknown,
  comparison: ApplicationSearchComparison<unknown>,
): boolean {
  if (
    comparison === null
    || typeof comparison !== 'object'
    || Array.isArray(comparison)
    || comparison instanceof Date
  ) {
    return Object.is(actual, comparison);
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
  if ('eq' in operations && !Object.is(actual, operations.eq)) return false;
  if ('ne' in operations && Object.is(actual, operations.ne)) return false;
  if (
    'in' in operations
    && operations.in
    && !operations.in.some((candidate) => Object.is(actual, candidate))
  ) return false;
  if ('lt' in operations && compareValues(actual, operations.lt) >= 0) return false;
  if ('lte' in operations && compareValues(actual, operations.lte) > 0) return false;
  if ('gt' in operations && compareValues(actual, operations.gt) <= 0) return false;
  if ('gte' in operations && compareValues(actual, operations.gte) < 0) return false;
  return true;
}

function scoreDocument<TDocument extends object>(
  document: TDocument,
  text: string | undefined,
  fields: DeterministicApplicationSearchRuntimeOptions<TDocument>['fields'],
): number {
  if (text === undefined) return 0;
  const terms = text.toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  return (Object.entries(fields) as [
    string,
    { readonly kind: DeterministicApplicationSearchRuntimeOptions<TDocument>['fields'][keyof TDocument & string]['kind'] },
  ][])
    .filter(([, field]) => field.kind === 'text')
    .reduce((score, [name]) => {
      const value = Reflect.get(document, name);
      if (typeof value !== 'string') return score;
      const normalized = value.toLocaleLowerCase();
      return score + terms.filter((term) => normalized.includes(term)).length;
    }, 0);
}

function compareSearchRows<TDocument extends object>(
  left: { readonly id: string; readonly document: TDocument; readonly score: number },
  right: { readonly id: string; readonly document: TDocument; readonly score: number },
  order: readonly { readonly field: string; readonly direction: 'asc' | 'desc' }[],
): number {
  if (order.length === 0 && left.score !== right.score) {
    return right.score - left.score;
  }
  for (const sort of order) {
    const comparison = compareValues(
      Reflect.get(left.document, sort.field),
      Reflect.get(right.document, sort.field),
    );
    if (comparison !== 0) return sort.direction === 'asc' ? comparison : -comparison;
  }
  return left.id.localeCompare(right.id);
}

function compareValues(left: unknown, right: unknown): number {
  const normalizedLeft = left instanceof Date ? left.getTime() : left;
  const normalizedRight = right instanceof Date ? right.getTime() : right;
  if (normalizedLeft === normalizedRight) return 0;
  if (normalizedLeft === null || normalizedLeft === undefined) return -1;
  if (normalizedRight === null || normalizedRight === undefined) return 1;
  return normalizedLeft < normalizedRight ? -1 : 1;
}

function facetBuckets<TDocument extends object>(
  documents: readonly TDocument[],
  field: string,
): readonly { readonly value: unknown; readonly count: number }[] {
  const counts = new Map<string, { readonly value: unknown; count: number }>();
  for (const document of documents) {
    const value = Reflect.get(document, field);
    const values = Array.isArray(value) ? value : [value];
    for (const candidate of values) {
      const key = digest(candidate);
      const existing = counts.get(key);
      if (existing) existing.count += 1;
      else counts.set(key, { value: candidate, count: 1 });
    }
  }
  return [...counts.values()].sort(
    (left, right) =>
      right.count - left.count
      || String(left.value).localeCompare(String(right.value)),
  );
}

function validationEvidence<TDocument extends object>(
  documents: ReadonlyMap<
    string,
    {
      readonly document: TDocument;
      readonly sourceProjectionRevision: string;
    }
  >,
): ApplicationSearchRebuildValidation {
  const entries = [...documents.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return {
    count: entries.length,
    checksum: digest(
      entries.map(([id, value]) => ({
        id,
        document: value.document,
        sourceProjectionRevision: value.sourceProjectionRevision,
      })),
    ),
    sampleIdentities: entries.slice(0, 10).map(([id]) => id),
    authorizationCompatible: true,
    schemaCompatible: entries.every(([, value]) =>
      Boolean(value.document && typeof value.document === 'object'),
    ),
  };
}

function encodeCursor(cursor: SearchCursor, secret: string): string {
  const payload = Buffer.from(JSON.stringify(cursor)).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function decodeCursor(encoded: string, secret: string): SearchCursor {
  const [payload, signature, extra] = encoded.split('.');
  if (!payload || !signature || extra !== undefined) {
    throw new ApplicationSearchCursorError('Search cursor is malformed.');
  }
  const expected = createHmac('sha256', secret).update(payload).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(signature, 'base64url');
  } catch {
    throw new ApplicationSearchCursorError('Search cursor signature is malformed.');
  }
  if (
    actual.length !== expected.length
    || !timingSafeEqual(actual, expected)
  ) {
    throw new ApplicationSearchCursorError('Search cursor signature is invalid.');
  }
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SearchCursor;
  } catch {
    throw new ApplicationSearchCursorError('Search cursor payload is invalid.');
  }
}

function validateCursor(
  cursor: SearchCursor,
  expected: Omit<SearchCursor, 'protocol' | 'offset'>,
): void {
  if (
    cursor.protocol !== 'applik8s.search-cursor/v1alpha1'
    || !Number.isSafeInteger(cursor.offset)
    || cursor.offset < 0
  ) {
    throw new ApplicationSearchCursorError('Search cursor contract is invalid.');
  }
  for (const [key, value] of Object.entries(expected)) {
    if (Reflect.get(cursor, key) !== value) {
      throw new ApplicationSearchCursorError(
        `Search cursor ${key} does not match the current admitted query.`,
      );
    }
  }
}

function validatePosition(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Search ${name} must be a non-negative safe integer.`);
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
      `Search ${name} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}

function assertIdentifier(value: string, name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) {
    throw new Error(
      `Search ${name} must be a stable non-empty identifier.`,
    );
  }
}

function digest(value: unknown): string {
  return createHash('sha256')
    .update(stableJson(value))
    .digest('hex');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
