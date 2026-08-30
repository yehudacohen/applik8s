// typecast-file-boundary: This compiler validates authored manifests before
// translating them into the closed portable deployment graph.
import { createHash } from "node:crypto";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  type ApplicationGraph,
  type ApplicationImplementationPlan,
  serializeApplicationPlan,
} from "@applik8s/core";
import {
  type ApplicationArtifactRequirement,
  type ApplicationCelldRuntimeRelease,
  type ApplicationGeneratedSecretRequirement,
  type ApplicationKubernetesRuntimeAccessNetworkPolicyProvider,
  applicationCelldRuntimeManifest,
  applicationCelldRuntimeRelease,
  applicationProviderGuaranteesForGraph,
  clickStackCredentialsSecretName,
  compileApplicationDeploymentGraph,
  compileApplicationPlan,
} from "@applik8s/deployment-compiler";
import {
  type ApplicationDeploymentGraph,
  type ApplicationDeploymentStrategy,
  applicationDeploymentOutputReference,
  type DeploymentJsonObject,
  digestApplicationDeploymentGraph,
  digestApplicationDeploymentValue,
  serializeApplicationDeploymentGraph,
} from "@applik8s/deployment-contract";
import { build } from "esbuild";

const celldRuntimeArtifactId = "artifact.celld-runtime";
const celldRuntimeBuildImage =
  "node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2";

export const applicationDeploymentCompilerVersion = "0.8.0";

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
  /** v0.9 concrete recursive provider resolution, when discovered by the application compiler. */
  readonly implementationPlan?: ApplicationImplementationPlan;
  readonly runtimeAccessKubernetesNetworkPolicyProvider?: ApplicationKubernetesRuntimeAccessNetworkPolicyProvider;
  /** @internal Release qualification may compile an earlier immutable Celld runtime. */
  readonly celldRuntimeRelease?: ApplicationCelldRuntimeRelease;
}

export interface EmittedApplicationDeploymentGraph {
  readonly path: string;
  readonly digest: string;
  readonly graph: ApplicationDeploymentGraph;
  readonly artifactCount: number;
  readonly applicationPlanPath: string;
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
  const artifacts = await applicationArtifactRequirements(
    bundle,
    request.bundlePath,
    request.projectRoot,
    request.graph,
    request.sourceGraphDigest,
    request.celldRuntimeRelease ?? applicationCelldRuntimeRelease,
    materialized.resources,
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
    workspaceRoot: request.projectRoot,
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
    ...(request.runtimeAccessKubernetesNetworkPolicyProvider
      ? { runtimeAccessKubernetesNetworkPolicyProvider: request.runtimeAccessKubernetesNetworkPolicyProvider }
      : {}),
  });
  const path = join(dirname(request.bundlePath), "application-deployment-graph.json");
  await writeFile(path, serializeApplicationDeploymentGraph(result.graph));
  const applicationPlanPath = join(dirname(request.bundlePath), "application-plan.json");
  await writeFile(applicationPlanPath, serializeApplicationPlan(compileApplicationPlan({
    graph: request.graph,
    deployment: result.graph,
    target: "kubernetes",
    lifecycleAuthority: "alchemy",
    generatedAt: new Date(0).toISOString(),
    workspaceRoot: request.projectRoot,
    providerGuarantees: applicationProviderGuaranteesForGraph({
      graph: request.graph,
      target: 'kubernetes',
      profile: request.profile,
    }),
    ...(request.implementationPlan ? { implementationPlan: request.implementationPlan } : {}),
  })));
  return {
    path,
    digest: digestApplicationDeploymentGraph(result.graph),
    graph: result.graph,
    artifactCount: artifacts.length,
    applicationPlanPath,
  };
}

