// typecast-file-boundary: Literal deployment discriminants are constructed here from validated ApplicationGraph inputs.
import type {
  ApplicationGraphNode,
  ApplicationProviderNode,
} from "@applik8s/core";
import {
  type ApplicationArtifactDeploymentNode,
  type ApplicationDeploymentEdge,
  type ApplicationDeploymentGraph,
  type ApplicationDeploymentInput,
  type ApplicationDeploymentNode,
  type ApplicationKubernetesCompositionDeploymentNode,
  digestApplicationDeploymentValue,
  validateApplicationDeploymentGraph,
} from "@applik8s/deployment-contract";
import {
  applicationProviderSelectionDeploymentContributor,
  builtinApplicationDeploymentContributors,
} from "./providers.js";
import type {
  ApplicationArtifactRequirement,
  ApplicationDeploymentContribution,
  ApplicationDeploymentContributor,
  ApplicationDeploymentPlanningContext,
  ApplicationGeneratedSecretRequirement,
  ApplicationTypeKroFragmentDescriptor,
  CompileApplicationDeploymentGraphRequest,
  CompileApplicationDeploymentGraphResult,
} from "./types.js";
import { compileApplicationRuntimeAccessPlan } from './runtime-access-plan.js';
import { assertApplicationScheduleProviderCompatibility } from './provider-guarantees.js';

