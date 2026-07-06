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
  | 'job'
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
  'job',
  'provider',
  'permission',
  'typeKroResource',
] as const satisfies readonly ApplicationGraphNodeKind[];

export type ApplicationProviderInterfaceKind =
  | 'ModelStore'
  | 'IndexStore'
  | 'CounterStore'
  | 'EventSource'
  | 'Secret'
  | 'Queue'
  | 'ObjectStorage'
  | 'HttpExposure'
  | 'CredentialStore';

// typecast: the runtime provider-interface registry is intentionally kept as a literal tuple while checked against the public union.
export const applicationProviderInterfaceKinds = [
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
  | ApplicationJobNode
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
  readonly generatedResources?: readonly ApplicationGeneratedResourceContract[];
}

export interface ApplicationServerNode extends ApplicationGraphNodeBase<'server'> {
  readonly routes: readonly ApplicationRouteContract[];
  readonly resources: readonly ApplicationResourceRef[];
  readonly indexes: readonly ApplicationGraphNodeRef[];
  readonly exposure?: ApplicationProviderRef<'HttpExposure'>;
  readonly generatedResources?: readonly ApplicationGeneratedResourceContract[];
}

export interface ApplicationOperatorNode extends ApplicationGraphNodeBase<'operator'> {
  readonly resources: readonly ApplicationResourceRef[];
  readonly watches: readonly ApplicationWatchScope[];
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

export interface ApplicationJobNode extends ApplicationGraphNodeBase<'job'> {
  readonly task: ApplicationJobTaskContract;
  readonly schedule?: ApplicationScheduleContract;
  readonly phase: ApplicationPhaseContract;
  readonly resources: readonly ApplicationResourceRef[];
  readonly retry: ApplicationRetryPolicy;
  readonly runtime: ApplicationJobRuntimeContract;
  readonly generatedResources?: readonly ApplicationGeneratedResourceContract[];
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
  readonly fallback?: 'generatedStatusConfigMap';
  readonly appStatusSchema: 'required' | 'bestEffort' | 'unsupported';
  readonly durableStore?: ApplicationResourceRef;
  readonly conflictPolicy: 'mergePatch' | 'failClosed';
  readonly diagnostics: readonly ApplicationDiagnosticContract[];
}

export interface ApplicationProviderNode<TInterface extends ApplicationProviderInterfaceKind = ApplicationProviderInterfaceKind> extends ApplicationGraphNodeBase<'provider'> {
  readonly interface: TInterface;
  readonly implementation: string;
  readonly config?: JsonObject;
}

export interface ApplicationProviderRequirement<TInterface extends ApplicationProviderInterfaceKind = ApplicationProviderInterfaceKind> {
  readonly id: string;
  readonly interface: TInterface;
  readonly consumer: ApplicationGraphNodeRef;
  readonly provider?: ApplicationProviderRef<TInterface>;
  readonly required: true;
  readonly purpose: 'modelStore' | 'indexStore' | 'counterStore' | 'eventSource' | 'secret' | 'queue' | 'objectStorage' | 'httpExposure' | 'credentialStore';
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
  readonly lowering?: ApplicationOperationTargetLoweringContract;
  readonly dryRun: ApplicationOperationDryRunContract;
  readonly ownership: ApplicationOperationOwnershipContract;
  readonly finalizers: ApplicationOperationFinalizerContract;
  readonly permissions: readonly PermissionRule[];
  readonly diagnostics: readonly ApplicationDiagnosticContract[];
}

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
  | 'config'
  | 'secret'
  | 'runtimeBundle'
  | 'routeDiagnostics'
  | 'jobDiagnostics'
  | 'providerDependency'
  | 'migration';

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
  readonly sourceLocation?: SourceLocation;
  readonly metadataLinks?: readonly ApplicationGraphMetadataLink[];
}

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
  readonly kind: 'field' | 'label' | 'literal' | 'ordering' | 'predicate';
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
  readonly permissions: readonly PermissionRule[];
  readonly environment?: ApplicationProviderRuntimeContract;
  readonly metadataLinks?: readonly ApplicationGraphMetadataLink[];
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

