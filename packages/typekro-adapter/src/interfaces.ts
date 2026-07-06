import type {
  CallableComposition,
  Composable,
  DirectResourceFactory,
  Enhanced,
  KroResourceFactory,
  KroCompatibleType,
  MagicAssignableShape,
  NestedCompositionResource,
  PublicFactoryOptions,
  ResourceFactory,
  SerializationOptions,
  TypedResourceGraph,
} from 'typekro';
import type { Type } from 'arktype';

import type {
  AnyResourceDefinition,
  ApplicationOperationTargetContract,
  CapabilityClientSet,
  FinalizeHandlerOptions,
  Handler,
  HandlerRegistration,
  GraphAdapter,
  JsonObject,
  LabelSelector,
  NormalizedOperationPlan,
  OperationTarget,
  OperationTargetAdapter,
  OperationTargetLoweringArtifacts,
  OperatorDefinition,
  OperatorDeploymentOptions,
  OperatorManifest,
  PartialStatus,
  PermissionRule,
  ProxyHandler,
  ResourceDefinition,
  Result,
} from '@applik8s/core';
import type { CallableOperator, CrdOptions, OperatorOptions } from '@applik8s/sdk';

export type TypeKroFactoryMode = 'direct' | 'kro';
export type TypeKroInstallPhase = 'Pending' | 'Installing' | 'Ready' | 'Failed';
export interface TypeKroCompositionResource extends JsonObject {
  readonly apiVersion: string;
  readonly kind: string;
  readonly metadata: JsonObject & {
    readonly name: string;
    readonly namespace?: string;
  };
}
export type TypeKroResourceDefinitionMap<TCapabilities extends CapabilityClientSet = CapabilityClientSet> = Readonly<
  Record<string, AnyResourceDefinition<TCapabilities>>
>;
export type TypeKroListenerOperatorOptions<
  TCapabilities extends CapabilityClientSet = CapabilityClientSet,
  TResources extends TypeKroResourceDefinitionMap<TCapabilities> = TypeKroResourceDefinitionMap<TCapabilities>,
