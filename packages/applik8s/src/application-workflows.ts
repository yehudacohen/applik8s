import type { ApplicationExpressionContract, ApplicationMessageContractSchema, ApplicationProviderRuntimeContract, ApplicationResourceRef } from '@applik8s/core';
import { normalizeSchema, type SchemaInput } from '@applik8s/sdk';

import { type ApplicationGraphState, addApplicationGraphEdge, addApplicationGraphNode, addApplicationProviderBinding, addApplicationProviderRequirement } from './application-graph-state.js';
import { instrumentedApplicationCallbackSource } from './application-callback.js';
import { type ApplicationProviderState, type ApplicationWorkflowEngineProvider, applicationProviderImplementationName, applicationWorkflowEngineImplementation } from './application-providers.js';
import { analyzeApplicationServerRouteSource, applicationRouteSourceDependencies, extractApplicationCallArgumentSource, normalizeSerializableFunctionSource, serializedCallbackClosureMessage, transpileApplicationCallbackExpression, unsupportedRouteFreeIdentifiers } from './application-route-source.js';
import type { TaskDefinition, WorkflowDefinition } from './dsl.js';
import { type ApplicationWorkflowInvocationMetadata, type ApplicationWorkflowResultOptions, type ApplicationWorkflowRun, applicationWorkflowRuntime } from './workflow-runtime.js';

export { ApplicationDurableError, isApplicationDurableError } from './workflow-runtime.js';
export type { ApplicationDurableErrorDescriptor, ApplicationDurableErrorUnion, ApplicationWorkflowResultOptions } from './workflow-runtime.js';

export interface ApplicationWorkflowState extends ApplicationGraphState, ApplicationProviderState {
  readonly workflowHandlers: Map<string, ApplicationWorkflowHandlerRegistration>;
  readonly workflowHandlerGroups: Map<string, string>;
}

export interface ApplicationTaskContext<TErrors extends Readonly<Record<string, object>> = Readonly<Record<never, never>>> {
  readonly invocationId: string;
  readonly idempotencyKey: string;
  readonly attempt: number;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly traceparent?: string;
  readonly trustedContext?: ApplicationWorkflowInvocationMetadata['trustedContext'];
  readonly signal: AbortSignal;
  fail<TName extends keyof TErrors & string>(name: TName, payload: TErrors[TName]): never;
}

export interface ApplicationWorkflowContext<
  TTasks extends Readonly<Record<string, ApplicationTaskReference>> = Readonly<Record<string, ApplicationTaskReference>>,
  TWorkflows extends Readonly<Record<string, ApplicationWorkflowReference>> = Readonly<Record<string, ApplicationWorkflowReference>>,
  TSignals extends Readonly<Record<string, object>> = Readonly<Record<string, object>>,
  TErrors extends Readonly<Record<string, object>> = Readonly<Record<never, never>>,
> {
  task<TAlias extends keyof TTasks & string>(alias: TAlias, input: ApplicationTaskReferenceInput<TTasks[TAlias]>, options?: ApplicationWorkflowInvocationMetadata): Promise<ApplicationTaskReferenceOutput<TTasks[TAlias]>>;
  child<TAlias extends keyof TWorkflows & string>(alias: TAlias, input: ApplicationWorkflowReferenceInput<TWorkflows[TAlias]>, options?: ApplicationWorkflowInvocationMetadata): Promise<ApplicationWorkflowReferenceOutput<TWorkflows[TAlias]>>;
  sleep(duration: string): Promise<void>;
  waitFor<TName extends keyof TSignals & string>(signal: TName, options?: { readonly expression?: string; readonly scope?: string; readonly lookback?: string }): Promise<TSignals[TName]>;
  now(): Promise<Date>;
  cancelled(): boolean;
  rethrowIfCancelled(error: unknown): void;
  readonly invocationId: string;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly traceparent?: string;
  readonly trustedContext?: ApplicationWorkflowInvocationMetadata['trustedContext'];
  fail<TName extends keyof TErrors & string>(name: TName, payload: TErrors[TName]): never;
}

export type ApplicationTaskHandler<TInput extends object, TOutput extends object, TErrors extends Readonly<Record<string, object>> = Readonly<Record<never, never>>> = (input: TInput, context: ApplicationTaskContext<TErrors>) => TOutput | Promise<TOutput>;
export type ApplicationWorkflowHandler<
  TInput extends object,
  TOutput extends object,
  TErrors extends Readonly<Record<string, object>> = Readonly<Record<never, never>>,
  TSignals extends Readonly<Record<string, object>> = Readonly<Record<never, never>>,
  TTasks extends Readonly<Record<string, ApplicationTaskReference>> = Readonly<Record<string, ApplicationTaskReference>>,
  TWorkflows extends Readonly<Record<string, ApplicationWorkflowReference>> = Readonly<Record<string, ApplicationWorkflowReference>>,
