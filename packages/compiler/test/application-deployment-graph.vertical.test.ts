// typecast-file-boundary: Test fixtures preserve literal discriminants while
// exercising compiler shadow emission without loading the compiler's
// worker-backed bundling entrypoints into Bun's test process.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ApplicationGraph } from "@applik8s/core";
import {
  type ApplicationCelldRuntimeRelease,
  applicationCelldRuntimeRelease,
} from '@applik8s/deployment-compiler';
import {
  digestApplicationDeploymentGraph,
  validateApplicationDeploymentGraph,
} from "@applik8s/deployment-contract";
import { afterEach, describe, expect, it } from "vitest";

import {
  applicationGeneratedSecretRequirements,
  applicationHostExecutionNodeIds,
  applicationProviderConsumerWorkloads,
  emitApplicationDeploymentGraph,
  withInstallationRuntimeBindings,
  withPublishedActorIngressRoutes,
} from "../src/application-deployment-graph.js";

const temporaryDirectories: string[] = [];
const artifactDigest = `sha256:${"a".repeat(64)}`;
const sourceGraphDigest = `sha256:${"b".repeat(64)}`;
const historicalCelldRuntimeRelease = {
  image: 'ghcr.io/denoland/celld@sha256:7a4380721b6400073f2a26afe70a828410169f658d31b5ef61383e648ca0c530',
  version: 'sha256:7a4380721b6400073f2a26afe70a828410169f658d31b5ef61383e648ca0c530',
} as const satisfies ApplicationCelldRuntimeRelease;

afterEach(async () => {
  for (const path of temporaryDirectories.splice(0)) {
    await rm(path, { recursive: true, force: true });
  }
});

