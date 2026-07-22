// typecast-file-boundary: Workflow authoring preserves generic schema inference while normalizing validated graph metadata at the registration boundary.
import type { ApplicationProviderRuntimeContract, ApplicationResourceRef } from '@applik8s/core';
import { serializeApplicationCallback } from './application-callback.js';
import { addApplicationGraphEdge, addApplicationGraphNode, addApplicationProviderBinding, addApplicationProviderRequirement } from './application-graph-state.js';
import { type ApplicationProviderSelectionValue, type ApplicationProviderToken, type ApplicationWorkflowEngineProvider, applicationProviderImplementationName, applicationWorkflowEngineImplementation, isApplicationProviderSelection } from './application-providers.js';
import { applicationQueryBindingForOperation } from './application-queries.js';
import { applicationTypeKroGraphValue, applicationTypeKroString } from './application-typekro-values.js';
import { applicationWorkflowAlias as validAlias, applicationWorkflowCron as validCron, applicationWorkflowJsonObject as jsonObject, applicationWorkflowKubernetesName as kubernetesName, positiveApplicationWorkflowGraphInteger as positiveIntegerGraphValue, positiveApplicationWorkflowInteger as positiveInteger, positiveApplicationWorkflowNumber as positiveNumber } from './application-workflow-values.js';
import { declaredSchema, durableContract, functionExpression, requiredSchema, schemaRecord, validateMessage, workflowHandlerSerialization } from './application-workflow-serialization.js';
import type {
  ApplicationTaskBinding,
  ApplicationTaskHandler,
	ApplicationTaskObjectStores,
  ApplicationTaskOperations,
  ApplicationTaskOptions,
  ApplicationTaskProjections,
  ApplicationTaskQueries,
  ApplicationTaskReference,
  ApplicationWorkflowBinding,
  ApplicationWorkflowHandler,
  ApplicationWorkflowOptions,
  ApplicationWorkflowReference,
  ApplicationWorkflowState,
  ApplicationWorkflowWorkerOptions,
} from './application-workflow-types.js';
import type { TaskDefinition, WorkflowDefinition } from './dsl.js';
import { applicationModelCommandBindingForOperation } from './native-models.js';
import { type ApplicationStructuredGenerationProvider, isApplicationStructuredGenerationProvider, StructuredGeneration } from './structured-generation.js';
import { type ApplicationWorkflowInvocationMetadata, applicationWorkflowRuntime } from './workflow-runtime.js';


export type {
  ApplicationTaskBinding,
  ApplicationTaskContext,
  ApplicationTaskHandler,
  ApplicationTaskObjectFunctions,
  ApplicationTaskObjectStores,
  ApplicationTaskOperationFunctions,
  ApplicationTaskOperations,
  ApplicationTaskOptions,
  ApplicationTaskProjectionFunctions,
  ApplicationTaskProjections,
  ApplicationTaskProjectionTarget,
  ApplicationTaskQueries,
  ApplicationTaskQueryFunctions,
  ApplicationTaskReference,
  ApplicationTaskReferenceInput,
  ApplicationTaskReferenceOutput,
  ApplicationTaskServicePrincipal,
  ApplicationWorkflowBinding,
  ApplicationWorkflowContext,
  ApplicationWorkflowHandler,
  ApplicationWorkflowHandlerRegistration,
  ApplicationWorkflowOptions,
  ApplicationWorkflowReference,
  ApplicationWorkflowReferenceInput,
  ApplicationWorkflowReferenceOutput,
  ApplicationWorkflowState,
  ApplicationWorkflowWorkerOptions,
} from './application-workflow-types.js';
export type { ApplicationDurableErrorDescriptor, ApplicationDurableErrorUnion, ApplicationWorkflowResultOptions } from './workflow-runtime.js';
export { ApplicationDurableError, isApplicationDurableError } from './workflow-runtime.js';

