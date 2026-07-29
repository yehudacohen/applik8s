// typecast-file-boundary: the observer validates untyped Kubernetes status payloads before projecting typed readiness.
import type { ResolvedApplicationContainerRegistry } from '@applik8s/applik8s/deployment-registry';
import type { DeploymentJsonObject } from '@applik8s/deployment-contract';
import { makeKubernetesApiClient } from './kubernetes-api-client.js';

export interface ApplicationDeploymentObserverIo {
  stdout(message: string): void;
}

export interface ObservedApplicationInstance {
  readonly apiVersion: string;
  readonly kind: string;
  readonly name: string;
  readonly namespace: string;
}

export interface ApplicationInstallationReadiness {
  readonly state: 'pending' | 'ready' | 'failed';
  readonly summary: string;
  readonly url?: string;
}

/**
 * Read the currently admitted installation spec before planning a profile
 * transition. A missing CRD or object means this is a fresh installation;
 * malformed live state fails closed.
 */
export async function readApplicationInstanceSpec(
  context: string,
  instance: ObservedApplicationInstance,
): Promise<DeploymentJsonObject | undefined> {
  const [group, version] = instance.apiVersion.split('/');
  if (!group || !version) {
    throw new Error(
      `Application instance apiVersion ${instance.apiVersion} is not a grouped Kubernetes API version.`,
    );
  }
  // static-import-exception: Kubernetes observation belongs only in the Node deployment host.
  const kubernetes = await import('@kubernetes/client-node');
  const kubeConfig = new kubernetes.KubeConfig();
  kubeConfig.loadFromDefault();
  kubeConfig.setCurrentContext(context);
  const extensions = makeKubernetesApiClient(
    kubeConfig,
    kubernetes.ApiextensionsV1Api,
  );
  const crds = await extensions.listCustomResourceDefinition({});
  const crd = crds.items.find(
    (candidate) =>
      candidate.spec.group === group
      && candidate.spec.names.kind === instance.kind
      && candidate.spec.versions.some(
        (candidateVersion) =>
          candidateVersion.name === version && candidateVersion.served,
      ),
  );
  const plural = crd?.spec.names.plural;
  if (!plural) return undefined;
  const customObjects = makeKubernetesApiClient(
    kubeConfig,
    kubernetes.CustomObjectsApi,
  );
  const resource = await customObjects
    .getNamespacedCustomObject({
      group,
      version,
      namespace: instance.namespace,
      plural,
      name: instance.name,
    })
    .catch((cause: unknown) => {
      if (kubernetesStatusCode(cause) === 404) return undefined;
      throw cause;
    });
  if (!resource) return undefined;
  return applicationInstanceSpec(resource, instance);
}

export function applicationInstanceSpec(
  resource: unknown,
  instance: ObservedApplicationInstance,
): DeploymentJsonObject {
  if (!resource || typeof resource !== 'object' || Array.isArray(resource)) {
    throw new Error(
      `Live ${instance.apiVersion}/${instance.kind}/${instance.namespace}/${instance.name} is not a JSON object.`,
    );
  }
  const spec = Reflect.get(resource, 'spec');
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error(
      `Live ${instance.apiVersion}/${instance.kind}/${instance.namespace}/${instance.name} has no JSON object spec.`,
    );
  }
  assertDeploymentJson(spec, 'live installation spec');
  // typecast-boundary: assertDeploymentJson recursively rejected every
  // non-JSON value and the object/array root distinction is checked above.
  return spec as DeploymentJsonObject;
}