> = (input: TInput, context: ApplicationWorkflowContext<TTasks, TWorkflows, TSignals, TErrors>) => TOutput | Promise<TOutput>;

export interface ApplicationTaskOptions<TInput extends object> {
  readonly retries?: number;
  readonly retryBackoff?: { readonly factor?: number; readonly maxSeconds?: number };
  readonly executionTimeoutSeconds?: number;
  readonly scheduleTimeoutSeconds?: number;
  readonly idempotencyKey?: (input: TInput) => string;
  readonly worker?: ApplicationWorkflowWorkerOptions;
}

export interface ApplicationWorkflowWorkerOptions {
  readonly group?: string;
  readonly replicas?: number;
  readonly taskSlots?: number;
  readonly durableSlots?: number;
  readonly gracefulShutdownSeconds?: number;
  readonly healthPort?: number;
  /** Defaults to allowAll because tasks are the declared external-effect boundary. */
  readonly egress?: 'allowAll' | 'sameNamespace';
  readonly scaling?: { readonly mode: 'fixed' } | { readonly mode: 'kedaHatchetSlots'; readonly minReplicas?: number; readonly maxReplicas: number; readonly pollingIntervalSeconds?: number };
}

export interface ApplicationWorkflowOptions<
  TTasks extends Readonly<Record<string, ApplicationTaskReference>> = Readonly<Record<string, ApplicationTaskReference>>,
  TWorkflows extends Readonly<Record<string, ApplicationWorkflowReference>> = Readonly<Record<string, ApplicationWorkflowReference>>,
> {
  readonly tasks?: TTasks;
  readonly workflows?: TWorkflows;
  readonly crons?: readonly { readonly name?: string; readonly expression: string; readonly input: object }[];
  readonly worker?: ApplicationWorkflowWorkerOptions;
}

export type ApplicationTaskReference = { readonly kind: 'applik8sTask'; readonly id: string } | { readonly kind: 'applicationTask'; readonly definition: { readonly id: string } };
export type ApplicationWorkflowReference = { readonly kind: 'applik8sWorkflow'; readonly id: string } | { readonly kind: 'applicationWorkflow'; readonly definition: { readonly id: string } };

export type ApplicationTaskReferenceInput<TReference> = TReference extends TaskDefinition<infer TInput, infer _TOutput, infer _TErrors>
  ? TInput
  : TReference extends ApplicationTaskBinding<infer TInput, infer _TOutput, infer _TErrors>
    ? TInput
    : never;

export type ApplicationTaskReferenceOutput<TReference> = TReference extends TaskDefinition<infer _TInput, infer TOutput, infer _TErrors>
  ? TOutput
  : TReference extends ApplicationTaskBinding<infer _TInput, infer TOutput, infer _TErrors>
    ? TOutput
    : never;

export type ApplicationWorkflowReferenceInput<TReference> = TReference extends WorkflowDefinition<infer TInput, infer _TOutput, infer _TErrors, infer _TSignals>
  ? TInput
  : TReference extends ApplicationWorkflowBinding<infer TInput, infer _TOutput, infer _TErrors, infer _TSignals>
    ? TInput
    : never;

export type ApplicationWorkflowReferenceOutput<TReference> = TReference extends WorkflowDefinition<infer _TInput, infer TOutput, infer _TErrors, infer _TSignals>
  ? TOutput
  : TReference extends ApplicationWorkflowBinding<infer _TInput, infer TOutput, infer _TErrors, infer _TSignals>
    ? TOutput
    : never;

export interface ApplicationTaskBinding<TInput extends object, TOutput extends object, TErrors extends Readonly<Record<string, object>> = Readonly<Record<never, never>>> {
  readonly kind: 'applicationTask';
  readonly definition: TaskDefinition<TInput, TOutput, TErrors>;
  readonly __errors?: TErrors;
  run(input: TInput, metadata?: ApplicationWorkflowInvocationMetadata, result?: ApplicationWorkflowResultOptions): Promise<TOutput>;
  start(input: TInput, metadata?: ApplicationWorkflowInvocationMetadata): Promise<ApplicationWorkflowRun<TOutput, TErrors>>;
  schedule(input: TInput, at: Date, metadata?: ApplicationWorkflowInvocationMetadata): Promise<{ readonly id: string }>;
}

