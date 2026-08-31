// typecast-file-boundary: provider constructors validate structural runtime input before restoring provider-specific discriminated contracts.
import { type ApplicationCallableProviderRuntimeBinding, type ApplicationCallableProviderRuntimeOperation, type ApplicationMigrationContract, type ApplicationProviderInterfaceKind, type ApplicationProviderPrivateRuntimeContract, type ApplicationProviderRuntimeContract, type ApplicationResourceRef, isApplicationRuntimeAccessOperation } from '@applik8s/core';
import type {
  ApplicationDeterministicIdentityOptions,
  ApplicationOAuthAuthorizationFlowRecord,
  ApplicationOAuthProviderDecision,
} from '@applik8s/identity';
import { createDeterministicApplicationAdmission } from '@applik8s/identity';
import { Cel } from 'typekro';
import type { OryIdentityStackConfig, OryPlatformStackConfig } from 'typekro/ory';
import {
  type ApplicationConfigSourceBinding,
  type ApplicationSecretSourceBinding,
  isApplicationConfigurationBinding,
} from './application-configuration.js';
import {
  type ApplicationCapabilityImplementation,
  applicationCapabilityImplementationMetadata,
  maintainedApplicationCapabilityImplementation,
} from './application-capability-implementation.js';
import {
  type ApplicationLakehouseDatasetQueryContract,
  type ApplicationLakehouseQueryRegistrar,
  createApplicationLakehouseDatasetQuery,
  createApplicationLakehouseQuery,
} from './application-lakehouse.js';
import { applicationQualifiableProviderToken } from './application-provider-qualification.js';
import {
  type ApplicationScheduleRegistrar,
  createApplicationSchedule,
} from './application-schedule.js';
import { applicationTypeKroExpressionValue, applicationTypeKroString } from './application-typekro-values.js';
import { isApplicationStructuredGenerationProvider, StructuredGeneration } from './structured-generation.js';

export type { ApplicationStructuredGenerationDeterministicProvider, ApplicationStructuredGenerationHttpProvider, ApplicationStructuredGenerationProvider, ApplicationStructuredGenerationProviderToken } from './structured-generation.js';
export { isApplicationStructuredGenerationProvider, StructuredGeneration } from './structured-generation.js';

export interface ApplicationIndexBackendSelectionOptions {
  readonly cache?: readonly unknown[];
}

export type ApplicationIndexBackend = ApplicationValkeyIndexBackend;

export type ApplicationTransactionalDatabaseProvider =
  | ApplicationPostgresTransactionalDatabaseProvider
  | ApplicationAuroraPostgresTransactionalDatabaseProvider;

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
export interface ApplicationJetStreamQueueProvider {
  readonly kind: 'jetstream-job-queue';
  readonly eventLog: ApplicationCapabilityImplementation<ApplicationEventLogProvider> | ApplicationProviderBinding<ApplicationEventLogProvider>;
  readonly subjectPrefix?: string;
  readonly maximumDeliveries?: number;
}
export interface ApplicationSqsQueueProvider {
  readonly kind: 'sqs-job-queue';
  readonly account: ApplicationAwsAccount;
  readonly queueName?: string;
  readonly visibilityTimeout?: string;
  readonly deadLetterMaximumReceives?: number;
}
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
  readonly provisioning?:
    | {
        /**
         * Controller-backed ObjectBucketClaim. This remains the production
         * path for Rook/Ceph and other compatible provisioners.
         */
        readonly kind?: 'object-bucket-claim';
        /** Typed desired-state switch for the app-owned OBC provisioning boundary. */
        readonly enabled?: boolean;
        readonly claimName?: string;
        readonly storageClassName: string;
        readonly timeoutMs?: number;
        /** OBC deletion removes credentials and the claim; retained bucket data follows the StorageClass reclaim policy. */
        readonly claimLifecycle?: 'application';
        /**
         * Optional shared Rook/Ceph platform managed before this claim. The
         * single-node profile is explicitly a development/qualification
         * topology, never a production-availability claim.
         */
        readonly platform?: {
          readonly kind: 'rook-ceph-single-node-development';
          readonly name?: string;
          readonly namespace?: string;
          readonly operatorNamespace?: string;
          /** StorageClass used for the Ceph OSD PVC, not for application bucket claims. */
          readonly deviceStorageClassName: string;
          /**
           * Development-only Rook escape hatch for explicitly loop-backed
           * block fixtures. Defaults to false and must never be inferred.
           */
          readonly allowLoopDevices?: boolean;
          readonly storageSize?: string;
          readonly objectStoreName?: string;
        };
      }
    | {
        /**
         * Framework-owned single-node S3 service for maintained local/Starter
         * profiles. Applications select the profile; this implementation
         * detail stays inside the Start and deployment adapter.
         */
        readonly kind: 'local-s3';
        readonly enabled?: boolean;
        readonly name?: string;
        readonly image?: string;
        readonly storageSize?: string;
        readonly storageClassName?: string;
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
  /**
   * StatefulSet deletion/scaling policy for JetStream PVCs. Application-owned
   * Namespace deletion still follows Kubernetes Namespace semantics.
   */
  readonly pvcRetentionPolicy?: 'retain' | 'delete';
  readonly connectionSecret?: ApplicationResourceRef;
  readonly authMode?: 'token' | 'userPassword';
  readonly tokenKey?: string;
  /** Hatchet tenant identifier required only when KEDA task-stat scaling is selected. */
  readonly tenantId?: string;
  readonly userKey?: string;
  readonly passwordKey?: string;
}

export interface ApplicationKinesisEventLogProvider extends Omit<ApplicationNatsJetStreamEventLogProvider, 'kind'> {
  readonly kind: 'kinesis';
  readonly account: ApplicationAwsAccount;
  readonly streamName?: string;
  readonly retentionHours?: number;
}

export type ApplicationCounterStoreProvider = ApplicationKubernetesResourceCounterStoreProvider;
export type ApplicationEventSourceProvider = ApplicationKubernetesWatchEventSourceProvider;
export type ApplicationSecretProvider = ApplicationKubernetesSecretProvider;
export type ApplicationQueueProvider =
  | ApplicationKubernetesConfigMapQueueProvider
  | ApplicationJetStreamQueueProvider
  | ApplicationSqsQueueProvider;
export type ApplicationObjectStorageProvider = ApplicationKubernetesConfigMapObjectStorageProvider | ApplicationS3ObjectStorageProvider;
export type ApplicationCredentialStoreProvider = ApplicationKubernetesCredentialStoreProvider;
export type ApplicationEventLogProvider =
  | ApplicationNatsJetStreamEventLogProvider
  | ApplicationKinesisEventLogProvider;

export interface ApplicationWorkflowAdmissionPolicy {
  /** Duration during which a repeated caller/contract/idempotency tuple reattaches to the original run. */
  readonly replayWindowSeconds: number;
  /** Interval between bounded scans of the durable admission authority. */
  readonly cleanupIntervalSeconds: number;
  /** Maximum admission records inspected by one cleanup pass. */
  readonly cleanupBatchSize: number;
}

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
  /** External bootstrap credentials containing ADMIN_EMAIL and ADMIN_PASSWORD. */
  readonly adminCredentialsSecret?: ApplicationResourceRef;
  /** Hatchet client-token Secret. Defaults to the chart-generated hatchet-client-config Secret when provisioned. */
  readonly workerTokenSecret?: ApplicationResourceRef;
  readonly tokenKey?: string;
  readonly hostPort?: string;
  readonly apiUrl?: string;
  readonly tls?: boolean;
  readonly dashboard?: 'disabled' | 'internal';
  /** Provider-neutral root-run admission fencing and bounded replay retention. */
  readonly admission?: Partial<ApplicationWorkflowAdmissionPolicy>;
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

export type ApplicationProviderConfigString =
  | string
  | ApplicationConfigSourceBinding<string>;
export type ApplicationProviderConfigUrl =
  | string
  | ApplicationConfigSourceBinding<URL>;

export interface ApplicationAwsAccount {
  readonly kind: 'aws-account';
  readonly accountId: ApplicationProviderConfigString;
  readonly region: ApplicationProviderConfigString;
  readonly credentials: ApplicationSecretSourceBinding<unknown>;
}

export interface ApplicationCurrentKubernetesCluster {
  readonly kind: 'current-kubernetes-cluster';
  readonly namespace?: ApplicationProviderConfigString;
}

export interface ApplicationExternalKubernetesCluster {
  readonly kind: 'external-kubernetes-cluster';
  readonly endpoint: ApplicationProviderConfigUrl;
  readonly credentials: ApplicationSecretSourceBinding<unknown>;
  readonly namespace?: ApplicationProviderConfigString;
}

export type ApplicationKubernetesCluster =
  | ApplicationCurrentKubernetesCluster
  | ApplicationExternalKubernetesCluster;

export const AWS = Object.freeze({
  account(options: Omit<ApplicationAwsAccount, 'kind'>): ApplicationAwsAccount {
    requireProviderConfigString(options.accountId, 'AWS accountId');
    requireProviderConfigString(options.region, 'AWS region');
    requireSecretConfigurationBinding(options.credentials, 'AWS credentials');
    return Object.freeze({ kind: 'aws-account', ...options });
  },
});

function assertApplicationAwsAccount(value: unknown, constructorName: string): asserts value is ApplicationAwsAccount {
  if (!value || typeof value !== 'object' || Reflect.get(value, 'kind') !== 'aws-account') {
    throw new TypeError(`${constructorName}(...) requires AWS.account(...).`);
  }
  requireProviderConfigString(Reflect.get(value, 'accountId'), `${constructorName} AWS accountId`);
  requireProviderConfigString(Reflect.get(value, 'region'), `${constructorName} AWS region`);
  requireSecretConfigurationBinding(Reflect.get(value, 'credentials'), `${constructorName} AWS credentials`);
}

export const KubernetesCluster = Object.freeze({
  current(options: Omit<ApplicationCurrentKubernetesCluster, 'kind'> = {}): ApplicationCurrentKubernetesCluster {
    if (options.namespace !== undefined) requireProviderConfigString(options.namespace, 'Kubernetes namespace');
    return Object.freeze({ kind: 'current-kubernetes-cluster', ...options });
  },
  external(options: Omit<ApplicationExternalKubernetesCluster, 'kind'>): ApplicationExternalKubernetesCluster {
    requireProviderConfigUrl(options.endpoint, 'Kubernetes endpoint');
    requireSecretConfigurationBinding(options.credentials, 'Kubernetes credentials');
    if (options.namespace !== undefined) requireProviderConfigString(options.namespace, 'Kubernetes namespace');
    return Object.freeze({ kind: 'external-kubernetes-cluster', ...options });
  },
});

export interface ApplicationKubernetesFiniteExecutionHostProvider {
  readonly kind: 'kubernetes-finite-execution-host';
  readonly cluster: ApplicationKubernetesCluster;
  readonly registry: ApplicationContainerRegistryProvider | ApplicationProviderBinding<ApplicationContainerRegistryProvider>;
  readonly namespace?: string;
}

export interface ApplicationAwsFiniteExecutionHostProvider {
  readonly kind: 'aws-finite-execution-host';
  readonly account: ApplicationAwsAccount;
  readonly registry: ApplicationContainerRegistryProvider | ApplicationProviderBinding<ApplicationContainerRegistryProvider>;
  readonly mode?: 'lambda' | 'fargate' | 'batch' | 'automatic';
}

export type ApplicationFiniteExecutionHostProvider =
  | ApplicationKubernetesFiniteExecutionHostProvider
  | ApplicationAwsFiniteExecutionHostProvider;

export interface ApplicationPostgresJobResultStoreProvider {
  readonly kind: 'postgres-job-result-store';
  readonly database: ApplicationCapabilityImplementation<ApplicationTransactionalDatabaseProvider> | ApplicationProviderBinding<ApplicationTransactionalDatabaseProvider>;
  readonly schema?: string;
}

export type ApplicationJobResultStoreProvider = ApplicationPostgresJobResultStoreProvider;

type ApplicationImplementationInput<T extends object> =
  | ApplicationCapabilityImplementation<T>
  | ApplicationProviderBinding<T>;

export interface ApplicationLocalJobRuntimeProvider {
  readonly kind: 'local-job-runtime';
  readonly maximumConcurrency?: number;
  readonly persistence?: 'memory' | 'application-database';
  readonly resultRetentionSeconds?: number;
}

export interface ApplicationKubernetesJobRuntimeProvider {
  readonly kind: 'kubernetes-job-runtime';
  readonly cluster: ApplicationKubernetesCluster;
  readonly namespace?: string;
  readonly maximumConcurrency?: number;
  readonly maximumDuration?: string;
  readonly resultRetentionSeconds?: number;
  /** Typed implementation dependencies remain graph-visible and private to this implementation. */
  readonly queue: ApplicationImplementationInput<ApplicationQueueProvider>;
  readonly executionHost: ApplicationImplementationInput<ApplicationFiniteExecutionHostProvider>;
  readonly results: ApplicationImplementationInput<ApplicationJobResultStoreProvider>;
  readonly scheduler: ApplicationImplementationInput<ApplicationSchedulerProvider>;
  readonly events: ApplicationImplementationInput<ApplicationEventLogProvider>;
}

export interface ApplicationAwsJobRuntimeProvider {
  readonly kind: 'aws-job-runtime';
  readonly account: ApplicationAwsAccount;
  readonly maximumConcurrency?: number;
  readonly maximumDuration?: string;
  readonly resultRetentionSeconds?: number;
  /** Typed implementation dependencies remain graph-visible and private to this implementation. */
  readonly queue: ApplicationImplementationInput<ApplicationQueueProvider>;
  readonly executionHost: ApplicationImplementationInput<ApplicationFiniteExecutionHostProvider>;
  readonly results: ApplicationImplementationInput<ApplicationJobResultStoreProvider>;
  readonly scheduler: ApplicationImplementationInput<ApplicationSchedulerProvider>;
  readonly events: ApplicationImplementationInput<ApplicationEventLogProvider>;
}

export type ApplicationJobRuntimeProvider =
  | ApplicationLocalJobRuntimeProvider
  | ApplicationKubernetesJobRuntimeProvider
  | ApplicationAwsJobRuntimeProvider;

export interface ApplicationPostgresManagedModelStoreProvider {
  readonly kind: 'postgres-managed-model-store';
  readonly database: ApplicationImplementationInput<ApplicationTransactionalDatabaseProvider>;
  readonly schema?: string;
}

export interface ApplicationKubernetesManagedModelStoreProvider {
  readonly kind: 'kubernetes-managed-model-store';
  readonly cluster: ApplicationKubernetesCluster;
}

export type ApplicationManagedModelStoreProvider =
  | ApplicationPostgresManagedModelStoreProvider
  | ApplicationKubernetesManagedModelStoreProvider;

export interface ApplicationDistributedOperatorRuntimeProvider {
  readonly kind: 'distributed-operator-runtime';
  readonly database: ApplicationImplementationInput<ApplicationTransactionalDatabaseProvider>;
  readonly scheduler: ApplicationImplementationInput<ApplicationSchedulerProvider>;
  readonly queue?: ApplicationImplementationInput<ApplicationQueueProvider>;
  readonly leaseDuration?: string;
  readonly resyncInterval?: string;
}

export interface ApplicationKubernetesOperatorRuntimeProvider {
  readonly kind: 'kubernetes-operator-runtime';
  readonly cluster: ApplicationKubernetesCluster;
  readonly namespace?: string;
  readonly leaseDuration?: string;
  readonly resyncInterval?: string;
}

export type ApplicationOperatorRuntimeProvider =
  | ApplicationDistributedOperatorRuntimeProvider
  | ApplicationKubernetesOperatorRuntimeProvider;

export interface ApplicationLocalSchedulerProvider {
  readonly kind: 'local-scheduler';
  readonly clock?: 'system' | 'controlled';
  readonly persistence?: 'memory' | 'application-database';
}

export interface ApplicationKubernetesCronJobSchedulerProvider {
  readonly kind: 'kubernetes-cronjob-scheduler';
  readonly namespace?: string;
  readonly maximumDefinitions?: number;
}

export interface ApplicationHatchetSchedulerProvider {
  readonly kind: 'hatchet-scheduler';
  readonly workflowEngine?: ApplicationHatchetWorkflowEngineProvider;
}

export interface ApplicationEventBridgeSchedulerProvider {
  readonly kind: 'eventbridge-scheduler';
  readonly account?: ApplicationAwsAccount;
  readonly groupName?: string;
  readonly roleArn?: string;
}

export interface ApplicationPostgresSchedulerProvider {
  readonly kind: 'postgres-scheduler';
  readonly database: ApplicationCapabilityImplementation<ApplicationTransactionalDatabaseProvider> | ApplicationProviderBinding<ApplicationTransactionalDatabaseProvider>;
  readonly pollIntervalSeconds?: number;
}

export type ApplicationSchedulerProvider =
  | ApplicationLocalSchedulerProvider
  | ApplicationKubernetesCronJobSchedulerProvider
  | ApplicationHatchetSchedulerProvider
  | ApplicationEventBridgeSchedulerProvider
  | ApplicationPostgresSchedulerProvider;

export interface ApplicationLocalActorRuntimeProvider {
  readonly kind: 'deterministic-local-actors';
  readonly persistence?: 'memory' | 'application-database';
}

export interface ApplicationCelldActorRuntimeProvider {
  readonly kind: 'celld-actors';
  readonly namespace?: string;
  readonly stateStore: ApplicationObjectStorageProvider | ApplicationProviderBinding<ApplicationObjectStorageProvider>;
  readonly replicas?: number;
}

export interface ApplicationRivetActorRuntimeProvider {
  readonly kind: 'rivet-actors';
  readonly endpoint: string;
  readonly credentials?: ApplicationResourceRef;
}

export type ApplicationActorRuntimeProvider =
  | ApplicationLocalActorRuntimeProvider
  | ApplicationCelldActorRuntimeProvider
  | ApplicationRivetActorRuntimeProvider;

export interface ApplicationTelemetryPolicy {
  readonly apiVersion: 'applik8s.telemetryPolicy/v1alpha1';
  readonly logs: {
    readonly level: 'debug' | 'info' | 'warn' | 'error';
    readonly overrides: Readonly<Record<string, 'debug' | 'info' | 'warn' | 'error'>>;
    readonly debugSample: number;
  };
  readonly metrics: {
    readonly intervalSeconds: number;
    readonly cardinalityBudget: 'bounded';
  };
  readonly traces: {
    readonly headSample: number;
    readonly alwaysSampleErrors: boolean;
    readonly tailSample?: { readonly latencyGreaterThanSeconds: number };
  };
  readonly baggage: {
    readonly allowedKeys: readonly string[];
    readonly maximumBytes: number;
  };
  readonly redaction: {
    readonly deniedFields: readonly string[];
  };
}

export interface ApplicationTelemetryPolicyOptions {
  readonly logs?: {
    readonly level?: ApplicationTelemetryPolicy['logs']['level'];
    readonly overrides?: Readonly<Record<string, ApplicationTelemetryPolicy['logs']['level']>>;
    readonly sample?: { readonly debug?: number };
  };
  readonly metrics?: {
    readonly interval?: string;
    readonly cardinalityBudget?: 'bounded';
  };
  readonly traces?: {
    readonly headSample?: number;
    readonly alwaysSampleErrors?: boolean;
    readonly tailSample?: { readonly latency: string };
  };
  readonly baggage?: {
    readonly allowedKeys?: readonly string[];
    readonly maximumBytes?: number;
  };
  readonly redaction?: {
    readonly deniedFields?: readonly string[];
  };
}

interface ApplicationObservabilityProviderBase {
  readonly policy: ApplicationTelemetryPolicy;
  readonly retention: {
    readonly logs: string;
    readonly traces: string;
    readonly metrics: string;
  };
}

export interface ApplicationLocalObservabilityProvider extends ApplicationObservabilityProviderBase {
  readonly kind: 'local-otel';
  readonly endpoint?: string;
}

export interface ApplicationClickStackObservabilityProvider extends ApplicationObservabilityProviderBase {
  readonly kind: 'clickstack';
  readonly namespace?: string;
  readonly storageSize?: string;
  /**
   * Provider-specific ClickHouse Pod sizing. The maintained Kubernetes
   * lowering supplies a bounded Burstable default when this is omitted so a
   * real telemetry workload is never emitted as BestEffort.
   */
  readonly clickhouseResources?: {
    readonly requests?: {
      readonly cpu?: string;
      readonly memory?: string;
    };
    readonly limits?: {
      readonly cpu?: string;
      readonly memory?: string;
    };
  };
}

export interface ApplicationCloudWatchObservabilityProvider extends ApplicationObservabilityProviderBase {
  readonly kind: 'cloudwatch';
  readonly region?: string;
}

export interface ApplicationOtlpObservabilityProvider extends ApplicationObservabilityProviderBase {
  readonly kind: 'otlp';
  readonly endpoint: string;
  readonly protocol: 'http/protobuf';
  readonly signals: readonly ('traces' | 'metrics' | 'logs')[];
  readonly authentication?: {
    readonly secret: ApplicationResourceRef;
    readonly key: string;
    readonly header: string;
  };
  readonly tls: {
    readonly trust: 'system';
  } | {
    readonly trust: 'custom-ca';
    readonly certificateAuthority: ApplicationResourceRef;
    readonly key: string;
    readonly serverName?: string;
  };
}

export type ApplicationObservabilityProvider =
  | ApplicationLocalObservabilityProvider
  | ApplicationClickStackObservabilityProvider
  | ApplicationCloudWatchObservabilityProvider
  | ApplicationOtlpObservabilityProvider;

export interface ApplicationDuckDbLakehouseDatasetProvider {
  readonly kind: 'duckdb-dataset';
  readonly root?: string;
  /** Environment variable containing the cursor signing secret. Secret values never enter the graph. */
  readonly cursorSecretEnvironment?: string;
  readonly schemaRevision?: string;
  /** Maximum immutable delta files before the next publication compacts the logical snapshot. */
  readonly maximumObjectsPerSnapshot?: number;
  /** Number of published snapshot manifests retained as queryable history. */
  readonly retainedSnapshots?: number;
}

export interface ApplicationS3LakehouseDatasetProvider {
  readonly kind: 's3-dataset';
  readonly bucket: string;
  readonly prefix?: string;
  readonly region: string;
  readonly catalog: string;
  readonly schemaRevision?: string;
  readonly cursorSecretEnvironment?: string;
  readonly maximumObjectsPerSnapshot?: number;
  readonly retainedSnapshots?: number;
}

export interface ApplicationDuckDbLakehouseQueryProvider {
  readonly kind: 'duckdb-queries';
  readonly maximumConcurrentQueries?: number;
  readonly maximumRows?: number;
  readonly maximumScannedBytes?: number;
}

export interface ApplicationAthenaLakehouseQueryProvider {
  readonly kind: 'athena-queries';
  readonly workgroup: string;
  readonly region: string;
  readonly resultLocation: string;
  readonly maximumConcurrentQueries?: number;
  readonly maximumRows?: number;
  readonly maximumScannedBytes?: number;
}

/**
 * Explicit target disposition used when a beta lakehouse capability requires
 * an independently qualified external provider. It keeps the semantic graph
 * portable without fabricating a runtime implementation for that target.
 */
export interface ApplicationQualifiedLakehouseProviderRequired {
  readonly kind: 'qualified-lakehouse-provider-required';
  readonly reason: string;
}

export type ApplicationLakehouseDatasetProvider = ApplicationDuckDbLakehouseDatasetProvider | ApplicationS3LakehouseDatasetProvider | ApplicationQualifiedLakehouseProviderRequired;
export type ApplicationLakehouseQueryProvider = ApplicationDuckDbLakehouseQueryProvider | ApplicationAthenaLakehouseQueryProvider | ApplicationQualifiedLakehouseProviderRequired;

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

export interface ApplicationPostgresAnalyticalDatabaseProvider {
  readonly kind: 'postgres-analytics';
  /**
   * Reuses a declared transactional PostgreSQL authority through a distinct
   * analytical adapter. The adapter does not broaden the source database's
   * mutation or transaction authority.
   */
  readonly database:
    | ApplicationTransactionalDatabaseProvider
    | ApplicationProviderBinding<ApplicationTransactionalDatabaseProvider>;
  readonly schema: string;
}

