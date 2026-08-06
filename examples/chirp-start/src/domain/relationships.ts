// typecast-file-boundary: validated relationship snapshots are narrowed to their declared Drizzle row shapes after authoritative lookup.
import { type } from '@applik8s/applik8s/dsl';
import { and, eq } from 'drizzle-orm';
import { Database } from '../providers/database';
import { accounts } from '../schema/accounts';
import { blocks, follows, mutes } from '../schema/social';
import { Account } from './accounts';
import { FollowChanged, RelationshipPolicyChanged } from './events';
import { CreateNotification } from './notifications';

const FollowBase = follows;
const BlockBase = blocks;
const MuteBase = mutes;

FollowBase.create.beforeCommit(
  { history: true },
  async (follow, input, context) => {
    if (!context.principal) throw new Error('A follow requires an authenticated follower.');
    if (
      input.followerId !== undefined ||
      input.state !== undefined ||
      input.followedAt !== undefined ||
      input.revision !== undefined
    )
      throw new Error('Follow ownership, state, timestamps, and revisions are server-owned.');
    if (follow.value.followerId !== context.principal.id)
      throw new Error('The PostgreSQL actor default did not match the authenticated follower.');
    if (follow.value.followerId === input.followeeId) throw new Error('An account cannot follow itself.');
    follow.patch({ spec: { followedAt: context.now } });
    const [follower, followee] = await Promise.all([
      Account.get(follow.value.followerId),
      Account.get(input.followeeId),
    ]);
    if (follower?.value.state !== 'active' || followee?.value.state !== 'active')
      throw new Error('A follow requires two active accounts.');
    if (follow.value.state !== 'active' || follow.value.deletedAt !== null)
      throw new Error('A new follow must begin active.');
    FollowChanged.emit({
      followId: follow.id,
      followerId: follow.value.followerId,
      followeeId: input.followeeId,
      state: 'active',
      changedAt: context.now,
    });
    void CreateNotification({
      id: `follow-${follow.id}`,
      recipientId: input.followeeId,
      actorId: follow.value.followerId,
      postId: null,
      kind: 'follow',
      summary: 'A new account followed you.',
    });
  },
);

FollowBase.update.beforeCommit({ history: true }, async (follow, input, context) => {
  if (!context.principal || context.principal.id !== follow.value.followerId)
    throw new Error('Only the authenticated follower can change this relationship.');
  if (
    'id' in input.patch ||
    'followerId' in input.patch ||
    'followeeId' in input.patch ||
    'followedAt' in input.patch ||
    'deletedAt' in input.patch ||
    'revision' in input.patch
  )
    throw new Error('Follow identity, participants, timestamps, and revisions are server-owned.');
  if (!['active', 'deleted'].includes(follow.value.state)) throw new Error('Follow state is invalid.');
  follow.patch({ spec: { deletedAt: follow.value.state === 'deleted' ? context.now : null } });
  FollowChanged.emit({
    followId: follow.id,
    followerId: follow.value.followerId,
    followeeId: follow.value.followeeId,
    state: follow.value.state as 'active' | 'deleted',
    changedAt: context.now,
  });
});
FollowBase.delete.beforeCommit({ history: true }, async (follow, _input, context) => {
  if (!context.principal || context.principal.id !== follow.value.followerId)
    throw new Error('Only the authenticated follower can delete this relationship.');
});

