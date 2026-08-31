import { relations } from '@applik8s/applik8s/drizzle';
import { accounts, credentialLinks, installationSettings } from './accounts';
import { automationControls, automationRuns, automations } from './automation';
import { engagementBatches } from './engagement';
import { moderationCases, moderationPolicies, reports } from './moderation';
import { mediaAttachments, posts } from './posts';
import { blocks, bookmarks, follows, mutes, notifications, reactions } from './social';

export const accountsRelations = relations(accounts, ({ many }) => ({
  posts: many(posts),
  following: many(follows, { relationName: 'follower' }),
  followers: many(follows, { relationName: 'followee' }),
  reactions: many(reactions),
  bookmarks: many(bookmarks),
  notifications: many(notifications, { relationName: 'notificationRecipient' }),
}));

export const postsRelations = relations(posts, ({ one, many }) => ({
  author: one(accounts, { fields: [posts.authorId], references: [accounts.id] }),
  reactions: many(reactions),
  attachments: many(mediaAttachments),
}));

export const followsRelations = relations(follows, ({ one }) => ({
  follower: one(accounts, { relationName: 'follower', fields: [follows.followerId], references: [accounts.id] }),
  followee: one(accounts, { relationName: 'followee', fields: [follows.followeeId], references: [accounts.id] }),
}));

export const reactionsRelations = relations(reactions, ({ one }) => ({
  account: one(accounts, { fields: [reactions.accountId], references: [accounts.id] }),
  post: one(posts, { fields: [reactions.postId], references: [posts.id] }),
}));

export const bookmarksRelations = relations(bookmarks, ({ one }) => ({
  account: one(accounts, { fields: [bookmarks.accountId], references: [accounts.id] }),
  post: one(posts, { fields: [bookmarks.postId], references: [posts.id] }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  recipient: one(accounts, { relationName: 'notificationRecipient', fields: [notifications.recipientId], references: [accounts.id] }),
  actor: one(accounts, { relationName: 'notificationActor', fields: [notifications.actorId], references: [accounts.id] }),
  post: one(posts, { fields: [notifications.postId], references: [posts.id] }),
}));

export const mediaAttachmentsRelations = relations(mediaAttachments, ({ one }) => ({
  owner: one(accounts, { fields: [mediaAttachments.ownerId], references: [accounts.id] }),
  post: one(posts, { fields: [mediaAttachments.postId], references: [posts.id] }),
}));

export const automationsRelations = relations(automations, ({ one, many }) => ({
  owner: one(accounts, { relationName: 'automationOwner', fields: [automations.ownerId], references: [accounts.id] }),
  account: one(accounts, { relationName: 'automationAccount', fields: [automations.accountId], references: [accounts.id] }),
  runs: many(automationRuns),
}));

export const automationRunsRelations = relations(automationRuns, ({ one }) => ({
  automation: one(automations, { fields: [automationRuns.automationId], references: [automations.id] }),
}));

export {
  accounts, automationControls, automationRuns, automations, blocks, bookmarks, credentialLinks, follows,
  engagementBatches, installationSettings, mediaAttachments, moderationCases, moderationPolicies, mutes, notifications, posts,
  reactions, reports,
};

export const chirpSchema = {
  accounts, credentialLinks, installationSettings, posts, Media: mediaAttachments, follows, reactions,
  bookmarks, notifications, blocks, mutes, reports, moderationCases, moderationPolicies, automations, automationRuns, automationControls,
  engagementBatches,
  accountsRelations, postsRelations, followsRelations, reactionsRelations, bookmarksRelations,
  notificationsRelations, mediaAttachmentsRelations, automationsRelations, automationRunsRelations,
};
