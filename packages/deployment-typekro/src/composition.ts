// typecast-file-boundary: Compiler-owned portable manifests are recursively validated before conversion into TypeKro SDK-shaped resources.
import type {
  ApplicationDeploymentGraph,
  ApplicationKubernetesCompositionDeploymentNode,
  DeploymentJsonObject,
  DeploymentJsonValue,
} from "@applik8s/deployment-contract";
import {
  createResource,
  type Enhanced,
  getCurrentCompositionContext,
  type IncludeWhenCondition,
  type KroCompatibleType,
  type KubernetesResource,
  kubernetesComposition,
  type MagicAssignableShape,
  type ResourceGraphDefinition,
} from "typekro";
import { createSchemaProxy } from "typekro/advanced";
import { ciliumNetworkPolicy } from "typekro/cilium";
import { artifactOutput } from "typekro/experimental/planning";
import * as kubernetes from "typekro/kubernetes";
import type { TypeKroPlannableComposition } from "./binding.js";
import {
  type ExpressionContext,
  expressionContext,
} from "./expression-reconstruction.js";
import {
  type ArtifactSubstitutionIndex,
  artifactSubstitutionIndex,
  transformMaterializedValue,
} from "./materialized-values.js";
import {
  generatedResourceReadinessEvaluator,
  observedResourceReadinessEvaluator,
} from "./readiness.js";

const applicationTypeKroDefinitionProperty = "__applik8sTypeKroDefinition";

export interface ApplicationTypeKroCompositionSource<
  TSpec extends KroCompatibleType,
  TStatus extends KroCompatibleType,
> extends TypeKroPlannableComposition<TSpec> {
  readonly [applicationTypeKroDefinitionProperty]?: ResourceGraphDefinition<
    TSpec,
    TStatus
  >;
  /** Builder-style applications expose their lazily materialized composition here. */
  readonly composition?: ApplicationTypeKroCompositionSource<TSpec, TStatus>;
}

interface MaterializedGraphResource extends DeploymentJsonObject {
  readonly id: string;
  readonly role?: "containerRegistryPullSecret";
  readonly template?: DeploymentJsonObject;
  readonly externalRef?: DeploymentJsonObject;
  readonly includeWhen?: readonly DeploymentJsonValue[];
  readonly readyWhen?: readonly DeploymentJsonValue[];
  readonly forEach?: readonly DeploymentJsonValue[];
}

interface GeneratedSecretReference {
  readonly nodeId: string;
  readonly namespace: string;
  readonly name: string;
}

type MaterializedResourceProxy = Enhanced<object, object>;

/**
 * Reconstruct the compiler's final, generated RGD as one ordinary TypeKro
 * composition. The final RGD is authoritative here because it includes
 * compiler-injected runtimes and status projections absent from the authored
 * source composition.
 *
 * Serialized KRO expressions are translated back to TypeKro schema/resource
 * refs and CEL expressions. That keeps direct-mode evaluation and dependency
 * discovery equivalent instead of passing raw `${...}` strings through a
 * Kubernetes object.
 */
export function assembleApplicationTypeKroComposition<
  TSpec extends KroCompatibleType,
  TStatus extends KroCompatibleType,
