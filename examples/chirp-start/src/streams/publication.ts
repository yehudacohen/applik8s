// typecast-file-boundary: typed stream payloads are narrowed at the event-schema boundary before projection materialization.
import type { ApplicationModelCreateEvent, ApplicationModelDeleteEvent, ApplicationModelUpdateEvent } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import { Post } from '../domain/post';
import { PublishedPosts } from './post-stream';

const postLifecycleProcessor = {
  processor: { replicas: 1, concurrency: 8 },
  retry: { maxAttempts: 3, initialDelayMs: 100, maxDelayMs: 2_000, deadLetter: true },
  budgets: { timeoutMs: 2_000, maxInputBytes: 16_000 },
} as const;

/**
 * Canonical non-HTTP handlers. Post.create/update/delete and their committed
 * lifecycle streams are derived directly from the promoted Drizzle table; no
 * `.actions({...})`, `$model`, or generic event name is involved.
 */
type PostRow = typeof Post.$inferSelect;

async function validatePublishedPost(created: ApplicationModelCreateEvent<PostRow>) {
  if (created.identity !== created.value.id || !created.value.authorId || created.value.body.length < 1 || created.value.body.length > 280) {
    throw new Error('Committed Post creation violates the bounded publication contract.');
  }
}

async function validateUpdatedPost(updated: ApplicationModelUpdateEvent<PostRow>) {
  if (updated.identity !== updated.current.id || updated.previous.id !== updated.current.id) {
    throw new Error('Committed Post update changed authoritative identity.');
  }
}

async function validateDeletedPost(deleted: ApplicationModelDeleteEvent<PostRow>) {
  if (deleted.identity !== deleted.previous.id || deleted.tombstone.identity !== deleted.identity || !deleted.tombstone.deleted) {
    throw new Error('Committed Post deletion produced an invalid tombstone.');
  }
}

export const PostPublicationLifecycle = Post.on.create(postLifecycleProcessor, validatePublishedPost);
export const PostUpdateLifecycle = Post.on.update(postLifecycleProcessor, validateUpdatedPost);
export const PostDeletionLifecycle = Post.on.delete(postLifecycleProcessor, validateDeletedPost);

export const PostAnalytics = PublishedPosts.project(
  type({ eventId: 'string', hour: 'string', authorId: 'string', accountKind: "'unknown'", posts: 'number' }),
  function postAnalyticsHourly(event, output) {
    return output.append({
      eventId: output.sourceId,
      hour: event.publishedAt.slice(0, 13),
      authorId: event.authorId,
      accountKind: 'unknown',
      posts: 1,
    });
  },
);
