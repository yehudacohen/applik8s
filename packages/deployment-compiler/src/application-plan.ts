// typecast-file-boundary: The compiler restores closed plan discriminants only while lowering already validated semantic and deployment graph records.
import {
  type ApplicationCanonicalIdentity,
  type ApplicationGraph,
  type ApplicationGraphNode,
  type ApplicationImplementationPlan,
  type ApplicationNativePlanRecord,
  type ApplicationPhysicalPlanNode,
  type ApplicationPlan,
  type ApplicationPlanDiagnostic,
  type ApplicationPlanEstimate,
  type ApplicationPlanObservability,
  type ApplicationProviderGuaranteeManifest,
  type ApplicationSourceProvenance,
  applicationCanonicalIdentity,
  applicationGraphNodeIdentity,
  applicationProviderIdentity,
  applicationTargetIdentity,
  deriveApplicationGraphFoundation,
  providerGuaranteeFor,
  sourceProvenance,
} from '@applik8s/core';
import {
  type ApplicationDeploymentGraph,
  type ApplicationDeploymentLifecycle,
  type ApplicationDeploymentNode,
  digestApplicationDeploymentGraph,
} from '@applik8s/deployment-contract';
import { applicationProviderExecution } from './providers.js';

export interface CompileApplicationPlanRequest {
  readonly graph: ApplicationGraph;
  /** Concrete provider graph used only for target resolution and diagnostics. */
  readonly resolutionGraph?: ApplicationGraph;
  /** Semantic executions intentionally unavailable rather than misconfigured. */
  readonly excludedExecutionNodeIds?: readonly string[];
  readonly deployment: ApplicationDeploymentGraph;
  readonly target: 'local' | 'aws-local' | 'aws' | 'kubernetes';
  readonly lifecycleAuthority: 'local-supervisor' | 'alchemy' | 'external';
  readonly generatedAt: string;
  readonly providerGuarantees?: readonly ApplicationProviderGuaranteeManifest[];
  readonly nativePlans?: readonly ApplicationNativePlanRecord[];
  readonly implementationPlan?: ApplicationImplementationPlan;
  /** Used only to make absolute compiler source locations workspace-relative. */
  readonly workspaceRoot?: string;
}

/**
 * Derives one stable explanation artifact from the canonical semantic and
 * deployment graphs. It performs no provider or lifecycle effect.
 */
