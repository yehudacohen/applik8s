import { toKubernetesStructuralOpenApiSchema, validateStructuralOpenApiSchema } from '@applik8s/compiler/kubernetes-schema';
import type { AnyResourceDefinition, AnyResourceVersionDefinition, CapabilityClientSet, ConcurrencyConfig, DeleteTargetOptions, FinalizeHandlerOptions, Handler, HandlerEventType, HandlerRegistration, JsonObject, NormalizedOperationPlan, ObjectRef, OperatorDefinition, OperatorDeploymentOptions, OperatorManifest, PartialStatus, PermissionRule, ProxyHandler, ResourceDefinition, ResourceEventSources, ResourceWatchAddress, Result, StatusConvention } from '@applik8s/core';
import type { CallableOperator } from '@applik8s/sdk';
import { sdk, setOperatorDeploymentInterceptor } from '@applik8s/sdk';
import { imageRefString } from '@applik8s/typetainer';
import type { Type } from 'arktype';
import { type as arktype } from 'arktype';
import type { CallableComposition, Enhanced, KroCompatibleType, KubernetesResource, MagicAssignableShape, PrerequisiteResource, PublicFactoryOptions, ResourceStatus, SerializationOptions } from 'typekro';
import { createResource, kubernetesComposition as createTypeKroComposition } from 'typekro';
import { clusterRole as typeKroClusterRole, clusterRoleBinding as typeKroClusterRoleBinding, customResourceDefinition as typeKroCustomResourceDefinition, deployment as typeKroDeployment, role as typeKroRole, roleBinding as typeKroRoleBinding, serviceAccount as typeKroServiceAccount } from 'typekro/kubernetes';
import type {
  Applik8sTypeKroAdapterApi,
  InferTypeKroRbacFunction,
  TypeKroAdapterOptions,
  TypeKroAddressedResource,
  TypeKroAggregateResourceEventSources,
  TypeKroAggregateScopedListenerResource,
  TypeKroEnhancedResourceAliasMapForResources,
  TypeKroEnhancedResourceFactory,
  TypeKroEnhancedResourceMapForResources,
  TypeKroGraph,
  TypeKroGraphAdapter,
  TypeKroGraphAdapterOptionsArgument,
  TypeKroGroupedResourceEventSources,
  TypeKroListenerComposition,
  TypeKroListenerCompositionDefinition,
  TypeKroListenerOperatorOptions,
  TypeKroListenerResource,
  TypeKroListenerResourceOptions,
  TypeKroListenerSelector,
  TypeKroOperationTarget,
  TypeKroOperationTargetFactory,
  TypeKroOperationTargetSource,
  TypeKroOperationTargetSpec,
  TypeKroOperatorComposition,
  TypeKroOperatorInstallBinding,
  TypeKroOperatorInstallSpec,
  TypeKroOperatorInstallStatus,
  TypeKroPermissionsFunction,
  TypeKroResolveOperatorInstallsOptions,
  TypeKroResourceDefinitionMap,
  TypeKroResourceInput,
  UniversalTypeKroGraphAdapter,
} from './interfaces.js';

interface KubernetesLikeResource {
  readonly apiVersion: string;
  readonly kind: string;
  readonly metadata: { readonly name: string; readonly namespace?: string };
  readonly [key: string]: unknown;
}

interface TypeKroResourcePlanEntry {
  readonly id: string;
  readonly resource: KubernetesLikeResource;
  readonly deployable: Record<string, unknown>;
}

interface TypeKroDependencyGraphLike {
  getTopologicalOrder(): string[];
  getDependencies(id: string): string[];
}

interface KubernetesManifestResource<TSpec extends object = JsonObject, TStatus extends object = JsonObject> {
  readonly apiVersion: string;
  readonly kind: string;
  readonly metadata: { readonly name: string; readonly namespace?: string; readonly labels?: Record<string, string>; readonly annotations?: Record<string, string> };
  readonly spec?: TSpec;
  readonly status?: TStatus;
  readonly id?: string;
  readonly rules?: JsonObject[];
  readonly roleRef?: JsonObject;
  readonly subjects?: JsonObject[];
}

interface DeploymentStatusProjection {
  readonly availableReplicas: number;
  readonly readyReplicas: number;
}

interface DeploymentSpecProjection {
  readonly replicas: number;
}

const installSpecSchema = arktype({
  'namespace?': 'string',
  'replicas?': 'number.integer',
  'config?': 'Record<string, unknown>',
});

const installStatusSchema = arktype({
  ready: 'boolean',
  phase: "'Pending' | 'Installing' | 'Ready' | 'Failed'",
  'message?': 'string',
  'observedBundleDigest?': 'string',
});

type CreateInstallComposition = (
  definition: {
    readonly name: string;
    readonly apiVersion: string;
    readonly group?: string;
    readonly kind: string;
    readonly spec: Type<TypeKroOperatorInstallSpec>;
    readonly status: Type<TypeKroOperatorInstallStatus>;
  },
  compositionFn: (spec: TypeKroOperatorInstallSpec) => TypeKroOperatorInstallStatus,
  options?: PublicFactoryOptions
) => CallableComposition<TypeKroOperatorInstallSpec, TypeKroOperatorInstallStatus>;

type CreateListenerComposition = <TSpec extends KroCompatibleType, TStatus extends KroCompatibleType>(
  definition: TypeKroListenerCompositionDefinition<TSpec, TStatus>,
  compositionFn: (spec: TSpec) => MagicAssignableShape<TStatus>,
  options?: SerializationOptions
) => CallableComposition<TSpec, TStatus>;

// typecast: TypeKro's public declaration recursively expands ArkType schemas in this adapter boundary; this narrower shape matches the runtime API we call.
const createListenerComposition = createTypeKroComposition as unknown as CreateListenerComposition;

interface ListenerGroup {
  readonly resources: Map<string, AnyResourceDefinition>;
  readonly handlers: HandlerRegistration<object, object, CapabilityClientSet>[];
  readonly operatorInstalls: CapturedOperatorInstall[];
}

interface CapturedOperatorInstall {
  readonly operatorName: string;
  readonly operator: unknown;
  readonly deployment?: OperatorDeploymentOptions;
  readonly binding: import('./interfaces.js').TypeKroErasedOperatorInstallBinding;
}

interface ListenerCompositionSource<TSpec extends KroCompatibleType = KroCompatibleType, TStatus extends KroCompatibleType = KroCompatibleType> {
  readonly definition: TypeKroListenerCompositionDefinition<TSpec, TStatus>;
  readonly compositionFn: (spec: TSpec) => MagicAssignableShape<TStatus>;
  readonly options?: SerializationOptions;
}

type ProxyEventName = Exclude<HandlerEventType, 'finalize'> | 'finalize';

interface AggregateResourceScope {
  readonly resource: ResourceDefinition<object, object>;
  readonly watch: ResourceWatchAddress;
}

interface TypeKroResourceListenerMetadata {
  readonly resource: ResourceDefinition<object, object>;
  readonly watch?: ResourceWatchAddress;
}

let activeListenerGroup: ListenerGroup | undefined;
const listenerGroups = new WeakMap<object, ListenerGroup>();
const listenerCompositionSources = new WeakMap<object, ListenerCompositionSource>();
const typeKroResourceListenerMetadata = Symbol('applik8s.typekro.listenerResource');

export const typeKroAdapter: Applik8sTypeKroAdapterApi = {
  resource: typeKroResource,
  resources: typeKroResources,
  kubernetesComposition: listenerKubernetesComposition,
  resolveOperatorInstalls,
  listenerOperator,
  composition: asComposition,
  asComposition,
  graphAdapter: createGraphAdapter,
  typeKroAdapter: createUniversalGraphAdapter(),
  createGraphAdapter,
  inferRbac,
  permissions,
  operationTarget: toOperationTarget,
  toOperationTarget,
  targetFactory: asOperationTargetFactory,
  asOperationTargetFactory,
};

export const typeKro = typeKroAdapter;

function createUniversalGraphAdapter(): UniversalTypeKroGraphAdapter {
  return {
    render<TGraphSpec extends KroCompatibleType, TGraphStatus extends KroCompatibleType>(graph: TypeKroGraph<TGraphSpec, TGraphStatus>, spec: TGraphSpec) {
      return createGraphAdapter<TGraphSpec, TGraphStatus, TGraphStatus>().render(graph, spec);
    },
    inferRbac<TGraphSpec extends KroCompatibleType, TGraphStatus extends KroCompatibleType>(graph: TypeKroGraph<TGraphSpec, TGraphStatus>) {
      return createGraphAdapter<TGraphSpec, TGraphStatus, TGraphStatus>().inferRbac(graph);
    },
    renderStatus<TGraphSpec extends KroCompatibleType, TGraphStatus extends KroCompatibleType>(graph: TypeKroGraph<TGraphSpec, TGraphStatus>, spec: TGraphSpec) {
      return createGraphAdapter<TGraphSpec, TGraphStatus, TGraphStatus>().renderStatus(graph, spec);
    },
  };
}

export function typeKroResource<TSpec extends object, TStatus extends object, TInput = unknown, TOutput extends object = object>(
  source: (input: TInput) => TOutput,
  options: TypeKroListenerResourceOptions<TSpec, TStatus>
): TypeKroListenerResource<TSpec, TStatus, TInput, TOutput> {
  const definition = sdk.crd(options);
  Object.assign(definition, { resourceOwnership: 'external' });
  const factory = (input: TInput): TypeKroAddressedResource<TSpec, TStatus, TOutput> => {
    const output = source(input);
    const watch = resourceWatchAddress(output);
    const addressed = attachNonEnumerableEventSources(output, groupedEventSources(definition, definition.on, watch));
    Object.defineProperty(addressed, typeKroResourceListenerMetadata, {
      value: { resource: definition, watch },
      enumerable: false,
      configurable: false,
    });
    return addressed;
  };
  // typecast: resource ownership is a literal marker on the enhanced callable TypeKro resource factory.
  return Object.assign(factory, resourceDefinitionWithoutEvents(definition), {
    typeKroSource: source,
    resourceOwnership: 'external' as const, // typecast: literal ownership marker prevents external TypeKro resources from being emitted as owned CRDs.
    instances(resources: readonly TypeKroAddressedResource<TSpec, TStatus, TOutput>[]) {
      return { on: groupedEventSources(definition, definition.on, resourceWatchForInstances(resources)) };
    },
    where(selector: TypeKroListenerSelector) {
      return { on: groupedEventSources(definition, definition.on, resourceWatchForSelector(selector)) };
    },
  });
}

export function typeKroResources(resources: readonly object[]): TypeKroAggregateScopedListenerResource {
  return { on: aggregateGroupedEventSources(aggregateResourceScopes(resources)) };
}

function sourceVisibleCompositionWrapper<TSpec extends KroCompatibleType, TStatus extends KroCompatibleType>(
  wrapped: (spec: TSpec) => MagicAssignableShape<TStatus>,
  source: (spec: TSpec) => MagicAssignableShape<TStatus>
): (spec: TSpec) => MagicAssignableShape<TStatus> {
  Object.defineProperty(wrapped, 'toString', { value: () => source.toString() });
  return wrapped;
}

