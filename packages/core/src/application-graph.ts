import type { ApiVersion, Condition, Diagnostic, JsonObject, KubernetesName, NamespaceName, ObjectRef, ResourceScope, SourceLocation } from './common.js';
import type { PermissionRule } from './resource.js';

export type ApplicationGraphVersion = 'applik8s.appGraph/v1alpha1';

export const applicationGraphMetadataProperty = '__applik8sApplicationGraph';

export const applicationGraphArtifactFileName = 'application-graph.json';

export interface ApplicationGraphArtifactReference {
  readonly apiVersion: ApplicationGraphVersion;
  readonly path: string;
  readonly digest: string;
}

export type ApplicationGraphNodeKind =
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
  | 'job'
  | 'config'
  | 'secret'
  | 'exposure'
  | 'provider'
  | 'permission'
  | 'typeKroResource';

// typecast: the runtime node-kind registry is intentionally kept as a literal tuple while checked against the public union.
export const applicationGraphNodeKinds = [
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
  'job',
  'config',
  'secret',
  'exposure',
  'provider',
  'permission',
  'typeKroResource',
] as const satisfies readonly ApplicationGraphNodeKind[];

export type ApplicationBuiltInProviderInterfaceKind =
  | 'ModelStore'
  | 'IndexStore'
  | 'CounterStore'
  | 'EventSource'
  | 'EventLog'
  | 'Secret'
  | 'Queue'
  | 'ObjectStorage'
  | 'HttpExposure'
  | 'Certificate'
  | 'DnsPublication'
  | 'CredentialStore';

/** Built-ins remain strongly named while versioned provider packages may add interfaces without editing core. */
export type ApplicationProviderInterfaceKind = ApplicationBuiltInProviderInterfaceKind | (string & {});

// typecast: the runtime provider-interface registry is intentionally kept as a literal tuple while checked against the public union.
export const applicationProviderInterfaceKinds = [
  'ModelStore',
  'IndexStore',
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
] as const satisfies readonly ApplicationProviderInterfaceKind[];

// typecast: v0.3 predates the experimental EventLog surface introduced for v0.4 durable behavior.
export const applicationV03ProviderInterfaceKinds = [
  'ModelStore',
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
}

export interface ApplicationGraphMetadata {
  readonly name: KubernetesName;
  readonly namespace?: NamespaceName;
  readonly sourceLocation?: SourceLocation;
  readonly labels?: Readonly<Record<string, string>>;
  readonly annotations?: Readonly<Record<string, string>>;
}

export type ApplicationGraphNode =
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
  | ApplicationJobNode
  | ApplicationConfigNode
  | ApplicationSecretNode
  | ApplicationExposureNode
  | ApplicationProviderNode
  | ApplicationPermissionNode
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
}

export interface ApplicationModelNode extends ApplicationGraphNodeBase<'model'> {
  readonly entity: ApplicationEntityContract;
  readonly store: ApplicationProviderRef<'ModelStore'>;
  readonly schema: ApplicationModelSchemaContract;
  readonly materialization: ApplicationModelMaterializationContract;
  readonly runtime?: ApplicationModelRuntimeContract;
  readonly generatedResources?: readonly ApplicationGeneratedResourceContract[];
}

