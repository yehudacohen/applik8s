// typecast-file-boundary: provider constructors validate structural runtime input before restoring provider-specific discriminated contracts.
import type { ApplicationMigrationContract, ApplicationProviderInterfaceKind, ApplicationProviderRuntimeContract, ApplicationResourceRef } from '@applik8s/core';
import { Cel } from 'typekro';
import type { OryIdentityStackConfig, OryPlatformStackConfig } from 'typekro/ory';
import { applicationTypeKroExpressionValue, applicationTypeKroString } from './application-typekro-values.js';
import { StructuredGeneration, isApplicationStructuredGenerationProvider } from './structured-generation.js';

export { StructuredGeneration, isApplicationStructuredGenerationProvider } from './structured-generation.js';
export type { ApplicationStructuredGenerationDeterministicProvider, ApplicationStructuredGenerationHttpProvider, ApplicationStructuredGenerationProvider, ApplicationStructuredGenerationProviderToken } from './structured-generation.js';

export interface ApplicationIndexBackendSelectionOptions {
  readonly cache?: readonly unknown[];
}

export type ApplicationIndexBackend = ApplicationValkeyIndexBackend;

export type ApplicationTransactionalDatabaseProvider = ApplicationPostgresTransactionalDatabaseProvider;

export type ApplicationHttpExposureProvider =
  | 'ingress'
  | ApplicationIngressHttpExposureProvider
  | ApplicationNodePortHttpExposureProvider;
export type ApplicationCertificateProvider = ApplicationCertManagerCertificateProvider;
export type ApplicationDnsPublicationProvider = ApplicationExternalDnsPublicationProvider;

export interface ApplicationKubernetesResourceCounterStoreProvider { readonly kind: 'kubernetes-resource-counter'; readonly flushMs?: number }
export interface ApplicationKubernetesWatchEventSourceProvider { readonly kind: 'kubernetes-watch'; readonly resyncSeconds?: number }
export interface ApplicationKubernetesSecretProvider { readonly kind: 'kubernetes-secret'; readonly defaultOwnership?: 'external' | 'generated' }
export interface ApplicationKubernetesConfigMapQueueProvider { readonly kind: 'kubernetes-configmap-queue'; readonly maxDepth?: number; readonly maxMessageBytes?: number }
export interface ApplicationKubernetesConfigMapObjectStorageProvider { readonly kind: 'kubernetes-configmap-objects'; readonly maxObjectBytes?: number }
export interface ApplicationS3ObjectStorageProvider {
  readonly kind: 's3';
  /** Typed desired-state switch. Disabled providers are omitted and do not block installation readiness. */
  readonly enabled?: boolean;
  readonly name?: string;
  readonly bucket: string;
  /** Provider-level prefix. Logical store names are appended beneath it. */
  readonly prefix?: string;
  readonly region: string;
  readonly endpoint?: string;
  readonly forcePathStyle?: boolean;
  readonly credentialsSecret?: ApplicationResourceRef;
  readonly accessKeyIdKey?: string;
  readonly secretAccessKeyKey?: string;
  readonly sessionTokenKey?: string;
  /** External providers are referenced; direct provisioners may prepare a bucket before the Application instance exists. */
  readonly ownership?: 'external' | 'direct-provisioned';
  readonly provisioning?: {
    /** Typed desired-state switch for the app-owned OBC provisioning boundary. */
    readonly enabled?: boolean;
    readonly claimName?: string;
    readonly storageClassName: string;
    readonly timeoutMs?: number;
    /** OBC deletion removes credentials and the claim; retained bucket data follows the StorageClass reclaim policy. */
    readonly claimLifecycle?: 'application';
  };
  readonly publicBaseUrl?: string;
}
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
  readonly storageClassName?: string;
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
export type ApplicationObjectStorageProvider = ApplicationKubernetesConfigMapObjectStorageProvider | ApplicationS3ObjectStorageProvider;
export type ApplicationCredentialStoreProvider = ApplicationKubernetesCredentialStoreProvider;
export type ApplicationEventLogProvider = ApplicationNatsJetStreamEventLogProvider;

