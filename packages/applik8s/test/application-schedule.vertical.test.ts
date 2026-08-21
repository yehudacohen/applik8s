// typecast-file-boundary: Test fixtures intentionally exercise generic schedule schemas and transport admissions.
import {
  createDeterministicApplicationScheduleRuntime,
  executeApplicationScheduleAdmission,
  installApplicationScheduleRuntimeResolver,
  registerFixedApplicationSchedule,
  schedule,
  Scheduler,
  type,
} from '@applik8s/applik8s';
import { validateApplicationGraphStructure } from '@applik8s/core';
import { afterEach, describe, expect, it } from 'vitest';

const disposers: Array<() => void> = [];

afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.();
});

describe('v0.8 function-native schedules', () => {
  it('declares an inert fixed schedule and executes it only through an installed runtime', async () => {
    const clock = { now: new Date('2026-01-01T00:00:00.000Z') };
    const runtime = createDeterministicApplicationScheduleRuntime({
      applicationId: 'schedule-test',
      environmentId: 'test',
      now: () => clock.now,
    });
    disposers.push(installApplicationScheduleRuntimeResolver(() => runtime));
    const Cleanup = schedule(
      {
        id: 'evidence.cleanup.v1',
        cron: '0 3 * * *',
        timezone: 'UTC',
      },
      async (context) => ({ occurrenceId: context.occurrenceId }),
    );

    expect(Cleanup.kind).toBe('applicationSchedule');
    expect(Cleanup.graphNode).toMatchObject({
      id: 'schedule.evidence.cleanup.v1',
      kind: 'schedule',
      scheduler: { interface: 'Scheduler', nodeId: 'provider.scheduler' },
      definition: {
        configuration: 'fixed',
        cron: '0 3 * * *',
        overlap: 'skip',
        misfires: 'latest',
      },
    });
    expect(validateApplicationGraphStructure({
      apiVersion: 'applik8s.appGraph/v1alpha1',
      kind: 'ApplicationGraph',
      metadata: { name: 'schedule-test' },
      nodes: [
        Cleanup.graphNode,
        {
          id: 'provider.scheduler',
          kind: 'provider',
          name: 'Scheduler',
          stability: 'stable',
          interface: 'Scheduler',
          implementation: 'deterministic-local',
        },
      ],
      edges: [],
      providerRequirements: [],
      providerBindings: [],
      compatibility: {
        stablePublicApis: [],
        documentedInternalContracts: [],
        experimentalSurfaces: [],
        postV3Surfaces: [],
        labels: [],
      },
    })).toEqual([]);
    await expect(Cleanup()).resolves.toEqual({
      occurrenceId: expect.stringMatching(/^occ_[a-f0-9]{64}$/u),
    });
    await expect(registerFixedApplicationSchedule(runtime, Cleanup)).resolves.toMatchObject({ state: 'created', instanceId: 'fixed' });
    clock.now = new Date('2026-01-01T03:00:00.000Z');
    await expect(runtime.tick(clock.now)).resolves.toEqual([
      expect.objectContaining({ definitionId: 'evidence.cleanup.v1', instanceId: 'fixed', state: 'succeeded' }),
    ]);
  });

  it('converges dynamic desired state and admits deterministic latest occurrences once', async () => {
    const clock = { now: new Date('2026-01-01T00:00:00.000Z') };
    const runtime = createDeterministicApplicationScheduleRuntime({
      applicationId: 'schedule-test',
      environmentId: 'test',
      now: () => clock.now,
    });
    disposers.push(installApplicationScheduleRuntimeResolver(() => runtime));
    const SourcePolling = Scheduler.named('source-polling');
    const seen: string[] = [];
    const PollSource = SourcePolling.schedule(
      {
        id: 'source.poll.v1',
        input: type({ sourceBindingId: 'string' }),
        overlapBy: (input) => input.sourceBindingId,
        overlap: 'skip',
        misfires: 'latest',
        requirements: { configuration: 'dynamic', cardinality: 'high' },
      },
      async (input, context) => {
        seen.push(`${input.sourceBindingId}:${context.scheduledAt}`);
        return { accepted: true };
      },
    );

    await expect(PollSource.schedule({
      id: 'source-a',
      revision: '1',
      every: '1m',
      input: { sourceBindingId: 'source-a' },
    })).resolves.toMatchObject({ state: 'created', revision: '1' });
    await expect(PollSource.schedule({
      id: 'source-a',
      revision: '1',
      every: '1m',
      input: { sourceBindingId: 'source-a' },
    })).resolves.toMatchObject({ state: 'unchanged' });
    await expect(PollSource.schedule({
      id: 'source-a',
      revision: '0',
      every: '2m',
      input: { sourceBindingId: 'source-a' },
    })).rejects.toThrow(/stale/u);

    clock.now = new Date('2026-01-01T00:03:00.000Z');
    const receipts = await runtime.tick(clock.now);
    expect(receipts).toEqual([
      expect.objectContaining({
        definitionId: 'source.poll.v1',
        instanceId: 'source-a',
        scheduledAt: '2026-01-01T00:03:00.000Z',
        state: 'succeeded',
        attempts: 1,
      }),
    ]);
    expect(seen).toEqual(['source-a:2026-01-01T00:03:00.000Z']);
    await expect(runtime.tick(clock.now)).resolves.toEqual([]);
    await expect(PollSource.unschedule('source-a')).resolves.toMatchObject({ state: 'removed' });
  });

  it('rejects invalid cadence and unbounded misfire declarations before side effects', () => {
    expect(() => schedule(
      { id: 'invalid.fixed.v1', cron: '* * * * *', every: '1m' },
      async () => ({}),
    )).toThrow(/exactly one/u);
    expect(() => schedule(
      {
        id: 'invalid.dynamic.v1',
        input: type({ id: 'string' }),
        misfires: 'all-bounded',
      },
      async () => ({}),
    )).toThrow(/maxCatchUp/u);
  });

  it('executes a provider-admitted occurrence with stable identity and typed context', async () => {
    const seen: unknown[] = [];
    const Poll = Scheduler.named('aws').schedule(
      { id: 'source.poll.aws.v1', input: type({ sourceId: 'string' }) },
      async (input, context) => {
        seen.push({ input, context });
        return { polled: input.sourceId };
      },
    );
    const receipt = await executeApplicationScheduleAdmission(Poll, {
      schemaVersion: 'applik8s.scheduleAdmission/v1alpha1',
      applicationId: 'documents',
      environmentId: 'production',
      definitionId: 'source.poll.aws.v1',
      instanceId: 'tenant-a',
      scheduledAt: '2026-08-19T12:00:00.000Z',
      admittedAt: '2026-08-19T12:00:01.000Z',
      attempt: 2,
      input: { sourceId: 'source-a' },
      schedulerExecutionId: 'aws-execution-1',
    });
    expect(receipt).toMatchObject({
      occurrenceId: expect.stringMatching(/^occ_[a-f0-9]{64}$/u),
      state: 'succeeded',
      attempts: 2,
      result: { polled: 'source-a' },
    });
    expect(seen).toEqual([expect.objectContaining({
      input: { sourceId: 'source-a' },
      context: expect.objectContaining({ instanceId: 'tenant-a', attempt: 2, trigger: 'schedule' }),
    })]);
  });

  it('recovers admitted occurrences and stable interval anchors from durable snapshots', async () => {
    const clock = { now: new Date('2026-01-01T00:00:00.000Z') };
    let durable: ReturnType<ReturnType<typeof createDeterministicApplicationScheduleRuntime>['snapshot']> | undefined;
    let interruptAdmission = true;
    const first = createDeterministicApplicationScheduleRuntime({
      applicationId: 'schedule-test',
      environmentId: 'restart-test',
      now: () => clock.now,
      persist(snapshot) {
        durable = snapshot;
        if (interruptAdmission && snapshot.occurrences.some(({ state }) => state === 'admitted')) {
          interruptAdmission = false;
          throw new Error('simulated process loss after admission');
        }
      },
    });
    disposers.push(installApplicationScheduleRuntimeResolver(() => first));
    const runs: string[] = [];
    const Rebuild = Scheduler.named('durable').schedule(
      { id: 'durable.rebuild.v1', input: type({ id: 'string' }), misfires: 'latest' },
      async (_input, context) => { runs.push(context.occurrenceId); return { done: true }; },
    );
    await Rebuild.schedule({ id: 'tenant-a', revision: '1', every: '1m', input: { id: 'tenant-a' } });
    clock.now = new Date('2026-01-01T00:01:00.000Z');
    await expect(first.tick(clock.now)).rejects.toThrow(/simulated process loss/u);
    expect(runs).toEqual([]);
    expect(durable?.occurrences).toEqual([expect.objectContaining({ state: 'admitted', scheduledAt: '2026-01-01T00:01:00.000Z' })]);
    const interruptedRevision = durable?.revision ?? 0;

    disposers.pop()?.();
    const restarted = createDeterministicApplicationScheduleRuntime({
      applicationId: 'schedule-test',
      environmentId: 'restart-test',
      now: () => clock.now,
      snapshot: durable!,
      persist(snapshot) { durable = snapshot; },
    });
    disposers.push(installApplicationScheduleRuntimeResolver(() => restarted));
    await expect(Rebuild.schedule({ id: 'tenant-a', revision: '1', every: '1m', input: { id: 'tenant-a' } })).resolves.toMatchObject({ state: 'unchanged' });
    const recovered = await restarted.tick(clock.now);
    expect(recovered).toEqual([expect.objectContaining({ state: 'succeeded', scheduledAt: '2026-01-01T00:01:00.000Z' })]);
    expect(runs).toHaveLength(1);
    expect(restarted.snapshot().revision).toBeGreaterThan(interruptedRevision);
  });
});
