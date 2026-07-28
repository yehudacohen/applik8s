import {
  type ApplicationDeploymentGraph,
  type ApplicationDeploymentNode,
  digestApplicationDeploymentValue,
  validateApplicationDeploymentGraph,
} from "@applik8s/deployment-contract";
import {
  ARTIFACT_PLAN_VERSION,
  decodeKroArtifactBundle,
  SEMANTIC_PLAN_VERSION,
} from "typekro/experimental/planning";
import {
  type AdaptApplicationDeploymentToTypeKroRequest,
  type AdaptedTypeKroDeployment,
  type ApplicationTypeKroDeclaration,
  normalizeTypeKroDiagnostic,
  type TypeKroCompositionBinding,
  type TypeKroDeclarationGroup,
  type TypeKroSemanticPlanEvidence,
} from "./types.js";

const supportedTypeKroVersion = "0.31.1";
const supportedSemanticPlanVersion = 1;
const supportedArtifactPlanVersion = 1;
const adapterCompatibility: AdaptedTypeKroDeployment["adapter"] = {
  typekro: "0.31.1",
  semanticPlanVersion: 1,
  artifactPlanVersion: 1,
};

export async function adaptApplicationDeploymentToTypeKro(
  request: AdaptApplicationDeploymentToTypeKroRequest,
): Promise<AdaptedTypeKroDeployment> {
  assertTypeKroCompatibility();
  assertValidGraph(request.graph);
  const rootNode = applicationRoot(request.graph);
  assertComposition(rootNode, request.root);
  const root = await declarationGroup(
    rootNode,
    request.graph.metadata.strategy,
    request.root,
  );

  const directNodes = request.graph.nodes
    .filter((node) => node.kind === "kubernetesDirect")
    .sort((left, right) => left.id.localeCompare(right.id));
  const suppliedDirect = request.direct ?? {};
  const direct: TypeKroDeclarationGroup[] = [];
  for (const node of directNodes) {
    const binding = suppliedDirect[node.id];
    if (!binding) {
      throw new Error(
        `Deployment node ${node.id} is direct-only but has no TypeKro composition binding.`,
      );
    }
    assertComposition(node, binding);
    direct.push(await declarationGroup(node, "direct", binding));
  }
  const unexpected = Object.keys(suppliedDirect).filter(
    (nodeId) => !directNodes.some((node) => node.id === nodeId),
  );
  if (unexpected.length > 0) {
    throw new Error(
      `TypeKro direct bindings have no deployment nodes: ${unexpected.sort().join(", ")}.`,
    );
  }

  assertArtifactCoverage(request.graph, [root, ...direct]);
  assertGlobalDeclarationIdentity([root, ...direct]);
  const declarations = materializationDeclarations(request.graph, [
    root,
    ...direct,
  ]);
  const materializationDigest = digestApplicationDeploymentValue(
    declarations.map(declarationEvidence),
  );
  const evidence = {
    adapter: adapterCompatibility,
    graphDigest: digestApplicationDeploymentValue(request.graph),
    groups: [root, ...direct].map((group) => ({
      deploymentNodeId: group.deploymentNodeId,
      strategy: group.strategy,
      declarationDigest: group.declarationDigest,
      semanticPlan: group.semanticPlan,
    })),
    materializationDigest,
  };
  return {
    adapter: adapterCompatibility,
    root,
    direct,
    declarations,
    declarationCount: declarations.length,
    materializationDigest,
    evidenceDigest: digestApplicationDeploymentValue(evidence),
  };
}

