// typecast-file-boundary: Installation input is validated before it selects a provider runtime endpoint.
import { createHash } from 'node:crypto';
import {
  type ApplicationPrincipal,
  type ApplicationRequestAdmission,
  canonicalJsonV1String,
  type JsonObject,
  type JsonValue,
} from '@applik8s/core';
import {
  createDeterministicApplicationAdmission,
} from '@applik8s/identity';
import {
  type ApplicationIdentityAccountView,
  type ApplicationIdentityFlowView,
  type ApplicationIdentitySessionDeviceView,
  type ApplicationIdentitySessionView,
  applicationIdentityHttpProtocol,
} from '@applik8s/identity/client';
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

export type AgenticWorkspaceAccessLookup = (input: {
  readonly workspaceId: string;
  readonly principalId: string;
}) => Promise<AgenticWorkspaceAccess | undefined>;

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
  if (starterIdentitySignedOut(request)) {
    throw new AgenticStarterAuthenticationRequiredError();
  }
  const admission = agenticStarterAdmission();
  if (isReceiptBackedCommandProgress(request)) {
    return authenticatedAgenticStarterAdmission(admission);
  }
  let selected: string | undefined;
  try {
    selected = selectedWorkspaceId(request);
  } catch (error) {
    if (!isApplicationIdentitySessionRequest(request)
      || !(error instanceof AgenticWorkspaceSelectorError)) {
      throw error;
    }
    return authenticatedAgenticStarterAdmission(admission);
  }
  if (selected) {
    try {
      return await admitAgenticWorkspaceRequest(
        request,
        admission,
        options.lookup ?? lookupAgenticWorkspaceAccess,
      );
    } catch (error) {
      if (!isApplicationIdentitySessionRequest(request)) {
        throw error;
      }
      // A session read proves authentication, not workspace authority. If the
      // selected workspace is stale or its authority store is temporarily
      // unavailable, preserve the authenticated principal while deliberately
      // withholding every workspace-scoped role and trusted-context field.
      return authenticatedAgenticStarterAdmission(admission);
    }
  }
  if (options.bootstrap) {
    const access = await options.bootstrap({
      application: requiredEnv(
        'APPLIK8S_APPLICATION_NAME',
        'Agentic Starter identity requires APPLIK8S_APPLICATION_NAME.',
      ),
      principalId: admission.principal.id,
    });
    return admissionWithAgenticWorkspaceAccess(admission, access);
  }
  return authenticatedAgenticStarterAdmission(admission);
}

function authenticatedAgenticStarterAdmission(
  admission: ApplicationRequestAdmission,
): ApplicationRequestAdmission {
  return freezeAdmission(
    withRoles(admission.principal, ['authenticated']),
    {
      ...admission.trustedContext,
      principalScope: admission.principal.id,
    },
  );
}

function agenticStarterAdmission(): ApplicationRequestAdmission {
  const application = requiredEnv(
    'APPLIK8S_APPLICATION_NAME',
    'Agentic Starter identity requires APPLIK8S_APPLICATION_NAME.',
  );
  const issuer = `applik8s://${application}/identity/deterministic`;
  return createDeterministicApplicationAdmission({
      mode: 'starter',
      application,
      subject: 'local-developer',
      audience: [application],
      // Product authentication is provider evidence. Application-operator
      // authority is bootstrapped separately into the canonical grant store.
      roles: ['authenticated'],
      trustedContext: { issuer },
      catalogRevision:
        process.env.APPLIK8S_OPERATION_CATALOG_REVISION?.trim()
        || `${application}-catalog-v1`,
      authorityRevision:
        process.env.APPLIK8S_AUTHORITY_REVISION?.trim()
        || `${application}-authority-v1`,
    });
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
  if (isReceiptBackedCommandProgress(request)) {
    return freezeAdmission(
      withRoles(principal, ['authenticated']),
      { ...trustedContext, principalScope: principal.id },
    );
  }
  const admission = Object.freeze({ principal, trustedContext });
  try {
    return await admitAgenticWorkspaceRequest(
      request,
      admission,
      lookupAgenticWorkspaceAccess,
    );
  } catch (error) {
    if (!isApplicationIdentitySessionRequest(request)) throw error;
    return authenticatedAgenticStarterAdmission(admission);
  }
}