export interface ApplicationServerNode extends ApplicationGraphNodeBase<'server'> {
  readonly routes: readonly ApplicationRouteContract[];
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
  readonly provider: ApplicationProviderRef<'IndexStore'>;
  readonly partitionBy?: ApplicationExpressionContract;
  readonly filter?: ApplicationExpressionContract;
  readonly orderBy?: ApplicationExpressionContract;
  readonly generatedResources?: readonly ApplicationGeneratedResourceContract[];
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
    readonly history: readonly ApplicationGraphNodeRef[];
    readonly outbox: readonly ApplicationGraphNodeRef[];
    readonly commands?: readonly ApplicationGraphNodeRef[];
  };
  readonly retry: ApplicationRetryPolicy;
  readonly retention: ApplicationCommandRetentionContract;
  readonly effectBoundary: 'transactionSafeOnly';
  readonly handlerSource: string;
  readonly initializeSource?: string;
  readonly eventBindings?: readonly { readonly identifier: string; readonly event: ApplicationGraphNodeRef }[];
  readonly commandBindings?: readonly { readonly identifier: string; readonly command: ApplicationGraphNodeRef }[];
  readonly projectionReadiness: ApplicationCommandProjectionReadinessContract;
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
  readonly replicas: number;
  /** Maximum concurrently executing messages in each processor pod. */
  readonly concurrency: number;
  /** Durable-consumer delivery window shared by all replicas. */
  readonly maxAckPending: number;
  readonly resources: {
    readonly requests: { readonly cpu: string; readonly memory: string };
    readonly limits: { readonly cpu: string; readonly memory: string };
  };
  readonly disruption: { readonly maxUnavailable: number } | { readonly minAvailable: number } | { readonly disabled: true };
  readonly nodeSelector?: Readonly<Record<string, string>>;
}

export interface ApplicationModelRuntimeContract {
  readonly name: string;
  readonly tableName: string;
  readonly provider: 'postgres';
  readonly database: string;
  readonly clusterName: string;
  readonly secretName: string;
  readonly secretKey: string;
  readonly secretNamespace?: string;
  readonly connectionEnvName: string;
  readonly constraints: readonly ApplicationModelConstraint[];
  readonly indexes: readonly ApplicationModelIndex[];
  readonly retention: ApplicationRetentionPolicy;
}

export interface ApplicationJobNode extends ApplicationGraphNodeBase<'job'> {
  readonly task: ApplicationJobTaskContract;
  readonly schedule?: ApplicationScheduleContract;
  readonly phase: ApplicationPhaseContract;
  readonly resources: readonly ApplicationResourceRef[];
  readonly retry: ApplicationRetryPolicy;
  readonly runtime: ApplicationJobRuntimeContract;
  readonly observability: ApplicationObservabilityContract;
  readonly generatedResources?: readonly ApplicationGeneratedResourceContract[];
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

export interface ApplicationExposureNode extends ApplicationGraphNodeBase<'exposure'> {
  readonly provider: ApplicationProviderRef<'HttpExposure'>;
  readonly certificate?: ApplicationProviderRef<'Certificate'>;
  readonly dnsPublication?: ApplicationProviderRef<'DnsPublication'>;
  readonly service: string;
  readonly hostnames: readonly string[];
  readonly tls: 'required' | 'optional' | 'disabled';
  readonly tlsIntent?: ApplicationTlsIntentContract;
  readonly dnsIntent?: ApplicationDnsIntentContract;
  readonly publicUrl: string;
  readonly readiness: ApplicationExposureReadinessContract;
  readonly generatedResources: readonly ApplicationGeneratedResourceContract[];
}

export type ApplicationTlsIntentContract =
  | { readonly mode: 'disabled' }
  | { readonly mode: 'external'; readonly secretName: string }
  | { readonly mode: 'managed'; readonly secretName: string; readonly issuerRef: { readonly name: string; readonly kind: 'Issuer' | 'ClusterIssuer' } };

export type ApplicationDnsIntentContract =
  | { readonly mode: 'disabled' }
  | { readonly mode: 'managed'; readonly ttlSeconds?: number };

export interface ApplicationExposureReadinessContract {
  readonly ingress: 'resourceApplied';
  readonly loadBalancer: 'statusObserved';
  readonly certificate: 'notRequested' | 'external' | 'readyCondition';
  readonly dns: 'notRequested' | 'intentApplied' | 'propagationUnverified';
  readonly publicUrl: 'derived';
}

export interface GeneratedJobContract extends ApplicationJobNode {
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
  readonly purpose: 'modelStore' | 'indexStore' | 'counterStore' | 'eventSource' | 'eventLog' | 'secret' | 'queue' | 'objectStorage' | 'httpExposure' | 'certificate' | 'dnsPublication' | 'credentialStore' | (string & {});
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
  readonly secretRefs?: readonly ApplicationResourceRef[];
  readonly volumeMounts?: readonly string[];
  readonly permissions?: readonly PermissionRule[];
  readonly readiness?: ApplicationProviderReadinessContract;
  readonly metadataLinks?: readonly ApplicationGraphMetadataLink[];
}

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
  readonly guarantees?: ApplicationModelStoreGuaranteesContract;
}

