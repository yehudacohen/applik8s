import { relations } from 'drizzle-orm';
import {
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

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

export const applicationConversations = pgTable(
  'applik8s_conversations',
  {
    id: text('id').primaryKey(),
    principalScope: text('principal_scope').notNull(),
    title: text('title'),
    revision: bigint('revision', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull().defaultNow(),
    retentionUntil: timestamp('retention_until', {
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
);

export const applicationConversationMessages = pgTable(
  'applik8s_conversation_messages',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => applicationConversations.id, {
        onDelete: 'cascade',
      }),
    revision: bigint('revision', { mode: 'number' }).notNull(),
    role: applicationConversationRole('role').notNull(),
    content: jsonb('content').notNull(),
    state: applicationConversationMessageState('state')
      .notNull()
      .default('committed'),
    invocationId: text('invocation_id'),
    createdAt: timestamp('created_at', {
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
);

export const applicationConversationRuns = pgTable(
  'applik8s_conversation_runs',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => applicationConversations.id, {
        onDelete: 'cascade',
      }),
    principalScope: text('principal_scope').notNull(),
    status: applicationConversationRunState('status').notNull(),
    agentRunId: text('agent_run_id'),
    invocationId: text('invocation_id'),
    startedAt: timestamp('started_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull().defaultNow(),
    terminalReason: text('terminal_reason'),
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
);

export const applicationConversationRunEvents = pgTable(
  'applik8s_conversation_run_events',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => applicationConversationRuns.id, {
        onDelete: 'cascade',
      }),
    sequence: bigint('sequence', { mode: 'number' }).notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    visibility: applicationConversationEventVisibility('visibility').notNull(),
    createdAt: timestamp('created_at', {
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
);

export const applicationConversationMemory = pgTable(
  'applik8s_conversation_memory',
  {
    id: text('id').primaryKey(),
    principalScope: text('principal_scope').notNull(),
    conversationId: text('conversation_id').references(
      () => applicationConversations.id,
      { onDelete: 'cascade' },
    ),
    namespace: text('namespace').notNull(),
    revision: integer('revision').notNull().default(1),
    content: jsonb('content').notNull(),
    retentionUntil: timestamp('retention_until', {
      withTimezone: true,
      mode: 'string',
    }).notNull(),
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
    index('applik8s_conversation_memory_scope_namespace_idx').on(
      table.principalScope,
      table.namespace,
      table.retentionUntil,
    ),
  ],
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
