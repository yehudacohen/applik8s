import type {
  ApplicationDatabaseBinding,
  KubernetesApplicationBuilder,
} from '@applik8s/applik8s';
import {
  bigint,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const applicationArtifactState = pgEnum('applik8s_artifact_state', [
  'pending',
  'available',
  'quarantined',
  'deleted',
]);

export const applicationArtifacts = pgTable(
  'applik8s_artifacts',
  {
    id: text('id').primaryKey(),
    principalScope: text('principal_scope').notNull(),
    kind: text('kind').notNull(),
    mediaType: text('media_type').notNull(),
    state: applicationArtifactState('state').notNull().default('pending'),
    store: text('store').notNull(),
    objectKey: text('object_key').notNull(),
    sha256: text('sha256').notNull(),
    size: bigint('size', { mode: 'number' }).notNull(),
    conversationId: text('conversation_id'),
    protocolRunId: text('protocol_run_id'),
    agentRunId: text('agent_run_id'),
    workflowRunId: text('workflow_run_id'),
    invocationId: text('invocation_id'),
    provenance: jsonb('provenance').notNull(),
    retentionUntil: timestamp('retention_until', {
      withTimezone: true,
      mode: 'string',
    }),
    createdAt: timestamp('created_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {
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
);

export const applicationArtifactSchema = Object.freeze({
  applicationArtifacts,
});

export interface ApplicationArtifactsModuleOptions {
  readonly database?: ApplicationDatabaseBinding;
}

export function artifacts(
  application: Pick<KubernetesApplicationBuilder, 'model'>,
  options: ApplicationArtifactsModuleOptions = {},
) {
  const Artifact = application.model(applicationArtifacts, {
    ...(options.database ? { database: options.database } : {}),
    name: 'Artifact',
    revision: false,
  });
  return Object.freeze({ Artifact });
}
