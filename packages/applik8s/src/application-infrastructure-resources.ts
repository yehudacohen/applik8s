// typecast-file-boundary: provider configuration is validated by constructors and JSON-normalized before graph projection.
import type {
  ApplicationExposureReadinessContract,
  ApplicationGeneratedResourceContract,
  JsonValue,
} from '@applik8s/core';
import { Cel, externalRef } from 'typekro';
import { certificate as typeKroCertificate } from 'typekro/cert-manager';
import { configMap as typeKroConfigMap, ingress as typeKroIngress, secret as typeKroSecret, service as typeKroService } from 'typekro/kubernetes';
import type {
  ApplicationConfigBinding,
  ApplicationConfigOptions,
  ApplicationExposureBinding,
  ApplicationExposureOptions,
  ApplicationSecretBinding,
  ApplicationSecretOptions,
} from './application.js';
import { serializeApplicationCallback } from './application-callback.js';
import {
  applicationConfigLabels,
  applicationExposureServiceName,
  applicationExposureServiceNamespace,
  applicationExposureServicePort,
  applicationExternalDnsAnnotations,
  applicationLegacyTlsMode,
  normalizeApplicationTlsIntent,
} from './application-exposure.js';
import { type ApplicationGraphState, addApplicationGraphEdge, addApplicationGraphNode } from './application-graph-state.js';
import { graphResourceId, kubernetesNameSegment } from './application-identifiers.js';
import {
  type ApplicationHttpExposureProvider,
  type ApplicationProviderState,
  type ApplicationTypedProviderContract,
  type ApplicationValkeyIndexBackend,
  applicationCertificateImplementation,
  applicationDnsPublicationImplementation,
  applicationHttpExposureImplementation,
  applicationProviderImplementationName,
  applicationProviderInterface,
  applicationTypedProviderContract,
  isIngressHttpExposureProvider,
  isNodePortHttpExposureProvider,
} from './application-providers.js';
import { applicationTypeKroExpressionValue, applicationTypeKroGraphValue, applicationTypeKroString, applicationTypeKroValueIdentity, applyApplicationTypeKroIncludeWhen } from './application-typekro-values.js';

export interface ApplicationInfrastructureState extends ApplicationGraphState, ApplicationProviderState {
  readonly emittedIndexStores: Set<string>;
}

export function emitApplicationConfig(
  state: ApplicationInfrastructureState,
  name: string,
  options: ApplicationConfigOptions,
): ApplicationConfigBinding {
  const resourceName = options.configMapName ?? `${kubernetesNameSegment(name)}-config`;
  const key = options.key ?? kubernetesNameSegment(name);
  const namespace = options.namespace;
  const nodeId = applicationGraphNodeId('config', name);
  const resource = { apiVersion: 'v1', kind: 'ConfigMap', name: resourceName, ...(namespace ? { namespace } : {}) };
  typeKroConfigMap({
    id: graphResourceId(resourceName, 'applicationConfig'),
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name: resourceName, ...(namespace ? { namespace } : {}), labels: applicationConfigLabels(name, 'config') },
    data: { [key]: options.value ?? '' },
  });
  addApplicationGraphNode(state, {
    id: nodeId,
    kind: 'config',
    name,
    stability: 'stable',
    provider: 'ConfigMap',
    key,
    ...(options.env ? { env: options.env } : {}),
    ...(options.mountPath ? { mountPath: options.mountPath } : {}),
    generatedResources: [{ role: 'config', graphNode: { nodeId }, resource, artifact: { kind: 'kubernetesManifest', name: resourceName } }],
  });
  return {
    kind: 'applicationConfig', name, provider: 'ConfigMap', resourceName, ...(namespace ? { namespace } : {}), key,
    ...(options.env ? { env: options.env } : {}),
    ...(options.mountPath ? { mountPath: options.mountPath } : {}),
    diagnosticsPath: `config/${name}`,
  };
}

