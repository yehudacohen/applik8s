// typecast-file-boundary: normalized graph configuration is discriminator-checked before provider-specific direct-lifecycle preparation.
import type { ApplicationGraph } from '@applik8s/core';

import type { ApplicationClickHouseProjectionStoreProvider, ApplicationHatchetWorkflowEngineProvider, ApplicationIdentityInfrastructure, ApplicationPostgresClusterSpec, ApplicationPostgresModelStoreProvider, ApplicationS3ObjectStorageProvider, ApplicationValkeyIndexBackend } from './application-providers.js';
import { applicationPostgresClusterSpec } from './application-providers.js';
import type { ApplicationDirectNamespacePreparationReceipt } from './container-registry-preparation.js';

export interface ApplicationValkeyOperatorPreparationReceipt {
  readonly provider: 'valkey';
  readonly ownership: 'shared-managed' | 'external';
  readonly name: string;
  readonly namespace: string;
  readonly version?: string;
  readonly ready: true;
}

export interface ApplicationValkeyClusterPreparationReceipt {
  readonly provider: 'hyperspike-valkey';
  readonly ownership: 'managed' | 'external';
  readonly name: string;
  readonly namespace: string;
  readonly endpoint: string;
  readonly port: number;
  readonly topology: { readonly shards: number; readonly replicas: number };
  readonly storage?: { readonly size: string; readonly storageClassName?: string };
  readonly ready: true;
}

export interface ApplicationProviderPreparationReceipt {
  readonly apiVersion: 'applik8s.deployment/v1alpha1';
  readonly kind: 'ApplicationProviderPreparationReceipt';
  readonly valkey?: ApplicationValkeyOperatorPreparationReceipt;
  readonly valkeyCluster?: ApplicationValkeyClusterPreparationReceipt;
  readonly postgres?: ApplicationPostgresClusterPreparationReceipt;
  /** Shared operator namespace prepared before its singleton KRO owner can reconcile. */
  readonly clickhouseOperatorNamespace?: ApplicationDirectNamespacePreparationReceipt;
  readonly objectStorage?: ApplicationObjectStoragePreparationReceipt;
  readonly workflowAdmin?: ApplicationWorkflowAdminPreparationReceipt;
  readonly identity?: ApplicationIdentityPreparationReceipt;
}

export interface ApplicationIdentityPreparationReceipt {
  readonly provider: 'ory';
  readonly stack: 'identity' | 'platform';
  readonly ownership: 'managed' | 'external';
  readonly name: string;
  readonly namespace: string;
  readonly deletionPolicy: 'retain' | 'delete';
  /**
   * Durable namespace provenance. Ory resources are deployed at instance scope,
   * so an externally owned namespace is observed rather than adopted and an
   * Applik8s-created namespace can be removed separately through TypeKro.
   */
  readonly namespacePreparation?: ApplicationDirectNamespacePreparationReceipt;
  readonly ready: true;
}

export interface ApplicationPostgresClusterPreparationReceipt {
  readonly provider: 'cloudnative-pg';
  readonly ownership: 'managed' | 'external';
  readonly name: string;
  readonly namespace: string;
  readonly database: string;
  readonly deletionPolicy: 'delete' | 'retain';
  readonly ready: true;
}

export interface ApplicationWorkflowAdminPreparationReceipt {
  readonly provider: 'hatchet-admin';
  readonly ownership: 'managed' | 'external';
  readonly name: string;
  readonly namespace: string;
  /**
   * The provisioned Hatchet chart creates this conventional client Secret
   * from a Helm hook without an ownerReference. Record it explicitly so an
   * Application deletion can remove it after the HelmRelease is finalized,
   * including when the workload namespace is retained for durable data.
   */
  readonly managedWorkerTokenSecret?: {
    readonly name: 'hatchet-client-config';
    readonly namespace: string;
  };
  readonly ready: true;
}

export interface ApplicationObjectStoragePreparationReceipt {
  readonly provider: 'rook-obc';
  readonly ownership: 'managed' | 'external';
  readonly name: string;
  readonly namespace: string;
  readonly bucket: string;
  readonly storageClassName: string;
  /** Retained provider identities that still require this claim's credentials. */
  readonly retainedBy?: readonly string[];
  readonly ready: true;
}

