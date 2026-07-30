// typecast-file-boundary: PostgreSQL JSONB session documents are restored only
// after durable identity, catalog, lifecycle, and version columns are checked.
import type {
  ApplicationCatalogRevisionId,
  ApplicationOperationCatalog,
} from '@applik8s/core';
import {
  type ApplicationOperationCatalogRepository,
  PostgresApplicationOperationCatalogRepository,
} from '@applik8s/operations';
import type { JSONValue, Sql, TransactionSql } from 'postgres';
import type {
  ApplicationMcpCatalogSource,
  ApplicationMcpSession,
  ApplicationMcpSessionStore,
} from './contracts.js';

export interface PostgresApplicationMcpStoresOptions {
  readonly sql: Sql;
  readonly application: string;
  readonly schema?: string;
}

export interface PostgresApplicationMcpStores {
  readonly sessions: ApplicationMcpSessionStore;
  readonly catalog: ApplicationMcpCatalogSource;
  readonly prepare: () => Promise<void>;
}

interface McpTableNames {
  readonly sessions: string;
}

/**
 * Creates the default durable MCP state boundary.
 *
 * Session insertion/closure and operation-catalog references commit in the
 * same PostgreSQL transaction. A process crash therefore cannot leave an
 * executable session unpinned or a closed session blocking catalog retirement.
 */
export function createPostgresApplicationMcpStores(
  options: PostgresApplicationMcpStoresOptions,
): PostgresApplicationMcpStores {
  const application = requiredIdentity(options.application, 'application');
  const names = tableNames(options.schema ?? 'public');
  const repository = new PostgresApplicationOperationCatalogRepository(
    options.sql,
  );
  let prepared: Promise<void> | undefined;
  const prepare = () => {
    prepared ??= prepareStores(options.sql, names, repository).catch((error) => {
      prepared = undefined;
      throw error;
    });
    return prepared;
  };
  return Object.freeze({
    sessions: postgresSessionStore(
      options.sql,
      names,
      application,
      prepare,
    ),
    catalog: postgresCatalogSource(repository, prepare),
    prepare,
  });
}

function postgresSessionStore(
  sql: Sql,
  names: McpTableNames,
  application: string,
  prepare: () => Promise<void>,
): ApplicationMcpSessionStore {
  return {
    async create(session) {
      await prepare();
      assertSession(session);
      return sql.begin(async (transaction) => {
        const rows = await transaction.unsafe(
          `INSERT INTO ${names.sessions}
             (application, id, server_id, catalog_revision, state, expires_at,
              version, record)
           VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7, $8::jsonb)
           ON CONFLICT (application, id) DO NOTHING
           RETURNING application, id, server_id, catalog_revision, state,
                     expires_at, version, record`,
          [
            application,
            session.id,
            session.serverId,
            session.catalogRevision,
            session.state,
            session.expiresAt,
            session.version,
            postgresJson(session),
          ],
        );
        const created = sessionRecord(rows[0], application);
        if (!created) throw new Error(`MCP session ${session.id} already exists.`);
        await putCatalogReference(
          transaction,
          application,
          session.catalogRevision,
          session.id,
        );
        return created;
      });
    },

    async get(sessionId) {
      await prepare();
      return sessionRecord(
        (
          await sql.unsafe(
            `SELECT application, id, server_id, catalog_revision, state,
                    expires_at, version, record
             FROM ${names.sessions}
             WHERE application = $1 AND id = $2`,
            [application, requiredIdentity(sessionId, 'session id')],
          )
        )[0],
        application,
      );
    },

    async replace(session, expectedVersion) {
      await prepare();
      assertSession(session);
      assertNextVersion(session, expectedVersion);
      return sql.begin(async (transaction) => {
        const current = sessionRecord(
          (
            await transaction.unsafe(
              `SELECT application, id, server_id, catalog_revision, state,
                      expires_at, version, record
               FROM ${names.sessions}
               WHERE application = $1 AND id = $2
               FOR UPDATE`,
              [application, session.id],
            )
          )[0],
          application,
        );
        if (!current || current.version !== expectedVersion) {
          throw concurrencyError(session.id, expectedVersion);
        }
        assertImmutableSessionIdentity(current, session);
        const rows = await transaction.unsafe(
          `UPDATE ${names.sessions}
           SET state = $3,
               expires_at = $4::timestamptz,
               version = $5,
               record = $6::jsonb,
               updated_at = now()
           WHERE application = $1 AND id = $2 AND version = $7
           RETURNING application, id, server_id, catalog_revision, state,
                     expires_at, version, record`,
          [
            application,
            session.id,
            session.state,
            session.expiresAt,
            session.version,
            postgresJson(session),
            expectedVersion,
          ],
        );
        const replaced = sessionRecord(rows[0], application);
        if (!replaced) throw concurrencyError(session.id, expectedVersion);
        if (session.state === 'closed') {
          await removeCatalogReference(
            transaction,
            application,
            session.catalogRevision,
            session.id,
          );
        } else {
          await putCatalogReference(
            transaction,
            application,
            session.catalogRevision,
            session.id,
          );
        }
        return replaced;
      });
    },

    async list(input) {
      await prepare();
      if (
        !Number.isSafeInteger(input.limit)
        || input.limit < 1
        || input.limit > 10_000
      ) {
        throw new Error('MCP session list limit must be between 1 and 10000.');
      }
      const states = [...new Set(input.states)];
      if (
        states.length === 0
        || states.some(
          (state) =>
            state !== 'active'
            && state !== 'draining'
            && state !== 'closed',
        )
      ) {
        throw new Error('MCP session list requires valid lifecycle states.');
      }
      const rows = await sql.unsafe(
        `SELECT application, id, server_id, catalog_revision, state,
                expires_at, version, record
         FROM ${names.sessions}
         WHERE application = $1
           AND server_id = $2
           AND state = ANY($3::text[])
         ORDER BY expires_at, id
         LIMIT $4`,
        [
          application,
          requiredIdentity(input.serverId, 'server id'),
          states,
          input.limit,
        ],
      );
      return rows.map((row) => requiredRecord(
        sessionRecord(row, application),
        'MCP session',
      ));
    },
  };
}

