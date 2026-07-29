import type { ApplicationProviderNode } from "@applik8s/core";
import type {
  ApplicationDeploymentContribution,
  ApplicationDeploymentContributor,
  ApplicationDeploymentPlanningContext,
  ApplicationTypeKroFragmentDescriptor,
} from "./types.js";
import {
  digestApplicationDeploymentValue,
  type ApplicationDeploymentEdge,
  type ApplicationDeploymentNode,
  type ApplicationExternalProviderDeploymentNode,
  type ApplicationKubernetesDirectDeploymentNode,
  type DeploymentJsonObject,
  type DeploymentJsonValue,
} from "@applik8s/deployment-contract";

export type ApplicationProviderExecution =
  | "root-composition"
  | "runtime-only"
  | "external-controller";

interface BuiltinProviderRegistration {
  readonly interface: string;
  readonly implementation: string;
  readonly execution: ApplicationProviderExecution;
}

const builtinProviderRegistrations: readonly BuiltinProviderRegistration[] = [
  { interface: "ApplicationHost", implementation: "kubernetes-application-host", execution: "root-composition" },
  { interface: "Authorization", implementation: "application-authorization", execution: "runtime-only" },
  { interface: "Certificate", implementation: "cert-manager", execution: "root-composition" },
  { interface: "Certificate", implementation: "custom", execution: "runtime-only" },
  { interface: "ContainerRegistry", implementation: "application-provider-selection", execution: "external-controller" },
  { interface: "ContainerRegistry", implementation: "harbor-container-registry", execution: "external-controller" },
  { interface: "ContainerRegistry", implementation: "oci-container-registry", execution: "external-controller" },
  { interface: "ContainerRegistry", implementation: "orbstack-container-registry", execution: "external-controller" },
  { interface: "CounterStore", implementation: "kubernetes-resource-counter", execution: "runtime-only" },
  { interface: "CredentialStore", implementation: "kubernetes-secret-credentials", execution: "runtime-only" },
  { interface: "DnsPublication", implementation: "custom", execution: "runtime-only" },
  { interface: "DnsPublication", implementation: "external-dns", execution: "root-composition" },
  { interface: "EventLog", implementation: "nats-jetstream", execution: "root-composition" },
  { interface: "EventSource", implementation: "kubernetes-watch", execution: "runtime-only" },
  { interface: "HttpExposure", implementation: "ingress", execution: "root-composition" },
  { interface: "HttpExposure", implementation: "node-port", execution: "root-composition" },
  { interface: "IndexStore", implementation: "valkey", execution: "root-composition" },
  { interface: "TransactionalDatabase", implementation: "postgres", execution: "root-composition" },
  { interface: "ObjectStorage", implementation: "kubernetes-configmap-objects", execution: "runtime-only" },
  { interface: "ObjectStorage", implementation: "s3", execution: "root-composition" },
  { interface: "AnalyticalDatabase", implementation: "clickhouse", execution: "root-composition" },
  { interface: "Queue", implementation: "kubernetes-configmap-queue", execution: "runtime-only" },
  { interface: "RequestIdentity", implementation: "request-identity", execution: "runtime-only" },
  { interface: "Secret", implementation: "kubernetes-secret", execution: "runtime-only" },
  { interface: "StructuredGeneration", implementation: "application-provider-selection", execution: "runtime-only" },
  { interface: "StructuredGeneration", implementation: "structured-generation-deterministic", execution: "runtime-only" },
  { interface: "StructuredGeneration", implementation: "structured-generation-http", execution: "runtime-only" },
  { interface: "WorkflowEngine", implementation: "hatchet", execution: "root-composition" },
];

/**
 * Pure built-in provider catalog. Entries contribute portable data only;
 * TypeKro resolution happens later at the pinned adapter boundary.
 */
