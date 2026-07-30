import type { ApplicationOperationCatalog } from '@applik8s/core';
import type { ApplicationMcpSession } from '@applik8s/mcp';
import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';
import { createPostgresApplicationMcpStores } from '../src/postgres.js';

describe('PostgreSQL MCP stores', () => {
  it('reads the one active operation catalog through the canonical repository', async () => {
    const database = new FakePostgres();
    database.catalogs.set('catalog-1', catalog('catalog-1', 'active'));
    const stores = createPostgresApplicationMcpStores({
      // typecast: the fake implements the unsafe/begin subset exercised by the
      // adapter and records every durable statement for contract assertions.
      sql: database as unknown as Sql,
      application: 'research',
      schema: 'mcp_test',
    });

    await expect(stores.catalog.active('research')).resolves.toEqual({
      revision: 'catalog-1',
      operations: [],
    });
    await expect(stores.catalog.get('research', 'catalog-1')).resolves.toEqual({
      revision: 'catalog-1',
      state: 'active',
      operations: [],
    });
  });

  it('pins session creation and closure to catalog references', async () => {
    const database = new FakePostgres();
    database.catalogs.set('catalog-1', catalog('catalog-1', 'active'));
    const stores = createPostgresApplicationMcpStores({
      // typecast: see the contract note above.
      sql: database as unknown as Sql,
      application: 'research',
      schema: 'mcp_test',
    });
    const initial = session();

    await expect(stores.sessions.create(initial)).resolves.toEqual(initial);
    expect(database.references).toEqual(
      new Set(['research:catalog-1:session-1']),
    );
    await expect(stores.sessions.get(initial.id)).resolves.toEqual(initial);
    await expect(
      stores.sessions.list({
        serverId: initial.serverId,
        states: ['active'],
        limit: 10,
      }),
    ).resolves.toEqual([initial]);

    const closed: ApplicationMcpSession = {
      ...initial,
      state: 'closed',
      version: 2,
    };
    await expect(stores.sessions.replace(closed, 1)).resolves.toEqual(closed);
    expect(database.references).toEqual(new Set());
  });

  it('permits one compare-and-swap replacement and preserves immutable pinning', async () => {
    const database = new FakePostgres();
    const stores = createPostgresApplicationMcpStores({
      // typecast: see the contract note above.
      sql: database as unknown as Sql,
      application: 'research',
    });
    const initial = session();
    await stores.sessions.create(initial);
    const candidates: ApplicationMcpSession[] = [
      { ...initial, state: 'draining', version: 2 },
      { ...initial, state: 'closed', version: 2 },
    ];
    const results = await Promise.allSettled(
      candidates.map((candidate) => stores.sessions.replace(candidate, 1)),
    );

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(
      1,
    );
    const current = await stores.sessions.get(initial.id);
    if (!current) throw new Error('Expected one current MCP session.');
    await expect(
      stores.sessions.replace(
        {
          ...current,
          audience: 'https://other.example.test/mcp',
          version: 3,
        },
        2,
      ),
    ).rejects.toThrow(/immutable audience/u);
  });

  it('rejects unsafe schemas and unbounded list requests', async () => {
    const database = new FakePostgres();
    expect(() =>
      createPostgresApplicationMcpStores({
        // typecast: see the contract note above.
        sql: database as unknown as Sql,
        application: 'research',
        schema: 'public;drop schema public',
      }),
    ).toThrow(/safe identifier/u);
    const stores = createPostgresApplicationMcpStores({
      // typecast: see the contract note above.
      sql: database as unknown as Sql,
      application: 'research',
    });
    await expect(
      stores.sessions.list({
        serverId: 'mcpServer.research',
        states: [],
        limit: 10,
      }),
    ).rejects.toThrow(/valid lifecycle states/u);
  });
});

class FakePostgres {
  readonly catalogs = new Map<string, ApplicationOperationCatalog>();
  readonly sessions = new Map<string, ApplicationMcpSession>();
  readonly references = new Set<string>();

  async begin<T>(work: (transaction: FakePostgres) => Promise<T>): Promise<T> {
    return work(this);
  }