function postgresCatalogSource(
  repository: ApplicationOperationCatalogRepository,
  prepare: () => Promise<void>,
): ApplicationMcpCatalogSource {
  return {
    async active(application) {
      await prepare();
      const active = (await repository.list(application)).filter(
        (catalog) => catalog.state === 'active',
      );
      if (active.length !== 1) {
        throw new Error(
          `Application ${application} requires exactly one active operation catalog; found ${active.length}.`,
        );
      }
      const catalog = active[0];
      if (!catalog) {
        throw new Error(
          `Application ${application} active operation catalog disappeared during resolution.`,
        );
      }
      return {
        revision: catalog.revision,
        operations: structuredClone(catalog.operations),
      };
    },
    async get(application, revision) {
      await prepare();
      const catalog = await repository.get(application, revision);
      return catalog ? catalogSnapshot(catalog) : undefined;
    },
    async reference(application, revision, sessionId) {
      await prepare();
      await repository.putReference(
        application,
        revision,
        'session',
        sessionId,
      );
    },
    async release(application, revision, sessionId) {
      await prepare();
      await repository.removeReference(
        application,
        revision,
        'session',
        sessionId,
      );
    },
  };
}

async function prepareStores(
  sql: Sql,
  names: McpTableNames,
  repository: ApplicationOperationCatalogRepository,
): Promise<void> {
  const prepare = Reflect.get(repository, 'prepare');
  if (typeof prepare === 'function') await prepare.call(repository);
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ${names.sessions} (
      application text NOT NULL,
      id text NOT NULL,
      server_id text NOT NULL,
      catalog_revision text NOT NULL,
      state text NOT NULL
        CHECK (state IN ('active', 'draining', 'closed')),
      expires_at timestamptz NOT NULL,
      version integer NOT NULL CHECK (version > 0),
      record jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (application, id)
    );
    CREATE INDEX IF NOT EXISTS ${indexName(names.sessions, 'reap')}
      ON ${names.sessions} (application, server_id, state, expires_at, id)
      WHERE state IN ('active', 'draining')
  `);
}

async function putCatalogReference(
  transaction: TransactionSql,
  application: string,
  revision: ApplicationCatalogRevisionId,
  sessionId: string,
): Promise<void> {
  await transaction.unsafe(
    `INSERT INTO applik8s_operation_catalog_references
       (application, revision, kind, reference_id)
     VALUES ($1, $2, 'session', $3)
     ON CONFLICT DO NOTHING`,
    [application, revision, sessionId],
  );
}

async function removeCatalogReference(
  transaction: TransactionSql,
  application: string,
  revision: ApplicationCatalogRevisionId,
  sessionId: string,
): Promise<void> {
  await transaction.unsafe(
    `DELETE FROM applik8s_operation_catalog_references
     WHERE application = $1
       AND revision = $2
       AND kind = 'session'
       AND reference_id = $3`,
    [application, revision, sessionId],
  );
}

function catalogSnapshot(catalog: ApplicationOperationCatalog) {
  return {
    revision: catalog.revision,
    state: catalog.state,
    operations: structuredClone(catalog.operations),
  };
}

function sessionRecord(
  row: Record<string, unknown> | undefined,
  application: string,
): ApplicationMcpSession | undefined {
  if (!row) return undefined;
  const record = jsonObject(row.record, 'MCP session');
  const expiresAt = timestamp(row.expires_at);
  if (
    row.application !== application
    || record.apiVersion !== 'applik8s.mcpSession/v1alpha1'
    || record.id !== row.id
    || record.serverId !== row.server_id
    || record.catalogRevision !== row.catalog_revision
    || record.state !== row.state
    || record.expiresAt !== expiresAt
    || record.version !== row.version
  ) {
    throw new Error('PostgreSQL MCP session identity/version is inconsistent.');
  }
  const session = structuredClone(record) as unknown as ApplicationMcpSession;
  assertSession(session);
  return session;
}

function assertSession(session: ApplicationMcpSession): void {
  requiredIdentity(session.id, 'session id');
  requiredIdentity(session.serverId, 'server id');
  requiredIdentity(session.serverRevision, 'server revision');
  requiredIdentity(session.catalogRevision, 'catalog revision');
  requiredIdentity(session.principalId, 'principal id');
  requiredIdentity(session.principalIdentityId, 'principal identity id');
  requiredIdentity(session.audience, 'audience');
  requiredIdentity(
    session.authorityRevisionAtInitialization,
    'authority revision',
  );
  if (
    session.apiVersion !== 'applik8s.mcpSession/v1alpha1'
    || session.protocolRevision !== '2025-11-25'
    || !['active', 'draining', 'closed'].includes(session.state)
    || !Number.isSafeInteger(session.version)
    || session.version < 1
    || Number.isNaN(Date.parse(session.issuedAt))
    || Number.isNaN(Date.parse(session.expiresAt))
    || Date.parse(session.expiresAt) <= Date.parse(session.issuedAt)
  ) {
    throw new Error(`MCP session ${session.id} is invalid.`);
  }
}

function assertNextVersion(
  session: ApplicationMcpSession,
  expectedVersion: number,
): void {
  if (
    !Number.isSafeInteger(expectedVersion)
    || expectedVersion < 1
    || session.version !== expectedVersion + 1
  ) {
    throw new Error(
      `MCP session ${session.id} replacement must advance version ${expectedVersion} by exactly one.`,
    );
  }
}

function assertImmutableSessionIdentity(
  current: ApplicationMcpSession,
  replacement: ApplicationMcpSession,
): void {
  const immutable = [
    'serverId',
    'serverRevision',
    'protocolRevision',
    'catalogRevision',
    'principalId',
    'principalIdentityId',
    'audience',
    'issuedAt',
  ] as const;
  const changed = immutable.find(
    (field) => current[field] !== replacement[field],
  );
  if (changed) {
    throw new Error(
      `MCP session ${current.id} cannot change immutable ${changed}.`,
    );
  }
}

function tableNames(schema: string): McpTableNames {
  const safeSchema = identifier(schema, 'PostgreSQL schema');
  return { sessions: `${safeSchema}.applik8s_mcp_sessions` };
}

function indexName(table: string, suffix: string): string {
  return identifier(
    `${table.slice(table.lastIndexOf('.') + 1)}_${suffix}_idx`,
    'PostgreSQL index',
  );
}

function identifier(value: string, label: string): string {
  if (!/^[a-z_][a-z0-9_]*$/u.test(value)) {
    throw new Error(`${label} ${JSON.stringify(value)} is not a safe identifier.`);
  }
  return value;
}

function requiredIdentity(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`MCP ${label} must not be empty.`);
  return normalized;
}

function timestamp(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new Error('PostgreSQL MCP session expiry is invalid.');
  }
  return date.toISOString();
}

function jsonObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`PostgreSQL ${label} is not a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function requiredRecord<T>(value: T | undefined, label: string): T {
  if (!value) throw new Error(`PostgreSQL returned an empty ${label} row.`);
  return value;
}

function concurrencyError(id: string, expectedVersion: number): Error {
  return new Error(
    `MCP session ${id} changed concurrently or is unavailable; expected version ${expectedVersion}.`,
  );
}

function postgresJson(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}
