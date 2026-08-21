// typecast-file-boundary: workflow fixtures inspect compiler-owned metadata and deliberately restore their declared generic binding shapes.
import { actor, app, applicationGraphFor, applicationScheduleInvocationAdmission, event, IndexStore, installApplicationScheduleRuntimeResolver, ObjectStorage, StructuredGeneration as StructuredGenerationProvider, setApplicationWorkflowRuntimeFactory, WorkflowEngine, workflow } from '@applik8s/applik8s';
import { installApplicationInvocationAdmissionResolver } from '@applik8s/client';
import { type } from '@applik8s/applik8s/dsl';
import { StructuredGeneration } from '@applik8s/applik8s/structured-generation';
import {
  applicationAdmissionInvocationView,
  createApplicationAdmissionContextV1,
  validateApplicationAdmissionContextV1WithoutReceipt,
  validateApplicationGraphStructure,
} from '@applik8s/core';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { testApplicationAdmission } from '../../../test-support/application-principal.js';

const ProvisionTenant = workflow('tenant.provision.v1', {
  input: type({ tenantId: 'string', requestId: 'string' }),
  output: type({ endpoint: 'string' }),
  errors: { providerUnavailable: type({ retryAfterSeconds: 'number' }) },
});

const TenantOnboarding = workflow('tenant.onboarding.v1', {
  input: type({ tenantId: 'string', requestId: 'string' }),
  output: type({ endpoint: 'string', approved: 'boolean' }),
  errors: { rejected: type({ reason: 'string' }) },
  signals: { approval: type({ approved: 'boolean' }) },
});

const ProvisionTenantWorkflow = workflow('tenant.provision-workflow.v1', {
  input: type({ tenantId: 'string', requestId: 'string' }),
  output: type({ endpoint: 'string' }),
});

