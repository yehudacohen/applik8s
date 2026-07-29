// typecast-file-boundary: application graph metadata is attached through shared symbol keys and structurally checked before compiler projection.
import type {
  ApplicationGraph,
  ApplicationInstallationArtifactContract,
  ApplicationProviderNode,
  JsonObject,
} from '@applik8s/core';
import { applicationGraphMetadataProperty, applicationInstallationMetadataProperty } from '@applik8s/core';
import {
  applicationGraphAllConditions,
  applicationGraphBooleanCondition,
  applicationGraphStringValue,
  applicationKroIncludeWhen,
} from '../application-installation-values.js';
import type { GeneratedApplicationProcessorArtifact } from '../application-processors/index.js';
import type {
  TypeKroCompositionContainerArtifactReference,
  TypeKroCompositionResource,
} from './index.js';
import { typeKroGeneratedResourceId } from './typekro-emission-plan.js';

export interface TypeKroFactoryArtifactsProjection {
  readonly resources: readonly TypeKroCompositionResource[];
  readonly instances: readonly TypeKroCompositionResource[];
  readonly instancesAreAuthoritative: boolean;
}

export function typeKroContainerArtifactReference(
  container: GeneratedApplicationProcessorArtifact['container'],
): TypeKroCompositionContainerArtifactReference {
  return {
    image: container.image,
    imageName: container.imageName,
    tag: container.tag,
    baseImage: container.baseImage,
    contextPath: container.contextPath,
    dockerfilePath: container.dockerfilePath,
    entrypoint: container.entrypoint,
    command: [...container.command],
    sourceDigest: container.sourceDigest,
  };
}

export function injectGeneratedResourcesIntoApplicationRgd(
  artifacts: TypeKroFactoryArtifactsProjection,
  generatedResources: readonly TypeKroCompositionResource[],
  applicationName: string,
  installation?: ApplicationInstallationArtifactContract,
  graph?: ApplicationGraph,
): TypeKroFactoryArtifactsProjection {
  const target = artifacts.resources.find((resource) => resource.apiVersion === 'kro.run/v1alpha1'
    && resource.kind === 'ResourceGraphDefinition'
    && resource.metadata.name === applicationName);
  if (!target) {
    if (generatedResources.length === 0) return artifacts;
    throw new Error(`Application ${applicationName} generated processor resources but its TypeKro ResourceGraphDefinition was not found.`);
  }
  const spec = target.spec;
  if (!isJsonObject(spec) || !Array.isArray(spec.resources)) {
    throw new Error(`Application ResourceGraphDefinition ${applicationName} does not expose spec.resources.`);
  }
  const schema = isJsonObject(spec.schema) ? spec.schema : undefined;
  // CRDs are cluster-scoped installation prerequisites shared by every instance.
  // Keeping them outside the per-instance graph prevents one instance deletion
  // from removing the API and avoids CRD cleanup finalizers blocking KRO teardown.
  const existingResources = spec.resources
    .filter((resource) => !isResourceGraphTemplateKind(resource, 'CustomResourceDefinition'))
    .map((resource) => graph ? applicationProviderConditionalGraphEntry(resource, graph) : resource)
    .map((resource) => applicationInstallationRuntimeGraphEntry(resource, schema, applicationName, true));
  const injected = generatedResources
    .map((resource, index) => applicationGeneratedResourceGraphEntry(resource, index))
    .map((resource) => applicationInstallationRuntimeGraphEntry(resource, schema, applicationName, false));
  const requiredReferences = graph ? applicationRequiredExternalReferences(graph) : [];
  const applicationResources = [...existingResources, ...requiredReferences, ...injected];
  // KRO status CEL cannot read schema.spec directly. Keep one always-present
  // graph resource as the status projection boundary for installation values
  // and conditional-resource activation flags.
  const installationResources = schema
    && (installation?.statusProjection?.mode === 'standardApplicationReadiness'
      || applicationResources.some(applicationResourceUsesInstallationContract))
    ? [applicationInstallationContractResource(schema, applicationResources, applicationName)]
    : [];
  // External references are graph inputs. Emit them before every authored or
  // generated consumer so downstream composition adapters can bind typed
  // dependencies while materializing Pod specs in one pass.
  const resources = [...requiredReferences, ...existingResources, ...installationResources, ...injected]
    .filter(isJsonObject);
  const projectedSchema = schema && installation?.statusProjection?.mode === 'standardApplicationReadiness'
    ? { ...schema, status: applicationInstallationStatusProjection(schema, resources, installation.statusProjection.fields, graph) }
    : schema;
  return {
    ...artifacts,
    resources: artifacts.resources.map((resource) => resource === target ? {
      ...resource,
      spec: { ...spec, ...(projectedSchema ? { schema: projectedSchema } : {}), resources },
    } : resource),
  };
}

function applicationResourceUsesInstallationContract(resource: unknown): boolean {
  if (!isJsonObject(resource) || !isJsonObject(resource.template) || resource.template.kind !== 'Deployment') return false;
  const spec = isJsonObject(resource.template.spec) ? resource.template.spec : undefined;
  const podTemplate = spec && isJsonObject(spec.template) ? spec.template : undefined;
  const podSpec = podTemplate && isJsonObject(podTemplate.spec) ? podTemplate.spec : undefined;
  const containers = podSpec && Array.isArray(podSpec.containers) ? podSpec.containers : [];
  return containers.some((container) => isJsonObject(container)
    && Array.isArray(container.env)
    && container.env.some((entry) => isJsonObject(entry) && entry.name === 'APPLIK8S_INSTALLATION_SPEC'));
}

