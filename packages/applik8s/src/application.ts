// typecast-file-boundary: the application builder joins ArkType, Drizzle, TypeKro, and graph registries whose runtime identities preserve generics erased by TypeScript.
import type { AnyResourceDefinition, ApplicationGeneratedResourceContract, ApplicationGraph, ApplicationObservabilityContract, ApplicationOperationAuthorityGraphContract, ApplicationProfileProviderSelectionContract, ApplicationProviderInterfaceKind, HandlerRegistration, JsonObject, JsonValue, NormalizedOperationPlan, OperationTarget, OperatorDeploymentOptions, PermissionRule, PlanTargetOptions, ResourceDefinition, ResourceIndex, ResourceObject, Result } from '@applik8s/core';
import type { ApplicationOperation } from '@applik8s/client';
import { applicationGraphMetadataProperty, applicationInstallationMetadataProperty, applicationTypeKroDefinitionProperty, normalizeApplicationGraph } from '@applik8s/core';
import type { CrdOptions, SchemaInput } from '@applik8s/sdk';
import { sdk as baseSdk, normalizeSchema, setOperatorDeploymentInterceptor } from '@applik8s/sdk';
import type { TypeKroListenerComposition, TypeKroListenerCompositionDefinition } from '@applik8s/typekro-adapter';
import { typeKro } from '@applik8s/typekro-adapter';
import { type as arkType, type Type } from 'arktype';
import { getTableName, isTable } from 'drizzle-orm';
import type { AnyPgTable } from 'drizzle-orm/pg-core';
import type { Composable, Enhanced, KroCompatibleType, KubernetesResource, MagicAssignableShape, SerializationOptions } from 'typekro';
import { Cel, externalRef } from 'typekro';
import { cluster as typeKroCnpgCluster, scheduledBackup as typeKroCnpgScheduledBackup } from 'typekro/cnpg';
import { configMap as typeKroConfigMap, deployment as typeKroDeployment, role as typeKroRole, roleBinding as typeKroRoleBinding, service as typeKroService, serviceAccount as typeKroServiceAccount } from 'typekro/kubernetes';
import { valkey as typeKroValkey } from 'typekro/valkey';
import { recordApplicationCrdGraph } from './application-crd-graph.js';
import {
  applicationAuthorityRegistrar,
  type ApplicationAuthorityGraphState,
  type ApplicationAuthorityRegistrar,
} from './application-authority.js';
import { type ApplicationReconcileHandler, type ApplicationReconcileOptions, type ApplicationResourceControllerBinding, type ApplicationResourceEventHandlers, createApplicationResourceEventOperator } from './application-events.js';
import { type ApplicationGeneratedJobResourceState, type ApplicationJobBinding, type ApplicationJobOptions, type ApplicationScheduleOptions, emitApplicationGeneratedJob, emitApplicationModelMigrationResources } from './application-generated-job-resources.js';
import type { ApplicationServerRuntimeIndex } from './application-generated-runtime-sources.js';
import { generatedApplicationAggregateSource, generatedValkeyIndexerSource } from './application-generated-runtime-sources.js';
import { type ApplicationGraphState, addApplicationGraphEdge, addApplicationGraphNode, applicationGraphFromState, isApplicationGraph } from './application-graph-state.js';
import { apiGroupForApiVersion, applicationProviderGraphNodeId, graphResourceId, kubernetesNameSegment, pascalCase, pluralizeKubernetesKind, unique } from './application-identifiers.js';
import {
  emitApplicationConfig,
  emitApplicationExposure,
  emitApplicationSecret,
  emitProvidedApplicationIndexStore,
  recordApplicationProviderGraph,
  recordApplicationTypeKroResourceGraph,
} from './application-infrastructure-resources.js';
import { type ApplicationInstallationClient, type ApplicationInstallationConnectOptions, createApplicationInstallationClient } from './application-installation-client.js';
import type { ApplicationModelBinding, ApplicationModelOptions, ApplicationModelRuntimeBinding, ApplicationModelSchemaIndexOptions, ApplicationRuntimeModelContract } from './application-models.js';
import { applicationModelBinding, applicationRuntimeModelContract, prepareApplicationModelCommandReplacement, recordApplicationAnalyticalNativeModelGraph, recordApplicationModelCommandGraph, recordApplicationModelGraph, recordApplicationNativeModelGraph, resolveApplicationTransactionalDatabase } from './application-models.js';
import {
  applicationNativeCommandModelBinding,
  applicationNativeCreateContracts,
  applicationNativeDeleteContracts,
  applicationNativeRuntimeModelContract,
  applicationNativeUpdateContracts,
  bindApplicationNativeCreateOperation,
  bindApplicationNativeDeleteOperation,
  bindApplicationNativeUpdateOperation,
  registerApplicationNativeActionProcessor,
  registerApplicationNativeCreateProcessor,
  registerApplicationNativeDeleteProcessor,
  registerApplicationNativeUpdateProcessor,
  resolveApplicationDatabase,
  validateNativeModelAccess,
} from './application-native-model-wiring.js';
import { type ApplicationObjectStoreBinding, type ApplicationObjectStoreOptions, registerApplicationObjectStore } from './application-object-storage.js';
import { applicationOperatorWatchScopeContracts } from './application-operator-watches.js';
import type { ApplicationProcessorOptions } from './application-processor-policy.js';
import { emitApplicationAnalyticalDatabaseResources } from './application-analytical-database-resources.js';
import type { ApplicationAnalyticalDatabaseProvider, ApplicationDefaults, ApplicationDefaultsBinding, ApplicationHostBinding, ApplicationHostProvider, ApplicationHttpExposureProvider, ApplicationIndexBackend, ApplicationTransactionalDatabaseProvider, ApplicationPostgresTransactionalDatabaseOptions, ApplicationProviderBinding, ApplicationProviderState, ApplicationProviderToken, ApplicationQualifiedProviderToken, ApplicationSearchProvider, ApplicationValkeyIndexBackend } from './application-providers.js';
import { ApplicationHost, applicationCertificateImplementation, applicationDnsPublicationImplementation, applicationHostBinding, applicationHttpExposureImplementation, applicationTransactionalDatabaseImplementation, applicationPostgresClusterSpec, applicationAnalyticalDatabaseImplementation, applicationProviderQualificationFor, applicationProviderSelectionFor, applicationProviderSelectionSatisfies, applicationProviderTokenName, applicationSearchProviderImplementation, applyApplicationProvider, defaultApplicationEventLogProvider, defaultApplicationIndexBackend, defaultApplicationIndexProvider, defaultApplicationProviders, IndexStore, isApplicationProviderSelection, isApplicationQualifiedProviderToken, isApplicationSearchProvider, isValkeyIndexDefault, TransactionalDatabase } from './application-providers.js';
import { type ApplicationQueryBinding, type ApplicationQueryOptions, type ApplicationQueryPrincipal, type ApplicationQuerySourceBinding, registerApplicationModelView, registerApplicationQuery } from './application-queries.js';
import {
  applicationSearchIndexRegistrar,
  bindApplicationSearchModel,
  createApplicationSearchRegistrar,
  type ApplicationSearchDocument,
  type ApplicationSearchField,
  type ApplicationSearchIndexBinding,
  type ApplicationSearchIndexOptions,
  type ApplicationSearchIndexRegistrar,
  type ApplicationSearchRootOptions,
} from './application-search.js';
import { type ApplicationAnalyticalProjectionBinding, type ApplicationAnalyticalProjectionOptions, type ApplicationGatewayBinding, type ApplicationGatewayOptions, type ApplicationOnlineProjectionBinding, type ApplicationOnlineProjectionOptions, type ApplicationProjectionOptions, type ApplicationStreamBinding, type ApplicationStreamOptions, type ApplicationSubscriptionBinding, type ApplicationSubscriptionOptions, registerApplicationGateway, registerApplicationProjection, registerApplicationStream, registerApplicationStreamProcessor, registerApplicationSubscription } from './application-reactive.js';
import {
  type ApplicationProfile,
  type ApplicationProfileVariant,
  type ApplicationQualifiedProviderBinding,
  applicationProfileVariantsFromSchema,
  createApplicationProfileRuntime,
} from './application-profiles.js';
import type { ApplicationRouteSourceLocation, ApplicationServerRouteSourceAnalysis, SerializedApplicationServerRouteWithDependencies } from './application-route-source.js';
import { analyzeApplicationServerRouteSource, normalizeSerializableFunctionSource, routeAnalysisCallsMethod, serializedCallbackClosureMessage, unsupportedRouteFreeIdentifiers } from './application-route-source.js';
import { generatedApplicationRuntimeModuleBundle } from './application-runtime-modules.js';
import { bundleGeneratedApplicationServerSourceBundle, generatedApplicationServerBindingsSource, generatedApplicationServerHonoEntrypointSource, generatedApplicationServerRouteModuleSource, generatedApplicationServerRouteModules, generatedApplicationServerRoutesSource, kroSafeJavaScriptSourceBundle, mountedConfigMapSourceBundle, routeManifestEntry } from './application-server-bundle.js';
import { applicationRuntimeResource, assertDistinctRuntimeBindingNames, assertRuntimeBindingNames, createRouteRecorder, inferApplicationServerPermissions, mergeApplicationKubernetesRbacRules, transactionalDatabaseEnvironmentVariables, type SerializedApplicationServerCaptures, serializeApplicationServerCaptures, serializeApplicationServerRoutes, serializedApplicationServerCaptureAliases } from './application-server-routing.js';
import { generatedApplicationServerRuntimeSource, runtimeIndexTable } from './application-server-runtime.js';
import type { ApplicationGeneratedJobStatusProjectionState, ApplicationStatusReconcilerAppResourceTarget } from './application-status-reconciler.js';
import { emitApplicationGeneratedJobStatusReconcilers } from './application-status-reconciler.js';
import { applicationTypeKroExpressionValue, applicationTypeKroString, applicationTypeKroValueIdentity, applyApplicationTypeKroIncludeWhen } from './application-typekro-values.js';
import type { ApplicationTaskBinding, ApplicationTaskHandler, ApplicationTaskObjectStores, ApplicationTaskOperations, ApplicationTaskOptions, ApplicationTaskProjections, ApplicationTaskQueries, ApplicationTaskReference, ApplicationWorkflowBinding, ApplicationWorkflowHandler, ApplicationWorkflowOptions, ApplicationWorkflowReference } from './application-workflows.js';
import { type ApplicationWorkflowState, registerApplicationTask, registerApplicationWorkflow } from './application-workflows.js';
import type { EntityDefinition, EventDefinition, StreamDefinition, TaskDefinition, WorkflowDefinition } from './dsl.js';
import { type ApplicationKubernetesCreatePolicy, applicationModelViewRegistrar, bindApplicationModelViews, bindNativeApplicationModelActionEvents, bindNativeApplicationModelBeforeCommit, bindNativeApplicationModelBinding, bindNativeApplicationModelCommands, bindNativeApplicationModelLifecycle, bindNativeKubernetesLifecycle, type DrizzleAnalyticalApplicationModelFacet, getApplicationModelFacet, getRequiredDrizzleApplicationModelFacet, nativeApplicationModelActionEventRegistrar, nativeApplicationModelBeforeCommitRegistrar, nativeApplicationModelCommandRegistrar, nativeApplicationModelLifecycleRegistrar, nativeKubernetesLifecycleRegistrar, type PromoteAnalyticalDrizzleTableOptions, type PromoteDrizzleTableOptions, type PromotedAnalyticalDrizzleTable, type PromotedDrizzleTable, type PromotedKubernetesResource, promoteAnalyticalDrizzleTable, promoteDrizzleTable, promoteKubernetesResource } from './native-models.js';
import type { ApplicationPostgresRlsPolicy } from './trusted-context.js';

export type { ApplicationFinalizeEventHandler, ApplicationReconcileHandler, ApplicationReconcileOptions, ApplicationResourceControllerBinding, ApplicationResourceEventHandlers, ApplicationResourceObject } from './application-events.js';
export type { ApplicationAuthorityRegistrar, ApplicationAuthoritySelection, ApplicationOutcomeBinding, ApplicationOutcomeOptions, ApplicationPermissionBinding, ApplicationServiceIdentityBinding } from './application-authority.js';
export type { ApplicationJobBinding, ApplicationJobOptions, ApplicationScheduleOptions } from './application-generated-job-resources.js';
export type { ApplicationInstallationClient, ApplicationInstallationConnectOptions, ApplicationInstallationReference, ApplicationInstallationTransport, ApplicationInstallationWatchOptions } from './application-installation-client.js';
export type { ApplicationCommandDomainError, ApplicationCommandKey, ApplicationCommandSubmissionAcknowledgement, ApplicationModelBackendContract, ApplicationModelBinding, ApplicationModelCommandBinding, ApplicationModelCommandContext, ApplicationModelCommandDeliveryOptions, ApplicationModelCommandHandler, ApplicationModelCommandOptions, ApplicationModelCommandParticipantClient, ApplicationModelCommandTarget, ApplicationModelConstraintOptions, ApplicationModelCreateInput, ApplicationModelEventBinding, ApplicationModelEventHandler, ApplicationModelEventRegistrar, ApplicationModelIndexBinding, ApplicationModelIndexOptions, ApplicationModelObject, ApplicationModelOptions, ApplicationModelPatch, ApplicationModelQueryOptions, ApplicationModelQueryPage, ApplicationModelRef, ApplicationModelRuntimeBinding, ApplicationModelSchemaIndexOptions, ApplicationModelSchemaOptions, ApplicationRuntimeModelContract } from './application-models.js';
export type { ApplicationObjectMetadata, ApplicationObjectPutRequest, ApplicationObjectReference, ApplicationObjectStorageRuntime, ApplicationObjectStoreBinding, ApplicationObjectStoreOptions, ApplicationSignedObjectIntent } from './application-object-storage.js';
export type { ApplicationProcessorOptions } from './application-processor-policy.js';
export type { ApplicationProfile, ApplicationProfileBranchOptions, ApplicationProfileVariant, ApplicationProfileVariantOverride, ApplicationQualifiedProviderBinding } from './application-profiles.js';
export type { ApplicationAnalyticalDatabaseProvider, ApplicationAnalyticalDatabaseProviderToken, ApplicationAnalyticsConstructors, ApplicationAuthorizationDecision, ApplicationAuthorizationProvider, ApplicationAuthorizationProviderToken, ApplicationAuthorizationRequest, ApplicationCertificateProvider, ApplicationCertificateProviderToken, ApplicationCertManagerCertificateProvider, ApplicationClickHouseAnalyticalDatabaseProvider, ApplicationContainerRegistryCredentialSecret, ApplicationContainerRegistryEndpoint, ApplicationContainerRegistryProvider, ApplicationContainerRegistryProviderToken, ApplicationContainerRegistrySecretRef, ApplicationContainerRegistryTls, ApplicationCounterStoreProvider, ApplicationCredentialStoreProvider, ApplicationDatabaseConstructors, ApplicationDefaults, ApplicationDefaultsBinding, ApplicationDnsPublicationProvider, ApplicationDnsPublicationProviderToken, ApplicationEventLogProvider, ApplicationEventSourceProvider, ApplicationExternalClickHouseConnection, ApplicationExternalClickHouseOptions, ApplicationExternalDnsPublicationProvider, ApplicationExternalPostgresDatabaseOptions, ApplicationGeneratedTransactionalDatabaseMigrationJobOptions, ApplicationHarborContainerRegistryOptions, ApplicationHarborContainerRegistryProvider, ApplicationHarborProjectManagement, ApplicationHatchetWorkflowEngineProvider, ApplicationHostBinding, ApplicationHostProvider, ApplicationHostProviderToken, ApplicationHttpExposureProvider, ApplicationHttpExposureProviderToken, ApplicationIdentityInfrastructure, ApplicationIndexBackend, ApplicationIndexStoreProviderToken, ApplicationIngressHttpExposureProvider, ApplicationKubernetesConfigMapObjectStorageProvider, ApplicationKubernetesConfigMapQueueProvider, ApplicationKubernetesCredentialStoreProvider, ApplicationKubernetesHostProvider, ApplicationKubernetesResourceCounterStoreProvider, ApplicationKubernetesSecretProvider, ApplicationKubernetesWatchEventSourceProvider, ApplicationTransactionalDatabaseMigrationPolicy, ApplicationTransactionalDatabaseProvider, ApplicationTransactionalDatabaseProviderToken, ApplicationNatsJetStreamEventLogProvider, ApplicationNodePortHttpExposureProvider, ApplicationObjectStorageProvider, ApplicationOciContainerRegistryProvider, ApplicationOrbstackContainerRegistryProvider, ApplicationPostgresAnalyticalDatabaseProvider, ApplicationPostgresBackupPolicy, ApplicationPostgresClusterSpec, ApplicationPostgresTransactionalDatabaseOptions, ApplicationPostgresTransactionalDatabaseProvider, ApplicationPostgresReadinessPolicy, ApplicationProviderBinding, ApplicationProviderQualification, ApplicationProviderToken, ApplicationQualifiedProviderToken, ApplicationQualifiableProviderToken, ApplicationQueueProvider, ApplicationRequestAdmission, ApplicationRequestIdentityProvider, ApplicationRequestIdentityProviderToken, ApplicationSecretProvider, ApplicationStructuredGenerationDeterministicProvider, ApplicationStructuredGenerationHttpProvider, ApplicationStructuredGenerationProvider, ApplicationStructuredGenerationProviderToken, ApplicationTypedProviderContract, ApplicationValkeyIndexBackend, ApplicationWorkflowEngineProvider, ApplicationWorkflowEngineProviderToken } from './application-providers.js';
export { AnalyticalDatabase, Analytics, ApplicationHost, Authorization, Certificate, ContainerRegistry, CounterStore, CredentialStore, Database, DnsPublication, defaultApplicationEventLogProvider, defaultApplicationProviders, defaultApplicationWorkflowEngineProvider, defineApplicationProvider, EventLog, EventSource, HttpExposure, IndexStore, ObjectStorage, providers, Queue, RequestIdentity, Search, Secret, StructuredGeneration, TransactionalDatabase, WorkflowEngine } from './application-providers.js';
export type { ApplicationOpenSearchProvider, ApplicationPostgresSearchProvider, ApplicationSearchCapability, ApplicationSearchProvider, ApplicationSearchProviderToken } from './application-providers.js';
export type { ApplicationSearchComparison, ApplicationSearchDocument, ApplicationSearchFacetBucket, ApplicationSearchField, ApplicationSearchFieldHandle, ApplicationSearchHit, ApplicationSearchIndexBinding, ApplicationSearchIndexOptions, ApplicationSearchPath, ApplicationSearchRequest, ApplicationSearchResult, ApplicationSearchRootOptions, ApplicationSearchSort, ApplicationSearchSource, ApplicationUnaliasedSearchField } from './application-search.js';
export { search } from './application-search.js';
export type { ApplicationKubernetesModelViewOptions, ApplicationModelViewOptions, ApplicationOnlineProjectionQueryBinding, ApplicationOnlineQueryRuntimeSource, ApplicationOnlineQuerySource, ApplicationQueryAuthorizationRequest, ApplicationQuerySourceBinding } from './application-queries.js';
export type { ApplicationAnalyticalProjectionBinding, ApplicationAnalyticalProjectionOptions, ApplicationGatewayAdmission, ApplicationGatewayBinding, ApplicationGatewayOptions, ApplicationOnlineProjectionBinding, ApplicationOnlineProjectionOptions, ApplicationProjectionBinding, ApplicationProjectionOptions, ApplicationStreamBinding, ApplicationStreamOptions, ApplicationStreamProcessContext, ApplicationStreamProcessHandler, ApplicationStreamProcessOptions, ApplicationStreamProcessorBinding, ApplicationStreamScheduleFunctions, ApplicationStreamScheduleTargets, ApplicationStreamTaskFunctions, ApplicationStreamTaskTargets, ApplicationSubscriptionBinding, ApplicationSubscriptionOptions } from './application-reactive.js';
export type { ApplicationDurableErrorDescriptor, ApplicationDurableErrorUnion, ApplicationTaskBinding, ApplicationTaskContext, ApplicationTaskHandler, ApplicationTaskObjectFunctions, ApplicationTaskObjectStores, ApplicationTaskOperationFunctions, ApplicationTaskOperations, ApplicationTaskOptions, ApplicationTaskProjectionFunctions, ApplicationTaskProjections, ApplicationTaskProjectionTarget, ApplicationTaskQueries, ApplicationTaskQueryFunctions, ApplicationTaskReference, ApplicationTaskServicePrincipal, ApplicationWorkflowBinding, ApplicationWorkflowContext, ApplicationWorkflowHandler, ApplicationWorkflowOptions, ApplicationWorkflowReference, ApplicationWorkflowResultOptions, ApplicationWorkflowWorkerOptions } from './application-workflows.js';
export { ApplicationDurableError, isApplicationDurableError } from './application-workflows.js';
export type { ApplicationKubernetesCreatePlacement, ApplicationKubernetesCreatePolicy, ApplicationKubernetesCreateRequest, ApplicationModelActionCompletedEvent, ApplicationModelActionCompletedRegistrar, ApplicationModelBeforeCommitHandler, ApplicationModelBeforeCommitOptions, ApplicationModelCreateEvent, ApplicationModelCreateEventHandler, ApplicationModelDeleteEvent, ApplicationModelDeleteEventHandler, ApplicationModelDeleteInput, ApplicationModelLifecycleRegistrar, ApplicationModelMutationOperation, ApplicationModelUpdateEvent, ApplicationModelUpdateEventHandler, ApplicationModelUpdateInput, DrizzleAnalyticalApplicationModelFacet, PromotedAnalyticalDrizzleTable } from './native-models.js';

export interface ApplicationInfrastructureOptions {
  /** Stable graph identity for a nested composition instance. */
  readonly name?: string;
}

