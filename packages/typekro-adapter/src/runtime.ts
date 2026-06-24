import type {
  Applik8sTypeKroAdapterApi,
  TypeKroAdapterOptions,
  TypeKroEnhancedResourceFactory,
  TypeKroGraph,
  TypeKroGraphAdapter,
  TypeKroGraphAdapterOptions,
  TypeKroOperatorComposition,
  TypeKroOperatorInstallSpec,
  TypeKroOperatorInstallStatus,
  TypeKroOperationTarget,
  TypeKroOperationTargetSource,
  TypeKroOperationTargetSpec,
  TypeKroResourceDefinitionMap,
  TypeKroResourceInput,
} from './interfaces.js';
import { type as arktype } from 'arktype';
import { imageRefString } from '@applik8s/typetainer';
import { toKubernetesStructuralOpenApiSchema, validateStructuralOpenApiSchema } from '@applik8s/compiler';
import { createResource, kubernetesComposition } from 'typekro';
import type { AnyResourceDefinition, AnyResourceVersionDefinition, CapabilityClientSet, ConcurrencyConfig, DeleteTargetOptions, JsonObject, ObjectRef, OperatorDefinition, OperatorManifest, PartialStatus, PermissionRule, Result } from '@applik8s/core';
import type { CallableComposition, Enhanced, KubernetesResource, KroCompatibleType, PublicFactoryOptions, ResourceStatus } from 'typekro';
import type { Type } from 'arktype';

interface KubernetesLikeResource {
  readonly apiVersion: string;
  readonly kind: string;
  readonly metadata: { readonly name: string; readonly namespace?: string };
  readonly [key: string]: unknown;
}

interface TypeKroResourcePlanEntry {
  readonly id: string;
  readonly resource: KubernetesLikeResource;
  readonly deployable: Record<string, unknown>;
}

interface TypeKroDependencyGraphLike {
  getTopologicalOrder(): string[];
  getDependencies(id: string): string[];
}

interface KubernetesManifestResource<TSpec extends object = JsonObject, TStatus extends object = JsonObject> {
  readonly apiVersion: string;
  readonly kind: string;
  readonly metadata: { readonly name: string; readonly namespace?: string; readonly labels?: Record<string, string>; readonly annotations?: Record<string, string> };
  readonly spec?: TSpec;
  readonly status?: TStatus;
  readonly id?: string;
  readonly rules?: JsonObject[];
  readonly roleRef?: JsonObject;
  readonly subjects?: JsonObject[];
}

interface DeploymentStatusProjection {
  readonly availableReplicas: number;
  readonly readyReplicas: number;
}

interface DeploymentSpecProjection {
  readonly replicas: number;
}

const installSpecSchema = arktype({
  'namespace?': 'string',
  'replicas?': 'number',
  'config?': 'Record<string, unknown>',
});

const installStatusSchema = arktype({
  ready: 'boolean',
  phase: "'Pending' | 'Installing' | 'Ready' | 'Failed'",
  'message?': 'string',
  'observedBundleDigest?': 'string',
});

type CreateInstallComposition = (
  definition: {
    readonly name: string;
    readonly apiVersion: string;
    readonly group?: string;
    readonly kind: string;
    readonly spec: Type<TypeKroOperatorInstallSpec>;
    readonly status: Type<TypeKroOperatorInstallStatus>;
  },
  compositionFn: (spec: TypeKroOperatorInstallSpec) => TypeKroOperatorInstallStatus,
  options?: PublicFactoryOptions
) => CallableComposition<TypeKroOperatorInstallSpec, TypeKroOperatorInstallStatus>;

// typecast: this object wires generic adapter functions into the broad public TypeKro adapter API; individual functions retain their generic signatures below.
export const typeKroAdapter = {
  composition: asComposition,
  asComposition,
  graphAdapter: createGraphAdapter,
  typeKroAdapter: createGraphAdapter(),
  createGraphAdapter,
  operationTarget: toOperationTarget,
  toOperationTarget,
  targetFactory: asOperationTargetFactory,
  asOperationTargetFactory,
} as Applik8sTypeKroAdapterApi;

export const typeKro = typeKroAdapter;

export function asComposition<
  TCapabilities extends CapabilityClientSet = CapabilityClientSet,
  TResources extends TypeKroResourceDefinitionMap<TCapabilities> = TypeKroResourceDefinitionMap<TCapabilities>,
  TInstallSpec extends KroCompatibleType = TypeKroOperatorInstallSpec,
  TInstallStatus extends KroCompatibleType = TypeKroOperatorInstallStatus,
