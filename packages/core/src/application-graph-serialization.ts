import type {
  ApplicationCompatibilityLabel,
  ApplicationGraph,
  ApplicationGraphEdge,
  ApplicationGraphNode,
  ApplicationProviderBindingContract,
  ApplicationProviderRequirement,
} from './application-graph.js';

/** Deterministic graph normalization is isolated from validation and provider resolution. */
export function normalizeApplicationGraphArtifact(graph: ApplicationGraph): ApplicationGraph {
  return {
    ...graph,
    nodes: [...graph.nodes].sort(compareApplicationGraphNodes),
    edges: [...graph.edges].sort(compareApplicationGraphEdges),
    providerRequirements: [...(graph.providerRequirements ?? [])].sort(compareApplicationProviderRequirements),
    providerBindings: [...(graph.providerBindings ?? [])].sort(compareApplicationProviderBindings),
    compatibility: {
      stablePublicApis: sortedStrings(graph.compatibility.stablePublicApis),
      documentedInternalContracts: sortedStrings(graph.compatibility.documentedInternalContracts),
      experimentalSurfaces: sortedStrings(graph.compatibility.experimentalSurfaces),
      postV3Surfaces: sortedStrings(graph.compatibility.postV3Surfaces),
      labels: [...(graph.compatibility.labels ?? [])].sort(compareApplicationCompatibilityLabels),
    },
  };
}

export function serializeNormalizedApplicationGraph(graph: ApplicationGraph): string {
  return `${stableJsonStringify(normalizeApplicationGraphArtifact(graph))}\n`;
}

function compareApplicationGraphNodes(left: ApplicationGraphNode, right: ApplicationGraphNode): number {
  return compareStrings(left.id, right.id) || compareStrings(left.kind, right.kind) || compareStrings(left.name, right.name);
}

function compareApplicationGraphEdges(left: ApplicationGraphEdge, right: ApplicationGraphEdge): number {
  return compareStrings(left.from.nodeId, right.from.nodeId) || compareStrings(left.relationship, right.relationship) || compareStrings(left.to.nodeId, right.to.nodeId);
}

function compareApplicationProviderRequirements(left: ApplicationProviderRequirement, right: ApplicationProviderRequirement): number {
  return compareStrings(left.id, right.id) || compareStrings(left.interface, right.interface) || compareStrings(left.consumer.nodeId, right.consumer.nodeId);
}

function compareApplicationProviderBindings(left: ApplicationProviderBindingContract, right: ApplicationProviderBindingContract): number {
  return compareStrings(left.requirement, right.requirement) || compareStrings(left.provider.interface, right.provider.interface) || compareStrings(left.provider.nodeId, right.provider.nodeId);
}

function compareApplicationCompatibilityLabels(left: ApplicationCompatibilityLabel, right: ApplicationCompatibilityLabel): number {
  return compareStrings(left.surface, right.surface) || compareStrings(left.name, right.name);
}

function sortedStrings(values: readonly string[]): readonly string[] {
  return [...values].sort(compareStrings);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableJsonStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJsonStringify).join(',')}]`;
  const entries = Object.entries(value)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([leftKey], [rightKey]) => compareStrings(leftKey, rightKey));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJsonStringify(entryValue)}`).join(',')}}`;
}
