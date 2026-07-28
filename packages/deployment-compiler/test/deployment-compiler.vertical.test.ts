import type { ApplicationGraph } from "@applik8s/core";
import {
  digestApplicationDeploymentGraph,
  validateApplicationDeploymentGraph,
} from "@applik8s/deployment-contract";
import { describe, expect, it } from "vitest";

// typecast-file-boundary: Test fixtures preserve literal discriminants while
// exercising the public portable compiler contract.
import {
  compileApplicationDeploymentGraph,
  type ApplicationDeploymentContributor,
} from "../src/index.js";

const sourceGraphDigest = `sha256:${"a".repeat(64)}`;
const connectionDigest = `sha256:${"b".repeat(64)}`;

describe("Application deployment compiler", () => {
  it("lowers artifacts, providers, and the root composition deterministically", () => {
    const first = compileApplicationDeploymentGraph(request());
    const second = compileApplicationDeploymentGraph({
      ...request(),
      artifacts: [...request().artifacts].reverse(),
    });
    expect(validateApplicationDeploymentGraph(first.graph).valid).toBe(true);
    expect(digestApplicationDeploymentGraph(first.graph)).toBe(
      digestApplicationDeploymentGraph(second.graph),
    );
    expect(first.graph.nodes.map(({ id }) => id)).toEqual([
      "artifact.web",
      "direct.namespace.control-plane",
      "direct.namespace.workload",
      "kubernetes.application",
    ]);
    expect(first.graph.edges).toEqual(
      expect.arrayContaining([
        {
          from: "artifact.web",
          to: "kubernetes.application",
          relationship: "requiresOutput",
          output: "immutableReference",
        },
      ]),
    );
  });

  it("uses one exact contributor registration without executing effects", () => {
    let invocations = 0;
    const contributor: ApplicationDeploymentContributor = {
      interface: "ModelStore",
      implementation: "postgres",
      version: 1,
      contribute(provider, context) {
        invocations += 1;
        return {
          nodes: [],
          edges: [],
          compositionFragments: [
            {
              id: "provider:model-store",
              sourceNodeId: provider.id,
              providerInterface: provider.interface,
              providerImplementation: provider.implementation,
              profile: context.profile,
            },
          ],
        };
      },
    };
    const result = compileApplicationDeploymentGraph({
      ...request(),
      contributors: [contributor],
    });
    expect(invocations).toBe(1);
    expect(result.contributorKeys).toEqual(["ModelStore\u0000postgres@1"]);
    expect(
      result.graph.nodes.find(({ id }) => id === "kubernetes.application")?.spec,
    ).toMatchObject({
      fragments: [
        {
          id: "provider:model-store",
          sourceNodeId: "provider.model-store",
          profile: "local",
        },
      ],
    });
  });

  it("lowers generated credentials as public references consumed through an output edge", () => {
    const result = compileApplicationDeploymentGraph({
      ...request(),
      generatedSecrets: [
        {
          id: "gateway.guestbook.cursor",
          namespace: "guestbook",
          name: "guestbook-cursor",
          values: {
            key: {
              kind: "random",
              bytes: 48,
              encoding: "base64url",
            },
          },
          consumers: ["gateway.guestbook"],
        },
      ],
    });
    const secret = result.graph.nodes.find(
      ({ id }) =>
        id ===
        "external.generated-secret.gateway.guestbook.cursor",
    );
    expect(secret?.outputs.map(({ name }) => name)).toEqual([
      "reference",
      "name",
      "namespace",
    ]);
    expect(result.graph.edges).toContainEqual({
      from: "external.generated-secret.gateway.guestbook.cursor",
      to: "kubernetes.application",
      relationship: "requiresOutput",
      output: "name",
    });
    expect(secret?.spec.configuration).toMatchObject({
      values: {
        key: { kind: "random", bytes: 48, encoding: "base64url" },
      },
    });
  });

  it("rejects duplicate contributor identities", () => {
    const contributor: ApplicationDeploymentContributor = {
      interface: "ModelStore",
      implementation: "postgres",
      version: 1,
      contribute: () => ({
        nodes: [],
        edges: [],
        compositionFragments: [],
      }),
    };
    expect(() =>
      compileApplicationDeploymentGraph({
        ...request(),
        contributors: [contributor, contributor],
      }),
    ).toThrow("Duplicate application deployment contributor");
  });

  it("fails closed when a provider has no exact deployment contributor", () => {
    const graph = applicationGraph();
    const provider = graph.nodes[0];
    if (!provider || provider.kind !== "provider") {
      throw new Error("Provider fixture is missing.");
    }
    expect(() =>
      compileApplicationDeploymentGraph({
        ...request(),
        graph: {
          ...graph,
          nodes: [
            {
              ...provider,
              implementation: "unregistered-postgres",
            },
          ],
        },
      }),
    ).toThrow(
      /no deployment contributor for ModelStore\/unregistered-postgres/,
    );
  });

  it("makes managed Harbor a first-class prerequisite of every artifact", () => {
    const graph = applicationGraph();
    const result = compileApplicationDeploymentGraph({
      ...request(),
      graph: {
        ...graph,
        nodes: [
          {
            id: "provider.container-registry",
            kind: "provider",
            name: "ContainerRegistry",
            stability: "stable",
            interface: "ContainerRegistry",
            implementation: "application-provider-selection",
            config: {
              containerRegistry: {
                kind: "harbor-container-registry",
                endpoint: {
                  kind: "kubernetes-node-port",
                  namespace: "harbor",
                  service: "harbor",
                  port: 32080,
                  protocol: "http",
                },
                project: "guestbook",
                pushCredentials: {
                  apiVersion: "v1",
                  kind: "Secret",
                  namespace: "guestbook",
                  name: "registry-push",
                  dockerConfigJsonKey: ".dockerconfigjson",
                },
                pullSecret: {
                  apiVersion: "v1",
                  kind: "Secret",
                  namespace: "guestbook",
                  name: "registry-pull",
                },
                management: {
                  adminCredentials: {
                    apiVersion: "v1",
                    kind: "Secret",
                    namespace: "harbor",
                    name: "harbor-admin",
                    username: "admin",
                    passwordKey: "password",
                  },
                  secretNamespace: "guestbook",
                  projectLifecycle: { deletionPolicy: "retain" },
                },
              },
            },
          },
        ],
      },
    });
    const harbor = result.graph.nodes.find(
      ({ id }) => id === "external.provider.container-registry.harbor-project",
    );
    expect(harbor).toMatchObject({
      kind: "externalProvider",
      provider: {
        interface: "ContainerRegistry",
        implementation: "typekro-harbor-project",
      },
      lifecycle: { deletion: "retain" },
    });
    expect(result.graph.edges).toContainEqual({
      from: "external.provider.container-registry.harbor-project",
      to: "artifact.web",
      relationship: "requiresReady",
    });
  });

  it("compiles direct registry and structured-generation provider implementations", () => {
    const graph = applicationGraph();
    const provider = graph.nodes[0];
    if (!provider || provider.kind !== "provider") {
      throw new Error("Provider fixture is missing.");
    }
    const result = compileApplicationDeploymentGraph({
      ...request(),
      graph: {
        ...graph,
        nodes: [
          {
            id: "provider.container-registry",
            kind: "provider",
            name: "ContainerRegistry",
            stability: "stable",
            interface: "ContainerRegistry",
            implementation: "harbor-container-registry",
            config: {
              containerRegistry: {
                kind: "harbor-container-registry",
                endpoint: {
                  kind: "kubernetes-node-port",
                  namespace: "harbor",
                  service: "harbor",
                  port: 32080,
                  protocol: "http",
                },
                project: "guestbook",
                management: {
                  adminCredentials: {
                    apiVersion: "v1",
                    kind: "Secret",
                    namespace: "harbor",
                    name: "harbor-admin",
                    username: "admin",
                    passwordKey: "password",
                  },
                  secretNamespace: "guestbook",
                },
              },
            },
          },
          {
            ...provider,
            id: "provider.structured-generation",
            name: "StructuredGeneration",
            interface: "StructuredGeneration",
            implementation: "structured-generation-deterministic",
            config: {
              bindingKind: "provided",
              provider: "structured-generation-deterministic",
            },
          },
        ],
      },
    });

    expect(result.contributorKeys).toEqual(
      expect.arrayContaining([
        "ContainerRegistry\u0000harbor-container-registry@1",
        "StructuredGeneration\u0000structured-generation-deterministic@1",
      ]),
    );
    expect(
      result.graph.nodes.find(
        ({ id }) =>
          id === "external.provider.container-registry.harbor-project",
      ),
    ).toBeDefined();
  });

  it("lowers direct provider lifecycle boundaries into graph-owned TypeKro nodes", () => {
    const graph = applicationGraph();
    const result = compileApplicationDeploymentGraph({
      ...request(),
      graph: {
        ...graph,
        metadata: { ...graph.metadata, namespace: "guestbook" },
        nodes: [
          {
            id: "provider.index",
            kind: "provider",
            name: "IndexStore",
            stability: "stable",
            interface: "IndexStore",
            implementation: "valkey",
            config: {
              indexStore: {
                kind: "valkey",
                provision: true,
                provisioner: "hyperspike",
                name: "guestbook-index",
                namespace: "guestbook",
                operator: {
                  provision: true,
                  name: "valkey-operator",
                  namespace: "valkey-system",
                },
                topology: { shards: 1, replicas: 0 },
                storage: { size: "1Gi" },
              },
            },
          },
          {
            id: "provider.models",
            kind: "provider",
            name: "ModelStore",
            stability: "stable",
            interface: "ModelStore",
            implementation: "postgres",
            config: {
              modelStore: {
                kind: "postgres",
                ownership: "direct-provisioned",
                name: "guestbook",
                namespace: "guestbook",
                database: "guestbook",
                lifecycle: { deletionPolicy: "retain" },
                instances: 1,
                storage: { size: "2Gi" },
              },
            },
          },
          {
            id: "provider.objects",
            kind: "provider",
            name: "ObjectStorage",
            stability: "stable",
            interface: "ObjectStorage",
            implementation: "s3",
            config: {
              objectStorage: {
                kind: "s3",
                enabled: true,
                ownership: "direct-provisioned",
                bucket: "guestbook-media",
                region: "us-east-1",
                credentialsSecret: {
                  apiVersion: "v1",
                  kind: "Secret",
                  namespace: "guestbook",
                  name: "guestbook-media",
                },
                provisioning: {
                  enabled: true,
                  claimName: "guestbook-media",
                  storageClassName: "rook-bucket",
                },
              },
            },
          },
        ],
      },
    });
    const direct = result.graph.nodes.filter(
      (node) => node.kind === "kubernetesDirect",
    );
    expect(direct.map((node) => node.spec.compositionId)).toEqual([
      "valkey-bootstrap",
      "applik8s-valkey-cluster-provider",
      "applik8s-postgres-cluster-provider",
      "rook-object-storage-claim",
      "applik8s-namespace",
      "applik8s-namespace",
    ]);
    expect(direct.find((node) => node.id.endsWith(".operator"))?.lifecycle).toMatchObject({
      ownership: "shared",
      deletion: "retain",
    });
    expect(direct.find((node) => node.id === "direct.provider.models.cluster")?.lifecycle).toMatchObject({
      deletion: "retain",
    });
    expect(result.graph.edges).toContainEqual({
      from: "direct.provider.index.operator",
      to: "direct.provider.index.cluster",
      relationship: "installsApi",
    });
    for (const node of direct) {
      expect(result.graph.edges).toContainEqual({
        from: node.id,
        to: "kubernetes.application",
        relationship: "requiresReady",
      });
    }
  });
});

function request() {
  return {
    graph: applicationGraph(),
    sourceGraphDigest,
    compilerVersion: "0.6.0",
    identity: {
      connection: {
        provider: "kubernetes",
        cluster: "orbstack",
        digest: connectionDigest,
      },
      application: "guestbook",
      controlPlaneNamespace: "applik8s-system",
      instance: "guestbook",
      profile: "local",
    },
    strategy: "kro" as const,
    installationSpec: { name: "guestbook", profile: "local" },
    artifacts: [
      {
        id: "artifact.web",
        artifactType: "containerImage" as const,
        name: "guestbook-web",
        sourceDigest: sourceGraphDigest,
        sourceDescriptor: { context: "./web" },
        logicalReference: "applik8s/guestbook-web:source",
      },
    ],
  };
}

function applicationGraph(): ApplicationGraph {
  return {
    apiVersion: "applik8s.appGraph/v1alpha1",
    kind: "ApplicationGraph",
    metadata: { name: "guestbook" },
    nodes: [
      {
        id: "provider.model-store",
        kind: "provider",
        name: "ModelStore",
        stability: "stable",
        interface: "ModelStore",
        implementation: "postgres",
        config: {},
      },
    ],
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