export interface KubernetesApplicationScope extends ApplicationAuthorityRegistrar {
  readonly api: ApplicationServerRegistrar & Record<string, ApplicationServerBinding>;
  readonly http: ApplicationServerRegistrar & Record<string, ApplicationServerBinding>;
  readonly server: ApplicationServerRegistrar & Record<string, ApplicationServerBinding>;
  readonly storage: ApplicationStorageRegistrar;
  readonly database: ApplicationDatabaseRegistrar;
  operator<TBinding>(operator: (options: OperatorDeploymentOptions) => TBinding, options: OperatorDeploymentOptions): TBinding;
  resource<TSpec extends object, TStatus extends object = Record<string, never>>(name: string, options: ApplicationResourceOptions<TSpec, TStatus>): ResourceDefinition<TSpec, TStatus>;
  crd<TSpec extends object, TStatus extends object = Record<string, never>>(entity: EntityDefinition<TSpec, TStatus>, options: ApplicationCrdOptions<TSpec, TStatus>): PromotedKubernetesResource<TSpec, TStatus>;
  model<TSpec extends object, TStatus extends object = Record<string, never>>(name: string, options: ApplicationNamedModelOptions<TSpec, TStatus>): ApplicationModelBinding<TSpec, TStatus>;
  model<TSpec extends object, TStatus extends object = Record<string, never>>(entity: EntityDefinition<TSpec, TStatus>, options?: ApplicationModelOptions<TSpec, TStatus>): ApplicationModelBinding<TSpec, TStatus>;
  model<TTable extends AnyPgTable>(table: TTable, options: ApplicationNativeAnalyticalDrizzleModelOptions<TTable>): PromotedAnalyticalDrizzleTable<TTable>;
  model<TTable extends AnyPgTable>(table: TTable, options?: ApplicationNativeDrizzleModelOptions<TTable>): PromotedDrizzleTable<TTable>;
  index<const TFields extends readonly ApplicationSearchField[]>(
    name: string,
    options: ApplicationSearchRootOptions,
    ...fields: TFields
  ): ApplicationSearchIndexBinding<ApplicationSearchDocument<TFields>>;
  query<TInput, TOutput, TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal, TSource extends ApplicationQuerySourceBinding | undefined = undefined>(id: string, options: ApplicationQueryOptions<TInput, TOutput, TPrincipal, TSource>): ApplicationQueryBinding<TInput, TOutput, TPrincipal, TSource>;
  stream<TPayload extends object, TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal>(definition: StreamDefinition<TPayload> | EventDefinition<TPayload>, options: ApplicationStreamOptions<TPayload, TPrincipal>): ApplicationStreamBinding<TPayload, TPrincipal>;
  subscription<TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal>(name: string, options: ApplicationSubscriptionOptions<TPrincipal>): ApplicationSubscriptionBinding<TPrincipal>;
  projection<TPayload extends object, TRow extends object>(name: string, options: ApplicationAnalyticalProjectionOptions<TPayload, TRow>): ApplicationAnalyticalProjectionBinding<TPayload, TRow>;
  projection<TPayload extends object, TRow extends object, TValue extends object, TSnapshot extends object = object>(name: string, options: ApplicationOnlineProjectionOptions<TPayload, TRow, TValue, TSnapshot>): ApplicationOnlineProjectionBinding<TPayload, TRow, TValue>;
  objectStore(name: string, options: ApplicationObjectStoreOptions): ApplicationObjectStoreBinding;
  install<TSpec extends KroCompatibleType, TStatus extends KroCompatibleType>(
    application: KubernetesApplicationBuilder<TSpec, TStatus>,
    options: ApplicationInstallOptions<TSpec>,
  ): ApplicationInstallBinding<TSpec, TStatus>;
  gateway(name: string, options: ApplicationGatewayOptions): ApplicationGatewayBinding;
  on<TSpec extends object, TStatus extends object = Record<string, never>>(resource: ResourceDefinition<TSpec, TStatus>, handlers: ApplicationResourceEventHandlers<TSpec, TStatus>, options?: ApplicationReconcileOptions): ApplicationResourceControllerBinding;
  reconcile<TSpec extends object, TStatus extends object = Record<string, never>>(resource: ResourceDefinition<TSpec, TStatus>, handler: ApplicationReconcileHandler<TSpec, TStatus>, options?: ApplicationReconcileOptions): ApplicationResourceControllerBinding;
  /** Builder-safe infrastructure factory. Use the callback form so TypeKro resources are recreated inside graph materialization. */
  infra<TResource extends object>(resource: TResource | (() => TResource), options?: ApplicationInfrastructureOptions): TResource;
  config(name: string, options: ApplicationConfigOptions): ApplicationConfigBinding;
  secret(name: string, options: ApplicationSecretOptions): ApplicationSecretBinding;
  expose(name: string, options: ApplicationExposureOptions): ApplicationExposureBinding;
  job(name: string, options?: ApplicationJobOptions): ApplicationJobBinding;
  schedule(name: string, options?: ApplicationScheduleOptions): ApplicationJobBinding;
  defaults(defaults: ApplicationDefaults): ApplicationDefaultsBinding;
  provide<TImplementation>(token: ApplicationProviderToken<TImplementation>, implementation: TImplementation): ApplicationProviderBinding<TImplementation>;
  aggregate<TStats extends object, TEvent extends object>(name: string, options: ApplicationAggregateOptions<TStats, TEvent>): ApplicationAggregateBinding<TStats, TEvent>;
  task<TInput extends object, TOutput extends object, TErrors extends Readonly<Record<string, object>>, TOperations extends ApplicationTaskOperations = Readonly<Record<never, never>>, TQueries extends ApplicationTaskQueries = Readonly<Record<never, never>>, TProjections extends ApplicationTaskProjections = Readonly<Record<never, never>>, TObjects extends ApplicationTaskObjectStores = Readonly<Record<never, never>>>(definition: TaskDefinition<TInput, TOutput, TErrors>, options: ApplicationTaskOptions<TInput, TOperations, TQueries, TProjections, TObjects>, handler: ApplicationTaskHandler<TInput, TOutput, TErrors, TOperations, TQueries, TProjections, TObjects>): ApplicationTaskBinding<TInput, TOutput, TErrors>;
  workflow<
    TInput extends object,
    TOutput extends object,
    TErrors extends Readonly<Record<string, object>>,
    TSignals extends Readonly<Record<string, object>>,
    TTasks extends Readonly<Record<string, ApplicationTaskReference>>,
    TWorkflows extends Readonly<Record<string, ApplicationWorkflowReference>>,
  >(definition: WorkflowDefinition<TInput, TOutput, TErrors, TSignals>, options: ApplicationWorkflowOptions<TTasks, TWorkflows>, handler: ApplicationWorkflowHandler<TInput, TOutput, TErrors, TSignals, TTasks, TWorkflows>): ApplicationWorkflowBinding<TInput, TOutput, TErrors, TSignals>;
  /** Select a scalar graph value from a typed installation field without authoring raw CEL. */
  select<TInput extends string, TOutput extends ApplicationGraphScalar>(
    input: TInput,
    cases: Partial<Record<TInput, TOutput>> & { readonly default: TOutput },
  ): TOutput;
  /**
   * Select a provider from concrete installation desired state. Registry
   * selections are resolved by the deployer; task-capability selections are
   * lowered to runtime configuration without rebuilding authored images.
   */
  selectProvider<TImplementation>(
    input: string,
    cases: Readonly<Record<string, TImplementation>> & { readonly default: TImplementation },
  ): TImplementation;
  /** Select between two scalar graph values from a typed installation condition. */
  when<TOutput extends ApplicationGraphScalar>(
    condition: boolean,
    branches: { readonly then: TOutput; readonly otherwise: TOutput },
  ): TOutput;
  /** Combine typed installation conditions without authoring raw CEL. */
  any(...conditions: readonly boolean[]): boolean;
  /** Require every typed installation condition without authoring raw CEL. */
  all(...conditions: readonly boolean[]): boolean;
  /** Compose a string from literals and typed installation values without authoring CEL. */
  interpolate(strings: TemplateStringsArray, ...values: readonly ApplicationGraphScalar[]): string;
}

export type ApplicationGraphScalar = string | number | boolean;

export interface ApplicationInstallOptions<TSpec extends KroCompatibleType> {
  readonly spec: TSpec | Composable<TSpec>;
  /** Stable graph-evidence name. Defaults to the child Application name. */
  readonly name?: string;
  /** Optional TypeKro dependency; readiness ordering remains owned by TypeKro. */
  readonly dependsOn?: string | KubernetesResource | { readonly __compositionId: string };
}

export interface ApplicationInstallBinding<TSpec extends KroCompatibleType, TStatus extends KroCompatibleType> {
  readonly kind: 'applicationInstall';
  readonly name: string;
  readonly application: {
    readonly name: string;
    readonly apiVersion: string;
    readonly kind: string;
  };
  readonly spec: TSpec | Composable<TSpec>;
  readonly status: TStatus;
  readonly resource: ReturnType<TypeKroListenerComposition<TSpec, TStatus>>;
}

export interface ApplicationServerRegistrar {
  (name: string, configure: (server: ApplicationServer) => void): ApplicationServerBinding;
  (name: string, options: ApplicationServerOptions, configure: (server: ApplicationServer) => void): ApplicationServerBinding;
}

export interface ApplicationStorageRegistrar {
  postgres(name: string, options?: ApplicationStoragePostgresOptions): ApplicationDefaultsBinding;
}

export interface ApplicationDatabaseRegistrar {
  postgres<TSchema extends Readonly<Record<string, unknown>>>(name: string, options: ApplicationDatabasePostgresOptions<TSchema>): ApplicationDatabaseBinding<TSchema>;
}

export interface ApplicationDatabasePostgresOptions<TSchema extends Readonly<Record<string, unknown>>> extends Omit<ApplicationStoragePostgresOptions, 'migrations'> {
  readonly schema: TSchema;
  readonly migrations?: string | { readonly path: string; readonly digest?: string };
  readonly access?: ApplicationPostgresRlsPolicy;
}

export interface ApplicationDatabaseBinding<TSchema extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>> {
  readonly kind: 'applicationDatabase';
  readonly name: string;
  readonly provider: ApplicationTransactionalDatabaseProvider;
  readonly schema: TSchema;
  readonly migrations?: { readonly path: string; readonly digest?: string };
  readonly access?: ApplicationPostgresRlsPolicy;
}

export interface ApplicationNativeDrizzleModelOptions<TTable extends AnyPgTable> extends Omit<PromoteDrizzleTableOptions<TTable>, 'database' | 'schema'> {
  readonly database?: ApplicationDatabaseBinding;
  readonly access?: 'required' | 'global';
  /** Default generated command-processor placement for this model. */
  readonly processor?: ApplicationProcessorOptions;
}

export interface ApplicationNativeAnalyticalDrizzleModelOptions<
  TTable extends AnyPgTable,
> extends PromoteAnalyticalDrizzleTableOptions<TTable> {
  readonly database:
    | ApplicationAnalyticalDatabaseProvider
    | ApplicationProviderBinding<ApplicationAnalyticalDatabaseProvider>;
}

function isApplicationNativeAnalyticalModelOptions<
  TTable extends AnyPgTable,
>(
  options:
    | ApplicationNativeDrizzleModelOptions<TTable>
    | ApplicationNativeAnalyticalDrizzleModelOptions<TTable>
    | undefined,
): options is ApplicationNativeAnalyticalDrizzleModelOptions<TTable> {
  if (!options?.database) return false;
  return Boolean(
    applicationAnalyticalDatabaseImplementation(options.database)
    || applicationProviderSelectionFor<ApplicationAnalyticalDatabaseProvider>(
      options.database,
    ),
  );
}

export type ApplicationStoragePostgresOptions = Omit<ApplicationPostgresTransactionalDatabaseOptions, 'name' | 'migrations'> & {
  readonly migrations?: ApplicationPostgresTransactionalDatabaseOptions['migrations'] | 'generated-job' | 'generatedJob';
};

export type ApplicationResourceOptions<TSpec extends object, TStatus extends object> = Omit<CrdOptions<TSpec, TStatus>, 'apiVersion' | 'kind'> & {
  readonly apiVersion?: string;
  readonly kind?: string;
};

export interface ApplicationNamedModelOptions<TSpec extends object = object, TStatus extends object = Record<string, never>> extends ApplicationModelOptions<TSpec, TStatus> {
  readonly spec: SchemaInput<TSpec>;
  readonly status?: SchemaInput<TStatus>;
  readonly indexes?: Readonly<Record<string, readonly string[] | ApplicationNamedModelIndexOptions<TSpec, TStatus>>>;
}

export interface ApplicationNamedModelIndexOptions<TSpec extends object = object, TStatus extends object = Record<string, never>> {
  readonly fields?: readonly string[];
  readonly partitionBy?: string;
  readonly filter?: Partial<TSpec> | Partial<TStatus>;
  readonly orderBy?: readonly string[];
  readonly unique?: boolean;
}

export type ApplicationCrdOptions<TSpec extends object, TStatus extends object> = Omit<CrdOptions<TSpec, TStatus>, 'kind' | 'spec' | 'status'> & {
  readonly kind?: string;
  readonly access?: {
    readonly context: import('./trusted-context.js').ApplicationTrustedContext<unknown>;
    readonly namespaceLabel: string;
  };
  readonly create?: ApplicationKubernetesCreatePolicy<TSpec>;
};

export interface ApplicationConfigOptions {
  readonly namespace?: string;
  readonly env?: string;
  readonly configMapName?: string;
  readonly key?: string;
  readonly mountPath?: string;
  readonly value?: string;
}

export interface ApplicationConfigBinding {
  readonly kind: 'applicationConfig';
  readonly name: string;
  readonly provider: 'ConfigMap';
  readonly resourceName: string;
  readonly namespace?: string;
  readonly key: string;
  readonly env?: string;
  readonly mountPath?: string;
  readonly diagnosticsPath: string;
}

export interface ApplicationSecretOptions {
  readonly namespace?: string;
  readonly env?: string;
  readonly secretName?: string;
  readonly key?: string;
  readonly mountPath?: string;
  readonly redaction?: 'required' | 'none';
  /**
   * Controls whether applik8s emits the Secret object or only references an
   * externally managed Secret. When omitted, an explicit secretName is treated
   * as external and an implicit generated name is treated as generated.
   */
  readonly ownership?: 'generated' | 'external';
}

export interface ApplicationSecretBinding {
  readonly kind: 'applicationSecret';
  readonly name: string;
  readonly provider: 'Secret';
  readonly resourceName: string;
  readonly namespace?: string;
  readonly key: string;
  readonly ownership: 'generated' | 'external';
  readonly env?: string;
  readonly mountPath?: string;
  readonly redaction: 'required' | 'none';
  readonly diagnosticsPath: string;
}

export interface ApplicationExposureOptions {
  /** Materialize this exposure only when the concrete installation condition is true. */
  readonly enabled?: boolean;
  /** Optional exposure-scoped provider. This keeps conditional transports explicit without changing global defaults. */
  readonly provider?: ApplicationHttpExposureProvider;
  readonly namespace?: string;
  readonly service?: string | ApplicationServerBinding | ApplicationGatewayBinding | ApplicationHostBinding;
  readonly servicePort?: number;
  readonly hostnames?: readonly string[];
  readonly tls?: ApplicationTlsIntent;
  readonly dns?: ApplicationDnsIntent;
  readonly gateway?: string;
  readonly ingressClassName?: string;
  readonly path?: string;
}

export type ApplicationTlsIntent =
  | { readonly mode: 'disabled' }
  | { readonly mode: 'external'; readonly secretName: string }
  | { readonly mode: 'managed'; readonly secretName?: string };

export type ApplicationDnsIntent =
  | { readonly mode: 'disabled' }
  | { readonly mode: 'managed'; readonly ttlSeconds?: number };

export interface ApplicationExposureBinding {
  readonly kind: 'applicationExposure';
  readonly name: string;
  readonly provider: 'HttpExposure';
  readonly resourceName: string;
  readonly namespace?: string;
  readonly hostnames: readonly string[];
  readonly tlsIntent: ApplicationTlsIntent & { readonly secretName?: string };
  readonly dnsIntent: ApplicationDnsIntent;
  readonly publicUrl: string;
  readonly readiness: {
    readonly ingress: 'notRequested' | 'resourceApplied';
    readonly service: 'notRequested' | 'resourceApplied';
    readonly loadBalancer: 'notRequested' | 'statusObserved';
    readonly certificate: 'notRequested' | 'external' | 'readyCondition';
    readonly dns: 'notRequested' | 'intentApplied' | 'propagationUnverified';
    readonly publicUrl: 'derived';
  };
  readonly statusPath: string;
}

export interface ApplicationServerOptions {
  readonly namespace?: string;
  readonly resourceName?: string;
  readonly serviceName?: string;
  readonly serviceAccountName?: string;
  readonly sourceConfigMapName?: string;
  readonly source?: string;
  readonly sourceFileName?: string;
  readonly image?: string;
  readonly command?: readonly string[];
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly config?: readonly ApplicationConfigBinding[] | Readonly<Record<string, ApplicationConfigBinding>>;
  readonly secrets?: readonly ApplicationSecretBinding[] | Readonly<Record<string, ApplicationSecretBinding>>;
  readonly labels?: Readonly<Record<string, string>>;
  readonly permissions?: readonly ApplicationKubernetesRbacRule[];
  readonly volumes?: readonly ApplicationServerVolume[];
  readonly volumeMounts?: readonly ApplicationServerVolumeMount[];
  readonly replicas?: number;
  readonly service?: { readonly port: number };
  /** Maximum accepted request body size. Defaults to 1 MiB. */
  readonly maxRequestBodyBytes?: number;
  /** Fixed-window limit for non-GET requests, keyed by remote address and path. */
  readonly mutationRateLimit?: { readonly maxRequests: number; readonly windowSeconds: number };
  readonly resources?: Readonly<Record<string, AnyResourceDefinition>>;
  readonly indexes?: Readonly<Record<string, ResourceIndex<object, object>>>;
  readonly models?: Readonly<Record<string, ApplicationServerModelBinding>>;
  readonly captures?: Readonly<Record<string, ApplicationServerCaptureValue>>;
  readonly cache?: readonly ResourceIndex<object, object>[];
  readonly indexBackend?: ApplicationIndexBackend;
}

export type ApplicationServerModelBinding = ApplicationRuntimeModelContract | ApplicationModelRuntimeBinding;

export interface ApplicationKubernetesRbacRule {
  readonly apiGroups: readonly string[];
  readonly resources: readonly string[];
  readonly verbs: readonly string[];
  readonly resourceNames?: readonly string[];
}

export interface ApplicationServerVolume {
  readonly name: string;
  readonly configMap?: { readonly name: string };
  readonly secret?: { readonly secretName: string };
  readonly emptyDir?: Record<string, never>;
}

export interface ApplicationServerVolumeMount {
  readonly name: string;
  readonly mountPath: string;
  readonly readOnly?: boolean;
}

export interface ApplicationServerBinding {
  readonly name: string;
  readonly resourceName: string;
  readonly serviceName: string;
  readonly namespace?: string;
  readonly url: string;
  readonly routes: readonly ApplicationServerRoute[];
  readonly deployment: Enhanced<ApplicationDeploymentSpecProjection, ApplicationDeploymentStatusProjection>;
  plan<TStatus extends object>(target: OperationTarget<TStatus>, options?: PlanTargetOptions): Result<NormalizedOperationPlan<TStatus>>;
}

export interface ApplicationServerRoute {
  readonly id: string;
  readonly named: boolean;
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly handlerSource: string;
  readonly handlerSourceKind?: 'source' | 'functionToString';
  readonly handlerSourceLocation?: ApplicationRouteSourceLocation;
  readonly authority?: ApplicationOperationAuthorityGraphContract;
}

export type ApplicationServerCaptureValue = JsonValue | ApplicationServerCaptureFunction;

export interface ApplicationServerCaptureFunction {
  readonly name: string;
  toString(): string;
}

interface ApplicationRuntimeIndexBackend {
  readonly kind: 'valkey';
  readonly host: string;
  readonly port: number;
}

interface ApplicationScopeState extends ApplicationAuthorityGraphState, ApplicationProviderState, ApplicationWorkflowState, ApplicationGeneratedJobResourceState {
  readonly resources: Record<string, AnyResourceDefinition>;
  readonly indexes: Record<string, ResourceIndex<object, object>>;
  readonly models: Record<string, ApplicationRuntimeModelContract>;
  readonly databases: Map<string, ApplicationDatabaseBinding>;
  readonly emittedTransactionalDatabases: Set<string>;
  readonly emittedAnalyticalDatabases: Set<string>;
  readonly emittedEventLogs: Set<string>;
  readonly emittedIndexStores: Set<string>;
  readonly modelLifecycleStreams: Map<string, ApplicationStreamBinding<object>>;
  readonly appResource: ApplicationCompositionResourceTarget;
}

interface ApplicationCompositionResourceTarget extends ApplicationStatusReconcilerAppResourceTarget {}

interface ApplicationContext {
  readonly scope: KubernetesApplicationScope;
  readonly state: ApplicationScopeState;
}

interface ApplicationGeneratedWorkloadBinding {
  readonly deployment: Enhanced<ApplicationDeploymentSpecProjection, ApplicationDeploymentStatusProjection>;
}

interface ApplicationDeploymentSpecProjection {
  readonly replicas: number;
  readonly selector: unknown;
  readonly template: unknown;
}

interface ApplicationDeploymentStatusProjection {
  readonly availableReplicas: number;
}


export interface ApplicationServer {
  get(name: string, path: string, handler: ApplicationRouteHandler): ApplicationRawHttpRoute;
  post(name: string, path: string, handler: ApplicationRouteHandler): ApplicationRawHttpRoute;
  /** @deprecated Give the route a stable name: get(name, path, handler). Removed at 1.0. */
  get(path: string, handler: ApplicationRouteHandler): ApplicationRawHttpRoute;
  /** @deprecated Give the route a stable name: post(name, path, handler). Removed at 1.0. */
  post(path: string, handler: ApplicationRouteHandler): ApplicationRawHttpRoute;
}

export type ApplicationRouteHandler = (request: ApplicationRequest) => unknown | Promise<unknown>;
export type ApplicationRawHttpRoute = ApplicationOperation<ApplicationRequest, unknown>;

export interface ApplicationRequest {
  readonly params: Readonly<Record<string, string | undefined>>;
  readonly query: Readonly<Record<string, string | undefined>>;
  readonly form: ApplicationFormData;
  formData(): Promise<ApplicationFormData>;
}

export interface ApplicationFormData {
  string(name: string): string;
  enum<TValue extends string>(name: string, values: readonly TValue[]): TValue;
}

export interface ApplicationAggregateOptions<TStats extends object, TEvent extends object> {
  readonly source: ResourceIndex<object, object>;
  readonly target: ApplicationAggregateStatusTarget<TStats>;
  readonly initial: TStats;
  readonly flush?: { readonly every?: string; readonly maxEvents?: number };
  reduce(stats: TStats, event: TEvent): TStats;
}

export interface ApplicationAggregateStatusTarget<TStats extends object> {
  readonly resource: Pick<AnyResourceDefinition, 'apiVersion' | 'kind' | 'plural' | 'scope'>;
  readonly name: string;
  readonly namespace?: string;
  status(stats: TStats): object;
}

export interface ApplicationAggregateBinding<TStats extends object, TEvent extends object> {
  readonly name: string;
  readonly deployment: Enhanced<ApplicationDeploymentSpecProjection, ApplicationDeploymentStatusProjection>;
  readonly options: ApplicationAggregateOptions<TStats, TEvent>;
}

export type KubernetesApplicationCompositionFunction = <TSpec extends KroCompatibleType, TStatus extends KroCompatibleType>(
  definition: TypeKroListenerCompositionDefinition<TSpec, TStatus>,
  compositionFn: (spec: TSpec, app: KubernetesApplicationScope) => MagicAssignableShape<TStatus>,
  options?: SerializationOptions
) => TypeKroListenerComposition<TSpec, TStatus>;

export interface KubernetesApplicationBuilderOptions<TSpec extends KroCompatibleType = Record<string, never>, TStatus extends KroCompatibleType = { readonly ready: boolean }> {
  /** Default workload namespace. A resolver may derive it from each concrete installation spec. */
  readonly namespace?: string | ((spec: TSpec) => string);
  /** Namespace for installation custom resources. Keep this distinct from an Application-owned workload namespace. */
  readonly controlPlaneNamespace?: string;
  readonly apiVersion?: string;
  readonly kind?: string;
  readonly spec?: Type<TSpec>;
  readonly status?: Type<TStatus>;
}

export interface ApplicationInstallationBinding<TSpec extends KroCompatibleType, TStatus extends KroCompatibleType> {
  readonly apiVersion: string;
  readonly kind: string;
  /**
   * Shape-aware per-instance inputs that may be used while declaring providers
   * and resources. They type-check as ordinary spec values and lower to KRO
   * schema references when the Application composition is serialized.
   */
  readonly spec: TSpec;
  readonly model: PromotedKubernetesResource<TSpec, TStatus>;
  instance(input: { readonly name: string; readonly namespace?: string; readonly spec: TSpec; readonly labels?: Readonly<Record<string, string>>; readonly annotations?: Readonly<Record<string, string>> }): ResourceObject<TSpec, TStatus>;
  /** Connect a Node-side typed client; deletion always delegates to TypeKro finalization. */
  connect(options: ApplicationInstallationConnectOptions<TSpec, TStatus>): Promise<ApplicationInstallationClient<TSpec, TStatus>>;
  /** Adds resources whose values are derived from each concrete installation spec. */
  configure(callback: (spec: TSpec, application: KubernetesApplicationScope) => void): void;
}

export interface KubernetesApplicationBuilder<TSpec extends KroCompatibleType = Record<string, never>, TStatus extends KroCompatibleType = { readonly ready: boolean }> extends KubernetesApplicationScope {
  readonly name: string;
  readonly installation: ApplicationInstallationBinding<TSpec, TStatus>;
  readonly composition: TypeKroListenerComposition<TSpec, TStatus>;
  readonly operatorInstalls: readonly unknown[];
  readonly resources: readonly unknown[];
  /**
   * Derives an exhaustive deployment profile from one string-literal
   * installation discriminator. The explicit variant tuple is required only
   * when the public ArkType JSON projection cannot prove the union.
   */
  profile<
    TDiscriminator extends Extract<keyof TSpec, string>,
    TVariant extends string = ApplicationProfileVariant<TSpec, TDiscriminator>,
  >(
    spec: TSpec,
    discriminator: TDiscriminator,
    options?: {
      readonly variants?: readonly TVariant[];
      readonly schemaRevision?: string;
    },
  ): ApplicationProfile<TSpec, TDiscriminator, TVariant>;
  /** Resolves one exhaustively provided, semantically qualified capability. */
  inject<TImplementation>(
    token: ApplicationQualifiedProviderToken<TImplementation>,
  ): ApplicationQualifiedProviderBinding<TImplementation>;
  resolveOperatorInstalls(options: { readonly manifests: readonly unknown[] }): Result<unknown>;
  factory(name: string, options?: unknown): unknown;
}

export interface KubernetesApplicationFunction extends KubernetesApplicationCompositionFunction {
  <TSpec extends KroCompatibleType, TStatus extends KroCompatibleType>(name: string, options: KubernetesApplicationBuilderOptions<TSpec, TStatus> & { readonly spec: Type<TSpec>; readonly status: Type<TStatus> }): KubernetesApplicationBuilder<TSpec, TStatus>;
  (name: string, options?: KubernetesApplicationBuilderOptions): KubernetesApplicationBuilder;
}

const applicationGraphByComposition = new WeakMap<object, ApplicationGraph>();
const applicationStateByScope = new WeakMap<KubernetesApplicationScope, ApplicationScopeState>();
let lastApplicationGraph: ApplicationGraph | undefined;

export function applicationGraphFor(composition: object): ApplicationGraph | undefined {
  const attached = Reflect.get(composition, applicationGraphMetadataProperty);
  return isApplicationGraph(attached) ? attached : applicationGraphByComposition.get(composition);
}

function attachApplicationGraph(composition: object, graph: ApplicationGraph): void {
  applicationGraphByComposition.set(composition, graph);
  Object.defineProperty(composition, applicationGraphMetadataProperty, { value: graph, enumerable: false, configurable: true });
}

function applicationCompositionWrapper<TSpec extends KroCompatibleType, TStatus extends KroCompatibleType>(
  definition: TypeKroListenerCompositionDefinition<TSpec, TStatus>,
  compositionFn: (spec: TSpec, app: KubernetesApplicationScope) => MagicAssignableShape<TStatus>,
  graphName: string
): (spec: TSpec) => MagicAssignableShape<TStatus> {
  const wrapped = (spec: TSpec) => {
    const context = createApplicationContext(definition);
    const result = withApplicationOperatorResourceCollection(context.state, () => compositionFn(spec, context.scope));
    const generatedJobStatusStores = emitApplicationGeneratedJobStatusReconcilers(context.state, { graphResourceId, kubernetesNameSegment, apiGroupForApiVersion });
    lastApplicationGraph = applicationGraphFromState(kubernetesNameSegment(graphName), context.state);
    return applicationStatusWithGeneratedJobProjection(result, generatedJobStatusStores);
  };
  Object.defineProperty(wrapped, 'toString', { value: () => compositionFn.toString() });
  return wrapped;
}

