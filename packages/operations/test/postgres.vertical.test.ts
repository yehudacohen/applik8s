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
  PostgresApplicationOperationalObservationRepository,
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
    expect(sql.queries.some(({ query }) =>
      query.includes('applik8s_authority_audit_occurred_at_idx'))).toBe(true);
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
      operationIdsByReference: {
        'session:session-1': [],
      },
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
    await expect(runtime.admitPrincipal({
      id: 'principal:user-1',
      identity: {
        id: 'identity:user-1',
        kind: 'human',
        issuer: 'test',
        subject: 'user-1',
      },
      kind: 'human',
      authenticationMethod: 'session',
      audience: ['chirp-api'],
    }, 'sha256:context')).resolves.toMatchObject({
      authorityRevision: principal.authorityRevision,
    });
    await expect(runtime.revalidate(
      authorization.receipt,
      'pre-commit',
      'sha256:context',
      sql,
    )).resolves.toMatchObject({ allowed: true });
    await expect(runtime.authorize({
      principal,
      operationId: 'applik8s://models/Post/operations/publish',
      target: { kind: 'all' },
      audience: 'chirp-api',
      transport: 'http',
      inputDigest: 'sha256:input-2',
      trustedContextDigest: 'sha256:context',
      commandId: 'command-2',
      idempotencyKey: 'twice',
      targetDigest: 'sha256:post-2',
    })).resolves.toMatchObject({ allowed: true });
    expect((await new PostgresApplicationOperationCatalogRepository(sql).references('chirp', 'runtime-r1')).envelopeIds).toContain('command-1');
    expect([...sql.operationalObservations.values()].filter(({ id }) =>
      id === 'authority:operation:applik8s://models/Post/operations/publish')).toHaveLength(1);
    expect([...sql.operationalObservations.values()]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          application: 'chirp',
          id: 'authority:operation-catalog',
          domain: 'authority',
          authority: 'canonical',
          state: 'ready',
        }),
        expect.objectContaining({
          application: 'chirp',
          id: 'database:transactional-authority',
          domain: 'database',
          subject: 'TransactionalDatabase',
          authority: 'canonical',
          state: 'ready',
        }),
        expect.objectContaining({
          application: 'chirp',
          id: 'authority:operation:applik8s://models/Post/operations/publish',
          domain: 'authority',
          subject: 'applik8s://models/Post/operations/publish',
          authority: 'canonical',
          state: 'succeeded',
        }),
      ]),
    );
    expect(sql.queries.some(({ query, parameters }) =>
      query.includes('pg_advisory_xact_lock') && parameters?.[0] === 'applik8s.authority:chirp')).toBe(true);
  });

  it('keeps canonical operational observations application-scoped and bounded', async () => {
    const sql = new AuthoritySqlFixture();
    const chirp = new PostgresApplicationOperationalObservationRepository(
      sql,
      'chirp',
    );
    const guestbook = new PostgresApplicationOperationalObservationRepository(
      sql,
      'guestbook',
    );
    await chirp.prepare();
    await chirp.upsert({
      id: 'workflow:publish',
      domain: 'workflow',
      subject: 'PublishPost',
      authority: 'canonical',
      state: 'running',
      source: 'workflow-runtime',
      evidence: { runId: 'run-1', privateInput: 'not-browser-visible' },
      observedAt: '2026-08-01T00:00:00.000Z',
    });
    await guestbook.upsert({
      id: 'workflow:publish',
      domain: 'workflow',
      subject: 'PublishEntry',
      authority: 'canonical',
      state: 'ready',
      source: 'workflow-runtime',
      evidence: {},
      observedAt: '2026-08-01T00:00:01.000Z',
    });

    await expect(chirp.list({ domain: 'workflow', limit: 10 })).resolves.toEqual([
      expect.objectContaining({
        application: 'chirp',
        id: 'workflow:publish',
        subject: 'PublishPost',
        state: 'running',
      }),
    ]);
    await expect(chirp.list({ limit: 0 })).rejects.toThrow(
      'integer from 1 through 1000',
    );
  });

  it('retries authority preparation after a transient PostgreSQL failure and caches only success', async () => {
    const sql = new AuthoritySqlFixture();
    sql.failuresRemaining = 1;
    const runtime = createApplicationOperationAuthorityRuntime({
      sql,
      application: 'retryable',
      catalog: {
        apiVersion: 'applik8s.operationCatalog/v1alpha1',
        application: 'retryable',
        revision: 'retryable-r1',
        digest: 'sha256:retryable-r1',
        state: 'proposed',
        operations: [],
      },
    });

    await expect(runtime.prepare()).rejects.toThrow('transient PostgreSQL startup failure');
    const active = await runtime.prepare();
    const queryCountAfterSuccess = sql.queries.length;

    await expect(runtime.prepare()).resolves.toBe(active);
    expect(active.state).toBe('active');
    expect(sql.queries).toHaveLength(queryCountAfterSuccess);
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
      executionKind: 'agent',
      executionId: 'task-run-1',
      attempt: 1,
      workloadIdentity,
      executionContext: {
        kind: 'agent',
        threadId: 'thread-1',
        runId: 'run-1',
      },
      causalPrincipalId: 'principal:chirp:human:author-1',
      causalPrincipal: {
        id: 'identity:chirp:human:author-1',
        kind: 'human',
        issuer: 'https://identity.example.test',
        subject: 'author-1',
      },
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
      executionKind: 'agent',
      executionId: 'task-run-1',
      workloadIdentity,
      executionContext: {
        kind: 'agent',
        threadId: 'thread-1',
        runId: 'run-1',
      },
      causalPrincipalId: 'principal:chirp:human:author-1',
      causalPrincipal: {
        id: 'identity:chirp:human:author-1',
        kind: 'human',
        issuer: 'https://identity.example.test',
        subject: 'author-1',
      },
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
  readonly catalogReferences = new Map<string, unknown>();
  readonly operationalObservations = new Map<string, Record<string, unknown>>();
  revision = 0;
  failuresRemaining = 0;

  async begin<T>(work: (transaction: this) => Promise<T>): Promise<T> {
    return work(this);
  }

  json(value: unknown): unknown {
    return value;
  }

  async unsafe(query: string, parameters?: readonly unknown[]): Promise<readonly Record<string, unknown>[]> {
    const normalized = query.replace(/\s+/g, ' ').trim();
    this.queries.push({ query: normalized, ...(parameters ? { parameters } : {}) });
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error('transient PostgreSQL startup failure');
    }
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
      const [application, revision, kind, referenceId, operationIds = []] = parameters ?? [];
      this.catalogReferences.set(
        `${application}:${revision}:${kind}:${referenceId}`,
        operationIds,
      );
    } else if (normalized.startsWith('INSERT INTO applik8s_operational_observations')) {
      const [
        application,
        id,
        domain,
        subject,
        authority,
        state,
        reason,
        source,
        causalId,
        evidence,
        observedAt,
        expiresAt,
      ] = parameters ?? [];
      this.operationalObservations.set(`${application}:${id}`, {
        application,
        id,
        domain,
        subject,
        authority,
        state,
        reason,
        source,
        causal_id: causalId,
        evidence,
        observed_at: observedAt,
        expires_at: expiresAt,
      });
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
    if (normalized.startsWith('SELECT kind, reference_id, operation_ids FROM applik8s_operation_catalog_references')) {
      const prefix = `${parameters?.[0]}:${parameters?.[1]}:`;
      return [...this.catalogReferences.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, operationIds]) => {
          const [, , kind, referenceId] = key.split(':');
          return { kind, reference_id: referenceId, operation_ids: operationIds };
        });
    }
    if (normalized.startsWith('SELECT application, id, domain, subject, authority, state, reason, source, causal_id, evidence, observed_at, expires_at FROM applik8s_operational_observations')) {
      const [application, domain] = parameters ?? [];
      return [...this.operationalObservations.values()]
        .filter((row) => row.application === application)
        .filter((row) => !normalized.includes('AND domain = $2') || row.domain === domain)
        .sort((left, right) =>
          String(right.observed_at).localeCompare(String(left.observed_at)));
    }
    return [];
  }
}
