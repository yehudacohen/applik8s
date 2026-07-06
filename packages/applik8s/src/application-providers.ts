import type { ApplicationMigrationContract, ApplicationProviderInterfaceKind, ApplicationProviderRuntimeContract, ApplicationResourceRef } from '@applik8s/core';

export interface ApplicationIndexBackendSelectionOptions {
  readonly cache?: readonly unknown[];
}

export type ApplicationIndexBackend = ApplicationValkeyIndexBackend;

export type ApplicationModelStoreProvider = ApplicationPostgresModelStoreProvider;

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

export interface ApplicationDefaults {
  readonly models?: ApplicationModelStoreProvider | ApplicationProviderBinding<ApplicationModelStoreProvider>;
  readonly indexes?: unknown;
  readonly counters?: unknown;
  readonly events?: unknown;
  readonly expose?: unknown;
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

export interface ApplicationProviderBinding<TImplementation = unknown> {
  readonly kind: 'applicationProvider';
  readonly token: ApplicationProviderToken<TImplementation>;
  readonly implementation: TImplementation;
}

export interface ApplicationProviderState {
  readonly defaults: { indexes?: unknown; models?: unknown };
  readonly providers: { indexes?: unknown; models?: unknown };
}

export const IndexStore: ApplicationProviderToken<ApplicationIndexBackend | 'valkey'> = {
  name: 'IndexStore',
  description: 'Default app-scoped index backend provider.',
};

export const ModelStore: ApplicationProviderToken<ApplicationModelStoreProvider> = {
  name: 'ModelStore',
  description: 'Default app-scoped storage-backed model provider.',
};

export const CounterStore: ApplicationProviderToken<unknown> = {
  name: 'CounterStore',
  description: 'Default app-scoped counter backend provider.',
};

export const EventSource: ApplicationProviderToken<unknown> = {
  name: 'EventSource',
  description: 'Default app-scoped event source provider.',
};

export const Secret: ApplicationProviderToken<unknown> = {
  name: 'Secret',
  description: 'Default app-scoped secret material provider.',
};

export const Queue: ApplicationProviderToken<unknown> = {
  name: 'Queue',
  description: 'Default app-scoped queue provider.',
};

export const ObjectStorage: ApplicationProviderToken<unknown> = {
  name: 'ObjectStorage',
  description: 'Default app-scoped object storage provider.',
};

export const HttpExposure: ApplicationProviderToken<unknown> = {
  name: 'HttpExposure',
  description: 'Default app-scoped HTTP exposure provider.',
};

export const CredentialStore: ApplicationProviderToken<unknown> = {
  name: 'CredentialStore',
  description: 'Default app-scoped credential storage provider.',
};

// typecast: provider registry names are literal public API keys used for app.provide(...) inference.
export const providers = { IndexStore, ModelStore, CounterStore, EventSource, Secret, Queue, ObjectStorage, HttpExposure, CredentialStore } as const;

export function defaultApplicationIndexBackend(state: ApplicationProviderState, options: ApplicationIndexBackendSelectionOptions, indexes: Readonly<Record<string, unknown>>): ApplicationIndexBackend | undefined {
  const provider = defaultApplicationIndexProvider(state);
  if ((options.cache?.length ?? 0) > 0 || (Object.keys(indexes).length > 0 && isValkeyIndexDefault(provider))) {
    return applicationIndexBackend(provider) ?? { kind: 'valkey' };
  }
  return undefined;
}

export function defaultApplicationIndexProvider(state: ApplicationProviderState): unknown {
  return state.defaults.indexes ?? state.providers.indexes;
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
  const tokenName = applicationProviderTokenName(token);
  if (applicationProviderInterface(tokenName)) {
    throw new Error(`app.provide(${tokenName}, ...) requires a generated provider adapter and runtime contract that is not enabled yet. This v0.3 provider interface is reserved but fails closed until its semantics are implemented.`);
  }
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

function isApplicationProviderBinding(value: unknown): value is ApplicationProviderBinding<ApplicationModelStoreProvider> {
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