> = Omit<OperatorOptions<TCapabilities, TResources>, 'resources' | 'handlers'>;
export type TypeKroSourceFactory<TInput = unknown, TOutput extends object = object> = (input: TInput) => TOutput;
export type TypeKroListenerResourceOptions<TSpec extends object, TStatus extends object> = CrdOptions<TSpec, TStatus>;
export interface TypeKroGroupedContextResourceEventSources<TSpec extends object, TStatus extends object, TCapabilities extends CapabilityClientSet = CapabilityClientSet> {
  reconcile(handler: Handler<TSpec, TStatus, TCapabilities>): HandlerRegistration<TSpec, TStatus, TCapabilities>;
  reconcile(operator: CallableOperator, handler: Handler<TSpec, TStatus, TCapabilities>): HandlerRegistration<TSpec, TStatus, TCapabilities>;
  created(handler: Handler<TSpec, TStatus, TCapabilities>): HandlerRegistration<TSpec, TStatus, TCapabilities>;
  created(operator: CallableOperator, handler: Handler<TSpec, TStatus, TCapabilities>): HandlerRegistration<TSpec, TStatus, TCapabilities>;
  updated(handler: Handler<TSpec, TStatus, TCapabilities>): HandlerRegistration<TSpec, TStatus, TCapabilities>;
  updated(operator: CallableOperator, handler: Handler<TSpec, TStatus, TCapabilities>): HandlerRegistration<TSpec, TStatus, TCapabilities>;
  deleted(handler: Handler<TSpec, TStatus, TCapabilities>): HandlerRegistration<TSpec, TStatus, TCapabilities>;
  deleted(operator: CallableOperator, handler: Handler<TSpec, TStatus, TCapabilities>): HandlerRegistration<TSpec, TStatus, TCapabilities>;
  finalize(handler: Handler<TSpec, TStatus, TCapabilities>, options?: FinalizeHandlerOptions): HandlerRegistration<TSpec, TStatus, TCapabilities>;
  finalize(operator: CallableOperator, handler: Handler<TSpec, TStatus, TCapabilities>, options?: FinalizeHandlerOptions): HandlerRegistration<TSpec, TStatus, TCapabilities>;
  statusChanged(handler: Handler<TSpec, TStatus, TCapabilities>): HandlerRegistration<TSpec, TStatus, TCapabilities>;
  statusChanged(operator: CallableOperator, handler: Handler<TSpec, TStatus, TCapabilities>): HandlerRegistration<TSpec, TStatus, TCapabilities>;
}
export interface TypeKroGroupedResourceEventSources<TSpec extends object, TStatus extends object, TCapabilities extends CapabilityClientSet = CapabilityClientSet> {
  readonly context: TypeKroGroupedContextResourceEventSources<TSpec, TStatus, TCapabilities>;
  reconcile(handler: ProxyHandler<TSpec, TStatus, TCapabilities>): HandlerRegistration<TSpec, TStatus, TCapabilities>;
  reconcile(operator: CallableOperator, handler: ProxyHandler<TSpec, TStatus, TCapabilities>): HandlerRegistration<TSpec, TStatus, TCapabilities>;
  created(handler: ProxyHandler<TSpec, TStatus, TCapabilities>): HandlerRegistration<TSpec, TStatus, TCapabilities>;
  created(operator: CallableOperator, handler: ProxyHandler<TSpec, TStatus, TCapabilities>): HandlerRegistration<TSpec, TStatus, TCapabilities>;
  updated(handler: ProxyHandler<TSpec, TStatus, TCapabilities>): HandlerRegistration<TSpec, TStatus, TCapabilities>;
  updated(operator: CallableOperator, handler: ProxyHandler<TSpec, TStatus, TCapabilities>): HandlerRegistration<TSpec, TStatus, TCapabilities>;
  deleted(handler: ProxyHandler<TSpec, TStatus, TCapabilities>): HandlerRegistration<TSpec, TStatus, TCapabilities>;
  deleted(operator: CallableOperator, handler: ProxyHandler<TSpec, TStatus, TCapabilities>): HandlerRegistration<TSpec, TStatus, TCapabilities>;
  finalize(handler: ProxyHandler<TSpec, TStatus, TCapabilities>, options?: FinalizeHandlerOptions): HandlerRegistration<TSpec, TStatus, TCapabilities>;
  finalize(operator: CallableOperator, handler: ProxyHandler<TSpec, TStatus, TCapabilities>, options?: FinalizeHandlerOptions): HandlerRegistration<TSpec, TStatus, TCapabilities>;
  statusChanged(handler: ProxyHandler<TSpec, TStatus, TCapabilities>): HandlerRegistration<TSpec, TStatus, TCapabilities>;
  statusChanged(operator: CallableOperator, handler: ProxyHandler<TSpec, TStatus, TCapabilities>): HandlerRegistration<TSpec, TStatus, TCapabilities>;
}
export type TypeKroAddressedResource<TSpec extends object, TStatus extends object, TOutput extends object> = TOutput & {
  readonly on: TypeKroGroupedResourceEventSources<TSpec, TStatus>;
};
export interface TypeKroScopedListenerResource<TSpec extends object, TStatus extends object> {
  readonly on: TypeKroGroupedResourceEventSources<TSpec, TStatus>;
}
export interface TypeKroAggregateContextResourceEventSources<TCapabilities extends CapabilityClientSet = CapabilityClientSet> {
  reconcile(handler: Handler<object, object, TCapabilities>): readonly HandlerRegistration<object, object, TCapabilities>[];
  reconcile(operator: CallableOperator, handler: Handler<object, object, TCapabilities>): readonly HandlerRegistration<object, object, TCapabilities>[];
  created(handler: Handler<object, object, TCapabilities>): readonly HandlerRegistration<object, object, TCapabilities>[];
  created(operator: CallableOperator, handler: Handler<object, object, TCapabilities>): readonly HandlerRegistration<object, object, TCapabilities>[];
  updated(handler: Handler<object, object, TCapabilities>): readonly HandlerRegistration<object, object, TCapabilities>[];
  updated(operator: CallableOperator, handler: Handler<object, object, TCapabilities>): readonly HandlerRegistration<object, object, TCapabilities>[];
  deleted(handler: Handler<object, object, TCapabilities>): readonly HandlerRegistration<object, object, TCapabilities>[];
  deleted(operator: CallableOperator, handler: Handler<object, object, TCapabilities>): readonly HandlerRegistration<object, object, TCapabilities>[];
  finalize(handler: Handler<object, object, TCapabilities>, options?: FinalizeHandlerOptions): readonly HandlerRegistration<object, object, TCapabilities>[];
  finalize(operator: CallableOperator, handler: Handler<object, object, TCapabilities>, options?: FinalizeHandlerOptions): readonly HandlerRegistration<object, object, TCapabilities>[];
  statusChanged(handler: Handler<object, object, TCapabilities>): readonly HandlerRegistration<object, object, TCapabilities>[];
  statusChanged(operator: CallableOperator, handler: Handler<object, object, TCapabilities>): readonly HandlerRegistration<object, object, TCapabilities>[];
}
export interface TypeKroAggregateResourceEventSources<TCapabilities extends CapabilityClientSet = CapabilityClientSet> {
  readonly context: TypeKroAggregateContextResourceEventSources<TCapabilities>;
  reconcile(handler: ProxyHandler<object, object, TCapabilities>): readonly HandlerRegistration<object, object, TCapabilities>[];
  reconcile(operator: CallableOperator, handler: ProxyHandler<object, object, TCapabilities>): readonly HandlerRegistration<object, object, TCapabilities>[];
  created(handler: ProxyHandler<object, object, TCapabilities>): readonly HandlerRegistration<object, object, TCapabilities>[];
  created(operator: CallableOperator, handler: ProxyHandler<object, object, TCapabilities>): readonly HandlerRegistration<object, object, TCapabilities>[];
  updated(handler: ProxyHandler<object, object, TCapabilities>): readonly HandlerRegistration<object, object, TCapabilities>[];
  updated(operator: CallableOperator, handler: ProxyHandler<object, object, TCapabilities>): readonly HandlerRegistration<object, object, TCapabilities>[];
  deleted(handler: ProxyHandler<object, object, TCapabilities>): readonly HandlerRegistration<object, object, TCapabilities>[];
  deleted(operator: CallableOperator, handler: ProxyHandler<object, object, TCapabilities>): readonly HandlerRegistration<object, object, TCapabilities>[];
  finalize(handler: ProxyHandler<object, object, TCapabilities>, options?: FinalizeHandlerOptions): readonly HandlerRegistration<object, object, TCapabilities>[];
  finalize(operator: CallableOperator, handler: ProxyHandler<object, object, TCapabilities>, options?: FinalizeHandlerOptions): readonly HandlerRegistration<object, object, TCapabilities>[];
  statusChanged(handler: ProxyHandler<object, object, TCapabilities>): readonly HandlerRegistration<object, object, TCapabilities>[];
  statusChanged(operator: CallableOperator, handler: ProxyHandler<object, object, TCapabilities>): readonly HandlerRegistration<object, object, TCapabilities>[];
}
export interface TypeKroAggregateScopedListenerResource<TCapabilities extends CapabilityClientSet = CapabilityClientSet> {
  readonly on: TypeKroAggregateResourceEventSources<TCapabilities>;
}
export interface TypeKroListenerSelector {
  readonly namespace?: string;
  readonly labels?: Readonly<Record<string, string>>;
  readonly labelSelector?: LabelSelector;
  readonly fieldSelector?: string;
}
export type TypeKroListenerResource<
  TSpec extends object = JsonObject,
  TStatus extends object = JsonObject,
  TInput = unknown,
  TOutput extends object = object,
