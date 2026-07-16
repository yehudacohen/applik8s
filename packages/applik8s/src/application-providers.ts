import type { ApplicationMigrationContract, ApplicationProviderInterfaceKind, ApplicationProviderRuntimeContract, ApplicationResourceRef } from '@applik8s/core';

export interface ApplicationIndexBackendSelectionOptions {
  readonly cache?: readonly unknown[];
}

export type ApplicationIndexBackend = ApplicationValkeyIndexBackend;

export type ApplicationModelStoreProvider = ApplicationPostgresModelStoreProvider;

export type ApplicationHttpExposureProvider = 'ingress' | ApplicationIngressHttpExposureProvider;
export type ApplicationCertificateProvider = ApplicationCertManagerCertificateProvider;
export type ApplicationDnsPublicationProvider = ApplicationExternalDnsPublicationProvider;

export interface ApplicationKubernetesResourceCounterStoreProvider { readonly kind: 'kubernetes-resource-counter'; readonly flushMs?: number }
export interface ApplicationKubernetesWatchEventSourceProvider { readonly kind: 'kubernetes-watch'; readonly resyncSeconds?: number }
export interface ApplicationKubernetesSecretProvider { readonly kind: 'kubernetes-secret'; readonly defaultOwnership?: 'external' | 'generated' }
export interface ApplicationKubernetesConfigMapQueueProvider { readonly kind: 'kubernetes-configmap-queue'; readonly maxDepth?: number; readonly maxMessageBytes?: number }
export interface ApplicationKubernetesConfigMapObjectStorageProvider { readonly kind: 'kubernetes-configmap-objects'; readonly maxObjectBytes?: number }
export interface ApplicationKubernetesCredentialStoreProvider { readonly kind: 'kubernetes-secret-credentials'; readonly defaultOwnership?: 'external' | 'generated' }
export interface ApplicationNatsJetStreamEventLogProvider {
  readonly kind: 'nats-jetstream';
  readonly name?: string;
  readonly namespace?: string;
  readonly provision?: boolean;
  readonly servers?: readonly string[];
  readonly stream?: string;
  readonly subjectPrefix?: string;
  readonly replicas?: number;
  readonly storageSize?: string;
  readonly connectionSecret?: ApplicationResourceRef;
  readonly authMode?: 'token' | 'userPassword';
  readonly tokenKey?: string;
  /** Hatchet tenant identifier required only when KEDA task-stat scaling is selected. */
  readonly tenantId?: string;
  readonly userKey?: string;
  readonly passwordKey?: string;
}

export type ApplicationCounterStoreProvider = ApplicationKubernetesResourceCounterStoreProvider;
export type ApplicationEventSourceProvider = ApplicationKubernetesWatchEventSourceProvider;
export type ApplicationSecretProvider = ApplicationKubernetesSecretProvider;
export type ApplicationQueueProvider = ApplicationKubernetesConfigMapQueueProvider;
export type ApplicationObjectStorageProvider = ApplicationKubernetesConfigMapObjectStorageProvider;
export type ApplicationCredentialStoreProvider = ApplicationKubernetesCredentialStoreProvider;
export type ApplicationEventLogProvider = ApplicationNatsJetStreamEventLogProvider;

export interface ApplicationHatchetWorkflowEngineProvider {
  readonly kind: 'hatchet';
  readonly name?: string;
  readonly namespace?: string;
  readonly provision?: boolean;
  readonly chartVersion?: string;
  readonly serverVersion?: string;
  readonly mode?: 'stack' | 'ha';
  readonly database?: {
    readonly provision?: boolean;
    readonly clusterName?: string;
    readonly database?: string;
    readonly instances?: number;
    readonly storageSize?: string;
    readonly storageClass?: string;
    readonly connectionSecret?: ApplicationResourceRef;
    readonly connectionSecretKey?: string;
  };
  /** External bootstrap credentials containing adminEmail and adminPassword. */
  readonly adminCredentialsSecret?: ApplicationResourceRef;
  /** Hatchet client-token Secret. Defaults to the chart-generated <name>-client-config Secret when provisioned. */
  readonly workerTokenSecret?: ApplicationResourceRef;
  /** @deprecated Use adminCredentialsSecret and workerTokenSecret when they differ. */
  readonly credentialsSecret?: ApplicationResourceRef;
  readonly tokenKey?: string;
  readonly hostPort?: string;
  readonly apiUrl?: string;
  readonly tls?: boolean;
  readonly dashboard?: 'disabled' | 'internal';
  readonly worker?: {
    readonly image?: string;
    readonly replicas?: number;
    readonly taskSlots?: number;
    readonly durableSlots?: number;
    readonly gracefulShutdownSeconds?: number;
    readonly healthPort?: number;
    /** Defaults to allowAll; choose sameNamespace for fully internal task effects. */
    readonly egress?: 'allowAll' | 'sameNamespace';
    readonly scaling?: { readonly mode: 'fixed' } | { readonly mode: 'kedaHatchetSlots'; readonly minReplicas?: number; readonly maxReplicas: number; readonly pollingIntervalSeconds?: number };
  };
}