export function compileApplicationDeploymentGraph(
  request: CompileApplicationDeploymentGraphRequest,
): CompileApplicationDeploymentGraphResult {
  const context: ApplicationDeploymentPlanningContext = {
    graph: request.graph,
    target: request.target ?? deploymentTargetFromConnection(request.identity.connection.provider),
    connection: request.identity.connection,
    instance: request.identity.instance,
    profile: request.identity.profile,
    strategy: request.strategy,
    installationSpec: request.installationSpec,
    ...(request.materializedComposition
      ? { materializedComposition: request.materializedComposition }
      : {}),
  };
	assertApplicationScheduleProviderCompatibility({
		graph: request.graph,
		target: context.target,
		...(request.identity.profile ? { profile: request.identity.profile } : {}),
	});
  const contributors = contributorRegistryWithBuiltins(request.contributors ?? []);
  const contributions: ApplicationDeploymentContribution[] = [];
  const fragments: ApplicationTypeKroFragmentDescriptor[] = [];
  const contributorKeys: string[] = [];
  for (const provider of providerNodes(request.graph.nodes)) {
    const key = contributorKey(provider.interface, provider.implementation);
    const contributor = hasProfileProviderBranches(provider)
      ? applicationProviderSelectionDeploymentContributor(provider.interface)
      : contributors.get(key)
        ?? (provider.implementation === "application-provider-selection" || provider.implementation === "application-target-provider-selection"
          ? applicationProviderSelectionDeploymentContributor(provider.interface)
          : undefined);
    if (!contributor) {
      throw new Error(
        `Application provider ${provider.id} has no deployment contributor for ${provider.interface}/${provider.implementation}.`,
      );
    }
    contributions.push(contributor.contribute(provider, context));
    contributorKeys.push(`${key}@${contributor.version}`);
  }
  for (const contribution of contributions) {
    fragments.push(...contribution.compositionFragments);
  }

  const artifactNodes = request.artifacts.map((artifact) =>
    artifactNode(artifact, request),
  );
  const contributionNodes = contributions.flatMap(
    (contribution) => contribution.nodes,
  );
  const contributionEdges = contributions.flatMap(
    (contribution) => contribution.edges,
  );
  const infrastructureNodes = applicationInfrastructureNodes(
    request,
    contributionNodes,
  );
  const baseArtifactIds = new Set(
    artifactNodes
      .map((artifact) => artifact.spec.sourceDescriptor.baseArtifactId)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );
  const directlyConsumedArtifactIds = new Set(
    contributionEdges.flatMap((edge) =>
      edge.relationship === "requiresOutput"
      && edge.to !== "kubernetes.application"
      && artifactNodes.some((artifact) => artifact.id === edge.from)
        ? [edge.from]
        : []
    ),
  );
  const rootArtifacts = artifactNodes.filter(
    (artifact) =>
      !baseArtifactIds.has(artifact.id)
      && !directlyConsumedArtifactIds.has(artifact.id),
  );
  const root = rootCompositionNode(request, rootArtifacts, fragments);
  const deploymentNodes = [
    ...artifactNodes,
    ...contributionNodes,
    ...infrastructureNodes,
    root,
  ];
  const graph: ApplicationDeploymentGraph = {
    apiVersion: "applik8s.deploymentGraph/v1alpha1",
    kind: "ApplicationDeploymentGraph",
    metadata: {
      identity: request.identity,
      mode: request.mode ?? "fresh",
      strategy: request.strategy,
      sourceGraphDigest: request.sourceGraphDigest,
      compilerVersion: request.compilerVersion,
      ...(request.profileTransition
        ? { profileTransition: request.profileTransition }
        : {}),
    },
    nodes: deploymentNodes,
    edges: [
      ...rootArtifacts.flatMap((artifact) => artifactEdges(artifact, root)),
      ...artifactDependencyEdges(artifactNodes),
      ...registryArtifactEdges(contributionNodes, artifactNodes),
      ...contributionEdges,
      ...[...contributionNodes, ...infrastructureNodes]
        .filter((node) => node.id !== root.id)
        // A contributor-authored root edge is the semantic authority for both
        // ordering and output consumption. Adding a generic requiresReady
        // edge beside it is redundant, and becomes an invalid duplicate when
        // the contributor deliberately selects requiresReady.
        .filter(
          (node) =>
            !contributionEdges.some(
              (edge) => edge.from === node.id && edge.to === root.id,
            ),
        )
        // A generated Secret consumed by another deployment node reaches the
        // root transitively through that consumer. Adding a second, synthetic
        // output edge to the root invents an artifact requirement that the
        // application composition does not consume.
        .filter(
          (node) =>
            !isGeneratedSecretNode(node) ||
            !contributionEdges.some(
              (edge) => edge.from === node.id && edge.to !== root.id,
            ),
        )
        .map(
          (node): ApplicationDeploymentEdge =>
            isGeneratedSecretNode(node)
              ? node.spec.referenceMode === "staticIdentity"
                ? {
                    from: node.id,
                    to: root.id,
                    relationship: "requiresReady",
                  }
                : {
                  from: node.id,
                  to: root.id,
                  relationship: "requiresOutput",
                  output: "name",
                }
              : isClusterApiPrerequisiteNode(node)
                ? {
                    from: node.id,
                    to: root.id,
                    relationship: "installsApi",
                  }
              : {
                  from: node.id,
                  to: root.id,
                  relationship: "requiresReady",
                },
        ),
      ...namespaceDependencyEdges(infrastructureNodes, deploymentNodes),
    ],
  };
  const validation = validateApplicationDeploymentGraph(graph);
  if (!validation.valid) {
    throw new Error(
      `Application deployment graph is invalid:\n${validation.diagnostics
        .map((diagnostic) => `- [${diagnostic.code}] ${diagnostic.message}`)
        .join("\n")}`,
    );
  }
  return {
    graph,
    contributorKeys: [...contributorKeys].sort(compareStrings),
    runtimeAccess: compileApplicationRuntimeAccessPlan({
      graph: request.graph,
      target: context.target,
      ...(request.workspaceRoot ? { workspaceRoot: request.workspaceRoot } : {}),
      namespace: request.graph.metadata.namespace && typeof request.graph.metadata.namespace === 'string'
        ? request.graph.metadata.namespace
        : request.identity.instance,
    }),
  };
}

function deploymentTargetFromConnection(provider: string): "local" | "aws-local" | "aws" | "kubernetes" {
  if (provider === "local" || provider === "aws-local" || provider === "aws") return provider;
  return "kubernetes";
}

/**
 * Graph normalization may already expose the selected implementation name
 * while retaining the profile branch descriptor as deployment authority.
 * Selection therefore follows the descriptor, not only the historical
 * `application-provider-selection` implementation marker.
 */
