// typecast-file-boundary: Workflow registration preserves generic schema inference while normalizing validated graph metadata at the registration boundary.
import { createHash } from 'node:crypto';
import { type ApplicationOperationLike, getApplicationOperationContract, isApplicationBoundOperation, isApplicationScopedOperation } from '@applik8s/client';
import { type ApplicationOperationInvocationDependency, type ApplicationProviderRuntimeContract, type ApplicationResourceRef, applicationOperationId } from '@applik8s/core';
import {
  expandApplicationCallbackDependencies,
  serializeApplicationCallback,
} from './application-callback.js';
import { inferApplicationFunctionNativeTransaction } from './application-function-native-transactions.js';
import { addApplicationGraphEdge, addApplicationGraphNode, addApplicationProviderBinding, addApplicationProviderRequirement } from './application-graph-state.js';
import type { ApplicationObjectStoreBinding } from './application-object-storage.js';
import { applicationProjectionRebuildTarget } from './application-projection-binding.js';
import { applicationCallableProviderDependencies } from './application-provider-dependencies.js';
import { type ApplicationProviderSelectionValue, type ApplicationProviderToken, type ApplicationWorkflowEngineProvider, applicationProviderImplementationName, applicationWorkflowEngineImplementation, isApplicationProviderSelection } from './application-providers.js';
import { applicationQueryBindingForOperation } from './application-queries.js';
import type { ApplicationSignalDefinition } from './application-signals.js';
import { applicationTypeKroGraphValue, applicationTypeKroString } from './application-typekro-values.js';
import type { ApplicationWorkflowTaskDefinition as TaskDefinition } from './application-workflow-internal.js';
import { declaredSchema, durableContract, functionExpression, requiredSchema, schemaRecord, validateMessage, workflowHandlerSerialization } from './application-workflow-serialization.js';
import type {
  ApplicationTaskBinding,
  ApplicationTaskHandler,
  ApplicationTaskObjectStores,
  ApplicationTaskOperationDependency,
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
import { applicationWorkflowJsonObject as jsonObject, applicationWorkflowKubernetesName as kubernetesName, positiveApplicationWorkflowInteger as positiveInteger, positiveApplicationWorkflowGraphInteger as positiveIntegerGraphValue, positiveApplicationWorkflowNumber as positiveNumber, applicationWorkflowAlias as validAlias, applicationWorkflowCron as validCron } from './application-workflow-values.js';
import type { WorkflowDefinition } from './dsl.js';
import { applicationModelCommandBindingForOperation } from './native-models.js';
import { type ApplicationStructuredGenerationProvider, isApplicationStructuredGenerationProvider, StructuredGeneration } from './structured-generation.js';
import {
  type ApplicationWorkflowInvocationMetadata,
  type ApplicationWorkflowProviderRun,
  type ApplicationWorkflowResultOptions,
  type ApplicationWorkflowRun,
  type ApplicationWorkflowScheduleSpec,
  applicationWorkflowRuntime,
} from './workflow-runtime.js';


export type {
  ApplicationTaskBinding,
  ApplicationTaskContext,
  ApplicationTaskHandler,
  ApplicationTaskObjectFunctions,
  ApplicationTaskObjectStores,
  ApplicationTaskOperationDependency,
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
export type {
  ApplicationDurableErrorDescriptor,
  ApplicationDurableErrorUnion,
  ApplicationWorkflowExecutionFailure,
  ApplicationWorkflowExecutionObservation,
  ApplicationWorkflowExecutionReference,
  ApplicationWorkflowPhase,
  ApplicationWorkflowResultOptions,
  ApplicationWorkflowRun,
} from './workflow-runtime.js';
export { ApplicationDurableError, installApplicationWorkflowRuntimeResolver, isApplicationDurableError } from './workflow-runtime.js';

const applicationWorkflowGatewayMetadataSymbol = Symbol.for(
  'applik8s.workflowGatewayMetadata',
);

export interface ApplicationWorkflowGatewayBindingMetadata {
  readonly capability: string;
  readonly contract: string;
  readonly worker: string;
  readonly namespace?: string;
  readonly port: number;
}

/** @internal Compiler/runtime metadata for resource-handler workflow capture. */
export function applicationWorkflowGatewayBindingMetadata(
  value: unknown,
): ApplicationWorkflowGatewayBindingMetadata | undefined {
  if (
    (typeof value !== 'object' && typeof value !== 'function')
    || value === null
  ) {
    return undefined;
  }
  const metadata = Reflect.get(value, applicationWorkflowGatewayMetadataSymbol);
  return metadata && typeof metadata === 'object'
    ? metadata as ApplicationWorkflowGatewayBindingMetadata
    : undefined;
}

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
  serializationOptions: {
    readonly callsiteRegistrar?: 'task' | 'workflow';
    readonly callsiteArgumentIndexes?: readonly number[];
    readonly injectedIdentifiers?: readonly string[];
  } = {},
): ApplicationTaskBinding<TInput, TOutput, TErrors> {
  const taskNodeId = graphNodeId('task', definition.id);
  const handlerNodeId = graphNodeId('task-handler', definition.id);
  const engine = recordApplicationWorkflowEngine(state);
  const capabilities = recordTaskCapabilities(state, handlerNodeId, options.requires ?? []);
  if (options.operations && options.authority) {
    throw new Error(`Task ${definition.id} must use direct-call authority or deprecated operations aliases, not both.`);
  }
  const directDependencies = normalizeTaskDirectDependencies(
    options.authority ?? [],
    options.__generatedCalls ?? [],
    options.__generatedBindings,
  );
  const inferredDependencies = expandApplicationCallbackDependencies({
    calls: options.__generatedCalls,
    bindings: options.__generatedBindings,
  });
  const providerBindings = applicationCallableProviderDependencies(
    inferredDependencies.bindings,
  );
  const functionNativeTransaction = inferApplicationFunctionNativeTransaction(
    state,
    `Application task ${definition.id}`,
    inferredDependencies,
    'durable-task-invocation',
  );
  const signalBindings = inferredApplicationSignalBindings(
    options.__generatedCalls ?? [],
    options.__generatedBindings,
  );
  const operations = recordTaskOperations(state, handlerNodeId, options.operations ?? directDependencies.operations);
  const queries = recordTaskQueries(handlerNodeId, options.queries ?? directDependencies.queries);
  const projections = recordTaskProjections(
    handlerNodeId,
    { ...directDependencies.projections, ...(options.projections ?? {}) },
  );
	const objects = recordTaskObjects(handlerNodeId, { ...directDependencies.objects, ...(options.objects ?? {}) });
  const actors = recordTaskActors(state, handlerNodeId, directDependencies.actors);
  if (options.identity && options.principal) {
    throw new Error(`Task ${definition.id} must use canonical options.identity or deprecated options.principal, not both.`);
  }
  if (operations.length + queries.length > 0 && !options.identity && !options.principal) {
    throw new Error(`Task ${definition.id} declares authenticated operations or queries and requires options.identity.`);
  }
  if (operations.length + queries.length === 0 && (options.identity || options.principal)) {
    throw new Error(`Task ${definition.id} declares an execution identity without any authenticated operations or queries.`);
  }
  const operationPrincipal = options.principal ? serializeApplicationCallback({
    registrar: 'task', argumentIndex: 1, property: 'principal', label: `Task ${definition.id} operation principal`,
    callback: options.principal as (...args: never[]) => unknown, allowDeferredResolution: true,
  }) : undefined;
  const injectedIdentifiers = [
    ...operations.map(({ alias }) => alias),
    ...queries.map(({ alias }) => alias),
    ...projections.map(({ alias }) => alias),
    ...objects.map(({ alias }) => alias),
    ...actors.map(({ alias }) => alias),
    ...providerBindings.map(({ identifier }) => identifier),
    ...signalBindings.map(({ alias }) => alias),
    ...(signalBindings.length > 0 ? ['workflow'] : []),
    ...(functionNativeTransaction?.modelBindings ?? [])
      .map(({ identifier }) => identifier),
    ...(functionNativeTransaction?.eventBindings ?? [])
      .map(({ identifier }) => identifier),
    ...(serializationOptions.injectedIdentifiers ?? []),
  ]
    .flatMap((identifier) => [
      identifier,
      identifier.split('.')[0] ?? identifier,
    ])
    .filter(
      (identifier, index, values) =>
        identifier.length > 0 && values.indexOf(identifier) === index,
    );
  const serialized = workflowHandlerSerialization(
    'task',
    definition.id,
    handler,
    false,
    {
      ...serializationOptions,
      injectedIdentifiers,
    },
  );
  const source = serialized.source;
  assertUniqueWorkflowHandler(state, definition.id, source);
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
    ...(options.identity ? { serviceIdentity: options.identity.identity } : {}),
    ...(capabilities.length > 0 ? { capabilities: capabilities.map(({ reference }) => reference) } : {}),
    ...(providerBindings.length > 0 ? { providerBindings } : {}),
    ...(operations.length > 0 ? { operations } : {}),
    ...(queries.length > 0 ? { queries } : {}),
    ...(projections.length > 0 ? { projections } : {}),
		...(objects.length > 0 ? { objects } : {}),
    ...(actors.length > 0 ? { actors } : {}),
    ...(signalBindings.length > 0 ? { signalBindings } : {}),
    ...(functionNativeTransaction ? { functionNativeTransaction } : {}),
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
  for (const provider of providerBindings) {
    addApplicationGraphEdge(state, {
      from: { nodeId: provider.provider.nodeId },
      to: { nodeId: handlerNodeId },
      relationship: 'provides',
    });
  }
  if (functionNativeTransaction) {
    for (const model of functionNativeTransaction.models) {
      addApplicationGraphEdge(state, {
        from: { nodeId: handlerNodeId },
        to: model,
        relationship: 'dependsOn',
      });
    }
    for (const event of functionNativeTransaction.outbox) {
      addApplicationGraphEdge(state, {
        from: { nodeId: handlerNodeId },
        to: event,
        relationship: 'emits',
      });
    }
  }
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
  for (const actor of actors) addApplicationGraphEdge(state, { from: { nodeId: handlerNodeId }, to: actor.actor, relationship: 'dependsOn' });
  recordWorkflowWorker(state, engine, options.worker);
  return withWorkflowGatewayMetadata(
    taskBinding(definition, options, () => applicationWorkflowEngineImplementation(state)),
    definition.id,
    engine,
    options.worker,
  );
}

function recordTaskActors(
  state: ApplicationWorkflowState,
  consumerNodeId: string,
  actors: Readonly<Record<string, { readonly actorId: string; readonly member: string }>>,
): readonly {
  readonly alias: string;
  readonly actor: { readonly nodeId: string };
  readonly member: string;
  readonly memberKind: 'command' | 'message' | 'alarm';
}[] {
  return Object.entries(actors).sort(([left], [right]) => left.localeCompare(right)).map(([alias, binding]) => {
    if (!alias.trim()) throw new Error(`Task ${consumerNodeId} actor aliases must not be empty.`);
    const actor = state.graphNodes.find((candidate) => candidate.kind === 'actor' && candidate.definition.id === binding.actorId);
    if (actor?.kind !== 'actor') throw new Error(`Task ${consumerNodeId} actor ${alias} references undeclared actor ${binding.actorId}. Declare the actor before the workflow.`);
    const member = actor.definition.protocol.find((candidate) => candidate.name === binding.member);
    if (!member || (member.kind !== 'command' && member.kind !== 'message' && member.kind !== 'alarm')) {
      throw new Error(`Task ${consumerNodeId} actor ${alias} references unsupported actor member ${binding.actorId}.${binding.member}. Durable tasks may call commands, send messages, or schedule alarms.`);
    }
    return { alias, actor: { nodeId: actor.id }, member: binding.member, memberKind: member.kind };
  });
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

function normalizeTaskDirectDependencies(
  authority: readonly ApplicationTaskOperationDependency[],
  generatedCalls: readonly unknown[],
  generatedBindings?: Readonly<Record<string, unknown>>,
): {
  readonly operations: ApplicationTaskOperations;
  readonly queries: ApplicationTaskQueries;
  readonly projections: ApplicationTaskProjections;
  readonly objects: ApplicationTaskObjectStores;
  readonly actors: Readonly<Record<string, { readonly actorId: string; readonly member: string }>>;
} {
  const operations: Record<string, ApplicationTaskOperationDependency> = {};
  const queries: Record<string, ApplicationOperationLike> = {};
  const projections: Record<string, import('./application-workflow-types.js').ApplicationTaskProjectionTarget> = {};
  const objects: Record<string, ApplicationObjectStoreBinding> = {};
  const actors: Record<string, { readonly actorId: string; readonly member: string }> = {};
  const expanded = expandApplicationCallbackDependencies({
    calls: generatedCalls,
    bindings: generatedBindings,
  });
  const identifiersFor = (value: unknown, fallback: string): readonly string[] => {
    const identifiers = Object.entries(expanded.bindings)
      .filter(
        ([identifier, candidate]) =>
          candidate === value && !/^generatedCall\d+$/.test(identifier),
      )
      .map(([identifier]) => identifier);
    return identifiers.length > 0 ? identifiers : [fallback];
  };
  for (const dependency of authority) {
    const operation = isApplicationBoundOperation(dependency) || isApplicationScopedOperation(dependency)
      ? dependency.operation
      : dependency;
    const query = applicationQueryBindingForOperation(operation);
    if (query) {
      for (const identifier of identifiersFor(operation, query.id)) {
        queries[identifier] = operation;
      }
      continue;
    }
    const contract = getApplicationOperationContract(operation);
    if (!contract) throw new Error('Direct workflow authority accepts only application operation or query handles.');
    const actor = applicationActorOperation(contract);
    if (actor) {
      for (const identifier of identifiersFor(operation, `${actor.actorId}.${actor.member}`)) actors[identifier] = actor;
      continue;
    }
    for (const identifier of identifiersFor(operation, contract.id)) {
      operations[identifier] = dependency;
    }
  }
  for (const candidate of expanded.calls) {
    if (
      candidate
      && typeof candidate === 'object'
      && Reflect.get(candidate, 'kind') === 'applicationProjection'
      && Reflect.get(candidate, 'storage') === 'online'
      && typeof Reflect.get(candidate, 'name') === 'string'
    ) {
      const target = applicationProjectionRebuildTarget(candidate);
      if (!target) {
        throw new Error(
          `Projection ${String(Reflect.get(candidate, 'name'))} is called from a workflow but has no rebuild source.`,
        );
      }
      for (const identifier of identifiersFor(
        candidate,
        String(Reflect.get(candidate, 'name')),
      )) {
        projections[identifier] = {
          projection: candidate as import('./application-reactive.js').ApplicationOnlineProjectionBinding,
          artifacts: target.artifacts,
          ...(target.bounds ? { bounds: target.bounds } : {}),
        };
      }
      continue;
    }
    if (
      candidate
      && typeof candidate === 'object'
      && Reflect.get(candidate, 'kind') === 'applicationObjectStore'
      && typeof Reflect.get(candidate, 'name') === 'string'
    ) {
      const store = candidate as ApplicationObjectStoreBinding;
      for (const identifier of identifiersFor(candidate, store.name)) {
        objects[identifier] = store;
      }
      continue;
    }
    const query = applicationQueryBindingForOperation(candidate);
    if (query) {
      for (const identifier of identifiersFor(candidate, query.id)) {
        queries[identifier] = candidate as ApplicationOperationLike;
      }
    }
    const actor = applicationActorOperation(contractForCandidate(candidate));
    if (actor) {
      for (const identifier of identifiersFor(candidate, `${actor.actorId}.${actor.member}`)) actors[identifier] = actor;
    }
  }
  return {
    operations: Object.freeze(operations),
    queries: Object.freeze(queries),
    projections: Object.freeze(projections),
    objects: Object.freeze(objects),
    actors: Object.freeze(actors),
  };
}

function contractForCandidate(candidate: unknown): ReturnType<typeof getApplicationOperationContract> {
  return typeof candidate === 'function'
    ? getApplicationOperationContract(candidate as unknown as ApplicationOperationLike)
    : undefined;
}

function applicationActorOperation(
  contract: ReturnType<typeof getApplicationOperationContract>,
): { readonly actorId: string; readonly member: string } | undefined {
  if (!contract || contract.transport !== 'runtime') return undefined;
  const match = /^applik8s:\/\/actors\/([^/]+)\/operations\/([^/]+)$/u.exec(contract.id);
  return match?.[1] && match[2] ? { actorId: match[1], member: match[2] } : undefined;
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
): readonly {
  readonly alias: string;
  readonly command: { readonly nodeId: string };
  readonly handler: { readonly nodeId: string };
  readonly authority: ApplicationOperationInvocationDependency;
}[] {
  return Object.entries(operations).sort(([left], [right]) => left.localeCompare(right)).map(([alias, dependency]) => {
    if (!alias.trim()) throw new Error(`Task ${consumerNodeId} durable operation aliases must not be empty.`);
    if (!isApplicationBoundOperation(dependency) && !isApplicationScopedOperation(dependency)) {
      throw new Error(`Task ${consumerNodeId} operation ${alias} is unbounded. Use .on(...), .where(...), .all(), or terminal .onInput(...); a bare dependency never implies broad workload authority.`);
    }
    if (isApplicationBoundOperation(dependency) && dependency.source !== 'input') {
      throw new Error(`Task ${consumerNodeId} operation ${alias} must use onInput(...); ${dependency.source} bindings belong to their corresponding processor or reconciler.`);
    }
    const operation = isApplicationBoundOperation(dependency) || isApplicationScopedOperation(dependency)
      ? dependency.operation
      : dependency;
    const binding = applicationModelCommandBindingForOperation(operation);
    if (!binding) throw new Error(`Task ${consumerNodeId} operation ${alias} is not a registered durable model mutation.`);
    const command = { nodeId: graphNodeId('command', binding.command) };
    const handler = state.graphNodes.find((candidate) => candidate.kind === 'commandHandler' && candidate.command.nodeId === command.nodeId && candidate.name === binding.name);
    if (handler?.kind !== 'commandHandler') throw new Error(`Task ${consumerNodeId} operation ${alias} cannot resolve command handler ${binding.name}. Declare the model operation before the task.`);
    const operationId = applicationOperationId({
      domain: 'models',
      owner: operation.operation.model,
      operation: operation.operation.name,
    });
    const executionBinding = isApplicationBoundOperation(dependency)
      ? {
          apiVersion: 'applik8s.executionBinding/v1alpha1' as const,
          id: `${consumerNodeId}.${alias}`,
          revision: createHash('sha256').update(JSON.stringify({
            source: dependency.source,
            sourceCode: dependency.projectionSource,
            boundKeys: [...dependency.boundKeys].sort(),
          })).digest('hex'),
          operationId,
          source: dependency.source,
          projectionDigest: createHash('sha256').update(dependency.projectionSource).digest('hex'),
          projectionSource: dependency.projectionSource,
          boundKeys: [...dependency.boundKeys].sort(),
          inferred: false,
          provenance: { nodeId: consumerNodeId },
        }
      : undefined;
    return {
      alias,
      command,
      handler: { nodeId: handler.id },
      authority: {
        apiVersion: 'applik8s.operationDependency/v1alpha1',
        alias,
        operationId,
        invocation: 'context.invoke',
        authorization: 'reauthorize',
        restrictions: {
          target: dependency.target,
          predicates: dependency.predicates,
        },
        ...(executionBinding ? { binding: executionBinding } : {}),
        terminal: true,
      },
    };
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
    (otherwise, [key, candidate]) =>
      `(${selection.selector}) == ${JSON.stringify(key)} ? (${JSON.stringify(field(candidate))}) : (${otherwise})`,
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
  serializationOptions: { readonly extractCallsite?: boolean } = {},
): ApplicationWorkflowBinding<TInput, TOutput, TErrors, TSignals> {
  const workflowNodeId = graphNodeId('workflow', definition.id);
  const handlerNodeId = graphNodeId('workflow-handler', definition.id);
  const inferredCalls = expandApplicationCallbackDependencies({
    calls: options.__generatedCalls,
    bindings: options.__generatedBindings,
  });
  const inferredBindings = inferredCalls.bindings;
  const inferredValues = inferredCalls.calls;
  const inferredInjectedIdentifiers = Object.entries(inferredBindings)
    .filter(([, value]) =>
      (typeof value === 'function'
        && new Set(['applicationTask', 'applicationWorkflow']).has(
          String(Reflect.get(value, 'kind')),
        ))
      || (value !== null
        && typeof value === 'object'
        && new Set(['applicationSignal', 'applicationSignalDefinition']).has(
          String(
            Reflect.get(value, 'signalKind')
            ?? Reflect.get(value, 'kind'),
          ),
        )))
    .map(([identifier]) => identifier);
  const serialized = workflowHandlerSerialization(
    'workflow',
    definition.id,
    handler,
    true,
    {
      ...serializationOptions,
      injectedIdentifiers: inferredInjectedIdentifiers,
    },
  );
  const source = serialized.source;
  assertUniqueWorkflowHandler(state, definition.id, source);
  const engine = recordApplicationWorkflowEngine(state);
  const inferredTasks = inferredValues.filter(
    (value): value is ApplicationTaskBinding<object, object> =>
      typeof value === 'function' && Reflect.get(value, 'kind') === 'applicationTask',
  );
  const inferredWorkflows = inferredValues.filter(
    (value): value is ApplicationWorkflowBinding<object, object> =>
      typeof value === 'function' && Reflect.get(value, 'kind') === 'applicationWorkflow',
  );
  const inferredSignals = inferredValues.flatMap((value) => {
    if (
      value
      && typeof value === 'object'
      && Reflect.get(value, 'signalKind') === 'applicationSignal'
    ) {
      return [
        {
          value,
          definition: Reflect.get(value, 'signal') as ApplicationSignalDefinition,
        },
      ];
    }
    if (
      value
      && typeof value === 'object'
      && Reflect.get(value, 'kind') === 'applicationSignalDefinition'
    ) {
      return [
        {
          value,
          definition: value as ApplicationSignalDefinition,
        },
      ];
    }
    return [];
  });
  const taskBindings = uniqueWorkflowDependencies([
    ...Object.entries(options.tasks ?? {}).map(([alias, value]) => ({ alias: validAlias(alias), id: taskDefinition(value).id })),
    ...inferredTasks.flatMap((value) => {
      const identifiers = Object.entries(inferredBindings)
        .filter(
          ([identifier, candidate]) =>
            candidate === value && !/^generatedCall\d+$/.test(identifier),
        )
        .map(([identifier]) => validAlias(identifier));
      return (identifiers.length > 0
        ? identifiers
        : [applicationGeneratedDependencyAlias(value.definition.id)])
        .map((alias) => ({ alias, id: value.definition.id }));
    }),
  ]);
  const workflowBindings = uniqueWorkflowDependencies([
    ...Object.entries(options.workflows ?? {}).map(([alias, value]) => ({ alias: validAlias(alias), id: workflowDefinition(value).id })),
    ...inferredWorkflows.flatMap((value) => {
      const identifiers = Object.entries(inferredBindings)
        .filter(
          ([identifier, candidate]) =>
            candidate === value && !/^generatedCall\d+$/.test(identifier),
        )
        .map(([identifier]) => validAlias(identifier));
      return (identifiers.length > 0
        ? identifiers
        : [applicationGeneratedDependencyAlias(value.definition.id)])
        .map((alias) => ({ alias, id: value.definition.id }));
    }),
  ]);
  const signalBindings = inferredSignals.flatMap(({ value, definition: signal }) => {
    const identifiers = Object.entries(inferredBindings)
      .filter(
        ([identifier, candidate]) =>
          candidate === value && !/^generatedCall\d+$/.test(identifier),
      )
      .map(([identifier]) => validAlias(identifier));
    return (identifiers.length > 0
      ? identifiers
      : [applicationGeneratedDependencyAlias(signal.id)]
    ).map((alias) => ({
      alias,
      id: signal.id,
      name: signal.name,
      version: signal.version,
      input: declaredSchema(signal.input, `${signal.id}.input`),
      actions: Object.keys(signal.actions)
        .sort()
        .map((name) => {
          const action = signal.actions[name];
          if (!action) {
            throw new Error(
              `Signal ${signal.id} action ${name} disappeared during graph normalization.`,
            );
          }
          return {
            name,
            schema: declaredSchema(
              action,
              `${signal.id}.actions.${name}`,
            ),
          };
        }),
    }));
  });
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
    ...(signalBindings.length > 0 ? { signalBindings } : {}),
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
  return withWorkflowGatewayMetadata(
    workflowBinding(definition, () => applicationWorkflowEngineImplementation(state)),
    definition.id,
    engine,
    options.worker,
  );
}

/**
 * Lowers a workflow whose entire body is one retryable effect step.
 *
 * This is the function-native authoring path for the common case: authors
 * declare only a workflow and attach the step's capabilities to that workflow.
 * The graph still contains a separate task boundary because Hatchet must retry
 * external effects independently from durable orchestration history.
 */
export function registerApplicationSingleStepWorkflow<
  TInput extends object,
  TOutput extends object,
  TErrors extends Readonly<Record<string, object>>,
  TSignals extends Readonly<Record<string, object>>,
  TOperations extends ApplicationTaskOperations,
  TQueries extends ApplicationTaskQueries,
  TProjections extends ApplicationTaskProjections,
  TObjects extends ApplicationTaskObjectStores,
>(
  state: ApplicationWorkflowState,
  definition: WorkflowDefinition<TInput, TOutput, TErrors, TSignals>,
  options: ApplicationTaskOptions<TInput, TOperations, TQueries, TProjections, TObjects>,
  handler: ApplicationTaskHandler<TInput, TOutput, TErrors, TOperations, TQueries, TProjections, TObjects>,
): ApplicationWorkflowBinding<TInput, TOutput, TErrors, TSignals> {
  if (Object.keys(definition.signals).length > 0) {
    throw new Error(
      `Workflow ${definition.id} declares signals and cannot use single-step lowering. `
      + 'Use the durable orchestration overload so signal waits remain in workflow history.',
    );
  }
  const stepDefinition: TaskDefinition<TInput, TOutput, TErrors> = {
    kind: 'applik8sTask',
    id: `${definition.id}.step`,
    name: `${definition.name}.step`,
    version: definition.version,
    input: definition.input,
    output: definition.output,
    errors: definition.errors,
  };
  const step = registerApplicationTask(state, stepDefinition, options, handler, {
    callsiteRegistrar: 'workflow',
    callsiteArgumentIndexes: [3, 2],
  });
  async function run(input: TInput, context: import('./application-workflow-types.js').ApplicationWorkflowContext<{ readonly run: typeof step }, Readonly<Record<never, never>>, Readonly<Record<never, never>>, TErrors>): Promise<TOutput> {
    return context.task('run', input, { idempotencyKey: context.invocationId });
  }
  return registerApplicationWorkflow(
    state,
    definition,
    { tasks: { run: step }, ...(options.worker ? { worker: options.worker } : {}) },
    run,
    { extractCallsite: false },
  );
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
    ?? { apiVersion: 'v1', kind: 'Secret', name: engine.provision === false ? `${name}-worker` : 'hatchet-client-config', ...(namespace ? { namespace } : {}) };
  return {
    env: {
      HATCHET_CLIENT_HOST_PORT: engine.hostPort ?? applicationTypeKroString('hatchet-engine', namespace ? '.' : '', namespace, '.svc:7070'),
      HATCHET_CLIENT_API_URL: engine.apiUrl ?? applicationTypeKroString('http://hatchet-api', namespace ? '.' : '', namespace, '.svc:8080'),
    },
    secretRefs: [secret],
    readiness: { dependencies: engine.provision === false ? [] : [{ apiVersion: 'apps/v1', kind: 'Deployment', name: 'hatchet-engine', ...(namespace ? { namespace } : {}) }], condition: 'Hatchet API and engine report Ready', timeoutSeconds: 600 },
  };
}

function workflowEngineResources(engine: ApplicationWorkflowEngineProvider): ApplicationResourceRef[] {
  if (engine.provision === false) return [];
  const name = kubernetesName(engine.name ?? 'applik8s-hatchet');
  const namespace = engine.namespace;
  return [
    { apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster', name: engine.database?.clusterName ?? `${name}-db`, ...(namespace ? { namespace } : {}) },
    { apiVersion: 'helm.toolkit.fluxcd.io/v2', kind: 'HelmRelease', name: 'hatchet', ...(namespace ? { namespace } : {}) },
  ];
}

function taskBinding<TInput extends object, TOutput extends object, TErrors extends Readonly<Record<string, object>>>(definition: TaskDefinition<TInput, TOutput, TErrors>, options: ApplicationTaskOptions<TInput>, engine: () => ApplicationWorkflowEngineProvider): ApplicationTaskBinding<TInput, TOutput, TErrors> {
  const invocationMetadata = (input: TInput, metadata: ApplicationWorkflowInvocationMetadata | undefined): ApplicationWorkflowInvocationMetadata | undefined => {
    if (metadata?.idempotencyKey || !options.idempotencyKey) return metadata;
    return { ...metadata, idempotencyKey: options.idempotencyKey(input) };
  };
  const run = async (input: TInput, metadata?: ApplicationWorkflowInvocationMetadata, result?: ApplicationWorkflowResultOptions) =>
    (await applicationWorkflowRuntime(engine())).run(
      definition.id,
      validateMessage(definition.input, input, `${definition.id}.input`),
      invocationMetadata(input, metadata),
      result,
    );
  return Object.assign(run, {
    kind: 'applicationTask',
    definition,
    run,
    async start(input: TInput, metadata?: ApplicationWorkflowInvocationMetadata) {
      const providerRun = await (await applicationWorkflowRuntime(engine())).start<TInput, TOutput, TErrors>(
        definition.id,
        validateMessage(definition.input, input, `${definition.id}.input`),
        invocationMetadata(input, metadata),
      );
      return applicationWorkflowRun(providerRun, definition.id, definition.version);
    },
    async schedule(input: TInput, at: Date, metadata?: ApplicationWorkflowInvocationMetadata) {
      return (await applicationWorkflowRuntime(engine())).schedule(definition.id, validateMessage(definition.input, input, `${definition.id}.input`), at, invocationMetadata(input, metadata));
    },
    async reconcile(schedule: ApplicationWorkflowScheduleSpec<TInput>, metadata?: ApplicationWorkflowInvocationMetadata) {
      return (await applicationWorkflowRuntime(engine())).reconcileSchedule(
        definition.id,
        { ...schedule, input: validateMessage(definition.input, schedule.input, `${definition.id}.input`) },
        invocationMetadata(schedule.input, metadata),
      );
    },
  }) as ApplicationTaskBinding<TInput, TOutput, TErrors>;
}

function workflowBinding<TInput extends object, TOutput extends object, TErrors extends Readonly<Record<string, object>>, TSignals extends Readonly<Record<string, object>>>(definition: WorkflowDefinition<TInput, TOutput, TErrors, TSignals>, engine: () => ApplicationWorkflowEngineProvider): ApplicationWorkflowBinding<TInput, TOutput, TErrors, TSignals> {
  const run = async (input: TInput, metadata?: ApplicationWorkflowInvocationMetadata, result?: ApplicationWorkflowResultOptions) =>
    (await applicationWorkflowRuntime(engine())).run(
      definition.id,
      validateMessage(definition.input, input, `${definition.id}.input`),
      metadata,
      result,
    );
  return Object.assign(run, {
    kind: 'applicationWorkflow',
    definition,
    run,
    async start(input: TInput, metadata?: ApplicationWorkflowInvocationMetadata) {
      const providerRun = await (await applicationWorkflowRuntime(engine())).start<TInput, TOutput, TErrors>(
        definition.id,
        validateMessage(definition.input, input, `${definition.id}.input`),
        metadata,
      );
      return applicationWorkflowRun(providerRun, definition.id, definition.version);
    },
    async schedule(input: TInput, at: Date, metadata?: ApplicationWorkflowInvocationMetadata) {
      return (await applicationWorkflowRuntime(engine())).schedule(definition.id, validateMessage(definition.input, input, `${definition.id}.input`), at, metadata);
    },
    async reconcile(schedule: ApplicationWorkflowScheduleSpec<TInput>, metadata?: ApplicationWorkflowInvocationMetadata) {
      return (await applicationWorkflowRuntime(engine())).reconcileSchedule(
        definition.id,
        { ...schedule, input: validateMessage(definition.input, schedule.input, `${definition.id}.input`) },
        metadata,
      );
    },
    async signal<TName extends [keyof TSignals] extends [never] ? string : keyof TSignals & string>(
      runId: string,
      name: TName,
      payload: [keyof TSignals] extends [never] ? object : TSignals[TName & keyof TSignals],
      metadata?: ApplicationWorkflowInvocationMetadata,
    ) {
      const schema = schemaRecord(definition.signals)[name];
      if (!schema) throw new Error(`Workflow ${definition.id} does not declare signal ${JSON.stringify(name)}.`);
      await (await applicationWorkflowRuntime(engine())).signal(definition.id, runId, name, validateMessage(schema, payload, `${definition.id}.signals.${name}`), metadata);
    },
  }) as ApplicationWorkflowBinding<TInput, TOutput, TErrors, TSignals>;
}

function applicationWorkflowRun<
  TOutput extends object,
  TErrors extends Readonly<Record<string, object>>,
>(
  providerRun: ApplicationWorkflowProviderRun<TOutput, TErrors>,
  workflow: string,
  workflowRevision: string,
): ApplicationWorkflowRun<TOutput, TErrors> {
  const reference = Object.freeze({
    provider: 'workflow' as const,
    workflow,
    run: providerRun.id,
  });
  return Object.freeze({
    id: providerRun.id,
    reference,
    workflowRevision,
    ...(providerRun.__idempotencyKey
      ? { __idempotencyKey: providerRun.__idempotencyKey }
      : {}),
    result: (options?: ApplicationWorkflowResultOptions) =>
      providerRun.result(options),
    cancel: (
      options?: Omit<ApplicationWorkflowResultOptions, 'pollIntervalMs'>,
    ) => providerRun.cancel(options),
    ...(providerRun.__cancelReference
      ? {
          __cancelReference: (
            runId: string,
            options?: Omit<ApplicationWorkflowResultOptions, 'pollIntervalMs'>,
          ) => providerRun.__cancelReference?.(runId, options) as Promise<void>,
        }
      : {}),
    async observe(options?: ApplicationWorkflowResultOptions) {
      if (!providerRun.observe) {
        throw new Error(
          `Workflow provider cannot observe ${workflow} run ${providerRun.id} without waiting for its terminal result.`,
        );
      }
      const observation = await providerRun.observe(options);
      return Object.freeze({
        ...observation,
        reference,
        workflowRevision,
      });
    },
  });
}

function taskDefinition(value: ApplicationTaskReference): { readonly id: string } {
  return value.kind === 'applicationTask' ? value.definition : value;
}

function workflowDefinition(value: ApplicationWorkflowReference): { readonly id: string } {
  return value.kind === 'applicationWorkflow' ? value.definition : value;
}

function uniqueWorkflowDependencies(
  dependencies: readonly { readonly alias: string; readonly id: string }[],
): readonly { readonly alias: string; readonly id: string }[] {
  const byId = new Map<string, { readonly alias: string; readonly id: string }>();
  for (const dependency of dependencies) {
    const existing = byId.get(dependency.id);
    if (existing && existing.alias !== dependency.alias) continue;
    byId.set(dependency.id, dependency);
  }
  return [...byId.values()];
}

/**
 * Compiler-owned aliases must satisfy the normalized graph's legacy alias
 * grammar, but they are never part of the authored API. Hashing the complete
 * semantic contract ID makes the lowering collision-resistant without
 * leaking graph naming constraints back into direct TypeScript calls.
 */
export function applicationGeneratedDependencyAlias(id: string): string {
  return `direct_${createHash('sha256').update(id).digest('hex').slice(0, 16)}`;
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

function withWorkflowGatewayMetadata<TBinding extends object>(
  binding: TBinding,
  contract: string,
  engine: ApplicationWorkflowEngineProvider,
  requested: ApplicationWorkflowWorkerOptions | undefined,
): TBinding {
  const healthPort = positiveInteger(
    requested?.healthPort ?? engine.worker?.healthPort ?? 8001,
    'workflow health port',
  );
  if (healthPort >= 65_535) {
    throw new Error('workflow health port must leave room for the private workflow gateway port');
  }
  const metadata: ApplicationWorkflowGatewayBindingMetadata = Object.freeze({
    capability: `applik8s-wf-${createHash('sha256').update(workflowWorkerGroup(engine, requested)).digest('hex').slice(0, 16)}`,
    contract,
    worker: workflowWorkerGroup(engine, requested),
    ...(engine.namespace ? { namespace: engine.namespace } : {}),
    port: healthPort + 1,
  });
  Object.defineProperty(binding, applicationWorkflowGatewayMetadataSymbol, {
    value: metadata,
    enumerable: false,
    configurable: false,
  });
  return binding;
}

function inferredApplicationSignalBindings(
  calls: readonly unknown[],
  bindings: Readonly<Record<string, unknown>> | undefined,
) {
  const expanded = expandApplicationCallbackDependencies({ calls, bindings });
  const definitions = new Map<
    string,
    {
      readonly value: object;
      readonly definition: ApplicationSignalDefinition;
    }
  >();
  for (const value of expanded.calls) {
    if (
      value
      && typeof value === 'object'
      && Reflect.get(value, 'signalKind') === 'applicationSignal'
    ) {
      const definition = Reflect.get(value, 'signal') as ApplicationSignalDefinition;
      definitions.set(definition.id, { value, definition });
    } else if (
      value
      && typeof value === 'object'
      && Reflect.get(value, 'kind') === 'applicationSignalDefinition'
    ) {
      const definition = value as ApplicationSignalDefinition;
      definitions.set(definition.id, { value, definition });
    }
  }
  return [...definitions.values()].flatMap(({ value, definition: signal }) => {
    const identifiers = Object.entries(expanded.bindings)
      .filter(
        ([identifier, candidate]) =>
          candidate === value && !/^generatedCall\d+$/.test(identifier),
      )
      .map(([identifier]) => validAlias(identifier));
    return (
      identifiers.length > 0
        ? identifiers
        : [applicationGeneratedDependencyAlias(signal.id)]
    ).map((alias) => ({
      alias,
      id: signal.id,
      name: signal.name,
      version: signal.version,
      input: declaredSchema(signal.input, `${signal.id}.input`),
      actions: Object.keys(signal.actions)
        .sort()
        .map((name) => {
          const action = signal.actions[name];
          if (!action) {
            throw new Error(
              `Signal ${signal.id} action ${name} disappeared during graph normalization.`,
            );
          }
          return {
            name,
            schema: declaredSchema(
              action,
              `${signal.id}.actions.${name}`,
            ),
          };
        }),
    }));
  });
}
