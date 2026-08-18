import type { ApplicationRelationalModel } from '@applik8s/applik8s';
import {
  authenticatedPrincipalId,
  causalPrincipalId,
  field,
  index,
  model,
  pgEnum,
  relations,
  uniqueIndex,
} from '@applik8s/applik8s/drizzle';

export const applicationDocumentState = pgEnum('document_state', [
  'draft',
  'in-review',
  'approved',
  'published',
  'archived',
]);

const documentTable = model(
  'documents',
  {
    id: field.uuid('id').defaultRandom().primaryKey(),
    /** Application-owned authorization scope (a user, workspace, project, or another admitted boundary). */
    principalScope: field.text('principal_scope').notNull().default(causalPrincipalId),
    createdByPrincipalId: field.text('created_by_principal_id').notNull().default(authenticatedPrincipalId),
    title: field.text('title').notNull().default('Untitled document'),
    body: field.text('body').notNull(),
    summary: field.text('summary').notNull().default(''),
    tags: field.text('tags').array().notNull().default([]),
    state: applicationDocumentState('state').notNull().default('draft'),
    contentType: field.text('content_type').notNull().default('text/markdown'),
    /** Human-readable document version; independent of the opaque model revision token. */
    version: field.integer('version').notNull().default(1),
    revision: field.text('revision').notNull().default(''),
    sourceConversationId: field.text('source_conversation_id'),
    sourceRunId: field.text('source_run_id'),
    publishedAt: field.timestamp('published_at', { withTimezone: true, mode: 'string' }),
    archivedAt: field.timestamp('archived_at', { withTimezone: true, mode: 'string' }),
    createdAt: field.timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    updatedAt: field.timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  },
  table => [
    index('documents_scope_updated_idx').on(table.principalScope, table.updatedAt),
    index('documents_scope_state_idx').on(table.principalScope, table.state),
  ],
  { name: 'Document', revision: 'revision' },
);
export const applicationDocuments: ApplicationRelationalModel<typeof documentTable> = documentTable;

const documentRevisionTable = model(
  'document_revisions',
  {
    id: field.text('id').primaryKey(),
    documentId: field.uuid('document_id').notNull().references(() => applicationDocuments.id, { onDelete: 'cascade' }),
    revision: field.integer('revision').notNull(),
    title: field.text('title').notNull(),
    body: field.text('body').notNull(),
    summary: field.text('summary').notNull(),
    tags: field.text('tags').array().notNull(),
    state: applicationDocumentState('state').notNull(),
    authoredByPrincipalId: field.text('authored_by_principal_id').notNull().default(authenticatedPrincipalId),
    createdAt: field.timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  },
  table => [
    uniqueIndex('document_revisions_document_revision_uidx').on(table.documentId, table.revision),
  ],
  { name: 'DocumentRevision', revision: false },
);
export const applicationDocumentRevisions: ApplicationRelationalModel<typeof documentRevisionTable> = documentRevisionTable;

const documentCommentTable = model(
  'document_comments',
  {
    id: field.uuid('id').defaultRandom().primaryKey(),
    documentId: field.uuid('document_id').notNull().references(() => applicationDocuments.id, { onDelete: 'cascade' }),
    /** Repeated here so comments can be listed and authorized without trusting a client-supplied parent scope. */
    principalScope: field.text('principal_scope').notNull().default(causalPrincipalId),
    createdByPrincipalId: field.text('created_by_principal_id').notNull().default(authenticatedPrincipalId),
    body: field.text('body').notNull(),
    resolvedAt: field.timestamp('resolved_at', { withTimezone: true, mode: 'string' }),
    resolvedByPrincipalId: field.text('resolved_by_principal_id'),
    createdAt: field.timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    updatedAt: field.timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    revision: field.text('revision').notNull().default(''),
  },
  table => [
    index('document_comments_document_created_idx').on(table.documentId, table.createdAt),
    index('document_comments_scope_updated_idx').on(table.principalScope, table.updatedAt),
  ],
  { name: 'DocumentComment', revision: 'revision' },
);
export const applicationDocumentComments: ApplicationRelationalModel<typeof documentCommentTable> = documentCommentTable;

export const applicationDocumentRelations = relations(applicationDocuments, ({ many }) => ({
  revisions: many(applicationDocumentRevisions),
  comments: many(applicationDocumentComments),
}));

export const applicationDocumentRevisionRelations = relations(applicationDocumentRevisions, ({ one }) => ({
  document: one(applicationDocuments, {
    fields: [applicationDocumentRevisions.documentId],
    references: [applicationDocuments.id],
  }),
}));

export const applicationDocumentCommentRelations = relations(applicationDocumentComments, ({ one }) => ({
  document: one(applicationDocuments, {
    fields: [applicationDocumentComments.documentId],
    references: [applicationDocuments.id],
  }),
}));

export const applicationDocumentSchema = Object.freeze({
  applicationDocuments,
  applicationDocumentRevisions,
  applicationDocumentComments,
  applicationDocumentRelations,
  applicationDocumentRevisionRelations,
  applicationDocumentCommentRelations,
});