export function listenerKubernetesComposition<TSpec extends KroCompatibleType, TStatus extends KroCompatibleType>(
  definition: TypeKroListenerCompositionDefinition<TSpec, TStatus>,
  compositionFn: (spec: TSpec) => MagicAssignableShape<TStatus>,
  options?: SerializationOptions
): TypeKroListenerComposition<TSpec, TStatus> {
  const group = createListenerGroup();
  let recording = true;
  const wrappedCompositionFn = sourceVisibleCompositionWrapper((spec: TSpec) => withOperatorInstallCapture(group, recording, () => recording
    ? withListenerGroup(group, () => compositionFn(spec))
    : compositionFn(spec)), compositionFn);
  // typecast: TypeKro returns a callable composition; the adapter adds listener/install metadata methods below.
  const composition = createListenerComposition(
    definition,
    wrappedCompositionFn,
    options
  ) as TypeKroListenerComposition<TSpec, TStatus>;
  recording = false;
  listenerGroups.set(composition, group);
  // typecast: listener composition sources are stored erased and re-narrowed when resolving the same composition instance.
  listenerCompositionSources.set(composition, { definition, compositionFn, options } as unknown as ListenerCompositionSource);
  return Object.assign(composition, {
    get operatorInstalls() {
      return [...group.operatorInstalls];
    },
    resolveOperatorInstalls(resolveOptions: TypeKroResolveOperatorInstallsOptions) {
      return resolveOperatorInstalls(composition, resolveOptions);
    },
    listenerOperator<TCapabilities extends CapabilityClientSet = CapabilityClientSet>(operatorOptions: TypeKroListenerOperatorOptions<TCapabilities>) {
      // typecast: listenerOperator does not depend on the composition's exact spec/status schema parameters.
      return listenerOperator(composition as unknown as TypeKroListenerComposition<KroCompatibleType, KroCompatibleType>, operatorOptions);
    },
  });
}

export function resolveOperatorInstalls<TSpec extends KroCompatibleType, TStatus extends KroCompatibleType>(
  composition: TypeKroListenerComposition<TSpec, TStatus>,
  options: TypeKroResolveOperatorInstallsOptions
): Result<TypeKroListenerComposition<TSpec, TStatus>> {
  try {
    // typecast: WeakMap values are keyed by the exact composition instance whose generic source type is represented by this call.
    const source = listenerCompositionSources.get(composition) as ListenerCompositionSource<TSpec, TStatus> | undefined;
    if (!source) {
      return err('BUNDLE_INVALID', 'TypeKro composition was not created through typeKro.kubernetesComposition(...), so captured operator installs cannot be resolved.');
    }
    const captured = composition.operatorInstalls;
    if (captured.length === 0) {
      return ok(composition);
    }

    const manifests = manifestMap(options.manifests);
    const resolvedInstallCompositions = new Map<string, TypeKroOperatorComposition>();
    const generatedCrdPrerequisites: PrerequisiteResource[] = [];
    for (const install of captured) {
      if (!isOperatorDefinitionLike(install.operator)) {
        return err('BUNDLE_INVALID', `Captured TypeKro operator install ${install.operatorName} is missing an applik8s operator definition.`);
      }
      const manifest = manifests.get(install.operatorName);
      if (!manifest) {
        return err('BUNDLE_INVALID', `Captured TypeKro operator install ${install.operatorName} is missing a compiled applik8s OperatorBundle manifest.`);
      }
      const defaultNamespace = options.defaultNamespace ?? install.operator.deployment?.namespace;
      const adapterOptions: TypeKroAdapterOptions = {
        compositionName: options.compositionName?.(install.operatorName) ?? install.operatorName,
        ...(options.factoryOptions ? { factoryOptions: options.factoryOptions } : {}),
        ...(defaultNamespace ? { defaultNamespace } : {}),
      };
      const lowered = asComposition(install.operator, manifest, adapterOptions);
      if (!lowered.ok) {
        return lowered;
      }
      generatedCrdPrerequisites.push(...operatorGeneratedCrdPrerequisites(install.operator, manifest));
      // typecast: asComposition returns the operator-install composition shape required by install replay.
      resolvedInstallCompositions.set(install.operatorName, lowered.value as TypeKroOperatorComposition);
    }

    // typecast: replay preserves the original composition's public spec/status generic contract.
    return ok(createResolvedListenerComposition(source, options, resolvedInstallCompositions, generatedCrdPrerequisites) as TypeKroListenerComposition<TSpec, TStatus>);
  } catch (cause) {
    return err('BUNDLE_INVALID', cause instanceof Error ? cause.message : 'Failed to resolve captured TypeKro operator installs.');
  }
}

export function listenerOperator<TCapabilities extends CapabilityClientSet = CapabilityClientSet>(
  composition: TypeKroListenerComposition<KroCompatibleType, KroCompatibleType>,
  options: TypeKroListenerOperatorOptions<TCapabilities>
): CallableOperator<TCapabilities> {
  const group = listenerGroups.get(composition);
  if (!group) {
    throw new Error('TypeKro composition was not created through typeKro.kubernetesComposition(...), so no listener group is available.');
  }
  return sdk.operator({
    ...options,
    resources: Object.fromEntries(group.resources),
    // typecast: grouped handlers are already registered through SDK event helpers; sdk.operator infers a narrower resource map here.
    handlers: [...group.handlers] as never,
  });
}

function createResolvedListenerComposition<TSpec extends KroCompatibleType, TStatus extends KroCompatibleType>(
  source: ListenerCompositionSource<TSpec, TStatus>,
  options: TypeKroResolveOperatorInstallsOptions,
  resolvedInstallCompositions: ReadonlyMap<string, TypeKroOperatorComposition>,
  generatedCrdPrerequisites: readonly PrerequisiteResource[]
): TypeKroListenerComposition<TSpec, TStatus> {
  const group = createListenerGroup();
  let recording = true;
  const wrappedCompositionFn = sourceVisibleCompositionWrapper((spec: TSpec) => withResolvedOperatorInstallCapture(group, recording, options, resolvedInstallCompositions, () => recording
    ? withListenerGroup(group, () => source.compositionFn(spec))
    : source.compositionFn(spec)), source.compositionFn);
  // typecast: TypeKro returns a callable composition; the adapter adds listener/install metadata methods below.
  const composition = createListenerComposition(
    source.definition,
    wrappedCompositionFn,
    source.options
  ) as TypeKroListenerComposition<TSpec, TStatus>;
  recording = false;
  const baseFactory = composition.factory.bind(composition);
  listenerGroups.set(composition, group);
  // typecast: listener composition sources are stored erased and re-narrowed when resolving the same composition instance.
  listenerCompositionSources.set(composition, source as unknown as ListenerCompositionSource);
  return Object.assign(composition, {
    get operatorInstalls() {
      return [...group.operatorInstalls];
    },
    resolveOperatorInstalls(resolveOptions: TypeKroResolveOperatorInstallsOptions) {
      return resolveOperatorInstalls(composition, resolveOptions);
    },
    factory(mode: 'direct' | 'kro', factoryOptions?: PublicFactoryOptions) {
      return baseFactory(
        mode,
        mode === 'kro'
          ? withGeneratedCrdPrerequisites(factoryOptions, generatedCrdPrerequisites)
          : factoryOptions
      );
    },
    listenerOperator<TCapabilities extends CapabilityClientSet = CapabilityClientSet>(operatorOptions: TypeKroListenerOperatorOptions<TCapabilities>) {
      // typecast: listenerOperator does not depend on the composition's exact spec/status schema parameters.
      return listenerOperator(composition as unknown as TypeKroListenerComposition<KroCompatibleType, KroCompatibleType>, operatorOptions);
    },
  });
}

function withGeneratedCrdPrerequisites(
  factoryOptions: PublicFactoryOptions | undefined,
  generatedCrdPrerequisites: readonly PrerequisiteResource[]
): PublicFactoryOptions | undefined {
  if (generatedCrdPrerequisites.length === 0) {
    return factoryOptions;
  }
  return {
    ...factoryOptions,
    kroPrerequisites: {
      ...factoryOptions?.kroPrerequisites,
      resources: [
        ...generatedCrdPrerequisites,
        ...(factoryOptions?.kroPrerequisites?.resources ?? []),
      ],
    },
  };
}

function groupedEventSources<TSpec extends object, TStatus extends object>(
  resource: ResourceDefinition<TSpec, TStatus>,
  source: ResourceEventSources<TSpec, TStatus, CapabilityClientSet>,
  watch: ResourceWatchAddress | undefined,
  defaultOperator?: OperatorDefinition
): TypeKroGroupedResourceEventSources<TSpec, TStatus> {
  return {
    context: {
      reconcile: groupedContextRegister(resource, watch, source.context.reconcile, defaultOperator),
      created: groupedContextRegister(resource, watch, source.context.created, defaultOperator),
      updated: groupedContextRegister(resource, watch, source.context.updated, defaultOperator),
      deleted: groupedContextRegister(resource, watch, source.context.deleted, defaultOperator),
      finalize: groupedContextRegister(resource, watch, source.context.finalize, defaultOperator),
      statusChanged: groupedContextRegister(resource, watch, source.context.statusChanged, defaultOperator),
    },
    reconcile: groupedProxyRegister(resource, watch, source.reconcile, defaultOperator),
    created: groupedProxyRegister(resource, watch, source.created, defaultOperator),
    updated: groupedProxyRegister(resource, watch, source.updated, defaultOperator),
    deleted: groupedProxyRegister(resource, watch, source.deleted, defaultOperator),
    finalize: groupedProxyRegister(resource, watch, source.finalize, defaultOperator),
    statusChanged: groupedProxyRegister(resource, watch, source.statusChanged, defaultOperator),
  };
}

function aggregateGroupedEventSources(scopes: readonly AggregateResourceScope[]): TypeKroAggregateResourceEventSources {
  return {
    context: {
      reconcile: aggregateContextRegister(scopes, 'reconcile'),
      created: aggregateContextRegister(scopes, 'created'),
      updated: aggregateContextRegister(scopes, 'updated'),
      deleted: aggregateContextRegister(scopes, 'deleted'),
      finalize: aggregateContextRegister(scopes, 'finalize'),
      statusChanged: aggregateContextRegister(scopes, 'statusChanged'),
    },
    reconcile: aggregateProxyRegister(scopes, 'reconcile'),
    created: aggregateProxyRegister(scopes, 'created'),
    updated: aggregateProxyRegister(scopes, 'updated'),
    deleted: aggregateProxyRegister(scopes, 'deleted'),
    finalize: aggregateProxyRegister(scopes, 'finalize'),
    statusChanged: aggregateProxyRegister(scopes, 'statusChanged'),
  };
}

function resourceDefinitionWithoutEvents<TSpec extends object, TStatus extends object>(
  definition: ResourceDefinition<TSpec, TStatus>
): Omit<ResourceDefinition<TSpec, TStatus>, 'on'> {
  const { on: _on, ...withoutEvents } = definition;
  return withoutEvents;
}

function resourceWatchAddress(resource: object): ResourceWatchAddress | undefined {
  const metadata = Reflect.get(resource, 'metadata');
  if (!isRecord(metadata)) {
    return undefined;
  }
  const name = Reflect.get(metadata, 'name');
  const namespace = Reflect.get(metadata, 'namespace');
  if (typeof namespace !== 'string' && typeof name !== 'string') {
    return undefined;
  }
  return {
    ...(typeof namespace === 'string' ? { namespace } : {}),
    ...(typeof name === 'string' ? { name } : {}),
  };
}