function hasProfileProviderBranches(
  provider: ApplicationProviderNode,
): boolean {
  const profile = provider.config?.profile;
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    return false;
  }
  const branches = Reflect.get(profile, "branches");
  return Array.isArray(branches) && branches.length > 0;
}

function isClusterApiPrerequisiteNode(
  node: ApplicationDeploymentNode,
): boolean {
  return (
    node.kind === "kubernetesDirect" &&
    node.spec.compositionId === "applik8s-custom-resource-definition"
  );
}

function applicationInfrastructureNodes(
  request: CompileApplicationDeploymentGraphRequest,
  contributionNodes: readonly ApplicationDeploymentNode[],
): readonly ApplicationDeploymentNode[] {
  const workloadNamespace = requiredConcreteNamespace(
    request.graph.metadata.namespace ??
      (typeof request.installationSpec.name === "string"
        ? request.installationSpec.name
        : request.identity.instance),
    "application workload namespace",
  );
  const controlPlaneNamespace = requiredConcreteNamespace(
    request.identity.controlPlaneNamespace,
    "application control-plane namespace",
  );
  const namespaceDeletion = contributionNodes.some(
    (node) =>
      node.scope.namespace === workloadNamespace &&
      (node.lifecycle.deletion === "retain" ||
        node.lifecycle.deletion === "orphan" ||
        node.lifecycle.deletion === "none"),
  )
    ? "retain"
    : "delete";
  const namespaces = new Map<string, ApplicationDeploymentNode>();
  // Bootstrap a non-protected control-plane namespace as retained
  // application infrastructure. The root Application instance depends on it,
  // so Alchemy creates it first and removes the instance before releasing the
  // retained namespace declaration during destroy. This gives a fresh
  // installation a one-command path without ever attempting to delete the
  // namespace that contains its own finalizing CR.
  if (!protectedKubernetesNamespace(controlPlaneNamespace)) {
    namespaces.set(
      controlPlaneNamespace,
      namespaceNode(
        "direct.namespace.control-plane",
        controlPlaneNamespace,
        "retain",
        request,
      ),
    );
  }
  // The External profile is a brownfield adoption boundary: its workload
  // namespace contains externally supplied provider credentials and therefore
  // must pre-exist and survive application destroy. A workload namespace that
  // is also the control-plane namespace inherits the safer retained lifecycle.
  if (
    request.identity.profile !== "external"
    && !protectedKubernetesNamespace(workloadNamespace)
    && !namespaces.has(workloadNamespace)
  ) {
    namespaces.set(
      workloadNamespace,
      namespaceNode(
        "direct.namespace.workload",
        workloadNamespace,
        namespaceDeletion,
        request,
      ),
    );
  }
  const generatedSecrets = [
    ...applicationGraphGeneratedSecrets(request),
    ...(request.generatedSecrets ?? []),
  ];
  return [
    ...namespaces.values(),
    ...clusterApiPrerequisiteNodes(request),
    ...dedupeGeneratedSecrets(generatedSecrets).map((secret) =>
      generatedSecretNode(secret, request),
    ),
  ];
}