export interface ApplicationWorkflowBinding<
  TInput extends object,
  TOutput extends object,
  TErrors extends Readonly<Record<string, object>> = Readonly<Record<never, never>>,
  TSignals extends Readonly<Record<string, object>> = Readonly<Record<never, never>>,
> {
  readonly kind: 'applicationWorkflow';
  readonly definition: WorkflowDefinition<TInput, TOutput, TErrors, TSignals>;
  readonly __errors?: TErrors;
  readonly __signals?: TSignals;
  run(input: TInput, metadata?: ApplicationWorkflowInvocationMetadata, result?: ApplicationWorkflowResultOptions): Promise<TOutput>;
  start(input: TInput, metadata?: ApplicationWorkflowInvocationMetadata): Promise<ApplicationWorkflowRun<TOutput, TErrors>>;
  schedule(input: TInput, at: Date, metadata?: ApplicationWorkflowInvocationMetadata): Promise<{ readonly id: string }>;
  signal<TName extends [keyof TSignals] extends [never] ? string : keyof TSignals & string>(
    runId: string,
    name: TName,
    payload: [keyof TSignals] extends [never] ? object : TSignals[TName & keyof TSignals],
    metadata?: ApplicationWorkflowInvocationMetadata,
  ): Promise<void>;
}

export type ApplicationWorkflowHandlerRegistration =
  | { readonly kind: 'task'; readonly id: string; readonly source: string }
  | { readonly kind: 'workflow'; readonly id: string; readonly source: string; readonly tasks: Readonly<Record<string, string>>; readonly workflows: Readonly<Record<string, string>> };

export function registerApplicationTask<TInput extends object, TOutput extends object, TErrors extends Readonly<Record<string, object>>>(
  state: ApplicationWorkflowState,
  definition: TaskDefinition<TInput, TOutput, TErrors>,
  options: ApplicationTaskOptions<TInput>,
  handler: ApplicationTaskHandler<TInput, TOutput, TErrors>,
): ApplicationTaskBinding<TInput, TOutput, TErrors> {
  const taskNodeId = graphNodeId('task', definition.id);
  const handlerNodeId = graphNodeId('task-handler', definition.id);
  const serialized = workflowHandlerSerialization('task', definition.id, handler, false);
  const source = serialized.source;
  assertUniqueWorkflowHandler(state, definition.id, source);
  const engine = recordWorkflowEngine(state);
  addApplicationGraphNode(state, {
    id: taskNodeId,
    kind: 'task',
    name: definition.id,
    stability: 'stable',
    contract: durableContract(definition),
  });
  addApplicationGraphNode(state, {
    id: handlerNodeId,
    kind: 'taskHandler',
    name: definition.id,
    stability: 'stable',
    task: { nodeId: taskNodeId },
    workflowEngine: workflowEngineRef(),
    retry: {
      mode: 'boundedExponentialBackoff',
      maxAttempts: positiveInteger(options.retries === undefined ? 4 : options.retries + 1, 'task retries + initial attempt'),
      initialDelayMs: 1_000,
      maxDelayMs: positiveInteger(Math.round((options.retryBackoff?.maxSeconds ?? 60) * 1_000), 'task retry maximum delay'),
      factor: positiveNumber(options.retryBackoff?.factor ?? 2, 'task retry backoff factor'),
    },
    executionTimeoutSeconds: positiveInteger(options.executionTimeoutSeconds ?? 60, 'task executionTimeoutSeconds'),
    scheduleTimeoutSeconds: positiveInteger(options.scheduleTimeoutSeconds ?? 300, 'task scheduleTimeoutSeconds'),
    idempotency: {
      required: true,
      keySource: options.idempotencyKey ? 'inputExpression' : 'invocation',
      ...(options.idempotencyKey ? { expression: functionExpression(options.idempotencyKey, `${definition.id} idempotency key`) } : {}),
      guarantee: 'atLeastOnceRetrySafe',
    },
    effectBoundary: 'externalEffectsAllowed',
    handlerSource: source,
    ...(serialized.dependencies ? { handlerDependencies: serialized.dependencies } : {}),
    ...(serialized.location ? { sourceLocation: serialized.location } : {}),
  });
  state.workflowHandlers.set(handlerNodeId, { kind: 'task', id: definition.id, source });
  state.workflowHandlerGroups.set(handlerNodeId, workflowWorkerGroup(engine, options.worker));
  addApplicationGraphEdge(state, { from: { nodeId: handlerNodeId }, to: { nodeId: taskNodeId }, relationship: 'owns' });
  recordWorkflowWorker(state, engine, options.worker);
  return taskBinding(definition, options, () => applicationWorkflowEngineImplementation(state));
}

