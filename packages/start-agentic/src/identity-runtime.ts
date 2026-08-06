// typecast-file-boundary: Installation input is validated before it selects a provider runtime endpoint.
import { createHash } from 'node:crypto';
import type {
  ApplicationPrincipal,
  ApplicationRequestAdmission,
  JsonObject,
  JsonValue,
} from '@applik8s/core';
import { createDeterministicApplicationAdmission } from '@applik8s/identity';
import { OryKratosIdentityAdapter } from '@applik8s/identity-ory';
import postgres, { type Sql } from 'postgres';

export type AgenticOryIdentityProfile = 'dedicated' | 'external';

export const agenticWorkspaceCookieName = 'applik8s_workspace';

export interface AgenticWorkspaceAccess {
  readonly workspaceId: string;
  readonly role:
    | 'workspace-owner'
    | 'workspace-administrator'
    | 'workspace-member';
}

export interface AgenticWorkspaceAccessLookup {
  (
    input: {
      readonly workspaceId: string;
      readonly principalId: string;
    },
  ): Promise<AgenticWorkspaceAccess | undefined>;
}

export interface AuthenticateAgenticStarterRequestOptions {
  /**
   * Explicit product-owned workspace bootstrap.
   *
   * The maintained Starter identity does not invent a tenancy model. Products
   * that include the workspace domain may opt into its bootstrap deliberately.
   */
  readonly bootstrap?: (
    input: {
      readonly application: string;
      readonly principalId: string;
    },
  ) => Promise<AgenticWorkspaceAccess>;
  /** Deterministic test seam; production validates selected workspaces in PostgreSQL. */
  readonly lookup?: AgenticWorkspaceAccessLookup;
}

/**
 * Credential-free Starter admission. The deterministic principal is real
 * framework identity evidence; a selected workspace is admitted separately
 * from server-side database state and never trusted from the browser cookie.
 * A cookie-less request does not create product-domain tenancy records.
 */
export async function authenticateAgenticStarterRequest(
  request: Request,
  options: AuthenticateAgenticStarterRequestOptions = {},
): Promise<ApplicationRequestAdmission> {
  const application = requiredEnv(
    'APPLIK8S_APPLICATION_NAME',
    'Agentic Starter identity requires APPLIK8S_APPLICATION_NAME.',
  );
  const issuer = `applik8s://${application}/identity/deterministic`;
  const admission = createDeterministicApplicationAdmission({
      mode: 'starter',
      application,
      subject: 'local-developer',
      audience: [application],
      // Starter is a credential-free, single-operator profile. Its one local
      // developer is also the platform administrator; workspace authority is
      // still admitted independently from server-side membership state.
      roles: ['authenticated', 'administrator'],
      trustedContext: { issuer },
      catalogRevision:
        process.env.APPLIK8S_OPERATION_CATALOG_REVISION?.trim()
        || `${application}-catalog-v1`,
      authorityRevision:
        process.env.APPLIK8S_AUTHORITY_REVISION?.trim()
        || `${application}-authority-v1`,
    });
  const selected = selectedWorkspaceId(request);
  if (selected) {
    return admitAgenticWorkspaceRequest(
      request,
      admission,
      options.lookup ?? lookupAgenticWorkspaceAccess,
    );
  }
  if (options.bootstrap) {
    const access = await options.bootstrap({
      application,
      principalId: admission.principal.id,
    });
    return admissionWithAgenticWorkspaceAccess(admission, access);
  }
  return freezeAdmission(
    withRoles(admission.principal, ['authenticated']),
    admission.trustedContext,
  );
}

/** Server-only runtime adapter used by generated identity callbacks. */
export async function authenticateAgenticProfileRequest(
  request: Request,
  profile: AgenticOryIdentityProfile,
): Promise<ApplicationRequestAdmission> {
  const options = agenticRuntimeOryIdentity(profile);
  const trustedContext = Object.freeze({ issuer: options.issuer });
  const adapter = new OryKratosIdentityAdapter({
    publicUrl: options.publicUrl,
    adminUrl: options.adminUrl,
    issuer: options.issuer,
  });
  const principal = await adapter.authenticate(request, {
    application: options.application,
    audience: [options.application],
    trustedContextDigest: createHash('sha256')
      .update(JSON.stringify(trustedContext))
      .digest('hex'),
    catalogRevision:
      process.env.APPLIK8S_OPERATION_CATALOG_REVISION?.trim()
      || `${options.application}-catalog-v1`,
    authorityRevision:
      process.env.APPLIK8S_AUTHORITY_REVISION?.trim()
      || `${options.application}-authority-v1`,
  });
  return admitAgenticWorkspaceRequest(
    request,
    Object.freeze({ principal, trustedContext }),
    lookupAgenticWorkspaceAccess,
  );
}

