// typecast-file-boundary: Projection events are schema-validated before their typed timeline payload conversion.
import { IndexStore } from '@applik8s/applik8s';
import { TimelinePost } from '../domain/timeline-contract';
import { PostBase } from '../domain/post-model';
import { PostTimelineChanges } from './post-stream';

/**
 * Generation-scoped online authority. Author partitions let an ordinary home
 * view perform a bounded merge of the viewer and followed authors without
 * coupling application code to Valkey.
 */
export const HomeTimeline = PostTimelineChanges.project('home-timeline', {
  store: IndexStore,
  output: TimelinePost,
  map: (event) => event,
  partitionBy: ({ authorId }) => authorId,
  key: ({ postId }) => postId,
  score: ({ publishedAt }) => Date.parse(publishedAt),
  scoreUnit: 'epochMilliseconds',
  value: (entry) => ({
    id: entry.postId,
    authorId: entry.authorId,
    authorHandle: entry.authorHandle,
    body: entry.body,
    publishedAt: entry.publishedAt,
    visibility: entry.visibility,
    replyToPostId: entry.replyToPostId,
    quotePostId: entry.quotePostId,
  }),
  removeWhen: ({ operation }) => operation === 'remove',
  retention: { maxItemsPerPartition: 2_000, maxPartitions: 100_000, maxAgeSeconds: 30 * 24 * 60 * 60 },
  generationScoped: true,
  rebuild: {
    source: PostBase,
    checkpoint: 'durable',
    map: (post) => post.publicationState === 'published' && post.moderationState === 'visible' && post.deletedAt === null
      ? [{
        operation: 'upsert' as const,
        postId: post.id,
        authorId: post.authorId,
        authorHandle: post.authorHandle,
        body: post.body,
        publishedAt: post.publishedAt,
        visibility: post.visibility,
        replyToPostId: post.replyToPostId,
        quotePostId: post.quotePostId,
      }]
      : [],
  },
});
