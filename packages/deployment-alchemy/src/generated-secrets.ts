import type {
  ApplicationDeploymentGraph,
  ApplicationExternalProviderDeploymentNode,
} from "@applik8s/deployment-contract";
import type { ApplicationGeneratedSecretProps } from "@applik8s/deployment-provider-kubernetes";
import * as Output from "alchemy/Output";
import { decodeGeneratedSecretConfiguration } from "./generated-secret-contract.js";
import { applicationAlchemyStackIdentity } from "./identity.js";

export function generatedSecretNodes(
  graph: ApplicationDeploymentGraph,
): readonly ApplicationExternalProviderDeploymentNode[] {
  return graph.nodes
    .filter(isGeneratedSecretNode)
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function isGeneratedSecretNode(
  node: ApplicationDeploymentGraph["nodes"][number],
): node is ApplicationExternalProviderDeploymentNode {
  return (
    node.kind === "externalProvider" &&
    node.provider.interface === "Secret" &&
    node.provider.implementation ===
      "alchemy-kubernetes-generated-secret" &&
    node.spec.resourceType === "kubernetesGeneratedSecret"
  );
}

export function generatedSecretProps(
  node: ApplicationExternalProviderDeploymentNode,
  graph: ApplicationDeploymentGraph,
  namespaceHandles: readonly unknown[],
): ApplicationGeneratedSecretProps {
  const configuration = decodeGeneratedSecretConfiguration(
    node.spec.configuration,
    node.id,
  );
  return {
    deploymentNodeId: node.id,
    deploymentOwnerId: applicationAlchemyStackIdentity(
      graph.metadata.identity,
      graph.metadata.strategy,
    ).digest,
    context: graph.metadata.identity.connection.cluster,
    namespace: configuration.namespace,
    name: configuration.name,
    ...(configuration.secretType
      ? { secretType: configuration.secretType }
      : {}),
    values: configuration.values,
    consumers: configuration.consumers,
    deletionPolicy:
      node.lifecycle.deletion === "delete" ? "delete" : "retain",
    ...(namespaceHandles.length > 0
      ? {
          // typecast: erase heterogeneous namespace handles only at Alchemy's scheduling boundary.
          prerequisites: Output.all(
            // typecast: each opaque provider handle becomes an ordering-only Alchemy Output.
            ...namespaceHandles.map((handle) => Output.of(handle as never)),
            // typecast: collapse Alchemy's heterogeneous Output tuple to the provider-neutral prerequisite input.
          ) as never,
        }
      : {}),
  };
}

/**
 * Fail before Alchemy mutates any provider when the selected installation
 * requires operation-host credentials that are not available. Secret values
 * are neither returned nor included in the diagnostic.
 */
export function assertGeneratedSecretHostEnvironmentAvailable(
  nodes: readonly ApplicationExternalProviderDeploymentNode[],
  environment: Readonly<Record<string, string | undefined>> = process.env,
): void {
  const missing = new Map<string, string[]>();
  for (const node of nodes) {
    const configuration = decodeGeneratedSecretConfiguration(
      node.spec.configuration,
      node.id,
    );
    for (const value of Object.values(configuration.values)) {
      if (
        (value.kind !== "hostEnvironment" && value.kind !== "hostEnvironmentJson") ||
        environment[value.name]?.trim()
      ) {
        continue;
      }
      const consumers = missing.get(value.name) ?? [];
      consumers.push(node.id);
      missing.set(value.name, consumers);
    }
  }
  if (missing.size === 0) return;
  throw new Error(
    `Application deployment requires non-empty operation-host environment variable(s) ${[
      ...missing.entries(),
    ]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, consumers]) => `${name} (${consumers.sort().join(", ")})`)
      .join(", ")}. Configure the selected installation environment before retrying; no provider resources were changed.`,
  );
}