> = ((input: TInput) => TypeKroAddressedResource<TSpec, TStatus, TOutput>) & Omit<ResourceDefinition<TSpec, TStatus>, 'on'> & {
  readonly typeKroSource: TypeKroSourceFactory<TInput, TOutput>;
  instances(resources: readonly TypeKroAddressedResource<TSpec, TStatus, TOutput>[]): TypeKroScopedListenerResource<TSpec, TStatus>;
  where(selector: TypeKroListenerSelector): TypeKroScopedListenerResource<TSpec, TStatus>;
};
export type TypeKroResourceBridgeFunction = <TSpec extends object, TStatus extends object, TInput = unknown, TOutput extends object = object>(
  source: TypeKroSourceFactory<TInput, TOutput>,
  options: TypeKroListenerResourceOptions<TSpec, TStatus>
) => TypeKroListenerResource<TSpec, TStatus, TInput, TOutput>;
export type TypeKroResourcesScopeFunction = (resources: readonly object[]) => TypeKroAggregateScopedListenerResource;
export interface TypeKroListenerCompositionDefinition<TSpec extends KroCompatibleType, TStatus extends KroCompatibleType> {
  readonly name: string;
  readonly apiVersion?: string;
  readonly kind: string;
  readonly group?: string;
  readonly spec: Type<TSpec>;
  readonly status: Type<TStatus>;
}
export type TypeKroKubernetesCompositionFunction = <TSpec extends KroCompatibleType, TStatus extends KroCompatibleType>(
  definition: TypeKroListenerCompositionDefinition<TSpec, TStatus>,
  compositionFn: (spec: TSpec) => MagicAssignableShape<TStatus>,
  options?: SerializationOptions
) => TypeKroListenerComposition<TSpec, TStatus>;