export function compileApplicationPlan(request: CompileApplicationPlanRequest): ApplicationPlan {
  const foundation = deriveApplicationGraphFoundation(request.graph, {
    ...(request.workspaceRoot ? { workspaceRoot: request.workspaceRoot } : {}),
  });
  const application = applicationCanonicalIdentity({
    application: request.graph.metadata.name,
    kind: 'application',
    semanticKey: request.graph.metadata.name,
  });
  const target = applicationTargetIdentity({
    application: request.graph.metadata.name,
    target: request.target,
    connectionDigest: request.deployment.metadata.identity.connection.digest,
    instance: request.deployment.metadata.identity.instance,
    parentId: application.id,
  });
  const semanticIdentity = new Map<string, ApplicationCanonicalIdentity>();
  const semanticNodes = request.graph.nodes.map((node) => {
    const identity = applicationGraphNodeIdentity({
      application: request.graph.metadata.name,
      nodeKind: node.kind,
      nodeId: node.id,
      parentId: application.id,
    });
    semanticIdentity.set(node.id, identity);
    return {
      id: identity.id,
      graphNodeId: node.id,
      kind: node.kind,
      name: node.name,
      stability: node.stability,
      fact: 'declared' as const,
      provenance: [nodeProvenance(node, request.workspaceRoot)],
    };
  });
  const graphProvenance = sourceProvenance({
    origin: request.graph.metadata.sourceLocation ? 'authored' : 'framework-generated',
    ...(request.graph.metadata.sourceLocation
      ? {
          module: workspaceFile(request.graph.metadata.sourceLocation.file, request.workspaceRoot),
          location: {
            ...request.graph.metadata.sourceLocation,
            file: workspaceFile(request.graph.metadata.sourceLocation.file, request.workspaceRoot),
          },
        }
      : { generatedBy: 'application-graph' }),
    symbol: request.graph.metadata.name,
    causedBy: application.id,
  });
  const semanticEdges = request.graph.edges.map((edge) => {
    const from = requiredIdentity(semanticIdentity, edge.from.nodeId);
    const to = requiredIdentity(semanticIdentity, edge.to.nodeId);
    return {
      id: recordId('semantic-edge', [from.id, edge.relationship, to.id]),
      from: from.id,
      to: to.id,
      relationship: edge.relationship,
      fact: 'declared' as const,
      provenance: [graphProvenance],
    };
  });
  const executions = semanticExecutions(request.graph, semanticIdentity, foundation.identities, request.workspaceRoot);
  const authority = semanticAuthority(request.graph, semanticIdentity, request.workspaceRoot);
  const dataFlows = semanticEdges.map((edge) => ({
    id: recordId('data-flow', [edge.from, edge.relationship, edge.to]),
    from: edge.from,
    to: edge.to,
    relationship: edge.relationship,
    causal: causalRelationship(edge.relationship),
    fact: edge.fact,
    provenance: edge.provenance,
  }));
  const state = semanticState(request.graph, semanticIdentity, request.workspaceRoot);
  const exposures = semanticExposures(request.graph, semanticIdentity, request.workspaceRoot);
  const observability = semanticObservability(request.graph, semanticIdentity, request.workspaceRoot);
  const estimates = semanticEstimates(request.graph, request.deployment, semanticIdentity, request.workspaceRoot);

  const guarantees = request.providerGuarantees ?? [];
  const diagnostics: ApplicationPlanDiagnostic[] = [];
  const implementationPlan = request.implementationPlan;
  if (implementationPlan && implementationPlan.application !== request.graph.metadata.name) {
    diagnostics.push({
      severity: 'error',
      code: 'PLAN_IMPLEMENTATION_GRAPH_MISMATCH',
      message: `Implementation plan application ${implementationPlan?.application ?? '<missing>'} does not match graph ${request.graph.metadata.name}.`,
      provenance: implementationPlan?.profile.provenance ?? [graphProvenance],
    });
  }
  if (implementationPlan && implementationPlan.profile.id !== request.deployment.metadata.identity.profile) {
    diagnostics.push({
      severity: 'error',
      code: 'PLAN_IMPLEMENTATION_PROFILE_MISMATCH',
      message: `Implementation plan profile ${implementationPlan.profile.id} does not match deployment profile ${request.deployment.metadata.identity.profile}.`,
      provenance: implementationPlan.profile.provenance,
    });
  }
  const implementationBindings = implementationPlan?.bindings ?? [];
  const resolutionGraph = request.resolutionGraph ?? request.graph;
  const excludedExecutionNodeIds = new Set(request.excludedExecutionNodeIds ?? []);
  const resolvedProviderIdentities: ApplicationCanonicalIdentity[] = [];
  const resolutions = resolutionGraph.providerRequirements.map((requirement) => {
    const consumerNode = requiredNode(resolutionGraph, requirement.consumer.nodeId);
    const binding = resolutionGraph.providerBindings.find(({ requirement: id }) => id === requirement.id);
    const providerReference = binding?.provider ?? requirement.provider;
    const providerNode = providerReference
      ? resolutionGraph.nodes.find((node): node is Extract<ApplicationGraphNode, { kind: 'provider' }> => node.kind === 'provider' && node.id === providerReference.nodeId)
      : undefined;
    const providerIdentity = providerNode
      ? applicationProviderIdentity({
          application: request.graph.metadata.name,
          capabilityInterface: providerNode.interface,
          nodeId: providerNode.id,
          parentId: application.id,
        })
      : undefined;
    if (providerIdentity) resolvedProviderIdentities.push(providerIdentity);
    const manifest = providerIdentity ? providerGuaranteeFor(guarantees, providerIdentity.id) : undefined;
    const requiredGuarantees = consumerNode.kind === 'actor'
      && requirement.interface === 'ActorRuntime'
      ? Object.entries(consumerNode.definition.requirements)
          .filter(([, required]) => required)
          .map(([name]) => `actor-${name}`)
      : [];
    const missingRequiredGuarantees = manifest
      ? requiredGuarantees.filter((id) => !manifest.guarantees.some((guarantee) => guarantee.id === id && (guarantee.disposition === 'guaranteed' || guarantee.disposition === 'bounded')))
      : requiredGuarantees;
    const provenance = [
      providerNode ? nodeProvenance(providerNode, request.workspaceRoot) : nodeProvenance(requiredNode(request.graph, requirement.consumer.nodeId), request.workspaceRoot),
    ];
    const explicitlyUnavailable = excludedExecutionNodeIds.has(requirement.consumer.nodeId);
    const disposition = explicitlyUnavailable
      ? 'degraded' as const
      : !providerNode
      ? 'unresolved' as const
      : !manifest
        ? 'unresolved' as const
        : manifest.targets.includes(request.target)
          && !manifest.guarantees.every(({ disposition: guaranteeDisposition }) => guaranteeDisposition === 'unsupported')
          && missingRequiredGuarantees.length === 0
          ? 'supported' as const
          : 'incompatible' as const;
    if (disposition === 'unresolved' || disposition === 'incompatible') {
      const isUnsupportedJobProvider = consumerNode.kind === 'job';
      diagnostics.push({
        severity: 'error',
        code: isUnsupportedJobProvider
          ? 'JOB_PROVIDER_UNSUPPORTED'
          : disposition === 'unresolved'
            ? 'PLAN_PROVIDER_GUARANTEES_UNRESOLVED'
            : 'PLAN_PROVIDER_TARGET_INCOMPATIBLE',
        message: isUnsupportedJobProvider
          ? providerNode && manifest
            ? `Job ${consumerNode.name} selects ${providerNode.interface}/${providerNode.implementation} through ${providerNode.id}, which is not qualified for target ${request.target}.${manifest.limitations.length > 0 ? ` ${manifest.limitations.join(' ')}` : ''}`
            : providerNode
              ? `Job ${consumerNode.name} selects ${providerNode.interface}/${providerNode.implementation} through ${providerNode.id}, but that provider has no guarantee manifest for target ${request.target}.`
              : `Job ${consumerNode.name} has no resolved ${requirement.interface} provider for target ${request.target}. ${requirement.diagnostics.missing}`
          : !providerNode
          ? requirement.diagnostics.missing
          : !manifest
            ? `Provider ${providerNode.id} has no v0.8 guarantee manifest.`
            : missingRequiredGuarantees.length > 0
              ? `Provider ${providerNode.id} cannot satisfy ${consumerNode.id}: missing ${missingRequiredGuarantees.join(', ')}.`
              : `Provider ${providerNode.id} is not qualified for target ${request.target}.`,
        subjectId: requirement.id,
        provenance,
      });
    }
    const implementationCandidates = implementationBindings.filter(({ capability }) =>
      implementationCapabilityInterface(capability.interface) === requirement.interface);
    const implementationBinding = implementationCandidates.length === 1
      ? implementationCandidates[0]
      : implementationCandidates.find(({ capability }) => capability.qualifier === undefined);
    if (
      implementationPlan
      && !implementationBinding
      && (!providerNode || requiresProfileImplementationBinding(providerNode))
    ) {
      diagnostics.push({
        severity: 'error',
        code: implementationCandidates.length > 1
          ? 'PLAN_IMPLEMENTATION_BINDING_AMBIGUOUS'
          : 'PLAN_IMPLEMENTATION_BINDING_UNRESOLVED',
        message: implementationCandidates.length > 1
          ? `Capability ${requirement.interface} has multiple qualified implementation bindings and the legacy requirement has no qualifier.`
          : `Capability ${requirement.interface} has no concrete implementation binding in profile ${implementationPlan.profile.id}.`,
        subjectId: requirement.id,
        provenance,
      });
    }
    return {
      id: recordId('provider-resolution', [requirement.id]),
      requirementId: requirement.id,
      consumer: requiredIdentity(semanticIdentity, requirement.consumer.nodeId).id,
      capability: { interface: requirement.interface },
      ...(providerIdentity ? { provider: providerIdentity } : {}),
      ...(providerNode ? {
        implementation: manifest?.capability.implementation ?? providerNode.implementation,
        version: manifest?.capability.version ?? providerNode.contract?.version ?? 'unknown',
      } : {}),
      ...(implementationBinding ? { implementationIdentity: implementationBinding.implementation } : {}),
      maturity: manifest?.maturity ?? 'experimental',
      disposition,
      guarantees: manifest?.guarantees.filter(({ disposition: guaranteeDisposition }) => guaranteeDisposition === 'guaranteed' || guaranteeDisposition === 'bounded').map(({ id }) => id) ?? [],
      gaps: explicitlyUnavailable
        ? ['target-execution-unavailable']
        : manifest
        ? manifest.guarantees
            .filter(({ id, disposition: guaranteeDisposition }) => guaranteeDisposition === 'unsupported' && (requiredGuarantees.length === 0 || requiredGuarantees.includes(id)))
            .map(({ id }) => id)
        : ['provider-guarantees-unresolved'],
      externalResponsibilities: explicitlyUnavailable
        ? [targetUnavailableReason(providerNode)]
        : manifest?.guarantees.filter(({ disposition: guaranteeDisposition }) => guaranteeDisposition === 'external').map(({ statement }) => statement) ?? [],
      fact: explicitlyUnavailable
        ? 'external' as const
        : providerNode && manifest ? 'resolved' as const : 'unknown' as const,
      provenance,
    };
  });

  for (const actor of request.graph.nodes.filter((node) => node.kind === 'actor')) {
    const providerNode = request.graph.nodes.find((node) => node.kind === 'provider' && node.id === actor.runtime.nodeId);
    if (providerNode?.kind !== 'provider') continue;
    const identity = applicationProviderIdentity({
      application: request.graph.metadata.name,
      capabilityInterface: providerNode.interface,
      nodeId: providerNode.id,
      parentId: application.id,
    });
    const manifest = providerGuaranteeFor(guarantees, identity.id);
    for (const [capability, required] of Object.entries(actor.definition.requirements)) {
      if (!required) continue;
      const guarantee = manifest?.guarantees.find(({ id }) => id === `actor-${capability}`);
      if (guarantee && guarantee.disposition !== 'unsupported') continue;
      diagnostics.push({
        severity: 'error',
        code: 'PLAN_ACTOR_CAPABILITY_UNSUPPORTED',
        message: `Actor ${actor.definition.id} requires ${capability}, but provider ${manifest?.capability.implementation ?? providerNode.implementation} does not guarantee it for ${request.target}.`,
        subjectId: actor.id,
        provenance: [nodeProvenance(actor, request.workspaceRoot), nodeProvenance(providerNode, request.workspaceRoot)],
      });
    }
  }

  const physicalIdentity = new Map<string, ApplicationCanonicalIdentity>();
  const physicalNodes = request.deployment.nodes.map((node) => {
    const identity = applicationCanonicalIdentity({
      application: request.graph.metadata.name,
      kind: 'graph-node',
      semanticKey: `physical:${stableKey([request.target, node.id, node.lifecycle.ownership])}`,
      parentId: target.id,
    });
    physicalIdentity.set(node.id, identity);
    const implementations = implementationAttributionsForDeploymentNode(
      node,
      request.graph,
      implementationPlan,
      diagnostics,
      request.workspaceRoot,
    );
    return {
      id: identity.id,
      deploymentNodeId: node.id,
      kind: node.kind,
      provider: node.provider,
      ...(implementations.length > 0 ? { implementations } : {}),
      scope: node.scope,
      lifecycle: { ownership: node.lifecycle.ownership, intent: lifecycleIntent(node.lifecycle) },
      outputs: node.outputs.map(({ name, sensitivity, persistence }) => ({ name, sensitivity, persistence })),
      fact: node.lifecycle.ownership === 'external' ? 'external' as const : 'planned' as const,
      provenance: [deploymentProvenance(node, request.graph, request.workspaceRoot)],
    };
  });
  const physicalEdges = request.deployment.edges.map((edge) => ({
    id: recordId('physical-edge', [edge.from, edge.relationship, edge.to, edge.output ?? '']),
    from: requiredIdentity(physicalIdentity, edge.from).id,
    to: requiredIdentity(physicalIdentity, edge.to).id,
    relationship: edge.relationship,
    ...(edge.output ? { output: edge.output } : {}),
    fact: 'planned' as const,
  }));

  return {
    schemaVersion: 'applik8s.applicationPlan/v1alpha1',
    sourceGraphVersion: request.graph.apiVersion,
    application,
    target: {
      apiVersion: 'applik8s.target/v1alpha1',
      identity: target,
      target: request.target,
      profile: request.deployment.metadata.identity.profile,
      lifecycleAuthority: request.lifecycleAuthority,
      attributes: targetAttributes(request.deployment, request.target),
    },
    generatedAt: request.generatedAt,
    sourceDigest: request.deployment.metadata.sourceGraphDigest,
    identities: uniqueIdentities([
      application,
      target,
      ...semanticIdentity.values(),
      ...physicalIdentity.values(),
      ...foundation.identities,
      ...resolvedProviderIdentities,
      ...(implementationPlan?.implementations.map(({ identity }) => identity.canonical) ?? []),
    ]),
    semantic: {
      nodes: semanticNodes,
      edges: semanticEdges,
      executions,
      authority,
      dataFlows,
      state,
      exposures,
      observability,
      runtimeAccess: foundation.runtimeAccess,
    },
    resolution: {
      capabilities: resolutions,
      ...(implementationPlan ? { implementationPlan } : {}),
    },
    physical: {
      nodes: physicalNodes,
      edges: physicalEdges,
      nativePlans: request.nativePlans ?? deploymentNativePlans(request, target, physicalNodes.map(({ deploymentNodeId }) => deploymentNodeId), graphProvenance),
    },
    diagnostics,
    estimates,
    evidence: [],
  };
}

