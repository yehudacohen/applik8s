// typecast-file-boundary: generated graph/catalog artifacts are validated at this administrative boundary before creating canonical authority records.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  ApplicationGraph,
  ApplicationIdentityReference,
  ApplicationOperationCatalog,
  ApplicationStaticAuthorityManifest,
} from '@applik8s/core';
import { createApplicationOperationAuthorityRuntime } from '@applik8s/operations';
import type { ApplicationDeploymentEvidenceReceipt } from '@applik8s/operations';
import postgres from 'postgres';

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
): Promise<boolean> {
  const context = await loadAuthorityContext(outDir, io, false);
  if (!context) return false;
  try {
    await context.runtime.observeDeploymentReceipt(receipt);
    return true;
  } finally {
    await context.close();
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
  const databaseUrl = process.env[connectionEnvironment];
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
    close: () => sql.end({ timeout: 2 }),
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