function applicationStatusWithGeneratedJobProjection<TStatus extends KroCompatibleType>(
  status: MagicAssignableShape<TStatus>,
  stores: readonly ApplicationGeneratedJobStatusProjectionState[]
): MagicAssignableShape<TStatus> {
  if (stores.length === 0) {
    return status;
  }
  const jobs = stores.map(applicationGeneratedJobStatusCel);
  const mergedJobs = jobs.slice(1).reduce(
    (merged, next) => Cel.expr<Readonly<Record<string, unknown>>>('map.merge(', merged, ', ', next, ')'),
    jobs[0]
  );
  // TypeKro derives the nested status schema from this KRO-owned CEL projection.
  // The public TStatus may omit the reserved applik8s namespace, so the
  // framework augments it at the serialization boundary.
  // typecast: add the reserved framework status namespace at the TypeKro serialization boundary.
  return {
    ...status,
    applik8s: { jobs: mergedJobs },
  } as MagicAssignableShape<TStatus>;
}

function applicationGeneratedJobStatusCel(store: ApplicationGeneratedJobStatusProjectionState): Readonly<Record<string, unknown>> {
  // TypeKro's `$` access forces a CEL reference for the shape-agnostic
  // ConfigMap externalRef instead of reading a local placeholder value.
  const data = Reflect.get(store, '$data');
  const metadata = Reflect.get(store, 'metadata');
  const resourceVersion = Reflect.get(metadata, 'resourceVersion');
  return Cel.expr<Readonly<Record<string, unknown>>>(
    resourceVersion,
    ' != "" && has(',
    data,
    ') && "applik8s-jobs.json" in ',
    data,
    ' ? json.unmarshal(',
    data,
    '["applik8s-jobs.json"]) : {}'
  );
}

export const kubernetesComposition: KubernetesApplicationCompositionFunction = (definition, compositionFn, options) => {
  lastApplicationGraph = undefined;
  const composition = typeKro.kubernetesComposition(
    definition,
    applicationCompositionWrapper(definition, compositionFn, definition.name),
    options
  );
  Object.defineProperty(composition, applicationTypeKroDefinitionProperty, {
    value: definition,
    enumerable: false,
    configurable: false,
  });
  if (lastApplicationGraph) {
    attachApplicationGraph(composition, lastApplicationGraph);
  }
  return composition;
};

// typecast: this implementation intentionally presents the overloaded app(name, options) and app(definition, callback, options) public surface.
export const app = ((definitionOrName: TypeKroListenerCompositionDefinition<KroCompatibleType, KroCompatibleType> | string, compositionOrOptions?: ((spec: KroCompatibleType, app: KubernetesApplicationScope) => MagicAssignableShape<KroCompatibleType>) | KubernetesApplicationBuilderOptions, options?: SerializationOptions) => {
  if (typeof definitionOrName === 'string') {
    // typecast: the public app overload selects builder options when the first argument is the app name.
    return createKubernetesApplicationBuilder(definitionOrName, compositionOrOptions as KubernetesApplicationBuilderOptions | undefined);
  }
  // typecast: the public app overload selects the composition callback when the first argument is a TypeKro definition.
  return kubernetesComposition(definitionOrName, compositionOrOptions as (spec: KroCompatibleType, app: KubernetesApplicationScope) => MagicAssignableShape<KroCompatibleType>, options);
}) as KubernetesApplicationFunction;

export const sdk = Object.assign({}, baseSdk, { app, kubernetesComposition });

type ApplicationBuilderReplay = (scope: KubernetesApplicationScope) => void;

interface ApplicationSearchDeclarationReplay {
  readonly name: string;
  readonly fields: readonly ApplicationSearchField[];
  readonly options?: ApplicationSearchIndexOptions;
}

function captureApplicationSearchDeclarations(
  model: object,
  onChange: () => void,
): ApplicationSearchDeclarationReplay[] {
  const registrar = applicationSearchIndexRegistrar(model);
  if (!registrar) {
    throw new Error(
      'Application model did not install its search-index registrar before builder replay capture.',
    );
  }
  const declarations: ApplicationSearchDeclarationReplay[] = [];
  const capturingRegistrar: ApplicationSearchIndexRegistrar = (
    root,
    name,
    fields,
    options,
  ) => {
    const binding = registrar(root, name, fields, options);
    declarations.push({
      name,
      fields: [...fields],
      ...(options ? { options } : {}),
    });
    onChange();
    return binding;
  };
  bindApplicationSearchModel(model, capturingRegistrar);
  return declarations;
}

function replayApplicationSearchDeclarations(
  model: object,
  declarations: readonly ApplicationSearchDeclarationReplay[],
): void {
  if (declarations.length === 0) return;
  const registrar = applicationSearchIndexRegistrar(model);
  if (!registrar) {
    throw new Error(
      'Application model did not install its search-index registrar before builder replay.',
    );
  }
  for (const declaration of declarations) {
    // typecast-boundary: replay preserves each declaration's opaque field tuple
    // and returns no value, so its erased document generic cannot escape.
    registrar(
      model,
      declaration.name,
      declaration.fields,
      declaration.options,
    );
  }
}