export function registerApplicationWorkflow<
  TInput extends object,
  TOutput extends object,
  TErrors extends Readonly<Record<string, object>>,
  TSignals extends Readonly<Record<string, object>>,
  TTasks extends Readonly<Record<string, ApplicationTaskReference>>,
  TWorkflows extends Readonly<Record<string, ApplicationWorkflowReference>>,
>(
  state: ApplicationWorkflowState,
  definition: WorkflowDefinition<TInput, TOutput, TErrors, TSignals>,
  options: ApplicationWorkflowOptions<TTasks, TWorkflows>,
  handler: ApplicationWorkflowHandler<TInput, TOutput, TErrors, TSignals, TTasks, TWorkflows>,
): ApplicationWorkflowBinding<TInput, TOutput, TErrors, TSignals> {
  const workflowNodeId = graphNodeId('workflow', definition.id);
  const handlerNodeId = graphNodeId('workflow-handler', definition.id);
  const serialized = workflowHandlerSerialization('workflow', definition.id, handler, true);
  const source = serialized.source;
  assertUniqueWorkflowHandler(state, definition.id, source);
  const engine = recordWorkflowEngine(state);
  const taskBindings = Object.entries(options.tasks ?? {}).map(([alias, value]) => ({ alias: validAlias(alias), id: taskDefinition(value).id }));
  const workflowBindings = Object.entries(options.workflows ?? {}).map(([alias, value]) => ({ alias: validAlias(alias), id: workflowDefinition(value).id }));
  addApplicationGraphNode(state, {
    id: workflowNodeId,
    kind: 'workflow',
    name: definition.id,
    stability: 'stable',
    contract: { ...durableContract(definition), signals: Object.keys(definition.signals).sort().map((name) => ({ name, schema: declaredSchema(requiredSchema(schemaRecord(definition.signals), name, `${definition.id}.signals`), `${definition.id}.signals.${name}`) })) },
    triggers: { crons: (options.crons ?? []).map((cron, index) => ({ name: kubernetesName(cron.name ?? `${definition.name}-${index + 1}`), expression: validCron(cron.expression), input: jsonObject(cron.input) })) },
  });
  addApplicationGraphNode(state, {
    id: handlerNodeId,
    kind: 'workflowHandler',
    name: definition.id,
    stability: 'stable',
    workflow: { nodeId: workflowNodeId },
    workflowEngine: workflowEngineRef(),
    tasks: taskBindings.map((binding) => ({ nodeId: graphNodeId('task', binding.id) })),
    childWorkflows: workflowBindings.map((binding) => ({ nodeId: graphNodeId('workflow', binding.id) })),
    taskBindings: taskBindings.map((binding) => ({ alias: binding.alias, task: { nodeId: graphNodeId('task', binding.id) } })),
    childWorkflowBindings: workflowBindings.map((binding) => ({ alias: binding.alias, workflow: { nodeId: graphNodeId('workflow', binding.id) } })),
    handlerSource: source,
    ...(serialized.dependencies ? { handlerDependencies: serialized.dependencies } : {}),
    ...(serialized.location ? { sourceLocation: serialized.location } : {}),
    orchestrationBoundary: 'durableEffectsThroughTasks',
    deterministicOperations: ['task', 'childWorkflow', 'sleep', 'externalEvent', 'now', 'cancellation'],
    sourceAnalysis: 'closedWorkflowAllowlist',
  });
  state.workflowHandlers.set(handlerNodeId, { kind: 'workflow', id: definition.id, source, tasks: Object.fromEntries(taskBindings.map((binding) => [binding.alias, binding.id])), workflows: Object.fromEntries(workflowBindings.map((binding) => [binding.alias, binding.id])) });
  state.workflowHandlerGroups.set(handlerNodeId, workflowWorkerGroup(engine, options.worker));
  addApplicationGraphEdge(state, { from: { nodeId: handlerNodeId }, to: { nodeId: workflowNodeId }, relationship: 'owns' });
  for (const binding of taskBindings) addApplicationGraphEdge(state, { from: { nodeId: handlerNodeId }, to: { nodeId: graphNodeId('task', binding.id) }, relationship: 'dependsOn' });
  for (const binding of workflowBindings) addApplicationGraphEdge(state, { from: { nodeId: handlerNodeId }, to: { nodeId: graphNodeId('workflow', binding.id) }, relationship: 'dependsOn' });
  recordWorkflowWorker(state, engine, options.worker);
  return workflowBinding(definition, () => applicationWorkflowEngineImplementation(state));
}

