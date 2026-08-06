import { TimelinePost } from '../domain/timeline-contract';
import { PostBase } from '../domain/post-model';
import { PostTimelineChanges } from './post-stream';

/**
 * Generation-scoped online authority. Author partitions let an ordinary home
 * view perform a bounded merge of the viewer and followed authors without
 * coupling application code to Valkey.
 */
export const HomeTimeline = PostTimelineChanges.project(
  TimelinePost,
  function homeTimeline(event, output) {
    if (event.operation === 'remove') {
      return output.remove({
        partition: event.authorId,
        key: event.postId,
      });
    }
    return output.upsert({
      partition: event.authorId,
      key: event.postId,
      score: Date.parse(event.publishedAt),
      value: {
        id: event.postId,
        authorId: event.authorId,
        authorHandle: event.authorHandle,
        body: event.body,
        publishedAt: event.publishedAt,
        visibility: event.visibility,
        replyToPostId: event.replyToPostId,
        quotePostId: event.quotePostId,
      },
    });
  },
)
  .rebuildFrom(PostBase, (post, rebuild) =>
    post.publicationState === 'published'
    && post.moderationState === 'visible'
    && post.deletedAt === null
      ? rebuild.source({
          operation: 'upsert',
          postId: post.id,
          authorId: post.authorId,
          authorHandle: post.authorHandle,
          body: post.body,
          publishedAt: post.publishedAt,
          visibility: post.visibility,
          replyToPostId: post.replyToPostId,
          quotePostId: post.quotePostId,
        })
      : rebuild.skip(),
  )
  .retain({
    maxItemsPerPartition: 2_000,
    maxPartitions: 100_000,
    maxAge: '30d',
  });
