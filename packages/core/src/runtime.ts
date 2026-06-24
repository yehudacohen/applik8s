import type { CanonicalHandlerAbiFunctionName, CanonicalHandlerAbiVersion, DiagnosticSeverity, HandlerAbiFunctionKind, HandlerAbiResultEncoding, HandlerAbiScalarType, HandlerCancellationMode, HandlerEventType, HandlerId, HealthStatus, JavaScriptRuntimeFeature, JsonObject, LogLevel, MetricKind, ObjectRef, OperatorName, ReconcileId, Result, RuntimeAdapterKind, Sha256Digest, Timestamp } from './common.js';
import type { CapabilityDescriptor } from './capability.js';
import type { HandlerResult, NormalizedOperationPlan, Operation } from './operation-plan.js';
import type { ResourceObject } from './resource.js';
import type { RuntimePayloadSchemaDigests, RuntimePayloadSchemas } from './schema.js';

export interface RuntimeConfig { readonly leaderElection: LeaderElectionConfig; readonly concurrency: ConcurrencyConfig; readonly rateLimit: RateLimitConfig; readonly health: HealthCheckConfig; readonly metrics: MetricsConfig; readonly handlerTimeoutSeconds?: number; readonly replayArtifacts?: ReplayArtifactConfig; }
export interface RuntimeAdapterCapabilities { readonly kind: RuntimeAdapterKind; readonly wasmComponentModel: true; readonly hostImports: readonly string[]; readonly javascript?: JavaScriptRuntimeCapabilities; }
export interface JavaScriptRuntimeCapabilities { readonly features: readonly JavaScriptRuntimeFeature[]; readonly moduleFormat: 'esm' | 'commonjs' | 'bundle'; }
export interface RuntimeAdapterRequirement { readonly kind: RuntimeAdapterKind; readonly wasmComponentModel?: true; readonly hostImports?: readonly string[]; readonly javascript?: JavaScriptRuntimeRequirement; }
export interface JavaScriptRuntimeRequirement { readonly features: readonly JavaScriptRuntimeFeature[]; }
export interface LeaderElectionConfig { readonly enabled: boolean; readonly leaseName: import('./common.js').KubernetesName; readonly leaseNamespace?: import('./common.js').NamespaceName; readonly leaseDurationSeconds: number; readonly renewDeadlineSeconds: number; readonly retryPeriodSeconds: number; }
export interface ConcurrencyConfig { readonly workerCount: number; readonly maxInFlightPerResource: number; readonly maxQueueDepth?: number; }
export interface RateLimitConfig { readonly baseDelayMs: number; readonly maxDelayMs: number; readonly maxRetries?: number; }
export interface HealthCheckConfig { readonly enabled: boolean; readonly path: string; readonly port: number; }
export interface MetricsConfig { readonly enabled: boolean; readonly path: string; readonly port: number; readonly labels: readonly string[]; }
export interface ReplayArtifactConfig { readonly enabled: boolean; readonly directory?: string; readonly includePayloads?: boolean; }
export interface HealthCheckResult { readonly status: HealthStatus; readonly checkedAt: Timestamp; readonly checks: readonly HealthCheckItem[]; }
export interface HealthCheckItem { readonly name: string; readonly status: HealthStatus; readonly message?: string; }
export interface MetricDescriptor { readonly name: string; readonly kind: MetricKind; readonly description: string; readonly labels?: readonly string[]; readonly buckets?: readonly number[]; }
export interface MetricSample { readonly descriptor: MetricDescriptor; readonly labels?: Readonly<Record<string, string>>; readonly value: number; readonly observedAt: Timestamp; }
export type RuntimeMetricName = 'reconcile_total' | 'reconcile_duration_seconds' | 'reconcile_retries_total' | 'workqueue_depth' | 'handler_invocation_seconds' | 'handler_traps_total' | 'apply_operations_total' | 'patch_operations_total' | 'delete_operations_total' | 'status_patch_failures_total';
export interface RuntimeLogEvent { readonly level: LogLevel; readonly message: string; readonly observedAt: Timestamp; readonly operatorName?: OperatorName; readonly handlerId?: HandlerId; readonly objectRef?: ObjectRef; readonly reconcileId?: ReconcileId; readonly bundleDigest?: Sha256Digest; readonly runtimeVersion?: string; readonly handlerAbi?: import('./common.js').HandlerAbiVersion; readonly fields?: JsonObject; }
export interface ReplayRecord { readonly input: HandlerInput; readonly result?: HandlerResult; readonly normalizedPlan?: NormalizedOperationPlan; readonly runtimeLogs: readonly RuntimeLogEvent[]; readonly metrics: readonly MetricSample[]; readonly appliedOperations: readonly Operation[]; readonly failedOperations: readonly OperationFailure[]; }
export interface OperationFailure { readonly operation: Operation; readonly error: import('./common.js').Applik8sError; }