export interface ApplicationProviderPreparationRuntime {
  ensureValkeyOperator(
    context: string,
    prerequisite: Required<Pick<ApplicationValkeyIndexBackend, 'kind'>> & {
      readonly name: string;
      readonly namespace: string;
      readonly version?: string;
    },
  ): Promise<ApplicationValkeyOperatorPreparationReceipt>;
  ensureValkeyCluster(
    context: string,
    prerequisite: {
      readonly name: string;
      readonly namespace: string;
      readonly spec: Readonly<Record<string, unknown>>;
      readonly topology: { readonly shards: number; readonly replicas: number };
      readonly storage?: { readonly size: string; readonly storageClassName?: string };
      readonly timeoutMs: number;
    },
  ): Promise<ApplicationValkeyClusterPreparationReceipt>;
  deleteValkeyCluster(context: string, receipt: ApplicationValkeyClusterPreparationReceipt): Promise<void>;
  ensurePostgresCluster(
    context: string,
    prerequisite: {
      readonly name: string;
      readonly namespace: string;
      readonly database: string;
      readonly spec: ApplicationPostgresClusterSpec;
      readonly deletionPolicy: 'delete' | 'retain';
      readonly timeoutMs: number;
    },
  ): Promise<ApplicationPostgresClusterPreparationReceipt>;
  deletePostgresCluster(context: string, receipt: ApplicationPostgresClusterPreparationReceipt): Promise<void>;
  ensureClickHouseOperatorNamespace(context: string, namespace: string): Promise<ApplicationDirectNamespacePreparationReceipt>;
  ensureObjectStorageClaim(
    context: string,
    prerequisite: {
      readonly name: string;
      readonly namespace: string;
      readonly bucket: string;
      readonly storageClassName: string;
      readonly timeoutMs: number;
    },
  ): Promise<ApplicationObjectStoragePreparationReceipt>;
  deleteObjectStorageClaim(context: string, receipt: ApplicationObjectStoragePreparationReceipt): Promise<void>;
  ensureWorkflowAdminCredentials(
    context: string,
    prerequisite: {
      readonly name: string;
      readonly namespace: string;
      readonly createIfMissing: boolean;
      readonly managedWorkerTokenSecret?: {
        readonly name: 'hatchet-client-config';
        readonly namespace: string;
      };
    },
  ): Promise<ApplicationWorkflowAdminPreparationReceipt>;
  deleteWorkflowAdminCredentials(context: string, receipt: ApplicationWorkflowAdminPreparationReceipt): Promise<void>;
  ensureIdentityInfrastructure?(
    context: string,
    prerequisite: ApplicationIdentityInfrastructure,
  ): Promise<ApplicationIdentityPreparationReceipt>;
  deleteIdentityInfrastructure?(context: string, receipt: ApplicationIdentityPreparationReceipt): Promise<void>;
}

/** Extract only concrete provider preparation from the normalized application graph. */
export function applicationValkeyIndexStoreFromGraph(graph: ApplicationGraph): ApplicationValkeyIndexBackend | undefined {
  const provider = graph.nodes.find((node) => node.kind === 'provider' && node.interface === 'IndexStore');
  if (provider?.kind !== 'provider') return undefined;
  const value = provider.config?.indexStore;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Reflect.get(value, 'kind') !== 'valkey') return undefined;
  return value as unknown as ApplicationValkeyIndexBackend;
}

export function applicationS3ObjectStorageFromGraph(graph: ApplicationGraph): ApplicationS3ObjectStorageProvider | undefined {
  const provider = graph.nodes.find((node) => node.kind === 'provider' && node.interface === 'ObjectStorage');
  if (provider?.kind !== 'provider') return undefined;
  const value = provider.config?.objectStorage;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Reflect.get(value, 'kind') !== 's3') return undefined;
  return value as unknown as ApplicationS3ObjectStorageProvider;
}

export function applicationPostgresModelStoreFromGraph(graph: ApplicationGraph): ApplicationPostgresModelStoreProvider | undefined {
  const provider = graph.nodes.find((node) => node.kind === 'provider' && node.interface === 'ModelStore');
  if (provider?.kind !== 'provider') return undefined;
  const value = provider.config?.modelStore;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Reflect.get(value, 'kind') !== 'postgres') return undefined;
  return value as unknown as ApplicationPostgresModelStoreProvider;
}

