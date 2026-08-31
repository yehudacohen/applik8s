// typecast-file-boundary: application builder internals join ArkType, Drizzle, TypeKro, and graph registries whose runtime identities preserve generics erased by TypeScript.

import type { ApplicationTanStackAIAgentRequest } from '@applik8s/ai-tanstack';
import {
  type ApplicationOperation,
  getApplicationOperationContract,
} from '@applik8s/client';
import type { AnyResourceDefinition, ApplicationGeneratedResourceContract, ApplicationGraph, ApplicationObservabilityContract, ApplicationOperationAuthorityGraphContract, ApplicationProfileProviderSelectionContract, ApplicationProviderInterfaceKind, HandlerRegistration, JsonObject, JsonValue, NormalizedOperationPlan, OperationTarget, OperatorDeploymentOptions, PermissionRule, PlanTargetOptions, ResourceDefinition, ResourceIndex, ResourceObject, Result } from '@applik8s/core';
import { applicationGraphMetadataProperty, applicationImplementationPlanSet, applicationImplementationPlansMetadataProperty, applicationInstallationMetadataProperty, applicationOperationId, applicationTypeKroDefinitionProperty, normalizeApplicationGraph } from '@applik8s/core';
import type { CrdOptions, SchemaInput } from '@applik8s/sdk';
import { sdk as baseSdk, normalizeSchema, setOperatorDeploymentInterceptor } from '@applik8s/sdk';
import type { TypeKroListenerComposition, TypeKroListenerCompositionDefinition } from '@applik8s/typekro-adapter';
import { typeKro } from '@applik8s/typekro-adapter';
import { type as arkType, type Type } from 'arktype';
import { getTableName, is, isTable, Relations } from 'drizzle-orm';
import type { AnyPgTable } from 'drizzle-orm/pg-core';
import type { Composable, Enhanced, KroCompatibleType, KubernetesResource, MagicAssignableShape, SerializationOptions } from 'typekro';
import { Cel, externalRef } from 'typekro';
import { cluster as typeKroCnpgCluster, scheduledBackup as typeKroCnpgScheduledBackup } from 'typekro/cnpg';
import { configMap as typeKroConfigMap, deployment as typeKroDeployment, role as typeKroRole, roleBinding as typeKroRoleBinding, service as typeKroService, serviceAccount as typeKroServiceAccount } from 'typekro/kubernetes';
import { valkey as typeKroValkey } from 'typekro/valkey';
import { applicationActorDependencyBindings } from './application-actor-dependencies.js';
import { type ApplicationActorHandle, type ApplicationActorKeySchema, type ApplicationActorProtocol, type ApplicationActorProtocolShape, type ApplicationActorStateInput, applicationActorHandlerCallbackDependencies, createApplicationActor, observeApplicationActorDefinition, replayApplicationActorDefinition } from './application-actors.js';
import {
  type ApplicationAgentBinding,
  type ApplicationAgentHandler,
  type ApplicationAgentOptions,
  registerApplicationAgent,
} from './application-ai.js';
import { emitApplicationAnalyticalDatabaseResources } from './application-analytical-database-resources.js';
import {
  type ApplicationAssemblyProfileBuilder,
  type ApplicationAssemblyProfileCatalog,
  type ApplicationAssemblyProfileDefinition,
  createApplicationAssemblyProfileCatalog,
} from './application-assembly-profiles.js';
import {
  type ApplicationAuthorityGraphState,
  type ApplicationAuthorityRegistrar,
  applicationAuthorityRegistrar,
} from './application-authority.js';
import { expandApplicationCallbackDependencies } from './application-callback.js';
import { recordApplicationCrdGraph } from './application-crd-graph.js';
import { type ApplicationResourceControllerBinding, type ApplicationResourceControllerOptions, type ApplicationResourceEventHandlers, createApplicationResourceEventOperatorController } from './application-events.js';
import { type ApplicationJobBinding, type ApplicationJobContract, type ApplicationJobHandler, type ApplicationJobOptions, registerApplicationJob } from './application-finite-jobs.js';
import { inferApplicationFunctionNativeTransaction } from './application-function-native-transactions.js';
import { type ApplicationGeneratedJobResourceState, type ApplicationWorkloadCronJobOptions, type ApplicationWorkloadJobBinding, type ApplicationWorkloadJobOptions, emitApplicationGeneratedJob, emitApplicationModelMigrationResources } from './application-generated-job-resources.js';
import type { ApplicationServerRuntimeIndex } from './application-generated-runtime-sources.js';
import { generatedApplicationAggregateSource, generatedValkeyIndexerSource } from './application-generated-runtime-sources.js';
import { type ApplicationGraphState, addApplicationGraphEdge, addApplicationGraphNode, addApplicationProviderRequirement, applicationGraphFromState, isApplicationGraph } from './application-graph-state.js';
import {
  type ApplicationHttpHandler,
  type ApplicationHttpOptions,
  type ApplicationHttpRegistrar,
  type ApplicationHttpRouteDeclaration,
  createApplicationHttpServer,
} from './application-http.js';
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
import {
  type ApplicationMcpClientBinding,
  type ApplicationMcpClientOptions,
  type ApplicationMcpRegistrar,
  type ApplicationMcpServerBinding,
  type ApplicationMcpServerOptions,
  applicationMcpRegistrar,
} from './application-mcp.js';
import type { ApplicationModelBinding, ApplicationModelOptions, ApplicationModelRuntimeBinding, ApplicationModelSchemaIndexOptions, ApplicationRuntimeModelContract } from './application-models.js';
import { applicationModelBinding, applicationModelCommandRegistrar, applicationRuntimeModelContract, bindApplicationModelCommandRegistrar, prepareApplicationModelCommandReplacement, recordApplicationAnalyticalNativeModelGraph, recordApplicationModelCommandGraph, recordApplicationModelGraph, recordApplicationNativeModelGraph, resolveApplicationTransactionalDatabase } from './application-models.js';
import {
  type ApplicationModuleReference,
  applicationModuleMetadataFor,
} from './application-modules.js';
import {
  applicationNativeCommandModelBinding,
  applicationNativeCreateContracts,
  applicationNativeDeleteContracts,
  applicationNativeRuntimeModelContract,
  applicationNativeUpdateContracts,
  bindApplicationNativeCreateOperation,
  bindApplicationNativeDeleteOperation,
  bindApplicationNativeUpdateOperation,
  registerApplicationNativeCreateProcessor,
  registerApplicationNativeDeleteProcessor,
  registerApplicationNativeUpdateProcessor,
  resolveApplicationDatabase,
  validateNativeModelAccess,
} from './application-native-model-wiring.js';
import { type ApplicationObjectStoreBinding, type ApplicationObjectStoreOptions, registerApplicationObjectStore } from './application-object-storage.js';
import { applicationOperatorWatchScopeContracts } from './application-operator-watches.js';
import type { ApplicationProcessorOptions } from './application-processor-policy.js';
import {
  type ApplicationProfile,
  type ApplicationProfileVariant,
  type ApplicationQualifiedProviderBinding,
  applicationProfileVariantsFromSchema,
  createApplicationProfileRuntime,
} from './application-profiles.js';
import { createApplicationQualifiedProviderBinding } from './application-provider-handle.js';
import type { ApplicationAnalyticalDatabaseProvider, ApplicationDefaults, ApplicationDefaultsBinding, ApplicationHostBinding, ApplicationHostProvider, ApplicationHttpExposureProvider, ApplicationIndexBackend, ApplicationPostgresTransactionalDatabaseOptions, ApplicationProviderBinding, ApplicationProviderDeploymentTarget, ApplicationProviderQualification, ApplicationProviderState, ApplicationProviderToken, ApplicationQualifiedProviderToken, ApplicationTargetProviderSelectionValue, ApplicationTransactionalDatabaseProvider, ApplicationValkeyIndexBackend } from './application-providers.js';
import { ActorRuntime, ApplicationHost, applicationAnalyticalDatabaseImplementation, applicationCallableProviderRuntimeBinding, applicationCertificateImplementation, applicationDnsPublicationImplementation, applicationEventLogImplementation, applicationHostBinding, applicationHttpExposureImplementation, applicationIndexBackend, applicationObjectStorageImplementation, applicationPostgresClusterSpec, applicationProviderQualificationFor, applicationProviderSelectionFor, applicationProviderSelectionSatisfies, applicationProviderTokenName, applicationSearchProviderImplementation, applicationTargetProviderSelectionFor, applicationTransactionalDatabaseImplementation, applyApplicationProvider, defaultApplicationEventLogProvider, defaultApplicationIndexBackend, defaultApplicationIndexProvider, defaultApplicationProviders, IndexStore, isApplicationProviderSelection, isApplicationQualifiedProviderToken, isValkeyIndexDefault, TransactionalDatabase } from './application-providers.js';
import { type ApplicationCallableQueryBinding, type ApplicationQueryOptions, type ApplicationQueryPrincipal, type ApplicationQuerySourceBinding, applicationQueryBindingForOperation, registerApplicationModelView, registerApplicationQuery } from './application-queries.js';
import { type ApplicationAnalyticalProjectionBinding, type ApplicationAnalyticalProjectionOptions, type ApplicationGatewayBinding, type ApplicationGatewayOptions, type ApplicationOnlineProjectionBinding, type ApplicationOnlineProjectionDraft, type ApplicationOnlineProjectionOptions, type ApplicationOnlineProjectionRetentionPolicy, type ApplicationOnlineProjectionTransform, type ApplicationProjectionOptions, type ApplicationProjectionOutput, type ApplicationProjectionRebuildModel, type ApplicationProjectionRebuildScope, type ApplicationProjectionTransform, type ApplicationStreamBatchHandler, type ApplicationStreamBatchOptions, type ApplicationStreamBinding, type ApplicationStreamOptions, type ApplicationStreamProcessHandler, type ApplicationStreamProcessOptions, type ApplicationSubscriptionBinding, type ApplicationSubscriptionOptions, registerApplicationGateway, registerApplicationProjection, registerApplicationStream, registerApplicationStreamBatchProcessor, registerApplicationStreamProcessor, registerApplicationSubscription } from './application-reactive.js';
import type { ApplicationRouteSourceLocation, ApplicationServerRouteSourceAnalysis, SerializedApplicationServerRouteWithDependencies } from './application-route-source.js';
import { analyzeApplicationServerRouteSource, normalizeSerializableFunctionSource, routeAnalysisCallsMethod, serializedCallbackClosureMessage, unsupportedRouteFreeIdentifiers } from './application-route-source.js';
import { generatedApplicationRuntimeModuleBundle } from './application-runtime-modules.js';
import {
  type ApplicationSearchDocument,
  type ApplicationSearchField,
  type ApplicationSearchIndexBinding,
  type ApplicationSearchIndexOptions,
  type ApplicationSearchIndexRegistrar,
  type ApplicationSearchRootOptions,
  applicationSearchIndexRegistrar,
  bindApplicationSearchModel,
  createApplicationSearchRegistrar,
} from './application-search.js';
import { bundleGeneratedApplicationServerSourceBundle, generatedApplicationServerBindingsSource, generatedApplicationServerHonoEntrypointSource, generatedApplicationServerRouteModuleSource, generatedApplicationServerRouteModules, generatedApplicationServerRoutesSource, kroSafeJavaScriptSourceBundle, mountedConfigMapSourceBundle, routeManifestEntry } from './application-server-bundle.js';
import { applicationRuntimeResource, assertDistinctRuntimeBindingNames, assertRuntimeBindingNames, createRouteRecorder, inferApplicationServerPermissions, mergeApplicationKubernetesRbacRules, type SerializedApplicationServerCaptures, serializeApplicationServerCaptures, serializeApplicationServerRoutes, serializedApplicationServerCaptureAliases, transactionalDatabaseEnvironmentVariables } from './application-server-routing.js';
import { generatedApplicationServerRuntimeSource, runtimeIndexTable } from './application-server-runtime.js';
import {
  type ApplicationSignalBinding,
  type ApplicationSignalContract,
  type ApplicationSignalDecision,
  type ApplicationSignalDefinition,
  type ApplicationSignalEmitOptions,
  applicationSignalAuthorityFacets,
  applicationSignalStreamOptions,
  defineApplicationSignal,
  emitApplicationWorkflowSignal,
} from './application-signals.js';
import type { ApplicationGeneratedJobStatusProjectionState, ApplicationStatusReconcilerAppResourceTarget } from './application-status-reconciler.js';
import { emitApplicationGeneratedJobStatusReconcilers } from './application-status-reconciler.js';
import { applicationTypeKroExpressionValue, applicationTypeKroGraphValue, applicationTypeKroString, applicationTypeKroValueIdentity, applyApplicationTypeKroIncludeWhen } from './application-typekro-values.js';
import type { ApplicationTaskHandler, ApplicationTaskObjectStores, ApplicationTaskOperations, ApplicationTaskOptions, ApplicationTaskProjections, ApplicationTaskProviderAccounting, ApplicationTaskQueries, ApplicationTaskReference, ApplicationWorkflowBinding, ApplicationWorkflowHandler, ApplicationWorkflowOptions, ApplicationWorkflowReference } from './application-workflows.js';
import { type ApplicationWorkflowState, recordApplicationWorkflowEngine, registerApplicationSingleStepWorkflow, registerApplicationWorkflow } from './application-workflows.js';
import {
  applicationRelationalModelOptionsFor,
  isApplicationRelationalModel,
} from './drizzle.js';
import { workflow as defineWorkflow, type EntityDefinition, type EventDefinition, type StreamDefinition, type WorkflowDefinition } from './dsl.js';
import { applicationNativeModelMethodDependencyFor } from './native-model-execution.js';
import { type ApplicationKubernetesCreatePolicy, applicationModelCommandBindingForOperation, applicationModelViewRegistrar, bindApplicationModelViews, bindNativeApplicationModelBeforeCommit, bindNativeApplicationModelBinding, bindNativeApplicationModelCommands, bindNativeApplicationModelLifecycle, bindNativeKubernetesLifecycle, type DrizzleAnalyticalApplicationModelFacet, getApplicationModelFacet, getRequiredDrizzleApplicationModelFacet, nativeApplicationModelBeforeCommitRegistrar, nativeApplicationModelCommandRegistrar, nativeApplicationModelLifecycleRegistrar, nativeKubernetesLifecycleRegistrar, type PromoteAnalyticalDrizzleTableOptions, type PromoteDrizzleTableOptions, type PromotedAnalyticalDrizzleTable, type PromotedDrizzleTable, type PromotedKubernetesResource, promoteAnalyticalDrizzleTable, promoteDrizzleTable, promoteKubernetesResource } from './native-models.js';
import {
  type ApplicationDatabaseHandle,
  applicationDatabaseHandle,
} from './relational-runtime.js';
import type { ApplicationPostgresRlsPolicy } from './trusted-context.js';

