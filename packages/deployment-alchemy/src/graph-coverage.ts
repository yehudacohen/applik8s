import type { ApplicationDeploymentGraph } from "@applik8s/deployment-contract";
import { isGeneratedSecretNode } from "./generated-secrets.js";
import { isHarborProjectNode } from "./harbor-resources.js";

export function assertExecutableGraphCoverage(
  graph: ApplicationDeploymentGraph,
): void {
  const unsupported = graph.nodes.filter(
    (node) =>
      node.kind !== "artifact" &&
      node.kind !== "kubernetesComposition" &&
      node.kind !== "kubernetesDirect" &&
      !isHarborProjectNode(node) &&
      !isGeneratedSecretNode(node),
  );
  if (unsupported.length > 0) {
    throw new Error(
      `Alchemy deployment has no registered materializer for deployment nodes: ${unsupported
        .map((node) => `${node.id} (${node.kind})`)
        .sort()
        .join(", ")}.`,
    );
  }
}