describe("compiler deployment graph emission", () => {
  it("concretizes selected inference credentials before runtime-access parity", () => {
    const graph = {
      ...applicationGraph(),
      metadata: { name: "inference-app", namespace: "inference-system" },
      nodes: [
        {
          id: "provider.AI.inference",
          kind: "provider",
          interface: "AI",
          implementation: "application-provider-selection",
        },
        {
          id: "aiAgent.assistant",
          kind: "aiAgent",
          name: "assistant",
        },
      ],
      edges: [{
        from: { nodeId: "provider.AI.inference" },
        to: { nodeId: "aiAgent.assistant" },
        relationship: "provides",
      }],
    } as unknown as ApplicationGraph;
    const deployment = generatedDeployment(
      "assistantAgent",
      "assistant",
      "ai-agent",
      "agent",
      "immutable",
      [{
        name: "APPLIK8S_AI_GATEWAY_API_KEY",
        valueFrom: {
          secretKeyRef: {
            name: "${schema.spec.providers.inference.credentialSecretName}",
            key: "${schema.spec.providers.inference.credentialKey}",
          },
        },
      }],
    );

    const bound = withInstallationRuntimeBindings(
      {
        resources: [deployment],
        status: {},
        clusterApiPrerequisites: [],
      } as unknown as Parameters<typeof withInstallationRuntimeBindings>[0],
      {
        providers: {
          inference: {
            credentialSecretName: "inference-app-credentials",
            credentialKey: "apiKey",
          },
        },
      },
      graph,
      "developer",
    );

    const environment = deploymentEnvironment(bound.resources, "assistant");
    expect(environment).toEqual(expect.arrayContaining([{
      name: "APPLIK8S_AI_GATEWAY_API_KEY",
      valueFrom: {
        secretKeyRef: {
          name: "inference-app-credentials",
          key: "apiKey",
        },
      },
    }]));
    expect(JSON.stringify(environment)).not.toContain("schema.spec.providers");
  });

  it("projects actor credentials only into actor-backed containers in a consolidated query gateway", () => {
    const graph = {
      ...applicationGraph(),
      metadata: { name: "actor-query", namespace: "actor-query" },
      nodes: [{
        id: "provider.ActorRuntime",
        kind: "provider",
        interface: "ActorRuntime",
        implementation: "celld-actors",
      }],
    } as unknown as ApplicationGraph;
    const deployment = generatedDeployment(
      "actorQueryGateway",
      "actor-query-gateways-envelope",
      "query-gateway",
      "actor-query",
      "immutable",
      [{ name: "APPLIK8S_ACTOR_RUNTIME_REQUIRED", value: "true" }],
    );
    const template = deployment.template;
    const podSpec = template.spec.template.spec;
    const materialized = {
      resources: [{
        ...deployment,
        template: {
          ...template,
          spec: {
            ...template.spec,
            template: {
              ...template.spec.template,
              spec: {
                ...podSpec,
                containers: [
                  ...podSpec.containers,
                  { name: "ordinary-query", image: "immutable", env: [] },
                ],
              },
            },
          },
        },
      }],
      status: {},
      clusterApiPrerequisites: [],
    };

    const bound = withInstallationRuntimeBindings(
      materialized as unknown as Parameters<typeof withInstallationRuntimeBindings>[0],
      {},
      graph,
      "test",
    );
    const boundResource = bound.resources[0] as unknown as {
      readonly template: {
        readonly spec: {
          readonly template: {
            readonly spec: {
              readonly containers: readonly Record<string, unknown>[];
            };
          };
        };
      };
    };
    const containers = boundResource.template.spec.template.spec.containers;
    const environment = (name: string) => Reflect.get(
      containers.find((container) => container.name === name)!,
      "env",
    ) as readonly Record<string, unknown>[];

    expect(environment("actor-query")).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "APPLIK8S_ACTOR_ENDPOINT" }),
      expect.objectContaining({ name: "APPLIK8S_ACTOR_AUTHORIZATION" }),
    ]));
    expect(environment("ordinary-query")).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "APPLIK8S_ACTOR_ENDPOINT" }),
    ]));
  });

  it('attributes only public gateway facades to ApplicationHost', () => {
    const graph = {
      ...applicationGraph(),
      nodes: [
        { id: 'provider.application-host', kind: 'provider', interface: 'ApplicationHost', implementation: 'managed-application-host' },
        {
          id: 'gateway.web', kind: 'gateway', name: 'web', visibility: 'public',
          materialization: 'generatedDeployment', queries: [{ nodeId: 'query.documents' }], subscriptions: [{ nodeId: 'subscription.documents' }],
        },
        {
          id: 'gateway.tools', kind: 'gateway', name: 'tools', visibility: 'internal',
          materialization: 'generatedDeployment', queries: [{ nodeId: 'query.tools' }], subscriptions: [],
        },
      ],
    } as unknown as ApplicationGraph;

    expect(applicationHostExecutionNodeIds(graph)).toEqual(['gateway.web']);
  });

  it("maps callable provider use to the exact generated execution workloads", () => {
    const provider = "provider.acquisition-provider.v1alpha1.primary";
    const graph = {
      ...applicationGraph(),
      metadata: { name: "placement", namespace: "placement" },
      nodes: [
        {
          id: "provider.ApplicationHost",
          kind: "provider",
          interface: "ApplicationHost",
          config: { host: { name: "placement-app" } },
        },
        {
          id: "provider.Scheduler",
          kind: "provider",
          interface: "Scheduler",
          config: {},
        },
        {
          id: "provider.Scheduler.qualified",
          kind: "provider",
          interface: "Scheduler",
          config: { qualification: { name: "external" } },
        },
        { id: provider, kind: "provider", interface: "AcquisitionProvider" },
        { id: "server.public", kind: "server", name: "public" },
        { id: "streamProcessor.events", kind: "streamProcessor", name: "events" },
        {
          id: "workflowWorker.jobs",
          kind: "workflowWorker",
          name: "jobs",
          handlers: [{ nodeId: "taskHandler.acquire" }],
        },
        { id: "taskHandler.acquire", kind: "taskHandler", name: "acquire" },
        { id: "aiAgent.researcher", kind: "aiAgent", name: "researcher" },
        { id: "aiAgent.unrelated", kind: "aiAgent", name: "unrelated" },
        { id: "actor.workspace", kind: "actor", name: "workspace" },
        {
          id: "schedule.local",
          kind: "schedule",
          name: "local",
          scheduler: { nodeId: "provider.Scheduler" },
        },
        {
          id: "schedule.external",
          kind: "schedule",
          name: "external",
          scheduler: { nodeId: "provider.Scheduler.qualified" },
        },
      ],
      edges: [
        "server.public",
        "streamProcessor.events",
        "taskHandler.acquire",
        "aiAgent.researcher",
        "actor.workspace",
        "schedule.local",
        "schedule.external",
      ].map((nodeId) => ({
        from: { nodeId: provider },
        to: { nodeId },
        relationship: "provides" as const,
      })),
    } as unknown as ApplicationGraph;

    expect([
      ...applicationProviderConsumerWorkloads(graph, new Set([provider])),
    ].sort()).toEqual([
      "jobs",
      "placement-app",
      "placement-events",
      "placement-schedule-control",
      "public",
      "researcher",
    ]);
  });

  it("maps workflow-only schedule consumers to the dedicated control worker", () => {
    const provider = "provider.schedule-state";
    const graph = {
      ...applicationGraph(),
      metadata: { name: "scheduled-jobs", namespace: "jobs" },
      nodes: [
        {
          id: "provider.Scheduler",
          kind: "provider",
          interface: "Scheduler",
          config: {},
        },
        {
          id: "provider.Scheduler.external",
          kind: "provider",
          interface: "Scheduler",
          config: { qualification: { name: "external" } },
        },
        { id: provider, kind: "provider", interface: "TransactionalDatabase" },
        {
          id: "schedule.local",
          kind: "schedule",
          name: "local",
          scheduler: { nodeId: "provider.Scheduler" },
        },
        {
          id: "schedule.external",
          kind: "schedule",
          name: "external",
          scheduler: { nodeId: "provider.Scheduler.external" },
        },
      ],
      edges: ["schedule.local", "schedule.external"].map((nodeId) => ({
        from: { nodeId: provider },
        to: { nodeId },
        relationship: "provides" as const,
      })),
    } as unknown as ApplicationGraph;

    expect([
      ...applicationProviderConsumerWorkloads(graph, new Set([provider])),
    ]).toEqual(["scheduled-jobs-schedule-control"]);
  });

  it("binds the internal-operation Secret to typed HTTP workflow gateway callers", async () => {
    const directory = await mkdtemp(
      join(process.env.TMPDIR ?? "/tmp", "applik8s-http-workflow-secret-"),
    );
    temporaryDirectories.push(directory);
    const bundlePath = join(directory, "typekro-bundle.json");
    await writeFile(bundlePath, JSON.stringify({ spec: {} }));
    const graph = {
      apiVersion: "applik8s.applicationGraph/v1alpha1",
      kind: "ApplicationGraph",
      metadata: { name: "workflow-http", namespace: "workflow-http" },
      nodes: [
        {
          id: "server.public-api",
          kind: "server",
          name: "public-api",
          routes: [{
            id: "start",
            method: "POST",
            path: "/start",
            functionNative: {
              workflowBindings: [{
                identifier: "provision",
                target: { nodeId: "workflow.tenant.provision.v1" },
              }],
            },
          }],
        },
        {
          id: "workflow-worker.main",
          kind: "workflowWorker",
          name: "main",
        },
      ],
      edges: [],
      providerRequirements: [],
      providerBindings: [],
    } as unknown as ApplicationGraph;

    const requirements = await applicationGeneratedSecretRequirements(
      bundlePath,
      graph.metadata.namespace,
      graph,
      {},
    );

    expect(requirements).toContainEqual(
      expect.objectContaining({
        namespace: "workflow-http",
        name: "workflow-http-internal-operation",
        consumers: ["server.public-api", "workflow-worker.main"],
      }),
    );
  });

  it("gives lakehouse publishers only their publication cursor", async () => {
    const directory = await mkdtemp(
      join(process.env.TMPDIR ?? "/tmp", "applik8s-lakehouse-secret-"),
    );
    temporaryDirectories.push(directory);
    const bundlePath = join(directory, "typekro-bundle.json");
    await writeFile(bundlePath, JSON.stringify({ spec: {} }));
    const graph = {
      ...applicationGraph(),
      metadata: { name: "analytics", namespace: "analytics" },
      nodes: [
        ...applicationGraph().nodes,
        {
          id: "lakehouse-publication.usage",
          kind: "lakehousePublication",
          name: "usage",
        },
      ],
    } as unknown as ApplicationGraph;

    const requirements = await applicationGeneratedSecretRequirements(
      bundlePath,
      graph.metadata.namespace,
      graph,
      {},
    );

    expect(requirements).toContainEqual(expect.objectContaining({
      name: "analytics-lakehouse-cursor",
      consumers: ["lakehouse-publication.usage"],
    }));
    expect(requirements.map(({ name }) => name)).not.toContain(
      "analytics-internal-operation",
    );
  });

  it("routes only the public actor protocol through the application Ingress", () => {
    const graph = publicRealtimeActorGraph();
    const resources = withPublishedActorIngressRoutes([{
      id: "applicationIngress",
      template: {
        apiVersion: "networking.k8s.io/v1",
        kind: "Ingress",
        metadata: { name: "actor-proof-ingress", namespace: "actor-proof" },
        spec: { rules: [{ host: "actor-proof.localhost", http: { paths: [{ path: "/", pathType: "Prefix", backend: { service: { name: "actor-proof-http", port: { number: 3000 } } } }] } }] },
      },
    }], graph, graph.nodes.find((node) => node.kind === "provider" && node.interface === "ActorRuntime") as never);
    expect(resources[0]?.template).toMatchObject({
      spec: { rules: [{ http: { paths: [
        { path: "/__applik8s/v1/actors", backend: { service: { name: "actor-proof-actors", port: { number: 8080 } } } },
        { path: "/", backend: { service: { name: "actor-proof-http" } } },
      ] } }] },
    });
    expect(() => withPublishedActorIngressRoutes([], graph, graph.nodes.find((node) => node.kind === "provider" && node.interface === "ActorRuntime") as never)).toThrow(/generated Ingress/u);
  });

  it("ships celld deploy's required esbuild binary in the generated runtime image", async () => {
    const directory = await mkdtemp(
      join(process.env.TMPDIR ?? "/tmp", "applik8s-celld-artifact-"),
    );
    temporaryDirectories.push(directory);
    const bundlePath = join(directory, "typekro-bundle.json");
    const operatorContext = join(directory, 'celld-operator');
    await mkdir(operatorContext, { recursive: true });
    const operatorDockerfile = join(operatorContext, 'Dockerfile');
    const operatorManifest = join(operatorContext, 'operator-manifest.json');
    await writeFile(operatorDockerfile, 'FROM scratch\n');
    await writeFile(operatorManifest, JSON.stringify({
      spec: {
        bundle: { buildIdentityDigest: sourceGraphDigest },
        container: {
          build: { context: operatorContext, dockerfile: operatorDockerfile },
          image: { repository: 'applik8s/applik8s-celld-operator', tag: 'source-test' },
        },
      },
    }));
    await writeFile(bundlePath, JSON.stringify({ spec: {
      operators: [{ name: 'applik8s-celld-operator', manifest: operatorManifest }],
    } }));
    await writeFile(
      join(directory, "resources.json"),
      JSON.stringify([{
        apiVersion: "kro.run/v1alpha1",
        kind: "ResourceGraphDefinition",
        metadata: { name: "actor-proof" },
        spec: {
          schema: { apiVersion: "v1alpha1", kind: "ActorProof", spec: { name: "string" }, status: { ready: "boolean" } },
          resources: [{
            id: "actorProofHttp",
            template: {
              apiVersion: "v1",
              kind: "Service",
              metadata: { name: "actor-proof-api", namespace: "actor-proof", labels: { "app.kubernetes.io/component": "typed-http" } },
              spec: {
                selector: { "app.kubernetes.io/component": "typed-http" },
                ports: [{ name: "http", port: 8080, targetPort: "http" }],
              },
            },
          }],
        },
      }]),
    );

    const emitted = await emitApplicationDeploymentGraph({
      bundlePath,
      projectRoot: directory,
      graph: celldApplicationGraph(),
      sourceGraphDigest,
      compilerVersion: "0.8.0",
      context: "orbstack",
      controlPlaneNamespace: "actor-proof",
      instance: "actor-proof",
      profile: "test",
      strategy: "direct",
      installationSpec: { name: "actor-proof", namespace: "actor-proof" },
    });
    const artifact = emitted.graph.nodes.find(({ id }) => id === "artifact.celld-runtime");
    expect(artifact?.kind).toBe("artifact");
    if (!artifact || artifact.kind !== "artifact") throw new Error("celld artifact was not emitted");
    const dockerfilePath = String(artifact.spec.sourceDescriptor.dockerfilePath);
    const dockerfile = await readFile(dockerfilePath, "utf8");
    const worker = await readFile(join(dockerfilePath, '..', 'worker.mjs'), 'utf8');
    expect(dockerfile).toContain("AS esbuild");
    expect(dockerfile).toContain("npm install --global --ignore-scripts=false esbuild@0.28.1");
    expect(dockerfile).toContain("COPY --from=esbuild --chmod=0555");
    expect(dockerfile).toContain(`FROM ${applicationCelldRuntimeRelease.image}`);
    expect(dockerfile.trimEnd()).toMatch(/USER 65532:65532$/u);
    expect(worker).not.toContain('node:');
    expect(worker).not.toContain('@kubernetes/client-node');
    expect(emitted.graph.edges).toContainEqual({
      from: "artifact.celld-runtime",
      to: "direct.provider.ActorRuntime.celld",
      relationship: "requiresOutput",
      output: "immutableReference",
    });
    expect(emitted.graph.edges).toContainEqual({
      from: 'artifact.operator.applik8s-celld-operator',
      to: 'direct.provider.ActorRuntime.celld-operator',
      relationship: 'requiresOutput',
      output: 'immutableReference',
    });
    expect(emitted.graph.edges).not.toContainEqual({
      from: "artifact.celld-runtime",
      to: "kubernetes.application",
      relationship: "requiresOutput",
      output: "immutableReference",
    });
    expect(emitted.graph.edges).toContainEqual({
      from: "external.provider.ActorRuntime.celld-authorization",
      to: "direct.provider.ActorRuntime.celld",
      relationship: "requiresReady",
    });
    expect(emitted.graph.edges).toContainEqual({
      from: "direct.provider.ActorRuntime.celld",
      to: "kubernetes.application",
      relationship: "requiresReady",
    });

    const historical = await emitApplicationDeploymentGraph({
      bundlePath,
      projectRoot: directory,
      graph: celldApplicationGraph(),
      sourceGraphDigest,
      compilerVersion: '0.8.0',
      context: 'orbstack',
      controlPlaneNamespace: 'actor-proof',
      instance: 'actor-proof',
      profile: 'test',
      strategy: 'direct',
      installationSpec: { name: 'actor-proof', namespace: 'actor-proof' },
      celldRuntimeRelease: historicalCelldRuntimeRelease,
    });
    const historicalArtifact = historical.graph.nodes.find(({ id }) => id === 'artifact.celld-runtime');
    const historicalFleet = historical.graph.nodes.find(({ id }) => id === 'direct.provider.ActorRuntime.celld');
    expect(historicalArtifact).toMatchObject({
      kind: 'artifact',
      spec: {
        sourceDescriptor: {
          baseImage: historicalCelldRuntimeRelease.image,
          runtimeManifest: { celldVersion: historicalCelldRuntimeRelease.version },
        },
      },
    });
    expect(historicalFleet).toMatchObject({
      kind: 'kubernetesDirect',
      spec: {
        configuration: {
          fleet: { artifact: { celldVersion: historicalCelldRuntimeRelease.version } },
        },
      },
    });
  });

  it("projects external OTLP signals and namespace-scoped Secret inputs into every Kubernetes runtime", async () => {
    const directory = await mkdtemp(
      join(process.env.TMPDIR ?? "/tmp", "applik8s-external-otlp-"),
    );
    temporaryDirectories.push(directory);
    const bundlePath = join(directory, "typekro-bundle.json");
    await writeFile(bundlePath, JSON.stringify({ spec: {} }));
    await writeFile(join(directory, "resources.json"), JSON.stringify([{
      apiVersion: "kro.run/v1alpha1",
      kind: "ResourceGraphDefinition",
      metadata: { name: "telemetry" },
      spec: {
        schema: { apiVersion: "v1alpha1", kind: "Telemetry", spec: { name: "string" }, status: { ready: "boolean" } },
        resources: [
          generatedDeployment("telemetryHttp", "telemetry-http", "typed-http", "http", "example.test/http@sha256:immutable"),
          generatedDeployment("telemetryWorker", "telemetry-worker", "stream-processor", "runtime", "example.test/worker@sha256:immutable"),
        ],
      },
    }]));
    const graph = externalOtlpApplicationGraph();
    const request = {
      bundlePath,
      projectRoot: directory,
      graph,
      sourceGraphDigest,
      compilerVersion: "0.8.0",
      context: "orbstack",
      controlPlaneNamespace: "telemetry",
      instance: "telemetry",
      profile: "external",
      strategy: "direct" as const,
      installationSpec: { name: "telemetry", namespace: "telemetry" },
    };
    const emitted = await emitApplicationDeploymentGraph(request);
    const host = emitted.graph.nodes.find(({ id }) => id === "kubernetes.application");
    const resources = host?.kind === "kubernetesComposition"
      ? host.spec.materialized?.resources ?? []
      : [];
    for (const workload of ["telemetry-http", "telemetry-worker"]) {
      expect(deploymentEnvironment(resources, workload)).toEqual(expect.arrayContaining([
        { name: "OTEL_EXPORTER_OTLP_ENDPOINT", value: "https://otel.example.test/tenant/demo" },
        { name: "APPLIK8S_OTLP_SIGNALS", value: "traces,logs" },
        { name: "APPLIK8S_OTLP_HEADER_NAME", value: "x-otel-token" },
        { name: "APPLIK8S_OTLP_HEADER_VALUE", valueFrom: { secretKeyRef: { name: "otel-auth", key: "token" } } },
        { name: "APPLIK8S_OTLP_CA_PEM", valueFrom: { secretKeyRef: { name: "otel-ca", key: "ca.crt" } } },
        { name: "APPLIK8S_OTLP_SERVER_NAME", value: "otel.example.test" },
      ]));
    }

    const crossNamespaceGraph = externalOtlpApplicationGraph("shared-observability");
    await expect(emitApplicationDeploymentGraph({ ...request, graph: crossNamespaceGraph }))
      .rejects.toThrow(/cannot be mounted by runtime workloads in namespace telemetry/u);
  });

  it("projects ClickStack authorization from its generated Secret into telemetry runtimes", async () => {
    const directory = await mkdtemp(
      join(process.env.TMPDIR ?? "/tmp", "applik8s-clickstack-auth-"),
    );
    temporaryDirectories.push(directory);
    const bundlePath = join(directory, "typekro-bundle.json");
    await writeFile(bundlePath, JSON.stringify({ spec: {} }));
    await writeFile(join(directory, "resources.json"), JSON.stringify([{
      apiVersion: "kro.run/v1alpha1",
      kind: "ResourceGraphDefinition",
      metadata: { name: "telemetry" },
      spec: {
        schema: { apiVersion: "v1alpha1", kind: "Telemetry", spec: { name: "string" }, status: { ready: "boolean" } },
        resources: [
          generatedDeployment("telemetryHttp", "telemetry-http", "typed-http", "http", "example.test/http@sha256:immutable"),
        ],
      },
    }]));
    const graph = clickStackApplicationGraph();
    const emitted = await emitApplicationDeploymentGraph({
      bundlePath,
      projectRoot: directory,
      graph,
      sourceGraphDigest,
      compilerVersion: "0.8.0",
      context: "orbstack",
      controlPlaneNamespace: "default",
      instance: "telemetry",
      profile: "dedicated",
      strategy: "direct",
      installationSpec: { name: "telemetry", namespace: "telemetry" },
    });
    const host = emitted.graph.nodes.find(({ id }) => id === "kubernetes.application");
    const resources = host?.kind === "kubernetesComposition"
      ? host.spec.materialized?.resources ?? []
      : [];
    expect(deploymentEnvironment(resources, "telemetry-http")).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "OTEL_EXPORTER_OTLP_ENDPOINT" }),
      { name: "APPLIK8S_OTLP_HEADER_NAME", value: "authorization" },
      {
        name: "APPLIK8S_OTLP_HEADER_VALUE",
        valueFrom: {
          secretKeyRef: {
            name: "telemetry-observability-credentials",
            key: "hyperdx-api-key",
          },
        },
      },
    ]));
    expect(JSON.stringify(emitted.graph.runtimeAccess)).not.toContain("kind\":\"random");
  });

  it("keeps production-capable host credential values outside portable state", async () => {
    const directory = await mkdtemp(
      join(process.env.TMPDIR ?? "/tmp", "applik8s-host-environment-"),
    );
    temporaryDirectories.push(directory);
    const bundlePath = join(directory, "typekro-bundle.json");
    const syntheticContainer = (name: string, image: string) => ({
      image,
      contextPath: join(directory, name),
      dockerfilePath: join(directory, name, "Dockerfile"),
      baseImage: "node:22",
      command: ["node", `/app/${name}.mjs`],
      sourceDigest: artifactDigest,
    });
    await writeFile(bundlePath, JSON.stringify({ spec: {
      http: [{
        name: "billing",
        serverId: "server.billing",
        executionNodeIds: ["server.billing"],
        digest: artifactDigest,
        container: syntheticContainer("billing", "applik8s.local/billing:synthetic"),
      }],
      reactive: ([
        ["deliver-billable-usage-create", "streamProcessor.deliver-billable-usage-create"],
        ["deliver-requested-notification-create", "streamProcessor.deliver-requested-notification-create"],
        ["unrelated", "streamProcessor.unrelated"],
      ] as const).map(([name, nodeId]) => ({
        name,
        nodeId,
        executionNodeIds: [nodeId],
        kind: "streamProcessorWorker",
        digest: artifactDigest,
        container: syntheticContainer(name, `applik8s.local/${name}:synthetic`),
        ...(name === "deliver-billable-usage-create"
          ? {
              credentialProjections: [{
                target: "kubernetes",
                namespace: "notes-system",
                name: "${schema.spec.providers.payments.secretName}",
                keys: ["${schema.spec.providers.payments.apiKeyKey}"],
              }],
            }
          : {}),
      })),
    } }));
    await writeFile(
      join(directory, "resources.json"),
      JSON.stringify([
        {
          apiVersion: "kro.run/v1alpha1",
          kind: "ResourceGraphDefinition",
          metadata: { name: "notes" },
          spec: {
            schema: {
              apiVersion: "v1alpha1",
              kind: "Notes",
              spec: { name: "string" },
              status: { ready: "boolean" },
            },
            resources: [
              {
                id: "applicationHost",
                template: {
                  apiVersion: "apps/v1",
                  kind: "Deployment",
                  metadata: {
                    name: "notes-app",
                    namespace: "notes-system",
                    labels: {
                      "app.kubernetes.io/component": "application-host",
                    },
                  },
                  spec: {
                    template: {
                      spec: {
                        containers: [
                          {
                            name: "application",
                            image: "immutable",
                            env: [],
                          },
                        ],
                      },
                    },
                  },
                },
              },
              generatedDeployment(
                "billingHttp",
                "billing",
                "typed-http",
                "http",
                "applik8s.local/billing:synthetic",
                [
                  { name: "APPLIK8S_CONTEXT_SECRET", valueFrom: { secretKeyRef: { name: "notes-context", key: "key" } } },
                  { name: "APPLIK8S_PAYMENT_API_KEY", valueFrom: { secretKeyRef: { name: "${schema.spec.providers.payments.secretName}", key: "${schema.spec.providers.payments.apiKeyKey}" } } },
                ],
              ),
              generatedDeployment(
                "usageProcessor",
                "notes-reactive-envelope",
                "reactive-worker",
                "notes-deliver-billable-usage-create",
                "applik8s.local/deliver-billable-usage-create:synthetic",
              ),
              generatedDeployment(
                "notificationProcessor",
                "notes-deliver-requested-notification-create",
                "stream-processor",
                "runtime",
                "applik8s.local/deliver-requested-notification-create:synthetic",
              ),
              generatedDeployment(
                "unrelatedProcessor",
                "notes-unrelated",
                "stream-processor",
                "runtime",
                "applik8s.local/unrelated:synthetic",
              ),
            ],
          },
        },
      ]),
    );
    await mkdir(join(directory, "application-host"));
    await writeFile(
      join(directory, "application-host", "application-host.json"),
      JSON.stringify({
        metadata: { name: "notes-app" },
        spec: {
          namespace: "notes-system",
          image: "applik8s.local/notes-app:synthetic",
          artifactDigest,
          cursorSecret: { name: "notes-cursor", key: "key" },
        },
      }),
    );
    const installationSpec = {
      name: "notes",
      profile: "dedicated",
      providers: {
        inference: {
          credentialSecretName: "notes-inference",
          credentialSource: {
            kind: "hostEnvironment",
            variable: "SYNTHETIC_INFERENCE_KEY",
          },
        },
        payments: {
          secretName: "notes-payments",
          credentialSource: {
            kind: "hostEnvironment",
            apiKeyVariable: "SYNTHETIC_STRIPE_KEY",
            webhookSecretVariable: "SYNTHETIC_STRIPE_WEBHOOK",
          },
        },
        notifications: {
          host: "smtp.example.test",
          port: 587,
          secure: false,
          secretName: "notes-notifications",
          senderEmail: "notices@example.test",
          senderName: "Notes",
          credentialSource: {
            kind: "hostEnvironment",
            usernameVariable: "SYNTHETIC_SMTP_USERNAME",
            passwordVariable: "SYNTHETIC_SMTP_PASSWORD",
          },
        },
      },
    };
    const emitted = await emitApplicationDeploymentGraph({
      bundlePath,
      projectRoot: directory,
      graph: paymentApplicationGraph(),
      sourceGraphDigest,
      compilerVersion: "0.7.0",
      context: "orbstack",
      controlPlaneNamespace: "default",
      instance: "notes",
      profile: "dedicated",
      strategy: "kro",
      installationSpec,
    });
    const encoded = JSON.stringify(emitted.graph);
    expect(encoded).toContain("SYNTHETIC_INFERENCE_KEY");
    expect(encoded).toContain("SYNTHETIC_STRIPE_KEY");
    expect(encoded).toContain("SYNTHETIC_SMTP_USERNAME");
    expect(encoded).toContain("SYNTHETIC_SMTP_PASSWORD");
    expect(encoded).not.toContain("actual-inference-value");
    expect(
      emitted.graph.nodes.filter(
        (node) =>
          node.kind === "externalProvider"
          && node.spec.resourceType === "kubernetesGeneratedSecret",
      ),
    // Inference, payments, notifications, and typed HTTP context credentials
    // are generated-secret effects rather than portable values.
    ).toHaveLength(5);
    const host = emitted.graph.nodes
      .find((node) => node.id === "kubernetes.application");
    const materialized = host?.kind === "kubernetesComposition"
      ? JSON.stringify(host.spec.materialized)
      : "";
    expect(materialized).toContain("APPLIK8S_PAYMENT_API_KEY");
    expect(materialized).toContain("APPLIK8S_PAYMENT_WEBHOOK_SECRET");
    expect(materialized).toContain("APPLIK8S_NOTIFICATION_SMTP_USERNAME");
    expect(materialized).toContain("APPLIK8S_NOTIFICATION_SMTP_PASSWORD");
    expect(materialized).not.toContain("STRIPE_SECRET_KEY");
    expect(materialized).not.toContain("actual-smtp-password");
    expect(JSON.stringify(emitted.graph.runtimeAccess))
      .not.toContain("schema.spec.providers.payments");
    expect(JSON.stringify(emitted.graph.runtimeAccess))
      .toContain("notes-payments");
    const resources = host?.kind === "kubernetesComposition"
      ? host.spec.materialized?.resources ?? []
      : [];
    expect(deploymentEnvironment(resources, "billing")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "APPLIK8S_PROFILE_VARIANT", value: "dedicated" }),
        expect.objectContaining({
          name: "APPLIK8S_PAYMENT_API_KEY",
          valueFrom: { secretKeyRef: { name: "notes-payments", key: "apiKey" } },
        }),
      ]),
    );
    expect(
      deploymentEnvironment(
        resources,
        "notes-reactive-envelope",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "APPLIK8S_PAYMENT_API_KEY" }),
      ]),
    );
    expect(
      deploymentEnvironment(
        resources,
        "notes-deliver-requested-notification-create",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "APPLIK8S_PROFILE_VARIANT",
          value: "dedicated",
        }),
        expect.objectContaining({
          name: "APPLIK8S_NOTIFICATION_DELIVERY_KIND",
          value: "smtp",
        }),
        expect.objectContaining({
          name: "APPLIK8S_NOTIFICATION_SMTP_HOST",
          value: "smtp.example.test",
        }),
        expect.objectContaining({
          name: "APPLIK8S_NOTIFICATION_SMTP_USERNAME",
        }),
      ]),
    );
    expect(deploymentEnvironment(resources, "billing"))
      .not.toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "APPLIK8S_NOTIFICATION_SMTP_PASSWORD" }),
      ]));
    expect(deploymentEnvironment(resources, "notes-unrelated")).toEqual([]);
    expect(deploymentEnvironment(resources, "notes-app")).toEqual([]);
  });

  it("shadow-emits deterministic deployment data without preparing artifacts", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "applik8s-deployment-"));
    temporaryDirectories.push(directory);
    const bundlePath = join(directory, "typekro-bundle.json");
    const manifestPath = join(directory, "operator-manifest.json");
    await writeFile(
      bundlePath,
      JSON.stringify({
        spec: {
          agents: [
            generatedContainerEntry("researcher", "agent"),
          ],
          mcp: [
            generatedContainerEntry("tools", "mcp"),
          ],
          http: [
            generatedContainerEntry("public-api", "typed-http"),
          ],
          operators: [
            {
              name: "notes-operator",
              manifest: "operator-manifest.json",
            },
          ],
        },
      }),
    );
    await writeFile(
      manifestPath,
      JSON.stringify({
        spec: {
          bundle: { digest: artifactDigest, buildIdentityDigest: artifactDigest },
          container: {
            build: {
              context: "./generated/operator",
              dockerfile: "Dockerfile.applik8s-runtime",
            },
            image: {
              repository: "registry.example/applik8s/notes-operator",
              tag: "source",
            },
          },
        },
      }),
    );
    await writeFile(
      join(directory, "resources.json"),
      JSON.stringify([
        applicationOwnedCrd(),
        {
          ...applicationOwnedCrd(),
          metadata: {
            ...applicationOwnedCrd().metadata,
            namespace: "${ownedCrd.metadata.namespace}",
          },
        },
        {
          apiVersion: "kro.run/v1alpha1",
          kind: "ResourceGraphDefinition",
          metadata: { name: "notes" },
          spec: {
            schema: {
              apiVersion: "v1alpha1",
              kind: "Notes",
              spec: { name: "string" },
              status: { ready: "boolean" },
            },
            resources: [
              {
                id: "notesConfig",
                template: {
                  apiVersion: "v1",
                  kind: "ConfigMap",
                  metadata: { name: "${schema.spec.name}" },
                },
              },
            ],
          },
        },
      ]),
    );

    const request = {
      bundlePath,
      projectRoot: directory,
      graph: applicationGraph(),
      sourceGraphDigest,
      compilerVersion: "0.6.0",
      context: "orbstack",
      controlPlaneNamespace: "applik8s-system",
      instance: "notes",
      profile: "local",
      strategy: "kro" as const,
      installationSpec: { name: "notes", namespace: "notes" },
    };
    const first = await emitApplicationDeploymentGraph(request);
    const second = await emitApplicationDeploymentGraph(request);

    expect(validateApplicationDeploymentGraph(first.graph).valid).toBe(true);
    expect(first.artifactCount).toBe(4);
    expect(first.digest).toBe(second.digest);
    expect(first.digest).toBe(digestApplicationDeploymentGraph(first.graph));
    expect(first.graph.nodes.map(({ id }) => id)).toEqual([
      "artifact.agent.researcher",
      "artifact.http.public-api",
      "artifact.mcp.tools",
      "artifact.operator.notes-operator",
      "direct.namespace.control-plane",
      "direct.namespace.workload",
      expect.stringMatching(/^direct\.crd\./),
      "kubernetes.application",
    ]);
    expect(
      first.graph.nodes.filter((node) => node.kind === "kubernetesDirect"),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lifecycle: {
            ownership: "shared",
            deletion: "retain",
            adoption: "createOrAdoptExact",
          },
          spec: expect.objectContaining({
            compositionId: "applik8s-custom-resource-definition",
            configuration: expect.objectContaining({
              name: "entries.notes.applik8s.dev",
              manifest: expect.objectContaining({
                metadata: { name: "entries.notes.applik8s.dev" },
              }),
            }),
          }),
        }),
        expect.objectContaining({
          id: "direct.namespace.workload",
          spec: expect.objectContaining({
            compositionId: "applik8s-namespace",
            configuration: { name: "notes" },
          }),
        }),
      ]),
    );
    expect(
      first.graph.nodes.find(
        (node) => node.kind === "kubernetesComposition",
      )?.spec.materialized,
    ).toMatchObject({
      resources: [{ id: "notesConfig" }],
      status: { ready: "boolean" },
    });
    expect(JSON.parse(await readFile(first.path, "utf8"))).toMatchObject({
      apiVersion: "applik8s.deploymentGraph/v1alpha1",
      metadata: {
        identity: {
          connection: { provider: "kubernetes", cluster: "orbstack" },
          instance: "notes",
        },
      },
    });

    const fresh = await emitApplicationDeploymentGraph({
      ...request,
      profileTransition: {
        apiVersion: "applik8s.profileTransitionPlan/v1alpha1",
        installation: { namespace: "applik8s-system", name: "notes" },
        mode: "fresh",
        entries: [],
        acknowledgements: [],
      },
    });
    const unchanged = await emitApplicationDeploymentGraph({
      ...request,
      profileTransition: {
        apiVersion: "applik8s.profileTransitionPlan/v1alpha1",
        installation: { namespace: "applik8s-system", name: "notes" },
        mode: "unchanged",
        entries: [],
        acknowledgements: [],
      },
    });
    expect(fresh.digest).toBe(unchanged.digest);
    expect(fresh.graph.metadata.profileTransition).toBeUndefined();
    expect(unchanged.graph.metadata.profileTransition).toBeUndefined();

    const transition = await emitApplicationDeploymentGraph({
      ...request,
      profileTransition: {
        apiVersion: "applik8s.profileTransitionPlan/v1alpha1",
        installation: { namespace: "applik8s-system", name: "notes" },
        mode: "transition",
        entries: [
          {
            qualification: "TransactionalDatabase@v1alpha1:primary",
            from: "starter",
            to: "dedicated",
            kind: "replace",
          },
        ],
        acknowledgements: ["reviewed-transition"],
      },
    });
    expect(transition.graph.metadata.profileTransition).toMatchObject({
      mode: "transition",
      acknowledgements: ["reviewed-transition"],
    });
    expect(transition.digest).not.toBe(fresh.digest);
  });
});

