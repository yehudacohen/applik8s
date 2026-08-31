// typecast-file-boundary: graph contract internals validate every discriminator and JSON contract before restoring the portable ApplicationGraph union.

import {
  type ApplicationCanonicalIdentity,
  type ApplicationRuntimeAccessOperation,
  type ApplicationRuntimeAccessRequirement,
  type ApplicationSourceProvenance,
  validateApplicationFoundation,
} from './application-foundation.js';
import type {
  ApplicationHandlerDependencies,
  ApplicationKubernetesCreateAuthorityContract,
  ApplicationKubernetesQueryAuthorityContract,
  ApplicationSerializedCallbackContract,
} from './application-graph-gateway.js';
import type {
  ApplicationIdentityReference,
  ApplicationOperationId,
  ApplicationOperationInvocationDependency,
  ApplicationOperationTransport,
  ApplicationScopeExpression,
  ApplicationStaticAuthorityManifest,
} from './application-operation-authority.js';
import type { ApiVersion, Condition, Diagnostic, JsonObject, JsonValue, KubernetesName, NamespaceName, ObjectRef, ResourceScope, SourceLocation } from './common.js';
import type { PermissionRule } from './resource.js';

export type {
  ApplicationHandlerDependencies,
  ApplicationKubernetesCreateAuthorityContract,
  ApplicationKubernetesQueryAuthorityContract,
  ApplicationSerializedCallbackContract,
} from './application-graph-gateway.js';

import { validateApplicationGraphCompatibility } from './application-graph-compatibility.js';
import type { ApplicationNestedInstallationNode } from './application-graph-installation.js';
import { applicationModelNodeStructureDiagnostics, applicationObservabilityStructureDiagnostics, applicationProviderBindingDiagnostic, applicationProviderRefDiagnostics, applicationProviderRefsForNode, compareStrings, uniqueApplicationProviderRefs, validateApplicationRouteDiagnosticsContract } from './application-graph-node-validation.js';
import { applicationReactiveNodeStructureMessages } from './application-graph-reactive-validation.js';
import { normalizeApplicationGraphArtifact, serializeNormalizedApplicationGraph } from './application-graph-serialization.js';
import {
  type ApplicationProfileProviderSelectionContract,
  validateApplicationProfileDescriptor,
  validateApplicationProfileProviderSelection,
} from './application-profile.js';

export type { ApplicationInstallationArtifactContract, ApplicationNestedInstallationNode } from './application-graph-installation.js';
export { applicationInstallationMetadataProperty } from './application-graph-installation.js';

import type { ApplicationExposureNode, ApplicationFunctionNativeTransactionContract, ApplicationObjectStoreNode, ApplicationProjectionNode, ApplicationStreamProcessorNode } from './application-graph-projections.js';

export type { ApplicationDnsIntentContract, ApplicationExposureNode, ApplicationExposureReadinessContract, ApplicationExposureTransportContract, ApplicationFunctionNativeTransactionContract, ApplicationObjectStoreNode, ApplicationProjectionNode, ApplicationStreamProcessorNode, ApplicationTlsIntentContract } from './application-graph-projections.js';

export type ApplicationGraphVersion = 'applik8s.appGraph/v1alpha1';

export const applicationGraphMetadataProperty = '__applik8sApplicationGraph';
/** Internal authoring bridge used by the deployment adapter to rebuild a compiled TypeKro root. */
export const applicationTypeKroDefinitionProperty = '__applik8sTypeKroDefinition';

/**
 * Non-enumerable metadata shared by the application builder and compiler.
 * It controls artifact emission only; installation values remain ordinary
 * Kubernetes custom resources supplied by the application owner.
 */
export const applicationGraphArtifactFileName = 'application-graph.json';

export interface ApplicationGraphArtifactReference {
  readonly apiVersion: ApplicationGraphVersion;
  readonly path: string;
  readonly digest: string;
}

export type ApplicationGraphNodeKind =
  | 'installation'
  | 'crd'
  | 'model'
  | 'server'
  | 'operator'
  | 'index'
  | 'aggregate'
  | 'counter'
  | 'command'
  | 'event'
  | 'commandHandler'
  | 'processor'
  | 'task'
  | 'taskHandler'
  | 'workflow'
  | 'workflowHandler'
  | 'workflowWorker'
  | 'saga'
  | 'mlModel'
  | 'schedule'
  | 'lakehousePublication'
  | 'actor'
  | 'aiAgent'
  | 'mcpServer'
  | 'mcpClient'
  | 'query'
  | 'gateway'
  | 'stream'
  | 'streamProcessor'
  | 'subscription'
  | 'projection'
  | 'objectStore'
  | 'job'
  | 'workloadJob'
  | 'config'
  | 'secret'
  | 'exposure'
  | 'provider'
  | 'permission'
  | 'authorityManifest'
  | 'typeKroResource';

// typecast: the runtime node-kind registry is intentionally kept as a literal tuple while checked against the public union.
export const applicationGraphNodeKinds = [
  'installation',
  'crd',
  'model',
  'server',
  'operator',
  'index',
  'aggregate',
  'counter',
  'command',
  'event',
  'commandHandler',
  'processor',
  'task',
  'taskHandler',
  'workflow',
  'workflowHandler',
  'workflowWorker',
  'saga',
  'mlModel',
  'schedule',
  'lakehousePublication',
  'actor',
  'aiAgent',
  'mcpServer',
  'mcpClient',
  'query',
  'gateway',
  'stream',
  'streamProcessor',
  'subscription',
  'projection',
  'objectStore',
  'job',
  'workloadJob',
  'config',
  'secret',
  'exposure',
  'provider',
  'permission',
  'authorityManifest',
  'typeKroResource',
] as const satisfies readonly ApplicationGraphNodeKind[];

export type ApplicationBuiltInProviderInterfaceKind =
  | 'TransactionalDatabase'
  | 'IndexStore'
  | 'Search'
  | 'CounterStore'
  | 'EventSource'
  | 'EventLog'
  | 'Secret'
  | 'Queue'
  | 'ObjectStorage'
  | 'HttpExposure'
  | 'Certificate'
  | 'DnsPublication'
  | 'CredentialStore'
  | 'WorkflowEngine'
  | 'JobRuntime'
  | 'ManagedModelStore'
  | 'OperatorRuntime'
  | 'Scheduler'
  | 'Observability'
  | 'LakehouseDataset'
  | 'LakehouseQuery'
  | 'ActorRuntime'
  | 'AnalyticalDatabase'
  | 'ApplicationHost'
  | 'ContainerRegistry'
  | 'IdentityProvider'
  | 'OAuthAuthorizationServer'
  | 'Authorization'
  | 'StructuredGeneration'
  | 'AI';

/** Built-ins remain strongly named while versioned provider packages may add interfaces without editing core. */
export type ApplicationProviderInterfaceKind = ApplicationBuiltInProviderInterfaceKind | (string & {});

// typecast: the runtime provider-interface registry is intentionally kept as a literal tuple while checked against the public union.
export const applicationProviderInterfaceKinds = [
  'TransactionalDatabase',
  'IndexStore',
  'Search',
  'CounterStore',
  'EventSource',
  'EventLog',
  'Secret',
  'Queue',
  'ObjectStorage',
  'HttpExposure',
  'Certificate',
  'DnsPublication',
  'CredentialStore',
  'WorkflowEngine',
  'JobRuntime',
  'ManagedModelStore',
  'OperatorRuntime',
  'Scheduler',
  'Observability',
  'LakehouseDataset',
  'LakehouseQuery',
  'ActorRuntime',
  'AnalyticalDatabase',
  'ApplicationHost',
  'ContainerRegistry',
  'IdentityProvider',
  'OAuthAuthorizationServer',
  'Authorization',
  'StructuredGeneration',
  'AI',
] as const satisfies readonly ApplicationProviderInterfaceKind[];

// typecast: v0.3 predates the experimental EventLog surface introduced for v0.4 durable behavior.
export const applicationV03ProviderInterfaceKinds = [
  'TransactionalDatabase',
  'IndexStore',
  'CounterStore',
  'EventSource',
  'Secret',
  'Queue',
  'ObjectStorage',
  'HttpExposure',
  'CredentialStore',
] as const satisfies readonly ApplicationProviderInterfaceKind[];

// typecast: the v0.3 live evidence checklist is a narrow tuple so diagnostics name each required assertion exactly.
export const applicationV03LiveValidationAssertions = [
  'migration job completes',
  'server becomes ready',
  'model create/query works',
  'duplicate key returns 409',
  'durable job status is persisted',
  'migration drift fails closed',
  'operation-target dry-run is artifact-backed',
  'scoped listener routes watched objects',
  'unsupported watch predicates fail closed',
] as const;

export type ApplicationV03LiveValidationAssertion = typeof applicationV03LiveValidationAssertions[number];

export interface ApplicationGraph {
  readonly apiVersion: ApplicationGraphVersion;
  readonly kind: 'ApplicationGraph';
  readonly metadata: ApplicationGraphMetadata;
  readonly nodes: readonly ApplicationGraphNode[];
  readonly edges: readonly ApplicationGraphEdge[];
  readonly providerRequirements: readonly ApplicationProviderRequirement[];
  readonly providerBindings: readonly ApplicationProviderBindingContract[];
  readonly compatibility: ApplicationGraphCompatibility;
  /** v0.8 derived analysis remains part of this graph rather than a parallel semantic model. */
  readonly foundation?: ApplicationGraphFoundationContract;
}

export interface ApplicationGraphFoundationContract {
  readonly identities: readonly ApplicationCanonicalIdentity[];
  readonly provenance: readonly ApplicationSourceProvenance[];
  readonly runtimeAccess: readonly ApplicationRuntimeAccessRequirement[];
}

export interface ApplicationGraphMetadata {
  readonly name: KubernetesName;
  readonly namespace?: NamespaceName;
  readonly sourceLocation?: SourceLocation;
  readonly labels?: Readonly<Record<string, string>>;
  readonly annotations?: Readonly<Record<string, string>>;
}

export type ApplicationGraphNode =
  | ApplicationNestedInstallationNode
  | ApplicationCrdNode
  | ApplicationModelNode
  | ApplicationServerNode
  | ApplicationOperatorNode
  | ApplicationIndexNode
  | ApplicationAggregateNode
  | ApplicationCounterNode
  | ApplicationCommandNode
  | ApplicationEventNode
  | ApplicationCommandHandlerNode
  | ApplicationProcessorNode
  | ApplicationTaskNode
  | ApplicationTaskHandlerNode
  | ApplicationWorkflowNode
  | ApplicationWorkflowHandlerNode
  | ApplicationWorkflowWorkerNode
  | ApplicationSagaNode
  | ApplicationMLModelNode
  | ApplicationScheduleNode
  | ApplicationLakehousePublicationNode
  | ApplicationActorNode
  | ApplicationAIAgentNode
  | ApplicationMcpServerNode
  | ApplicationMcpClientNode
  | ApplicationQueryNode
  | ApplicationGatewayNode
  | ApplicationStreamNode
  | ApplicationStreamProcessorNode
  | ApplicationSubscriptionNode
  | ApplicationProjectionNode
  | ApplicationObjectStoreNode
  | ApplicationJobNode
  | ApplicationWorkloadJobNode
  | ApplicationConfigNode
  | ApplicationSecretNode
  | ApplicationExposureNode
  | ApplicationProviderNode
  | ApplicationPermissionNode
  | ApplicationAuthorityManifestNode
  | ApplicationTypeKroResourceNode;

export interface ApplicationGraphNodeBase<TKind extends ApplicationGraphNodeKind> {
  readonly id: string;
  readonly kind: TKind;
  readonly name: string;
  readonly sourceLocation?: SourceLocation;
  readonly stability: ApplicationGraphStability;
}

export type ApplicationGraphStability = 'stable' | 'experimental' | 'internal';

export interface ApplicationCrdNode extends ApplicationGraphNodeBase<'crd'> {
  readonly resource: ApplicationResourceContract;
  readonly materialization: 'kubernetes-crd';
  readonly native?: ApplicationNativeModelContract;
  readonly common?: ApplicationCommonModelContract;
  readonly create?: ApplicationKubernetesCreateAuthorityContract;
  /** Provider-neutral desired-state semantics supplied by the Kubernetes resource authority. */
  readonly managed?: ApplicationManagedModelContract;
}

export interface ApplicationModelNode extends ApplicationGraphNodeBase<'model'> {
  readonly entity: ApplicationEntityContract;
  readonly database: ApplicationProviderRef<
    'TransactionalDatabase' | 'AnalyticalDatabase'
  >;
  readonly schema: ApplicationModelSchemaContract;
  readonly materialization: ApplicationModelMaterializationContract;
  /** Present for explicitly promoted native tables/resources; absent for legacy JSONB models. */
  readonly native?: ApplicationNativeModelContract;
  /** Provider-neutral identity, revision, relationship, and change semantics. */
  readonly common?: ApplicationCommonModelContract;
  readonly runtime?: ApplicationModelRuntimeContract;
  /** Provider-neutral desired-state lifecycle layered on the existing model authority. */
  readonly managed?: ApplicationManagedModelContract;
  readonly generatedResources?: readonly ApplicationGeneratedResourceContract[];
}

export interface ApplicationManagedModelContract {
  readonly status: ApplicationMessageContractSchema;
  readonly initialStatus?: JsonObject;
  readonly statusSchemaVersion: string;
  readonly store: ApplicationProviderRef<'ManagedModelStore'>;
  readonly runtime: ApplicationProviderRef<'OperatorRuntime'>;
  readonly lifecycle: {
    readonly generation: 'desiredValueDigest' | 'kubernetesMetadataGeneration';
    readonly notification: 'invalidationHint';
    readonly resync: { readonly intervalSeconds: number; readonly maximumItems: number };
    readonly lease: { readonly durationSeconds: number; readonly fencing: 'monotonicToken' | 'uidGenerationResourceVersion' };
    readonly status: 'schemaCompleteCompareAndSet';
    readonly conditions: 'singleWriterPerStaticType';
    readonly nextDue: 'operatorOwned';
    readonly deletion: 'intentThenFinalize';
  };
  readonly reconcile?: {
    readonly handlerSource: string;
    readonly handlerDependencies?: ApplicationHandlerDependencies;
    readonly handlerLocation?: SourceLocation;
    readonly handlerUnresolved?: readonly string[];
    readonly conditionTypes: readonly string[];
  };
  readonly finalizers: readonly {
    readonly name: string;
    readonly handlerSource: string;
    readonly handlerDependencies?: ApplicationHandlerDependencies;
    readonly handlerLocation?: SourceLocation;
    readonly handlerUnresolved?: readonly string[];
    readonly conditionTypes: readonly string[];
  }[];
  readonly portability: 'portable' | 'kubernetesConstrained';
  readonly activation: 'migrationRequiredForExistingRows' | 'providerNative';
}

export interface ApplicationNativeModelContract {
  readonly kind: 'drizzle-table' | 'kubernetes-resource' | 'jsonb-model';
  readonly authority:
    | 'postgres'
    | 'kubernetes'
    | 'transactional-database'
    | 'analytical-database';
  readonly artifact: {
    readonly name: string;
    readonly schema?: string;
    readonly database?: string;
    readonly migrations?: { readonly path: string; readonly digest?: string };
  };
  readonly schemaAuthority: 'drizzle' | 'arktype';
  readonly runtimeSchema: 'derived-arktype' | 'declared-arktype';
  readonly nativeApi: 'preserved';
}

export interface ApplicationCommonModelContract {
  readonly identity: {
    readonly fields: readonly string[];
    readonly encoding: 'scalar';
  };
  readonly revision?: {
    readonly field: string;
    readonly authority: 'postgres-row' | 'kubernetes-resource-version' | 'transactional-database';
  };
  readonly snapshot: {
    readonly shape: 'identity-value-revision';
    readonly revisionOptional: true;
  };
  readonly changes: {
    readonly authority:
      | 'postgres-change-log'
      | 'kubernetes-watch'
      | 'transactional-database-outbox'
      | 'analytical-checkpoint';
    readonly rawWrites: 'explicit-invalidation-required' | 'observed';
  };
  readonly relationships: readonly ApplicationModelRelationshipGraphContract[];
  /** Explicit maintained-module/runtime capabilities; never inferred from table names. */
  readonly runtimeRoles?: readonly string[];
  readonly operations?: readonly ApplicationModelOperationGraphContract[];
  readonly access?: {
    readonly context: string;
    readonly enforcement: 'postgres-rls' | 'kubernetes-namespace-label';
    readonly providerField: string;
  };
}

export interface ApplicationModelOperationGraphContract {
  readonly name: string;
  readonly operation: 'create' | 'get' | 'query' | 'update' | 'delete' | 'custom';
  readonly transport: 'command' | 'query' | 'runtime';
  readonly publicId: string;
  readonly input?: ApplicationMessageContractSchema;
  readonly output?: ApplicationMessageContractSchema;
  readonly authorization: 'application-defined' | 'provider-enforced' | 'undeclared';
  readonly authority?: ApplicationOperationAuthorityGraphContract;
}

export interface ApplicationOperationAuthorityGraphContract {
  readonly classification: 'unclassified' | 'public' | 'assigned' | 'runtime-grantable' | 'application-policy';
  readonly permissionIds: readonly string[];
  readonly grantable: boolean;
  readonly delegable: boolean;
  readonly scope: ApplicationScopeExpression;
  readonly audiences?: readonly string[];
  readonly transports?: readonly ApplicationOperationTransport[];
  readonly lifetime?: {
    readonly expiresIn?: string;
    readonly maximumUses?: number;
    readonly outcomeId?: string;
  };
}

export interface ApplicationModelRelationshipGraphContract {
  readonly source: string;
  readonly name: string;
  readonly target: string;
  readonly cardinality: 'one' | 'many';
  readonly integrity: 'foreign-key' | 'relation-only' | 'soft' | 'reconcile-checked';
  readonly fields: readonly string[];
  readonly references: readonly string[];
}

export interface ApplicationServerNode extends ApplicationGraphNodeBase<'server'> {
  readonly routes: readonly ApplicationRouteContract[];
  readonly deployment?: {
    readonly namespace?: string;
    readonly replicas: number;
    readonly port: number;
    readonly maxRequestBodyBytes: number;
    readonly mutationRateLimit: {
      readonly maxRequests: number;
      readonly windowSeconds: number;
    };
  };
  readonly resources: readonly ApplicationResourceRef[];
  readonly indexes: readonly ApplicationGraphNodeRef[];
  readonly exposure?: ApplicationProviderRef<'HttpExposure'>;
  readonly observability: ApplicationObservabilityContract;
  readonly generatedResources?: readonly ApplicationGeneratedResourceContract[];
}

export interface ApplicationOperatorNode extends ApplicationGraphNodeBase<'operator'> {
  readonly resources: readonly ApplicationResourceRef[];
  readonly watches: readonly ApplicationWatchScope[];
  readonly watchContracts?: readonly ApplicationWatchScopeLoweringContract[];
}

export interface ApplicationIndexNode extends ApplicationGraphNodeBase<'index'> {
  readonly source: ApplicationResourceRef | ApplicationGraphNodeRef;
  readonly provider: ApplicationProviderRef<'IndexStore' | 'Search'>;
  /**
   * Resource indexes retain their bounded partition/order lookup semantics.
   * Search indexes carry a complete provider-neutral projection plan.
   */
  readonly purpose?: 'resourceLookup' | 'searchProjection';
  readonly partitionBy?: ApplicationExpressionContract;
  readonly filter?: ApplicationExpressionContract;
  readonly orderBy?: ApplicationExpressionContract;
  readonly search?: ApplicationSearchIndexPlan;
  readonly generatedResources?: readonly ApplicationGeneratedResourceContract[];
}

export type ApplicationSearchFieldKind =
  | 'text'
  | 'facet'
  | 'filter'
  | 'values'
  | 'minimum'
  | 'maximum'
  | 'count';

export interface ApplicationSearchFieldPathSegment {
  readonly model: string;
  readonly field: string;
  readonly relationship?: string;
  readonly target?: string;
  readonly cardinality: 'one' | 'many';
  readonly integrity?:
    | 'foreign-key'
    | 'relation-only'
    | 'soft'
    | 'reconcile-checked';
}

export interface ApplicationSearchFieldPlan {
  readonly alias: string;
  readonly kind: ApplicationSearchFieldKind;
  readonly valueType:
    | 'string'
    | 'number'
    | 'boolean'
    | 'date'
    | 'json'
    | 'unknown';
  readonly nullable: boolean;
  readonly path: readonly ApplicationSearchFieldPathSegment[];
  readonly boost?: number;
  readonly authorizationRelevant: boolean;
}

export interface ApplicationSearchInverseInvalidationPlan {
  readonly sourceModel: string;
  readonly affectedRoot: string;
  readonly relationships: readonly string[];
  readonly lookup: 'rootIdentity' | 'foreignKey' | 'declaredInverse';
  readonly fanOutCeiling: number;
  readonly overflow: 'partitionedRepair' | 'rebuildRequired';
}

export interface ApplicationSearchSourceFrontier {
  readonly model: string;
  readonly authority:
    | 'postgres-change-log'
    | 'kubernetes-watch'
    | 'transactional-database-outbox'
    | 'analytical-checkpoint';
  readonly consistency:
    | 'transactionalSnapshot'
    | 'observedResourceVersion'
    | 'checkpoint'
    | 'frontierValidated';
}

export interface ApplicationSearchIndexRevision {
  readonly digest: string;
  readonly rootModelRevision: string;
  readonly documentSchemaRevision: string;
  readonly fieldPlanRevision: string;
  readonly invalidationPlanRevision: string;
  readonly authorizationPlanRevision: string;
}

export interface ApplicationSearchIndexPlan {
  readonly apiVersion: 'applik8s.searchIndex/v1alpha1';
  readonly logicalIdentity: {
    readonly application: string;
    readonly name: string;
  };
  readonly root: {
    readonly model: ApplicationGraphNodeRef;
    readonly identity: readonly string[];
    readonly encoding: 'scalar';
  };
  readonly revision: ApplicationSearchIndexRevision;
  readonly fields: readonly ApplicationSearchFieldPlan[];
  readonly sourceFrontiers: readonly ApplicationSearchSourceFrontier[];
  readonly inverseInvalidation: readonly ApplicationSearchInverseInvalidationPlan[];
  readonly synchronization: {
    readonly source: 'committedChanges';
    readonly writes: 'wholeDocumentReplaceDelete';
    readonly idempotency: 'committedChangeIdentity';
    readonly historyLoss: 'rebuildRequired';
    readonly checkpoint: 'contiguousCommittedFrontier';
  };
  readonly rebuild: {
    readonly snapshot: 'boundedAuthoritativeScan';
    readonly catchup: 'retainedCommittedChanges';
    readonly validation: readonly [
      'count',
      'schema',
      'sample',
      'checksum',
      'authorization',
    ];
    readonly cutover: 'atomicAlias';
  };
  readonly authorization: {
    readonly mandatoryFilters: 'trustedAdmissionScope';
    readonly composition: 'monotonicIntersection';
    readonly pagePostFiltering: 'forbidden';
  };
  readonly physicalGeneration: {
    readonly naming: 'logical-name-revision-generation';
    readonly cutover: 'atomicAlias';
    readonly cursorBinding: 'exactGeneration';
    readonly retirement: 'observedReadersThenExplicitDelete';
  };
  readonly requiredCapabilities: readonly string[];
  /** Readiness policy for this exact search projection binding. */
  readonly readiness: {
    readonly failurePolicy: 'block' | 'degrade';
  };
  readonly searchOperation: ApplicationGraphNodeRef;
}

export interface ApplicationAggregateNode extends ApplicationGraphNodeBase<'aggregate'> {
  readonly source: ApplicationGraphNodeRef;
  readonly target: ApplicationStatusTargetRef;
  readonly flush: ApplicationFlushPolicy;
  readonly generatedResources?: readonly ApplicationGeneratedResourceContract[];
}

export interface ApplicationCounterNode extends ApplicationGraphNodeBase<'counter'> {
  readonly target: ApplicationResourceRef | ApplicationGraphNodeRef;
  readonly provider?: ApplicationProviderRef<'CounterStore'>;
  readonly flush: ApplicationFlushPolicy;
  readonly generatedResources?: readonly ApplicationGeneratedResourceContract[];
}

export interface ApplicationMessageContractSchema {
  readonly kind: 'declared';
  readonly runtime: 'arktype';
  readonly jsonSchema: JsonObject;
}

export interface ApplicationCommandNode extends ApplicationGraphNodeBase<'command'> {
  readonly contract: {
    readonly name: string;
    readonly version: string;
    readonly input: ApplicationMessageContractSchema;
    readonly output: ApplicationMessageContractSchema;
    readonly errors: readonly { readonly name: string; readonly schema: ApplicationMessageContractSchema }[];
  };
}

export interface ApplicationEventNode extends ApplicationGraphNodeBase<'event'> {
  readonly contract: {
    readonly name: string;
    readonly version: string;
    readonly payload: ApplicationMessageContractSchema;
  };
}

export interface ApplicationCommandHandlerNode extends ApplicationGraphNodeBase<'commandHandler'> {
  readonly model: ApplicationGraphNodeRef;
  readonly command: ApplicationGraphNodeRef;
  readonly key: ApplicationExpressionContract;
  readonly ordering: 'serial' | 'concurrent';
  readonly idempotencyKey?: ApplicationExpressionContract;
  readonly missing: 'reject' | 'initialize' | 'route';
  readonly missingRoute?: string;
  readonly transaction: {
    readonly models: readonly ApplicationGraphNodeRef[];
    readonly modelBindings?: readonly {
      readonly identifier: string;
      readonly model: ApplicationGraphNodeRef;
    }[];
    /** The owning model was explicitly declared for related-row reads. */
    readonly selfRead?: boolean;
    readonly history: readonly ApplicationGraphNodeRef[];
    readonly outbox: readonly ApplicationGraphNodeRef[];
    readonly commands?: readonly ApplicationGraphNodeRef[];
  };
  readonly retry: ApplicationRetryPolicy;
  readonly retention: ApplicationCommandRetentionContract;
  readonly effectBoundary: 'transactionSafeOnly';
  readonly effectEnforcement: ApplicationCommandEffectEnforcementContract;
  readonly handlerSource: string;
  /** Authored transactional policy invoked by a compiler-generated native mutation handler. */
  readonly beforeCommit?: ApplicationSerializedCallbackContract;
  readonly initializeSource?: string;
  /**
   * Framework-owned committed fact for a custom model mutation. The runtime
   * emits it exactly once after the handler and authorization revalidation
   * succeed; application handlers never stage it manually.
   */
  readonly completionEvent?: ApplicationGraphNodeRef;
  readonly eventBindings?: readonly { readonly identifier: string; readonly event: ApplicationGraphNodeRef }[];
  readonly commandBindings?: readonly { readonly identifier: string; readonly command: ApplicationGraphNodeRef }[];
  readonly projectionReadiness: ApplicationCommandProjectionReadinessContract;
}

export interface ApplicationCommandEffectEnforcementContract {
  readonly sourceAnalysis: 'closedStructuralAllowlist';
  readonly runtimeMembrane: 'asyncContextAmbientIo';
  readonly externalEffects: 'outboxOrTaskOnly';
}

export interface ApplicationCommandProjectionReadinessContract {
  readonly submissionAcknowledgement: 'transportOnly';
  readonly durableResultAuthority: 'postgresCommandResults';
  readonly duplicateRecovery: 'idempotentRedelivery';
  readonly correlation: 'commandCorrelationCausation';
  readonly resultRevisionAuthority: 'postgresCommandResults';
  readonly stateRevisionAuthority: 'modelRevision';
  readonly reconciliationLink: 'modelRevisionWhenPresent';
}

export interface ApplicationCommandRetentionContract {
  readonly replayWindowSeconds: number;
  readonly auditWindowSeconds: number;
  readonly publishedOutboxWindowSeconds: number;
  readonly cleanupIntervalSeconds: number;
  readonly cleanupBatchSize: number;
}

export interface ApplicationProcessorNode extends ApplicationGraphNodeBase<'processor'> {
  readonly handlers: readonly ApplicationGraphNodeRef[];
  readonly runtime: 'node';
  readonly runtimeImage?: string;
  readonly deployment: ApplicationProcessorDeploymentContract;
  readonly inference: 'generated';
  readonly lifecycle: 'longLived';
  readonly eventLog?: ApplicationProviderRef<'EventLog'>;
  readonly generatedResources?: readonly ApplicationGeneratedResourceContract[];
}

export interface ApplicationProcessorDeploymentContract {
  /** Manually selected processor replicas. Automatic lag-based scaling remains outside v0.4.1. */
  readonly replicas: number | `\${${string}}`;
  /** Maximum concurrently executing messages in each processor pod. */
  readonly concurrency: number | `\${${string}}`;
  /** Durable-consumer delivery window shared by all replicas. */
  readonly maxAckPending: number | `\${${string}}`;
  readonly resources: {
    readonly requests: { readonly cpu: string | `\${${string}}`; readonly memory: string | `\${${string}}` };
    readonly limits: { readonly cpu: string | `\${${string}}`; readonly memory: string | `\${${string}}` };
  };
  readonly disruption: { readonly maxUnavailable: number | `\${${string}}` } | { readonly minAvailable: number } | { readonly disabled: true };
  readonly nodeSelector?: Readonly<Record<string, string>>;
}

export interface ApplicationTaskNode extends ApplicationGraphNodeBase<'task'> {
  readonly contract: {
    readonly name: string;
    readonly version: string;
    readonly input: ApplicationMessageContractSchema;
    readonly output: ApplicationMessageContractSchema;
    readonly errors: readonly { readonly name: string; readonly schema: ApplicationMessageContractSchema }[];
  };
}

/** Server-side object operations that a durable task may receive explicitly. */
export type ApplicationTaskObjectOperation = 'put' | 'get' | 'head' | 'delete';

