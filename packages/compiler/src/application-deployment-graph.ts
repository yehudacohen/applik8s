// typecast-file-boundary: This compiler validates authored manifests before
// translating them into the closed portable deployment graph.
import { createHash } from "node:crypto";
import { access, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { ApplicationGraph } from "@applik8s/core";
import {
  type ApplicationArtifactRequirement,
  type ApplicationGeneratedSecretRequirement,
  compileApplicationDeploymentGraph,
} from "@applik8s/deployment-compiler";
import {
  type ApplicationDeploymentGraph,
  type ApplicationDeploymentStrategy,
  type DeploymentJsonObject,
  digestApplicationDeploymentGraph,
  digestApplicationDeploymentValue,
  serializeApplicationDeploymentGraph,
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
  readonly profileTransition?: Readonly<Record<string, unknown>>;
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
  const installationSpec = jsonObject(request.installationSpec, "installation spec");
  const materialized = withInstallationRuntimeBindings(
    await applicationMaterializedComposition(
    request.bundlePath,
    request.graph.metadata.name,
    ),
    installationSpec,
    request.graph,
    request.profile,
  );
  const generatedSecrets = await applicationGeneratedSecretRequirements(
    request.bundlePath,
    request.graph.metadata.namespace,
    request.graph,
    request.installationSpec,
  );
  const profileTransition = request.profileTransition
    ? deploymentRelevantProfileTransition(
        jsonObject(request.profileTransition, "profile transition"),
      )
    : undefined;
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
    ...(profileTransition ? { profileTransition } : {}),
    artifacts,
    materializedComposition: {
      resources: materialized.resources,
      status: materialized.status,
    },
    clusterApiPrerequisites: materialized.clusterApiPrerequisites,
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

function withInstallationRuntimeBindings(
  materialized: {
    readonly resources: readonly DeploymentJsonObject[];
    readonly status: DeploymentJsonObject;
    readonly clusterApiPrerequisites: readonly DeploymentJsonObject[];
  },
  installationSpec: DeploymentJsonObject,
  graph: ApplicationGraph,
  profile: string,
): {
  readonly resources: readonly DeploymentJsonObject[];
  readonly status: DeploymentJsonObject;
  readonly clusterApiPrerequisites: readonly DeploymentJsonObject[];
} {
  const providers = optionalObject(installationSpec.providers);
  const payments = optionalObject(providers?.payments);
  const notifications = optionalObject(providers?.notifications);
  const paymentEnvironment: Array<
    DeploymentJsonObject & { readonly name: string }
  > = payments
      ? (() => {
          const secretName = stringValue(
            payments.secretName,
            "Application payments Secret name",
          );
          return [
            secretEnvironment(
              "APPLIK8S_PAYMENT_API_KEY",
              secretName,
              optionalString(payments.apiKeyKey) ?? "apiKey",
            ),
            secretEnvironment(
              "APPLIK8S_PAYMENT_WEBHOOK_SECRET",
              secretName,
              optionalString(payments.webhookSecretKey) ?? "webhookSecret",
            ),
          ];
        })()
      : [];
  const notificationEnvironment: Array<
    DeploymentJsonObject & { readonly name: string }
  > = notifications
      ? (() => {
          const secretName = stringValue(
            notifications.secretName,
            "Application notification Secret name",
          );
          const port = typeof notifications.port === "number"
            && Number.isSafeInteger(notifications.port)
            && notifications.port >= 1
            && notifications.port <= 65_535
            ? notifications.port
            : notifications.secure === true ? 465 : 587;
          return [
            {
              name: "APPLIK8S_NOTIFICATION_DELIVERY_KIND",
              value: "smtp",
            },
            {
              name: "APPLIK8S_NOTIFICATION_SMTP_HOST",
              value: stringValue(
                notifications.host,
                "Application notification SMTP host",
              ),
            },
            {
              name: "APPLIK8S_NOTIFICATION_SMTP_PORT",
              value: String(port),
            },
            {
              name: "APPLIK8S_NOTIFICATION_SMTP_SECURE",
              value: notifications.secure === true ? "true" : "false",
            },
            {
              name: "APPLIK8S_NOTIFICATION_SENDER_EMAIL",
              value: stringValue(
                notifications.senderEmail,
                "Application notification sender email",
              ),
            },
            ...(optionalString(notifications.senderName)
              ? [{
                  name: "APPLIK8S_NOTIFICATION_SENDER_NAME",
                  value: optionalString(notifications.senderName) as string,
                }]
              : []),
            secretEnvironment(
              "APPLIK8S_NOTIFICATION_SMTP_USERNAME",
              secretName,
              optionalString(notifications.usernameKey) ?? "username",
            ),
            secretEnvironment(
              "APPLIK8S_NOTIFICATION_SMTP_PASSWORD",
              secretName,
              optionalString(notifications.passwordKey) ?? "password",
            ),
          ];
        })()
      : [{ name: "APPLIK8S_NOTIFICATION_DELIVERY_KIND", value: "local" }];
  const paymentConsumers = providerConsumerWorkloads(graph, "PaymentProvider");
  const notificationConsumers = providerConsumerWorkloads(
    graph,
    "NotificationDelivery",
  );
  const consumers = new Set([...paymentConsumers, ...notificationConsumers]);
  if (consumers.size === 0) return materialized;
  const resources = materialized.resources.map((resource) => {
    const template = optionalObject(resource.template);
    if (!template || !isProviderConsumerDeployment(template, consumers)) {
      return resource;
    }
    const workloadName = stringValue(
      objectValue(template.metadata, "provider consumer Deployment metadata").name,
      "provider consumer Deployment name",
    );
    const environment: Array<
      DeploymentJsonObject & { readonly name: string }
    > = [
      { name: "APPLIK8S_PROFILE_VARIANT", value: profile },
      ...(paymentConsumers.has(workloadName) ? paymentEnvironment : []),
      ...(notificationConsumers.has(workloadName)
        ? notificationEnvironment
        : []),
    ];
    const spec = objectValue(template.spec, "payment consumer Deployment spec");
    const podTemplate = objectValue(
      spec.template,
      "payment consumer Deployment pod template",
    );
    const podSpec = objectValue(
      podTemplate.spec,
      "payment consumer Deployment pod spec",
    );
    const containers = arrayValue(podSpec.containers).map((value) => {
      const container = objectValue(
        value,
        "payment consumer Deployment container",
      );
      if (container.name !== "http" && container.name !== "runtime") {
        return container;
      }
      const existing = arrayValue(container.env).map((entry) =>
        objectValue(entry, "payment consumer environment entry"),
      );
      const names = new Set(
        existing.flatMap((entry) =>
          typeof entry.name === "string" ? [entry.name] : [],
        ),
      );
      return {
        ...container,
        env: [
          ...existing,
          ...environment.filter((entry) => !names.has(entry.name)),
        ],
      };
    });
    return {
      ...resource,
      template: {
        ...template,
        spec: {
          ...spec,
          template: {
            ...podTemplate,
            spec: {
              ...podSpec,
              containers,
            },
          },
        },
      },
    };
  });
  return { ...materialized, resources };
}

function providerConsumerWorkloads(
  graph: ApplicationGraph,
  providerInterface: string,
): ReadonlySet<string> {
  const providers = new Set(
    graph.nodes.flatMap((node) =>
      node.kind === "provider" && node.interface === providerInterface
        ? [node.id]
        : []),
  );
  const consumerIds = new Set(
    graph.edges.flatMap((edge) =>
      edge.relationship === "provides" && providers.has(edge.from.nodeId)
        ? [edge.to.nodeId]
        : []),
  );
  return new Set(
    graph.nodes.flatMap((node) => {
      if (!consumerIds.has(node.id)) return [];
      if (node.kind === "server") return [kubernetesName(node.name)];
      if (node.kind === "streamProcessor") {
        return [kubernetesName(`${graph.metadata.name}-${node.name}`)];
      }
      return [];
    }),
  );
}

function isProviderConsumerDeployment(
  resource: DeploymentJsonObject,
  consumers: ReadonlySet<string>,
): boolean {
  if (resource.apiVersion !== "apps/v1" || resource.kind !== "Deployment") {
    return false;
  }
  const metadata = optionalObject(resource.metadata);
  const labels = optionalObject(metadata?.labels);
  const component = labels?.["app.kubernetes.io/component"];
  const name = labels?.["app.kubernetes.io/name"];
  return typeof name === "string"
    && consumers.has(name)
    && (component === "typed-http" || component === "stream-processor");
}

function secretEnvironment(
  name: string,
  secretName: string,
  key: string,
): DeploymentJsonObject & { readonly name: string } {
  return {
    name,
    valueFrom: {
      secretKeyRef: {
        name: secretName,
        key,
      },
    },
  };
}

/**
 * Fresh and unchanged profile observations have no deployment effect. Keeping
 * their different mode labels in the portable graph makes identical desired
 * state hash differently after the first successful reconcile. Actual
 * transition entries and their acknowledgements remain part of plan identity.
 */
function deploymentRelevantProfileTransition(
  transition: DeploymentJsonObject,
): DeploymentJsonObject | undefined {
  return Array.isArray(transition.entries) && transition.entries.length === 0
    ? undefined
    : transition;
}

async function applicationGeneratedSecretRequirements(
  bundlePath: string,
  resolvedApplicationNamespace: string | undefined,
  graph: ApplicationGraph,
  installationSpec: Readonly<Record<string, unknown>>,
): Promise<readonly ApplicationGeneratedSecretRequirement[]> {
  const requirements: ApplicationGeneratedSecretRequirement[] = [];
  let applicationHostConsumer: string | undefined;
  const hostPath = join(
    dirname(bundlePath),
    "application-host",
    "application-host.json",
  );
  if (await exists(hostPath)) {
    const host = await readJson(hostPath);
    const metadata = objectValue(host.metadata, "ApplicationHost metadata");
    applicationHostConsumer = stringValue(
      metadata.name,
      "ApplicationHost metadata.name",
    );
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
    requirements.push({
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
        applicationHostConsumer,
      ],
    });
  }
  const mcpServers = graph.nodes.filter((node) => node.kind === "mcpServer");
  const agents = graph.nodes.filter((node) => node.kind === "aiAgent");
  if (mcpServers.length > 0 || agents.length > 0) {
    const namespace = stringValue(
      resolvedApplicationNamespace ?? graph.metadata.namespace ?? "default",
      "Application MCP namespace",
    );
    const gatewayConsumers = graph.nodes
      .filter(
        (node) =>
          node.kind === "gateway"
          && node.materialization === "generatedDeployment",
      )
      .map((node) => node.id);
    requirements.push({
      namespace,
      name: `${kubernetesName(graph.metadata.name)}-internal-operation`,
      values: {
        key: {
          kind: "random",
          bytes: 48,
          encoding: "base64url",
        },
      },
      consumers: [
        ...(agents.length > 0 && applicationHostConsumer
          ? [applicationHostConsumer]
          : []),
        ...mcpServers.map((server) => server.id),
        ...agents.map((agent) => agent.id),
        ...gatewayConsumers,
      ].sort(),
    });
  }
  return [
    ...requirements,
    ...hostEnvironmentSecretRequirements(
      installationSpec,
      resolvedApplicationNamespace ?? graph.metadata.namespace ?? "default",
      applicationHostConsumer,
    ),
  ];
}

/**
 * Any application-owned provider can explicitly choose operation-host
 * environment credentials. Only variable names enter the graph; values are
 * resolved while the Kubernetes provider reconciles stable Secret identities.
 * External installations remain externally owned and cannot select this path.
 */
function hostEnvironmentSecretRequirements(
  installationSpec: Readonly<Record<string, unknown>>,
  namespaceValue: unknown,
  applicationHostConsumer: string | undefined,
): readonly ApplicationGeneratedSecretRequirement[] {
  const providers = optionalObject(installationSpec.providers);
  if (!providers) return [];
  if (installationSpec.profile === "external") {
    for (const provider of [
      providers.inference,
      providers.payments,
      providers.notifications,
    ]) {
      const source = optionalObject(optionalObject(provider)?.credentialSource);
      if (source?.kind === "hostEnvironment") {
        throw new Error(
          "External Agentic providers cannot use hostEnvironment credentials because their Secret lifecycle is externally owned.",
        );
      }
    }
    return [];
  }
  const namespace = stringValue(
    namespaceValue,
    "application namespace",
  );
  const requirements: ApplicationGeneratedSecretRequirement[] = [];
  const inference = optionalObject(providers.inference);
  const inferenceSource = optionalObject(inference?.credentialSource);
  if (inference && inferenceSource?.kind === "hostEnvironment") {
    const name = stringValue(
      inference.credentialSecretName,
      "inference credential Secret name",
    );
    requirements.push({
      id: "agentic-managed.inference",
      namespace,
      name,
      referenceMode: "staticIdentity",
      values: {
        [optionalString(inference.credentialKey) ?? "apiKey"]: {
          kind: "hostEnvironment",
          name:
            optionalString(inferenceSource.variable)
            ?? "OPENROUTER_API_KEY",
        },
      },
      consumers: ["provider.AI.inference"],
    });
  }
  const payments = optionalObject(providers.payments);
  const paymentSource = optionalObject(payments?.credentialSource);
  if (payments && paymentSource?.kind === "hostEnvironment") {
    const name = stringValue(
      payments.secretName,
      "payments Secret name",
    );
    requirements.push({
      id: "agentic-managed.payments",
      namespace,
      name,
      referenceMode: "staticIdentity",
      values: {
        [optionalString(payments.apiKeyKey) ?? "apiKey"]: {
          kind: "hostEnvironment",
          name:
            optionalString(paymentSource.apiKeyVariable)
            ?? "STRIPE_SECRET_KEY",
        },
        [optionalString(payments.webhookSecretKey) ?? "webhookSecret"]: {
          kind: "hostEnvironment",
          name:
            optionalString(paymentSource.webhookSecretVariable)
            ?? "STRIPE_WEBHOOK_SECRET",
        },
      },
      consumers: [
        "provider.PaymentProvider.primary",
        ...(applicationHostConsumer ? [applicationHostConsumer] : []),
      ],
    });
  }
  const notifications = optionalObject(providers.notifications);
  const notificationSource = optionalObject(
    notifications?.credentialSource,
  );
  if (notifications && notificationSource?.kind === "hostEnvironment") {
    const name = stringValue(
      notifications.secretName,
      "notification Secret name",
    );
    requirements.push({
      id: "agentic-managed.notifications",
      namespace,
      name,
      referenceMode: "staticIdentity",
      values: {
        [optionalString(notifications.usernameKey) ?? "username"]: {
          kind: "hostEnvironment",
          name:
            optionalString(notificationSource.usernameVariable)
            ?? "SMTP_USERNAME",
        },
        [optionalString(notifications.passwordKey) ?? "password"]: {
          kind: "hostEnvironment",
          name:
            optionalString(notificationSource.passwordVariable)
            ?? "SMTP_PASSWORD",
        },
      },
      consumers: [
        "provider.NotificationDelivery.transactional",
        ...(applicationHostConsumer ? [applicationHostConsumer] : []),
      ],
    });
  }
  return requirements;
}

async function applicationMaterializedComposition(
  bundlePath: string,
  applicationName: string,
): Promise<{
  readonly resources: readonly DeploymentJsonObject[];
  readonly status: DeploymentJsonObject;
  readonly clusterApiPrerequisites: readonly DeploymentJsonObject[];
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
    clusterApiPrerequisites: applicationClusterApiPrerequisites(
      resourcesValue.map((value) =>
        objectValue(value, `${resourcesPath} resource`),
      ),
    ),
  };
}

