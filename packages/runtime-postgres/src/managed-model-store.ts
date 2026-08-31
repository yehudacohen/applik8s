// typecast-file-boundary: JSONB lifecycle rows are validated and decoded at this PostgreSQL provider boundary before regaining model identity, value, and status generics.
import { randomUUID } from 'node:crypto';
import {
  type ApplicationManagedModelCommitPrecondition,
  type ApplicationManagedModelCondition,
  ApplicationManagedModelConflictError,
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
import {
  applicationManagedModelDesiredDigest,
  applicationManagedModelIdentityKey,
  applicationManagedModelPostgresMigrationSql,
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
  /** Framework metadata fields, such as a revision column, may be excluded here. */
  readonly desiredDigest?: (value: TValue) => string;
  /** Removes the retained domain row in the same transaction as terminal finalizer completion. */
  readonly deleteValue?: (
    identity: TIdentity,
    transaction: ApplicationPostgresTransactionSql,
  ) => Promise<void>;
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
    options?: {
      readonly now?: string;
      readonly transaction?: ApplicationPostgresTransactionSql;
      /** Snapshot read in the caller's transaction before the domain row is removed. */
      readonly value?: TValue;
    },
  ): Promise<void>;
  requestResync(maximumItems: number, now?: string): Promise<number>;
  activateExisting(options: {
    readonly initialStatus: TStatus;
    readonly pageSize?: number;
    readonly maximumPages?: number;
    readonly now?: () => Date;
    readonly scanPage: (request: {
      readonly cursor?: TIdentity;
      readonly limit: number;
      readonly transaction: ApplicationPostgresTransactionSql;
    }) => Promise<{
      readonly items: readonly { readonly identity: TIdentity; readonly value: TValue }[];
      readonly nextCursor?: TIdentity;
    }>;
  }): Promise<{ readonly activated: number; readonly completed: boolean }>;
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
  readonly deletion_value: unknown;
  readonly next_due_at: unknown;
  readonly invalidated: unknown;
  readonly lease_fence: unknown;
  readonly lease_expires_at: unknown;
  readonly reconcile_id: unknown;
  readonly attempt: unknown;
}

