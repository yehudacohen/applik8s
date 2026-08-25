// typecast-file-boundary: AWS SDK response payloads are normalized into provider-neutral runtime values here.
import { GetSecretValueCommand, SecretsManagerClient, type SecretsManagerClientConfig } from '@aws-sdk/client-secrets-manager';

export * from './kinesis.js';
export * from './lakehouse.js';
export * from './schedule.js';

export interface ApplicationAwsPostgresRuntimeBinding {
  readonly kind: 'postgresUrl';
  readonly environmentName: string;
  readonly database: string;
  readonly host: string;
  readonly port: number;
  /** ECS-projected Secret JSON environment variable (the v0.8 path). */
  readonly secretEnvironmentName?: string;
  /** Legacy runtime-read source retained for rolling migration only. */
  readonly secretArn?: string;
}

export interface ApplicationAwsRuntimeBindingBootstrapOptions {
  readonly environment?: Record<string, string | undefined>;
  readonly readSecret?: (arn: string) => Promise<string>;
}

/** Resolves reference-only AWS bindings before application modules load. */
export async function initializeApplicationAwsRuntimeBindings(
  options: ApplicationAwsRuntimeBindingBootstrapOptions = {},
): Promise<readonly string[]> {
  const environment = options.environment ?? process.env;
  const descriptors = Object.entries(environment)
    .filter(([name, value]) => /^APPLIK8S_AWS_RUNTIME_BINDING_\d+$/u.test(name) && value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => parseBinding(name, value ?? ''));
  const readSecret = options.readSecret ?? (descriptors.some(({ environmentName, secretArn }) => !environment[environmentName] && secretArn) ? awsSecretReader(environment) : undefined);
  const initialized: string[] = [];
  for (const descriptor of descriptors) {
    if (environment[descriptor.environmentName]) continue;
    let source: string;
    let sourceIdentity: string;
    if (descriptor.secretEnvironmentName) {
      sourceIdentity = descriptor.secretEnvironmentName;
      const projected = environment[descriptor.secretEnvironmentName];
      if (!projected) throw new Error(`AWS runtime binding ${descriptor.environmentName} is missing projected secret ${descriptor.secretEnvironmentName}.`);
      source = projected;
    } else if (descriptor.secretArn && readSecret) {
      sourceIdentity = descriptor.secretArn;
      source = await readSecret(descriptor.secretArn);
    } else {
      throw new Error(`AWS runtime binding ${descriptor.environmentName} requires a projected secret or legacy secret reader.`);
    }
    const secret = parsePostgresSecret(source, sourceIdentity);
    const database = encodeURIComponent(descriptor.database);
    environment[descriptor.environmentName] = `postgres://${encodeURIComponent(secret.username)}:${encodeURIComponent(secret.password)}@${hostForUrl(descriptor.host)}:${descriptor.port}/${database}`;
    initialized.push(descriptor.environmentName);
  }
  const databaseAlias = environment.APPLIK8S_DATABASE_URL_BINDING;
  if (databaseAlias) {
    if (!/^[A-Z_][A-Z0-9_]*$/u.test(databaseAlias)) throw new Error('APPLIK8S_DATABASE_URL_BINDING must name a valid environment variable.');
    const value = environment[databaseAlias];
    if (!value) throw new Error(`APPLIK8S_DATABASE_URL_BINDING references missing ${databaseAlias}.`);
    if (!environment.DATABASE_URL) environment.DATABASE_URL = value;
  }
  return Object.freeze(initialized);
}

function awsSecretReader(environment: Readonly<Record<string, string | undefined>>): (arn: string) => Promise<string> {
  const region = environment.AWS_REGION ?? environment.AWS_DEFAULT_REGION;
  const config: SecretsManagerClientConfig = {
    ...(region ? { region } : {}),
    ...(environment.AWS_ENDPOINT_URL ? { endpoint: environment.AWS_ENDPOINT_URL } : {}),
  };
  const client = new SecretsManagerClient(config);
  return async (arn) => {
    const response = await client.send(new GetSecretValueCommand({ SecretId: arn }));
    if (!response.SecretString) throw new Error(`AWS Secrets Manager returned no string payload for runtime binding ${arn}.`);
    return response.SecretString;
  };
}

function parseBinding(name: string, value: string): ApplicationAwsPostgresRuntimeBinding {
  let candidate: unknown;
  try { candidate = JSON.parse(value); } catch { throw new Error(`AWS runtime binding ${name} is not valid JSON.`); }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error(`AWS runtime binding ${name} must be an object.`);
  const read = (field: string): unknown => Reflect.get(candidate as object, field);
  const secretEnvironmentName = read('secretEnvironmentName');
  const secretArn = read('secretArn');
  const hasProjectedSecret = typeof secretEnvironmentName === 'string' && /^[A-Z_][A-Z0-9_]*$/u.test(secretEnvironmentName);
  const hasLegacySecret = typeof secretArn === 'string' && Boolean(secretArn.trim());
  if (read('kind') !== 'postgresUrl' || typeof read('environmentName') !== 'string' || !/^[A-Z_][A-Z0-9_]*$/u.test(String(read('environmentName'))) || typeof read('database') !== 'string' || typeof read('host') !== 'string' || hasProjectedSecret === hasLegacySecret) {
    throw new Error(`AWS runtime binding ${name} has an invalid PostgreSQL descriptor.`);
  }
  const port = Number(read('port'));
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error(`AWS runtime binding ${name} has an invalid PostgreSQL port.`);
  return {
    kind: 'postgresUrl',
    environmentName: String(read('environmentName')),
    database: String(read('database')),
    host: String(read('host')),
    port,
    ...(hasProjectedSecret ? { secretEnvironmentName } : { secretArn: String(secretArn) }),
  };
}

function parsePostgresSecret(value: string, arn: string): { readonly username: string; readonly password: string } {
  let candidate: unknown;
  try { candidate = JSON.parse(value); } catch { throw new Error(`AWS PostgreSQL runtime secret ${arn} is not valid JSON.`); }
  const username = candidate && typeof candidate === 'object' ? Reflect.get(candidate, 'username') : undefined;
  const password = candidate && typeof candidate === 'object' ? Reflect.get(candidate, 'password') : undefined;
  if (typeof username !== 'string' || !username || typeof password !== 'string' || !password) throw new Error(`AWS PostgreSQL runtime secret ${arn} lacks username or password.`);
  return { username, password };
}

function hostForUrl(value: string): string {
  if (!value.trim() || /[/?#@]/u.test(value)) throw new Error('AWS PostgreSQL runtime host is invalid.');
  return value.includes(':') && !value.startsWith('[') ? `[${value}]` : value;
}
