import type {
  ApplicationDatabaseBinding,
  ApplicationModelViewContext,
} from '@applik8s/applik8s';
import { type } from 'arktype';
import { and, desc, eq } from 'drizzle-orm';
import { applicationArtifacts } from './schema.js';

export const applicationArtifactLibrarySchema = type({
  artifacts: type({
    id: 'string',
    'title?': 'string',
    kind: 'string',
    mediaType: 'string',
    state: 'string',
    sha256: 'string',
    size: 'number',
    'conversationId?': 'string',
    createdAt: 'string',
  }).array(),
});

export const applicationArtifactDetailSchema = type({
  id: 'string',
  'title?': 'string',
  kind: 'string',
  mediaType: 'string',
  state: 'string',
  sha256: 'string',
  size: 'number',
  'conversationId?': 'string',
  'protocolRunId?': 'string',
  'agentRunId?': 'string',
  'workflowRunId?': 'string',
  'invocationId?': 'string',
  provenance: 'object',
  'retentionUntil?': 'string',
  createdAt: 'string',
  updatedAt: 'string',
}).or('null');

export const applicationArtifactDownloadTargetSchema = type({
  objectKey: 'string',
  mediaType: 'string',
  title: 'string',
}).or('null');

export interface ApplicationArtifactQueryOptions<TSchema extends Readonly<Record<string, unknown>>> {
  readonly database: ApplicationDatabaseBinding<TSchema>;
  readonly scope: (context: ApplicationModelViewContext) => string;
  readonly title?: (provenance: unknown) => string | undefined;
}

export async function listApplicationArtifacts<TSchema extends Readonly<Record<string, unknown>>>(
  _input: object,
  context: ApplicationModelViewContext,
  options: ApplicationArtifactQueryOptions<TSchema>,
) {
  const rows = await context.database(options.database).select({
    id: applicationArtifacts.id,
    kind: applicationArtifacts.kind,
    mediaType: applicationArtifacts.mediaType,
    state: applicationArtifacts.state,
    sha256: applicationArtifacts.sha256,
    size: applicationArtifacts.size,
    conversationId: applicationArtifacts.conversationId,
    provenance: applicationArtifacts.provenance,
    createdAt: applicationArtifacts.createdAt,
  }).from(applicationArtifacts)
    .where(eq(applicationArtifacts.principalScope, options.scope(context)))
    .orderBy(desc(applicationArtifacts.createdAt))
    .limit(100);
  return {
    artifacts: rows.map(row => ({
      id: row.id,
      ...optionalTitle(options.title?.(row.provenance)),
      kind: row.kind,
      mediaType: row.mediaType,
      state: row.state,
      sha256: row.sha256,
      size: row.size,
      createdAt: row.createdAt,
      ...(row.conversationId ? { conversationId: row.conversationId } : {}),
    })),
  };
}

export async function loadApplicationArtifact<TSchema extends Readonly<Record<string, unknown>>>(
  input: { readonly id: string },
  context: ApplicationModelViewContext,
  options: ApplicationArtifactQueryOptions<TSchema>,
) {
  const [artifact] = await context.database(options.database).select({
    id: applicationArtifacts.id,
    kind: applicationArtifacts.kind,
    mediaType: applicationArtifacts.mediaType,
    state: applicationArtifacts.state,
    sha256: applicationArtifacts.sha256,
    size: applicationArtifacts.size,
    conversationId: applicationArtifacts.conversationId,
    protocolRunId: applicationArtifacts.protocolRunId,
    agentRunId: applicationArtifacts.agentRunId,
    workflowRunId: applicationArtifacts.workflowRunId,
    invocationId: applicationArtifacts.invocationId,
    provenance: applicationArtifacts.provenance,
    retentionUntil: applicationArtifacts.retentionUntil,
    createdAt: applicationArtifacts.createdAt,
    updatedAt: applicationArtifacts.updatedAt,
  }).from(applicationArtifacts).where(and(
    eq(applicationArtifacts.id, input.id),
    eq(applicationArtifacts.principalScope, options.scope(context)),
  )).limit(1);
  if (!artifact) return null;
  return {
    id: artifact.id,
    ...optionalTitle(options.title?.(artifact.provenance)),
    kind: artifact.kind,
    mediaType: artifact.mediaType,
    state: artifact.state,
    sha256: artifact.sha256,
    size: artifact.size,
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
    provenance: artifact.provenance,
    ...(artifact.conversationId ? { conversationId: artifact.conversationId } : {}),
    ...(artifact.protocolRunId ? { protocolRunId: artifact.protocolRunId } : {}),
    ...(artifact.agentRunId ? { agentRunId: artifact.agentRunId } : {}),
    ...(artifact.workflowRunId ? { workflowRunId: artifact.workflowRunId } : {}),
    ...(artifact.invocationId ? { invocationId: artifact.invocationId } : {}),
    ...(artifact.retentionUntil ? { retentionUntil: artifact.retentionUntil } : {}),
  };
}

export async function loadApplicationArtifactDownloadTarget<TSchema extends Readonly<Record<string, unknown>>>(
  input: { readonly id: string },
  context: ApplicationModelViewContext,
  options: ApplicationArtifactQueryOptions<TSchema>,
) {
  const [artifact] = await context.database(options.database).select({
    objectKey: applicationArtifacts.objectKey,
    mediaType: applicationArtifacts.mediaType,
    provenance: applicationArtifacts.provenance,
  }).from(applicationArtifacts).where(and(
    eq(applicationArtifacts.id, input.id),
    eq(applicationArtifacts.principalScope, options.scope(context)),
    eq(applicationArtifacts.state, 'available'),
  )).limit(1);
  if (!artifact) return null;
  return {
    objectKey: artifact.objectKey,
    mediaType: artifact.mediaType,
    title: options.title?.(artifact.provenance) ?? 'artifact',
  };
}

export function applicationArtifactSafeFileName(value: string): string {
  const normalized = value.trim().toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 80);
  return normalized || 'artifact';
}

function optionalTitle(title: string | undefined) {
  return title?.trim() ? { title } : {};
}
