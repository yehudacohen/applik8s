import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type {
  ApplicationOAuthClient,
  ApplicationOAuthClientProvisioning,
  ApplicationOAuthAuthorizationProviderAdapter,
  ApplicationOAuthProtocolProviderAdapter,
  ApplicationOAuthProviderDecision,
  ApplicationOAuthTokenClientAuthentication,
  ApplicationOAuthTokenIntrospection,
  ApplicationOAuthTokenRequest,
  ApplicationOAuthTokenSet,
} from '@applik8s/identity';
import {
  normalizedOryBaseUrl,
  OryAdapterError,
  OryHttpTransport,
  type OryHttpTransportOptions,
  oryStringArray,
  requiredOryString,
} from './transport.js';

export interface OryHydraAdapterOptions extends OryHttpTransportOptions {
  readonly adminUrl: string;
  readonly publicUrl: string;
}

export class OryHydraOAuthAdapter
  implements ApplicationOAuthProtocolProviderAdapter
{
  readonly name = 'ory-hydra';
  readonly #adminUrl: URL;
  readonly #publicUrl: URL;
  readonly #publicOrigin: string;
  readonly #transport: OryHttpTransport;

  constructor(options: OryHydraAdapterOptions) {
    this.#adminUrl = normalizedOryBaseUrl(
      options.adminUrl,
      'Ory Hydra adminUrl',
    );
    this.#publicUrl = normalizedOryBaseUrl(
      options.publicUrl,
      'Ory Hydra publicUrl',
    );
    this.#publicOrigin = this.#publicUrl.origin;
    this.#transport = new OryHttpTransport(options);
  }

  async decide(input: {
    readonly flow: Parameters<
      ApplicationOAuthAuthorizationProviderAdapter['decide']
    >[0]['flow'];
    readonly decision: 'approve' | 'deny';
    readonly idempotencyKey: string;
  }): Promise<ApplicationOAuthProviderDecision> {
    const challenge = requiredChallenge(
      input.flow.providerAuthorizationRequestId,
    );
    const request = await this.#consentRequest(challenge);
    assertConsentRequest(input.flow, request);
    const endpoint = input.decision === 'approve'
      ? 'admin/oauth2/auth/requests/consent/accept'
      : 'admin/oauth2/auth/requests/consent/reject';
    const url = new URL(endpoint, this.#adminUrl);
    url.searchParams.set('consent_challenge', challenge);
    const body = input.decision === 'approve'
      ? {
          grant_scope: [...input.flow.scopes],
          grant_access_token_audience: [...input.flow.audience],
          remember: false,
          context: {
            applik8s_flow_id: input.flow.id,
            applik8s_client_revision: input.flow.clientRevision,
          },
        }
      : {
          error: 'access_denied',
          error_description: 'The resource owner denied this request.',
          status_code: 403,
        };
    const { json } = await this.#transport.request(url, {
      method: 'PUT',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'idempotency-key': input.idempotencyKey,
      },
      body: JSON.stringify(body),
    });
    if (!json) {
      throw new OryAdapterError(
        'ORY_RESPONSE_INVALID',
        'Ory Hydra consent decision response is empty.',
      );
    }
    const continuationUri = requiredOryString(
      json.redirect_to,
      'consent.redirect_to',
    );
    const continuation = new URL(continuationUri);
    if (continuation.origin !== this.#publicOrigin) {
      throw new OryAdapterError(
        'ORY_RESPONSE_INVALID',
        `Ory Hydra returned continuation origin ${continuation.origin}, expected ${this.#publicOrigin}.`,
      );
    }
    return {
      id: `ory_hydra_consent_${createHash('sha256')
        .update(challenge)
        .update('\0')
        .update(input.decision)
        .digest('base64url')}`,
      providerAuthorizationRequestId: challenge,
      accepted: input.decision === 'approve',
      continuationUri: continuation.toString(),
      evidence: {
        provider: 'ory-hydra',
        consentRequestId:
          typeof request.consent_request_id === 'string'
            ? request.consent_request_id
            : challenge,
      },
    };
  }

  async provisionClient(
    input: ApplicationOAuthClientProvisioning,
  ): Promise<ApplicationOAuthClient> {
    const client = normalizedApplicationClient(input.client);
    if ((client.type === 'confidential' || client.type === 'service') && !input.secret?.trim()) {
      throw new Error(`OAuth client ${client.id} requires an explicit secret.`);
    }
    const { json } = await this.#transport.request(
      new URL('admin/clients', this.#adminUrl),
      {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(hydraClientBody(client, input.name, input.secret)),
      },
      [200, 201],
    );
    if (!json) throw new OryAdapterError('ORY_RESPONSE_INVALID', 'Ory Hydra client response is empty.');
    return normalizedHydraClient(json);
  }

  async client(clientId: string): Promise<ApplicationOAuthClient | undefined> {
    const id = requiredClientId(clientId);
    try {
      const { json } = await this.#transport.request(
        new URL(`admin/clients/${id}`, this.#adminUrl),
        { headers: { accept: 'application/json' } },
      );
      if (!json) throw new OryAdapterError('ORY_RESPONSE_INVALID', 'Ory Hydra client response is empty.');
      return normalizedHydraClient(json);
    } catch (error) {
      if (error instanceof OryAdapterError && error.status === 404) return undefined;
      throw error;
    }
  }

  async rotateClient(
    input: ApplicationOAuthClientProvisioning & { readonly secret: string },
  ): Promise<ApplicationOAuthClient> {
    const client = normalizedApplicationClient(input.client);
    const id = requiredClientId(client.id);
    const { json } = await this.#transport.request(
      new URL(`admin/clients/${id}`, this.#adminUrl),
      {
        method: 'PUT',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(hydraClientBody(client, input.name, input.secret)),
      },
    );
    if (!json) throw new OryAdapterError('ORY_RESPONSE_INVALID', 'Ory Hydra rotated client response is empty.');
    return normalizedHydraClient(json);
  }

  async revokeClient(clientId: string): Promise<void> {
    await this.#transport.request(
      new URL(`admin/clients/${requiredClientId(clientId)}`, this.#adminUrl),
      { method: 'DELETE', headers: { accept: 'application/json' } },
      [204],
    );
  }

  async issueToken(request: ApplicationOAuthTokenRequest): Promise<ApplicationOAuthTokenSet> {
    const form = new URLSearchParams({ grant_type: request.grantType });
    switch (request.grantType) {
      case 'authorization_code':
        form.set('code', requiredSecret(request.code, 'authorization code'));
        form.set('redirect_uri', normalizedRedirectUri(request.redirectUri));
        form.set('code_verifier', requiredSecret(request.codeVerifier, 'PKCE code verifier'));
        break;
      case 'refresh_token':
        form.set('refresh_token', requiredSecret(request.refreshToken, 'refresh token'));
        if (request.scopes) form.set('scope', normalizedStringList(request.scopes, 'refresh scopes').join(' '));
        break;
      case 'client_credentials':
        form.set('scope', normalizedStringList(request.scopes, 'client credential scopes').join(' '));
        break;
    }
    for (const resource of request.resources ?? []) form.append('resource', normalizedAbsoluteUri(resource, 'resource'));
    for (const audience of request.audience ?? []) form.append('audience', requiredSecret(audience, 'audience'));
    const { json } = await this.#transport.request(
      new URL('oauth2/token', this.#publicUrl),
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded',
          ...clientAuthorization(request.client, form),
        },
        body: form.toString(),
      },
    );
    if (!json) throw new OryAdapterError('ORY_RESPONSE_INVALID', 'Ory Hydra token response is empty.');
    return normalizedHydraTokenSet(json);
  }

  async introspectToken(token: string): Promise<ApplicationOAuthTokenIntrospection> {
    const form = new URLSearchParams({ token: requiredSecret(token, 'token') });
    const { json } = await this.#transport.request(
      new URL('admin/oauth2/introspect', this.#adminUrl),
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      },
    );
    if (!json) throw new OryAdapterError('ORY_RESPONSE_INVALID', 'Ory Hydra introspection response is empty.');
    return normalizedHydraIntrospection(json);
  }

  async revokeToken(
    token: string,
    client: ApplicationOAuthTokenClientAuthentication,
    hint?: 'access_token' | 'refresh_token',
  ): Promise<void> {
    const form = new URLSearchParams({ token: requiredSecret(token, 'token') });
    if (hint) form.set('token_type_hint', hint);
    await this.#transport.request(
      new URL('oauth2/revoke', this.#publicUrl),
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded',
          ...clientAuthorization(client, form),
        },
        body: form.toString(),
      },
      [200, 204],
    );
  }

  async ready(): Promise<void> {
    await this.#transport.request(
      new URL('health/ready', this.#adminUrl),
      { headers: { accept: 'application/json' } },
      [200],
    );
  }

  async #consentRequest(
    challenge: string,
  ): Promise<Readonly<Record<string, unknown>>> {
    const url = new URL(
      'admin/oauth2/auth/requests/consent',
      this.#adminUrl,
    );
    url.searchParams.set('consent_challenge', challenge);
    const { json } = await this.#transport.request(url, {
      headers: { accept: 'application/json' },
    });
    if (!json) {
      throw new OryAdapterError(
        'ORY_RESPONSE_INVALID',
        'Ory Hydra consent request is empty.',
      );
    }
    return json;
  }
}