export type ApplicationWorkflowEngineProvider = ApplicationHatchetWorkflowEngineProvider;

export interface ApplicationClickHouseProjectionStoreProvider {
  readonly kind: 'clickhouse';
  readonly name?: string;
  readonly namespace?: string;
  readonly provision?: boolean;
  readonly version?: string;
  readonly storageSize?: string;
  readonly storageClassName?: string;
  readonly endpoint?: string;
  readonly database?: string;
  readonly credentialsSecret?: ApplicationResourceRef;
  readonly usernameKey?: string;
  readonly passwordKey?: string;
}

export type ApplicationProjectionStoreProvider = ApplicationClickHouseProjectionStoreProvider;

export interface ApplicationRequestAdmission {
  readonly principal: {
    readonly id: string;
    readonly claims?: Readonly<Record<string, unknown>>;
    can?(action: string, model: unknown, identity?: unknown): boolean | Promise<boolean>;
  };
  readonly trustedContext: Readonly<Record<string, import('@applik8s/core').JsonValue>>;
  readonly authorizationVersion: string;
}

export interface ApplicationRequestIdentityProvider {
  readonly kind: 'request-identity';
  authenticate(request: Request): ApplicationRequestAdmission | Promise<ApplicationRequestAdmission>;
}

export interface ApplicationKubernetesHostProvider {
  readonly kind: 'kubernetes-application-host';
  readonly namespace?: string;
  readonly name?: string;
  /** Immutable target image reference. Omit for a locally built digest-tagged image. */
  readonly image?: string;
  readonly imagePullPolicy?: 'Always' | 'IfNotPresent' | 'Never';
  readonly replicas?: number;
  readonly port?: number;
  readonly serviceAccountName?: string;
  readonly cursorSecret?: { readonly name?: string; readonly key?: string };
  readonly resources?: {
    readonly requests?: { readonly cpu?: string; readonly memory?: string };
    readonly limits?: { readonly cpu?: string; readonly memory?: string };
  };
}

export type ApplicationHostProvider = ApplicationKubernetesHostProvider;

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

export interface ApplicationCertManagerCertificateProvider {
  readonly kind: 'cert-manager';
  readonly issuerRef: {
    readonly name: string;
    readonly kind: 'Issuer' | 'ClusterIssuer';
  };
  readonly duration?: string;
  readonly renewBefore?: string;
}

export interface ApplicationExternalDnsPublicationProvider {
  readonly kind: 'external-dns';
  readonly annotationPrefix?: string;
}

export interface ApplicationDefaults {
  readonly models?: ApplicationModelStoreProvider | ApplicationProviderBinding<ApplicationModelStoreProvider>;
  readonly indexes?: unknown;
  readonly counters?: ApplicationCounterStoreProvider;
  readonly events?: ApplicationEventSourceProvider;
  readonly eventLog?: ApplicationEventLogProvider | ApplicationProviderBinding<ApplicationEventLogProvider>;
  readonly secrets?: ApplicationSecretProvider;
  readonly queues?: ApplicationQueueProvider;
  readonly objects?: ApplicationObjectStorageProvider;
  readonly credentials?: ApplicationCredentialStoreProvider;
  readonly expose?: ApplicationHttpExposureProvider | ApplicationProviderBinding<ApplicationHttpExposureProvider>;
  readonly certificates?: ApplicationCertificateProvider | ApplicationProviderBinding<ApplicationCertificateProvider>;
  readonly dns?: ApplicationDnsPublicationProvider | ApplicationProviderBinding<ApplicationDnsPublicationProvider>;
  readonly projections?: ApplicationProjectionStoreProvider | ApplicationProviderBinding<ApplicationProjectionStoreProvider>;
}

