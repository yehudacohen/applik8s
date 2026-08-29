// typecast-file-boundary: Portable provider configuration is discriminator-checked before binding to pinned TypeKro factory schemas.
import type {
  ApplicationDeploymentGraph,
  ApplicationKubernetesDirectDeploymentNode,
  DeploymentJsonObject,
} from "@applik8s/deployment-contract";
import {
  makeCelldFleetArtifactInstallation,
  makeCelldOperatorArtifactBootstrap,
} from '@applik8s/celld-operator/typekro';
import { type } from "arktype";
import {
  kubernetesComposition,
  type PublicFactoryOptions,
  singleton,
} from "typekro";
import {
  type ClickHouseClusterSpec,
  clickhouseOperatorBootstrap,
  makeClickHouseCluster,
} from "typekro/clickhouse";
import { makeClickstackBootstrap } from "typekro/clickstack";
import { ClusterConfigSchema, cluster } from "typekro/cnpg";
import { makeEnvoyAIGateway } from "typekro/envoy-ai-gateway";
import { hatchetInstallation } from "typekro/hatchet";
import {
  customResourceDefinition as kubernetesCustomResourceDefinition,
  deployment as kubernetesDeployment,
  namespace as kubernetesNamespace,
  networkPolicy as kubernetesNetworkPolicy,
  persistentVolumeClaim as kubernetesPersistentVolumeClaim,
  service as kubernetesService,
} from "typekro/kubernetes";
import { natsBootstrap } from "typekro/nats";
import {
  makeOpenSearchCluster,
  makeOpenSearchOperatorBootstrap,
} from "typekro/opensearch";
import { oryIdentityStack, oryPlatformStack } from "typekro/ory";
import { searxngBootstrap } from 'typekro/searxng';
import {
  type RookCephExternalOperatorSingleNodePlatformConfig,
  RookCephExternalOperatorSingleNodePlatformConfigSchema,
  type RookCephOperatorBootstrapConfig,
  RookCephOperatorBootstrapConfigSchema,
  rookCephExternalOperatorSingleNodePlatform,
  rookCephOperatorBootstrap,
  rookObjectStorageClaim,
} from "typekro/rook";
import {
  ValkeyConfigSchema,
  valkey,
  valkeyBootstrap,
} from "typekro/valkey";
import {
  bindTypeKroComposition,
  type TypeKroPlannableComposition,
  typeKroArtifactRequirements,
} from "./binding.js";
import { expressionContext } from "./expression-reconstruction.js";
import {
  artifactSubstitutionIndex,
  transformMaterializedValue,
} from "./materialized-values.js";
import type { TypeKroCompositionBinding } from "./types.js";

interface DirectNamespaceSpec {
  readonly name: string;
}

interface DirectClusterSpec {
  readonly name: string;
  readonly namespace: string;
  readonly spec: Readonly<Record<string, unknown>>;
}

interface LocalS3Spec {
  readonly name: string;
  readonly namespace: string;
  readonly bucket: string;
  readonly credentialsSecretName: string;
  readonly image: string;
  readonly storage: {
    readonly size: string;
    readonly storageClassName?: string;
  };
}


interface ClickStackInstanceSpec {
  readonly name: string;
  readonly namespace: string;
  readonly clickhouse: {
    readonly host: string;
    readonly nativePort: number;
    readonly httpPort: number;
    readonly database: string;
    readonly username: string;
  };
  readonly credentialsSecret: {
    readonly name: string;
    readonly valuesKey: string;
  };
}

/**
 * Provider adapters intentionally erase TypeKro's recursively expanded
 * callable-composition return type. The complete schemas remain the runtime
 * authority, while this internal boundary prevents declaration emit for
 * @applik8s/deployment-typekro from recursively materializing every
 * provider-native schema and exhausting TypeScript's instantiation budget.
 */
const providerComposition = kubernetesComposition as unknown as <
  TSpec extends object,