function assertConsentRequest(
  flow: Parameters<
    ApplicationOAuthAuthorizationProviderAdapter['decide']
  >[0]['flow'],
  request: Readonly<Record<string, unknown>>,
): void {
  const challenge = requiredOryString(request.challenge, 'consent.challenge');
  const subject = requiredOryString(request.subject, 'consent.subject');
  const clientValue = request.client;
  if (!clientValue || typeof clientValue !== 'object' || Array.isArray(clientValue)) {
    throw new OryAdapterError(
      'ORY_RESPONSE_INVALID',
      'Ory Hydra consent request has no client.',
    );
  }
  const clientId = requiredOryString(
    Reflect.get(clientValue, 'client_id'),
    'consent.client.client_id',
  );
  const scopes = oryStringArray(request.requested_scope, 'consent.requested_scope');
  const audience = oryStringArray(
    request.requested_access_token_audience,
    'consent.requested_access_token_audience',
  );
  if (
    challenge !== flow.providerAuthorizationRequestId
    || subject !== flow.resourceOwner.subject
    || clientId !== flow.clientId
    || !sameSet(scopes, flow.scopes)
    || !sameSet(audience, flow.audience)
  ) {
    throw new OryAdapterError(
      'ORY_REQUEST_REJECTED',
      `Ory Hydra consent request does not match bound flow ${flow.id}.`,
    );
  }
}