const applicationArtifactSetDigestPlaceholder = '__APPLIK8S_ARTIFACT_SET_DIGEST__';

function applicationInstallationContractResource(
  schema: JsonObject,
  resources: readonly unknown[],
  applicationName: string,
): JsonObject {
  const namespace = resources.flatMap((entry) => {
    if (!isJsonObject(entry) || !isJsonObject(entry.template) || !isJsonObject(entry.template.metadata)) return [];
    return typeof entry.template.metadata.namespace === 'string' ? [entry.template.metadata.namespace] : [];
  })[0];
  const data: Record<string, string> = {
    artifactDigest: applicationArtifactSetDigestPlaceholder,
    'spec.json': '$' + '{json.marshal(schema.spec)}',
    'status.NotConfigured': 'NotConfigured',
    'status.NotRequired': 'NotRequired',
  };
  if (applicationSchemaField(schema, 'version')) data.version = '$' + '{string(schema.spec.version)}';
  if (applicationSchemaField(schema, 'hostname')) data.hostname = '$' + '{string(schema.spec.hostname)}';
  for (const resource of resources) {
    if (!isJsonObject(resource) || typeof resource.id !== 'string') continue;
    const active = applicationResourceRawActiveExpression(resource);
    if (active === 'true' || active === 'false') continue;
    data[applicationResourceActiveFlagKey(resource.id)] = `\${string(${active})}`;
  }
  return {
    id: 'applik8sInstallationContract',
    template: {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: {
        name: `${applicationName}-installation-contract`,
        ...(namespace ? { namespace } : {}),
        labels: {
          'app.kubernetes.io/managed-by': 'applik8s',
          'applik8s.dev/application': applicationName,
        },
      },
      data,
    },
  };
}

function applicationGeneratedResourceGraphEntry(resource: TypeKroCompositionResource, index: number): JsonObject {
  const metadata = isJsonObject(resource.metadata) ? resource.metadata : undefined;
  const annotations = metadata && isJsonObject(metadata.annotations) ? metadata.annotations : undefined;
  const authoredIncludeWhen = annotations?.['applik8s.dev/include-when'];
  const includeWhen = applicationKroIncludeWhen(typeof authoredIncludeWhen === 'string' ? authoredIncludeWhen : undefined);
  return {
    id: typeKroGeneratedResourceId(resource, index),
    ...(typeof includeWhen === 'string' && includeWhen.trim().length > 0 ? { includeWhen: [includeWhen] } : {}),
    template: applicationResourceWithoutCompilerAnnotations(resource),
  };
}

/**
 * A declared Application version is rollout intent, not decorative status.
 * Stamp authored Deployments at the pod-template boundary so changing
 * `spec.version` produces a Kubernetes rollout even when a deployment reuses
 * an already-published immutable image digest.
 */
function applicationInstallationRuntimeGraphEntry(
  resource: unknown,
  schema: JsonObject | undefined,
  applicationName: string,
  requireManagedByLabel: boolean,
): unknown {
  if (!schema || !isJsonObject(resource) || !isJsonObject(resource.template)) {
    return resource;
  }
  const template = resource.template;
  if (template.kind !== 'Deployment' || !isJsonObject(template.metadata) || !isJsonObject(template.spec)) return resource;
  const labels = isJsonObject(template.metadata.labels) ? template.metadata.labels : undefined;
  if (requireManagedByLabel && labels?.['app.kubernetes.io/managed-by'] !== 'applik8s') return resource;
  const podTemplate = isJsonObject(template.spec.template) ? template.spec.template : undefined;
  if (!podTemplate) return resource;
  const podMetadata = isJsonObject(podTemplate.metadata) ? podTemplate.metadata : {};
  const annotations = isJsonObject(podMetadata.annotations) ? podMetadata.annotations : {};
  const podSpec = isJsonObject(podTemplate.spec) ? podTemplate.spec : {};
  const containers = Array.isArray(podSpec.containers)
    ? podSpec.containers.map((container) => applicationInstallationRuntimeContainer(container, applicationName))
    : podSpec.containers;
  return {
    ...resource,
    template: {
      ...template,
      spec: {
        ...template.spec,
        template: {
          ...podTemplate,
          metadata: {
            ...podMetadata,
            annotations: {
              ...annotations,
              ...(applicationSchemaField(schema, 'version')
                ? { 'applik8s.dev/requested-version': '$' + '{string(schema.spec.version)}' }
                : {}),
            },
          },
          spec: {
            ...podSpec,
            ...(Array.isArray(containers) ? { containers } : {}),
          },
        },
      },
    },
  };
}

function applicationInstallationRuntimeContainer(container: unknown, applicationName: string): unknown {
  if (!isJsonObject(container)) return container;
  const env = Array.isArray(container.env)
    ? container.env.filter((entry) => !isJsonObject(entry) || entry.name !== 'APPLIK8S_INSTALLATION_SPEC')
    : [];
  return {
    ...container,
    env: [...env, {
      name: 'APPLIK8S_INSTALLATION_SPEC',
      valueFrom: {
        configMapKeyRef: {
          name: `${applicationName}-installation-contract`,
          key: 'spec.json',
        },
      },
    }],
  };
}