function assertArtifactCoverage(
  graph: ApplicationDeploymentGraph,
  groups: readonly TypeKroDeclarationGroup[],
): void {
  const groupIds = new Set(groups.map((group) => group.deploymentNodeId));
  const artifacts = new Map(
    graph.nodes
      .filter(
        (node) =>
          node.kind === "artifact" ||
          (node.kind === "externalProvider" &&
            node.provider.interface === "Secret" &&
            node.provider.implementation ===
              "alchemy-kubernetes-generated-secret" &&
            node.spec.resourceType === "kubernetesGeneratedSecret"),
      )
      .map((node) => [node.id, node]),
  );
  const expected = new Set(
    graph.edges
      .filter(
        (edge) =>
          edge.relationship === "requiresOutput" &&
          edge.output &&
          artifacts.has(edge.from) &&
          groupIds.has(edge.to),
      )
      .map((edge) => artifactUseKey(edge.to, edge.from, edge.output ?? "")),
  );
  const actual = new Set<string>();
  for (const group of groups) {
    for (const declaration of group.declarations) {
      const requirements = new Map(
        (declaration.artifactRequirements ?? []).map((requirement) => [
          requirement.id,
          requirement,
        ]),
      );
      for (const use of declaration.artifactOutputUses ?? []) {
        const artifact = artifacts.get(use.requirementId);
        if (!artifact) {
          throw new Error(
            `TypeKro declaration ${declaration.id} consumes undeclared deployment artifact ${use.requirementId}.${use.output}.`,
          );
        }
        if (!artifact.outputs.some((output) => output.name === use.output)) {
          throw new Error(
            `TypeKro declaration ${declaration.id} consumes undeclared output ${use.requirementId}.${use.output}.`,
          );
        }
        const requirement = requirements.get(use.requirementId);
        if (!requirement?.outputs.includes(use.output)) {
          throw new Error(
            `TypeKro declaration ${declaration.id} uses ${use.requirementId}.${use.output} without carrying its artifact requirement.`,
          );
        }
        actual.add(
          artifactUseKey(group.deploymentNodeId, use.requirementId, use.output),
        );
      }
    }
  }
  const missing = [...expected].filter((key) => !actual.has(key)).sort();
  const unexpected = [...actual].filter((key) => !expected.has(key)).sort();
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      [
        missing.length > 0
          ? `Deployment artifact outputs missing from TypeKro composition: ${missing.join(", ")}.`
          : "",
        unexpected.length > 0
          ? `TypeKro artifact outputs missing from deployment graph: ${unexpected.join(", ")}.`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
}

function artifactUseKey(
  deploymentNodeId: string,
  requirementId: string,
  output: string,
): string {
  return `${deploymentNodeId}:${requirementId}.${output}`;
}

function assertTypeKroCompatibility(): void {
  if (
    SEMANTIC_PLAN_VERSION !== supportedSemanticPlanVersion ||
    ARTIFACT_PLAN_VERSION !== supportedArtifactPlanVersion
  ) {
    throw new Error(
      `Unsupported TypeKro planning contracts: semantic=${SEMANTIC_PLAN_VERSION}, artifact=${ARTIFACT_PLAN_VERSION}; Applik8s ${supportedTypeKroVersion} adapter requires semantic=1 and artifact=1.`,
    );
  }
}

function assertValidGraph(graph: ApplicationDeploymentGraph): void {
  const validation = validateApplicationDeploymentGraph(graph);
  if (!validation.valid) {
    throw new Error(
      `Cannot adapt an invalid ApplicationDeploymentGraph:\n${validation.diagnostics
        .map((diagnostic) => `- [${diagnostic.code}] ${diagnostic.message}`)
        .join("\n")}`,
    );
  }
}

function applicationRoot(
  graph: ApplicationDeploymentGraph,
): ApplicationDeploymentNode {
  const roots = graph.nodes.filter(
    (node) => node.kind === "kubernetesComposition",
  );
  if (roots.length !== 1) {
    throw new Error(
      `ApplicationDeploymentGraph must contain exactly one kubernetesComposition root; found ${roots.length}.`,
    );
  }
  const root = roots[0];
  if (!root) throw new Error("ApplicationDeploymentGraph has no root composition.");
  return root;
}

function assertComposition(
  node: ApplicationDeploymentNode,
  binding: TypeKroCompositionBinding,
): void {
  if (
    node.kind !== "kubernetesComposition" &&
    node.kind !== "kubernetesDirect"
  ) {
    throw new Error(`Deployment node ${node.id} is not a TypeKro composition.`);
  }
  if (node.spec.compositionId !== binding.compositionId) {
    throw new Error(
      `Deployment node ${node.id} expects composition ${node.spec.compositionId}, but binding provides ${binding.compositionId}.`,
    );
  }
}

async function declarationGroup(
  node: ApplicationDeploymentNode,
  strategy: "direct" | "kro",
  binding: TypeKroCompositionBinding,
): Promise<TypeKroDeclarationGroup> {
  const inspection = binding.inspect();
  const plan = binding.plan();
  const diagnostics = [...inspection.diagnostics, ...plan.diagnostics].map(
    normalizeTypeKroDiagnostic,
  );
  const errors = diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  );
  if (errors.length > 0) {
    throw new Error(
      `TypeKro semantic plan for ${node.id} is invalid:\n${errors
        .map((diagnostic) => `- [${diagnostic.code}] ${diagnostic.message}`)
        .join("\n")}`,
    );
  }
  const declarations = applyDeploymentLifecycle(
    node,
    await binding.declarations(strategy),
  );
  assertDeclarationTopology(node.id, strategy, declarations);
  const semanticPlan: TypeKroSemanticPlanEvidence = {
    version: plan.version,
    composition: plan.composition.name,
    inputDigest: plan.inputDigest,
    semanticContentDigest: plan.semanticContentDigest,
    planIdentityDigest: plan.planIdentityDigest,
    nodeCount: plan.nodes.length,
    edgeCount: plan.edges.length,
    diagnostics,
  };
  return {
    deploymentNodeId: node.id,
    strategy,
    declarations,
    declarationDigest: digestApplicationDeploymentValue(
      declarations.map(declarationEvidence),
    ),
    semanticPlan,
  };
}

