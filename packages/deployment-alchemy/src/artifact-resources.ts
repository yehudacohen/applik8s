import { isAbsolute, relative, resolve } from "node:path";
import type {
  ApplicationArtifactDeploymentNode,
  ApplicationDeploymentGraph,
} from "@applik8s/deployment-contract";
import type {
  ApplicationHarborProjectAttributes,
} from "@applik8s/deployment-provider-harbor";
import type {
  ApplicationContainerArtifactAttributes,
  ApplicationContainerArtifactProps,
  ApplicationContainerArtifactRegistry,
} from "@applik8s/deployment-provider-oci";

const DEFAULT_APPLICATION_ARTIFACT_BUILD_TIMEOUT_MS = 15 * 60_000;

export function artifactPrerequisites(
  graph: ApplicationDeploymentGraph,
  artifactId: string,
  harbor: ReadonlyMap<string, ApplicationHarborProjectAttributes>,
  artifacts: ReadonlyMap<string, ApplicationContainerArtifactAttributes>,
): readonly unknown[] {
  return graph.edges
    .filter(
      (edge) =>
        edge.to === artifactId &&
        ((edge.relationship === "requiresReady" &&
          harbor.has(edge.from)) ||
          (edge.relationship === "requiresOutput" &&
            artifacts.has(edge.from))),
    )
    .map(
      (edge) =>
        harbor.get(edge.from)?.ready ??
        artifacts.get(edge.from)?.immutableReference,
    )
    .filter((value) => value !== undefined);
}

export function artifactNodes(
  graph: ApplicationDeploymentGraph,
): readonly ApplicationArtifactDeploymentNode[] {
  const nodes = graph.nodes.filter(
    (node): node is ApplicationArtifactDeploymentNode =>
      node.kind === "artifact",
  );
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const pending = new Set(nodes.map((node) => node.id));
  const ordered: ApplicationArtifactDeploymentNode[] = [];
  while (pending.size > 0) {
    const ready = [...pending]
      .filter((id) => {
        const base = byId.get(id)?.spec.sourceDescriptor.baseArtifactId;
        return typeof base !== "string" || !base.trim() || !pending.has(base);
      })
      .sort();
    if (ready.length === 0) {
      throw new Error(
        `Artifact dependency cycle: ${[...pending].sort().join(", ")}.`,
      );
    }
    for (const id of ready) {
      const node = byId.get(id);
      if (!node) continue;
      ordered.push(node);
      pending.delete(id);
    }
  }
  return ordered;
}

export function artifactBaseId(
  node: ApplicationArtifactDeploymentNode,
): string | undefined {
  return optionalDescriptorString(node.spec.sourceDescriptor.baseArtifactId);
}

export function artifactProps(
  node: ApplicationArtifactDeploymentNode,
  registry: ApplicationContainerArtifactRegistry | undefined,
  resolvedBaseImage?: string,
): ApplicationContainerArtifactProps {
  if (!registry) {
    throw new Error(`Artifact ${node.id} has no registry configuration.`);
  }
  if (node.spec.artifactType === "wasmComponent") {
    throw new Error(
      `Artifact ${node.id} is a standalone WASM component; the container artifact provider cannot materialize it.`,
    );
  }
  const descriptor = node.spec.sourceDescriptor;
  const context = requiredDescriptorString(
    descriptor.contextPath,
    node.id,
    "contextPath",
  );
  const imageName = requiredDescriptorString(
    descriptor.name,
    node.id,
    "name",
  );
  const dockerfile = optionalDescriptorString(descriptor.dockerfilePath);
  const baseImage =
    resolvedBaseImage ?? optionalDescriptorString(descriptor.baseImage);
  const timeout =
    optionalNumber(descriptor.buildTimeoutMs) ??
    DEFAULT_APPLICATION_ARTIFACT_BUILD_TIMEOUT_MS;
  return {
    deploymentNodeId: node.id,
    sourceDigest: requiredDescriptorString(
      descriptor.sourceDigest,
      node.id,
      "sourceDigest",
    ),
    context,
    imageName,
    tag: `sha-${node.configurationDigest.slice(7, 19)}`,
    existingTagPolicy: "adopt",
    registry,
    ...(dockerfile
      ? { dockerfile: contextRelativeDockerfile(context, dockerfile, node.id) }
      : {}),
    ...(baseImage
      ? { buildArgs: { APPLIK8S_BASE_IMAGE: baseImage } }
      : {}),
    timeout,
  };
}

function contextRelativeDockerfile(
  context: string,
  dockerfile: string,
  nodeId: string,
): string {
  const contextPath = resolve(context);
  const dockerfilePath = isAbsolute(dockerfile)
    ? dockerfile
    : resolve(dockerfile);
  const candidate = relative(contextPath, dockerfilePath);
  if (
    isAbsolute(dockerfile) ||
    (!candidate.startsWith("..") && !isAbsolute(candidate))
  ) {
    if (candidate.startsWith("..") || isAbsolute(candidate)) {
      throw new Error(
        `Artifact ${nodeId} Dockerfile ${dockerfile} is outside build context ${context}.`,
      );
    }
    return candidate || "Dockerfile";
  }
  // A basename such as Dockerfile.applik8s-runtime is already relative to the
  // declared context; resolving it against the process cwd would be incorrect.
  return dockerfile;
}

function requiredDescriptorString(
  value: unknown,
  nodeId: string,
  field: string,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Artifact ${nodeId} is missing ${field}.`);
  }
  return value;
}

function optionalDescriptorString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
