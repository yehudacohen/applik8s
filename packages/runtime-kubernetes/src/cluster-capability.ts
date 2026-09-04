// typecast-file-boundary: the dynamic Kubernetes client is validated against the versioned capability protocol at this transport edge.
import type {
  ApplicationKubernetesCapabilityAuthorityContext,
  ApplicationKubernetesCapabilityFailureCode,
  ApplicationKubernetesCapabilityHost,
  ApplicationKubernetesCapabilityIntent,
  ApplicationKubernetesCapabilityResponse,
} from '@applik8s/applik8s';
import {
  applicationKubernetesCapabilityProtocol,
  createApplicationKubernetesCapabilityRequest,
} from '@applik8s/applik8s';
import {
  KubeConfig,
  KubernetesObjectApi,
  PatchStrategy,
  Watch,
  type KubernetesListObject,
  type KubernetesObject,
  type V1DeleteOptions,
} from '@kubernetes/client-node';

export interface ApplicationKubernetesCapabilityObjectClient {
  read(spec: KubernetesObject): Promise<KubernetesObject>;
  list(
    apiVersion: string,
    kind: string,
    namespace?: string,
    pretty?: string,
    exact?: boolean,
    exportValue?: boolean,
    fieldSelector?: string,
    labelSelector?: string,
    limit?: number,
    continueToken?: string,
  ): Promise<KubernetesListObject<KubernetesObject>>;
  patch(
    spec: KubernetesObject,
    pretty?: string,
    dryRun?: string,
    fieldManager?: string,
    force?: boolean,
    patchStrategy?: typeof PatchStrategy[keyof typeof PatchStrategy],
  ): Promise<KubernetesObject>;
  delete(
    spec: KubernetesObject,
    pretty?: string,
    dryRun?: string,
    gracePeriodSeconds?: number,
    orphanDependents?: boolean,
    propagationPolicy?: string,
    body?: V1DeleteOptions,
  ): Promise<unknown>;
}

export interface ApplicationKubernetesCapabilityWatchClient {
  watch(
    path: string,
    query: Readonly<Record<string, unknown>>,
    callback: (phase: string, object: KubernetesObject) => void,
    done: (error?: unknown) => void,
  ): Promise<AbortController>;
}

export interface KubernetesApplicationCapabilityHostOptions {
  readonly kubeConfig?: KubeConfig;
  /** Explicitly select the pod's projected Kubernetes identity. Never reads ambient kubeconfig. */
  readonly inCluster?: true;
  readonly objects?: ApplicationKubernetesCapabilityObjectClient;
  readonly watch?: ApplicationKubernetesCapabilityWatchClient;
  /** Revalidates exact compiled access and returns framework-derived authority evidence. */
  readonly authorize: (
    intent: ApplicationKubernetesCapabilityIntent,
  ) => ApplicationKubernetesCapabilityAuthorityContext | Promise<ApplicationKubernetesCapabilityAuthorityContext>;
  readonly observe?: (request: ReturnType<typeof createApplicationKubernetesCapabilityRequest>) => void | Promise<void>;
  /** Provider-private diagnostics hook; callers must redact before exporting evidence. */
  readonly onError?: (cause: unknown, intent: ApplicationKubernetesCapabilityIntent) => void | Promise<void>;
  readonly now?: () => number;
}

/** Maintained Node host for the credential-free Kubernetes capability ABI. */
export function createKubernetesApplicationCapabilityHost(
  options: KubernetesApplicationCapabilityHostOptions,
): ApplicationKubernetesCapabilityHost {
  if (options.kubeConfig && options.inCluster) {
    throw new Error(
      'Kubernetes capability host must select exactly one explicit client source.',
    );
  }
  const requiresConfig = !options.objects || !options.watch;
  const kubeConfig = requiresConfig
    ? explicitKubeConfig(options.kubeConfig, options.inCluster)
    : options.kubeConfig;
  const objects: ApplicationKubernetesCapabilityObjectClient = options.objects
    ?? (KubernetesObjectApi.makeApiClient(kubeConfig!) as unknown as ApplicationKubernetesCapabilityObjectClient);
  const watch = options.watch ?? new Watch(kubeConfig!);
  const now = options.now ?? Date.now;
  return Object.freeze({
    async invoke(intent: ApplicationKubernetesCapabilityIntent): Promise<ApplicationKubernetesCapabilityResponse> {
      try {
        validateIntent(intent, now());
        const authority = await options.authorize(intent);
        const request = createApplicationKubernetesCapabilityRequest(intent, authority);
        await options.observe?.(request);
        const value = jsonTransportValue(await invokeOperation(objects, watch, intent, now));
        return { protocol: applicationKubernetesCapabilityProtocol, ok: true, value: value as never };
      } catch (cause) {
        await options.onError?.(cause, intent);
        const failure = classifyFailure(cause, now() >= intent.deadlineUnixMs);
        return { protocol: applicationKubernetesCapabilityProtocol, ok: false, error: failure };
      }
    },
  });
}