export interface ApplicationTaskHandlerNode extends ApplicationGraphNodeBase<'taskHandler'> {
  readonly task: ApplicationGraphNodeRef;
  readonly workflowEngine: ApplicationProviderRef<'WorkflowEngine'>;
  /** Optional logical service identity whose static grants form the workload baseline. */
  readonly serviceIdentity?: ApplicationIdentityReference;
  /** Runtime capabilities explicitly injected into this external-effect task. */
  readonly capabilities?: readonly ApplicationProviderRef[];
  /** Durable child workflows captured directly by the task closure. */
  readonly childWorkflowBindings?: readonly {
    readonly alias: string;
    readonly workflow: ApplicationGraphNodeRef;
  }[];
  /** Function-native provider operations captured directly by the task closure. */
  readonly providerBindings?: readonly ApplicationCallableProviderBinding[];
  /**
   * Durable model mutations explicitly injected into this task. The generated
   * worker may submit only these command bindings; all execution still passes
   * through the canonical command processor and PostgreSQL transaction.
   */
  readonly operations?: readonly {
    readonly alias: string;
    readonly command: ApplicationGraphNodeRef;
    readonly handler: ApplicationGraphNodeRef;
    /** Canonical least-privilege operation dependency for this workload. */
    readonly authority: ApplicationOperationInvocationDependency;
  }[];
  /** Authenticated bounded queries explicitly injected into this task. */
  readonly queries?: readonly {
    readonly alias: string;
    readonly query: ApplicationGraphNodeRef;
  }[];
  /** Generation-scoped online projections this task may rebuild or retire. */
  readonly projections?: readonly {
    readonly alias: string;
    readonly projection: ApplicationGraphNodeRef;
    readonly artifacts: ApplicationGraphNodeRef;
    readonly bounds: {
      readonly batchSize: number;
      readonly maxSegments: number;
      readonly maxSegmentBytes: number;
      readonly maxEvents: number;
      readonly maxCatchUpRounds: number;
    };
  }[];
	/** Bounded object stores explicitly injected into this task. */
	readonly objects?: readonly {
		readonly alias: string;
		readonly store: ApplicationGraphNodeRef;
		/** Exact least-authority method surface projected into this task. */
		readonly operations: readonly ApplicationTaskObjectOperation[];
		/** Optional workload-specific credential selected at the task boundary. */
		readonly credentialsSecret?: ApplicationResourceRef;
	}[];
  /** Exact actor protocol members captured by this durable effect closure. */
  readonly actors?: readonly {
    readonly alias: string;
    readonly actor: ApplicationGraphNodeRef;
    readonly member: string;
    readonly memberKind: 'command' | 'message' | 'alarm';
  }[];
  /** Compiler-owned provider-call/cost journal handles. */
  readonly providerAccounting?: readonly {
    readonly alias: string;
    readonly name: string;
    readonly callModel: ApplicationGraphNodeRef;
    readonly costModel: ApplicationGraphNodeRef;
  }[];
  /** Function-native signal contracts captured by this durable task closure. */
  readonly signalBindings?: readonly {
    readonly alias: string;
    readonly id: string;
    readonly name: string;
    readonly version: string;
    readonly input: ApplicationMessageContractSchema;
    readonly actions: readonly {
      readonly name: string;
      readonly schema: ApplicationMessageContractSchema;
    }[];
  }[];
  /**
   * Ordinary Model.edit/require calls lowered into the task invocation's
   * durable command transaction. This is compiler-owned metadata, not an
   * application-facing dependency declaration.
   */
  readonly functionNativeTransaction?: ApplicationFunctionNativeTransactionContract;
  /** Compiler-captured service-principal derivation for declared effects. */
  readonly operationPrincipalSource?: string;
  readonly operationPrincipalDependencies?: ApplicationHandlerDependencies;
  readonly operationPrincipalLocation?: SourceLocation;
  readonly operationPrincipalUnresolved?: readonly string[];
  readonly retry: ApplicationRetryPolicy;
  readonly executionTimeoutSeconds: number;
  readonly scheduleTimeoutSeconds: number;
  readonly idempotency: {
    readonly required: true;
    readonly keySource: 'invocation' | 'inputExpression';
    readonly expression?: ApplicationExpressionContract;
    readonly guarantee: 'atLeastOnceRetrySafe';
  };
  readonly effectBoundary: 'externalEffectsAllowed';
  readonly handlerSource: string;
  readonly handlerDependencies?: { readonly source: string; readonly resolveDir: string };
  readonly sourceLocation?: SourceLocation;
}

export interface ApplicationWorkflowNode extends ApplicationGraphNodeBase<'workflow'> {
  readonly contract: {
    readonly name: string;
    readonly version: string;
    readonly input: ApplicationMessageContractSchema;
    readonly output: ApplicationMessageContractSchema;
    readonly errors: readonly { readonly name: string; readonly schema: ApplicationMessageContractSchema }[];
    readonly signals: readonly { readonly name: string; readonly schema: ApplicationMessageContractSchema }[];
  };
  readonly triggers: {
    readonly crons: readonly { readonly name: string; readonly expression: string; readonly input: JsonObject }[];
  };
}

export interface ApplicationWorkflowHandlerNode extends ApplicationGraphNodeBase<'workflowHandler'> {
  readonly workflow: ApplicationGraphNodeRef;
  readonly workflowEngine: ApplicationProviderRef<'WorkflowEngine'>;
  readonly tasks: readonly ApplicationGraphNodeRef[];
  readonly childWorkflows: readonly ApplicationGraphNodeRef[];
  readonly taskBindings: readonly { readonly alias: string; readonly task: ApplicationGraphNodeRef }[];
  readonly childWorkflowBindings: readonly { readonly alias: string; readonly workflow: ApplicationGraphNodeRef }[];
  readonly signalBindings?: readonly {
    readonly alias: string;
    readonly id: string;
    readonly name: string;
    readonly version: string;
    readonly input: ApplicationMessageContractSchema;
    readonly actions: readonly {
      readonly name: string;
      readonly schema: ApplicationMessageContractSchema;
    }[];
  }[];
  readonly handlerSource: string;
  readonly handlerDependencies?: { readonly source: string; readonly resolveDir: string };
  readonly sourceLocation?: SourceLocation;
  readonly orchestrationBoundary: 'durableEffectsThroughTasks';
  readonly deterministicOperations: readonly ('task' | 'childWorkflow' | 'sleep' | 'externalEvent' | 'now' | 'cancellation')[];
  readonly sourceAnalysis: 'closedWorkflowAllowlist';
}

export interface ApplicationSagaNode extends ApplicationGraphNodeBase<'saga'> {
  readonly contract: {
    readonly name: string;
    readonly version: string;
    readonly input: ApplicationMessageContractSchema;
    readonly output: ApplicationMessageContractSchema;
  };
  readonly workflowEngine: ApplicationProviderRef<'WorkflowEngine'>;
  readonly handlerSource: string;
  readonly handlerDependencies?: ApplicationHandlerDependencies;
  readonly sourceLocation?: SourceLocation;
  readonly steps: readonly {
    readonly id: string;
    readonly kind: 'step' | 'commit' | 'irreversible';
    readonly order: number;
    readonly compensation: 'required' | 'forbidden';
    readonly reason?: string;
  }[];
  readonly deadlineSeconds: number;
  readonly recoveryDeadlineSeconds: number;
  readonly cancellation: 'recoverThenCompensate';
  readonly atomicity: 'compensatingNoIsolation';
  readonly maturity: 'beta';
}

/** Provider-neutral predictive model contract. This surface is beta in v0.9. */
export interface ApplicationMLModelNode extends ApplicationGraphNodeBase<'mlModel'> {
  readonly contract: {
    readonly name: string;
    readonly version: string;
    readonly input: ApplicationMessageContractSchema;
    readonly output: ApplicationMessageContractSchema;
  };
  readonly capabilities: readonly ('predict' | 'batchPrediction')[];
  readonly inference: ApplicationProviderRef;
  readonly requirements: {
    readonly deterministic?: boolean;
    readonly locality?: 'local' | 'cluster' | 'remote';
    readonly dataResidency?: readonly string[];
    readonly maximumBatchSize?: number;
    readonly timeoutMs?: number;
  };
  readonly provenance: {
    readonly artifactIdentity: 'contentAddressed';
    readonly receipt: 'required';
    readonly sensitiveValues: 'redacted';
  };
  readonly maturity: 'beta';
}

export interface ApplicationWorkflowWorkerNode extends ApplicationGraphNodeBase<'workflowWorker'> {
  readonly handlers: readonly ApplicationGraphNodeRef[];
  readonly workflowEngine: ApplicationProviderRef<'WorkflowEngine'>;
  readonly runtime: 'node';
  readonly lifecycle: 'longLived';
  readonly deployment: {
    /** Concrete in direct graphs, or a serialized installation-derived KRO expression. */
    readonly replicas: ApplicationGraphNumberValue;
    readonly taskSlots: number;
    readonly durableSlots: number;
    readonly gracefulShutdownSeconds: number;
    readonly healthPort: number;
    /** Network egress posture for external-effect tasks. */
    readonly egress: 'allowAll' | 'sameNamespace';
    readonly scaling: { readonly mode: 'fixed' } | { readonly mode: 'kedaHatchetSlots'; readonly minReplicas: number; readonly maxReplicas: number; readonly pollingIntervalSeconds: number };
  };
  readonly generatedResources?: readonly ApplicationGeneratedResourceContract[];
}

export type ApplicationScheduleOverlapPolicy = 'allow' | 'skip';
export type ApplicationScheduleMisfirePolicy = 'skip' | 'latest' | 'all-bounded';

/**
 * Provider-neutral definition of one function-native scheduled closure.
 * Provider schedule identities and target resources are derived from this
 * semantic node and never become part of the application-facing API.
 */
export interface ApplicationScheduleNode extends ApplicationGraphNodeBase<'schedule'> {
  readonly definition: {
    readonly id: string;
    readonly configuration: 'fixed' | 'dynamic';
    readonly input?: ApplicationMessageContractSchema;
    readonly cron?: string;
    readonly every?: string;
    readonly at?: string;
    readonly timezone: string;
    readonly overlap: ApplicationScheduleOverlapPolicy;
    readonly overlapBy?: ApplicationSerializedCallbackContract;
    readonly misfires: ApplicationScheduleMisfirePolicy;
    readonly maximumLatenessSeconds: number;
    readonly maximumCatchUp?: number;
    readonly retry: {
      readonly maxAttempts: number;
      readonly maximumAgeSeconds: number;
    };
    readonly requirements: {
      readonly configuration: 'fixed' | 'dynamic';
      readonly cardinality: 'bounded' | 'high';
      readonly precision: 'minute' | 'second';
    };
  };
  readonly scheduler: ApplicationProviderRef<'Scheduler'>;
  /** Canonical desired-state, management-receipt, and occurrence authority. */
  readonly state: ApplicationProviderRef<'TransactionalDatabase'>;
  /** Function-native provider operations captured directly by the scheduled closure. */
  readonly providerBindings?: readonly ApplicationCallableProviderBinding[];
  /**
   * Ordinary function-native schedule execution. Exactly one of `handler` or
   * `target` is present. Targeted schedules deliberately keep the downstream
   * execution family's identity and durability outside Scheduler ownership.
   */
  readonly handler?: ApplicationSerializedCallbackContract;
  /** Compiler-owned lowering for a schedule occurrence that admits a typed execution run. */
  readonly target?: {
    readonly kind: 'durableStart';
    readonly durable: ApplicationGraphNodeRef & { readonly kind: 'workflow' | 'task' | 'job' };
    readonly contract: {
      readonly name: string;
      readonly version: string;
      readonly input: ApplicationMessageContractSchema;
    };
    readonly input:
      | { readonly kind: 'literal'; readonly value: JsonObject }
      | { readonly kind: 'scheduleInput' };
  };
  readonly functionNative: true;
}

/** One event-to-immutable-snapshot publication derived from ordinary typed application code. */
export interface ApplicationLakehousePublicationNode extends ApplicationGraphNodeBase<'lakehousePublication'> {
  readonly sourceEventId: string;
  readonly sourceContract: {
    readonly name: string;
    readonly version: string;
  };
  /** Runtime source contract used by generated publishers to re-admit event payloads. */
  readonly source: ApplicationMessageContractSchema;
  /**
   * Event-log authority selected when the exported publication is attached to
   * an application graph. Author-time publication handles intentionally omit
   * this framework-owned binding; executable graphs must contain it.
   */
  readonly eventLog?: ApplicationProviderRef<'EventLog'>;
  readonly dataset: ApplicationProviderRef<'LakehouseDataset'>;
  readonly row: ApplicationMessageContractSchema;
  readonly transform: ApplicationSerializedCallbackContract;
  readonly partition?: ApplicationSerializedCallbackContract;
  readonly semantics: {
    readonly publication: 'atomicManifest';
    readonly frontier: 'sourceEvent';
    readonly schemaEvolution: 'explicitRevision';
  };
}

export type ApplicationActorProtocolKind =
  | 'command'
  | 'message'
  | 'connectionMessage'
  | 'connection'
  | 'disconnection'
  | 'broadcast'
  | 'alarm';

export interface ApplicationActorCapabilityRequirements {
  readonly durableState: true;
  readonly serializedTurns: true;
  readonly transactionalOutbox: boolean;
  readonly durableAlarms: boolean;
  readonly realtimeConnections: boolean;
  readonly connectionLeases: boolean;
  readonly realtimeMessages: boolean;
  readonly realtimeBroadcast: boolean;
}

/** Provider-neutral actor declaration; provider placement never enters application source. */
export interface ApplicationActorNode extends ApplicationGraphNodeBase<'actor'> {
  readonly definition: {
    readonly id: string;
    readonly key: ApplicationMessageContractSchema;
    readonly state: ApplicationMessageContractSchema;
    readonly stateVersion: number;
    readonly migrationDigest: string;
    readonly migrations: readonly {
      readonly from: number;
      readonly callback: ApplicationSerializedCallbackContract;
    }[];
    readonly protocol: readonly {
      readonly name: string;
      readonly kind: ApplicationActorProtocolKind;
      readonly input?: ApplicationMessageContractSchema;
      readonly output?: ApplicationMessageContractSchema;
      readonly authority?: ApplicationOperationAuthorityGraphContract;
    }[];
    readonly requirements: ApplicationActorCapabilityRequirements;
  };
  readonly runtime: ApplicationProviderRef<'ActorRuntime'>;
  /** Function-native provider operations captured by actor turn handlers. */
  readonly providerBindings?: readonly ApplicationCallableProviderBinding[];
  /** Exact actor operations captured by each serialized actor turn handler. */
  readonly actorBindings?: readonly {
    readonly handler: string;
    readonly alias: string;
    readonly actor: ApplicationGraphNodeRef;
    readonly member: string;
    readonly memberKind: 'command' | 'message' | 'alarm';
  }[];
  readonly handlers: readonly {
    readonly member: string;
    readonly callback: ApplicationSerializedCallbackContract;
  }[];
  readonly initialize?: ApplicationSerializedCallbackContract;
  readonly semantics: {
    readonly serialization: 'fullTurnPerIdentity';
    readonly admission: 'idempotentReceipt';
    readonly references: 'inertAddress';
  };
  /** Explicit entrypoint export boundary; absent actors remain server-only. */
  readonly publication?: {
    readonly boundary: 'entrypoint-export';
  };
}

/**
 * Portable execution plan for one server-side AI agent. Framework-specific
 * adapter objects are resolved at runtime and never serialized into the graph.
 */
export interface ApplicationAIAgentNode extends ApplicationGraphNodeBase<'aiAgent'> {
  readonly serviceIdentity: ApplicationIdentityReference;
  /** Optional application-owned trusted context used for durable conversation and usage scope. */
  readonly scope?: {
    readonly kind: 'trustedContext';
    readonly name: string;
  };
  readonly model: {
    readonly apiVersion: 'applik8s.aiModel/v1alpha1';
    readonly name: string;
    readonly capabilities: readonly string[];
    readonly constraints: {
      readonly dataResidency?: readonly string[];
      readonly complianceTags?: readonly string[];
      readonly maximumInputCostPerMillion?: number;
      readonly maximumOutputCostPerMillion?: number;
      readonly minimumContextTokens?: number;
      readonly minimumOutputTokens?: number;
      readonly latencyClass?: 'interactive' | 'standard' | 'batch';
      readonly availabilityClass?: 'standard' | 'high';
      readonly allowedProviderClasses?: readonly string[];
    };
    readonly inference?: {
      readonly qualification: {
        readonly apiVersion: 'applik8s.providerQualification/v1alpha1';
        readonly capability: string;
        readonly name: string;
        readonly compatibilityRevision: string;
        readonly key: string;
      };
    };
  };
  readonly inference: ApplicationProviderRef<'AI'>;
  /** Durable authority for conversations, invocations, attempts, and usage. */
  readonly state: ApplicationProviderRef<'TransactionalDatabase'>;
  /** Function-native provider operations captured by the agent execution closure. */
  readonly providerBindings?: readonly ApplicationCallableProviderBinding[];
  readonly instructions:
    | { readonly kind: 'static'; readonly value: string }
    | {
        readonly kind: 'closure';
        readonly source: string;
        readonly dependencies?: ApplicationHandlerDependencies;
        readonly location?: SourceLocation;
        readonly unresolved?: readonly string[];
      };
  readonly tools: readonly {
    readonly operationId: ApplicationOperationId;
    readonly operationVersion: string;
    readonly transport: 'command' | 'query' | 'runtime';
    readonly graphNode?: ApplicationGraphNodeRef;
    /**
     * Compiler-owned implementation for an ordinary exported function
     * deliberately exposed at this agent boundary. Applications still author
     * only the function and its typed signature.
     */
    readonly local?: {
      readonly name: string;
      readonly input: ApplicationMessageContractSchema;
      readonly output: ApplicationMessageContractSchema;
      readonly handlerSource: string;
      readonly handlerDependencies?: ApplicationHandlerDependencies;
      readonly sourceLocation?: SourceLocation;
      readonly functionNativeTransaction: ApplicationFunctionNativeTransactionContract;
    };
    readonly authority: ApplicationOperationAuthorityGraphContract;
  }[];
  /**
   * Function-native mutation handles called by the agent execution closure.
   * These are compiler-captured dependencies, not model-visible tools.
   */
  readonly operations?: readonly {
    readonly alias: string;
    /** Identity carried by the authored callable at execution time. */
    readonly authoringOperationId: string;
    /** Canonical catalog identity used for authority and placement. */
    readonly operationId: ApplicationOperationId;
    readonly command: ApplicationGraphNodeRef;
    readonly handler: ApplicationGraphNodeRef;
  }[];
  /**
   * Function-native queries called by the agent execution closure itself.
   * These are compiler-captured dependencies, not model-visible tools: the
   * generated agent injects bounded authenticated query clients without
   * importing or replaying the application authoring graph at runtime.
   */
  readonly queries?: readonly {
    readonly alias: string;
    readonly query: ApplicationGraphNodeRef;
  }[];
  /** Exact actor protocol members captured by the agent execution closure. */
  readonly actors?: readonly {
    readonly alias: string;
    readonly actor: ApplicationGraphNodeRef;
    readonly member: string;
    readonly memberKind: 'command' | 'message' | 'alarm';
  }[];
  readonly responseSchemaDigest?: string;
  readonly budgets: {
    readonly maximumInputTokens?: number;
    readonly maximumOutputTokens?: number;
    readonly maximumCostMicrounits?: number;
    readonly timeoutMs: number;
  };
  readonly executionPolicy: {
    readonly callerDelegation: 'forbidden' | 'declared';
    readonly uncertainCompletion: 'escalate' | 'retry-if-replay-safe';
  };
  readonly compatibility: {
    readonly apiVersion: 'applik8s.aiCompatibility/v1alpha1';
    readonly tanstackAI: string;
    readonly tanstackAIClient: string;
    readonly tanstackAIReact: string;
    readonly tanstackAIPersistence: string | 'unreleased';
    readonly agUi: string;
    readonly applik8sAdapter: string;
  };
  readonly handlerSource: string;
  readonly handlerDependencies?: ApplicationHandlerDependencies;
  readonly sourceLocation?: SourceLocation;
  readonly runtime: 'node';
  readonly lifecycle: 'longLived';
  readonly deployment: {
    readonly replicas: ApplicationGraphNumberValue;
    readonly port: number;
    readonly healthPort: number;
    readonly gracefulShutdownSeconds: number;
    readonly maximumConcurrency: number;
  };
  readonly generatedResources?: readonly ApplicationGeneratedResourceContract[];
}

export interface ApplicationMcpToolExposureContract {
  readonly publicName: string;
  readonly operationId: ApplicationOperationId;
  readonly schemaRevision: 'operation';
  readonly statelessName?: string;
}

export interface ApplicationMcpServerNode
  extends ApplicationGraphNodeBase<'mcpServer'> {
  readonly protocol: {
    readonly preferred: '2025-11-25';
    readonly supported: readonly ['2025-11-25'];
    readonly sdk: '@modelcontextprotocol/sdk@1.30.0';
    readonly extensions: readonly [
      'io.modelcontextprotocol/oauth-client-credentials/v1',
    ];
  };
  readonly path: string;
  readonly resource?: string;
  readonly audience?: string;
  readonly authorizationServers: readonly string[];
  readonly scopes: readonly string[];
  readonly tools: readonly ApplicationMcpToolExposureContract[];
  readonly sessions: {
    readonly mode: 'stateful-pinned';
    readonly catalog: 'operation-catalog-revision';
    readonly authorization: 'revalidate-every-call';
    readonly compatibleBindings: 'drain';
    readonly incompatibleBindings: 'reinitialize';
    readonly lifetimeMs: number;
  };
  readonly transport: {
    readonly kind: 'streamable-http';
    readonly protectedResourceMetadata: true;
    readonly tokenPassthrough: 'forbidden';
    readonly maximumRequestBytes: number;
    readonly maximumResponseBytes: number;
  };
}

export interface ApplicationMcpExternalToolContract {
  readonly name: string;
  readonly schemaRevision?: string;
  readonly contentClassification: 'untrusted-external';
}

export interface ApplicationMcpClientNode
  extends ApplicationGraphNodeBase<'mcpClient'> {
  readonly server: string;
  readonly audience: string;
  readonly resource: string;
  readonly protocol: {
    readonly preferred: '2025-11-25';
    readonly supported: readonly ['2025-11-25'];
    readonly clientCredentials:
      'io.modelcontextprotocol/oauth-client-credentials/v1';
  };
  readonly tools: readonly ApplicationMcpExternalToolContract[];
  readonly credentials: ApplicationGraphNodeRef;
  readonly egress: {
    readonly timeoutMs: number;
    readonly concurrency: number;
    readonly maximumRequestBytes: number;
    readonly maximumResponseBytes: number;
    readonly tokenPassthrough: 'forbidden';
    readonly schemaChanges: 'quarantine';
  };
  readonly audit: {
    readonly arguments: 'digest';
    readonly result: 'digest';
    readonly causation: 'required';
  };
}

/** A graph number can remain installation-derived until TypeKro instance evaluation. */
export type ApplicationGraphNumberValue = number | `\${${string}}`;

export type ApplicationPortableQueryValueExpression =
  | { readonly kind: 'field'; readonly path: readonly string[] }
  | { readonly kind: 'input'; readonly path: readonly string[] }
  | { readonly kind: 'literal'; readonly value: JsonValue };

export type ApplicationPortableQueryPredicate =
  | {
      readonly kind: 'comparison';
      readonly operation: 'eq' | 'notEq' | 'lessThan' | 'lessThanOrEqual' | 'greaterThan' | 'greaterThanOrEqual';
      readonly left: ApplicationPortableQueryValueExpression;
      readonly right: ApplicationPortableQueryValueExpression;
    }
  | {
      readonly kind: 'membership';
      readonly operation: 'in';
      readonly value: ApplicationPortableQueryValueExpression;
      readonly candidates: ApplicationPortableQueryValueExpression;
    }
  | {
      readonly kind: 'logical';
      readonly operation: 'and' | 'or';
      readonly operands: readonly ApplicationPortableQueryPredicate[];
    };

export interface ApplicationPortableQuerySelectionContract {
  readonly protocol: 'applik8s.query-selection/v1alpha1';
  readonly sourceModel: ApplicationGraphNodeRef;
  readonly source: {
    readonly provider: 'postgres';
    readonly database: string;
    readonly table: string;
    readonly schema?: string;
    readonly columns: readonly {
      readonly property: string;
      readonly column: string;
      readonly logicalType?: string;
      readonly nullable: boolean;
    }[];
  };
  readonly predicate?: ApplicationPortableQueryPredicate;
  readonly order: readonly {
    readonly expression: ApplicationPortableQueryValueExpression;
    readonly direction: 'asc' | 'desc';
  }[];
  readonly identity: readonly ApplicationPortableQueryValueExpression[];
  readonly relationshipReads: readonly ApplicationGraphNodeRef[];
  readonly sourceAuthority: string;
  readonly digest: string;
}

export interface ApplicationQueryNode extends ApplicationGraphNodeBase<'query'> {
  readonly publicId?: string;
  readonly modelOperation?: {
    readonly model: ApplicationGraphNodeRef;
    readonly name: string;
    readonly kind: 'query' | 'view';
  };
  readonly version: string;
  readonly input: ApplicationMessageContractSchema;
  readonly output: ApplicationMessageContractSchema;
  readonly reads: readonly ApplicationQueryReadContract[];
  readonly authorization: 'application-defined';
  readonly authority?: ApplicationOperationAuthorityGraphContract;
  readonly trustedContext: readonly string[];
  /** Serializable admission schemas for every query context, independent of database RLS scope. */
  readonly trustedContextSchemas?: Readonly<Record<string, JsonObject>>;
  readonly budgets: {
    readonly timeoutMs: number;
    readonly maxResultBytes: number;
    readonly maxRows: number;
  };
  readonly snapshotResume: 'atomicSnapshotResume' | 'resumableInvalidation' | 'resetOnly' | 'unsupported';
  readonly incremental: 'invalidation-requery';
  readonly cursor: 'opaque-query-version-context-scoped';
  readonly database?: ApplicationReactiveDatabaseRuntimeContract;
  readonly kubernetes?: ApplicationKubernetesQueryAuthorityContract;
  readonly search?: {
    /** The named rebuildable projection whose logical identity the operation queries. */
    readonly index: ApplicationGraphNodeRef;
    /** Provider selection is retained independently from its physical generation. */
    readonly provider: ApplicationProviderRef<'Search'>;
  };
  readonly projection?: {
    readonly nodeId: string;
    readonly storage: 'online' | 'analytical';
  };
  /** Portable ordered selection shared by one-shot invocation and Query.onBatch. */
  readonly selection?: ApplicationPortableQuerySelectionContract;
  readonly authorizationSource: string;
  readonly authorizationDependencies?: ApplicationHandlerDependencies;
  readonly authorizationLocation?: SourceLocation;
  readonly authorizationUnresolved?: readonly string[];
  readonly handlerSource: string;
  /** Calling convention retained while the compatibility request envelope is lowered away. */
  readonly handlerInvocation?: 'request' | 'input-context';
  readonly handlerDependencies?: ApplicationHandlerDependencies;
  /** Exact actor protocol members reached by the function-native query callback. */
  readonly actorBindings?: readonly {
    readonly identifier: string;
    readonly actor: ApplicationGraphNodeRef;
    readonly member: string;
    readonly memberKind: 'command' | 'message' | 'alarm';
  }[];
  readonly handlerLocation?: SourceLocation;
  readonly handlerUnresolved?: readonly string[];
}

export interface ApplicationReactiveDatabaseRuntimeContract {
  readonly name: string;
  readonly connectionEnvName: string;
  readonly secretName: string;
  readonly secretKey: string;
  readonly secretNamespace?: string;
  readonly access?: {
    readonly context: string;
    readonly contextSchema: JsonObject;
    readonly setting: string;
    readonly column: string;
    /** Present in current graphs; omission in older graph artifacts means required. */
    readonly default?: 'required' | 'global';
  };
}

export interface ApplicationQueryReadContract {
  readonly model: ApplicationGraphNodeRef;
  readonly relationship?: string;
}

export interface ApplicationGatewayNode extends ApplicationGraphNodeBase<'gateway'> {
  /**
   * Public gateways are routed through the application host and emitted in
   * browser/server facades. Internal gateways are reachable only by generated
   * workload dependencies such as workflows and stream processors.
   */
  readonly visibility: 'public' | 'internal';
  readonly queries: readonly ApplicationGraphNodeRef[];
  readonly commands: readonly ApplicationGatewayCommandContract[];
  readonly subscriptions: readonly ApplicationGraphNodeRef[];
  readonly transport: 'http-sse';
  readonly authentication: 'external-provider';
  readonly trustedContextAdmission: 'server-validated';
  readonly browserCredentials: 'forbidden';
  readonly subscriptionLimits: { readonly perPrincipal: number; readonly total: number };
  readonly routes: { readonly snapshots: string; readonly subscriptions: string; readonly streamReplay: string; readonly streamSubscriptions: string; readonly commandSubmission: string; readonly commandProgress: string };
  readonly resume: 'resumableInvalidation';
  readonly materialization: 'runtimeOnly' | 'generatedDeployment';
  readonly authenticationSource?: string;
  readonly authenticationDependencies?: ApplicationHandlerDependencies;
  readonly authenticationLocation?: SourceLocation;
  readonly authenticationUnresolved?: readonly string[];
  readonly authenticationProfile?: ApplicationProfiledCallbackContract;
  readonly identityReadinessSource?: string;
  readonly identityReadinessDependencies?: ApplicationHandlerDependencies;
  readonly identityReadinessLocation?: SourceLocation;
  readonly identityReadinessUnresolved?: readonly string[];
  readonly identityReadinessProfile?: ApplicationProfiledCallbackContract;
  readonly authorizationReadinessSource?: string;
  readonly authorizationReadinessDependencies?: ApplicationHandlerDependencies;
  readonly authorizationReadinessLocation?: SourceLocation;
  readonly authorizationReadinessUnresolved?: readonly string[];
  readonly commandAuthorizationSource?: string;
  readonly commandAuthorizationDependencies?: ApplicationHandlerDependencies;
  readonly commandAuthorizationLocation?: SourceLocation;
  readonly commandAuthorizationUnresolved?: readonly string[];
  readonly cursorSecret?: ApplicationResourceRef & { readonly key: string };
  readonly deployment?: {
    readonly namespace: string;
    readonly image: string;
    readonly replicas: number;
    readonly port: number;
  };
}