export function registerApplicationTask<
  TInput extends object,
  TOutput extends object,
  TErrors extends Readonly<Record<string, object>>,
  TOperations extends ApplicationTaskOperations,
  TQueries extends ApplicationTaskQueries,
  TProjections extends ApplicationTaskProjections,
	TObjects extends ApplicationTaskObjectStores,
>(
  state: ApplicationWorkflowState,
  definition: TaskDefinition<TInput, TOutput, TErrors>,
  options: ApplicationTaskOptions<TInput, TOperations, TQueries, TProjections, TObjects>,
  handler: ApplicationTaskHandler<TInput, TOutput, TErrors, TOperations, TQueries, TProjections, TObjects>,
): ApplicationTaskBinding<TInput, TOutput, TErrors> {
  const taskNodeId = graphNodeId('task', definition.id);
  const handlerNodeId = graphNodeId('task-handler', definition.id);
  const serialized = workflowHandlerSerialization('task', definition.id, handler, false);
  const source = serialized.source;
  assertUniqueWorkflowHandler(state, definition.id, source);
  const engine = recordApplicationWorkflowEngine(state);
  const capabilities = recordTaskCapabilities(state, handlerNodeId, options.requires ?? []);
  const operations = recordTaskOperations(state, handlerNodeId, options.operations ?? {});
  const queries = recordTaskQueries(handlerNodeId, options.queries ?? {});
  const projections = recordTaskProjections(handlerNodeId, options.projections ?? {});
	const objects = recordTaskObjects(handlerNodeId, options.objects ?? {});
  if (operations.length + queries.length > 0 && !options.principal) throw new Error(`Task ${definition.id} declares authenticated operations or queries and must derive an Applik8s service principal with options.principal.`);
  if (operations.length + queries.length === 0 && options.principal) throw new Error(`Task ${definition.id} declares options.principal without any authenticated operations or queries.`);
  const operationPrincipal = options.principal ? serializeApplicationCallback({
    registrar: 'task', argumentIndex: 1, property: 'principal', label: `Task ${definition.id} operation principal`,
    callback: options.principal as (...args: never[]) => unknown, allowDeferredResolution: true,
  }) : undefined;
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
    ...(capabilities.length > 0 ? { capabilities: capabilities.map(({ reference }) => reference) } : {}),
    ...(operations.length > 0 ? { operations } : {}),
    ...(queries.length > 0 ? { queries } : {}),
    ...(projections.length > 0 ? { projections } : {}),
		...(objects.length > 0 ? { objects } : {}),
    ...(operationPrincipal ? {
      operationPrincipalSource: operationPrincipal.source,
      ...(operationPrincipal.dependencies ? { operationPrincipalDependencies: operationPrincipal.dependencies } : {}),
      ...(operationPrincipal.location ? { operationPrincipalLocation: operationPrincipal.location } : {}),
      ...(operationPrincipal.unresolved ? { operationPrincipalUnresolved: operationPrincipal.unresolved } : {}),
    } : {}),
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
  for (const capability of capabilities) addApplicationGraphEdge(state, { from: capability.reference, to: { nodeId: handlerNodeId }, relationship: 'provides' });
  for (const operation of operations) addApplicationGraphEdge(state, { from: { nodeId: handlerNodeId }, to: operation.command, relationship: 'writes' });
  for (const query of queries) addApplicationGraphEdge(state, { from: { nodeId: handlerNodeId }, to: query.query, relationship: 'reads' });
  for (const projection of projections) {
    addApplicationGraphEdge(state, { from: { nodeId: handlerNodeId }, to: projection.projection, relationship: 'writes' });
    addApplicationGraphEdge(state, { from: { nodeId: handlerNodeId }, to: projection.artifacts, relationship: 'writes' });
  }
	for (const object of objects) {
		addApplicationGraphEdge(state, { from: { nodeId: handlerNodeId }, to: object.store, relationship: 'reads' });
		addApplicationGraphEdge(state, { from: { nodeId: handlerNodeId }, to: object.store, relationship: 'writes' });
	}
  recordWorkflowWorker(state, engine, options.worker);
  return taskBinding(definition, options, () => applicationWorkflowEngineImplementation(state));
}

