// typecast-file-boundary: AWS ECS responses are narrowed through the exact
// framework task identity before they enter provider-neutral Job receipts.
import { createHash } from 'node:crypto';
import type {
  ApplicationJobReference,
  ApplicationJobRuntime,
} from '@applik8s/applik8s/job';
import { createDurableApplicationJobRuntime } from '@applik8s/applik8s/job-runtime-durable';
import type {
  ApplicationJobStore,
  ApplicationJobStoredRun,
} from '@applik8s/applik8s/job-store';
import {
  DescribeTasksCommand,
  ECSClient,
  ListTasksCommand,
  RunTaskCommand,
  StopTaskCommand,
  type ECSClientConfig,
  type Task,
} from '@aws-sdk/client-ecs';

export const awsApplicationJobDispatchProtocol = 'applik8s.aws-job-dispatch/v1alpha1' as const;

const managedByTag = 'applik8s-job-runtime';

export interface AwsApplicationJobDispatcherOptions {
  readonly applicationId: string;
  readonly deploymentId: string;
  readonly cluster: string;
  readonly taskDefinition: string;
  readonly containerName: string;
  readonly subnets: readonly string[];
  readonly securityGroups?: readonly string[];
  readonly assignPublicIp?: 'ENABLED' | 'DISABLED';
  readonly platformVersion?: string;
  readonly region?: string;
  readonly endpoint?: string;
  /** Test/provider seam; normal callers receive an SDK-backed client. */
  readonly client?: Pick<ECSClient, 'send'>;
}

export interface AwsApplicationJobDispatchReceipt {
  readonly protocol: typeof awsApplicationJobDispatchProtocol;
  readonly run: ApplicationJobReference;
  readonly state: 'created' | 'existing';
  readonly task: {
    readonly cluster: string;
    readonly taskArn: string;
    readonly startedBy: string;
    readonly group: string;
  };
}

export interface AwsApplicationJobCancellationReceipt {
  readonly protocol: typeof awsApplicationJobDispatchProtocol;
  readonly run: ApplicationJobReference;
  readonly state: 'absent' | 'stopRequested';
  readonly taskArn?: string;
}

export interface AwsApplicationJobObservation {
  readonly run: ApplicationJobReference;
  readonly taskArn: string;
  readonly phase: 'pending' | 'running' | 'succeeded' | 'failed' | 'stopping';
  readonly lastStatus: string;
  readonly stoppedReason?: string;
}

export interface AwsApplicationJobDispatcher {
  dispatch(run: ApplicationJobStoredRun): Promise<AwsApplicationJobDispatchReceipt>;
  cancel(run: ApplicationJobStoredRun): Promise<AwsApplicationJobCancellationReceipt>;
  observe(run: ApplicationJobStoredRun): Promise<AwsApplicationJobObservation | undefined>;
}

export interface AwsApplicationJobRuntimeOptions extends AwsApplicationJobDispatcherOptions {
  /** Durable provider-neutral authority supplied by the composition root. */
  readonly store: ApplicationJobStore;
  readonly dispatcher?: AwsApplicationJobDispatcher;
  readonly workerRunId?: string;
  readonly workerId?: string;
  readonly leaseSeconds?: number;
  readonly pollIntervalMs?: number;
  readonly resultRetentionSeconds?: number;
  readonly progressRetentionSeconds?: number;
}

export interface AwsApplicationJobRuntime extends ApplicationJobRuntime {
  close(): Promise<void>;
}

export interface AwsApplicationJobTaskIdentity {
  readonly cluster: string;
  readonly taskArn: string;
  readonly taskDefinition: string;
}

export class AwsApplicationJobDispatchError extends Error {
  readonly code = 'JOB_AWS_DISPATCH_FAILED' as const;
  constructor(
    message: string,
    readonly run: ApplicationJobReference,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AwsApplicationJobDispatchError';
  }
}

