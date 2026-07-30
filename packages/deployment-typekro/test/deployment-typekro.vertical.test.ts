import {
  type ApplicationDeploymentGraph,
  digestApplicationDeploymentValue,
} from "@applik8s/deployment-contract";
import { type } from "arktype";
import {
  createResource,
  kubernetesComposition,
  simple,
  singleton,
} from "typekro";
import { artifactOutput } from "typekro/experimental/planning";
import { describe, expect, it } from "vitest";

// typecast-file-boundary: Test fixtures preserve literal discriminants while
// exercising TypeKro adapter validation.
import {
  adaptApplicationDeploymentToTypeKro,
  assembleApplicationTypeKroComposition,
  bindApplicationTypeKroDirectNodes,
  bindTypeKroComposition,
  bindTypeKroCompositionWithSupportingDeclarations,
  typeKroArtifactRequirements,
} from "../src/index.js";

const TestSpec = type({
  name: "string",
  image: "string",
});
const TestStatus = type({
  ready: "boolean",
  "observedVersion?": "string",
  "artifactDigest?": "string",
});

function composition(name = "adapter-app") {
  return kubernetesComposition(
    {
      name,
      apiVersion: "testing.applik8s.dev/v1alpha1",
      kind: "AdapterApp",
      spec: TestSpec,
      status: TestStatus,
    },
    (spec) => {
      const deployment = simple.Deployment({
        id: "applicationDeployment",
        name: spec.name,
        image: spec.image,
      });
      return {
        ready: deployment.status.readyReplicas >= 1,
      };
    },
  );
}

function artifactComposition() {
  return kubernetesComposition(
    {
      name: "adapter-app",
      apiVersion: "testing.applik8s.dev/v1alpha1",
      kind: "AdapterApp",
      spec: type({ name: "string" }),
      status: TestStatus,
    },
    (spec) => {
      createResource({
        id: "applicationConfig",
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: spec.name },
        data: {
          image: artifactOutput("artifact.web", "immutableReference"),
        },
      });
      return { ready: true };
    },
  );
}

function compositionWithSharedOwner() {
  const owner = kubernetesComposition(
    {
      name: "adapter-shared-owner",
      apiVersion: "testing.applik8s.dev/v1alpha1",
      kind: "AdapterSharedOwner",
      spec: type({ name: "string", namespace: "string" }),
      status: TestStatus,
    },
    (spec) => {
      createResource({
        id: "sharedNamespace",
        apiVersion: "v1",
        kind: "Namespace",
        metadata: { name: spec.namespace },
      });
      createResource({
        id: "sharedConfig",
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: spec.name, namespace: spec.namespace },
      });
      return { ready: true };
    },
  );
  return kubernetesComposition(
    {
      name: "adapter-app",
      apiVersion: "testing.applik8s.dev/v1alpha1",
      kind: "AdapterApp",
      spec: TestSpec,
      status: TestStatus,
    },
    (spec) => {
      singleton(owner, {
        id: "shared-owner",
        spec: {
          name: "adapter-shared-owner",
          namespace: "adapter-shared-system",
        },
      });
      const deployment = simple.Deployment({
        id: "applicationDeployment",
        name: spec.name,
        image: spec.image,
      });
      return {
        ready: deployment.status.readyReplicas >= 1,
      };
    },
  );
}

function graph(strategy: "direct" | "kro"): ApplicationDeploymentGraph {
  const connectionDigest = digestApplicationDeploymentValue({
    provider: "kubernetes",
    cluster: "orbstack",
  });
  return {
    apiVersion: "applik8s.deploymentGraph/v1alpha1",
    kind: "ApplicationDeploymentGraph",
    metadata: {
      identity: {
        connection: {
          provider: "kubernetes",
          cluster: "orbstack",
          digest: connectionDigest,
        },
        application: "adapter-app",
        controlPlaneNamespace: "applik8s-system",
        instance: "adapter",
        profile: "test",
      },
      mode: "fresh",
      strategy,
      sourceGraphDigest: digestApplicationDeploymentValue({ app: "adapter-app" }),
      compilerVersion: "test",
    },
    nodes: [
      {
        id: "kubernetes.application",
        kind: "kubernetesComposition",
        contractVersion: 1,
        source: {},
        provider: {
          interface: "KubernetesApplication",
          implementation: "typekro",
          version: "1",
        },
        scope: { connectionDigest, namespace: "applik8s-system" },
        capabilities: { strategies: ["direct", "kro"], alchemy: true },
        configurationDigest: digestApplicationDeploymentValue({
          composition: "adapter-app",
        }),
        inputs: {},
        outputs: [
          {
            name: "status",
            type: "json",
            sensitivity: "public",
            persistence: "state",
          },
        ],
        lifecycle: {
          ownership: "application",
          deletion: "delete",
          adoption: "createOrAdoptExact",
        },
        spec: {
          compositionId: "adapter-app",
          fragmentIds: [],
        },
      },
    ],
    edges: [],
  };
}