export interface ApplicationDefaultsBinding {
  readonly kind: 'applicationDefaults';
  readonly defaults: ApplicationDefaults;
}

export interface ApplicationProviderToken<TImplementation = unknown> {
  readonly name: string;
  readonly description?: string;
  readonly contract?: ApplicationTypedProviderContract;
  readonly accepts?: (implementation: unknown) => implementation is TImplementation;
  readonly __implementation?: TImplementation;
}

export interface ApplicationTypedProviderContract {
  readonly apiVersion: 'applik8s.provider/v1alpha1';
  readonly interface: string;
  readonly version: string;
  readonly requirements: readonly string[];
  readonly guarantees: readonly string[];
}

export function defineApplicationProvider<TImplementation>(options: {
  readonly interface: string;
  readonly version: string;
  readonly description?: string;
  readonly requirements?: readonly string[];
  readonly guarantees?: readonly string[];
  readonly accepts: (implementation: unknown) => implementation is TImplementation;
}): ApplicationProviderToken<TImplementation> {
  if (!/^[A-Z][A-Za-z0-9]*$/.test(options.interface)) throw new Error(`Application provider interface ${JSON.stringify(options.interface)} must be a stable UpperCamelCase identifier.`);
  if (!/^v[1-9][0-9]*(?:(?:alpha|beta)[1-9][0-9]*)?$/.test(options.version)) throw new Error(`Application provider interface ${options.interface} must declare an explicit version such as v1 or v1alpha1.`);
  return {
    name: options.interface,
    ...(options.description ? { description: options.description } : {}),
    contract: { apiVersion: 'applik8s.provider/v1alpha1', interface: options.interface, version: options.version, requirements: [...(options.requirements ?? [])], guarantees: [...(options.guarantees ?? [])] },
    accepts: options.accepts,
  };
}

export interface ApplicationModelStoreProviderToken extends ApplicationProviderToken<ApplicationModelStoreProvider> {
  postgres(options?: ApplicationPostgresModelStoreOptions): ApplicationPostgresModelStoreProvider;
  readonly migrations: {
    generatedJob(options?: ApplicationGeneratedModelStoreMigrationJobOptions): ApplicationModelStoreMigrationPolicy;
  };
}

export interface ApplicationCertificateProviderToken extends ApplicationProviderToken<ApplicationCertificateProvider> {
  certManager(options: Omit<ApplicationCertManagerCertificateProvider, 'kind'>): ApplicationCertManagerCertificateProvider;
}

export interface ApplicationDnsPublicationProviderToken extends ApplicationProviderToken<ApplicationDnsPublicationProvider> {
  externalDns(options?: Omit<ApplicationExternalDnsPublicationProvider, 'kind'>): ApplicationExternalDnsPublicationProvider;
}

export interface ApplicationWorkflowEngineProviderToken extends ApplicationProviderToken<ApplicationWorkflowEngineProvider> {
  hatchet(options?: Omit<ApplicationHatchetWorkflowEngineProvider, 'kind'>): ApplicationHatchetWorkflowEngineProvider;
}

export interface ApplicationProjectionStoreProviderToken extends ApplicationProviderToken<ApplicationProjectionStoreProvider> {
  clickhouse(options?: Omit<ApplicationClickHouseProjectionStoreProvider, 'kind'>): ApplicationClickHouseProjectionStoreProvider;
}

export interface ApplicationHostProviderToken extends ApplicationProviderToken<ApplicationHostProvider> {
  kubernetes(options?: Omit<ApplicationKubernetesHostProvider, 'kind'>): ApplicationKubernetesHostProvider;
}

export interface ApplicationRequestIdentityProviderToken extends ApplicationProviderToken<ApplicationRequestIdentityProvider> {
  from(authenticate: ApplicationRequestIdentityProvider['authenticate']): ApplicationRequestIdentityProvider;
}

