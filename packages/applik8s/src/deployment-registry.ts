import type { ApplicationGraph, ApplicationProviderNode } from '@applik8s/core';

import {
  canonicalApplicationContainerRegistryOrigin,
  isApplicationContainerRegistryProvider,
} from './application-providers.js';
import type {
  ApplicationContainerRegistryEndpoint,
  ApplicationContainerRegistryProvider,
  ApplicationContainerRegistrySecretRef,
} from './application-providers.js';

export type {
  ApplicationContainerRegistryCredentialSecret,
  ApplicationContainerRegistryEndpoint,
  ApplicationContainerRegistryProvider,
} from './application-providers.js';

/** Deployment-host coordinates for the one registry selected by an Application graph. */
export interface ResolvedApplicationContainerRegistry {
  readonly provider: ApplicationContainerRegistryProvider;
  readonly origin?: string;
  readonly pullOrigin?: string;
  readonly deploymentRepositoryPrefix?: string;
  readonly repositoryPrefix?: string;
  readonly remote: boolean;
  readonly pullSecretName?: string;
  readonly pullSecret?: ApplicationContainerRegistrySecretRef;
}

export function applicationContainerRegistryFromGraph(
  graph: ApplicationGraph,
): ApplicationContainerRegistryProvider {
  const candidates = graph.nodes.filter(
    (node): node is ApplicationProviderNode<'ContainerRegistry'> =>
      node.kind === 'provider' && node.interface === 'ContainerRegistry',
  );
  if (candidates.length === 0) return { kind: 'orbstack-container-registry' };
  if (candidates.length > 1) {
    throw new Error('ApplicationGraph declares more than one ContainerRegistry provider.');
  }
  const provider = candidates[0]?.config?.containerRegistry;
  if (!isApplicationContainerRegistryProvider(provider)) {
    throw new Error('ApplicationGraph ContainerRegistry provider is missing its validated deployment contract.');
  }
  return provider;
}

export async function resolveApplicationContainerRegistry(
  provider: ApplicationContainerRegistryProvider,
  resolveNodePort: (
    endpoint: Extract<ApplicationContainerRegistryEndpoint, { readonly kind: 'kubernetes-node-port' }>,
  ) => Promise<string>,
): Promise<ResolvedApplicationContainerRegistry> {
  if (provider.kind === 'orbstack-container-registry') {
    return { provider, remote: false };
  }
  const resolvedOrigin = provider.endpoint.kind === 'origin'
    ? provider.endpoint.origin
    : await resolveNodePort(provider.endpoint);
  const origin = canonicalApplicationContainerRegistryOrigin(resolvedOrigin);
  const pullOrigin = canonicalApplicationContainerRegistryOrigin(
    provider.endpoint.kind === 'kubernetes-node-port' && provider.endpoint.pullHost
      ? `${provider.endpoint.protocol}://${provider.endpoint.pullHost}:${provider.endpoint.port}`
      : origin,
  );
  const pullSecretName = provider.pullSecret?.name;
  return {
    provider,
    origin,
    pullOrigin,
    remote: true,
    ...(provider.kind === 'harbor-container-registry'
      ? { repositoryPrefix: provider.project }
      : provider.repositoryPrefix
        ? { repositoryPrefix: provider.repositoryPrefix }
        : {}),
    ...(pullSecretName ? { pullSecretName } : {}),
    ...(provider.pullSecret ? { pullSecret: provider.pullSecret } : {}),
  };
}
