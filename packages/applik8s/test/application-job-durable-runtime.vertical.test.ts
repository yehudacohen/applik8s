import { type } from 'arktype';
import { describe, expect, test } from 'vitest';
import { inspectApplicationJobRuntimeConformance } from '../../testing/src/job-runtime-conformance.js';
import { createApplicationJobBinding } from '../src/application-finite-jobs.js';
import { createDurableApplicationJobRuntime } from '../src/application-job-durable-runtime.js';
import { createDeterministicApplicationJobStore } from '../src/application-job-store.js';

describe('durable finite Job runtime', () => {
  test('passes the provider-neutral JobRuntime contract', async () => {
    const runtimes: { close(): Promise<void> }[] = [];
    const report = await inspectApplicationJobRuntimeConformance({
      name: 'durable-memory-store',
      createRuntime({ maximumConcurrency }) {
        const runtime = createDurableApplicationJobRuntime({
          store: createDeterministicApplicationJobStore(),
          maximumConcurrency,
          leaseSeconds: 1,
          pollIntervalMs: 5,
        });
        runtimes.push(runtime);
        return runtime;
      },
    });
    await Promise.all(runtimes.map((runtime) => runtime.close()));
    expect(report).toMatchObject({ ok: true });
    expect(report.checks.every((check) => check.passed)).toBe(true);
  }, 20_000);

  test('reattaches after worker loss and fences the late first attempt', async () => {
    const store = createDeterministicApplicationJobStore();
    let finishFirst!: () => void;
    const firstAttempt = new Promise<void>((resolve) => { finishFirst = resolve; });
    let attempts = 0;
    const definition = {
      id: 'exports.restart.v1',
      contract: { input: type({ value: 'number' }), output: type({ worker: 'string' }) },
      options: { retries: 1 },
      handler: async () => {
        attempts += 1;
        if (attempts === 1) await firstAttempt;
        return { worker: attempts === 1 ? 'stale' : 'recovered' };
      },
    };
    const first = createDurableApplicationJobRuntime({
      store,
      workerId: 'worker-a',
      leaseSeconds: 1,
      pollIntervalMs: 5,
    });
    const job = createApplicationJobBinding(definition, first);
    const run = await job.start({ value: 1 });
    await waitFor(() => store.read(run.reference.runId).then((stored) => stored?.attempt === 1));
    await first.close();
    await new Promise((resolve) => setTimeout(resolve, 1_050));

    const second = createDurableApplicationJobRuntime({
      store,
      workerId: 'worker-b',
      leaseSeconds: 1,
      pollIntervalMs: 5,
    });
    createApplicationJobBinding(definition, second);
    await expect(second.attach(definition.id, run.reference).then((attached) => attached.result())).resolves.toEqual({ worker: 'recovered' });
    finishFirst();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await expect(store.read(run.reference.runId)).resolves.toMatchObject({
      attempt: 2,
      outcome: { status: 'succeeded', output: { worker: 'recovered' } },
    });
    await second.close();
  }, 10_000);

  test('separates controller admission from one exact-run worker', async () => {
    const store = createDeterministicApplicationJobStore();
    const dispatched: string[] = [];
    let executions = 0;
    const definition = {
      id: 'exports.controller-worker.v1',
      contract: { input: type({ value: 'number' }), output: type({ doubled: 'number' }) },
      options: { idempotencyKey: () => 'one-run' },
      handler: (input: { readonly value: number }) => {
        executions += 1;
        return { doubled: input.value * 2 };
      },
    };
    const controller = createDurableApplicationJobRuntime({
      store,
      executeWorkers: false,
      dispatch: (run) => { dispatched.push(run.reference.runId); },
    });
    const job = createApplicationJobBinding(definition, controller);
    const run = await job.start({ value: 4 });
    const duplicate = await job.start({ value: 4 });
    expect(executions).toBe(0);
    expect(dispatched).toEqual([run.reference.runId, run.reference.runId]);
    expect(duplicate.reference).toEqual(run.reference);

    const worker = createDurableApplicationJobRuntime({
      store,
      workerId: 'finite-workload',
      claimRunId: run.reference.runId,
      pollIntervalMs: 5,
    });
    createApplicationJobBinding(definition, worker);
    await expect(worker.attach(definition.id, run.reference).then((attached) => attached.result())).resolves.toEqual({ doubled: 8 });
    expect(executions).toBe(1);
    await controller.close();
    await worker.close();
  });
});

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for durable Job state transition.');
}