/** Resolves the exact task-definition revision of the current ECS task. */
export async function resolveAwsApplicationJobTaskIdentity(options: {
  readonly metadataUri?: string;
  readonly fetch?: (input: string, init?: RequestInit) => Promise<Response>;
} = {}): Promise<AwsApplicationJobTaskIdentity> {
  const metadataUri = required(
    options.metadataUri ?? process.env.ECS_CONTAINER_METADATA_URI_V4,
    'ECS container metadata URI',
  );
  const response = await (options.fetch ?? globalThis.fetch)(`${metadataUri.replace(/\/$/u, '')}/task`, {
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`ECS task metadata request failed with HTTP ${response.status}.`);
  const value: unknown = await response.json();
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('ECS task metadata returned an invalid document.');
  }
  const cluster = required(stringField(value, 'Cluster'), 'ECS task metadata cluster');
  const taskArn = required(stringField(value, 'TaskARN'), 'ECS task metadata task ARN');
  const family = required(stringField(value, 'Family'), 'ECS task metadata family');
  const revision = required(stringField(value, 'Revision'), 'ECS task metadata revision');
  if (!/^\d+$/u.test(revision)) throw new TypeError('ECS task metadata revision must be numeric.');
  return { cluster, taskArn, taskDefinition: `${family}:${revision}` };
}

/** Creates the controller or exact-run worker over one PostgreSQL authority. */
export async function createAwsApplicationJobRuntime(
  options: AwsApplicationJobRuntimeOptions,
): Promise<AwsApplicationJobRuntime> {
  const store = options.store;
  const workerMode = options.workerRunId !== undefined;
  const dispatcher = workerMode
    ? options.dispatcher
    : options.dispatcher ?? createAwsApplicationJobDispatcher(options);
  const durable = createDurableApplicationJobRuntime({
    store,
    application: options.applicationId,
    deployment: options.deploymentId,
    executeWorkers: workerMode,
    ...(workerMode ? { claimRunId: required(options.workerRunId, 'AWS Job worker run ID') } : {}),
    ...(options.workerId ? { workerId: options.workerId } : {}),
    ...(options.leaseSeconds ? { leaseSeconds: options.leaseSeconds } : {}),
    ...(options.pollIntervalMs ? { pollIntervalMs: options.pollIntervalMs } : {}),
    ...(options.resultRetentionSeconds ? { resultRetentionSeconds: options.resultRetentionSeconds } : {}),
    ...(options.progressRetentionSeconds ? { progressRetentionSeconds: options.progressRetentionSeconds } : {}),
    ...(!workerMode ? {
      dispatch: async (run) => { await requiredDispatcher(dispatcher).dispatch(run); },
      cancelDispatch: async (run) => { await requiredDispatcher(dispatcher).cancel(run); },
    } : {}),
  });
  return {
    ...durable,
    async close() {
      await durable.close();
    },
  };
}

/**
 * Converges one finite logical run onto one identity-tagged ECS task. The
 * durable Job store, not ECS, owns attempts and terminal result uniqueness.
 */
