import { index, pgTable, text } from 'drizzle-orm/pg-core';
import { accounts } from './accounts';
import { authenticatedPrincipalId } from './defaults';

export const posts = pgTable('posts', {
  id: text('id').primaryKey(),
  authorId: text('author_id').notNull().default(authenticatedPrincipalId).references(() => accounts.id),
  authorHandle: text('author_handle').notNull().default(''),
  body: text('body').notNull(),
  replyToPostId: text('reply_to_post_id'),
  quotePostId: text('quote_post_id'),
  visibility: text('visibility').notNull().default('public'),
  publicationState: text('publication_state').notNull().default('published'),
  moderationState: text('moderation_state').notNull().default('visible'),
  moderationReason: text('moderation_reason'),
  moderationChangedAt: text('moderation_changed_at'),
  publishedAt: text('published_at').notNull().default(''),
  deletedAt: text('deleted_at'),
  revision: text('revision').notNull().default(''),
}, (table) => [
  index('posts_author_published').on(table.authorId, table.publishedAt),
  index('posts_reply_published').on(table.replyToPostId, table.publishedAt),
  index('posts_visibility_state').on(table.visibility, table.publicationState, table.moderationState),
]);

export const mediaAttachments = pgTable('media_attachments', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull().default(authenticatedPrincipalId).references(() => accounts.id),
  postId: text('post_id').references(() => posts.id),
  objectKey: text('object_key').notNull(),
  contentType: text('content_type').notNull(),
  byteLength: text('byte_length').notNull(),
  sha256: text('sha256').notNull(),
  /** Short-lived signed completion evidence retained for audit, never an object-store credential. */
  uploadReceipt: text('upload_receipt').notNull().default(''),
  altText: text('alt_text').notNull(),
  processingState: text('processing_state').notNull().default('pending'),
	processingReason: text('processing_reason').notNull().default(''),
  createdAt: text('created_at').notNull().default(''),
  revision: text('revision').notNull().default(''),
}, (table) => [
  index('media_attachments_owner').on(table.ownerId, table.createdAt),
  index('media_attachments_post').on(table.postId),
]);
