import type { ApplicationOperationTargetContract } from './application-graph.js';
import type { CapabilityClientSet, KubernetesConnectionCapabilityClient, KubernetesConnectionName } from './capability.js';
import type { EffectExecutionMode, HandlerApiStyle, HandlerEventType, HandlerId, JsonObject, JsonPrimitive, KubernetesName, NamespaceName, ObjectMeta, ObjectRef, ReconcileId, Result, SourceLocation } from './common.js';
import type { ApplyOwnership, DeleteOptions, EventOperation, HandlerResult, JsonPatch, NormalizedOperationPlan, OperationPlanInput, PartialStatus, PatchOperation, RemoteMutationAuthority, RequeueOperation, RequeuePolicy, StatusOperation } from './operation-plan.js';
import type { AnyKubernetesObject, AnyResourceDefinition, KubernetesReadResourceDefinition, LabelSelector, PermissionRule, ResourceDefinition, ResourceObject, ResourceReadClient } from './resource.js';

export type MaybePromise<T> = T | Promise<T>;
export type DraftValue<T> = T extends JsonPrimitive ? T : T extends ReadonlyArray<infer U> ? DraftValue<U>[] : T extends object ? { -readonly [K in keyof T]: DraftValue<T[K]> } : T;
export type StatusDraft<TStatus extends object> = { -readonly [K in keyof TStatus]?: DraftValue<TStatus[K]> };
export type Handler<TSpec extends object, TStatus extends object, TCapabilities extends CapabilityClientSet = CapabilityClientSet> = (object: ResourceObject<TSpec, TStatus>, context: HandlerContext<TSpec, TStatus, TCapabilities>) => MaybePromise<Result<HandlerResult<TStatus>>>;
// biome-ignore lint/suspicious/noConfusingVoidType: async proxy handlers with no explicit return infer Promise<void>.
export type ProxyHandlerReturn<TStatus extends object> = void | HandlerResult<TStatus> | Result<HandlerResult<TStatus>>;
export type ProxyHandler<TSpec extends object, TStatus extends object, TCapabilities extends CapabilityClientSet = CapabilityClientSet> = (scope: HandlerProxyScope<TSpec, TStatus, TCapabilities>, context: PortableReconcileContext) => MaybePromise<ProxyHandlerReturn<TStatus> | PortableManagedModelRequeue>;
export interface ResourceEventSources<TSpec extends object, TStatus extends object, TCapabilities extends CapabilityClientSet = CapabilityClientSet> { readonly context: ContextResourceEventSources<TSpec, TStatus, TCapabilities>; reconcile(handler: ProxyHandler<TSpec, TStatus, TCapabilities>): HandlerRegistration<TSpec, TStatus, TCapabilities>; create(handler: ProxyHandler<TSpec, TStatus, TCapabilities>): HandlerRegistration<TSpec, TStatus, TCapabilities>; update(handler: ProxyHandler<TSpec, TStatus, TCapabilities>): HandlerRegistration<TSpec, TStatus, TCapabilities>; delete(handler: ProxyHandler<TSpec, TStatus, TCapabilities>): HandlerRegistration<TSpec, TStatus, TCapabilities>; created(handler: ProxyHandler<TSpec, TStatus, TCapabilities>): HandlerRegistration<TSpec, TStatus, TCapabilities>; updated(handler: ProxyHandler<TSpec, TStatus, TCapabilities>): HandlerRegistration<TSpec, TStatus, TCapabilities>; deleted(handler: ProxyHandler<TSpec, TStatus, TCapabilities>): HandlerRegistration<TSpec, TStatus, TCapabilities>; finalize(handler: ProxyHandler<TSpec, TStatus, TCapabilities>, options?: FinalizeHandlerOptions): HandlerRegistration<TSpec, TStatus, TCapabilities>; statusChanged(handler: ProxyHandler<TSpec, TStatus, TCapabilities>): HandlerRegistration<TSpec, TStatus, TCapabilities>; }
export interface ContextResourceEventSources<TSpec extends object, TStatus extends object, TCapabilities extends CapabilityClientSet = CapabilityClientSet> { reconcile(handler: Handler<TSpec, TStatus, TCapabilities>): HandlerRegistration<TSpec, TStatus, TCapabilities>; create(handler: Handler<TSpec, TStatus, TCapabilities>): HandlerRegistration<TSpec, TStatus, TCapabilities>; update(handler: Handler<TSpec, TStatus, TCapabilities>): HandlerRegistration<TSpec, TStatus, TCapabilities>; delete(handler: Handler<TSpec, TStatus, TCapabilities>): HandlerRegistration<TSpec, TStatus, TCapabilities>; created(handler: Handler<TSpec, TStatus, TCapabilities>): HandlerRegistration<TSpec, TStatus, TCapabilities>; updated(handler: Handler<TSpec, TStatus, TCapabilities>): HandlerRegistration<TSpec, TStatus, TCapabilities>; deleted(handler: Handler<TSpec, TStatus, TCapabilities>): HandlerRegistration<TSpec, TStatus, TCapabilities>; finalize(handler: Handler<TSpec, TStatus, TCapabilities>, options?: FinalizeHandlerOptions): HandlerRegistration<TSpec, TStatus, TCapabilities>; statusChanged(handler: Handler<TSpec, TStatus, TCapabilities>): HandlerRegistration<TSpec, TStatus, TCapabilities>; }
export interface FinalizeHandlerOptions { readonly finalizer?: string; readonly finalizers?: readonly string[]; }
export interface ResourceWatchAddress { readonly namespace?: NamespaceName; readonly name?: KubernetesName; readonly names?: readonly KubernetesName[]; readonly labelSelector?: LabelSelector; readonly fieldSelector?: string; }
export interface SecondaryWatchRegistration {
  readonly source: Pick<AnyResourceDefinition, 'apiVersion' | 'kind' | 'plural' | 'scope'>;
  readonly target: Pick<AnyResourceDefinition, 'apiVersion' | 'kind' | 'plural' | 'scope'>;
  readonly watch?: ResourceWatchAddress;
  readonly mapper: SecondaryWatchMapper;
}
export type SecondaryWatchMapper =
  /** Explicit bounded fan-out. Target instances are listed and reconciled when the source changes. */
  | { readonly mode: 'all'; readonly namespace?: 'source' | 'operator' | 'all' }
  /** Exact fan-out. One source metadata value names the one owned target to reconcile. */
  | { readonly mode: 'targetNameFromSourceField'; readonly source: { readonly kind: 'label' | 'annotation'; readonly key: string }; readonly namespace?: 'source' | 'operator' };
