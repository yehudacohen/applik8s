// typecast-file-boundary: validated Drizzle lifecycle snapshots are re-exposed as their declared row shapes for post invariants and projections.

import type {
  ApplicationDatabaseClient,
  ApplicationOnlineQuerySource,
  ApplicationRelationalContext,
} from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import { and, count, desc, eq, exists, ilike, inArray, notExists, or } from 'drizzle-orm';
import { accounts } from '../schema/accounts';
import type { chirpSchema } from '../schema/index';
import { blocks, bookmarks, follows, mutes, reactions } from '../schema/social';
import { Account } from './accounts';
import { Automation } from './automation';
import { Database } from '../providers/database';
import { PostDeleted, PostModerationChanged, PostPublished, PostTimelineChanged } from './events';
import { Block, Follow, Mute } from './relationships';
import { BookmarkModel, ReactionModel } from './social-models';
import { TimelinePost, type TimelinePost as TimelinePostValue } from './timeline-contract';
import { PostBase } from './post-model';
import { ReactionAnalytics } from '../streams/engagement';
import { HomeTimeline } from '../streams/timeline';

function readablePostWhere(database: ApplicationDatabaseClient<typeof chirpSchema>, viewerId: string) {
  const followsAuthor = database
    .select({ id: follows.id })
    .from(follows)
    .where(
      and(eq(follows.followerId, viewerId), eq(follows.followeeId, PostBase.authorId), eq(follows.state, 'active')),
    );
  const eitherDirectionBlocked = database
    .select({ id: blocks.id })
    .from(blocks)
    .where(
      and(
        eq(blocks.state, 'active'),
        or(
          and(eq(blocks.blockerId, viewerId), eq(blocks.blockedId, PostBase.authorId)),
          and(eq(blocks.blockerId, PostBase.authorId), eq(blocks.blockedId, viewerId)),
        ),
      ),
    );
  return and(
    eq(PostBase.publicationState, 'published'),
    eq(PostBase.moderationState, 'visible'),
    or(
      eq(PostBase.visibility, 'public'),
      eq(PostBase.authorId, viewerId),
      and(eq(PostBase.visibility, 'followers'), exists(followsAuthor)),
    ),
    notExists(eitherDirectionBlocked),
  );
}

async function homeTimeline(
  input: { readonly limit?: number },
  context: ApplicationRelationalContext & {
    readonly principal: { readonly id: string };
    readonly source: ApplicationOnlineQuerySource<TimelinePostValue>;
  },
) {
  const database = Database;
  const viewerId = context.principal.id;
  const [followed, blockedByViewer, blockedViewer, muted] = await Promise.all([
    database
      .select({ id: follows.followeeId })
      .from(follows)
      .where(and(eq(follows.followerId, viewerId), eq(follows.state, 'active')))
      .limit(249),
    database
      .select({ id: blocks.blockedId })
      .from(blocks)
      .where(and(eq(blocks.blockerId, viewerId), eq(blocks.state, 'active')))
      .limit(250),
    database
      .select({ id: blocks.blockerId })
      .from(blocks)
      .where(and(eq(blocks.blockedId, viewerId), eq(blocks.state, 'active')))
      .limit(250),
    database
      .select({ id: mutes.mutedId })
      .from(mutes)
      .where(and(eq(mutes.muterId, viewerId), eq(mutes.state, 'active')))
      .limit(250),
  ]);
  const hidden = new Set([...blockedByViewer, ...blockedViewer, ...muted].map(({ id }) => id));
  const authors = [viewerId, ...followed.map(({ id }) => id)].filter((id) => !hidden.has(id));
  const page = await context.source.page({ partitions: authors, limit: Math.min(input.limit ?? 50, 100) });
  const visible = page.items.filter(
    (post) =>
      post.visibility === 'public' || post.authorId === viewerId || followed.some(({ id }) => id === post.authorId),
  );
  return hydrateTimelineEngagement(database, viewerId, visible);
}