export interface ApplicationModelStoreGuaranteesContract {
  readonly identity: 'stableId';
  readonly uniqueness: 'databaseConstraint';
  readonly indexes: 'declaredSecondaryIndexes';
  readonly transactions: 'required' | 'supported' | 'unsupported';
  readonly retention: 'retain' | 'deleteWithApplication' | 'ttl';
  readonly migrationOwnership: 'generatedJob' | 'external' | 'none';
  readonly semantics?: ApplicationModelStoreSemanticsContract;
}

export interface ApplicationModelStoreSemanticsContract {
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
  readonly provider: ApplicationProviderRef<'ModelStore'>;
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
  readonly provider: ApplicationProviderRef<'ModelStore'>;
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
  readonly method: string;
  readonly path: string;
  readonly diagnostics?: ApplicationRouteDiagnosticsContract;
  readonly sourceLocation?: SourceLocation;
  readonly metadataLinks?: readonly ApplicationGraphMetadataLink[];
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
  readonly requiredModelStoreSemantics: readonly ApplicationModelStoreSemanticsContract[];
  readonly requiredRuntimeModuleInterfaces: readonly ApplicationRuntimeModuleInterfaceContract[];
  readonly requiredProviderInterfaces: readonly ApplicationProviderInterfaceContract[];
  readonly providerCompatibility: ApplicationProviderCompatibilityMatrixContract;
  readonly requiredStatusOwnership: readonly ApplicationDurableStatusOwnershipContract[];
  readonly requiredStatusEvidence: ApplicationV03StatusEvidenceContract;
  readonly requiredModelStoreEvidence: ApplicationV03ModelStoreEvidenceContract;
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

export interface ApplicationV03ModelStoreEvidenceContract {
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
  | 'applik8s-modelstore-missing-credentials'
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
  // typecast: Array.includes needs an erased string array to test arbitrary input while preserving the type predicate result.
  return (applicationProviderInterfaceKinds as readonly string[]).includes(value);
}

export function normalizeApplicationGraph(graph: ApplicationGraph): ApplicationGraph {
  return {
    ...graph,
    nodes: [...graph.nodes].sort(compareApplicationGraphNodes),
    edges: [...graph.edges].sort(compareApplicationGraphEdges),
    providerRequirements: [...(graph.providerRequirements ?? [])].sort(compareApplicationProviderRequirements),
    providerBindings: [...(graph.providerBindings ?? [])].sort(compareApplicationProviderBindings),
    compatibility: {
      stablePublicApis: sortedStrings(graph.compatibility.stablePublicApis),
      documentedInternalContracts: sortedStrings(graph.compatibility.documentedInternalContracts),
      experimentalSurfaces: sortedStrings(graph.compatibility.experimentalSurfaces),
      postV3Surfaces: sortedStrings(graph.compatibility.postV3Surfaces),
      labels: [...(graph.compatibility.labels ?? [])].sort(compareApplicationCompatibilityLabels),
    },
  };
}

export function serializeApplicationGraph(graph: ApplicationGraph): string {
  return `${stableJsonStringify(normalizeApplicationGraph(graph))}\n`;
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

  return diagnostics;
}

export function validateApplicationGraphCompatibilityPolicy(graph: ApplicationGraph): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const labelsByName = new Map(graph.compatibility.labels.map((label) => [label.name, label]));
  const duplicateLabels = duplicateApplicationCompatibilityLabels(graph.compatibility.labels);
  for (const duplicate of duplicateLabels) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application graph compatibility label ${duplicate} is declared more than once.`));
  }
  for (const api of graph.compatibility.stablePublicApis) {
    const label = labelsByName.get(api);
    if (label?.surface !== 'stablePublicApi') {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application graph stable public API ${api} must have a stablePublicApi compatibility label.`));
      continue;
    }
    if (!label.rationale || label.rationale.trim().length === 0) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application graph stable public API ${api} must document its implementation or fail-closed rationale.`));
    }
    if (!label.implementation) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application graph stable public API ${api} must declare implementation support.`));
    }
    if (label.implementation === 'failClosedReserved' && (label.diagnostics?.length ?? 0) === 0) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application graph stable public API ${api} is fail-closed reserved but has no release-facing diagnostics.`));
    }
    const rationale = label.rationale?.toLowerCase() ?? '';
    if ((rationale.includes('not implemented') || rationale.includes('not enabled')) && !rationale.includes('fail-closed') && !rationale.includes('fail closed')) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application graph stable public API ${api} describes missing implementation without documented fail-closed behavior.`));
    }
  }
  for (const node of graph.nodes) {
    const stableApi = stablePublicApiForApplicationGraphNode(node);
    if (!stableApi) {
      continue;
    }
    const label = labelsByName.get(stableApi);
    if (label?.surface === 'stablePublicApi' && label.implementation === 'implemented' && node.stability !== 'stable') {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application graph node ${node.id} is emitted by stable public API ${stableApi} but has ${node.stability} stability.`));
    }
  }
  diagnostics.push(...compatibilitySurfaceDiagnostics('documented internal contract', 'documentedInternalContract', graph.compatibility.documentedInternalContracts, labelsByName));
  diagnostics.push(...compatibilitySurfaceDiagnostics('experimental surface', 'experimentalSurface', graph.compatibility.experimentalSurfaces, labelsByName));
  diagnostics.push(...compatibilitySurfaceDiagnostics('post-v0.3 surface', 'postV3Surface', graph.compatibility.postV3Surfaces, labelsByName));
  return diagnostics;
}

function stablePublicApiForApplicationGraphNode(node: ApplicationGraphNode): string | undefined {
  if (node.kind === 'provider') {
    return `provider.${node.interface}`;
  }
  if (node.kind === 'counter') {
    return 'Resource.increment';
  }
  if (node.kind === 'index') {
    return 'Resource.index';
  }
  if (node.kind === 'job') {
    return node.schedule ? 'app.schedule' : 'app.job';
  }
  const apiByNodeKind: Partial<Record<ApplicationGraphNodeKind, string>> = {
    crd: 'app.crd',
    model: 'app.model',
    server: 'app.server',
    aggregate: 'app.aggregate',
    config: 'app.config',
    secret: 'app.secret',
    exposure: 'app.expose',
  };
  return apiByNodeKind[node.kind];
}

function duplicateApplicationCompatibilityLabels(labels: readonly ApplicationCompatibilityLabel[]): readonly string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const label of labels) {
    if (seen.has(label.name)) {
      duplicates.add(label.name);
      continue;
    }
    seen.add(label.name);
  }
  return [...duplicates].sort(compareStrings);
}

function compatibilitySurfaceDiagnostics(kind: string, surface: ApplicationCompatibilitySurface, names: readonly string[], labelsByName: ReadonlyMap<string, ApplicationCompatibilityLabel>): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const name of names) {
    const label = labelsByName.get(name);
    if (label?.surface !== surface) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application graph ${kind} ${name} must have a ${surface} compatibility label.`));
      continue;
    }
    if (!label.rationale || label.rationale.trim().length === 0) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application graph ${kind} ${name} must document its compatibility rationale.`));
    }
  }
  return diagnostics;
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

export function validateApplicationModelStoreSemanticsContract(contract: ApplicationModelStoreSemanticsContract): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (contract.generatedRuntimeParity !== 'required') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application ModelStore semantics must require generated runtime parity.'));
  }
  if (contract.scriptRuntimeParity !== 'required' && contract.scriptRuntimeParity !== 'notSupported') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application ModelStore semantics must declare script runtime parity.'));
  }
  if (contract.query.defaultLimit < 1 || contract.query.maxLimit < contract.query.defaultLimit) {
    diagnostics.push(applicationGraphStructureDiagnostic('Application ModelStore query semantics require maxLimit >= defaultLimit >= 1.'));
  }
  if (!contract.indexes.partitionRequired) {
    diagnostics.push(applicationGraphStructureDiagnostic('Application ModelStore index semantics must require explicit partitions for v0.3.'));
  }
  if (contract.indexes.orderBy !== 'declaredIndexFieldsOnly') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application ModelStore index ordering must be limited to declared index fields.'));
  }
  if (contract.constraints.duplicateKeyDiagnostic !== 'applik8s-model-duplicate-key') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application ModelStore duplicate constraint semantics must use applik8s-model-duplicate-key diagnostics.'));
  }
  if (contract.transactions.singleOperationAtomicity !== 'databaseStatement') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application ModelStore transaction semantics must declare database statement atomicity for single operations.'));
  }
  if (contract.transactions.multiOperationApi !== 'absentFromPublicApi' && contract.transactions.multiOperationApi !== 'implemented') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application ModelStore transaction semantics must declare whether a multi-operation API is public.'));
  }
  if (contract.transactions.multiOperationApi === 'absentFromPublicApi' && contract.transactions.multiOperationBehavior !== 'methodAbsent') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application ModelStore absent transaction API must leave multi-operation transaction methods absent.'));
  }
  if (contract.transactions.declaration === 'unsupported' && contract.transactions.multiOperationApi === 'implemented' && contract.transactions.multiOperationBehavior !== 'failClosed') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application ModelStore unsupported transaction declarations must fail closed when the public transaction API is present.'));
  }
  if (contract.transactions.declaration !== 'unsupported' && contract.transactions.multiOperationApi === 'implemented' && contract.transactions.multiOperationBehavior !== 'runtimeTransaction') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application ModelStore implemented transaction API must declare runtime transaction behavior.'));
  }
  if (!contract.migrationHistory.tableName || !contract.migrationHistory.revisionColumn || !contract.migrationHistory.appliedAtColumn) {
    diagnostics.push(applicationGraphStructureDiagnostic('Application ModelStore migration history semantics must declare table, revision, and applied-at columns.'));
  }
  if (contract.retention.mode === 'ttl' && contract.retention.ttlSeconds === undefined) {
    diagnostics.push(applicationGraphStructureDiagnostic('Application ModelStore ttl retention semantics require ttlSeconds.'));
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
  const requiredNodeKinds = ['model', 'server', 'job', 'provider'] as const satisfies readonly ApplicationGraphNodeKind[];
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
  if ((contract.requiredModelStoreSemantics?.length ?? 0) === 0) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${contract.name} must require ModelStore semantic conformance.`));
  }
  for (const semantics of contract.requiredModelStoreSemantics ?? []) {
    diagnostics.push(...validateApplicationModelStoreSemanticsContract(semantics));
  }
  if (contract.requiredModelStoreEvidence.scriptRuntimeParity === 'localAndOptInLiveGate' && !(contract.requiredModelStoreSemantics ?? []).some((semantics) => semantics.scriptRuntimeParity === 'required')) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${contract.name} ModelStore evidence requires script-runtime parity but no ModelStore semantics require it.`));
  }
  if (contract.requiredModelStoreEvidence.transactionCoverage === 'required' && !(contract.requiredModelStoreSemantics ?? []).some((semantics) => semantics.transactions.multiOperationApi === 'implemented' && semantics.transactions.multiOperationBehavior === 'runtimeTransaction')) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${contract.name} ModelStore evidence requires transaction coverage but no ModelStore semantics declare runtime transactions.`));
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
  diagnostics.push(...validateApplicationV03ModelStoreEvidenceContract(contract.name, contract.requiredModelStoreEvidence));
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

