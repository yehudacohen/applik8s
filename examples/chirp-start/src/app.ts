// typecast-file-boundary: Chirp composes ArkType-derived optional installation proxies into provider contracts whose inactive branches are concretized only after spec validation.

import type { ApplicationIdentityInfrastructure } from '@applik8s/applik8s';
import { AnalyticalDatabase, Authorization, ContainerRegistry, defaultApplicationEventLogProvider, app as defineApplication, IdentityProvider, IndexStore, ObjectStorage, StructuredGeneration, WorkflowEngine } from '@applik8s/applik8s';
import { type } from 'arktype';
import { externalInfrastructureProviders } from './providers/external';
import { authenticateChirpRequest, chirpAuthorization, probeChirpIdentity } from './providers/identity';
import { localAnalyticalDatabase, localContainerRegistry, localObjectStorage, localWorkflowEngine } from './providers/local';

export const InstallationSpec = type({
  name: 'string',
  hostname: 'string',
  profile: "'starter' | 'dedicated' | 'external'",
  version: 'string',
  features: {
    automatedAccounts: 'boolean',
    analytics: 'boolean',
    media: 'boolean',
  },
  lifecycle: {
    databaseDeletion: "'retain' | 'delete'",
    registryProjectDeletion: "'retain' | 'delete'",
    purgeRegistryRepositories: 'boolean',
  },
  backup: {
    enabled: 'boolean',
    schedule: 'string',
    retentionPolicy: 'string',
  },
  exposure: {
    mode: "'node-port' | 'ingress'",
    nodePort: '30000 <= number.integer <= 32767',
    certificateIssuerName: 'string',
  },
  identity: {
    mode: "'deterministic-local' | 'ory' | 'zitadel'",
    'issuer?': 'string',
    'sessionEndpoint?': 'string',
    'browserEndpoint?': 'string',
    'authorizationEndpoint?': 'string',
    'authorizationNamespace?': 'string',
    authorizationVersion: 'string',
    infrastructure: {
      mode: "'external' | 'managed-local' | 'managed-production'",
      namespace: 'string',
      deletionPolicy: "'retain' | 'delete'",
      'hydraDsnSecretName?': 'string',
      'hydraSystemSecretName?': 'string',
      'kratosDsnSecretName?': 'string',
      'kratosSecretsName?': 'string',
      'ketoDsnSecretName?': 'string',
      'oathkeeperJwksSecretName?': 'string',
    },
  },
  'providers?': {
    registry: {
      origin: 'string',
      repositoryPrefix: 'string',
      pushSecretName: 'string',
      pullSecretName: 'string',
    },
    objectStorage: {
      endpoint: 'string',
      bucket: 'string',
      prefix: 'string',
      region: 'string',
      credentialsSecretName: 'string',
      forcePathStyle: 'boolean',
    },
    database: {
      database: 'string',
      connectionSecretName: 'string',
      connectionSecretKey: 'string',
    },
    analytics: {
      endpoint: 'string',
      database: 'string',
      credentialsSecretName: 'string',
    },
    workflows: {
      hostPort: 'string',
      apiUrl: 'string',
      workerTokenSecretName: 'string',
      tls: 'boolean',
    },
    index: {
      host: 'string',
      port: '1 <= number.integer <= 65535',
      passwordSecretName: 'string',
      passwordSecretKey: 'string',
    },
    generation: {
      endpoint: 'string',
      credentialsSecretName: 'string',
      credentialKey: 'string',
      authorization: "'bearer' | 'x-api-key'",
      defaultProfile: 'string',
    },
  },
});

