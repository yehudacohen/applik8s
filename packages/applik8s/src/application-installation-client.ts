// typecast-file-boundary: Kubernetes client-node returns structurally untyped custom objects; this adapter validates API coordinates and confines conversion to the transport edge.
import type { DeleteResult, ResourceInstanceInput, ResourceObject, ResourceReadList, WatchEvent } from '@applik8s/core';
import type { KubeConfig } from '@kubernetes/client-node';

export interface ApplicationInstallationReference {
  readonly name: string;
  readonly namespace?: string;
}

export interface ApplicationInstallationWatchOptions {
  readonly namespace?: string;
  readonly labels?: Readonly<Record<string, string>>;
  readonly fieldSelector?: string;
  readonly resourceVersion?: string;
  /** Maximum in-memory events before the watch fails closed. @default 128 */
  readonly bufferSize?: number;
  readonly signal?: AbortSignal;
}

export interface ApplicationInstallationClient<TSpec extends object, TStatus extends object> {
  create(input: ResourceInstanceInput<TSpec>): Promise<ResourceObject<TSpec, TStatus>>;
  get(reference: ApplicationInstallationReference): Promise<ResourceObject<TSpec, TStatus> | undefined>;
  require(reference: ApplicationInstallationReference): Promise<ResourceObject<TSpec, TStatus>>;
  list(options?: Omit<ApplicationInstallationWatchOptions, 'resourceVersion' | 'bufferSize' | 'signal'>): Promise<ResourceReadList<TSpec, TStatus>>;
  update(
    reference: ApplicationInstallationReference,
    update: TSpec | ((current: Readonly<ResourceObject<TSpec, TStatus>>) => TSpec | Promise<TSpec>),
  ): Promise<ResourceObject<TSpec, TStatus>>;
  /** Delete through the TypeKro instance lifecycle and wait for finalization. */
  delete(reference: ApplicationInstallationReference): Promise<DeleteResult>;
  watch(options?: ApplicationInstallationWatchOptions): AsyncIterable<WatchEvent<TSpec, TStatus>>;
}

export interface ApplicationInstallationConnectOptions<TSpec extends object, TStatus extends object> {
  /** Required by the default Kubernetes transport; never inferred from ambient current context. */
  readonly context?: string;
  readonly namespace?: string;
  readonly kubeConfig?: KubeConfig;
  /** Injectable transport for alternate clients and deterministic tests. */
  readonly transport?: ApplicationInstallationTransport<TSpec, TStatus>;
}

export interface ApplicationInstallationTransport<TSpec extends object, TStatus extends object> {
  create(object: ResourceObject<TSpec, TStatus>): Promise<ResourceObject<TSpec, TStatus>>;
  get(reference: Required<ApplicationInstallationReference>): Promise<ResourceObject<TSpec, TStatus> | undefined>;
  list(options: { readonly namespace: string; readonly labels?: Readonly<Record<string, string>>; readonly fieldSelector?: string }): Promise<ResourceReadList<TSpec, TStatus>>;
  replace(object: ResourceObject<TSpec, TStatus>): Promise<ResourceObject<TSpec, TStatus>>;
  deleteInstance(reference: Required<ApplicationInstallationReference>): Promise<void>;
  watch(options: Required<Pick<ApplicationInstallationWatchOptions, 'namespace' | 'bufferSize'>> & ApplicationInstallationWatchOptions): AsyncIterable<WatchEvent<TSpec, TStatus>>;
}

export interface CreateApplicationInstallationClientOptions<TSpec extends object, TStatus extends object> {
  readonly apiVersion: string;
  readonly kind: string;
  readonly namespace: string;
  readonly instance: (input: ResourceInstanceInput<TSpec>) => ResourceObject<TSpec, TStatus>;
  readonly validateSpec: (spec: TSpec) => TSpec;
  readonly transport: ApplicationInstallationTransport<TSpec, TStatus>;
}