export interface HandlerRegistration<TSpec extends object, TStatus extends object, TCapabilities extends CapabilityClientSet = CapabilityClientSet> { readonly id: HandlerId; readonly event: HandlerEventType; readonly resource: ResourceDefinition<TSpec, TStatus, TCapabilities>; readonly handlerStyle?: HandlerApiStyle; readonly sourceLocation?: SourceLocation; readonly finalizers?: readonly string[]; readonly watch?: ResourceWatchAddress; readonly permissions?: readonly PermissionRule[]; }
export interface HandlerRegistrationSummary { readonly id: HandlerId; readonly event: HandlerEventType; readonly handlerStyle?: HandlerApiStyle; readonly sourceLocation?: SourceLocation; readonly finalizers?: readonly string[]; readonly watch?: ResourceWatchAddress; readonly permissions?: readonly PermissionRule[]; }
export type AnyHandlerRegistration = HandlerRegistrationSummary;
export type HandlerRegistrationForResource<TResource extends AnyResourceDefinition<TCapabilities>, TCapabilities extends CapabilityClientSet> = TResource extends ResourceDefinition<infer TSpec, infer TStatus, infer TResourceCapabilities> ? HandlerRegistration<TSpec, TStatus, TResourceCapabilities & TCapabilities> : AnyHandlerRegistration;
export type HandlerRegistrationForResources<TResources extends Readonly<Record<string, AnyResourceDefinition<TCapabilities>>>, TCapabilities extends CapabilityClientSet> = { readonly [K in keyof TResources]: HandlerRegistrationForResource<TResources[K], TCapabilities> }[keyof TResources];

export type KubernetesConnectionAliases<TCapabilities extends CapabilityClientSet> = string extends keyof TCapabilities
  ? string
  : { readonly [K in keyof TCapabilities]: TCapabilities[K] extends KubernetesConnectionCapabilityClient ? K : never }[keyof TCapabilities] & string;
