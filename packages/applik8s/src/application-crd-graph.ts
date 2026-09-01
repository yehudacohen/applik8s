// typecast-file-boundary: Graph lowering erases heterogeneous model generics after discriminant and schema validation.
import type { AnyResourceDefinition, ApplicationManagedModelContract, ApplicationMessageContractSchema } from '@applik8s/core';
import { serializeApplicationCallback } from './application-callback.js';
import { type ApplicationGraphState, addApplicationGraphEdge, addApplicationGraphNode, addApplicationProviderRequirement } from './application-graph-state.js';
import { applicationProviderGraphNodeId, kubernetesNameSegment } from './application-identifiers.js';
import { applicationManagedModelConditionTypes, assertApplicationManagedModelConditionOwnership, managedModelStoreRequirement } from './application-managed-models.js';
import {
  getApplicationModelFacet,
  type KubernetesApplicationModelFacet,
} from './native-models.js';

/** Records the provider-neutral graph contract for a Kubernetes-backed application model. */
export function recordApplicationCrdGraph(
  state: ApplicationGraphState,
  name: string,
  resource: Pick<AnyResourceDefinition, 'apiVersion' | 'kind' | 'plural' | 'scope'> & Partial<AnyResourceDefinition>,
): void {
  const model = getApplicationModelFacet<object, string, never, never>(resource);
  const kubernetesModel = model?.native === 'kubernetes-resource'
    ? model as KubernetesApplicationModelFacet<object>
    : undefined;
  const create = kubernetesModel?.create;
  const createSchema = create ? resource.spec?.emitJsonSchema() : undefined;
  if (createSchema && !createSchema.ok) {
    throw new Error(`Kubernetes model ${name} create input schema could not be emitted: ${createSchema.error.message}`);
  }
  const createAuthorization = create
    ? serializeApplicationCallback({ registrar: 'crd', argumentIndex: 1, property: 'authorize', label: `Kubernetes model ${name} create authorization`, callback: create.authorize as (...args: never[]) => unknown, allowDeferredResolution: true })
    : undefined;
  const createPlacement = create
    ? serializeApplicationCallback({ registrar: 'crd', argumentIndex: 1, property: 'place', label: `Kubernetes model ${name} create placement`, callback: create.place as (...args: never[]) => unknown, allowDeferredResolution: true })
    : undefined;
  addApplicationGraphNode(state, {
    id: `crd.${kubernetesNameSegment(name)}`,
    kind: 'crd',
    name,
    stability: 'stable',
    materialization: 'kubernetes-crd',
    resource: { apiVersion: resource.apiVersion, kind: resource.kind, plural: resource.plural, scope: resource.scope },
    ...(model?.native === 'kubernetes-resource' ? {
      native: {
        kind: 'kubernetes-resource' as const,
        authority: 'kubernetes' as const,
        artifact: { name: `${resource.apiVersion}/${resource.kind}` },
        schemaAuthority: 'arktype' as const,
        runtimeSchema: 'declared-arktype' as const,
        nativeApi: 'preserved' as const,
      },
      common: {
        identity: model.identity,
        ...(model.revision ? { revision: model.revision } : {}),
        snapshot: { shape: 'identity-value-revision' as const, revisionOptional: true as const },
        changes: { authority: 'kubernetes-watch' as const, rawWrites: 'observed' as const },
        relationships: model.relationships,
        operations: [{
          name: 'create',
          operation: 'create' as const,
          transport: 'command' as const,
          publicId: `${model.name}.create`,
          ...(createSchema?.ok ? { input: { kind: 'declared' as const, runtime: 'arktype' as const, jsonSchema: createSchema.value.schema } } : {}),
          authorization: create ? 'application-defined' as const : 'undeclared' as const,
        }],
        ...(model.access ? { access: { context: model.access.context, enforcement: 'kubernetes-namespace-label' as const, providerField: model.access.namespaceLabel } } : {}),
      },
      ...(create && createSchema?.ok && createAuthorization && createPlacement ? {
        create: {
          kind: 'kubernetes-create' as const,
          input: { kind: 'declared' as const, runtime: 'arktype' as const, jsonSchema: createSchema.value.schema },
          authorize: serializedApplicationGraphCallback(createAuthorization),
          place: serializedApplicationGraphCallback(createPlacement),
        },
      } : {}),
    } : {}),
  });
}