>(
  definition: {
    readonly name: string;
    readonly kind: string;
    readonly spec: unknown;
    readonly status: unknown;
  },
  composition: (spec: TSpec) => object,
) => TypeKroPlannableComposition<TSpec>;

const DirectReadyStatusSchema = type({ ready: "boolean" });
const DirectPostgresStatusSchema = type({
  "phase?": "string",
  "readyInstances?": "number.integer >= 0",
});
const DirectNamespaceSpecSchema = type({ name: "string" });
const LocalS3SpecSchema = type({
  name: "string",
  namespace: "string",
  bucket: "string",
  credentialsSecretName: "string",
  image: "string",
  storage: {
    size: "string",
    "storageClassName?": "string",
  },
});
const ClickStackInstanceSpecSchema = type({
  name: "string > 0",
  namespace: "string > 0",
  clickhouse: {
    host: "string > 0",
    nativePort: "1 <= number.integer <= 65535",
    httpPort: "1 <= number.integer <= 65535",
    database: "string > 0",
    username: "string > 0",
  },
  credentialsSecret: {
    name: "string > 0",
    valuesKey: "string > 0",
  },
});
const ClickStackClickHouseSpecSchema = type({
  name: "string > 0",
  namespace: "string > 0",
  version: "string > 0",
  "clusterName?": "string > 0",
  storage: {
    size: "string > 0",
    "storageClassName?": "string > 0",
  },
  "podResources?": {
    "requests?": { "cpu?": "string", "memory?": "string" },
    "limits?": { "cpu?": "string", "memory?": "string" },
  },
  users: {
    otelcollector: {
      passwordSecretRef: {
        name: "string > 0",
        key: "string > 0",
      },
    },
  },
});
const ClickStackStatusSchema = type({
  ready: "boolean",
  otlpHttpEndpoint: "string",
  uiUrl: "string",
});

const applicationNamespaceProvider =
  providerComposition<DirectNamespaceSpec>(
  {
    name: "applik8s-namespace",
    kind: "ApplicationNamespace",
    spec: DirectNamespaceSpecSchema,
    status: DirectReadyStatusSchema,
  },
  (spec) => {
    kubernetesNamespace({
      id: "namespace",
      apiVersion: "v1",
      kind: "Namespace",
      metadata: {
        name: spec.name,
        labels: {
          "app.kubernetes.io/managed-by": "applik8s",
        },
      },
    });
    return { ready: true };
  },
);

const applicationUnownedNamespaceProvider =
  providerComposition<DirectNamespaceSpec>(
  {
    name: "applik8s-unowned-namespace",
    kind: "ApplicationUnownedNamespace",
    spec: DirectNamespaceSpecSchema,
    status: DirectReadyStatusSchema,
  },
  (spec) => {
    kubernetesNamespace({
      id: "namespace",
      apiVersion: "v1",
      kind: "Namespace",
      metadata: { name: spec.name },
    });
    return { ready: true };
  },
);

function applicationCustomResourceDefinitionProvider(
  manifest: DeploymentJsonObject,
) {
  return providerComposition<DirectNamespaceSpec>(
    {
      name: "applik8s-custom-resource-definition",
      kind: "ApplicationCustomResourceDefinition",
      spec: DirectNamespaceSpecSchema,
      status: DirectReadyStatusSchema,
    },
    () => {
      kubernetesCustomResourceDefinition({
        id: "customResourceDefinition",
        // typecast: the deployment compiler accepts only a concrete
        // apiextensions.k8s.io/v1 CRD at this boundary. Capturing the manifest
        // here also prevents an opaque object-shaped schema proxy from erasing
        // its fields during TypeKro semantic planning.
        ...manifest,
      } as never);
      return { ready: true };
    },
  );
}

const applicationRookCephOperatorProvider =
  providerComposition<RookCephOperatorBootstrapConfig>(
    {
      name: "applik8s-rook-ceph-operator",
      kind: "ApplicationRookCephOperator",
      spec: RookCephOperatorBootstrapConfigSchema,
      status: DirectReadyStatusSchema,
    },
    (spec) => {
      const operator = singleton(rookCephOperatorBootstrap, {
        id: "sharedRookCephOperator",
        spec,
      });
      return { ready: operator.status.ready };
    },
  );