/** Reject stale instance readiness until KRO accepts the exact graph generation just applied. */
export function resourceGraphDefinitionReadiness(value: unknown): ApplicationInstallationReadiness {
  if (!value || typeof value !== 'object') return { state: 'pending', summary: 'ResourceGraphDefinition has not been observed yet' };
  const metadata = Reflect.get(value, 'metadata');
  const status = Reflect.get(value, 'status');
  const generation = metadata && typeof metadata === 'object' ? Reflect.get(metadata, 'generation') : undefined;
  if (!status || typeof status !== 'object' || typeof generation !== 'number') {
    return { state: 'pending', summary: 'ResourceGraphDefinition status has not been projected yet' };
  }
  const conditions = Array.isArray(Reflect.get(status, 'conditions')) ? Reflect.get(status, 'conditions') as readonly unknown[] : [];
  const current = conditions.filter((condition): condition is object => {
    if (!condition || typeof condition !== 'object') return false;
    return Reflect.get(condition, 'observedGeneration') === generation;
  });
  const rejected = current.find((condition) => Reflect.get(condition, 'type') === 'GraphAccepted'
    && Reflect.get(condition, 'status') === 'False');
  if (rejected && typeof rejected === 'object') {
    const reason = Reflect.get(rejected, 'reason');
    const message = Reflect.get(rejected, 'message');
    return {
      state: 'failed',
      summary: [typeof reason === 'string' ? reason : 'InvalidResourceGraph', typeof message === 'string' ? message : undefined]
        .filter(Boolean)
        .join(': '),
    };
  }
  const accepted = current.some((condition) => Reflect.get(condition, 'type') === 'GraphAccepted'
    && Reflect.get(condition, 'status') === 'True');
  const ready = current.some((condition) => Reflect.get(condition, 'type') === 'Ready'
    && Reflect.get(condition, 'status') === 'True');
  if (accepted && ready) return { state: 'ready', summary: `generation ${generation} accepted` };
  const currentFailure = current.find((condition) => Reflect.get(condition, 'status') === 'False'
    && ['Ready', 'GraphRevisionsResolved'].includes(String(Reflect.get(condition, 'type'))));
  const reason = currentFailure && typeof currentFailure === 'object' ? Reflect.get(currentFailure, 'reason') : undefined;
  const message = currentFailure && typeof currentFailure === 'object' ? Reflect.get(currentFailure, 'message') : undefined;
  return {
    state: 'pending',
    summary: [typeof reason === 'string' ? reason : `waiting for generation ${generation}`, typeof message === 'string' ? message : undefined]
      .filter(Boolean)
      .join(': '),
  };
}