export interface ApplicationProviderBindingBase<TImplementation = unknown> {
  readonly kind: 'applicationProvider';
  readonly token: ApplicationProviderToken<TImplementation>;
  readonly implementation: TImplementation;
}

export interface ApplicationHostBinding extends Omit<ApplicationProviderBindingBase<ApplicationHostProvider>, 'kind'> {
  readonly kind: 'applicationHost';
  readonly service: { readonly name: string; readonly namespace: string; readonly port: number };
  readonly status: { readonly ready: boolean };
  readonly image: { readonly digest: string };
  readonly url: { readonly internal: string };
}

export type ApplicationProviderBinding<TImplementation = unknown> =
  TImplementation extends ApplicationHostProvider
    ? ApplicationHostBinding
    : ApplicationProviderBindingBase<TImplementation>;

export interface ApplicationProviderState {
  readonly defaults: { indexes?: unknown; models?: unknown; counters?: unknown; events?: unknown; eventLogs?: unknown; secrets?: unknown; queues?: unknown; objects?: unknown; expose?: unknown; certificates?: unknown; dns?: unknown; credentials?: unknown; projections?: unknown };
  readonly providers: { indexes?: unknown; models?: unknown; counters?: unknown; events?: unknown; eventLogs?: unknown; secrets?: unknown; queues?: unknown; objects?: unknown; expose?: unknown; certificates?: unknown; dns?: unknown; credentials?: unknown; projections?: unknown; extensions?: Record<string, unknown> };
}

export const IndexStore: ApplicationProviderToken<ApplicationIndexBackend | 'valkey'> = {
  name: 'IndexStore',
  description: 'Default app-scoped index backend provider.',
  contract: builtInProviderContract('IndexStore', ['typedIndexes']),
};

export const ModelStore: ApplicationModelStoreProviderToken = {
  name: 'ModelStore',
  description: 'Default app-scoped storage-backed model provider.',
  contract: builtInProviderContract('ModelStore', ['transactions', 'strongReads']),
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
  contract: builtInProviderContract('CounterStore', ['atomicIncrement']),
};

export const EventSource: ApplicationProviderToken<ApplicationEventSourceProvider> = {
  name: 'EventSource',
  description: 'Default app-scoped event source provider.',
  contract: builtInProviderContract('EventSource', ['watch']),
};

export const EventLog: ApplicationProviderToken<ApplicationEventLogProvider> = {
  name: 'EventLog',
  description: 'Durable app-scoped command and committed-event transport provider.',
  contract: builtInProviderContract('EventLog', ['atLeastOnce', 'stableMessageIds', 'replay']),
};

export const Secret: ApplicationProviderToken<ApplicationSecretProvider> = {
  name: 'Secret',
  description: 'Default app-scoped secret material provider.',
  contract: builtInProviderContract('Secret', ['secretReferences']),
};

export const Queue: ApplicationProviderToken<ApplicationQueueProvider> = {
  name: 'Queue',
  description: 'Default app-scoped queue provider.',
  contract: builtInProviderContract('Queue', ['boundedDelivery']),
};

export const ObjectStorage: ApplicationProviderToken<ApplicationObjectStorageProvider> = {
  name: 'ObjectStorage',
  description: 'Default app-scoped object storage provider.',
  contract: builtInProviderContract('ObjectStorage', ['objectReadWrite']),
};

export const HttpExposure: ApplicationProviderToken<ApplicationHttpExposureProvider> = {
  name: 'HttpExposure',
  description: 'Default app-scoped HTTP exposure provider.',
  contract: builtInProviderContract('HttpExposure', ['httpRouting']),
};

export const Certificate: ApplicationCertificateProviderToken = {
  name: 'Certificate',
  description: 'Managed TLS certificate provider for public application exposure.',
  contract: builtInProviderContract('Certificate', ['managedCertificate']),
  certManager(options) {
    return { kind: 'cert-manager', ...options };
  },
};

export const DnsPublication: ApplicationDnsPublicationProviderToken = {
  name: 'DnsPublication',
  description: 'Managed DNS publication provider for public application exposure.',
  contract: builtInProviderContract('DnsPublication', ['dnsPublication']),
  externalDns(options = {}) {
    return { kind: 'external-dns', ...options };
  },
};

