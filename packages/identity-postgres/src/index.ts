// typecast-file-boundary: PostgreSQL JSONB rows are decoded only after their
// durable identity/version columns have been checked against the stored record.

import type {
  ApplicationIdentityAdmissionReceipt,
  ApplicationIdentityFlowStore,
  ApplicationOAuthAuthorizationFlowRecord,
  ApplicationOAuthAuthorizationFlowStore,
  ApplicationOrphanedProviderSession,
  ApplicationPreAuthenticationFlowRecord,
} from '@applik8s/identity';
import type { JSONValue, Sql, TransactionSql } from 'postgres';

export interface PostgresApplicationIdentityStoresOptions {
  readonly sql: Sql;
  readonly schema?: string;
}

export interface PostgresApplicationIdentityStores {
  readonly flows: ApplicationIdentityFlowStore;
  readonly oauth: ApplicationOAuthAuthorizationFlowStore;
  readonly prepare: () => Promise<void>;
}

interface IdentityTableNames {
  readonly flows: string;
  readonly receipts: string;
  readonly orphans: string;
  readonly oauthFlows: string;
}

export function createPostgresApplicationIdentityStores(
  options: PostgresApplicationIdentityStoresOptions,
): PostgresApplicationIdentityStores {
  const names = tableNames(options.schema ?? 'public');
  let prepared: Promise<void> | undefined;
  const prepare = () => {
    prepared ??= prepareStores(options.sql, names).catch((error) => {
      prepared = undefined;
      throw error;
    });
    return prepared;
  };
  const flows = applicationIdentityFlowStore(options.sql, names, prepare);
  const oauth = applicationOAuthFlowStore(options.sql, names, prepare);
  return Object.freeze({ flows, oauth, prepare });
}

