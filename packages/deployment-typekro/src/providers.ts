// typecast-file-boundary: Portable provider configuration is discriminator-checked before binding to pinned TypeKro factory schemas.
import type {
  ApplicationDeploymentGraph,
  ApplicationKubernetesDirectDeploymentNode,
  DeploymentJsonObject,
} from "@applik8s/deployment-contract";
import { type } from "arktype";
import {
  kubernetesComposition,
  type PublicFactoryOptions,
} from "typekro";
import { cluster, ClusterConfigSchema } from "typekro/cnpg";
import { oryIdentityStack, oryPlatformStack } from "typekro/ory";
import { rookObjectStorageClaim } from "typekro/rook";
import {
  valkey,
  valkeyBootstrap,
  ValkeyConfigSchema,
} from "typekro/valkey";
import { namespace as kubernetesNamespace } from "typekro/kubernetes";
import { bindTypeKroComposition } from "./binding.js";
import type { TypeKroCompositionBinding } from "./types.js";

const DirectReadyStatusSchema = type({ ready: "boolean" });
const DirectPostgresStatusSchema = type({
  "phase?": "string",
  "readyInstances?": "number.integer >= 0",
});
const DirectNamespaceSpecSchema = type({ name: "string" });

const applicationNamespaceProvider = kubernetesComposition(
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

const applicationValkeyClusterProvider = kubernetesComposition(
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
      spec: spec.spec,
    });
    return { ready: resource.status.ready };
  },
);

const applicationPostgresClusterProvider = kubernetesComposition(
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
      spec: spec.spec,
    });
    return {
      phase: resource.status.phase,
      readyInstances: resource.status.readyInstances,
    };
  },
);

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
    const configuration = requiredConfiguration(node);
    const options = {
      ...(factory ? { factory } : {}),
      instanceNameOverride: directInstanceName(node, configuration),
    };
    switch (node.spec.compositionId) {
      case "applik8s-namespace":
        bindings[node.id] = bindTypeKroComposition(
          applicationNamespaceProvider,
          configuration as never,
          options,
        );
        break;
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
      case "rook-object-storage-claim":
        bindings[node.id] = bindTypeKroComposition(
          rookObjectStorageClaim,
          // typecast: the pinned Rook OBC schema is the final validation authority.
          configuration as never,
          options,
        );
        break;
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
  const value = configuration.name;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(
      `TypeKro direct deployment node ${node.id} requires a concrete configuration.name.`,
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
