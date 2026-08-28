// typecast-file-boundary: TypeKro Kubernetes factories carry upstream client types; manifests are validated by the public ArkType and CRD contracts before this adapter boundary.
import { type } from 'arktype';
import { kubernetesComposition, type ResourceStatus } from 'typekro';
import { registerPortableReadinessEvaluator } from 'typekro/advanced';
import { artifactOutput } from 'typekro/experimental/planning';
import {
  clusterRole,
  clusterRoleBinding,
  customResource,
  customResourceDefinition,
  deployment,
  namespace,
  podDisruptionBudget,
  serviceAccount,
} from 'typekro/kubernetes';
import {
  type CelldFleetSpec,
  CelldFleetSpecSchema,
  celldFleetApiVersion,
  celldFleetKind,
  celldFleetPlural,
  celldFleetSpecOpenApiSchema,
  celldFleetStatusOpenApiSchema,
} from './contracts.js';

export interface CelldOperatorBootstrapBuildOptions {
  /**
   * Existing namespace for the singleton control plane. When omitted, the
   * composition creates and owns `applik8s-celld-system`.
   */
  readonly namespace?: string;
}

/**
 * Monotonic structural contract revision for the served CelldFleet CRD.
 *
 * This is intentionally independent of the operator package version: a
 * controller-only release does not fabricate a schema migration, while a
 * schema transition remains directly observable by deployment and policy
 * tooling.
 */
export const celldFleetSchemaRevision = 'v1alpha1-1' as const;

export interface CelldOperatorBootstrapSpec {
  readonly image: string;
  readonly replicas: number;
}

interface CelldOperatorArtifactBootstrapSpec {
  readonly replicas: number;
}

export interface CelldFleetInstallationSpec {
  readonly name: string;
  readonly fleet: CelldFleetSpec;
}

const CelldOperatorBootstrapSpecSchema = type({
  image: /^[a-z0-9][a-z0-9._/-]*(?::[A-Za-z0-9._-]+)?@sha256:[a-f0-9]{64}$/,
  replicas: '1 <= number.integer <= 10',
});

const CelldOperatorArtifactBootstrapSpecSchema = type({
  replicas: '1 <= number.integer <= 10',
});

const CelldFleetNameSchema = type(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/)
  .and('string <= 43');

const CelldOperatorBootstrapStatusSchema = type({
  ready: 'boolean',
  namespace: 'string',
  version: 'string',
});

const CelldFleetInstallationSpecSchema = type({
  name: CelldFleetNameSchema,
  fleet: CelldFleetSpecSchema,
});

const CelldFleetInstallationStatusSchema = type({
  ready: 'boolean',
  'phase?': 'string',
  'endpoint?': 'string',
  'observedWorkerVersion?': 'string',
  'observedCelldVersion?': 'string',
});

interface CelldFleetObservedResource {
  readonly metadata?: { readonly generation?: unknown };
  readonly status?: {
    readonly phase?: unknown;
    readonly observedGeneration?: unknown;
    readonly endpoint?: unknown;
    readonly conditions?: readonly {
      readonly type?: unknown;
      readonly status?: unknown;
      readonly reason?: unknown;
      readonly message?: unknown;
      readonly observedGeneration?: unknown;
    }[];
  };
}

const celldFleetReadinessEvaluator = registerPortableReadinessEvaluator(
  'applik8s.readiness.celld-fleet',
  '1',
  (resource: CelldFleetObservedResource): ResourceStatus => {
    const conditions = Array.isArray(resource.status?.conditions)
      ? resource.status.conditions
      : [];
    const readyCondition = conditions.find((condition) => condition.type === 'Ready');
    const generation = finiteNumber(resource.metadata?.generation);
    const observedGeneration = finiteNumber(resource.status?.observedGeneration)
      ?? finiteNumber(readyCondition?.observedGeneration);
    const generationCurrent = generation === undefined
      || (observedGeneration !== undefined && observedGeneration >= generation);
    const endpointObserved = typeof resource.status?.endpoint === 'string'
      && resource.status.endpoint.length > 0;
    const ready = generationCurrent
      && resource.status?.phase === 'Ready'
      && readyCondition?.status === 'True'
      && endpointObserved;
    return {
      ready,
      reason: typeof readyCondition?.reason === 'string'
        ? readyCondition.reason
        : generationCurrent
          ? 'FleetNotReady'
          : 'ObservedGenerationStale',
      message: typeof readyCondition?.message === 'string' && readyCondition.message
        ? readyCondition.message
        : ready
          ? 'The CelldFleet is ready and has published its service endpoint.'
          : 'The CelldFleet has not published current-generation ready status and an endpoint.',
    };
  },
);

