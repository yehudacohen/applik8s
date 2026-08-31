import { createApplicationJobBinding } from '@applik8s/applik8s/job';
import { createDeterministicApplicationJobStore, defaultApplicationJobLifecycleFactContracts, type ApplicationJobStoredRun } from '@applik8s/applik8s/job-store';
import type { V1Job, V1Status } from '@kubernetes/client-node';
import { type } from 'arktype';
import { describe, expect, test } from 'vitest';
import {
  createKubernetesApplicationJobDispatcher,
  createKubernetesApplicationJobRuntime,
  KubernetesApplicationJobDispatchError,
  type KubernetesApplicationJobDispatcher,
  type KubernetesApplicationJobDispatcherOptions,
  kubernetesApplicationJobName,
} from '../src/job-runtime.js';

const image = `registry.example.test/applik8s/jobs@sha256:${'a'.repeat(64)}`;

function storedRun(overrides: Partial<ApplicationJobStoredRun> = {}): ApplicationJobStoredRun {
  return {
    reference: {
      protocol: 'applik8s.jobRuntime/v1alpha1',
      job: 'reports.export.v1',
      runId: 'run-1',
      admittedAt: '2026-01-01T00:00:00.000Z',
    },
    input: { report: 'monthly' },
    inputDigest: `sha256:${'b'.repeat(64)}`,
    admission: {
      apiVersion: 'applik8s.admission/v1',
      principal: {
        id: 'principal:test:kubernetes-job',
        identity: {
          id: 'identity:test:kubernetes-job',
          kind: 'service',
          issuer: 'applik8s://test',
          subject: 'kubernetes-job',
        },
        kind: 'service',
        authenticationMethod: 'test',
        audience: ['applik8s://jobs/reports.export.v1/operations/run'],
        trustedContextDigest: 'sha256:kubernetes-job',
        catalogRevision: 'catalog-v1',
        authorityRevision: 'authority-v1',
        admittedAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2026-01-01T01:00:00.000Z',
      },
      authorityRevision: 'authority-v1',
      trustedContext: { values: {}, digest: 'sha256:kubernetes-job' },
      operation: { id: 'applik8s://jobs/reports.export.v1/operations/run', transport: 'framework' },
      correlationId: 'kubernetes-job',
      deadline: '2026-01-01T01:00:00.000Z',
    },
    events: defaultApplicationJobLifecycleFactContracts('reports.export.v1'),
    phase: 'queued',
    attempt: 0,
    maximumAttempts: 2,
    admittedAt: '2026-01-01T00:00:00.000Z',
    availableAt: '2026-01-01T00:00:00.000Z',
    deadline: '2026-01-01T00:30:00.000Z',
    ...overrides,
  };
}

function fakeBatchApi() {
  let live: V1Job | undefined;
  let deletionRequest: Parameters<NonNullable<KubernetesApplicationJobDispatcherOptions['api']>['deleteNamespacedJob']>[0] | undefined;
  const api: NonNullable<KubernetesApplicationJobDispatcherOptions['api']> = {
    async createNamespacedJob(request) {
      if (live) throw Object.assign(new Error('already exists'), { code: 409 });
      live = structuredClone(request.body);
      live.metadata = { ...live.metadata, uid: 'uid-run-1' };
      return structuredClone(live);
    },
    async readNamespacedJob() {
      if (!live) throw Object.assign(new Error('not found'), { response: { statusCode: 404 } });
      return structuredClone(live);
    },
    async deleteNamespacedJob(request) {
      deletionRequest = request;
      if (!live) throw Object.assign(new Error('not found'), { code: 404 });
      if (request.body?.preconditions?.uid !== live.metadata?.uid) {
        throw Object.assign(new Error('UID precondition failed'), { code: 409 });
      }
      live = undefined;
      return { apiVersion: 'v1', kind: 'Status', status: 'Success' } satisfies V1Status;
    },
  };
  return {
    api,
    live: () => live,
    replace(value: V1Job | undefined) { live = value; },
    deletionRequest: () => deletionRequest,
  };
}