export type TypeKroOperatorInstallBinding<
  TCapabilities extends CapabilityClientSet = CapabilityClientSet,
  TResources extends TypeKroResourceDefinitionMap<TCapabilities> = TypeKroResourceDefinitionMap<TCapabilities>,
> = TypeKroEnhancedResourceMapForResources<TCapabilities, TResources> &
  TypeKroEnhancedResourceAliasMapForResources<TCapabilities, TResources> & {
  readonly installKind: 'applik8sOperatorInstall';
  readonly operatorName: string;
  readonly operator: OperatorDefinition<TCapabilities, TResources>;
  readonly deployment?: OperatorDeploymentOptions;
  readonly crdFactories: TypeKroEnhancedResourceMapForResources<TCapabilities, TResources> &
    TypeKroEnhancedResourceAliasMapForResources<TCapabilities, TResources>;
  readonly status: TypeKroOperatorInstallStatus;
};

export interface TypeKroErasedOperatorInstallBinding {
  readonly installKind: 'applik8sOperatorInstall';
  readonly operatorName: string;
  readonly operator: unknown;
  readonly deployment?: OperatorDeploymentOptions;
  readonly crdFactories: Readonly<Record<string, unknown>>;
  readonly status: TypeKroOperatorInstallStatus;
}

export interface TypeKroCapturedOperatorInstall {
  readonly operatorName: string;
  readonly operator: unknown;
  readonly deployment?: OperatorDeploymentOptions;
  readonly binding: TypeKroErasedOperatorInstallBinding;
}
export interface TypeKroOperatorInstallManifestResultLike { readonly manifest: OperatorManifest; }
export type TypeKroOperatorInstallManifestInput = OperatorManifest | TypeKroOperatorInstallManifestResultLike;
export type TypeKroOperatorInstallManifestSource = readonly TypeKroOperatorInstallManifestInput[] | Readonly<Record<string, TypeKroOperatorInstallManifestInput>>;
export interface TypeKroResolveOperatorInstallsOptions {
  readonly manifests: TypeKroOperatorInstallManifestSource;
  readonly defaultNamespace?: string;
  readonly factoryOptions?: PublicFactoryOptions;
  compositionName?(operatorName: string): string;
}
export type TypeKroGraph<
  TGraphSpec extends KroCompatibleType = TypeKroOperatorInstallSpec,
  TGraphStatus extends KroCompatibleType = TypeKroOperatorInstallStatus,
> = CallableComposition<TGraphSpec, TGraphStatus> | TypedResourceGraph<TGraphSpec, TGraphStatus>;
export type TypeKroOperationTargetSource<
  TGraphSpec extends KroCompatibleType = TypeKroOperatorInstallSpec,
  TGraphStatus extends KroCompatibleType = TypeKroOperatorInstallStatus,
> = TypeKroGraph<TGraphSpec, TGraphStatus> | NestedCompositionResource<TGraphSpec, TGraphStatus>;
export type TypeKroOperationTargetSpec<TGraphSpec extends KroCompatibleType> =
  | TGraphSpec
  | Composable<TGraphSpec>;

export type TypeKroStatusMapper<TGraphStatus extends object, THandlerStatus extends object> = (
  status: PartialStatus<TGraphStatus>
) => PartialStatus<THandlerStatus>;
export type TypeKroGraphAdapterOptions<
  TGraphStatus extends object,
  THandlerStatus extends object = TGraphStatus,
> = {
  readonly fieldManager?: string;
  readonly includeStatus?: boolean;
} & ([THandlerStatus] extends [TGraphStatus]
  ? [TGraphStatus] extends [THandlerStatus]
    ? { readonly statusMapper?: TypeKroStatusMapper<TGraphStatus, THandlerStatus> }
    : { readonly statusMapper: TypeKroStatusMapper<TGraphStatus, THandlerStatus> }
  : { readonly statusMapper: TypeKroStatusMapper<TGraphStatus, THandlerStatus> });