export function emitApplicationSecret(
  state: ApplicationInfrastructureState,
  name: string,
  options: ApplicationSecretOptions,
): ApplicationSecretBinding {
  const resourceName = options.secretName ?? `${kubernetesNameSegment(name)}-secret`;
  const key = options.key ?? kubernetesNameSegment(name);
  const namespace = options.namespace;
  const redaction = options.redaction ?? 'required';
  const ownership = options.ownership ?? (options.secretName ? 'external' : 'generated');
  const nodeId = applicationGraphNodeId('secret', name);
  const resource = { apiVersion: 'v1', kind: 'Secret', name: resourceName, ...(namespace ? { namespace } : {}) };
  if (ownership === 'generated') {
    typeKroSecret({
      id: graphResourceId(resourceName, 'applicationSecret'),
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: { name: resourceName, ...(namespace ? { namespace } : {}), labels: applicationConfigLabels(name, 'secret') },
      type: 'Opaque',
    });
  }
  addApplicationGraphNode(state, {
    id: nodeId,
    kind: 'secret',
    name,
    stability: 'stable',
    provider: 'Secret',
    ownership,
    key,
    redaction,
    ...(options.env ? { env: options.env } : {}),
    ...(options.mountPath ? { mountPath: options.mountPath } : {}),
    generatedResources: ownership === 'generated'
      ? [{ role: 'secret', graphNode: { nodeId }, resource, artifact: { kind: 'kubernetesManifest', name: resourceName } }]
      : [],
  });
  return {
    kind: 'applicationSecret', name, provider: 'Secret', resourceName, ...(namespace ? { namespace } : {}), key,
    ownership, redaction,
    ...(options.env ? { env: options.env } : {}),
    ...(options.mountPath ? { mountPath: options.mountPath } : {}),
    diagnosticsPath: `secret/${name}`,
  };
}