/**
 * A signed command-progress cursor observes an operation that was authorized
 * against its persisted issuance receipt. Requiring a mutable workspace
 * selector to remain valid would make successful workspace deletion
 * unobservable, so this exact boundary authenticates identity without
 * promoting the browser cookie into fresh trusted context.
 */
function isReceiptBackedCommandProgress(request: Request): boolean {
  if (request.method !== 'POST') return false;
  const pathname = new URL(request.url).pathname;
  return /\/commands\/[^/]+\/progress$/u.test(pathname);
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
    return freezeAdmission(authenticated, {
      ...admission.trustedContext,
      principalScope: authenticated.id,
    });
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
    principalScope: access.workspaceId,
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

class AgenticWorkspaceSelectorError extends Error {
  readonly code = 'APPLIK8S_WORKSPACE_SELECTOR_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'AgenticWorkspaceSelectorError';
  }
}

class AgenticStarterAuthenticationRequiredError extends Error {
  readonly code = 'APPLIK8S_AUTHENTICATION_REQUIRED';
  readonly status = 401;

  constructor() {
    super('Sign in before accessing the application.');
    this.name = 'AgenticStarterAuthenticationRequiredError';
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

/**
 * Complete credential-free identity protocol for Starter and Developer.
 *
 * Starter has one deterministic local operator, so registration/login flows
 * resolve to the same admitted identity without inventing production
 * credentials. The UI remains identical when a live provider is selected.
 */
export async function handleAgenticStarterIdentityRequest(
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  const path = agenticIdentityPath(url);
  try {
    if (path[0] === 'session' && request.method === 'DELETE') {
      return identityJson(
        anonymousIdentitySession(),
        200,
        [starterIdentitySessionCookie(request, true)],
      );
    }
    if (starterIdentitySignedOut(request) && path[0] !== 'flows') {
      return identityError(
        'authentication_required',
        'Sign in before accessing account identity operations.',
        401,
      );
    }
    // Identity admission is deliberately independent from the product's
    // workspace selector. A stale, deleted, or malformed workspace cookie must
    // never prevent a user from signing in, recovering an account, or choosing
    // a different workspace after authentication.
    const baseAdmission = agenticStarterAdmission();
    const admission = freezeAdmission(
      withRoles(baseAdmission.principal, ['authenticated']),
      baseAdmission.trustedContext,
    );
    if (path[0] === 'account' && path.length === 1 && request.method === 'GET') {
      return identityJson(identityAccount(admission.principal));
    }
    if (
      path[0] === 'account'
      && path[1] === 'sessions'
      && path.length === 2
      && request.method === 'GET'
    ) {
      return identityJson(identitySessionDevices([
        {
          id: admission.principal.sessionId ?? 'starter-local-session',
          current: true,
          active: true,
          authenticationMethods: [admission.principal.authenticationMethod],
          authenticatedAt: admission.principal.admittedAt,
          ...(admission.principal.expiresAt
            ? { expiresAt: admission.principal.expiresAt }
            : {}),
        },
      ]));
    }
    if (path[0] === 'flows' && path.length === 2 && request.method === 'POST') {
      return identityJson(starterIdentityFlow(path[1]), 201);
    }
    if (
      path[0] === 'flows'
      && path[2] === 'transitions'
      && path.length === 4
      && request.method === 'POST'
    ) {
      return identityJson(
        identitySession(admission.principal),
        200,
        [starterIdentitySessionCookie(request, false)],
      );
    }
    return identityError('invalid_request', 'The identity route does not exist.', 404);
  } catch {
    return identityError(
      'provider_unavailable',
      'The local identity boundary is unavailable.',
      503,
      true,
    );
  }
}

/**
 * Translates Ory's provider-native browser flows into the bounded Applik8s
 * identity protocol used by every generated frontend.
 */
export async function handleAgenticProfileIdentityRequest(
  request: Request,
  profile: AgenticOryIdentityProfile,
): Promise<Response> {
  const options = agenticRuntimeOryIdentity(profile);
  const adapter = new OryKratosIdentityAdapter({
    publicUrl: options.publicUrl,
    adminUrl: options.adminUrl,
    issuer: options.issuer,
  });
  const url = new URL(request.url);
  const path = agenticIdentityPath(url);
  try {
    if (path[0] === 'session' && request.method === 'DELETE') {
      const result = await adapter.browserLogout(request, {
        returnTo: url.origin,
        signal: request.signal,
      });
      return identityJson(
        anonymousIdentitySession(),
        200,
        result.setCookie,
      );
    }
    if (path[0] === 'flows' && path.length === 2 && request.method === 'POST') {
      const kind = agenticIdentityFlowKind(path[1]);
      const cookie = request.headers.get('cookie') ?? undefined;
      const started = await adapter.beginBrowserFlow(kind, {
        returnTo: url.origin,
        ...(cookie ? { cookie } : {}),
        signal: request.signal,
      });
      return identityJson(
        oryIdentityFlow(kind, started.providerFlowId, started.redirectUri),
        201,
        started.setCookie,
      );
    }
    if (
      path[0] === 'flows'
      && path[2] === 'transitions'
      && path.length === 4
      && request.method === 'POST'
    ) {
      const parsed = parsedOryIdentityFlow(path[1]);
      const transition = requiredIdentitySegment(path[3]);
      const input = await identityRequestObject(request);
      const cookie = request.headers.get('cookie') ?? undefined;
      const result = await adapter.submitFlow(
        parsed.kind,
        parsed.providerFlowId,
        {
          ...jsonIdentityInput(input),
          method: transition,
        },
        {
          ...(cookie ? { cookie } : {}),
          signal: request.signal,
        },
      );
      return identityJson(
        {
          ...oryIdentityFlow(
            parsed.kind,
            parsed.providerFlowId,
            result.redirectUri,
          ),
          state: result.state === 'complete' ? 'complete' : 'active',
        },
        200,
        result.setCookie,
      );
    }
    if (path[0] === 'account' && path.length === 1 && request.method === 'GET') {
      return identityJson(identityAccountFromOry(await adapter.session(request)));
    }
    if (
      path[0] === 'account'
      && path[1] === 'sessions'
      && path.length === 2
      && request.method === 'GET'
    ) {
      const current = await adapter.session(request);
      const sessions = await adapter.identitySessions(current.identity.subject);
      return identityJson(identitySessionDevices(sessions.map((session) => ({
        ...session,
        current: session.id === current.sessionId,
      }))));
    }
    if (
      path[0] === 'account'
      && path[1] === 'sessions'
      && path.length === 3
      && request.method === 'DELETE'
    ) {
      const current = await adapter.session(request);
      const sessions = await adapter.identitySessions(current.identity.subject);
      const target = requiredIdentitySegment(path[2]);
      if (!sessions.some((session) => session.id === target)) {
        return identityError(
          'invalid_request',
          'The identity session does not exist.',
          404,
        );
      }
      await adapter.revokeSession(target, 'user-requested session revocation');
      return identityJson(identitySessionDevices(
        sessions
          .filter((session) => session.id !== target)
          .map((session) => ({
            ...session,
            current: session.id === current.sessionId,
          })),
      ));
    }
    if (
      path[0] === 'account'
      && path[1] === 'mfa'
      && path.length === 2
      && request.method === 'POST'
    ) {
      const body = await identityRequestObject(request);
      const method = agenticMfaMethod(body.method);
      const cookie = request.headers.get('cookie') ?? undefined;
      const started = await adapter.beginBrowserFlow('settings', {
        ...(cookie ? { cookie } : {}),
        aal: 'aal2',
        returnTo: url.origin,
        signal: request.signal,
      });
      return identityJson({
        protocol: applicationIdentityHttpProtocol,
        kind: 'mfa-enrollment',
        id: oryIdentityFlowId('settings', started.providerFlowId),
        method,
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        setup: { challenge: started.redirectUri },
      }, 201, started.setCookie);
    }
    return identityError('invalid_request', 'The identity route does not exist.', 404);
  } catch (error) {
    const status = error && typeof error === 'object'
      ? Reflect.get(error, 'status')
      : undefined;
    return identityError(
      status === 401 ? 'authentication_required' : 'provider_unavailable',
      status === 401
        ? 'Authentication is required.'
        : 'The identity provider is unavailable.',
      status === 401 ? 401 : 503,
      status !== 401,
    );
  }
}

function agenticIdentityPath(url: URL): readonly string[] {
  const prefix = '/__applik8s/v1/identity/';
  if (!url.pathname.startsWith(prefix)) return [];
  return url.pathname.slice(prefix.length).split('/').filter(Boolean)
    .map(decodeURIComponent);
}

function identitySession(
  principal: ApplicationPrincipal,
  trustedContext: Readonly<Record<string, JsonValue>> = {},
): ApplicationIdentitySessionView {
  return {
    protocol: applicationIdentityHttpProtocol,
    kind: 'session',
    authenticated: true,
    principal: {
      id: principal.id,
      identity: principal.identity,
      kind: principal.kind,
      authenticationMethod: principal.authenticationMethod,
      audience: [...principal.audience],
      admittedAt: principal.admittedAt,
      ...(principal.expiresAt ? { expiresAt: principal.expiresAt } : {}),
      ...(principal.sessionId ? { sessionId: principal.sessionId } : {}),
    },
    assurance: [],
    capabilities: {
      workspaceAdministration:
        principal.roles?.includes('workspace-owner') === true
        || principal.roles?.includes('workspace-administrator') === true,
      applicationOperations:
        principal.roles?.includes('application-operator') === true,
      workspaceSelection:
        typeof trustedContext.workspaceId === 'string' ? 'admitted' : 'none',
    },
  };
}

function anonymousIdentitySession(): ApplicationIdentitySessionView {
  return {
    protocol: applicationIdentityHttpProtocol,
    kind: 'session',
    authenticated: false,
    assurance: [],
  };
}

function identityAccount(
  principal: ApplicationPrincipal,
): ApplicationIdentityAccountView {
  return {
    protocol: applicationIdentityHttpProtocol,
    kind: 'account',
    identity: principal.identity,
    authenticationMethods: [principal.authenticationMethod],
    assurance: [],
    mfa: [],
    capabilities: {
      verification: true,
      recovery: true,
      mfaEnrollment: false,
      sessionRevocation: false,
    },
  };
}

function identityAccountFromOry(
  session: Awaited<ReturnType<OryKratosIdentityAdapter['session']>>,
): ApplicationIdentityAccountView {
  const methods = session.authenticationMethod.replace(/^ory:/u, '')
    .split('+')
    .filter(Boolean);
  return {
    protocol: applicationIdentityHttpProtocol,
    kind: 'account',
    identity: session.identity,
    authenticationMethods: methods,
    assurance: [...session.assurance],
    capabilities: {
      verification: true,
      recovery: true,
      mfaEnrollment: true,
      sessionRevocation: true,
    },
    mfa: methods
      .filter((method) => method === 'totp' || method === 'webauthn')
      .map((method) => ({
        id: `${session.sessionId}:${method}`,
        kind: method,
        label: method === 'totp' ? 'Authenticator app' : 'Security key',
        ...(session.authenticatedAt
          ? { createdAt: session.authenticatedAt }
          : {}),
      })),
  };
}

function identitySessionDevices(
  items: readonly ApplicationIdentitySessionDeviceView[],
): {
  readonly protocol: typeof applicationIdentityHttpProtocol;
  readonly kind: 'session-device-list';
  readonly items: readonly ApplicationIdentitySessionDeviceView[];
} {
  return {
    protocol: applicationIdentityHttpProtocol,
    kind: 'session-device-list',
    items,
  };
}

function starterIdentityFlow(kindValue: string | undefined): ApplicationIdentityFlowView {
  const kind = agenticIdentityFlowKind(kindValue);
  const now = new Date();
  return {
    protocol: applicationIdentityHttpProtocol,
    kind: 'flow',
    id: `starter~${kind}`,
    flowKind: kind,
    state: 'active',
    allowedTransitions: ['password'],
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
  };
}

function oryIdentityFlow(
  kind: 'register' | 'login' | 'verify' | 'recover' | 'settings',
  providerFlowId: string,
  continuationUri?: string,
): ApplicationIdentityFlowView {
  const now = new Date();
  return {
    protocol: applicationIdentityHttpProtocol,
    kind: 'flow',
    id: oryIdentityFlowId(kind, providerFlowId),
    flowKind: kind === 'settings' ? 'login' : kind,
    state: 'active',
    allowedTransitions:
      kind === 'verify' || kind === 'recover'
        ? ['code', 'link']
        : ['password', 'code', 'webauthn'],
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
    ...(continuationUri ? { continuationUri } : {}),
  };
}

function oryIdentityFlowId(kind: string, providerFlowId: string): string {
  return `${kind}~${providerFlowId}`;
}

function parsedOryIdentityFlow(value: string | undefined): {
  readonly kind: 'register' | 'login' | 'verify' | 'recover' | 'settings';
  readonly providerFlowId: string;
} {
  const [kindValue, providerFlowId, ...rest] =
    requiredIdentitySegment(value).split('~');
  if (rest.length > 0 || !providerFlowId) {
    throw new Error('Identity flow reference is malformed.');
  }
  const kind = kindValue === 'settings'
    ? 'settings'
    : agenticIdentityFlowKind(kindValue);
  return { kind, providerFlowId };
}

function agenticIdentityFlowKind(
  value: string | undefined,
): 'register' | 'login' | 'verify' | 'recover' {
  if (
    value === 'register'
    || value === 'login'
    || value === 'verify'
    || value === 'recover'
  ) return value;
  throw new Error('Identity flow kind is invalid.');
}

function agenticMfaMethod(
  value: unknown,
): 'totp' | 'webauthn' | 'recovery-code' | 'provider' {
  if (
    value === 'totp'
    || value === 'webauthn'
    || value === 'recovery-code'
    || value === 'provider'
  ) return value;
  throw new Error('MFA method is invalid.');
}

function requiredIdentitySegment(value: string | undefined): string {
  if (!value?.trim() || value.length > 512) {
    throw new Error('Identity path segment is invalid.');
  }
  return value;
}

async function identityRequestObject(
  request: Request,
): Promise<Readonly<Record<string, unknown>>> {
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > 128 * 1024) {
    throw new Error('Identity request is too large.');
  }
  if (bytes.byteLength === 0) return {};
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Identity request must be an object.');
  }
  // typecast: the object/array check proves a JSON record.
  return value as Readonly<Record<string, unknown>>;
}

