// typecast-file-boundary: PostgreSQL JSONB snapshot rows enter the typed query
// batch protocol only after the scan identity and stored row shape are checked.
import { createHash } from 'node:crypto';
import {
  type ApplicationQueryBatchFrontierReference,
  type ApplicationQueryBatchPreparedScan,
  type ApplicationQueryBatchRuntime,
  type ApplicationQueryBatchWindow,
  type ApplicationQueryBatchWindowRead,
  applicationQueryBatchProtocol,
} from '@applik8s/applik8s/query-batch-runtime';
import { canonicalJsonV1String, type JsonValue } from '@applik8s/core';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import postgres, { type Sql, type TransactionSql } from 'postgres';
import { materializePostgresApplicationQuerySelection } from './query-selection.js';

export interface PostgresApplicationQueryBatchRuntimeOptions {
  readonly databaseUrl: string;
  readonly applicationId: string;
  readonly deploymentId: string;
  /** Framework capacity guard applied before a prepared scan is published. */
  readonly maximumSnapshotItems?: number;
  readonly snapshotRetentionSeconds?: number;
  readonly maximumConnections?: number;
  readonly access?: {
    readonly context: string;
    readonly setting: string;
  };
}

export interface PostgresApplicationQueryBatchRuntime extends ApplicationQueryBatchRuntime {
  close(): Promise<void>;
}

interface ScanRow {
  readonly scan_id: string;
  readonly selection_digest: string;
  readonly consistency_revision: string;
  readonly admission_digest: string;
  readonly active_fence: string;
  readonly batch_size: number;
  readonly item_count: number;
  readonly terminal_ordinal: number;
  readonly committed_ordinal: number;
  readonly expires_at: Date | string;
}

/**
 * Durable PostgreSQL repeatable-snapshot provider.
 *
 * Selection and snapshot publication happen in one transaction in the source
 * database. Workers subsequently read immutable JSONB rows, so restart never
 * depends on an exported transaction or process-local cursor.
 */
