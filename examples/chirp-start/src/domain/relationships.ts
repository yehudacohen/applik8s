// typecast-file-boundary: validated relationship snapshots are narrowed to their declared Drizzle row shapes after authoritative lookup.
import { type } from '@applik8s/applik8s/dsl';
import { and, eq } from 'drizzle-orm';
import { app } from '../app';
import { accounts } from '../schema/accounts';
import { blocks, follows, mutes } from '../schema/social';
import { Account } from './accounts';
import { ChirpCommandProcessor, Database } from '../providers/database';
import { FollowChanged, RelationshipPolicyChanged } from './events';
import { CreateNotification } from './notifications';

const FollowBase = app.model(follows, { name: 'Follow', database: Database, processor: ChirpCommandProcessor });
const BlockBase = app.model(blocks, { name: 'Block', database: Database, processor: ChirpCommandProcessor });
const MuteBase = app.model(mutes, { name: 'Mute', database: Database, processor: ChirpCommandProcessor });

FollowBase.create.beforeCommit({
  transaction: { models: [Account], commands: [CreateNotification] },
  events: [FollowChanged], history: true,
}, async (follow, input, context) => {
  if (!context.principal) throw new Error('A follow requires an authenticated follower.');
  if (input.followerId !== undefined || input.state !== undefined || input.followedAt !== undefined || input.revision !== undefined) throw new Error('Follow ownership, state, timestamps, and revisions are server-owned.');
  if (follow.value.followerId !== context.principal.id) throw new Error('The PostgreSQL actor default did not match the authenticated follower.');
  if (follow.value.followerId === input.followeeId) throw new Error('An account cannot follow itself.');
  follow.patch({ spec: { followedAt: context.now } });
  const [follower, followee] = await Promise.all([
    context.models.Account?.get({ id: follow.value.followerId }),
    context.models.Account?.get({ id: input.followeeId }),
  ]);
  if (follower?.spec.state !== 'active' || followee?.spec.state !== 'active') throw new Error('A follow requires two active accounts.');
  if (follow.value.state !== 'active' || follow.value.deletedAt !== null) throw new Error('A new follow must begin active.');
  context.emit(FollowChanged, { followId: follow.id, followerId: follow.value.followerId, followeeId: input.followeeId, state: 'active', changedAt: context.now });
  context.send(CreateNotification, {
    id: `follow-${follow.id}`,
    recipientId: input.followeeId,
    actorId: follow.value.followerId,
    postId: null,
    kind: 'follow',
    summary: 'A new account followed you.',
  }, { targetKey: `follow-${follow.id}`, idempotencyKey: context.id('follow-notification') });
});

FollowBase.update.beforeCommit({ events: [FollowChanged], history: true,
}, async (follow, input, context) => {
  if (!context.principal || context.principal.id !== follow.value.followerId) throw new Error('Only the authenticated follower can change this relationship.');
  if ('id' in input.patch || 'followerId' in input.patch || 'followeeId' in input.patch || 'followedAt' in input.patch || 'deletedAt' in input.patch || 'revision' in input.patch) throw new Error('Follow identity, participants, timestamps, and revisions are server-owned.');
  if (!['active', 'deleted'].includes(follow.value.state)) throw new Error('Follow state is invalid.');
  follow.patch({ spec: { deletedAt: follow.value.state === 'deleted' ? context.now : null } });
  context.emit(FollowChanged, { followId: follow.id, followerId: follow.value.followerId, followeeId: follow.value.followeeId, state: follow.value.state as 'active' | 'deleted', changedAt: context.now });
});
FollowBase.delete.beforeCommit({ history: true }, async (follow, _input, context) => {
  if (!context.principal || context.principal.id !== follow.value.followerId) throw new Error('Only the authenticated follower can delete this relationship.');
});