export function createAwsApplicationJobDispatcher(
  options: AwsApplicationJobDispatcherOptions,
): AwsApplicationJobDispatcher {
  validateOptions(options);
  const client = options.client ?? new ECSClient(ecsClientConfiguration(options));

  const taskFor = async (run: ApplicationJobStoredRun): Promise<Task | undefined> => {
    const startedBy = awsApplicationJobStartedBy(options, run.reference.runId);
    const taskArns = new Set<string>();
    for (const desiredStatus of ['RUNNING', 'PENDING', 'STOPPED'] as const) {
      const response = await client.send(new ListTasksCommand({
        cluster: options.cluster,
        startedBy,
        desiredStatus,
      }));
      for (const arn of response.taskArns ?? []) if (arn) taskArns.add(arn);
    }
    if (taskArns.size === 0) return undefined;
    const described = await client.send(new DescribeTasksCommand({
      cluster: options.cluster,
      tasks: [...taskArns],
      include: ['TAGS'],
    }));
    if ((described.failures?.length ?? 0) > 0) {
      throw new AwsApplicationJobDispatchError(
        `AWS ECS could not describe finite Job run ${run.reference.runId}.`,
        run.reference,
      );
    }
    const describedTasks = described.tasks ?? [];
    const owned = describedTasks.filter((task) => taskIdentity(task).runId === run.reference.runId);
    if (owned.length !== describedTasks.length) {
      throw new AwsApplicationJobDispatchError(
        `AWS ECS startedBy identity for run ${run.reference.runId} includes a task without matching framework ownership tags.`,
        run.reference,
      );
    }
    const active = owned.filter((task) => task.lastStatus !== 'STOPPED');
    if (active.length > 1) {
      throw new AwsApplicationJobDispatchError(
        `AWS ECS has ${active.length} active tasks for finite Job run ${run.reference.runId}; refusing ambiguous ownership.`,
        run.reference,
      );
    }
    if (active[0]) return active[0];
    return [...owned].sort((left, right) =>
      (right.createdAt?.getTime() ?? 0) - (left.createdAt?.getTime() ?? 0))[0];
  };

  return {
    async dispatch(run) {
      const existing = await taskFor(run);
      if (existing && existing.lastStatus !== 'STOPPED') {
        return dispatchReceipt(options, run, existing, 'existing');
      }
      if (existing && taskIdentity(existing).attempt >= run.attempt) {
        return dispatchReceipt(options, run, existing, 'existing');
      }
      const startedBy = awsApplicationJobStartedBy(options, run.reference.runId);
      const group = awsApplicationJobGroup(options, run.reference.runId);
      const response = await client.send(new RunTaskCommand({
        cluster: options.cluster,
        taskDefinition: options.taskDefinition,
        count: 1,
        launchType: 'FARGATE',
        ...(options.platformVersion ? { platformVersion: options.platformVersion } : {}),
        startedBy,
        group,
        clientToken: awsApplicationJobClientToken(options, run),
        enableECSManagedTags: true,
        networkConfiguration: {
          awsvpcConfiguration: {
            subnets: [...options.subnets],
            ...(options.securityGroups ? { securityGroups: [...options.securityGroups] } : {}),
            assignPublicIp: options.assignPublicIp ?? 'DISABLED',
          },
        },
        overrides: {
          containerOverrides: [{
            name: options.containerName,
            environment: [
              { name: 'APPLIK8S_JOB_RUN_ID', value: run.reference.runId },
              { name: 'APPLIK8S_JOB_ID', value: run.reference.job },
            ],
          }],
        },
        tags: [
          { key: 'applik8s.dev/managed-by', value: managedByTag },
          { key: 'applik8s.dev/application', value: options.applicationId },
          { key: 'applik8s.dev/deployment', value: options.deploymentId },
          { key: 'applik8s.dev/job', value: run.reference.job },
          { key: 'applik8s.dev/run-id', value: run.reference.runId },
          { key: 'applik8s.dev/attempt', value: String(run.attempt) },
        ],
      }));
      if ((response.failures?.length ?? 0) > 0 || response.tasks?.length !== 1) {
        throw new AwsApplicationJobDispatchError(
          `AWS ECS rejected finite Job run ${run.reference.runId}.`,
          run.reference,
        );
      }
      return dispatchReceipt(options, run, response.tasks[0]!, 'created');
    },
    async cancel(run) {
      const task = await taskFor(run);
      if (!task || task.lastStatus === 'STOPPED') {
        return {
          protocol: awsApplicationJobDispatchProtocol,
          run: run.reference,
          state: 'absent',
          ...(task?.taskArn ? { taskArn: task.taskArn } : {}),
        };
      }
      const taskArn = required(task.taskArn, 'AWS Job task ARN');
      await client.send(new StopTaskCommand({
        cluster: options.cluster,
        task: taskArn,
        reason: `Applik8s finite Job ${run.reference.runId} cancellation requested`,
      }));
      return { protocol: awsApplicationJobDispatchProtocol, run: run.reference, state: 'stopRequested', taskArn };
    },
    async observe(run) {
      const task = await taskFor(run);
      if (!task) return undefined;
      const taskArn = required(task.taskArn, 'AWS Job task ARN');
      const lastStatus = task.lastStatus ?? 'UNKNOWN';
      const exitCodes = (task.containers ?? []).flatMap((container) =>
        container.exitCode === undefined ? [] : [container.exitCode]);
      const phase = lastStatus === 'STOPPED'
        ? exitCodes.length > 0 && exitCodes.every((code) => code === 0) ? 'succeeded' : 'failed'
        : lastStatus === 'RUNNING'
          ? 'running'
          : lastStatus === 'DEPROVISIONING' || lastStatus === 'STOPPING'
            ? 'stopping'
            : 'pending';
      return {
        run: run.reference,
        taskArn,
        phase,
        lastStatus,
        ...(task.stoppedReason ? { stoppedReason: task.stoppedReason } : {}),
      };
    },
  };
}