const applicationRookCephExternalOperatorSingleNodePlatformProvider =
  providerComposition<RookCephExternalOperatorSingleNodePlatformConfig>(
    {
      name: "applik8s-rook-ceph-external-operator-single-node-platform",
      kind: "ApplicationRookCephExternalOperatorSingleNodePlatform",
      spec: RookCephExternalOperatorSingleNodePlatformConfigSchema,
      status: DirectReadyStatusSchema,
    },
    (spec) => {
      const platform = singleton(rookCephExternalOperatorSingleNodePlatform, {
        id: "sharedRookCephPlatform",
        spec,
      });
      return { ready: platform.status.ready };
    },
  );

const applicationValkeyClusterProvider =
  providerComposition<DirectClusterSpec>(
  {
    name: "applik8s-valkey-cluster-provider",
    kind: "ApplicationValkeyClusterProvider",
    spec: ValkeyConfigSchema,
    status: DirectReadyStatusSchema,
  },
  (spec) => {
    const resource = valkey({
      id: "cluster",
      name: spec.name,
      namespace: spec.namespace,
      spec: spec.spec as never,
    });
    return { ready: resource.status.ready };
  },
);

const applicationPostgresClusterProvider =
  providerComposition<DirectClusterSpec>(
  {
    name: "applik8s-postgres-cluster-provider",
    kind: "ApplicationPostgresClusterProvider",
    spec: ClusterConfigSchema,
    status: DirectPostgresStatusSchema,
  },
  (spec) => {
    const resource = cluster({
      id: "cluster",
      name: spec.name,
      namespace: spec.namespace,
      spec: spec.spec as never,
    });
    return {
      phase: resource.status.phase,
      readyInstances: resource.status.readyInstances,
    };
  },
);