function graphWithArtifact(): ApplicationDeploymentGraph {
  const base = graph("direct");
  const root = base.nodes[0];
  if (!root || root.kind !== "kubernetesComposition") {
    throw new Error("Test deployment graph root is missing.");
  }
  // typecast: preserve the fixture's deployment-node discriminants exactly.
  const artifact = {
    id: "artifact.web",
    kind: "artifact",
    contractVersion: 1,
    source: {},
    provider: {
      interface: "Artifact",
      implementation: "typekro-oci",
      version: "1",
    },
    scope: {
      connectionDigest: base.metadata.identity.connection.digest,
    },
    capabilities: { strategies: ["direct", "kro"], alchemy: true },
    configurationDigest: digestApplicationDeploymentValue({ image: "web" }),
    inputs: {},
    outputs: [
      {
        name: "immutableReference",
        type: "artifactReference",
        sensitivity: "public",
        persistence: "state",
      },
    ],
    lifecycle: {
      ownership: "application",
      deletion: "retain",
      adoption: "createOrAdoptExact",
    },
    spec: {
      artifactType: "containerImage",
      sourceDescriptor: {
        name: "web",
        logicalReference: "registry.example/applik8s/web:source",
      },
    },
  } as const;
  // typecast: preserve the registry fixture's deployment-node discriminants exactly.
  const registry = {
    id: "external.registry",
    kind: "externalProvider",
    contractVersion: 1,
    source: { semanticNodeId: "provider.registry" },
    provider: {
      interface: "ContainerRegistry",
      implementation: "typekro-harbor-project",
      version: "1",
    },
    scope: {
      connectionDigest: base.metadata.identity.connection.digest,
      namespace: "adapter-test",
    },
    capabilities: { strategies: ["direct", "kro"], alchemy: true },
    configurationDigest: digestApplicationDeploymentValue({
      project: "adapter",
    }),
    inputs: {},
    outputs: [
      {
        name: "ready",
        type: "boolean",
        sensitivity: "public",
        persistence: "state",
      },
    ],
    lifecycle: {
      ownership: "application",
      deletion: "delete",
      adoption: "createOrAdoptExact",
    },
    spec: {
      controller: "typekro-harbor",
      resourceType: "harborProject",
      configuration: {
        project: "adapter",
        pullSecret: {
          apiVersion: "v1",
          kind: "Secret",
          name: "adapter-registry-pull",
          namespace: "adapter-test",
        },
      },
    },
  } as const;
  return {
    ...base,
    nodes: [
      registry,
      artifact,
      {
        ...root,
        inputs: {
          "artifact.artifact.web": {
            kind: "output",
            nodeId: artifact.id,
            output: "immutableReference",
            sensitivity: "public",
            persistence: "state",
          },
        },
      },
    ],
    edges: [
      {
        from: registry.id,
        to: root.id,
        relationship: "requiresReady",
      },
      {
        from: artifact.id,
        to: root.id,
        relationship: "requiresOutput",
        output: "immutableReference",
      },
      {
        from: artifact.id,
        to: root.id,
        relationship: "publishes",
      },
    ],
  };
}

function graphWithSharedValkeyOperator(): ApplicationDeploymentGraph {
  const base = graph("direct");
  return {
    ...base,
    nodes: [
      {
        id: "direct.provider.index.operator",
        kind: "kubernetesDirect",
        contractVersion: 1,
        source: { semanticNodeId: "provider.index" },
        provider: {
          interface: "IndexStore",
          implementation: "valkey-bootstrap",
          version: "1",
        },
        scope: {
          connectionDigest: base.metadata.identity.connection.digest,
          namespace: "valkey-system",
        },
        capabilities: { strategies: ["direct", "kro"], alchemy: true },
        configurationDigest: digestApplicationDeploymentValue({
          name: "valkey-operator",
          namespace: "valkey-system",
        }),
        inputs: {},
        outputs: [
          {
            name: "ready",
            type: "boolean",
            sensitivity: "public",
            persistence: "state",
          },
        ],
        lifecycle: {
          ownership: "shared",
          deletion: "retain",
          adoption: "createOrAdoptExact",
        },
        spec: {
          compositionId: "valkey-bootstrap",
          reason: "Install the shared operator.",
          configuration: {
            name: "valkey-operator",
            namespace: "valkey-system",
          },
        },
      },
      ...base.nodes,
    ],
    edges: [
      {
        from: "direct.provider.index.operator",
        to: "kubernetes.application",
        relationship: "requiresReady",
      },
    ],
  };
}