function resourceWatchForInstances(resources: readonly object[]): ResourceWatchAddress | undefined {
  if (resources.length === 0) {
    throw new Error('TypeKro listener instance scope requires at least one resource instance.');
  }
  const addresses = resources.map(resourceWatchAddress);
  if (addresses.some((address) => !address?.name)) {
    throw new Error('TypeKro listener instance scope requires every resource instance to have metadata.name.');
  }
  const namespaces = unique(addresses.map((address) => address?.namespace ?? ''));
  if (namespaces.length > 1) {
    throw new Error('TypeKro listener instance scope currently requires all resource instances to share one namespace.');
  }
  const namespace = namespaces[0];
  return {
    ...(namespace ? { namespace } : {}),
    names: unique(addresses.flatMap((address) => address?.name ? [address.name] : [])),
  };
}

function resourceWatchForSelector(selector: TypeKroListenerSelector): ResourceWatchAddress {
  if (!selector.labels && !selector.labelSelector && !selector.fieldSelector) {
    throw new Error('TypeKro listener selector scope requires labels, labelSelector, or fieldSelector.');
  }
  if (selector.labels && selector.labelSelector) {
    throw new Error('TypeKro listener selector scope requires either labels or labelSelector, not both.');
  }
  if (selector.labelSelector?.matchExpressions && selector.labelSelector.matchExpressions.length > 0) {
    throw new Error('TypeKro listener selector scope does not support labelSelector.matchExpressions in v0.3. Use labels/matchLabels, exact instances, finite instance sets, or fieldSelector.');
  }
  return {
    ...(selector.namespace ? { namespace: selector.namespace } : {}),
    ...(selector.labels ? { labelSelector: { matchLabels: selector.labels } } : {}),
    ...(selector.labelSelector ? { labelSelector: selector.labelSelector } : {}),
    ...(selector.fieldSelector ? { fieldSelector: selector.fieldSelector } : {}),
  };
}

function aggregateResourceScopes(resources: readonly object[]): readonly AggregateResourceScope[] {
  if (resources.length === 0) {
    throw new Error('TypeKro aggregate listener scope requires at least one resource instance.');
  }
  const groups = new Map<string, { readonly resource: ResourceDefinition<object, object>; readonly namespace?: string; readonly names: string[] }>();
  for (const resource of resources) {
    const metadata = resourceListenerMetadata(resource);
    if (!metadata) {
      throw new Error('TypeKro aggregate listener scope only accepts resources created by typeKro.resource(...).');
    }
    if (!metadata.watch?.name) {
      throw new Error('TypeKro aggregate listener scope requires every resource instance to have metadata.name.');
    }
    const namespace = metadata.watch.namespace;
    const key = `${metadata.resource.apiVersion}\u0000${metadata.resource.kind}\u0000${namespace ?? ''}`;
    const group = groups.get(key);
    if (group) {
      group.names.push(metadata.watch.name);
    } else {
      groups.set(key, { resource: metadata.resource, ...(namespace ? { namespace } : {}), names: [metadata.watch.name] });
    }
  }
  return [...groups.values()].map((group) => ({
    resource: group.resource,
    watch: {
      ...(group.namespace ? { namespace: group.namespace } : {}),
      names: unique(group.names),
    },
  }));
}

function resourceListenerMetadata(resource: object): TypeKroResourceListenerMetadata | undefined {
  const metadata = Reflect.get(resource, typeKroResourceListenerMetadata);
  if (!isRecord(metadata) || !isResourceDefinitionLike(metadata.resource)) {
    return undefined;
  }
  // typecast: metadata is written by typeKroResource and has just been structurally validated.
  return metadata as unknown as TypeKroResourceListenerMetadata;
}

function isResourceDefinitionLike(value: unknown): value is ResourceDefinition<object, object> {
  return Boolean(
    value &&
      (typeof value === 'object' || typeof value === 'function') &&
      typeof Reflect.get(value, 'apiVersion') === 'string' &&
      typeof Reflect.get(value, 'kind') === 'string'
  );
}

function isFinalizeHandlerOptions(value: unknown): value is FinalizeHandlerOptions {
  return isRecord(value) && ('finalizer' in value || 'finalizers' in value);
}

function groupedProxyRegister<TSpec extends object, TStatus extends object>(
  resource: ResourceDefinition<TSpec, TStatus>,
  watch: ResourceWatchAddress | undefined,
  register: (handler: ProxyHandler<TSpec, TStatus, CapabilityClientSet>, options?: FinalizeHandlerOptions) => HandlerRegistration<TSpec, TStatus, CapabilityClientSet>,
  defaultOperator?: OperatorDefinition
) {
  function registerWithGroup(handler: ProxyHandler<TSpec, TStatus, CapabilityClientSet>, options?: FinalizeHandlerOptions): HandlerRegistration<TSpec, TStatus, CapabilityClientSet>;
  function registerWithGroup(operator: CallableOperator, handler: ProxyHandler<TSpec, TStatus, CapabilityClientSet>, options?: FinalizeHandlerOptions): HandlerRegistration<TSpec, TStatus, CapabilityClientSet>;
  function registerWithGroup(first: CallableOperator | ProxyHandler<TSpec, TStatus, CapabilityClientSet>, second?: ProxyHandler<TSpec, TStatus, CapabilityClientSet> | FinalizeHandlerOptions, third?: FinalizeHandlerOptions) {
    if (isCallableOperator(first)) {
      if (typeof second !== 'function') {
        throw new Error('TypeKro listener registration requires a handler function.');
      }
      return registerGroupedHandler(resource, watch, register(second, third), first);
    }
    if (typeof first !== 'function') {
      throw new Error('TypeKro listener registration requires a handler function.');
    }
    return registerGroupedHandler(resource, watch, register(first, isFinalizeHandlerOptions(second) ? second : undefined), defaultOperator);
  }
  return registerWithGroup;
}

function groupedContextRegister<TSpec extends object, TStatus extends object>(
  resource: ResourceDefinition<TSpec, TStatus>,
  watch: ResourceWatchAddress | undefined,
  register: (handler: Handler<TSpec, TStatus, CapabilityClientSet>, options?: FinalizeHandlerOptions) => HandlerRegistration<TSpec, TStatus, CapabilityClientSet>,
  defaultOperator?: OperatorDefinition
) {
  function registerWithGroup(handler: Handler<TSpec, TStatus, CapabilityClientSet>, options?: FinalizeHandlerOptions): HandlerRegistration<TSpec, TStatus, CapabilityClientSet>;
  function registerWithGroup(operator: CallableOperator, handler: Handler<TSpec, TStatus, CapabilityClientSet>, options?: FinalizeHandlerOptions): HandlerRegistration<TSpec, TStatus, CapabilityClientSet>;
  function registerWithGroup(first: CallableOperator | Handler<TSpec, TStatus, CapabilityClientSet>, second?: Handler<TSpec, TStatus, CapabilityClientSet> | FinalizeHandlerOptions, third?: FinalizeHandlerOptions) {
    if (isCallableOperator(first)) {
      if (typeof second !== 'function') {
        throw new Error('TypeKro listener registration requires a handler function.');
      }
      return registerGroupedHandler(resource, watch, register(second, third), first);
    }
    if (typeof first !== 'function') {
      throw new Error('TypeKro listener registration requires a handler function.');
    }
    return registerGroupedHandler(resource, watch, register(first, isFinalizeHandlerOptions(second) ? second : undefined), defaultOperator);
  }
  return registerWithGroup;
}

function aggregateProxyRegister(scopes: readonly AggregateResourceScope[], event: ProxyEventName) {
  function registerWithGroup(handler: ProxyHandler<object, object, CapabilityClientSet>, options?: FinalizeHandlerOptions): readonly HandlerRegistration<object, object, CapabilityClientSet>[];
  function registerWithGroup(operator: CallableOperator, handler: ProxyHandler<object, object, CapabilityClientSet>, options?: FinalizeHandlerOptions): readonly HandlerRegistration<object, object, CapabilityClientSet>[];
  function registerWithGroup(first: CallableOperator | ProxyHandler<object, object, CapabilityClientSet>, second?: ProxyHandler<object, object, CapabilityClientSet> | FinalizeHandlerOptions, third?: FinalizeHandlerOptions) {
    if (isCallableOperator(first)) {
      if (typeof second !== 'function') {
        throw new Error('TypeKro listener registration requires a handler function.');
      }
      return scopes.map((scope) => registerGroupedHandler(scope.resource, scope.watch, proxyRegisterFor(scope.resource.on, event)(second, third), first));
    }
    if (typeof first !== 'function') {
      throw new Error('TypeKro listener registration requires a handler function.');
    }
    const options = isFinalizeHandlerOptions(second) ? second : undefined;
    return scopes.map((scope) => registerGroupedHandler(scope.resource, scope.watch, proxyRegisterFor(scope.resource.on, event)(first, options), undefined));
  }
  return registerWithGroup;
}

function aggregateContextRegister(scopes: readonly AggregateResourceScope[], event: ProxyEventName) {
  function registerWithGroup(handler: Handler<object, object, CapabilityClientSet>, options?: FinalizeHandlerOptions): readonly HandlerRegistration<object, object, CapabilityClientSet>[];
  function registerWithGroup(operator: CallableOperator, handler: Handler<object, object, CapabilityClientSet>, options?: FinalizeHandlerOptions): readonly HandlerRegistration<object, object, CapabilityClientSet>[];
  function registerWithGroup(first: CallableOperator | Handler<object, object, CapabilityClientSet>, second?: Handler<object, object, CapabilityClientSet> | FinalizeHandlerOptions, third?: FinalizeHandlerOptions) {
    if (isCallableOperator(first)) {
      if (typeof second !== 'function') {
        throw new Error('TypeKro listener registration requires a handler function.');
      }
      return scopes.map((scope) => registerGroupedHandler(scope.resource, scope.watch, contextRegisterFor(scope.resource.on.context, event)(second, third), first));
    }
    if (typeof first !== 'function') {
      throw new Error('TypeKro listener registration requires a handler function.');
    }
    const options = isFinalizeHandlerOptions(second) ? second : undefined;
    return scopes.map((scope) => registerGroupedHandler(scope.resource, scope.watch, contextRegisterFor(scope.resource.on.context, event)(first, options), undefined));
  }
  return registerWithGroup;
}

function proxyRegisterFor(source: ResourceEventSources<object, object, CapabilityClientSet>, event: ProxyEventName): (handler: ProxyHandler<object, object, CapabilityClientSet>, options?: FinalizeHandlerOptions) => HandlerRegistration<object, object, CapabilityClientSet> {
  switch (event) {
    case 'reconcile': return source.reconcile;
    case 'created': return source.created;
    case 'updated': return source.updated;
    case 'deleted': return source.deleted;
    case 'finalize': return source.finalize;
    case 'statusChanged': return source.statusChanged;
  }
}

function contextRegisterFor(source: ResourceEventSources<object, object, CapabilityClientSet>['context'], event: ProxyEventName): (handler: Handler<object, object, CapabilityClientSet>, options?: FinalizeHandlerOptions) => HandlerRegistration<object, object, CapabilityClientSet> {
  switch (event) {
    case 'reconcile': return source.reconcile;
    case 'created': return source.created;
    case 'updated': return source.updated;
    case 'deleted': return source.deleted;
    case 'finalize': return source.finalize;
    case 'statusChanged': return source.statusChanged;
  }
}

