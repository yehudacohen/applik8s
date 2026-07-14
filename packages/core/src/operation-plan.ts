import type { KubernetesConnectionName } from './capability.js';
import type { Diagnostic, FinalizerAction, JsonPatchOperationKind, JsonValue, KubernetesEventType, ObjectRef } from './common.js';
import type { ApplyTargetInput, DeleteTargetInput, OperationTarget } from './handler.js';
import type { AnyKubernetesObject } from './resource.js';

export type PartialStatus<TStatus extends object> = { readonly [K in keyof TStatus]?: TStatus[K] };
export interface HandlerResult<TStatus extends object = import('./common.js').JsonObject> { readonly apply?: readonly ApplyOperationInput[]; readonly patch?: readonly PatchLikeOperation[]; readonly delete?: readonly DeleteOperationInput[]; readonly status?: PartialStatus<TStatus>; readonly events?: readonly EventOperation[]; readonly finalizers?: readonly FinalizerOperationSpec[]; readonly requeue?: RequeuePolicy; readonly diagnostics?: readonly Diagnostic[]; }
export interface OperationPlanInput<TStatus extends object = import('./common.js').JsonObject> { readonly apply?: readonly ApplyOperationInput[]; readonly resources?: readonly ApplyOperationInput[]; readonly applyTargets?: readonly (OperationTarget<TStatus> | ApplyTargetInput<TStatus>)[]; readonly deleteTargets?: readonly (OperationTarget<TStatus> | DeleteTargetInput<TStatus>)[]; readonly patch?: readonly PatchLikeOperation[]; readonly delete?: readonly DeleteOperationInput[]; readonly status?: PartialStatus<TStatus>; readonly events?: readonly EventOperation[]; readonly finalizers?: readonly FinalizerOperationSpec[]; readonly requeue?: RequeuePolicy; }
export interface NormalizedOperationPlan<TStatus extends object = import('./common.js').JsonObject> { readonly operations: readonly Operation<TStatus>[]; readonly diagnostics?: readonly Diagnostic[]; }
export type Operation<TStatus extends object = import('./common.js').JsonObject> = ApplyOperation | PatchOperation | DeleteOperation | StatusOperation<TStatus> | EventOperation | FinalizerOperationSpec | RequeueOperation;
export type PatchLikeOperation = PatchOperation | StatusOperation<object>;
export type ApplyOperationInput = AnyKubernetesObject | ApplyOperation;
export type ApplyOwnership = { readonly mode: 'auto' } | { readonly mode: 'none' } | { readonly mode: 'reference'; readonly ref: ObjectRef; readonly blockOwnerDeletion?: boolean };
export type RemoteMutationAuthority =
  | { readonly mode: 'managed'; readonly identity: string; readonly sourceUid: string }
  | { readonly mode: 'existing'; readonly precondition: { readonly uid: string; readonly resourceVersion: string } };
export interface ApplyOperation { readonly kind: 'apply'; readonly resource: AnyKubernetesObject; readonly fieldManager?: string; readonly force?: boolean; readonly ownership?: ApplyOwnership; readonly connection?: KubernetesConnectionName; readonly authority?: RemoteMutationAuthority; }
export interface PatchOperation { readonly kind: 'patch'; readonly ref: ObjectRef; readonly patch: JsonPatch; readonly connection?: KubernetesConnectionName; readonly authority?: RemoteMutationAuthority; }
export type JsonPatch = readonly JsonPatchEntry[];
export interface JsonPatchEntry { readonly op: JsonPatchOperationKind; readonly path: string; readonly value?: JsonValue; readonly from?: string; }
export interface DeleteOperation { readonly kind: 'delete'; readonly ref: ObjectRef; readonly options?: DeleteOptions; readonly connection?: KubernetesConnectionName; readonly authority?: RemoteMutationAuthority; }
export type DeleteOperationInput = ObjectRef | DeleteOperation;
export interface DeleteOptions { readonly propagationPolicy?: 'Foreground' | 'Background' | 'Orphan'; readonly gracePeriodSeconds?: number; }
export interface StatusOperation<TStatus extends object = import('./common.js').JsonObject> { readonly kind: 'status'; readonly status: PartialStatus<TStatus>; readonly ref?: ObjectRef; }
export interface EventOperation { readonly kind: 'event'; readonly type: KubernetesEventType; readonly reason: string; readonly message: string; readonly regarding?: ObjectRef; }
export interface FinalizerOperationSpec { readonly kind: 'finalizer'; readonly operation: FinalizerAction; readonly finalizer: string; }
export interface RequeueOperation { readonly kind: 'requeue'; readonly policy: RequeuePolicy; }
export interface RequeuePolicy { readonly afterSeconds?: number; readonly reason?: string; }