function applyDeploymentLifecycle(
  node: ApplicationDeploymentNode,
  declarations: readonly ApplicationTypeKroDeclaration[],
): readonly ApplicationTypeKroDeclaration[] {
  const retainGroup =
    node.lifecycle.ownership === "shared" ||
    node.lifecycle.deletion === "retain" ||
    node.lifecycle.deletion === "orphan" ||
    node.lifecycle.deletion === "none";
  return declarations.map((declaration) => {
    const retain =
      retainGroup || isTypeKroSharedSupportingDeclaration(declaration);
    if (!retain || declaration.props.retain === true) return declaration;
    return {
      ...declaration,
      props: {
        ...declaration.props,
        retain: true,
      },
    };
  });
}

/**
 * TypeKro singleton owners are deliberately outside a consumer instance's
 * lifecycle. A separate Alchemy stack cannot prove that it is the last
 * consumer, so it must drop only its state entry during destroy. Retain the
 * owner RGD/instance and any hoisted Namespace on which that owner depends.
 */
function isTypeKroSharedSupportingDeclaration(
  declaration: ApplicationTypeKroDeclaration,
): boolean {
  const encoded = declaration.props.kroArtifactBundle;
  const operationId = declaration.props.kroArtifactOperationId;
  if (!encoded || !operationId) return false;

  const bundle = decodeKroArtifactBundle(encoded);
  const operations = new Map(
    bundle.operations.map((operation) => [operation.id, operation]),
  );
  const operation = operations.get(operationId);
  if (!operation) {
    throw new Error(
      `TypeKro declaration ${declaration.id} references missing bundle operation ${operationId}.`,
    );
  }
  if (
    operation.role === "singleton-owner-rgd" ||
    operation.role === "singleton-owner-instance"
  ) {
    return true;
  }
  if (operation.role !== "hoisted-namespace") return false;

  const singletonDependencies = new Set<string>();
  const visit = (id: string): void => {
    if (singletonDependencies.has(id)) return;
    singletonDependencies.add(id);
    for (const dependency of operations.get(id)?.dependencies ?? []) {
      visit(dependency);
    }
  };
  for (const candidate of bundle.operations) {
    if (
      candidate.role === "singleton-owner-rgd" ||
      candidate.role === "singleton-owner-instance"
    ) {
      visit(candidate.id);
    }
  }
  return singletonDependencies.has(operationId);
}