function registerGroupedHandler<TSpec extends object, TStatus extends object>(
  resource: ResourceDefinition<TSpec, TStatus>,
  watch: ResourceWatchAddress | undefined,
  registration: HandlerRegistration<TSpec, TStatus, CapabilityClientSet>,
  explicitOperator: CallableOperator | OperatorDefinition | undefined
): HandlerRegistration<TSpec, TStatus, CapabilityClientSet> {
  const addressedRegistration = watch ? Object.assign(registration, { watch }) : registration;
  if (explicitOperator) {
    if (!isCallableOperator(explicitOperator) && !activeListenerGroup) {
      // TypeKro replays composition functions after capture; raw default operators were already mutated during the grouped capture pass.
      return addressedRegistration;
    }
    addRegistrationToOperator(explicitOperator, resource, addressedRegistration);
    return addressedRegistration;
  }
  if (activeListenerGroup) {
    addRegistrationToGroup(activeListenerGroup, resource, addressedRegistration);
    return addressedRegistration;
  }
  throw unattachedTypeKroListenerError();
}

function unattachedTypeKroListenerError(): Error {
  return new Error('TypeKro listener registration is not attached to an operator. Register listeners inside typeKro.kubernetesComposition(...) and call composition.listenerOperator(...), or pass an explicit applik8s operator as the first listener argument.');
}

function createListenerGroup(): ListenerGroup {
  return { resources: new Map(), handlers: [], operatorInstalls: [] };
}

function withListenerGroup<T>(group: ListenerGroup, fn: () => T): T {
  const previous = activeListenerGroup;
  activeListenerGroup = group;
  try {
    return fn();
  } finally {
    activeListenerGroup = previous;
  }
}

function withOperatorInstallCapture<T>(group: ListenerGroup, record: boolean, fn: () => T): T {
  const restore = setOperatorDeploymentInterceptor((definition, deployment) => {
    const binding = createOperatorInstallBinding(definition, deployment);
    if (record) {
      group.operatorInstalls.push({ operatorName: definition.name, operator: definition, deployment, binding });
    }
    return binding;
  });
  try {
    return fn();
  } finally {
    restore();
  }
}

function withResolvedOperatorInstallCapture<T>(
  group: ListenerGroup,
  record: boolean,
  options: TypeKroResolveOperatorInstallsOptions,
  resolvedInstallCompositions: ReadonlyMap<string, TypeKroOperatorComposition>,
  fn: () => T
): T {
  const restore = setOperatorDeploymentInterceptor((definition, deployment) => {
    const installComposition = resolvedInstallCompositions.get(definition.name);
    if (!installComposition) {
      throw new Error(`Captured TypeKro operator install ${definition.name} is missing a resolved install composition.`);
    }
    const mergedDeployment = { ...definition.deployment, ...deployment };
    const binding = createOperatorInstallBinding(definition, mergedDeployment);
    if (record) {
      group.operatorInstalls.push({ operatorName: definition.name, operator: definition, deployment: mergedDeployment, binding });
    }
    const namespace = mergedDeployment.namespace ?? options.defaultNamespace ?? definition.deployment?.namespace;
    const installSpec = {
      ...(namespace ? { namespace } : {}),
      ...(mergedDeployment.replicas === undefined ? {} : { replicas: mergedDeployment.replicas }),
    };
    return installComposition(installSpec);
  });
  try {
    return fn();
  } finally {
    restore();
  }
}

function createOperatorInstallBinding<TCapabilities extends CapabilityClientSet, TResources extends Readonly<Record<string, AnyResourceDefinition<TCapabilities>>>>(
  operator: OperatorDefinition<TCapabilities, TResources>,
  deployment: OperatorDeploymentOptions
): TypeKroOperatorInstallBinding<TCapabilities, TResources> {
  const mergedDeployment = { ...operator.deployment, ...deployment };
  // typecast: install binding factories only need erased operator-definition mutation for grouped handler registration; public generics preserve the exact resource map.
  const crdFactories = createCrdFactories<TCapabilities, TResources>(operator.resources, mergedDeployment.namespace, operator as unknown as OperatorDefinition);
  const binding = Object.assign(
    {
      // typecast: installKind is a literal discriminator for direct-call operator install bindings.
      installKind: 'applik8sOperatorInstall' as const,
      operatorName: operator.name,
      operator,
      deployment: mergedDeployment,
      crdFactories,
      status: {
        ready: false,
        // typecast: phase is a literal initial install status value before compile-time lowering.
        phase: 'Pending' as const,
        message: `${operator.name} install is resolved during applik8s compilation.`,
      },
    },
    crdFactories
  );
  // typecast: the binding dynamically combines exact resource-map factory keys with install metadata.
  return binding as TypeKroOperatorInstallBinding<TCapabilities, TResources>;
}

function addRegistrationToGroup<TSpec extends object, TStatus extends object>(
  group: ListenerGroup,
  resource: ResourceDefinition<TSpec, TStatus>,
  registration: HandlerRegistration<TSpec, TStatus, CapabilityClientSet>
): void {
  group.resources.set(resourceMapKey(resource, Object.fromEntries(group.resources)), resource);
  // typecast: listener groups erase resource-specific handler generics after registration has bound the resource.
  group.handlers.push(registration as HandlerRegistration<object, object, CapabilityClientSet>);
}

function addRegistrationToOperator<TSpec extends object, TStatus extends object>(
  operator: CallableOperator | OperatorDefinition,
  resource: ResourceDefinition<TSpec, TStatus>,
  registration: HandlerRegistration<TSpec, TStatus, CapabilityClientSet>
): void {
  // typecast: callable operators carry mutable SDK definitions; grouping extends their resource/handler maps in place.
  const definition = (isCallableOperator(operator) ? operator.definition : operator) as OperatorDefinition & {
    resources: Record<string, AnyResourceDefinition>;
    handlers: HandlerRegistration<object, object, CapabilityClientSet>[];
  };
  const resources = { ...definition.resources };
  if (!Object.values(resources).some((existing) => existing.apiVersion === resource.apiVersion && existing.kind === resource.kind)) {
    resources[resourceMapKey(resource, resources)] = resource;
  }
  // typecast: explicit operator grouping erases resource-specific handler generics after registration has bound the resource.
  const handlers = [...definition.handlers, registration as HandlerRegistration<object, object, CapabilityClientSet>];
  Object.assign(definition, { resources, handlers });
}

function resourceMapKey(resource: Pick<AnyResourceDefinition, 'apiVersion' | 'kind'>, existing: Readonly<Record<string, unknown>>): string {
  const base = uncapitalize(resource.kind);
  const current = Reflect.get(existing, base);
  if (!current || (isRecord(current) && Reflect.get(current, 'apiVersion') === resource.apiVersion && Reflect.get(current, 'kind') === resource.kind)) {
    return base;
  }
  return `${base}${hashResourceIdentity(resource.apiVersion, resource.kind)}`;
}

function hashResourceIdentity(apiVersion: string, kind: string): string {
  let hash = 0;
  for (const char of `${apiVersion}/${kind}`) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash.toString(36);
}

function isCallableOperator(value: unknown): value is CallableOperator {
  return typeof value === 'function' && isRecord(Reflect.get(value, 'definition'));
}

function isOperatorDefinitionLike(value: unknown): value is OperatorDefinition {
  return Boolean(
    value &&
      (typeof value === 'object' || typeof value === 'function') &&
      typeof Reflect.get(value, 'name') === 'string' &&
      isRecord(Reflect.get(value, 'resources')) &&
      Array.isArray(Reflect.get(value, 'handlers'))
  );
}

function isTypeKroOperationTarget(value: unknown): value is TypeKroOperationTarget<KroCompatibleType, KroCompatibleType, object> {
  return Boolean(value && typeof value === 'object' && Reflect.get(value, 'targetKind') === 'operationTarget' && isRecord(Reflect.get(value, 'adapter')));
}

function manifestMap(source: import('./interfaces.js').TypeKroOperatorInstallManifestSource): Map<string, OperatorManifest> {
  if (Array.isArray(source)) {
    return new Map(source.map((input) => {
      const manifest = manifestFromInput(input);
      return [manifest.metadata.name, manifest];
    }));
  }
  return new Map(Object.entries(source).map(([name, input]) => [name, manifestFromInput(input)]));
}

function manifestFromInput(input: import('./interfaces.js').TypeKroOperatorInstallManifestInput): OperatorManifest {
  return isOperatorManifestLike(input) ? input : input.manifest;
}

function isOperatorManifestLike(value: unknown): value is OperatorManifest {
  if (!isRecord(value) || Reflect.get(value, 'kind') !== 'OperatorBundle') {
    return false;
  }
  const metadata = Reflect.get(value, 'metadata');
  return isRecord(metadata) && typeof Reflect.get(metadata, 'name') === 'string';
}

export function asComposition<
  TCapabilities extends CapabilityClientSet = CapabilityClientSet,
  TResources extends TypeKroResourceDefinitionMap<TCapabilities> = TypeKroResourceDefinitionMap<TCapabilities>,
  TInstallSpec extends KroCompatibleType = TypeKroOperatorInstallSpec,
  TInstallStatus extends KroCompatibleType = TypeKroOperatorInstallStatus,
>(
  operator: OperatorDefinition<TCapabilities, TResources>,
  manifest: OperatorManifest,
  options: TypeKroAdapterOptions<TInstallSpec, TInstallStatus>
): Result<TypeKroOperatorComposition<TCapabilities, TResources, TInstallSpec, TInstallStatus>> {
  try {
    if (!manifest.spec.container) {
      return err('BUNDLE_INVALID', 'Operator manifest must include the compiler-derived runtime container recipe before TypeKro installation can be synthesized.');
    }

    // typecast: TypeKro install synthesis only needs erased resource metadata; public composition generics preserve the operator's exact resource map.
    const resources = Object.values(operator.resources) as unknown as readonly AnyResourceDefinition[];
    // typecast: factory construction uses the same erased runtime metadata while the returned composition is typed back to the exact resource map.
    const crdFactories = createCrdFactories(operator.resources as unknown as Readonly<Record<string, AnyResourceDefinition>>, options.defaultNamespace, operator as unknown as OperatorDefinition);
    // typecast: TypeKro's generic composition overload can instantiate too deeply through this public generic adapter boundary; the wrapper pins the stable install spec/status pair used at runtime.
    const createInstallComposition = createTypeKroComposition as unknown as CreateInstallComposition;
    const composition = createInstallComposition(
      {
        name: options.compositionName,
        apiVersion: 'v1alpha1',
        group: 'applik8s.applik8s.dev',
        kind: pascalCase(options.compositionName),
        // typecast: adapter install schemas are intentionally generic but structurally match the stable install spec/status subset.
        spec: installSpecSchema as Type<TypeKroOperatorInstallSpec>,
        // typecast: adapter install schemas are intentionally generic but structurally match the stable install spec/status subset.
        status: installStatusSchema as Type<TypeKroOperatorInstallStatus>,
      },
      (installSpec: TypeKroOperatorInstallSpec) => {
        const namespace = installSpec.namespace ?? options.defaultNamespace ?? operator.deployment?.namespace ?? 'default';
        const replicas = installSpec.replicas ?? operator.deployment?.replicas ?? 1;
        const install = installResources(operator, operator.deployment, resources, manifest, namespace, replicas);
        const deploymentResource = install.find((resource) => resource.kind === 'Deployment');
        if (!deploymentResource) {
          throw new Error('Generated TypeKro install composition is missing the operator Deployment.');
        }
        for (const resource of install) {
          if (resource !== deploymentResource) {
            createInstallResource(resource);
          }
        }
        // typecast: TypeKro returns an enhanced resource proxy, but its generic factory type does not preserve deployment status projection.
        const operatorDeployment = createInstallResource(deploymentResource) as unknown as Enhanced<DeploymentSpecProjection, DeploymentStatusProjection>;
        const ready = operatorDeployment.status.availableReplicas >= operatorDeployment.spec.replicas;
        return {
          ready,
          phase: ready ? 'Ready' : 'Installing',
        };
      },
      options.factoryOptions
    );

    // typecast: the callable wrapper reattaches TypeKro graph descriptors and applik8s CRD factory sugar while preserving the public generic composition shape.
    const adapted = ((spec: TInstallSpec) => {
      // typecast: public install specs may refine the generic adapter spec, but the runtime composition consumes the stable TypeKroOperatorInstallSpec subset.
      const instance = composition(spec as unknown as TypeKroOperatorInstallSpec);
      return Object.assign(instance, crdFactories, { crdFactories });
    }) as unknown as TypeKroOperatorComposition<TCapabilities, TResources, TInstallSpec, TInstallStatus>;
    copyDescriptors(composition, adapted);
    Object.assign(adapted, crdFactories, {
      operator,
      manifest,
      composition,
      graph: composition,
      crdFactories,
      factory: (mode: 'direct' | 'kro', factoryOptions?: PublicFactoryOptions) => composition.factory(mode, factoryOptions),
    });
    return ok(adapted);
  } catch (cause) {
    return err('BUNDLE_INVALID', cause instanceof Error ? cause.message : 'Failed to synthesize TypeKro operator composition.');
  }
}