const applicationLocalS3Provider =
  providerComposition<LocalS3Spec>(
  {
    name: "applik8s-local-s3",
    kind: "ApplicationLocalS3",
    spec: LocalS3SpecSchema,
    status: DirectReadyStatusSchema,
  },
  (spec) => {
    const labels = {
      "app.kubernetes.io/name": "seaweedfs",
      "app.kubernetes.io/instance": spec.name,
      "app.kubernetes.io/component": "object-storage",
      "app.kubernetes.io/managed-by": "applik8s",
    };
    kubernetesPersistentVolumeClaim({
      id: "data",
      metadata: {
        name: `${spec.name}-data`,
        namespace: spec.namespace,
        labels,
      },
      spec: {
        accessModes: ["ReadWriteOnce"],
        resources: { requests: { storage: spec.storage.size } },
        ...(spec.storage.storageClassName
          ? { storageClassName: spec.storage.storageClassName }
          : {}),
      },
    });
    const workload = kubernetesDeployment({
      id: "workload",
      metadata: {
        name: spec.name,
        namespace: spec.namespace,
        labels,
      },
      spec: {
        replicas: 1,
        strategy: { type: "Recreate" },
        selector: { matchLabels: labels },
        template: {
          metadata: { labels },
          spec: {
            automountServiceAccountToken: false,
            terminationGracePeriodSeconds: 30,
            securityContext: {
              seccompProfile: { type: "RuntimeDefault" },
            },
            containers: [
              {
                name: "object-storage",
                image: spec.image,
                imagePullPolicy: "IfNotPresent",
                command: ["weed", "mini", "-dir=/data"],
                env: [
                  {
                    name: "AWS_ACCESS_KEY_ID",
                    valueFrom: {
                      secretKeyRef: {
                        name: spec.credentialsSecretName,
                        key: "AWS_ACCESS_KEY_ID",
                      },
                    },
                  },
                  {
                    name: "AWS_SECRET_ACCESS_KEY",
                    valueFrom: {
                      secretKeyRef: {
                        name: spec.credentialsSecretName,
                        key: "AWS_SECRET_ACCESS_KEY",
                      },
                    },
                  },
                  { name: "S3_BUCKET", value: spec.bucket },
                ],
                ports: [{ name: "s3", containerPort: 8333 }],
                readinessProbe: {
                  tcpSocket: { port: "s3" },
                  initialDelaySeconds: 2,
                  periodSeconds: 3,
                  timeoutSeconds: 2,
                  failureThreshold: 20,
                },
                livenessProbe: {
                  tcpSocket: { port: "s3" },
                  initialDelaySeconds: 15,
                  periodSeconds: 10,
                  timeoutSeconds: 2,
                  failureThreshold: 6,
                },
                resources: {
                  requests: { cpu: "100m", memory: "192Mi" },
                  limits: { cpu: "1", memory: "1Gi" },
                },
                securityContext: {
                  allowPrivilegeEscalation: false,
                  capabilities: { drop: ["ALL"] },
                },
                volumeMounts: [{ name: "data", mountPath: "/data" }],
              },
            ],
            volumes: [
              {
                name: "data",
                persistentVolumeClaim: { claimName: `${spec.name}-data` },
              },
            ],
          },
        },
      },
    });
    // Do not make the workload readiness-dependent on the claim. Storage
    // classes using WaitForFirstConsumer cannot bind this PVC until a Pod
    // referencing it has been scheduled, so serializing PVC readiness before
    // Deployment creation would deadlock the composition. Kubernetes itself
    // safely holds the Pod until the claim is bound.
    kubernetesService({
      id: "service",
      metadata: {
        name: spec.name,
        namespace: spec.namespace,
        labels,
      },
      spec: {
        type: "ClusterIP",
        selector: labels,
        ports: [{ name: "s3", port: 8333, targetPort: "s3" }],
      },
    });
    kubernetesNetworkPolicy({
      id: "networkPolicy",
      metadata: {
        name: `${spec.name}-client-access`,
        namespace: spec.namespace,
        labels,
      },
      spec: {
        podSelector: { matchLabels: labels },
        policyTypes: ["Ingress"],
        ingress: [
          {
            _from: [
              {
                namespaceSelector: {
                  matchLabels: {
                    "kubernetes.io/metadata.name": spec.namespace,
                  },
                },
              },
            ],
            ports: [{ protocol: "TCP", port: 8333 }],
          },
        ],
      },
    });
    return {
      ready: workload.status.readyReplicas >= workload.spec.replicas,
    };
  },
  );

const applicationClickStackClickHouseCluster = makeClickHouseCluster({
  users: [
    {
      name: "otelcollector",
      credentialSource: "secret",
    },
  ],
} as never);

const applicationClickStackClickHouseProvider =
  providerComposition<ClickHouseClusterSpec>(
    {
      name: "applik8s-clickstack-clickhouse",
      kind: "ApplicationClickStackClickHouse",
      spec: ClickStackClickHouseSpecSchema,
      status: type({ ready: "boolean", host: "string" }),
    },
    (spec) => {
      const installation = applicationClickStackClickHouseCluster(spec);
      return {
        ready: installation.status.ready,
        host: installation.status.clickhouse.host,
      };
    },
  );

function applicationClickStackProvider(
  build: Readonly<Record<string, unknown>>,
) {
  // The application deployment graph owns the workload Namespace as a
  // separate root lifecycle node. Keep ClickStack's child composition from
  // introducing a competing Namespace declaration/field owner by supplying
  // the runtime namespace. The graph edge still orders the provider after
  // that canonical owner; TypeKro owns its default only when this field is
  // omitted for standalone use.
  const clickstack = makeClickstackBootstrap(build as never);
  return providerComposition<ClickStackInstanceSpec>(
    {
      name: "applik8s-clickstack",
      kind: "ApplicationClickStack",
      spec: ClickStackInstanceSpecSchema,
      status: ClickStackStatusSchema,
    },
    (spec) => {
      const stack = clickstack({
        name: spec.name,
        namespace: spec.namespace,
        clickhouse: {
          host: spec.clickhouse.host,
          nativePort: spec.clickhouse.nativePort,
          httpPort: spec.clickhouse.httpPort,
          database: spec.clickhouse.database,
          username: spec.clickhouse.username,
        },
        credentialsSecret: spec.credentialsSecret,
      } as never);
      return {
        ready: stack.status.ready,
        otlpHttpEndpoint: stack.status.gateway.otlpHttpEndpoint,
        uiUrl: stack.status.ui.url,
      };
    },
  );
}

