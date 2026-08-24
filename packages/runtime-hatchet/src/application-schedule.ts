// typecast-file-boundary: Hatchet SDK records are narrowed at this provider adapter before reaching the portable schedule contract.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  type ApplicationHatchetSchedulerProvider,
  type ApplicationScheduleAdmissionRunner,
  type ApplicationScheduleConvergenceResult,
  type ApplicationScheduleDefinitionContract,
  type ApplicationScheduleHandle,
  type ApplicationScheduleHandler,
  type ApplicationScheduleInstance,
  type ApplicationScheduleManagementReceipt,
  type ApplicationScheduleOccurrenceReceipt,
  type ApplicationScheduleRuntime,
  type ApplicationScheduleStateAuthority,
  applicationScheduleImmediateInvocationAdmission,
  applicationScheduleOccurrenceId,
  applicationScheduleProjectedDesiredState,
} from '@applik8s/applik8s';
import type { ApplicationAdmissionInvocationContextV1 } from '@applik8s/core';
import {
  canonicalJsonCompatibleV1Policy,
  canonicalJsonV1String,
  exactFiveFieldCronForInterval,
} from '@applik8s/core';
import { executePostgresApplicationScheduleAdmission } from '@applik8s/runtime-postgres/schedule-occurrence';
import { createPostgresApplicationScheduleStateAuthority } from '@applik8s/runtime-postgres/schedule-state';
import { HatchetClient } from '@hatchet-dev/typescript-sdk/v1/index.js';
import { reconcileHatchetWorkflowSchedule } from './workflow-runtime-hatchet-schedule.js';

const scheduleIdentityKey = 'applik8s.schedule.identity';
const scheduleRevisionKey = 'applik8s.schedule.revision';
const scheduleFingerprintKey = 'applik8s.schedule.fingerprint';
const maximumProviderRows = 32;

interface HatchetScheduleRecord {
  readonly metadata: { readonly id: string };
  readonly triggerAt: string;
  readonly additionalMetadata?: Readonly<Record<string, unknown>>;
}

interface HatchetDeliveryContext {
  workflowRunId(): string;
  retryCount(): number;
  readonly abortController?: AbortController;
}

interface HatchetDeliveryDeclaration {
  readonly definition?: unknown;
}

interface HatchetDeliveryWorker {
  registerWorkflows(workflows: HatchetDeliveryDeclaration[]): Promise<void>;
  start(): Promise<void>;
  waitUntilReady(timeoutMs?: number): Promise<void>;
  stop(): Promise<void>;
}

export interface HatchetApplicationScheduleClient {
  readonly cron: Parameters<typeof reconcileHatchetWorkflowSchedule>[0]['cron'];
  readonly scheduled: {
    list(query: {
      readonly workflow?: string;
      readonly limit?: number;
      readonly offset?: number;
      readonly additionalMetadata?: readonly string[];
    }): Promise<{ readonly rows?: readonly HatchetScheduleRecord[] }>;
    create(workflow: string, input: {
      readonly triggerAt: Date;
      readonly input?: object;
      readonly additionalMetadata?: Readonly<Record<string, string>>;
    }): Promise<HatchetScheduleRecord>;
    delete(schedule: string | HatchetScheduleRecord): Promise<void>;
  };
  readonly runs: {
    get(runId: string): Promise<{
      readonly run: {
        readonly createdAt?: string;
      };
    }>;
  };
  task(options: {
    readonly name: string;
    readonly retries: number;
    readonly executionTimeout: string;
    readonly scheduleTimeout: string;
    readonly fn: (
      input: HatchetApplicationScheduleDeliveryInput,
      context: HatchetDeliveryContext,
    ) => Promise<ApplicationScheduleOccurrenceReceipt>;
  }): HatchetDeliveryDeclaration;
  worker(name: string, options: {
    readonly slots: number;
    readonly handleKill: boolean;
  }): Promise<HatchetDeliveryWorker>;
}

export interface HatchetApplicationScheduleDeliveryInput {
  readonly schemaVersion: 'applik8s.hatchetScheduleDelivery/v1alpha1';
  readonly definitionId: string;
  readonly instanceId: string;
  readonly input: object;
  /** Exact logical instant for a one-time schedule. Recurring runs derive the minute from Hatchet's persisted run creation time. */
  readonly scheduledAt?: string;
}

