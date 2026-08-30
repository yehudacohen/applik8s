// typecast-file-boundary: generated graph/catalog artifacts are validated at this administrative boundary before creating canonical authority records.
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import type {
  ApplicationGraph,
  ApplicationIdentityReference,
  ApplicationOperationCatalog,
  ApplicationStaticAuthorityManifest,
} from '@applik8s/core';
import { createApplicationOperationAuthorityRuntime } from '@applik8s/operations';
import type { ApplicationDeploymentEvidenceReceipt } from '@applik8s/operations';
import * as kubernetes from '@kubernetes/client-node';
import postgres from 'postgres';
import { resolveApplicationInstallationValues } from './application-installation-values.js';
import { makeKubernetesApiClient } from './kubernetes-api-client.js';

export interface ApplicationOperatorAuthorityIo {
  readonly cwd: string;
  stdout(message: string): void;
}

export interface ApplicationOperatorIdentityOptions {
  readonly issuer: string;
  readonly subject: string;
  readonly identityId?: string;
  readonly kind?: ApplicationIdentityReference['kind'];
  readonly reason: string;
  readonly outDir?: string;
  readonly json?: boolean;
}

export interface ApplicationOperatorBreakGlassOptions
  extends ApplicationOperatorIdentityOptions {
  readonly incident: string;
  readonly expiresIn: string;
  readonly acknowledge: string;
}

export async function bootstrapApplicationOperator(
  options: ApplicationOperatorIdentityOptions,
  io: ApplicationOperatorAuthorityIo,
): Promise<void> {
  await withAuthority(options, io, async ({ runtime, roleId, identity, issuer }) => {
    const grants = await runtime.bootstrapRole({
      id: `operator-bootstrap:${identity.issuer}:${identity.subject}`,
      roleId,
      identity,
      issuedBy: issuer,
      reason: required(options.reason, '--reason'),
    });
    return {
      action: 'bootstrap',
      status: grants.length > 0 ? 'granted' : 'inert',
      identity,
      roleId,
      grantIds: grants.map((grant) => grant.id),
    };
  });
}

export async function revokeApplicationOperator(
  options: ApplicationOperatorIdentityOptions,
  io: ApplicationOperatorAuthorityIo,
): Promise<void> {
  await withAuthority(options, io, async ({ runtime, roleId, identity }) => {
    const grants = await runtime.revokeRoleForIdentity(
      roleId,
      identity,
      required(options.reason, '--reason'),
    );
    return {
      action: 'revoke',
      status: grants.length > 0 ? 'revoked' : 'already-absent',
      identity,
      roleId,
      grantIds: grants.map((grant) => grant.id),
    };
  });
}

export async function breakGlassApplicationOperator(
  options: ApplicationOperatorBreakGlassOptions,
  io: ApplicationOperatorAuthorityIo,
): Promise<void> {
  await withAuthority(options, io, async ({ runtime, roleId, identity, issuer }) => {
    const expiresAt = new Date(Date.now() + durationMilliseconds(options.expiresIn));
    const grants = await runtime.assignBreakGlassRole({
      id: required(options.incident, '--incident'),
      roleId,
      identity,
      issuedBy: issuer,
      reason: required(options.reason, '--reason'),
      acknowledgement: required(options.acknowledge, '--acknowledge'),
      expiresAt: expiresAt.toISOString(),
    });
    return {
      action: 'break-glass',
      status: 'granted',
      identity,
      roleId,
      expiresAt: expiresAt.toISOString(),
      grantIds: grants.map((grant) => grant.id),
    };
  });
}

export async function publishApplicationDeploymentReceipt(
  receipt: ApplicationDeploymentEvidenceReceipt,
  outDir: string,
  io: ApplicationOperatorAuthorityIo,
  deployment?: {
    readonly context: string;
    readonly installationSpec: Readonly<Record<string, unknown>>;
  },
): Promise<boolean> {
  let context: Awaited<ReturnType<typeof loadAuthorityContext>>;
  try {
    context = await loadAuthorityContext(outDir, io, false, deployment);
    if (!context) return false;
    await context.runtime.observeDeploymentReceipt(receipt);
    return true;
  } catch {
    // Deployment evidence is deliberately non-authoritative. During a first
    // apply, the generated database Secret (or the database itself) may not
    // exist yet. Failing to publish this derived receipt must never turn a
    // valid deployment plan into a failed deployment or fabricate authority.
    return false;
  } finally {
    await context?.close().catch(() => undefined);
  }
}

