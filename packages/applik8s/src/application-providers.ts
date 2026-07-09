import type { ApplicationMigrationContract, ApplicationProviderInterfaceKind, ApplicationProviderRuntimeContract, ApplicationResourceRef } from '@applik8s/core';

export interface ApplicationIndexBackendSelectionOptions {
  readonly cache?: readonly unknown[];
}

export type ApplicationIndexBackend = ApplicationValkeyIndexBackend;

export type ApplicationModelStoreProvider = ApplicationPostgresModelStoreProvider;

export type ApplicationHttpExposureProvider = 'ingress' | ApplicationIngressHttpExposureProvider;

export interface ApplicationKubernetesResourceCounterStoreProvider { readonly kind: 'kubernetes-resource-counter'; readonly flushMs?: number }
export interface ApplicationKubernetesWatchEventSourceProvider { readonly kind: 'kubernetes-watch'; readonly resyncSeconds?: number }
export interface ApplicationKubernetesSecretProvider { readonly kind: 'kubernetes-secret'; readonly defaultOwnership?: 'external' | 'generated' }
export interface ApplicationKubernetesConfigMapQueueProvider { readonly kind: 'kubernetes-configmap-queue'; readonly maxDepth?: number; readonly maxMessageBytes?: number }
export interface ApplicationKubernetesConfigMapObjectStorageProvider { readonly kind: 'kubernetes-configmap-objects'; readonly maxObjectBytes?: number }
export interface ApplicationKubernetesCredentialStoreProvider { readonly kind: 'kubernetes-secret-credentials'; readonly defaultOwnership?: 'external' | 'generated' }

export type ApplicationCounterStoreProvider = ApplicationKubernetesResourceCounterStoreProvider;
export type ApplicationEventSourceProvider = ApplicationKubernetesWatchEventSourceProvider;
export type ApplicationSecretProvider = ApplicationKubernetesSecretProvider;
export type ApplicationQueueProvider = ApplicationKubernetesConfigMapQueueProvider;
export type ApplicationObjectStorageProvider = ApplicationKubernetesConfigMapObjectStorageProvider;
export type ApplicationCredentialStoreProvider = ApplicationKubernetesCredentialStoreProvider;

export type ApplicationPostgresModelStoreOptions = Omit<ApplicationPostgresModelStoreProvider, 'kind'>;

export interface ApplicationPostgresModelStoreProvider {
  readonly kind: 'postgres';
  readonly name?: string;
  readonly namespace?: string;
  readonly database?: string;
  readonly provision?: boolean;
  readonly cluster?: ApplicationResourceRef;
  readonly connectionSecret?: ApplicationResourceRef;
  readonly connectionSecretKey?: string;
  readonly migrations?: ApplicationModelStoreMigrationPolicy;
  readonly runtime?: ApplicationProviderRuntimeContract;
  readonly readiness?: ApplicationPostgresReadinessPolicy;
}

export interface ApplicationModelStoreMigrationPolicy extends ApplicationMigrationContract {
  readonly jobName?: string;
  readonly apply?: 'manual' | 'generatedJob';
}

export type ApplicationGeneratedModelStoreMigrationJobOptions = Omit<Partial<ApplicationModelStoreMigrationPolicy>, 'strategy' | 'apply'>;

export interface ApplicationPostgresReadinessPolicy {
  readonly waitForClusterReady?: boolean;
  readonly timeoutSeconds?: number;
  readonly condition?: string;
}

export interface ApplicationValkeyIndexBackend {
  readonly kind: 'valkey';
  readonly provisioner?: 'deployment' | 'hyperspike';
  readonly name?: string;
  readonly namespace?: string;
  readonly host?: string;
  readonly port?: number;
  readonly image?: string;
  readonly provision?: boolean;
  readonly spec?: Readonly<Record<string, unknown>>;
}

export interface ApplicationIngressHttpExposureProvider {
  readonly kind: 'ingress';
  readonly ingressClassName?: string;
}

