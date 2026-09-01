import { type } from '@applik8s/applik8s/dsl';
import { app } from '../domain-app';
import { Database } from '../providers/database';
import { recordEngagementBatch } from '../domain/engagement';
import { FollowChanged, ReactionChanged } from '../domain/events';
import { historicalEngagementDataset } from '../providers';

export const FollowChanges = app.stream(FollowChanged, {
  database: Database,
  retention: { maxAgeSeconds: 30 * 24 * 60 * 60, maxMessages: 10_000_000 },
  partitionBy: ({ followerId }) => followerId,
  authorize: ({ principal }) => principal.id.length > 0,
});

export const ReactionChanges = app.stream(ReactionChanged, {
  database: Database,
  retention: { maxAgeSeconds: 30 * 24 * 60 * 60, maxMessages: 25_000_000 },
  partitionBy: ({ postId }) => postId,
  authorize: ({ principal }) => principal.id.length > 0,
});

export const FollowAnalytics = FollowChanges.project(
  type({ eventId: 'string', hour: 'string', followerId: 'string', followeeId: 'string', delta: 'number' }),
  function followAnalyticsHourly(event, output) {
    return output.append({
      eventId: output.sourceId,
      hour: event.changedAt.slice(0, 13),
      followerId: event.followerId,
      followeeId: event.followeeId,
      delta: event.state === 'active' ? 1 : -1,
    });
  },
);

export const ReactionAnalytics = ReactionChanges.project(
  type({ eventId: 'string', hour: 'string', changedAtEpoch: 'number', postId: 'string', kind: 'string', delta: 'number' }),
  function reactionAnalyticsHourly(event, output) {
    return output.append({
      eventId: output.sourceId,
      hour: event.changedAt.slice(0, 13),
      changedAtEpoch: Date.parse(event.changedAt),
      postId: event.postId,
      kind: event.kind,
      delta: event.state === 'active' ? 1 : -1,
    });
  },
);

export const HistoricalEngagementRow = type({
  reactionId: 'string',
  accountId: 'string',
  postId: 'string',
  kind: "'like' | 'repost'",
  state: "'active' | 'deleted'",
  changedAt: 'string',
});

/**
 * Immutable product history. The same declaration publishes to DuckDB for
 * local development and S3/Glue for AWS or hybrid Kubernetes profiles.
 * ClickHouse remains the rebuildable operational aggregate, so the two stores
 * have distinct, honest lifecycle authority.
 */
export const HistoricalEngagementPublication = ReactionChanged.publish(
  historicalEngagementDataset,
  HistoricalEngagementRow,
  function appendHistoricalEngagement(event, output) {
    return output.append(event);
  },
).partitionBy((row) => ({
  postId: row.postId,
  month: row.changedAt.slice(0, 7),
}));

/**
 * The flagship batch path freezes exact per-post membership before invoking
 * one durable bulk operation. A retry receives the same batch id and the
 * receipt model makes the effect idempotent and inspectable.
 */
export const ReactionBatchReceipts = ReactionChanges.onBatch(
  {
    batch: { maxItems: 100, maxBytes: '256KiB', maxWait: '1s' },
    ordering: 'partition',
    concurrency: 4,
    acknowledgement: 'wholeBatch',
  },
  async function persistEngagementBatch(batch) {
    const netDelta = batch.events.reduce(
      (sum, event) => sum + (event.value.state === 'active' ? 1 : -1),
      0,
    );
    await recordEngagementBatch({
      id: batch.id,
      partitionKey: batch.partition ?? batch.events[0]?.partitionKey ?? '',
      firstSequence: batch.firstSequence,
      lastSequence: batch.lastSequence,
      eventCount: String(batch.events.length),
      netDelta: String(netDelta),
    });
  },
);
