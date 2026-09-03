// typecast-file-boundary: the live Job fixture narrows Kubernetes responses only after identity and lifecycle assertions.
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ContainerRegistry,
  Database,
  EventLog,
  FiniteExecutionHost,
  JobResultStore,
  JobRuntime,
  KubernetesCluster,
  Queue,
  Scheduler,
  TransactionalDatabase,
  app,
  applicationGraphFor,
} from '@applik8s/applik8s';
import { createApplicationJobBinding } from '@applik8s/applik8s/job';
import { createRemoteApplicationJobRuntime } from '@applik8s/applik8s/job-runtime-remote';
import { defaultApplicationJobLifecycleFactContracts, type ApplicationJobStoredRun } from '@applik8s/applik8s/job-store';
import { validateApplicationAdmissionContextV1 } from '@applik8s/core';
import {
  createSignedEnvelopeCodec,
  signedEnvelopeUtf8Key,
  staticSignedEnvelopeKeyProvider,
} from '@applik8s/runtime';
import { createKubernetesApplicationJobDispatcher } from '@applik8s/runtime-kubernetes/job-runtime';
import { KubeConfig } from '@kubernetes/client-node';
import { type } from 'arktype';
import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  emitGeneratedApplicationJobs,
  type GeneratedApplicationJobResource,
} from '../../compiler/src/application-jobs/index.js';
import {
  assertExpectedKubectlContext,
  describeLive,
  docker,
  kubectl,
  sleep,
  waitForKubernetesResourceDeleted,
} from './live-e2e-helpers.js';

const image = 'node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2';
const namespace = `applik8s-v09-job-${crypto.randomUUID().slice(0, 8)}`;
const generatedApplicationName = 'v09-generated-job';
const internalOperationSecret = 'v09-generated-job-live-internal-operation-secret-key';