function applicationProviderConditionalGraphEntry(resource: unknown, graph: ApplicationGraph): unknown {
  if (!isJsonObject(resource)) return resource;
  const analyticalDatabase = graph.nodes.find((node): node is ApplicationProviderNode<'AnalyticalDatabase'> =>
    node.kind === 'provider' && node.interface === 'AnalyticalDatabase' && node.implementation === 'clickhouse');
  const condition = applicationKroIncludeWhen(analyticalDatabase && isJsonObject(analyticalDatabase.config)
    ? applicationGraphAllConditions(analyticalDatabase.config.enabled, analyticalDatabase.config.provision)
    : undefined);
  if (!condition) return resource;
  const target = isJsonObject(resource.template) ? resource.template : isJsonObject(resource.externalRef) ? resource.externalRef : undefined;
  if (!target || typeof target.kind !== 'string') return resource;
  if (target.kind !== 'ClickHouseInstallation'
    && target.kind !== 'ClickHouseHelmRepository'
    && target.kind !== 'ClickHouseOperatorBootstrap') return resource;
  const existing = Array.isArray(resource.includeWhen)
    ? resource.includeWhen.filter((value): value is string => typeof value === 'string' && value.length > 0)
    : [];
  return { ...resource, includeWhen: [...new Set([...existing, condition])] };
}

function applicationResourceWithoutCompilerAnnotations(resource: TypeKroCompositionResource): TypeKroCompositionResource {
  if (!isJsonObject(resource.metadata) || !isJsonObject(resource.metadata.annotations)
    || !Object.hasOwn(resource.metadata.annotations, 'applik8s.dev/include-when')) return resource;
  const annotations = { ...resource.metadata.annotations };
  delete annotations['applik8s.dev/include-when'];
  const metadata = { ...resource.metadata, ...(Object.keys(annotations).length > 0 ? { annotations } : {}) };
  if (Object.keys(annotations).length === 0) delete metadata.annotations;
  return { ...resource, metadata };
}

function applicationRequiredExternalReferences(graph: ApplicationGraph): readonly JsonObject[] {
  const references: JsonObject[] = [];
  const objectStorage = graph.nodes.find((node): node is ApplicationProviderNode<'ObjectStorage'> => node.kind === 'provider' && node.interface === 'ObjectStorage');
  const credentials = objectStorage && isJsonObject(objectStorage.config) && isJsonObject(objectStorage.config.objectStorage)
    ? objectStorage.config.objectStorage.credentialsSecret
    : undefined;
  const objectStorageEnabled = objectStorage && isJsonObject(objectStorage.config) && isJsonObject(objectStorage.config.objectStorage)
    ? applicationGraphBooleanCondition(objectStorage.config.objectStorage.enabled)
    : undefined;
  if (isJsonObject(credentials) && typeof credentials.apiVersion === 'string' && typeof credentials.kind === 'string' && typeof credentials.name === 'string') {
    references.push(applicationExternalReference('applik8sObjectStorageCredentials', credentials, objectStorageEnabled));
  }
  const registry = graph.nodes.find((node) => node.kind === 'provider' && node.interface === 'ContainerRegistry');
  const registryConfig = registry?.kind === 'provider' && isJsonObject(registry.config) && isJsonObject(registry.config.containerRegistry)
    ? registry.config.containerRegistry
    : undefined;
  const pullSecret = registryConfig ? applicationContainerRegistryPullSecret(registryConfig) : undefined;
  if (pullSecret && typeof pullSecret.apiVersion === 'string' && typeof pullSecret.kind === 'string' && typeof pullSecret.name === 'string') {
    references.push(applicationExternalReference(
      'applik8sContainerRegistryPullSecret',
      pullSecret,
      undefined,
      'containerRegistryPullSecret',
    ));
  }
  return references;
}

