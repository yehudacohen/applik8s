import type { FinalizeHandlerOptions, HandlerRegistration, OperatorDefinition, OperatorDeploymentOptions, PermissionRule, ResourceDefinition, ResourceObject } from '@applik8s/core';
import type { OperatorDeploymentBindingKind, OperatorDeploymentStatus } from '@applik8s/sdk';
import { sdk } from '@applik8s/sdk';
import { kubernetesNameSegment } from './application-identifiers.js';
import { applicationTypeKroString } from './application-typekro-values.js';

export type ApplicationReconcileHandler<TSpec extends object, TStatus extends object> = Parameters<ResourceDefinition<TSpec, TStatus>['on']['reconcile']>[0];
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

export interface ApplicationReconcileOptions extends OperatorDeploymentOptions {
  readonly name?: string;
  /** Explicit RBAC required by direct Kubernetes SDK calls in this handler. */
  readonly permissions?: readonly PermissionRule[];
}

export interface ApplicationResourceControllerBinding {
  readonly installKind: OperatorDeploymentBindingKind;
  readonly operatorName: string;
  readonly definition: OperatorDefinition;
  readonly status: OperatorDeploymentStatus;
}

export function createApplicationResourceEventOperator<TSpec extends object, TStatus extends object>(
  resource: ResourceDefinition<TSpec, TStatus>,
  handlers: ApplicationResourceEventHandlers<TSpec, TStatus>,
  options: ApplicationReconcileOptions,
) {
  const { name, permissions, ...authoredDeployment } = options;
  const deployment = authoredDeployment.namespace
    ? { ...authoredDeployment, namespace: applicationTypeKroString(authoredDeployment.namespace) }
    : authoredDeployment;
  const registrations: HandlerRegistration<TSpec, TStatus>[] = [];
  if (handlers.reconcile) registrations.push(resource.on.reconcile(handlers.reconcile));
  if (handlers.created) registrations.push(resource.on.created(handlers.created));
  if (handlers.updated) registrations.push(resource.on.updated(handlers.updated));
  if (handlers.deleted) registrations.push(resource.on.deleted(handlers.deleted));
  if (handlers.statusChanged) registrations.push(resource.on.statusChanged(handlers.statusChanged));
  if (handlers.finalize) {
    const { handler, ...finalizerOptions } = handlers.finalize;
    registrations.push(resource.on.finalize(handler, finalizerOptions));
  }
  if (registrations.length === 0) throw new Error(`Application controller for ${resource.kind} requires at least one lifecycle handler.`);
  const operator = sdk.operator({
    name: name ?? `${kubernetesNameSegment(resource.kind)}-controller`,
    resources: { [resource.kind]: resource },
    handlers: registrations,
    ...(permissions && permissions.length > 0 ? { permissions } : {}),
    ...(Object.keys(deployment).length > 0 ? { deployment } : {}),
  });
  return { operator, deployed: operator(deployment) };
}