export const CredentialStore: ApplicationProviderToken<ApplicationCredentialStoreProvider> = {
  name: 'CredentialStore',
  description: 'Default app-scoped credential storage provider.',
  contract: builtInProviderContract('CredentialStore', ['credentialReferences']),
};

export const WorkflowEngine: ApplicationWorkflowEngineProviderToken = {
  name: 'WorkflowEngine',
  description: 'Provider-neutral durable task and workflow execution engine.',
  contract: {
    apiVersion: 'applik8s.provider/v1alpha1',
    interface: 'WorkflowEngine',
    version: 'v1alpha1',
    requirements: ['durableTaskExecution', 'durableWaits', 'cancellation', 'externalEvents', 'workerDrain'],
    guarantees: ['atLeastOnceTasks', 'durableWorkflowHistory', 'correlationPropagation', 'postgresOperationalAuthority'],
  },
  accepts: isHatchetWorkflowEngineProvider,
  hatchet(options = {}) {
    return { kind: 'hatchet', ...options };
  },
};

export const ProjectionStore: ApplicationProjectionStoreProviderToken = {
  name: 'ProjectionStore',
  description: 'Rebuildable analytical projection storage; durable replay remains owned by the source stream.',
  contract: builtInProviderContract('ProjectionStore', ['idempotentInsert', 'checkpoint', 'fullRebuild']),
  accepts: isClickHouseProjectionStoreProvider,
  clickhouse(options = {}) {
    return { kind: 'clickhouse', ...options };
  },
};

export const ApplicationHost: ApplicationHostProviderToken = {
  name: 'ApplicationHost',
  description: 'Immutable application artifact hosting and runtime lifecycle.',
  contract: builtInProviderContract('ApplicationHost', ['immutableArtifact', 'readiness', 'gracefulShutdown', 'serviceDiscovery']),
  accepts: isKubernetesApplicationHostProvider,
  kubernetes(options = {}) {
    if (options.replicas !== undefined && (!Number.isInteger(options.replicas) || options.replicas < 1)) {
      throw new Error('ApplicationHost.kubernetes({ replicas }) requires a positive integer.');
    }
    if (options.port !== undefined && (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535)) {
      throw new Error('ApplicationHost.kubernetes({ port }) requires a valid TCP port.');
    }
    if (options.image !== undefined && !options.image.trim()) {
      throw new Error('ApplicationHost.kubernetes({ image }) must not be empty.');
    }
    if (options.cursorSecret?.name !== undefined && !options.cursorSecret.name.trim()) {
      throw new Error('ApplicationHost.kubernetes({ cursorSecret.name }) must not be empty.');
    }
    if (options.cursorSecret?.key !== undefined && !options.cursorSecret.key.trim()) {
      throw new Error('ApplicationHost.kubernetes({ cursorSecret.key }) must not be empty.');
    }
    return { kind: 'kubernetes-application-host', ...options };
  },
};

export const RequestIdentity: ApplicationRequestIdentityProviderToken = {
  name: 'RequestIdentity',
  description: 'Application-supplied request authentication and trusted-context admission.',
  contract: builtInProviderContract('RequestIdentity', ['principalIdentity', 'trustedContextAdmission', 'authorizationVersion']),
  accepts: isApplicationRequestIdentityProvider,
  from(authenticate) {
    return { kind: 'request-identity', authenticate };
  },
};

function builtInProviderContract(providerInterface: string, guarantees: readonly string[]): ApplicationTypedProviderContract {
  return { apiVersion: 'applik8s.provider/v1alpha1', interface: providerInterface, version: 'v1alpha1', requirements: [], guarantees };
}

// typecast: provider registry names are literal public API keys used for app.provide(...) inference.
export const providers = { IndexStore, ModelStore, CounterStore, EventSource, EventLog, Secret, Queue, ObjectStorage, HttpExposure, Certificate, DnsPublication, CredentialStore, WorkflowEngine, ProjectionStore, ApplicationHost, RequestIdentity } as const;

export function applicationTypedProviderContract(name: string | undefined): ApplicationTypedProviderContract | undefined {
  if (!name) return undefined;
  return Object.values(providers).find((token) => token.name === name)?.contract;
}