/** Records portable reconciliation only once a Kubernetes model actually declares it. */
export function recordApplicationCrdManagedHandler(
  state: ApplicationGraphState,
  resource: Pick<AnyResourceDefinition, 'apiVersion' | 'kind' | 'status' | 'statusConvention'>,
  event: 'reconcile' | 'finalize',
  args: readonly unknown[],
): void {
  const index = state.graphNodes.findIndex((candidate) =>
    candidate.kind === 'crd'
    && candidate.resource.apiVersion === resource.apiVersion
    && candidate.resource.kind === resource.kind,
  );
  const node = state.graphNodes[index];
  if (index < 0 || !node || node.kind !== 'crd') {
    throw new Error(`Kubernetes managed model ${resource.apiVersion}/${resource.kind} has no application CRD graph node.`);
  }
  const handler = args[0];
  if (typeof handler !== 'function') {
    throw new Error(`Kubernetes managed model ${node.name} ${event} handler must be a function.`);
  }
  const serialized = serializeApplicationCallback({
    registrar: event === 'reconcile' ? 'Resource.on.reconcile' : 'Resource.on.finalize',
    argumentIndex: 0,
    property: 'handler',
    label: `Kubernetes managed model ${node.name} ${event} handler`,
    callback: handler as (...args: never[]) => unknown,
    allowDeferredResolution: true,
  });
  const conditionTypes = applicationManagedModelConditionTypes(node.name, event, serialized.source);
  const existing = node.managed ?? applicationKubernetesManagedModelContract(node.name, resource);
  assertApplicationManagedModelConditionOwnership(node.name, existing, conditionTypes);
  if (event === 'reconcile' && existing.reconcile) {
    throw new Error(`Kubernetes managed model ${node.name} may declare only one reconcile handler.`);
  }
  const callback = {
    handlerSource: serialized.source,
    ...(serialized.dependencies ? { handlerDependencies: serialized.dependencies } : {}),
    ...(serialized.location ? { handlerLocation: serialized.location } : {}),
    ...(serialized.unresolved ? { handlerUnresolved: serialized.unresolved } : {}),
    conditionTypes,
  };
  let managed: ApplicationManagedModelContract;
  if (event === 'reconcile') {
    managed = { ...existing, reconcile: callback };
  } else {
    const options = args[1];
    const finalizer = options && typeof options === 'object' ? Reflect.get(options, 'finalizer') : undefined;
    if (typeof finalizer !== 'string' || !finalizer.trim()) {
      throw new Error(`Kubernetes managed model ${node.name} finalizer must be declared explicitly.`);
    }
    if (existing.finalizers.some((candidate) => candidate.name === finalizer)) {
      throw new Error(`Kubernetes managed model ${node.name} finalizer ${finalizer} is already registered.`);
    }
    managed = { ...existing, finalizers: [...existing.finalizers, { name: finalizer, ...callback }] };
  }
  state.graphNodes[index] = { ...node, managed };
  recordIntegratedKubernetesManagedModelProviders(state, managed);
  recordApplicationKubernetesManagedModelRequirements(state, node.id, node.name, managed);
  state.onChange?.();
}

function recordIntegratedKubernetesManagedModelProviders(
  state: ApplicationGraphState,
  contract: ApplicationManagedModelContract,
): void {
  const cluster = { kind: 'current-kubernetes-cluster' as const };
  if (!state.graphNodes.some((node) => node.id === contract.store.nodeId)) {
    addApplicationGraphNode(state, {
      id: contract.store.nodeId,
      kind: 'provider',
      name: 'ManagedModelStore',
      stability: 'stable',
      interface: 'ManagedModelStore',
      implementation: 'kubernetes-managed-model-store',
      config: { kind: 'kubernetes-managed-model-store', cluster },
    });
  }
  if (!state.graphNodes.some((node) => node.id === contract.runtime.nodeId)) {
    addApplicationGraphNode(state, {
      id: contract.runtime.nodeId,
      kind: 'provider',
      name: 'OperatorRuntime',
      stability: 'stable',
      interface: 'OperatorRuntime',
      implementation: 'kubernetes-operator-runtime',
      config: { kind: 'kubernetes-operator-runtime', cluster },
    });
  }
}

