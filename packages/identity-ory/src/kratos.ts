import type {
  ApplicationIdentityReference,
  ApplicationPrincipal,
  JsonValue,
} from '@applik8s/core';
import type {
  ApplicationIdentityProviderAdapter,
  ApplicationProviderAuthenticationCompletion,
} from '@applik8s/identity';
import {
  normalizedOryBaseUrl,
  OryAdapterError,
  OryHttpTransport,
  type OryHttpTransportOptions,
  optionalOryString,
  requiredOryString,
} from './transport.js';

export interface OryKratosAdapterOptions extends OryHttpTransportOptions {
  readonly publicUrl: string;
  readonly adminUrl: string;
  readonly issuer: string;
  readonly allowNativeSessionToken?: boolean;
}

export interface OryKratosAdmissionContext {
  readonly application: string;
  readonly catalogRevision: string;
  readonly authorityRevision: string;
  readonly trustedContextDigest: string;
  readonly audience: readonly string[];
  readonly now?: Date;
}

export interface OryKratosSessionEvidence {
  readonly sessionId: string;
  readonly identity: ApplicationIdentityReference;
  readonly active: true;
  readonly authenticationMethod: string;
  readonly assurance: readonly string[];
  /** Roles derived only from the provider-verified Kratos identity. */
  readonly roles: readonly string[];
  readonly authenticatedAt?: string;
  readonly issuedAt?: string;
  readonly expiresAt?: string;
}

export type OryKratosFlowKind =
  | 'register'
  | 'login'
  | 'verify'
  | 'recover'
  | 'settings';

export interface OryKratosBrowserFlowStart {
  readonly kind: OryKratosFlowKind;
  readonly providerFlowId: string;
  readonly redirectUri: string;
  readonly setCookie: readonly string[];
}

export interface OryKratosFlowResult {
  readonly kind: OryKratosFlowKind;
  readonly providerFlowId: string;
  readonly state: 'active' | 'complete' | 'expired';
  readonly flow?: Readonly<Record<string, unknown>>;
  readonly redirectUri?: string;
  readonly setCookie: readonly string[];
}