// typecast-boundary: the replayable builder erases heterogeneous generics only inside its private registration and replay registry.
function createKubernetesApplicationBuilder<TSpec extends KroCompatibleType = Record<string, never>, TStatus extends KroCompatibleType = { readonly ready: boolean }>(name: string, options: KubernetesApplicationBuilderOptions<TSpec, TStatus> = {}): KubernetesApplicationBuilder<TSpec, TStatus> {
  const definition = applicationBuilderDefinition(name, options);
  const installationSpec = applicationInstallationSpecProxy<TSpec>(options.spec?.json);
  const authoredDefaultNamespace = typeof options.namespace === 'function' ? options.namespace(installationSpec) : options.namespace;
  // A schema proxy is safe when assigned directly to a TypeKro resource field,
  // but nested Kubernetes objects (RoleBinding subjects, Flux sourceRefs,
  // selectors, and similar values) are ordinary objects. Normalize once to a
  // CEL string expression so every placement retains the installation value.
  const defaultNamespace = authoredDefaultNamespace
    ? applicationTypeKroString(authoredDefaultNamespace)
    : undefined;
  let materialized: TypeKroListenerComposition<TSpec, TStatus> | undefined;
  const invalidate = () => {
    materialized = undefined;
  };
  const previewContext = createApplicationContext(definition, invalidate);
  const preview = previewContext.scope;
  const replays: ApplicationBuilderReplay[] = [];
  const behaviorReplays: ApplicationBuilderReplay[] = [];
  const terminalReplays: ApplicationBuilderReplay[] = [];
  const installationReplays: ((spec: TSpec, scope: KubernetesApplicationScope) => void)[] = [];
  const declaredResources: Record<string, AnyResourceDefinition> = {};
  const declaredModels: Record<string, ApplicationModelBinding<object, object>> = {};
  const profileDiscriminators = new Set<string>();
  const qualifiedBindings = new Map<
    string,
    ApplicationQualifiedProviderBinding<unknown>
  >();
  const qualifiedInjectors = new Map<
    string,
    () => ApplicationQualifiedProviderBinding<unknown>
  >();
  const qualifiedProviderReplays = new Map<
    string,
    {
      token: ApplicationQualifiedProviderToken<unknown>;
      implementation: unknown;
      profile: ApplicationProfileProviderSelectionContract;
    }
  >();
  terminalReplays.push((scope) => {
    const authority = previewContext.state.graphNodes.find((node) => node.kind === 'authorityManifest');
    if (!authority) return;
    const target = applicationStateByScope.get(scope);
    if (!target) throw new Error(`Application ${name} could not replay its static authority manifest.`);
    addApplicationGraphNode(target, structuredClone(authority));
  });
  const installationModel = promoteKubernetesResource(baseSdk.crd<TSpec, TStatus>({
    apiVersion: definition.apiVersion ?? `${kubernetesNameSegment(name)}.applik8s.dev/v1alpha1`,
    kind: definition.kind,
    spec: definition.spec,
    status: definition.status,
  }), { name: definition.kind });
  const installation: ApplicationInstallationBinding<TSpec, TStatus> = Object.freeze({
    apiVersion: installationModel.apiVersion,
    kind: installationModel.kind,
    spec: installationSpec,
    model: installationModel,
    instance: installationModel.instance,
    async connect(connectOptions: ApplicationInstallationConnectOptions<TSpec, TStatus>) {
      const namespace = connectOptions.namespace ?? options.controlPlaneNamespace;
      if (!namespace?.trim()) throw new Error(`Application ${name} installation.connect(...) requires an explicit control-plane namespace.`);
      // static-import-exception: the Kubernetes SDK adapter loads only for an explicit default installation connection.
      let transport = connectOptions.transport;
      if (!transport) {
        // static-import-exception: preserve the provider-neutral authoring package by loading the Kubernetes adapter on demand.
        transport = await import('@applik8s/runtime-kubernetes').then(({ kubernetesApplicationInstallationTransport }) => kubernetesApplicationInstallationTransport<TSpec, TStatus>({
          apiVersion: installationModel.apiVersion,
          kind: installationModel.kind,
          plural: installationModel.plural,
          context: connectOptions.context ?? '',
          async deleteInstance(reference, kubeConfig) {
            const factory = materialize().factory('kro', {
              namespace: reference.namespace,
              kubeConfig,
              waitForReady: true,
              timeout: 10 * 60_000,
            });
            const remove = Reflect.get(factory, 'deleteInstance');
            if (typeof remove !== 'function') throw new Error(`Application ${name} TypeKro factory does not expose deleteInstance().`);
            await Reflect.apply(remove, factory, [reference.name]);
          },
        }));
      }
      if (!transport) throw new Error(`Application ${name} installation transport could not be initialized.`);
      return createApplicationInstallationClient({
        apiVersion: installationModel.apiVersion,
        kind: installationModel.kind,
        namespace,
        instance: installationModel.instance,
        validateSpec(spec) {
          // typecast-boundary: TSpec is schema-constrained by the builder; the
          // RuntimeSchema validates its JSON representation before mutation.
          const validated = installationModel.spec.validate(spec as JsonValue);
          if (!validated.ok) throw new Error(`Application ${name} installation spec is invalid: ${validated.error.message}`);
          return validated.value;
        },
        transport,
      });
    },
    configure(callback: (spec: TSpec, application: KubernetesApplicationScope) => void) {
      if (typeof callback !== 'function') throw new Error(`Application ${name} installation.configure(...) requires a composition callback.`);
      installationReplays.push(callback);
      invalidate();
    },
  });

  if (defaultNamespace) {
    const eventLog = { ...defaultApplicationEventLogProvider, namespace: defaultNamespace };
    preview.defaults({ eventLog });
    replays.push((scope) => {
      scope.defaults({ eventLog });
    });
  }

  const materialize = () => {
    if (!materialized) {
      materialized = kubernetesComposition(definition, (spec, scope) => {
        for (const replay of replays) {
          replay(scope);
        }
        for (const replay of behaviorReplays) {
          replay(scope);
        }
        for (const replay of installationReplays) {
          replay(spec, scope);
        }
        for (const replay of terminalReplays) {
          replay(scope);
        }
        // typecast: builder-style apps synthesize the minimal TypeKro status object required by the generated composition definition.
        return { ready: true } as unknown as MagicAssignableShape<TStatus>;
      });
      Object.defineProperty(materialized, applicationInstallationMetadataProperty, {
        value: Object.freeze({
          apiVersion: installation.apiVersion,
          kind: installation.kind,
          // An authored spec schema is an installation contract, not permission
          // for the compiler to fabricate an empty custom resource.
          emitDefaultInstance: options.spec === undefined,
          ...(options.controlPlaneNamespace ? { controlPlaneNamespace: options.controlPlaneNamespace } : {}),
          ...(options.status ? { statusProjection: applicationInstallationStatusProjection(options.status, name) } : {}),
        }),
        enumerable: false,
        configurable: false,
      });
      const graph = applicationGraphFor(materialized);
      if (graph && defaultNamespace) {
        attachApplicationGraph(materialized, normalizeApplicationGraph({ ...graph, metadata: { ...graph.metadata, namespace: defaultNamespace } }));
      }
    }
    return materialized;
  };
  const withDefaultNamespace = <TOptions extends { readonly namespace?: string }>(value: TOptions | undefined): TOptions => {
    const authoredNamespace = value?.namespace ?? defaultNamespace;
    if (!authoredNamespace) {
      // typecast: empty option objects are valid for every namespace-bearing app option shape used by this helper.
      return (value ?? {}) as TOptions;
    }
    // Normalize explicit namespaces too: callers commonly pass
    // app.installation.spec.name, and nested generated fields must not retain
    // its live proxy identity.
    return { ...(value ?? {}), namespace: applicationTypeKroString(authoredNamespace) } as TOptions;
  };
  const storage: ApplicationStorageRegistrar = {
    postgres(storeName, storeOptions = {}) {
      const normalizedOptions = withDefaultNamespace(storeOptions);
      const binding = preview.storage.postgres(storeName, normalizedOptions);
      replays.push((scope) => {
        scope.storage.postgres(storeName, normalizedOptions);
      });
      invalidate();
      return binding;
    },
  };
  const database: ApplicationDatabaseRegistrar = {
    postgres(databaseName, databaseOptions) {
      const normalizedOptions = withDefaultNamespace(databaseOptions);
      const binding = preview.database.postgres(databaseName, normalizedOptions);
      replays.push((scope) => {
        scope.database.postgres(databaseName, normalizedOptions);
      });
      invalidate();
      return binding;
    },
  };
  // typecast: the implementation records one runtime branch for both app.http(name, configure) and app.http(name, options, configure) overloads.
  const http = ((serverName: string, optionsOrConfigure: ApplicationServerOptions | ((server: ApplicationServer) => void), maybeConfigure?: (server: ApplicationServer) => void) => {
    const explicitOptions = typeof optionsOrConfigure === 'function' ? {} : optionsOrConfigure;
    const serverOptions = applicationBuilderServerOptions(withDefaultNamespace<ApplicationServerOptions>(explicitOptions), declaredResources, declaredModels);
    const configure = typeof optionsOrConfigure === 'function' ? optionsOrConfigure : maybeConfigure;
    if (!configure) {
      throw new Error(`app.http(${JSON.stringify(serverName)}, ...) requires a route configuration callback.`);
    }
    const binding = preview.http(serverName, serverOptions, configure);
    replays.push((scope) => {
      scope.http(serverName, serverOptions, configure);
    });
    invalidate();
    return binding;
  }) as ApplicationServerRegistrar & Record<string, ApplicationServerBinding>;
  const builder = {
    name,
    installation,
    get composition() {
      return materialize();
    },
    get operatorInstalls() {
      // typecast: TypeKro listener compositions expose richer install records; the builder public surface intentionally projects operatorName only.
      return materialize().operatorInstalls as readonly { readonly operatorName: string }[];
    },
    get resources() {
      // typecast: builder.resources is an inspection surface over generated Kubernetes/TypeKro resource objects with heterogeneous shapes.
      return materialize().resources as readonly unknown[];
    },
    profile<
      TDiscriminator extends Extract<keyof TSpec, string>,
      TVariant extends string = ApplicationProfileVariant<TSpec, TDiscriminator>,
    >(
      profileSpec: TSpec,
      discriminator: TDiscriminator,
      profileOptions: {
        readonly variants?: readonly TVariant[];
        readonly schemaRevision?: string;
      } = {},
    ): ApplicationProfile<TSpec, TDiscriminator, TVariant> {
      if (profileSpec !== installationSpec) {
        throw new Error(
          `Application ${name} profile ${String(discriminator)} must use application.installation.spec.`,
        );
      }
      if (profileDiscriminators.has(String(discriminator))) {
        throw new Error(
          `Application ${name} already declares profile ${String(discriminator)}.`,
        );
      }
      const variants = applicationProfileVariantsFromSchema(
        options.spec?.json,
        String(discriminator),
        profileOptions.variants,
      ) as readonly TVariant[];
      profileDiscriminators.add(String(discriminator));
      const runtime = createApplicationProfileRuntime<
        TSpec,
        TDiscriminator,
        TVariant
      >({
        application: name,
        spec: profileSpec,
        discriminator,
        variants,
        schemaRevision: profileOptions.schemaRevision ?? 'v1alpha1',
        selectionInput: Reflect.get(profileSpec, discriminator) as string,
        selector: applicationTypeKroExpressionValue(
          Reflect.get(profileSpec, discriminator),
        ) ?? String(Reflect.get(profileSpec, discriminator)),
        selectProvider: applicationGraphProviderSelection,
        register(token, implementation, contract) {
          const normalizedImplementation =
            applicationProfileProviderWithNamespace(
              token.base,
              implementation,
              defaultNamespace,
            );
          const key = token.qualification.key;
          const existingReplay = qualifiedProviderReplays.get(key);
          if (
            existingReplay
            && existingReplay.profile.profileId !== contract.profileId
          ) {
            throw new Error(
              `Application ${name} provides ${key} from both ${existingReplay.profile.profileId} and ${contract.profileId}. A qualification has exactly one profile authority.`,
            );
          }
          if (existingReplay) {
            existingReplay.implementation = normalizedImplementation;
            existingReplay.profile = contract;
          } else {
            const replay = {
              token: token as ApplicationQualifiedProviderToken<unknown>,
              implementation: normalizedImplementation,
              profile: contract,
            };
            qualifiedProviderReplays.set(key, replay);
            replays.push((scope) => {
              scope.provide(replay.token, replay.implementation);
              const target = applicationStateByScope.get(scope);
              if (!target) {
                throw new Error(
                  `Application ${name} could not record profile ${replay.profile.profileId}.`,
                );
              }
              recordApplicationProfileSelectionGraph(target, replay.profile);
            });
          }
          preview.provide(token, normalizedImplementation);
          recordApplicationProfileSelectionGraph(
            previewContext.state,
            contract,
          );
          const binding: ApplicationQualifiedProviderBinding<
            typeof implementation
          > = Object.freeze({
            kind: 'applicationProvider',
            token,
              implementation: normalizedImplementation,
            qualification: token.qualification,
            profile: contract,
          });
          qualifiedBindings.set(
            key,
            binding as ApplicationQualifiedProviderBinding<unknown>,
          );
          qualifiedInjectors.set(
            key,
            () =>
              runtime.inject(
                token,
              ) as ApplicationQualifiedProviderBinding<unknown>,
          );
          invalidate();
          return binding;
        },
      });
      return runtime.profile;
    },
    inject<TImplementation>(
      token: ApplicationQualifiedProviderToken<TImplementation>,
    ): ApplicationQualifiedProviderBinding<TImplementation> {
      const binding = qualifiedBindings.get(token.qualification.key);
      const inject = qualifiedInjectors.get(token.qualification.key);
      if (!binding || !inject) {
        throw new Error(
          `Application ${name} cannot inject ${token.qualification.key} before an exhaustive profile provision.`,
        );
      }
      return inject() as ApplicationQualifiedProviderBinding<TImplementation>;
    },
    resolveOperatorInstalls(resolveOptions: { readonly manifests: readonly unknown[] }) {
      // typecast: builder forwards opaque manifest input to the underlying TypeKro composition resolver while preserving the public Result shape.
      return materialize().resolveOperatorInstalls(resolveOptions as never) as Result<unknown>;
    },
    factory(factoryName: string, factoryOptions?: unknown) {
      const normalizedFactoryOptions = factoryName === 'kro' && options.controlPlaneNamespace
        ? {
            ...(factoryOptions && typeof factoryOptions === 'object' ? factoryOptions : {}),
            namespace: (factoryOptions && typeof factoryOptions === 'object' && typeof Reflect.get(factoryOptions, 'namespace') === 'string')
              ? Reflect.get(factoryOptions, 'namespace')
              : options.controlPlaneNamespace,
          }
        : factoryOptions;
      // typecast: builder.factory forwards dynamic factory names/options to TypeKro and returns an intentionally opaque inspection/deployment factory.
      return materialize().factory(factoryName as never, normalizedFactoryOptions as never) as unknown;
    },
    api: http,
    http,
    server: http,
    storage,
    database,
    serviceIdentity(identityName) {
      return preview.serviceIdentity(identityName);
    },
    permission(permissionName, ...selections) {
      return preview.permission(permissionName, ...selections);
    },
    outcome(outcomeName, outcomeOptions) {
      return preview.outcome(outcomeName, outcomeOptions);
    },
    operator<TBinding>(operator: (operatorOptions: OperatorDeploymentOptions) => TBinding, operatorOptions: OperatorDeploymentOptions): TBinding {
      const normalizedOptions = withDefaultNamespace(operatorOptions);
      const binding = preview.operator(operator, normalizedOptions);
      replays.push((scope) => {
        scope.operator(operator, normalizedOptions);
      });
      invalidate();
      return binding;
    },
    resource<TSpec extends object, TStatus extends object = Record<string, never>>(resourceName: string, resourceOptions: ApplicationResourceOptions<TSpec, TStatus>): ResourceDefinition<TSpec, TStatus> {
      const resource = preview.resource(resourceName, resourceOptions);
      // typecast: declaredResources stores heterogeneous CRD definitions for later inferred app.http bindings.
      declaredResources[resourceName] = resource as unknown as AnyResourceDefinition;
      replays.push((scope) => {
        scope.resource(resourceName, resourceOptions);
      });
      invalidate();
      return resource;
    },
    crd<TSpec extends object, TStatus extends object = Record<string, never>>(entity: EntityDefinition<TSpec, TStatus>, crdOptions: ApplicationCrdOptions<TSpec, TStatus>): PromotedKubernetesResource<TSpec, TStatus> {
      const resource = preview.crd(entity, crdOptions);
      const previewViewRegistrar = applicationModelViewRegistrar(resource);
      if (!previewViewRegistrar) throw new Error(`Kubernetes model ${entity.name} did not install its application view registrar.`);
      const previewLifecycleRegistrar = nativeKubernetesLifecycleRegistrar(resource);
      if (!previewLifecycleRegistrar) throw new Error(`Kubernetes model ${entity.name} did not install its application lifecycle registrar.`);
      const viewReplays: Parameters<typeof previewViewRegistrar>[] = [];
      const createLifecycleReplays: Parameters<typeof previewLifecycleRegistrar.create>[] = [];
      const updateLifecycleReplays: Parameters<typeof previewLifecycleRegistrar.update>[] = [];
      const deleteLifecycleReplays: Parameters<typeof previewLifecycleRegistrar.delete>[] = [];
      const searchReplays = captureApplicationSearchDeclarations(
        resource,
        invalidate,
      );
      bindApplicationModelViews(resource, (viewName, viewOptions) => {
        const operation = previewViewRegistrar(viewName, viewOptions);
        // typecast: the replay queue intentionally erases per-view generics while preserving each opaque option object unchanged.
        viewReplays.push([viewName, viewOptions] as never);
        invalidate();
        return operation;
      });
      bindNativeKubernetesLifecycle(resource, {
        create(name, options, handler) {
          const binding = previewLifecycleRegistrar.create(name, options, handler);
          createLifecycleReplays.push([name, options, handler]);
          invalidate();
          return binding;
        },
        update(name, options, handler) {
          const binding = previewLifecycleRegistrar.update(name, options, handler);
          updateLifecycleReplays.push([name, options, handler]);
          invalidate();
          return binding;
        },
        delete(name, options, handler) {
          const binding = previewLifecycleRegistrar.delete(name, options, handler);
          deleteLifecycleReplays.push([name, options, handler]);
          invalidate();
          return binding;
        },
      });
      // typecast: declaredResources stores heterogeneous entity-backed CRD definitions for later inferred app.http bindings.
      declaredResources[entity.name] = resource as unknown as AnyResourceDefinition;
      let replayed: PromotedKubernetesResource<TSpec, TStatus> | undefined;
      replays.push((scope) => {
        replayed = scope.crd(entity, crdOptions);
      });
      behaviorReplays.push(() => {
        if (!replayed) throw new Error(`Kubernetes model ${entity.name} replay declaration did not run before its views.`);
        const registrar = applicationModelViewRegistrar(replayed);
        if (!registrar) throw new Error(`Kubernetes model ${entity.name} did not install its replay view registrar.`);
        for (const declaration of viewReplays) registrar(...declaration);
        const lifecycleRegistrar = nativeKubernetesLifecycleRegistrar(replayed);
        if (!lifecycleRegistrar) throw new Error(`Kubernetes model ${entity.name} did not install its replay lifecycle registrar.`);
        for (const declaration of createLifecycleReplays) lifecycleRegistrar.create(...declaration);
        for (const declaration of updateLifecycleReplays) lifecycleRegistrar.update(...declaration);
        for (const declaration of deleteLifecycleReplays) lifecycleRegistrar.delete(...declaration);
        replayApplicationSearchDeclarations(replayed, searchReplays);
      });
      invalidate();
      return resource;
    },
    model<TSpec extends object, TStatus extends object = Record<string, never>, TTable extends AnyPgTable = AnyPgTable>(entityOrName: EntityDefinition<TSpec, TStatus> | TTable | string, modelOptions?: ApplicationModelOptions<TSpec, TStatus> | ApplicationNamedModelOptions<TSpec, TStatus> | ApplicationNativeDrizzleModelOptions<TTable> | ApplicationNativeAnalyticalDrizzleModelOptions<TTable>): ApplicationModelBinding<TSpec, TStatus> | PromotedDrizzleTable<TTable> | PromotedAnalyticalDrizzleTable<TTable> {
      if (isTable(entityOrName)) {
        const nativeOptions = modelOptions as
          | ApplicationNativeDrizzleModelOptions<TTable>
          | ApplicationNativeAnalyticalDrizzleModelOptions<TTable>
          | undefined;
        if (isApplicationNativeAnalyticalModelOptions(nativeOptions)) {
          const previewModel = preview.model(
            entityOrName as TTable,
            nativeOptions,
          );
          const previewFacet = getApplicationModelFacet(previewModel);
          if (!previewFacet || previewFacet.provider !== 'analytical-database') {
            throw new Error(
              `Analytical model ${getTableName(entityOrName)} did not install its analytical facet.`,
            );
          }
          const previewViewRegistrar = applicationModelViewRegistrar(
            previewModel,
          );
          if (!previewViewRegistrar) {
            throw new Error(
              `Analytical model ${previewFacet.name} did not install its view registrar.`,
            );
          }
          const viewReplays: Parameters<typeof previewViewRegistrar>[] = [];
          const searchReplays = captureApplicationSearchDeclarations(
            previewModel,
            invalidate,
          );
          bindApplicationModelViews(previewModel, (viewName, viewOptions) => {
            const operation = previewViewRegistrar(viewName, viewOptions);
            viewReplays.push([viewName, viewOptions] as never);
            invalidate();
            return operation;
          });
          let replayed:
            | PromotedAnalyticalDrizzleTable<TTable>
            | undefined;
          replays.push((scope) => {
            replayed = scope.model(entityOrName as TTable, nativeOptions);
          });
          behaviorReplays.push(() => {
            if (!replayed) {
              throw new Error(
                `Analytical model ${previewFacet.name} replay declaration did not run before its views.`,
              );
            }
            const registrar = applicationModelViewRegistrar(replayed);
            if (!registrar) {
              throw new Error(
                `Analytical model ${previewFacet.name} did not install its replay view registrar.`,
              );
            }
            for (const declaration of viewReplays) registrar(...declaration);
            replayApplicationSearchDeclarations(replayed, searchReplays);
          });
          invalidate();
          return previewModel;
        }
        const transactionalOptions =
          nativeOptions as ApplicationNativeDrizzleModelOptions<TTable> | undefined;
        const previewModel = preview.model(
          entityOrName as TTable,
          transactionalOptions,
        );
        const previewFacet = getRequiredDrizzleApplicationModelFacet(previewModel);
        const previewApi = previewFacet.api;
        const previewRegistrar = nativeApplicationModelCommandRegistrar(previewModel);
        if (!previewRegistrar) throw new Error(`Native model ${previewFacet.name} did not install its application command registrar.`);
        const previewLifecycleRegistrar = nativeApplicationModelLifecycleRegistrar(previewModel);
        if (!previewLifecycleRegistrar) throw new Error(`Native model ${previewFacet.name} did not install its application lifecycle registrar.`);
        const previewActionEventRegistrar = nativeApplicationModelActionEventRegistrar(previewModel);
        if (!previewActionEventRegistrar) throw new Error(`Native model ${previewFacet.name} did not install its application action-event registrar.`);
        const previewCreatePolicyRegistrar = nativeApplicationModelBeforeCommitRegistrar(previewApi.create);
        const previewUpdatePolicyRegistrar = nativeApplicationModelBeforeCommitRegistrar(previewApi.update);
        const previewDeletePolicyRegistrar = nativeApplicationModelBeforeCommitRegistrar(previewApi.delete);
        if (!previewCreatePolicyRegistrar || !previewUpdatePolicyRegistrar || !previewDeletePolicyRegistrar) {
          throw new Error(`Native model ${previewFacet.name} did not install its direct mutation policy registrars.`);
        }
        const previewViewRegistrar = applicationModelViewRegistrar(previewModel);
        if (!previewViewRegistrar) throw new Error(`Native model ${previewFacet.name} did not install its application view registrar.`);
        const commandReplays: {
          readonly declaration: Parameters<typeof previewRegistrar>;
          authority?: import('@applik8s/client').ApplicationOperationAuthorizationContract;
        }[] = [];
        const createLifecycleReplays: Parameters<typeof previewLifecycleRegistrar.create>[] = [];
        const updateLifecycleReplays: Parameters<typeof previewLifecycleRegistrar.update>[] = [];
        const deleteLifecycleReplays: Parameters<typeof previewLifecycleRegistrar.delete>[] = [];
        const actionEventReplays: Parameters<typeof previewActionEventRegistrar>[] = [];
        const createPolicyReplays: Parameters<typeof previewCreatePolicyRegistrar>[] = [];
        const updatePolicyReplays: Parameters<typeof previewUpdatePolicyRegistrar>[] = [];
        const deletePolicyReplays: Parameters<typeof previewDeletePolicyRegistrar>[] = [];
        const viewReplays: Parameters<typeof previewViewRegistrar>[] = [];
        const searchReplays = captureApplicationSearchDeclarations(
          previewModel,
          invalidate,
        );
        bindNativeApplicationModelCommands(previewModel, ((command: Parameters<typeof previewRegistrar>[0], commandOptions: Parameters<typeof previewRegistrar>[1], handler: Parameters<typeof previewRegistrar>[2]) => {
          const binding = previewRegistrar(command, commandOptions, handler);
          const replay: {
            readonly declaration: Parameters<typeof previewRegistrar>;
            authority?: import('@applik8s/client').ApplicationOperationAuthorizationContract;
          } = { declaration: [command, commandOptions, handler] };
          commandReplays.push(replay);
          invalidate();
          return {
            ...binding,
            classify(authority) {
              replay.authority = authority;
              binding.classify(authority);
              invalidate();
            },
          };
        }) as typeof previewRegistrar);
        bindApplicationModelViews(previewModel, (viewName, viewOptions) => {
          const operation = previewViewRegistrar(viewName, viewOptions);
          // typecast: heterogeneous view generics are replayed opaquely through the same registrar.
          viewReplays.push([viewName, viewOptions] as never);
          invalidate();
          return operation;
        });
        bindNativeApplicationModelLifecycle(previewModel, {
          create(lifecycleName, lifecycleOptions, lifecycleHandler) {
            const binding = previewLifecycleRegistrar.create(lifecycleName, lifecycleOptions, lifecycleHandler);
            createLifecycleReplays.push([lifecycleName, lifecycleOptions, lifecycleHandler]);
            invalidate();
            return binding;
          },
          update(lifecycleName, lifecycleOptions, lifecycleHandler) {
            const binding = previewLifecycleRegistrar.update(lifecycleName, lifecycleOptions, lifecycleHandler);
            updateLifecycleReplays.push([lifecycleName, lifecycleOptions, lifecycleHandler]);
            invalidate();
            return binding;
          },
          delete(lifecycleName, lifecycleOptions, lifecycleHandler) {
            const binding = previewLifecycleRegistrar.delete(lifecycleName, lifecycleOptions, lifecycleHandler);
            deleteLifecycleReplays.push([lifecycleName, lifecycleOptions, lifecycleHandler]);
            invalidate();
            return binding;
          },
        });
        bindNativeApplicationModelActionEvents(previewModel, (definition, processorName, processorOptions, processorHandler) => {
          const binding = previewActionEventRegistrar(definition, processorName, processorOptions, processorHandler);
          actionEventReplays.push([definition, processorName, processorOptions, processorHandler]);
          invalidate();
          return binding;
        });
        bindNativeApplicationModelBeforeCommit(previewApi.create, (policyOptions, policyHandler) => {
          previewCreatePolicyRegistrar(policyOptions, policyHandler);
          createPolicyReplays.push([policyOptions, policyHandler]);
          invalidate();
        });
        bindNativeApplicationModelBeforeCommit(previewApi.update, (policyOptions, policyHandler) => {
          previewUpdatePolicyRegistrar(policyOptions, policyHandler);
          updatePolicyReplays.push([policyOptions, policyHandler]);
          invalidate();
        });
        bindNativeApplicationModelBeforeCommit(previewApi.delete, (policyOptions, policyHandler) => {
          previewDeletePolicyRegistrar(policyOptions, policyHandler);
          deletePolicyReplays.push([policyOptions, policyHandler]);
          invalidate();
        });
        let replayed: PromotedDrizzleTable<TTable> | undefined;
        replays.push((scope) => {
          replayed = scope.model(entityOrName as TTable, transactionalOptions);
        });
        behaviorReplays.push(() => {
          if (!replayed) throw new Error(`Native model ${previewFacet.name} replay declaration did not run before its behaviors.`);
          const replayedFacet = getRequiredDrizzleApplicationModelFacet(replayed);
          const replayedApi = replayedFacet.api;
          const registrar = nativeApplicationModelCommandRegistrar(replayed);
          if (!registrar) throw new Error(`Native model ${replayedFacet.name} did not install its replay command registrar.`);
          for (const replay of commandReplays) {
            const binding = registrar(...replay.declaration);
            if (replay.authority) binding.classify(replay.authority);
          }
          const lifecycleRegistrar = nativeApplicationModelLifecycleRegistrar(replayed);
          if (!lifecycleRegistrar) throw new Error(`Native model ${replayedFacet.name} did not install its replay lifecycle registrar.`);
          for (const declaration of createLifecycleReplays) lifecycleRegistrar.create(...declaration);
          for (const declaration of updateLifecycleReplays) lifecycleRegistrar.update(...declaration);
          for (const declaration of deleteLifecycleReplays) lifecycleRegistrar.delete(...declaration);
          const actionEventRegistrar = nativeApplicationModelActionEventRegistrar(replayed);
          if (!actionEventRegistrar) throw new Error(`Native model ${replayedFacet.name} did not install its replay action-event registrar.`);
          for (const declaration of actionEventReplays) actionEventRegistrar(...declaration);
          const createPolicyRegistrar = nativeApplicationModelBeforeCommitRegistrar(replayedApi.create);
          const updatePolicyRegistrar = nativeApplicationModelBeforeCommitRegistrar(replayedApi.update);
          const deletePolicyRegistrar = nativeApplicationModelBeforeCommitRegistrar(replayedApi.delete);
          if (!createPolicyRegistrar || !updatePolicyRegistrar || !deletePolicyRegistrar) {
            throw new Error(`Native model ${replayedFacet.name} did not install its replay mutation policy registrars.`);
          }
          for (const declaration of createPolicyReplays) createPolicyRegistrar(...declaration);
          for (const declaration of updatePolicyReplays) updatePolicyRegistrar(...declaration);
          for (const declaration of deletePolicyReplays) deletePolicyRegistrar(...declaration);
          const viewRegistrar = applicationModelViewRegistrar(replayed);
          if (!viewRegistrar) throw new Error(`Native model ${replayedFacet.name} did not install its replay view registrar.`);
          for (const declaration of viewReplays) viewRegistrar(...declaration);
          replayApplicationSearchDeclarations(replayed, searchReplays);
        });
        invalidate();
        return previewModel;
      }
      const previewModel = typeof entityOrName === 'string'
        // typecast: named golden-path models require ApplicationNamedModelOptions and are guarded by the string branch.
        ? preview.model(entityOrName, modelOptions as ApplicationNamedModelOptions<TSpec, TStatus>)
        // typecast: entity-backed models accept ApplicationModelOptions and are guarded by the non-string branch.
        : preview.model(entityOrName, modelOptions as ApplicationModelOptions<TSpec, TStatus> | undefined);
      const commandReplays: ((model: ApplicationModelBinding<TSpec, TStatus>) => void)[] = [];
      const model: ApplicationModelBinding<TSpec, TStatus> = {
        ...previewModel,
        on: {
          ...previewModel.on,
          command(command, commandOptions, handler) {
            const binding = previewModel.on.command(command, commandOptions, handler);
            commandReplays.push((replayedModel) => {
              replayedModel.on.command(command, commandOptions, handler);
            });
            invalidate();
            return binding;
          },
          operation(operation, operationOptions, handler) {
            const binding = previewModel.on.operation(operation, operationOptions, handler);
            commandReplays.push((replayedModel) => {
              replayedModel.on.operation(operation, operationOptions, handler);
            });
            invalidate();
            return binding;
          },
          action(operation, operationOptions, handler) {
            const binding = previewModel.on.operation(operation, operationOptions, handler);
            commandReplays.push((replayedModel) => {
              replayedModel.on.operation(operation, operationOptions, handler);
            });
            invalidate();
            return binding;
          },
        },
      };
      // typecast: declaredModels stores heterogeneous model bindings for later inferred app.http bindings.
      declaredModels[model.name] = model as unknown as ApplicationModelBinding<object, object>;
      let replayedModel: ApplicationModelBinding<TSpec, TStatus> | undefined;
      replays.push((scope) => {
        replayedModel = typeof entityOrName === 'string'
          // typecast: replay preserves the named-model overload chosen above.
          ? scope.model(entityOrName, modelOptions as ApplicationNamedModelOptions<TSpec, TStatus>)
          // typecast: replay preserves the entity-model overload chosen above.
          : scope.model(entityOrName, modelOptions as ApplicationModelOptions<TSpec, TStatus> | undefined);
      });
      behaviorReplays.push(() => {
        if (!replayedModel) throw new Error(`Model ${model.name} replay declaration did not run before its commands.`);
        for (const replayCommand of commandReplays) {
          replayCommand(replayedModel);
        }
      });
      invalidate();
      return model;
    },
    index<const TFields extends readonly ApplicationSearchField[]>(
      indexName: string,
      indexOptions: ApplicationSearchRootOptions,
      ...fields: TFields
    ): ApplicationSearchIndexBinding<ApplicationSearchDocument<TFields>> {
      const binding = preview.index(indexName, indexOptions, ...fields);
      // The root model's capture registrar records and replays this declaration.
      // Registering a second scope-level replay would produce a duplicate index.
      invalidate();
      return binding;
    },
    query<TInput, TOutput, TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal, TSource extends ApplicationQuerySourceBinding | undefined = undefined>(id: string, queryOptions: ApplicationQueryOptions<TInput, TOutput, TPrincipal, TSource>): ApplicationQueryBinding<TInput, TOutput, TPrincipal, TSource> {
      const binding = preview.query(id, queryOptions);
      replays.push((scope) => {
        scope.query(id, queryOptions);
      });
      invalidate();
      return binding;
    },
    stream<TPayload extends object, TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal>(definition: StreamDefinition<TPayload> | EventDefinition<TPayload>, streamOptions: ApplicationStreamOptions<TPayload, TPrincipal>): ApplicationStreamBinding<TPayload, TPrincipal> {
      const previewBinding = preview.stream(definition, streamOptions);
      const projectionReplays: ((stream: ApplicationStreamBinding<TPayload, TPrincipal>) => void)[] = [];
      const subscriptionReplays: ((stream: ApplicationStreamBinding<TPayload, TPrincipal>) => void)[] = [];
      const processorReplays: ((stream: ApplicationStreamBinding<TPayload, TPrincipal>) => void)[] = [];
      const binding: ApplicationStreamBinding<TPayload, TPrincipal> = {
        ...previewBinding,
        project: ((name: string, projectionOptions: Omit<ApplicationProjectionOptions<TPayload, object, object>, 'source'>) => {
          // typecast: this replay wrapper preserves the public overload's discriminated option through preview and materialization.
          const projection = previewBinding.project(name, projectionOptions as never);
          projectionReplays.push((stream) => { stream.project(name, projectionOptions as never); });
          invalidate();
          return projection;
        }) as ApplicationStreamBinding<TPayload, TPrincipal>['project'],
        subscribe(name, subscriptionOptions) {
          const subscription = previewBinding.subscribe(name, subscriptionOptions);
          subscriptionReplays.push((stream) => { stream.subscribe(name, subscriptionOptions); });
          invalidate();
          return subscription;
        },
        process(name, processOptions, handler) {
          const processor = previewBinding.process(name, processOptions, handler);
          processorReplays.push((stream) => { stream.process(name, processOptions, handler); });
          invalidate();
          return processor;
        },
      };
      let replayedBinding: ApplicationStreamBinding<TPayload, TPrincipal> | undefined;
      replays.push((scope) => { replayedBinding = scope.stream(definition, streamOptions); });
      behaviorReplays.push(() => {
        if (!replayedBinding) throw new Error(`Stream ${definition.id} replay declaration did not run before its derived behavior.`);
        for (const replay of projectionReplays) replay(replayedBinding);
        for (const replay of subscriptionReplays) replay(replayedBinding);
        for (const replay of processorReplays) replay(replayedBinding);
      });
      invalidate();
      return binding;
    },
    subscription<TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal>(subscriptionName: string, subscriptionOptions: ApplicationSubscriptionOptions<TPrincipal>): ApplicationSubscriptionBinding<TPrincipal> {
      const binding = preview.subscription(subscriptionName, subscriptionOptions);
      replays.push((scope) => { scope.subscription(subscriptionName, subscriptionOptions); });
      invalidate();
      return binding;
    },
    projection: ((projectionName: string, projectionOptions: ApplicationProjectionOptions<object, object, object>) => {
      // typecast: the KubernetesApplicationScope overload selected the analytical or online branch before the replay wrapper.
      const binding = preview.projection(projectionName, projectionOptions as never);
      replays.push((scope) => { scope.projection(projectionName, projectionOptions as never); });
      invalidate();
      return binding;
    }) as KubernetesApplicationScope['projection'],
    objectStore(storeName: string, storeOptions: ApplicationObjectStoreOptions): ApplicationObjectStoreBinding {
      const binding = preview.objectStore(storeName, storeOptions);
      replays.push((scope) => { scope.objectStore(storeName, storeOptions); });
      invalidate();
      return binding;
    },
    gateway(gatewayName: string, gatewayOptions: ApplicationGatewayOptions): ApplicationGatewayBinding {
      const binding = preview.gateway(gatewayName, gatewayOptions);
      terminalReplays.push((scope) => { scope.gateway(gatewayName, gatewayOptions); });
      invalidate();
      return binding;
    },
    install<TChildSpec extends KroCompatibleType, TChildStatus extends KroCompatibleType>(
      application: KubernetesApplicationBuilder<TChildSpec, TChildStatus>,
      installOptions: ApplicationInstallOptions<TChildSpec>,
    ): ApplicationInstallBinding<TChildSpec, TChildStatus> {
      const binding = preview.install(application, installOptions);
      installationReplays.push((_spec, scope) => {
        scope.install(application, installOptions);
      });
      invalidate();
      return binding;
    },
    on<TSpec extends object, TStatus extends object = Record<string, never>>(resource: ResourceDefinition<TSpec, TStatus>, handlers: ApplicationResourceEventHandlers<TSpec, TStatus>, eventOptions: ApplicationReconcileOptions = {}): ApplicationResourceControllerBinding {
      const normalizedOptions = withDefaultNamespace(eventOptions);
      const binding = preview.on(resource, handlers, normalizedOptions);
      replays.push((scope) => {
        scope.on(resource, handlers, normalizedOptions);
      });
      invalidate();
      return binding;
    },
    reconcile<TSpec extends object, TStatus extends object = Record<string, never>>(resource: ResourceDefinition<TSpec, TStatus>, handler: ApplicationReconcileHandler<TSpec, TStatus>, reconcileOptions: ApplicationReconcileOptions = {}): ApplicationResourceControllerBinding {
      const normalizedOptions = withDefaultNamespace(reconcileOptions);
      const binding = preview.reconcile(resource, handler, normalizedOptions);
      replays.push((scope) => {
        scope.reconcile(resource, handler, normalizedOptions);
      });
      invalidate();
      return binding;
    },
    infra<TResource extends object>(resource: TResource | (() => TResource), options?: ApplicationInfrastructureOptions): TResource {
      const binding = preview.infra(resource, options);
      replays.push((scope) => {
        scope.infra(resource, options);
      });
      invalidate();
      return binding;
    },
    config(configName: string, configOptions: ApplicationConfigOptions): ApplicationConfigBinding {
      const normalizedOptions = withDefaultNamespace(configOptions);
      const binding = preview.config(configName, normalizedOptions);
      replays.push((scope) => {
        scope.config(configName, normalizedOptions);
      });
      invalidate();
      return binding;
    },
    secret(secretName: string, secretOptions: ApplicationSecretOptions): ApplicationSecretBinding {
      const normalizedOptions = withDefaultNamespace(secretOptions);
      const binding = preview.secret(secretName, normalizedOptions);
      replays.push((scope) => {
        scope.secret(secretName, normalizedOptions);
      });
      invalidate();
      return binding;
    },
    expose(exposureName: string, exposureOptions: ApplicationExposureOptions): ApplicationExposureBinding {
      const normalizedOptions = withDefaultNamespace(exposureOptions);
      const binding = preview.expose(exposureName, normalizedOptions);
      replays.push((scope) => {
        scope.expose(exposureName, normalizedOptions);
      });
      invalidate();
      return binding;
    },
    job(jobName: string, jobOptions?: ApplicationJobOptions): ApplicationJobBinding {
      const normalizedOptions = withDefaultNamespace(jobOptions);
      const binding = preview.job(jobName, normalizedOptions);
      replays.push((scope) => {
        scope.job(jobName, normalizedOptions);
      });
      invalidate();
      return binding;
    },
    schedule(scheduleName: string, scheduleOptions?: ApplicationScheduleOptions): ApplicationJobBinding {
      const normalizedOptions = withDefaultNamespace(scheduleOptions);
      const binding = preview.schedule(scheduleName, normalizedOptions);
      replays.push((scope) => {
        scope.schedule(scheduleName, normalizedOptions);
      });
      invalidate();
      return binding;
    },
    defaults(defaults: ApplicationDefaults): ApplicationDefaultsBinding {
      const binding = preview.defaults(defaults);
      replays.push((scope) => {
        scope.defaults(defaults);
      });
      invalidate();
      return binding;
    },
    provide<TImplementation>(token: ApplicationProviderToken<TImplementation>, implementation: TImplementation): ApplicationProviderBinding<TImplementation> {
      const normalizedImplementation = (
        (token as unknown) === ApplicationHost
        && defaultNamespace
        && implementation
        && typeof implementation === 'object'
        && !Reflect.get(implementation, 'namespace')
      )
        ? { ...implementation, namespace: defaultNamespace } as TImplementation
        : implementation;
      const binding = preview.provide(token, normalizedImplementation);
      replays.push((scope) => {
        scope.provide(token, normalizedImplementation);
      });
      invalidate();
      return binding;
    },
    aggregate<TStats extends object, TEvent extends object>(aggregateName: string, aggregateOptions: ApplicationAggregateOptions<TStats, TEvent>): ApplicationAggregateBinding<TStats, TEvent> {
      const binding = preview.aggregate(aggregateName, aggregateOptions);
      replays.push((scope) => {
        scope.aggregate(aggregateName, aggregateOptions);
      });
      invalidate();
      return binding;
    },
    task<TInput extends object, TOutput extends object, TErrors extends Readonly<Record<string, object>>, TOperations extends ApplicationTaskOperations = Readonly<Record<never, never>>, TQueries extends ApplicationTaskQueries = Readonly<Record<never, never>>, TProjections extends ApplicationTaskProjections = Readonly<Record<never, never>>, TObjects extends ApplicationTaskObjectStores = Readonly<Record<never, never>>>(definition: TaskDefinition<TInput, TOutput, TErrors>, taskOptions: ApplicationTaskOptions<TInput, TOperations, TQueries, TProjections, TObjects>, handler: ApplicationTaskHandler<TInput, TOutput, TErrors, TOperations, TQueries, TProjections, TObjects>): ApplicationTaskBinding<TInput, TOutput, TErrors> {
      const binding = preview.task(definition, taskOptions, handler);
      replays.push((scope) => {
        scope.task(definition, taskOptions, handler);
      });
      invalidate();
      return binding;
    },
    workflow<
      TInput extends object,
      TOutput extends object,
      TErrors extends Readonly<Record<string, object>>,
      TSignals extends Readonly<Record<string, object>>,
      TTasks extends Readonly<Record<string, ApplicationTaskReference>>,
      TWorkflows extends Readonly<Record<string, ApplicationWorkflowReference>>,
    >(definition: WorkflowDefinition<TInput, TOutput, TErrors, TSignals>, workflowOptions: ApplicationWorkflowOptions<TTasks, TWorkflows>, handler: ApplicationWorkflowHandler<TInput, TOutput, TErrors, TSignals, TTasks, TWorkflows>): ApplicationWorkflowBinding<TInput, TOutput, TErrors, TSignals> {
      const binding = preview.workflow(definition, workflowOptions, handler);
      replays.push((scope) => {
        scope.workflow(definition, workflowOptions, handler);
      });
      invalidate();
      return binding;
    },
    // typecast-boundary: these generic helpers return TypeKro expression proxies
    // typed as the selected scalar, matching the public graph DSL contract.
    select: applicationGraphSelect as KubernetesApplicationScope['select'],
    selectProvider: applicationGraphProviderSelection as KubernetesApplicationScope['selectProvider'],
    when: applicationGraphWhen as KubernetesApplicationScope['when'],
    any: applicationGraphAny,
    all: applicationGraphAll,
    interpolate: applicationGraphInterpolate,
  } satisfies KubernetesApplicationBuilder<TSpec, TStatus>;
  Object.defineProperty(builder, applicationGraphMetadataProperty, { get: () => applicationGraphFor(materialize()), enumerable: false, configurable: false });
  Object.defineProperty(builder, applicationInstallationMetadataProperty, { get: () => Reflect.get(materialize(), applicationInstallationMetadataProperty), enumerable: false, configurable: false });
  Object.defineProperty(builder, applicationTypeKroDefinitionProperty, { value: definition, enumerable: false, configurable: false });
  return builder;
}