export interface ApplicationDefaults {
  readonly models?: ApplicationModelStoreProvider | ApplicationProviderBinding<ApplicationModelStoreProvider>;
  readonly indexes?: unknown;
  readonly counters?: ApplicationCounterStoreProvider;
  readonly events?: ApplicationEventSourceProvider;
  readonly secrets?: ApplicationSecretProvider;
  readonly queues?: ApplicationQueueProvider;
  readonly objects?: ApplicationObjectStorageProvider;
  readonly credentials?: ApplicationCredentialStoreProvider;
  readonly expose?: ApplicationHttpExposureProvider | ApplicationProviderBinding<ApplicationHttpExposureProvider>;
}

export interface ApplicationDefaultsBinding {
  readonly kind: 'applicationDefaults';
  readonly defaults: ApplicationDefaults;
}

export interface ApplicationProviderToken<TImplementation = unknown> {
  readonly name?: string;
  readonly description?: string;
  readonly __implementation?: TImplementation;
}

export interface ApplicationModelStoreProviderToken extends ApplicationProviderToken<ApplicationModelStoreProvider> {
  postgres(options?: ApplicationPostgresModelStoreOptions): ApplicationPostgresModelStoreProvider;
  readonly migrations: {
    generatedJob(options?: ApplicationGeneratedModelStoreMigrationJobOptions): ApplicationModelStoreMigrationPolicy;
  };
}

export interface ApplicationProviderBinding<TImplementation = unknown> {
  readonly kind: 'applicationProvider';
  readonly token: ApplicationProviderToken<TImplementation>;
  readonly implementation: TImplementation;
}

export interface ApplicationProviderState {
  readonly defaults: { indexes?: unknown; models?: unknown; counters?: unknown; events?: unknown; secrets?: unknown; queues?: unknown; objects?: unknown; expose?: unknown; credentials?: unknown };
  readonly providers: { indexes?: unknown; models?: unknown; counters?: unknown; events?: unknown; secrets?: unknown; queues?: unknown; objects?: unknown; expose?: unknown; credentials?: unknown };
}

export const IndexStore: ApplicationProviderToken<ApplicationIndexBackend | 'valkey'> = {
  name: 'IndexStore',
  description: 'Default app-scoped index backend provider.',
};

export const ModelStore: ApplicationModelStoreProviderToken = {
  name: 'ModelStore',
  description: 'Default app-scoped storage-backed model provider.',
  postgres(options = {}) {
    return { kind: 'postgres', ...options };
  },
  migrations: {
    generatedJob(options = {}) {
      return {
        ...options,
        strategy: 'generatedJob',
        compatibility: options.compatibility ?? 'requiresExplicitMigration',
        apply: 'generatedJob',
      };
    },
  },
};

export const CounterStore: ApplicationProviderToken<ApplicationCounterStoreProvider> = {
  name: 'CounterStore',
  description: 'Default app-scoped counter backend provider.',
};

export const EventSource: ApplicationProviderToken<ApplicationEventSourceProvider> = {
  name: 'EventSource',
  description: 'Default app-scoped event source provider.',
};

export const Secret: ApplicationProviderToken<ApplicationSecretProvider> = {
  name: 'Secret',
  description: 'Default app-scoped secret material provider.',
};

export const Queue: ApplicationProviderToken<ApplicationQueueProvider> = {
  name: 'Queue',
  description: 'Default app-scoped queue provider.',
};

export const ObjectStorage: ApplicationProviderToken<ApplicationObjectStorageProvider> = {
  name: 'ObjectStorage',
  description: 'Default app-scoped object storage provider.',
};

export const HttpExposure: ApplicationProviderToken<ApplicationHttpExposureProvider> = {
  name: 'HttpExposure',
  description: 'Default app-scoped HTTP exposure provider.',
};

export const CredentialStore: ApplicationProviderToken<ApplicationCredentialStoreProvider> = {
  name: 'CredentialStore',
  description: 'Default app-scoped credential storage provider.',
};

// typecast: provider registry names are literal public API keys used for app.provide(...) inference.
export const providers = { IndexStore, ModelStore, CounterStore, EventSource, Secret, Queue, ObjectStorage, HttpExposure, CredentialStore } as const;