function requiredChallenge(value: string): string {
  if (!value.trim() || value.length > 4096) {
    throw new Error('Ory Hydra consent challenge is invalid.');
  }
  return value;
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((value) => right.includes(value));
}

function normalizedApplicationClient(client: ApplicationOAuthClient): ApplicationOAuthClient {
  const id = requiredClientId(client.id);
  const redirectUris = client.redirectUris.map(normalizedRedirectUri);
  const grantTypes = [...new Set(client.grantTypes)];
  if (client.type === 'public' && !client.requirePkce) throw new Error(`Public OAuth client ${id} must require PKCE.`);
  if (client.type === 'public' && grantTypes.includes('client_credentials')) {
    throw new Error(`Public OAuth client ${id} cannot use client_credentials.`);
  }
  return {
    ...client,
    id,
    redirectUris,
    allowedScopes: normalizedStringList(client.allowedScopes, 'allowed scopes'),
    allowedResources: client.allowedResources.map((value) => normalizedAbsoluteUri(value, 'allowed resource')),
    allowedAudience: normalizedStringList(client.allowedAudience, 'allowed audience'),
    grantTypes,
  };
}

function hydraClientBody(client: ApplicationOAuthClient, name: string, secret?: string) {
  return {
    client_id: client.id,
    client_name: requiredSecret(name, 'client name'),
    ...(secret ? { client_secret: requiredSecret(secret, 'client secret') } : {}),
    token_endpoint_auth_method: client.type === 'public' ? 'none' : 'client_secret_basic',
    redirect_uris: [...client.redirectUris],
    grant_types: [...client.grantTypes],
    response_types: client.grantTypes.includes('authorization_code') ? ['code'] : [],
    scope: client.allowedScopes.join(' '),
    audience: [...client.allowedAudience],
    metadata: {
      applik8s_revision: client.revision,
      applik8s_type: client.type,
      applik8s_state: client.state,
      applik8s_require_pkce: client.requirePkce,
      applik8s_resources: [...client.allowedResources],
    },
  };
}

