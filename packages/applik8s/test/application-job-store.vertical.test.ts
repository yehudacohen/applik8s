import {
  type ApplicationAdmissionInvocationContextV1,
  applicationAdmissionContextVersion,
} from '@applik8s/core';
import { describe, expect, test } from 'vitest';
import {
  ApplicationJobLeaseLostError,
  createApplicationJobReference,
  createDeterministicApplicationJobStore,
} from '../src/application-job-store.js';

const at = (seconds: number): string => new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString();

const admission = {
  apiVersion: applicationAdmissionContextVersion,
  principal: {
    id: 'principal:test:job-conformance',
    identity: {
      id: 'identity:test:job-conformance',
      kind: 'service',
      issuer: 'applik8s://test',
      subject: 'job-conformance',
    },
    kind: 'service',
    authenticationMethod: 'test',
    audience: ['applik8s://jobs/reports.export.v1/operations/run'],
    trustedContextDigest: 'sha256:job-conformance',
    catalogRevision: 'catalog-v1',
    authorityRevision: 'authority-v1',
    admittedAt: at(0),
    expiresAt: at(59),
  },
  authorityRevision: 'authority-v1',
  trustedContext: { values: {}, digest: 'sha256:job-conformance' },
  operation: {
    id: 'applik8s://jobs/reports.export.v1/operations/run',
    transport: 'framework',
  },
  correlationId: 'job-conformance',
  deadline: at(59),
} satisfies ApplicationAdmissionInvocationContextV1;

function admissionFor(runId: string, input: object, scope?: string) {
  return {
    reference: createApplicationJobReference('reports.export.v1', at(0), runId),
    input,
    admission,
    maximumAttempts: 3,
    availableAt: at(0),
    ...(scope ? { idempotencyScope: scope } : {}),
  };
}