>(
  graph: ApplicationDeploymentGraph,
  source: ApplicationTypeKroCompositionSource<TSpec, TStatus>,
): TypeKroPlannableComposition<TSpec> {
  const root = applicationRoot(graph);
  if (source.name !== root.spec.compositionId) {
    throw new Error(
      `Application source composition ${source.name} does not match deployment composition ${root.spec.compositionId}.`,
    );
  }
  const materializedSource = source.composition ?? source;
  const definition =
    materializedSource[applicationTypeKroDefinitionProperty] ??
    source[applicationTypeKroDefinitionProperty];
  if (!definition) {
    throw new Error(
      `Application composition ${source.name} does not expose its authored TypeKro definition. Recompile it with the matching Applik8s release.`,
    );
  }
  const materialized = root.spec.materialized;
  if (!materialized) {
    throw new Error(
      `Application deployment composition ${root.id} has no materialized compiler graph.`,
    );
  }
  const resources = materialized.resources.map((value, index) =>
    materializedResource(value, index),
  );
  const pullSecretResources = resources.filter(
    (resource) => resource.role === "containerRegistryPullSecret",
  );
  if (pullSecretResources.length > 1) {
    throw new Error(
      "Application deployment graph declares more than one container registry pull Secret input.",
    );
  }
  const pullSecretResource = pullSecretResources[0];
  const artifactSubstitutions = artifactSubstitutionIndex(graph, root.id);
  const remoteArtifactBinding = graph.nodes.some(
    (node) =>
      node.kind === "externalProvider" &&
      node.provider.interface === "ContainerRegistry",
  );
  const generatedSecrets = generatedSecretReferenceIndex(graph);
  const schema = createSchemaProxy<TSpec, TStatus>(
    definition.spec.json,
    definition.status.json,
  );
  return kubernetesComposition(
    definition,
    () => {
      const proxies = new Map<string, MaterializedResourceProxy>();
      for (const resource of resources) {
        if (resource.forEach && resource.forEach.length > 0) {
          throw new Error(
            `Materialized resource ${resource.id} uses forEach, which the Applik8s TypeKro 0.31 adapter does not yet reconstruct safely.`,
          );
        }
        const context = expressionContext(schema.spec, proxies, graph);
        let proxy: MaterializedResourceProxy;
        if (resource.template) {
          const pullSecret = pullSecretResource
            ? materializedPullSecretReference(proxies, pullSecretResource.id)
            : undefined;
          const desired = transformMaterializedValue(
            resource.template,
            context,
            artifactSubstitutions,
            {
              remoteArtifactBinding,
              pullSecretName: pullSecret?.name,
              pullSecretResourceVersion:
                graph.metadata.strategy === "kro"
                  ? pullSecret?.resourceVersion
                  : undefined,
            },
          );
          if (!isObject(desired)) {
            throw new Error(
              `Materialized resource ${resource.id} template did not produce an object.`,
            );
          }
          proxy = createMaterializedTemplate(resource.id, desired);
        } else if (resource.externalRef) {
          const observed = transformMaterializedValue(
            resource.externalRef,
            context,
            artifactSubstitutions,
          );
          if (!isObject(observed)) {
            throw new Error(
              `Materialized resource ${resource.id} externalRef did not produce an object.`,
            );
          }
          const apiVersion = requiredString(
            observed.apiVersion,
            `${resource.id}.externalRef.apiVersion`,
          );
          const kind = requiredString(
            observed.kind,
            `${resource.id}.externalRef.kind`,
          );
          const metadata = externalReferenceMetadata(
            resource.id,
            observed.metadata,
          );
          const generatedSecret =
            apiVersion === "v1" && kind === "Secret"
              ? generatedSecretReference(generatedSecrets, metadata)
              : undefined;
          // typecast: this is the same validated raw external-reference shape
          // used by TypeKro's externalRef(), with explicit provenance added for
          // GVKs such as Secret that have multiple registered factories. typecast:
          proxy = createResource(
            {
              apiVersion,
              kind,
              id: resource.id,
              metadata: generatedSecret
                ? {
                    name: artifactOutput(generatedSecret.nodeId, "name"),
                    namespace: artifactOutput(
                      generatedSecret.nodeId,
                      "namespace",
                    ),
                  }
                : metadata,
              spec: {},
              status: {},
              __externalRef: true,
            } as KubernetesResource<object, object>,
            {
              scope: kubernetesResourceScope(observed),
              ...(apiVersion === "v1" && kind === "Secret"
                ? { factoryName: "Secret" }
                : {}),
            },
          );
          getCurrentCompositionContext()?.addResource(resource.id, proxy);
        } else {
          throw new Error(
            `Materialized resource ${resource.id} must contain exactly one template or externalRef.`,
          );
        }
        proxies.set(resource.id, proxy);
        const resourceContext = expressionContext(schema.spec, proxies, graph);
        for (const condition of resource.includeWhen ?? []) {
          proxy.withIncludeWhen(
            conditionValue(
              condition,
              resourceContext,
              artifactSubstitutions,
              `${resource.id}.includeWhen`,
            ),
          );
        }
        for (const condition of resource.readyWhen ?? []) {
          proxy.withReadyWhen(
            conditionValue(
              condition,
              resourceContext,
              artifactSubstitutions,
              `${resource.id}.readyWhen`,
            ),
          );
        }
      }
      const status = transformMaterializedValue(
        materialized.status,
        expressionContext(schema.spec, proxies, graph, {
          preserveResourceCel: true,
        }),
        artifactSubstitutions,
      );
      if (!isObject(status)) {
        throw new Error(
          `Application composition ${source.name} materialized status must be an object.`,
        );
      }
      // typecast: the compiler's final RGD status was produced from this exact
      // authored schema and is revalidated by TypeKro's planning boundary. typecast:
      return status as MagicAssignableShape<TStatus>;
    },
  );
}

type RawKubernetesFactory = (
  resource: never,
) => MaterializedResourceProxy;

