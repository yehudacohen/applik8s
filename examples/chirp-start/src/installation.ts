import {
  app as defineApplication,
} from '@applik8s/applik8s';
import { AgenticProfiles } from '@applik8s/start-agentic';
import { type } from 'arktype';

const GenerationProvider = type({
  endpoint: 'string',
  credentialsSecretName: 'string',
  credentialKey: 'string',
  authorization: "'bearer' | 'x-api-key'",
  defaultProfile: 'string',
});

const ExternalProviders = type({
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
  generation: GenerationProvider,
  events: {
    server: 'string',
    'stream?': 'string',
    'subjectPrefix?': 'string',
    'connectionSecretName?': 'string',
  },
});

const CommonInstallation = type({
  name: 'string',
  hostname: 'string',
  version: 'string',
  generation: {
    endpoint: 'string',
    defaultProfile: 'string',
  },
  features: {
    automatedAccounts: 'boolean',
    analytics: 'boolean',
    media: 'boolean',
  },
  lifecycle: {
    databaseDeletion: "'retain' | 'delete'",
    objectStorageDeletion: "'retain' | 'delete'",
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
});

const StarterInstallation = type({
  profile: "'starter'",
});

const DedicatedInstallation = type({
  profile: "'dedicated'",
  providers: {
    generation: GenerationProvider,
  },
});

const ExternalInstallation = type({
  profile: "'external'",
  providers: ExternalProviders,
});

export const InstallationSpec = CommonInstallation.and(
  StarterInstallation.or(DedicatedInstallation).or(ExternalInstallation),
);

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
export const publicExposure = app.select(
  app.installation.spec.exposure.mode,
  { ingress: true, default: false },
);

/** Reviewed Start defaults; product code names only its real deviations. */
export const capacity = AgenticProfiles.capacity(
  app,
  app.installation.spec.profile,
);

export function requiredInstallationValue<T>(
  value: T | undefined,
  path: string,
): T {
  if (value === undefined) {
    throw new Error(
      `Chirp installation ${path} is required by its selected provider profile.`,
    );
  }
  return value;
}
