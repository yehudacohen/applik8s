// typecast-file-boundary: PostgreSQL search rows and cursor payloads are validated against compiled index contracts before typed document reconstruction.
import { createHash } from 'node:crypto';
import type {
  ApplicationSearchComparison,
  ApplicationSearchRequest,
  ApplicationSearchResult,
} from './application-search.js';
import type {
  ApplicationPostgresSql,
  ApplicationPostgresTransactionSql,
} from './postgres-runtime-contract.js';
import { createApplicationPostgresSql } from './postgres-runtime-loader.js';
import { createApplicationSearchCursorCodec } from './search-cursor-codec.js';
import { applicationSearchDigest } from './search-integrity.js';
import { applicationSearchLegacyOffsetDigestV07 } from './search-integrity-legacy-v07.js';
import {
  type ApplicationSearchAdmissionScope,
  type ApplicationSearchChangePage,
  type ApplicationSearchChangeSource,
  type ApplicationSearchCommittedChange,
  ApplicationSearchFanOutError,
  ApplicationSearchHistoryLossError,
  type ApplicationSearchHydratedDocument,
  type ApplicationSearchHydration,
  type ApplicationSearchProjectionState,
  type ApplicationSearchRebuildResult,
  type ApplicationSearchRebuildValidation,
  type ApplicationSearchRuntime,
  type ApplicationSearchRuntimeFields,
  type ApplicationSearchSnapshotSource,
} from './search-runtime.js';

type SearchFieldMap<TDocument extends object> =
  ApplicationSearchRuntimeFields<TDocument>;

export interface PostgresApplicationSearchRuntimeOptions<
  TDocument extends object,
> {
  readonly logicalIndex: string;
  readonly indexRevision: string;
  readonly databaseUrl?: string;
  readonly sql?: ApplicationPostgresSql;
  readonly schema?: string;
  readonly initialGeneration?: string;
  readonly initialCheckpoint?: number;
  readonly sourceProjectionRevision?: string;
  readonly cursorSecret: string;
  /** Search page cursors expire after this duration; defaults to 15 minutes. */
  readonly cursorLifetimeMs?: number;
  readonly fields: SearchFieldMap<TDocument>;
  readonly hydration: ApplicationSearchHydration<TDocument>;
  readonly changes: ApplicationSearchChangeSource;
  readonly snapshot: ApplicationSearchSnapshotSource<TDocument>;
  readonly fanOutCeiling: number;
  /**
   * Complete candidate universes above this ceiling are rejected before
   * authorization-sensitive facets, sorting, pagination, or results exist.
   */
  readonly maximumCandidateRows?: number;
  readonly now?: () => number;
}

export interface PostgresApplicationSearchRuntime<
  TDocument extends object,
> extends ApplicationSearchRuntime<TDocument> {
  /** Refreshes the process-local state view from durable provider authority. */
  refresh(): Promise<ApplicationSearchProjectionState>;
  close(): Promise<void>;
}

interface DurableIndexRow {
  readonly active_generation: unknown;
  readonly rebuilding_generation: unknown;
  readonly state: unknown;
  readonly retention_floor: unknown;
  readonly source_high_watermark: unknown;
  readonly last_applied_recorded_at: unknown;
  readonly previous_generations: unknown;
  readonly checkpoint: unknown;
}

interface DurableDocumentRow {
  readonly document_id: unknown;
  readonly document: unknown;
  readonly source_projection_revision: unknown;
  readonly score: unknown;
}

interface DurableGenerationRow {
  readonly checkpoint: unknown;
}

const SEARCH_INDEXES = 'applik8s_search_indexes';
const SEARCH_GENERATIONS = 'applik8s_search_generations';
const SEARCH_DOCUMENTS = 'applik8s_search_documents';
const SEARCH_APPLIED_CHANGES = 'applik8s_search_applied_changes';

/**
 * Returns the idempotent provider migration used by the PostgreSQL search
 * adapter. The fixed tables are shared and partitioned by logical index,
 * revision, and physical generation.
 */
export function postgresApplicationSearchMigrationSql(
  schema = 'public',
): readonly string[] {
  const namespace = postgresIdentifier(schema, 'schema');
  const indexes = qualified(namespace, SEARCH_INDEXES);
  const generations = qualified(namespace, SEARCH_GENERATIONS);
  const documents = qualified(namespace, SEARCH_DOCUMENTS);
  const applied = qualified(namespace, SEARCH_APPLIED_CHANGES);
  const vectorIndex = quoteIdentifier(
    postgresIndexName(schema, 'applik8s_search_documents_vector_idx'),
  );
  const jsonIndex = quoteIdentifier(
    postgresIndexName(schema, 'applik8s_search_documents_json_idx'),
  );
  const generationIndex = quoteIdentifier(
    postgresIndexName(schema, 'applik8s_search_documents_generation_idx'),
  );
  return [
    `CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(namespace)}`,
    `CREATE TABLE IF NOT EXISTS ${indexes} (
      logical_index text NOT NULL,
      index_revision text NOT NULL,
      active_generation text NOT NULL,
      rebuilding_generation text,
      state text NOT NULL CHECK (state IN ('current', 'lagging', 'rebuildRequired')),
      retention_floor bigint NOT NULL DEFAULT 0 CHECK (retention_floor >= 0),
      source_high_watermark bigint NOT NULL DEFAULT 0 CHECK (source_high_watermark >= 0),
      last_applied_recorded_at timestamptz,
      previous_generations jsonb NOT NULL DEFAULT '[]'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (logical_index, index_revision)
    )`,
    `CREATE TABLE IF NOT EXISTS ${generations} (
      logical_index text NOT NULL,
      index_revision text NOT NULL,
      generation text NOT NULL,
      checkpoint bigint NOT NULL DEFAULT 0 CHECK (checkpoint >= 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (logical_index, index_revision, generation)
    )`,
    `CREATE TABLE IF NOT EXISTS ${documents} (
      logical_index text NOT NULL,
      index_revision text NOT NULL,
      generation text NOT NULL,
      document_id text NOT NULL,
      document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
      source_projection_revision text NOT NULL,
      search_text text NOT NULL DEFAULT '',
      search_vector tsvector GENERATED ALWAYS AS (
        to_tsvector('simple'::regconfig, search_text)
      ) STORED,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (logical_index, index_revision, generation, document_id)
    )`,
    `CREATE INDEX IF NOT EXISTS ${vectorIndex} ON ${documents} USING GIN (search_vector)`,
    `CREATE INDEX IF NOT EXISTS ${jsonIndex} ON ${documents} USING GIN (document jsonb_path_ops)`,
    `CREATE INDEX IF NOT EXISTS ${generationIndex} ON ${documents} (
      logical_index,
      index_revision,
      generation,
      document_id
    )`,
    `CREATE TABLE IF NOT EXISTS ${applied} (
      logical_index text NOT NULL,
      index_revision text NOT NULL,
      generation text NOT NULL,
      commit_position bigint NOT NULL CHECK (commit_position > 0),
      change_id text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (logical_index, index_revision, generation, commit_position),
      UNIQUE (logical_index, index_revision, generation, change_id)
    )`,
  ];
}