const rawKubernetesFactories = new Map<string, RawKubernetesFactory>([
  ["cilium.io/v2/CiliumNetworkPolicy", ciliumNetworkPolicy as RawKubernetesFactory],
  ["apps/v1/Deployment", kubernetes.deployment as RawKubernetesFactory],
  ["batch/v1/Job", kubernetes.job as RawKubernetesFactory],
  ["networking.k8s.io/v1/Ingress", kubernetes.ingress as RawKubernetesFactory],
  [
    "networking.k8s.io/v1/NetworkPolicy",
    kubernetes.networkPolicy as RawKubernetesFactory,
  ],
  [
    "policy/v1/PodDisruptionBudget",
    kubernetes.podDisruptionBudget as RawKubernetesFactory,
  ],
  [
    "rbac.authorization.k8s.io/v1/Role",
    kubernetes.role as RawKubernetesFactory,
  ],
  [
    "rbac.authorization.k8s.io/v1/RoleBinding",
    kubernetes.roleBinding as RawKubernetesFactory,
  ],
  ["v1/ConfigMap", kubernetes.configMap as RawKubernetesFactory],
  ["v1/Service", kubernetes.service as RawKubernetesFactory],
  ["v1/ServiceAccount", kubernetes.serviceAccount as RawKubernetesFactory],
]);

function createMaterializedTemplate(
  id: string,
  desired: DeploymentJsonObject,
): MaterializedResourceProxy {
  const apiVersion = requiredString(
    desired.apiVersion,
    `${id}.template.apiVersion`,
  );
  const kind = requiredString(desired.kind, `${id}.template.kind`);
  const factory = rawKubernetesFactories.get(`${apiVersion}/${kind}`);
  if (factory) {
    // typecast: TypeKro's Kubernetes factories accept complete client-node
    // manifests. The compiler's portable JSON manifest has already passed its
    // Kubernetes/TypeKro generation boundary; symbolic fields are intentionally
    // retained for TypeKro's planner rather than client-node's concrete types.
    const resource = factory({ ...desired, id } as never);
    const generatedReadiness = generatedResourceReadinessEvaluator(
      apiVersion,
      kind,
    );
    if (generatedReadiness) {
      resource.withReadinessEvaluator(generatedReadiness);
    }
    return resource;
  }
  // typecast: the recursive portable walker preserves a validated Kubernetes
  // JSON object while TypeKro requires mutable SDK-shaped fields. typecast:
  const resource = createResource(
    {
      ...desired,
      id,
    } as KubernetesResource<object, object>,
    {
      scope: kubernetesResourceScope(desired),
      ...(apiVersion === "v1" && kind === "Secret"
        ? { factoryName: "Secret" }
        : {}),
    },
  );
  resource.withReadinessEvaluator(
    generatedResourceReadinessEvaluator(apiVersion, kind) ??
      observedResourceReadinessEvaluator(),
  );
  return resource;
}

function applicationRoot(
  graph: ApplicationDeploymentGraph,
): ApplicationKubernetesCompositionDeploymentNode {
  const roots = graph.nodes.filter(
    (node): node is ApplicationKubernetesCompositionDeploymentNode =>
      node.kind === "kubernetesComposition",
  );
  if (roots.length !== 1 || !roots[0]) {
    throw new Error(
      `ApplicationDeploymentGraph must contain exactly one kubernetesComposition root; found ${roots.length}.`,
    );
  }
  return roots[0];
}

function materializedResource(
  value: DeploymentJsonObject,
  index: number,
): MaterializedGraphResource {
  const id = requiredString(value.id, `materialized resource ${index} id`);
  const template = isObject(value.template) ? value.template : undefined;
  const observed = isObject(value.externalRef) ? value.externalRef : undefined;
  if (Boolean(template) === Boolean(observed)) {
    throw new Error(
      `Materialized resource ${id} must contain exactly one template or externalRef.`,
    );
  }
  return {
    ...value,
    id,
    ...(template ? { template } : {}),
    ...(observed ? { externalRef: observed } : {}),
    ...(Array.isArray(value.includeWhen)
      ? { includeWhen: value.includeWhen }
      : {}),
    ...(Array.isArray(value.readyWhen)
      ? { readyWhen: value.readyWhen }
      : {}),
    ...(Array.isArray(value.forEach) ? { forEach: value.forEach } : {}),
  };
}

function generatedSecretReferenceIndex(
  graph: ApplicationDeploymentGraph,
): ReadonlyMap<string, GeneratedSecretReference> {
  const references = new Map<string, GeneratedSecretReference>();
  for (const node of graph.nodes) {
    if (
      node.kind !== "externalProvider" ||
      node.provider.interface !== "Secret" ||
      node.provider.implementation !==
        "alchemy-kubernetes-generated-secret" ||
      node.spec.resourceType !== "kubernetesGeneratedSecret" ||
      node.spec.referenceMode === "staticIdentity"
    ) {
      continue;
    }
    const configuration = node.spec.configuration;
    if (!isObject(configuration)) {
      throw new Error(
        `Generated Secret deployment node ${node.id} has no configuration.`,
      );
    }
    const namespace = requiredString(
      configuration.namespace,
      `${node.id}.configuration.namespace`,
    );
    const name = requiredString(
      configuration.name,
      `${node.id}.configuration.name`,
    );
    const key = `${namespace}\0${name}`;
    if (references.has(key)) {
      throw new Error(
        `Generated Secret deployment reference ${namespace}/${name} is duplicated.`,
      );
    }
    references.set(key, { nodeId: node.id, namespace, name });
  }
  return references;
}