export type ApplicationAnalyticalDatabaseProvider =
  | ApplicationClickHouseAnalyticalDatabaseProvider
  | ApplicationPostgresAnalyticalDatabaseProvider;

export interface ApplicationExternalPostgresDatabaseOptions
  extends Omit<
    ApplicationPostgresTransactionalDatabaseOptions,
    'ownership' | 'provision' | 'connectionSecret' | 'connectionSecretKey'
  > {
  readonly connection?: {
    readonly secretName: string;
    readonly key?: string;
    readonly namespace?: string;
  };
}

export interface ApplicationExternalClickHouseConnection {
  readonly endpoint: string;
  readonly database?: string;
  readonly credentialsSecretName?: string;
  readonly credentialsSecretNamespace?: string;
  readonly usernameKey?: string;
  readonly passwordKey?: string;
}

export type ApplicationExternalClickHouseOptions =
  | {
      readonly name?: string;
      readonly namespace?: string;
      readonly connection: ApplicationExternalClickHouseConnection;
    }
  | (Omit<
      ApplicationClickHouseAnalyticalDatabaseProvider,
      'kind' | 'provision' | 'credentialsSecret' | 'endpoint'
    > & {
      readonly endpoint: string;
      readonly credentialsSecretName?: string;
      readonly credentialsSecretNamespace?: string;
    });

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

export interface ApplicationEcrContainerRegistryProvider extends Partial<Omit<ApplicationOciContainerRegistryProvider, 'kind'>> {
  readonly kind: 'ecr';
  readonly account: ApplicationAwsAccount;
  readonly repositoryPrefix?: string;
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
  | ApplicationEcrContainerRegistryProvider
  | ApplicationOciContainerRegistryProvider
  | ApplicationHarborContainerRegistryProvider;

export type ApplicationRequestAdmission = import('@applik8s/core').ApplicationRequestAdmission;

export interface ApplicationIdentityProvider {
  readonly kind: 'identity-provider';
  readonly infrastructure?: ApplicationIdentityInfrastructure;
  /** Compiler-readable fixed admission for the explicitly starter-only deterministic provider. */
  readonly deterministicAdmission?: ApplicationRequestAdmission;
  authenticate(request: Request): ApplicationRequestAdmission | Promise<ApplicationRequestAdmission>;
  /**
   * Optional complete provider-neutral identity HTTP surface. The generated
   * application host routes the bounded framework identity protocol here;
   * provider-native payloads remain behind this callback.
   */
  handle?(request: Request): Response | Promise<Response>;
  /** Bounded credential-free capability probe used by generated workload readiness. */
  ready?(): void | Promise<void>;
}

export interface ApplicationIdentityProviderDependencies {
  /**
   * Server-side admission may consult authoritative application state (for
   * example, to promote an untrusted workspace selector into trusted
   * context). The dependency remains compiler metadata: credentials are
   * projected only into the generated server workload that executes
   * `authenticate`.
   */
  readonly database?: ApplicationProviderBinding<ApplicationTransactionalDatabaseProvider>;
}

export interface ApplicationOAuthAuthorizationServerProvider {
  readonly kind: 'oauth-authorization-server';
  readonly name: string;
  readonly infrastructure?: ApplicationIdentityInfrastructure;
  decide(input: {
    readonly flow: ApplicationOAuthAuthorizationFlowRecord;
    readonly decision: 'approve' | 'deny';
    readonly idempotencyKey: string;
  }): Promise<ApplicationOAuthProviderDecision>;
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
  readonly principal: import('@applik8s/core').ApplicationPrincipal;
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

/** Provider-neutral host placement lowered by the selected deployment target. */
export interface ApplicationManagedHostProvider {
  readonly kind: 'managed-application-host';
  readonly namespace?: string;
  readonly name?: string;
  /** Immutable target image reference. Omit for a compiler-owned artifact. */
  readonly image?: string;
  readonly replicas?: number;
  readonly port?: number;
  readonly resources?: ApplicationKubernetesHostProvider['resources'];
}

export type ApplicationHostProvider =
  | ApplicationManagedHostProvider
  | ApplicationKubernetesHostProvider;

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

/** Maintained AWS Aurora PostgreSQL implementation selected by an AWS profile. */
export interface ApplicationAuroraPostgresTransactionalDatabaseProvider extends Omit<ApplicationPostgresTransactionalDatabaseProvider, 'kind'> {
  readonly kind: 'aurora-postgresql';
  readonly account: ApplicationAwsAccount;
  readonly name?: string;
  readonly database?: string;
  readonly engineVersion?: string;
  readonly readers?: number;
  readonly minimumCapacity?: number;
  readonly maximumCapacity?: number;
  readonly retention?: 'retain' | 'delete';
  readonly migrations?: ApplicationTransactionalDatabaseMigrationPolicy;
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

export type ApplicationSearchCapability =
  | 'text'
  | 'filters'
  | 'sort'
  | 'facets'
  | 'highlights'
  | 'fuzzy'
  | 'vector'
  | 'openSearchQuery';

export interface ApplicationPostgresSearchProvider {
  readonly kind: 'postgres-search';
  readonly database:
    | ApplicationTransactionalDatabaseProvider
    | ApplicationProviderBinding<ApplicationTransactionalDatabaseProvider>;
  readonly schema?: string;
  readonly maximumCandidateRows?: number;
  readonly capabilities?: readonly Extract<
    ApplicationSearchCapability,
    'text' | 'filters' | 'sort' | 'facets'
  >[];
}

export interface ApplicationOpenSearchProvider {
  readonly kind: 'opensearch';
  readonly name?: string;
  readonly namespace?: string;
  readonly provision?: boolean;
  readonly version?: string;
  readonly endpoint?: string;
  readonly profile?: 'development' | 'production';
  readonly operator?: {
    readonly provision?: boolean;
    readonly name?: string;
    readonly namespace?: string;
    readonly version?: string;
  };
  readonly adminCredentialsSecret?: ApplicationResourceRef;
  readonly dashboardCredentialsSecret?: ApplicationResourceRef;
  readonly tls?:
    | { readonly source: 'generated' }
    | {
        readonly source: 'secret';
        readonly secretName: string;
        readonly adminSecretName: string;
        readonly adminDn: readonly string[];
      }
    | {
        readonly source: 'cert-manager';
        readonly secretName: string;
        readonly adminSecretName: string;
        readonly adminDn: readonly string[];
        readonly issuerName: string;
        readonly issuerKind?: 'Issuer' | 'ClusterIssuer';
        readonly dnsNames: readonly string[];
      };
  readonly networkPolicy?: {
    readonly enabled: boolean;
    readonly operatorNamespace?: string;
    readonly ingressNamespaceLabels?: Readonly<Record<string, string>>;
    readonly egressNamespaceLabels?: readonly Readonly<Record<string, string>>[];
    readonly egressCidrs?: readonly string[];
  };
  readonly topology?: {
    readonly nodes: number;
    readonly roles?: readonly ('clusterManager' | 'data' | 'ingest')[];
  };
  readonly storage?: {
    readonly size: string;
    readonly storageClassName?: string;
    readonly deletionPolicy?: 'retain' | 'delete';
  };
  readonly resources?: {
    readonly requests?: { readonly cpu?: string; readonly memory?: string };
    readonly limits?: { readonly cpu?: string; readonly memory?: string };
  };
  readonly snapshots?: {
    readonly repository: string;
    readonly bucket: string;
    readonly endpoint?: string;
    readonly credentialsSecret: ApplicationResourceRef;
    readonly accessKeyKey?: string;
    readonly secretKeyKey?: string;
    readonly region?: string;
    readonly basePath?: string;
    readonly retention?: string;
  };
  readonly monitoring?: boolean;
  readonly capabilities?: readonly ApplicationSearchCapability[];
}

export type ApplicationSearchProvider =
  | ApplicationPostgresSearchProvider
  | ApplicationOpenSearchProvider;

export interface ApplicationIngressHttpExposureProvider {
  readonly kind: 'ingress';
  readonly ingressClassName?: string;
  /** Namespace containing the ingress controller that may reach authenticated framework backends. */
  readonly controllerNamespace?: string;
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
  readonly search?: ApplicationSearchProvider | ApplicationProviderBinding<ApplicationSearchProvider>;
  readonly counters?: ApplicationCounterStoreProvider;
  readonly events?: ApplicationEventSourceProvider;
  readonly eventLog?: ApplicationEventLogProvider | ApplicationProviderBinding<ApplicationEventLogProvider>;
  readonly secrets?: ApplicationSecretProvider;
  readonly queues?: ApplicationQueueProvider;
  readonly objects?: ApplicationObjectStorageProvider | ApplicationProviderBinding<ApplicationObjectStorageProvider>;
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
  readonly callableRuntime?: ApplicationCallableProviderRuntimeContract;
  readonly accepts?: (implementation: unknown) => implementation is TImplementation;
  readonly __implementation?: TImplementation;
}

const applicationProviderPrivateRuntimeSymbol = Symbol.for(
  'applik8s.applicationProviderPrivateRuntime',
);

export interface ApplicationProviderPrivateRuntimeImplementation<TImplementation = unknown> {
  readonly token: ApplicationQualifiedProviderToken<TImplementation>;
  readonly contract: ApplicationProviderPrivateRuntimeContract;
}

/** @internal Non-callable authoring placeholder for one runtime provider. */
export function applicationProviderPrivateRuntimeImplementation<TImplementation>(
  token: ApplicationQualifiedProviderToken<TImplementation>,
  contract: ApplicationProviderPrivateRuntimeContract,
): TImplementation {
  const placeholder = Object.create(null) as Record<PropertyKey, unknown>;
  Object.defineProperty(placeholder, applicationProviderPrivateRuntimeSymbol, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze({ token, contract }),
  });
  Object.defineProperty(placeholder, 'kind', {
    configurable: false,
    enumerable: true,
    writable: false,
    value: contract.implementation,
  });
  return Object.freeze(placeholder) as TImplementation;
}

export function applicationProviderPrivateRuntimeFor<TImplementation = unknown>(
  value: unknown,
): ApplicationProviderPrivateRuntimeImplementation<TImplementation> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const metadata = Reflect.get(value, applicationProviderPrivateRuntimeSymbol);
  if (!metadata || typeof metadata !== 'object') return undefined;
  const token = Reflect.get(metadata, 'token');
  const contract = Reflect.get(metadata, 'contract');
  if (!isApplicationQualifiedProviderToken<TImplementation>(token)) return undefined;
  if (
    !contract
    || typeof contract !== 'object'
    || Reflect.get(contract, 'apiVersion') !== 'applik8s.providerRuntime/v1alpha1'
  ) return undefined;
  return { token, contract: contract as ApplicationProviderPrivateRuntimeContract };
}

/** Static runtime exports available to managed closures for this provider. */
export interface ApplicationCallableProviderRuntimeContract {
  readonly operations: Readonly<
    Record<string, ApplicationCallableProviderRuntimeOperation>
  >;
  /**
   * Maps one selected provider implementation to public runtime configuration,
   * Secret references, and readiness metadata. The callback runs only while
   * authoring the graph; generated workers receive the normalized data and the
   * statically declared operation export, never this callback or the provider
   * implementation object.
   */
  readonly bind?: (
    implementation: unknown,
  ) => ApplicationProviderRuntimeContract;
}

export interface ApplicationCallableProviderRuntimeDefinition<TImplementation> {
  readonly operations: Readonly<
    Record<string, ApplicationCallableProviderRuntimeOperation>
  >;
  readonly bind?: (
    implementation: TImplementation,
  ) => ApplicationProviderRuntimeContract;
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

export type ApplicationProviderImplementation<TToken> =
  TToken extends ApplicationProviderToken<infer TImplementation>
    ? TImplementation
    : never;

export function defineApplicationProvider<TImplementation>(options: {
  readonly interface: string;
  readonly version: string;
  readonly description?: string;
  readonly requirements?: readonly string[];
  readonly guarantees?: readonly string[];
  readonly runtime?: ApplicationCallableProviderRuntimeDefinition<TImplementation>;
  readonly accepts: (implementation: unknown) => implementation is TImplementation;
}): ApplicationQualifiableProviderToken<TImplementation> {
  if (!/^[A-Z][A-Za-z0-9]*$/.test(options.interface)) throw new Error(`Application provider interface ${JSON.stringify(options.interface)} must be a stable UpperCamelCase identifier.`);
  if (!/^v[1-9][0-9]*(?:(?:alpha|beta)[1-9][0-9]*)?$/.test(options.version)) throw new Error(`Application provider interface ${options.interface} must declare an explicit version such as v1 or v1alpha1.`);
  const callableRuntime = options.runtime
    ? normalizeApplicationCallableProviderRuntime(options.interface, options.runtime)
    : undefined;
  return applicationQualifiableProviderToken({
    name: options.interface,
    ...(options.description ? { description: options.description } : {}),
    contract: { apiVersion: 'applik8s.provider/v1alpha1', interface: options.interface, version: options.version, requirements: [...(options.requirements ?? [])], guarantees: [...(options.guarantees ?? [])] },
    ...(callableRuntime ? { callableRuntime } : {}),
    accepts: options.accepts,
  });
}

function normalizeApplicationCallableProviderRuntime<TImplementation>(
  providerInterface: string,
  runtime: ApplicationCallableProviderRuntimeDefinition<TImplementation>,
): ApplicationCallableProviderRuntimeContract {
  const operations = Object.fromEntries(
    Object.entries(runtime.operations).map(([member, operation]) => {
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(member)) {
        throw new Error(
          `Application provider ${providerInterface} runtime member ${JSON.stringify(member)} must be a JavaScript identifier.`,
        );
      }
      if (
        !/^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._/-]*|[a-z0-9][a-z0-9._/-]*)$/u.test(
          operation.module,
        )
        || operation.module.includes('..')
      ) {
        throw new Error(
          `Application provider ${providerInterface}.${member} runtime module ${JSON.stringify(operation.module)} must be a public bare-package export.`,
        );
      }
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(operation.export)) {
        throw new Error(
          `Application provider ${providerInterface}.${member} runtime export ${JSON.stringify(operation.export)} must be a named JavaScript export.`,
        );
      }
      const access = normalizeApplicationCallableProviderOperationAccess(
        providerInterface,
        member,
        operation.access,
      );
      return [
        member,
        Object.freeze({
          module: operation.module,
          export: operation.export,
          access,
        }),
      ];
    }),
  );
  if (Object.keys(operations).length === 0) {
    throw new Error(
      `Application provider ${providerInterface} callable runtime must declare at least one operation.`,
    );
  }
  return Object.freeze({
    operations: Object.freeze(operations),
    ...(runtime.bind
      ? {
          bind(implementation: unknown) {
            return normalizeApplicationProviderRuntimeBinding(
              providerInterface,
              runtime.bind?.(implementation as TImplementation) ?? {},
            );
          },
        }
      : {}),
  });
}

function normalizeApplicationProviderRuntimeBinding(
  providerInterface: string,
  runtime: ApplicationProviderRuntimeContract,
): ApplicationProviderRuntimeContract {
  const env = runtime.env
    ? Object.fromEntries(
        Object.entries(runtime.env).map(([name, value]) => {
          assertApplicationProviderEnvironmentName(providerInterface, name);
          if (typeof value !== 'string' && !isApplicationRuntimeGraphValue(value)) {
            throw new Error(
              `Application provider ${providerInterface} runtime environment ${name} must be a string or installation expression.`,
            );
          }
          return [name, value];
        }),
      )
    : undefined;
  const secretEnv = runtime.secretEnv
    ? Object.fromEntries(
        Object.entries(runtime.secretEnv).map(([name, binding]) => {
          assertApplicationProviderEnvironmentName(providerInterface, name);
          if (!binding || typeof binding !== 'object') {
            throw new Error(
              `Application provider ${providerInterface} secret environment ${name} must declare a Secret reference and key.`,
            );
          }
          if (!binding.secret || typeof binding.secret !== 'object') {
            throw new Error(
              `Application provider ${providerInterface} secret environment ${name} must declare a Secret reference.`,
            );
          }
          const secretKind = Reflect.get(binding.secret, 'kind');
          const secretName = Reflect.get(binding.secret, 'name');
          if (secretKind !== 'Secret') {
            throw new Error(
              `Application provider ${providerInterface} secret environment ${name} must reference a Kubernetes Secret.`,
            );
          }
          if (
            (typeof secretName !== 'string' || !secretName.trim())
            && !isApplicationRuntimeGraphValue(secretName)
          ) {
            throw new Error(
              `Application provider ${providerInterface} secret environment ${name} requires a non-empty Secret name or installation expression.`,
            );
          }
          if (
            (typeof binding.key !== 'string' || !binding.key.trim())
            && !isApplicationRuntimeGraphValue(binding.key)
          ) {
            throw new Error(
              `Application provider ${providerInterface} secret environment ${name} requires a non-empty Secret key or installation expression.`,
            );
          }
          return [name, Object.freeze({
            secret: Object.freeze({ ...binding.secret }),
            key: binding.key,
            ...(binding.optional === true ? { optional: true } : {}),
          })];
        }),
      )
    : undefined;
  const duplicate = Object.keys(env ?? {}).find((name) => secretEnv?.[name]);
  if (duplicate) {
    throw new Error(
      `Application provider ${providerInterface} runtime environment ${duplicate} cannot be both public configuration and a Secret binding.`,
    );
  }
  return Object.freeze({
    ...(env && Object.keys(env).length > 0 ? { env: Object.freeze(env) } : {}),
    ...(secretEnv && Object.keys(secretEnv).length > 0
      ? { secretEnv: Object.freeze(secretEnv) }
      : {}),
    ...(runtime.secretRefs
      ? { secretRefs: Object.freeze(runtime.secretRefs.map((secret) => Object.freeze({ ...secret }))) }
      : {}),
    ...(runtime.volumeMounts
      ? { volumeMounts: Object.freeze([...runtime.volumeMounts]) }
      : {}),
    ...(runtime.permissions
      ? { permissions: Object.freeze([...runtime.permissions]) }
      : {}),
    ...(runtime.readiness
      ? {
          readiness: Object.freeze({
            ...runtime.readiness,
            dependencies: Object.freeze(
              runtime.readiness.dependencies.map((dependency) =>
                Object.freeze({ ...dependency }),
              ),
            ),
          }),
        }
      : {}),
    ...(runtime.metadataLinks
      ? { metadataLinks: Object.freeze([...runtime.metadataLinks]) }
      : {}),
  });
}

function assertApplicationProviderEnvironmentName(
  providerInterface: string,
  name: string,
): void {
  if (!/^[A-Z_][A-Z0-9_]*$/u.test(name)) {
    throw new Error(
      `Application provider ${providerInterface} runtime environment name ${JSON.stringify(name)} must use uppercase environment-variable syntax.`,
    );
  }
}

function isApplicationRuntimeGraphValue(value: unknown): boolean {
  return Boolean(
    value
      && (typeof value === 'object' || typeof value === 'function'),
  );
}

/** @internal Normalized provider runtime data retained through profile/target selection. */
export function applicationCallableProviderRuntimeBinding<TImplementation>(
  token: ApplicationProviderToken<TImplementation>,
  implementation: TImplementation,
): ApplicationCallableProviderRuntimeBinding | undefined {
  const bind = token.callableRuntime?.bind;
  if (!bind) return undefined;
  return callableProviderRuntimeBindingForImplementation(
    bind as (value: unknown) => ApplicationProviderRuntimeContract,
    implementation,
  );
}

function callableProviderRuntimeBindingForImplementation(
  bind: (implementation: unknown) => ApplicationProviderRuntimeContract,
  implementation: unknown,
): ApplicationCallableProviderRuntimeBinding {
  const profile = applicationProviderSelectionFor(implementation);
  if (profile) {
    return Object.freeze({
      kind: 'profileSelection',
      selector: profile.selector,
      cases: Object.freeze(Object.fromEntries(
        Object.entries(profile.cases).map(([variant, candidate]) => [
          variant,
          callableProviderRuntimeBindingForImplementation(bind, candidate),
        ]),
      )),
      default: callableProviderRuntimeBindingForImplementation(
        bind,
        profile.default,
      ),
    });
  }
  const target = applicationTargetProviderSelectionFor(implementation);
  if (target) {
    return Object.freeze({
      kind: 'targetSelection',
      targets: Object.freeze(Object.fromEntries(
        Object.entries(target.targets).map(([name, candidate]) => [
          name,
          callableProviderRuntimeBindingForImplementation(bind, candidate),
        ]),
      )),
    });
  }
  return Object.freeze({ kind: 'runtime', runtime: bind(implementation) });
}

function normalizeApplicationCallableProviderOperationAccess(
  providerInterface: string,
  member: string,
  access: ApplicationCallableProviderRuntimeOperation['access'],
): ApplicationCallableProviderRuntimeOperation['access'] {
  if (access === 'none') return access;
  if (
    !access
    || access.kind !== 'provider'
    || !Array.isArray(access.operations)
    || access.operations.length === 0
  ) {
    throw new Error(
      `Application provider ${providerInterface}.${member} runtime access must be 'none' or a non-empty provider operation list.`,
    );
  }
  const operations = [...new Set(access.operations)];
  for (const operation of operations) {
    if (!isApplicationRuntimeAccessOperation(operation)) {
      throw new Error(
        `Application provider ${providerInterface}.${member} runtime access operation ${JSON.stringify(operation)} is not part of the versioned runtime-access vocabulary.`,
      );
    }
  }
  return Object.freeze({
    kind: 'provider',
    operations: Object.freeze(operations),
  });
}

export interface ApplicationTransactionalDatabaseProviderToken extends ApplicationQualifiableProviderToken<ApplicationTransactionalDatabaseProvider> {
  /** @deprecated Use Database.postgres(...). Removed at 1.0. */
  postgres(options?: ApplicationPostgresTransactionalDatabaseOptions): ApplicationPostgresTransactionalDatabaseProvider;
  readonly migrations: {
    generatedJob(options?: ApplicationGeneratedTransactionalDatabaseMigrationJobOptions): ApplicationTransactionalDatabaseMigrationPolicy;
  };
}

export interface ApplicationDatabaseConstructors {
  postgres(options?: ApplicationPostgresTransactionalDatabaseOptions): ApplicationCapabilityImplementation<ApplicationPostgresTransactionalDatabaseProvider>;
  auroraPostgres(options: Omit<ApplicationAuroraPostgresTransactionalDatabaseProvider, 'kind'>): ApplicationCapabilityImplementation<ApplicationAuroraPostgresTransactionalDatabaseProvider>;
  externalPostgres(options: ApplicationExternalPostgresDatabaseOptions): ApplicationCapabilityImplementation<ApplicationPostgresTransactionalDatabaseProvider>;
  readonly migrations: ApplicationTransactionalDatabaseProviderToken['migrations'];
}

export interface ApplicationEventLogProviderToken extends ApplicationQualifiableProviderToken<ApplicationEventLogProvider> {
  jetStream(options?: Omit<ApplicationNatsJetStreamEventLogProvider, 'kind'>): ApplicationCapabilityImplementation<ApplicationNatsJetStreamEventLogProvider>;
  kinesis(options: Omit<ApplicationKinesisEventLogProvider, 'kind'>): ApplicationCapabilityImplementation<ApplicationKinesisEventLogProvider>;
}

export interface ApplicationCertificateProviderToken extends ApplicationQualifiableProviderToken<ApplicationCertificateProvider> {
  certManager(options: Omit<ApplicationCertManagerCertificateProvider, 'kind'>): ApplicationCertManagerCertificateProvider;
}

export interface ApplicationHttpExposureProviderToken extends ApplicationQualifiableProviderToken<ApplicationHttpExposureProvider> {
  ingress(options?: Omit<ApplicationIngressHttpExposureProvider, 'kind'>): ApplicationIngressHttpExposureProvider;
  nodePort(options: Omit<ApplicationNodePortHttpExposureProvider, 'kind'>): ApplicationNodePortHttpExposureProvider;
}

export interface ApplicationDnsPublicationProviderToken extends ApplicationQualifiableProviderToken<ApplicationDnsPublicationProvider> {
  externalDns(options?: Omit<ApplicationExternalDnsPublicationProvider, 'kind'>): ApplicationExternalDnsPublicationProvider;
}

export interface ApplicationWorkflowEngineProviderToken extends ApplicationQualifiableProviderToken<ApplicationWorkflowEngineProvider> {
  hatchet(options?: Omit<ApplicationHatchetWorkflowEngineProvider, 'kind'>): ApplicationCapabilityImplementation<ApplicationHatchetWorkflowEngineProvider>;
}