export interface ApplicationProfiledCallbackContract {
  readonly selector: string;
  readonly cases: Readonly<Record<string, ApplicationSerializedCallbackContract>>;
  readonly default: ApplicationSerializedCallbackContract;
}

export interface ApplicationGatewayCommandContract {
  readonly command: ApplicationGraphNodeRef;
  readonly handler: ApplicationGraphNodeRef;
}

export interface ApplicationStreamNode extends ApplicationGraphNodeBase<'stream'> {
  readonly version: string;
  readonly payload: ApplicationMessageContractSchema;
  readonly authority: 'postgres-outbox' | 'kubernetes-watch' | 'provider';
  readonly delivery: 'at-least-once';
  readonly replay: 'supported' | 'reset-only';
  readonly retention: { readonly maxAgeSeconds: number; readonly maxMessages?: number };
  readonly partitioning: 'declared';
  readonly compatibility: 'versioned-schema';
  readonly authorization: 'application-defined';
  readonly database: ApplicationReactiveDatabaseRuntimeContract;
  readonly partitionSource: string;
  readonly partitionDependencies?: ApplicationHandlerDependencies;
  readonly partitionUnresolved?: readonly string[];
  readonly authorizationSource: string;
  readonly authorizationDependencies?: ApplicationHandlerDependencies;
  readonly authorizationUnresolved?: readonly string[];
  /**
   * Compiler-owned logical event-catalog selection. The selected contracts
   * remain the physical authorities; this node records the stable consumer
   * identity and the native-filter/materialization decision explicitly.
   */
  readonly catalog?: {
    readonly revision: string;
    readonly selection: 'of' | 'from' | 'all';
    readonly sources: readonly {
      readonly stream: ApplicationGraphNodeRef;
      readonly contract: { readonly id: string; readonly name: string; readonly version: string };
      readonly producer: { readonly kind: string; readonly id: string };
    }[];
    readonly lowering: 'postgres-native-filter';
    readonly predicateSource?: string;
    readonly predicateDependencies?: ApplicationHandlerDependencies;
    readonly predicateUnresolved?: readonly string[];
  };
  /**
   * Framework-owned signal metadata. Signal issuance remains an ordinary
   * replayable stream, while action hydration and exact-instance visibility
   * require the declared terminal-action schemas.
   */
  readonly signal?: {
    readonly id: string;
    readonly name: string;
    readonly version: string;
    readonly actions: readonly {
      readonly name: string;
      readonly schema: ApplicationMessageContractSchema;
    }[];
  };
}

export interface ApplicationSubscriptionNode extends ApplicationGraphNodeBase<'subscription'> {
  readonly source: ApplicationGraphNodeRef;
  readonly delivery: 'polling' | 'sse' | 'webhook' | 'queue';
  readonly cursor: 'opaque-scoped';
  readonly authorization: 'application-defined';
  /** The declared authorization callback is the generated admission policy. */
  readonly authority?: ApplicationOperationAuthorityGraphContract;
  readonly authorizationSource: string;
  readonly authorizationDependencies?: ApplicationHandlerDependencies;
  readonly authorizationLocation?: SourceLocation;
  readonly authorizationUnresolved?: readonly string[];
  readonly retry: ApplicationRetryPolicy;
  readonly suspension: 'bounded-failures';
}

export interface ApplicationModelRuntimeContract {
  readonly name: string;
  readonly tableName: string;
  readonly provider: 'postgres';
  /** Stable application-level authority identity; never installation-derived. */
  readonly authorityName?: string;
  readonly database: string;
  readonly clusterName: string;
  readonly secretName: string;
  readonly secretKey: string;
  readonly secretNamespace?: string;
  readonly connectionEnvName: string;
  readonly constraints: readonly ApplicationModelConstraint[];
  readonly indexes: readonly ApplicationModelIndex[];
  readonly retention: ApplicationRetentionPolicy;
  readonly managed?: {
    readonly applicationId: string;
    readonly statusSchemaVersion: string;
    readonly initialStatus: JsonObject;
  };
  readonly storageShape?: 'jsonb-envelope' | 'native-relational';
  readonly nativeRelational?: {
    readonly schema?: string;
    readonly identity: { readonly property: string; readonly column: string };
    readonly revision?: { readonly property: string; readonly column: string };
    readonly columns: readonly {
      readonly property: string;
      readonly column: string;
      /** Drizzle logical type used to restore provider-native row values. */
      readonly logicalType?: string;
    }[];
    readonly access?: { readonly context: string; readonly setting: string; readonly property: string; readonly column: string };
  };
}

/** Low-level Kubernetes Job/CronJob workload. Semantic finite work uses the separate application Job contract. */
export interface ApplicationWorkloadJobNode extends ApplicationGraphNodeBase<'workloadJob'> {
  readonly task: ApplicationJobTaskContract;
  readonly schedule?: ApplicationScheduleContract;
  readonly phase: ApplicationPhaseContract;
  readonly resources: readonly ApplicationResourceRef[];
  readonly retry: ApplicationRetryPolicy;
  readonly runtime: ApplicationJobRuntimeContract;
  readonly observability: ApplicationObservabilityContract;
  readonly generatedResources?: readonly ApplicationGeneratedResourceContract[];
}

/** Provider-neutral finite managed work; Kubernetes Job/CronJob resources are workloadJob nodes. */
export interface ApplicationJobNode extends ApplicationGraphNodeBase<'job'> {
  readonly contract: {
    readonly name: string;
    readonly version: string;
    readonly input: ApplicationMessageContractSchema;
    readonly output: ApplicationMessageContractSchema;
    readonly progress?: ApplicationMessageContractSchema;
    readonly error?: ApplicationMessageContractSchema;
  };
  readonly handlerSource: string;
  readonly queryBatch?: {
    readonly query: ApplicationGraphNodeRef;
    readonly selectionDigest: string;
    readonly consistency:
      | { readonly mode: 'repeatableSnapshot' }
      | { readonly mode: 'versionPinned'; readonly version: string }
      | { readonly mode: 'monotonicFrontier' }
      | { readonly mode: 'bestEffort'; readonly acceptsMembershipDrift: true; readonly idempotency: 'handlerDeclared' };
    readonly batch: { readonly maxItems: number; readonly concurrency: number };
    readonly lowering: {
      readonly provider: 'postgres';
      readonly strategy: 'materializedSnapshotRelation';
      readonly checkpointAuthority: 'sourceDatabase';
      readonly maximumSnapshotItems: number;
      readonly maximumSnapshotAgeSeconds: number;
      readonly stableKeyset: true;
      readonly durableWindowReceipts: true;
      readonly contiguousFrontier: true;
    };
    readonly resources?: { readonly cpu?: string; readonly memory?: string };
    readonly handlerSource: string;
    readonly handlerDependencies?: ApplicationHandlerDependencies;
    readonly handlerLocation?: SourceLocation;
    readonly handlerUnresolved?: readonly string[];
  };
  readonly events: Readonly<Record<'started' | 'progressed' | 'succeeded' | 'failed' | 'cancelled' | 'timedOut', {
    readonly id: string;
    readonly contract: ApplicationMessageContractSchema;
  }>>;
  readonly handlerDependencies?: { readonly source: string; readonly resolveDir: string };
  readonly sourceLocation?: SourceLocation;
  readonly retry: {
    readonly maxAttempts: number;
    readonly wholeAttempt: true;
  };
  readonly executionDeadlineSeconds?: number;
  readonly idempotency: {
    readonly scope: 'applicationDeploymentContractContextAuthority';
    readonly keySource: 'invocation' | 'inputExpression';
    readonly expression?: ApplicationExpressionContract;
    readonly conflict: 'failClosed';
  };
  readonly cancellation: {
    readonly request: 'durableReceipt';
    readonly terminal: 'firstTransitionWins';
    readonly behavior: 'cooperativeThenProviderBounded';
  };
  readonly retention: {
    readonly source: 'profileWithAuthoredOverrides';
    readonly resultSeconds?: number;
    readonly progressSeconds?: number;
    readonly applicationFactsSeconds?: number;
    readonly providerAttemptsSeconds?: number;
  };
  readonly runtime: {
    readonly interface: 'JobRuntime';
    readonly selection: 'profile';
    readonly protocol: 'applik8s.jobRuntime/v1alpha1';
  };
}

export interface ApplicationConfigNode extends ApplicationGraphNodeBase<'config'> {
  readonly provider: 'ConfigMap';
  readonly env?: string;
  readonly key: string;
  readonly mountPath?: string;
  readonly generatedResources: readonly ApplicationGeneratedResourceContract[];
}

export interface ApplicationSecretNode extends ApplicationGraphNodeBase<'secret'> {
  readonly provider: 'Secret';
  readonly ownership: 'generated' | 'external';
  readonly env?: string;
  readonly key: string;
  readonly mountPath?: string;
  readonly redaction: 'required' | 'none';
  readonly generatedResources: readonly ApplicationGeneratedResourceContract[];
}

export interface GeneratedJobContract extends ApplicationWorkloadJobNode {
  readonly task: ApplicationJobTaskContract;
  readonly phase: ApplicationPhaseContract;
  readonly retry: ApplicationRetryPolicy;
  readonly runtime: GeneratedJobRuntimeContract;
}

export interface GeneratedJobRuntimeContract extends ApplicationJobRuntimeContract {
  readonly idempotency: ApplicationJobIdempotencyContract;
  readonly phaseStatus: ApplicationStatusTargetRef;
  readonly durableStatusUpdater?: GeneratedJobDurableStatusUpdaterContract;
}

export interface GeneratedJobPhaseStatusContract {
  readonly phase: ApplicationPhaseContract;
  readonly idempotency: ApplicationJobIdempotencyContract;
  readonly statusTarget: ApplicationStatusTargetRef;
  readonly statusShape: GeneratedJobDurableStatusContract;
}

export interface GeneratedJobDurableStatusContract extends ApplicationPhaseStatus {
  readonly phase: string;
  readonly observedGeneration: number;
  readonly idempotencyKey: string;
  readonly retryCount: number;
  readonly conditions: readonly Condition[];
}

export interface GeneratedJobDurableStatusUpdaterContract {
  readonly runtimeModule: ApplicationRuntimeModuleRef;
  readonly observes: readonly ApplicationResourceRef[];
  readonly writes: ApplicationStatusTargetRef;
  readonly statusOwnership?: ApplicationDurableStatusOwnershipContract;
  readonly statusShape: GeneratedJobDurableStatusContract;
  readonly failurePolicy: 'failClosed' | 'diagnoseOnly';
  readonly idempotency: ApplicationJobIdempotencyContract;
  readonly diagnostics: readonly ApplicationDiagnosticContract[];
}

export interface ApplicationDurableStatusOwnershipContract {
  readonly primary: 'applicationStatus' | 'generatedStatusConfigMap';
  readonly durableAuthority: 'applicationStatus' | 'generatedStatusConfigMap';
  readonly releasePolicy: 'v0.3StableGeneratedStatusConfigMapFallback' | 'appStatusSchemaRequired' | 'kroStatusProjectionRequired';
  readonly applicationStatusProjection: 'bestEffortNonAuthoritative' | 'requiredAuthoritative' | 'unsupported';
  readonly fallback?: 'generatedStatusConfigMap';
  readonly appStatusSchema: 'required' | 'bestEffort' | 'unsupported';
  readonly appStatusWrite?: ApplicationAppStatusWritePolicyContract;
  readonly appStatusSchemaContract?: ApplicationAppStatusSchemaContract;
  readonly durableStore?: ApplicationResourceRef;
  readonly fallbackStore?: ApplicationGeneratedStatusConfigMapContract;
  readonly concurrency?: ApplicationDurableStatusConcurrencyContract;
  readonly observability?: ApplicationDurableStatusObservabilityContract;
  readonly conflictPolicy: 'mergePatch' | 'failClosed';
  readonly diagnostics: readonly ApplicationDiagnosticContract[];
}

export interface ApplicationDurableStatusConcurrencyContract {
  readonly updateStrategy: 'resourceVersionRetry';
  readonly maxAttempts: number;
  readonly retryDiagnostic: 'applik8s-job-status-reconciler-status-store-conflict-retry';
  readonly retryExhaustedDiagnostic: 'applik8s-job-status-reconciler-status-store-conflict-exhausted';
  readonly failurePolicy: 'failClosed';
}

export type ApplicationDurableStatusMergeMetric = 'acceptedUpdates' | 'rejectedUpdates' | 'conflictUpdates' | 'observedJobs' | 'retainedJobs';

export interface ApplicationDurableStatusObservabilityContract {
  readonly mergeEvent: 'applik8s-job-status-reconciler-status-store-merged';
  readonly conflictRetryEvent: 'applik8s-job-status-reconciler-status-store-conflict-retry';
  readonly metrics: readonly ApplicationDurableStatusMergeMetric[];
}

export interface ApplicationAppStatusSchemaContract {
  readonly statusRoot: 'status.applik8s';
  readonly jobsPath: 'status.applik8s.jobs';
  readonly schema: 'generatedJobStatusMap';
  readonly ownership: 'runtimePatchBestEffort' | 'runtimePatchRequired' | 'kroStatusProjection';
  readonly pruningBehavior: 'fallbackToGeneratedStatusConfigMap' | 'failClosed';
}

export interface ApplicationAppStatusWritePolicyContract {
  readonly mode: 'bestEffortPatch' | 'requiredPatch';
  readonly failureBehavior: 'diagnoseAndContinueWithDurableFallback' | 'failClosed';
  readonly failureDiagnostic: 'applik8s-job-status-reconciler-app-status-error';
  readonly durableFallback: 'generatedStatusConfigMap' | 'none';
}

export type ApplicationGeneratedStatusConfigMapDataKey = 'status.json' | 'applik8s-jobs.json' | 'history.json' | 'conflicts.json' | 'updatedAt';

export interface ApplicationGeneratedStatusConfigMapContract {
  readonly objectOwnership: 'generatedResource' | 'runtimeCreatedResource';
  readonly dataOwnership: 'runtime';
  readonly dataKeys: readonly ApplicationGeneratedStatusConfigMapDataKey[];
  readonly updateStrategy: 'resourceVersionMergePatch';
  readonly history: { readonly key: 'history.json'; readonly maxEntries: number; readonly terminalRetention: 'retain' | 'ttl'; readonly ttlSeconds?: number };
  readonly conflicts: { readonly key: 'conflicts.json'; readonly maxEntries: number };
}

export interface ApplicationProviderNode<TInterface extends ApplicationProviderInterfaceKind = ApplicationProviderInterfaceKind> extends ApplicationGraphNodeBase<'provider'> {
  readonly interface: TInterface;
  readonly implementation: string;
  readonly contract?: ApplicationProviderInterfaceContract<TInterface>;
  readonly config?: JsonObject;
}

export interface ApplicationProviderInterfaceContract<TInterface extends ApplicationProviderInterfaceKind = ApplicationProviderInterfaceKind> {
  readonly apiVersion?: 'applik8s.provider/v1alpha1';
  readonly interface: TInterface;
  readonly version?: string;
  readonly requirements?: readonly string[];
  readonly guarantees?: readonly string[];
  readonly implementation?: { readonly name: string; readonly version?: string };
  readonly surface: ApplicationCompatibilitySurface;
  readonly support: 'implemented' | 'failClosedReserved' | 'externalAuthority';
  readonly diagnostics: readonly ApplicationDiagnosticContract[];
}

export interface ApplicationProviderCompatibilityMatrixContract {
  readonly apiVersion: 'applik8s.providerCompatibility/v1alpha1';
  readonly providers: readonly ApplicationProviderInterfaceContract[];
  readonly requiredForV03: readonly ApplicationProviderInterfaceKind[];
}

export interface ApplicationProviderRequirement<TInterface extends ApplicationProviderInterfaceKind = ApplicationProviderInterfaceKind> {
  readonly id: string;
  readonly interface: TInterface;
  readonly consumer: ApplicationGraphNodeRef;
  readonly provider?: ApplicationProviderRef<TInterface>;
  readonly required: true;
  readonly purpose:
    | 'transactionalDatabase'
    | 'analyticalDatabase'
    | 'indexStore'
    | 'counterStore'
    | 'eventSource'
    | 'eventLog'
    | 'secret'
    | 'queue'
    | 'objectStorage'
    | 'httpExposure'
    | 'certificate'
    | 'dnsPublication'
    | 'credentialStore'
    | 'containerRegistry'
    | (string & {});
  readonly diagnostics: ApplicationProviderRequirementDiagnostics;
}

export interface ApplicationProviderRequirementDiagnostics {
  readonly missing: string;
  readonly ambiguous: string;
}

export interface ApplicationProviderBindingContract<TInterface extends ApplicationProviderInterfaceKind = ApplicationProviderInterfaceKind> {
  readonly requirement: string;
  readonly provider: ApplicationProviderRef<TInterface>;
  readonly generatedResources: readonly ApplicationResourceRef[];
  readonly runtime: ApplicationProviderRuntimeContract;
  readonly metadataLinks?: readonly ApplicationGraphMetadataLink[];
}

export type ApplicationProviderResolution<TInterface extends ApplicationProviderInterfaceKind = ApplicationProviderInterfaceKind> =
  | ApplicationProviderResolved<TInterface>
  | ApplicationProviderResolutionFailure<TInterface>;

export interface ApplicationProviderResolved<TInterface extends ApplicationProviderInterfaceKind = ApplicationProviderInterfaceKind> {
  readonly status: 'resolved';
  readonly requirement: ApplicationProviderRequirement<TInterface>;
  readonly provider: ApplicationProviderNode<TInterface>;
  readonly diagnostics: readonly Diagnostic[];
}

export interface ApplicationProviderResolutionFailure<TInterface extends ApplicationProviderInterfaceKind = ApplicationProviderInterfaceKind> {
  readonly status: 'missing' | 'ambiguous' | 'invalidConsumer' | 'invalidProvider';
  readonly requirement: ApplicationProviderRequirement<TInterface>;
  readonly candidates: readonly ApplicationProviderNode<TInterface>[];
  readonly diagnostics: readonly Diagnostic[];
}

export interface ApplicationProviderRuntimeContract {
  readonly env?: Readonly<Record<string, string>>;
  /**
   * Secret-backed environment bindings required by a managed provider
   * runtime. The graph contains only Secret identity and key metadata; Secret
   * values remain target-owned and must never enter application artifacts.
   */
  readonly secretEnv?: Readonly<Record<string, {
    readonly secret: ApplicationResourceRef;
    readonly key: string;
    readonly optional?: boolean;
  }>>;
  readonly secretRefs?: readonly ApplicationResourceRef[];
  readonly volumeMounts?: readonly string[];
  readonly permissions?: readonly PermissionRule[];
  readonly readiness?: ApplicationProviderReadinessContract;
  readonly metadataLinks?: readonly ApplicationGraphMetadataLink[];
}

/**
 * Authoring-time provider runtime binding after provider/profile/target
 * selection has been made explicit. This is graph data, never an executable
 * provider client or a credential value.
 */
export type ApplicationCallableProviderRuntimeBinding =
  | {
      readonly kind: 'runtime';
      readonly runtime: ApplicationProviderRuntimeContract;
    }
  | {
      readonly kind: 'profileSelection';
      readonly selector: string;
      readonly cases: Readonly<Record<string, ApplicationCallableProviderRuntimeBinding>>;
      readonly default: ApplicationCallableProviderRuntimeBinding;
    }
  | {
      readonly kind: 'targetSelection';
      readonly targets: Readonly<Partial<Record<
        'local' | 'aws-local' | 'aws' | 'kubernetes',
        ApplicationCallableProviderRuntimeBinding
      >>>;
    };

export interface ApplicationProviderReadinessContract {
  readonly dependencies: readonly ApplicationResourceRef[];
  readonly condition?: string;
  readonly timeoutSeconds?: number;
}

export interface ApplicationPermissionNode extends ApplicationGraphNodeBase<'permission'> {
  readonly owner: ApplicationGraphNodeRef;
  readonly rules: readonly PermissionRule[];
  readonly mode: 'explicit' | 'inferred' | 'explicitAndInferred';
}

export interface ApplicationAuthorityManifestNode extends ApplicationGraphNodeBase<'authorityManifest'> {
  readonly manifest: ApplicationStaticAuthorityManifest;
}

export interface ApplicationTypeKroResourceNode extends ApplicationGraphNodeBase<'typeKroResource'> {
  readonly resource: ApplicationResourceRef;
  readonly watch?: ApplicationWatchScope;
}

export interface ApplicationOperationTargetContract {
  readonly id: string;
  readonly target: ApplicationResourceRef | ApplicationGraphNodeRef;
  readonly operations: readonly ApplicationOperationTargetOperation[];
  readonly execution?: ApplicationOperationTargetExecutionContract;
  readonly lowering?: ApplicationOperationTargetLoweringContract;
  readonly dryRun: ApplicationOperationDryRunContract;
  readonly ownership: ApplicationOperationOwnershipContract;
  readonly finalizers: ApplicationOperationFinalizerContract;
  readonly permissions: readonly PermissionRule[];
  readonly diagnostics: readonly ApplicationDiagnosticContract[];
}

export interface ApplicationOperationTargetExecutionContract {
  readonly contexts: readonly ApplicationOperationTargetExecutionContext[];
  readonly ordering: 'dependencyAware' | 'declaredOrder';
  readonly runtimeValidation: 'beforeEffects';
  readonly failurePolicy: 'failClosed';
}

export type ApplicationOperationTargetExecutionContext = 'handler' | 'generatedServer' | 'generatedJob' | 'typeKro';

export interface ApplicationOperationTargetLoweringContract {
  readonly mode: 'typeKroResource' | 'kubernetesResource' | 'generatedPlan';
  readonly artifact?: ApplicationGeneratedArtifactRef;
  readonly failurePolicy: 'failClosed';
}

export type ApplicationOperationTargetOperation = 'apply' | 'delete' | 'patch' | 'status';

export interface ApplicationOperationDryRunContract {
  readonly supported: boolean;
  readonly artifact?: ApplicationGeneratedArtifactRef;
  readonly failurePolicy: 'failClosed' | 'diagnoseOnly';
}

export interface ApplicationOperationOwnershipContract {
  readonly ownerReferences: 'required' | 'optional' | 'forbidden';
  readonly orphanPolicy: 'retain' | 'delete' | 'failClosed';
}

export interface ApplicationOperationFinalizerContract {
  readonly required: boolean;
  readonly finalizer?: string;
  readonly cleanupOperation: 'deleteTarget' | 'patchStatus' | 'none';
}

export type ApplicationGeneratedResourceRole =
  | 'workload'
  | 'service'
  | 'rbac'
  | 'policy'
  | 'config'
  | 'secret'
  | 'runtimeBundle'
  | 'routeDiagnostics'
  | 'jobDiagnostics'
  | 'providerDependency'
  | 'migration'
  | 'exposure';

export interface ApplicationGeneratedResourceContract {
  readonly role: ApplicationGeneratedResourceRole;
  readonly graphNode: ApplicationGraphNodeRef;
  readonly resource?: ApplicationResourceRef;
  readonly artifact?: ApplicationGeneratedArtifactRef;
  readonly dependsOn?: readonly ApplicationGraphNodeRef[];
  readonly metadataLinks?: readonly ApplicationGraphMetadataLink[];
}

export type ApplicationGeneratedArtifactKind =
  | 'kubernetesManifest'
  | 'typeKroResource'
  | 'runtimeBundle'
  | 'runtimeModule'
  | 'rbacManifest'
  | 'routeDiagnostics'
  | 'jobDiagnostics'
  | 'providerContract';

export interface ApplicationGeneratedArtifactRef {
  readonly kind: ApplicationGeneratedArtifactKind;
  readonly path?: string;
  readonly name?: string;
  readonly digest?: string;
}

export interface ApplicationGraphMetadataLink {
  readonly graphNode: ApplicationGraphNodeRef;
  readonly artifact: ApplicationGeneratedArtifactRef;
  readonly purpose: 'manifest' | 'runtimeMetadata' | 'rbac' | 'routeDiagnostics' | 'jobDiagnostics' | 'providerDependency';
}

export interface ApplicationObservabilityContract {
  readonly health: ApplicationObservabilityHealthContract;
  readonly logs: ApplicationObservabilityLogContract;
  readonly metrics: ApplicationObservabilityMetricsContract;
  readonly events: readonly ApplicationDiagnosticEvent[];
  readonly sourceMaps: 'required' | 'notApplicable';
  readonly replayArtifacts: readonly ApplicationGeneratedArtifactRef[];
  readonly diagnosticsArtifact: ApplicationGeneratedArtifactRef;
}

export interface ApplicationObservabilityHealthContract {
  readonly mode: 'http' | 'kubernetesJobStatus';
  readonly readinessPath?: string;
  readonly livenessPath?: string;
}

export interface ApplicationObservabilityLogContract {
  readonly format: 'json';
  readonly component: string;
  readonly failureEvents: readonly ApplicationDiagnosticEvent[];
}

export interface ApplicationObservabilityMetricsContract {
  readonly mode: 'declaredHooks' | 'none';
  readonly names: readonly string[];
}

export interface ApplicationGraphNodeRef {
  readonly nodeId: string;
}

export interface ApplicationResourceRef {
  readonly apiVersion: ApiVersion;
  readonly kind: string;
  readonly name?: KubernetesName;
  readonly namespace?: NamespaceName;
}

export interface ApplicationResourceContract {
  readonly apiVersion: ApiVersion;
  readonly kind: string;
  readonly plural: string;
  readonly scope: ResourceScope;
}

export interface ApplicationCrdSchemaCompatibilityContract {
  readonly resource: ApplicationResourceContract;
  readonly currentVersion: string;
  readonly nextVersion: string;
  readonly policy: ApplicationCrdSchemaCompatibilityPolicy;
  readonly allowedChanges: readonly ApplicationCrdSchemaChangeKind[];
  readonly rejectedChanges: readonly ApplicationCrdSchemaChangeKind[];
  readonly postV3Requirements: readonly ApplicationCrdSchemaPostV3Requirement[];
  readonly diagnostics: readonly ApplicationDiagnosticContract[];
}

export interface ApplicationCrdSchemaCompatibilityPolicy {
  readonly mode: 'additiveOnly' | 'explicitReviewRequired' | 'externalAuthority';
  readonly conversionWebhook: 'notRequired' | 'postV3Required' | 'externalAuthority';
  readonly storedVersionMigration: 'notRequired' | 'postV3Required' | 'externalAuthority';
  readonly unknownFieldPolicy: 'preserveExisting' | 'rejectNewUnknownFields';
  readonly failurePolicy: 'failClosed' | 'diagnoseOnly';
}

export type ApplicationCrdSchemaChangeKind = 'addOptionalField' | 'addRequiredField' | 'removeField' | 'renameField' | 'narrowType' | 'widenType' | 'changeDefault' | 'addEnumValue' | 'removeEnumValue';

export type ApplicationCrdSchemaPostV3Requirement = 'conversionWebhook' | 'storedVersionMigration' | 'multiVersionStorage';

export interface ApplicationEntityContract {
  readonly name: string;
  readonly specSchemaDigest?: string;
  readonly statusSchemaDigest?: string;
}

export interface ApplicationModelSchemaContract {
  readonly identity: readonly string[];
  readonly constraints: readonly ApplicationModelConstraint[];
  readonly indexes: readonly ApplicationModelIndex[];
  readonly migrations: ApplicationMigrationContract;
  readonly transactions: 'required' | 'supported' | 'unsupported';
  readonly retention?: ApplicationRetentionPolicy;
  readonly guarantees?: ApplicationTransactionalDatabaseGuaranteesContract;
}

export interface ApplicationTransactionalDatabaseGuaranteesContract {
  readonly identity: 'stableId';
  readonly uniqueness: 'databaseConstraint';
  readonly indexes: 'declaredSecondaryIndexes';
  readonly transactions: 'required' | 'supported' | 'unsupported';
  readonly retention: 'retain' | 'deleteWithApplication' | 'ttl';
  readonly migrationOwnership: 'generatedJob' | 'external' | 'none';
  readonly semantics?: ApplicationTransactionalDatabaseSemanticsContract;
}

export interface ApplicationTransactionalDatabaseSemanticsContract {
  readonly generatedRuntimeParity: 'required';
  readonly scriptRuntimeParity: 'required' | 'notSupported';
  readonly query: ApplicationModelQuerySemanticsContract;
  readonly indexes: ApplicationModelIndexSemanticsContract;
  readonly constraints: ApplicationModelConstraintSemanticsContract;
  readonly migrationHistory: ApplicationMigrationHistoryContract;
  readonly transactions: ApplicationModelTransactionSemanticsContract;
  readonly retention: ApplicationModelRetentionSemanticsContract;
}

export interface ApplicationModelQuerySemanticsContract {
  readonly defaultLimit: number;
  readonly maxLimit: number;
  readonly cursor: 'offset' | 'opaque';
  readonly unsupportedFilters: 'failClosed';
}

export interface ApplicationModelIndexSemanticsContract {
  readonly partitionRequired: boolean;
  readonly uniqueEnforcedBy: 'databaseConstraint' | 'none';
  readonly orderBy: 'declaredIndexFieldsOnly';
  readonly unsupportedOrderBy: 'failClosed';
}

export interface ApplicationModelConstraintSemanticsContract {
  readonly duplicateKeyDiagnostic: ApplicationDiagnosticEvent;
  readonly enforcement: 'databaseConstraint';
}

export interface ApplicationModelTransactionSemanticsContract {
  readonly declaration: 'required' | 'supported' | 'unsupported';
  readonly singleOperationAtomicity: 'databaseStatement';
  readonly multiOperationApi: 'absentFromPublicApi' | 'implemented';
  readonly multiOperationBehavior: 'methodAbsent' | 'runtimeTransaction' | 'failClosed';
}

