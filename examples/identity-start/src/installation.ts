import { type } from 'arktype';

const ApplicationIdentity = type({
  name: 'string',
});

const ExternalProviders = type({
  database: {
    clusterName: 'string',
    namespace: 'string',
    database: 'string',
    connectionSecretName: 'string',
    'connectionSecretKey?': 'string',
  },
  analytics: {
    endpoint: 'string',
    'database?': 'string',
    'credentialsSecretName?': 'string',
  },
  events: {
    server: 'string',
    'stream?': 'string',
    'subjectPrefix?': 'string',
    'connectionSecretName?': 'string',
  },
  objects: {
    endpoint: 'string',
    bucket: 'string',
    region: 'string',
    credentialsSecretName: 'string',
    'forcePathStyle?': 'boolean',
  },
  workflows: {
    hostPort: 'string',
    apiUrl: 'string',
    tokenSecretName: 'string',
    'tokenKey?': 'string',
  },
  search: {
    endpoint: 'string',
    'namespace?': 'string',
    'credentialsSecretName?': 'string',
  },
  inference: {
    endpoint: 'string',
    model: 'string',
    credentialSecretName: 'string',
    'credentialKey?': 'string',
    'allowInsecureHttp?': 'boolean',
  },
  identity: {
    kind: "'ory'",
    issuer: 'string',
    publicUrl: 'string',
    adminUrl: 'string',
  },
  payments: {
    secretName: 'string',
    'apiKeyKey?': 'string',
    'webhookSecretKey?': 'string',
    'endpoint?': 'string',
  },
});

const DedicatedProviders = type({
  inference: {
    endpoint: 'string',
    model: 'string',
    credentialSecretName: 'string',
    'credentialKey?': 'string',
  },
  identity: {
    issuer: 'string',
  },
  objects: {
    deviceStorageClassName: 'string',
    'allowLoopDevices?': 'boolean',
  },
  payments: {
    secretName: 'string',
    'apiKeyKey?': 'string',
    'webhookSecretKey?': 'string',
    'endpoint?': 'string',
  },
});

const DeveloperProviders = type({
  inference: {
    endpoint: 'string',
    model: 'string',
    credentialSecretName: 'string',
    'credentialKey?': 'string',
  },
  'payments?': {
    secretName: 'string',
    'apiKeyKey?': 'string',
    'webhookSecretKey?': 'string',
    'endpoint?': 'string',
  },
});

export const Installation = ApplicationIdentity
  .and({ profile: "'starter'" })
  .or(ApplicationIdentity.and({
    profile: "'developer'",
    providers: DeveloperProviders,
  }))
  .or(ApplicationIdentity.and({
    profile: "'dedicated'",
    providers: DedicatedProviders,
  }))
  .or(ApplicationIdentity.and({
    profile: "'external'",
    providers: ExternalProviders,
  }));

export const InstallationStatus = type({
  ready: 'boolean',
});
