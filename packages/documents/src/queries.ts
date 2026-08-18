import type {
  ApplicationDatabaseBinding,
  ApplicationModelViewContext,
} from '@applik8s/applik8s';
import { type } from 'arktype';
import { and, desc, eq, ilike, or } from 'drizzle-orm';
import {
  applicationDocumentComments,
  applicationDocumentRevisions,
  applicationDocuments,
} from './schema.js';

export const applicationDocumentStateSchema =
  "'draft' | 'in-review' | 'approved' | 'published' | 'archived'";

export const applicationDocumentSummarySchema = type({
  id: 'string',
  principalScope: 'string',
  createdByPrincipalId: 'string',
  title: 'string',
  body: 'string',
  summary: 'string',
  tags: 'string[]',
  state: applicationDocumentStateSchema,
  contentType: 'string',
  version: 'number',
  revision: 'string',
  'sourceConversationId?': 'string',
  'sourceRunId?': 'string',
  'publishedAt?': 'string',
  'archivedAt?': 'string',
  createdAt: 'string',
  updatedAt: 'string',
});

export const applicationDocumentDetailSchema = type({
  document: applicationDocumentSummarySchema,
  revisions: type({
    id: 'string',
    revision: 'number',
    title: 'string',
    body: 'string',
    summary: 'string',
    tags: 'string[]',
    state: applicationDocumentStateSchema,
    authoredByPrincipalId: 'string',
    createdAt: 'string',
  }).array(),
  comments: type({
    id: 'string',
    documentId: 'string',
    principalScope: 'string',
    createdByPrincipalId: 'string',
    body: 'string',
    'resolvedAt?': 'string',
    'resolvedByPrincipalId?': 'string',
    createdAt: 'string',
    updatedAt: 'string',
    revision: 'string',
  }).array(),
});

export interface ApplicationDocumentQueryOptions<
  TSchema extends Readonly<Record<string, unknown>>,
> {
  readonly database: ApplicationDatabaseBinding<TSchema>;
  readonly scope: (context: ApplicationModelViewContext) => string;
}

export interface ApplicationDocumentListInput {
  readonly search?: string;
  readonly state?: 'draft' | 'in-review' | 'approved' | 'published' | 'archived';
}

export type ApplicationDocumentViewContext = ApplicationModelViewContext;

export async function listApplicationDocuments<
  TSchema extends Readonly<Record<string, unknown>>,
>(
  input: ApplicationDocumentListInput,
  context: ApplicationModelViewContext,
  options: ApplicationDocumentQueryOptions<TSchema>,
) {
  const search = input.search?.trim();
  const rows = await context.database(options.database)
    .select({
      id: applicationDocuments.id,
      principalScope: applicationDocuments.principalScope,
      createdByPrincipalId: applicationDocuments.createdByPrincipalId,
      title: applicationDocuments.title,
      body: applicationDocuments.body,
      summary: applicationDocuments.summary,
      tags: applicationDocuments.tags,
      state: applicationDocuments.state,
      contentType: applicationDocuments.contentType,
      version: applicationDocuments.version,
      revision: applicationDocuments.revision,
      sourceConversationId: applicationDocuments.sourceConversationId,
      sourceRunId: applicationDocuments.sourceRunId,
      publishedAt: applicationDocuments.publishedAt,
      archivedAt: applicationDocuments.archivedAt,
      createdAt: applicationDocuments.createdAt,
      updatedAt: applicationDocuments.updatedAt,
    })
    .from(applicationDocuments)
    .where(and(
      eq(applicationDocuments.principalScope, options.scope(context)),
      input.state ? eq(applicationDocuments.state, input.state) : undefined,
      search ? or(
        ilike(applicationDocuments.title, `%${search}%`),
        ilike(applicationDocuments.summary, `%${search}%`),
        ilike(applicationDocuments.body, `%${search}%`),
      ) : undefined,
    ))
    .orderBy(desc(applicationDocuments.updatedAt))
    .limit(200);
  return rows.map(optionalDocumentFields);
}

export async function loadApplicationDocument<
  TSchema extends Readonly<Record<string, unknown>>,
>(
  input: { readonly id: string },
  context: ApplicationModelViewContext,
  options: ApplicationDocumentQueryOptions<TSchema>,
) {
  const client = context.database(options.database);
  const [document] = await client
    .select()
    .from(applicationDocuments)
    .where(and(
      eq(applicationDocuments.id, input.id),
      eq(applicationDocuments.principalScope, options.scope(context)),
    ))
    .limit(1);
  if (!document) return null;
  const revisions = await client.select({
    id: applicationDocumentRevisions.id,
    revision: applicationDocumentRevisions.revision,
    title: applicationDocumentRevisions.title,
    body: applicationDocumentRevisions.body,
    summary: applicationDocumentRevisions.summary,
    tags: applicationDocumentRevisions.tags,
    state: applicationDocumentRevisions.state,
    authoredByPrincipalId: applicationDocumentRevisions.authoredByPrincipalId,
    createdAt: applicationDocumentRevisions.createdAt,
  }).from(applicationDocumentRevisions)
    .where(eq(applicationDocumentRevisions.documentId, document.id))
    .orderBy(desc(applicationDocumentRevisions.revision))
    .limit(100);
  const comments = await client.select({
    id: applicationDocumentComments.id,
    documentId: applicationDocumentComments.documentId,
    principalScope: applicationDocumentComments.principalScope,
    createdByPrincipalId: applicationDocumentComments.createdByPrincipalId,
    body: applicationDocumentComments.body,
    resolvedAt: applicationDocumentComments.resolvedAt,
    resolvedByPrincipalId: applicationDocumentComments.resolvedByPrincipalId,
    createdAt: applicationDocumentComments.createdAt,
    updatedAt: applicationDocumentComments.updatedAt,
    revision: applicationDocumentComments.revision,
  }).from(applicationDocumentComments)
    .where(and(
      eq(applicationDocumentComments.documentId, document.id),
      eq(applicationDocumentComments.principalScope, options.scope(context)),
    ))
    .orderBy(desc(applicationDocumentComments.createdAt))
    .limit(200);
  return {
    document: optionalDocumentFields(document),
    revisions,
    comments: comments.map(comment => {
      const { resolvedAt, resolvedByPrincipalId, ...required } = comment;
      return {
        ...required,
        ...(resolvedAt ? { resolvedAt } : {}),
        ...(resolvedByPrincipalId ? { resolvedByPrincipalId } : {}),
      };
    }),
  };
}

function optionalDocumentFields<T extends {
  readonly sourceConversationId: string | null;
  readonly sourceRunId: string | null;
  readonly publishedAt: string | null;
  readonly archivedAt: string | null;
}>(document: T) {
  const {
    sourceConversationId,
    sourceRunId,
    publishedAt,
    archivedAt,
    ...required
  } = document;
  return {
    ...required,
    ...(sourceConversationId ? { sourceConversationId } : {}),
    ...(sourceRunId ? { sourceRunId } : {}),
    ...(publishedAt ? { publishedAt } : {}),
    ...(archivedAt ? { archivedAt } : {}),
  };
}