function applicationContainerRegistryPullSecret(config: JsonObject): JsonObject | undefined {
  if (isJsonObject(config.pullSecret)) return config.pullSecret;
  if (config.kind !== 'application-provider-selection') return undefined;
  if (typeof config.selector !== 'string' || !/^schema\.spec(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(config.selector)) {
    throw new Error('ContainerRegistry provider selection must use a direct schema.spec discriminator.');
  }
  if (!isJsonObject(config.cases) || !isJsonObject(config.default)) {
    throw new Error('ContainerRegistry provider selection must declare object cases and a default provider.');
  }
  const branches = [
    ...Object.entries(config.cases).map(([name, provider]) => ({ name, provider })),
    { name: 'default', provider: config.default },
  ].map(({ name, provider }) => {
    if (!isJsonObject(provider) || !isJsonObject(provider.pullSecret)) {
      throw new Error(`ContainerRegistry provider selection branch ${name} must expose a pullSecret.`);
    }
    const { pullSecret } = provider;
    if (typeof pullSecret.apiVersion !== 'string' || typeof pullSecret.kind !== 'string'
      || typeof pullSecret.name !== 'string') {
      throw new Error(`ContainerRegistry provider selection branch ${name} has an incomplete pullSecret reference.`);
    }
    return {
      name,
      secret: {
        apiVersion: pullSecret.apiVersion,
        kind: pullSecret.kind,
        name: pullSecret.name,
        ...(typeof pullSecret.namespace === 'string' ? { namespace: pullSecret.namespace } : {}),
      },
    };
  });
  const fallback = branches.at(-1);
  if (!fallback) return undefined;
  for (const branch of branches) {
    if (branch.secret.apiVersion !== fallback.secret.apiVersion || branch.secret.kind !== fallback.secret.kind) {
      throw new Error('ContainerRegistry provider selection pullSecret references must share one Kubernetes GVK.');
    }
  }
  const cases = branches.slice(0, -1);
  const namespaceValues = branches.map((branch) => branch.secret.namespace);
  if (namespaceValues.some((value) => value === undefined) && namespaceValues.some((value) => value !== undefined)) {
    throw new Error('ContainerRegistry provider selection pullSecret references must be consistently namespaced.');
  }
  return {
    apiVersion: fallback.secret.apiVersion,
    kind: fallback.secret.kind,
    name: applicationProviderSelectionString(config.selector, cases.map((branch) => [branch.name, branch.secret.name]), fallback.secret.name),
    ...(fallback.secret.namespace === undefined ? {} : {
      namespace: applicationProviderSelectionString(
        config.selector,
        cases.map((branch) => [branch.name, branch.secret.namespace]),
        fallback.secret.namespace,
      ),
    }),
  };
}

function applicationProviderSelectionString(
  selector: string,
  cases: readonly (readonly [string, unknown])[],
  fallback: unknown,
): string {
  const normalizedFallback = applicationGraphStringValue(fallback);
  if (normalizedFallback === undefined) throw new Error('Application provider selection fallback must be a string.');
  const normalizedCases = cases.map(([name, value]) => {
    const normalized = applicationGraphStringValue(value);
    if (normalized === undefined) throw new Error(`Application provider selection branch ${name} must resolve to a string.`);
    return [name, normalized] as const;
  });
  if (normalizedCases.every(([, value]) => value === normalizedFallback)) return normalizedFallback;
  const expression = normalizedCases.reduceRight(
    (otherwise, [name, value]) => `${selector} == ${JSON.stringify(name)} ? ${applicationCelString(value)} : (${otherwise})`,
    applicationCelString(normalizedFallback),
  );
  return `\${${expression}}`;
}

function applicationCelString(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('${') && trimmed.endsWith('}')
    ? trimmed.slice(2, -1)
    : JSON.stringify(value);
}

function applicationExternalReference(
  id: string,
  reference: JsonObject,
  includeWhen?: string,
  role?: 'containerRegistryPullSecret',
): JsonObject {
  if (typeof reference.apiVersion !== 'string' || typeof reference.kind !== 'string' || typeof reference.name !== 'string') {
    throw new Error(`Application external reference ${id} requires string apiVersion, kind, and name fields.`);
  }
  const condition = applicationKroIncludeWhen(includeWhen);
  return {
    id,
    ...(role ? { role } : {}),
    ...(condition ? { includeWhen: [condition] } : {}),
    externalRef: {
      apiVersion: reference.apiVersion,
      kind: reference.kind,
      metadata: {
        name: reference.name,
        ...(typeof reference.namespace === 'string' ? { namespace: reference.namespace } : {}),
      },
    },
  };
}

function applicationInstallationStatusProjection(
  schema: JsonObject,
  resources: readonly unknown[],
  fields: NonNullable<ApplicationInstallationArtifactContract['statusProjection']>['fields'],
  graph?: ApplicationGraph,
): JsonObject {
  const selected = new Set(fields);
  const ready = applicationReadinessExpression(resources);
  const failed = applicationTerminalFailureExpression(resources);
  const existing = isJsonObject(schema.status) ? schema.status : {};
  const projected: Record<string, unknown> = { ...existing };
  if (selected.has('ready')) projected.ready = `\${${ready}}`;
  if (selected.has('phase')) projected.phase = `\${(${ready}) ? "Ready" : ((${failed}) ? "Degraded" : "Installing")}`;
  if (selected.has('url') && applicationSchemaField(schema, 'hostname')) {
    const publicUrl = applicationPublicUrlProjection(resources);
    if (publicUrl) projected.url = publicUrl;
  }
  if (selected.has('observedVersion') && applicationSchemaField(schema, 'version')) {
    projected.observedVersion = '$' + '{applik8sInstallationContract.data.version}';
  }
  if (selected.has('artifactDigest')) {
    projected.artifactDigest = '$' + '{applik8sInstallationContract.data.artifactDigest}';
  }
  if (selected.has('providerStatus')) {
    projected.providerStatus = applicationProviderStatusProjection(resources, graph, existing.providerStatus);
  }
  if (selected.has('migrationStatus')) {
    projected.migrationStatus = applicationResourceGroupStatus(resources, (_entry, resource) =>
      resource.kind === 'Job'
      && isJsonObject(resource.metadata)
      && isJsonObject(resource.metadata.labels)
      && resource.metadata.labels['app.kubernetes.io/component'] === 'migration', 'NotRequired');
  }
  if (selected.has('rolloutStatus')) {
    projected.rolloutStatus = `\${(${ready}) ? "Current" : ((${failed}) ? "Blocked" : "Reconciling")}`;
  }
  if (selected.has('backupStatus')) {
    projected.backupStatus = applicationResourceGroupStatus(resources, (_entry, resource) =>
      ['Backup', 'ScheduledBackup', 'VolumeSnapshot'].includes(String(resource.kind))
      || (resource.kind === 'CronJob'
        && isJsonObject(resource.metadata)
        && /backup|export/i.test(String(resource.metadata.name))), 'NotConfigured');
  }
  if (selected.has('projectionStatus')) {
    projected.projectionStatus = {
      online: applicationResourceGroupStatus(resources, (_entry, resource) =>
        resource.kind === 'Valkey' && resource.apiVersion === 'hyperspike.io/v1', 'NotConfigured'),
      analytics: applicationResourceGroupStatus(resources, (_entry, resource) =>
        resource.kind === 'ClickHouseInstallation', 'NotConfigured'),
    };
  }
  if (selected.has('degradedReasons')) {
    projected.degradedReasons = applicationDegradedReasonsProjection(resources);
  }
  return projected as JsonObject;
}

function applicationResourceGroupStatus(
  resources: readonly unknown[],
  predicate: (entry: JsonObject, resource: JsonObject) => boolean,
  empty: 'NotRequired' | 'NotConfigured',
): string {
  const matching = resources.flatMap((value) => {
    if (!isJsonObject(value)) return [];
    const resource = isJsonObject(value.template) ? value.template : isJsonObject(value.externalRef) ? value.externalRef : undefined;
    if (!resource || !predicate(value, resource)) return [];
    return [value];
  });
  const checks = matching.flatMap((value) => applicationResourceReadinessExpression(value) ?? []);
  const failures = matching.flatMap((value) => applicationResourceFailureExpression(value) ?? []);
  // KRO status fields must refer to a graph resource. Even a constant CEL
  // expression is rejected, so expose capability fallbacks through the
  // always-present installation contract ConfigMap.
  if (checks.length === 0) return `\${applik8sInstallationContract.data[${JSON.stringify(`status.${empty}`)}]}`;
  const active = matching.map(applicationResourceActiveExpression);
  const anyActive = active.includes('true') ? 'true' : active.map((condition) => `(${condition})`).join(' || ');
  const failed = failures.length > 0 ? failures.map((check) => `(${check})`).join(' || ') : 'false';
  return `\${(${anyActive}) ? ((${failed}) ? "Failed" : ((${checks.map((check) => `(${check})`).join(' && ')}) ? "Ready" : "Pending")) : "${empty}"}`;
}

function applicationProviderStatusProjection(resources: readonly unknown[], graph: ApplicationGraph | undefined, schema: unknown): JsonObject {
  const workloadComponent = (resource: JsonObject): string | undefined => resource.kind === 'Deployment'
    && isJsonObject(resource.metadata)
    && isJsonObject(resource.metadata.labels)
    && typeof resource.metadata.labels['app.kubernetes.io/component'] === 'string'
    ? resource.metadata.labels['app.kubernetes.io/component']
    : undefined;
  const identityWorkload = (_entry: JsonObject, resource: JsonObject) => ['application-host', 'query-gateway'].includes(workloadComponent(resource) ?? '');
  const authorizationWorkload = (entry: JsonObject, resource: JsonObject) => identityWorkload(entry, resource)
    || workloadComponent(resource) === 'command-processor';
  const categories: Readonly<Record<string, {
    readonly predicate: (entry: JsonObject, resource: JsonObject) => boolean;
    readonly configured?: boolean;
  }>> = {
    registry: { predicate: (entry) => entry.id === 'applik8sContainerRegistryPullSecret' },
    database: { predicate: (_entry, resource) => resource.kind === 'Cluster' && resource.apiVersion === 'postgresql.cnpg.io/v1' },
    eventLog: { predicate: (_entry, resource) => resource.apiVersion === 'jetstream.nats.io/v1beta2'
      || (resource.kind === 'HelmRelease' && isJsonObject(resource.metadata) && ['nats', 'nack', 'applik8s-events'].includes(String(resource.metadata.name))),
    },
    index: { predicate: (_entry, resource) => resource.kind === 'Valkey' && resource.apiVersion === 'hyperspike.io/v1' },
    analytics: { predicate: (_entry, resource) => resource.kind === 'ClickHouseInstallation' },
    objectStorage: { predicate: (entry) => entry.id === 'applik8sObjectStorageCredentials' },
    workflows: { predicate: (entry, resource) => /workflow/i.test(String(entry.id)) && ['Cluster', 'HelmRelease', 'Deployment'].includes(String(resource.kind)) },
    identity: { predicate: identityWorkload, configured: applicationProviderIsConfigured(graph, 'RequestIdentity') },
    authorization: { predicate: authorizationWorkload, configured: applicationProviderIsConfigured(graph, 'Authorization') },
    exposure: {
      predicate: (_entry, resource) => resource.kind === 'Ingress'
        || resource.kind === 'Certificate'
        || resource.kind === 'DNSEndpoint'
        || (resource.kind === 'Service'
          && isJsonObject(resource.metadata)
          && isJsonObject(resource.metadata.annotations)
          && typeof resource.metadata.annotations['applik8s.dev/public-url'] === 'string'),
      configured: applicationProviderIsConfigured(graph, 'HttpExposure'),
    },
    workloads: { predicate: (_entry, resource) => resource.kind === 'Deployment' },
  };
  const selected = isJsonObject(schema) ? new Set(Object.keys(schema)) : new Set(Object.keys(categories));
  return Object.fromEntries(Object.entries(categories).filter(([name]) => selected.has(name)).map(([name, category]) => {
    const matching = resources.flatMap((value) => {
      if (!isJsonObject(value)) return [];
      const resource = isJsonObject(value.template) ? value.template : isJsonObject(value.externalRef) ? value.externalRef : undefined;
      if (!resource || !category.predicate(value, resource)) return [];
      return [value];
    });
    const checks = matching.flatMap((value) => applicationResourceReadinessExpression(value) ?? []);
    const failures = matching.flatMap((value) => applicationResourceFailureExpression(value) ?? []);
    if (matching.length === 0) {
      return [name, '${applik8sInstallationContract.data["status.NotConfigured"]}'];
    }
    const readiness = checks.length > 0 ? checks.map((check) => `(${check})`).join(' && ') : 'false';
    const failed = failures.length > 0 ? failures.map((check) => `(${check})`).join(' || ') : 'false';
    const active = category.configured === false ? [] : matching.map(applicationResourceActiveExpression);
    const anyActive = active.includes('true') ? 'true' : active.length > 0
      ? active.map((condition) => `(${condition})`).join(' || ')
      : 'false';
    return [name, `\${(${anyActive}) ? ((${failed}) ? "Failed" : ((${readiness}) ? "Ready" : "Pending")) : "NotConfigured"}`];
  })) as JsonObject;
}

function applicationProviderIsConfigured(graph: ApplicationGraph | undefined, providerInterface: string): boolean {
  if (!graph) return false;
  const provider = graph.nodes.find((node): node is ApplicationProviderNode => node.kind === 'provider' && node.interface === providerInterface);
  const bindingKind = provider?.config?.bindingKind;
  return bindingKind === 'provided' || bindingKind === 'default' || bindingKind === 'frameworkDefault';
}

function applicationSchemaField(schema: JsonObject, field: string): boolean {
  return isJsonObject(schema.spec) && Object.hasOwn(schema.spec, field);
}

function applicationPublicUrlProjection(resources: readonly unknown[]): string | undefined {
  const candidates: { readonly active: string; readonly value: string }[] = [];
  for (const entry of resources) {
    if (!isJsonObject(entry) || typeof entry.id !== 'string' || !isJsonObject(entry.template) || entry.template.kind !== 'Ingress' || !isJsonObject(entry.template.spec)) continue;
    const scheme = Array.isArray(entry.template.spec.tls) && entry.template.spec.tls.length > 0 ? 'https' : 'http';
    candidates.push({ active: applicationResourceActiveExpression(entry), value: `"${scheme}://" + string(${entry.id}.spec.rules[0].host)` });
  }
  for (const entry of resources) {
    if (!isJsonObject(entry) || typeof entry.id !== 'string' || !isJsonObject(entry.template) || entry.template.kind !== 'Service' || !isJsonObject(entry.template.spec) || entry.template.spec.type !== 'NodePort') continue;
    const metadata = isJsonObject(entry.template.metadata) ? entry.template.metadata : undefined;
    const annotations = metadata && isJsonObject(metadata.annotations) ? metadata.annotations : undefined;
    const publicUrl = annotations?.['applik8s.dev/public-url'];
    if (typeof publicUrl === 'string' && publicUrl.length > 0) {
      candidates.push({ active: applicationResourceActiveExpression(entry), value: `string(${entry.id}.metadata.annotations["applik8s.dev/public-url"])` });
    }
  }
  if (candidates.length === 0) return undefined;
  const unconditional = candidates.find((candidate) => candidate.active === 'true');
  if (unconditional) return `\${${unconditional.value}}`;
  const expression = candidates.reduceRight(
    (otherwise, candidate) => `(${candidate.active}) ? (${candidate.value}) : (${otherwise})`,
    '""',
  );
  return `\${${expression}}`;
}

function applicationReadinessExpression(resources: readonly unknown[]): string {
  const checks = resources.flatMap((entry) => applicationResourceReadinessExpression(entry) ?? []);
  return checks.length > 0 ? checks.map((check) => `(${check})`).join(' && ') : 'false';
}

function applicationTerminalFailureExpression(resources: readonly unknown[]): string {
  const checks = resources.flatMap((entry) => applicationResourceFailureExpression(entry) ?? []);
  return checks.length > 0 ? checks.map((check) => `(${check})`).join(' || ') : 'false';
}

function applicationDegradedReasonsProjection(resources: readonly unknown[]): string {
  const failures = resources.flatMap((entry) => {
    const check = applicationResourceFailureExpression(entry);
    if (!check || !isJsonObject(entry)) return [];
    const resource = isJsonObject(entry.template) ? entry.template : isJsonObject(entry.externalRef) ? entry.externalRef : undefined;
    if (!resource || typeof resource.kind !== 'string') return [];
    const metadata = isJsonObject(resource.metadata) ? resource.metadata : undefined;
    const name = typeof metadata?.name === 'string' && !metadata.name.includes('${') ? metadata.name : entry.id;
    return [{ check, reason: `${resource.kind}/${name} reported a terminal reconciliation failure` }];
  });
  if (failures.length === 0) return '${applik8sInstallationContract.data["status.NotConfigured"] == "NotConfigured" ? [] : []}';
  // KRO's SimpleSchema status expressions support ordinary CEL ternaries. A
  // nested expression is deliberately used instead of list concatenation so
  // the generated contract remains valid on every supported KRO release.
  const expression = failures.reduceRight(
    (otherwise, failure) => `(${failure.check}) ? [${JSON.stringify(failure.reason)}] : (${otherwise})`,
    '[]',
  );
  return `\${${expression}}`;
}

function applicationResourceReadinessExpression(entry: unknown): string | undefined {
  const readiness = applicationResourceBaseReadinessExpression(entry);
  if (!readiness || !isJsonObject(entry)) return readiness;
  const active = applicationResourceActiveExpression(entry);
  return active === 'true' ? readiness : `!(${active}) || (${readiness})`;
}

function applicationResourceFailureExpression(entry: unknown): string | undefined {
  const failure = applicationResourceBaseFailureExpression(entry);
  if (!failure || !isJsonObject(entry)) return failure;
  const active = applicationResourceActiveExpression(entry);
  return active === 'true' ? failure : `(${active}) && (${failure})`;
}

function applicationResourceBaseFailureExpression(entry: unknown): string | undefined {
  if (!isJsonObject(entry) || typeof entry.id !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.id)) return undefined;
  const resource = isJsonObject(entry.template) ? entry.template : isJsonObject(entry.externalRef) ? entry.externalRef : undefined;
  if (!resource || typeof resource.kind !== 'string') return undefined;
  const id = entry.id;
  switch (resource.kind) {
    case 'Deployment':
      return `has(${id}.status.conditions) && (${id}.status.conditions.exists(c, c.type == "Progressing" && c.status == "False" && c.reason == "ProgressDeadlineExceeded") || ${id}.status.conditions.exists(c, c.type == "ReplicaFailure" && c.status == "True"))`;
    case 'Job':
      return `has(${id}.status.conditions) && ${id}.status.conditions.exists(c, c.type == "Failed" && c.status == "True")`;
    case 'HelmRelease':
      return `has(${id}.status.conditions) && ${id}.status.conditions.exists(c, c.type == "Stalled" && c.status == "True")`;
    case 'ClickHouseInstallation':
      return `has(${id}.status.status) && (string(${id}.status.status) == "Failed" || string(${id}.status.status) == "Aborted")`;
    default:
      return undefined;
  }
}