export interface HandlerInput<TSpec extends object = JsonObject, TStatus extends object = JsonObject> { readonly abiVersion: import('./common.js').HandlerAbiVersion; readonly handlerId: HandlerId; readonly event: HandlerEventType; readonly object: ResourceObject<TSpec, TStatus>; readonly previous?: ResourceObject<TSpec, TStatus>; readonly observed?: ObservedState; readonly config?: JsonObject; readonly capabilities?: Readonly<Record<string, CapabilityDescriptor>>; readonly runtime: RuntimeInvocationMetadata; }
export interface ObservedState { readonly relatedObjects: readonly import('./resource.js').AnyKubernetesObject[]; readonly resourceVersion?: string; }
export interface RuntimeInvocationMetadata { readonly operatorName: OperatorName; readonly reconcileId: ReconcileId; readonly bundleDigest: Sha256Digest; readonly runtimeVersion: string; readonly startedAt: Timestamp; }

export interface HandlerAbiDefinition { readonly abiVersion: import('./common.js').HandlerAbiVersion; readonly witPackage: string; readonly world: string; readonly resultEncoding: HandlerAbiResultEncoding; readonly wireFormat: HandlerWireFormat; readonly hostImports: readonly HandlerAbiFunction[]; readonly guestExports: readonly HandlerAbiFunction[]; readonly payloadSchemas: RuntimePayloadSchemas; readonly execution: HandlerAbiExecutionPolicy; readonly canonical: CanonicalHandlerAbiContract; }
export interface CanonicalHandlerAbiSource { readonly abiVersion: CanonicalHandlerAbiVersion; readonly definition: HandlerAbiDefinition; readonly payloadSchemas: RuntimePayloadSchemas; readonly payloadSchemaDigests: RuntimePayloadSchemaDigests; readonly sourceModule: string; readonly generatedWitPath?: string; }
export interface CanonicalHandlerAbiRegistry { canonicalDefinition(version: CanonicalHandlerAbiVersion): Result<HandlerAbiDefinition>; supportedVersions(): readonly CanonicalHandlerAbiVersion[]; validateCanonical(definition: HandlerAbiDefinition): Result<readonly import('./common.js').Diagnostic[]>; }
export interface CanonicalHandlerAbiContract { readonly handleExport: CanonicalHandlerAbiFunctionName; readonly capabilityRequestImport: CanonicalHandlerAbiFunctionName; readonly logImport: CanonicalHandlerAbiFunctionName; readonly cancelImport?: CanonicalHandlerAbiFunctionName; }
export interface HandlerWireFormat { readonly inputEncoding: 'jsonString'; readonly outputEncoding: 'jsonString'; readonly errorEncoding: 'jsonString'; }
export interface HandlerAbiFunction { readonly kind: HandlerAbiFunctionKind; readonly name: string; readonly parameters: readonly HandlerAbiParameter[]; readonly result: HandlerAbiResult; }
export interface HandlerAbiParameter { readonly name: string; readonly type: HandlerAbiScalarType; readonly optional?: boolean; }
export interface HandlerAbiResult { readonly ok?: HandlerAbiScalarType; readonly error: 'handler-error'; }
export interface HandlerErrorPayload { readonly code: import('./common.js').Applik8sErrorCode; readonly message: string; readonly severity: DiagnosticSeverity; readonly contextJson: string; readonly causeJson?: string; readonly recoveryJson?: string; }
export interface HandlerAbiExecutionPolicy { readonly defaultTimeoutMs: number; readonly cancellation: HandlerCancellationPolicy; readonly validateInputBeforeInvoke: boolean; readonly validateOutputBeforeApply: boolean; }
export interface HandlerCancellationPolicy { readonly mode: HandlerCancellationMode; readonly hostSignalFunction?: string; readonly deadlineField?: string; }