export function builtinApplicationDeploymentContributors(): readonly ApplicationDeploymentContributor[] {
  return builtinProviderRegistrations.map((registration) => ({
    interface: registration.interface,
    implementation: registration.implementation,
    version: 1,
    contribute(
      provider: ApplicationProviderNode,
      context: ApplicationDeploymentPlanningContext,
    ): ApplicationDeploymentContribution {
      const providerDirect = providerDirectContribution(provider, context);
      const nodes = [
        ...(registration.interface === "ContainerRegistry"
          ? managedHarborNodes(provider, context)
          : []),
        ...providerDirect.nodes,
      ];
      return {
        nodes,
        edges: providerDirect.edges,
        compositionFragments: [
          providerFragment(provider, context, registration.execution),
        ],
      };
    },
  }));
}

interface ProviderDirectContribution {
  readonly nodes: readonly ApplicationDeploymentNode[];
  readonly edges: readonly ApplicationDeploymentEdge[];
}

function providerDirectContribution(
  provider: ApplicationProviderNode,
  context: ApplicationDeploymentPlanningContext,
): ProviderDirectContribution {
  if (provider.interface === "IndexStore" && provider.implementation === "valkey") {
    return valkeyDirectContribution(provider, context);
  }
  if (
    provider.interface === "TransactionalDatabase" &&
    provider.implementation === "postgres"
  ) {
    return postgresDirectContribution(provider, context);
  }
  if (provider.interface === "ObjectStorage" && provider.implementation === "s3") {
    return objectStorageDirectContribution(provider, context);
  }
  if (
    provider.interface === "RequestIdentity" &&
    provider.implementation === "request-identity"
  ) {
    return identityDirectContribution(provider, context);
  }
  if (
    provider.interface === "WorkflowEngine" &&
    provider.implementation === "hatchet"
  ) {
    return workflowDirectContribution(provider, context);
  }
  return { nodes: [], edges: [] };
}

function workflowDirectContribution(
  provider: ApplicationProviderNode,
  context: ApplicationDeploymentPlanningContext,
): ProviderDirectContribution {
  const value = provider.config;
  if (
    !value ||
    value.kind !== "hatchet" ||
    value.enabled === false ||
    value.provision === false
  ) {
    return { nodes: [], edges: [] };
  }
  if (optionalObject(value.adminCredentialsSecret)) {
    return { nodes: [], edges: [] };
  }
  const namespace = optionalString(value.namespace) ?? applicationNamespace(context);
  const name = `${optionalString(value.name) ?? "applik8s-hatchet"}-admin`;
  const configuration = {
    namespace,
    name,
    values: {
      adminEmail: {
        kind: "publicLiteral",
        value: "admin@applik8s.local",
      },
      adminPassword: {
        kind: "random",
        bytes: 32,
        encoding: "base64url",
      },
    },
    consumers: [provider.id],
  };
  const node: ApplicationExternalProviderDeploymentNode = {
    id: `external.${provider.id}.admin-secret`,
    kind: "externalProvider",
    contractVersion: 1,
    source: { semanticNodeId: provider.id },
    provider: {
      interface: "Secret",
      implementation: "alchemy-kubernetes-generated-secret",
      version: "1",
    },
    scope: {
      connectionDigest: context.connection.digest,
      namespace,
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
      configuration,
    },
  };
  return { nodes: [node], edges: [] };
}

