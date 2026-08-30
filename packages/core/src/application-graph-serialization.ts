import type {
  ApplicationCompatibilityLabel,
  ApplicationGraph,
  ApplicationGraphEdge,
  ApplicationGraphNode,
  ApplicationProviderBindingContract,
  ApplicationProviderRequirement,
} from './application-graph.js';
import {
  type CanonicalJsonV1Policy,
  canonicalJsonCompatibleV1Policy,
  canonicalJsonV1String,
} from './canonical-json.js';
import { adaptApplicationGraphCanonicalJsonV1 } from './application-graph-canonical-json.js';

export { adaptApplicationGraphCanonicalJsonV1 } from './application-graph-canonical-json.js';

/** Canonical JSON v1 policy for durable application-graph artifacts. */
export const applicationGraphCanonicalJsonV1Policy: CanonicalJsonV1Policy = Object.freeze({
  ...canonicalJsonCompatibleV1Policy,
  name: 'application-graph-artifact',
});

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
    ...(graph.foundation
      ? {
          foundation: {
            identities: [...graph.foundation.identities].sort((left, right) => compareStrings(left.id, right.id)),
            provenance: [...graph.foundation.provenance].sort((left, right) => compareStrings(left.id, right.id)),
            runtimeAccess: [...graph.foundation.runtimeAccess].sort((left, right) => compareStrings(left.id, right.id)),
          },
        }
      : {}),
  };
}

export function serializeNormalizedApplicationGraph(graph: ApplicationGraph): string {
  return `${canonicalJsonV1String(
    adaptApplicationGraphCanonicalJsonV1(normalizeApplicationGraphArtifact(graph)),
    applicationGraphCanonicalJsonV1Policy,
  )}\n`;
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