export function createGraphAdapter<TGraphSpec extends KroCompatibleType = JsonObject, TGraphStatus extends KroCompatibleType = JsonObject, THandlerStatus extends object = TGraphStatus>(
  ...args: TypeKroGraphAdapterOptionsArgument<TGraphStatus, THandlerStatus>
): TypeKroGraphAdapter<TGraphSpec, TGraphStatus, THandlerStatus> {
  const [options] = args;
  return {
    render(graph, _spec) {
      const operations = resourcePlanEntriesForSource(graph).map(({ resource }) => ({
        // typecast: operation-plan discriminants must stay literal for the runtime contract union.
        kind: 'apply' as const,
        resource,
        ...(options?.fieldManager ? { fieldManager: options.fieldManager } : {}),
      }));
      return ok({ operations });
    },
    inferRbac(graph) {
      return ok(rbacForResources(resourcePlanEntriesForSource(graph).map((entry) => entry.resource)));
    },
    renderStatus(_graph, _spec) {
      if (options?.statusMapper) {
        // typecast: graph-like fixtures and nested TypeKro resources may expose a status projection; absent live state remains an empty partial status.
        return ok(options.statusMapper(statusProjectionForSource(_graph) as PartialStatus<TGraphStatus>));
      }
      // typecast: no mapper means no status projection is requested, so the partial handler status is empty.
      return ok({} as PartialStatus<THandlerStatus>);
    },
  };
}

export function toOperationTarget<TGraphSpec extends KroCompatibleType = JsonObject, TGraphStatus extends KroCompatibleType = JsonObject, THandlerStatus extends object = TGraphStatus>(
  source: TypeKroOperationTargetSource<TGraphSpec, TGraphStatus>,
  spec: TypeKroOperationTargetSpec<TGraphSpec>,
  ...args: TypeKroGraphAdapterOptionsArgument<TGraphStatus, THandlerStatus>
): TypeKroOperationTarget<TGraphSpec, TGraphStatus, THandlerStatus> {
  const adapter = createGraphAdapter<TGraphSpec, TGraphStatus, THandlerStatus>(...args);
  const graph = sourceAsGraph(source);
  const applyResources = resourcePlanEntriesForSource(graph).map((entry) => entry.resource);
  const deleteRefs = deletionPlanEntriesForSource(graph).map((entry) => objectRefForResource(entry.resource));
  const targetId = operationTargetId(graph);
  const permissions = rbacForResources(applyResources);
  // typecast: TypeKro operation target apply/delete plans are status-agnostic Kubernetes operation plans.
  const applyPlan = { operations: applyResources.map((resource) => ({ kind: 'apply' as const, resource })) } as NormalizedOperationPlan<THandlerStatus>;
  // typecast: TypeKro operation target delete plans are status-agnostic Kubernetes operation plans.
  const deletePlan = { operations: deleteRefs.map((ref) => ({ kind: 'delete' as const, ref })) } as NormalizedOperationPlan<THandlerStatus>;
  return {
    targetKind: 'operationTarget',
    operationTargetArtifacts: { applyPlan, deletePlan, dryRunPlan: applyPlan },
    contract: {
      id: targetId,
      target: { nodeId: targetId.replace(/^operation-target\./, 'typeKroResource.') },
      operations: ['apply', 'delete'],
      execution: { contexts: ['handler', 'generatedServer', 'generatedJob', 'typeKro'], ordering: 'dependencyAware', runtimeValidation: 'beforeEffects', failurePolicy: 'failClosed' },
      lowering: { mode: 'typeKroResource', artifact: { kind: 'typeKroResource', path: `plans/${targetId}.apply.json` }, failurePolicy: 'failClosed' },
      dryRun: { supported: true, artifact: { kind: 'typeKroResource', path: `plans/${targetId}.dry-run.json` }, failurePolicy: 'failClosed' },
      ownership: { ownerReferences: 'optional', orphanPolicy: 'retain' },
      finalizers: { required: false, cleanupOperation: 'deleteTarget' },
      permissions,
      diagnostics: [],
    },
    source,
    spec,
    adapter: {
      renderApply(target, renderOptions) {
        // typecast: TypeKro operation targets store the original spec with the same generic TGraphSpec accepted by this adapter.
        const rendered = adapter.render(sourceAsGraph(target.source), target.spec as TGraphSpec);
        if (!rendered.ok) {
          return rendered;
        }
        const operations = rendered.value.operations.map((operation) => operation.kind === 'apply' && renderOptions
          ? {
              ...operation,
              ...(renderOptions.fieldManager ? { fieldManager: renderOptions.fieldManager } : {}),
              ...(renderOptions.force === undefined ? {} : { force: renderOptions.force }),
              ...(renderOptions.ownership
                ? { ownership: renderOptions.ownership }
                : renderOptions.owner
                  // typecast: the owner shorthand maps to the literal operation-plan ownership discriminant.
                  ? { ownership: { mode: 'reference' as const, ref: renderOptions.owner } }
                  : {}),
            }
          : operation);
        return ok({ operations });
      },
      renderDelete(target, renderOptions) {
        return ok({
          operations: deletionPlanEntriesForSource(target.source).map(({ resource }) => ({
            // typecast: operation-plan discriminants must stay literal for the runtime contract union.
            kind: 'delete' as const,
            ref: objectRefForResource(resource),
            ...deleteOperationOptions(renderOptions),
          })),
        });
      },
      inferRbac(target) {
        return adapter.inferRbac(sourceAsGraph(target.source));
      },
    },
  };
}

function operationTargetId(source: unknown): string {
  const name = isRecord(source) && typeof source.name === 'string' ? source.name : 'typekro-target';
  return `operation-target.${kubernetesNameSegment(name)}`;
}

function kubernetesNameSegment(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '') || 'target';
}

export function inferRbac<TGraphSpec extends KroCompatibleType = JsonObject, TGraphStatus extends KroCompatibleType = JsonObject, THandlerStatus extends object = TGraphStatus>(
  source: TypeKroOperationTargetSource<TGraphSpec, TGraphStatus> | TypeKroOperationTarget<TGraphSpec, TGraphStatus, THandlerStatus>
): ReturnType<InferTypeKroRbacFunction> {
  try {
    if (isTypeKroOperationTarget(source)) {
      return source.adapter.inferRbac(source);
    }
    return ok(rbacForResources(resourcePlanEntriesForSource(sourceAsGraph(source)).map((entry) => entry.resource)));
  } catch (cause) {
    return err('BUNDLE_INVALID', cause instanceof Error ? cause.message : 'Failed to infer TypeKro RBAC permissions.');
  }
}

export function permissions<TGraphSpec extends KroCompatibleType = JsonObject, TGraphStatus extends KroCompatibleType = JsonObject, THandlerStatus extends object = TGraphStatus>(
  source: TypeKroOperationTargetSource<TGraphSpec, TGraphStatus> | TypeKroOperationTarget<TGraphSpec, TGraphStatus, THandlerStatus>
): ReturnType<TypeKroPermissionsFunction> {
  const inferred = inferRbac(source);
  if (!inferred.ok) {
    throw new Error(inferred.error.message);
  }
  return inferred.value;
}

export function asOperationTargetFactory<TGraphSpec extends KroCompatibleType = JsonObject, TGraphStatus extends KroCompatibleType = JsonObject, THandlerStatus extends object = TGraphStatus>(
  graph: TypeKroGraph<TGraphSpec, TGraphStatus>,
  ...args: TypeKroGraphAdapterOptionsArgument<TGraphStatus, THandlerStatus>
): TypeKroOperationTargetFactory<TGraphSpec, TGraphStatus, THandlerStatus> {
  return (spec: TypeKroOperationTargetSpec<TGraphSpec>) => toOperationTarget<TGraphSpec, TGraphStatus, THandlerStatus>(graph, spec, ...args);
}

function createCrdFactories<TCapabilities extends CapabilityClientSet, TResources extends Readonly<Record<string, AnyResourceDefinition<TCapabilities>>>>(
  resources: TResources,
  defaultNamespace?: string,
  defaultOperator?: OperatorDefinition
): TypeKroEnhancedResourceMapForResources<TCapabilities, TResources> & TypeKroEnhancedResourceAliasMapForResources<TCapabilities, TResources> {
  const factories: Record<string, TypeKroEnhancedResourceFactory> = {};
  for (const [name, resource] of Object.entries(resources)) {
    // typecast: SDK operator resources are ResourceDefinition values with event sources; the public operator resource map is erased to AnyResourceDefinition.
    factories[name] = typeKroResourceFactory(resource as unknown as ResourceDefinition<object, object>, defaultNamespace, defaultOperator);
    factories[uncapitalize(name)] = factories[name];
  }
  // typecast: factory keys are generated from the exact operator resource map plus lower-camel aliases, matching TypeKroOperatorComposition's public resource ergonomics.
  return factories as TypeKroEnhancedResourceMapForResources<TCapabilities, TResources> & TypeKroEnhancedResourceAliasMapForResources<TCapabilities, TResources>;
}

function createInstallResource(resource: KubernetesManifestResource): Enhanced<JsonObject, JsonObject> {
  const factoryResource = createKnownInstallResource(resource);
  if (factoryResource) {
    return withInstallReadiness(resource, factoryResource);
  }
  // typecast: the adapter emits plain Kubernetes resources with supported top-level fields; TypeKro's KubernetesResource type is generated from client models and is stricter than this JSON manifest boundary.
  return withInstallReadiness(resource, createResource(resource as unknown as KubernetesResource<JsonObject, JsonObject>, { scope: resourceScope(resource) }));
}