export const defaultApplicationProviders: {
  readonly IndexStore: ApplicationValkeyIndexBackend;
  readonly ModelStore: ApplicationPostgresModelStoreProvider;
  readonly CounterStore: ApplicationCounterStoreProvider;
  readonly EventSource: ApplicationEventSourceProvider;
  readonly Secret: ApplicationSecretProvider;
  readonly Queue: ApplicationQueueProvider;
  readonly ObjectStorage: ApplicationObjectStorageProvider;
  readonly HttpExposure: ApplicationIngressHttpExposureProvider;
  readonly CredentialStore: ApplicationCredentialStoreProvider;
} = {
  IndexStore: { kind: 'valkey' },
  ModelStore: { kind: 'postgres' },
  CounterStore: { kind: 'kubernetes-resource-counter', flushMs: 1000 },
  EventSource: { kind: 'kubernetes-watch', resyncSeconds: 300 },
  Secret: { kind: 'kubernetes-secret', defaultOwnership: 'external' },
  Queue: { kind: 'kubernetes-configmap-queue', maxDepth: 1000, maxMessageBytes: 65536 },
  ObjectStorage: { kind: 'kubernetes-configmap-objects', maxObjectBytes: 524288 },
  HttpExposure: { kind: 'ingress' },
  CredentialStore: { kind: 'kubernetes-secret-credentials', defaultOwnership: 'external' },
};

export function defaultApplicationIndexBackend(state: ApplicationProviderState, options: ApplicationIndexBackendSelectionOptions, indexes: Readonly<Record<string, unknown>>): ApplicationIndexBackend | undefined {
  const provider = defaultApplicationIndexProvider(state);
  if ((options.cache?.length ?? 0) > 0 || (Object.keys(indexes).length > 0 && isValkeyIndexDefault(provider))) {
    return applicationIndexBackend(provider) ?? { kind: 'valkey' };
  }
  return undefined;
}

export function defaultApplicationIndexProvider(state: ApplicationProviderState): unknown {
  return state.providers.indexes ?? state.defaults.indexes;
}

export function applicationIndexBackend(value: unknown): ApplicationIndexBackend | undefined {
  if (value === 'valkey') {
    return { kind: 'valkey' };
  }
  if (value && typeof value === 'object' && Reflect.get(value, 'kind') === 'valkey') {
    // typecast: app.provide/defaults accept structurally typed provider values; this narrows the supported v0.2 IndexStore provider slice.
    return value as ApplicationIndexBackend;
  }
  return undefined;
}

export function isValkeyIndexDefault(value: unknown): boolean {
  return value === 'valkey' || Boolean(value && typeof value === 'object' && Reflect.get(value, 'kind') === 'valkey');
}

export function applyApplicationProvider<TImplementation>(state: ApplicationProviderState, token: ApplicationProviderToken<TImplementation>, implementation: TImplementation): void {
  if (applicationProviderTokenName(token) === 'IndexStore') {
    if (!isValkeyIndexDefault(implementation)) {
      throw new Error('app.provide(IndexStore, ...) currently supports only the Valkey index backend provider slice. Use "valkey" or { kind: "valkey", ... } for v0.2.');
    }
    state.providers.indexes = implementation;
    return;
  }
  if (applicationProviderTokenName(token) === 'ModelStore') {
    if (!isPostgresModelStoreProvider(implementation)) {
      throw new Error('app.provide(ModelStore, ...) currently supports only the typed Postgres ModelStore provider declaration. Use { kind: "postgres", ... } until additional ModelStore providers are implemented.');
    }
    state.providers.models = implementation;
    return;
  }
  if (applicationProviderTokenName(token) === 'HttpExposure') {
    if (!isIngressHttpExposureProvider(implementation)) {
      throw new Error('app.provide(HttpExposure, ...) currently supports only the Ingress HTTP exposure provider slice. Use "ingress" or { kind: "ingress", ... } until Gateway/provider-specific exposure adapters are implemented.');
    }
    state.providers.expose = implementation;
    return;
  }
  const tokenName = applicationProviderTokenName(token);
  const field = applicationProviderStateField(tokenName);
  if (field && isSupportedDefaultProvider(tokenName, implementation)) {
    state.providers[field] = implementation;
    return;
  }
  if (applicationProviderInterface(tokenName)) {
    throw new Error(`app.provide(${tokenName}, ...) does not match the bounded v0.3 Kubernetes-native provider contract.`);
  }
}