function applicationIdentityFlowStore(
  sql: Sql,
  names: IdentityTableNames,
  prepare: () => Promise<void>,
): ApplicationIdentityFlowStore {
  return {
    async createFlow(flow) {
      await prepare();
      const rows = await sql.unsafe(
        `INSERT INTO ${names.flows} (id, version, record)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (id) DO NOTHING
         RETURNING id, version, record`,
        [flow.id, flow.version, postgresJson(flow)],
      );
      const created = flowRecord(rows[0]);
      if (!created) {
        throw new Error(`Identity flow ${flow.id} already exists.`);
      }
      return created;
    },

    async getFlow(flowId) {
      await prepare();
      return flowRecord(
        (
          await sql.unsafe(
            `SELECT id, version, record FROM ${names.flows} WHERE id = $1`,
            [flowId],
          )
        )[0],
      );
    },

    async replaceFlow(flow, expectedVersion) {
      await prepare();
      assertNextVersion(flow.version, expectedVersion, 'identity flow');
      const rows = await sql.unsafe(
        `UPDATE ${names.flows}
         SET version = $2, record = $3::jsonb, updated_at = now()
         WHERE id = $1 AND version = $4
         RETURNING id, version, record`,
        [flow.id, flow.version, postgresJson(flow), expectedVersion],
      );
      const replaced = flowRecord(rows[0]);
      if (!replaced) throw concurrencyError('Identity flow', flow.id);
      return replaced;
    },

    async getAdmissionReceipt(providerCompletionKey) {
      await prepare();
      return receiptRecord(
        (
          await sql.unsafe(
            `SELECT provider_completion_key, flow_id, record
             FROM ${names.receipts}
             WHERE provider_completion_key = $1`,
            [providerCompletionKey],
          )
        )[0],
      );
    },

    async commitAdmission(input) {
      await prepare();
      return sql.begin(async (transaction) => {
        await lockIdentities(transaction, [
          `completion:${input.receipt.providerCompletionKey}`,
          `flow:${input.flow.id}`,
        ]);
        const receipt = receiptRecord(
          (
            await transaction.unsafe(
              `SELECT provider_completion_key, flow_id, record
               FROM ${names.receipts}
               WHERE provider_completion_key = $1`,
              [input.receipt.providerCompletionKey],
            )
          )[0],
        );
        if (receipt) {
          if (receipt.flowId !== input.flow.id) {
            throw new Error(
              `Provider completion ${receipt.providerCompletionKey} belongs to identity flow ${receipt.flowId}.`,
            );
          }
          const replayedFlow = flowRecord(
            (
              await transaction.unsafe(
                `SELECT id, version, record FROM ${names.flows} WHERE id = $1`,
                [receipt.flowId],
              )
            )[0],
          );
          if (!replayedFlow) {
            throw new Error(
              `Admission receipt ${receipt.id} references missing identity flow ${receipt.flowId}.`,
            );
          }
          return { kind: 'replayed' as const, flow: replayedFlow, receipt };
        }
        assertNextVersion(
          input.flow.version,
          input.expectedFlowVersion,
          'identity admission',
        );
        const updatedRows = await transaction.unsafe(
          `UPDATE ${names.flows}
           SET version = $2, record = $3::jsonb, updated_at = now()
           WHERE id = $1 AND version = $4
           RETURNING id, version, record`,
          [
            input.flow.id,
            input.flow.version,
            postgresJson(input.flow),
            input.expectedFlowVersion,
          ],
        );
        const updatedFlow = flowRecord(updatedRows[0]);
        if (!updatedFlow) {
          throw concurrencyError('Identity flow', input.flow.id);
        }
        const receiptRows = await transaction.unsafe(
          `INSERT INTO ${names.receipts}
             (provider_completion_key, flow_id, record)
           VALUES ($1, $2, $3::jsonb)
           RETURNING provider_completion_key, flow_id, record`,
          [
            input.receipt.providerCompletionKey,
            input.receipt.flowId,
            postgresJson(input.receipt),
          ],
        );
        const committedReceipt = receiptRecord(receiptRows[0]);
        if (!committedReceipt) {
          throw new Error(
            `Identity admission receipt ${input.receipt.id} was not persisted.`,
          );
        }
        return {
          kind: 'committed' as const,
          flow: updatedFlow,
          receipt: committedReceipt,
        };
      });
    },

    async recordOrphan(orphan) {
      await prepare();
      const rows = await sql.unsafe(
        `INSERT INTO ${names.orphans}
           (id, provider, provider_session_id, provider_completion_key,
            state, version, created_at, record)
         VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::jsonb)
         ON CONFLICT (provider, provider_session_id, provider_completion_key)
         DO UPDATE SET id = ${names.orphans}.id
         RETURNING id, state, version, record`,
        [
          orphan.id,
          orphan.provider,
          orphan.providerSessionId,
          orphan.providerCompletionKey,
          orphan.state,
          orphan.version,
          orphan.createdAt,
          postgresJson(orphan),
        ],
      );
      const recorded = orphanRecord(rows[0]);
      if (!recorded) {
        throw new Error(`Identity orphan ${orphan.id} was not persisted.`);
      }
      return recorded;
    },

    async listPendingOrphans(limit) {
      await prepare();
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
        throw new Error('Identity orphan limit must be between 1 and 10000.');
      }
      const rows = await sql.unsafe(
        `SELECT id, state, version, record
         FROM ${names.orphans}
         WHERE state = 'pending'
         ORDER BY created_at, id
         LIMIT $1`,
        [limit],
      );
      return rows.map((row) => requiredRecord(orphanRecord(row), 'identity orphan'));
    },

    async resolveOrphan(orphanId, expectedVersion, resolution) {
      await prepare();
      const rows = await sql.unsafe(
        `UPDATE ${names.orphans}
         SET state = $2,
             version = version + 1,
             record = record
               || jsonb_build_object(
                    'state', $2::text,
                    'version', version + 1,
                    'resolvedAt', $3::text
                  )
               || CASE
                    WHEN $4::jsonb IS NULL THEN '{}'::jsonb
                    ELSE jsonb_build_object('resolutionEvidence', $4::jsonb)
                  END,
             updated_at = now()
         WHERE id = $1 AND version = $5 AND state = 'pending'
         RETURNING id, state, version, record`,
        [
          orphanId,
          resolution.state,
          resolution.resolvedAt,
          resolution.evidence ? postgresJson(resolution.evidence) : null,
          expectedVersion,
        ],
      );
      const resolved = orphanRecord(rows[0]);
      if (!resolved) throw concurrencyError('Identity orphan', orphanId);
      return resolved;
    },
  };
}

function applicationOAuthFlowStore(
  sql: Sql,
  names: IdentityTableNames,
  prepare: () => Promise<void>,
): ApplicationOAuthAuthorizationFlowStore {
  return {
    async create(flow) {
      await prepare();
      const rows = await sql.unsafe(
        `INSERT INTO ${names.oauthFlows} (id, version, record)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (id) DO NOTHING
         RETURNING id, version, record`,
        [flow.id, flow.version, postgresJson(flow)],
      );
      const created = oauthRecord(rows[0]);
      if (!created) {
        throw new Error(`OAuth authorization flow ${flow.id} already exists.`);
      }
      return created;
    },

    async get(flowId) {
      await prepare();
      return oauthRecord(
        (
          await sql.unsafe(
            `SELECT id, version, record FROM ${names.oauthFlows} WHERE id = $1`,
            [flowId],
          )
        )[0],
      );
    },

    async replace(flow, expectedVersion) {
      await prepare();
      assertNextVersion(flow.version, expectedVersion, 'OAuth flow');
      const rows = await sql.unsafe(
        `UPDATE ${names.oauthFlows}
         SET version = $2, record = $3::jsonb, updated_at = now()
         WHERE id = $1 AND version = $4
         RETURNING id, version, record`,
        [flow.id, flow.version, postgresJson(flow), expectedVersion],
      );
      const replaced = oauthRecord(rows[0]);
      if (!replaced) {
        throw concurrencyError('OAuth authorization flow', flow.id);
      }
      return replaced;
    },
  };
}