export interface HatchetApplicationScheduleRuntimeOptions {
  readonly applicationId: string;
  readonly environmentId: string;
  readonly schedulerNodeId: string;
  readonly databaseUrl: string;
  readonly provider?: ApplicationHatchetSchedulerProvider;
  /** Explicit process-local credential; generated Kubernetes hosts use tokenFile. */
  readonly token?: string;
  readonly tokenFile?: string;
  readonly workerName?: string;
  readonly taskSlots?: number;
  readonly readinessTimeoutMs?: number;
  readonly admissionRunner?: ApplicationScheduleAdmissionRunner;
  readonly stateAuthority?: ApplicationScheduleStateAuthority;
  /** Provider-adapter test seam; production uses the canonical PostgreSQL occurrence authority. */
  readonly occurrenceExecutor?: typeof executePostgresApplicationScheduleAdmission;
}

export interface HatchetApplicationScheduleRuntime extends ApplicationScheduleRuntime {
  registerFixed(
    handle: ApplicationScheduleHandle<object, unknown>,
  ): Promise<ApplicationScheduleConvergenceResult>;
  recover(): Promise<readonly ApplicationScheduleConvergenceResult[]>;
  close(): Promise<void>;
}

export async function createHatchetApplicationScheduleRuntime(
  options: HatchetApplicationScheduleRuntimeOptions,
  handles: readonly ApplicationScheduleHandle<object, unknown>[],
): Promise<HatchetApplicationScheduleRuntime> {
  const provider = options.provider?.workflowEngine ?? { kind: 'hatchet' as const };
  const tokenFile = options.tokenFile ?? process.env.APPLIK8S_HATCHET_SCHEDULER_TOKEN_FILE;
  const token = options.token ?? (tokenFile
    ? readFileSync(tokenFile, 'utf8').trim()
    : process.env.HATCHET_CLIENT_TOKEN);
  const client = HatchetClient.init({
    ...(token ? { token } : {}),
    ...(provider.hostPort ? { host_port: provider.hostPort } : {}),
    ...(provider.apiUrl ? { api_url: provider.apiUrl } : {}),
    ...(provider.tls !== true
      ? { tls_config: { tls_strategy: 'none' as const } }
      : {}),
  });
  return createHatchetApplicationScheduleRuntimeFromClient(
    // The public SDK implements this deliberately narrow provider boundary.
    client as unknown as HatchetApplicationScheduleClient,
    options,
    handles,
  );
}