/**
 * Creates a shape-aware KubernetesRef proxy over KRO's `schema.spec` without importing
 * TypeKro's optional advanced barrel into ordinary application discovery.
 */
function applicationInstallationSpecProxy<TSpec extends KroCompatibleType>(schemaJson: unknown): TSpec {
  // typecast-boundary: the proxy exposes TSpec's authored shape while every
  // runtime leaf remains a TypeKro schema reference rooted at schema.spec.
  return applicationInstallationValueProxy('schema.spec', schemaJson) as TSpec;
}

function applicationInstallationValueProxy(path: string, schemaJson: unknown): unknown {
  const fields = applicationInstallationSchemaFields(schemaJson);
  const fieldPath = path.startsWith('schema.') ? path.slice('schema.'.length) : path;
  const target = Object.create(null) as object;
  Object.defineProperties(target, {
    [Symbol.for('TypeKro.KubernetesRef')]: { configurable: true, value: true },
    resourceId: { configurable: true, value: '__schema__' },
    fieldPath: { configurable: true, value: fieldPath },
  });
  const children = new Map<string, unknown>();
  const marker = `__KUBERNETES_REF___schema___${fieldPath}__`;
  const child = (property: string): unknown => {
    if (!children.has(property)) {
      children.set(property, applicationInstallationValueProxy(`${path}.${property}`, fields.get(property)));
    }
    return children.get(property);
  };
  return new Proxy(target, {
    get(source, property, receiver) {
      if (property === 'toString' || property === 'valueOf') return () => marker;
      if (property === Symbol.toPrimitive) return (hint: string) => hint === 'string' ? marker : Number.NaN;
      if (typeof property === 'string' && (fields.has(property) || !(property in source))) return child(property);
      return Reflect.get(source, property, receiver);
    },
    has(source, property) {
      return typeof property === 'string' && fields.has(property) ? true : Reflect.has(source, property);
    },
    ownKeys() {
      return [...fields.keys()];
    },
    getOwnPropertyDescriptor(source, property) {
      if (typeof property === 'string' && fields.has(property)) {
        return { configurable: true, enumerable: true, value: child(property), writable: false };
      }
      return Reflect.getOwnPropertyDescriptor(source, property);
    },
  });
}

function applicationInstallationSchemaFields(schemaJson: unknown): Map<string, unknown> {
  const fields = new Map<string, unknown>();
  if (Array.isArray(schemaJson)) {
    for (const branch of schemaJson) {
      for (const [key, value] of applicationInstallationSchemaFields(branch)) fields.set(key, value);
    }
    return fields;
  }
  if (!schemaJson || typeof schemaJson !== 'object') return fields;
  for (const group of ['required', 'optional'] as const) {
    const entries = Reflect.get(schemaJson, group);
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      const key = Reflect.get(entry, 'key');
      if (typeof key === 'string') fields.set(key, Reflect.get(entry, 'value'));
    }
  }
  return fields;
}

function applicationBuilderDefinition<TSpec extends KroCompatibleType, TStatus extends KroCompatibleType>(name: string, options: KubernetesApplicationBuilderOptions<TSpec, TStatus>): TypeKroListenerCompositionDefinition<TSpec, TStatus> {
  // typecast: defaults are used only for the non-generic overload; explicit schemas retain their inferred application input/output types.
  return {
    name,
    apiVersion: options.apiVersion ?? `${kubernetesNameSegment(name)}.applik8s.dev/v1alpha1`,
    kind: options.kind ?? pascalCase(name),
    spec: options.spec ?? arkType({}),
    status: options.status ?? arkType({ ready: 'boolean' }),
  } as unknown as TypeKroListenerCompositionDefinition<TSpec, TStatus>;
}

function applicationInstallationStatusProjection<TStatus extends KroCompatibleType>(status: Type<TStatus>, name: string): NonNullable<import('@applik8s/core').ApplicationInstallationArtifactContract['statusProjection']> {
  const emitted = normalizeSchema(status, `${name}.installation.status`).emitJsonSchema();
  if (!emitted.ok) throw new Error(`Application ${name} installation status schema cannot be emitted: ${emitted.error.message}`);
  const properties = Reflect.get(emitted.value.schema, 'properties');
  // KRO owns the canonical lifecycle conditions array. Applik8s projects only
  // domain status fields so its generated CEL cannot redefine that reserved
  // schema or conflict with KRO's numeric observedGeneration values.
  const supported = new Set([
    'ready',
    'phase',
    'url',
    'observedVersion',
    'artifactDigest',
    'providerStatus',
    'migrationStatus',
    'rolloutStatus',
    'backupStatus',
    'projectionStatus',
    'degradedReasons',
  ]);
  const fields = properties && typeof properties === 'object'
    ? Object.keys(properties).filter((field): field is NonNullable<import('@applik8s/core').ApplicationInstallationArtifactContract['statusProjection']>['fields'][number] => supported.has(field))
    : [];
  return { mode: 'standardApplicationReadiness', fields };
}

function applicationBuilderServerOptions(options: ApplicationServerOptions, resources: Readonly<Record<string, AnyResourceDefinition>>, models: Readonly<Record<string, ApplicationModelBinding<object, object>>>): ApplicationServerOptions {
  return {
    ...options,
    ...(options.resources ? {} : { resources }),
    ...(options.models ? {} : { models }),
  };
}

// typecast-boundary: the scope assembles overloaded registrars after runtime discriminants select native, named, or Kubernetes implementations.
function createApplicationContext<TSpec extends KroCompatibleType, TStatus extends KroCompatibleType>(
  definition: TypeKroListenerCompositionDefinition<TSpec, TStatus>,
  onChange?: () => void,
): ApplicationContext {
  const servers: Record<string, ApplicationServerBinding> = {};
  const state: ApplicationScopeState = {
    authorityApplicationName: kubernetesNameSegment(definition.name),
    resources: {}, indexes: {}, models: {}, databases: new Map(), emittedTransactionalDatabases: new Set(), emittedAnalyticalDatabases: new Set(), emittedEventLogs: new Set(), emittedIndexStores: new Set(), modelLifecycleStreams: new Map(), appResource: applicationCompositionResourceTarget(definition), generatedJobStatusTargets: [],
    defaults: {
      indexes: defaultApplicationProviders.IndexStore,
      search: defaultApplicationProviders.Search,
      database: defaultApplicationProviders.TransactionalDatabase,
      counters: defaultApplicationProviders.CounterStore,
      events: defaultApplicationProviders.EventSource,
      eventLogs: defaultApplicationEventLogProvider,
      secrets: defaultApplicationProviders.Secret,
      queues: defaultApplicationProviders.Queue,
      objects: defaultApplicationProviders.ObjectStorage,
      expose: defaultApplicationProviders.HttpExposure,
      credentials: defaultApplicationProviders.CredentialStore,
    },
    providers: {}, graphNodes: [], graphEdges: [], providerRequirements: [], providerBindings: [], workflowHandlers: new Map(), workflowHandlerGroups: new Map(),
    ...(onChange ? { onChange } : {}),
  };
  for (const [providerInterface, implementation] of Object.entries(defaultApplicationProviders)) {
    recordApplicationProviderGraph(state, providerInterface, 'frameworkDefault', implementation);
  }
  const bindSearch = (model: object) => {
    const provider = applicationSearchProviderImplementation(
      state.providers.search ?? state.defaults.search,
    );
    if (!provider) {
      throw new Error(
        'Application search model registration requires a Search provider.',
      );
    }
    bindApplicationSearchModel(
      model,
      createApplicationSearchRegistrar({
        application: state.authorityApplicationName,
        state,
        provider,
      }),
    );
  };
  const server = (name: string, optionsOrConfigure: ApplicationServerOptions | ((server: ApplicationServer) => void), maybeConfigure?: (server: ApplicationServer) => void) => {
    const options = typeof optionsOrConfigure === 'function' ? {} : optionsOrConfigure;
    const configure = typeof optionsOrConfigure === 'function' ? optionsOrConfigure : maybeConfigure;
    if (!configure) {
      throw new Error(`app.http(${JSON.stringify(name)}, ...) requires a route configuration callback.`);
    }
    const routes: ApplicationServerRoute[] = [];
    configure(createRouteRecorder(name, routes));
    const resolvedOptions = applicationServerOptionsWithScope(state, options, routes);
    recordApplicationServerGraph(state, name, resolvedOptions, routes);
    const workload = emitApplicationServerResources(name, resolvedOptions, routes);
    const binding = applicationServerBinding(name, resolvedOptions, routes, workload);
    servers[name] = binding;
    Object.defineProperty(server, name, { value: binding, enumerable: true, configurable: true });
    collectApplicationIndexes(state, resolvedOptions.indexes ?? {});
    return binding;
  };
  const defaults = (defaults: ApplicationDefaults): ApplicationDefaultsBinding => {
    if ('database' in defaults) {
      const configuredDatabase = defaults.database;
      const transactionalDatabase = applicationTransactionalDatabaseImplementation(configuredDatabase);
      if (!transactionalDatabase) {
        throw new Error('app.defaults({ database: ... }) currently supports TransactionalDatabase.postgres(...).');
      }
      state.defaults.database = configuredDatabase;
      recordApplicationProviderGraph(state, 'TransactionalDatabase', 'default', transactionalDatabase);
    }
    if ('counters' in defaults) {
      state.defaults.counters = defaults.counters;
      recordApplicationProviderGraph(state, 'CounterStore', 'default', defaults.counters);
    }
    if ('events' in defaults) {
      state.defaults.events = defaults.events;
      recordApplicationProviderGraph(state, 'EventSource', 'default', defaults.events);
    }
    if ('eventLog' in defaults) {
      state.defaults.eventLogs = defaults.eventLog;
      recordApplicationProviderGraph(state, 'EventLog', 'default', defaults.eventLog);
    }
    if ('secrets' in defaults) {
      state.defaults.secrets = defaults.secrets;
      recordApplicationProviderGraph(state, 'Secret', 'default', defaults.secrets);
    }
    if ('queues' in defaults) {
      state.defaults.queues = defaults.queues;
      recordApplicationProviderGraph(state, 'Queue', 'default', defaults.queues);
    }
    if ('objects' in defaults) {
      state.defaults.objects = defaults.objects;
      recordApplicationProviderGraph(state, 'ObjectStorage', 'default', defaults.objects);
    }
    if ('credentials' in defaults) {
      state.defaults.credentials = defaults.credentials;
      recordApplicationProviderGraph(state, 'CredentialStore', 'default', defaults.credentials);
    }
    if ('expose' in defaults) {
      const exposureProvider = applicationHttpExposureImplementation(defaults.expose);
      if (!exposureProvider) {
        throw new Error('app.defaults({ expose: ... }) requires HttpExposure.ingress(...) or HttpExposure.nodePort(...).');
      }
      state.defaults.expose = defaults.expose;
      recordApplicationProviderGraph(state, 'HttpExposure', 'default', exposureProvider);
    }
    if ('certificates' in defaults) {
      const certificateProvider = applicationCertificateImplementation(defaults.certificates);
      if (!certificateProvider) {
        throw new Error('app.defaults({ certificates: ... }) requires a cert-manager provider with an explicit Issuer or ClusterIssuer reference.');
      }
      state.defaults.certificates = defaults.certificates;
      recordApplicationProviderGraph(state, 'Certificate', 'default', certificateProvider);
    }
    if ('dns' in defaults) {
      const dnsProvider = applicationDnsPublicationImplementation(defaults.dns);
      if (!dnsProvider) {
        throw new Error('app.defaults({ dns: ... }) requires an external-dns publication provider.');
      }
      state.defaults.dns = defaults.dns;
      recordApplicationProviderGraph(state, 'DnsPublication', 'default', dnsProvider);
    }
    if ('indexes' in defaults) {
      state.defaults.indexes = defaults.indexes;
      recordApplicationProviderGraph(state, 'IndexStore', 'default', defaults.indexes);
    }
    if ('search' in defaults) {
      if (!isApplicationSearchProvider(defaults.search)) {
        throw new Error(
          'app.defaults({ search: ... }) requires Search.postgres(...), Search.openSearch(...), or Search.externalOpenSearch(...).',
        );
      }
      state.defaults.search = defaults.search;
      recordApplicationProviderGraph(state, 'Search', 'default', defaults.search);
    }
    if ('analytics' in defaults) {
      const configuredAnalytics = defaults.analytics;
      const analyticalDatabase = applicationAnalyticalDatabaseImplementation(configuredAnalytics);
      if (!analyticalDatabase) {
        throw new Error('app.defaults({ analytics: ... }) requires AnalyticalDatabase.clickhouse(...).');
      }
      state.defaults.analytics = analyticalDatabase;
      recordApplicationProviderGraph(state, 'AnalyticalDatabase', 'default', analyticalDatabase);
    }
    return { kind: 'applicationDefaults', defaults };
  };
  const provide = <TImplementation>(token: ApplicationProviderToken<TImplementation>, implementation: TImplementation): ApplicationProviderBinding<TImplementation> => {
    const qualification = applicationProviderQualificationFor(token);
    if (!isApplicationQualifiedProviderToken(token)) {
      applyApplicationProvider(state, token, implementation);
    } else if (
      token.accepts
      && !token.accepts(implementation)
      && !applicationProviderSelectionSatisfies(
        implementation,
        token.accepts,
      )
    ) {
      throw new Error(
        `app.provide(${token.qualification.key}, ...) does not satisfy ${token.name}.`,
      );
    }
    if ((token as unknown) === IndexStore) {
      emitProvidedApplicationIndexStore(state, definition.name, undefined, implementation);
    }
    recordApplicationProviderGraph(
      state,
      applicationProviderTokenName(token),
      'provided',
      implementation,
      token.contract,
      qualification,
    );
    if ((token as unknown) === ApplicationHost) {
      return applicationHostBinding(
        ApplicationHost,
        implementation as unknown as ApplicationHostProvider,
        definition.name,
      ) as ApplicationProviderBinding<TImplementation>;
    }
    return { kind: 'applicationProvider', token, implementation } as ApplicationProviderBinding<TImplementation>;
  };
  const storage: ApplicationStorageRegistrar = {
    postgres(name, options = {}) {
      const provider = TransactionalDatabase.postgres(applicationStoragePostgresOptions(name, options));
      return defaults({ database: provider });
    },
  };
  const database: ApplicationDatabaseRegistrar = {
    postgres(name, options) {
      if (state.databases.has(name)) {
        throw new Error(`Application database ${name} is already registered.`);
      }
      const { schema, access, migrations, ...providerOptions } = options;
      const provider = TransactionalDatabase.postgres({
        ...applicationStoragePostgresOptions(name, providerOptions),
        // One app.database(...) binding is one PostgreSQL authority. Native
        // models sharing it must not provision a database per table/model.
        database: providerOptions.database ?? name,
        migrations: { strategy: migrations ? 'external' : 'none', compatibility: 'requiresExplicitMigration', apply: 'manual' },
      });
      defaults({ database: provider });
      const migrationArtifact = typeof migrations === 'string' ? { path: migrations } : migrations;
      const binding: ApplicationDatabaseBinding<typeof schema> = {
        kind: 'applicationDatabase',
        name,
        provider,
        schema,
        ...(migrationArtifact ? { migrations: migrationArtifact } : {}),
        ...(access ? { access } : {}),
      };
      state.databases.set(name, binding);
      return binding;
    },
  };
  const resource = <TSpec extends object, TStatus extends object = Record<string, never>>(name: string, options: ApplicationResourceOptions<TSpec, TStatus>): ResourceDefinition<TSpec, TStatus> => {
    const definitionResource = baseSdk.crd({
      ...options,
      apiVersion: options.apiVersion ?? applicationDefinitionApiVersion(definition),
      kind: options.kind ?? name,
    });
    collectApplicationResources(state, { [name]: definitionResource });
    recordApplicationCrdGraph(state, name, definitionResource);
    return definitionResource;
  };
  const crd = <TSpec extends object, TStatus extends object = Record<string, never>>(entity: EntityDefinition<TSpec, TStatus>, options: ApplicationCrdOptions<TSpec, TStatus>): PromotedKubernetesResource<TSpec, TStatus> => {
    const { access, create, ...crdOptions } = options;
    const definitionResource = baseSdk.crd({
      ...crdOptions,
      kind: options.kind ?? entity.name,
      spec: entity.spec,
      ...(entity.status ? { status: entity.status } : {}),
    });
    if (access && definitionResource.scope !== 'Namespaced') throw new Error(`Kubernetes model ${entity.name} cannot use namespace trusted-context enforcement because it is cluster-scoped.`);
    if (access && !access.namespaceLabel.trim()) throw new Error(`Kubernetes model ${entity.name} namespaceLabel must not be empty.`);
    const modelResource = promoteKubernetesResource(definitionResource, {
      name: entity.name,
      ...(access ? { access: { context: access.context.name, namespaceLabel: access.namespaceLabel } } : {}),
      ...(create ? { create } : {}),
    });
    collectApplicationResources(state, { [entity.name]: modelResource });
    recordApplicationCrdGraph(state, entity.name, modelResource);
    bindSearch(modelResource);
    bindApplicationModelViews(modelResource, (viewName, viewOptions) => registerApplicationModelView(state, modelResource, viewName, viewOptions));
    bindNativeKubernetesLifecycle(modelResource, {
      create: (name, lifecycleOptions, handler) => on(modelResource, { created: handler }, { ...lifecycleOptions, name }),
      update: (name, lifecycleOptions, handler) => on(modelResource, { updated: handler }, { ...lifecycleOptions, name }),
      delete: (name, lifecycleOptions, handler) => on(modelResource, { deleted: handler }, { ...lifecycleOptions, name }),
    });
    return modelResource;
  };
  const on = <TSpec extends object, TStatus extends object = Record<string, never>>(resource: ResourceDefinition<TSpec, TStatus>, handlers: ApplicationResourceEventHandlers<TSpec, TStatus>, options: ApplicationReconcileOptions = {}): ApplicationResourceControllerBinding => {
    const { operator, deployed } = createApplicationResourceEventOperator(resource, handlers, options);
    collectApplicationResources(state, applicationOperatorResources(operator));
    recordApplicationOperatorGraph(state, operator);
    return deployed;
  };
  const reconcile = <TSpec extends object, TStatus extends object = Record<string, never>>(resource: ResourceDefinition<TSpec, TStatus>, handler: ApplicationReconcileHandler<TSpec, TStatus>, options: ApplicationReconcileOptions = {}): ApplicationResourceControllerBinding => on(resource, { reconcile: handler }, options);
  const authority = applicationAuthorityRegistrar(state);
  const scope: KubernetesApplicationScope = {
    // typecast: app.api is the application-context name for the same generated HTTP workload registrar as app.server.
    api: server as ApplicationServerRegistrar & Record<string, ApplicationServerBinding>,
    // typecast: app.http is the v0.3 golden-path name for the same generated HTTP workload registrar as app.server.
    http: server as ApplicationServerRegistrar & Record<string, ApplicationServerBinding>,
    // typecast: the callable server registrar also exposes named server bindings such as app.server.web after registration.
    server: server as ApplicationServerRegistrar & Record<string, ApplicationServerBinding>,
    storage,
    database,
    ...authority,
    operator(operator, options) {
      collectApplicationResources(state, applicationOperatorResources(operator));
      recordApplicationOperatorGraph(state, operator);
      return operator(options);
    },
    resource,
    crd,
    model: ((entityOrName: string | EntityDefinition<object, object> | AnyPgTable, options?: ApplicationModelOptions<object, object> | ApplicationNamedModelOptions<object, object> | ApplicationNativeDrizzleModelOptions<AnyPgTable> | ApplicationNativeAnalyticalDrizzleModelOptions<AnyPgTable>) => {
      if (isTable(entityOrName)) {
        const nativeOptions = options as
          | ApplicationNativeDrizzleModelOptions<AnyPgTable>
          | ApplicationNativeAnalyticalDrizzleModelOptions<AnyPgTable>
          | undefined;
        if (isApplicationNativeAnalyticalModelOptions(nativeOptions)) {
          const promoted = promoteAnalyticalDrizzleTable(entityOrName, {
            ...(nativeOptions.name ? { name: nativeOptions.name } : {}),
            ...(nativeOptions.identity
              ? { identity: nativeOptions.identity }
              : {}),
            ...(nativeOptions.schema ? { schema: nativeOptions.schema } : {}),
          });
          const facet = getApplicationModelFacet(promoted);
          if (!facet || facet.provider !== 'analytical-database') {
            throw new Error(
              `Analytical model ${getTableName(entityOrName)} did not install its analytical facet.`,
            );
          }
          recordApplicationAnalyticalNativeModelGraph(
            state,
            facet as DrizzleAnalyticalApplicationModelFacet<AnyPgTable>,
            nativeOptions.database,
          );
          bindSearch(promoted);
          emitApplicationAnalyticalDatabaseResources(
            state,
            nativeOptions.database,
          );
          bindApplicationModelViews(promoted, (viewName, viewOptions) =>
            registerApplicationModelView(
              state,
              promoted,
              viewName,
              viewOptions,
            ));
          return promoted;
        }
        const transactionalOptions =
          nativeOptions as ApplicationNativeDrizzleModelOptions<AnyPgTable> | undefined;
        const databaseBinding = resolveApplicationDatabase(state, transactionalOptions?.database);
        validateNativeModelAccess(entityOrName, databaseBinding, transactionalOptions?.access);
        const promoted = promoteDrizzleTable(entityOrName, {
          ...transactionalOptions,
          database: databaseBinding.name,
          schema: databaseBinding.schema,
        });
        const promotedFacet = getRequiredDrizzleApplicationModelFacet(promoted);
        const promotedApi = promotedFacet.api;
        const runtimeModel = applicationNativeRuntimeModelContract(promoted, databaseBinding);
        emitApplicationTransactionalDatabaseResources(state, runtimeModel, databaseBinding.provider);
        recordApplicationNativeModelGraph(state, promotedFacet, databaseBinding.provider, runtimeModel, databaseBinding.migrations ? { artifact: databaseBinding.migrations.path, ...(databaseBinding.migrations.digest ? { digest: databaseBinding.migrations.digest } : {}) } : {});
        bindSearch(promoted);
        state.models[runtimeModel.name] = runtimeModel;
        const commandModel = applicationNativeCommandModelBinding(promoted, runtimeModel);
        bindNativeApplicationModelBinding(promoted, commandModel as ApplicationModelBinding<object, object>);
        bindApplicationModelViews(promoted, (viewName, viewOptions) => registerApplicationModelView(state, promoted, viewName, viewOptions));
        bindNativeApplicationModelCommands(promoted, (command, commandOptions, handler) => recordApplicationModelCommandGraph(
          state,
          commandModel,
          command,
          commandOptions,
          handler,
        ));
        bindApplicationNativeCreateOperation(state, promoted, commandModel, transactionalOptions?.processor);
        bindApplicationNativeUpdateOperation(state, promoted, commandModel, transactionalOptions?.processor);
        bindApplicationNativeDeleteOperation(state, promoted, commandModel, transactionalOptions?.processor);
        let createPolicyInstalled = false;
        let updatePolicyInstalled = false;
        let deletePolicyInstalled = false;
        bindNativeApplicationModelBeforeCommit(promotedApi.create, (policyOptions, policyHandler) => {
          if (createPolicyInstalled) throw new Error(`Model ${promotedFacet.name}.create.beforeCommit(...) may be declared only once.`);
          createPolicyInstalled = true;
          const commandId = applicationNativeCreateContracts(promoted).command.id;
          prepareApplicationModelCommandReplacement(state, promotedFacet.name, commandId);
          bindApplicationNativeCreateOperation(state, promoted, commandModel, transactionalOptions?.processor, { options: policyOptions, handler: policyHandler });
        });
        bindNativeApplicationModelBeforeCommit(promotedApi.update, (policyOptions, policyHandler) => {
          if (updatePolicyInstalled) throw new Error(`Model ${promotedFacet.name}.update.beforeCommit(...) may be declared only once.`);
          updatePolicyInstalled = true;
          const commandId = applicationNativeUpdateContracts(promoted).command.id;
          prepareApplicationModelCommandReplacement(state, promotedFacet.name, commandId);
          bindApplicationNativeUpdateOperation(state, promoted, commandModel, transactionalOptions?.processor, { options: policyOptions, handler: policyHandler });
        });
        bindNativeApplicationModelBeforeCommit(promotedApi.delete, (policyOptions, policyHandler) => {
          if (deletePolicyInstalled) throw new Error(`Model ${promotedFacet.name}.delete.beforeCommit(...) may be declared only once.`);
          deletePolicyInstalled = true;
          const commandId = applicationNativeDeleteContracts(promoted).command.id;
          prepareApplicationModelCommandReplacement(state, promotedFacet.name, commandId);
          bindApplicationNativeDeleteOperation(state, promoted, commandModel, transactionalOptions?.processor, { options: policyOptions, handler: policyHandler });
        });
        bindNativeApplicationModelLifecycle(promoted, {
          create: (lifecycleName, lifecycleOptions, lifecycleHandler) => registerApplicationNativeCreateProcessor(
            state,
            promoted,
            databaseBinding,
            lifecycleName,
            lifecycleOptions,
            lifecycleHandler,
          ),
          update: (lifecycleName, lifecycleOptions, lifecycleHandler) => registerApplicationNativeUpdateProcessor(
            state,
            promoted,
            databaseBinding,
            lifecycleName,
            lifecycleOptions,
            lifecycleHandler,
          ),
          delete: (lifecycleName, lifecycleOptions, lifecycleHandler) => registerApplicationNativeDeleteProcessor(
            state,
            promoted,
            databaseBinding,
            lifecycleName,
            lifecycleOptions,
            lifecycleHandler,
          ),
        });
        bindNativeApplicationModelActionEvents(promoted, (definition, processorName, processorOptions, processorHandler) => registerApplicationNativeActionProcessor(
          state,
          databaseBinding,
          definition,
          processorName,
          processorOptions,
          processorHandler,
        ));
        return promoted;
      }
      const { entity, modelOptions } = applicationModelInput(
        entityOrName as EntityDefinition<object, object> | string,
        options as ApplicationModelOptions<object, object> | ApplicationNamedModelOptions<object, object> | undefined,
      );
      // typecast: the native Drizzle overload returned above, so this branch contains only named/entity model options.
      const configuredModel = modelOptions as ApplicationModelOptions<object, object> | ApplicationNamedModelOptions<object, object> | undefined;
      const transactionalDatabase = resolveApplicationTransactionalDatabase(state, entity.name, configuredModel?.database);
      const runtimeModel = applicationRuntimeModelContract(entity, transactionalDatabase, modelOptions);
      emitApplicationTransactionalDatabaseResources(state, runtimeModel, transactionalDatabase);
      recordApplicationModelGraph(state, entity, transactionalDatabase, modelOptions, runtimeModel);
      const model = applicationModelBindingWithCommandGraph(
        state,
        entity,
        transactionalDatabase,
        modelOptions,
        runtimeModel,
      );
      state.models[runtimeModel.name] = runtimeModel;
      return model;
    }) as KubernetesApplicationScope['model'],
    index(name, options, ...fields) {
      const facet = getApplicationModelFacet(options.root);
      if (!facet) {
        throw new Error(
          'application.index(...) root must be a promoted model registered through app.model(...) or app.crd(...).',
        );
      }
      if (options.identity !== undefined) {
        const identityField = facet.identity.fields[0];
        const canonicalIdentity = identityField
          ? Reflect.get(options.root, identityField)
          : undefined;
        if (options.identity !== canonicalIdentity) {
          throw new Error(
            `application.index(${JSON.stringify(name)}, ...) identity must be the root model's canonical ${identityField ?? 'identity'} field until an explicit composite/custom identity codec is declared.`,
          );
        }
      }
      let registrar = applicationSearchIndexRegistrar(options.root);
      if (!registrar) {
        bindSearch(options.root);
        registrar = applicationSearchIndexRegistrar(options.root);
      }
      if (!registrar) {
        throw new Error(
          `application.index(${JSON.stringify(name)}, ...) could not register its root model.`,
        );
      }
      return registrar(options.root, name, fields, {
        ...(options.provider ? { provider: options.provider } : {}),
        ...(options.fanOutCeiling
          ? { fanOutCeiling: options.fanOutCeiling }
          : {}),
        ...(options.authorizationFields
          ? { authorizationFields: options.authorizationFields }
          : {}),
        ...(options.requiredCapabilities
          ? { requiredCapabilities: options.requiredCapabilities }
          : {}),
      });
    },
    query(id, options) {
      return registerApplicationQuery(state, id, options);
    },
    stream(definition, options) {
      let binding: ApplicationStreamBinding<typeof definition extends StreamDefinition<infer TPayload> | EventDefinition<infer TPayload> ? TPayload : never>;
      binding = registerApplicationStream(state, definition, options, {
        project: ((name: string, projectionOptions: Omit<ApplicationAnalyticalProjectionOptions<object, object>, 'source'> | Omit<ApplicationOnlineProjectionOptions<object, object, object>, 'source'>) => {
          if (!('store' in projectionOptions)) emitApplicationAnalyticalDatabaseResources(state, projectionOptions.provider ?? state.providers.analytics ?? state.defaults.analytics);
          // typecast: the overload discriminant is preserved by spreading the stream source into the selected analytical/online option branch.
          return registerApplicationProjection(state, name, { ...projectionOptions, source: binding } as never);
        }) as unknown as ApplicationStreamBinding<typeof definition extends StreamDefinition<infer TPayload> | EventDefinition<infer TPayload> ? TPayload : never>['project'],
        subscribe(name, subscriptionOptions) {
          return registerApplicationSubscription(state, name, { ...subscriptionOptions, source: binding });
        },
        process(name, processOptions, handler) {
          return registerApplicationStreamProcessor(state, name, binding, processOptions, handler);
        },
      });
      return binding;
    },
    subscription(name, options) {
      return registerApplicationSubscription(state, name, options);
    },
    projection: ((name: string, options: ApplicationProjectionOptions<object, object, object>) => {
      if (!('store' in options)) emitApplicationAnalyticalDatabaseResources(state, options.provider ?? state.providers.analytics ?? state.defaults.analytics);
      // typecast: the public projection overload has already selected the discriminated option branch.
      return registerApplicationProjection(state, name, options as never);
    }) as KubernetesApplicationScope['projection'],
    install<TSpec extends KroCompatibleType, TStatus extends KroCompatibleType>(
      application: KubernetesApplicationBuilder<TSpec, TStatus>,
      options: ApplicationInstallOptions<TSpec>,
    ): ApplicationInstallBinding<TSpec, TStatus> {
      if (!application || typeof application !== 'object' || typeof application.composition !== 'function') {
        throw new Error('app.install(...) requires an installable Application builder as its first argument.');
      }
      if (!options || typeof options !== 'object' || !options.spec || typeof options.spec !== 'object') {
        throw new Error(`app.install(${application.name}, ...) requires a typed spec object.`);
      }
      const name = options.name?.trim() || application.name;
      const resource = application.composition(options.spec);
      if (options.dependsOn !== undefined) {
        resource.dependsOn(options.dependsOn);
      }
      recordApplicationNestedInstallGraph(state, name, application);
      return {
        kind: 'applicationInstall',
        name,
        application: {
          name: application.name,
          apiVersion: application.installation.apiVersion,
          kind: application.installation.kind,
        },
        spec: options.spec,
        status: resource.status,
        resource,
      };
    },
    objectStore(name, options) {
      return registerApplicationObjectStore(state, name, options);
    },
    gateway(name, options) {
      return registerApplicationGateway(state, name, options, definition.name);
    },
    on,
    reconcile,
    infra(resourceOrFactory, options) {
      const resource = typeof resourceOrFactory === 'function' ? resourceOrFactory() : resourceOrFactory;
      recordApplicationTypeKroResourceGraph(state, resource, options?.name);
      return resource;
    },
    config(name, options) {
      return emitApplicationConfig(state, name, options);
    },
    secret(name, options) {
      return emitApplicationSecret(state, name, options);
    },
    expose(name, options) {
      return emitApplicationExposure(state, name, options);
    },
    job(name, options) {
      return emitApplicationGeneratedJob(state, name, options ?? {}, undefined, applicationBindingPlan);
    },
    schedule(name, options) {
      return emitApplicationGeneratedJob(state, name, options ?? {}, options?.cron ?? '* * * * *', applicationBindingPlan);
    },
    defaults,
    provide,
    aggregate(name, options) {
      collectApplicationIndexes(state, { [options.source.name]: options.source });
      recordApplicationAggregateGraph(state, name, options);
      const workload = emitApplicationAggregateResources(name, options);
      return applicationAggregateBinding(name, options, workload);
    },
    task(definition, options, handler) {
      return registerApplicationTask(state, definition, options, handler);
    },
    workflow(definition, options, handler) {
      return registerApplicationWorkflow(state, definition, options, handler);
    },
    // typecast-boundary: these generic helpers return TypeKro expression proxies
    // typed as the selected scalar, matching the public graph DSL contract.
    select: applicationGraphSelect as KubernetesApplicationScope['select'],
    selectProvider: applicationGraphProviderSelection as KubernetesApplicationScope['selectProvider'],
    when: applicationGraphWhen as KubernetesApplicationScope['when'],
    any: applicationGraphAny,
    all: applicationGraphAll,
    interpolate: applicationGraphInterpolate,
  };
  applicationStateByScope.set(scope, state);
  return { scope, state };
}