export type TypeKroGraphAdapterOptionsArgument<
  TGraphStatus extends object,
  THandlerStatus extends object = TGraphStatus,
> = [THandlerStatus] extends [TGraphStatus]
  ? [TGraphStatus] extends [THandlerStatus]
    ? [options?: TypeKroGraphAdapterOptions<TGraphStatus, THandlerStatus>]
    : [options: TypeKroGraphAdapterOptions<TGraphStatus, THandlerStatus>]
  : [options: TypeKroGraphAdapterOptions<TGraphStatus, THandlerStatus>];
export type TypeKroGraphAdapter<
  TGraphSpec extends KroCompatibleType = TypeKroOperatorInstallSpec,
  TGraphStatus extends KroCompatibleType = TypeKroOperatorInstallStatus,
  THandlerStatus extends object = TGraphStatus,
> = GraphAdapter<TypeKroGraph<TGraphSpec, TGraphStatus>, THandlerStatus, TGraphSpec>;
export interface UniversalTypeKroGraphAdapter {
  render<TGraphSpec extends KroCompatibleType, TGraphStatus extends KroCompatibleType>(graph: TypeKroGraph<TGraphSpec, TGraphStatus>, spec: TGraphSpec): Result<NormalizedOperationPlan<TGraphStatus>>;
  inferRbac<TGraphSpec extends KroCompatibleType, TGraphStatus extends KroCompatibleType>(graph: TypeKroGraph<TGraphSpec, TGraphStatus>): Result<readonly PermissionRule[]>;
  renderStatus<TGraphSpec extends KroCompatibleType, TGraphStatus extends KroCompatibleType>(graph: TypeKroGraph<TGraphSpec, TGraphStatus>, spec: TGraphSpec): Result<PartialStatus<TGraphStatus>>;
}
export type CreateTypeKroGraphAdapterFunction = <
  TGraphSpec extends KroCompatibleType = TypeKroOperatorInstallSpec,
  TGraphStatus extends KroCompatibleType = TypeKroOperatorInstallStatus,
  THandlerStatus extends object = TGraphStatus,
>(
  ...args: TypeKroGraphAdapterOptionsArgument<TGraphStatus, THandlerStatus>
) => TypeKroGraphAdapter<TGraphSpec, TGraphStatus, THandlerStatus>;
export type TypeKroOperationTargetAdapter<
  TGraphSpec extends KroCompatibleType = TypeKroOperatorInstallSpec,
  TGraphStatus extends KroCompatibleType = TypeKroOperatorInstallStatus,
  THandlerStatus extends object = TGraphStatus,
> = OperationTargetAdapter<TypeKroOperationTarget<TGraphSpec, TGraphStatus, THandlerStatus>, THandlerStatus>;
export interface TypeKroOperationTarget<
  TGraphSpec extends KroCompatibleType = TypeKroOperatorInstallSpec,
  TGraphStatus extends KroCompatibleType = TypeKroOperatorInstallStatus,
  THandlerStatus extends object = TGraphStatus,
> extends OperationTarget<THandlerStatus> {
  readonly operationTargetArtifacts: OperationTargetLoweringArtifacts<THandlerStatus>;
  readonly contract: ApplicationOperationTargetContract;
  readonly source: TypeKroOperationTargetSource<TGraphSpec, TGraphStatus>;
  readonly spec: TypeKroOperationTargetSpec<TGraphSpec>;
  readonly adapter: TypeKroOperationTargetAdapter<TGraphSpec, TGraphStatus, THandlerStatus>;
}
export type InferTypeKroRbacFunction = <
  TGraphSpec extends KroCompatibleType = TypeKroOperatorInstallSpec,
  TGraphStatus extends KroCompatibleType = TypeKroOperatorInstallStatus,
  THandlerStatus extends object = TGraphStatus,
>(
  source: TypeKroOperationTargetSource<TGraphSpec, TGraphStatus> | TypeKroOperationTarget<TGraphSpec, TGraphStatus, THandlerStatus>
) => Result<readonly PermissionRule[]>;
export type TypeKroPermissionsFunction = <
  TGraphSpec extends KroCompatibleType = TypeKroOperatorInstallSpec,
  TGraphStatus extends KroCompatibleType = TypeKroOperatorInstallStatus,
  THandlerStatus extends object = TGraphStatus,