export type { ApplicationAgentBinding, ApplicationAgentDeploymentOptions, ApplicationAgentHandler, ApplicationAgentOptions, ApplicationAgentTool } from './application-ai.js';
export type { ApplicationAuthorityRegistrar, ApplicationAuthoritySelection, ApplicationOAuthClientIdentityBinding, ApplicationOAuthClientIdentityOptions, ApplicationOutcomeBinding, ApplicationOutcomeOptions, ApplicationPermissionBinding, ApplicationServiceIdentityBinding } from './application-authority.js';
export type { ApplicationFinalizeEventHandler, ApplicationResourceControllerBinding, ApplicationResourceControllerOptions, ApplicationResourceEventHandler, ApplicationResourceObject } from './application-events.js';
export type { ApplicationWorkloadCronJobOptions, ApplicationWorkloadJobBinding, ApplicationWorkloadJobOptions } from './application-generated-job-resources.js';
export type { ApplicationHttpAuthorization, ApplicationHttpContext, ApplicationHttpHandler, ApplicationHttpOptions, ApplicationHttpRegistrar, ApplicationHttpRequest, ApplicationHttpRouteContract, ApplicationHttpServer, ApplicationHttpWebhookAuthentication, ApplicationHttpWebhookContract, ApplicationHttpWebhookRequest } from './application-http.js';
export type { ApplicationInstallationClient, ApplicationInstallationConnectOptions, ApplicationInstallationReference, ApplicationInstallationTransport, ApplicationInstallationWatchOptions } from './application-installation-client.js';
export type { ApplicationLakehouseAuthorityManifest, ApplicationLakehouseComparisonExpression, ApplicationLakehouseDatasetQueryContract, ApplicationLakehouseFieldExpression, ApplicationLakehouseFilterExpression, ApplicationLakehouseLogicalExpression, ApplicationLakehouseManifest, ApplicationLakehouseOrder, ApplicationLakehouseOrderExpression, ApplicationLakehousePredicate, ApplicationLakehousePublication, ApplicationLakehousePublicationRuntime, ApplicationLakehouseQueryFailureReceipt, ApplicationLakehouseQueryInput, ApplicationLakehouseQueryReceipt, ApplicationLakehouseQueryRequest, ApplicationLakehouseQueryResult, ApplicationLakehouseQueryRuntime, ApplicationLakehouseQueryTerminalState, ApplicationLakehouseRowExpression, ApplicationLakehouseScalar, ApplicationLakehouseSchemaCompatibility, CompiledApplicationLakehouseQuery, DeterministicApplicationLakehouseRuntime } from './application-lakehouse.js';
export { ApplicationLakehouseQueryTerminalError, applicationLakehouseAuthorityManifest, applicationLakehouseQueryIdentity, applicationLakehouseQueryTerminalError, classifyApplicationLakehouseSchemaEvolution, compareApplicationLakehouseRows, compileApplicationLakehouseQuery, createDeterministicApplicationLakehouseRuntime, evaluateApplicationLakehouseFilter, executeApplicationLakehousePublication, installApplicationLakehousePublicationRuntimeResolver, installApplicationLakehouseQueryRuntimeResolver, verifyApplicationLakehouseAuthorityManifest, verifyApplicationLakehouseManifest } from './application-lakehouse.js';
export type { ApplicationLakehouseConformanceCase, ApplicationLakehouseConformanceReport, ApplicationLakehouseConformanceRow } from './application-lakehouse-conformance.js';
export { applicationLakehouseConformanceCases, applicationLakehouseConformanceRows, runApplicationLakehouseConformance } from './application-lakehouse-conformance.js';
export type { ApplicationMcpClientBinding, ApplicationMcpClientOptions, ApplicationMcpRegistrar, ApplicationMcpServerBinding, ApplicationMcpServerOptions, ApplicationMcpToolSelection } from './application-mcp.js';
export type { ApplicationModelClearIntent, ApplicationModelUpdatePatch } from './application-model-update-contract.js';
export { clear } from './application-model-update-contract.js';
export type { ApplicationCommandDomainError, ApplicationCommandKey, ApplicationCommandSubmissionAcknowledgement, ApplicationModelBackendContract, ApplicationModelBinding, ApplicationModelCommandBinding, ApplicationModelCommandContext, ApplicationModelCommandDeliveryOptions, ApplicationModelCommandHandler, ApplicationModelCommandOptions, ApplicationModelCommandParticipantClient, ApplicationModelCommandTarget, ApplicationModelConstraintOptions, ApplicationModelCreateInput, ApplicationModelEventBinding, ApplicationModelEventHandler, ApplicationModelEventRegistrar, ApplicationModelIndexBinding, ApplicationModelIndexOptions, ApplicationModelObject, ApplicationModelOptions, ApplicationModelPatch, ApplicationModelQueryOptions, ApplicationModelQueryPage, ApplicationModelRef, ApplicationModelRuntimeBinding, ApplicationModelSchemaIndexOptions, ApplicationModelSchemaOptions, ApplicationRuntimeModelContract } from './application-models.js';
export type { ApplicationModuleContext, ApplicationModuleDefinition, ApplicationModuleMetadata, ApplicationModuleOptions, ApplicationModuleReference, ApplicationModuleSetup } from './application-modules.js';
export { defineApplicationModule, module } from './application-modules.js';
export type { ApplicationObjectMetadata, ApplicationObjectPutRequest, ApplicationObjectReference, ApplicationObjectStorageRuntime, ApplicationObjectStoreBinding, ApplicationObjectStoreOptions, ApplicationSignedObjectIntent } from './application-object-storage.js';
export { installApplicationObjectStorageRuntimeResolver } from './application-object-storage.js';
export type { ApplicationProcessorOptions } from './application-processor-policy.js';
export type { ApplicationProfile, ApplicationProfileBranchOptions, ApplicationProfileVariant, ApplicationProfileVariantOverride, ApplicationQualifiedProviderBinding } from './application-profiles.js';
export { installApplicationProjectionRuntimeResolver } from './application-projection-binding.js';
export type { ApplicationActorRuntimeProvider, ApplicationActorRuntimeProviderToken, ApplicationAnalyticalDatabaseProvider, ApplicationAnalyticalDatabaseProviderToken, ApplicationAnalyticsConstructors, ApplicationAthenaLakehouseQueryProvider, ApplicationAuthorizationDecision, ApplicationAuthorizationProvider, ApplicationAuthorizationProviderToken, ApplicationAuthorizationRequest, ApplicationAwsJobRuntimeProvider, ApplicationCelldActorRuntimeProvider, ApplicationCertificateProvider, ApplicationCertificateProviderToken, ApplicationCertManagerCertificateProvider, ApplicationClickHouseAnalyticalDatabaseProvider, ApplicationClickStackObservabilityProvider, ApplicationCloudWatchObservabilityProvider, ApplicationContainerRegistryCredentialSecret, ApplicationContainerRegistryEndpoint, ApplicationContainerRegistryProvider, ApplicationContainerRegistryProviderToken, ApplicationContainerRegistrySecretRef, ApplicationContainerRegistryTls, ApplicationCounterStoreProvider, ApplicationCredentialStoreProvider, ApplicationDatabaseConstructors, ApplicationDefaults, ApplicationDefaultsBinding, ApplicationDnsPublicationProvider, ApplicationDnsPublicationProviderToken, ApplicationDuckDbLakehouseDatasetProvider, ApplicationDuckDbLakehouseQueryProvider, ApplicationEventBridgeSchedulerProvider, ApplicationEventLogProvider, ApplicationEventSourceProvider, ApplicationExternalClickHouseConnection, ApplicationExternalClickHouseOptions, ApplicationExternalDnsPublicationProvider, ApplicationExternalPostgresDatabaseOptions, ApplicationGeneratedTransactionalDatabaseMigrationJobOptions, ApplicationHarborContainerRegistryOptions, ApplicationHarborContainerRegistryProvider, ApplicationHarborProjectManagement, ApplicationHatchetSchedulerProvider, ApplicationHatchetWorkflowEngineProvider, ApplicationHostBinding, ApplicationHostProvider, ApplicationHostProviderToken, ApplicationHttpExposureProvider, ApplicationHttpExposureProviderToken, ApplicationIdentityInfrastructure, ApplicationIdentityProvider, ApplicationIdentityProviderToken, ApplicationIndexBackend, ApplicationIndexStoreProviderToken, ApplicationIngressHttpExposureProvider, ApplicationJobRuntimeProvider, ApplicationJobRuntimeProviderToken, ApplicationKubernetesConfigMapObjectStorageProvider, ApplicationKubernetesConfigMapQueueProvider, ApplicationKubernetesCredentialStoreProvider, ApplicationKubernetesCronJobSchedulerProvider, ApplicationKubernetesHostProvider, ApplicationKubernetesJobRuntimeProvider, ApplicationKubernetesResourceCounterStoreProvider, ApplicationKubernetesSecretProvider, ApplicationKubernetesWatchEventSourceProvider, ApplicationLakehouseDatasetProvider, ApplicationLakehouseDatasetProviderToken, ApplicationLakehouseQueryProvider, ApplicationLakehouseQueryProviderToken, ApplicationLocalActorRuntimeProvider, ApplicationLocalJobRuntimeProvider, ApplicationLocalObservabilityProvider, ApplicationLocalSchedulerProvider, ApplicationManagedHostProvider, ApplicationNatsJetStreamEventLogProvider, ApplicationNodePortHttpExposureProvider, ApplicationOAuthAuthorizationServerProvider, ApplicationOAuthAuthorizationServerProviderToken, ApplicationObjectStorageProvider, ApplicationObservabilityProvider, ApplicationObservabilityProviderToken, ApplicationOciContainerRegistryProvider, ApplicationOpenSearchProvider, ApplicationOrbstackContainerRegistryProvider, ApplicationOtlpObservabilityProvider, ApplicationPostgresAnalyticalDatabaseProvider, ApplicationPostgresBackupPolicy, ApplicationPostgresClusterSpec, ApplicationPostgresReadinessPolicy, ApplicationPostgresSearchProvider, ApplicationPostgresTransactionalDatabaseOptions, ApplicationPostgresTransactionalDatabaseProvider, ApplicationProviderBinding, ApplicationProviderQualification, ApplicationProviderToken, ApplicationQualifiableProviderToken, ApplicationQualifiedLakehouseDatasetProviderToken, ApplicationQualifiedLakehouseProviderRequired, ApplicationQualifiedProviderToken, ApplicationQueueProvider, ApplicationRequestAdmission, ApplicationRivetActorRuntimeProvider, ApplicationS3LakehouseDatasetProvider, ApplicationSchedulerProvider, ApplicationSchedulerProviderToken, ApplicationSearchCapability, ApplicationSearchProvider, ApplicationSearchProviderToken, ApplicationSecretProvider, ApplicationStructuredGenerationDeterministicProvider, ApplicationStructuredGenerationHttpProvider, ApplicationStructuredGenerationProvider, ApplicationStructuredGenerationProviderToken, ApplicationTelemetryPolicy, ApplicationTelemetryPolicyOptions, ApplicationTransactionalDatabaseMigrationPolicy, ApplicationTransactionalDatabaseProvider, ApplicationTransactionalDatabaseProviderToken, ApplicationTypedProviderContract, ApplicationValkeyIndexBackend, ApplicationWorkflowEngineProvider, ApplicationWorkflowEngineProviderToken } from './application-providers.js';
export { ActorRuntime, AnalyticalDatabase, Analytics, ApplicationHost, Authorization, Certificate, ContainerRegistry, CounterStore, CredentialStore, Database, DnsPublication, defaultApplicationEventLogProvider, defaultApplicationProviders, defaultApplicationWorkflowEngineProvider, defineApplicationProvider, EventLog, EventSource, HttpExposure, IdentityProvider, IndexStore, JobRuntime, Lakehouse, LakehouseDataset, LakehouseQuery, OAuthAuthorizationServer, ObjectStorage, Observability, providers, Queue, Scheduler, Search, Secret, StructuredGeneration, TransactionalDatabase, telemetryPolicy, WorkflowEngine } from './application-providers.js';
export type { ApplicationKubernetesModelSelection, ApplicationKubernetesModelSelectionContext, ApplicationKubernetesModelViewContract, ApplicationKubernetesModelViewImplementation, ApplicationKubernetesModelViewOptions, ApplicationKubernetesModelViewSchemaContract, ApplicationModelViewContext, ApplicationModelViewContract, ApplicationModelViewImplementation, ApplicationModelViewOptions, ApplicationOnlineProjectionQueryBinding, ApplicationOnlineQueryRuntimeSource, ApplicationOnlineQuerySource, ApplicationQueryAuthorizationRequest, ApplicationQuerySourceBinding } from './application-queries.js';
export type { ApplicationAnalyticalProjectionBinding, ApplicationAnalyticalProjectionOptions, ApplicationEventBatch, ApplicationEventEnvelope, ApplicationGatewayAdmission, ApplicationGatewayBinding, ApplicationGatewayOptions, ApplicationOnlineProjectionBinding, ApplicationOnlineProjectionOptions, ApplicationProjectionBinding, ApplicationProjectionOptions, ApplicationStreamBatchContext, ApplicationStreamBatchHandler, ApplicationStreamBatchOptions, ApplicationStreamBinding, ApplicationStreamOptions, ApplicationStreamProcessContext, ApplicationStreamProcessHandler, ApplicationStreamProcessOptions, ApplicationStreamProcessorBinding, ApplicationStreamScheduleFunctions, ApplicationStreamScheduleTargets, ApplicationStreamTaskFunctions, ApplicationStreamTaskTargets, ApplicationSubscriptionBinding, ApplicationSubscriptionOptions } from './application-reactive.js';
export type { ApplicationSearchComparison, ApplicationSearchDocument, ApplicationSearchFacetBucket, ApplicationSearchField, ApplicationSearchFieldHandle, ApplicationSearchHit, ApplicationSearchIndexBinding, ApplicationSearchIndexOptions, ApplicationSearchPath, ApplicationSearchRequest, ApplicationSearchResult, ApplicationSearchRootOptions, ApplicationSearchSort, ApplicationSearchSource, ApplicationUnaliasedSearchField } from './application-search.js';
export { search } from './application-search.js';
export type { ApplicationMatchedSignalOutcome, ApplicationSignal, ApplicationSignalActionInput, ApplicationSignalActionName, ApplicationSignalActionOptions, ApplicationSignalActionResult, ApplicationSignalActor, ApplicationSignalAuthorizationReceiptReference, ApplicationSignalBinding, ApplicationSignalClientSubscription, ApplicationSignalClientSubscriptionOptions, ApplicationSignalContract, ApplicationSignalDecision, ApplicationSignalDefinition, ApplicationSignalEmitOptions, ApplicationSignalIdentity, ApplicationSignalIssuance, ApplicationSignalOutcome, ApplicationSignalReference, ApplicationSignalSubjectSelector } from './application-signals.js';
export { installApplicationWorkflowSignalRuntimeResolver } from './application-signals.js';
export type { ApplicationTelemetryBoundary, ApplicationTelemetryRuntime } from './application-telemetry-runtime.js';
export { installApplicationTelemetryRuntimeResolver, runApplicationTelemetryBoundary } from './application-telemetry-runtime.js';
export { applicationValueDefault, applicationValueString } from './application-typekro-values.js';
export type { ApplicationDurableErrorDescriptor, ApplicationDurableErrorUnion, ApplicationTaskBinding, ApplicationTaskContext, ApplicationTaskHandler, ApplicationTaskObjectFunctions, ApplicationTaskObjectStores, ApplicationTaskOperationFunctions, ApplicationTaskOperations, ApplicationTaskOptions, ApplicationTaskProjectionFunctions, ApplicationTaskProjections, ApplicationTaskProjectionTarget, ApplicationTaskProviderAccounting, ApplicationTaskProviderAccountingFunctions, ApplicationTaskQueries, ApplicationTaskQueryFunctions, ApplicationTaskReference, ApplicationTaskServicePrincipal, ApplicationWorkflowBinding, ApplicationWorkflowContext, ApplicationWorkflowExecutionFailure, ApplicationWorkflowExecutionObservation, ApplicationWorkflowExecutionReference, ApplicationWorkflowHandler, ApplicationWorkflowOptions, ApplicationWorkflowPhase, ApplicationWorkflowReference, ApplicationWorkflowResultOptions, ApplicationWorkflowRun, ApplicationWorkflowWorkerOptions } from './application-workflows.js';
export { ApplicationDurableError, installApplicationWorkflowRuntimeResolver, isApplicationDurableError } from './application-workflows.js';
export type { ApplicationEventConsumerBinding, RunningApplicationEventConsumer } from './event-log-runtime.js';
export type { ApplicationKubernetesCreatePlacement, ApplicationKubernetesCreatePolicy, ApplicationKubernetesCreateRequest, ApplicationModelBeforeCommitHandler, ApplicationModelBeforeCommitOptions, ApplicationModelCreateEvent, ApplicationModelCreateEventHandler, ApplicationModelDeleteEvent, ApplicationModelDeleteEventHandler, ApplicationModelDeleteInput, ApplicationModelEvent, ApplicationModelEventKind, ApplicationModelLifecycleRegistrar, ApplicationModelMutationOperation, ApplicationModelUpdateEvent, ApplicationModelUpdateEventHandler, ApplicationModelUpdateInput, DrizzleAnalyticalApplicationModelFacet, ModelEvent, PromotedAnalyticalDrizzleTable } from './native-models.js';

export interface ApplicationInfrastructureOptions {
  /** Stable graph identity for a nested composition instance. */
  readonly name?: string;
}

function isSingleStepWorkflowOptions(options: object): boolean {
  const generatedCalls = Reflect.get(options, '__generatedCalls');
  const generatedBindings = Reflect.get(options, '__generatedBindings');
  const expandedDependencies = Array.isArray(generatedCalls)
    ? expandApplicationCallbackDependencies({
        calls: generatedCalls,
        ...(generatedBindings && typeof generatedBindings === 'object'
          ? {
              bindings: generatedBindings as Readonly<Record<string, unknown>>,
            }
          : {}),
      })
    : undefined;
  const expandedGeneratedCalls = expandedDependencies?.calls ?? [];
  if (
    expandedGeneratedCalls.some(
      (value) =>
        typeof value === 'function'
        && Reflect.get(value, 'kind') === 'applicationWorkflow',
    )
  ) {
    return false;
  }
  if (
    // Callable provider implementations are runtime-managed and may perform
    // external effects. They cannot execute in deterministic workflow history,
    // so a provider-only function-native workflow needs the same durable task
    // boundary as model writes and actor calls.
    (expandedDependencies?.providerBindings.some(
      (binding) => binding.operation !== undefined,
    ) ?? false)
    || [
      ...expandedGeneratedCalls,
      ...(
        generatedBindings && typeof generatedBindings === 'object'
          ? Object.values(generatedBindings)
          : []
      ),
    ].some(
      (value) =>
        applicationNativeModelMethodDependencyFor(value)?.access === 'write'
        || getApplicationOperationContract(value as never)?.id.startsWith('applik8s://actors/') === true,
    )
    || (
      generatedBindings
      && typeof generatedBindings === 'object'
      && Object.keys(generatedBindings).some((identifier) =>
        /(?:^|\.)edit$/.test(identifier)
      )
    )
  ) {
    return true;
  }
  return [
    'retries',
    'retryBackoff',
    'executionTimeoutSeconds',
    'scheduleTimeoutSeconds',
    'idempotencyKey',
    'requires',
    'authority',
    'operations',
    'queries',
    'projections',
    'objects',
    'providerAccounting',
    'identity',
    'principal',
  ].some((key) => key in options);
}

export interface ApplicationWorkflowRegistrar {
  <
    TInput extends object,
    TOutput extends object,
    TErrors extends Readonly<Record<string, object>>,
    TSignals extends Readonly<Record<string, object>>,
    TTasks extends Readonly<Record<string, ApplicationTaskReference>>,
    TWorkflows extends Readonly<Record<string, ApplicationWorkflowReference>>,
  >(
    definition: WorkflowDefinition<TInput, TOutput, TErrors, TSignals>,
    options: ApplicationWorkflowOptions<TTasks, TWorkflows>,
    handler: ApplicationWorkflowHandler<TInput, TOutput, TErrors, TSignals, TTasks, TWorkflows>,
  ): ApplicationWorkflowBinding<TInput, TOutput, TErrors, TSignals>;
  <
    TInput extends object,
    TOutput extends object,
    TErrors extends Readonly<Record<string, object>>,
    TSignals extends Readonly<Record<string, object>>,
    TOperations extends ApplicationTaskOperations = Readonly<Record<never, never>>,
    TQueries extends ApplicationTaskQueries = Readonly<Record<never, never>>,
    TProjections extends ApplicationTaskProjections = Readonly<Record<never, never>>,
    TObjects extends ApplicationTaskObjectStores = Readonly<Record<never, never>>,
    TAccounting extends ApplicationTaskProviderAccounting = Readonly<Record<never, never>>,
  >(
    definition: WorkflowDefinition<TInput, TOutput, TErrors, TSignals>,
    options: ApplicationTaskOptions<TInput, TOperations, TQueries, TProjections, TObjects, TAccounting>,
    handler: ApplicationTaskHandler<TInput, TOutput, TErrors, TOperations, TQueries, TProjections, TObjects, TAccounting>,
  ): ApplicationWorkflowBinding<TInput, TOutput, TErrors, TSignals>;
  <
    TInput extends object,
    TOutput extends object,
    TErrors extends Readonly<Record<string, object>> = Readonly<Record<never, never>>,
    TSignals extends Readonly<Record<string, object>> = Readonly<Record<never, never>>,
    TTasks extends Readonly<Record<string, ApplicationTaskReference>> = Readonly<Record<never, never>>,
    TWorkflows extends Readonly<Record<string, ApplicationWorkflowReference>> = Readonly<Record<never, never>>,
  >(
    id: string,
    contract: ApplicationWorkflowContract<TInput, TOutput, TErrors, TSignals>,
    handler: ApplicationWorkflowHandler<TInput, TOutput, TErrors, TSignals, TTasks, TWorkflows>,
  ): ApplicationWorkflowBinding<TInput, TOutput, TErrors, TSignals>;
  <
    TInput extends object,
    TOutput extends object,
    TErrors extends Readonly<Record<string, object>> = Readonly<Record<never, never>>,
    TSignals extends Readonly<Record<string, object>> = Readonly<Record<never, never>>,
    TTasks extends Readonly<Record<string, ApplicationTaskReference>> = Readonly<Record<never, never>>,
    TWorkflows extends Readonly<Record<string, ApplicationWorkflowReference>> = Readonly<Record<never, never>>,
  >(
    id: string,
    contract: ApplicationWorkflowContract<TInput, TOutput, TErrors, TSignals>,
    options: ApplicationWorkflowOptions<TTasks, TWorkflows>,
    handler: ApplicationWorkflowHandler<TInput, TOutput, TErrors, TSignals, TTasks, TWorkflows>,
  ): ApplicationWorkflowBinding<TInput, TOutput, TErrors, TSignals>;
  <
    TInput extends object,
    TOutput extends object,
    TErrors extends Readonly<Record<string, object>> = Readonly<Record<never, never>>,
    TSignals extends Readonly<Record<string, object>> = Readonly<Record<never, never>>,
    TOperations extends ApplicationTaskOperations = Readonly<Record<never, never>>,
    TQueries extends ApplicationTaskQueries = Readonly<Record<never, never>>,
    TProjections extends ApplicationTaskProjections = Readonly<Record<never, never>>,
    TObjects extends ApplicationTaskObjectStores = Readonly<Record<never, never>>,
    TAccounting extends ApplicationTaskProviderAccounting = Readonly<Record<never, never>>,
  >(
    id: string,
    contract: ApplicationWorkflowContract<TInput, TOutput, TErrors, TSignals>,
    options: ApplicationTaskOptions<TInput, TOperations, TQueries, TProjections, TObjects, TAccounting>,
    handler: ApplicationTaskHandler<TInput, TOutput, TErrors, TOperations, TQueries, TProjections, TObjects, TAccounting>,
  ): ApplicationWorkflowBinding<TInput, TOutput, TErrors, TSignals>;
  signal<
    TInput extends object,
    TActions extends Readonly<Record<string, object>>,
  >(
    id: string,
    contract: ApplicationSignalContract<TInput, TActions>,
  ): ApplicationSignalBinding<ApplicationSignalDefinition<TInput, TActions>>;
  emitSignal<TDefinition extends ApplicationSignalDefinition>(
    definition: TDefinition | ApplicationSignalBinding<TDefinition>,
    options: ApplicationSignalEmitOptions<TDefinition>,
  ): Promise<ApplicationSignalDecision<TDefinition>>;
}

export type ApplicationJobRegistrar =
  <
    TInput extends object,
    TOutput extends object,
    TProgress extends object = Record<string, never>,
    TError extends object = never,
  >(
    id: `${string}.v${number}`,
    contract: ApplicationJobContract<TInput, TOutput, TProgress, TError>,
    options: ApplicationJobOptions<TInput>,
    handler: ApplicationJobHandler<TInput, TOutput, TProgress, TError>,
  ) => ApplicationJobBinding<TInput, TOutput, TProgress, TError>;

/** Fluent target-only provider selection; branch factories stay inert during discovery. */
export interface ApplicationTargetProviderBinding<TImplementation> {
  readonly kind: 'applicationProvider';
  readonly token: ApplicationProviderToken<TImplementation>;
  readonly implementation: ApplicationTargetProviderSelectionValue<TImplementation>;
  local(factory: () => TImplementation): ApplicationTargetProviderBinding<TImplementation>;
  awsLocal(factory: () => TImplementation): ApplicationTargetProviderBinding<TImplementation>;
  aws(factory: () => TImplementation): ApplicationTargetProviderBinding<TImplementation>;
  kubernetes(factory: () => TImplementation): ApplicationTargetProviderBinding<TImplementation>;
}

