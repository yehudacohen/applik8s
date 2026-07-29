// typecast-file-boundary: PostgreSQL JSONB rows are loaded into an isolated
// invocation transaction and validated by the AI attempt runtime before
// protocol records are committed back to durable storage.

import type {
  ApplicationAIAttemptRecord,
  ApplicationAIAttemptStore,
  ApplicationAIAttemptTransaction,
  ApplicationAIInvocationRecord,
  ApplicationAIStreamDelta,
  ApplicationAIToolProposalRecord,
} from '@applik8s/ai';
import type { JSONValue, Sql, TransactionSql } from 'postgres';

export interface PostgresApplicationAIAttemptStoreOptions {
  readonly sql: Sql;
  readonly schema?: string;
}

/**
 * Durable transactional storage for logical invocations, physical attempts,
 * stream deltas, and provider tool-call identities. One PostgreSQL advisory
 * transaction lock serializes every mutation for a logical invocation.
 */
export function createPostgresApplicationAIAttemptStore(
  options: PostgresApplicationAIAttemptStoreOptions,
): ApplicationAIAttemptStore & { readonly prepare: () => Promise<void> } {
  const names = tableNames(options.schema ?? 'public');
  let prepared: Promise<void> | undefined;
  const prepare = () => {
    prepared ??= prepareStore(options.sql, names).catch((error) => {
      prepared = undefined;
      throw error;
    });
    return prepared;
  };
  return Object.freeze({
    prepare,
    async transact<T>(
      invocationId: string,
      operation: (
        transaction: ApplicationAIAttemptTransaction,
      ) => Promise<T> | T,
    ): Promise<T> {
      if (!invocationId.trim()) {
        throw new Error('AI attempt storage requires a non-empty invocation ID.');
      }
      await prepare();
      const outcome = await options.sql.begin(async (sql) => {
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${invocationId}, 0))`;
        const state = await loadInvocationState(sql, names, invocationId);
        const transaction = applicationAIAttemptTransaction(state);
        const result = await operation(transaction);
        await persistInvocationState(sql, names, state);
        return { result };
      });
      return outcome.result;
    },
  });
}

interface AttemptStoreNames {
  readonly invocations: string;
  readonly attempts: string;
  readonly deltas: string;
  readonly proposals: string;
}

interface AttemptStoreState {
  readonly invocationId: string;
  invocation?: ApplicationAIInvocationRecord;
  readonly attempts: Map<string, ApplicationAIAttemptRecord>;
  readonly deltas: Map<string, Map<number, ApplicationAIStreamDelta>>;
  readonly proposals: Map<string, ApplicationAIToolProposalRecord>;
  invocationDirty: boolean;
  readonly dirtyAttempts: Set<string>;
  readonly dirtyDeltas: Set<string>;
  readonly dirtyProposals: Set<string>;
}

function applicationAIAttemptTransaction(
  state: AttemptStoreState,
): ApplicationAIAttemptTransaction {
  return {
    getInvocation: () => state.invocation,
    putInvocation(record) {
      if (record.id !== state.invocationId) {
        throw new Error(
          `AI invocation transaction ${state.invocationId} cannot store ${record.id}.`,
        );
      }
      state.invocation = structuredClone(record);
      state.invocationDirty = true;
    },
    listAttempts: () =>
      [...state.attempts.values()].map((attempt) => structuredClone(attempt)),
    getAttempt: (attemptId) => clone(state.attempts.get(attemptId)),
    putAttempt(record) {
      if (record.invocationId !== state.invocationId) {
        throw new Error(
          `AI attempt ${record.id} belongs to ${record.invocationId}, not ${state.invocationId}.`,
        );
      }
      state.attempts.set(record.id, structuredClone(record));
      state.dirtyAttempts.add(record.id);
    },
    appendDelta(delta) {
      const attempt = state.attempts.get(delta.attemptId);
      if (!attempt || attempt.invocationId !== state.invocationId) {
        throw new Error(
          `AI stream delta references unavailable attempt ${delta.attemptId}.`,
        );
      }
      const attemptDeltas = state.deltas.get(delta.attemptId) ?? new Map();
      const existing = attemptDeltas.get(delta.sequence);
      if (existing && JSON.stringify(existing) !== JSON.stringify(delta)) {
        throw new Error(
          `AI stream delta ${delta.attemptId}/${delta.sequence} conflicts with durable state.`,
        );
      }
      attemptDeltas.set(delta.sequence, structuredClone(delta));
      state.deltas.set(delta.attemptId, attemptDeltas);
      state.dirtyDeltas.add(`${delta.attemptId}\u0000${delta.sequence}`);
    },
    listDeltas(attemptId, afterSequence = 0) {
      return [...(state.deltas.get(attemptId)?.values() ?? [])]
        .filter((delta) => delta.sequence > afterSequence)
        .sort((left, right) => left.sequence - right.sequence)
        .map((delta) => structuredClone(delta));
    },
    getToolProposal(attemptId, providerToolCallId) {
      return clone(
        state.proposals.get(proposalKey(attemptId, providerToolCallId)),
      );
    },
    putToolProposal(record) {
      const attempt = state.attempts.get(record.attemptId);
      if (!attempt || attempt.invocationId !== state.invocationId) {
        throw new Error(
          `AI tool proposal ${record.id} references unavailable attempt ${record.attemptId}.`,
        );
      }
      const key = proposalKey(record.attemptId, record.providerToolCallId);
      state.proposals.set(key, structuredClone(record));
      state.dirtyProposals.add(key);
    },
  };
}

async function prepareStore(sql: Sql, names: AttemptStoreNames): Promise<void> {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ${names.invocations} (
      id text PRIMARY KEY,
      record jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS ${names.attempts} (
      id text PRIMARY KEY,
      invocation_id text NOT NULL REFERENCES ${names.invocations}(id) ON DELETE CASCADE,
      ordinal integer NOT NULL,
      record jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (invocation_id, ordinal)
    );
    CREATE INDEX IF NOT EXISTS ${indexName(names.attempts, 'invocation')}
      ON ${names.attempts} (invocation_id);
    CREATE TABLE IF NOT EXISTS ${names.deltas} (
      attempt_id text NOT NULL REFERENCES ${names.attempts}(id) ON DELETE CASCADE,
      sequence integer NOT NULL,
      record jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (attempt_id, sequence)
    );
    CREATE TABLE IF NOT EXISTS ${names.proposals} (
      attempt_id text NOT NULL REFERENCES ${names.attempts}(id) ON DELETE CASCADE,
      provider_tool_call_id text NOT NULL,
      record jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (attempt_id, provider_tool_call_id)
    )
  `);
}

async function loadInvocationState(
  sql: TransactionSql,
  names: AttemptStoreNames,
  invocationId: string,
): Promise<AttemptStoreState> {
  const invocationRows = await sql.unsafe(
    `SELECT record FROM ${names.invocations} WHERE id = $1`,
    [invocationId],
  );
  const attemptRows = await sql.unsafe(
    `SELECT id, record FROM ${names.attempts} WHERE invocation_id = $1 ORDER BY ordinal`,
    [invocationId],
  );
  const attemptIds = attemptRows.map((row) => String(row.id));
  const deltaRows = attemptIds.length === 0
    ? []
    : await sql.unsafe(
        `SELECT attempt_id, sequence, record FROM ${names.deltas} WHERE attempt_id = ANY($1::text[]) ORDER BY attempt_id, sequence`,
        [attemptIds],
      );
  const proposalRows = attemptIds.length === 0
    ? []
    : await sql.unsafe(
        `SELECT attempt_id, provider_tool_call_id, record FROM ${names.proposals} WHERE attempt_id = ANY($1::text[])`,
        [attemptIds],
      );
  const attempts = new Map<string, ApplicationAIAttemptRecord>();
  for (const row of attemptRows) {
    attempts.set(String(row.id), row.record as ApplicationAIAttemptRecord);
  }
  const deltas = new Map<string, Map<number, ApplicationAIStreamDelta>>();
  for (const row of deltaRows) {
    const attemptId = String(row.attempt_id);
    const attemptDeltas = deltas.get(attemptId) ?? new Map();
    attemptDeltas.set(Number(row.sequence), row.record as ApplicationAIStreamDelta);
    deltas.set(attemptId, attemptDeltas);
  }
  const proposals = new Map<string, ApplicationAIToolProposalRecord>();
  for (const row of proposalRows) {
    proposals.set(
      proposalKey(String(row.attempt_id), String(row.provider_tool_call_id)),
      row.record as ApplicationAIToolProposalRecord,
    );
  }
  return {
    invocationId,
    ...(invocationRows[0]?.record
      ? { invocation: invocationRows[0].record as ApplicationAIInvocationRecord }
      : {}),
    attempts,
    deltas,
    proposals,
    invocationDirty: false,
    dirtyAttempts: new Set(),
    dirtyDeltas: new Set(),
    dirtyProposals: new Set(),
  };
}

async function persistInvocationState(
  sql: TransactionSql,
  names: AttemptStoreNames,
  state: AttemptStoreState,
): Promise<void> {
  if (state.invocationDirty && state.invocation) {
    await sql.unsafe(
      `INSERT INTO ${names.invocations} (id, record, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (id) DO UPDATE SET record = EXCLUDED.record, updated_at = now()`,
      [state.invocation.id, postgresJson(state.invocation)],
    );
  }
  for (const attemptId of state.dirtyAttempts) {
    const attempt = state.attempts.get(attemptId);
    if (!attempt) continue;
    await sql.unsafe(
      `INSERT INTO ${names.attempts} (id, invocation_id, ordinal, record, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, now())
       ON CONFLICT (id) DO UPDATE SET record = EXCLUDED.record, updated_at = now()`,
      [
        attempt.id,
        attempt.invocationId,
        attempt.ordinal,
        postgresJson(attempt),
      ],
    );
  }
  for (const key of state.dirtyDeltas) {
    const [attemptId, sequenceText] = key.split('\u0000');
    const sequence = Number(sequenceText);
    const delta = attemptId
      ? state.deltas.get(attemptId)?.get(sequence)
      : undefined;
    if (!delta || !attemptId) continue;
    await sql.unsafe(
      `INSERT INTO ${names.deltas} (attempt_id, sequence, record)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (attempt_id, sequence) DO NOTHING`,
      [attemptId, sequence, postgresJson(delta)],
    );
  }
  for (const key of state.dirtyProposals) {
    const separator = key.indexOf('\u0000');
    const attemptId = key.slice(0, separator);
    const providerToolCallId = key.slice(separator + 1);
    const proposal = state.proposals.get(key);
    if (!proposal) continue;
    await sql.unsafe(
      `INSERT INTO ${names.proposals} (attempt_id, provider_tool_call_id, record)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (attempt_id, provider_tool_call_id)
       DO UPDATE SET record = EXCLUDED.record`,
      [attemptId, providerToolCallId, postgresJson(proposal)],
    );
  }
}

function tableNames(schema: string): AttemptStoreNames {
  const qualifiedSchema = identifier(schema, 'PostgreSQL schema');
  return {
    invocations: `${qualifiedSchema}.applik8s_ai_invocations`,
    attempts: `${qualifiedSchema}.applik8s_ai_attempts`,
    deltas: `${qualifiedSchema}.applik8s_ai_stream_deltas`,
    proposals: `${qualifiedSchema}.applik8s_ai_tool_proposals`,
  };
}

function indexName(table: string, suffix: string): string {
  return identifier(
    `${table.replaceAll('.', '_')}_${suffix}_idx`,
    'PostgreSQL index',
  );
}

function identifier(value: string, label: string): string {
  if (!/^[a-z_][a-z0-9_]*$/u.test(value)) {
    throw new Error(`${label} ${JSON.stringify(value)} is not a safe identifier.`);
  }
  return value;
}

function proposalKey(attemptId: string, providerToolCallId: string): string {
  return `${attemptId}\u0000${providerToolCallId}`;
}

function clone<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : structuredClone(value);
}

function postgresJson(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}
