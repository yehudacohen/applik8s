// typecast-file-boundary: Provider sessions are validated and normalized into the canonical authority-owned principal.
import { createHash } from 'node:crypto';
import { Authorization } from '@applik8s/applik8s';
import type { ApplicationPrincipal, JsonValue } from '@applik8s/core';

export interface ChirpRuntimeProfile {
  readonly profile: 'starter' | 'dedicated' | 'external';
  readonly identity: {
    readonly mode: 'deterministic-local' | 'ory' | 'zitadel';
    readonly issuer?: string;
    /** Ory Kratos whoami endpoint or Zitadel OIDC userinfo endpoint. */
    readonly sessionEndpoint?: string;
    readonly browserEndpoint?: string;
    /** Ory Keto relation-check endpoint. Zitadel decisions use admitted role claims. */
    readonly authorizationEndpoint?: string;
    readonly authorizationNamespace?: string;
    readonly authorizationVersion: string;
    readonly infrastructure: {
      readonly mode: 'external' | 'managed-local' | 'managed-production';
      readonly namespace: string;
      readonly deletionPolicy: 'retain' | 'delete';
    };
  };
}

interface IdentityFetchOptions {
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

/** Credential-free provider capability probe used by generated readiness. */
export async function probeConfiguredChirpIdentity(
  installation: ChirpRuntimeProfile,
  options: IdentityFetchOptions = {},
): Promise<void> {
  validateProfile(installation);
  if (installation.identity.mode === 'deterministic-local') {
    if (installation.profile !== 'starter') throw new Error('Deterministic local identity is restricted to the starter profile.');
    return;
  }
  const allowClusterHttp = installation.identity.mode === 'ory' && installation.identity.infrastructure.mode === 'managed-local';
  requiredHttpsUrl(installation.identity.issuer, 'identity issuer', allowClusterHttp);
  const endpoint = requiredHttpsUrl(installation.identity.sessionEndpoint, `${installation.identity.mode} session endpoint`, allowClusterHttp);
  const response = await boundedFetch(options.fetch ?? fetch, endpoint, { headers: { accept: 'application/json' } }, options.timeoutMs ?? 3_000, `${installation.identity.mode} identity readiness`);
  if (!response.ok && response.status !== 401 && response.status !== 403) throw new Error(`${installation.identity.mode} identity readiness returned HTTP ${response.status}.`);
  await providerJson(response, `${installation.identity.mode} identity readiness`);
}

/** Credential-free policy-provider capability probe used by generated readiness. */
export async function probeConfiguredChirpAuthorization(
  installation: ChirpRuntimeProfile,
  options: IdentityFetchOptions = {},
): Promise<void> {
  validateProfile(installation);
  if (installation.identity.mode !== 'ory') return;
  const endpoint = requiredHttpsUrl(
    installation.identity.authorizationEndpoint,
    'Ory Keto authorization endpoint',
    installation.identity.infrastructure.mode === 'managed-local',
  );
  endpoint.searchParams.set('namespace', installation.identity.authorizationNamespace?.trim() || 'ChirpReadiness');
  endpoint.searchParams.set('object', 'provider-capability');
  endpoint.searchParams.set('relation', 'read');
  endpoint.searchParams.set('subject_id', 'applik8s-readiness');
  const response = await boundedFetch(options.fetch ?? fetch, endpoint, { headers: { accept: 'application/json' } }, options.timeoutMs ?? 3_000, 'Ory Keto authorization readiness');
  const value = await providerJson(response, 'Ory Keto authorization readiness');
  if (!response.ok || typeof value.allowed !== 'boolean') throw new Error(`Ory Keto authorization readiness returned HTTP ${response.status} without a decision.`);
}

export async function probeChirpIdentity(): Promise<void> {
  await probeConfiguredChirpIdentity(runtimeProfile());
}

export async function probeChirpAuthorization(): Promise<void> {
  await probeConfiguredChirpAuthorization(runtimeProfile());
}

/**
 * Provider-neutral request admission used by every Chirp gateway. Provider
 * payloads are normalized here; no domain model, view, route, or component
 * observes an Ory or Zitadel response shape.
 */
export async function authenticateConfiguredChirpRequest(
  installation: ChirpRuntimeProfile,
  request: Request,
  options: IdentityFetchOptions = {},
) {
  validateProfile(installation);
  const identity = installation.identity;
  if (!identity.authorizationVersion?.trim()) throw new Error('Chirp identity requires an explicit authorization policy version.');

  if (identity.mode === 'deterministic-local') {
    if (installation.profile !== 'starter') throw new Error('Deterministic local identity is restricted to the starter profile.');
    const userId = request.headers.get('x-chirp-user')?.trim() || 'demo-user';
    const trustedContext = {};
    return {
      principal: admittedHumanPrincipal({
        provider: 'deterministic-local',
        issuer: 'chirp://deterministic-local',
        subject: userId,
        authenticationMethod: 'deterministic-starter',
        authorityRevision: identity.authorizationVersion,
        trustedContext,
      }),
      trustedContext,
    };
  }

  if (installation.profile === 'starter') throw new Error('The starter profile requires explicit deterministic-local identity mode.');
  const allowClusterHttp = identity.mode === 'ory' && identity.infrastructure.mode === 'managed-local';
  const issuer = requiredHttpsUrl(identity.issuer, 'identity issuer', allowClusterHttp);
  const sessionEndpoint = requiredHttpsUrl(identity.sessionEndpoint, `${identity.mode} session endpoint`, allowClusterHttp);
  const requestFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 3_000;
  return identity.mode === 'ory'
    ? authenticateOry(requestFetch, sessionEndpoint, issuer, identity.authorizationVersion, request, timeoutMs)
    : authenticateZitadel(requestFetch, sessionEndpoint, issuer, identity.authorizationVersion, request, timeoutMs);
}

export async function authenticateChirpRequest(request: Request) {
  return authenticateConfiguredChirpRequest(runtimeProfile(), request);
}

export const chirpAuthorization = Authorization.from(async ({ principal, action, resource }) => {
  const installation = runtimeProfile();
  validateProfile(installation);
  const identity = installation.identity;
  const version = identity.authorizationVersion;
  if (!version?.trim()) throw new Error('Chirp authorization provider has no policy version.');
  if (!principal.id) return { allowed: false, version, reason: 'Anonymous principals are denied.' };

  if (identity.mode === 'deterministic-local') {
    if (installation.profile !== 'starter') throw new Error('Deterministic local authorization is restricted to the starter profile.');
    return {
      allowed: resource?.id === undefined || principal.identity.subject === resource.id || action.endsWith('.read') || principal.identity.subject === 'demo-user',
      version,
      reason: 'Deterministic local policy.',
    };
  }

  if (identity.mode === 'ory' && resource?.id !== undefined) {
    const endpoint = requiredHttpsUrl(
      identity.authorizationEndpoint,
      'Ory Keto authorization endpoint',
      identity.infrastructure.mode === 'managed-local',
    );
    const url = new URL(endpoint);
    url.searchParams.set('namespace', identity.authorizationNamespace?.trim() || resource.kind);
    url.searchParams.set('object', resource.id);
    url.searchParams.set('relation', action);
    url.searchParams.set('subject_id', principal.id);
    const response = await boundedFetch(fetch, url, { headers: { accept: 'application/json' } }, 3_000, 'Ory Keto authorization');
    const value = await providerJson(response, 'Ory Keto authorization');
    return {
      allowed: response.ok && value.allowed === true,
      version: response.headers.get('etag')?.trim() || version,
      reason: response.ok && value.allowed === true ? 'Ory Keto relation allowed.' : 'Ory Keto relation denied.',
    };
  }

  const allowed = resource?.id === undefined
    || principal.identity.subject === resource.id
    || action.endsWith('.read');
  return {
    allowed,
    version,
    reason: identity.mode === 'ory' ? 'Ory identity admitted; application policy owns this unscoped decision.' : 'Zitadel identity admitted; product roles require canonical application grants.',
  };
}, { ready: probeChirpAuthorization });

async function authenticateOry(
  requestFetch: typeof fetch,
  endpoint: URL,
  issuer: URL,
  policyVersion: string,
  request: Request,
  timeoutMs: number,
) {
  const headers = forwardedSessionHeaders(request);
  const response = await boundedFetch(requestFetch, endpoint, { headers }, timeoutMs, 'Ory Kratos session');
  const value = await providerJson(response, 'Ory Kratos session');
  const identity = record(value.identity);
  const subject = string(identity.id);
  if (!response.ok || value.active === false || !subject) throw new Error('Ory Kratos did not admit an active authenticated session.');
  const sessionId = string(value.id);
  const sessionVersion = string(identity.updated_at) || string(value.authenticated_at) || sessionId || 'active';
  const trustedContext = {};
  return {
    principal: admittedHumanPrincipal({
      provider: 'ory',
      issuer: issuer.href.replace(/\/$/, ''),
      subject,
      authenticationMethod: 'ory-kratos-session',
      authorityRevision: `${policyVersion}:${sessionVersion}`,
      trustedContext,
      ...(sessionId ? { sessionId } : {}),
    }),
    trustedContext,
  };
}

async function authenticateZitadel(
  requestFetch: typeof fetch,
  endpoint: URL,
  issuer: URL,
  policyVersion: string,
  request: Request,
  timeoutMs: number,
) {
  const authorization = request.headers.get('authorization')?.trim();
  if (!authorization?.toLowerCase().startsWith('bearer ')) throw new Error('Zitadel identity requires a bearer session token.');
  const response = await boundedFetch(requestFetch, endpoint, { headers: { accept: 'application/json', authorization } }, timeoutMs, 'Zitadel OIDC userinfo');
  const value = await providerJson(response, 'Zitadel OIDC userinfo');
  const subject = string(value.sub);
  const responseIssuer = string(value.iss);
  const expectedIssuer = issuer.href.replace(/\/$/, '');
  if (!response.ok || !subject || (responseIssuer && responseIssuer.replace(/\/$/, '') !== expectedIssuer)) {
    throw new Error('Zitadel did not admit a valid subject for the configured issuer.');
  }
  const sessionVersion = string(value.updated_at) || string(value.auth_time) || string(value.iat) || 'active';
  const trustedContext = {};
  return {
    principal: admittedHumanPrincipal({
      provider: 'zitadel',
      issuer: expectedIssuer,
      subject,
      authenticationMethod: 'oidc-bearer',
      authorityRevision: `${policyVersion}:${sessionVersion}`,
      trustedContext,
    }),
    trustedContext,
  };
}

function runtimeProfile(): ChirpRuntimeProfile {
  const encoded = process.env.APPLIK8S_INSTALLATION_SPEC;
  if (!encoded) throw new Error('Chirp runtime requires APPLIK8S_INSTALLATION_SPEC.');
  const installation = JSON.parse(encoded) as ChirpRuntimeProfile;
  validateProfile(installation);
  return installation;
}

function validateProfile(installation: ChirpRuntimeProfile): void {
  if (!['starter', 'dedicated', 'external'].includes(installation.profile)) throw new Error('Chirp runtime installation profile is invalid.');
  if (!['deterministic-local', 'ory', 'zitadel'].includes(installation.identity?.mode)) throw new Error('Chirp runtime identity provider is invalid.');
  if (!['external', 'managed-local', 'managed-production'].includes(installation.identity.infrastructure?.mode)) {
    throw new Error('Chirp runtime identity infrastructure mode is invalid.');
  }
  if (installation.identity.mode !== 'ory' && installation.identity.infrastructure.mode !== 'external') {
    throw new Error('Only the Ory identity adapter can own managed identity infrastructure.');
  }
  if (installation.identity.infrastructure.mode === 'managed-local' && installation.profile !== 'dedicated') {
    throw new Error('Managed-local Ory identity is restricted to the dedicated local qualification profile.');
  }
}

function requiredHttpsUrl(value: string | undefined, label: string, allowClusterHttp = false): URL {
  if (!value?.trim()) throw new Error(`Chirp ${label} is required.`);
  const url = new URL(value);
  if (url.protocol !== 'https:' && !isLoopback(url.hostname) && !(allowClusterHttp && isClusterLocal(url.hostname))) {
    throw new Error(`Chirp ${label} must use HTTPS outside loopback or an explicitly managed local cluster identity network.`);
  }
  return url;
}

function isLoopback(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === '::1' || hostname === 'localhost';
}

function isClusterLocal(hostname: string): boolean {
  return hostname.endsWith('.svc') || hostname.endsWith('.svc.cluster.local');
}

function forwardedSessionHeaders(request: Request): Headers {
  const headers = new Headers({ accept: 'application/json' });
  const cookie = request.headers.get('cookie');
  const authorization = request.headers.get('authorization');
  if (cookie) headers.set('cookie', cookie);
  if (authorization) headers.set('authorization', authorization);
  return headers;
}

async function boundedFetch(
  requestFetch: typeof fetch,
  input: URL,
  init: RequestInit,
  timeoutMs: number,
  label: string,
): Promise<Response> {
  try {
    return await requestFetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new Error(`${label} request failed closed.`, { cause: error });
  }
}

async function providerJson(response: Response, label: string): Promise<Record<string, unknown>> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) throw new Error(`${label} returned a non-JSON response.`);
  try {
    return record(await response.json());
  } catch (error) {
    throw new Error(`${label} returned invalid JSON.`, { cause: error });
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function admittedHumanPrincipal(input: {
  readonly provider: string;
  readonly issuer: string;
  readonly subject: string;
  readonly authenticationMethod: string;
  readonly authorityRevision: string;
  readonly trustedContext: Readonly<Record<string, JsonValue>>;
  readonly sessionId?: string;
}): ApplicationPrincipal {
  const catalogRevision = process.env.APPLIK8S_OPERATION_CATALOG_REVISION?.trim() || 'chirp-catalog-v1';
  return {
    id: `principal:chirp:${input.provider}:${input.subject}`,
    identity: {
      id: `identity:${input.provider}:${input.subject}`,
      kind: 'human',
      issuer: input.issuer,
      subject: input.subject,
    },
    kind: 'human',
    authenticationMethod: input.authenticationMethod,
    audience: ['chirp'],
    trustedContextDigest: createHash('sha256').update(JSON.stringify(input.trustedContext)).digest('hex'),
    catalogRevision,
    authorityRevision: input.authorityRevision,
    admittedAt: new Date().toISOString(),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
  };
}
