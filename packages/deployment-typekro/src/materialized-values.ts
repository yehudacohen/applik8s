// typecast-file-boundary: Compiler-owned portable values are recursively translated into TypeKro expressions and artifact Outputs.
import type {
  ApplicationArtifactDeploymentNode,
  ApplicationDeploymentGraph,
  DeploymentJsonObject,
  DeploymentJsonValue,
} from "@applik8s/deployment-contract";
import {
  digestApplicationDeploymentValue,
  parseApplicationDeploymentOutputReference,
} from "@applik8s/deployment-contract";
import { artifactOutput } from "typekro/experimental/planning";
import type { ExpressionContext } from "./expression-reconstruction.js";
import { transformExpressionString } from "./expression-reconstruction.js";

const artifactSetDigestPlaceholder = "__APPLIK8S_ARTIFACT_SET_DIGEST__";

interface ArtifactSubstitution {
  readonly nodeId: string;
  readonly logicalReference: string;
  readonly repository: string;
}

export interface ArtifactSubstitutionIndex {
  readonly byLogicalReference: ReadonlyMap<string, ArtifactSubstitution>;
  readonly byRepository: ReadonlyMap<string, ArtifactSubstitution>;
  readonly byGeneratedSecretName: ReadonlyMap<string, string>;
}

export function artifactSubstitutionIndex(
  graph: ApplicationDeploymentGraph,
  deploymentNodeId?: string,
): ArtifactSubstitutionIndex {
  const requiredProducers = deploymentNodeId
    ? new Set(
        graph.edges
          .filter(
            (edge) =>
              edge.relationship === "requiresOutput" &&
              edge.to === deploymentNodeId,
          )
          .map((edge) => edge.from),
      )
    : undefined;
  const byLogicalReference = new Map<string, ArtifactSubstitution>();
  const byRepository = new Map<string, ArtifactSubstitution>();
  const byGeneratedSecretName = new Map<string, string>();
  for (const node of graph.nodes) {
    if (requiredProducers && !requiredProducers.has(node.id)) continue;
    if (
      node.kind === "externalProvider" &&
      node.provider.interface === "Secret" &&
      node.provider.implementation ===
        "alchemy-kubernetes-generated-secret" &&
      node.spec.resourceType === "kubernetesGeneratedSecret"
    ) {
      const configuration = node.spec.configuration;
      if (!isObject(configuration)) {
        throw new Error(
          `Generated Secret deployment node ${node.id} has no configuration.`,
        );
      }
      const name = requiredString(
        configuration.name,
        `${node.id}.configuration.name`,
      );
      const previous = byGeneratedSecretName.get(name);
      if (previous && previous !== node.id) {
        throw new Error(
          `Generated Secrets ${previous} and ${node.id} share name ${name}; generated Secret names must be unique within one application deployment.`,
        );
      }
      byGeneratedSecretName.set(name, node.id);
    }
    if (node.kind !== "artifact") continue;
    const logicalReference = optionalString(
      node.spec.sourceDescriptor.logicalReference,
    );
    if (!logicalReference) continue;
    const previous = byLogicalReference.get(logicalReference);
    if (previous) {
      throw new Error(
        `Deployment artifacts ${previous.nodeId} and ${node.id} share logical reference ${logicalReference}.`,
      );
    }
    const repository = ociRepository(logicalReference);
    const substitution = {
      nodeId: node.id,
      logicalReference,
      repository,
    };
    const repositoryOwner = byRepository.get(repository);
    if (repositoryOwner) {
      throw new Error(
        `Deployment artifacts ${repositoryOwner.nodeId} and ${node.id} share OCI repository ${repository}.`,
      );
    }
    byLogicalReference.set(logicalReference, substitution);
    byRepository.set(repository, substitution);
  }
  return { byLogicalReference, byRepository, byGeneratedSecretName };
}

