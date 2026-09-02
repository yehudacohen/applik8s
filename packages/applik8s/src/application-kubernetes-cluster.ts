import type {
  JsonObject,
  ResourceDefinition,
  ResourceObject,
} from '@applik8s/core';
import { applicationProviderGraphNodeId } from './application-identifiers.js';
import {
  bindApplicationProviderDependencies,
  bindApplicationProviderOperation,
} from './application-provider-dependencies.js';
import type { ApplicationQualifiedProviderToken } from './application-providers.js';
import { resourcesApplicationKubernetesCluster } from './kubernetes-cluster-runtime.js';

export interface ApplicationKubernetesIdentity {
  readonly name: string;
  readonly namespace?: string;
}

export interface ApplicationKubernetesListQuery {
  readonly namespace?: string;
  readonly labels?: Readonly<Record<string, string>>;
  readonly fields?: Readonly<Record<string, string>>;
  readonly continue?: string;
}

export interface ApplicationKubernetesPageBounds {
  readonly pageSize?: number;
  readonly maxPages?: number;
  readonly maxItems?: number;
  readonly maxBytes?: number;
  readonly timeout?: string;
}

export interface ApplicationKubernetesWatchBounds {
  readonly from?: string;
  readonly timeout: string;
  readonly maxEvents: number;
  readonly maxBytes?: number;
}

export interface ApplicationKubernetesMutationOwnership {
  readonly fieldManager: string;
  readonly force?: boolean;
  readonly expectedUid?: string;
  readonly expectedResourceVersion?: string;
}

export interface ApplicationKubernetesDeletePreconditions {
  readonly uid?: string;
  readonly resourceVersion?: string;
  readonly propagation?: 'Background' | 'Foreground' | 'Orphan';
}

export interface ApplicationKubernetesListResult<TObject extends object> {
  readonly items: readonly TObject[];
  readonly resourceVersion?: string;
  readonly continue?: string;
}

export interface ApplicationKubernetesWatchEvent<TObject extends object> {
  readonly type: 'Added' | 'Modified' | 'Deleted' | 'Bookmark';
  readonly object: TObject;
}

export interface ApplicationKubernetesWatchResult<TObject extends object> {
  readonly events: readonly ApplicationKubernetesWatchEvent<TObject>[];
  readonly resourceVersion?: string;
}

export interface ApplicationKubernetesResourceFamily<
  TSpec extends object,
  TStatus extends object,
> {
  get(identity: ApplicationKubernetesIdentity): Promise<ResourceObject<TSpec, TStatus>>;
  list(
    query?: ApplicationKubernetesListQuery,
    bounds?: ApplicationKubernetesPageBounds,
  ): Promise<ApplicationKubernetesListResult<ResourceObject<TSpec, TStatus>>>;
  watch(
    query: ApplicationKubernetesListQuery,
    bounds: ApplicationKubernetesWatchBounds,
  ): Promise<ApplicationKubernetesWatchResult<ResourceObject<TSpec, TStatus>>>;
  apply(
    value: ResourceObject<TSpec, TStatus> | JsonObject,
    ownership: ApplicationKubernetesMutationOwnership,
  ): Promise<ResourceObject<TSpec, TStatus>>;
  patch(
    identity: ApplicationKubernetesIdentity,
    patch: JsonObject,
    ownership: ApplicationKubernetesMutationOwnership,
  ): Promise<ResourceObject<TSpec, TStatus>>;
  delete(
    identity: ApplicationKubernetesIdentity,
    preconditions: ApplicationKubernetesDeletePreconditions,
  ): Promise<{ readonly deleted: true; readonly uid?: string }>;
}

export interface ApplicationKubernetesClusterHandle<
  TImplementation,
  TName extends string = string,
> extends ApplicationQualifiedProviderToken<TImplementation, TName> {
  resources<TSpec extends object, TStatus extends object>(
    resource: Pick<
      ResourceDefinition<TSpec, TStatus>,
      'apiVersion' | 'kind' | 'plural' | 'scope'
    >,
  ): ApplicationKubernetesResourceFamily<TSpec, TStatus>;
}

/** @internal Builds the function-native facade returned by KubernetesCluster.named(...). */
export function createApplicationKubernetesClusterHandle<
  TImplementation,
  const TName extends string,
>(
  token: ApplicationQualifiedProviderToken<TImplementation, TName>,
): ApplicationKubernetesClusterHandle<TImplementation, TName> {
  const bindingId = applicationProviderGraphNodeId(token.name, token.qualification);
  const resources = <TSpec extends object, TStatus extends object>(
    resource: Pick<
      ResourceDefinition<TSpec, TStatus>,
      'apiVersion' | 'kind' | 'plural' | 'scope'
    >,
  ) => resourcesApplicationKubernetesCluster<TSpec, TStatus>(resource, { bindingId });
  bindApplicationProviderDependencies(resources, [token]);
  bindApplicationProviderOperation(resources, {
    member: 'resources',
    ...(token.callableRuntime?.operations.resources
      ? { runtime: token.callableRuntime.operations.resources }
      : {}),
  });
  return Object.freeze({
    ...token,
    resources,
  });
}
