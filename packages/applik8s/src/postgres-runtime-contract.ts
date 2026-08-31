export interface ApplicationPostgresEndOptions {
  readonly timeout?: number;
}

export interface ApplicationPostgresSql {
  unsafe(query: string, parameters?: readonly unknown[]): Promise<readonly Record<string, unknown>[]>;
  begin<TResult>(operation: (transaction: ApplicationPostgresTransactionSql) => Promise<TResult>): Promise<TResult>;
  end(options?: ApplicationPostgresEndOptions): Promise<void>;
}

export interface ApplicationPostgresTransactionSql {
  unsafe(query: string, parameters?: readonly unknown[]): Promise<readonly Record<string, unknown>[]>;
  json(value: unknown): unknown;
  /**
   * Drizzle transaction bound to this exact PostgreSQL transaction. Runtime
   * adapters populate it so function-native views observe staged model writes
   * and use savepoints instead of opening an inconsistent sibling connection.
   */
  readonly database?: unknown;
}

export interface ApplicationPostgresClientOptions {
  readonly max?: number;
  readonly idle_timeout?: number;
  readonly connect_timeout?: number;
  readonly prepare?: boolean;
}

/** Stable identity used by every PostgreSQL managed-model adapter. */
export function applicationManagedModelIdentityKey(identity: unknown): string {
  return createHash('sha256')
    .update(canonicalJsonV1String(identity, canonicalJsonCompatibleV1Policy))
    .digest('hex');
}

/** Stable desired-value digest shared by mutation and reconciliation runtimes. */
export function applicationManagedModelDesiredDigest(value: unknown): string {
  return createHash('sha256')
    .update(canonicalJsonV1String(value, canonicalJsonCompatibleV1Policy))
    .digest('hex');
}

/**
 * Versioned PostgreSQL authority used by managed relational models. The tables
 * are database-global and model/application scoped, so ordinary generated
 * model migrations may install them before `.managed()` is replayed.
 */
export function applicationManagedModelPostgresMigrationSql(schema = 'public'): readonly string[] {
  const namespace = postgresIdentifier(schema, 'managed-model schema');
  const lifecycle = `${namespace}.applik8s_managed_model_lifecycle`;
  const invalidations = `${namespace}.applik8s_managed_model_invalidations`;
  const activations = `${namespace}.applik8s_managed_model_activations`;
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
      deletion_value jsonb,
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
    `ALTER TABLE ${lifecycle} ADD COLUMN IF NOT EXISTS deletion_value jsonb`,
    `CREATE TABLE IF NOT EXISTS ${invalidations} (
      sequence bigserial PRIMARY KEY,
      application_id text NOT NULL,
      model_name text NOT NULL,
      identity_key text NOT NULL,
      generation bigint NOT NULL,
      resource_version bigint NOT NULL,
      recorded_at timestamptz NOT NULL,
      UNIQUE (application_id, model_name, identity_key, resource_version)
    )`,
    `ALTER TABLE ${invalidations} ADD COLUMN IF NOT EXISTS resource_version bigint`,
    `UPDATE ${invalidations} SET resource_version = generation WHERE resource_version IS NULL`,
    `ALTER TABLE ${invalidations} ALTER COLUMN resource_version SET NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS applik8s_managed_model_invalidation_version_uq
      ON ${invalidations} (application_id, model_name, identity_key, resource_version)`,
    `CREATE TABLE IF NOT EXISTS ${activations} (
      application_id text NOT NULL,
      model_name text NOT NULL,
      status_schema_version text NOT NULL,
      cursor jsonb,
      activated_count bigint NOT NULL DEFAULT 0,
      completed boolean NOT NULL DEFAULT false,
      updated_at timestamptz NOT NULL,
      PRIMARY KEY (application_id, model_name)
    )`,
  ];
}

function postgresIdentifier(value: string, label: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value)) {
    throw new Error(`${label} must be a PostgreSQL identifier.`);
  }
  return `"${value.replaceAll('"', '""')}"`;
}
import { createHash } from 'node:crypto';
import { canonicalJsonCompatibleV1Policy, canonicalJsonV1String } from '@applik8s/core';