export const Follow = FollowBase;
export const FollowFollowers = Follow.view(
  {
    input: type({ accountId: 'string', 'limit?': 'number.integer >= 1' }),
    output: type({ id: 'string', handle: 'string', displayName: 'string', kind: 'string' }).array(),
    database: Database,
    reads: [Account],
    authorize: ({ principal }) => principal.id.length > 0,
    budgets: { maxRows: 100, maxResultBytes: 128_000, timeoutMs: 2_000 },
  },
  async function followers(input, _context) {
    return Database
      .select({ id: accounts.id, handle: accounts.handle, displayName: accounts.displayName, kind: accounts.kind })
      .from(FollowBase)
      .innerJoin(accounts, eq(FollowBase.followerId, accounts.id))
      .where(
        and(eq(FollowBase.followeeId, input.accountId), eq(FollowBase.state, 'active'), eq(accounts.state, 'active')),
      )
      .limit(Math.min(input.limit ?? 50, 100));
  },
);
export const FollowFollowing = Follow.view(
  {
    input: type({ accountId: 'string', 'limit?': 'number.integer >= 1' }),
    output: type({ id: 'string', handle: 'string', displayName: 'string', kind: 'string' }).array(),
    database: Database,
    reads: [Account],
    authorize: ({ principal }) => principal.id.length > 0,
    budgets: { maxRows: 100, maxResultBytes: 128_000, timeoutMs: 2_000 },
  },
  async function following(input, _context) {
    return Database
      .select({ id: accounts.id, handle: accounts.handle, displayName: accounts.displayName, kind: accounts.kind })
      .from(FollowBase)
      .innerJoin(accounts, eq(FollowBase.followeeId, accounts.id))
      .where(
        and(eq(FollowBase.followerId, input.accountId), eq(FollowBase.state, 'active'), eq(accounts.state, 'active')),
      )
      .limit(Math.min(input.limit ?? 50, 100));
  },
);
export const FollowViewerState = Follow.view(
  {
    input: type({ handle: 'string' }),
    output: type({
      id: 'string',
      followeeId: 'string',
      state: "'active' | 'deleted'",
      deletedAt: 'string | null',
    }).array(),
    database: Database,
    reads: [Account],
    authorize: ({ principal }) => principal.id.length > 0,
    budgets: { maxRows: 1, maxResultBytes: 16_000, timeoutMs: 2_000 },
  },
  async function viewerState(input, context) {
    return Database
      .select({
        id: FollowBase.id,
        followeeId: FollowBase.followeeId,
        state: FollowBase.state,
        deletedAt: FollowBase.deletedAt,
      })
      .from(FollowBase)
      .innerJoin(accounts, eq(FollowBase.followeeId, accounts.id))
      .where(and(eq(FollowBase.followerId, context.principal.id), eq(accounts.handle, input.handle)))
      .limit(1);
  },
);

BlockBase.create.beforeCommit(
  { history: true },
  async (block, input, context) => {
    if (!context.principal) throw new Error('A block requires an authenticated account.');
    if (
      input.blockerId !== undefined ||
      input.state !== undefined ||
      input.createdAt !== undefined ||
      input.revision !== undefined
    )
      throw new Error('Block ownership, state, timestamps, and revisions are server-owned.');
    if (block.value.blockerId !== context.principal.id)
      throw new Error('The PostgreSQL actor default did not match the authenticated blocker.');
    if (block.value.blockerId === input.blockedId) throw new Error('An account cannot block itself.');
    block.patch({ spec: { createdAt: context.now } });
    const blocked = await Account.get(input.blockedId);
    if (!blocked) throw new Error('The account to block does not exist.');
    if (block.value.state !== 'active' || block.value.deletedAt !== null)
      throw new Error('A new block must begin active.');
    RelationshipPolicyChanged.emit({
      relationshipId: block.id,
      ownerId: block.value.blockerId,
      subjectId: input.blockedId,
      kind: 'block',
      state: 'active',
      changedAt: context.now,
    });
  },
);
BlockBase.update.beforeCommit({ history: true }, async (block, input, context) => {
  if (!context.principal || context.principal.id !== block.value.blockerId)
    throw new Error('Only the authenticated blocker can change this relationship.');
  if (
    'id' in input.patch ||
    'blockerId' in input.patch ||
    'blockedId' in input.patch ||
    'createdAt' in input.patch ||
    'deletedAt' in input.patch ||
    'revision' in input.patch
  )
    throw new Error('Block identity, participants, timestamps, and revisions are server-owned.');
  if (!['active', 'removed'].includes(block.value.state)) throw new Error('Block state is invalid.');
  block.patch({ spec: { deletedAt: block.value.state === 'removed' ? context.now : null } });
  RelationshipPolicyChanged.emit({
    relationshipId: block.id,
    ownerId: block.value.blockerId,
    subjectId: block.value.blockedId,
    kind: 'block',
    state: block.value.state as 'active' | 'removed',
    changedAt: context.now,
  });
});
BlockBase.delete.beforeCommit({ history: true }, async (block, _input, context) => {
  if (!context.principal || context.principal.id !== block.value.blockerId)
    throw new Error('Only the authenticated blocker can delete this relationship.');
});
export const Block = BlockBase;
export const BlockViewerState = Block.view(
  {
    input: type({ handle: 'string' }),
    output: type({
      id: 'string',
      blockedId: 'string',
      state: "'active' | 'removed'",
      deletedAt: 'string | null',
    }).array(),
    database: Database,
    reads: [Account],
    authorize: ({ principal }) => principal.id.length > 0,
    budgets: { maxRows: 1, maxResultBytes: 16_000, timeoutMs: 2_000 },
  },
  async function viewerState(input, context) {
    return Database
      .select({
        id: BlockBase.id,
        blockedId: BlockBase.blockedId,
        state: BlockBase.state,
        deletedAt: BlockBase.deletedAt,
      })
      .from(BlockBase)
      .innerJoin(accounts, eq(BlockBase.blockedId, accounts.id))
      .where(and(eq(BlockBase.blockerId, context.principal.id), eq(accounts.handle, input.handle)))
      .limit(1);
  },
);

