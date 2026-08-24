import { validateApplicationRuntimeAccessPlan } from './runtime-access.js';
import type {
  ApplicationDeploymentDiagnostic,
  ApplicationDeploymentDiagnosticCode,
  ApplicationDeploymentEdge,
  ApplicationDeploymentGraph,
  ApplicationDeploymentNode,
  ApplicationDeploymentOutput,
  ApplicationDeploymentValidationResult,
} from "./types.js";

const sha256Pattern = /^sha256:[a-f0-9]{64}$/;
const causalRelationships = new Set([
  "requiresOutput",
  "requiresReady",
  "installsApi",
  "owns",
  "publishes",
  "projectsStatus",
]);

export function validateApplicationDeploymentGraph(
  graph: ApplicationDeploymentGraph,
): ApplicationDeploymentValidationResult {
  const diagnostics: ApplicationDeploymentDiagnostic[] = [];
  validateEnvelope(graph, diagnostics);
  validateRuntimeAccess(graph, diagnostics);
  const nodes = validateNodes(graph, diagnostics);
  validateEdges(graph, nodes, diagnostics);
  validateSingletons(graph.nodes, diagnostics);
  validateCycles(graph, diagnostics);
  return {
    valid: !diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    diagnostics,
  };
}

function validateRuntimeAccess(
  graph: ApplicationDeploymentGraph,
  diagnostics: ApplicationDeploymentDiagnostic[],
): void {
  for (const error of validateApplicationRuntimeAccessPlan(graph.runtimeAccess, { requireResolved: true })) {
    diagnostics.push(diagnostic('DEPLOYMENT_GRAPH_INVALID', `Runtime-access envelope ${error}.`));
  }
  const target = graph.metadata.identity.connection.provider === 'local'
    || graph.metadata.identity.connection.provider === 'aws-local'
    || graph.metadata.identity.connection.provider === 'aws'
    ? graph.metadata.identity.connection.provider
    : 'kubernetes';
  if (graph.runtimeAccess.target !== target) {
    diagnostics.push(diagnostic('DEPLOYMENT_GRAPH_INVALID', `Runtime-access envelope targets ${graph.runtimeAccess.target}, but the deployment connection targets ${target}.`));
  }
  if (graph.runtimeAccess.sourceGraphDigest !== graph.metadata.sourceGraphDigest) {
    diagnostics.push(diagnostic('DEPLOYMENT_GRAPH_INVALID', 'Runtime-access envelope sourceGraphDigest does not match the deployment graph.'));
  }
}

function validateEnvelope(
  graph: ApplicationDeploymentGraph,
  diagnostics: ApplicationDeploymentDiagnostic[],
): void {
  if (
    graph.apiVersion !== "applik8s.deploymentGraph/v1alpha1" ||
    graph.kind !== "ApplicationDeploymentGraph"
  ) {
    diagnostics.push(
      diagnostic(
        "DEPLOYMENT_GRAPH_INVALID",
        "Deployment graph must use the supported apiVersion and kind.",
      ),
    );
  }
  const { identity } = graph.metadata;
  for (const [field, value] of Object.entries({
    application: identity.application,
    controlPlaneNamespace: identity.controlPlaneNamespace,
    instance: identity.instance,
    profile: identity.profile,
    connectionProvider: identity.connection.provider,
    connectionCluster: identity.connection.cluster,
  })) {
    if (!nonEmptyString(value)) {
      diagnostics.push(
        diagnostic(
          "DEPLOYMENT_IDENTITY_INVALID",
          `Deployment identity field ${field} must be non-empty.`,
        ),
      );
    }
  }
  if (!sha256Pattern.test(identity.connection.digest)) {
    diagnostics.push(
      diagnostic(
        "DEPLOYMENT_IDENTITY_INVALID",
        "Deployment connection digest must be a full sha256 digest.",
      ),
    );
  }
  if (!sha256Pattern.test(graph.metadata.sourceGraphDigest)) {
    diagnostics.push(
      diagnostic(
        "DEPLOYMENT_GRAPH_INVALID",
        "Deployment sourceGraphDigest must be a full sha256 digest.",
      ),
    );
  }
}

