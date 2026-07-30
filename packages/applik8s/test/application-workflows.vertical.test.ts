import { app, applicationGraphFor, event, IndexStore, ObjectStorage, StructuredGeneration as StructuredGenerationProvider, setApplicationWorkflowRuntimeFactory, task, WorkflowEngine, workflow } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import { StructuredGeneration } from '@applik8s/applik8s/structured-generation';
import { validateApplicationGraphStructure } from '@applik8s/core';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { testApplicationAdmission } from '../../../test-support/application-principal.js';

const ProvisionTenant = task('tenant.provision.v1', {
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

describe('v0.5 durable task and workflow contracts', () => {
  it('records provider-neutral contracts, Hatchet bindings, workers, and deterministic orchestration boundaries', () => {
    const platform = app('workflow-platform', { namespace: 'workflow-system' });
    platform.provide(WorkflowEngine, WorkflowEngine.hatchet({
      name: 'workflow-hatchet',
      namespace: 'workflow-system',
      workerTokenSecret: { apiVersion: 'v1', kind: 'Secret', name: 'workflow-hatchet-worker', namespace: 'workflow-system' },
      worker: { replicas: 2, taskSlots: 8, durableSlots: 32 },
    }));
    const provision = platform.task(ProvisionTenant, {
      retries: 4,
      executionTimeoutSeconds: 120,
      idempotencyKey: (input) => input.requestId,
    }, async (input) => ({ endpoint: `https://${input.tenantId}.example.test` }));
    const onboarding = platform.workflow(TenantOnboarding, {
      tasks: { provision },
      crons: [{ name: 'daily-onboarding', expression: '0 4 * * *', input: { tenantId: 'scheduled', requestId: 'daily' } }],
      worker: { replicas: 2, taskSlots: 8, durableSlots: 32, gracefulShutdownSeconds: 45, healthPort: 8081 },
    }, async (input, context) => {
      const provisioned = await context.task('provision', input, { idempotencyKey: input.requestId });
      const approval = await context.waitFor('approval', { scope: context.invocationId });
      if (!approval.approved) context.fail('rejected', { reason: 'approval denied' });
      return { endpoint: provisioned.endpoint, approved: approval.approved };
    });

    const graph = applicationGraphFor(platform.composition);
    expect(graph).toBeDefined();
    expect(graph?.metadata.namespace).toBe('workflow-system');
    expect(graph?.compatibility.stablePublicApis).toEqual(expect.arrayContaining(['task', 'workflow', 'app.task', 'app.workflow', 'provider.WorkflowEngine']));
    expect(graph?.compatibility.postV3Surfaces).not.toContain('generic-workflow-orchestration');
    expect(graph?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'task', name: 'tenant.provision.v1', contract: expect.objectContaining({ version: 'v1', errors: [expect.objectContaining({ name: 'providerUnavailable' })] }) }),
      expect.objectContaining({ kind: 'taskHandler', effectBoundary: 'externalEffectsAllowed', retry: expect.objectContaining({ mode: 'boundedExponentialBackoff', maxAttempts: 5, initialDelayMs: 1_000, factor: 2 }), idempotency: expect.objectContaining({ required: true, guarantee: 'atLeastOnceRetrySafe' }) }),
      expect.objectContaining({ kind: 'workflow', name: 'tenant.onboarding.v1', triggers: { crons: [{ name: 'daily-onboarding', expression: '0 4 * * *', input: { tenantId: 'scheduled', requestId: 'daily' } }] }, contract: expect.objectContaining({ signals: [expect.objectContaining({ name: 'approval' })] }) }),
      expect.objectContaining({ kind: 'workflowHandler', orchestrationBoundary: 'durableEffectsThroughTasks', taskBindings: [{ alias: 'provision', task: { nodeId: 'task.tenant.provision.v1' } }], deterministicOperations: expect.arrayContaining(['sleep', 'externalEvent', 'cancellation']) }),
      expect.objectContaining({ kind: 'workflowWorker', runtime: 'node', lifecycle: 'longLived', deployment: expect.objectContaining({ replicas: 2, taskSlots: 8, durableSlots: 32, gracefulShutdownSeconds: 45, healthPort: 8081, egress: 'allowAll' }) }),
      expect.objectContaining({ kind: 'provider', interface: 'WorkflowEngine', implementation: 'hatchet', config: expect.objectContaining({ chartVersion: '0.13.3', serverVersion: 'v0.94.10' }) }),
    ]));
    expect(graph?.providerRequirements).toEqual(expect.arrayContaining([expect.objectContaining({ interface: 'WorkflowEngine', purpose: 'workflowEngine' })]));
    expect(graph?.providerBindings).toEqual(expect.arrayContaining([expect.objectContaining({ generatedResources: expect.arrayContaining([expect.objectContaining({ kind: 'HelmRepository' })]), runtime: expect.objectContaining({ secretRefs: [expect.objectContaining({ name: 'workflow-hatchet-worker' })] }) })]));
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
        return { id: 'run-1', async result() {
          // typecast: the generic fake returns the caller-selected test output.
          return { endpoint: 'unused' } as never;
        }, async cancel() {} };
      },
      async schedule() { return { id: 'scheduled-1' }; },
      async reconcileSchedule(_contract, schedule) { return { id: schedule.id, revision: schedule.revision, state: 'unchanged' }; },
      async signal(contract, runId, signal, payload, metadata) { calls.push({ operation: 'signal', contract, runId, signal, payload, metadata }); },
    }));
    try {
      const platform = app('runtime-platform');
      const provision = platform.task(ProvisionTenant, { idempotencyKey: (input) => input.requestId }, async () => ({ endpoint: 'unused' }));
      await provision.run({ tenantId: 'tenant-a', requestId: 'request-1' }, { correlationId: 'correlation-1' }, { timeoutMs: 12_000 });
      expect(calls).toEqual([expect.objectContaining({ operation: 'run', contract: 'tenant.provision.v1', metadata: expect.objectContaining({ idempotencyKey: 'request-1', correlationId: 'correlation-1' }), result: { timeoutMs: 12_000 } })]);
    } finally {
      restore();
    }
  });

  it('rejects ambient external effects in durable orchestration while allowing them in tasks', () => {
    const platform = app('unsafe-workflow');
    expect(() => platform.workflow(TenantOnboarding, { tasks: { ProvisionTenant } }, async (input) => {
      await fetch(`https://example.test/${input.tenantId}`);
      return { endpoint: 'unsafe', approved: false };
    })).toThrow(/Move external effects into declared app\.task/);
  });

  it('accepts runtime-serialized task handlers with multiple variable declarators', () => {
    const platform = app('multi-declarator-task');
    expect(() => platform.task(ProvisionTenant, {}, async (input) => {
      const endpoint = `https://${input.tenantId}.example.test`;
      const response = { endpoint };
      return response;
    })).not.toThrow();
  });

  it('injects only explicitly required schema-bound task capabilities', () => {
    const platform = app('generation-platform', { namespace: 'generation-system' });
    platform.provide(WorkflowEngine, WorkflowEngine.hatchet({ namespace: 'generation-system' }));
    platform.provide(StructuredGenerationProvider, StructuredGeneration.deterministic({ output: { endpoint: 'https://generated.example.test' }, inputUnits: 4, outputUnits: 2 }));
    platform.task(ProvisionTenant, { requires: [StructuredGeneration] }, async (input, context) => {
      const generated = await context.use(StructuredGeneration).generate({
        profile: 'test',
        input: { tenantId: input.tenantId },
        output: type({ endpoint: 'string' }),
        idempotencyKey: input.requestId,
        signal: context.signal,
      });
      return generated.value;
    });
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
    platform.task(ProvisionTenant, { requires: [StructuredGeneration] }, async (input, context) => (
      await context.use(StructuredGeneration).generate({
        profile: 'selected', input: { tenantId: input.tenantId }, output: type({ endpoint: 'string' }), idempotencyKey: input.requestId,
      })
    ).value);

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
    const WriteRecord = task('records.write.v1', {
      input: type({ id: 'string', body: 'string' }),
      output: type({ identity: 'string' }),
    });
    platform.task(WriteRecord, {
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
    expect(graph?.edges).toContainEqual({ from: { nodeId: 'task-handler.records.write.v1' }, to: { nodeId: 'command.models.record.create.v1' }, relationship: 'writes' });
    expect(graph?.edges).toContainEqual({ from: { nodeId: 'task-handler.records.write.v1' }, to: { nodeId: 'query.Record.recent' }, relationship: 'reads' });
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
    const Rebuild = task('records.rebuild.v1', { input: type({ generation: 'string' }), output: type({ generation: 'string', watermark: 'number.integer >= 0' }) });
    platform.task(Rebuild, {
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
    expect(graph?.edges).toContainEqual({ from: { nodeId: 'task-handler.records.rebuild.v1' }, to: { nodeId: 'projection.timeline' }, relationship: 'writes' });
    expect(graph?.edges).toContainEqual({ from: { nodeId: 'task-handler.records.rebuild.v1' }, to: { nodeId: 'objectStore.projection-artifacts' }, relationship: 'writes' });
    expect(graph?.edges).toContainEqual({ from: { nodeId: 'projection.timeline' }, to: { nodeId: 'model.rebuild-record' }, relationship: 'reads' });
    if (!graph) throw new Error('Expected projection rebuild graph.');
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
		const Inspect = task('media.inspect.v1', { input: type({ key: 'string' }), output: type({ bytes: 'number.integer >= 0' }) });
		platform.task(Inspect, { objects: { attachments } }, async ({ key }, context) => {
			const value = await context.objects.attachments.get(key);
			return { bytes: value?.byteLength ?? 0 };
		});

		const graph = applicationGraphFor(platform.composition);
		expect(graph?.nodes).toEqual(expect.arrayContaining([
			expect.objectContaining({ kind: 'taskHandler', objects: [{ alias: 'attachments', store: { nodeId: 'objectStore.attachments' } }] }),
		]));
		expect(graph?.edges).toContainEqual({ from: { nodeId: 'task-handler.media.inspect.v1' }, to: { nodeId: 'objectStore.attachments' }, relationship: 'reads' });
		expect(graph?.edges).toContainEqual({ from: { nodeId: 'task-handler.media.inspect.v1' }, to: { nodeId: 'objectStore.attachments' }, relationship: 'writes' });
		if (!graph) throw new Error('Expected task object graph.');
		expect(validateApplicationGraphStructure(graph)).toEqual([]);
	});
});