>(
  operator: OperatorDefinition<TCapabilities, TResources>,
  manifest: OperatorManifest,
  options: TypeKroAdapterOptions<TInstallSpec, TInstallStatus>
): Result<TypeKroOperatorComposition<TCapabilities, TResources, TInstallSpec, TInstallStatus>> {
  try {
    if (!manifest.spec.container) {
      return err('BUNDLE_INVALID', 'Operator manifest must include the compiler-derived runtime container recipe before TypeKro installation can be synthesized.');
    }

    // typecast: TypeKro install synthesis only needs erased resource metadata; public composition generics preserve the operator's exact resource map.
    const resources = Object.values(operator.resources) as unknown as readonly AnyResourceDefinition[];
    // typecast: factory construction uses the same erased runtime metadata while the returned composition is typed back to the exact resource map.
    const crdFactories = createCrdFactories(operator.resources as unknown as Readonly<Record<string, AnyResourceDefinition>>, options.defaultNamespace);
    // typecast: TypeKro's generic composition overload can instantiate too deeply through this public generic adapter boundary; the wrapper pins the stable install spec/status pair used at runtime.
    const createInstallComposition = kubernetesComposition as unknown as CreateInstallComposition;
    const composition = createInstallComposition(
      {
        name: options.compositionName,
        apiVersion: 'v1alpha1',
        group: 'applik8s.applik8s.dev',
        kind: pascalCase(options.compositionName),
        // typecast: adapter install schemas are intentionally generic but structurally match the stable install spec/status subset.
        spec: installSpecSchema as Type<TypeKroOperatorInstallSpec>,
        // typecast: adapter install schemas are intentionally generic but structurally match the stable install spec/status subset.
        status: installStatusSchema as Type<TypeKroOperatorInstallStatus>,
      },
      (installSpec: TypeKroOperatorInstallSpec) => {
        const namespace = installSpec.namespace ?? options.defaultNamespace ?? operator.deployment?.namespace ?? 'default';
        const replicas = installSpec.replicas ?? operator.deployment?.replicas ?? 1;
        const install = installResources(operator.name, operator.deployment, resources, manifest, namespace, replicas);
        const deploymentResource = install.find((resource) => resource.kind === 'Deployment');
        if (!deploymentResource) {
          throw new Error('Generated TypeKro install composition is missing the operator Deployment.');
        }
        for (const resource of install) {
          if (resource !== deploymentResource) {
            createInstallResource(resource);
          }
        }
        // typecast: TypeKro returns an enhanced resource proxy, but its generic factory type does not preserve deployment status projection.
        const operatorDeployment = createInstallResource(deploymentResource) as unknown as Enhanced<DeploymentSpecProjection, DeploymentStatusProjection>;
        return {
          ready: operatorDeployment.status.availableReplicas >= operatorDeployment.spec.replicas,
          phase: operatorDeployment.status.availableReplicas >= operatorDeployment.spec.replicas ? 'Ready' : 'Installing',
          observedBundleDigest: manifest.spec.bundle.digest,
        };
      },
      options.factoryOptions
    );

    // typecast: the callable wrapper reattaches TypeKro graph descriptors and applik8s CRD factory sugar while preserving the public generic composition shape.
    const adapted = ((spec: TInstallSpec) => {
      // typecast: public install specs may refine the generic adapter spec, but the runtime composition consumes the stable TypeKroOperatorInstallSpec subset.
      const instance = composition(spec as unknown as TypeKroOperatorInstallSpec);
      return Object.assign(instance, crdFactories, { crdFactories });
    }) as unknown as TypeKroOperatorComposition<TCapabilities, TResources, TInstallSpec, TInstallStatus>;
    copyDescriptors(composition, adapted);
    Object.assign(adapted, crdFactories, {
      operator,
      manifest,
      composition,
      graph: composition,
      crdFactories,
      factory: (mode: 'direct' | 'kro', factoryOptions?: PublicFactoryOptions) => composition.factory(mode, factoryOptions),
    });
    return ok(adapted);
  } catch (cause) {
    return err('BUNDLE_INVALID', cause instanceof Error ? cause.message : 'Failed to synthesize TypeKro operator composition.');
  }
}

export function createGraphAdapter<TGraphSpec extends KroCompatibleType = JsonObject, TGraphStatus extends KroCompatibleType = JsonObject, THandlerStatus extends object = TGraphStatus>(
  options?: TypeKroGraphAdapterOptions<TGraphStatus, THandlerStatus>
): TypeKroGraphAdapter<TGraphSpec, TGraphStatus, THandlerStatus> {
  return {
    render(graph, _spec) {
      const operations = resourcePlanEntriesForSource(graph).map(({ resource }) => ({
        // typecast: operation-plan discriminants must stay literal for the runtime contract union.
        kind: 'apply' as const,
        resource,
        ...(options?.fieldManager ? { fieldManager: options.fieldManager } : {}),
      }));
      return ok({ operations });
    },
    inferRbac(graph) {
      return ok(rbacForResources(resourcePlanEntriesForSource(graph).map((entry) => entry.resource)));
    },
    renderStatus(_graph, _spec) {
      if (options?.statusMapper) {
        // typecast: graph-like fixtures and nested TypeKro resources may expose a status projection; absent live state remains an empty partial status.
        return ok(options.statusMapper(statusProjectionForSource(_graph) as PartialStatus<TGraphStatus>));
      }
      // typecast: no mapper means no status projection is requested, so the partial handler status is empty.
      return ok({} as PartialStatus<THandlerStatus>);
    },
  };
}