export function withInstallationRuntimeBindings(
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
  const inference = optionalObject(providers?.inference);
  const notifications = optionalObject(providers?.notifications);
  const inferenceEnvironment: Array<
    DeploymentJsonObject & { readonly name: string }
  > = inference
      ? [secretEnvironment(
          "APPLIK8S_AI_GATEWAY_API_KEY",
          stringValue(
            inference.credentialSecretName,
            "Application inference credential Secret name",
          ),
          optionalString(inference.credentialKey) ?? "apiKey",
        )]
      : [];
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
  const inferenceConsumers = providerConsumerWorkloads(graph, "AI");
  const notificationConsumers = providerConsumerWorkloads(
    graph,
    "NotificationDelivery",
  );
  const profiledProviderIds = new Set(
    graph.nodes.flatMap((node) =>
      node.kind === "provider"
      && optionalString(optionalObject(node.config?.profile)?.selectedBy) !== undefined
        ? [node.id]
        : []
    ),
  );
  const profiledConsumers = applicationProviderConsumerWorkloads(
    graph,
    profiledProviderIds,
  );
  const observability = graph.nodes.find((node): node is Extract<ApplicationGraph["nodes"][number], { readonly kind: "provider" }> =>
    node.kind === "provider"
    && node.interface === "Observability"
    && kubernetesProviderImplementation(node) === "clickstack");
  const externalObservability = graph.nodes.find((node): node is Extract<ApplicationGraph["nodes"][number], { readonly kind: "provider" }> =>
    node.kind === "provider"
    && node.interface === "Observability"
    && kubernetesProviderImplementation(node) === "otlp");
  const externalObservabilityConfig = externalObservability
    ? optionalObject(externalObservability.config?.observability) ?? optionalObject(externalObservability.config)
    : undefined;
  const externalObservabilityAuthentication = optionalObject(externalObservabilityConfig?.authentication);
  const externalObservabilityAuthenticationSecret = optionalObject(externalObservabilityAuthentication?.secret);
  const externalObservabilityTls = optionalObject(externalObservabilityConfig?.tls);
  const externalObservabilityCaSecret = optionalObject(externalObservabilityTls?.certificateAuthority);
  const runtimeNamespace = graph.metadata.namespace ?? graph.metadata.name;
  assertPodSecretNamespace(externalObservabilityAuthenticationSecret, runtimeNamespace, "External OTLP authentication");
  assertPodSecretNamespace(externalObservabilityCaSecret, runtimeNamespace, "External OTLP custom CA");
  const actorRuntime = graph.nodes.find((node): node is Extract<ApplicationGraph["nodes"][number], { readonly kind: "provider" }> =>
    node.kind === "provider"
    && node.interface === "ActorRuntime"
    && kubernetesProviderImplementation(node) === "celld-actors");
  const actorQueryGatewayWorkloads = new Set(
    graph.nodes.flatMap((node) => {
      if (node.kind !== "gateway" || !node.deployment) return [];
      const usesActors = node.queries.some((reference) => {
        const query = graph.nodes.find((candidate) => candidate.id === reference.nodeId);
        return query?.kind === "query" && (query.actorBindings?.length ?? 0) > 0;
      });
      return usesActors
        ? [kubernetesName(`${graph.metadata.name}-${node.name}`)]
        : [];
    }),
  );
  const universalEnvironment: Array<DeploymentJsonObject & { readonly name: string }> = [
    ...(observability ? [
      {
        name: "OTEL_EXPORTER_OTLP_ENDPOINT",
        value: applicationDeploymentOutputReference(
          `direct.${observability.id}.clickstack`,
          "otlpHttpEndpoint",
        ),
      },
      {
        name: "APPLIK8S_OTLP_HEADER_NAME",
        value: "authorization",
      },
      secretEnvironment(
        "APPLIK8S_OTLP_HEADER_VALUE",
        clickStackCredentialsSecretName(graph.metadata.name),
        "hyperdx-api-key",
      ),
    ] : []),
    ...(externalObservabilityConfig ? [
      {
        name: "OTEL_EXPORTER_OTLP_ENDPOINT",
        value: stringValue(externalObservabilityConfig.endpoint, "External OTLP endpoint"),
      },
      {
        name: "APPLIK8S_OTLP_SIGNALS",
        value: Array.isArray(externalObservabilityConfig.signals)
          ? externalObservabilityConfig.signals.map((signal) => String(signal)).join(",")
          : "traces,metrics,logs",
      },
      ...(externalObservabilityAuthentication && externalObservabilityAuthenticationSecret
        ? [
            {
              name: "APPLIK8S_OTLP_HEADER_NAME",
              value: stringValue(externalObservabilityAuthentication.header, "External OTLP authentication header"),
            },
            secretEnvironment(
              "APPLIK8S_OTLP_HEADER_VALUE",
              stringValue(externalObservabilityAuthenticationSecret.name, "External OTLP authentication Secret name"),
              stringValue(externalObservabilityAuthentication.key, "External OTLP authentication Secret key"),
            ),
          ]
        : []),
      ...(externalObservabilityTls?.trust === "custom-ca" && externalObservabilityCaSecret
        ? [
            secretEnvironment(
              "APPLIK8S_OTLP_CA_PEM",
              stringValue(externalObservabilityCaSecret.name, "External OTLP CA Secret name"),
              stringValue(externalObservabilityTls.key, "External OTLP CA Secret key"),
            ),
            ...(typeof externalObservabilityTls.serverName === "string"
              ? [{ name: "APPLIK8S_OTLP_SERVER_NAME", value: externalObservabilityTls.serverName }]
              : []),
          ]
        : []),
    ] : []),
  ];
  const routedResources = withPublishedActorIngressRoutes(
    materialized.resources,
    graph,
    actorRuntime,
  );
  const resources = routedResources.map((resource) => {
    const template = optionalObject(resource.template);
    if (!template || !isApplicationRuntimeDeployment(template)) {
      return resource;
    }
    const workloadName = optionalString(
      objectValue(
        template.metadata,
        "provider consumer Deployment metadata",
      ).name,
    ) ?? (applicationRuntimeComponent(template) === "application-host"
      ? applicationHostWorkloadName(graph)
      : undefined);
    if (!workloadName) return resource;
    const component = applicationRuntimeComponent(template);
    const actorRuntimeId = actorRuntime?.id;
    const deploymentConsumesActorRuntime = Boolean(
      actorRuntimeId
      && (component === "application-host"
        || (component === "query-gateway"
          && (actorQueryGatewayWorkloads.has(workloadName)
            || deploymentEnvironmentHas(template, "APPLIK8S_ACTOR_RUNTIME_REQUIRED")))),
    );
    const actorEnvironment: Array<
      DeploymentJsonObject & { readonly name: string }
    > = deploymentConsumesActorRuntime
      ? [
          {
            name: "APPLIK8S_ACTOR_ENDPOINT",
            value: applicationDeploymentOutputReference(
              `direct.${actorRuntimeId}.celld`,
              "endpoint",
            ),
          },
          secretEnvironment(
            "APPLIK8S_ACTOR_AUTHORIZATION",
            `${kubernetesName(graph.metadata.name)}-actors-authorization`,
            "actor-authorization",
          ),
          ...(component === "application-host"
            ? [secretEnvironment(
                "APPLIK8S_ACTOR_CONNECTION_SIGNING_KEY",
                `${kubernetesName(graph.metadata.name)}-actors-authorization`,
                "connection-signing-key",
              )]
            : []),
        ]
      : [];
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
      const containerName = optionalString(container.name);
      const consumes = (consumers: ReadonlySet<string>) =>
        consumers.has(workloadName)
        || (containerName !== undefined && consumers.has(containerName));
      const providerConsumer = consumes(profiledConsumers)
        || consumes(inferenceConsumers)
        || consumes(paymentConsumers)
        || consumes(notificationConsumers);
      if (
        container.name !== "application"
        && container.name !== "agent"
        && container.name !== "http"
        && container.name !== "runtime"
        && container.name !== "worker"
        && component !== "query-gateway"
        && !providerConsumer
      ) {
        return container;
      }
      const existing = arrayValue(container.env).map((entry) =>
        objectValue(entry, "payment consumer environment entry"),
      );
      const environment: Array<
        DeploymentJsonObject & { readonly name: string }
      > = [
        ...universalEnvironment,
        ...(consumes(profiledConsumers)
          || consumes(inferenceConsumers)
          || consumes(paymentConsumers)
          || consumes(notificationConsumers)
          ? [{ name: "APPLIK8S_PROFILE_VARIANT", value: profile }]
          : []),
        // The canonical ApplicationHost is the public Celld callback and
        // WebSocket façade. Typed HTTP route workers do not invoke actors merely
        // because the application declares one, so projecting actor credentials
        // into every route server would widen their authority unnecessarily.
        ...(component === "application-host" ? actorEnvironment : []),
        ...(consumes(inferenceConsumers) ? inferenceEnvironment : []),
        ...(consumes(paymentConsumers) ? paymentEnvironment : []),
        ...(consumes(notificationConsumers) ? notificationEnvironment : []),
      ];
      const containerNeedsActorRuntime = Boolean(
        actorRuntime
        && component === "query-gateway"
        && existing.some((entry) => entry.name === "APPLIK8S_ACTOR_RUNTIME_REQUIRED"),
      );
      const projectedEnvironment = [
        ...environment,
        ...(containerNeedsActorRuntime ? actorEnvironment : []),
      ];
      const projectedNames = new Set(projectedEnvironment.map(({ name }) => name));
      return {
        ...container,
        env: [
          ...existing.filter((entry) =>
            typeof entry.name !== "string" || !projectedNames.has(entry.name)
          ),
          ...projectedEnvironment,
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

export function withPublishedActorIngressRoutes(
  resources: readonly DeploymentJsonObject[],
  graph: ApplicationGraph,
  actorRuntime: Extract<ApplicationGraph["nodes"][number], { readonly kind: "provider" }> | undefined,
): readonly DeploymentJsonObject[] {
  const hasPublishedRealtimeActor = graph.nodes.some((node) =>
    node.kind === "actor"
    && node.publication?.boundary === "entrypoint-export"
    && node.definition.requirements.realtimeConnections
  );
  if (!hasPublishedRealtimeActor) return resources;
  if (!actorRuntime) {
    throw new Error("Published realtime actors require a Kubernetes Celld ActorRuntime provider.");
  }
  const ingressNames = new Set(graph.nodes.flatMap((node) =>
    node.kind === "exposure" && node.transport.kind === "ingress"
      ? node.generatedResources?.flatMap((generated) =>
          generated.resource?.kind === "Ingress" ? [generated.resource.name] : []
        ) ?? []
      : []
  ));
  if (ingressNames.size === 0) {
    throw new Error(
      "Published realtime actors require an Ingress-backed app.expose(...) boundary; NodePort exposure cannot safely multiplex the actor WebSocket protocol.",
    );
  }
  const actorConfig = optionalObject(actorRuntime.config?.actorRuntime) ?? {};
  const actorNamespace = optionalString(actorConfig.namespace) ?? graph.metadata.namespace;
  const actorServiceName = `${kubernetesName(graph.metadata.name)}-actors`;
  let routed = 0;
  const output = resources.map((resource) => {
    const template = optionalObject(resource.template);
    if (template?.apiVersion !== "networking.k8s.io/v1" || template.kind !== "Ingress") return resource;
    const metadata = optionalObject(template.metadata);
    if (!metadata || typeof metadata.name !== "string" || !ingressNames.has(metadata.name)) return resource;
    const ingressNamespace = optionalString(metadata.namespace) ?? graph.metadata.namespace;
    if (ingressNamespace !== actorNamespace) {
      throw new Error(
        `Published realtime actor Ingress/${metadata.name} is in ${ingressNamespace}, but its Celld Service is in ${actorNamespace}. Kubernetes Ingress backends cannot cross namespaces.`,
      );
    }
    const spec = objectValue(template.spec, `Ingress/${metadata.name} spec`);
    const rules: DeploymentJsonObject[] = arrayValue(spec.rules).map((candidate) => {
      const rule = objectValue(candidate, `Ingress/${metadata.name} rule`);
      const http = objectValue(rule.http, `Ingress/${metadata.name} HTTP rule`);
      const paths = arrayValue(http.paths).map((path) =>
        objectValue(path, `Ingress/${metadata.name} HTTP path`)
      );
      const actorPath = {
        path: "/__applik8s/v1/actors",
        pathType: "Prefix",
        backend: { service: { name: actorServiceName, port: { number: 8080 } } },
      } satisfies DeploymentJsonObject;
      return {
        ...rule,
        http: {
          ...http,
          paths: [
            actorPath,
            ...paths.filter((path) => optionalObject(path)?.path !== actorPath.path),
          ],
        },
      } satisfies DeploymentJsonObject;
    });
    routed += 1;
    return {
      ...resource,
      template: { ...template, spec: { ...spec, rules } },
    } satisfies DeploymentJsonObject;
  });
  if (routed === 0) {
    throw new Error("Published realtime actor exposure was declared, but its generated Ingress was absent from the materialized application composition.");
  }
  return output;
}

function kubernetesProviderImplementation(
  node: Extract<ApplicationGraph["nodes"][number], { readonly kind: "provider" }>,
): string {
  if (node.implementation === "target-selected") {
    return node.interface === "ActorRuntime"
      ? "celld-actors"
      : node.interface === "Scheduler"
        ? "kubernetes-cronjob-scheduler"
        : node.implementation;
  }
  if (node.implementation !== "application-target-provider-selection") {
    return node.implementation;
  }
  const targetSelection = optionalObject(node.config?.targetSelection);
  const targets = optionalObject(targetSelection?.targets);
  const kubernetes = optionalObject(targets?.kubernetes);
  return optionalString(kubernetes?.implementation) ?? node.implementation;
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
  return applicationProviderConsumerWorkloads(graph, providers);
}

/** @internal Exact generated workloads that consume any named provider. */
export function applicationProviderConsumerWorkloads(
  graph: ApplicationGraph,
  providers: ReadonlySet<string>,
): ReadonlySet<string> {
  const consumerIds = new Set(
    graph.edges.flatMap((edge) =>
      edge.relationship === "provides" && providers.has(edge.from.nodeId)
        ? [edge.to.nodeId]
        : []),
  );
  const applicationHostName = applicationHostWorkloadName(graph);
  const scheduleControlName = graph.nodes.some((node) => node.kind === "schedule")
    ? kubernetesName(`${graph.metadata.name}-schedule-control`)
    : undefined;
  return new Set(
    graph.nodes.flatMap((node) => {
      if (!consumerIds.has(node.id)) return [];
      if (node.kind === "server") return [kubernetesName(node.name)];
      if (node.kind === "streamProcessor") {
        return [kubernetesName(`${graph.metadata.name}-${node.name}`)];
      }
      if (node.kind === "aiAgent") return [kubernetesName(node.name)];
      if (node.kind === "taskHandler") {
        return graph.nodes.flatMap((candidate) =>
          candidate.kind === "workflowWorker"
          && candidate.handlers.some(({ nodeId }) => nodeId === node.id)
            ? [kubernetesName(candidate.name)]
            : []
        );
      }
      if (node.kind === "actor" && applicationHostName) {
        return [applicationHostName];
      }
      if (node.kind === "schedule" && scheduleControlName) {
        const scheduler = graph.nodes.find(
          (candidate) => candidate.id === node.scheduler.nodeId,
        );
        return scheduler?.kind === "provider"
          && (scheduler.implementation !== "target-selected"
            || !scheduler.config?.qualification)
          ? [scheduleControlName]
          : [];
      }
      return [];
    }),
  );
}

function applicationHostWorkloadName(
  graph: ApplicationGraph,
): string | undefined {
  const applicationHost = graph.nodes.find(
    (node) => node.kind === "provider" && node.interface === "ApplicationHost",
  );
  if (applicationHost?.kind !== "provider") return undefined;
  const config = optionalObject(applicationHost.config?.host);
  return kubernetesName(
    optionalString(config?.name) ?? `${graph.metadata.name}-web`,
  );
}

function isApplicationRuntimeDeployment(resource: DeploymentJsonObject): boolean {
  if (resource.apiVersion !== "apps/v1" || resource.kind !== "Deployment") return false;
  const metadata = optionalObject(resource.metadata);
  const labels = optionalObject(metadata?.labels);
  const component = labels?.["app.kubernetes.io/component"];
  return component === "typed-http"
    || component === "application-host"
    || component === "query-gateway"
    || component === "schedule-control"
    || component === "command-processor"
    || component === "lakehouse-publisher"
    || component === "stream-processor"
    || component === "workflow-worker"
    || component === "reactive-worker"
    || component === "reactive-runtime"
    || component === "ai-agent"
    || component === "agent-runtime"
    || component === "mcp-server"
    || component === "mcp-runtime";
}

function applicationRuntimeComponent(resource: DeploymentJsonObject): unknown {
  const metadata = optionalObject(resource.metadata);
  return optionalObject(metadata?.labels)?.["app.kubernetes.io/component"];
}

function deploymentEnvironmentHas(
  resource: DeploymentJsonObject,
  name: string,
): boolean {
  const template = optionalObject(resource.spec);
  const podTemplate = optionalObject(template?.template);
  const podSpec = optionalObject(podTemplate?.spec);
  const containers = Array.isArray(podSpec?.containers)
    ? podSpec.containers
    : [];
  return containers.some((candidate) => {
    const container = optionalObject(candidate);
    const environment = Array.isArray(container?.env) ? container.env : [];
    return environment.some((entry) => optionalString(optionalObject(entry)?.name) === name);
  });
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

function assertPodSecretNamespace(
  reference: DeploymentJsonObject | undefined,
  runtimeNamespace: string,
  subject: string,
): void {
  if (!reference || reference.namespace === undefined) return;
  const namespace = stringValue(reference.namespace, `${subject} Secret namespace`);
  if (namespace !== runtimeNamespace) {
    throw new Error(`${subject} Secret ${namespace}/${String(reference.name ?? "<unknown>")} cannot be mounted by runtime workloads in namespace ${runtimeNamespace}. Kubernetes Secret environment references are namespace-scoped; copy or generate the Secret in the application namespace.`);
  }
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

export async function applicationGeneratedSecretRequirements(
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
  const lakehousePublishers = graph.nodes.filter((node) => node.kind === "lakehousePublication");
  if (lakehousePublishers.length > 0) {
    requirements.push({
      namespace: stringValue(
        resolvedApplicationNamespace ?? graph.metadata.namespace ?? "default",
        "Lakehouse publisher namespace",
      ),
      name: `${kubernetesName(graph.metadata.name)}-lakehouse-cursor`,
      values: {
        key: { kind: "random", bytes: 48, encoding: "base64url" },
      },
      consumers: lakehousePublishers.map(({ id }) => id).sort(),
    });
  }
  const internalCallbacks = graph.nodes.filter((node) =>
    node.kind === "schedule"
    || node.kind === "actor"
    || node.kind === "workflowWorker");
  const workflowGatewayServers = graph.nodes.filter((node) =>
    node.kind === "server"
    && Array.isArray(node.routes)
    && node.routes.some((route) =>
      (route.functionNative?.workflowBindings?.length ?? 0) > 0));
  if (
    mcpServers.length > 0
    || agents.length > 0
    || internalCallbacks.length > 0
    || workflowGatewayServers.length > 0
  ) {
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
        ...internalCallbacks.map((node) => node.id),
        ...workflowGatewayServers.map((server) => server.id),
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
  graph: ApplicationGraph,
  sourceGraphDigest: string,
  celldRuntimeRelease: ApplicationCelldRuntimeRelease,
  materializedResources: readonly DeploymentJsonObject[],
): Promise<readonly ApplicationArtifactRequirement[]> {
  const spec = objectValue(bundle.spec, "TypeKro bundle spec");
  const artifacts: ApplicationArtifactRequirement[] = [];
  if (applicationRequiresCelldArtifact(graph)) {
    artifacts.push(await celldActorRuntimeArtifact(
      bundlePath,
      graph.metadata.name,
      sourceGraphDigest,
      celldRuntimeRelease,
    ));
  }
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
      ...artifactSemanticPlacement(graph, graph.nodes.find((node) =>
        node.kind === "operator"
        && (node.id === name || node.id.endsWith(`.${name}`) || kubernetesName(node.name) === name))?.id),
    });
  }
  for (const [collection, artifactClass] of [
    ["migrations", "migration"],
    ["processors", "processor"],
    ["lakehousePublishers", "lakehouse-publisher"],
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
      const semanticNodeId = optionalString(entry.nodeId) ?? optionalString(entry.serverId);
      const explicitExecutionNodeIds = optionalStringArray(
        entry.executionNodeIds,
        `${name} executionNodeIds`,
      );
      const credentialProjections = applicationArtifactCredentialProjections(entry, name);
      const kubernetesPermissions = applicationArtifactKubernetesPermissions(entry, name);
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
        ...(credentialProjections.length > 0 ? { credentialProjections } : {}),
        ...(kubernetesPermissions.length > 0 ? { kubernetesPermissions } : {}),
        ...(explicitExecutionNodeIds
          ? {
              ...(semanticNodeId ? { semanticNodeId } : {}),
              executionNodeIds: explicitExecutionNodeIds,
            }
          : artifactSemanticPlacement(graph, semanticNodeId, optionalString(entry.kind))),
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
      executionNodeIds: applicationHostExecutionNodeIds(graph),
      credentialProjections: applicationHostCredentialProjections(hostSpec),
    });
  }
  const ids = new Set<string>();
  for (const artifact of artifacts) {
    if (ids.has(artifact.id)) {
      throw new Error(`Compiler artifacts produce duplicate deployment id ${artifact.id}.`);
    }
    ids.add(artifact.id);
  }
  return artifacts
    .map((artifact) => {
      const hasExecutionPlacement = (artifact.executionNodeIds?.length ?? 0) > 0
        || artifact.semanticNodeId !== undefined;
      const physicalProjection = artifact.logicalReference && hasExecutionPlacement
        ? applicationWorkloadCredentialProjections(
            materializedResources,
            artifact.logicalReference,
          )
        : { matched: false, projections: [] };
      // Once an immutable artifact has a concrete workload placement, that
      // pod is the complete Kubernetes credential projection contract. The
      // emitter-level projections may still contain installation/profile CEL
      // from the reusable RGD and must not survive alongside their concrete
      // replacements as a second authority requirement.
      const credentialProjections = physicalProjection.matched
        ? physicalProjection.projections
        : mergeArtifactCredentialProjections(artifact.credentialProjections ?? []);
      return credentialProjections.length > 0
        ? { ...artifact, credentialProjections }
        : artifact;
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * Promote the compiler-authored pod projection into the portable artifact
 * contract before deployment planning. This is intentionally done here—not
 * by the target parity validator—because installation/profile lowering can
 * add exact provider credentials after an emitter has produced its bundle
 * entry. The artifact remains the policy source; the later Kubernetes check
 * independently proves that materialization matches it.
 */
function applicationWorkloadCredentialProjections(
  resources: readonly DeploymentJsonObject[],
  image: string,
): {
  readonly matched: boolean;
  readonly projections: NonNullable<ApplicationArtifactRequirement['credentialProjections']>;
} {
  const projections: Array<NonNullable<ApplicationArtifactRequirement['credentialProjections']>[number]> = [];
  let matched = false;
  for (const candidate of resources) {
    const resource = optionalObject(candidate.template) ?? candidate;
    const metadata = optionalObject(resource.metadata);
    const namespace = optionalString(metadata?.namespace);
    if (!namespace) continue;
    const spec = optionalObject(resource.spec);
    const podTemplate = resource.kind === 'CronJob'
      ? optionalObject(optionalObject(optionalObject(optionalObject(spec?.jobTemplate)?.spec)?.template)?.spec)
      : optionalObject(optionalObject(spec?.template)?.spec);
    if (!podTemplate) continue;
    const containers = [
      ...arrayValue(podTemplate.containers),
      ...arrayValue(podTemplate.initContainers),
    ].map((value) => optionalObject(value)).filter((value): value is DeploymentJsonObject => Boolean(value));
    if (!containers.some((container) => container.image === image)) continue;
    matched = true;
    for (const container of containers) {
      for (const value of arrayValue(container.env)) {
        const entry = optionalObject(value);
        const secret = optionalObject(optionalObject(entry?.valueFrom)?.secretKeyRef);
        const name = optionalString(secret?.name);
        const key = optionalString(secret?.key);
        if (name && key) projections.push({ target: 'kubernetes', namespace, name, keys: [key] });
      }
      for (const value of arrayValue(container.envFrom)) {
        const name = optionalString(optionalObject(optionalObject(value)?.secretRef)?.name);
        if (name) projections.push({ target: 'kubernetes', namespace, name, keys: [] });
      }
    }
    for (const value of arrayValue(podTemplate.volumes)) {
      const volume = optionalObject(value);
      const secret = optionalObject(volume?.secret);
      const directName = optionalString(secret?.secretName);
      if (directName) {
        const keys = arrayValue(secret?.items).flatMap((item) => {
          const key = optionalString(optionalObject(item)?.key);
          return key ? [key] : [];
        });
        projections.push({ target: 'kubernetes', namespace, name: directName, keys });
      }
      const projected = optionalObject(volume?.projected);
      for (const source of arrayValue(projected?.sources)) {
        const projectedSecret = optionalObject(optionalObject(source)?.secret);
        const name = optionalString(projectedSecret?.name);
        if (!name) continue;
        const keys = arrayValue(projectedSecret?.items).flatMap((item) => {
          const key = optionalString(optionalObject(item)?.key);
          return key ? [key] : [];
        });
        projections.push({ target: 'kubernetes', namespace, name, keys });
      }
    }
  }
  return { matched, projections: mergeArtifactCredentialProjections(projections) };
}

function mergeArtifactCredentialProjections(
  projections: NonNullable<ApplicationArtifactRequirement['credentialProjections']>,
): NonNullable<ApplicationArtifactRequirement['credentialProjections']> {
  const merged = new Map<string, { namespace: string; name: string; keys: Set<string>; wildcard: boolean }>();
  for (const projection of projections) {
    const identity = `${projection.namespace}/${projection.name}`;
    const current = merged.get(identity) ?? {
      namespace: projection.namespace,
      name: projection.name,
      keys: new Set<string>(),
      wildcard: false,
    };
    if (projection.keys.length === 0) current.wildcard = true;
    for (const key of projection.keys) current.keys.add(key);
    merged.set(identity, current);
  }
  return [...merged.values()]
    .sort((left, right) => `${left.namespace}/${left.name}`.localeCompare(`${right.namespace}/${right.name}`))
    .map(({ namespace, name, keys, wildcard }) => ({
      target: 'kubernetes' as const,
      namespace,
      name,
      keys: wildcard ? [] : [...keys].sort(),
    }));
}

function applicationArtifactCredentialProjections(
  entry: DeploymentJsonObject,
  artifactName: string,
): NonNullable<ApplicationArtifactRequirement['credentialProjections']> {
  return arrayValue(entry.credentialProjections).map((candidate, index) => {
    const projection = objectValue(
      candidate,
      `${artifactName} credential projection ${index}`,
    );
    if (projection.target !== 'kubernetes') {
      throw new Error(`${artifactName} credential projection ${index} must target Kubernetes.`);
    }
    return {
      target: 'kubernetes' as const,
      namespace: stringValue(projection.namespace, `${artifactName} credential projection namespace`),
      name: stringValue(projection.name, `${artifactName} credential projection name`),
      keys: optionalStringArray(projection.keys, `${artifactName} credential projection keys`) ?? [],
    };
  });
}

function applicationArtifactKubernetesPermissions(
  entry: DeploymentJsonObject,
  artifactName: string,
): NonNullable<ApplicationArtifactRequirement['kubernetesPermissions']> {
  return arrayValue(entry.kubernetesPermissions).map((candidate, index) => {
    const permission = objectValue(
      candidate,
      `${artifactName} Kubernetes permission ${index}`,
    );
    const scope = stringValue(permission.scope, `${artifactName} Kubernetes permission scope`);
    if (scope !== 'Namespaced' && scope !== 'Cluster') {
      throw new Error(`${artifactName} Kubernetes permission ${index} has invalid scope ${JSON.stringify(scope)}.`);
    }
    const namespace = optionalString(permission.namespace);
    return {
      apiGroup: stringValue(permission.apiGroup, `${artifactName} Kubernetes permission apiGroup`),
      resource: stringValue(permission.resource, `${artifactName} Kubernetes permission resource`),
      scope,
      ...(namespace ? { namespace } : {}),
      verbs: optionalStringArray(permission.verbs, `${artifactName} Kubernetes permission verbs`) ?? [],
    };
  });
}

function applicationHostCredentialProjections(
  hostSpec: DeploymentJsonObject,
): NonNullable<ApplicationArtifactRequirement["credentialProjections"]> {
  return arrayValue(hostSpec.credentialProjections).map((candidate, index) => {
    const projection = objectValue(
      candidate,
      `ApplicationHost credential projection ${index}`,
    );
    if (projection.target !== "kubernetes") {
      throw new Error(
        `ApplicationHost credential projection ${index} uses unsupported target ${JSON.stringify(projection.target)}.`,
      );
    }
    return {
      target: "kubernetes" as const,
      namespace: stringValue(
        projection.namespace,
        `ApplicationHost credential projection ${index} namespace`,
      ),
      name: stringValue(
        projection.name,
        `ApplicationHost credential projection ${index} name`,
      ),
      keys: optionalStringArray(
        projection.keys,
        `ApplicationHost credential projection ${index} keys`,
      ) ?? [],
    };
  });
}

export function applicationHostExecutionNodeIds(graph: ApplicationGraph): readonly string[] {
  const members = new Set<string>();
  for (const node of graph.nodes) {
    if (
      node.kind !== "gateway"
      || node.visibility === "internal"
      || (node.materialization !== "generatedDeployment" && node.materialization !== "runtimeOnly")
    ) continue;
    // ApplicationHost owns the browser-facing transport façade. A generated
    // gateway still owns and executes its query/subscription children; those
    // closures must not be attributed to the forwarding web process.
    members.add(node.id);
  }
  return [...members].sort();
}

function artifactSemanticPlacement(
  graph: ApplicationGraph,
  semanticNodeId: string | undefined,
  artifactKind?: string,
): Pick<ApplicationArtifactRequirement, "semanticNodeId" | "executionNodeIds"> | Record<string, never> {
  if (artifactKind === "scheduleControlWorker") {
    const executionNodeIds = graph.nodes
      .filter((node) => node.kind === "schedule")
      .map(({ id }) => id)
      .sort();
    return executionNodeIds.length > 0 ? { executionNodeIds } : {};
  }
  if (!semanticNodeId) return {};
  const node = graph.nodes.find(({ id }) => id === semanticNodeId);
  if (!node) return { semanticNodeId, executionNodeIds: [semanticNodeId] };
  const members = new Set<string>([semanticNodeId]);
  if (node.kind === "processor" || node.kind === "workflowWorker") {
    for (const handler of node.handlers) members.add(handler.nodeId);
  } else if (node.kind === "gateway") {
    for (const query of node.queries) members.add(query.nodeId);
    for (const subscription of node.subscriptions) members.add(subscription.nodeId);
  }
  return { semanticNodeId, executionNodeIds: [...members].sort() };
}

function applicationRequiresCelldArtifact(graph: ApplicationGraph): boolean {
  return graph.nodes.some((node) =>
    node.kind === "provider"
    && node.interface === "ActorRuntime"
    && ["celld-actors", "target-selected", "application-target-provider-selection"].includes(node.implementation));
}

async function celldActorRuntimeArtifact(
  bundlePath: string,
  graphName: string,
  sourceGraphDigest: string,
  celldRuntimeRelease: ApplicationCelldRuntimeRelease,
): Promise<ApplicationArtifactRequirement> {
  const contextPath = join(dirname(bundlePath), "celld-runtime", "container");
  await mkdir(contextPath, { recursive: true });
  const workerPath = join(contextPath, "worker.mjs");
  const runtimeManifest = applicationCelldRuntimeManifest(sourceGraphDigest, celldRuntimeRelease);
  await build({
    entryPoints: ["@applik8s/runtime-celld/worker"],
    outfile: workerPath,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    sourcemap: false,
    legalComments: "none",
    define: {
      __APPLIK8S_CELLD_RUNTIME_MANIFEST__: JSON.stringify(JSON.stringify(runtimeManifest)),
    },
  });
  const wrangler = `${JSON.stringify({
    name: "applik8s-actor-authority",
    main: "worker.mjs",
    compatibility_date: "2026-08-01",
    durable_objects: {
      bindings: [{ name: "APPLIK8S_ACTOR_CELLS", class_name: "Applik8sActorCell" }],
    },
    migrations: [{ tag: "v1", new_sqlite_classes: ["Applik8sActorCell"] }],
  }, null, 2)}\n`;
  const dockerfile = [
    `FROM ${celldRuntimeBuildImage} AS esbuild`,
    "RUN npm install --global --ignore-scripts=false esbuild@0.28.1",
    `FROM ${celldRuntimeRelease.image}`,
    "WORKDIR /app",
    "COPY --from=esbuild --chmod=0555 /usr/local/lib/node_modules/esbuild/bin/esbuild /usr/local/bin/esbuild",
    "COPY worker.mjs wrangler.jsonc runtime-artifact.json /app/",
    "USER 65532:65532",
    "",
  ].join("\n");
  await writeFile(join(contextPath, "wrangler.jsonc"), wrangler);
  const runtimeManifestJson = `${JSON.stringify(runtimeManifest, null, 2)}\n`;
  await writeFile(join(contextPath, "runtime-artifact.json"), runtimeManifestJson);
  await writeFile(join(contextPath, "Dockerfile"), dockerfile);
  await writeFile(join(contextPath, ".dockerignore"), "*\n!worker.mjs\n!wrangler.jsonc\n!runtime-artifact.json\n!Dockerfile\n!.dockerignore\n");
  const worker = await readFile(workerPath);
  const sourceDigest = `sha256:${createHash("sha256")
    .update(worker)
    .update("\0")
    .update(wrangler)
    .update("\0")
    .update(runtimeManifestJson)
    .update("\0")
    .update(dockerfile)
    .digest("hex")}`;
  const imageName = `applik8s/${kubernetesName(graphName)}-celld-runtime`;
  const logicalReference = `${imageName}:sha-${sourceDigest.slice(7, 19)}`;
  return {
    id: celldRuntimeArtifactId,
    artifactType: "generatedRuntime",
    name: "celld-actor-runtime",
    sourceDigest,
    sourceDescriptor: {
      contextPath,
      dockerfilePath: join(contextPath, "Dockerfile"),
      baseImage: celldRuntimeRelease.image,
      protocol: "applik8s.actorAuthority/v1alpha1",
      runtimeManifest: {
        apiVersion: runtimeManifest.apiVersion,
        manifestDigest: runtimeManifest.manifestDigest,
        workerVersion: runtimeManifest.workerVersion,
        celldVersion: runtimeManifest.celldVersion,
        applicationGraphDigest: runtimeManifest.applicationGraphDigest,
        protocolRevision: runtimeManifest.protocolRevision,
      },
    },
    logicalReference,
  };
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

function optionalStringArray(value: unknown, label: string): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value)
    || value.some((entry) => typeof entry !== "string" || !entry.trim())
    || new Set(value).size !== value.length
  ) {
    throw new Error(`${label} must contain unique non-empty strings.`);
  }
  return [...value].sort();
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