export interface ApplicationRuntimeModuleContract {
  readonly apiVersion?: ApplicationRuntimeModuleApiVersion;
  readonly kind: ApplicationRuntimeModuleKind;
  readonly name: string;
  readonly artifact: ApplicationGeneratedArtifactRef;
  readonly entrypoint?: string;
  readonly exports?: readonly ApplicationRuntimeModuleExportContract[];
  readonly imports?: readonly ApplicationRuntimeModuleRef[];
  readonly diagnostics?: readonly ApplicationDiagnosticContract[];
}

export type ApplicationRuntimeModuleApiVersion = 'applik8s.runtime/v1alpha1';

export interface ApplicationRuntimeModuleExportContract {
  readonly name: string;
  readonly kind: 'function' | 'constant' | 'type';
  readonly stability: ApplicationGraphStability;
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
  readonly requiredStatusOwnership?: readonly ApplicationDurableStatusOwnershipContract[];
  readonly liveValidation?: ApplicationV03LiveValidationContract;
}

export interface ApplicationV03LiveValidationContract {
  readonly contextEnv: string;
  readonly requiredResources: readonly ApplicationResourceRef[];
  readonly requiredAssertions: readonly string[];
}

export type ApplicationDiagnosticEvent =
  | 'applik8s-modelstore-missing-credentials'
  | 'applik8s-model-duplicate-key'
  | 'applik8s-model-migration-missing'
  | 'applik8s-model-migration-failed'
  | 'applik8s-model-migration-drift-detected'
  | 'applik8s-provider-requirement-missing'
  | 'applik8s-provider-requirement-ambiguous'
  | 'applik8s-job-terminal-failure'
  | 'applik8s-status-schema-pruned'
  | 'applik8s-operation-target-invalid'
  | 'applik8s-watch-scope-unlowerable'
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

export interface ApplicationCompatibilityLabel {
  readonly name: string;
  readonly surface: ApplicationCompatibilitySurface;
  readonly since?: string;
  readonly rationale?: string;
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
  if (target.lowering && target.lowering.failurePolicy !== 'failClosed') {
    diagnostics.push(applicationGraphStructureDiagnostic(`Application operation target ${target.id} lowering must fail closed.`));
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

export function validateApplicationDurableStatusOwnershipContract(contract: ApplicationDurableStatusOwnershipContract): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (contract.primary === 'generatedStatusConfigMap' && !contract.durableStore) {
    diagnostics.push(applicationGraphStructureDiagnostic('Application durable status ownership using a generatedStatusConfigMap primary must declare durableStore.'));
  }
  if (contract.appStatusSchema === 'unsupported' && contract.primary === 'applicationStatus') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application durable status ownership cannot use applicationStatus as primary when appStatusSchema is unsupported.'));
  }
  if (contract.appStatusSchema === 'bestEffort' && contract.fallback !== 'generatedStatusConfigMap') {
    diagnostics.push(applicationGraphStructureDiagnostic('Application durable status ownership with bestEffort app status must declare generatedStatusConfigMap fallback.'));
  }
  if (contract.conflictPolicy === 'failClosed' && contract.diagnostics.length === 0) {
    diagnostics.push(applicationGraphStructureDiagnostic('Application durable status ownership with failClosed conflict policy must declare diagnostics.'));
  }
  return diagnostics;
}

export function validateApplicationV03PressureTestContract(contract: ApplicationV03PressureTestContract): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  // typecast: these literal checklists are intentionally kept as narrow tuples while checked against the public contract unions.
  const requiredNodeKinds = ['model', 'server', 'job', 'provider'] as const satisfies readonly ApplicationGraphNodeKind[];
  // typecast: these literal checklists are intentionally kept as narrow tuples while checked against the public contract unions.
  const requiredProviders = ['ModelStore', 'CredentialStore'] as const satisfies readonly ApplicationProviderInterfaceKind[];
  // typecast: these literal checklists are intentionally kept as narrow tuples while checked against the public contract unions.
  const requiredRuntimeModules = ['serverRuntime', 'modelRuntime', 'jobRunnerRuntime', 'diagnostics'] as const satisfies readonly ApplicationRuntimeModuleKind[];
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
  for (const driftCheck of contract.requiredMigrationDriftChecks) {
    diagnostics.push(...validateApplicationMigrationDriftCheckContract(driftCheck));
  }
  for (const statusOwnership of contract.requiredStatusOwnership ?? []) {
    diagnostics.push(...validateApplicationDurableStatusOwnershipContract(statusOwnership));
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
    default:
      return [];
  }
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