export function toOperationTarget<TGraphSpec extends KroCompatibleType = JsonObject, TGraphStatus extends KroCompatibleType = JsonObject, THandlerStatus extends object = TGraphStatus>(
  source: TypeKroOperationTargetSource<TGraphSpec, TGraphStatus>,
  spec: TypeKroOperationTargetSpec<TGraphSpec>,
  options?: TypeKroGraphAdapterOptions<TGraphStatus, THandlerStatus>
): TypeKroOperationTarget<TGraphSpec, TGraphStatus, THandlerStatus> {
  const adapter = createGraphAdapter<TGraphSpec, TGraphStatus, THandlerStatus>(options);
  return {
    targetKind: 'operationTarget',
    source,
    spec,
    adapter: {
      renderApply(target, renderOptions) {
        // typecast: TypeKro operation targets store the original spec with the same generic TGraphSpec accepted by this adapter.
        const rendered = adapter.render(sourceAsGraph(target.source), target.spec as TGraphSpec);
        if (!rendered.ok) {
          return rendered;
        }
        const operations = rendered.value.operations.map((operation) => operation.kind === 'apply' && renderOptions
          ? {
              ...operation,
              ...(renderOptions.fieldManager ? { fieldManager: renderOptions.fieldManager } : {}),
              ...(renderOptions.force === undefined ? {} : { force: renderOptions.force }),
              ...(renderOptions.ownership
                ? { ownership: renderOptions.ownership }
                : renderOptions.owner
                  // typecast: the owner shorthand maps to the literal operation-plan ownership discriminant.
                  ? { ownership: { mode: 'reference' as const, ref: renderOptions.owner } }
                  : {}),
            }
          : operation);
        return ok({ operations });
      },
      renderDelete(target, renderOptions) {
        return ok({
          operations: deletionPlanEntriesForSource(target.source).map(({ resource }) => ({
            // typecast: operation-plan discriminants must stay literal for the runtime contract union.
            kind: 'delete' as const,
            ref: objectRefForResource(resource),
            ...deleteOperationOptions(renderOptions),
          })),
        });
      },
      inferRbac(target) {
        return adapter.inferRbac(sourceAsGraph(target.source));
      },
    },
  };
}

export function asOperationTargetFactory<TGraphSpec extends KroCompatibleType = JsonObject, TGraphStatus extends KroCompatibleType = JsonObject, THandlerStatus extends object = TGraphStatus>(
  graph: TypeKroGraph<TGraphSpec, TGraphStatus>,
  options?: TypeKroGraphAdapterOptions<TGraphStatus, THandlerStatus>
) {
  return (spec: TypeKroOperationTargetSpec<TGraphSpec>) => toOperationTarget(graph, spec, options);
}

function createCrdFactories(
  resources: Readonly<Record<string, AnyResourceDefinition>>,
  defaultNamespace?: string
) {
  const factories: Record<string, TypeKroEnhancedResourceFactory> = {};
  for (const [name, resource] of Object.entries(resources)) {
    factories[name] = typeKroResourceFactory(resource, defaultNamespace);
    factories[uncapitalize(name)] = factories[name];
  }
  // typecast: factory keys are generated from the exact operator resource map plus lower-camel aliases, matching TypeKroOperatorComposition's public resource ergonomics.
  return factories;
}

function createInstallResource(resource: KubernetesManifestResource): Enhanced<JsonObject, JsonObject> {
  // typecast: the adapter emits plain Kubernetes resources with supported top-level fields; TypeKro's KubernetesResource type is generated from client models and is stricter than this JSON manifest boundary.
  return withInstallReadiness(resource, createResource(resource as unknown as KubernetesResource<JsonObject, JsonObject>, { scope: resourceScope(resource) }));
}

function withInstallReadiness(resource: KubernetesManifestResource, enhanced: Enhanced<JsonObject, JsonObject>): Enhanced<JsonObject, JsonObject> {
  return enhanced.withReadinessEvaluator((live: unknown): ResourceStatus => {
    if (!live || typeof live !== 'object') {
      return { ready: false, reason: 'NotFound', message: `${resource.kind}/${resource.metadata.name} has not been observed.` };
    }
    if (resource.kind === 'Deployment') {
      const status = Reflect.get(live, 'status');
      const spec = Reflect.get(live, 'spec');
      const availableReplicas = isRecord(status) && typeof status.availableReplicas === 'number' ? status.availableReplicas : 0;
      const desiredReplicas = isRecord(spec) && typeof spec.replicas === 'number' ? spec.replicas : 1;
      return availableReplicas >= desiredReplicas
        ? { ready: true, reason: 'Available', message: `${resource.kind}/${resource.metadata.name} has ${availableReplicas}/${desiredReplicas} replicas available.` }
        : { ready: false, reason: 'Unavailable', message: `${resource.kind}/${resource.metadata.name} has ${availableReplicas}/${desiredReplicas} replicas available.` };
    }
    if (resource.kind === 'CustomResourceDefinition') {
      const status = Reflect.get(live, 'status');
      const conditions = isRecord(status) && Array.isArray(status.conditions) ? status.conditions : [];
      const established = conditions.some((condition) => isRecord(condition) && condition.type === 'Established' && condition.status === 'True');
      return established
        ? { ready: true, reason: 'Established', message: `${resource.kind}/${resource.metadata.name} is established.` }
        : { ready: false, reason: 'Establishing', message: `${resource.kind}/${resource.metadata.name} is not established yet.` };
    }
    return { ready: true, reason: 'Observed', message: `${resource.kind}/${resource.metadata.name} exists.` };
  });
}

