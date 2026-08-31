// typecast-file-boundary: Test fixtures intentionally exercise generic schedule schemas and transport admissions.
import {
  applicationScheduleProjectedDesiredState,
  createApplicationJobBinding,
  createDeterministicApplicationJobRuntime,
  createDeterministicApplicationScheduleRuntime,
  createDeterministicApplicationScheduleStateAuthority,
  executeApplicationScheduleAdmission,
  installApplicationScheduleRuntimeResolver,
  registerFixedApplicationSchedule,
  Scheduler,
  schedule,
  type,
} from '@applik8s/applik8s';
import { installApplicationInvocationAdmissionResolver } from '@applik8s/client';
import {
  applicationAdmissionInvocationView,
  createApplicationAdmissionContextV1,
  validateApplicationAdmissionContextV1WithoutReceipt,
  validateApplicationGraphStructure,
  withApplicationAdmissionExecutionV1,
} from '@applik8s/core';
import { afterEach, describe, expect, it } from 'vitest';

const disposers: Array<() => void> = [];

function admittedCaller() {
  const admittedAt = '2026-01-01T00:00:00.000Z';
  const deadline = '2026-01-01T01:00:00.000Z';
  const principal = Object.freeze({
    id: 'principal:schedule-test:execution:workflow:caller:1',
    identity: Object.freeze({
      id: 'identity:schedule-test:workflow',
      kind: 'workload' as const,
      issuer: 'applik8s://test',
      subject: 'workflow/caller',
    }),
    kind: 'execution' as const,
    executionKind: 'workflow' as const,
    executionId: 'caller',
    attempt: 1,
    workloadIdentity: Object.freeze({
      id: 'identity:schedule-test:workflow',
      kind: 'workload' as const,
      issuer: 'applik8s://test',
      subject: 'workflow/caller',
    }),
    causalPrincipalId: 'principal:schedule-test:human:user-1',
    causalPrincipal: Object.freeze({
      id: 'identity:schedule-test:human:user-1',
      kind: 'human' as const,
      issuer: 'applik8s://test',
      subject: 'user-1',
    }),
    causalGrantIds: Object.freeze([] as string[]),
    authenticationMethod: 'test-workload',
    audience: Object.freeze(['applik8s://schedules/evidence.cleanup.v1/instances/immediate/operations/invoke']),
    trustedContextDigest: 'sha256:test-context',
    catalogRevision: 'catalog:test',
    authorityRevision: 'authority:test',
    admittedAt,
    deadline,
    expiresAt: deadline,
    cancellationRevision: 'active:caller',
    bindings: Object.freeze([]),
    effectiveAuthority: Object.freeze([]),
  });
  return applicationAdmissionInvocationView(validateApplicationAdmissionContextV1WithoutReceipt(
    withApplicationAdmissionExecutionV1(createApplicationAdmissionContextV1({
      admission: { principal, trustedContext: { organizationId: 'organization-1' } },
      operation: { id: 'applik8s://workflows/caller/operations/run', transport: 'workflow' },
      correlationId: 'workflow-run-1',
    }), {
      deadline,
      cancellation: { revision: 'active:caller' },
    }),
    { now: Date.parse(admittedAt) },
  ));
}

afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.();
});