function applicationGraphSelect<TInput extends string, TOutput extends ApplicationGraphScalar>(
  input: TInput,
  cases: Partial<Record<TInput, TOutput>> & { readonly default: TOutput },
): TOutput {
  const inputExpression = applicationTypeKroExpressionValue(input);
  if (!inputExpression) {
    const selected = Object.hasOwn(cases, input) ? cases[input] : cases.default;
    if (selected === undefined) throw new Error(`Application graph selection has no value for ${JSON.stringify(input)} and no default.`);
    return selected;
  }
  const entries = Object.entries(cases).filter(([key]) => key !== 'default') as [string, TOutput][];
  const expression = entries.reduceRight(
    (otherwise, [key, value]) => `${inputExpression} == ${JSON.stringify(key)} ? ${applicationGraphScalarExpression(value)} : (${otherwise})`,
    applicationGraphScalarExpression(cases.default),
  );
  return Cel.expr<TOutput>(expression);
}

export interface ApplicationProviderSelection<TImplementation> {
  readonly kind: 'application-provider-selection';
  readonly selector: string;
  readonly cases: Readonly<Record<string, TImplementation>>;
  readonly default: TImplementation;
}

function applicationGraphProviderSelection<TImplementation>(
  input: string,
  cases: Readonly<Record<string, TImplementation>> & { readonly default: TImplementation },
): TImplementation {
  const selector = applicationTypeKroExpressionValue(input);
  if (!selector) {
		const selected = cases[input];
		return Object.hasOwn(cases, input) && selected !== undefined ? selected : cases.default;
	}
  const { default: fallback, ...branches } = cases;
  // typecast-boundary: app.provide validates every branch before recording the
  // deferred selection, while callers retain the token's implementation type.
  return {
    kind: 'application-provider-selection',
    selector,
    cases: branches,
    default: fallback,
  } as unknown as TImplementation;
}

function recordApplicationProfileSelectionGraph(
  state: ApplicationGraphState,
  profile: ApplicationProfileProviderSelectionContract,
): void {
  const providerNodeId = applicationProviderGraphNodeId(
    profile.qualification.capability,
    profile.qualification,
  );
  const index = state.graphNodes.findIndex(
    (node) => node.kind === 'provider' && node.id === providerNodeId,
  );
  const provider = index >= 0 ? state.graphNodes[index] : undefined;
  if (!provider || provider.kind !== 'provider') {
    throw new Error(
      `Application profile ${profile.profileId} could not find provider ${profile.qualification.capability}.`,
    );
  }
  addApplicationGraphNode(state, {
    ...provider,
    config: {
      ...(provider.config ?? {}),
      qualification: profile.qualification as unknown as JsonObject,
      profile: profile as unknown as JsonObject,
    },
  });
}

function applicationProfileProviderWithNamespace<TImplementation>(
  token: ApplicationProviderToken<TImplementation>,
  implementation: TImplementation,
  namespace: string | undefined,
): TImplementation {
  if (
    !namespace
    || (
      token.name !== 'TransactionalDatabase'
      && token.name !== 'AnalyticalDatabase'
    )
  ) {
    return implementation;
  }
  const withNamespace = (candidate: unknown): unknown =>
    candidate
    && typeof candidate === 'object'
    && !Reflect.get(candidate, 'namespace')
      ? { ...candidate, namespace }
      : candidate;
  if (isApplicationProviderSelection(implementation)) {
    return {
      ...implementation,
      cases: Object.fromEntries(
        Object.entries(implementation.cases).map(([variant, candidate]) => [
          variant,
          withNamespace(candidate),
        ]),
      ),
      default: withNamespace(implementation.default),
    } as TImplementation;
  }
  return withNamespace(implementation) as TImplementation;
}

function applicationGraphWhen<TOutput extends ApplicationGraphScalar>(
  condition: boolean,
  branches: { readonly then: TOutput; readonly otherwise: TOutput },
): TOutput {
  const conditionExpression = applicationTypeKroExpressionValue(condition);
  if (!conditionExpression) return condition ? branches.then : branches.otherwise;
  return Cel.expr<TOutput>(`${conditionExpression} ? ${applicationGraphScalarExpression(branches.then)} : (${applicationGraphScalarExpression(branches.otherwise)})`);
}

function applicationGraphAny(...conditions: readonly boolean[]): boolean {
  return applicationGraphBoolean('||', false, conditions);
}

function applicationGraphAll(...conditions: readonly boolean[]): boolean {
  return applicationGraphBoolean('&&', true, conditions);
}

function applicationGraphBoolean(operator: '&&' | '||', identity: boolean, conditions: readonly boolean[]): boolean {
  if (conditions.length === 0) return identity;
  const expressions = conditions.map((condition) => applicationTypeKroExpressionValue(condition));
  if (expressions.every((expression) => expression === undefined)) {
    return operator === '&&' ? conditions.every(Boolean) : conditions.some(Boolean);
  }
  return Cel.expr<boolean>(conditions.map((condition, index) => {
    const expression = expressions[index];
    return expression ? `(${expression})` : JSON.stringify(condition);
  }).join(` ${operator} `));
}

function applicationGraphInterpolate(
  strings: TemplateStringsArray,
  ...values: readonly ApplicationGraphScalar[]
): string {
  const parts: unknown[] = [];
  for (let index = 0; index < strings.length; index += 1) {
    parts.push(strings[index] ?? '');
    if (index < values.length) parts.push(values[index]);
  }
  return applicationTypeKroString(...parts);
}

function applicationGraphScalarExpression(value: ApplicationGraphScalar): string {
  const dynamic = applicationTypeKroExpressionValue(value);
  if (dynamic) return dynamic;
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Application graph scalar values must be finite.');
  return JSON.stringify(value);
}

function recordApplicationNestedInstallGraph<TSpec extends KroCompatibleType, TStatus extends KroCompatibleType>(
  state: ApplicationScopeState,
  name: string,
  application: KubernetesApplicationBuilder<TSpec, TStatus>,
): void {
  addApplicationGraphNode(state, {
    id: applicationGraphNodeId('installation', name),
    kind: 'installation',
    name,
    stability: 'experimental',
    application: {
      name: application.name,
      apiVersion: application.installation.apiVersion,
      kind: application.installation.kind,
    },
    materialization: 'nestedTypeKroComposition',
  });
}

function applicationModelBindingWithCommandGraph<TSpec extends object, TStatus extends object>(
  state: ApplicationScopeState,
  entity: EntityDefinition<TSpec, TStatus>,
  transactionalDatabase: ApplicationTransactionalDatabaseProvider,
  modelOptions: ApplicationModelOptions<TSpec, TStatus> | undefined,
  runtimeModel: ApplicationRuntimeModelContract,
): ApplicationModelBinding<TSpec, TStatus> {
  let binding: ApplicationModelBinding<TSpec, TStatus>;
  binding = applicationModelBinding(
    entity,
    transactionalDatabase,
    modelOptions,
    runtimeModel,
    (command, commandOptions, handler) => recordApplicationModelCommandGraph(state, binding, command, commandOptions, handler),
  );
  return binding;
}

function applicationStoragePostgresOptions(name: string, options: ApplicationStoragePostgresOptions): ApplicationPostgresTransactionalDatabaseOptions {
  const { migrations, ...rest } = options;
  const normalizedMigrations = applicationStoragePostgresMigrations(migrations);
  return {
    ...rest,
    name,
    ...(normalizedMigrations ? { migrations: normalizedMigrations } : {}),
  };
}

function applicationDefinitionApiVersion(definition: { readonly apiVersion?: string }): string {
  if (!definition.apiVersion) {
    throw new Error('app.resource(...) requires apiVersion when the enclosing app definition does not declare one.');
  }
  return definition.apiVersion;
}

function applicationStoragePostgresMigrations(migrations: ApplicationStoragePostgresOptions['migrations']): ApplicationPostgresTransactionalDatabaseOptions['migrations'] | undefined {
  if (migrations === undefined) {
    return undefined;
  }
  if (migrations === 'generated-job' || migrations === 'generatedJob') {
    return TransactionalDatabase.migrations.generatedJob();
  }
  if (typeof migrations === 'string') {
    throw new Error(`app.database.postgres(..., { migrations: ${JSON.stringify(migrations)} }) is not supported. Use "generated-job" or TransactionalDatabase.migrations.generatedJob(...) for the generated migration job path.`);
  }
  return migrations;
}

function applicationModelInput<TSpec extends object, TStatus extends object>(entityOrName: EntityDefinition<TSpec, TStatus> | string, options: ApplicationModelOptions<TSpec, TStatus> | ApplicationNamedModelOptions<TSpec, TStatus> | undefined): { readonly entity: EntityDefinition<TSpec, TStatus>; readonly modelOptions: ApplicationModelOptions<TSpec, TStatus> | undefined } {
  if (typeof entityOrName !== 'string') {
    // typecast: non-string app.model input is the entity overload, so options are plain model options.
    return { entity: entityOrName, modelOptions: options as ApplicationModelOptions<TSpec, TStatus> | undefined };
  }
  if (!options || !('spec' in options)) {
    throw new Error(`app.model(${JSON.stringify(entityOrName)}, ...) requires a spec schema when using the golden-path named model form.`);
  }
  // typecast: string app.model input is validated above to include the named-model spec schema.
  const namedOptions = options as ApplicationNamedModelOptions<TSpec, TStatus>;
  const entity: EntityDefinition<TSpec, TStatus> = {
    kind: 'applik8sEntity',
    name: entityOrName,
    spec: namedOptions.spec,
    ...(namedOptions.status ? { status: namedOptions.status } : {}),
  };
  return { entity, modelOptions: applicationNamedModelOptions(namedOptions) };
}

function applicationNamedModelOptions<TSpec extends object, TStatus extends object>(options: ApplicationNamedModelOptions<TSpec, TStatus>): ApplicationModelOptions<TSpec, TStatus> {
  const { spec: _spec, status: _status, indexes, schema, ...rest } = options;
  const schemaIndexes = applicationNamedModelSchemaIndexes(indexes);
  if (schemaIndexes.length === 0) {
    return { ...rest, ...(schema ? { schema } : {}) };
  }
  return {
    ...rest,
    schema: {
      ...schema,
      indexes: [...(schema?.indexes ?? []), ...schemaIndexes],
    },
  };
}

function applicationNamedModelSchemaIndexes<TSpec extends object, TStatus extends object>(indexes: ApplicationNamedModelOptions<TSpec, TStatus>['indexes']): ApplicationModelSchemaIndexOptions<TSpec, TStatus>[] {
  if (!indexes) {
    return [];
  }
  return Object.entries(indexes).map(([name, declaration]) => {
    if (isNamedModelIndexFieldList<TSpec, TStatus>(declaration)) {
      const [partitionBy, ...orderBy] = declaration;
      if (!partitionBy) {
        throw new Error(`app.model(..., { indexes: { ${name}: [...] } }) requires at least one field.`);
      }
      return { name, partitionBy, ...(orderBy.length > 0 ? { orderBy } : {}) };
    }
    const fields = declaration.fields ?? [];
    const partitionBy = declaration.partitionBy ?? fields[0];
    if (!partitionBy) {
      throw new Error(`app.model(..., { indexes: { ${name}: ... } }) requires partitionBy or at least one field.`);
    }
    const orderBy = declaration.orderBy ?? fields.slice(1);
    return {
      name,
      partitionBy,
      ...(declaration.filter ? { filter: declaration.filter } : {}),
      ...(orderBy.length > 0 ? { orderBy } : {}),
      ...(declaration.unique !== undefined ? { unique: declaration.unique } : {}),
    };
  });
}

function isNamedModelIndexFieldList<TSpec extends object, TStatus extends object>(declaration: NonNullable<ApplicationNamedModelOptions<TSpec, TStatus>['indexes']>[string]): declaration is readonly string[] {
  return Array.isArray(declaration);
}

function withApplicationOperatorResourceCollection<T>(state: ApplicationScopeState, fn: () => T): T {
  const restore = setOperatorDeploymentInterceptor((definition, _deployment, next) => {
    // typecast: app-scoped server inference only needs erased resource metadata, not capability-specific handler clients.
    collectApplicationResources(state, definition.resources as unknown as Readonly<Record<string, AnyResourceDefinition>>);
    return next();
  });
  try {
    return fn();
  } finally {
    restore();
  }
}

function applicationServerOptionsWithScope(state: ApplicationScopeState, options: ApplicationServerOptions, routes: readonly ApplicationServerRoute[]): ApplicationServerOptions {
  const routeAnalyses = routes.map((route) => analyzeApplicationServerRouteSource(route.handlerSource));
  const inferredResources = inferredApplicationServerResources(state.resources, routeAnalyses);
  const cacheIndexes = options.cache ?? [];
  const inferredIndexes = {
    ...inferredApplicationServerIndexes(state.indexes, routeAnalyses),
    ...inferredApplicationServerIndexesFromCache(cacheIndexes, routeAnalyses, state.indexes, options.indexes ?? {}),
  };
  const inferredModels = inferredApplicationServerModels(state.models, routeAnalyses);
  const resources = { ...inferredResources, ...(options.resources ?? {}) };
  const indexes = { ...inferredIndexes, ...(options.indexes ?? {}) };
  const models = { ...inferredModels, ...applicationServerRuntimeModels(options.models ?? {}) };
  const indexBackend = options.indexBackend ?? defaultApplicationIndexBackend(state, options, indexes);
  const cache = options.cache ?? (indexBackend && isValkeyIndexDefault(defaultApplicationIndexProvider(state)) ? Object.values(indexes) : undefined);
  return {
    ...options,
    ...(Object.keys(resources).length > 0 ? { resources } : {}),
    ...(Object.keys(indexes).length > 0 ? { indexes } : {}),
    ...(Object.keys(models).length > 0 ? { models } : {}),
    ...(cache && cache.length > 0 ? { cache } : {}),
    ...(indexBackend ? { indexBackend } : {}),
  };
}

function applicationServerRuntimeModels(models: Readonly<Record<string, ApplicationServerModelBinding>>): Readonly<Record<string, ApplicationRuntimeModelContract>> {
  return Object.fromEntries(Object.entries(models).map(([name, model]) => [name, applicationServerRuntimeModel(model)]));
}

function applicationServerRuntimeModel(model: ApplicationServerModelBinding): ApplicationRuntimeModelContract {
  if ('provider' in model) {
    return model;
  }
  return model.runtime;
}

function inferredApplicationServerResources(resources: Readonly<Record<string, AnyResourceDefinition>>, analyses: readonly ApplicationServerRouteSourceAnalysis[]): Readonly<Record<string, AnyResourceDefinition>> {
  return Object.fromEntries(Object.entries(resources).filter(([name]) => analyses.some((analysis) => analysis.freeIdentifiers.includes(name) || analysis.memberCalls.some((call) => call.objectName === name))));
}

function inferredApplicationServerIndexes(indexes: Readonly<Record<string, ResourceIndex<object, object>>>, analyses: readonly ApplicationServerRouteSourceAnalysis[]): Readonly<Record<string, ResourceIndex<object, object>>> {
  return Object.fromEntries(Object.entries(indexes).filter(([name]) => analyses.some((analysis) => analysis.freeIdentifiers.includes(name) || routeAnalysisCallsMethod(analysis, name, 'query'))));
}

function inferredApplicationServerModels(models: Readonly<Record<string, ApplicationRuntimeModelContract>>, analyses: readonly ApplicationServerRouteSourceAnalysis[]): Readonly<Record<string, ApplicationRuntimeModelContract>> {
  return Object.fromEntries(Object.entries(models).filter(([name]) => analyses.some((analysis) => analysis.freeIdentifiers.includes(name) || ['create', 'get', 'query', 'patch', 'delete', 'index'].some((method) => routeAnalysisCallsMethod(analysis, name, method)))));
}

function inferredApplicationServerIndexesFromCache(
  cache: readonly ResourceIndex<object, object>[],
  analyses: readonly ApplicationServerRouteSourceAnalysis[],
  scopedIndexes: Readonly<Record<string, ResourceIndex<object, object>>>,
  explicitIndexes: Readonly<Record<string, ResourceIndex<object, object>>>
): Readonly<Record<string, ResourceIndex<object, object>>> {
  const existingNames = new Set([...Object.keys(scopedIndexes), ...Object.keys(explicitIndexes)]);
  const queryNames = unique(analyses.flatMap((analysis) => analysis.memberCalls.filter((call) => call.methodName === 'query').map((call) => call.objectName))).filter((name) => !existingNames.has(name));
  if (cache.length === 1 && queryNames.length === 1) {
    const [index] = cache;
    const [name] = queryNames;
    return index && name ? { [name]: index } : {};
  }
  const inferred: Record<string, ResourceIndex<object, object>> = {};
  for (const name of queryNames) {
    const match = cache.find((index) => index.name === name);
    if (match) {
      inferred[name] = match;
    }
  }
  return inferred;
}

function collectApplicationResources(state: ApplicationScopeState, resources: Readonly<Record<string, AnyResourceDefinition>>): void {
  for (const [name, resource] of Object.entries(resources)) {
    state.resources[name] = resource;
    recordApplicationCrdGraph(state, name, resource);
  }
}