async function invokeOperation(
  objects: ApplicationKubernetesCapabilityObjectClient,
  watch: ApplicationKubernetesCapabilityWatchClient,
  intent: ApplicationKubernetesCapabilityIntent,
  now: () => number,
): Promise<unknown> {
  const apiVersion = intent.resource.group
    ? `${intent.resource.group}/${intent.resource.version}`
    : intent.resource.version;
  const identityObject = (identity: { readonly name: string; readonly namespace?: string }): KubernetesObject => ({
    apiVersion,
    kind: intent.resource.kind,
    metadata: { name: identity.name, ...(identity.namespace ? { namespace: identity.namespace } : {}) },
  });
  switch (intent.operation.kind) {
    case 'get':
      return normalizeProviderObject(await objects.read(identityObject(intent.operation.identity)), intent);
    case 'list': {
      const result = await objects.list(
        apiVersion,
        intent.resource.kind,
        intent.operation.query.namespace,
        undefined,
        undefined,
        undefined,
        selector(intent.operation.query.fields),
        selector(intent.operation.query.labels),
        intent.operation.page.limit,
        intent.operation.page.continue,
      );
      const value = {
        items: (result.items ?? []).map(item => normalizeProviderObject(item, intent)),
        ...(result.metadata?.resourceVersion ? { resourceVersion: result.metadata.resourceVersion } : {}),
        ...(result.metadata?._continue ? { continue: result.metadata._continue } : {}),
      };
      assertResponseBytes(value, intent.operation.page.maxBytes);
      return value;
    }
    case 'watch':
      return boundedWatch(watch, intent, intent.operation, now);
    case 'apply': {
      const object = intent.operation.value as unknown as KubernetesObject;
      await verifyExpectedIdentity(objects, object, intent.operation.ownership);
      return normalizeProviderObject(await objects.patch(
        object,
        undefined,
        undefined,
        intent.operation.ownership.fieldManager,
        intent.operation.ownership.force,
        PatchStrategy.ServerSideApply,
      ), intent);
    }
    case 'patch': {
      const identity = identityObject(intent.operation.identity);
      await verifyExpectedIdentity(objects, identity, intent.operation.ownership);
      return normalizeProviderObject(await objects.patch({
        ...intent.operation.patch,
        apiVersion,
        kind: intent.resource.kind,
        metadata: {
          ...((intent.operation.patch.metadata && typeof intent.operation.patch.metadata === 'object' && !Array.isArray(intent.operation.patch.metadata))
            ? intent.operation.patch.metadata
            : {}),
          ...identity.metadata,
        },
      } as KubernetesObject, undefined, undefined, intent.operation.ownership.fieldManager, undefined, PatchStrategy.MergePatch), intent);
    }
    case 'delete': {
      const body: V1DeleteOptions = {
        apiVersion: 'v1',
        kind: 'DeleteOptions',
        preconditions: {
          ...(intent.operation.preconditions.uid ? { uid: intent.operation.preconditions.uid } : {}),
          ...(intent.operation.preconditions.resourceVersion
            ? { resourceVersion: intent.operation.preconditions.resourceVersion }
            : {}),
        },
      };
      await objects.delete(
        identityObject(intent.operation.identity),
        undefined,
        undefined,
        undefined,
        undefined,
        intent.operation.preconditions.propagation,
        body,
      );
      return { deleted: true, ...(intent.operation.preconditions.uid ? { uid: intent.operation.preconditions.uid } : {}) };
    }
  }
}