function clusterApiPrerequisiteNodes(
  request: CompileApplicationDeploymentGraphRequest,
): readonly ApplicationDeploymentNode[] {
  return (request.clusterApiPrerequisites ?? [])
    .map((manifest) => {
      // typecast: readonly JSON arrays are rejected before restoring the
      // portable object branch for Kubernetes metadata inspection.
      const metadata = (
        manifest.metadata &&
        typeof manifest.metadata === "object" &&
        !Array.isArray(manifest.metadata)
          ? manifest.metadata
          : undefined
      ) as Readonly<Record<string, unknown>> | undefined;
      const name =
        metadata && typeof metadata.name === "string"
          ? metadata.name
          : undefined;
      if (
        manifest.apiVersion !== "apiextensions.k8s.io/v1" ||
        manifest.kind !== "CustomResourceDefinition" ||
        !name?.trim()
      ) {
        throw new Error(
          "Application cluster API prerequisites must be named apiextensions.k8s.io/v1 CustomResourceDefinitions.",
        );
      }
      const configuration = { name, manifest };
      return {
        id: `direct.crd.${digestApplicationDeploymentValue(name).slice("sha256:".length, 18)}`,
        kind: "kubernetesDirect" as const,
        contractVersion: 1,
        source: {},
        provider: {
          interface: "CustomResourceDefinition",
          implementation: "typekro-kubernetes",
          version: "1",
        },
        scope: { connectionDigest: request.identity.connection.digest },
        capabilities: {
          strategies: ["direct" as const],
          alchemy: true as const,
        },
        configurationDigest: digestApplicationDeploymentValue(configuration),
        inputs: {},
        outputs: [
          {
            name: "reference",
            type: "resourceReference" as const,
            sensitivity: "public" as const,
            persistence: "state" as const,
          },
        ],
        // A CRD may serve more than one application instance. Retain the
        // shared API when this installation is destroyed; removing one
        // consumer must never cascade-delete another consumer's custom
        // resources.
        lifecycle: {
          ownership: "shared" as const,
          deletion: "retain" as const,
          adoption: "createOrAdoptExact" as const,
        },
        spec: {
          compositionId: "applik8s-custom-resource-definition",
          reason:
            "Establish a shared application API before its controller and KRO instance reconcile.",
          configuration,
        },
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function protectedKubernetesNamespace(name: string): boolean {
  return name === "default"
    || name === "kube-system"
    || name === "kube-public"
    || name === "kube-node-lease";
}

function namespaceNode(
  id: string,
  name: string,
  deletion: "delete" | "retain",
  request: CompileApplicationDeploymentGraphRequest,
): ApplicationDeploymentNode {
  const configuration = { name };
  return {
    id,
    kind: "kubernetesDirect",
    contractVersion: 1,
    source: {},
    provider: {
      interface: "Namespace",
      implementation: "typekro-kubernetes",
      version: "1",
    },
    scope: { connectionDigest: request.identity.connection.digest },
    capabilities: { strategies: ["direct"], alchemy: true },
    configurationDigest: digestApplicationDeploymentValue(configuration),
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
      ownership: "application",
      deletion,
      adoption: "createOrAdoptExact",
    },
    spec: {
      compositionId: "applik8s-namespace",
      reason: "Hoist a lifecycle-aware Namespace before namespaced application resources.",
      configuration,
    },
  };
}

function applicationGraphGeneratedSecrets(
  request: CompileApplicationDeploymentGraphRequest,
): readonly ApplicationGeneratedSecretRequirement[] {
  const gatewaySecrets = request.graph.nodes.flatMap((node) => {
    if (
      node.kind !== "gateway" ||
      node.materialization !== "generatedDeployment" ||
      !node.deployment ||
      !node.cursorSecret
    ) {
      return [];
    }
    const namespace = requiredConcreteNamespace(
      node.cursorSecret.namespace ?? node.deployment.namespace,
      `gateway ${node.id} cursor Secret namespace`,
    );
    const name = requiredConcreteNamespace(
      node.cursorSecret.name,
      `gateway ${node.id} cursor Secret name`,
    );
    return [
      {
        id: `${node.id}.cursor`,
        namespace,
        name,
        values: {
          [node.cursorSecret.key]: {
            kind: "random" as const,
            bytes: 48,
            encoding: "base64url" as const,
          },
        },
        consumers: [node.id],
      },
    ];
  });
  const nodes = new Map(request.graph.nodes.map((node) => [node.id, node]));
  const contextConsumers = request.graph.nodes.flatMap((node) =>
    (node.kind === "gateway" &&
      node.materialization === "generatedDeployment") ||
    node.kind === "server" ||
    (node.kind === "workflowWorker" &&
      node.handlers.some((reference) => {
        const handler = nodes.get(reference.nodeId);
        return handler?.kind === "taskHandler" &&
          (handler.operations?.length ?? 0) > 0;
      }))
      ? [node.id]
      : [],
  );
  const contextSecrets =
    contextConsumers.length === 0
      ? []
      : [
          {
            id: "application.context",
            namespace: requiredConcreteNamespace(
              request.graph.metadata.namespace ?? "default",
              "application context Secret namespace",
            ),
            name: `${safeNodeId(request.graph.metadata.name)}-context`,
            values: {
              key: {
                kind: "random" as const,
                bytes: 48,
                encoding: "base64url" as const,
              },
            },
            consumers: [...new Set(contextConsumers)].sort(),
          },
        ];
  return [...gatewaySecrets, ...contextSecrets];
}

function dedupeGeneratedSecrets(
  requirements: readonly ApplicationGeneratedSecretRequirement[],
): readonly ApplicationGeneratedSecretRequirement[] {
  const secrets = new Map<string, ApplicationGeneratedSecretRequirement>();
  for (const requirement of requirements) {
    const identity = `${requirement.namespace}/${requirement.name}`;
    const existing = secrets.get(identity);
    if (!existing) {
      secrets.set(identity, requirement);
      continue;
    }
    if (
      digestApplicationDeploymentValue(existing.values) !==
      digestApplicationDeploymentValue(requirement.values)
    ) {
      throw new Error(
        `Generated Secret ${identity} is declared with conflicting value contracts.`,
      );
    }
    secrets.set(identity, {
      ...existing,
      consumers: [...new Set([...existing.consumers, ...requirement.consumers])].sort(),
    });
  }
  return [...secrets.values()].sort((left, right) =>
    `${left.namespace}/${left.name}`.localeCompare(
      `${right.namespace}/${right.name}`,
    ),
  );
}

function generatedSecretNode(
  requirement: ApplicationGeneratedSecretRequirement,
  request: CompileApplicationDeploymentGraphRequest,
): ApplicationDeploymentNode {
  const id = `external.generated-secret.${safeNodeId(
    requirement.id ?? requirement.name,
  )}`;
  const configuration = {
    namespace: requirement.namespace,
    name: requirement.name,
    values: requirement.values,
    consumers: [...requirement.consumers].sort(),
  };
  return {
    id,
    kind: "externalProvider",
    contractVersion: 1,
    source: {},
    provider: {
      interface: "Secret",
      implementation: "alchemy-kubernetes-generated-secret",
      version: "1",
    },
    scope: {
      connectionDigest: request.identity.connection.digest,
      namespace: requirement.namespace,
    },
    capabilities: { strategies: ["direct", "kro"], alchemy: true },
    configurationDigest: digestApplicationDeploymentValue(configuration),
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
      ...(requirement.referenceMode
        ? { referenceMode: requirement.referenceMode }
        : {}),
      configuration,
    },
  };
}

function isGeneratedSecretNode(node: ApplicationDeploymentNode): boolean {
  return (
    node.kind === "externalProvider" &&
    node.provider.interface === "Secret" &&
    node.provider.implementation ===
      "alchemy-kubernetes-generated-secret" &&
    node.spec.resourceType === "kubernetesGeneratedSecret"
  );
}

function namespaceDependencyEdges(
  infrastructureNodes: readonly ApplicationDeploymentNode[],
  nodes: readonly ApplicationDeploymentNode[],
): readonly ApplicationDeploymentEdge[] {
  const namespaces = infrastructureNodes.filter(
    (node) =>
      node.kind === "kubernetesDirect" &&
      node.spec.compositionId === "applik8s-namespace",
  );
  return namespaces.flatMap((namespaceNode) => {
    const configuration = namespaceNode.spec.configuration;
    const candidateName =
      configuration && typeof configuration === "object"
        ? Reflect.get(configuration, "name")
        : undefined;
    const name = typeof candidateName === "string" ? candidateName : undefined;
    if (!name) return [];
    return nodes
      .filter(
        (node) =>
          node.id !== namespaceNode.id &&
          node.kind !== "kubernetesComposition" &&
          node.scope.namespace === name,
      )
      .map((node) => ({
        from: namespaceNode.id,
        to: node.id,
        relationship: "requiresReady" as const,
      }));
  });
}

function requiredConcreteNamespace(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.includes("${")
  ) {
    throw new Error(`${label} must resolve to one concrete name before deployment planning.`);
  }
  return value;
}

function safeNodeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "");
}