export class OryKratosIdentityAdapter
  implements ApplicationIdentityProviderAdapter
{
  readonly name = 'ory-kratos';
  readonly #publicUrl: URL;
  readonly #adminUrl: URL;
  readonly #issuer: string;
  readonly #allowNativeSessionToken: boolean;
  readonly #transport: OryHttpTransport;

  constructor(options: OryKratosAdapterOptions) {
    this.#publicUrl = normalizedOryBaseUrl(
      options.publicUrl,
      'Ory Kratos publicUrl',
    );
    this.#adminUrl = normalizedOryBaseUrl(
      options.adminUrl,
      'Ory Kratos adminUrl',
    );
    this.#issuer = normalizedIssuer(options.issuer);
    this.#allowNativeSessionToken = options.allowNativeSessionToken ?? false;
    this.#transport = new OryHttpTransport(options);
  }

  async authenticate(
    request: Request,
    context: OryKratosAdmissionContext,
  ): Promise<ApplicationPrincipal> {
    const evidence = await this.session(request);
    const now = context.now ?? new Date();
    if (evidence.expiresAt && Date.parse(evidence.expiresAt) <= now.getTime()) {
      throw new OryAdapterError(
        'ORY_UNAUTHORIZED',
        'Ory session has expired.',
        401,
      );
    }
    return {
      id: `principal:${context.application}:ory:${evidence.identity.subject}`,
      identity: evidence.identity,
      kind: evidence.identity.kind,
      authenticationMethod: evidence.authenticationMethod,
      audience: [...context.audience],
      trustedContextDigest: context.trustedContextDigest,
      catalogRevision: context.catalogRevision,
      authorityRevision: context.authorityRevision,
      admittedAt: now.toISOString(),
      ...(evidence.roles.length > 0 ? { roles: evidence.roles } : {}),
      ...(evidence.expiresAt ? { expiresAt: evidence.expiresAt } : {}),
      sessionId: evidence.sessionId,
    };
  }

  async session(request: Request): Promise<OryKratosSessionEvidence> {
    const headers = new Headers({ accept: 'application/json' });
    const cookie = request.headers.get('cookie');
    if (cookie) headers.set('cookie', cookie);
    const sessionToken = request.headers.get('x-session-token');
    if (sessionToken) {
      if (!this.#allowNativeSessionToken) {
        throw new OryAdapterError(
          'ORY_UNAUTHORIZED',
          'Native Ory session tokens are disabled on this admission boundary.',
          401,
        );
      }
      headers.set('x-session-token', sessionToken);
    }
    if (!cookie && !sessionToken) {
      throw new OryAdapterError(
        'ORY_UNAUTHORIZED',
        'Ory session credential is missing.',
        401,
      );
    }
    const { json } = await this.#transport.request(
      new URL('sessions/whoami', this.#publicUrl),
      { headers },
    );
    if (!json) {
      throw new OryAdapterError(
        'ORY_RESPONSE_INVALID',
        'Ory session response is empty.',
      );
    }
    return normalizedKratosSession(json, this.#issuer);
  }

  /**
   * Starts a browser flow while keeping provider cookies and native flow
   * payloads inside the adapter boundary.
   */
  async beginBrowserFlow(
    kind: OryKratosFlowKind,
    options: {
      readonly returnTo?: string;
      readonly cookie?: string;
      readonly refresh?: boolean;
      readonly aal?: 'aal1' | 'aal2';
      readonly signal?: AbortSignal;
    } = {},
  ): Promise<OryKratosBrowserFlowStart> {
    const url = new URL(`self-service/${kratosFlowPath(kind)}/browser`, this.#publicUrl);
    if (options.returnTo) url.searchParams.set('return_to', safeReturnTo(options.returnTo));
    if (options.refresh) url.searchParams.set('refresh', 'true');
    if (options.aal) url.searchParams.set('aal', options.aal);
    const { response, json } = await this.#transport.request(
      url,
      {
        headers: {
          accept: 'application/json',
          ...(options.cookie ? { cookie: options.cookie } : {}),
        },
        ...(options.signal ? { signal: options.signal } : {}),
      },
      [200, 303],
    );
    const location = response.headers.get('location');
    const redirectUri = location ?? optionalOryString(json?.request_url, 'flow.request_url');
    const providerFlowId = optionalOryString(json?.id, 'flow.id')
      ?? flowIdFromRedirect(redirectUri);
    if (!redirectUri) {
      throw new OryAdapterError('ORY_RESPONSE_INVALID', 'Ory browser flow has no redirect URI.');
    }
    return {
      kind,
      providerFlowId,
      redirectUri,
      setCookie: responseCookies(response.headers),
    };
  }

  async flow(
    kind: OryKratosFlowKind,
    providerFlowId: string,
    options: { readonly cookie?: string; readonly signal?: AbortSignal } = {},
  ): Promise<OryKratosFlowResult> {
    const flowId = requiredPathSegment(providerFlowId, 'flow ID');
    const url = new URL(`self-service/${kratosFlowPath(kind)}/flows`, this.#publicUrl);
    url.searchParams.set('id', flowId);
    const { response, json } = await this.#transport.request(url, {
      headers: {
        accept: 'application/json',
        ...(options.cookie ? { cookie: options.cookie } : {}),
      },
      ...(options.signal ? { signal: options.signal } : {}),
    }, [200, 410]);
    return {
      kind,
      providerFlowId: flowId,
      state: response.status === 410 ? 'expired' : 'active',
      ...(json ? { flow: json } : {}),
      setCookie: responseCookies(response.headers),
    };
  }

  async submitFlow(
    kind: OryKratosFlowKind,
    providerFlowId: string,
    input: Readonly<Record<string, JsonValue>>,
    options: { readonly cookie?: string; readonly signal?: AbortSignal } = {},
  ): Promise<OryKratosFlowResult> {
    const flowId = requiredPathSegment(providerFlowId, 'flow ID');
    const url = new URL(`self-service/${kratosFlowPath(kind)}`, this.#publicUrl);
    url.searchParams.set('flow', flowId);
    const { response, json } = await this.#transport.request(url, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...(options.cookie ? { cookie: options.cookie } : {}),
      },
      body: JSON.stringify(input),
      ...(options.signal ? { signal: options.signal } : {}),
    }, [200, 303, 400, 410, 422]);
    const redirectUri = response.headers.get('location') ?? undefined;
    return {
      kind,
      providerFlowId: flowId,
      state: response.status === 303 || (kind === 'settings' && response.status === 200 && Boolean(json?.identity))
        ? 'complete'
        : response.status === 410
          ? 'expired'
          : 'active',
      ...(json ? { flow: json } : {}),
      ...(redirectUri ? { redirectUri } : {}),
      setCookie: responseCookies(response.headers),
    };
  }

  async browserLogout(
    request: Request,
    options: { readonly returnTo?: string; readonly signal?: AbortSignal } = {},
  ): Promise<{ readonly redirectUri: string; readonly setCookie: readonly string[] }> {
    const cookie = request.headers.get('cookie');
    if (!cookie) throw new OryAdapterError('ORY_UNAUTHORIZED', 'Ory session credential is missing.', 401);
    const url = new URL('self-service/logout/browser', this.#publicUrl);
    if (options.returnTo) url.searchParams.set('return_to', safeReturnTo(options.returnTo));
    const { response, json } = await this.#transport.request(url, {
      headers: { accept: 'application/json', cookie },
      ...(options.signal ? { signal: options.signal } : {}),
    }, [200, 303]);
    const redirectUri = response.headers.get('location')
      ?? optionalOryString(json?.logout_url, 'logout.logout_url');
    if (!redirectUri) throw new OryAdapterError('ORY_RESPONSE_INVALID', 'Ory logout response has no redirect URI.');
    return { redirectUri, setCookie: responseCookies(response.headers) };
  }

  providerCompletion(
    providerFlowId: string,
    session: OryKratosSessionEvidence,
  ): ApplicationProviderAuthenticationCompletion {
    return {
      provider: this.name,
      providerFlowId,
      providerSessionId: session.sessionId,
      providerIdentity: session.identity,
      authenticationMethod: session.authenticationMethod,
      assurance: [...session.assurance],
      completedAt:
        session.authenticatedAt ?? session.issuedAt ?? new Date().toISOString(),
      ...(session.expiresAt ? { expiresAt: session.expiresAt } : {}),
      evidence: {
        active: true,
        ...(session.issuedAt ? { issuedAt: session.issuedAt } : {}),
      },
    };
  }

  async revokeSession(
    providerSessionId: string,
    reason: string,
  ): Promise<Readonly<Record<string, JsonValue>>> {
    const sessionId = requiredPathSegment(providerSessionId, 'session ID');
    await this.#transport.request(
      new URL(`admin/sessions/${sessionId}`, this.#adminUrl),
      {
        method: 'DELETE',
        headers: {
          accept: 'application/json',
          'x-applik8s-revocation-reason': encodeURIComponent(reason).slice(0, 512),
        },
      },
      [204],
    );
    return { revoked: true, sessionId };
  }

  async sessionState(
    providerSessionId: string,
  ): Promise<'active' | 'revoked' | 'expired' | 'unknown'> {
    const sessionId = requiredPathSegment(providerSessionId, 'session ID');
    try {
      const { json } = await this.#transport.request(
        new URL(`admin/sessions/${sessionId}`, this.#adminUrl),
        { headers: { accept: 'application/json' } },
      );
      if (!json) return 'unknown';
      if (json.active === true) {
        const expiresAt = optionalOryString(json.expires_at, 'session.expires_at');
        return expiresAt && Date.parse(expiresAt) <= Date.now()
          ? 'expired'
          : 'active';
      }
      return 'revoked';
    } catch (error) {
      if (
        error instanceof OryAdapterError
        && (error.status === 404 || error.status === 410)
      ) {
        return 'expired';
      }
      throw error;
    }
  }

  async ready(): Promise<void> {
    await Promise.all([
      this.#transport.request(
        new URL('health/ready', this.#publicUrl),
        { headers: { accept: 'application/json' } },
        [200],
      ),
      this.#transport.request(
        new URL('health/ready', this.#adminUrl),
        { headers: { accept: 'application/json' } },
        [200],
      ),
    ]);
  }
}

