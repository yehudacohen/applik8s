// typecast-file-boundary: typed stream payloads are narrowed at the event-schema boundary before projection materialization.
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
export const PostPublicationLifecycle = Post.on.create('publish-created-post', postLifecycleProcessor, async (created) => {
  if (created.identity !== created.value.id || !created.value.authorId || created.value.body.length < 1 || created.value.body.length > 280) {
    throw new Error('Committed Post creation violates the bounded publication contract.');
  }
});

export const PostUpdateLifecycle = Post.on.update('project-updated-post', postLifecycleProcessor, async (updated) => {
  if (updated.identity !== updated.current.id || updated.previous.id !== updated.current.id) {
    throw new Error('Committed Post update changed authoritative identity.');
  }
});

export const PostDeletionLifecycle = Post.on.delete('retire-deleted-post', postLifecycleProcessor, async (deleted) => {
  if (deleted.identity !== deleted.previous.id || deleted.tombstone.identity !== deleted.identity || !deleted.tombstone.deleted) {
    throw new Error('Committed Post deletion produced an invalid tombstone.');
  }
});

export const PostAnalytics = PublishedPosts.project('post-analytics-hourly', {
  output: type({ eventId: 'string', hour: 'string', authorId: 'string', accountKind: "'unknown'", posts: 'number' }),
  project: (payload, source) => ({
    eventId: source.id,
    hour: payload.publishedAt.slice(0, 13),
    authorId: payload.authorId,
    accountKind: 'unknown' as const,
    posts: 1,
  }),
});