async function hydrateTimelineEngagement(
  database: ApplicationDatabaseClient<typeof chirpSchema>,
  viewerId: string,
  timeline: readonly TimelinePostValue[],
): Promise<readonly TimelinePostValue[]> {
  const postIds = [...new Set(timeline.map(({ id }) => id))].slice(0, 100);
  if (postIds.length === 0) return timeline;
  const authorIds = [...new Set(timeline.map(({ authorId }) => authorId))].slice(0, 100);
  const [counts, viewerReactions, viewerBookmarks, timelineAuthors] = await Promise.all([
    database
      .select({ postId: reactions.postId, kind: reactions.kind, total: count() })
      .from(reactions)
      .where(and(inArray(reactions.postId, postIds), eq(reactions.state, 'active')))
      .groupBy(reactions.postId, reactions.kind),
    database
      .select({ id: reactions.id, postId: reactions.postId, kind: reactions.kind, state: reactions.state })
      .from(reactions)
      .where(and(inArray(reactions.postId, postIds), eq(reactions.accountId, viewerId)))
      .limit(200),
    database
      .select({ id: bookmarks.id, postId: bookmarks.postId, state: bookmarks.state })
      .from(bookmarks)
      .where(and(inArray(bookmarks.postId, postIds), eq(bookmarks.accountId, viewerId)))
      .limit(100),
    database
      .select({ id: accounts.id, kind: accounts.kind })
      .from(accounts)
      .where(inArray(accounts.id, authorIds))
      .limit(100),
  ]);
  const countByPost = new Map<string, { like: number; repost: number }>();
  for (const row of counts) {
    const current = countByPost.get(row.postId) ?? { like: 0, repost: 0 };
    if (row.kind === 'like') current.like = Number(row.total);
    if (row.kind === 'repost') current.repost = Number(row.total);
    countByPost.set(row.postId, current);
  }
  const reactionByPost = new Map<string, Map<string, { readonly id: string; readonly active: boolean }>>();
  for (const row of viewerReactions) {
    const kinds =
      reactionByPost.get(row.postId) ?? new Map<string, { readonly id: string; readonly active: boolean }>();
    kinds.set(row.kind, { id: row.id, active: row.state === 'active' });
    reactionByPost.set(row.postId, kinds);
  }
  const bookmarkByPost = new Map(viewerBookmarks.map((bookmark) => [bookmark.postId, bookmark]));
  const authorKind = new Map(timelineAuthors.map((author) => [author.id, author.kind]));
  return timeline.map((post) => {
    const like = reactionByPost.get(post.id)?.get('like');
    const repost = reactionByPost.get(post.id)?.get('repost');
    const bookmark = bookmarkByPost.get(post.id);
    return {
      ...post,
      authorKind: authorKind.get(post.authorId) === 'automation' ? ('automation' as const) : ('human' as const),
      likeCount: countByPost.get(post.id)?.like ?? 0,
      repostCount: countByPost.get(post.id)?.repost ?? 0,
      viewerLiked: like?.active ?? false,
      viewerReposted: repost?.active ?? false,
      viewerBookmarked: bookmark?.state === 'saved',
      ...(like ? { viewerLikeId: like.id } : {}),
      ...(repost ? { viewerRepostId: repost.id } : {}),
      ...(bookmark ? { viewerBookmarkId: bookmark.id } : {}),
    };
  });
}