function applicationResourceActiveExpression(entry: JsonObject): string {
  const active = applicationResourceRawActiveExpression(entry);
  if (active === 'true' || active === 'false') return active;
  if (typeof entry.id !== 'string') {
    throw new Error('A conditional Application resource requires a stable graph id for status projection.');
  }
  return `applik8sInstallationContract.data[${JSON.stringify(applicationResourceActiveFlagKey(entry.id))}] == "true"`;
}

function applicationResourceRawActiveExpression(entry: JsonObject): string {
  if (!Array.isArray(entry.includeWhen)) return 'true';
  const conditions = entry.includeWhen.flatMap((condition) => {
    if (typeof condition !== 'string' || condition.trim().length === 0) return [];
    const trimmed = condition.trim();
    return [trimmed.startsWith('${') && trimmed.endsWith('}') ? trimmed.slice(2, -1) : trimmed];
  });
  return conditions.length > 0 ? conditions.map((condition) => `(${condition})`).join(' && ') : 'true';
}

function applicationResourceActiveFlagKey(resourceId: string): string {
  const key = `active.${resourceId}`;
  if (key.length > 253 || !/^[A-Za-z0-9_.-]+$/.test(key)) {
    throw new Error(`Application resource ${resourceId} cannot be represented as an installation status activation flag.`);
  }
  return key;
}