const generatedJobApplication = app(generatedApplicationName, { namespace });
const generatedCluster = KubernetesCluster.current();
const generatedDatabase = generatedJobApplication.provide(
  TransactionalDatabase,
  Database.postgres({ name: 'job-state', namespace, database: 'postgres' }),
);
const generatedEventLog = generatedJobApplication.provide(EventLog, {
  kind: 'nats-jetstream',
  name: 'job-events',
  namespace,
});
const generatedRegistry = generatedJobApplication.provide(
  ContainerRegistry,
  ContainerRegistry.oci({
    endpoint: ContainerRegistry.origin('https://registry.example.test'),
    repositoryPrefix: generatedApplicationName,
  }),
);
generatedJobApplication.provide(JobRuntime, JobRuntime.kubernetes({
  cluster: generatedCluster,
  namespace,
  maximumConcurrency: 2,
  queue: Queue.jetStream({ eventLog: generatedEventLog }),
  executionHost: FiniteExecutionHost.kubernetes({ cluster: generatedCluster, registry: generatedRegistry }),
  results: JobResultStore.postgres({ database: generatedDatabase }),
  scheduler: Scheduler.postgres({ database: generatedDatabase }),
  events: generatedEventLog,
}));
const GeneratedDouble = generatedJobApplication.job(
  'numbers.double.live.v1',
  {
    input: type({ value: 'number.integer', delayMs: 'number.integer >= 0' }),
    output: type({ doubled: 'number.integer' }),
    progress: type({ completed: 'number.integer' }),
  },
  { retries: 1, timeout: '2m', retention: { result: '1h', progress: '1h' } },
  async function generatedDouble(input, execution) {
    await execution.progress({ completed: 1 });
    if (input.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, input.delayMs));
      execution.throwIfCancelled();
    }
    return { doubled: input.value * 2 };
  },
);

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

  test('replaces an interrupted worker pod within the logical attempt budget', async () => {
    const kubeConfig = new KubeConfig();
    kubeConfig.loadFromDefault();
    kubeConfig.setCurrentContext(process.env.APPLIK8S_E2E_CONTEXT ?? 'orbstack');
    const run = liveRun({
      runId: 'interrupted-run',
      maximumAttempts: 2,
    });
    const dispatcher = await createKubernetesApplicationJobDispatcher({
      applicationId: 'v09-live',
      deploymentId: 'orbstack',
      namespace,
      image,
      kubeConfig,
      workerCommand: ['sh', '-c'],
      workerArguments: ['sleep 300'],
      ttlSecondsAfterFinished: 300,
    });
    const created = await dispatcher.dispatch(run);
    const firstPod = await waitFor(
      () => workerPodFor(created.resource.name),
      60_000,
    );
    await kubectl([
      'delete',
      `pod/${firstPod.name}`,
      '--namespace',
      namespace,
      '--wait=true',
    ]);
    const replacement = await waitFor(async () => {
      const pod = await workerPodFor(created.resource.name);
      return pod && pod.uid !== firstPod.uid ? pod : undefined;
    }, 90_000);
    expect(replacement.uid).not.toBe(firstPod.uid);
    await expect(dispatcher.observe(run)).resolves.toMatchObject({
      phase: 'running',
      resource: { uid: created.resource.uid },
    });
    await dispatcher.cancel(run);
    await waitFor(async () => await dispatcher.observe(run) === undefined ? true : undefined, 60_000);
  }, 180_000);

  test('executes the authored and compiled Job vertical through durable admission, restart, and cancellation', async () => {
    const graph = applicationGraphFor(generatedJobApplication.composition);
    if (!graph) throw new Error('Expected generated finite Job graph.');
    const outDir = await mkdtemp(join(tmpdir(), 'applik8s-v09-generated-job-live-'));
    let forward: PortForward | undefined;
    try {
      const [artifact] = await emitGeneratedApplicationJobs({
        graph,
        outDir,
        entrypoint: import.meta.filename,
        executionTarget: 'kubernetes',
      });
      if (!artifact) throw new Error('Expected generated Kubernetes Job artifact.');
      await docker(
        ['build', '--tag', artifact.container.image, '--file', artifact.container.dockerfilePath, artifact.container.contextPath],
        process.cwd(),
      );
      const imageId = (await docker(
        ['image', 'inspect', artifact.container.image, '--format', '{{.Id}}'],
        process.cwd(),
      )).stdout.trim();
      if (!/^sha256:[a-f0-9]{64}$/u.test(imageId)) {
        throw new Error(`Docker returned an invalid content-addressed image ID: ${imageId}`);
      }
      const manifestPath = join(outDir, 'live-resources.json');
      await writeFile(manifestPath, JSON.stringify({
        apiVersion: 'v1',
        kind: 'List',
        items: [
          postgresSecret(),
          internalSecret(),
          postgresService(),
          postgresDeployment(),
          ...artifact.resources.map((resource) => jobRuntimeImage(resource, imageId)),
        ],
      }));
      await kubectl(['apply', '--filename', manifestPath]);
      await kubectl([
        'rollout',
        'status',
        'deployment/v09-job-postgres',
        '--namespace',
        namespace,
        '--timeout=180s',
      ]);
      await kubectl([
        'rollout',
        'status',
        `deployment/${artifact.name}`,
        '--namespace',
        namespace,
        '--timeout=180s',
      ]);
      forward = await startPortForward(`service/${artifact.name}`, 8091);
      const remote = createRemoteApplicationJobRuntime({
        endpoint: `${forward.endpoint}/v1/jobs`,
        authorization: internalOperationSecret,
        pollIntervalMs: 100,
        encodeAdmission: (admission) => admissionCodec().sign(admission, { expiresInMs: 60_000 }),
      });
      const job = createApplicationJobBinding(GeneratedDouble.definition, remote);
      const admission = liveAdmission('numbers.double.live.v1');

      const first = await job.start(
        { value: 21, delayMs: 3_000 },
        { admission, idempotencyKey: 'double-21' },
      );
      await waitFor(async () => {
        const progress = await first.progress();
        return progress?.value.completed === 1 ? progress : undefined;
      }, 60_000);
      const duplicate = await job.start(
        { value: 21, delayMs: 3_000 },
        { admission, idempotencyKey: 'double-21' },
      );
      expect(duplicate.reference).toEqual(first.reference);
      await expect(first.result()).resolves.toEqual({ doubled: 42 });

      const rejoinable = await job.start(
        { value: 9, delayMs: 8_000 },
        { admission, idempotencyKey: 'restart-reattach' },
      );
      await kubectl([
        'delete',
        'pod',
        '--namespace',
        namespace,
        '--selector',
        `app.kubernetes.io/name=${artifact.name}`,
        '--wait=true',
      ]);
      await kubectl([
        'rollout',
        'status',
        `deployment/${artifact.name}`,
        '--namespace',
        namespace,
        '--timeout=180s',
      ]);
      await forward.close();
      forward = await startPortForward(`service/${artifact.name}`, 8091);
      const restartedRuntime = createRemoteApplicationJobRuntime({
        endpoint: `${forward.endpoint}/v1/jobs`,
        authorization: internalOperationSecret,
        pollIntervalMs: 100,
        encodeAdmission: (value) => admissionCodec().sign(value, { expiresInMs: 60_000 }),
      });
      const restartedJob = createApplicationJobBinding(GeneratedDouble.definition, restartedRuntime);
      const attached = await restartedJob.attach(rejoinable.reference);
      await expect(attached.result()).resolves.toEqual({ doubled: 18 });

      const cancellable = await restartedJob.start(
        { value: 5, delayMs: 30_000 },
        { admission, idempotencyKey: 'cancel-live-run' },
      );
      await waitFor(async () => {
        const progress = await cancellable.progress();
        return progress?.value.completed === 1 ? progress : undefined;
      }, 60_000);
      await expect(cancellable.cancel('live cancellation proof')).resolves.toMatchObject({ status: 'requested' });
      await expect(cancellable.outcome()).resolves.toMatchObject({
        status: 'cancelled',
        reason: 'live cancellation proof',
      });
    } finally {
      await forward?.close();
      await kubectl(['delete', 'jobs', '--all', '--namespace', namespace, '--wait=true']).catch(() => undefined);
      await kubectl([
        'delete',
        'deployment/v09-generated-job-jobs',
        'deployment/v09-job-postgres',
        'service/v09-generated-job-jobs',
        'service/v09-job-postgres',
        'serviceaccount/v09-generated-job-jobs',
        'role/v09-generated-job-jobs',
        'rolebinding/v09-generated-job-jobs',
        'networkpolicy/v09-generated-job-jobs',
        'secret/job-state-app',
        `secret/${generatedApplicationName}-internal-operation`,
        '--namespace',
        namespace,
        '--ignore-not-found=true',
        '--wait=true',
      ]).catch(() => undefined);
      await docker(['image', 'rm', '--force', generatedJobImageName()], process.cwd()).catch(() => undefined);
      await rm(outDir, { recursive: true, force: true });
    }
  }, 420_000);
});