export function makeCelldOperatorBootstrap(options: CelldOperatorBootstrapBuildOptions = {}) {
  return celldOperatorBootstrapComposition<CelldOperatorBootstrapSpec>(
    options,
    CelldOperatorBootstrapSpecSchema,
    (spec) => spec.image,
  );
}

/** Deployment-compiler bridge for the immutable operator image artifact. */
export function makeCelldOperatorArtifactBootstrap(
  options: CelldOperatorBootstrapBuildOptions,
  imageRequirementId: string,
) {
  if (!imageRequirementId.trim()) {
    throw new Error('makeCelldOperatorArtifactBootstrap(options, requirement) requires an artifact requirement identity.');
  }
  return celldOperatorBootstrapComposition<CelldOperatorArtifactBootstrapSpec>(
    options,
    CelldOperatorArtifactBootstrapSpecSchema,
    () => artifactOutput(imageRequirementId, 'immutableReference'),
  );
}

function celldOperatorBootstrapComposition<TSpec extends CelldOperatorBootstrapSpec | CelldOperatorArtifactBootstrapSpec>(
  options: CelldOperatorBootstrapBuildOptions,
  specSchema: typeof CelldOperatorBootstrapSpecSchema | typeof CelldOperatorArtifactBootstrapSpecSchema,
  image: (spec: TSpec) => string,
) {
  const controlNamespace = options.namespace ?? 'applik8s-celld-system';
  const ownsNamespace = options.namespace === undefined;
  return kubernetesComposition<TSpec, typeof CelldOperatorBootstrapStatusSchema.infer>({
    name: 'applik8s-celld-operator-bootstrap',
    apiVersion: 'celld.applik8s.io/v1alpha1',
    kind: 'CelldOperatorBootstrap',
    spec: specSchema as never,
    status: CelldOperatorBootstrapStatusSchema,
  }, (spec) => {
    const serviceAccountName = 'applik8s-celld-operator';
    const clusterRoleName = 'applik8s-celld-operator';
    if (ownsNamespace) namespace({ id: 'operatorNamespace', metadata: { name: controlNamespace } });
    serviceAccount({ id: 'operatorServiceAccount', metadata: { name: serviceAccountName, namespace: controlNamespace } });
    customResourceDefinition({ id: 'celldFleetCrd', ...celldFleetCustomResourceDefinitionManifest() } as never);
    clusterRole({
      id: 'operatorClusterRole',
      metadata: { name: clusterRoleName },
      rules: [
        { apiGroups: ['celld.applik8s.io'], resources: ['celldfleets'], verbs: ['get', 'list', 'watch', 'patch'] },
        { apiGroups: ['celld.applik8s.io'], resources: ['celldfleets/status'], verbs: ['get', 'patch', 'update'] },
        { apiGroups: ['celld.applik8s.io'], resources: ['celldfleets/finalizers'], verbs: ['update'] },
        { apiGroups: [''], resources: ['pods'], verbs: ['get', 'list', 'watch', 'delete'] },
        { apiGroups: [''], resources: ['pods/proxy'], verbs: ['get'] },
        { apiGroups: [''], resources: ['secrets'], verbs: ['get'] },
        { apiGroups: [''], resources: ['services', 'serviceaccounts'], verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'] },
        { apiGroups: [''], resources: ['services/proxy'], verbs: ['get', 'create'] },
        { apiGroups: ['apps'], resources: ['statefulsets'], verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'] },
        { apiGroups: ['batch'], resources: ['jobs'], verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'] },
        { apiGroups: ['networking.k8s.io'], resources: ['networkpolicies'], verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'] },
        { apiGroups: ['policy'], resources: ['poddisruptionbudgets'], verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'] },
        { apiGroups: ['coordination.k8s.io'], resources: ['leases'], verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'] },
        { apiGroups: [''], resources: ['events'], verbs: ['create', 'patch'] },
      ],
    });
    clusterRoleBinding({
      id: 'operatorClusterRoleBinding',
      metadata: { name: 'applik8s-celld-operator' },
      roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'ClusterRole', name: clusterRoleName },
      subjects: [{ kind: 'ServiceAccount', name: serviceAccountName, namespace: controlNamespace }],
    });
    const workload = deployment({
      id: 'operatorDeployment',
      metadata: { name: 'applik8s-celld-operator', namespace: controlNamespace, labels: operatorLabels() },
      spec: {
        replicas: spec.replicas,
        strategy: {
          type: 'RollingUpdate',
          // Controllers are cluster-shared. Keep every established leader/follower
          // available until a replacement proves healthy, while permitting a full
          // replacement set to start when an older pre-release image is unhealthy.
          rollingUpdate: { maxSurge: '100%', maxUnavailable: 0 },
        },
        minReadySeconds: 5,
        progressDeadlineSeconds: 300,
        selector: { matchLabels: operatorLabels() },
        template: {
          metadata: { labels: operatorLabels() },
          spec: {
            serviceAccountName,
            terminationGracePeriodSeconds: 30,
            securityContext: { runAsNonRoot: true, seccompProfile: { type: 'RuntimeDefault' } },
            containers: [{
              name: 'operator', image: image(spec), imagePullPolicy: 'IfNotPresent',
              ports: [{ name: 'health', containerPort: 8081 }],
              env: [
                { name: 'APPLIK8S_OPERATOR_NAME', value: 'applik8s-celld-operator' },
                { name: 'APPLIK8S_HEALTH_ADDR', value: '0.0.0.0:8081' },
                { name: 'APPLIK8S_LEADER_ELECTION_IDENTITY', valueFrom: { fieldRef: { fieldPath: 'metadata.name' } } },
                { name: 'APPLIK8S_POD_NAMESPACE', valueFrom: { fieldRef: { fieldPath: 'metadata.namespace' } } },
              ],
              readinessProbe: { httpGet: { path: '/healthz', port: 'health' }, periodSeconds: 5, failureThreshold: 12 },
              livenessProbe: { httpGet: { path: '/healthz', port: 'health' }, periodSeconds: 10, failureThreshold: 6 },
              securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ['ALL'] } },
              resources: { requests: { cpu: '50m', memory: '128Mi' }, limits: { cpu: '1', memory: '512Mi' } },
            }],
          },
        },
      },
    });
    podDisruptionBudget({
      id: 'operatorPodDisruptionBudget',
      metadata: { name: 'applik8s-celld-operator', namespace: controlNamespace, labels: operatorLabels() },
      spec: { maxUnavailable: 1, selector: { matchLabels: operatorLabels() } },
    });
    return { ready: workload.status.readyReplicas >= spec.replicas, namespace: controlNamespace, version: image(spec) };
  });
}

export const celldOperatorBootstrap = makeCelldOperatorBootstrap();

export function makeCelldFleetInstallation(namespaceName: string) {
  if (!namespaceName.trim()) throw new Error('makeCelldFleetInstallation(namespace) requires an existing workload namespace.');
  return kubernetesComposition<CelldFleetInstallationSpec, typeof CelldFleetInstallationStatusSchema.infer>({
    name: 'applik8s-celld-fleet-installation',
    apiVersion: 'celld.applik8s.io/v1alpha1',
    kind: 'CelldFleetInstallation',
    spec: CelldFleetInstallationSpecSchema,
    status: CelldFleetInstallationStatusSchema,
  }, (spec) => {
    // The enclosing installation schema is the authoring-time authority.
    // TypeKro's generic customResource validator cannot re-run a structured
    // ArkType schema against graph proxies, so this inner resource accepts the
    // already-validated object and the installed CRD enforces the same shape
    // at the Kubernetes boundary.
    const fleet = customResource<object, {
      readonly phase?: string;
      readonly endpoint?: string;
      readonly observedWorkerVersion?: string;
      readonly observedCelldVersion?: string;
    }>({ apiVersion: celldFleetApiVersion, kind: celldFleetKind, spec: type('object') }, {
      id: 'celldFleet', metadata: { name: spec.name, namespace: namespaceName }, spec: spec.fleet,
    }).withReadinessEvaluator(celldFleetReadinessEvaluator);
    return {
      ready: fleet.status.phase === 'Ready',
      phase: fleet.status.phase,
      endpoint: fleet.status.endpoint,
      observedWorkerVersion: fleet.status.observedWorkerVersion,
      observedCelldVersion: fleet.status.observedCelldVersion,
    };
  });
}

/**
 * Deployment-compiler bridge for an OCI image produced by a TypeKro artifact
 * requirement. Application authors normally use makeCelldFleetInstallation;
 * this form keeps the unresolved artifact Output inside TypeKro planning.
 */
export function makeCelldFleetArtifactInstallation(namespaceName: string, imageRequirementId: string) {
  if (!namespaceName.trim()) throw new Error('makeCelldFleetArtifactInstallation(namespace, requirement) requires an existing workload namespace.');
  if (!imageRequirementId.trim()) throw new Error('makeCelldFleetArtifactInstallation(namespace, requirement) requires an artifact requirement identity.');
  return kubernetesComposition<{ readonly name: string; readonly fleet: object }, typeof CelldFleetInstallationStatusSchema.infer>({
    name: 'applik8s-celld-fleet-installation',
    apiVersion: 'celld.applik8s.io/v1alpha1',
    kind: 'CelldFleetInstallation',
    spec: type({ name: CelldFleetNameSchema, fleet: 'object' }),
    status: CelldFleetInstallationStatusSchema,
  }, (spec) => {
    // typecast: the deployment compiler produced this object from the same
    // CelldFleet schema before replacing only artifact.image with an Output.
    const fleetSpec = spec.fleet as CelldFleetSpec;
    const fleet = customResource<object, {
      readonly phase?: string;
      readonly endpoint?: string;
      readonly observedWorkerVersion?: string;
      readonly observedCelldVersion?: string;
    }>({ apiVersion: celldFleetApiVersion, kind: celldFleetKind, spec: type('object') }, {
      id: 'celldFleet',
      metadata: { name: spec.name, namespace: namespaceName },
      spec: {
        artifact: {
          image: artifactOutput(imageRequirementId, 'immutableReference'),
          manifestDigest: fleetSpec.artifact.manifestDigest,
          workerVersion: fleetSpec.artifact.workerVersion,
          celldVersion: fleetSpec.artifact.celldVersion,
        },
        replicas: fleetSpec.replicas,
        ...(fleetSpec.placement ? { placement: fleetSpec.placement } : {}),
        objectStore: fleetSpec.objectStore,
        runtimeSecretRef: fleetSpec.runtimeSecretRef,
        applicationEndpoint: fleetSpec.applicationEndpoint,
        ...(fleetSpec.ingressNamespaces ? { ingressNamespaces: fleetSpec.ingressNamespaces } : {}),
        rollout: fleetSpec.rollout,
        deletion: fleetSpec.deletion,
      },
    }).withReadinessEvaluator(celldFleetReadinessEvaluator);
    return {
      ready: fleet.status.phase === 'Ready',
      phase: fleet.status.phase,
      endpoint: fleet.status.endpoint,
      observedWorkerVersion: fleet.status.observedWorkerVersion,
      observedCelldVersion: fleet.status.observedCelldVersion,
    };
  });
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function celldFleetCustomResourceDefinitionManifest() {
  return {
    apiVersion: 'apiextensions.k8s.io/v1',
    kind: 'CustomResourceDefinition',
    metadata: {
      name: `${celldFleetPlural}.celld.applik8s.io`,
      annotations: { 'celld.applik8s.io/schema-revision': celldFleetSchemaRevision },
    },
    spec: {
      group: 'celld.applik8s.io', scope: 'Namespaced', names: { kind: celldFleetKind, plural: celldFleetPlural, singular: 'celldfleet', shortNames: ['cflt'] },
      versions: [{
        name: 'v1alpha1', served: true, storage: true,
        subresources: { status: {} },
        additionalPrinterColumns: [
          { name: 'Phase', type: 'string', jsonPath: '.status.phase' },
          { name: 'Ready', type: 'integer', jsonPath: '.status.readyReplicas' },
          { name: 'Worker', type: 'string', jsonPath: '.status.observedWorkerVersion' },
        ],
        schema: { openAPIV3Schema: celldFleetOpenApiSchema() },
      }],
    },
  } as const;
}

function celldFleetOpenApiSchema() {
  return {
    type: 'object', required: ['spec'], properties: {
      spec: celldFleetKubernetesSpecOpenApiSchema(),
      status: celldFleetStatusOpenApiSchema,
    },
  } as const;
}

function celldFleetKubernetesSpecOpenApiSchema() {
  const objectStore = celldFleetSpecOpenApiSchema.properties.objectStore;
  const credentials = objectStore.properties.credentials;
  const { xKubernetesValidations, ...structuralCredentials } = credentials;
  return {
    ...celldFleetSpecOpenApiSchema,
    properties: {
      ...celldFleetSpecOpenApiSchema.properties,
      objectStore: {
        ...objectStore,
        properties: {
          ...objectStore.properties,
          credentials: {
            ...structuralCredentials,
            'x-kubernetes-validations': xKubernetesValidations,
          },
        },
      },
    },
  } as const;
}

function operatorLabels() {
  return { 'app.kubernetes.io/name': 'applik8s-celld-operator', 'app.kubernetes.io/component': 'controller', 'app.kubernetes.io/managed-by': 'typekro' };
}