function validateApplicationV03ModelStoreEvidenceContract(name: string, evidence: ApplicationV03ModelStoreEvidenceContract): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (evidence.generatedRuntimeParity !== 'localGeneratedArtifactGate') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${name} ModelStore evidence must require local generated-artifact parity.`));
  }
  if (evidence.scriptRuntimeParity !== 'localAndOptInLiveGate') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${name} ModelStore evidence must require local and opt-in live script-runtime parity.`));
  }
  if (evidence.liveGate !== 'requiredBeforeAnnouncement') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${name} ModelStore evidence must require a live gate before announcement.`));
  }
  if (evidence.queryIndexConstraintCoverage !== 'required') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${name} ModelStore evidence must require query, index, and constraint coverage.`));
  }
  if (evidence.transactionCoverage !== 'required') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${name} ModelStore evidence must require transaction coverage.`));
  }
  if (evidence.migrationDriftCoverage !== 'required') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${name} ModelStore evidence must require migration drift coverage.`));
  }
  if (evidence.unsupportedSemantics !== 'failClosed') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application v0.3 pressure test ${name} ModelStore evidence must fail closed for unsupported semantics.`));
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
  const providers = graph.nodes.filter((node): node is ApplicationProviderNode<TInterface> => node.kind === 'provider' && node.interface === requirement.interface);
  const providerById = new Map(graph.nodes.filter((node): node is ApplicationProviderNode => node.kind === 'provider').map((provider) => [provider.id, provider]));
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
      return applicationJobNodeStructureDiagnostics(node);
    case 'provider':
      return applicationProviderNodeStructureDiagnostics(node);
    case 'server':
      return [...applicationObservabilityStructureDiagnostics(`Application server node ${node.id}`, node.observability, 'routeDiagnostics'), ...applicationServerRouteStructureDiagnostics(node)];
    case 'command':
      return applicationCommandNodeStructureDiagnostics(node);
    case 'event':
      return applicationEventNodeStructureDiagnostics(node);
    case 'commandHandler':
      return applicationCommandHandlerNodeStructureDiagnostics(node, graph);
    case 'processor':
      return applicationProcessorNodeStructureDiagnostics(node, graph);
    default:
      return [];
  }
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
  if (!node.deployment || !Number.isInteger(node.deployment.replicas) || node.deployment.replicas < 1 || node.deployment.replicas > 32) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application processor node ${node.id} deployment.replicas must be an integer between 1 and 32.`));
  }
  if (!node.deployment || !Number.isInteger(node.deployment.concurrency) || node.deployment.concurrency < 1 || node.deployment.concurrency > 64) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application processor node ${node.id} deployment.concurrency must be an integer between 1 and 64.`));
  }
  if (node.deployment && (!Number.isInteger(node.deployment.maxAckPending) || node.deployment.maxAckPending < node.deployment.replicas * node.deployment.concurrency || node.deployment.maxAckPending > 65_536)) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application processor node ${node.id} deployment.maxAckPending must be an integer between replicas * concurrency and 65536.`));
  }
  return diagnostics;
}