export function applicationHatchetWorkflowEngineFromGraph(graph: ApplicationGraph): ApplicationHatchetWorkflowEngineProvider | undefined {
  const provider = graph.nodes.find((node) => node.kind === 'provider' && node.interface === 'WorkflowEngine');
  if (provider?.kind !== 'provider') return undefined;
  const value = provider.config;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Reflect.get(value, 'kind') !== 'hatchet') return undefined;
  return value as unknown as ApplicationHatchetWorkflowEngineProvider;
}

export function applicationClickHouseProjectionStoreFromGraph(graph: ApplicationGraph): ApplicationClickHouseProjectionStoreProvider | undefined {
  const provider = graph.nodes.find((node) => node.kind === 'provider' && node.interface === 'ProjectionStore');
  if (provider?.kind !== 'provider' || provider.implementation !== 'clickhouse') return undefined;
  const config = provider.config;
  if (!config || typeof config !== 'object' || Array.isArray(config)) return undefined;
  const nested = Reflect.get(config, 'projectionStore');
  const value = nested && typeof nested === 'object' && !Array.isArray(nested) ? nested : config;
  if (Reflect.get(value, 'kind') !== 'clickhouse' && Reflect.get(value, 'provider') !== 'clickhouse') return undefined;
  return {
    kind: 'clickhouse',
    ...(typeof Reflect.get(value, 'enabled') === 'boolean' ? { enabled: Reflect.get(value, 'enabled') as boolean } : {}),
    ...(typeof Reflect.get(value, 'name') === 'string' ? { name: Reflect.get(value, 'name') as string } : {}),
    ...(typeof Reflect.get(value, 'namespace') === 'string' ? { namespace: Reflect.get(value, 'namespace') as string } : {}),
    ...(typeof Reflect.get(value, 'provision') === 'boolean' ? { provision: Reflect.get(value, 'provision') as boolean } : {}),
  };
}

export function applicationIdentityInfrastructureFromGraph(graph: ApplicationGraph): ApplicationIdentityInfrastructure | undefined {
  const provider = graph.nodes.find((node) => node.kind === 'provider' && node.interface === 'RequestIdentity');
  if (provider?.kind !== 'provider') return undefined;
  const value = provider.config?.identityInfrastructure;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Reflect.get(value, 'kind') !== 'ory') return undefined;
  return value as unknown as ApplicationIdentityInfrastructure;
}