export interface ApplicationJobRuntimeProviderToken extends ApplicationQualifiableProviderToken<ApplicationJobRuntimeProvider> {
  local(options?: Omit<ApplicationLocalJobRuntimeProvider, 'kind'>): ApplicationCapabilityImplementation<ApplicationLocalJobRuntimeProvider>;
  kubernetes(options: Omit<ApplicationKubernetesJobRuntimeProvider, 'kind'>): ApplicationCapabilityImplementation<ApplicationKubernetesJobRuntimeProvider>;
  aws(options: Omit<ApplicationAwsJobRuntimeProvider, 'kind'>): ApplicationCapabilityImplementation<ApplicationAwsJobRuntimeProvider>;
}

export interface ApplicationManagedModelStoreProviderToken extends ApplicationQualifiableProviderToken<ApplicationManagedModelStoreProvider> {
  postgres(options: Omit<ApplicationPostgresManagedModelStoreProvider, 'kind'>): ApplicationCapabilityImplementation<ApplicationPostgresManagedModelStoreProvider>;
  kubernetes(options: Omit<ApplicationKubernetesManagedModelStoreProvider, 'kind'>): ApplicationCapabilityImplementation<ApplicationKubernetesManagedModelStoreProvider>;
}

export interface ApplicationOperatorRuntimeProviderToken extends ApplicationQualifiableProviderToken<ApplicationOperatorRuntimeProvider> {
  distributed(options: Omit<ApplicationDistributedOperatorRuntimeProvider, 'kind'>): ApplicationCapabilityImplementation<ApplicationDistributedOperatorRuntimeProvider>;
  kubernetes(options: Omit<ApplicationKubernetesOperatorRuntimeProvider, 'kind'>): ApplicationCapabilityImplementation<ApplicationKubernetesOperatorRuntimeProvider>;
}

export interface ApplicationQueueProviderToken extends ApplicationQualifiableProviderToken<ApplicationQueueProvider> {
  jetStream(options: Omit<ApplicationJetStreamQueueProvider, 'kind'>): ApplicationCapabilityImplementation<ApplicationJetStreamQueueProvider>;
  sqs(options: Omit<ApplicationSqsQueueProvider, 'kind'>): ApplicationCapabilityImplementation<ApplicationSqsQueueProvider>;
}

export interface ApplicationFiniteExecutionHostProviderToken extends ApplicationQualifiableProviderToken<ApplicationFiniteExecutionHostProvider> {
  kubernetes(options: Omit<ApplicationKubernetesFiniteExecutionHostProvider, 'kind'>): ApplicationCapabilityImplementation<ApplicationKubernetesFiniteExecutionHostProvider>;
  aws(options: Omit<ApplicationAwsFiniteExecutionHostProvider, 'kind'>): ApplicationCapabilityImplementation<ApplicationAwsFiniteExecutionHostProvider>;
}

export interface ApplicationJobResultStoreProviderToken extends ApplicationQualifiableProviderToken<ApplicationJobResultStoreProvider> {
  postgres(options: Omit<ApplicationPostgresJobResultStoreProvider, 'kind'>): ApplicationCapabilityImplementation<ApplicationPostgresJobResultStoreProvider>;
}

export interface ApplicationQualifiedSchedulerProviderToken<TName extends string = string>
  extends ApplicationQualifiedProviderToken<ApplicationSchedulerProvider, TName> {
  readonly schedule: ApplicationScheduleRegistrar;
}

export interface ApplicationSchedulerProviderToken extends ApplicationQualifiableProviderToken<ApplicationSchedulerProvider> {
  named<const TName extends string>(name: TName): ApplicationQualifiedSchedulerProviderToken<TName>;
  readonly schedule: ApplicationScheduleRegistrar;
  local(options?: Omit<ApplicationLocalSchedulerProvider, 'kind'>): ApplicationCapabilityImplementation<ApplicationLocalSchedulerProvider>;
  cronJob(options?: Omit<ApplicationKubernetesCronJobSchedulerProvider, 'kind'>): ApplicationCapabilityImplementation<ApplicationKubernetesCronJobSchedulerProvider>;
  hatchet(options?: Omit<ApplicationHatchetSchedulerProvider, 'kind'>): ApplicationCapabilityImplementation<ApplicationHatchetSchedulerProvider>;
  eventBridge(options?: Omit<ApplicationEventBridgeSchedulerProvider, 'kind'>): ApplicationCapabilityImplementation<ApplicationEventBridgeSchedulerProvider>;
  postgres(options: Omit<ApplicationPostgresSchedulerProvider, 'kind'>): ApplicationCapabilityImplementation<ApplicationPostgresSchedulerProvider>;
}

export interface ApplicationActorRuntimeProviderToken extends ApplicationQualifiableProviderToken<ApplicationActorRuntimeProvider> {
  local(options?: Omit<ApplicationLocalActorRuntimeProvider, 'kind'>): ApplicationCapabilityImplementation<ApplicationLocalActorRuntimeProvider>;
  celld(options: Omit<ApplicationCelldActorRuntimeProvider, 'kind'>): ApplicationCapabilityImplementation<ApplicationCelldActorRuntimeProvider>;
  rivet(options: Omit<ApplicationRivetActorRuntimeProvider, 'kind'>): ApplicationCapabilityImplementation<ApplicationRivetActorRuntimeProvider>;
}

export interface ApplicationObservabilityProviderToken extends ApplicationQualifiableProviderToken<ApplicationObservabilityProvider> {
  local(options?: Partial<Omit<ApplicationLocalObservabilityProvider, 'kind' | 'policy' | 'retention'>> & { readonly policy?: ApplicationTelemetryPolicy; readonly retention?: Partial<ApplicationObservabilityProviderBase['retention']> }): ApplicationLocalObservabilityProvider;
  clickStack(options: Omit<ApplicationClickStackObservabilityProvider, 'kind' | 'policy' | 'retention'> & { readonly policy?: ApplicationTelemetryPolicy; readonly retention?: Partial<ApplicationObservabilityProviderBase['retention']> }): ApplicationClickStackObservabilityProvider;
  cloudWatch(options: Omit<ApplicationCloudWatchObservabilityProvider, 'kind' | 'policy' | 'retention'> & { readonly policy?: ApplicationTelemetryPolicy; readonly retention?: Partial<ApplicationObservabilityProviderBase['retention']> }): ApplicationCloudWatchObservabilityProvider;
  otlp(options: Omit<ApplicationOtlpObservabilityProvider, 'kind' | 'policy' | 'retention' | 'protocol' | 'signals' | 'tls'> & {
    readonly policy?: ApplicationTelemetryPolicy;
    readonly retention?: Partial<ApplicationObservabilityProviderBase['retention']>;
    readonly protocol?: ApplicationOtlpObservabilityProvider['protocol'];
    readonly signals?: ApplicationOtlpObservabilityProvider['signals'];
    readonly tls?: ApplicationOtlpObservabilityProvider['tls'];
  }): ApplicationOtlpObservabilityProvider;
}

export interface ApplicationQualifiedLakehouseDatasetProviderToken<TName extends string = string>
  extends ApplicationQualifiedProviderToken<ApplicationLakehouseDatasetProvider, TName> {
  query<TInput extends object, TOutput extends object>(
    contract: ApplicationLakehouseDatasetQueryContract<TInput, TOutput>,
    handler: (input: TInput) => TOutput | Promise<TOutput>,
  ): (input: TInput) => Promise<TOutput>;
}

export interface ApplicationLakehouseDatasetProviderToken extends ApplicationQualifiableProviderToken<ApplicationLakehouseDatasetProvider> {
  named<const TName extends string>(name: TName): ApplicationQualifiedLakehouseDatasetProviderToken<TName>;
  query<TInput extends object, TOutput extends object>(
    this: ApplicationQualifiedLakehouseDatasetProviderToken,
    contract: ApplicationLakehouseDatasetQueryContract<TInput, TOutput>,
    handler: (input: TInput) => TOutput | Promise<TOutput>,
  ): (input: TInput) => Promise<TOutput>;
}

export interface ApplicationQualifiedLakehouseQueryProviderToken<TName extends string = string>
  extends ApplicationQualifiedProviderToken<ApplicationLakehouseQueryProvider, TName> {
  readonly query: ApplicationLakehouseQueryRegistrar;
}

export interface ApplicationLakehouseQueryProviderToken extends ApplicationQualifiableProviderToken<ApplicationLakehouseQueryProvider> {
  named<const TName extends string>(name: TName): ApplicationQualifiedLakehouseQueryProviderToken<TName>;
  readonly query: ApplicationLakehouseQueryRegistrar;
}

export interface ApplicationLakehouseConstructors {
  duckdbDataset(options?: Omit<ApplicationDuckDbLakehouseDatasetProvider, 'kind'>): ApplicationDuckDbLakehouseDatasetProvider;
  s3Dataset(options: Omit<ApplicationS3LakehouseDatasetProvider, 'kind'>): ApplicationS3LakehouseDatasetProvider;
  duckdbQueries(options?: Omit<ApplicationDuckDbLakehouseQueryProvider, 'kind'>): ApplicationDuckDbLakehouseQueryProvider;
  athenaQueries(options: Omit<ApplicationAthenaLakehouseQueryProvider, 'kind'>): ApplicationAthenaLakehouseQueryProvider;
  qualifiedProviderRequired(options: Omit<ApplicationQualifiedLakehouseProviderRequired, 'kind'>): ApplicationQualifiedLakehouseProviderRequired;
}

export interface ApplicationAnalyticalDatabaseProviderToken extends ApplicationQualifiableProviderToken<ApplicationAnalyticalDatabaseProvider> {
  /** @deprecated Use Analytics.clickHouse(...). Removed at 1.0. */
  clickhouse(options?: Omit<ApplicationClickHouseAnalyticalDatabaseProvider, 'kind'>): ApplicationClickHouseAnalyticalDatabaseProvider;
}

export interface ApplicationAnalyticsConstructors {
  postgres(options: Omit<ApplicationPostgresAnalyticalDatabaseProvider, 'kind'>): ApplicationCapabilityImplementation<ApplicationPostgresAnalyticalDatabaseProvider>;
  clickHouse(options?: Omit<ApplicationClickHouseAnalyticalDatabaseProvider, 'kind'>): ApplicationCapabilityImplementation<ApplicationClickHouseAnalyticalDatabaseProvider>;
  externalClickHouse(options: ApplicationExternalClickHouseOptions): ApplicationCapabilityImplementation<ApplicationClickHouseAnalyticalDatabaseProvider>;
}

export interface ApplicationContainerRegistryProviderToken extends ApplicationQualifiableProviderToken<ApplicationContainerRegistryProvider> {
  orbstack(): ApplicationOrbstackContainerRegistryProvider;
  ecr(options: Omit<ApplicationEcrContainerRegistryProvider, 'kind'>): ApplicationCapabilityImplementation<ApplicationEcrContainerRegistryProvider>;
  oci(options: Omit<ApplicationOciContainerRegistryProvider, 'kind'>): ApplicationOciContainerRegistryProvider;
  harbor(options: ApplicationHarborContainerRegistryOptions): ApplicationHarborContainerRegistryProvider;
  origin(origin: string): ApplicationContainerRegistryEndpoint;
  nodePort(options: Omit<Extract<ApplicationContainerRegistryEndpoint, { readonly kind: 'kubernetes-node-port' }>, 'kind'>): ApplicationContainerRegistryEndpoint;
}

export interface ApplicationObjectStorageProviderToken extends ApplicationQualifiableProviderToken<ApplicationObjectStorageProvider> {
  s3(options: Omit<ApplicationS3ObjectStorageProvider, 'kind'>): ApplicationCapabilityImplementation<ApplicationS3ObjectStorageProvider>;
  configMap(options?: Omit<ApplicationKubernetesConfigMapObjectStorageProvider, 'kind'>): ApplicationCapabilityImplementation<ApplicationKubernetesConfigMapObjectStorageProvider>;
  /**
   * Bind a database backup destination to one declared object-storage
   * capability. Bucket, endpoint, region, and Secret coordinates follow the
   * selected provider profile without being repeated by application code.
   */
  backup(
    provider:
      | ApplicationObjectStorageProvider
      | ApplicationProviderBinding<ApplicationObjectStorageProvider>,
    options: {
      readonly prefix: string;
      readonly accessKeyIdKey?: string;
      readonly secretAccessKeyKey?: string;
      readonly regionKey?: string;
    },
  ): Extract<ApplicationPostgresBackupPolicy['destination'], { readonly kind: 's3' }>;
}

export interface ApplicationHostProviderToken extends ApplicationQualifiableProviderToken<ApplicationHostProvider> {
  managed(options?: Omit<ApplicationManagedHostProvider, 'kind'>): ApplicationManagedHostProvider;
  kubernetes(options?: Omit<ApplicationKubernetesHostProvider, 'kind'>): ApplicationKubernetesHostProvider;
}

export interface ApplicationIdentityProviderToken extends ApplicationQualifiableProviderToken<ApplicationIdentityProvider> {
  from(
    authenticate: ApplicationIdentityProvider['authenticate'],
    options?: {
      readonly infrastructure?: ApplicationIdentityInfrastructure;
      readonly ready?: NonNullable<ApplicationIdentityProvider['ready']>;
      readonly handle?: NonNullable<ApplicationIdentityProvider['handle']>;
      readonly dependencies?: ApplicationIdentityProviderDependencies;
    },
  ): ApplicationIdentityProvider;
  deterministic(options: ApplicationDeterministicIdentityOptions): ApplicationIdentityProvider;
}

export interface ApplicationOAuthAuthorizationServerProviderToken extends ApplicationQualifiableProviderToken<ApplicationOAuthAuthorizationServerProvider> {
  from(
    name: string,
    decide: ApplicationOAuthAuthorizationServerProvider['decide'],
    options?: { readonly infrastructure?: ApplicationIdentityInfrastructure; readonly ready?: NonNullable<ApplicationOAuthAuthorizationServerProvider['ready']> },
  ): ApplicationOAuthAuthorizationServerProvider;
}

export interface ApplicationAuthorizationProviderToken extends ApplicationQualifiableProviderToken<ApplicationAuthorizationProvider> {
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
  [TImplementation] extends [ApplicationHostProvider]
    ? ApplicationHostBinding
    : ApplicationProviderBindingBase<TImplementation>;

export interface ApplicationProviderState {
  readonly defaults: { indexes?: unknown; search?: unknown; database?: unknown; counters?: unknown; events?: unknown; eventLogs?: unknown; secrets?: unknown; queues?: unknown; objects?: unknown; expose?: unknown; certificates?: unknown; dns?: unknown; credentials?: unknown; analytics?: unknown };
  readonly providers: { indexes?: unknown; search?: unknown; database?: unknown; counters?: unknown; events?: unknown; eventLogs?: unknown; secrets?: unknown; queues?: unknown; objects?: unknown; expose?: unknown; certificates?: unknown; dns?: unknown; credentials?: unknown; analytics?: unknown; extensions?: Record<string, unknown> };
}

export interface ApplicationIndexStoreProviderToken extends ApplicationQualifiableProviderToken<ApplicationIndexBackend | 'valkey'> {
  valkey(options?: Omit<ApplicationValkeyIndexBackend, 'kind'>): ApplicationValkeyIndexBackend;
}

export interface ApplicationSearchProviderToken
  extends ApplicationQualifiableProviderToken<ApplicationSearchProvider> {
  postgres(
    options: Omit<ApplicationPostgresSearchProvider, 'kind'>,
  ): ApplicationCapabilityImplementation<ApplicationPostgresSearchProvider>;
  openSearch(
    options?: Omit<ApplicationOpenSearchProvider, 'kind'>,
  ): ApplicationCapabilityImplementation<ApplicationOpenSearchProvider>;
  externalOpenSearch(
    options: Omit<ApplicationOpenSearchProvider, 'kind' | 'provision'> & {
      readonly endpoint: string;
    },
  ): ApplicationCapabilityImplementation<ApplicationOpenSearchProvider>;
}

function maintainedBuiltInImplementation<TImplementation extends object>(
  token: ApplicationProviderToken<unknown>,
  constructorExport: string,
  value: TImplementation,
  options: {
    readonly runtimeAdapter: string;
    readonly deploymentContributor?: string;
    readonly readiness: string;
    readonly lifecycle: 'application' | 'shared' | 'external' | 'retained';
    readonly migration: string;
    readonly maturity?: 'stable' | 'beta' | 'preview' | 'experimental' | 'external';
    readonly evidence?: readonly string[];
    readonly dependencies?: readonly import('./application-capability-implementation.js').ApplicationCapabilityImplementationDependency[];
  },
): ApplicationCapabilityImplementation<TImplementation> {
  return maintainedApplicationCapabilityImplementation(
    token as ApplicationProviderToken<TImplementation>,
    {
      provider: {
        package: '@applik8s/applik8s',
        export: constructorExport,
        version: '0.9.0-alpha.1',
      },
      runtimeAdapter: options.runtimeAdapter,
      ...(options.deploymentContributor
        ? { deploymentContributor: options.deploymentContributor }
        : {}),
      readiness: options.readiness,
      lifecycle: options.lifecycle,
      migration: options.migration,
      evidence: options.evidence ?? [`${constructorExport}.conformance`],
      maturity: options.maturity ?? (options.lifecycle === 'external' ? 'external' : 'beta'),
      ...(options.dependencies ? { dependencies: options.dependencies } : {}),
      value,
    },
  );
}

function maintainedDependencyInput(
  value: object | undefined,
  fallback: ApplicationProviderToken<object>,
): ApplicationCapabilityImplementation<object> | ApplicationProviderToken<object> {
  if (value && applicationCapabilityImplementationMetadata(value)) {
    return value as ApplicationCapabilityImplementation<object>;
  }
  if (value && isApplicationProviderBinding(value)) {
    return value.token as ApplicationProviderToken<object>;
  }
  return fallback;
}

function applicationJobRuntimeDependencies(
  provider: ApplicationKubernetesJobRuntimeProvider | ApplicationAwsJobRuntimeProvider,
): readonly import('./application-capability-implementation.js').ApplicationCapabilityImplementationDependency[] {
  return [
    {
      slot: 'queue',
      requirement: Queue as ApplicationProviderToken<object>,
      requiredGuarantees: ['boundedDelivery'],
      operations: ['queue.submit', 'queue.cancel'],
      input: maintainedDependencyInput(provider.queue as object, Queue as ApplicationProviderToken<object>),
    },
    {
      slot: 'execution-host',
      requirement: FiniteExecutionHost as ApplicationProviderToken<object>,
      requiredGuarantees: ['finiteExecution', 'boundedCancellation'],
      operations: ['job.attempt.start', 'job.attempt.cancel'],
      input: maintainedDependencyInput(provider.executionHost as object, FiniteExecutionHost as ApplicationProviderToken<object>),
    },
    {
      slot: 'results',
      requirement: JobResultStore as ApplicationProviderToken<object>,
      requiredGuarantees: ['terminalCompareAndSet', 'progressRetention'],
      operations: ['job.result.read', 'job.result.write', 'job.progress.write'],
      input: maintainedDependencyInput(provider.results as object, JobResultStore as ApplicationProviderToken<object>),
    },
    {
      slot: 'scheduler',
      requirement: Scheduler as ApplicationProviderToken<object>,
      requiredGuarantees: ['stableDefinitionIdentity', 'stableOccurrenceIdentity'],
      operations: ['schedule.submit', 'schedule.cancel'],
      input: maintainedDependencyInput(provider.scheduler as object, Scheduler as ApplicationProviderToken<object>),
    },
    {
      slot: 'events',
      requirement: EventLog as ApplicationProviderToken<object>,
      requiredGuarantees: ['atLeastOnce', 'stableMessageIds'],
      operations: ['event.publish'],
      input: maintainedDependencyInput(provider.events as object, EventLog as ApplicationProviderToken<object>),
    },
  ];
}

export const IndexStore: ApplicationIndexStoreProviderToken = applicationQualifiableProviderToken({
  name: 'IndexStore',
  description: 'Default app-scoped index backend provider.',
  contract: builtInProviderContract('IndexStore', ['typedIndexes']),
  valkey(options = {}) {
    return { kind: 'valkey', ...options };
  },
});

export const Search: ApplicationSearchProviderToken =
  applicationQualifiableProviderToken({
    name: 'Search',
    description:
      'Rebuildable relationship-aware search projections over canonical application models.',
    contract: builtInProviderContract('Search', [
      'committedChangeSynchronization',
      'typedFilters',
      'generationCutover',
      'authorizationFilters',
    ]),
    accepts: isApplicationSearchProvider,
    postgres(options) {
      if (!applicationTransactionalDatabaseImplementation(options.database)) {
        throw new Error(
          'Search.postgres(...) requires a TransactionalDatabase provider or qualified binding.',
        );
      }
      const maximumCandidateRows = options.maximumCandidateRows ?? 10_000;
      if (
        !Number.isInteger(maximumCandidateRows)
        || maximumCandidateRows < 1
      ) {
        throw new Error(
          'Search.postgres(...) maximumCandidateRows must be a positive integer.',
        );
      }
      return maintainedBuiltInImplementation(Search, 'Search.postgres', {
        kind: 'postgres-search',
        ...options,
        maximumCandidateRows,
        capabilities: options.capabilities ?? [
          'text',
          'filters',
          'sort',
          'facets',
        ],
      }, {
        runtimeAdapter: '@applik8s/runtime-postgres/search',
      readiness: 'applik8s.search.postgres.readiness/v1alpha1',
      lifecycle: 'application',
      migration: 'applik8s.search.postgres.migration/v1alpha1',
      dependencies: [{
        slot: 'database',
        requirement: TransactionalDatabase as ApplicationProviderToken<object>,
        requiredGuarantees: ['transactions', 'strongReads'],
        operations: ['database.read', 'database.write'],
        input: maintainedDependencyInput(
          options.database as object,
          TransactionalDatabase as ApplicationProviderToken<object>,
        ),
      }],
      });
    },
    openSearch(options = {}) {
      assertApplicationOpenSearchProvider(options);
      return maintainedBuiltInImplementation(Search, 'Search.openSearch', {
        kind: 'opensearch',
        provision: true,
        ...options,
        capabilities: options.capabilities ?? [
          'text',
          'filters',
          'sort',
          'facets',
          'highlights',
          'fuzzy',
          'openSearchQuery',
        ],
      }, {
        runtimeAdapter: '@applik8s/runtime-opensearch',
        deploymentContributor: '@applik8s/deployment-compiler/providers/opensearch',
        readiness: 'applik8s.search.opensearch.readiness/v1alpha1',
        lifecycle: 'application',
        migration: 'applik8s.search.opensearch.migration/v1alpha1',
      });
    },
    externalOpenSearch(options) {
      if (!applicationProviderRequiredString(options.endpoint)) {
        throw new Error(
          'Search.externalOpenSearch(...) requires a non-empty endpoint.',
        );
      }
      assertApplicationOpenSearchProvider(options);
      return maintainedBuiltInImplementation(Search, 'Search.externalOpenSearch', {
        kind: 'opensearch',
        ...options,
        provision: false,
        capabilities: options.capabilities ?? [
          'text',
          'filters',
          'sort',
          'facets',
          'highlights',
          'fuzzy',
          'openSearchQuery',
        ],
      }, {
        runtimeAdapter: '@applik8s/runtime-opensearch',
        readiness: 'applik8s.search.opensearch.external-readiness/v1alpha1',
        lifecycle: 'external',
        migration: 'applik8s.search.opensearch.external-migration/v1alpha1',
      });
    },
  });

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

export const Database: ApplicationDatabaseConstructors = Object.freeze({
  postgres(options = {}) {
    const provider = TransactionalDatabase.postgres(options);
    const external = provider.ownership === 'external' || provider.provision === false;
    return maintainedBuiltInImplementation(TransactionalDatabase, 'Database.postgres', provider, {
      runtimeAdapter: '@applik8s/runtime-postgres',
      ...(external
        ? {}
        : { deploymentContributor: '@applik8s/deployment-compiler/providers/postgres' }),
      readiness: external
        ? 'applik8s.database.postgres.external-readiness/v1alpha1'
        : 'applik8s.database.postgres.readiness/v1alpha1',
      lifecycle: external ? 'external' : 'application',
      migration: 'applik8s.database.postgres.migration/v1alpha1',
    });
  },
  auroraPostgres(options: Omit<ApplicationAuroraPostgresTransactionalDatabaseProvider, 'kind'>) {
    assertApplicationAwsAccount(options.account, 'Database.auroraPostgres');
    if (options.database !== undefined && !applicationProviderRequiredString(options.database)) {
      throw new Error('Database.auroraPostgres({ database }) must not be empty.');
    }
    if (options.readers !== undefined && (!Number.isSafeInteger(options.readers) || options.readers < 0)) {
      throw new Error('Database.auroraPostgres({ readers }) must be a non-negative safe integer.');
    }
    for (const [field, value] of [
      ['minimumCapacity', options.minimumCapacity],
      ['maximumCapacity', options.maximumCapacity],
    ] as const) {
      if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
        throw new Error(`Database.auroraPostgres({ ${field} }) must be positive.`);
      }
    }
    if (
      options.minimumCapacity !== undefined
      && options.maximumCapacity !== undefined
      && options.minimumCapacity > options.maximumCapacity
    ) {
      throw new Error('Database.auroraPostgres minimumCapacity cannot exceed maximumCapacity.');
    }
    const provider: ApplicationAuroraPostgresTransactionalDatabaseProvider = {
      kind: 'aurora-postgresql',
      retention: 'retain',
      ...options,
    };
    return maintainedBuiltInImplementation(TransactionalDatabase, 'Database.auroraPostgres', provider, {
      runtimeAdapter: '@applik8s/runtime-postgres',
      deploymentContributor: '@applik8s/deployment-alchemy/providers/aurora-postgres',
      readiness: 'applik8s.database.aurora-postgres.readiness/v1alpha1',
      lifecycle: provider.retention === 'retain' ? 'retained' : 'application',
      migration: 'applik8s.database.aurora-postgres.migration/v1alpha1',
      maturity: 'experimental',
    });
  },
  externalPostgres(options: ApplicationExternalPostgresDatabaseOptions) {
    const {
      connection,
      ...providerOptions
    } = options;
    if (!connection && !providerOptions.cluster) {
      throw new Error(
        'Database.externalPostgres(...) requires connection or an external CNPG cluster reference.',
      );
    }
    if (connection && !applicationProviderRequiredString(connection.secretName)) {
      throw new Error(
        'Database.externalPostgres(...) connection.secretName must not be empty.',
      );
    }
    const provider = TransactionalDatabase.postgres({
      ...providerOptions,
      ownership: 'external',
      provision: false,
      ...(connection
        ? {
            connectionSecret: {
              apiVersion: 'v1',
              kind: 'Secret',
              name: connection.secretName,
              ...(connection.namespace
                ? { namespace: connection.namespace }
                : {}),
            },
          }
        : {}),
      ...(connection?.key ? { connectionSecretKey: connection.key } : {}),
    });
    return maintainedBuiltInImplementation(
      TransactionalDatabase,
      'Database.externalPostgres',
      provider,
      {
        runtimeAdapter: '@applik8s/runtime-postgres',
        readiness: 'applik8s.database.postgres.external-readiness/v1alpha1',
        lifecycle: 'external',
        migration: 'applik8s.database.postgres.external-migration/v1alpha1',
      },
    );
  },
  migrations: TransactionalDatabase.migrations,
});