export const Follow = FollowBase.view('followers', {
  input: type({ accountId: 'string', 'limit?': 'number.integer >= 1' }), output: type({ id: 'string', handle: 'string', displayName: 'string', kind: 'string' }).array(),
  database: Database, reads: [Account], authorize: ({ principal }) => principal.id.length > 0,
  run: async ({ context, input }) => context.database(Database).select({ id: accounts.id, handle: accounts.handle, displayName: accounts.displayName, kind: accounts.kind }).from(FollowBase).innerJoin(accounts, eq(FollowBase.followerId, accounts.id)).where(and(eq(FollowBase.followeeId, input.accountId), eq(FollowBase.state, 'active'), eq(accounts.state, 'active'))).limit(Math.min(input.limit ?? 50, 100)),
  budgets: { maxRows: 100, maxResultBytes: 128_000, timeoutMs: 2_000 },
}).view('following', {
  input: type({ accountId: 'string', 'limit?': 'number.integer >= 1' }), output: type({ id: 'string', handle: 'string', displayName: 'string', kind: 'string' }).array(),
  database: Database, reads: [Account], authorize: ({ principal }) => principal.id.length > 0,
  run: async ({ context, input }) => context.database(Database).select({ id: accounts.id, handle: accounts.handle, displayName: accounts.displayName, kind: accounts.kind }).from(FollowBase).innerJoin(accounts, eq(FollowBase.followeeId, accounts.id)).where(and(eq(FollowBase.followerId, input.accountId), eq(FollowBase.state, 'active'), eq(accounts.state, 'active'))).limit(Math.min(input.limit ?? 50, 100)),
  budgets: { maxRows: 100, maxResultBytes: 128_000, timeoutMs: 2_000 },
}).view('viewerState', {
  input: type({ handle: 'string' }),
  output: type({ id: 'string', followeeId: 'string', state: "'active' | 'deleted'", 'deletedAt': 'string | null' }).array(),
  database: Database,
  reads: [Account],
  authorize: ({ principal }) => principal.id.length > 0,
  run: async ({ context, principal, input }) => context.database(Database)
    .select({ id: FollowBase.id, followeeId: FollowBase.followeeId, state: FollowBase.state, deletedAt: FollowBase.deletedAt })
    .from(FollowBase)
    .innerJoin(accounts, eq(FollowBase.followeeId, accounts.id))
    .where(and(eq(FollowBase.followerId, principal.id), eq(accounts.handle, input.handle)))
    .limit(1),
  budgets: { maxRows: 1, maxResultBytes: 16_000, timeoutMs: 2_000 },
});

BlockBase.create.beforeCommit({
  transaction: { models: [Account] }, events: [RelationshipPolicyChanged], history: true,
}, async (block, input, context) => {
  if (!context.principal) throw new Error('A block requires an authenticated account.');
  if (input.blockerId !== undefined || input.state !== undefined || input.createdAt !== undefined || input.revision !== undefined) throw new Error('Block ownership, state, timestamps, and revisions are server-owned.');
  if (block.value.blockerId !== context.principal.id) throw new Error('The PostgreSQL actor default did not match the authenticated blocker.');
  if (block.value.blockerId === input.blockedId) throw new Error('An account cannot block itself.');
  block.patch({ spec: { createdAt: context.now } });
  const blocked = await context.models.Account?.get({ id: input.blockedId });
  if (!blocked) throw new Error('The account to block does not exist.');
  if (block.value.state !== 'active' || block.value.deletedAt !== null) throw new Error('A new block must begin active.');
  context.emit(RelationshipPolicyChanged, { relationshipId: block.id, ownerId: block.value.blockerId, subjectId: input.blockedId, kind: 'block', state: 'active', changedAt: context.now });
});
BlockBase.update.beforeCommit({ events: [RelationshipPolicyChanged], history: true,
}, async (block, input, context) => {
  if (!context.principal || context.principal.id !== block.value.blockerId) throw new Error('Only the authenticated blocker can change this relationship.');
  if ('id' in input.patch || 'blockerId' in input.patch || 'blockedId' in input.patch || 'createdAt' in input.patch || 'deletedAt' in input.patch || 'revision' in input.patch) throw new Error('Block identity, participants, timestamps, and revisions are server-owned.');
  if (!['active', 'removed'].includes(block.value.state)) throw new Error('Block state is invalid.');
  block.patch({ spec: { deletedAt: block.value.state === 'removed' ? context.now : null } });
  context.emit(RelationshipPolicyChanged, { relationshipId: block.id, ownerId: block.value.blockerId, subjectId: block.value.blockedId, kind: 'block', state: block.value.state as 'active' | 'removed', changedAt: context.now });
});
BlockBase.delete.beforeCommit({ history: true }, async (block, _input, context) => {
  if (!context.principal || context.principal.id !== block.value.blockerId) throw new Error('Only the authenticated blocker can delete this relationship.');
});
export const Block = BlockBase.view('viewerState', {
  input: type({ handle: 'string' }),
  output: type({ id: 'string', blockedId: 'string', state: "'active' | 'removed'", 'deletedAt': 'string | null' }).array(),
  database: Database,
  reads: [Account],
  authorize: ({ principal }) => principal.id.length > 0,
  run: async ({ context, principal, input }) => context.database(Database)
    .select({ id: BlockBase.id, blockedId: BlockBase.blockedId, state: BlockBase.state, deletedAt: BlockBase.deletedAt })
    .from(BlockBase)
    .innerJoin(accounts, eq(BlockBase.blockedId, accounts.id))
    .where(and(eq(BlockBase.blockerId, principal.id), eq(accounts.handle, input.handle)))
    .limit(1),
  budgets: { maxRows: 1, maxResultBytes: 16_000, timeoutMs: 2_000 },
});

