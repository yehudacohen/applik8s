// typecast-file-boundary: This compiler validates authored manifests before
// translating them into the closed portable deployment graph.
import { createHash } from "node:crypto";
import { access, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { ApplicationGraph } from "@applik8s/core";
import {
  compileApplicationDeploymentGraph,
  type ApplicationArtifactRequirement,
  type ApplicationGeneratedSecretRequirement,
} from "@applik8s/deployment-compiler";
import {
  digestApplicationDeploymentGraph,
  digestApplicationDeploymentValue,
  serializeApplicationDeploymentGraph,
  type ApplicationDeploymentGraph,
  type ApplicationDeploymentStrategy,
  type DeploymentJsonObject,
} from "@applik8s/deployment-contract";

export const applicationDeploymentCompilerVersion = "0.6.0";

export interface EmitApplicationDeploymentGraphRequest {
  readonly bundlePath: string;
  readonly projectRoot: string;
  readonly graph: ApplicationGraph;
  readonly sourceGraphDigest: string;
  readonly compilerVersion: string;
  readonly context: string;
  readonly controlPlaneNamespace: string;
  readonly instance: string;
  readonly profile: string;
  readonly strategy: ApplicationDeploymentStrategy;
  readonly installationSpec: Readonly<Record<string, unknown>>;
}

export interface EmittedApplicationDeploymentGraph {
  readonly path: string;
  readonly digest: string;
  readonly graph: ApplicationDeploymentGraph;
  readonly artifactCount: number;
}

/**
 * Shadow-emits the deployment IR beside current TypeKro artifacts.
 *
 * This function reads only compiler-produced artifacts and writes one
 * deterministic graph. It performs no build, provider, registry, Alchemy, or
 * Kubernetes effect.
 */
export async function emitApplicationDeploymentGraph(
  request: EmitApplicationDeploymentGraphRequest,
): Promise<EmittedApplicationDeploymentGraph> {
  const bundle = await readJson(request.bundlePath);
  const artifacts = await applicationArtifactRequirements(
    bundle,
    request.bundlePath,
    request.projectRoot,
  );
  const materializedComposition = await applicationMaterializedComposition(
    request.bundlePath,
    request.graph.metadata.name,
  );
  const generatedSecrets = await applicationGeneratedSecretRequirements(
    request.bundlePath,
    request.graph.metadata.namespace,
  );
  const installationSpec = jsonObject(request.installationSpec, "installation spec");
  const connectionDigest = digestApplicationDeploymentValue({
    provider: "kubernetes",
    context: request.context,
  });
  const result = compileApplicationDeploymentGraph({
    graph: request.graph,
    sourceGraphDigest: request.sourceGraphDigest,
    compilerVersion: request.compilerVersion,
    identity: {
      connection: {
        provider: "kubernetes",
        cluster: request.context,
        digest: connectionDigest,
      },
      application: request.graph.metadata.name,
      controlPlaneNamespace: request.controlPlaneNamespace,
      instance: request.instance,
      profile: request.profile,
    },
    strategy: request.strategy,
    installationSpec,
    artifacts,
    materializedComposition,
    generatedSecrets,
  });
  const path = join(dirname(request.bundlePath), "application-deployment-graph.json");
  await writeFile(path, serializeApplicationDeploymentGraph(result.graph));
  return {
    path,
    digest: digestApplicationDeploymentGraph(result.graph),
    graph: result.graph,
    artifactCount: artifacts.length,
  };
}

async function applicationGeneratedSecretRequirements(
  bundlePath: string,
  resolvedApplicationNamespace: string | undefined,
): Promise<readonly ApplicationGeneratedSecretRequirement[]> {
  const hostPath = join(
    dirname(bundlePath),
    "application-host",
    "application-host.json",
  );
  if (!(await exists(hostPath))) return [];
  const host = await readJson(hostPath);
  const metadata = objectValue(host.metadata, "ApplicationHost metadata");
  const spec = objectValue(host.spec, "ApplicationHost artifact spec");
  const cursor = objectValue(
    spec.cursorSecret,
    "ApplicationHost cursor Secret",
  );
  const authoredNamespace = stringValue(
    spec.namespace,
    "ApplicationHost namespace",
  );
  const namespace = authoredNamespace.includes("${")
    ? stringValue(
        resolvedApplicationNamespace,
        "resolved ApplicationHost namespace",
      )
    : authoredNamespace;
  return [
    {
      namespace,
      name: stringValue(cursor.name, "ApplicationHost cursor Secret name"),
      values: {
        [stringValue(cursor.key, "ApplicationHost cursor Secret key")]: {
          kind: "random",
          bytes: 48,
          encoding: "base64url",
        },
      },
      consumers: [
        stringValue(metadata.name, "ApplicationHost metadata.name"),
      ],
    },
  ];
}

async function applicationMaterializedComposition(
  bundlePath: string,
  applicationName: string,
): Promise<{
  readonly resources: readonly DeploymentJsonObject[];
  readonly status: DeploymentJsonObject;
}> {
  const resourcesPath = join(dirname(bundlePath), "resources.json");
  const resourcesValue: unknown = JSON.parse(await readFile(resourcesPath, "utf8"));
  if (!Array.isArray(resourcesValue)) {
    throw new Error(`${resourcesPath} must contain a resource array.`);
  }
  const definition = resourcesValue
    .map((value) => objectValue(value, `${resourcesPath} resource`))
    .find((resource) => {
      if (
        resource.apiVersion !== "kro.run/v1alpha1" ||
        resource.kind !== "ResourceGraphDefinition"
      ) {
        return false;
      }
      const metadata = objectValue(
        resource.metadata,
        "ResourceGraphDefinition metadata",
      );
      return metadata.name === applicationName;
    });
  if (!definition) {
    throw new Error(
      `Compiler artifacts do not contain ResourceGraphDefinition/${applicationName}.`,
    );
  }
  const spec = objectValue(
    definition.spec,
    `ResourceGraphDefinition/${applicationName} spec`,
  );
  const schema = objectValue(
    spec.schema,
    `ResourceGraphDefinition/${applicationName} schema`,
  );
  return {
    resources: arrayValue(spec.resources).map((resource) =>
      objectValue(
        resource,
        `ResourceGraphDefinition/${applicationName} graph resource`,
      ),
    ),
    status: objectValue(
      schema.status,
      `ResourceGraphDefinition/${applicationName} status`,
    ),
  };
}

async function applicationArtifactRequirements(
  bundle: DeploymentJsonObject,
  bundlePath: string,
  projectRoot: string,
): Promise<readonly ApplicationArtifactRequirement[]> {
  const spec = objectValue(bundle.spec, "TypeKro bundle spec");
  const artifacts: ApplicationArtifactRequirement[] = [];
  const operatorEntries = arrayValue(spec.operators);
  const operatorHost = operatorEntries.length > 0
    ? await frameworkOperatorHostArtifact(projectRoot)
    : undefined;
  if (operatorHost) artifacts.push(operatorHost);
  for (const operatorValue of operatorEntries) {
    const operator = objectValue(operatorValue, "operator bundle entry");
    const name = stringValue(operator.name, "operator name");
    const manifestPath = stringValue(operator.manifest, `${name} operator manifest`);
    const manifest = await readJson(
      await resolveArtifactPath(manifestPath, bundlePath, projectRoot),
    );
    const manifestSpec = objectValue(manifest.spec, `${name} operator manifest spec`);
    const bundleContract = objectValue(
      manifestSpec.bundle,
      `${name} operator bundle contract`,
    );
    const container = objectValue(
      manifestSpec.container,
      `${name} operator container contract`,
    );
    const build = objectValue(
      container.build,
      `${name} operator container build contract`,
    );
    const image = objectValue(
      container.image,
      `${name} operator image contract`,
    );
    artifacts.push({
      id: artifactId("operator", name),
      artifactType: "containerImage",
      name,
      sourceDigest: digestValue(
        bundleContract.buildIdentityDigest,
        `${name} operator build identity digest`,
      ),
      sourceDescriptor: {
        contextPath: stringValue(build.context, `${name} build context`),
        dockerfilePath: stringValue(build.dockerfile, `${name} Dockerfile`),
        logicalReference: `${stringValue(image.repository, `${name} image repository`)}:${stringValue(image.tag, `${name} image tag`)}`,
        ...(operatorHost ? { baseArtifactId: operatorHost.id } : {}),
      },
      logicalReference: `${stringValue(image.repository, `${name} image repository`)}:${stringValue(image.tag, `${name} image tag`)}`,
    });
  }
  for (const [collection, artifactClass] of [
    ["migrations", "migration"],
    ["processors", "processor"],
    ["workflows", "workflow"],
    ["reactive", "reactive"],
  ] as const) {
    for (const entryValue of arrayValue(spec[collection])) {
      const entry = objectValue(entryValue, `${collection} bundle entry`);
      const name = stringValue(entry.name, `${artifactClass} name`);
      const container = objectValue(
        entry.container,
        `${name} container contract`,
      );
      const sourceDigest = digestValue(
        container.sourceDigest ?? entry.digest,
        `${name} source digest`,
      );
      const logicalReference = stringValue(
        container.image,
        `${name} logical image`,
      );
      artifacts.push({
        id: artifactId(artifactClass, name),
        artifactType:
          artifactClass === "migration" ? "migration" : "containerImage",
        name,
        sourceDigest,
        sourceDescriptor: {
          contextPath: stringValue(
            container.contextPath,
            `${name} build context`,
          ),
          dockerfilePath: stringValue(
            container.dockerfilePath,
            `${name} Dockerfile`,
          ),
          baseImage: stringValue(container.baseImage, `${name} base image`),
          command: jsonArray(container.command, `${name} command`),
        },
        logicalReference,
      });
    }
  }
  const hostPath = join(dirname(bundlePath), "application-host", "application-host.json");
  if (await exists(hostPath)) {
    const host = await readJson(hostPath);
    const hostSpec = objectValue(host.spec, "ApplicationHost artifact spec");
    const logicalReference = stringValue(hostSpec.image, "ApplicationHost image");
    artifacts.push({
      id: artifactId("application-host", "web"),
      artifactType: "containerImage",
      name: "application-host",
      sourceDigest: digestValue(
        hostSpec.artifactDigest,
        "ApplicationHost artifact digest",
      ),
      sourceDescriptor: {
        contextPath: resolve(
          dirname(hostPath),
          optionalString(hostSpec.context) ?? ".",
        ),
        dockerfilePath: resolve(
          dirname(hostPath),
          optionalString(hostSpec.dockerfile) ?? "Dockerfile.applik8s-host",
        ),
      },
      logicalReference,
      semanticNodeId: "provider.application-host",
    });
  }
  const ids = new Set<string>();
  for (const artifact of artifacts) {
    if (ids.has(artifact.id)) {
      throw new Error(`Compiler artifacts produce duplicate deployment id ${artifact.id}.`);
    }
    ids.add(artifact.id);
  }
  return artifacts.sort((left, right) => left.id.localeCompare(right.id));
}

async function frameworkOperatorHostArtifact(
  projectRoot: string,
): Promise<ApplicationArtifactRequirement | undefined> {
  const sourceRoot = await findAncestorContaining(
    projectRoot,
    "Dockerfile.operator-host",
  );
  if (!sourceRoot) return undefined;
  const sourceDigest = await operatorHostSourceDigest(sourceRoot);
  return {
    id: "artifact.operator-host",
    artifactType: "generatedRuntime",
    name: "applik8s-operator-host",
    sourceDigest,
    sourceDescriptor: {
      contextPath: sourceRoot,
      dockerfilePath: resolve(sourceRoot, "Dockerfile.operator-host"),
      logicalReference: `applik8s-operator-host:sha-${sourceDigest.slice(7, 19)}`,
      buildTimeoutMs: 15 * 60_000,
    },
    logicalReference: `applik8s-operator-host:sha-${sourceDigest.slice(7, 19)}`,
  };
}

async function findAncestorContaining(
  startDirectory: string,
  file: string,
): Promise<string | undefined> {
  let current = resolve(startDirectory);
  while (true) {
    if (await exists(resolve(current, file))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

async function operatorHostSourceDigest(sourceRoot: string): Promise<string> {
  const rootFiles = ["Cargo.toml", "Cargo.lock", "Dockerfile.operator-host"];
  const crateFiles = (await readdir(resolve(sourceRoot, "crates"), {
    recursive: true,
  }))
    .filter((path) => /(?:\.rs|\.toml)$/.test(path))
    .map((path) => `crates/${path}`);
  const hash = createHash("sha256");
  for (const file of [...rootFiles, ...crateFiles].sort()) {
    hash.update(file);
    hash.update("\0");
    hash.update(await readFile(resolve(sourceRoot, file)));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

async function resolveArtifactPath(
  path: string,
  bundlePath: string,
  projectRoot: string,
): Promise<string> {
  const candidates = isAbsolute(path)
    ? [path]
    : [resolve(projectRoot, path), resolve(dirname(bundlePath), path)];
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  throw new Error(
    `Compiler artifact ${path} does not exist at ${candidates.join(" or ")}.`,
  );
}

async function readJson(path: string): Promise<DeploymentJsonObject> {
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  return jsonObject(value, path);
}

function jsonObject(value: unknown, label: string): DeploymentJsonObject {
  const normalized: unknown = JSON.parse(JSON.stringify(value));
  return objectValue(normalized, label);
}

function objectValue(value: unknown, label: string): DeploymentJsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as DeploymentJsonObject;
}

function arrayValue(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function jsonArray(value: unknown, label: string): readonly (
  | string
  | number
  | boolean
  | null
)[] {
  if (
    !Array.isArray(value) ||
    value.some(
      (entry) =>
        entry !== null &&
        typeof entry !== "string" &&
        typeof entry !== "number" &&
        typeof entry !== "boolean",
    )
  ) {
    throw new Error(`${label} must contain only JSON scalar values.`);
  }
  return value;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function digestValue(value: unknown, label: string): string {
  const digest = stringValue(value, label);
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) {
    throw new Error(`${label} must be a full sha256 digest.`);
  }
  return digest;
}

function artifactId(artifactClass: string, name: string): string {
  const normalized = `${artifactClass}.${name}`
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `artifact.${normalized}`;
}

async function exists(path: string): Promise<boolean> {
  return access(path)
    .then(() => true)
    .catch(() => false);
}
