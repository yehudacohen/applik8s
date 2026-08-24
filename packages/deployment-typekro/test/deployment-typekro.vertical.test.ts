// typecast-file-boundary: Adapter tests inspect generated TypeKro resources only after asserting their resource kinds and shapes.

import { compileApplicationDeploymentGraph } from "@applik8s/deployment-compiler";
import {
  type ApplicationDeploymentGraph,
  type ApplicationExternalProviderDeploymentNode,
  type ApplicationKubernetesCompositionDeploymentNode,
  digestApplicationDeploymentValue,
} from "@applik8s/deployment-contract";
import { type } from "arktype";
import {
  createResource,
  kubernetesComposition,
  simple,
  singleton,
} from "typekro";
import {
  artifactOutput,
  decodeDirectArtifactExecutionRecord,
} from "typekro/experimental/planning";
import { describe, expect, it } from "vitest";

// typecast-file-boundary: Test fixtures preserve literal discriminants while
// exercising TypeKro adapter validation.
import {
  adaptApplicationDeploymentToTypeKro,
  adaptTypeKroDeploymentEvidenceCanonicalJsonV1,
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

function envoyEndpointComposition() {
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
          endpoint: artifactOutput(
            "direct.provider.ai.gateway",
            "endpoint",
          ),
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

function graphWithLocalS3(): ApplicationDeploymentGraph {
  const base = graph("direct");
  const root = base.nodes[0];
  if (!root) throw new Error("Test deployment graph root is missing.");
  const localS3 = {
    id: "direct.provider.objects.local-s3",
    kind: "kubernetesDirect" as const,
    contractVersion: 1,
    source: { semanticNodeId: "provider.objects" },
    provider: {
      interface: "ObjectStorage",
      implementation: "applik8s-local-s3",
      version: "1",
    },
    scope: {
      connectionDigest: base.metadata.identity.connection.digest,
      namespace: "adapter-test",
    },
    capabilities: {
      strategies: ["direct" as const, "kro" as const],
      alchemy: true as const,
    },
    configurationDigest: digestApplicationDeploymentValue({
      name: "adapter-objects",
      namespace: "adapter-test",
    }),
    inputs: {},
    outputs: [
      {
        name: "ready",
        type: "boolean" as const,
        sensitivity: "public" as const,
        persistence: "state" as const,
      },
    ],
    lifecycle: {
      ownership: "application" as const,
      deletion: "delete" as const,
      adoption: "createOrAdoptExact" as const,
    },
    spec: {
      compositionId: "applik8s-local-s3",
      reason: "Test maintained Starter object storage.",
      configuration: {
        name: "adapter-objects",
        namespace: "adapter-test",
        bucket: "adapter-objects",
        credentialsSecretName: "adapter-objects-credentials",
        image:
          "docker.io/chrislusf/seaweedfs@sha256:f898c91e42d7da5f4bb13f1efd424ff03ba85b420312eb929708a384e8a8b03d",
        storage: { size: "2Gi", storageClassName: "local-path" },
      },
    },
  };
  return {
    ...base,
    nodes: [localS3, root],
    edges: [
      {
        from: localS3.id,
        to: root.id,
        relationship: "requiresReady",
      },
    ],
  };
}

function graphWithManagedRook(): ApplicationDeploymentGraph {
  const base = graph("direct");
  const root = base.nodes[0];
  if (!root) throw new Error("Test deployment graph root is missing.");
  const operatorConfiguration = {
    name: "applik8s-rook-operator",
    namespace: "applik8s-rook-ceph-operator",
    repositoryName: "rook-release",
    repositoryNamespace: "applik8s-rook-ceph-operator",
    repositoryNamespaceOwnership: "owned",
    enableOBCWatchOperatorNamespace: true,
    obcProvisionerNamePrefix: "applik8s-rook-ceph-operator",
    resources: { requests: { cpu: "100m", memory: "128Mi" } },
    values: { allowLoopDevices: true },
  } as const;
  const operator = {
    id: "direct.provider.objects.rook-operator",
    kind: "kubernetesDirect" as const,
    contractVersion: 1,
    source: { semanticNodeId: "provider.objects" },
    provider: {
      interface: "ObjectStorage",
      implementation: "applik8s-rook-ceph-operator",
      version: "1",
    },
    scope: {
      connectionDigest: base.metadata.identity.connection.digest,
      namespace: "applik8s-rook-ceph-operator",
    },
    capabilities: {
      strategies: ["direct" as const],
      alchemy: true as const,
    },
    configurationDigest:
      digestApplicationDeploymentValue(operatorConfiguration),
    inputs: {},
    outputs: [
      {
        name: "ready",
        type: "boolean" as const,
        sensitivity: "public" as const,
        persistence: "state" as const,
      },
    ],
    lifecycle: {
      ownership: "shared" as const,
      deletion: "retain" as const,
      adoption: "createOrAdoptExact" as const,
    },
    spec: {
      compositionId: "applik8s-rook-ceph-operator",
      reason: "Test the shared singleton Rook operator.",
      configuration: operatorConfiguration,
    },
  };
  const platformConfiguration = {
    name: "applik8s-rook",
    profile: "single-node-development" as const,
    namespace: "applik8s-rook-ceph",
    operatorNamespace: "applik8s-rook-ceph-operator",
    operatorDeploymentName: "rook-ceph-operator",
    repositoryName: "applik8s-rook-rook-release",
    repositoryNamespace: "applik8s-rook-ceph",
    repositoryNamespaceOwnership: "owned" as const,
    bucketProvisionerNamePrefix: "applik8s-rook-ceph-operator",
    bucketProvisionerName:
      "applik8s-rook-ceph-operator.ceph.rook.io/bucket",
    storageClassName: "local-path",
    storageSize: "16Gi",
    objectStoreName: "applik8s-object-store",
    bucketStorageClassName: "applik8s-rook-buckets",
  };
  const platform = {
    id: "direct.provider.objects.rook-platform",
    kind: "kubernetesDirect" as const,
    contractVersion: 1,
    source: { semanticNodeId: "provider.objects" },
    provider: {
      interface: "ObjectStorage",
      implementation:
        "applik8s-rook-ceph-external-operator-single-node-platform",
      version: "1",
    },
    scope: {
      connectionDigest: base.metadata.identity.connection.digest,
      namespace: "applik8s-rook-ceph",
    },
    capabilities: {
      strategies: ["direct" as const],
      alchemy: true as const,
    },
    configurationDigest: digestApplicationDeploymentValue(
      platformConfiguration,
    ),
    inputs: {},
    outputs: [
      {
        name: "ready",
        type: "boolean" as const,
        sensitivity: "public" as const,
        persistence: "state" as const,
      },
    ],
    lifecycle: {
      ownership: "shared" as const,
      deletion: "retain" as const,
      adoption: "createOrAdoptExact" as const,
    },
    spec: {
      compositionId:
        "applik8s-rook-ceph-external-operator-single-node-platform",
      reason: "Test the shared managed Rook/Ceph qualification platform.",
      configuration: platformConfiguration,
    },
  };
  const claim = {
    id: "direct.provider.objects.claim",
    kind: "kubernetesDirect" as const,
    contractVersion: 1,
    source: { semanticNodeId: "provider.objects" },
    provider: {
      interface: "ObjectStorage",
      implementation: "rook-object-storage-claim",
      version: "1",
    },
    scope: {
      connectionDigest: base.metadata.identity.connection.digest,
      namespace: "adapter-test",
    },
    capabilities: {
      strategies: ["direct" as const],
      alchemy: true as const,
    },
    configurationDigest: digestApplicationDeploymentValue({
      name: "adapter-objects",
      namespace: "adapter-test",
      storageClassName: "applik8s-rook-buckets",
    }),
    inputs: {},
    outputs: [
      {
        name: "ready",
        type: "boolean" as const,
        sensitivity: "public" as const,
        persistence: "state" as const,
      },
    ],
    lifecycle: {
      ownership: "application" as const,
      deletion: "delete" as const,
      adoption: "createOrAdoptExact" as const,
    },
    spec: {
      compositionId: "rook-object-storage-claim",
      reason: "Claim an application-owned bucket from the shared platform.",
      configuration: {
        name: "adapter-objects",
        namespace: "adapter-test",
        storageClassName: "applik8s-rook-buckets",
      },
    },
  };
  return {
    ...base,
    nodes: [operator, platform, claim, root],
    edges: [
      {
        from: operator.id,
        to: platform.id,
        relationship: "requiresReady",
      },
      {
        from: platform.id,
        to: claim.id,
        relationship: "requiresReady",
      },
      {
        from: claim.id,
        to: root.id,
        relationship: "requiresReady",
      },
    ],
  };
}

function graphWithNatsBootstrap(): ApplicationDeploymentGraph {
  const base = graph("kro");
  const root = base.nodes[0];
  if (!root) throw new Error("Test deployment graph root is missing.");
  const nats = {
    id: "direct.provider.event-log.nats",
    kind: "kubernetesDirect" as const,
    contractVersion: 1,
    source: { semanticNodeId: "provider.event-log" },
    provider: {
      interface: "EventLog",
      implementation: "nats-bootstrap",
      version: "1",
    },
    scope: {
      connectionDigest: base.metadata.identity.connection.digest,
      namespace: "adapter-test",
    },
    capabilities: {
      strategies: ["direct" as const, "kro" as const],
      alchemy: true as const,
    },
    configurationDigest: digestApplicationDeploymentValue({
      name: "adapter-events",
      namespace: "adapter-test",
      namespaceOwnership: "external",
      replicas: 1,
      storageSize: "2Gi",
      pvcRetentionPolicy: "retain",
    }),
    inputs: {},
    outputs: [
      {
        name: "ready",
        type: "boolean" as const,
        sensitivity: "public" as const,
        persistence: "state" as const,
      },
    ],
    lifecycle: {
      ownership: "application" as const,
      deletion: "delete" as const,
      adoption: "createOrAdoptExact" as const,
    },
    spec: {
      compositionId: "nats-bootstrap",
      reason:
        "Keep NATS and NACK alive until the application graph has removed its JetStream resources.",
      configuration: {
        name: "adapter-events",
        namespace: "adapter-test",
        namespaceOwnership: "external",
        replicas: 1,
        storageSize: "2Gi",
        pvcRetentionPolicy: "retain",
      },
    },
  };
  return {
    ...base,
    nodes: [nats, root],
    edges: [
      {
        from: nats.id,
        to: root.id,
        relationship: "requiresReady",
      },
    ],
  };
}

function graphWithHatchetInstallation(): ApplicationDeploymentGraph {
  const base = graph("kro");
  const root = base.nodes[0];
  if (!root) throw new Error("Test deployment graph root is missing.");
  const configuration = {
    name: "adapter-workflows",
    namespace: "adapter-test",
    namespaceOwnership: "external",
    repositoryNamespaceOwnership: "external",
    chartVersion: "0.13.3",
    serverVersion: "v0.94.10",
    database: {
      connectionSecret: { name: "adapter-workflows-database" },
    },
    adminCredentialsSecret: { name: "adapter-workflows-admin" },
    replicas: { api: 1, engine: 1, frontend: 1 },
    dashboard: true,
    serverUrl: "http://hatchet-api.adapter-test.svc:8080",
    cookieDomain: "hatchet-api.adapter-test.svc",
    cookieInsecure: true,
    grpcBroadcastAddress: "hatchet-engine.adapter-test.svc:7070",
    grpcInsecure: true,
    workerTokenJob: true,
  };
  const hatchet = {
    id: "direct.provider.workflow-engine.hatchet",
    kind: "kubernetesDirect" as const,
    contractVersion: 1,
    source: { semanticNodeId: "provider.workflow-engine" },
    provider: {
      interface: "WorkflowEngine",
      implementation: "hatchet-installation",
      version: "1",
    },
    scope: {
      connectionDigest: base.metadata.identity.connection.digest,
      namespace: "adapter-test",
    },
    capabilities: {
      strategies: ["direct" as const, "kro" as const],
      alchemy: true as const,
    },
    configurationDigest: digestApplicationDeploymentValue(configuration),
    inputs: {},
    outputs: [{
      name: "ready",
      type: "boolean" as const,
      sensitivity: "public" as const,
      persistence: "state" as const,
    }],
    lifecycle: {
      ownership: "application" as const,
      deletion: "delete" as const,
      adoption: "createOrAdoptExact" as const,
    },
    spec: {
      compositionId: "hatchet-installation",
      reason: "Delegate Hatchet installation lifecycle to TypeKro.",
      configuration,
    },
  };
  return {
    ...base,
    nodes: [hatchet, root],
    edges: [{
      from: hatchet.id,
      to: root.id,
      relationship: "requiresReady",
    }],
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

function graphWithEnvoyAIGateway(): ApplicationDeploymentGraph {
  const base = graph("direct");
  const seedConfiguration = {
    namespace: "adapter-test",
    name: "adapter-ai-seed",
    values: {
      seed: {
        kind: "random",
        bytes: 32,
        encoding: "base64url",
      },
    },
    consumers: ["provider.ai"],
  } as const;
  const configuration = {
    name: "adapter-ai",
    namespace: "adapter-test",
    build: {
      profile: "production",
      providers: [
        {
          name: "local",
          kind: "openai-compatible",
          hostname: "model.adapter-test.svc",
          port: 8080,
          tls: false,
        },
      ],
      models: [
        {
          model: "fast",
          targets: [{ provider: "local", model: "fast" }],
        },
      ],
      platform: {
        profile: "production",
        mcpSessionEncryptionSeedSecret: {
          name: "adapter-ai-seed",
          key: "seed",
        },
      },
    },
    instance: {
      name: "adapter-ai",
      namespace: "adapter-test",
      lifecycle: "external",
    },
  } as const;
  return {
    ...base,
    nodes: [
      {
        id: "external.provider.ai.mcp-seed",
        kind: "externalProvider",
        contractVersion: 1,
        source: { semanticNodeId: "provider.ai" },
        provider: {
          interface: "Secret",
          implementation: "alchemy-kubernetes-generated-secret",
          version: "1",
        },
        scope: {
          connectionDigest: base.metadata.identity.connection.digest,
          namespace: "adapter-test",
        },
        capabilities: { strategies: ["direct", "kro"], alchemy: true },
        configurationDigest:
          digestApplicationDeploymentValue(seedConfiguration),
        inputs: {},
        outputs: [
          {
            name: "reference",
            type: "secretReference",
            sensitivity: "public",
            persistence: "reference",
          },
          {
            name: "name",
            type: "string",
            sensitivity: "public",
            persistence: "reference",
          },
          {
            name: "namespace",
            type: "string",
            sensitivity: "public",
            persistence: "reference",
          },
        ],
        lifecycle: {
          ownership: "shared",
          deletion: "retain",
          adoption: "createOrAdoptExact",
        },
        spec: {
          resourceType: "kubernetesGeneratedSecret",
          controller: "applik8s-alchemy-kubernetes-generated-secret/v1",
          referenceMode: "staticIdentity",
          configuration: seedConfiguration,
        },
      },
      {
        id: "direct.provider.ai.gateway",
        kind: "kubernetesDirect",
        contractVersion: 1,
        source: { semanticNodeId: "provider.ai" },
        provider: {
          interface: "AI",
          implementation: "envoy-ai-gateway",
          version: "1",
        },
        scope: {
          connectionDigest: base.metadata.identity.connection.digest,
          namespace: "adapter-test",
        },
        capabilities: { strategies: ["direct", "kro"], alchemy: true },
        configurationDigest:
          digestApplicationDeploymentValue(configuration),
        inputs: {},
        outputs: [
          {
            name: "ready",
            type: "boolean",
            sensitivity: "public",
            persistence: "state",
          },
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
          compositionId: "envoy-ai-gateway",
          reason: "Exercise the pinned Envoy AI Gateway adapter.",
          configuration,
        },
      },
      ...base.nodes,
    ],
    edges: [
      {
        from: "external.provider.ai.mcp-seed",
        to: "direct.provider.ai.gateway",
        relationship: "requiresReady",
      },
      {
        from: "direct.provider.ai.gateway",
        to: "kubernetes.application",
        relationship: "requiresOutput",
        output: "endpoint",
      },
    ],
  };
}

function graphWithV08KubernetesProviders(): ApplicationDeploymentGraph {
  const connectionDigest = digestApplicationDeploymentValue({
    provider: "kubernetes",
    cluster: "orbstack",
  });
  return compileApplicationDeploymentGraph({
    graph: {
      apiVersion: "applik8s.appGraph/v1alpha1",
      kind: "ApplicationGraph",
      metadata: { name: "adapter", namespace: "adapter-test" },
      nodes: [
        {
          id: "provider.observability",
          kind: "provider",
          name: "Observability",
          stability: "stable",
          interface: "Observability",
          implementation: "clickstack",
          config: {
            observability: {
              kind: "clickstack",
              namespace: "adapter-test",
              storageSize: "10Gi",
              metadataStorageSize: "5Gi",
              policy: {},
              retention: {},
            },
          },
        },
        {
          id: "provider.actors",
          kind: "provider",
          name: "ActorRuntime",
          stability: "stable",
          interface: "ActorRuntime",
          implementation: "celld-actors",
          config: {
            actorRuntime: {
              kind: "celld-actors",
              namespace: "adapter-test",
              replicas: 2,
              stateStore: {
                kind: "s3",
                bucket: "adapter-actors",
                region: "us-east-1",
                endpoint: "http://s3.adapter-test.svc.cluster.local:9000",
                credentialsSecret: {
                  apiVersion: "v1",
                  kind: "Secret",
                  name: "adapter-actor-state",
                  namespace: "adapter-test",
                },
              },
            },
          },
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
    },
    target: "kubernetes",
    sourceGraphDigest: digestApplicationDeploymentValue({ app: "adapter" }),
    compilerVersion: "test",
    identity: {
      connection: {
        provider: "kubernetes",
        cluster: "orbstack",
        digest: connectionDigest,
      },
      application: "adapter",
      controlPlaneNamespace: "applik8s-system",
      instance: "adapter",
      profile: "test",
    },
    strategy: "direct",
    installationSpec: { name: "adapter" },
    artifacts: [{
      id: "artifact.celld-runtime",
      artifactType: "generatedRuntime",
      name: "celld-actor-runtime",
      sourceDigest: digestApplicationDeploymentValue({ worker: "adapter" }),
      sourceDescriptor: {
        kind: "generated-runtime",
        contextPath: "/tmp/adapter-celld",
      },
      logicalReference: "applik8s/adapter-celld-runtime:source-test",
    }],
    materializedComposition: {
      resources: [{
        id: "adapterHttpService",
        template: {
          apiVersion: "v1",
          kind: "Service",
          metadata: {
            name: "adapter-api",
            namespace: "adapter-test",
            labels: { "app.kubernetes.io/component": "typed-http" },
          },
          spec: { ports: [{ name: "http", port: 8080, targetPort: "http" }] },
        },
      }],
      status: {},
    },
  }).graph;
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

function materializedGraphWithStaticGeneratedSecret(): ApplicationDeploymentGraph {
  const base = materializedGraph("kro");
  const root = base.nodes.find(
    (node) => node.kind === "kubernetesComposition",
  );
  if (!root || root.kind !== "kubernetesComposition" || !root.spec.materialized) {
    throw new Error("Test deployment graph root is missing.");
  }
  const secretConfiguration = {
    namespace: "adapter-test",
    name: "adapter-object-credentials",
    values: {
      token: {
        kind: "random",
        bytes: 32,
        encoding: "base64url",
      },
    },
    consumers: ["direct.provider.object-storage"],
  } as const;
  const updatedRoot: ApplicationKubernetesCompositionDeploymentNode = {
    ...root,
    spec: {
      ...root.spec,
      materialized: {
        ...root.spec.materialized,
        resources: [
          ...root.spec.materialized.resources,
          {
            id: "objectCredentials",
            externalRef: {
              apiVersion: "v1",
              kind: "Secret",
              metadata: {
                name: secretConfiguration.name,
                namespace: secretConfiguration.namespace,
              },
            },
          },
        ],
      },
    },
  };
  const generatedSecret: ApplicationExternalProviderDeploymentNode = {
    id: "external.provider.object-storage.credentials",
    kind: "externalProvider",
    contractVersion: 1,
    source: { semanticNodeId: "provider.object-storage" },
    provider: {
      interface: "Secret",
      implementation: "alchemy-kubernetes-generated-secret",
      version: "1",
    },
    scope: {
      connectionDigest: base.metadata.identity.connection.digest,
      namespace: secretConfiguration.namespace,
    },
    capabilities: { strategies: ["direct", "kro"], alchemy: true },
    configurationDigest:
      digestApplicationDeploymentValue(secretConfiguration),
    inputs: {},
    outputs: [
      {
        name: "reference",
        type: "secretReference",
        sensitivity: "public",
        persistence: "reference",
      },
      {
        name: "name",
        type: "string",
        sensitivity: "public",
        persistence: "reference",
      },
      {
        name: "namespace",
        type: "string",
        sensitivity: "public",
        persistence: "reference",
      },
    ],
    lifecycle: {
      ownership: "application",
      deletion: "delete",
      adoption: "createOrAdoptExact",
    },
    spec: {
      resourceType: "kubernetesGeneratedSecret",
      controller: "applik8s-alchemy-kubernetes-generated-secret/v1",
      referenceMode: "staticIdentity",
      configuration: secretConfiguration,
    },
  };
  return {
    ...base,
    nodes: [
      ...base.nodes.filter((node) => node !== root),
      updatedRoot,
      generatedSecret,
    ],
    edges: [
      ...base.edges,
      {
        from: "external.provider.object-storage.credentials",
        to: "direct.provider.object-storage",
        relationship: "requiresReady",
      },
    ],
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
  it("adapts only Alchemy's public Output protocol into canonical evidence", () => {
    const output = Object.assign(() => undefined, {
      [Symbol.for("alchemy/Expr")]: { kind: "LiteralExpr" },
      [Symbol.for("nodejs.util.inspect.custom")]: () => "namespace.output",
    });
    expect(
      adaptTypeKroDeploymentEvidenceCanonicalJsonV1({ namespace: output }),
    ).toEqual({
      namespace: {
        apiVersion: "alchemy.output/v1alpha1",
        expression: "namespace.output",
      },
    });
    expect(() =>
      digestApplicationDeploymentValue(
        adaptTypeKroDeploymentEvidenceCanonicalJsonV1({
          namespace: () => "not-an-output",
        }),
      ),
    ).toThrow(/cannot represent function/);
    const reference = Object.assign(() => undefined, {
      [Symbol.for("TypeKro.KubernetesRef")]: true,
      resourceId: "definition",
      fieldPath: "metadata.namespace",
    });
    expect(
      adaptTypeKroDeploymentEvidenceCanonicalJsonV1({ namespace: reference }),
    ).toEqual({
      namespace: {
        apiVersion: "typekro.reference/v1alpha1",
        resourceId: "definition",
        fieldPath: "metadata.namespace",
      },
    });
  });

  // typecast: preserve the two deployment strategy literals for parameterized coverage.
  for (const strategy of ["direct", "kro"] as const) {
    it(`lowers one ${strategy} composition through the released 0.33 declarations`, async () => {
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
        typekro: "0.33.7",
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

  it("preserves thrown TypeKro planning diagnostics with the deployment node identity", async () => {
    const healthy = bindTypeKroComposition(
      composition(),
      { name: "adapter", image: "nginx:1.27-alpine" },
    );
    const rejected = {
      ...healthy,
      plan() {
        throw Object.assign(
          new Error("Strict semantic planning rejected the composition."),
          {
            context: {
              diagnostics: [
                {
                  code: "SCHEMA_IR_UNSUPPORTED",
                  severity: "error",
                  message: "Unsupported schema node.",
                  path: "$.spec.values",
                },
              ],
            },
          },
        );
      },
    };

    await expect(
      adaptApplicationDeploymentToTypeKro({
        graph: graph("direct"),
        root: rejected,
      }),
    ).rejects.toThrow(
      [
        "TypeKro semantic planning failed for kubernetes.application:",
        "- [SCHEMA_IR_UNSUPPORTED] Unsupported schema node. ($.spec.values)",
      ].join("\n"),
    );
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

  it("binds the maintained Starter local S3 service without serializing credential values", async () => {
    const deploymentGraph = graphWithLocalS3();
    const direct = bindApplicationTypeKroDirectNodes(deploymentGraph, {
      namespace: "adapter-test",
      waitForReady: false,
    });
    const binding = direct["direct.provider.objects.local-s3"];
    expect(binding?.compositionId).toBe("applik8s-local-s3");
    const plan = binding?.plan();
    const serializedPlan = JSON.stringify(plan);
    expect(serializedPlan).toContain("PersistentVolumeClaim");
    expect(serializedPlan).toContain("Deployment");
    expect(serializedPlan).toContain("NetworkPolicy");
    expect(serializedPlan).toContain("adapter-objects-credentials");
    expect(serializedPlan).not.toContain("AWS_SECRET_ACCESS_KEY=");

    const declarations = await binding?.declarations("direct");
    expect(declarations?.length).toBeGreaterThan(0);
    const serializedDeclarations = JSON.stringify(declarations);
    expect(serializedDeclarations).toContain('"kind":"Deployment"');
    expect(serializedDeclarations).toContain('"kind":"PersistentVolumeClaim"');
    expect(serializedDeclarations).toContain('"kind":"NetworkPolicy"');
    expect(serializedDeclarations).toContain(
      "docker.io/chrislusf/seaweedfs@sha256:f898c91e42d7da5f4bb13f1efd424ff03ba85b420312eb929708a384e8a8b03d",
    );
    const claimDeclaration = declarations?.find(
      (declaration) =>
        declaration.props.resource.kind === "PersistentVolumeClaim",
    );
    const workloadDeclaration = declarations?.find(
      (declaration) => declaration.props.resource.kind === "Deployment",
    );
    expect(claimDeclaration).toBeDefined();
    expect(workloadDeclaration).toBeDefined();
    // WaitForFirstConsumer storage classes require the Pod to exist before
    // the claim can bind. The Deployment and PVC must therefore be created in
    // the same readiness layer, with Kubernetes coordinating their binding.
    expect(workloadDeclaration?.dependsOn).not.toContain(claimDeclaration?.id);
  });

  it("binds v0.8 ClickStack and ClickHouse providers in both direct and KRO modes", async () => {
    const deploymentGraph = graphWithV08KubernetesProviders();
    const direct = bindApplicationTypeKroDirectNodes(deploymentGraph, {
      namespace: "adapter-test",
      waitForReady: false,
    });
    const operator = direct["direct.provider.observability.clickhouse-operator"];
    const clickhouse = direct["direct.provider.observability.clickhouse"];
    const clickstack = direct["direct.provider.observability.clickstack"];

    expect(operator?.compositionId).toBe("clickhouse-operator-bootstrap");
    expect(clickhouse?.compositionId).toBe("applik8s-clickstack-clickhouse");
    expect(clickstack?.compositionId).toBe("applik8s-clickstack");
    expect(JSON.stringify(clickhouse?.plan())).toContain("ClickHouseInstallation");
    expect(JSON.stringify(clickstack?.plan())).toContain("otlpHttpEndpoint");

    for (const binding of [operator, clickhouse, clickstack]) {
      const directDeclarations = await binding?.declarations("direct");
      const kroDeclarations = await binding?.declarations("kro");
      expect(directDeclarations?.length).toBeGreaterThan(0);
      expect(kroDeclarations?.length).toBeGreaterThan(0);
    }
    expect(JSON.stringify(await clickstack?.declarations("kro"))).toContain(
      "typekroArtifactBindings",
    );
  });

  it("binds the compiler-generated Celld Worker fleet without embedding credentials", async () => {
    const deploymentGraph = graphWithV08KubernetesProviders();
    const direct = bindApplicationTypeKroDirectNodes(deploymentGraph, {
      namespace: "adapter-test",
      waitForReady: false,
    });
    const binding = direct["direct.provider.actors.celld"];
    expect(binding?.compositionId).toBe("applik8s-celld-actors");

    const plan = JSON.stringify(binding?.plan());
    expect(plan).toContain("StatefulSet");
    expect(plan).toContain("Job");
    expect(plan).toContain("NetworkPolicy");
    expect(plan).toContain("internal-listen");
    expect(plan).toContain("celld-peer");
    expect(plan).toContain("8081");
    expect(plan).toContain("artifact.celld-runtime");
    expect(plan).toContain(
      "http://adapter-api.adapter-test.svc.cluster.local:8080",
    );
    expect(plan).not.toContain("authorization\":\"");

    const directDeclarations = await binding?.declarations("direct");
    const kroDeclarations = await binding?.declarations("kro");
    expect(directDeclarations?.some(({ props }) =>
      props.resource.kind === "StatefulSet"
    )).toBe(true);
    expect(directDeclarations?.some(({ props }) =>
      props.resource.kind === "Job"
    )).toBe(true);
    const fleet = directDeclarations?.find(({ props }) =>
      props.resource.kind === "StatefulSet"
    )?.props.resource;
    expect(fleet?.spec).toMatchObject({
      template: {
        spec: {
          securityContext: {
            runAsNonRoot: true,
            runAsUser: 65532,
            runAsGroup: 65532,
            fsGroup: 65532,
            fsGroupChangePolicy: "OnRootMismatch",
          },
        },
      },
    });
    expect(kroDeclarations?.length).toBeGreaterThan(0);
    expect(
      directDeclarations?.flatMap(({ artifactOutputUses }) => artifactOutputUses ?? []),
    ).toContainEqual({
      requirementId: "artifact.celld-runtime",
      output: "immutableReference",
      sensitive: false,
    });
    expect(
      directDeclarations?.flatMap(({ artifactOutputUses }) => artifactOutputUses ?? []),
    ).not.toContainEqual(expect.objectContaining({
      requirementId: "external.provider.actors.celld-authorization",
    }));
    expect(JSON.stringify(directDeclarations)).toContain(
      "adapter-actors-authorization",
    );
  });

  it("binds the dedicated Rook operator and platform as retained singletons before its application claim", async () => {
    const deploymentGraph = graphWithManagedRook();
    const direct = bindApplicationTypeKroDirectNodes(deploymentGraph, {
      namespace: "adapter-test",
      waitForReady: false,
    });
    const operator = direct["direct.provider.objects.rook-operator"];
    const platform = direct["direct.provider.objects.rook-platform"];
    const claim = direct["direct.provider.objects.claim"];

    expect(operator?.compositionId).toBe("applik8s-rook-ceph-operator");
    expect(platform?.compositionId).toBe(
      "applik8s-rook-ceph-external-operator-single-node-platform",
    );
    expect(claim?.compositionId).toBe("rook-object-storage-claim");

    const operatorDeclarations = await operator?.declarations("direct");
    const platformDeclarations = await platform?.declarations("direct");
    const claimDeclarations = await claim?.declarations("direct");
    expect(operatorDeclarations?.length).toBeGreaterThan(0);
    expect(platformDeclarations?.length).toBeGreaterThan(0);
    expect(claimDeclarations?.length).toBeGreaterThan(0);
    expect(
      operatorDeclarations?.every(
        (declaration) => declaration.props.retain === true,
      ),
    ).toBe(true);
    expect(
      platformDeclarations?.every(
        (declaration) => declaration.props.retain === true,
      ),
    ).toBe(true);
    for (const declaration of platformDeclarations ?? []) {
      expect(
        declaration.props.resource.metadata.annotations?.[
          "typekro.io/singleton-spec-fingerprint"
        ],
      ).toMatch(/^fnv64:[a-f0-9]{16}$/);
      expect(declaration.props.artifactExecutionRecord).toBeTypeOf("string");
      const record = decodeDirectArtifactExecutionRecord(
        declaration.props.artifactExecutionRecord!,
      );
      expect(JSON.stringify(record.artifact)).toContain(
        "typekro.io/singleton-spec-fingerprint",
      );
    }

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
    const platformIds = new Set(
      platformDeclarations?.map((declaration) => declaration.id),
    );
    const operatorIds = new Set(
      operatorDeclarations?.map((declaration) => declaration.id),
    );
    const claimIds = new Set(
      claimDeclarations?.map((declaration) => declaration.id),
    );
    const lastOperator = Math.max(
      ...adapted.declarations
        .map((declaration, index) => ({ declaration, index }))
        .filter(({ declaration }) => operatorIds.has(declaration.id))
        .map(({ index }) => index),
    );
    const firstPlatform = Math.min(
      ...adapted.declarations
        .map((declaration, index) => ({ declaration, index }))
        .filter(({ declaration }) => platformIds.has(declaration.id))
        .map(({ index }) => index),
    );
    const lastPlatform = Math.max(
      ...adapted.declarations
        .map((declaration, index) => ({ declaration, index }))
        .filter(({ declaration }) => platformIds.has(declaration.id))
        .map(({ index }) => index),
    );
    const firstClaim = Math.min(
      ...adapted.declarations
        .map((declaration, index) => ({ declaration, index }))
        .filter(({ declaration }) => claimIds.has(declaration.id))
        .map(({ index }) => index),
    );
    expect(lastOperator).toBeLessThan(firstPlatform);
    expect(lastPlatform).toBeLessThan(firstClaim);
  });

  it("binds managed JetStream through the released direct NATS bootstrap composition", async () => {
    const deploymentGraph = graphWithNatsBootstrap();
    const direct = bindApplicationTypeKroDirectNodes(deploymentGraph, {
      namespace: "adapter-test",
      waitForReady: false,
    });
    const binding = direct["direct.provider.event-log.nats"];
    expect(binding?.compositionId).toBe("nats-bootstrap");
    const plan = binding?.plan();
    expect(JSON.stringify(plan)).toContain("HelmRelease");
    expect(JSON.stringify(plan)).toContain("adapter-events");
    expect(JSON.stringify(plan)).toContain("nack");

    const declarations = await binding?.declarations("direct");
    expect(declarations?.length).toBeGreaterThan(0);
    expect(
      declarations?.some(
        (declaration) =>
          declaration.props.resource.kind === "HelmRelease"
          && declaration.props.resource.metadata?.name === "adapter-events",
      ),
    ).toBe(true);
    expect(
      declarations?.some(
        (declaration) =>
          declaration.props.resource.kind === "HelmRelease"
          && declaration.props.resource.metadata?.name === "nack",
      ),
    ).toBe(true);
    const nack = declarations?.find(
      (declaration) =>
        declaration.props.resource.kind === "HelmRelease"
        && declaration.props.resource.metadata?.name === "nack",
    );
    const server = declarations?.find(
      (declaration) =>
        declaration.props.resource.kind === "HelmRelease"
        && declaration.props.resource.metadata?.name === "adapter-events",
    );
    expect(nack?.props.retain).toBe(true);
    expect(server?.props.retain).not.toBe(true);
    const retained = declarations?.filter(
      (declaration) => declaration.props.retain === true,
    ) ?? [];
    expect(
      retained.every(
        (declaration) => declaration.id.toLowerCase().includes("nack"),
      ),
      JSON.stringify(retained.map((declaration) => ({
        id: declaration.id,
        kind: declaration.props.resource.kind,
        name: declaration.props.resource.metadata?.name,
        namespace: declaration.props.resource.metadata?.namespace,
      }))),
    ).toBe(true);
  });

  it("binds Hatchet through the released direct installation composition", async () => {
    const deploymentGraph = graphWithHatchetInstallation();
    const direct = bindApplicationTypeKroDirectNodes(deploymentGraph, {
      namespace: "adapter-test",
      waitForReady: false,
    });
    const binding = direct["direct.provider.workflow-engine.hatchet"];
    expect(binding?.compositionId).toBe("hatchet-installation");
    const plan = binding?.plan();
    expect(JSON.stringify(plan)).toContain("hatchet-stack");
    expect(JSON.stringify(plan)).toContain("adapter-workflows-database");
    expect(JSON.stringify(plan)).not.toContain("targetPath");

    const declarations = await binding?.declarations("direct");
    expect(declarations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        props: expect.objectContaining({
          resource: expect.objectContaining({
            kind: "HelmRelease",
            metadata: expect.objectContaining({ name: "hatchet" }),
          }),
        }),
      }),
      expect.objectContaining({
        props: expect.objectContaining({
          resource: expect.objectContaining({
            kind: "HelmRepository",
          }),
        }),
      }),
    ]));
  });

  it("materializes retained application CRDs as ordered TypeKro direct declarations", async () => {
    const base = graph("kro");
    const manifest = {
      apiVersion: "apiextensions.k8s.io/v1",
      kind: "CustomResourceDefinition",
      metadata: { name: "entries.testing.applik8s.dev" },
      spec: {
        group: "testing.applik8s.dev",
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
            schema: { openAPIV3Schema: { type: "object" } },
          },
        ],
      },
    } as const;
    const crdNodeId = "direct.crd.entries";
    const deploymentGraph: ApplicationDeploymentGraph = {
      ...base,
      nodes: [
        {
          id: crdNodeId,
          kind: "kubernetesDirect",
          contractVersion: 1,
          source: {},
          provider: {
            interface: "CustomResourceDefinition",
            implementation: "typekro-kubernetes",
            version: "1",
          },
          scope: {
            connectionDigest: base.metadata.identity.connection.digest,
          },
          capabilities: { strategies: ["direct"], alchemy: true },
          configurationDigest: digestApplicationDeploymentValue({
            name: manifest.metadata.name,
            manifest,
          }),
          inputs: {},
          outputs: [
            {
              name: "reference",
              type: "resourceReference",
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
            compositionId: "applik8s-custom-resource-definition",
            reason: "Establish the API first.",
            configuration: {
              name: manifest.metadata.name,
              manifest,
            },
          },
        },
        ...base.nodes,
      ],
      edges: [
        {
          from: crdNodeId,
          to: "kubernetes.application",
          relationship: "installsApi",
        },
      ],
    };
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

    expect(Object.keys(direct)).toEqual([crdNodeId]);
    expect(adapted.direct).toHaveLength(1);
    expect(
      adapted.direct[0]?.declarations.every(
        (declaration) => declaration.props.retain === true,
      ),
    ).toBe(true);
    expect(JSON.stringify(adapted.direct[0]?.declarations)).toContain(
      "entries.testing.applik8s.dev",
    );
    expect(JSON.stringify(adapted.direct[0]?.declarations)).toContain(
      "CustomResourceDefinition",
    );
  });

  it("binds the released TypeKro Envoy AI Gateway production composition", async () => {
    const deploymentGraph = graphWithEnvoyAIGateway();
    const direct = bindApplicationTypeKroDirectNodes(deploymentGraph, {
      namespace: "adapter-test",
      waitForReady: false,
    });
    expect(Object.keys(direct)).toEqual(["direct.provider.ai.gateway"]);
    const adapted = await adaptApplicationDeploymentToTypeKro({
      graph: deploymentGraph,
      root: bindTypeKroComposition(
        envoyEndpointComposition(),
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
      direct,
    });
    expect(adapted.direct).toHaveLength(1);
    expect(adapted.direct[0]?.semanticPlan.composition).toBe(
      "envoy-ai-gateway",
    );
    expect(adapted.direct[0]?.declarations.length).toBeGreaterThan(0);
    expect(
      adapted.direct[0]?.declarations.flatMap(
        (declaration) => declaration.artifactOutputUses ?? [],
      ),
    ).toEqual([]);
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
      if (strategy === "kro") {
        const rootRgd = adapted.root.declarations.find(
          (declaration) =>
            declaration.props.resource.kind === "ResourceGraphDefinition",
        );
        expect(rootRgd).toBeDefined();
        expect(
          Reflect.get(rootRgd?.props.resource.metadata ?? {}, "ownerReferences"),
        ).toBeUndefined();
        expect(
          Reflect.get(
            rootRgd?.props.resource ?? {},
            "withReadinessEvaluator",
          ),
        ).toBeUndefined();
        expect(rootRgd?.props.kroArtifactBundle).toBeTypeOf("string");
      }
      expect(
        adapted.root.semanticPlan.diagnostics.filter(
          (diagnostic) =>
            /\bsvc\b/i.test(diagnostic.message) ||
            /namespace.+(?:has no|missing).+namespace/i.test(
              diagnostic.message,
            ),
        ),
      ).toEqual([]);
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

  it("keeps static generated-Secret identities out of the root artifact surface", async () => {
    const deploymentGraph = materializedGraphWithStaticGeneratedSecret();
    const assembled = assembleApplicationTypeKroComposition(
      deploymentGraph,
      materializedSourceComposition(),
    );
    const binding = bindTypeKroComposition(
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
    );

    const declarations = await binding.declarations("kro");
    expect(
      declarations.flatMap(
        (declaration) => declaration.artifactOutputUses ?? [],
      ),
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requirementId: "external.provider.object-storage.credentials",
        }),
      ]),
    );
    const serialized = JSON.stringify(declarations);
    expect(serialized).toContain('"name":"adapter-object-credentials"');
    expect(serialized).not.toContain(
      "external.provider.object-storage.credentials",
    );
  });
});