function assertDeclarationTopology(
  nodeId: string,
  strategy: "direct" | "kro",
  declarations: readonly ApplicationTypeKroDeclaration[],
): void {
  if (declarations.length === 0) {
    throw new Error(`TypeKro composition ${nodeId} emitted no declarations.`);
  }
  const seen = new Set<string>();
  for (const declaration of declarations) {
    if (!declaration.id.trim()) {
      throw new Error(`TypeKro composition ${nodeId} emitted an empty declaration id.`);
    }
    if (seen.has(declaration.id)) {
      throw new Error(
        `TypeKro composition ${nodeId} emitted duplicate declaration ${declaration.id}.`,
      );
    }
    for (const dependency of declaration.dependsOn) {
      if (!seen.has(dependency)) {
        throw new Error(
          `TypeKro declaration ${declaration.id} depends on ${dependency}, which is missing or not topologically earlier.`,
        );
      }
    }
    if (
      strategy === "direct" &&
      declaration.props.deploymentStrategy !== "direct"
    ) {
      throw new Error(
        `TypeKro declaration ${declaration.id} uses ${declaration.props.deploymentStrategy}, expected ${strategy}.`,
      );
    }
    seen.add(declaration.id);
  }
}

function assertGlobalDeclarationIdentity(
  groups: readonly TypeKroDeclarationGroup[],
): void {
  const owners = new Map<string, string>();
  for (const group of groups) {
    for (const declaration of group.declarations) {
      const owner = owners.get(declaration.id);
      if (owner) {
        throw new Error(
          `TypeKro declaration id ${declaration.id} collides between deployment nodes ${owner} and ${group.deploymentNodeId}.`,
        );
      }
      owners.set(declaration.id, group.deploymentNodeId);
    }
  }
}

function materializationDeclarations(
  graph: ApplicationDeploymentGraph,
  groups: readonly TypeKroDeclarationGroup[],
): readonly ApplicationTypeKroDeclaration[] {
  const byNode = new Map(groups.map((group) => [group.deploymentNodeId, group]));
  const prerequisites = new Map<string, Set<string>>();
  for (const group of groups) prerequisites.set(group.deploymentNodeId, new Set());
  for (const edge of graph.edges) {
    if (
      edge.relationship !== "requiresReady" &&
      edge.relationship !== "installsApi" &&
      edge.relationship !== "owns"
    ) {
      continue;
    }
    if (byNode.has(edge.from) && byNode.has(edge.to)) {
      prerequisites.get(edge.to)?.add(edge.from);
    }
  }
  const ordered: TypeKroDeclarationGroup[] = [];
  const remaining = new Set(byNode.keys());
  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter((nodeId) =>
        [...(prerequisites.get(nodeId) ?? [])].every(
          (dependency) => !remaining.has(dependency),
        ),
      )
      .sort();
    if (ready.length === 0) {
      throw new Error(
        `TypeKro deployment groups contain a dependency cycle: ${[...remaining].sort().join(", ")}.`,
      );
    }
    for (const nodeId of ready) {
      const group = byNode.get(nodeId);
      if (group) ordered.push(group);
      remaining.delete(nodeId);
    }
  }

  return ordered.flatMap((group) => group.declarations);
}

function declarationEvidence(
  declaration: ApplicationTypeKroDeclaration,
): Readonly<Record<string, unknown>> {
  return {
    id: declaration.id,
    dependsOn: declaration.dependsOn,
    orderingOnlyDependsOn: declaration.orderingOnlyDependsOn ?? [],
    deploymentStrategy: declaration.props.deploymentStrategy,
    namespace: declaration.props.namespace,
    resourceId: declaration.props.resourceId,
    artifactExecutionRecord: declaration.props.artifactExecutionRecord,
    kroArtifactBundle: declaration.props.kroArtifactBundle,
    kroArtifactOperationId: declaration.props.kroArtifactOperationId,
    retain: declaration.props.retain,
    namespaceEmptyGate: declaration.props.namespaceEmptyGate,
    namespaceOwnerRgd: declaration.props.namespaceOwnerRgd,
    artifactRequirements: declaration.artifactRequirements?.map((requirement) => ({
      id: requirement.id,
      kind: requirement.kind,
      outputs: requirement.outputs,
    })),
    artifactOutputUses: declaration.artifactOutputUses,
  };
}
