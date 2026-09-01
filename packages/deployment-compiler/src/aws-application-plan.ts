// typecast-file-boundary: The validated AWS target plan is adapted into the
// provider-neutral physical-plan input without exposing AWS objects to domain
// source or making this adapter a lifecycle owner.
import {
  type ApplicationGraph,
  type ApplicationImplementationPlan,
  type ApplicationNativePlanRecord,
  type ApplicationPlan,
  applicationCanonicalIdentity,
  applicationTargetIdentity,
  sourceProvenance,
} from '@applik8s/core';
import {
  type ApplicationAwsDeploymentPlan,
  type ApplicationDeploymentEdge,
  type ApplicationDeploymentGraph,
  type ApplicationDeploymentNode,
  digestApplicationDeploymentValue,
} from '@applik8s/deployment-contract';
import { compileApplicationPlan } from './application-plan.js';
import { applicationProviderGuaranteesForGraph } from './provider-guarantees.js';
import { applicationDeploymentGraphForImplementationPlan } from './implementation-plan-graph.js';

export interface CompileApplicationAwsApplicationPlanRequest {
  readonly graph: ApplicationGraph;
  readonly aws: ApplicationAwsDeploymentPlan;
  readonly implementationPlan?: ApplicationImplementationPlan;
  readonly workspaceRoot?: string;
}

/**
 * Composes the Alchemy-owned AWS plan into the canonical ApplicationPlan.
 * The adapter is explanatory only: the original AWS plan remains the native
 * deployment artifact and Alchemy remains the sole lifecycle authority.
 */
export function compileApplicationAwsApplicationPlan(
  request: CompileApplicationAwsApplicationPlanRequest,
): ApplicationPlan {
  // Capability qualification needs only the profile-selected implementation
  // identity. Keep environment-derived configuration out of the canonical
  // explanation artifact; the native AWS plan separately owns its concrete
  // public configuration and all Secret values remain external.
  const providerGraph = request.implementationPlan
    ? applicationDeploymentGraphForImplementationPlan(request.graph, request.implementationPlan)
    : request.graph;
  const connectionDigest = digestApplicationDeploymentValue({
    provider: 'aws',
    accountId: request.aws.accountId ?? 'unresolved',
    region: request.aws.region,
  });
  const sourceGraphDigest = request.aws.runtimeAccess.sourceGraphDigest;
  const deployment: ApplicationDeploymentGraph = {
    apiVersion: 'applik8s.deploymentGraph/v1alpha1',
    kind: 'ApplicationDeploymentGraph',
    metadata: {
      identity: {
        connection: {
          provider: 'aws',
          cluster: `${request.aws.accountId ?? 'unresolved'}/${request.aws.region}`,
          digest: connectionDigest,
        },
        application: request.aws.application,
        controlPlaneNamespace: request.aws.region,
        instance: request.aws.environment,
        profile: request.implementationPlan?.profile.id ?? request.aws.environment,
      },
      mode: 'fresh',
      strategy: 'direct',
      sourceGraphDigest,
      compilerVersion: '0.8.0',
    },
    runtimeAccess: request.aws.runtimeAccess,
    nodes: request.aws.resources.map((resource): ApplicationDeploymentNode => ({
      id: resource.id,
      kind: 'externalProvider',
      contractVersion: 1,
      source: {
        ...(resource.semanticNodeId ? { semanticNodeId: resource.semanticNodeId } : {}),
        ...(resource.provenance.source ? { file: resource.provenance.source } : {}),
      },
      provider: {
        interface: `AWS/${resource.service}`,
        implementation: resource.resourceType,
        version: 'v1alpha1',
      },
      scope: { connectionDigest },
      capabilities: { strategies: ['direct'], alchemy: true },
      configurationDigest: digestApplicationDeploymentValue(resource.configuration),
      inputs: {},
      outputs: resource.outputs.map((output) => ({
        name: output.name,
        type: 'string' as const,
        sensitivity: output.sensitivity,
        persistence: output.persistence,
      })),
      lifecycle: resource.lifecycle,
      spec: {
        resourceType: `aws:${resource.service}:${resource.resourceType}`,
        controller: 'alchemy',
        configuration: resource.configuration,
      },
    })),
    edges: request.aws.edges.map((edge): ApplicationDeploymentEdge => ({
      from: edge.from,
      to: edge.to,
      relationship: edge.relationship === 'requiresOutput'
        ? 'requiresOutput'
        : edge.relationship === 'publishes'
          ? 'publishes'
          : 'requiresReady',
      ...(edge.output ? { output: edge.output } : {}),
    })),
  };
  const application = applicationCanonicalIdentity({
    application: request.aws.application,
    kind: 'application',
    semanticKey: request.aws.application,
  });
  const target = applicationTargetIdentity({
    application: request.aws.application,
    target: 'aws',
    connectionDigest,
    instance: request.aws.environment,
    parentId: application.id,
  });
  const provenance = sourceProvenance({
    origin: 'provider-plan',
    generatedBy: 'alchemy/aws-plan/v1alpha1',
    symbol: request.aws.application,
  });
  const nativePlan: ApplicationNativePlanRecord = {
    apiVersion: 'applik8s.nativePlan/v1alpha1',
    id: `native-plan:alchemy:${target.id}`,
    authority: 'alchemy',
    adapterVersion: 'aws-plan/v1alpha1',
    target: target.id,
    contentDigest: request.aws.digest,
    resourceIds: request.aws.resources.map(({ id }) => id).sort(),
    actions: [...new Set(request.aws.resources.map((resource) =>
      resource.lifecycle.ownership === 'external'
        ? 'external' as const
        : resource.lifecycle.deletion === 'retain'
          ? 'retain' as const
          : resource.lifecycle.adoption === 'createOnly'
            ? 'create' as const
            : 'adopt' as const))].sort(),
    provenance: [provenance],
    summary: {
      resourceCount: request.aws.resources.length,
      edgeCount: request.aws.edges.length,
      region: request.aws.region,
      accountId: request.aws.accountId ?? 'unresolved',
    },
  };
  return compileApplicationPlan({
    graph: providerGraph,
    deployment,
    target: 'aws',
    lifecycleAuthority: 'alchemy',
    generatedAt: new Date(0).toISOString(),
    providerGuarantees: applicationProviderGuaranteesForGraph({
      graph: providerGraph,
      target: 'aws',
      profile: request.implementationPlan?.profile.id ?? request.aws.environment,
    }),
    nativePlans: [nativePlan],
    ...(request.implementationPlan ? { implementationPlan: request.implementationPlan } : {}),
    ...(request.workspaceRoot ? { workspaceRoot: request.workspaceRoot } : {}),
  });
}
