// typecast-file-boundary: validated social-fact snapshots are narrowed to their declared Drizzle row shapes after authoritative lookup.
import { type } from '@applik8s/applik8s/dsl';
import { and, desc, eq } from 'drizzle-orm';
import { posts } from '../schema/posts';
import { Account } from './accounts';
import { Database } from '../providers/database';
import { BookmarkChanged, ReactionChanged } from './events';
import { CreateNotification } from './notifications';
import { Post } from './post';
import { BookmarkModel as BookmarkBase, ReactionModel as ReactionBase } from './social-models';

ReactionBase.create.beforeCommit(
  { history: true },
  async (reaction, input, context) => {
    if (!context.principal) throw new Error('A reaction requires an authenticated account.');
    if (
      input.accountId !== undefined ||
      input.state !== undefined ||
      input.reactedAt !== undefined ||
      input.revision !== undefined
    )
      throw new Error('Reaction ownership, state, timestamps, and revisions are server-owned.');
    if (reaction.value.accountId !== context.principal.id)
      throw new Error('The PostgreSQL actor default did not match the authenticated reaction owner.');
    reaction.patch({ spec: { reactedAt: context.now } });
    const [account, post] = await Promise.all([
      Account.get(reaction.value.accountId),
      Post.get(input.postId),
    ]);
    if (
      account?.value.state !== 'active' ||
      post?.value.publicationState !== 'published' ||
      post.value.moderationState !== 'visible'
    )
      throw new Error('A reaction requires an active account and visible published post.');
    if (!['like', 'repost'].includes(input.kind) || reaction.value.state !== 'active')
      throw new Error('A new reaction must be an active like or repost.');
    ReactionChanged.emit({
      reactionId: reaction.id,
      accountId: reaction.value.accountId,
      postId: input.postId,
      kind: input.kind as 'like' | 'repost',
      state: 'active',
      changedAt: context.now,
    });
    if (post.value.authorId !== reaction.value.accountId)
      void CreateNotification({
        id: `${input.kind}-${reaction.id}`,
        recipientId: String(post.value.authorId),
        actorId: reaction.value.accountId,
        postId: input.postId,
        kind: input.kind,
        summary: `Someone ${input.kind === 'like' ? 'liked' : 'reposted'} your post.`,
      });
  },
);

ReactionBase.update.beforeCommit(
  { history: true },
  async (reaction, input, context) => {
    if (!context.principal || context.principal.id !== reaction.value.accountId)
      throw new Error('Only the reaction owner can change it.');
    if (
      'id' in input.patch ||
      'accountId' in input.patch ||
      'postId' in input.patch ||
      'kind' in input.patch ||
      'reactedAt' in input.patch ||
      'revision' in input.patch
    )
      throw new Error('Reaction identity, participants, timestamps, and revisions are server-owned.');
    const [account, post] = await Promise.all([
      Account.get(reaction.value.accountId),
      Post.get(reaction.value.postId),
    ]);
    if (
      account?.value.state !== 'active' ||
      post?.value.publicationState !== 'published' ||
      post.value.moderationState !== 'visible'
    )
      throw new Error('A reaction requires an active account and visible published post.');
    if (!['active', 'deleted'].includes(reaction.value.state)) throw new Error('Reaction state is invalid.');
    ReactionChanged.emit({
      reactionId: reaction.id,
      accountId: reaction.value.accountId,
      postId: reaction.value.postId,
      kind: reaction.value.kind as 'like' | 'repost',
      state: reaction.value.state as 'active' | 'deleted',
      changedAt: context.now,
    });
    if (reaction.value.state === 'active' && post.value.authorId !== reaction.value.accountId)
      void CreateNotification({
        id: `${reaction.value.kind}-${reaction.id}`,
        recipientId: String(post.value.authorId),
        actorId: reaction.value.accountId,
        postId: reaction.value.postId,
        kind: reaction.value.kind as 'like' | 'repost',
        summary: `Someone ${reaction.value.kind === 'like' ? 'liked' : 'reposted'} your post.`,
      });
  },
);
ReactionBase.delete.beforeCommit({ history: true }, async (reaction, _input, context) => {
  if (!context.principal || context.principal.id !== reaction.value.accountId)
    throw new Error('Only the reaction owner can delete it.');
});
export const Reaction = ReactionBase;

