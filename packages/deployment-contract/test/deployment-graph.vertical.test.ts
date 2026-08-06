import { describe, expect, it } from "vitest";
import {
  applicationDeploymentOutputReference,
  applicationOptionalDeploymentOutputReference,
  type ApplicationDeploymentGraph,
  ApplicationDeploymentGraphDecodeError,
  type ApplicationDeploymentNode,
  decodeApplicationDeploymentGraph,
  digestApplicationDeploymentGraph,
  normalizeApplicationDeploymentGraph,
  parseApplicationDeploymentOutputReference,
  serializeApplicationDeploymentGraph,
  validateApplicationDeploymentGraph,
} from "../src/index.js";

const digest = `sha256:${"a".repeat(64)}`;
const connectionDigest = `sha256:${"b".repeat(64)}`;

describe("ApplicationDeploymentGraph", () => {
  it("round-trips required and profile-optional deployment output references", () => {
    const required = applicationDeploymentOutputReference(
      "direct.provider.ai/envoy",
      "status.endpoint",
    );
    const optional = applicationOptionalDeploymentOutputReference(
      "direct.provider.ai/envoy",
      "status.endpoint",
    );
    expect(parseApplicationDeploymentOutputReference(required)).toEqual({
      nodeId: "direct.provider.ai/envoy",
      output: "status.endpoint",
      optional: false,
    });
    expect(parseApplicationDeploymentOutputReference(optional)).toEqual({
      nodeId: "direct.provider.ai/envoy",
      output: "status.endpoint",
      optional: true,
    });
    expect(parseApplicationDeploymentOutputReference("https://example.test")).toBe(
      undefined,
    );
    expect(() =>
      parseApplicationDeploymentOutputReference(
        "applik8s.deployment-output/v1:missing-output:",
      ),
    ).toThrow(/Malformed deployment output reference/);
  });

  it("normalizes, serializes, and digests deterministically", () => {
    const graph = validGraph();
    const reversed: ApplicationDeploymentGraph = {
      ...graph,
      nodes: [...graph.nodes].reverse(),
      edges: [...graph.edges].reverse(),
    };
    expect(normalizeApplicationDeploymentGraph(reversed)).toEqual(
      normalizeApplicationDeploymentGraph(graph),
    );
    expect(serializeApplicationDeploymentGraph(reversed)).toBe(
      serializeApplicationDeploymentGraph(graph),
    );
    expect(digestApplicationDeploymentGraph(reversed)).toBe(
      digestApplicationDeploymentGraph(graph),
    );
    expect(digestApplicationDeploymentGraph(graph)).toMatch(
      /^sha256:[a-f0-9]{64}$/,
    );
  });

  it("accepts a typed artifact-output-to-composition plan", () => {
    expect(validateApplicationDeploymentGraph(validGraph())).toEqual({
      valid: true,
      diagnostics: [],
    });
  });

  it("strictly decodes the canonical wire contract", () => {
    const graph = validGraph();
    expect(
      decodeApplicationDeploymentGraph(
        serializeApplicationDeploymentGraph(graph),
      ),
    ).toEqual(normalizeApplicationDeploymentGraph(graph));
  });

  it("retains profile transition acknowledgements in the deployment plan identity", () => {
    const graph = validGraph();
    const withTransition: ApplicationDeploymentGraph = {
      ...graph,
      metadata: {
        ...graph.metadata,
        profileTransition: {
          apiVersion: "applik8s.profileTransitionPlan/v1alpha1",
          installation: { namespace: "control", name: "notes" },
          mode: "transition",
          entries: [
            {
              qualification: "TransactionalDatabase@v1alpha1:primary",
              from: "starter",
              to: "dedicated",
              kind: "replace",
            },
          ],
          acknowledgements: [
            "profile-transition/control/notes/profile:notes:profile/TransactionalDatabase@v1alpha1:primary/starter->dedicated/delete-local-data",
          ],
        },
      },
    };
    expect(
      decodeApplicationDeploymentGraph(
        serializeApplicationDeploymentGraph(withTransition),
      ).metadata.profileTransition,
    ).toEqual(
      normalizeApplicationDeploymentGraph(withTransition).metadata
        .profileTransition,
    );
    expect(digestApplicationDeploymentGraph(withTransition)).not.toBe(
      digestApplicationDeploymentGraph(graph),
    );
    expect(() =>
      decodeApplicationDeploymentGraph({
        ...withTransition,
        metadata: {
          ...withTransition.metadata,
          profileTransition: {
            ...withTransition.metadata.profileTransition,
            mode: "unsafe",
          },
        },
      }),
    ).toThrow(ApplicationDeploymentGraphDecodeError);
  });

  it("rejects unknown envelope fields, invalid enums, and malformed inputs", () => {
    const graph = validGraph();
    const composition = graph.nodes[1];
    if (!composition) throw new Error("fixture is incomplete");
    expect(() =>
      decodeApplicationDeploymentGraph({
        ...graph,
        surprise: true,
        metadata: { ...graph.metadata, strategy: "shell" },
        nodes: [
          graph.nodes[0],
          {
            ...composition,
            inputs: {
              image: {
                kind: "output",
                nodeId: "artifact.web",
              },
            },
          },
        ],
      }),
    ).toThrow(ApplicationDeploymentGraphDecodeError);
    try {
      decodeApplicationDeploymentGraph({
        ...graph,
        surprise: true,
        metadata: { ...graph.metadata, strategy: "shell" },
      });
    } catch (cause) {
      expect(cause).toBeInstanceOf(ApplicationDeploymentGraphDecodeError);
      expect(
        cause instanceof ApplicationDeploymentGraphDecodeError
          ? cause.diagnostics
          : [],
      ).toEqual(
        expect.arrayContaining([
          "$.surprise is not supported.",
          "$.metadata.strategy must be one of direct, kro.",
        ]),
      );
    }
  });

  it("rejects plaintext-sensitive state, missing edges, and unsafe external ownership", () => {
    const graph = validGraph();
    const artifact = graph.nodes[0];
    const composition = graph.nodes[1];
    if (!artifact || !composition) throw new Error("fixture is incomplete");
    const invalidArtifact: ApplicationDeploymentNode = {
      ...artifact,
      outputs: [
        {
          name: "image",
          type: "artifactDigest",
          sensitivity: "sensitive",
          persistence: "state",
        },
      ],
    };
    const invalidExternal: ApplicationDeploymentNode = {
      ...composition,
      id: "external.dns",
      kind: "externalReference",
      lifecycle: {
        ownership: "application",
        deletion: "delete",
        adoption: "createOrAdoptExact",
      },
      spec: { referenceType: "dns", reference: { name: "example.test" } },
    };
    const result = validateApplicationDeploymentGraph({
      ...graph,
      nodes: [invalidArtifact, composition, invalidExternal],
      edges: [],
    });
    expect(result.valid).toBe(false);
    expect(result.diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "DEPLOYMENT_SECRET_UNSAFE",
        "DEPLOYMENT_EDGE_INVALID",
        "DEPLOYMENT_LIFECYCLE_UNSAFE",
      ]),
    );
  });

  it("rejects cycles, singleton drift, and cross-connection nodes", () => {
    const graph = validGraph();
    const first = singleton("singleton.one", "shared.operator", digest);
    const second = singleton(
      "singleton.two",
      "shared.operator",
      `sha256:${"c".repeat(64)}`,
    );
    const crossConnection: ApplicationDeploymentNode = {
      ...first,
      id: "foreign",
      scope: { connectionDigest: `sha256:${"d".repeat(64)}` },
    };
    const result = validateApplicationDeploymentGraph({
      ...graph,
      nodes: [first, second, crossConnection],
      edges: [
        { from: first.id, to: second.id, relationship: "requiresReady" },
        { from: second.id, to: first.id, relationship: "requiresReady" },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "DEPLOYMENT_EDGE_CYCLE",
        "DEPLOYMENT_SINGLETON_DRIFT",
        "DEPLOYMENT_CONNECTION_UNSAFE",
      ]),
    );
  });

  it("rejects controllerless external effects and retained data inside a deleted namespace", () => {
    const graph = validGraph();
    const namespace = singleton("namespace.workload", "namespace.workload", digest);
    const externalProvider: ApplicationDeploymentNode = {
      ...namespace,
      id: "external.dns",
      kind: "externalProvider",
      lifecycle: {
        ownership: "application",
        deletion: "delete",
        adoption: "createOrAdoptExact",
      },
      spec: { resourceType: "dns-record" },
    };
    const retained: ApplicationDeploymentNode = {
      ...namespace,
      id: "data.postgres",
      kind: "singleton",
      lifecycle: {
        ownership: "application",
        deletion: "retain",
        adoption: "createOrAdoptExact",
        namespaceNodeId: namespace.id,
      },
      spec: { singletonKey: "data.postgres" },
    };
    const deletingNamespace: ApplicationDeploymentNode = {
      ...namespace,
      lifecycle: {
        ownership: "application",
        deletion: "delete",
        adoption: "createOrAdoptExact",
      },
    };
    const result = validateApplicationDeploymentGraph({
      ...graph,
      nodes: [deletingNamespace, externalProvider, retained],
      edges: [],
    });
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "DEPLOYMENT_LIFECYCLE_UNSAFE",
          nodeId: "external.dns",
        }),
        expect.objectContaining({
          code: "DEPLOYMENT_LIFECYCLE_UNSAFE",
          nodeId: "data.postgres",
        }),
      ]),
    );
  });
});