function applicationGraph(): ApplicationGraph {
  return {
    apiVersion: "applik8s.appGraph/v1alpha1",
    kind: "ApplicationGraph",
    metadata: { name: "notes" },
    nodes: [],
    edges: [],
    providerRequirements: [],
    providerBindings: [],
    compatibility: {
      stablePublicApis: [],
      documentedInternalContracts: [],
      experimentalSurfaces: [],
      postV3Surfaces: [],
      labels: [],
    },
  };
}

function externalOtlpApplicationGraph(secretNamespace = "telemetry"): ApplicationGraph {
  return {
    ...applicationGraph(),
    metadata: { name: "telemetry", namespace: "telemetry" },
    nodes: [{
      id: "provider.Observability",
      kind: "provider",
      name: "Observability",
      stability: "stable",
      interface: "Observability",
      implementation: "otlp",
      config: {
        observability: {
          kind: "otlp",
          endpoint: "https://otel.example.test/tenant/demo",
          protocol: "http/protobuf",
          signals: ["traces", "logs"],
          authentication: {
            secret: { apiVersion: "v1", kind: "Secret", name: "otel-auth", namespace: secretNamespace },
            key: "token",
            header: "x-otel-token",
          },
          tls: {
            trust: "custom-ca",
            certificateAuthority: { apiVersion: "v1", kind: "Secret", name: "otel-ca", namespace: secretNamespace },
            key: "ca.crt",
            serverName: "otel.example.test",
          },
        },
      },
    }],
  } as unknown as ApplicationGraph;
}