export interface ApplicationModelRetentionSemanticsContract {
  readonly mode: 'retain' | 'deleteWithApplication' | 'ttl';
  readonly ttlSeconds?: number;
  readonly deletionPolicy: 'explicitOnly' | 'ownerDeletion';
  readonly enforcement: 'declaredOnly' | 'runtimeEnforced';
}

export interface ApplicationModelMaterializationContract {
  readonly mode: 'providerBacked';
  readonly provider: ApplicationProviderRef<
    'TransactionalDatabase' | 'AnalyticalDatabase'
  >;
  readonly backingResources: readonly ApplicationResourceRef[];
  readonly connection: ApplicationProviderRuntimeContract;
  readonly runtimeBoundary: ApplicationModelRuntimeBoundaryContract;
  readonly reconciliation: ApplicationModelReconciliationContract;
}

export interface ApplicationModelRuntimeBoundaryContract {
  readonly serializedCallbacks: 'generatedRuntimeClient';
  readonly scriptExecution: 'scriptRuntimeClient';
}

export interface ApplicationModelReconciliationContract {
  readonly ownership: 'application' | 'external';
  readonly schemaDrift: 'failClosed' | 'generatedMigrationJob';
  readonly deletionPolicy: 'retain' | 'deleteWithApplication';
}

export interface ApplicationModelConstraint {
  readonly name: string;
  readonly fields: readonly string[];
  readonly kind: 'unique' | 'foreignKey' | 'check';
}

export interface ApplicationModelIndex {
  readonly name: string;
  readonly fields: readonly string[];
  readonly unique?: boolean;
}

export interface ApplicationMigrationContract {
  readonly strategy: 'none' | 'generatedJob' | 'external';
  readonly compatibility: 'schemaCompatibleOnly' | 'requiresExplicitMigration';
  readonly compatibilityPolicy?: ApplicationMigrationCompatibilityPolicy;
  readonly plan?: ApplicationMigrationPlanContract;
  readonly history?: ApplicationMigrationHistoryContract;
}

export interface ApplicationMigrationCompatibilityPolicy {
  readonly mode: 'additiveOnly' | 'explicitPlanRequired' | 'externalAuthority';
  readonly destructiveChangePolicy: 'reject' | 'requireManualApproval' | 'externalAuthority';
  readonly driftPolicy: 'failClosed' | 'warnOnly' | 'externalAuthority';
  readonly dataBackfillPolicy?: 'unsupported' | 'generatedJob' | 'external';
}

export interface ApplicationMigrationDriftCheckContract {
  readonly model: ApplicationGraphNodeRef;
  readonly provider: ApplicationProviderRef<'TransactionalDatabase'>;
  readonly observedSchemaSource: ApplicationResourceRef;
  readonly expectedRevision: string;
  readonly policy: ApplicationMigrationCompatibilityPolicy;
  readonly enforcement?: ApplicationMigrationDriftEnforcementContract;
  readonly failureModes: readonly ApplicationMigrationDriftFailureMode[];
  readonly diagnostics: readonly ApplicationDiagnosticContract[];
}

export interface ApplicationMigrationDriftEnforcementContract {
  readonly stage: 'preMigration' | 'preRuntimeStartup';
  readonly historyTable: string;
  readonly lock: 'providerNative' | 'none';
  readonly failurePolicy: 'failClosed' | 'diagnoseOnly';
}

export type ApplicationMigrationDriftFailureMode = 'missingHistoryTable' | 'missingModelTable' | 'incompatibleColumn' | 'incompatibleIndex' | 'destructiveChange' | 'unknownExistingObject';

export interface ApplicationMigrationPlanContract {
  readonly id: string;
  readonly model: ApplicationGraphNodeRef;
  readonly fromRevision?: string;
  readonly toRevision: string;
  readonly checks: readonly ApplicationMigrationCheckContract[];
  readonly steps: readonly ApplicationMigrationStepContract[];
}

export interface ApplicationMigrationCheckContract {
  readonly id: string;
  readonly kind: 'schemaDrift' | 'destructiveChange' | 'dataCompatibility' | 'credentialAccess' | 'providerReadiness';
  readonly failurePolicy: 'block' | 'warn';
  readonly diagnostic: ApplicationDiagnosticContract;
}

export interface ApplicationMigrationStepContract {
  readonly id: string;
  readonly kind: 'createTable' | 'addColumn' | 'addIndex' | 'addConstraint' | 'backfillData' | 'dropIndex' | 'dropConstraint' | 'customSql';
  readonly idempotent: boolean;
  readonly destructive?: boolean;
  readonly sqlDigest?: string;
  readonly dependsOn?: readonly string[];
  readonly diagnostic: ApplicationDiagnosticContract;
}

export interface ApplicationMigrationHistoryContract {
  readonly tableName: string;
  readonly revisionColumn: string;
  readonly appliedAtColumn: string;
}

export interface ApplicationRetentionPolicy {
  readonly mode: 'retain' | 'ttl' | 'deleteWithOwner';
  readonly ttlSeconds?: number;
}

export interface ApplicationRouteContract {
  readonly id: string;
  readonly named?: boolean;
  readonly method: string;
  readonly path: string;
  readonly authority?: ApplicationOperationAuthorityGraphContract;
  /** Typed function-native route lowering. Absent for the advanced raw server escape hatch. */
  readonly functionNative?: ApplicationFunctionNativeHttpRouteContract;
  readonly diagnostics?: ApplicationRouteDiagnosticsContract;
  readonly sourceLocation?: SourceLocation;
  readonly metadataLinks?: readonly ApplicationGraphMetadataLink[];
}

export interface ApplicationFunctionNativeHttpRouteContract {
  readonly input: ApplicationMessageContractSchema;
  readonly output: ApplicationMessageContractSchema;
  readonly handler: ApplicationSerializedCallbackContract;
  readonly authorize?: ApplicationSerializedCallbackContract;
  /**
   * Provider-authenticated raw request boundary. The callback receives exact
   * bytes and headers and must return the schema-normalized route input.
   */
  readonly webhookAuthentication?: ApplicationSerializedCallbackContract;
  /**
   * Compiler-owned publication metadata. A typed route remains internal until
   * its callable handle is exported from the application entrypoint.
   */
  readonly publication?: {
    readonly boundary: 'entrypoint-export';
  };
  /**
   * Direct model operations captured by the ordinary route closure. The
   * compiler rehydrates these callable leaves inside the authenticated HTTP
   * worker; authors never declare an operation map.
   */
  readonly operationBindings?: readonly {
    readonly identifier: string;
    readonly operationId: string;
    /**
     * Authoring-time operation identity retained by a packaged maintained
     * callable. The canonical operationId remains the authority/catalog
     * identity; generated runtimes accept this alias only inside the exact
     * callback scope that proved the dependency.
     */
    readonly runtimeOperationId?: string;
    readonly command: ApplicationGraphNodeRef;
    readonly handler: ApplicationGraphNodeRef;
  }[];
  /** Provider capabilities inferred through ordinary maintained-module calls. */
  readonly providerBindings?: readonly ApplicationCallableProviderBinding[];
  /** Object-store handles captured by the route closure, retained for authority/evidence inspection. */
  readonly objectBindings?: readonly {
    readonly identifier: string;
    readonly store: ApplicationGraphNodeRef;
  }[];
  /** Durable workflow/task handles captured from the ordinary route closure. */
  readonly workflowBindings?: readonly {
    readonly identifier: string;
    readonly target: ApplicationGraphNodeRef;
    readonly contract: {
      readonly name: string;
      readonly version: string;
      readonly input: ApplicationMessageContractSchema;
      readonly output: ApplicationMessageContractSchema;
      readonly signals: readonly {
        readonly name: string;
        readonly schema: ApplicationMessageContractSchema;
      }[];
    };
  }[];
  /** Finite Job handles captured from the ordinary route closure. */
  readonly jobBindings?: readonly {
    readonly identifier: string;
    readonly target: ApplicationGraphNodeRef;
    readonly contract: {
      readonly name: string;
      readonly version: string;
      readonly input: ApplicationMessageContractSchema;
      readonly output: ApplicationMessageContractSchema;
      readonly progress?: ApplicationMessageContractSchema;
      readonly error?: ApplicationMessageContractSchema;
    };
  }[];
  /** Selected finite execution authority for captured Job handles. */
  readonly jobRuntime?: ApplicationProviderRef<'JobRuntime'>;
  /** Selected runtime authority for the captured durable handles. */
  readonly workflowEngine?: ApplicationProviderRef<'WorkflowEngine'>;
  readonly transaction?: ApplicationFunctionNativeTransactionContract;
  readonly idempotency: {
    readonly source: 'http-idempotency-key';
    readonly contextScoped: true;
  };
  readonly requestBoundary: {
    readonly durableValues: 'schema-normalized-only';
    readonly rawRequestCapture: 'rejected';
    readonly principal: 'framework-authenticated' | 'provider-authenticated';
  };
}

export interface ApplicationRouteDiagnosticsContract {
  readonly routeFailureEvent: 'applik8s-server-route-failure';
  readonly actionFailureEvent: 'applik8s-route-action-failure';
  readonly failurePolicy: 'failClosed';
  readonly partialEffects: 'unknownAfterActionStarted';
  readonly sourceMaps: 'required';
  readonly includes: readonly ApplicationRouteDiagnosticField[];
}

export type ApplicationRouteDiagnosticField = 'routeId' | 'method' | 'path' | 'module' | 'sourceLocation' | 'bundleInputs' | 'action' | 'diagnostic' | 'stack';

export interface ApplicationProviderRef<TInterface extends ApplicationProviderInterfaceKind = ApplicationProviderInterfaceKind> {
  readonly interface: TInterface;
  readonly nodeId: string;
}

/**
 * Public generated-runtime entrypoint for one callable provider operation.
 * The compiler emits a static ESM import from this contract; no provider
 * package receives compiler namespace privilege or a runtime dynamic-import
 * escape hatch.
 */
export interface ApplicationCallableProviderRuntimeOperation {
  readonly module: string;
  readonly export: string;
  /**
   * Provider-authored semantic infrastructure access for this operation.
   * `none` is explicit: an omitted declaration is never interpreted as broad
   * ambient access by a generated worker.
   */
  readonly access:
    | 'none'
    | {
        readonly kind: 'provider';
        readonly operations: readonly ApplicationRuntimeAccessOperation[];
      };
}

/** Exact provider operation captured by an ordinary managed closure. */
export interface ApplicationCallableProviderBinding {
  /** Authored lexical binding path. A one-segment path is an extracted function. */
  readonly identifier: string;
  readonly provider: ApplicationProviderRef;
  /** Exact captured value projection reconstructed by the managed worker. */
  readonly projection?: 'binding' | 'implementation' | 'token';
  /** True only when the selected provider is constructed in this workload. */
  readonly privateRuntime?: true;
  /**
   * Explicit provenance for a non-callable placement dependency. Generated
   * workers may omit only resource-backed placement bindings; an ordinary
   * provider dependency without an exact operation remains invalid.
   */
  readonly placement?: 'objectStore' | 'providerDependency';
  /** Exact logical store whose bounded runtime handle must be hydrated. */
  readonly objectStore?: ApplicationGraphNodeRef;
  /** Absent only when `placement` records non-callable dependency provenance. */
  readonly operation?: {
    readonly member: string;
    readonly runtime?: ApplicationCallableProviderRuntimeOperation;
  };
}

export type ApplicationWatchScope =
  | ApplicationExactWatchScope
  | ApplicationFiniteWatchScope
  | ApplicationSelectorWatchScope
  | ApplicationFieldSelectorWatchScope
  | ApplicationMixedWatchScope;

export interface ApplicationWatchScopeLoweringContract {
  readonly scope: ApplicationWatchScope;
  readonly lowering: 'exact' | 'finite' | 'labelSelector' | 'fieldSelector' | 'mixed';
  readonly runtime?: ApplicationWatchScopeRuntimeContract;
  readonly permissions: readonly PermissionRule[];
  readonly failurePolicy: 'failClosed';
  readonly diagnostics: readonly ApplicationDiagnosticContract[];
}

export interface ApplicationWatchScopeRuntimeContract {
  readonly mode: 'directWatch' | 'sharedInformer';
  readonly resyncPolicy: 'none' | 'bounded';
  readonly cancellation: 'onShutdown' | 'onScopeRemoved';
}

export interface ApplicationExactWatchScope {
  readonly kind: 'exact';
  readonly ref: ObjectRef;
}

export interface ApplicationFiniteWatchScope {
  readonly kind: 'finite';
  readonly refs: readonly ObjectRef[];
}

export interface ApplicationSelectorWatchScope {
  readonly kind: 'labelSelector';
  readonly apiVersion: ApiVersion;
  readonly resourceKind: string;
  readonly namespace?: NamespaceName;
  readonly labels: Readonly<Record<string, string>>;
}

export interface ApplicationFieldSelectorWatchScope {
  readonly kind: 'fieldSelector';
  readonly apiVersion: ApiVersion;
  readonly resourceKind: string;
  readonly namespace?: NamespaceName;
  readonly fieldSelector: string;
}

export interface ApplicationMixedWatchScope {
  readonly kind: 'mixed';
  readonly scopes: readonly Exclude<ApplicationWatchScope, ApplicationMixedWatchScope>[];
}

export interface ApplicationStatusTargetRef {
  readonly resource: ApplicationResourceRef | ApplicationGraphNodeRef;
  readonly statusPath?: string;
}

export interface ApplicationFlushPolicy {
  readonly everyMs: number;
  readonly maxEvents?: number;
}

export interface ApplicationExpressionContract {
  readonly kind: 'field' | 'label' | 'literal' | 'ordering' | 'predicate' | 'function';
  readonly source: string;
}

export interface ApplicationJobTaskContract {
  readonly taskKind: 'preflight' | 'migration' | 'cleanup' | 'repair' | 'maintenance' | 'custom';
  readonly image?: string;
  readonly command?: readonly string[];
  readonly args?: readonly string[];
}

export interface ApplicationJobRuntimeContract {
  readonly materialization: 'kubernetes-job' | 'kubernetes-cronjob';
  readonly idempotency: ApplicationJobIdempotencyContract;
  readonly phaseStatus: ApplicationStatusTargetRef;
  readonly statusLifecycle?: ApplicationJobStatusLifecycleContract;
  readonly permissions: readonly PermissionRule[];
  readonly environment?: ApplicationProviderRuntimeContract;
  readonly metadataLinks?: readonly ApplicationGraphMetadataLink[];
}

export interface ApplicationJobStatusLifecycleContract {
  readonly ownership: ApplicationDurableStatusOwnershipContract;
  readonly conflictPolicy: 'mergePatch' | 'failClosed';
  readonly conflictResolution: ApplicationJobStatusConflictResolutionContract;
  readonly historyRetention: ApplicationJobHistoryRetentionContract;
  readonly terminalFailure: ApplicationJobTerminalFailureContract;
  readonly multiJob: 'appLevelReconciler' | 'perJobReconciler';
  readonly cronJob: 'latestRunAndHistory' | 'unsupported';
  readonly fallback: 'generatedStatusConfigMap' | 'none';
}

export interface ApplicationJobStatusConflictResolutionContract {
  readonly staleObservedGeneration: 'reject';
  readonly completedIdempotencyKey: 'retainCompleted';
  readonly diagnosticsStore: 'conflicts.json' | 'applicationStatus';
}

export interface ApplicationJobHistoryRetentionContract {
  readonly maxEntries: number;
  readonly terminalRetention: 'retain' | 'ttl';
  readonly ttlSeconds?: number;
}

export interface ApplicationJobTerminalFailureContract {
  readonly condition: 'Failed';
  readonly partialEffects: 'required';
  readonly diagnostics: 'required';
  readonly history: 'retain' | 'ttl';
}

export interface ApplicationScheduleContract {
  readonly cron: string;
  readonly timezone?: string;
  readonly concurrencyPolicy?: 'allow' | 'forbid' | 'replace';
  readonly missedRunPolicy?: 'skip' | 'startLate' | 'failClosed';
  readonly startingDeadlineSeconds?: number;
}

export interface ApplicationJobIdempotencyContract {
  readonly keySource: 'metadata.uid' | 'metadata.generation' | 'spec' | 'explicit';
  readonly conflictPolicy: 'skipCompleted' | 'replaceFailed' | 'failClosed';
}

export interface ApplicationPhaseContract {
  readonly initialPhase: string;
  readonly terminalPhases: readonly string[];
  readonly conditions: readonly ApplicationPhaseConditionType[];
}

export type ApplicationPhaseConditionType = 'Blocked' | 'Progressing' | 'Ready' | 'Finalized' | 'Failed';

export interface ApplicationPhaseStatus {
  readonly phase: string;
  readonly observedGeneration?: number;
  readonly currentStep?: string;
  readonly lastSuccessfulStep?: string;
  readonly idempotencyKey?: string;
  readonly retryCount?: number;
  readonly terminalFailure?: ApplicationTerminalFailure;
  readonly conditions: readonly Condition[];
}

export interface ApplicationTerminalFailure {
  readonly reason: string;
  readonly message: string;
  readonly failedStep?: string;
  readonly partialEffects?: readonly ApplicationPartialEffect[];
}

export interface ApplicationPartialEffect {
  readonly operation: string;
  readonly ref?: ObjectRef;
  readonly status: 'visible' | 'unknown' | 'rolledBack';
}

export interface ApplicationRetryPolicy {
  readonly mode: 'never' | 'boundedExponentialBackoff';
  readonly maxAttempts?: number;
  readonly initialDelayMs?: number;
  readonly maxDelayMs?: number;
  /** Exponential multiplier when the backing runtime exposes one directly. */
  readonly factor?: number;
}

export type ApplicationRuntimeModuleKind =
  | 'serverRuntime'
  | 'modelRuntime'
  | 'indexerRuntime'
  | 'aggregateWorkerRuntime'
  | 'counterFlusherRuntime'
  | 'jobRunnerRuntime'
  | 'kubernetesClient'
  | 'diagnostics'
  | 'providerAdapter';

// typecast: runtime module manifest validation keeps this literal tuple aligned with the public runtime module kind union.
const requiredApplicationRuntimeModuleManifestKinds = ['serverRuntime', 'modelRuntime', 'jobRunnerRuntime', 'kubernetesClient', 'diagnostics', 'providerAdapter'] as const satisfies readonly ApplicationRuntimeModuleKind[];

export interface ApplicationRuntimeModuleContract {
  readonly apiVersion?: ApplicationRuntimeModuleApiVersion;
  readonly kind: ApplicationRuntimeModuleKind;
  readonly name: string;
  readonly artifact: ApplicationGeneratedArtifactRef;
  readonly interface?: ApplicationRuntimeModuleInterfaceContract;
  readonly entrypoint?: string;
  readonly exports?: readonly ApplicationRuntimeModuleExportContract[];
  readonly imports?: readonly ApplicationRuntimeModuleRef[];
  readonly diagnostics?: readonly ApplicationDiagnosticContract[];
}

export interface ApplicationRuntimeModuleManifestContract {
  readonly apiVersion: ApplicationRuntimeModuleApiVersion;
  readonly kind: 'GeneratedRuntimeModuleManifest';
  readonly modules: readonly ApplicationRuntimeModuleManifestEntryContract[];
}

export interface ApplicationRuntimeModuleManifestEntryContract {
  readonly apiVersion: ApplicationRuntimeModuleApiVersion;
  readonly kind: ApplicationRuntimeModuleKind;
  readonly name: string;
  readonly artifact: ApplicationGeneratedArtifactRef;
  readonly path: string;
  readonly entrypoint: string;
  readonly imports: readonly ApplicationRuntimeModuleRef[];
  readonly exports: readonly ApplicationRuntimeModuleExportContract[];
  readonly interface: ApplicationRuntimeModuleInterfaceContract;
}

export type ApplicationRuntimeModuleApiVersion = 'applik8s.runtime/v1alpha1';

export interface ApplicationRuntimeModuleExportContract {
  readonly name: string;
  readonly kind: 'function' | 'constant' | 'type';
  readonly stability: ApplicationGraphStability;
}

export interface ApplicationRuntimeModuleInterfaceContract {
  readonly apiVersion: ApplicationRuntimeModuleApiVersion;
  readonly imports: readonly ApplicationRuntimeModuleRef[];
  readonly exports: readonly ApplicationRuntimeModuleExportContract[];
  readonly diagnostics: 'structured' | 'none';
  readonly sourceMaps: 'required' | 'optional' | 'notApplicable';
  readonly failurePolicy: 'failClosed';
}

export interface ApplicationRuntimeModuleRef {
  readonly kind: ApplicationRuntimeModuleKind;
  readonly name: string;
}

export interface ApplicationV03PressureTestContract {
  readonly name: string;
  readonly graph: ApplicationGraphArtifactReference;
  readonly requiredNodes: readonly ApplicationGraphNodeKind[];
  readonly requiredProviders: readonly ApplicationProviderInterfaceKind[];
  readonly requiredRuntimeModules: readonly ApplicationRuntimeModuleKind[];
  readonly requiredOperationTargets: readonly ApplicationOperationTargetContract[];
  readonly requiredWatchScopes: readonly ApplicationWatchScopeLoweringContract[];
  readonly requiredMigrationDriftChecks: readonly ApplicationMigrationDriftCheckContract[];
  readonly requiredTransactionalDatabaseSemantics: readonly ApplicationTransactionalDatabaseSemanticsContract[];
  readonly requiredRuntimeModuleInterfaces: readonly ApplicationRuntimeModuleInterfaceContract[];
  readonly requiredProviderInterfaces: readonly ApplicationProviderInterfaceContract[];
  readonly providerCompatibility: ApplicationProviderCompatibilityMatrixContract;
  readonly requiredStatusOwnership: readonly ApplicationDurableStatusOwnershipContract[];
  readonly requiredStatusEvidence: ApplicationV03StatusEvidenceContract;
  readonly requiredTransactionalDatabaseEvidence: ApplicationV03TransactionalDatabaseEvidenceContract;
  readonly requiredOperationTargetEvidence: ApplicationV03OperationTargetEvidenceContract;
  readonly requiredWatchScopeEvidence: ApplicationV03WatchScopeEvidenceContract;
  readonly runtimeReleasePolicy: ApplicationV03RuntimeReleasePolicyContract;
  readonly liveValidation: ApplicationV03LiveValidationContract;
}

export interface ApplicationV03StatusEvidenceContract {
  readonly authoritativeStore: 'generatedStatusConfigMap' | 'applicationStatus';
  readonly appStatusProjection: 'bestEffortNonAuthoritative' | 'requiredAuthoritative';
  readonly history: 'boundedRetained';
  readonly conflictBehavior: 'resourceVersionRetryAndExhaustionDiagnostics';
  readonly restartSafety: 'required';
  readonly multiJobCronJobCoverage: 'required';
  readonly metrics: readonly ApplicationDurableStatusMergeMetric[];
  readonly liveGate: 'requiredBeforeAnnouncement';
  readonly failurePolicy: 'failClosed';
}

export interface ApplicationV03TransactionalDatabaseEvidenceContract {
  readonly generatedRuntimeParity: 'localGeneratedArtifactGate';
  readonly scriptRuntimeParity: 'localAndOptInLiveGate';
  readonly liveGate: 'requiredBeforeAnnouncement';
  readonly queryIndexConstraintCoverage: 'required';
  readonly transactionCoverage: 'required';
  readonly migrationDriftCoverage: 'required';
  readonly unsupportedSemantics: 'failClosed';
}

export interface ApplicationV03OperationTargetEvidenceContract {
  readonly contexts: readonly ApplicationOperationTargetExecutionContext[];
  readonly dryRunPlans: 'artifactBackedRequired';
  readonly generatedServerJobExecution: 'required';
  readonly typeKroExecution: 'required';
  readonly rbacAndFinalizerCoverage: 'required';
  readonly failurePolicy: 'failClosed';
}

export interface ApplicationV03WatchScopeEvidenceContract {
  readonly lowerings: readonly ApplicationWatchScopeLoweringContract['lowering'][];
  readonly unsupportedPredicateDiagnostics: 'generatedArtifactAndLiveGateRequired';
  readonly runtimeRouting: 'required';
  readonly broadWatchFallback: 'forbidden';
  readonly failurePolicy: 'failClosed';
}

export interface ApplicationV03RuntimeReleasePolicyContract {
  readonly startupPackageManager: false;
  readonly dependencyInstallation: 'buildTimeOnly';
  readonly runtimeImage: 'explicitImageOrGeneratedRecipe';
  readonly supplyChain: 'metadataOnlyUntilSignedArtifacts';
  readonly signedArtifacts: 'postV03';
  readonly failurePolicy: 'failClosed';
}

export interface ApplicationV03LiveValidationContract {
  readonly contextEnv: string;
  readonly requiredResources: readonly ApplicationResourceRef[];
  readonly requiredAssertions: readonly ApplicationV03LiveValidationAssertion[];
  readonly additionalAssertions?: readonly string[];
}

export type ApplicationDiagnosticEvent =
  | 'applik8s-transactional-database-missing-credentials'
  | 'applik8s-model-duplicate-key'
  | 'applik8s-model-migration-missing'
  | 'applik8s-model-migration-failed'
  | 'applik8s-model-migration-drift-detected'
  | 'applik8s-server-route-failure'
  | 'applik8s-server-request-failure'
  | 'applik8s-provider-requirement-missing'
  | 'applik8s-provider-requirement-ambiguous'
  | 'applik8s-job-terminal-failure'
  | 'applik8s-status-schema-pruned'
  | 'applik8s-status-projection-unavailable'
  | 'applik8s-operation-target-invalid'
  | 'applik8s-watch-scope-unlowerable'
  | 'applik8s-crd-schema-incompatible'
  | 'applik8s-route-action-failure';

export interface ApplicationDiagnosticContract {
  readonly event: ApplicationDiagnosticEvent;
  readonly severity: 'info' | 'warning' | 'error';
  readonly subject: ApplicationGraphNodeRef | ApplicationResourceRef;
  readonly reason: string;
  readonly message: string;
  readonly likelyFix?: string;
  readonly retryable?: boolean;
  readonly sourceLocation?: SourceLocation;
}

export interface ApplicationGraphEdge {
  readonly from: ApplicationGraphNodeRef;
  readonly to: ApplicationGraphNodeRef;
  readonly relationship: ApplicationGraphEdgeRelationship;
}

export type ApplicationGraphEdgeRelationship =
  | 'dependsOn'
  | 'provides'
  | 'reads'
  | 'projects'
  | 'hydrates'
  | 'queries'
  | 'writes'
  | 'watches'
  | 'emits'
  | 'owns'
  | 'exposes';

export interface ApplicationGraphCompatibility {
  readonly stablePublicApis: readonly string[];
  readonly documentedInternalContracts: readonly string[];
  readonly experimentalSurfaces: readonly string[];
  readonly postV3Surfaces: readonly string[];
  readonly labels: readonly ApplicationCompatibilityLabel[];
}

export type ApplicationCompatibilitySurface = 'stablePublicApi' | 'documentedInternalContract' | 'experimentalSurface' | 'postV3Surface';

export type ApplicationCompatibilityImplementation = 'implemented' | 'failClosedReserved' | 'externalAuthority' | 'postV3';

export interface ApplicationCompatibilityLabel {
  readonly name: string;
  readonly surface: ApplicationCompatibilitySurface;
  readonly since?: string;
  readonly rationale?: string;
  readonly implementation?: ApplicationCompatibilityImplementation;
  readonly diagnostics?: readonly ApplicationDiagnosticContract[];
}

export function isApplicationGraphNodeKind(value: string): value is ApplicationGraphNodeKind {
  // typecast: Array.includes needs an erased string array to test arbitrary input while preserving the type predicate result.
  return (applicationGraphNodeKinds as readonly string[]).includes(value);
}

export function isApplicationProviderInterfaceKind(value: string): value is ApplicationProviderInterfaceKind {
  // Provider packages intentionally register new interfaces without a core release.
  // The built-in tuple is the framework compatibility baseline, not a closed registry.
  return /^[A-Z][A-Za-z0-9]*$/.test(value);
}

export function normalizeApplicationGraph(graph: ApplicationGraph): ApplicationGraph {
  return normalizeApplicationGraphArtifact(graph);
}

export function serializeApplicationGraph(graph: ApplicationGraph): string {
  return serializeNormalizedApplicationGraph(graph);
}

export function validateApplicationGraph(graph: ApplicationGraph, requirements: readonly ApplicationProviderRequirement[] = []): readonly Diagnostic[] {
  return [
    ...validateApplicationGraphStructure(graph),
    ...validateApplicationGraphProviderBindings(graph, requirements),
  ];
}

