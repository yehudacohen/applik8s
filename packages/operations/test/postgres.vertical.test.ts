// typecast-file-boundary: PostgreSQL repository doubles expose erased rows so durable authority decoding and transaction behavior can be verified.
import { describe, expect, it } from 'vitest';
import type {
  ApplicationOperationCatalog,
  ApplicationPermissionRecord,
} from '@applik8s/core';
import {
  ApplicationAuthorityService,
  createApplicationOperationAuthorityRuntime,
  ApplicationOperationCatalogManager,
  PostgresApplicationAuthorityRepository,
  PostgresApplicationOperationCatalogRepository,
  prepareApplicationAuthorityPostgres,
  type ApplicationAuthorityPostgresSql,
} from '../src/index.js';

describe('PostgreSQL operation authority repositories', () => {
  it('serializes authority transitions under an application-scoped advisory transaction lock', async () => {
    const sql = new AuthoritySqlFixture();
    const repository = new PostgresApplicationAuthorityRepository(sql, 'chirp');
    await repository.prepare();
    const authority = new ApplicationAuthorityService(repository);
    const permission: ApplicationPermissionRecord = {
      apiVersion: 'applik8s.permission/v1alpha1',
      id: 'permission:post.read',
      name: 'post-read',
      origin: 'runtime',
      catalogRevision: 'r1',
      operationIds: ['applik8s://models/Post/operations/read'],
      scope: { kind: 'all' },
      grantable: true,
      createdAt: '2026-07-29T00:00:00.000Z',
    };

    await authority.createRuntimePermission(permission);

    expect((await repository.snapshot()).permissions).toEqual([permission]);
    expect(sql.queries.some(({ query, parameters }) =>
      query.includes('pg_advisory_xact_lock') && parameters?.[0] === 'applik8s.authority:chirp')).toBe(true);
    expect(sql.queries.filter(({ query }) => query.includes('CREATE TABLE IF NOT EXISTS'))).toHaveLength(5);
  });

  it('serializes catalog activation and retains explicit durable references', async () => {
    const sql = new AuthoritySqlFixture();
    await prepareApplicationAuthorityPostgres(sql);
    const repository = new PostgresApplicationOperationCatalogRepository(sql);
    const manager = new ApplicationOperationCatalogManager(repository, {
      now: () => '2026-07-29T00:00:00.000Z',
    });
    const catalog: ApplicationOperationCatalog = {
      apiVersion: 'applik8s.operationCatalog/v1alpha1',
      application: 'chirp',
      revision: 'r1',
      digest: 'sha256:r1',
      state: 'proposed',
      operations: [{
        apiVersion: 'applik8s.operation/v1alpha1',
        id: 'applik8s://models/Post/operations/read',
        version: 'v1',
        name: 'read',
        kind: 'model.read',
        input: { digest: 'sha256:input', schema: {} },
        output: { digest: 'sha256:output', schema: {} },
        errors: {},
        authority: {
          classification: 'public',
          grantable: false,
          delegable: false,
          checks: ['execution'],
          defaultScope: { kind: 'all' },
        },
        transports: [],
        placement: { nodeId: 'model.post', runtime: 'server' },
      }],
    };

    await manager.stage(catalog);
    await manager.activate('chirp', 'r1');
    await repository.putReference('chirp', 'r1', 'session', 'session-1');

    expect((await repository.get('chirp', 'r1'))?.state).toBe('active');
    expect(await repository.references('chirp', 'r1')).toEqual({
      grantIds: [],
      envelopeIds: [],
      workflowIds: [],
      sessionIds: ['session-1'],
    });
    expect(sql.queries.some(({ query, parameters }) =>
      query.includes('pg_advisory_xact_lock') && parameters?.[0] === 'applik8s.catalog:chirp')).toBe(true);
  });

  it('admits, authorizes, references, and revalidates protected work through one generated-runtime facade', async () => {
    const sql = new AuthoritySqlFixture();
    const catalog: ApplicationOperationCatalog = {
      apiVersion: 'applik8s.operationCatalog/v1alpha1',
      application: 'chirp',
      revision: 'runtime-r1',
      digest: 'sha256:runtime-r1',
      state: 'proposed',
      operations: [{
        apiVersion: 'applik8s.operation/v1alpha1',
        id: 'applik8s://models/Post/operations/publish',
        version: 'v1',
        name: 'publish',
        kind: 'model.operation',
        input: { digest: 'sha256:input', schema: {} },
        output: { digest: 'sha256:output', schema: {} },
        errors: {},
        authority: {
          classification: 'public',
          grantable: false,
          delegable: false,
          checks: ['admission', 'execution', 'pre-commit', 'result-read'],
          defaultScope: { kind: 'all' },
          audiences: ['chirp-api'],
          transports: ['http'],
        },
        transports: [{ id: 'posts.publish.v1', transport: 'http' }],
        placement: { nodeId: 'handler.publish', runtime: 'command-processor' },
      }],
    };
    const runtime = createApplicationOperationAuthorityRuntime({
      sql,
      application: 'chirp',
      catalog,
    });
    const active = await runtime.prepare();
    const principal = await runtime.admitPrincipal({
      id: 'principal:user-1',
      identity: { id: 'identity:user-1', kind: 'human', issuer: 'test', subject: 'user-1' },
      kind: 'human',
      authenticationMethod: 'session',
      audience: ['chirp-api'],
    }, 'sha256:context');
    const authorization = await runtime.authorize({
      principal,
      operationId: 'applik8s://models/Post/operations/publish',
      target: { kind: 'all' },
      audience: 'chirp-api',
      transport: 'http',
      inputDigest: 'sha256:input',
      trustedContextDigest: 'sha256:context',
      commandId: 'command-1',
      idempotencyKey: 'once',
      targetDigest: 'sha256:post-1',
    });

    expect(active.state).toBe('active');
    expect(principal).toMatchObject({
      catalogRevision: 'runtime-r1',
      authorityRevision: '0',
      trustedContextDigest: 'sha256:context',
    });
    expect(authorization).toMatchObject({ allowed: true });
    if (!authorization.allowed) throw new Error('runtime fixture authorization unexpectedly failed');
    await expect(runtime.revalidate(
      authorization.receipt,
      'pre-commit',
      'sha256:context',
      sql,
    )).resolves.toMatchObject({ allowed: true });
    expect((await new PostgresApplicationOperationCatalogRepository(sql).references('chirp', 'runtime-r1')).envelopeIds).toContain('command-1');
    expect(sql.queries.some(({ query, parameters }) =>
      query.includes('pg_advisory_xact_lock') && parameters?.[0] === 'applik8s.authority:chirp')).toBe(true);
  });

  it('admits a distinct execution principal and enforces its workload envelope before authorization', async () => {
    const sql = new AuthoritySqlFixture();
    const operationId = 'applik8s://models/Post/operations/publish' as const;
    const catalog: ApplicationOperationCatalog = {
      apiVersion: 'applik8s.operationCatalog/v1alpha1',
      application: 'chirp',
      revision: 'execution-r1',
      digest: 'sha256:execution-r1',
      state: 'proposed',
      operations: [{
        apiVersion: 'applik8s.operation/v1alpha1',
        id: operationId,
        version: 'v1',
        name: 'publish',
        kind: 'model.operation',
        input: { digest: 'sha256:input', schema: {} },
        output: { digest: 'sha256:output', schema: {} },
        errors: {},
        authority: {
          classification: 'public',
          grantable: false,
          delegable: false,
          checks: ['execution'],
          defaultScope: { kind: 'all' },
          audiences: ['chirp-worker'],
          transports: ['event'],
        },
        transports: [{ id: 'posts.publish.v1', transport: 'event' }],
        placement: { nodeId: 'handler.publish', runtime: 'command-processor' },
      }],
    };
    const runtime = createApplicationOperationAuthorityRuntime({ sql, application: 'chirp', catalog });
    const workloadIdentity = {
      id: 'identity:chirp:workload:task-handler.publish',
      kind: 'workload' as const,
      issuer: 'applik8s://chirp',
      subject: 'task-handler.publish',
    };
    const envelope = {
      apiVersion: 'applik8s.workloadAuthority/v1alpha1' as const,
      id: 'workload-authority:publish',
      workloadIdentity,
      operationId,
      catalogRevision: 'execution-r1',
      restrictions: {
        target: { kind: 'all' as const },
        predicates: [{
          kind: 'compare' as const,
          field: 'state',
          operator: 'eq' as const,
          value: { kind: 'literal' as const, value: 'draft' },
        }],
      },
      inputSchemaDigest: 'sha256:input',
      audiences: ['chirp-worker'],
      transports: ['event' as const],
      delegation: 'forbidden' as const,
      impersonation: 'forbidden' as const,
    };
    const principal = await runtime.admitExecutionPrincipal({
      executionKind: 'task',
      executionId: 'task-run-1',
      attempt: 1,
      workloadIdentity,
      envelopes: [envelope],
      trustedContextDigest: 'sha256:context',
      audience: ['chirp-worker'],
      deadline: '2099-07-29T00:00:00.000Z',
      cancellationRevision: 'cancel-1',
    });

    const authorized = await runtime.authorizeExecution({
      principal,
      envelope,
      target: { kind: 'target', model: 'Post', identity: { id: 'post-1' } },
      audience: 'chirp-worker',
      transport: 'event',
      inputDigest: 'sha256:payload',
      trustedContextDigest: 'sha256:context',
      currentCancellationRevision: 'cancel-1',
    });
    expect(principal).toMatchObject({
      kind: 'execution',
      executionKind: 'task',
      executionId: 'task-run-1',
      workloadIdentity,
      effectiveAuthority: [],
    });
    expect(authorized).toMatchObject({
      allowed: true,
      principal: {
        effectiveAuthority: [
          expect.objectContaining({
            workloadEnvelopeId: envelope.id,
            operationId,
            scope: expect.objectContaining({ kind: 'and' }),
          }),
        ],
      },
    });
    await expect(runtime.authorizeExecution({
      principal,
      envelope,
      target: { kind: 'all' },
      audience: 'chirp-worker',
      transport: 'event',
      inputDigest: 'sha256:payload',
      trustedContextDigest: 'sha256:context',
      currentCancellationRevision: 'cancel-2',
    })).resolves.toMatchObject({
      allowed: false,
      code: 'AUTHORIZATION_EXECUTION_CANCELLED',
    });
  });
});