export function createPostgresApplicationQueryBatchRuntime(
  options: PostgresApplicationQueryBatchRuntimeOptions,
): PostgresApplicationQueryBatchRuntime {
  const databaseUrl = nonEmpty(options.databaseUrl, 'PostgreSQL query-batch databaseUrl');
  const applicationId = nonEmpty(options.applicationId, 'PostgreSQL query-batch applicationId');
  const deploymentId = nonEmpty(options.deploymentId, 'PostgreSQL query-batch deploymentId');
  const maximumSnapshotItems = positiveInteger(
    options.maximumSnapshotItems ?? 100_000,
    'PostgreSQL query-batch maximumSnapshotItems',
  );
  const snapshotRetentionSeconds = positiveInteger(
    options.snapshotRetentionSeconds ?? 86_400,
    'PostgreSQL query-batch snapshotRetentionSeconds',
  );
  const sql = postgres(databaseUrl, {
    max: positiveInteger(options.maximumConnections ?? 4, 'PostgreSQL query-batch maximumConnections'),
  });
  let initialized: Promise<void> | undefined;
  const ensure = () => (initialized ??= ensureQueryBatchStore(sql));

  return {
    capabilities: {
      repeatableSnapshot: true,
      versionPinned: false,
      monotonicFrontier: false,
      bestEffort: false,
      stableKeyset: true,
      resumableFrontier: true,
      durableWindowReceipts: true,
      concurrentWindows: true,
      maximumSnapshotAge: `${snapshotRetentionSeconds}s`,
    },
    async prepare(request) {
      await ensure();
      if (request.consistency.mode !== 'repeatableSnapshot') {
        throw new Error(
          `PostgreSQL query-batch provider cannot lower ${request.consistency.mode}; use repeatableSnapshot until a qualified native revision strategy is bound.`,
        );
      }
      return sql.begin(async (transaction) => {
        const admissionDigest = digest({
          selection: request.selection.digest,
          input: request.input,
          authorityRevision: request.authorityRevision,
          trustedContext: request.trustedContext,
        });
        await transaction.unsafe('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [
          `${applicationId}:${deploymentId}`,
          `${request.runId}:${request.selection.digest}`,
        ]);
        const existing = await readScan(transaction, applicationId, deploymentId, request.runId, request.selection.digest);
        if (existing) {
          if (existing.admission_digest !== admissionDigest) {
            throw new Error(`QUERY_BATCH_ADMISSION_CONFLICT: scan ${existing.scan_id} was prepared under another authority context.`);
          }
          if (existing.batch_size !== request.batchSize) {
            throw new Error(`Query batch scan ${existing.scan_id} cannot change batch size after preparation.`);
          }
          assertScanAlive(existing);
          const resumed = await transaction<ScanRow[]>`
            UPDATE applik8s_query_batch_scans
            SET active_fence = ${request.executionFence}, updated_at = now()
            WHERE scan_id = ${existing.scan_id}
            RETURNING ${transaction.unsafe(scanColumns)}
          `;
          return preparedScan(resumed[0] ?? existing);
        }
        await installTrustedContext(transaction, options.access, request.trustedContext);
        const rows = await materializePostgresApplicationQuerySelection<object>({
          selection: request.selection,
          input: request.input,
          database: transactionSelectionDatabase(transaction),
          maximumRows: maximumSnapshotItems + 1,
        });
        if (rows.length > maximumSnapshotItems) {
          throw new Error(
            `QUERY_BATCH_SNAPSHOT_CAPACITY: selection ${request.selection.digest} exceeds ${maximumSnapshotItems} items.`,
          );
        }
        const consistencyRevision = digest({
          selection: request.selection.digest,
          input: request.input,
          authorityRevision: request.authorityRevision,
          rows,
        });
        const scanId = digest({
          applicationId,
          deploymentId,
          runId: request.runId,
          selection: request.selection.digest,
          consistencyRevision,
        });
        const terminalOrdinal = Math.max(0, Math.ceil(rows.length / request.batchSize) - 1);
        const inserted = await transaction<ScanRow[]>`
          INSERT INTO applik8s_query_batch_scans (
            application_id, deployment_id, run_id, selection_digest, scan_id,
            consistency_mode, consistency_revision, admission_digest, batch_size, item_count,
            terminal_ordinal, committed_ordinal, active_fence, expires_at
          ) VALUES (
            ${applicationId}, ${deploymentId}, ${request.runId}, ${request.selection.digest},
            ${scanId}, 'repeatableSnapshot', ${consistencyRevision}, ${admissionDigest}, ${request.batchSize},
            ${rows.length}, ${terminalOrdinal}, -1, ${request.executionFence},
            now() + (${snapshotRetentionSeconds} * interval '1 second')
          )
          RETURNING ${transaction.unsafe(scanColumns)}
        `;
        if (rows.length > 0) {
          const values = rows.map((value, index) => ({
            scan_id: scanId,
            item_index: index,
            window_ordinal: Math.floor(index / request.batchSize),
            value: transaction.json(jsonValue(value)),
          }));
          await transaction`
            INSERT INTO applik8s_query_batch_items ${transaction(values, 'scan_id', 'item_index', 'window_ordinal', 'value')}
          `;
        }
        const row = inserted[0];
        if (!row) throw new Error('PostgreSQL did not publish the prepared query-batch scan.');
        return preparedScan(row);
      });
    },
    async readWindow<TItem extends object>(request: {
      readonly scan: ApplicationQueryBatchPreparedScan;
      readonly after?: ApplicationQueryBatchFrontierReference;
      readonly maximumItems: number;
      readonly signal: AbortSignal;
    }): Promise<ApplicationQueryBatchWindowRead<TItem>> {
      await ensure();
      if (request.signal.aborted) throw request.signal.reason ?? new Error('QUERY_BATCH_CANCELLED');
      const scan = await requiredScan(sql, request.scan);
      assertScanAlive(scan);
      if (request.maximumItems !== scan.batch_size) {
        throw new Error(`Query batch scan ${scan.scan_id} requires its prepared batch size ${scan.batch_size}.`);
      }
      const ordinal = (request.after?.ordinal ?? -1) + 1;
      if (ordinal > scan.terminal_ordinal) {
        throw new Error(`Query batch scan ${scan.scan_id} attempted to read beyond its terminal frontier.`);
      }
      const rows = await sql<{ readonly value: TItem }[]>`
        SELECT value
        FROM applik8s_query_batch_items
        WHERE scan_id = ${scan.scan_id} AND window_ordinal = ${ordinal}
        ORDER BY item_index
        LIMIT ${request.maximumItems}
      `;
      const window = queryBatchWindow(scan, ordinal, request.after);
      const receipts = await sql<{ readonly outcome: string }[]>`
        SELECT outcome FROM applik8s_query_batch_receipts
        WHERE scan_id = ${scan.scan_id} AND window_ordinal = ${ordinal}
      `;
      const terminal = ordinal === scan.terminal_ordinal;
      return {
        items: Object.freeze(rows.map((row) => Object.freeze(row.value))) as readonly TItem[],
        window,
        ...(terminal ? {} : { next: window.upper }),
        terminal,
        ...(receipts[0]?.outcome === 'succeeded' ? { receipt: 'succeeded' as const } : {}),
      };
    },
    async completeWindow(request) {
      await ensure();
      return sql.begin(async (transaction) => {
        const scan = await requiredScan(transaction, request.scan, true);
        assertScanAlive(scan);
        if (
          request.window.scanId !== scan.scan_id
          || request.window.ordinal < 0
          || request.window.ordinal > scan.terminal_ordinal
          || request.window.upper.digest !== frontier(scan, request.window.ordinal).digest
        ) {
          throw new Error(`Query batch window ${request.window.id} does not belong to scan ${scan.scan_id}.`);
        }
        const receipts = await transaction<{ readonly window_id: string }[]>`
          INSERT INTO applik8s_query_batch_receipts (scan_id, window_ordinal, window_id, outcome, completed_at)
          VALUES (${scan.scan_id}, ${request.window.ordinal}, ${request.window.id}, ${request.outcome}, now())
          ON CONFLICT (scan_id, window_ordinal) DO UPDATE
          SET outcome = CASE
                WHEN applik8s_query_batch_receipts.outcome = 'succeeded' THEN 'succeeded'
                ELSE EXCLUDED.outcome
              END,
              completed_at = EXCLUDED.completed_at
          WHERE applik8s_query_batch_receipts.window_id = EXCLUDED.window_id
          RETURNING window_id
        `;
        if (!receipts[0]) {
          throw new Error(`Query batch window ordinal ${request.window.ordinal} conflicts with another durable window identity.`);
        }
        const succeeded = await transaction<{ readonly window_ordinal: number }[]>`
          SELECT window_ordinal FROM applik8s_query_batch_receipts
          WHERE scan_id = ${scan.scan_id} AND outcome = 'succeeded'
          ORDER BY window_ordinal
        `;
        let committed = -1;
        for (const receipt of succeeded) {
          if (Number(receipt.window_ordinal) !== committed + 1) break;
          committed += 1;
        }
        await transaction`
          UPDATE applik8s_query_batch_scans
          SET committed_ordinal = ${committed}, updated_at = now()
          WHERE scan_id = ${scan.scan_id}
        `;
        return committed >= 0 ? { committedFrontier: frontier(scan, committed) } : {};
      });
    },
    async release(request) {
      await ensure();
      const status = request.terminal === 'succeeded' ? 'succeeded' : 'active';
      const rows = await sql<{ readonly scan_id: string }[]>`
        UPDATE applik8s_query_batch_scans
        SET status = ${status}, updated_at = now()
        WHERE scan_id = ${request.scan.scanId}
          AND selection_digest = ${request.scan.selectionDigest}
          AND active_fence = ${request.scan.executionFence}
        RETURNING scan_id
      `;
      if (!rows[0]) {
        throw new Error(`QUERY_BATCH_FENCE_LOST: scan ${request.scan.scanId} belongs to a newer Job attempt.`);
      }
    },
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}