  async unsafe(
    query: string,
    parameters: readonly unknown[] = [],
  ): Promise<readonly Record<string, unknown>[]> {
    const normalized = query.replace(/\s+/gu, ' ').trim();
    if (normalized.startsWith('CREATE TABLE')) return [];
    if (
      normalized.startsWith(
        'SELECT document FROM applik8s_operation_catalogs WHERE application = $1 ORDER BY revision',
      )
    ) {
      return [...this.catalogs.values()]
        .sort((left, right) => left.revision.localeCompare(right.revision))
        .map((document) => ({ document }));
    }
    if (
      normalized.startsWith(
        'SELECT document FROM applik8s_operation_catalogs WHERE application = $1 AND revision = $2',
      )
    ) {
      const document = this.catalogs.get(String(parameters[1]));
      return document ? [{ document }] : [];
    }
    if (normalized.startsWith('INSERT INTO') && normalized.includes('applik8s_mcp_sessions')) {
      const id = String(parameters[1]);
      if (this.sessions.has(id)) return [];
      const record = structuredClone(parameters[7]) as ApplicationMcpSession;
      this.sessions.set(id, record);
      return [sessionRow(String(parameters[0]), record)];
    }
    if (
      normalized.startsWith('SELECT application, id, server_id')
      && normalized.includes('FOR UPDATE')
    ) {
      const record = this.sessions.get(String(parameters[1]));
      return record ? [sessionRow(String(parameters[0]), record)] : [];
    }
    if (
      normalized.startsWith('SELECT application, id, server_id')
      && normalized.includes('WHERE application = $1 AND id = $2')
    ) {
      const record = this.sessions.get(String(parameters[1]));
      return record ? [sessionRow(String(parameters[0]), record)] : [];
    }
    if (normalized.startsWith('UPDATE') && normalized.includes('applik8s_mcp_sessions')) {
      const id = String(parameters[1]);
      const current = this.sessions.get(id);
      if (!current || current.version !== Number(parameters[6])) return [];
      const record = structuredClone(parameters[5]) as ApplicationMcpSession;
      this.sessions.set(id, record);
      return [sessionRow(String(parameters[0]), record)];
    }
    if (
      normalized.startsWith('SELECT application, id, server_id')
      && normalized.includes('state = ANY')
    ) {
      const serverId = String(parameters[1]);
      const states = parameters[2] as readonly ApplicationMcpSession['state'][];
      const limit = Number(parameters[3]);
      return [...this.sessions.values()]
        .filter(
          (candidate) =>
            candidate.serverId === serverId && states.includes(candidate.state),
        )
        .sort((left, right) => left.expiresAt.localeCompare(right.expiresAt))
        .slice(0, limit)
        .map((record) => sessionRow(String(parameters[0]), record));
    }
    if (
      normalized.startsWith(
        'INSERT INTO applik8s_operation_catalog_references',
      )
    ) {
      this.references.add(
        `${String(parameters[0])}:${String(parameters[1])}:${String(parameters[2])}`,
      );
      return [];
    }
    if (
      normalized.startsWith(
        'DELETE FROM applik8s_operation_catalog_references',
      )
    ) {
      this.references.delete(
        `${String(parameters[0])}:${String(parameters[1])}:${String(parameters[2])}`,
      );
      return [];
    }
    throw new Error(`Unexpected fake PostgreSQL query: ${normalized}`);
  }
}

function sessionRow(
  application: string,
  record: ApplicationMcpSession,
): Record<string, unknown> {
  return {
    application,
    id: record.id,
    server_id: record.serverId,
    catalog_revision: record.catalogRevision,
    state: record.state,
    expires_at: new Date(record.expiresAt),
    version: record.version,
    record: structuredClone(record),
  };
}

function session(): ApplicationMcpSession {
  return {
    apiVersion: 'applik8s.mcpSession/v1alpha1',
    id: 'session-1',
    serverId: 'mcpServer.research',
    serverRevision: 'server-1',
    protocolRevision: '2025-11-25',
    catalogRevision: 'catalog-1',
    principalId: 'principal-1',
    principalIdentityId: 'identity-1',
    audience: 'https://research.example.test/mcp',
    authorityRevisionAtInitialization: 'authority-1',
    tools: [],
    issuedAt: '2026-07-29T00:00:00.000Z',
    expiresAt: '2026-07-29T01:00:00.000Z',
    state: 'active',
    version: 1,
  };
}

function catalog(
  revision: string,
  state: ApplicationOperationCatalog['state'],
): ApplicationOperationCatalog {
  return {
    apiVersion: 'applik8s.operationCatalog/v1alpha1',
    application: 'research',
    revision,
    digest: `sha256:${revision}`,
    state,
    operations: [],
  };
}