export async function prepareApplicationProviderPrerequisites(
  graph: ApplicationGraph,
  context: string,
  runtime: ApplicationProviderPreparationRuntime,
): Promise<ApplicationProviderPreparationReceipt> {
  const valkey = applicationValkeyIndexStoreFromGraph(graph);
  const operator = valkey
    && valkey.provision !== false
    && valkey.provisioner === 'hyperspike'
    && valkey.operator?.provision !== false
    ? await runtime.ensureValkeyOperator(context, {
        kind: 'valkey',
        name: valkey.operator?.name ?? 'applik8s-valkey-operator',
        namespace: valkey.operator?.namespace ?? 'valkey-operator-system',
        ...(valkey.operator?.version ? { version: valkey.operator.version } : {}),
      })
    : undefined;
  const valkeyCluster = valkey
    && valkey.provision !== false
    && valkey.provisioner === 'hyperspike'
    ? await runtime.ensureValkeyCluster(context, applicationValkeyClusterPrerequisite(graph, valkey))
    : undefined;
  const postgres = applicationPostgresModelStoreFromGraph(graph);
  const postgresCluster = postgres?.ownership === 'direct-provisioned'
    ? await runtime.ensurePostgresCluster(context, applicationPostgresClusterPrerequisite(graph, postgres))
    : undefined;
  const objectStorage = applicationS3ObjectStorageFromGraph(graph);
  const preparedObjectStorage = objectStorage?.enabled !== false
    && objectStorage?.provisioning?.enabled !== false
    && objectStorage?.ownership === 'direct-provisioned'
    ? await prepareDirectObjectStorage(objectStorage, context, runtime)
    : undefined;
  const retainedObjectStorageDependents = preparedObjectStorage
    && postgresCluster?.ownership === 'managed'
    && postgresCluster.deletionPolicy === 'retain'
    && postgres?.backup?.destination.kind === 's3'
    && sameResourceReference(postgres.backup.destination.credentialsSecret, objectStorage?.credentialsSecret)
    ? [`postgres:${postgresCluster.namespace}/${postgresCluster.name}`]
    : [];
  const objectStorageReceipt = preparedObjectStorage
    ? {
        ...preparedObjectStorage,
        ...(retainedObjectStorageDependents.length > 0 ? { retainedBy: retainedObjectStorageDependents } : {}),
      }
    : undefined;
  const workflowEngine = applicationHatchetWorkflowEngineFromGraph(graph);
  const workflowAdmin = workflowEngine && workflowEngine.enabled !== false && workflowEngine.provision !== false
    ? await prepareHatchetAdminCredentials(graph, workflowEngine, context, runtime)
    : undefined;
  const clickhouse = applicationClickHouseProjectionStoreFromGraph(graph);
  // The shared ClickHouse singleton intentionally leaves its control-plane
  // Namespace outside the owner RGD. Materialize that persistent prerequisite
  // before KRO attempts to create the namespaced HelmRelease.
  const clickhouseOperatorNamespace = clickhouse?.enabled !== false && clickhouse?.provision !== false
    ? await runtime.ensureClickHouseOperatorNamespace(context, 'clickhouse-system')
    : undefined;
  const identity = applicationIdentityInfrastructureFromGraph(graph);
  const identityReceipt = identity !== undefined && identity.provision !== false
    ? await requiredIdentityPreparationRuntime(runtime).ensureIdentityInfrastructure(context, identity)
    : undefined;
  return {
    apiVersion: 'applik8s.deployment/v1alpha1',
    kind: 'ApplicationProviderPreparationReceipt',
    ...(operator ? { valkey: operator } : {}),
    ...(valkeyCluster ? { valkeyCluster } : {}),
    ...(postgresCluster ? { postgres: postgresCluster } : {}),
    ...(clickhouseOperatorNamespace ? { clickhouseOperatorNamespace } : {}),
    ...(objectStorageReceipt ? { objectStorage: objectStorageReceipt } : {}),
    ...(workflowAdmin ? { workflowAdmin } : {}),
    ...(identityReceipt ? { identity: identityReceipt } : {}),
  };
}

async function prepareHatchetAdminCredentials(
  graph: ApplicationGraph,
  provider: ApplicationHatchetWorkflowEngineProvider,
  context: string,
  runtime: ApplicationProviderPreparationRuntime,
): Promise<ApplicationWorkflowAdminPreparationReceipt> {
  const explicit = provider.adminCredentialsSecret ?? provider.credentialsSecret;
  if (explicit && (explicit.kind !== 'Secret' || !explicit.name?.trim())) {
    throw new Error('Hatchet WorkflowEngine adminCredentialsSecret must reference a named Kubernetes Secret.');
  }
  const namespace = provider.namespace ?? explicit?.namespace ?? graph.metadata.namespace ?? 'default';
  if (explicit?.namespace && explicit.namespace !== namespace) {
    throw new Error(`Hatchet WorkflowEngine admin credentials Secret ${explicit.namespace}/${explicit.name} must be in provider namespace ${namespace}.`);
  }
  const name = explicit?.name ?? `${provider.name ?? 'applik8s-hatchet'}-admin`;
  const workerTokenSecret = provider.workerTokenSecret ?? provider.credentialsSecret;
  const workerTokenName = workerTokenSecret?.name ?? 'hatchet-client-config';
  const managedWorkerTokenSecret = workerTokenName === 'hatchet-client-config'
    ? { name: 'hatchet-client-config' as const, namespace }
    : undefined;
  return runtime.ensureWorkflowAdminCredentials(context, {
    name,
    namespace,
    createIfMissing: explicit === undefined,
    ...(managedWorkerTokenSecret ? { managedWorkerTokenSecret } : {}),
  });
}