function typeKroResourceFactory(resource: AnyResourceDefinition, defaultNamespace?: string): TypeKroEnhancedResourceFactory {
  return (input: TypeKroResourceInput) => {
    const namespace = input.namespace ?? defaultNamespace;
    return createResource({
      apiVersion: resource.apiVersion,
      kind: resource.kind,
      metadata: {
        name: input.name,
        ...(namespace ? { namespace } : {}),
        ...(input.labels ? { labels: input.labels } : {}),
        ...(input.annotations ? { annotations: input.annotations } : {}),
      },
      spec: input.spec,
      id: uncapitalize(resource.kind),
    }, { scope: resource.scope === 'Cluster' ? 'cluster' : 'namespaced' });
  };
}

function installResources(
  operatorName: string,
  deployment: OperatorDefinition['deployment'],
  resources: readonly AnyResourceDefinition[],
  manifest: OperatorManifest,
  namespace: string,
  replicas: number
): readonly KubernetesManifestResource[] {
  validateDeploymentOperationalSafety(operatorName, replicas, manifest);
  const serviceAccountName = deployment?.serviceAccountName ?? `${operatorName}-controller`;
  const clusterRbac = resources.some((resource) => resource.scope === 'Cluster');
  const image = manifest.spec.container ? imageRefString(manifest.spec.container.image) : undefined;
  if (!image) {
    throw new Error('Operator manifest is missing the compiler-derived runtime image.');
  }
  return [
    ...resources.map((resource, index) => crdDocument(resource, `ownedCrd${index + 1}`, manifest)),
    serviceAccountDocument(serviceAccountName, namespace, manifest),
    rbacRoleDocument(operatorName, manifest.spec.permissions, namespace, clusterRbac, manifest),
    rbacBindingDocument(operatorName, serviceAccountName, namespace, clusterRbac, manifest),
    deploymentDocument(manifest, serviceAccountName, image, namespace, replicas),
  ];
}

function validateDeploymentOperationalSafety(operatorName: string, replicas: number, manifest: OperatorManifest): void {
  const leaderElection = manifest.spec.runtime?.leaderElection;
  if (replicas > 1 && !leaderElection?.enabled) {
    throw new Error(`Operator ${operatorName} requested ${replicas} replicas, but multi-replica operators require runtime.leaderElection.enabled.`);
  }
  const unsupportedConcurrency = unsupportedRuntimeConcurrency(manifest.spec.runtime?.concurrency);
  if (unsupportedConcurrency) {
    throw new Error(unsupportedConcurrency);
  }
}

function unsupportedRuntimeConcurrency(concurrency: ConcurrencyConfig | undefined): string | undefined {
  if (!concurrency) {
    return undefined;
  }
  if (concurrency.workerCount !== 1) {
    return 'runtime.concurrency.workerCount greater than 1 is not supported until the operator host implements explicit worker concurrency semantics.';
  }
  if (concurrency.maxInFlightPerResource !== 1) {
    return 'runtime.concurrency.maxInFlightPerResource greater than 1 is not supported until the operator host implements per-resource concurrency control.';
  }
  if (concurrency.maxQueueDepth !== undefined) {
    return 'runtime.concurrency.maxQueueDepth is not supported until the operator host exposes trustworthy kube-runtime queue depth controls.';
  }
  return undefined;
}

function crdDocument(resource: AnyResourceDefinition, id: string, manifest: OperatorManifest): KubernetesManifestResource {
  const { group } = splitApiVersion(resource.apiVersion);
  return {
    apiVersion: 'apiextensions.k8s.io/v1',
    kind: 'CustomResourceDefinition',
    id,
    metadata: metadata(`${resource.plural}.${group}`, undefined, manifest),
    spec: {
      group,
      scope: resource.scope,
      names: {
        plural: resource.plural,
        singular: singularize(resource.plural),
        kind: resource.kind,
      },
      versions: resource.versions.map((version) => crdVersionDocument(resource, version)),
    },
  };
}