export const CounterStore: ApplicationQualifiableProviderToken<ApplicationCounterStoreProvider> = applicationQualifiableProviderToken({
  name: 'CounterStore',
  description: 'Default app-scoped counter backend provider.',
  contract: builtInProviderContract('CounterStore', ['atomicIncrement']),
});

export const EventSource: ApplicationQualifiableProviderToken<ApplicationEventSourceProvider> = applicationQualifiableProviderToken({
  name: 'EventSource',
  description: 'Default app-scoped event source provider.',
  contract: builtInProviderContract('EventSource', ['watch']),
});

export const EventLog: ApplicationEventLogProviderToken = applicationQualifiableProviderToken({
  name: 'EventLog',
  description: 'Durable app-scoped command and committed-event transport provider.',
  contract: builtInProviderContract('EventLog', ['atLeastOnce', 'stableMessageIds', 'replay']),
  accepts: isApplicationEventLogProvider,
  jetStream(options = {}) {
    return maintainedBuiltInImplementation(EventLog, 'EventLog.jetStream', {
      kind: 'nats-jetstream',
      ...options,
    }, {
      runtimeAdapter: '@applik8s/runtime-nats/event-log',
      deploymentContributor: '@applik8s/deployment-compiler/providers/nats-jetstream',
      readiness: 'applik8s.event-log.jetstream.readiness/v1alpha1',
      lifecycle: options.provision === false ? 'external' : 'application',
      migration: 'applik8s.event-log.jetstream.migration/v1alpha1',
    });
  },
  kinesis(options) {
    assertApplicationAwsAccount(options.account, 'EventLog.kinesis');
    if (options.streamName !== undefined && !options.streamName.trim()) {
      throw new Error('EventLog.kinesis({ streamName }) must not be empty.');
    }
    if (options.retentionHours !== undefined && (!Number.isSafeInteger(options.retentionHours) || options.retentionHours < 24)) {
      throw new Error('EventLog.kinesis({ retentionHours }) must be a safe integer of at least 24.');
    }
    return maintainedBuiltInImplementation(EventLog, 'EventLog.kinesis', {
      kind: 'kinesis',
      ...options,
    }, {
      runtimeAdapter: '@applik8s/runtime-aws/kinesis',
      deploymentContributor: '@applik8s/deployment-alchemy/providers/kinesis',
      readiness: 'applik8s.event-log.kinesis.readiness/v1alpha1',
      lifecycle: 'application',
      migration: 'applik8s.event-log.kinesis.migration/v1alpha1',
      maturity: 'experimental',
    });
  },
});

export const Secret: ApplicationQualifiableProviderToken<ApplicationSecretProvider> = applicationQualifiableProviderToken({
  name: 'Secret',
  description: 'Default app-scoped secret material provider.',
  contract: builtInProviderContract('Secret', ['secretReferences']),
});

export const Queue: ApplicationQueueProviderToken = applicationQualifiableProviderToken({
  name: 'Queue',
  description: 'Default app-scoped queue provider.',
  contract: builtInProviderContract('Queue', ['boundedDelivery']),
  jetStream(options) {
    return maintainedBuiltInImplementation(Queue, 'Queue.jetStream', {
      kind: 'jetstream-job-queue',
      ...options,
    }, {
      runtimeAdapter: '@applik8s/runtime-nats/job-queue',
      deploymentContributor: '@applik8s/deployment-compiler/providers/job-queue-jetstream',
      readiness: 'applik8s.job-queue.jetstream.readiness/v1alpha1',
      lifecycle: 'application',
      migration: 'applik8s.job-queue.jetstream.migration/v1alpha1',
      maturity: 'experimental',
      dependencies: [{
        slot: 'event-log',
        requirement: EventLog as ApplicationProviderToken<object>,
        requiredGuarantees: ['atLeastOnce', 'stableMessageIds'],
        operations: ['event.publish', 'event.consume'],
        input: maintainedDependencyInput(
          options.eventLog as object,
          EventLog as ApplicationProviderToken<object>,
        ),
      }],
    });
  },
  sqs(options) {
    return maintainedBuiltInImplementation(Queue, 'Queue.sqs', {
      kind: 'sqs-job-queue',
      ...options,
    }, {
      runtimeAdapter: '@applik8s/runtime-aws/job-queue',
      deploymentContributor: '@applik8s/deployment-alchemy/providers/sqs-job-queue',
      readiness: 'applik8s.job-queue.sqs.readiness/v1alpha1',
      lifecycle: 'application',
      migration: 'applik8s.job-queue.sqs.migration/v1alpha1',
      maturity: 'experimental',
    });
  },
});

export const ObjectStorage: ApplicationObjectStorageProviderToken = applicationQualifiableProviderToken({
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
    if (
      !dynamicOwnership
      && options.ownership === 'direct-provisioned'
      && options.provisioning?.kind !== 'local-s3'
      && !applicationTypeKroExpressionValue(
        options.provisioning?.storageClassName,
      )
      && !applicationProviderRequiredString(
        options.provisioning?.storageClassName,
      )
    ) {
      throw new Error('ObjectStorage.s3({ ownership: "direct-provisioned" }) requires provisioning.storageClassName for an ObjectBucketClaim.');
    }
    if (!dynamicOwnership && options.ownership !== 'direct-provisioned' && options.provisioning) {
      throw new Error('ObjectStorage.s3({ provisioning }) is valid only with ownership: "direct-provisioned".');
    }
    const provider: ApplicationS3ObjectStorageProvider = { kind: 's3', ...options };
    const external = provider.ownership !== 'direct-provisioned';
    return maintainedBuiltInImplementation(ObjectStorage, 'ObjectStorage.s3', provider, {
      runtimeAdapter: '@applik8s/runtime/object-storage-s3',
      ...(external
        ? {}
        : { deploymentContributor: '@applik8s/deployment-compiler/providers/object-storage' }),
      readiness: external
        ? 'applik8s.object-storage.s3.external-readiness/v1alpha1'
        : 'applik8s.object-storage.s3.readiness/v1alpha1',
      lifecycle: external ? 'external' : 'application',
      migration: 'applik8s.object-storage.s3.migration/v1alpha1',
    });
  },
  configMap(options = {}) {
    return maintainedBuiltInImplementation(ObjectStorage, 'ObjectStorage.configMap', {
      kind: 'kubernetes-configmap-objects',
      ...options,
    }, {
      runtimeAdapter: '@applik8s/runtime-kubernetes/object-storage',
      deploymentContributor: '@applik8s/deployment-compiler/providers/object-storage',
      readiness: 'applik8s.object-storage.config-map.readiness/v1alpha1',
      lifecycle: 'application',
      migration: 'applik8s.object-storage.config-map.migration/v1alpha1',
    });
  },
  backup(provider, options) {
    const storage = applicationObjectStorageImplementation(provider);
    if (!storage || storage.kind !== 's3') {
      throw new Error(
        'ObjectStorage.backup(provider, ...) requires an S3 object-storage provider.',
      );
    }
    if (!applicationProviderRequiredString(options.prefix)) {
      throw new Error('ObjectStorage.backup(..., { prefix }) must not be empty.');
    }
    if (!storage.credentialsSecret?.name) {
      throw new Error(
        'ObjectStorage.backup(provider, ...) requires provider credentialsSecret.',
      );
    }
    return {
      kind: 's3',
      destinationPath: applicationTypeKroString(
        's3://',
        storage.bucket,
        '/',
        options.prefix.replace(/^\/+|\/+$/g, ''),
      ),
      ...(storage.endpoint ? { endpoint: storage.endpoint } : {}),
      credentialsSecret: storage.credentialsSecret,
      accessKeyIdKey:
        options.accessKeyIdKey
        ?? storage.accessKeyIdKey
        ?? 'AWS_ACCESS_KEY_ID',
      secretAccessKeyKey:
        options.secretAccessKeyKey
        ?? storage.secretAccessKeyKey
        ?? 'AWS_SECRET_ACCESS_KEY',
      ...(options.regionKey ? { regionKey: options.regionKey } : {}),
    };
  },
});

export const HttpExposure: ApplicationHttpExposureProviderToken = applicationQualifiableProviderToken({
  name: 'HttpExposure',
  description: 'Default app-scoped HTTP exposure provider.',
  contract: builtInProviderContract('HttpExposure', ['httpRouting']),
  ingress(options = {}) {
    if (options.controllerNamespace !== undefined && !options.controllerNamespace.trim()) {
      throw new Error('HttpExposure.ingress({ controllerNamespace }) must not be empty when provided.');
    }
    return { kind: 'ingress', ...options };
  },
  nodePort(options) {
    if (!options.host.trim()) throw new Error('HttpExposure.nodePort({ host }) must not be empty.');
    if (!applicationProviderNodePort(options.nodePort)) {
      throw new Error('HttpExposure.nodePort({ nodePort }) must be an integer in the Kubernetes NodePort range 30000-32767 or a typed installation reference.');
    }
    return { kind: 'node-port', ...options };
  },
});

export const Certificate: ApplicationCertificateProviderToken = applicationQualifiableProviderToken({
  name: 'Certificate',
  description: 'Managed TLS certificate provider for public application exposure.',
  contract: builtInProviderContract('Certificate', ['managedCertificate']),
  certManager(options) {
    return { kind: 'cert-manager', ...options };
  },
});

export const DnsPublication: ApplicationDnsPublicationProviderToken = applicationQualifiableProviderToken({
  name: 'DnsPublication',
  description: 'Managed DNS publication provider for public application exposure.',
  contract: builtInProviderContract('DnsPublication', ['dnsPublication']),
  externalDns(options = {}) {
    return { kind: 'external-dns', ...options };
  },
});

export const CredentialStore: ApplicationQualifiableProviderToken<ApplicationCredentialStoreProvider> = applicationQualifiableProviderToken({
  name: 'CredentialStore',
  description: 'Default app-scoped credential storage provider.',
  contract: builtInProviderContract('CredentialStore', ['credentialReferences']),
});

export const WorkflowEngine: ApplicationWorkflowEngineProviderToken = applicationQualifiableProviderToken({
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
    const provider: ApplicationHatchetWorkflowEngineProvider = {
      kind: 'hatchet',
      ...options,
      admission: applicationWorkflowAdmissionPolicy(options.admission),
    };
    return maintainedBuiltInImplementation(WorkflowEngine, 'WorkflowEngine.hatchet', provider, {
      runtimeAdapter: '@applik8s/runtime-hatchet',
      ...(provider.provision === false
        ? {}
        : { deploymentContributor: '@applik8s/deployment-compiler/providers/hatchet' }),
      readiness: provider.provision === false
        ? 'applik8s.workflow.hatchet.external-readiness/v1alpha1'
        : 'applik8s.workflow.hatchet.readiness/v1alpha1',
      lifecycle: provider.provision === false ? 'external' : 'application',
      migration: 'applik8s.workflow.hatchet.migration/v1alpha1',
    });
  },
});

export const FiniteExecutionHost: ApplicationFiniteExecutionHostProviderToken = applicationQualifiableProviderToken({
  name: 'FiniteExecutionHost',
  description: 'Provider-private finite workload host selected by a JobRuntime implementation.',
  contract: builtInProviderContract('FiniteExecutionHost', ['finiteExecution', 'boundedCancellation']),
  kubernetes(options) {
    return maintainedBuiltInImplementation(FiniteExecutionHost, 'FiniteExecutionHost.kubernetes', {
      kind: 'kubernetes-finite-execution-host',
      ...options,
    }, {
      runtimeAdapter: '@applik8s/runtime-kubernetes/finite-execution-host',
      deploymentContributor: '@applik8s/deployment-compiler/providers/finite-execution-host-kubernetes',
      readiness: 'applik8s.finite-execution-host.kubernetes.readiness/v1alpha1',
      lifecycle: 'application',
      migration: 'applik8s.finite-execution-host.kubernetes.migration/v1alpha1',
      maturity: 'experimental',
      dependencies: [{
        slot: 'registry',
        requirement: ContainerRegistry as ApplicationProviderToken<object>,
        requiredGuarantees: ['immutableDigest', 'executionTimeCredentials'],
        operations: ['artifact.read'],
        input: maintainedDependencyInput(
          options.registry as object,
          ContainerRegistry as ApplicationProviderToken<object>,
        ),
      }],
    });
  },
  aws(options) {
    return maintainedBuiltInImplementation(FiniteExecutionHost, 'FiniteExecutionHost.aws', {
      kind: 'aws-finite-execution-host',
      mode: 'automatic',
      ...options,
    }, {
      runtimeAdapter: '@applik8s/runtime-aws/finite-execution-host',
      deploymentContributor: '@applik8s/deployment-alchemy/providers/finite-execution-host-aws',
      readiness: 'applik8s.finite-execution-host.aws.readiness/v1alpha1',
      lifecycle: 'application',
      migration: 'applik8s.finite-execution-host.aws.migration/v1alpha1',
      maturity: 'experimental',
      dependencies: [{
        slot: 'registry',
        requirement: ContainerRegistry as ApplicationProviderToken<object>,
        requiredGuarantees: ['immutableDigest', 'executionTimeCredentials'],
        operations: ['artifact.read'],
        input: maintainedDependencyInput(
          options.registry as object,
          ContainerRegistry as ApplicationProviderToken<object>,
        ),
      }],
    });
  },
});

export const JobResultStore: ApplicationJobResultStoreProviderToken = applicationQualifiableProviderToken({
  name: 'JobResultStore',
  description: 'Provider-private durable Job result and progress authority.',
  contract: builtInProviderContract('JobResultStore', ['terminalCompareAndSet', 'progressRetention']),
  postgres(options) {
    return maintainedBuiltInImplementation(JobResultStore, 'JobResultStore.postgres', {
      kind: 'postgres-job-result-store',
      ...options,
    }, {
      runtimeAdapter: '@applik8s/runtime-postgres/job-result-store',
      readiness: 'applik8s.job-result-store.postgres.readiness/v1alpha1',
      lifecycle: 'application',
      migration: 'applik8s.job-result-store.postgres.migration/v1alpha1',
      maturity: 'experimental',
      dependencies: [{
        slot: 'database',
        requirement: TransactionalDatabase as ApplicationProviderToken<object>,
        requiredGuarantees: ['transactions', 'strongReads'],
        operations: ['database.read', 'database.write'],
        input: maintainedDependencyInput(
          options.database as object,
          TransactionalDatabase as ApplicationProviderToken<object>,
        ),
      }],
    });
  },
});

export const JobRuntime: ApplicationJobRuntimeProviderToken = applicationQualifiableProviderToken({
  name: 'JobRuntime',
  description: 'Provider-neutral finite managed execution with durable run, result, progress, cancellation, and retry semantics.',
  contract: {
    apiVersion: 'applik8s.provider/v1alpha1',
    interface: 'JobRuntime',
    version: 'v1alpha1',
    requirements: ['finiteExecution', 'durableAdmission', 'resultProgressAuthority', 'cancellation'],
    guarantees: ['scopedIdempotency', 'wholeAttemptRetry', 'firstTerminalTransition', 'callerTimeoutRejoin'],
  },
  accepts: isApplicationJobRuntimeProvider,
  local(options = {}) {
    const provider: ApplicationLocalJobRuntimeProvider = { kind: 'local-job-runtime', ...options };
    assertApplicationJobRuntimeProvider(provider);
    return maintainedBuiltInImplementation(JobRuntime, 'JobRuntime.local', provider, {
      runtimeAdapter: '@applik8s/applik8s/job-runtime-local',
      readiness: 'applik8s.job-runtime.local.readiness/v1alpha1',
      lifecycle: 'application',
      migration: 'applik8s.job-runtime.local.migration/v1alpha1',
      maturity: 'experimental',
    });
  },
  kubernetes(options) {
    const provider: ApplicationKubernetesJobRuntimeProvider = { kind: 'kubernetes-job-runtime', ...options };
    assertApplicationJobRuntimeProvider(provider);
    return maintainedBuiltInImplementation(JobRuntime, 'JobRuntime.kubernetes', provider, {
      runtimeAdapter: '@applik8s/runtime-kubernetes/job-runtime',
      deploymentContributor: '@applik8s/deployment-compiler/providers/job-runtime-kubernetes',
      readiness: 'applik8s.job-runtime.kubernetes.readiness/v1alpha1',
      lifecycle: 'application',
      migration: 'applik8s.job-runtime.kubernetes.migration/v1alpha1',
      maturity: 'experimental',
      dependencies: applicationJobRuntimeDependencies(provider),
    });
  },
  aws(options) {
    const provider: ApplicationAwsJobRuntimeProvider = { kind: 'aws-job-runtime', ...options };
    assertApplicationJobRuntimeProvider(provider);
    return maintainedBuiltInImplementation(JobRuntime, 'JobRuntime.aws', provider, {
      runtimeAdapter: '@applik8s/runtime-aws/job-runtime',
      deploymentContributor: '@applik8s/deployment-compiler/providers/job-runtime-aws',
      readiness: 'applik8s.job-runtime.aws.readiness/v1alpha1',
      lifecycle: 'application',
      migration: 'applik8s.job-runtime.aws.migration/v1alpha1',
      maturity: 'experimental',
      dependencies: applicationJobRuntimeDependencies(provider),
    });
  },
});

export const ManagedModelStore: ApplicationManagedModelStoreProviderToken = applicationQualifiableProviderToken({
  name: 'ManagedModelStore',
  description: 'Provider-neutral desired-state, lifecycle, status, condition, and deletion authority for one managed model.',
  contract: {
    apiVersion: 'applik8s.provider/v1alpha1',
    interface: 'ManagedModelStore',
    version: 'v1alpha1',
    requirements: ['stableIdentity', 'generation', 'lifecycleState', 'boundedResync'],
    guarantees: ['separateDesiredAndStatusAuthority', 'compareAndSet', 'durableDeletionIntent'],
  },
  accepts: isApplicationManagedModelStoreProvider,
  postgres(options) {
    const provider: ApplicationPostgresManagedModelStoreProvider = {
      kind: 'postgres-managed-model-store',
      ...options,
    };
    return maintainedBuiltInImplementation(ManagedModelStore, 'ManagedModelStore.postgres', provider, {
      runtimeAdapter: '@applik8s/runtime-postgres/managed-model-store',
      readiness: 'applik8s.managed-model-store.postgres.readiness/v1alpha1',
      lifecycle: 'application',
      migration: 'applik8s.managed-model-store.postgres.migration/v1alpha1',
      maturity: 'experimental',
      dependencies: [{
        slot: 'database',
        requirement: TransactionalDatabase as ApplicationProviderToken<object>,
        requiredGuarantees: ['transactions', 'strongReads'],
        operations: ['database.read', 'database.write'],
        input: maintainedDependencyInput(
          options.database as object,
          TransactionalDatabase as ApplicationProviderToken<object>,
        ),
      }],
    });
  },
  kubernetes(options) {
    const provider: ApplicationKubernetesManagedModelStoreProvider = {
      kind: 'kubernetes-managed-model-store',
      ...options,
    };
    return maintainedBuiltInImplementation(ManagedModelStore, 'ManagedModelStore.kubernetes', provider, {
      runtimeAdapter: '@applik8s/runtime-kubernetes/managed-model-store',
      readiness: 'applik8s.managed-model-store.kubernetes.readiness/v1alpha1',
      lifecycle: 'external',
      migration: 'applik8s.managed-model-store.kubernetes.migration/v1alpha1',
      maturity: 'experimental',
    });
  },
});

export const OperatorRuntime: ApplicationOperatorRuntimeProviderToken = applicationQualifiableProviderToken({
  name: 'OperatorRuntime',
  description: 'Provider-neutral fenced continuous reconciliation with resync, wakeup, status, and finalization semantics.',
  contract: {
    apiVersion: 'applik8s.provider/v1alpha1',
    interface: 'OperatorRuntime',
    version: 'v1alpha1',
    requirements: ['fencedLease', 'boundedResync', 'durableWakeup', 'restartSafeFinalization'],
    guarantees: ['singleCommitter', 'staleWorkerRejection', 'notificationIndependentRecovery'],
  },
  accepts: isApplicationOperatorRuntimeProvider,
  distributed(options) {
    const provider: ApplicationDistributedOperatorRuntimeProvider = {
      kind: 'distributed-operator-runtime',
      ...options,
    };
    return maintainedBuiltInImplementation(OperatorRuntime, 'OperatorRuntime.distributed', provider, {
      runtimeAdapter: '@applik8s/runtime-postgres/operator-runtime',
      readiness: 'applik8s.operator-runtime.distributed.readiness/v1alpha1',
      lifecycle: 'application',
      migration: 'applik8s.operator-runtime.distributed.migration/v1alpha1',
      maturity: 'experimental',
      dependencies: [
        {
          slot: 'database',
          requirement: TransactionalDatabase as ApplicationProviderToken<object>,
          requiredGuarantees: ['transactions', 'strongReads'],
          operations: ['database.read', 'database.write'],
          input: maintainedDependencyInput(
            options.database as object,
            TransactionalDatabase as ApplicationProviderToken<object>,
          ),
        },
        {
          slot: 'scheduler',
          requirement: Scheduler as ApplicationProviderToken<object>,
          requiredGuarantees: ['durableOccurrenceIdentity', 'boundedMisfire'],
          operations: ['schedule.manage'],
          input: maintainedDependencyInput(
            options.scheduler as object,
            Scheduler as ApplicationProviderToken<object>,
          ),
        },
        ...(options.queue ? [{
          slot: 'queue',
          requirement: Queue as ApplicationProviderToken<object>,
          requiredGuarantees: ['durableDelivery'],
          operations: ['queue.publish', 'queue.consume'],
          input: maintainedDependencyInput(
            options.queue as object,
            Queue as ApplicationProviderToken<object>,
          ),
        }] : []),
      ],
    });
  },
  kubernetes(options) {
    const provider: ApplicationKubernetesOperatorRuntimeProvider = {
      kind: 'kubernetes-operator-runtime',
      ...options,
    };
    return maintainedBuiltInImplementation(OperatorRuntime, 'OperatorRuntime.kubernetes', provider, {
      runtimeAdapter: '@applik8s/runtime-kubernetes/operator-runtime',
      deploymentContributor: '@applik8s/deployment-compiler/providers/operator-runtime-kubernetes',
      readiness: 'applik8s.operator-runtime.kubernetes.readiness/v1alpha1',
      lifecycle: 'application',
      migration: 'applik8s.operator-runtime.kubernetes.migration/v1alpha1',
      maturity: 'experimental',
    });
  },
});