function createKnownInstallResource(resource: KubernetesManifestResource): Enhanced<JsonObject, JsonObject> | undefined {
  if (resource.kind === 'CustomResourceDefinition') {
    // typecast: install manifests are validated Kubernetes JSON documents; the TypeKro CRD factory expects the generated Kubernetes client model shape for the same document.
    return typeKroCustomResourceDefinition(resource as never) as unknown as Enhanced<JsonObject, JsonObject>;
  }
  if (resource.kind === 'ServiceAccount') {
    // typecast: install manifests are validated Kubernetes JSON documents; the TypeKro ServiceAccount factory expects the generated Kubernetes client model shape for the same document.
    return typeKroServiceAccount(resource as never) as unknown as Enhanced<JsonObject, JsonObject>;
  }
  if (resource.kind === 'Role') {
    // typecast: install manifests are validated Kubernetes JSON documents; the TypeKro Role factory expects the generated Kubernetes client model shape for the same document.
    return typeKroRole(resource as never) as unknown as Enhanced<JsonObject, JsonObject>;
  }
  if (resource.kind === 'ClusterRole') {
    // typecast: install manifests are validated Kubernetes JSON documents; the TypeKro ClusterRole factory expects the generated Kubernetes client model shape for the same document.
    return typeKroClusterRole(resource as never) as unknown as Enhanced<JsonObject, JsonObject>;
  }
  if (resource.kind === 'RoleBinding') {
    // typecast: install manifests are validated Kubernetes JSON documents; the TypeKro RoleBinding factory expects the generated Kubernetes client model shape for the same document.
    return typeKroRoleBinding(resource as never) as unknown as Enhanced<JsonObject, JsonObject>;
  }
  if (resource.kind === 'ClusterRoleBinding') {
    // typecast: install manifests are validated Kubernetes JSON documents; the TypeKro ClusterRoleBinding factory expects the generated Kubernetes client model shape for the same document.
    return typeKroClusterRoleBinding(resource as never) as unknown as Enhanced<JsonObject, JsonObject>;
  }
  if (resource.kind === 'Deployment') {
    // typecast: install manifests are validated Kubernetes JSON documents; the TypeKro Deployment factory expects the generated Kubernetes client model shape for the same document.
    return typeKroDeployment(resource as never) as unknown as Enhanced<JsonObject, JsonObject>;
  }
  return undefined;
}

function withInstallReadiness(resource: KubernetesManifestResource, enhanced: Enhanced<JsonObject, JsonObject>): Enhanced<JsonObject, JsonObject> {
  return enhanced.withReadinessEvaluator((live: unknown): ResourceStatus => {
    if (!live || typeof live !== 'object') {
      return { ready: false, reason: 'NotFound', message: `${resource.kind}/${resource.metadata.name} has not been observed.` };
    }
    if (resource.kind === 'Deployment') {
      const status = Reflect.get(live, 'status');
      const spec = Reflect.get(live, 'spec');
      const availableReplicas = isRecord(status) && typeof status.availableReplicas === 'number' ? status.availableReplicas : 0;
      const desiredReplicas = isRecord(spec) && typeof spec.replicas === 'number' ? spec.replicas : 1;
      return availableReplicas >= desiredReplicas
        ? { ready: true, reason: 'Available', message: `${resource.kind}/${resource.metadata.name} has ${availableReplicas}/${desiredReplicas} replicas available.` }
        : { ready: false, reason: 'Unavailable', message: `${resource.kind}/${resource.metadata.name} has ${availableReplicas}/${desiredReplicas} replicas available.` };
    }
    if (resource.kind === 'CustomResourceDefinition') {
      const status = Reflect.get(live, 'status');
      const conditions = isRecord(status) && Array.isArray(status.conditions) ? status.conditions : [];
      const established = conditions.some((condition) => isRecord(condition) && condition.type === 'Established' && condition.status === 'True');
      return established
        ? { ready: true, reason: 'Established', message: `${resource.kind}/${resource.metadata.name} is established.` }
        : { ready: false, reason: 'Establishing', message: `${resource.kind}/${resource.metadata.name} is not established yet.` };
    }
    return { ready: true, reason: 'Observed', message: `${resource.kind}/${resource.metadata.name} exists.` };
  });
}

function typeKroResourceFactory(resource: ResourceDefinition<object, object>, defaultNamespace?: string, defaultOperator?: OperatorDefinition): TypeKroEnhancedResourceFactory {
  return (input: TypeKroResourceInput) => {
    const namespace = input.namespace ?? defaultNamespace;
    const created = createResource({
      apiVersion: resource.apiVersion,
      kind: resource.kind,
      metadata: {
        name: input.name,
        ...(namespace ? { namespace } : {}),
        ...(input.labels ? { labels: input.labels } : {}),
        ...(input.annotations ? { annotations: input.annotations } : {}),
      },
      spec: input.spec,
      id: `${uncapitalize(resource.kind)}${pascalCase(input.name)}`,
    }, { scope: resource.scope === 'Cluster' ? 'cluster' : 'namespaced' });
    const watch: ResourceWatchAddress = {
      ...(typeof namespace === 'string' ? { namespace } : {}),
      name: input.name,
    };
    const enhanced = attachNonEnumerableEventSources(created, groupedEventSources(resource, resource.on, watch, defaultOperator));
    Object.defineProperty(enhanced, typeKroResourceListenerMetadata, {
      value: { resource, watch },
      enumerable: false,
      configurable: false,
    });
    // typecast: the generated resource is a TypeKro Enhanced proxy augmented with applik8s listener methods; its spec/status generic parameters are preserved at the factory-map type boundary.
    return enhanced as ReturnType<TypeKroEnhancedResourceFactory>;
  };
}

function attachNonEnumerableEventSources<TResource extends object, TEventSources>(resource: TResource, eventSources: TEventSources): TResource & { readonly on: TEventSources } {
  Object.defineProperty(resource, 'on', {
    value: eventSources,
    enumerable: false,
    configurable: false,
  });
  // typecast: Object.defineProperty mutates the resource with a hidden listener API while preserving its Kubernetes-serializable enumerable shape.
  return resource as TResource & { readonly on: TEventSources };
}

function installResources<
  TCapabilities extends CapabilityClientSet,
  TResources extends Readonly<Record<string, AnyResourceDefinition<TCapabilities>>>,
>(
  operator: OperatorDefinition<TCapabilities, TResources>,
  deployment: OperatorDefinition['deployment'],
  resources: readonly AnyResourceDefinition[],
  manifest: OperatorManifest,
  namespace: string,
  replicas: number
): readonly KubernetesManifestResource[] {
  const operatorName = operator.name;
  validateDeploymentOperationalSafety(operatorName, replicas, manifest);
  const serviceAccountName = deployment?.serviceAccountName ?? `${operatorName}-controller`;
  const clusterRbac = requiresClusterRbac(operator, deployment, namespace);
  const image = manifest.spec.container ? imageRefString(manifest.spec.container.image) : undefined;
  if (!image) {
    throw new Error('Operator manifest is missing the compiler-derived runtime image.');
  }
  const ownedResources = resources.filter(isOwnedResource);
  const connectionSecretPermissions = connectionSecretPermissionRules(manifest);
  const clusterPermissions = clusterRbac
    ? manifest.spec.permissions.filter((permission) => !connectionSecretPermissions.includes(permission))
    : [];
  const namespacedPermissions = clusterRbac ? connectionSecretPermissions : manifest.spec.permissions;
  return [
    ...ownedResources.map((resource, index) => crdDocument(resource, `ownedCrd${index + 1}`, manifest)),
    serviceAccountDocument(serviceAccountName, namespace, manifest),
    ...(clusterPermissions.length > 0 ? [
      rbacRoleDocument(operatorName, clusterPermissions, namespace, true, manifest),
      rbacBindingDocument(operatorName, serviceAccountName, namespace, true, manifest),
    ] : []),
    ...(namespacedPermissions.length > 0 ? [
      rbacRoleDocument(operatorName, namespacedPermissions, namespace, false, manifest, clusterRbac ? 'connection-secrets' : 'controller'),
      rbacBindingDocument(operatorName, serviceAccountName, namespace, false, manifest, clusterRbac ? 'connection-secrets' : 'controller'),
    ] : []),
    deploymentDocument(manifest, serviceAccountName, image, namespace, replicas),
  ];
}

function requiresClusterRbac<
  TCapabilities extends CapabilityClientSet,
  TResources extends Readonly<Record<string, AnyResourceDefinition<TCapabilities>>>,
>(operator: OperatorDefinition<TCapabilities, TResources>, deployment: OperatorDefinition['deployment'], controllerNamespace: string): boolean {
  if (deployment?.scope === 'Cluster') return true;
  if (Object.values(operator.resources).some((resource) => resource.scope === 'Cluster')) return true;
  return Object.values(operator.reads ?? {}).some((resource) => {
    if (resource.access === 'connection') return false;
    if (resource.scope === 'Cluster' || resource.namespaces === 'all') return true;
    if (!resource.namespaces || resource.namespaces.length === 0) return false;
    return resource.namespaces.some((namespace) => namespace !== controllerNamespace);
  });
}

function operatorGeneratedCrdPrerequisites(
  operator: OperatorDefinition,
  manifest: OperatorManifest
): readonly PrerequisiteResource[] {
  // typecast: SDK operator resources are ResourceDefinition values with event sources; CRD emission only needs erased resource metadata.
  const resources = Object.values(operator.resources) as unknown as readonly AnyResourceDefinition[];
  const crds = resources
    .filter(isOwnedResource)
    .map((resource, index): PrerequisiteResource => {
      const document = crdDocument(
        resource,
        `${operator.name.replace(/[^a-zA-Z0-9]/g, '')}PrerequisiteCrd${index + 1}`,
        manifest
      );
      // typecast: this concrete CRD is cluster-scoped; only the adapter's erased manifest union carries unrelated optional RBAC fields.
      return { ...document, scope: 'cluster' } as unknown as PrerequisiteResource;
    });
  return crds;
}

function validateDeploymentOperationalSafety(operatorName: string, replicas: number, manifest: OperatorManifest): void {
  const leaderElection = manifest.spec.runtime?.leaderElection;
  if (replicas > 1 && !leaderElection?.enabled) {
    throw new Error(`Operator ${operatorName} requested ${replicas} replicas, but multi-replica operators require runtime.leaderElection.enabled.`);
  }
  const unsupportedConcurrency = unsupportedRuntimeConcurrency(manifest.spec.runtime?.concurrency);
  if (unsupportedConcurrency) {
    throw new Error(unsupportedConcurrency);
  }
}

function unsupportedRuntimeConcurrency(concurrency: ConcurrencyConfig | undefined): string | undefined {
  if (!concurrency) {
    return undefined;
  }
  if (concurrency.workerCount !== 1) {
    return 'runtime.concurrency.workerCount greater than 1 is not supported until the operator host implements explicit worker concurrency semantics.';
  }
  if (concurrency.maxInFlightPerResource !== 1) {
    return 'runtime.concurrency.maxInFlightPerResource greater than 1 is not supported until the operator host implements per-resource concurrency control.';
  }
  if (concurrency.maxQueueDepth !== undefined) {
    return 'runtime.concurrency.maxQueueDepth is not supported until the operator host exposes trustworthy kube-runtime queue depth controls.';
  }
  return undefined;
}

function crdDocument(resource: AnyResourceDefinition, id: string, manifest: OperatorManifest): KubernetesManifestResource {
  const { group } = splitApiVersion(resource.apiVersion);
  return {
    apiVersion: 'apiextensions.k8s.io/v1',
    kind: 'CustomResourceDefinition',
    id,
    metadata: metadata(`${resource.plural}.${group}`, undefined, manifest),
    spec: {
      group,
      scope: resource.scope,
      names: {
        plural: resource.plural,
        singular: singularize(resource.plural),
        kind: resource.kind,
      },
      versions: resource.versions.map((version) => crdVersionDocument(resource, version)),
    },
  };
}

