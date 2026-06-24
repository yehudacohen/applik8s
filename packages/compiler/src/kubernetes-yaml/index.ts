import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { V1CustomResourceColumnDefinition } from '@kubernetes/client-node/dist/gen/models/V1CustomResourceColumnDefinition.js';
import type { V1CustomResourceDefinition } from '@kubernetes/client-node/dist/gen/models/V1CustomResourceDefinition.js';
import type { V1Deployment } from '@kubernetes/client-node/dist/gen/models/V1Deployment.js';
import type { V1JSONSchemaProps } from '@kubernetes/client-node/dist/gen/models/V1JSONSchemaProps.js';
import type { V1ObjectMeta } from '@kubernetes/client-node/dist/gen/models/V1ObjectMeta.js';
import type { V1PolicyRule } from '@kubernetes/client-node/dist/gen/models/V1PolicyRule.js';
import type { V1Role } from '@kubernetes/client-node/dist/gen/models/V1Role.js';
import type { V1RoleBinding } from '@kubernetes/client-node/dist/gen/models/V1RoleBinding.js';
import type { V1ServiceAccount } from '@kubernetes/client-node/dist/gen/models/V1ServiceAccount.js';
import { stringify } from 'yaml';
import { imageRefString } from '@applik8s/typetainer';

import type { AnyResourceDefinition, AnyResourceVersionDefinition, ConcurrencyConfig, Diagnostic, JsonObject, OperatorDefinition, OperatorManifest, PermissionRule, Result, StatusConvention } from '@applik8s/core';
import { toKubernetesStructuralOpenApiSchema, validateStructuralOpenApiSchema } from '../kubernetes-schema/index.js';

export interface KubernetesYamlRequest {
  readonly manifest: OperatorManifest;
  readonly operator: OperatorDefinition;
  readonly outDir: string;
}

export interface KubernetesYamlResult {
  readonly paths: readonly string[];
}

export interface KubernetesYamlEmitter {
  emit(request: KubernetesYamlRequest): Promise<Result<KubernetesYamlResult>>;
}

export async function emitOperatorKubernetesYaml(request: KubernetesYamlRequest): Promise<Result<KubernetesYamlResult>> {
  try {
    await mkdir(request.outDir, { recursive: true });

    const namespace = request.operator.deployment?.namespace;
    const serviceAccountName = request.operator.deployment?.serviceAccountName ?? `${request.operator.name}-controller`;
    const image = request.manifest.spec.container ? imageRefString(request.manifest.spec.container.image) : 'ghcr.io/applik8s/applik8s-operator-host:dev';
    const resources = Object.values(request.operator.resources);
    const clusterRbac = requiresClusterRbac(resources);
    if (clusterRbac && !namespace) {
      throw new Error('Operators that own cluster-scoped resources must set deployment.namespace so ClusterRoleBinding can reference the ServiceAccount namespace.');
    }
    validateDeploymentOperationalSafety(request.operator, request.manifest);
    const documents = [
      ...resources.map((resource) => crdDocument(resource, request.manifest)),
      serviceAccountDocument(serviceAccountName, namespace, request.manifest),
      rbacRoleDocument(request.operator.name, request.manifest.spec.permissions, namespace, clusterRbac, request.manifest),
      rbacBindingDocument(request.operator.name, serviceAccountName, namespace, clusterRbac, request.manifest),
      deploymentDocument(request.manifest, serviceAccountName, image, namespace, request.operator.deployment?.replicas),
    ];
    const validation = validateGeneratedKubernetesDocuments(documents);
    if (!validation.ok) {
      return validation;
    }
    const paths: string[] = [];

    for (const document of documents) {
      const path = join(request.outDir, `${documentFileName(document)}.yaml`);
      await writeFile(path, stringify(document));
      paths.push(path);
    }

    return { ok: true, value: { paths } };
  } catch (cause) {
    return {
      ok: false,
      error: {
        code: 'BUNDLE_INVALID',
        message: cause instanceof Error ? cause.message : 'Failed to emit Kubernetes YAML.',
        severity: 'error',
        context: {},
      },
    };
  }
}

