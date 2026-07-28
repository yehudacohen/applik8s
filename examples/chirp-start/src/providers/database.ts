import type { ApplicationProcessorOptions } from '@applik8s/applik8s';
import { app, capacity, external, managedProfile, mediaBucket, namespace } from '../app';
import { chirpSchema } from '../schema/index';

/**
 * PostgreSQL is Chirp's authoritative model store. Provider-specific CNPG and
 * Rook backup coordinates stay in this infrastructure module; domain models
 * import only the resulting typed database capability.
 */
export const Database = app.database.postgres('chirp', {
  // The logical database authority remains "chirp"; the physical cluster has
  // an independent identity so stateful storage migrations never overload
  // domain-facing environment variables or command/query contracts.
  clusterName: 'chirp-models',
  schema: chirpSchema,
  migrations: { path: '../drizzle' },
  database: app.select(app.installation.spec.profile, { external: external.database.database, default: 'chirp' }),
  connectionSecret: {
    apiVersion: 'v1',
    kind: 'Secret',
    name: app.select(app.installation.spec.profile, { external: external.database.connectionSecretName, default: 'chirp-models-app' }),
    namespace,
  },
  connectionSecretKey: app.select(app.installation.spec.profile, { external: external.database.connectionSecretKey, default: 'uri' }),
  ownership: app.select(app.installation.spec.profile, { external: 'external', default: 'direct-provisioned' }),
  provision: managedProfile,
  lifecycle: {
    deletionPolicy: app.installation.spec.lifecycle.databaseDeletion,
  },
  instances: capacity.postgresInstances,
  storage: {
    size: capacity.postgresStorage,
    storageClassName: capacity.postgresStorageClass,
  },
  backup: {
    enabled: app.all(managedProfile, app.installation.spec.backup.enabled),
    schedule: app.installation.spec.backup.schedule,
    retentionPolicy: app.installation.spec.backup.retentionPolicy,
    immediate: true,
    destination: {
      kind: 's3',
      destinationPath: app.interpolate`s3://${mediaBucket}/database-backups`,
      endpoint: 'http://rook-ceph-rgw-harbor-object-store.typekro-harbor-ceph.svc:80',
      credentialsSecret: { apiVersion: 'v1', kind: 'Secret', name: 'chirp-media', namespace },
    },
  },
});

/** One horizontally scalable command pool; handlers retain per-key ordering and transaction isolation. */
export const ChirpCommandProcessor = {
  group: 'chirp-commands',
  replicas: capacity.commandReplicas,
  concurrency: capacity.commandConcurrency,
  resources: {
    requests: { cpu: capacity.commandCpuRequest, memory: capacity.commandMemoryRequest },
    limits: { cpu: capacity.commandCpuLimit, memory: capacity.commandMemoryLimit },
  },
} satisfies ApplicationProcessorOptions;
