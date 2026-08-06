import { field, index, model } from '@applik8s/applik8s/drizzle';
import { accounts } from './accounts';
import { authenticatedPrincipalId } from './defaults';

export const posts = model('posts', {
  id: field.text('id').primaryKey(),
  authorId: field.text('author_id').notNull().default(authenticatedPrincipalId).references(() => accounts.id),
  authorHandle: field.text('author_handle').notNull().default(''),
  body: field.text('body').notNull(),
  replyToPostId: field.text('reply_to_post_id'),
  quotePostId: field.text('quote_post_id'),
  visibility: field.text('visibility').notNull().default('public'),
  publicationState: field.text('publication_state').notNull().default('published'),
  moderationState: field.text('moderation_state').notNull().default('visible'),
  moderationReason: field.text('moderation_reason'),
  moderationChangedAt: field.text('moderation_changed_at'),
  publishedAt: field.text('published_at').notNull().default(''),
  deletedAt: field.text('deleted_at'),
  revision: field.text('revision').notNull().default(''),
}, (table) => [
  index('posts_author_published').on(table.authorId, table.publishedAt),
  index('posts_reply_published').on(table.replyToPostId, table.publishedAt),
  index('posts_visibility_state').on(table.visibility, table.publicationState, table.moderationState),
]);

export const mediaAttachments = model('media_attachments', {
  id: field.text('id').primaryKey(),
  ownerId: field.text('owner_id').notNull().default(authenticatedPrincipalId).references(() => accounts.id),
  postId: field.text('post_id').references(() => posts.id),
  objectKey: field.text('object_key').notNull(),
  contentType: field.text('content_type').notNull(),
  byteLength: field.text('byte_length').notNull(),
  sha256: field.text('sha256').notNull(),
  /** Short-lived signed completion evidence retained for audit, never an object-store credential. */
  uploadReceipt: field.text('upload_receipt').notNull().default(''),
  altText: field.text('alt_text').notNull(),
  processingState: field.text('processing_state').notNull().default('pending'),
	processingReason: field.text('processing_reason').notNull().default(''),
  createdAt: field.text('created_at').notNull().default(''),
  revision: field.text('revision').notNull().default(''),
}, (table) => [
  index('media_attachments_owner').on(table.ownerId, table.createdAt),
  index('media_attachments_post').on(table.postId),
]);