export type V1ClusterRole = Omit<V1Role, 'kind' | 'metadata'> & { readonly kind: 'ClusterRole'; readonly metadata: V1ObjectMeta };
export type V1ClusterRoleBinding = Omit<V1RoleBinding, 'kind' | 'metadata' | 'roleRef'> & { readonly kind: 'ClusterRoleBinding'; readonly metadata: V1ObjectMeta; readonly roleRef: V1RoleBinding['roleRef'] };
export type KubernetesDocument = V1CustomResourceDefinition | V1ServiceAccount | V1Role | V1RoleBinding | V1ClusterRole | V1ClusterRoleBinding | V1Deployment;

export function validateGeneratedKubernetesDocuments(documents: readonly KubernetesDocument[]): Result<readonly Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const names = new Set<string>();
  const fileNames = new Set<string>();

  for (const document of documents) {
    if (!document.metadata?.name) {
      diagnostics.push(kubernetesDiagnostic(`Generated ${document.kind ?? 'Kubernetes'} document is missing metadata.name.`));
      continue;
    }
    names.add(`${document.kind}/${document.metadata.name}`);
    const fileName = documentFileName(document);
    if (fileNames.has(fileName)) {
      diagnostics.push(kubernetesDiagnostic(`Generated Kubernetes YAML file name ${fileName}.yaml is not unique.`));
    }
    fileNames.add(fileName);
  }

  for (const document of documents) {
    if (document.kind === 'Deployment') {
      // typecast: semantic validation narrows generated Kubernetes document unions by the runtime kind string.
      const deployment = document as V1Deployment;
      const serviceAccountName = deployment.spec?.template.spec?.serviceAccountName;
      if (serviceAccountName && !names.has(`ServiceAccount/${serviceAccountName}`)) {
        diagnostics.push(kubernetesDiagnostic(`Deployment ${deployment.metadata?.name ?? '<unknown>'} references missing ServiceAccount ${serviceAccountName}.`));
      }
      for (const volume of deployment.spec?.template.spec?.volumes ?? []) {
        const configMapName = volume.configMap?.name;
        if (configMapName && !names.has(`ConfigMap/${configMapName}`)) {
          diagnostics.push(kubernetesDiagnostic(`Deployment ${deployment.metadata?.name ?? '<unknown>'} references missing ConfigMap ${configMapName}.`));
        }
      }
    }

    if (document.kind === 'RoleBinding' || document.kind === 'ClusterRoleBinding') {
      // typecast: semantic validation narrows generated Kubernetes document unions by the runtime kind string.
      const binding = document as V1RoleBinding | V1ClusterRoleBinding;
      if (!names.has(`${binding.roleRef.kind}/${binding.roleRef.name}`)) {
        diagnostics.push(kubernetesDiagnostic(`${binding.kind} ${binding.metadata?.name ?? '<unknown>'} references missing ${binding.roleRef.kind} ${binding.roleRef.name}.`));
      }
      if (binding.kind === 'ClusterRoleBinding') {
        for (const subject of binding.subjects ?? []) {
          if (subject.kind === 'ServiceAccount' && !subject.namespace) {
            diagnostics.push(kubernetesDiagnostic(`ClusterRoleBinding ${binding.metadata?.name ?? '<unknown>'} ServiceAccount subject must include namespace.`));
          }
        }
      }
    }
  }

  if (diagnostics.length > 0) {
    return {
      ok: false,
      error: {
        code: 'MANIFEST_INVALID',
        message: diagnostics[0]?.message ?? 'Generated Kubernetes YAML is semantically invalid.',
        severity: 'error',
        context: {},
        recovery: { summary: 'Regenerate Kubernetes YAML after fixing manifest, RBAC, and deployment references.' },
      },
    };
  }

  return { ok: true, value: diagnostics };
}