/** Interpret only the public, KRO-owned installation status contract. */
export function applicationInstallationReadiness(value: unknown): ApplicationInstallationReadiness {
  if (!value || typeof value !== 'object') return { state: 'pending', summary: 'status has not been projected yet' };
  const metadata = Reflect.get(value, 'metadata');
  const generation = metadata && typeof metadata === 'object' && typeof Reflect.get(metadata, 'generation') === 'number'
    ? Reflect.get(metadata, 'generation') as number
    : undefined;
  const status = Reflect.get(value, 'status');
  if (!status || typeof status !== 'object') return { state: 'pending', summary: 'status has not been projected yet' };
  const phase = Reflect.get(status, 'phase');
  const kroState = Reflect.get(status, 'state');
  const declaredReady = Reflect.get(status, 'ready');
  const url = typeof Reflect.get(status, 'url') === 'string' ? Reflect.get(status, 'url') as string : undefined;
  const conditions = Array.isArray(Reflect.get(status, 'conditions')) ? Reflect.get(status, 'conditions') as readonly unknown[] : [];
  const readyCondition = conditions.find((condition) => condition && typeof condition === 'object'
    && Reflect.get(condition, 'type') === 'Ready');
  const readyObservedGeneration = readyCondition && typeof readyCondition === 'object'
    ? Reflect.get(readyCondition, 'observedGeneration')
    : undefined;
  if (generation !== undefined && typeof readyObservedGeneration === 'number' && readyObservedGeneration !== generation) {
    return {
      state: 'pending',
      summary: `Ready condition observes generation ${readyObservedGeneration}; waiting for generation ${generation}`,
      ...(url ? { url } : {}),
    };
  }
  const failedCondition = conditions.find((condition) => condition && typeof condition === 'object'
    && Reflect.get(condition, 'type') === 'Failed'
    && Reflect.get(condition, 'status') === 'True'
    && (generation === undefined || Reflect.get(condition, 'observedGeneration') === undefined || Reflect.get(condition, 'observedGeneration') === generation));
  if (phase === 'Failed' || kroState === 'ERROR' || kroState === 'FAILED' || failedCondition) {
    const reason = failedCondition && typeof failedCondition === 'object' ? Reflect.get(failedCondition, 'reason') : undefined;
    const message = failedCondition && typeof failedCondition === 'object' ? Reflect.get(failedCondition, 'message') : undefined;
    return {
      state: 'failed',
      summary: [typeof reason === 'string' ? reason : 'ApplicationFailed', typeof message === 'string' ? message : undefined].filter(Boolean).join(': '),
      ...(url ? { url } : {}),
    };
  }
  const providerStatus = Reflect.get(status, 'providerStatus');
  const pendingProviders = providerStatus && typeof providerStatus === 'object'
    ? Object.entries(providerStatus)
      .filter(([, state]) => state !== 'Ready' && state !== 'NotConfigured')
      .map(([name]) => name)
      .sort()
    : [];
  const rolloutStatus = Reflect.get(status, 'rolloutStatus');
  const rolloutPending = typeof rolloutStatus === 'string' && !['Ready', 'Current'].includes(rolloutStatus);
  const declaredPhasePending = typeof phase === 'string' && phase !== 'Ready';
  if (declaredReady === true && !declaredPhasePending && pendingProviders.length === 0 && !rolloutPending) {
    return { state: 'ready', summary: typeof phase === 'string' ? phase : 'Ready', ...(url ? { url } : {}) };
  }
  if (declaredReady === undefined && readyCondition && typeof readyCondition === 'object'
    && Reflect.get(readyCondition, 'status') === 'True'
    && (kroState === undefined || kroState === 'ACTIVE')) {
    return {
      state: 'ready',
      summary: typeof phase === 'string' ? phase : 'Ready',
      ...(url ? { url } : {}),
    };
  }
  const pending = [...pendingProviders, ...(rolloutPending ? ['rollout'] : [])].sort();
  return {
    state: 'pending',
    summary: pending.length > 0
      ? `${typeof phase === 'string' ? phase : 'Installing'}; pending: ${pending.join(', ')}`
      : typeof phase === 'string'
        ? phase
        : readyCondition && typeof readyCondition === 'object'
          ? [Reflect.get(readyCondition, 'reason'), Reflect.get(readyCondition, 'message')].filter((entry): entry is string => typeof entry === 'string' && entry.length > 0).join(': ') || 'status is not ready'
          : typeof kroState === 'string' ? kroState : 'status is not ready',
    ...(url ? { url } : {}),
  };
}