function valkeyDirectContribution(
  provider: ApplicationProviderNode,
  context: ApplicationDeploymentPlanningContext,
): ProviderDirectContribution {
  const value = nestedObject(provider.config, "indexStore");
  if (
    value?.kind !== "valkey" ||
    value.provision === false ||
    value.provisioner !== "hyperspike"
  ) {
    return { nodes: [], edges: [] };
  }
  const namespace = optionalString(value.namespace) ?? applicationNamespace(context);
  const name = optionalString(value.name) ?? `${context.graph.metadata.name}-index`;
  const nodes: ApplicationKubernetesDirectDeploymentNode[] = [];
  const edges: ApplicationDeploymentEdge[] = [];
  const operator = optionalObject(value.operator);
  const operatorNodeId = `direct.${provider.id}.operator`;
  if (operator?.provision !== false) {
    const configuration = compactJson({
      name:
        optionalString(operator?.name) ??
        "applik8s-valkey-operator",
      namespace:
        optionalString(operator?.namespace) ??
        "valkey-operator-system",
      ...(optionalString(operator?.version)
        ? { version: optionalString(operator?.version) }
        : {}),
    });
    nodes.push(
      directNode({
        id: operatorNodeId,
        provider,
        context,
        compositionId: "valkey-bootstrap",
        reason: "Install the shared Hyperspike Valkey API before application clusters.",
        namespace: requiredString(configuration.namespace, "Valkey operator namespace"),
        configuration,
        ownership: "shared",
        deletion: "retain",
      }),
    );
  }
  const topology = optionalObject(value.topology);
  const authentication = optionalObject(value.authentication);
  const storage = optionalObject(value.storage);
  const shards = optionalInteger(topology?.shards) ?? 1;
  const replicas = optionalInteger(topology?.replicas) ?? 0;
  if (shards < 1 || shards > 100) {
    throw new Error("Hyperspike Valkey topology.shards must be between 1 and 100.");
  }
  if (replicas < 0 || replicas > 10) {
    throw new Error("Hyperspike Valkey topology.replicas must be between 0 and 10.");
  }
  const authenticationMode =
    authentication?.mode === "password" ? "password" : "anonymous";
  const authenticationSecret = optionalObject(authentication?.secret);
  if (authenticationMode === "password" && !optionalString(authenticationSecret?.name)) {
    throw new Error("Hyperspike Valkey password authentication requires a named Secret.");
  }
  const customSpec = optionalObject(value.spec);
  const reserved = [
    "shards",
    "nodes",
    "replicas",
    "anonymousAuth",
    "servicePassword",
    "storage",
    "resources",
  ].filter((field) => customSpec && Object.hasOwn(customSpec, field));
  if (reserved.length > 0) {
    throw new Error(
      `Hyperspike Valkey spec cannot override typed provider fields: ${reserved.join(", ")}.`,
    );
  }
  const valkeySpec = compactJson({
    shards,
    replicas,
    anonymousAuth: authenticationMode === "anonymous",
    ...(authenticationMode === "password" && authenticationSecret
      ? {
          servicePassword: {
            name: requiredString(
              authenticationSecret.name,
              "Valkey password Secret name",
            ),
            key: optionalString(authentication?.key) ?? "password",
          },
        }
      : {}),
    ...(storage
      ? {
          storage: {
            spec: {
              resources: {
                requests: {
                  storage: requiredString(
                    storage.size,
                    "Valkey storage size",
                  ),
                },
              },
              accessModes: ["ReadWriteOnce"],
              ...(optionalString(storage.storageClassName)
                ? {
                    storageClassName: optionalString(
                      storage.storageClassName,
                    ),
                  }
                : {}),
            },
          },
        }
      : {}),
    ...(optionalObject(value.resources)
      ? { resources: optionalObject(value.resources) }
      : {}),
    ...(customSpec ?? {}),
  });
  const clusterNodeId = `direct.${provider.id}.cluster`;
  nodes.push(
    directNode({
      id: clusterNodeId,
      provider,
      context,
      compositionId: "applik8s-valkey-cluster-provider",
      reason:
        "Keep operator-managed Valkey children outside the root KRO ApplySet.",
      namespace,
      configuration: compactJson({
        name,
        namespace,
        spec: valkeySpec,
      }),
      ownership: "application",
      deletion: "delete",
    }),
  );
  if (nodes.some((node) => node.id === operatorNodeId)) {
    edges.push({
      from: operatorNodeId,
      to: clusterNodeId,
      relationship: "installsApi",
    });
  }
  return { nodes, edges };
}