async function prepareStores(
  sql: Sql,
  names: IdentityTableNames,
): Promise<void> {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ${names.flows} (
      id text PRIMARY KEY,
      version integer NOT NULL CHECK (version > 0),
      record jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS ${names.receipts} (
      provider_completion_key text PRIMARY KEY,
      flow_id text NOT NULL UNIQUE
        REFERENCES ${names.flows}(id) ON DELETE RESTRICT,
      record jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS ${names.orphans} (
      id text PRIMARY KEY,
      provider text NOT NULL,
      provider_session_id text NOT NULL,
      provider_completion_key text NOT NULL,
      state text NOT NULL
        CHECK (state IN ('pending', 'revoked', 'expired', 'transferred')),
      version integer NOT NULL CHECK (version > 0),
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      record jsonb NOT NULL,
      UNIQUE (provider, provider_session_id, provider_completion_key)
    );
    CREATE INDEX IF NOT EXISTS ${indexName(names.orphans, 'pending')}
      ON ${names.orphans} (created_at, id) WHERE state = 'pending';
    CREATE TABLE IF NOT EXISTS ${names.oauthFlows} (
      id text PRIMARY KEY,
      version integer NOT NULL CHECK (version > 0),
      record jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function lockIdentities(
  transaction: TransactionSql,
  identities: readonly string[],
): Promise<void> {
  for (const identity of [...new Set(identities)].sort()) {
    await transaction.unsafe(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [identity],
    );
  }
}

function flowRecord(
  row: Record<string, unknown> | undefined,
): ApplicationPreAuthenticationFlowRecord | undefined {
  return versionedRecord<ApplicationPreAuthenticationFlowRecord>(
    row,
    'identity flow',
    'applik8s.identity/v1alpha1',
  );
}

function oauthRecord(
  row: Record<string, unknown> | undefined,
): ApplicationOAuthAuthorizationFlowRecord | undefined {
  return versionedRecord<ApplicationOAuthAuthorizationFlowRecord>(
    row,
    'OAuth authorization flow',
    'applik8s.oauth/v1alpha1',
  );
}

function orphanRecord(
  row: Record<string, unknown> | undefined,
): ApplicationOrphanedProviderSession | undefined {
  return versionedRecord<ApplicationOrphanedProviderSession>(
    row,
    'identity orphan',
    'applik8s.identityOrphan/v1alpha1',
  );
}

function versionedRecord<T extends { id: string; version: number; apiVersion: string }>(
  row: Record<string, unknown> | undefined,
  label: string,
  apiVersion: T['apiVersion'],
): T | undefined {
  if (!row) return undefined;
  const record = jsonObject(row.record, `${label} record`);
  if (
    record.id !== row.id
    || record.version !== row.version
    || record.apiVersion !== apiVersion
  ) {
    throw new Error(`PostgreSQL ${label} identity/version is inconsistent.`);
  }
  return structuredClone(record) as T;
}

function receiptRecord(
  row: Record<string, unknown> | undefined,
): ApplicationIdentityAdmissionReceipt | undefined {
  if (!row) return undefined;
  const record = jsonObject(row.record, 'identity admission receipt');
  if (
    record.apiVersion !== 'applik8s.identityAdmission/v1alpha1'
    || record.providerCompletionKey !== row.provider_completion_key
    || record.flowId !== row.flow_id
  ) {
    throw new Error(
      'PostgreSQL identity admission receipt identity is inconsistent.',
    );
  }
  return structuredClone(record) as unknown as ApplicationIdentityAdmissionReceipt;
}

function jsonObject(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`PostgreSQL ${label} is not a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function requiredRecord<T>(value: T | undefined, label: string): T {
  if (!value) throw new Error(`PostgreSQL returned an empty ${label} row.`);
  return value;
}

function assertNextVersion(
  version: number,
  expectedVersion: number,
  label: string,
): void {
  if (
    !Number.isSafeInteger(expectedVersion)
    || expectedVersion < 1
    || version !== expectedVersion + 1
  ) {
    throw new Error(
      `${label} replacement must advance version ${expectedVersion} by exactly one.`,
    );
  }
}

function concurrencyError(label: string, id: string): Error {
  return new Error(`${label} ${id} changed concurrently or is unavailable.`);
}

function tableNames(schema: string): IdentityTableNames {
  const safeSchema = identifier(schema, 'PostgreSQL schema');
  return {
    flows: `${safeSchema}.applik8s_identity_flows`,
    receipts: `${safeSchema}.applik8s_identity_admission_receipts`,
    orphans: `${safeSchema}.applik8s_identity_orphans`,
    oauthFlows: `${safeSchema}.applik8s_oauth_authorization_flows`,
  };
}

function indexName(table: string, suffix: string): string {
  const unqualifiedTable = table.slice(table.lastIndexOf('.') + 1);
  return identifier(
    `${unqualifiedTable}_${suffix}_idx`,
    'PostgreSQL index',
  );
}

function identifier(value: string, label: string): string {
  if (!/^[a-z_][a-z0-9_]*$/u.test(value)) {
    throw new Error(`${label} ${JSON.stringify(value)} is not a safe identifier.`);
  }
  return value;
}

function postgresJson(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}