function materializedGraph(
  strategy: "direct" | "kro",
): ApplicationDeploymentGraph {
  const base = graphWithArtifact();
  const root = base.nodes.find(
    (node) => node.kind === "kubernetesComposition",
  );
  if (!root || root.kind !== "kubernetesComposition") {
    throw new Error("Test deployment graph root is missing.");
  }
  return {
    ...base,
    metadata: { ...base.metadata, strategy },
    nodes: base.nodes.map((node) =>
      node !== root
        ? node
        : {
            ...node,
            spec: {
              ...node.spec,
              installationSpec: { name: "adapter", enabled: true },
              materialized: {
                resources: [
                  {
                    id: "registryPullSecret",
                    role: "containerRegistryPullSecret",
                    externalRef: {
                      apiVersion: "v1",
                      kind: "Secret",
                      metadata: {
                        name: "adapter-registry-pull",
                        namespace: "adapter-test",
                      },
                    },
                  },
                  {
                    id: "applicationDeployment",
                    template: {
                      apiVersion: "apps/v1",
                      kind: "Deployment",
                      metadata: {
                        name: "${schema.spec.name}",
                        namespace: "adapter-test",
                      },
                      spec: {
                        replicas: 1,
                        selector: { matchLabels: { app: "${schema.spec.name}" } },
                        template: {
                          metadata: {
                            labels: { app: "${schema.spec.name}" },
                          },
                          spec: {
                            containers: [
                              {
                                name: "web",
                                image:
                                  "registry.example/applik8s/web:source",
                                imagePullPolicy: "Never",
                                env: [
                                  {
                                    name: "PUBLIC_URL",
                                    value:
                                      "http://${schema.spec.name}.adapter-test.svc",
                                  },
                                ],
                              },
                            ],
                            imagePullSecrets: [{ name: "existing-pull" }],
                          },
                        },
                      },
                    },
                    includeWhen: ["${schema.spec.enabled}"],
                    readyWhen: [
                      "${applicationDeployment.status.observedGeneration >= applicationDeployment.metadata.generation}",
                    ],
                  },
                  {
                    id: "applicationMigration",
                    template: {
                      apiVersion: "batch/v1",
                      kind: "Job",
                      metadata: {
                        name: "adapter-migration-sha256",
                        namespace: "adapter-test",
                      },
                      spec: {
                        template: {
                          metadata: {
                            labels: { app: "adapter-migration" },
                          },
                          spec: {
                            restartPolicy: "OnFailure",
                            containers: [
                              {
                                name: "migration",
                                image:
                                  "registry.example/applik8s/web:source",
                                imagePullPolicy: "Never",
                              },
                            ],
                          },
                        },
                      },
                    },
                  },
                  {
                    id: "applicationConfig",
                    externalRef: {
                      apiVersion: "v1",
                      kind: "ConfigMap",
                      metadata: {
                        name: '${schema.spec.name + "-config"}',
                        namespace: "adapter-test",
                      },
                    },
                  },
                  {
                    id: "installationContract",
                    template: {
                      apiVersion: "v1",
                      kind: "ConfigMap",
                      metadata: {
                        name: "adapter-installation-contract",
                        namespace: "adapter-test",
                        annotations: {
                          "applik8s.dev/active-application":
                            "${string(schema.spec.enabled)}",
                        },
                      },
                      data: {
                        "spec.json": "${json.marshal(schema.spec)}",
                        version: "0.6.0",
                        artifactDigest: "sha256:adapter",
                      },
                    },
                  },
                ],
                status: {
                  ready:
                    '${installationContract.metadata.annotations["applik8s.dev/active-application"] == "true" ? applicationDeployment.status.readyReplicas >= 1 : true}',
                  observedVersion: "${installationContract.data.version}",
                  artifactDigest:
                    "${installationContract.data.artifactDigest}",
                },
              },
            },
          },
    ),
  };
}