function validateNodes(
  graph: ApplicationDeploymentGraph,
  diagnostics: ApplicationDeploymentDiagnostic[],
): ReadonlyMap<string, ApplicationDeploymentNode> {
  const nodes = new Map<string, ApplicationDeploymentNode>();
  for (const node of graph.nodes) {
    if (!nonEmptyString(node.id)) {
      diagnostics.push(
        diagnostic(
          "DEPLOYMENT_NODE_INVALID",
          "Deployment node id must be non-empty.",
          node,
        ),
      );
      continue;
    }
    if (nodes.has(node.id)) {
      diagnostics.push(
        diagnostic(
          "DEPLOYMENT_NODE_DUPLICATE",
          `Deployment node id ${node.id} is duplicated.`,
          node,
        ),
      );
      continue;
    }
    nodes.set(node.id, node);
    validateNode(graph, node, diagnostics);
  }
  return nodes;
}

function validateNode(
  graph: ApplicationDeploymentGraph,
  node: ApplicationDeploymentNode,
  diagnostics: ApplicationDeploymentDiagnostic[],
): void {
  if (!Number.isSafeInteger(node.contractVersion) || node.contractVersion < 1) {
    diagnostics.push(
      diagnostic(
        "DEPLOYMENT_NODE_INVALID",
        `Deployment node ${node.id} contractVersion must be a positive integer.`,
        node,
      ),
    );
  }
  if (!sha256Pattern.test(node.configurationDigest)) {
    diagnostics.push(
      diagnostic(
        "DEPLOYMENT_NODE_INVALID",
        `Deployment node ${node.id} configurationDigest must be a full sha256 digest.`,
        node,
      ),
    );
  }
  if (node.scope.connectionDigest !== graph.metadata.identity.connection.digest) {
    diagnostics.push(
      diagnostic(
        "DEPLOYMENT_CONNECTION_UNSAFE",
        `Deployment node ${node.id} belongs to a different connection.`,
        node,
      ),
    );
  }
  if (!node.capabilities.strategies.includes(graph.metadata.strategy)) {
    const allowedDirectException =
      graph.metadata.strategy === "kro" && node.kind === "kubernetesDirect";
    if (!allowedDirectException) {
      diagnostics.push(
        diagnostic(
          "DEPLOYMENT_STRATEGY_UNSUPPORTED",
          `Deployment node ${node.id} does not support ${graph.metadata.strategy} mode.`,
          node,
        ),
      );
    }
  }
  validateOutputs(node, diagnostics);
  validateInputs(node, diagnostics);
  validateLifecycle(node, diagnostics);
  if (
    node.kind === "externalProvider" &&
    node.lifecycle.ownership === "application" &&
    !nonEmptyString(node.spec.controller)
  ) {
    diagnostics.push(
      diagnostic(
        "DEPLOYMENT_LIFECYCLE_UNSAFE",
        `External provider node ${node.id} has no durable execution controller.`,
        node,
      ),
    );
  }
  if (node.kind === "externalReference") {
    if (
      node.lifecycle.ownership !== "external" ||
      node.lifecycle.deletion !== "none" ||
      node.lifecycle.adoption !== "externalOnly"
    ) {
      diagnostics.push(
        diagnostic(
          "DEPLOYMENT_LIFECYCLE_UNSAFE",
          `External reference ${node.id} cannot carry create, adoption, or deletion ownership.`,
          node,
        ),
      );
    }
  }
  if (node.kind === "statusProjection") {
    if (
      !nonEmptyString(node.spec.field) ||
      !nonEmptyString(node.spec.sourceNodeId) ||
      !nonEmptyString(node.spec.sourcePath)
    ) {
      diagnostics.push(
        diagnostic(
          "DEPLOYMENT_STATUS_INVALID",
          `Status projection ${node.id} must name a field, source node, and source path.`,
          node,
        ),
      );
    }
  }
}

function validateOutputs(
  node: ApplicationDeploymentNode,
  diagnostics: ApplicationDeploymentDiagnostic[],
): void {
  const outputs = new Set<string>();
  for (const output of node.outputs) {
    if (!nonEmptyString(output.name) || outputs.has(output.name)) {
      diagnostics.push(
        diagnostic(
          "DEPLOYMENT_OUTPUT_INVALID",
          `Deployment node ${node.id} has an empty or duplicate output name.`,
          node,
        ),
      );
    }
    outputs.add(output.name);
    validateOutputPersistence(node, output, diagnostics);
  }
}