describe('v0.5 durable task and workflow contracts', () => {
  it('declares an optionless function-native durable workflow without placeholder options', () => {
    const platform = app('optionless-function-native-workflow');
    const greet = platform.workflow(
      'tenant.greet.v1',
      {
        input: type({ tenantId: 'string' }),
        output: type({ message: 'string' }),
      },
      async ({ tenantId }) => ({ message: `Hello, ${tenantId}` }),
    );

    expect(greet.definition.id).toBe('tenant.greet.v1');
    expect(applicationGraphFor(platform.composition)?.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'workflow',
          name: 'tenant.greet.v1',
        }),
        expect.objectContaining({
          kind: 'workflowHandler',
          name: 'tenant.greet.v1',
        }),
      ]),
    );
  });

  it('declares a function-native workflow contract and implementation once', () => {
    const platform = app('function-native-workflow');
    const provision = platform.workflow(
      'tenant.provision-native.v1',
      {
        input: type({ tenantId: 'string', requestId: 'string' }),
        output: type({ endpoint: 'string' }),
      },
      {
        retries: 3,
        idempotencyKey: ({ requestId }) => requestId,
      },
      async ({ tenantId }) => ({ endpoint: `https://${tenantId}.example.test` }),
    );

    expect(provision.definition.id).toBe('tenant.provision-native.v1');
    expect(applicationGraphFor(platform.composition)?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'workflow', name: 'tenant.provision-native.v1' }),
      expect.objectContaining({ kind: 'task', name: 'tenant.provision-native.v1.step' }),
      expect.objectContaining({ kind: 'workflowHandler', name: 'tenant.provision-native.v1' }),
    ]));
  });

  it('lowers one function-native workflow body into an internal retryable step', () => {
    const platform = app('single-step-workflow');
    const provision = platform.workflow(ProvisionTenantWorkflow, {
      retries: 3,
      idempotencyKey: ({ requestId }) => requestId,
    }, async ({ tenantId }) => ({ endpoint: `https://${tenantId}.example.test` }));

    expect(provision.kind).toBe('applicationWorkflow');
    const graph = applicationGraphFor(platform.composition);
    expect(graph?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'workflow', name: 'tenant.provision-workflow.v1' }),
      expect.objectContaining({ kind: 'task', name: 'tenant.provision-workflow.v1.step' }),
      expect.objectContaining({
        kind: 'taskHandler',
        name: 'tenant.provision-workflow.v1.step',
        retry: expect.objectContaining({ maxAttempts: 4 }),
      }),
      expect.objectContaining({
        kind: 'workflowHandler',
        name: 'tenant.provision-workflow.v1',
        taskBindings: [{ alias: 'run', task: { nodeId: 'task.tenant.provision-workflow.v1.step' } }],
      }),
    ]));
  });

  it('captures exact actor protocol calls as durable task dependencies', () => {
    const platform = app('actor-workflow');
    const Activity = platform.actor('activity.v1', {
      key: type('string'),
      state: type({ count: 'number.integer >= 0' }),
      protocol: {
        snapshot: actor.command({ input: type({}), output: type({ count: 'number.integer >= 0' }) }),
        record: actor.message(type({ at: 'string' })),
        expire: actor.alarm(type({ revision: 'number.integer >= 0' })),
      },
    });
    Activity.on.initialize(() => ({ count: 0 }));
    Activity.on.snapshot(async current => current.state());
    Activity.on.record(async () => undefined);
    Activity.on.expire(async () => undefined);
    platform.workflow(
      'activity.digest.v1',
      { input: type({ id: 'string' }), output: type({ count: 'number.integer >= 0' }) },
      {
        __generatedCalls: [Activity.snapshot, Activity.record.send, Activity.alarms.expire.schedule],
        __generatedBindings: {
          'Activity.snapshot': Activity.snapshot,
          'Activity.record.send': Activity.record.send,
          'Activity.alarms.expire.schedule': Activity.alarms.expire.schedule,
        },
      },
      async () => ({ count: 0 }),
    );

    const graph = applicationGraphFor(platform.composition);
    expect(graph?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'taskHandler',
        name: 'activity.digest.v1.step',
        actors: [
          { alias: 'Activity.alarms.expire.schedule', actor: { nodeId: 'actor.activity.v1' }, member: 'expire', memberKind: 'alarm' },
          { alias: 'Activity.record.send', actor: { nodeId: 'actor.activity.v1' }, member: 'record', memberKind: 'message' },
          { alias: 'Activity.snapshot', actor: { nodeId: 'actor.activity.v1' }, member: 'snapshot', memberKind: 'command' },
        ],
      }),
    ]));
    expect(graph?.edges).toEqual(expect.arrayContaining([
      { from: { nodeId: 'task-handler.activity.digest.v1.step' }, to: { nodeId: 'actor.activity.v1' }, relationship: 'dependsOn' },
    ]));
    if (!graph) throw new Error('Expected actor workflow graph.');
    expect(validateApplicationGraphStructure(graph)).toEqual([]);
  });

  it('infers one atomic model transaction for a durable workflow step', () => {
    const platform = app('function-native-workflow-models');
    const records = pgTable('workflow_native_records', {
      id: text('id').primaryKey(),
      body: text('body').notNull(),
    });
    const database = platform.database.postgres('records', {
      schema: { records },
    });
    const RecordModel = platform.model(records, {
      name: 'Record',
      database,
    });
    const RecordChanged = event('records.changed.v1', {
      payload: type({ id: 'string', body: 'string' }),
    });
    platform.workflow(
      'records.edit.v1',
      {
        input: type({ id: 'string', body: 'string' }),
        output: type({ id: 'string' }),
      },
      {
        __generatedCalls: [
          RecordModel.edit,
          RecordModel.require,
          RecordChanged.emit,
        ],
        __generatedBindings: {
          'RecordModel.edit': RecordModel.edit,
          'RecordModel.require': RecordModel.require,
          'RecordChanged.emit': RecordChanged.emit,
        },
      },
      async (input) => ({ id: input.id }),
    );

    const graph = applicationGraphFor(platform.composition);
    expect(graph?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'taskHandler',
        name: 'records.edit.v1.step',
        functionNativeTransaction: expect.objectContaining({
          primaryModel: { nodeId: 'model.record' },
          models: [{ nodeId: 'model.record' }],
          outbox: [{ nodeId: 'event.records.changed.v1' }],
          idempotency: 'durable-task-invocation',
        }),
      }),
    ]));
    expect(graph?.edges).toEqual(expect.arrayContaining([
      {
        from: { nodeId: 'task-handler.records.edit.v1.step' },
        to: { nodeId: 'model.record' },
        relationship: 'dependsOn',
      },
      {
        from: { nodeId: 'task-handler.records.edit.v1.step' },
        to: { nodeId: 'event.records.changed.v1' },
        relationship: 'emits',
      },
    ]));
    if (!graph) throw new Error('Expected function-native workflow graph.');
    expect(validateApplicationGraphStructure(graph)).toEqual([]);
  });

  it('records provider-neutral contracts, Hatchet bindings, workers, and deterministic orchestration boundaries', () => {
    const platform = app('workflow-platform', { namespace: 'workflow-system' });
    platform.provide(WorkflowEngine, WorkflowEngine.hatchet({
      name: 'workflow-hatchet',
      namespace: 'workflow-system',
      workerTokenSecret: { apiVersion: 'v1', kind: 'Secret', name: 'workflow-hatchet-worker', namespace: 'workflow-system' },
      worker: { replicas: 2, taskSlots: 8, durableSlots: 32 },
    }));
    const provision = platform.workflow(ProvisionTenant, {
      retries: 4,
      executionTimeoutSeconds: 120,
      idempotencyKey: (input) => input.requestId,
    }, async (input) => ({ endpoint: `https://${input.tenantId}.example.test` }));
    const onboarding = platform.workflow('tenant.onboarding.v1', {
      input: type({ tenantId: 'string', requestId: 'string' }),
      output: type({ endpoint: 'string', approved: 'boolean' }),
    }, {
      crons: [{ name: 'daily-onboarding', expression: '0 4 * * *', input: { tenantId: 'scheduled', requestId: 'daily' } }],
      worker: { replicas: 2, taskSlots: 8, durableSlots: 32, gracefulShutdownSeconds: 45, healthPort: 8081 },
      __generatedCalls: [provision],
      __generatedBindings: { provision },
    }, async (input) => ({
      endpoint: (
        await provision(input, {
          idempotencyKey: `${input.requestId}:provision`,
        })
      ).endpoint,
      approved: true,
    }));

    const graph = applicationGraphFor(platform.composition);
    expect(graph).toBeDefined();
    expect(graph?.metadata.namespace).toBe('workflow-system');
    expect(graph?.compatibility.stablePublicApis).toEqual(expect.arrayContaining(['workflow', 'app.workflow', 'provider.WorkflowEngine']));
    expect(graph?.compatibility.stablePublicApis).not.toEqual(expect.arrayContaining(['task', 'app.task']));
    expect(graph?.compatibility.postV3Surfaces).not.toContain('generic-workflow-orchestration');
    expect(graph?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'task', name: 'tenant.provision.v1.step', contract: expect.objectContaining({ version: 'v1', errors: [expect.objectContaining({ name: 'providerUnavailable' })] }) }),
      expect.objectContaining({ kind: 'taskHandler', effectBoundary: 'externalEffectsAllowed', retry: expect.objectContaining({ mode: 'boundedExponentialBackoff', maxAttempts: 5, initialDelayMs: 1_000, factor: 2 }), idempotency: expect.objectContaining({ required: true, guarantee: 'atLeastOnceRetrySafe' }) }),
      expect.objectContaining({ kind: 'workflow', name: 'tenant.onboarding.v1', triggers: { crons: [{ name: 'daily-onboarding', expression: '0 4 * * *', input: { tenantId: 'scheduled', requestId: 'daily' } }] }, contract: expect.objectContaining({ signals: [] }) }),
      expect.objectContaining({ kind: 'workflowHandler', orchestrationBoundary: 'durableEffectsThroughTasks', childWorkflowBindings: [{ alias: 'provision', workflow: { nodeId: 'workflow.tenant.provision.v1' } }], deterministicOperations: expect.arrayContaining(['sleep', 'externalEvent', 'cancellation']) }),
      expect.objectContaining({ kind: 'workflowWorker', runtime: 'node', lifecycle: 'longLived', deployment: expect.objectContaining({ replicas: 2, taskSlots: 8, durableSlots: 32, gracefulShutdownSeconds: 45, healthPort: 8081, egress: 'allowAll' }) }),
      expect.objectContaining({ kind: 'provider', interface: 'WorkflowEngine', implementation: 'hatchet', config: expect.objectContaining({ chartVersion: '0.13.3', serverVersion: 'v0.94.10' }) }),
    ]));
    expect(graph?.providerRequirements).toEqual(expect.arrayContaining([expect.objectContaining({ interface: 'WorkflowEngine', purpose: 'workflowEngine' })]));
    expect(graph?.providerBindings).toEqual(expect.arrayContaining([expect.objectContaining({
      generatedResources: expect.arrayContaining([
        expect.objectContaining({ kind: 'Cluster', name: 'workflow-hatchet-db' }),
        expect.objectContaining({ kind: 'HelmRelease', name: 'hatchet' }),
      ]),
      runtime: expect.objectContaining({
        env: {
          HATCHET_CLIENT_API_URL: 'http://hatchet-api.workflow-system.svc:8080',
          HATCHET_CLIENT_HOST_PORT: 'hatchet-engine.workflow-system.svc:7070',
        },
        secretRefs: [expect.objectContaining({ name: 'workflow-hatchet-worker' })],
      }),
    })]));
    if (!graph) throw new Error('Expected workflow graph.');
    expect(validateApplicationGraphStructure(graph)).toEqual([]);
    expect(onboarding.kind).toBe('applicationWorkflow');
  });

  it('delegates app-bound handles to the selected runtime and preserves invocation metadata', async () => {
    const calls: unknown[] = [];
    // typecast: the fake runtime returns the generic caller-selected output without coupling the fixture to one contract.
    const restore = setApplicationWorkflowRuntimeFactory(async () => ({
      async run(contract, input, metadata, result) {
        calls.push({ operation: 'run', contract, input, metadata, result });
        // typecast: the generic fake returns the caller-selected test output.
        return { endpoint: 'https://tenant-a.example.test' } as never;
      },
      async start() {
        return { id: 'run-1', __idempotencyKey: 'request-2', async result() {
          // typecast: the generic fake returns the caller-selected test output.
          return { endpoint: 'unused' } as never;
        }, async observe() {
          return {
            phase: 'Running' as const,
            admittedAt: '2026-07-31T12:00:00.000Z',
          };
        }, async cancel() {} };
      },
      async schedule() { return { id: 'scheduled-1' }; },
      async reconcileSchedule(_contract, schedule) { return { id: schedule.id, revision: schedule.revision, state: 'unchanged' }; },
      async signal(contract, runId, signal, payload, metadata) { calls.push({ operation: 'signal', contract, runId, signal, payload, metadata }); },
    }));
    try {
      const platform = app('runtime-platform');
    const provision = platform.workflow(ProvisionTenant, { idempotencyKey: (input) => input.requestId }, async () => ({ endpoint: 'unused' }));
      await provision({ tenantId: 'tenant-a', requestId: 'request-1' }, { correlationId: 'correlation-1' }, { timeoutMs: 12_000 });
      const started = await provision.start({
        tenantId: 'tenant-a',
        requestId: 'request-2',
      });
      expect(started.reference).toEqual({
        provider: 'workflow',
        workflow: 'tenant.provision.v1',
        run: 'run-1',
      });
      expect(started.workflowRevision).toBe('v1');
      expect(started.__idempotencyKey).toBe('request-2');
      await expect(started.observe()).resolves.toEqual({
        reference: started.reference,
        workflowRevision: 'v1',
        phase: 'Running',
        admittedAt: '2026-07-31T12:00:00.000Z',
      });
      expect(calls).toEqual([expect.objectContaining({
        operation: 'run',
        contract: 'tenant.provision.v1',
        metadata: { correlationId: 'correlation-1' },
        result: { timeoutMs: 12_000 },
      })]);
    } finally {
      restore();
    }
  });

  it('converges delayed workflow starts through Scheduler and preserves workflow-owned run admission', async () => {
    let reconcileRequest: {
      readonly definition: { readonly id: string };
      readonly instance: { readonly id: string; readonly at?: string | Date; readonly deleteAfterCompletion?: boolean };
      readonly handler: (input: { tenantId: string; requestId: string }, context: never) => Promise<{ readonly id: string }>;
      readonly management?: { readonly principalId: string; readonly authorizationReceiptId?: string };
    } | undefined;
    let removedInstance: { readonly definitionId: string; readonly instanceId: string } | undefined;
    const workflowCalls: unknown[] = [];
    const restoreSchedule = installApplicationScheduleRuntimeResolver(() => ({
      async invoke() { throw new Error('not used'); },
      async reconcile(request) {
        reconcileRequest = request as unknown as typeof reconcileRequest;
        return {
          definitionId: request.definition.id,
          instanceId: request.instance.id,
          revision: request.instance.revision,
          state: 'created',
        };
      },
      async remove(definitionId, instanceId) {
        removedInstance = { definitionId, instanceId };
        return { definitionId, instanceId, revision: 'removed', state: 'removed' };
      },
    }));
    const restoreWorkflow = setApplicationWorkflowRuntimeFactory(async () => ({
      async run() { throw new Error('not used'); },
      async start(contract, input, metadata) {
        workflowCalls.push({ contract, input, metadata });
        return {
          id: 'workflow-run-1',
          async result() { return { endpoint: 'unused' } as never; },
          async cancel() {},
        };
      },
      async schedule() { throw new Error('provider-native workflow scheduling must not be used'); },
      async reconcileSchedule() { throw new Error('provider-native workflow cron must not be used'); },
      async signal() {},
    }));
    const configurationAdmission = applicationAdmissionInvocationView(
      validateApplicationAdmissionContextV1WithoutReceipt(
        createApplicationAdmissionContextV1({
          admission: testApplicationAdmission('principal:configuration-admin', {
            authorityRevision: 'schedule-management-v1',
            trustedContext: { organizationId: 'organization-1' },
          }),
          operation: {
            id: 'applik8s://schedule-management/operations/configure',
            transport: 'direct',
          },
          correlationId: 'schedule-management-correlation-1',
        }),
        { now: Date.parse('2026-01-01T00:00:00.000Z') },
      ),
    );
    const restoreAdmission = installApplicationInvocationAdmissionResolver(
      () => configurationAdmission,
    );
    try {
      const platform = app('scheduled-runtime-platform');
      const provision = platform.workflow(
        ProvisionTenant,
        { idempotencyKey: (input) => input.requestId },
        async () => ({ endpoint: 'unused' }),
      );
      const at = new Date('2026-09-01T12:00:00.000Z');
      const scheduled = await provision.schedule(
        { tenantId: 'tenant-a', requestId: 'request-1' },
        at,
        { idempotencyKey: 'caller-key' },
      );
      expect(scheduled.id).toMatch(/^start-[a-f0-9]{64}$/u);
      expect(reconcileRequest).toMatchObject({
        definition: { id: 'workflow-start.tenant.provision.v1' },
        instance: {
          id: scheduled.id,
          at: at.toISOString(),
          deleteAfterCompletion: true,
        },
        management: {
          principalId: 'principal:configuration-admin',
          authorityRevision: 'schedule-management-v1',
          correlationId: 'schedule-management-correlation-1',
        },
      });
      const admission = applicationScheduleInvocationAdmission({
        applicationId: 'scheduled-runtime-platform',
        environmentId: 'test',
        definitionId: 'workflow-start.tenant.provision.v1',
        instanceId: scheduled.id,
        occurrenceId: 'occurrence-1',
        admittedAt: at.toISOString(),
        maximumAgeSeconds: 21_600,
        trigger: 'schedule',
      });
      const result = await reconcileRequest?.handler(
        { tenantId: 'tenant-a', requestId: 'request-1' },
        {
          definitionId: 'workflow-start.tenant.provision.v1',
          instanceId: scheduled.id,
          occurrenceId: 'occurrence-1',
          scheduledAt: at.toISOString(),
          admittedAt: at.toISOString(),
          startedAt: at.toISOString(),
          attempt: 1,
          trigger: 'schedule',
          admission,
          signal: new AbortController().signal,
        } as never,
      );
      expect(result).toEqual({ id: 'workflow-run-1' });
      expect(workflowCalls).toEqual([expect.objectContaining({
        contract: 'tenant.provision.v1',
        input: { tenantId: 'tenant-a', requestId: 'request-1' },
        metadata: expect.objectContaining({
          idempotencyKey: 'occurrence-1',
          correlationId: 'occurrence-1',
          causationId: 'occurrence-1',
        }),
      })]);
      await expect(provision.reconcile({
        id: 'tenant-daily',
        expression: '0 4 * * *',
        revision: 'revision-1',
        enabled: true,
        input: { tenantId: 'tenant-a', requestId: 'daily' },
      })).resolves.toEqual({
        id: 'tenant-daily',
        revision: 'revision-1',
        state: 'created',
      });
      expect(reconcileRequest).toMatchObject({
        definition: { id: 'workflow-start.tenant.provision.v1' },
        instance: {
          id: expect.stringMatching(/^recurring-[a-f0-9]{64}$/u),
          revision: 'revision-1',
          cron: '0 4 * * *',
          input: { tenantId: 'tenant-a', requestId: 'daily' },
        },
      });
      await expect(provision.reconcile({
        id: 'tenant-daily',
        expression: '0 4 * * *',
        revision: 'revision-2',
        enabled: false,
        input: { tenantId: 'tenant-a', requestId: 'daily' },
      })).resolves.toEqual({
        id: 'tenant-daily',
        revision: 'revision-2',
        state: 'removed',
      });
      expect(removedInstance).toEqual({
        definitionId: 'workflow-start.tenant.provision.v1',
        instanceId: expect.stringMatching(/^recurring-[a-f0-9]{64}$/u),
      });
    } finally {
      restoreAdmission();
      restoreWorkflow();
      restoreSchedule();
    }
  });

  it('rejects ambient external effects in durable orchestration while allowing them in tasks', () => {
    const platform = app('unsafe-workflow');
    expect(() => platform.workflow('tenant.unsafe.v1', {
      input: type({ tenantId: 'string' }),
      output: type({ endpoint: 'string', approved: 'boolean' }),
    }, async (input) => {
      await fetch(`https://example.test/${input.tenantId}`);
      return { endpoint: 'unsafe', approved: false };
    })).toThrow(/Move external effects into context\.step/);
  });

  it('accepts runtime-serialized task handlers with multiple variable declarators', () => {
    const platform = app('multi-declarator-task');
    expect(() => platform.workflow(ProvisionTenant, {}, async (input) => {
      const endpoint = `https://${input.tenantId}.example.test`;
      const response = { endpoint };
      return response;
    })).not.toThrow();
  });

  it('injects only explicitly required schema-bound task capabilities', () => {
    const platform = app('generation-platform', { namespace: 'generation-system' });
    platform.provide(WorkflowEngine, WorkflowEngine.hatchet({ namespace: 'generation-system' }));
    platform.provide(StructuredGenerationProvider, StructuredGeneration.deterministic({ output: { endpoint: 'https://generated.example.test' }, inputUnits: 4, outputUnits: 2 }));
    platform.workflow(
      ProvisionTenant,
      { requires: [StructuredGeneration] },
      async (input) => ({
        endpoint: `https://${input.tenantId}.example.test`,
      }),
    );
    const graph = applicationGraphFor(platform.composition);
    expect(graph?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'provider', interface: 'StructuredGeneration', implementation: 'structured-generation-deterministic' }),
      expect.objectContaining({ kind: 'taskHandler', capabilities: [{ interface: 'StructuredGeneration', nodeId: 'provider.structured-generation' }] }),
    ]));
    expect(graph?.providerRequirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ interface: 'StructuredGeneration', purpose: 'taskCapability', required: true }),
    ]));
    if (!graph) throw new Error('Expected generation graph.');
    expect(validateApplicationGraphStructure(graph)).toEqual([]);
  });

  it('selects a task capability from typed installation state without changing handler code', () => {
    const platform = app('selected-generation', {
      apiVersion: 'applications.example.test/v1alpha1',
      kind: 'SelectedGenerationInstallation',
      spec: type({ profile: "'starter' | 'external'", endpoint: 'string', secretName: 'string' }),
      status: type({ ready: 'boolean' }),
      namespace: (spec) => spec.profile,
    });
    platform.provide(WorkflowEngine, WorkflowEngine.hatchet({ namespace: platform.installation.spec.profile }));
    platform.provide(StructuredGenerationProvider, platform.selectProvider(platform.installation.spec.profile, {
      external: StructuredGeneration.http({
        endpoint: platform.installation.spec.endpoint,
        credentialSecret: { apiVersion: 'v1', kind: 'Secret', name: platform.installation.spec.secretName, namespace: platform.installation.spec.profile },
      }),
      default: StructuredGeneration.deterministic({ output: { endpoint: 'https://local.example.test' } }),
    }));
    platform.workflow(
      ProvisionTenant,
      { requires: [StructuredGeneration] },
      async (input) => ({
        endpoint: `https://${input.tenantId}.example.test`,
      }),
    );

    const graph = applicationGraphFor(platform.composition);
    const provider = graph?.nodes.find((node) => node.kind === 'provider' && node.interface === 'StructuredGeneration');
    expect(provider).toMatchObject({
      implementation: 'application-provider-selection',
      config: {
        kind: 'application-provider-selection',
        selector: 'schema.spec.profile',
        cases: { external: { kind: 'structured-generation-http', endpoint: '${schema.spec.endpoint}' } },
        default: { kind: 'structured-generation-deterministic', output: { endpoint: 'https://local.example.test' } },
      },
    });
    if (!graph) throw new Error('Expected selected generation graph.');
    expect(validateApplicationGraphStructure(graph)).toEqual([]);
  });

  it('injects selected typed model operations and bounded views under a compiler-bound service principal', () => {
    const platform = app('task-operation-platform', { namespace: 'task-operation-system' });
    platform.provide(WorkflowEngine, WorkflowEngine.hatchet({ namespace: 'task-operation-system' }));
    const records = pgTable('task_operation_records', {
      id: text('id').primaryKey(),
      body: text('body').notNull(),
      revision: text('revision').notNull().default(''),
    });
    const Database = platform.database.postgres('records', { schema: { records } });
    const RecordModel = platform.model(records, { name: 'Record', database: Database }).view('recent', {
      input: type({ limit: 'number.integer >= 1' }),
      output: type({ id: 'string', body: 'string' }).array(),
      database: Database,
      authorize: () => true,
      run: async () => [],
    });
    RecordModel.create.beforeCommit({ history: true }, async () => undefined);
    platform.gateway('task-context', {
      queries: [RecordModel.recent],
      deployment: {
        namespace: 'task-operation-system',
        cursorSecret: { name: 'task-context-authority', key: 'key' },
        authenticate: async () => testApplicationAdmission('browser', { authorityRevision: 'records-v1' }),
      },
    });
    const WriteRecord = workflow('records.write.v1', {
      input: type({ id: 'string', body: 'string' }),
      output: type({ identity: 'string' }),
    });
    platform.workflow(WriteRecord, {
      operations: { create: RecordModel.create.all() },
      queries: { recent: RecordModel.recent },
      principal: (input) => ({ id: `writer:${input.id}`, claims: { role: 'record-writer' }, authorizationVersion: 'records-v1' }),
    }, async (input, context) => {
      await context.queries.recent({ limit: 5 });
      const result = await context.operations.create(input);
      return { identity: result.identity };
    });

    const graph = applicationGraphFor(platform.composition);
    expect(graph?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'taskHandler',
        operations: [expect.objectContaining({
          alias: 'create',
          command: { nodeId: 'command.models.record.create.v1' },
          handler: { nodeId: 'command-handler.record-models.record.create.v1' },
          authority: expect.objectContaining({
            operationId: 'applik8s://models/Record/operations/create',
            restrictions: { target: { kind: 'all' }, predicates: [] },
          }),
        })],
        queries: [{ alias: 'recent', query: { nodeId: 'query.Record.recent' } }],
        operationPrincipalSource: expect.stringContaining('record-writer'),
      }),
    ]));
    expect(graph?.edges).toContainEqual({ from: { nodeId: 'task-handler.records.write.v1.step' }, to: { nodeId: 'command.models.record.create.v1' }, relationship: 'writes' });
    expect(graph?.edges).toContainEqual({ from: { nodeId: 'task-handler.records.write.v1.step' }, to: { nodeId: 'query.Record.recent' }, relationship: 'reads' });
    if (!graph) throw new Error('Expected task-operation graph.');
    expect(validateApplicationGraphStructure(graph)).toEqual([]);
  });

  it('injects a bounded generation rebuild without exposing Valkey or S3 in task code', () => {
    const platform = app('projection-rebuild-platform', { namespace: 'rebuild-system' });
    platform.provide(WorkflowEngine, WorkflowEngine.hatchet({ namespace: 'rebuild-system' }));
    platform.provide(IndexStore, IndexStore.valkey({ name: 'online', namespace: 'rebuild-system', host: 'online.rebuild-system.svc', provision: false }));
    platform.provide(ObjectStorage, ObjectStorage.s3({
      name: 'artifacts', bucket: 'projection-artifacts', region: 'us-east-1', endpoint: 'http://objects.rebuild-system.svc',
      credentialsSecret: { apiVersion: 'v1', kind: 'Secret', name: 'projection-artifacts', namespace: 'rebuild-system' },
    }));
    const records = pgTable('rebuild_records', { id: text('id').primaryKey() });
    const database = platform.database.postgres('records', { schema: { records } });
    const RecordModel = platform.model(records, { name: 'RebuildRecord', database });
    const Changed = event('records.changed.v1', { payload: type({ id: 'string', score: 'number' }) });
    const changes = platform.stream(Changed, { database, retention: { maxAgeSeconds: 86_400 }, partitionBy: ({ id }) => id, authorize: () => false });
    const timeline = changes.project('timeline', {
      store: IndexStore,
      output: type({ id: 'string', score: 'number' }),
      map: (payload) => payload,
      partitionBy: () => 'all', key: ({ id }) => id, score: ({ score }) => score, value: (row) => row,
      retention: { maxItemsPerPartition: 1_000 }, generationScoped: true,
      rebuild: { source: RecordModel, map: ({ id }) => ({ id, score: 0 }), checkpoint: 'durable' },
    });
    const artifacts = platform.objectStore('projection-artifacts', {
      mode: 'immutable', maxObjectBytes: 4_000_000,
      contentTypes: ['application/vnd.applik8s.projection-segment+json', 'application/vnd.applik8s.projection-rebuild+json'],
    });
    const Rebuild = workflow('records.rebuild.v1', { input: type({ generation: 'string' }), output: type({ generation: 'string', watermark: 'number.integer >= 0' }) });
    platform.workflow(Rebuild, {
      projections: { timeline: { projection: timeline, artifacts, bounds: { batchSize: 250, maxSegments: 1_000 } } },
    }, async (input, context) => {
      const rebuilt = await context.projections.timeline.rebuild({ generation: input.generation });
      return { generation: rebuilt.generation, watermark: rebuilt.publishedWatermark };
    });

    const graph = applicationGraphFor(platform.composition);
    expect(graph?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'taskHandler',
        projections: [expect.objectContaining({
          alias: 'timeline', projection: { nodeId: 'projection.timeline' }, artifacts: { nodeId: 'objectStore.projection-artifacts' },
          bounds: expect.objectContaining({ batchSize: 250, maxSegments: 1_000, maxSegmentBytes: 4_000_000 }),
        })],
      }),
    ]));
    expect(graph?.edges).toContainEqual({ from: { nodeId: 'task-handler.records.rebuild.v1.step' }, to: { nodeId: 'projection.timeline' }, relationship: 'writes' });
    expect(graph?.edges).toContainEqual({ from: { nodeId: 'task-handler.records.rebuild.v1.step' }, to: { nodeId: 'objectStore.projection-artifacts' }, relationship: 'writes' });
    expect(graph?.edges).toContainEqual({ from: { nodeId: 'projection.timeline' }, to: { nodeId: 'model.rebuild-record' }, relationship: 'reads' });
    if (!graph) throw new Error('Expected projection rebuild graph.');
    expect(validateApplicationGraphStructure(graph)).toEqual([]);
  });

  it('infers direct projection rebuilds and framework-owned evidence storage', () => {
    const platform = app('direct-projection-rebuild', { namespace: 'rebuild-system' });
    platform.provide(WorkflowEngine, WorkflowEngine.hatchet({ namespace: 'rebuild-system' }));
    platform.provide(IndexStore, IndexStore.valkey({ name: 'online', namespace: 'rebuild-system', host: 'online.rebuild-system.svc', provision: false }));
    platform.provide(ObjectStorage, ObjectStorage.s3({
      name: 'artifacts', bucket: 'projection-artifacts', region: 'us-east-1', endpoint: 'http://objects.rebuild-system.svc',
      credentialsSecret: { apiVersion: 'v1', kind: 'Secret', name: 'projection-artifacts', namespace: 'rebuild-system' },
    }));
    const records = pgTable('direct_rebuild_records', { id: text('id').primaryKey() });
    const database = platform.database.postgres('records', { schema: { records } });
    const RecordModel = platform.model(records, { name: 'DirectRebuildRecord', database });
    const Changed = event('direct-records.changed.v1', { payload: type({ id: 'string', score: 'number' }) });
    const changes = platform.stream(Changed, { database, retention: { maxAgeSeconds: 86_400 }, partitionBy: ({ id }) => id, authorize: () => false });
    const timeline = changes
      .project(type({ id: 'string', score: 'number' }), function directTimeline(payload, output) {
        return output.upsert({ partition: 'all', key: payload.id, score: payload.score, value: payload });
      })
      .rebuildFrom(RecordModel, ({ id }, rebuild) => rebuild.source({ id, score: 0 }))
      .retain({ maxItemsPerPartition: 1_000 });

    platform.workflow(
      'direct-records.rebuild.v1',
      {
        input: type({ generation: 'string' }),
        output: type({ generation: 'string' }),
      },
      {
        retries: 1,
        __generatedCalls: [timeline],
      },
      async ({ generation }) => ({ generation }),
    );

    const graph = applicationGraphFor(platform.composition);
    expect(graph?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'taskHandler',
        projections: [expect.objectContaining({
          alias: 'direct-timeline',
          projection: { nodeId: 'projection.direct-timeline' },
          artifacts: { nodeId: 'objectStore.direct-timeline-rebuild-artifacts' },
          bounds: expect.objectContaining({
            batchSize: 500,
            maxSegments: 20_000,
            maxSegmentBytes: 8_000_000,
            maxEvents: 10_000_000,
            maxCatchUpRounds: 32,
          }),
        })],
      }),
    ]));
    expect(graph?.edges).toContainEqual({
      from: { nodeId: 'task-handler.direct-records.rebuild.v1.step' },
      to: { nodeId: 'objectStore.direct-timeline-rebuild-artifacts' },
      relationship: 'writes',
    });
    if (!graph) throw new Error('Expected direct projection rebuild graph.');
    expect(validateApplicationGraphStructure(graph)).toEqual([]);
  });

	it('injects only explicitly declared bounded object stores into tasks', () => {
		const platform = app('task-object-platform', { namespace: 'task-object-system' });
		platform.provide(WorkflowEngine, WorkflowEngine.hatchet({ namespace: 'task-object-system' }));
		platform.provide(ObjectStorage, ObjectStorage.s3({
			name: 'media', bucket: 'media', region: 'us-east-1', endpoint: 'http://objects.task-object-system.svc',
			credentialsSecret: { apiVersion: 'v1', kind: 'Secret', name: 'media-credentials', namespace: 'task-object-system' },
		}));
		const attachments = platform.objectStore('attachments', {
			mode: 'immutable', maxObjectBytes: 1_000_000, contentTypes: ['image/png'], deletion: 'explicit',
		});
		const Inspect = workflow('media.inspect.v1', { input: type({ key: 'string' }), output: type({ bytes: 'number.integer >= 0' }) });
		platform.workflow(Inspect, { objects: { attachments } }, async ({ key }, context) => {
			const value = await context.objects.attachments.get(key);
			return { bytes: value?.byteLength ?? 0 };
		});

		const graph = applicationGraphFor(platform.composition);
		expect(graph?.nodes).toEqual(expect.arrayContaining([
			expect.objectContaining({ kind: 'taskHandler', objects: [{ alias: 'attachments', store: { nodeId: 'objectStore.attachments' } }] }),
		]));
		expect(graph?.edges).toContainEqual({ from: { nodeId: 'task-handler.media.inspect.v1.step' }, to: { nodeId: 'objectStore.attachments' }, relationship: 'reads' });
		expect(graph?.edges).toContainEqual({ from: { nodeId: 'task-handler.media.inspect.v1.step' }, to: { nodeId: 'objectStore.attachments' }, relationship: 'writes' });
		if (!graph) throw new Error('Expected task object graph.');
		expect(validateApplicationGraphStructure(graph)).toEqual([]);
	});
});