function implementationAttributionsForDeploymentNode(
  node: ApplicationDeploymentNode,
  graph: ApplicationGraph,
  implementationPlan: ApplicationImplementationPlan | undefined,
  diagnostics: ApplicationPlanDiagnostic[],
  workspaceRoot?: string,
): NonNullable<ApplicationPhysicalPlanNode['implementations']> {
  if (!implementationPlan) return [];
  const providerIds = deploymentNodeProviderIds(node, graph);
  const attributions: NonNullable<ApplicationPhysicalPlanNode['implementations']>[number][] = [];
  for (const providerId of providerIds) {
    const semantic = graph.nodes.find(({ id }) => id === providerId);
    if (semantic?.kind !== 'provider') continue;
    const qualification = semanticProviderQualification(semantic);
    const candidates = implementationPlan.bindings.filter(({ capability }) =>
      implementationCapabilityInterface(capability.interface) === semantic.interface
      && capability.qualifier === qualification);
    if (candidates.length === 0) continue;
    if (candidates.length > 1) {
      diagnostics.push({
        severity: 'error',
        code: 'PLAN_PHYSICAL_IMPLEMENTATION_AMBIGUOUS',
        message: `Physical node ${node.id} maps provider ${semantic.id} to multiple ${semantic.interface} implementation bindings.`,
        subjectId: node.id,
        provenance: [deploymentProvenance(node, graph, workspaceRoot)],
      });
      continue;
    }
    const identity = candidates[0]?.implementation;
    const implementation = implementationPlan.implementations.find(({ id }) => id === identity);
    if (!implementation) {
      diagnostics.push({
        severity: 'error',
        code: 'PLAN_PHYSICAL_IMPLEMENTATION_UNKNOWN',
        message: `Physical node ${node.id} maps provider ${semantic.id} to missing implementation ${identity ?? '<unknown>'}.`,
        subjectId: node.id,
        provenance: [deploymentProvenance(node, graph, workspaceRoot)],
      });
      continue;
    }
    const execution = deploymentNodeProviderExecution(node, semantic.id)
      ?? applicationProviderExecution(
        semantic.interface,
        requiredImplementationKind(implementation.configuration),
      );
    // Runtime-only providers participate in semantic resolution and runtime
    // binding, but they do not own a physical resource. Attributing the root
    // composition to them would invent a lifecycle contributor that does not
    // exist and would make the portable plan claim shared ownership.
    if (execution === 'runtime-only') continue;
    if (
      node.lifecycle.ownership !== 'external'
      && !implementation.deploymentContributor
    ) {
      diagnostics.push({
        severity: 'error',
        code: 'PLAN_PHYSICAL_CONTRIBUTOR_UNDECLARED',
        message: `Managed physical node ${node.id} is attributed to ${implementation.id}, which declares no deployment contributor.`,
        subjectId: node.id,
        provenance: [deploymentProvenance(node, graph, workspaceRoot)],
      });
    }
    attributions.push({
      identity: implementation.id,
      ...(implementation.deploymentContributor
        ? { contributor: implementation.deploymentContributor }
        : {}),
      mapping: 'semantic-provider',
    });
  }
  return [...new Map(attributions.map((attribution) => [attribution.identity, attribution])).values()]
    .sort((left, right) => left.identity.localeCompare(right.identity));
}