export function emitApplicationExposure(
  state: ApplicationInfrastructureState,
  name: string,
  options: ApplicationExposureOptions,
): ApplicationExposureBinding {
  const provider = applicationHttpExposureImplementation(options.provider)
    ?? applicationHttpExposureImplementation(state.providers.expose)
    ?? applicationHttpExposureImplementation(state.defaults.expose)
    ?? { kind: 'ingress' } satisfies ApplicationHttpExposureProvider;
  if (options.gateway) {
    throw new Error(`app.expose(${JSON.stringify(name)}, ...) Gateway API exposure is not enabled yet. Use Ingress-backed exposure with service and hostnames, or keep Gateway semantics explicit until Gateway contracts are implemented.`);
  }
  const exposedService = applicationExposureServiceName(options.service);
  const exposedNamespace = applicationExposureServiceNamespace(options.service) ?? options.namespace;
  if (options.service && typeof options.service === 'object' && 'kind' in options.service && options.service.kind === 'applicationGateway' && !exposedService) {
    throw new Error(`app.expose(${JSON.stringify(name)}, ...) cannot target runtime-only gateway ${JSON.stringify(options.service.name)}. Add gateway deployment options so Applik8s can materialize and expose its Service.`);
  }
  if (!exposedService) throw new Error(`app.expose(${JSON.stringify(name)}, ...) requires an explicit generated Service target.`);
  if (isNodePortHttpExposureProvider(provider)) {
    return emitApplicationNodePortExposure(state, name, options, provider, exposedService, exposedNamespace);
  }
  if (!isIngressHttpExposureProvider(provider)) {
    throw new Error(`app.expose(${JSON.stringify(name)}, ...) received an unsupported HttpExposure provider.`);
  }
  if (!options.hostnames || options.hostnames.length === 0) {
    throw new Error(`app.expose(${JSON.stringify(name)}, ...) requires at least one hostname so generated Ingress exposure does not broaden traffic accidentally.`);
  }
  const resourceName = `${kubernetesNameSegment(name)}-ingress`;
  const namespace = exposedNamespace;
  const hostnames = options.hostnames.map((hostname) => applicationTypeKroString(hostname));
  const nodeId = applicationGraphNodeId('exposure', name);
  const resource = { apiVersion: 'networking.k8s.io/v1', kind: 'Ingress', name: resourceName, ...(namespace ? { namespace } : {}) };
  const tlsIntent = normalizeApplicationTlsIntent(name, options);
  const dnsIntent = options.dns ?? { mode: 'disabled' };
  const certificateProvider = tlsIntent.mode === 'managed'
    ? applicationCertificateImplementation(state.providers.certificates) ?? applicationCertificateImplementation(state.defaults.certificates)
    : undefined;
  const dnsProvider = dnsIntent.mode === 'managed'
    ? applicationDnsPublicationImplementation(state.providers.dns) ?? applicationDnsPublicationImplementation(state.defaults.dns)
    : undefined;
  if (tlsIntent.mode === 'managed' && !certificateProvider) {
    throw new Error(`app.expose(${JSON.stringify(name)}, ...) with tls: { mode: "managed" } requires a Certificate provider.`);
  }
  if (dnsIntent.mode === 'managed' && !dnsProvider) {
    throw new Error(`app.expose(${JSON.stringify(name)}, ...) with dns: { mode: "managed" } requires a DnsPublication provider.`);
  }
  ensureProviderGraph(state, 'HttpExposure', options.provider ? 'provided' : 'generated', provider);
  if (certificateProvider) ensureProviderGraph(state, 'Certificate', 'provided', certificateProvider);
  if (dnsProvider) ensureProviderGraph(state, 'DnsPublication', 'provided', dnsProvider);
  const ingressClassName = options.ingressClassName ?? (typeof provider === 'object' ? provider.ingressClassName : undefined);
  const annotations = {
    ...(ingressClassName ? { 'kubernetes.io/ingress.class': ingressClassName } : {}),
    ...(dnsProvider ? applicationExternalDnsAnnotations(dnsProvider, hostnames, dnsIntent) : {}),
  };
  const ingress = typeKroIngress({
    id: graphResourceId(resourceName, 'applicationExposure'),
    apiVersion: 'networking.k8s.io/v1',
    kind: 'Ingress',
    metadata: {
      name: resourceName,
      ...(namespace ? { namespace } : {}),
      labels: applicationConfigLabels(name, 'exposure'),
      ...(Object.keys(annotations).length > 0 ? { annotations } : {}),
    },
    spec: {
      ...(ingressClassName ? { ingressClassName } : {}),
      rules: hostnames.map((host) => ({
        host,
        http: {
          paths: [{
            path: options.path ?? '/',
            pathType: 'Prefix',
            backend: { service: { name: exposedService, port: { number: options.servicePort ?? applicationExposureServicePort(options.service) ?? 80 } } },
          }],
        },
      })),
      ...(tlsIntent.mode !== 'disabled' ? { tls: [{ hosts: hostnames, secretName: tlsIntent.secretName }] } : {}),
    },
  });
  ingress.withReadyWhen(Cel.expr<boolean>('true'));
  applyApplicationTypeKroIncludeWhen(ingress, options.enabled ?? true);
  const generatedResources: ApplicationGeneratedResourceContract[] = [
    { role: 'exposure', graphNode: { nodeId }, resource, artifact: { kind: 'kubernetesManifest', name: resourceName } },
  ];
  if (tlsIntent.mode === 'managed' && certificateProvider) {
    const certificateName = `${kubernetesNameSegment(name)}-certificate`;
    const certificateResource = { apiVersion: 'cert-manager.io/v1', kind: 'Certificate', name: certificateName, ...(namespace ? { namespace } : {}) };
    const certificate = typeKroCertificate({
      id: graphResourceId(certificateName, 'applicationCertificate'),
      name: certificateName,
      ...(namespace ? { namespace } : {}),
      spec: {
        secretName: tlsIntent.secretName,
        dnsNames: hostnames,
        issuerRef: certificateProvider.issuerRef,
        ...(certificateProvider.duration ? { duration: certificateProvider.duration } : {}),
        ...(certificateProvider.renewBefore ? { renewBefore: certificateProvider.renewBefore } : {}),
      },
    });
    applyApplicationTypeKroIncludeWhen(certificate, options.enabled ?? true);
    generatedResources.push({
      role: 'exposure',
      graphNode: { nodeId },
      resource: certificateResource,
      artifact: { kind: 'typeKroResource', name: certificateName },
      dependsOn: [{ nodeId: applicationProviderNodeId('Certificate') }],
    });
  }
  const tls = applicationLegacyTlsMode(options.tls, tlsIntent);
  const publicUrl = applicationTypeKroString(tlsIntent.mode === 'disabled' ? 'http://' : 'https://', hostnames[0]);
  const readiness: ApplicationExposureReadinessContract = {
    ingress: 'resourceApplied',
    service: 'notRequested',
    loadBalancer: 'statusObserved',
    certificate: tlsIntent.mode === 'managed' ? 'readyCondition' : tlsIntent.mode === 'external' ? 'external' : 'notRequested',
    dns: dnsIntent.mode === 'managed' ? 'propagationUnverified' : 'notRequested',
    publicUrl: 'derived',
  };
  const graphTlsIntent = (() => {
    if (tlsIntent.mode !== 'managed') return tlsIntent;
    if (!certificateProvider) {
      throw new Error(`app.expose(${JSON.stringify(name)}, ...) lost its managed Certificate provider during graph lowering.`);
    }
    return { ...tlsIntent, issuerRef: certificateProvider.issuerRef };
  })();
  addApplicationGraphNode(state, {
    id: nodeId,
    kind: 'exposure',
    name,
    stability: 'stable',
    ...(options.enabled === undefined ? {} : { enabled: applicationTypeKroGraphValue(options.enabled) as boolean | `\${${string}}` }),
    provider: { interface: 'HttpExposure', nodeId: applicationProviderNodeId('HttpExposure') },
    service: exposedService,
    hostnames,
    tls,
    tlsIntent: graphTlsIntent,
    dnsIntent,
    publicUrl,
    transport: { kind: 'ingress', ...(ingressClassName ? { ingressClassName } : {}) },
    readiness,
    ...(certificateProvider ? { certificate: { interface: 'Certificate', nodeId: applicationProviderNodeId('Certificate') } } : {}),
    ...(dnsProvider ? { dnsPublication: { interface: 'DnsPublication', nodeId: applicationProviderNodeId('DnsPublication') } } : {}),
    generatedResources,
  });
  addApplicationGraphEdge(state, { from: { nodeId: applicationProviderNodeId('HttpExposure') }, to: { nodeId }, relationship: 'provides' });
  if (certificateProvider) addApplicationGraphEdge(state, { from: { nodeId: applicationProviderNodeId('Certificate') }, to: { nodeId }, relationship: 'provides' });
  if (dnsProvider) addApplicationGraphEdge(state, { from: { nodeId: applicationProviderNodeId('DnsPublication') }, to: { nodeId }, relationship: 'provides' });
  return {
    kind: 'applicationExposure', name, provider: 'HttpExposure', resourceName, ...(namespace ? { namespace } : {}), hostnames,
    tls, tlsIntent, dnsIntent, publicUrl, readiness, statusPath: `exposure/${name}`,
  };
}

