import { type } from '@applik8s/applik8s/dsl';

/** Public value returned by relational and online timeline/query authorities. */
export const TimelinePost = type({
  id: 'string', authorId: 'string', authorHandle: 'string', body: 'string', publishedAt: 'string',
  visibility: 'string', replyToPostId: 'string | null', quotePostId: 'string | null',
  'authorKind?': "'human' | 'automation'",
  'likeCount?': 'number.integer >= 0', 'repostCount?': 'number.integer >= 0',
  'viewerLiked?': 'boolean', 'viewerReposted?': 'boolean', 'viewerBookmarked?': 'boolean',
  'viewerLikeId?': 'string', 'viewerRepostId?': 'string', 'viewerBookmarkId?': 'string',
});
export type TimelinePost = typeof TimelinePost.infer;