function applicationResourceBaseReadinessExpression(entry: unknown): string | undefined {
  if (!isJsonObject(entry) || typeof entry.id !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.id)) return undefined;
  const resource = isJsonObject(entry.template) ? entry.template : isJsonObject(entry.externalRef) ? entry.externalRef : undefined;
  if (!resource || typeof resource.kind !== 'string') return undefined;
  const id = entry.id;
  switch (resource.kind) {
    case 'Deployment':
      return `has(${id}.status.observedGeneration) && ${id}.status.observedGeneration >= ${id}.metadata.generation && has(${id}.status.availableReplicas) && ${id}.status.availableReplicas >= (has(${id}.spec.replicas) ? ${id}.spec.replicas : 1)`;
    case 'StatefulSet':
      return `has(${id}.status.observedGeneration) && ${id}.status.observedGeneration >= ${id}.metadata.generation && has(${id}.status.readyReplicas) && ${id}.status.readyReplicas >= (has(${id}.spec.replicas) ? ${id}.spec.replicas : 1)`;
    case 'DaemonSet':
      return `has(${id}.status.observedGeneration) && ${id}.status.observedGeneration >= ${id}.metadata.generation && has(${id}.status.numberReady) && ${id}.status.numberReady >= ${id}.status.desiredNumberScheduled`;
    case 'Job':
      return `has(${id}.status.conditions) && ${id}.status.conditions.exists(c, c.type == "Complete" && c.status == "True")`;
    case 'Backup':
      return resource.apiVersion === 'postgresql.cnpg.io/v1'
        ? `has(${id}.status.phase) && (string(${id}.status.phase) == "completed" || string(${id}.status.phase) == "Completed")`
        : undefined;
    case 'ScheduledBackup':
      return resource.apiVersion === 'postgresql.cnpg.io/v1'
        ? `has(${id}.metadata.resourceVersion) && ${id}.metadata.resourceVersion != ""`
        : undefined;
    case 'VolumeSnapshot':
      return `has(${id}.status.readyToUse) && ${id}.status.readyToUse == true`;
    case 'CronJob':
      return `has(${id}.metadata.resourceVersion) && ${id}.metadata.resourceVersion != ""`;
    case 'Service':
    case 'Ingress':
    case 'DNSEndpoint':
      return `has(${id}.metadata.resourceVersion) && ${id}.metadata.resourceVersion != ""`;
    case 'Cluster':
      return resource.apiVersion === 'postgresql.cnpg.io/v1'
        ? `has(${id}.status.conditions) && ${id}.status.conditions.exists(c, c.type == "Ready" && c.status == "True")`
        : undefined;
    case 'HelmRelease':
    case 'Certificate':
      return `has(${id}.status.conditions) && ${id}.status.conditions.exists(c, c.type == "Ready" && c.status == "True")`;
    case 'ClickHouseInstallation':
      return `has(${id}.status.status) && ${id}.status.status == "Completed"`;
    case 'Valkey':
      return resource.apiVersion === 'hyperspike.io/v1'
        ? `((has(${id}.status.ready) && ${id}.status.ready == true) || (has(${id}.status.conditions) && ${id}.status.conditions.exists(c, c.type == "Ready" && c.status == "True")))`
        : undefined;
    case 'Stream':
    case 'Consumer':
      return resource.apiVersion === 'jetstream.nats.io/v1beta2'
        ? `has(${id}.status.observedGeneration) && ${id}.status.observedGeneration >= ${id}.metadata.generation && has(${id}.status.conditions) && ${id}.status.conditions.exists(c, c.type == "Ready" && c.status == "True")`
        : undefined;
    case 'Secret':
    case 'ConfigMap':
      return isJsonObject(entry.externalRef) ? `has(${id}.metadata.resourceVersion) && ${id}.metadata.resourceVersion != ""` : undefined;
    default:
      return isJsonObject(entry.externalRef) && resource.kind.endsWith('Bootstrap')
        ? `has(${id}.status.ready) && ${id}.status.ready == true`
        : undefined;
  }
}