function applicationKubernetesManagedModelContract(
  name: string,
  resource: Pick<AnyResourceDefinition, 'status' | 'statusConvention'>,
): ApplicationManagedModelContract {
  if (!resource.status) {
    throw new Error(`Kubernetes managed model ${name} requires a status subresource.`);
  }
  const emitted = resource.status.emitJsonSchema();
  if (!emitted.ok) {
    throw new Error(`Kubernetes managed model ${name} status schema cannot be serialized: ${emitted.error.message}`);
  }
  const status: ApplicationMessageContractSchema = {
    kind: 'declared',
    runtime: 'arktype',
    jsonSchema: emitted.value.schema,
  };
  const store = managedModelStoreRequirement(name);
  return {
    status,
    statusSchemaVersion: 'kubernetes-resource-status-v1',
    store: {
      interface: 'ManagedModelStore',
      nodeId: applicationProviderGraphNodeId('ManagedModelStore', store.qualification),
    },
    runtime: {
      interface: 'OperatorRuntime',
      nodeId: applicationProviderGraphNodeId('OperatorRuntime'),
    },
    lifecycle: {
      generation: 'kubernetesMetadataGeneration',
      notification: 'invalidationHint',
      resync: { intervalSeconds: 300, maximumItems: 500 },
      lease: { durationSeconds: 60, fencing: 'uidGenerationResourceVersion' },
      status: 'schemaCompleteCompareAndSet',
      conditions: 'singleWriterPerStaticType',
      nextDue: 'operatorOwned',
      deletion: 'intentThenFinalize',
    },
    finalizers: [],
    portability: 'portable',
    activation: 'providerNative',
  };
}

function recordApplicationKubernetesManagedModelRequirements(
  state: ApplicationGraphState,
  modelNodeId: string,
  modelName: string,
  contract: ApplicationManagedModelContract,
): void {
  addApplicationProviderRequirement(state, {
    id: `${modelNodeId}.managed-store`,
    interface: 'ManagedModelStore',
    consumer: { nodeId: modelNodeId },
    provider: contract.store,
    required: true,
    purpose: 'managedModelStore',
    diagnostics: {
      missing: `Kubernetes managed model ${modelName} requires ${modelName}.store to be provided with ManagedModelStore.kubernetes(...).`,
      ambiguous: `Kubernetes managed model ${modelName} has more than one store binding. Provide exactly ${modelName}.store.`,
    },
  });
  addApplicationProviderRequirement(state, {
    id: `${modelNodeId}.operator-runtime`,
    interface: 'OperatorRuntime',
    consumer: { nodeId: modelNodeId },
    provider: contract.runtime,
    required: true,
    purpose: 'operatorRuntime',
    diagnostics: {
      missing: `Kubernetes managed model ${modelName} requires OperatorRuntime.kubernetes(...).`,
      ambiguous: `Kubernetes managed model ${modelName} has more than one unqualified OperatorRuntime provider.`,
    },
  });
  addApplicationGraphEdge(state, { from: { nodeId: contract.store.nodeId }, to: { nodeId: modelNodeId }, relationship: 'provides' });
  addApplicationGraphEdge(state, { from: { nodeId: contract.runtime.nodeId }, to: { nodeId: modelNodeId }, relationship: 'provides' });
}

function serializedApplicationGraphCallback(callback: ReturnType<typeof serializeApplicationCallback>) {
  return {
    source: callback.source,
    ...(callback.dependencies ? { dependencies: callback.dependencies } : {}),
    ...(callback.location ? { location: callback.location } : {}),
    ...(callback.unresolved ? { unresolved: callback.unresolved } : {}),
  };
}