function applicationProviderStateField(tokenName: string | undefined): 'counters' | 'events' | 'secrets' | 'queues' | 'objects' | 'credentials' | undefined {
  if (tokenName === 'CounterStore') return 'counters';
  if (tokenName === 'EventSource') return 'events';
  if (tokenName === 'Secret') return 'secrets';
  if (tokenName === 'Queue') return 'queues';
  if (tokenName === 'ObjectStorage') return 'objects';
  if (tokenName === 'CredentialStore') return 'credentials';
  return undefined;
}

function isSupportedDefaultProvider(tokenName: string | undefined, implementation: unknown): boolean {
  const kind = implementation && typeof implementation === 'object' ? Reflect.get(implementation, 'kind') : undefined;
  return (tokenName === 'CounterStore' && kind === 'kubernetes-resource-counter')
    || (tokenName === 'EventSource' && kind === 'kubernetes-watch')
    || (tokenName === 'Secret' && kind === 'kubernetes-secret')
    || (tokenName === 'Queue' && kind === 'kubernetes-configmap-queue')
    || (tokenName === 'ObjectStorage' && kind === 'kubernetes-configmap-objects')
    || (tokenName === 'CredentialStore' && kind === 'kubernetes-secret-credentials');
}

export function isIngressHttpExposureProvider(value: unknown): value is ApplicationHttpExposureProvider {
  return value === 'ingress' || Boolean(value && typeof value === 'object' && Reflect.get(value, 'kind') === 'ingress');
}

export function applicationHttpExposureImplementation(value: unknown): ApplicationHttpExposureProvider | undefined {
  if (isIngressHttpExposureProvider(value)) {
    return value;
  }
  if (isApplicationProviderBinding(value) && value.token === HttpExposure && isIngressHttpExposureProvider(value.implementation)) {
    return value.implementation;
  }
  return undefined;
}

export function isPostgresModelStoreProvider(value: unknown): value is ApplicationPostgresModelStoreProvider {
  return Boolean(value && typeof value === 'object' && Reflect.get(value, 'kind') === 'postgres');
}

export function applicationModelStoreImplementation(store: unknown): ApplicationModelStoreProvider | undefined {
  if (isPostgresModelStoreProvider(store)) {
    return store;
  }
  if (isApplicationProviderBinding(store) && store.token === ModelStore && isPostgresModelStoreProvider(store.implementation)) {
    return store.implementation;
  }
  return undefined;
}

function isApplicationProviderBinding(value: unknown): value is ApplicationProviderBinding<unknown> {
  return Boolean(value && typeof value === 'object' && Reflect.get(value, 'kind') === 'applicationProvider');
}

export function applicationProviderTokenName(token: ApplicationProviderToken<unknown>): string | undefined {
  return token.name;
}

export function applicationProviderInterface(tokenName: string | undefined): ApplicationProviderInterfaceKind | undefined {
  if (tokenName === 'IndexStore' || tokenName === 'ModelStore' || tokenName === 'CounterStore' || tokenName === 'EventSource' || tokenName === 'Secret' || tokenName === 'Queue' || tokenName === 'ObjectStorage' || tokenName === 'HttpExposure' || tokenName === 'CredentialStore') {
    return tokenName;
  }
  return undefined;
}

export function applicationProviderImplementationName(implementation: unknown): string {
  if (typeof implementation === 'string') {
    return implementation;
  }
  const reflectedKind = implementation && typeof implementation === 'object' ? Reflect.get(implementation, 'kind') : undefined;
  if (typeof reflectedKind === 'string') {
    return reflectedKind;
  }
  return 'custom';
}
