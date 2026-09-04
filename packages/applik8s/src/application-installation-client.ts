import type { DeleteResult, ResourceInstanceInput, ResourceObject, ResourceReadList, WatchEvent } from '@applik8s/core';

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
  update(reference: ApplicationInstallationReference, update: TSpec | ((current: Readonly<ResourceObject<TSpec, TStatus>>) => TSpec | Promise<TSpec>)): Promise<ResourceObject<TSpec, TStatus>>;
  /** Delete through the TypeKro instance lifecycle and wait for finalization. */
  delete(reference: ApplicationInstallationReference): Promise<DeleteResult>;
  watch(options?: ApplicationInstallationWatchOptions): AsyncIterable<WatchEvent<TSpec, TStatus>>;
}

export interface ApplicationInstallationConnectOptions<TSpec extends object, TStatus extends object> {
  /** Optional context within an explicitly selected kubeconfig file. */
  readonly context?: string;
  /** Explicit kubeconfig file used by the default Kubernetes transport. */
  readonly kubeConfigPath?: string;
  /** Explicitly use the pod's in-cluster service-account configuration. */
  readonly inCluster?: true;
  readonly namespace?: string;
  /** Injectable provider-neutral transport for alternate clients and deterministic tests. */
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

export function createApplicationInstallationClient<TSpec extends object, TStatus extends object>(options: CreateApplicationInstallationClientOptions<TSpec, TStatus>): ApplicationInstallationClient<TSpec, TStatus> {
  const reference = (value: ApplicationInstallationReference): Required<ApplicationInstallationReference> => ({
    name: requiredName(value.name, 'Application installation name'),
    namespace: requiredName(value.namespace ?? options.namespace, 'Application installation namespace'),
  });
  return Object.freeze({
    async create(input) {
      const normalized = { ...input, name: requiredName(input.name, 'Application installation name'), namespace: requiredName(input.namespace ?? options.namespace, 'Application installation namespace'), spec: options.validateSpec(input.spec) };
      return options.transport.create(options.instance(normalized));
    },
    get: (value) => options.transport.get(reference(value)),
    async require(value) {
      const normalized = reference(value);
      const object = await options.transport.get(normalized);
      if (!object) throw new Error(`Application installation ${normalized.namespace}/${normalized.name} was not found.`);
      return object;
    },
    list: (listOptions = {}) => options.transport.list({
      namespace: requiredName(listOptions.namespace ?? options.namespace, 'Application installation namespace'),
      ...(listOptions.labels ? { labels: listOptions.labels } : {}),
      ...(listOptions.fieldSelector ? { fieldSelector: listOptions.fieldSelector } : {}),
    }),
    async update(value, update) {
      const normalized = reference(value);
      const current = await options.transport.get(normalized);
      if (!current) throw new Error(`Application installation ${normalized.namespace}/${normalized.name} was not found.`);
      return options.transport.replace({ ...current, spec: options.validateSpec(await (typeof update === 'function' ? update(current) : update)) });
    },
    async delete(value) {
      const normalized = reference(value);
      await options.transport.deleteInstance(normalized);
      return { ref: { apiVersion: options.apiVersion, kind: options.kind, ...normalized }, deleted: true };
    },
    watch(watchOptions = {}) {
      const bufferSize = watchOptions.bufferSize ?? 128;
      if (!Number.isSafeInteger(bufferSize) || bufferSize < 1 || bufferSize > 10_000) throw new Error('Application installation watch bufferSize must be between 1 and 10000.');
      return options.transport.watch({ ...watchOptions, namespace: requiredName(watchOptions.namespace ?? options.namespace, 'Application installation namespace'), bufferSize });
    },
  } satisfies ApplicationInstallationClient<TSpec, TStatus>);
}

function requiredName(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${label} must not be empty.`);
  return normalized;
}