function clickStackApplicationGraph(): ApplicationGraph {
  return {
    ...applicationGraph(),
    metadata: { name: "telemetry", namespace: "telemetry" },
    nodes: [{
        id: "provider.Observability",
        kind: "provider",
        name: "Observability",
        stability: "stable",
        interface: "Observability",
        implementation: "clickstack",
        config: {
          observability: {
            kind: "clickstack",
            namespace: "telemetry",
            policy: {},
            retention: {},
          },
        },
      }],
  } as unknown as ApplicationGraph;
}

function paymentApplicationGraph(): ApplicationGraph {
  return {
    ...applicationGraph(),
    metadata: { name: "notes", namespace: "notes-system" },
    // typecast: this focused deployment test supplies only the node fields
    // consumed by credential placement; graph construction tests validate the
    // complete producer contracts separately.
    nodes: [
      {
        id: "provider.ApplicationHost",
        kind: "provider",
        name: "ApplicationHost",
        stability: "stable",
        interface: "ApplicationHost",
        implementation: "managed-application-host",
        config: {
          host: {
            kind: "managed-application-host",
            name: "notes-app",
            namespace: "notes-system",
            port: 3000,
          },
        },
      },
      {
        id: "provider.payment-provider.v1alpha1.primary",
        kind: "provider",
        name: "PaymentProvider",
        stability: "stable",
        interface: "PaymentProvider",
        implementation: "stripe",
        config: {
          profile: {
            branches: [{
              variant: "dedicated",
              implementation: "stripe",
            }],
          },
        },
      },
      {
        id: "server.billing",
        kind: "server",
        name: "billing",
        stability: "stable",
        routes: [],
      },
      {
        id: "streamProcessor.deliver-billable-usage-create",
        kind: "streamProcessor",
        name: "deliver-billable-usage-create",
        stability: "stable",
      },
      {
        id: "streamProcessor.unrelated",
        kind: "streamProcessor",
        name: "unrelated",
        stability: "stable",
      },
      {
        id: "provider.notification-delivery.v1alpha1.transactional",
        kind: "provider",
        name: "NotificationDelivery",
        stability: "stable",
        interface: "NotificationDelivery",
        implementation: "smtp",
        config: {},
      },
      {
        id: "streamProcessor.deliver-requested-notification-create",
        kind: "streamProcessor",
        name: "deliver-requested-notification-create",
        stability: "stable",
      },
    ] as unknown as ApplicationGraph["nodes"],
    edges: [
      {
        from: { nodeId: "provider.payment-provider.v1alpha1.primary" },
        to: { nodeId: "server.billing" },
        relationship: "provides",
      },
      {
        from: {
          nodeId: "provider.notification-delivery.v1alpha1.transactional",
        },
        to: {
          nodeId: "streamProcessor.deliver-requested-notification-create",
        },
        relationship: "provides",
      },
      {
        from: { nodeId: "provider.payment-provider.v1alpha1.primary" },
        to: { nodeId: "streamProcessor.deliver-billable-usage-create" },
        relationship: "provides",
      },
    ],
  };
}