function isOwnedResource(resource: AnyResourceDefinition): boolean {
  return resource.resourceOwnership !== 'external';
}

function crdVersionDocument(resource: AnyResourceDefinition, version: AnyResourceVersionDefinition): JsonObject {
  const specSchema = emitStructuralOpenApiSchema(version.spec, `${resource.kind}.${version.name}.spec`);
  const statusSchema = version.status
    ? statusSchemaWithConvention(emitStructuralOpenApiSchema(version.status, `${resource.kind}.${version.name}.status`), resource.statusConvention, `${resource.kind}.${version.name}.status`)
    : undefined;
  return compactObject({
    name: version.name,
    served: version.served,
    storage: version.storage,
    schema: {
      openAPIV3Schema: {
        type: 'object',
        properties: compactObject({
          spec: specSchema,
          status: statusSchema,
        }),
        required: ['spec'],
      },
    },
    subresources: resource.statusSubresource ? { status: {} } : undefined,
    additionalPrinterColumns: resource.additionalPrinterColumns ? [...resource.additionalPrinterColumns] : undefined,
  });
}

function statusSchemaWithConvention(schema: JsonObject, convention: StatusConvention | undefined, path: string): JsonObject {
  if (!convention) {
    return schema;
  }
  if (schema.type !== 'object') {
    throw new Error(`CRD schema ${path} uses statusConvention but status schema is not an object.`);
  }
  const properties = isJsonObject(schema.properties) ? { ...schema.properties } : {};
  if (!isJsonObject(properties[convention.observedGenerationField])) {
    properties[convention.observedGenerationField] = { type: 'integer', format: 'int64' };
  }
  if (!isJsonObject(properties[convention.conditionsField])) {
    properties[convention.conditionsField] = conditionArraySchema();
  }
  return { ...schema, properties };
}

function conditionArraySchema(): JsonObject {
  return {
    type: 'array',
    'x-kubernetes-list-type': 'map',
    'x-kubernetes-list-map-keys': ['type'],
    items: {
      type: 'object',
      required: ['type', 'status', 'reason', 'message', 'lastTransitionTime'],
      properties: {
        type: { type: 'string' },
        status: { type: 'string', enum: ['True', 'False', 'Unknown'] },
        reason: { type: 'string' },
        message: { type: 'string' },
        observedGeneration: { type: 'integer', format: 'int64' },
        lastTransitionTime: { type: 'string', format: 'date-time' },
      },
    },
  };
}

function serviceAccountDocument(name: string, namespace: string, manifest: OperatorManifest): KubernetesManifestResource {
  return {
    apiVersion: 'v1',
    kind: 'ServiceAccount',
    id: 'operatorServiceAccount',
    metadata: metadata(name, namespace, manifest),
  };
}

function rbacRoleDocument(operatorName: string, permissions: readonly PermissionRule[], namespace: string, clusterRbac: boolean, manifest: OperatorManifest, suffix = 'controller'): KubernetesManifestResource {
  const name = clusterRbac ? clusterRbacName(operatorName, namespace) : `${operatorName}-${suffix}`;
  return {
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: clusterRbac ? 'ClusterRole' : 'Role',
    id: clusterRbac ? 'operatorClusterRole' : suffix === 'controller' ? 'operatorRole' : 'operatorConnectionSecretRole',
    metadata: metadata(name, clusterRbac ? undefined : namespace, manifest),
    rules: permissions.map((permission) => compactObject({
      apiGroups: [...permission.apiGroups],
      resources: [...permission.resources],
      verbs: [...permission.verbs],
      resourceNames: permission.resourceNames ? [...permission.resourceNames] : undefined,
    })),
  };
}

function rbacBindingDocument(operatorName: string, serviceAccountName: string, namespace: string, clusterRbac: boolean, manifest: OperatorManifest, suffix = 'controller'): KubernetesManifestResource {
  const name = clusterRbac ? clusterRbacName(operatorName, namespace) : `${operatorName}-${suffix}`;
  return {
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: clusterRbac ? 'ClusterRoleBinding' : 'RoleBinding',
    id: clusterRbac ? 'operatorClusterRoleBinding' : suffix === 'controller' ? 'operatorRoleBinding' : 'operatorConnectionSecretRoleBinding',
    metadata: metadata(name, clusterRbac ? undefined : namespace, manifest),
    roleRef: {
      apiGroup: 'rbac.authorization.k8s.io',
      kind: clusterRbac ? 'ClusterRole' : 'Role',
      name,
    },
    subjects: [compactObject({
      kind: 'ServiceAccount',
      name: serviceAccountName,
      namespace,
    })],
  };
}

function connectionSecretPermissionRules(manifest: OperatorManifest): readonly PermissionRule[] {
  const secretNames = new Set(Object.values(manifest.spec.kubernetesConnectionBindings ?? {})
    .map((binding) => binding.kubeconfigSecretRef.name));
  return manifest.spec.permissions.filter((permission) =>
    permission.apiGroups.length === 1
    && permission.apiGroups[0] === ''
    && permission.resources.length === 1
    && permission.resources[0] === 'secrets'
    && permission.verbs.length === 1
    && permission.verbs[0] === 'get'
    && permission.resourceNames?.length === 1
    && secretNames.has(permission.resourceNames[0] ?? ''));
}

function clusterRbacName(operatorName: string, namespace: string): string {
  return `${namespace}-${operatorName}-controller`;
}

function deploymentDocument(manifest: OperatorManifest, serviceAccountName: string, image: string, namespace: string, replicas: number): KubernetesManifestResource {
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    id: 'operatorDeployment',
    metadata: metadata(manifest.metadata.name, namespace, manifest),
    spec: {
      replicas,
      selector: { matchLabels: appLabels(manifest.metadata.name) },
      template: {
        metadata: { labels: appLabels(manifest.metadata.name), annotations: auditAnnotations(manifest) },
        spec: {
          serviceAccountName,
          containers: [
            {
              name: 'operator-host',
              image,
              imagePullPolicy: 'IfNotPresent',
              ports: [{ name: 'health', containerPort: 8080 }],
              env: operatorHostEnv(manifest),
              startupProbe: {
                httpGet: { path: '/healthz', port: 'health' },
                failureThreshold: 36,
                periodSeconds: 5,
                timeoutSeconds: 5,
              },
              livenessProbe: {
                httpGet: { path: '/healthz', port: 'health' },
                initialDelaySeconds: 60,
                failureThreshold: 12,
                periodSeconds: 10,
                timeoutSeconds: 5,
              },
              readinessProbe: {
                httpGet: { path: manifest.spec.runtime?.leaderElection?.enabled ? '/healthz' : '/readyz', port: 'health' },
                initialDelaySeconds: 1,
                failureThreshold: 12,
                periodSeconds: 5,
                timeoutSeconds: 5,
              },
            },
          ],
        },
      },
    },
  };
}

function operatorHostEnv(manifest: OperatorManifest): readonly JsonObject[] {
  const replayArtifacts = manifest.spec.runtime?.replayArtifacts;
  return [
    { name: 'APPLIK8S_OPERATOR_NAME', value: manifest.metadata.name },
    { name: 'APPLIK8S_MANIFEST_PATH', value: '/etc/applik8s/operator-manifest.json' },
    { name: 'APPLIK8S_HANDLER_PATH', value: '/handler/handler.wasm' },
    { name: 'APPLIK8S_HEALTH_ADDR', value: '0.0.0.0:8080' },
    { name: 'APPLIK8S_HANDLER_TIMEOUT_SECONDS', value: String(manifest.spec.runtime?.handlerTimeoutSeconds ?? 30) },
    { name: 'OTEL_SERVICE_NAME', value: manifest.metadata.name },
    { name: 'OTEL_RESOURCE_ATTRIBUTES', value: `service.namespace=applik8s,applik8s.operator=${manifest.metadata.name},applik8s.bundle_digest=${manifest.spec.bundle.digest}` },
    { name: 'OTEL_METRIC_EXPORT_INTERVAL', value: '30000' },
    ...(replayArtifacts?.enabled && replayArtifacts.directory ? [
      { name: 'APPLIK8S_REPLAY_ARTIFACT_DIR', value: replayArtifacts.directory },
      ...(replayArtifacts.includePayloads ? [{ name: 'APPLIK8S_REPLAY_INCLUDE_PAYLOADS', value: '1' }] : []),
    ] : []),
    { name: 'APPLIK8S_LEADER_ELECTION_IDENTITY', valueFrom: { fieldRef: { fieldPath: 'metadata.name' } } },
    { name: 'APPLIK8S_POD_NAMESPACE', valueFrom: { fieldRef: { fieldPath: 'metadata.namespace' } } },
  ];
}

function resourceScope(resource: KubernetesManifestResource): 'cluster' | 'namespaced' {
  return resource.metadata.namespace ? 'namespaced' : 'cluster';
}

function emitStructuralOpenApiSchema(schema: AnyResourceVersionDefinition['spec'], path: string): JsonObject {
  const result = schema.emitOpenApiSchema();
  if (!result.ok) {
    throw new Error(`CRD schema ${path} failed to emit OpenAPI schema: ${result.error.message}`);
  }
  const unsupported = result.value.diagnostics.find((diagnostic) => diagnostic.severity === 'warning' || diagnostic.severity === 'error');
  if (unsupported) {
    throw new Error(`CRD schema ${path} is not structurally supported: ${unsupported.message}`);
  }
  const diagnostics = validateStructuralOpenApiSchema(result.value.schema, path);
  if (diagnostics.length > 0) {
    throw new Error(diagnostics[0]?.message ?? `CRD schema ${path} is not structurally valid.`);
  }
  return toKubernetesStructuralOpenApiSchema(result.value.schema);
}

function metadata(name: string, namespace: string | undefined, manifest: OperatorManifest): { readonly name: string; readonly namespace?: string; readonly labels: Readonly<Record<string, string>>; readonly annotations: Readonly<Record<string, string>> } {
  return {
    name,
    ...(namespace ? { namespace } : {}),
    labels: appLabels(manifest.metadata.name),
    annotations: auditAnnotations(manifest),
  };
}

