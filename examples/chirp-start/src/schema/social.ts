import { index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { accounts } from './accounts';
import { authenticatedPrincipalId } from './defaults';
import { posts } from './posts';

export const follows = pgTable('follows', {
  id: text('id').primaryKey(),
  followerId: text('follower_id').notNull().default(authenticatedPrincipalId).references(() => accounts.id),
  followeeId: text('followee_id').notNull().references(() => accounts.id),
  state: text('state').notNull().default('active'),
  followedAt: text('followed_at').notNull().default(''),
  deletedAt: text('deleted_at'),
  revision: text('revision').notNull().default(''),
}, (table) => [
  uniqueIndex('follows_pair').on(table.followerId, table.followeeId),
  index('follows_follower_state').on(table.followerId, table.state),
  index('follows_followee_state').on(table.followeeId, table.state),
]);

export const reactions = pgTable('reactions', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().default(authenticatedPrincipalId).references(() => accounts.id),
  postId: text('post_id').notNull().references(() => posts.id),
  kind: text('kind').notNull(),
  state: text('state').notNull().default('active'),
  reactedAt: text('reacted_at').notNull().default(''),
  revision: text('revision').notNull().default(''),
}, (table) => [
  uniqueIndex('reactions_account_post_kind').on(table.accountId, table.postId, table.kind),
  index('reactions_post_kind_state').on(table.postId, table.kind, table.state),
]);

export const bookmarks = pgTable('bookmarks', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().default(authenticatedPrincipalId).references(() => accounts.id),
  postId: text('post_id').notNull().references(() => posts.id),
  savedAt: text('saved_at').notNull().default(''),
  state: text('state').notNull().default('saved'),
  deletedAt: text('deleted_at'),
  revision: text('revision').notNull().default(''),
}, (table) => [
  uniqueIndex('bookmarks_account_post').on(table.accountId, table.postId),
  index('bookmarks_account_saved').on(table.accountId, table.savedAt),
]);

export const notifications = pgTable('notifications', {
  id: text('id').primaryKey(),
  recipientId: text('recipient_id').notNull().references(() => accounts.id),
  actorId: text('actor_id').references(() => accounts.id),
  postId: text('post_id').references(() => posts.id),
  kind: text('kind').notNull(),
  summary: text('summary').notNull(),
  createdAt: text('created_at').notNull().default(''),
  readAt: text('read_at'),
  revision: text('revision').notNull().default(''),
}, (table) => [index('notifications_recipient_created').on(table.recipientId, table.createdAt)]);

export const blocks = pgTable('blocks', {
  id: text('id').primaryKey(),
  blockerId: text('blocker_id').notNull().default(authenticatedPrincipalId).references(() => accounts.id),
  blockedId: text('blocked_id').notNull().references(() => accounts.id),
  createdAt: text('created_at').notNull().default(''),
  state: text('state').notNull().default('active'),
  deletedAt: text('deleted_at'),
  revision: text('revision').notNull().default(''),
}, (table) => [uniqueIndex('blocks_pair').on(table.blockerId, table.blockedId)]);

export const mutes = pgTable('mutes', {
  id: text('id').primaryKey(),
  muterId: text('muter_id').notNull().default(authenticatedPrincipalId).references(() => accounts.id),
  mutedId: text('muted_id').notNull().references(() => accounts.id),
  createdAt: text('created_at').notNull().default(''),
  expiresAt: text('expires_at'),
  state: text('state').notNull().default('active'),
  deletedAt: text('deleted_at'),
  revision: text('revision').notNull().default(''),
}, (table) => [uniqueIndex('mutes_pair').on(table.muterId, table.mutedId)]);