/** Provider test seam; application code selects Hatchet through Scheduler bindings. */
export async function createHatchetApplicationScheduleRuntimeFromClient(
  client: HatchetApplicationScheduleClient,
  options: HatchetApplicationScheduleRuntimeOptions,
  handles: readonly ApplicationScheduleHandle<object, unknown>[],
): Promise<HatchetApplicationScheduleRuntime> {
  required(options.applicationId, 'Hatchet Scheduler applicationId');
  required(options.environmentId, 'Hatchet Scheduler environmentId');
  required(options.schedulerNodeId, 'Hatchet Scheduler provider identity');
  required(options.databaseUrl, 'Hatchet Scheduler PostgreSQL state authority');
  const byDefinition = new Map(handles.map((handle) => [handle.definition.id, handle]));
  if (byDefinition.size !== handles.length) {
    throw new Error(`Hatchet Scheduler ${options.schedulerNodeId} contains duplicate schedule definitions.`);
  }
  const stateAuthority = options.stateAuthority
    ?? createPostgresApplicationScheduleStateAuthority({
      databaseUrl: options.databaseUrl,
      applicationId: options.applicationId,
      environmentId: options.environmentId,
    });
  const ownsStateAuthority = !options.stateAuthority;
  const workerName = options.workerName
    ?? boundedHatchetName(`applik8s-scheduler-${options.applicationId}-${shortHash(options.schedulerNodeId)}`);
  const declarations = handles.map((handle) => client.task({
    name: deliveryWorkflowName(options, handle.definition.id),
    retries: Math.max(0, handle.definition.retry.maxAttempts - 1),
    executionTimeout: `${handle.definition.retry.maximumAgeSeconds}s`,
    scheduleTimeout: `${handle.definition.retry.maximumAgeSeconds}s`,
    fn: async (input, context) => {
      if (input.schemaVersion !== 'applik8s.hatchetScheduleDelivery/v1alpha1'
        || input.definitionId !== handle.definition.id) {
        throw new Error(`Hatchet Scheduler received invalid delivery input for ${handle.definition.id}.`);
      }
      const run = await client.runs.get(context.workflowRunId());
      const providerCreatedAt = requiredTimestamp(
        run.run.createdAt,
        `Hatchet Scheduler run ${context.workflowRunId()} creation time`,
      );
      const scheduledAt = input.scheduledAt
        ? requiredTimestamp(input.scheduledAt, `Hatchet Scheduler ${input.definitionId} scheduled time`)
        : recurringScheduledAt(providerCreatedAt);
      const receipt = await (options.occurrenceExecutor
        ?? executePostgresApplicationScheduleAdmission)({
        databaseUrl: options.databaseUrl,
        handle,
        admission: {
          schemaVersion: 'applik8s.scheduleAdmission/v1alpha1',
          applicationId: options.applicationId,
          environmentId: options.environmentId,
          definitionId: input.definitionId,
          instanceId: input.instanceId,
          input: input.input,
          scheduledAt,
          admittedAt: new Date().toISOString(),
          attempt: context.retryCount() + 1,
          schedulerExecutionId: context.workflowRunId(),
        },
        ...(context.abortController?.signal
          ? { signal: context.abortController.signal }
          : {}),
        ...(options.admissionRunner
          ? { admissionRunner: options.admissionRunner }
          : {}),
      });
      if (receipt.state === 'failed') {
        throw new Error(
          `Hatchet schedule ${input.definitionId}/${input.instanceId} failed: ${receipt.error?.message ?? 'unknown failure'}`,
        );
      }
      return receipt;
    },
  }));
  const worker = await client.worker(workerName, {
    slots: options.taskSlots ?? 8,
    handleKill: false,
  });
  await worker.registerWorkflows(declarations);
  const running = worker.start();
  await worker.waitUntilReady(options.readinessTimeoutMs ?? 60_000);

  const project = async (request: {
    readonly definition: ApplicationScheduleDefinitionContract<object>;
    readonly instance: ApplicationScheduleInstance<object>;
    readonly management?: ApplicationScheduleManagementReceipt;
  }): Promise<'created' | 'updated' | 'unchanged'> => {
    const workflow = deliveryWorkflowName(options, request.definition.id);
    const identity = providerScheduleIdentity(options, request.definition.id, request.instance.id);
    const input = deliveryInput(request.definition, request.instance);
    if (request.instance.at) {
      return reconcileOneTime(client, {
        workflow,
        identity,
        revision: request.instance.revision,
        enabled: request.instance.enabled !== false,
        triggerAt: new Date(request.instance.at).toISOString(),
        input,
      });
    }
    const result = await reconcileHatchetWorkflowSchedule(
      client,
      workflow,
      {
        id: identity,
        revision: request.instance.revision,
        expression: hatchetCron(request.definition, request.instance),
        input,
        enabled: request.instance.enabled !== false,
      },
    );
    return result.state === 'removed' ? 'updated' : result.state;
  };

  const runtime: HatchetApplicationScheduleRuntime = {
    async invoke<TInput extends object, TResult>(request: {
      readonly definition: ApplicationScheduleDefinitionContract<TInput>;
      readonly input: TInput;
      readonly handler: ApplicationScheduleHandler<TInput, TResult>;
      readonly callerAdmission: ApplicationAdmissionInvocationContextV1;
    }): Promise<TResult> {
      const now = new Date().toISOString();
      const occurrenceId = applicationScheduleOccurrenceId({
        applicationId: options.applicationId,
        environmentId: options.environmentId,
        definitionId: request.definition.id,
        instanceId: 'immediate',
        scheduledAt: now,
      });
      const admission = applicationScheduleImmediateInvocationAdmission({
        caller: request.callerAdmission,
        definitionId: request.definition.id,
        instanceId: 'immediate',
        occurrenceId,
        admittedAt: now,
        maximumAgeSeconds: request.definition.retry.maximumAgeSeconds,
      });
      const invoke = async () => request.handler(request.input, {
        definitionId: request.definition.id,
        instanceId: 'immediate',
        occurrenceId,
        scheduledAt: now,
        admittedAt: now,
        startedAt: now,
        attempt: 1,
        trigger: 'immediate',
        admission,
        signal: new AbortController().signal,
      });
      return options.admissionRunner
        ? options.admissionRunner.run(admission, invoke)
        : invoke();
    },
    async reconcile(request) {
      if (request.definition.configuration !== 'dynamic') {
        throw new Error(`Hatchet Scheduler cannot reconcile a dynamic instance for fixed definition ${request.definition.id}.`);
      }
      assertHatchetScheduleCompatible(
        request.definition as unknown as ApplicationScheduleDefinitionContract<object>,
        request.instance as ApplicationScheduleInstance<object>,
      );
      const canonical = await stateAuthority.reconcile(request);
      const projected = await project({
        definition: request.definition as unknown as ApplicationScheduleDefinitionContract<object>,
        instance: request.instance as ApplicationScheduleInstance<object>,
        ...(request.management ? { management: request.management } : {}),
      });
      if (!await stateAuthority.markProjected(
        request.definition.id,
        request.instance.id,
        request.instance.revision,
        'active',
      )) {
        await runtime.recover();
        throw new Error(`Schedule ${request.definition.id}:${request.instance.id} changed during Hatchet projection.`);
      }
      return { ...canonical, state: projected === 'unchanged' ? canonical.state : projected };
    },
    async remove(definitionId, instanceId, management) {
      const canonical = await stateAuthority.remove(definitionId, instanceId, management);
      const removed = await removeProviderSchedule(
        client,
        providerScheduleIdentity(options, definitionId, instanceId),
      );
      if (!await stateAuthority.markProjected(definitionId, instanceId, canonical.revision, 'removed')) {
        await runtime.recover();
        throw new Error(`Schedule ${definitionId}:${instanceId} removal changed during Hatchet projection.`);
      }
      return {
        ...canonical,
        state: removed || canonical.state === 'removed' ? 'removed' : 'unchanged',
      };
    },
    async registerFixed(handle) {
      if (handle.definition.configuration !== 'fixed') {
        throw new Error(`Schedule ${handle.definition.id} is not fixed.`);
      }
      const instance = fixedInstance(handle.definition);
      assertHatchetScheduleCompatible(handle.definition, instance);
      const canonical = await stateAuthority.reconcile({
        definition: handle.definition,
        instance,
      });
      const projected = await project({ definition: handle.definition, instance });
      if (!await stateAuthority.markProjected(
        handle.definition.id,
        instance.id,
        instance.revision,
        'active',
      )) {
        await runtime.recover();
        throw new Error(`Fixed schedule ${handle.definition.id} changed during Hatchet projection.`);
      }
      return { ...canonical, state: projected === 'unchanged' ? canonical.state : projected };
    },
    async recover() {
      const results: ApplicationScheduleConvergenceResult[] = [];
      for (const record of await stateAuthority.pending()) {
        if (record.state === 'active') {
          const desired = applicationScheduleProjectedDesiredState(record);
          const state = await project(desired);
          if (!await stateAuthority.markProjected(
            record.definitionId,
            record.instanceId,
            record.revision,
            'active',
          )) {
            throw new Error(`Schedule ${record.definitionId}:${record.instanceId} changed during Hatchet recovery.`);
          }
          results.push({
            definitionId: record.definitionId,
            instanceId: record.instanceId,
            revision: record.revision,
            state,
            ...(record.management ? { management: record.management } : {}),
          });
          continue;
        }
        const removed = await removeProviderSchedule(
          client,
          providerScheduleIdentity(options, record.definitionId, record.instanceId),
        );
        if (!await stateAuthority.markProjected(
          record.definitionId,
          record.instanceId,
          record.revision,
          'removed',
        )) {
          throw new Error(`Schedule ${record.definitionId}:${record.instanceId} changed during Hatchet recovery.`);
        }
        results.push({
          definitionId: record.definitionId,
          instanceId: record.instanceId,
          revision: record.revision,
          state: removed ? 'removed' : 'unchanged',
          ...(record.management ? { management: record.management } : {}),
        });
      }
      return results;
    },
    async close() {
      await worker.stop();
      await running.catch((error) => {
        if (error instanceof Error && /stopp?ed|abort|cancel/iu.test(error.message)) return;
        throw error;
      });
      if (ownsStateAuthority) await stateAuthority.close?.();
    },
  };
  try {
    await runtime.recover();
    for (const handle of handles) {
      if (handle.definition.configuration === 'fixed') {
        await runtime.registerFixed(handle);
      }
    }
    return runtime;
  } catch (error) {
    try {
      await runtime.close();
    } catch (closeError) {
      throw new AggregateError(
        [error, closeError],
        `Hatchet Scheduler ${options.schedulerNodeId} failed initialization and cleanup.`,
      );
    }
    throw error;
  }
}