function auditAnnotations(manifest: OperatorManifest): Readonly<Record<string, string>> {
  const portability = manifest.spec.security.portability;
  const storageVersions = manifest.spec.ownedCrds.map((crd) => `${crd.apiVersion}/${crd.kind}=${crd.storageVersion}`);
  const conversionStrategies = manifest.spec.ownedCrds.map((crd) => `${crd.apiVersion}/${crd.kind}=${crd.conversionStrategy}`);
  return {
    'applik8s.dev/bundle-digest': manifest.spec.bundle.digest,
    'applik8s.dev/source-digest': manifest.spec.bundle.sourceDigest,
    'applik8s.dev/compiler-version': manifest.spec.bundle.compilerVersion,
    'applik8s.dev/handler-abi': manifest.spec.handlerAbi,
    'applik8s.dev/requires-runtime': manifest.spec.requiresRuntime,
    'applik8s.dev/handler-timeout-seconds': String(manifest.spec.runtime?.handlerTimeoutSeconds ?? 30),
    'applik8s.dev/crd-storage-versions': storageVersions.join(','),
    'applik8s.dev/crd-conversion-strategies': conversionStrategies.join(','),
    'applik8s.dev/crd-multi-version': manifest.spec.ownedCrds.some((crd) => crd.versioning.multiVersion !== 'singleVersion') ? 'unsupported' : 'singleVersion',
    'applik8s.dev/crd-storage-migration': manifest.spec.ownedCrds.some((crd) => crd.versioning.storageMigration !== 'notRequired') ? 'unsupported' : 'notRequired',
    'applik8s.dev/rollback-safety': manifest.spec.ownedCrds.every((crd) => crd.versioning.rollbackSafety === 'schemaCompatibleOnly') ? 'schemaCompatibleOnly' : 'unknown',
    'applik8s.dev/uninstall-controller-domain-data': manifest.spec.lifecycle.uninstallController.domainDataPolicy.destructive ? 'destructive' : 'preserve',
    'applik8s.dev/delete-domain-data-confirmation': manifest.spec.lifecycle.deleteDomainData.requiresExplicitConfirmation ? 'required' : 'notRequired',
    'applik8s.dev/supply-chain-signing': manifest.spec.bundle.supplyChain.posture?.signing ?? 'unknown',
    'applik8s.dev/supply-chain-sbom': manifest.spec.bundle.supplyChain.posture?.sbom ?? 'unknown',
    'applik8s.dev/supply-chain-provenance': manifest.spec.bundle.supplyChain.posture?.provenance ?? 'unknown',
    'applik8s.dev/admission-verification': manifest.spec.bundle.supplyChain.posture?.admission ?? 'unknown',
    'applik8s.dev/security-enforcement': portability.enforcement,
    'applik8s.dev/rbac-mode': manifest.spec.security.rbac.mode,
    'applik8s.dev/rbac-least-privilege-reviewed': String(manifest.spec.security.rbac.leastPrivilegeReviewed),
    'applik8s.dev/rbac-rule-count': String(manifest.spec.security.rbac.rules.length),
    'applik8s.dev/host-imports': manifest.spec.adapterRequirements?.hostImports?.join(',') ?? '',
    'applik8s.dev/capabilities': Object.keys(manifest.spec.capabilities ?? {}).join(','),
    'applik8s.dev/capability-kinds': [...new Set(Object.values(manifest.spec.capabilities ?? {}).map((descriptor) => descriptor.kind))].join(','),
    'applik8s.dev/capability-protocols': [...new Set(manifest.spec.security.capabilities.map((capability) => capability.execution.protocol))].join(','),
    'applik8s.dev/capability-live-execution': manifest.spec.security.capabilities.some((capability) => capability.execution.liveExecution !== 'disabled') ? 'enabled' : 'disabled',
    'applik8s.dev/capability-redaction': manifest.spec.security.capabilities.length > 0 ? 'payloads-redacted' : 'none',
    'applik8s.dev/capability-idempotency': manifest.spec.security.capabilities.some((capability) => capability.execution.idempotency.requiredForMutations) ? 'requiredForMutations' : 'none',
    'applik8s.dev/ambient-environment': portability.environmentAccess,
    'applik8s.dev/ambient-filesystem': portability.filesystemAccess,
    'applik8s.dev/ambient-network': portability.networkAccess,
    'applik8s.dev/embedded-secret-material': portability.embeddedSecretMaterial,
    'applik8s.dev/local-credential-paths': portability.localCredentialPaths,
    'applik8s.dev/unsupported-native-modules': portability.unsupportedNativeModules,
  };
}

function managedLabels(): Readonly<Record<string, string>> {
  return { 'app.kubernetes.io/managed-by': 'applik8s' };
}

function appLabels(name: string): Readonly<Record<string, string>> {
  return { ...managedLabels(), 'app.kubernetes.io/name': name };
}

function splitApiVersion(apiVersion: string): { readonly group: string; readonly version: string } {
  if (!apiVersion.includes('/')) {
    return { group: '', version: apiVersion };
  }
  const [group, version] = apiVersion.split('/');
  return { group: group ?? '', version: version ?? 'v1' };
}

function singularize(plural: string): string {
  if (plural.endsWith('ies')) {
    return `${plural.slice(0, -3)}y`;
  }
  if (plural.endsWith('s')) {
    return plural.slice(0, -1);
  }
  return plural;
}

function pascalCase(value: string): string {
  const words = value.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  const result = words.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join('');
  return result || 'Applik8sOperatorInstall';
}

function uncapitalize(value: string): string {
  return value.length === 0 ? value : `${value.charAt(0).toLowerCase()}${value.slice(1)}`;
}

function compactObject<T extends Record<string, unknown>>(value: T): JsonObject {
  const compacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) {
      compacted[key] = entry;
    }
  }
  // typecast: removing undefined fields preserves JSON object contents for Kubernetes manifest emission.
  return compacted as JsonObject;
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function isDependencyGraphLike(value: unknown): value is TypeKroDependencyGraphLike {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof Reflect.get(value, 'getTopologicalOrder') === 'function' &&
      typeof Reflect.get(value, 'getDependencies') === 'function'
  );
}

function copyDescriptors(source: object, target: object): void {
  for (const key of [...Object.getOwnPropertyNames(source), ...Object.getOwnPropertySymbols(source)]) {
    if (key === 'length' || key === 'name' || key === 'prototype') {
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (descriptor) {
      Object.defineProperty(target, key, descriptor);
    }
  }
}

function sourceAsGraph<TGraphSpec extends KroCompatibleType, TGraphStatus extends KroCompatibleType>(source: TypeKroOperationTargetSource<TGraphSpec, TGraphStatus>): TypeKroGraph<TGraphSpec, TGraphStatus> {
  if ('__resources' in source) {
    // typecast: nested TypeKro composition resources expose __resources, which is sufficient for operation-plan rendering without requiring deployment factory methods.
    return { name: source.__compositionId, resources: source.__resources } as TypeKroGraph<TGraphSpec, TGraphStatus>;
  }
  return source;
}

function resourcePlanEntriesForSource(source: unknown): readonly TypeKroResourcePlanEntry[] {
  if (!source || typeof source !== 'object') {
    throw new Error('TypeKro source must be an object with resources.');
  }
  const resources = '__resources' in source ? Reflect.get(source, '__resources') : Reflect.get(source, 'resources');
  if (!Array.isArray(resources)) {
    throw new Error('TypeKro source must expose resources or __resources.');
  }
  return resources.map(resourcePlanEntry);
}

function statusProjectionForSource(source: unknown): JsonObject {
  if (!isRecord(source)) {
    return {};
  }
  const status = Reflect.get(source, 'status');
  return isJsonObject(status) ? compactObject(status) : {};
}

function deletionPlanEntriesForSource(source: unknown): readonly TypeKroResourcePlanEntry[] {
  const entries = resourcePlanEntriesForSource(source);
  const graph = dependencyGraphForSource(source);
  if (!graph) {
    return entries;
  }

  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const orderedIds = reverseTopologicalOrder(graph, entries.map((entry) => entry.id));
  const ordered = orderedIds.map((id) => byId.get(id)).filter((entry): entry is TypeKroResourcePlanEntry => Boolean(entry));
  return ordered.length === entries.length ? ordered : [...entries].reverse();
}

function dependencyGraphForSource(source: unknown): TypeKroDependencyGraphLike | undefined {
  if (!isRecord(source)) {
    return undefined;
  }
  const dependencyGraph = Reflect.get(source, 'dependencyGraph');
  return isDependencyGraphLike(dependencyGraph) ? dependencyGraph : undefined;
}

function reverseTopologicalOrder(graph: TypeKroDependencyGraphLike, ids: readonly string[]): readonly string[] {
  const order = graph.getTopologicalOrder().filter((id) => ids.includes(id));
  if (order.length !== ids.length) {
    return [...ids].reverse();
  }
  return [...order].reverse();
}

function resourcePlanEntry(input: unknown, index: number): TypeKroResourcePlanEntry {
  const source = isRecord(input) && isRecord(input.manifest) ? input.manifest : input;
  const resource = resourceToKubernetesObject(source);
  const id = resourceIdForEntry(input, resource, index);
  const deployable = isRecord(source) ? { ...source, id } : { ...resource, id };
  return { id, resource, deployable };
}

function resourceToKubernetesObject(resource: unknown): KubernetesLikeResource {
  const json = typeof resource === 'object' && resource !== null && typeof Reflect.get(resource, 'toJSON') === 'function'
    ? Reflect.get(resource, 'toJSON').call(resource)
    // typecast: JSON serialization erases TypeKro proxy wrappers into plain Kubernetes manifest data for operation-plan emission.
    : JSON.parse(JSON.stringify(resource)) as unknown;
  if (!isKubernetesLikeResource(json)) {
    throw new Error('TypeKro resource did not serialize to a Kubernetes object with apiVersion, kind, and metadata.name.');
  }
  return json;
}

function resourceIdForEntry(input: unknown, resource: KubernetesLikeResource, index: number): string {
  if (isRecord(input) && typeof input.id === 'string' && input.id.length > 0) {
    return input.id;
  }
  if (typeof resource.id === 'string' && resource.id.length > 0) {
    return resource.id;
  }
  const metadataAnnotations = Reflect.get(resource.metadata, 'annotations');
  const annotations = isRecord(metadataAnnotations) ? metadataAnnotations : undefined;
  const annotated = annotations?.['typekro.io/resource-id'];
  if (typeof annotated === 'string' && annotated.length > 0) {
    return annotated;
  }
  return `${resource.apiVersion}/${resource.kind}/${resource.metadata.namespace ?? '_'}/${resource.metadata.name}/${index}`;
}

function deleteOperationOptions(options: DeleteTargetOptions | undefined): object {
  if (!options?.propagationPolicy && options?.gracePeriodSeconds === undefined) {
    return {};
  }
  return {
    options: compactObject({
      propagationPolicy: options.propagationPolicy,
      gracePeriodSeconds: options.gracePeriodSeconds,
    }),
  };
}

function objectRefForResource(resource: KubernetesLikeResource): ObjectRef {
  return {
    apiVersion: resource.apiVersion,
    kind: resource.kind,
    name: resource.metadata.name,
    ...(resource.metadata.namespace ? { namespace: resource.metadata.namespace } : {}),
  };
}

function rbacForResources(resources: readonly KubernetesLikeResource[]): readonly PermissionRule[] {
  const rules = new Map<string, PermissionRule>();
  for (const resource of resources) {
    const apiGroup = resource.apiVersion.includes('/') ? resource.apiVersion.split('/')[0] ?? '' : '';
    const key = `${apiGroup}/${resource.kind}`;
    if (!rules.has(key)) {
      rules.set(key, { apiGroups: [apiGroup], resources: [pluralize(resource.kind)], verbs: ['get', 'create', 'update', 'patch', 'delete'] });
    }
  }
  return [...rules.values()];
}

function pluralize(kind: string): string {
  const lower = kind.toLowerCase();
  if (lower.endsWith('s')) {
    return `${lower}es`;
  }
  if (lower.endsWith('y')) {
    return `${lower.slice(0, -1)}ies`;
  }
  return `${lower}s`;
}

function isKubernetesLikeResource(value: unknown): value is KubernetesLikeResource {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof Reflect.get(value, 'apiVersion') === 'string' &&
      typeof Reflect.get(value, 'kind') === 'string' &&
      Reflect.get(value, 'metadata') &&
      typeof Reflect.get(Reflect.get(value, 'metadata'), 'name') === 'string'
  );
}

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function err<T = never>(code: 'BUNDLE_INVALID', message: string): Result<T> {
  return { ok: false, error: { code, message, severity: 'error', context: {}, recovery: { summary: message } } };
}