async function prepareDirectObjectStorage(
  provider: ApplicationS3ObjectStorageProvider,
  context: string,
  runtime: ApplicationProviderPreparationRuntime,
): Promise<ApplicationObjectStoragePreparationReceipt> {
  const secret = provider.credentialsSecret;
  const provisioning = provider.provisioning;
  if (!secret?.namespace || !provisioning) {
    throw new Error('Direct-provisioned S3 ObjectStorage requires a namespace-scoped credentials Secret and provisioning contract.');
  }
  const name = provisioning.claimName ?? provider.name ?? secret.name ?? provider.bucket;
  if (!name || secret.name !== name) {
    throw new Error('Direct-provisioned S3 ObjectStorage credentials Secret name must match provisioning.claimName.');
  }
  return runtime.ensureObjectStorageClaim(context, {
    name,
    namespace: secret.namespace,
    bucket: provider.bucket,
    storageClassName: provisioning.storageClassName,
    timeoutMs: provisioning.timeoutMs ?? 300_000,
  });
}

/** Delete only app-owned direct provider preparation after KRO finalization. */
export async function deleteApplicationProviderPrerequisites(
  receipt: ApplicationProviderPreparationReceipt,
  context: string,
  runtime: ApplicationProviderPreparationRuntime,
): Promise<void> {
  if (receipt.valkeyCluster?.ownership === 'managed') {
    await runtime.deleteValkeyCluster(context, receipt.valkeyCluster);
  }
  if (receipt.postgres?.ownership === 'managed' && receipt.postgres.deletionPolicy === 'delete') {
    await runtime.deletePostgresCluster(context, receipt.postgres);
  }
  if (receipt.workflowAdmin) {
    await runtime.deleteWorkflowAdminCredentials(context, receipt.workflowAdmin);
  }
  const objectStorageSupportsRetainedPostgres = receipt.objectStorage?.retainedBy?.length
    || (receipt.postgres?.ownership === 'managed'
      && receipt.postgres.deletionPolicy === 'retain'
      && receipt.objectStorage?.namespace === receipt.postgres.namespace);
  if (receipt.objectStorage?.ownership === 'managed' && !objectStorageSupportsRetainedPostgres) {
    await runtime.deleteObjectStorageClaim(context, receipt.objectStorage);
  }
  if (receipt.identity?.ownership === 'managed' && receipt.identity.deletionPolicy === 'delete') {
    await requiredIdentityPreparationRuntime(runtime).deleteIdentityInfrastructure(context, receipt.identity);
  }
}

function sameResourceReference(
  left: { readonly apiVersion?: string; readonly kind: string; readonly name?: string; readonly namespace?: string } | undefined,
  right: { readonly apiVersion?: string; readonly kind: string; readonly name?: string; readonly namespace?: string } | undefined,
): boolean {
  if (!left?.name || !right?.name) return false;
  return left.kind === right.kind
    && left.name === right.name
    && left.namespace === right.namespace
    && (left.apiVersion ?? 'v1') === (right.apiVersion ?? 'v1');
}

/**
 * Namespaces containing retained, directly provisioned provider state must
 * outlive Application cleanup. Other preparation receipts may have created
 * the same Namespace for transient credentials or workloads, so the CLI uses
 * this set to coordinate their teardown without weakening provider ownership.
 */
export function retainedApplicationProviderNamespaces(
  receipt: ApplicationProviderPreparationReceipt | undefined,
): readonly string[] {
  if (!receipt) return [];
  const namespaces = new Set<string>();
  if (receipt.postgres?.ownership === 'managed' && receipt.postgres.deletionPolicy === 'retain') {
    namespaces.add(receipt.postgres.namespace);
  }
  if (receipt.identity?.ownership === 'managed' && receipt.identity.deletionPolicy === 'retain') {
    namespaces.add(receipt.identity.namespace);
  }
  return [...namespaces].sort();
}

function requiredIdentityPreparationRuntime(runtime: ApplicationProviderPreparationRuntime): Required<Pick<ApplicationProviderPreparationRuntime, 'ensureIdentityInfrastructure' | 'deleteIdentityInfrastructure'>> {
  if (!runtime.ensureIdentityInfrastructure || !runtime.deleteIdentityInfrastructure) {
    throw new Error('This deployment runtime does not support declared identity infrastructure preparation.');
  }
  return {
    ensureIdentityInfrastructure: runtime.ensureIdentityInfrastructure,
    deleteIdentityInfrastructure: runtime.deleteIdentityInfrastructure,
  };
}