interface PortForward {
  readonly endpoint: string;
  close(): Promise<void>;
}

function postgresSecret(): object {
  return {
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: { name: 'job-state-app', namespace },
    stringData: { uri: `postgresql://postgres:postgres@v09-job-postgres.${namespace}.svc:5432/postgres` },
  };
}

function internalSecret(): object {
  return {
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: { name: `${generatedApplicationName}-internal-operation`, namespace },
    stringData: { key: internalOperationSecret },
  };
}

function postgresService(): object {
  return {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: { name: 'v09-job-postgres', namespace },
    spec: { selector: { app: 'v09-job-postgres' }, ports: [{ name: 'postgres', port: 5432, targetPort: 5432 }] },
  };
}

function postgresDeployment(): object {
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name: 'v09-job-postgres', namespace },
    spec: {
      replicas: 1,
      selector: { matchLabels: { app: 'v09-job-postgres' } },
      template: {
        metadata: { labels: { app: 'v09-job-postgres' } },
        spec: {
          containers: [{
            name: 'postgres',
            image: 'postgres:17-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193',
            env: [{ name: 'POSTGRES_PASSWORD', value: 'postgres' }],
            ports: [{ containerPort: 5432 }],
            readinessProbe: {
              exec: { command: ['pg_isready', '-U', 'postgres'] },
              periodSeconds: 2,
              timeoutSeconds: 2,
            },
          }],
        },
      },
    },
  };
}

function generatedJobImageName(): string {
  return `applik8s/${generatedApplicationName}-job-runtime-${generatedApplicationName}-jobs`;
}

function jobRuntimeImage(
  resource: GeneratedApplicationJobResource,
  imageId: string,
): GeneratedApplicationJobResource {
  if (resource.kind !== 'Deployment') return resource;
  const copy = structuredClone(resource);
  const spec = objectValue(copy.spec, 'generated Job Deployment spec');
  const template = objectValue(spec.template, 'generated Job pod template');
  const podSpec = objectValue(template.spec, 'generated Job pod spec');
  const containers = podSpec.containers;
  if (!Array.isArray(containers)) throw new Error('Generated Job controller Deployment has no containers.');
  const controller = containers[0];
  if (!controller || typeof controller !== 'object') throw new Error('Generated Job controller container is invalid.');
  const environment = Reflect.get(controller, 'env');
  if (!Array.isArray(environment)) throw new Error('Generated Job controller has no environment.');
  const workerImage = environment.find((entry) =>
    entry && typeof entry === 'object' && Reflect.get(entry, 'name') === 'APPLIK8S_JOB_IMAGE');
  if (!workerImage || typeof workerImage !== 'object') {
    throw new Error('Generated Job controller does not declare APPLIK8S_JOB_IMAGE.');
  }
  Reflect.set(workerImage, 'value', imageId);
  return copy;
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  // typecast: the live fixture validates the object boundary immediately above.
  return value as Record<string, unknown>;
}