function deploymentNodeProviderExecution(
  node: ApplicationDeploymentNode,
  providerId: string,
): ReturnType<typeof applicationProviderExecution> | undefined {
  if (node.kind !== 'kubernetesComposition') return undefined;
  const fragments = node.spec.fragments;
  if (!Array.isArray(fragments)) return undefined;
  for (const fragment of fragments) {
    if (!fragment || typeof fragment !== 'object' || Array.isArray(fragment)) continue;
    if (Reflect.get(fragment, 'sourceNodeId') !== providerId) continue;
    const execution = Reflect.get(fragment, 'execution');
    if (
      execution === 'root-composition'
      || execution === 'direct-provider'
      || execution === 'runtime-only'
      || execution === 'external-controller'
    ) {
      return execution;
    }
  }
  return undefined;
}

function semanticProviderQualification(provider: Extract<ApplicationGraphNode, { readonly kind: 'provider' }>): string | undefined {
  const config = provider.config;
  if (!config || typeof config !== 'object' || Array.isArray(config)) return undefined;
  const qualification = Reflect.get(config, 'qualification');
  if (!qualification || typeof qualification !== 'object' || Array.isArray(qualification)) return undefined;
  const name = Reflect.get(qualification, 'name');
  return typeof name === 'string' && name.trim() ? name : undefined;
}

function requiresProfileImplementationBinding(
  provider: Extract<ApplicationGraphNode, { readonly kind: 'provider' }>,
): boolean {
  return provider.implementation === 'application-provider-selection'
    || provider.implementation === 'application-target-provider-selection'
    || provider.implementation === 'target-selected'
    || provider.implementation === 'unresolved-profile-implementation';
}

function requiredImplementationKind(configuration: ApplicationImplementationPlan['implementations'][number]['configuration']): string {
  if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)) return '';
  const kind = Reflect.get(configuration, 'kind');
  return typeof kind === 'string' ? kind : '';
}

function deploymentNodeProviderIds(
  node: ApplicationDeploymentNode,
  graph: ApplicationGraph,
): readonly string[] {
  const candidates = new Set<string>();
  if (node.source.semanticNodeId) candidates.add(node.source.semanticNodeId);
  if (node.kind === 'kubernetesComposition') {
    for (const fragmentId of node.spec.fragmentIds) {
      if (fragmentId.startsWith('provider:')) candidates.add(fragmentId.slice('provider:'.length));
    }
  }
  return [...candidates]
    .filter((candidate) => graph.nodes.some(({ id, kind }) => id === candidate && kind === 'provider'))
    .sort((left, right) => left.localeCompare(right));
}