function recordWorkflowEngine(state: ApplicationWorkflowState): ApplicationWorkflowEngineProvider {
  const engine = applicationWorkflowEngineImplementation(state);
  const providerNodeId = workflowEngineRef().nodeId;
  addApplicationGraphNode(state, {
    id: providerNodeId,
    kind: 'provider',
    name: 'WorkflowEngine',
    stability: 'stable',
    interface: 'WorkflowEngine',
    implementation: applicationProviderImplementationName(engine),
    contract: {
      apiVersion: 'applik8s.provider/v1alpha1',
      interface: 'WorkflowEngine',
      version: 'v1alpha1',
      requirements: ['durableTaskExecution', 'durableWaits', 'cancellation', 'externalEvents', 'workerDrain'],
      guarantees: ['atLeastOnceTasks', 'durableWorkflowHistory', 'correlationPropagation', 'postgresOperationalAuthority'],
      implementation: { name: engine.kind },
      surface: 'stablePublicApi',
      support: 'implemented',
      diagnostics: [],
    },
    config: jsonObject({ ...engine, bindingKind: 'workflowRuntime', provider: engine.kind }),
  });
  return engine;
}

function recordWorkflowWorker(state: ApplicationWorkflowState, engine: ApplicationWorkflowEngineProvider, requested: ApplicationWorkflowWorkerOptions | undefined): void {
  const group = workflowWorkerGroup(engine, requested);
  const workerId = graphNodeId('workflow-worker', group);
  const handlers = [...state.workflowHandlers.keys()].filter((nodeId) => state.workflowHandlerGroups.get(nodeId) === group).sort().map((nodeId) => ({ nodeId }));
  const providerWorker = engine.worker ?? {};
  // typecast: retain literal scaling discriminants while normalizing author/provider defaults into the graph union.
  const scaling = requested?.scaling ?? providerWorker.scaling ?? { mode: 'fixed' as const };
  const normalizedScaling = scaling.mode === 'fixed'
    // typecast: retain the fixed-mode discriminant in the normalized graph union.
    ? { mode: 'fixed' as const }
    // typecast: retain the KEDA-mode discriminant in the normalized graph union.
    : { mode: 'kedaHatchetSlots' as const, minReplicas: scaling.minReplicas ?? 1, maxReplicas: positiveInteger(scaling.maxReplicas, 'workflow worker scaling.maxReplicas'), pollingIntervalSeconds: positiveInteger(scaling.pollingIntervalSeconds ?? 15, 'workflow worker scaling.pollingIntervalSeconds') };
  addApplicationGraphNode(state, {
    id: workerId,
    kind: 'workflowWorker',
    name: group,
    stability: 'stable',
    handlers,
    workflowEngine: workflowEngineRef(),
    runtime: 'node',
    lifecycle: 'longLived',
    deployment: {
      replicas: positiveInteger(requested?.replicas ?? providerWorker.replicas ?? 1, 'workflow worker replicas'),
      taskSlots: positiveInteger(requested?.taskSlots ?? providerWorker.taskSlots ?? 16, 'workflow worker taskSlots'),
      durableSlots: positiveInteger(requested?.durableSlots ?? providerWorker.durableSlots ?? 16, 'workflow worker durableSlots'),
      gracefulShutdownSeconds: positiveInteger(requested?.gracefulShutdownSeconds ?? providerWorker.gracefulShutdownSeconds ?? 30, 'workflow worker gracefulShutdownSeconds'),
      healthPort: positiveInteger(requested?.healthPort ?? providerWorker.healthPort ?? 8001, 'workflow worker healthPort'),
      egress: requested?.egress ?? providerWorker.egress ?? 'allowAll',
      scaling: normalizedScaling,
    },
  });
  const requirementId = `requirement.${workerId}.workflow-engine`;
  addApplicationGraphEdge(state, { from: workflowEngineRef(), to: { nodeId: workerId }, relationship: 'provides' });
  addApplicationProviderRequirement(state, {
    id: requirementId,
    interface: 'WorkflowEngine',
    consumer: { nodeId: workerId },
    provider: workflowEngineRef(),
    required: true,
    purpose: 'workflowEngine',
    diagnostics: {
      missing: `Workflow worker ${workerId} requires one WorkflowEngine provider.`,
      ambiguous: `Workflow worker ${workerId} has multiple WorkflowEngine providers; bind exactly one.`,
    },
  });
  addApplicationProviderBinding(state, {
    requirement: requirementId,
    provider: workflowEngineRef(),
    generatedResources: workflowEngineResources(engine),
    runtime: workflowEngineRuntime(engine),
  });
}