async function reconcileOneTime(
  client: HatchetApplicationScheduleClient,
  request: {
    readonly workflow: string;
    readonly identity: string;
    readonly revision: string;
    readonly enabled: boolean;
    readonly triggerAt: string;
    readonly input: HatchetApplicationScheduleDeliveryInput;
  },
): Promise<'created' | 'updated' | 'unchanged'> {
  const rows = await listedOneTimeSchedules(client, request.workflow, request.identity);
  const fingerprint = shortHash({
    workflow: request.workflow,
    triggerAt: request.triggerAt,
    input: request.input,
    revision: request.revision,
  }, 64);
  const exact = rows.length === 1
    && rows[0]?.triggerAt === new Date(request.triggerAt).toISOString()
    && rows[0]?.additionalMetadata?.[scheduleRevisionKey] === request.revision
    && rows[0]?.additionalMetadata?.[scheduleFingerprintKey] === fingerprint;
  if (request.enabled && exact) return 'unchanged';
  await Promise.all(rows.map((row) => client.scheduled.delete(row)));
  if (!request.enabled) return rows.length > 0 ? 'updated' : 'unchanged';
  await client.scheduled.create(request.workflow, {
    triggerAt: new Date(request.triggerAt),
    input: request.input,
    additionalMetadata: {
      [scheduleIdentityKey]: request.identity,
      [scheduleRevisionKey]: request.revision,
      [scheduleFingerprintKey]: fingerprint,
    },
  });
  return rows.length > 0 ? 'updated' : 'created';
}