export function validateApplicationGraphStructure(graph: ApplicationGraph): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const nodeIds = new Set<string>();
  const duplicateNodeIds = new Set<string>();

  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) {
      duplicateNodeIds.add(node.id);
      continue;
    }
    nodeIds.add(node.id);
  }

  for (const duplicateNodeId of [...duplicateNodeIds].sort(compareStrings)) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application graph contains duplicate node id ${duplicateNodeId}.`));
  }

  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.from.nodeId)) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application graph edge ${edge.from.nodeId}:${edge.relationship}:${edge.to.nodeId} references missing source node ${edge.from.nodeId}.`));
    }
    if (!nodeIds.has(edge.to.nodeId)) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application graph edge ${edge.from.nodeId}:${edge.relationship}:${edge.to.nodeId} references missing target node ${edge.to.nodeId}.`));
    }
  }

  for (const node of graph.nodes) {
    diagnostics.push(...applicationGraphNodeStructureDiagnostics(node, graph));
  }

  if (graph.foundation) {
    diagnostics.push(...validateApplicationFoundation({
      identities: graph.foundation.identities,
      provenance: graph.foundation.provenance,
      runtimeAccess: graph.foundation.runtimeAccess,
    }).map((diagnostic): Diagnostic => ({
      severity: diagnostic.severity,
      code: 'MANIFEST_INVALID',
      message: `[${diagnostic.code}] ${diagnostic.message}`,
    })));
    for (const requirement of graph.foundation.runtimeAccess) {
      if (!nodeIds.has(requirement.consumer.nodeId)) {
        diagnostics.push(applicationGraphStructureDiagnostic(
          `Application runtime-access requirement ${requirement.id} references missing consumer node ${requirement.consumer.nodeId}.`,
        ));
      }
    }
  }

  return diagnostics;
}

export function validateApplicationGraphCompatibilityPolicy(graph: ApplicationGraph): readonly Diagnostic[] {
  return validateApplicationGraphCompatibility(graph);
}

export function validateApplicationGraphProviderBindings(graph: ApplicationGraph, requirements: readonly ApplicationProviderRequirement[] = []): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const providers = graph.nodes.filter((node): node is ApplicationProviderNode => node.kind === 'provider');
  const providerById = new Map(providers.map((provider) => [provider.id, provider]));
  const graphRequirements = [...(graph.providerRequirements ?? []), ...requirements];
  const requirementIds = new Set(graphRequirements.map((requirement) => requirement.id));

  for (const node of graph.nodes) {
    for (const ref of uniqueApplicationProviderRefs(applicationProviderRefsForNode(node))) {
      diagnostics.push(...applicationProviderRefDiagnostics(`Application graph node ${node.id}`, ref, providerById));
    }
  }

  for (const requirement of graphRequirements) {
    diagnostics.push(...resolveApplicationGraphProviderRequirement(graph, requirement).diagnostics);
  }

  for (const binding of graph.providerBindings ?? []) {
    if (!requirementIds.has(binding.requirement)) {
      diagnostics.push(applicationProviderBindingDiagnostic(`Application provider binding ${binding.requirement} references a missing provider requirement.`));
    }
    diagnostics.push(...applicationProviderRefDiagnostics(`Application provider binding ${binding.requirement}`, binding.provider, providerById));
  }

  return diagnostics;
}

export function validateApplicationOperationTargetContract(target: ApplicationOperationTargetContract): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (target.operations.length === 0) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application operation target ${target.id} must declare at least one operation.`));
  }
  if (target.dryRun.supported && !target.dryRun.artifact) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application operation target ${target.id} supports dry-run but does not declare a dry-run artifact.`));
  }
  if (!target.dryRun.supported && target.dryRun.failurePolicy !== 'failClosed') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application operation target ${target.id} without dry-run support must fail closed.`));
  }
  if (target.finalizers.required && !target.finalizers.finalizer) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application operation target ${target.id} requires a finalizer but does not name one.`));
  }
  if (target.ownership.ownerReferences === 'required' && target.ownership.orphanPolicy === 'delete') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application operation target ${target.id} cannot require ownerReferences while deleting orphans implicitly.`));
  }
  if (target.permissions.length === 0 && target.diagnostics.length === 0) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application operation target ${target.id} must declare permissions or a fail-closed diagnostic.`));
  }
  if (target.lowering && target.lowering.failurePolicy !== 'failClosed') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application operation target ${target.id} lowering must fail closed.`));
  }
  if (target.execution) {
    if (target.execution.contexts.length === 0) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application operation target ${target.id} execution contract must declare at least one context.`));
    }
    if ((target.execution.contexts.includes('generatedServer') || target.execution.contexts.includes('generatedJob')) && (!target.dryRun.supported || !target.dryRun.artifact)) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application operation target ${target.id} used by generated server/job contexts must declare an artifact-backed dry-run plan.`));
    }
    if (target.execution.runtimeValidation !== 'beforeEffects') {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application operation target ${target.id} execution contract must validate before effects.`));
    }
    if (target.execution.failurePolicy !== 'failClosed') {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application operation target ${target.id} execution contract must fail closed.`));
    }
  }
  return diagnostics;
}

export function validateApplicationWatchScopeLoweringContract(contract: ApplicationWatchScopeLoweringContract): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (contract.lowering !== expectedApplicationWatchScopeLowering(contract.scope)) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application watch scope lowering ${contract.lowering} does not match scope kind ${contract.scope.kind}.`));
  }
  if (contract.failurePolicy !== 'failClosed') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application watch scope ${contract.scope.kind} must fail closed.`));
  }
  if (contract.permissions.length === 0 && contract.diagnostics.length === 0) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application watch scope ${contract.scope.kind} must declare permissions or a fail-closed diagnostic.`));
  }
  if (contract.scope.kind === 'finite' && contract.scope.refs.length === 0 && contract.diagnostics.length === 0) {
    diagnostics.push(applicationGraphStructureDiagnostic('Application finite watch scope must contain at least one ref.'));
  }
  if (contract.scope.kind === 'labelSelector' && Object.keys(contract.scope.labels).length === 0 && contract.diagnostics.length === 0) {
    diagnostics.push(applicationGraphStructureDiagnostic('Application label-selector watch scope must not use an empty selector.'));
  }
  if (contract.scope.kind === 'fieldSelector' && contract.scope.fieldSelector.trim() === '' && contract.diagnostics.length === 0) {
    diagnostics.push(applicationGraphStructureDiagnostic('Application field-selector watch scope must not use an empty field selector.'));
  }
  if (contract.scope.kind === 'mixed' && contract.scope.scopes.length === 0 && contract.diagnostics.length === 0) {
    diagnostics.push(applicationGraphStructureDiagnostic('Application mixed watch scope must contain at least one child scope.'));
  }
  return diagnostics;
}

export function validateApplicationMigrationDriftCheckContract(contract: ApplicationMigrationDriftCheckContract): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!contract.expectedRevision) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application migration drift check for ${contract.model.nodeId} must declare an expected revision.`));
  }
  if (contract.policy.driftPolicy === 'failClosed' && contract.diagnostics.length === 0) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application migration drift check for ${contract.model.nodeId} fails closed but has no diagnostic.`));
  }
  if (contract.policy.destructiveChangePolicy === 'reject' && !contract.failureModes.includes('destructiveChange')) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application migration drift check for ${contract.model.nodeId} rejects destructive changes but does not list destructiveChange as a failure mode.`));
  }
  if (contract.enforcement?.failurePolicy === 'diagnoseOnly' && contract.policy.driftPolicy === 'failClosed') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application migration drift check for ${contract.model.nodeId} cannot diagnose-only enforcement while policy is failClosed.`));
  }
  if (contract.enforcement && !contract.enforcement.historyTable) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application migration drift check for ${contract.model.nodeId} enforcement must declare a history table.`));
  }
  return diagnostics;
}

export function validateApplicationCrdSchemaCompatibilityContract(contract: ApplicationCrdSchemaCompatibilityContract): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!contract.currentVersion || !contract.nextVersion) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application CRD schema compatibility for ${contract.resource.kind} must declare currentVersion and nextVersion.`));
  }
  if (contract.policy.mode === 'additiveOnly') {
    const nonAdditive = contract.allowedChanges.filter((change) => change !== 'addOptionalField' && change !== 'widenType' && change !== 'addEnumValue');
    for (const change of nonAdditive) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application CRD schema compatibility for ${contract.resource.kind} additiveOnly policy must not allow ${change}.`));
    }
  }
  if (contract.policy.conversionWebhook === 'postV3Required' && !contract.postV3Requirements.includes('conversionWebhook')) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application CRD schema compatibility for ${contract.resource.kind} defers conversion webhooks but does not list conversionWebhook as a post-v0.3 requirement.`));
  }
  if (contract.policy.storedVersionMigration === 'postV3Required' && !contract.postV3Requirements.includes('storedVersionMigration')) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application CRD schema compatibility for ${contract.resource.kind} defers stored-version migration but does not list storedVersionMigration as a post-v0.3 requirement.`));
  }
  if (contract.policy.failurePolicy === 'failClosed' && contract.diagnostics.length === 0) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application CRD schema compatibility for ${contract.resource.kind} fails closed but has no diagnostic.`));
  }
  if (contract.rejectedChanges.length === 0 && contract.policy.mode !== 'externalAuthority') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application CRD schema compatibility for ${contract.resource.kind} must declare rejected changes unless an external authority owns compatibility.`));
  }
  return diagnostics;
}

export function validateApplicationDurableStatusOwnershipContract(contract: ApplicationDurableStatusOwnershipContract): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const kroStatusProjection = contract.appStatusSchemaContract?.ownership === 'kroStatusProjection';
  if (contract.primary === 'generatedStatusConfigMap' && !contract.durableStore) {
    diagnostics.push(applicationGraphStructureDiagnostic('Application durable status ownership using a generatedStatusConfigMap primary must declare durableStore.'));
  }
  if (contract.appStatusSchema === 'bestEffort' && contract.durableAuthority !== 'generatedStatusConfigMap') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application durable status ownership with bestEffort app status must use generatedStatusConfigMap as the durable authority.'));
  }
  if (contract.appStatusSchema === 'bestEffort' && contract.releasePolicy !== 'v0.3StableGeneratedStatusConfigMapFallback') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application durable status ownership with bestEffort app status must declare the v0.3 stable generatedStatusConfigMap fallback policy.'));
  }
  if (contract.appStatusSchema === 'bestEffort' && contract.applicationStatusProjection !== 'bestEffortNonAuthoritative') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application durable status ownership with bestEffort app status must declare applicationStatusProjection as bestEffortNonAuthoritative.'));
  }
  if (contract.appStatusSchema === 'required' && !kroStatusProjection && contract.durableAuthority !== 'applicationStatus') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application durable status ownership with required app status schema must use applicationStatus as the durable authority.'));
  }
  if (contract.appStatusSchema === 'required' && !kroStatusProjection && contract.releasePolicy !== 'appStatusSchemaRequired') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application durable status ownership with required app status schema must declare appStatusSchemaRequired release policy.'));
  }
  if (kroStatusProjection && contract.releasePolicy !== 'kroStatusProjectionRequired') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application KRO-owned status projection must declare kroStatusProjectionRequired release policy.'));
  }
  if (kroStatusProjection && contract.durableAuthority !== 'generatedStatusConfigMap') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application KRO-owned status projection must use the runtime-created generatedStatusConfigMap as its durable source.'));
  }
  if (contract.appStatusSchema === 'required' && contract.applicationStatusProjection !== 'requiredAuthoritative') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application durable status ownership with required app status schema must declare applicationStatusProjection as requiredAuthoritative.'));
  }
  if (contract.appStatusSchema === 'unsupported' && contract.primary === 'applicationStatus') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application durable status ownership cannot use applicationStatus as primary when appStatusSchema is unsupported.'));
  }
  if (contract.appStatusSchema === 'unsupported' && contract.applicationStatusProjection !== 'unsupported') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application durable status ownership without app status schema support must declare applicationStatusProjection as unsupported.'));
  }
  if (contract.appStatusSchema === 'bestEffort' && contract.fallback !== 'generatedStatusConfigMap') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application durable status ownership with bestEffort app status must declare generatedStatusConfigMap fallback.'));
  }
  if (contract.appStatusSchema === 'bestEffort' && contract.fallback === 'generatedStatusConfigMap' && !contract.durableStore) {
    diagnostics.push(applicationGraphStructureDiagnostic('Application durable status ownership with bestEffort app status must name the generatedStatusConfigMap durableStore.'));
  }
  if ((contract.appStatusSchema === 'bestEffort' || contract.appStatusSchema === 'required') && !contract.appStatusSchemaContract) {
    diagnostics.push(applicationGraphStructureDiagnostic('Application durable status ownership using application status must declare appStatusSchemaContract.'));
  }
  if ((contract.appStatusSchema === 'bestEffort' || (contract.appStatusSchema === 'required' && !kroStatusProjection)) && !contract.appStatusWrite) {
    diagnostics.push(applicationGraphStructureDiagnostic('Application durable status ownership using application status must declare appStatusWrite policy.'));
  }
  if (contract.appStatusSchema === 'bestEffort' && contract.appStatusWrite?.mode !== 'bestEffortPatch') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application durable status ownership with bestEffort app status must declare bestEffortPatch appStatusWrite mode.'));
  }
  if (contract.appStatusSchema === 'bestEffort' && contract.appStatusWrite?.failureBehavior !== 'diagnoseAndContinueWithDurableFallback') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application durable status ownership with bestEffort app status must diagnose and continue with durable fallback on app status patch failure.'));
  }
  if (contract.appStatusSchema === 'bestEffort' && contract.appStatusWrite?.durableFallback !== 'generatedStatusConfigMap') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application durable status ownership with bestEffort app status must declare generatedStatusConfigMap as the appStatusWrite durable fallback.'));
  }
  if (contract.appStatusSchema === 'required' && !kroStatusProjection && contract.appStatusWrite?.mode !== 'requiredPatch') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application durable status ownership with required app status schema must declare requiredPatch appStatusWrite mode.'));
  }
  if (contract.appStatusSchema === 'required' && !kroStatusProjection && contract.appStatusWrite?.failureBehavior !== 'failClosed') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application durable status ownership with required app status schema must fail closed on app status patch failure.'));
  }
  if (contract.appStatusWrite) {
    diagnostics.push(...validateApplicationAppStatusWritePolicyContract(contract.appStatusWrite));
  }
  if (contract.appStatusSchema === 'bestEffort' && contract.appStatusSchemaContract?.pruningBehavior !== 'fallbackToGeneratedStatusConfigMap') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application durable status ownership with bestEffort app status must declare fallbackToGeneratedStatusConfigMap pruning behavior.'));
  }
  if (contract.appStatusSchema === 'required' && !kroStatusProjection && contract.appStatusSchemaContract?.ownership !== 'runtimePatchRequired') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application durable status ownership with required app status schema must declare runtimePatchRequired ownership.'));
  }
  if (kroStatusProjection && contract.appStatusWrite) {
    diagnostics.push(applicationGraphStructureDiagnostic('Application KRO-owned status projection must not declare a competing runtime app-status patch writer.'));
  }
  if (kroStatusProjection && contract.appStatusSchemaContract?.pruningBehavior !== 'failClosed') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application KRO-owned status projection must fail closed when the generated app status schema cannot be admitted.'));
  }
  if ((contract.primary === 'generatedStatusConfigMap' || contract.fallback === 'generatedStatusConfigMap') && !contract.fallbackStore) {
    diagnostics.push(applicationGraphStructureDiagnostic('Application durable status ownership using generatedStatusConfigMap must declare fallbackStore data ownership.'));
  }
  if (contract.durableAuthority === 'generatedStatusConfigMap' && !contract.concurrency) {
    diagnostics.push(applicationGraphStructureDiagnostic('Application durable status ownership using generatedStatusConfigMap as durable authority must declare concurrency policy.'));
  }
  if (contract.durableAuthority === 'generatedStatusConfigMap' && !contract.observability) {
    diagnostics.push(applicationGraphStructureDiagnostic('Application durable status ownership using generatedStatusConfigMap as durable authority must declare observability policy.'));
  }
  if (contract.appStatusSchemaContract) {
    diagnostics.push(...validateApplicationAppStatusSchemaContract(contract.appStatusSchemaContract));
  }
  if (contract.concurrency) {
    diagnostics.push(...validateApplicationDurableStatusConcurrencyContract(contract.concurrency));
  }
  if (contract.observability) {
    diagnostics.push(...validateApplicationDurableStatusObservabilityContract(contract.observability));
  }
  if (contract.fallbackStore) {
    diagnostics.push(...validateApplicationGeneratedStatusConfigMapContract(contract.fallbackStore));
    if (contract.conflictPolicy === 'mergePatch' && contract.fallbackStore.updateStrategy !== 'resourceVersionMergePatch') {
      diagnostics.push(applicationGraphStructureDiagnostic('Application durable status ownership mergePatch conflict policy must use resourceVersionMergePatch fallback store updates.'));
    }
  }
  if (contract.conflictPolicy === 'failClosed' && contract.diagnostics.length === 0) {
    diagnostics.push(applicationGraphStructureDiagnostic('Application durable status ownership with failClosed conflict policy must declare diagnostics.'));
  }
  return diagnostics;
}

function validateApplicationDurableStatusConcurrencyContract(contract: ApplicationDurableStatusConcurrencyContract): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (contract.updateStrategy !== 'resourceVersionRetry') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application durable status concurrency must use resourceVersionRetry updates.'));
  }
  if (contract.maxAttempts < 2) {
    diagnostics.push(applicationGraphStructureDiagnostic('Application durable status concurrency requires maxAttempts >= 2.'));
  }
  if (contract.retryDiagnostic !== 'applik8s-job-status-reconciler-status-store-conflict-retry') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application durable status concurrency retryDiagnostic must match the generated status store conflict retry event.'));
  }
  if (contract.retryExhaustedDiagnostic !== 'applik8s-job-status-reconciler-status-store-conflict-exhausted') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application durable status concurrency retryExhaustedDiagnostic must match the generated status store conflict exhaustion event.'));
  }
  if (contract.failurePolicy !== 'failClosed') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application durable status concurrency failurePolicy must fail closed after retry exhaustion.'));
  }
  return diagnostics;
}

function validateApplicationAppStatusWritePolicyContract(contract: ApplicationAppStatusWritePolicyContract): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (contract.failureDiagnostic !== 'applik8s-job-status-reconciler-app-status-error') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application app status write failureDiagnostic must match the generated app status patch error event.'));
  }
  if (contract.mode === 'bestEffortPatch' && contract.failureBehavior !== 'diagnoseAndContinueWithDurableFallback') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application app status write bestEffortPatch mode must diagnose and continue with durable fallback.'));
  }
  if (contract.mode === 'requiredPatch' && contract.failureBehavior !== 'failClosed') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application app status write requiredPatch mode must fail closed.'));
  }
  if (contract.failureBehavior === 'diagnoseAndContinueWithDurableFallback' && contract.durableFallback !== 'generatedStatusConfigMap') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application app status write durable fallback behavior must name generatedStatusConfigMap.'));
  }
  return diagnostics;
}

function validateApplicationDurableStatusObservabilityContract(contract: ApplicationDurableStatusObservabilityContract): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (contract.mergeEvent !== 'applik8s-job-status-reconciler-status-store-merged') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application durable status observability mergeEvent must match the generated status store merge event.'));
  }
  if (contract.conflictRetryEvent !== 'applik8s-job-status-reconciler-status-store-conflict-retry') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application durable status observability conflictRetryEvent must match the generated status store conflict retry event.'));
  }
  const metrics = new Set(contract.metrics);
  for (const metric of ['acceptedUpdates', 'rejectedUpdates', 'conflictUpdates', 'observedJobs', 'retainedJobs'] satisfies readonly ApplicationDurableStatusMergeMetric[]) {
    if (!metrics.has(metric)) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application durable status observability must declare merge metric ${metric}.`));
    }
  }
  return diagnostics;
}

function validateApplicationAppStatusSchemaContract(contract: ApplicationAppStatusSchemaContract): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (contract.statusRoot !== 'status.applik8s') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application app status schema contract must use status.applik8s as the generated status root.'));
  }
  if (contract.jobsPath !== 'status.applik8s.jobs') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application app status schema contract must use status.applik8s.jobs for generated job status.'));
  }
  if (contract.schema !== 'generatedJobStatusMap') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application app status schema contract must describe generatedJobStatusMap schema.'));
  }
  if (contract.ownership !== 'runtimePatchBestEffort' && contract.ownership !== 'runtimePatchRequired' && contract.ownership !== 'kroStatusProjection') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application app status schema contract must declare runtime patch or KRO projection ownership.'));
  }
  return diagnostics;
}

function validateApplicationGeneratedStatusConfigMapContract(contract: ApplicationGeneratedStatusConfigMapContract): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const keys = new Set(contract.dataKeys);
  for (const key of ['status.json', 'applik8s-jobs.json', 'history.json', 'conflicts.json', 'updatedAt'] satisfies readonly ApplicationGeneratedStatusConfigMapDataKey[]) {
    if (!keys.has(key)) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application generated status ConfigMap fallback must declare runtime-owned data key ${key}.`));
    }
  }
  if (contract.objectOwnership !== 'generatedResource' && contract.objectOwnership !== 'runtimeCreatedResource') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application generated status ConfigMap object must be generated or runtime-created.'));
  }
  if (contract.dataOwnership !== 'runtime') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application generated status ConfigMap data must be runtime-owned.'));
  }
  if (contract.updateStrategy !== 'resourceVersionMergePatch') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application generated status ConfigMap fallback must use resourceVersionMergePatch updates.'));
  }
  if (contract.history.key !== 'history.json' || contract.history.maxEntries < 1) {
    diagnostics.push(applicationGraphStructureDiagnostic('Application generated status ConfigMap history contract must use history.json with maxEntries >= 1.'));
  }
  if (contract.history.terminalRetention === 'ttl' && contract.history.ttlSeconds === undefined) {
    diagnostics.push(applicationGraphStructureDiagnostic('Application generated status ConfigMap ttl history retention requires ttlSeconds.'));
  }
  if (contract.conflicts.key !== 'conflicts.json' || contract.conflicts.maxEntries < 1) {
    diagnostics.push(applicationGraphStructureDiagnostic('Application generated status ConfigMap conflict contract must use conflicts.json with maxEntries >= 1.'));
  }
  return diagnostics;
}

export function validateApplicationTransactionalDatabaseSemanticsContract(contract: ApplicationTransactionalDatabaseSemanticsContract): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (contract.generatedRuntimeParity !== 'required') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application TransactionalDatabase semantics must require generated runtime parity.'));
  }
  if (contract.scriptRuntimeParity !== 'required' && contract.scriptRuntimeParity !== 'notSupported') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application TransactionalDatabase semantics must declare script runtime parity.'));
  }
  if (contract.query.defaultLimit < 1 || contract.query.maxLimit < contract.query.defaultLimit) {
    diagnostics.push(applicationGraphStructureDiagnostic('Application TransactionalDatabase query semantics require maxLimit >= defaultLimit >= 1.'));
  }
  if (!contract.indexes.partitionRequired) {
    diagnostics.push(applicationGraphStructureDiagnostic('Application TransactionalDatabase index semantics must require explicit partitions for v0.3.'));
  }
  if (contract.indexes.orderBy !== 'declaredIndexFieldsOnly') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application TransactionalDatabase index ordering must be limited to declared index fields.'));
  }
  if (contract.constraints.duplicateKeyDiagnostic !== 'applik8s-model-duplicate-key') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application TransactionalDatabase duplicate constraint semantics must use applik8s-model-duplicate-key diagnostics.'));
  }
  if (contract.transactions.singleOperationAtomicity !== 'databaseStatement') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application TransactionalDatabase transaction semantics must declare database statement atomicity for single operations.'));
  }
  if (contract.transactions.multiOperationApi !== 'absentFromPublicApi' && contract.transactions.multiOperationApi !== 'implemented') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application TransactionalDatabase transaction semantics must declare whether a multi-operation API is public.'));
  }
  if (contract.transactions.multiOperationApi === 'absentFromPublicApi' && contract.transactions.multiOperationBehavior !== 'methodAbsent') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application TransactionalDatabase absent transaction API must leave multi-operation transaction methods absent.'));
  }
  if (contract.transactions.declaration === 'unsupported' && contract.transactions.multiOperationApi === 'implemented' && contract.transactions.multiOperationBehavior !== 'failClosed') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application TransactionalDatabase unsupported transaction declarations must fail closed when the public transaction API is present.'));
  }
  if (contract.transactions.declaration !== 'unsupported' && contract.transactions.multiOperationApi === 'implemented' && contract.transactions.multiOperationBehavior !== 'runtimeTransaction') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application TransactionalDatabase implemented transaction API must declare runtime transaction behavior.'));
  }
  if (!contract.migrationHistory.tableName || !contract.migrationHistory.revisionColumn || !contract.migrationHistory.appliedAtColumn) {
    diagnostics.push(applicationGraphStructureDiagnostic('Application TransactionalDatabase migration history semantics must declare table, revision, and applied-at columns.'));
  }
  if (contract.retention.mode === 'ttl' && contract.retention.ttlSeconds === undefined) {
    diagnostics.push(applicationGraphStructureDiagnostic('Application TransactionalDatabase ttl retention semantics require ttlSeconds.'));
  }
  return diagnostics;
}

export function validateApplicationRuntimeModuleInterfaceContract(contract: ApplicationRuntimeModuleInterfaceContract): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (contract.apiVersion !== 'applik8s.runtime/v1alpha1') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application runtime module interface must declare apiVersion applik8s.runtime/v1alpha1.'));
  }
  if (contract.failurePolicy !== 'failClosed') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application runtime module interface must fail closed.'));
  }
  if (contract.exports.length === 0) {
    diagnostics.push(applicationGraphStructureDiagnostic('Application runtime module interface must declare at least one export.'));
  }
  return diagnostics;
}