describe('Kubernetes finite Job dispatcher', () => {
  test('assembles controller admission and an exact-run worker over one durable authority', async () => {
    const store = createDeterministicApplicationJobStore();
    const dispatched: string[] = [];
    const cancelled: string[] = [];
    const dispatcher: KubernetesApplicationJobDispatcher = {
      async dispatch(run: ApplicationJobStoredRun) {
        dispatched.push(run.reference.runId);
        return {
          protocol: 'applik8s.kubernetes-job-dispatch/v1alpha1',
          run: run.reference,
          resource: {
            apiVersion: 'batch/v1',
            kind: 'Job',
            namespace: 'reports-system',
            name: 'job-pod',
            uid: 'uid-job-pod',
          },
          state: 'created',
          specDigest: `sha256:${'c'.repeat(64)}`,
        };
      },
      async cancel(run: ApplicationJobStoredRun) {
        cancelled.push(run.reference.runId);
        return {
          protocol: 'applik8s.kubernetes-job-dispatch/v1alpha1',
          run: run.reference,
          state: 'deletionRequested',
          resource: { namespace: 'reports-system', name: 'job-pod', uid: 'uid-job-pod' },
        };
      },
      async observe() { return undefined; },
    };
    const shared = {
      applicationId: 'reports',
      deploymentId: 'production',
      namespace: 'reports-system',
      image,
      store,
      dispatcher,
      pollIntervalMs: 5,
    };
    const definition = {
      id: 'reports.export.v1',
      contract: { input: type({ value: 'number' }), output: type({ doubled: 'number' }) },
      options: {},
      handler: (input: { readonly value: number }) => ({ doubled: input.value * 2 }),
    };
    const controller = await createKubernetesApplicationJobRuntime(shared);
    const job = createApplicationJobBinding(definition, controller);
    const run = await job.start({ value: 6 });
    expect(dispatched).toEqual([run.reference.runId]);

    const worker = await createKubernetesApplicationJobRuntime({
      ...shared,
      workerRunId: run.reference.runId,
      workerId: 'job-pod',
    });
    createApplicationJobBinding(definition, worker);
    await expect(run.result()).resolves.toEqual({ doubled: 12 });
    expect(cancelled).toEqual([]);
    await controller.close();
    await worker.close();
  });

  test('converges a digest-pinned, bounded-retrying Job for one durable run', async () => {
    const fake = fakeBatchApi();
    const run = storedRun();
    const dispatcher = await createKubernetesApplicationJobDispatcher({
      applicationId: 'reports',
      deploymentId: 'production',
      namespace: 'reports-system',
      image,
      serviceAccountName: 'reports-jobs',
      api: fake.api,
    });
    const created = await dispatcher.dispatch(run);
    expect(created).toMatchObject({
      state: 'created',
      run: run.reference,
      resource: { namespace: 'reports-system', uid: 'uid-run-1' },
      specDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
    const existing = await dispatcher.dispatch(run);
    expect(existing).toMatchObject({ state: 'existing', specDigest: created.specDigest });
    expect(fake.live()).toMatchObject({
      spec: {
        backoffLimit: 1,
        activeDeadlineSeconds: 1_800,
        template: {
          spec: {
            restartPolicy: 'Never',
            serviceAccountName: 'reports-jobs',
            containers: [{
              image,
              args: ['--applik8s-job-run', 'run-1'],
              env: expect.arrayContaining([
                { name: 'APPLIK8S_JOB_RUN_ID', value: 'run-1' },
                { name: 'APPLIK8S_JOB_ID', value: 'reports.export.v1' },
              ]),
            }],
          },
        },
      },
    });
  });

  test('projects the logical attempt budget into bounded infrastructure replacement', async () => {
    const fake = fakeBatchApi();
    const dispatcher = await createKubernetesApplicationJobDispatcher({
      applicationId: 'reports',
      deploymentId: 'production',
      namespace: 'reports-system',
      image,
      api: fake.api,
    });
    await dispatcher.dispatch(storedRun({ maximumAttempts: 4 }));
    expect(fake.live()?.spec?.backoffLimit).toBe(3);
  });

  test('reports an active replacement attempt as running despite prior pod failure', async () => {
    const fake = fakeBatchApi();
    const run = storedRun({ maximumAttempts: 2 });
    const dispatcher = await createKubernetesApplicationJobDispatcher({
      applicationId: 'reports',
      deploymentId: 'production',
      namespace: 'reports-system',
      image,
      api: fake.api,
    });
    await dispatcher.dispatch(run);
    fake.replace({
      ...fake.live(),
      status: { active: 1, failed: 1, succeeded: 0 },
    });
    await expect(dispatcher.observe(run)).resolves.toMatchObject({
      phase: 'running',
      active: 1,
      failed: 1,
    });
  });

  test('refuses to adopt a colliding or drifted Job', async () => {
    const fake = fakeBatchApi();
    const run = storedRun();
    const dispatcher = await createKubernetesApplicationJobDispatcher({
      applicationId: 'reports',
      deploymentId: 'production',
      namespace: 'reports-system',
      image,
      api: fake.api,
    });
    fake.replace({
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: {
        name: kubernetesApplicationJobName({ applicationId: 'reports', deploymentId: 'production' }, 'run-1'),
        namespace: 'reports-system',
        uid: 'foreign',
        annotations: { 'jobs.applik8s.dev/run-id': 'another-run' },
      },
    });
    await expect(dispatcher.dispatch(run)).rejects.toBeInstanceOf(KubernetesApplicationJobDispatchError);
  });

  test('cancels only the observed UID and reports terminal absence idempotently', async () => {
    const fake = fakeBatchApi();
    const run = storedRun();
    const dispatcher = await createKubernetesApplicationJobDispatcher({
      applicationId: 'reports',
      deploymentId: 'production',
      namespace: 'reports-system',
      image,
      api: fake.api,
    });
    await dispatcher.dispatch(run);
    await expect(dispatcher.cancel(run)).resolves.toMatchObject({
      state: 'deletionRequested',
      resource: { uid: 'uid-run-1' },
    });
    expect(fake.deletionRequest()?.body?.preconditions?.uid).toBe('uid-run-1');
    await expect(dispatcher.cancel(run)).resolves.toMatchObject({ state: 'absent' });
  });

  test('rejects mutable image tags and reserved environment overrides', async () => {
    await expect(createKubernetesApplicationJobDispatcher({
      applicationId: 'reports',
      deploymentId: 'production',
      namespace: 'reports-system',
      image: 'registry.example.test/applik8s/jobs:latest',
      api: fakeBatchApi().api,
    })).rejects.toThrow(/immutable sha256 digest/u);
    await expect(createKubernetesApplicationJobDispatcher({
      applicationId: 'reports',
      deploymentId: 'production',
      namespace: 'reports-system',
      image,
      environment: [{ name: 'APPLIK8S_JOB_RUN_ID', value: 'forged' }],
      api: fakeBatchApi().api,
    })).rejects.toThrow(/cannot override framework variable/u);
  });
});