class AuthoritySqlFixture implements ApplicationAuthorityPostgresSql {
  readonly queries: Array<{ readonly query: string; readonly parameters?: readonly unknown[] }> = [];
  readonly authorityRecords = new Map<string, { readonly kind: string; readonly id: string; document: unknown }>();
  readonly catalogs = new Map<string, ApplicationOperationCatalog>();
  readonly catalogReferences = new Set<string>();
  revision = 0;

  async begin<T>(work: (transaction: this) => Promise<T>): Promise<T> {
    return work(this);
  }

  json(value: unknown): unknown {
    return value;
  }

  async unsafe(query: string, parameters?: readonly unknown[]): Promise<readonly Record<string, unknown>[]> {
    const normalized = query.replace(/\s+/g, ' ').trim();
    this.queries.push({ query: normalized, ...(parameters ? { parameters } : {}) });
    if (normalized.startsWith('SELECT revision FROM applik8s_authority_revisions')) {
      return [{ revision: this.revision }];
    }
    if (normalized.startsWith('SELECT kind, document FROM applik8s_authority_records')) {
      return [...this.authorityRecords.values()].map((record) => ({ kind: record.kind, document: record.document }));
    }
    if (normalized.startsWith('INSERT INTO applik8s_authority_records')) {
      const [, kind, id, document] = parameters ?? [];
      this.authorityRecords.set(`${kind}:${id}`, { kind: String(kind), id: String(id), document });
    } else if (normalized.startsWith('UPDATE applik8s_authority_revisions')) {
      this.revision += 1;
    } else if (normalized.startsWith('INSERT INTO applik8s_operation_catalogs')) {
      const [application, revision, document] = parameters ?? [];
      this.catalogs.set(`${application}:${revision}`, document as ApplicationOperationCatalog);
    } else if (normalized.startsWith('INSERT INTO applik8s_operation_catalog_references')) {
      this.catalogReferences.add((parameters ?? []).join(':'));
    }
    if (normalized.startsWith('SELECT document FROM applik8s_operation_catalogs WHERE application = $1 AND revision = $2')) {
      const value = this.catalogs.get(`${parameters?.[0]}:${parameters?.[1]}`);
      return value ? [{ document: value }] : [];
    }
    if (normalized.startsWith('SELECT document FROM applik8s_operation_catalogs WHERE application = $1 ORDER BY revision')) {
      return [...this.catalogs.entries()]
        .filter(([key]) => key.startsWith(`${parameters?.[0]}:`))
        .map(([, document]) => ({ document }));
    }
    if (normalized.startsWith('SELECT kind, reference_id FROM applik8s_operation_catalog_references')) {
      const prefix = `${parameters?.[0]}:${parameters?.[1]}:`;
      return [...this.catalogReferences]
        .filter((key) => key.startsWith(prefix))
        .map((key) => {
          const [, , kind, referenceId] = key.split(':');
          return { kind, reference_id: referenceId };
        });
    }
    return [];
  }
}