export function validateApplicationRuntimeModuleManifestContract(contract: ApplicationRuntimeModuleManifestContract): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (contract.apiVersion !== 'applik8s.runtime/v1alpha1') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application runtime module manifest must declare apiVersion applik8s.runtime/v1alpha1.'));
  }
  if (contract.kind !== 'GeneratedRuntimeModuleManifest') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application runtime module manifest must use kind GeneratedRuntimeModuleManifest.'));
  }
  if (contract.modules.length === 0) {
    diagnostics.push(applicationGraphStructureDiagnostic('Application runtime module manifest must declare at least one module.'));
  }
  const seenKinds = new Set<ApplicationRuntimeModuleKind>();
  for (const module of contract.modules) {
    if (seenKinds.has(module.kind)) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application runtime module manifest declares duplicate ${module.kind} module.`));
    }
    seenKinds.add(module.kind);
    if (module.apiVersion !== contract.apiVersion) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application runtime module ${module.kind} apiVersion must match the manifest apiVersion.`));
    }
    if (!module.name || module.name.trim().length === 0) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application runtime module ${module.kind} must declare a stable module name.`));
    }
    if (module.artifact.kind !== 'runtimeModule') {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application runtime module ${module.kind} artifact must be a runtimeModule artifact.`));
    }
    if (module.artifact.path !== module.path) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application runtime module ${module.kind} artifact path must match its manifest path.`));
    }
    if (!module.path.endsWith('.mjs')) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application runtime module ${module.kind} path must point to an .mjs artifact.`));
    }
    if (!module.entrypoint) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application runtime module ${module.kind} must declare an entrypoint.`));
    }
    if (!module.exports.some((moduleExport) => moduleExport.name === module.entrypoint)) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application runtime module ${module.kind} must export its entrypoint ${module.entrypoint}.`));
    }
    if (JSON.stringify(module.interface.imports) !== JSON.stringify(module.imports)) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application runtime module ${module.kind} interface imports must match manifest imports.`));
    }
    if (JSON.stringify(module.interface.exports) !== JSON.stringify(module.exports)) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application runtime module ${module.kind} interface exports must match manifest exports.`));
    }
    diagnostics.push(...validateApplicationRuntimeModuleInterfaceContract(module.interface));
  }
  for (const required of requiredApplicationRuntimeModuleManifestKinds) {
    if (!seenKinds.has(required)) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application runtime module manifest is missing required ${required} module.`));
    }
  }
  return diagnostics;
}

export function validateApplicationProviderInterfaceContract(contract: ApplicationProviderInterfaceContract): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (contract.apiVersion && contract.apiVersion !== 'applik8s.provider/v1alpha1') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application provider interface ${contract.interface} uses unsupported contract apiVersion ${contract.apiVersion}.`));
  }
  if (contract.apiVersion && !contract.version?.match(/^v[1-9][0-9]*(?:(?:alpha|beta)[1-9][0-9]*)?$/)) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application provider interface ${contract.interface} must declare an explicit version.`));
  }
  if (contract.surface === 'stablePublicApi' && contract.support === 'failClosedReserved' && contract.diagnostics.length === 0) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application provider interface ${contract.interface} is stable but fail-closed reserved without diagnostics.`));
  }
  if (contract.support === 'failClosedReserved' && !contract.diagnostics.some((diagnostic) => diagnostic.event === 'applik8s-provider-requirement-missing')) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application provider interface ${contract.interface} fail-closed reservation must use provider requirement diagnostics.`));
  }
  return diagnostics;
}

export function validateApplicationProviderCompatibilityMatrixContract(contract: ApplicationProviderCompatibilityMatrixContract): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (contract.apiVersion !== 'applik8s.providerCompatibility/v1alpha1') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application provider compatibility matrix must declare apiVersion applik8s.providerCompatibility/v1alpha1.'));
  }
  const declared = new Map<ApplicationProviderInterfaceKind, ApplicationProviderInterfaceContract>();
  for (const provider of contract.providers) {
    if (declared.has(provider.interface)) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application provider compatibility matrix declares ${provider.interface} more than once.`));
    }
    declared.set(provider.interface, provider);
    diagnostics.push(...validateApplicationProviderInterfaceContract(provider));
  }
  for (const provider of applicationProviderInterfaceKinds) {
    if (!declared.has(provider)) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application provider compatibility matrix must label ${provider}.`));
    }
  }
  for (const provider of contract.requiredForV03) {
    if (!declared.has(provider)) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application provider compatibility matrix marks ${provider} required for v0.3 but does not declare support.`));
    }
  }
  for (const provider of applicationV03ProviderInterfaceKinds) {
    if (!contract.requiredForV03.includes(provider)) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application provider compatibility matrix must mark ${provider} required for v0.3.`));
    }
  }
  return diagnostics;
}

export function validateApplicationJobStatusLifecycleContract(contract: ApplicationJobStatusLifecycleContract): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [...validateApplicationDurableStatusOwnershipContract(contract.ownership)];
  if (contract.conflictPolicy !== contract.ownership.conflictPolicy) {
    diagnostics.push(applicationGraphStructureDiagnostic('Application job status lifecycle conflictPolicy must match durable status ownership conflictPolicy.'));
  }
  if (contract.conflictResolution.staleObservedGeneration !== 'reject') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application job status lifecycle must reject stale observedGeneration updates.'));
  }
  if (contract.conflictResolution.completedIdempotencyKey !== 'retainCompleted') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application job status lifecycle must retain completed status for the same idempotency key.'));
  }
  if (contract.conflictResolution.diagnosticsStore !== 'conflicts.json' && contract.conflictResolution.diagnosticsStore !== 'applicationStatus') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application job status lifecycle conflict diagnostics must declare conflicts.json or applicationStatus.'));
  }
  if (contract.historyRetention.maxEntries < 1) {
    diagnostics.push(applicationGraphStructureDiagnostic('Application job status lifecycle history retention requires maxEntries >= 1.'));
  }
  if (contract.historyRetention.terminalRetention === 'ttl' && contract.historyRetention.ttlSeconds === undefined) {
    diagnostics.push(applicationGraphStructureDiagnostic('Application job status lifecycle ttl retention requires ttlSeconds.'));
  }
  if (contract.terminalFailure.condition !== 'Failed') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application job status lifecycle terminal failure condition must be Failed.'));
  }
  if (contract.terminalFailure.partialEffects !== 'required') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application job status lifecycle terminal failures must include partial effects.'));
  }
  if (contract.terminalFailure.diagnostics !== 'required') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application job status lifecycle terminal failures must include diagnostics.'));
  }
  if (contract.terminalFailure.history !== contract.historyRetention.terminalRetention) {
    diagnostics.push(applicationGraphStructureDiagnostic('Application job status lifecycle terminal failure history policy must match historyRetention.terminalRetention.'));
  }
  if (contract.fallback === 'generatedStatusConfigMap' && contract.ownership.fallback !== 'generatedStatusConfigMap' && contract.ownership.primary !== 'generatedStatusConfigMap' && contract.ownership.durableAuthority !== 'generatedStatusConfigMap') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application job status lifecycle ConfigMap fallback must be reflected in durable status ownership.'));
  }
  if (contract.ownership.fallbackStore && contract.ownership.fallbackStore.history.maxEntries !== contract.historyRetention.maxEntries) {
    diagnostics.push(applicationGraphStructureDiagnostic('Application job status lifecycle history retention must match generated status ConfigMap history maxEntries.'));
  }
  if (contract.ownership.fallbackStore && contract.ownership.fallbackStore.history.terminalRetention !== contract.historyRetention.terminalRetention) {
    diagnostics.push(applicationGraphStructureDiagnostic('Application job status lifecycle terminal history retention must match generated status ConfigMap history retention.'));
  }
  if (contract.conflictResolution.diagnosticsStore === 'conflicts.json' && contract.ownership.fallbackStore?.conflicts.key !== 'conflicts.json') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application job status lifecycle conflicts.json diagnostics must be owned by generated status ConfigMap fallback.'));
  }
  return diagnostics;
}

export function validateApplicationV03PressureTestContract(contract: ApplicationV03PressureTestContract): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!contract.graph.path || !contract.graph.digest) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${contract.name} must reference an emitted application graph artifact path and digest.`));
  }
  // typecast: these literal checklists are intentionally kept as narrow tuples while checked against the public contract unions.
  const requiredNodeKinds = ['model', 'server', 'workloadJob', 'provider'] as const satisfies readonly ApplicationGraphNodeKind[];
  // typecast: these literal checklists are intentionally kept as narrow tuples while checked against the public contract unions.
  const requiredProviders = applicationV03ProviderInterfaceKinds;
  // typecast: these literal checklists are intentionally kept as narrow tuples while checked against the public contract unions.
  const requiredRuntimeModules = ['serverRuntime', 'modelRuntime', 'jobRunnerRuntime', 'kubernetesClient', 'diagnostics', 'providerAdapter'] as const satisfies readonly ApplicationRuntimeModuleKind[];
  for (const nodeKind of requiredNodeKinds) {
    if (!contract.requiredNodes.includes(nodeKind)) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${contract.name} must require ${nodeKind} nodes.`));
    }
  }
  for (const provider of requiredProviders) {
    if (!contract.requiredProviders.includes(provider)) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${contract.name} must require ${provider}.`));
    }
  }
  for (const runtimeModule of requiredRuntimeModules) {
    if (!contract.requiredRuntimeModules.includes(runtimeModule)) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${contract.name} must require ${runtimeModule}.`));
    }
  }
  for (const target of contract.requiredOperationTargets) {
    diagnostics.push(...validateApplicationOperationTargetContract(target));
  }
  for (const scope of contract.requiredWatchScopes) {
    diagnostics.push(...validateApplicationWatchScopeLoweringContract(scope));
  }
  if (!contract.requiredWatchScopes.some((scope) => scope.diagnostics.some((diagnostic) => diagnostic.event === 'applik8s-watch-scope-unlowerable'))) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${contract.name} must include fail-closed evidence for unlowerable watch scopes.`));
  }
  for (const driftCheck of contract.requiredMigrationDriftChecks) {
    diagnostics.push(...validateApplicationMigrationDriftCheckContract(driftCheck));
  }
  if ((contract.requiredMigrationDriftChecks.length ?? 0) === 0) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${contract.name} must require migration drift checks.`));
  }
  if ((contract.requiredTransactionalDatabaseSemantics?.length ?? 0) === 0) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${contract.name} must require TransactionalDatabase semantic conformance.`));
  }
  for (const semantics of contract.requiredTransactionalDatabaseSemantics ?? []) {
    diagnostics.push(...validateApplicationTransactionalDatabaseSemanticsContract(semantics));
  }
  if (contract.requiredTransactionalDatabaseEvidence.scriptRuntimeParity === 'localAndOptInLiveGate' && !(contract.requiredTransactionalDatabaseSemantics ?? []).some((semantics) => semantics.scriptRuntimeParity === 'required')) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${contract.name} TransactionalDatabase evidence requires script-runtime parity but no TransactionalDatabase semantics require it.`));
  }
  if (contract.requiredTransactionalDatabaseEvidence.transactionCoverage === 'required' && !(contract.requiredTransactionalDatabaseSemantics ?? []).some((semantics) => semantics.transactions.multiOperationApi === 'implemented' && semantics.transactions.multiOperationBehavior === 'runtimeTransaction')) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${contract.name} TransactionalDatabase evidence requires transaction coverage but no TransactionalDatabase semantics declare runtime transactions.`));
  }
  if ((contract.requiredRuntimeModuleInterfaces?.length ?? 0) === 0) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${contract.name} must require runtime module interface contracts.`));
  }
  for (const moduleInterface of contract.requiredRuntimeModuleInterfaces ?? []) {
    diagnostics.push(...validateApplicationRuntimeModuleInterfaceContract(moduleInterface));
  }
  const declaredProviderInterfaces = new Set((contract.requiredProviderInterfaces ?? []).map((providerInterface) => providerInterface.interface));
  for (const provider of contract.requiredProviders) {
    if (!declaredProviderInterfaces.has(provider)) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${contract.name} must declare provider interface support for ${provider}.`));
    }
  }
  for (const providerInterface of contract.requiredProviderInterfaces ?? []) {
    diagnostics.push(...validateApplicationProviderInterfaceContract(providerInterface));
  }
  diagnostics.push(...validateApplicationProviderCompatibilityMatrixContract(contract.providerCompatibility));
  const matrixProviders = new Set(contract.providerCompatibility.providers.map((provider) => provider.interface));
  for (const provider of contract.requiredProviders) {
    if (!matrixProviders.has(provider)) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${contract.name} provider compatibility matrix must include ${provider}.`));
    }
  }
  for (const provider of contract.providerCompatibility.requiredForV03) {
    if (!contract.requiredProviders.includes(provider)) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${contract.name} must require provider ${provider} because the compatibility matrix marks it required for v0.3.`));
    }
  }
  if ((contract.requiredStatusOwnership?.length ?? 0) === 0) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${contract.name} must require durable generated-job status ownership.`));
  }
  for (const statusOwnership of contract.requiredStatusOwnership ?? []) {
    diagnostics.push(...validateApplicationDurableStatusOwnershipContract(statusOwnership));
    if (statusOwnership.primary !== contract.requiredStatusEvidence.authoritativeStore) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${contract.name} authoritative status evidence must match the primary status read surface.`));
    }
    if (statusOwnership.applicationStatusProjection !== contract.requiredStatusEvidence.appStatusProjection) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${contract.name} durable status evidence projection must match required status ownership.`));
    }
  }
  const executionContexts = new Set(contract.requiredOperationTargets.flatMap((target) => target.execution?.contexts ?? []));
  for (const context of contract.requiredOperationTargetEvidence.contexts) {
    if (!executionContexts.has(context)) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${contract.name} must include operation-target execution contract for ${context}.`));
    }
  }
  diagnostics.push(...validateApplicationV03StatusEvidenceContract(contract.name, contract.requiredStatusEvidence));
  diagnostics.push(...validateApplicationV03TransactionalDatabaseEvidenceContract(contract.name, contract.requiredTransactionalDatabaseEvidence));
  diagnostics.push(...validateApplicationV03OperationTargetEvidenceContract(contract.name, contract.requiredOperationTargetEvidence));
  diagnostics.push(...validateApplicationV03WatchScopeEvidenceContract(contract.name, contract.requiredWatchScopeEvidence));
  diagnostics.push(...validateApplicationV03RuntimeReleasePolicyContract(contract.name, contract.runtimeReleasePolicy));
  if (!contract.liveValidation) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${contract.name} must declare opt-in live validation evidence.`));
  } else {
    if (!contract.liveValidation.contextEnv) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${contract.name} live validation must name the context environment variable.`));
    }
    if (contract.liveValidation.requiredResources.length === 0) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${contract.name} live validation must require Kubernetes resources.`));
    }
    for (const assertion of applicationV03LiveValidationAssertions) {
      if (!contract.liveValidation.requiredAssertions.includes(assertion)) {
        diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${contract.name} live validation must assert ${assertion}.`));
      }
    }
  }
  return diagnostics;
}

function validateApplicationV03StatusEvidenceContract(name: string, evidence: ApplicationV03StatusEvidenceContract): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (evidence.authoritativeStore !== 'generatedStatusConfigMap' && evidence.authoritativeStore !== 'applicationStatus') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${name} must declare a durable status authority.`));
  }
  if (evidence.history !== 'boundedRetained') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${name} durable status evidence must require bounded retained history.`));
  }
  if (evidence.conflictBehavior !== 'resourceVersionRetryAndExhaustionDiagnostics') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${name} durable status evidence must require resourceVersion retry and exhaustion diagnostics.`));
  }
  if (evidence.restartSafety !== 'required') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${name} durable status evidence must require restart safety.`));
  }
  if (evidence.multiJobCronJobCoverage !== 'required') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${name} durable status evidence must require multi-job and CronJob coverage.`));
  }
  for (const metric of ['acceptedUpdates', 'rejectedUpdates', 'conflictUpdates', 'observedJobs', 'retainedJobs'] satisfies readonly ApplicationDurableStatusMergeMetric[]) {
    if (!evidence.metrics.includes(metric)) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${name} durable status evidence must include metric ${metric}.`));
    }
  }
  if (evidence.liveGate !== 'requiredBeforeAnnouncement') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${name} durable status evidence must require a live gate before announcement.`));
  }
  if (evidence.failurePolicy !== 'failClosed') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${name} durable status evidence must fail closed.`));
  }
  return diagnostics;
}

function validateApplicationV03TransactionalDatabaseEvidenceContract(name: string, evidence: ApplicationV03TransactionalDatabaseEvidenceContract): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (evidence.generatedRuntimeParity !== 'localGeneratedArtifactGate') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${name} TransactionalDatabase evidence must require local generated-artifact parity.`));
  }
  if (evidence.scriptRuntimeParity !== 'localAndOptInLiveGate') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${name} TransactionalDatabase evidence must require local and opt-in live script-runtime parity.`));
  }
  if (evidence.liveGate !== 'requiredBeforeAnnouncement') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${name} TransactionalDatabase evidence must require a live gate before announcement.`));
  }
  if (evidence.queryIndexConstraintCoverage !== 'required') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${name} TransactionalDatabase evidence must require query, index, and constraint coverage.`));
  }
  if (evidence.transactionCoverage !== 'required') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${name} TransactionalDatabase evidence must require transaction coverage.`));
  }
  if (evidence.migrationDriftCoverage !== 'required') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${name} TransactionalDatabase evidence must require migration drift coverage.`));
  }
  if (evidence.unsupportedSemantics !== 'failClosed') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${name} TransactionalDatabase evidence must fail closed for unsupported semantics.`));
  }
  return diagnostics;
}

function validateApplicationV03OperationTargetEvidenceContract(name: string, evidence: ApplicationV03OperationTargetEvidenceContract): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const context of ['handler', 'generatedServer', 'generatedJob', 'typeKro'] satisfies readonly ApplicationOperationTargetExecutionContext[]) {
    if (!evidence.contexts.includes(context)) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${name} operation-target evidence must cover ${context}.`));
    }
  }
  if (evidence.dryRunPlans !== 'artifactBackedRequired') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${name} operation-target evidence must require artifact-backed dry-run plans.`));
  }
  if (evidence.generatedServerJobExecution !== 'required') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${name} operation-target evidence must require generated server/job execution coverage.`));
  }
  if (evidence.typeKroExecution !== 'required') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${name} operation-target evidence must require TypeKro execution coverage.`));
  }
  if (evidence.rbacAndFinalizerCoverage !== 'required') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${name} operation-target evidence must require RBAC and finalizer coverage.`));
  }
  if (evidence.failurePolicy !== 'failClosed') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${name} operation-target evidence must fail closed.`));
  }
  return diagnostics;
}

function validateApplicationV03WatchScopeEvidenceContract(name: string, evidence: ApplicationV03WatchScopeEvidenceContract): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const lowering of ['exact', 'finite', 'labelSelector', 'fieldSelector', 'mixed'] satisfies readonly ApplicationWatchScopeLoweringContract['lowering'][]) {
    if (!evidence.lowerings.includes(lowering)) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${name} watch-scope evidence must cover ${lowering}.`));
    }
  }
  if (evidence.unsupportedPredicateDiagnostics !== 'generatedArtifactAndLiveGateRequired') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${name} watch-scope evidence must require generated-artifact and live unsupported-predicate diagnostics.`));
  }
  if (evidence.runtimeRouting !== 'required') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${name} watch-scope evidence must require runtime routing coverage.`));
  }
  if (evidence.broadWatchFallback !== 'forbidden') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${name} watch-scope evidence must forbid broad-watch fallback.`));
  }
  if (evidence.failurePolicy !== 'failClosed') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${name} watch-scope evidence must fail closed.`));
  }
  return diagnostics;
}

function validateApplicationV03RuntimeReleasePolicyContract(name: string, policy: ApplicationV03RuntimeReleasePolicyContract): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (policy.startupPackageManager !== false) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${name} runtime release policy must forbid startup package managers.`));
  }
  if (policy.dependencyInstallation !== 'buildTimeOnly') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${name} runtime release policy must install dependencies only at build time.`));
  }
  if (policy.runtimeImage !== 'explicitImageOrGeneratedRecipe') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${name} runtime release policy must require an explicit image or generated recipe.`));
  }
  if (policy.supplyChain !== 'metadataOnlyUntilSignedArtifacts') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${name} runtime release policy must stay metadata-only until signed artifacts exist.`));
  }
  if (policy.signedArtifacts !== 'postV03') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${name} runtime release policy must keep signed artifacts post-v0.3.`));
  }
  if (policy.failurePolicy !== 'failClosed') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${name} runtime release policy must fail closed.`));
  }
  return diagnostics;
}

export function resolveApplicationGraphProviderRequirement<TInterface extends ApplicationProviderInterfaceKind>(graph: ApplicationGraph, requirement: ApplicationProviderRequirement<TInterface>): ApplicationProviderResolution<TInterface> {
  const declaredProviders = graph.nodes.filter((node): node is ApplicationProviderNode<TInterface> => node.kind === 'provider' && node.interface === requirement.interface);
  const providerById = new Map(graph.nodes.filter((node): node is ApplicationProviderNode => node.kind === 'provider').map((provider) => [provider.id, provider]));
  // An application default may intentionally alias one qualified provider. It
  // is a second lookup spelling, not a second provider authority. Collapse
  // those aliases before implicit requirement resolution so a qualified
  // provider can become the seamless application default without making
  // downstream framework consumers (actors, publishers, gateways) ambiguous.
  const providers = uniqueCanonicalApplicationProviderCandidates(
    declaredProviders,
    providerById,
  );
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  if (!nodeIds.has(requirement.consumer.nodeId)) {
    return applicationProviderResolutionFailure('invalidConsumer', requirement, [], [applicationProviderBindingDiagnostic(`Application provider requirement ${requirement.id} references missing consumer ${requirement.consumer.nodeId}.`)]);
  }
  if (requirement.provider) {
    const refDiagnostics = applicationProviderRefDiagnostics(`Application provider requirement ${requirement.id}`, requirement.provider, providerById);
    const provider = providerById.get(requirement.provider.nodeId);
    const interfaceDiagnostics = requirement.provider.interface === requirement.interface ? [] : [applicationProviderBindingDiagnostic(`Application provider requirement ${requirement.id} requires ${requirement.interface}, but its explicit provider ref is for ${requirement.provider.interface}.`)];
    if (refDiagnostics.length > 0 || interfaceDiagnostics.length > 0 || !provider || !applicationProviderNodeMatchesRequirement(provider, requirement)) {
      return applicationProviderResolutionFailure('invalidProvider', requirement, [], [...interfaceDiagnostics, ...refDiagnostics]);
    }
    return { status: 'resolved', requirement, provider, diagnostics: [] };
  }
  if (providers.length === 0) {
    return applicationProviderResolutionFailure('missing', requirement, [], [applicationProviderBindingDiagnostic(requirement.diagnostics.missing)]);
  }
  if (providers.length > 1) {
    return applicationProviderResolutionFailure('ambiguous', requirement, providers, [applicationProviderBindingDiagnostic(requirement.diagnostics.ambiguous)]);
  }
  const [provider] = providers;
  if (!provider) {
    return applicationProviderResolutionFailure('missing', requirement, [], [applicationProviderBindingDiagnostic(requirement.diagnostics.missing)]);
  }
  return { status: 'resolved', requirement, provider, diagnostics: [] };
}

function uniqueCanonicalApplicationProviderCandidates<
  TInterface extends ApplicationProviderInterfaceKind,
>(
  providers: readonly ApplicationProviderNode<TInterface>[],
  providerById: ReadonlyMap<string, ApplicationProviderNode>,
): readonly ApplicationProviderNode<TInterface>[] {
  const canonical = new Map<string, ApplicationProviderNode<TInterface>>();
  for (const provider of providers) {
    let current: ApplicationProviderNode = provider;
    const visited = new Set<string>([provider.id]);
    while (typeof current.config?.aliasOf === 'string') {
      const target = providerById.get(current.config.aliasOf);
      if (!target || target.interface !== provider.interface || visited.has(target.id)) break;
      visited.add(target.id);
      current = target;
    }
    canonical.set(current.id, current as ApplicationProviderNode<TInterface>);
  }
  return [...canonical.values()];
}

function applicationProviderResolutionFailure<TInterface extends ApplicationProviderInterfaceKind>(status: ApplicationProviderResolutionFailure<TInterface>['status'], requirement: ApplicationProviderRequirement<TInterface>, candidates: readonly ApplicationProviderNode<TInterface>[], diagnostics: readonly Diagnostic[]): ApplicationProviderResolutionFailure<TInterface> {
  return { status, requirement, candidates, diagnostics };
}

function applicationProviderNodeMatchesRequirement<TInterface extends ApplicationProviderInterfaceKind>(provider: ApplicationProviderNode, requirement: ApplicationProviderRequirement<TInterface>): provider is ApplicationProviderNode<TInterface> {
  return provider.interface === requirement.interface;
}

function expectedApplicationWatchScopeLowering(scope: ApplicationWatchScope): ApplicationWatchScopeLoweringContract['lowering'] {
  if (scope.kind === 'labelSelector') {
    return 'labelSelector';
  }
  if (scope.kind === 'fieldSelector') {
    return 'fieldSelector';
  }
  return scope.kind;
}

function applicationGraphNodeStructureDiagnostics(node: ApplicationGraphNode, graph: ApplicationGraph): readonly Diagnostic[] {
  switch (node.kind) {
    case 'model':
      return applicationModelNodeStructureDiagnostics(node, graph);
    case 'job':
      return applicationFiniteJobNodeStructureDiagnostics(node, graph);
    case 'workloadJob':
      return applicationWorkloadJobNodeStructureDiagnostics(node);
    case 'provider':
      return applicationProviderNodeStructureDiagnostics(node, graph);
    case 'server':
      return [...applicationObservabilityStructureDiagnostics(`Application server node ${node.id}`, node.observability, 'routeDiagnostics'), ...applicationServerRouteStructureDiagnostics(node, graph)];
    case 'command':
      return applicationCommandNodeStructureDiagnostics(node);
    case 'event':
      return applicationEventNodeStructureDiagnostics(node);
    case 'commandHandler':
      return applicationCommandHandlerNodeStructureDiagnostics(node, graph);
    case 'processor':
      return applicationProcessorNodeStructureDiagnostics(node, graph);
    case 'task':
      return applicationDurableContractNodeStructureDiagnostics('task', node.id, node.contract);
    case 'workflow':
      return applicationDurableContractNodeStructureDiagnostics('workflow', node.id, node.contract);
    case 'saga':
      return applicationSagaNodeStructureDiagnostics(node, graph);
    case 'mlModel':
      return applicationMLModelNodeStructureDiagnostics(node, graph);
    case 'taskHandler':
      return applicationTaskHandlerNodeStructureDiagnostics(node, graph);
    case 'workflowHandler':
      return applicationWorkflowHandlerNodeStructureDiagnostics(node, graph);
    case 'workflowWorker':
      return applicationWorkflowWorkerNodeStructureDiagnostics(node, graph);
    case 'schedule':
      return applicationScheduleNodeStructureDiagnostics(node);
    case 'lakehousePublication':
      return applicationLakehousePublicationNodeStructureDiagnostics(node);
    case 'actor':
      return applicationActorNodeStructureDiagnostics(node);
    case 'aiAgent':
      return applicationAIAgentNodeStructureDiagnostics(node, graph);
    case 'mcpServer':
      return applicationMcpServerNodeStructureDiagnostics(node);
    case 'mcpClient':
      return applicationMcpClientNodeStructureDiagnostics(node, graph);
    case 'query':
      return applicationReactiveNodeStructureMessages(node, graph).map(applicationGraphStructureDiagnostic);
    case 'gateway':
      return applicationReactiveNodeStructureMessages(node, graph).map(applicationGraphStructureDiagnostic);
    case 'stream':
      return applicationReactiveNodeStructureMessages(node, graph).map(applicationGraphStructureDiagnostic);
    case 'streamProcessor': {
      const source = graph.nodes.find((candidate) => candidate.id === node.source.nodeId);
      const scheduleAliases = new Set<string>();
			const taskAliases = new Set<string>();
      const functionNativeTransaction = node.functionNativeTransaction;
      const messages = [
        ...(source?.kind === 'stream' ? [] : [`Application stream processor ${node.id} must consume a replayable stream.`]),
        ...(node.handlerSource.trim() ? [] : [`Application stream processor ${node.id} must retain a serializable handler.`]),
        ...(node.deployment.replicas === 1 ? [] : [`Application stream processor ${node.id} must use one replica until distributed partition claims are implemented.`]),
        ...(node.invocation === 'batch' && (!node.batch
          || node.batch.maxItems < 1
          || node.batch.maxBytes < 1
          || node.batch.maxWaitMs < 1
          || node.batch.ordering !== 'partition'
          || node.batch.acknowledgement !== 'wholeBatch'
          || node.batch.membership !== 'durableFrozenManifest')
          ? [`Application batch processor ${node.id} must declare bounded frozen whole-batch delivery.`]
          : []),
        ...(node.invocation === 'event' && node.batch
          ? [`Application event processor ${node.id} cannot declare batch delivery metadata.`]
          : []),
        ...applicationFunctionNativeTransactionMessages(
          `Application stream processor ${node.id}`,
          functionNativeTransaction,
          node.idempotency,
          graph,
        ),
      ];
      for (const schedule of node.schedules ?? []) {
        const target = graph.nodes.find((candidate) => candidate.id === schedule.target.nodeId);
        if (!schedule.alias || scheduleAliases.has(schedule.alias)) messages.push(`Application stream processor ${node.id} declares an empty or duplicate schedule alias ${JSON.stringify(schedule.alias)}.`);
        scheduleAliases.add(schedule.alias);
        if (target?.kind !== 'task' && target?.kind !== 'workflow') messages.push(`Application stream processor ${node.id} schedule ${schedule.alias} must target a declared task or workflow.`);
      }
			for (const task of node.tasks ?? []) {
				const target = graph.nodes.find((candidate) => candidate.id === task.target.nodeId);
				if (!task.alias || taskAliases.has(task.alias)) messages.push(`Application stream processor ${node.id} declares an empty or duplicate task alias ${JSON.stringify(task.alias)}.`);
				taskAliases.add(task.alias);
				if (target?.kind !== 'task' && target?.kind !== 'workflow') messages.push(`Application stream processor ${node.id} workflow ${task.alias} must target a declared task or workflow.`);
			}
      const actorAliases = new Set<string>();
      for (const binding of node.actorBindings ?? []) {
        if (!binding.identifier.trim() || actorAliases.has(binding.identifier)) messages.push(`Application stream processor ${node.id} actor bindings must have unique non-empty identifiers.`);
        actorAliases.add(binding.identifier);
        const actor = graph.nodes.find((candidate) => candidate.id === binding.actor.nodeId);
        const member = actor?.kind === 'actor'
          ? actor.definition.protocol.find((candidate) => candidate.name === binding.member)
          : undefined;
        if (actor?.kind !== 'actor' || !member || member.kind !== binding.memberKind) messages.push(`Application stream processor ${node.id} actor ${binding.identifier} must reference matching ${binding.memberKind} member ${binding.member}.`);
      }
      const applicationScheduleAliases = new Set<string>();
      for (const binding of node.applicationScheduleBindings ?? []) {
        if (!binding.identifier.trim() || applicationScheduleAliases.has(binding.identifier)) messages.push(`Application stream processor ${node.id} schedule-handle bindings must have unique non-empty identifiers.`);
        applicationScheduleAliases.add(binding.identifier);
        const schedule = graph.nodes.find((candidate) => candidate.id === binding.schedule.nodeId);
        if (schedule?.kind !== 'schedule' || schedule.scheduler.nodeId !== binding.scheduler.nodeId) messages.push(`Application stream processor ${node.id} schedule handle ${binding.identifier} must reference one matching schedule definition and Scheduler provider.`);
      }
      if ((node.schedules?.length ?? 0) + (node.tasks?.length ?? 0) > 0) {
        const provider = graph.nodes.find((candidate) => candidate.id === node.workflowEngine?.nodeId);
				if (provider?.kind !== 'provider' || provider.interface !== 'WorkflowEngine') messages.push(`Application stream processor ${node.id} durable task and schedule targets require one WorkflowEngine provider.`);
      }
      return messages.map(applicationGraphStructureDiagnostic);
    }
    case 'subscription':
      return applicationReactiveNodeStructureMessages(node, graph).map(applicationGraphStructureDiagnostic);
    case 'projection':
      return applicationReactiveNodeStructureMessages(node, graph).map(applicationGraphStructureDiagnostic);
    case 'objectStore':
      return node.maxObjectBytes > 0 && node.contentTypes.length > 0 && node.browserAccess.ttlSeconds > 0
        && (node.browserAccess.downloadAccess === 'owner' || node.browserAccess.downloadAccess === 'authenticated')
        ? []
        : [applicationGraphStructureDiagnostic(`Application object store ${node.id} must declare positive bounds and at least one content type.`)];
    default:
      return [];
  }
}

function applicationFiniteJobNodeStructureDiagnostics(
  node: ApplicationJobNode,
  graph: ApplicationGraph,
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!node.contract.name.trim() || !/^v[1-9][0-9]*$/u.test(node.contract.version)) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application Job ${node.id} must retain a stable versioned contract identity.`));
  }
  if (!node.handlerSource.trim()) diagnostics.push(applicationGraphStructureDiagnostic(`Application Job ${node.id} must retain its managed closure source.`));
  for (const name of ['started', 'progressed', 'succeeded', 'failed', 'cancelled', 'timedOut'] as const) {
    const fact = node.events[name];
    if (!fact?.id.trim() || fact.contract.kind !== 'declared') {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application Job ${node.id} must declare its ${name} lifecycle fact contract.`));
    }
  }
  if (!Number.isSafeInteger(node.retry.maxAttempts) || node.retry.maxAttempts < 1 || node.retry.wholeAttempt !== true) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application Job ${node.id} must declare a positive whole-attempt retry budget.`));
  }
  if (node.executionDeadlineSeconds !== undefined && (!Number.isSafeInteger(node.executionDeadlineSeconds) || node.executionDeadlineSeconds < 1)) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application Job ${node.id} execution deadline must be a positive duration.`));
  }
  if (node.idempotency.scope !== 'applicationDeploymentContractContextAuthority' || node.idempotency.conflict !== 'failClosed') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application Job ${node.id} must retain the complete fail-closed idempotency scope.`));
  }
  if (node.runtime.interface !== 'JobRuntime' || node.runtime.selection !== 'profile' || node.runtime.protocol !== 'applik8s.jobRuntime/v1alpha1') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application Job ${node.id} must select a profile-owned JobRuntime using the supported protocol.`));
  }
  if (node.queryBatch) {
    const query = graph.nodes.find((candidate) => candidate.id === node.queryBatch?.query.nodeId);
    if (query?.kind !== 'query' || !query.selection) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application query batch Job ${node.id} must reference one selection-backed Query.`));
    } else if (query.selection.digest !== node.queryBatch.selectionDigest) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application query batch Job ${node.id} must pin the exact Query selection digest.`));
    }
    if (
      !Number.isSafeInteger(node.queryBatch.batch.maxItems)
      || node.queryBatch.batch.maxItems < 1
      || !Number.isSafeInteger(node.queryBatch.batch.concurrency)
      || node.queryBatch.batch.concurrency < 1
    ) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application query batch Job ${node.id} must declare positive bounded batch and concurrency limits.`));
    }
    if (
      node.queryBatch.lowering.provider !== 'postgres'
      || node.queryBatch.lowering.strategy !== 'materializedSnapshotRelation'
      || node.queryBatch.lowering.checkpointAuthority !== 'sourceDatabase'
      || !Number.isSafeInteger(node.queryBatch.lowering.maximumSnapshotItems)
      || node.queryBatch.lowering.maximumSnapshotItems < 1
      || !Number.isSafeInteger(node.queryBatch.lowering.maximumSnapshotAgeSeconds)
      || node.queryBatch.lowering.maximumSnapshotAgeSeconds < 1
      || node.queryBatch.lowering.stableKeyset !== true
      || node.queryBatch.lowering.durableWindowReceipts !== true
      || node.queryBatch.lowering.contiguousFrontier !== true
    ) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application query batch Job ${node.id} must retain its complete bounded PostgreSQL frontier lowering.`));
    }
    if (!node.queryBatch.handlerSource.trim()) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application query batch Job ${node.id} must retain its managed batch handler source.`));
    }
    if (
      node.queryBatch.consistency.mode === 'bestEffort'
      && (
        node.queryBatch.consistency.acceptsMembershipDrift !== true
        || node.queryBatch.consistency.idempotency !== 'handlerDeclared'
      )
    ) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application query batch Job ${node.id} best-effort consistency must acknowledge membership drift and handler idempotency.`));
    }
  }
  return diagnostics;
}