function applicationClusterApiPrerequisites(
  resources: readonly DeploymentJsonObject[],
): readonly DeploymentJsonObject[] {
  const byName = new Map<
    string,
    { readonly manifest: DeploymentJsonObject; readonly digest: string }
  >();
  for (const resource of resources) {
    if (
      resource.apiVersion !== "apiextensions.k8s.io/v1" ||
      resource.kind !== "CustomResourceDefinition"
    ) {
      continue;
    }
    const metadata = objectValue(
      resource.metadata,
      "CustomResourceDefinition metadata",
    );
    const name = stringValue(
      metadata.name,
      "CustomResourceDefinition metadata.name",
    );
    // CRDs are cluster-scoped. TypeKro may serialize the same authored CRD
    // both as a top-level prerequisite and as a graph-template projection
    // carrying a meaningless schema-derived namespace. Normalize that field
    // away before identity/differential comparison.
    const normalizedMetadata = Object.fromEntries(
      Object.entries(metadata).filter(([key]) => key !== "namespace"),
    );
    const manifest: DeploymentJsonObject = {
      ...resource,
      metadata: normalizedMetadata,
    };
    const digest = digestApplicationDeploymentValue(manifest);
    const existing = byName.get(name);
    if (existing && existing.digest !== digest) {
      throw new Error(
        `Compiler artifacts contain divergent CustomResourceDefinition/${name} prerequisites.`,
      );
    }
    byName.set(name, existing ?? { manifest, digest });
  }
  return [...byName.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => value.manifest);
}

function kubernetesName(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "app";
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
    ["mcp", "mcp"],
    ["agents", "agent"],
    ["http", "http"],
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

function optionalObject(value: unknown): DeploymentJsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as DeploymentJsonObject
    : undefined;
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