export interface KubernetesApplicationScope extends ApplicationAuthorityRegistrar {
  readonly api: ApplicationServerRegistrar & Record<string, ApplicationServerBinding>;
  readonly http: ApplicationHttpRegistrar;
  readonly server: ApplicationServerRegistrar & Record<string, ApplicationServerBinding>;
  readonly storage: ApplicationStorageRegistrar;
  readonly database: ApplicationDatabaseRegistrar;
  readonly mcp: ApplicationMcpRegistrar;
  agent<
    const TName extends string,
    TRequest extends ApplicationTanStackAIAgentRequest,
    TResult,
  >(
    name: TName,
    options: ApplicationAgentOptions,
    handler: ApplicationAgentHandler<TRequest, TResult>,
  ): ApplicationAgentBinding<TName, TRequest, TResult>;
  actor<TState extends object, const TProtocol extends ApplicationActorProtocolShape>(
    id: string,
    options: { readonly key: ApplicationActorKeySchema; readonly state: ApplicationActorStateInput<TState>; readonly protocol: TProtocol },
  ): ApplicationActorHandle<TState, TProtocol>;
  operator<TBinding>(operator: (options: OperatorDeploymentOptions) => TBinding, options: OperatorDeploymentOptions): TBinding;
  resource<TSpec extends object, TStatus extends object = Record<string, never>>(name: string, options: ApplicationResourceOptions<TSpec, TStatus>): ResourceDefinition<TSpec, TStatus>;
  crd<TSpec extends object, TStatus extends object = Record<string, never>>(name: string, options: ApplicationNamedCrdOptions<TSpec, TStatus>): PromotedKubernetesResource<TSpec, TStatus>;
  crd<TSpec extends object, TStatus extends object = Record<string, never>>(
    entity: EntityDefinition<TSpec, TStatus>,
    options: ApplicationCrdOptions<NoInfer<TSpec>, NoInfer<TStatus>>,
  ): PromotedKubernetesResource<TSpec, TStatus>;
  model<TSpec extends object, TStatus extends object = Record<string, never>>(name: string, options: ApplicationNamedModelOptions<TSpec, TStatus>): ApplicationModelBinding<TSpec, TStatus>;
  model<TSpec extends object, TStatus extends object = Record<string, never>>(entity: EntityDefinition<TSpec, TStatus>, options?: ApplicationModelOptions<TSpec, TStatus>): ApplicationModelBinding<TSpec, TStatus>;
  model<TTable extends AnyPgTable>(table: TTable, options: ApplicationNativeAnalyticalDrizzleModelOptions<TTable>): PromotedAnalyticalDrizzleTable<TTable>;
  model<TTable extends AnyPgTable>(table: TTable, options?: ApplicationNativeDrizzleModelOptions<TTable>): PromotedDrizzleTable<TTable>;
  index<const TFields extends readonly ApplicationSearchField[]>(
    name: string,
    options: ApplicationSearchRootOptions,
    ...fields: TFields
  ): ApplicationSearchIndexBinding<ApplicationSearchDocument<TFields>>;
  query<TInput, TOutput, TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal, TSource extends ApplicationQuerySourceBinding | undefined = undefined>(id: string, options: ApplicationQueryOptions<TInput, TOutput, TPrincipal, TSource>): ApplicationCallableQueryBinding<TInput, TOutput, TPrincipal, TSource>;
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
  /** Builder-safe infrastructure factory. Use the callback form so TypeKro resources are recreated inside graph materialization. */
  infra<TResource extends object>(resource: TResource | (() => TResource), options?: ApplicationInfrastructureOptions): TResource;
  config(name: string, options: ApplicationConfigOptions): ApplicationConfigBinding;
  secret(name: string, options: ApplicationSecretOptions): ApplicationSecretBinding;
  expose(name: string, options: ApplicationExposureOptions): ApplicationExposureBinding;
  /** Low-level finite and recurring infrastructure workloads. Application-level finite work uses application.job(...). */
  readonly workload: ApplicationWorkloadRegistrar;
  defaults(defaults: ApplicationDefaults): ApplicationDefaultsBinding;
  provide<TImplementation>(token: ApplicationProviderToken<TImplementation>): ApplicationTargetProviderBinding<TImplementation>;
  provide<TImplementation>(
    token: ApplicationQualifiedProviderToken<TImplementation>,
    implementation: TImplementation | ApplicationProviderBinding<TImplementation>,
  ): ApplicationProviderBinding<TImplementation> & {
    readonly qualification: ApplicationProviderQualification;
  };
  provide<TImplementation>(token: ApplicationProviderToken<TImplementation>, implementation: TImplementation | ApplicationProviderBinding<TImplementation>): ApplicationProviderBinding<TImplementation>;
  aggregate<TStats extends object, TEvent extends object>(name: string, options: ApplicationAggregateOptions<TStats, TEvent>): ApplicationAggregateBinding<TStats, TEvent>;
  readonly job: ApplicationJobRegistrar;
  readonly workflow: ApplicationWorkflowRegistrar;
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
  /** Compose deployment-target selection inside another typed provider selection such as a profile branch. */
  selectTarget<TImplementation>(
    targets: Readonly<{
      readonly local?: () => TImplementation;
      readonly awsLocal?: () => TImplementation;
      readonly aws?: () => TImplementation;
      readonly kubernetes?: () => TImplementation;
    }>,
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

export interface ApplicationWorkloadRegistrar {
  job(name: string, options?: ApplicationWorkloadJobOptions): ApplicationWorkloadJobBinding;
  cronJob(name: string, options?: ApplicationWorkloadCronJobOptions): ApplicationWorkloadJobBinding;
}

export interface ApplicationWorkflowContract<
  TInput extends object,
  TOutput extends object,
  TErrors extends Readonly<Record<string, object>> = Readonly<Record<never, never>>,
  TSignals extends Readonly<Record<string, object>> = Readonly<Record<never, never>>,
> {
  readonly input: SchemaInput<TInput>;
  readonly output: SchemaInput<TOutput>;
  readonly errors?: { readonly [TName in keyof TErrors]: SchemaInput<TErrors[TName]> };
  readonly signals?: { readonly [TName in keyof TSignals]: SchemaInput<TSignals[TName]> };
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
  postgres<TSchema extends Readonly<Record<string, unknown>> = Record<string, never>>(name: string, options: ApplicationDatabasePostgresOptions<TSchema>): ApplicationDatabaseHandle<TSchema>;
  bind<TSchema extends Readonly<Record<string, unknown>> = Record<string, never>>(name: string, options: ApplicationDatabaseBindOptions<TSchema>): ApplicationDatabaseHandle<TSchema>;
}

export interface ApplicationDatabasePostgresOptions<TSchema extends Readonly<Record<string, unknown>>> extends Omit<ApplicationStoragePostgresOptions, 'migrations'> {
  readonly schema?: TSchema;
  readonly migrations?: string | { readonly path: string; readonly digest?: string };
  readonly access?: ApplicationPostgresRlsPolicy;
  /** Default placement for command processors derived from models in schema. */
  readonly processor?: ApplicationProcessorOptions;
}

/**
 * Binds native model schema and migration metadata to an already-provided
 * transactional database. This is the profile-safe counterpart to
 * database.postgres(...): it does not provision or register a second provider.
 */
export interface ApplicationDatabaseBindOptions<TSchema extends Readonly<Record<string, unknown>>> {
  readonly provider: ApplicationProviderBinding<ApplicationTransactionalDatabaseProvider>;
  readonly schema?: TSchema;
  readonly migrations?: string | { readonly path: string; readonly digest?: string };
  readonly access?: ApplicationPostgresRlsPolicy;
  /** Default placement for command processors derived from models in schema. */
  readonly processor?: ApplicationProcessorOptions;
}

export interface ApplicationDatabaseBinding<TSchema extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>> {
  readonly kind: 'applicationDatabase';
  readonly name: string;
  readonly provider: ApplicationTransactionalDatabaseProvider;
  readonly qualification?: import('./application-providers.js').ApplicationProviderQualification;
  readonly schema: TSchema;
  readonly migrations?: { readonly path: string; readonly digest?: string };
  readonly access?: ApplicationPostgresRlsPolicy;
  /** Profile-owned default placement inherited by maintained modules. */
  readonly processor?: ApplicationProcessorOptions;
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
  /**
   * Advanced generated-operator placement and explicit SDK RBAC. Lifecycle
   * behavior itself remains resource-owned through `Resource.on.*`.
   */
  readonly controller?: ApplicationResourceControllerOptions;
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
  /**
   * Advanced generated-operator placement and explicit SDK RBAC. Lifecycle
   * behavior itself remains resource-owned through `Resource.on.*`.
   */
  readonly controller?: ApplicationResourceControllerOptions;
  readonly access?: {
    readonly context: import('./trusted-context.js').ApplicationTrustedContext<unknown>;
    readonly namespaceLabel: string;
  };
  readonly create?: ApplicationKubernetesCreatePolicy<TSpec>;
};

export type ApplicationNamedCrdOptions<
  TSpec extends object,
  TStatus extends object,
> = ApplicationCrdOptions<TSpec, TStatus> & {
  readonly spec: SchemaInput<TSpec>;
  readonly status?: SchemaInput<TStatus>;
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
  readonly scope?: 'Namespaced' | 'Cluster';
  readonly namespaces?: readonly string[] | 'all';
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
  readonly handlerDependencySource?: string;
  readonly handlerDependencyResolveDir?: string;
  readonly functionNative?: {
    readonly input: JsonObject;
    readonly output: JsonObject;
    readonly authorizeSource?: string;
    readonly authorizeDependencies?: {
      readonly source: string;
      readonly resolveDir: string;
    };
    readonly authorizeLocation?: ApplicationRouteSourceLocation;
    readonly webhookAuthentication?: {
      readonly source: string;
      readonly dependencies?: {
        readonly source: string;
        readonly resolveDir: string;
      };
      readonly location?: ApplicationRouteSourceLocation;
    };
    readonly operationBindings?: NonNullable<
      import('@applik8s/core').ApplicationFunctionNativeHttpRouteContract[
        'operationBindings'
      ]
    >;
    readonly providerBindings?: NonNullable<
      import('@applik8s/core').ApplicationFunctionNativeHttpRouteContract[
        'providerBindings'
      ]
    >;
    readonly objectBindings?: NonNullable<
      import('@applik8s/core').ApplicationFunctionNativeHttpRouteContract[
        'objectBindings'
      ]
    >;
    readonly workflowBindings?: NonNullable<
      import('@applik8s/core').ApplicationFunctionNativeHttpRouteContract[
        'workflowBindings'
      ]
    >;
    readonly workflowEngine?: import('@applik8s/core').ApplicationProviderRef<'WorkflowEngine'>;
    readonly transaction?: import('@applik8s/core').ApplicationFunctionNativeTransactionContract;
  };
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
  readonly nativeModelRegistrations: Map<string, {
    readonly table: AnyPgTable;
    readonly database: string;
    readonly processor?: ApplicationProcessorOptions;
  }>;
  readonly databases: Map<string, ApplicationDatabaseBinding>;
  readonly emittedTransactionalDatabases: Set<string>;
  readonly emittedAnalyticalDatabases: Set<string>;
  readonly emittedIndexStores: Set<string>;
  readonly modelLifecycleStreams: Map<string, ApplicationStreamBinding<object>>;
  readonly appResource: ApplicationCompositionResourceTarget;
}

interface ApplicationCompositionResourceTarget extends ApplicationStatusReconcilerAppResourceTarget {}

interface ApplicationContext {
  readonly scope: KubernetesApplicationScope;
  readonly state: ApplicationScopeState;
  /** Finalizes registrars whose public shape intentionally has no wrapping callback. */
  finalize(): void;
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
  /** @deprecated Give the route a stable name: get(name, path, handler). Removed at 1.0. */
  get(path: string, handler: ApplicationRouteHandler): ApplicationRawHttpRoute;
  post(name: string, path: string, handler: ApplicationRouteHandler): ApplicationRawHttpRoute;
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
  /**
   * Pre-provisioned namespace for installation custom resources.
   *
   * Omit this for the self-contained golden path, where the root Application
   * CR lives in the graph-managed workload Namespace. The Namespace remains
   * an outer Alchemy node rather than a KRO child, so teardown still drains
   * the root and its finalizers first.
   */
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
   * Installs a maintained module into this application graph.
   *
   * Re-including the same module is idempotent. Cycles and distinct modules
   * with the same stable function name fail before graph materialization.
   */
  include<TResult>(module: ApplicationModuleReference<TResult>): TResult;
  include<TResult>(
    module: (
      application: KubernetesApplicationBuilder<TSpec, TStatus>,
    ) => TResult,
  ): TResult;
  /**
   * Declares one target-free assembly profile. Profiles bind semantic
   * capabilities to inspectable implementations; deployment targets consume
   * the resulting implementation plan without participating in selection.
   */
  profile(
    name: string,
    configure: (profile: ApplicationAssemblyProfileBuilder) => void,
    options?: { readonly provenance?: import('@applik8s/core').ApplicationSourceProvenance },
  ): ApplicationAssemblyProfileDefinition;
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
  /** Read-only catalog of authored target-free assembly profiles. */
  readonly assemblyProfiles: ApplicationAssemblyProfileCatalog;
  /** Resolves the immutable implementation plan for one assembly profile. */
  implementationPlan(profile: string): import('@applik8s/core').ApplicationImplementationPlan;
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
const applicationResourceControllerByResource = new WeakMap<object, ApplicationResourceControllerState>();
let lastApplicationGraph: ApplicationGraph | undefined;

type ApplicationResourceEventMethod =
  | 'reconcile'
  | 'create'
  | 'update'
  | 'delete'
  | 'created'
  | 'updated'
  | 'deleted'
  | 'finalize'
  | 'statusChanged';

interface ApplicationResourceEventInvocation {
  readonly style: 'proxy' | 'context';
  readonly method: ApplicationResourceEventMethod;
  readonly args: readonly unknown[];
}

interface ApplicationResourceControllerState {
  options: ApplicationResourceControllerOptions;
  readonly original: ResourceDefinition<object, object>['on'];
  readonly observers: Set<(invocation: ApplicationResourceEventInvocation) => void>;
  controller?: import('./application-events.js').ApplicationResourceEventOperatorController;
}

export function applicationGraphFor(composition: object): ApplicationGraph | undefined {
  const attached = Reflect.get(composition, applicationGraphMetadataProperty);
  return isApplicationGraph(attached) ? attached : applicationGraphByComposition.get(composition);
}

function attachApplicationGraph(composition: object, graph: ApplicationGraph): void {
  applicationGraphByComposition.set(composition, graph);
  Object.defineProperty(composition, applicationGraphMetadataProperty, { value: graph, enumerable: false, configurable: true });
}

function bindApplicationResourceEvents<TSpec extends object, TStatus extends object>(
  state: ApplicationScopeState,
  resource: ResourceDefinition<TSpec, TStatus>,
  options: ApplicationResourceControllerOptions = {},
): ResourceDefinition<TSpec, TStatus> {
  const existing = applicationResourceControllerByResource.get(resource);
  if (existing) {
    existing.options = { ...existing.options, ...options };
    return resource;
  }
  const original = resource.on;
  const controllerState: ApplicationResourceControllerState = {
    options,
    // typecast: lifecycle registration is shape-identical after erasing only the resource-specific spec/status generics.
    original: original as ResourceDefinition<object, object>['on'],
    observers: new Set(),
  };
  const wrap = (
    source: object,
    style: 'proxy' | 'context',
  ): Record<ApplicationResourceEventMethod, (...args: readonly unknown[]) => HandlerRegistration<object, object>> => {
    const methods = [
      'reconcile',
      'create',
      'update',
      'delete',
      'created',
      'updated',
      'deleted',
      'finalize',
      'statusChanged',
    ] as const;
    return Object.fromEntries(methods.map((method) => [
      method,
      (...args: readonly unknown[]) => {
        const registrar = Reflect.get(source, method);
        if (typeof registrar !== 'function') {
          throw new Error(`Application resource ${resource.kind}.on.${method} is not callable.`);
        }
        const registration = Reflect.apply(registrar, source, args) as HandlerRegistration<object, object>;
        const callback = args[0];
        if (!controllerState.controller) {
          controllerState.controller = createApplicationResourceEventOperatorController(
            resource,
            [registration as unknown as HandlerRegistration<TSpec, TStatus>],
            [callback],
            controllerState.options,
          );
        } else {
          controllerState.controller.add(registration, callback);
        }
        collectApplicationResources(state, applicationOperatorResources(controllerState.controller.operator));
        recordApplicationOperatorGraph(state, controllerState.controller.operator);
        for (const observer of controllerState.observers) {
          observer({ style, method, args });
        }
        state.onChange?.();
        return registration;
      },
    ])) as Record<ApplicationResourceEventMethod, (...args: readonly unknown[]) => HandlerRegistration<object, object>>;
  };
  const proxy = wrap(original, 'proxy');
  const context = wrap(original.context, 'context');
  Object.defineProperty(resource, 'on', {
    configurable: true,
    enumerable: true,
    value: { ...proxy, context },
  });
  applicationResourceControllerByResource.set(resource, controllerState);
  return resource;
}

function registerRawApplicationResourceEvent(
  resource: object,
  style: 'proxy' | 'context',
  method: ApplicationResourceEventMethod,
  args: readonly unknown[],
): HandlerRegistration<object, object> {
  const controller = applicationResourceControllerByResource.get(resource);
  if (!controller) {
    throw new Error('Application resource lifecycle registration requires an application-owned CRD.');
  }
  const source = style === 'context' ? controller.original.context : controller.original;
  const registrar = Reflect.get(source, method);
  if (typeof registrar !== 'function') {
    throw new Error(`Application resource lifecycle registrar ${method} is not callable.`);
  }
  return Reflect.apply(registrar, source, args) as HandlerRegistration<object, object>;
}

function configureApplicationResourceEvents(
  resource: object,
  options: ApplicationResourceControllerOptions,
): void {
  const controller = applicationResourceControllerByResource.get(resource);
  if (!controller) {
    throw new Error('Application resource lifecycle configuration requires an application-owned CRD.');
  }
  if (controller.controller) {
    throw new Error('Application resource lifecycle deployment options must be configured before declaring handlers.');
  }
  controller.options = { ...controller.options, ...options };
}

function observeApplicationResourceEvents(
  resource: object,
  observer: (invocation: ApplicationResourceEventInvocation) => void,
): void {
  const controller = applicationResourceControllerByResource.get(resource);
  if (!controller) {
    throw new Error('Application resource lifecycle observation requires an application-owned CRD.');
  }
  controller.observers.add(observer);
}

function replayApplicationResourceEvent(
  resource: ResourceDefinition<object, object>,
  invocation: ApplicationResourceEventInvocation,
): void {
  const source = invocation.style === 'context' ? resource.on.context : resource.on;
  const registrar = Reflect.get(source, invocation.method);
  if (typeof registrar !== 'function') {
    throw new Error(`Application resource ${resource.kind}.on.${invocation.method} is not callable during builder replay.`);
  }
  Reflect.apply(registrar, source, invocation.args);
}

function applicationCompositionWrapper<TSpec extends KroCompatibleType, TStatus extends KroCompatibleType>(
  definition: TypeKroListenerCompositionDefinition<TSpec, TStatus>,
  compositionFn: (spec: TSpec, app: KubernetesApplicationScope) => MagicAssignableShape<TStatus>,
  graphName: string
): (spec: TSpec) => MagicAssignableShape<TStatus> {
  const wrapped = (spec: TSpec) => {
    const context = createApplicationContext(definition);
    const result = withApplicationOperatorResourceCollection(context.state, () => compositionFn(spec, context.scope));
    context.finalize();
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

function sameOrderedStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
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
  const inferredGatewayReplays: ((state: ApplicationScopeState) => void)[] = [];
  const installationReplays: ((spec: TSpec, scope: KubernetesApplicationScope) => void)[] = [];
  const assemblyProfiles = createApplicationAssemblyProfileCatalog(name);
  const declaredResources: Record<string, AnyResourceDefinition> = {};
  const declaredModels: Record<string, ApplicationModelBinding<object, object>> = {};
  const capturedNativeModels = new WeakMap<
    object,
    PromotedDrizzleTable<AnyPgTable>
  >();
  const declaredHttpServers = new Set<string>();
  const declaredFunctionNativeHttp = new Map<string, {
    readonly options: ApplicationServerOptions;
    readonly routes: ApplicationHttpRouteDeclaration[];
  }>();
  const profileRuntimes = new Map<
    string,
    {
      readonly variants: readonly string[];
      readonly schemaRevision: string;
      readonly profile: unknown;
    }
  >();
  const includedModules = new Map<CallableFunction, unknown>();
  const includedModuleNames = new Map<string, CallableFunction>();
  const moduleStack: CallableFunction[] = [];
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
    // Keep the authored discriminated union authoritative for client-side and
    // CLI validation. The TypeKro definition may use a structural KRO
    // projection because KRO SimpleSchema cannot encode object unions.
    spec: options.spec ?? definition.spec,
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
      callback(installationSpec, preview);
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
        const materializedState = applicationStateByScope.get(scope);
        if (!materializedState) {
          throw new Error(
            `Application ${name} could not finalize its inferred gateways.`,
          );
        }
        for (const replay of inferredGatewayReplays) {
          replay(materializedState);
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
    postgres<TSchema extends Readonly<Record<string, unknown>>>(
      databaseName: string,
      databaseOptions: ApplicationDatabasePostgresOptions<TSchema>,
    ): ApplicationDatabaseHandle<TSchema> {
      const normalizedOptions = withDefaultNamespace({
        ...databaseOptions,
        // typecast: this private mutable copy preserves every member and is the
        // same schema authority extended by included application modules.
        schema: { ...(databaseOptions.schema ?? {}) } as TSchema,
      });
      const binding = preview.database.postgres(databaseName, normalizedOptions);
      replays.push((scope) => {
        scope.database.postgres(databaseName, normalizedOptions);
      });
      registerApplicationDatabaseSchemaModels(
        builder,
        binding,
        normalizedOptions.schema,
        normalizedOptions.processor,
      );
      invalidate();
      return binding as ApplicationDatabaseHandle<TSchema>;
    },
    bind<TSchema extends Readonly<Record<string, unknown>>>(
      databaseName: string,
      databaseOptions: ApplicationDatabaseBindOptions<TSchema>,
    ): ApplicationDatabaseHandle<TSchema> {
      const normalizedOptions = {
        ...databaseOptions,
        // typecast: see postgres() above; module extensions retain the
        // caller-visible schema members while adding maintained relations.
        schema: { ...(databaseOptions.schema ?? {}) } as TSchema,
      };
      const binding = preview.database.bind(databaseName, normalizedOptions);
      replays.push((scope) => {
        scope.database.bind(databaseName, normalizedOptions);
      });
      registerApplicationDatabaseSchemaModels(
        builder,
        binding,
        normalizedOptions.schema,
        normalizedOptions.processor,
      );
      invalidate();
      return binding as ApplicationDatabaseHandle<TSchema>;
    },
  };
  const mcp = ((
    mcpName: string,
    mcpOptions: ApplicationMcpServerOptions,
  ): ApplicationMcpServerBinding => {
    const binding = preview.mcp(mcpName, mcpOptions);
    replays.push((scope) => {
      scope.mcp(mcpName, mcpOptions);
    });
    invalidate();
    return binding;
  }) as ApplicationMcpRegistrar;
  mcp.client = (
    mcpName: string,
    mcpOptions: ApplicationMcpClientOptions,
  ): ApplicationMcpClientBinding => {
    const binding = preview.mcp.client(mcpName, mcpOptions);
    replays.push((scope) => {
      scope.mcp.client(mcpName, mcpOptions);
    });
    invalidate();
    return binding;
  };
  const legacyServer = ((serverName: string, optionsOrConfigure: ApplicationServerOptions | ((server: ApplicationServer) => void), maybeConfigure?: (server: ApplicationServer) => void) => {
    if (declaredHttpServers.has(serverName)) {
      throw new Error(
        `Application server ${JSON.stringify(serverName)} is already declared.`,
      );
    }
    const explicitOptions = typeof optionsOrConfigure === 'function' ? {} : optionsOrConfigure;
    const serverOptions = applicationBuilderServerOptions(withDefaultNamespace<ApplicationServerOptions>(explicitOptions), declaredResources, declaredModels);
    const configure = typeof optionsOrConfigure === 'function' ? optionsOrConfigure : maybeConfigure;
    if (!configure) {
      throw new Error(`app.server(${JSON.stringify(serverName)}, ...) requires a route configuration callback.`);
    }
    declaredHttpServers.add(serverName);
    const binding = preview.server(serverName, serverOptions, configure);
    replays.push((scope) => {
      scope.server(serverName, serverOptions, configure);
    });
    invalidate();
    return binding;
  }) as ApplicationServerRegistrar & Record<string, ApplicationServerBinding>;
  const http: ApplicationHttpRegistrar = (serverName, options = {}) => {
    if (declaredHttpServers.has(serverName)) {
      throw new Error(
        `Function-native HTTP server ${JSON.stringify(serverName)} is already declared.`,
      );
    }
    declaredHttpServers.add(serverName);
    const routes: ApplicationHttpRouteDeclaration[] = [];
    const normalizedOptions = applicationBuilderServerOptions(
      withDefaultNamespace<ApplicationServerOptions>(options),
      declaredResources,
      declaredModels,
    );
    const binding = createApplicationHttpServer(serverName, (route) => {
      routes.push(route);
      invalidate();
    });
    declaredFunctionNativeHttp.set(serverName, {
      options: normalizedOptions,
      routes,
    });
    terminalReplays.push((scope) => {
      const server = scope.http(serverName, normalizedOptions);
      for (const route of routes) {
        const operation = route.webhookAuthenticate
          ? server.webhook(
              route.id,
              route.path,
              {
                // typecast: webhook declarations validate the required string
                // event id before this type-erased replay boundary.
                event: route.inputSchema as SchemaInput<{
                  readonly id: string;
                }>,
                output: route.outputSchema,
                authenticate: route.webhookAuthenticate,
                __generatedCalls: route.handlerDependencyGraph.calls,
                __generatedBindings: route.handlerDependencyGraph.bindings,
                __generatedAwaitedCalls: route.handlerDependencyGraph.awaited,
              },
              route.handler as ApplicationHttpHandler<{
                readonly id: string;
              }, object>,
            )
          : server.post(
              route.id,
              route.path,
              {
                input: route.inputSchema,
                output: route.outputSchema,
                ...(route.authorize
                  ? { authorize: route.authorize }
                  : {}),
                __generatedCalls: route.handlerDependencyGraph.calls,
                __generatedBindings: route.handlerDependencyGraph.bindings,
                __generatedAwaitedCalls: route.handlerDependencyGraph.awaited,
              },
              route.handler,
            );
        // typecast: authority mutation is independent of the replayed route's
        // erased input schema association.
        applyApplicationHttpRouteAuthority(
          operation as unknown as ApplicationOperation<object, object>,
          route.authority,
        );
      }
    });
    return binding;
  };
  const builder = {
    name,
    installation,
    assemblyProfiles,
    implementationPlan(profileName: string) {
      return assemblyProfiles.plan(profileName);
    },
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
    include<TResult>(
      module:
        | ((
            application: KubernetesApplicationBuilder<TSpec, TStatus>,
          ) => TResult)
        | ApplicationModuleReference<TResult>,
    ): TResult {
      if (typeof module !== 'function') {
        throw new Error(
          `Application ${name} include(...) requires a statically imported module function.`,
        );
      }
      if (includedModules.has(module)) {
        return includedModules.get(module) as TResult;
      }
      const metadata = applicationModuleMetadataFor<TResult>(module);
      const moduleName = (metadata?.name ?? module.name).trim();
      if (!moduleName) {
        throw new Error(
          `Application ${name} cannot include an anonymous module. Export a stable named module function.`,
        );
      }
      const cycleIndex = moduleStack.indexOf(module);
      if (cycleIndex >= 0) {
        const cycle = [...moduleStack.slice(cycleIndex), module]
          .map((candidate) => (
            applicationModuleMetadataFor(candidate)?.name
            ?? candidate.name
          ))
          .join(' -> ');
        throw new Error(
          `Application ${name} module inclusion cycle: ${cycle}.`,
        );
      }
      const existing = includedModuleNames.get(moduleName);
      if (existing && existing !== module) {
        throw new Error(
          `Application ${name} includes distinct modules named ${JSON.stringify(moduleName)}. Module names are stable graph identities.`,
        );
      }
      includedModuleNames.set(moduleName, module);
      moduleStack.push(module);
      try {
        const result = metadata
          ? (() => {
              if (metadata.schema) {
                const database = soleApplicationDatabase(
                  previewContext.state,
                  `Application module ${moduleName}`,
                );
                const addedSchema = extendApplicationDatabaseSchema(
                  database,
                  metadata.schema,
                  moduleName,
                );
                registerApplicationDatabaseSchemaModels(
                  builder,
                  database,
                  addedSchema,
                  database.processor,
                );
              }
              const result = metadata.install(
                builder as unknown as KubernetesApplicationBuilder<object, object>,
                {
                  get database() {
                    return soleApplicationDatabase(
                      previewContext.state,
                      `Application module ${moduleName}`,
                    );
                  },
                  get processor() {
                    return soleApplicationDatabase(
                      previewContext.state,
                      `Application module ${moduleName}`,
                    ).processor;
                  },
                  include(included) {
                    return builder.include(included as never);
                  },
                },
              );
              if (metadata.inferReturnedSchema) {
                const inferred = inferredApplicationModuleSchema(result);
                if (Object.keys(inferred).length > 0) {
                  const database = soleApplicationDatabase(
                    previewContext.state,
                    `Application module ${moduleName}`,
                  );
                  const registeredValues = new Set(
                    Object.values(database.schema),
                  );
                  const inferredSchema = Object.freeze(
                    Object.fromEntries(
                      Object.entries(inferred).filter(
                        ([, value]) => !registeredValues.has(value),
                      ),
                    ),
                  );
                  const addedSchema = extendApplicationDatabaseSchema(
                    database,
                    inferredSchema,
                    moduleName,
                  );
                  registerApplicationDatabaseSchemaModels(
                    builder,
                    database,
                    addedSchema,
                    database.processor,
                  );
                }
              }
              return result;
            })()
          : Reflect.apply(module, undefined, [builder]) as TResult;
        includedModules.set(module, result);
        return result;
      } catch (cause) {
        if (includedModuleNames.get(moduleName) === module) {
          includedModuleNames.delete(moduleName);
        }
        throw cause;
      } finally {
        moduleStack.pop();
      }
    },
    profile<
      TDiscriminator extends Extract<keyof TSpec, string>,
      TVariant extends string = ApplicationProfileVariant<TSpec, TDiscriminator>,
    >(
      profileOrSpec: string | TSpec,
      configureOrDiscriminator:
        | ((profile: ApplicationAssemblyProfileBuilder) => void)
        | TDiscriminator,
      profileOptions: {
        readonly provenance?: import('@applik8s/core').ApplicationSourceProvenance;
        readonly variants?: readonly TVariant[];
        readonly schemaRevision?: string;
      } = {},
    ): ApplicationAssemblyProfileDefinition & ApplicationProfile<TSpec, TDiscriminator, TVariant> {
      if (typeof profileOrSpec === 'string') {
        if (typeof configureOrDiscriminator !== 'function') {
          throw new TypeError(
            `Application ${name} profile ${profileOrSpec} requires a configuration callback.`,
          );
        }
        const definition = assemblyProfiles.profile(
          profileOrSpec,
          configureOrDiscriminator,
          profileOptions.provenance
            ? { provenance: profileOptions.provenance }
            : {},
        );
        invalidate();
        // typecast-boundary: the public interface overload narrows this branch
        // to ApplicationAssemblyProfileDefinition. The object-literal
        // implementation must satisfy both overloads simultaneously.
        return definition as ApplicationAssemblyProfileDefinition & ApplicationProfile<TSpec, TDiscriminator, TVariant>;
      }
      const profileSpec = profileOrSpec;
      if (typeof configureOrDiscriminator !== 'string') {
        throw new TypeError(
          `Application ${name} legacy installation profile requires a discriminator field.`,
        );
      }
      const discriminator = configureOrDiscriminator;
      if (profileSpec !== installationSpec) {
        throw new Error(
          `Application ${name} profile ${String(discriminator)} must use application.installation.spec.`,
        );
      }
      const discriminatorName = String(discriminator);
      const variants = applicationProfileVariantsFromSchema(
        options.spec?.json,
        discriminatorName,
        profileOptions.variants,
      ) as readonly TVariant[];
      const schemaRevision = profileOptions.schemaRevision ?? 'v1alpha1';
      const existingRuntime = profileRuntimes.get(discriminatorName);
      if (existingRuntime) {
        if (
          existingRuntime.schemaRevision !== schemaRevision
          || !sameOrderedStrings(existingRuntime.variants, variants)
        ) {
          throw new Error(
            `Application ${name} profile ${discriminatorName} cannot be reopened with different variants or schema revision.`,
          );
        }
        return existingRuntime.profile as ApplicationAssemblyProfileDefinition & ApplicationProfile<
          TSpec,
          TDiscriminator,
          TVariant
        >;
      }
      const runtime = createApplicationProfileRuntime<
        TSpec,
        TDiscriminator,
        TVariant
      >({
        application: name,
        spec: profileSpec,
        discriminator,
        variants,
        schemaRevision,
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
          const binding = createApplicationQualifiedProviderBinding({
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
      profileRuntimes.set(discriminatorName, {
        variants,
        schemaRevision,
        profile: runtime.profile,
      });
      return runtime.profile as ApplicationAssemblyProfileDefinition & ApplicationProfile<TSpec, TDiscriminator, TVariant>;
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
    api: legacyServer,
    http,
    server: legacyServer,
    storage,
    database,
    mcp,
    role(roleName) {
      return preview.role(roleName);
    },
    serviceIdentity(identityName) {
      return preview.serviceIdentity(identityName);
    },
    oauthClient(clientId, oauthClientOptions) {
      return preview.oauthClient(clientId, oauthClientOptions);
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
      configureApplicationResourceEvents(resource, withDefaultNamespace({}));
      const eventReplays: ApplicationResourceEventInvocation[] = [];
      observeApplicationResourceEvents(resource, (invocation) => {
        eventReplays.push(invocation);
        invalidate();
      });
      // typecast: declaredResources stores heterogeneous CRD definitions for later inferred app.http bindings.
      declaredResources[resourceName] = resource as unknown as AnyResourceDefinition;
      let replayed: ResourceDefinition<TSpec, TStatus> | undefined;
      replays.push((scope) => {
        replayed = scope.resource(resourceName, resourceOptions);
        configureApplicationResourceEvents(replayed, withDefaultNamespace({}));
      });
      behaviorReplays.push(() => {
        if (!replayed) throw new Error(`Application resource ${resourceName} replay declaration did not run before its lifecycle handlers.`);
        for (const invocation of eventReplays) {
          replayApplicationResourceEvent(
            replayed as unknown as ResourceDefinition<object, object>,
            invocation,
          );
        }
      });
      invalidate();
      return resource;
    },
    crd<TSpec extends object, TStatus extends object = Record<string, never>>(
      entityOrName: EntityDefinition<TSpec, TStatus> | string,
      crdOptions:
        | ApplicationCrdOptions<TSpec, TStatus>
        | ApplicationNamedCrdOptions<TSpec, TStatus>,
    ): PromotedKubernetesResource<TSpec, TStatus> {
      const entityName =
        typeof entityOrName === 'string' ? entityOrName : entityOrName.name;
      const resource = typeof entityOrName === 'string'
        ? preview.crd(
            entityOrName,
            crdOptions as ApplicationNamedCrdOptions<TSpec, TStatus>,
          )
        : preview.crd(
            entityOrName,
            crdOptions as ApplicationCrdOptions<TSpec, TStatus>,
          );
      configureApplicationResourceEvents(resource, withDefaultNamespace({}));
      const resourceEventReplays: ApplicationResourceEventInvocation[] = [];
      observeApplicationResourceEvents(resource, (invocation) => {
        if (
          invocation.method !== 'reconcile'
          && invocation.method !== 'finalize'
          && invocation.method !== 'statusChanged'
        ) return;
        resourceEventReplays.push(invocation);
        invalidate();
      });
      const previewViewRegistrar = applicationModelViewRegistrar(resource);
      if (!previewViewRegistrar) throw new Error(`Kubernetes model ${entityName} did not install its application view registrar.`);
      const previewLifecycleRegistrar = nativeKubernetesLifecycleRegistrar(resource);
      if (!previewLifecycleRegistrar) throw new Error(`Kubernetes model ${entityName} did not install its application lifecycle registrar.`);
      const viewReplays: Parameters<typeof previewViewRegistrar>[] = [];
      const createLifecycleReplays: Parameters<typeof previewLifecycleRegistrar.create>[] = [];
      const updateLifecycleReplays: Parameters<typeof previewLifecycleRegistrar.update>[] = [];
      const deleteLifecycleReplays: Parameters<typeof previewLifecycleRegistrar.delete>[] = [];
      const searchReplays = captureApplicationSearchDeclarations(
        resource,
        invalidate,
      );
      bindApplicationModelViews(resource, (viewName, viewOptions, operationKind) => {
        const operation = previewViewRegistrar(viewName, viewOptions, operationKind);
        // typecast: the replay queue intentionally erases per-view generics while preserving each opaque option object unchanged.
        viewReplays.push([viewName, viewOptions, operationKind] as never);
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
      declaredResources[entityName] = resource as unknown as AnyResourceDefinition;
      let replayed: PromotedKubernetesResource<TSpec, TStatus> | undefined;
      replays.push((scope) => {
        replayed = typeof entityOrName === 'string'
          ? scope.crd(
              entityOrName,
              crdOptions as ApplicationNamedCrdOptions<TSpec, TStatus>,
            )
          : scope.crd(
              entityOrName,
              crdOptions as ApplicationCrdOptions<TSpec, TStatus>,
            );
        configureApplicationResourceEvents(replayed, withDefaultNamespace({}));
      });
      behaviorReplays.push(() => {
        if (!replayed) throw new Error(`Kubernetes model ${entityName} replay declaration did not run before its views.`);
        const registrar = applicationModelViewRegistrar(replayed);
        if (!registrar) throw new Error(`Kubernetes model ${entityName} did not install its replay view registrar.`);
        for (const declaration of viewReplays) registrar(...declaration);
        const lifecycleRegistrar = nativeKubernetesLifecycleRegistrar(replayed);
        if (!lifecycleRegistrar) throw new Error(`Kubernetes model ${entityName} did not install its replay lifecycle registrar.`);
        for (const declaration of createLifecycleReplays) lifecycleRegistrar.create(...declaration);
        for (const declaration of updateLifecycleReplays) lifecycleRegistrar.update(...declaration);
        for (const declaration of deleteLifecycleReplays) lifecycleRegistrar.delete(...declaration);
        for (const invocation of resourceEventReplays) {
          replayApplicationResourceEvent(
            replayed as unknown as ResourceDefinition<object, object>,
            invocation,
          );
        }
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
          if (previewFacet?.provider !== 'analytical-database') {
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
          bindApplicationModelViews(previewModel, (viewName, viewOptions, operationKind) => {
            const operation = previewViewRegistrar(viewName, viewOptions, operationKind);
            viewReplays.push([viewName, viewOptions, operationKind] as never);
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
        const capturedModel = capturedNativeModels.get(entityOrName);
        if (capturedModel) {
          // typecast-boundary: the WeakMap key is the exact table object, so
          // recovering its erased table generic preserves the caller's TTable.
          return capturedModel as unknown as PromotedDrizzleTable<TTable>;
        }
        const previewFacet = getRequiredDrizzleApplicationModelFacet(previewModel);
        const previewApi = previewFacet.api;
        const previewRegistrar = nativeApplicationModelCommandRegistrar(previewModel);
        if (!previewRegistrar) throw new Error(`Native model ${previewFacet.name} did not install its application command registrar.`);
        const previewLifecycleRegistrar = nativeApplicationModelLifecycleRegistrar(previewModel);
        if (!previewLifecycleRegistrar) throw new Error(`Native model ${previewFacet.name} did not install its application lifecycle registrar.`);
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
        bindApplicationModelViews(previewModel, (viewName, viewOptions, operationKind) => {
          const operation = previewViewRegistrar(viewName, viewOptions, operationKind);
          // typecast: heterogeneous view generics are replayed opaquely through the same registrar.
          viewReplays.push([viewName, viewOptions, operationKind] as never);
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
        capturedNativeModels.set(
          entityOrName,
          // typecast-boundary: capture intentionally erases heterogeneous table
          // generics; the identity-keyed read above restores the same generic.
          previewModel as unknown as PromotedDrizzleTable<AnyPgTable>,
        );
        return previewModel;
      }
      const previewModel = typeof entityOrName === 'string'
        // typecast: named golden-path models require ApplicationNamedModelOptions and are guarded by the string branch.
        ? preview.model(entityOrName, modelOptions as ApplicationNamedModelOptions<TSpec, TStatus>)
        // typecast: entity-backed models accept ApplicationModelOptions and are guarded by the non-string branch.
        : preview.model(entityOrName, modelOptions as ApplicationModelOptions<TSpec, TStatus> | undefined);
      const previewRegistrar = applicationModelCommandRegistrar(previewModel);
      if (!previewRegistrar) {
        throw new Error(`Model ${previewModel.name} did not install its compiler-owned command registrar.`);
      }
      const commandReplays: ((model: ApplicationModelBinding<TSpec, TStatus>) => void)[] = [];
      const model: ApplicationModelBinding<TSpec, TStatus> = {
        ...previewModel,
      };
      bindApplicationModelCommandRegistrar(model, (command, commandOptions, handler) => {
        const binding = previewRegistrar(command, commandOptions, handler);
        commandReplays.push((replayedModel) => {
          const replayRegistrar = applicationModelCommandRegistrar(replayedModel);
          if (!replayRegistrar) {
            throw new Error(`Model ${replayedModel.name} did not install its replay command registrar.`);
          }
          replayRegistrar(command, commandOptions, handler);
        });
        invalidate();
        return binding;
      });
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
    query<TInput, TOutput, TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal, TSource extends ApplicationQuerySourceBinding | undefined = undefined>(id: string, queryOptions: ApplicationQueryOptions<TInput, TOutput, TPrincipal, TSource>): ApplicationCallableQueryBinding<TInput, TOutput, TPrincipal, TSource> {
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
        project: ((nameOrOutput: string | ApplicationProjectionOutput<object> | Omit<ApplicationProjectionOptions<TPayload, object, object>, 'source'>, optionsOrTransform?: Omit<ApplicationProjectionOptions<TPayload, object, object>, 'source'> | ApplicationProjectionTransform<TPayload, object>) => {
          if (typeof optionsOrTransform === 'function') {
            const output = nameOrOutput as SchemaInput<object>;
            const transform = optionsOrTransform;
            const previewProjection = previewBinding.project(output, transform as never) as
              | ApplicationAnalyticalProjectionBinding<TPayload, object>
              | ApplicationOnlineProjectionDraft<TPayload, object>;
            if ('storage' in previewProjection && previewProjection.storage === 'analytical') {
              projectionReplays.push((stream) => {
                stream.project(output, transform as never);
              });
              invalidate();
              return previewProjection;
            }
            let previewDraft = previewProjection as ApplicationOnlineProjectionDraft<TPayload, object>;
            const onlineTransform = transform as ApplicationOnlineProjectionTransform<TPayload, object>;
            let replayRebuild:
              | { readonly mode: 'replay' }
              | {
                  readonly mode: 'snapshot';
                  readonly source: ApplicationProjectionRebuildModel<object>;
                  readonly map: (
                    snapshot: object,
                    rebuild: ApplicationProjectionRebuildScope<TPayload>,
                  ) => TPayload | readonly TPayload[] | undefined;
                }
              | undefined;
            const draft: ApplicationOnlineProjectionDraft<TPayload, object> = {
              rebuildFrom(source, map) {
                previewDraft = previewDraft.rebuildFrom(source, map);
                replayRebuild = {
                  mode: 'snapshot',
                  source: source as ApplicationProjectionRebuildModel<object>,
                  map: map as (
                    snapshot: object,
                    rebuild: ApplicationProjectionRebuildScope<TPayload>,
                  ) => TPayload | readonly TPayload[] | undefined,
                };
                return draft;
              },
              rebuildFromReplay() {
                previewDraft = previewDraft.rebuildFromReplay();
                replayRebuild = { mode: 'replay' };
                return draft;
              },
              retain(policy: ApplicationOnlineProjectionRetentionPolicy) {
                const projection = previewDraft.retain(policy);
                projectionReplays.push((stream) => {
                  let replayDraft = stream.project(output, onlineTransform);
                  if (replayRebuild?.mode === 'snapshot') {
                    replayDraft = replayDraft.rebuildFrom(
                      replayRebuild.source,
                      replayRebuild.map,
                    );
                  } else if (replayRebuild?.mode === 'replay') {
                    replayDraft = replayDraft.rebuildFromReplay();
                  }
                  replayDraft.retain(policy);
                });
                invalidate();
                return projection;
              },
            };
            return draft;
          }
          // typecast: this replay wrapper preserves the selected function-native or compatibility overload through preview and materialization.
          const projection = typeof nameOrOutput === 'string'
            ? previewBinding.project(nameOrOutput, optionsOrTransform as never)
            : previewBinding.project(nameOrOutput as never);
          projectionReplays.push((stream) => {
            if (typeof nameOrOutput === 'string') stream.project(nameOrOutput, optionsOrTransform as never);
            else stream.project(nameOrOutput as never);
          });
          invalidate();
          return projection;
        }) as ApplicationStreamBinding<TPayload, TPrincipal>['project'],
        subscribe(name, subscriptionOptions) {
          const subscription = previewBinding.subscribe(name, subscriptionOptions);
          subscriptionReplays.push((stream) => { stream.subscribe(name, subscriptionOptions); });
          invalidate();
          return subscription;
        },
        process: ((nameOrOptions: string | ApplicationStreamProcessOptions, optionsOrHandler: ApplicationStreamProcessOptions | ApplicationStreamProcessHandler<TPayload>, maybeHandler?: ApplicationStreamProcessHandler<TPayload>) => {
          const processor = typeof nameOrOptions === 'string'
            ? previewBinding.process(nameOrOptions, optionsOrHandler as never, maybeHandler as never)
            : previewBinding.process(nameOrOptions as never, optionsOrHandler as never);
          processorReplays.push((stream) => {
            if (typeof nameOrOptions === 'string') stream.process(nameOrOptions, optionsOrHandler as never, maybeHandler as never);
            else stream.process(nameOrOptions as never, optionsOrHandler as never);
          });
          invalidate();
          return processor;
        }) as ApplicationStreamBinding<TPayload, TPrincipal>['process'],
        onEvent: ((optionsOrHandler: ApplicationStreamProcessOptions | ApplicationStreamProcessHandler<TPayload>, maybeHandler?: ApplicationStreamProcessHandler<TPayload>) => {
          const processor = typeof optionsOrHandler === 'function'
            ? previewBinding.onEvent(optionsOrHandler)
            : previewBinding.onEvent(optionsOrHandler, maybeHandler as never);
          processorReplays.push((stream) => {
            if (typeof optionsOrHandler === 'function') stream.onEvent(optionsOrHandler);
            else stream.onEvent(optionsOrHandler, maybeHandler as never);
          });
          invalidate();
          return processor;
        }) as ApplicationStreamBinding<TPayload, TPrincipal>['onEvent'],
        onBatch: ((batchOptions: ApplicationStreamBatchOptions, handler: ApplicationStreamBatchHandler<TPayload>) => {
          const processor = previewBinding.onBatch(batchOptions, handler);
          processorReplays.push((stream) => {
            stream.onBatch(batchOptions, handler);
          });
          invalidate();
          return processor;
        }) as ApplicationStreamBinding<TPayload, TPrincipal>['onBatch'],
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
    job: ((jobId: `${string}.v${number}`, jobContract: ApplicationJobContract<object, object, object, object>, jobOptions: ApplicationJobOptions<object>, handler: ApplicationJobHandler<object, object, object, object>) => {
      const binding = preview.job(jobId, jobContract, jobOptions, handler);
      replays.push((scope) => {
        scope.job(jobId, jobContract, jobOptions, handler);
      });
      invalidate();
      return binding;
    }) as ApplicationJobRegistrar,
    workload: Object.freeze({
      job(jobName: string, jobOptions?: ApplicationWorkloadJobOptions): ApplicationWorkloadJobBinding {
        const normalizedOptions = withDefaultNamespace(jobOptions);
        const binding = preview.workload.job(jobName, normalizedOptions);
        replays.push((scope) => {
          scope.workload.job(jobName, normalizedOptions);
        });
        invalidate();
        return binding;
      },
      cronJob(scheduleName: string, scheduleOptions?: ApplicationWorkloadCronJobOptions): ApplicationWorkloadJobBinding {
        const normalizedOptions = withDefaultNamespace(scheduleOptions);
        const binding = preview.workload.cronJob(scheduleName, normalizedOptions);
        replays.push((scope) => {
          scope.workload.cronJob(scheduleName, normalizedOptions);
        });
        invalidate();
        return binding;
      },
    }),
    actor<TState extends object, const TProtocol extends ApplicationActorProtocolShape>(
      actorId: string,
      actorOptions: { readonly key: ApplicationActorKeySchema; readonly state: ApplicationActorStateInput<TState>; readonly protocol: TProtocol },
    ): ApplicationActorHandle<TState, TProtocol> {
      const binding = preview.actor<TState, TProtocol>(actorId, actorOptions);
      let replayed: ApplicationActorHandle<TState, TProtocol> | undefined;
      replays.push((scope) => {
        replayed = scope.actor<TState, TProtocol>(actorId, actorOptions);
      });
      behaviorReplays.push(() => {
        if (!replayed) throw new Error(`Application actor ${actorId} replay declaration did not run before its handlers.`);
        replayApplicationActorDefinition(
          binding as unknown as ApplicationActorHandle<object, ApplicationActorProtocol>,
          replayed as unknown as ApplicationActorHandle<object, ApplicationActorProtocol>,
        );
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
    provide: (<TImplementation>(token: ApplicationProviderToken<TImplementation>, implementation?: TImplementation | ApplicationProviderBinding<TImplementation>): ApplicationProviderBinding<TImplementation> | ApplicationTargetProviderBinding<TImplementation> => {
      if (implementation === undefined) {
        const previewBinding = preview.provide(token);
        const branches: Array<{ readonly target: ApplicationProviderDeploymentTarget; readonly factory: () => TImplementation }> = [];
        replays.push((scope) => {
          const replay = scope.provide(token);
          for (const branch of branches) targetProviderMethod(replay, branch.target)(branch.factory);
        });
        const binding = targetProviderReplayBinding(previewBinding, (target, factory) => {
          branches.push({ target, factory });
          targetProviderMethod(previewBinding, target)(factory);
          invalidate();
        });
        invalidate();
        return binding;
      }
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
    }) as KubernetesApplicationScope['provide'],
    aggregate<TStats extends object, TEvent extends object>(aggregateName: string, aggregateOptions: ApplicationAggregateOptions<TStats, TEvent>): ApplicationAggregateBinding<TStats, TEvent> {
      const binding = preview.aggregate(aggregateName, aggregateOptions);
      replays.push((scope) => {
        scope.aggregate(aggregateName, aggregateOptions);
      });
      invalidate();
      return binding;
    },
    agent<
      const TName extends string,
      TRequest extends ApplicationTanStackAIAgentRequest,
      TResult,
    >(
      agentName: TName,
      agentOptions: ApplicationAgentOptions,
      handler: ApplicationAgentHandler<TRequest, TResult>,
    ): ApplicationAgentBinding<TName, TRequest, TResult> {
      const binding = preview.agent(agentName, agentOptions, handler);
      const internalCommands = agentOptions.tools.flatMap((tool) => {
        const command = applicationModelCommandBindingForOperation(tool);
        return command ? [tool] : [];
      });
      const inferredHandlerCommands = expandApplicationCallbackDependencies({
        calls: agentOptions.__generatedCalls,
        bindings: agentOptions.__generatedBindings,
      }).calls.flatMap((operation) => {
        const command = applicationModelCommandBindingForOperation(operation);
        return command ? [operation as typeof internalCommands[number]] : [];
      });
      const allInternalCommands = [...new Set([
        ...internalCommands,
        ...inferredHandlerCommands,
      ])];
      const internalQueries = agentOptions.tools.flatMap((tool) => {
        const query = applicationQueryBindingForOperation(tool);
        return query ? [tool] : [];
      });
      const receiverName = `${agentName}-tool-receiver`;
      const receiverOptions = (
        commands: typeof internalCommands,
        queries: typeof internalQueries,
      ): ApplicationGatewayOptions => ({
              visibility: 'internal',
              ...(commands.length > 0
                ? {
                    commands: commands as NonNullable<
                      ApplicationGatewayOptions['commands']
                    >,
                  }
                : {}),
              ...(queries.length > 0
                ? {
                    queries: queries as NonNullable<
                      ApplicationGatewayOptions['queries']
                    >,
                  }
                : {}),
              // The generated internal endpoint is not a browser admission
              // boundary. Its exact operation audience and workload identity
              // are enforced by the compiler-issued authority envelope.
              authorizeCommand: () => true,
              deployment: {
                namespace: defaultNamespace ?? `${name}-system`,
                cursorSecret: {
                  name: `${kubernetesNameSegment(name)}-${kubernetesNameSegment(agentName)}-tool-cursor`,
                  key: 'key',
                },
              },
            });
      const internalCommandNodeIds = new Map(
        allInternalCommands.map((operation) => {
          const command = applicationModelCommandBindingForOperation(operation);
          const handler = command
            ? previewContext.state.graphNodes.find(
                (node) =>
                  node.kind === 'commandHandler'
                  && node.name === command.name,
              )
            : undefined;
          if (handler?.kind !== 'commandHandler') {
            throw new Error(
              `Application ${name} could not resolve the ${agentName} command tool ${getApplicationOperationContract(operation)?.id ?? '<unknown>'} to its canonical handler.`,
            );
          }
          return [operation, handler.command.nodeId] as const;
        }),
      );
      const internalQueryNodeIds = new Map(
        internalQueries.map((operation) => {
          const query = applicationQueryBindingForOperation(operation);
          const nodeId = query ? `query.${query.id}` : undefined;
          if (
            !nodeId
            || !previewContext.state.graphNodes.some(
              (node) => node.kind === 'query' && node.id === nodeId,
            )
          ) {
            throw new Error(
              `Application ${name} could not resolve the ${agentName} query tool ${getApplicationOperationContract(operation)?.id ?? '<unknown>'} to its canonical query.`,
            );
          }
          return [operation, nodeId] as const;
        }),
      );
      replays.push((scope) => {
        scope.agent(agentName, agentOptions, handler);
      });
      if (allInternalCommands.length + internalQueries.length > 0) {
        inferredGatewayReplays.push((state) => {
          const gateways = state.graphNodes.filter(
            (node) =>
              node.kind === 'gateway'
              && node.materialization === 'generatedDeployment',
          );
          const uncoveredCommands = allInternalCommands.filter((operation) => {
            const commandNodeId = internalCommandNodeIds.get(operation);
            if (!commandNodeId) return true;
            return !gateways.some((gateway) =>
              gateway.kind === 'gateway'
              && gateway.commands.some(
                (candidate) =>
                  candidate.command.nodeId === commandNodeId,
              ));
          });
          const uncoveredQueries = internalQueries.filter((operation) => {
            const nodeId = internalQueryNodeIds.get(operation);
            if (!nodeId) return true;
            return !gateways.some((gateway) =>
              gateway.kind === 'gateway'
              && gateway.queries.some(
                (candidate) => candidate.nodeId === nodeId,
              ));
          });
          if (uncoveredCommands.length + uncoveredQueries.length === 0) return;
          registerApplicationGateway(
            state,
            receiverName,
            receiverOptions(uncoveredCommands, uncoveredQueries),
            name,
          );
        });
      }
      invalidate();
      return binding;
    },
    workflow: ((definitionOrId: WorkflowDefinition<object, object, Readonly<Record<string, object>>, Readonly<Record<string, object>>> | string, contractOrOptions: object, optionsOrHandler: object | ((...args: never[]) => unknown), maybeHandler?: (...args: never[]) => unknown) => {
      const functionNative = typeof definitionOrId === 'string';
      const definition = functionNative
        ? defineWorkflow(definitionOrId, contractOrOptions as ApplicationWorkflowContract<object, object>)
        : definitionOrId;
      const optionlessFunctionNative =
        functionNative
        && typeof optionsOrHandler === 'function'
        && maybeHandler === undefined;
      const workflowOptions = functionNative
        ? optionlessFunctionNative
          ? {}
          : optionsOrHandler as object
        : contractOrOptions;
      const handler = functionNative
        ? optionlessFunctionNative
          ? optionsOrHandler
          : maybeHandler
        : optionsOrHandler as (...args: never[]) => unknown;
      if (typeof handler !== 'function') {
        throw new Error(`Application workflow ${definition.id} requires an implementation callback.`);
      }
      const binding = Reflect.apply(preview.workflow, preview, [definition, workflowOptions, handler]) as ApplicationWorkflowBinding<object, object>;
      replays.push((scope) => {
        Reflect.apply(scope.workflow, scope, [definition, workflowOptions, handler]);
      });
      invalidate();
      return binding;
    }) as KubernetesApplicationScope['workflow'],
    // typecast-boundary: these generic helpers return TypeKro expression proxies
    // typed as the selected scalar, matching the public graph DSL contract.
    select: applicationGraphSelect as KubernetesApplicationScope['select'],
    selectProvider: applicationGraphProviderSelection as KubernetesApplicationScope['selectProvider'],
    selectTarget: ((factories) => {
      const targets = Object.fromEntries(Object.entries(factories).map(([target, factory]) => {
        if (typeof factory !== 'function') throw new Error(`app.selectTarget(...) branch ${target} requires a provider factory.`);
        return [target === 'awsLocal' ? 'aws-local' : target, factory()];
      }));
      if (Object.keys(targets).length === 0) throw new Error('app.selectTarget(...) requires at least one deployment-target branch.');
      return { kind: 'application-target-provider-selection', targets } as unknown;
    }) as KubernetesApplicationScope['selectTarget'],
    when: applicationGraphWhen as KubernetesApplicationScope['when'],
    any: applicationGraphAny,
    all: applicationGraphAll,
    interpolate: applicationGraphInterpolate,
  } satisfies KubernetesApplicationBuilder<TSpec, TStatus>;
  Object.assign(builder.workflow, {
    signal<TInput extends object, TActions extends Readonly<Record<string, object>>>(
      id: string,
      contract: ApplicationSignalContract<TInput, TActions>,
    ): ApplicationSignalBinding<ApplicationSignalDefinition<TInput, TActions>> {
      const signal = defineApplicationSignal(id, contract);
      const database = resolveApplicationDatabase(previewContext.state, undefined);
      const stream = applicationSignalStreamOptions(signal, database);
      const binding = builder.stream({
        kind: 'applik8sEvent',
        id: signal.id,
        name: signal.name,
        version: signal.version,
        payload: stream.payload,
        emit() {
          throw new Error(
            `Signal ${signal.id} issuance is framework-owned. Use workflow.emitSignal(...).`,
          );
        },
      }, stream.options);
      return Object.freeze({
        ...binding,
        ...applicationSignalAuthorityFacets(signal),
        signalKind: 'applicationSignal' as const,
        signal,
        // typecast-boundary: signal projection decoding is inert at the
        // generated worker boundary; the shared stream registrar carries the
        // same wire payload before that execution-family-specific decoding.
        project: binding.project as unknown as ApplicationSignalBinding<
          typeof signal
        >['project'],
        subscribe: ((nameOrOptions: string | object, subscriptionOptions?: object) => {
          if (typeof nameOrOptions === 'string') {
            return Reflect.apply(binding.subscribe, binding, [
              nameOrOptions,
              subscriptionOptions,
            ]);
          }
          throw new Error(
            `Signal ${signal.id}.subscribe(...) consumption requires an environment-specific generated application facade.`,
          );
        }) as ApplicationSignalBinding<typeof signal>['subscribe'],
      });
    },
    emitSignal<TDefinition extends ApplicationSignalDefinition>(
      signal: TDefinition | ApplicationSignalBinding<TDefinition>,
      signalOptions: ApplicationSignalEmitOptions<TDefinition>,
    ): Promise<ApplicationSignalDecision<TDefinition>> {
      return emitApplicationWorkflowSignal(
        isApplicationSignalBinding(signal) ? signal.signal : signal,
        signalOptions,
      );
    },
  } satisfies Pick<ApplicationWorkflowRegistrar, 'signal' | 'emitSignal'>);
  Object.defineProperty(builder, applicationGraphMetadataProperty, {
    get: () => {
      const {
        onChange: _onChange,
        ...previewState
      } = previewContext.state;
      const finalizedPreviewState: ApplicationScopeState = {
        ...previewState,
        graphNodes: [...previewContext.state.graphNodes],
        graphEdges: [...previewContext.state.graphEdges],
        providerRequirements: [...previewContext.state.providerRequirements],
        providerBindings: [...previewContext.state.providerBindings],
      };
      for (const [serverName, declaration] of declaredFunctionNativeHttp) {
        const routes = declaration.routes.map((route) =>
          applicationFunctionNativeHttpServerRoute(
            finalizedPreviewState,
            serverName,
            route,
          ));
        const resolvedOptions = applicationServerOptionsWithScope(
          finalizedPreviewState,
          declaration.options,
          routes,
        );
        recordApplicationServerGraph(
          finalizedPreviewState,
          serverName,
          resolvedOptions,
          routes,
        );
        collectApplicationIndexes(
          finalizedPreviewState,
          resolvedOptions.indexes ?? {},
        );
      }
      for (const replay of inferredGatewayReplays) {
        replay(finalizedPreviewState);
      }
      const preview = applicationGraphFromState(name, finalizedPreviewState);
      return defaultNamespace
        ? normalizeApplicationGraph({
            ...preview,
            metadata: { ...preview.metadata, namespace: defaultNamespace },
          })
        : preview;
    },
    enumerable: false,
    configurable: false,
  });
  Object.defineProperty(builder, applicationInstallationMetadataProperty, { get: () => Reflect.get(materialize(), applicationInstallationMetadataProperty), enumerable: false, configurable: false });
  Object.defineProperty(builder, applicationImplementationPlansMetadataProperty, {
    get: () => applicationImplementationPlanSet(
      name,
      assemblyProfiles.list().map((profile) => profile.plan()),
    ),
    enumerable: false,
    configurable: false,
  });
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
    spec: applicationKroInstallationSpec(options.spec),
    status: options.status ?? arkType({ ready: 'boolean' }),
  } as unknown as TypeKroListenerCompositionDefinition<TSpec, TStatus>;
}

/**
 * KRO SimpleSchema requires an object-shaped root spec and cannot represent an
 * ArkType discriminated object union. Derive a structural superset for KRO
 * while the authored ArkType schema remains the validation authority used by
 * installation clients and the CLI.
 */
function applicationKroInstallationSpec<TSpec extends KroCompatibleType>(
  authored: Type<TSpec> | undefined,
): Type<TSpec> {
  if (!authored || !Array.isArray(authored.json)) {
    return (authored ?? arkType({})) as Type<TSpec>;
  }
  const definition = applicationKroArkDefinition(authored.json, '$.spec');
  if (
    !definition
    || typeof definition !== 'object'
    || Array.isArray(definition)
  ) {
    throw new Error(
      'Application installation unions must contain only object-shaped branches so KRO can derive a structural spec schema.',
    );
  }
  return arkType(definition as never) as unknown as Type<TSpec>;
}

function applicationKroArkDefinition(
  schema: unknown,
  path: string,
): unknown {
  if (typeof schema === 'string') return schema;
  if (Array.isArray(schema)) {
    if (
      schema.every(
        (branch) =>
          branch
          && typeof branch === 'object'
          && Reflect.get(branch, 'domain') === 'object',
      )
    ) {
      return applicationKroMergedObjectDefinition(schema, path);
    }
    const units = schema.map((branch) =>
      branch && typeof branch === 'object' ? Reflect.get(branch, 'unit') : undefined);
    if (units.every((unit) => typeof unit === 'boolean')) return 'boolean';
    if (units.every((unit) => typeof unit === 'string')) {
      return [...new Set(units)].sort().map((unit) => JSON.stringify(unit)).join(' | ');
    }
    const definitions = schema.map((branch, index) =>
      applicationKroArkDefinition(branch, `${path}.union[${index}]`));
    if (definitions.every((value) => typeof value === 'string')) {
      return [...new Set(definitions as string[])].join(' | ');
    }
    throw new Error(
      `Application installation schema ${path} contains a union KRO SimpleSchema cannot represent structurally.`,
    );
  }
  if (!schema || typeof schema !== 'object') {
    throw new Error(
      `Application installation schema ${path} contains an unsupported ArkType node.`,
    );
  }
  if (Object.hasOwn(schema, 'unit')) {
    const unit = Reflect.get(schema, 'unit');
    if (typeof unit === 'string') return JSON.stringify(unit);
    if (typeof unit === 'boolean' || typeof unit === 'number') {
      return JSON.stringify(unit);
    }
  }
  if (Reflect.get(schema, 'domain') === 'object') {
    return applicationKroMergedObjectDefinition([schema], path);
  }
  const domain = Reflect.get(schema, 'domain');
  if (domain === 'number') {
    const base = Reflect.get(schema, 'divisor') === 1
      ? 'number.integer'
      : 'number';
    const minimum = Reflect.get(schema, 'min');
    const maximum = Reflect.get(schema, 'max');
    if (typeof minimum === 'number' && typeof maximum === 'number') {
      return `${minimum} <= ${base} <= ${maximum}`;
    }
    if (typeof minimum === 'number') return `${base} >= ${minimum}`;
    if (typeof maximum === 'number') return `${base} <= ${maximum}`;
    return base;
  }
  if (
    domain === 'string'
    || domain === 'boolean'
    || domain === 'object'
  ) {
    return domain;
  }
  throw new Error(
    `Application installation schema ${path} contains an unsupported ArkType node.`,
  );
}

function applicationKroMergedObjectDefinition(
  branches: readonly object[],
  path: string,
): Readonly<Record<string, unknown>> {
  const fields = new Map<
    string,
    { readonly values: unknown[]; requiredIn: number }
  >();
  for (const branch of branches) {
    const required = new Set<string>();
    for (const group of ['required', 'optional'] as const) {
      const entries = Reflect.get(branch, group);
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        const key = entry && typeof entry === 'object'
          ? Reflect.get(entry, 'key')
          : undefined;
        if (typeof key !== 'string') continue;
        const field = fields.get(key) ?? { values: [], requiredIn: 0 };
        field.values.push(Reflect.get(entry, 'value'));
        if (group === 'required') required.add(key);
        fields.set(key, field);
      }
    }
    for (const key of required) {
      const field = fields.get(key);
      if (field) field.requiredIn += 1;
    }
  }
  return Object.fromEntries(
    [...fields.entries()].sort(([left], [right]) => left.localeCompare(right))
      .map(([key, field]) => [
        field.requiredIn === branches.length ? key : `${key}?`,
        applicationKroArkDefinition(
          field.values.length === 1 ? field.values[0] : field.values,
          `${path}.${key}`,
        ),
      ]),
  );
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

function applicationFunctionNativeHttpServerRoute(
  state: ApplicationGraphState,
  serverName: string,
  route: ApplicationHttpRouteDeclaration,
): ApplicationServerRoute {
  const transaction = inferApplicationFunctionNativeTransaction(
    state,
    `HTTP route ${serverName}.${route.id}`,
    route.handlerDependencyGraph,
    'http-idempotency-key',
  );
  const operationBindings = Object.entries(
    route.handlerDependencyGraph.bindings,
  ).flatMap(([identifier, value]) => {
    const binding = applicationModelCommandBindingForOperation(value);
    const operation = getApplicationOperationContract(value);
    if (!binding || !operation) return [];
    const commandNodeId = applicationGraphNodeId(
      'command',
      binding.command,
    );
    const handler = state.graphNodes.find(
      (candidate) =>
        candidate.kind === 'commandHandler'
        && candidate.command.nodeId === commandNodeId,
    );
    if (!handler) {
      throw new Error(
        `HTTP route ${serverName}.${route.id} reaches ${binding.model}.${operation.name}, but its generated command handler is absent from the application graph.`,
      );
    }
    const canonicalOperationId = applicationOperationId({
      domain: 'models',
      owner: binding.model,
      operation: operation.name,
    });
    return [{
      identifier,
      operationId: canonicalOperationId,
      ...(operation.id !== canonicalOperationId
        ? { runtimeOperationId: operation.id }
        : {}),
      command: {
        nodeId: commandNodeId,
      },
      handler: {
        nodeId: handler.id,
      },
    }];
  }).filter(
    (binding, index, bindings) =>
      !/^generatedCall\d+$/.test(binding.identifier)
      && bindings.findIndex(
        (candidate) =>
          candidate.identifier === binding.identifier
          && candidate.operationId === binding.operationId,
      ) === index,
  ).sort((left, right) =>
    `${left.identifier}:${left.operationId}`.localeCompare(
      `${right.identifier}:${right.operationId}`,
    ));
  const providerBindings = route.handlerDependencyGraph.providerBindings
    .filter(
      (binding) =>
        binding.operation !== undefined
        || !route.handlerDependencyGraph.providerBindings.some(
          (candidate) =>
            candidate.operation !== undefined
            && candidate.provider.nodeId === binding.provider.nodeId,
        ),
    );
  const objectBindings = route.handlerDependencyGraph.providerBindings
    .flatMap((binding) =>
      binding.placement === 'objectStore' && binding.objectStore
        ? [{ identifier: binding.identifier, store: binding.objectStore }]
        : [])
    .filter(
      (binding, index, bindings) =>
        !/^generatedCall\d+$/.test(binding.identifier)
        && bindings.findIndex(
          (candidate) =>
            candidate.identifier === binding.identifier
            && candidate.store.nodeId === binding.store.nodeId,
        ) === index,
    )
    .sort((left, right) =>
      `${left.identifier}:${left.store.nodeId}`.localeCompare(
        `${right.identifier}:${right.store.nodeId}`,
      ));
  const workflowBindings = Object.entries(route.workflowBindings)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([identifier, target]) => {
      const kind = target.kind === 'applicationTask'
        ? 'task'
        : target.kind === 'applicationWorkflow'
          ? 'workflow'
          : undefined;
      if (!kind) {
        throw new Error(
          `HTTP route ${serverName}.${route.id} workflow ${identifier} must target an application workflow or task binding.`,
        );
      }
      const nodeId = applicationGraphNodeId(kind, target.definition.id);
      const node = state.graphNodes.find((candidate) => candidate.id === nodeId);
      if (node?.kind !== kind) {
        throw new Error(
          `HTTP route ${serverName}.${route.id} workflow ${identifier} references unregistered ${kind} ${target.definition.id}.`,
        );
      }
      return {
        identifier,
        target: { nodeId },
        contract: {
          name: node.contract.name,
          version: node.contract.version,
          input: node.contract.input,
          output: node.contract.output,
          signals: node.kind === 'workflow' ? node.contract.signals : [],
        },
      };
    });
  if (workflowBindings.length > 0) {
    recordApplicationWorkflowEngine(state as ApplicationWorkflowState);
  }
  return {
    id: route.id,
    named: true,
    method: route.method,
    path: route.path,
    handlerSource: route.handlerSource,
    handlerSourceKind: 'source',
    ...(route.handlerLocation
      ? { handlerSourceLocation: route.handlerLocation }
      : {}),
    ...(route.handlerDependencies
      ? {
          handlerDependencySource: route.handlerDependencies.source,
          handlerDependencyResolveDir: route.handlerDependencies.resolveDir,
        }
      : {}),
    functionNative: {
      input: route.input,
      output: route.output,
      ...(operationBindings.length > 0 ? { operationBindings } : {}),
      ...(providerBindings.length > 0 ? { providerBindings } : {}),
      ...(objectBindings.length > 0 ? { objectBindings } : {}),
      ...(workflowBindings.length > 0
        ? {
            workflowBindings,
            workflowEngine: {
              interface: 'WorkflowEngine' as const,
              nodeId: applicationGraphNodeId('provider', 'WorkflowEngine'),
            },
          }
        : {}),
      ...(route.authorizeSource
        ? { authorizeSource: route.authorizeSource }
        : {}),
      ...(route.authorizeDependencies
        ? { authorizeDependencies: route.authorizeDependencies }
        : {}),
      ...(route.authorizeLocation
        ? { authorizeLocation: route.authorizeLocation }
        : {}),
      ...(route.webhookAuthentication
        ? { webhookAuthentication: route.webhookAuthentication }
        : {}),
      ...(transaction ? { transaction } : {}),
    },
    ...(route.authority ? { authority: route.authority } : {}),
  };
}

function applyApplicationHttpRouteAuthority<TInput, TOutput>(
  operation: ApplicationOperation<TInput, TOutput>,
  authority: ApplicationOperationAuthorityGraphContract | undefined,
): void {
  if (!authority) return;
  for (const permissionId of authority.permissionIds) {
    operation.requires({ id: permissionId });
  }
  if (authority.classification === 'public') {
    operation.public();
  } else if (authority.classification === 'application-policy') {
    operation.applicationPolicy();
  }
  if (authority.lifetime) {
    operation.authorize(authority.lifetime);
  }
}

function applicationQualifiedProviderAliasNodeId(
  providerInterface: string,
  value: unknown,
): string | null {
  if (
    !value
    || typeof value !== 'object'
    || (
      Reflect.get(value, 'kind') !== 'applicationProvider'
      && Reflect.get(value, 'kind') !== 'applicationHost'
    )
  ) {
    return null;
  }
  const candidate = Reflect.get(value, 'token') as unknown;
  const qualifiedCandidate =
    candidate as unknown as ApplicationQualifiedProviderToken<unknown>;
  if (
    !candidate
    || typeof candidate !== 'object'
    || !isApplicationQualifiedProviderToken(
      qualifiedCandidate,
    )
    || applicationProviderTokenName(
      qualifiedCandidate,
    ) !== providerInterface
  ) {
    return null;
  }
  const qualification = applicationProviderQualificationFor(
    qualifiedCandidate,
  );
  return qualification
    ? applicationProviderGraphNodeId(providerInterface, qualification)
    : null;
}

// typecast-boundary: the scope assembles overloaded registrars after runtime discriminants select native, named, or Kubernetes implementations.
function createApplicationContext<TSpec extends KroCompatibleType, TStatus extends KroCompatibleType>(
  definition: TypeKroListenerCompositionDefinition<TSpec, TStatus>,
  onChange?: () => void,
): ApplicationContext {
  const servers: Record<string, ApplicationServerBinding> = {};
  const state: ApplicationScopeState = {
    authorityApplicationName: kubernetesNameSegment(definition.name),
    resources: {}, indexes: {}, models: {}, nativeModelRegistrations: new Map(), databases: new Map(), emittedTransactionalDatabases: new Set(), emittedAnalyticalDatabases: new Set(), emittedIndexStores: new Set(), modelLifecycleStreams: new Map(), appResource: applicationCompositionResourceTarget(definition), generatedJobStatusTargets: [],
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
  const registerServer = (
    name: string,
    options: ApplicationServerOptions,
    routes: readonly ApplicationServerRoute[],
  ): ApplicationServerBinding => {
    if (servers[name]) {
      throw new Error(`Application server ${JSON.stringify(name)} is already declared.`);
    }
    const resolvedOptions = applicationServerOptionsWithScope(state, options, routes);
    recordApplicationServerGraph(state, name, resolvedOptions, routes);
    const workload = emitApplicationServerResources(name, resolvedOptions, routes);
    const binding = applicationServerBinding(name, resolvedOptions, routes, workload);
    servers[name] = binding;
    Object.defineProperty(server, name, { value: binding, enumerable: true, configurable: true });
    collectApplicationIndexes(state, resolvedOptions.indexes ?? {});
    return binding;
  };
  const registerFunctionNativeServer = (
    name: string,
    options: ApplicationServerOptions,
    routes: readonly ApplicationServerRoute[],
  ): void => {
    if (servers[name]) {
      throw new Error(
        `Application server ${JSON.stringify(name)} is already declared.`,
      );
    }
    const resolvedOptions = applicationServerOptionsWithScope(
      state,
      options,
      routes,
    );
    // app.http is declarative authoring metadata. The compiler is the sole
    // owner of its authenticated worker, image, and Kubernetes resources.
    // Emitting a provisional raw app.server workload here creates a second,
    // unusable execution path and makes TypeKro/Alchemy reconcile the wrong
    // deployment before compiler artifacts are injected.
    recordApplicationServerGraph(state, name, resolvedOptions, routes);
    collectApplicationIndexes(state, resolvedOptions.indexes ?? {});
  };
  const server = (name: string, optionsOrConfigure: ApplicationServerOptions | ((server: ApplicationServer) => void), maybeConfigure?: (server: ApplicationServer) => void) => {
    const options = typeof optionsOrConfigure === 'function' ? {} : optionsOrConfigure;
    const configure = typeof optionsOrConfigure === 'function' ? optionsOrConfigure : maybeConfigure;
    if (!configure) {
      throw new Error(`app.server(${JSON.stringify(name)}, ...) requires a route configuration callback.`);
    }
    const routes: ApplicationServerRoute[] = [];
    configure(createRouteRecorder(name, routes));
    return registerServer(name, options, routes);
  };
  const defaults = (defaults: ApplicationDefaults): ApplicationDefaultsBinding => {
    if ('database' in defaults) {
      const configuredDatabase = defaults.database;
      const transactionalDatabase = applicationTransactionalDatabaseImplementation(configuredDatabase);
      if (!transactionalDatabase) {
        throw new Error('app.defaults({ database: ... }) currently supports TransactionalDatabase.postgres(...).');
      }
      state.defaults.database = configuredDatabase;
      recordApplicationProviderGraph(
        state,
        'TransactionalDatabase',
        'default',
        transactionalDatabase,
        undefined,
        undefined,
        applicationQualifiedProviderAliasNodeId(
          'TransactionalDatabase',
          configuredDatabase,
        ),
      );
    }
    if ('counters' in defaults) {
      state.defaults.counters = defaults.counters;
      recordApplicationProviderGraph(
        state,
        'CounterStore',
        'default',
        defaults.counters,
        undefined,
        undefined,
        applicationQualifiedProviderAliasNodeId(
          'CounterStore',
          defaults.counters,
        ),
      );
    }
    if ('events' in defaults) {
      state.defaults.events = defaults.events;
      recordApplicationProviderGraph(
        state,
        'EventSource',
        'default',
        defaults.events,
        undefined,
        undefined,
        applicationQualifiedProviderAliasNodeId(
          'EventSource',
          defaults.events,
        ),
      );
    }
    if ('eventLog' in defaults) {
      const configuredEventLog = defaults.eventLog;
      const eventLog = applicationEventLogImplementation(configuredEventLog);
      if (!eventLog) {
        throw new Error(
          'app.defaults({ eventLog: ... }) requires a NATS JetStream EventLog provider or qualified binding.',
        );
      }
      state.defaults.eventLogs = configuredEventLog;
      recordApplicationProviderGraph(
        state,
        'EventLog',
        'default',
        eventLog,
        undefined,
        undefined,
        applicationQualifiedProviderAliasNodeId(
          'EventLog',
          configuredEventLog,
        ),
      );
    }
    if ('secrets' in defaults) {
      state.defaults.secrets = defaults.secrets;
      recordApplicationProviderGraph(
        state,
        'Secret',
        'default',
        defaults.secrets,
        undefined,
        undefined,
        applicationQualifiedProviderAliasNodeId('Secret', defaults.secrets),
      );
    }
    if ('queues' in defaults) {
      state.defaults.queues = defaults.queues;
      recordApplicationProviderGraph(
        state,
        'Queue',
        'default',
        defaults.queues,
        undefined,
        undefined,
        applicationQualifiedProviderAliasNodeId('Queue', defaults.queues),
      );
    }
    if ('objects' in defaults) {
      const configuredObjects = defaults.objects;
      const objects = applicationObjectStorageImplementation(configuredObjects);
      if (!objects) {
        throw new Error(
          'app.defaults({ objects: ... }) requires ObjectStorage.s3(...), ObjectStorage.configMap(...), or a homogeneous qualified binding.',
        );
      }
      state.defaults.objects = configuredObjects;
      recordApplicationProviderGraph(
        state,
        'ObjectStorage',
        'default',
        objects,
        undefined,
        undefined,
        applicationQualifiedProviderAliasNodeId(
          'ObjectStorage',
          configuredObjects,
        ),
      );
    }
    if ('credentials' in defaults) {
      state.defaults.credentials = defaults.credentials;
      recordApplicationProviderGraph(
        state,
        'CredentialStore',
        'default',
        defaults.credentials,
        undefined,
        undefined,
        applicationQualifiedProviderAliasNodeId(
          'CredentialStore',
          defaults.credentials,
        ),
      );
    }
    if ('expose' in defaults) {
      const exposureProvider = applicationHttpExposureImplementation(defaults.expose);
      if (!exposureProvider) {
        throw new Error('app.defaults({ expose: ... }) requires HttpExposure.ingress(...) or HttpExposure.nodePort(...).');
      }
      state.defaults.expose = defaults.expose;
      recordApplicationProviderGraph(
        state,
        'HttpExposure',
        'default',
        exposureProvider,
        undefined,
        undefined,
        applicationQualifiedProviderAliasNodeId(
          'HttpExposure',
          defaults.expose,
        ),
      );
    }
    if ('certificates' in defaults) {
      const certificateProvider = applicationCertificateImplementation(defaults.certificates);
      if (!certificateProvider) {
        throw new Error('app.defaults({ certificates: ... }) requires a cert-manager provider with an explicit Issuer or ClusterIssuer reference.');
      }
      state.defaults.certificates = defaults.certificates;
      recordApplicationProviderGraph(
        state,
        'Certificate',
        'default',
        certificateProvider,
        undefined,
        undefined,
        applicationQualifiedProviderAliasNodeId(
          'Certificate',
          defaults.certificates,
        ),
      );
    }
    if ('dns' in defaults) {
      const dnsProvider = applicationDnsPublicationImplementation(defaults.dns);
      if (!dnsProvider) {
        throw new Error('app.defaults({ dns: ... }) requires an external-dns publication provider.');
      }
      state.defaults.dns = defaults.dns;
      recordApplicationProviderGraph(
        state,
        'DnsPublication',
        'default',
        dnsProvider,
        undefined,
        undefined,
        applicationQualifiedProviderAliasNodeId(
          'DnsPublication',
          defaults.dns,
        ),
      );
    }
    if ('indexes' in defaults) {
      const configuredIndexes = defaults.indexes;
      const index = applicationIndexBackend(configuredIndexes);
      if (!index) {
        throw new Error(
          'app.defaults({ indexes: ... }) requires a Valkey-compatible IndexStore provider or homogeneous qualified binding.',
        );
      }
      state.defaults.indexes = configuredIndexes;
      recordApplicationProviderGraph(
        state,
        'IndexStore',
        'default',
        index,
        undefined,
        undefined,
        applicationQualifiedProviderAliasNodeId(
          'IndexStore',
          configuredIndexes,
        ),
      );
    }
    if ('search' in defaults) {
      const configuredSearch = defaults.search;
      const searchSelection =
        applicationProviderSelectionFor(configuredSearch);
      const search = applicationSearchProviderImplementation(configuredSearch);
      const resolvedSearch = searchSelection ?? search;
      if (!resolvedSearch) {
        throw new Error(
          'app.defaults({ search: ... }) requires Search.postgres(...), Search.openSearch(...), or Search.externalOpenSearch(...).',
        );
      }
      state.defaults.search = configuredSearch;
      recordApplicationProviderGraph(
        state,
        'Search',
        'default',
        resolvedSearch,
        undefined,
        undefined,
        applicationQualifiedProviderAliasNodeId('Search', configuredSearch),
      );
    }
    if ('analytics' in defaults) {
      const configuredAnalytics = defaults.analytics;
      const analyticalDatabase = applicationAnalyticalDatabaseImplementation(configuredAnalytics);
      const analyticsSelection =
        applicationProviderSelectionFor(configuredAnalytics);
      const resolvedAnalytics = analyticsSelection ?? analyticalDatabase;
      if (!resolvedAnalytics) {
        throw new Error('app.defaults({ analytics: ... }) requires AnalyticalDatabase.clickhouse(...).');
      }
      state.defaults.analytics = configuredAnalytics;
      recordApplicationProviderGraph(
        state,
        'AnalyticalDatabase',
        'default',
        resolvedAnalytics,
        undefined,
        undefined,
        applicationQualifiedProviderAliasNodeId(
          'AnalyticalDatabase',
          configuredAnalytics,
        ),
      );
    }
    return { kind: 'applicationDefaults', defaults };
  };
  const provideImplementation = <TImplementation>(token: ApplicationProviderToken<TImplementation>, implementation?: TImplementation | ApplicationProviderBinding<TImplementation>): ApplicationProviderBinding<TImplementation> | ApplicationTargetProviderBinding<TImplementation> => {
    const qualification = applicationProviderQualificationFor(token);
    if (implementation === undefined) {
      if (!isApplicationQualifiedProviderToken(token)) {
        throw new Error(`app.provide(${applicationProviderTokenName(token)}) target branches require a qualified capability created with .named(...).`);
      }
      return createApplicationTargetProviderBinding<TImplementation>(token, (selection) => {
        if (token.accepts && !applicationProviderSelectionSatisfies(selection, token.accepts)) {
          throw new Error(`app.provide(${token.qualification.key}) target branch does not satisfy ${token.name}.`);
        }
        recordApplicationProviderGraph(
          state,
          applicationProviderTokenName(token),
          'targetSelected',
          selection,
          token.contract,
          qualification,
          undefined,
          applicationCallableProviderRuntimeBinding(token, selection),
        );
      });
    }
    const explicitPhysicalAuthority = applicationQualifiedProviderAliasNodeId(
      applicationProviderTokenName(token),
      implementation,
    );
    if (
      explicitPhysicalAuthority
      && explicitPhysicalAuthority === applicationProviderGraphNodeId(
        applicationProviderTokenName(token),
        qualification,
      )
    ) {
      throw new Error(
        `app.provide(${applicationProviderTokenName(token)}) cannot share a provider with itself.`,
      );
    }
    const concreteImplementation = (
      implementation
      && typeof implementation === 'object'
      && Reflect.get(implementation, 'kind') === 'applicationProvider'
      ? Reflect.get(implementation, 'implementation')
      : implementation
    ) as TImplementation;
    if (!isApplicationQualifiedProviderToken(token)) {
      applyApplicationProvider(state, token, concreteImplementation);
    } else if (
      token.accepts
      && !token.accepts(concreteImplementation)
      && !applicationProviderSelectionSatisfies(
        concreteImplementation,
        token.accepts,
      )
    ) {
      throw new Error(
        `app.provide(${token.qualification.key}, ...) does not satisfy ${token.name}.`,
      );
    }
    if ((token as unknown) === IndexStore) {
      emitProvidedApplicationIndexStore(state, definition.name, undefined, concreteImplementation);
    }
    if (applicationProviderTokenName(token) === 'AnalyticalDatabase') {
      emitApplicationAnalyticalDatabaseResources(state, concreteImplementation);
    }
    const recordedImplementation =
      (applicationProviderTokenName(token) === 'IndexStore'
        ? applicationIndexBackend(concreteImplementation)
        : undefined)
      ?? applicationProviderSelectionFor(concreteImplementation)
      ?? applicationTargetProviderSelectionFor(concreteImplementation)
      ?? concreteImplementation;
    recordApplicationProviderGraph(
      state,
      applicationProviderTokenName(token),
      'provided',
      recordedImplementation,
      token.contract,
      qualification,
      explicitPhysicalAuthority
        ?? (qualification
          ? undefined
          : applicationQualifiedProviderAliasNodeId(
            applicationProviderTokenName(token),
            concreteImplementation,
          )),
      applicationCallableProviderRuntimeBinding(token, recordedImplementation),
    );
    if ((token as unknown) === ApplicationHost) {
      return applicationHostBinding(
        ApplicationHost,
        concreteImplementation as unknown as ApplicationHostProvider,
        definition.name,
      ) as ApplicationProviderBinding<TImplementation>;
    }
    return {
      kind: 'applicationProvider',
      token,
      implementation: recordedImplementation,
      ...(qualification ? { qualification } : {}),
    } as ApplicationProviderBinding<TImplementation>;
  };
  const provide = provideImplementation as KubernetesApplicationScope['provide'];
  const storage: ApplicationStorageRegistrar = {
    postgres(name, options = {}) {
      const provider = TransactionalDatabase.postgres(applicationStoragePostgresOptions(name, options));
      return defaults({ database: provider });
    },
  };
  const database: ApplicationDatabaseRegistrar = {
    postgres<TSchema extends Readonly<Record<string, unknown>>>(
      name: string,
      options: ApplicationDatabasePostgresOptions<TSchema>,
    ): ApplicationDatabaseHandle<TSchema> {
      if (state.databases.has(name)) {
        throw new Error(`Application database ${name} is already registered.`);
      }
      const {
        schema,
        access,
        migrations,
        processor: _processor,
        ...providerOptions
      } = options;
      const provider = TransactionalDatabase.postgres({
        ...applicationStoragePostgresOptions(name, providerOptions),
        // One app.database(...) binding is one PostgreSQL authority. Native
        // models sharing it must not provision a database per table/model.
        database: providerOptions.database ?? name,
        migrations: { strategy: migrations ? 'external' : 'none', compatibility: 'requiresExplicitMigration', apply: 'manual' },
      });
      defaults({ database: provider });
      const migrationArtifact = typeof migrations === 'string' ? { path: migrations } : migrations;
      const binding = applicationDatabaseHandle<TSchema>({
        kind: 'applicationDatabase',
        name,
        provider,
        // typecast: an omitted schema is the generic empty registry later
        // extended by maintained modules within this application context.
        schema: (schema ?? {}) as TSchema,
        ...(migrationArtifact ? { migrations: migrationArtifact } : {}),
        ...(access ? { access } : {}),
        ...(options.processor ? { processor: options.processor } : {}),
      });
      state.databases.set(name, binding);
      return binding;
    },
    bind<TSchema extends Readonly<Record<string, unknown>>>(
      name: string,
      options: ApplicationDatabaseBindOptions<TSchema>,
    ): ApplicationDatabaseHandle<TSchema> {
      if (state.databases.has(name)) {
        throw new Error(`Application database ${name} is already registered.`);
      }
      const provider = applicationTransactionalDatabaseImplementation(options.provider);
      if (!provider) {
        throw new Error(
          `app.database.bind(${JSON.stringify(name)}, ...) requires a provided TransactionalDatabase implementation.`,
        );
      }
      const migrationArtifact = typeof options.migrations === 'string'
        ? { path: options.migrations }
        : options.migrations;
      const qualification = applicationProviderQualificationFor(
        options.provider,
      );
      const binding = applicationDatabaseHandle<TSchema>({
        kind: 'applicationDatabase',
        name,
        provider,
        ...(qualification ? { qualification } : {}),
        // typecast: see postgres() above.
        schema: (options.schema ?? {}) as TSchema,
        ...(migrationArtifact ? { migrations: migrationArtifact } : {}),
        ...(options.access ? { access: options.access } : {}),
        ...(options.processor ? { processor: options.processor } : {}),
      });
      state.databases.set(name, binding);
      return binding;
    },
  };
  const resource = <TSpec extends object, TStatus extends object = Record<string, never>>(name: string, options: ApplicationResourceOptions<TSpec, TStatus>): ResourceDefinition<TSpec, TStatus> => {
    const { controller, ...resourceOptions } = options;
    const definitionResource = bindApplicationResourceEvents(state, baseSdk.crd({
      ...resourceOptions,
      apiVersion: resourceOptions.apiVersion ?? applicationDefinitionApiVersion(definition),
      kind: resourceOptions.kind ?? name,
      // App-owned resources always reserve the status subresource for
      // framework-owned restart-safe state (for example job.track()). Domain
      // authors do not need to invent a status field merely to opt into
      // framework behavior.
      status: resourceOptions.status ?? emptyApplicationStatusSchema<TStatus>(),
    }), controller);
    collectApplicationResources(state, { [name]: definitionResource });
    recordApplicationCrdGraph(state, name, definitionResource);
    return definitionResource;
  };
  const crd = <TSpec extends object, TStatus extends object = Record<string, never>>(
    entityOrName: EntityDefinition<TSpec, TStatus> | string,
    options:
      | ApplicationCrdOptions<TSpec, TStatus>
      | ApplicationNamedCrdOptions<TSpec, TStatus>,
  ): PromotedKubernetesResource<TSpec, TStatus> => {
    const namedOptions = typeof entityOrName === 'string'
      ? options as ApplicationNamedCrdOptions<TSpec, TStatus>
      : undefined;
    const entity: EntityDefinition<TSpec, TStatus> = typeof entityOrName === 'string'
      ? {
          kind: 'applik8sEntity',
          name: entityOrName,
          spec: (options as ApplicationNamedCrdOptions<TSpec, TStatus>).spec,
          ...(namedOptions?.status ? { status: namedOptions.status } : {}),
        }
      : entityOrName;
    const normalizedOptions = namedOptions
      ? (() => {
          const {
            spec: _spec,
            status: _status,
            ...crdOptions
          } = namedOptions;
          return crdOptions;
        })()
      : options as ApplicationCrdOptions<TSpec, TStatus>;
    const { access, create, controller, ...crdOptions } = normalizedOptions;
    const definitionResource = bindApplicationResourceEvents(state, baseSdk.crd({
      ...crdOptions,
      kind: normalizedOptions.kind ?? entity.name,
      spec: entity.spec,
      // Promoted Kubernetes models share the same invisible framework-status
      // envelope as app.resource(...), even when they have no authored status.
      status: entity.status ?? emptyApplicationStatusSchema<TStatus>(),
    }), controller);
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
    bindApplicationModelViews(modelResource, (viewName, viewOptions, operationKind) => registerApplicationModelView(state, modelResource, viewName, viewOptions, operationKind));
    bindNativeKubernetesLifecycle(modelResource, {
      create: (name, lifecycleOptions, handler) => registerApplicationResourceController(modelResource, { created: handler }, { ...lifecycleOptions, name }),
      update: (name, lifecycleOptions, handler) => registerApplicationResourceController(modelResource, { updated: handler }, { ...lifecycleOptions, name }),
      delete: (name, lifecycleOptions, handler) => registerApplicationResourceController(modelResource, { deleted: handler }, { ...lifecycleOptions, name }),
    });
    return modelResource;
  };
  const registerApplicationResourceController = <TSpec extends object, TStatus extends object = Record<string, never>>(resource: ResourceDefinition<TSpec, TStatus>, handlers: ApplicationResourceEventHandlers<TSpec, TStatus>, options: ApplicationResourceControllerOptions = {}): ApplicationResourceControllerBinding => {
    const registrations: HandlerRegistration<object, object>[] = [];
    const callbacks: unknown[] = [];
    const register = (
      method: ApplicationResourceEventMethod,
      callback: unknown,
      ...args: readonly unknown[]
    ) => {
      registrations.push(registerRawApplicationResourceEvent(resource, 'proxy', method, [callback, ...args]));
      callbacks.push(callback);
    };
    if (handlers.reconcile) register('reconcile', handlers.reconcile);
    if (handlers.created) register('created', handlers.created);
    if (handlers.updated) register('updated', handlers.updated);
    if (handlers.deleted) register('deleted', handlers.deleted);
    if (handlers.statusChanged) register('statusChanged', handlers.statusChanged);
    if (handlers.finalize) {
      const { handler, ...finalizerOptions } = handlers.finalize;
      register('finalize', handler, finalizerOptions);
    }
    if (registrations.length === 0) {
      throw new Error(`Application controller for ${resource.kind} requires at least one lifecycle handler.`);
    }
    const controller = createApplicationResourceEventOperatorController(
      resource,
      registrations as unknown as HandlerRegistration<TSpec, TStatus>[],
      callbacks,
      options,
    );
    collectApplicationResources(state, applicationOperatorResources(controller.operator));
    recordApplicationOperatorGraph(state, controller.operator);
    return controller.deployed;
  };
  const authority = applicationAuthorityRegistrar(state);
  const mcp = applicationMcpRegistrar(state);
  const pendingHttp = new Map<string, {
    readonly options: ApplicationHttpOptions;
    readonly routes: ApplicationHttpRouteDeclaration[];
  }>();
  const typedHttp: ApplicationHttpRegistrar = (name, options = {}) => {
    if (pendingHttp.has(name) || servers[name]) {
      throw new Error(`Function-native HTTP server ${JSON.stringify(name)} is already declared.`);
    }
    const routes: ApplicationHttpRouteDeclaration[] = [];
    pendingHttp.set(name, { options, routes });
    return createApplicationHttpServer(name, (route) => {
      routes.push(route);
    });
  };
  const scope: KubernetesApplicationScope = {
    // typecast: app.api is the application-context name for the same generated HTTP workload registrar as app.server.
    api: server as ApplicationServerRegistrar & Record<string, ApplicationServerBinding>,
    http: typedHttp,
    // typecast: the callable server registrar also exposes named server bindings such as app.server.web after registration.
    server: server as ApplicationServerRegistrar & Record<string, ApplicationServerBinding>,
    storage,
    database,
    mcp,
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
          if (facet?.provider !== 'analytical-database') {
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
          bindApplicationModelViews(promoted, (viewName, viewOptions, operationKind) =>
            registerApplicationModelView(
              state,
              promoted,
              viewName,
              viewOptions,
              operationKind,
            ));
          return promoted;
        }
        const transactionalOptions =
          nativeOptions as ApplicationNativeDrizzleModelOptions<AnyPgTable> | undefined;
        const databaseBinding = resolveApplicationDatabase(state, transactionalOptions?.database);
        validateNativeModelAccess(entityOrName, databaseBinding, transactionalOptions?.access);
        if (!Object.values(databaseBinding.schema).includes(entityOrName)) {
          extendApplicationDatabaseSchema(
            databaseBinding,
            { [getTableName(entityOrName)]: entityOrName },
            `native model ${getTableName(entityOrName)}`,
          );
        }
        const promoted = promoteDrizzleTable(entityOrName, {
          ...transactionalOptions,
          database: databaseBinding.name,
          schema: databaseBinding.schema,
        });
        const promotedFacet = getRequiredDrizzleApplicationModelFacet(promoted);
        const promotedApi = promotedFacet.api;
        const runtimeModel = applicationNativeRuntimeModelContract(promoted, databaseBinding);
        const existingRegistration = state.nativeModelRegistrations.get(
          runtimeModel.name,
        );
        if (existingRegistration) {
          if (
            existingRegistration.table !== entityOrName
            || existingRegistration.database !== databaseBinding.name
            || !equivalentApplicationProcessorOptions(
              existingRegistration.processor,
              transactionalOptions?.processor,
            )
          ) {
            throw new Error(
              `Native model ${runtimeModel.name} is already registered with a different table, database, or processor placement.`,
            );
          }
          return promoted;
        }
        state.nativeModelRegistrations.set(runtimeModel.name, {
          table: entityOrName,
          database: databaseBinding.name,
          ...(transactionalOptions?.processor
            ? { processor: transactionalOptions.processor }
            : {}),
        });
        emitApplicationTransactionalDatabaseResources(state, runtimeModel, databaseBinding.provider);
        recordApplicationNativeModelGraph(
          state,
          promotedFacet,
          databaseBinding.provider,
          runtimeModel,
          databaseBinding.migrations
            ? {
                artifact: databaseBinding.migrations.path,
                ...(databaseBinding.migrations.digest
                  ? { digest: databaseBinding.migrations.digest }
                  : {}),
              }
            : {},
          databaseBinding.qualification,
        );
        bindSearch(promoted);
        state.models[runtimeModel.name] = runtimeModel;
        const commandModel = applicationNativeCommandModelBinding(promoted, runtimeModel);
        bindNativeApplicationModelBinding(promoted, commandModel as ApplicationModelBinding<object, object>);
        bindApplicationModelViews(promoted, (viewName, viewOptions, operationKind) => registerApplicationModelView(state, promoted, viewName, viewOptions, operationKind));
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
        ...(options.readiness ? { readiness: options.readiness } : {}),
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
        batch(name, batchOptions, handler) {
          return registerApplicationStreamBatchProcessor(state, name, binding, batchOptions, handler);
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
    job: ((jobId: `${string}.v${number}`, jobContract: ApplicationJobContract<object, object, object, object>, jobOptions: ApplicationJobOptions<object>, handler: ApplicationJobHandler<object, object, object, object>) =>
      registerApplicationJob(state, jobId, jobContract, jobOptions, handler)) as ApplicationJobRegistrar,
    workload: Object.freeze({
      job(name: string, options?: ApplicationWorkloadJobOptions) {
        return emitApplicationGeneratedJob(state, name, options ?? {}, undefined, applicationBindingPlan);
      },
      cronJob(name: string, options?: ApplicationWorkloadCronJobOptions) {
        return emitApplicationGeneratedJob(state, name, options ?? {}, options?.cron ?? '* * * * *', applicationBindingPlan);
      },
    }),
    defaults,
    provide,
    aggregate(name, options) {
      collectApplicationIndexes(state, { [options.source.name]: options.source });
      recordApplicationAggregateGraph(state, name, options);
      const workload = emitApplicationAggregateResources(name, options);
      return applicationAggregateBinding(name, options, workload);
    },
    agent(name, options, handler) {
      return registerApplicationAgent(state, name, options, handler);
    },
    actor(id, options) {
      if (!state.graphNodes.some((node) => node.kind === 'provider' && node.id === applicationProviderGraphNodeId('ActorRuntime'))) {
        recordApplicationProviderGraph(state, 'ActorRuntime', 'targetDefault', { kind: 'target-selected' }, ActorRuntime.contract);
      }
      const binding = createApplicationActor(id, options);
      const record = () => {
        const actorBindings = applicationActorHandlerCallbackDependencies(
          binding as unknown as ApplicationActorHandle<object, ApplicationActorProtocol>,
        ).flatMap(({ member, dependencies }) =>
          applicationActorDependencyBindings(
            state,
            `Application actor ${id}.${member}`,
            dependencies,
          ).map((dependency) => ({
            handler: member,
            alias: dependency.alias,
            actor: dependency.actor,
            member: dependency.member,
            memberKind: dependency.memberKind,
          })),
        );
        const actorNode = {
          ...binding.graphNode,
          ...(actorBindings.length > 0 ? { actorBindings } : {}),
        };
        addApplicationGraphNode(state, actorNode);
        for (const provider of actorNode.providerBindings ?? []) {
          addApplicationGraphEdge(state, {
            from: { nodeId: provider.provider.nodeId },
            to: { nodeId: actorNode.id },
            relationship: 'provides',
          });
        }
        const requirementId = `requirement.actor.${id}.event-log`;
        addApplicationProviderRequirement(state, {
          id: requirementId,
          interface: 'EventLog',
          consumer: { nodeId: actorNode.id },
          required: true,
          purpose: 'eventLog',
          diagnostics: {
            missing: `Actor ${id} requires one EventLog provider for committed outbox delivery.`,
            ambiguous: `Actor ${id} resolves more than one EventLog provider. Bind exactly one provider explicitly.`,
          },
        });
      };
      record();
      observeApplicationActorDefinition(
        binding as unknown as ApplicationActorHandle<object, ApplicationActorProtocol>,
        record,
      );
      return binding;
    },
    workflow: ((definitionOrId: WorkflowDefinition<object, object, Readonly<Record<string, object>>, Readonly<Record<string, object>>> | string, contractOrOptions: object, optionsOrHandler: object | ((...args: never[]) => unknown), maybeHandler?: (...args: never[]) => unknown) => {
      const functionNative = typeof definitionOrId === 'string';
      const definition = functionNative
        ? defineWorkflow(definitionOrId, contractOrOptions as ApplicationWorkflowContract<object, object>)
        : definitionOrId;
      const optionlessFunctionNative =
        functionNative
        && typeof optionsOrHandler === 'function'
        && maybeHandler === undefined;
      const options = functionNative
        ? optionlessFunctionNative
          ? {}
          : optionsOrHandler as object
        : contractOrOptions;
      const handler = functionNative
        ? optionlessFunctionNative
          ? optionsOrHandler
          : maybeHandler
        : optionsOrHandler as (...args: never[]) => unknown;
      if (typeof handler !== 'function') {
        throw new Error(`Application workflow ${definition.id} requires an implementation callback.`);
      }
      return isSingleStepWorkflowOptions(options)
        ? registerApplicationSingleStepWorkflow(state, definition as never, options as never, handler as never)
        : registerApplicationWorkflow(state, definition as never, options as never, handler as never);
    }) as KubernetesApplicationScope['workflow'],
    // typecast-boundary: these generic helpers return TypeKro expression proxies
    // typed as the selected scalar, matching the public graph DSL contract.
    select: applicationGraphSelect as KubernetesApplicationScope['select'],
    selectProvider: applicationGraphProviderSelection as KubernetesApplicationScope['selectProvider'],
    selectTarget: ((factories) => {
      const targets = Object.fromEntries(Object.entries(factories).map(([target, factory]) => {
        if (typeof factory !== 'function') throw new Error(`app.selectTarget(...) branch ${target} requires a provider factory.`);
        return [target === 'awsLocal' ? 'aws-local' : target, factory()];
      }));
      if (Object.keys(targets).length === 0) throw new Error('app.selectTarget(...) requires at least one deployment-target branch.');
      return { kind: 'application-target-provider-selection', targets } as unknown;
    }) as KubernetesApplicationScope['selectTarget'],
    when: applicationGraphWhen as KubernetesApplicationScope['when'],
    any: applicationGraphAny,
    all: applicationGraphAll,
    interpolate: applicationGraphInterpolate,
  };
  Object.assign(scope.workflow, {
    signal<TInput extends object, TActions extends Readonly<Record<string, object>>>(
      id: string,
      contract: ApplicationSignalContract<TInput, TActions>,
    ): ApplicationSignalBinding<ApplicationSignalDefinition<TInput, TActions>> {
      const signal = defineApplicationSignal(id, contract);
      const database = resolveApplicationDatabase(state, undefined);
      const stream = applicationSignalStreamOptions(signal, database);
      const binding = scope.stream({
        kind: 'applik8sEvent',
        id: signal.id,
        name: signal.name,
        version: signal.version,
        payload: stream.payload,
        emit() {
          throw new Error(
            `Signal ${signal.id} issuance is framework-owned. Use workflow.emitSignal(...).`,
          );
        },
      }, stream.options);
      return Object.freeze({
        ...binding,
        ...applicationSignalAuthorityFacets(signal),
        signalKind: 'applicationSignal' as const,
        signal,
        // typecast-boundary: signal projection decoding is inert at the
        // generated worker boundary; the shared stream registrar carries the
        // same wire payload before that execution-family-specific decoding.
        project: binding.project as unknown as ApplicationSignalBinding<
          typeof signal
        >['project'],
        subscribe: ((nameOrOptions: string | object, subscriptionOptions?: object) => {
          if (typeof nameOrOptions === 'string') {
            return Reflect.apply(binding.subscribe, binding, [
              nameOrOptions,
              subscriptionOptions,
            ]);
          }
          throw new Error(
            `Signal ${signal.id}.subscribe(...) consumption requires an environment-specific generated application facade.`,
          );
        }) as ApplicationSignalBinding<typeof signal>['subscribe'],
      });
    },
    emitSignal<TDefinition extends ApplicationSignalDefinition>(
      signal: TDefinition | ApplicationSignalBinding<TDefinition>,
      signalOptions: ApplicationSignalEmitOptions<TDefinition>,
    ): Promise<ApplicationSignalDecision<TDefinition>> {
      return emitApplicationWorkflowSignal(
        isApplicationSignalBinding(signal) ? signal.signal : signal,
        signalOptions,
      );
    },
  } satisfies Pick<ApplicationWorkflowRegistrar, 'signal' | 'emitSignal'>);
  applicationStateByScope.set(scope, state);
  return {
    scope,
    state,
    finalize() {
      for (const [name, pending] of pendingHttp) {
        registerFunctionNativeServer(
          name,
          pending.options,
          pending.routes.map((route) =>
            applicationFunctionNativeHttpServerRoute(state, name, route)),
        );
      }
      pendingHttp.clear();
    },
  };
}

function isApplicationSignalBinding<TDefinition extends ApplicationSignalDefinition>(
  value: TDefinition | ApplicationSignalBinding<TDefinition>,
): value is ApplicationSignalBinding<TDefinition> {
  return Reflect.get(value, 'signalKind') === 'applicationSignal';
}

const applicationGraphSelectionValues = new WeakMap<object, ReadonlySet<ApplicationGraphScalar>>();

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
    (otherwise, [key, value]) =>
      `(${inputExpression}) == ${JSON.stringify(key)} ? (${applicationGraphScalarExpression(value)}) : (${otherwise})`,
    applicationGraphScalarExpression(cases.default),
  );
  const selected = Cel.expr<TOutput>(expression);
  const possibleValues = [...entries.map(([, value]) => value), cases.default];
  if (possibleValues.every((value) => applicationTypeKroExpressionValue(value) === undefined)) {
    applicationGraphSelectionValues.set(
      selected,
      new Set<ApplicationGraphScalar>(possibleValues),
    );
  }
  return selected;
}

function applicationGraphSelectedValues(value: unknown): ReadonlySet<ApplicationGraphScalar> | undefined {
  return value && typeof value === 'object'
    ? applicationGraphSelectionValues.get(value)
    : undefined;
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

function createApplicationTargetProviderBinding<TImplementation>(
  token: ApplicationProviderToken<TImplementation>,
  onChange: (selection: ApplicationTargetProviderSelectionValue<TImplementation>) => void,
): ApplicationTargetProviderBinding<TImplementation> {
  const targets: Partial<Record<ApplicationProviderDeploymentTarget, TImplementation>> = {};
  let binding: ApplicationTargetProviderBinding<TImplementation>;
  const select = (target: ApplicationProviderDeploymentTarget, factory: () => TImplementation): ApplicationTargetProviderBinding<TImplementation> => {
    if (typeof factory !== 'function') throw new Error(`app.provide(...).${target}(...) requires a provider factory.`);
    const implementation = factory();
    targets[target] = implementation;
    onChange({ kind: 'application-target-provider-selection', targets: { ...targets } });
    return binding;
  };
  binding = {
    kind: 'applicationProvider',
    token,
    get implementation() {
      return { kind: 'application-target-provider-selection' as const, targets: { ...targets } };
    },
    local(factory) { return select('local', factory); },
    awsLocal(factory) { return select('aws-local', factory); },
    aws(factory) { return select('aws', factory); },
    kubernetes(factory) { return select('kubernetes', factory); },
  };
  return binding;
}

function targetProviderMethod<TImplementation>(
  binding: ApplicationTargetProviderBinding<TImplementation>,
  target: ApplicationProviderDeploymentTarget,
): (factory: () => TImplementation) => ApplicationTargetProviderBinding<TImplementation> {
  if (target === 'aws-local') return binding.awsLocal.bind(binding);
  return binding[target].bind(binding);
}

function targetProviderReplayBinding<TImplementation>(
  preview: ApplicationTargetProviderBinding<TImplementation>,
  onBranch: (target: ApplicationProviderDeploymentTarget, factory: () => TImplementation) => void,
): ApplicationTargetProviderBinding<TImplementation> {
  let binding: ApplicationTargetProviderBinding<TImplementation>;
  const branch = (target: ApplicationProviderDeploymentTarget, factory: () => TImplementation) => {
    onBranch(target, factory);
    return binding;
  };
  binding = {
    kind: 'applicationProvider',
    token: preview.token,
    get implementation() { return preview.implementation; },
    local(factory) { return branch('local', factory); },
    awsLocal(factory) { return branch('aws-local', factory); },
    aws(factory) { return branch('aws', factory); },
    kubernetes(factory) { return branch('kubernetes', factory); },
  };
  return binding;
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
  if (provider?.kind !== 'provider') {
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
  for (const branch of profile.branches) {
    for (const dependency of branch.privateRuntime?.postgres ?? []) {
      addApplicationGraphEdge(state, {
        from: { nodeId: dependency.databaseProviderNodeId },
        to: { nodeId: providerNodeId },
        relationship: 'provides',
      });
    }
  }
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
  return Cel.expr<TOutput>(
    `(${conditionExpression}) ? (${applicationGraphScalarExpression(branches.then)}) : (${applicationGraphScalarExpression(branches.otherwise)})`,
  );
}

function applicationGraphAny(...conditions: readonly boolean[]): boolean {
  return applicationGraphBoolean('||', false, conditions);
}

function applicationGraphAll(...conditions: readonly boolean[]): boolean {
  return applicationGraphBoolean('&&', true, conditions);
}

function applicationGraphBoolean(operator: '&&' | '||', identity: boolean, conditions: readonly boolean[]): boolean {
  if (conditions.length === 0) return identity;
  const terms = conditions.map((condition) => ({
    condition,
    expression: applicationTypeKroExpressionValue(condition),
  }));
  const concrete = terms.filter((term) => term.expression === undefined);
  if (operator === '&&' && concrete.some((term) => term.condition === false)) return false;
  if (operator === '||' && concrete.some((term) => term.condition === true)) return true;
  const dynamic = terms.filter((term) => term.expression !== undefined);
  if (dynamic.length === 0) return identity;
  const [onlyDynamic] = dynamic;
  if (onlyDynamic && dynamic.length === 1) return onlyDynamic.condition;
  return Cel.expr<boolean>(dynamic.map((term) => `(${term.expression})`).join(` ${operator} `));
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

function emptyApplicationStatusSchema<TStatus extends object>(): SchemaInput<TStatus> {
  // typecast: an omitted domain status has the public Record<string, never>
  // shape, while ArkType's empty object schema is the matching runtime
  // representation used to reserve the framework-owned status subresource.
  return arkType({}) as unknown as SchemaInput<TStatus>;
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

function registerApplicationDatabaseSchemaModels(
  scope: KubernetesApplicationScope,
  database: ApplicationDatabaseBinding,
  schema: Readonly<Record<string, unknown>>,
  processor: ApplicationProcessorOptions | undefined,
): void {
  const registered = new Set<object>();
  for (const [schemaName, candidate] of Object.entries(schema)) {
    if (
      !isTable(candidate)
      || !isApplicationRelationalModel(candidate)
      || registered.has(candidate)
    ) continue;
    registered.add(candidate);
    const declaration = applicationRelationalModelOptionsFor(candidate);
    scope.model(candidate as AnyPgTable, {
      name: declaration.name ?? logicalApplicationModelName(schemaName),
      database,
      ...(declaration.identity
        ? { identity: declaration.identity }
        : {}),
      ...(declaration.revision !== undefined
        ? { revision: declaration.revision }
        : {}),
      ...(declaration.runtimeRoles
        ? { runtimeRoles: declaration.runtimeRoles }
        : {}),
      ...(processor ? { processor } : {}),
    });
  }
}

function inferredApplicationModuleSchema(
  result: unknown,
): Readonly<Record<string, unknown>> {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return Object.freeze({});
  }
  return Object.freeze(Object.fromEntries(
    Object.entries(result).filter(([, candidate]) => (
      isApplicationRelationalModel(candidate)
      || is(candidate, Relations)
    )),
  ));
}

function soleApplicationDatabase(
  state: ApplicationScopeState,
  owner: string,
): ApplicationDatabaseBinding {
  const databases = [...state.databases.values()];
  if (databases.length === 1 && databases[0]) return databases[0];
  if (databases.length === 0) {
    throw new Error(
      `${owner} requires the application profile to provide and bind its native database before inclusion.`,
    );
  }
  throw new Error(
    `${owner} cannot infer a database because ${databases.length} native databases are bound. Provide the module's qualified database capability explicitly.`,
  );
}

function extendApplicationDatabaseSchema(
  database: ApplicationDatabaseBinding,
  extension: Readonly<Record<string, unknown>>,
  moduleName: string,
): Readonly<Record<string, unknown>> {
  const schema = database.schema as Record<string, unknown>;
  const added: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(extension)) {
    const existing = schema[name];
    if (existing !== undefined && existing !== value) {
      throw new Error(
        `Application module ${moduleName} cannot register database schema member ${JSON.stringify(name)} because database ${database.name} already owns a different value.`,
      );
    }
    if (existing === undefined) {
      schema[name] = value;
      added[name] = value;
    }
  }
  return Object.freeze(added);
}

function equivalentApplicationProcessorOptions(
  left: ApplicationProcessorOptions | undefined,
  right: ApplicationProcessorOptions | undefined,
): boolean {
  return JSON.stringify(left ?? {}) === JSON.stringify(right ?? {});
}

function logicalApplicationModelName(schemaName: string): string {
  const words = schemaName
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) {
    throw new Error('Application database schema model names must not be empty.');
  }
  const last = words.at(-1) as string;
  if (/ies$/i.test(last) && last.length > 3) {
    words[words.length - 1] = `${last.slice(0, -3)}y`;
  } else if (/(?:ches|shes|sses|xes|zes)$/i.test(last) && last.length > 3) {
    words[words.length - 1] = last.slice(0, -2);
  } else if (/s$/i.test(last) && !/ss$/i.test(last) && last.length > 1) {
    words[words.length - 1] = last.slice(0, -1);
  }
  return words
    .map((word) => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`)
    .join('');
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
        ...(rule.scope ? { scope: rule.scope } : {}),
        ...(rule.namespaces ? { namespaces: rule.namespaces === 'all' ? 'all' as const : [...rule.namespaces] } : {}),
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
    deployment: {
      ...(options.namespace ? { namespace: options.namespace } : {}),
      replicas: options.replicas ?? 1,
      port: options.service?.port ?? 80,
      maxRequestBodyBytes: options.maxRequestBodyBytes ?? 1_048_576,
      mutationRateLimit: {
        maxRequests: options.mutationRateLimit?.maxRequests ?? 120,
        windowSeconds: options.mutationRateLimit?.windowSeconds ?? 60,
      },
    },
    routes: routes.map((route) => ({
      id: route.id,
      named: route.named,
      method: route.method,
      path: route.path,
      ...(route.authority ? { authority: route.authority } : {}),
      ...(route.functionNative
        ? {
            functionNative: {
              input: {
                kind: 'declared' as const,
                runtime: 'arktype' as const,
                jsonSchema: route.functionNative.input,
              },
              output: {
                kind: 'declared' as const,
                runtime: 'arktype' as const,
                jsonSchema: route.functionNative.output,
              },
              handler: {
                source: route.handlerSource,
                ...(route.handlerDependencySource
                  ? {
                      dependencies: {
                        source: route.handlerDependencySource,
                        resolveDir:
                          route.handlerDependencyResolveDir ?? process.cwd(),
                      },
                    }
                  : {}),
                ...(route.handlerSourceLocation
                  ? { location: route.handlerSourceLocation }
                  : {}),
              },
              ...(route.functionNative.authorizeSource
                ? {
                    authorize: {
                      source: route.functionNative.authorizeSource,
                      ...(route.functionNative.authorizeDependencies
                        ? {
                            dependencies:
                              route.functionNative.authorizeDependencies,
                          }
                        : {}),
                      ...(route.functionNative.authorizeLocation
                        ? {
                            location:
                              route.functionNative.authorizeLocation,
                          }
                        : {}),
                    },
                  }
                : {}),
              ...(route.functionNative.webhookAuthentication
                ? {
                    webhookAuthentication:
                      route.functionNative.webhookAuthentication,
                  }
                : {}),
              ...(route.functionNative.operationBindings
                ? {
                    operationBindings:
                      route.functionNative.operationBindings,
                  }
                : {}),
              ...(route.functionNative.providerBindings
                ? {
                    providerBindings:
                      route.functionNative.providerBindings,
                  }
                : {}),
              ...(route.functionNative.objectBindings
                ? {
                    objectBindings:
                      route.functionNative.objectBindings,
                  }
                : {}),
              ...(route.functionNative.workflowBindings
                ? {
                    workflowBindings:
                      route.functionNative.workflowBindings,
                    workflowEngine: route.functionNative.workflowEngine,
                  }
                : {}),
              ...(route.functionNative.transaction
                ? { transaction: route.functionNative.transaction }
                : {}),
              idempotency: {
                source: 'http-idempotency-key' as const,
                contextScoped: true as const,
              },
              requestBoundary: {
                durableValues: 'schema-normalized-only' as const,
                rawRequestCapture: 'rejected' as const,
                principal: route.functionNative.webhookAuthentication
                  ? 'provider-authenticated' as const
                  : 'framework-authenticated' as const,
              },
            },
          }
        : {}),
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
  for (const provider of routes.flatMap(
    (route) => route.functionNative?.providerBindings ?? [],
  )) {
    addApplicationGraphEdge(state, {
      from: { nodeId: provider.provider.nodeId },
      to: { nodeId },
      relationship: 'provides',
    });
  }
  for (const object of routes.flatMap(
    (route) => route.functionNative?.objectBindings ?? [],
  )) {
    addApplicationGraphEdge(state, {
      from: { nodeId },
      to: object.store,
      relationship: 'reads',
    });
  }
  for (const workflow of routes.flatMap(
    (route) => route.functionNative?.workflowBindings ?? [],
  )) {
    addApplicationGraphEdge(state, {
      from: { nodeId },
      to: workflow.target,
      relationship: 'dependsOn',
    });
  }
  for (const provider of routes.flatMap((route) =>
    route.functionNative?.workflowEngine
      ? [route.functionNative.workflowEngine]
      : [])) {
    addApplicationGraphEdge(state, {
      from: { nodeId: provider.nodeId },
      to: { nodeId },
      relationship: 'provides',
    });
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
    const branchGroups = new Map<
      string,
      {
        readonly provider: ApplicationTransactionalDatabaseProvider;
        readonly variants: string[];
      }
    >();
    for (const [variant, branch] of branches) {
      const key = JSON.stringify(applicationTypeKroGraphValue(branch));
      const previous = branchGroups.get(key);
      if (previous) {
        previous.variants.push(variant);
      } else {
        branchGroups.set(key, { provider: branch, variants: [variant] });
      }
    }
    for (const { provider: branch, variants } of branchGroups.values()) {
      const branchIdentity = variants.join('-');
      const selected = variants
        .map(
          (variant) =>
            `${selection.selector} == ${JSON.stringify(variant)}`,
        )
        .join(' || ');
      emitApplicationTransactionalDatabaseBranchResources(
        state,
        model,
        branch,
        branchIdentity,
        Cel.expr<boolean>(`(${selected})`),
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
  const databaseAuthority = model.authorityName ?? modelName;
  const resourceName = kubernetesNameSegment(databaseAuthority);
  const branchSegment = branch ? kubernetesNameSegment(branch) : '';
  const branchSuffix = branch ? pascalCase(branch) : '';
  const inferredClusterName =
    `${resourceName}${branchSegment ? `-${branchSegment}` : ''}-db`;
  const fallbackClusterName =
    provider.name
    ?? inferredClusterName;
  // In a discriminated installation union the external branch requires
  // clusterName, while KRO's structural superset must expose it as optional.
  // Preserve that required value directly for a profile-selected external
  // authority. Falling back here would weaken the authored branch contract
  // and would ask TypeKro to infer nullish behavior from the structural KRO
  // superset. Concrete/direct providers retain their ordinary defaults.
  const clusterName = Cel.default(provider.clusterName, fallbackClusterName);
  const namespace = provider.namespace;
  const database = provider.database ?? databaseAuthority;
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
  const ownershipExpression = applicationTypeKroExpressionValue(ownership);
  const selectedOwnershipValues = applicationGraphSelectedValues(ownership);
  const clusterReference = provider.cluster ?? {
    apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster', name: clusterName, ...(namespace ? { namespace } : {}),
  };
  const clusterResourceId = graphResourceId(resourceName, `transactionalDatabaseCluster${branchSuffix}`);
  const graphOwned = ownershipExpression
    ? Cel.expr<boolean>(`(${ownershipExpression}) == "application-graph"`)
    : ownership === 'application-graph';
  const directlyProvisioned = ownershipExpression
    ? Cel.expr<boolean>(`(${ownershipExpression}) == "direct-provisioned"`)
    : ownership === 'direct-provisioned';
  const externallyOwned = ownershipExpression
    ? Cel.expr<boolean>(`(${ownershipExpression}) == "external"`)
    : ownership === 'external';
  const mayBeGraphOwned = selectedOwnershipValues
    ? selectedOwnershipValues.has('application-graph')
    : ownershipExpression !== undefined || graphOwned === true;
  const mayBeDirectlyProvisioned = selectedOwnershipValues
    ? selectedOwnershipValues.has('direct-provisioned')
    : ownershipExpression !== undefined || directlyProvisioned === true;
  const mayBeExternallyOwned = selectedOwnershipValues
    ? selectedOwnershipValues.has('external')
    : ownershipExpression !== undefined || externallyOwned === true;

  if (mayBeGraphOwned) {
    const clusterResource = typeKroCnpgCluster({
      id: ownershipExpression ? `${clusterResourceId}GraphOwned` : clusterResourceId,
      name: clusterName,
      ...(namespace ? { namespace } : {}),
      // typecast: TypeKro's CNPG factory types s3Credentials.region as a
      // string, while the installed CNPG v1 CRD correctly requires a
      // SecretKeySelector. Keep Applik8s' admitted Kubernetes shape correct
      // at this provider boundary until the upstream declaration catches up.
      spec: applicationPostgresClusterSpec(provider, database) as never,
    });
    applyApplicationTypeKroIncludeWhen(
      clusterResource,
      applicationGraphAll(includeWhen, graphOwned),
    );
  }

  const observeExternalCluster = provider.connectionSecret
    ? directlyProvisioned
    : applicationGraphAny(directlyProvisioned, externallyOwned);
  if (mayBeDirectlyProvisioned || (!provider.connectionSecret && mayBeExternallyOwned)) {
    const clusterResource = externalRef({
      id: clusterResourceId,
      apiVersion: clusterReference.apiVersion ?? 'postgresql.cnpg.io/v1',
      kind: clusterReference.kind ?? 'Cluster',
      metadata: {
        name: clusterReference.name ?? clusterName,
        ...(clusterReference.namespace ? { namespace: clusterReference.namespace } : {}),
      },
    });
    applyApplicationTypeKroIncludeWhen(
      clusterResource,
      applicationGraphAll(includeWhen, observeExternalCluster),
    );
  }

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
  const unsupportedPermission = serverPermissions.find((rule) =>
    rule.scope === 'Cluster'
    || rule.namespaces === 'all'
    || Array.isArray(rule.namespaces) && rule.namespaces.some((target) => target !== (namespace ?? 'default')));
  if (unsupportedPermission) {
    throw new Error(`app.server ${name} requires cluster-scoped or cross-namespace Kubernetes access. The current application-server materializer only owns namespace-local Roles; select a workload boundary with an explicit cluster/cross-namespace access lowerer instead of silently emitting ineffective RBAC.`);
  }
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