function applicationServerRouteStructureDiagnostics(node: ApplicationServerNode): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const route of node.routes) {
    if (!route.diagnostics) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application server route ${node.id}.${route.id} must declare route diagnostics.`));
      continue;
    }
    diagnostics.push(...validateApplicationRouteDiagnosticsContract(`${node.id}.${route.id}`, route.diagnostics));
  }
  return diagnostics;
}

function validateApplicationRouteDiagnosticsContract(owner: string, contract: ApplicationRouteDiagnosticsContract): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (contract.routeFailureEvent !== 'applik8s-server-route-failure') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application route diagnostics ${owner} routeFailureEvent must be applik8s-server-route-failure.`));
  }
  if (contract.actionFailureEvent !== 'applik8s-route-action-failure') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application route diagnostics ${owner} actionFailureEvent must be applik8s-route-action-failure.`));
  }
  if (contract.failurePolicy !== 'failClosed') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application route diagnostics ${owner} failurePolicy must fail closed.`));
  }
  if (contract.partialEffects !== 'unknownAfterActionStarted') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application route diagnostics ${owner} must declare unknown partial effects after route actions start.`));
  }
  if (contract.sourceMaps !== 'required') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application route diagnostics ${owner} must require source maps.`));
  }
  const fields = new Set(contract.includes);
  for (const field of ['routeId', 'method', 'path', 'module', 'sourceLocation', 'bundleInputs', 'action', 'diagnostic', 'stack'] satisfies readonly ApplicationRouteDiagnosticField[]) {
    if (!fields.has(field)) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application route diagnostics ${owner} must include ${field}.`));
    }
  }
  return diagnostics;
}

function applicationProviderNodeStructureDiagnostics(node: ApplicationProviderNode): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!node.contract) {
    return diagnostics;
  }
  if (node.contract.interface !== node.interface) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application provider node ${node.id} contract interface ${node.contract.interface} must match provider interface ${node.interface}.`));
  }
  diagnostics.push(...validateApplicationProviderInterfaceContract(node.contract));
  return diagnostics;
}