/**
 * Persistent bounded PostgreSQL implementation of the provider-neutral search
 * runtime. Canonical data remains outside these tables; every stored document
 * is a rebuildable whole-document projection.
 */
export async function createPostgresApplicationSearchRuntime<
  TDocument extends object,
>(
  options: PostgresApplicationSearchRuntimeOptions<TDocument>,
): Promise<PostgresApplicationSearchRuntime<TDocument>> {
  assertStableIdentifier(options.logicalIndex, 'logicalIndex');
  assertStableIdentifier(options.indexRevision, 'indexRevision');
  if (!options.cursorSecret) {
    throw new Error(
      `Search index ${options.logicalIndex} requires a non-empty cursor secret.`,
    );
  }
  if (!options.sql && !options.databaseUrl) {
    throw new Error(
      `Search index ${options.logicalIndex} requires databaseUrl or an injected PostgreSQL client.`,
    );
  }
  const schema = postgresIdentifier(options.schema ?? 'public', 'schema');
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
  const maximumCandidateRows = boundedInteger(
    options.maximumCandidateRows ?? 10_000,
    1,
    1_000_000,
    'maximumCandidateRows',
  );
  const ownsClient = !options.sql;
  const sql =
    options.sql
    ?? await createApplicationPostgresSql(options.databaseUrl as string, {
      max: 8,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    });
  const tables = {
    indexes: qualified(schema, SEARCH_INDEXES),
    generations: qualified(schema, SEARCH_GENERATIONS),
    documents: qualified(schema, SEARCH_DOCUMENTS),
    applied: qualified(schema, SEARCH_APPLIED_CHANGES),
  };
  const identityParameters = [options.logicalIndex, options.indexRevision] as const;
  const lockIdentity = `applik8s.search/${options.logicalIndex}/${options.indexRevision}`;
  const now = options.now ?? Date.now;
  const cursorCodec = createApplicationSearchCursorCodec({
    secret: options.cursorSecret,
    now,
    ...(options.cursorLifetimeMs === undefined
      ? {}
      : { lifetimeMs: options.cursorLifetimeMs }),
  });
  validateRuntimeFields(options.fields);

  for (const statement of postgresApplicationSearchMigrationSql(schema)) {
    await sql.unsafe(statement);
  }
  await sql.unsafe(
    `INSERT INTO ${tables.indexes} (
      logical_index,
      index_revision,
      active_generation,
      state,
      retention_floor,
      source_high_watermark
    ) VALUES ($1, $2, $3, 'current', 0, $4)
    ON CONFLICT (logical_index, index_revision) DO NOTHING`,
    [
      options.logicalIndex,
      options.indexRevision,
      initialGeneration,
      initialCheckpoint,
    ],
  );
  await sql.unsafe(
    `INSERT INTO ${tables.generations} (
      logical_index,
      index_revision,
      generation,
      checkpoint
    ) VALUES ($1, $2, $3, $4)
    ON CONFLICT (logical_index, index_revision, generation) DO NOTHING`,
    [
      options.logicalIndex,
      options.indexRevision,
      initialGeneration,
      initialCheckpoint,
    ],
  );

  let cachedState = await readState(sql, tables, identityParameters);
  let cachedSourceHighWatermark = cachedState.checkpoint;
  let cachedLastAppliedAt: number | undefined;

  const refresh = async (): Promise<ApplicationSearchProjectionState> => {
    const detailed = await readDetailedState(sql, tables, identityParameters);
    cachedState = detailed.state;
    cachedSourceHighWatermark = detailed.sourceHighWatermark;
    cachedLastAppliedAt = detailed.lastAppliedAt;
    return cachedState;
  };
  await refresh();

  const setSourcePage = async (
    page: ApplicationSearchChangePage,
    checkpoint: number,
  ): Promise<void> => {
    validatePosition(page.retentionFloor, 'retentionFloor');
    validatePosition(page.highWatermark, 'highWatermark');
    await sql.begin(async (transaction) => {
      await acquireSearchLock(transaction, lockIdentity);
      await transaction.unsafe(
        `UPDATE ${tables.indexes}
        SET retention_floor = $3::bigint,
            source_high_watermark = GREATEST(
              source_high_watermark,
              $4::bigint
            ),
            state = CASE
              WHEN $3::bigint > $5::bigint + 1 THEN 'rebuildRequired'
              WHEN $5::bigint >= GREATEST(
                source_high_watermark,
                $4::bigint
              ) THEN 'current'
              ELSE 'lagging'
            END,
            updated_at = now()
        WHERE logical_index = $1 AND index_revision = $2`,
        [
          options.logicalIndex,
          options.indexRevision,
          page.retentionFloor,
          page.highWatermark,
          checkpoint,
        ],
      );
    });
    await refresh();
    if (page.retentionFloor > checkpoint + 1) {
      throw new ApplicationSearchHistoryLossError(
        options.logicalIndex,
        checkpoint,
        page.retentionFloor,
      );
    }
  };

  const hydrateChange = async (
    change: ApplicationSearchCommittedChange,
  ): Promise<readonly ApplicationSearchHydratedDocument<TDocument>[]> => {
    validateChange(change);
    const affected = await options.hydration.affectedRoots(change, {
      maximum: fanOutCeiling + 1,
    });
    if (!affected.complete || affected.identities.length > fanOutCeiling) {
      await sql.unsafe(
        `UPDATE ${tables.indexes}
        SET state = 'lagging', updated_at = now()
        WHERE logical_index = $1 AND index_revision = $2`,
        identityParameters,
      );
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

  const applyToGeneration = async (
    generation: string,
    change: ApplicationSearchCommittedChange,
    hydrated: readonly ApplicationSearchHydratedDocument<TDocument>[],
    updateActiveState: boolean,
  ): Promise<boolean> => {
    const applied = await sql.begin(async (transaction) => {
      await acquireSearchLock(transaction, lockIdentity);
      const indexRows = await transaction.unsafe(
        `SELECT active_generation, state
        FROM ${tables.indexes}
        WHERE logical_index = $1 AND index_revision = $2
        FOR UPDATE`,
        identityParameters,
      );
      const indexRow = requiredRow(indexRows, 'search index state');
      if (
        updateActiveState
        && String(indexRow.state) === 'rebuildRequired'
      ) {
        const state = await readState(
          transaction,
          tables,
          identityParameters,
        );
        throw new ApplicationSearchHistoryLossError(
          options.logicalIndex,
          state.checkpoint,
          state.retentionFloor,
        );
      }
      if (
        updateActiveState
        && String(indexRow.active_generation) !== generation
      ) {
        throw new Error(
          `Search index ${options.logicalIndex} active generation changed from ${generation} to ${String(indexRow.active_generation)} before apply.`,
        );
      }
      const generationRows = await transaction.unsafe(
        `SELECT checkpoint
        FROM ${tables.generations}
        WHERE logical_index = $1
          AND index_revision = $2
          AND generation = $3
        FOR UPDATE`,
        [...identityParameters, generation],
      );
      const generationRow = requiredRow(
        generationRows,
        `search generation ${generation}`,
      ) as unknown as DurableGenerationRow;
      const checkpoint = databaseInteger(
        generationRow.checkpoint,
        'generation checkpoint',
      );
      if (change.commitPosition <= checkpoint) {
        const evidence = await transaction.unsafe(
          `SELECT change_id
          FROM ${tables.applied}
          WHERE logical_index = $1
            AND index_revision = $2
            AND generation = $3
            AND commit_position = $4`,
          [
            ...identityParameters,
            generation,
            change.commitPosition,
          ],
        );
        const appliedId =
          evidence.length === 0
            ? undefined
            : String(
                Reflect.get(
                  requiredRow(evidence, 'applied change evidence'),
                  'change_id',
                ),
              );
        if (appliedId === undefined || appliedId === change.id) return false;
        throw new Error(
          `Search index ${options.logicalIndex} commit position ${change.commitPosition} was already applied as ${appliedId}, not ${change.id}.`,
        );
      }
      if (change.commitPosition !== checkpoint + 1) {
        throw new Error(
          `Search index ${options.logicalIndex} cannot advance generation ${generation} from checkpoint ${checkpoint} to non-contiguous commit position ${change.commitPosition}.`,
        );
      }
      await replaceDocuments(
        transaction,
        tables.documents,
        options.logicalIndex,
        options.indexRevision,
        generation,
        hydrated,
        options.fields,
      );
      await transaction.unsafe(
        `INSERT INTO ${tables.applied} (
          logical_index,
          index_revision,
          generation,
          commit_position,
          change_id
        ) VALUES ($1, $2, $3, $4, $5)`,
        [
          ...identityParameters,
          generation,
          change.commitPosition,
          change.id,
        ],
      );
      await transaction.unsafe(
        `UPDATE ${tables.generations}
        SET checkpoint = $4
        WHERE logical_index = $1
          AND index_revision = $2
          AND generation = $3`,
        [
          ...identityParameters,
          generation,
          change.commitPosition,
        ],
      );
      if (updateActiveState) {
        await transaction.unsafe(
          `UPDATE ${tables.indexes}
          SET source_high_watermark = GREATEST(source_high_watermark, $3),
              last_applied_recorded_at = $4::timestamptz,
              state = CASE
                WHEN $3 >= source_high_watermark THEN 'current'
                ELSE 'lagging'
              END,
              updated_at = now()
          WHERE logical_index = $1 AND index_revision = $2`,
          [
            ...identityParameters,
            change.commitPosition,
            change.recordedAt,
          ],
        );
      }
      return true;
    });
    await refresh();
    return applied;
  };

  const runtime: PostgresApplicationSearchRuntime<TDocument> = {
    state() {
      return { ...cachedState, previousGenerations: [...cachedState.previousGenerations] };
    },
    refresh,
    async apply(change) {
      await refresh();
      const state = cachedState;
      if (state.state === 'rebuildRequired') {
        throw new ApplicationSearchHistoryLossError(
          options.logicalIndex,
          state.checkpoint,
          state.retentionFloor,
        );
      }
      const hydrated = await hydrateChange(change);
      await applyToGeneration(
        state.activeGeneration,
        change,
        hydrated,
        true,
      );
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
        await refresh();
        const state = cachedState;
        if (state.state === 'rebuildRequired') {
          throw new ApplicationSearchHistoryLossError(
            options.logicalIndex,
            state.checkpoint,
            state.retentionFloor,
          );
        }
        const page = await options.changes.read(state.checkpoint, batchSize);
        await setSourcePage(page, state.checkpoint);
        for (const change of page.items) {
          const hydrated = await hydrateChange(change);
          if (
            await applyToGeneration(
              state.activeGeneration,
              change,
              hydrated,
              true,
            )
          ) {
            applied += 1;
          }
        }
        await refresh();
        if (page.exhausted) {
          return {
            applied,
            checkpoint: cachedState.checkpoint,
            exhausted: true,
          };
        }
      }
      return {
        applied,
        checkpoint: cachedState.checkpoint,
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
      await refresh();
      if (rebuildOptions.generation === cachedState.activeGeneration) {
        throw new Error(
          `Search index ${options.logicalIndex} cannot rebuild its active generation in place.`,
        );
      }
      await sql.begin(async (transaction) => {
        await acquireSearchLock(transaction, lockIdentity);
        const rows = await transaction.unsafe(
          `SELECT active_generation, rebuilding_generation
          FROM ${tables.indexes}
          WHERE logical_index = $1 AND index_revision = $2
          FOR UPDATE`,
          identityParameters,
        );
        const row = requiredRow(rows, 'search index state');
        const rebuilding =
          row.rebuilding_generation === null
          || row.rebuilding_generation === undefined
            ? undefined
            : String(row.rebuilding_generation);
        if (String(row.active_generation) === rebuildOptions.generation) {
          throw new Error(
            `Search index ${options.logicalIndex} cannot rebuild its active generation in place.`,
          );
        }
        if (rebuilding && rebuilding !== rebuildOptions.generation) {
          throw new Error(
            `Search index ${options.logicalIndex} is already rebuilding generation ${rebuilding}.`,
          );
        }
        await transaction.unsafe(
          `UPDATE ${tables.indexes}
          SET rebuilding_generation = $3, updated_at = now()
          WHERE logical_index = $1 AND index_revision = $2`,
          [...identityParameters, rebuildOptions.generation],
        );
        await transaction.unsafe(
          `DELETE FROM ${tables.applied}
          WHERE logical_index = $1 AND index_revision = $2 AND generation = $3`,
          [...identityParameters, rebuildOptions.generation],
        );
        await transaction.unsafe(
          `DELETE FROM ${tables.documents}
          WHERE logical_index = $1 AND index_revision = $2 AND generation = $3`,
          [...identityParameters, rebuildOptions.generation],
        );
        await transaction.unsafe(
          `INSERT INTO ${tables.generations} (
            logical_index,
            index_revision,
            generation,
            checkpoint
          ) VALUES ($1, $2, $3, 0)
          ON CONFLICT (logical_index, index_revision, generation)
          DO UPDATE SET checkpoint = 0, created_at = now()`,
          [...identityParameters, rebuildOptions.generation],
        );
      });
      await refresh();

      try {
        const opened = await options.snapshot.open();
        validatePosition(opened.frontier, 'snapshot frontier');
        if (!opened.snapshotId) {
          throw new Error(
            `Search index ${options.logicalIndex} snapshot returned an empty identity.`,
          );
        }
        let cursor: string | undefined;
        let snapshotExhausted = false;
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
            await sql.begin(async (transaction) => {
              await replaceDocuments(
                transaction,
                tables.documents,
                options.logicalIndex,
                options.indexRevision,
                rebuildOptions.generation,
                page.items,
                options.fields,
              );
              await transaction.unsafe(
                `UPDATE ${tables.generations}
                SET checkpoint = $4
                WHERE logical_index = $1
                  AND index_revision = $2
                  AND generation = $3`,
                [
                  ...identityParameters,
                  rebuildOptions.generation,
                  opened.frontier,
                ],
              );
            });
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
        let rebuildingCheckpoint = opened.frontier;
        for (
          let batch = 0;
          batch < maximumCatchupBatches;
          batch += 1
        ) {
          const page = await options.changes.read(
            rebuildingCheckpoint,
            batchSize,
          );
          await setSourcePage(page, rebuildingCheckpoint);
          for (const change of page.items) {
            const hydrated = await hydrateChange(change);
            await applyToGeneration(
              rebuildOptions.generation,
              change,
              hydrated,
              false,
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

        const validation = await readValidation(
          sql,
          tables.documents,
          options.logicalIndex,
          options.indexRevision,
          rebuildOptions.generation,
        );
        if (
          !validation.schemaCompatible
          || !validation.authorizationCompatible
        ) {
          throw new Error(
            `Search index ${options.logicalIndex} generation ${rebuildOptions.generation} failed schema or authorization validation.`,
          );
        }
        await rebuildOptions.validate?.(validation);

        const previousGeneration = await sql.begin(async (transaction) => {
          await acquireSearchLock(transaction, lockIdentity);
          const rows = await transaction.unsafe(
            `SELECT active_generation,
                    rebuilding_generation,
                    source_high_watermark,
                    previous_generations
            FROM ${tables.indexes}
            WHERE logical_index = $1 AND index_revision = $2
            FOR UPDATE`,
            identityParameters,
          );
          const row = requiredRow(rows, 'search index state');
          if (
            String(row.rebuilding_generation)
            !== rebuildOptions.generation
          ) {
            throw new Error(
              `Search index ${options.logicalIndex} rebuilding generation changed before cutover.`,
            );
          }
          const highWatermark = databaseInteger(
            row.source_high_watermark,
            'source high watermark',
          );
          if (rebuildingCheckpoint < highWatermark) {
            throw new Error(
              `Search index ${options.logicalIndex} generation ${rebuildOptions.generation} cannot cut over at checkpoint ${rebuildingCheckpoint} behind source high watermark ${highWatermark}.`,
            );
          }
          const previous = String(row.active_generation);
          const prior = parseStringArray(row.previous_generations);
          const nextPrior = [...new Set([...prior, previous])];
          await transaction.unsafe(
            `UPDATE ${tables.indexes}
            SET active_generation = $3,
                rebuilding_generation = NULL,
                state = 'current',
                previous_generations = $4::jsonb,
                updated_at = now()
            WHERE logical_index = $1 AND index_revision = $2`,
            [
              ...identityParameters,
              rebuildOptions.generation,
              transaction.json(nextPrior),
            ],
          );
          return previous;
        });
        await refresh();
        return {
          generation: rebuildOptions.generation,
          previousGeneration,
          sourceFrontier: opened.frontier,
          publishedCheckpoint: cachedState.checkpoint,
          documents: validation.count,
          validation,
        };
      } catch (error) {
        await sql.begin(async (transaction) => {
          await acquireSearchLock(transaction, lockIdentity);
          await transaction.unsafe(
            `DELETE FROM ${tables.applied}
            WHERE logical_index = $1 AND index_revision = $2 AND generation = $3`,
            [...identityParameters, rebuildOptions.generation],
          );
          await transaction.unsafe(
            `DELETE FROM ${tables.documents}
            WHERE logical_index = $1 AND index_revision = $2 AND generation = $3`,
            [...identityParameters, rebuildOptions.generation],
          );
          await transaction.unsafe(
            `DELETE FROM ${tables.generations}
            WHERE logical_index = $1 AND index_revision = $2 AND generation = $3`,
            [...identityParameters, rebuildOptions.generation],
          );
          await transaction.unsafe(
            `UPDATE ${tables.indexes}
            SET rebuilding_generation = CASE
                  WHEN rebuilding_generation = $3 THEN NULL
                  ELSE rebuilding_generation
                END,
                updated_at = now()
            WHERE logical_index = $1 AND index_revision = $2`,
            [...identityParameters, rebuildOptions.generation],
          );
        });
        await refresh();
        throw error;
      }
    },
    async retire(generation) {
      assertStableIdentifier(generation, 'generation');
      await sql.begin(async (transaction) => {
        await acquireSearchLock(transaction, lockIdentity);
        const rows = await transaction.unsafe(
          `SELECT active_generation, rebuilding_generation, previous_generations
          FROM ${tables.indexes}
          WHERE logical_index = $1 AND index_revision = $2
          FOR UPDATE`,
          identityParameters,
        );
        const row = requiredRow(rows, 'search index state');
        if (String(row.active_generation) === generation) {
          throw new Error(
            `Search index ${options.logicalIndex} cannot retire its active generation.`,
          );
        }
        if (String(row.rebuilding_generation) === generation) {
          throw new Error(
            `Search index ${options.logicalIndex} cannot retire its rebuilding generation.`,
          );
        }
        await transaction.unsafe(
          `DELETE FROM ${tables.applied}
          WHERE logical_index = $1 AND index_revision = $2 AND generation = $3`,
          [...identityParameters, generation],
        );
        await transaction.unsafe(
          `DELETE FROM ${tables.documents}
          WHERE logical_index = $1 AND index_revision = $2 AND generation = $3`,
          [...identityParameters, generation],
        );
        await transaction.unsafe(
          `DELETE FROM ${tables.generations}
          WHERE logical_index = $1 AND index_revision = $2 AND generation = $3`,
          [...identityParameters, generation],
        );
        const previous = parseStringArray(row.previous_generations).filter(
          (candidate) => candidate !== generation,
        );
        await transaction.unsafe(
          `UPDATE ${tables.indexes}
          SET previous_generations = $3::jsonb, updated_at = now()
          WHERE logical_index = $1 AND index_revision = $2`,
          [...identityParameters, transaction.json(previous)],
        );
      });
      await refresh();
    },
    async search(request, admission) {
      validateSearchRequest(request, options.fields);
      validateAdmission(admission, options.fields);
      const queryIdentity = {
        text: request.text ?? '',
        where: request.where ?? {},
        facets: request.facets?.map(({ name }) => name) ?? [],
        orderBy: request.orderBy ?? [],
        limit: request.limit ?? 20,
      };
      const queryDigest = applicationSearchDigest(queryIdentity);
      const legacyQueryDigest = applicationSearchLegacyOffsetDigestV07(queryIdentity);
      return sql.begin(async (transaction) => {
        await transaction.unsafe(
          'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
        );
        const detailed = await readDetailedState(
          transaction,
          tables,
          identityParameters,
        );
        cachedState = detailed.state;
        cachedSourceHighWatermark = detailed.sourceHighWatermark;
        cachedLastAppliedAt = detailed.lastAppliedAt;
        const state = detailed.state;
        const cursor = request.cursor
          ? await cursorCodec.decode(request.cursor, {
              logicalIndex: options.logicalIndex,
              indexRevision: options.indexRevision,
              physicalGeneration: state.activeGeneration,
              checkpoint: state.checkpoint,
              principalId: admission.principalId,
              contextDigest: admission.contextDigest,
              authorizationVersion: admission.authorizationVersion,
              queryDigest,
              ...(legacyQueryDigest === queryDigest
                ? {}
                : { legacyQueryDigests: [legacyQueryDigest] }),
              continuationKind: 'offset',
            })
          : undefined;
        const parameters: unknown[] = [
          options.logicalIndex,
          options.indexRevision,
          state.activeGeneration,
        ];
        const predicates = [
          'logical_index = $1',
          'index_revision = $2',
          'generation = $3',
        ];
        if (request.text !== undefined) {
          parameters.push(request.text);
          predicates.push(
            `search_vector @@ websearch_to_tsquery('simple'::regconfig, $${parameters.length})`,
          );
        }
        appendIndexedWhere(
          predicates,
          parameters,
          admission.where,
          postgresApplicationSearchFilterJsonText,
        );
        appendIndexedWhere(
          predicates,
          parameters,
          request.where ?? {},
          postgresApplicationSearchFilterJsonText,
        );
        parameters.push(maximumCandidateRows + 1);
        const limitParameter = parameters.length;
        const rows = await transaction.unsafe(
          `SELECT document_id,
                  document,
                  source_projection_revision,
                  0::float8 AS score
          FROM ${tables.documents}
          WHERE ${predicates.join(' AND ')}
          ORDER BY document_id ASC
          LIMIT $${limitParameter}`,
          parameters,
        ) as readonly unknown[] as readonly DurableDocumentRow[];
        if (rows.length > maximumCandidateRows) {
          throw new ApplicationPostgresSearchBoundError(
            options.logicalIndex,
            maximumCandidateRows,
          );
        }
        const callerWhere = request.where ?? {};
        const visible = rows
          .map((row) => {
            const document = parseDocument<TDocument>(row.document);
            return {
              id: String(row.document_id),
              document,
              sourceProjectionRevision: String(
                row.source_projection_revision,
              ),
              score: scoreDocument(
                document,
                request.text,
                options.fields,
              ),
            };
          })
          .filter(
            ({ document }) =>
              matchesWhere(document, admission.where)
              && matchesWhere(document, callerWhere),
          );
        const order = Array.isArray(request.orderBy)
          ? request.orderBy
          : request.orderBy
            ? [request.orderBy]
            : [];
        visible.sort((left, right) =>
          compareSearchRows(left, right, order),
        );
        const offset = cursor?.continuation.kind === 'offset'
          ? cursor.continuation.offset
          : 0;
        const limit = boundedInteger(
          request.limit ?? 20,
          1,
          100,
          'limit',
        );
        const page = visible.slice(offset, offset + limit);
        const nextOffset = offset + page.length;
        const nextCursor =
          nextOffset < visible.length
            ? await cursorCodec.encode(
                {
                  logicalIndex: options.logicalIndex,
                  indexRevision: options.indexRevision,
                  physicalGeneration: state.activeGeneration,
                  checkpoint: state.checkpoint,
                  principalId: admission.principalId,
                  contextDigest: admission.contextDigest,
                  authorizationVersion: admission.authorizationVersion,
                  queryDigest,
                  continuation: { kind: 'offset', offset: nextOffset },
                },
              )
            : undefined;
        const requestedFacets =
          request.facets?.map(({ name }) => name) ?? [];
        const facets = Object.fromEntries(
          requestedFacets.map((field) => [
            field,
            facetBuckets(
              visible.map(({ document }) => document),
              field,
            ),
          ]),
        ) as ApplicationSearchResult<TDocument>['facets'];
        const sourceProjectionRevision =
          page.length === 0
            ? options.sourceProjectionRevision ?? ''
            : applicationSearchDigest(
                page.map(
                  ({
                    sourceProjectionRevision: revision,
                  }) => revision,
                ),
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
          physicalGeneration: state.activeGeneration,
          sourceProjectionRevision,
          lag: {
            changes: Math.max(
              0,
              cachedSourceHighWatermark - state.checkpoint,
            ),
            milliseconds:
              state.state === 'current'
                ? 0
                : cachedLastAppliedAt === undefined
                  ? 0
                  : Math.max(0, now() - cachedLastAppliedAt),
            state: state.state,
          },
        };
      });
    },
    async close() {
      if (ownsClient) {
        await sql.end({ timeout: 5 });
      }
    },
  };
  return runtime;
}

export class ApplicationPostgresSearchBoundError extends Error {
  readonly code = 'APPLIK8S_SEARCH_CANDIDATE_BOUND_EXCEEDED';

  constructor(
    readonly logicalIndex: string,
    readonly maximum: number,
  ) {
    super(
      `Search index ${logicalIndex} refuses to construct authorization-sensitive results from a candidate universe above its ${maximum}-row PostgreSQL bound.`,
    );
    this.name = 'ApplicationPostgresSearchBoundError';
  }
}

async function acquireSearchLock(
  transaction: ApplicationPostgresTransactionSql,
  identity: string,
): Promise<void> {
  await transaction.unsafe(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [identity],
  );
}

async function readState(
  sql: Pick<ApplicationPostgresSql, 'unsafe'> | ApplicationPostgresTransactionSql,
  tables: {
    readonly indexes: string;
    readonly generations: string;
  },
  identity: readonly [string, string],
): Promise<ApplicationSearchProjectionState> {
  return (await readDetailedState(sql, tables, identity)).state;
}

async function readDetailedState(
  sql: Pick<ApplicationPostgresSql, 'unsafe'> | ApplicationPostgresTransactionSql,
  tables: {
    readonly indexes: string;
    readonly generations: string;
  },
  identity: readonly [string, string],
): Promise<{
  readonly state: ApplicationSearchProjectionState;
  readonly sourceHighWatermark: number;
  readonly lastAppliedAt?: number;
}> {
  const rows = await sql.unsafe(
    `SELECT i.active_generation,
            i.rebuilding_generation,
            i.state,
            i.retention_floor,
            i.source_high_watermark,
            i.last_applied_recorded_at,
            i.previous_generations,
            g.checkpoint
    FROM ${tables.indexes} i
    JOIN ${tables.generations} g
      ON g.logical_index = i.logical_index
      AND g.index_revision = i.index_revision
      AND g.generation = i.active_generation
    WHERE i.logical_index = $1 AND i.index_revision = $2`,
    identity,
  );
  const row = requiredRow(rows, 'search index state') as unknown as DurableIndexRow;
  const activeGeneration = String(row.active_generation);
  const rebuildingGeneration =
    row.rebuilding_generation === null
    || row.rebuilding_generation === undefined
      ? undefined
      : String(row.rebuilding_generation);
  const state = String(row.state);
  if (
    state !== 'current'
    && state !== 'lagging'
    && state !== 'rebuildRequired'
  ) {
    throw new Error(`Search index returned unknown durable state ${state}.`);
  }
  const lastAppliedAt =
    row.last_applied_recorded_at === null
    || row.last_applied_recorded_at === undefined
      ? undefined
      : Date.parse(String(row.last_applied_recorded_at));
  return {
    state: {
      logicalIndex: identity[0],
      indexRevision: identity[1],
      activeGeneration,
      checkpoint: databaseInteger(row.checkpoint, 'checkpoint'),
      state,
      retentionFloor: databaseInteger(
        row.retention_floor,
        'retention floor',
      ),
      ...(rebuildingGeneration ? { rebuildingGeneration } : {}),
      previousGenerations: parseStringArray(row.previous_generations),
    },
    sourceHighWatermark: databaseInteger(
      row.source_high_watermark,
      'source high watermark',
    ),
    ...(lastAppliedAt !== undefined && Number.isFinite(lastAppliedAt)
      ? { lastAppliedAt }
      : {}),
  };
}

async function replaceDocuments<TDocument extends object>(
  transaction: ApplicationPostgresTransactionSql,
  table: string,
  logicalIndex: string,
  indexRevision: string,
  generation: string,
  hydrated: readonly ApplicationSearchHydratedDocument<TDocument>[],
  fields: SearchFieldMap<TDocument>,
): Promise<void> {
  for (const candidate of hydrated) {
    if (!candidate.id) {
      throw new Error('Search hydration returned an empty document identity.');
    }
    if (candidate.document === null) {
      await transaction.unsafe(
        `DELETE FROM ${table}
        WHERE logical_index = $1
          AND index_revision = $2
          AND generation = $3
          AND document_id = $4`,
        [logicalIndex, indexRevision, generation, candidate.id],
      );
      continue;
    }
    await transaction.unsafe(
      `INSERT INTO ${table} (
        logical_index,
        index_revision,
        generation,
        document_id,
        document,
        source_projection_revision,
        search_text
      ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
      ON CONFLICT (
        logical_index,
        index_revision,
        generation,
        document_id
      ) DO UPDATE SET
        document = EXCLUDED.document,
        source_projection_revision = EXCLUDED.source_projection_revision,
        search_text = EXCLUDED.search_text,
        updated_at = now()`,
      [
        logicalIndex,
        indexRevision,
        generation,
        candidate.id,
        transaction.json(candidate.document),
        candidate.sourceProjectionRevision,
        searchDocumentText(candidate.document, fields),
      ],
    );
  }
}

function searchDocumentText<TDocument extends object>(
  document: TDocument,
  fields: SearchFieldMap<TDocument>,
): string {
  return (Object.entries(fields) as readonly [
    string,
    { readonly kind: string; readonly boost?: number },
  ][])
    .filter(([, field]) => field.kind === 'text')
    .flatMap(([name]) => {
      const value = Reflect.get(document, name);
      if (Array.isArray(value)) {
        return value.filter(
          (candidate): candidate is string =>
            typeof candidate === 'string',
        );
      }
      return typeof value === 'string' ? [value] : [];
    })
    .join('\n');
}

async function readValidation(
  sql: Pick<ApplicationPostgresSql, 'unsafe'>,
  table: string,
  logicalIndex: string,
  indexRevision: string,
  generation: string,
): Promise<ApplicationSearchRebuildValidation> {
  const parameters = [logicalIndex, indexRevision, generation] as const;
  const aggregateRows = await sql.unsafe(
    `SELECT count(*)::int AS count,
            coalesce(
              md5(
                string_agg(
                  document_id || ':' || document::text || ':' || source_projection_revision,
                  '|' ORDER BY document_id
                )
              ),
              md5('')
            ) AS checksum,
            bool_and(jsonb_typeof(document) = 'object') AS schema_compatible
    FROM ${table}
    WHERE logical_index = $1
      AND index_revision = $2
      AND generation = $3`,
    parameters,
  );
  const aggregate = requiredRow(aggregateRows, 'search rebuild validation');
  const sampleRows = await sql.unsafe(
    `SELECT document_id
    FROM ${table}
    WHERE logical_index = $1
      AND index_revision = $2
      AND generation = $3
    ORDER BY document_id
    LIMIT 10`,
    parameters,
  );
  return {
    count: databaseInteger(aggregate.count, 'validation count'),
    checksum: String(aggregate.checksum),
    sampleIdentities: sampleRows.map((row) =>
      String(Reflect.get(row, 'document_id')),
    ),
    authorizationCompatible: true,
    schemaCompatible:
      aggregate.schema_compatible === null
      || aggregate.schema_compatible === undefined
        ? true
        : Boolean(aggregate.schema_compatible),
  };
}

function appendIndexedWhere<TDocument extends object>(
  predicates: string[],
  parameters: unknown[],
  where: {
    readonly [TKey in keyof TDocument]?:
      ApplicationSearchComparison<TDocument[TKey]>;
  },
  encodeJson: (value: unknown) => string,
): void {
  for (const [field, comparison] of Object.entries(where)) {
    const equality = indexedEqualityValues(
      comparison as ApplicationSearchComparison<unknown>,
    );
    if (equality === undefined) continue;
    if (equality.length === 0) {
      predicates.push('FALSE');
      continue;
    }
    const alternatives = equality.map((value) => {
      parameters.push(field);
      const fieldParameter = parameters.length;
      parameters.push(encodeJson(normalizeJsonValue(value)));
      const valueParameter = parameters.length;
      return `document @> jsonb_build_object(
        $${fieldParameter}::text,
        $${valueParameter}::text::jsonb
      )`;
    });
    predicates.push(
      alternatives.length === 1
        ? alternatives[0] as string
        : `(${alternatives.join(' OR ')})`,
    );
  }
}

/** @internal Exported for provider-boundary regression coverage. */
export function postgresApplicationSearchFilterJsonText(
  value: unknown,
): string {
  const encoded = JSON.stringify(normalizeJsonValue(value));
  if (encoded === undefined) {
    throw new Error(
      'Search equality filters must contain JSON-serializable values.',
    );
  }
  return encoded;
}

function indexedEqualityValues(
  comparison: ApplicationSearchComparison<unknown>,
): readonly unknown[] | undefined {
  if (
    comparison === null
    || typeof comparison !== 'object'
    || Array.isArray(comparison)
    || comparison instanceof Date
  ) {
    return [comparison];
  }
  const operations = comparison as {
    readonly eq?: unknown;
    readonly in?: readonly unknown[];
  };
  if ('eq' in operations) return [operations.eq];
  if ('in' in operations) return operations.in ?? [];
  return undefined;
}

function normalizeJsonValue(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
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
  fields: SearchFieldMap<TDocument>,
): void {
  if (request.text !== undefined && !request.text.trim()) {
    throw new Error('Search text must not be empty when supplied.');
  }
  const where = request.where ?? {};
  for (const key of Object.keys(where)) {
    if (!(key in fields)) {
      throw new Error(`Search filter field ${key} is not indexed.`);
    }
    const kind = Reflect.get(fields, key)?.kind;
    if (
      !['filter', 'facet', 'minimum', 'maximum', 'count'].includes(kind)
    ) {
      throw new Error(`Search field ${key} is not filterable.`);
    }
  }
  for (const key of Object.keys(where)) {
    validateComparison(
      Reflect.get(where, key) as ApplicationSearchComparison<unknown>,
      key,
    );
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
    const supported = new Set(['eq', 'ne', 'in', 'lt', 'lte', 'gt', 'gte']);
    if (keys.length === 0 || keys.some((key) => !supported.has(key))) {
      throw new Error(
        `Search filter field ${field} has an empty or unsupported comparison.`,
      );
    }
  }
}

function validateAdmission<TDocument extends object>(
  admission: ApplicationSearchAdmissionScope<TDocument>,
  fields: SearchFieldMap<TDocument>,
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
  for (const [field, comparison] of Object.entries(admission.where)) {
    if (!(field in fields)) {
      throw new Error(
        `Search admission filter field ${field} is not indexed.`,
      );
    }
    const kind = Reflect.get(fields, field)?.kind;
    if (
      !['filter', 'facet', 'minimum', 'maximum', 'count'].includes(kind)
    ) {
      throw new Error(
        `Search field ${field} is not filterable for admission scope.`,
      );
    }
    validateComparison(
      comparison as ApplicationSearchComparison<unknown>,
      field,
    );
  }
}

function validateRuntimeFields<TDocument extends object>(
  fields: SearchFieldMap<TDocument>,
): void {
  for (
    const [name, field] of Object.entries(fields) as readonly [
      string,
      { readonly kind: string; readonly boost?: number },
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
  }
}

function scoreDocument<TDocument extends object>(
  document: TDocument,
  text: string | undefined,
  fields: SearchFieldMap<TDocument>,
): number {
  if (text === undefined) return 0;
  const terms = text.toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  return (Object.entries(fields) as readonly [
    string,
    { readonly kind: string; readonly boost?: number },
  ][])
    .filter(([, field]) => field.kind === 'text')
    .reduce((score, [name, field]) => {
      const value = Reflect.get(document, name);
      const values = Array.isArray(value)
        ? value.filter(
            (candidate): candidate is string =>
              typeof candidate === 'string',
          )
        : typeof value === 'string'
          ? [value]
          : [];
      const matches = values.reduce(
        (count, candidate) => {
          const normalized = candidate.toLocaleLowerCase();
          return count
            + terms.filter((term) => normalized.includes(term)).length;
        },
        0,
      );
      return score + matches * (field.boost ?? 1);
    }, 0);
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
    return Object.is(normalizeJsonValue(actual), normalizeJsonValue(comparison));
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
  if (
    'eq' in operations
    && !Object.is(
      normalizeJsonValue(actual),
      normalizeJsonValue(operations.eq),
    )
  ) return false;
  if (
    'ne' in operations
    && Object.is(
      normalizeJsonValue(actual),
      normalizeJsonValue(operations.ne),
    )
  ) return false;
  if (
    'in' in operations
    && operations.in
    && !operations.in.some((candidate) =>
      Object.is(
        normalizeJsonValue(actual),
        normalizeJsonValue(candidate),
      ),
    )
  ) return false;
  if ('lt' in operations && compareValues(actual, operations.lt) >= 0) {
    return false;
  }
  if ('lte' in operations && compareValues(actual, operations.lte) > 0) {
    return false;
  }
  if ('gt' in operations && compareValues(actual, operations.gt) <= 0) {
    return false;
  }
  if ('gte' in operations && compareValues(actual, operations.gte) < 0) {
    return false;
  }
  return true;
}

function compareSearchRows<TDocument extends object>(
  left: {
    readonly id: string;
    readonly document: TDocument;
    readonly score: number;
  },
  right: {
    readonly id: string;
    readonly document: TDocument;
    readonly score: number;
  },
  order: readonly {
    readonly field: string;
    readonly direction: 'asc' | 'desc';
  }[],
): number {
  if (order.length === 0 && left.score !== right.score) {
    return right.score - left.score;
  }
  for (const sort of order) {
    const comparison = compareValues(
      Reflect.get(left.document, sort.field),
      Reflect.get(right.document, sort.field),
    );
    if (comparison !== 0) {
      return sort.direction === 'asc' ? comparison : -comparison;
    }
  }
  return left.id.localeCompare(right.id);
}

function compareValues(left: unknown, right: unknown): number {
  const normalizedLeft = normalizeJsonValue(left);
  const normalizedRight = normalizeJsonValue(right);
  if (normalizedLeft === normalizedRight) return 0;
  if (normalizedLeft === null || normalizedLeft === undefined) return -1;
  if (normalizedRight === null || normalizedRight === undefined) return 1;
  return normalizedLeft < normalizedRight ? -1 : 1;
}

function facetBuckets<TDocument extends object>(
  documents: readonly TDocument[],
  field: string,
): readonly { readonly value: unknown; readonly count: number }[] {
  const counts = new Map<
    string,
    { readonly value: unknown; count: number }
  >();
  for (const document of documents) {
    const value = Reflect.get(document, field);
    const values = Array.isArray(value) ? value : [value];
    for (const candidate of values) {
      const key = applicationSearchDigest(candidate);
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

function parseDocument<TDocument extends object>(value: unknown): TDocument {
  const document =
    typeof value === 'string'
      ? JSON.parse(value) as unknown
      : value;
  if (
    !document
    || typeof document !== 'object'
    || Array.isArray(document)
  ) {
    throw new Error('PostgreSQL search document is not a JSON object.');
  }
  return document as TDocument;
}

function parseStringArray(value: unknown): string[] {
  const parsed =
    typeof value === 'string'
      ? JSON.parse(value) as unknown
      : value;
  if (
    !Array.isArray(parsed)
    || parsed.some((candidate) => typeof candidate !== 'string')
  ) {
    throw new Error(
      'PostgreSQL search previous generation state is malformed.',
    );
  }
  return [...parsed] as string[];
}

function requiredRow(
  rows: readonly Record<string, unknown>[],
  description: string,
): Record<string, unknown> {
  const row = rows[0];
  if (!row) throw new Error(`PostgreSQL ${description} is missing.`);
  return row;
}

function databaseInteger(value: unknown, name: string): number {
  const parsed =
    typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`PostgreSQL search ${name} is invalid.`);
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
      `Search ${name} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}

function assertStableIdentifier(value: string, name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) {
    throw new Error(
      `Search ${name} must be a stable non-empty identifier.`,
    );
  }
}

function postgresIdentifier(value: string, name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/u.test(value)) {
    throw new Error(
      `PostgreSQL search ${name} must be a lowercase SQL identifier.`,
    );
  }
  return value;
}

function postgresIndexName(schema: string, suffix: string): string {
  const digestSuffix = createHash('sha256')
    .update(`${schema}:${suffix}`)
    .digest('hex')
    .slice(0, 10);
  return `${suffix.slice(0, 50)}_${digestSuffix}`;
}

function qualified(schema: string, table: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