async function verifyExpectedIdentity(
  objects: ApplicationKubernetesCapabilityObjectClient,
  desired: KubernetesObject,
  ownership: { readonly expectedUid?: string; readonly expectedResourceVersion?: string },
): Promise<void> {
  if (!ownership.expectedUid && !ownership.expectedResourceVersion) return;
  const live = await objects.read(desired);
  if (
    (ownership.expectedUid && live.metadata?.uid !== ownership.expectedUid)
    || (ownership.expectedResourceVersion && live.metadata?.resourceVersion !== ownership.expectedResourceVersion)
  ) {
    throw Object.assign(new Error('Kubernetes mutation precondition did not match the live resource.'), { code: 409 });
  }
}

async function boundedWatch(
  watcher: ApplicationKubernetesCapabilityWatchClient,
  intent: ApplicationKubernetesCapabilityIntent,
  operation: Extract<ApplicationKubernetesCapabilityIntent['operation'], { readonly kind: 'watch' }>,
  now: () => number,
): Promise<unknown> {
  const events: Array<{ readonly type: 'Added' | 'Modified' | 'Deleted' | 'Bookmark'; readonly object: KubernetesObject }> = [];
  let resourceVersion = operation.from;
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const remaining = Math.max(1, intent.deadlineUnixMs - now());
  const path = resourcePath(intent, operation.query.namespace);
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (cause?: unknown) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
      cause ? reject(cause) : resolve();
    };
    timer = setTimeout(() => finish(), remaining);
    void watcher.watch(path, {
      ...(selector(operation.query.fields) ? { fieldSelector: selector(operation.query.fields) } : {}),
      ...(selector(operation.query.labels) ? { labelSelector: selector(operation.query.labels) } : {}),
      ...(operation.from ? { resourceVersion: operation.from } : {}),
      allowWatchBookmarks: true,
      timeoutSeconds: Math.max(1, Math.ceil(remaining / 1_000)),
    }, (phase, object) => {
      const type = watchType(phase);
      if (!type) return;
      resourceVersion = object.metadata?.resourceVersion ?? resourceVersion;
      events.push({ type, object: normalizeProviderObject(object, intent) });
      try {
        assertResponseBytes(events, operation.maxBytes);
      } catch (cause) {
        finish(cause);
        return;
      }
      if (events.length >= operation.maxEvents) finish();
    }, finish).then(value => {
      controller = value;
      if (settled) controller.abort();
    }).catch(finish);
  });
  return { events, ...(resourceVersion ? { resourceVersion } : {}) };
}

function resourcePath(intent: ApplicationKubernetesCapabilityIntent, namespace: string | undefined): string {
  const base = intent.resource.group
    ? `/apis/${encodeURIComponent(intent.resource.group)}/${encodeURIComponent(intent.resource.version)}`
    : `/api/${encodeURIComponent(intent.resource.version)}`;
  return `${base}${namespace ? `/namespaces/${encodeURIComponent(namespace)}` : ''}/${encodeURIComponent(intent.resource.plural)}`;
}