function implementationCapabilityInterface(value: string): string {
  const separator = value.lastIndexOf('@');
  if (separator <= 0 || !/^v[1-9][0-9]*(?:(?:alpha|beta)[1-9][0-9]*)?$/u.test(value.slice(separator + 1))) {
    return value;
  }
  return value.slice(0, separator);
}

function semanticExecutions(
  graph: ApplicationGraph,
  semanticIdentity: ReadonlyMap<string, ApplicationCanonicalIdentity>,
  identities: readonly ApplicationCanonicalIdentity[],
  workspaceRoot?: string,
) {
  return graph.nodes.flatMap((node) => {
    const owner = requiredIdentity(semanticIdentity, node.id);
    const execution = identities.find((identity) => identity.kind === 'execution-boundary' && identity.parentId === owner.id);
    if (!execution) return [];
    return [{
      id: recordId('execution', [execution.id]),
      identity: execution.id,
      graphNodeId: node.id,
      kind: node.kind,
      scalingBoundary: executionScalingBoundary(node),
      fact: 'derived' as const,
      provenance: [nodeProvenance(node, workspaceRoot)],
    }];
  });
}

function semanticAuthority(
  graph: ApplicationGraph,
  semanticIdentity: ReadonlyMap<string, ApplicationCanonicalIdentity>,
  workspaceRoot?: string,
) {
  return graph.nodes.flatMap((node) => {
    if (node.kind !== 'authorityManifest') return [];
    const provenance = [nodeProvenance(node, workspaceRoot)];
    return node.manifest.grants.map((grant) => ({
      id: recordId('authority', [requiredIdentity(semanticIdentity, node.id).id, grant.id]),
      principal: grant.identity.id,
      operationIds: [...grant.operationIds].sort(),
      ...(grant.permissionId ? { permissionId: grant.permissionId } : {}),
      scope: grant.scope,
      fact: 'declared' as const,
      provenance,
    }));
  });
}

function semanticState(
  graph: ApplicationGraph,
  semanticIdentity: ReadonlyMap<string, ApplicationCanonicalIdentity>,
  workspaceRoot?: string,
) {
  return graph.nodes.flatMap((node) => {
    const contract = stateContract(node);
    if (!contract) return [];
    const subject = requiredIdentity(semanticIdentity, node.id).id;
    return [{
      id: recordId('state', [subject]),
      subject,
      ...contract,
      fact: contract.authority === 'unknown' ? 'unknown' as const : 'derived' as const,
      provenance: [nodeProvenance(node, workspaceRoot)],
    }];
  });
}

function semanticExposures(
  graph: ApplicationGraph,
  semanticIdentity: ReadonlyMap<string, ApplicationCanonicalIdentity>,
  workspaceRoot?: string,
) {
  return graph.nodes.flatMap((node) => {
    const kind = node.kind === 'server' ? 'http' as const
      : node.kind === 'gateway' ? 'gateway' as const
        : node.kind === 'subscription' ? 'subscription' as const
          : node.kind === 'exposure' ? 'external' as const
            : undefined;
    if (!kind) return [];
    const subject = requiredIdentity(semanticIdentity, node.id).id;
    const publicExposure = node.kind === 'server' ? Boolean(node.exposure)
      : node.kind === 'exposure' ? true
        : node.kind === 'gateway' || node.kind === 'subscription' ? 'unknown' as const
          : false;
    return [{
      id: recordId('exposure', [subject, kind]),
      subject,
      kind,
      public: publicExposure,
      trustBoundary: node.kind === 'gateway' ? node.authentication
        : node.kind === 'subscription' ? node.authorization
          : node.kind === 'server' ? 'application-host'
            : 'provider-managed',
      fact: publicExposure === 'unknown' ? 'unknown' as const : 'derived' as const,
      provenance: [nodeProvenance(node, workspaceRoot)],
    }];
  });
}

function semanticObservability(
  graph: ApplicationGraph,
  semanticIdentity: ReadonlyMap<string, ApplicationCanonicalIdentity>,
  workspaceRoot?: string,
) {
  const provider = graph.nodes.find((node): node is Extract<ApplicationGraphNode, { kind: 'provider' }> =>
    node.kind === 'provider' && node.interface === 'Observability');
  const providerConfig = provider?.config && typeof provider.config === 'object'
    ? Reflect.get(provider.config, 'observability')
    : undefined;
  const policy = providerConfig && typeof providerConfig === 'object'
    ? Reflect.get(providerConfig, 'policy')
    : undefined;
  const retention = providerConfig && typeof providerConfig === 'object'
    ? Reflect.get(providerConfig, 'retention')
    : undefined;
  const logs = policy && typeof policy === 'object' ? Reflect.get(policy, 'logs') : undefined;
  const traces = policy && typeof policy === 'object' ? Reflect.get(policy, 'traces') : undefined;
  const redaction = policy && typeof policy === 'object' ? Reflect.get(policy, 'redaction') : undefined;
  const implementation = provider?.implementation;
  const endpoint = providerConfig && typeof providerConfig === 'object'
    ? Reflect.get(providerConfig, 'endpoint')
    : undefined;
  const authentication = providerConfig && typeof providerConfig === 'object'
    ? Reflect.get(providerConfig, 'authentication')
    : undefined;
  const tls = providerConfig && typeof providerConfig === 'object'
    ? Reflect.get(providerConfig, 'tls')
    : undefined;
  const retentionSummary = retention && typeof retention === 'object'
    ? `logs=${String(Reflect.get(retention, 'logs') ?? 'unknown')},traces=${String(Reflect.get(retention, 'traces') ?? 'unknown')},metrics=${String(Reflect.get(retention, 'metrics') ?? 'unknown')}`
    : 'provider-resolved';
  return graph.nodes.flatMap((node) => {
    const explicitlyObservable = 'observability' in node && Boolean(node.observability);
    const managedExecution = foundationExecutionNode(node);
    if (!provider && !explicitlyObservable) return [];
    if (!managedExecution && !explicitlyObservable) return [];
    const subject = requiredIdentity(semanticIdentity, node.id).id;
    return [{
      id: recordId('observability', [subject]),
      subject,
      signals: managedExecution
        ? ['traces', 'logs', 'metrics', 'events'] as const
        : ['logs', 'metrics', 'events'] as const,
      collector: provider?.implementation ?? 'provider-resolved',
      export: provider?.implementation ?? 'provider-resolved',
      retention: retentionSummary,
      cardinality: 'bounded' as const,
      topology: observabilityTopology(
        implementation,
        typeof endpoint === 'string' ? endpoint : undefined,
        authentication,
        tls,
      ),
      ...(logs && typeof logs === 'object' && traces && typeof traces === 'object' ? {
        sampling: {
          traceHead: Number(Reflect.get(traces, 'headSample') ?? 0),
          debugLogs: Number(Reflect.get(logs, 'debugSample') ?? 0),
          alwaysSampleErrors: Reflect.get(traces, 'alwaysSampleErrors') === true,
        },
      } : {}),
      ...(redaction && typeof redaction === 'object' && Array.isArray(Reflect.get(redaction, 'deniedFields')) ? {
        redaction: { deniedFields: Reflect.get(redaction, 'deniedFields') as string[] },
      } : {}),
      fact: 'derived' as const,
      provenance: [nodeProvenance(node, workspaceRoot)],
    }];
  });
}