function validGraph(): ApplicationDeploymentGraph {
  const artifact: ApplicationDeploymentNode = {
    id: "artifact.web",
    kind: "artifact",
    contractVersion: 1,
    source: { semanticNodeId: "server.web" },
    provider: {
      interface: "ApplicationHost",
      implementation: "kubernetes",
      version: "1",
    },
    scope: { connectionDigest },
    capabilities: { strategies: ["direct", "kro"], alchemy: true },
    configurationDigest: digest,
    inputs: {},
    outputs: [
      {
        name: "image",
        type: "artifactDigest",
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
      artifactType: "containerImage",
      sourceDescriptor: { context: "./web" },
    },
  };
  const composition: ApplicationDeploymentNode = {
    id: "kubernetes.application",
    kind: "kubernetesComposition",
    contractVersion: 1,
    source: { semanticNodeId: "installation.application" },
    provider: {
      interface: "ApplicationHost",
      implementation: "kubernetes",
      version: "1",
    },
    scope: { connectionDigest, namespace: "guestbook" },
    capabilities: { strategies: ["direct", "kro"], alchemy: true },
    configurationDigest: digest,
    inputs: {
      image: {
        kind: "output",
        nodeId: artifact.id,
        output: "image",
        sensitivity: "public",
        persistence: "state",
      },
    },
    outputs: [
      {
        name: "endpoint",
        type: "string",
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
      compositionId: "guestbook",
      fragmentIds: ["web"],
    },
  };
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
        application: "guestbook",
        controlPlaneNamespace: "applik8s-system",
        instance: "guestbook",
        profile: "local",
      },
      mode: "fresh",
      strategy: "kro",
      sourceGraphDigest: digest,
      compilerVersion: "0.6.0",
    },
    nodes: [artifact, composition],
    edges: [
      {
        from: artifact.id,
        to: composition.id,
        relationship: "requiresOutput",
        output: "image",
      },
      {
        from: artifact.id,
        to: composition.id,
        relationship: "publishes",
      },
    ],
  };
}

function singleton(
  id: string,
  singletonKey: string,
  configurationDigest: string,
): ApplicationDeploymentNode {
  return {
    id,
    kind: "singleton",
    contractVersion: 1,
    source: { semanticNodeId: id },
    provider: {
      interface: "Platform",
      implementation: "typekro",
      version: "1",
    },
    scope: { connectionDigest },
    capabilities: { strategies: ["direct", "kro"], alchemy: true },
    configurationDigest,
    inputs: {},
    outputs: [],
    lifecycle: {
      ownership: "shared",
      deletion: "retain",
      adoption: "createOrAdoptExact",
    },
    spec: { singletonKey },
  };
}
