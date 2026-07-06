import { normalizeApplicationGraph } from '@applik8s/core';
import type { ApplicationGraph, ApplicationGraphEdge, ApplicationGraphNode, ApplicationProviderBindingContract, ApplicationProviderRequirement } from '@applik8s/core';

export interface ApplicationGraphState {
  readonly graphNodes: ApplicationGraphNode[];
  readonly graphEdges: ApplicationGraphEdge[];
  readonly providerRequirements: ApplicationProviderRequirement[];
  readonly providerBindings: ApplicationProviderBindingContract[];
}

export function applicationGraphFromState(name: string, state: ApplicationGraphState): ApplicationGraph {
  return normalizeApplicationGraph({
    apiVersion: 'applik8s.appGraph/v1alpha1',
    kind: 'ApplicationGraph',
    metadata: { name },
    nodes: dedupeApplicationGraphNodes(state.graphNodes),
    edges: dedupeApplicationGraphEdges(state.graphEdges),
    providerRequirements: dedupeApplicationProviderRequirements(state.providerRequirements),
    providerBindings: dedupeApplicationProviderBindings(state.providerBindings),
    compatibility: {
      stablePublicApis: ['sdk.kubernetesComposition', 'app.server', 'app.crd', 'app.model', 'app.job', 'app.schedule', 'app.defaults', 'app.provide', 'app.aggregate', 'Resource.index', 'Resource.increment', 'provider.ModelStore'],
      documentedInternalContracts: ['ApplicationGraph'],
      experimentalSurfaces: ['app.graph'],
      postV3Surfaces: ['workload-movement-operator', 'generic-workflow-orchestration', 'broad-provider-ecosystem'],
      labels: [
        { name: 'sdk.kubernetesComposition', surface: 'stablePublicApi', since: 'v0.2', rationale: 'Canonical TypeKro-backed app composition entrypoint.' },
        { name: 'ApplicationGraph', surface: 'documentedInternalContract', since: 'v0.3', rationale: 'Substrate-freeze app IR before lowering.' },
        { name: 'app.model', surface: 'stablePublicApi', since: 'v0.3', rationale: 'Schema-first storage-backed model materialization entrypoint.' },
        { name: 'app.job', surface: 'stablePublicApi', since: 'v0.3', rationale: 'Durable generated task entrypoint; implementation remains fail-closed until the runtime lands.' },
        { name: 'app.schedule', surface: 'stablePublicApi', since: 'v0.3', rationale: 'Durable scheduled task entrypoint; implementation remains fail-closed until the runtime lands.' },
        { name: 'app.defaults', surface: 'stablePublicApi', since: 'v0.3', rationale: 'App-scoped provider default binding boundary.' },
        { name: 'app.provide', surface: 'stablePublicApi', since: 'v0.3', rationale: 'Typed app-scoped provider binding boundary.' },
        { name: 'provider.ModelStore', surface: 'stablePublicApi', since: 'v0.3', rationale: 'Typed model storage capability contract.' },
        { name: 'workload-movement-operator', surface: 'postV3Surface', rationale: 'Pressure-test application after v0.3 substrate freeze.' },
      ],
    },
  });
}

export function isApplicationGraph(value: unknown): value is ApplicationGraph {
  return Boolean(value && typeof value === 'object' && Reflect.get(value, 'apiVersion') === 'applik8s.appGraph/v1alpha1' && Reflect.get(value, 'kind') === 'ApplicationGraph');
}

export function addApplicationGraphNode(state: ApplicationGraphState, node: ApplicationGraphNode): void {
  const index = state.graphNodes.findIndex((candidate) => candidate.id === node.id);
  if (index >= 0) {
    state.graphNodes[index] = node;
    return;
  }
  state.graphNodes.push(node);
}

export function addApplicationGraphEdge(state: ApplicationGraphState, edge: ApplicationGraphEdge): void {
  state.graphEdges.push(edge);
}

export function addApplicationProviderRequirement(state: ApplicationGraphState, requirement: ApplicationProviderRequirement): void {
  const index = state.providerRequirements.findIndex((candidate) => candidate.id === requirement.id);
  if (index >= 0) {
    state.providerRequirements[index] = requirement;
    return;
  }
  state.providerRequirements.push(requirement);
}

export function addApplicationProviderBinding(state: ApplicationGraphState, binding: ApplicationProviderBindingContract): void {
  const index = state.providerBindings.findIndex((candidate) => candidate.requirement === binding.requirement && candidate.provider.interface === binding.provider.interface && candidate.provider.nodeId === binding.provider.nodeId);
  if (index >= 0) {
    state.providerBindings[index] = binding;
    return;
  }
  state.providerBindings.push(binding);
}

function dedupeApplicationGraphNodes(nodes: readonly ApplicationGraphNode[]): readonly ApplicationGraphNode[] {
  const byId = new Map<string, ApplicationGraphNode>();
  for (const node of nodes) {
    byId.set(node.id, node);
  }
  return [...byId.values()];
}

function dedupeApplicationGraphEdges(edges: readonly ApplicationGraphEdge[]): readonly ApplicationGraphEdge[] {
  const byKey = new Map<string, ApplicationGraphEdge>();
  for (const edge of edges) {
    byKey.set(JSON.stringify(edge), edge);
  }
  return [...byKey.values()];
}

function dedupeApplicationProviderRequirements(requirements: readonly ApplicationProviderRequirement[]): readonly ApplicationProviderRequirement[] {
  const byId = new Map<string, ApplicationProviderRequirement>();
  for (const requirement of requirements) {
    byId.set(requirement.id, requirement);
  }
  return [...byId.values()];
}

function dedupeApplicationProviderBindings(bindings: readonly ApplicationProviderBindingContract[]): readonly ApplicationProviderBindingContract[] {
  const byKey = new Map<string, ApplicationProviderBindingContract>();
  for (const binding of bindings) {
    byKey.set(`${binding.requirement}:${binding.provider.interface}:${binding.provider.nodeId}`, binding);
  }
  return [...byKey.values()];
}
