import { AnalyticalDatabase, ContainerRegistry, ObjectStorage, WorkflowEngine } from '@applik8s/applik8s';

interface LocalCapacity {
  readonly workflowDatabaseInstances: number;
  readonly workflowDatabaseStorage: string;
  readonly workflowDatabaseStorageClass: string;
  readonly workflowReplicas: number;
  readonly analyticsStorage: string;
  readonly analyticsStorageClass: string;
}

/**
 * The local flagship profile publishes all authored workloads to the shared OrbStack Harbor
 * platform. Only Secret coordinates enter the graph; TypeKro reconciles project robots before
 * image builds and the application namespace receives pull credentials only.
 */
export function localContainerRegistry(
  namespace: string,
  lifecycle: { readonly registryProjectDeletion: 'retain' | 'delete'; readonly purgeRegistryRepositories: boolean },
) {
  return ContainerRegistry.harbor({
    endpoint: ContainerRegistry.nodePort({
      namespace: 'typekro-harbor-registry',
      service: 'harbor',
      port: 32_080,
      protocol: 'http',
      pullHost: '127.0.0.1',
    }),
    // Harbor projects are cluster-global. Deriving the project from the
    // concrete installation name keeps bounded installations isolated while
    // the Alchemy Harbor resource resolves the typed output for OCI publication.
    project: namespace,
    management: {
      adminCredentials: {
        apiVersion: 'v1',
        kind: 'Secret',
        name: 'typekro-harbor-admin',
        namespace: 'typekro-harbor-registry',
        username: 'admin',
        passwordKey: 'HARBOR_ADMIN_PASSWORD',
      },
      secretNamespace: namespace,
      pushRobotName: 'chirp-builder',
      pullRobotName: namespace,
      pushSecretName: 'chirp-registry-push',
      pullSecretName: 'chirp-registry-pull',
      autoScan: true,
      autoSbomGeneration: true,
      immutableTags: { tagPattern: 'sha-*' },
      retention: { keepMostRecent: 50 },
      projectLifecycle: {
        deletionPolicy: lifecycle.registryProjectDeletion,
        purgeRepositories: lifecycle.purgeRegistryRepositories,
      },
    },
    tls: { plainHttp: true },
  });
}

export function localObjectStorage(
  namespace: string,
  bucket: string,
  enabled: boolean,
  provision = true,
  connection: {
    readonly endpoint?: string;
    readonly prefix?: string;
    readonly region?: string;
    readonly credentialsSecretName?: string;
    readonly forcePathStyle?: boolean;
    readonly ownership?: 'external' | 'direct-provisioned';
  } = {},
) {
  const ownership = connection.ownership ?? 'direct-provisioned';
  return ObjectStorage.s3({
    enabled,
    name: 'chirp-media',
    bucket,
    prefix: connection.prefix ?? 'site',
    region: connection.region ?? 'us-east-1',
    // This endpoint belongs to the local provider integration, not the
    // application domain. Every consumer—including database backup—receives
    // it from this one qualified ObjectStorage binding. External profiles
    // replace it through their own provider connection.
    endpoint:
      connection.endpoint
      ?? 'http://rook-ceph-rgw-applik8s-object-store.applik8s-rook-ceph.svc:80',
    forcePathStyle: connection.forcePathStyle ?? true,
    credentialsSecret: { apiVersion: 'v1', kind: 'Secret', name: connection.credentialsSecretName ?? 'chirp-media', namespace },
    ownership,
    ...(ownership === 'direct-provisioned'
      ? {
          provisioning: {
            enabled: provision,
            claimName: 'chirp-media',
            storageClassName: 'typekro-harbor-bucket-retain',
            // typecast: the conditional object would otherwise widen this lifecycle literal.
            claimLifecycle: 'application' as const,
            timeoutMs: 300_000,
          },
        }
      : {}),
  });
}

export function localWorkflowEngine(namespace: string, capacity: LocalCapacity, enabled: boolean, connection: {
  readonly provision?: boolean;
  readonly hostPort?: string;
  readonly apiUrl?: string;
  readonly workerTokenSecretName?: string;
  readonly tls?: boolean;
} = {}) {
  return WorkflowEngine.hatchet({
    enabled,
    name: 'chirp-workflows',
    namespace,
    ...(connection.provision === undefined ? {} : { provision: connection.provision }),
    dashboard: 'disabled',
    database: {
      clusterName: 'chirp-workflows-db',
      database: 'hatchet',
      instances: capacity.workflowDatabaseInstances,
      storageSize: capacity.workflowDatabaseStorage,
      storageClass: capacity.workflowDatabaseStorageClass,
    },
    ...(connection.hostPort === undefined ? {} : { hostPort: connection.hostPort }),
    ...(connection.apiUrl === undefined ? {} : { apiUrl: connection.apiUrl }),
    ...(connection.tls === undefined ? {} : { tls: connection.tls }),
    ...(connection.workerTokenSecretName === undefined ? {} : {
      workerTokenSecret: { apiVersion: 'v1', kind: 'Secret', name: connection.workerTokenSecretName, namespace },
    }),
    worker: { replicas: capacity.workflowReplicas, taskSlots: 8, durableSlots: 16, gracefulShutdownSeconds: 45, scaling: { mode: 'fixed' } },
  });
}

export function localAnalyticalDatabase(namespace: string, capacity: LocalCapacity, enabled: boolean, connection: {
  readonly provision?: boolean;
  readonly endpoint?: string;
  readonly database?: string;
  readonly credentialsSecretName?: string;
} = {}) {
  return AnalyticalDatabase.clickhouse({
    enabled,
    name: 'chirp-analytics',
    namespace,
    ...(connection.provision === undefined ? {} : { provision: connection.provision }),
    ...(connection.endpoint === undefined ? {} : { endpoint: connection.endpoint }),
    database: connection.database ?? 'chirp',
    ...(connection.credentialsSecretName === undefined ? {} : {
      credentialsSecret: { apiVersion: 'v1', kind: 'Secret', name: connection.credentialsSecretName, namespace },
    }),
    storageSize: capacity.analyticsStorage,
    storageClassName: capacity.analyticsStorageClass,
  });
}