function postgresDirectContribution(
  provider: ApplicationProviderNode,
  context: ApplicationDeploymentPlanningContext,
): ProviderDirectContribution {
  const value = nestedObject(provider.config, "transactionalDatabase");
  if (
    value?.kind !== "postgres" ||
    value.ownership !== "direct-provisioned"
  ) {
    return { nodes: [], edges: [] };
  }
  if (value.provision === false || value.cluster !== undefined) {
    throw new Error(
      "Direct-provisioned Postgres cannot disable provisioning or reference an external cluster.",
    );
  }
  const lifecycle = optionalObject(value.lifecycle);
  const deletionPolicy =
    lifecycle?.deletionPolicy === "delete"
      ? "delete"
      : lifecycle?.deletionPolicy === "retain"
        ? "retain"
        : undefined;
  if (!deletionPolicy) {
    throw new Error(
      "Direct-provisioned Postgres requires lifecycle.deletionPolicy.",
    );
  }
  const namespace = optionalString(value.namespace) ?? applicationNamespace(context);
  const name =
    optionalString(value.clusterName) ??
    optionalString(value.name) ??
    `${context.graph.metadata.name}-db`;
  const database = optionalString(value.database) ?? context.graph.metadata.name;
  const configuration = compactJson({
    name,
    namespace,
    spec: postgresClusterSpec(value, database),
  });
  return {
    nodes: [
      directNode({
        id: `direct.${provider.id}.cluster`,
        provider,
        context,
        compositionId: "applik8s-postgres-cluster-provider",
        reason:
          "Give retained CloudNativePG data an explicit lifecycle outside the root KRO ApplySet.",
        namespace,
        configuration,
        ownership: "application",
        deletion: deletionPolicy,
      }),
    ],
    edges: [],
  };
}

function objectStorageDirectContribution(
  provider: ApplicationProviderNode,
  context: ApplicationDeploymentPlanningContext,
): ProviderDirectContribution {
  const value = nestedObject(provider.config, "objectStorage");
  const provisioning = optionalObject(value?.provisioning);
  if (
    value?.kind !== "s3" ||
    value.enabled === false ||
    value.ownership !== "direct-provisioned" ||
    provisioning?.enabled === false
  ) {
    return { nodes: [], edges: [] };
  }
  const secret = optionalObject(value.credentialsSecret);
  const namespace = requiredString(
    secret?.namespace,
    "Direct-provisioned S3 credentials Secret namespace",
  );
  const bucket = requiredString(value.bucket, "Direct-provisioned S3 bucket");
  const name =
    optionalString(provisioning?.claimName) ??
    optionalString(value.name) ??
    optionalString(secret?.name) ??
    bucket;
  if (optionalString(secret?.name) !== name) {
    throw new Error(
      "Direct-provisioned S3 credentials Secret name must match provisioning.claimName.",
    );
  }
  return {
    nodes: [
      directNode({
        id: `direct.${provider.id}.claim`,
        provider,
        context,
        compositionId: "rook-object-storage-claim",
        reason:
          "ObjectBucketClaims are controller-mutated and require TypeKro direct mode.",
        namespace,
        configuration: compactJson({
          name,
          namespace,
          storageClassName: requiredString(
            provisioning?.storageClassName,
            "Direct-provisioned S3 StorageClass",
          ),
          bucket: { mode: "fixed", name: bucket },
        }),
        ownership: "application",
        deletion: "delete",
      }),
    ],
    edges: [],
  };
}

function identityDirectContribution(
  provider: ApplicationProviderNode,
  context: ApplicationDeploymentPlanningContext,
): ProviderDirectContribution {
  const value = nestedObject(provider.config, "identityInfrastructure");
  if (value?.kind !== "ory" || value.provision === false) {
    return { nodes: [], edges: [] };
  }
  const spec = requiredObject(value.spec, "Ory identity infrastructure spec");
  const namespace = requiredString(spec.namespace, "Ory identity namespace");
  const stack =
    value.stack === "platform"
      ? "platform"
      : value.stack === "identity"
        ? "identity"
        : undefined;
  if (!stack) {
    throw new Error("Ory identity infrastructure stack must be identity or platform.");
  }
  return {
    nodes: [
      directNode({
        id: `direct.${provider.id}.ory-${stack}`,
        provider,
        context,
        compositionId:
          stack === "platform" ? "ory-platform-stack" : "ory-identity-stack",
        reason:
          "Managed identity infrastructure has an explicit lifecycle outside runtime request admission.",
        namespace,
        configuration: spec,
        ownership: "application",
        deletion: value.deletionPolicy === "delete" ? "delete" : "retain",
      }),
    ],
    edges: [],
  };
}

