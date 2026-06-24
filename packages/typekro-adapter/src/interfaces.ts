import type {
  CallableComposition,
  Composable,
  DirectResourceFactory,
  Enhanced,
  KroResourceFactory,
  KroCompatibleType,
  NestedCompositionResource,
  PublicFactoryOptions,
  ResourceFactory,
  TypedResourceGraph,
} from 'typekro';

import type {
  AnyResourceDefinition,
  CapabilityClientSet,
  GraphAdapter,
  JsonObject,
  NormalizedOperationPlan,
  OperationTarget,
  OperationTargetAdapter,
  OperatorDefinition,
  OperatorManifest,
  PartialStatus,
  PermissionRule,
  ResourceDefinition,
  Result,
} from '@applik8s/core';

export type TypeKroFactoryMode = 'direct' | 'kro';
export type TypeKroInstallPhase = 'Pending' | 'Installing' | 'Ready' | 'Failed';
export type TypeKroResourceDefinitionMap<TCapabilities extends CapabilityClientSet = CapabilityClientSet> = Readonly<
  Record<string, AnyResourceDefinition<TCapabilities>>
>;
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
  readonly source: TypeKroOperationTargetSource<TGraphSpec, TGraphStatus>;
  readonly spec: TypeKroOperationTargetSpec<TGraphSpec>;
  readonly adapter: TypeKroOperationTargetAdapter<TGraphSpec, TGraphStatus, THandlerStatus>;
}
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
> = (input: TypeKroResourceInput<TSpec>) => Enhanced<TSpec, TStatus>;

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

export interface TypeKroAdapterTestExpectation<
  TSpec extends KroCompatibleType = KroCompatibleType,
  TStatus extends KroCompatibleType = KroCompatibleType,
  TResourceSpec extends KroCompatibleType = KroCompatibleType,
  TResourceStatus extends KroCompatibleType = KroCompatibleType,
> { readonly composition?: CallableComposition<TSpec, TStatus>; readonly graph?: TypedResourceGraph<TSpec, TStatus>; readonly enhancedResources?: readonly Enhanced<TResourceSpec, TResourceStatus>[]; readonly factoryModes?: readonly TypeKroFactoryMode[]; }
export interface TypeKroAdapterTestHarness { expectTypeKroIntegration<TSpec extends KroCompatibleType, TStatus extends KroCompatibleType, TResourceSpec extends KroCompatibleType, TResourceStatus extends KroCompatibleType>(expectation: TypeKroAdapterTestExpectation<TSpec, TStatus, TResourceSpec, TResourceStatus>): TypeKroAdapterTestHarness; }
export interface Applik8sTypeKroAdapterApi {
  /** Ergonomic alias for turning an applik8s operator bundle into a callable TypeKro install composition. */
  readonly composition: AsTypeKroCompositionFunction;
  readonly asComposition: AsTypeKroCompositionFunction;
  /** Ergonomic alias for creating a reusable TypeKro graph renderer for applik8s handlers. */
  readonly graphAdapter: CreateTypeKroGraphAdapterFunction;
  readonly typeKroAdapter: UniversalTypeKroGraphAdapter;
  readonly createGraphAdapter: CreateTypeKroGraphAdapterFunction;
  /** Ergonomic alias for wrapping a TypeKro graph/resource as an applik8s operation target. */
  readonly operationTarget: ToTypeKroOperationTargetFunction;
  readonly toOperationTarget: ToTypeKroOperationTargetFunction;
  /** Ergonomic alias for creating functions whose return values can be passed directly to `ctx.apply()` or proxy `resource.apply()`. */
  readonly targetFactory: AsTypeKroOperationTargetFactoryFunction;
  readonly asOperationTargetFactory: AsTypeKroOperationTargetFactoryFunction;
}
