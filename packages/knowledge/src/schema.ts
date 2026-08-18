import type { ApplicationRelationalModel } from '@applik8s/applik8s';
import { causalPrincipalId, field, index, model, pgEnum } from '@applik8s/applik8s/drizzle';

export const applicationKnowledgeSourceState = pgEnum('knowledge_source_state', [
  'processing',
  'ready',
  'failed',
  'disabled',
]);

const knowledgeSourceTable = model('knowledge_sources', {
  id: field.uuid('id').defaultRandom().primaryKey(),
  principalScope: field.text('principal_scope').notNull().default(causalPrincipalId),
  title: field.text('title').notNull(),
  kind: field.text('kind').notNull().default('text'),
  content: field.text('content').notNull().default(''),
  sourceUrl: field.text('source_url'),
  objectKey: field.text('object_key'),
  mediaType: field.text('media_type'),
  size: field.integer('size'),
  sha256: field.text('sha256'),
  uploadReceipt: field.text('upload_receipt'),
  processingStage: field.text('processing_stage'),
  indexedAt: field.timestamp('indexed_at', { withTimezone: true, mode: 'string' }),
  chunkCount: field.integer('chunk_count'),
  failureReason: field.text('failure_reason'),
  state: applicationKnowledgeSourceState('state').notNull().default('ready'),
  createdAt: field.timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: field.timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}, table => [
  index('knowledge_sources_scope_state_idx').on(table.principalScope, table.state),
], { name: 'KnowledgeSource', revision: false });

export const applicationKnowledgeSources: ApplicationRelationalModel<typeof knowledgeSourceTable> = knowledgeSourceTable;
export const applicationKnowledgeSchema = Object.freeze({ applicationKnowledgeSources });