function applicationLakehousePublicationNodeStructureDiagnostics(
  node: ApplicationLakehousePublicationNode,
): readonly Diagnostic[] {
  const messages: string[] = [];
  if (!node.sourceEventId.trim()) messages.push(`Lakehouse publication ${node.id} requires a stable source event identity.`);
  if (!node.transform.source.trim()) messages.push(`Lakehouse publication ${node.id} must retain its serializable transform.`);
  if (node.partition && !node.partition.source.trim()) messages.push(`Lakehouse publication ${node.id} must retain its serializable partition function.`);
  return messages.map(applicationGraphStructureDiagnostic);
}

function applicationScheduleNodeStructureDiagnostics(
  node: ApplicationScheduleNode,
): readonly Diagnostic[] {
  const messages: string[] = [];
  if (!node.definition.id.trim()) {
    messages.push(`Application schedule ${node.id} must declare a stable definition id.`);
  }
  const cadenceCount = [
    node.definition.cron,
    node.definition.every,
    node.definition.at,
  ].filter((value) => value !== undefined).length;
  if (node.definition.configuration === 'fixed' && cadenceCount !== 1) {
    messages.push(`Fixed application schedule ${node.id} must declare exactly one of cron, every, or at.`);
  }
  if (node.definition.configuration === 'dynamic' && cadenceCount !== 0) {
    messages.push(`Dynamic application schedule ${node.id} must receive cadence from each configured instance.`);
  }
  if (node.definition.configuration === 'dynamic' && !node.definition.input) {
    messages.push(`Dynamic application schedule ${node.id} must declare an input schema.`);
  }
  if (!node.definition.timezone.trim()) {
    messages.push(`Application schedule ${node.id} must declare a timezone.`);
  }
  if (node.state.interface !== 'TransactionalDatabase' || !node.state.nodeId.trim()) {
    messages.push(`Application schedule ${node.id} must declare one canonical TransactionalDatabase state authority.`);
  }
  if (Boolean(node.handler) === Boolean(node.target)) {
    messages.push(`Application schedule ${node.id} must declare exactly one serializable handler or execution target.`);
  }
  if (node.handler && !node.handler.source.trim()) {
    messages.push(`Application schedule ${node.id} must retain a serializable handler closure.`);
  }
  if (node.target?.kind === 'durableStart') {
    if (!node.target.contract.name.trim() || !node.target.contract.version.trim()) {
      messages.push(`Application schedule ${node.id} durable target must retain a versioned contract identity.`);
    }
    if (
      node.target.input.kind === 'literal'
      && node.definition.configuration !== 'fixed'
    ) {
      messages.push(`Application schedule ${node.id} with literal durable input must be a fixed schedule definition.`);
    }
    if (
      node.target.input.kind === 'scheduleInput'
      && node.definition.configuration !== 'dynamic'
    ) {
      messages.push(`Application schedule ${node.id} with instance durable input must be a dynamic schedule definition.`);
    }
  }
  if (!Number.isSafeInteger(node.definition.retry.maxAttempts) || node.definition.retry.maxAttempts < 1) {
    messages.push(`Application schedule ${node.id} retry maxAttempts must be a positive integer.`);
  }
  if (!Number.isSafeInteger(node.definition.retry.maximumAgeSeconds) || node.definition.retry.maximumAgeSeconds < 1) {
    messages.push(`Application schedule ${node.id} retry maximumAgeSeconds must be a positive integer.`);
  }
  if (!Number.isSafeInteger(node.definition.maximumLatenessSeconds) || node.definition.maximumLatenessSeconds < 1) {
    messages.push(`Application schedule ${node.id} maximumLatenessSeconds must be a positive integer.`);
  }
  if (
    node.definition.misfires === 'all-bounded'
    && (!Number.isSafeInteger(node.definition.maximumCatchUp) || (node.definition.maximumCatchUp ?? 0) < 1)
  ) {
    messages.push(`Application schedule ${node.id} all-bounded misfires require a positive maximumCatchUp.`);
  }
  if (node.definition.misfires !== 'all-bounded' && node.definition.maximumCatchUp !== undefined) {
    messages.push(`Application schedule ${node.id} may declare maximumCatchUp only with all-bounded misfires.`);
  }
  return messages.map(applicationGraphStructureDiagnostic);
}

function applicationActorNodeStructureDiagnostics(
  node: ApplicationActorNode,
): readonly Diagnostic[] {
  const messages: string[] = [];
  if (!node.definition.id.trim()) messages.push(`Application actor ${node.id} must declare a stable definition id.`);
  if (!Number.isSafeInteger(node.definition.stateVersion) || node.definition.stateVersion < 1) messages.push(`Application actor ${node.id} state version must be a positive integer.`);
  if (!node.definition.migrationDigest.trim()) messages.push(`Application actor ${node.id} must declare a stable migration digest.`);
  const migrationSources = new Set<number>();
  for (const migration of node.definition.migrations) {
    if (!Number.isSafeInteger(migration.from) || migration.from < 1 || migration.from >= node.definition.stateVersion) messages.push(`Application actor ${node.id} migration source ${migration.from} is outside its prior state revisions.`);
    if (migrationSources.has(migration.from)) messages.push(`Application actor ${node.id} declares migration ${migration.from} more than once.`);
    migrationSources.add(migration.from);
  }
  const members = new Set<string>();
  for (const member of node.definition.protocol) {
    if (members.has(member.name)) messages.push(`Application actor ${node.id} declares protocol member ${member.name} more than once.`);
    members.add(member.name);
    if (member.kind === 'command' && (!member.input || !member.output)) messages.push(`Application actor command ${node.id}.${member.name} requires input and output schemas.`);
    if (member.kind !== 'broadcast' && member.kind !== 'connection' && member.kind !== 'disconnection' && !member.input) messages.push(`Application actor member ${node.id}.${member.name} requires an input schema.`);
  }
  const registered = new Set(node.handlers.map((handler) => handler.member));
  for (const member of node.definition.protocol) {
    if (member.kind !== 'broadcast' && member.kind !== 'connection' && member.kind !== 'disconnection' && !registered.has(member.name)) {
      messages.push(`Application actor ${node.id}.${member.name} requires exactly one handler.`);
    }
  }
  for (const binding of node.actorBindings ?? []) {
    if (!registered.has(binding.handler)) {
      messages.push(`Application actor ${node.id} dependency ${binding.alias} references unknown handler ${binding.handler}.`);
    }
    if (!binding.actor.nodeId.trim() || !binding.member.trim() || !binding.alias.trim()) {
      messages.push(`Application actor ${node.id}.${binding.handler} has an incomplete actor dependency.`);
    }
  }
  if (!node.initialize) messages.push(`Application actor ${node.id} requires an initialize handler.`);
  return messages.map(applicationGraphStructureDiagnostic);
}

function applicationMcpServerNodeStructureDiagnostics(
  node: ApplicationMcpServerNode,
): readonly Diagnostic[] {
  const messages: string[] = [];
  if (!/^\/(?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]+$/u.test(node.path)) {
    messages.push(
      `Application MCP server ${node.id} path must be an absolute URL-safe path without query or fragment.`,
    );
  }
  if (node.tools.length === 0) {
    messages.push(
      `Application MCP server ${node.id} must expose at least one existing operation.`,
    );
  }
  for (const duplicate of duplicateStrings(node.tools.map((tool) => tool.publicName))) {
    messages.push(
      `Application MCP server ${node.id} declares public tool name ${duplicate} more than once.`,
    );
  }
  for (const duplicate of duplicateStrings(node.tools.map((tool) => tool.operationId))) {
    messages.push(
      `Application MCP server ${node.id} exposes operation ${duplicate} more than once.`,
    );
  }
  for (const tool of node.tools) {
    if (!/^[A-Za-z0-9_.-]{1,128}$/u.test(tool.publicName)) {
      messages.push(
        `Application MCP server ${node.id} tool ${tool.publicName} is not a valid MCP public name.`,
      );
    }
  }
  if (
    !Number.isSafeInteger(node.sessions.lifetimeMs)
    || node.sessions.lifetimeMs < 60_000
    || node.sessions.lifetimeMs > 86_400_000
  ) {
    messages.push(
      `Application MCP server ${node.id} session lifetime must be between one minute and 24 hours.`,
    );
  }
  for (const [field, value] of [
    ['maximumRequestBytes', node.transport.maximumRequestBytes],
    ['maximumResponseBytes', node.transport.maximumResponseBytes],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1_024 || value > 100_000_000) {
      messages.push(
        `Application MCP server ${node.id} ${field} must be between 1 KiB and 100 MB.`,
      );
    }
  }
  if (node.resource && node.audience !== node.resource) {
    messages.push(
      `Application MCP server ${node.id} OAuth audience must equal its canonical resource URI.`,
    );
  }
  return messages.map(applicationGraphStructureDiagnostic);
}

function applicationMcpClientNodeStructureDiagnostics(
  node: ApplicationMcpClientNode,
  graph: ApplicationGraph,
): readonly Diagnostic[] {
  const messages: string[] = [];
  if (node.server !== node.resource || node.audience !== node.resource) {
    messages.push(
      `Application MCP client ${node.id} server, OAuth resource, and audience must be identical canonical URIs.`,
    );
  }
  if (node.tools.length === 0) {
    messages.push(
      `Application MCP client ${node.id} must allowlist at least one external tool.`,
    );
  }
  for (const duplicate of duplicateStrings(node.tools.map((tool) => tool.name))) {
    messages.push(
      `Application MCP client ${node.id} allowlists tool ${duplicate} more than once.`,
    );
  }
  const credentials = graph.nodes.find(
    (candidate) => candidate.id === node.credentials.nodeId,
  );
  if (credentials?.kind !== 'secret') {
    messages.push(
      `Application MCP client ${node.id} must reference a declared Secret credential source.`,
    );
  }
  if (
    !Number.isSafeInteger(node.egress.timeoutMs)
    || node.egress.timeoutMs < 100
    || node.egress.timeoutMs > 600_000
  ) {
    messages.push(
      `Application MCP client ${node.id} timeout must be between 100 ms and 10 minutes.`,
    );
  }
  if (
    !Number.isSafeInteger(node.egress.concurrency)
    || node.egress.concurrency < 1
    || node.egress.concurrency > 1_000
  ) {
    messages.push(
      `Application MCP client ${node.id} concurrency must be between 1 and 1000.`,
    );
  }
  return messages.map(applicationGraphStructureDiagnostic);
}

function applicationAIAgentNodeStructureDiagnostics(
  node: ApplicationAIAgentNode,
  graph: ApplicationGraph,
): readonly Diagnostic[] {
  const messages: string[] = [];
  if (!node.handlerSource.trim()) {
    messages.push(`Application AI agent ${node.id} must retain a serializable execution closure.`);
  }
  if (node.model.capabilities.length === 0) {
    messages.push(`Application AI agent ${node.id} logical model must declare at least one capability.`);
  }
  if (node.tools.length === 0) {
    messages.push(`Application AI agent ${node.id} must declare at least one operation tool.`);
  }
  if (node.scope && !/^[A-Za-z][A-Za-z0-9._-]*$/.test(node.scope.name)) {
    messages.push(`Application AI agent ${node.id} scope must reference a stable trusted-context name.`);
  }
  for (const operationId of duplicateStrings(node.tools.map((tool) => tool.operationId))) {
    messages.push(`Application AI agent ${node.id} declares operation tool ${operationId} more than once.`);
  }
  for (const operationId of duplicateStrings((node.operations ?? []).map((operation) => operation.operationId))) {
    messages.push(`Application AI agent ${node.id} calls function-native operation ${operationId} more than once.`);
  }
  for (const operationId of duplicateStrings((node.operations ?? []).map((operation) => operation.authoringOperationId))) {
    messages.push(`Application AI agent ${node.id} retains function-native authoring identity ${operationId} more than once.`);
  }
  const provider = graph.nodes.find((candidate) => candidate.id === node.inference.nodeId);
  if (provider?.kind !== 'provider' || provider.interface !== 'AI') {
    messages.push(`Application AI agent ${node.id} requires AI provider ${node.inference.nodeId}.`);
  }
  const stateProvider = graph.nodes.find((candidate) => candidate.id === node.state.nodeId);
  if (stateProvider?.kind !== 'provider' || stateProvider.interface !== 'TransactionalDatabase') {
    messages.push(`Application AI agent ${node.id} requires durable state provider ${node.state.nodeId}.`);
  }
  const authority = graph.nodes.find((candidate) => candidate.kind === 'authorityManifest');
  const identityDeclared = authority?.kind === 'authorityManifest'
    && authority.manifest.identities.some((identity) => identity.id === node.serviceIdentity.id);
  if (!identityDeclared) {
    messages.push(`Application AI agent ${node.id} service identity ${node.serviceIdentity.id} is absent from the application authority manifest.`);
  }
  for (const tool of node.tools) {
    if (tool.graphNode && !graph.nodes.some((candidate) => candidate.id === tool.graphNode?.nodeId)) {
      messages.push(`Application AI agent ${node.id} tool ${tool.operationId} references missing graph node ${tool.graphNode.nodeId}.`);
    }
    const staticallyGranted = authority?.kind === 'authorityManifest'
      && authority.manifest.grants.some((grant) =>
        grant.identity.id === node.serviceIdentity.id
        && grant.operationIds.includes(tool.operationId));
    const available = tool.authority.classification === 'public'
      || staticallyGranted
      || (tool.authority.classification === 'runtime-grantable' && tool.authority.grantable)
      || (node.executionPolicy.callerDelegation === 'declared' && tool.authority.delegable);
    if (!available) {
      messages.push(
        `Application AI agent ${node.id} tool ${tool.operationId} is unavailable: declare baseline authority, a requestable grant, or explicit caller delegation.`,
      );
    }
    if (tool.local) {
      if (!tool.local.handlerSource.trim()) {
        messages.push(
          `Application AI agent ${node.id} local tool ${tool.operationId} must retain its ordinary function source.`,
        );
      }
      messages.push(
        ...applicationFunctionNativeTransactionMessages(
          `Application AI agent ${node.id} local tool ${tool.operationId}`,
          tool.local.functionNativeTransaction,
          'agent-tool-call',
          graph,
        ),
      );
    }
  }
  for (const operation of node.operations ?? []) {
    if (!operation.authoringOperationId.trim()) {
      messages.push(`Application AI agent ${node.id} function-native operation ${operation.operationId} has no authoring identity.`);
    }
    const command = graph.nodes.find((candidate) => candidate.id === operation.command.nodeId);
    const handler = graph.nodes.find((candidate) => candidate.id === operation.handler.nodeId);
    if (command?.kind !== 'command' || handler?.kind !== 'commandHandler' || handler.command.nodeId !== command.id) {
      messages.push(`Application AI agent ${node.id} function-native operation ${operation.operationId} has an invalid command placement.`);
    }
    const staticallyGranted = authority?.kind === 'authorityManifest'
      && authority.manifest.grants.some((grant) =>
        grant.identity.id === node.serviceIdentity.id
        && grant.operationIds.includes(operation.operationId));
    if (!staticallyGranted) {
      messages.push(`Application AI agent ${node.id} function-native operation ${operation.operationId} requires an explicit service-identity grant.`);
    }
  }
  const actorAliases = new Set<string>();
  for (const binding of node.actors ?? []) {
    if (!binding.alias.trim() || actorAliases.has(binding.alias)) {
      messages.push(`Application AI agent ${node.id} actor aliases must be non-empty and unique.`);
    }
    actorAliases.add(binding.alias);
    const actor = graph.nodes.find((candidate) => candidate.id === binding.actor.nodeId);
    const member = actor?.kind === 'actor'
      ? actor.definition.protocol.find((candidate) => candidate.name === binding.member)
      : undefined;
    if (actor?.kind !== 'actor' || !member || member.kind !== binding.memberKind) {
      messages.push(`Application AI agent ${node.id} actor ${binding.alias} must reference matching ${binding.memberKind} member ${binding.member}.`);
    }
  }
  if ((typeof node.deployment.replicas === 'number' && node.deployment.replicas < 1)
    || node.deployment.port < 1
    || node.deployment.healthPort < 1
    || node.deployment.maximumConcurrency < 1
    || node.deployment.gracefulShutdownSeconds < 1) {
    messages.push(`Application AI agent ${node.id} deployment bounds must be positive.`);
  }
  return messages.map(applicationGraphStructureDiagnostic);
}

function duplicateStrings(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    else seen.add(value);
  }
  return [...duplicates].sort(compareStrings);
}

function applicationCommandNodeStructureDiagnostics(node: ApplicationCommandNode): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!node.contract.name || !node.contract.version) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application command node ${node.id} must declare a non-empty contract name and version.`));
  }
  const errorNames = new Set<string>();
  for (const error of node.contract.errors) {
    if (errorNames.has(error.name)) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application command node ${node.id} declares duplicate durable error ${error.name}.`));
    }
    errorNames.add(error.name);
  }
  return diagnostics;
}

function applicationEventNodeStructureDiagnostics(node: ApplicationEventNode): readonly Diagnostic[] {
  return node.contract.name && node.contract.version
    ? []
    : [applicationGraphStructureDiagnostic(`Application event node ${node.id} must declare a non-empty contract name and version.`)];
}

function applicationCommandHandlerNodeStructureDiagnostics(node: ApplicationCommandHandlerNode, graph: ApplicationGraph): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const nodeById = new Map(graph.nodes.map((candidate) => [candidate.id, candidate]));
  const targetModel = nodeById.get(node.model.nodeId);
  if (targetModel?.kind !== 'model') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application command handler ${node.id} must target a model node.`));
  } else if (!targetModel.runtime) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application command handler ${node.id} target model ${targetModel.id} must retain its generated runtime contract.`));
  }
  if (nodeById.get(node.command.nodeId)?.kind !== 'command') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application command handler ${node.id} must reference a command node.`));
  }
  for (const model of [...node.transaction.models, ...node.transaction.history]) {
    if (nodeById.get(model.nodeId)?.kind !== 'model') {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application command handler ${node.id} transaction reference ${model.nodeId} must be a model node.`));
    }
  }
  for (const binding of node.transaction.modelBindings ?? []) {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(binding.identifier)) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application command handler ${node.id} model binding ${binding.identifier} must be a JavaScript identifier.`));
    }
    if (nodeById.get(binding.model.nodeId)?.kind !== 'model') {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application command handler ${node.id} model binding ${binding.identifier} must reference a model node.`));
    }
  }
  for (const duplicate of duplicateStrings((node.transaction.modelBindings ?? []).map(({ identifier }) => identifier))) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application command handler ${node.id} declares duplicate model binding ${duplicate}.`));
  }
  if (node.transaction.selfRead === true && !node.transaction.models.some((model) => model.nodeId === node.model.nodeId)) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application command handler ${node.id} may enable selfRead only when its target model is an explicit transaction participant.`));
  }
  for (const event of node.transaction.outbox) {
    if (nodeById.get(event.nodeId)?.kind !== 'event') {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application command handler ${node.id} outbox reference ${event.nodeId} must be an event node.`));
    }
  }
  for (const command of node.transaction.commands ?? []) {
    if (nodeById.get(command.nodeId)?.kind !== 'command') {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application command handler ${node.id} command outbox reference ${command.nodeId} must be a command node.`));
    }
  }
  for (const binding of node.eventBindings ?? []) {
    if (nodeById.get(binding.event.nodeId)?.kind !== 'event') {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application command handler ${node.id} event binding ${binding.identifier} must reference an event node.`));
    }
  }
  for (const binding of node.commandBindings ?? []) {
    if (nodeById.get(binding.command.nodeId)?.kind !== 'command') {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application command handler ${node.id} command binding ${binding.identifier} must reference a command node.`));
    }
  }
  if (node.missing === 'route' && !node.missingRoute?.trim()) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application command handler ${node.id} with routed missing-target behavior must declare a non-empty alternate target key.`));
  }
  if (node.missing !== 'route' && node.missingRoute) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application command handler ${node.id} may declare missingRoute only when missing is route.`));
  }
  if (!node.key.source.trim()) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application command handler ${node.id} must declare a deterministic key expression.`));
  }
  if (!node.handlerSource.trim()) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application command handler ${node.id} must retain handler source for generated processor lowering.`));
  }
  if (node.effectBoundary !== 'transactionSafeOnly') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application command handler ${node.id} must enforce the transactionSafeOnly effect boundary.`));
  }
  if (node.effectEnforcement?.sourceAnalysis !== 'closedStructuralAllowlist'
    || node.effectEnforcement.runtimeMembrane !== 'asyncContextAmbientIo'
    || node.effectEnforcement.externalEffects !== 'outboxOrTaskOnly') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application command handler ${node.id} must retain structural source enforcement, the async-context ambient-I/O membrane, and outbox-or-task-only external effects.`));
  }
  if (node.projectionReadiness?.submissionAcknowledgement !== 'transportOnly'
    || node.projectionReadiness.durableResultAuthority !== 'postgresCommandResults'
    || node.projectionReadiness.duplicateRecovery !== 'idempotentRedelivery'
    || node.projectionReadiness.correlation !== 'commandCorrelationCausation'
    || node.projectionReadiness.resultRevisionAuthority !== 'postgresCommandResults'
    || node.projectionReadiness.stateRevisionAuthority !== 'modelRevision'
    || node.projectionReadiness.reconciliationLink !== 'modelRevisionWhenPresent') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application command handler ${node.id} must retain the v0.4 projection-readiness authority contract.`));
  }
  if (!Number.isInteger(node.retention.replayWindowSeconds) || node.retention.replayWindowSeconds < 60) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application command handler ${node.id} replayWindowSeconds must be an integer >= 60.`));
  }
  if (!Number.isInteger(node.retention.auditWindowSeconds) || node.retention.auditWindowSeconds < node.retention.replayWindowSeconds) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application command handler ${node.id} auditWindowSeconds must be an integer >= replayWindowSeconds.`));
  }
  if (!Number.isInteger(node.retention.publishedOutboxWindowSeconds) || node.retention.publishedOutboxWindowSeconds < 60) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application command handler ${node.id} publishedOutboxWindowSeconds must be an integer >= 60.`));
  }
  if (!Number.isInteger(node.retention.cleanupIntervalSeconds) || node.retention.cleanupIntervalSeconds < 10) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application command handler ${node.id} cleanupIntervalSeconds must be an integer >= 10.`));
  }
  if (!Number.isInteger(node.retention.cleanupBatchSize) || node.retention.cleanupBatchSize < 1 || node.retention.cleanupBatchSize > 10_000) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application command handler ${node.id} cleanupBatchSize must be an integer between 1 and 10000.`));
  }
  return diagnostics;
}

