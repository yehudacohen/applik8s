import { field, index, model, uniqueIndex } from '@applik8s/applik8s/drizzle';
import { accounts } from './accounts';
import { authenticatedPrincipalId } from './defaults';
import { posts } from './posts';

export const follows = model('follows', {
  id: field.text('id').primaryKey(),
  followerId: field.text('follower_id').notNull().default(authenticatedPrincipalId).references(() => accounts.id),
  followeeId: field.text('followee_id').notNull().references(() => accounts.id),
  state: field.text('state').notNull().default('active'),
  followedAt: field.text('followed_at').notNull().default(''),
  deletedAt: field.text('deleted_at'),
  revision: field.text('revision').notNull().default(''),
}, (table) => [
  uniqueIndex('follows_pair').on(table.followerId, table.followeeId),
  index('follows_follower_state').on(table.followerId, table.state),
  index('follows_followee_state').on(table.followeeId, table.state),
]);

export const reactions = model('reactions', {
  id: field.text('id').primaryKey(),
  accountId: field.text('account_id').notNull().default(authenticatedPrincipalId).references(() => accounts.id),
  postId: field.text('post_id').notNull().references(() => posts.id),
  kind: field.text('kind').notNull(),
  state: field.text('state').notNull().default('active'),
  reactedAt: field.text('reacted_at').notNull().default(''),
  revision: field.text('revision').notNull().default(''),
}, (table) => [
  uniqueIndex('reactions_account_post_kind').on(table.accountId, table.postId, table.kind),
  index('reactions_post_kind_state').on(table.postId, table.kind, table.state),
]);

export const bookmarks = model('bookmarks', {
  id: field.text('id').primaryKey(),
  accountId: field.text('account_id').notNull().default(authenticatedPrincipalId).references(() => accounts.id),
  postId: field.text('post_id').notNull().references(() => posts.id),
  savedAt: field.text('saved_at').notNull().default(''),
  state: field.text('state').notNull().default('saved'),
  deletedAt: field.text('deleted_at'),
  revision: field.text('revision').notNull().default(''),
}, (table) => [
  uniqueIndex('bookmarks_account_post').on(table.accountId, table.postId),
  index('bookmarks_account_saved').on(table.accountId, table.savedAt),
]);

export const notifications = model('notifications', {
  id: field.text('id').primaryKey(),
  recipientId: field.text('recipient_id').notNull().references(() => accounts.id),
  actorId: field.text('actor_id').references(() => accounts.id),
  postId: field.text('post_id').references(() => posts.id),
  kind: field.text('kind').notNull(),
  summary: field.text('summary').notNull(),
  createdAt: field.text('created_at').notNull().default(''),
  readAt: field.text('read_at'),
  revision: field.text('revision').notNull().default(''),
}, (table) => [index('notifications_recipient_created').on(table.recipientId, table.createdAt)]);

export const blocks = model('blocks', {
  id: field.text('id').primaryKey(),
  blockerId: field.text('blocker_id').notNull().default(authenticatedPrincipalId).references(() => accounts.id),
  blockedId: field.text('blocked_id').notNull().references(() => accounts.id),
  createdAt: field.text('created_at').notNull().default(''),
  state: field.text('state').notNull().default('active'),
  deletedAt: field.text('deleted_at'),
  revision: field.text('revision').notNull().default(''),
}, (table) => [uniqueIndex('blocks_pair').on(table.blockerId, table.blockedId)]);

export const mutes = model('mutes', {
  id: field.text('id').primaryKey(),
  muterId: field.text('muter_id').notNull().default(authenticatedPrincipalId).references(() => accounts.id),
  mutedId: field.text('muted_id').notNull().references(() => accounts.id),
  createdAt: field.text('created_at').notNull().default(''),
  expiresAt: field.text('expires_at'),
  state: field.text('state').notNull().default('active'),
  deletedAt: field.text('deleted_at'),
  revision: field.text('revision').notNull().default(''),
}, (table) => [uniqueIndex('mutes_pair').on(table.muterId, table.mutedId)]);