function collectApplicationIndexes(state: ApplicationScopeState, indexes: Readonly<Record<string, ResourceIndex<object, object>>>): void {
  for (const [name, index] of Object.entries(indexes)) {
    state.indexes[name] = index;
    recordApplicationIndexGraph(state, name, index);
  }
}

function recordApplicationOperatorGraph(state: ApplicationScopeState, operator: unknown): void {
  const definition = operator && typeof operator === 'function' ? Reflect.get(operator, 'definition') : undefined;
  const reflectedName = definition && typeof definition === 'object' ? Reflect.get(definition, 'name') : undefined;
  const name = typeof reflectedName === 'string' ? reflectedName : 'operator';
  const resources = applicationOperatorResources(operator);
  const watchContracts = applicationOperatorWatchScopeContracts(name, applicationOperatorHandlers(operator));
  const nodeId = applicationGraphNodeId('operator', name);
  addApplicationGraphNode(state, {
    id: nodeId,
    kind: 'operator',
    name,
    stability: 'experimental',
    resources: Object.values(resources).map((resource) => applicationResourceRef(resource)),
    watches: watchContracts.map((contract) => contract.scope),
    ...(watchContracts.length > 0 ? { watchContracts } : {}),
  });
  const explicitPermissions = definition && typeof definition === 'object' ? Reflect.get(definition, 'permissions') : undefined;
  if (Array.isArray(explicitPermissions) && explicitPermissions.length > 0) {
    const permissionNodeId = applicationGraphNodeId('permission', `${name}-permissions`);
    // typecast: sdk.operator has already validated the structural PermissionRule array stored on its definition.
    const rules = explicitPermissions as readonly PermissionRule[];
    addApplicationGraphNode(state, {
      id: permissionNodeId,
      kind: 'permission',
      name: `${name}-permissions`,
      stability: 'experimental',
      owner: { nodeId },
      mode: 'explicit',
      rules: rules.map((rule) => ({
        apiGroups: [...rule.apiGroups],
        resources: [...rule.resources],
        verbs: [...rule.verbs],
        ...(rule.resourceNames ? { resourceNames: [...rule.resourceNames] } : {}),
      })),
    });
    addApplicationGraphEdge(state, { from: { nodeId: permissionNodeId }, to: { nodeId }, relationship: 'writes' });
  }
  for (const [resourceName] of Object.entries(resources)) {
    addApplicationGraphEdge(state, { from: { nodeId }, to: { nodeId: applicationGraphNodeId('crd', resourceName) }, relationship: 'owns' });
  }
}

function recordApplicationServerGraph(state: ApplicationScopeState, name: string, options: ApplicationServerOptions, routes: readonly ApplicationServerRoute[]): void {
  const nodeId = applicationGraphNodeId('server', name);
  const resourceName = options.resourceName ?? name;
  const serviceName = options.serviceName ?? resourceName;
  const serviceAccountName = options.serviceAccountName ?? resourceName;
  const sourceConfigMapName = options.sourceConfigMapName ?? `${resourceName}-source`;
  const indexRefs = Object.keys(options.indexes ?? {}).map((indexName) => ({ nodeId: applicationGraphNodeId('index', indexName) }));
  const configRefs = applicationConfigBindings(options.config).map((binding) => ({ nodeId: applicationGraphNodeId('config', binding.name) }));
  const secretRefs = applicationSecretBindings(options.secrets).map((binding) => ({ nodeId: applicationGraphNodeId('secret', binding.name) }));
  for (const [resourceName, resource] of Object.entries(options.resources ?? {})) {
    recordApplicationCrdGraph(state, resourceName, resource);
  }
  const generatedResources: ApplicationGeneratedResourceContract[] = [
    { role: 'workload', graphNode: { nodeId }, resource: { apiVersion: 'apps/v1', kind: 'Deployment', name: resourceName, ...(options.namespace ? { namespace: options.namespace } : {}) }, artifact: { kind: 'kubernetesManifest', name: `${resourceName}.yaml` } },
    { role: 'service', graphNode: { nodeId }, resource: { apiVersion: 'v1', kind: 'Service', name: serviceName, ...(options.namespace ? { namespace: options.namespace } : {}) }, artifact: { kind: 'kubernetesManifest', name: `${serviceName}.yaml` } },
    { role: 'rbac', graphNode: { nodeId }, resource: { apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'Role', name: serviceAccountName, ...(options.namespace ? { namespace: options.namespace } : {}) }, artifact: { kind: 'rbacManifest', name: `${serviceAccountName}.yaml` } },
    { role: 'runtimeBundle', graphNode: { nodeId }, resource: { apiVersion: 'v1', kind: 'ConfigMap', name: sourceConfigMapName, ...(options.namespace ? { namespace: options.namespace } : {}) }, artifact: { kind: 'runtimeBundle', name: sourceConfigMapName } },
    { role: 'routeDiagnostics', graphNode: { nodeId }, resource: { apiVersion: 'v1', kind: 'ConfigMap', name: sourceConfigMapName, ...(options.namespace ? { namespace: options.namespace } : {}) }, artifact: { kind: 'routeDiagnostics', name: sourceConfigMapName } },
    ...applicationConfigBindings(options.config).map<ApplicationGeneratedResourceContract>((binding) => ({ role: 'config', graphNode: { nodeId }, resource: { apiVersion: 'v1', kind: 'ConfigMap', name: binding.resourceName, ...(binding.namespace ? { namespace: binding.namespace } : {}) }, dependsOn: [{ nodeId: applicationGraphNodeId('config', binding.name) }] })),
    ...applicationSecretBindings(options.secrets).map<ApplicationGeneratedResourceContract>((binding) => ({ role: 'secret', graphNode: { nodeId }, resource: { apiVersion: 'v1', kind: 'Secret', name: binding.resourceName, ...(binding.namespace ? { namespace: binding.namespace } : {}) }, dependsOn: [{ nodeId: applicationGraphNodeId('secret', binding.name) }] })),
  ];
  addApplicationGraphNode(state, {
    id: nodeId,
    kind: 'server',
    name,
    stability: 'stable',
    routes: routes.map((route) => ({
      id: route.id,
      named: route.named,
      method: route.method,
      path: route.path,
      ...(route.authority ? { authority: route.authority } : {}),
      diagnostics: routeDiagnosticsContract(),
      ...(route.handlerSourceLocation ? { sourceLocation: route.handlerSourceLocation } : {}),
    })),
    resources: Object.values(options.resources ?? {}).map((resource) => applicationResourceRef(resource)),
    indexes: indexRefs,
    observability: applicationServerObservability(sourceConfigMapName),
    ...(generatedResources.length > 0 ? { generatedResources } : {}),
  });
  for (const resourceName of Object.keys(options.resources ?? {})) {
    addApplicationGraphEdge(state, { from: { nodeId }, to: { nodeId: applicationGraphNodeId('crd', resourceName) }, relationship: 'dependsOn' });
  }
  for (const [indexName, index] of Object.entries(options.indexes ?? {})) {
    recordApplicationIndexGraph(state, indexName, index);
    addApplicationGraphEdge(state, { from: { nodeId }, to: { nodeId: applicationGraphNodeId('index', indexName) }, relationship: 'reads' });
  }
  for (const ref of configRefs) {
    addApplicationGraphEdge(state, { from: { nodeId }, to: ref, relationship: 'reads' });
  }
  for (const ref of secretRefs) {
    addApplicationGraphEdge(state, { from: { nodeId }, to: ref, relationship: 'reads' });
  }
  recordApplicationCounterGraphs(state, name, options.resources ?? {}, routes);
  const permissions = inferApplicationServerPermissions({ routes, resources: options.resources ?? {}, indexes: options.indexes ?? {}, indexBackend: runtimeIndexBackendConfig(options.indexBackend, options.namespace, options.resourceName ?? name), cache: options.cache ?? [], explicit: options.permissions ?? [] });
  if (permissions.length > 0) {
    const permissionNodeId = applicationGraphNodeId('permission', `${name}-permissions`);
    addApplicationGraphNode(state, { id: permissionNodeId, kind: 'permission', name: `${name}-permissions`, stability: 'experimental', owner: { nodeId }, mode: options.permissions && options.permissions.length > 0 ? 'explicitAndInferred' : 'inferred', rules: permissions });
    addApplicationGraphEdge(state, { from: { nodeId: permissionNodeId }, to: { nodeId }, relationship: 'writes' });
  }
}

function applicationServerObservability(diagnosticsArtifactName: string): ApplicationObservabilityContract {
  return {
    health: { mode: 'http', readinessPath: '/-/healthz', livenessPath: '/-/healthz' },
    logs: { format: 'json', component: 'applik8s-server', failureEvents: ['applik8s-server-route-failure', 'applik8s-server-request-failure'] },
    metrics: { mode: 'declaredHooks', names: ['applik8s_server_requests_total', 'applik8s_server_route_failures_total'] },
    events: ['applik8s-server-route-failure', 'applik8s-server-request-failure'],
    sourceMaps: 'required',
    replayArtifacts: [{ kind: 'routeDiagnostics', name: diagnosticsArtifactName }],
    diagnosticsArtifact: { kind: 'routeDiagnostics', name: diagnosticsArtifactName },
  };
}

function routeDiagnosticsContract() {
  // typecast: preserve literal diagnostic field names for graph contract emission.
  return {
    routeFailureEvent: 'applik8s-server-route-failure',
    actionFailureEvent: 'applik8s-route-action-failure',
    failurePolicy: 'failClosed',
    partialEffects: 'unknownAfterActionStarted',
    sourceMaps: 'required',
    includes: ['routeId', 'method', 'path', 'module', 'sourceLocation', 'bundleInputs', 'action', 'diagnostic', 'stack'],
  } as const;
}

function recordApplicationCounterGraphs(state: ApplicationScopeState, serverName: string, resources: Readonly<Record<string, AnyResourceDefinition>>, routes: readonly ApplicationServerRoute[]): void {
  const analyses = routes.map((route) => analyzeApplicationServerRouteSource(route.handlerSource));
  const serverNodeId = applicationGraphNodeId('server', serverName);
  for (const [resourceName, resource] of Object.entries(resources)) {
    if (!analyses.some((analysis) => routeAnalysisCallsMethod(analysis, resourceName, 'increment'))) {
      continue;
    }
    const nodeId = applicationGraphNodeId('counter', `${serverName}-${resourceName}`);
    addApplicationGraphNode(state, {
      id: nodeId,
      kind: 'counter',
      name: `${serverName}.${resourceName}`,
      stability: 'stable',
      target: applicationResourceRef(resource),
      flush: { everyMs: 1000 },
    });
    addApplicationGraphEdge(state, { from: { nodeId: serverNodeId }, to: { nodeId }, relationship: 'emits' });
    addApplicationGraphEdge(state, { from: { nodeId }, to: { nodeId: applicationGraphNodeId('crd', resourceName) }, relationship: 'writes' });
  }
}

function recordApplicationIndexGraph(state: ApplicationScopeState, name: string, index: ResourceIndex<object, object>): void {
  const providerNodeId = applicationProviderNodeId('IndexStore');
  const nodeId = applicationGraphNodeId('index', name);
  recordApplicationCrdGraph(state, index.resource.kind, index.resource);
  addApplicationGraphNode(state, {
    id: nodeId,
    kind: 'index',
    name,
    stability: 'stable',
    source: applicationResourceRef(index.resource),
    provider: { interface: 'IndexStore', nodeId: providerNodeId },
    ...(index.options.partitionBy ? { partitionBy: applicationExpressionContract(index.options.partitionBy) } : {}),
    ...(index.options.filter ? { filter: applicationExpressionContract(index.options.filter) } : {}),
    ...(index.options.orderBy ? { orderBy: applicationExpressionContract(index.options.orderBy) } : {}),
  });
  addApplicationGraphEdge(state, { from: { nodeId: providerNodeId }, to: { nodeId }, relationship: 'provides' });
  addApplicationGraphEdge(state, { from: { nodeId }, to: { nodeId: applicationGraphNodeId('crd', index.resource.kind) }, relationship: 'reads' });
}

function recordApplicationAggregateGraph<TStats extends object, TEvent extends object>(state: ApplicationScopeState, name: string, options: ApplicationAggregateOptions<TStats, TEvent>): void {
  const sourceNodeId = applicationGraphNodeId('index', options.source.name);
  const nodeId = applicationGraphNodeId('aggregate', name);
  addApplicationGraphNode(state, {
    id: nodeId,
    kind: 'aggregate',
    name,
    stability: 'stable',
    source: { nodeId: sourceNodeId },
    target: { resource: applicationResourceRef(options.target.resource), statusPath: 'status' },
    flush: { everyMs: parseDurationMs(options.flush?.every ?? '2s'), ...(options.flush?.maxEvents ? { maxEvents: options.flush.maxEvents } : {}) },
  });
  addApplicationGraphEdge(state, { from: { nodeId }, to: { nodeId: sourceNodeId }, relationship: 'reads' });
}

function applicationResourceRef(resource: Pick<AnyResourceDefinition, 'apiVersion' | 'kind'>): { readonly apiVersion: string; readonly kind: string } {
  return { apiVersion: resource.apiVersion, kind: resource.kind };
}

function applicationExpressionContract(expression: unknown): { readonly kind: 'field' | 'label' | 'literal' | 'ordering' | 'predicate'; readonly source: string } {
  const reflectedKind = expression && typeof expression === 'object' ? Reflect.get(expression, 'expressionKind') : undefined;
  const kind = typeof reflectedKind === 'string' ? reflectedKind : 'literal';
  return { kind: applicationExpressionKind(kind), source: JSON.stringify(expression) };
}

function applicationExpressionKind(kind: string): 'field' | 'label' | 'literal' | 'ordering' | 'predicate' {
  return kind === 'field' || kind === 'label' || kind === 'ordering' || kind === 'predicate' ? kind : 'literal';
}

function applicationProviderNodeId(providerInterface: ApplicationProviderInterfaceKind): string {
  return applicationProviderGraphNodeId(providerInterface);
}

function applicationCompositionResourceTarget<TSpec extends KroCompatibleType, TStatus extends KroCompatibleType>(definition: TypeKroListenerCompositionDefinition<TSpec, TStatus>): ApplicationCompositionResourceTarget {
  const apiVersion = definition.apiVersion ?? (definition.group ? `${definition.group}/v1alpha1` : 'applik8s.dev/v1alpha1');
  return { apiVersion, kind: definition.kind, plural: pluralizeKubernetesKind(definition.kind) };
}

function applicationGraphNodeId(kind: string, name: string): string {
  return `${kind}.${kubernetesNameSegment(name)}`;
}

function applicationOperatorResources(operator: unknown): Readonly<Record<string, AnyResourceDefinition>> {
  const definition = operator && typeof operator === 'function' ? Reflect.get(operator, 'definition') : undefined;
  const resources = definition && typeof definition === 'object' ? Reflect.get(definition, 'resources') : undefined;
  // typecast: app-scoped operator inference reads the SDK operator definition shape without depending on its generic callable type.
  return resources && typeof resources === 'object' ? resources as Readonly<Record<string, AnyResourceDefinition>> : {};
}

function applicationOperatorHandlers(operator: unknown): readonly HandlerRegistration<object, object>[] {
  const definition = operator && typeof operator === 'function' ? Reflect.get(operator, 'definition') : undefined;
  const handlers = definition && typeof definition === 'object' ? Reflect.get(definition, 'handlers') : undefined;
  if (!Array.isArray(handlers)) {
    return [];
  }
  // typecast: app graph extraction only reads handler metadata fields emitted by the SDK operator definition.
  return handlers as readonly HandlerRegistration<object, object>[];
}

function applicationServerBinding(name: string, options: ApplicationServerOptions, routes: readonly ApplicationServerRoute[], workload: ApplicationGeneratedWorkloadBinding): ApplicationServerBinding {
  const resourceName = options.resourceName ?? name;
  const serviceName = options.serviceName ?? resourceName;
  const namespace = options.namespace;
  return {
    name,
    resourceName,
    serviceName,
    ...(namespace ? { namespace } : {}),
    url: applicationTypeKroString('http://', serviceName, '.', namespace ?? 'default', '.svc.cluster.local/'),
    routes,
    deployment: workload.deployment,
    plan: applicationBindingPlan,
  };
}

function applicationBindingPlan<TStatus extends object>(target: OperationTarget<TStatus>, options?: PlanTargetOptions): Result<NormalizedOperationPlan<TStatus>> {
  const plan = options?.dryRun ? target.operationTargetArtifacts?.dryRunPlan : target.operationTargetArtifacts?.applyPlan;
  if (!plan) {
    return {
      ok: false,
      error: {
        code: 'LIFECYCLE_UNSAFE',
        message: options?.dryRun
          ? 'Generated application binding cannot plan operation target dry-run because no dryRunPlan artifact was emitted.'
          : 'Generated application binding cannot plan operation target apply because no applyPlan artifact was emitted.',
        severity: 'error',
        context: { operationKind: options?.dryRun ? 'apply' : 'apply' },
        recovery: { summary: options?.dryRun ? 'Regenerate the operation target with a dry-run artifact before calling plan(target, { dryRun: true }).' : 'Regenerate the operation target with an apply artifact before calling plan(target).' },
      },
    };
  }
  return { ok: true, value: { operations: plan.operations.map((operation) => applicationPlannedOperation(operation, options)) } };
}

function applicationPlannedOperation<TStatus extends object>(operation: NormalizedOperationPlan<TStatus>['operations'][number], options: PlanTargetOptions | undefined): NormalizedOperationPlan<TStatus>['operations'][number] {
  if (operation.kind !== 'apply') {
    return operation;
  }
  return {
    ...operation,
    ...(options?.fieldManager ? { fieldManager: options.fieldManager } : {}),
  };
}

function applicationAggregateBinding<TStats extends object, TEvent extends object>(
  name: string,
  options: ApplicationAggregateOptions<TStats, TEvent>,
  workload: ApplicationGeneratedWorkloadBinding
): ApplicationAggregateBinding<TStats, TEvent> {
  return {
    name,
    deployment: workload.deployment,
    options,
  };
}

function emitApplicationTransactionalDatabaseResources(state: ApplicationScopeState, model: ApplicationRuntimeModelContract, provider: ApplicationTransactionalDatabaseProvider): void {
  const selection = applicationProviderSelectionFor<ApplicationTransactionalDatabaseProvider>(
    provider,
  );
  if (selection) {
    const branches = Object.entries(selection.cases);
    if (
      branches.some(([, branch]) =>
        branch.migrations?.strategy === 'generatedJob'
        || branch.migrations?.apply === 'generatedJob',
      )
    ) {
      throw new Error(
        `Profile-selected TransactionalDatabase for model ${model.name} cannot use branch-local generated migrations. Use one profile-stable migration authority or an explicit external migration plan.`,
      );
    }
    for (const [variant, branch] of branches) {
      emitApplicationTransactionalDatabaseBranchResources(
        state,
        model,
        branch,
        variant,
        Cel.expr<boolean>(
          `${selection.selector} == ${JSON.stringify(variant)}`,
        ),
      );
    }
    return;
  }
  emitApplicationTransactionalDatabaseBranchResources(state, model, provider);
}

function emitApplicationTransactionalDatabaseBranchResources(
  state: ApplicationScopeState,
  model: ApplicationRuntimeModelContract,
  provider: ApplicationTransactionalDatabaseProvider,
  branch = '',
  includeWhen: boolean = true,
): void {
  if (provider.kind !== 'postgres') {
    return;
  }
  const modelName = model.name;
  const resourceName = kubernetesNameSegment(modelName);
  const branchSegment = branch ? kubernetesNameSegment(branch) : '';
  const branchSuffix = branch ? pascalCase(branch) : '';
  const clusterName = provider.clusterName
    ?? provider.name
    ?? `${resourceName}${branchSegment ? `-${branchSegment}` : ''}-db`;
  const namespace = provider.namespace;
  const database = provider.database ?? resourceName;
  const secretName = provider.connectionSecret?.name ?? `${clusterName}-app`;
  const secretKey = provider.connectionSecretKey ?? 'uri';
  const transactionalDatabaseKey = `${applicationTypeKroValueIdentity(namespace)}:${clusterName}:${database}:${secretName}:${secretKey}:${branch}`;
  if (state.emittedTransactionalDatabases.has(transactionalDatabaseKey)) {
    if (provider.migrations?.strategy === 'generatedJob' || provider.migrations?.apply === 'generatedJob') {
      emitApplicationModelMigrationResources(state, model, provider, clusterName, secretName, secretKey, database, namespace, {
        'app.kubernetes.io/name': clusterName,
        'app.kubernetes.io/component': 'transactional-database',
        'app.kubernetes.io/managed-by': 'applik8s',
        'applik8s.dev/model': resourceName,
      });
    }
    return;
  }
  state.emittedTransactionalDatabases.add(transactionalDatabaseKey);
  const labels = {
    'app.kubernetes.io/name': clusterName,
    'app.kubernetes.io/component': 'transactional-database',
    'app.kubernetes.io/managed-by': 'applik8s',
    'applik8s.dev/model': resourceName,
    ...(branch ? { 'applik8s.dev/profile-variant': branch } : {}),
  };

  const ownership = provider.ownership ?? (provider.provision === false || provider.cluster ? 'external' : 'application-graph');
  const clusterReference = provider.cluster ?? {
    apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster', name: clusterName, ...(namespace ? { namespace } : {}),
  };
  let clusterResource: { withIncludeWhen(condition: boolean): unknown };
  if (ownership === 'application-graph') {
    clusterResource = typeKroCnpgCluster({
      id: graphResourceId(resourceName, `transactionalDatabaseCluster${branchSuffix}`),
      name: clusterName,
      ...(namespace ? { namespace } : {}),
      // typecast: TypeKro's CNPG factory types s3Credentials.region as a
      // string, while the installed CNPG v1 CRD correctly requires a
      // SecretKeySelector. Keep Applik8s' admitted Kubernetes shape correct
      // at this provider boundary until the upstream declaration catches up.
      spec: applicationPostgresClusterSpec(provider, database) as never,
    });
  } else {
    clusterResource = externalRef({
      id: graphResourceId(resourceName, `transactionalDatabaseCluster${branchSuffix}`),
      apiVersion: clusterReference.apiVersion ?? 'postgresql.cnpg.io/v1',
      kind: clusterReference.kind ?? 'Cluster',
      metadata: {
        name: clusterReference.name ?? clusterName,
        ...(clusterReference.namespace ? { namespace: clusterReference.namespace } : {}),
      },
    });
  }
  applyApplicationTypeKroIncludeWhen(clusterResource, includeWhen);

  if (provider.backup) {
    const backup = typeKroCnpgScheduledBackup({
      id: graphResourceId(resourceName, `transactionalDatabaseScheduledBackup${branchSuffix}`),
      name: `${clusterName}-backup`,
      ...(namespace ? { namespace } : {}),
      spec: {
        cluster: { name: clusterReference.name ?? clusterName },
        schedule: provider.backup.schedule,
        method: provider.backup.destination.kind === 's3' ? 'barmanObjectStore' : 'volumeSnapshot',
        immediate: provider.backup.immediate ?? true,
        target: provider.backup.target ?? 'prefer-standby',
        backupOwnerReference: ownership === 'external' ? 'none' : 'cluster',
      },
    });
    applyApplicationTypeKroIncludeWhen(
      backup,
      applicationGraphAll(includeWhen, provider.backup.enabled ?? true),
    );
  }

  const role = typeKroRole({
    id: graphResourceId(resourceName, `transactionalDatabaseRole${branchSuffix}`),
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'Role',
    // Kubernetes object identity must remain static even when the selected
    // external database name is installation-derived.
    metadata: {
      name: `${resourceName}-transactional-database${branchSegment ? `-${branchSegment}` : ''}`,
      ...(namespace ? { namespace } : {}),
      labels,
    },
    rules: [
      { apiGroups: [''], resources: ['secrets'], verbs: ['get'], resourceNames: [secretName] },
      { apiGroups: ['postgresql.cnpg.io'], resources: ['clusters'], verbs: ['get', 'list', 'watch'] },
    ],
  });
  applyApplicationTypeKroIncludeWhen(role, includeWhen);

  if (provider.migrations?.strategy === 'generatedJob' || provider.migrations?.apply === 'generatedJob') {
    emitApplicationModelMigrationResources(state, model, provider, clusterName, secretName, secretKey, database, namespace, labels);
  }
}

