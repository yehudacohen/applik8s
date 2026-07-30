// typecast-file-boundary: PostgreSQL JSON values are accepted only after row
// identity, scope, revision, and enum discriminators have been validated.

import type {
  ApplicationAIConversationRecord,
  ApplicationAIMessageRecord,
  ApplicationAIProtocolRunRecord,
  ApplicationAIRunEventRecord,
} from '@applik8s/ai';
import type { ApplicationPostgresSql } from '@applik8s/applik8s/postgres-runtime-contract';
import {
  ApplicationConversationConflictError,
  type ApplicationConversationStore,
} from './contracts.js';

export interface PostgresApplicationConversationStoreOptions {
  readonly sql: ApplicationPostgresSql;
  readonly schema?: string;
}

export function createPostgresApplicationConversationStore(
  options: PostgresApplicationConversationStoreOptions,
): ApplicationConversationStore & { readonly prepare: () => Promise<void> } {
  const tables = tableNames(options.schema ?? 'public');
  let preparation: Promise<void> | undefined;
  const prepare = () => {
    preparation ??= prepareConversationStore(options.sql, tables).catch(
      (error) => {
        preparation = undefined;
        throw error;
      },
    );
    return preparation;
  };

  const store: ApplicationConversationStore = {
    async createConversation(conversation) {
      await prepare();
      const rows = await options.sql.unsafe(
        `INSERT INTO ${tables.conversations}
          (id, principal_scope, revision, created_at, updated_at)
         VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz)
         ON CONFLICT (id) DO NOTHING
         RETURNING *`,
        [
          conversation.id,
          conversation.principalScope,
          conversation.revision,
          conversation.createdAt,
          conversation.updatedAt,
        ],
      );
      const created = conversationRecord(rows[0]);
      if (!created) {
        throw new ApplicationConversationConflictError(
          `Conversation ${conversation.id} already exists.`,
        );
      }
      return created;
    },

    async getConversation(id, principalScope) {
      await prepare();
      return conversationRecord(
        (
          await options.sql.unsafe(
            `SELECT * FROM ${tables.conversations}
             WHERE id = $1 AND principal_scope = $2`,
            [id, principalScope],
          )
        )[0],
      );
    },

    async appendMessage(input) {
      await prepare();
      return options.sql.begin(async (transaction) => {
        const conversations = await transaction.unsafe(
          `UPDATE ${tables.conversations}
           SET revision = revision + 1, updated_at = $4::timestamptz
           WHERE id = $1 AND principal_scope = $2 AND revision = $3
           RETURNING *`,
          [
            input.conversationId,
            input.principalScope,
            input.expectedRevision,
            input.message.createdAt,
          ],
        );
        const conversation = conversationRecord(conversations[0]);
        if (!conversation) {
          throw new ApplicationConversationConflictError(
            `Conversation ${input.conversationId} is absent, outside the admitted scope, or no longer at revision ${input.expectedRevision}.`,
          );
        }
        const rows = await transaction.unsafe(
          `INSERT INTO ${tables.messages}
            (id, conversation_id, revision, role, content, state,
             invocation_id, created_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::timestamptz)
           ON CONFLICT (id) DO NOTHING
           RETURNING *`,
          [
            input.message.id,
            input.conversationId,
            conversation.revision,
            input.message.role,
            JSON.stringify(input.message.content),
            input.message.state ?? 'committed',
            input.message.invocationId ?? null,
            input.message.createdAt,
          ],
        );
        const message = messageRecord(rows[0]);
        if (!message) {
          throw new ApplicationConversationConflictError(
            `Message ${input.message.id} already exists.`,
          );
        }
        return { conversation, message };
      });
    },

    async listMessages(input) {
      await prepare();
      assertLimit(input.limit);
      return (
        await options.sql.unsafe(
          `SELECT message.*
           FROM ${tables.messages} AS message
           JOIN ${tables.conversations} AS conversation
             ON conversation.id = message.conversation_id
           WHERE message.conversation_id = $1
             AND conversation.principal_scope = $2
             AND message.revision > $3
           ORDER BY message.revision
           LIMIT $4`,
          [
            input.conversationId,
            input.principalScope,
            input.afterRevision ?? 0,
            input.limit,
          ],
        )
      ).map((row) => required(messageRecord(row), 'message'));
    },

    async startRun(run) {
      await prepare();
      const rows = await options.sql.unsafe(
        `INSERT INTO ${tables.runs}
          (id, conversation_id, principal_scope, status, agent_run_id,
           invocation_id, started_at, updated_at)
         SELECT $1, conversation.id, $3, 'running', $4, $5,
                $6::timestamptz, $6::timestamptz
         FROM ${tables.conversations} AS conversation
         WHERE conversation.id = $2 AND conversation.principal_scope = $3
         ON CONFLICT (id) DO NOTHING
         RETURNING *`,
        [
          run.id,
          run.conversationId,
          run.principalScope,
          run.agentRunId ?? null,
          run.invocationId ?? null,
          run.startedAt,
        ],
      );
      const created = runRecord(rows[0]);
      if (!created) {
        throw new ApplicationConversationConflictError(
          `Run ${run.id} already exists or its conversation is outside the admitted scope.`,
        );
      }
      return created;
    },

    async transitionRun(input) {
      await prepare();
      assertRunTransition(input.from, input.to);
      const rows = await options.sql.unsafe(
        `UPDATE ${tables.runs}
         SET status = $4, updated_at = $5::timestamptz
         WHERE id = $1 AND principal_scope = $2 AND status = $3
         RETURNING *`,
        [
          input.runId,
          input.principalScope,
          input.from,
          input.to,
          input.updatedAt,
        ],
      );
      const transitioned = runRecord(rows[0]);
      if (!transitioned) {
        throw new ApplicationConversationConflictError(
          `Run ${input.runId} is absent, outside the admitted scope, or no longer ${input.from}.`,
        );
      }
      return transitioned;
    },

    async appendRunEvent(input) {
      await prepare();
      const sequence = input.expectedSequence + 1;
      return options.sql.begin(async (transaction) => {
        const runs = await transaction.unsafe(
          `SELECT id FROM ${tables.runs}
           WHERE id = $1 AND principal_scope = $2
           FOR UPDATE`,
          [input.runId, input.principalScope],
        );
        if (!runs[0]) {
          throw new ApplicationConversationConflictError(
            `Run ${input.runId} is absent or outside the admitted scope.`,
          );
        }
        const frontiers = await transaction.unsafe(
          `SELECT COALESCE(MAX(sequence), 0) AS sequence
           FROM ${tables.events}
           WHERE run_id = $1`,
          [input.runId],
        );
        if (numberValue(frontiers[0]?.sequence) !== input.expectedSequence) {
          throw new ApplicationConversationConflictError(
            `Run ${input.runId} is no longer at event sequence ${input.expectedSequence}.`,
          );
        }
        const rows = await transaction.unsafe(
          `INSERT INTO ${tables.events}
            (id, run_id, sequence, type, payload, visibility, created_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::timestamptz)
           RETURNING *`,
          [
            `${input.runId}:${sequence}`,
            input.runId,
            sequence,
            input.event.type,
            JSON.stringify(input.event.payload),
            input.event.visibility,
            input.event.createdAt,
          ],
        );
        return required(runEventRecord(rows[0]), 'run event');
      });
    },

    async listRunEvents(input) {
      await prepare();
      assertLimit(input.limit);
      const visibilityClause = input.visibility
        ? 'AND event.visibility = $5'
        : '';
      return (
        await options.sql.unsafe(
          `SELECT event.*
           FROM ${tables.events} AS event
           JOIN ${tables.runs} AS run ON run.id = event.run_id
           WHERE event.run_id = $1
             AND run.principal_scope = $2
             AND event.sequence > $3
             ${visibilityClause}
           ORDER BY event.sequence
           LIMIT $4`,
          [
            input.runId,
            input.principalScope,
            input.afterSequence ?? 0,
            input.limit,
            ...(input.visibility ? [input.visibility] : []),
          ],
        )
      ).map((row) => required(runEventRecord(row), 'run event'));
    },
  };
  return Object.freeze({ ...store, prepare });
}