export const defaultApplicationEventLogProvider: ApplicationEventLogProvider = {
  kind: 'nats-jetstream',
  name: 'applik8s-events',
  provision: true,
  stream: 'APPLIK8S_EVENTS',
  subjectPrefix: 'applik8s',
  replicas: 1,
  storageSize: '8Gi',
};

export const defaultApplicationWorkflowEngineProvider: ApplicationWorkflowEngineProvider = {
  kind: 'hatchet',
  name: 'applik8s-hatchet',
  provision: true,
  chartVersion: '0.12.4',
  serverVersion: 'v0.90.13',
  mode: 'stack',
  tls: false,
  database: { provision: true, database: 'hatchet', instances: 1, storageSize: '8Gi' },
  dashboard: 'internal',
  worker: { replicas: 1, taskSlots: 16, durableSlots: 16, gracefulShutdownSeconds: 30, healthPort: 8001, scaling: { mode: 'fixed' } },
};

export const defaultApplicationProviders: {
  readonly IndexStore: ApplicationValkeyIndexBackend;
  readonly ModelStore: ApplicationPostgresModelStoreProvider;
  readonly CounterStore: ApplicationCounterStoreProvider;
  readonly EventSource: ApplicationEventSourceProvider;
  readonly Secret: ApplicationSecretProvider;
  readonly Queue: ApplicationQueueProvider;
  readonly ObjectStorage: ApplicationObjectStorageProvider;
  readonly HttpExposure: ApplicationIngressHttpExposureProvider;
  readonly Certificate: undefined;
  readonly DnsPublication: undefined;
  readonly CredentialStore: ApplicationCredentialStoreProvider;
  readonly WorkflowEngine: ApplicationWorkflowEngineProvider;
} = {
  IndexStore: { kind: 'valkey' },
  ModelStore: { kind: 'postgres' },
  CounterStore: { kind: 'kubernetes-resource-counter', flushMs: 1000 },
  EventSource: { kind: 'kubernetes-watch', resyncSeconds: 300 },
  Secret: { kind: 'kubernetes-secret', defaultOwnership: 'external' },
  Queue: { kind: 'kubernetes-configmap-queue', maxDepth: 1000, maxMessageBytes: 65536 },
  ObjectStorage: { kind: 'kubernetes-configmap-objects', maxObjectBytes: 524288 },
  HttpExposure: { kind: 'ingress' },
  Certificate: undefined,
  DnsPublication: undefined,
  CredentialStore: { kind: 'kubernetes-secret-credentials', defaultOwnership: 'external' },
  WorkflowEngine: defaultApplicationWorkflowEngineProvider,
};

export function isHatchetWorkflowEngineProvider(value: unknown): value is ApplicationHatchetWorkflowEngineProvider {
  return Boolean(value && typeof value === 'object' && Reflect.get(value, 'kind') === 'hatchet');
}

export function isClickHouseProjectionStoreProvider(value: unknown): value is ApplicationClickHouseProjectionStoreProvider {
  return Boolean(value && typeof value === 'object' && Reflect.get(value, 'kind') === 'clickhouse');
}

export function applicationProjectionStoreImplementation(value: unknown): ApplicationProjectionStoreProvider | undefined {
  if (isClickHouseProjectionStoreProvider(value)) return value;
  if (isApplicationProviderBinding(value) && value.token === ProjectionStore && isClickHouseProjectionStoreProvider(value.implementation)) return value.implementation;
  return undefined;
}

export function applicationWorkflowEngineImplementation(state: ApplicationProviderState): ApplicationWorkflowEngineProvider {
  const selected = state.providers.extensions?.['WorkflowEngine@v1alpha1'];
  if (isHatchetWorkflowEngineProvider(selected)) {
    const scaling = selected.worker?.scaling ?? defaultApplicationWorkflowEngineProvider.worker?.scaling;
    return {
      ...defaultApplicationWorkflowEngineProvider,
      ...selected,
      database: { ...defaultApplicationWorkflowEngineProvider.database, ...selected.database },
      worker: {
        ...defaultApplicationWorkflowEngineProvider.worker,
        ...selected.worker,
        ...(scaling ? { scaling } : {}),
      },
    };
  }
  return defaultApplicationWorkflowEngineProvider;
}

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