describe('durable finite Job store contract', () => {
  test('admits an idempotent input once and reports conflicting input without mutation', async () => {
    const store = createDeterministicApplicationJobStore();
    await expect(store.admit(admissionFor('run-1', { report: 1 }, 'scope-1'))).resolves.toMatchObject({ status: 'admitted' });
    await expect(store.admit(admissionFor('run-2', { report: 1 }, 'scope-1'))).resolves.toMatchObject({
      status: 'existing',
      run: { reference: { runId: 'run-1' } },
    });
    await expect(store.admit(admissionFor('run-3', { report: 2 }, 'scope-1'))).resolves.toMatchObject({
      status: 'conflict',
      run: { reference: { runId: 'run-1' } },
    });
    expect(store.snapshot()).toHaveLength(1);
  });

  test('reclaims an expired lease and fences the stale worker epoch', async () => {
    const store = createDeterministicApplicationJobStore();
    await store.admit(admissionFor('run-1', { report: 1 }));
    const first = await store.claim({ owner: 'worker-a', now: at(1), leaseSeconds: 5 });
    expect(first?.lease).toMatchObject({ owner: 'worker-a', epoch: 1 });
    const second = await store.claim({ owner: 'worker-b', now: at(7), leaseSeconds: 5 });
    expect(second?.lease).toMatchObject({ owner: 'worker-b', epoch: 2 });
    await expect(store.terminalize({
      runId: 'run-1',
      lease: { owner: 'worker-a', epoch: 1 },
      outcome: { status: 'succeeded', output: { stale: true } },
      terminalAt: at(8),
      resultExpiresAt: at(20),
    })).rejects.toBeInstanceOf(ApplicationJobLeaseLostError);
    await store.terminalize({
      runId: 'run-1',
      lease: { owner: 'worker-b', epoch: 2 },
      outcome: { status: 'succeeded', output: { current: true } },
      terminalAt: at(8),
      resultExpiresAt: at(20),
    });
    expect(await store.read('run-1')).toMatchObject({
      phase: 'terminal',
      outcome: { status: 'succeeded', output: { current: true } },
    });
    expect(store.facts()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'run-1:started:1',
        kind: 'started',
        payload: expect.objectContaining({ attempt: 1 }),
      }),
      expect.objectContaining({
        id: 'run-1:succeeded:1',
        kind: 'succeeded',
        contract: expect.objectContaining({ id: 'jobs.reports.export.succeeded.v1' }),
        payload: expect.objectContaining({ output: { current: true } }),
      }),
    ]));
    expect(store.facts().filter((fact) => fact.kind === 'started')).toHaveLength(1);
  });

  test('claims an exact run only when the worker also owns its Job definition', async () => {
    const store = createDeterministicApplicationJobStore();
    await store.admit(admissionFor('run-1', { report: 1 }));
    await expect(store.claim({
      owner: 'wrong-worker',
      now: at(1),
      leaseSeconds: 5,
      runId: 'run-1',
      jobs: ['another.job.v1'],
    })).resolves.toBeUndefined();
    await expect(store.claim({
      owner: 'right-worker',
      now: at(1),
      leaseSeconds: 5,
      runId: 'run-1',
      jobs: ['reports.export.v1'],
    })).resolves.toMatchObject({
      reference: { runId: 'run-1', job: 'reports.export.v1' },
      lease: { owner: 'right-worker', epoch: 1 },
    });
  });

  test('converges cancellation and completion through one first terminal transition', async () => {
    const store = createDeterministicApplicationJobStore();
    await store.admit(admissionFor('queued', { report: 1 }));
    await store.cancel({ runId: 'queued', requestedAt: at(1), reason: 'withdrawn', resultExpiresAt: at(20) });
    expect(await store.read('queued')).toMatchObject({ phase: 'terminal', outcome: { status: 'cancelled', reason: 'withdrawn' } });

    await store.admit(admissionFor('running', { report: 2 }));
    const running = await store.claim({ owner: 'worker-a', now: at(2), leaseSeconds: 5 });
    await store.cancel({ runId: 'running', requestedAt: at(3), reason: 'stop', resultExpiresAt: at(20) });
    await store.terminalize({
      runId: 'running',
      lease: running?.lease ?? { owner: 'missing', epoch: 0 },
      outcome: { status: 'cancelled', reason: 'stop' },
      terminalAt: at(4),
      resultExpiresAt: at(20),
    });
    const terminal = await store.terminalize({
      runId: 'running',
      lease: running?.lease ?? { owner: 'missing', epoch: 0 },
      outcome: { status: 'succeeded', output: { tooLate: true } },
      terminalAt: at(5),
      resultExpiresAt: at(20),
    });
    expect(terminal.outcome).toEqual({ status: 'cancelled', reason: 'stop' });
  });

  test('purges retained payloads without erasing terminal and progress identity', async () => {
    const store = createDeterministicApplicationJobStore();
    await store.admit(admissionFor('run-1', { report: 1 }));
    const running = await store.claim({ owner: 'worker-a', now: at(1), leaseSeconds: 5 });
    const lease = running?.lease ?? { owner: 'missing', epoch: 0, expiresAt: at(0) };
    await store.recordProgress({ runId: 'run-1', lease, value: { rows: 4 }, recordedAt: at(2), expiresAt: at(4) });
    await store.recordProgress({ runId: 'run-1', lease, value: { rows: 8 }, recordedAt: at(3), expiresAt: at(5) });
    await store.terminalize({
      runId: 'run-1',
      lease,
      outcome: { status: 'succeeded', output: { uri: 'object://report' } },
      terminalAt: at(4),
      resultExpiresAt: at(6),
    });
    expect(store.facts()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'run-1:progressed:latest', kind: 'progressed' }),
      expect.objectContaining({ id: 'run-1:succeeded:1', kind: 'succeeded' }),
    ]));
    expect(store.facts().filter((fact) => fact.kind === 'progressed')).toEqual([
      expect.objectContaining({ payload: expect.objectContaining({ sequence: 2, value: { rows: 8 } }) }),
    ]);
    await expect(store.purge({ now: at(7) })).resolves.toEqual({ outcomes: 1, progress: 1 });
    const retained = await store.read('run-1');
    expect(retained).toMatchObject({ phase: 'terminal', outcomeDigest: expect.stringMatching(/^sha256:/), progressDigest: expect.stringMatching(/^sha256:/) });
    expect(retained?.outcome).toBeUndefined();
    expect(retained?.progress).toBeUndefined();
  });
});
