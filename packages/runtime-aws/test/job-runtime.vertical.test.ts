import { createApplicationJobBinding } from '@applik8s/applik8s/job';
import {
  createDeterministicApplicationJobStore,
  defaultApplicationJobLifecycleFactContracts,
  type ApplicationJobStoredRun,
} from '@applik8s/applik8s/job-store';
import {
  DescribeTasksCommand,
  ListTasksCommand,
  RunTaskCommand,
  StopTaskCommand,
  type Task,
} from '@aws-sdk/client-ecs';
import { type } from 'arktype';
import { describe, expect, test } from 'vitest';
import {
  AwsApplicationJobDispatchError,
  awsApplicationJobStartedBy,
  createAwsApplicationJobDispatcher,
  createAwsApplicationJobRuntime,
  resolveAwsApplicationJobTaskIdentity,
} from '../src/job-runtime.js';

function storedRun(overrides: Partial<ApplicationJobStoredRun> = {}): ApplicationJobStoredRun {
  const admittedAt = '2026-08-31T00:00:00.000Z';
  return {
    reference: {
      protocol: 'applik8s.jobRuntime/v1alpha1',
      job: 'reports.export.v1',
      runId: 'run-1',
      admittedAt,
    },
    input: { report: 'monthly' },
    inputDigest: `sha256:${'b'.repeat(64)}`,
    admission: {
      apiVersion: 'applik8s.admission/v1',
      principal: {
        id: 'principal:test:aws-job',
        identity: { id: 'identity:test:aws-job', kind: 'service', issuer: 'applik8s://test', subject: 'aws-job' },
        kind: 'service',
        authenticationMethod: 'test',
        audience: ['applik8s://jobs/reports.export.v1/operations/run'],
        trustedContextDigest: 'sha256:aws-job',
        catalogRevision: 'catalog-v1',
        authorityRevision: 'authority-v1',
        admittedAt,
        expiresAt: '2026-08-31T01:00:00.000Z',
      },
      authorityRevision: 'authority-v1',
      trustedContext: { values: {}, digest: 'sha256:aws-job' },
      operation: { id: 'applik8s://jobs/reports.export.v1/operations/run', transport: 'framework' },
      correlationId: 'aws-job',
      deadline: '2026-08-31T01:00:00.000Z',
    },
    events: defaultApplicationJobLifecycleFactContracts('reports.export.v1'),
    phase: 'queued',
    attempt: 0,
    maximumAttempts: 2,
    admittedAt,
    availableAt: admittedAt,
    deadline: '2026-08-31T00:30:00.000Z',
    ...overrides,
  };
}

function fakeEcs() {
  const tasks: Task[] = [];
  const commands: unknown[] = [];
  const client = {
    async send(command: unknown): Promise<Record<string, unknown>> {
      commands.push(command);
      if (command instanceof ListTasksCommand) {
        const desired = command.input.desiredStatus;
        const startedBy = command.input.startedBy;
        return {
          taskArns: tasks
            .filter((task) => task.startedBy === startedBy && task.lastStatus === desired)
            .flatMap((task) => task.taskArn ? [task.taskArn] : []),
        };
      }
      if (command instanceof DescribeTasksCommand) {
        const arns = new Set(command.input.tasks ?? []);
        return { tasks: tasks.filter((task) => task.taskArn && arns.has(task.taskArn)) };
      }
      if (command instanceof RunTaskCommand) {
        const task: Task = {
          taskArn: `arn:aws:ecs:us-east-1:123456789012:task/jobs/${tasks.length + 1}`,
          clusterArn: command.input.cluster,
          taskDefinitionArn: command.input.taskDefinition,
          startedBy: command.input.startedBy,
          group: command.input.group,
          lastStatus: 'RUNNING',
          createdAt: new Date(Date.UTC(2026, 7, 31, 0, 0, tasks.length)),
          tags: command.input.tags,
          containers: [{ name: 'worker', lastStatus: 'RUNNING' }],
        };
        tasks.push(task);
        return { tasks: [task] };
      }
      if (command instanceof StopTaskCommand) {
        const task = tasks.find(({ taskArn }) => taskArn === command.input.task);
        if (task) {
          task.lastStatus = 'STOPPED';
          task.stoppedReason = command.input.reason;
          task.containers = [{ name: 'worker', lastStatus: 'STOPPED', exitCode: 137 }];
        }
        return { task };
      }
      throw new Error(`Unexpected AWS command ${command?.constructor?.name}.`);
    },
  };
  return { client, tasks, commands };
}

const options = {
  applicationId: 'reports',
  deploymentId: 'production',
  cluster: 'reports-cluster',
  taskDefinition: 'reports-jobs:7',
  containerName: 'worker',
  subnets: ['subnet-private-a', 'subnet-private-b'],
  securityGroups: ['sg-jobs'],
} as const;