function crdVersionDocument(resource: AnyResourceDefinition, version: AnyResourceVersionDefinition): JsonObject {
  const specSchema = emitStructuralOpenApiSchema(version.spec, `${resource.kind}.${version.name}.spec`);
  const statusSchema = version.status
    ? emitStructuralOpenApiSchema(version.status, `${resource.kind}.${version.name}.status`)
    : undefined;
  return compactObject({
    name: version.name,
    served: version.served,
    storage: version.storage,
    schema: {
      openAPIV3Schema: {
        type: 'object',
        properties: compactObject({
          spec: specSchema,
          status: statusSchema,
        }),
        required: ['spec'],
      },
    },
    subresources: resource.statusSubresource ? { status: {} } : undefined,
    additionalPrinterColumns: resource.additionalPrinterColumns ? [...resource.additionalPrinterColumns] : undefined,
  });
}

function serviceAccountDocument(name: string, namespace: string, manifest: OperatorManifest): KubernetesManifestResource {
  return {
    apiVersion: 'v1',
    kind: 'ServiceAccount',
    id: 'operatorServiceAccount',
    metadata: metadata(name, namespace, manifest),
  };
}

function rbacRoleDocument(operatorName: string, permissions: readonly PermissionRule[], namespace: string, clusterRbac: boolean, manifest: OperatorManifest): KubernetesManifestResource {
  return {
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: clusterRbac ? 'ClusterRole' : 'Role',
    id: clusterRbac ? 'operatorClusterRole' : 'operatorRole',
    metadata: metadata(`${operatorName}-controller`, clusterRbac ? undefined : namespace, manifest),
    rules: permissions.map((permission) => compactObject({
      apiGroups: [...permission.apiGroups],
      resources: [...permission.resources],
      verbs: [...permission.verbs],
      resourceNames: permission.resourceNames ? [...permission.resourceNames] : undefined,
    })),
  };
}

function rbacBindingDocument(operatorName: string, serviceAccountName: string, namespace: string, clusterRbac: boolean, manifest: OperatorManifest): KubernetesManifestResource {
  return {
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: clusterRbac ? 'ClusterRoleBinding' : 'RoleBinding',
    id: clusterRbac ? 'operatorClusterRoleBinding' : 'operatorRoleBinding',
    metadata: metadata(`${operatorName}-controller`, clusterRbac ? undefined : namespace, manifest),
    roleRef: {
      apiGroup: 'rbac.authorization.k8s.io',
      kind: clusterRbac ? 'ClusterRole' : 'Role',
      name: `${operatorName}-controller`,
    },
    subjects: [compactObject({
      kind: 'ServiceAccount',
      name: serviceAccountName,
      namespace,
    })],
  };
}

function deploymentDocument(manifest: OperatorManifest, serviceAccountName: string, image: string, namespace: string, replicas: number): KubernetesManifestResource {
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    id: 'operatorDeployment',
    metadata: metadata(manifest.metadata.name, namespace, manifest),
    spec: {
      replicas,
      selector: { matchLabels: appLabels(manifest.metadata.name) },
      template: {
        metadata: { labels: appLabels(manifest.metadata.name), annotations: auditAnnotations(manifest) },
        spec: {
          serviceAccountName,
          containers: [
            {
              name: 'operator-host',
              image,
              imagePullPolicy: 'IfNotPresent',
              ports: [{ name: 'health', containerPort: 8080 }],
              env: operatorHostEnv(manifest),
              livenessProbe: {
                httpGet: { path: '/healthz', port: 'health' },
                initialDelaySeconds: 5,
                periodSeconds: 10,
              },
              readinessProbe: {
                httpGet: { path: '/readyz', port: 'health' },
                initialDelaySeconds: 1,
                periodSeconds: 5,
              },
            },
          ],
        },
      },
    },
  };
}

function operatorHostEnv(manifest: OperatorManifest): readonly JsonObject[] {
  const replayArtifacts = manifest.spec.runtime?.replayArtifacts;
  return [
    { name: 'APPLIK8S_OPERATOR_NAME', value: manifest.metadata.name },
    { name: 'APPLIK8S_MANIFEST_PATH', value: '/etc/applik8s/operator-manifest.json' },
    { name: 'APPLIK8S_HANDLER_PATH', value: '/handler/handler.wasm' },
    { name: 'APPLIK8S_HEALTH_ADDR', value: '0.0.0.0:8080' },
    { name: 'APPLIK8S_HANDLER_TIMEOUT_SECONDS', value: String(manifest.spec.runtime?.handlerTimeoutSeconds ?? 30) },
    { name: 'OTEL_SERVICE_NAME', value: manifest.metadata.name },
    { name: 'OTEL_RESOURCE_ATTRIBUTES', value: `service.namespace=applik8s,applik8s.operator=${manifest.metadata.name},applik8s.bundle_digest=${manifest.spec.bundle.digest}` },
    { name: 'OTEL_METRIC_EXPORT_INTERVAL', value: '30000' },
    ...(replayArtifacts?.enabled && replayArtifacts.directory ? [
      { name: 'APPLIK8S_REPLAY_ARTIFACT_DIR', value: replayArtifacts.directory },
      ...(replayArtifacts.includePayloads ? [{ name: 'APPLIK8S_REPLAY_INCLUDE_PAYLOADS', value: '1' }] : []),
    ] : []),
    { name: 'APPLIK8S_LEADER_ELECTION_IDENTITY', valueFrom: { fieldRef: { fieldPath: 'metadata.name' } } },
    { name: 'APPLIK8S_POD_NAMESPACE', valueFrom: { fieldRef: { fieldPath: 'metadata.namespace' } } },
  ];
}