PostBase.create.beforeCommit(
  { history: true },
  async (post, input, context) => {
    if (!context.principal) throw new Error('A post requires an authenticated author.');
    if (
      input.authorId !== undefined ||
      input.authorHandle !== undefined ||
      input.publishedAt !== undefined ||
      input.publicationState !== undefined ||
      input.moderationState !== undefined ||
      input.moderationReason !== undefined ||
      input.moderationChangedAt !== undefined ||
      input.deletedAt !== undefined ||
      input.revision !== undefined
    )
      throw new Error(
        'Post authorship, publication state, moderation state, timestamps, and revisions are server-owned.',
      );
    if (post.value.authorId !== context.principal.id)
      throw new Error('The PostgreSQL actor default did not match the authenticated author.');
    if (input.body.trim().length < 1 || input.body.length > 280)
      throw new Error('A Chirp post must contain between 1 and 280 characters.');
    if (
      post.value.publicationState !== 'published' ||
      post.value.moderationState !== 'visible' ||
      post.value.deletedAt !== null
    )
      throw new Error('New posts must begin published, visible, and not deleted.');
    if (!['public', 'followers'].includes(post.value.visibility)) throw new Error('Post visibility is invalid.');
    const author = await Account.get(post.value.authorId);
    if (author?.value.state !== 'active') throw new Error('Only an active account can publish a post.');
    if (context.principal.roles?.includes('automation-worker')) {
      const automationId = context.principal.attributes?.automationId;
      if (typeof automationId !== 'string') throw new Error('An automated post requires a bound automation identity.');
      const automation = await Automation.get(automationId);
      if (automation?.value.state !== 'active' || automation.value.accountId !== context.principal.id)
        throw new Error('The automation is suspended, missing, or not bound to this account.');
    }
    for (const [relationship, relatedPostId] of [
      ['reply', input.replyToPostId],
      ['quote', input.quotePostId],
    ] as const) {
      if (!relatedPostId) continue;
      if (relatedPostId === post.id) throw new Error(`A post cannot ${relationship} itself.`);
      const related = await PostBase.get(relatedPostId);
      if (
        related?.value.publicationState !== 'published' ||
        related.value.moderationState !== 'visible' ||
        related.value.deletedAt !== null
      ) {
        throw new Error(`A ${relationship} requires a visible published post.`);
      }
    }
    const authorHandle = String(author.value.handle);
    post.patch({ spec: { authorHandle, publishedAt: context.now } });
    PostPublished.emit({
      postId: post.id,
      authorId: post.value.authorId,
      authorHandle,
      body: input.body,
      publishedAt: context.now,
      visibility: post.value.visibility,
      ...(input.replyToPostId ? { replyToPostId: input.replyToPostId } : {}),
      ...(input.quotePostId ? { quotePostId: input.quotePostId } : {}),
    });
    PostTimelineChanged.emit({
      operation: 'upsert',
      postId: post.id,
      authorId: post.value.authorId,
      authorHandle,
      body: input.body,
      publishedAt: context.now,
      visibility: post.value.visibility,
      replyToPostId: input.replyToPostId ?? null,
      quotePostId: input.quotePostId ?? null,
    });
  },
);

PostBase.update.beforeCommit(
  { history: true },
  async (post, input, context) => {
    const patch = input.patch;
    if (
      'id' in patch ||
      'authorId' in patch ||
      'authorHandle' in patch ||
      'publishedAt' in patch ||
      'moderationChangedAt' in patch ||
      'deletedAt' in patch ||
      'revision' in patch
    )
      throw new Error('Post identity, authorship, timestamps, and revisions are server-owned.');
    const moderating = patch.moderationState !== undefined || patch.moderationReason !== undefined;
    if (moderating) {
      if (!context.principal?.roles?.includes('moderator'))
        throw new Error('Only a moderator may change publication moderation state.');
      if (!post.value.moderationReason?.trim()) throw new Error('A moderation change requires a reason.');
      if (!['visible', 'limited', 'removed'].includes(post.value.moderationState))
        throw new Error('Moderation state is invalid.');
      post.patch({ spec: { moderationChangedAt: context.now } });
      PostModerationChanged.emit({
        postId: post.id,
        state: post.value.moderationState as 'visible' | 'limited' | 'removed',
        changedAt: context.now,
        reason: post.value.moderationReason,
      });
    } else {
      if (!context.principal || context.principal.id !== post.value.authorId)
        throw new Error('Only the post author can update or remove this post.');
      if (post.value.body.trim().length < 1 || post.value.body.length > 280)
        throw new Error('A Chirp post must contain between 1 and 280 characters.');
      if (patch.publicationState === 'deleted') {
        post.patch({ spec: { deletedAt: context.now } });
        PostDeleted.emit({ postId: post.id, authorId: post.value.authorId, deletedAt: context.now });
      }
    }
    const visible =
      post.value.publicationState === 'published' &&
      post.value.moderationState === 'visible' &&
      post.value.deletedAt === null;
    PostTimelineChanged.emit({
      operation: visible ? 'upsert' : 'remove',
      postId: post.id,
      authorId: post.value.authorId,
      authorHandle: post.value.authorHandle,
      body: post.value.body,
      publishedAt: post.value.publishedAt,
      visibility: post.value.visibility,
      replyToPostId: post.value.replyToPostId,
      quotePostId: post.value.quotePostId,
    });
  },
);

