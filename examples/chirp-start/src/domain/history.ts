import type { ApplicationLakehouseRowExpression } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import { app } from '../domain-app';
import {
  historicalEngagementDataset,
  historicalEngagementQueries,
} from '../providers';
import {
  HistoricalEngagementRow,
} from '../streams/engagement';
import { Database } from '../providers/database';
import { Reaction } from './social';

type HistoricalEngagementValue = typeof HistoricalEngagementRow.infer;

/**
 * Provider-neutral historical query used by the product and acceptance
 * journeys. DuckDB and Athena preserve the same snapshot, cursor, cancellation,
 * and scan-evidence contract behind this ordinary application query.
 */
export const HistoricalEngagement = app.query('engagement.history.v1', {
  input: type({ 'postId?': 'string', 'cursor?': 'string' }),
  output: type({
    snapshot: 'string',
    schemaRevision: 'string',
    rows: HistoricalEngagementRow.array(),
    'cursor?': 'string',
    scannedBytes: 'number.integer >= 0',
  }),
  database: Database,
  reads: [Reaction],
  authorize: ({ principal }) => principal.id.length > 0,
  budgets: { maxRows: 100, maxResultBytes: 512_000, timeoutMs: 15_000 },
  run: async ({ input }) => {
    const postId = input.postId;
    const result = await historicalEngagementQueries.query({
      dataset: historicalEngagementDataset,
      ...(postId
        ? {
            where: (row: ApplicationLakehouseRowExpression<HistoricalEngagementValue>) =>
              row.postId.eq(postId),
          }
        : {}),
      orderBy: (row: ApplicationLakehouseRowExpression<HistoricalEngagementValue>) => [
        row.changedAt.desc(),
        row.reactionId.asc(),
      ],
      page: { size: 100, ...(input.cursor ? { cursor: input.cursor } : {}) },
      timeout: '10s',
    });
    return {
      snapshot: result.snapshot,
      schemaRevision: result.schemaRevision,
      rows: result.rows,
      ...(result.cursor ? { cursor: result.cursor } : {}),
      scannedBytes: result.scannedBytes,
    };
  },
});