export interface HandlerContext<TSpec extends object, TStatus extends object, TCapabilities extends CapabilityClientSet = CapabilityClientSet> { readonly object: ResourceObject<TSpec, TStatus>; readonly event: HandlerEventType; readonly reconcileId: ReconcileId; readonly capabilities: TCapabilities; readonly read: HandlerReadClientGroup; readonly kubernetes: KubernetesConnectionClientGroup<KubernetesConnectionAliases<TCapabilities>>; readonly names: NameHelpers; readonly k8s: KubernetesFactoryGroup; readonly batch: KubernetesFactoryGroup; apply(plan: OperationPlanInput<TStatus>): Result<HandlerResult<TStatus>>; apply<TTarget extends OperationTarget<TStatus>>(target: TTarget, options?: ApplyTargetOptions): Result<HandlerResult<TStatus>>; apply<TTarget extends OperationTarget<TStatus>>(targets: readonly TTarget[], plan?: OperationPlanInput<TStatus>): Result<HandlerResult<TStatus>>; applyGraph<TGraph extends object, TGraphSpec extends object = object>(application: GraphApplication<TGraph, TStatus, TGraphSpec>): Result<HandlerResult<TStatus>>; plan<TTarget extends OperationTarget<TStatus>>(target: TTarget, options?: PlanTargetOptions): Result<NormalizedOperationPlan<TStatus>>; status(status: PartialStatus<TStatus>): StatusOperation<TStatus>; status<TTargetSpec extends object, TTargetStatus extends object>(resource: ResourceDefinition<TTargetSpec, TTargetStatus>, name: KubernetesName, status: PartialStatus<TTargetStatus>, namespace?: NamespaceName): StatusOperation<TTargetStatus>; patch(ref: ObjectRef, patch: JsonPatch, options?: PatchTargetOptions): PatchOperation; delete(ref: ObjectRef, options?: DeleteTargetOptions): import('./operation-plan.js').DeleteOperation; delete(resource: AnyKubernetesObject, options?: DeleteTargetOptions): import('./operation-plan.js').DeleteOperation; delete<TTarget extends OperationTarget<TStatus>>(target: TTarget, options?: DeleteTargetOptions): Result<HandlerResult<TStatus>>; delete<TTarget extends OperationTarget<TStatus>>(targets: readonly TTarget[], plan?: OperationPlanInput<TStatus>): Result<HandlerResult<TStatus>>; recordEvent(event: EventOperation): EventOperation; requeue(policy: RequeuePolicy): RequeueOperation; noop(): Result<HandlerResult<TStatus>>; }
export interface PortableManagedModelRequeue { readonly kind: 'managedModelRequeue'; readonly afterSeconds: number; }
export interface PortableManagedModelWriteReceipt { readonly protocol: 'applik8s.managed-model/v1alpha1'; readonly uid: string; readonly generation: number; readonly resourceVersion: string; readonly fence: string; readonly disposition: 'accepted'; readonly recordedAt: string; }
export interface PortableManagedModelCondition { readonly type: string; readonly status: 'True' | 'False' | 'Unknown'; readonly observedGeneration: number; readonly reason: string; readonly message: string; readonly lastTransitionTime: string; }
export interface PortableManagedModelConditionInput<TType extends string = string> { readonly type: TType; readonly status: 'True' | 'False' | 'Unknown'; readonly reason: string; readonly message: string; }
export interface PortableManagedModelMetadata extends ObjectMeta { readonly uid: string; readonly generation: number; readonly resourceVersion: string; readonly createdAt: string; readonly finalizers: readonly string[]; }
export interface PortableReconcileContext { readonly protocol: 'applik8s.managed-model/v1alpha1'; readonly reconcileId: string; readonly fence: string; readonly attempt: number; readonly signal: AbortSignal; readonly causalPrincipalId?: string; readonly trustedContext: Readonly<Record<string, import('./common.js').JsonValue>>; requeueAfter(duration: string): PortableManagedModelRequeue; throwIfCancelled(): void; }
export interface HandlerProxyScope<TSpec extends object, TStatus extends object, TCapabilities extends CapabilityClientSet = CapabilityClientSet> {
  /** Provider-neutral managed-model identity. Kubernetes models use metadata.name. */
  readonly id: string;
  /** Provider-neutral desired value. Kubernetes models map this exactly to spec. */
  readonly value: Readonly<TSpec>;
  readonly object: ResourceObject<TSpec, TStatus>;
  /** Kubernetes-specific compatibility view. Reading it constrains the callback to Kubernetes. */
  readonly spec: TSpec;
  readonly metadata: PortableManagedModelMetadata;
  readonly event: HandlerEventType;
  readonly reconcileId: ReconcileId;
  readonly capabilities: TCapabilities;
  readonly read: HandlerReadClientGroup;
  readonly kubernetes: KubernetesConnectionClientGroup<KubernetesConnectionAliases<TCapabilities>>;
  readonly names: NameHelpers;
  readonly k8s: KubernetesFactoryGroup;
  readonly batch: KubernetesFactoryGroup;
  readonly status: StatusDraft<TStatus> & {
    readonly current: Readonly<TStatus>;
    update(next: TStatus): Promise<PortableManagedModelWriteReceipt>;
  };
  readonly conditions: {
    readonly current: readonly PortableManagedModelCondition[];
    set<TType extends string>(next: PortableManagedModelConditionInput<TType>): Promise<PortableManagedModelWriteReceipt>;
    remove(type: string): Promise<PortableManagedModelWriteReceipt>;
  };
  readonly resources: HandlerResourceDraft<TStatus>;
  readonly events: HandlerEventDraft;
  readonly finalizers: HandlerFinalizerDraft;
  track<TResult extends object, TProgress = unknown>(key: string, run: TrackableExecutionRun<TResult, TProgress>, options?: TrackExecutionOptions): Promise<TrackedExecutionObservation<TResult, TProgress>>;
  apply(plan: OperationPlanInput<TStatus>): void;
  apply<TTarget extends OperationTarget<TStatus>>(target: TTarget, options?: ApplyTargetOptions): void;
  apply<TTarget extends OperationTarget<TStatus>>(targets: readonly TTarget[], plan?: OperationPlanInput<TStatus>): void;
  applyGraph<TGraph extends object, TGraphSpec extends object = object>(application: GraphApplication<TGraph, TStatus, TGraphSpec>): void;
  delete(ref: ObjectRef, options?: DeleteTargetOptions): void;
  delete(resource: AnyKubernetesObject, options?: DeleteTargetOptions): void;
  delete<TTarget extends OperationTarget<TStatus>>(target: TTarget, options?: DeleteTargetOptions): void;
  delete<TTarget extends OperationTarget<TStatus>>(targets: readonly TTarget[], plan?: OperationPlanInput<TStatus>): void;
  patch(ref: ObjectRef, patch: JsonPatch, options?: PatchTargetOptions): void;
  setStatus<TTargetSpec extends object, TTargetStatus extends object>(resource: ResourceDefinition<TTargetSpec, TTargetStatus>, name: KubernetesName, status: PartialStatus<TTargetStatus>, namespace?: NamespaceName): void;
  recordEvent(event: EventOperation): void;
  requeue(policy: RequeuePolicy): void;
  plan<TTarget extends OperationTarget<TStatus>>(target: TTarget, options?: PlanTargetOptions): Result<NormalizedOperationPlan<TStatus>>;
}
export type TrackedExecutionPhase = 'Admitted' | 'Running' | 'Succeeded' | 'Failed' | 'Cancelled' | 'TimedOut';
export interface TrackedExecutionReference { readonly provider: 'workflow'; readonly workflow: string; readonly run: string; }
export interface TrackedExecutionFailure { readonly code: string; readonly message: string; readonly retryable: boolean; }
export interface TrackedExecutionObservation<TResult extends object, TProgress = unknown> { readonly reference: TrackedExecutionReference; readonly workflowRevision: string; readonly phase: TrackedExecutionPhase; readonly progress?: TProgress; readonly result?: TResult; readonly error?: TrackedExecutionFailure; readonly admittedAt: string; readonly startedAt?: string; readonly finishedAt?: string; }
export interface TrackableExecutionRun<TResult extends object, TProgress = unknown> { readonly id: string; readonly reference: TrackedExecutionReference; readonly workflowRevision: string; observe(options?: { readonly signal?: AbortSignal; readonly timeoutMs?: number; readonly pollIntervalMs?: number }): Promise<TrackedExecutionObservation<TResult, TProgress>>; cancel(options?: { readonly signal?: AbortSignal; readonly timeoutMs?: number }): Promise<void>; /** @internal Enables restart-safe adoption before a reconciler repeats provider admission. */ readonly __idempotencyKey?: string; readonly __cancelReference?: (runId: string, options?: { readonly signal?: AbortSignal; readonly timeoutMs?: number }) => Promise<void>; }
export type TrackExecutionDeletePolicy = 'detach' | { readonly action: 'cancel'; readonly timeout: string; readonly onTimeout: 'detach' | 'block' };
export interface TrackExecutionOptions { readonly onDelete?: TrackExecutionDeletePolicy; readonly onGenerationChange?: 'supersede' | 'cancel'; readonly updates?: { readonly phases?: boolean; readonly progress?: boolean; readonly minInterval?: string }; }
export type HandlerReadClientGroup = Readonly<Record<string, ResourceReadClient<object, object>>> & {
  resource<TSpec extends object, TStatus extends object>(resource: ResourceDefinition<TSpec, TStatus> | KubernetesReadResourceDefinition<TSpec, TStatus>, alias?: string): ResourceReadClient<TSpec, TStatus>;
  kind<TSpec extends object, TStatus extends object>(kindOrAlias: string): ResourceReadClient<TSpec, TStatus>;
};
export interface KubernetesConnectionClientGroup<TName extends KubernetesConnectionName = KubernetesConnectionName> { connection(name: TName): KubernetesConnectionClient; }
export interface KubernetesConnectionReadClient<TSpec extends object, TStatus extends object> { get(query: import('./resource.js').ResourceGetQuery): Promise<ResourceObject<TSpec, TStatus> | undefined>; list(query: import('./resource.js').ResourceReadQuery & { readonly limit: number }): Promise<import('./resource.js').ResourceReadList<TSpec, TStatus>>; }
export type KubernetesConnectionReadClientGroup = Readonly<Record<string, KubernetesConnectionReadClient<object, object>>> & { resource<TSpec extends object, TStatus extends object>(resource: ResourceDefinition<TSpec, TStatus> | KubernetesReadResourceDefinition<TSpec, TStatus>, alias?: string): KubernetesConnectionReadClient<TSpec, TStatus>; kind<TSpec extends object, TStatus extends object>(kindOrAlias: string): KubernetesConnectionReadClient<TSpec, TStatus>; };
export interface KubernetesConnectionClient { readonly name: KubernetesConnectionName; readonly read: KubernetesConnectionReadClientGroup; readonly resources: HandlerConnectionResourceDraft; }
export interface RemoteApplyTargetOptions { readonly fieldManager?: string; readonly force?: boolean; readonly ownership?: ApplyOwnership; readonly authority: RemoteMutationAuthority; }
export interface RemotePatchTargetOptions { readonly authority: RemoteMutationAuthority; }
export interface RemoteDeleteTargetOptions extends DeleteOptions { readonly authority: RemoteMutationAuthority; }
export interface HandlerConnectionResourceDraft { apply(resource: AnyKubernetesObject, options: RemoteApplyTargetOptions): void; patch(ref: ObjectRef, patch: JsonPatch, options: RemotePatchTargetOptions): void; delete(ref: ObjectRef, options: RemoteDeleteTargetOptions): void; }
export interface HandlerResourceDraft<TStatus extends object = JsonObject> { apply(resource: AnyKubernetesObject, options?: ApplyTargetOptions): void; applyTarget(target: OperationTarget<TStatus> | ApplyTargetInput<TStatus>): void; delete(ref: ObjectRef, options?: DeleteTargetOptions): void; deleteTarget(target: OperationTarget<TStatus> | DeleteTargetInput<TStatus>): void; patch(ref: ObjectRef, patch: JsonPatch, options?: PatchTargetOptions): void; }
export interface HandlerEventDraft { record(event: EventOperation): void; normal(reason: string, message: string, regarding?: ObjectRef): void; warning(reason: string, message: string, regarding?: ObjectRef): void; }
export interface HandlerFinalizerDraft { add(finalizer: string): void; remove(finalizer: string): void; }
export interface GraphApplication<TGraph extends object = object, TStatus extends object = JsonObject, TGraphSpec extends object = object> { readonly graph: TGraph; readonly spec: TGraphSpec; readonly adapter: GraphAdapter<TGraph, TStatus, TGraphSpec>; }
export interface GraphAdapter<TGraph extends object = object, TStatus extends object = JsonObject, TGraphSpec extends object = object> { render(graph: TGraph, spec: TGraphSpec): Result<NormalizedOperationPlan<TStatus>>; inferRbac(graph: TGraph): Result<readonly PermissionRule[]>; renderStatus(graph: TGraph, spec: TGraphSpec): Result<PartialStatus<TStatus>>; }
export interface ApplyTargetOptions { readonly fieldManager?: string; readonly force?: boolean; readonly owner?: ObjectRef; readonly ownership?: ApplyOwnership; }
export interface PlanTargetOptions extends ApplyTargetOptions { readonly dryRun?: boolean; }
export interface PatchTargetOptions { readonly authority?: never; }
export interface DeleteTargetOptions extends DeleteOptions { readonly owner?: ObjectRef; }
export interface ApplyTargetInput<TStatus extends object = object> { readonly target: OperationTarget<TStatus>; readonly options?: ApplyTargetOptions; }
export interface DeleteTargetInput<TStatus extends object = object> { readonly target: OperationTarget<TStatus>; readonly options?: DeleteTargetOptions; }
export interface OperationTarget<TStatus extends object = object> { readonly targetKind: 'operationTarget'; readonly adapter: OperationTargetAdapter<this, TStatus>; readonly contract?: ApplicationOperationTargetContract; readonly operationTargetArtifacts?: OperationTargetLoweringArtifacts<TStatus>; }
export interface OperationTargetAdapter<TTarget extends OperationTarget<TStatus>, TStatus extends object = object> { renderApply(target: TTarget, options?: ApplyTargetOptions): Result<NormalizedOperationPlan<TStatus>>; renderDelete(target: TTarget, options?: DeleteTargetOptions): Result<NormalizedOperationPlan<TStatus>>; inferRbac(target: TTarget): Result<readonly PermissionRule[]>; }
export interface OperationTargetLoweringArtifacts<TStatus extends object = object> { readonly applyPlan: NormalizedOperationPlan<TStatus>; readonly deletePlan: NormalizedOperationPlan<TStatus>; readonly dryRunPlan?: NormalizedOperationPlan<TStatus>; }
export interface EffectPolicy { readonly mode: EffectExecutionMode; readonly reason?: string; readonly replayable: boolean; }
export interface NameHelpers { dnsSafe(input: string, options?: NameOptions): KubernetesName; withHash(prefix: string, input: string, options?: NameOptions): KubernetesName; }
export interface NameOptions { readonly maxLength?: number; readonly collisionSuffixLength?: number; }
export interface KubernetesFactoryGroup { Job(config: KubernetesFactoryConfig): import('./resource.js').KubernetesObject<JsonObject, JsonObject>; Deployment(config: KubernetesFactoryConfig): import('./resource.js').KubernetesObject<JsonObject, JsonObject>; Service(config: KubernetesFactoryConfig): import('./resource.js').KubernetesObject<JsonObject, JsonObject>; ConfigMap(config: ConfigMapFactoryConfig): import('./resource.js').KubernetesObject<JsonObject, JsonObject> & { readonly data?: Readonly<Record<string, string>>; readonly binaryData?: Readonly<Record<string, string>>; readonly immutable?: boolean; }; StatefulSet(config: KubernetesFactoryConfig): import('./resource.js').KubernetesObject<JsonObject, JsonObject>; }
export interface KubernetesFactoryConfig extends KubernetesFactoryBaseConfig { readonly image?: string; readonly env?: Readonly<Record<string, string>>; readonly spec?: JsonObject; }
export interface ConfigMapFactoryConfig extends KubernetesFactoryBaseConfig { readonly data?: Readonly<Record<string, string>>; readonly binaryData?: Readonly<Record<string, string>>; readonly immutable?: boolean; }
export interface KubernetesFactoryBaseConfig { readonly name: KubernetesName; readonly namespace?: NamespaceName; readonly labels?: Readonly<Record<string, string>>; readonly annotations?: Readonly<Record<string, string>>; }