function emitApplicationServerResources(name: string, options: ApplicationServerOptions, routes: readonly ApplicationServerRoute[]): ApplicationGeneratedWorkloadBinding {
  const resourceName = options.resourceName ?? name;
  const serviceName = options.serviceName ?? resourceName;
  const serviceAccountName = options.serviceAccountName ?? resourceName;
  const sourceConfigMapName = options.sourceConfigMapName ?? `${resourceName}-source`;
  const sourceFileName = options.sourceFileName ?? 'server.mjs';
  const namespace = options.namespace;
  const runtimeIndexBackend = runtimeIndexBackendConfig(options.indexBackend, namespace, resourceName);
  const runtimeModels = applicationServerRuntimeModels(options.models ?? {});
  const captures = serializeApplicationServerCaptures(options.captures ?? {});
  const captureAliases = serializedApplicationServerCaptureAliases(captures);
  assertRuntimeBindingNames({ ...(options.resources ?? {}), ...(options.indexes ?? {}), ...(options.models ?? {}), ...captures, ...captureAliases });
  assertDistinctRuntimeBindingNames({ resources: options.resources ?? {}, indexes: options.indexes ?? {}, models: options.models ?? {}, captures, captureAliases });
  const serializedRoutes = serializeApplicationServerRoutes(
    routes,
    new Set([...Object.keys(options.resources ?? {}), ...Object.keys(options.indexes ?? {}), ...Object.keys(options.models ?? {}), ...Object.keys(captures), ...Object.keys(captureAliases)]),
    new Set([...Object.keys(options.resources ?? {}), ...Object.keys(options.indexes ?? {}), ...Object.keys(options.models ?? {})])
  );
  const rawSourceBundle = options.source
    ? { [sourceFileName]: options.source }
    : options.command
      ? undefined
      : generatedApplicationServerBundle(sourceFileName, serializedRoutes, options.resources ?? {}, options.indexes ?? {}, runtimeModels, captures, runtimeIndexBackend, options.cache ?? []);
  const sourceBundle = rawSourceBundle ? kroSafeJavaScriptSourceBundle(rawSourceBundle) : undefined;
  const mountedSourceBundle = sourceBundle ? mountedConfigMapSourceBundle(sourceBundle) : undefined;
  const serverPermissions = inferApplicationServerPermissions({
    routes,
    resources: options.resources ?? {},
    indexes: options.indexes ?? {},
    indexBackend: runtimeIndexBackend,
    cache: options.cache ?? [],
    explicit: options.permissions ?? [],
  });
  const env = {
    NODE_OPTIONS: '--enable-source-maps',
    APPLIK8S_SERVER_NAMESPACE: namespace ?? 'default',
    APPLIK8S_HTTP_MAX_BODY_BYTES: String(options.maxRequestBodyBytes ?? 1_048_576),
    APPLIK8S_HTTP_MUTATION_RATE_LIMIT_MAX: String(options.mutationRateLimit?.maxRequests ?? 120),
    APPLIK8S_HTTP_MUTATION_RATE_LIMIT_WINDOW_SECONDS: String(options.mutationRateLimit?.windowSeconds ?? 60),
    ...(runtimeIndexBackend ? {
      APPLIK8S_INDEX_BACKEND: runtimeIndexBackend.kind,
      APPLIK8S_INDEX_VALKEY_HOST: runtimeIndexBackend.host,
      APPLIK8S_INDEX_VALKEY_PORT: String(runtimeIndexBackend.port),
    } : {}),
    ...(options.env ?? {}),
  };
  const configBindings = applicationConfigBindings(options.config);
  const secretBindings = applicationSecretBindings(options.secrets);
  const labels = {
    'app.kubernetes.io/name': resourceName,
    'app.kubernetes.io/component': 'server',
    'app.kubernetes.io/managed-by': 'applik8s',
    ...(options.labels ?? {}),
  };
  const id = (suffix: string) => graphResourceId(resourceName, suffix);
  const appVolumeMounts = [
    ...(sourceBundle ? [{ name: 'applik8s-server-source', mountPath: '/app', readOnly: true }] : []),
    ...applicationConfigVolumeMounts(configBindings),
    ...applicationSecretVolumeMounts(secretBindings),
    ...(options.volumeMounts ?? []),
  ];
  const appVolumes = [
    ...(mountedSourceBundle ? [{ name: 'applik8s-server-source', configMap: { name: sourceConfigMapName, items: mountedSourceBundle.items } }] : []),
    ...applicationConfigVolumes(configBindings),
    ...applicationSecretVolumes(secretBindings),
    ...(options.volumes ?? []),
  ];

  typeKroServiceAccount({
    id: id('serviceAccount'),
    apiVersion: 'v1',
    kind: 'ServiceAccount',
    metadata: { name: serviceAccountName, ...(namespace ? { namespace } : {}), labels },
  });

  if (serverPermissions.length > 0) {
    typeKroRole({
      id: id('role'),
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'Role',
      metadata: { name: serviceAccountName, ...(namespace ? { namespace } : {}), labels },
      rules: serverPermissions.map((rule) => ({
        apiGroups: [...rule.apiGroups],
        resources: [...rule.resources],
        verbs: [...rule.verbs],
        ...(rule.resourceNames ? { resourceNames: [...rule.resourceNames] } : {}),
      })),
    });
    typeKroRoleBinding({
      id: id('roleBinding'),
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'RoleBinding',
      metadata: { name: serviceAccountName, ...(namespace ? { namespace } : {}), labels },
      subjects: [{ kind: 'ServiceAccount', name: serviceAccountName, ...(namespace ? { namespace } : {}) }],
      roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'Role', name: serviceAccountName },
    });
  }

  if (sourceBundle) {
    typeKroConfigMap({
      id: id('source'),
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: { name: sourceConfigMapName, ...(namespace ? { namespace } : {}), labels },
      data: mountedSourceBundle?.data ?? sourceBundle,
    });
  }

  emitIndexBackendResources(resourceName, namespace, labels, options.indexBackend);
  emitValkeyIndexerResources(resourceName, namespace, labels, runtimeIndexBackend, options.indexes ?? {}, options.cache ?? []);

  const deployment = typeKroDeployment({
    id: id('deployment'),
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name: resourceName, ...(namespace ? { namespace } : {}), labels },
    spec: {
      replicas: options.replicas ?? 1,
      selector: { matchLabels: labels },
      template: {
        metadata: { labels },
        spec: {
          serviceAccountName,
          containers: [{
            name: 'server',
            image: options.image ?? 'node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2',
            command: [...(options.command ?? ['node', `/app/${sourceFileName}`])],
            ...(options.args ? { args: [...options.args] } : {}),
            env: [
              ...Object.entries(env).map(([envName, value]) => ({ name: envName, value })),
              ...applicationConfigEnvironmentVariables(configBindings),
              ...applicationSecretEnvironmentVariables(secretBindings),
              ...transactionalDatabaseEnvironmentVariables(runtimeModels, namespace),
            ],
            ports: [{ name: 'http', containerPort: 8080 }],
            readinessProbe: { httpGet: { path: '/-/healthz', port: 'http' }, initialDelaySeconds: 2, periodSeconds: 10 },
            livenessProbe: { httpGet: { path: '/-/healthz', port: 'http' }, initialDelaySeconds: 10, periodSeconds: 20 },
            ...(appVolumeMounts.length > 0 ? { volumeMounts: appVolumeMounts } : {}),
          }],
          ...(appVolumes.length > 0 ? { volumes: appVolumes } : {}),
        },
      },
    },
  });

  typeKroService({
    id: id('service'),
    apiVersion: 'v1',
    kind: 'Service',
    metadata: { name: serviceName, ...(namespace ? { namespace } : {}), labels },
    spec: {
      selector: labels,
      ports: [{ name: 'http', port: options.service?.port ?? 80, targetPort: 8080 }],
    },
  });
  // typecast: TypeKro's Kubernetes deployment factory exposes the full Kubernetes Deployment shape; app.server only relies on this narrower readiness projection.
  return { deployment: deployment as unknown as Enhanced<ApplicationDeploymentSpecProjection, ApplicationDeploymentStatusProjection> };
}

function applicationConfigBindings(config: ApplicationServerOptions['config']): readonly ApplicationConfigBinding[] {
  if (!config) {
    return [];
  }
  return Array.isArray(config) ? config : Object.values(config);
}

function applicationSecretBindings(secrets: ApplicationServerOptions['secrets']): readonly ApplicationSecretBinding[] {
  if (!secrets) {
    return [];
  }
  return Array.isArray(secrets) ? secrets : Object.values(secrets);
}

function applicationConfigEnvironmentVariables(bindings: readonly ApplicationConfigBinding[]): readonly { readonly name: string; readonly valueFrom: { readonly configMapKeyRef: { readonly name: string; readonly key: string } } }[] {
  return bindings.filter((binding) => binding.env).map((binding) => ({
    name: binding.env ?? binding.name,
    valueFrom: { configMapKeyRef: { name: binding.resourceName, key: binding.key } },
  }));
}

function applicationSecretEnvironmentVariables(bindings: readonly ApplicationSecretBinding[]): readonly { readonly name: string; readonly valueFrom: { readonly secretKeyRef: { readonly name: string; readonly key: string } } }[] {
  return bindings.filter((binding) => binding.env).map((binding) => ({
    name: binding.env ?? binding.name,
    valueFrom: { secretKeyRef: { name: binding.resourceName, key: binding.key } },
  }));
}

function applicationConfigVolumeMounts(bindings: readonly ApplicationConfigBinding[]): readonly ApplicationServerVolumeMount[] {
  return bindings.filter((binding) => binding.mountPath).map((binding) => ({ name: applicationBindingVolumeName('config', binding.name), mountPath: binding.mountPath ?? `/var/run/applik8s/config/${kubernetesNameSegment(binding.name)}`, readOnly: true }));
}

function applicationSecretVolumeMounts(bindings: readonly ApplicationSecretBinding[]): readonly ApplicationServerVolumeMount[] {
  return bindings.filter((binding) => binding.mountPath).map((binding) => ({ name: applicationBindingVolumeName('secret', binding.name), mountPath: binding.mountPath ?? `/var/run/applik8s/secrets/${kubernetesNameSegment(binding.name)}`, readOnly: true }));
}

function applicationConfigVolumes(bindings: readonly ApplicationConfigBinding[]): readonly ApplicationServerVolume[] {
  return bindings.filter((binding) => binding.mountPath).map((binding) => ({ name: applicationBindingVolumeName('config', binding.name), configMap: { name: binding.resourceName } }));
}

function applicationSecretVolumes(bindings: readonly ApplicationSecretBinding[]): readonly ApplicationServerVolume[] {
  return bindings.filter((binding) => binding.mountPath).map((binding) => ({ name: applicationBindingVolumeName('secret', binding.name), secret: { secretName: binding.resourceName } }));
}

function applicationBindingVolumeName(kind: 'config' | 'secret', name: string): string {
  return `applik8s-${kind}-${kubernetesNameSegment(name)}`.slice(0, 63);
}

function emitApplicationAggregateResources<TStats extends object, TEvent extends object>(name: string, options: ApplicationAggregateOptions<TStats, TEvent>): ApplicationGeneratedWorkloadBinding {
  const source = options.source;
  const target = options.target;
  assertApplicationAggregateTarget(name, target);
  const namespace = target.namespace;
  const resourceName = `${kubernetesNameSegment(name)}-aggregate`;
  const serviceAccountName = resourceName;
  const sourceConfigMapName = `${resourceName}-source`;
  const labels = {
    'app.kubernetes.io/name': resourceName,
    'app.kubernetes.io/component': 'aggregate',
    'app.kubernetes.io/managed-by': 'applik8s',
  };
  const id = (suffix: string) => graphResourceId(resourceName, suffix);
  const sourceRuntimeResource = applicationRuntimeResource(source.resource);
  const targetRuntimeResource = applicationRuntimeResource(target.resource);
  const reduceSource = serializeApplicationAggregateFunction(`app.aggregate ${name} reduce`, options.reduce, new Set(['stats', 'event']));
  const statusSource = serializeApplicationAggregateFunction(`app.aggregate ${name} status`, target.status, new Set(['stats']));
  const sourceBundle = kroSafeJavaScriptSourceBundle({
    'aggregate.mjs': generatedApplicationAggregateSource({
      name,
      source: sourceRuntimeResource,
      sourceOptions: source.options,
      target: targetRuntimeResource,
      targetName: target.name,
      ...(target.namespace ? { targetNamespace: target.namespace } : {}),
      initial: options.initial,
      reduceSource,
      statusSource,
      flushEveryMs: parseDurationMs(options.flush?.every ?? '2s'),
      maxEvents: options.flush?.maxEvents ?? 500,
    }),
  });
  const permissions = mergeApplicationKubernetesRbacRules([
    { apiGroups: [apiGroupForApiVersion(source.resource.apiVersion)], resources: [source.resource.plural], verbs: ['get', 'list', 'watch'] },
    { apiGroups: [apiGroupForApiVersion(target.resource.apiVersion)], resources: [`${target.resource.plural}/status`], verbs: ['patch'] },
  ]);

  typeKroServiceAccount({
    id: id('serviceAccount'),
    apiVersion: 'v1',
    kind: 'ServiceAccount',
    metadata: { name: serviceAccountName, ...(namespace ? { namespace } : {}), labels },
  });
  typeKroRole({
    id: id('role'),
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'Role',
    metadata: { name: serviceAccountName, ...(namespace ? { namespace } : {}), labels },
    rules: permissions.map((rule) => ({ apiGroups: [...rule.apiGroups], resources: [...rule.resources], verbs: [...rule.verbs] })),
  });
  typeKroRoleBinding({
    id: id('roleBinding'),
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'RoleBinding',
    metadata: { name: serviceAccountName, ...(namespace ? { namespace } : {}), labels },
    subjects: [{ kind: 'ServiceAccount', name: serviceAccountName, ...(namespace ? { namespace } : {}) }],
    roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'Role', name: serviceAccountName },
  });
  typeKroConfigMap({
    id: id('source'),
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name: sourceConfigMapName, ...(namespace ? { namespace } : {}), labels },
    data: sourceBundle,
  });
  const deployment = typeKroDeployment({
    id: id('deployment'),
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name: resourceName, ...(namespace ? { namespace } : {}), labels },
    spec: {
      replicas: 1,
      selector: { matchLabels: labels },
      template: {
        metadata: { labels },
        spec: {
          serviceAccountName,
          containers: [{
            name: 'aggregate',
            image: 'node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2',
            command: ['node', '/app/aggregate.mjs'],
            env: [{ name: 'APPLIK8S_AGGREGATE_NAMESPACE', value: namespace ?? 'default' }],
            volumeMounts: [{ name: 'applik8s-aggregate-source', mountPath: '/app', readOnly: true }],
          }],
          volumes: [{ name: 'applik8s-aggregate-source', configMap: { name: sourceConfigMapName } }],
        },
      },
    },
  });
  // typecast: TypeKro's Kubernetes deployment factory exposes the full Kubernetes Deployment shape; app.aggregate only relies on this narrower readiness projection.
  return { deployment: deployment as unknown as Enhanced<ApplicationDeploymentSpecProjection, ApplicationDeploymentStatusProjection> };
}

function assertApplicationAggregateTarget(name: string, target: ApplicationAggregateStatusTarget<object>): void {
  if (!target || typeof target !== 'object') {
    throw new Error(`app.aggregate ${JSON.stringify(name)} target must be an explicit status target.`);
  }
  if (!target.resource?.apiVersion || !target.resource.kind || !target.resource.plural) {
    throw new Error(`app.aggregate ${JSON.stringify(name)} target.resource must be a resource definition.`);
  }
  if (!target.name) {
    throw new Error(`app.aggregate ${JSON.stringify(name)} target.name is required.`);
  }
  if (typeof target.status !== 'function') {
    throw new Error(`app.aggregate ${JSON.stringify(name)} target.status(stats) mapper is required.`);
  }
}

function serializeApplicationAggregateFunction(label: string, value: (...args: never[]) => unknown, allowedIdentifiers: ReadonlySet<string>): string {
  const source = normalizeSerializableFunctionSource(value.toString().trim());
  if (!source || source.includes('[native code]')) {
    throw new Error(`${label} must be a serializable JavaScript function.`);
  }
  try {
    Function(`return (${source});`);
  } catch (_error) {
    throw new Error(`${label} must be a serializable JavaScript function expression.`);
  }
  const unsupported = unsupportedRouteFreeIdentifiers(analyzeApplicationServerRouteSource(source), allowedIdentifiers);
  if (unsupported.length > 0) {
    throw new Error(serializedCallbackClosureMessage({
      label,
      identifiers: unsupported,
      guidance: 'Keep plain constants inside the callback, or pass values through the source event, aggregate stats, or target resource state so the generated aggregate is self-contained.',
    }));
  }
  return source;
}

function parseDurationMs(duration: string): number {
  const match = duration.trim().match(/^(\d+(?:\.\d+)?)(ms|s|m)$/);
  if (!match) {
    throw new Error(`app.aggregate flush.every must be a duration like "500ms", "2s", or "1m".`);
  }
  const value = Number(match[1]);
  const unit = match[2];
  const multiplier = unit === 'ms' ? 1 : unit === 's' ? 1000 : 60_000;
  return Math.max(1, Math.round(value * multiplier));
}

function runtimeIndexBackendConfig(backend: ApplicationIndexBackend | undefined, namespace: string | undefined, resourceName: string): ApplicationRuntimeIndexBackend | undefined {
  if (!backend) {
    return undefined;
  }
  if (backend.kind === 'valkey') {
    const name = backend.name ?? `${resourceName}-index`;
    const backendNamespace = backend.namespace ?? namespace ?? 'default';
    return {
      kind: 'valkey',
      host: backend.host ?? `${name}.${backendNamespace}.svc.cluster.local`,
      port: backend.port ?? 6379,
    };
  }
  return undefined;
}

function emitIndexBackendResources(resourceName: string, namespace: string | undefined, labels: Readonly<Record<string, string>>, backend: ApplicationIndexBackend | undefined): void {
  if (backend?.kind !== 'valkey' || backend.provision === false || backend.host) {
    return;
  }
  const name = backend.name ?? `${resourceName}-index`;
  if (backend.provisioner === 'hyperspike') {
    emitHyperspikeValkeyResource(resourceName, namespace, labels, backend, name);
    return;
  }
  emitStandaloneValkeyResources(resourceName, namespace, labels, backend, name);
}

function emitHyperspikeValkeyResource(resourceName: string, namespace: string | undefined, labels: Readonly<Record<string, string>>, backend: ApplicationValkeyIndexBackend, name: string): void {
  const spec = {
    shards: 1,
    replicas: 0,
    anonymousAuth: true,
    ...(backend.spec ?? {}),
  };
  typeKroValkey({
    name,
    namespace: backend.namespace ?? namespace,
    id: graphResourceId(resourceName, 'valkeyIndex'),
    // typecast: TypeKro's Valkey factory accepts its CRD spec shape; applik8s keeps the backend option structurally typed to avoid leaking the provider package into public API types.
    spec: spec as never,
  });
  typeKroConfigMap({
    id: graphResourceId(resourceName, 'valkeyIndexServiceReference'),
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name: `${name}-applik8s-index`, ...(namespace ? { namespace } : {}), labels },
    data: {
      backend: 'valkey',
      host: applicationTypeKroString(name, '.', backend.namespace ?? namespace ?? 'default', '.svc.cluster.local'),
      port: String(backend.port ?? 6379),
    },
  });
}

function emitStandaloneValkeyResources(resourceName: string, namespace: string | undefined, labels: Readonly<Record<string, string>>, backend: ApplicationValkeyIndexBackend, name: string): void {
  const backendNamespace = backend.namespace ?? namespace;
  const backendLabels = {
    'app.kubernetes.io/name': name,
    'app.kubernetes.io/component': 'index-backend',
    'app.kubernetes.io/part-of': resourceName,
    'app.kubernetes.io/managed-by': 'applik8s',
  };
  const id = (suffix: string) => graphResourceId(name, suffix);
  typeKroDeployment({
    id: id('deployment'),
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name, ...(backendNamespace ? { namespace: backendNamespace } : {}), labels: backendLabels },
    spec: {
      replicas: 1,
      selector: { matchLabels: backendLabels },
      template: {
        metadata: { labels: backendLabels },
        spec: {
          containers: [{
            name: 'valkey',
            image: backend.image ?? 'valkey/valkey:8.1-alpine',
            args: ['valkey-server', '--save', ''],
            ports: [{ name: 'valkey', containerPort: backend.port ?? 6379 }],
          }],
        },
      },
    },
  });
  typeKroService({
    id: id('service'),
    apiVersion: 'v1',
    kind: 'Service',
    metadata: { name, ...(backendNamespace ? { namespace: backendNamespace } : {}), labels: backendLabels },
    spec: {
      selector: backendLabels,
      ports: [{ name: 'valkey', port: backend.port ?? 6379, targetPort: backend.port ?? 6379 }],
    },
  });
  typeKroConfigMap({
    id: graphResourceId(resourceName, 'valkeyIndexServiceReference'),
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name: `${name}-applik8s-index`, ...(backendNamespace ? { namespace: backendNamespace } : {}), labels },
    data: {
      backend: 'valkey',
      host: applicationTypeKroString(name, '.', backend.namespace ?? namespace ?? 'default', '.svc.cluster.local'),
      port: String(backend.port ?? 6379),
    },
  });
}

function emitValkeyIndexerResources(
  resourceName: string,
  namespace: string | undefined,
  labels: Readonly<Record<string, string>>,
  backend: ApplicationRuntimeIndexBackend | undefined,
  indexes: Readonly<Record<string, ResourceIndex<object, object>>>,
  cache: readonly ResourceIndex<object, object>[]
): void {
  if (backend?.kind !== 'valkey') {
    return;
  }
  const cachedIndexes = runtimeIndexTable(indexes, backend, cache);
  if (Object.keys(cachedIndexes).length === 0) {
    return;
  }
  const indexerName = `${resourceName}-indexer`;
  const indexerLabels = { ...labels, 'app.kubernetes.io/component': 'indexer', 'app.kubernetes.io/name': indexerName };
  const sourceName = `${indexerName}-source`;
  const id = (suffix: string) => graphResourceId(indexerName, suffix);

  typeKroServiceAccount({
    id: id('serviceAccount'),
    apiVersion: 'v1',
    kind: 'ServiceAccount',
    metadata: { name: indexerName, ...(namespace ? { namespace } : {}), labels: indexerLabels },
  });
  typeKroRole({
    id: id('role'),
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'Role',
    metadata: { name: indexerName, ...(namespace ? { namespace } : {}), labels: indexerLabels },
    rules: indexerPermissionRules(cachedIndexes).map((rule) => ({
      apiGroups: [...rule.apiGroups],
      resources: [...rule.resources],
      verbs: [...rule.verbs],
      ...(rule.resourceNames ? { resourceNames: [...rule.resourceNames] } : {}),
    })),
  });
  typeKroRoleBinding({
    id: id('roleBinding'),
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'RoleBinding',
    metadata: { name: indexerName, ...(namespace ? { namespace } : {}), labels: indexerLabels },
    subjects: [{ kind: 'ServiceAccount', name: indexerName, ...(namespace ? { namespace } : {}) }],
    roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'Role', name: indexerName },
  });
  typeKroConfigMap({
    id: id('source'),
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name: sourceName, ...(namespace ? { namespace } : {}), labels: indexerLabels },
    data: { 'indexer.mjs': generatedValkeyIndexerSource(cachedIndexes) },
  });
  typeKroDeployment({
    id: id('deployment'),
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name: indexerName, ...(namespace ? { namespace } : {}), labels: indexerLabels },
    spec: {
      replicas: 1,
      selector: { matchLabels: indexerLabels },
      template: {
        metadata: { labels: indexerLabels },
        spec: {
          serviceAccountName: indexerName,
          containers: [{
            name: 'indexer',
            image: 'node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2',
            command: ['node', '/app/indexer.mjs'],
            env: [
              { name: 'APPLIK8S_SERVER_NAMESPACE', value: namespace ?? 'default' },
              { name: 'APPLIK8S_INDEX_VALKEY_HOST', value: backend.host },
              { name: 'APPLIK8S_INDEX_VALKEY_PORT', value: String(backend.port) },
            ],
            volumeMounts: [{ name: 'applik8s-indexer-source', mountPath: '/app', readOnly: true }],
          }],
          volumes: [{ name: 'applik8s-indexer-source', configMap: { name: sourceName } }],
        },
      },
    },
  });
}

function indexerPermissionRules(indexes: Readonly<Record<string, ApplicationServerRuntimeIndex>>): readonly ApplicationKubernetesRbacRule[] {
  const rules = new Map<string, ApplicationKubernetesRbacRule>();
  for (const index of Object.values(indexes)) {
    const [group = ''] = index.resource.apiVersion.includes('/') ? index.resource.apiVersion.split('/') : [''];
    const key = `${group}/${index.resource.plural}`;
    rules.set(key, { apiGroups: [group], resources: [index.resource.plural], verbs: ['get', 'list', 'watch'] });
  }
  return [...rules.values()];
}

function generatedApplicationServerBundle(
  sourceFileName: string,
  routes: readonly SerializedApplicationServerRouteWithDependencies[],
  resources: Readonly<Record<string, AnyResourceDefinition>>,
  indexes: Readonly<Record<string, ResourceIndex<object, object>>>,
  models: Readonly<Record<string, ApplicationRuntimeModelContract>>,
  captures: SerializedApplicationServerCaptures,
  indexBackend: ApplicationRuntimeIndexBackend | undefined,
  cache: readonly ResourceIndex<object, object>[]
): Readonly<Record<string, string>> {
  const routeModules = generatedApplicationServerRouteModules(routes);
  return bundleGeneratedApplicationServerSourceBundle(sourceFileName, {
    [sourceFileName]: generatedApplicationServerHonoEntrypointSource(),
    'runtime.mjs': generatedApplicationServerRuntimeSource(resources, indexes, models, indexBackend, cache),
    ...generatedApplicationRuntimeModuleBundle(),
    'bindings.mjs': generatedApplicationServerBindingsSource(resources, indexes, models, captures),
    'routes.mjs': generatedApplicationServerRoutesSource(routeModules),
    'routes.manifest.json': `${JSON.stringify(routeModules.map(routeManifestEntry), null, 2)}\n`,
    ...Object.fromEntries(routeModules.map((module) => [module.fileName, generatedApplicationServerRouteModuleSource(module, resources, indexes, models, captures)])),
  });
}