function normalizedHydraClient(value: Readonly<Record<string, unknown>>): ApplicationOAuthClient {
  const metadataValue = value.metadata;
  const metadata = metadataValue && typeof metadataValue === 'object' && !Array.isArray(metadataValue)
    // typecast: the provider payload boundary rejects null/arrays before reading the metadata record.
    ? metadataValue as Readonly<Record<string, unknown>>
    : {};
  const type = metadata.applik8s_type;
  const normalizedType = type === 'public' || type === 'confidential' || type === 'service'
    ? type
    : value.token_endpoint_auth_method === 'none'
      ? 'public'
      : 'confidential';
  const grantTypes = oryStringArray(value.grant_types ?? [], 'client.grant_types')
    .filter((item): item is ApplicationOAuthClient['grantTypes'][number] =>
      item === 'authorization_code' || item === 'refresh_token' || item === 'client_credentials');
  const state = metadata.applik8s_state === 'revoked' ? 'revoked' : 'active';
  return {
    apiVersion: 'applik8s.oauth/v1alpha1',
    id: requiredOryString(value.client_id, 'client.client_id'),
    type: normalizedType,
    redirectUris: oryStringArray(value.redirect_uris ?? [], 'client.redirect_uris').map(normalizedRedirectUri),
    allowedScopes: stringScope(value.scope),
    allowedResources: Array.isArray(metadata.applik8s_resources)
      ? oryStringArray(metadata.applik8s_resources, 'client.metadata.applik8s_resources')
      : [],
    allowedAudience: oryStringArray(value.audience ?? [], 'client.audience'),
    grantTypes,
    requirePkce: metadata.applik8s_require_pkce === true || normalizedType === 'public',
    state,
    revision: typeof metadata.applik8s_revision === 'string' && metadata.applik8s_revision.trim()
      ? metadata.applik8s_revision
      : digestJson(value),
  };
}

function normalizedHydraTokenSet(value: Readonly<Record<string, unknown>>): ApplicationOAuthTokenSet {
  const expiresIn = Number(value.expires_in);
  if (!Number.isSafeInteger(expiresIn) || expiresIn < 1) {
    throw new OryAdapterError('ORY_RESPONSE_INVALID', 'Ory token response has invalid expires_in.');
  }
  return {
    accessToken: requiredOryString(value.access_token, 'token.access_token'),
    tokenType: requiredOryString(value.token_type, 'token.token_type'),
    expiresIn,
    scope: stringScope(value.scope),
    ...(typeof value.refresh_token === 'string' && value.refresh_token ? { refreshToken: value.refresh_token } : {}),
    ...(typeof value.id_token === 'string' && value.id_token ? { idToken: value.id_token } : {}),
  };
}

function normalizedHydraIntrospection(
  value: Readonly<Record<string, unknown>>,
): ApplicationOAuthTokenIntrospection {
  const active = value.active === true;
  return {
    active,
    scope: stringScope(value.scope),
    audience: typeof value.aud === 'string'
      ? [value.aud]
      : Array.isArray(value.aud)
        ? oryStringArray(value.aud, 'introspection.aud')
        : [],
    ...(typeof value.client_id === 'string' ? { clientId: value.client_id } : {}),
    ...(typeof value.sub === 'string' ? { subject: value.sub } : {}),
    ...(typeof value.iss === 'string' ? { issuer: value.iss } : {}),
    ...(typeof value.token_type === 'string' ? { tokenType: value.token_type } : {}),
    ...(typeof value.iat === 'number' ? { issuedAt: value.iat } : {}),
    ...(typeof value.exp === 'number' ? { expiresAt: value.exp } : {}),
  };
}

function clientAuthorization(
  client: ApplicationOAuthTokenClientAuthentication,
  form: URLSearchParams,
): Readonly<Record<string, string>> {
  const id = requiredClientId(client.clientId);
  if (!client.clientSecret) {
    form.set('client_id', id);
    return {};
  }
  const encoded = Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(requiredSecret(client.clientSecret, 'client secret'))}`).toString('base64');
  return { authorization: `Basic ${encoded}` };
}

function requiredClientId(value: string): string {
  if (!value.trim() || value.length > 255 || !/^[A-Za-z0-9._~-]+$/u.test(value)) {
    throw new Error('OAuth client ID is invalid.');
  }
  return encodeURIComponent(value);
}

function requiredSecret(value: string, field: string): string {
  if (!value.trim() || value.length > 16 * 1024) throw new Error(`OAuth ${field} is invalid.`);
  return value;
}

function normalizedRedirectUri(value: string): string {
  return normalizedAbsoluteUri(value, 'redirect URI');
}

function normalizedAbsoluteUri(value: string, field: string): string {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error(`OAuth ${field} is invalid.`);
  }
  if (url.protocol === 'http:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error(`OAuth ${field} must use HTTPS outside loopback.`);
  }
  return url.toString();
}

function normalizedStringList(value: readonly string[], field: string): string[] {
  const normalized = [...new Set(value.map((item) => requiredSecret(item, field)))];
  if (normalized.some((item) => /\s/u.test(item))) throw new Error(`OAuth ${field} must not contain whitespace.`);
  return normalized;
}

function stringScope(value: unknown): string[] {
  if (value === undefined || value === null || value === '') return [];
  if (typeof value !== 'string') throw new OryAdapterError('ORY_RESPONSE_INVALID', 'Ory scope must be a string.');
  return [...new Set(value.split(/\s+/u).filter(Boolean))];
}

function digestJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