export const Scheduler: ApplicationSchedulerProviderToken = applicationQualifiableProviderToken({
  name: 'Scheduler',
  description: 'Provider-neutral fixed, dynamic, and one-time function-native scheduling.',
  contract: {
    apiVersion: 'applik8s.provider/v1alpha1',
    interface: 'Scheduler',
    version: 'v1alpha1',
    requirements: ['idempotentOccurrenceAdmission', 'revisionedDesiredState', 'boundedMisfires'],
    guarantees: ['stableDefinitionIdentity', 'stableOccurrenceIdentity', 'overlapPolicy', 'causalPropagation'],
  },
  accepts: isApplicationSchedulerProvider,
  schedule(
    this: ApplicationSchedulerProviderToken | ApplicationQualifiedProviderToken<ApplicationSchedulerProvider>,
    options: unknown,
    handler: unknown,
  ) {
    return createApplicationSchedule(this, options as never, handler as never) as never;
  },
  local(options = {}) {
    return maintainedBuiltInImplementation(Scheduler, 'Scheduler.local', {
      kind: 'local-scheduler',
      clock: 'system',
      persistence: 'application-database',
      ...options,
    }, {
      runtimeAdapter: '@applik8s/applik8s/schedule-runtime-local',
      readiness: 'applik8s.scheduler.local.readiness/v1alpha1',
      lifecycle: 'application',
      migration: 'applik8s.scheduler.local.migration/v1alpha1',
      maturity: 'stable',
    });
  },
  cronJob(options = {}) {
    return maintainedBuiltInImplementation(Scheduler, 'Scheduler.cronJob', {
      kind: 'kubernetes-cronjob-scheduler',
      maximumDefinitions: 100,
      ...options,
    }, {
      runtimeAdapter: '@applik8s/runtime-kubernetes/scheduler',
      deploymentContributor: '@applik8s/deployment-compiler/providers/scheduler',
      readiness: 'applik8s.scheduler.cron-job.readiness/v1alpha1',
      lifecycle: 'application',
      migration: 'applik8s.scheduler.cron-job.migration/v1alpha1',
    });
  },
  hatchet(options = {}) {
    return maintainedBuiltInImplementation(Scheduler, 'Scheduler.hatchet', {
      kind: 'hatchet-scheduler',
      ...options,
    }, {
      runtimeAdapter: '@applik8s/runtime-hatchet/scheduler',
      readiness: 'applik8s.scheduler.hatchet.readiness/v1alpha1',
      lifecycle: 'application',
      migration: 'applik8s.scheduler.hatchet.migration/v1alpha1',
      dependencies: [{
        slot: 'workflow-engine',
        requirement: WorkflowEngine as ApplicationProviderToken<object>,
        operations: ['workflow.schedule'],
        input: maintainedDependencyInput(
          options.workflowEngine,
          WorkflowEngine as ApplicationProviderToken<object>,
        ),
      }],
    });
  },
  eventBridge(options = {}) {
    if (options.account) assertApplicationAwsAccount(options.account, 'Scheduler.eventBridge');
    return maintainedBuiltInImplementation(Scheduler, 'Scheduler.eventBridge', {
      kind: 'eventbridge-scheduler',
      ...options,
    }, {
      runtimeAdapter: '@applik8s/runtime-aws/scheduler',
      deploymentContributor: '@applik8s/deployment-alchemy/providers/eventbridge-scheduler',
      readiness: 'applik8s.scheduler.event-bridge.readiness/v1alpha1',
      lifecycle: 'application',
      migration: 'applik8s.scheduler.event-bridge.migration/v1alpha1',
    });
  },
  postgres(options) {
    return maintainedBuiltInImplementation(Scheduler, 'Scheduler.postgres', {
      kind: 'postgres-scheduler',
      ...options,
    }, {
      runtimeAdapter: '@applik8s/runtime-postgres/scheduler',
      readiness: 'applik8s.scheduler.postgres.readiness/v1alpha1',
      lifecycle: 'application',
      migration: 'applik8s.scheduler.postgres.migration/v1alpha1',
      maturity: 'experimental',
      dependencies: [{
        slot: 'database',
        requirement: TransactionalDatabase as ApplicationProviderToken<object>,
        requiredGuarantees: ['transactions', 'strongReads'],
        operations: ['database.read', 'database.write'],
        input: maintainedDependencyInput(
          options.database as object,
          TransactionalDatabase as ApplicationProviderToken<object>,
        ),
      }],
    });
  },
});

export const ActorRuntime: ApplicationActorRuntimeProviderToken = applicationQualifiableProviderToken({
  name: 'ActorRuntime',
  description: 'Provider-neutral durable identity-addressed actor execution.',
  contract: {
    apiVersion: 'applik8s.provider/v1alpha1',
    interface: 'ActorRuntime',
    version: 'v1alpha1',
    requirements: ['serializedTurns', 'idempotentAdmission', 'durableState', 'inertReferences'],
    guarantees: ['perIdentityOrdering', 'priorResultRecovery', 'causalPropagation'],
  },
  accepts: isApplicationActorRuntimeProvider,
  local(options = {}) {
    return maintainedBuiltInImplementation(ActorRuntime, 'ActorRuntime.local', {
      kind: 'deterministic-local-actors',
      persistence: 'application-database',
      ...options,
    }, {
      runtimeAdapter: '@applik8s/applik8s/actor-runtime-local',
      readiness: 'applik8s.actor.local.readiness/v1alpha1',
      lifecycle: 'application',
      migration: 'applik8s.actor.local.migration/v1alpha1',
      maturity: 'stable',
    });
  },
  celld(options) {
    return maintainedBuiltInImplementation(ActorRuntime, 'ActorRuntime.celld', {
      kind: 'celld-actors',
      ...options,
    }, {
      runtimeAdapter: '@applik8s/celld-operator/runtime',
      deploymentContributor: '@applik8s/celld-operator/typekro',
      readiness: 'applik8s.actor.celld.readiness/v1alpha1',
      lifecycle: 'application',
      migration: 'applik8s.actor.celld.migration/v1alpha1',
      dependencies: [{
        slot: 'state-store',
        requirement: ObjectStorage as ApplicationProviderToken<object>,
        requiredGuarantees: ['objectReadWrite'],
        operations: ['object.read', 'object.write'],
        input: maintainedDependencyInput(
          options.stateStore as object,
          ObjectStorage as ApplicationProviderToken<object>,
        ),
      }],
    });
  },
  rivet(options) {
    if (!/^https:\/\//u.test(options.endpoint)) throw new Error('ActorRuntime.rivet(...) requires an HTTPS endpoint.');
    return maintainedBuiltInImplementation(ActorRuntime, 'ActorRuntime.rivet', {
      kind: 'rivet-actors',
      ...options,
    }, {
      runtimeAdapter: '@applik8s/runtime/rivet-actors',
      readiness: 'applik8s.actor.rivet.external-readiness/v1alpha1',
      lifecycle: 'external',
      migration: 'applik8s.actor.rivet.external-migration/v1alpha1',
    });
  },
});

export function telemetryPolicy(options: ApplicationTelemetryPolicyOptions = {}): ApplicationTelemetryPolicy {
  const probability = (value: number | undefined, fallback: number, label: string): number => {
    const result = value ?? fallback;
    if (!Number.isFinite(result) || result < 0 || result > 1) throw new Error(`${label} must be between 0 and 1.`);
    return result;
  };
  const durationSeconds = (value: string, label: string): number => {
    const match = /^(\d+)(ms|s|m|h|d)$/u.exec(value.trim());
    if (!match) throw new Error(`${label} must use a bounded duration such as 500ms, 30s, 5m, 2h, or 1d.`);
    const amount = Number(match[1]);
    const multiplier = match[2] === 'ms' ? 0.001 : match[2] === 's' ? 1 : match[2] === 'm' ? 60 : match[2] === 'h' ? 3_600 : 86_400;
    const result = amount * multiplier;
    if (!Number.isFinite(result) || result <= 0) throw new Error(`${label} must be positive.`);
    return result;
  };
  const allowedKeys = [...new Set(options.baggage?.allowedKeys ?? [])].sort();
  for (const key of allowedKeys) {
    if (!/^[a-z][a-z0-9_.-]{0,62}$/u.test(key)) throw new Error(`Telemetry baggage key ${JSON.stringify(key)} is not a bounded stable identifier.`);
  }
  const maximumBytes = options.baggage?.maximumBytes ?? 2_048;
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0 || maximumBytes > 8_192) {
    throw new Error('Telemetry baggage maximumBytes must be an integer between 0 and 8192.');
  }
  return Object.freeze({
    apiVersion: 'applik8s.telemetryPolicy/v1alpha1' as const,
    logs: {
      level: options.logs?.level ?? 'info',
      overrides: Object.freeze({ ...(options.logs?.overrides ?? {}) }),
      debugSample: probability(options.logs?.sample?.debug, 0.1, 'Telemetry debug sampling'),
    },
    metrics: {
      intervalSeconds: durationSeconds(options.metrics?.interval ?? '30s', 'Telemetry metrics interval'),
      cardinalityBudget: options.metrics?.cardinalityBudget ?? 'bounded',
    },
    traces: {
      headSample: probability(options.traces?.headSample, 0.1, 'Telemetry trace head sampling'),
      alwaysSampleErrors: options.traces?.alwaysSampleErrors ?? true,
      ...(options.traces?.tailSample ? {
        tailSample: { latencyGreaterThanSeconds: durationSeconds(options.traces.tailSample.latency.replace(/^>/u, ''), 'Telemetry tail-sampling latency') },
      } : {}),
    },
    baggage: { allowedKeys, maximumBytes },
    redaction: {
      deniedFields: [...new Set(options.redaction?.deniedFields ?? ['authorization', 'cookie', 'password', 'secret', 'token'])].sort(),
    },
  });
}

const defaultTelemetryPolicy = telemetryPolicy();
const defaultTelemetryRetention = Object.freeze({ logs: '7d', traces: '7d', metrics: '30d' });

function observabilityRetention(value?: Partial<ApplicationObservabilityProviderBase['retention']>): ApplicationObservabilityProviderBase['retention'] {
  const retention = { ...defaultTelemetryRetention, ...value };
  for (const [signal, duration] of Object.entries(retention)) {
    if (!/^\d+[smhd]$/u.test(duration) || Number.parseInt(duration, 10) < 1) throw new Error(`Observability ${signal} retention must be a positive duration.`);
  }
  return Object.freeze(retention);
}

export const Observability: ApplicationObservabilityProviderToken = applicationQualifiableProviderToken({
  name: 'Observability',
  description: 'Provider-neutral OpenTelemetry traces, structured logs, metrics, and managed collector topology.',
  contract: {
    apiVersion: 'applik8s.provider/v1alpha1',
    interface: 'Observability',
    version: 'v1alpha1',
    requirements: ['w3cTraceContext', 'structuredLogs', 'boundedMetrics', 'redaction', 'failureIsolation'],
    guarantees: ['canonicalIdentityCorrelation', 'boundedBaggage', 'providerReportedDegradation'],
  },
  accepts: isApplicationObservabilityProvider,
  local(options = {}) {
    return { kind: 'local-otel', policy: options.policy ?? defaultTelemetryPolicy, retention: observabilityRetention(options.retention), ...(options.endpoint ? { endpoint: options.endpoint } : {}) };
  },
  clickStack(options) {
    return { kind: 'clickstack', ...options, policy: options.policy ?? defaultTelemetryPolicy, retention: observabilityRetention(options.retention) };
  },
  cloudWatch(options) {
    return { kind: 'cloudwatch', ...options, policy: options.policy ?? defaultTelemetryPolicy, retention: observabilityRetention(options.retention) };
  },
  otlp(options) {
    assertApplicationOtlpObservabilityProvider(options);
    return {
      kind: 'otlp',
      ...options,
      protocol: options.protocol ?? 'http/protobuf',
      signals: Object.freeze([...(options.signals ?? ['traces', 'metrics', 'logs'])]),
      tls: options.tls ?? { trust: 'system' },
      policy: options.policy ?? defaultTelemetryPolicy,
      retention: observabilityRetention(options.retention),
    };
  },
});

export const LakehouseDataset: ApplicationLakehouseDatasetProviderToken = applicationQualifiableProviderToken({
  name: 'LakehouseDataset',
  description: 'Provider-neutral immutable snapshot dataset publication.',
  contract: {
    apiVersion: 'applik8s.provider/v1alpha1',
    interface: 'LakehouseDataset',
    version: 'v1alpha1',
    requirements: ['immutableObjects', 'atomicManifestPublication', 'schemaRevision', 'frontierIdempotency'],
    guarantees: ['publishedSnapshotConsistency', 'manifestIntegrity', 'explicitEvolution'],
  },
  accepts: isApplicationLakehouseDatasetProvider,
  query<TInput extends object, TOutput extends object>(this: ApplicationQualifiedLakehouseDatasetProviderToken, contract: ApplicationLakehouseDatasetQueryContract<TInput, TOutput>, handler: (input: TInput) => TOutput | Promise<TOutput>) {
    return createApplicationLakehouseDatasetQuery(this, contract, handler);
  },
});

export const LakehouseQuery: ApplicationLakehouseQueryProviderToken = applicationQualifiableProviderToken({
  name: 'LakehouseQuery',
  description: 'Provider-neutral asynchronous queries pinned to one published dataset snapshot.',
  contract: {
    apiVersion: 'applik8s.provider/v1alpha1',
    interface: 'LakehouseQuery',
    version: 'v1alpha1',
    requirements: ['snapshotPinning', 'boundedPagination', 'timeout', 'cancellation'],
    guarantees: ['signedSnapshotCursor', 'terminalReceipt', 'scanEvidence'],
  },
  accepts: isApplicationLakehouseQueryProvider,
  query(this: ApplicationQualifiedLakehouseQueryProviderToken, request: unknown) {
    return createApplicationLakehouseQuery(this, request as never) as never;
  },
});

export const Lakehouse: ApplicationLakehouseConstructors = Object.freeze({
  duckdbDataset(options = {}) {
    assertLakehouseDatasetOptions(options);
    return { kind: 'duckdb-dataset' as const, ...options };
  },
  s3Dataset(options: Omit<ApplicationS3LakehouseDatasetProvider, 'kind'>) {
    assertLakehouseDatasetOptions(options);
    return { kind: 's3-dataset' as const, ...options };
  },
  duckdbQueries(options = {}) { return { kind: 'duckdb-queries' as const, ...options }; },
  athenaQueries(options: Omit<ApplicationAthenaLakehouseQueryProvider, 'kind'>) { return { kind: 'athena-queries' as const, ...options }; },
  qualifiedProviderRequired(options: Omit<ApplicationQualifiedLakehouseProviderRequired, 'kind'>) {
    if (!options.reason.trim()) throw new Error('Lakehouse.qualifiedProviderRequired(...) requires an actionable reason.');
    return { kind: 'qualified-lakehouse-provider-required' as const, ...options };
  },
});

function assertLakehouseDatasetOptions(options: {
  readonly cursorSecretEnvironment?: string;
  readonly schemaRevision?: string;
  readonly maximumObjectsPerSnapshot?: number;
  readonly retainedSnapshots?: number;
}): void {
  if (options.cursorSecretEnvironment !== undefined
    && !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(options.cursorSecretEnvironment)) {
    throw new Error('Lakehouse dataset cursorSecretEnvironment must be an environment variable name.');
  }
  if (options.schemaRevision !== undefined && !options.schemaRevision.trim()) {
    throw new Error('Lakehouse dataset schemaRevision must not be empty.');
  }
  for (const [name, value, maximum] of [
    ['maximumObjectsPerSnapshot', options.maximumObjectsPerSnapshot, 10_000],
    ['retainedSnapshots', options.retainedSnapshots, 100_000],
  ] as const) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1 || value > maximum)) {
      throw new Error(`Lakehouse dataset ${name} must be an integer from 1 through ${maximum}.`);
    }
  }
}

export const AnalyticalDatabase: ApplicationAnalyticalDatabaseProviderToken = applicationQualifiableProviderToken({
  name: 'AnalyticalDatabase',
  description: 'Rebuildable analytical database; durable replay remains owned by the source stream.',
  contract: builtInProviderContract('AnalyticalDatabase', ['idempotentInsert', 'checkpoint', 'fullRebuild']),
  accepts: isApplicationAnalyticalDatabaseProvider,
  clickhouse(options = {}) {
    return { kind: 'clickhouse', ...options };
  },
});

export const Analytics: ApplicationAnalyticsConstructors = Object.freeze({
  postgres(options: Omit<ApplicationPostgresAnalyticalDatabaseProvider, 'kind'>) {
    if (!options.schema.trim()) {
      throw new Error('Analytics.postgres(...) requires a non-empty analytical schema.');
    }
    if (!applicationTransactionalDatabaseImplementation(options.database)) {
      throw new Error(
        'Analytics.postgres(...) requires a TransactionalDatabase provider or qualified binding.',
      );
    }
    return maintainedBuiltInImplementation(AnalyticalDatabase, 'Analytics.postgres', {
      kind: 'postgres-analytics' as const,
      ...options,
    }, {
      runtimeAdapter: '@applik8s/runtime-postgres/analytics',
      readiness: 'applik8s.analytics.postgres.readiness/v1alpha1',
      lifecycle: 'application',
      migration: 'applik8s.analytics.postgres.migration/v1alpha1',
      dependencies: [{
        slot: 'database',
        requirement: TransactionalDatabase as ApplicationProviderToken<object>,
        requiredGuarantees: ['transactions'],
        operations: ['database.read', 'database.write'],
        input: maintainedDependencyInput(
          options.database as object,
          TransactionalDatabase as ApplicationProviderToken<object>,
        ),
      }],
    });
  },
  clickHouse(options = {}) {
    const provider = AnalyticalDatabase.clickhouse(options);
    return maintainedBuiltInImplementation(AnalyticalDatabase, 'Analytics.clickHouse', provider, {
      runtimeAdapter: '@applik8s/runtime/clickhouse',
      ...(provider.provision === false
        ? {}
        : { deploymentContributor: '@applik8s/deployment-compiler/providers/clickhouse' }),
      readiness: provider.provision === false
        ? 'applik8s.analytics.clickhouse.external-readiness/v1alpha1'
        : 'applik8s.analytics.clickhouse.readiness/v1alpha1',
      lifecycle: provider.provision === false ? 'external' : 'application',
      migration: 'applik8s.analytics.clickhouse.migration/v1alpha1',
    });
  },
  externalClickHouse(options: ApplicationExternalClickHouseOptions) {
    const connection =
      'connection' in options ? options.connection : options;
    if (!applicationProviderRequiredString(connection.endpoint)) {
      throw new Error(
        'Analytics.externalClickHouse(...) requires a non-empty endpoint.',
      );
    }
    const credentialsSecretName =
      'connection' in options
        ? connection.credentialsSecretName
        : options.credentialsSecretName;
    const credentialsSecretNamespace =
      'connection' in options
        ? connection.credentialsSecretNamespace
        : options.credentialsSecretNamespace;
    if (
      credentialsSecretName !== undefined
      && !applicationProviderRequiredString(credentialsSecretName)
    ) {
      throw new Error(
        'Analytics.externalClickHouse(...) credentialsSecretName must not be empty.',
      );
    }
    return maintainedBuiltInImplementation(AnalyticalDatabase, 'Analytics.externalClickHouse', {
      kind: 'clickhouse' as const,
      ...(options.name ? { name: options.name } : {}),
      ...(options.namespace ? { namespace: options.namespace } : {}),
      provision: false,
      endpoint: connection.endpoint,
      ...(connection.database ? { database: connection.database } : {}),
      ...(credentialsSecretName
        ? {
            credentialsSecret: {
              apiVersion: 'v1',
              kind: 'Secret',
              name: credentialsSecretName,
              ...(credentialsSecretNamespace
                ? { namespace: credentialsSecretNamespace }
                : {}),
            },
          }
        : {}),
      ...(connection.usernameKey
        ? { usernameKey: connection.usernameKey }
        : {}),
      ...(connection.passwordKey
        ? { passwordKey: connection.passwordKey }
        : {}),
    }, {
      runtimeAdapter: '@applik8s/runtime/clickhouse',
      readiness: 'applik8s.analytics.clickhouse.external-readiness/v1alpha1',
      lifecycle: 'external',
      migration: 'applik8s.analytics.clickhouse.external-migration/v1alpha1',
    });
  },
});