const scanColumns = `
  scan_id, selection_digest, consistency_revision, batch_size, item_count,
  terminal_ordinal, committed_ordinal, active_fence, admission_digest, expires_at
`;

async function ensureQueryBatchStore(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS applik8s_query_batch_scans (
      application_id text NOT NULL,
      deployment_id text NOT NULL,
      run_id text NOT NULL,
      selection_digest text NOT NULL,
      scan_id text PRIMARY KEY,
      consistency_mode text NOT NULL CHECK (consistency_mode = 'repeatableSnapshot'),
      consistency_revision text NOT NULL,
      admission_digest text NOT NULL,
      batch_size integer NOT NULL CHECK (batch_size > 0),
      item_count integer NOT NULL CHECK (item_count >= 0),
      terminal_ordinal integer NOT NULL CHECK (terminal_ordinal >= 0),
      committed_ordinal integer NOT NULL DEFAULT -1 CHECK (committed_ordinal >= -1),
      active_fence text NOT NULL,
      status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'succeeded')),
      expires_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (application_id, deployment_id, run_id, selection_digest)
    )
  `;
  await sql`ALTER TABLE applik8s_query_batch_scans ADD COLUMN IF NOT EXISTS active_fence text`;
  await sql`ALTER TABLE applik8s_query_batch_scans ADD COLUMN IF NOT EXISTS admission_digest text`;
  await sql`UPDATE applik8s_query_batch_scans SET active_fence = 'legacy-unfenced' WHERE active_fence IS NULL`;
  await sql`UPDATE applik8s_query_batch_scans SET admission_digest = 'legacy-unverified' WHERE admission_digest IS NULL`;
  await sql`ALTER TABLE applik8s_query_batch_scans ALTER COLUMN active_fence SET NOT NULL`;
  await sql`ALTER TABLE applik8s_query_batch_scans ALTER COLUMN admission_digest SET NOT NULL`;
  await sql`
    CREATE TABLE IF NOT EXISTS applik8s_query_batch_items (
      scan_id text NOT NULL REFERENCES applik8s_query_batch_scans(scan_id) ON DELETE CASCADE,
      item_index integer NOT NULL CHECK (item_index >= 0),
      window_ordinal integer NOT NULL CHECK (window_ordinal >= 0),
      value jsonb NOT NULL,
      PRIMARY KEY (scan_id, item_index)
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS applik8s_query_batch_items_window
    ON applik8s_query_batch_items (scan_id, window_ordinal, item_index)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS applik8s_query_batch_receipts (
      scan_id text NOT NULL REFERENCES applik8s_query_batch_scans(scan_id) ON DELETE CASCADE,
      window_ordinal integer NOT NULL CHECK (window_ordinal >= 0),
      window_id text NOT NULL,
      outcome text NOT NULL CHECK (outcome IN ('succeeded', 'failed')),
      completed_at timestamptz NOT NULL,
      PRIMARY KEY (scan_id, window_ordinal)
    )
  `;
  await sql`DELETE FROM applik8s_query_batch_scans WHERE expires_at <= now()`;
}

async function installTrustedContext(
  transaction: TransactionSql,
  access: PostgresApplicationQueryBatchRuntimeOptions['access'],
  trustedContext: Readonly<Record<string, JsonValue>>,
): Promise<void> {
  if (!access) return;
  const value = trustedContext[access.context];
  if (value === undefined) {
    throw new Error(`PostgreSQL query-batch trusted context ${access.context} is required.`);
  }
  await transaction.unsafe('SELECT set_config($1, $2, true)', [
    access.setting,
    typeof value === 'string' ? value : canonicalJsonV1String(value),
  ]);
}

function transactionSelectionDatabase(transaction: TransactionSql): {
  execute(statement: SQL): Promise<unknown>;
} {
  const dialect = new PgDialect();
  return {
    execute(statement) {
      const query = dialect.sqlToQuery(statement);
      // Adapter-owned boundary: Drizzle has already parameterized every
      // application value; postgres-js accepts that concrete parameter list.
      return transaction.unsafe(query.sql, query.params as never[]);
    },
  };
}

async function readScan(
  executor: Sql | TransactionSql,
  applicationId: string,
  deploymentId: string,
  runId: string,
  selectionDigest: string,
): Promise<ScanRow | undefined> {
  const rows = await executor<ScanRow[]>`
    SELECT ${executor.unsafe(scanColumns)}
    FROM applik8s_query_batch_scans
    WHERE application_id = ${applicationId}
      AND deployment_id = ${deploymentId}
      AND run_id = ${runId}
      AND selection_digest = ${selectionDigest}
  `;
  return rows[0];
}

async function requiredScan(
  executor: Sql | TransactionSql,
  expected: ApplicationQueryBatchPreparedScan,
  lock = false,
): Promise<ScanRow> {
  const rows = await executor<ScanRow[]>`
    SELECT ${executor.unsafe(scanColumns)}
    FROM applik8s_query_batch_scans
    WHERE scan_id = ${expected.scanId} AND selection_digest = ${expected.selectionDigest}
    ${lock ? executor.unsafe('FOR UPDATE') : executor.unsafe('')}
  `;
  const row = rows[0];
  if (!row) throw new Error(`Unknown or mismatched query batch scan ${expected.scanId}.`);
  if (row.active_fence !== expected.executionFence) {
    throw new Error(`QUERY_BATCH_FENCE_LOST: scan ${expected.scanId} belongs to a newer Job attempt.`);
  }
  return row;
}

function preparedScan(row: ScanRow): ApplicationQueryBatchPreparedScan {
  return {
    protocol: applicationQueryBatchProtocol,
    scanId: row.scan_id,
    selectionDigest: row.selection_digest,
    consistencyRevision: row.consistency_revision,
    executionFence: row.active_fence,
    terminalBound: frontier(row, row.terminal_ordinal),
    committedItems: row.committed_ordinal < 0
      ? 0
      : Math.min(row.item_count, (row.committed_ordinal + 1) * row.batch_size),
    committedWindows: row.committed_ordinal + 1,
    ...(row.committed_ordinal >= 0 ? { firstFrontier: frontier(row, row.committed_ordinal) } : {}),
    expiresAt: iso(row.expires_at),
  };
}

function queryBatchWindow(
  row: ScanRow,
  ordinal: number,
  lower: ApplicationQueryBatchFrontierReference | undefined,
): ApplicationQueryBatchWindow {
  const upper = frontier(row, ordinal);
  return {
    protocol: applicationQueryBatchProtocol,
    scanId: row.scan_id,
    ordinal,
    id: digest({ scanId: row.scan_id, ordinal, ...(lower ? { lower: lower.digest } : {}), upper: upper.digest }),
    ...(lower ? { lower } : {}),
    upper,
    consistencyRevision: row.consistency_revision,
  };
}

function frontier(row: Pick<ScanRow, 'scan_id' | 'consistency_revision'>, ordinal: number): ApplicationQueryBatchFrontierReference {
  return {
    protocol: applicationQueryBatchProtocol,
    scanId: row.scan_id,
    ordinal,
    digest: digest({ scanId: row.scan_id, ordinal, revision: row.consistency_revision }),
  };
}

function assertScanAlive(row: ScanRow): void {
  if (Date.parse(iso(row.expires_at)) <= Date.now()) {
    throw new Error(`QUERY_BATCH_FRONTIER_EXPIRED: scan ${row.scan_id} expired at ${iso(row.expires_at)}.`);
  }
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJsonV1String(value)).digest('hex');
}

function jsonValue(value: unknown): JsonValue {
  // Canonical JSON is also the validation boundary for snapshot payloads.
  return JSON.parse(canonicalJsonV1String(value)) as JsonValue;
}

function iso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error('PostgreSQL query-batch timestamp is invalid.');
  return date.toISOString();
}

function nonEmpty(value: string, label: string): string {
  if (!value.trim()) throw new TypeError(`${label} must be non-empty.`);
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} must be a positive safe integer.`);
  return value;
}
