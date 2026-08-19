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
  const reference = serializedApplicationGraphReference(value);
  if (reference !== undefined) return JSON.stringify(reference);
  if (Array.isArray(value)) return `[${value.map(stableJsonStringify).join(',')}]`;
  const entries = Object.entries(value)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([leftKey], [rightKey]) => compareStrings(leftKey, rightKey));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJsonStringify(entryValue)}`).join(',')}}`;
}

/**
 * Application graphs are durable compiler inputs, so opaque provider objects
 * must cross their JSON boundary as portable expressions rather than `{}`.
 * The symbols form TypeKro's public reference protocol; no TypeKro runtime
 * dependency is required here.
 */
function serializedApplicationGraphReference(value: object): string | undefined {
  if (Reflect.get(value, Symbol.for('TypeKro.KubernetesRef')) === true) {
    const resourceId = Reflect.get(value, 'resourceId');
    const fieldPath = Reflect.get(value, 'fieldPath');
    if (resourceId === '__schema__' && nonEmptyString(fieldPath)) return `\${schema.${fieldPath}}`;
    if (nonEmptyString(resourceId) && nonEmptyString(fieldPath)) return `\${${resourceId}.${fieldPath}}`;
  }
  const expression = Reflect.get(value, 'expression');
  const keys = Object.keys(value);
  if (nonEmptyString(expression) && (
    Reflect.get(value, Symbol.for('TypeKro.CelExpression')) === true
    || keys.every((key) => key === 'expression' || key === '__isTemplate')
  )) {
    return `\${${expression}}`;
  }
  return undefined;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
