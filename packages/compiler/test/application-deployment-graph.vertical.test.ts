import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    expect(first.artifactCount).toBe(3);
    expect(first.digest).toBe(second.digest);
    expect(first.digest).toBe(digestApplicationDeploymentGraph(first.graph));
    expect(first.graph.nodes.map(({ id }) => id)).toEqual([
      "artifact.agent.researcher",
      "artifact.mcp.tools",
      "artifact.operator.notes-operator",
      "direct.namespace.workload",
      "kubernetes.application",
    ]);
    expect(
      first.graph.nodes.filter((node) => node.kind === "kubernetesDirect"),
    ).toMatchObject([
      {
        id: "direct.namespace.workload",
        spec: {
          compositionId: "applik8s-namespace",
          configuration: { name: "notes" },
        },
      },
    ]);
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
