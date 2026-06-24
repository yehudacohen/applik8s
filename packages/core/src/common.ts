/** Shared primitive, identity, error, diagnostic, and Kubernetes metadata contracts. */

import type { V1ObjectReference } from '@kubernetes/client-node/dist/gen/models/V1ObjectReference.js';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject { readonly [key: string]: JsonValue; }
export type JsonArray = readonly JsonValue[];

export type ApiVersion = string;
export type Kind = string;
export type KubernetesName = string;
export type NamespaceName = string;
export type PluralName = string;
export type Timestamp = string;
export type Sha256Digest = string;
export type SemverRange = string;
export type OperatorName = string;
export type HandlerId = string;
export type ReconcileId = string;
export type HandlerAbiVersion = string;
export type OperatorManifestVersion = string;
export type CanonicalHandlerAbiVersion = 'applik8s.handler/v1alpha1';

export type ResourceScope = 'Namespaced' | 'Cluster';
export type HandlerEventType = 'reconcile' | 'created' | 'updated' | 'deleted' | 'finalize' | 'statusChanged';
export type OperationKind = 'apply' | 'patch' | 'delete' | 'status' | 'event' | 'finalizer' | 'requeue';
export type JsonPatchOperationKind = 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
export type ConditionStatus = 'True' | 'False' | 'Unknown';
export type KubernetesEventType = 'Normal' | 'Warning';
export type FinalizerAction = 'add' | 'remove';
export type CapabilityKind = 'kubernetes' | 'http' | 'cloudApi' | 'database' | 'queue' | 'objectStore' | 'identity';
export type HandlerTrustLevel = 'trustedApplication' | 'thirdPartyDependency' | 'tenantProvided';
export type DiagnosticSeverity = 'info' | 'warning' | 'error';
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';
export type MetricKind = 'counter' | 'gauge' | 'histogram';
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';
export type WatchEventType = 'ADDED' | 'MODIFIED' | 'DELETED' | 'BOOKMARK';
export type ConversionStrategy = 'none' | 'webhook';
export type SignatureAlgorithm = 'cosign' | 'in-toto' | 'slsa-provenance';
export type SchemaSourceKind = 'arktype' | 'jsonSchema' | 'custom';
export type GeneratedSchemaKind = 'kubernetesOpenApi' | 'jsonSchema' | 'crdManifest';
export type PayloadSchemaKind = 'handlerInput' | 'normalizedOperationPlan' | 'operatorManifest' | 'handlerError' | 'capabilityRequest' | 'capabilityResponse';
export type HandlerAbiFunctionKind = 'hostImport' | 'guestExport';
export type HandlerAbiScalarType = 'string' | 'jsonString' | 'void';
export type HandlerAbiResultEncoding = 'witResult';
export type HandlerCancellationMode = 'deadline' | 'hostSignal';
export type CanonicalHandlerAbiFunctionName = 'handle' | 'capability-request' | 'log' | 'cancel';
export type RuntimeAdapterKind = 'wasmComponent';
export type JavaScriptRuntimeFeature = 'closures' | 'asyncFunctions' | 'promises' | 'es6Proxy';
export type LifecycleAction = 'install' | 'upgrade' | 'rollback' | 'uninstallController' | 'deleteDomainData';
export type CompatibilityDecision = 'compatible' | 'incompatible' | 'requiresMigration' | 'unsafe';
export type ExternalEffectPhase = 'IntentRecorded' | 'InFlight' | 'Succeeded' | 'Failed' | 'Unknown';
export type CapabilityFailureMode = 'rejectPromiseWithApplik8sError';
export type EffectExecutionMode = 'planned' | 'live';
export type HandlerApiStyle = 'context' | 'proxy';