describe('AWS finite Job dispatcher', () => {
  test('resolves the exact running task-definition revision from ECS metadata', async () => {
    await expect(resolveAwsApplicationJobTaskIdentity({
      metadataUri: 'http://metadata/v4/container',
      fetch: async (input) => {
        expect(String(input)).toBe('http://metadata/v4/container/task');
        return Response.json({
          Cluster: 'arn:aws:ecs:us-east-1:123456789012:cluster/application',
          TaskARN: 'arn:aws:ecs:us-east-1:123456789012:task/application/controller',
          Family: 'application-jobs',
          Revision: '17',
        });
      },
    })).resolves.toEqual({
      cluster: 'arn:aws:ecs:us-east-1:123456789012:cluster/application',
      taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/application/controller',
      taskDefinition: 'application-jobs:17',
    });
  });

  test('creates and adopts one identity-tagged Fargate task', async () => {
    const fake = fakeEcs();
    const run = storedRun();
    const dispatcher = createAwsApplicationJobDispatcher({ ...options, client: fake.client as never });
    const created = await dispatcher.dispatch(run);
    expect(created).toMatchObject({ state: 'created', task: { taskArn: expect.stringContaining(':task/jobs/1') } });
    await expect(dispatcher.dispatch(run)).resolves.toMatchObject({
      state: 'existing',
      task: { taskArn: created.task.taskArn },
    });
    const submitted = fake.commands.find((command): command is RunTaskCommand => command instanceof RunTaskCommand);
    expect(submitted?.input).toMatchObject({
      launchType: 'FARGATE',
      startedBy: awsApplicationJobStartedBy(options, run.reference.runId),
      networkConfiguration: { awsvpcConfiguration: { assignPublicIp: 'DISABLED' } },
      overrides: { containerOverrides: [{ name: 'worker', environment: expect.arrayContaining([
        { name: 'APPLIK8S_JOB_RUN_ID', value: 'run-1' },
      ]) }] },
    });
    expect(submitted?.input.overrides?.containerOverrides?.[0]?.command).toBeUndefined();
  });

  test('normalizes running, successful, failed, and cancellation state', async () => {
    const fake = fakeEcs();
    const run = storedRun();
    const dispatcher = createAwsApplicationJobDispatcher({ ...options, client: fake.client as never });
    await dispatcher.dispatch(run);
    await expect(dispatcher.observe(run)).resolves.toMatchObject({ phase: 'running', lastStatus: 'RUNNING' });
    fake.tasks[0]!.lastStatus = 'STOPPED';
    fake.tasks[0]!.containers = [{ name: 'worker', exitCode: 0 }];
    await expect(dispatcher.observe(run)).resolves.toMatchObject({ phase: 'succeeded', lastStatus: 'STOPPED' });
    fake.tasks[0]!.lastStatus = 'RUNNING';
    await expect(dispatcher.cancel(run)).resolves.toMatchObject({ state: 'stopRequested', taskArn: fake.tasks[0]!.taskArn });
    await expect(dispatcher.observe(run)).resolves.toMatchObject({ phase: 'failed', lastStatus: 'STOPPED' });
    await expect(dispatcher.cancel(run)).resolves.toMatchObject({ state: 'absent' });
  });

  test('retains stopped attempt history while advancing one durable retry', async () => {
    const fake = fakeEcs();
    const dispatcher = createAwsApplicationJobDispatcher({ ...options, client: fake.client as never });
    const first = storedRun({ attempt: 0 });
    const firstReceipt = await dispatcher.dispatch(first);
    fake.tasks[0]!.lastStatus = 'STOPPED';
    fake.tasks[0]!.containers = [{ name: 'worker', exitCode: 137 }];
    await expect(dispatcher.dispatch(first)).resolves.toMatchObject({
      state: 'existing',
      task: { taskArn: firstReceipt.task.taskArn },
    });
    const retry = storedRun({ attempt: 1, phase: 'queued' });
    const retried = await dispatcher.dispatch(retry);
    expect(retried).toMatchObject({ state: 'created', task: { taskArn: expect.stringContaining(':task/jobs/2') } });
    await expect(dispatcher.observe(retry)).resolves.toMatchObject({ phase: 'running', taskArn: retried.task.taskArn });
    expect(fake.tasks).toHaveLength(2);
  });

  test('fails closed for a startedBy collision without framework ownership tags', async () => {
    const fake = fakeEcs();
    const run = storedRun();
    fake.tasks.push({
      taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/jobs/foreign',
      startedBy: awsApplicationJobStartedBy(options, run.reference.runId),
      lastStatus: 'RUNNING',
      tags: [{ key: 'applik8s.dev/run-id', value: run.reference.runId }],
    });
    const dispatcher = createAwsApplicationJobDispatcher({ ...options, client: fake.client as never });
    await expect(dispatcher.dispatch(run)).rejects.toBeInstanceOf(AwsApplicationJobDispatchError);
  });

  test('assembles controller and exact-task worker over one durable authority', async () => {
    const store = createDeterministicApplicationJobStore();
    const dispatched: string[] = [];
    const dispatcher = {
      async dispatch(run: ApplicationJobStoredRun) {
        dispatched.push(run.reference.runId);
        return {
          protocol: 'applik8s.aws-job-dispatch/v1alpha1' as const,
          run: run.reference,
          state: 'created' as const,
          task: { cluster: 'cluster', taskArn: 'task', startedBy: 'started', group: 'group' },
        };
      },
      async cancel(run: ApplicationJobStoredRun) {
        return { protocol: 'applik8s.aws-job-dispatch/v1alpha1' as const, run: run.reference, state: 'absent' as const };
      },
      async observe() { return undefined; },
    };
    const definition = {
      id: 'reports.aws.v1',
      contract: { input: type({ value: 'number' }), output: type({ doubled: 'number' }) },
      options: {},
      handler: ({ value }: { readonly value: number }) => ({ doubled: value * 2 }),
    };
    const controller = await createAwsApplicationJobRuntime({ ...options, store, dispatcher });
    const job = createApplicationJobBinding(definition, controller);
    const run = await job.start({ value: 9 });
    expect(dispatched).toEqual([run.reference.runId]);
    const worker = await createAwsApplicationJobRuntime({
      ...options,
      store,
      dispatcher,
      workerRunId: run.reference.runId,
      workerId: 'ecs-task-1',
      pollIntervalMs: 5,
    });
    createApplicationJobBinding(definition, worker);
    await expect(run.result()).resolves.toEqual({ doubled: 18 });
    await controller.close();
    await worker.close();
  });
});
