import { type } from '@applik8s/applik8s/dsl';
import { app } from '../app';
import { Database } from '../providers/database';
import { FollowChanged, ReactionChanged } from '../domain/events';

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

export const FollowAnalytics = FollowChanges.project('follow-analytics-hourly', {
  output: type({ eventId: 'string', hour: 'string', followerId: 'string', followeeId: 'string', delta: 'number' }),
  project: (payload, source) => ({
    eventId: source.id, hour: payload.changedAt.slice(0, 13), followerId: payload.followerId,
    followeeId: payload.followeeId, delta: payload.state === 'active' ? 1 : -1,
  }),
});

export const ReactionAnalytics = ReactionChanges.project('reaction-analytics-hourly', {
  output: type({ eventId: 'string', hour: 'string', postId: 'string', kind: 'string', delta: 'number' }),
  project: (payload, source) => ({
    eventId: source.id, hour: payload.changedAt.slice(0, 13), postId: payload.postId,
    kind: payload.kind, delta: payload.state === 'active' ? 1 : -1,
  }),
});