MuteBase.create.beforeCommit(
  { history: true },
  async (mute, input, context) => {
    if (!context.principal) throw new Error('A mute requires an authenticated account.');
    if (
      input.muterId !== undefined ||
      input.state !== undefined ||
      input.createdAt !== undefined ||
      input.revision !== undefined
    )
      throw new Error('Mute ownership, state, timestamps, and revisions are server-owned.');
    if (mute.value.muterId !== context.principal.id)
      throw new Error('The PostgreSQL actor default did not match the authenticated muter.');
    if (mute.value.muterId === input.mutedId) throw new Error('An account cannot mute itself.');
    mute.patch({ spec: { createdAt: context.now } });
    const muted = await Account.get(input.mutedId);
    if (!muted) throw new Error('The account to mute does not exist.');
    if (mute.value.state !== 'active' || mute.value.deletedAt !== null)
      throw new Error('A new mute must begin active.');
    RelationshipPolicyChanged.emit({
      relationshipId: mute.id,
      ownerId: mute.value.muterId,
      subjectId: input.mutedId,
      kind: 'mute',
      state: 'active',
      changedAt: context.now,
    });
  },
);
MuteBase.update.beforeCommit({ history: true }, async (mute, input, context) => {
  if (!context.principal || context.principal.id !== mute.value.muterId)
    throw new Error('Only the authenticated muter can change this relationship.');
  if (
    'id' in input.patch ||
    'muterId' in input.patch ||
    'mutedId' in input.patch ||
    'createdAt' in input.patch ||
    'deletedAt' in input.patch ||
    'revision' in input.patch
  )
    throw new Error('Mute identity, participants, timestamps, and revisions are server-owned.');
  if (!['active', 'removed'].includes(mute.value.state)) throw new Error('Mute state is invalid.');
  mute.patch({ spec: { deletedAt: mute.value.state === 'removed' ? context.now : null } });
  RelationshipPolicyChanged.emit({
    relationshipId: mute.id,
    ownerId: mute.value.muterId,
    subjectId: mute.value.mutedId,
    kind: 'mute',
    state: mute.value.state as 'active' | 'removed',
    changedAt: context.now,
  });
});
MuteBase.delete.beforeCommit({ history: true }, async (mute, _input, context) => {
  if (!context.principal || context.principal.id !== mute.value.muterId)
    throw new Error('Only the authenticated muter can delete this relationship.');
});
export const Mute = MuteBase;
export const MuteViewerState = Mute.view(
  {
    input: type({ handle: 'string' }),
    output: type({
      id: 'string',
      mutedId: 'string',
      state: "'active' | 'removed'",
      deletedAt: 'string | null',
    }).array(),
    database: Database,
    reads: [Account],
    authorize: ({ principal }) => principal.id.length > 0,
    budgets: { maxRows: 1, maxResultBytes: 16_000, timeoutMs: 2_000 },
  },
  async function viewerState(input, context) {
    return Database
      .select({ id: MuteBase.id, mutedId: MuteBase.mutedId, state: MuteBase.state, deletedAt: MuteBase.deletedAt })
      .from(MuteBase)
      .innerJoin(accounts, eq(MuteBase.mutedId, accounts.id))
      .where(and(eq(MuteBase.muterId, context.principal.id), eq(accounts.handle, input.handle)))
      .limit(1);
  },
);
