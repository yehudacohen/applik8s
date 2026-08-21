// typecast-file-boundary: inactive external profile branches are validated before graph materialization.
import {
  type ApplicationAnalyticalDatabaseProvider,
  AnalyticalDatabase,
  Analytics,
  ContainerRegistry,
  defaultApplicationEventLogProvider,
  EventLog,
  IndexStore,
  ObjectStorage,
  StructuredGeneration,
  TransactionalDatabase,
  WorkflowEngine,
} from '@applik8s/applik8s';
import {
  externalInfrastructureProviders,
  type ExternalProviderInputs,
} from './providers/external';
import {
  app,
  capacity,
  mediaBucket,
  namespace,
} from './installation';
import {
  localAnalyticalDatabase,
  localContainerRegistry,
  localObjectStorage,
  localWorkflowEngine,
} from './providers/local';

const deployment = app.profile(
  app.installation.spec,
  'profile',
);

export const PrimaryDatabase = TransactionalDatabase.named('primary');
const PrimaryAnalytics = AnalyticalDatabase.named('primary');
const PrimaryEvents = EventLog.named('primary');
const MediaObjects = ObjectStorage.named('media');
const DurableWorkflows = WorkflowEngine.named('durable');
const GeneratedContent = StructuredGeneration.named('content');
const ApplicationImages = ContainerRegistry.named('images');
const OnlineIndex = IndexStore.named('online');

function externalProviders(spec: {
  readonly providers: ExternalProviderInputs;
}) {
  return externalInfrastructureProviders(namespace, spec.providers);
}

function managedDatabase() {
  return TransactionalDatabase.postgres({
    name: 'chirp',
    clusterName: 'chirp-models',
    namespace,
    database: 'chirp',
    ownership: 'direct-provisioned',
    lifecycle: {
      deletionPolicy: app.installation.spec.lifecycle.databaseDeletion,
    },
    instances: capacity.postgresInstances,
    storage: {
      size: capacity.postgresStorage,
      storageClassName: capacity.postgresStorageClass,
    },
    backup: {
      enabled: app.installation.spec.backup.enabled,
      schedule: app.installation.spec.backup.schedule,
      retentionPolicy: app.installation.spec.backup.retentionPolicy,
      immediate: true,
      destination: ObjectStorage.backup(objectStorageProvider, {
        prefix: 'database-backups',
      }),
    },
  });
}

function managedEvents() {
  return {
    ...defaultApplicationEventLogProvider,
    namespace,
    replicas: capacity.eventLogReplicas,
    storageSize: capacity.eventLogStorage,
    storageClassName: capacity.eventLogStorageClass,
  };
}

function managedObjects() {
  return localObjectStorage(namespace, mediaBucket, true, true);
}

function managedWorkflows() {
  return localWorkflowEngine(namespace, capacity, true);
}

function managedAnalytics() {
  return localAnalyticalDatabase(
    namespace,
    capacity,
    app.installation.spec.features.analytics,
    {
      endpoint: app.interpolate`http://clickhouse-chirp-analytics.${namespace}.svc.cluster.local:8123`,
      database: 'chirp',
    },
  );
}

function managedIndex() {
  return IndexStore.valkey({
    provisioner: 'hyperspike',
    name: 'chirp-online-index',
    namespace,
    host: app.interpolate`chirp-online-index.${namespace}.svc.cluster.local`,
    port: 6379,
    provision: true,
    operator: {
      provision: true,
      name: 'applik8s-valkey-operator',
      namespace: 'valkey-operator-system',
    },
    topology: {
      shards: capacity.indexShards,
      replicas: capacity.indexReplicas,
    },
    storage: {
      size: capacity.indexStorage,
      storageClassName: capacity.indexStorageClass,
    },
    authentication: { mode: 'anonymous' },
    resources: {
      requests: { cpu: '100m', memory: '128Mi' },
      limits: { cpu: '1', memory: '512Mi' },
    },
  });
}

function externalGeneration(inputs: ExternalProviderInputs['generation']) {
  return StructuredGeneration.http({
    endpoint: inputs.endpoint,
    credentialSecret: {
      apiVersion: 'v1',
      kind: 'Secret',
      namespace,
      name: inputs.credentialsSecretName,
    },
    credentialKey: inputs.credentialKey,
    authorization: inputs.authorization,
    defaultProfile: inputs.defaultProfile,
  });
}

deployment
  .provide(MediaObjects)
  .starter(() => managedObjects())
  .dedicated(() => managedObjects())
  .external((spec) => {
    const external = externalProviders(spec);
    return localObjectStorage(
      namespace,
      external.objects.bucket,
      true,
      false,
      {
        endpoint: external.objects.endpoint,
        prefix: external.objects.prefix,
        region: external.objects.region,
        credentialsSecretName: external.objects.credentialsSecretName,
        forcePathStyle: external.objects.forcePathStyle,
        ownership: 'external',
      },
    );
  })
  .exhaustive();

export const objectStorageProvider = app.inject(MediaObjects);