function emitApplicationNodePortExposure(
  state: ApplicationInfrastructureState,
  name: string,
  options: ApplicationExposureOptions,
  provider: import('./application-providers.js').ApplicationNodePortHttpExposureProvider,
  exposedService: string,
  namespace: string | undefined,
): ApplicationExposureBinding {
  if (!options.service || typeof options.service !== 'object' || !('kind' in options.service) || options.service.kind !== 'applicationHost') {
    throw new Error(`app.expose(${JSON.stringify(name)}, ...) with HttpExposure.nodePort(...) requires an ApplicationHost binding.`);
  }
  const tlsIntent = normalizeApplicationTlsIntent(name, options);
  const dnsIntent = options.dns ?? { mode: 'disabled' };
  if (tlsIntent.mode !== 'disabled') throw new Error(`app.expose(${JSON.stringify(name)}, ...) with HttpExposure.nodePort(...) cannot terminate TLS.`);
  if (dnsIntent.mode !== 'disabled') throw new Error(`app.expose(${JSON.stringify(name)}, ...) with HttpExposure.nodePort(...) cannot publish DNS.`);
  ensureProviderGraph(state, 'HttpExposure', options.provider ? 'provided' : 'generated', provider);
  const host = provider.host.includes(':') && !provider.host.startsWith('[') ? `[${provider.host}]` : provider.host;
  const publicUrl = applicationTypeKroString('http://', host, ':', provider.nodePort);
  const hostnames = options.hostnames?.length
    ? options.hostnames.map((hostname) => applicationTypeKroString(hostname))
    : [provider.host];
  const nodeId = applicationGraphNodeId('exposure', name);
  const resourceName = `${kubernetesNameSegment(name)}-node-port`;
  const selector = {
    'app.kubernetes.io/name': exposedService,
    'app.kubernetes.io/component': 'application-host',
  };
  const service = typeKroService({
    id: graphResourceId(resourceName, 'applicationExposure'),
    apiVersion: 'v1',
    kind: 'Service',
    metadata: {
      name: resourceName,
      ...(namespace ? { namespace } : {}),
      labels: applicationConfigLabels(name, 'exposure'),
      annotations: { 'applik8s.dev/public-url': publicUrl },
    },
    spec: {
      type: 'NodePort',
      selector,
      ports: [{
        name: 'http',
        port: options.servicePort ?? applicationExposureServicePort(options.service) ?? 80,
        targetPort: 'http',
        // typecast-boundary: TypeKro accepts a schema-derived numeric proxy at
        // serialization time even though the generated Kubernetes type names
        // this field as a concrete number.
        nodePort: provider.nodePort as number,
      }],
    },
  });
  applyApplicationTypeKroIncludeWhen(service, options.enabled ?? true);
  const readiness: ApplicationExposureReadinessContract = {
    ingress: 'notRequested', service: 'resourceApplied', loadBalancer: 'notRequested', certificate: 'notRequested', dns: 'notRequested', publicUrl: 'derived',
  };
  addApplicationGraphNode(state, {
    id: nodeId,
    kind: 'exposure',
    name,
    stability: 'stable',
    ...(options.enabled === undefined ? {} : { enabled: applicationTypeKroGraphValue(options.enabled) as boolean | `\${${string}}` }),
    provider: { interface: 'HttpExposure', nodeId: applicationProviderNodeId('HttpExposure') },
    service: exposedService,
    hostnames,
    tls: 'disabled',
    tlsIntent,
    dnsIntent,
    publicUrl,
    transport: {
      kind: 'node-port',
      host: provider.host,
      nodePort: typeof provider.nodePort === 'number'
        ? provider.nodePort
        : applicationTypeKroGraphValue(applicationTypeKroString(provider.nodePort)) as `\${${string}}`,
    },
    readiness,
    generatedResources: [{
      role: 'exposure',
      graphNode: { nodeId },
      resource: { apiVersion: 'v1', kind: 'Service', name: resourceName, ...(namespace ? { namespace } : {}) },
      artifact: { kind: 'kubernetesManifest', name: resourceName },
    }],
  });
  addApplicationGraphEdge(state, { from: { nodeId: applicationProviderNodeId('HttpExposure') }, to: { nodeId }, relationship: 'provides' });
  return {
    kind: 'applicationExposure', name, provider: 'HttpExposure', resourceName, ...(namespace ? { namespace } : {}),
    hostnames, tls: 'disabled', tlsIntent, dnsIntent, publicUrl, readiness, statusPath: `exposure/${name}`,
  };
}