export type Applik8sErrorCode =
  | 'SCHEMA_UNSUPPORTED'
  | 'SCHEMA_INVALID'
  | 'HANDLER_NOT_FOUND'
  | 'HANDLER_TRAP'
  | 'HANDLER_TIMEOUT'
  | 'HANDLER_OUTPUT_INVALID'
  | 'ABI_INCOMPATIBLE'
  | 'RUNTIME_INCOMPATIBLE'
  | 'RBAC_DENIED'
  | 'CAPABILITY_MISSING'
  | 'CAPABILITY_DENIED'
  | 'PARTIAL_APPLY_FAILED'
  | 'STATUS_PATCH_FAILED'
  | 'FINALIZER_FAILED'
  | 'MANIFEST_INVALID'
  | 'BUNDLE_INVALID'
  | 'COMPATIBILITY_FAILED'
  | 'LIFECYCLE_UNSAFE'
  | 'RESOURCE_NOT_FOUND'
  | 'RESOURCE_CONFLICT'
  | 'KUBERNETES_API_ERROR'
  | 'SERIALIZATION_FAILED';

/** Consistent non-throwing error representation for public contracts. */
export type Result<T, E extends Applik8sError = Applik8sError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export interface Applik8sError { readonly code: Applik8sErrorCode; readonly message: string; readonly severity: DiagnosticSeverity; readonly context: ErrorContext; readonly cause?: ErrorCause; readonly recovery?: RecoveryHint; }
export interface ErrorContext { readonly sourceFile?: string; readonly line?: number; readonly column?: number; readonly operatorName?: OperatorName; readonly handlerId?: HandlerId; readonly objectRef?: ObjectRef; readonly reconcileId?: ReconcileId; readonly bundleDigest?: Sha256Digest; readonly runtimeVersion?: string; readonly handlerAbi?: HandlerAbiVersion; readonly capabilityName?: string; readonly operationKind?: OperationKind; }
export interface ErrorCause { readonly code?: string; readonly publicMessage: string; }
export interface RecoveryHint { readonly summary: string; readonly documentationUrl?: string; readonly suggestedAction?: string; }

export interface SourceLocation { readonly file: string; readonly line: number; readonly column: number; }
export interface Diagnostic { readonly severity: DiagnosticSeverity; readonly code: Applik8sErrorCode; readonly message: string; readonly sourceLocation?: SourceLocation; readonly recovery?: RecoveryHint; }

export interface ObjectRef extends Pick<V1ObjectReference, 'apiVersion' | 'kind' | 'name' | 'namespace' | 'uid' | 'resourceVersion'> { readonly apiVersion: ApiVersion; readonly kind: Kind; readonly name: KubernetesName; readonly namespace?: NamespaceName; readonly uid?: string; readonly resourceVersion?: string; }
export interface ManagedByMetadata { readonly operatorName: OperatorName; readonly bundleDigest: Sha256Digest; readonly runtimeVersion: string; readonly handlerAbi: HandlerAbiVersion; readonly operatorManifest: OperatorManifestVersion; }
export interface OwnerReference { readonly apiVersion: ApiVersion; readonly kind: Kind; readonly name: KubernetesName; readonly uid: string; readonly controller?: boolean; readonly blockOwnerDeletion?: boolean; }
export interface ObjectMeta { readonly name: KubernetesName; readonly namespace?: NamespaceName; readonly uid?: string; readonly resourceVersion?: string; readonly generation?: number; readonly labels?: Readonly<Record<string, string>>; readonly annotations?: Readonly<Record<string, string>>; readonly ownerReferences?: readonly OwnerReference[]; readonly finalizers?: readonly string[]; readonly deletionTimestamp?: Timestamp; readonly creationTimestamp?: Timestamp; readonly managedBy?: ManagedByMetadata; }
export interface Condition { readonly type: string; readonly status: ConditionStatus; readonly reason: string; readonly message: string; readonly observedGeneration?: number; readonly lastTransitionTime?: Timestamp; }
export interface ConditionedStatus { readonly observedGeneration?: number; readonly conditions: readonly Condition[]; }
export interface StatusConvention { readonly observedGenerationField: 'observedGeneration'; readonly conditionsField: 'conditions'; readonly phaseField?: string; readonly messageField?: string; readonly reasonField?: string; }