function recordTaskObjects(
	consumerNodeId: string,
	objects: ApplicationTaskObjectStores,
): readonly { readonly alias: string; readonly store: { readonly nodeId: string } }[] {
	return Object.entries(objects).sort(([left], [right]) => left.localeCompare(right)).map(([alias, store]) => {
		if (!alias.trim()) throw new Error(`Task ${consumerNodeId} object aliases must not be empty.`);
		if (store.kind !== 'applicationObjectStore') throw new Error(`Task ${consumerNodeId} object ${alias} is not an application object store.`);
		return { alias, store: { nodeId: `objectStore.${store.name}` } };
	});
}

function recordTaskProjections(
  consumerNodeId: string,
  projections: ApplicationTaskProjections,
): readonly {
  readonly alias: string;
  readonly projection: { readonly nodeId: string };
  readonly artifacts: { readonly nodeId: string };
  readonly bounds: { readonly batchSize: number; readonly maxSegments: number; readonly maxSegmentBytes: number; readonly maxEvents: number; readonly maxCatchUpRounds: number };
}[] {
  return Object.entries(projections).sort(([left], [right]) => left.localeCompare(right)).map(([alias, target]) => {
    if (!alias.trim()) throw new Error(`Task ${consumerNodeId} projection aliases must not be empty.`);
    if (target.projection.storage !== 'online') throw new Error(`Task ${consumerNodeId} projection ${alias} must be a generation-scoped online projection.`);
    const projection = { nodeId: `projection.${target.projection.name.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}` };
    const artifacts = { nodeId: `objectStore.${target.artifacts.name}` };
    // Builder replay can materialize tasks before projections/object stores.
    // The concrete bindings above prove authoring registration; final graph
    // validation resolves these exact references after all replay phases.
    return {
      alias,
      projection,
      artifacts,
      bounds: {
        batchSize: boundedTaskProjectionInteger(target.bounds?.batchSize ?? 500, 1, 1_000, `${alias}.batchSize`),
        maxSegments: boundedTaskProjectionInteger(target.bounds?.maxSegments ?? 10_000, 1, 100_000, `${alias}.maxSegments`),
        maxSegmentBytes: boundedTaskProjectionInteger(target.bounds?.maxSegmentBytes ?? Math.min(8_000_000, target.artifacts.maxObjectBytes), 1_024, target.artifacts.maxObjectBytes, `${alias}.maxSegmentBytes`),
        maxEvents: boundedTaskProjectionInteger(target.bounds?.maxEvents ?? 10_000_000, 1, 100_000_000, `${alias}.maxEvents`),
        maxCatchUpRounds: boundedTaskProjectionInteger(target.bounds?.maxCatchUpRounds ?? 16, 1, 1_000, `${alias}.maxCatchUpRounds`),
      },
    };
  });
}

function boundedTaskProjectionInteger(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`Task projection ${name} must be between ${minimum} and ${maximum}.`);
  return value;
}

function recordTaskQueries(
  consumerNodeId: string,
  queries: ApplicationTaskQueries,
): readonly { readonly alias: string; readonly query: { readonly nodeId: string } }[] {
  return Object.entries(queries).sort(([left], [right]) => left.localeCompare(right)).map(([alias, operation]) => {
    if (!alias.trim()) throw new Error(`Task ${consumerNodeId} query aliases must not be empty.`);
    const binding = applicationQueryBindingForOperation(operation);
    if (!binding) throw new Error(`Task ${consumerNodeId} query ${alias} is not a registered application view.`);
    // Query graph IDs preserve the versioned/public operation ID verbatim;
    // unlike Kubernetes workload names they must not be DNS-normalized.
    const query = { nodeId: `query.${binding.id}` };
    // Native model views are materialized in the builder's behavior replay,
    // after declarations such as tasks. The operation binding is already
    // proof that the author registered a view; final graph validation checks
    // that this exact reference resolves after every replay phase completes.
    return { alias, query };
  });
}