function resourceScope(resource: KubernetesManifestResource): 'cluster' | 'namespaced' {
  return resource.metadata.namespace ? 'namespaced' : 'cluster';
}

function emitStructuralOpenApiSchema(schema: AnyResourceVersionDefinition['spec'], path: string): JsonObject {
  const result = schema.emitOpenApiSchema();
  if (!result.ok) {
    throw new Error(`CRD schema ${path} failed to emit OpenAPI schema: ${result.error.message}`);
  }
  const unsupported = result.value.diagnostics.find((diagnostic) => diagnostic.severity === 'warning' || diagnostic.severity === 'error');
  if (unsupported) {
    throw new Error(`CRD schema ${path} is not structurally supported: ${unsupported.message}`);
  }
  const diagnostics = validateStructuralOpenApiSchema(result.value.schema, path);
  if (diagnostics.length > 0) {
    throw new Error(diagnostics[0]?.message ?? `CRD schema ${path} is not structurally valid.`);
  }
  return toKubernetesStructuralOpenApiSchema(result.value.schema);
}

function metadata(name: string, namespace: string | undefined, manifest: OperatorManifest): { readonly name: string; readonly namespace?: string; readonly labels: Readonly<Record<string, string>>; readonly annotations: Readonly<Record<string, string>> } {
  return {
    name,
    ...(namespace ? { namespace } : {}),
    labels: appLabels(manifest.metadata.name),
    annotations: auditAnnotations(manifest),
  };
}

function auditAnnotations(manifest: OperatorManifest): Readonly<Record<string, string>> {
  const portability = manifest.spec.security.portability;
  const storageVersions = manifest.spec.ownedCrds.map((crd) => `${crd.apiVersion}/${crd.kind}=${crd.storageVersion}`);
  const conversionStrategies = manifest.spec.ownedCrds.map((crd) => `${crd.apiVersion}/${crd.kind}=${crd.conversionStrategy}`);
  return {
    'applik8s.dev/bundle-digest': manifest.spec.bundle.digest,
    'applik8s.dev/source-digest': manifest.spec.bundle.sourceDigest,
    'applik8s.dev/compiler-version': manifest.spec.bundle.compilerVersion,
    'applik8s.dev/handler-abi': manifest.spec.handlerAbi,
    'applik8s.dev/requires-runtime': manifest.spec.requiresRuntime,
    'applik8s.dev/handler-timeout-seconds': String(manifest.spec.runtime?.handlerTimeoutSeconds ?? 30),
    'applik8s.dev/crd-storage-versions': storageVersions.join(','),
    'applik8s.dev/crd-conversion-strategies': conversionStrategies.join(','),
    'applik8s.dev/crd-multi-version': manifest.spec.ownedCrds.some((crd) => crd.versioning.multiVersion !== 'singleVersion') ? 'unsupported' : 'singleVersion',
    'applik8s.dev/crd-storage-migration': manifest.spec.ownedCrds.some((crd) => crd.versioning.storageMigration !== 'notRequired') ? 'unsupported' : 'notRequired',
    'applik8s.dev/rollback-safety': manifest.spec.ownedCrds.every((crd) => crd.versioning.rollbackSafety === 'schemaCompatibleOnly') ? 'schemaCompatibleOnly' : 'unknown',
    'applik8s.dev/uninstall-controller-domain-data': manifest.spec.lifecycle.uninstallController.domainDataPolicy.destructive ? 'destructive' : 'preserve',
    'applik8s.dev/delete-domain-data-confirmation': manifest.spec.lifecycle.deleteDomainData.requiresExplicitConfirmation ? 'required' : 'notRequired',
    'applik8s.dev/supply-chain-signing': manifest.spec.bundle.supplyChain.posture?.signing ?? 'unknown',
    'applik8s.dev/supply-chain-sbom': manifest.spec.bundle.supplyChain.posture?.sbom ?? 'unknown',
    'applik8s.dev/supply-chain-provenance': manifest.spec.bundle.supplyChain.posture?.provenance ?? 'unknown',
    'applik8s.dev/admission-verification': manifest.spec.bundle.supplyChain.posture?.admission ?? 'unknown',
    'applik8s.dev/security-enforcement': portability.enforcement,
    'applik8s.dev/rbac-mode': manifest.spec.security.rbac.mode,
    'applik8s.dev/rbac-least-privilege-reviewed': String(manifest.spec.security.rbac.leastPrivilegeReviewed),
    'applik8s.dev/rbac-rule-count': String(manifest.spec.security.rbac.rules.length),
    'applik8s.dev/host-imports': manifest.spec.adapterRequirements?.hostImports?.join(',') ?? '',
    'applik8s.dev/capabilities': Object.keys(manifest.spec.capabilities ?? {}).join(','),
    'applik8s.dev/capability-kinds': [...new Set(Object.values(manifest.spec.capabilities ?? {}).map((descriptor) => descriptor.kind))].join(','),
    'applik8s.dev/capability-protocols': [...new Set(manifest.spec.security.capabilities.map((capability) => capability.execution.protocol))].join(','),
    'applik8s.dev/capability-live-execution': manifest.spec.security.capabilities.some((capability) => capability.execution.liveExecution !== 'disabled') ? 'enabled' : 'disabled',
    'applik8s.dev/capability-redaction': manifest.spec.security.capabilities.length > 0 ? 'payloads-redacted' : 'none',
    'applik8s.dev/capability-idempotency': manifest.spec.security.capabilities.some((capability) => capability.execution.idempotency.requiredForMutations) ? 'requiredForMutations' : 'none',
    'applik8s.dev/ambient-environment': portability.environmentAccess,
    'applik8s.dev/ambient-filesystem': portability.filesystemAccess,
    'applik8s.dev/ambient-network': portability.networkAccess,
    'applik8s.dev/embedded-secret-material': portability.embeddedSecretMaterial,
    'applik8s.dev/local-credential-paths': portability.localCredentialPaths,
    'applik8s.dev/unsupported-native-modules': portability.unsupportedNativeModules,
  };
}

