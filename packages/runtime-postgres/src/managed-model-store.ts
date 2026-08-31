// typecast-file-boundary: JSONB lifecycle rows are validated and decoded at this PostgreSQL provider boundary before regaining model identity, value, and status generics.
import { createHash, randomUUID } from 'node:crypto';
import {
  ApplicationManagedModelConflictError,
  type ApplicationManagedModelCommitPrecondition,
  type ApplicationManagedModelCondition,
  type ApplicationManagedModelLease,
  type ApplicationManagedModelStore,
  type ApplicationManagedModelStoreRecord,
  type ApplicationManagedModelWriteReceipt,
  applicationManagedModelProtocol,
} from '@applik8s/applik8s';
import type {
  ApplicationPostgresSql,
  ApplicationPostgresTransactionSql,
} from '@applik8s/applik8s/postgres-runtime-contract';
import { createApplicationPostgresSql } from './sql.js';

export interface PostgresApplicationManagedModelStoreOptions<
  TIdentity,
  TValue extends object,
  TStatus extends object,
> {
  readonly applicationId: string;
  readonly model: string;
  readonly statusSchemaVersion: string;
  readonly databaseUrl?: string;
  readonly sql?: ApplicationPostgresSql;
  readonly schema?: string;
  readonly identityKey?: (identity: TIdentity) => string;
  readonly readValue: (identity: TIdentity) => Promise<TValue | undefined>;
  readonly decodeIdentity?: (value: unknown) => TIdentity;
  readonly decodeStatus?: (value: unknown) => TStatus;
}

export interface PostgresApplicationManagedModelStore<
  TIdentity,
  TValue extends object,
  TStatus extends object,
> extends ApplicationManagedModelStore<TIdentity, TValue, TStatus> {
  initialize(): Promise<void>;
  observeDesired(
    identity: TIdentity,
    value: TValue,
    initialStatus: TStatus,
    options?: { readonly now?: string; readonly transaction?: ApplicationPostgresTransactionSql },
  ): Promise<ApplicationManagedModelStoreRecord<TIdentity, TValue, TStatus>>;
  markDeletion(
    identity: TIdentity,
    options?: { readonly now?: string; readonly transaction?: ApplicationPostgresTransactionSql },
  ): Promise<void>;
  requestResync(maximumItems: number, now?: string): Promise<number>;
  read(identity: TIdentity): Promise<ApplicationManagedModelStoreRecord<TIdentity, TValue, TStatus> | undefined>;
  close(): Promise<void>;
}

interface ManagedRow {
  readonly identity: unknown;
  readonly uid: unknown;
  readonly generation: unknown;
  readonly resource_version: unknown;
  readonly created_at: unknown;
  readonly deletion_timestamp: unknown;
  readonly finalizers: unknown;
  readonly status: unknown;
  readonly conditions: unknown;
  readonly next_due_at: unknown;
  readonly invalidated: unknown;
  readonly lease_fence: unknown;
  readonly lease_expires_at: unknown;
  readonly reconcile_id: unknown;
  readonly attempt: unknown;
}