PostBase.delete.beforeCommit({ history: true }, async (post, _input, context) => {
  if (
    !context.principal ||
    (context.principal.id !== post.value.authorId && !context.principal.roles?.includes('moderator'))
  )
    throw new Error('Only the post author or a moderator can delete this post.');
  PostTimelineChanged.emit({
    operation: 'remove',
    postId: post.id,
    authorId: post.value.authorId,
    authorHandle: post.value.authorHandle,
    body: post.value.body,
    publishedAt: post.value.publishedAt,
    visibility: post.value.visibility,
    replyToPostId: post.value.replyToPostId,
    quotePostId: post.value.quotePostId,
  });
});

export const PostHomeTimeline = PostBase.view(
    {
      input: type({ 'limit?': 'number.integer >= 1' }),
      output: TimelinePost.array(),
      source: HomeTimeline,
      reads: [Follow, Block, Mute, ReactionModel, BookmarkModel],
      authorize: ({ principal }) => principal.id.length > 0,
      budgets: { maxRows: 100, maxResultBytes: 512_000, timeoutMs: 3_000 },
    },
    homeTimeline,
  );
export const PostConversation = PostBase.view(
    {
      input: type({ postId: 'string', 'limit?': 'number.integer >= 1' }),
      output: TimelinePost.array(),
      database: Database,
      reads: [ReactionModel, BookmarkModel],
      authorize: ({ principal }) => principal.id.length > 0,
      budgets: { maxRows: 100, maxResultBytes: 512_000, timeoutMs: 3_000 },
    },
    async function conversation(input, context) {
      const database = Database;
      const rows = await database
        .select({
          id: PostBase.id,
          authorId: PostBase.authorId,
          authorHandle: PostBase.authorHandle,
          body: PostBase.body,
          publishedAt: PostBase.publishedAt,
          visibility: PostBase.visibility,
          replyToPostId: PostBase.replyToPostId,
          quotePostId: PostBase.quotePostId,
        })
        .from(PostBase)
        .where(
          and(
            or(eq(PostBase.id, input.postId), eq(PostBase.replyToPostId, input.postId)),
            readablePostWhere(database, context.principal.id),
          ),
        )
        .orderBy(desc(PostBase.publishedAt))
        .limit(Math.min(input.limit ?? 50, 100));
      return hydrateTimelineEngagement(database, context.principal.id, rows);
    },
  );
export const PostSearch = PostBase.view(
    {
      input: type({ query: 'string', 'limit?': 'number.integer >= 1' }),
      output: TimelinePost.array(),
      database: Database,
      reads: [ReactionModel, BookmarkModel],
      authorize: ({ principal }) => principal.id.length > 0,
      budgets: { maxRows: 50, maxResultBytes: 256_000, timeoutMs: 2_000 },
    },
    async function search(input, context) {
      const query = input.query.trim().slice(0, 100);
      if (query.length < 2) return [];
      const database = Database;
      const rows = await database
        .select({
          id: PostBase.id,
          authorId: PostBase.authorId,
          authorHandle: PostBase.authorHandle,
          body: PostBase.body,
          publishedAt: PostBase.publishedAt,
          visibility: PostBase.visibility,
          replyToPostId: PostBase.replyToPostId,
          quotePostId: PostBase.quotePostId,
        })
        .from(PostBase)
        .where(and(ilike(PostBase.body, `%${query}%`), readablePostWhere(database, context.principal.id)))
        .orderBy(desc(PostBase.publishedAt))
        .limit(Math.min(input.limit ?? 20, 50));
      return hydrateTimelineEngagement(database, context.principal.id, rows);
    },
  );
export const PostByAuthor = PostBase.view(
    {
      input: type({ authorId: 'string', 'limit?': 'number.integer >= 1' }),
      output: TimelinePost.array(),
      database: Database,
      reads: [ReactionModel, BookmarkModel],
      authorize: ({ principal }) => principal.id.length > 0,
      budgets: { maxRows: 100, maxResultBytes: 512_000, timeoutMs: 2_000 },
    },
    async function byAuthor(input, context) {
      const database = Database;
      const rows = await database
        .select({
          id: PostBase.id,
          authorId: PostBase.authorId,
          authorHandle: PostBase.authorHandle,
          body: PostBase.body,
          publishedAt: PostBase.publishedAt,
          visibility: PostBase.visibility,
          replyToPostId: PostBase.replyToPostId,
          quotePostId: PostBase.quotePostId,
        })
        .from(PostBase)
        .where(and(eq(PostBase.authorId, input.authorId), readablePostWhere(database, context.principal.id)))
        .orderBy(desc(PostBase.publishedAt))
        .limit(Math.min(input.limit ?? 50, 100));
      return hydrateTimelineEngagement(database, context.principal.id, rows);
    },
  );