deployment
  .provide(PrimaryDatabase)
  .starter(() => managedDatabase())
  .dedicated(() => managedDatabase())
  .external((spec) => {
    const external = externalProviders(spec);
    return TransactionalDatabase.postgres({
      name: 'chirp',
      clusterName: 'chirp-models',
      namespace,
      database: external.database.database,
      connectionSecret: {
        apiVersion: 'v1',
        kind: 'Secret',
        name: external.database.connectionSecretName,
        namespace,
      },
      connectionSecretKey: external.database.connectionSecretKey,
      ownership: 'external',
      provision: false,
      lifecycle: {
        deletionPolicy: app.installation.spec.lifecycle.databaseDeletion,
      },
    });
  })
  .exhaustive();

export const databaseProvider = app.inject(PrimaryDatabase);

function targetAnalytics(clickHouse: ReturnType<typeof AnalyticalDatabase.clickhouse>) {
  return app.selectTarget<ApplicationAnalyticalDatabaseProvider>({
    local: () => clickHouse,
    awsLocal: () => Analytics.postgres({ database: databaseProvider, schema: 'analytics' }),
    aws: () => Analytics.postgres({ database: databaseProvider, schema: 'analytics' }),
    kubernetes: () => clickHouse,
  });
}

deployment
  .provide(PrimaryAnalytics)
  .starter(() => targetAnalytics(managedAnalytics()))
  .dedicated(() => targetAnalytics(managedAnalytics()))
  .external((spec) => {
    const external = externalProviders(spec);
    return targetAnalytics(AnalyticalDatabase.clickhouse({
      enabled: app.installation.spec.features.analytics,
      name: 'chirp-analytics',
      namespace,
      provision: false,
      endpoint: external.analytics.endpoint,
      database: external.analytics.database,
      credentialsSecret: {
        apiVersion: 'v1',
        kind: 'Secret',
        name: external.analytics.credentialsSecretName,
        namespace,
      },
    }));
  })
  .exhaustive();

deployment
  .provide(PrimaryEvents)
  .starter(() => managedEvents())
  .dedicated(() => managedEvents())
  .external((spec) => {
    const external = externalProviders(spec);
    return {
      kind: 'nats-jetstream' as const,
      name: external.events.stream ?? 'chirp-events',
      namespace,
      provision: false,
      servers: [external.events.server],
      ...(external.events.stream ? { stream: external.events.stream } : {}),
      ...(external.events.subjectPrefix
        ? { subjectPrefix: external.events.subjectPrefix }
        : {}),
      ...(external.events.connectionSecretName
        ? {
            connectionSecret: {
              apiVersion: 'v1' as const,
              kind: 'Secret' as const,
              name: external.events.connectionSecretName,
              namespace,
            },
          }
        : {}),
    };
  })
  .exhaustive();

deployment
  .provide(DurableWorkflows)
  .starter(() => managedWorkflows())
  .dedicated(() => managedWorkflows())
  .external((spec) => {
    const external = externalProviders(spec);
    return localWorkflowEngine(namespace, capacity, true, {
      provision: false,
      hostPort: external.workflows.hostPort,
      apiUrl: external.workflows.apiUrl,
      workerTokenSecretName: external.workflows.workerTokenSecretName,
      tls: external.workflows.tls,
    });
  })
  .exhaustive();

deployment
  .provide(GeneratedContent)
  .starter(() =>
    StructuredGeneration.deterministic({
      output: {
        body: 'Automated Chirp status: review the local runbook at http://status.local before publishing.',
      },
      inputUnits: 32,
      outputUnits: 12,
    }),
  )
  .dedicated((spec) => externalGeneration(spec.providers.generation))
  .external((spec) => externalGeneration(spec.providers.generation))
  .exhaustive();

deployment
  .provide(ApplicationImages)
  .starter(() =>
    localContainerRegistry(namespace, app.installation.spec.lifecycle),
  )
  .dedicated(() =>
    localContainerRegistry(namespace, app.installation.spec.lifecycle),
  )
  .external((spec) => externalProviders(spec).registry)
  .exhaustive();

deployment
  .provide(OnlineIndex)
  .starter(() => managedIndex())
  .dedicated(() => managedIndex())
  .external((spec) => {
    const external = externalProviders(spec);
    return IndexStore.valkey({
      provisioner: 'hyperspike',
      name: 'chirp-online-index',
      namespace,
      host: external.index.host,
      port: external.index.port,
      provision: false,
      authentication: {
        mode: 'password',
        secret: {
          apiVersion: 'v1',
          kind: 'Secret',
          namespace,
          name: external.index.passwordSecretName,
        },
        key: external.index.passwordSecretKey,
      },
      resources: {
        requests: { cpu: '100m', memory: '128Mi' },
        limits: { cpu: '1', memory: '512Mi' },
      },
    });
  })
  .exhaustive();

const analytics = app.inject(PrimaryAnalytics);
const eventLog = app.inject(PrimaryEvents);
const workflows = app.inject(DurableWorkflows);
const generation = app.inject(GeneratedContent);
const registry = app.inject(ApplicationImages);
const index = app.inject(OnlineIndex);

app.defaults({
  analytics,
  eventLog,
  objects: objectStorageProvider,
});
app.provide(WorkflowEngine, workflows);
app.provide(StructuredGeneration, generation);
app.provide(ContainerRegistry, registry);
app.provide(IndexStore, index);