function applicationModelNodeStructureDiagnostics(node: ApplicationModelNode, graph: ApplicationGraph): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (node.store.interface !== node.materialization.provider.interface || node.store.nodeId !== node.materialization.provider.nodeId) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application model node ${node.id} has inconsistent ModelStore refs between store and materialization.provider.`));
  }
  if (node.schema.migrations.strategy === 'generatedJob') {
    const hasMigrationJob = graph.edges.some((edge) => edge.relationship === 'dependsOn' && edge.to.nodeId === node.id && graph.nodes.some((candidate) => candidate.id === edge.from.nodeId && candidate.kind === 'job' && candidate.task.taskKind === 'migration'));
    if (!hasMigrationJob) {
      diagnostics.push(applicationGraphStructureDiagnostic(`Application model node ${node.id} declares generatedJob migrations but no migration job depends on it.`));
    }
  }
  if (node.schema.retention?.mode === 'ttl' && node.schema.retention.ttlSeconds === undefined) {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application model node ${node.id} uses ttl retention without ttlSeconds.`));
  }
  return diagnostics;
}

function applicationJobNodeStructureDiagnostics(node: ApplicationJobNode): readonly Diagnostic[] {
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

function applicationObservabilityStructureDiagnostics(owner: string, observability: ApplicationObservabilityContract | undefined, diagnosticsArtifactKind: ApplicationGeneratedArtifactKind): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!observability) {
    diagnostics.push(applicationGraphStructureDiagnostic(`${owner} must declare generated observability metadata.`));
    return diagnostics;
  }
  if (observability.health.mode === 'http') {
    if (!observability.health.readinessPath?.startsWith('/')) {
      diagnostics.push(applicationGraphStructureDiagnostic(`${owner} HTTP observability readinessPath must be an absolute path.`));
    }
    if (!observability.health.livenessPath?.startsWith('/')) {
      diagnostics.push(applicationGraphStructureDiagnostic(`${owner} HTTP observability livenessPath must be an absolute path.`));
    }
  }
  if (observability.logs.format !== 'json') {
    diagnostics.push(applicationGraphStructureDiagnostic(`${owner} observability logs must use json format.`));
  }
  if (!observability.logs.component || observability.logs.component.trim().length === 0) {
    diagnostics.push(applicationGraphStructureDiagnostic(`${owner} observability logs must declare a runtime component.`));
  }
  if (observability.logs.failureEvents.length === 0) {
    diagnostics.push(applicationGraphStructureDiagnostic(`${owner} observability logs must declare failure events.`));
  }
  if (observability.events.length === 0) {
    diagnostics.push(applicationGraphStructureDiagnostic(`${owner} observability must declare diagnostic events.`));
  }
  if (observability.metrics.mode === 'declaredHooks' && observability.metrics.names.length === 0) {
    diagnostics.push(applicationGraphStructureDiagnostic(`${owner} observability metrics declaredHooks mode must name emitted hooks.`));
  }
  if (observability.sourceMaps === 'required' && observability.replayArtifacts.length === 0) {
    diagnostics.push(applicationGraphStructureDiagnostic(`${owner} observability requiring source maps must declare replay artifacts.`));
  }
  if (observability.diagnosticsArtifact.kind !== diagnosticsArtifactKind) {
    diagnostics.push(applicationGraphStructureDiagnostic(`${owner} observability diagnostics artifact must be ${diagnosticsArtifactKind}.`));
  }
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