function normalizedKratosSession(
  value: Readonly<Record<string, unknown>>,
  issuer: string,
): OryKratosSessionEvidence {
  if (value.active !== true) {
    throw new OryAdapterError(
      'ORY_UNAUTHORIZED',
      'Ory session is inactive.',
      401,
    );
  }
  const identityValue = value.identity;
  if (
    !identityValue
    || typeof identityValue !== 'object'
    || Array.isArray(identityValue)
  ) {
    throw new OryAdapterError(
      'ORY_RESPONSE_INVALID',
      'Ory session has no identity.',
    );
  }
  // typecast: the provider payload boundary above proves identity is a non-array record.
  const identity = identityValue as Readonly<Record<string, unknown>>;
  const subject = requiredOryString(identity.id, 'session.identity.id');
  const methodsValue = value.authentication_methods;
  const methods = Array.isArray(methodsValue)
    ? methodsValue.flatMap((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
        const method = Reflect.get(entry, 'method');
        return typeof method === 'string' && method.trim() ? [method] : [];
      })
    : [];
  const aal =
    optionalOryString(
      value.authenticator_assurance_level,
      'session.authenticator_assurance_level',
    ) ?? 'aal1';
  const authenticatedAt = optionalOryString(
    value.authenticated_at,
    'session.authenticated_at',
  );
  const issuedAt = optionalOryString(value.issued_at, 'session.issued_at');
  const expiresAt = optionalOryString(value.expires_at, 'session.expires_at');
  const roles = normalizedKratosRoles(identity);
  return {
    sessionId: requiredOryString(value.id, 'session.id'),
    identity: {
      id: `identity:ory:${subject}`,
      kind: 'human',
      issuer,
      subject,
    },
    active: true,
    authenticationMethod:
      methods.length > 0 ? `ory:${methods.join('+')}` : 'ory:session',
    assurance: [aal, ...methods.map((method) => `amr:${method}`)],
    roles,
    ...(authenticatedAt ? { authenticatedAt } : {}),
    ...(issuedAt ? { issuedAt } : {}),
    ...(expiresAt ? { expiresAt } : {}),
  };
}