function applicationPostgresClusterPrerequisite(
  graph: ApplicationGraph,
  provider: ApplicationPostgresModelStoreProvider,
): {
  readonly name: string;
  readonly namespace: string;
  readonly database: string;
  readonly spec: ApplicationPostgresClusterSpec;
  readonly deletionPolicy: 'delete' | 'retain';
  readonly timeoutMs: number;
} {
  if (provider.provision === false || provider.cluster) {
    throw new Error('Direct-provisioned Postgres cannot disable provisioning or reference an external cluster.');
  }
  if (!provider.lifecycle) {
    throw new Error('Direct-provisioned Postgres requires an explicit lifecycle.deletionPolicy.');
  }
  const name = provider.name ?? `${graph.metadata.name}-db`;
  const namespace = provider.namespace ?? graph.metadata.namespace ?? 'default';
  const database = provider.database ?? graph.metadata.name;
  return {
    name,
    namespace,
    database,
    spec: applicationPostgresClusterSpec(provider, database),
    deletionPolicy: provider.lifecycle.deletionPolicy,
    timeoutMs: provider.lifecycle.preparationTimeoutMs ?? 10 * 60_000,
  };
}

function applicationValkeyClusterPrerequisite(
  graph: ApplicationGraph,
  provider: ApplicationValkeyIndexBackend,
): {
  readonly name: string;
  readonly namespace: string;
  readonly spec: Readonly<Record<string, unknown>>;
  readonly topology: { readonly shards: number; readonly replicas: number };
  readonly storage?: { readonly size: string; readonly storageClassName?: string };
  readonly timeoutMs: number;
} {
  const name = provider.name ?? `${graph.metadata.name}-index`;
  const namespace = provider.namespace ?? graph.metadata.namespace ?? 'default';
  const topology = {
    shards: provider.topology?.shards ?? 1,
    replicas: provider.topology?.replicas ?? 0,
  };
  const authentication = provider.authentication ?? { mode: 'anonymous' as const };
  const storage = provider.storage;
  if (!Number.isInteger(topology.shards) || topology.shards < 1 || topology.shards > 100) {
    throw new Error('Hyperspike Valkey topology.shards must be an integer between 1 and 100.');
  }
  if (!Number.isInteger(topology.replicas) || topology.replicas < 0 || topology.replicas > 10) {
    throw new Error('Hyperspike Valkey topology.replicas must be an integer between 0 and 10.');
  }
  if (authentication.mode === 'password' && !authentication.secret) {
    throw new Error('Hyperspike Valkey password authentication requires a Secret reference.');
  }
  if (authentication.mode === 'password' && authentication.secret?.namespace && authentication.secret.namespace !== namespace) {
    throw new Error(`Hyperspike Valkey password Secret ${authentication.secret.namespace}/${authentication.secret.name} must be in provider namespace ${namespace}.`);
  }
  const reserved = ['shards', 'nodes', 'replicas', 'anonymousAuth', 'servicePassword', 'storage', 'resources']
    .filter((field) => provider.spec && Object.hasOwn(provider.spec, field));
  if (reserved.length > 0) {
    throw new Error(`Hyperspike Valkey spec cannot override typed provider fields: ${reserved.join(', ')}.`);
  }
  const spec = {
    shards: topology.shards,
    replicas: topology.replicas,
    anonymousAuth: authentication.mode === 'anonymous',
    ...(authentication.mode === 'password' && authentication.secret
      ? { servicePassword: { name: authentication.secret.name, key: authentication.key ?? 'password' } }
      : {}),
    ...(storage
      ? {
          storage: {
            spec: {
              resources: { requests: { storage: storage.size } },
              accessModes: ['ReadWriteOnce'],
              ...(storage.storageClassName ? { storageClassName: storage.storageClassName } : {}),
            },
          },
        }
      : {}),
    ...(provider.resources ? { resources: provider.resources } : {}),
    ...(provider.spec ?? {}),
  };
  return {
    name,
    namespace,
    spec,
    topology,
    ...(storage ? { storage } : {}),
    timeoutMs: 5 * 60_000,
  };
}
