// typecast-file-boundary: provider fixtures deliberately erase schedule input/result generics at the runtime registry boundary.
import {
  type ApplicationScheduleAdmission,
  type ApplicationScheduleHandle,
  type ApplicationScheduleOccurrenceReceipt,
  createDeterministicApplicationScheduleStateAuthority,
  Scheduler,
  type,
} from '@applik8s/applik8s';
import { describe, expect, it } from 'vitest';
import {
  createHatchetApplicationScheduleRuntimeFromClient,
  type HatchetApplicationScheduleClient,
  type HatchetApplicationScheduleDeliveryInput,
} from '../src/application-schedule.js';

describe('Hatchet function-native Scheduler adapter', () => {
  it('projects canonical fixed and dynamic state and delivers one canonical occurrence', async () => {
    const fixed = Scheduler.named('hosted').schedule(
      { id: 'maintenance.v1', cron: '* * * * *', timezone: 'UTC' },
      async (context) => ({ occurrenceId: context.occurrenceId }),
    );
    const dynamic = Scheduler.named('hosted').schedule(
      {
        id: 'poll-source.v1',
        input: type({ sourceId: 'string' }),
        overlapBy: ({ sourceId }) => sourceId,
      },
      async ({ sourceId }, context) => ({ sourceId, occurrenceId: context.occurrenceId }),
    );
    const provider = fakeHatchetScheduleClient();
    const delivered: ApplicationScheduleAdmission[] = [];
    const runtime = await createHatchetApplicationScheduleRuntimeFromClient(
      provider.client,
      {
        applicationId: 'schedule-proof',
        environmentId: 'test',
        schedulerNodeId: 'provider.scheduler.v1alpha1.hosted',
        databaseUrl: 'postgres://unused',
        stateAuthority: createDeterministicApplicationScheduleStateAuthority(),
        occurrenceExecutor: async (request) => {
          delivered.push(request.admission);
          return {
            occurrenceId: 'occurrence-1',
            definitionId: request.admission.definitionId,
            instanceId: request.admission.instanceId,
            scheduledAt: request.admission.scheduledAt,
            state: 'succeeded',
            attempts: request.admission.attempt,
          };
        },
      },
      [
        fixed as unknown as ApplicationScheduleHandle<object, unknown>,
        dynamic as unknown as ApplicationScheduleHandle<object, unknown>,
      ],
    );

    expect(provider.crons).toHaveLength(1);
    expect(provider.crons[0]).toMatchObject({
      cron: '* * * * *',
      enabled: true,
    });
    await runtime.reconcile({
      definition: dynamic.definition,
      instance: {
        id: 'source-a',
        revision: '1',
        input: { sourceId: 'source-a' },
        cron: '*/5 * * * *',
        timezone: 'UTC',
        enabled: true,
      },
      handler: async () => undefined,
    });
    expect(provider.crons).toHaveLength(2);

    const delivery = provider.tasks[1];
    if (!delivery) throw new Error('Expected the dynamic Hatchet delivery task.');
    const receipt = await delivery.fn(
      {
        schemaVersion: 'applik8s.hatchetScheduleDelivery/v1alpha1',
        definitionId: 'poll-source.v1',
        instanceId: 'source-a',
        input: { sourceId: 'source-a' },
      },
      {
        workflowRunId: () => 'hatchet-run-1',
        retryCount: () => 1,
        abortController: new AbortController(),
      },
    );
    expect(receipt).toMatchObject({ state: 'succeeded', attempts: 2 });
    expect(delivered).toEqual([
      expect.objectContaining({
        definitionId: 'poll-source.v1',
        instanceId: 'source-a',
        scheduledAt: '2026-08-24T12:34:00.000Z',
        admittedAt: expect.any(String),
        attempt: 2,
        schedulerExecutionId: 'hatchet-run-1',
      }),
    ]);

    await runtime.remove('poll-source.v1', 'source-a');
    expect(provider.crons).toHaveLength(1);
    await runtime.close();
    expect(provider.stopped).toBe(true);
  });

  it('reconciles one-time revisions without duplicating provider schedules', async () => {
    const dynamic = Scheduler.named('hosted').schedule(
      { id: 'one-time.v1', input: type({ key: 'string' }) },
      async ({ key }) => ({ key }),
    );
    const provider = fakeHatchetScheduleClient();
    const runtime = await createHatchetApplicationScheduleRuntimeFromClient(
      provider.client,
      {
        applicationId: 'schedule-proof',
        environmentId: 'test',
        schedulerNodeId: 'provider.scheduler.v1alpha1.hosted',
        databaseUrl: 'postgres://unused',
        stateAuthority: createDeterministicApplicationScheduleStateAuthority(),
        occurrenceExecutor: async <_TInput extends object, TResult>() => successReceipt<TResult>(),
      },
      [dynamic as unknown as ApplicationScheduleHandle<object, unknown>],
    );
    const first = {
      id: 'reminder',
      revision: '1',
      input: { key: 'a' },
      at: '2026-09-01T10:00:00.000Z',
      timezone: 'UTC',
      enabled: true,
    } as const;
    await runtime.reconcile({
      definition: dynamic.definition,
      instance: first,
      handler: async () => undefined,
    });
    await runtime.reconcile({
      definition: dynamic.definition,
      instance: first,
      handler: async () => undefined,
    });
    expect(provider.scheduled).toHaveLength(1);
    await runtime.reconcile({
      definition: dynamic.definition,
      instance: { ...first, revision: '2', at: '2026-09-01T11:00:00.000Z' },
      handler: async () => undefined,
    });
    expect(provider.scheduled).toHaveLength(1);
    expect(provider.scheduled[0]?.triggerAt).toBe('2026-09-01T11:00:00.000Z');
    await runtime.close();
  });

  it('recovers canonical desired state after an interrupted provider projection', async () => {
    const dynamic = Scheduler.named('hosted').schedule(
      { id: 'recover.v1', input: type({ key: 'string' }) },
      async ({ key }) => ({ key }),
    );
    const provider = fakeHatchetScheduleClient();
    const stateAuthority = createDeterministicApplicationScheduleStateAuthority();
    const options = {
      applicationId: 'schedule-proof',
      environmentId: 'test',
      schedulerNodeId: 'provider.scheduler.v1alpha1.hosted',
      databaseUrl: 'postgres://unused',
      stateAuthority,
      occurrenceExecutor: async <_TInput extends object, TResult>() => successReceipt<TResult>(),
    } as const;
    const runtime = await createHatchetApplicationScheduleRuntimeFromClient(
      provider.client,
      options,
      [dynamic as unknown as ApplicationScheduleHandle<object, unknown>],
    );
    provider.failNextCronCreate();
    await expect(runtime.reconcile({
      definition: dynamic.definition,
      instance: {
        id: 'recover-me', revision: '1', input: { key: 'value' }, every: '1h', enabled: true,
      },
      handler: async () => undefined,
    })).rejects.toThrow('Hatchet provider request failed');
    expect(await stateAuthority.pending()).toHaveLength(1);
    await runtime.close();

    const recovered = await createHatchetApplicationScheduleRuntimeFromClient(
      provider.client,
      options,
      [dynamic as unknown as ApplicationScheduleHandle<object, unknown>],
    );
    expect(await stateAuthority.pending()).toHaveLength(0);
    expect(provider.crons).toHaveLength(1);
    await recovered.close();
  });

  it('stops its worker when fixed-schedule initialization fails closed', async () => {
    const fixed = Scheduler.named('hosted').schedule(
      { id: 'failed-initialization.v1', cron: '* * * * *', timezone: 'UTC' },
      async () => undefined,
    );
    const provider = fakeHatchetScheduleClient();
    provider.failNextCronCreate();
    await expect(createHatchetApplicationScheduleRuntimeFromClient(
      provider.client,
      {
        applicationId: 'schedule-proof',
        environmentId: 'test',
        schedulerNodeId: 'provider.scheduler.v1alpha1.hosted',
        databaseUrl: 'postgres://unused',
        stateAuthority: createDeterministicApplicationScheduleStateAuthority(),
      },
      [fixed as unknown as ApplicationScheduleHandle<object, unknown>],
    )).rejects.toThrow('Hatchet provider request failed');
    expect(provider.stopped).toBe(true);
  });

  it('rejects non-UTC calendar cron before creating a provider schedule', async () => {
    const fixed = Scheduler.named('hosted').schedule(
      { id: 'zoned-calendar.v1', cron: '0 9 * * *', timezone: 'America/New_York' },
      async () => undefined,
    );
    const provider = fakeHatchetScheduleClient();
    const stateAuthority = createDeterministicApplicationScheduleStateAuthority();
    await expect(createHatchetApplicationScheduleRuntimeFromClient(
      provider.client,
      {
        applicationId: 'schedule-proof',
        environmentId: 'test',
        schedulerNodeId: 'provider.scheduler.v1alpha1.hosted',
        databaseUrl: 'postgres://unused',
        stateAuthority,
      },
      [fixed as unknown as ApplicationScheduleHandle<object, unknown>],
    )).rejects.toThrow('cannot preserve calendar cron timezone America/New_York');
    expect(provider.crons).toHaveLength(0);
    expect(await stateAuthority.pending()).toHaveLength(0);
    expect(provider.stopped).toBe(true);
  });
});