const MaterializedSpec = type({
  name: "string",
  enabled: "boolean",
});

function materializedSourceComposition() {
  const definition = {
    name: "adapter-app",
    apiVersion: "testing.applik8s.dev/v1alpha1",
    kind: "AdapterApp",
    spec: MaterializedSpec,
    status: TestStatus,
  };
  const source = kubernetesComposition(definition, () => ({ ready: true }));
  Object.defineProperty(source, "__applik8sTypeKroDefinition", {
    value: definition,
    enumerable: false,
  });
  return source;
}

describe("TypeKro deployment adapter", () => {
  // typecast: preserve the two deployment strategy literals for parameterized coverage.
  for (const strategy of ["direct", "kro"] as const) {
    it(`lowers one ${strategy} composition through the released 0.32 declarations`, async () => {
      const app = composition();
      const adapted = await adaptApplicationDeploymentToTypeKro({
        graph: graph(strategy),
        root: bindTypeKroComposition(
          app,
          { name: "adapter", image: "nginx:1.27-alpine" },
          {
            factory: {
              namespace: "adapter-test",
              waitForReady: false,
            },
            instanceNameOverride: "adapter",
          },
        ),
      });

      expect(adapted.adapter).toEqual({
        typekro: "0.32.0",
        semanticPlanVersion: 1,
        artifactPlanVersion: 1,
      });
      expect(adapted.root.strategy).toBe(strategy);
      expect(adapted.root.declarations.length).toBeGreaterThan(0);
      expect(adapted.root.semanticPlan.composition).toBe("adapter-app");
      expect(adapted.evidenceDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(adapted.root.declarationDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    });
  }

  it("fails closed when the deployment composition identity is wrong", async () => {
    await expect(
      adaptApplicationDeploymentToTypeKro({
        graph: graph("direct"),
        root: bindTypeKroComposition(composition("different"), {
          name: "adapter",
          image: "nginx:1.27-alpine",
        }),
      }),
    ).rejects.toThrow(/expects composition adapter-app/);
  });

  it("proves graph artifact outputs are consumed through TypeKro artifactOutput bindings", async () => {
    const deploymentGraph = graphWithArtifact();
    const app = artifactComposition();
    const adapted = await adaptApplicationDeploymentToTypeKro({
      graph: deploymentGraph,
      root: bindTypeKroComposition(
        app,
        { name: "adapter" },
        {
          factory: { namespace: "adapter-test", waitForReady: false },
          instanceNameOverride: "adapter",
          artifacts: typeKroArtifactRequirements(
            deploymentGraph,
            "kubernetes.application",
          ),
        },
      ),
    });

    expect(
      adapted.declarations.flatMap(
        (declaration) => declaration.artifactOutputUses ?? [],
      ),
    ).toContainEqual({
      requirementId: "artifact.web",
      output: "immutableReference",
      sensitive: false,
    });
  });

  it("rejects a deployment graph artifact dependency that the composition does not consume", async () => {
    await expect(
      adaptApplicationDeploymentToTypeKro({
        graph: graphWithArtifact(),
        root: bindTypeKroComposition(
          composition(),
          { name: "adapter", image: "nginx:1.27-alpine" },
          {
            factory: { namespace: "adapter-test", waitForReady: false },
            artifacts: [
              {
                id: "artifact.web",
                kind: "container-image",
                descriptor: { imageName: "web" },
                outputs: ["immutableReference"],
              },
            ],
          },
        ),
      }),
    ).rejects.toThrow(/missing from TypeKro composition/);
  });

  it("materializes graph-declared direct providers and maps retained lifecycle to Alchemy", async () => {
    const deploymentGraph = graphWithSharedValkeyOperator();
    const direct = bindApplicationTypeKroDirectNodes(deploymentGraph, {
      namespace: "adapter-test",
      waitForReady: false,
    });
    const adapted = await adaptApplicationDeploymentToTypeKro({
      graph: deploymentGraph,
      root: bindTypeKroComposition(
        composition(),
        { name: "adapter", image: "nginx:1.27-alpine" },
        {
          factory: { namespace: "adapter-test", waitForReady: false },
          instanceNameOverride: "adapter",
        },
      ),
      direct,
    });

    expect(Object.keys(direct)).toEqual(["direct.provider.index.operator"]);
    expect(adapted.direct).toHaveLength(1);
    expect(adapted.direct[0]?.strategy).toBe("direct");
    expect(
      adapted.direct[0]?.declarations.every(
        (declaration) => declaration.props.retain === true,
      ),
    ).toBe(true);
    const directIds = new Set(
      adapted.direct[0]?.declarations.map((declaration) => declaration.id),
    );
    const rootDeclarations = adapted.declarations.filter((declaration) =>
      !directIds.has(declaration.id),
    );
    expect(
      rootDeclarations.every((declaration) =>
        declaration.dependsOn.every((dependency) => !directIds.has(dependency)),
      ),
    ).toBe(true);
    expect(
      Math.max(
        ...adapted.declarations
          .map((declaration, index) => ({ declaration, index }))
          .filter(({ declaration }) => directIds.has(declaration.id))
          .map(({ index }) => index),
      ),
    ).toBeLessThan(
      Math.min(
        ...adapted.declarations
          .map((declaration, index) => ({ declaration, index }))
          .filter(({ declaration }) => !directIds.has(declaration.id))
          .map(({ index }) => index),
      ),
    );
  });

  it("retains TypeKro singleton owners and their hoisted namespaces across application stack destroy", async () => {
    const adapted = await adaptApplicationDeploymentToTypeKro({
      graph: graph("kro"),
      root: bindTypeKroComposition(
        compositionWithSharedOwner(),
        { name: "adapter", image: "nginx:1.27-alpine" },
        {
          factory: { namespace: "adapter-test", waitForReady: false },
          instanceNameOverride: "adapter",
        },
      ),
    });

    const retainedKinds = adapted.root.declarations
      .filter((declaration) => declaration.props.retain === true)
      .map((declaration) => declaration.props.resource.kind)
      .sort();
    expect(retainedKinds).toEqual([
      "AdapterSharedOwner",
      "Namespace",
      "ResourceGraphDefinition",
    ]);
    const application = adapted.root.declarations.find(
      (declaration) => declaration.props.resource.kind === "AdapterApp",
    );
    const applicationRgd = adapted.root.declarations.find(
      (declaration) =>
        declaration.props.resource.kind === "ResourceGraphDefinition" &&
        declaration.props.resource.metadata.name === "adapter-app",
    );
    expect(application?.props.retain).not.toBe(true);
    expect(applicationRgd?.props.retain).not.toBe(true);
  });

  it("keeps supporting-composition ordering out of TypeKro canonical dependencies", async () => {
    const binding = bindTypeKroCompositionWithSupportingDeclarations(
      bindTypeKroComposition(
        composition(),
        { name: "adapter", image: "nginx:1.27-alpine" },
        {
          factory: { namespace: "adapter-test", waitForReady: false },
          instanceNameOverride: "adapter",
        },
      ),
      bindTypeKroComposition(
        compositionWithSharedOwner(),
        { name: "adapter", image: "nginx:1.27-alpine" },
        {
          factory: { namespace: "adapter-test", waitForReady: false },
          instanceNameOverride: "adapter",
        },
      ),
    );

    const declarations = await binding.declarations("kro");
    const rootRgd = declarations.find(
      (declaration) =>
        declaration.props.resource.kind === "ResourceGraphDefinition" &&
        declaration.props.resource.metadata.name === "adapter-app",
    );
    const rootInstance = declarations.find(
      (declaration) => declaration.props.resource.kind === "AdapterApp",
    );
    const supportingInstance = declarations.find(
      (declaration) =>
        declaration.props.resource.kind === "AdapterSharedOwner",
    );
    expect(rootRgd).toBeDefined();
    expect(rootInstance).toBeDefined();
    expect(supportingInstance).toBeDefined();
    expect(rootRgd?.dependsOn).toEqual([]);
    expect(rootRgd?.orderingOnlyDependsOn).toEqual([
      supportingInstance?.id,
    ]);
    expect(rootInstance?.dependsOn).toEqual([rootRgd?.id]);
  });

  // typecast: preserve the two deployment strategy literals for parameterized coverage.
  for (const strategy of ["direct", "kro"] as const) {
    it(`reconstructs the compiler's complete materialized graph in ${strategy} mode`, async () => {
      const deploymentGraph = materializedGraph(strategy);
      const assembled = assembleApplicationTypeKroComposition(
        deploymentGraph,
        materializedSourceComposition(),
      );
      const adapted = await adaptApplicationDeploymentToTypeKro({
        graph: deploymentGraph,
        root: bindTypeKroComposition(
          assembled,
          { name: "adapter", enabled: true },
          {
            factory: {
              namespace: "adapter-test",
              waitForReady: false,
            },
            instanceNameOverride: "adapter",
            artifacts: typeKroArtifactRequirements(
              deploymentGraph,
              "kubernetes.application",
            ),
          },
        ),
      });

      expect(adapted.root.strategy).toBe(strategy);
      expect(adapted.root.semanticPlan.nodeCount).toBeGreaterThanOrEqual(2);
      expect(
        adapted.declarations.flatMap(
          (declaration) => declaration.artifactOutputUses ?? [],
        ),
      ).toContainEqual({
        requirementId: "artifact.web",
        output: "immutableReference",
        sensitive: false,
      });
      const serializedDeclarations = JSON.stringify(adapted.declarations);
      expect(serializedDeclarations).not.toContain("json.marshal(undefined)");
      expect(serializedDeclarations).toContain(
        '"imagePullPolicy":"IfNotPresent"',
      );
      expect(serializedDeclarations).toContain('"name":"existing-pull"');
      expect(serializedDeclarations).toContain('"name":"adapter-registry-pull"');
      if (strategy === "kro") {
        expect(serializedDeclarations).toContain(
          "registryPullSecret.metadata.resourceVersion",
        );
        const rootRgd = adapted.declarations.find(
          (declaration) =>
            declaration.props.resource.kind === "ResourceGraphDefinition" &&
            declaration.props.resource.metadata.name === "adapter-app",
        );
        // typecast: the generic Kubernetes declaration intentionally exposes an untyped spec; this test inspects only its generated RGD surface.
        const rootRgdSpec = rootRgd?.props.resource.spec as {
          resources?: readonly {
            id?: string;
            template?: {
              spec?: {
                template?: {
                  metadata?: {
                    annotations?: Readonly<Record<string, unknown>>;
                  };
                  spec?: {
                    imagePullSecrets?: readonly {
                      readonly name?: unknown;
                    }[];
                  };
                };
              };
            };
            includeWhen?: readonly string[];
          }[];
          schema?: {
            status?: {
              ready?: string;
              observedVersion?: string;
              artifactDigest?: string;
            };
          };
        };
        const deploymentTemplate = rootRgdSpec?.resources?.find(
          (resource) => resource.id === "applicationDeployment",
        );
        const migrationTemplate = rootRgdSpec?.resources?.find(
          (resource) => resource.id === "applicationMigration",
        );
        expect(deploymentTemplate?.includeWhen).toEqual([
          "${schema.spec.enabled}",
        ]);
        expect(
          deploymentTemplate?.template?.spec?.template?.metadata?.annotations,
        ).not.toHaveProperty("applik8s.dev/include-when");
        expect(JSON.stringify(deploymentTemplate)).toContain(
          "registry-pull-secret-resource-version",
        );
        expect(JSON.stringify(migrationTemplate)).not.toContain(
          "registry-pull-secret-resource-version",
        );
        expect(
          migrationTemplate?.template?.spec?.template?.spec?.imagePullSecrets,
        ).toContainEqual({ name: "adapter-registry-pull" });
        const ready = rootRgdSpec?.schema?.status?.ready;
        const status = rootRgdSpec?.schema?.status;
        expect(ready).toContain(
          'installationContract.metadata.annotations["applik8s.dev/active-application"]',
        );
        expect(ready).not.toContain("schema.spec");
        expect(status?.observedVersion).toBe(
          "${installationContract.data.version}",
        );
        expect(status?.artifactDigest).toBe(
          "${installationContract.data.artifactDigest}",
        );
        expect(serializedDeclarations).toContain("json.marshal(schema.spec)");
        expect(serializedDeclarations).toContain(
          'installationContract.metadata.annotations[\\"applik8s.dev/active-application\\"]',
        );
        expect(serializedDeclarations).not.toContain(
          'schema.spec.enabled == \\"true\\" ? applicationDeployment.status',
        );
      } else {
        expect(adapted.declarations).toContainEqual(
          expect.objectContaining({
            props: expect.objectContaining({
              resource: expect.objectContaining({
                kind: "ConfigMap",
                data: expect.objectContaining({
                  "spec.json": '{"name":"adapter","enabled":true}',
                }),
              }),
            }),
          }),
        );
      }
    });
  }
});