function recordTaskOperations(
  state: ApplicationWorkflowState,
  consumerNodeId: string,
  operations: ApplicationTaskOperations,
): readonly { readonly alias: string; readonly command: { readonly nodeId: string }; readonly handler: { readonly nodeId: string } }[] {
  return Object.entries(operations).sort(([left], [right]) => left.localeCompare(right)).map(([alias, operation]) => {
    if (!alias.trim()) throw new Error(`Task ${consumerNodeId} durable operation aliases must not be empty.`);
    const binding = applicationModelCommandBindingForOperation(operation);
    if (!binding) throw new Error(`Task ${consumerNodeId} operation ${alias} is not a registered durable model mutation.`);
    const command = { nodeId: graphNodeId('command', binding.command) };
    const handler = state.graphNodes.find((candidate) => candidate.kind === 'commandHandler' && candidate.command.nodeId === command.nodeId && candidate.name === binding.name);
    if (handler?.kind !== 'commandHandler') throw new Error(`Task ${consumerNodeId} operation ${alias} cannot resolve command handler ${binding.name}. Declare the model operation before the task.`);
    return { alias, command, handler: { nodeId: handler.id } };
  });
}

function recordTaskCapabilities(
  state: ApplicationWorkflowState,
  consumerNodeId: string,
  tokens: readonly ApplicationProviderToken<unknown>[],
): readonly { readonly reference: { readonly interface: string; readonly nodeId: string } }[] {
  const seen = new Set<string>();
  return tokens.map((token) => {
    if (!token.contract) throw new Error(`Task capability ${token.name} must declare a versioned provider contract.`);
    if (seen.has(token.name)) throw new Error(`Task ${consumerNodeId} declares capability ${token.name} more than once.`);
    seen.add(token.name);
    if ((token as unknown) !== StructuredGeneration) {
      throw new Error(`Task capability ${token.name} has no generated runtime adapter. StructuredGeneration is the currently supported task-injected capability.`);
    }
    const implementation = state.providers.extensions?.[`${token.contract.interface}@${token.contract.version}`];
    if (!isStructuredGenerationProviderOrSelection(implementation)) {
      throw new Error(`Task ${consumerNodeId} requires StructuredGeneration, but the application has not provided StructuredGeneration.http(...) or .deterministic(...).`);
    }
    const reference = { interface: token.contract.interface, nodeId: graphNodeId('provider', token.contract.interface) };
    addApplicationGraphNode(state, {
      id: reference.nodeId,
      kind: 'provider',
      name: token.contract.interface,
      stability: 'stable',
      interface: token.contract.interface,
      implementation: applicationProviderImplementationName(implementation),
      contract: {
        ...token.contract,
        implementation: { name: applicationProviderImplementationName(implementation) },
        surface: 'stablePublicApi',
        support: 'implemented',
        diagnostics: [],
      },
      config: jsonObject({ ...applicationTypeKroGraphValue(implementation) as object, bindingKind: 'taskCapability' }),
    });
    const requirementId = `requirement.${consumerNodeId}.${kubernetesName(token.contract.interface)}`;
    addApplicationProviderRequirement(state, {
      id: requirementId,
      interface: token.contract.interface,
      consumer: { nodeId: consumerNodeId },
      provider: reference,
      required: true,
      purpose: 'taskCapability',
      diagnostics: {
        missing: `Task ${consumerNodeId} requires ${token.contract.interface}.`,
        ambiguous: `Task ${consumerNodeId} has multiple ${token.contract.interface} providers; bind exactly one.`,
      },
    });
    addApplicationProviderBinding(state, {
      requirement: requirementId,
      provider: reference,
      generatedResources: [],
      runtime: structuredGenerationRuntime(implementation),
    });
    return { reference };
  });
}