function observabilityTopology(
  implementation: string | undefined,
  endpoint: string | undefined,
  authentication: unknown,
  tls: unknown,
): ApplicationPlanObservability['topology'] {
  if (implementation === 'local-otel') {
    return {
      collector: 'local-collector', protocol: 'otlp/http-protobuf', endpoint: 'supervisor-assigned',
      lifecycle: 'ephemeral', authentication: 'none', tls: 'plaintext-loopback',
    };
  }
  if (implementation === 'clickstack') {
    return {
      collector: 'clickstack-gateway', protocol: 'otlp/http-protobuf', endpoint: 'provider-managed',
      lifecycle: 'retained', authentication: 'provider-resolved', tls: 'provider-resolved',
    };
  }
  if (implementation === 'cloudwatch') {
    return {
      collector: 'cloudwatch-collector', protocol: 'otlp/http-protobuf', endpoint: 'provider-managed',
      lifecycle: 'provider-managed', authentication: 'workload-identity', tls: 'workload-identity',
    };
  }
  if (implementation === 'otlp') {
    const tlsObject = tls && typeof tls === 'object' ? tls : undefined;
    return {
      collector: 'external-collector', protocol: 'otlp/http-protobuf', endpoint: endpoint ?? 'provider-managed',
      lifecycle: 'external', authentication: authentication ? 'secret-header' : 'none',
      tls: tlsObject && Reflect.get(tlsObject, 'trust') === 'custom-ca' ? 'custom-ca' : 'system-trust',
    };
  }
  return {
    collector: 'provider-resolved', protocol: 'provider-resolved', endpoint: 'provider-managed',
    lifecycle: 'provider-managed', authentication: 'provider-resolved', tls: 'provider-resolved',
  };
}

function executionScalingBoundary(node: ApplicationGraphNode): 'singleton' | 'replicated' | 'provider-managed' | 'unknown' {
  if (node.kind === 'server') return (node.deployment?.replicas ?? 1) > 1 ? 'replicated' : 'singleton';
  if (
    node.kind === 'workflowWorker'
    || node.kind === 'workflowHandler'
    || node.kind === 'aiAgent'
    || node.kind === 'schedule'
    || node.kind === 'lakehousePublication'
    || node.kind === 'actor'
    || node.kind === 'codeAgent'
  ) return 'provider-managed';
  if (node.kind === 'operator' || node.kind === 'workloadJob') return 'singleton';
  return 'unknown';
}

function stateContract(node: ApplicationGraphNode): { readonly authority: string; readonly consistency: string; readonly retention?: string; readonly recovery?: string } | undefined {
  if (node.kind === 'model') return { authority: node.database.interface, consistency: node.common?.changes.authority ?? 'provider-defined', retention: node.runtime?.retention.mode ?? 'provider-defined', recovery: 'provider-backup-and-replay' };
  if (node.kind === 'crd') return { authority: 'kubernetes-api', consistency: 'resource-version', recovery: 'control-plane-reconciliation' };
  if (node.kind === 'stream') return { authority: node.authority, consistency: node.delivery, retention: `${node.retention.maxAgeSeconds}s`, recovery: node.replay };
  if (node.kind === 'objectStore') return { authority: node.provider.interface, consistency: 'provider-defined', recovery: 'object-version-or-republish' };
  if (node.kind === 'index' || node.kind === 'projection') return { authority: 'derived-projection', consistency: 'eventual', recovery: 'rebuild' };
  if (node.kind === 'workflow' || node.kind === 'task') return { authority: 'workflow-engine', consistency: 'durable-history', recovery: 'history-replay' };
  if (node.kind === 'schedule') return { authority: node.scheduler.interface, consistency: 'idempotent-occurrence-receipt', retention: 'provider-defined', recovery: 'prior-receipt-and-misfire-policy' };
  if (node.kind === 'job') return node.queryBatch
    ? {
        authority: `${node.queryBatch.lowering.provider}:${node.queryBatch.lowering.checkpointAuthority}`,
        consistency: node.queryBatch.consistency.mode,
        retention: `${node.queryBatch.lowering.maximumSnapshotAgeSeconds}s`,
        recovery: 'durable-window-receipts-contiguous-frontier',
      }
    : { authority: node.runtime.interface, consistency: 'single-terminal-transition', retention: 'profile-defined', recovery: 'provider-attempt-retry' };
  if (node.kind === 'lakehousePublication') return { authority: node.dataset.interface, consistency: node.semantics.publication, retention: 'immutable-snapshots', recovery: 'frontier-replay-and-manifest-republish' };
  if (node.kind === 'actor') return { authority: node.runtime.interface, consistency: node.semantics.serialization, retention: 'provider-defined', recovery: 'admission-receipt-state-and-outbox' };
  if (node.kind === 'codeAgent') return {
    authority: node.harness.interface,
    consistency: 'repository-scoped-serialized-runs',
    retention: node.definition.workspace.disposition,
    recovery: 'provider-session-receipt-and-fenced-workspace',
  };
  if (node.kind === 'aggregate' || node.kind === 'counter') return { authority: 'provider-defined', consistency: 'atomic', recovery: 'source-rebuild' };
  return undefined;
}