async function listedOneTimeSchedules(
  client: HatchetApplicationScheduleClient,
  workflow: string | undefined,
  identity: string,
): Promise<readonly HatchetScheduleRecord[]> {
  const listed = await client.scheduled.list({
    ...(workflow ? { workflow } : {}),
    limit: maximumProviderRows + 1,
    offset: 0,
    additionalMetadata: [`${scheduleIdentityKey}:${identity}`],
  });
  const rows = (listed.rows ?? []).filter(
    (row) => row.additionalMetadata?.[scheduleIdentityKey] === identity,
  );
  if (rows.length > maximumProviderRows) {
    throw new Error(`Hatchet Scheduler identity ${identity} exceeds the duplicate safety bound.`);
  }
  return rows;
}

async function removeProviderSchedule(
  client: HatchetApplicationScheduleClient,
  identity: string,
): Promise<boolean> {
  const crons = await client.cron.list({ cronName: identity, limit: maximumProviderRows + 1, offset: 0 });
  const matchingCrons = (crons.rows ?? []).filter((row) => row.name === identity);
  const scheduled = await listedOneTimeSchedules(client, undefined, identity);
  await Promise.all([
    ...matchingCrons.map((row) => client.cron.delete(row)),
    ...scheduled.map((row) => client.scheduled.delete(row)),
  ]);
  return matchingCrons.length + scheduled.length > 0;
}

function fixedInstance(
  definition: ApplicationScheduleDefinitionContract<object>,
): ApplicationScheduleInstance<object> {
  return {
    id: 'fixed',
    revision: shortHash({
      id: definition.id,
      cron: definition.cron,
      every: definition.every,
      at: definition.at,
      timezone: definition.timezone,
    }, 64),
    input: {},
    ...(definition.cron ? { cron: definition.cron } : {}),
    ...(definition.every ? { every: definition.every } : {}),
    ...(definition.at ? { at: definition.at, deleteAfterCompletion: true } : {}),
    timezone: definition.timezone,
    enabled: true,
  };
}