export const PostByAuthorHandle = PostBase.view(
    {
      input: type({ handle: 'string', 'limit?': 'number.integer >= 1' }),
      output: TimelinePost.array(),
      database: Database,
      reads: [Account, ReactionModel, BookmarkModel],
      authorize: ({ principal }) => principal.id.length > 0,
      budgets: { maxRows: 100, maxResultBytes: 512_000, timeoutMs: 2_000 },
    },
    async function byAuthorHandle(input, context) {
      const database = Database;
      const rows = await database
        .select({
          id: PostBase.id,
          authorId: PostBase.authorId,
          authorHandle: PostBase.authorHandle,
          body: PostBase.body,
          publishedAt: PostBase.publishedAt,
          visibility: PostBase.visibility,
          replyToPostId: PostBase.replyToPostId,
          quotePostId: PostBase.quotePostId,
        })
        .from(PostBase)
        .innerJoin(accounts, eq(PostBase.authorId, accounts.id))
        .where(and(eq(accounts.handle, input.handle), readablePostWhere(database, context.principal.id)))
        .orderBy(desc(PostBase.publishedAt))
        .limit(Math.min(input.limit ?? 50, 100));
      return hydrateTimelineEngagement(database, context.principal.id, rows);
    },
  );
export const PostTrending = PostBase.view(
    {
      input: type({ 'limit?': 'number.integer >= 1' }),
      output: TimelinePost.array(),
      source: ReactionAnalytics,
      reads: [ReactionModel, BookmarkModel],
      authorize: ({ principal }) => principal.id.length > 0,
      budgets: { maxRows: 50, maxResultBytes: 256_000, timeoutMs: 2_000 },
    },
    async function trending(input, context) {
      const database = Database;
      const limit = Math.min(input.limit ?? 20, 50);
      let rankedPostIds: readonly string[];
      try {
        const ranking = await context.source.aggregate({
          dimensions: ['postId'],
          measures: { score: { operation: 'sum', field: 'delta' } },
          orderBy: [{ field: 'score', direction: 'desc' }],
          limit,
        });
        rankedPostIds = ranking.items.filter(({ score }) => score > 0).map(({ postId }) => postId);
      } catch (error) {
        if (
          !error ||
          typeof error !== 'object' ||
          Reflect.get(error, 'code') !== 'APPLIK8S_ANALYTICAL_PROJECTION_NOT_CONFIGURED'
        )
          throw error;
        rankedPostIds = [];
      }
      if (rankedPostIds.length > 0) {
        const rows = await database
          .select({
            id: PostBase.id,
            authorId: PostBase.authorId,
            authorHandle: PostBase.authorHandle,
            body: PostBase.body,
            publishedAt: PostBase.publishedAt,
            visibility: PostBase.visibility,
            replyToPostId: PostBase.replyToPostId,
            quotePostId: PostBase.quotePostId,
          })
          .from(PostBase)
          .where(
            and(
              inArray(PostBase.id, rankedPostIds),
              eq(PostBase.visibility, 'public'),
              readablePostWhere(database, context.principal.id),
            ),
          )
          .limit(limit);
        const order = new Map(rankedPostIds.map((id, index) => [id, index]));
        const hydrated = await hydrateTimelineEngagement(database, context.principal.id, rows);
        return [...hydrated].sort(
          (left, right) =>
            (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.id) ?? Number.MAX_SAFE_INTEGER),
        );
      }
      // Analytics is optional for the starter profile. Its absence is explicit in
      // installation status; the product remains useful with a bounded recency view.
      const rows = await database
        .select({
          id: PostBase.id,
          authorId: PostBase.authorId,
          authorHandle: PostBase.authorHandle,
          body: PostBase.body,
          publishedAt: PostBase.publishedAt,
          visibility: PostBase.visibility,
          replyToPostId: PostBase.replyToPostId,
          quotePostId: PostBase.quotePostId,
        })
        .from(PostBase)
        .where(and(eq(PostBase.visibility, 'public'), readablePostWhere(database, context.principal.id)))
        .orderBy(desc(PostBase.publishedAt))
        .limit(limit);
      return hydrateTimelineEngagement(database, context.principal.id, rows);
    },
  );
export const Post = PostBase;