async function withAuthority(
  options: ApplicationOperatorIdentityOptions,
  io: ApplicationOperatorAuthorityIo,
  work: (context: {
    readonly runtime: ReturnType<typeof createApplicationOperationAuthorityRuntime>;
    readonly roleId: string;
    readonly identity: ApplicationIdentityReference;
    readonly issuer: ApplicationIdentityReference;
  }) => Promise<Readonly<Record<string, unknown>>>,
): Promise<void> {
  const context = await loadAuthorityContext(
    options.outDir ?? '.applik8s/deploy',
    io,
    true,
  );
  if (!context) throw new Error('Application authority is unavailable.');
  const identity = exactIdentity(options);
  try {
    const result = await work({
      runtime: context.runtime,
      roleId: context.roleId,
      identity,
      issuer: context.issuer,
    });
    io.stdout(options.json ? JSON.stringify(result, null, 2) : summarize(result));
  } finally {
    await context.close();
  }
}

async function loadAuthorityContext(
  outDir: string,
  io: ApplicationOperatorAuthorityIo,
  requireDatabase: boolean,
  deployment?: {
    readonly context: string;
    readonly installationSpec: Readonly<Record<string, unknown>>;
  },
): Promise<{
  readonly runtime: ReturnType<typeof createApplicationOperationAuthorityRuntime>;
  readonly roleId: string;
  readonly issuer: ApplicationIdentityReference;
  close(): Promise<void>;
} | undefined> {
  const directory = resolve(io.cwd, outDir, 'typekro');
  const [graph, catalog] = await Promise.all([
    readJson<ApplicationGraph>(resolve(directory, 'application-graph.json')),
    readJson<ApplicationOperationCatalog>(resolve(directory, 'operation-catalog.json')),
  ]);
  const authorityNodes = graph.nodes.filter((node) => node.kind === 'authorityManifest');
  if (authorityNodes.length !== 1) {
    if (!requireDatabase) return undefined;
    throw new Error(`Expected one authority manifest in ${directory}, found ${authorityNodes.length}. Build the exact application candidate first.`);
  }
  const manifest = authorityNodes[0]!.manifest as ApplicationStaticAuthorityManifest;
  const role = manifest.roles.find((candidate) => candidate.name === 'application-operator');
  if (!role) {
    if (!requireDatabase) return undefined;
    throw new Error('The compiled application does not declare the application-operator role.');
  }
  const connectionEnvironments = new Set(
    graph.nodes
      .flatMap((node) =>
        node.kind === 'model'
        && 'runtime' in node
        && node.runtime?.authorityName === 'application'
        && node.runtime.connectionEnvName
          ? [node.runtime.connectionEnvName]
          : []),
  );
  if (connectionEnvironments.size !== 1) {
    if (!requireDatabase) return undefined;
    throw new Error(`Application operator authority requires exactly one canonical transactional database environment; found ${[...connectionEnvironments].join(', ') || 'none'}.`);
  }
  const connectionEnvironment = [...connectionEnvironments][0]!;
  let databaseUrl = process.env[connectionEnvironment];
  let closeTunnel: (() => Promise<void>) | undefined;
  if (!databaseUrl && deployment) {
    const resolvedGraph = resolveApplicationInstallationValues(
      graph,
      deployment.installationSpec,
      { preserveUnknownReferences: true },
    );
    const connection = applicationAuthorityDatabaseConnection(resolvedGraph);
    if (connection) {
      const tunnel = await openApplicationDatabaseTunnel(
        deployment.context,
        connection,
      );
      databaseUrl = tunnel.url;
      closeTunnel = tunnel.close;
    }
  }
  if (!databaseUrl) {
    if (!requireDatabase) return undefined;
    throw new Error(`Missing ${connectionEnvironment}. Load the application's explicit .env or export the canonical database URL before changing operator authority.`);
  }
  const issuer = manifest.identities.find(
    (candidate) => candidate.subject === 'application-authority',
  );
  if (!issuer) {
    if (!requireDatabase) return undefined;
    throw new Error('The compiled authority manifest has no application authority issuer.');
  }
  const sql = postgres(databaseUrl, {
    max: 1,
    idle_timeout: 2,
    connect_timeout: 10,
    prepare: false,
  });
  const runtime = createApplicationOperationAuthorityRuntime({
    sql,
    application: graph.metadata.name,
    catalog,
    authorityManifest: manifest,
  });
  return {
    runtime,
    roleId: role.id,
    issuer,
    close: async () => {
      await sql.end({ timeout: 2 });
      await closeTunnel?.();
    },
  };
}

interface ApplicationAuthorityDatabaseConnection {
  readonly clusterName: string;
  readonly database: string;
  readonly secretKey: string;
  readonly secretName: string;
  readonly secretNamespace: string;
}