function directNode(options: {
  readonly id: string;
  readonly provider: ApplicationProviderNode;
  readonly context: ApplicationDeploymentPlanningContext;
  readonly compositionId: string;
  readonly reason: string;
  readonly namespace: string;
  readonly configuration: DeploymentJsonObject;
  readonly ownership: "application" | "shared";
  readonly deletion: "delete" | "retain";
}): ApplicationKubernetesDirectDeploymentNode {
  return {
    id: options.id,
    kind: "kubernetesDirect",
    contractVersion: 1,
    source: { semanticNodeId: options.provider.id },
    provider: {
      interface: options.provider.interface,
      implementation: options.compositionId,
      version: "1",
    },
    scope: {
      connectionDigest: options.context.connection.digest,
      namespace: options.namespace,
    },
    capabilities: { strategies: ["direct", "kro"], alchemy: true },
    configurationDigest: digestApplicationDeploymentValue(
      options.configuration,
    ),
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
      ownership: options.ownership,
      deletion: options.deletion,
      adoption: "createOrAdoptExact",
    },
    spec: {
      compositionId: options.compositionId,
      reason: options.reason,
      configuration: options.configuration,
    },
  };
}

function postgresClusterSpec(
  provider: DeploymentJsonObject,
  database: string,
): DeploymentJsonObject {
  const storage = optionalObject(provider.storage);
  const resources = optionalObject(provider.resources);
  const backup = optionalObject(provider.backup);
  return compactJson({
    instances: optionalInteger(provider.instances) ?? 1,
    storage: {
      size: optionalString(storage?.size) ?? "1Gi",
      ...(optionalString(storage?.storageClassName)
        ? { storageClass: optionalString(storage?.storageClassName) }
        : {}),
    },
    ...(resources ? { resources } : {}),
    bootstrap: { initdb: { database, owner: "app" } },
    ...(backup && backup.enabled !== false
      ? { backup: postgresBackupSpec(backup) }
      : {}),
  });
}

function postgresBackupSpec(backup: DeploymentJsonObject): DeploymentJsonObject {
  const destination = requiredObject(
    backup.destination,
    "Postgres backup destination",
  );
  const common = {
    retentionPolicy: requiredString(
      backup.retentionPolicy,
      "Postgres backup retentionPolicy",
    ),
    target: backup.target === "primary" ? "primary" : "prefer-standby",
  };
  if (destination.kind === "volume-snapshot") {
    return compactJson({
      ...common,
      volumeSnapshot: {
        ...(optionalString(destination.className)
          ? { className: optionalString(destination.className) }
          : {}),
        online: destination.online !== false,
      },
    });
  }
  if (destination.kind !== "s3") {
    throw new Error("Postgres backup destination must be volume-snapshot or s3.");
  }
  const secret = requiredObject(
    destination.credentialsSecret,
    "Postgres S3 backup credentials Secret",
  );
  const name = requiredString(
    secret.name,
    "Postgres S3 backup credentials Secret name",
  );
  return compactJson({
    ...common,
    barmanObjectStore: {
      destinationPath: requiredString(
        destination.destinationPath,
        "Postgres S3 backup destinationPath",
      ),
      ...(optionalString(destination.endpoint)
        ? { endpointURL: optionalString(destination.endpoint) }
        : {}),
      s3Credentials: {
        accessKeyId: {
          name,
          key: optionalString(destination.accessKeyIdKey) ?? "AWS_ACCESS_KEY_ID",
        },
        secretAccessKey: {
          name,
          key:
            optionalString(destination.secretAccessKeyKey) ??
            "AWS_SECRET_ACCESS_KEY",
        },
        ...(optionalString(destination.regionKey)
          ? {
              region: {
                name,
                key: optionalString(destination.regionKey),
              },
            }
          : {}),
      },
      data: { compression: "gzip", jobs: 2, immediateCheckpoint: true },
      wal: { compression: "gzip", maxParallel: 2 },
    },
  });
}

function applicationNamespace(
  context: ApplicationDeploymentPlanningContext,
): string {
  return (
    context.graph.metadata.namespace ??
    optionalString(context.installationSpec.name) ??
    "default"
  );
}

function nestedObject(
  value: DeploymentJsonObject | undefined,
  key: string,
): DeploymentJsonObject | undefined {
  return optionalObject(value?.[key]);
}

// typecast-boundary: the runtime object/array guard narrows an unknown
// provider value to the deployment JSON object boundary.
function optionalObject(value: unknown): DeploymentJsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as DeploymentJsonObject)
    : undefined;
}