/**
 * Bind every graph-declared direct provider boundary to the matching pinned
 * TypeKro composition. Provider discovery and lifecycle ordering remain data
 * in the deployment graph; this is the sole TypeKro-specific registry.
 */
export function bindApplicationTypeKroDirectNodes(
  graph: ApplicationDeploymentGraph,
  factory?: PublicFactoryOptions,
): Readonly<Record<string, TypeKroCompositionBinding>> {
  const bindings: Record<string, TypeKroCompositionBinding> = {};
  for (const node of graph.nodes) {
    if (node.kind !== "kubernetesDirect") continue;
    const substitutions = artifactSubstitutionIndex(graph, node.id);
    const transformationContext = expressionContext({}, new Map(), graph);
    const sourceConfiguration = requiredConfiguration(node);
    const transformedConfiguration = transformMaterializedValue(
      sourceConfiguration,
      transformationContext,
      substitutions,
    );
    if (
      !transformedConfiguration ||
      typeof transformedConfiguration !== "object" ||
      Array.isArray(transformedConfiguration)
    ) {
      throw new Error(
        `TypeKro direct deployment node ${node.id} produced a non-object configuration after artifact binding.`,
      );
    }
    // typecast: recursive transformation preserves the configuration object
    // topology while replacing artifact-backed string leaves with TypeKro
    // planning expressions.
    const configuration = transformedConfiguration as DeploymentJsonObject;
    const options = {
      ...(factory ? { factory } : {}),
      instanceNameOverride: directInstanceName(node, sourceConfiguration),
      artifacts: typeKroArtifactRequirements(graph, node.id),
    };
    switch (node.spec.compositionId) {
      case "applik8s-namespace":
        bindings[node.id] = bindTypeKroComposition(
          applicationNamespaceProvider,
          configuration as never,
          options,
        );
        break;
      case "applik8s-unowned-namespace":
        bindings[node.id] = bindTypeKroComposition(
          applicationUnownedNamespaceProvider,
          configuration as never,
          options,
        );
        break;
      case "applik8s-custom-resource-definition":
        {
          const manifest = requiredObject(configuration, "manifest");
          if (
            manifest.apiVersion !== "apiextensions.k8s.io/v1"
            || manifest.kind !== "CustomResourceDefinition"
          ) {
            throw new Error(
              "TypeKro CustomResourceDefinition provider requires an apiextensions.k8s.io/v1 CustomResourceDefinition manifest.",
            );
          }
        bindings[node.id] = bindTypeKroComposition(
          applicationCustomResourceDefinitionProvider(manifest),
          { name: requiredString(configuration, "name") },
          options,
        );
        break;
        }
      case "valkey-bootstrap":
        bindings[node.id] = bindTypeKroComposition(
          valkeyBootstrap,
          // typecast: requiredConfiguration and the compiler contributor own
          // typecast: this concrete portable boundary; TypeKro validates it again.
          configuration as never,
          options,
        );
        break;
      case "applik8s-valkey-cluster-provider":
        bindings[node.id] = bindTypeKroComposition(
          applicationValkeyClusterProvider,
          // typecast: the pinned Valkey schema is the final validation authority.
          configuration as never,
          options,
        );
        break;
      case "applik8s-postgres-cluster-provider":
        bindings[node.id] = bindTypeKroComposition(
          applicationPostgresClusterProvider,
          // typecast: the pinned CNPG schema is the final validation authority.
          configuration as never,
          options,
        );
        break;
      case "nats-bootstrap":
        bindings[node.id] = bindTypeKroComposition(
          natsBootstrap,
          // typecast: the deployment compiler emits the complete validated
          // TypeKro NATS bootstrap contract at this pinned adapter boundary.
          configuration as never,
          options,
        );
        break;
      case 'searxng-bootstrap':
        bindings[node.id] = bindTypeKroComposition(
          searxngBootstrap,
          configuration as never,
          options,
        );
        break;
      case "hatchet-installation":
        bindings[node.id] = bindTypeKroComposition(
          hatchetInstallation,
          // typecast: the deployment compiler emits the released Hatchet
          // installation contract and TypeKro remains schema authority.
          configuration as never,
          options,
        );
        break;
      case "rook-object-storage-claim":
        bindings[node.id] = bindTypeKroComposition(
          rookObjectStorageClaim,
          // typecast: the pinned Rook OBC schema is the final validation authority.
          configuration as never,
          options,
        );
        break;
      case "applik8s-rook-ceph-operator":
        bindings[node.id] = bindTypeKroComposition(
          applicationRookCephOperatorProvider,
          // typecast: the compiler emits the complete maintained singleton
          // typecast: Rook operator contract and TypeKro remains schema authority.
          configuration as never,
          options,
        );
        break;
      case "applik8s-rook-ceph-external-operator-single-node-platform":
        bindings[node.id] = bindTypeKroComposition(
          applicationRookCephExternalOperatorSingleNodePlatformProvider,
          // typecast: the compiler emits the complete maintained one-node
          // typecast: external-operator platform contract.
          configuration as never,
          options,
        );
        break;
      case "applik8s-local-s3":
        bindings[node.id] = bindTypeKroComposition(
          applicationLocalS3Provider,
          // typecast: the deployment compiler emits and digests the complete
          // typecast: credential-reference-only local S3 configuration.
          configuration as never,
          options,
        );
        break;
      case "clickhouse-operator-bootstrap":
        bindings[node.id] = bindTypeKroComposition(
          clickhouseOperatorBootstrap,
          configuration as never,
          options,
        );
        break;
      case "applik8s-clickstack-clickhouse":
        bindings[node.id] = bindTypeKroComposition(
          applicationClickStackClickHouseProvider,
          configuration as never,
          options,
        );
        break;
      case "applik8s-clickstack": {
        const build = requiredObject(configuration, "build");
        const instance = requiredObject(configuration, "instance");
        bindings[node.id] = bindTypeKroComposition(
          applicationClickStackProvider(build),
          instance as never,
          options,
        );
        break;
      }
      case 'applik8s-celld-operator-bootstrap': {
        const controlNamespace = optionalString(configuration, 'namespace');
        const imageRequirementId = graph.edges.find(edge =>
          edge.to === node.id
          && edge.relationship === 'requiresOutput'
          && edge.output === 'immutableReference')?.from;
        if (!imageRequirementId) throw new Error(`Celld operator deployment node ${node.id} has no immutable operator artifact producer.`);
        bindings[node.id] = bindTypeKroComposition(
          makeCelldOperatorArtifactBootstrap(
            controlNamespace ? { namespace: controlNamespace } : {},
            imageRequirementId,
          ),
          withoutKey(withoutKey(withoutKey(configuration, 'namespace'), 'name'), 'image') as never,
          options,
        );
        break;
      }
      case "applik8s-celld-fleet-installation":
        {
        const imageRequirementId = graph.edges.find(edge =>
          edge.to === node.id
          && edge.relationship === 'requiresOutput'
          && edge.output === 'immutableReference')?.from;
        if (!imageRequirementId) throw new Error(`CelldFleet deployment node ${node.id} has no immutable runtime artifact producer.`);
        bindings[node.id] = bindTypeKroComposition(
          makeCelldFleetArtifactInstallation(requiredString(configuration, 'namespace'), imageRequirementId),
          withoutCelldArtifactImage(withoutKey(configuration, 'namespace')) as never,
          options,
        );
        break;
        }
      case "ory-identity-stack":
        bindings[node.id] = bindTypeKroComposition(
          oryIdentityStack,
          // typecast: the pinned Ory identity schema validates the filtered input.
          withoutKey(configuration, "managed") as never,
          options,
        );
        break;
      case "ory-platform-stack":
        bindings[node.id] = bindTypeKroComposition(
          oryPlatformStack,
          // typecast: the pinned Ory platform schema is the final validation authority.
          configuration as never,
          options,
        );
        break;
      case "opensearch-operator-bootstrap": {
        const version = optionalString(configuration, "version");
        const operator = makeOpenSearchOperatorBootstrap({
          name: requiredString(configuration, "name"),
          namespace: requiredString(configuration, "namespace"),
          ...(version ? { version } : {}),
        });
        bindings[node.id] = bindTypeKroComposition(
          operator,
          { name: requiredString(configuration, "name") },
          options,
        );
        break;
      }
      case "opensearch-cluster": {
        const build = requiredObject(configuration, "build");
        const instance = requiredObject(configuration, "instance");
        const cluster = makeOpenSearchCluster(build as never);
        bindings[node.id] = bindTypeKroComposition(
          cluster,
          instance as never,
          options,
        );
        break;
      }
      case "envoy-ai-gateway": {
        const build = requiredObject(configuration, "build");
        const instance = requiredObject(configuration, "instance");
        const gateway = makeEnvoyAIGateway(build as never);
        bindings[node.id] = bindTypeKroComposition(
          gateway,
          instance as never,
          options,
        );
        break;
      }
      default:
        throw new Error(
          `Deployment node ${node.id} requires unsupported TypeKro direct composition ${node.spec.compositionId}.`,
        );
    }
  }
  return bindings;
}