/**
 * Promotes one untrusted browser selector into trusted execution context only
 * after proving the authenticated principal owns or belongs to the workspace.
 *
 * Exported for deterministic adapter and security-contract tests. Applications
 * normally receive this behavior from the maintained profile.
 */
export async function admitAgenticWorkspaceRequest(
  request: Request,
  admission: ApplicationRequestAdmission,
  lookup: AgenticWorkspaceAccessLookup,
): Promise<ApplicationRequestAdmission> {
  const workspaceId = selectedWorkspaceId(request);
  const authenticated = withRoles(admission.principal, ['authenticated']);
  if (!workspaceId) {
    return freezeAdmission(authenticated, admission.trustedContext);
  }
  const access = await lookup({
    workspaceId,
    principalId: authenticated.id,
  });
  if (!access || access.workspaceId !== workspaceId) {
    throw new AgenticWorkspaceAdmissionError(workspaceId);
  }
  return admissionWithAgenticWorkspaceAccess(admission, access);
}

function admissionWithAgenticWorkspaceAccess(
  admission: ApplicationRequestAdmission,
  access: AgenticWorkspaceAccess,
): ApplicationRequestAdmission {
  const authenticated = withRoles(admission.principal, ['authenticated']);
  const trustedContext = Object.freeze({
    ...admission.trustedContext,
    workspaceId: access.workspaceId,
    workspaceRole: access.role,
  }) satisfies JsonObject;
  return freezeAdmission(
    withRoles(authenticated, [access.role]),
    trustedContext,
  );
}

export class AgenticWorkspaceAdmissionError extends Error {
  readonly code = 'APPLIK8S_WORKSPACE_ACCESS_DENIED';
  readonly workspaceId: string;

  constructor(workspaceId: string) {
    super(
      `Authenticated identity is not permitted to use workspace ${workspaceId}.`,
    );
    this.name = 'AgenticWorkspaceAdmissionError';
    this.workspaceId = workspaceId;
  }
}

/** Credential-free readiness probe for the selected Ory identity boundary. */
export async function readyAgenticProfileIdentity(
  profile: AgenticOryIdentityProfile,
): Promise<void> {
  const options = agenticRuntimeOryIdentity(profile);
  await new OryKratosIdentityAdapter({
    publicUrl: options.publicUrl,
    adminUrl: options.adminUrl,
    issuer: options.issuer,
  }).ready();
}

const databaseClients = new Map<string, Sql>();