function validateOutputPersistence(
  node: ApplicationDeploymentNode,
  output: ApplicationDeploymentOutput,
  diagnostics: ApplicationDeploymentDiagnostic[],
): void {
  if (output.sensitivity === "sensitive" && output.persistence === "state") {
    diagnostics.push(
      diagnostic(
        "DEPLOYMENT_SECRET_UNSAFE",
        `Sensitive output ${node.id}.${output.name} cannot be persisted as plaintext state.`,
        node,
      ),
    );
  }
  if (
    output.type === "secretReference" &&
    output.persistence !== "reference"
  ) {
    diagnostics.push(
      diagnostic(
        "DEPLOYMENT_SECRET_UNSAFE",
        `Secret-reference output ${node.id}.${output.name} must persist only its reference.`,
        node,
      ),
    );
  }
}

function validateInputs(
  node: ApplicationDeploymentNode,
  diagnostics: ApplicationDeploymentDiagnostic[],
): void {
  for (const [name, input] of Object.entries(node.inputs)) {
    if (!nonEmptyString(name)) {
      diagnostics.push(
        diagnostic(
          "DEPLOYMENT_NODE_INVALID",
          `Deployment node ${node.id} contains an unnamed input.`,
          node,
        ),
      );
    }
    if (
      input.kind === "output" &&
      input.sensitivity === "sensitive" &&
      input.persistence !== "redacted" &&
      input.persistence !== "reference" &&
      input.persistence !== "ephemeral"
    ) {
      diagnostics.push(
        diagnostic(
          "DEPLOYMENT_SECRET_UNSAFE",
          `Sensitive input ${node.id}.${name} must be redacted, reference-only, or ephemeral.`,
          node,
        ),
      );
    }
  }
}

function validateLifecycle(
  node: ApplicationDeploymentNode,
  diagnostics: ApplicationDeploymentDiagnostic[],
): void {
  if (
    node.lifecycle.ownership === "external" &&
    (node.lifecycle.deletion !== "none" ||
      node.lifecycle.adoption !== "externalOnly")
  ) {
    diagnostics.push(
      diagnostic(
        "DEPLOYMENT_LIFECYCLE_UNSAFE",
        `Externally owned node ${node.id} cannot be adopted or deleted.`,
        node,
      ),
    );
  }
  if (
    node.lifecycle.deletion === "retain" &&
    node.lifecycle.namespaceNodeId === node.id
  ) {
    diagnostics.push(
      diagnostic(
        "DEPLOYMENT_LIFECYCLE_UNSAFE",
        `Retained node ${node.id} cannot own the namespace whose deletion controls its retention.`,
        node,
      ),
    );
  }
}