function selector(values: Readonly<Record<string, string>> | undefined): string | undefined {
  if (!values) return undefined;
  return Object.entries(values).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${value}`).join(',');
}

function normalizeProviderObject(
  value: KubernetesObject,
  intent: ApplicationKubernetesCapabilityIntent,
): KubernetesObject {
  const apiVersion = intent.resource.group
    ? `${intent.resource.group}/${intent.resource.version}`
    : intent.resource.version;
  if (value.apiVersion && value.apiVersion !== apiVersion) {
    throw Object.assign(new Error('Kubernetes provider returned a different apiVersion.'), {
      applicationCode: 'KUBERNETES_CLUSTER_SCHEMA_MISMATCH',
    });
  }
  if (value.kind && value.kind !== intent.resource.kind) {
    throw Object.assign(new Error('Kubernetes provider returned a different kind.'), {
      applicationCode: 'KUBERNETES_CLUSTER_SCHEMA_MISMATCH',
    });
  }
  return { ...value, apiVersion, kind: intent.resource.kind };
}

function assertResponseBytes(value: unknown, maximum: number): void {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > maximum) {
    throw Object.assign(new Error('Kubernetes response exceeded its declared byte bound.'), {
      applicationCode: 'KUBERNETES_CLUSTER_RESPONSE_LIMIT',
    });
  }
}

function jsonTransportValue(value: unknown): unknown {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    throw Object.assign(new Error('Kubernetes response was not JSON serializable.'), {
      applicationCode: 'KUBERNETES_CLUSTER_PROTOCOL_INCOMPATIBLE',
    });
  }
  return JSON.parse(encoded) as unknown;
}

function watchType(value: string): 'Added' | 'Modified' | 'Deleted' | 'Bookmark' | undefined {
  if (value === 'ADDED') return 'Added';
  if (value === 'MODIFIED') return 'Modified';
  if (value === 'DELETED') return 'Deleted';
  if (value === 'BOOKMARK') return 'Bookmark';
  return undefined;
}

function validateIntent(intent: ApplicationKubernetesCapabilityIntent, now: number): void {
  if (intent.protocol !== applicationKubernetesCapabilityProtocol) {
    throw Object.assign(new Error('Unsupported Kubernetes capability protocol.'), { applicationCode: 'KUBERNETES_CLUSTER_PROTOCOL_INCOMPATIBLE' });
  }
  if (!intent.bindingId || !intent.operationId || intent.deadlineUnixMs <= now) {
    throw Object.assign(new Error('Kubernetes capability request deadline elapsed.'), { applicationCode: 'KUBERNETES_CLUSTER_DEADLINE' });
  }
}

function classifyFailure(
  cause: unknown,
  deadlineElapsed: boolean,
): { readonly code: ApplicationKubernetesCapabilityFailureCode; readonly message: string; readonly retryable: boolean } {
  const applicationCode = cause && typeof cause === 'object' ? Reflect.get(cause, 'applicationCode') : undefined;
  if (typeof applicationCode === 'string' && applicationCode.startsWith('KUBERNETES_CLUSTER_')) {
    return { code: applicationCode as ApplicationKubernetesCapabilityFailureCode, message: safeMessage(cause), retryable: applicationCode === 'KUBERNETES_CLUSTER_UNAVAILABLE' };
  }
  if (deadlineElapsed) return { code: 'KUBERNETES_CLUSTER_DEADLINE', message: 'Kubernetes operation exceeded its deadline.', retryable: true };
  const status = errorStatus(cause);
  if (status === 404) return { code: 'KUBERNETES_CLUSTER_NOT_FOUND', message: 'Kubernetes resource was not found.', retryable: false };
  if (status === 409) return { code: 'KUBERNETES_CLUSTER_CONFLICT', message: 'Kubernetes resource ownership or version conflicted.', retryable: true };
  if (status === 401 || status === 403) return { code: 'KUBERNETES_CLUSTER_FORBIDDEN', message: 'Kubernetes authority denied the operation.', retryable: false };
  return { code: 'KUBERNETES_CLUSTER_UNAVAILABLE', message: 'Kubernetes capability host could not complete the operation.', retryable: true };
}

function errorStatus(cause: unknown): number | undefined {
  if (!cause || typeof cause !== 'object') return undefined;
  const response = Reflect.get(cause, 'response');
  const body = Reflect.get(cause, 'body');
  for (const value of [
    Reflect.get(cause, 'code'),
    Reflect.get(cause, 'statusCode'),
    response && typeof response === 'object' ? Reflect.get(response, 'statusCode') : undefined,
    body && typeof body === 'object' ? Reflect.get(body, 'code') : undefined,
  ]) {
    if (typeof value === 'number') return value;
  }
  return undefined;
}

function safeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Kubernetes capability operation failed.';
}

function explicitKubeConfig(
  configured: KubeConfig | undefined,
  inCluster: true | undefined,
): KubeConfig {
  if (configured) return configured;
  if (!inCluster) {
    throw new Error(
      'Kubernetes capability host requires an explicit kubeConfig or inCluster: true; ambient kubeconfig is never adopted.',
    );
  }
  const config = new KubeConfig();
  config.loadFromCluster();
  return config;
}
