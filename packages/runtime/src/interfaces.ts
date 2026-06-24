import type { Applik8sError, HandlerAbiDefinition, HandlerInput, HandlerResult, HealthCheckResult, LifecyclePlan, ManagedByMetadata, ManagedObjectSnapshot, MetricSample, NormalizedOperationPlan, ObjectRef, Operation, OperationFailure, OperatorManifest, ReplayRecord, Result, RuntimeAdapterCapabilities, RuntimeAdapterKind, RuntimeConfig, RuntimeLogEvent } from '@applik8s/core';

export interface RuntimeStartOptions { readonly manifest: OperatorManifest; readonly configOverride?: RuntimeConfig; readonly handlerAbi: HandlerAbiDefinition; readonly handlerArtifactPath: string; readonly adapter: RuntimeAdapterKind; readonly adapterCapabilities?: RuntimeAdapterCapabilities; }
export interface RuntimeController { start(options: RuntimeStartOptions): Promise<Result<RuntimeState>>; stop(reason: string): Promise<Result<RuntimeState>>; health(): Result<HealthCheckResult>; metrics(): Result<readonly MetricSample[]>; }
export interface RuntimeState { readonly started: boolean; readonly leader: boolean; readonly watchedResources: readonly ObjectRef[]; readonly inFlightReconciles: number; readonly queueDepth: number; }
export interface HandlerInvoker { invoke(input: HandlerInput, policy: HandlerInvokePolicy): Promise<Result<HandlerInvocationResult>>; }
export interface HandlerInvokePolicy { readonly timeoutMs: number; readonly cancellationMode: 'deadline' | 'hostSignal'; readonly validateInput: boolean; readonly validateOutput: boolean; }
export interface HandlerInvocationResult { readonly normalizedPlan: NormalizedOperationPlan; readonly rawResult?: HandlerResult; readonly durationMs: number; readonly logs: readonly RuntimeLogEvent[]; }
export interface OperationApplier { apply(plan: NormalizedOperationPlan, context: ApplyContext): Promise<Result<ApplyResult>>; }
export interface ApplyContext { readonly defaultFieldManager: string; readonly owner?: ObjectRef; readonly dryRun: boolean; }
export interface ApplyResult { readonly appliedOperations: readonly Operation[]; readonly failedOperations: readonly OperationFailure[]; readonly statusPatched: boolean; readonly eventsRecorded: number; readonly requeueAfterSeconds?: number; }
export interface FailureReporter { report(error: Applik8sError, context: FailureReportContext): Promise<Result<FailureReport>>; }
export interface FailureReportContext { readonly objectRef?: ObjectRef; readonly manifest: OperatorManifest; readonly retryAttempt: number; }
export interface FailureReport { readonly conditionsPatched: boolean; readonly eventsRecorded: number; readonly retryScheduled: boolean; }
export interface LifecycleController { apply(plan: LifecyclePlan): Promise<Result<LifecycleResult>>; inspect(manifest: OperatorManifest): Promise<Result<readonly ManagedObjectSnapshot[]>>; recordManagedBy(ref: ObjectRef, metadata: ManagedByMetadata): Promise<Result<ManagedObjectSnapshot>>; }
export interface LifecycleResult { readonly plan: LifecyclePlan; readonly changedObjects: readonly ObjectRef[]; readonly preservedObjects: readonly ObjectRef[]; readonly destructiveActionsConfirmed: boolean; }
export interface ReplayRecorder { capture(record: ReplayRecord): Result<ReplayRecord>; replay(record: ReplayRecord, invoker: HandlerInvoker): Promise<Result<HandlerInvocationResult>>; }
export interface Applik8sRuntimeApi { readonly controller: RuntimeController; readonly invoker: HandlerInvoker; readonly applier: OperationApplier; readonly failures: FailureReporter; readonly lifecycle: LifecycleController; readonly replay: ReplayRecorder; }