export function transformMaterializedValue(
  value: DeploymentJsonValue,
  context: ExpressionContext,
  artifacts: ArtifactSubstitutionIndex,
  options: {
    readonly remoteArtifactBinding?: boolean;
    readonly pullSecretName?: unknown;
    readonly pullSecretResourceVersion?: unknown;
  } = {},
): unknown {
  if (typeof value === "string") {
    const deploymentOutput =
      parseApplicationDeploymentOutputReference(value);
    if (deploymentOutput) {
      if (
        deploymentOutput.optional
        && !context.graph.nodes.some(
          (node) => node.id === deploymentOutput.nodeId,
        )
      ) {
        return "";
      }
      return artifactOutput(
        deploymentOutput.nodeId,
        deploymentOutput.output,
      );
    }
    const generatedSecret = artifacts.byGeneratedSecretName.get(value);
    if (generatedSecret) {
      return artifactOutput(generatedSecret, "name");
    }
    const artifact =
      artifacts.byLogicalReference.get(value) ??
      materializedArtifactAlias(value, artifacts.byRepository);
    if (artifact) {
      return artifactOutput(artifact.nodeId, "immutableReference");
    }
    if (value === artifactSetDigestPlaceholder) {
      return deterministicArtifactSourceSetDigest(artifacts, context.graph);
    }
    return transformExpressionString(value, context);
  }
  if (Array.isArray(value)) {
    return value.map((entry) =>
      transformMaterializedValue(entry, context, artifacts, options),
    );
  }
  if (isObject(value)) {
    // A Job's pod template is immutable after creation. Content-addressed
    // migration Jobs already encode executable changes in their resource
    // name, so a mutable pull-Secret rollout annotation would make every
    // subsequent KRO reconciliation attempt an illegal Job update.
    const childOptions =
      value.kind === "Job"
        ? { ...options, pullSecretResourceVersion: undefined }
        : options;
    const transformed: Record<string, unknown> = Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        transformMaterializedValue(child, context, artifacts, childOptions),
      ]),
    );
    if (
      options.remoteArtifactBinding &&
      value.imagePullPolicy === "Never" &&
      artifactContainer(value, artifacts)
    ) {
      transformed.imagePullPolicy = "IfNotPresent";
    }
    if (
      options.pullSecretName !== undefined &&
      podSpecConsumesArtifact(value, artifacts)
    ) {
      if (
        transformed.imagePullSecrets !== undefined &&
        !Array.isArray(transformed.imagePullSecrets)
      ) {
        throw new Error(
          "Application artifact Pod spec imagePullSecrets must be an array.",
        );
      }
      transformed.imagePullSecrets = [
        ...((transformed.imagePullSecrets as readonly unknown[] | undefined) ??
          []),
        { name: options.pullSecretName },
      ];
    }
    if (
      options.pullSecretResourceVersion !== undefined &&
      isObject(value.metadata) &&
      isObject(value.spec) &&
      podSpecConsumesArtifact(value.spec, artifacts)
    ) {
      const metadata = isObject(transformed.metadata)
        ? transformed.metadata
        : {};
      const annotations = isObject(metadata.annotations)
        ? metadata.annotations
        : {};
      transformed.metadata = {
        ...metadata,
        annotations: {
          ...annotations,
          "applik8s.dev/registry-pull-secret-resource-version":
            options.pullSecretResourceVersion,
        },
      };
    }
    return transformed;
  }
  return value;
}

function podSpecConsumesArtifact(
  value: DeploymentJsonObject,
  artifacts: ArtifactSubstitutionIndex,
): boolean {
  const containers = [
    ...(Array.isArray(value.containers) ? value.containers : []),
    ...(Array.isArray(value.initContainers) ? value.initContainers : []),
  ];
  return containers.some(
    (container) => isObject(container) && artifactContainer(container, artifacts),
  );
}

function artifactContainer(
  value: DeploymentJsonObject,
  artifacts: ArtifactSubstitutionIndex,
): boolean {
  if (typeof value.image !== "string") return false;
  return Boolean(
    artifacts.byLogicalReference.get(value.image) ??
      materializedArtifactAlias(value.image, artifacts.byRepository),
  );
}

function deterministicArtifactSourceSetDigest(
  artifacts: ArtifactSubstitutionIndex,
  graph: ApplicationDeploymentGraph,
): string {
  const nodes = graph.nodes
    .filter(
      (node): node is ApplicationArtifactDeploymentNode =>
        node.kind === "artifact" &&
        [...artifacts.byLogicalReference.values()].some(
          (artifact) => artifact.nodeId === node.id,
        ),
    )
    .map((node) => ({
      id: node.id,
      configurationDigest: node.configurationDigest,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return digestApplicationDeploymentValue(nodes);
}

function materializedArtifactAlias(
  value: string,
  artifacts: ReadonlyMap<string, ArtifactSubstitution>,
): ArtifactSubstitution | undefined {
  if (!value.includes("@sha256:") && !ociTag(value)) return undefined;
  const materializedRepository = ociRepository(value);
  for (const [repository, artifact] of artifacts) {
    if (
      materializedRepository === repository ||
      materializedRepository.endsWith(`/${repository}`)
    ) {
      return artifact;
    }
  }
  return undefined;
}

function ociRepository(reference: string): string {
  const digest = reference.indexOf("@");
  const withoutDigest = digest >= 0 ? reference.slice(0, digest) : reference;
  const lastSlash = withoutDigest.lastIndexOf("/");
  const tag = withoutDigest.lastIndexOf(":");
  return tag > lastSlash ? withoutDigest.slice(0, tag) : withoutDigest;
}

function ociTag(reference: string): string | undefined {
  if (reference.includes("://")) return undefined;
  const lastSlash = reference.lastIndexOf("/");
  const tag = reference.lastIndexOf(":");
  return tag > lastSlash ? reference.slice(tag + 1) : undefined;
}

function requiredString(value: unknown, label: string): string {
  const text = optionalString(value);
  if (!text) throw new Error(`${label} must be a non-empty string.`);
  return text;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isObject(
  value: unknown,
): value is Record<string, DeploymentJsonValue> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