export interface ApplicationHatchetWorkflowEngineProvider {
  readonly kind: 'hatchet';
  /** Typed desired-state switch for the provider and its generated workers. */
  readonly enabled?: boolean;
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
  /** Hatchet client-token Secret. Defaults to the chart-generated hatchet-client-config Secret when provisioned. */
  readonly workerTokenSecret?: ApplicationResourceRef;
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

export interface ApplicationClickHouseAnalyticalDatabaseProvider {
  readonly kind: 'clickhouse';
  /** Typed desired-state switch for analytical storage and projection workers. */
  readonly enabled?: boolean;
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

export type ApplicationAnalyticalDatabaseProvider = ApplicationClickHouseAnalyticalDatabaseProvider;

export type ApplicationContainerRegistryEndpoint =
  | { readonly kind: 'origin'; readonly origin: string }
  | {
      readonly kind: 'kubernetes-node-port';
      readonly namespace: string;
      readonly service: string;
      readonly port: number;
      readonly protocol: 'http' | 'https';
      /** Optional deployer/BuildKit-visible host. Defaults to the selected node's InternalIP. */
      readonly publishHost?: string;
      /** Optional node-runtime-visible host used in rendered immutable image references. */
      readonly pullHost?: string;
    };

export interface ApplicationContainerRegistrySecretRef
  extends Omit<ApplicationResourceRef, 'apiVersion' | 'kind' | 'name' | 'namespace'> {
  readonly apiVersion: 'v1';
  readonly kind: 'Secret';
  readonly name: string;
  readonly namespace: string;
}

export interface ApplicationContainerRegistryCredentialSecret extends ApplicationContainerRegistrySecretRef {
  /** Non-secret fixed username paired with passwordKey; mutually exclusive with usernameKey. */
  readonly username?: string;
  readonly usernameKey?: string;
  readonly passwordKey?: string;
  readonly dockerConfigJsonKey?: string;
}

export interface ApplicationHarborProjectManagement {
  /** Harbor administrator credential coordinates. Values are resolved only during deployment. */
  readonly adminCredentials: ApplicationContainerRegistryCredentialSecret;
  /** Namespace where purpose-scoped push and pull robot Secrets are reconciled. */
  readonly secretNamespace: string;
  readonly pushRobotName?: string;
  readonly pushSecretName?: string;
  readonly pullRobotName?: string;
  readonly pullSecretName?: string;
  readonly storageLimitBytes?: number;
  readonly autoScan?: boolean;
  readonly autoSbomGeneration?: boolean;
  readonly immutableTags?: {
    readonly repositoryPattern?: string;
    readonly tagPattern?: string;
  };
  readonly retention?: {
    readonly keepMostRecent: number;
    readonly scheduleCron?: string;
    readonly repositoryPattern?: string;
    readonly tagPattern?: string;
    readonly includeUntagged?: boolean;
  };
  /**
   * Lifecycle of the installation-scoped Harbor project. Retention is the
   * default. Deletion is deliberately explicit because purging repositories
   * is irreversible and happens only after the KRO instance has finalized.
   */
  readonly projectLifecycle?: {
    readonly deletionPolicy: 'retain' | 'delete';
    readonly purgeRepositories?: boolean;
    readonly timeoutMs?: number;
  };
}

export interface ApplicationContainerRegistryTls {
  readonly plainHttp?: boolean;
  readonly insecure?: boolean;
  /** Public CA trust may be read from a file at deployment time; credential material is never accepted here. */
  readonly caFile?: string;
}

export interface ApplicationOrbstackContainerRegistryProvider {
  readonly kind: 'orbstack-container-registry';
}

export interface ApplicationOciContainerRegistryProvider {
  readonly kind: 'oci-container-registry';
  readonly endpoint: ApplicationContainerRegistryEndpoint;
  readonly repositoryPrefix?: string;
  readonly pushCredentials?: ApplicationContainerRegistryCredentialSecret;
  /** Least-privilege dockerconfig Secret already projected into each consuming namespace. */
  readonly pullSecret?: ApplicationContainerRegistrySecretRef;
  readonly tls?: ApplicationContainerRegistryTls;
}

export interface ApplicationHarborContainerRegistryProvider
  extends Omit<ApplicationOciContainerRegistryProvider, 'kind' | 'repositoryPrefix' | 'pushCredentials' | 'pullSecret'> {
  readonly kind: 'harbor-container-registry';
  readonly project: string;
  readonly pushCredentials: ApplicationContainerRegistryCredentialSecret;
  readonly pullSecret: ApplicationContainerRegistrySecretRef;
  readonly management?: ApplicationHarborProjectManagement;
}

export type ApplicationHarborContainerRegistryOptions =
  | (Omit<ApplicationHarborContainerRegistryProvider, 'kind' | 'pushCredentials' | 'pullSecret' | 'management'> & {
      readonly management: ApplicationHarborProjectManagement;
      readonly pushCredentials?: never;
      readonly pullSecret?: never;
    })
  | Omit<ApplicationHarborContainerRegistryProvider, 'kind' | 'management'>;

export type ApplicationContainerRegistryProvider =
  | ApplicationOrbstackContainerRegistryProvider
  | ApplicationOciContainerRegistryProvider
  | ApplicationHarborContainerRegistryProvider;

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
  readonly infrastructure?: ApplicationIdentityInfrastructure;
  authenticate(request: Request): ApplicationRequestAdmission | Promise<ApplicationRequestAdmission>;
  /** Bounded credential-free capability probe used by generated workload readiness. */
  ready?(): void | Promise<void>;
}

export interface ApplicationIdentityInfrastructure {
  readonly kind: 'ory';
  readonly stack: 'identity' | 'platform';
  readonly provision?: boolean;
  readonly spec: OryIdentityStackConfig | OryPlatformStackConfig;
  readonly deletionPolicy: 'retain' | 'delete';
  readonly timeoutMs?: number;
}

export interface ApplicationAuthorizationRequest {
  readonly principal: ApplicationRequestAdmission['principal'];
  readonly action: string;
  readonly resource?: ApplicationResourceRef & { readonly id?: string };
  readonly context: Readonly<Record<string, unknown>>;
}

export interface ApplicationAuthorizationDecision {
  readonly allowed: boolean;
  /** Provider policy or relationship revision used to invalidate admitted cursors and cached decisions. */
  readonly version: string;
  readonly reason?: string;
}

/** Provider-neutral policy/relationship decision service. Domain code retains final authorization policy. */
export interface ApplicationAuthorizationProvider {
  readonly kind: 'application-authorization';
  decide(request: ApplicationAuthorizationRequest): ApplicationAuthorizationDecision | Promise<ApplicationAuthorizationDecision>;
  /** Bounded credential-free capability probe used by generated workload readiness. */
  ready?(): void | Promise<void>;
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

export type ApplicationPostgresTransactionalDatabaseOptions = Omit<ApplicationPostgresTransactionalDatabaseProvider, 'kind'>;

export interface ApplicationPostgresTransactionalDatabaseProvider {
  readonly kind: 'postgres';
  /** Stable logical provider identity used by the application graph. */
  readonly name?: string;
  /** Physical CloudNativePG Cluster name. Defaults to the logical provider name. */
  readonly clusterName?: string;
  readonly namespace?: string;
  readonly database?: string;
  readonly provision?: boolean;
  /**
   * Selects the provider lifecycle boundary. Graph ownership is the compact
   * default and therefore deletes the cluster with the Application instance.
   * A separately owned direct graph node is required for honest retained-data semantics.
   */
  readonly ownership?: 'application-graph' | 'direct-provisioned' | 'external';
  readonly lifecycle?: {
    readonly deletionPolicy: 'delete' | 'retain';
  };
  readonly instances?: number;
  readonly storage?: { readonly size: string; readonly storageClassName?: string };
  /** Provider-neutral backup intent lowered to the selected PostgreSQL implementation. */
  readonly backup?: ApplicationPostgresBackupPolicy;
  readonly resources?: {
    readonly requests?: { readonly cpu?: string; readonly memory?: string };
    readonly limits?: { readonly cpu?: string; readonly memory?: string };
  };
  readonly cluster?: ApplicationResourceRef;
  readonly connectionSecret?: ApplicationResourceRef;
  readonly connectionSecretKey?: string;
  readonly migrations?: ApplicationTransactionalDatabaseMigrationPolicy;
  readonly runtime?: ApplicationProviderRuntimeContract;
  readonly readiness?: ApplicationPostgresReadinessPolicy;
}

export interface ApplicationPostgresBackupPolicy {
  /** Disables scheduling while preserving the declared recovery wiring. */
  readonly enabled?: boolean;
  /** Six-field cron expression understood by CloudNativePG. */
  readonly schedule: string;
  /** CloudNativePG duration such as `7d` or `4w`. */
  readonly retentionPolicy: string;
  readonly immediate?: boolean;
  readonly target?: 'primary' | 'prefer-standby';
  readonly destination:
    | {
        readonly kind: 'volume-snapshot';
        readonly className?: string;
        readonly online?: boolean;
      }
    | {
        readonly kind: 's3';
        readonly destinationPath: string;
        readonly endpoint?: string;
        readonly credentialsSecret: ApplicationResourceRef;
        readonly accessKeyIdKey?: string;
        readonly secretAccessKeyKey?: string;
        /** Optional key in credentialsSecret containing the S3 region for CNPG. */
        readonly regionKey?: string;
      };
}

export interface ApplicationPostgresClusterSpec {
  readonly instances: number;
  readonly storage: { readonly size: string; readonly storageClass?: string };
  readonly resources?: ApplicationPostgresTransactionalDatabaseProvider['resources'];
  readonly bootstrap: { readonly initdb: { readonly database: string; readonly owner: string } };
  readonly backup?: {
    readonly retentionPolicy: string;
    readonly target: 'primary' | 'prefer-standby';
    readonly volumeSnapshot?: {
      readonly className?: string;
      readonly online: boolean;
    };
    readonly barmanObjectStore?: {
      readonly destinationPath: string;
      readonly endpointURL?: string;
      readonly s3Credentials: {
        readonly accessKeyId: { readonly name: string; readonly key: string };
        readonly secretAccessKey: { readonly name: string; readonly key: string };
        readonly region?: { readonly name: string; readonly key: string };
      };
      readonly data: { readonly compression: string; readonly jobs: number; readonly immediateCheckpoint: boolean };
      readonly wal: { readonly compression: string; readonly maxParallel: number };
    };
  };
}

export interface ApplicationTransactionalDatabaseMigrationPolicy extends ApplicationMigrationContract {
  readonly jobName?: string;
  readonly apply?: 'manual' | 'generatedJob';
}

export type ApplicationGeneratedTransactionalDatabaseMigrationJobOptions = Omit<Partial<ApplicationTransactionalDatabaseMigrationPolicy>, 'strategy' | 'apply'>;

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
  /** Shared Hyperspike operator prerequisite used by the TypeKro-backed provisioner. */
  readonly operator?: {
    readonly provision?: boolean;
    readonly name?: string;
    readonly namespace?: string;
    readonly version?: string;
  };
  readonly topology?: {
    readonly shards?: number;
    readonly replicas?: number;
  };
  readonly authentication?: {
    readonly mode: 'anonymous' | 'password';
    readonly secret?: ApplicationResourceRef;
    readonly key?: string;
  };
  readonly storage?: {
    readonly size: string;
    readonly storageClassName?: string;
  };
  readonly resources?: {
    readonly requests?: { readonly cpu?: string; readonly memory?: string };
    readonly limits?: { readonly cpu?: string; readonly memory?: string };
  };
  readonly spec?: Readonly<Record<string, unknown>>;
}

export interface ApplicationIngressHttpExposureProvider {
  readonly kind: 'ingress';
  readonly ingressClassName?: string;
}

/**
 * Deliberately small local-cluster exposure adapter. It changes only the
 * generated Service boundary; TLS termination and DNS remain the concern of an
 * Ingress/Gateway provider rather than being implied by a development NodePort.
 */
export interface ApplicationNodePortHttpExposureProvider {
  readonly kind: 'node-port';
  readonly host: string;
  readonly nodePort: number | `\${${string}}`;
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
  readonly database?: ApplicationTransactionalDatabaseProvider | ApplicationProviderBinding<ApplicationTransactionalDatabaseProvider>;
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
  readonly analytics?: ApplicationAnalyticalDatabaseProvider | ApplicationProviderBinding<ApplicationAnalyticalDatabaseProvider>;
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

export interface ApplicationProviderQualification<TName extends string = string> {
  readonly apiVersion: 'applik8s.providerQualification/v1alpha1';
  readonly capability: string;
  readonly name: TName;
  readonly compatibilityRevision: string;
  readonly key: `${string}@${string}:${TName}`;
}

export interface ApplicationQualifiedProviderToken<
  TImplementation = unknown,
  TName extends string = string,
> extends ApplicationProviderToken<TImplementation> {
  readonly kind: 'applicationQualifiedProvider';
  readonly base: ApplicationProviderToken<TImplementation>;
  readonly qualification: ApplicationProviderQualification<TName>;
}

export interface ApplicationQualifiableProviderToken<TImplementation = unknown>
  extends ApplicationProviderToken<TImplementation> {
  named<const TName extends string>(
    name: TName,
  ): ApplicationQualifiedProviderToken<TImplementation, TName>;
}

export interface ApplicationTypedProviderContract {
  readonly apiVersion: 'applik8s.provider/v1alpha1';
  readonly interface: string;
  readonly version: string;
  readonly requirements: readonly string[];
  readonly guarantees: readonly string[];
}

type ApplicationProviderImplementation<TToken> =
  TToken extends ApplicationProviderToken<infer TImplementation>
    ? TImplementation
    : never;

function applicationQualifiableProviderToken<
  TToken extends ApplicationQualifiableProviderToken<unknown>,
>(token: Omit<TToken, 'named'>): TToken {
  const compatibilityRevision = token.contract?.version ?? 'v1alpha1';
  const qualified = Object.defineProperty(token, 'named', {
    value: <const TName extends string>(
      name: TName,
    ): ApplicationQualifiedProviderToken<ApplicationProviderImplementation<TToken>, TName> => {
      if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(name)) {
        throw new Error(
          `Application provider qualifier ${JSON.stringify(name)} must be a stable lower-case identifier.`,
        );
      }
      const key = `${token.name}@${compatibilityRevision}:${name}` as const;
      const result: ApplicationQualifiedProviderToken<ApplicationProviderImplementation<TToken>, TName> = {
        kind: 'applicationQualifiedProvider',
        name: token.name,
        ...(token.description ? { description: token.description } : {}),
        ...(token.contract ? { contract: token.contract } : {}),
        ...(token.accepts
          ? {
              accepts: (
                implementation: unknown,
              ): implementation is ApplicationProviderImplementation<TToken> =>
                token.accepts!(implementation),
            }
          : {}),
        // typecast: the input is exactly the public token with only named() omitted.
        base: token as unknown as ApplicationProviderToken<ApplicationProviderImplementation<TToken>>,
        qualification: {
          apiVersion: 'applik8s.providerQualification/v1alpha1',
          capability: token.name,
          name,
          compatibilityRevision,
          key,
        },
      };
      return Object.freeze(result);
    },
    enumerable: false,
    configurable: false,
    writable: false,
  });
  // typecast: defineProperty installs the one method omitted from the input token.
  return qualified as unknown as TToken;
}

export function defineApplicationProvider<TImplementation>(options: {
  readonly interface: string;
  readonly version: string;
  readonly description?: string;
  readonly requirements?: readonly string[];
  readonly guarantees?: readonly string[];
  readonly accepts: (implementation: unknown) => implementation is TImplementation;
}): ApplicationQualifiableProviderToken<TImplementation> {
  if (!/^[A-Z][A-Za-z0-9]*$/.test(options.interface)) throw new Error(`Application provider interface ${JSON.stringify(options.interface)} must be a stable UpperCamelCase identifier.`);
  if (!/^v[1-9][0-9]*(?:(?:alpha|beta)[1-9][0-9]*)?$/.test(options.version)) throw new Error(`Application provider interface ${options.interface} must declare an explicit version such as v1 or v1alpha1.`);
  return applicationQualifiableProviderToken({
    name: options.interface,
    ...(options.description ? { description: options.description } : {}),
    contract: { apiVersion: 'applik8s.provider/v1alpha1', interface: options.interface, version: options.version, requirements: [...(options.requirements ?? [])], guarantees: [...(options.guarantees ?? [])] },
    accepts: options.accepts,
  });
}

export interface ApplicationTransactionalDatabaseProviderToken extends ApplicationQualifiableProviderToken<ApplicationTransactionalDatabaseProvider> {
  postgres(options?: ApplicationPostgresTransactionalDatabaseOptions): ApplicationPostgresTransactionalDatabaseProvider;
  readonly migrations: {
    generatedJob(options?: ApplicationGeneratedTransactionalDatabaseMigrationJobOptions): ApplicationTransactionalDatabaseMigrationPolicy;
  };
}

export interface ApplicationCertificateProviderToken extends ApplicationProviderToken<ApplicationCertificateProvider> {
  certManager(options: Omit<ApplicationCertManagerCertificateProvider, 'kind'>): ApplicationCertManagerCertificateProvider;
}

export interface ApplicationHttpExposureProviderToken extends ApplicationProviderToken<ApplicationHttpExposureProvider> {
  ingress(options?: Omit<ApplicationIngressHttpExposureProvider, 'kind'>): ApplicationIngressHttpExposureProvider;
  nodePort(options: Omit<ApplicationNodePortHttpExposureProvider, 'kind'>): ApplicationNodePortHttpExposureProvider;
}

export interface ApplicationDnsPublicationProviderToken extends ApplicationProviderToken<ApplicationDnsPublicationProvider> {
  externalDns(options?: Omit<ApplicationExternalDnsPublicationProvider, 'kind'>): ApplicationExternalDnsPublicationProvider;
}

export interface ApplicationWorkflowEngineProviderToken extends ApplicationProviderToken<ApplicationWorkflowEngineProvider> {
  hatchet(options?: Omit<ApplicationHatchetWorkflowEngineProvider, 'kind'>): ApplicationHatchetWorkflowEngineProvider;
}

export interface ApplicationAnalyticalDatabaseProviderToken extends ApplicationQualifiableProviderToken<ApplicationAnalyticalDatabaseProvider> {
  clickhouse(options?: Omit<ApplicationClickHouseAnalyticalDatabaseProvider, 'kind'>): ApplicationClickHouseAnalyticalDatabaseProvider;
}

export interface ApplicationContainerRegistryProviderToken extends ApplicationProviderToken<ApplicationContainerRegistryProvider> {
  orbstack(): ApplicationOrbstackContainerRegistryProvider;
  oci(options: Omit<ApplicationOciContainerRegistryProvider, 'kind'>): ApplicationOciContainerRegistryProvider;
  harbor(options: ApplicationHarborContainerRegistryOptions): ApplicationHarborContainerRegistryProvider;
  origin(origin: string): ApplicationContainerRegistryEndpoint;
  nodePort(options: Omit<Extract<ApplicationContainerRegistryEndpoint, { readonly kind: 'kubernetes-node-port' }>, 'kind'>): ApplicationContainerRegistryEndpoint;
}

export interface ApplicationObjectStorageProviderToken extends ApplicationProviderToken<ApplicationObjectStorageProvider> {
  s3(options: Omit<ApplicationS3ObjectStorageProvider, 'kind'>): ApplicationS3ObjectStorageProvider;
  configMap(options?: Omit<ApplicationKubernetesConfigMapObjectStorageProvider, 'kind'>): ApplicationKubernetesConfigMapObjectStorageProvider;
}

export interface ApplicationHostProviderToken extends ApplicationProviderToken<ApplicationHostProvider> {
  kubernetes(options?: Omit<ApplicationKubernetesHostProvider, 'kind'>): ApplicationKubernetesHostProvider;
}

export interface ApplicationRequestIdentityProviderToken extends ApplicationProviderToken<ApplicationRequestIdentityProvider> {
  from(
    authenticate: ApplicationRequestIdentityProvider['authenticate'],
    options?: { readonly infrastructure?: ApplicationIdentityInfrastructure; readonly ready?: NonNullable<ApplicationRequestIdentityProvider['ready']> },
  ): ApplicationRequestIdentityProvider;
}

export interface ApplicationAuthorizationProviderToken extends ApplicationProviderToken<ApplicationAuthorizationProvider> {
  from(decide: ApplicationAuthorizationProvider['decide'], options?: { readonly ready?: NonNullable<ApplicationAuthorizationProvider['ready']> }): ApplicationAuthorizationProvider;
}


export interface ApplicationProviderBindingBase<TImplementation = unknown> {
  readonly kind: 'applicationProvider';
  readonly token: ApplicationProviderToken<TImplementation>;
  readonly implementation: TImplementation;
}

export interface ApplicationHostBinding extends Omit<ApplicationProviderBindingBase<ApplicationHostProvider>, 'kind'> {
  readonly kind: 'applicationHost';
  readonly service: { readonly name: string; readonly namespace: string; readonly port: number };
  readonly status: { readonly state: 'pendingBuild'; readonly ready: false };
  readonly image: { readonly state: 'pendingBuild' };
  readonly url: { readonly internal: string };
}

export type ApplicationProviderBinding<TImplementation = unknown> =
  TImplementation extends ApplicationHostProvider
    ? ApplicationHostBinding
    : ApplicationProviderBindingBase<TImplementation>;

export interface ApplicationProviderState {
  readonly defaults: { indexes?: unknown; database?: unknown; counters?: unknown; events?: unknown; eventLogs?: unknown; secrets?: unknown; queues?: unknown; objects?: unknown; expose?: unknown; certificates?: unknown; dns?: unknown; credentials?: unknown; analytics?: unknown };
  readonly providers: { indexes?: unknown; database?: unknown; counters?: unknown; events?: unknown; eventLogs?: unknown; secrets?: unknown; queues?: unknown; objects?: unknown; expose?: unknown; certificates?: unknown; dns?: unknown; credentials?: unknown; analytics?: unknown; extensions?: Record<string, unknown> };
}

export interface ApplicationIndexStoreProviderToken extends ApplicationProviderToken<ApplicationIndexBackend | 'valkey'> {
  valkey(options?: Omit<ApplicationValkeyIndexBackend, 'kind'>): ApplicationValkeyIndexBackend;
}

export const IndexStore: ApplicationIndexStoreProviderToken = {
  name: 'IndexStore',
  description: 'Default app-scoped index backend provider.',
  contract: builtInProviderContract('IndexStore', ['typedIndexes']),
  valkey(options = {}) {
    return { kind: 'valkey', ...options };
  },
};

export const TransactionalDatabase: ApplicationTransactionalDatabaseProviderToken = applicationQualifiableProviderToken({
  name: 'TransactionalDatabase',
  description: 'Canonical transactional database provider for application models.',
  contract: builtInProviderContract('TransactionalDatabase', ['transactions', 'strongReads']),
  postgres(options = {}) {
    const provider: ApplicationPostgresTransactionalDatabaseProvider = { kind: 'postgres', ...options };
    assertApplicationPostgresTransactionalDatabaseLifecycle(provider);
    return provider;
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
});
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

export const ObjectStorage: ApplicationObjectStorageProviderToken = {
  name: 'ObjectStorage',
  description: 'Default app-scoped object storage provider.',
  contract: builtInProviderContract('ObjectStorage', ['objectReadWrite', 'boundedObjects', 'serverOnlyCredentials']),
  accepts: isApplicationObjectStorageProvider,
  s3(options) {
    if (!applicationProviderRequiredString(options.bucket)) throw new Error('ObjectStorage.s3({ bucket }) must not be empty.');
    if (!applicationProviderRequiredString(options.region)) throw new Error('ObjectStorage.s3({ region }) must not be empty.');
    const dynamicOwnership = applicationTypeKroExpressionValue(options.ownership);
    if (!dynamicOwnership && options.ownership === 'direct-provisioned' && !options.credentialsSecret) {
      throw new Error('ObjectStorage.s3({ ownership: "direct-provisioned" }) requires the Secret reference produced by the direct provisioning boundary.');
    }
    if (!dynamicOwnership && options.ownership === 'direct-provisioned' && !options.provisioning?.storageClassName.trim()) {
      throw new Error('ObjectStorage.s3({ ownership: "direct-provisioned" }) requires provisioning.storageClassName.');
    }
    if (!dynamicOwnership && options.ownership !== 'direct-provisioned' && options.provisioning) {
      throw new Error('ObjectStorage.s3({ provisioning }) is valid only with ownership: "direct-provisioned".');
    }
    return { kind: 's3', ...options };
  },
  configMap(options = {}) {
    return { kind: 'kubernetes-configmap-objects', ...options };
  },
};

export const HttpExposure: ApplicationHttpExposureProviderToken = {
  name: 'HttpExposure',
  description: 'Default app-scoped HTTP exposure provider.',
  contract: builtInProviderContract('HttpExposure', ['httpRouting']),
  ingress(options = {}) {
    return { kind: 'ingress', ...options };
  },
  nodePort(options) {
    if (!options.host.trim()) throw new Error('HttpExposure.nodePort({ host }) must not be empty.');
    if (!applicationProviderNodePort(options.nodePort)) {
      throw new Error('HttpExposure.nodePort({ nodePort }) must be an integer in the Kubernetes NodePort range 30000-32767 or a typed installation reference.');
    }
    return { kind: 'node-port', ...options };
  },
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

export const AnalyticalDatabase: ApplicationAnalyticalDatabaseProviderToken = applicationQualifiableProviderToken({
  name: 'AnalyticalDatabase',
  description: 'Rebuildable analytical database; durable replay remains owned by the source stream.',
  contract: builtInProviderContract('AnalyticalDatabase', ['idempotentInsert', 'checkpoint', 'fullRebuild']),
  accepts: isClickHouseAnalyticalDatabaseProvider,
  clickhouse(options = {}) {
    return { kind: 'clickhouse', ...options };
  },
});
export const ContainerRegistry: ApplicationContainerRegistryProviderToken = {
  name: 'ContainerRegistry',
  description: 'Provider-neutral publication and immutable resolution of generated OCI workloads.',
  contract: builtInProviderContract('ContainerRegistry', [
    'immutableDigest',
    'executionTimeCredentials',
    'leastPrivilegePullSecret',
  ]),
  accepts: isApplicationContainerRegistryProvider,
  orbstack() {
    return { kind: 'orbstack-container-registry' };
  },
  oci(options) {
    assertApplicationContainerRegistryEndpoint(options.endpoint);
    if (options.repositoryPrefix !== undefined && !applicationProviderStringOrInstallationReference(options.repositoryPrefix)) {
      throw new Error('ContainerRegistry.oci({ repositoryPrefix }) must not be empty.');
    }
    assertApplicationContainerRegistryCredentials(options.pushCredentials);
    return { kind: 'oci-container-registry', ...options };
  },
  harbor(options) {
    assertApplicationContainerRegistryEndpoint(options.endpoint);
    if (!applicationProviderStringOrInstallationReference(options.project)) {
      throw new Error('ContainerRegistry.harbor({ project }) must be a non-empty value or typed installation reference.');
    }
    if ('management' in options && options.management) {
      assertApplicationHarborProjectManagement(options.management);
      if (typeof options.project !== 'string' && (!options.management.pushSecretName || !options.management.pullSecretName)) {
        throw new Error('ContainerRegistry.harbor with an installation-derived project requires explicit management.pushSecretName and management.pullSecretName so deployment lowering can resolve names without evaluating arbitrary CEL.');
      }
      const pushSecretName = options.management.pushSecretName ?? `${options.project}-registry-push`;
      const pullSecretName = options.management.pullSecretName ?? `${options.project}-registry-pull`;
      return {
        kind: 'harbor-container-registry',
        ...options,
        pushCredentials: {
          apiVersion: 'v1',
          kind: 'Secret',
          namespace: options.management.secretNamespace,
          name: pushSecretName,
          dockerConfigJsonKey: '.dockerconfigjson',
        },
        pullSecret: {
          apiVersion: 'v1',
          kind: 'Secret',
          namespace: options.management.secretNamespace,
          name: pullSecretName,
        },
      };
    }
    assertApplicationContainerRegistryCredentials(options.pushCredentials);
    assertApplicationContainerRegistrySecret(options.pullSecret, 'pullSecret');
    return { kind: 'harbor-container-registry', ...options };
  },
  origin(origin) {
    if (!applicationProviderStringOrInstallationReference(origin)) throw new Error('ContainerRegistry.origin(...) requires a non-empty registry origin or typed installation reference.');
    // TypeKro schema references are statically string-shaped but remain proxy objects until graph serialization.
    return { kind: 'origin', origin: typeof origin === 'string' ? canonicalApplicationContainerRegistryOrigin(origin) : origin };
  },
  nodePort(options) {
    if (!options.namespace.trim() || !options.service.trim()) {
      throw new Error('ContainerRegistry.nodePort(...) requires non-empty namespace and service names.');
    }
    if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65_535) {
      throw new Error('ContainerRegistry.nodePort(...) requires a valid TCP port.');
    }
    if (options.publishHost !== undefined && !options.publishHost.trim()) {
      throw new Error('ContainerRegistry.nodePort(...) publishHost must not be empty when provided.');
    }
    if (options.pullHost !== undefined && !options.pullHost.trim()) {
      throw new Error('ContainerRegistry.nodePort(...) pullHost must not be empty when provided.');
    }
    return { kind: 'kubernetes-node-port', ...options };
  },
};

export const ApplicationHost: ApplicationHostProviderToken = {
  name: 'ApplicationHost',
  description: 'Immutable application artifact hosting and runtime lifecycle.',
  contract: builtInProviderContract('ApplicationHost', ['immutableArtifact', 'readiness', 'gracefulShutdown', 'serviceDiscovery']),
  accepts: isKubernetesApplicationHostProvider,
  kubernetes(options = {}) {
    if (options.replicas !== undefined && !applicationTypeKroExpressionValue(options.replicas) && (!Number.isInteger(options.replicas) || options.replicas < 1)) {
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
  from(authenticate, options) {
    if (options?.infrastructure) assertApplicationIdentityInfrastructure(options.infrastructure);
    if (options?.ready !== undefined && typeof options.ready !== 'function') throw new Error('RequestIdentity.from({ ready }) must be a function.');
    return { kind: 'request-identity', authenticate, ...(options?.infrastructure ? { infrastructure: options.infrastructure } : {}), ...(options?.ready ? { ready: options.ready } : {}) };
  },
};

export const Authorization: ApplicationAuthorizationProviderToken = {
  name: 'Authorization',
  description: 'Provider-neutral policy and relationship decisions that assist application-owned authorization rules.',
  contract: builtInProviderContract('Authorization', ['versionedDecisions', 'policyAssistance', 'failClosed']),
  accepts: isApplicationAuthorizationProvider,
  from(decide, options) {
    if (options?.ready !== undefined && typeof options.ready !== 'function') throw new Error('Authorization.from({ ready }) must be a function.');
    return { kind: 'application-authorization', decide, ...(options?.ready ? { ready: options.ready } : {}) };
  },
};


function builtInProviderContract(providerInterface: string, guarantees: readonly string[]): ApplicationTypedProviderContract {
  return { apiVersion: 'applik8s.provider/v1alpha1', interface: providerInterface, version: 'v1alpha1', requirements: [], guarantees };
}

// typecast: provider registry names are literal public API keys used for app.provide(...) inference.
export const providers = { IndexStore, TransactionalDatabase, AnalyticalDatabase, CounterStore, EventSource, EventLog, Secret, Queue, ObjectStorage, HttpExposure, Certificate, DnsPublication, CredentialStore, WorkflowEngine, ApplicationHost, ContainerRegistry, RequestIdentity, Authorization, StructuredGeneration } as const;

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
  chartVersion: '0.13.3',
  serverVersion: 'v0.94.10',
  mode: 'stack',
  tls: false,
  database: { provision: true, database: 'hatchet', instances: 1, storageSize: '8Gi' },
  dashboard: 'internal',
  worker: { replicas: 1, taskSlots: 16, durableSlots: 16, gracefulShutdownSeconds: 30, healthPort: 8001, scaling: { mode: 'fixed' } },
};

export const defaultApplicationProviders: {
  readonly IndexStore: ApplicationValkeyIndexBackend;
  readonly TransactionalDatabase: ApplicationPostgresTransactionalDatabaseProvider;
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
  TransactionalDatabase: { kind: 'postgres' },
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

export function isClickHouseAnalyticalDatabaseProvider(value: unknown): value is ApplicationClickHouseAnalyticalDatabaseProvider {
  return Boolean(value && typeof value === 'object' && Reflect.get(value, 'kind') === 'clickhouse');
}

export function applicationAnalyticalDatabaseImplementation(value: unknown): ApplicationAnalyticalDatabaseProvider | undefined {
  if (isClickHouseAnalyticalDatabaseProvider(value)) return value;
  const implementation = isApplicationProviderBinding(value)
    && applicationProviderBaseToken(value.token) === AnalyticalDatabase
    ? value.implementation
    : value;
  if (isClickHouseAnalyticalDatabaseProvider(implementation)) return implementation;
  if (
    isApplicationProviderSelection(implementation)
    && [
      ...Object.values(implementation.cases),
      implementation.default,
    ].every(isClickHouseAnalyticalDatabaseProvider)
  ) {
    return applicationSelectedClickHouseProvider(
      implementation as ApplicationProviderSelectionValue<ApplicationClickHouseAnalyticalDatabaseProvider>,
    );
  }
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
  if (isApplicationProviderSelection(implementation)) {
    const candidates = [...Object.values(implementation.cases), implementation.default];
    if (applicationProviderTokenName(token) === 'TransactionalDatabase') {
      if (candidates.some((candidate) => !isPostgresTransactionalDatabaseProvider(candidate))) {
        throw new Error('Application profile TransactionalDatabase branches must each satisfy the transactional PostgreSQL provider contract.');
      }
      state.providers.database = implementation;
      return;
    }
    if (applicationProviderTokenName(token) === 'AnalyticalDatabase') {
      if (candidates.some((candidate) => !isClickHouseAnalyticalDatabaseProvider(candidate))) {
        throw new Error('Application profile AnalyticalDatabase branches must each satisfy the analytical database provider contract.');
      }
      state.providers.analytics = implementation;
      return;
    }
    if ((token as unknown) === ContainerRegistry) {
      if (candidates.some((candidate) => !isApplicationContainerRegistryProvider(candidate))) {
        throw new Error('app.selectProvider(...) ContainerRegistry branches must each be a valid registry provider.');
      }
      if (!state.providers.extensions) state.providers.extensions = {};
      state.providers.extensions['ContainerRegistry@v1alpha1'] = implementation;
      return;
    }
    if ((token as unknown) === StructuredGeneration) {
      if (candidates.some((candidate) => !isApplicationStructuredGenerationProvider(candidate))) {
        throw new Error('app.selectProvider(...) StructuredGeneration branches must each be StructuredGeneration.http(...) or .deterministic(...).');
      }
      if (!state.providers.extensions) state.providers.extensions = {};
      state.providers.extensions['StructuredGeneration@v1alpha1'] = implementation;
      return;
    }
    throw new Error(`Application profile provider selection is not yet supported for ${applicationProviderTokenName(token)}.`);
  }
  if (applicationProviderTokenName(token) === 'IndexStore') {
    if (!isValkeyIndexDefault(implementation)) {
      throw new Error('app.provide(IndexStore, ...) currently supports only the Valkey index backend provider slice. Use "valkey" or { kind: "valkey", ... } for v0.2.');
    }
    state.providers.indexes = implementation;
    return;
  }
  if (applicationProviderTokenName(token) === 'TransactionalDatabase') {
    if (!isPostgresTransactionalDatabaseProvider(implementation)) {
      throw new Error('app.provide(TransactionalDatabase, ...) currently supports only the typed PostgreSQL database provider declaration. Use TransactionalDatabase.postgres(...).');
    }
    state.providers.database = implementation;
    return;
  }
  if (applicationProviderTokenName(token) === 'HttpExposure') {
    if (!isIngressHttpExposureProvider(implementation) && !isNodePortHttpExposureProvider(implementation)) {
      throw new Error('app.provide(HttpExposure, ...) requires HttpExposure.ingress(...) or HttpExposure.nodePort(...).');
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
  if (applicationProviderTokenName(token) === 'AnalyticalDatabase') {
    if (!isClickHouseAnalyticalDatabaseProvider(implementation)) {
      throw new Error('app.provide(AnalyticalDatabase, ...) currently supports the ClickHouse analytical provider. Use AnalyticalDatabase.clickhouse(...).');
    }
    state.providers.analytics = implementation;
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
  if ((token as unknown) === ContainerRegistry) {
    if (!isApplicationContainerRegistryProvider(implementation)) {
      throw new Error('app.provide(ContainerRegistry, ...) requires ContainerRegistry.orbstack(), .oci(...), or .harbor(...).');
    }
    if (!state.providers.extensions) state.providers.extensions = {};
    state.providers.extensions['ContainerRegistry@v1alpha1'] = implementation;
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
  if ((token as unknown) === Authorization) {
    if (!isApplicationAuthorizationProvider(implementation)) {
      throw new Error('app.provide(Authorization, ...) requires Authorization.from(decide).');
    }
    if (!state.providers.extensions) state.providers.extensions = {};
    state.providers.extensions['Authorization@v1alpha1'] = implementation;
    return;
  }
  if ((token as unknown) === StructuredGeneration) {
    if (!isApplicationStructuredGenerationProvider(implementation)) {
      throw new Error('app.provide(StructuredGeneration, ...) requires StructuredGeneration.http(...) or .deterministic(...).');
    }
    if (!state.providers.extensions) state.providers.extensions = {};
    state.providers.extensions['StructuredGeneration@v1alpha1'] = implementation;
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

export interface ApplicationProviderSelectionValue<TImplementation = unknown> {
  readonly kind: 'application-provider-selection';
  readonly selector: string;
  readonly cases: Readonly<Record<string, TImplementation>>;
  readonly default: TImplementation;
}

const applicationProviderSelectionMetadata = Symbol.for(
  'Applik8s.ApplicationProviderSelection',
);

export function applicationProviderSelectionFor<TImplementation>(
  value: unknown,
): ApplicationProviderSelectionValue<TImplementation> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const selection = Reflect.get(value, applicationProviderSelectionMetadata);
  return isApplicationProviderSelection(selection)
    ? selection as ApplicationProviderSelectionValue<TImplementation>
    : undefined;
}

export function isApplicationQualifiedProviderToken<TImplementation = unknown>(
  value: unknown,
): value is ApplicationQualifiedProviderToken<TImplementation> {
  return Boolean(
    value
    && typeof value === 'object'
    && Reflect.get(value, 'kind') === 'applicationQualifiedProvider'
    && Reflect.get(value, 'base')
    && Reflect.get(value, 'qualification'),
  );
}

export function applicationProviderQualificationFor(
  value: unknown,
): ApplicationProviderQualification | undefined {
  if (isApplicationQualifiedProviderToken(value)) {
    return value.qualification;
  }
  if (
    value
    && typeof value === 'object'
    && Reflect.get(value, 'kind') === 'applicationProvider'
  ) {
    const token = Reflect.get(value, 'token');
    return isApplicationQualifiedProviderToken(token)
      ? token.qualification
      : undefined;
  }
  return undefined;
}

export function isApplicationProviderSelection(value: unknown): value is ApplicationProviderSelectionValue {
  return Boolean(
    value
    && typeof value === 'object'
    && Reflect.get(value, 'kind') === 'application-provider-selection'
    && typeof Reflect.get(value, 'selector') === 'string'
    && Reflect.get(value, 'cases')
    && typeof Reflect.get(value, 'cases') === 'object'
    && Object.hasOwn(value, 'default'),
  );
}

export function applicationProviderSelectionSatisfies<TImplementation>(
  value: unknown,
  accepts: (implementation: unknown) => implementation is TImplementation,
): boolean {
  if (!isApplicationProviderSelection(value)) return false;
  return [
    ...Object.values(value.cases),
    value.default,
  ].every((candidate) => accepts(candidate));
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
    || (tokenName === 'ObjectStorage' && (kind === 'kubernetes-configmap-objects' || kind === 's3'))
    || (tokenName === 'CredentialStore' && kind === 'kubernetes-secret-credentials');
}

export function isIngressHttpExposureProvider(value: unknown): value is 'ingress' | ApplicationIngressHttpExposureProvider {
  return value === 'ingress' || Boolean(value && typeof value === 'object' && Reflect.get(value, 'kind') === 'ingress');
}

export function isNodePortHttpExposureProvider(value: unknown): value is ApplicationNodePortHttpExposureProvider {
  return Boolean(
    value
    && typeof value === 'object'
    && Reflect.get(value, 'kind') === 'node-port'
    && typeof Reflect.get(value, 'host') === 'string'
    && applicationProviderNodePort(Reflect.get(value, 'nodePort')),
  );
}

function applicationProviderNodePort(value: unknown): boolean {
  return (Number.isInteger(value) && Number(value) >= 30_000 && Number(value) <= 32_767)
    || applicationProviderNumberOrInstallationReference(value);
}

function applicationProviderRequiredString(value: unknown): boolean {
  return typeof value === 'string'
    ? value.trim().length > 0
    : applicationTypeKroExpressionValue(value) !== undefined;
}

export function applicationHttpExposureImplementation(value: unknown): ApplicationHttpExposureProvider | undefined {
  if (isIngressHttpExposureProvider(value) || isNodePortHttpExposureProvider(value)) {
    return value;
  }
  if (isApplicationProviderBinding(value) && value.token === HttpExposure
    && (isIngressHttpExposureProvider(value.implementation) || isNodePortHttpExposureProvider(value.implementation))) {
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
    && applicationProviderStringOrInstallationReference(Reflect.get(issuerRef, 'name'))
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

export function isPostgresTransactionalDatabaseProvider(value: unknown): value is ApplicationPostgresTransactionalDatabaseProvider {
  return Boolean(value && typeof value === 'object' && Reflect.get(value, 'kind') === 'postgres');
}

export function applicationTransactionalDatabaseImplementation(store: unknown): ApplicationTransactionalDatabaseProvider | undefined {
  if (isPostgresTransactionalDatabaseProvider(store)) {
    assertApplicationPostgresTransactionalDatabaseLifecycle(store);
    return store;
  }
  if (
    isApplicationProviderBinding(store)
    && applicationProviderBaseToken(store.token) === TransactionalDatabase
  ) {
    if (isPostgresTransactionalDatabaseProvider(store.implementation)) {
      assertApplicationPostgresTransactionalDatabaseLifecycle(store.implementation);
      return store.implementation;
    }
    if (
      isApplicationProviderSelection(store.implementation)
      && [
        ...Object.values(store.implementation.cases),
        store.implementation.default,
      ].every(isPostgresTransactionalDatabaseProvider)
    ) {
      return applicationSelectedPostgresProvider(
        store.implementation as ApplicationProviderSelectionValue<ApplicationPostgresTransactionalDatabaseProvider>,
      );
    }
  }
  return undefined;
}

function applicationProviderBaseToken(
  token: ApplicationProviderToken<unknown>,
): ApplicationProviderToken<unknown> {
  return token
    && typeof token === 'object'
    && Reflect.get(token, 'kind') === 'applicationQualifiedProvider'
    && Reflect.get(token, 'base')
    ? Reflect.get(token, 'base') as ApplicationProviderToken<unknown>
    : token;
}

function applicationSelectedPostgresProvider(
  selection: ApplicationProviderSelectionValue<ApplicationPostgresTransactionalDatabaseProvider>,
): ApplicationPostgresTransactionalDatabaseProvider {
  const fallback = selection.default;
  const selected = {
    ...fallback,
    kind: 'postgres' as const,
    ...applicationSelectedProviderStringField(selection, 'name'),
    ...applicationSelectedProviderStringField(selection, 'clusterName'),
    ...applicationSelectedProviderStringField(selection, 'namespace'),
    ...applicationSelectedProviderStringField(selection, 'database'),
    ...applicationSelectedProviderStringField(selection, 'connectionSecretKey'),
  };
  const connectionSecret = applicationSelectedProviderResourceReference(
    selection,
    'connectionSecret',
  );
  const provider = {
    ...selected,
    ...(connectionSecret ? { connectionSecret } : {}),
  };
  Object.defineProperty(provider, applicationProviderSelectionMetadata, {
    value: selection,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  assertApplicationPostgresTransactionalDatabaseLifecycle(provider);
  return provider;
}

function applicationSelectedClickHouseProvider(
  selection: ApplicationProviderSelectionValue<ApplicationClickHouseAnalyticalDatabaseProvider>,
): ApplicationClickHouseAnalyticalDatabaseProvider {
  const fallback = selection.default;
  const stringFields = [
    'name',
    'namespace',
    'version',
    'storageSize',
    'storageClassName',
    'endpoint',
    'database',
    'usernameKey',
    'passwordKey',
  ] as const;
  const selected = {
    ...fallback,
    kind: 'clickhouse' as const,
    ...Object.fromEntries(
      stringFields.flatMap((field) => {
        const value = applicationSelectedProviderValue(
          selection,
          (provider) => provider[field],
        );
        return value === undefined ? [] : [[field, value]];
      }),
    ),
  } as ApplicationClickHouseAnalyticalDatabaseProvider;
  const enabled = applicationSelectedProviderValue(
    selection,
    (provider) => provider.enabled,
  );
  const provision = applicationSelectedProviderValue(
    selection,
    (provider) => provider.provision,
  );
  const credentialsSecret = applicationSelectedClickHouseResourceReference(
    selection,
  );
  const provider: ApplicationClickHouseAnalyticalDatabaseProvider = {
    ...selected,
    ...(enabled === undefined ? {} : { enabled }),
    ...(provision === undefined ? {} : { provision }),
    ...(credentialsSecret ? { credentialsSecret } : {}),
  };
  Object.defineProperty(provider, applicationProviderSelectionMetadata, {
    value: selection,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return provider;
}

function applicationSelectedClickHouseResourceReference(
  selection: ApplicationProviderSelectionValue<ApplicationClickHouseAnalyticalDatabaseProvider>,
): ApplicationResourceRef | undefined {
  const references = [
    ...Object.values(selection.cases),
    selection.default,
  ].map((provider) => provider.credentialsSecret);
  if (references.every((reference) => reference === undefined)) return undefined;
  const value = <TKey extends keyof ApplicationResourceRef>(
    key: TKey,
  ): ApplicationResourceRef[TKey] | undefined =>
    applicationSelectedProviderValue(
      selection,
      (provider) => provider.credentialsSecret?.[key],
    ) as ApplicationResourceRef[TKey] | undefined;
  const apiVersion = value('apiVersion');
  const kind = value('kind');
  const name = value('name');
  const namespace = value('namespace');
  if (!apiVersion || !kind) return undefined;
  return {
    apiVersion,
    kind,
    ...(name ? { name } : {}),
    ...(namespace ? { namespace } : {}),
  };
}

function applicationSelectedProviderStringField(
  selection: ApplicationProviderSelectionValue<ApplicationPostgresTransactionalDatabaseProvider>,
  field:
    | 'name'
    | 'clusterName'
    | 'namespace'
    | 'database'
    | 'connectionSecretKey',
): Partial<Record<typeof field, string>> {
  const value = applicationSelectedProviderValue(
    selection,
    (provider) => provider[field],
  );
  return value === undefined ? {} : { [field]: value };
}

function applicationSelectedProviderResourceReference(
  selection: ApplicationProviderSelectionValue<ApplicationPostgresTransactionalDatabaseProvider>,
  field: 'connectionSecret',
): ApplicationResourceRef | undefined {
  const references = [
    ...Object.values(selection.cases),
    selection.default,
  ].map((provider) => provider[field]);
  if (references.every((reference) => reference === undefined)) return undefined;
  const value = <TKey extends keyof ApplicationResourceRef>(
    key: TKey,
  ): ApplicationResourceRef[TKey] | undefined =>
    applicationSelectedProviderValue(
      selection,
      (provider) => provider[field]?.[key],
    ) as ApplicationResourceRef[TKey] | undefined;
  const apiVersion = value('apiVersion');
  const kind = value('kind');
  const name = value('name');
  const namespace = value('namespace');
  if (!apiVersion || !kind) return undefined;
  return {
    apiVersion,
    kind,
    ...(name ? { name } : {}),
    ...(namespace ? { namespace } : {}),
  };
}

function applicationSelectedProviderValue<TProvider, TValue>(
  selection: ApplicationProviderSelectionValue<TProvider>,
  read: (provider: TProvider) => TValue | undefined,
): TValue | undefined {
  const branches = Object.entries(selection.cases).map(
    ([variant, provider]) => [variant, read(provider)] as const,
  );
  const fallback = read(selection.default);
  const serialized = [...branches.map(([, value]) => value), fallback].map(
    applicationProviderSelectionValueExpression,
  );
  if (serialized.every((value) => value === serialized[0])) return fallback;
  const expression = branches.reduceRight(
    (otherwise, [variant, value]) =>
      `${selection.selector} == ${JSON.stringify(variant)} ? ${applicationProviderSelectionValueExpression(value)} : (${otherwise})`,
    applicationProviderSelectionValueExpression(fallback),
  );
  return Cel.expr<TValue>(expression) as TValue;
}

function applicationProviderSelectionValueExpression(value: unknown): string {
  const expression = applicationTypeKroExpressionValue(value);
  if (expression) return expression;
  if (value === undefined) return 'null';
  return JSON.stringify(value);
}

function assertApplicationPostgresTransactionalDatabaseLifecycle(provider: ApplicationPostgresTransactionalDatabaseProvider): void {
  if (provider.ownership !== undefined
    && !applicationTypeKroExpressionValue(provider.ownership)
    && !['application-graph', 'direct-provisioned', 'external'].includes(provider.ownership)) {
    throw new Error('TransactionalDatabase.postgres ownership must be application-graph, direct-provisioned, external, or a typed installation expression.');
  }
  if (provider.provision !== undefined
    && typeof provider.provision !== 'boolean'
    && !applicationTypeKroExpressionValue(provider.provision)) {
    throw new Error('TransactionalDatabase.postgres provision must be boolean or a typed installation expression.');
  }
  const ownership = provider.ownership ?? (provider.provision === false || provider.cluster ? 'external' : 'application-graph');
  if (ownership === 'direct-provisioned' && (provider.provision === false || provider.cluster)) {
    throw new Error('TransactionalDatabase.postgres({ ownership: "direct-provisioned" }) cannot disable provisioning or reference an external cluster.');
  }
  if (ownership === 'direct-provisioned' && !provider.lifecycle) {
    throw new Error('TransactionalDatabase.postgres({ ownership: "direct-provisioned" }) requires lifecycle.deletionPolicy to be declared explicitly.');
  }
  if (ownership === 'external' && provider.provision !== false && !provider.cluster) {
    throw new Error('TransactionalDatabase.postgres({ ownership: "external" }) requires provision: false or an explicit cluster reference.');
  }
  if (ownership === 'application-graph' && provider.lifecycle?.deletionPolicy === 'retain') {
    throw new Error('TransactionalDatabase.postgres graph ownership cannot retain the database after Application deletion. Use ownership: "direct-provisioned" or "external" for retained data.');
  }
  assertApplicationPostgresBackupPolicy(provider.backup);
}

function assertApplicationPostgresBackupPolicy(policy: ApplicationPostgresBackupPolicy | undefined): void {
  if (!policy) return;
  if (!applicationTypeKroExpressionValue(policy.schedule) && !policy.schedule.trim()) {
    throw new Error('TransactionalDatabase.postgres backup.schedule must be a non-empty six-field cron expression.');
  }
  if (!applicationTypeKroExpressionValue(policy.retentionPolicy) && !/^\d+[dwm]$/.test(policy.retentionPolicy)) {
    throw new Error('TransactionalDatabase.postgres backup.retentionPolicy must be a duration such as "7d" or "4w".');
  }
  if (policy.destination.kind === 's3') {
    if (!applicationTypeKroExpressionValue(policy.destination.destinationPath) && !/^s3:\/\/[A-Za-z0-9]/.test(policy.destination.destinationPath)) {
      throw new Error('TransactionalDatabase.postgres S3 backup.destinationPath must be an s3:// URL.');
    }
    if (!policy.destination.credentialsSecret.name?.trim()) {
      throw new Error('TransactionalDatabase.postgres S3 backup credentialsSecret must reference a named Secret.');
    }
  }
}

/** One canonical CNPG spec for graph-owned and direct-prepared PostgreSQL. */
export function applicationPostgresClusterSpec(
  provider: ApplicationPostgresTransactionalDatabaseProvider,
  database: string,
): ApplicationPostgresClusterSpec {
  assertApplicationPostgresTransactionalDatabaseLifecycle(provider);
  const backup = provider.backup && provider.backup.enabled !== false
    ? applicationPostgresClusterBackupSpec(provider.backup)
    : undefined;
  return {
    instances: provider.instances ?? 1,
    storage: {
      size: provider.storage?.size ?? '1Gi',
      ...(provider.storage?.storageClassName ? { storageClass: provider.storage.storageClassName } : {}),
    },
    ...(provider.resources ? { resources: provider.resources } : {}),
    bootstrap: { initdb: { database, owner: 'app' } },
    ...(backup ? { backup } : {}),
  };
}

function applicationPostgresClusterBackupSpec(policy: ApplicationPostgresBackupPolicy): NonNullable<ApplicationPostgresClusterSpec['backup']> {
  if (policy.destination.kind === 'volume-snapshot') {
    return {
      retentionPolicy: policy.retentionPolicy,
      target: policy.target ?? 'prefer-standby',
      volumeSnapshot: {
        ...(policy.destination.className ? { className: policy.destination.className } : {}),
        online: policy.destination.online ?? true,
      },
    };
  }
  const secretName = policy.destination.credentialsSecret.name;
  if (!secretName) throw new Error('TransactionalDatabase.postgres S3 backup credentialsSecret must reference a named Secret.');
  return {
    retentionPolicy: policy.retentionPolicy,
    target: policy.target ?? 'prefer-standby',
    barmanObjectStore: {
      destinationPath: policy.destination.destinationPath,
      ...(policy.destination.endpoint ? { endpointURL: policy.destination.endpoint } : {}),
      s3Credentials: {
        accessKeyId: { name: secretName, key: policy.destination.accessKeyIdKey ?? 'AWS_ACCESS_KEY_ID' },
        secretAccessKey: { name: secretName, key: policy.destination.secretAccessKeyKey ?? 'AWS_SECRET_ACCESS_KEY' },
        ...(policy.destination.regionKey ? { region: { name: secretName, key: policy.destination.regionKey } } : {}),
      },
      data: { compression: 'gzip', jobs: 2, immediateCheckpoint: true },
      wal: { compression: 'gzip', maxParallel: 2 },
    },
  };
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
  if (tokenName === 'IndexStore' || tokenName === 'TransactionalDatabase' || tokenName === 'AnalyticalDatabase' || tokenName === 'TransactionalDatabase' || tokenName === 'CounterStore' || tokenName === 'EventSource' || tokenName === 'EventLog' || tokenName === 'Secret' || tokenName === 'Queue' || tokenName === 'ObjectStorage' || tokenName === 'HttpExposure' || tokenName === 'Certificate' || tokenName === 'DnsPublication' || tokenName === 'CredentialStore' || tokenName === 'WorkflowEngine' || tokenName === 'AnalyticalDatabase' || tokenName === 'ApplicationHost' || tokenName === 'ContainerRegistry' || tokenName === 'RequestIdentity' || tokenName === 'Authorization' || tokenName === 'StructuredGeneration') {
    return tokenName;
  }
  return undefined;
}

export function isApplicationRequestIdentityProvider(value: unknown): value is ApplicationRequestIdentityProvider {
  if (!value || typeof value !== 'object' || Reflect.get(value, 'kind') !== 'request-identity' || typeof Reflect.get(value, 'authenticate') !== 'function') return false;
  if (Reflect.get(value, 'ready') !== undefined && typeof Reflect.get(value, 'ready') !== 'function') return false;
  const infrastructure = Reflect.get(value, 'infrastructure');
  if (infrastructure === undefined) return true;
  try {
    assertApplicationIdentityInfrastructure(infrastructure);
    return true;
  } catch {
    return false;
  }
}

function assertApplicationIdentityInfrastructure(value: unknown): asserts value is ApplicationIdentityInfrastructure {
  if (!value || typeof value !== 'object' || Reflect.get(value, 'kind') !== 'ory') {
    throw new Error('RequestIdentity infrastructure currently supports the released TypeKro Ory integration.');
  }
  const stack = Reflect.get(value, 'stack');
  const spec = Reflect.get(value, 'spec');
  const deletionPolicy = Reflect.get(value, 'deletionPolicy');
  if (stack !== 'identity' && stack !== 'platform' && !applicationTypeKroExpressionValue(stack)) {
    throw new Error('Ory identity infrastructure stack must be identity or platform.');
  }
  const specName = spec && typeof spec === 'object' ? Reflect.get(spec, 'name') : undefined;
  const specNamespace = spec && typeof spec === 'object' ? Reflect.get(spec, 'namespace') : undefined;
  if (!spec || typeof spec !== 'object'
    || (!applicationProviderRequiredString(specName) && !applicationTypeKroExpressionValue(specName))
    || (!applicationProviderRequiredString(specNamespace) && !applicationTypeKroExpressionValue(specNamespace))) {
    throw new Error('Ory identity infrastructure requires a typed spec with non-empty name and namespace.');
  }
  if (deletionPolicy !== 'retain' && deletionPolicy !== 'delete' && !applicationTypeKroExpressionValue(deletionPolicy)) {
    throw new Error('Ory identity infrastructure requires an explicit retain or delete lifecycle.');
  }
  const timeoutMs = Reflect.get(value, 'timeoutMs');
  if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || timeoutMs < 1_000)) {
    throw new Error('Ory identity infrastructure timeoutMs must be an integer of at least 1000ms.');
  }
}

export function isApplicationObjectStorageProvider(value: unknown): value is ApplicationObjectStorageProvider {
  if (!value || typeof value !== 'object') return false;
  if (Reflect.get(value, 'kind') === 'kubernetes-configmap-objects') return true;
  return Reflect.get(value, 'kind') === 's3'
    && applicationProviderRequiredString(Reflect.get(value, 'bucket'))
    && applicationProviderRequiredString(Reflect.get(value, 'region'));
}

export function isApplicationAuthorizationProvider(value: unknown): value is ApplicationAuthorizationProvider {
  return Boolean(value && typeof value === 'object'
    && Reflect.get(value, 'kind') === 'application-authorization'
    && typeof Reflect.get(value, 'decide') === 'function'
    && (Reflect.get(value, 'ready') === undefined || typeof Reflect.get(value, 'ready') === 'function'));
}


export function isKubernetesApplicationHostProvider(value: unknown): value is ApplicationKubernetesHostProvider {
  return Boolean(value && typeof value === 'object' && Reflect.get(value, 'kind') === 'kubernetes-application-host');
}

export function isApplicationContainerRegistryProvider(value: unknown): value is ApplicationContainerRegistryProvider {
  if (!value || typeof value !== 'object') return false;
  const kind = Reflect.get(value, 'kind');
  if (kind === 'orbstack-container-registry') return true;
  const endpoint = Reflect.get(value, 'endpoint');
  if (!isApplicationContainerRegistryEndpoint(endpoint)) return false;
  if (kind === 'oci-container-registry') return true;
  if (
    kind !== 'harbor-container-registry'
    || !applicationProviderStringOrInstallationReference(Reflect.get(value, 'project'))
  ) return false;
  try {
    assertApplicationContainerRegistryCredentials(
      Reflect.get(value, 'pushCredentials') as ApplicationContainerRegistryCredentialSecret | undefined,
    );
    assertApplicationContainerRegistrySecret(
      Reflect.get(value, 'pullSecret') as ApplicationContainerRegistrySecretRef | undefined,
      'pullSecret',
    );
    const management = Reflect.get(value, 'management');
    if (management !== undefined) {
      if (!management || typeof management !== 'object') return false;
      assertApplicationHarborProjectManagement(management as ApplicationHarborProjectManagement);
    }
    return Boolean(Reflect.get(value, 'pushCredentials'));
  } catch {
    return false;
  }
}

function isApplicationContainerRegistryEndpoint(value: unknown): value is ApplicationContainerRegistryEndpoint {
  if (!value || typeof value !== 'object') return false;
  if (Reflect.get(value, 'kind') === 'origin') {
    const origin = Reflect.get(value, 'origin');
    if (!applicationProviderStringOrInstallationReference(origin)) return false;
    if (typeof origin !== 'string') return applicationProviderInstallationReference(origin);
    try {
      canonicalApplicationContainerRegistryOrigin(origin);
      return true;
    } catch {
      return false;
    }
  }
  return Reflect.get(value, 'kind') === 'kubernetes-node-port'
    && typeof Reflect.get(value, 'namespace') === 'string'
    && Boolean((Reflect.get(value, 'namespace') as string).trim())
    && typeof Reflect.get(value, 'service') === 'string'
    && Boolean((Reflect.get(value, 'service') as string).trim())
    && Number.isInteger(Reflect.get(value, 'port'))
    && (Reflect.get(value, 'publishHost') === undefined
      || (typeof Reflect.get(value, 'publishHost') === 'string' && Boolean((Reflect.get(value, 'publishHost') as string).trim())))
    && (Reflect.get(value, 'pullHost') === undefined
      || (typeof Reflect.get(value, 'pullHost') === 'string' && Boolean((Reflect.get(value, 'pullHost') as string).trim())))
    && (Reflect.get(value, 'protocol') === 'http' || Reflect.get(value, 'protocol') === 'https');
}

/** Canonical, credential-free HTTP(S) registry authority safe for evidence and diagnostics. */
export function canonicalApplicationContainerRegistryOrigin(origin: string): string {
  if (/^\$\{schema\.spec(?:\.[A-Za-z_][A-Za-z0-9_]*)+\}$/.test(origin)) return origin;
  if (origin !== origin.trim() || [...origin].some((character) => character.charCodeAt(0) <= 0x20 || character.charCodeAt(0) === 0x7f)) {
    throw new Error('ContainerRegistry origin must not contain whitespace or control characters.');
  }
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error('ContainerRegistry origin must be an absolute HTTP(S) URL.');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('ContainerRegistry origin must use HTTP or HTTPS.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('ContainerRegistry origin must not contain userinfo or credentials; use a Secret reference.');
  }
  if (parsed.search || parsed.hash || (parsed.pathname !== '' && parsed.pathname !== '/')) {
    throw new Error('ContainerRegistry origin must contain only scheme, host, and optional port.');
  }
  if (!parsed.hostname) throw new Error('ContainerRegistry origin must contain a hostname.');
  return parsed.origin;
}

function assertApplicationContainerRegistryEndpoint(endpoint: ApplicationContainerRegistryEndpoint): void {
  if (!isApplicationContainerRegistryEndpoint(endpoint)) {
    throw new Error('ContainerRegistry requires a literal origin or a complete Kubernetes NodePort endpoint.');
  }
}

function assertApplicationContainerRegistryCredentials(credentials: ApplicationContainerRegistryCredentialSecret | undefined): void {
  if (!credentials) return;
  assertApplicationContainerRegistrySecret(credentials, 'pushCredentials');
  if (credentials.username !== undefined && credentials.usernameKey !== undefined) {
    throw new Error('ContainerRegistry pushCredentials must select either username or usernameKey, not both.');
  }
}

function assertApplicationContainerRegistrySecret(
  secret: ApplicationContainerRegistrySecretRef | undefined,
  field: string,
): asserts secret is ApplicationContainerRegistrySecretRef {
  if (
    secret?.apiVersion !== 'v1'
    || secret.kind !== 'Secret'
    || !applicationProviderStringOrInstallationReference(secret.name)
    || !applicationProviderStringOrInstallationReference(secret.namespace)
  ) {
    throw new Error(`ContainerRegistry ${field} must reference a named v1 Secret in an explicit namespace.`);
  }
}

function assertApplicationHarborProjectManagement(management: ApplicationHarborProjectManagement): void {
  assertApplicationContainerRegistryCredentials(management.adminCredentials);
  if (!applicationProviderStringOrInstallationReference(management.secretNamespace)) {
    throw new Error('ContainerRegistry.harbor management.secretNamespace must not be empty.');
  }
  for (const [field, value] of [
    ['pushRobotName', management.pushRobotName],
    ['pushSecretName', management.pushSecretName],
    ['pullRobotName', management.pullRobotName],
    ['pullSecretName', management.pullSecretName],
  ] as const) {
    if (value !== undefined && !applicationProviderStringOrInstallationReference(value)) {
      throw new Error(`ContainerRegistry.harbor management.${field} must be a non-empty value or typed installation reference.`);
    }
  }
  if (management.storageLimitBytes !== undefined && (!Number.isInteger(management.storageLimitBytes) || management.storageLimitBytes < 1)) {
    throw new Error('ContainerRegistry.harbor management.storageLimitBytes must be a positive integer.');
  }
  if (management.retention && (!Number.isInteger(management.retention.keepMostRecent) || management.retention.keepMostRecent < 1)) {
    throw new Error('ContainerRegistry.harbor management.retention.keepMostRecent must be a positive integer.');
  }
  if (management.projectLifecycle) {
    const deletionPolicy = management.projectLifecycle.deletionPolicy;
    if (
      deletionPolicy !== 'retain'
      && deletionPolicy !== 'delete'
      && !applicationProviderInstallationReference(deletionPolicy)
    ) {
      throw new Error('ContainerRegistry.harbor management.projectLifecycle.deletionPolicy must be retain, delete, or a typed installation reference.');
    }
    if (
      management.projectLifecycle.purgeRepositories !== undefined
      && typeof management.projectLifecycle.purgeRepositories !== 'boolean'
      && !applicationProviderBooleanOrInstallationReference(management.projectLifecycle.purgeRepositories)
    ) {
      throw new Error('ContainerRegistry.harbor management.projectLifecycle.purgeRepositories must be boolean or a typed installation reference.');
    }
    if (management.projectLifecycle.timeoutMs !== undefined && (!Number.isInteger(management.projectLifecycle.timeoutMs) || management.projectLifecycle.timeoutMs < 1_000)) {
      throw new Error('ContainerRegistry.harbor management.projectLifecycle.timeoutMs must be an integer of at least 1000 milliseconds.');
    }
  }
}

function applicationProviderBooleanOrInstallationReference(value: unknown): boolean {
  if (typeof value === 'boolean') return true;
  if (applicationProviderSerializedInstallationReference(value)) return true;
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return false;
  if (Reflect.get(value, Symbol.for('TypeKro.KubernetesRef')) === true) {
    return Reflect.get(value, 'resourceId') === '__schema__' && typeof Reflect.get(value, 'fieldPath') === 'string';
  }
  return Reflect.get(value, Symbol.for('TypeKro.CelExpression')) === true
    && typeof Reflect.get(value, 'expression') === 'string'
    && (Reflect.get(value, 'expression') as string).startsWith('schema.spec.');
}

function applicationProviderNumberOrInstallationReference(value: unknown): boolean {
  if (typeof value === 'number' && Number.isFinite(value)) return true;
  if (applicationProviderSerializedInstallationReference(value)) return true;
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return false;
  if (Reflect.get(value, Symbol.for('TypeKro.KubernetesRef')) === true) {
    return Reflect.get(value, 'resourceId') === '__schema__' && typeof Reflect.get(value, 'fieldPath') === 'string';
  }
  return Reflect.get(value, Symbol.for('TypeKro.CelExpression')) === true
    && typeof Reflect.get(value, 'expression') === 'string'
    && (Reflect.get(value, 'expression') as string).startsWith('schema.spec.');
}

function applicationProviderStringOrInstallationReference(value: unknown): boolean {
  if (typeof value === 'string') return Boolean(value.trim());
  return applicationProviderInstallationReference(value);
}

function applicationProviderInstallationReference(value: unknown): boolean {
  if (applicationProviderSerializedInstallationReference(value)) return true;
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return false;
  if (Reflect.get(value, Symbol.for('TypeKro.KubernetesRef')) === true) {
    return Reflect.get(value, 'resourceId') === '__schema__' && typeof Reflect.get(value, 'fieldPath') === 'string';
  }
  return Reflect.get(value, Symbol.for('TypeKro.CelExpression')) === true
    && typeof Reflect.get(value, 'expression') === 'string'
    && (Reflect.get(value, 'expression') as string).startsWith('schema.spec.');
}

function applicationProviderSerializedInstallationReference(value: unknown): value is string {
  return typeof value === 'string' && /^\$\{schema\.spec(?:\.[A-Za-z_][A-Za-z0-9_]*)+\}$/.test(value);
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
    status: { state: 'pendingBuild', ready: false },
    image: { state: 'pendingBuild' },
    url: { internal: applicationTypeKroString('http://', name, '.', namespace, '.svc:', port) },
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
