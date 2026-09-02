import type {
  ApplicationGraphEdge,
  ApplicationGraphNode,
  ApplicationProviderInterfaceKind,
  ApplicationProviderRef,
  ApplicationProviderRequirement,
} from '@applik8s/core';
import type { KubernetesApplicationScope } from './application-builder.js';
import type { ApplicationGraphState } from './application-graph-state.js';
import {
  addApplicationGraphEdge,
  addApplicationGraphNode,
  addApplicationProviderRequirement,
} from './application-graph-state.js';
import { applicationProviderGraphNodeId } from './application-identifiers.js';
import type { ApplicationQualifiedProviderBinding } from './application-profiles.js';

const applicationGraphExtensionRegistrar = Symbol.for(
  '@applik8s/application-graph-extension-registrar',
);

export interface ApplicationGraphExtensionContribution {
  readonly node: ApplicationGraphNode;
  readonly edges?: readonly ApplicationGraphEdge[];
  readonly providerRequirements?: readonly ApplicationProviderRequirement[];
}

type ApplicationGraphExtensionRegistration = (
  contribution: ApplicationGraphExtensionContribution,
) => void;

/** @internal Installs the graph-only extension seam on one application scope. */
export function bindApplicationGraphExtensionRegistrar(
  scope: KubernetesApplicationScope,
  register: ApplicationGraphExtensionRegistration,
): void {
  Object.defineProperty(scope, applicationGraphExtensionRegistrar, {
    value: register,
    enumerable: false,
    configurable: false,
    writable: false,
  });
}

/**
 * Internal package-extension boundary for maintained Applik8s modules whose
 * execution family is not one of the root builder's ordinary registrars.
 * Application authors should consume the maintained module, not this seam.
 */
export function registerApplicationGraphExtension(
  scope: KubernetesApplicationScope,
  contribution: ApplicationGraphExtensionContribution,
): void {
  const register = Reflect.get(scope, applicationGraphExtensionRegistrar) as
    | ApplicationGraphExtensionRegistration
    | undefined;
  if (!register) {
    throw new Error(
      'Application graph extensions require an Applik8s application scope.',
    );
  }
  register(contribution);
}

/** @internal Applies one already-replayable extension contribution. */
export function applyApplicationGraphExtension(
  state: ApplicationGraphState,
  contribution: ApplicationGraphExtensionContribution,
): void {
  addApplicationGraphNode(state, structuredClone(contribution.node));
  for (const edge of contribution.edges ?? []) {
    addApplicationGraphEdge(state, structuredClone(edge));
  }
  for (const requirement of contribution.providerRequirements ?? []) {
    addApplicationProviderRequirement(state, structuredClone(requirement));
  }
}

/** @internal Converts an injected qualified provider into its exact graph ref. */
export function applicationQualifiedProviderRef<
  TInterface extends ApplicationProviderInterfaceKind,
>(
  provider: ApplicationQualifiedProviderBinding<unknown>,
  providerInterface: TInterface,
): ApplicationProviderRef<TInterface> {
  if (provider.token.base.name !== providerInterface) {
    throw new Error(
      `Injected provider ${provider.qualification.key} implements ${provider.token.base.name}, not ${providerInterface}.`,
    );
  }
  return Object.freeze({
    interface: providerInterface,
    nodeId: applicationProviderGraphNodeId(
      providerInterface,
      provider.qualification,
    ),
  });
}