export async function waitForApplicationInstanceReadiness(
  context: string,
  instance: ObservedApplicationInstance,
  io: ApplicationDeploymentObserverIo,
  timeoutMs = 10 * 60_000,
): Promise<ApplicationInstallationReadiness> {
  const stableReadinessMs = 30_000;
  const [group, version] = instance.apiVersion.split('/');
  if (!group || !version) throw new Error(`Application instance apiVersion ${instance.apiVersion} is not a grouped Kubernetes API version.`);
  // static-import-exception: Kubernetes observation belongs only in the Node deployment host.
  const kubernetes = await import('@kubernetes/client-node');
  const kubeConfig = new kubernetes.KubeConfig();
  kubeConfig.loadFromDefault();
  kubeConfig.setCurrentContext(context);
  const extensions = makeKubernetesApiClient(kubeConfig, kubernetes.ApiextensionsV1Api);
  const crds = await extensions.listCustomResourceDefinition({});
  const crd = crds.items.find((candidate) => candidate.spec.group === group
    && candidate.spec.names.kind === instance.kind
    && candidate.spec.versions.some((candidateVersion) => candidateVersion.name === version && candidateVersion.served));
  const plural = crd?.spec.names.plural;
  if (!plural) throw new Error(`No served CRD matches ${instance.apiVersion}/${instance.kind}.`);
  const customObjects = makeKubernetesApiClient(kubeConfig, kubernetes.CustomObjectsApi);
  const startedAt = Date.now();
  let lastReport = 0;
  let lastSummary = '';
  let readySince: number | undefined;
  while (Date.now() - startedAt < timeoutMs) {
    const resource = await customObjects.getNamespacedCustomObject({
      group,
      version,
      namespace: instance.namespace,
      plural,
      name: instance.name,
    }).catch((cause: unknown) => {
      if (kubernetesStatusCode(cause) === 404) return undefined;
      throw cause;
    });
    const readiness = applicationInstallationReadiness(resource);
    if (readiness.state === 'ready') {
      readySince ??= Date.now();
      if (Date.now() - readySince >= stableReadinessMs) return readiness;
      const stableForMs = Date.now() - readySince;
      const summary = `${readiness.summary}; confirming stable reconciliation (${Math.floor(stableForMs / 1_000)}s/${stableReadinessMs / 1_000}s)`;
      if (summary !== lastSummary || Date.now() - lastReport >= 15_000) {
        io.stdout(`Waiting for ${instance.kind}/${instance.name}: ${summary}`);
        lastSummary = summary;
        lastReport = Date.now();
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      continue;
    }
    readySince = undefined;
    if (readiness.state === 'failed') throw new Error(`${instance.kind}/${instance.name} reported terminal failure: ${readiness.summary}`);
    if (readiness.summary !== lastSummary || Date.now() - lastReport >= 15_000) {
      io.stdout(`Waiting for ${instance.kind}/${instance.name}: ${readiness.summary}`);
      lastSummary = readiness.summary;
      lastReport = Date.now();
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${instance.kind}/${instance.name}; last status: ${lastSummary || 'unavailable'}.`);
}

export async function waitForResourceGraphDefinitionReadiness(
  context: string,
  name: string,
  io: ApplicationDeploymentObserverIo,
  timeoutMs = 2 * 60_000,
): Promise<void> {
  // static-import-exception: Kubernetes observation belongs only in the Node deployment host.
  const kubernetes = await import('@kubernetes/client-node');
  const kubeConfig = new kubernetes.KubeConfig();
  kubeConfig.loadFromDefault();
  kubeConfig.setCurrentContext(context);
  const customObjects = makeKubernetesApiClient(kubeConfig, kubernetes.CustomObjectsApi);
  const startedAt = Date.now();
  let lastReport = 0;
  let lastSummary = '';
  while (Date.now() - startedAt < timeoutMs) {
    const resource = await customObjects.getClusterCustomObject({
      group: 'kro.run',
      version: 'v1alpha1',
      plural: 'resourcegraphdefinitions',
      name,
    }).catch((cause: unknown) => {
      if (kubernetesStatusCode(cause) === 404) return undefined;
      throw cause;
    });
    const readiness = resourceGraphDefinitionReadiness(resource);
    if (readiness.state === 'ready') return;
    if (readiness.state === 'failed') {
      throw new Error(`ResourceGraphDefinition/${name} rejected the applied graph: ${readiness.summary}`);
    }
    if (readiness.summary !== lastSummary || Date.now() - lastReport >= 15_000) {
      io.stdout(`Waiting for ResourceGraphDefinition/${name}: ${readiness.summary}`);
      lastSummary = readiness.summary;
      lastReport = Date.now();
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ResourceGraphDefinition/${name}; last status: ${lastSummary || 'unavailable'}.`);
}

export interface ApplicationEndpointVerificationOptions {
  readonly timeoutMs?: number;
  readonly requestTimeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

/** Verify the public URL projected by the authoritative Application status. */
export async function waitForApplicationEndpoint(
  url: string,
  io: ApplicationDeploymentObserverIo,
  options: ApplicationEndpointVerificationOptions = {},
): Promise<void> {
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
    throw new Error(`Application status URL ${url} must use http or https.`);
  }
  const timeoutMs = options.timeoutMs ?? 2 * 60_000;
  const requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  const fetchEndpoint = options.fetch ?? fetch;
  const startedAt = Date.now();
  let lastFailure = 'no request completed';
  let lastReport = 0;
  while (Date.now() - startedAt < timeoutMs) {
    const remainingMs = timeoutMs - (Date.now() - startedAt);
    const controller = new AbortController();
    const requestTimeout = setTimeout(
      () => controller.abort(new Error(`request exceeded ${Math.min(requestTimeoutMs, remainingMs)}ms`)),
      Math.min(requestTimeoutMs, remainingMs),
    );
    try {
      const response = await fetchEndpoint(endpoint, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
      });
      if (response.status >= 200 && response.status < 400) return;
      lastFailure = `HTTP ${response.status}`;
    } catch (cause) {
      lastFailure = cause instanceof Error ? cause.message : String(cause);
    } finally {
      clearTimeout(requestTimeout);
    }
    if (Date.now() - lastReport >= 15_000) {
      io.stdout(`Waiting for public endpoint ${endpoint.toString()}: ${lastFailure}`);
      lastReport = Date.now();
    }
    if (Date.now() - startedAt < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, timeoutMs - (Date.now() - startedAt))));
    }
  }
  throw new Error(`Timed out after ${timeoutMs}ms reaching ${endpoint.toString()}; last result: ${lastFailure}.`);
}