function liveAdmission(job: string) {
  const admittedAt = new Date().toISOString();
  return {
    apiVersion: 'applik8s.admission/v1' as const,
    principal: {
      id: 'principal:test:v09-generated-job',
      identity: {
        id: 'identity:test:v09-generated-job',
        kind: 'service' as const,
        issuer: 'applik8s://test',
        subject: 'v09-generated-job',
      },
      kind: 'service' as const,
      authenticationMethod: 'test',
      audience: [`applik8s://jobs/${job}/operations/run`],
      trustedContextDigest: 'sha256:v09-generated-job-live',
      catalogRevision: 'catalog-v1',
      authorityRevision: 'authority-v1',
      admittedAt,
      expiresAt: new Date(Date.parse(admittedAt) + 300_000).toISOString(),
    },
    authorityRevision: 'authority-v1',
    trustedContext: { values: {}, digest: 'sha256:v09-generated-job-live' },
    operation: { id: `applik8s://jobs/${job}/operations/run`, transport: 'framework' as const },
    correlationId: crypto.randomUUID(),
    deadline: new Date(Date.parse(admittedAt) + 300_000).toISOString(),
  };
}

function admissionCodec() {
  return createSignedEnvelopeCodec({
    purpose: 'applik8s.job-controller-admission/v1',
    keys: staticSignedEnvelopeKeyProvider({
      current: {
        id: 'application-internal-operation',
        key: signedEnvelopeUtf8Key(internalOperationSecret),
      },
    }),
    validatePayload: validateApplicationAdmissionContextV1,
    maximumEncodedBytes: 32_768,
    maximumLifetimeMs: 60_000,
  });
}

async function startPortForward(resource: string, remotePort: number): Promise<PortForward> {
  const child = spawn(
    'kubectl',
    ['port-forward', '--namespace', namespace, resource, `0:${remotePort}`],
    { cwd: process.cwd(), env: process.env },
  );
  let output = '';
  const endpoint = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out starting kubectl port-forward.\n${output}`)), 30_000);
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(new RegExp(`Forwarding from 127\\.0\\.0\\.1:(\\d+) -> ${remotePort}`));
      if (match?.[1]) {
        clearTimeout(timeout);
        resolve(`http://127.0.0.1:${match[1]}`);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`kubectl port-forward exited with code ${code}.\n${output}`));
    });
  });
  return { endpoint, close: () => closePortForward(child) };
}

async function closePortForward(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
    setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
      resolve();
    }, 5_000);
  });
}

function liveRun(options: {
  readonly runId?: string;
  readonly maximumAttempts?: number;
} = {}): ApplicationJobStoredRun {
  const admittedAt = new Date().toISOString();
  const runId = options.runId ?? 'live-run';
  return {
    reference: {
      protocol: 'applik8s.jobRuntime/v1alpha1',
      job: 'live.echo.v1',
      runId,
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
    events: defaultApplicationJobLifecycleFactContracts('live.echo.v1'),
    phase: 'queued',
    attempt: 0,
    maximumAttempts: options.maximumAttempts ?? 1,
    admittedAt,
    availableAt: admittedAt,
    deadline: new Date(Date.parse(admittedAt) + 120_000).toISOString(),
  };
}

async function workerPodFor(jobName: string): Promise<{
  readonly name: string;
  readonly uid: string;
} | undefined> {
  const response = await kubectl([
    'get',
    'pods',
    '--namespace',
    namespace,
    '--selector',
    `job-name=${jobName}`,
    '--output=json',
  ]);
  const payload = JSON.parse(response.stdout) as {
    readonly items?: readonly {
      readonly metadata?: { readonly name?: string; readonly uid?: string; readonly deletionTimestamp?: string };
    }[];
  };
  const pod = payload.items?.find(({ metadata }) =>
    metadata?.name && metadata.uid && !metadata.deletionTimestamp);
  return pod?.metadata?.name && pod.metadata.uid
    ? { name: pod.metadata.name, uid: pod.metadata.uid }
    : undefined;
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