function validateEdges(
  graph: ApplicationDeploymentGraph,
  nodes: ReadonlyMap<string, ApplicationDeploymentNode>,
  diagnostics: ApplicationDeploymentDiagnostic[],
): void {
  const keys = new Set<string>();
  for (const edge of graph.edges) {
    const key = `${edge.from}\0${edge.relationship}\0${edge.to}\0${edge.output ?? ""}`;
    if (keys.has(key)) {
      diagnostics.push(
        edgeDiagnostic(
          "DEPLOYMENT_EDGE_INVALID",
          `Deployment edge ${edge.from} ${edge.relationship} ${edge.to} is duplicated.`,
          edge,
        ),
      );
    }
    keys.add(key);
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (!from || !to || edge.from === edge.to) {
      diagnostics.push(
        edgeDiagnostic(
          "DEPLOYMENT_EDGE_INVALID",
          `Deployment edge ${edge.from} ${edge.relationship} ${edge.to} has a missing or self-referential endpoint.`,
          edge,
        ),
      );
      continue;
    }
    if (from.scope.connectionDigest !== to.scope.connectionDigest) {
      diagnostics.push(
        edgeDiagnostic(
          "DEPLOYMENT_CONNECTION_UNSAFE",
          `Deployment edge ${edge.from} ${edge.relationship} ${edge.to} crosses connections.`,
          edge,
        ),
      );
    }
    if (edge.relationship === "requiresOutput") {
      if (
        !nonEmptyString(edge.output) ||
        !from.outputs.some((output) => output.name === edge.output)
      ) {
        diagnostics.push(
          edgeDiagnostic(
            "DEPLOYMENT_OUTPUT_INVALID",
            `Output dependency ${edge.from} -> ${edge.to} names an output that ${edge.from} does not declare.`,
            edge,
          ),
        );
      }
    }
    if (
      edge.relationship === "owns" &&
      (from.lifecycle.ownership === "external" ||
        to.lifecycle.ownership === "external")
    ) {
      diagnostics.push(
        edgeDiagnostic(
          "DEPLOYMENT_LIFECYCLE_UNSAFE",
          `Ownership edge ${edge.from} -> ${edge.to} cannot include an external resource.`,
          edge,
        ),
      );
    }
    if (
      edge.relationship === "retains" &&
      to.lifecycle.namespaceNodeId === from.id &&
      from.lifecycle.deletion === "delete"
    ) {
      diagnostics.push(
        edgeDiagnostic(
          "DEPLOYMENT_LIFECYCLE_UNSAFE",
          `Retained node ${to.id} cannot live inside deleted namespace ${from.id}.`,
          edge,
        ),
      );
    }
  }
  for (const node of graph.nodes) {
    validateInputReferences(node, nodes, graph.edges, diagnostics);
    validateNamespaceReference(node, nodes, diagnostics);
    if (
      node.kind === "statusProjection" &&
      !nodes.has(node.spec.sourceNodeId)
    ) {
      diagnostics.push(
        diagnostic(
          "DEPLOYMENT_STATUS_INVALID",
          `Status projection ${node.id} references missing source ${node.spec.sourceNodeId}.`,
          node,
        ),
      );
    }
    if (
      node.kind === "statusProjection" &&
      nodes.has(node.spec.sourceNodeId) &&
      !graph.edges.some(
        (edge) =>
          edge.from === node.spec.sourceNodeId &&
          edge.to === node.id &&
          edge.relationship === "projectsStatus",
      )
    ) {
      diagnostics.push(
        diagnostic(
          "DEPLOYMENT_STATUS_INVALID",
          `Status projection ${node.id} is missing its projectsStatus edge from ${node.spec.sourceNodeId}.`,
          node,
        ),
      );
    }
  }
}

function validateNamespaceReference(
  node: ApplicationDeploymentNode,
  nodes: ReadonlyMap<string, ApplicationDeploymentNode>,
  diagnostics: ApplicationDeploymentDiagnostic[],
): void {
  const namespaceNodeId = node.lifecycle.namespaceNodeId;
  if (!namespaceNodeId) return;
  const namespace = nodes.get(namespaceNodeId);
  if (!namespace) {
    diagnostics.push(
      diagnostic(
        "DEPLOYMENT_LIFECYCLE_UNSAFE",
        `Deployment node ${node.id} references missing lifecycle namespace ${namespaceNodeId}.`,
        node,
      ),
    );
    return;
  }
  if (namespace.id === node.id) {
    diagnostics.push(
      diagnostic(
        "DEPLOYMENT_LIFECYCLE_UNSAFE",
        `Deployment node ${node.id} cannot use itself as its lifecycle namespace.`,
        node,
      ),
    );
  }
  if (
    (node.lifecycle.deletion === "retain" ||
      node.lifecycle.deletion === "orphan") &&
    namespace.lifecycle.deletion === "delete"
  ) {
    diagnostics.push(
      diagnostic(
        "DEPLOYMENT_LIFECYCLE_UNSAFE",
        `Retained node ${node.id} cannot live inside deleted namespace ${namespace.id}.`,
        node,
      ),
    );
  }
}