export async function verifyApplicationRegistryPullSecret(
  registry: ResolvedApplicationContainerRegistry,
  context: string,
): Promise<void> {
  if (!registry.remote || !registry.pullSecret) {
    if (registry.remote && registry.provider.kind !== 'orbstack-container-registry' && registry.provider.pushCredentials) {
      throw new Error('Authenticated remote ContainerRegistry deployments require a namespace-scoped pullSecret before authored workloads can be applied.');
    }
    return;
  }
  // static-import-exception: Kubernetes observation belongs only in the Node deployment host.
  const kubernetes = await import('@kubernetes/client-node');
  const kubeConfig = new kubernetes.KubeConfig();
  kubeConfig.loadFromDefault();
  kubeConfig.setCurrentContext(context);
  const secret = await makeKubernetesApiClient(kubeConfig, kubernetes.CoreV1Api).readNamespacedSecret({
    name: registry.pullSecret.name,
    namespace: registry.pullSecret.namespace,
  }).catch((cause: unknown) => {
    if (kubernetesStatusCode(cause) === 404) {
      throw new Error(`ContainerRegistry pull Secret ${registry.pullSecret?.namespace}/${registry.pullSecret?.name} does not exist after registry provisioning.`);
    }
    throw cause;
  });
  if (secret.type !== 'kubernetes.io/dockerconfigjson' || !secret.data?.['.dockerconfigjson']) {
    throw new Error(`ContainerRegistry pull Secret ${registry.pullSecret.namespace}/${registry.pullSecret.name} must be type kubernetes.io/dockerconfigjson with .dockerconfigjson data.`);
  }
}

function assertDeploymentJson(value: unknown, path: string): void {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
  ) {
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`${path} contains a non-finite number.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      assertDeploymentJson(entry, `${path}[${index}]`);
    }
    return;
  }
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${path} contains a non-JSON object.`);
    }
    for (const [key, entry] of Object.entries(value)) {
      assertDeploymentJson(entry, `${path}.${key}`);
    }
    return;
  }
  throw new Error(`${path} contains a non-JSON value.`);
}

function kubernetesStatusCode(cause: unknown): number | undefined {
  if (!cause || typeof cause !== 'object') return undefined;
  const response = Reflect.get(cause, 'response');
  const responseStatus = response && typeof response === 'object' ? Reflect.get(response, 'statusCode') ?? Reflect.get(response, 'status') : undefined;
  const direct = Reflect.get(cause, 'statusCode') ?? Reflect.get(cause, 'status');
  const value = responseStatus ?? direct;
  return typeof value === 'number' ? value : undefined;
}
