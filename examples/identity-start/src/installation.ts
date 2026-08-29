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
    'credentialKey?': 'string > 0',
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
  notifications: {
    host: 'string',
    'port?': '1 <= number.integer <= 65535',
    'secure?': 'boolean',
    secretName: 'string',
    'usernameKey?': 'string',
    'passwordKey?': 'string',
    senderEmail: 'string',
    'senderName?': 'string',
  },
  webSearch: {
    endpoint: 'string > 0',
    'allowInsecureHttp?': 'boolean',
  },
});

const DedicatedProviders = type({
  inference: {
    endpoint: 'string',
    model: 'string',
    credentialSecretName: 'string',
    'credentialKey?': 'string > 0',
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
  notifications: {
    host: 'string',
    'port?': '1 <= number.integer <= 65535',
    'secure?': 'boolean',
    secretName: 'string',
    'usernameKey?': 'string',
    'passwordKey?': 'string',
    senderEmail: 'string',
    'senderName?': 'string',
    'credentialSource?': {
      kind: "'hostEnvironment' | 'existingSecret'",
      'usernameVariable?': 'string',
      'passwordVariable?': 'string',
    },
  },
  'webSearch?': {
    secretName: 'string > 0',
    'secretKey?': 'string > 0',
    'name?': 'string > 0',
    'namespace?': 'string > 0',
    'replicas?': '1 <= number.integer <= 32',
    'redisUrl?': 'string > 0',
  },
});

const DeveloperProviders = type({
  inference: {
    endpoint: 'string',
    model: 'string',
    credentialSecretName: 'string',
    'credentialKey?': 'string > 0',
  },
  'payments?': {
    secretName: 'string',
    'apiKeyKey?': 'string',
    'webhookSecretKey?': 'string',
    'endpoint?': 'string',
  },
  'notifications?': {
    host: 'string',
    'port?': '1 <= number.integer <= 65535',
    'secure?': 'boolean',
    secretName: 'string',
    'usernameKey?': 'string',
    'passwordKey?': 'string',
    senderEmail: 'string',
    'senderName?': 'string',
    'credentialSource?': {
      kind: "'hostEnvironment' | 'existingSecret'",
      'usernameVariable?': 'string',
      'passwordVariable?': 'string',
    },
  },
  'webSearch?': {
    secretName: 'string > 0',
    'secretKey?': 'string > 0',
    'name?': 'string > 0',
    'namespace?': 'string > 0',
    'replicas?': '1 <= number.integer <= 32',
    'redisUrl?': 'string > 0',
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