export const ContainerRegistry: ApplicationContainerRegistryProviderToken = applicationQualifiableProviderToken({
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
  ecr(options) {
    assertApplicationAwsAccount(options.account, 'ContainerRegistry.ecr');
    if (options.repositoryPrefix !== undefined && !options.repositoryPrefix.trim()) {
      throw new Error('ContainerRegistry.ecr({ repositoryPrefix }) must not be empty.');
    }
    return maintainedBuiltInImplementation(ContainerRegistry, 'ContainerRegistry.ecr', {
      kind: 'ecr',
      ...options,
    }, {
      runtimeAdapter: '@applik8s/runtime-aws/container-registry',
      deploymentContributor: '@applik8s/deployment-alchemy/providers/ecr',
      readiness: 'applik8s.container-registry.ecr.readiness/v1alpha1',
      lifecycle: 'application',
      migration: 'applik8s.container-registry.ecr.migration/v1alpha1',
      maturity: 'experimental',
    });
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
});

function assertApplicationHostOptions(
  factoryName: 'ApplicationHost.managed' | 'ApplicationHost.kubernetes',
  options: Omit<ApplicationManagedHostProvider, 'kind'> | Omit<ApplicationKubernetesHostProvider, 'kind'>,
): void {
  if (options.replicas !== undefined && !applicationTypeKroExpressionValue(options.replicas) && (!Number.isInteger(options.replicas) || options.replicas < 1)) {
    throw new Error(`${factoryName}({ replicas }) requires a positive integer.`);
  }
  if (options.port !== undefined && (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535)) {
    throw new Error(`${factoryName}({ port }) requires a valid TCP port.`);
  }
  if (options.image !== undefined && !options.image.trim()) {
    throw new Error(`${factoryName}({ image }) must not be empty.`);
  }
}

export const ApplicationHost: ApplicationHostProviderToken = applicationQualifiableProviderToken({
  name: 'ApplicationHost',
  description: 'Immutable application artifact hosting and runtime lifecycle.',
  contract: builtInProviderContract('ApplicationHost', ['immutableArtifact', 'readiness', 'gracefulShutdown', 'serviceDiscovery']),
  accepts: isApplicationHostProvider,
  managed(options = {}) {
    assertApplicationHostOptions('ApplicationHost.managed', options);
    return { kind: 'managed-application-host', ...options };
  },
  kubernetes(options = {}) {
    assertApplicationHostOptions('ApplicationHost.kubernetes', options);
    if (options.cursorSecret?.name !== undefined && !options.cursorSecret.name.trim()) {
      throw new Error('ApplicationHost.kubernetes({ cursorSecret.name }) must not be empty.');
    }
    if (options.cursorSecret?.key !== undefined && !options.cursorSecret.key.trim()) {
      throw new Error('ApplicationHost.kubernetes({ cursorSecret.key }) must not be empty.');
    }
    return { kind: 'kubernetes-application-host', ...options };
  },
});

export const IdentityProvider: ApplicationIdentityProviderToken = applicationQualifiableProviderToken({
  name: 'IdentityProvider',
  description: 'Application-supplied request authentication and trusted-context admission.',
  contract: builtInProviderContract('IdentityProvider', ['principalIdentity', 'trustedContextAdmission', 'authorizationVersion']),
  accepts: isApplicationIdentityProvider,
  from(authenticate, options) {
    if (options?.infrastructure) assertApplicationIdentityInfrastructure(options.infrastructure);
    if (options?.ready !== undefined && typeof options.ready !== 'function') throw new Error('IdentityProvider.from({ ready }) must be a function.');
    if (options?.handle !== undefined && typeof options.handle !== 'function') throw new Error('IdentityProvider.from({ handle }) must be a function.');
    if (
      options?.dependencies?.database
      && (
        !isApplicationProviderBinding(options.dependencies.database)
        || applicationProviderTokenName(
          applicationProviderBaseToken(options.dependencies.database.token),
        ) !== 'TransactionalDatabase'
      )
    ) {
      throw new Error(
        'IdentityProvider.from({ dependencies.database }) requires an injected TransactionalDatabase binding.',
      );
    }
    const provider: ApplicationIdentityProvider = {
      kind: 'identity-provider',
      authenticate,
      ...(options?.infrastructure ? { infrastructure: options.infrastructure } : {}),
      ...(options?.ready ? { ready: options.ready } : {}),
      ...(options?.handle ? { handle: options.handle } : {}),
    };
    if (options?.dependencies) {
      applicationIdentityProviderDependencies.set(
        provider,
        options.dependencies,
      );
    }
    return provider;
  },
  deterministic(options) {
    const admission = createDeterministicApplicationAdmission(options);
    return {
      kind: 'identity-provider',
      authenticate: () => admission,
      deterministicAdmission: admission,
      ready: () => undefined,
    };
  },
});

const applicationIdentityProviderDependencies =
  new WeakMap<object, ApplicationIdentityProviderDependencies>();

export interface ApplicationIdentityProviderDatabaseDependency {
  readonly interface: 'TransactionalDatabase';
  readonly qualification?: ApplicationProviderQualification;
}

/**
 * Compiler-only dependency metadata for server-side identity admission. It is
 * deliberately kept out of serialized provider values so injected bindings
 * and token implementations never leak into the ApplicationGraph.
 */
export function applicationIdentityProviderDatabaseDependency(
  implementation: unknown,
): ApplicationIdentityProviderDatabaseDependency | undefined {
  const selection = applicationProviderSelectionFor<ApplicationIdentityProvider>(
    implementation,
  );
  const candidates = selection
    ? [...Object.values(selection.cases), selection.default]
    : [implementation];
  const dependencies = candidates.map((candidate) =>
    candidate && typeof candidate === 'object'
      ? applicationIdentityProviderDependencies.get(candidate)
      : undefined);
  const databases = dependencies.map((dependency) => dependency?.database);
  if (databases.every((database) => database === undefined)) return undefined;
  if (databases.some((database) => database === undefined)) {
    throw new Error(
      'Application profile IdentityProvider branches must declare the same TransactionalDatabase admission dependency.',
    );
  }
  const identities = databases.map((database) => {
    if (!database || !isApplicationProviderBinding(database)) {
      throw new Error(
        'IdentityProvider database dependency is not an injected provider binding.',
      );
    }
    const token = applicationProviderBaseToken(database.token);
    if (applicationProviderTokenName(token) !== 'TransactionalDatabase') {
      throw new Error(
        'IdentityProvider database dependency must reference TransactionalDatabase.',
      );
    }
    return {
      interface: 'TransactionalDatabase' as const,
      ...(applicationProviderQualificationFor(database.token)
        ? {
            qualification:
              applicationProviderQualificationFor(database.token)!,
          }
        : {}),
    };
  });
  const first = identities[0]!;
  if (
    identities.some(
      (identity) => JSON.stringify(identity) !== JSON.stringify(first),
    )
  ) {
    throw new Error(
      'Application profile IdentityProvider branches resolve different TransactionalDatabase admission dependencies.',
    );
  }
  return first;
}

export const OAuthAuthorizationServer: ApplicationOAuthAuthorizationServerProviderToken = applicationQualifiableProviderToken({
  name: 'OAuthAuthorizationServer',
  description: 'Provider-neutral OAuth authorization requests, consent, delegation, and token lifecycle.',
  contract: builtInProviderContract('OAuthAuthorizationServer', ['authorizationCode', 'exactConsentBinding', 'idempotentProviderDecision']),
  accepts: isApplicationOAuthAuthorizationServerProvider,
  from(name, decide, options) {
    if (!name.trim()) throw new Error('OAuthAuthorizationServer.from(name, ...) requires a non-empty provider name.');
    if (typeof decide !== 'function') throw new Error('OAuthAuthorizationServer.from(..., decide) requires a decision function.');
    if (options?.infrastructure) assertApplicationIdentityInfrastructure(options.infrastructure);
    if (options?.ready !== undefined && typeof options.ready !== 'function') throw new Error('OAuthAuthorizationServer.from({ ready }) must be a function.');
    return { kind: 'oauth-authorization-server', name, decide, ...(options?.infrastructure ? { infrastructure: options.infrastructure } : {}), ...(options?.ready ? { ready: options.ready } : {}) };
  },
});

export const Authorization: ApplicationAuthorizationProviderToken = applicationQualifiableProviderToken({
  name: 'Authorization',
  description: 'Provider-neutral policy and relationship decisions that assist application-owned authorization rules.',
  contract: builtInProviderContract('Authorization', ['versionedDecisions', 'policyAssistance', 'failClosed']),
  accepts: isApplicationAuthorizationProvider,
  from(decide, options) {
    if (options?.ready !== undefined && typeof options.ready !== 'function') throw new Error('Authorization.from({ ready }) must be a function.');
    return { kind: 'application-authorization', decide, ...(options?.ready ? { ready: options.ready } : {}) };
  },
});


function builtInProviderContract(providerInterface: string, guarantees: readonly string[]): ApplicationTypedProviderContract {
  return { apiVersion: 'applik8s.provider/v1alpha1', interface: providerInterface, version: 'v1alpha1', requirements: [], guarantees };
}

// typecast: provider registry names are literal public API keys used for app.provide(...) inference.
export const providers = { IndexStore, Search, TransactionalDatabase, AnalyticalDatabase, CounterStore, EventSource, EventLog, Secret, Queue, ObjectStorage, HttpExposure, Certificate, DnsPublication, CredentialStore, WorkflowEngine, JobRuntime, ManagedModelStore, OperatorRuntime, Scheduler, ActorRuntime, Observability, LakehouseDataset, LakehouseQuery, ApplicationHost, ContainerRegistry, IdentityProvider, OAuthAuthorizationServer, Authorization, StructuredGeneration } as const;

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
  admission: {
    replayWindowSeconds: 7 * 24 * 60 * 60,
    cleanupIntervalSeconds: 5 * 60,
    cleanupBatchSize: 1_000,
  },
  worker: { replicas: 1, taskSlots: 16, durableSlots: 16, gracefulShutdownSeconds: 30, healthPort: 8001, scaling: { mode: 'fixed' } },
};

export const defaultApplicationProviders: {
  readonly IndexStore: ApplicationValkeyIndexBackend;
  readonly Search: ApplicationPostgresSearchProvider;
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
  readonly JobRuntime: ApplicationJobRuntimeProvider;
} = {
  IndexStore: { kind: 'valkey' },
  Search: {
    kind: 'postgres-search',
    database: { kind: 'postgres' },
    maximumCandidateRows: 10_000,
    capabilities: ['text', 'filters', 'sort', 'facets'],
  },
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
  JobRuntime: { kind: 'local-job-runtime', maximumConcurrency: 4, persistence: 'memory', resultRetentionSeconds: 86_400 },
};

export function isHatchetWorkflowEngineProvider(value: unknown): value is ApplicationHatchetWorkflowEngineProvider {
  if (!value || typeof value !== 'object' || Reflect.get(value, 'kind') !== 'hatchet') return false;
  try {
    applicationWorkflowAdmissionPolicy(Reflect.get(value, 'admission') as Partial<ApplicationWorkflowAdmissionPolicy> | undefined);
    return true;
  } catch {
    return false;
  }
}

export function isApplicationJobRuntimeProvider(value: unknown): value is ApplicationJobRuntimeProvider {
  try {
    assertApplicationJobRuntimeProvider(value);
    return true;
  } catch {
    return false;
  }
}

export function isApplicationManagedModelStoreProvider(value: unknown): value is ApplicationManagedModelStoreProvider {
  if (!value || typeof value !== 'object') return false;
  const kind = Reflect.get(value, 'kind');
  if (kind === 'postgres-managed-model-store') {
    try {
      assertApplicationImplementationInput(
        Reflect.get(value, 'database'),
        TransactionalDatabase,
        'ManagedModelStore PostgreSQL database',
      );
      return true;
    } catch {
      return false;
    }
  }
  if (kind !== 'kubernetes-managed-model-store') return false;
  const cluster = Reflect.get(value, 'cluster');
  return Boolean(
    cluster
      && typeof cluster === 'object'
      && ['current-kubernetes-cluster', 'external-kubernetes-cluster'].includes(String(Reflect.get(cluster, 'kind'))),
  );
}

export function isApplicationOperatorRuntimeProvider(value: unknown): value is ApplicationOperatorRuntimeProvider {
  if (!value || typeof value !== 'object') return false;
  const kind = Reflect.get(value, 'kind');
  if (kind === 'distributed-operator-runtime') {
    try {
      assertApplicationImplementationInput(
        Reflect.get(value, 'database'),
        TransactionalDatabase,
        'OperatorRuntime distributed database',
      );
      assertApplicationImplementationInput(
        Reflect.get(value, 'scheduler'),
        Scheduler,
        'OperatorRuntime distributed scheduler',
      );
      const queue = Reflect.get(value, 'queue');
      if (queue !== undefined) {
        assertApplicationImplementationInput(queue, Queue, 'OperatorRuntime distributed queue');
      }
      return true;
    } catch {
      return false;
    }
  }
  if (kind !== 'kubernetes-operator-runtime') return false;
  const cluster = Reflect.get(value, 'cluster');
  return Boolean(
    cluster
      && typeof cluster === 'object'
      && ['current-kubernetes-cluster', 'external-kubernetes-cluster'].includes(String(Reflect.get(cluster, 'kind'))),
  );
}

function assertApplicationJobRuntimeProvider(value: unknown): asserts value is ApplicationJobRuntimeProvider {
  if (!value || typeof value !== 'object') {
    throw new TypeError('JobRuntime implementation must be an object.');
  }
  const kind = Reflect.get(value, 'kind');
  if (kind !== 'local-job-runtime' && kind !== 'kubernetes-job-runtime' && kind !== 'aws-job-runtime') {
    throw new TypeError('JobRuntime implementation must be created by JobRuntime.local(), .kubernetes(), or .aws().');
  }
  for (const field of ['maximumConcurrency', 'resultRetentionSeconds'] as const) {
    const candidate = Reflect.get(value, field);
    if (candidate !== undefined && (!Number.isSafeInteger(candidate) || Number(candidate) < 1)) {
      throw new TypeError(`JobRuntime ${field} must be a positive safe integer when provided.`);
    }
  }
  const maximumDuration = Reflect.get(value, 'maximumDuration');
  if (maximumDuration !== undefined && (typeof maximumDuration !== 'string' || !maximumDuration.trim())) {
    throw new TypeError('JobRuntime maximumDuration must be a non-empty duration when provided.');
  }
  const namespace = Reflect.get(value, 'namespace');
  if (namespace !== undefined && (typeof namespace !== 'string' || !namespace.trim())) {
    throw new TypeError('JobRuntime namespace must not be empty when provided.');
  }
  if (kind === 'aws-job-runtime') {
    const account = Reflect.get(value, 'account');
    if (!account || typeof account !== 'object' || Reflect.get(account, 'kind') !== 'aws-account') {
      throw new TypeError('JobRuntime.aws(...) requires a typed AWS account implementation.');
    }
  }
  if (kind === 'kubernetes-job-runtime') {
    const cluster = Reflect.get(value, 'cluster');
    if (!cluster || typeof cluster !== 'object' || !['current-kubernetes-cluster', 'external-kubernetes-cluster'].includes(String(Reflect.get(cluster, 'kind')))) {
      throw new TypeError('JobRuntime.kubernetes(...) requires KubernetesCluster.current() or KubernetesCluster.external(...).');
    }
  }
  if (kind === 'kubernetes-job-runtime' || kind === 'aws-job-runtime') {
    assertApplicationImplementationInput(Reflect.get(value, 'queue'), Queue, 'JobRuntime queue');
    assertApplicationImplementationInput(Reflect.get(value, 'executionHost'), FiniteExecutionHost, 'JobRuntime executionHost');
    assertApplicationImplementationInput(Reflect.get(value, 'results'), JobResultStore, 'JobRuntime results');
    assertApplicationImplementationInput(Reflect.get(value, 'scheduler'), Scheduler, 'JobRuntime scheduler');
    assertApplicationImplementationInput(Reflect.get(value, 'events'), EventLog, 'JobRuntime events');
  }
}

function assertApplicationImplementationInput(
  value: unknown,
  token: ApplicationProviderToken<object>,
  label: string,
): void {
  if (!value || typeof value !== 'object') {
    throw new TypeError(`${label} requires a typed capability implementation.`);
  }
  const metadata = applicationCapabilityImplementationMetadata(value);
  if (metadata && applicationProviderTokensMatch(metadata.token, token)) return;
  if (isApplicationProviderBinding(value) && applicationProviderTokensMatch(value.token, token)) return;
  throw new TypeError(`${label} requires a typed ${token.name} implementation or binding.`);
}

function requireProviderConfigString(
  value: ApplicationProviderConfigString,
  label: string,
): void {
  if (typeof value === 'string') {
    if (!value.trim()) throw new TypeError(`${label} must not be empty.`);
    return;
  }
  if (!isApplicationConfigurationBinding(value) || value.kind !== 'config' || value.valueType !== 'string') {
    throw new TypeError(`${label} requires a string literal or config.env(...) binding.`);
  }
}

function requireSecretConfigurationBinding(
  value: ApplicationSecretSourceBinding<unknown>,
  label: string,
): void {
  if (!isApplicationConfigurationBinding(value) || value.kind !== 'secret') {
    throw new TypeError(`${label} requires a secret.env(...) binding.`);
  }
}

function requireProviderConfigUrl(
  value: ApplicationProviderConfigUrl,
  label: string,
): void {
  if (typeof value === 'string') {
    if (!value.trim()) throw new TypeError(`${label} must not be empty.`);
    try {
      new URL(value);
    } catch {
      throw new TypeError(`${label} must be an absolute URL or config.env.url(...) binding.`);
    }
    return;
  }
  if (!isApplicationConfigurationBinding(value) || value.kind !== 'config' || value.valueType !== 'url') {
    throw new TypeError(`${label} requires an absolute URL or config.env.url(...) binding.`);
  }
}

export function applicationWorkflowAdmissionPolicy(
  value: Partial<ApplicationWorkflowAdmissionPolicy> | undefined,
): ApplicationWorkflowAdmissionPolicy {
  const policy = {
    replayWindowSeconds: 7 * 24 * 60 * 60,
    cleanupIntervalSeconds: 5 * 60,
    cleanupBatchSize: 1_000,
    ...value,
  };
  if (!Number.isSafeInteger(policy.replayWindowSeconds) || policy.replayWindowSeconds < 60) {
    throw new Error('Workflow admission replayWindowSeconds must be a safe integer of at least 60 seconds.');
  }
  if (!Number.isSafeInteger(policy.cleanupIntervalSeconds) || policy.cleanupIntervalSeconds < 10) {
    throw new Error('Workflow admission cleanupIntervalSeconds must be a safe integer of at least 10 seconds.');
  }
  if (!Number.isSafeInteger(policy.cleanupBatchSize) || policy.cleanupBatchSize < 1 || policy.cleanupBatchSize > 10_000) {
    throw new Error('Workflow admission cleanupBatchSize must be a safe integer between 1 and 10000.');
  }
  return Object.freeze(policy);
}

export function isApplicationSchedulerProvider(value: unknown): value is ApplicationSchedulerProvider {
  if (!value || typeof value !== 'object') return false;
  return [
    'local-scheduler',
    'kubernetes-cronjob-scheduler',
    'hatchet-scheduler',
    'eventbridge-scheduler',
    'postgres-scheduler',
  ].includes(String(Reflect.get(value, 'kind')));
}

export function isApplicationActorRuntimeProvider(value: unknown): value is ApplicationActorRuntimeProvider {
  if (!value || typeof value !== 'object') return false;
  const kind = Reflect.get(value, 'kind');
  if (kind === 'deterministic-local-actors') return true;
  if (kind === 'celld-actors') return Boolean(Reflect.get(value, 'stateStore'));
  return kind === 'rivet-actors' && typeof Reflect.get(value, 'endpoint') === 'string' && /^https:\/\//u.test(String(Reflect.get(value, 'endpoint')));
}

export function isApplicationObservabilityProvider(value: unknown): value is ApplicationObservabilityProvider {
  if (!value || typeof value !== 'object') return false;
  const kind = Reflect.get(value, 'kind');
  const policy = Reflect.get(value, 'policy');
  const retention = Reflect.get(value, 'retention');
  if (!['local-otel', 'clickstack', 'cloudwatch', 'otlp'].includes(String(kind))
    || !policy || typeof policy !== 'object'
    || Reflect.get(policy, 'apiVersion') !== 'applik8s.telemetryPolicy/v1alpha1'
    || !retention || typeof retention !== 'object') return false;
  if (kind !== 'otlp') return true;
  try {
    assertApplicationOtlpObservabilityProvider(value as Parameters<typeof assertApplicationOtlpObservabilityProvider>[0]);
    return true;
  } catch {
    return false;
  }
}

function assertApplicationOtlpObservabilityProvider(value: {
  readonly endpoint?: unknown;
  readonly protocol?: unknown;
  readonly signals?: unknown;
  readonly authentication?: unknown;
  readonly tls?: unknown;
}): void {
  if (typeof value.endpoint !== 'string') {
    throw new Error('Observability.otlp(...) requires an absolute HTTP(S) endpoint.');
  }
  let endpoint: URL;
  try {
    endpoint = new URL(value.endpoint);
  } catch {
    throw new Error('Observability.otlp(...) requires an absolute HTTP(S) endpoint.');
  }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
    throw new Error('Observability.otlp(...) requires an absolute HTTP(S) endpoint without URL credentials.');
  }
  if (endpoint.protocol === 'http:' && !['localhost', '127.0.0.1', '::1'].includes(endpoint.hostname)) {
    throw new Error('Observability.otlp(...) requires HTTPS except for an explicit loopback collector.');
  }
  if (value.protocol !== undefined && value.protocol !== 'http/protobuf') {
    throw new Error('Observability.otlp(...) v0.8 supports only OTLP HTTP/protobuf.');
  }
  if (value.signals !== undefined) {
    if (!Array.isArray(value.signals) || value.signals.length === 0 || new Set(value.signals).size !== value.signals.length
      || value.signals.some((signal) => !['traces', 'metrics', 'logs'].includes(String(signal)))) {
      throw new Error('Observability.otlp(...) signals must be a non-empty unique subset of traces, metrics, and logs.');
    }
  }
  if (value.authentication !== undefined) {
    if (!value.authentication || typeof value.authentication !== 'object') {
      throw new Error('Observability.otlp(...) authentication must reference one Secret-backed header.');
    }
    const secret = Reflect.get(value.authentication, 'secret');
    const key = Reflect.get(value.authentication, 'key');
    const header = Reflect.get(value.authentication, 'header');
    if (!isNamedSecretReference(secret) || typeof key !== 'string' || !key.trim()
      || typeof header !== 'string' || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(header)) {
      throw new Error('Observability.otlp(...) authentication requires a named Secret, non-empty key, and valid HTTP header name.');
    }
  }
  if (value.tls !== undefined) {
    if (!value.tls || typeof value.tls !== 'object' || !['system', 'custom-ca'].includes(String(Reflect.get(value.tls, 'trust')))) {
      throw new Error('Observability.otlp(...) TLS trust must be system or custom-ca.');
    }
    if (Reflect.get(value.tls, 'trust') === 'custom-ca') {
      if (endpoint.protocol !== 'https:' || !isNamedSecretReference(Reflect.get(value.tls, 'certificateAuthority'))
        || typeof Reflect.get(value.tls, 'key') !== 'string' || !String(Reflect.get(value.tls, 'key')).trim()) {
        throw new Error('Observability.otlp(...) custom CA trust requires HTTPS and a named Secret/key reference.');
      }
      const serverName = Reflect.get(value.tls, 'serverName');
      if (serverName !== undefined && (typeof serverName !== 'string' || !serverName.trim())) {
        throw new Error('Observability.otlp(...) TLS serverName must not be empty.');
      }
    }
  }
}

function isNamedSecretReference(value: unknown): value is ApplicationResourceRef {
  return Boolean(value && typeof value === 'object'
    && Reflect.get(value, 'apiVersion') === 'v1'
    && Reflect.get(value, 'kind') === 'Secret'
    && typeof Reflect.get(value, 'name') === 'string'
    && String(Reflect.get(value, 'name')).trim());
}

export function isApplicationLakehouseDatasetProvider(value: unknown): value is ApplicationLakehouseDatasetProvider {
  if (!value || typeof value !== 'object') return false;
  const kind = Reflect.get(value, 'kind');
  return kind === 'duckdb-dataset'
    || (kind === 'qualified-lakehouse-provider-required'
      && typeof Reflect.get(value, 'reason') === 'string'
      && String(Reflect.get(value, 'reason')).trim().length > 0)
    || (kind === 's3-dataset'
      && ['bucket', 'region', 'catalog'].every((field) => typeof Reflect.get(value, field) === 'string' && String(Reflect.get(value, field)).trim()));
}

export function isApplicationLakehouseQueryProvider(value: unknown): value is ApplicationLakehouseQueryProvider {
  if (!value || typeof value !== 'object') return false;
  const kind = Reflect.get(value, 'kind');
  return kind === 'duckdb-queries'
    || (kind === 'qualified-lakehouse-provider-required'
      && typeof Reflect.get(value, 'reason') === 'string'
      && String(Reflect.get(value, 'reason')).trim().length > 0)
    || (kind === 'athena-queries'
      && ['workgroup', 'region', 'resultLocation'].every((field) => typeof Reflect.get(value, field) === 'string' && String(Reflect.get(value, field)).trim()));
}

export function isClickHouseAnalyticalDatabaseProvider(value: unknown): value is ApplicationClickHouseAnalyticalDatabaseProvider {
  return Boolean(value && typeof value === 'object' && Reflect.get(value, 'kind') === 'clickhouse');
}

export function isPostgresAnalyticalDatabaseProvider(value: unknown): value is ApplicationPostgresAnalyticalDatabaseProvider {
  return Boolean(
    value
    && typeof value === 'object'
    && Reflect.get(value, 'kind') === 'postgres-analytics'
    && typeof Reflect.get(value, 'schema') === 'string'
    && Reflect.get(value, 'schema').trim(),
  );
}

export function isApplicationSearchProvider(
  value: unknown,
): value is ApplicationSearchProvider {
  if (!value || typeof value !== 'object') return false;
  const kind = Reflect.get(value, 'kind');
  if (kind === 'postgres-search') {
    return Boolean(
      applicationTransactionalDatabaseImplementation(
        Reflect.get(value, 'database'),
      ),
    );
  }
  if (kind !== 'opensearch') return false;
  try {
    assertApplicationOpenSearchProvider(
      value as Omit<ApplicationOpenSearchProvider, 'kind'>,
    );
    return true;
  } catch {
    return false;
  }
}