export function postgresApplicationManagedModelMigrationSql(schema = 'public'): readonly string[] {
  const namespace = postgresIdentifier(schema, 'schema');
  const lifecycle = `${namespace}.applik8s_managed_model_lifecycle`;
  const invalidations = `${namespace}.applik8s_managed_model_invalidations`;
  return [
    `CREATE SCHEMA IF NOT EXISTS ${namespace}`,
    `CREATE TABLE IF NOT EXISTS ${lifecycle} (
      application_id text NOT NULL,
      model_name text NOT NULL,
      identity_key text NOT NULL,
      identity jsonb NOT NULL,
      uid uuid NOT NULL,
      generation bigint NOT NULL CHECK (generation > 0),
      desired_digest text NOT NULL,
      resource_version bigint NOT NULL CHECK (resource_version > 0),
      status_schema_version text NOT NULL,
      status jsonb NOT NULL,
      conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
      finalizers jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_at timestamptz NOT NULL,
      deletion_timestamp timestamptz,
      next_due_at timestamptz,
      invalidated boolean NOT NULL DEFAULT true,
      lease_fence bigint NOT NULL DEFAULT 0,
      lease_expires_at timestamptz,
      reconcile_id uuid,
      attempt integer NOT NULL DEFAULT 0,
      last_error text,
      PRIMARY KEY (application_id, model_name, identity_key),
      UNIQUE (application_id, model_name, uid)
    )`,
    `CREATE INDEX IF NOT EXISTS applik8s_managed_model_due_idx
      ON ${lifecycle} (application_id, model_name, invalidated, next_due_at, identity_key)`,
    `CREATE TABLE IF NOT EXISTS ${invalidations} (
      sequence bigserial PRIMARY KEY,
      application_id text NOT NULL,
      model_name text NOT NULL,
      identity_key text NOT NULL,
      generation bigint NOT NULL,
      recorded_at timestamptz NOT NULL,
      UNIQUE (application_id, model_name, identity_key, generation)
    )`,
  ];
}

export function createPostgresApplicationManagedModelStore<
  TIdentity,
  TValue extends object,
  TStatus extends object,
