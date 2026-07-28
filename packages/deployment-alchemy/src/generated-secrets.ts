// typecast-file-boundary: Portable deployment JSON is validated at this provider adapter boundary.
import type {
  ApplicationDeploymentGraph,
  ApplicationExternalProviderDeploymentNode,
  DeploymentJsonObject,
} from "@applik8s/deployment-contract";
import type {
  ApplicationGeneratedSecretProps,
  ApplicationGeneratedSecretValue,
} from "@applik8s/deployment-provider-kubernetes";
import * as Output from "alchemy/Output";

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
  const configuration = requiredObject(
    node.spec.configuration,
    `${node.id}.configuration`,
  );
  const values = requiredObject(
    configuration.values,
    `${node.id}.configuration.values`,
  );
  const valueContracts = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      generatedSecretValue(value, `${node.id}.configuration.values.${key}`),
    ]),
  );
  const consumers = Array.isArray(configuration.consumers)
    ? configuration.consumers.map((value, index) =>
        requiredString(value, `${node.id}.configuration.consumers.${index}`),
      )
    : [];
  return {
    deploymentNodeId: node.id,
    context: graph.metadata.identity.connection.cluster,
    namespace: requiredString(
      configuration.namespace,
      `${node.id}.configuration.namespace`,
    ),
    name: requiredString(
      configuration.name,
      `${node.id}.configuration.name`,
    ),
    values: valueContracts,
    consumers,
    deletionPolicy:
      node.lifecycle.deletion === "delete" ? "delete" : "retain",
    ...(namespaceHandles.length > 0
      ? {
          prerequisites: Output.all(
            ...namespaceHandles.map((handle) => Output.of(handle as never)),
          ) as never,
        }
      : {}),
  };
}

function generatedSecretValue(
  value: unknown,
  label: string,
): ApplicationGeneratedSecretValue {
  const contract = requiredObject(value, label);
  if (contract.kind === "publicLiteral") {
    return {
      kind: "publicLiteral",
      value: requiredString(contract.value, `${label}.value`),
    };
  }
  if (
    contract.kind === "random" &&
    contract.encoding === "base64url" &&
    typeof contract.bytes === "number" &&
    Number.isInteger(contract.bytes)
  ) {
    return {
      kind: "random",
      bytes: contract.bytes,
      encoding: "base64url",
    };
  }
  throw new Error(`${label} has an unsupported generated value contract.`);
}

function requiredObject(
  value: unknown,
  label: string,
): DeploymentJsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as DeploymentJsonObject;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}