function fakeHatchetScheduleClient(): {
  readonly client: HatchetApplicationScheduleClient;
  readonly crons: Array<{
    metadata: { id: string };
    name: string;
    cron: string;
    enabled: boolean;
    additionalMetadata: Readonly<Record<string, unknown>>;
  }>;
  readonly scheduled: Array<{
    metadata: { id: string };
    triggerAt: string;
    additionalMetadata: Readonly<Record<string, unknown>>;
  }>;
  readonly tasks: Array<{
    readonly name: string;
    readonly fn: (
      input: HatchetApplicationScheduleDeliveryInput,
      context: {
        workflowRunId(): string;
        retryCount(): number;
        readonly abortController?: AbortController;
      },
    ) => Promise<ApplicationScheduleOccurrenceReceipt>;
  }>;
  readonly stopped: boolean;
  failNextCronCreate(): void;
} {
  const crons: Array<{
    metadata: { id: string };
    name: string;
    cron: string;
    enabled: boolean;
    additionalMetadata: Readonly<Record<string, unknown>>;
  }> = [];
  const scheduled: Array<{
    metadata: { id: string };
    triggerAt: string;
    additionalMetadata: Readonly<Record<string, unknown>>;
  }> = [];
  const tasks: Array<{
    readonly name: string;
    readonly fn: (
      input: HatchetApplicationScheduleDeliveryInput,
      context: {
        workflowRunId(): string;
        retryCount(): number;
        readonly abortController?: AbortController;
      },
    ) => Promise<ApplicationScheduleOccurrenceReceipt>;
  }> = [];
  let stop: (() => void) | undefined;
  let stopped = false;
  let nextId = 1;
  let failCronCreate = false;
  const client: HatchetApplicationScheduleClient = {
    cron: {
      async list(query) {
        return {
          rows: crons.filter((row) => !query.cronName || row.name === query.cronName),
        };
      },
      async create(_workflow, input) {
        if (failCronCreate) {
          failCronCreate = false;
          throw new Error('simulated Hatchet projection interruption');
        }
        const row = {
          metadata: { id: `cron-${nextId++}` },
          name: input.name,
          cron: input.expression,
          enabled: true,
          additionalMetadata: input.additionalMetadata ?? {},
        };
        crons.push(row);
        return row;
      },
      async delete(candidate) {
        const id = typeof candidate === 'string' ? candidate : candidate.metadata.id;
        const index = crons.findIndex((row) => row.metadata.id === id);
        if (index >= 0) crons.splice(index, 1);
      },
    },
    scheduled: {
      async list(query) {
        const identity = query.additionalMetadata?.[0]?.split(':').slice(1).join(':');
        return {
          rows: scheduled.filter((row) =>
            !identity || row.additionalMetadata['applik8s.schedule.identity'] === identity),
        };
      },
      async create(_workflow, input) {
        const row = {
          metadata: { id: `scheduled-${nextId++}` },
          triggerAt: input.triggerAt.toISOString(),
          additionalMetadata: input.additionalMetadata ?? {},
        };
        scheduled.push(row);
        return row;
      },
      async delete(candidate) {
        const id = typeof candidate === 'string' ? candidate : candidate.metadata.id;
        const index = scheduled.findIndex((row) => row.metadata.id === id);
        if (index >= 0) scheduled.splice(index, 1);
      },
    },
    runs: {
      async get() {
        return { run: { createdAt: '2026-08-24T12:34:56.000Z' } };
      },
    },
    task(options) {
      tasks.push({ name: options.name, fn: options.fn });
      return {};
    },
    async worker() {
      return {
        async registerWorkflows() {},
        async start() {
          await new Promise<void>((resolve) => { stop = resolve; });
        },
        async waitUntilReady() {},
        async stop() {
          stopped = true;
          stop?.();
        },
      };
    },
  };
  return {
    client,
    crons,
    scheduled,
    tasks,
    get stopped() { return stopped; },
    failNextCronCreate() { failCronCreate = true; },
  };
}

function successReceipt<TResult>(): ApplicationScheduleOccurrenceReceipt<TResult> {
  return {
    occurrenceId: 'occurrence',
    definitionId: 'one-time.v1',
    instanceId: 'reminder',
    scheduledAt: '2026-09-01T10:00:00.000Z',
    state: 'succeeded',
    attempts: 1,
  };
}
