import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ApplicationGraph } from "@applik8s/core";
import {
  digestApplicationDeploymentGraph,
  validateApplicationDeploymentGraph,
} from "@applik8s/deployment-contract";
import { afterEach, describe, expect, it } from "vitest";

// typecast-file-boundary: Test fixtures preserve literal discriminants while
// exercising compiler shadow emission without loading the compiler's
// worker-backed bundling entrypoints into Bun's test process.
import { emitApplicationDeploymentGraph } from "../src/application-deployment-graph.js";

const temporaryDirectories: string[] = [];
const artifactDigest = `sha256:${"a".repeat(64)}`;
const sourceGraphDigest = `sha256:${"b".repeat(64)}`;

afterEach(async () => {
  for (const path of temporaryDirectories.splice(0)) {
    await rm(path, { recursive: true, force: true });
  }
});

describe("compiler deployment graph emission", () => {
  it("keeps production-capable host credential values outside portable state", async () => {
    const directory = await mkdtemp(
      join(process.env.TMPDIR ?? "/tmp", "applik8s-host-environment-"),
    );
    temporaryDirectories.push(directory);
    const bundlePath = join(directory, "typekro-bundle.json");
    await writeFile(bundlePath, JSON.stringify({ spec: {} }));
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
              ),
              generatedDeployment(
                "usageProcessor",
                "notes-deliver-billable-usage-create",
                "stream-processor",
                "runtime",
              ),
              generatedDeployment(
                "notificationProcessor",
                "notes-deliver-requested-notification-create",
                "stream-processor",
                "runtime",
              ),
              generatedDeployment(
                "unrelatedProcessor",
                "notes-unrelated",
                "stream-processor",
                "runtime",
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
    // Inference, both Stripe credentials, and the typed HTTP context key are
    // all represented as generated-secret effects rather than portable values.
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
    const resources = host?.kind === "kubernetesComposition"
      ? host.spec.materialized?.resources ?? []
      : [];
    expect(deploymentEnvironment(resources, "billing")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "APPLIK8S_PROFILE_VARIANT", value: "dedicated" }),
        expect.objectContaining({ name: "APPLIK8S_PAYMENT_API_KEY" }),
      ]),
    );
    expect(
      deploymentEnvironment(
        resources,
        "notes-deliver-billable-usage-create",
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
    expect(deploymentEnvironment(resources, "application-host")).toEqual([]);
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

function paymentApplicationGraph(): ApplicationGraph {
  return {
    ...applicationGraph(),
    metadata: { name: "notes", namespace: "notes-system" },
    // typecast: this focused deployment test supplies only the node fields
    // consumed by credential placement; graph construction tests validate the
    // complete producer contracts separately.
    nodes: [
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

function generatedDeployment(
  id: string,
  name: string,
  component: string,
  containerName: string,
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
          spec: {
            containers: [{
              name: containerName,
              image: "immutable",
              env: [],
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