function normalizedKratosRoles(
  identity: Readonly<Record<string, unknown>>,
): readonly string[] {
  const sources = [identity.metadata_public, identity.traits];
  const roles: string[] = [];
  for (const source of sources) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    const value = Reflect.get(source, 'roles') ?? Reflect.get(source, 'role');
    if (value === undefined) continue;
    const candidates = typeof value === 'string' ? [value] : value;
    if (!Array.isArray(candidates)) {
      throw new OryAdapterError(
        'ORY_RESPONSE_INVALID',
        'Ory identity roles must be a string or string array.',
      );
    }
    for (const candidate of candidates) {
      if (
        typeof candidate !== 'string'
        || !candidate.trim()
        || candidate.length > 128
        || /[\s?#]/u.test(candidate)
      ) {
        throw new OryAdapterError(
          'ORY_RESPONSE_INVALID',
          'Ory identity contains an invalid application role.',
        );
      }
      roles.push(candidate.trim());
    }
  }
  return [...new Set(roles)].sort();
}

function normalizedIssuer(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
    throw new Error('Ory identity issuer must use HTTPS outside localhost.');
  }
  return url.toString().replace(/\/$/u, '');
}

function requiredPathSegment(value: string, field: string): string {
  if (!value.trim() || encodeURIComponent(value) !== value) {
    throw new Error(`Ory ${field} must be one URL-safe path segment.`);
  }
  return value;
}

function kratosFlowPath(kind: OryKratosFlowKind): string {
  switch (kind) {
    case 'register': return 'registration';
    case 'verify': return 'verification';
    case 'recover': return 'recovery';
    case 'login':
    case 'settings': return kind;
  }
}

function safeReturnTo(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1'))) {
    throw new Error('Ory returnTo must use HTTPS outside loopback.');
  }
  if (url.username || url.password) throw new Error('Ory returnTo must not contain credentials.');
  return url.toString();
}

function flowIdFromRedirect(value: string | undefined): string {
  if (!value) throw new OryAdapterError('ORY_RESPONSE_INVALID', 'Ory browser flow has no identity.');
  const flowId = new URL(value).searchParams.get('flow');
  if (!flowId) throw new OryAdapterError('ORY_RESPONSE_INVALID', 'Ory browser flow redirect has no flow identity.');
  return requiredPathSegment(flowId, 'flow ID');
}

function responseCookies(headers: Headers): readonly string[] {
  // typecast: Bun/Undici expose getSetCookie beyond the standard Headers surface; the fallback preserves portability.
  const bunHeaders = headers as Headers & { readonly getSetCookie?: () => string[] };
  const cookies = bunHeaders.getSetCookie?.();
  if (cookies && cookies.length > 0) return cookies;
  const single = headers.get('set-cookie');
  return single ? [single] : [];
}
