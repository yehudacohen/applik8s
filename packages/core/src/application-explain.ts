import type {
  ApplicationGraph,
  ApplicationGraphEdgeRelationship,
  ApplicationGraphNodeKind,
  ApplicationProviderInterfaceKind,
} from './application-graph.js';
import type {
  ApplicationExecutionBinding,
  ApplicationOperationCatalog,
  ApplicationOperationId,
  ApplicationWorkloadAuthorityEnvelope,
} from './application-operation-authority.js';

export interface ApplicationExplainProjection {
  readonly apiVersion: 'applik8s.explain/v1alpha1';
  readonly application: string;
  readonly namespace?: string;
  readonly graph: {
    readonly apiVersion: ApplicationGraph['apiVersion'];
    readonly nodeCount: number;
    readonly edgeCount: number;
  };
  readonly nodes: readonly ApplicationExplainNode[];
  readonly operations: readonly ApplicationExplainOperation[];
  readonly workloads: readonly ApplicationExplainWorkloadAuthority[];
}

export interface ApplicationExplainNode {
  readonly id: string;
  readonly kind: ApplicationGraphNodeKind;
  readonly name: string;
  readonly stability: string;
  readonly incoming: readonly ApplicationExplainEdge[];
  readonly outgoing: readonly ApplicationExplainEdge[];
  readonly providerRequirements: readonly {
    readonly id: string;
    readonly interface: ApplicationProviderInterfaceKind;
    readonly purpose: string;
    readonly provider?: string;
  }[];
}

export interface ApplicationExplainEdge {
  readonly nodeId: string;
  readonly relationship: ApplicationGraphEdgeRelationship;
}

export interface ApplicationExplainOperation {
  readonly id: ApplicationOperationId;
  readonly version: string;
  readonly kind: string;
  readonly placement: string;
  readonly classification: string;
  readonly transports: readonly string[];
}

export interface ApplicationExplainWorkloadAuthority {
  readonly id: string;
  readonly workloadIdentity: string;
  readonly operationId: ApplicationOperationId;
  readonly catalogRevision: string;
  readonly binding?: {
    readonly id: string;
    readonly source: ApplicationExecutionBinding['source'];
    readonly boundKeys: readonly string[];
    readonly inferred: boolean;
  };
}

export interface ExplainApplicationGraphOptions {
  readonly catalog?: ApplicationOperationCatalog;
  readonly workloadAuthority?: readonly ApplicationWorkloadAuthorityEnvelope[];
}

/**
 * Produces the provider-neutral graph explanation consumed by CLI, deployment,
 * and UI renderers. Renderers may add presentation but may not rediscover
 * dependencies or authority from source text.
 */
export function explainApplicationGraph(
  graph: ApplicationGraph,
  options: ExplainApplicationGraphOptions = {},
): ApplicationExplainProjection {
  const nodes = [...graph.nodes]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map<ApplicationExplainNode>((node) => ({
      id: node.id,
      kind: node.kind,
      name: node.name,
      stability: node.stability,
      incoming: graph.edges
        .filter((edge) => edge.to.nodeId === node.id)
        .map((edge) => ({ nodeId: edge.from.nodeId, relationship: edge.relationship }))
        .sort(compareExplainEdges),
      outgoing: graph.edges
        .filter((edge) => edge.from.nodeId === node.id)
        .map((edge) => ({ nodeId: edge.to.nodeId, relationship: edge.relationship }))
        .sort(compareExplainEdges),
      providerRequirements: graph.providerRequirements
        .filter((requirement) => requirement.consumer.nodeId === node.id)
        .map((requirement) => {
          const binding = graph.providerBindings.find((candidate) => candidate.requirement === requirement.id);
          return {
            id: requirement.id,
            interface: requirement.interface,
            purpose: requirement.purpose,
            ...(binding ? { provider: binding.provider.nodeId } : {}),
          };
        })
        .sort((left, right) => left.id.localeCompare(right.id)),
    }));
  const operations = [...(options.catalog?.operations ?? [])]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map<ApplicationExplainOperation>((operation) => ({
      id: operation.id,
      version: operation.version,
      kind: operation.kind,
      placement: operation.placement.nodeId,
      classification: operation.authority.classification,
      transports: operation.transports.map((binding) => `${binding.transport}:${binding.id}`).sort(),
    }));
  const workloads = [...(options.workloadAuthority ?? [])]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map<ApplicationExplainWorkloadAuthority>((envelope) => ({
      id: envelope.id,
      workloadIdentity: envelope.workloadIdentity.id,
      operationId: envelope.operationId,
      catalogRevision: envelope.catalogRevision,
      ...(envelope.binding
        ? {
            binding: {
              id: envelope.binding.id,
              source: envelope.binding.source,
              boundKeys: [...envelope.binding.boundKeys],
              inferred: envelope.binding.inferred,
            },
          }
        : {}),
    }));
  return {
    apiVersion: 'applik8s.explain/v1alpha1',
    application: graph.metadata.name,
    ...(graph.metadata.namespace ? { namespace: graph.metadata.namespace } : {}),
    graph: {
      apiVersion: graph.apiVersion,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
    },
    nodes,
    operations,
    workloads,
  };
}

function compareExplainEdges(left: ApplicationExplainEdge, right: ApplicationExplainEdge): number {
  return left.nodeId.localeCompare(right.nodeId) || left.relationship.localeCompare(right.relationship);
}