MuteBase.create.beforeCommit({
  transaction: { models: [Account] }, events: [RelationshipPolicyChanged], history: true,
}, async (mute, input, context) => {
  if (!context.principal) throw new Error('A mute requires an authenticated account.');
  if (input.muterId !== undefined || input.state !== undefined || input.createdAt !== undefined || input.revision !== undefined) throw new Error('Mute ownership, state, timestamps, and revisions are server-owned.');
  if (mute.value.muterId !== context.principal.id) throw new Error('The PostgreSQL actor default did not match the authenticated muter.');
  if (mute.value.muterId === input.mutedId) throw new Error('An account cannot mute itself.');
  mute.patch({ spec: { createdAt: context.now } });
  const muted = await context.models.Account?.get({ id: input.mutedId });
  if (!muted) throw new Error('The account to mute does not exist.');
  if (mute.value.state !== 'active' || mute.value.deletedAt !== null) throw new Error('A new mute must begin active.');
  context.emit(RelationshipPolicyChanged, { relationshipId: mute.id, ownerId: mute.value.muterId, subjectId: input.mutedId, kind: 'mute', state: 'active', changedAt: context.now });
});
MuteBase.update.beforeCommit({ events: [RelationshipPolicyChanged], history: true,
}, async (mute, input, context) => {
  if (!context.principal || context.principal.id !== mute.value.muterId) throw new Error('Only the authenticated muter can change this relationship.');
  if ('id' in input.patch || 'muterId' in input.patch || 'mutedId' in input.patch || 'createdAt' in input.patch || 'deletedAt' in input.patch || 'revision' in input.patch) throw new Error('Mute identity, participants, timestamps, and revisions are server-owned.');
  if (!['active', 'removed'].includes(mute.value.state)) throw new Error('Mute state is invalid.');
  mute.patch({ spec: { deletedAt: mute.value.state === 'removed' ? context.now : null } });
  context.emit(RelationshipPolicyChanged, { relationshipId: mute.id, ownerId: mute.value.muterId, subjectId: mute.value.mutedId, kind: 'mute', state: mute.value.state as 'active' | 'removed', changedAt: context.now });
});
MuteBase.delete.beforeCommit({ history: true }, async (mute, _input, context) => {
  if (!context.principal || context.principal.id !== mute.value.muterId) throw new Error('Only the authenticated muter can delete this relationship.');
});
export const Mute = MuteBase.view('viewerState', {
  input: type({ handle: 'string' }),
  output: type({ id: 'string', mutedId: 'string', state: "'active' | 'removed'", 'deletedAt': 'string | null' }).array(),
  database: Database,
  reads: [Account],
  authorize: ({ principal }) => principal.id.length > 0,
  run: async ({ context, principal, input }) => context.database(Database)
    .select({ id: MuteBase.id, mutedId: MuteBase.mutedId, state: MuteBase.state, deletedAt: MuteBase.deletedAt })
    .from(MuteBase)
    .innerJoin(accounts, eq(MuteBase.mutedId, accounts.id))
    .where(and(eq(MuteBase.muterId, principal.id), eq(accounts.handle, input.handle)))
    .limit(1),
  budgets: { maxRows: 1, maxResultBytes: 16_000, timeoutMs: 2_000 },
});
