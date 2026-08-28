import {
  type ApplicationProviderNode,
  type ApplicationRuntimeAccessRequirement,
  applicationCanonicalIdentity,
  applicationExecutionBoundaryIdentity,
  applicationProviderIdentity,
  applicationRuntimeAccessRequirement,
  sourceProvenance,
} from '@applik8s/core';
import type { ApplicationRuntimeAccessWorkloadPlacement } from './runtime-access-plan.js';
import type {
  ApplicationDeploymentPlanningContext,
  ApplicationDeploymentRuntimeAccessTarget,
} from './types.js';

export interface CelldProviderRuntimeAccessOptions {
  readonly provider: ApplicationProviderNode;
  readonly context: ApplicationDeploymentPlanningContext;
  readonly deploymentNodeId: string;
  readonly artifactManifestDigest: string;
  readonly name: string;
  readonly namespace: string;
  readonly stateStoreEndpoint?: string;
  readonly stateStoreSecret: {
    readonly namespace: string;
    readonly name: string;
    readonly keys: readonly string[];
  };
  readonly authorizationSecret: {
    readonly namespace: string;
    readonly name: string;
    readonly keys: readonly string[];
  };
  readonly applicationService: {
    readonly namespace: string;
    readonly name: string;
    readonly port: number;
    readonly podSelector: Readonly<Record<string, string>>;
  };
}

/**
 * Canonical access identity for the two provider-owned Celld execution
 * boundaries. The adapter authors these requirements because it owns the
 * workload lifecycle; rendered TypeKro resources remain parity evidence only.
 */
export function celldProviderRuntimeAccess(
  options: CelldProviderRuntimeAccessOptions,
): {
  readonly targets: readonly ApplicationDeploymentRuntimeAccessTarget[];
  readonly requirements: readonly ApplicationRuntimeAccessRequirement[];
  readonly workloads: readonly ApplicationRuntimeAccessWorkloadPlacement[];
} {
  const deployerExecutionNodeId = `${options.deploymentNodeId}.worker-deployment`;
  const fleetExecutionNodeId = `${options.deploymentNodeId}.fleet`;
  const stateStoreCapabilityId = `${options.provider.id}.celld-state-store`;
  const applicationCapabilityId = `${options.provider.id}.application-endpoint`;
  const labels = celldWorkloadLabels(options.name);
  const application = applicationCanonicalIdentity({
    application: options.context.graph.metadata.name,
    kind: 'application',
    semanticKey: options.context.graph.metadata.name,
  });
  const providerIdentity = applicationProviderIdentity({
    application: options.context.graph.metadata.name,
    capabilityInterface: options.provider.interface,
    nodeId: options.provider.id,
    parentId: application.id,
  });
  const provenance = sourceProvenance({
    origin: 'framework-generated',
    generatedBy: 'deployment-provider:ActorRuntime/celld-actors',
    symbol: options.provider.id,
    causedBy: providerIdentity.id,
  });
  const requirementFor = (
    nodeId: string,
    qualifier: string,
    target: ApplicationRuntimeAccessRequirement['target'],
    sensitivity: ApplicationRuntimeAccessRequirement['sensitivity'],
  ): ApplicationRuntimeAccessRequirement => applicationRuntimeAccessRequirement({
    consumer: {
      nodeId,
      executionIdentity: applicationExecutionBoundaryIdentity({
        application: options.context.graph.metadata.name,
        boundaryKind: 'provider-runtime',
        ownerNodeId: options.provider.id,
        qualifier,
        parentId: providerIdentity.id,
      }).id,
      artifactId: 'artifact.celld-runtime',
    },
    target,
    origin: 'provider-required',
    provenance: [provenance],
    sensitivity,
    enforcement: 'required',
  });
  const perExecution = (nodeId: string, qualifier: string) => [
    requirementFor(nodeId, qualifier, {
      capabilityId: 'Secret',
      operation: 'secret.read',
      scope: {
        kind: 'resource',
        resourceId: `v1/Secret/${options.stateStoreSecret.namespace}/${options.stateStoreSecret.name}`,
        keys: [...options.stateStoreSecret.keys].sort(),
      },
    }, 'credential'),
    requirementFor(nodeId, qualifier, {
      capabilityId: 'Secret',
      operation: 'secret.read',
      scope: {
        kind: 'resource',
        resourceId: `v1/Secret/${options.authorizationSecret.namespace}/${options.authorizationSecret.name}`,
        keys: [...options.authorizationSecret.keys].sort(),
      },
    }, 'credential'),
    requirementFor(nodeId, qualifier, {
      capabilityId: stateStoreCapabilityId,
      operation: 'network.connect',
      scope: { kind: 'resource', resourceId: stateStoreCapabilityId },
    }, 'internal'),
    requirementFor(nodeId, qualifier, {
      capabilityId: applicationCapabilityId,
      operation: 'network.connect',
      scope: { kind: 'resource', resourceId: applicationCapabilityId },
    }, 'internal'),
  ];
  const actorExecutionNodeIds = options.context.graph.nodes.flatMap((candidate) =>
    candidate.kind === 'actor' && candidate.runtime.nodeId === options.provider.id
      ? [candidate.id]
      : []);
  return {
    targets: [
      {
        capabilityId: options.provider.id,
        target: 'kubernetes',
        namespace: options.namespace,
        serviceName: options.name,
        podSelector: labels,
        protocol: 'TCP',
        port: 8080,
      },
      celldStateStoreRuntimeAccessTarget(stateStoreCapabilityId, options.stateStoreEndpoint),
      {
        capabilityId: applicationCapabilityId,
        target: 'kubernetes',
        namespace: options.applicationService.namespace,
        serviceName: options.applicationService.name,
        podSelector: options.applicationService.podSelector,
        protocol: 'TCP',
        port: options.applicationService.port,
      },
    ],
    requirements: [
      ...perExecution(deployerExecutionNodeId, 'worker-deployment'),
      ...perExecution(fleetExecutionNodeId, 'fleet'),
    ],
    workloads: [
      {
        workloadIdentity: `batch/v1:Job:${options.namespace}:${celldDeploymentJobName(options.name, options.artifactManifestDigest)}`,
        artifactIds: ['artifact.celld-runtime'],
        executionNodeIds: [deployerExecutionNodeId],
        kubernetes: {
          resource: {
            apiVersion: 'batch/v1',
            kind: 'Job',
            namespace: options.namespace,
            name: celldDeploymentJobName(options.name, options.artifactManifestDigest),
          },
          materialization: {
            authority: 'operator-reconciled',
            deploymentNodeId: options.deploymentNodeId,
          },
          podSelector: labels,
          serviceAccountName: `${options.name}-celld`,
        },
      },
      {
        workloadIdentity: `apps/v1:StatefulSet:${options.namespace}:${options.name}`,
        artifactIds: ['artifact.celld-runtime'],
        executionNodeIds: [...actorExecutionNodeIds, fleetExecutionNodeId].sort(),
        kubernetes: {
          resource: {
            apiVersion: 'apps/v1',
            kind: 'StatefulSet',
            namespace: options.namespace,
            name: options.name,
          },
          materialization: {
            authority: 'operator-reconciled',
            deploymentNodeId: options.deploymentNodeId,
          },
          podSelector: labels,
          serviceAccountName: `${options.name}-celld`,
        },
      },
    ],
  };
}

