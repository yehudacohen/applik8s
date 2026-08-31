import { createDurableApplicationJobRuntime } from '../../applik8s/src/application-job-durable-runtime.js';
import { createApplicationJobBinding } from '../../applik8s/src/application-finite-jobs.js';
import { inspectApplicationJobRuntimeConformance } from '../../testing/src/job-runtime-conformance.js';
import { type } from 'arktype';
import postgres from 'postgres';
import { afterAll, describe, expect, test } from 'vitest';
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
      await sql`DELETE FROM applik8s_job_runs WHERE application_id = ${applicationId}`;
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  test('passes the same provider-neutral runtime contract against transactional storage', async () => {
    let sequence = 0;
    const report = await inspectApplicationJobRuntimeConformance({
      name: 'postgres-job-store',
      createRuntime({ maximumConcurrency }) {
        if (!databaseUrl) throw new Error('APPLIK8S_JOB_POSTGRES_URL is required.');
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
});