>(
  source: TypeKroOperationTargetSource<TGraphSpec, TGraphStatus> | TypeKroOperationTarget<TGraphSpec, TGraphStatus, THandlerStatus>
) => readonly PermissionRule[];
export type ToTypeKroOperationTargetFunction = <
  TGraphSpec extends KroCompatibleType = TypeKroOperatorInstallSpec,
  TGraphStatus extends KroCompatibleType = TypeKroOperatorInstallStatus,
  THandlerStatus extends object = TGraphStatus,
>(
  source: TypeKroOperationTargetSource<TGraphSpec, TGraphStatus>,
  spec: TypeKroOperationTargetSpec<TGraphSpec>,
  ...args: TypeKroGraphAdapterOptionsArgument<TGraphStatus, THandlerStatus>
) => TypeKroOperationTarget<TGraphSpec, TGraphStatus, THandlerStatus>;
export type TypeKroOperationTargetFactory<
  TGraphSpec extends KroCompatibleType = TypeKroOperatorInstallSpec,
  TGraphStatus extends KroCompatibleType = TypeKroOperatorInstallStatus,
  THandlerStatus extends object = TGraphStatus,
> = (spec: TypeKroOperationTargetSpec<TGraphSpec>) => TypeKroOperationTarget<TGraphSpec, TGraphStatus, THandlerStatus>;
export type AsTypeKroOperationTargetFactoryFunction = <
  TGraphSpec extends KroCompatibleType = TypeKroOperatorInstallSpec,
  TGraphStatus extends KroCompatibleType = TypeKroOperatorInstallStatus,
  THandlerStatus extends object = TGraphStatus,
>(
  graph: TypeKroGraph<TGraphSpec, TGraphStatus>,
  ...args: TypeKroGraphAdapterOptionsArgument<TGraphStatus, THandlerStatus>
) => TypeKroOperationTargetFactory<TGraphSpec, TGraphStatus, THandlerStatus>;

export type TypeKroOperatorInstallSpec = JsonObject & {
  readonly namespace?: string;
  readonly replicas?: number;
  readonly config?: JsonObject;
};

export type TypeKroOperatorInstallStatus = JsonObject & {
  readonly ready: boolean;
  readonly phase: TypeKroInstallPhase;
  readonly message?: string;
  readonly observedBundleDigest?: string;
};

export interface TypeKroAdapterOptions<
  TInstallSpec extends KroCompatibleType = TypeKroOperatorInstallSpec,
  TInstallStatus extends KroCompatibleType = TypeKroOperatorInstallStatus,
> {
  readonly compositionName: string;
  readonly defaultNamespace?: string;
  readonly factoryOptions?: PublicFactoryOptions;
  readonly installSpecDefaults?: Partial<TInstallSpec>;
  readonly installStatusShape?: TInstallStatus;
}

export type TypeKroOperatorComposition<
  TCapabilities extends CapabilityClientSet = CapabilityClientSet,
  TResources extends TypeKroResourceDefinitionMap<TCapabilities> = TypeKroResourceDefinitionMap<TCapabilities>,
  TInstallSpec extends KroCompatibleType = TypeKroOperatorInstallSpec,
  TInstallStatus extends KroCompatibleType = TypeKroOperatorInstallStatus,
> = ((spec: TInstallSpec | Composable<TInstallSpec>) => TypeKroOperatorInstance<
    TCapabilities,
    TResources,
    TInstallSpec,
    TInstallStatus
  >) & CallableComposition<TInstallSpec, TInstallStatus> &
  TypeKroEnhancedResourceMapForResources<TCapabilities, TResources> &
  TypeKroEnhancedResourceAliasMapForResources<TCapabilities, TResources> & {
  readonly operator: OperatorDefinition<TCapabilities, TResources>;
  readonly manifest: OperatorManifest;
  readonly composition: CallableComposition<TInstallSpec, TInstallStatus>;
  readonly graph: TypedResourceGraph<TInstallSpec, TInstallStatus>;
  /** applik8s adapter sugar over TypeKro createResource; graph `.resources` stays TypeKro-native. */
  readonly crdFactories: TypeKroEnhancedResourceMapForResources<TCapabilities, TResources> &
    TypeKroEnhancedResourceAliasMapForResources<TCapabilities, TResources>;
  factory(mode: 'direct', options?: PublicFactoryOptions): DirectResourceFactory<TInstallSpec, TInstallStatus>;
  factory(mode: 'kro', options?: PublicFactoryOptions): KroResourceFactory<TInstallSpec, TInstallStatus>;
  factory(
    mode: TypeKroFactoryMode,
    options?: PublicFactoryOptions
  ): ResourceFactory<TInstallSpec, TInstallStatus>;
};