function crdDocument(resource: AnyResourceDefinition, manifest: OperatorManifest): V1CustomResourceDefinition {
  const { group } = splitApiVersion(resource.apiVersion);

  return {
    apiVersion: 'apiextensions.k8s.io/v1',
    kind: 'CustomResourceDefinition',
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

function crdVersionDocument(resource: AnyResourceDefinition, version: AnyResourceVersionDefinition) {
  const specSchema = emitStructuralOpenApiSchema(version.spec, `${resource.kind}.${version.name}.spec`);
  const statusSchema = version.status
    ? statusSchemaWithConvention(
      emitStructuralOpenApiSchema(version.status, `${resource.kind}.${version.name}.status`),
      resource.statusConvention,
      `${resource.kind}.${version.name}.status`,
    )
    : undefined;

  return {
    name: version.name,
    served: version.served,
    storage: version.storage,
    schema: {
      openAPIV3Schema: {
        type: 'object',
        properties: {
          spec: toJsonSchemaProps(specSchema),
          ...(statusSchema ? { status: toJsonSchemaProps(statusSchema) } : {}),
        },
        required: ['spec'],
      },
    },
    ...(resource.statusSubresource ? { subresources: { status: {} } } : {}),
    ...(resource.additionalPrinterColumns
      ? { additionalPrinterColumns: resource.additionalPrinterColumns.map((column): V1CustomResourceColumnDefinition => ({ ...column })) }
      : {}),
  };
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

function statusSchemaWithConvention(schema: JsonObject, convention: StatusConvention | undefined, path: string): JsonObject {
  if (!convention) {
    return schema;
  }
  if (schema.type !== 'object') {
    throw new Error(`CRD schema ${path} uses statusConvention but status schema is not an object.`);
  }
  const properties = isJsonObject(schema.properties) ? { ...schema.properties } : {};
  if (!isJsonObject(properties[convention.observedGenerationField])) {
    properties[convention.observedGenerationField] = {
      type: 'integer',
      format: 'int64',
    };
  }
  if (!isJsonObject(properties[convention.conditionsField])) {
    properties[convention.conditionsField] = conditionArraySchema();
  }
  return {
    ...schema,
    properties,
  };
}

function conditionArraySchema(): JsonObject {
  return {
    type: 'array',
    'x-kubernetes-list-type': 'map',
    'x-kubernetes-list-map-keys': ['type'],
    items: {
      type: 'object',
      required: ['type', 'status', 'reason', 'message', 'lastTransitionTime'],
      properties: {
        type: { type: 'string' },
        status: { type: 'string', enum: ['True', 'False', 'Unknown'] },
        reason: { type: 'string' },
        message: { type: 'string' },
        observedGeneration: { type: 'integer', format: 'int64' },
        lastTransitionTime: { type: 'string', format: 'date-time' },
      },
    },
  };
}

function serviceAccountDocument(name: string, namespace: string | undefined, manifest: OperatorManifest): V1ServiceAccount {
  return {
    apiVersion: 'v1',
    kind: 'ServiceAccount',
    metadata: metadata(name, namespace, manifest),
  };
}

function roleDocument(operatorName: string, permissions: readonly PermissionRule[], namespace: string | undefined, manifest: OperatorManifest): V1Role {
  return {
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'Role',
    metadata: metadata(`${operatorName}-controller`, namespace, manifest),
    rules: permissions.map((permission): V1PolicyRule => ({
      apiGroups: [...permission.apiGroups],
      resources: [...permission.resources],
      verbs: [...permission.verbs],
      ...(permission.resourceNames ? { resourceNames: [...permission.resourceNames] } : {}),
    })),
  };
}

function clusterRoleDocument(operatorName: string, permissions: readonly PermissionRule[], manifest: OperatorManifest): V1ClusterRole {
  return {
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'ClusterRole',
    metadata: metadata(`${operatorName}-controller`, undefined, manifest),
    rules: permissions.map((permission): V1PolicyRule => ({
      apiGroups: [...permission.apiGroups],
      resources: [...permission.resources],
      verbs: [...permission.verbs],
      ...(permission.resourceNames ? { resourceNames: [...permission.resourceNames] } : {}),
    })),
  };
}

function rbacRoleDocument(operatorName: string, permissions: readonly PermissionRule[], namespace: string | undefined, clusterRbac: boolean, manifest: OperatorManifest): V1Role | V1ClusterRole {
  return clusterRbac ? clusterRoleDocument(operatorName, permissions, manifest) : roleDocument(operatorName, permissions, namespace, manifest);
}

function roleBindingDocument(operatorName: string, serviceAccountName: string, namespace: string | undefined, manifest: OperatorManifest): V1RoleBinding {
  return {
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'RoleBinding',
    metadata: metadata(`${operatorName}-controller`, namespace, manifest),
    roleRef: {
      apiGroup: 'rbac.authorization.k8s.io',
      kind: 'Role',
      name: `${operatorName}-controller`,
    },
    subjects: [
      {
        kind: 'ServiceAccount',
        name: serviceAccountName,
        ...(namespace ? { namespace } : {}),
      },
    ],
  };
}

function clusterRoleBindingDocument(operatorName: string, serviceAccountName: string, namespace: string, manifest: OperatorManifest): V1ClusterRoleBinding {
  return {
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'ClusterRoleBinding',
    metadata: metadata(`${operatorName}-controller`, undefined, manifest),
    roleRef: {
      apiGroup: 'rbac.authorization.k8s.io',
      kind: 'ClusterRole',
      name: `${operatorName}-controller`,
    },
    subjects: [
      {
        kind: 'ServiceAccount',
        name: serviceAccountName,
        namespace,
      },
    ],
  };
}

function rbacBindingDocument(operatorName: string, serviceAccountName: string, namespace: string | undefined, clusterRbac: boolean, manifest: OperatorManifest): V1RoleBinding | V1ClusterRoleBinding {
  if (clusterRbac) {
    return clusterRoleBindingDocument(operatorName, serviceAccountName, namespace ?? 'default', manifest);
  }
  return roleBindingDocument(operatorName, serviceAccountName, namespace, manifest);
}

function deploymentDocument(manifest: OperatorManifest, serviceAccountName: string, image: string, namespace: string | undefined, replicas?: number): V1Deployment {
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: metadata(manifest.metadata.name, namespace, manifest),
    spec: {
      replicas: replicas ?? 1,
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

function validateDeploymentOperationalSafety(operator: OperatorDefinition, manifest: OperatorManifest): void {
  const replicas = operator.deployment?.replicas ?? 1;
  const leaderElection = manifest.spec.runtime?.leaderElection;
  if (replicas > 1 && !leaderElection?.enabled) {
    throw new Error('Operator deployment.replicas greater than 1 requires runtime.leaderElection.enabled.');
  }
  if (leaderElection?.enabled && !operator.deployment?.namespace && !leaderElection.leaseNamespace) {
    throw new Error('deployment.namespace or runtime.leaderElection.leaseNamespace is required for leader-elected operator deployments.');
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

function operatorHostEnv(manifest: OperatorManifest) {
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

function metadata(name: string, namespace: string | undefined, manifest: OperatorManifest): V1ObjectMeta {
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

function documentFileName(document: KubernetesDocument): string {
  if (!document.metadata?.name) {
    throw new Error(`Generated ${document.kind ?? 'Kubernetes'} document is missing metadata.name.`);
  }

  return `${document.kind?.toLowerCase() ?? 'kubernetes'}-${document.metadata.name}`;
}

function requiresClusterRbac(resources: readonly AnyResourceDefinition[]): boolean {
  return resources.some((resource) => resource.scope === 'Cluster');
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

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function toJsonSchemaProps(schema: JsonObject): V1JSONSchemaProps {
  // typecast: applik8s schema emitters produce Kubernetes OpenAPI-compatible JSON objects; generated Kubernetes client types model that same recursive schema shape.
  return schema as V1JSONSchemaProps;
}

function kubernetesDiagnostic(message: string): Diagnostic {
  return { severity: 'error', code: 'MANIFEST_INVALID', message };
}
