// typecast-file-boundary: inactive external profile branches are validated before graph materialization.
import {
  type ApplicationAnalyticalDatabaseProvider,
  Analytics,
  AnalyticalDatabase,
  ApplicationHost,
  AWS,
  Certificate,
  ContainerRegistry,
  Database,
  DnsPublication,
  EventLog,
  FiniteExecutionHost,
  HttpExposure,
  IndexStore,
  JobResultStore,
  JobRuntime,
  KubernetesCluster,
  Lakehouse,
  LakehouseDataset,
  LakehouseQuery,
  ManagedModelStore,
  ObjectStorage,
  OperatorRuntime,
  Queue,
  Scheduler,
  StructuredGeneration,
  TransactionalDatabase,
  WorkflowEngine,
  config,
  secret,
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
export const HistoricalEngagementDataset = LakehouseDataset.named('historical-engagement');
export const HistoricalEngagementQueries = LakehouseQuery.named('historical-engagement');

// Domain code captures the inert qualified handles. Profile assembly above
// supplies their concrete implementations; application callbacks never
// receive or inspect provider configuration.
export const historicalEngagementDataset = HistoricalEngagementDataset;
export const historicalEngagementQueries = HistoricalEngagementQueries;

function externalProviders(spec: {
  readonly providers: ExternalProviderInputs;
}) {
  return externalInfrastructureProviders(namespace, spec.providers);
}

function managedDatabase() {
  return Database.postgres({
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
  return EventLog.jetStream({
    namespace,
    replicas: capacity.eventLogReplicas,
    storageSize: capacity.eventLogStorage,
    storageClassName: capacity.eventLogStorageClass,
  });
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

app
  .provide(HistoricalEngagementDataset)
  .local(() => Lakehouse.duckdbDataset({
    root: '.applik8s/state/lakehouse/historical-engagement',
    schemaRevision: 'v1',
    retainedSnapshots: 256,
  }))
  .awsLocal(() => Lakehouse.s3Dataset({
    bucket: 'managed',
    prefix: 'lakehouse/historical-engagement',
    region: config.env('AWS_REGION'),
    catalog: 'chirp_historical_engagement',
    schemaRevision: 'v1',
    retainedSnapshots: 256,
    forceDeleteUnretainedData: true,
  }))
  .aws(() => Lakehouse.s3Dataset({
    bucket: 'managed',
    prefix: 'lakehouse/historical-engagement',
    region: config.env('AWS_REGION'),
    catalog: 'chirp_historical_engagement',
    schemaRevision: 'v1',
    retainedSnapshots: 256,
    forceDeleteUnretainedData: true,
  }))
  .kubernetes(() => Lakehouse.objectStorageDataset({
    storage: objectStorageProvider,
    prefix: 'lakehouse/historical-engagement',
    schemaRevision: 'v1',
    retainedSnapshots: 256,
  }));

app
  .provide(HistoricalEngagementQueries)
  .local(() => Lakehouse.duckdbQueries({
    maximumConcurrentQueries: 4,
    maximumRows: 1_000,
    maximumScannedBytes: 64 * 1024 * 1024,
  }))
  .awsLocal(() => Lakehouse.athenaQueries({
    workgroup: 'managed',
    region: config.env('AWS_REGION'),
    resultLocation: 'managed',
    maximumConcurrentQueries: 8,
    maximumRows: 1_000,
    maximumScannedBytes: 10_000_000_000,
  }))
  .aws(() => Lakehouse.athenaQueries({
    workgroup: 'managed',
    region: config.env('AWS_REGION'),
    resultLocation: 'managed',
    maximumConcurrentQueries: 8,
    maximumRows: 1_000,
    maximumScannedBytes: 10_000_000_000,
  }))
  .kubernetes(() => Lakehouse.objectStorageQueries({
    maximumConcurrentQueries: 8,
    maximumRows: 1_000,
    maximumScannedBytes: 10_000_000_000,
  }));

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

/**
 * Target-free production assemblies. The domain modules above retain one
 * semantic graph; these profiles select inspectable physical implementations
 * without teaching domain code about AWS or Kubernetes.
 */
export const productionKubernetesProfile = app.profile(
  'production-kubernetes',
  (profile) => {
    // The workload namespace is part of the authored installation contract,
    // not a second ambient deployment input. Keeping one authority prevents a
    // manifest and the deployment environment from selecting different
    // Kubernetes identities for the same installation.
    const profileNamespace = namespace;
    const profileMediaBucket = mediaBucket;
    const cluster = KubernetesCluster.current({ namespace: profileNamespace });
    const database = Database.postgres({
      name: 'chirp',
      database: 'chirp',
      namespace: profileNamespace,
      ownership: 'direct-provisioned',
      lifecycle: {
        deletionPolicy: app.installation.spec.lifecycle.databaseDeletion,
      },
      storage: { size: '100Gi' },
    });
    const events = EventLog.jetStream({
      name: 'chirp-events',
      namespace: profileNamespace,
      replicas: 3,
      storageSize: '50Gi',
      pvcRetentionPolicy: 'retain',
    });
    const queue = Queue.jetStream({ eventLog: events });
    const scheduler = Scheduler.postgres({ database });
    const results = JobResultStore.postgres({ database });
    const registry = localContainerRegistry(profileNamespace, {
      registryProjectDeletion:
        app.installation.spec.lifecycle.registryProjectDeletion,
      purgeRegistryRepositories:
        app.installation.spec.lifecycle.purgeRegistryRepositories,
    });
    const jobHost = FiniteExecutionHost.kubernetes({ cluster, registry });
    const host = ApplicationHost.kubernetes({
      cluster,
      registry,
      namespace: profileNamespace,
      name: 'chirp-web',
      replicas: 3,
    });
    const certificate = Certificate.certManager({
      cluster,
      issuerRef: {
        name: app.installation.spec.exposure.certificateIssuerName,
        kind: 'ClusterIssuer',
      },
    });
    const dns = DnsPublication.externalDns({
      cluster,
      hostname: app.installation.spec.hostname,
    });
    const exposure = HttpExposure.kubernetes({
      cluster,
      host,
      certificate,
      dns,
      ingressClassName: 'nginx',
    });
    const objects = ObjectStorage.rookCeph({
      cluster,
      name: 'chirp-media',
      namespace: profileNamespace,
      bucket: profileMediaBucket,
      endpoint: 'http://rook-ceph-rgw-applik8s-object-store.applik8s-rook-ceph.svc:80',
      credentialsSecret: {
        apiVersion: 'v1',
        kind: 'Secret',
        namespace: profileNamespace,
        name: 'chirp-media',
      },
      storageClassName: 'ceph-bucket-retain',
      retention: 'retain',
    });
    const historyDataset = Lakehouse.objectStorageDataset({
      storage: objects,
      prefix: 'lakehouse/historical-engagement',
      schemaRevision: 'v1',
      retainedSnapshots: 256,
    });
    const historyQueries = Lakehouse.objectStorageQueries({
      maximumConcurrentQueries: 8,
      maximumRows: 1_000,
      maximumScannedBytes: 10_000_000_000,
    });
    const analytics = managedAnalytics();
    const workflows = managedWorkflows();
    const generation = StructuredGeneration.http({
      endpoint: app.installation.spec.generation.endpoint,
      credential: secret.env('OPENROUTER_API_KEY'),
      authorization: 'bearer',
      defaultProfile: app.installation.spec.generation.defaultProfile,
    });
    const index = managedIndex();

    profile.defaults({ retention: 'retain', deletionApproval: 'required' });
    profile.qualify({ id: 'chirp-production-kubernetes' });
    profile.provide(PrimaryDatabase, database);
    profile.provide(TransactionalDatabase, database);
    profile.provide(PrimaryAnalytics, analytics);
    profile.provide(AnalyticalDatabase, analytics);
    profile.provide(
      ManagedModelStore.named('moderation-policy'),
      ManagedModelStore.postgres({ database }),
    );
    // ModerationPolicy is a PostgreSQL-backed managed model. Its reconciler is
    // a generated distributed worker even when the application itself runs on
    // Kubernetes; the Kubernetes OperatorRuntime is reserved for CRD-backed
    // managed resources.
    profile.provide(OperatorRuntime, OperatorRuntime.distributed({ database, scheduler, queue }));
    profile.provide(JobRuntime, JobRuntime.kubernetes({
      cluster,
      queue,
      executionHost: jobHost,
      results,
      scheduler,
      events,
    }));
    // The same scheduler powers JobRuntime internals and the application's
    // public schedules. Reusing one implementation preserves a single
    // lifecycle identity while binding both capability surfaces.
    profile.provide(Scheduler, scheduler);
    profile.provide(ApplicationHost, host);
    profile.provide(MediaObjects, objects);
    profile.provide(ObjectStorage, objects);
    profile.provide(HistoricalEngagementDataset, historyDataset);
    profile.provide(HistoricalEngagementQueries, historyQueries);
    profile.provide(PrimaryEvents, events);
    profile.provide(EventLog, events);
    profile.provide(DurableWorkflows, workflows);
    profile.provide(WorkflowEngine, workflows);
    profile.provide(GeneratedContent, generation);
    profile.provide(StructuredGeneration, generation);
    profile.provide(ApplicationImages, registry);
    profile.provide(ContainerRegistry, registry);
    profile.provide(OnlineIndex, index);
    profile.provide(IndexStore, index);
    profile.provide(Certificate, certificate);
    profile.provide(DnsPublication, dns);
    profile.provide(HttpExposure, exposure);
  },
);

export const productionAwsProfile = app.profile('production-aws', (profile) => {
  const account = AWS.account({
    accountId: config.env('AWS_ACCOUNT_ID'),
    region: config.env('AWS_REGION'),
    credentials: secret.env('AWS_CREDENTIALS'),
  });
  const database = Database.auroraPostgres({
    account,
    name: 'chirp',
    database: 'chirp',
    retention: 'retain',
  });
  // EventBridge is the private finite-job admission scheduler. Chirp's public
  // schedules require second precision, so they use the database-backed
  // scheduler instead of silently weakening their authored contract.
  const jobScheduler = Scheduler.eventBridge({ account });
  const scheduler = Scheduler.postgres({ database });
  const queue = Queue.sqs({ account, queueName: 'chirp-jobs' });
  const results = JobResultStore.postgres({ database });
  const registry = ContainerRegistry.ecr({ account, repositoryPrefix: 'chirp' });
  const events = EventLog.kinesis({ account, streamName: 'chirp-events' });
  const jobHost = FiniteExecutionHost.aws({ account, registry, mode: 'fargate' });
  const host = ApplicationHost.aws({ account, registry, name: 'chirp-web', replicas: 3 });
  const certificate = Certificate.acm({
    account,
    domain: config.env('APPLICATION_DOMAIN'),
  });
  const dns = DnsPublication.route53({
    account,
    zone: config.env('ROUTE53_ZONE'),
    hostname: config.env('APPLICATION_DOMAIN'),
  });
  const exposure = HttpExposure.aws({ account, host, certificate, dns });
  const objects = ObjectStorage.s3({
    account,
    bucket: config.env('CHIRP_MEDIA_BUCKET'),
    retention: 'retain',
  });
  const historyDataset = Lakehouse.s3Dataset({
    bucket: 'managed',
    prefix: 'lakehouse/historical-engagement',
    region: config.env('AWS_REGION'),
    catalog: 'chirp_historical_engagement',
    schemaRevision: 'v1',
    retainedSnapshots: 256,
    forceDeleteUnretainedData: true,
  });
  const historyQueries = Lakehouse.athenaQueries({
    workgroup: 'managed',
    region: config.env('AWS_REGION'),
    resultLocation: 'managed',
    maximumConcurrentQueries: 8,
    maximumRows: 1_000,
    maximumScannedBytes: 10_000_000_000,
  });
  const analytics = Analytics.postgres({ database, schema: 'analytics' });
  const workflows = WorkflowEngine.hatchet({
    name: 'chirp-workflows',
    provision: true,
    mode: 'ha',
  });
  const generation = StructuredGeneration.http({
    endpoint: app.installation.spec.generation.endpoint,
    credential: secret.env('OPENROUTER_API_KEY'),
    defaultProfile: app.installation.spec.generation.defaultProfile,
    authorization: 'bearer',
  });
  const index = IndexStore.valkey({
    name: 'chirp-online-index',
    port: 6379,
    provision: true,
    resources: {
      requests: { cpu: '100m', memory: '128Mi' },
      limits: { cpu: '1', memory: '512Mi' },
    },
  });

  profile.defaults({ retention: 'retain', deletionApproval: 'required' });
  profile.qualify({ id: 'chirp-production-aws' });
  profile.provide(PrimaryDatabase, database);
  profile.provide(TransactionalDatabase, database);
  profile.provide(PrimaryAnalytics, analytics);
  profile.provide(AnalyticalDatabase, analytics);
  profile.provide(
    ManagedModelStore.named('moderation-policy'),
    ManagedModelStore.postgres({ database }),
  );
  profile.provide(OperatorRuntime, OperatorRuntime.distributed({ database, scheduler, queue }));
  profile.provide(JobRuntime, JobRuntime.aws({
    account,
    queue,
    executionHost: jobHost,
    results,
    scheduler: jobScheduler,
    events,
  }));
  profile.provide(Scheduler, scheduler);
  profile.provide(ApplicationHost, host);
  profile.provide(MediaObjects, objects);
  profile.provide(ObjectStorage, objects);
  profile.provide(HistoricalEngagementDataset, historyDataset);
  profile.provide(HistoricalEngagementQueries, historyQueries);
  profile.provide(PrimaryEvents, events);
  profile.provide(EventLog, events);
  profile.provide(DurableWorkflows, workflows);
  profile.provide(WorkflowEngine, workflows);
  profile.provide(GeneratedContent, generation);
  profile.provide(StructuredGeneration, generation);
  profile.provide(ApplicationImages, registry);
  profile.provide(ContainerRegistry, registry);
  profile.provide(OnlineIndex, index);
  profile.provide(IndexStore, index);
  profile.provide(Certificate, certificate);
  profile.provide(DnsPublication, dns);
  profile.provide(HttpExposure, exposure);
});
