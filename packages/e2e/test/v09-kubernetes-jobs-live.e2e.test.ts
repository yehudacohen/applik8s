import type { ApplicationJobStoredRun } from '@applik8s/applik8s/job-store';
import { createKubernetesApplicationJobDispatcher } from '@applik8s/runtime-kubernetes/job-runtime';
import { KubeConfig } from '@kubernetes/client-node';
import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  assertExpectedKubectlContext,
  describeLive,
  kubectl,
  sleep,
  waitForKubernetesResourceDeleted,
} from './live-e2e-helpers.js';

const image = 'node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2';
const namespace = `applik8s-v09-job-${crypto.randomUUID().slice(0, 8)}`;

describeLive('v0.9 Kubernetes finite Job provider', () => {
  beforeAll(async () => {
    await assertExpectedKubectlContext();
    await kubectl(['create', 'namespace', namespace]);
  }, 30_000);

  afterAll(async () => {
    await kubectl(['delete', 'namespace', namespace, '--wait=false']);
    await waitForKubernetesResourceDeleted(`namespace/${namespace}`, 120_000);
  }, 150_000);

  test('creates, re-converges, observes, and UID-deletes one digest-pinned batch/v1 Job', async () => {
    const kubeConfig = new KubeConfig();
    kubeConfig.loadFromDefault();
    kubeConfig.setCurrentContext(process.env.APPLIK8S_E2E_CONTEXT ?? 'orbstack');
    const run = liveRun();
    const dispatcher = await createKubernetesApplicationJobDispatcher({
      applicationId: 'v09-live',
      deploymentId: 'orbstack',
      namespace,
      image,
      kubeConfig,
      workerCommand: ['sh', '-c'],
      workerArguments: ['test "$APPLIK8S_JOB_RUN_ID" = "live-run"'],
      ttlSecondsAfterFinished: 300,
    });
    const created = await dispatcher.dispatch(run);
    expect(created).toMatchObject({ state: 'created', resource: { namespace, uid: expect.any(String) } });
    await expect(dispatcher.dispatch(run)).resolves.toMatchObject({
      state: 'existing',
      resource: { uid: created.resource.uid },
      specDigest: created.specDigest,
    });
    const observed = await waitFor(async () => {
      const value = await dispatcher.observe(run);
      return value?.phase === 'succeeded' ? value : undefined;
    }, 120_000);
    expect(observed).toMatchObject({ phase: 'succeeded', succeeded: 1, resource: { uid: created.resource.uid } });
    await expect(dispatcher.cancel(run)).resolves.toMatchObject({
      state: 'deletionRequested',
      resource: { uid: created.resource.uid },
    });
    await waitFor(async () => await dispatcher.observe(run) === undefined ? true : undefined, 60_000);
  }, 150_000);
});

function liveRun(): ApplicationJobStoredRun {
  const admittedAt = new Date().toISOString();
  return {
    reference: {
      protocol: 'applik8s.jobRuntime/v1alpha1',
      job: 'live.echo.v1',
      runId: 'live-run',
      admittedAt,
    },
    input: { message: 'live' },
    inputDigest: `sha256:${'d'.repeat(64)}`,
    admission: {
      apiVersion: 'applik8s.admission/v1',
      principal: {
        id: 'principal:test:v09-job-live',
        identity: {
          id: 'identity:test:v09-job-live',
          kind: 'service',
          issuer: 'applik8s://test',
          subject: 'v09-job-live',
        },
        kind: 'service',
        authenticationMethod: 'test',
        audience: ['applik8s://jobs/live.echo.v1/operations/run'],
        trustedContextDigest: 'sha256:v09-job-live',
        catalogRevision: 'catalog-v1',
        authorityRevision: 'authority-v1',
        admittedAt,
        expiresAt: new Date(Date.parse(admittedAt) + 300_000).toISOString(),
      },
      authorityRevision: 'authority-v1',
      trustedContext: { values: {}, digest: 'sha256:v09-job-live' },
      operation: { id: 'applik8s://jobs/live.echo.v1/operations/run', transport: 'framework' },
      correlationId: 'v09-job-live',
      deadline: new Date(Date.parse(admittedAt) + 300_000).toISOString(),
    },
    phase: 'queued',
    attempt: 0,
    maximumAttempts: 1,
    admittedAt,
    availableAt: admittedAt,
    deadline: new Date(Date.parse(admittedAt) + 120_000).toISOString(),
  };
}

async function waitFor<T>(read: () => Promise<T | undefined>, timeoutMs: number): Promise<T> {
  const started = Date.now();
  let last: T | undefined;
  while (Date.now() - started < timeoutMs) {
    last = await read();
    if (last !== undefined) return last;
    await sleep(1_000);
  }
  throw new Error(`Timed out waiting for Kubernetes finite Job state; last value: ${JSON.stringify(last)}.`);
}