export function recordApplicationProviderGraph(
  state: ApplicationInfrastructureState,
  tokenName: string | undefined,
  bindingKind: string,
  implementation: unknown,
  typedContract?: ApplicationTypedProviderContract,
): void {
  const resolvedContract = typedContract ?? applicationTypedProviderContract(tokenName);
  const providerInterface = applicationProviderInterface(tokenName) ?? resolvedContract?.interface;
  if (!providerInterface) return;
  const requestIdentityAuthentication = tokenName === 'RequestIdentity'
    && implementation && typeof implementation === 'object'
    && typeof Reflect.get(implementation, 'authenticate') === 'function'
    ? serializeApplicationCallback({
        registrar: 'RequestIdentity', argumentIndex: 0, property: 'authenticate', label: 'RequestIdentity authentication',
        callback: Reflect.get(implementation, 'authenticate') as (...args: never[]) => unknown,
        allowDeferredResolution: true,
      })
    : undefined;
  const nodeId = applicationProviderNodeId(providerInterface);
  addApplicationGraphNode(state, {
    id: nodeId,
    kind: 'provider',
    name: providerInterface,
    stability: 'stable',
    interface: providerInterface,
    implementation: applicationProviderImplementationName(implementation),
    ...(resolvedContract ? {
      contract: {
        ...resolvedContract,
        surface: !applicationProviderInterface(providerInterface) ? 'experimentalSurface' : 'stablePublicApi',
        support: 'implemented',
        implementation: { name: applicationProviderImplementationName(implementation) },
        diagnostics: [],
      },
    } : {}),
    config: {
      bindingKind,
      provider: applicationProviderImplementationName(implementation),
      ...(requestIdentityAuthentication ? {
        identity: applicationTypeKroGraphValue({
          authenticationSource: requestIdentityAuthentication.source,
          ...(requestIdentityAuthentication.dependencies ? { authenticationDependencies: requestIdentityAuthentication.dependencies } : {}),
          ...(requestIdentityAuthentication.location ? { authenticationLocation: requestIdentityAuthentication.location } : {}),
          ...(requestIdentityAuthentication.unresolved ? { authenticationUnresolved: requestIdentityAuthentication.unresolved } : {}),
        }) as JsonValue,
      } : {}),
      ...(tokenName === 'RequestIdentity' && implementation && typeof implementation === 'object' && Reflect.get(implementation, 'infrastructure')
        ? { identityInfrastructure: applicationTypeKroGraphValue(Reflect.get(implementation, 'infrastructure')) as JsonValue }
        : {}),
      ...(tokenName === 'ApplicationHost' && implementation && typeof implementation === 'object'
        ? { host: applicationTypeKroGraphValue(implementation) as JsonValue }
        : {}),
      ...(tokenName === 'ModelStore' && implementation && typeof implementation === 'object'
        ? { modelStore: applicationTypeKroGraphValue(implementation) as JsonValue }
        : {}),
      ...(tokenName === 'ContainerRegistry' && implementation && typeof implementation === 'object'
        ? { containerRegistry: applicationTypeKroGraphValue(implementation) as JsonValue }
        : {}),
      ...(tokenName === 'IndexStore' && implementation && typeof implementation === 'object'
        ? { indexStore: applicationTypeKroGraphValue(implementation) as JsonValue }
        : {}),
      ...(tokenName === 'ObjectStorage' && implementation && typeof implementation === 'object' && Reflect.get(implementation, 'kind') === 's3'
        ? { objectStorage: applicationTypeKroGraphValue(implementation) as JsonValue }
        : {}),
      ...(tokenName === 'ProjectionStore' && implementation && typeof implementation === 'object' && Reflect.get(implementation, 'kind') === 'clickhouse'
        ? { projectionStore: applicationTypeKroGraphValue(implementation) as JsonValue }
        : {}),
    },
  });
}