async function lookupAgenticWorkspaceAccess(
  input: {
    readonly workspaceId: string;
    readonly principalId: string;
  },
): Promise<AgenticWorkspaceAccess | undefined> {
  const sql = agenticDatabaseClient();
  const rows = await sql<readonly {
    readonly workspace_id: string;
    readonly owner_principal_id: string;
    readonly membership_role: string | null;
  }[]>`
    SELECT
      workspace.id::text AS workspace_id,
      workspace.owner_principal_id,
      membership.role AS membership_role
    FROM workspaces AS workspace
    LEFT JOIN workspace_memberships AS membership
      ON membership.workspace_id = workspace.id
      AND membership.identity_id = ${input.principalId}
    WHERE workspace.id = ${input.workspaceId}::uuid
      AND (
        workspace.owner_principal_id = ${input.principalId}
        OR membership.identity_id = ${input.principalId}
      )
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return undefined;
  const role = row.owner_principal_id === input.principalId
    ? 'workspace-owner'
    : agenticWorkspaceRole(row.membership_role);
  return role
    ? Object.freeze({ workspaceId: row.workspace_id, role })
    : undefined;
}

function agenticDatabaseClient(): Sql {
  const databaseUrl =
    process.env.APPLIK8S_DATABASE_APPLICATION_URL?.trim()
    || process.env.APPLIK8S_DATABASE_PRIMARY_URL?.trim()
    || process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error(
      'Agentic workspace admission requires the generated application database binding.',
    );
  }
  let sql = databaseClients.get(databaseUrl);
  if (!sql) {
    sql = postgres(databaseUrl, {
      max: 4,
      idle_timeout: 20,
      connect_timeout: 5,
      prepare: false,
    });
    databaseClients.set(databaseUrl, sql);
  }
  return sql;
}

function selectedWorkspaceId(request: Request): string | undefined {
  const cookie = request.headers.get('cookie');
  if (!cookie) return undefined;
  for (const pair of cookie.split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 0) continue;
    if (pair.slice(0, separator).trim() !== agenticWorkspaceCookieName) {
      continue;
    }
    const encoded = pair.slice(separator + 1).trim();
    if (!encoded) return undefined;
    let value: string;
    try {
      value = decodeURIComponent(encoded);
    } catch {
      throw new Error('Agentic workspace selector cookie is malformed.');
    }
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      )
    ) {
      throw new Error('Agentic workspace selector must be a UUID.');
    }
    return value.toLowerCase();
  }
  return undefined;
}

function agenticWorkspaceRole(
  value: string | null,
): AgenticWorkspaceAccess['role'] | undefined {
  return value === 'workspace-owner'
    || value === 'workspace-administrator'
    || value === 'workspace-member'
    ? value
    : undefined;
}

function withRoles(
  principal: ApplicationPrincipal,
  additional: readonly string[],
): ApplicationPrincipal {
  return Object.freeze({
    ...principal,
    roles: Object.freeze([
      ...new Set([...(principal.roles ?? []), ...additional]),
    ]),
  });
}

function freezeAdmission(
  principal: ApplicationPrincipal,
  trustedContext: Readonly<Record<string, JsonValue>>,
): ApplicationRequestAdmission {
  const frozenContext = Object.freeze({ ...trustedContext });
  return Object.freeze({
    principal: Object.freeze({
      ...principal,
      trustedContextDigest: digestTrustedContext(frozenContext),
    }),
    trustedContext: frozenContext,
  });
}

function digestTrustedContext(
  value: Readonly<Record<string, JsonValue>>,
): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}

function requiredEnv(name: string, message: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(message);
  return value;
}

function agenticRuntimeOryIdentity(
  profile: AgenticOryIdentityProfile,
): {
  readonly application: string;
  readonly publicUrl: string;
  readonly adminUrl: string;
  readonly issuer: string;
} {
  const installation = process.env.APPLIK8S_INSTALLATION_SPEC;
  if (!installation) {
    throw new Error(
      'Agentic Ory identity requires APPLIK8S_INSTALLATION_SPEC.',
    );
  }
  const decoded = JSON.parse(installation) as {
    readonly name?: unknown;
    readonly profile?: unknown;
    readonly providers?: {
      readonly identity?: {
        readonly kind?: unknown;
        readonly issuer?: unknown;
        readonly publicUrl?: unknown;
        readonly adminUrl?: unknown;
      };
    };
  };
  if (typeof decoded.name !== 'string' || !decoded.name.trim()) {
    throw new Error(
      'Agentic Ory identity requires a non-empty installation name.',
    );
  }
  const application = process.env.APPLIK8S_APPLICATION_NAME?.trim();
  if (!application) {
    throw new Error(
      'Agentic Ory identity requires APPLIK8S_APPLICATION_NAME.',
    );
  }
  if (decoded.profile !== profile) {
    throw new Error(
      `Agentic ${profile} identity received installation profile ${JSON.stringify(decoded.profile)}.`,
    );
  }
  if (profile === 'external') {
    const identity = decoded.providers?.identity;
    if (
      identity?.kind !== 'ory'
      || typeof identity.issuer !== 'string'
      || typeof identity.publicUrl !== 'string'
      || typeof identity.adminUrl !== 'string'
      || !identity.issuer.trim()
      || !identity.publicUrl.trim()
      || !identity.adminUrl.trim()
    ) {
      throw new Error(
        'Agentic external Ory identity requires issuer, publicUrl, and adminUrl.',
      );
    }
    return {
      application,
      issuer: identity.issuer.trim(),
      publicUrl: identity.publicUrl.trim(),
      adminUrl: identity.adminUrl.trim(),
    };
  }
  const namespace = process.env.APPLIK8S_NAMESPACE?.trim();
  if (!namespace) {
    throw new Error('Agentic Ory identity requires APPLIK8S_NAMESPACE.');
  }
  const name = `${application}-identity`;
  const issuer = decoded.providers?.identity?.issuer;
  if (typeof issuer !== 'string' || !issuer.trim()) {
    throw new Error(
      'Agentic dedicated Ory identity requires providers.identity.issuer.',
    );
  }
  const publicUrl =
    `http://${name}-kratos-public.${namespace}.svc.cluster.local`;
  return {
    application,
    publicUrl,
    adminUrl:
      `http://${name}-kratos-admin.${namespace}.svc.cluster.local`,
    issuer: issuer.trim(),
  };
}
