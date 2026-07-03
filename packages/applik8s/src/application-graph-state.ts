import { normalizeApplicationGraph } from '@applik8s/core';
import type { ApplicationGraph, ApplicationGraphEdge, ApplicationGraphNode } from '@applik8s/core';

export interface ApplicationGraphState {
  readonly graphNodes: ApplicationGraphNode[];
  readonly graphEdges: ApplicationGraphEdge[];
}

export function applicationGraphFromState(name: string, state: ApplicationGraphState): ApplicationGraph {
  return normalizeApplicationGraph({
    apiVersion: 'applik8s.appGraph/v1alpha1',
    kind: 'ApplicationGraph',
    metadata: { name },
    nodes: dedupeApplicationGraphNodes(state.graphNodes),
    edges: dedupeApplicationGraphEdges(state.graphEdges),
    compatibility: {
      stablePublicApis: ['sdk.kubernetesComposition', 'app.server', 'app.crd', 'app.aggregate', 'Resource.index', 'Resource.increment'],
      documentedInternalContracts: ['ApplicationGraph'],
      experimentalSurfaces: ['app.graph', 'app.model', 'app.job', 'provider.ModelStore'],
      postV3Surfaces: ['workload-movement-operator', 'generic-workflow-orchestration', 'broad-provider-ecosystem'],
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
