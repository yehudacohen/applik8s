import type { ApplicationGraph, ApplicationProviderNode, JsonObject } from '@applik8s/core';

/**
 * Lowers one graph-selected S3-compatible ObjectStorage provider into the
 * server-side environment shared by application hosts and managed closures.
 * Keeping this contract in one place prevents browser intents and background
 * effects from quietly receiving different provider semantics.
 */
// typecast-boundary: provider configuration is narrowed once here from the
// generic application graph JSON contract into Kubernetes environment values.
export function applicationObjectStorageEnvironment(
  graph: ApplicationGraph,
  workloadNamespace: string,
  owner: string,
): readonly Readonly<Record<string, unknown>>[] {
  const provider = graph.nodes.find(
    (node): node is ApplicationProviderNode =>
      node.kind === 'provider' && node.interface === 'ObjectStorage',
  );
  const config = objectValue(objectValue(provider?.config).objectStorage);
  if (stringValue(config.kind) !== 's3') {
    throw new Error(`${owner} requires an S3-compatible ObjectStorage provider.`);
  }
  const bucket = stringValue(config.bucket);
  const region = stringValue(config.region);
  if (!bucket || !region) {
    throw new Error(`${owner} requires ObjectStorage bucket and region values.`);
  }
  const environment: Readonly<Record<string, unknown>>[] = [
    {
      name: 'APPLIK8S_OBJECT_STORAGE_ENABLED',
      value: environmentScalar(config.enabled, 'true'),
    },
    { name: 'APPLIK8S_OBJECT_STORAGE_BUCKET', value: bucket },
    { name: 'APPLIK8S_OBJECT_STORAGE_REGION', value: region },
    {
      name: 'APPLIK8S_OBJECT_STORAGE_FORCE_PATH_STYLE',
      value: environmentScalar(config.forcePathStyle, 'false'),
    },
  ];
  const provisioning = objectValue(config.provisioning);
  const objectBucketClaim =
    !stringValue(provisioning.kind)
    || stringValue(provisioning.kind) === 'object-bucket-claim';
  const connectionConfigMapName = objectBucketClaim
    ? stringValue(provisioning.claimName)
      ?? stringValue(config.name)
      ?? stringValue(objectValue(config.credentialsSecret).name)
      ?? bucket
    : undefined;
  if (connectionConfigMapName && config.endpoint === undefined) {
    environment.push(
      configMapEnvironment(
        'APPLIK8S_OBJECT_STORAGE_HOST',
        connectionConfigMapName,
        'BUCKET_HOST',
      ),
      configMapEnvironment(
        'APPLIK8S_OBJECT_STORAGE_PORT',
        connectionConfigMapName,
        'BUCKET_PORT',
      ),
      {
        name: 'APPLIK8S_OBJECT_STORAGE_ENDPOINT',
        value:
          'http://$(APPLIK8S_OBJECT_STORAGE_HOST):$(APPLIK8S_OBJECT_STORAGE_PORT)',
      },
    );
  }
  for (const [name, value] of [
    ['APPLIK8S_OBJECT_STORAGE_ENDPOINT', config.endpoint],
    ['APPLIK8S_OBJECT_STORAGE_PREFIX', config.prefix],
  ] as const) {
    if (typeof value === 'string' && value.length > 0) {
      environment.push({ name, value });
    }
  }
  const credentials = objectValue(config.credentialsSecret);
  const secretName = stringValue(credentials.name);
  if (!secretName) return environment;
  const secretNamespace = stringValue(credentials.namespace) ?? workloadNamespace;
  if (
    secretNamespace !== workloadNamespace
    && !secretNamespace.startsWith('${')
  ) {
    throw new Error(
      `${owner} cannot mount ObjectStorage credentials Secret ${secretName} from namespace ${secretNamespace}; the workload runs in ${workloadNamespace}.`,
    );
  }
  const optional = config.enabled !== true;
  environment.push(
    secretEnvironment(
      'AWS_ACCESS_KEY_ID',
      secretName,
      stringValue(config.accessKeyIdKey) ?? 'AWS_ACCESS_KEY_ID',
      optional,
    ),
    secretEnvironment(
      'AWS_SECRET_ACCESS_KEY',
      secretName,
      stringValue(config.secretAccessKeyKey) ?? 'AWS_SECRET_ACCESS_KEY',
      optional,
    ),
  );
  const sessionTokenKey = stringValue(config.sessionTokenKey);
  if (sessionTokenKey) {
    environment.push(
      secretEnvironment('AWS_SESSION_TOKEN', secretName, sessionTokenKey, true),
    );
  }
  return environment;
}

function secretEnvironment(
  name: string,
  secretName: string,
  key: string,
  optional: boolean,
): Readonly<Record<string, unknown>> {
  return {
    name,
    valueFrom: {
      secretKeyRef: {
        name: secretName,
        key,
        ...(optional ? { optional: true } : {}),
      },
    },
  };
}

function configMapEnvironment(
  name: string,
  configMapName: string,
  key: string,
): Readonly<Record<string, unknown>> {
  return {
    name,
    valueFrom: {
      configMapKeyRef: {
        name: configMapName,
        key,
      },
    },
  };
}

function environmentScalar(value: unknown, fallback: string): string {
  if (typeof value === 'boolean' || typeof value === 'number') {
    return String(value);
  }
  if (typeof value !== 'string' || value.length === 0) return fallback;
  const expression = value.match(/^\$\{([\s\S]+)\}$/)?.[1];
  return expression ? `\${string(${expression})}` : value;
}

function objectValue(value: unknown): JsonObject {
  // Narrow the unknown provider payload once at this compiler boundary.
  return value && typeof value === 'object' && !Array.isArray(value)
    // typecast: the runtime checks establish the graph's JSON object contract.
    ? value as JsonObject
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