export const InstallationStatus = type({
  ready: 'boolean',
  "phase?": "'Installing' | 'Ready' | 'Upgrading' | 'Degraded' | 'Failed'",
  'url?': 'string',
  'observedVersion?': 'string',
  'artifactDigest?': 'string',
  'providerStatus?': {
    registry: "'Ready' | 'Pending' | 'Failed' | 'NotConfigured'",
    database: "'Ready' | 'Pending' | 'Failed' | 'NotConfigured'",
    eventLog: "'Ready' | 'Pending' | 'Failed' | 'NotConfigured'",
    index: "'Ready' | 'Pending' | 'Failed' | 'NotConfigured'",
    analytics: "'Ready' | 'Pending' | 'Failed' | 'NotConfigured'",
    objectStorage: "'Ready' | 'Pending' | 'Failed' | 'NotConfigured'",
    workflows: "'Ready' | 'Pending' | 'Failed' | 'NotConfigured'",
    identity: "'Ready' | 'Pending' | 'Failed' | 'NotConfigured'",
    authorization: "'Ready' | 'Pending' | 'Failed' | 'NotConfigured'",
    exposure: "'Ready' | 'Pending' | 'Failed' | 'NotConfigured'",
    workloads: "'Ready' | 'Pending' | 'Failed' | 'NotConfigured'",
  },
  'migrationStatus?': "'Ready' | 'Pending' | 'Failed' | 'NotRequired'",
  'rolloutStatus?': "'Current' | 'Reconciling' | 'Blocked'",
  'backupStatus?': "'Ready' | 'Pending' | 'Failed' | 'NotConfigured'",
  'projectionStatus?': {
    online: "'Ready' | 'Pending' | 'Failed' | 'NotConfigured'",
    analytics: "'Ready' | 'Pending' | 'Failed' | 'NotConfigured'",
  },
  'degradedReasons?': 'string[]',
});

export const app = defineApplication('chirp', {
  controlPlaneNamespace: 'chirp-control',
  apiVersion: 'applications.chirp.dev/v1alpha1',
  kind: 'ChirpInstallation',
  spec: InstallationSpec,
  status: InstallationStatus,
  namespace: (spec) => spec.name,
});

export const ChirpInstallation = app.installation.model;
export const namespace = app.installation.spec.name;
export const mediaBucket = app.interpolate`${namespace}-media`;
export const externalProfile = app.select(app.installation.spec.profile, { external: true, default: false });
export const managedProfile = app.select(app.installation.spec.profile, { external: false, default: true });
export const publicExposure = app.select(app.installation.spec.exposure.mode, { ingress: true, default: false });