interface ConversationTableNames {
  readonly conversations: string;
  readonly messages: string;
  readonly runs: string;
  readonly events: string;
}

function tableNames(schema: string): ConversationTableNames {
  const namespace = quoteIdentifier(schema);
  return {
    conversations: `${namespace}."applik8s_conversations"`,
    messages: `${namespace}."applik8s_conversation_messages"`,
    runs: `${namespace}."applik8s_conversation_runs"`,
    events: `${namespace}."applik8s_conversation_run_events"`,
  };
}

async function prepareConversationStore(
  sql: ApplicationPostgresSql,
  tables: ConversationTableNames,
): Promise<void> {
  await sql.unsafe(
    `CREATE TABLE IF NOT EXISTS ${tables.conversations} (
      id text PRIMARY KEY,
      principal_scope text NOT NULL,
      revision bigint NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL
    )`,
  );
  await sql.unsafe(
    `CREATE TABLE IF NOT EXISTS ${tables.messages} (
      id text PRIMARY KEY,
      conversation_id text NOT NULL REFERENCES ${tables.conversations}(id) ON DELETE CASCADE,
      revision bigint NOT NULL,
      role text NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
      content jsonb NOT NULL,
      state text NOT NULL CHECK (state IN ('committed', 'rejected')),
      invocation_id text,
      created_at timestamptz NOT NULL,
      UNIQUE (conversation_id, revision)
    )`,
  );
  await sql.unsafe(
    `CREATE TABLE IF NOT EXISTS ${tables.runs} (
      id text PRIMARY KEY,
      conversation_id text NOT NULL REFERENCES ${tables.conversations}(id) ON DELETE CASCADE,
      principal_scope text NOT NULL,
      status text NOT NULL CHECK (status IN ('running', 'interrupted', 'completed', 'failed', 'cancelled')),
      agent_run_id text,
      invocation_id text,
      started_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL
    )`,
  );
  await sql.unsafe(
    `CREATE TABLE IF NOT EXISTS ${tables.events} (
      id text PRIMARY KEY,
      run_id text NOT NULL REFERENCES ${tables.runs}(id) ON DELETE CASCADE,
      sequence bigint NOT NULL,
      type text NOT NULL,
      payload jsonb NOT NULL,
      visibility text NOT NULL CHECK (visibility IN ('browser', 'audit-only')),
      created_at timestamptz NOT NULL,
      UNIQUE (run_id, sequence)
    )`,
  );
}