export type TypeKroListenerComposition<
  TGraphSpec extends KroCompatibleType = TypeKroOperatorInstallSpec,
  TGraphStatus extends KroCompatibleType = TypeKroOperatorInstallStatus,
> = CallableComposition<TGraphSpec, TGraphStatus> & {
  readonly resources: readonly TypeKroCompositionResource[];
  readonly operatorInstalls: readonly TypeKroCapturedOperatorInstall[];
  resolveOperatorInstalls(options: TypeKroResolveOperatorInstallsOptions): Result<TypeKroListenerComposition<TGraphSpec, TGraphStatus>>;
  listenerOperator<TCapabilities extends CapabilityClientSet = CapabilityClientSet>(
    options: TypeKroListenerOperatorOptions<TCapabilities>
  ): CallableOperator<TCapabilities>;
};

export type TypeKroOperatorInstance<
  TCapabilities extends CapabilityClientSet = CapabilityClientSet,
  TResources extends TypeKroResourceDefinitionMap<TCapabilities> = TypeKroResourceDefinitionMap<TCapabilities>,
  TInstallSpec extends KroCompatibleType = TypeKroOperatorInstallSpec,
  TInstallStatus extends KroCompatibleType = TypeKroOperatorInstallStatus,
> = NestedCompositionResource<TInstallSpec, TInstallStatus> &
  TypeKroEnhancedResourceMapForResources<TCapabilities, TResources> &
  TypeKroEnhancedResourceAliasMapForResources<TCapabilities, TResources> & {
    readonly crdFactories: TypeKroEnhancedResourceMapForResources<TCapabilities, TResources> &
      TypeKroEnhancedResourceAliasMapForResources<TCapabilities, TResources>;
  };

/** Preserves applik8s resource ergonomics: `const imageJob = ImageJob(args)`. */
export type TypeKroEnhancedResourceFactory<
  TSpec extends KroCompatibleType = JsonObject,
  TStatus extends KroCompatibleType = JsonObject,
> = (input: TypeKroResourceInput<TSpec>) => Enhanced<TSpec, TStatus> & {
  readonly on: TypeKroGroupedResourceEventSources<TSpec, TStatus>;
};

export interface TypeKroResourceInput<TSpec extends KroCompatibleType = JsonObject> {
  readonly name: string;
  readonly namespace?: string;
  readonly spec: TSpec;
  readonly labels?: Readonly<Record<string, string>>;
  readonly annotations?: Readonly<Record<string, string>>;
}

export type TypeKroEnhancedResourceFactoryForResource<TResource> =
  TResource extends ResourceDefinition<infer TSpec extends KroCompatibleType, infer TStatus extends KroCompatibleType, infer _TCapabilities>
    ? TypeKroEnhancedResourceFactory<TSpec, TStatus>
    : TypeKroEnhancedResourceFactory;

export type TypeKroEnhancedResourceMapForResources<
  TCapabilities extends CapabilityClientSet = CapabilityClientSet,
  TResources extends TypeKroResourceDefinitionMap<TCapabilities> = TypeKroResourceDefinitionMap<TCapabilities>,
> = {
  readonly [K in keyof TResources]: TypeKroEnhancedResourceFactoryForResource<TResources[K]>;
};

export type TypeKroEnhancedResourceAliasMapForResources<
  TCapabilities extends CapabilityClientSet = CapabilityClientSet,
  TResources extends TypeKroResourceDefinitionMap<TCapabilities> = TypeKroResourceDefinitionMap<TCapabilities>,
> = {
  readonly [K in keyof TResources as K extends string
    ? Uncapitalize<K>
    : never]: TypeKroEnhancedResourceFactoryForResource<TResources[K]>;
};

export type AsTypeKroCompositionFunction = <
  TCapabilities extends CapabilityClientSet = CapabilityClientSet,
  TResources extends TypeKroResourceDefinitionMap<TCapabilities> = TypeKroResourceDefinitionMap<TCapabilities>,
  TInstallSpec extends KroCompatibleType = TypeKroOperatorInstallSpec,
  TInstallStatus extends KroCompatibleType = TypeKroOperatorInstallStatus,
