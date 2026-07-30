import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  type ApplicationDeploymentGraph,
  digestApplicationDeploymentGraph,
  digestApplicationDeploymentValue,
} from "@applik8s/deployment-contract";
import {
  adaptApplicationDeploymentToTypeKro,
  bindTypeKroComposition,
} from "@applik8s/deployment-typekro";
import { type } from "arktype";
import { kubernetesComposition, simple } from "typekro";
import { afterEach, describe, expect, it } from "vitest";
import {
  createApplicationAlchemyGraphDeployment,
  createApplicationAlchemyDeployment,
} from "../src/index.js";
import { selectPublishedImmutableReference } from "../src/backend.js";
import {
  withOrderingOnlyPrerequisites,
} from "../src/typekro-ordering.js";
import { typeKroMaterializationComponents } from "../src/typekro-components.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const path of temporaryDirectories.splice(0)) {
    await rm(path, { recursive: true, force: true });
  }
});

describe("Alchemy deployment backend", () => {
  it("upgrades legacy artifact state without losing its immutable base image", () => {
    expect(
      selectPublishedImmutableReference(
        undefined,
        "registry.example.test/applik8s/operator-host@sha256:legacy",
      ),
    ).toBe("registry.example.test/applik8s/operator-host@sha256:legacy");
    expect(
      selectPublishedImmutableReference(
        "127.0.0.1:32080/applik8s/operator-host@sha256:published",
        "harbor.registry.svc/applik8s/operator-host@sha256:published",
      ),
    ).toBe(
      "127.0.0.1:32080/applik8s/operator-host@sha256:published",
    );
    expect(() =>
      selectPublishedImmutableReference(undefined, undefined),
    ).toThrow(/neither a published nor deployment immutable reference/);
  });

  it("previews TypeKro declarations through Alchemy without mutating Kubernetes", async () => {
    const stateRoot = await mkdtemp(
      join(process.env.TMPDIR ?? "/tmp", "applik8s-alchemy-plan-"),
    );
    temporaryDirectories.push(stateRoot);
    const graph = deploymentGraph();
    const composition = kubernetesComposition(
      {
        name: "alchemy-plan",
        apiVersion: "testing.applik8s.dev/v1alpha1",
        kind: "AlchemyPlan",
        spec: type({ name: "string" }),
        status: type({ ready: "boolean" }),
      },
      (spec) => {
        simple.ConfigMap({
          id: "applicationConfig",
          name: spec.name,
          data: { planned: "true" },
        });
        return { ready: true };
      },
    );
    const adapted = await adaptApplicationDeploymentToTypeKro({
      graph,
      root: bindTypeKroComposition(
        composition,
        { name: "alchemy-plan" },
        {
          factory: {
            namespace: "alchemy-plan",
            waitForReady: false,
          },
          instanceNameOverride: "alchemy-plan",
        },
      ),
    });
    const deployment = createApplicationAlchemyDeployment({
      graph,
      adapted,
      stateRoot,
      stage: "test",
      owner: "vertical-test",
    });

    const plan = await deployment.plan();
    expect(plan.stack.key).toMatch(/^applik8s-alchemy-plan-/);
    expect(plan.changes).toEqual([
      expect.objectContaining({
        type: "TypeKro.KroResource",
        action: "create",
      }),
    ]);
    expect(plan.declarationCount).toBe(1);
    expect(plan.planIdentityDigest).toBe(
      digestApplicationDeploymentGraph(graph),
    );
  });

  it("adds outer graph prerequisites to declarations with native TypeKro dependencies", async () => {
    const graph = deploymentGraph();
    const composition = kubernetesComposition(
      {
        name: "alchemy-plan",
        apiVersion: "testing.applik8s.dev/v1alpha1",
        kind: "AlchemyOrdering",
        spec: type({ name: "string" }),
        status: type({ ready: "boolean" }),
      },
      (spec) => {
        simple.ConfigMap({
          id: "applicationConfig",
          name: spec.name,
          data: { planned: "true" },
        });
        return { ready: true };
      },
    );
    const adapted = await adaptApplicationDeploymentToTypeKro({
      graph,
      root: bindTypeKroComposition(
        composition,
        { name: "alchemy-ordering" },
        {
          factory: {
            namespace: "alchemy-ordering",
            waitForReady: false,
          },
          instanceNameOverride: "alchemy-ordering",
        },
      ),
    });
    const base = adapted.root.declarations[0];
    if (!base) throw new Error("Expected one TypeKro declaration.");
    const declaration = {
      ...base,
      dependsOn: ["native-typekro-prerequisite"],
    };

    const [ordered] = withOrderingOnlyPrerequisites(
      [declaration],
      [{ ready: true }],
    );

    expect(ordered?.dependsOn).toEqual(["native-typekro-prerequisite"]);
    expect(ordered?.props).toHaveProperty(
      "applik8sOrderingPrerequisites",
    );
    expect(ordered?.props.dependencies).toBe(base.props.dependencies);
  });

  it("materializes host-ordered bundles separately without changing canonical dependencies", async () => {
    const graph = deploymentGraph();
    const composition = kubernetesComposition(
      {
        name: "alchemy-plan",
        apiVersion: "testing.applik8s.dev/v1alpha1",
        kind: "AlchemyOrdering",
        spec: type({ name: "string" }),
        status: type({ ready: "boolean" }),
      },
      (spec) => {
        simple.ConfigMap({
          id: "applicationConfig",
          name: spec.name,
          data: { planned: "true" },
        });
        return { ready: true };
      },
    );
    const adapted = await adaptApplicationDeploymentToTypeKro({
      graph,
      root: bindTypeKroComposition(
        composition,
        { name: "alchemy-ordering" },
        {
          factory: { namespace: "alchemy-plan", waitForReady: false },
          instanceNameOverride: "alchemy-ordering",
        },
      ),
    });
    const [base] = adapted.root.declarations;
    if (!base) throw new Error("Expected one canonical declaration.");
    const supportingRgd = { ...base, id: "supporting-rgd", dependsOn: [] };
    const supportingInstance = {
      ...base,
      id: "supporting-instance",
      dependsOn: ["supporting-rgd"],
    };
    const rootRgd = {
      ...base,
      id: "root-rgd",
      dependsOn: [],
      orderingOnlyDependsOn: ["supporting-instance"],
    };
    const rootInstance = {
      ...base,
      id: "root-instance",
      dependsOn: ["root-rgd"],
    };

    const components = typeKroMaterializationComponents([
      supportingRgd,
      supportingInstance,
      rootRgd,
      rootInstance,
    ]);

    expect(components.map((component) => component.declarations.map(({ id }) => id))).toEqual([
      ["supporting-rgd", "supporting-instance"],
      ["root-rgd", "root-instance"],
    ]);
    expect(components[1]?.orderingOnlyDeclarationIds).toEqual([
      "supporting-instance",
    ]);
    expect(rootRgd.dependsOn).toEqual([]);
    expect(rootInstance.dependsOn).toEqual(["root-rgd"]);
  });

  it("fails closed instead of silently ignoring an unmaterialized provider node", () => {
    const graph = deploymentGraph();
    const root = graph.nodes[0];
    if (!root) throw new Error("Deployment graph fixture is missing.");
    expect(() =>
      createApplicationAlchemyDeployment({
        graph: {
          ...graph,
          nodes: [
            root,
            {
              ...root,
              id: "external.dns",
              kind: "externalProvider",
              provider: {
                interface: "DnsPublication",
                implementation: "external-api",
                version: "1",
              },
              lifecycle: {
                ownership: "application",
                deletion: "delete",
                adoption: "createOrAdoptExact",
              },
              spec: {
                resourceType: "dns-record",
                controller: "alchemy",
              },
            },
          ],
        },
        adapted: {
          adapter: {
            typekro: "0.32.0",
            semanticPlanVersion: 1,
            artifactPlanVersion: 1,
          },
          root: {
            deploymentNodeId: "kubernetes.application",
            strategy: "direct",
            declarations: [],
            declarationDigest: digestApplicationDeploymentValue([]),
            semanticPlan: {
              version: 1,
              composition: "alchemy-plan",
              inputDigest: "a",
              semanticContentDigest: "b",
              planIdentityDigest: "c",
              nodeCount: 0,
              edgeCount: 0,
              diagnostics: [],
            },
          },
          direct: [],
          declarations: [],
          declarationCount: 0,
          materializationDigest: digestApplicationDeploymentValue([]),
          evidenceDigest: digestApplicationDeploymentValue([]),
        },
        stateRoot: "/tmp/unused",
      }),
    ).toThrow(/no registered materializer.*external\.dns/);
  });

  it("plans a managed Harbor project as an artifact prerequisite", async () => {
    const stateRoot = await mkdtemp(
      join(process.env.TMPDIR ?? "/tmp", "applik8s-alchemy-harbor-"),
    );
    temporaryDirectories.push(stateRoot);
    const base = deploymentGraph();
    const root = base.nodes[0];
    if (!root) throw new Error("Deployment graph fixture is missing.");
    const graph: ApplicationDeploymentGraph = {
      ...base,
      nodes: [
        {
          ...root,
          id: "external.registry.harbor",
          kind: "externalProvider",
          provider: {
            interface: "ContainerRegistry",
            implementation: "typekro-harbor-project",
            version: "1",
          },
          scope: {
            ...root.scope,
            namespace: "alchemy-plan",
          },
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
            deletion: "retain",
            adoption: "createOrAdoptExact",
          },
          spec: {
            resourceType: "harborProject",
            controller: "typekro-harbor",
            configuration: {
              kind: "harbor-container-registry",
              pushCredentials: {
                apiVersion: "v1",
                kind: "Secret",
                namespace: "alchemy-plan",
                name: "registry-push",
              },
              pullSecret: {
                apiVersion: "v1",
                kind: "Secret",
                namespace: "alchemy-plan",
                name: "registry-pull",
              },
              management: {
                secretNamespace: "alchemy-plan",
                adminCredentials: {
                  apiVersion: "v1",
                  kind: "Secret",
                  namespace: "harbor",
                  name: "harbor-admin",
                  username: "admin",
                  passwordKey: "password",
                },
              },
            },
          },
        },
        root,
      ],
      edges: [
        {
          from: "external.registry.harbor",
          to: root.id,
          relationship: "requiresReady",
        },
      ],
    };
    const composition = kubernetesComposition(
      {
        name: "alchemy-plan",
        apiVersion: "testing.applik8s.dev/v1alpha1",
        kind: "AlchemyPlan",
        spec: type({ name: "string" }),
        status: type({ ready: "boolean" }),
      },
      () => {
        simple.ConfigMap({
          id: "applicationConfig",
          name: "alchemy-plan",
          data: { planned: "true" },
        });
        return { ready: true };
      },
    );
    const adapted = await adaptApplicationDeploymentToTypeKro({
      graph,
      root: bindTypeKroComposition(composition, { name: "alchemy-plan" }, {
        factory: { namespace: "alchemy-plan", waitForReady: false },
      }),
    });
    const deployment = createApplicationAlchemyDeployment({
      graph,
      adapted,
      stateRoot,
      artifactRegistry: {
        type: "harbor",
        registry: "http://127.0.0.1:32080",
        project: "alchemy-plan",
        tls: { plainHttp: true },
      },
      harborProvider: {
        resolveCredential: async () => ({
          username: "unused-during-plan",
          password: "unused-during-plan",
        }),
      },
    });
    const plan = await deployment.plan();
    expect(plan.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "Applik8s.HarborProject" }),
        expect.objectContaining({ type: "TypeKro.KroResource" }),
      ]),
    );
  });

  it("prepares a complete materialized application without exposing adapter sequencing", async () => {
    const stateRoot = await mkdtemp(
      join(process.env.TMPDIR ?? "/tmp", "applik8s-alchemy-application-"),
    );
    temporaryDirectories.push(stateRoot);
    const graph = deploymentGraph();
    const root = graph.nodes[0];
    if (!root || root.kind !== "kubernetesComposition") {
      throw new Error("Deployment graph fixture is missing its root.");
    }
    const materialized = {
      ...graph,
      nodes: [
        {
          ...root,
          spec: {
            ...root.spec,
            materialized: {
              resources: [
                {
                  id: "applicationConfig",
                  template: {
                    apiVersion: "v1",
                    kind: "ConfigMap",
                    metadata: {
                      name: "${schema.spec.name}",
                      namespace: "alchemy-plan",
                    },
                    data: { planned: "true" },
                  },
                },
              ],
              status: { ready: "${true}" },
            },
          },
        },
      ],
    } satisfies ApplicationDeploymentGraph;
    const definition = {
      name: "alchemy-plan",
      apiVersion: "testing.applik8s.dev/v1alpha1",
      kind: "AlchemyPlan",
      spec: type({ name: "string" }),
      status: type({ ready: "boolean" }),
    };
    const source = kubernetesComposition(definition, () => ({ ready: true }));
    Object.defineProperty(source, "__applik8sTypeKroDefinition", {
      value: definition,
      enumerable: false,
    });

    const deployment = await createApplicationAlchemyGraphDeployment({
      graph: materialized,
      source,
      spec: { name: "alchemy-plan" },
      stateRoot,
      stage: "test",
      owner: "application-vertical-test",
      factory: {
        namespace: "alchemy-plan",
        waitForReady: false,
      },
    });
    const plan = await deployment.plan();
    expect(plan.declarationCount).toBe(1);
    expect(plan.changes).toEqual([
      expect.objectContaining({
        type: "TypeKro.KroResource",
        action: "create",
      }),
    ]);
  });
});

function deploymentGraph(): ApplicationDeploymentGraph {
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
        application: "alchemy-plan",
        controlPlaneNamespace: "applik8s-system",
        instance: "alchemy-plan",
        profile: "test",
      },
      mode: "fresh",
      strategy: "direct",
      sourceGraphDigest: digestApplicationDeploymentValue({
        app: "alchemy-plan",
      }),
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
          composition: "alchemy-plan",
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
          compositionId: "alchemy-plan",
          fragmentIds: [],
        },
      },
    ],
    edges: [],
  };
}
