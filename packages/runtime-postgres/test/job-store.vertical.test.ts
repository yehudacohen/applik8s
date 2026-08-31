// typecast-file-boundary: Job-store tests inspect intentionally partial PostgreSQL records after schema and fence validation.
import { type } from 'arktype';
import postgres from 'postgres';
import { afterAll, describe, expect, test } from 'vitest';
import { createApplicationJobBinding } from '../../applik8s/src/application-finite-jobs.js';
import { createDurableApplicationJobRuntime } from '../../applik8s/src/application-job-durable-runtime.js';
import { inspectApplicationJobRuntimeConformance } from '../../testing/src/job-runtime-conformance.js';
import { createPostgresApplicationJobStore } from '../src/job-store.js';

const databaseUrl = process.env.APPLIK8S_JOB_POSTGRES_URL;
const live = databaseUrl ? describe : describe.skip;

live('PostgreSQL finite Job store', () => {
  const applicationId = `job-live-${crypto.randomUUID()}`;
  const stores: { close(): Promise<void> }[] = [];
  const runtimes: { close(): Promise<void> }[] = [];

  afterAll(async () => {
    await Promise.all(runtimes.map((runtime) => runtime.close()));
    await Promise.all(stores.map((store) => store.close()));
    if (!databaseUrl) return;
    const sql = postgres(databaseUrl, { max: 1 });
    try {
      await sql`DELETE FROM applik8s_public_stream_events WHERE envelope->'authority'->>'applicationId' = ${applicationId}`;
      await sql`DELETE FROM applik8s_job_runs WHERE application_id = ${applicationId}`;
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  test('passes the same provider-neutral runtime contract against transactional storage', async () => {
    if (!databaseUrl) throw new Error('APPLIK8S_JOB_POSTGRES_URL is required.');
    let sequence = 0;
    const report = await inspectApplicationJobRuntimeConformance({
      name: 'postgres-job-store',
      createRuntime({ maximumConcurrency }) {
        sequence += 1;
        const store = createPostgresApplicationJobStore({
          databaseUrl,
          applicationId,
          deploymentId: `contract-${sequence}`,
        });
        stores.push(store);
        const runtime = createDurableApplicationJobRuntime({
          store,
          maximumConcurrency,
          leaseSeconds: 1,
          pollIntervalMs: 10,
        });
        runtimes.push(runtime);
        return runtime;
      },
    });
    expect(report.ok, report.checks.filter((check) => !check.passed).map((check) => check.message).join('\n')).toBe(true);
    const sql = postgres(databaseUrl, { max: 1 });
    try {
      const facts = await sql<{ readonly contract_name: string; readonly payload: object }[]>`
        SELECT contract_name, payload
        FROM applik8s_public_stream_events
        WHERE envelope->'authority'->>'applicationId' = ${applicationId}
        ORDER BY sequence
      `;
      expect(facts).toEqual(expect.arrayContaining([
        expect.objectContaining({ contract_name: expect.stringMatching(/\.started$/u) }),
        expect.objectContaining({ contract_name: expect.stringMatching(/\.(?:succeeded|failed|cancelled|timedOut)$/u) }),
      ]));
    } finally {
      await sql.end({ timeout: 5 });
    }
  }, 30_000);

  test('serializes concurrent idempotent admission across independent runtime processes', async () => {
    if (!databaseUrl) throw new Error('APPLIK8S_JOB_POSTGRES_URL is required.');
    const deploymentId = 'concurrent-admission';
    const leftStore = createPostgresApplicationJobStore({ databaseUrl, applicationId, deploymentId });
    const rightStore = createPostgresApplicationJobStore({ databaseUrl, applicationId, deploymentId });
    stores.push(leftStore, rightStore);
    const leftRuntime = createDurableApplicationJobRuntime({ store: leftStore, workerId: 'left', pollIntervalMs: 5 });
    const rightRuntime = createDurableApplicationJobRuntime({ store: rightStore, workerId: 'right', pollIntervalMs: 5 });
    runtimes.push(leftRuntime, rightRuntime);
    let executions = 0;
    const definition = {
      id: 'reports.concurrent.v1',
      contract: { input: type({ report: 'string' }), output: type({ accepted: 'boolean' }) },
      options: { idempotencyKey: (input: { readonly report: string }) => input.report },
      handler: () => {
        executions += 1;
        return { accepted: true };
      },
    };
    const left = createApplicationJobBinding(definition, leftRuntime);
    const right = createApplicationJobBinding(definition, rightRuntime);
    const [first, duplicate] = await Promise.all([
      left.start({ report: 'monthly' }),
      right.start({ report: 'monthly' }),
    ]);
    expect(duplicate.reference).toEqual(first.reference);
    await expect(first.result()).resolves.toEqual({ accepted: true });
    await expect(duplicate.result()).resolves.toEqual({ accepted: true });
    expect(executions).toBe(1);
  }, 15_000);

  test('does not let an exact-run worker claim a Job definition it does not contain', async () => {
    if (!databaseUrl) throw new Error('APPLIK8S_JOB_POSTGRES_URL is required.');
    const store = createPostgresApplicationJobStore({ databaseUrl, applicationId, deploymentId: 'exact-worker' });
    stores.push(store);
    await store.admit({
      reference: {
        protocol: 'applik8s.jobRuntime/v1alpha1',
        job: 'reports.export.v1',
        runId: 'exact-run',
        admittedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
      },
      input: { report: 'monthly' },
      admission: {
        apiVersion: 'applik8s.admission/v1',
        principal: {
          id: 'principal:test:postgres-job',
          identity: { id: 'identity:test:postgres-job', kind: 'service', issuer: 'applik8s://test', subject: 'postgres-job' },
          kind: 'service',
          authenticationMethod: 'test',
          audience: ['applik8s://jobs/reports.export.v1/operations/run'],
          trustedContextDigest: 'sha256:postgres-job',
          catalogRevision: 'catalog-v1',
          authorityRevision: 'authority-v1',
          admittedAt: '2026-01-01T00:00:00.000Z',
          expiresAt: '2026-01-01T00:01:00.000Z',
        },
        authorityRevision: 'authority-v1',
        trustedContext: { values: {}, digest: 'sha256:postgres-job' },
        operation: { id: 'applik8s://jobs/reports.export.v1/operations/run', transport: 'framework' },
        correlationId: 'postgres-job',
        deadline: '2026-01-01T00:01:00.000Z',
      },
      maximumAttempts: 1,
      availableAt: '2026-01-01T00:00:00.000Z',
    });
    await expect(store.claim({
      owner: 'wrong-worker',
      now: '2026-01-01T00:00:01.000Z',
      leaseSeconds: 5,
      runId: 'exact-run',
      jobs: ['another.job.v1'],
    })).resolves.toBeUndefined();
    await expect(store.claim({
      owner: 'right-worker',
      now: '2026-01-01T00:00:01.000Z',
      leaseSeconds: 5,
      runId: 'exact-run',
      jobs: ['reports.export.v1'],
    })).resolves.toMatchObject({ reference: { runId: 'exact-run' }, lease: { owner: 'right-worker' } });
  });

  test('scopes public lifecycle-fact identity across deployments sharing a run ID', async () => {
    if (!databaseUrl) throw new Error('APPLIK8S_JOB_POSTGRES_URL is required.');
    const left = createPostgresApplicationJobStore({
      databaseUrl,
      applicationId,
      deploymentId: 'fact-scope-left',
    });
    const right = createPostgresApplicationJobStore({
      databaseUrl,
      applicationId,
      deploymentId: 'fact-scope-right',
    });
    stores.push(left, right);
    const admittedAt = '2026-01-01T00:00:00.000Z';
    const admission = {
      reference: {
        protocol: 'applik8s.jobRuntime/v1alpha1' as const,
        job: 'reports.scoped.v1',
        runId: 'shared-run-id',
        admittedAt,
      },
      input: { report: 'monthly' },
      admission: {
        apiVersion: 'applik8s.admission/v1' as const,
        principal: {
          id: 'principal:test:postgres-job-scope',
          identity: {
            id: 'identity:test:postgres-job-scope',
            kind: 'service' as const,
            issuer: 'applik8s://test',
            subject: 'postgres-job-scope',
          },
          kind: 'service' as const,
          authenticationMethod: 'test',
          audience: ['applik8s://jobs/reports.scoped.v1/operations/run'],
          trustedContextDigest: 'sha256:postgres-job-scope',
          catalogRevision: 'catalog-v1',
          authorityRevision: 'authority-v1',
          admittedAt,
          expiresAt: '2026-01-01T00:01:00.000Z',
        },
        authorityRevision: 'authority-v1',
        trustedContext: { values: {}, digest: 'sha256:postgres-job-scope' },
        operation: {
          id: 'applik8s://jobs/reports.scoped.v1/operations/run',
          transport: 'framework' as const,
        },
        correlationId: 'postgres-job-scope',
      },
      maximumAttempts: 1,
      availableAt: admittedAt,
    };
    await left.admit(admission);
    await right.admit(admission);
    await left.claim({ owner: 'left', now: admittedAt, leaseSeconds: 5 });
    await right.claim({ owner: 'right', now: admittedAt, leaseSeconds: 5 });

    const sql = postgres(databaseUrl, { max: 1 });
    try {
      const facts = await sql<{ readonly id: string; readonly deployment_id: string }[]>`
        SELECT id, envelope->'authority'->>'deploymentId' AS deployment_id
        FROM applik8s_public_stream_events
        WHERE envelope->'authority'->>'applicationId' = ${applicationId}
          AND payload->'run'->>'runId' = 'shared-run-id'
        ORDER BY deployment_id
      `;
      expect(facts).toHaveLength(2);
      expect(new Set(facts.map((fact) => fact.id)).size).toBe(2);
      expect(facts.map((fact) => fact.deployment_id)).toEqual([
        'fact-scope-left',
        'fact-scope-right',
      ]);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