function conversationRecord(
  row: Record<string, unknown> | undefined,
): ApplicationAIConversationRecord | undefined {
  if (!row) return undefined;
  const id = stringValue(row.id);
  const principalScope = stringValue(row.principal_scope);
  const revision = numberValue(row.revision);
  const createdAt = isoValue(row.created_at);
  const updatedAt = isoValue(row.updated_at);
  if (!id || !principalScope || revision < 0 || !createdAt || !updatedAt) {
    throw new Error('PostgreSQL returned an invalid conversation row.');
  }
  return {
    apiVersion: 'applik8s.aiConversation/v1alpha1',
    id,
    principalScope,
    revision,
    createdAt,
    updatedAt,
  };
}

function messageRecord(
  row: Record<string, unknown> | undefined,
): ApplicationAIMessageRecord | undefined {
  if (!row) return undefined;
  const id = stringValue(row.id);
  const conversationId = stringValue(row.conversation_id);
  const revision = numberValue(row.revision);
  const role = row.role;
  const state = row.state;
  const createdAt = isoValue(row.created_at);
  if (
    !id
    || !conversationId
    || revision < 1
    || !isRole(role)
    || !isMessageState(state)
    || !createdAt
    || !isJson(row.content)
  ) {
    throw new Error('PostgreSQL returned an invalid conversation message row.');
  }
  const invocationId = stringValue(row.invocation_id);
  return {
    apiVersion: 'applik8s.aiMessage/v1alpha1',
    id,
    conversationId,
    revision,
    role,
    content: row.content,
    state,
    ...(invocationId ? { invocationId } : {}),
    createdAt,
  };
}