export function applicationSearchProviderImplementation(
  value: unknown,
): ApplicationSearchProvider | undefined {
  if (isApplicationSearchProvider(value)) return value;
  if (isApplicationProviderBinding(value)) {
    if (isApplicationSearchProvider(value.implementation)) {
      return value.implementation;
    }
    const selected = applicationProviderSelectionFor<ApplicationSearchProvider>(
      value.implementation,
    );
    if (selected) return selected.default;
  }
  const selected = applicationProviderSelectionFor<ApplicationSearchProvider>(
    value,
  );
  return selected?.default;
}

function assertApplicationOpenSearchProvider(
  value: Omit<ApplicationOpenSearchProvider, 'kind'>,
): void {
  if (
    value.endpoint !== undefined
    && !applicationProviderRequiredString(value.endpoint)
  ) {
    throw new Error('Search OpenSearch endpoint must not be empty.');
  }
  if (value.topology) {
    if (
      !Number.isInteger(value.topology.nodes)
      || value.topology.nodes < (value.provision === false ? 1 : 3)
    ) {
      throw new Error(
        value.provision === false
          ? 'Search external OpenSearch topology.nodes must be a positive integer.'
          : 'Search managed OpenSearch topology.nodes must be at least three.',
      );
    }
    if (
      value.topology.roles !== undefined
      && value.topology.roles.length === 0
    ) {
      throw new Error(
        'Search OpenSearch topology.roles must not be empty when supplied.',
      );
    }
  }
  if (value.storage) {
    if (!value.storage.size.trim()) {
      throw new Error('Search OpenSearch storage.size must not be empty.');
    }
    if (
      value.storage.storageClassName !== undefined
      && !value.storage.storageClassName.trim()
    ) {
      throw new Error(
        'Search OpenSearch storage.storageClassName must not be empty when supplied.',
      );
    }
  }
  for (
    const [label, secret] of [
      ['adminCredentialsSecret', value.adminCredentialsSecret],
      ['dashboardCredentialsSecret', value.dashboardCredentialsSecret],
    ] as const
  ) {
    if (secret && !applicationProviderRequiredString(secret.name)) {
      throw new Error(
        `Search OpenSearch ${label} must reference a named Secret.`,
      );
    }
  }
  if (value.snapshots) {
    if (
      !value.snapshots.repository.trim()
      || !value.snapshots.bucket.trim()
      || !value.snapshots.credentialsSecret.name?.trim()
    ) {
      throw new Error(
        'Search OpenSearch snapshots require repository, bucket, and a named credentials Secret.',
      );
    }
  }
  if (
    value.tls?.source === 'secret'
    && (
      !value.tls.secretName.trim()
      || !value.tls.adminSecretName.trim()
      || value.tls.adminDn.length === 0
      || value.tls.adminDn.some((dn) => !dn.trim())
    )
  ) {
    throw new Error(
      'Search OpenSearch TLS source secret requires non-empty server/admin Secret names and admin DNs.',
    );
  }
  if (
    value.tls?.source === 'cert-manager'
    && (
      !value.tls.secretName.trim()
      || !value.tls.adminSecretName.trim()
      || !value.tls.issuerName.trim()
      || value.tls.adminDn.length === 0
      || value.tls.adminDn.some((dn) => !dn.trim())
      || value.tls.dnsNames.length === 0
      || value.tls.dnsNames.some((name) => !name.trim())
    )
  ) {
    throw new Error(
      'Search OpenSearch TLS source cert-manager requires non-empty server/admin Secret names, issuer, DNS names, and admin DNs.',
    );
  }
}

export function isApplicationAnalyticalDatabaseProvider(value: unknown): value is ApplicationAnalyticalDatabaseProvider {
  return isClickHouseAnalyticalDatabaseProvider(value)
    || isPostgresAnalyticalDatabaseProvider(value);
}

export function applicationAnalyticalDatabaseImplementation(value: unknown): ApplicationAnalyticalDatabaseProvider | undefined {
  if (isApplicationAnalyticalDatabaseProvider(value)) return value;
  const implementation = isApplicationProviderBinding(value)
    && applicationProviderTokensMatch(value.token, AnalyticalDatabase)
    ? value.implementation
    : value;
  if (isApplicationAnalyticalDatabaseProvider(implementation)) return implementation;
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
  if (
    isApplicationProviderSelection(implementation)
    && [
      ...Object.values(implementation.cases),
      implementation.default,
    ].every(isPostgresAnalyticalDatabaseProvider)
  ) {
    return applicationSelectedPostgresAnalyticsProvider(
      implementation as ApplicationProviderSelectionValue<ApplicationPostgresAnalyticalDatabaseProvider>,
    );
  }
  return undefined;
}

/**
 * Resolves the ClickHouse-capable portion of an analytical selection.
 *
 * A profile may use PostgreSQL for the starter analytical role and ClickHouse
 * for larger profiles. The TypeKro data-plane emitter still needs one
 * graph-safe ClickHouse declaration whose resources disappear in PostgreSQL
 * branches. Mapping those branches to an explicitly disabled ClickHouse value
 * preserves inactive-branch isolation without exposing profile conditionals to
 * every integration.
 */
export function applicationClickHouseAnalyticalDatabaseImplementation(
  value: unknown,
): ApplicationClickHouseAnalyticalDatabaseProvider | undefined {
  const concrete = applicationAnalyticalDatabaseImplementation(value);
  if (concrete && isClickHouseAnalyticalDatabaseProvider(concrete)) {
    return concrete;
  }
  const selection = applicationProviderSelectionFor<ApplicationAnalyticalDatabaseProvider>(
    value,
  );
  if (!selection) return undefined;
  const kubernetesSelection = {
    ...selection,
    cases: Object.fromEntries(
      Object.entries(selection.cases).map(([variant, candidate]) => [
        variant,
        applicationKubernetesAnalyticalDatabaseCandidate(candidate),
      ]),
    ),
    default: applicationKubernetesAnalyticalDatabaseCandidate(selection.default),
  } satisfies ApplicationProviderSelectionValue<unknown>;
  const candidates = [
    ...Object.values(kubernetesSelection.cases),
    kubernetesSelection.default,
  ];
  const clickHouse = candidates.find(isClickHouseAnalyticalDatabaseProvider);
  if (!clickHouse) return undefined;
  const disabled: ApplicationClickHouseAnalyticalDatabaseProvider = {
    ...clickHouse,
    kind: 'clickhouse',
    enabled: false,
    provision: false,
  };
  return applicationSelectedClickHouseProvider({
    ...kubernetesSelection,
    cases: Object.fromEntries(
      Object.entries(kubernetesSelection.cases).map(([variant, candidate]) => [
        variant,
        isClickHouseAnalyticalDatabaseProvider(candidate)
          ? candidate
          : disabled,
      ]),
    ),
    default: isClickHouseAnalyticalDatabaseProvider(kubernetesSelection.default)
      ? kubernetesSelection.default
      : disabled,
  });
}

function applicationKubernetesAnalyticalDatabaseCandidate(value: unknown): unknown {
  const targeted = applicationTargetProviderSelectionFor<ApplicationAnalyticalDatabaseProvider>(value);
  return targeted?.targets.kubernetes ?? value;
}