>(
  operator: OperatorDefinition<TCapabilities, TResources>,
  manifest: OperatorManifest,
  options: TypeKroAdapterOptions<TInstallSpec, TInstallStatus>
) => Result<TypeKroOperatorComposition<TCapabilities, TResources, TInstallSpec, TInstallStatus>>;

export type ResolveTypeKroOperatorInstallsFunction = <
  TGraphSpec extends KroCompatibleType = TypeKroOperatorInstallSpec,
  TGraphStatus extends KroCompatibleType = TypeKroOperatorInstallStatus,
>(
  composition: TypeKroListenerComposition<TGraphSpec, TGraphStatus>,
  options: TypeKroResolveOperatorInstallsOptions
) => Result<TypeKroListenerComposition<TGraphSpec, TGraphStatus>>;

export interface TypeKroAdapterTestExpectation<
  TSpec extends KroCompatibleType = KroCompatibleType,
  TStatus extends KroCompatibleType = KroCompatibleType,
  TResourceSpec extends KroCompatibleType = KroCompatibleType,
  TResourceStatus extends KroCompatibleType = KroCompatibleType,
> { readonly composition?: CallableComposition<TSpec, TStatus>; readonly graph?: TypedResourceGraph<TSpec, TStatus>; readonly enhancedResources?: readonly Enhanced<TResourceSpec, TResourceStatus>[]; readonly factoryModes?: readonly TypeKroFactoryMode[]; }
export interface TypeKroAdapterTestHarness { expectTypeKroIntegration<TSpec extends KroCompatibleType, TStatus extends KroCompatibleType, TResourceSpec extends KroCompatibleType, TResourceStatus extends KroCompatibleType>(expectation: TypeKroAdapterTestExpectation<TSpec, TStatus, TResourceSpec, TResourceStatus>): TypeKroAdapterTestHarness; }
export interface Applik8sTypeKroAdapterApi {
  /** Creates a TypeKro factory/resource bridge with an applik8s-compatible `.on.*` event surface. */
  readonly resource: TypeKroResourceBridgeFunction;
  /** Scopes one listener registration across a finite set of TypeKro resource instances. */
  readonly resources: TypeKroResourcesScopeFunction;
  /** Wraps TypeKro's `kubernetesComposition` so `.on.*` listeners default-group by composition. */
  readonly kubernetesComposition: TypeKroKubernetesCompositionFunction;
  /** Replays a wrapped TypeKro composition and lowers captured direct operator calls using compiled applik8s manifests. */
  readonly resolveOperatorInstalls: ResolveTypeKroOperatorInstallsFunction;
  /** Builds an applik8s operator from listeners captured by `typeKro.kubernetesComposition(...)`. */
  readonly listenerOperator: <TCapabilities extends CapabilityClientSet = CapabilityClientSet>(
    composition: TypeKroListenerComposition<KroCompatibleType, KroCompatibleType>,
    options: TypeKroListenerOperatorOptions<TCapabilities>
  ) => CallableOperator<TCapabilities>;
  /** Ergonomic alias for turning an applik8s operator bundle into a callable TypeKro install composition. */
  readonly composition: AsTypeKroCompositionFunction;
  readonly asComposition: AsTypeKroCompositionFunction;
  /** Ergonomic alias for creating a reusable TypeKro graph renderer for applik8s handlers. */
  readonly graphAdapter: CreateTypeKroGraphAdapterFunction;
  readonly typeKroAdapter: UniversalTypeKroGraphAdapter;
  readonly createGraphAdapter: CreateTypeKroGraphAdapterFunction;
  /** Infers Kubernetes RBAC rules for TypeKro graphs/compositions/operation targets. */
  readonly inferRbac: InferTypeKroRbacFunction;
  /** Returns Kubernetes RBAC rules for `sdk.operator({ permissions })`, throwing if the TypeKro source cannot be inspected. */
  readonly permissions: TypeKroPermissionsFunction;
  /** Ergonomic alias for wrapping a TypeKro graph/resource as an applik8s operation target. */
  readonly operationTarget: ToTypeKroOperationTargetFunction;
  readonly toOperationTarget: ToTypeKroOperationTargetFunction;
  /** Ergonomic alias for creating functions whose return values can be passed directly to `ctx.apply()` or proxy `resource.apply()`. */
  readonly targetFactory: AsTypeKroOperationTargetFactoryFunction;
  readonly asOperationTargetFactory: AsTypeKroOperationTargetFactoryFunction;
}