// typecast-boundary: provider tokens are identity-based and compared only after their public name and implementation contract are validated.
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
  if (applicationProviderTokenName(token) === 'Certificate') {
    if (!isCertManagerCertificateProvider(implementation)) {
      throw new Error('app.provide(Certificate, ...) currently supports only the cert-manager certificate provider. Use Certificate.certManager({ issuerRef: ... }).');
    }
    state.providers.certificates = implementation;
    return;
  }
  if (applicationProviderTokenName(token) === 'DnsPublication') {
    if (!isExternalDnsPublicationProvider(implementation)) {
      throw new Error('app.provide(DnsPublication, ...) currently supports only the external-dns publication provider. Use DnsPublication.externalDns().');
    }
    state.providers.dns = implementation;
    return;
  }
  if (applicationProviderTokenName(token) === 'ProjectionStore') {
    if (!isClickHouseProjectionStoreProvider(implementation)) {
      throw new Error('app.provide(ProjectionStore, ...) currently supports the ClickHouse projection provider. Use ProjectionStore.clickhouse(...).');
    }
    state.providers.projections = implementation;
    return;
  }
  if ((token as unknown) === WorkflowEngine) {
    if (!isHatchetWorkflowEngineProvider(implementation)) {
      throw new Error('app.provide(WorkflowEngine, ...) currently supports the Hatchet workflow provider. Use WorkflowEngine.hatchet(...).');
    }
    if (!state.providers.extensions) state.providers.extensions = {};
    state.providers.extensions['WorkflowEngine@v1alpha1'] = implementation;
    return;
  }
  if ((token as unknown) === ApplicationHost) {
    if (!isKubernetesApplicationHostProvider(implementation)) {
      throw new Error('app.provide(ApplicationHost, ...) currently supports ApplicationHost.kubernetes(...).');
    }
    if (!state.providers.extensions) state.providers.extensions = {};
    state.providers.extensions['ApplicationHost@v1alpha1'] = implementation;
    return;
  }
  if ((token as unknown) === RequestIdentity) {
    if (!isApplicationRequestIdentityProvider(implementation)) {
      throw new Error('app.provide(RequestIdentity, ...) requires RequestIdentity.from(authenticate).');
    }
    if (!state.providers.extensions) state.providers.extensions = {};
    state.providers.extensions['RequestIdentity@v1alpha1'] = implementation;
    return;
  }
  const tokenName = applicationProviderTokenName(token);
  const field = applicationProviderStateField(tokenName);
  if (field && isSupportedDefaultProvider(tokenName, implementation)) {
    state.providers[field] = implementation;
    return;
  }
  if (applicationProviderInterface(tokenName) && Object.values(providers).some((candidate) => (candidate as unknown) === token)) {
    throw new Error(`app.provide(${tokenName}, ...) does not match the bounded v0.3 Kubernetes-native provider contract.`);
  }
  if (token.contract) {
    if (token.contract.interface !== token.name) throw new Error(`app.provide(${token.name}, ...) provider token contract interface does not match its public name.`);
    if (!token.accepts?.(implementation)) throw new Error(`app.provide(${token.name}, ...) does not satisfy versioned provider contract ${token.contract.interface}/${token.contract.version}.`);
    if (!state.providers.extensions) state.providers.extensions = {};
    state.providers.extensions[`${token.contract.interface}@${token.contract.version}`] = implementation;
    return;
  }
  if (applicationProviderInterface(tokenName)) {
    throw new Error(`app.provide(${tokenName}, ...) does not match the bounded v0.3 Kubernetes-native provider contract.`);
  }
  throw new Error(`app.provide(${tokenName}, ...) requires a versioned provider token created with defineApplicationProvider().`);
}

