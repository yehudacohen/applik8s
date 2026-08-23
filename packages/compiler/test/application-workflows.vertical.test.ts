// typecast-file-boundary: generated manifest fixtures inspect intentionally erased Kubernetes and workflow artifact trees after discriminator assertions.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  type ApplicationGraph,
  deriveApplicationGraphFoundation,
} from '@applik8s/core';
import { describe, expect, it } from 'vitest';
import { applicationProviderConsumerWorkloads } from '../src/application-deployment-graph.js';
import {
  applicationStaticAuthorityManifest,
  compileApplicationOperationCatalog,
  compileApplicationWorkloadAuthority,
} from '../src/application-operations/index.js';
import { workflowContract } from '../src/application-workflows/contracts.js';
import { applicationScheduleWorkflowGatewayCallers } from '../src/application-workflows/index.js';
import { workflowResources } from '../src/application-workflows/resources.js';
import {
  generatedHandlerModule,
  generatedWorkerSource,
  handlerModuleFile,
  nestedCallbackBindingsSource,
  taskServicePrincipalInput,
} from '../src/application-workflows/source.js';
import { compileTypeKroComposition, discoverApplicationGraph } from '../src/pipeline/index.js';

describe('v0.5 generated workflow lowering', () => {
  it('authorizes the ApplicationHost for only the workflow contracts targeted by shared schedules', () => {
    const graph = {
      metadata: { name: 'scheduled-workflows', namespace: 'workflow-system' },
      nodes: [
        {
          id: 'provider.application-host', kind: 'provider', name: 'ApplicationHost', stability: 'stable',
          interface: 'ApplicationHost', implementation: 'managed-application-host',
          config: { host: { name: 'scheduled-workflows-web', namespace: 'workflow-system', serviceAccountName: 'schedule-caller' } },
        },
        {
          id: 'provider.workflow-engine', kind: 'provider', name: 'WorkflowEngine', stability: 'stable',
          interface: 'WorkflowEngine', implementation: 'hatchet', config: { namespace: 'workflow-system' },
        },
        {
          id: 'provider.scheduler', kind: 'provider', name: 'Scheduler', stability: 'stable',
          interface: 'Scheduler', implementation: 'kubernetes-cronjob-scheduler', config: {},
        },
        {
          id: 'workflow.daily.v1', kind: 'workflow', name: 'daily.v1', stability: 'stable',
          contract: { name: 'daily', version: 'v1', input: { jsonSchema: { type: 'object' } }, output: { jsonSchema: { type: 'object' } }, errors: [], signals: [] },
          triggers: { crons: [] },
        },
        {
          id: 'workflow.private.v1', kind: 'workflow', name: 'private.v1', stability: 'stable',
          contract: { name: 'private', version: 'v1', input: { jsonSchema: { type: 'object' } }, output: { jsonSchema: { type: 'object' } }, errors: [], signals: [] },
          triggers: { crons: [] },
        },
        {
          id: 'workflow-handler.daily.v1', kind: 'workflowHandler', name: 'daily.v1', stability: 'stable',
          workflow: { nodeId: 'workflow.daily.v1' }, workflowEngine: { interface: 'WorkflowEngine', nodeId: 'provider.workflow-engine' },
          tasks: [], childWorkflows: [], taskBindings: [], childWorkflowBindings: [], handlerSource: 'async input => input',
          orchestrationBoundary: 'durableEffectsThroughTasks', deterministicOperations: ['task'], sourceAnalysis: 'closedWorkflowAllowlist',
        },
        {
          id: 'workflow-handler.private.v1', kind: 'workflowHandler', name: 'private.v1', stability: 'stable',
          workflow: { nodeId: 'workflow.private.v1' }, workflowEngine: { interface: 'WorkflowEngine', nodeId: 'provider.workflow-engine' },
          tasks: [], childWorkflows: [], taskBindings: [], childWorkflowBindings: [], handlerSource: 'async input => input',
          orchestrationBoundary: 'durableEffectsThroughTasks', deterministicOperations: ['task'], sourceAnalysis: 'closedWorkflowAllowlist',
        },
        {
          id: 'workflow-worker.scheduled', kind: 'workflowWorker', name: 'scheduled-worker', stability: 'stable',
          handlers: [{ nodeId: 'workflow-handler.daily.v1' }, { nodeId: 'workflow-handler.private.v1' }],
          workflowEngine: { interface: 'WorkflowEngine', nodeId: 'provider.workflow-engine' }, runtime: 'node', lifecycle: 'longLived',
          deployment: { replicas: 1, taskSlots: 4, durableSlots: 4, gracefulShutdownSeconds: 30, healthPort: 8080, egress: 'allowAll', scaling: { mode: 'fixed' } },
        },
        {
          id: 'schedule.daily', kind: 'schedule', name: 'daily', stability: 'stable',
          definition: { id: 'daily', configuration: 'fixed', cron: '0 4 * * *', timezone: 'UTC', overlap: 'skip', misfires: 'latest', maximumLatenessSeconds: 300, retry: { maxAttempts: 4, maximumAgeSeconds: 3600 }, requirements: { configuration: 'fixed', cardinality: 'bounded', precision: 'minute' } },
          scheduler: { interface: 'Scheduler', nodeId: 'provider.scheduler' },
          state: { interface: 'TransactionalDatabase', nodeId: 'provider.TransactionalDatabase' },
          target: { kind: 'durableStart', durable: { kind: 'workflow', nodeId: 'workflow.daily.v1' }, contract: { name: 'daily', version: 'v1', input: { jsonSchema: { type: 'object' } } }, input: { kind: 'literal', value: {} } },
          functionNative: true,
        },
      ],
      edges: [], providerRequirements: [], providerBindings: [],
    } as unknown as ApplicationGraph;
    const worker = graph.nodes.find((node) => node.kind === 'workflowWorker');
    if (worker?.kind !== 'workflowWorker') throw new Error('Expected workflow worker.');
    const callers = applicationScheduleWorkflowGatewayCallers(graph, worker);
    expect(callers).toEqual([{
      operator: 'scheduled-workflows-web',
      namespace: 'workflow-system',
      serviceAccount: 'schedule-caller',
      contracts: ['daily.v1'],
    }]);
    const source = generatedWorkerSource(
      workflowContract(graph, worker, undefined, [], callers),
    );
    expect(source).toContain("sourceAdmission.operation.transport !== 'schedule'");
    expect(source).toContain('{"namespace":"workflow-system","serviceAccount":"schedule-caller","contracts":["daily.v1"]}');
    expect(source).toContain('daily.v1');
  });

  it('authorizes a dedicated schedule-control worker when no web host exists', () => {
    const graph = {
      metadata: { name: 'scheduled-workflows', namespace: 'workflow-system' },
      nodes: [
        {
          id: 'provider.workflow-engine', kind: 'provider', name: 'WorkflowEngine', stability: 'stable',
          interface: 'WorkflowEngine', implementation: 'hatchet', config: { namespace: 'workflow-system' },
        },
        {
          id: 'provider.scheduler', kind: 'provider', name: 'Scheduler', stability: 'stable',
          interface: 'Scheduler', implementation: 'kubernetes-cronjob-scheduler', config: {},
        },
        {
          id: 'workflow.daily.v1', kind: 'workflow', name: 'daily.v1', stability: 'stable',
          contract: { name: 'daily', version: 'v1', input: { jsonSchema: { type: 'object' } }, output: { jsonSchema: { type: 'object' } }, errors: [], signals: [] },
          triggers: { crons: [] },
        },
        {
          id: 'workflow-handler.daily.v1', kind: 'workflowHandler', name: 'daily.v1', stability: 'stable',
          workflow: { nodeId: 'workflow.daily.v1' }, workflowEngine: { interface: 'WorkflowEngine', nodeId: 'provider.workflow-engine' },
          tasks: [], childWorkflows: [], taskBindings: [], childWorkflowBindings: [], handlerSource: 'async input => input',
          orchestrationBoundary: 'durableEffectsThroughTasks', deterministicOperations: ['task'], sourceAnalysis: 'closedWorkflowAllowlist',
        },
        {
          id: 'workflow-worker.scheduled', kind: 'workflowWorker', name: 'scheduled-worker', stability: 'stable',
          handlers: [{ nodeId: 'workflow-handler.daily.v1' }],
          workflowEngine: { interface: 'WorkflowEngine', nodeId: 'provider.workflow-engine' }, runtime: 'node', lifecycle: 'longLived',
          deployment: { replicas: 1, taskSlots: 4, durableSlots: 4, gracefulShutdownSeconds: 30, healthPort: 8080, egress: 'allowAll', scaling: { mode: 'fixed' } },
        },
        {
          id: 'schedule.daily', kind: 'schedule', name: 'daily', stability: 'stable',
          definition: { id: 'daily', configuration: 'fixed', cron: '0 4 * * *', timezone: 'UTC', overlap: 'skip', misfires: 'latest', maximumLatenessSeconds: 300, retry: { maxAttempts: 4, maximumAgeSeconds: 3600 }, requirements: { configuration: 'fixed', cardinality: 'bounded', precision: 'minute' } },
          scheduler: { interface: 'Scheduler', nodeId: 'provider.scheduler' },
          state: { interface: 'TransactionalDatabase', nodeId: 'provider.TransactionalDatabase' },
          target: { kind: 'durableStart', durable: { kind: 'workflow', nodeId: 'workflow.daily.v1' }, contract: { name: 'daily', version: 'v1', input: { jsonSchema: { type: 'object' } } }, input: { kind: 'literal', value: {} } },
          functionNative: true,
        },
      ],
      edges: [], providerRequirements: [], providerBindings: [],
    } as unknown as ApplicationGraph;
    const worker = graph.nodes.find((node) => node.kind === 'workflowWorker');
    if (worker?.kind !== 'workflowWorker') throw new Error('Expected workflow worker.');

    const callers = applicationScheduleWorkflowGatewayCallers(graph, worker);
    expect(callers).toEqual([{
      operator: 'scheduled-workflows-schedule-control',
      namespace: 'workflow-system',
      serviceAccount: 'scheduled-workflows-schedule-control',
      contracts: ['daily.v1'],
    }]);
    const source = generatedWorkerSource(
      workflowContract(graph, worker, undefined, [], callers),
    );
    expect(source).toContain(
      '{"namespace":"workflow-system","serviceAccount":"scheduled-workflows-schedule-control","contracts":["daily.v1"]}',
    );
    expect(source).not.toContain('private.v1');
  });

  it('does not authorize a phantom schedule-control caller for externally qualified schedules', () => {
    const graph = {
      metadata: { name: 'external-schedules', namespace: 'workflow-system' },
      nodes: [
        {
          id: 'provider.workflow-engine', kind: 'provider', name: 'WorkflowEngine', stability: 'stable',
          interface: 'WorkflowEngine', implementation: 'hatchet', config: { namespace: 'workflow-system' },
        },
        {
          id: 'provider.scheduler', kind: 'provider', name: 'Scheduler', stability: 'stable',
          interface: 'Scheduler', implementation: 'target-selected',
          config: { qualification: { name: 'external' } },
        },
        {
          id: 'workflow.daily.v1', kind: 'workflow', name: 'daily.v1', stability: 'stable',
          contract: { name: 'daily', version: 'v1', input: { jsonSchema: { type: 'object' } }, output: { jsonSchema: { type: 'object' } }, errors: [], signals: [] },
          triggers: { crons: [] },
        },
        {
          id: 'workflow-handler.daily.v1', kind: 'workflowHandler', name: 'daily.v1', stability: 'stable',
          workflow: { nodeId: 'workflow.daily.v1' }, workflowEngine: { interface: 'WorkflowEngine', nodeId: 'provider.workflow-engine' },
          tasks: [], childWorkflows: [], taskBindings: [], childWorkflowBindings: [], handlerSource: 'async input => input',
          orchestrationBoundary: 'durableEffectsThroughTasks', deterministicOperations: ['task'], sourceAnalysis: 'closedWorkflowAllowlist',
        },
        {
          id: 'workflow-worker.scheduled', kind: 'workflowWorker', name: 'scheduled-worker', stability: 'stable',
          handlers: [{ nodeId: 'workflow-handler.daily.v1' }],
          workflowEngine: { interface: 'WorkflowEngine', nodeId: 'provider.workflow-engine' }, runtime: 'node', lifecycle: 'longLived',
          deployment: { replicas: 1, taskSlots: 4, durableSlots: 4, gracefulShutdownSeconds: 30, healthPort: 8080, egress: 'allowAll', scaling: { mode: 'fixed' } },
        },
        {
          id: 'schedule.daily', kind: 'schedule', name: 'daily', stability: 'stable',
          definition: { id: 'daily', configuration: 'fixed', cron: '0 4 * * *', timezone: 'UTC', overlap: 'skip', misfires: 'latest', maximumLatenessSeconds: 300, retry: { maxAttempts: 4, maximumAgeSeconds: 3600 }, requirements: { configuration: 'fixed', cardinality: 'bounded', precision: 'minute' } },
          scheduler: { interface: 'Scheduler', nodeId: 'provider.scheduler' },
          state: { interface: 'TransactionalDatabase', nodeId: 'provider.TransactionalDatabase' },
          target: { kind: 'durableStart', durable: { kind: 'workflow', nodeId: 'workflow.daily.v1' }, contract: { name: 'daily', version: 'v1', input: { jsonSchema: { type: 'object' } } }, input: { kind: 'literal', value: {} } },
          functionNative: true,
        },
      ],
      edges: [], providerRequirements: [], providerBindings: [],
    } as unknown as ApplicationGraph;
    const worker = graph.nodes.find((node) => node.kind === 'workflowWorker');
    if (worker?.kind !== 'workflowWorker') throw new Error('Expected workflow worker.');
    expect(applicationScheduleWorkflowGatewayCallers(graph, worker)).toEqual([]);
  });

  it('hydrates direct actor calls through the authenticated application boundary', () => {
    const schema = { kind: 'declared', runtime: 'jsonSchema', jsonSchema: { type: 'object' } } as const;
    const graph = {
      apiVersion: 'applik8s.applicationGraph/v1alpha1',
      kind: 'ApplicationGraph',
      metadata: { name: 'actor-workflow-source', namespace: 'actor-workflow-source' },
      nodes: [
        { id: 'provider.workflow-engine', kind: 'provider', name: 'WorkflowEngine', stability: 'stable', interface: 'WorkflowEngine', implementation: 'hatchet', config: { provision: false, namespace: 'actor-workflow-source', hostPort: 'hatchet:7070', apiUrl: 'http://hatchet:8080', workerTokenSecret: { name: 'hatchet-worker' } } },
        { id: 'provider.application-host', kind: 'provider', name: 'ApplicationHost', stability: 'stable', interface: 'ApplicationHost', implementation: 'managed-application-host', config: { host: { kind: 'managed-application-host', name: 'actor-workflow-app', namespace: 'actor-workflow-source', port: 3000 } } },
        { id: 'actor.activity.v1', kind: 'actor', name: 'activity.v1', stability: 'experimental', definition: { id: 'activity.v1', key: schema, state: schema, stateVersion: 1, migrationDigest: 'sha256:test', migrations: [], protocol: [{ name: 'snapshot', kind: 'command', input: schema, output: schema }], requirements: { durableState: true, serializedTurns: true, transactionalOutbox: true, durableAlarms: false, realtimeConnections: false, connectionLeases: false, realtimeMessages: false, realtimeBroadcast: false } }, runtime: { interface: 'ActorRuntime', nodeId: 'provider.actor-runtime' }, handlers: [], semantics: { serialization: 'fullTurnPerIdentity', admission: 'idempotentReceipt', references: 'inertAddress' } },
        { id: 'task.activity.digest.v1.step', kind: 'task', name: 'activity.digest.v1.step', stability: 'stable', contract: { name: 'activity.digest.v1.step', version: 'v1', input: schema, output: schema, errors: [] } },
        { id: 'task-handler.activity.digest.v1.step', kind: 'taskHandler', name: 'activity.digest.v1.step', stability: 'stable', task: { nodeId: 'task.activity.digest.v1.step' }, workflowEngine: { interface: 'WorkflowEngine', nodeId: 'provider.workflow-engine' }, actors: [{ alias: 'Activity.snapshot', actor: { nodeId: 'actor.activity.v1' }, member: 'snapshot', memberKind: 'command' }], retry: { mode: 'boundedExponentialBackoff', maxAttempts: 4, initialDelayMs: 1000, maxDelayMs: 60000, factor: 2 }, executionTimeoutSeconds: 60, scheduleTimeoutSeconds: 300, idempotency: { required: true, keySource: 'invocation', guarantee: 'atLeastOnceRetrySafe' }, effectBoundary: 'externalEffectsAllowed', handlerSource: 'async input => Activity.snapshot(input.id, {})' },
        { id: 'workflow-worker.actor', kind: 'workflowWorker', name: 'actor-worker', stability: 'stable', handlers: [{ nodeId: 'task-handler.activity.digest.v1.step' }], workflowEngine: { interface: 'WorkflowEngine', nodeId: 'provider.workflow-engine' }, runtime: 'node', lifecycle: 'longLived', deployment: { replicas: 1, taskSlots: 16, durableSlots: 16, gracefulShutdownSeconds: 30, healthPort: 8001, egress: 'allowAll', scaling: { mode: 'fixed' } } },
      ],
      edges: [], providerRequirements: [], providerBindings: [],
    } as unknown as ApplicationGraph;
    const worker = graph.nodes.find((node) => node.kind === 'workflowWorker');
    if (worker?.kind !== 'workflowWorker') throw new Error('Expected workflow worker.');
    const operationCatalog = compileApplicationOperationCatalog(graph);
    const contract = workflowContract(
      graph,
      worker,
      operationCatalog,
      compileApplicationWorkloadAuthority(graph, operationCatalog),
    );
    const source = generatedWorkerSource(contract);
    const resources = workflowResources(contract, 'actor-worker', 'actor-worker:test', 'sha256:test', false);
    expect(contract.actorEffects?.actors).toHaveLength(1);
    expect(source).toContain('/__applik8s/v1/internal/actors/invoke');
    expect(source).toContain("transport: 'workflow'");
    expect(source).toContain('principal,');
    expect(source).toContain('APPLIK8S_ACTOR_APPLICATION_ENDPOINT');
    expect(source).toContain('workloadAuthorityId: workloadAuthority.id');
    expect(source).not.toContain("id: 'workflow-task:' + execution.invocationId");
    const deployment = resources.find((resource) => resource.kind === 'Deployment');
    expect(deployment?.spec).toMatchObject({ template: { spec: { containers: [expect.objectContaining({ env: expect.arrayContaining([
      { name: 'APPLIK8S_ACTOR_APPLICATION_ENDPOINT', value: 'http://actor-workflow-app.actor-workflow-source.svc:3000' },
      expect.objectContaining({ name: 'APPLIK8S_INTERNAL_OPERATION_SECRET' }),
    ]) })] } } });
  });
  it('lowers a task service identity by its authored subject exactly once', () => {
    expect(taskServicePrincipalInput({
      id: 'identity:workflow-model-edit:service:record-editor',
      kind: 'service',
      issuer: 'applik8s://workflow-model-edit',
      subject: 'record-editor',
    }, 'catalog-v1')).toEqual({
      id: 'record-editor',
      authorizationVersion: 'catalog-v1',
    });
  });

  it('hydrates arbitrarily nested module model bindings without flattening their public shape', () => {
    expect(
      nestedCallbackBindingsSource([
        {
          path: 'Artifacts.Artifact.create',
          value: 'execution.operations["Artifacts.Artifact.create"]',
        },
        {
          path: 'ResearchReview.update',
          value: 'execution.operations["ResearchReview.update"]',
        },
      ]),
    ).toBe(
      '{ "Artifacts": { "Artifact": { "create": execution.operations["Artifacts.Artifact.create"] } }, "ResearchReview": { "update": execution.operations["ResearchReview.update"] } }',
    );
    expect(
      nestedCallbackBindingsSource([
        { path: 'Zulu.invoke', value: 'zulu' },
        { path: 'Alpha.invoke', value: 'alpha' },
      ]),
    ).toBe('{ "Alpha": { "invoke": alpha }, "Zulu": { "invoke": zulu } }');
    expect(() =>
      nestedCallbackBindingsSource([
        { path: 'Provider', value: 'provider' },
        { path: 'Provider.acquire', value: 'acquire' },
      ])).toThrow(/both a callable leaf and a namespace/);
    expect(() =>
      nestedCallbackBindingsSource([
        { path: 'Provider.acquire', value: 'first' },
        { path: 'Provider.acquire', value: 'second' },
      ])).toThrow(/resolves to multiple runtime values/);
  });

  it('executes extracted and direct workflow provider bindings through the generated callback factory', async () => {
    const runtime = {
      module: '@fixture/acquisition/runtime',
      export: 'acquireItem',
      access: {
        kind: 'provider' as const,
        operations: ['connection.use' as const, 'network.connect' as const],
      },
    };
    const source = generatedHandlerModule({
      id: 'task-handler.provider.v1.step',
      kind: 'taskHandler',
      name: 'provider.v1.step',
      stability: 'stable',
      task: { nodeId: 'task.provider.v1.step' },
      workflowEngine: {
        interface: 'WorkflowEngine',
        nodeId: 'provider.workflow-engine',
      },
      providerBindings: [
        {
          identifier: 'acquire',
          provider: {
            interface: 'AcquisitionProvider',
            nodeId: 'provider.acquisition',
          },
          operation: { member: 'acquire', runtime },
        },
        {
          identifier: 'directProvider.acquire',
          provider: {
            interface: 'AcquisitionProvider',
            nodeId: 'provider.acquisition',
          },
          operation: { member: 'acquire', runtime },
        },
      ],
      retry: {
        mode: 'boundedExponentialBackoff',
        maxAttempts: 4,
        initialDelayMs: 1_000,
        maxDelayMs: 60_000,
        factor: 2,
      },
      executionTimeoutSeconds: 60,
      scheduleTimeoutSeconds: 300,
      idempotency: {
        required: true,
        keySource: 'invocation',
        guarantee: 'atLeastOnceRetrySafe',
      },
      effectBoundary: 'externalEffectsAllowed',
      handlerSource: `async input => {
        const helper = await acquire({ id: input.id });
        const direct = await directProvider.acquire({ id: input.id });
        return { value: helper.value + '|' + direct.value };
      }`,
    });
    const createHandler = Function(
      `${source.replace(
        'export function createHandler',
        'function createHandler',
      )}\nreturn createHandler;`,
    )() as (bindings: Readonly<Record<string, unknown>>) => (
      input: { readonly id: string }
    ) => Promise<{ readonly value: string }>;
    const handler = createHandler({
      acquire: async ({ id }: { readonly id: string }) => ({
        value: `helper:${id}`,
      }),
      directProvider: {
        acquire: async ({ id }: { readonly id: string }) => ({
          value: `direct:${id}`,
        }),
      },
    });
    await expect(handler({ id: 'item-1' })).resolves.toEqual({
      value: 'helper:item-1|direct:item-1',
    });
  });

  it('bundles ordinary Model.edit and Event.emit calls into the durable task transaction kernel', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-workflow-model-edit-'));
    try {
      const entrypoint = join(dir, 'application.mjs');
      await mkdir(join(dir, 'migrations'));
      await writeFile(
        join(dir, 'migrations/0001_records.sql'),
        'CREATE TABLE workflow_native_records (id text PRIMARY KEY, body text NOT NULL);\n',
      );
      const providerPackage = join(
        dir,
        'node_modules',
        '@fixture',
        'acquisition',
      );
      await mkdir(providerPackage, { recursive: true });
      await writeFile(
        join(providerPackage, 'package.json'),
        JSON.stringify({
          name: '@fixture/acquisition',
          version: '1.0.0',
          type: 'module',
          exports: {
            '.': './index.js',
            './runtime': './runtime.js',
          },
        }),
      );
      await writeFile(join(providerPackage, 'runtime.js'), `
export async function acquireItem(input) {
  return { body: 'runtime:' + input.id };
}
`);
      await writeFile(join(providerPackage, 'index.js'), `
import { defineApplicationProvider, module } from '@applik8s/applik8s';
export const AcquisitionProvider = defineApplicationProvider({
  interface: 'AcquisitionProvider',
  version: 'v1alpha1',
  runtime: {
    operations: {
      acquire: {
        module: '@fixture/acquisition/runtime',
        export: 'acquireItem',
        access: {
          kind: 'provider',
          operations: ['connection.use', 'network.connect'],
        },
      },
    },
  },
  accepts: candidate => candidate?.kind === 'acquisition' && typeof candidate.acquire === 'function',
}).named('primary');
export const acquisition = module('acquisition', application => {
  const provider = application.inject(AcquisitionProvider);
  return Object.freeze({ acquire: provider.acquire });
});
`);
      await writeFile(entrypoint, `
import { app, event, WorkflowEngine } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { AcquisitionProvider, acquisition } from '@fixture/acquisition';
const platform = app('workflow-model-edit', {
  namespace: 'workflow-model-edit',
  spec: type({ profile: "'starter' | 'dedicated'" }),
  status: type({ ready: 'boolean' }),
});
platform.provide(WorkflowEngine, WorkflowEngine.hatchet({ provision: false, namespace: 'workflow-model-edit', hostPort: 'hatchet:7070', apiUrl: 'http://hatchet:8080', workerTokenSecret: { apiVersion: 'v1', kind: 'Secret', name: 'hatchet-worker', namespace: 'workflow-model-edit' } }));
const acquisitionImplementation = source => ({
  kind: 'acquisition',
  source,
  async acquire(input) { return { body: this.source + ':' + input.id }; },
});
platform.profile(platform.installation.spec, 'profile')
  .provide(AcquisitionProvider)
  .starter(() => acquisitionImplementation('starter'))
  .dedicated(() => acquisitionImplementation('dedicated'))
  .exhaustive();
const { acquire } = platform.include(acquisition);
const records = pgTable('workflow_native_records', { id: text('id').primaryKey(), body: text('body').notNull() });
const database = platform.database.postgres('records', { schema: { records }, migrations: { path: './migrations' } });
const RecordModel = platform.model(records, { name: 'Record', database });
const RecordChanged = event('records.changed.v1', { payload: type({ id: 'string', body: 'string' }) });
const directProvider = platform.inject(AcquisitionProvider);
async function acquireThroughHelper(id) {
  return acquire({ id });
}
async function persistRecord(id, body) {
  await RecordModel.edit(id, async record => {
    await RecordModel.require(id);
    await record.update({ body });
    RecordChanged.emit({ id, body });
  });
}
platform.workflow('records.edit.v1', {
  input: type({ id: 'string', body: 'string' }),
  output: type({ id: 'string' }),
}, async input => {
  const acquired = await acquireThroughHelper(input.id);
  const direct = await directProvider.acquire({ id: input.id });
  await persistRecord(input.id, acquired.body + '|' + direct.body);
  return { id: input.id };
});
export const workflowModelEdit = platform.composition;
`);
      const result = await compileTypeKroComposition({
        entrypoint,
        compositionName: 'workflowModelEdit',
        outDir: join(dir, 'dist'),
        runtimeVersionRange: '^0.7.0',
        handlerAbiVersion: 'applik8s.handler/v1alpha1',
        adapter: 'wasmComponent',
        portability: {
          deterministicBuild: true,
          allowEnvironmentAccess: false,
          allowFilesystemAccess: false,
          allowNetworkAccess: true,
          allowedHostImports: [],
          sourceMaps: {
            emit: true,
            includeSourceContent: false,
            redactPaths: false,
          },
        },
      });
      expect(result.ok, result.ok ? undefined : result.error.message).toBe(true);
      if (!result.ok) return;
      const graph = JSON.parse(
        await readFile(
          result.value.artifacts.applicationGraphJsonPath ?? '',
          'utf8',
        ),
      );
      const provider = graph.nodes.find(
        (node: { kind?: string; interface?: string }) =>
          node.kind === 'provider'
          && node.interface === 'AcquisitionProvider',
      );
      const worker = graph.nodes.find(
        (node: { kind?: string }) => node.kind === 'workflowWorker',
      );
      expect(provider?.id).toBe(
        'provider.acquisition-provider.v1alpha1.primary',
      );
      expect(worker?.name).toBe('applik8s-hatchet');
      expect(
        [...applicationProviderConsumerWorkloads(
          graph,
          new Set([provider?.id ?? 'missing-provider']),
        )],
      ).toEqual(['applik8s-hatchet']);
      const providerAccess = deriveApplicationGraphFoundation(graph, {
        workspaceRoot: dir,
      })
        .runtimeAccess
        .filter(
          (requirement) =>
            requirement.target.capabilityId === provider?.id,
        );
      expect(providerAccess).toEqual(expect.arrayContaining([
        expect.objectContaining({
          consumer: expect.objectContaining({
            nodeId: 'task-handler.records.edit.v1.step',
          }),
          target: expect.objectContaining({ operation: 'connection.use' }),
        }),
        expect.objectContaining({
          consumer: expect.objectContaining({
            nodeId: 'task-handler.records.edit.v1.step',
          }),
          target: expect.objectContaining({ operation: 'network.connect' }),
        }),
      ]));
      expect(
        providerAccess.every(
          (requirement) =>
            requirement.consumer.nodeId
            === 'task-handler.records.edit.v1.step',
        ),
      ).toBe(true);
      expect(graph.nodes).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: 'taskHandler',
          name: 'records.edit.v1.step',
          functionNativeTransaction: expect.objectContaining({
            primaryModel: { nodeId: 'model.record' },
            outbox: [{ nodeId: 'event.records.changed.v1' }],
            idempotency: 'durable-task-invocation',
          }),
          providerBindings: [expect.objectContaining({
            identifier: 'acquire',
            provider: expect.objectContaining({
              interface: 'AcquisitionProvider',
            }),
            operation: expect.objectContaining({
              member: 'acquire',
              runtime: expect.objectContaining({
                module: '@fixture/acquisition/runtime',
                export: 'acquireItem',
              }),
            }),
          }), expect.objectContaining({
            identifier: 'directProvider.acquire',
            provider: expect.objectContaining({
              interface: 'AcquisitionProvider',
            }),
          })],
        }),
      ]));
      const artifact = result.value.artifacts.workflowArtifacts[0];
      const source = await readFile(artifact?.sourcePath ?? '', 'utf8');
      const generatedSource = await readFile(
        join(dirname(artifact?.sourcePath ?? ''), 'workflow-worker.generated.ts'),
        'utf8',
      );
      expect(source).toContain('applik8s_command_results');
      expect(source).toContain('records.changed.v1');
      expect(generatedSource).toContain('executeFunctionNativePostgresModelEdit');
      expect(generatedSource).toContain('withApplicationNativeModelTransactionRuntime');
      expect(generatedSource).toContain('functionNativeModelHandle');
      expect(generatedSource).toContain(
        'createApplicationFunctionNativeEventHandle',
      );
      expect(generatedSource).toContain('functionNativeTaskBindings');
      expect(generatedSource).toContain(
        'function functionNativeTaskReadClients(handlerId, context)',
      );
      expect(generatedSource).toContain(
        'metadata(context).trustedContext',
      );
      expect(generatedSource).toContain(
        'const authoredHandler = handler_',
      );
      expect(generatedSource).toContain(
        'functionNativeTaskBindings("task-handler.records.edit.v1.step")["RecordModel"]',
      );
      expect(generatedSource).toContain(
        'functionNativeTaskBindings("task-handler.records.edit.v1.step")["RecordChanged"]',
      );
      expect(generatedSource).toContain('durableId');
      expect(generatedSource).toContain('@fixture/acquisition/runtime');
      expect(generatedSource).toContain('acquireItem');
      expect(generatedSource).toContain('"acquire": providerOperation_');
      expect(generatedSource).toContain(
        '"directProvider": { "acquire": providerOperation_',
      );
      expect(generatedSource).not.toContain('application.inject');
      expect(generatedSource).not.toContain('application.profile');
      expect(generatedSource).not.toContain('application.provide');
      expect(generatedSource).not.toContain(
        '@applik8s/applik8s/internal/provider-runtime',
      );
      expect(source).toContain('runtime:');

      const workerNode = graph.nodes.find(
        (node: { kind?: string }) => node.kind === 'workflowWorker',
      );
      if (!workerNode) throw new Error('Expected generated workflow worker.');
      const missingRuntimeGraph = structuredClone(graph);
      const missingRuntimeHandler = missingRuntimeGraph.nodes.find(
        (node: { id?: string }) =>
          node.id === 'task-handler.records.edit.v1.step',
      );
      const missingRuntimeBinding = missingRuntimeHandler?.providerBindings?.find(
        (binding: { identifier?: string }) => binding.identifier === 'acquire',
      );
      if (!missingRuntimeBinding?.operation) {
        throw new Error('Expected callable provider binding.');
      }
      delete missingRuntimeBinding.operation.runtime;
      expect(() =>
        generatedWorkerSource(workflowContract(
          missingRuntimeGraph,
          workerNode,
        ))).toThrow(/has no public static runtime operation/);

      const privateRuntimeGraph = structuredClone(graph);
      const privateRuntimeHandler = privateRuntimeGraph.nodes.find(
        (node: { id?: string }) =>
          node.id === 'task-handler.records.edit.v1.step',
      );
      const privateRuntimeBinding = privateRuntimeHandler?.providerBindings?.find(
        (binding: { identifier?: string }) => binding.identifier === 'acquire',
      );
      if (!privateRuntimeBinding?.operation?.runtime) {
        throw new Error('Expected provider runtime operation.');
      }
      privateRuntimeBinding.operation.runtime.module = '../private-runtime.js';
      expect(() =>
        generatedWorkerSource(workflowContract(
          privateRuntimeGraph,
          workerNode,
        ))).toThrow(/invalid public runtime export/);
      const deployment = artifact?.resources.find(
        (resource) => resource.kind === 'Deployment',
      );
      expect(JSON.stringify(deployment)).toContain(
        'APPLIK8S_PROFILE_VARIANT',
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 240_000);

  it('delegates Hatchet infrastructure and emits only the production worker lifecycle', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-workflow-'));
    try {
      const entrypoint = join(dir, 'application.ts');
      await writeFile(entrypoint, `
import { app, workflow, WorkflowEngine } from '@applik8s/applik8s';
import { StructuredGeneration } from '@applik8s/applik8s/structured-generation';
import { type } from '@applik8s/applik8s/dsl';
const SendWelcome = workflow('tenant.send-welcome.v1', { input: type({ tenantId: 'string', requestId: 'string' }), output: type({ sent: 'boolean' }), errors: { providerUnavailable: type({ retryAfterSeconds: 'number' }) } });
const GeneratedWelcome = type({ sent: 'boolean' });
const OnboardTenant = workflow('tenant.onboard.v1', { input: type({ tenantId: 'string', requestId: 'string' }), output: type({ sent: 'boolean' }), errors: { rejected: type({ reason: 'string' }) }, signals: { approved: type({ approved: 'boolean' }) } });
const minimumTenantIdLength = 2;
function shouldSendWelcome(tenantId: string): boolean { return tenantId.length >= minimumTenantIdLength; }
const platform = app('workflow-proof', {
  namespace: 'workflow-proof',
  apiVersion: 'applications.example.test/v1alpha1',
  kind: 'WorkflowProofInstallation',
  spec: type({ profile: "'starter' | 'external'", generationEndpoint: 'string', generationSecretName: 'string' }),
  status: type({ ready: 'boolean' }),
});
platform.provide(WorkflowEngine, WorkflowEngine.hatchet({ name: 'hatchet', namespace: 'workflow-proof', tenantId: 'tenant-id', workerTokenSecret: { apiVersion: 'v1', kind: 'Secret', name: 'hatchet-worker', namespace: 'workflow-proof' } }));
platform.provide(StructuredGeneration, platform.selectProvider(platform.installation.spec.profile, {
  external: StructuredGeneration.http({ endpoint: platform.installation.spec.generationEndpoint, credentialSecret: { apiVersion: 'v1', kind: 'Secret', name: platform.installation.spec.generationSecretName, namespace: 'workflow-proof' } }),
  default: StructuredGeneration.deterministic({ output: { sent: true }, inputUnits: 1, outputUnits: 1 }),
}));
const welcome = platform.workflow(SendWelcome, { retries: 3, executionTimeoutSeconds: 90, requires: [StructuredGeneration] }, async (input, context) => {
  if (!shouldSendWelcome(input.tenantId)) return { sent: false };
  return (await context.use(StructuredGeneration).generate({ profile: 'welcome', input: { tenantId: input.tenantId }, output: GeneratedWelcome, idempotencyKey: input.requestId, signal: context.signal })).value;
});
const onboard = platform.workflow(OnboardTenant, { worker: { scaling: { mode: 'kedaHatchetSlots', minReplicas: 1, maxReplicas: 8 } } }, async (input, context) => {
  await context.sleep('1s');
  return welcome(input, { idempotencyKey: input.requestId });
});
const Tenant = platform.resource('Tenant', {
  spec: type({ requestId: 'string' }),
  status: type({ 'phase?': 'string' }),
});
Tenant.on.reconcile(async (tenant) => {
  const run = await onboard.start({
    tenantId: tenant.metadata.name,
    requestId: tenant.spec.requestId,
  }, { idempotencyKey: tenant.spec.requestId });
  const observation = await tenant.track('onboarding', run, {
    onDelete: { action: 'cancel', timeout: '30s', onTimeout: 'detach' },
  });
  tenant.status.phase = observation.phase;
});
export const workflowProof = platform.composition;
`);
      const result = await compileTypeKroComposition({
        entrypoint,
        compositionName: 'workflowProof',
        outDir: join(dir, 'dist'),
        runtimeVersionRange: '^0.5.0',
        handlerAbiVersion: 'applik8s.handler/v1alpha1',
        adapter: 'wasmComponent',
        portability: { deterministicBuild: true, allowEnvironmentAccess: false, allowFilesystemAccess: false, allowNetworkAccess: true, allowedHostImports: [], sourceMaps: { emit: true, includeSourceContent: false, redactPaths: false } },
      });
      expect(result.ok, result.ok ? undefined : result.error.message).toBe(true);
      if (!result.ok) return;
      expect(result.value.artifacts.workflowArtifacts).toHaveLength(1);
      expect(result.value.artifacts.instanceYamlPaths).toHaveLength(0);
      const rootDefinition = result.value.artifacts.resources.find((resource) => resource.kind === 'ResourceGraphDefinition' && resource.metadata.name === 'workflow-proof');
      expect(rootDefinition).toMatchObject({ spec: { schema: { spec: { profile: expect.any(String), generationEndpoint: expect.any(String), generationSecretName: expect.any(String) } } } });
      const artifact = result.value.artifacts.workflowArtifacts[0];
      expect(artifact).toMatchObject({ sizeBytes: expect.any(Number), digest: expect.stringMatching(/^sha256:/) });
      expect(artifact?.container).toMatchObject({ image: expect.stringMatching(/^applik8s\/workflow-proof-workflow-worker-hatchet:sha-[0-9a-f]{64}$/), entrypoint: '/app/workflow-worker.mjs' });
      const source = await readFile(artifact?.sourcePath ?? '', 'utf8');
      const generatedSource = await readFile(
        join(dirname(artifact?.sourcePath ?? ''), 'workflow-worker.generated.ts'),
        'utf8',
      );
      expect(source).toContain('HatchetClient');
      expect(source).toContain('applik8s-workflow-startup-wait');
      expect(source).toContain('applik8s-workflow-startup-timeout');
      expect(source).toContain('applik8s-workflow-credential-timeout');
      expect(source).toContain('APPLIK8S_WORKFLOW_NAMESPACE');
      expect(generatedSource).toContain("requiredEnv('APPLIK8S_WORKFLOW_NAMESPACE')");
      expect(generatedSource).toContain('system:serviceaccount:');
      expect(source).toContain('process.argv.includes');
      expect(source).toContain('credential-preflight');
      expect(source).toContain('Hatchet engine');
      expect(source).toContain('Hatchet API');
      expect(source).toContain('applik8s-durable-error:');
      expect(source).toContain('providerUnavailable');
      expect(source).toContain('rejected');
      expect(source).toContain('applik8s-structured-generation-output-invalid');
      expect(source).toContain('attempted to use undeclared capability');
      expect(source).toContain('APPLIK8S_STRUCTURED_GENERATION_SELECTION');
      expect(source).toContain('AuthenticationV1Api');
      expect(source).toContain('createTokenReview');
      expect(source).toContain('applik8s.workflow-run-reference/v1alpha1');
      expect(source).not.toContain('aes-256-gcm');
      expect(generatedSource).toContain(
        "purpose: 'applik8s.workflow-run-reference/v1alpha1'",
      );
      expect(generatedSource).toContain('gatewayRunReference.sign');
      expect(generatedSource).toContain('gatewayRunReference.verify');
      expect(generatedSource).toContain('value.caller !== expectedCaller');
      expect(generatedSource).toContain(
        "purpose: 'applik8s.workflow-gateway-admission/v1'",
      );
      expect(generatedSource).toContain('gatewayAdmission.verify');
      expect(generatedSource).toContain('admission-required');
      expect(generatedSource).toContain('admission-invalid');
      expect(generatedSource).toContain('admission-transport-invalid');
      expect(generatedSource).toContain('gatewayCallerContracts');
      expect(generatedSource).toContain(
        "audiences: ['https://kubernetes.default.svc']",
      );
      expect(generatedSource).toContain(
        'applicationCausalPrincipalContext',
      );
      expect(generatedSource).toContain("url.pathname === '/readyz'");
      expect(source).toContain('{key:e.idempotencyKey}');
      expect(generatedSource).toContain(
        'const { idempotencyKey: _parentIdempotencyKey, ...inherited } = parent ?? {}',
      );
      expect(generatedSource).toContain(
        'childOptions(childInvocationMetadata(base, options))',
      );
      expect(generatedSource).toContain(
        'childOptions(childInvocationMetadata(execution, metadata))',
      );
      expect(generatedSource).toContain(
        "'applik8s.causal-principal'",
      );
      expect(generatedSource).toContain(
        'const causalPrincipal = workflowCausalPrincipal(context)',
      );
      expect(generatedSource).toContain(
        'createApplicationExecutionPrincipalV1',
      );
      expect(generatedSource).toContain(
        'validateApplicationAdmissionContextV1WithoutReceipt',
      );
      expect(generatedSource).toContain(
        'const admitted = await canonicalTaskAdmission(',
      );
      expect(generatedSource).toContain(
        'const admitted = await canonicalWorkflowAdmission(',
      );
      expect(generatedSource).toContain(
        "context.stepRunId?.() ?? context.workflowRunId?.() ?? 'unknown'",
      );
      expect(generatedSource).toContain(
        'admission: applicationAdmissionInvocationView(context)',
      );
      expect(generatedSource).toContain(
        '[applicationWorkflowCausalPrincipalMetadata]',
      );
      expect(source).toContain('system:serviceaccount:');
      expect(source).toContain('serviceAccount:"tenant-controller-controller"');
      expect(source).toContain('structured-generation-deterministic');
      expect(source).toContain('structured-generation-http');
      expect(source).not.toContain('runThreaded');
      const resources = result.value.artifacts.resources;
      expect(resources).not.toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'ConfigMap', metadata: expect.objectContaining({ name: 'hatchet-source' }) })]));
      expect(resources).toEqual(expect.arrayContaining([
        expect.objectContaining({ apiVersion: 'apps/v1', kind: 'Deployment', metadata: expect.objectContaining({ name: 'hatchet' }) }),
        expect.objectContaining({ apiVersion: 'policy/v1', kind: 'PodDisruptionBudget' }),
        expect.objectContaining({ apiVersion: 'networking.k8s.io/v1', kind: 'NetworkPolicy' }),
        expect.objectContaining({ apiVersion: 'v1', kind: 'ServiceAccount', metadata: expect.objectContaining({ name: 'hatchet-runtime', namespace: 'workflow-proof' }) }),
        expect.objectContaining({ apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'ClusterRole', rules: [{ apiGroups: ['authentication.k8s.io'], resources: ['tokenreviews'], verbs: ['create'] }] }),
        expect.objectContaining({ apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'ClusterRoleBinding' }),
        expect.objectContaining({ apiVersion: 'v1', kind: 'Service', metadata: expect.objectContaining({ name: 'hatchet', namespace: 'workflow-proof' }), spec: expect.objectContaining({ ports: [{ name: 'gateway', port: 8002, targetPort: 'gateway' }] }) }),
        expect.objectContaining({ apiVersion: 'keda.sh/v1alpha1', kind: 'TriggerAuthentication' }),
        expect.objectContaining({ apiVersion: 'keda.sh/v1alpha1', kind: 'ScaledObject', spec: expect.objectContaining({ minReplicaCount: 1, maxReplicaCount: 8 }) }),
      ]));
      expect(resources).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster' }),
        expect.objectContaining({
          apiVersion: 'helm.toolkit.fluxcd.io/v2',
          kind: 'HelmRelease',
          metadata: expect.objectContaining({ name: 'hatchet' }),
        }),
      ]));
      const networkPolicy = resources.find((resource) =>
        resource.kind === 'NetworkPolicy'
        && JSON.stringify(resource.spec).includes('"port":8002'));
      expect(networkPolicy?.spec).toMatchObject({
        policyTypes: ['Ingress'],
        ingress: expect.arrayContaining([
          expect.objectContaining({
            from: [{
              namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'workflow-proof' } },
              podSelector: { matchLabels: { 'app.kubernetes.io/name': 'tenant-controller' } },
            }],
            ports: [{ protocol: 'TCP', port: 8002 }],
          }),
        ]),
      });
      const workerDeployment = resources.find((resource) =>
        resource.kind === 'Deployment'
        && Reflect.get(resource.metadata, 'name') === 'hatchet'
        && Reflect.get(
          Reflect.get(resource.metadata, 'labels') as object,
          'app.kubernetes.io/component',
        ) === 'workflow-worker');
      expect(workerDeployment?.spec).toMatchObject({ template: { spec: {
        serviceAccountName: 'hatchet-runtime',
        initContainers: [expect.objectContaining({
          name: 'wait-for-workflow-credentials',
          command: ['node', '/app/workflow-worker.mjs', '--credential-preflight'],
          env: expect.arrayContaining([{ name: 'APPLIK8S_WORKFLOW_TOKEN_FILE', value: '/var/run/secrets/applik8s/workflow-token/token' }]),
          volumeMounts: [{ name: 'workflow-token', mountPath: '/var/run/secrets/applik8s/workflow-token', readOnly: true }],
        })],
        containers: [expect.objectContaining({
          ports: [{ name: 'health', containerPort: 8001 }, { name: 'gateway', containerPort: 8002 }],
          env: expect.arrayContaining([
          { name: 'APPLIK8S_STRUCTURED_GENERATION_SELECTION', value: '${schema.spec.profile}' },
          { name: 'APPLIK8S_STRUCTURED_GENERATION_ENDPOINT', value: '${schema.spec.profile == "external" ? schema.spec.generationEndpoint : ("")}' },
          { name: 'APPLIK8S_STRUCTURED_GENERATION_API_KEY', valueFrom: { secretKeyRef: { name: '${schema.spec.profile == "external" ? schema.spec.generationSecretName : ("applik8s-structured-generation-unused")}', key: '${schema.spec.profile == "external" ? "apiKey" : ("apiKey")}', optional: true } } },
          expect.objectContaining({
            name: 'APPLIK8S_INTERNAL_OPERATION_SECRET',
            valueFrom: {
              secretKeyRef: expect.objectContaining({
                name: 'workflow-proof-internal-operation',
                key: 'key',
              }),
            },
          }),
        ]) })],
        volumes: [{ name: 'workflow-token', secret: { secretName: 'hatchet-worker', items: [{ key: 'HATCHET_CLIENT_TOKEN', path: 'token' }] } }],
      } } });
      const operatorManifest = JSON.parse(await readFile(
        result.value.artifacts.operatorArtifacts[0]?.manifestJsonPath ?? '',
        'utf8',
      )) as {
        readonly spec?: {
          readonly capabilities?: Readonly<Record<string, unknown>>;
        };
      };
      const operatorCapability = operatorManifest.spec?.capabilities;
      expect(Object.values(operatorCapability ?? {})).toEqual([
        expect.objectContaining({
          auth: { type: 'serviceAccount' },
          endpoint: 'http://hatchet.workflow-proof.svc:8002',
          workflowGateway: {
            protocol: 'applik8s.workflow-gateway/v1alpha1',
            worker: 'hatchet',
            contracts: ['tenant.onboard.v1'],
            caller: {
              operator: 'tenant-controller',
              namespace: 'workflow-proof',
              serviceAccount: 'tenant-controller-controller',
            },
          },
        }),
      ]);
      const bundle = result.value.artifacts.manifest.spec.workflows;
      expect(bundle).toEqual([expect.objectContaining({ name: 'hatchet', digest: artifact?.digest, sizeBytes: artifact?.sizeBytes })]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 240_000);

  it('lowers workflow.emitSignal as a compiler-known durable capability without bundling the application registrar', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-workflow-signal-'));
    try {
      const entrypoint = join(dir, 'application.ts');
      await mkdir(join(dir, 'migrations'));
      await writeFile(
        join(dir, 'migrations/0001_records.sql'),
        'CREATE TABLE records (id text PRIMARY KEY);',
      );
      await writeFile(entrypoint, `
import { app, WorkflowEngine } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import { pgTable, text } from 'drizzle-orm/pg-core';
const records = pgTable('records', {
  id: text('id').primaryKey(),
});
const platform = app('signal-proof', { namespace: 'signal-proof' });
platform.provide(WorkflowEngine, WorkflowEngine.hatchet({
  provision: false,
  namespace: 'signal-proof',
  hostPort: 'hatchet:7070',
  apiUrl: 'http://hatchet:8080',
  workerTokenSecret: { apiVersion: 'v1', kind: 'Secret', name: 'hatchet-worker', namespace: 'signal-proof' },
}));
const Database = platform.database.postgres('primary', {
  schema: { records },
  migrations: { path: './migrations' },
});
const Record = platform.model(records, {
  name: 'Record',
  database: Database,
});
const workflow = platform.workflow;
export const ReviewDecision = workflow.signal('review-decision.v1', {
  input: type({ postId: 'string' }),
  actions: {
    approve: type({ 'comment?': 'string' }),
    reject: type({ reason: 'string' }),
  },
});
ReviewDecision.subscribe('review-decisions', {
  delivery: 'sse',
  authorize: () => true,
});
const Health = platform.query('health.v1', {
  input: type({}),
  output: type({ ok: 'boolean' }),
  database: Database,
  reads: [Record],
  authorize: () => true,
  run: async () => ({ ok: true }),
});
platform.gateway('review', {
  queries: [Health],
  authorizeCommand: () => true,
  deployment: {
    namespace: 'signal-proof',
    port: 8080,
    cursorSecret: { name: 'signal-proof-cursor', key: 'key' },
    authenticate: async () => ({
      principal: {
        identity: {
          id: 'identity:signal-proof:human:reviewer',
          kind: 'human',
          issuer: 'applik8s://signal-proof',
          subject: 'reviewer',
        },
      },
      trustedContext: {},
      authorizationVersion: 'v1',
    }),
  },
});
workflow('posts.review.v1', {
  input: type({ postId: 'string' }),
  output: type({ state: "'approved' | 'rejected' | 'expired'" }),
}, {
  retries: 3,
}, async (input) => {
  const decision = await workflow.emitSignal(ReviewDecision, {
    input: { postId: input.postId },
    expiresIn: '24h',
    target: { postId: input.postId },
    grantAccessTo: {
      id: 'identity:signal-proof:human:reviewer',
      kind: 'human',
      issuer: 'applik8s://signal-proof',
      subject: 'reviewer',
    },
  });
  const outcome = await decision();
  return outcome.match({
    approve: async () => ({ state: 'approved' }),
    reject: async () => ({ state: 'rejected' }),
    expired: async () => ({ state: 'expired' }),
  });
});
export const signalProof = platform.composition;
`);
      const result = await compileTypeKroComposition({
        entrypoint,
        compositionName: 'signalProof',
        outDir: join(dir, 'dist'),
        runtimeVersionRange: '^0.7.0',
        handlerAbiVersion: 'applik8s.handler/v1alpha1',
        adapter: 'wasmComponent',
        portability: {
          deterministicBuild: true,
          allowEnvironmentAccess: false,
          allowFilesystemAccess: false,
          allowNetworkAccess: true,
          allowedHostImports: [],
          sourceMaps: {
            emit: true,
            includeSourceContent: false,
            redactPaths: false,
          },
        },
      });
      expect(result.ok, result.ok ? undefined : result.error.message).toBe(true);
      if (!result.ok) return;
      const compiledGraph = JSON.parse(
        await readFile(
          result.value.artifacts.applicationGraphJsonPath ?? '',
          'utf8',
        ),
      ) as ApplicationGraph;
      expect(
        compiledGraph.nodes.find(
          (node) => node.kind === 'gateway' && node.name === 'review',
        ),
      ).toMatchObject({
        subscriptions: [
          { nodeId: 'subscription.review-decisions' },
        ],
      });
      const compiledGateway = result.value.artifacts.reactiveArtifacts.find(
        (artifact) => artifact.kind === 'queryGateway',
      );
      const compiledGatewaySource = await readFile(
        join(
          dirname(compiledGateway?.sourcePath ?? ''),
          'gateway.generated.ts',
        ),
        'utf8',
      );
      expect(compiledGatewaySource).toContain(
        'createApplicationSignalGateway',
      );
      expect(compiledGatewaySource).toContain(
        'createApplicationStreamSubscriptionGateway',
      );
      const discovered = await discoverApplicationGraph(entrypoint, 'signalProof');
      expect(discovered.ok, discovered.ok ? undefined : discovered.error.message).toBe(true);
      if (!discovered.ok) return;
      const graph = discovered.value;
      const catalog = compileApplicationOperationCatalog(graph);
      const authority = applicationStaticAuthorityManifest(graph);
      expect(authority).toMatchObject({
        permissions: [
          expect.objectContaining({
            grantable: true,
            operationIds: expect.arrayContaining([
              'applik8s://signals/review-decision.v1/operations/approve',
              'applik8s://signals/review-decision.v1/operations/issuance.read',
              'applik8s://signals/review-decision.v1/operations/reject',
            ]),
          }),
        ],
        grants: [
          expect.objectContaining({
            canGrant: true,
            identity: expect.objectContaining({
              kind: 'workload',
            }),
          }),
        ],
      });
      expect(
        catalog.operations
          .filter((operation) =>
            operation.id.startsWith(
              'applik8s://signals/review-decision.v1/operations/',
            ),
          )
          .map(({ id, kind, authority }) => ({
            id,
            kind,
            classification: authority.classification,
            grantable: authority.grantable,
          })),
      ).toEqual([
        {
          id: 'applik8s://signals/review-decision.v1/operations/approve',
          kind: 'signal.action',
          classification: 'runtime-grantable',
          grantable: true,
        },
        {
          id: 'applik8s://signals/review-decision.v1/operations/issuance.read',
          kind: 'signal.issuance.read',
          classification: 'runtime-grantable',
          grantable: true,
        },
        {
          id: 'applik8s://signals/review-decision.v1/operations/issue',
          kind: 'signal.issue',
          classification: 'application-policy',
          grantable: false,
        },
        {
          id: 'applik8s://signals/review-decision.v1/operations/reject',
          kind: 'signal.action',
          classification: 'runtime-grantable',
          grantable: true,
        },
      ]);
      expect(
        graph.nodes.find(
          (node) =>
            node.kind === 'taskHandler'
            && node.name === 'posts.review.v1.step',
        ),
      ).toMatchObject({
        signalBindings: [
          expect.objectContaining({
            alias: 'ReviewDecision',
            id: 'review-decision.v1',
            actions: [
              expect.objectContaining({ name: 'approve' }),
              expect.objectContaining({ name: 'reject' }),
            ],
          }),
        ],
      });
      const artifact = result.value.artifacts.workflowArtifacts[0];
      const source = await readFile(artifact?.sourcePath ?? '', 'utf8');
      const generatedSource = await readFile(
        join(dirname(artifact?.sourcePath ?? ''), 'workflow-worker.generated.ts'),
        'utf8',
      );
      // The emitted worker is an optimized bundle, so helper identifiers are
      // intentionally not stable. Assert the durable protocol that must
      // survive minification instead of implementation-local symbol names.
      expect(source).toContain('CREATE TABLE IF NOT EXISTS applik8s_signals');
      expect(source).toContain('occurrence_key text NOT NULL UNIQUE');
      expect(source).toContain('applik8s.signal.terminal.v1');
      expect(source).toContain('8760h');
      expect(source).toMatch(
        /durableTask\(\{name:"posts\.review\.v1\.step",retries:3/,
      );
      expect(source).toMatch(/durableTask\(\{name:"posts\.review\.v1",executionTimeout:"8760h"/);
      expect(source).not.toContain('365d');
      expect(source).toContain('review-decision.v1');
      expect(source).toContain('applik8s.workloadAuthority/v1alpha1');
      expect(source).toContain('applicationPolicyAllowed:!0');
      expect(source).toContain('transport:"workflow"');
      expect(source).toContain('Signal issue authorization denied');
      expect(source).toContain(
        'Exact-instance access created by workflow.emitSignal',
      );
      expect(source).toContain('application-signal-runtime');
      expect(source).toContain('terminalStatus');
      expect(source).toContain('workflowExecutionId');
      expect(source).toContain('hatchet-workflow-runtime');
      expect(source).toContain('observeWorkflowRuntime');
      expect(source).toContain('workflow-engine:provider.workflow-engine');
      expect(source).toContain('workflow-worker:workflow-worker.applik8s-hatchet');
      expect(source).toContain('expiresAt');
      expect(source).toContain('worker-stopping');
      expect(source).toContain('executionId');
      expect(source).not.toContain("import { app");
      expect(generatedSource).toContain('signal: execution.signal');
      expect(generatedSource).toContain(
        'const principal = execution.admission?.principal',
      );
      expect(generatedSource).toContain(
        'currentCancellationRevision: execution.cancellationRevision',
      );
      expect(generatedSource).toContain(
        'issuedBy: principal.workloadIdentity',
      );
      expect(generatedSource).not.toContain(
        'const principal = await operationAuthority.admitExecutionPrincipal({',
      );
      const handlerSource = await readFile(
        join(
          dirname(artifact?.sourcePath ?? ''),
          handlerModuleFile('task-handler.posts.review.v1.step'),
        ),
        'utf8',
      );
      expect(handlerSource).toContain(
        'export function createHandler(__applik8sBindings = {})',
      );
      expect(handlerSource).toContain(
        'const ReviewDecision = __applik8sBindings["ReviewDecision"];',
      );
      expect(handlerSource).toContain(
        'const workflow = __applik8sBindings["workflow"];',
      );
      expect(handlerSource).not.toContain("from '/private/tmp");
      const deployment = result.value.artifacts.resources.find(
        (resource) =>
          resource.kind === 'Deployment'
          && JSON.stringify(resource).includes(
            'APPLIK8S_SIGNAL_DATABASE_URL',
          ),
      );
      expect(deployment?.spec).toMatchObject({
        template: {
          spec: {
            containers: [
              expect.objectContaining({
                env: expect.arrayContaining([
                  expect.objectContaining({
                    name: 'APPLIK8S_SIGNAL_DATABASE_URL',
                    valueFrom: {
                      secretKeyRef: expect.objectContaining({ key: 'uri' }),
                    },
                  }),
                ]),
              }),
            ],
          },
        },
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 240_000);

  it('uses the provisioned Hatchet chart worker-token Secret by default', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-workflow-default-token-'));
    try {
      const entrypoint = join(dir, 'application.ts');
      await writeFile(entrypoint, `
import { app, workflow, WorkflowEngine } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
const Run = workflow('work.run.v1', { input: type({ id: 'string' }), output: type({ done: 'boolean' }) });
const platform = app('default-token', { namespace: 'default-token' });
platform.provide(WorkflowEngine, WorkflowEngine.hatchet({ name: 'runtime', namespace: 'default-token' }));
platform.workflow(Run, {}, async () => ({ done: true }));
export const defaultToken = platform.composition;
`);
      const result = await compileTypeKroComposition({
        entrypoint,
        compositionName: 'defaultToken',
        outDir: join(dir, 'dist'),
        runtimeVersionRange: '^0.5.0',
        handlerAbiVersion: 'applik8s.handler/v1alpha1',
        adapter: 'wasmComponent',
        portability: { deterministicBuild: true, allowEnvironmentAccess: false, allowFilesystemAccess: false, allowNetworkAccess: true, allowedHostImports: [], sourceMaps: { emit: true, includeSourceContent: false, redactPaths: false } },
      });
      expect(result.ok, result.ok ? undefined : result.error.message).toBe(true);
      if (!result.ok) return;
      const deployment = result.value.artifacts.resources.find((resource) => resource.kind === 'Deployment');
      expect(deployment?.spec).toMatchObject({ template: { spec: {
        initContainers: [expect.objectContaining({
          name: 'wait-for-workflow-credentials',
          command: ['node', '/app/workflow-worker.mjs', '--credential-preflight'],
        })],
        containers: [expect.objectContaining({ env: expect.arrayContaining([
          { name: 'HATCHET_CLIENT_TOKEN', valueFrom: { secretKeyRef: { name: 'hatchet-client-config', key: 'HATCHET_CLIENT_TOKEN' } } },
        ]) })],
        volumes: [{ name: 'workflow-token', secret: { secretName: 'hatchet-client-config', items: [{ key: 'HATCHET_CLIENT_TOKEN', path: 'token' }] } }],
      } } });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 240_000);

  it('lowers a typed online-projection rebuild into the workflow worker', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-workflow-rebuild-'));
    try {
      const entrypoint = join(dir, 'application.ts');
      await mkdir(join(dir, 'migrations'));
      await writeFile(join(dir, 'migrations/0001_records.sql'), 'CREATE TABLE records (id text PRIMARY KEY);\n');
      await writeFile(entrypoint, `
import { app, event, IndexStore, ObjectStorage, workflow, WorkflowEngine } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import { pgTable, text } from 'drizzle-orm/pg-core';
const platform = app('rebuild-proof', { namespace: 'rebuild-proof' });
platform.provide(WorkflowEngine, WorkflowEngine.hatchet({ provision: false, namespace: 'rebuild-proof', hostPort: 'hatchet:7070', apiUrl: 'http://hatchet:8080', workerTokenSecret: { apiVersion: 'v1', kind: 'Secret', name: 'hatchet-worker', namespace: 'rebuild-proof' } }));
platform.provide(IndexStore, IndexStore.valkey({ name: 'online', namespace: 'rebuild-proof', host: 'online.rebuild-proof.svc', port: 6379, provision: false, authentication: { mode: 'password', secret: { apiVersion: 'v1', kind: 'Secret', name: 'online-password', namespace: 'rebuild-proof' }, key: 'password' } }));
platform.provide(ObjectStorage, ObjectStorage.s3({ name: 'artifacts', bucket: 'projection-artifacts', region: 'us-east-1', ownership: 'direct-provisioned', provisioning: { kind: 'object-bucket-claim', claimName: 'object-credentials', storageClassName: 'rook-ceph-bucket' }, credentialsSecret: { apiVersion: 'v1', kind: 'Secret', name: 'object-credentials', namespace: 'rebuild-proof' } }));
const records = pgTable('records', { id: text('id').primaryKey() });
const database = platform.database.postgres('records', { schema: { records }, migrations: { path: './migrations' } });
const RecordModel = platform.model(records, { name: 'Record', database });
const Changed = event('records.changed.v1', { payload: type({ id: 'string', score: 'number' }) });
const changes = platform.stream(Changed, { database, retention: { maxAgeSeconds: 86400 }, partitionBy: ({ id }) => id, authorize: () => false });
function rebuildPartition() { return 'all'; }
const timeline = changes.project('timeline', { store: IndexStore, output: type({ id: 'string', score: 'number' }), map: (payload) => payload, partitionBy: rebuildPartition, key: ({ id }) => id, score: ({ score }) => score, value: (row) => row, retention: { maxItemsPerPartition: 1000 }, generationScoped: true, rebuild: { source: RecordModel, map: (record) => ({ id: record.id, score: 0 }), checkpoint: 'durable' } });
const artifacts = platform.objectStore('projection-artifacts', { mode: 'immutable', maxObjectBytes: 4000000, contentTypes: ['application/vnd.applik8s.projection-segment+json', 'application/vnd.applik8s.projection-rebuild+json'] });
const Rebuild = workflow('records.rebuild.v1', { input: type({ generation: 'string' }), output: type({ watermark: 'number' }) });
platform.workflow(Rebuild, { projections: { timeline: { projection: timeline, artifacts, bounds: { batchSize: 250, maxSegments: 1000 } } }, objects: { artifacts } }, async (input, context) => {
  await context.objects.artifacts.head('rebuild/' + input.generation + '/manifest.json');
  return { watermark: (await context.projections.timeline.rebuild({ generation: input.generation })).publishedWatermark };
});
export const rebuildProof = platform.composition;
`);
      const result = await compileTypeKroComposition({
        entrypoint, compositionName: 'rebuildProof', outDir: join(dir, 'dist'), runtimeVersionRange: '^0.6.0',
        handlerAbiVersion: 'applik8s.handler/v1alpha1', adapter: 'wasmComponent',
        portability: { deterministicBuild: true, allowEnvironmentAccess: false, allowFilesystemAccess: false, allowNetworkAccess: true, allowedHostImports: [], sourceMaps: { emit: true, includeSourceContent: false, redactPaths: false } },
      });
      expect(result.ok, result.ok ? undefined : result.error.message).toBe(true);
      if (!result.ok) return;
      const artifact = result.value.artifacts.workflowArtifacts[0];
      const source = await readFile(artifact?.sourcePath ?? '', 'utf8');
			const generatedSource = await readFile(join(dirname(artifact?.sourcePath ?? ''), 'workflow-worker.generated.ts'), 'utf8');
      expect({
        rebuildRuntime: source.includes('applik8s.online-projection-rebuild/v1alpha1'),
        segmentRuntime: source.includes('applik8s.online-projection-segment/v1alpha1'),
        atomicPublish: source.includes('could not catch generation'),
        retirementGuard: source.includes('cannot retire artifact evidence owned by another scope'),
        providerGuard: source.includes('Projection rebuild object storage is disabled'),
				typedObjects: generatedSource.includes('objectRuntimes') && generatedSource.includes('attempted to use undeclared object store') && generatedSource.includes('Object body exceeds'),
        capturedHelper: source.includes('function(){return"all"}'),
        authoritativeSnapshot: source.includes('REPEATABLE READ READ ONLY') && source.includes('snapshot watermark'),
      }).toEqual({ rebuildRuntime: true, segmentRuntime: true, atomicPublish: true, retirementGuard: true, providerGuard: true, typedObjects: true, capturedHelper: true, authoritativeSnapshot: true });
      const deployment = result.value.artifacts.resources.find((resource) => resource.kind === 'Deployment' && resource.metadata.name === artifact?.name);
      expect(deployment?.spec).toMatchObject({ template: { spec: { containers: [expect.objectContaining({ env: expect.arrayContaining([
        { name: 'APPLIK8S_REBUILD_VALKEY_HOST', value: 'online.rebuild-proof.svc' },
        { name: 'APPLIK8S_REBUILD_VALKEY_PASSWORD', valueFrom: { secretKeyRef: { name: 'online-password', key: 'password' } } },
        { name: 'APPLIK8S_REBUILD_OBJECT_BUCKET', value: 'projection-artifacts' },
        { name: 'APPLIK8S_REBUILD_OBJECT_HOST', valueFrom: { configMapKeyRef: { name: 'object-credentials', key: 'BUCKET_HOST' } } },
        { name: 'APPLIK8S_REBUILD_OBJECT_PORT', valueFrom: { configMapKeyRef: { name: 'object-credentials', key: 'BUCKET_PORT' } } },
        { name: 'APPLIK8S_REBUILD_OBJECT_ENDPOINT', value: 'http://$(APPLIK8S_REBUILD_OBJECT_HOST):$(APPLIK8S_REBUILD_OBJECT_PORT)' },
				{ name: 'APPLIK8S_TASK_OBJECT_BUCKET', value: 'projection-artifacts' },
        { name: 'APPLIK8S_TASK_OBJECT_HOST', valueFrom: { configMapKeyRef: { name: 'object-credentials', key: 'BUCKET_HOST' } } },
        { name: 'APPLIK8S_TASK_OBJECT_PORT', valueFrom: { configMapKeyRef: { name: 'object-credentials', key: 'BUCKET_PORT' } } },
        { name: 'APPLIK8S_TASK_OBJECT_ENDPOINT', value: 'http://$(APPLIK8S_TASK_OBJECT_HOST):$(APPLIK8S_TASK_OBJECT_PORT)' },
        { name: 'AWS_ACCESS_KEY_ID', valueFrom: { secretKeyRef: { name: 'object-credentials', key: 'AWS_ACCESS_KEY_ID', optional: true } } },
      ]) })] } } });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 240_000);

  it('rejects external effects hidden in module-scope workflow helpers', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-workflow-effects-'));
    try {
      const entrypoint = join(dir, 'application.ts');
      await writeFile(entrypoint, `
import { app, workflow } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
const Flow = workflow('unsafe.flow.v1', { input: type({ id: 'string' }), output: type({ done: 'boolean' }) });
async function hiddenEffect(id: string) { await fetch('https://example.test/' + id); }
const platform = app('unsafe-workflow');
platform.workflow(Flow, {}, async (input) => { await hiddenEffect(input.id); return { done: true }; });
export const unsafeWorkflow = platform.composition;
`);
      const result = await compileTypeKroComposition({
        entrypoint,
        compositionName: 'unsafeWorkflow',
        outDir: join(dir, 'dist'),
        runtimeVersionRange: '^0.5.0',
        handlerAbiVersion: 'applik8s.handler/v1alpha1',
        adapter: 'wasmComponent',
        portability: { deterministicBuild: true, allowEnvironmentAccess: false, allowFilesystemAccess: false, allowNetworkAccess: true, allowedHostImports: [], sourceMaps: { emit: true, includeSourceContent: false, redactPaths: false } },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toContain('Move external effects into context.step(...) or use the single-step workflow overload');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 240_000);

  it('allows durable coordinators to call a separately admitted effect handle', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-workflow-effect-handle-'));
    try {
      const entrypoint = join(dir, 'application.ts');
      await writeFile(entrypoint, `
import { app, workflow } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
const Effect = workflow('safe.effect.v1', { input: type({ id: 'string' }), output: type({ done: 'boolean' }) });
const Flow = workflow('safe.flow.v1', { input: type({ id: 'string' }), output: type({ done: 'boolean' }) });
const platform = app('safe-workflow');
const effect = platform.workflow(Effect, { retries: 1 }, async (input, context) => {
  const response = await fetch('https://example.test/' + input.id, { signal: context.signal });
  return { done: response.ok };
});
platform.workflow(Flow, {}, async (input) => effect(input));
export const safeWorkflow = platform.composition;
`);
      const result = await compileTypeKroComposition({
        entrypoint,
        compositionName: 'safeWorkflow',
        outDir: join(dir, 'dist'),
        runtimeVersionRange: '^0.7.0',
        handlerAbiVersion: 'applik8s.handler/v1alpha1',
        adapter: 'wasmComponent',
        portability: {
          deterministicBuild: true,
          allowEnvironmentAccess: false,
          allowFilesystemAccess: false,
          allowNetworkAccess: true,
          allowedHostImports: [],
          sourceMaps: {
            emit: true,
            includeSourceContent: false,
            redactPaths: false,
          },
        },
      });
      expect(result.ok, result.ok ? undefined : result.error.message).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 240_000);

  it('fails closed when KEDA task-stat scaling cannot name a Hatchet tenant', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-workflow-invalid-'));
    try {
      const entrypoint = join(dir, 'application.ts');
      await writeFile(entrypoint, `
import { app, workflow, WorkflowEngine } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
const Run = workflow('work.run.v1', { input: type({ id: 'string' }), output: type({ done: 'boolean' }) });
const Flow = workflow('work.flow.v1', { input: type({ id: 'string' }), output: type({ done: 'boolean' }) });
const platform = app('invalid-scaling', { namespace: 'invalid-scaling' });
platform.provide(WorkflowEngine, WorkflowEngine.hatchet({ namespace: 'invalid-scaling' }));
const run = platform.workflow(Run, { }, async () => ({ done: true }));
platform.workflow(Flow, { worker: { scaling: { mode: 'kedaHatchetSlots', maxReplicas: 4 } } }, async (input) => run(input));
export const invalidScaling = platform.composition;
`);
      const result = await compileTypeKroComposition({
        entrypoint,
        compositionName: 'invalidScaling',
        outDir: join(dir, 'dist'),
        runtimeVersionRange: '^0.5.0',
        handlerAbiVersion: 'applik8s.handler/v1alpha1',
        adapter: 'wasmComponent',
        portability: { deterministicBuild: true, allowEnvironmentAccess: false, allowFilesystemAccess: false, allowNetworkAccess: true, allowedHostImports: [], sourceMaps: { emit: true, includeSourceContent: false, redactPaths: false } },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toContain('has no tenantId');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 240_000);

  it('binds an externally managed Hatchet runtime without generating provider infrastructure', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-workflow-external-'));
    try {
      const entrypoint = join(dir, 'application.ts');
      await writeFile(entrypoint, `
import { app, workflow, WorkflowEngine } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
const Run = workflow('external.run.v1', { input: type({ id: 'string' }), output: type({ done: 'boolean' }) });
const platform = app('external-runtime', { namespace: 'external-runtime' });
platform.provide(WorkflowEngine, WorkflowEngine.hatchet({ provision: false, namespace: 'external-runtime', hostPort: 'hatchet.example.test:7070', apiUrl: 'https://hatchet.example.test', workerTokenSecret: { apiVersion: 'v1', kind: 'Secret', name: 'external-hatchet-token', namespace: 'external-runtime' } }));
platform.workflow(Run, {}, async () => ({ done: true }));
export const externalRuntime = platform.composition;
`);
      const result = await compileTypeKroComposition({
        entrypoint,
        compositionName: 'externalRuntime',
        outDir: join(dir, 'dist'),
        runtimeVersionRange: '^0.5.0',
        handlerAbiVersion: 'applik8s.handler/v1alpha1',
        adapter: 'wasmComponent',
        portability: { deterministicBuild: true, allowEnvironmentAccess: false, allowFilesystemAccess: false, allowNetworkAccess: true, allowedHostImports: [], sourceMaps: { emit: true, includeSourceContent: false, redactPaths: false } },
      });
      expect(result.ok, result.ok ? undefined : result.error.message).toBe(true);
      if (!result.ok) return;
      expect(result.value.artifacts.resources).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'HelmRelease' }),
        expect.objectContaining({ kind: 'HelmRepository' }),
        expect.objectContaining({ kind: 'Cluster' }),
      ]));
      const deployment = result.value.artifacts.resources.find((resource) => resource.kind === 'Deployment');
      expect(deployment?.spec).toMatchObject({ template: { spec: { containers: [expect.objectContaining({ env: expect.arrayContaining([
        { name: 'HATCHET_CLIENT_TOKEN', valueFrom: { secretKeyRef: { name: 'external-hatchet-token', key: 'HATCHET_CLIENT_TOKEN' } } },
        { name: 'HATCHET_CLIENT_HOST_PORT', value: 'hatchet.example.test:7070' },
        { name: 'HATCHET_CLIENT_API_URL', value: 'https://hatchet.example.test' },
      ]) })] } } });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 240_000);
});