function runRecord(
  row: Record<string, unknown> | undefined,
): ApplicationAIProtocolRunRecord | undefined {
  if (!row) return undefined;
  const id = stringValue(row.id);
  const conversationId = stringValue(row.conversation_id);
  const principalScope = stringValue(row.principal_scope);
  const status = row.status;
  const startedAt = isoValue(row.started_at);
  const updatedAt = isoValue(row.updated_at);
  if (
    !id
    || !conversationId
    || !principalScope
    || !isRunState(status)
    || !startedAt
    || !updatedAt
  ) {
    throw new Error('PostgreSQL returned an invalid conversation run row.');
  }
  const agentRunId = stringValue(row.agent_run_id);
  const invocationId = stringValue(row.invocation_id);
  return {
    apiVersion: 'applik8s.aiProtocolRun/v1alpha1',
    id,
    conversationId,
    principalScope,
    status,
    ...(agentRunId ? { agentRunId } : {}),
    ...(invocationId ? { invocationId } : {}),
    startedAt,
    updatedAt,
  };
}

function runEventRecord(
  row: Record<string, unknown> | undefined,
): ApplicationAIRunEventRecord | undefined {
  if (!row) return undefined;
  const runId = stringValue(row.run_id);
  const sequence = numberValue(row.sequence);
  const type = stringValue(row.type);
  const visibility = row.visibility;
  const createdAt = isoValue(row.created_at);
  if (
    !runId
    || sequence < 1
    || !type
    || !isEventVisibility(visibility)
    || !createdAt
    || !isJsonObject(row.payload)
  ) {
    throw new Error('PostgreSQL returned an invalid conversation run event.');
  }
  return {
    apiVersion: 'applik8s.aiRunEvent/v1alpha1',
    runId,
    sequence,
    type,
    payload: row.payload,
    visibility,
    createdAt,
  };
}

function assertRunTransition(
  from: ApplicationAIProtocolRunRecord['status'],
  to: ApplicationAIProtocolRunRecord['status'],
): void {
  const allowed: Readonly<Record<
    ApplicationAIProtocolRunRecord['status'],
    readonly ApplicationAIProtocolRunRecord['status'][]
  >> = {
    running: ['interrupted', 'completed', 'failed', 'cancelled'],
    interrupted: ['running', 'failed', 'cancelled'],
    completed: [],
    failed: [],
    cancelled: [],
  };
  if (!allowed[from].includes(to)) {
    throw new ApplicationConversationConflictError(
      `Conversation run cannot transition from ${from} to ${to}.`,
    );
  }
}

function assertLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error('Conversation page limit must be between 1 and 1000.');
  }
}

function quoteIdentifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value)) {
    throw new Error(`PostgreSQL schema ${JSON.stringify(value)} is invalid.`);
  }
  return `"${value.replaceAll('"', '""')}"`;
}

function required<T>(value: T | undefined, kind: string): T {
  if (!value) throw new Error(`PostgreSQL did not return the inserted ${kind}.`);
  return value;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(number) ? number : -1;
}

function isoValue(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString();
  if (
    typeof value === 'string'
    && value.length > 0
    && Number.isFinite(Date.parse(value))
  ) {
    return new Date(value).toISOString();
  }
  return undefined;
}

function isRole(value: unknown): value is ApplicationAIMessageRecord['role'] {
  return (
    value === 'system'
    || value === 'user'
    || value === 'assistant'
    || value === 'tool'
  );
}

function isMessageState(
  value: unknown,
): value is ApplicationAIMessageRecord['state'] {
  return value === 'committed' || value === 'rejected';
}

function isRunState(
  value: unknown,
): value is ApplicationAIProtocolRunRecord['status'] {
  return (
    value === 'running'
    || value === 'interrupted'
    || value === 'completed'
    || value === 'failed'
    || value === 'cancelled'
  );
}

function isEventVisibility(
  value: unknown,
): value is ApplicationAIRunEventRecord['visibility'] {
  return value === 'browser' || value === 'audit-only';
}

function isJson(value: unknown): value is ApplicationAIMessageRecord['content'] {
  if (value === null) return true;
  if (
    typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isJson);
  return isJsonObject(value);
}

function isJsonObject(
  value: unknown,
): value is ApplicationAIRunEventRecord['payload'] {
  return (
    Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.values(value as Record<string, unknown>).every(isJson)
  );
}