export function createApplicationInstallationClient<TSpec extends object, TStatus extends object>(
  options: CreateApplicationInstallationClientOptions<TSpec, TStatus>,
): ApplicationInstallationClient<TSpec, TStatus> {
  const reference = (value: ApplicationInstallationReference): Required<ApplicationInstallationReference> => ({
    name: requiredName(value.name, 'Application installation name'),
    namespace: requiredName(value.namespace ?? options.namespace, 'Application installation namespace'),
  });
  const client: ApplicationInstallationClient<TSpec, TStatus> = {
    async create(input) {
      const normalized = { ...input, name: requiredName(input.name, 'Application installation name'), namespace: requiredName(input.namespace ?? options.namespace, 'Application installation namespace'), spec: options.validateSpec(input.spec) };
      return options.transport.create(options.instance(normalized));
    },
    get(value) {
      return options.transport.get(reference(value));
    },
    async require(value) {
      const normalized = reference(value);
      const object = await options.transport.get(normalized);
      if (!object) throw new Error(`Application installation ${normalized.namespace}/${normalized.name} was not found.`);
      return object;
    },
    list(listOptions = {}) {
      return options.transport.list({
        namespace: requiredName(listOptions.namespace ?? options.namespace, 'Application installation namespace'),
        ...(listOptions.labels ? { labels: listOptions.labels } : {}),
        ...(listOptions.fieldSelector ? { fieldSelector: listOptions.fieldSelector } : {}),
      });
    },
    async update(value, update) {
      const normalized = reference(value);
      const current = await options.transport.get(normalized);
      if (!current) throw new Error(`Application installation ${normalized.namespace}/${normalized.name} was not found.`);
      const next = options.validateSpec(await (typeof update === 'function' ? update(current) : update));
      return options.transport.replace({ ...current, spec: next });
    },
    async delete(value) {
      const normalized = reference(value);
      await options.transport.deleteInstance(normalized);
      return { ref: { apiVersion: options.apiVersion, kind: options.kind, ...normalized }, deleted: true };
    },
    watch(watchOptions = {}) {
      const bufferSize = watchOptions.bufferSize ?? 128;
      if (!Number.isSafeInteger(bufferSize) || bufferSize < 1 || bufferSize > 10_000) {
        throw new Error('Application installation watch bufferSize must be between 1 and 10000.');
      }
      return options.transport.watch({
        ...watchOptions,
        namespace: requiredName(watchOptions.namespace ?? options.namespace, 'Application installation namespace'),
        bufferSize,
      });
    },
  };
  return Object.freeze(client);
}

export interface KubernetesApplicationInstallationTransportOptions {
  readonly apiVersion: string;
  readonly kind: string;
  readonly plural: string;
  readonly context: string;
  readonly kubeConfig?: KubeConfig;
  readonly deleteInstance: (reference: Required<ApplicationInstallationReference>, kubeConfig: KubeConfig) => Promise<void>;
}

/** Default Node transport. Kubernetes writes are typed; deletion remains TypeKro-owned. */
export async function kubernetesApplicationInstallationTransport<TSpec extends object, TStatus extends object>(
  options: KubernetesApplicationInstallationTransportOptions,
): Promise<ApplicationInstallationTransport<TSpec, TStatus>> {
  if (!options.context.trim()) throw new Error('Application installation client requires an explicit Kubernetes context.');
  const [group, version] = options.apiVersion.split('/');
  if (!group || !version) throw new Error(`Application installation apiVersion ${options.apiVersion} must contain a group and version.`);
  // static-import-exception: the Kubernetes SDK loads only when a Node-side installation client is explicitly connected.
  const kubernetes = await import('@kubernetes/client-node');
  const kubeConfig = options.kubeConfig ?? new kubernetes.KubeConfig();
  if (!options.kubeConfig) kubeConfig.loadFromDefault();
  kubeConfig.setCurrentContext(options.context);
  const api = kubeConfig.makeApiClient(kubernetes.CustomObjectsApi);
  const common = { group, version, plural: options.plural };
  return {
    async create(object) {
      return api.createNamespacedCustomObject({ ...common, namespace: requiredMetadataNamespace(object), body: object, fieldManager: 'applik8s-installation-client', fieldValidation: 'Strict' }) as Promise<ResourceObject<TSpec, TStatus>>;
    },
    async get(reference) {
      return api.getNamespacedCustomObject({ ...common, ...reference })
        .then((value) => value as ResourceObject<TSpec, TStatus>)
        .catch((cause: unknown) => {
          if (kubernetesStatusCode(cause) === 404) return undefined;
          throw cause;
        });
    },
    async list(listOptions) {
      const value = await api.listNamespacedCustomObject({
        ...common,
        namespace: listOptions.namespace,
        ...(listOptions.labels ? { labelSelector: labelSelector(listOptions.labels) } : {}),
        ...(listOptions.fieldSelector ? { fieldSelector: listOptions.fieldSelector } : {}),
      }) as { readonly items?: readonly ResourceObject<TSpec, TStatus>[]; readonly metadata?: { readonly _continue?: string } };
      return { items: value.items ?? [], ...(value.metadata?._continue ? { continueToken: value.metadata._continue } : {}) };
    },
    async replace(object) {
      const name = requiredName(object.metadata.name, 'Application installation metadata.name');
      return api.replaceNamespacedCustomObject({ ...common, namespace: requiredMetadataNamespace(object), name, body: object, fieldManager: 'applik8s-installation-client', fieldValidation: 'Strict' }) as Promise<ResourceObject<TSpec, TStatus>>;
    },
    deleteInstance(reference) {
      return options.deleteInstance(reference, kubeConfig);
    },
    watch(watchOptions) {
      return kubernetesInstallationWatch<TSpec, TStatus>({ ...options, ...common, kubeConfig, kubernetes, ...watchOptions });
    },
  };
}