export function applicationAuthorityDatabaseConnection(
  graph: ApplicationGraph,
): ApplicationAuthorityDatabaseConnection | undefined {
  const connections = new Map<string, ApplicationAuthorityDatabaseConnection>();
  for (const node of graph.nodes) {
    if (node.kind !== 'model' || !('runtime' in node)) continue;
    const runtime = node.runtime;
    if (runtime?.authorityName !== 'application') continue;
    const connection = {
      clusterName: requiredRuntimeString(runtime.clusterName),
      database: requiredRuntimeString(runtime.database),
      secretKey: requiredRuntimeString(runtime.secretKey),
      secretName: requiredRuntimeString(runtime.secretName),
      secretNamespace: requiredRuntimeString(runtime.secretNamespace),
    };
    if (Object.values(connection).some((value) => value === undefined)) {
      return undefined;
    }
    const exact = connection as ApplicationAuthorityDatabaseConnection;
    connections.set(JSON.stringify(exact), exact);
  }
  if (connections.size !== 1) return undefined;
  return [...connections.values()][0];
}

function requiredRuntimeString(value: unknown): string | undefined {
  return typeof value === 'string'
    && value.trim().length > 0
    && !value.includes('${')
    ? value
    : undefined;
}

async function openApplicationDatabaseTunnel(
  context: string,
  connection: ApplicationAuthorityDatabaseConnection,
): Promise<{ readonly url: string; close(): Promise<void> }> {
  const kubeConfig = new kubernetes.KubeConfig();
  kubeConfig.loadFromDefault();
  kubeConfig.setCurrentContext(context);
  const core = makeKubernetesApiClient(kubeConfig, kubernetes.CoreV1Api);
  const [secret, pods] = await Promise.all([
    core.readNamespacedSecret({
      name: connection.secretName,
      namespace: connection.secretNamespace,
    }),
    core.listNamespacedPod({
      namespace: connection.secretNamespace,
      labelSelector: `cnpg.io/cluster=${connection.clusterName}`,
    }),
  ]);
  const encoded = secret.data?.[connection.secretKey];
  if (!encoded) {
    throw new Error(
      `Application database Secret ${connection.secretNamespace}/${connection.secretName} has no ${connection.secretKey} entry.`,
    );
  }
  const sourceUrl = new URL(Buffer.from(encoded, 'base64').toString('utf8'));
  const pod = pods.items.find((candidate) =>
    candidate.status?.phase === 'Running'
    && candidate.metadata?.labels?.['role'] === 'primary')
    ?? pods.items.find((candidate) => candidate.status?.phase === 'Running');
  const podName = pod?.metadata?.name;
  if (!podName) {
    throw new Error(
      `Application database cluster ${connection.secretNamespace}/${connection.clusterName} has no running pod for receipt publication.`,
    );
  }
  const portForward = new kubernetes.PortForward(kubeConfig);
  const targetPort = Number(sourceUrl.port || '5432');
  const server = createServer((socket) => {
    const errors = new PassThrough();
    errors.on('data', () => {
      socket.destroy();
    });
    void portForward.portForward(
      connection.secretNamespace,
      podName,
      [targetPort],
      socket,
      errors,
      socket,
    ).catch((cause: unknown) => {
      socket.destroy(
        cause instanceof Error ? cause : new Error(String(cause)),
      );
    });
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Application database receipt tunnel did not bind a TCP port.');
  }
  sourceUrl.hostname = '127.0.0.1';
  sourceUrl.port = String(address.port);
  sourceUrl.pathname = `/${connection.database}`;
  return {
    url: sourceUrl.toString(),
    close: () => new Promise<void>((resolveClose, rejectClose) => {
      server.close((error) => error ? rejectClose(error) : resolveClose());
    }),
  };
}

function exactIdentity(options: ApplicationOperatorIdentityOptions): ApplicationIdentityReference {
  const issuer = required(options.issuer, '--issuer');
  const subject = required(options.subject, '--subject');
  const kind = options.kind ?? 'human';
  if (kind === 'execution' || kind === 'pre-authentication-flow' || kind === 'oauth-authorization-flow') {
    throw new Error(`--kind ${kind} is framework-managed and cannot receive application-operator authority.`);
  }
  return {
    id: options.identityId?.trim() || `identity:${digestIdentity(issuer, subject)}`,
    kind,
    issuer,
    subject,
  };
}

function digestIdentity(issuer: string, subject: string): string {
  return Buffer.from(`${issuer}\0${subject}`).toString('base64url');
}

function durationMilliseconds(value: string): number {
  const match = /^(\d+)(m|h)$/.exec(value.trim());
  if (!match) throw new Error('--expires-in must be a positive bounded duration such as 30m or 4h.');
  const amount = Number(match[1]);
  const milliseconds = amount * (match[2] === 'h' ? 60 * 60_000 : 60_000);
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0 || milliseconds > 24 * 60 * 60_000) {
    throw new Error('--expires-in must be greater than zero and no more than 24h.');
  }
  return milliseconds;
}

function required(value: string, option: string): string {
  if (!value?.trim()) throw new Error(`${option} requires a non-empty value.`);
  return value.trim();
}

function summarize(result: Readonly<Record<string, unknown>>): string {
  const identity = result.identity as ApplicationIdentityReference;
  return `Application operator ${String(result.action)} ${String(result.status)} for ${identity.issuer} subject ${identity.subject}.`;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}