function applicationProviderStateField(tokenName: string | undefined): 'counters' | 'events' | 'eventLogs' | 'secrets' | 'queues' | 'objects' | 'credentials' | undefined {
  if (tokenName === 'CounterStore') return 'counters';
  if (tokenName === 'EventSource') return 'events';
  if (tokenName === 'EventLog') return 'eventLogs';
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
    || (tokenName === 'EventLog' && kind === 'nats-jetstream')
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

export function isCertManagerCertificateProvider(value: unknown): value is ApplicationCertManagerCertificateProvider {
  const issuerRef = value && typeof value === 'object' ? Reflect.get(value, 'issuerRef') : undefined;
  return Boolean(
    value
    && typeof value === 'object'
    && Reflect.get(value, 'kind') === 'cert-manager'
    && issuerRef
    && typeof issuerRef === 'object'
    && typeof Reflect.get(issuerRef, 'name') === 'string'
    && (Reflect.get(issuerRef, 'kind') === 'Issuer' || Reflect.get(issuerRef, 'kind') === 'ClusterIssuer')
  );
}

export function applicationCertificateImplementation(value: unknown): ApplicationCertificateProvider | undefined {
  if (isCertManagerCertificateProvider(value)) return value;
  if (isApplicationProviderBinding(value) && value.token === Certificate && isCertManagerCertificateProvider(value.implementation)) {
    return value.implementation;
  }
  return undefined;
}

export function isExternalDnsPublicationProvider(value: unknown): value is ApplicationExternalDnsPublicationProvider {
  return Boolean(value && typeof value === 'object' && Reflect.get(value, 'kind') === 'external-dns');
}

export function applicationDnsPublicationImplementation(value: unknown): ApplicationDnsPublicationProvider | undefined {
  if (isExternalDnsPublicationProvider(value)) return value;
  if (isApplicationProviderBinding(value) && value.token === DnsPublication && isExternalDnsPublicationProvider(value.implementation)) {
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

export function applicationEventLogImplementation(value: unknown): ApplicationEventLogProvider | undefined {
  if (value && typeof value === 'object' && Reflect.get(value, 'kind') === 'nats-jetstream') {
    // typecast: the provider kind discriminant narrows the supported JetStream EventLog provider.
    return value as ApplicationEventLogProvider;
  }
  if (isApplicationProviderBinding(value) && value.token === EventLog && value.implementation && typeof value.implementation === 'object' && Reflect.get(value.implementation, 'kind') === 'nats-jetstream') {
    // typecast: the EventLog token plus provider kind narrows the bound implementation.
    return value.implementation as ApplicationEventLogProvider;
  }
  return undefined;
}

function isApplicationProviderBinding(value: unknown): value is ApplicationProviderBinding<unknown> {
  const kind = value && typeof value === 'object' ? Reflect.get(value, 'kind') : undefined;
  return kind === 'applicationProvider' || kind === 'applicationHost';
}

export function applicationProviderTokenName(token: ApplicationProviderToken<unknown>): string {
  return token.name;
}

export function applicationProviderInterface(tokenName: string | undefined): ApplicationProviderInterfaceKind | undefined {
  if (tokenName === 'IndexStore' || tokenName === 'ModelStore' || tokenName === 'CounterStore' || tokenName === 'EventSource' || tokenName === 'EventLog' || tokenName === 'Secret' || tokenName === 'Queue' || tokenName === 'ObjectStorage' || tokenName === 'HttpExposure' || tokenName === 'Certificate' || tokenName === 'DnsPublication' || tokenName === 'CredentialStore' || tokenName === 'WorkflowEngine' || tokenName === 'ProjectionStore' || tokenName === 'ApplicationHost' || tokenName === 'RequestIdentity') {
    return tokenName;
  }
  return undefined;
}

export function isApplicationRequestIdentityProvider(value: unknown): value is ApplicationRequestIdentityProvider {
  return Boolean(value && typeof value === 'object' && Reflect.get(value, 'kind') === 'request-identity' && typeof Reflect.get(value, 'authenticate') === 'function');
}

export function isKubernetesApplicationHostProvider(value: unknown): value is ApplicationKubernetesHostProvider {
  return Boolean(value && typeof value === 'object' && Reflect.get(value, 'kind') === 'kubernetes-application-host');
}

export function applicationHostBinding(
  token: ApplicationHostProviderToken,
  implementation: ApplicationHostProvider,
  applicationName: string,
  defaultNamespace?: string,
): ApplicationHostBinding {
  const name = implementation.name ?? `${applicationName}-web`;
  const namespace = implementation.namespace ?? defaultNamespace ?? 'default';
  const port = implementation.port ?? 3000;
  return {
    kind: 'applicationHost',
    token,
    implementation,
    service: { name, namespace, port },
    status: { ready: false },
    image: { digest: 'sha256:pending-build' },
    url: { internal: `http://${name}.${namespace}.svc:${port}` },
  };
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