function managedLabels(): Readonly<Record<string, string>> {
  return { 'app.kubernetes.io/managed-by': 'applik8s' };
}

function appLabels(name: string): Readonly<Record<string, string>> {
  return { ...managedLabels(), 'app.kubernetes.io/name': name };
}

function splitApiVersion(apiVersion: string): { readonly group: string; readonly version: string } {
  if (!apiVersion.includes('/')) {
    return { group: '', version: apiVersion };
  }
  const [group, version] = apiVersion.split('/');
  return { group: group ?? '', version: version ?? 'v1' };
}

function singularize(plural: string): string {
  if (plural.endsWith('ies')) {
    return `${plural.slice(0, -3)}y`;
  }
  if (plural.endsWith('s')) {
    return plural.slice(0, -1);
  }
  return plural;
}

function pascalCase(value: string): string {
  const words = value.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  const result = words.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join('');
  return result || 'Applik8sOperatorInstall';
}

function uncapitalize(value: string): string {
  return value.length === 0 ? value : `${value.charAt(0).toLowerCase()}${value.slice(1)}`;
}

function compactObject<T extends Record<string, unknown>>(value: T): JsonObject {
  const compacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) {
      compacted[key] = entry;
    }
  }
  // typecast: removing undefined fields preserves JSON object contents for Kubernetes manifest emission.
  return compacted as JsonObject;
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isDependencyGraphLike(value: unknown): value is TypeKroDependencyGraphLike {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof Reflect.get(value, 'getTopologicalOrder') === 'function' &&
      typeof Reflect.get(value, 'getDependencies') === 'function'
  );
}

