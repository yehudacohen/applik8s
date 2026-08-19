// typecast-file-boundary: The compiler restores closed plan discriminants only while lowering already validated semantic and deployment graph records.
import {
  type ApplicationCanonicalIdentity,
  type ApplicationGraph,
  type ApplicationGraphNode,
  type ApplicationNativePlanRecord,
  type ApplicationPlan,
  type ApplicationPlanDiagnostic,
  type ApplicationProviderGuaranteeManifest,
  type ApplicationSourceProvenance,
  applicationCanonicalIdentity,
  applicationGraphNodeIdentity,
  applicationProviderIdentity,
  applicationTargetIdentity,
  providerGuaranteeFor,
  sourceProvenance,
} from '@applik8s/core';
import {
  type ApplicationDeploymentGraph,
  type ApplicationDeploymentLifecycle,
  type ApplicationDeploymentNode,
  digestApplicationDeploymentGraph,
} from '@applik8s/deployment-contract';

export interface CompileApplicationPlanRequest {
  readonly graph: ApplicationGraph;
  readonly deployment: ApplicationDeploymentGraph;
  readonly target: 'local' | 'aws-local' | 'aws' | 'kubernetes';
  readonly lifecycleAuthority: 'local-supervisor' | 'alchemy' | 'external';
  readonly generatedAt: string;
  readonly providerGuarantees?: readonly ApplicationProviderGuaranteeManifest[];
  readonly nativePlans?: readonly ApplicationNativePlanRecord[];
  /** Used only to make absolute compiler source locations workspace-relative. */
  readonly workspaceRoot?: string;
}

/**
 * Derives one stable explanation artifact from the canonical semantic and
 * deployment graphs. It performs no provider or lifecycle effect.
 */
export function compileApplicationPlan(request: CompileApplicationPlanRequest): ApplicationPlan {
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

  const guarantees = request.providerGuarantees ?? [];
  const diagnostics: ApplicationPlanDiagnostic[] = [];
  const resolvedProviderIdentities: ApplicationCanonicalIdentity[] = [];
  const resolutions = request.graph.providerRequirements.map((requirement) => {
    const binding = request.graph.providerBindings.find(({ requirement: id }) => id === requirement.id);
    const providerNode = binding
      ? request.graph.nodes.find((node): node is Extract<ApplicationGraphNode, { kind: 'provider' }> => node.kind === 'provider' && node.id === binding.provider.nodeId)
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
    const provenance = [
      providerNode ? nodeProvenance(providerNode, request.workspaceRoot) : nodeProvenance(requiredNode(request.graph, requirement.consumer.nodeId), request.workspaceRoot),
    ];
    const disposition = !providerNode
      ? 'unresolved' as const
      : !manifest
        ? 'unresolved' as const
        : manifest.targets.includes(request.target)
          ? 'supported' as const
          : 'incompatible' as const;
    if (disposition !== 'supported') {
      diagnostics.push({
        severity: 'error',
        code: disposition === 'unresolved' ? 'PLAN_PROVIDER_GUARANTEES_UNRESOLVED' : 'PLAN_PROVIDER_TARGET_INCOMPATIBLE',
        message: !providerNode
          ? requirement.diagnostics.missing
          : !manifest
            ? `Provider ${providerNode.id} has no v0.8 guarantee manifest.`
            : `Provider ${providerNode.id} is not qualified for target ${request.target}.`,
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
      ...(providerNode ? { implementation: providerNode.implementation, version: providerNode.contract?.version ?? 'unknown' } : {}),
      maturity: manifest?.maturity ?? 'experimental',
      disposition,
      guarantees: manifest?.guarantees.filter(({ disposition: guaranteeDisposition }) => guaranteeDisposition === 'guaranteed' || guaranteeDisposition === 'bounded').map(({ id }) => id) ?? [],
      gaps: manifest?.guarantees.filter(({ disposition: guaranteeDisposition }) => guaranteeDisposition === 'unsupported').map(({ id }) => id) ?? ['provider-guarantees-unresolved'],
      externalResponsibilities: manifest?.guarantees.filter(({ disposition: guaranteeDisposition }) => guaranteeDisposition === 'external').map(({ statement }) => statement) ?? [],
      fact: providerNode && manifest ? 'resolved' as const : 'unknown' as const,
      provenance,
    };
  });

  const physicalIdentity = new Map<string, ApplicationCanonicalIdentity>();
  const physicalNodes = request.deployment.nodes.map((node) => {
    const identity = applicationCanonicalIdentity({
      application: request.graph.metadata.name,
      kind: 'graph-node',
      semanticKey: `physical:${stableKey([request.target, node.id, node.lifecycle.ownership])}`,
      parentId: target.id,
    });
    physicalIdentity.set(node.id, identity);
    return {
      id: identity.id,
      deploymentNodeId: node.id,
      kind: node.kind,
      provider: node.provider,
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
      ...(request.graph.foundation?.identities ?? []),
      ...resolvedProviderIdentities,
    ]),
    semantic: {
      nodes: semanticNodes,
      edges: semanticEdges,
      runtimeAccess: request.graph.foundation?.runtimeAccess ?? [],
    },
    resolution: { capabilities: resolutions },
    physical: {
      nodes: physicalNodes,
      edges: physicalEdges,
      nativePlans: request.nativePlans ?? deploymentNativePlans(request, target, physicalNodes.map(({ deploymentNodeId }) => deploymentNodeId), graphProvenance),
    },
    diagnostics,
    estimates: [],
    evidence: [],
  };
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
    ...(target === 'kubernetes' ? { cluster: connection.cluster, strategy: deployment.metadata.strategy } : {}),
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