export function emitProvidedApplicationIndexStore(
  state: ApplicationInfrastructureState,
  applicationName: string,
  applicationNamespace: string | undefined,
  implementation: unknown,
): void {
  const backend = implementation === 'valkey'
    ? { kind: 'valkey' } satisfies ApplicationValkeyIndexBackend
    : implementation && typeof implementation === 'object' && Reflect.get(implementation, 'kind') === 'valkey'
      ? implementation as ApplicationValkeyIndexBackend
      : undefined;
  const dynamicHost = applicationTypeKroExpressionValue(backend?.host);
  if (!backend || backend.provision === false || (backend.host && !dynamicHost) || backend.provisioner !== 'hyperspike') return;
  const namespace = backend.namespace ?? applicationNamespace ?? 'default';
  const name = backend.name ?? `${kubernetesNameSegment(applicationName)}-index`;
  const key = `${applicationTypeKroValueIdentity(namespace)}:${name}`;
  if (state.emittedIndexStores.has(key)) return;
  state.emittedIndexStores.add(key);
  const reference = externalRef({
    apiVersion: 'hyperspike.io/v1',
    kind: 'Valkey',
    metadata: { name, namespace },
    id: graphResourceId(applicationName, 'providedValkeyIndex'),
  });
  applyApplicationTypeKroIncludeWhen(reference, backend.provision ?? true);
}