function copyDescriptors(source: object, target: object): void {
  for (const key of [...Object.getOwnPropertyNames(source), ...Object.getOwnPropertySymbols(source)]) {
    if (key === 'length' || key === 'name' || key === 'prototype') {
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (descriptor) {
      Object.defineProperty(target, key, descriptor);
    }
  }
}

function sourceAsGraph<TGraphSpec extends KroCompatibleType, TGraphStatus extends KroCompatibleType>(source: TypeKroOperationTargetSource<TGraphSpec, TGraphStatus>): TypeKroGraph<TGraphSpec, TGraphStatus> {
  if ('__resources' in source) {
    // typecast: nested TypeKro composition resources expose __resources, which is sufficient for operation-plan rendering without requiring deployment factory methods.
    return { name: source.__compositionId, resources: source.__resources } as TypeKroGraph<TGraphSpec, TGraphStatus>;
  }
  return source;
}

function resourcePlanEntriesForSource(source: unknown): readonly TypeKroResourcePlanEntry[] {
  if (!source || typeof source !== 'object') {
    throw new Error('TypeKro source must be an object with resources.');
  }
  const resources = '__resources' in source ? Reflect.get(source, '__resources') : Reflect.get(source, 'resources');
  if (!Array.isArray(resources)) {
    throw new Error('TypeKro source must expose resources or __resources.');
  }
  return resources.map(resourcePlanEntry);
}

function statusProjectionForSource(source: unknown): JsonObject {
  if (!isRecord(source)) {
    return {};
  }
  const status = Reflect.get(source, 'status');
  return isJsonObject(status) ? compactObject(status) : {};
}

function deletionPlanEntriesForSource(source: unknown): readonly TypeKroResourcePlanEntry[] {
  const entries = resourcePlanEntriesForSource(source);
  const graph = dependencyGraphForSource(source);
  if (!graph) {
    return entries;
  }

  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const orderedIds = reverseTopologicalOrder(graph, entries.map((entry) => entry.id));
  const ordered = orderedIds.map((id) => byId.get(id)).filter((entry): entry is TypeKroResourcePlanEntry => Boolean(entry));
  return ordered.length === entries.length ? ordered : [...entries].reverse();
}

function dependencyGraphForSource(source: unknown): TypeKroDependencyGraphLike | undefined {
  if (!isRecord(source)) {
    return undefined;
  }
  const dependencyGraph = Reflect.get(source, 'dependencyGraph');
  return isDependencyGraphLike(dependencyGraph) ? dependencyGraph : undefined;
}

function reverseTopologicalOrder(graph: TypeKroDependencyGraphLike, ids: readonly string[]): readonly string[] {
  const order = graph.getTopologicalOrder().filter((id) => ids.includes(id));
  if (order.length !== ids.length) {
    return [...ids].reverse();
  }
  return [...order].reverse();
}

function resourcePlanEntry(input: unknown, index: number): TypeKroResourcePlanEntry {
  const source = isRecord(input) && isRecord(input.manifest) ? input.manifest : input;
  const resource = resourceToKubernetesObject(source);
  const id = resourceIdForEntry(input, resource, index);
  const deployable = isRecord(source) ? { ...source, id } : { ...resource, id };
  return { id, resource, deployable };
}

function resourceToKubernetesObject(resource: unknown): KubernetesLikeResource {
  const json = typeof resource === 'object' && resource !== null && typeof Reflect.get(resource, 'toJSON') === 'function'
    ? Reflect.get(resource, 'toJSON').call(resource)
    // typecast: JSON serialization erases TypeKro proxy wrappers into plain Kubernetes manifest data for operation-plan emission.
    : JSON.parse(JSON.stringify(resource)) as unknown;
  if (!isKubernetesLikeResource(json)) {
    throw new Error('TypeKro resource did not serialize to a Kubernetes object with apiVersion, kind, and metadata.name.');
  }
  return json;
}

function resourceIdForEntry(input: unknown, resource: KubernetesLikeResource, index: number): string {
  if (isRecord(input) && typeof input.id === 'string' && input.id.length > 0) {
    return input.id;
  }
  if (typeof resource.id === 'string' && resource.id.length > 0) {
    return resource.id;
  }
  const metadataAnnotations = Reflect.get(resource.metadata, 'annotations');
  const annotations = isRecord(metadataAnnotations) ? metadataAnnotations : undefined;
  const annotated = annotations?.['typekro.io/resource-id'];
  if (typeof annotated === 'string' && annotated.length > 0) {
    return annotated;
  }
  return `${resource.apiVersion}/${resource.kind}/${resource.metadata.namespace ?? '_'}/${resource.metadata.name}/${index}`;
}

function deleteOperationOptions(options: DeleteTargetOptions | undefined): object {
  if (!options?.propagationPolicy && options?.gracePeriodSeconds === undefined) {
    return {};
  }
  return {
    options: compactObject({
      propagationPolicy: options.propagationPolicy,
      gracePeriodSeconds: options.gracePeriodSeconds,
    }),
  };
}

function objectRefForResource(resource: KubernetesLikeResource): ObjectRef {
  return {
    apiVersion: resource.apiVersion,
    kind: resource.kind,
    name: resource.metadata.name,
    ...(resource.metadata.namespace ? { namespace: resource.metadata.namespace } : {}),
  };
}

function rbacForResources(resources: readonly KubernetesLikeResource[]): readonly PermissionRule[] {
  const rules = new Map<string, PermissionRule>();
  for (const resource of resources) {
    const apiGroup = resource.apiVersion.includes('/') ? resource.apiVersion.split('/')[0] ?? '' : '';
    const key = `${apiGroup}/${resource.kind}`;
    if (!rules.has(key)) {
      rules.set(key, { apiGroups: [apiGroup], resources: [pluralize(resource.kind)], verbs: ['get', 'create', 'update', 'patch', 'delete'] });
    }
  }
  return [...rules.values()];
}

function pluralize(kind: string): string {
  const lower = kind.toLowerCase();
  if (lower.endsWith('s')) {
    return `${lower}es`;
  }
  if (lower.endsWith('y')) {
    return `${lower.slice(0, -1)}ies`;
  }
  return `${lower}s`;
}

function isKubernetesLikeResource(value: unknown): value is KubernetesLikeResource {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof Reflect.get(value, 'apiVersion') === 'string' &&
      typeof Reflect.get(value, 'kind') === 'string' &&
      Reflect.get(value, 'metadata') &&
      typeof Reflect.get(Reflect.get(value, 'metadata'), 'name') === 'string'
  );
}

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function err<T = never>(code: 'BUNDLE_INVALID', message: string): Result<T> {
  return { ok: false, error: { code, message, severity: 'error', context: {}, recovery: { summary: message } } };
}
