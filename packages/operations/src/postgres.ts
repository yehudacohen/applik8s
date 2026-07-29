import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  ApplicationApprovalRecord,
  ApplicationAuditEvent,
  ApplicationDelegationRecord,
  ApplicationGrantRecord,
  ApplicationGrantRequestRecord,
  ApplicationGrantReservation,
  ApplicationOperationCatalog,
  ApplicationOutcomeDefinition,
  ApplicationPermissionRecord,
  ApplicationRevocationTombstone,
  ApplicationRoleRecord,
} from '@applik8s/core';
import type {
  ApplicationAuthorityRepository,
  ApplicationAuthoritySnapshot,
} from './authority.js';
import type {
  ApplicationCatalogReferenceSnapshot,
  ApplicationOperationCatalogRepository,
} from './catalog.js';

export interface ApplicationAuthorityPostgresTransaction {
  unsafe(query: string, parameters?: readonly unknown[]): Promise<readonly Record<string, unknown>[]>;
  json?(value: unknown): unknown;
}

export interface ApplicationAuthorityPostgresSql extends ApplicationAuthorityPostgresTransaction {
  begin<T>(work: (transaction: ApplicationAuthorityPostgresTransaction) => Promise<T>): Promise<T>;
}

type AuthorityRecord =
  | ApplicationPermissionRecord
  | ApplicationRoleRecord
  | ApplicationGrantRecord
  | ApplicationDelegationRecord
  | ApplicationGrantRequestRecord
  | ApplicationApprovalRecord
  | ApplicationOutcomeDefinition
  | ApplicationGrantReservation
  | ApplicationRevocationTombstone;

export const applicationAuthorityPostgresSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS applik8s_authority_revisions (
    application text PRIMARY KEY,
    revision bigint NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS applik8s_authority_records (
    application text NOT NULL,
    kind text NOT NULL,
    id text NOT NULL,
    document jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (application, kind, id)
  )`,
  `CREATE TABLE IF NOT EXISTS applik8s_authority_audit (
    application text NOT NULL,
    id text NOT NULL,
    document jsonb NOT NULL,
    occurred_at timestamptz NOT NULL,
    PRIMARY KEY (application, id)
  )`,
  `CREATE TABLE IF NOT EXISTS applik8s_operation_catalogs (
    application text NOT NULL,
    revision text NOT NULL,
    document jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (application, revision)
  )`,
  `CREATE TABLE IF NOT EXISTS applik8s_operation_catalog_references (
    application text NOT NULL,
    revision text NOT NULL,
    kind text NOT NULL,
    reference_id text NOT NULL,
    PRIMARY KEY (application, revision, kind, reference_id)
  )`,
] as const;

export async function prepareApplicationAuthorityPostgres(sql: ApplicationAuthorityPostgresSql): Promise<void> {
  for (const statement of applicationAuthorityPostgresSchemaStatements) await sql.unsafe(statement);
}

/**
 * Canonical authority repository. Every service transaction takes a
 * PostgreSQL advisory transaction lock scoped to the application, so use
 * reservations, approval transitions, revision writes, and revocation
 * evidence remain serialized across replicas rather than merely per process.
 */
export class PostgresApplicationAuthorityRepository implements ApplicationAuthorityRepository {
  readonly #sql: ApplicationAuthorityPostgresSql;
  readonly #application: string;
  readonly #active = new AsyncLocalStorage<ApplicationAuthorityPostgresTransaction>();

  constructor(sql: ApplicationAuthorityPostgresSql, application: string) {
    if (!application.trim()) throw new Error('PostgreSQL authority repository requires a non-empty application name.');
    this.#sql = sql;
    this.#application = application;
  }

  async prepare(): Promise<void> {
    await prepareApplicationAuthorityPostgres(this.#sql);
  }

  /**
   * Binds authority reads and writes to an already-open application
   * transaction. This is the pre-commit seam used by transactional model
   * operations: revocation is checked in the same PostgreSQL transaction that
   * will commit the model and outbox effects.
   */
  async withinTransaction<T>(
    transaction: ApplicationAuthorityPostgresTransaction,
    work: () => Promise<T>,
  ): Promise<T> {
    if (this.#active.getStore()) return work();
    await transaction.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`applik8s.authority:${this.#application}`]);
    return this.#active.run(transaction, work);
  }

  async snapshot(): Promise<ApplicationAuthoritySnapshot> {
    const sql = this.#current();
    // Keep transaction-bound reads sequential. Some PostgreSQL adapters allow
    // parallel queries on a pool but not on one checked-out transaction
    // connection; the authority snapshot must work with either contract.
    const revisionRows = await sql.unsafe(
      'SELECT revision FROM applik8s_authority_revisions WHERE application = $1',
      [this.#application],
    );
    const recordRows = await sql.unsafe(
      'SELECT kind, document FROM applik8s_authority_records WHERE application = $1 ORDER BY kind, id',
      [this.#application],
    );
    const byKind = new Map<string, AuthorityRecord[]>();
    for (const row of recordRows) {
      const kind = String(row.kind ?? '');
      const records = byKind.get(kind) ?? [];
      records.push(jsonDocument<AuthorityRecord>(row.document));
      byKind.set(kind, records);
    }
    return {
      revision: String(revisionRows[0]?.revision ?? 0),
      permissions: records<ApplicationPermissionRecord>(byKind, 'permission'),
      roles: records<ApplicationRoleRecord>(byKind, 'role'),
      grants: records<ApplicationGrantRecord>(byKind, 'grant'),
      delegations: records<ApplicationDelegationRecord>(byKind, 'delegation'),
      requests: records<ApplicationGrantRequestRecord>(byKind, 'request'),
      approvals: records<ApplicationApprovalRecord>(byKind, 'approval'),
      outcomes: records<ApplicationOutcomeDefinition>(byKind, 'outcome'),
      reservations: records<ApplicationGrantReservation>(byKind, 'reservation'),
      tombstones: records<ApplicationRevocationTombstone>(byKind, 'tombstone'),
    };
  }

  putPermission(record: ApplicationPermissionRecord): Promise<void> { return this.#put('permission', record); }
  putRole(record: ApplicationRoleRecord): Promise<void> { return this.#put('role', record); }
  putGrant(record: ApplicationGrantRecord): Promise<void> { return this.#put('grant', record); }
  putDelegation(record: ApplicationDelegationRecord): Promise<void> { return this.#put('delegation', record); }
  putRequest(record: ApplicationGrantRequestRecord): Promise<void> { return this.#put('request', record); }
  putApproval(record: ApplicationApprovalRecord): Promise<void> { return this.#put('approval', record); }
  putOutcome(record: ApplicationOutcomeDefinition): Promise<void> { return this.#put('outcome', record); }
  putReservation(record: ApplicationGrantReservation): Promise<void> { return this.#put('reservation', record); }
  putTombstone(record: ApplicationRevocationTombstone): Promise<void> { return this.#put('tombstone', record); }

  async putCatalogReference(
    revision: string,
    kind: 'grant' | 'envelope' | 'workflow' | 'session',
    referenceId: string,
  ): Promise<void> {
    await this.#mutate(async (sql) => {
      await sql.unsafe(
        `INSERT INTO applik8s_operation_catalog_references (application, revision, kind, reference_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [this.#application, revision, kind, referenceId],
      );
    });
  }

  async removeCatalogReference(
    revision: string,
    kind: 'grant' | 'envelope' | 'workflow' | 'session',
    referenceId: string,
  ): Promise<void> {
    await this.#mutate(async (sql) => {
      await sql.unsafe(
        `DELETE FROM applik8s_operation_catalog_references
         WHERE application = $1 AND revision = $2 AND kind = $3 AND reference_id = $4`,
        [this.#application, revision, kind, referenceId],
      );
    });
  }

  async appendAudit(event: ApplicationAuditEvent): Promise<void> {
    await this.#mutate(async (sql) => {
      await sql.unsafe(
        `INSERT INTO applik8s_authority_audit (application, id, document, occurred_at)
         VALUES ($1, $2, $3::jsonb, $4::timestamptz)
         ON CONFLICT (application, id) DO NOTHING`,
        [this.#application, event.id, jsonParameter(sql, event), event.occurredAt],
      );
      await bumpRevision(sql, this.#application);
    });
  }

  async transaction<T>(work: () => Promise<T>): Promise<T> {
    if (this.#active.getStore()) return work();
    return this.#sql.begin(async (transaction) => {
      await transaction.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`applik8s.authority:${this.#application}`]);
      await ensureRevisionRow(transaction, this.#application);
      return this.#active.run(transaction, work);
    });
  }

  async #put(kind: string, record: AuthorityRecord): Promise<void> {
    await this.#mutate(async (sql) => {
      await sql.unsafe(
        `INSERT INTO applik8s_authority_records (application, kind, id, document, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, now())
         ON CONFLICT (application, kind, id)
         DO UPDATE SET document = EXCLUDED.document, updated_at = now()`,
        [this.#application, kind, record.id, jsonParameter(sql, record)],
      );
      await bumpRevision(sql, this.#application);
    });
  }

  async #mutate(work: (sql: ApplicationAuthorityPostgresTransaction) => Promise<void>): Promise<void> {
    const active = this.#active.getStore();
    if (active) return work(active);
    await this.transaction(async () => work(this.#current()));
  }

  #current(): ApplicationAuthorityPostgresTransaction {
    return this.#active.getStore() ?? this.#sql;
  }
}

export class PostgresApplicationOperationCatalogRepository implements ApplicationOperationCatalogRepository {
  readonly #sql: ApplicationAuthorityPostgresSql;
  readonly #active = new AsyncLocalStorage<ApplicationAuthorityPostgresTransaction>();

  constructor(sql: ApplicationAuthorityPostgresSql) {
    this.#sql = sql;
  }

  async prepare(): Promise<void> {
    await prepareApplicationAuthorityPostgres(this.#sql);
  }

  /** Binds catalog reads and references to an already-open application transaction. */
  async withinTransaction<T>(
    application: string,
    transaction: ApplicationAuthorityPostgresTransaction,
    work: () => Promise<T>,
  ): Promise<T> {
    if (this.#active.getStore()) return work();
    await transaction.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`applik8s.catalog:${application}`]);
    return this.#active.run(transaction, work);
  }

  async list(application: string): Promise<readonly ApplicationOperationCatalog[]> {
    const rows = await this.#current().unsafe(
      'SELECT document FROM applik8s_operation_catalogs WHERE application = $1 ORDER BY revision',
      [application],
    );
    return rows.map((row) => jsonDocument<ApplicationOperationCatalog>(row.document));
  }

  async get(application: string, revision: string): Promise<ApplicationOperationCatalog | undefined> {
    const rows = await this.#current().unsafe(
      'SELECT document FROM applik8s_operation_catalogs WHERE application = $1 AND revision = $2',
      [application, revision],
    );
    return rows[0] ? jsonDocument<ApplicationOperationCatalog>(rows[0].document) : undefined;
  }

  async put(catalog: ApplicationOperationCatalog): Promise<void> {
    await this.#mutate(catalog.application, async (sql) => {
      await sql.unsafe(
        `INSERT INTO applik8s_operation_catalogs (application, revision, document, updated_at)
         VALUES ($1, $2, $3::jsonb, now())
         ON CONFLICT (application, revision)
         DO UPDATE SET document = EXCLUDED.document, updated_at = now()`,
        [catalog.application, catalog.revision, jsonParameter(sql, catalog)],
      );
    });
  }

  async references(application: string, revision: string): Promise<ApplicationCatalogReferenceSnapshot> {
    const rows = await this.#current().unsafe(
      `SELECT kind, reference_id
       FROM applik8s_operation_catalog_references
       WHERE application = $1 AND revision = $2
       ORDER BY kind, reference_id`,
      [application, revision],
    );
    const values = (kind: string) => rows.filter((row) => row.kind === kind).map((row) => String(row.reference_id));
    return {
      grantIds: values('grant'),
      envelopeIds: values('envelope'),
      workflowIds: values('workflow'),
      sessionIds: values('session'),
    };
  }

  async putReference(
    application: string,
    revision: string,
    kind: 'grant' | 'envelope' | 'workflow' | 'session',
    referenceId: string,
  ): Promise<void> {
    await this.#mutate(application, async (sql) => {
      await sql.unsafe(
        `INSERT INTO applik8s_operation_catalog_references (application, revision, kind, reference_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [application, revision, kind, referenceId],
      );
    });
  }

  async removeReference(
    application: string,
    revision: string,
    kind: 'grant' | 'envelope' | 'workflow' | 'session',
    referenceId: string,
  ): Promise<void> {
    await this.#mutate(application, async (sql) => {
      await sql.unsafe(
        `DELETE FROM applik8s_operation_catalog_references
         WHERE application = $1 AND revision = $2 AND kind = $3 AND reference_id = $4`,
        [application, revision, kind, referenceId],
      );
    });
  }

  async transaction<T>(application: string, work: () => Promise<T>): Promise<T> {
    if (this.#active.getStore()) return work();
    return this.#sql.begin(async (transaction) => {
      await transaction.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`applik8s.catalog:${application}`]);
      return this.#active.run(transaction, work);
    });
  }

  async #mutate(
    application: string,
    work: (sql: ApplicationAuthorityPostgresTransaction) => Promise<void>,
  ): Promise<void> {
    const active = this.#active.getStore();
    if (active) return work(active);
    await this.#sql.begin(async (transaction) => {
      await transaction.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`applik8s.catalog:${application}`]);
      return this.#active.run(transaction, () => work(transaction));
    });
  }

  #current(): ApplicationAuthorityPostgresTransaction {
    return this.#active.getStore() ?? this.#sql;
  }
}

async function ensureRevisionRow(sql: ApplicationAuthorityPostgresTransaction, application: string): Promise<void> {
  await sql.unsafe(
    `INSERT INTO applik8s_authority_revisions (application, revision)
     VALUES ($1, 0)
     ON CONFLICT (application) DO NOTHING`,
    [application],
  );
}

async function bumpRevision(sql: ApplicationAuthorityPostgresTransaction, application: string): Promise<void> {
  await ensureRevisionRow(sql, application);
  await sql.unsafe(
    'UPDATE applik8s_authority_revisions SET revision = revision + 1 WHERE application = $1',
    [application],
  );
}

function records<T extends AuthorityRecord>(values: ReadonlyMap<string, AuthorityRecord[]>, kind: string): readonly T[] {
  // typecast: the repository's closed kind discriminator determines the
  // document record type at each call site after JSONB deserialization.
  return (values.get(kind) ?? []) as unknown as readonly T[];
}

function jsonParameter(sql: ApplicationAuthorityPostgresTransaction, value: unknown): unknown {
  return sql.json ? sql.json(value) : JSON.stringify(value);
}

function jsonDocument<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}