/** App-specific profile mapping expressed once as typed KRO values. */
export const capacity = Object.freeze({
  webReplicas: app.select(app.installation.spec.profile, { starter: 1, dedicated: 3, external: 2, default: 1 }),
  webCpuRequest: app.select(app.installation.spec.profile, { starter: '150m', dedicated: '500m', external: '250m', default: '150m' }),
  webMemoryRequest: app.select(app.installation.spec.profile, { starter: '192Mi', dedicated: '512Mi', external: '256Mi', default: '192Mi' }),
  webCpuLimit: app.select(app.installation.spec.profile, { starter: '1', dedicated: '2', external: '1', default: '1' }),
  webMemoryLimit: app.select(app.installation.spec.profile, { starter: '512Mi', dedicated: '1Gi', external: '768Mi', default: '512Mi' }),
  gatewayReplicas: app.select(app.installation.spec.profile, { starter: 1, dedicated: 3, external: 2, default: 1 }),
  commandReplicas: app.select(app.installation.spec.profile, { starter: 1, dedicated: 3, external: 2, default: 1 }),
  commandConcurrency: app.select(app.installation.spec.profile, { starter: 16, dedicated: 48, external: 32, default: 16 }),
  commandCpuRequest: app.select(app.installation.spec.profile, { starter: '100m', dedicated: '500m', external: '250m', default: '100m' }),
  commandMemoryRequest: app.select(app.installation.spec.profile, { starter: '192Mi', dedicated: '512Mi', external: '256Mi', default: '192Mi' }),
  commandCpuLimit: app.select(app.installation.spec.profile, { starter: '1', dedicated: '2', external: '1', default: '1' }),
  commandMemoryLimit: app.select(app.installation.spec.profile, { starter: '512Mi', dedicated: '1Gi', external: '768Mi', default: '512Mi' }),
  postgresInstances: app.select(app.installation.spec.profile, { starter: 1, dedicated: 3, external: 1, default: 1 }),
  // The checked-in starter profile is an OrbStack contract, not a disguised
  // production capacity tier. Keep its established local volumes stable so an
  // ordinary application rollout never attempts an implicit PVC migration.
  // Dedicated installations opt into expandable Ceph storage explicitly.
  postgresStorage: app.select(app.installation.spec.profile, { starter: '1Gi', dedicated: '200Gi', external: '1Gi', default: '1Gi' }),
  postgresStorageClass: app.select(app.installation.spec.profile, {
    starter: 'local-path',
    dedicated: 'ceph-block',
    external: 'local-path',
    default: 'local-path',
  }),
  eventLogReplicas: app.select(app.installation.spec.profile, { starter: 1, dedicated: 3, external: 1, default: 1 }),
  // Persistent JetStream claim templates are immutable. Keep the starter and
  // external profiles on the framework's established 8Gi baseline so an
  // ordinary application rollout never masquerades as a storage migration.
  // Moving an existing installation to the dedicated 100Gi profile requires
  // an explicit backup/restore migration onto expandable storage.
  eventLogStorage: app.select(app.installation.spec.profile, { starter: '8Gi', dedicated: '100Gi', external: '8Gi', default: '8Gi' }),
  eventLogStorageClass: app.select(app.installation.spec.profile, {
    // Empty means "use the cluster default". This preserves the original
    // StatefulSet claim-template shape on OrbStack while dedicated profiles
    // opt into an explicitly managed, expandable class.
    starter: '',
    dedicated: 'ceph-block',
    external: '',
    default: '',
  }),
  workflowDatabaseInstances: app.select(app.installation.spec.profile, { starter: 1, dedicated: 3, external: 1, default: 1 }),
  workflowDatabaseStorage: app.select(app.installation.spec.profile, { starter: '8Gi', dedicated: '100Gi', external: '8Gi', default: '8Gi' }),
  workflowDatabaseStorageClass: app.select(app.installation.spec.profile, {
    starter: 'local-path',
    dedicated: 'ceph-block',
    external: 'local-path',
    default: 'local-path',
  }),
  workflowReplicas: app.select(app.installation.spec.profile, { starter: 1, dedicated: 3, external: 2, default: 1 }),
  analyticsStorage: app.select(app.installation.spec.profile, { starter: '16Gi', dedicated: '250Gi', external: '16Gi', default: '16Gi' }),
  analyticsStorageClass: app.select(app.installation.spec.profile, {
    starter: 'local-path',
    dedicated: 'ceph-block',
    external: 'local-path',
    default: 'local-path',
  }),
  indexShards: app.select(app.installation.spec.profile, { starter: 1, dedicated: 3, external: 1, default: 1 }),
  indexReplicas: app.select(app.installation.spec.profile, { starter: 0, dedicated: 1, external: 0, default: 0 }),
  indexStorage: app.select(app.installation.spec.profile, { starter: '8Gi', dedicated: '100Gi', external: '8Gi', default: '8Gi' }),
  indexStorageClass: app.select(app.installation.spec.profile, {
    starter: 'local-path',
    dedicated: 'ceph-block',
    external: 'local-path',
    default: 'local-path',
  }),
});

app.defaults({
  eventLog: {
    ...defaultApplicationEventLogProvider,
    namespace,
    replicas: capacity.eventLogReplicas,
    storageSize: capacity.eventLogStorage,
    storageClassName: capacity.eventLogStorageClass,
  },
});

export const external = externalInfrastructureProviders(
  namespace,
  requiredInstallationValue(app.installation.spec.providers, 'spec.providers'),
);