function kubernetesInstallationWatch<TSpec extends object, TStatus extends object>(options: {
  readonly group: string;
  readonly version: string;
  readonly plural: string;
  readonly namespace: string;
  readonly labels?: Readonly<Record<string, string>>;
  readonly fieldSelector?: string;
  readonly resourceVersion?: string;
  readonly bufferSize: number;
  readonly signal?: AbortSignal;
  readonly kubeConfig: KubeConfig;
  readonly kubernetes: typeof import('@kubernetes/client-node');
}): AsyncIterable<WatchEvent<TSpec, TStatus>> {
  const queue = new BoundedAsyncQueue<WatchEvent<TSpec, TStatus>>(options.bufferSize);
  const watcher = new options.kubernetes.Watch(options.kubeConfig as InstanceType<typeof options.kubernetes.KubeConfig>);
  const path = `/apis/${encodeURIComponent(options.group)}/${encodeURIComponent(options.version)}/namespaces/${encodeURIComponent(options.namespace)}/${encodeURIComponent(options.plural)}`;
  let controller: AbortController | undefined;
  void watcher.watch(path, {
    ...(options.labels ? { labelSelector: labelSelector(options.labels) } : {}),
    ...(options.fieldSelector ? { fieldSelector: options.fieldSelector } : {}),
    ...(options.resourceVersion ? { resourceVersion: options.resourceVersion } : {}),
    allowWatchBookmarks: true,
  }, (phase, object) => {
    if (phase === 'ADDED' || phase === 'MODIFIED' || phase === 'DELETED' || phase === 'BOOKMARK') {
      queue.push({ type: phase, object: object as ResourceObject<TSpec, TStatus> });
    }
  }, (cause) => {
    if (cause && cause !== options.kubernetes.Watch.SERVER_SIDE_CLOSE) queue.fail(cause instanceof Error ? cause : new Error(String(cause)));
    else queue.end();
  }).then((value) => {
    controller = value;
    if (options.signal?.aborted) controller.abort();
  }).catch((cause: unknown) => queue.fail(cause instanceof Error ? cause : new Error(String(cause))));
  options.signal?.addEventListener('abort', () => {
    controller?.abort();
    queue.end();
  }, { once: true });
  return queue;
}

class BoundedAsyncQueue<T> implements AsyncIterable<T> {
  readonly #limit: number;
  readonly #values: T[] = [];
  readonly #waiters: Array<{ readonly resolve: (value: IteratorResult<T>) => void; readonly reject: (cause: Error) => void }> = [];
  #ended = false;
  #failure?: Error;

  constructor(limit: number) {
    this.#limit = limit;
  }

  push(value: T): void {
    if (this.#ended || this.#failure) return;
    const waiter = this.#waiters.shift();
    if (waiter) {
      waiter.resolve({ value, done: false });
      return;
    }
    if (this.#values.length >= this.#limit) {
      this.fail(new Error(`Application installation watch exceeded its bounded ${this.#limit}-event buffer.`));
      return;
    }
    this.#values.push(value);
  }

  end(): void {
    if (this.#ended) return;
    this.#ended = true;
    for (const waiter of this.#waiters.splice(0)) waiter.resolve({ value: undefined, done: true });
  }

  fail(cause: Error): void {
    if (this.#failure) return;
    this.#failure = cause;
    for (const waiter of this.#waiters.splice(0)) waiter.reject(cause);
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: async () => {
        if (this.#failure) throw this.#failure;
        const value = this.#values.shift();
        if (value !== undefined) return { value, done: false };
        if (this.#ended) return { value: undefined, done: true };
        return new Promise<IteratorResult<T>>((resolve, reject) => this.#waiters.push({ resolve, reject }));
      },
      return: async () => {
        this.end();
        return { value: undefined, done: true };
      },
    };
  }
}

function requiredMetadataNamespace(value: { readonly metadata: { readonly namespace?: string } }): string {
  return requiredName(value.metadata.namespace, 'Application installation metadata.namespace');
}

function requiredName(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${label} must not be empty.`);
  return normalized;
}

function labelSelector(labels: Readonly<Record<string, string>>): string {
  return Object.entries(labels).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${value}`).join(',');
}

function kubernetesStatusCode(cause: unknown): number | undefined {
  if (!cause || typeof cause !== 'object') return undefined;
  const direct = Reflect.get(cause, 'statusCode') ?? Reflect.get(cause, 'code');
  if (typeof direct === 'number') return direct;
  const response = Reflect.get(cause, 'response');
  return response && typeof response === 'object' && typeof Reflect.get(response, 'statusCode') === 'number'
    ? Reflect.get(response, 'statusCode') as number
    : undefined;
}