function jsonIdentityInput(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, JsonValue>> {
  // The Ory transport validates provider payloads. JSON round-tripping drops
  // prototypes and rejects unsupported request values before forwarding.
  return JSON.parse(JSON.stringify(value)) as Readonly<Record<string, JsonValue>>;
}

function identityJson(
  value: unknown,
  status = 200,
  cookies: readonly string[] = [],
): Response {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  for (const cookie of cookies) headers.append('set-cookie', cookie);
  return new Response(JSON.stringify(value), { status, headers });
}

function identityError(
  code:
    | 'invalid_request'
    | 'authentication_required'
    | 'provider_unavailable',
  message: string,
  status: number,
  retryable = false,
): Response {
  return identityJson({
    protocol: applicationIdentityHttpProtocol,
    kind: 'error',
    code,
    message,
    retryable,
  }, status);
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
      AND workspace.state = 'active'
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
      throw new AgenticWorkspaceSelectorError(
        'Agentic workspace selector cookie is malformed.',
      );
    }
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      )
    ) {
      throw new AgenticWorkspaceSelectorError(
        'Agentic workspace selector must be a UUID.',
      );
    }
    return value.toLowerCase();
  }
  return undefined;
}

const starterIdentitySignedOutCookieName = 'applik8s_starter_signed_out';

function starterIdentitySignedOut(request: Request): boolean {
  return requestCookie(request, starterIdentitySignedOutCookieName) === '1';
}

function requestCookie(request: Request, name: string): string | undefined {
  const cookie = request.headers.get('cookie');
  if (!cookie) return undefined;
  for (const pair of cookie.split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 0 || pair.slice(0, separator).trim() !== name) continue;
    return pair.slice(separator + 1).trim();
  }
  return undefined;
}

function starterIdentitySessionCookie(request: Request, signedOut: boolean): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${starterIdentitySignedOutCookieName}=${signedOut ? '1' : ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${signedOut ? 31_536_000 : 0}${secure}`;
}

function isApplicationIdentitySessionRequest(request: Request): boolean {
  const url = new URL(request.url);
  return request.method === 'GET'
    && url.pathname === '/__applik8s/v1/identity/session';
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
  return createHash('sha256').update(canonicalJsonV1String(value)).digest('hex');
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