export function celldWorkloadLabels(name: string): Readonly<Record<string, string>> {
  return {
    'app.kubernetes.io/name': 'celld',
    'app.kubernetes.io/instance': name,
    'app.kubernetes.io/component': 'actor-runtime',
    'app.kubernetes.io/managed-by': 'applik8s-celld-operator',
  };
}

function celldDeploymentJobName(name: string, manifestDigest: string): string {
  return `${name}-deploy-${manifestDigest.slice('sha256:'.length, 'sha256:'.length + 12)}`;
}

function celldStateStoreRuntimeAccessTarget(
  capabilityId: string,
  endpoint: string | undefined,
): ApplicationDeploymentRuntimeAccessTarget {
  if (!endpoint) {
    return {
      capabilityId,
      target: 'external',
      protocol: 'TCP',
      port: 443,
      destination: {
        kind: 'externalContract',
        responsibility: 'S3-compatible Celld state-store endpoint selected by the provider binding',
      },
      fidelity: 'not-introspectable',
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error(`ActorRuntime.celld(...) stateStore.endpoint must be an absolute URL; received ${endpoint}.`);
  }
  const port = parsed.port
    ? Number.parseInt(parsed.port, 10)
    : parsed.protocol === 'https:' ? 443 : parsed.protocol === 'http:' ? 80 : undefined;
  if (!port || port < 1 || port > 65_535) {
    throw new Error(`ActorRuntime.celld(...) stateStore.endpoint has no valid TCP port: ${endpoint}.`);
  }
  return {
    capabilityId,
    target: 'external',
    protocol: 'TCP',
    port,
    destination: { kind: 'dnsName', hostname: parsed.hostname },
    fidelity: 'port-only',
  };
}