export function awsApplicationJobStartedBy(
  options: Pick<AwsApplicationJobDispatcherOptions, 'applicationId' | 'deploymentId'>,
  runId: string,
): string {
  return `applik8s-job-${shortDigest(`${options.applicationId}\0${options.deploymentId}\0${runId}`, 22)}`;
}

function awsApplicationJobGroup(
  options: Pick<AwsApplicationJobDispatcherOptions, 'applicationId' | 'deploymentId'>,
  runId: string,
): string {
  return `applik8s-job/${shortDigest(`${options.applicationId}\0${options.deploymentId}\0${runId}`, 40)}`;
}

function awsApplicationJobClientToken(
  options: Pick<AwsApplicationJobDispatcherOptions, 'applicationId' | 'deploymentId'>,
  run: ApplicationJobStoredRun,
): string {
  return shortDigest(`${options.applicationId}\0${options.deploymentId}\0${run.reference.runId}\0${run.attempt}`, 64);
}

function dispatchReceipt(
  options: AwsApplicationJobDispatcherOptions,
  run: ApplicationJobStoredRun,
  task: Task,
  state: 'created' | 'existing',
): AwsApplicationJobDispatchReceipt {
  const taskArn = required(task.taskArn, 'AWS Job task ARN');
  const startedBy = awsApplicationJobStartedBy(options, run.reference.runId);
  const group = awsApplicationJobGroup(options, run.reference.runId);
  if (task.startedBy && task.startedBy !== startedBy) {
    throw new AwsApplicationJobDispatchError(`AWS ECS task ${taskArn} has unexpected startedBy identity.`, run.reference);
  }
  if (task.group && task.group !== group) {
    throw new AwsApplicationJobDispatchError(`AWS ECS task ${taskArn} has unexpected group identity.`, run.reference);
  }
  return {
    protocol: awsApplicationJobDispatchProtocol,
    run: run.reference,
    state,
    task: { cluster: options.cluster, taskArn, startedBy, group },
  };
}

function taskIdentity(task: Task): { readonly runId?: string; readonly attempt: number } {
  const tags = new Map((task.tags ?? []).map(({ key, value }) => [key, value]));
  if (tags.get('applik8s.dev/managed-by') !== managedByTag) return { attempt: -1 };
  const attempt = Number(tags.get('applik8s.dev/attempt'));
  const runId = tags.get('applik8s.dev/run-id');
  return {
    ...(runId ? { runId } : {}),
    attempt: Number.isSafeInteger(attempt) && attempt >= 0 ? attempt : -1,
  };
}

function ecsClientConfiguration(options: AwsApplicationJobDispatcherOptions): ECSClientConfig {
  return {
    ...(options.region ? { region: options.region } : {}),
    ...(options.endpoint ? { endpoint: options.endpoint } : {}),
  };
}

function validateOptions(options: AwsApplicationJobDispatcherOptions): void {
  required(options.applicationId, 'AWS Job applicationId');
  required(options.deploymentId, 'AWS Job deploymentId');
  required(options.cluster, 'AWS Job ECS cluster');
  required(options.taskDefinition, 'AWS Job task definition');
  required(options.containerName, 'AWS Job container name');
  if (options.subnets.length === 0 || options.subnets.some((value) => !value.trim())) {
    throw new TypeError('AWS Job dispatcher requires at least one non-empty subnet.');
  }
  if (options.securityGroups?.some((value) => !value.trim())) {
    throw new TypeError('AWS Job dispatcher security groups must not be empty.');
  }
}

function required(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new TypeError(`${label} is required.`);
  return normalized;
}

function requiredDispatcher(value: AwsApplicationJobDispatcher | undefined): AwsApplicationJobDispatcher {
  if (!value) throw new Error('AWS Job controller dispatcher is unavailable.');
  return value;
}

function stringField(value: object, field: string): string | undefined {
  const candidate = Reflect.get(value, field);
  return typeof candidate === 'string' ? candidate : undefined;
}

function shortDigest(value: string, length: number): string {
  return createHash('sha256').update(value).digest('hex').slice(0, length);
}
