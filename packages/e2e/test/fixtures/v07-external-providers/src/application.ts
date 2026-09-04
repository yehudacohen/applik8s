import {
  AnalyticalDatabase,
  Analytics,
  app,
  Database,
  EventLog,
  IdentityProvider,
  ObjectStorage,
  Search,
  TransactionalDatabase,
  WorkflowEngine,
} from '@applik8s/applik8s';
import { AgenticDedicated } from '@applik8s/start-agentic';
import { jetStreamStream } from 'typekro/nats';

const namespace = 'identity-start-system';
const eventLogName = 'identity-external-events';
const eventLogServer =
  `nats://${eventLogName}.${namespace}.svc.cluster.local:4222`;
const eventLogStream = 'APPLIK8S_EVENTS';
const eventLogSubjectPrefix = 'applik8s';
// typecast: retain literal profile identity while sharing it across every Dedicated provider fixture.
const profileContext = {
  application: 'identity-external',
  namespace,
} as const;

/**
 * Independently owned, production-shaped providers for the maintained
 * External-profile qualification. The fixture deliberately declares no
 * application host, model, gateway, worker, or projection: its only authority
 * is provider lifecycle. Identity Start must consume this graph without
 * adopting any of its resources.
 */
export const application = app('identity-external-providers', {
  namespace,
});

const database = Database.postgres({
  name: 'primary',
  clusterName: 'identity-external-db',
  namespace,
  database: 'identity_start',
  instances: 1,
  storage: {
    size: '2Gi',
    storageClassName: 'local-path',
  },
  lifecycle: { deletionPolicy: 'delete' },
  ownership: 'direct-provisioned',
});

application.provide(TransactionalDatabase, database);

application.provide(
  AnalyticalDatabase,
  Analytics.clickHouse({
    name: 'identity-external-analytics',
    namespace,
    provision: true,
    storageSize: '2Gi',
    storageClassName: 'local-path',
  }),
);

application.provide(EventLog, {
  kind: 'nats-jetstream',
  name: eventLogName,
  namespace,
  provision: true,
  replicas: 1,
  storageSize: '2Gi',
  storageClassName: 'local-path',
  pvcRetentionPolicy: 'delete',
  stream: eventLogStream,
  subjectPrefix: eventLogSubjectPrefix,
});

// The External profile consumes a complete EventLog capability rather than
// adopting its broker lifecycle. The provider owner therefore materializes
// the advertised durable stream alongside NATS and NACK; the consuming
// application owns only its Consumers.
application.infra(
  () =>
    jetStreamStream({
      id: 'externalEventLogStream',
      name: eventLogName,
      namespace,
      streamName: eventLogStream,
      subjects: [`${eventLogSubjectPrefix}.>`],
      storage: 'file',
      retention: 'limits',
      replicas: 1,
      duplicateWindow: '2m',
      servers: [eventLogServer],
    }),
  { name: 'external-event-log-stream' },
);

application.provide(
  ObjectStorage,
  ObjectStorage.s3({
    name: 'objects',
    endpoint:
      'http://identity-external-objects.identity-start-system.svc:8333',
    bucket: 'identity-external-objects',
    region: 'us-east-1',
    forcePathStyle: true,
    ownership: 'direct-provisioned',
    credentialsSecret: {
      apiVersion: 'v1',
      kind: 'Secret',
      name: 'identity-external-objects-credentials',
      namespace,
    },
    provisioning: {
      kind: 'local-s3',
      enabled: true,
      name: 'identity-external-objects',
      storageSize: '2Gi',
      storageClassName: 'local-path',
    },
  }),
);

const workflows = WorkflowEngine.hatchet({
  name: 'identity-external-workflows',
  namespace,
  provision: true,
  mode: 'stack',
  hostPort:
    'hatchet-engine.identity-start-system.svc:7070',
  apiUrl:
    'http://hatchet-api.identity-start-system.svc:8080',
  tokenKey: 'HATCHET_CLIENT_TOKEN',
  dashboard: 'internal',
  worker: {
    replicas: 1,
    taskSlots: 8,
    durableSlots: 8,
    scaling: { mode: 'fixed' },
  },
});

application.provide(WorkflowEngine, workflows);

// This fixture owns infrastructure but deliberately has no application host.
// Binding its existing workflow engine gives deployment an inspectable
// Kubernetes family without fabricating a workload merely for CLI routing.
application.profile('external-providers', (profile) => {
  profile.defaults({ retention: 'delete', deletionApproval: 'automatic' });
  profile.qualify({ id: 'identity-external-providers-kubernetes' });
  profile.provide(WorkflowEngine, workflows);
});

application.provide(
  Search,
  Search.openSearch({
    name: 'identity-external-search',
    namespace,
    provision: true,
    profile: 'development',
    topology: {
      nodes: 3,
      roles: ['clusterManager', 'data', 'ingest'],
    },
    storage: {
      size: '2Gi',
      storageClassName: 'local-path',
      deletionPolicy: 'delete',
    },
    networkPolicy: { enabled: false },
  }),
);

const identity = AgenticDedicated.identity(
  {
    issuer: 'https://identity-start.example.test',
  },
  profileContext,
);
const identityInfrastructure = identity.infrastructure;
if (!identityInfrastructure) {
  throw new Error('The Dedicated identity provider must declare managed infrastructure.');
}

application.provide(IdentityProvider, {
  ...identity,
  infrastructure: {
    ...identityInfrastructure,
    // The production Dedicated profile retains its identity authority. This
    // isolated provider fixture must instead prove complete graph-backed
    // cleanup after the External consumer has been removed.
    deletionPolicy: 'delete',
  },
});