function isStructuredGenerationProviderOrSelection(
  value: unknown,
): value is ApplicationStructuredGenerationProvider | ApplicationProviderSelectionValue<ApplicationStructuredGenerationProvider> {
  if (isApplicationStructuredGenerationProvider(value)) return true;
  if (!isApplicationProviderSelection(value)) return false;
  return [...Object.values(value.cases), value.default].every(isApplicationStructuredGenerationProvider);
}

function structuredGenerationRuntime(
  provider: ApplicationStructuredGenerationProvider | ApplicationProviderSelectionValue<ApplicationStructuredGenerationProvider>,
): ApplicationProviderRuntimeContract {
  if (isApplicationProviderSelection(provider)) {
    const candidates = [...Object.values(provider.cases), provider.default];
    return {
      env: {
        APPLIK8S_STRUCTURED_GENERATION_PROVIDER: structuredGenerationSelectionExpression(provider, (candidate) => candidate.kind),
      },
      secretRefs: candidates.flatMap((candidate) => candidate.kind === 'structured-generation-http' && candidate.credentialSecret ? [candidate.credentialSecret] : []),
      readiness: { dependencies: [], condition: 'the selected endpoint is verified by the generated task on invocation', timeoutSeconds: 45 },
    };
  }
  if (provider.kind === 'structured-generation-deterministic') return { env: { APPLIK8S_STRUCTURED_GENERATION_PROVIDER: provider.kind } };
  return {
    env: {
      APPLIK8S_STRUCTURED_GENERATION_PROVIDER: provider.kind,
      APPLIK8S_STRUCTURED_GENERATION_ENDPOINT: applicationTypeKroString(provider.endpoint),
    },
    ...(provider.credentialSecret ? { secretRefs: [provider.credentialSecret] } : {}),
    readiness: { dependencies: [], condition: 'endpoint is verified by the generated task on invocation', timeoutSeconds: provider.timeoutSeconds ?? 45 },
  };
}

function structuredGenerationSelectionExpression(
  selection: ApplicationProviderSelectionValue<ApplicationStructuredGenerationProvider>,
  field: (provider: ApplicationStructuredGenerationProvider) => string,
): string {
  const expression = Object.entries(selection.cases).reduceRight(
    (otherwise, [key, candidate]) => `${selection.selector} == ${JSON.stringify(key)} ? ${JSON.stringify(field(candidate))} : (${otherwise})`,
    JSON.stringify(field(selection.default)),
  );
  return `\${${expression}}`;
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
  const engine = recordApplicationWorkflowEngine(state);
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

/** Internal cross-runtime registration seam for schedule/effect consumers. */
export function recordApplicationWorkflowEngine(state: ApplicationWorkflowState): ApplicationWorkflowEngineProvider {
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
      replicas: positiveIntegerGraphValue(requested?.replicas ?? providerWorker.replicas ?? 1, 'workflow worker replicas'),
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
    ?? { apiVersion: 'v1', kind: 'Secret', name: engine.provision === false ? `${name}-worker` : 'hatchet-client-config', ...(namespace ? { namespace } : {}) };
  return {
    env: {
      HATCHET_CLIENT_HOST_PORT: engine.hostPort ?? applicationTypeKroString(name, '-engine', namespace ? '.' : '', namespace, '.svc:7070'),
      HATCHET_CLIENT_API_URL: engine.apiUrl ?? applicationTypeKroString('http://', name, '-api', namespace ? '.' : '', namespace, '.svc:8080'),
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

function taskDefinition(value: ApplicationTaskReference): { readonly id: string } {
  return value.kind === 'applicationTask' ? value.definition : value;
}

function workflowDefinition(value: ApplicationWorkflowReference): { readonly id: string } {
  return value.kind === 'applicationWorkflow' ? value.definition : value;
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

function workflowWorkerGroup(engine: ApplicationWorkflowEngineProvider, requested: ApplicationWorkflowWorkerOptions | undefined): string {
  return kubernetesName(requested?.group ?? engine.name ?? 'applik8s-workflows');
}