function celldApplicationGraph(): ApplicationGraph {
  return {
    ...applicationGraph(),
    metadata: { name: "actor-proof", namespace: "actor-proof" },
    nodes: [{
      id: "provider.ActorRuntime",
      kind: "provider",
      name: "ActorRuntime",
      stability: "experimental",
      interface: "ActorRuntime",
      implementation: "celld-actors",
      config: {
        actorRuntime: {
          kind: "celld-actors",
          replicas: 1,
          stateStore: {
            kind: "s3",
            bucket: "actor-proof-state",
            region: "us-east-1",
            endpoint: "http://rook-ceph-rgw-applik8s-object-store.applik8s-rook-ceph.svc.cluster.local",
            forcePathStyle: true,
            credentialsSecret: {
              apiVersion: "v1",
              kind: "Secret",
              name: "actor-proof-state",
              namespace: "actor-proof",
            },
          },
        },
      },
    }],
  };
}

function publicRealtimeActorGraph(): ApplicationGraph {
  const graph = celldApplicationGraph();
  return {
    ...graph,
    nodes: [
      ...graph.nodes,
      {
        id: "provider.HttpExposure",
        kind: "provider",
        name: "HttpExposure",
        stability: "stable",
        interface: "HttpExposure",
        implementation: "ingress",
        config: { httpExposure: { kind: "ingress", ingressClassName: "nginx", controllerNamespace: "ingress-nginx" } },
      },
      {
        id: "exposure.actor-proof",
        kind: "exposure",
        name: "actor-proof",
        stability: "stable",
        provider: { interface: "HttpExposure", nodeId: "provider.HttpExposure" },
        service: "actor-proof-http",
        hostnames: ["actor-proof.localhost"],
        tlsIntent: { mode: "disabled" },
        dnsIntent: { mode: "disabled" },
        publicUrl: "http://actor-proof.localhost",
        transport: { kind: "ingress", ingressClassName: "nginx" },
        readiness: { ingress: "resourceApplied", service: "notRequested", loadBalancer: "statusObserved", certificate: "notRequested", dns: "notRequested", publicUrl: "derived" },
        generatedResources: [{ role: "exposure", graphNode: { nodeId: "exposure.actor-proof" }, resource: { apiVersion: "networking.k8s.io/v1", kind: "Ingress", name: "actor-proof-ingress", namespace: "actor-proof" }, artifact: { kind: "kubernetesManifest", name: "actor-proof-ingress" } }],
      },
      {
        id: "actor.workspace.v1",
        kind: "actor",
        name: "workspace.v1",
        stability: "experimental",
        definition: {
          id: "workspace.v1",
          key: { kind: "applicationSchema", source: "string", fingerprint: "key" },
          state: { kind: "applicationSchema", source: "{ revision: number }", fingerprint: "state" },
          stateVersion: 1,
          migrationDigest: "none",
          migrations: [],
          protocol: [{ name: "connect", kind: "connection", input: { kind: "applicationSchema", source: "{}", fingerprint: "connect" } }],
          requirements: { durableState: true, serializedTurns: true, transactionalOutbox: true, durableAlarms: false, realtimeConnections: true, connectionLeases: true, realtimeMessages: false, realtimeBroadcast: false },
        },
        runtime: { interface: "ActorRuntime", nodeId: "provider.ActorRuntime" },
        handlers: [],
        semantics: { serialization: "fullTurnPerIdentity", admission: "idempotentReceipt", references: "inertAddress" },
        publication: { boundary: "entrypoint-export" },
      },
    ] as ApplicationGraph["nodes"],
  };
}