function requiredObject(value: unknown, label: string): DeploymentJsonObject {
  const result = optionalObject(value);
  if (!result) throw new Error(`${label} must be an object.`);
  return result;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function requiredString(value: unknown, label: string): string {
  const result = optionalString(value);
  if (!result) throw new Error(`${label} must be a non-empty string.`);
  return result;
}

function optionalInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value)
    ? value
    : undefined;
}

function compactJson(
  value: Readonly<Record<string, unknown>>,
): DeploymentJsonObject {
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry) => entry[1] !== undefined)
      .map(([key, candidate]) => [key, deploymentJsonValue(candidate, key)]),
  );
}

// typecast-boundary: every nested candidate is recursively validated before
// an object is accepted as portable deployment JSON.
function deploymentJsonValue(
  value: unknown,
  path: string,
): DeploymentJsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new Error(`${path} must be a finite JSON number.`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((candidate, index) =>
      deploymentJsonValue(candidate, `${path}[${index}]`),
    );
  }
  if (value && typeof value === "object") {
    return compactJson(value as Readonly<Record<string, unknown>>);
  }
  throw new Error(`${path} is not portable deployment JSON.`);
}

function managedHarborNodes(
  provider: ApplicationProviderNode,
  context: ApplicationDeploymentPlanningContext,
): readonly ApplicationExternalProviderDeploymentNode[] {
  const registry = provider.config?.containerRegistry;
  if (
    !registry ||
    typeof registry !== "object" ||
    Array.isArray(registry) ||
    Reflect.get(registry, "kind") !== "harbor-container-registry"
  ) {
    return [];
  }
  const management = Reflect.get(registry, "management");
  if (!management || typeof management !== "object" || Array.isArray(management)) {
    return [];
  }
  const secretNamespace = Reflect.get(management, "secretNamespace");
  const projectLifecycle = Reflect.get(management, "projectLifecycle");
  const deletionPolicy =
    projectLifecycle &&
    typeof projectLifecycle === "object" &&
    Reflect.get(projectLifecycle, "deletionPolicy") === "delete"
      ? "delete"
      : "retain";
  if (typeof secretNamespace !== "string" || !secretNamespace.trim()) {
    throw new Error(
      `Managed Harbor provider ${provider.id} requires a concrete management.secretNamespace after installation resolution.`,
    );
  }
  // typecast: ApplicationGraph provider configuration has already crossed the
  // typecast: JSON graph boundary; the compiler preserves it without interpretation.
  const configuration = registry as DeploymentJsonObject;
  return [
    {
      id: `external.${provider.id}.harbor-project`,
      kind: "externalProvider",
      contractVersion: 1,
      source: { semanticNodeId: provider.id },
      provider: {
        interface: "ContainerRegistry",
        implementation: "typekro-harbor-project",
        version: "1",
      },
      scope: {
        connectionDigest: context.connection.digest,
        namespace: secretNamespace,
      },
      capabilities: {
        strategies: ["direct", "kro"],
        alchemy: true,
      },
      configurationDigest: digestApplicationDeploymentValue(configuration),
      inputs: {},
      outputs: [
        {
          name: "ready",
          type: "boolean",
          sensitivity: "public",
          persistence: "state",
        },
        {
          name: "project",
          type: "string",
          sensitivity: "public",
          persistence: "state",
        },
      ],
      lifecycle: {
        ownership: "application",
        deletion: deletionPolicy,
        adoption: "createOrAdoptExact",
      },
      spec: {
        resourceType: "harborProject",
        controller: "typekro-harbor",
        configuration,
      },
    },
  ];
}

function providerFragment(
  provider: ApplicationProviderNode,
  context: ApplicationDeploymentPlanningContext,
  execution: ApplicationProviderExecution,
): ApplicationTypeKroFragmentDescriptor {
  return {
    id: `provider:${provider.id}`,
    sourceNodeId: provider.id,
    providerInterface: provider.interface,
    providerImplementation: provider.implementation,
    contributorVersion: 1,
    execution,
    profile: context.profile,
    configuration: provider.config ?? {},
  };
}