>(
  options: PostgresApplicationManagedModelStoreOptions<TIdentity, TValue, TStatus>,
): PostgresApplicationManagedModelStore<TIdentity, TValue, TStatus> {
  const applicationId = required(options.applicationId, 'managed-model applicationId');
  const model = required(options.model, 'managed-model model');
  const statusSchemaVersion = required(options.statusSchemaVersion, 'managed-model statusSchemaVersion');
  const ownsSql = !options.sql;
  const databaseUrl = options.databaseUrl;
  if (!options.sql && !databaseUrl) throw new Error('PostgreSQL managed-model store requires sql or databaseUrl.');
  const sql = options.sql ?? createApplicationPostgresSql(databaseUrl ?? '');
  const namespace = postgresIdentifier(options.schema ?? 'public', 'schema');
  const lifecycle = `${namespace}.applik8s_managed_model_lifecycle`;
  const invalidations = `${namespace}.applik8s_managed_model_invalidations`;
  const identityKey = options.identityKey ?? ((identity: TIdentity) => digest(identity));
  const decodeIdentity = options.decodeIdentity ?? ((value: unknown) => value as TIdentity);
  const decodeStatus = options.decodeStatus ?? ((value: unknown) => value as TStatus);
  let initialized: Promise<void> | undefined;
  const initialize = () => (initialized ??= (async () => {
    for (const statement of postgresApplicationManagedModelMigrationSql(options.schema)) {
      await sql.unsafe(statement);
    }
  })());

  const hydrate = async (row: ManagedRow): Promise<ApplicationManagedModelStoreRecord<TIdentity, TValue, TStatus>> => {
    const identity = decodeIdentity(jsonValue(row.identity));
    const value = await options.readValue(identity);
    if (!value) throw new Error(`Managed-model desired value ${model}/${identityKey(identity)} is absent without deletion intent.`);
    return {
      model,
      id: identity,
      value,
      metadata: {
        uid: stringValue(row.uid, 'uid'),
        generation: integerValue(row.generation, 'generation'),
        resourceVersion: stringValue(row.resource_version, 'resourceVersion'),
        createdAt: timestampValue(row.created_at, 'createdAt'),
        ...(row.deletion_timestamp ? { deletionTimestamp: timestampValue(row.deletion_timestamp, 'deletionTimestamp') } : {}),
        finalizers: stringArray(jsonValue(row.finalizers), 'finalizers'),
      },
      status: decodeStatus(jsonValue(row.status)),
      conditions: conditionsValue(jsonValue(row.conditions)),
      ...(row.next_due_at ? { nextDueAt: timestampValue(row.next_due_at, 'nextDueAt') } : {}),
      invalidated: row.invalidated === true,
    };
  };
  const select = async (identity: TIdentity, executor: ApplicationPostgresSql | ApplicationPostgresTransactionSql = sql) => {
    const rows = await executor.unsafe(
      `SELECT ${managedColumns} FROM ${lifecycle}
       WHERE application_id = $1 AND model_name = $2 AND identity_key = $3`,
      [applicationId, model, identityKey(identity)],
    );
    return rows[0] ? hydrate(rows[0] as unknown as ManagedRow) : undefined;
  };
  const mutate = async (
    precondition: ApplicationManagedModelCommitPrecondition<TIdentity>,
    assignments: string,
    parameters: readonly unknown[],
  ) => {
    const rows = await sql.unsafe(
      `UPDATE ${lifecycle} SET ${assignments}, resource_version = resource_version + 1
       WHERE application_id = $1 AND model_name = $2 AND identity_key = $3
         AND uid = $4::uuid AND generation = $5 AND resource_version = $6 AND lease_fence = $7
         AND reconcile_id IS NOT NULL
       RETURNING ${managedColumns}`,
      [applicationId, model, identityKey(precondition.id), precondition.uid, precondition.generation, Number(precondition.resourceVersion), Number(precondition.fence), ...parameters],
    );
    if (!rows[0]) throw stale(precondition);
    return hydrate(rows[0] as unknown as ManagedRow);
  };
  const receipt = (record: ApplicationManagedModelStoreRecord<TIdentity, TValue, TStatus>, fence: string, now: string): ApplicationManagedModelWriteReceipt => ({
    protocol: applicationManagedModelProtocol,
    uid: record.metadata.uid,
    generation: record.metadata.generation,
    resourceVersion: record.metadata.resourceVersion,
    fence,
    committedAt: now,
  });

  return {
    async initialize() { await initialize(); },
    async observeDesired(identity, value, initialStatus, observeOptions = {}) {
      await initialize();
      const executor = observeOptions.transaction ?? sql;
      const now = observeOptions.now ?? new Date().toISOString();
      const key = identityKey(identity);
      const valueDigest = digest(value);
      const rows = await executor.unsafe(
        `INSERT INTO ${lifecycle} AS target (
          application_id, model_name, identity_key, identity, uid, generation,
          desired_digest, resource_version, status_schema_version, status, created_at, invalidated
        ) VALUES ($1, $2, $3, $4::jsonb, $5::uuid, 1, $6, 1, $7, $8::jsonb, $9::timestamptz, true)
        ON CONFLICT (application_id, model_name, identity_key) DO UPDATE SET
          identity = EXCLUDED.identity,
          generation = CASE WHEN target.desired_digest = EXCLUDED.desired_digest THEN target.generation ELSE target.generation + 1 END,
          desired_digest = EXCLUDED.desired_digest,
          resource_version = CASE WHEN target.desired_digest = EXCLUDED.desired_digest THEN target.resource_version ELSE target.resource_version + 1 END,
          invalidated = target.invalidated OR target.desired_digest <> EXCLUDED.desired_digest,
          deletion_timestamp = NULL
        RETURNING ${managedColumns}`,
        [applicationId, model, key, JSON.stringify(identity), randomUUID(), valueDigest, statusSchemaVersion, JSON.stringify(initialStatus), now],
      );
      const row = rows[0];
      if (!row) throw new Error(`PostgreSQL did not return managed-model ${model}/${key}.`);
      const hydrated = await hydrate(row as unknown as ManagedRow);
      await executor.unsafe(
        `INSERT INTO ${invalidations} (application_id, model_name, identity_key, generation, recorded_at)
         VALUES ($1, $2, $3, $4, $5::timestamptz)
         ON CONFLICT DO NOTHING`,
        [applicationId, model, key, hydrated.metadata.generation, now],
      );
      return hydrated;
    },
    async markDeletion(identity, deletionOptions = {}) {
      await initialize();
      const executor = deletionOptions.transaction ?? sql;
      const now = deletionOptions.now ?? new Date().toISOString();
      const rows = await executor.unsafe(
        `UPDATE ${lifecycle} SET deletion_timestamp = COALESCE(deletion_timestamp, $4::timestamptz), invalidated = true,
          resource_version = CASE WHEN deletion_timestamp IS NULL THEN resource_version + 1 ELSE resource_version END
         WHERE application_id = $1 AND model_name = $2 AND identity_key = $3 RETURNING generation`,
        [applicationId, model, identityKey(identity), now],
      );
      if (!rows[0]) throw new Error(`Managed-model ${model}/${identityKey(identity)} does not exist.`);
    },
    async requestResync(maximumItems, now = new Date().toISOString()) {
      await initialize();
      if (!Number.isSafeInteger(maximumItems) || maximumItems < 1) throw new Error('maximumItems must be a positive integer.');
      const rows = await sql.unsafe(
        `WITH candidates AS (
          SELECT identity_key FROM ${lifecycle}
          WHERE application_id = $1 AND model_name = $2
          ORDER BY identity_key LIMIT $3 FOR UPDATE SKIP LOCKED
        ) UPDATE ${lifecycle} target SET invalidated = true, next_due_at = LEAST(COALESCE(target.next_due_at, $4::timestamptz), $4::timestamptz)
          FROM candidates WHERE target.application_id = $1 AND target.model_name = $2 AND target.identity_key = candidates.identity_key
          RETURNING target.identity_key`,
        [applicationId, model, maximumItems, now],
      );
      return rows.length;
    },
    async read(identity) { await initialize(); return select(identity); },
    async claimNext({ model: requestedModel, now, leaseDurationSeconds }) {
      await initialize();
      if (requestedModel !== model) return undefined;
      const rows = await sql.unsafe(
        `WITH candidate AS (
          SELECT identity_key FROM ${lifecycle}
          WHERE application_id = $1 AND model_name = $2
            AND (lease_expires_at IS NULL OR lease_expires_at <= $3::timestamptz)
            AND (invalidated OR next_due_at <= $3::timestamptz)
          ORDER BY COALESCE(next_due_at, '-infinity'::timestamptz), identity_key
          LIMIT 1 FOR UPDATE SKIP LOCKED
        ) UPDATE ${lifecycle} target SET
          lease_fence = target.lease_fence + 1,
          lease_expires_at = $3::timestamptz + ($4 * interval '1 second'),
          reconcile_id = $5::uuid,
          attempt = target.attempt + 1
        FROM candidate WHERE target.application_id = $1 AND target.model_name = $2 AND target.identity_key = candidate.identity_key
        RETURNING ${managedColumns}`,
        [applicationId, model, now, leaseDurationSeconds, randomUUID()],
      );
      if (!rows[0]) return undefined;
      const row = rows[0] as unknown as ManagedRow;
      const record = await hydrate(row);
      return {
        reconcileId: stringValue(row.reconcile_id, 'reconcileId'),
        fence: stringValue(row.lease_fence, 'fence'),
        attempt: integerValue(row.attempt, 'attempt'),
        expiresAt: timestampValue(row.lease_expires_at, 'leaseExpiresAt'),
        record,
      } satisfies ApplicationManagedModelLease<TIdentity, TValue, TStatus>;
    },
    async writeStatus(precondition, status, now) {
      const record = await mutate(precondition, 'status = $8::jsonb', [JSON.stringify(status)]);
      return { record, receipt: receipt(record, precondition.fence, now) };
    },
    async writeCondition(precondition, condition, now) {
      const current = await select(precondition.id);
      if (!current) throw stale(precondition);
      let conditions = [...current.conditions];
      if ('remove' in condition) conditions = conditions.filter((entry) => entry.type !== condition.remove);
      else {
        const previous = conditions.find((entry) => entry.type === condition.type);
        const unchanged = previous && previous.status === condition.status && previous.reason === condition.reason && previous.message === condition.message;
        const next: ApplicationManagedModelCondition = {
          ...condition,
          observedGeneration: precondition.generation,
          lastTransitionTime: unchanged ? previous.lastTransitionTime : now,
        };
        conditions = [...conditions.filter((entry) => entry.type !== condition.type), next].sort((left, right) => left.type.localeCompare(right.type));
      }
      const record = await mutate(precondition, 'conditions = $8::jsonb', [JSON.stringify(conditions)]);
      return { record, receipt: receipt(record, precondition.fence, now) };
    },
    async ensureFinalizers(precondition, finalizers) {
      const current = await select(precondition.id);
      if (!current) throw stale(precondition);
      const next = [...new Set([...current.metadata.finalizers, ...finalizers])].sort();
      if (digest(next) === digest(current.metadata.finalizers)) return current;
      return mutate(precondition, 'finalizers = $8::jsonb', [JSON.stringify(next)]);
    },
    async removeFinalizer(precondition, finalizer) {
      const current = await select(precondition.id);
      if (!current) throw stale(precondition);
      return mutate(precondition, 'finalizers = $8::jsonb', [JSON.stringify(current.metadata.finalizers.filter((value) => value !== finalizer))]);
    },
    async complete(precondition, completeOptions) {
      const record = await mutate(precondition, 'invalidated = false, next_due_at = $8::timestamptz, lease_expires_at = NULL, reconcile_id = NULL, last_error = NULL', [completeOptions.nextDueAt ?? null]);
      return record;
    },
    async release(precondition, releaseOptions) {
      await mutate(precondition, 'invalidated = false, next_due_at = $8::timestamptz, lease_expires_at = NULL, reconcile_id = NULL, last_error = $9', [releaseOptions.retryAt ?? null, releaseOptions.error ?? null]);
    },
    async close() { if (ownsSql) await sql.end(); },
  };
}