function applicationProcessorNodeStructureDiagnostics(node: ApplicationProcessorNode, graph: ApplicationGraph): readonly Diagnostic[] {
  const handlerIds = new Set(graph.nodes.filter((candidate) => candidate.kind === 'commandHandler').map((candidate) => candidate.id));
  const diagnostics: Diagnostic[] = [];
  if (node.handlers.length === 0) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application processor node ${node.id} must include at least one command handler.`));
  }
  for (const handler of node.handlers) {
    if (!handlerIds.has(handler.nodeId)) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application processor node ${node.id} references missing command handler ${handler.nodeId}.`));
    }
  }
  if (!node.deployment || !applicationProcessorInteger(node.deployment.replicas, 1, 32)) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application processor node ${node.id} deployment.replicas must be an integer between 1 and 32.`));
  }
  if (!node.deployment || !applicationProcessorInteger(node.deployment.concurrency, 1, 64)) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application processor node ${node.id} deployment.concurrency must be an integer between 1 and 64.`));
  }
  if (node.deployment && !applicationProcessorDeliveryWindow(node.deployment)) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application processor node ${node.id} deployment.maxAckPending must be an integer between replicas * concurrency and 65536.`));
  }
  return diagnostics;
}

function applicationProcessorInteger(value: number | string, minimum: number, maximum: number): boolean {
  if (typeof value === 'string') return /^\$\{.+\}$/.test(value);
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function applicationProcessorDeliveryWindow(deployment: ApplicationProcessorDeploymentContract): boolean {
  if (!applicationProcessorInteger(deployment.maxAckPending, 1, 65_536)) return false;
  if (typeof deployment.maxAckPending !== 'number' || typeof deployment.replicas !== 'number' || typeof deployment.concurrency !== 'number') return true;
  return deployment.maxAckPending >= deployment.replicas * deployment.concurrency;
}

function applicationDurableContractNodeStructureDiagnostics(kind: 'task' | 'workflow', id: string, contract: { readonly name: string; readonly version: string; readonly errors: readonly { readonly name: string }[] }): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!contract.name.trim() || !/^v[1-9][0-9]*$/.test(contract.version)) diagnostics.push(applicationGraphStructureDiagnostic(`Application ${kind} node ${id} must declare a non-empty name and explicit version.`));
  const errors = new Set<string>();
  for (const error of contract.errors) {
    if (errors.has(error.name)) diagnostics.push(applicationGraphStructureDiagnostic(`Application ${kind} node ${id} declares duplicate durable error ${error.name}.`));
    errors.add(error.name);
  }
  return diagnostics;
}

function applicationTaskHandlerNodeStructureDiagnostics(node: ApplicationTaskHandlerNode, graph: ApplicationGraph): readonly Diagnostic[] {
  const nodes = new Map(graph.nodes.map((candidate) => [candidate.id, candidate]));
  const diagnostics: Diagnostic[] = [];
  if (nodes.get(node.task.nodeId)?.kind !== 'task') diagnostics.push(applicationGraphStructureDiagnostic(`Application task handler ${node.id} must reference a task node.`));
  for (const capability of node.capabilities ?? []) {
    const provider = nodes.get(capability.nodeId);
    if (provider?.kind !== 'provider' || provider.interface !== capability.interface) diagnostics.push(applicationGraphStructureDiagnostic(`Application task handler ${node.id} capability ${capability.interface} must reference a matching provider node.`));
  }
  const childAliases = new Set<string>();
  for (const binding of node.childWorkflowBindings ?? []) {
    if (!binding.alias.trim() || childAliases.has(binding.alias)) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application task handler ${node.id} child workflow aliases must be non-empty and unique.`));
    }
    childAliases.add(binding.alias);
    if (nodes.get(binding.workflow.nodeId)?.kind !== 'workflow') {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application task handler ${node.id} child workflow ${binding.alias} must reference a workflow node.`));
    }
  }
  const providerBindingIdentities = new Set<string>();
  for (const binding of node.providerBindings ?? []) {
    if (
      !binding.identifier.trim()
      || providerBindingIdentities.has(binding.identifier)
    ) {
      diagnostics.push(applicationGraphStructureDiagnostic(
        `Application task handler ${node.id} provider binding identifiers must be non-empty and unique.`,
      ));
    }
    providerBindingIdentities.add(binding.identifier);
    const provider = nodes.get(binding.provider.nodeId);
    if (
      provider?.kind !== 'provider'
      || provider.interface !== binding.provider.interface
    ) {
      diagnostics.push(applicationGraphStructureDiagnostic(
        `Application task handler ${node.id} provider binding ${binding.identifier} must reference a matching provider node.`,
      ));
    }
    if (
      binding.projection !== undefined
      && !['binding', 'implementation', 'token'].includes(binding.projection)
    ) {
      diagnostics.push(applicationGraphStructureDiagnostic(
        `Application task handler ${node.id} provider binding ${binding.identifier} has an invalid runtime projection.`,
      ));
    }
    if (binding.privateRuntime !== undefined && binding.privateRuntime !== true) {
      diagnostics.push(applicationGraphStructureDiagnostic(
        `Application task handler ${node.id} provider binding ${binding.identifier} has an invalid private-runtime marker.`,
      ));
    }
  }
  const operationAliases = new Set<string>();
  for (const operation of node.operations ?? []) {
    if (!operation.alias.trim() || operationAliases.has(operation.alias)) diagnostics.push(applicationGraphStructureDiagnostic(`Application task handler ${node.id} operation aliases must be non-empty and unique.`));
    operationAliases.add(operation.alias);
    if (nodes.get(operation.command.nodeId)?.kind !== 'command') diagnostics.push(applicationGraphStructureDiagnostic(`Application task handler ${node.id} operation ${operation.alias} must reference a command node.`));
    const handler = nodes.get(operation.handler.nodeId);
    if (handler?.kind !== 'commandHandler' || handler.command.nodeId !== operation.command.nodeId) diagnostics.push(applicationGraphStructureDiagnostic(`Application task handler ${node.id} operation ${operation.alias} must reference the matching command handler.`));
    if (operation.authority.alias !== operation.alias
      || !operation.authority.operationId.startsWith('applik8s://')
      || operation.authority.invocation !== 'context.invoke'
      || operation.authority.authorization !== 'reauthorize'
      || operation.authority.terminal !== true) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application task handler ${node.id} operation ${operation.alias} must retain one canonical terminal reauthorizing dependency.`));
    }
    if (!operation.authority.restrictions.target) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application task handler ${node.id} operation ${operation.alias} must explicitly select .on(...), .where(...), .all(), or an execution binding; bare dependencies cannot broaden workload authority.`));
    }
    const binding = operation.authority.binding;
    if (binding) {
      const keys = new Set(binding.boundKeys);
      if (binding.operationId !== operation.authority.operationId
        || binding.source !== 'input'
        || binding.boundKeys.length === 0
        || keys.size !== binding.boundKeys.length
        || !binding.projectionDigest.trim()
        || !binding.projectionSource.trim()) {
        diagnostics.push(applicationGraphStructureDiagnostic(`Application task handler ${node.id} operation ${operation.alias} has an invalid exact input execution binding.`));
      }
    }
  }
  const queryAliases = new Set<string>();
  for (const query of node.queries ?? []) {
    if (!query.alias.trim() || queryAliases.has(query.alias)) diagnostics.push(applicationGraphStructureDiagnostic(`Application task handler ${node.id} query aliases must be non-empty and unique.`));
    queryAliases.add(query.alias);
    if (nodes.get(query.query.nodeId)?.kind !== 'query') diagnostics.push(applicationGraphStructureDiagnostic(`Application task handler ${node.id} query ${query.alias} must reference a query node.`));
  }
  const projectionAliases = new Set<string>();
  for (const projection of node.projections ?? []) {
    if (!projection.alias.trim() || projectionAliases.has(projection.alias)) diagnostics.push(applicationGraphStructureDiagnostic(`Application task handler ${node.id} projection aliases must be non-empty and unique.`));
    projectionAliases.add(projection.alias);
    const target = nodes.get(projection.projection.nodeId);
    if (target?.kind !== 'projection' || target.storage !== 'online' || !target.online) diagnostics.push(applicationGraphStructureDiagnostic(`Application task handler ${node.id} projection ${projection.alias} must reference a generation-scoped online projection.`));
    if (nodes.get(projection.artifacts.nodeId)?.kind !== 'objectStore') diagnostics.push(applicationGraphStructureDiagnostic(`Application task handler ${node.id} projection ${projection.alias} must reference an object store for immutable rebuild evidence.`));
    for (const [name, value] of Object.entries(projection.bounds)) if (!Number.isSafeInteger(value) || value < 1) diagnostics.push(applicationGraphStructureDiagnostic(`Application task handler ${node.id} projection ${projection.alias} ${name} bound must be a positive safe integer.`));
  }
	const objectAliases = new Set<string>();
	for (const object of node.objects ?? []) {
		if (!object.alias.trim() || objectAliases.has(object.alias)) diagnostics.push(applicationGraphStructureDiagnostic(`Application task handler ${node.id} object aliases must be non-empty and unique.`));
		objectAliases.add(object.alias);
		const store = nodes.get(object.store.nodeId);
		if (store?.kind !== 'objectStore') diagnostics.push(applicationGraphStructureDiagnostic(`Application task handler ${node.id} object ${object.alias} must reference an object store.`));
		const operations = Array.isArray(object.operations)
			? object.operations
			: undefined;
		if (!operations || operations.length === 0) {
			diagnostics.push(applicationGraphStructureDiagnostic(`Application task handler ${node.id} object ${object.alias} must declare at least one operation.`));
			continue;
		}
		const supported = new Set<ApplicationTaskObjectOperation>(['put', 'get', 'head', 'delete']);
		if (operations.some(operation => !supported.has(operation))) diagnostics.push(applicationGraphStructureDiagnostic(`Application task handler ${node.id} object ${object.alias} declares an unsupported operation.`));
		if (new Set(operations).size !== operations.length) diagnostics.push(applicationGraphStructureDiagnostic(`Application task handler ${node.id} object ${object.alias} operations must be unique.`));
		if (store?.kind === 'objectStore' && store.deletion === 'retained' && operations.includes('delete')) diagnostics.push(applicationGraphStructureDiagnostic(`Application task handler ${node.id} object ${object.alias} cannot receive delete authority for retained store ${store.id}.`));
		if (object.credentialsSecret && (
			object.credentialsSecret.apiVersion !== 'v1'
			|| object.credentialsSecret.kind !== 'Secret'
			|| typeof object.credentialsSecret.name !== 'string'
			|| !object.credentialsSecret.name.trim()
		)) diagnostics.push(applicationGraphStructureDiagnostic(`Application task handler ${node.id} object ${object.alias} credentials must reference a named v1 Secret.`));
	}
  const actorAliases = new Set<string>();
  for (const binding of node.actors ?? []) {
    if (!binding.alias.trim() || actorAliases.has(binding.alias)) diagnostics.push(applicationGraphStructureDiagnostic(`Application task handler ${node.id} actor aliases must be non-empty and unique.`));
    actorAliases.add(binding.alias);
    const actor = nodes.get(binding.actor.nodeId);
    if (actor?.kind !== 'actor') {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application task handler ${node.id} actor ${binding.alias} must reference an actor node.`));
      continue;
    }
    const member = actor.definition.protocol.find((candidate) => candidate.name === binding.member);
    if (!member || member.kind !== binding.memberKind) diagnostics.push(applicationGraphStructureDiagnostic(`Application task handler ${node.id} actor ${binding.alias} must reference the matching ${binding.memberKind} member ${binding.member}.`));
  }
  const accountingAliases = new Set<string>();
  for (const accounting of node.providerAccounting ?? []) {
    if (!accounting.alias.trim() || accountingAliases.has(accounting.alias)) diagnostics.push(applicationGraphStructureDiagnostic(`Application task handler ${node.id} provider accounting aliases must be non-empty and unique.`));
    accountingAliases.add(accounting.alias);
    if (!accounting.name.trim()) diagnostics.push(applicationGraphStructureDiagnostic(`Application task handler ${node.id} provider accounting ${accounting.alias} must retain a stable name.`));
    if (nodes.get(accounting.callModel.nodeId)?.kind !== 'model' || nodes.get(accounting.costModel.nodeId)?.kind !== 'model') diagnostics.push(applicationGraphStructureDiagnostic(`Application task handler ${node.id} provider accounting ${accounting.alias} must reference registered call and cost models.`));
  }
  const signalAliases = new Set<string>();
  for (const binding of node.signalBindings ?? []) {
    if (!binding.alias.trim() || signalAliases.has(binding.alias)) diagnostics.push(applicationGraphStructureDiagnostic(`Application task handler ${node.id} signal aliases must be non-empty and unique.`));
    signalAliases.add(binding.alias);
    if (!binding.id.trim() || !binding.name.trim() || !/^v[1-9][0-9]*$/.test(binding.version)) diagnostics.push(applicationGraphStructureDiagnostic(`Application task handler ${node.id} signal ${binding.alias} must retain a stable versioned contract identity.`));
    if (binding.actions.length === 0 || new Set(binding.actions.map((action) => action.name)).size !== binding.actions.length) diagnostics.push(applicationGraphStructureDiagnostic(`Application task handler ${node.id} signal ${binding.alias} must declare unique terminal actions.`));
  }
  const effectCount = (node.operations?.length ?? 0) + (node.queries?.length ?? 0) + (node.actors?.length ?? 0) + (node.providerAccounting?.length ?? 0);
  if (
    effectCount > 0
    && !node.serviceIdentity
    && !node.operationPrincipalSource?.trim()
  ) {
    diagnostics.push(applicationGraphStructureDiagnostic(
      `Application task handler ${node.id} declares authenticated effects without a service-principal derivation.`,
    ));
  }
  if (
    effectCount === 0
    && (node.serviceIdentity || node.operationPrincipalSource)
  ) {
    diagnostics.push(applicationGraphStructureDiagnostic(
      `Application task handler ${node.id} declares a service principal without durable operations, authenticated queries, actor invocations, or provider accounting.`,
    ));
  }
  if (!node.handlerSource.trim()) diagnostics.push(applicationGraphStructureDiagnostic(`Application task handler ${node.id} must retain handler source for generated worker lowering.`));
  diagnostics.push(
    ...applicationFunctionNativeTransactionMessages(
      `Application task handler ${node.id}`,
      node.functionNativeTransaction,
      'durable-task-invocation',
      graph,
    ).map(applicationGraphStructureDiagnostic),
  );
  if (node.effectBoundary !== 'externalEffectsAllowed' || node.idempotency.guarantee !== 'atLeastOnceRetrySafe') diagnostics.push(applicationGraphStructureDiagnostic(`Application task handler ${node.id} must retain the retry-safe external-effect boundary.`));
  if (!Number.isInteger(node.executionTimeoutSeconds) || node.executionTimeoutSeconds < 1) diagnostics.push(applicationGraphStructureDiagnostic(`Application task handler ${node.id} execution timeout must be a positive integer.`));
  if (node.retry.factor !== undefined && (!Number.isFinite(node.retry.factor) || node.retry.factor <= 0)) diagnostics.push(applicationGraphStructureDiagnostic(`Application task handler ${node.id} retry factor must be greater than zero.`));
  return diagnostics;
}

function applicationFunctionNativeTransactionMessages(
  label: string,
  transaction: ApplicationFunctionNativeTransactionContract | undefined,
  expectedIdempotency: ApplicationFunctionNativeTransactionContract['idempotency'],
  graph: ApplicationGraph,
): string[] {
  if (!transaction) return [];
  const messages: string[] = [];
  if (transaction.idempotency !== expectedIdempotency) {
    messages.push(
      `${label} function-native transaction idempotency must match its durable trigger identity.`,
    );
  }
  const primary = graph.nodes.find(
    (candidate) => candidate.id === transaction.primaryModel.nodeId,
  );
  if (primary?.kind !== 'model') {
    messages.push(
      `${label} function-native primary model must reference a declared relational model.`,
    );
  }
  const modelIds = new Set(transaction.models.map((model) => model.nodeId));
  if (!modelIds.has(transaction.primaryModel.nodeId)) {
    messages.push(
      `${label} function-native primary model must also be a transaction participant.`,
    );
  }
  for (const model of transaction.models) {
    if (
      graph.nodes.find((candidate) => candidate.id === model.nodeId)?.kind
      !== 'model'
    ) {
      messages.push(
        `${label} function-native participant ${model.nodeId} must reference a declared relational model.`,
      );
    }
  }
  const callbackIdentifiers = new Map<string, string>();
  for (const binding of transaction.modelBindings) {
    const paths = functionNativeRuntimeBindingPaths(binding.identifier, 'model');
    if (paths.length === 0) {
      messages.push(`${label} function-native model bindings must retain a callback identifier.`);
      continue;
    }
    for (const path of paths) {
      const previous = callbackIdentifiers.get(path);
      if (previous && previous !== binding.model.nodeId) {
        messages.push(
          `${label} function-native callback path ${path} is ambiguous between ${previous} and ${binding.model.nodeId}.`,
        );
      }
      callbackIdentifiers.set(path, binding.model.nodeId);
    }
  }
  const outboxIds = new Set(transaction.outbox.map((event) => event.nodeId));
  for (const binding of transaction.eventBindings ?? []) {
    const paths = functionNativeRuntimeBindingPaths(binding.identifier, 'event');
    if (paths.length === 0) {
      messages.push(`${label} function-native event bindings must retain a callback identifier.`);
      continue;
    }
    if (!outboxIds.has(binding.event.nodeId)) {
      messages.push(
        `${label} function-native event binding ${binding.identifier} must reference its declared outbox.`,
      );
    }
    const event = graph.nodes.find(
      (candidate) => candidate.id === binding.event.nodeId,
    );
    if (event?.kind !== 'event') {
      messages.push(
        `${label} function-native event binding ${binding.identifier} must reference a declared event.`,
      );
    }
    for (const path of paths) {
      const previous = callbackIdentifiers.get(path);
      if (previous && previous !== binding.event.nodeId) {
        messages.push(
          `${label} function-native callback path ${path} is ambiguous between ${previous} and ${binding.event.nodeId}.`,
        );
      }
      callbackIdentifiers.set(path, binding.event.nodeId);
    }
  }
  const writeModels = new Set(
    transaction.modelBindings
      .filter((binding) => binding.access === 'write')
      .map((binding) => binding.model.nodeId),
  );
  const transactionMode = transaction.mode ?? 'write';
  if (transactionMode === 'read' && writeModels.size > 0) {
    messages.push(
      `${label} function-native read scope cannot contain writable model bindings.`,
    );
  } else if (
    transactionMode === 'write'
    && (
      writeModels.size !== 1
      || !writeModels.has(transaction.primaryModel.nodeId)
    )
  ) {
    messages.push(
      `${label} function-native transaction must infer exactly one writable primary model.`,
    );
  }
  for (const binding of transaction.modelBindings) {
    if (!binding.identifier || !modelIds.has(binding.model.nodeId)) {
      messages.push(
        `${label} function-native model binding ${JSON.stringify(binding.identifier)} must reference one declared participant.`,
      );
    }
  }
  for (const outbox of transaction.outbox) {
    if (
      graph.nodes.find((candidate) => candidate.id === outbox.nodeId)?.kind
      !== 'event'
    ) {
      messages.push(
        `${label} function-native outbox ${outbox.nodeId} must reference a declared event.`,
      );
    }
  }
  return messages;
}

function functionNativeRuntimeBindingPaths(
  identifier: string,
  kind: 'model' | 'event',
): readonly string[] {
  const segments = identifier.split('.').map((segment) => segment.trim());
  if (
    segments.length === 0
    || segments.some(
      (segment) => !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment),
    )
  ) {
    return [];
  }
  const member = segments.at(-1);
  if (kind === 'event') {
    return [member === 'emit' ? identifier : `${identifier}.emit`];
  }
  if (
    member !== undefined
    && ['get', 'find', 'require', 'edit'].includes(member)
  ) {
    return [identifier];
  }
  return ['get', 'find', 'require', 'edit'].map(
    (method) => `${identifier}.${method}`,
  );
}

function applicationWorkflowHandlerNodeStructureDiagnostics(node: ApplicationWorkflowHandlerNode, graph: ApplicationGraph): readonly Diagnostic[] {
  const nodes = new Map(graph.nodes.map((candidate) => [candidate.id, candidate]));
  const diagnostics: Diagnostic[] = [];
  if (nodes.get(node.workflow.nodeId)?.kind !== 'workflow') diagnostics.push(applicationGraphStructureDiagnostic(`Application workflow handler ${node.id} must reference a workflow node.`));
  for (const task of node.tasks) if (nodes.get(task.nodeId)?.kind !== 'task') diagnostics.push(applicationGraphStructureDiagnostic(`Application workflow handler ${node.id} task reference ${task.nodeId} must be a task node.`));
  for (const workflow of node.childWorkflows) if (nodes.get(workflow.nodeId)?.kind !== 'workflow') diagnostics.push(applicationGraphStructureDiagnostic(`Application workflow handler ${node.id} child reference ${workflow.nodeId} must be a workflow node.`));
  for (const binding of node.taskBindings) if (nodes.get(binding.task.nodeId)?.kind !== 'task') diagnostics.push(applicationGraphStructureDiagnostic(`Application workflow handler ${node.id} task alias ${binding.alias} must reference a task node.`));
  for (const binding of node.childWorkflowBindings) if (nodes.get(binding.workflow.nodeId)?.kind !== 'workflow') diagnostics.push(applicationGraphStructureDiagnostic(`Application workflow handler ${node.id} child alias ${binding.alias} must reference a workflow node.`));
  const signalAliases = new Set<string>();
  for (const binding of node.signalBindings ?? []) {
    if (!binding.alias.trim() || signalAliases.has(binding.alias)) diagnostics.push(applicationGraphStructureDiagnostic(`Application workflow handler ${node.id} signal aliases must be non-empty and unique.`));
    signalAliases.add(binding.alias);
    if (!binding.id.trim() || !binding.name.trim() || !/^v[1-9][0-9]*$/.test(binding.version)) diagnostics.push(applicationGraphStructureDiagnostic(`Application workflow handler ${node.id} signal ${binding.alias} must retain a stable versioned contract identity.`));
    if (binding.actions.length === 0 || new Set(binding.actions.map((action) => action.name)).size !== binding.actions.length) diagnostics.push(applicationGraphStructureDiagnostic(`Application workflow handler ${node.id} signal ${binding.alias} must declare unique terminal actions.`));
  }
  if (!node.handlerSource.trim() || node.orchestrationBoundary !== 'durableEffectsThroughTasks' || node.sourceAnalysis !== 'closedWorkflowAllowlist') diagnostics.push(applicationGraphStructureDiagnostic(`Application workflow handler ${node.id} must retain closed provider-neutral durable orchestration source.`));
  return diagnostics;
}

function applicationSagaNodeStructureDiagnostics(
  node: ApplicationSagaNode,
  graph: ApplicationGraph,
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const provider = graph.nodes.find(
    (candidate) => candidate.id === node.workflowEngine.nodeId,
  );
  if (
    provider?.kind !== 'provider'
    || provider.interface !== 'WorkflowEngine'
  ) {
    diagnostics.push(applicationGraphStructureDiagnostic(
      `Application Saga ${node.id} must reference one WorkflowEngine provider.`,
    ));
  }
  if (
    !node.contract.name.trim()
    || !/^v[1-9][0-9]*$/.test(node.contract.version)
  ) {
    diagnostics.push(applicationGraphStructureDiagnostic(
      `Application Saga ${node.id} must retain a stable versioned contract identity.`,
    ));
  }
  if (!node.handlerSource.trim()) {
    diagnostics.push(applicationGraphStructureDiagnostic(
      `Application Saga ${node.id} must retain handler source for generated worker lowering.`,
    ));
  }
  if (
    !Number.isSafeInteger(node.deadlineSeconds)
    || node.deadlineSeconds < 1
    || !Number.isSafeInteger(node.recoveryDeadlineSeconds)
    || node.recoveryDeadlineSeconds < node.deadlineSeconds
  ) {
    diagnostics.push(applicationGraphStructureDiagnostic(
      `Application Saga ${node.id} requires positive deadlines with recoveryDeadline >= deadline.`,
    ));
  }
  const stepIds = new Set<string>();
  for (const [index, step] of node.steps.entries()) {
    if (
      !step.id.trim()
      || stepIds.has(step.id)
      || step.order !== index
    ) {
      diagnostics.push(applicationGraphStructureDiagnostic(
        `Application Saga ${node.id} requires unique ordered durable step identities.`,
      ));
    }
    stepIds.add(step.id);
    if (
      (step.kind === 'step' && step.compensation !== 'required')
      || (step.kind !== 'step' && step.compensation !== 'forbidden')
    ) {
      diagnostics.push(applicationGraphStructureDiagnostic(
        `Application Saga ${node.id} step ${step.id} has an invalid compensation classification.`,
      ));
    }
  }
  if (
    node.atomicity !== 'compensatingNoIsolation'
    || node.cancellation !== 'recoverThenCompensate'
    || node.maturity !== 'beta'
  ) {
    diagnostics.push(applicationGraphStructureDiagnostic(
      `Application Saga ${node.id} must retain the beta compensating, non-isolated recovery contract.`,
    ));
  }
  return diagnostics;
}

function applicationMLModelNodeStructureDiagnostics(
  node: ApplicationMLModelNode,
  graph: ApplicationGraph,
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const provider = graph.nodes.find(
    (candidate) => candidate.id === node.inference.nodeId,
  );
  if (provider?.kind !== 'provider' || provider.interface !== node.inference.interface) {
    diagnostics.push(applicationGraphStructureDiagnostic(
      `Application ML model ${node.id} must reference its selected inference provider.`,
    ));
  }
  if (!node.contract.name.trim() || !/^v[1-9][0-9]*$/.test(node.contract.version)) {
    diagnostics.push(applicationGraphStructureDiagnostic(
      `Application ML model ${node.id} must retain a stable versioned logical identity.`,
    ));
  }
  if (
    node.capabilities.length === 0
    || new Set(node.capabilities).size !== node.capabilities.length
    || node.capabilities.some(
      (capability) => capability !== 'predict' && capability !== 'batchPrediction',
    )
  ) {
    diagnostics.push(applicationGraphStructureDiagnostic(
      `Application ML model ${node.id} must declare unique supported prediction capabilities.`,
    ));
  }
  if (
    node.requirements.maximumBatchSize !== undefined
    && (!Number.isSafeInteger(node.requirements.maximumBatchSize)
      || node.requirements.maximumBatchSize < 1)
  ) {
    diagnostics.push(applicationGraphStructureDiagnostic(
      `Application ML model ${node.id} maximumBatchSize must be a positive integer.`,
    ));
  }
  if (
    node.requirements.timeoutMs !== undefined
    && (!Number.isSafeInteger(node.requirements.timeoutMs)
      || node.requirements.timeoutMs < 1)
  ) {
    diagnostics.push(applicationGraphStructureDiagnostic(
      `Application ML model ${node.id} timeoutMs must be a positive integer.`,
    ));
  }
  if (
    node.maturity !== 'beta'
    || node.provenance.artifactIdentity !== 'contentAddressed'
    || node.provenance.receipt !== 'required'
    || node.provenance.sensitiveValues !== 'redacted'
  ) {
    diagnostics.push(applicationGraphStructureDiagnostic(
      `Application ML model ${node.id} must retain the beta content-addressed, receipt-bearing, redacted contract.`,
    ));
  }
  return diagnostics;
}

function applicationWorkflowWorkerNodeStructureDiagnostics(node: ApplicationWorkflowWorkerNode, graph: ApplicationGraph): readonly Diagnostic[] {
  const handlerIds = new Set(graph.nodes.filter((candidate) => candidate.kind === 'taskHandler' || candidate.kind === 'workflowHandler').map((candidate) => candidate.id));
  const diagnostics: Diagnostic[] = [];
  if (node.handlers.length === 0) diagnostics.push(applicationGraphStructureDiagnostic(`Application workflow worker ${node.id} must include at least one task or workflow handler.`));
  for (const handler of node.handlers) if (!handlerIds.has(handler.nodeId)) diagnostics.push(applicationGraphStructureDiagnostic(`Application workflow worker ${node.id} references missing handler ${handler.nodeId}.`));
  if (!applicationGraphPositiveInteger(node.deployment.replicas) || !applicationGraphPositiveInteger(node.deployment.taskSlots) || !applicationGraphPositiveInteger(node.deployment.durableSlots)) diagnostics.push(applicationGraphStructureDiagnostic(`Application workflow worker ${node.id} requires positive replica, task-slot, and durable-slot counts.`));
  if (node.deployment.egress !== 'allowAll' && node.deployment.egress !== 'sameNamespace') diagnostics.push(applicationGraphStructureDiagnostic(`Application workflow worker ${node.id} requires an explicit supported egress posture.`));
  return diagnostics;
}

function applicationGraphPositiveInteger(value: ApplicationGraphNumberValue): boolean {
  return typeof value === 'number'
    ? Number.isInteger(value) && value > 0
    : /^\$\{[^{}]+\}$/.test(value);
}

function applicationServerRouteStructureDiagnostics(
  node: ApplicationServerNode,
  graph: ApplicationGraph,
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const route of node.routes) {
    if (!route.diagnostics) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application server route ${node.id}.${route.id} must declare route diagnostics.`));
      continue;
    }
    diagnostics.push(...validateApplicationRouteDiagnosticsContract(`${node.id}.${route.id}`, route.diagnostics));
    if (route.functionNative) {
      const operationIdentifiers = new Set<string>();
      for (const binding of route.functionNative.operationBindings ?? []) {
        if (!binding.identifier.trim() || operationIdentifiers.has(binding.identifier)) {
          diagnostics.push(applicationGraphStructureDiagnostic(
            `Application server route ${node.id}.${route.id} must retain unique function-native operation binding identifiers.`,
          ));
        }
        operationIdentifiers.add(binding.identifier);
        if (
          binding.runtimeOperationId !== undefined
          && !binding.runtimeOperationId.trim()
        ) {
          diagnostics.push(applicationGraphStructureDiagnostic(
            `Application server route ${node.id}.${route.id} operation ${binding.operationId} has an empty runtime operation alias.`,
          ));
        }
        const command = graph.nodes.find(
          (candidate) => candidate.id === binding.command.nodeId,
        );
        const handler = graph.nodes.find(
          (candidate) => candidate.id === binding.handler.nodeId,
        );
        if (command?.kind !== 'command' || handler?.kind !== 'commandHandler') {
          diagnostics.push(applicationGraphStructureDiagnostic(
            `Application server route ${node.id}.${route.id} operation ${binding.operationId} references a missing command or command handler.`,
          ));
        } else if (handler.command.nodeId !== command.id) {
          diagnostics.push(applicationGraphStructureDiagnostic(
            `Application server route ${node.id}.${route.id} operation ${binding.operationId} command and handler do not match.`,
          ));
        }
      }
      if (
        route.functionNative.idempotency.source !== 'http-idempotency-key'
        || route.functionNative.idempotency.contextScoped !== true
      ) {
        diagnostics.push(applicationGraphStructureDiagnostic(
          `Application server route ${node.id}.${route.id} must use context-scoped HTTP idempotency.`,
        ));
      }
      if (
        route.functionNative.requestBoundary.durableValues
          !== 'schema-normalized-only'
        || route.functionNative.requestBoundary.rawRequestCapture !== 'rejected'
        || route.functionNative.requestBoundary.principal
          !== (route.functionNative.webhookAuthentication
            ? 'provider-authenticated'
            : 'framework-authenticated')
      ) {
        diagnostics.push(applicationGraphStructureDiagnostic(
          `Application server route ${node.id}.${route.id} must retain the function-native request boundary.`,
        ));
      }
      diagnostics.push(
        ...applicationFunctionNativeTransactionMessages(
          `Application server route ${node.id}.${route.id}`,
          route.functionNative.transaction,
          'http-idempotency-key',
          graph,
        ).map(applicationGraphStructureDiagnostic),
      );
    }
  }
  return diagnostics;
}

function applicationProviderNodeStructureDiagnostics(
  node: ApplicationProviderNode,
  graph: ApplicationGraph,
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const profile = node.config?.profile;
  if (
    profile
    && typeof profile === 'object'
    && !Array.isArray(profile)
    && Reflect.get(profile, 'apiVersion') === 'applik8s.profileProvider/v1alpha1'
  ) {
    const selection =
      profile as unknown as ApplicationProfileProviderSelectionContract;
    for (const message of validateApplicationProfileDescriptor(selection.descriptor)) {
      diagnostics.push(applicationGraphStructureDiagnostic(message));
    }
    for (const message of validateApplicationProfileProviderSelection(
      selection,
      selection.descriptor,
    )) {
      diagnostics.push(applicationGraphStructureDiagnostic(message));
    }
    if (selection.qualification.capability !== node.interface) {
      diagnostics.push(
        applicationGraphStructureDiagnostic(
          `Application provider node ${node.id} profile qualification ${selection.qualification.capability} must match provider interface ${node.interface}.`,
        ),
      );
    }
    const nodes = new Map(graph.nodes.map((candidate) => [candidate.id, candidate]));
    for (const branch of selection.branches) {
      for (const dependency of branch.privateRuntime?.postgres ?? []) {
        const database = nodes.get(dependency.databaseProviderNodeId);
        if (
          database?.kind !== 'provider'
          || database.interface !== 'TransactionalDatabase'
        ) {
          diagnostics.push(
            applicationGraphStructureDiagnostic(
              `Application provider node ${node.id} branch ${branch.variant} private PostgreSQL ${dependency.alias} must reference a TransactionalDatabase provider.`,
            ),
          );
        }
      }
    }
  }
  if (!node.contract) {
    return diagnostics;
  }
  if (node.contract.interface !== node.interface) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application provider node ${node.id} contract interface ${node.contract.interface} must match provider interface ${node.interface}.`));
  }
  diagnostics.push(...validateApplicationProviderInterfaceContract(node.contract));
  return diagnostics;
}

function applicationWorkloadJobNodeStructureDiagnostics(node: ApplicationWorkloadJobNode): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (node.runtime.materialization === 'kubernetes-cronjob' && !node.schedule) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application job node ${node.id} uses kubernetes-cronjob runtime without a schedule contract.`));
  }
  if (node.schedule && node.runtime.materialization !== 'kubernetes-cronjob') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application job node ${node.id} declares a schedule but is not materialized as kubernetes-cronjob.`));
  }
  if (node.schedule?.startingDeadlineSeconds !== undefined && node.schedule.startingDeadlineSeconds < 0) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application job node ${node.id} schedule startingDeadlineSeconds must be >= 0.`));
  }
  if (node.phase.terminalPhases.includes(node.phase.initialPhase)) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application job node ${node.id} initial phase must not be terminal.`));
  }
  if (node.retry.mode === 'boundedExponentialBackoff') {
    if (node.retry.maxAttempts === undefined || node.retry.maxAttempts < 1) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application job node ${node.id} bounded retry policy requires maxAttempts >= 1.`));
    }
    if (node.retry.initialDelayMs === undefined || node.retry.initialDelayMs < 0) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application job node ${node.id} bounded retry policy requires initialDelayMs >= 0.`));
    }
    if (node.retry.maxDelayMs === undefined || node.retry.maxDelayMs < (node.retry.initialDelayMs ?? 0)) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application job node ${node.id} bounded retry policy requires maxDelayMs >= initialDelayMs.`));
    }
  }
  if (node.runtime.statusLifecycle) {
    diagnostics.push(...validateApplicationJobStatusLifecycleContract(node.runtime.statusLifecycle));
    const jobsPath = node.runtime.statusLifecycle.ownership.appStatusSchemaContract?.jobsPath;
    const statusPath = node.runtime.phaseStatus.statusPath;
    if (jobsPath && !statusPath?.startsWith(`${jobsPath}.`)) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application job node ${node.id} phaseStatus.statusPath must be nested under ${jobsPath}.`));
    }
    // typecast: durableStatusUpdater exists only on generated job runtimes; graph validation accepts the wider job runtime contract.
    const durableStatusUpdater = (node.runtime as Partial<GeneratedJobRuntimeContract>).durableStatusUpdater;
    if (durableStatusUpdater && durableStatusUpdater.writes.statusPath !== statusPath) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application job node ${node.id} durable status updater must write the same statusPath as runtime.phaseStatus.`));
    }
  }
  diagnostics.push(...applicationObservabilityStructureDiagnostics(`Application job node ${node.id}`, node.observability, 'jobDiagnostics'));
  return diagnostics;
}

function applicationGraphStructureDiagnostic(message: string): Diagnostic {
  return {
    severity: 'error',
    code: 'COMPATIBILITY_FAILED',
    message,
    recovery: { summary: 'Fix the application graph contract before lowering it to generated artifacts.' },
  };
}
