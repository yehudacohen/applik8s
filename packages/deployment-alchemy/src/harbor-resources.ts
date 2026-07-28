// typecast-file-boundary: Portable deployment JSON is validated at this provider adapter boundary.
import type {
  ApplicationDeploymentGraph,
  ApplicationExternalProviderDeploymentNode,
  DeploymentJsonObject,
} from "@applik8s/deployment-contract";
import type {
  ApplicationHarborProjectProps,
} from "@applik8s/deployment-provider-harbor";
import type {
  ApplicationContainerArtifactRegistry,
} from "@applik8s/deployment-provider-oci";

export function harborProjectNodes(
  graph: ApplicationDeploymentGraph,
): readonly ApplicationExternalProviderDeploymentNode[] {
  return graph.nodes
    .filter(isHarborProjectNode)
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function isHarborProjectNode(
  node: ApplicationDeploymentGraph["nodes"][number],
): node is ApplicationExternalProviderDeploymentNode {
  return (
    node.kind === "externalProvider" &&
    node.provider.interface === "ContainerRegistry" &&
    node.provider.implementation === "typekro-harbor-project" &&
    node.spec.resourceType === "harborProject"
  );
}

export function harborProjectProps(
  node: ApplicationExternalProviderDeploymentNode,
  graph: ApplicationDeploymentGraph,
  registry: ApplicationContainerArtifactRegistry | undefined,
): ApplicationHarborProjectProps {
  if (registry?.type !== "harbor") {
    throw new Error(
      `Deployment node ${node.id} requires a Harbor artifact registry binding.`,
    );
  }
  const configuration = requiredObject(
    node.spec.configuration,
    `${node.id}.configuration`,
  );
  const management = requiredObject(
    configuration.management,
    `${node.id}.configuration.management`,
  );
  const adminCredentials = requiredObject(
    management.adminCredentials,
    `${node.id}.configuration.management.adminCredentials`,
  );
  const projectLifecycle = optionalObject(management.projectLifecycle);
  const policy = {
    ...(optionalNumber(management.storageLimitBytes) !== undefined
      ? { storageLimitBytes: optionalNumber(management.storageLimitBytes) }
      : {}),
    ...(typeof management.autoScan === "boolean"
      ? { autoScan: management.autoScan }
      : {}),
    ...(typeof management.autoSbomGeneration === "boolean"
      ? { autoSbomGeneration: management.autoSbomGeneration }
      : {}),
    ...(optionalObject(management.immutableTags)
      ? { immutableTags: management.immutableTags }
      : {}),
    ...(optionalObject(management.retention)
      ? { retention: management.retention }
      : {}),
  };
  const secretNamespace = requiredString(
    management.secretNamespace,
    `${node.id}.configuration.management.secretNamespace`,
  );
  const push = requiredObject(
    configuration.pushCredentials,
    `${node.id}.configuration.pushCredentials`,
  );
  const pull = requiredObject(
    configuration.pullSecret,
    `${node.id}.configuration.pullSecret`,
  );
  const deletionTimeoutMs = optionalNumber(projectLifecycle?.timeoutMs);
  return {
    deploymentNodeId: node.id,
    context: graph.metadata.identity.connection.cluster,
    endpoint: registry.registry,
    project: registry.project,
    adminCredentials: harborCredentialReference(adminCredentials, node.id),
    secretNamespace,
    // typecast: fields are selected from the closed Harbor policy contract.
    policy: policy as ApplicationHarborProjectProps["policy"],
    robots: [
      {
        name: optionalString(management.pushRobotName) ?? "applik8s-push",
        secretName: requiredString(
          push.name,
          `${node.id}.configuration.pushCredentials.name`,
        ),
        access: "push",
        registry: registry.registry,
      },
      {
        name: optionalString(management.pullRobotName) ?? "applik8s-pull",
        secretName: requiredString(
          pull.name,
          `${node.id}.configuration.pullSecret.name`,
        ),
        access: "pull",
        registry: registry.deploymentRegistry ?? registry.registry,
      },
    ],
    allowPlainHttp:
      registry.tls?.plainHttp === true || registry.registry.startsWith("http://"),
    insecure: registry.tls?.insecure === true,
    ...(registry.tls?.caFile ? { caFile: registry.tls.caFile } : {}),
    deletionPolicy:
      projectLifecycle?.deletionPolicy === "delete" ? "delete" : "retain",
    purgeRepositories: projectLifecycle?.purgeRepositories === true,
    ...(deletionTimeoutMs ? { deletionTimeoutMs } : {}),
  };
}

function harborCredentialReference(
  value: DeploymentJsonObject,
  nodeId: string,
): ApplicationHarborProjectProps["adminCredentials"] {
  const username = optionalString(value.username);
  const usernameKey = optionalString(value.usernameKey);
  const passwordKey = optionalString(value.passwordKey);
  const dockerConfigJsonKey = optionalString(value.dockerConfigJsonKey);
  return {
    apiVersion: "v1",
    kind: "Secret",
    namespace: requiredString(
      value.namespace,
      `${nodeId}.configuration.management.adminCredentials.namespace`,
    ),
    name: requiredString(
      value.name,
      `${nodeId}.configuration.management.adminCredentials.name`,
    ),
    ...(username ? { username } : {}),
    ...(usernameKey ? { usernameKey } : {}),
    ...(passwordKey ? { passwordKey } : {}),
    ...(dockerConfigJsonKey ? { dockerConfigJsonKey } : {}),
  };
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

function optionalObject(value: unknown): DeploymentJsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as DeploymentJsonObject)
    : undefined;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
