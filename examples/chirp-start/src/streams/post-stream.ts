import { app } from '../domain-app';
import { Database } from '../providers/database';
import { PostPublished, PostTimelineChanged } from '../domain/events';

export const PublishedPosts = app.stream(PostPublished, {
  database: Database,
  retention: { maxAgeSeconds: 30 * 24 * 60 * 60, maxMessages: 10_000_000 },
  partitionBy: ({ authorId }) => authorId,
  authorize: ({ principal }) => principal.id.length > 0,
});

export const PostTimelineChanges = app.stream(PostTimelineChanged, {
  database: Database,
  retention: { maxAgeSeconds: 30 * 24 * 60 * 60, maxMessages: 25_000_000 },
  partitionBy: ({ authorId }) => authorId,
  authorize: ({ principal }) => principal.id.length > 0,
});