const managedColumns = `identity, uid, generation, resource_version, created_at, deletion_timestamp,
  finalizers, status, conditions, next_due_at, invalidated, lease_fence, lease_expires_at, reconcile_id, attempt`;

function stale<TIdentity>(precondition: ApplicationManagedModelCommitPrecondition<TIdentity>) {
  return new ApplicationManagedModelConflictError(`Managed-model ${precondition.model}/${digest(precondition.id)} rejected a stale UID, generation, resource version, or fence.`);
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>).filter(([, entry]) => entry !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([name, entry]) => `${JSON.stringify(name)}:${canonical(entry)}`).join(',')}}`;
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} must not be empty.`);
  return normalized;
}

function postgresIdentifier(value: string, label: string): string {
  if (!/^[a-z_][a-z0-9_]*$/u.test(value)) throw new Error(`${label} must be a PostgreSQL identifier.`);
  return `"${value}"`;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value === 'bigint' || typeof value === 'number') return String(value);
  if (typeof value !== 'string' || !value) throw new Error(`PostgreSQL managed-model ${label} is invalid.`);
  return value;
}

function integerValue(value: unknown, label: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`PostgreSQL managed-model ${label} is invalid.`);
  return parsed;
}

function timestampValue(value: unknown, label: string): string {
  const timestamp = value instanceof Date ? value.toISOString() : String(value);
  if (!Number.isFinite(Date.parse(timestamp))) throw new Error(`PostgreSQL managed-model ${label} is invalid.`);
  return new Date(timestamp).toISOString();
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) throw new Error(`PostgreSQL managed-model ${label} is invalid.`);
  return [...value];
}

function conditionsValue(value: unknown): ApplicationManagedModelCondition[] {
  if (!Array.isArray(value)) throw new Error('PostgreSQL managed-model conditions are invalid.');
  return value as ApplicationManagedModelCondition[];
}

function jsonValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
