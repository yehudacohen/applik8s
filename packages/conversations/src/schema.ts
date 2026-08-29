import {
  field,
  index,
  model,
  pgEnum,
  relations,
  uniqueIndex,
} from '@applik8s/applik8s/drizzle';

export const applicationConversationRole = pgEnum(
  'applik8s_conversation_role',
  ['system', 'user', 'assistant', 'tool'],
);

export const applicationConversationMessageState = pgEnum(
  'applik8s_conversation_message_state',
  ['committed', 'rejected'],
);

export const applicationConversationRunState = pgEnum(
  'applik8s_conversation_run_state',
  ['running', 'interrupted', 'completed', 'failed', 'cancelled'],
);

export const applicationConversationEventVisibility = pgEnum(
  'applik8s_conversation_event_visibility',
  ['browser', 'audit-only'],
);

export const applicationConversations = model(
  'applik8s_conversations',
  {
    id: field.text('id').primaryKey(),
    principalScope: field.text('principal_scope').notNull(),
    title: field.text('title'),
    revision: field.bigint('revision', { mode: 'number' }).notNull().default(0),
    createdAt: field.timestamp('created_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull().defaultNow(),
    updatedAt: field.timestamp('updated_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull().defaultNow(),
    archivedAt: field.timestamp('archived_at', {
      withTimezone: true,
      mode: 'string',
    }),
    retentionUntil: field.timestamp('retention_until', {
      withTimezone: true,
      mode: 'string',
    }),
  },
  (table) => [
    index('applik8s_conversations_scope_updated_idx').on(
      table.principalScope,
      table.updatedAt,
    ),
  ],
  {
    name: 'Conversation',
    revision: false,
    runtimeRoles: ['applik8s.conversation-state/v1'],
  },
);

export const applicationConversationMessages = model(
  'applik8s_conversation_messages',
  {
    id: field.text('id').primaryKey(),
    conversationId: field.text('conversation_id')
      .notNull()
      .references(() => applicationConversations.id, {
        onDelete: 'cascade',
      }),
    revision: field.bigint('revision', { mode: 'number' }).notNull(),
    role: applicationConversationRole('role').notNull(),
    content: field.jsonb('content').notNull(),
    state: applicationConversationMessageState('state')
      .notNull()
      .default('committed'),
    invocationId: field.text('invocation_id'),
    createdAt: field.timestamp('created_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('applik8s_conversation_messages_revision_uidx').on(
      table.conversationId,
      table.revision,
    ),
    index('applik8s_conversation_messages_created_idx').on(
      table.conversationId,
      table.createdAt,
    ),
  ],
  { name: 'Message', revision: false },
);

export const applicationConversationRuns = model(
  'applik8s_conversation_runs',
  {
    id: field.text('id').primaryKey(),
    conversationId: field.text('conversation_id')
      .notNull()
      .references(() => applicationConversations.id, {
        onDelete: 'cascade',
      }),
    principalScope: field.text('principal_scope').notNull(),
    status: applicationConversationRunState('status').notNull(),
    agentRunId: field.text('agent_run_id'),
    invocationId: field.text('invocation_id'),
    startedAt: field.timestamp('started_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull().defaultNow(),
    updatedAt: field.timestamp('updated_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull().defaultNow(),
    terminalReason: field.text('terminal_reason'),
    runtimeState: field.jsonb('runtime_state'),
  },
  (table) => [
    index('applik8s_conversation_runs_scope_status_idx').on(
      table.principalScope,
      table.status,
      table.updatedAt,
    ),
    index('applik8s_conversation_runs_conversation_idx').on(
      table.conversationId,
      table.updatedAt,
    ),
  ],
  { name: 'ProtocolRun', revision: false },
);

export const applicationConversationRunEvents = model(
  'applik8s_conversation_run_events',
  {
    id: field.text('id').primaryKey(),
    runId: field.text('run_id')
      .notNull()
      .references(() => applicationConversationRuns.id, {
        onDelete: 'cascade',
      }),
    sequence: field.bigint('sequence', { mode: 'number' }).notNull(),
    type: field.text('type').notNull(),
    payload: field.jsonb('payload').notNull(),
    visibility: applicationConversationEventVisibility('visibility').notNull(),
    createdAt: field.timestamp('created_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('applik8s_conversation_run_events_sequence_uidx').on(
      table.runId,
      table.sequence,
    ),
    index('applik8s_conversation_run_events_created_idx').on(
      table.runId,
      table.createdAt,
    ),
  ],
  { name: 'RunEvent', revision: false },
);

export const applicationConversationMemory = model(
  'applik8s_conversation_memory',
  {
    id: field.text('id').primaryKey(),
    principalScope: field.text('principal_scope').notNull(),
    conversationId: field.text('conversation_id').references(
      () => applicationConversations.id,
      { onDelete: 'cascade' },
    ),
    namespace: field.text('namespace').notNull(),
    revision: field.integer('revision').notNull().default(1),
    content: field.jsonb('content').notNull(),
    retentionUntil: field.timestamp('retention_until', {
      withTimezone: true,
      mode: 'string',
    }).notNull(),
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
    index('applik8s_conversation_memory_scope_namespace_idx').on(
      table.principalScope,
      table.namespace,
      table.retentionUntil,
    ),
  ],
  { name: 'Memory', revision: false },
);

export const applicationConversationRelations = relations(
  applicationConversations,
  ({ many }) => ({
    messages: many(applicationConversationMessages),
    runs: many(applicationConversationRuns),
    memory: many(applicationConversationMemory),
  }),
);

export const applicationConversationMessageRelations = relations(
  applicationConversationMessages,
  ({ one }) => ({
    conversation: one(applicationConversations, {
      fields: [applicationConversationMessages.conversationId],
      references: [applicationConversations.id],
    }),
  }),
);

export const applicationConversationRunRelations = relations(
  applicationConversationRuns,
  ({ many, one }) => ({
    conversation: one(applicationConversations, {
      fields: [applicationConversationRuns.conversationId],
      references: [applicationConversations.id],
    }),
    events: many(applicationConversationRunEvents),
  }),
);

export const applicationConversationRunEventRelations = relations(
  applicationConversationRunEvents,
  ({ one }) => ({
    run: one(applicationConversationRuns, {
      fields: [applicationConversationRunEvents.runId],
      references: [applicationConversationRuns.id],
    }),
  }),
);

export const applicationConversationMemoryRelations = relations(
  applicationConversationMemory,
  ({ one }) => ({
    conversation: one(applicationConversations, {
      fields: [applicationConversationMemory.conversationId],
      references: [applicationConversations.id],
    }),
  }),
);

export const applicationConversationSchema = Object.freeze({
  applicationConversations,
  applicationConversationMessages,
  applicationConversationRuns,
  applicationConversationRunEvents,
  applicationConversationMemory,
  applicationConversationRelations,
  applicationConversationMessageRelations,
  applicationConversationRunRelations,
  applicationConversationRunEventRelations,
  applicationConversationMemoryRelations,
});
