import {
  field,
  index,
  model,
  pgEnum,
  uniqueIndex,
} from '@applik8s/applik8s/drizzle';

export const applicationArtifactState = pgEnum('applik8s_artifact_state', [
  'pending',
  'available',
  'quarantined',
  'deleted',
]);

export const applicationArtifacts = model(
  'applik8s_artifacts',
  {
    id: field.text('id').primaryKey(),
    principalScope: field.text('principal_scope').notNull(),
    kind: field.text('kind').notNull(),
    mediaType: field.text('media_type').notNull(),
    state: applicationArtifactState('state').notNull().default('pending'),
    store: field.text('store').notNull(),
    objectKey: field.text('object_key').notNull(),
    sha256: field.text('sha256').notNull(),
    size: field.bigint('size', { mode: 'number' }).notNull(),
    conversationId: field.text('conversation_id'),
    protocolRunId: field.text('protocol_run_id'),
    agentRunId: field.text('agent_run_id'),
    workflowRunId: field.text('workflow_run_id'),
    invocationId: field.text('invocation_id'),
    provenance: field.jsonb('provenance').notNull(),
    retentionUntil: field.timestamp('retention_until', {
      withTimezone: true,
      mode: 'string',
    }),
    createdAt: field.timestamp('created_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull().defaultNow(),
    updatedAt: field.timestamp('updated_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('applik8s_artifacts_object_uidx').on(
      table.store,
      table.objectKey,
      table.sha256,
    ),
    index('applik8s_artifacts_scope_created_idx').on(
      table.principalScope,
      table.createdAt,
    ),
    index('applik8s_artifacts_run_idx').on(
      table.protocolRunId,
      table.createdAt,
    ),
  ],
  { name: 'Artifact', revision: false },
);

export const applicationArtifactSchema = Object.freeze({
  applicationArtifacts,
});