function isResourceGraphTemplateKind(resource: unknown, kind: string): boolean {
  return isJsonObject(resource) && isJsonObject(resource.template) && resource.template.kind === kind;
}

export function applicationGraphForComposition(composition: object): ApplicationGraph | undefined {
  const graph = Reflect.get(composition, applicationGraphMetadataProperty);
  return graph && typeof graph === 'object'
    && Reflect.get(graph, 'apiVersion') === 'applik8s.appGraph/v1alpha1'
    && Reflect.get(graph, 'kind') === 'ApplicationGraph'
    ? graph as ApplicationGraph
    : undefined;
}

export function applicationInstallationForComposition(composition: object): ApplicationInstallationArtifactContract | undefined {
  const value = Reflect.get(composition, applicationInstallationMetadataProperty);
  if (!value || typeof value !== 'object') return undefined;
  const apiVersion = Reflect.get(value, 'apiVersion');
  const kind = Reflect.get(value, 'kind');
  const emitDefaultInstance = Reflect.get(value, 'emitDefaultInstance');
  const controlPlaneNamespace = Reflect.get(value, 'controlPlaneNamespace');
  const statusProjectionValue = Reflect.get(value, 'statusProjection');
  const statusProjectionFields = statusProjectionValue && typeof statusProjectionValue === 'object'
    && Reflect.get(statusProjectionValue, 'mode') === 'standardApplicationReadiness'
    ? Reflect.get(statusProjectionValue, 'fields')
    : undefined;
  const statusProjection = Array.isArray(statusProjectionFields)
    && statusProjectionFields.every((field) => [
      'ready',
      'phase',
      'url',
      'observedVersion',
      'artifactDigest',
      'providerStatus',
      'migrationStatus',
      'rolloutStatus',
      'backupStatus',
      'projectionStatus',
      'degradedReasons',
    ].includes(String(field)))
    ? {
        mode: 'standardApplicationReadiness' as const,
        fields: statusProjectionFields as NonNullable<ApplicationInstallationArtifactContract['statusProjection']>['fields'],
      }
    : undefined;
  return typeof apiVersion === 'string' && typeof kind === 'string' && typeof emitDefaultInstance === 'boolean'
    ? {
        apiVersion,
        kind,
        emitDefaultInstance,
        ...(typeof controlPlaneNamespace === 'string' && controlPlaneNamespace.length > 0 ? { controlPlaneNamespace } : {}),
        ...(statusProjection ? { statusProjection } : {}),
      }
    : undefined;
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