function validateInputReferences(
  node: ApplicationDeploymentNode,
  nodes: ReadonlyMap<string, ApplicationDeploymentNode>,
  edges: readonly ApplicationDeploymentEdge[],
  diagnostics: ApplicationDeploymentDiagnostic[],
): void {
  for (const [name, input] of Object.entries(node.inputs)) {
    if (input.kind === "literal") continue;
    const producer = nodes.get(input.nodeId);
    if (!producer) {
      diagnostics.push(
        diagnostic(
          "DEPLOYMENT_NODE_INVALID",
          `Input ${node.id}.${name} references missing node ${input.nodeId}.`,
          node,
        ),
      );
      continue;
    }
    if (input.kind === "secretReference") {
      if (producer.kind !== "secretReference") {
        diagnostics.push(
          diagnostic(
            "DEPLOYMENT_SECRET_UNSAFE",
            `Secret input ${node.id}.${name} must reference a secretReference node.`,
            node,
          ),
        );
      }
      if (
        !edges.some(
          (edge) =>
            edge.from === input.nodeId &&
            edge.to === node.id &&
            edge.relationship === "requiresReady",
        )
      ) {
        diagnostics.push(
          diagnostic(
            "DEPLOYMENT_EDGE_INVALID",
            `Secret input ${node.id}.${name} is missing its requiresReady edge from ${input.nodeId}.`,
            node,
          ),
        );
      }
      continue;
    }
    const output = producer.outputs.find(
      (candidate) => candidate.name === input.output,
    );
    if (!output) {
      diagnostics.push(
        diagnostic(
          "DEPLOYMENT_OUTPUT_INVALID",
          `Input ${node.id}.${name} references missing output ${input.nodeId}.${input.output}.`,
          node,
        ),
      );
      continue;
    }
    if (
      output.sensitivity !== input.sensitivity ||
      output.persistence !== input.persistence
    ) {
      diagnostics.push(
        diagnostic(
          "DEPLOYMENT_OUTPUT_INVALID",
          `Input ${node.id}.${name} must preserve the sensitivity and persistence of ${input.nodeId}.${input.output}.`,
          node,
        ),
      );
    }
    if (
      !edges.some(
        (edge) =>
          edge.from === input.nodeId &&
          edge.to === node.id &&
          edge.relationship === "requiresOutput" &&
          edge.output === input.output,
      )
    ) {
      diagnostics.push(
        diagnostic(
          "DEPLOYMENT_EDGE_INVALID",
          `Input ${node.id}.${name} is missing its requiresOutput edge from ${input.nodeId}.${input.output}.`,
          node,
        ),
      );
    }
  }
}

function validateSingletons(
  nodes: readonly ApplicationDeploymentNode[],
  diagnostics: ApplicationDeploymentDiagnostic[],
): void {
  const singletons = new Map<string, ApplicationDeploymentNode>();
  for (const node of nodes) {
    if (node.kind !== "singleton") continue;
    const existing = singletons.get(node.spec.singletonKey);
    if (
      existing &&
      existing.configurationDigest !== node.configurationDigest
    ) {
      diagnostics.push(
        diagnostic(
          "DEPLOYMENT_SINGLETON_DRIFT",
          `Singleton key ${node.spec.singletonKey} is declared with conflicting configurations by ${existing.id} and ${node.id}.`,
          node,
        ),
      );
    } else if (!existing) {
      singletons.set(node.spec.singletonKey, node);
    }
  }
}

function validateCycles(
  graph: ApplicationDeploymentGraph,
  diagnostics: ApplicationDeploymentDiagnostic[],
): void {
  const adjacency = new Map<string, string[]>();
  for (const node of graph.nodes) adjacency.set(node.id, []);
  for (const edge of graph.edges) {
    if (!causalRelationships.has(edge.relationship)) continue;
    adjacency.get(edge.from)?.push(edge.to);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];
  const visit = (nodeId: string): void => {
    if (visited.has(nodeId)) return;
    if (visiting.has(nodeId)) {
      const start = path.indexOf(nodeId);
      const cycle = [...path.slice(start), nodeId];
      diagnostics.push(
        diagnostic(
          "DEPLOYMENT_EDGE_CYCLE",
          `Deployment graph contains a cycle: ${cycle.join(" -> ")}.`,
        ),
      );
      return;
    }
    visiting.add(nodeId);
    path.push(nodeId);
    for (const next of adjacency.get(nodeId) ?? []) visit(next);
    path.pop();
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  for (const node of graph.nodes) visit(node.id);
}

function diagnostic(
  code: ApplicationDeploymentDiagnosticCode,
  message: string,
  node?: ApplicationDeploymentNode,
): ApplicationDeploymentDiagnostic {
  return {
    severity: "error",
    code,
    message,
    ...(node ? { nodeId: node.id, source: node.source } : {}),
  };
}

function edgeDiagnostic(
  code: ApplicationDeploymentDiagnosticCode,
  message: string,
  edge: ApplicationDeploymentEdge,
): ApplicationDeploymentDiagnostic {
  return { severity: "error", code, message, edge };
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
