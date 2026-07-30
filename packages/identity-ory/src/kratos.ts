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
  readonly authenticatedAt?: string;
  readonly issuedAt?: string;
  readonly expiresAt?: string;
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
    ...(authenticatedAt ? { authenticatedAt } : {}),
    ...(issuedAt ? { issuedAt } : {}),
    ...(expiresAt ? { expiresAt } : {}),
  };
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