describe('v0.8 function-native schedules', () => {
  it('schedules a one-time Job through the shared desired-state and occurrence authority', async () => {
    const clock = { now: new Date('2026-01-01T00:00:00.000Z') };
    const scheduleRuntime = createDeterministicApplicationScheduleRuntime({
      applicationId: 'schedule-test',
      environmentId: 'jobs',
      now: () => clock.now,
    });
    disposers.push(installApplicationScheduleRuntimeResolver(() => scheduleRuntime));
    disposers.push(installApplicationInvocationAdmissionResolver(() => admittedCaller()));
    const observed: number[] = [];
    const job = createApplicationJobBinding({
      id: 'numbers.double.v1',
      contract: {
        input: type({ value: 'number.integer' }),
        output: type({ doubled: 'number.integer' }),
      },
      options: {},
      handler(input) {
        observed.push(input.value);
        return { doubled: input.value * 2 };
      },
    }, createDeterministicApplicationJobRuntime({
      now: () => clock.now,
      id: () => 'scheduled-job-run',
    }));

    await expect(job.schedule(
      { value: 21 },
      { at: '2026-01-01T00:01:00.000Z' },
    )).resolves.toMatchObject({ state: 'created' });
    expect(observed).toEqual([]);
    clock.now = new Date('2026-01-01T00:01:00.000Z');
    await scheduleRuntime.tick(clock.now);
    expect(observed).toEqual([21]);
    expect(scheduleRuntime.occurrences()).toContainEqual(expect.objectContaining({
      state: 'succeeded',
      result: expect.objectContaining({
        protocol: 'applik8s.jobRuntime/v1alpha1',
        job: 'numbers.double.v1',
        runId: 'scheduled-job-run',
      }),
    }));
  });

  it('declares an inert fixed schedule and executes it only through an installed runtime', async () => {
    const clock = { now: new Date('2026-01-01T00:00:00.000Z') };
    const runtime = createDeterministicApplicationScheduleRuntime({
      applicationId: 'schedule-test',
      environmentId: 'test',
      now: () => clock.now,
    });
    disposers.push(installApplicationScheduleRuntimeResolver(() => runtime));
    const caller = admittedCaller();
    const immediateContexts: unknown[] = [];
    const Cleanup = schedule(
      {
        id: 'evidence.cleanup.v1',
        cron: '0 3 * * *',
        timezone: 'UTC',
      },
      async (context) => {
        immediateContexts.push(context);
        return { occurrenceId: context.occurrenceId };
      },
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
    await expect(Cleanup()).rejects.toThrow(/active managed-execution admission/u);
    disposers.push(installApplicationInvocationAdmissionResolver(() => caller));
    await expect(Cleanup()).resolves.toEqual({
      occurrenceId: expect.stringMatching(/^occ_[a-f0-9]{64}$/u),
    });
    expect(immediateContexts).toEqual([
      expect.objectContaining({
        trigger: 'immediate',
        admission: expect.objectContaining({
          principal: caller.principal,
          trustedContext: caller.trustedContext,
          causationId: caller.correlationId,
          operation: {
            id: 'applik8s://schedules/evidence.cleanup.v1/instances/immediate/operations/invoke',
            transport: 'direct',
          },
        }),
      }),
    ]);
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
    disposers.push(installApplicationInvocationAdmissionResolver(() => admittedCaller()));
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
    )).toThrow(/maximumCatchUp/u);
    expect(() => schedule(
      { id: 'invalid.cron.v1', cron: '61 * * * *' },
      async () => ({}),
    )).toThrow(/out-of-range/u);
    expect(() => schedule(
      { id: 'invalid.timestamp.v1', at: '2026-08-19T12:00:00' },
      async () => ({}),
    )).toThrow(/explicit offset/u);
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
    expect(receipt.occurrenceId).toMatch(/^occ_[a-f0-9]{64}$/u);
    const occurrenceId = receipt.occurrenceId;
    expect(receipt).toMatchObject({
      state: 'succeeded',
      attempts: 2,
      result: { polled: 'source-a' },
    });
    expect(seen).toEqual([expect.objectContaining({
      input: { sourceId: 'source-a' },
			context: expect.objectContaining({
				instanceId: 'tenant-a',
				attempt: 2,
				trigger: 'schedule',
				admission: expect.objectContaining({
					apiVersion: 'applik8s.admission/v1',
					principal: expect.objectContaining({ kind: 'service' }),
					operation: {
						id: 'applik8s://schedules/source.poll.aws.v1/instances/tenant-a/operations/invoke',
						transport: 'schedule',
					},
				}),
			}),
    })]);

    const redelivered = await executeApplicationScheduleAdmission(Poll, {
      schemaVersion: 'applik8s.scheduleAdmission/v1alpha1',
      applicationId: 'documents',
      environmentId: 'production',
      definitionId: 'source.poll.aws.v1',
      instanceId: 'tenant-a',
      scheduledAt: '2026-08-19T12:00:00.000Z',
      admittedAt: '2026-08-19T12:00:02.000Z',
      attempt: 3,
      input: { sourceId: 'source-a' },
      schedulerExecutionId: 'aws-execution-2',
    });
    expect(redelivered.occurrenceId).toBe(occurrenceId);
  });

  it('fails closed on early delivery and skips provider delivery outside portable lateness bounds', async () => {
    let invocations = 0;
    const Skip = Scheduler.named('bounded').schedule(
      {
        id: 'bounded.provider.v1',
        input: type({ id: 'string' }),
        misfires: 'skip',
        maximumLateness: '30s',
        retry: { maximumAge: '5m' },
      },
      async () => { invocations += 1; },
    );
    const base = {
      schemaVersion: 'applik8s.scheduleAdmission/v1alpha1' as const,
      applicationId: 'documents',
      environmentId: 'production',
      definitionId: 'bounded.provider.v1',
      instanceId: 'tenant-a',
      attempt: 1,
      input: { id: 'tenant-a' },
    };
    await expect(executeApplicationScheduleAdmission(Skip, {
      ...base,
      scheduledAt: '2026-08-19T12:00:00.000Z',
      admittedAt: '2026-08-19T12:00:31.000Z',
    })).resolves.toMatchObject({ state: 'skipped', attempts: 1 });
    await expect(executeApplicationScheduleAdmission(Skip, {
      ...base,
      scheduledAt: '2026-08-19T12:00:01.000Z',
      admittedAt: '2026-08-19T12:00:00.000Z',
    })).rejects.toThrow(/precedes its scheduled time/u);
    expect(invocations).toBe(0);
  });

  it('bounds catch-up to the newest eligible occurrences', async () => {
    const clock = { now: new Date('2026-01-01T00:00:00.000Z') };
    const runtime = createDeterministicApplicationScheduleRuntime({
      applicationId: 'schedule-test', environmentId: 'catch-up', now: () => clock.now,
    });
    disposers.push(installApplicationScheduleRuntimeResolver(() => runtime));
    disposers.push(installApplicationInvocationAdmissionResolver(() => admittedCaller()));
    const seen: string[] = [];
    const CatchUp = Scheduler.named('catch-up').schedule(
      {
        id: 'catch-up.v1',
        input: type({ id: 'string' }),
        misfires: 'all-bounded',
        maximumCatchUp: 2,
      },
      async (_input, context) => { seen.push(context.scheduledAt); },
    );
    await CatchUp.schedule({ id: 'tenant-a', revision: '1', every: '1m', input: { id: 'tenant-a' } });
    clock.now = new Date('2026-01-01T00:05:00.000Z');
    await runtime.tick(clock.now);
    expect(seen).toEqual([
      '2026-01-01T00:04:00.000Z',
      '2026-01-01T00:05:00.000Z',
    ]);
  });

  it('applies bounded skip/latest misfires while resuming already-admitted work', async () => {
    const clock = { now: new Date('2026-01-01T00:00:00.000Z') };
    const runtime = createDeterministicApplicationScheduleRuntime({
      applicationId: 'schedule-test', environmentId: 'misfires', now: () => clock.now,
    });
    disposers.push(installApplicationScheduleRuntimeResolver(() => runtime));
    disposers.push(installApplicationInvocationAdmissionResolver(() => admittedCaller()));
    const skipped: string[] = [];
    const Skip = Scheduler.named('skip').schedule(
      {
        id: 'skip.v1',
        input: type({ id: 'string' }),
        misfires: 'skip',
        maximumLateness: '20s',
        retry: { maximumAge: '10m' },
      },
      async (_input, context) => { skipped.push(context.scheduledAt); },
    );
    await Skip.schedule({ id: 'tenant-a', revision: '1', every: '1m', input: { id: 'tenant-a' } });

    clock.now = new Date('2026-01-01T00:01:15.000Z');
    await runtime.tick(clock.now);
    expect(skipped).toEqual(['2026-01-01T00:01:00.000Z']);
    clock.now = new Date('2026-01-01T00:03:30.000Z');
    await runtime.tick(clock.now);
    expect(skipped).toEqual(['2026-01-01T00:01:00.000Z']);

    const latest: string[] = [];
    const Latest = Scheduler.named('latest').schedule(
      {
        id: 'latest.v1',
        input: type({ id: 'string' }),
        misfires: 'latest',
        retry: { maximumAge: '2m' },
      },
      async (_input, context) => { latest.push(context.scheduledAt); },
    );
    await Latest.schedule({ id: 'tenant-a', revision: '1', every: '1m', input: { id: 'tenant-a' } });
    clock.now = new Date('2026-01-01T00:06:30.000Z');
    await runtime.tick(clock.now);
    expect(latest).toEqual(['2026-01-01T00:06:30.000Z']);
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
    disposers.push(installApplicationInvocationAdmissionResolver(() => admittedCaller()));
    const runs: string[] = [];
    const Rebuild = Scheduler.named('durable').schedule(
      {
        id: 'durable.rebuild.v1',
        input: type({ id: 'string' }),
        misfires: 'latest',
        retry: { maximumAge: '1m' },
      },
      async (_input, context) => { runs.push(context.occurrenceId); return { done: true }; },
    );
    const durableInstance = {
      id: 'tenant-a',
      revision: '1',
      at: '2026-01-01T00:01:00.000Z',
      deleteAfterCompletion: true,
      input: { id: 'tenant-a' },
    } as const;
    await Rebuild.schedule(durableInstance);
    clock.now = new Date('2026-01-01T00:01:00.000Z');
    await expect(first.tick(clock.now)).rejects.toThrow(/simulated process loss/u);
    expect(runs).toEqual([]);
    expect(durable?.occurrences).toEqual([expect.objectContaining({ state: 'admitted', scheduledAt: '2026-01-01T00:01:00.000Z' })]);
    const interruptedRevision = durable?.revision ?? 0;

    const disposeAdmission = disposers.pop();
    const disposeRuntime = disposers.pop();
    disposeAdmission?.();
    disposeRuntime?.();
    // Misfire and retry-age selection applies before admission. A durable
    // admitted occurrence must still recover after that window has elapsed.
    clock.now = new Date('2026-01-01T00:10:00.000Z');
    const recoveredSnapshot = durable;
    if (!recoveredSnapshot) throw new Error('Expected a durable admitted schedule snapshot.');
    const restarted = createDeterministicApplicationScheduleRuntime({
      applicationId: 'schedule-test',
      environmentId: 'restart-test',
      now: () => clock.now,
      snapshot: recoveredSnapshot,
      persist(snapshot) { durable = snapshot; },
    });
    disposers.push(installApplicationScheduleRuntimeResolver(() => restarted));
    disposers.push(installApplicationInvocationAdmissionResolver(() => admittedCaller()));
    await expect(Rebuild.schedule(durableInstance)).resolves.toMatchObject({ state: 'unchanged' });
    const recovered = await restarted.tick(clock.now);
    expect(recovered).toEqual([expect.objectContaining({ state: 'succeeded', scheduledAt: '2026-01-01T00:01:00.000Z' })]);
    expect(runs).toHaveLength(1);
    expect(restarted.snapshot().revision).toBeGreaterThan(interruptedRevision);
  });

  it('retains restart-safe desired projections and deletion tombstones', async () => {
    const authority = createDeterministicApplicationScheduleStateAuthority({
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });
    const definition = {
      id: 'authority.v1', configuration: 'dynamic' as const, timezone: 'UTC', overlap: 'skip' as const,
      overlapBy: (input: { tenantId: string }) => input.tenantId,
      misfires: 'latest' as const, maximumLatenessSeconds: 300,
      retry: { maxAttempts: 3, maximumAgeSeconds: 1800 },
      requirements: { configuration: 'dynamic' as const, cardinality: 'bounded' as const, precision: 'minute' as const },
    };
    const instance = { id: 'job-a', revision: '1', input: { tenantId: 'tenant-a' }, every: '1h' };
    await expect(authority.reconcile({ definition, instance })).resolves.toMatchObject({ state: 'created' });
    const pending = await authority.pending();
    expect(pending).toHaveLength(1);
    expect(applicationScheduleProjectedDesiredState(pending[0]!)).toMatchObject({
      overlapKey: 'tenant-a',
      instance: { id: 'job-a', revision: '1' },
    });
    await authority.markProjected(definition.id, instance.id, instance.revision, 'active');
    expect(await authority.pending()).toEqual([]);
    expect(await authority.recoveryCandidates()).toEqual([
      expect.objectContaining({ state: 'active', projection: 'applied' }),
    ]);
    const management = {
      apiVersion: 'applik8s.scheduleManagement/v1alpha1' as const,
      id: 'schedule-management:test',
      action: 'configure' as const,
      definitionId: definition.id,
      instanceId: instance.id,
      revision: instance.revision,
      principalId: 'principal-a',
      authorityRevision: 'authority-1',
      trustedContextDigest: 'context-digest',
      correlationId: 'correlation-a',
      admittedAt: '2026-01-01T00:00:00.000Z',
    };
    await expect(authority.reconcile({ definition, instance, management })).resolves.toMatchObject({
      state: 'unchanged', management,
    });
    expect(await authority.pending()).toEqual([expect.objectContaining({
      projection: 'pending', management,
    })]);
    await authority.markProjected(definition.id, instance.id, instance.revision, 'active');
    await expect(authority.reconcile({
      definition,
      instance: { ...instance, input: { tenantId: 'different' } },
    })).rejects.toThrow(/conflicts with different desired state/u);

    const restarted = createDeterministicApplicationScheduleStateAuthority({ records: authority.records() });
    await expect(restarted.remove(definition.id, instance.id)).resolves.toMatchObject({ state: 'removed', revision: '1' });
    expect(await restarted.pending()).toEqual([expect.objectContaining({
      state: 'removed', projection: 'pending', revision: '1',
    })]);
    expect(restarted.records()[0]).not.toHaveProperty('desired');
    await expect(restarted.markProjected(definition.id, instance.id, '1', 'active')).resolves.toBe(false);
    expect(await restarted.pending()).toHaveLength(1);
    await restarted.markProjected(definition.id, instance.id, '1', 'removed');
    expect(restarted.records()).toEqual([expect.objectContaining({ state: 'removed', projection: 'applied' })]);
    expect(await restarted.recoveryCandidates()).toEqual([]);
  });

  it('keeps delimiter-like schedule identities distinct in deterministic state', async () => {
    const authority = createDeterministicApplicationScheduleStateAuthority();
    const definition = {
      id: 'definition:a', configuration: 'dynamic' as const, timezone: 'UTC', overlap: 'skip' as const,
      misfires: 'latest' as const, maximumLatenessSeconds: 300,
      retry: { maxAttempts: 3, maximumAgeSeconds: 1800 },
      requirements: { configuration: 'dynamic' as const, cardinality: 'bounded' as const, precision: 'minute' as const },
    };

    await authority.reconcile({
      definition,
      instance: { id: 'instance', revision: '1', input: {}, every: '1h' },
    });
    await authority.reconcile({
      definition: { ...definition, id: 'definition' },
      instance: { id: 'a:instance', revision: '1', input: {}, every: '1h' },
    });

    expect(authority.records()).toHaveLength(2);
  });

  it('enforces a provider active-instance ceiling before committing desired state', async () => {
    const authority = createDeterministicApplicationScheduleStateAuthority();
    const definition = {
      id: 'bounded.v1', configuration: 'dynamic' as const, timezone: 'UTC', overlap: 'skip' as const,
      misfires: 'latest' as const, maximumLatenessSeconds: 300,
      retry: { maxAttempts: 3, maximumAgeSeconds: 1800 },
      requirements: { configuration: 'dynamic' as const, cardinality: 'bounded' as const, precision: 'minute' as const },
    };
    const instance = (id: string) => ({ id, revision: '1', input: {}, every: '1h' });

    await expect(authority.reconcile({
      definition, instance: instance('one'), maximumActiveInstances: 1,
    })).resolves.toMatchObject({ state: 'created' });
    await expect(authority.reconcile({
      definition, instance: instance('two'), maximumActiveInstances: 1,
    })).rejects.toThrow(/instance ceiling 1 is exhausted/u);
    expect(authority.records()).toHaveLength(1);

    await authority.remove(definition.id, 'one');
    await expect(authority.reconcile({
      definition, instance: instance('two'), maximumActiveInstances: 1,
    })).resolves.toMatchObject({ state: 'created' });
  });
});