function generatedSecretReference(
  references: ReadonlyMap<string, GeneratedSecretReference>,
  metadata: { readonly name: string; readonly namespace?: string },
): GeneratedSecretReference | undefined {
  if (
    typeof metadata.name !== "string" ||
    typeof metadata.namespace !== "string"
  ) {
    return undefined;
  }
  return references.get(`${metadata.namespace}\0${metadata.name}`);
}

function materializedPullSecretReference(
  resources: ReadonlyMap<string, MaterializedResourceProxy>,
  resourceId: string,
): { readonly name: unknown; readonly resourceVersion: unknown } {
  const secret = resources.get(resourceId);
  if (!secret) {
    throw new Error(
      `Container registry pull Secret input ${resourceId} must be materialized before application artifact workloads.`,
    );
  }
  const metadata = Reflect.get(secret, "metadata");
  if (!metadata || (typeof metadata !== "object" && typeof metadata !== "function")) {
    throw new Error(
      `Container registry pull Secret input ${resourceId} has no metadata reference.`,
    );
  }
  return {
    name: Reflect.get(metadata, "name"),
    resourceVersion: Reflect.get(metadata, "resourceVersion"),
  };
}

function conditionValue(
  value: DeploymentJsonValue,
  context: ExpressionContext,
  artifacts: ArtifactSubstitutionIndex,
  label: string,
): IncludeWhenCondition {
  const transformed = transformMaterializedValue(value, context, artifacts);
  if (typeof transformed === "boolean" || typeof transformed === "string") {
    return transformed;
  }
  if (
    transformed &&
    (typeof transformed === "object" || typeof transformed === "function")
  ) {
    // TypeKro's branded refs and CEL expressions are structurally valid
    // condition inputs but deliberately absent from the portable JSON types.
    // typecast: recover the TypeKro condition brand after portable JSON
    // expression reconstruction. typecast:
    return transformed as IncludeWhenCondition;
  }
  throw new Error(`${label} must resolve to a TypeKro boolean expression.`);
}

function externalReferenceMetadata(
  id: string,
  value: unknown,
): { readonly name: string; readonly namespace?: string } {
  if (!isObject(value)) {
    throw new Error(`${id}.externalRef.metadata must be an object.`);
  }
  const name = referenceString(value.name, `${id}.externalRef.metadata.name`);
  const namespace =
    value.namespace === undefined
      ? undefined
      : referenceString(
          value.namespace,
          `${id}.externalRef.metadata.namespace`,
        );
  return { name, ...(namespace === undefined ? {} : { namespace }) };
}

function referenceString(value: unknown, label: string): string {
  if (typeof value === "string") return value;
  if (value && (typeof value === "object" || typeof value === "function")) {
    // TypeKro's ExternalRefConfig accepts its branded RefOrValue<string>
    // even though its public declaration narrows the structural return here. typecast:
    return value as unknown as string;
  }
  throw new Error(`${label} must resolve to a string or TypeKro reference.`);
}

function kubernetesResourceScope(
  resource: Readonly<Record<string, unknown>>,
): "namespaced" | "cluster" {
  const kind = optionalString(resource.kind);
  return kind && clusterScopedKinds.has(kind) ? "cluster" : "namespaced";
}

const clusterScopedKinds = new Set([
  "APIService",
  "CertificateSigningRequest",
  "ClusterRole",
  "ClusterRoleBinding",
  "CSIDriver",
  "CSINode",
  "CustomResourceDefinition",
  "IngressClass",
  "MutatingWebhookConfiguration",
  "Namespace",
  "Node",
  "PersistentVolume",
  "PriorityClass",
  "ResourceGraphDefinition",
  "RuntimeClass",
  "StorageClass",
  "ValidatingAdmissionPolicy",
  "ValidatingAdmissionPolicyBinding",
  "ValidatingWebhookConfiguration",
  "VolumeAttachment",
]);

function requiredString(value: unknown, label: string): string {
  const text = optionalString(value);
  if (!text) throw new Error(`${label} must be a non-empty string.`);
  return text;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isObject(
  value: unknown,
): value is Record<string, DeploymentJsonValue> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
