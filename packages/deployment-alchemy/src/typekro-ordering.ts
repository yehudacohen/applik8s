import type { ApplicationDeploymentGraph } from "@applik8s/deployment-contract";
import type {
  AdaptedTypeKroDeployment,
  TypeKroDeclarationGroup,
} from "@applik8s/deployment-typekro";
import * as Output from "alchemy/Output";
import type { AlchemyResourceDeclaration } from "typekro/alchemy";

export function orderedTypeKroGroups(
  graph: ApplicationDeploymentGraph,
  adapted: AdaptedTypeKroDeployment,
): readonly TypeKroDeclarationGroup[] {
  const groups = [adapted.root, ...adapted.direct];
  const byId = new Map(groups.map((group) => [group.deploymentNodeId, group]));
  const remaining = new Set(byId.keys());
  const ordered: TypeKroDeclarationGroup[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter((nodeId) =>
        typeKroGroupPrerequisites(graph, nodeId).every(
          (prerequisite) => !remaining.has(prerequisite),
        ),
      )
      .sort();
    if (ready.length === 0) {
      throw new Error(
        `TypeKro deployment groups contain a dependency cycle: ${[...remaining].sort().join(", ")}.`,
      );
    }
    for (const nodeId of ready) {
      const group = byId.get(nodeId);
      if (group) ordered.push(group);
      remaining.delete(nodeId);
    }
  }
  return ordered;
}

export function typeKroGroupPrerequisites(
  graph: ApplicationDeploymentGraph,
  nodeId: string,
): readonly string[] {
  const typeKroNodes = new Set(
    graph.nodes
      .filter(
        (node) =>
          node.kind === "kubernetesComposition" ||
          node.kind === "kubernetesDirect",
      )
      .map((node) => node.id),
  );
  return graph.edges
    .filter(
      (edge) =>
        edge.to === nodeId &&
        typeKroNodes.has(edge.from) &&
        (edge.relationship === "requiresReady" ||
          edge.relationship === "installsApi" ||
          edge.relationship === "owns"),
    )
    .map((edge) => edge.from)
    .sort();
}

/**
 * Add deployment-graph ordering without changing TypeKro's canonical
 * `dependencies` field. Every declaration in the consumer group receives the
 * outer prerequisite, including declarations that already have native
 * TypeKro dependencies. Those two dependency sources are additive.
 */
export function withOrderingOnlyPrerequisites(
  declarations: readonly AlchemyResourceDeclaration[],
  prerequisites: readonly unknown[],
): readonly AlchemyResourceDeclaration[] {
  if (prerequisites.length === 0) return declarations;
  // typecast: erase heterogeneous resource handles at the generic Alchemy scheduling boundary.
  const ordering = Output.all(
    ...prerequisites.map(
      // typecast: erase each opaque resource handle only at Alchemy's Output boundary.
      (handle) => Output.of(handle as never),
    ),
    // typecast: erase Alchemy's heterogeneous Output tuple at the generic scheduling boundary.
  ) as never;
  return declarations.map((declaration) => ({
    ...declaration,
    // typecast: add a scheduling-only Input absent from TypeKro's canonical props type.
    props: {
      ...declaration.props,
      applik8sOrderingPrerequisites: ordering,
      // typecast: add a scheduling-only Input absent from TypeKro's canonical props type.
    } as never,
  }));
}