function registryArtifactEdges(
  nodes: readonly ApplicationDeploymentNode[],
  artifacts: readonly ApplicationArtifactDeploymentNode[],
): readonly ApplicationDeploymentEdge[] {
  const registries = nodes.filter(
    (node) =>
      node.kind === "externalProvider" &&
      node.provider.interface === "ContainerRegistry",
  );
  return registries.flatMap((registry) =>
    artifacts.map((artifact) => ({
      from: registry.id,
      to: artifact.id,
      relationship: "requiresReady" as const,
    })),
  );
}

function artifactNode(
  artifact: ApplicationArtifactRequirement,
  request: CompileApplicationDeploymentGraphRequest,
): ApplicationArtifactDeploymentNode {
  return {
    id: artifact.id,
    kind: "artifact",
    contractVersion: 1,
    source: {
      ...(artifact.semanticNodeId
        ? { semanticNodeId: artifact.semanticNodeId }
        : {}),
    },
    provider: {
      interface: "Artifact",
      implementation: "typekro-oci",
      version: "1",
    },
    scope: {
      connectionDigest: request.identity.connection.digest,
    },
    capabilities: {
      strategies: ["direct", "kro"],
      alchemy: true,
    },
    configurationDigest: digestApplicationDeploymentValue(artifact),
    inputs: {},
    outputs: [
      {
        name: "immutableReference",
        type: "artifactReference",
        sensitivity: "public",
        persistence: "state",
      },
      {
        name: "taggedReference",
        type: "artifactReference",
        sensitivity: "public",
        persistence: "state",
      },
      {
        name: "digest",
        type: "artifactDigest",
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
      artifactType: artifact.artifactType,
      sourceDescriptor: {
        ...artifact.sourceDescriptor,
        name: artifact.name,
        sourceDigest: artifact.sourceDigest,
        ...(artifact.logicalReference
          ? { logicalReference: artifact.logicalReference }
          : {}),
      },
    },
  };
}

function rootCompositionNode(
  request: CompileApplicationDeploymentGraphRequest,
  artifacts: readonly ApplicationArtifactDeploymentNode[],
  fragments: readonly ApplicationTypeKroFragmentDescriptor[],
): ApplicationKubernetesCompositionDeploymentNode {
  const inputs: Record<string, ApplicationDeploymentInput> = {};
  for (const artifact of artifacts) {
    inputs[`artifact.${artifact.id}`] = {
      kind: "output",
      nodeId: artifact.id,
      output: "immutableReference",
      sensitivity: "public",
      persistence: "state",
    };
  }
  const fragmentIds = [
    ...request.graph.nodes
      .filter((node) => node.kind !== "provider")
      .map((node) => `semantic:${node.id}`),
    ...fragments.map((fragment) => fragment.id),
  ].sort(compareStrings);
  return {
    id: "kubernetes.application",
    kind: "kubernetesComposition",
    contractVersion: 1,
    source: {
      semanticNodeId: request.graph.metadata.name,
      ...(request.graph.metadata.sourceLocation
        ? {
            file: request.graph.metadata.sourceLocation.file,
            line: request.graph.metadata.sourceLocation.line,
            column: request.graph.metadata.sourceLocation.column,
          }
        : {}),
    },
    provider: {
      interface: "KubernetesApplication",
      implementation: "typekro",
      version: "1",
    },
    scope: {
      connectionDigest: request.identity.connection.digest,
      namespace: request.identity.controlPlaneNamespace,
    },
    capabilities: {
      strategies: ["direct", "kro"],
      alchemy: true,
    },
    configurationDigest: digestApplicationDeploymentValue({
      applicationGraph: request.sourceGraphDigest,
      installationSpec: request.installationSpec,
      strategy: request.strategy,
      fragmentIds,
    }),
    inputs,
    outputs: [
      {
        name: "status",
        type: "json",
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
      compositionId: request.graph.metadata.name,
      fragmentIds,
      installationSpec: request.installationSpec,
      fragments,
      ...(request.materializedComposition
        ? { materialized: request.materializedComposition }
        : {}),
    },
  };
}

function artifactEdges(
  artifact: ApplicationArtifactDeploymentNode,
  root: ApplicationDeploymentNode,
): readonly ApplicationDeploymentEdge[] {
  return [
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
  ];
}

function artifactDependencyEdges(
  artifacts: readonly ApplicationArtifactDeploymentNode[],
): readonly ApplicationDeploymentEdge[] {
  const ids = new Set(artifacts.map((artifact) => artifact.id));
  return artifacts.flatMap((artifact) => {
    const baseArtifactId = artifact.spec.sourceDescriptor.baseArtifactId;
    if (typeof baseArtifactId !== "string" || !baseArtifactId.trim()) {
      return [];
    }
    if (!ids.has(baseArtifactId)) {
      throw new Error(
        `Artifact ${artifact.id} requires missing base artifact ${baseArtifactId}.`,
      );
    }
    return [
      {
        from: baseArtifactId,
        to: artifact.id,
        relationship: "requiresOutput" as const,
        output: "immutableReference",
      },
    ];
  });
}

function providerNodes(
  nodes: readonly ApplicationGraphNode[],
): readonly ApplicationProviderNode[] {
  const providers = nodes.filter(
    (node): node is ApplicationProviderNode => node.kind === "provider",
  );
  const aliases = new Set<string>();
  for (const provider of providers) {
    const aliasOf = providerAliasTarget(provider);
    if (!aliasOf) continue;
    const target = providers.find((candidate) => candidate.id === aliasOf);
    if (!target) {
      throw new Error(
        `Application provider ${provider.id} aliases missing provider ${aliasOf}.`,
      );
    }
    if (target.interface !== provider.interface) {
      throw new Error(
        `Application provider ${provider.id} cannot alias ${target.id}: provider interfaces differ (${provider.interface} vs ${target.interface}).`,
      );
    }
    aliases.add(provider.id);
  }
  const primaryInterfaces = new Set(
    providers
      .filter((provider) => providerQualificationName(provider) === "primary")
      .map((provider) => provider.interface),
  );
  return providers.filter(
    (provider) =>
      !aliases.has(provider.id)
      && (
        providerQualificationName(provider) !== undefined
        || !primaryInterfaces.has(provider.interface)
      ),
  );
}

function providerAliasTarget(
  provider: ApplicationProviderNode,
): string | undefined {
  const aliasOf = provider.config?.aliasOf;
  return typeof aliasOf === "string" && aliasOf.trim()
    ? aliasOf
    : undefined;
}

function providerQualificationName(
  provider: ApplicationProviderNode,
): string | undefined {
  const qualification = provider.config?.qualification;
  if (
    !qualification
    || typeof qualification !== "object"
    || Array.isArray(qualification)
  ) {
    return undefined;
  }
  const name = Reflect.get(qualification, "name");
  return typeof name === "string" && name.trim() ? name : undefined;
}

function contributorRegistry(
  contributors: readonly ApplicationDeploymentContributor[],
): ReadonlyMap<string, ApplicationDeploymentContributor> {
  const registry = new Map<string, ApplicationDeploymentContributor>();
  for (const contributor of contributors) {
    const key = contributorKey(
      contributor.interface,
      contributor.implementation,
    );
    if (registry.has(key)) {
      throw new Error(`Duplicate application deployment contributor ${key}.`);
    }
    registry.set(key, contributor);
  }
  return registry;
}

function contributorRegistryWithBuiltins(
  contributors: readonly ApplicationDeploymentContributor[],
): ReadonlyMap<string, ApplicationDeploymentContributor> {
  const explicit = contributorRegistry(contributors);
  const builtins = builtinApplicationDeploymentContributors().filter(
    (contributor) =>
      !explicit.has(
        contributorKey(contributor.interface, contributor.implementation),
      ),
  );
  return contributorRegistry([...builtins, ...contributors]);
}

function contributorKey(
  providerInterface: string,
  implementation: string,
): string {
  return `${providerInterface}\0${implementation}`;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