function workflowEngineRuntime(engine: ApplicationWorkflowEngineProvider): ApplicationProviderRuntimeContract {
  const name = kubernetesName(engine.name ?? 'applik8s-hatchet');
  const namespace = engine.namespace;
  const secret = engine.workerTokenSecret
    ?? engine.credentialsSecret
    ?? { apiVersion: 'v1', kind: 'Secret', name: engine.provision === false ? `${name}-worker` : `${name}-client-config`, ...(namespace ? { namespace } : {}) };
  return {
    env: {
      HATCHET_CLIENT_HOST_PORT: engine.hostPort ?? `${name}-engine${namespace ? `.${namespace}` : ''}.svc:7070`,
      HATCHET_CLIENT_API_URL: engine.apiUrl ?? `http://${name}-api${namespace ? `.${namespace}` : ''}.svc:8080`,
    },
    secretRefs: [secret],
    readiness: { dependencies: engine.provision === false ? [] : [{ apiVersion: 'apps/v1', kind: 'Deployment', name: `${name}-engine`, ...(namespace ? { namespace } : {}) }], condition: 'Hatchet API and engine report Ready', timeoutSeconds: 600 },
  };
}

function workflowEngineResources(engine: ApplicationWorkflowEngineProvider): ApplicationResourceRef[] {
  if (engine.provision === false) return [];
  const name = kubernetesName(engine.name ?? 'applik8s-hatchet');
  const namespace = engine.namespace;
  return [
    { apiVersion: 'source.toolkit.fluxcd.io/v1', kind: 'HelmRepository', name: `${name}-repository`, ...(namespace ? { namespace } : {}) },
    { apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster', name: engine.database?.clusterName ?? `${name}-db`, ...(namespace ? { namespace } : {}) },
    { apiVersion: 'helm.toolkit.fluxcd.io/v2', kind: 'HelmRelease', name, ...(namespace ? { namespace } : {}) },
  ];
}

function taskBinding<TInput extends object, TOutput extends object, TErrors extends Readonly<Record<string, object>>>(definition: TaskDefinition<TInput, TOutput, TErrors>, options: ApplicationTaskOptions<TInput>, engine: () => ApplicationWorkflowEngineProvider): ApplicationTaskBinding<TInput, TOutput, TErrors> {
  const invocationMetadata = (input: TInput, metadata: ApplicationWorkflowInvocationMetadata | undefined): ApplicationWorkflowInvocationMetadata | undefined => {
    if (metadata?.idempotencyKey || !options.idempotencyKey) return metadata;
    return { ...metadata, idempotencyKey: options.idempotencyKey(input) };
  };
  return {
    kind: 'applicationTask',
    definition,
    async run(input, metadata, result) {
      return (await applicationWorkflowRuntime(engine())).run(definition.id, validateMessage(definition.input, input, `${definition.id}.input`), invocationMetadata(input, metadata), result);
    },
    async start(input, metadata) {
      return (await applicationWorkflowRuntime(engine())).start(definition.id, validateMessage(definition.input, input, `${definition.id}.input`), invocationMetadata(input, metadata));
    },
    async schedule(input, at, metadata) {
      return (await applicationWorkflowRuntime(engine())).schedule(definition.id, validateMessage(definition.input, input, `${definition.id}.input`), at, invocationMetadata(input, metadata));
    },
  };
}

function workflowBinding<TInput extends object, TOutput extends object, TErrors extends Readonly<Record<string, object>>, TSignals extends Readonly<Record<string, object>>>(definition: WorkflowDefinition<TInput, TOutput, TErrors, TSignals>, engine: () => ApplicationWorkflowEngineProvider): ApplicationWorkflowBinding<TInput, TOutput, TErrors, TSignals> {
  return {
    kind: 'applicationWorkflow',
    definition,
    async run(input, metadata, result) {
      return (await applicationWorkflowRuntime(engine())).run(definition.id, validateMessage(definition.input, input, `${definition.id}.input`), metadata, result);
    },
    async start(input, metadata) {
      return (await applicationWorkflowRuntime(engine())).start(definition.id, validateMessage(definition.input, input, `${definition.id}.input`), metadata);
    },
    async schedule(input, at, metadata) {
      return (await applicationWorkflowRuntime(engine())).schedule(definition.id, validateMessage(definition.input, input, `${definition.id}.input`), at, metadata);
    },
    async signal(runId, name, payload, metadata) {
      const schema = schemaRecord(definition.signals)[name];
      if (!schema) throw new Error(`Workflow ${definition.id} does not declare signal ${JSON.stringify(name)}.`);
      await (await applicationWorkflowRuntime(engine())).signal(definition.id, runId, name, validateMessage(schema, payload, `${definition.id}.signals.${name}`), metadata);
    },
  };
}

function durableContract<TInput extends object, TOutput extends object>(definition: TaskDefinition<TInput, TOutput> | WorkflowDefinition<TInput, TOutput>): { readonly name: string; readonly version: string; readonly input: ApplicationMessageContractSchema; readonly output: ApplicationMessageContractSchema; readonly errors: readonly { readonly name: string; readonly schema: ApplicationMessageContractSchema }[] } {
  return {
    name: definition.name,
    version: definition.version,
    input: declaredSchema(definition.input, `${definition.id}.input`),
    output: declaredSchema(definition.output, `${definition.id}.output`),
    errors: Object.keys(definition.errors).sort().map((name) => ({ name, schema: declaredSchema(requiredSchema(schemaRecord(definition.errors), name, `${definition.id}.errors`), `${definition.id}.errors.${name}`) })),
  };
}

function declaredSchema<T extends object>(input: SchemaInput<T>, name: string): ApplicationMessageContractSchema {
  const emitted = normalizeSchema(input, name).emitJsonSchema();
  if (!emitted.ok) throw new Error(`applik8s-workflow-schema-unsupported: ${name}: ${emitted.error.message}`);
  return { kind: 'declared', runtime: 'arktype', jsonSchema: emitted.value.schema };
}

function validateMessage<T extends object>(schema: SchemaInput<T>, value: unknown, name: string): T {
  // typecast: the schema adapter accepts JSON-like unknown input and performs the authoritative runtime validation below.
  const validated = normalizeSchema(schema, name).validate(value as never);
  if (!validated.ok) throw new Error(`applik8s-workflow-schema-invalid: ${name}: ${validated.error.message}`);
  // typecast: successful schema validation is the runtime proof of the generic message type.
  return validated.value as T;
}

function workflowHandlerSerialization(kind: 'task' | 'workflow', id: string, handler: (...args: never[]) => unknown, orchestrationOnly: boolean): { readonly source: string; readonly dependencies?: { readonly source: string; readonly resolveDir: string }; readonly location?: { readonly file: string; readonly line: number; readonly column: number } } {
  const instrumented = instrumentedApplicationCallbackSource(handler);
  const extracted = instrumented
    ? { source: instrumented.source ? transpileApplicationCallbackExpression(instrumented.source) : Function.prototype.toString.call(handler), location: { file: instrumented.file, line: instrumented.line, column: instrumented.column } }
    : extractApplicationCallArgumentSource(kind, 2);
  const source = serializableHandlerSource(kind, id, extracted?.source ?? Function.prototype.toString.call(handler), orchestrationOnly);
  const unsupported = unsupportedRouteFreeIdentifiers(analyzeApplicationServerRouteSource(source), new Set());
  const dependencies = applicationRouteSourceDependencies({ id, method: 'POST', path: `/${kind}/${id}`, handlerSource: source, handlerSourceKind: extracted ? 'source' : 'functionToString', ...(extracted ? { handlerSourceLocation: extracted.location } : {}) }, unsupported, new Set());
  if (unsupported.length > 0 && !dependencies) {
    throw new Error(serializedCallbackClosureMessage({ label: `app.${kind} ${id}`, identifiers: unsupported, ...(extracted ? { sourceLocation: extracted.location } : {}), guidance: 'Move reusable helpers and imports to module scope so Applik8s can include them in the generated worker, or pass dynamic data through the task/workflow input.' }));
  }
  if (orchestrationOnly && dependencies?.source) assertWorkflowOrchestrationSource(id, dependencies.source);
  return { source, ...(dependencies ? { dependencies } : {}), ...(extracted ? { location: extracted.location } : {}) };
}

function serializableHandlerSource(kind: 'task' | 'workflow', id: string, rawSource: string, orchestrationOnly: boolean): string {
  const source = normalizeSerializableFunctionSource(rawSource.trim());
  if (!source || source.includes('[native code]')) throw new Error(`${kind} ${id} handler must be a serializable JavaScript function.`);
  try {
    Function(`return (${source});`);
  } catch (cause) {
    throw new Error(`${kind} ${id} handler cannot be serialized: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  if (orchestrationOnly) assertWorkflowOrchestrationSource(id, source);
  return source;
}

function assertWorkflowOrchestrationSource(id: string, source: string): void {
  // typecast: readonly tuples preserve the diagnostic name paired with its executable-source pattern.
  const forbidden = [
    ['fetch', /\bfetch\s*\(/], ['database clients', /\b(?:postgres|drizzle|database|db)\b/], ['Kubernetes clients', /\b(?:KubeConfig|kubernetes|kubectl)\b/],
    ['filesystem access', /\b(?:readFile|writeFile|node:fs)\b/], ['process state', /\bprocess\s*\./], ['wall clock', /\b(?:new\s+Date|Date\s*\.|Date\s*\()/],
    ['randomness', /\b(?:Math\.random|crypto\.randomUUID)\s*\(/], ['ambient timers', /\bsetTimeout\s*\(/],
  ] as const;
  const violations = forbidden.filter(([, pattern]) => pattern.test(source)).map(([name]) => name);
  if (violations.length > 0) throw new Error(`workflow ${id} orchestration uses ${violations.join(', ')}, which is not durable orchestration. Move external effects into declared app.task(...) handlers and use context.now()/context.sleep().`);
}

function functionExpression(fn: (...args: never[]) => unknown, name: string): ApplicationExpressionContract {
  const source = Function.prototype.toString.call(fn).trim();
  if (!source || source.includes('[native code]')) throw new Error(`${name} must be serializable.`);
  return { kind: 'function', source };
}

function taskDefinition(value: ApplicationTaskReference): { readonly id: string } {
  return value.kind === 'applicationTask' ? value.definition : value;
}

function workflowDefinition(value: ApplicationWorkflowReference): { readonly id: string } {
  return value.kind === 'applicationWorkflow' ? value.definition : value;
}

function schemaRecord(value: object): Readonly<Record<string, SchemaInput<object>>> {
  // typecast: mapped schema records are erased to their common schema-input value for deterministic graph serialization.
  return value as Readonly<Record<string, SchemaInput<object>>>;
}

function requiredSchema(record: Readonly<Record<string, SchemaInput<object>>>, key: string, name: string): SchemaInput<object> {
  const schema = record[key];
  if (!schema) throw new Error(`Missing declared schema ${name}.${key}.`);
  return schema;
}

function assertUniqueWorkflowHandler(state: ApplicationWorkflowState, id: string, source: string): void {
  const existing = [...state.workflowHandlers.values()].find((handler) => handler.id === id);
  if (existing && existing.source !== source) throw new Error(`Durable contract ${id} already has a different application handler.`);
  if (existing) throw new Error(`Durable contract ${id} already has an application handler.`);
}

function workflowEngineRef(): { readonly interface: 'WorkflowEngine'; readonly nodeId: string } {
  return { interface: 'WorkflowEngine', nodeId: graphNodeId('provider', 'WorkflowEngine') };
}

function graphNodeId(kind: string, name: string): string {
  return `${kind}.${kubernetesName(name)}`;
}

function kubernetesName(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
}

function validAlias(alias: string): string {
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(alias)) throw new Error(`Workflow dependency alias ${JSON.stringify(alias)} must start with a letter and contain only letters, digits, underscore, or dash.`);
  return alias;
}

function workflowWorkerGroup(engine: ApplicationWorkflowEngineProvider, requested: ApplicationWorkflowWorkerOptions | undefined): string {
  return kubernetesName(requested?.group ?? engine.name ?? 'applik8s-workflows');
}

function validCron(expression: string): string {
  const normalized = expression.trim().replace(/\s+/g, ' ');
  if (normalized.split(' ').length !== 5) throw new Error(`Workflow cron ${JSON.stringify(expression)} must contain exactly five fields.`);
  return normalized;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
  return value;
}

function positiveNumber(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive.`);
  return value;
}

function jsonObject(value: unknown): Record<string, never> {
  // typecast: JSON serialization removes undefined authoring values and leaves a provider config accepted by the graph JsonObject contract.
  return JSON.parse(JSON.stringify(value)) as Record<string, never>;
}