function uniqueApplicationProviderRefs(refs: readonly ApplicationProviderRef[]): readonly ApplicationProviderRef[] {
  const byKey = new Map<string, ApplicationProviderRef>();
  for (const ref of refs) {
    byKey.set(`${ref.interface}:${ref.nodeId}`, ref);
  }
  return [...byKey.values()];
}

function applicationProviderRefDiagnostics(owner: string, ref: ApplicationProviderRef, providerById: ReadonlyMap<string, ApplicationProviderNode>): readonly Diagnostic[] {
  const provider = providerById.get(ref.nodeId);
  if (!provider) {
    return [applicationProviderBindingDiagnostic(`${owner} requires ${ref.interface} provider ${ref.nodeId}, but that provider node is missing.`)];
  }
  if (provider.interface !== ref.interface) {
    return [applicationProviderBindingDiagnostic(`${owner} requires ${ref.interface} provider ${ref.nodeId}, but the provider node implements ${provider.interface}.`)];
  }
  return [];
}

function applicationProviderRefsForNode(node: ApplicationGraphNode): readonly ApplicationProviderRef[] {
  switch (node.kind) {
    case 'model':
      return [node.store, node.materialization.provider];
    case 'server':
      return node.exposure ? [node.exposure] : [];
    case 'index':
      return [node.provider];
    case 'counter':
      return node.provider ? [node.provider] : [];
    case 'processor':
      return node.eventLog ? [node.eventLog] : [];
    default:
      return [];
  }
}