BookmarkBase.create.beforeCommit(
  { history: true },
  async (bookmark, input, context) => {
    if (!context.principal) throw new Error('A bookmark requires an authenticated account.');
    if (
      input.accountId !== undefined ||
      input.state !== undefined ||
      input.savedAt !== undefined ||
      input.revision !== undefined
    )
      throw new Error('Bookmark ownership, state, timestamps, and revisions are server-owned.');
    if (bookmark.value.accountId !== context.principal.id)
      throw new Error('The PostgreSQL actor default did not match the authenticated bookmark owner.');
    bookmark.patch({ spec: { savedAt: context.now } });
    const [account, post] = await Promise.all([
      Account.get(bookmark.value.accountId),
      Post.get(input.postId),
    ]);
    if (
      account?.value.state !== 'active' ||
      post?.value.publicationState !== 'published' ||
      post.value.moderationState !== 'visible'
    )
      throw new Error('A bookmark requires an active account and visible published post.');
    if (bookmark.value.state !== 'saved' || bookmark.value.deletedAt !== null)
      throw new Error('A new bookmark must begin saved.');
    BookmarkChanged.emit({
      bookmarkId: bookmark.id,
      accountId: bookmark.value.accountId,
      postId: input.postId,
      state: 'saved',
      changedAt: context.now,
    });
  },
);
BookmarkBase.update.beforeCommit({ history: true }, async (bookmark, input, context) => {
  if (!context.principal || context.principal.id !== bookmark.value.accountId)
    throw new Error('Only the bookmark owner can change it.');
  if (
    'id' in input.patch ||
    'accountId' in input.patch ||
    'postId' in input.patch ||
    'savedAt' in input.patch ||
    'deletedAt' in input.patch ||
    'revision' in input.patch
  )
    throw new Error('Bookmark identity, participants, timestamps, and revisions are server-owned.');
  if (!['saved', 'removed'].includes(bookmark.value.state)) throw new Error('Bookmark state is invalid.');
  bookmark.patch({ spec: { deletedAt: bookmark.value.state === 'removed' ? context.now : null } });
  BookmarkChanged.emit({
    bookmarkId: bookmark.id,
    accountId: bookmark.value.accountId,
    postId: bookmark.value.postId,
    state: bookmark.value.state as 'saved' | 'removed',
    changedAt: context.now,
  });
});
BookmarkBase.delete.beforeCommit({ history: true }, async (bookmark, _input, context) => {
  if (!context.principal || context.principal.id !== bookmark.value.accountId)
    throw new Error('Only the bookmark owner can delete it.');
});
export const Bookmark = BookmarkBase;
export const BookmarkMine = Bookmark.view(
  {
    input: type({ 'limit?': 'number.integer >= 1' }),
    output: type({
      id: 'string',
      postId: 'string',
      authorId: 'string',
      authorHandle: 'string',
      body: 'string',
      publishedAt: 'string',
    }).array(),
    database: Database,
    reads: [Post],
    authorize: ({ principal }) => principal.id.length > 0,
    budgets: { maxRows: 100, maxResultBytes: 512_000, timeoutMs: 2_000 },
  },
  async function mine(input, context) {
    return Database
      .select({
        id: BookmarkBase.id,
        postId: BookmarkBase.postId,
        authorId: posts.authorId,
        authorHandle: posts.authorHandle,
        body: posts.body,
        publishedAt: posts.publishedAt,
      })
      .from(BookmarkBase)
      .innerJoin(posts, eq(BookmarkBase.postId, posts.id))
      .where(
        and(
          eq(BookmarkBase.accountId, context.principal.id),
          eq(BookmarkBase.state, 'saved'),
          eq(posts.publicationState, 'published'),
          eq(posts.moderationState, 'visible'),
        ),
      )
      .orderBy(desc(BookmarkBase.savedAt))
      .limit(Math.min(input.limit ?? 50, 100));
  },
);