function generatedDeployment(
  id: string,
  name: string,
  component: string,
  containerName: string,
  image = "immutable",
  environment: readonly Record<string, unknown>[] = [],
) {
  return {
    id,
    template: {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: {
        name,
        namespace: "notes-system",
        labels: {
          "app.kubernetes.io/name": name,
          "app.kubernetes.io/component": component,
        },
      },
      spec: {
        template: {
          metadata: {
            labels: {
              "app.kubernetes.io/name": name,
              "app.kubernetes.io/component": component,
            },
          },
          spec: {
            containers: [{
              name: containerName,
              image,
              env: environment,
            }],
          },
        },
      },
    },
  };
}

function deploymentEnvironment(
  resources: readonly Record<string, unknown>[],
  name: string,
): readonly Record<string, unknown>[] {
  const resource = resources.find((candidate) => {
    const template = candidate.template;
    if (!template || typeof template !== "object") return false;
    const metadata = Reflect.get(template, "metadata");
    return metadata && typeof metadata === "object"
      && Reflect.get(metadata, "name") === name;
  });
  if (!resource?.template || typeof resource.template !== "object") return [];
  const containers = Reflect.get(
    Reflect.get(
      Reflect.get(
        Reflect.get(resource.template, "spec"),
        "template",
      ),
      "spec",
    ),
    "containers",
  );
  if (!Array.isArray(containers)) return [];
  return containers.flatMap((container) => {
    const environment = Reflect.get(container, "env");
    return Array.isArray(environment) ? environment : [];
  });
}

function applicationOwnedCrd() {
  return {
    apiVersion: "apiextensions.k8s.io/v1",
    kind: "CustomResourceDefinition",
    metadata: { name: "entries.notes.applik8s.dev" },
    spec: {
      group: "notes.applik8s.dev",
      scope: "Namespaced",
      names: {
        plural: "entries",
        singular: "entry",
        kind: "Entry",
      },
      versions: [
        {
          name: "v1alpha1",
          served: true,
          storage: true,
          schema: {
            openAPIV3Schema: {
              type: "object",
            },
          },
        },
      ],
    },
  };
}

function generatedContainerEntry(name: string, role: string) {
  return {
    name,
    digest: artifactDigest,
    container: {
      image: `${role}:sha-source`,
      sourceDigest: artifactDigest,
      contextPath: `./generated/${role}`,
      dockerfilePath: `./generated/${role}/Dockerfile`,
      baseImage: "node:22.22.0-slim",
      command: ["node", `/app/${role}.mjs`],
    },
  };
}