function applicationProviderBindingDiagnostic(message: string): Diagnostic {
  return {
    severity: 'error',
    code: 'COMPATIBILITY_FAILED',
    message,
    recovery: { summary: 'Bind exactly one matching provider before lowering this application graph.' },
  };
}

function compareApplicationGraphNodes(left: ApplicationGraphNode, right: ApplicationGraphNode): number {
  return compareStrings(left.id, right.id) || compareStrings(left.kind, right.kind) || compareStrings(left.name, right.name);
}

function compareApplicationGraphEdges(left: ApplicationGraphEdge, right: ApplicationGraphEdge): number {
  return compareStrings(left.from.nodeId, right.from.nodeId) || compareStrings(left.relationship, right.relationship) || compareStrings(left.to.nodeId, right.to.nodeId);
}

function compareApplicationProviderRequirements(left: ApplicationProviderRequirement, right: ApplicationProviderRequirement): number {
  return compareStrings(left.id, right.id) || compareStrings(left.interface, right.interface) || compareStrings(left.consumer.nodeId, right.consumer.nodeId);
}

function compareApplicationProviderBindings(left: ApplicationProviderBindingContract, right: ApplicationProviderBindingContract): number {
  return compareStrings(left.requirement, right.requirement) || compareStrings(left.provider.interface, right.provider.interface) || compareStrings(left.provider.nodeId, right.provider.nodeId);
}

function compareApplicationCompatibilityLabels(left: ApplicationCompatibilityLabel, right: ApplicationCompatibilityLabel): number {
  return compareStrings(left.surface, right.surface) || compareStrings(left.name, right.name);
}

function sortedStrings(values: readonly string[]): readonly string[] {
  return [...values].sort(compareStrings);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableJsonStringify(value: unknown): string {
  if (value === undefined) {
    return 'null';
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJsonStringify).join(',')}]`;
  }
  const entries = Object.entries(value)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([leftKey], [rightKey]) => compareStrings(leftKey, rightKey));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJsonStringify(entryValue)}`).join(',')}}`;
}