export function recordApplicationTypeKroResourceGraph(state: ApplicationInfrastructureState, resource: unknown, declaredName?: string): void {
  const ref = applicationTypeKroResourceRef(resource);
  if (!ref) {
    const composition = applicationTypeKroNestedCompositionRef(resource, declaredName);
    if (!composition) {
      throw new Error('app.infra(...) requires a TypeKro/Kubernetes resource or a called TypeKro composition. Use the callback form so resources are recreated inside graph materialization.');
    }
    addApplicationGraphNode(state, {
      id: applicationGraphNodeId('typeKroResource', composition.name),
      kind: 'typeKroResource',
      name: composition.name,
      stability: 'experimental',
      resource: {
        apiVersion: 'typekro.dev/v1alpha1',
        kind: 'NestedComposition',
        name: composition.name,
      },
    });
    return;
  }
  addApplicationGraphNode(state, {
    id: applicationGraphNodeId('typeKroResource', ref.name ?? ref.kind),
    kind: 'typeKroResource',
    name: ref.name ?? ref.kind,
    stability: 'experimental',
    resource: ref,
  });
}

function applicationTypeKroNestedCompositionRef(resource: unknown, declaredName?: string): { readonly name: string } | undefined {
  if (!applicationTypeKroObjectLike(resource)) return undefined;
  const compositionId = Reflect.get(resource, '__compositionId');
  const resources = Reflect.get(resource, '__resources');
  if (typeof compositionId !== 'string' || !compositionId.trim() || !Array.isArray(resources)) return undefined;
  const spec = Reflect.get(resource, 'spec');
  const specName = applicationTypeKroObjectLike(spec) && typeof Reflect.get(spec, 'name') === 'string'
    ? Reflect.get(spec, 'name') as string
    : undefined;
  const compositionName = compositionId.replace(/-call-\d+$/, '');
  return { name: kubernetesNameSegment(declaredName?.trim() || (specName ? `${compositionName}-${specName}` : compositionName)) };
}

function applicationTypeKroResourceRef(resource: unknown): { readonly apiVersion: string; readonly kind: string; readonly name?: string; readonly namespace?: string } | undefined {
  if (!resource || typeof resource !== 'object') return undefined;
  const apiVersion = Reflect.get(resource, 'apiVersion');
  const kind = Reflect.get(resource, 'kind');
  const metadata = Reflect.get(resource, 'metadata');
  const name = applicationTypeKroResourceIdentity(applicationTypeKroObjectLike(metadata) ? Reflect.get(metadata, 'name') : undefined);
  const namespace = applicationTypeKroResourceIdentity(applicationTypeKroObjectLike(metadata) ? Reflect.get(metadata, 'namespace') : undefined);
  if (typeof apiVersion !== 'string' || typeof kind !== 'string' || !name) return undefined;
  return { apiVersion, kind, name, ...(namespace ? { namespace } : {}) };
}

function applicationTypeKroResourceIdentity(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  if (applicationTypeKroBrand(value, 'TypeKro.KubernetesRef')) {
    const resourceId = Reflect.get(value, 'resourceId');
    const fieldPath = Reflect.get(value, 'fieldPath');
    if (resourceId === '__schema__' && typeof fieldPath === 'string' && fieldPath.trim()) return `schema.${fieldPath}`;
    if (typeof resourceId === 'string' && resourceId.trim() && typeof fieldPath === 'string' && fieldPath.trim()) return `${resourceId}.${fieldPath}`;
  }
  if (applicationTypeKroBrand(value, 'TypeKro.CelExpression')) {
    const expression = Reflect.get(value, 'expression');
    if (typeof expression === 'string' && expression.trim()) return `cel:${expression}`;
  }
  return undefined;
}

function applicationTypeKroBrand(value: unknown, key: string): value is object {
  return applicationTypeKroObjectLike(value) && Reflect.get(value, Symbol.for(key)) === true;
}

function applicationTypeKroObjectLike(value: unknown): value is object {
  return (typeof value === 'object' || typeof value === 'function') && value !== null;
}

function ensureProviderGraph(state: ApplicationInfrastructureState, tokenName: string, bindingKind: string, implementation: unknown): void {
  if (!state.graphNodes.some((node) => node.id === applicationProviderNodeId(tokenName))) {
    recordApplicationProviderGraph(state, tokenName, bindingKind, implementation);
  }
}

function applicationProviderNodeId(providerInterface: string): string {
  return applicationGraphNodeId('provider', providerInterface);
}

function applicationGraphNodeId(kind: string, name: string): string {
  return `${kind}.${kubernetesNameSegment(name)}`;
}