function semanticEstimates(
  graph: ApplicationGraph,
  deployment: ApplicationDeploymentGraph,
  semanticIdentity: ReadonlyMap<string, ApplicationCanonicalIdentity>,
  workspaceRoot?: string,
): readonly ApplicationPlanEstimate[] {
  const estimates: ApplicationPlanEstimate[] = [];
  for (const node of graph.nodes) {
    const subjectId = requiredIdentity(semanticIdentity, node.id).id;
    const provenance = [nodeProvenance(node, workspaceRoot)];
    if (node.kind === 'server') {
      const replicas = node.deployment?.replicas;
      estimates.push({
        id: recordId('estimate', [subjectId, 'replicas']),
        subjectId,
        name: 'replicas',
        ...(typeof replicas === 'number' ? { value: replicas } : {}),
        unit: 'replicas',
        costClass: typeof replicas === 'number' && replicas > 2 ? 'medium' as const : 'low' as const,
        assumptions: ['desired replica count; provider autoscaling and placement may change observed capacity'],
        fact: typeof replicas === 'number' ? 'estimated' as const : 'unknown' as const,
        provenance,
      });
      continue;
    }
    if (node.kind === 'schedule') estimates.push({
        id: recordId('estimate', [subjectId, 'schedule-cardinality']),
        subjectId,
        name: 'schedule-cardinality',
        value: node.definition.requirements.cardinality,
        unit: 'definitions',
        costClass: node.definition.requirements.cardinality === 'high' ? 'medium' : 'low',
        assumptions: [`configuration=${node.definition.configuration}`, `precision=${node.definition.requirements.precision}`, `maximumLatenessSeconds=${node.definition.maximumLatenessSeconds}`, `maximumCatchUp=${node.definition.maximumCatchUp ?? 0}`],
        fact: 'estimated',
      provenance,
    });
    if (node.kind === 'job' && node.queryBatch) {
      estimates.push({
        id: recordId('estimate', [subjectId, 'query-batch-window']),
        subjectId,
        name: 'query-batch-window',
        value: node.queryBatch.batch.maxItems,
        unit: 'items',
        costClass: node.queryBatch.batch.maxItems > 1_000 ? 'medium' : 'low',
        assumptions: [
          `concurrency=${node.queryBatch.batch.concurrency}`,
          `strategy=${node.queryBatch.lowering.strategy}`,
          `checkpointAuthority=${node.queryBatch.lowering.checkpointAuthority}`,
          `maximumSnapshotItems=${node.queryBatch.lowering.maximumSnapshotItems}`,
          `maximumSnapshotAgeSeconds=${node.queryBatch.lowering.maximumSnapshotAgeSeconds}`,
        ],
        fact: 'estimated',
        provenance,
      });
    }
    if (node.kind === 'lakehousePublication') estimates.push({
        id: recordId('estimate', [subjectId, 'snapshot-storage']),
        subjectId,
        name: 'snapshot-storage',
        unit: 'bytes',
        costClass: 'unknown',
        assumptions: ['depends on event volume, row encoding, partition cardinality, and provider compaction'],
        fact: 'unknown',
        provenance,
      });
    if (node.kind === 'actor') estimates.push({
        id: recordId('estimate', [subjectId, 'active-actor-identities']),
        subjectId,
        name: 'active-actor-identities',
        unit: 'identities',
        costClass: 'unknown',
        assumptions: ['depends on admitted actor keys, hibernation, state size, and provider placement'],
        fact: 'unknown',
        provenance,
      });
  }
  const physical: ApplicationPlanEstimate[] = deployment.nodes.map((node) => ({
    id: recordId('estimate', [`physical:${node.id}`, 'provider-cost']),
    subjectId: `physical:${node.id}`,
    name: 'provider-cost',
    costClass: node.lifecycle.ownership === 'external' ? 'unknown' as const : 'low' as const,
    assumptions: [`provider=${node.provider.interface}/${node.provider.implementation}`, `ownership=${node.lifecycle.ownership}`, 'provider price and target utilization are not observed during static planning'],
    fact: 'unknown' as const,
    provenance: [deploymentProvenance(node, graph, workspaceRoot)],
  }));
  return [...estimates, ...physical];
}

function foundationExecutionNode(node: ApplicationGraphNode): boolean {
  return [
    'server', 'operator', 'commandHandler', 'processor', 'taskHandler',
    'workflowHandler', 'workflowWorker', 'aiAgent', 'mcpServer', 'mcpClient',
    'query', 'gateway', 'streamProcessor', 'subscription', 'projection', 'job',
    'schedule', 'lakehousePublication', 'actor',
  ].includes(node.kind);
}

function causalRelationship(relationship: string): boolean {
  return ['emits', 'invokes', 'handles', 'processes', 'projects', 'starts', 'signals', 'watches'].includes(relationship);
}

