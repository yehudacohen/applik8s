import { validateApplicationGraphCompatibilityPolicy } from '@applik8s/core';
import { type } from 'arktype';
import { describe, expect, test } from 'vitest';
import { app, applicationGraphFor } from '../src/application-builder.js';
import {
  ApplicationJobIdempotencyConflictError,
  ApplicationJobInvocationTimeoutError,
  ApplicationJobProgressExpiredError,
  ApplicationJobProviderUnsupportedError,
  ApplicationJobResultExpiredError,
  ApplicationJobRunError,
  createApplicationJobBinding,
  createDeterministicApplicationJobRuntime,
  installApplicationJobRuntimeResolver,
} from '../src/application-finite-jobs.js';
import {
  AWS,
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
} from '../src/application-providers.js';
import { config, secret } from '../src/application-configuration.js';
import { applicationCapabilityImplementationMetadata } from '../src/application-capability-implementation.js';

const Input = type({ value: 'number.integer' });
const Output = type({ doubled: 'number.integer' });
const Progress = type({ completed: 'number.integer >= 0' });
const Failure = type({ code: "'invalid'" });

describe('application finite Job runtime', () => {
  test('registers function-native finite work as a semantic Job graph node', async () => {
    const application = app('finite-jobs', {
      spec: type({}),
      status: type({ ready: 'boolean' }),
    });
    const job = application.job(
      'numbers.double.v1',
      { input: Input, output: Output, progress: Progress, error: Failure },
      {
        retries: 2,
        timeout: '30s',
        idempotencyKey: (input) => String(input.value),
        retention: { result: '2d', progress: '1h' },
      },
      async (input, execution) => {
        await execution.progress({ completed: 1 });
        return { doubled: input.value * 2 };
      },
    );

    await expect(job({ value: 9 })).resolves.toEqual({ doubled: 18 });
    const graph = applicationGraphFor(application.composition);
    expect(graph?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'job',
        contract: expect.objectContaining({ name: 'numbers.double', version: 'v1' }),
        retry: { maxAttempts: 3, wholeAttempt: true },
        executionDeadlineSeconds: 30,
        idempotency: expect.objectContaining({
          scope: 'applicationDeploymentContractContextAuthority',
          keySource: 'inputExpression',
          conflict: 'failClosed',
        }),
        runtime: {
          interface: 'JobRuntime',
          selection: 'profile',
          protocol: 'applik8s.jobRuntime/v1alpha1',
        },
        retention: {
          source: 'profileWithAuthoredOverrides',
          resultSeconds: 172_800,
          progressSeconds: 3_600,
        },
      }),
    ]));
    expect(graph?.compatibility.experimentalSurfaces).toContain('app.job');
    expect(graph?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'provider',
        interface: 'JobRuntime',
        implementation: 'local-job-runtime',
        stability: 'experimental',
      }),
    ]));
    expect(graph?.providerRequirements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        interface: 'JobRuntime',
        consumer: expect.objectContaining({ nodeId: expect.stringContaining('job.') }),
        purpose: 'finiteExecution',
      }),
    ]));
    expect(graph ? validateApplicationGraphCompatibilityPolicy(graph) : []).toEqual([]);
  });

  test('selects maintained JobRuntime implementations and fails closed without their adapter', async () => {
    const application = app('kubernetes-finite-jobs', {
      spec: type({}),
      status: type({ ready: 'boolean' }),
    });
    const cluster = KubernetesCluster.current();
    const database = application.provide(TransactionalDatabase, Database.postgres({
      name: 'jobs',
      namespace: 'application-jobs',
      database: 'jobs',
    }));
    const eventLog = application.provide(EventLog, {
      kind: 'nats-jetstream',
      name: 'jobs-events',
      namespace: 'application-jobs',
    });
    const registry = application.provide(ContainerRegistry, ContainerRegistry.oci({
      endpoint: ContainerRegistry.origin('https://registry.example.test'),
      repositoryPrefix: 'application-jobs',
    }));
    const queue = Queue.jetStream({ eventLog });
    const executionHost = FiniteExecutionHost.kubernetes({ cluster, registry });
    const results = JobResultStore.postgres({ database });
    const scheduler = Scheduler.postgres({ database });
    const runtimeOptions = {
      cluster,
      queue,
      executionHost,
      results,
      scheduler,
      events: eventLog,
      namespace: 'application-jobs',
      maximumConcurrency: 12,
      maximumDuration: '30m',
      resultRetentionSeconds: 86_400,
    };
    const selectedJobRuntime = JobRuntime.kubernetes(runtimeOptions);
    application.provide(JobRuntime, selectedJobRuntime);
    const job = application.job(
      'search.rebuild.v1',
      { input: Input, output: Output },
      {},
      (input) => ({ doubled: input.value * 2 }),
    );

    expect(applicationGraphFor(application.composition)?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'provider',
        interface: 'JobRuntime',
        implementation: 'kubernetes-job-runtime',
        config: expect.objectContaining({
          maximumConcurrency: 12,
          maximumDuration: '30m',
          namespace: 'application-jobs',
        }),
      }),
    ]));
    expect(() => JobRuntime.local({ maximumConcurrency: 0 })).toThrow('maximumConcurrency');
    expect(() => JobRuntime.kubernetes({ ...runtimeOptions, maximumDuration: '' })).toThrow('maximumDuration');
    expect(() => AWS.account({
      accountId: '',
      region: 'us-east-1',
      credentials: secret.env('AWS_CREDENTIALS'),
    })).toThrow('accountId');
    expect(KubernetesCluster.external({
      endpoint: config.env.url('KUBERNETES_ENDPOINT'),
      credentials: secret.env('KUBERNETES_CREDENTIALS'),
      namespace: config.env('KUBERNETES_NAMESPACE'),
    })).toMatchObject({
      kind: 'external-kubernetes-cluster',
      endpoint: { kind: 'config', valueType: 'url' },
      credentials: { kind: 'secret' },
    });
    expect(applicationCapabilityImplementationMetadata(selectedJobRuntime)?.dependencies).toEqual([
      expect.objectContaining({ slot: 'queue', requirement: expect.objectContaining({ name: 'Queue' }) }),
      expect.objectContaining({ slot: 'execution-host', requirement: expect.objectContaining({ name: 'FiniteExecutionHost' }) }),
      expect.objectContaining({ slot: 'results', requirement: expect.objectContaining({ name: 'JobResultStore' }) }),
      expect.objectContaining({ slot: 'scheduler', requirement: expect.objectContaining({ name: 'Scheduler' }) }),
      expect.objectContaining({ slot: 'events', requirement: expect.objectContaining({ name: 'EventLog' }) }),
    ]);
    await expect(job({ value: 2 })).rejects.toMatchObject({
      code: 'JOB_PROVIDER_UNSUPPORTED',
      providerNodeId: 'provider.job-runtime',
    } satisfies Partial<ApplicationJobProviderUnsupportedError>);

    const runtime = createDeterministicApplicationJobRuntime();
    const uninstall = installApplicationJobRuntimeResolver((providerNodeId) =>
      providerNodeId === 'provider.job-runtime' ? runtime : undefined);
    try {
      await expect(job({ value: 2 })).resolves.toEqual({ doubled: 4 });
    } finally {
      uninstall();
    }
  });

  test('keeps semantic Jobs distinct from explicit Kubernetes workload Jobs', () => {
    const application = app('job-vocabulary', {
      spec: type({}),
      status: type({ ready: 'boolean' }),
    });
    application.job(
      'semantic.run.v1',
      { input: Input, output: Output },
      {},
      (input) => ({ doubled: input.value * 2 }),
    );
    application.workload.job('migration', {
      taskKind: 'migration',
      image: 'busybox:1.36',
      command: ['sh', '-c'],
      args: ['echo migration'],
    });

    const nodes = applicationGraphFor(application.composition)?.nodes ?? [];
    expect(nodes.some((node) => node.kind === 'job')).toBe(true);
    expect(nodes.some((node) => node.kind === 'workloadJob')).toBe(true);
  });

  test('returns one typed result for direct and durable invocation', async () => {
    const runtime = createDeterministicApplicationJobRuntime({ id: () => 'run-1' });
    const executions: Array<{ readonly invocationId: string; readonly deadline?: string }> = [];
    const job = createApplicationJobBinding({
      id: 'numbers.double.v1',
      contract: { input: Input, output: Output, progress: Progress, error: Failure },
      options: { timeout: '1h' },
      handler: async (input, execution) => {
        executions.push({
          invocationId: execution.invocationId,
          ...(execution.deadline ? { deadline: execution.deadline } : {}),
        });
        await execution.progress({ completed: 1 });
        return { doubled: input.value * 2 };
      },
    }, runtime);

    await expect(job({ value: 3 })).resolves.toEqual({ doubled: 6 });
    const run = await job.start({ value: 4 });
    await expect(run.result()).resolves.toEqual({ doubled: 8 });
    await expect(run.progress()).resolves.toMatchObject({ sequence: 1, value: { completed: 1 } });
    await expect(job.attach(run.reference).then((attached) => attached.result())).resolves.toEqual({ doubled: 8 });
    expect(executions).toEqual([
      expect.objectContaining({ invocationId: expect.any(String), deadline: expect.any(String) }),
      expect.objectContaining({ invocationId: 'run-1', deadline: expect.any(String) }),
    ]);
  });

  test('deduplicates only an identical input within the complete scoped key', async () => {
    let executions = 0;
    let nextId = 0;
    const runtime = createDeterministicApplicationJobRuntime({ id: () => `run-${++nextId}` });
    const job = createApplicationJobBinding({
      id: 'numbers.idempotent.v1',
      contract: { input: Input, output: Output },
      options: { idempotencyKey: () => 'same-key' },
      handler: (input) => {
        executions += 1;
        return { doubled: input.value * 2 };
      },
    }, runtime);

    const first = await job.start({ value: 2 });
    const duplicate = await job.start({ value: 2 });
    expect(duplicate.reference).toEqual(first.reference);
    await expect(first.result()).resolves.toEqual({ doubled: 4 });
    expect(executions).toBe(1);
    await expect(job.start({ value: 3 })).rejects.toBeInstanceOf(ApplicationJobIdempotencyConflictError);
  });

  test('retries whole attempts and preserves one terminal result', async () => {
    let attempts = 0;
    const runtime = createDeterministicApplicationJobRuntime();
    const job = createApplicationJobBinding({
      id: 'numbers.retry.v1',
      contract: { input: Input, output: Output },
      options: { retries: 2 },
      handler: (input) => {
        attempts += 1;
        if (attempts < 3) throw new Error('transient');
        return { doubled: input.value * 2 };
      },
    }, runtime);

    await expect(job({ value: 5 })).resolves.toEqual({ doubled: 10 });
    expect(attempts).toBe(3);
  });

  test('reports authored failures separately from framework execution failure', async () => {
    const runtime = createDeterministicApplicationJobRuntime();
    const job = createApplicationJobBinding({
      id: 'numbers.failure.v1',
      contract: { input: Input, output: Output, error: Failure },
      options: { retries: 3 },
      handler: (_input, execution) => execution.fail({ code: 'invalid' }),
    }, runtime);
    const run = await job.start({ value: 1 });
    await expect(run.outcome()).resolves.toEqual({
      status: 'failed',
      failure: { kind: 'application', error: { code: 'invalid' } },
    });
    await expect(run.result()).rejects.toBeInstanceOf(ApplicationJobRunError);
  });

  test('cancels queued work without executing it', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let queuedExecutions = 0;
    const runtime = createDeterministicApplicationJobRuntime({ maximumConcurrency: 1 });
    const blocker = createApplicationJobBinding({
      id: 'numbers.blocker.v1',
      contract: { input: Input, output: Output },
      options: {},
      handler: async (input) => {
        await held;
        return { doubled: input.value * 2 };
      },
    }, runtime);
    const queued = createApplicationJobBinding({
      id: 'numbers.queued.v1',
      contract: { input: Input, output: Output },
      options: {},
      handler: (input) => {
        queuedExecutions += 1;
        return { doubled: input.value * 2 };
      },
    }, runtime);

    const active = await blocker.start({ value: 1 });
    const waiting = await queued.start({ value: 2 });
    await expect(waiting.cancel('superseded')).resolves.toMatchObject({ status: 'requested' });
    await expect(waiting.outcome()).resolves.toEqual({ status: 'cancelled', reason: 'superseded' });
    expect(queuedExecutions).toBe(0);
    release();
    await active.result();
  });

  test('caller timeout returns a rejoinable run without cancelling managed work', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const runtime = createDeterministicApplicationJobRuntime();
    const job = createApplicationJobBinding({
      id: 'numbers.wait.v1',
      contract: { input: Input, output: Output },
      options: {},
      handler: async (input) => {
        await held;
        return { doubled: input.value * 2 };
      },
    }, runtime);

    let timeout: ApplicationJobInvocationTimeoutError | undefined;
    try {
      await job({ value: 6 }, { wait: { timeout: '1s' } });
    } catch (error) {
      if (error instanceof ApplicationJobInvocationTimeoutError) timeout = error;
      else throw error;
    }
    expect(timeout?.run.job).toBe('numbers.wait.v1');
    if (!timeout) throw new Error('Expected the bounded caller wait to time out.');
    release();
    await expect(job.attach(timeout.run).then((run) => run.result())).resolves.toEqual({ doubled: 12 });
  });

  test('execution deadline wins terminalization against late completion', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const runtime = createDeterministicApplicationJobRuntime();
    const job = createApplicationJobBinding({
      id: 'numbers.deadline.v1',
      contract: { input: Input, output: Output },
      options: { timeout: '1s' },
      handler: async (input) => {
        await held;
        return { doubled: input.value * 2 };
      },
    }, runtime);
    const run = await job.start({ value: 7 });
    await expect(run.outcome()).resolves.toMatchObject({ status: 'timedOut' });
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(run.outcome()).resolves.toMatchObject({ status: 'timedOut' });
  });

  test('expires result and progress payloads without erasing terminal identity', async () => {
    let milliseconds = Date.parse('2027-01-01T00:00:00.000Z');
    const runtime = createDeterministicApplicationJobRuntime({
      now: () => new Date(milliseconds),
      resultRetentionSeconds: 60,
      progressRetentionSeconds: 30,
    });
    const binding = createApplicationJobBinding({
      id: 'retention.test.v1',
      contract: { input: Input, output: Output, progress: Progress },
      options: {},
      handler: async (input, execution) => {
        await execution.progress({ completed: 1 });
        return { doubled: input.value * 2 };
      },
    }, runtime);
    const run = await binding.start({ value: 3 });
    await expect(run.result()).resolves.toEqual({ doubled: 6 });
    expect((await run.progress())?.value).toEqual({ completed: 1 });

    milliseconds += 31_000;
    await expect(run.progress()).rejects.toBeInstanceOf(ApplicationJobProgressExpiredError);
    expect((await run.outcome()).status).toBe('succeeded');

    milliseconds += 30_000;
    await expect(run.result()).rejects.toMatchObject({
      code: 'JOB_RESULT_EXPIRED',
      run: run.reference,
    } satisfies Partial<ApplicationJobResultExpiredError>);
    await expect(binding.attach(run.reference)).resolves.toMatchObject({ reference: run.reference });
  });
});