export function postgresApplicationManagedModelMigrationSql(schema = 'public'): readonly string[] {
  return applicationManagedModelPostgresMigrationSql(schema);
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
  const activations = `${namespace}.applik8s_managed_model_activations`;
  const identityKey = options.identityKey ?? applicationManagedModelIdentityKey;
  const desiredDigest = options.desiredDigest ?? applicationManagedModelDesiredDigest;
  const decodeIdentity = options.decodeIdentity ?? ((value: unknown) => value as TIdentity);
  const decodeStatus = options.decodeStatus ?? ((value: unknown) => value as TStatus);
  let initialized: Promise<void> | undefined;
  const initialize = () => (initialized ??= (async () => {
    for (const statement of postgresApplicationManagedModelMigrationSql(options.schema)) {
      await sql.unsafe(statement);
    }
  })());

  const hydrate = async (row: ManagedRow, valueOverride?: TValue): Promise<ApplicationManagedModelStoreRecord<TIdentity, TValue, TStatus>> => {
    const identity = decodeIdentity(jsonValue(row.identity));
    const currentValue = valueOverride ?? await options.readValue(identity);
    const deletionValue = row.deletion_timestamp && row.deletion_value
      ? jsonValue(row.deletion_value) as TValue
      : undefined;
    const value = currentValue ?? deletionValue;
    if (!value) throw new Error(`Managed-model desired value ${model}/${identityKey(identity)} is absent without a retained deletion snapshot.`);
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
    executor: ApplicationPostgresSql | ApplicationPostgresTransactionSql = sql,
  ) => {
    const rows = await executor.unsafe(
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
    disposition: 'accepted',
    recordedAt: now,
  });

  const store: PostgresApplicationManagedModelStore<TIdentity, TValue, TStatus> = {
    async initialize() { await initialize(); },
    async observeDesired(identity, value, initialStatus, observeOptions = {}) {
      await initialize();
      const now = observeOptions.now ?? new Date().toISOString();
      const key = identityKey(identity);
      const valueDigest = desiredDigest(value);
      const observe = async (executor: ApplicationPostgresTransactionSql) => {
        await executor.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
          JSON.stringify([applicationId, model, key]),
        ]);
        const currentRows = await executor.unsafe(
          `SELECT ${managedColumns}, desired_digest, status_schema_version
           FROM ${lifecycle}
           WHERE application_id = $1 AND model_name = $2 AND identity_key = $3
           FOR UPDATE`,
          [applicationId, model, key],
        );
        const current = currentRows[0];
        let row: Readonly<Record<string, unknown>> | undefined;
        if (!current) {
          const inserted = await executor.unsafe(
            `INSERT INTO ${lifecycle} (
              application_id, model_name, identity_key, identity, uid, generation,
              desired_digest, resource_version, status_schema_version, status, created_at, invalidated
            ) VALUES ($1, $2, $3, $4::jsonb, $5::uuid, 1, $6, 1, $7, $8::jsonb, $9::timestamptz, true)
            RETURNING ${managedColumns}`,
            [applicationId, model, key, JSON.stringify(identity), randomUUID(), valueDigest, statusSchemaVersion, JSON.stringify(initialStatus), now],
          );
          row = inserted[0];
        } else if (current.deletion_timestamp) {
          const finalizers = stringArray(jsonValue(current.finalizers), 'finalizers');
          if (finalizers.length > 0) {
            throw new Error(
              `Managed-model ${model}/${key} is still finalizing deletion with finalizers ${JSON.stringify(finalizers)}.`,
            );
          }
          const replaced = await executor.unsafe(
            `UPDATE ${lifecycle} SET
              identity = $4::jsonb, uid = $5::uuid, generation = 1,
              desired_digest = $6, resource_version = 1,
              status_schema_version = $7, status = $8::jsonb,
              conditions = '[]'::jsonb, finalizers = '[]'::jsonb,
              created_at = $9::timestamptz, deletion_timestamp = NULL,
              deletion_value = NULL, next_due_at = NULL, invalidated = true,
              lease_fence = 0, lease_expires_at = NULL, reconcile_id = NULL,
              attempt = 0, last_error = NULL
             WHERE application_id = $1 AND model_name = $2 AND identity_key = $3
             RETURNING ${managedColumns}`,
            [applicationId, model, key, JSON.stringify(identity), randomUUID(), valueDigest, statusSchemaVersion, JSON.stringify(initialStatus), now],
          );
          row = replaced[0];
        } else {
          if (String(current.status_schema_version) !== statusSchemaVersion) {
            throw new Error(
              `Managed-model ${model}/${key} requires status schema ${String(current.status_schema_version)} to migrate to ${statusSchemaVersion}.`,
            );
          }
          if (String(current.desired_digest) === valueDigest) {
            row = current;
          } else {
            const updated = await executor.unsafe(
              `UPDATE ${lifecycle} SET
                identity = $4::jsonb, desired_digest = $5,
                generation = generation + 1, resource_version = resource_version + 1,
                invalidated = true, next_due_at = NULL,
                lease_expires_at = NULL, reconcile_id = NULL, last_error = NULL
               WHERE application_id = $1 AND model_name = $2 AND identity_key = $3
               RETURNING ${managedColumns}`,
              [applicationId, model, key, JSON.stringify(identity), valueDigest],
            );
            row = updated[0];
          }
        }
        if (!row) throw new Error(`Managed-model ${model}/${key} lifecycle transition did not persist a row.`);
        const hydrated = await hydrate(row as unknown as ManagedRow, value);
        await executor.unsafe(
          `INSERT INTO ${invalidations} (application_id, model_name, identity_key, generation, resource_version, recorded_at)
           VALUES ($1, $2, $3, $4, $5, $6::timestamptz)
           ON CONFLICT DO NOTHING`,
          [applicationId, model, key, hydrated.metadata.generation, Number(hydrated.metadata.resourceVersion), now],
        );
        return hydrated;
      };
      if (observeOptions.transaction) return observe(observeOptions.transaction);
      return sql.begin(observe);
    },
    async markDeletion(identity, deletionOptions = {}) {
      await initialize();
      const executor = deletionOptions.transaction ?? sql;
      const now = deletionOptions.now ?? new Date().toISOString();
      const currentValue = deletionOptions.value ?? await options.readValue(identity);
      const rows = await executor.unsafe(
        `UPDATE ${lifecycle} SET deletion_timestamp = COALESCE(deletion_timestamp, $4::timestamptz),
          deletion_value = COALESCE(deletion_value, $5::jsonb), invalidated = true,
          resource_version = CASE WHEN deletion_timestamp IS NULL THEN resource_version + 1 ELSE resource_version END,
          next_due_at = NULL, lease_expires_at = NULL, reconcile_id = NULL
         WHERE application_id = $1 AND model_name = $2 AND identity_key = $3 RETURNING generation, resource_version`,
        [applicationId, model, identityKey(identity), now, currentValue ? JSON.stringify(currentValue) : null],
      );
      if (!rows[0]) throw new Error(`Managed-model ${model}/${identityKey(identity)} does not exist.`);
      await executor.unsafe(
        `INSERT INTO ${invalidations} (application_id, model_name, identity_key, generation, resource_version, recorded_at)
         VALUES ($1, $2, $3, $4, $5, $6::timestamptz) ON CONFLICT DO NOTHING`,
        [applicationId, model, identityKey(identity), Number(rows[0].generation), Number(rows[0].resource_version), now],
      );
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
    async activateExisting(activationOptions) {
      await initialize();
      const pageSize = positiveInteger(activationOptions.pageSize ?? 500, 'activation pageSize');
      const maximumPages = positiveInteger(activationOptions.maximumPages ?? 10_000, 'activation maximumPages');
      const clock = activationOptions.now ?? (() => new Date());
      let activated = 0;
      for (let page = 0; page < maximumPages; page += 1) {
        const result = await sql.begin(async (transaction) => {
          await transaction.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
            JSON.stringify([applicationId, model, 'activation']),
          ]);
          const instant = clock().toISOString();
          await transaction.unsafe(
            `INSERT INTO ${activations} (
              application_id, model_name, status_schema_version, updated_at
            ) VALUES ($1, $2, $3, $4::timestamptz)
            ON CONFLICT (application_id, model_name) DO NOTHING`,
            [applicationId, model, statusSchemaVersion, instant],
          );
          const stateRows = await transaction.unsafe(
            `SELECT status_schema_version, cursor, activated_count, completed
             FROM ${activations}
             WHERE application_id = $1 AND model_name = $2
             FOR UPDATE`,
            [applicationId, model],
          );
          const state = stateRows[0];
          if (!state) throw new Error(`Managed-model ${model} activation state was not persisted.`);
          if (String(state.status_schema_version) !== statusSchemaVersion) {
            throw new Error(
              `Managed-model ${model} activation requires status schema ${String(state.status_schema_version)} to migrate to ${statusSchemaVersion}.`,
            );
          }
          if (state.completed === true) return { activated: 0, completed: true };
          const cursor = state.cursor === null || state.cursor === undefined
            ? undefined
            : decodeIdentity(jsonValue(state.cursor));
          const scanned = await activationOptions.scanPage({
            ...(cursor === undefined ? {} : { cursor }),
            limit: pageSize,
            transaction,
          });
          if (scanned.items.length > pageSize) {
            throw new Error(`Managed-model ${model} activation scan exceeded its requested page size.`);
          }
          for (const item of scanned.items) {
            const existingRows = await transaction.unsafe(
              `SELECT status_schema_version FROM ${lifecycle}
               WHERE application_id = $1 AND model_name = $2 AND identity_key = $3`,
              [applicationId, model, identityKey(item.identity)],
            );
            const existing = existingRows[0];
            if (existing) {
              if (String(existing.status_schema_version) !== statusSchemaVersion) {
                throw new Error(
                  `Managed-model ${model}/${identityKey(item.identity)} requires status schema ${String(existing.status_schema_version)} to migrate to ${statusSchemaVersion}.`,
                );
              }
              continue;
            }
            await store.observeDesired(item.identity, item.value, activationOptions.initialStatus, {
              now: instant,
              transaction,
            });
          }
          const nextCursor = scanned.nextCursor;
          if (nextCursor !== undefined && cursor !== undefined && identityKey(nextCursor) === identityKey(cursor)) {
            throw new Error(`Managed-model ${model} activation scan did not advance its cursor.`);
          }
          const completed = nextCursor === undefined;
          await transaction.unsafe(
            `UPDATE ${activations} SET cursor = $3::jsonb,
              activated_count = activated_count + $4,
              completed = $5, updated_at = $6::timestamptz
             WHERE application_id = $1 AND model_name = $2`,
            [applicationId, model, nextCursor === undefined ? null : JSON.stringify(nextCursor), scanned.items.length, completed, instant],
          );
          return { activated: scanned.items.length, completed };
        });
        activated += result.activated;
        if (result.completed) return { activated, completed: true };
      }
      return { activated, completed: false };
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
      if (applicationManagedModelDesiredDigest(next) === applicationManagedModelDesiredDigest(current.metadata.finalizers)) return current;
      return mutate(precondition, 'finalizers = $8::jsonb', [JSON.stringify(next)]);
    },
    async removeFinalizer(precondition, finalizer) {
      const current = await select(precondition.id);
      if (!current) throw stale(precondition);
      return mutate(precondition, 'finalizers = $8::jsonb', [JSON.stringify(current.metadata.finalizers.filter((value) => value !== finalizer))]);
    },
    async complete(precondition, completeOptions) {
      return sql.begin(async (transaction) => {
        const record = await mutate(
          precondition,
          'invalidated = false, next_due_at = $8::timestamptz, lease_expires_at = NULL, reconcile_id = NULL, last_error = NULL',
          [completeOptions.nextDueAt ?? null],
          transaction,
        );
        if (
          record.metadata.deletionTimestamp
          && record.metadata.finalizers.length === 0
          && !completeOptions.nextDueAt
        ) {
          if (!options.deleteValue) {
            throw new Error(
              `Managed-model ${model}/${identityKey(precondition.id)} completed finalizers but has no transactional domain-row deletion binding.`,
            );
          }
          await options.deleteValue(precondition.id, transaction);
        }
        return record;
      });
    },
    async release(precondition, releaseOptions) {
      await mutate(precondition, 'invalidated = false, next_due_at = $8::timestamptz, lease_expires_at = NULL, reconcile_id = NULL, last_error = $9', [releaseOptions.retryAt ?? null, releaseOptions.error ?? null]);
    },
    async close() { if (ownsSql) await sql.end(); },
  };
  return store;
}

const managedColumns = `identity, uid, generation, resource_version, created_at, deletion_timestamp, deletion_value,
  finalizers, status, conditions, next_due_at, invalidated, lease_fence, lease_expires_at, reconcile_id, attempt`;

function stale<TIdentity>(precondition: ApplicationManagedModelCommitPrecondition<TIdentity>) {
  return new ApplicationManagedModelConflictError(`Managed-model ${precondition.model}/${applicationManagedModelIdentityKey(precondition.id)} rejected a stale UID, generation, resource version, or fence.`);
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

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`PostgreSQL managed-model ${label} must be a positive integer.`);
  }
  return value;
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