function deploymentNativePlans(
  request: CompileApplicationPlanRequest,
  target: ApplicationCanonicalIdentity,
  resourceIds: readonly string[],
  provenance: ApplicationSourceProvenance,
): readonly ApplicationNativePlanRecord[] {
  const digest = digestApplicationDeploymentGraph(request.deployment);
  const actions = unique(request.deployment.nodes.map(({ lifecycle }) => lifecycleIntent(lifecycle)));
  const records: ApplicationNativePlanRecord[] = [{
    apiVersion: 'applik8s.nativePlan/v1alpha1',
    id: `native-plan:alchemy:${target.id}`,
    authority: 'alchemy',
    adapterVersion: 'v1alpha1',
    target: target.id,
    contentDigest: digest,
    resourceIds,
    actions,
    provenance: [provenance],
    summary: {
      nodeCount: request.deployment.nodes.length,
      edgeCount: request.deployment.edges.length,
      strategy: request.deployment.metadata.strategy,
    },
  }];
  const typeKroNodes = request.deployment.nodes.filter(({ kind }) => kind === 'kubernetesComposition' || kind === 'kubernetesDirect');
  if (typeKroNodes.length > 0) records.push({
    apiVersion: 'applik8s.nativePlan/v1alpha1',
    id: `native-plan:typekro:${target.id}`,
    authority: 'typekro',
    adapterVersion: 'v1alpha1',
    target: target.id,
    contentDigest: digest,
    resourceIds: typeKroNodes.map(({ id }) => id),
    actions: unique(typeKroNodes.map(({ lifecycle }) => lifecycleIntent(lifecycle))),
    provenance: [provenance],
    summary: { nodeCount: typeKroNodes.length, strategy: request.deployment.metadata.strategy },
  });
  return records;
}

function nodeProvenance(node: ApplicationGraphNode, workspaceRoot?: string): ApplicationSourceProvenance {
  if (!node.sourceLocation) return sourceProvenance({ origin: 'framework-generated', generatedBy: `application-graph:${node.kind}`, symbol: node.id });
  const file = workspaceFile(node.sourceLocation.file, workspaceRoot);
  return sourceProvenance({ origin: 'authored', module: file, symbol: node.name, location: { ...node.sourceLocation, file } });
}

function deploymentProvenance(node: ApplicationDeploymentNode, graph: ApplicationGraph, workspaceRoot?: string): ApplicationSourceProvenance {
  if (node.source.semanticNodeId) {
    const semantic = graph.nodes.find(({ id }) => id === node.source.semanticNodeId);
    if (semantic) return nodeProvenance(semantic, workspaceRoot);
  }
  if (node.source.file) {
    const file = workspaceFile(node.source.file, workspaceRoot);
    return sourceProvenance({
      origin: 'provider-plan',
      module: file,
      location: { file, line: node.source.line ?? 1, column: node.source.column ?? 1 },
      symbol: node.id,
      generatedBy: `${node.provider.interface}/${node.provider.implementation}`,
    });
  }
  return sourceProvenance({ origin: 'provider-plan', generatedBy: `${node.provider.interface}/${node.provider.implementation}`, symbol: node.id });
}

function workspaceFile(file: string, workspaceRoot?: string): string {
  const normalized = file.replaceAll('\\', '/');
  const root = workspaceRoot?.replaceAll('\\', '/').replace(/\/$/, '');
  if (root && normalized.startsWith(`${root}/`)) return normalized.slice(root.length + 1);
  if (normalized.startsWith('/')) throw new Error(`Application plan source ${file} is outside the declared workspace root.`);
  return normalized.replace(/^\.\//, '');
}

function requiredIdentity(identities: ReadonlyMap<string, ApplicationCanonicalIdentity>, id: string): ApplicationCanonicalIdentity {
  const identity = identities.get(id);
  if (!identity) throw new Error(`Application plan references missing canonical identity ${id}.`);
  return identity;
}

function requiredNode(graph: ApplicationGraph, id: string): ApplicationGraphNode {
  const node = graph.nodes.find((candidate) => candidate.id === id);
  if (!node) throw new Error(`Application plan provider requirement references missing graph node ${id}.`);
  return node;
}

function targetUnavailableReason(
  provider: Extract<ApplicationGraphNode, { kind: 'provider' }> | undefined,
): string {
  const config = provider?.config;
  if (config && typeof config === 'object' && !Array.isArray(config)) {
    const reason = Reflect.get(config, 'reason');
    if (typeof reason === 'string' && reason.trim()) return reason;
  }
  return provider
    ? `${provider.interface} requires an externally qualified implementation for this target.`
    : 'This execution requires an externally qualified implementation for this target.';
}

function lifecycleIntent(lifecycle: ApplicationDeploymentLifecycle): ApplicationNativePlanRecord['actions'][number] {
  if (lifecycle.ownership === 'external') return 'external';
  if (lifecycle.deletion === 'retain') return 'retain';
  if (lifecycle.adoption === 'createOnly') return 'create';
  if (lifecycle.adoption === 'createOrAdoptExact') return 'adopt';
  return 'unknown';
}

function targetAttributes(deployment: ApplicationDeploymentGraph, target: CompileApplicationPlanRequest['target']): Readonly<Record<string, string>> {
  const connection = deployment.metadata.identity.connection;
  return {
    connectionProvider: connection.provider,
    connectionDigest: connection.digest,
    cluster: connection.cluster,
    ...(target === 'kubernetes' ? { strategy: deployment.metadata.strategy } : {}),
  };
}

function unique<T extends string>(values: readonly T[]): readonly T[] {
  return [...new Set(values)].sort();
}

function uniqueIdentities(values: readonly ApplicationCanonicalIdentity[]): readonly ApplicationCanonicalIdentity[] {
  const identities = new Map<string, ApplicationCanonicalIdentity>();
  for (const identity of values) {
    const previous = identities.get(identity.id);
    if (previous && (previous.kind !== identity.kind || previous.semanticKey !== identity.semanticKey || previous.application !== identity.application)) {
      throw new Error(`Application plan canonical identity ${identity.id} has incompatible definitions.`);
    }
    identities.set(identity.id, identity);
  }
  return [...identities.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function recordId(prefix: string, parts: readonly string[]): string {
  return `${prefix}:${stableKey(parts)}`;
}

function stableKey(parts: readonly string[]): string {
  return parts.map((part) => `${part.length}:${part}`).join('|');
}
