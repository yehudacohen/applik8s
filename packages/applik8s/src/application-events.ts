import type { AnyKubernetesReadResourceDefinition, AnyResourceDefinition, FinalizeHandlerOptions, HandlerRegistration, OperatorDefinition, OperatorDeploymentOptions, PermissionRule, ResourceDefinition, ResourceObject, SecondaryWatchRegistration } from '@applik8s/core';
import type { OperatorDeploymentBindingKind, OperatorDeploymentStatus } from '@applik8s/sdk';

export { createApplicationResourceEventOperatorController } from './application-resource-event-controller.js';

export type ApplicationResourceEventHandler<TSpec extends object, TStatus extends object> = Parameters<ResourceDefinition<TSpec, TStatus>['on']['reconcile']>[0];
export type ApplicationResourceObject<TResource> = TResource extends ResourceDefinition<infer TSpec, infer TStatus> ? ResourceObject<TSpec, TStatus> : never;

export interface ApplicationFinalizeEventHandler<TSpec extends object, TStatus extends object> extends FinalizeHandlerOptions {
  readonly handler: Parameters<ResourceDefinition<TSpec, TStatus>['on']['finalize']>[0];
}

/** One app-owned controller expressed as explicit Kubernetes lifecycle events. */
export interface ApplicationResourceEventHandlers<TSpec extends object, TStatus extends object> {
  readonly reconcile?: Parameters<ResourceDefinition<TSpec, TStatus>['on']['reconcile']>[0];
  readonly created?: Parameters<ResourceDefinition<TSpec, TStatus>['on']['created']>[0];
  readonly updated?: Parameters<ResourceDefinition<TSpec, TStatus>['on']['updated']>[0];
  readonly deleted?: Parameters<ResourceDefinition<TSpec, TStatus>['on']['deleted']>[0];
  readonly statusChanged?: Parameters<ResourceDefinition<TSpec, TStatus>['on']['statusChanged']>[0];
  readonly finalize?: ApplicationFinalizeEventHandler<TSpec, TStatus>;
}

export interface ApplicationResourceControllerOptions extends OperatorDeploymentOptions {
  readonly name?: string;
  /** Additional Kubernetes kinds available through `resource.read`. */
  readonly reads?: Readonly<Record<string, AnyKubernetesReadResourceDefinition>>;
  /** Exact secondary-resource wakeups lowered into the generated operator. */
  readonly secondaryWatches?:
    | readonly SecondaryWatchRegistration[]
    | ((resource: AnyResourceDefinition) => readonly SecondaryWatchRegistration[]);
  /** Explicit RBAC required by direct Kubernetes SDK calls in this handler. */
  readonly permissions?: readonly PermissionRule[];
}

export interface ApplicationResourceControllerBinding {
  readonly installKind: OperatorDeploymentBindingKind;
  readonly operatorName: string;
  readonly definition: OperatorDefinition;
  readonly status: OperatorDeploymentStatus;
}

export interface ApplicationResourceEventOperatorController {
  readonly operator: { readonly definition: OperatorDefinition };
  readonly deployed: ApplicationResourceControllerBinding;
  add(
    registration: HandlerRegistration<object, object>,
    callback: unknown,
  ): void;
}