function requiredConfiguration(
  node: ApplicationKubernetesDirectDeploymentNode,
): DeploymentJsonObject {
  const value = node.spec.configuration;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `TypeKro direct deployment node ${node.id} has no concrete configuration.`,
    );
  }
  return value;
}

function directInstanceName(
  node: ApplicationKubernetesDirectDeploymentNode,
  configuration: DeploymentJsonObject,
): string {
  const value = configuration.name ?? optionalObjectValue(configuration.instance)?.name;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(
      `TypeKro direct deployment node ${node.id} requires a concrete configuration.name or configuration.instance.name.`,
    );
  }
  return value;
}

function withoutKey(
  value: DeploymentJsonObject,
  key: string,
): DeploymentJsonObject {
  return Object.fromEntries(
    Object.entries(value).filter(([candidate]) => candidate !== key),
  ) as DeploymentJsonObject;
}

function withoutCelldArtifactImage(value: DeploymentJsonObject): DeploymentJsonObject {
  const fleet = requiredObject(value, 'fleet');
  const artifact = requiredObject(fleet, 'artifact');
  return {
    ...value,
    fleet: {
      ...fleet,
      artifact: Object.fromEntries(Object.entries(artifact).filter(([key]) => key !== 'image')),
    },
  };
}

function optionalObjectValue(value: unknown): DeploymentJsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as DeploymentJsonObject
    : undefined;
}

function requiredObject(
  value: DeploymentJsonObject,
  key: string,
): DeploymentJsonObject {
  const candidate = value[key];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error(`TypeKro direct provider configuration.${key} must be an object.`);
  }
  // typecast-boundary: the object/array guard above restores the portable
  // deployment object branch from DeploymentJsonValue.
  return candidate as DeploymentJsonObject;
}

function requiredString(
  value: DeploymentJsonObject,
  key: string,
): string {
  const candidate = value[key];
  if (typeof candidate !== "string" || !candidate.trim()) {
    throw new Error(
      `TypeKro direct provider configuration.${key} must be a non-empty string.`,
    );
  }
  return candidate;
}

function optionalString(
  value: DeploymentJsonObject,
  key: string,
): string | undefined {
  const candidate = value[key];
  return typeof candidate === "string" && candidate.trim()
    ? candidate
    : undefined;
}