const identity = app.installation.spec.identity;
const identityInfrastructure = identity.infrastructure;
const identityName = app.interpolate`${namespace}-identity`;
const localOryDependencies = {};
const productionIdentity = {
  issuer: requiredInstallationValue(identity.issuer, 'spec.identity.issuer'),
  browserEndpoint: requiredInstallationValue(identity.browserEndpoint, 'spec.identity.browserEndpoint'),
  hydraDsnSecretName: requiredInstallationValue(identityInfrastructure.hydraDsnSecretName, 'spec.identity.infrastructure.hydraDsnSecretName'),
  hydraSystemSecretName: requiredInstallationValue(identityInfrastructure.hydraSystemSecretName, 'spec.identity.infrastructure.hydraSystemSecretName'),
  kratosDsnSecretName: requiredInstallationValue(identityInfrastructure.kratosDsnSecretName, 'spec.identity.infrastructure.kratosDsnSecretName'),
  kratosSecretsName: requiredInstallationValue(identityInfrastructure.kratosSecretsName, 'spec.identity.infrastructure.kratosSecretsName'),
  ketoDsnSecretName: requiredInstallationValue(identityInfrastructure.ketoDsnSecretName, 'spec.identity.infrastructure.ketoDsnSecretName'),
  oathkeeperJwksSecretName: requiredInstallationValue(identityInfrastructure.oathkeeperJwksSecretName, 'spec.identity.infrastructure.oathkeeperJwksSecretName'),
};
const productionOryDependencies = {
  hydra: {
    database: { dsn: { mode: 'external' as const, value: { secretRef: { name: productionIdentity.hydraDsnSecretName, key: 'uri' } } } },
    systemSecret: { mode: 'external' as const, value: { secretRef: { name: productionIdentity.hydraSystemSecretName, key: 'system' } } },
    issuerUrl: { url: { mode: 'external' as const, url: productionIdentity.issuer } },
    loginUrl: { url: { mode: 'external' as const, url: productionIdentity.browserEndpoint } },
    consentUrl: { url: { mode: 'external' as const, url: productionIdentity.browserEndpoint } },
    logoutUrl: { url: { mode: 'external' as const, url: productionIdentity.browserEndpoint } },
  },
  kratos: {
    database: { dsn: { mode: 'external' as const, value: { secretRef: { name: productionIdentity.kratosDsnSecretName, key: 'uri' } } } },
    publicBaseUrl: { url: { mode: 'external' as const, url: productionIdentity.browserEndpoint } },
    browserBaseUrl: { url: { mode: 'external' as const, url: productionIdentity.browserEndpoint } },
    secrets: {
      cookie: { mode: 'external' as const, value: { secretRef: { name: productionIdentity.kratosSecretsName, key: 'cookie' } } },
      cipher: { mode: 'external' as const, value: { secretRef: { name: productionIdentity.kratosSecretsName, key: 'cipher' } } },
    },
  },
  keto: {
    database: { dsn: { mode: 'external' as const, value: { secretRef: { name: productionIdentity.ketoDsnSecretName, key: 'uri' } } } },
  },
  oathkeeper: {
    mutatorIdTokenJwks: { mode: 'external' as const, value: { secretRef: { name: productionIdentity.oathkeeperJwksSecretName, key: 'jwks' } } },
  },
};
const oryInfrastructure: ApplicationIdentityInfrastructure = {
  kind: 'ory',
  stack: app.select(identityInfrastructure.mode, { 'managed-local': 'platform', default: 'identity' }),
  provision: app.select(identityInfrastructure.mode, { 'managed-local': true, 'managed-production': true, default: false }),
  spec: {
    name: identityName,
    namespace: identityInfrastructure.namespace,
    managed: app.selectProvider(identityInfrastructure.mode, {
      'managed-local': { databases: true, secrets: true, routes: false, sampleUpstream: false, courierSes: false },
      default: { databases: false, secrets: false, routes: false, sampleUpstream: false, courierSes: false },
    }),
    dependencySources: app.selectProvider(identityInfrastructure.mode, {
      'managed-production': productionOryDependencies,
      default: localOryDependencies,
    }),
  },
  deletionPolicy: identityInfrastructure.deletionPolicy,
  timeoutMs: 15 * 60_000,
};
app.provide(IdentityProvider, IdentityProvider.from(authenticateChirpRequest, { infrastructure: oryInfrastructure, ready: probeChirpIdentity }));
app.provide(Authorization, chirpAuthorization);
const externalGeneration = StructuredGeneration.http({
  endpoint: external.generation.endpoint,
  credentialSecret: {
    apiVersion: 'v1', kind: 'Secret', namespace,
    name: external.generation.credentialsSecretName,
  },
  credentialKey: external.generation.credentialKey,
  authorization: external.generation.authorization,
  defaultProfile: external.generation.defaultProfile,
});
app.provide(StructuredGeneration, app.selectProvider(app.installation.spec.profile, {
  dedicated: externalGeneration,
  external: externalGeneration,
  default: StructuredGeneration.deterministic({
    output: { body: 'An automated Chirp update generated by the deterministic local profile.' },
    inputUnits: 32,
    outputUnits: 12,
  }),
}));
app.provide(ObjectStorage, localObjectStorage(
  namespace,
  app.select(app.installation.spec.profile, { external: external.objects.bucket, default: mediaBucket }),
  // Object storage is a core recovery dependency even when media and scheduled
  // database backups are disabled: online-projection rebuilds persist their
  // immutable, checksummed generation evidence here before publication.
  true,
  app.select(app.installation.spec.profile, { external: false, default: true }),
  {
    endpoint: app.select(app.installation.spec.profile, { external: external.objects.endpoint, default: 'http://rook-ceph-rgw-harbor-object-store.typekro-harbor-ceph.svc:80' }),
    prefix: app.select(app.installation.spec.profile, { external: external.objects.prefix, default: 'site' }),
    region: app.select(app.installation.spec.profile, { external: external.objects.region, default: 'us-east-1' }),
    credentialsSecretName: app.select(app.installation.spec.profile, { external: external.objects.credentialsSecretName, default: 'chirp-media' }),
    forcePathStyle: app.select(app.installation.spec.profile, { external: external.objects.forcePathStyle, default: true }),
    ownership: app.select(app.installation.spec.profile, { external: 'external', default: 'direct-provisioned' }),
  },
));
// Durable projection recovery is part of every installation. The automated
// accounts feature controls its schedules/work, not ownership of the engine
// that also runs recovery workflows.
app.provide(WorkflowEngine, localWorkflowEngine(namespace, capacity, true, {
  provision: app.select(app.installation.spec.profile, { external: false, default: true }),
  hostPort: app.select(app.installation.spec.profile, { external: external.workflows.hostPort, default: 'chirp-workflows-engine:7070' }),
  apiUrl: app.select(app.installation.spec.profile, { external: external.workflows.apiUrl, default: 'http://chirp-workflows-api:8080' }),
  workerTokenSecretName: app.select(app.installation.spec.profile, { external: external.workflows.workerTokenSecretName, default: 'hatchet-client-config' }),
  tls: app.select(app.installation.spec.profile, { external: external.workflows.tls, default: false }),
}));
app.provide(AnalyticalDatabase, localAnalyticalDatabase(namespace, capacity, app.installation.spec.features.analytics, {
  provision: app.select(app.installation.spec.profile, { external: false, default: true }),
  endpoint: app.select(app.installation.spec.profile, { external: external.analytics.endpoint, default: app.interpolate`http://clickhouse-chirp-analytics.${namespace}.svc.cluster.local:8123` }),
  database: app.select(app.installation.spec.profile, { external: external.analytics.database, default: 'chirp' }),
  credentialsSecretName: app.select(app.installation.spec.profile, { external: external.analytics.credentialsSecretName, default: 'chirp-analytics-credentials' }),
}));
app.provide(ContainerRegistry, app.selectProvider(app.installation.spec.profile, {
  external: external.registry,
  default: localContainerRegistry(namespace, app.installation.spec.lifecycle),
}));
app.provide(IndexStore, IndexStore.valkey({
  provisioner: 'hyperspike',
  // This provider has an explicit TypeKro direct lifecycle because the
  // Hyperspike controller owns its generated Services. The distinct name also
  // provides a safe one-time migration away from the former KRO-owned CR.
  name: 'chirp-online-index',
  namespace,
  host: app.select(app.installation.spec.profile, { external: external.index.host, default: app.interpolate`chirp-online-index.${namespace}.svc.cluster.local` }),
  port: app.select(app.installation.spec.profile, { external: external.index.port, default: 6379 }),
  provision: managedProfile,
  operator: {
    provision: true,
    name: 'applik8s-valkey-operator',
    namespace: 'valkey-operator-system',
  },
  topology: { shards: capacity.indexShards, replicas: capacity.indexReplicas },
  storage: {
    size: capacity.indexStorage,
    storageClassName: capacity.indexStorageClass,
  },
  authentication: {
    mode: app.select(app.installation.spec.profile, { external: 'password', default: 'anonymous' }),
    secret: {
      apiVersion: 'v1', kind: 'Secret', namespace,
      name: app.select(app.installation.spec.profile, { external: external.index.passwordSecretName, default: 'chirp-index-unused' }),
    },
    key: app.select(app.installation.spec.profile, { external: external.index.passwordSecretKey, default: 'password' }),
  },
  resources: {
    requests: { cpu: '100m', memory: '128Mi' },
    limits: { cpu: '1', memory: '512Mi' },
  },
}));

export { authenticateChirpRequest } from './providers/identity';

function requiredInstallationValue<T>(value: T | undefined, path: string): T {
  if (value === undefined) {
    throw new Error(`Chirp installation ${path} is required by its selected provider profile.`);
  }
  return value;
}