export function applicationWorkflowEngineImplementation(state: ApplicationProviderState): ApplicationWorkflowEngineProvider {
  const selected = state.providers.extensions?.['WorkflowEngine@v1alpha1'];
  if (isHatchetWorkflowEngineProvider(selected)) {
    return normalizedApplicationHatchetProvider(selected);
  }
  const selection = applicationProviderSelectionFor<ApplicationWorkflowEngineProvider>(selected);
  if (
    selection
    && [...Object.values(selection.cases), selection.default].every(
      isHatchetWorkflowEngineProvider,
    )
  ) {
    return applicationSelectedHatchetProvider(selection);
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
  const selection =
    applicationProviderSelectionFor<ApplicationIndexBackend | 'valkey'>(value);
  if (
    selection
    && [...Object.values(selection.cases), selection.default].every(
      isValkeyIndexDefault,
    )
  ) {
    const normalized: ApplicationProviderSelectionValue<ApplicationIndexBackend> = {
      ...selection,
      cases: Object.fromEntries(
        Object.entries(selection.cases).map(([variant, provider]) => [
          variant,
          provider === 'valkey' ? { kind: 'valkey' as const } : provider,
        ]),
      ),
      default:
        selection.default === 'valkey'
          ? { kind: 'valkey' }
          : selection.default,
    };
    return applicationSelectedValkeyIndexProvider(normalized);
  }
  return undefined;
}

export function isValkeyIndexDefault(value: unknown): boolean {
  return value === 'valkey' || Boolean(value && typeof value === 'object' && Reflect.get(value, 'kind') === 'valkey');
}

// typecast-boundary: provider tokens are identity-based and compared only after their public name and implementation contract are validated.
export function applyApplicationProvider<TImplementation>(state: ApplicationProviderState, token: ApplicationProviderToken<TImplementation>, implementation: TImplementation): void {
  if (isApplicationProviderBinding(implementation)) {
    const boundToken = applicationProviderBaseToken(implementation.token);
    if (!applicationProviderTokensMatch(boundToken, token)) {
      throw new Error(
        `app.provide(${applicationProviderTokenName(token)}, binding) received a binding for ${applicationProviderTokenName(implementation.token)}.`,
      );
    }
    applyApplicationProvider(
      state,
      token,
      implementation.implementation as TImplementation,
    );
    return;
  }
  if (isApplicationProviderSelection(implementation)) {
    const candidates = [...Object.values(implementation.cases), implementation.default];
    if (applicationProviderTokenName(token) === 'IndexStore') {
      if (candidates.some((candidate) => !isValkeyIndexDefault(candidate))) {
        throw new Error(
          'Application profile IndexStore branches must each satisfy the Valkey index provider contract.',
        );
      }
      state.providers.indexes = implementation;
      return;
    }
    if (applicationProviderTokenName(token) === 'Search') {
      if (candidates.some((candidate) => !isApplicationSearchProvider(candidate))) {
        throw new Error(
          'Application profile Search branches must each satisfy the search provider contract.',
        );
      }
      state.providers.search = implementation;
      return;
    }
    if (applicationProviderTokenName(token) === 'TransactionalDatabase') {
      if (candidates.some((candidate) => !isPostgresTransactionalDatabaseProvider(candidate))) {
        throw new Error('Application profile TransactionalDatabase branches must each satisfy the transactional PostgreSQL provider contract.');
      }
      state.providers.database = implementation;
      return;
    }
    if (applicationProviderTokenName(token) === 'AnalyticalDatabase') {
      if (candidates.some((candidate) => !isApplicationAnalyticalDatabaseProvider(candidate))) {
        throw new Error('Application profile AnalyticalDatabase branches must each satisfy the analytical database provider contract.');
      }
      state.providers.analytics = implementation;
      return;
    }
    if (applicationProviderTokenName(token) === 'EventLog') {
      if (candidates.some((candidate) => !isApplicationEventLogProvider(candidate))) {
        throw new Error('Application profile EventLog branches must each satisfy the NATS JetStream event-log contract.');
      }
      state.providers.eventLogs = implementation;
      return;
    }
    if (applicationProviderTokenName(token) === 'ObjectStorage') {
      if (candidates.some((candidate) => !isApplicationObjectStorageProvider(candidate))) {
        throw new Error('Application profile ObjectStorage branches must each satisfy the object-storage contract.');
      }
      state.providers.objects = implementation;
      return;
    }
    if (applicationProviderTokensMatch(token, WorkflowEngine)) {
      if (candidates.some((candidate) => !isHatchetWorkflowEngineProvider(candidate))) {
        throw new Error('Application profile WorkflowEngine branches must each satisfy the Hatchet workflow contract.');
      }
      if (!state.providers.extensions) state.providers.extensions = {};
      state.providers.extensions['WorkflowEngine@v1alpha1'] = implementation;
      return;
    }
    if (applicationProviderTokensMatch(token, Scheduler)) {
      if (candidates.some((candidate) => !isApplicationSchedulerProvider(candidate))) {
        throw new Error('Application profile Scheduler branches must each satisfy the scheduler contract.');
      }
      if (!state.providers.extensions) state.providers.extensions = {};
      state.providers.extensions['Scheduler@v1alpha1'] = implementation;
      return;
    }
    if (applicationProviderTokensMatch(token, ActorRuntime)) {
      if (candidates.some((candidate) => !isApplicationActorRuntimeProvider(candidate))) {
        throw new Error('Application profile ActorRuntime branches must each satisfy the durable actor provider contract.');
      }
      if (!state.providers.extensions) state.providers.extensions = {};
      state.providers.extensions['ActorRuntime@v1alpha1'] = implementation;
      return;
    }
    if (applicationProviderTokensMatch(token, Observability)) {
      if (candidates.some((candidate) => !isApplicationObservabilityProvider(candidate))) {
        throw new Error('Application profile Observability branches must each satisfy the OpenTelemetry provider contract.');
      }
      if (!state.providers.extensions) state.providers.extensions = {};
      state.providers.extensions['Observability@v1alpha1'] = implementation;
      return;
    }
    if (applicationProviderTokensMatch(token, IdentityProvider)) {
      if (candidates.some((candidate) => !isApplicationIdentityProvider(candidate))) {
        throw new Error(
          'Application profile IdentityProvider branches must each satisfy the identity provider contract.',
        );
      }
      if (!state.providers.extensions) state.providers.extensions = {};
      state.providers.extensions['IdentityProvider@v1alpha1'] = implementation;
      return;
    }
    if (applicationProviderTokensMatch(token, ContainerRegistry)) {
      if (candidates.some((candidate) => !isApplicationContainerRegistryProvider(candidate))) {
        throw new Error('app.selectProvider(...) ContainerRegistry branches must each be a valid registry provider.');
      }
      if (!state.providers.extensions) state.providers.extensions = {};
      state.providers.extensions['ContainerRegistry@v1alpha1'] = implementation;
      return;
    }
    if (applicationProviderTokensMatch(token, StructuredGeneration)) {
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
  if (applicationProviderTokenName(token) === 'Search') {
    if (!isApplicationSearchProvider(implementation)) {
      throw new Error(
        'app.provide(Search, ...) requires Search.postgres(...), Search.openSearch(...), or Search.externalOpenSearch(...).',
      );
    }
    state.providers.search = implementation;
    return;
  }
  if (applicationProviderTokenName(token) === 'TransactionalDatabase') {
    if (!isApplicationTransactionalDatabaseProvider(implementation)) {
      throw new Error('app.provide(TransactionalDatabase, ...) requires Database.postgres(...), Database.externalPostgres(...), or Database.auroraPostgres(...).');
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
    if (!isApplicationAnalyticalDatabaseProvider(implementation)) {
      throw new Error('app.provide(AnalyticalDatabase, ...) requires Analytics.postgres(...), Analytics.clickHouse(...), or Analytics.externalClickHouse(...).');
    }
    state.providers.analytics = implementation;
    return;
  }
  if (applicationProviderTokensMatch(token, WorkflowEngine)) {
    if (!isHatchetWorkflowEngineProvider(implementation)) {
      throw new Error('app.provide(WorkflowEngine, ...) currently supports the Hatchet workflow provider. Use WorkflowEngine.hatchet(...).');
    }
    if (!state.providers.extensions) state.providers.extensions = {};
    state.providers.extensions['WorkflowEngine@v1alpha1'] = implementation;
    return;
  }
  if (applicationProviderTokensMatch(token, JobRuntime)) {
    if (!isApplicationJobRuntimeProvider(implementation)) {
      throw new Error('app.provide(JobRuntime, ...) requires JobRuntime.local(), .kubernetes(), or .aws().');
    }
    if (!state.providers.extensions) state.providers.extensions = {};
    state.providers.extensions['JobRuntime@v1alpha1'] = implementation;
    return;
  }
  if (applicationProviderTokensMatch(token, ManagedModelStore)) {
    if (!isApplicationManagedModelStoreProvider(implementation)) {
      throw new Error('app.provide(ManagedModelStore, ...) requires ManagedModelStore.postgres(...) or .kubernetes(...).');
    }
    if (!state.providers.extensions) state.providers.extensions = {};
    state.providers.extensions['ManagedModelStore@v1alpha1'] = implementation;
    return;
  }
  if (applicationProviderTokensMatch(token, OperatorRuntime)) {
    if (!isApplicationOperatorRuntimeProvider(implementation)) {
      throw new Error('app.provide(OperatorRuntime, ...) requires OperatorRuntime.distributed(...) or .kubernetes(...).');
    }
    if (!state.providers.extensions) state.providers.extensions = {};
    state.providers.extensions['OperatorRuntime@v1alpha1'] = implementation;
    return;
  }
  if (applicationProviderTokensMatch(token, Scheduler)) {
    if (!isApplicationSchedulerProvider(implementation)) {
      throw new Error('app.provide(Scheduler, ...) requires Scheduler.local(), .cronJob(), .hatchet(), or .eventBridge().');
    }
    if (!state.providers.extensions) state.providers.extensions = {};
    state.providers.extensions['Scheduler@v1alpha1'] = implementation;
    return;
  }
  if (applicationProviderTokensMatch(token, ActorRuntime)) {
    if (!isApplicationActorRuntimeProvider(implementation)) {
      throw new Error('app.provide(ActorRuntime, ...) requires ActorRuntime.local(), .celld(...), or .rivet(...).');
    }
    if (!state.providers.extensions) state.providers.extensions = {};
    state.providers.extensions['ActorRuntime@v1alpha1'] = implementation;
    return;
  }
  if (applicationProviderTokensMatch(token, Observability)) {
    if (!isApplicationObservabilityProvider(implementation)) {
      throw new Error('app.provide(Observability, ...) requires Observability.local(), .clickStack(...), .cloudWatch(...), or .otlp(...).');
    }
    if (!state.providers.extensions) state.providers.extensions = {};
    state.providers.extensions['Observability@v1alpha1'] = implementation;
    return;
  }
  if (applicationProviderTokensMatch(token, ApplicationHost)) {
    if (!isApplicationHostProvider(implementation)) {
      throw new Error('app.provide(ApplicationHost, ...) requires ApplicationHost.managed(...) or ApplicationHost.kubernetes(...).');
    }
    if (!state.providers.extensions) state.providers.extensions = {};
    state.providers.extensions['ApplicationHost@v1alpha1'] = implementation;
    return;
  }
  if (applicationProviderTokensMatch(token, ContainerRegistry)) {
    if (!isApplicationContainerRegistryProvider(implementation)) {
      throw new Error('app.provide(ContainerRegistry, ...) requires ContainerRegistry.orbstack(), .oci(...), or .harbor(...).');
    }
    if (!state.providers.extensions) state.providers.extensions = {};
    state.providers.extensions['ContainerRegistry@v1alpha1'] = implementation;
    return;
  }
  if (applicationProviderTokensMatch(token, IdentityProvider)) {
    if (!isApplicationIdentityProvider(implementation)) {
      throw new Error('app.provide(IdentityProvider, ...) requires IdentityProvider.from(authenticate).');
    }
    if (!state.providers.extensions) state.providers.extensions = {};
    state.providers.extensions['IdentityProvider@v1alpha1'] = implementation;
    return;
  }
  if (applicationProviderTokensMatch(token, OAuthAuthorizationServer)) {
    if (!isApplicationOAuthAuthorizationServerProvider(implementation)) {
      throw new Error('app.provide(OAuthAuthorizationServer, ...) requires OAuthAuthorizationServer.from(name, decide).');
    }
    if (!state.providers.extensions) state.providers.extensions = {};
    state.providers.extensions['OAuthAuthorizationServer@v1alpha1'] = implementation;
    return;
  }
  if (applicationProviderTokensMatch(token, Authorization)) {
    if (!isApplicationAuthorizationProvider(implementation)) {
      throw new Error('app.provide(Authorization, ...) requires Authorization.from(decide).');
    }
    if (!state.providers.extensions) state.providers.extensions = {};
    state.providers.extensions['Authorization@v1alpha1'] = implementation;
    return;
  }
  if (applicationProviderTokensMatch(token, StructuredGeneration)) {
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

export type ApplicationProviderDeploymentTarget = 'local' | 'aws-local' | 'aws' | 'kubernetes';

/** Provider implementations selected only by deployment target, never by domain code. */
export interface ApplicationTargetProviderSelectionValue<TImplementation = unknown> {
  readonly kind: 'application-target-provider-selection';
  readonly targets: Readonly<Partial<Record<ApplicationProviderDeploymentTarget, TImplementation>>>;
}

export function isApplicationTargetProviderSelection(value: unknown): value is ApplicationTargetProviderSelectionValue {
  return Boolean(
    value
    && typeof value === 'object'
    && Reflect.get(value, 'kind') === 'application-target-provider-selection'
    && Reflect.get(value, 'targets')
    && typeof Reflect.get(value, 'targets') === 'object',
  );
}

export function applicationTargetProviderSelectionFor<TImplementation>(
  value: unknown,
): ApplicationTargetProviderSelectionValue<TImplementation> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  if (isApplicationTargetProviderSelection(value)) return value as ApplicationTargetProviderSelectionValue<TImplementation>;
  if (Reflect.get(value, 'kind') === 'applicationProvider') {
    return applicationTargetProviderSelectionFor<TImplementation>(Reflect.get(value, 'implementation'));
  }
  return undefined;
}

const applicationProviderSelectionMetadata = Symbol.for(
  'Applik8s.ApplicationProviderSelection',
);

export function applicationProviderSelectionFor<TImplementation>(
  value: unknown,
): ApplicationProviderSelectionValue<TImplementation> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  if (isApplicationProviderSelection(value)) {
    return value as ApplicationProviderSelectionValue<TImplementation>;
  }
  if (
    Reflect.get(value, 'kind') === 'applicationProvider'
    && Reflect.get(value, 'implementation')
  ) {
    return applicationProviderSelectionFor<TImplementation>(
      Reflect.get(value, 'implementation'),
    );
  }
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
    && (typeof value === 'object' || typeof value === 'function')
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
    && (typeof value === 'object' || typeof value === 'function')
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
  if (isApplicationTargetProviderSelection(value)) {
    const candidates = Object.values(value.targets);
    return candidates.length > 0 && candidates.every((candidate) =>
      accepts(candidate)
      || applicationProviderPrivateRuntimeFor(candidate) !== undefined
      || applicationProviderSelectionSatisfies(candidate, accepts));
  }
  if (!isApplicationProviderSelection(value)) return false;
  return [
    ...Object.values(value.cases),
    value.default,
  ].every((candidate) =>
    accepts(candidate)
    || applicationProviderPrivateRuntimeFor(candidate) !== undefined
    || applicationProviderSelectionSatisfies(candidate, accepts));
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
    || (tokenName === 'EventLog' && (kind === 'nats-jetstream' || kind === 'kinesis'))
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

export function isAuroraPostgresTransactionalDatabaseProvider(value: unknown): value is ApplicationAuroraPostgresTransactionalDatabaseProvider {
  if (!value || typeof value !== 'object' || Reflect.get(value, 'kind') !== 'aurora-postgresql') return false;
  const account = Reflect.get(value, 'account');
  return Boolean(account && typeof account === 'object' && Reflect.get(account, 'kind') === 'aws-account');
}

export function isApplicationTransactionalDatabaseProvider(value: unknown): value is ApplicationTransactionalDatabaseProvider {
  return isPostgresTransactionalDatabaseProvider(value)
    || isAuroraPostgresTransactionalDatabaseProvider(value);
}

export function applicationTransactionalDatabaseImplementation(store: unknown): ApplicationTransactionalDatabaseProvider | undefined {
  if (isPostgresTransactionalDatabaseProvider(store)) {
    assertApplicationPostgresTransactionalDatabaseLifecycle(store);
    return store;
  }
  if (isAuroraPostgresTransactionalDatabaseProvider(store)) return store;
  if (
    isApplicationProviderBinding(store)
    && applicationProviderTokensMatch(store.token, TransactionalDatabase)
  ) {
    if (isPostgresTransactionalDatabaseProvider(store.implementation)) {
      assertApplicationPostgresTransactionalDatabaseLifecycle(store.implementation);
      return store.implementation;
    }
    if (isAuroraPostgresTransactionalDatabaseProvider(store.implementation)) {
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

/**
 * Provider tokens cross generated package and bundle boundaries. Compare their
 * versioned public contract rather than JavaScript object identity so a
 * workspace package and the generated application cannot fork one capability.
 */
function applicationProviderTokensMatch(
  left: ApplicationProviderToken<unknown>,
  right: ApplicationProviderToken<unknown>,
): boolean {
  const leftBase = applicationProviderBaseToken(left);
  const rightBase = applicationProviderBaseToken(right);
  const leftContract = leftBase.contract;
  const rightContract = rightBase.contract;
  return applicationProviderTokenName(leftBase)
      === applicationProviderTokenName(rightBase)
    && leftContract?.apiVersion === rightContract?.apiVersion
    && leftContract?.interface === rightContract?.interface
    && leftContract?.version === rightContract?.version
    && applicationProviderContractMembersMatch(
      leftContract?.requirements,
      rightContract?.requirements,
    )
    && applicationProviderContractMembersMatch(
      leftContract?.guarantees,
      rightContract?.guarantees,
    );
}

function applicationProviderContractMembersMatch(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  if (!left || !right) return left === right;
  if (left.length !== right.length) return false;
  const rightMembers = new Set(right);
  return left.every((member) => rightMembers.has(member));
}

function applicationSelectedPostgresProvider(
  selection: ApplicationProviderSelectionValue<ApplicationPostgresTransactionalDatabaseProvider>,
): ApplicationPostgresTransactionalDatabaseProvider {
  const normalizedSelection = {
    ...selection,
    cases: Object.fromEntries(
      Object.entries(selection.cases).map(([variant, provider]) => [
        variant,
        normalizedPostgresSelectionBranch(provider),
      ]),
    ),
    default: normalizedPostgresSelectionBranch(selection.default),
  };
  const fallback = normalizedSelection.default;
  const selected = {
    ...fallback,
    kind: 'postgres' as const,
    ...applicationSelectedProviderStringField(normalizedSelection, 'name'),
    ...applicationSelectedProviderStringField(normalizedSelection, 'clusterName'),
    ...applicationSelectedProviderStringField(normalizedSelection, 'namespace'),
    ...applicationSelectedProviderStringField(normalizedSelection, 'database'),
    ...applicationSelectedProviderStringField(normalizedSelection, 'connectionSecretKey'),
  };
  const connectionSecret = applicationSelectedProviderResourceReference(
    normalizedSelection,
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

/**
 * Preserve the connection contract of each profile branch before fields are
 * combined into CEL selections. A Secret declared by only one branch must not
 * turn the managed branches' CloudNativePG-generated Secret into `null`.
 */
function normalizedPostgresSelectionBranch(
  provider: ApplicationPostgresTransactionalDatabaseProvider,
): ApplicationPostgresTransactionalDatabaseProvider {
  const clusterName = provider.clusterName ?? provider.name;
  if (provider.connectionSecret || !clusterName) {
    return {
      ...provider,
      connectionSecretKey: provider.connectionSecretKey ?? 'uri',
    };
  }
  return {
    ...provider,
    connectionSecret: {
      apiVersion: 'v1',
      kind: 'Secret',
      name: applicationTypeKroString(clusterName, '-app'),
      ...(provider.namespace ? { namespace: provider.namespace } : {}),
    },
    connectionSecretKey: provider.connectionSecretKey ?? 'uri',
  };
}

function applicationSelectedClickHouseProvider(
  selection: ApplicationProviderSelectionValue<ApplicationClickHouseAnalyticalDatabaseProvider>,
): ApplicationClickHouseAnalyticalDatabaseProvider {
  const normalizedSelection = {
    ...selection,
    cases: Object.fromEntries(
      Object.entries(selection.cases).map(([variant, provider]) => [
        variant,
        normalizedClickHouseSelectionBranch(provider),
      ]),
    ),
    default: normalizedClickHouseSelectionBranch(selection.default),
  };
  const fallback = normalizedSelection.default;
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
          normalizedSelection,
          (provider) => provider[field],
        );
        return value === undefined ? [] : [[field, value]];
      }),
    ),
  } as ApplicationClickHouseAnalyticalDatabaseProvider;
  const enabled = applicationSelectedProviderValue(
    normalizedSelection,
    (provider) => provider.enabled,
  );
  const provision = applicationSelectedProviderValue(
    normalizedSelection,
    (provider) => provider.provision,
  );
  const credentialsSecret = applicationSelectedClickHouseResourceReference(
    normalizedSelection,
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

function normalizedClickHouseSelectionBranch(
  provider: ApplicationClickHouseAnalyticalDatabaseProvider,
): ApplicationClickHouseAnalyticalDatabaseProvider {
  const name = provider.name ?? 'applik8s-analytics';
  const namespace = provider.namespace ?? 'applik8s-analytics';
  return {
    ...provider,
    kind: 'clickhouse',
    enabled: provider.enabled ?? true,
    name,
    namespace,
    provision: provider.provision ?? true,
    version: provider.version ?? '25.12.5',
    storageSize: provider.storageSize ?? '10Gi',
    // Empty is Kubernetes' explicit "no storage class" spelling. It keeps
    // inactive profile branches CEL type-correct without selecting a cluster
    // default that the author did not request.
    storageClassName: provider.storageClassName ?? '',
    endpoint:
      provider.endpoint
      ?? applicationTypeKroString(
        'http://clickhouse-',
        name,
        '.',
        namespace,
        '.svc.cluster.local:8123',
      ),
    database: provider.database ?? 'default',
    usernameKey: provider.usernameKey ?? 'username',
    passwordKey: provider.passwordKey ?? 'password',
  };
}

function applicationSelectedPostgresAnalyticsProvider(
  selection: ApplicationProviderSelectionValue<ApplicationPostgresAnalyticalDatabaseProvider>,
): ApplicationPostgresAnalyticalDatabaseProvider {
  const fallback = selection.default;
  const providers = [
    ...Object.values(selection.cases),
    fallback,
  ];
  if (providers.some((provider) => provider.database !== fallback.database)) {
    throw new Error(
      'Profile-selected Analytics.postgres(...) branches must reuse one qualified TransactionalDatabase binding.',
    );
  }
  const schema = applicationSelectedProviderValue(
    selection,
    (provider) => provider.schema,
  );
  if (!schema) {
    throw new Error(
      'Profile-selected Analytics.postgres(...) requires one analytical schema in every branch.',
    );
  }
  const provider: ApplicationPostgresAnalyticalDatabaseProvider = {
    kind: 'postgres-analytics',
    database: fallback.database,
    schema,
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
  const values = [...branches.map(([, value]) => value), fallback];
  const omitAbsent = values.some((value) => value === undefined);
  const serialize = (value: TValue | undefined): string => {
    if (value === undefined) return 'omit()';
    const expression = applicationProviderSelectionValueExpression(value);
    // KRO types omit() as a map. dyn() widens a present scalar or structured
    // branch so a conditional field can remain well typed while preserving
    // JavaScript's distinction between an absent field and a null value.
    return omitAbsent ? `dyn(${expression})` : expression;
  };
  const serialized = values.map(serialize);
  if (serialized.every((value) => value === serialized[0])) return fallback;
  const expression = branches.reduceRight(
    (otherwise, [variant, value]) =>
      `(${selection.selector}) == ${JSON.stringify(variant)} ? (${serialize(value)}) : (${otherwise})`,
    serialize(fallback),
  );
  return Cel.expr<TValue>(expression) as TValue;
}

function applicationSelectedField<
  TProvider,
  TKey extends keyof TProvider,
>(
  selection: ApplicationProviderSelectionValue<TProvider>,
  field: TKey,
): Partial<Pick<TProvider, TKey>> {
  const value = applicationSelectedProviderValue(
    selection,
    (provider) => provider[field],
  );
  return value === undefined
    ? {}
    : { [field]: value } as Partial<Pick<TProvider, TKey>>;
}

function applicationSelectedValkeyIndexProvider(
  selection: ApplicationProviderSelectionValue<ApplicationIndexBackend>,
): ApplicationIndexBackend {
  return {
    kind: 'valkey',
    ...applicationSelectedField(selection, 'provisioner'),
    ...applicationSelectedField(selection, 'name'),
    ...applicationSelectedField(selection, 'namespace'),
    ...applicationSelectedField(selection, 'host'),
    ...applicationSelectedField(selection, 'port'),
    ...applicationSelectedField(selection, 'image'),
    ...applicationSelectedField(selection, 'provision'),
    ...applicationSelectedField(selection, 'operator'),
    ...applicationSelectedField(selection, 'topology'),
    ...applicationSelectedField(selection, 'authentication'),
    ...applicationSelectedField(selection, 'storage'),
    ...applicationSelectedField(selection, 'resources'),
    ...applicationSelectedField(selection, 'spec'),
  };
}

function applicationSelectedEventLogProvider(
  selection: ApplicationProviderSelectionValue<ApplicationEventLogProvider>,
): ApplicationEventLogProvider {
  const normalize = (
    provider: ApplicationEventLogProvider,
  ): ApplicationEventLogProvider => {
    const name = provider.name ?? 'applik8s-events';
    // Inactive external branches still participate in the KRO expression
    // graph. Give their non-authoritative installation fields concrete values
    // so omitted resources remain CEL type-correct without inventing external
    // ownership.
    const namespace =
      provider.namespace
      ?? selection.default.namespace
      ?? 'default';
    return {
      ...provider,
      name,
      namespace,
      provision: provider.provision ?? true,
      servers: provider.servers ?? [
        applicationTypeKroString(
          'nats://',
          name,
          namespace ? '.' : '',
          namespace,
          '.svc:4222',
        ),
      ],
      stream: provider.stream ?? 'APPLIK8S_EVENTS',
      subjectPrefix: provider.subjectPrefix ?? 'applik8s',
      replicas: provider.replicas ?? 1,
      authMode: provider.authMode ?? 'token',
      tokenKey: provider.tokenKey ?? 'token',
      userKey: provider.userKey ?? 'user',
      passwordKey: provider.passwordKey ?? 'password',
    };
  };
  const normalizedSelection: ApplicationProviderSelectionValue<ApplicationEventLogProvider> = {
    ...selection,
    cases: Object.fromEntries(
      Object.entries(selection.cases).map(([variant, provider]) => [
        variant,
        normalize(provider),
      ]),
    ),
    default: normalize(selection.default),
  };
  const servers = applicationSelectedArrayField(
    normalizedSelection,
    'servers',
  );
  return {
    kind: 'nats-jetstream',
    ...applicationSelectedField(normalizedSelection, 'name'),
    ...applicationSelectedField(normalizedSelection, 'namespace'),
    ...applicationSelectedField(normalizedSelection, 'provision'),
    ...(servers ? { servers: servers as readonly string[] } : {}),
    ...applicationSelectedField(normalizedSelection, 'stream'),
    ...applicationSelectedField(normalizedSelection, 'subjectPrefix'),
    ...applicationSelectedField(normalizedSelection, 'replicas'),
    ...applicationSelectedField(normalizedSelection, 'storageSize'),
    ...applicationSelectedField(normalizedSelection, 'storageClassName'),
    ...applicationSelectedField(normalizedSelection, 'pvcRetentionPolicy'),
    ...applicationSelectedField(normalizedSelection, 'connectionSecret'),
    ...applicationSelectedField(normalizedSelection, 'authMode'),
    ...applicationSelectedField(normalizedSelection, 'tokenKey'),
    ...applicationSelectedField(normalizedSelection, 'tenantId'),
    ...applicationSelectedField(normalizedSelection, 'userKey'),
    ...applicationSelectedField(normalizedSelection, 'passwordKey'),
  };
}

function applicationSelectedArrayField<
  TProvider,
  TKey extends keyof TProvider,
>(
  selection: ApplicationProviderSelectionValue<TProvider>,
  field: TKey,
): readonly unknown[] | undefined {
  const candidates = [...Object.values(selection.cases), selection.default];
  const values = candidates.map((provider) => provider[field]);
  if (values.every((value) => value === undefined)) return undefined;
  if (!values.every(Array.isArray)) return undefined;
  const arrays = values as readonly (readonly unknown[])[];
  const lengths = new Set(arrays.map((value) => value.length));
  if (lengths.size !== 1) return undefined;
  return Array.from({ length: arrays[0]?.length ?? 0 }, (_, index) =>
    applicationSelectedProviderValue(
      selection,
      (provider) => {
        const value = provider[field];
        return Array.isArray(value) ? value[index] : undefined;
      },
    ),
  );
}

function applicationSelectedS3ObjectStorageProvider(
  selection: ApplicationProviderSelectionValue<ApplicationS3ObjectStorageProvider>,
): ApplicationS3ObjectStorageProvider {
  const bucket = applicationSelectedProviderValue(
    selection,
    (provider) => provider.bucket,
  );
  const region = applicationSelectedProviderValue(
    selection,
    (provider) => provider.region,
  );
  if (bucket === undefined || region === undefined) {
    throw new Error(
      'Every profile-selected S3 ObjectStorage branch must declare bucket and region.',
    );
  }
  const credentialsSecret = applicationSelectedS3ResourceReference(selection);
  const provisioning = applicationSelectedS3Provisioning(selection);
  return {
    kind: 's3',
    bucket,
    region,
    ...applicationSelectedField(selection, 'enabled'),
    ...applicationSelectedField(selection, 'name'),
    ...applicationSelectedField(selection, 'prefix'),
    ...applicationSelectedField(selection, 'endpoint'),
    ...applicationSelectedField(selection, 'forcePathStyle'),
    ...(credentialsSecret ? { credentialsSecret } : {}),
    ...applicationSelectedField(selection, 'accessKeyIdKey'),
    ...applicationSelectedField(selection, 'secretAccessKeyKey'),
    ...applicationSelectedField(selection, 'sessionTokenKey'),
    ...applicationSelectedField(selection, 'ownership'),
    ...(provisioning ? { provisioning } : {}),
    ...applicationSelectedField(selection, 'publicBaseUrl'),
  };
}

function applicationSelectedS3ResourceReference(
  selection: ApplicationProviderSelectionValue<ApplicationS3ObjectStorageProvider>,
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

function applicationSelectedS3Provisioning(
  selection: ApplicationProviderSelectionValue<ApplicationS3ObjectStorageProvider>,
): ApplicationS3ObjectStorageProvider['provisioning'] | undefined {
  const candidates = [
    ...Object.values(selection.cases),
    selection.default,
  ];
  if (candidates.every((provider) => provider.provisioning === undefined)) {
    return undefined;
  }
  const field = (name: string) =>
    applicationSelectedProviderValue(
      selection,
      (provider) => {
        const provisioning = provider.provisioning;
        if (!provisioning) return undefined;
        if (name === 'kind') {
          return provisioning.kind ?? 'object-bucket-claim';
        }
        return Reflect.get(provisioning, name);
      },
    );
  const provisioning = Object.fromEntries(
    [
      'kind',
      'enabled',
      'claimName',
      'storageClassName',
      'timeoutMs',
      'claimLifecycle',
      'name',
      'image',
      'storageSize',
      'platform',
    ]
      .map((name) => [name, field(name)] as const)
      .filter((entry) => entry[1] !== undefined),
  );
  // typecast: each concrete profile branch was validated by ObjectStorage.s3;
  // typecast: the selection record carries those discriminated fields through
  // typecast: TypeKro until the installation profile becomes concrete.
  return provisioning as ApplicationS3ObjectStorageProvider['provisioning'];
}

function applicationSelectedHatchetProvider(
  selection: ApplicationProviderSelectionValue<ApplicationWorkflowEngineProvider>,
): ApplicationWorkflowEngineProvider {
  const normalizedSelection: ApplicationProviderSelectionValue<ApplicationWorkflowEngineProvider> = {
    ...selection,
    cases: Object.fromEntries(
      Object.entries(selection.cases).map(([variant, provider]) => [
        variant,
        normalizedApplicationHatchetProvider(provider),
      ]),
    ),
    default: normalizedApplicationHatchetProvider(selection.default),
  };
  return {
    kind: 'hatchet',
    ...applicationSelectedField(normalizedSelection, 'enabled'),
    ...applicationSelectedField(normalizedSelection, 'name'),
    ...applicationSelectedField(normalizedSelection, 'namespace'),
    ...applicationSelectedField(normalizedSelection, 'provision'),
    ...applicationSelectedField(normalizedSelection, 'chartVersion'),
    ...applicationSelectedField(normalizedSelection, 'serverVersion'),
    ...applicationSelectedField(normalizedSelection, 'mode'),
    ...applicationSelectedField(normalizedSelection, 'database'),
    ...applicationSelectedField(normalizedSelection, 'adminCredentialsSecret'),
    ...applicationSelectedField(normalizedSelection, 'workerTokenSecret'),
    ...applicationSelectedField(normalizedSelection, 'tokenKey'),
    ...applicationSelectedField(normalizedSelection, 'hostPort'),
    ...applicationSelectedField(normalizedSelection, 'apiUrl'),
    ...applicationSelectedField(normalizedSelection, 'tls'),
    ...applicationSelectedField(normalizedSelection, 'dashboard'),
    ...applicationSelectedField(normalizedSelection, 'admission'),
    ...applicationSelectedField(normalizedSelection, 'worker'),
  };
}

function normalizedApplicationHatchetProvider(
  provider: ApplicationWorkflowEngineProvider,
): ApplicationWorkflowEngineProvider {
  const scaling =
    provider.worker?.scaling
    ?? defaultApplicationWorkflowEngineProvider.worker?.scaling;
  const normalized = {
    ...defaultApplicationWorkflowEngineProvider,
    ...provider,
    database: {
      ...defaultApplicationWorkflowEngineProvider.database,
      ...provider.database,
    },
    worker: {
      ...defaultApplicationWorkflowEngineProvider.worker,
      ...provider.worker,
      ...(scaling ? { scaling } : {}),
    },
    admission: applicationWorkflowAdmissionPolicy(provider.admission),
  };
  const managedNamespace = normalized.provision === false
    ? undefined
    : normalized.namespace;
  return {
    ...normalized,
    ...(provider.hostPort
      ? { hostPort: provider.hostPort }
      : managedNamespace
        ? {
            hostPort: applicationTypeKroString(
              'hatchet-engine.',
              managedNamespace,
              '.svc:7070',
            ),
          }
        : {}),
    ...(provider.apiUrl
      ? { apiUrl: provider.apiUrl }
      : managedNamespace
        ? {
            apiUrl: applicationTypeKroString(
              'http://hatchet-api.',
              managedNamespace,
              '.svc:8080',
            ),
          }
        : {}),
  };
}

function applicationProviderSelectionValueExpression(value: unknown): string {
  const expression = applicationTypeKroExpressionValue(value);
  if (expression) return expression;
  if (value === undefined) {
    throw new Error(
      'Application provider selection must serialize absent branches with omit().',
    );
  }
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
    const secretName = policy.destination.credentialsSecret.name;
    if (
      !applicationTypeKroExpressionValue(secretName)
      && (
        typeof secretName !== 'string'
        || !secretName.trim()
      )
    ) {
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
  if (isApplicationEventLogProvider(value)) {
    // typecast: the provider kind discriminant narrows the supported JetStream EventLog provider.
    return value as ApplicationEventLogProvider;
  }
  if (
    isApplicationProviderBinding(value)
    && applicationProviderTokensMatch(value.token, EventLog)
  ) {
    return applicationEventLogImplementation(value.implementation);
  }
  const selection = applicationProviderSelectionFor<ApplicationEventLogProvider>(value);
  if (
    selection
    && [...Object.values(selection.cases), selection.default].every(
      isApplicationEventLogProvider,
    )
  ) return applicationSelectedEventLogProvider(selection);
  return undefined;
}

function isApplicationEventLogProvider(
  value: unknown,
): value is ApplicationEventLogProvider {
  return Boolean(
    value
    && typeof value === 'object'
    && ['nats-jetstream', 'kinesis'].includes(String(Reflect.get(value, 'kind'))),
  );
}

export function applicationObjectStorageImplementation(
  value: unknown,
): ApplicationObjectStorageProvider | undefined {
  if (isApplicationObjectStorageProvider(value)) return value;
  if (
    isApplicationProviderBinding(value)
    && applicationProviderTokensMatch(value.token, ObjectStorage)
  ) {
    return applicationObjectStorageImplementation(value.implementation);
  }
  const selection =
    applicationProviderSelectionFor<ApplicationObjectStorageProvider>(value);
  if (!selection) return undefined;
  const candidates = [...Object.values(selection.cases), selection.default];
  if (candidates.every(isApplicationS3ObjectStorageProvider)) {
    return applicationSelectedS3ObjectStorageProvider(
      selection as ApplicationProviderSelectionValue<ApplicationS3ObjectStorageProvider>,
    );
  }
  if (candidates.every(isApplicationConfigMapObjectStorageProvider)) {
    const configMapSelection =
      selection as ApplicationProviderSelectionValue<ApplicationKubernetesConfigMapObjectStorageProvider>;
    return {
      kind: 'kubernetes-configmap-objects',
      ...applicationSelectedField(configMapSelection, 'maxObjectBytes'),
    };
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
  if (tokenName === 'IndexStore' || tokenName === 'Search' || tokenName === 'TransactionalDatabase' || tokenName === 'AnalyticalDatabase' || tokenName === 'CounterStore' || tokenName === 'EventSource' || tokenName === 'EventLog' || tokenName === 'Secret' || tokenName === 'Queue' || tokenName === 'ObjectStorage' || tokenName === 'HttpExposure' || tokenName === 'Certificate' || tokenName === 'DnsPublication' || tokenName === 'CredentialStore' || tokenName === 'WorkflowEngine' || tokenName === 'JobRuntime' || tokenName === 'Scheduler' || tokenName === 'ActorRuntime' || tokenName === 'Observability' || tokenName === 'LakehouseDataset' || tokenName === 'LakehouseQuery' || tokenName === 'ApplicationHost' || tokenName === 'ContainerRegistry' || tokenName === 'IdentityProvider' || tokenName === 'OAuthAuthorizationServer' || tokenName === 'Authorization' || tokenName === 'StructuredGeneration') {
    return tokenName;
  }
  return undefined;
}

export function isApplicationIdentityProvider(value: unknown): value is ApplicationIdentityProvider {
  if (!value || typeof value !== 'object' || Reflect.get(value, 'kind') !== 'identity-provider' || typeof Reflect.get(value, 'authenticate') !== 'function') return false;
  if (Reflect.get(value, 'ready') !== undefined && typeof Reflect.get(value, 'ready') !== 'function') return false;
  if (Reflect.get(value, 'handle') !== undefined && typeof Reflect.get(value, 'handle') !== 'function') return false;
  const infrastructure = Reflect.get(value, 'infrastructure');
  if (infrastructure === undefined) return true;
  try {
    assertApplicationIdentityInfrastructure(infrastructure);
    return true;
  } catch {
    return false;
  }
}

export function isApplicationOAuthAuthorizationServerProvider(value: unknown): value is ApplicationOAuthAuthorizationServerProvider {
  const name = value && typeof value === 'object'
    ? Reflect.get(value, 'name')
    : undefined;
  if (!value || typeof value !== 'object' || Reflect.get(value, 'kind') !== 'oauth-authorization-server' || typeof name !== 'string' || !name.trim() || typeof Reflect.get(value, 'decide') !== 'function') return false;
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
    throw new Error('IdentityProvider infrastructure currently supports the released TypeKro Ory integration.');
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

function isApplicationS3ObjectStorageProvider(
  value: unknown,
): value is ApplicationS3ObjectStorageProvider {
  return Boolean(
    isApplicationObjectStorageProvider(value)
    && Reflect.get(value, 'kind') === 's3',
  );
}

function isApplicationConfigMapObjectStorageProvider(
  value: unknown,
): value is ApplicationKubernetesConfigMapObjectStorageProvider {
  return Boolean(
    isApplicationObjectStorageProvider(value)
    && Reflect.get(value, 'kind') === 'kubernetes-configmap-objects',
  );
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

export function isApplicationHostProvider(value: unknown): value is ApplicationHostProvider {
  return Boolean(
    value
    && typeof value === 'object'
    && ['managed-application-host', 'kubernetes-application-host'].includes(String(Reflect.get(value, 'kind'))),
  );
}

export function isApplicationContainerRegistryProvider(value: unknown): value is ApplicationContainerRegistryProvider {
  if (!value || typeof value !== 'object') return false;
  const kind = Reflect.get(value, 'kind');
  if (kind === 'orbstack-container-registry') return true;
  if (kind === 'ecr') {
    const account = Reflect.get(value, 'account');
    return Boolean(account && typeof account === 'object' && Reflect.get(account, 'kind') === 'aws-account');
  }
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