function deliveryInput(
  definition: ApplicationScheduleDefinitionContract<object>,
  instance: ApplicationScheduleInstance<object>,
): HatchetApplicationScheduleDeliveryInput {
  return {
    schemaVersion: 'applik8s.hatchetScheduleDelivery/v1alpha1',
    definitionId: definition.id,
    instanceId: instance.id,
    input: instance.input,
    ...(instance.at ? { scheduledAt: new Date(instance.at).toISOString() } : {}),
  };
}

function deliveryWorkflowName(
  options: Pick<HatchetApplicationScheduleRuntimeOptions, 'applicationId' | 'schedulerNodeId'>,
  definitionId: string,
): string {
  return boundedHatchetName(
    `applik8s-schedule-${options.applicationId}-${shortHash(options.schedulerNodeId)}-${shortHash(definitionId)}`,
  );
}

function providerScheduleIdentity(
  options: Pick<HatchetApplicationScheduleRuntimeOptions, 'applicationId' | 'environmentId' | 'schedulerNodeId'>,
  definitionId: string,
  instanceId: string,
): string {
  return boundedHatchetName(
    `applik8s-${shortHash({
      applicationId: options.applicationId,
      environmentId: options.environmentId,
      schedulerNodeId: options.schedulerNodeId,
      definitionId,
      instanceId,
    }, 40)}`,
  );
}

function hatchetCron(
  definition: ApplicationScheduleDefinitionContract<object>,
  instance: ApplicationScheduleInstance<object>,
): string {
  assertHatchetScheduleCompatible(definition, instance);
  const cron = instance.cron ?? definition.cron;
  if (cron) return cron;
  const every = instance.every ?? definition.every;
  if (!every) {
    throw new Error(`Hatchet Scheduler ${definition.id} requires a recurring minute-or-coarser cadence or an exact one-time timestamp.`);
  }
  return exactFiveFieldCronForInterval(every);
}

function assertHatchetScheduleCompatible(
  definition: ApplicationScheduleDefinitionContract<object>,
  instance: ApplicationScheduleInstance<object>,
): void {
  const cron = instance.cron ?? definition.cron;
  if (cron) {
    const timezone = instance.timezone ?? definition.timezone;
    if (timezone !== 'UTC') {
      throw new HatchetScheduleTimezoneCompatibilityError(definition.id, timezone);
    }
    return;
  }
  const every = instance.every ?? definition.every;
  if (every) exactFiveFieldCronForInterval(every);
}

export class HatchetScheduleTimezoneCompatibilityError extends Error {
  readonly code = 'SCHEDULE_TIMEZONE_UNSUPPORTED';

  constructor(readonly definitionId: string, readonly timezone: string) {
    super(
      `Hatchet Scheduler ${definitionId} cannot preserve calendar cron timezone ${timezone}; select UTC or a timezone-capable provider.`,
    );
    this.name = 'HatchetScheduleTimezoneCompatibilityError';
  }
}

function recurringScheduledAt(providerCreatedAt: string): string {
  const created = new Date(providerCreatedAt);
  created.setUTCSeconds(0, 0);
  return created.toISOString();
}

function requiredTimestamp(value: string | undefined, label: string): string {
  const date = value ? new Date(value) : undefined;
  if (!date || !Number.isFinite(date.getTime())) {
    throw new Error(`${label} is required and must be an RFC 3339 timestamp.`);
  }
  return date.toISOString();
}

function boundedHatchetName(value: string): string {
  if (value.length > 200) return `${value.slice(0, 150)}-${shortHash(value, 40)}`;
  return value;
}

function shortHash(value: unknown, length = 16): string {
  return createHash('sha256')
    .update(canonicalJsonV1String(value, canonicalJsonCompatibleV1Policy))
    .digest('hex')
    .slice(0, length);
}

function required(value: string, label: string): string {
  if (!value.trim()) throw new Error(`${label} is required.`);
  return value;
}
