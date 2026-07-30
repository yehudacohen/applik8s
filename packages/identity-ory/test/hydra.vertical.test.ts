import type {
  ApplicationOAuthAuthorizationFlowRecord,
  ApplicationOAuthClient,
} from '@applik8s/identity';
import { describe, expect, it } from 'vitest';
import { OryHydraOAuthAdapter } from '../src/index.js';

describe('Ory Hydra OAuth adapter', () => {
  it('revalidates the authoritative consent request before accepting exact authority', async () => {
    const requests: Request[] = [];
    const adapter = new OryHydraOAuthAdapter({
      adminUrl: 'http://hydra-admin.identity.svc/',
      publicUrl: 'https://oauth.example.test/',
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        if (request.method === 'GET') {
          return Response.json(consentFixture());
        }
        return Response.json({
          redirect_to:
            'https://oauth.example.test/oauth2/auth?consent_verifier=verified',
        });
      },
    });

    const result = await adapter.decide({
      flow: oauthFlow(),
      decision: 'approve',
      idempotencyKey: 'consent-idempotency-1',
    });

    expect(result).toMatchObject({
      providerAuthorizationRequestId: 'consent-challenge-1',
      accepted: true,
      continuationUri:
        'https://oauth.example.test/oauth2/auth?consent_verifier=verified',
    });
    expect(requests.map((request) => `${request.method} ${request.url}`))
      .toEqual([
        'GET http://hydra-admin.identity.svc/admin/oauth2/auth/requests/consent?consent_challenge=consent-challenge-1',
        'PUT http://hydra-admin.identity.svc/admin/oauth2/auth/requests/consent/accept?consent_challenge=consent-challenge-1',
      ]);
    expect(requests[1]?.headers.get('idempotency-key')).toBe(
      'consent-idempotency-1',
    );
    expect(await requests[1]?.json()).toEqual({
      grant_scope: ['openid', 'profile'],
      grant_access_token_audience: ['https://api.example.test'],
      remember: false,
      context: {
        applik8s_flow_id: 'oauth-flow-1',
        applik8s_client_revision: 'client-revision-1',
      },
    });
  });

  it('rejects Hydra request substitution before sending a decision', async () => {
    const methods: string[] = [];
    const adapter = new OryHydraOAuthAdapter({
      adminUrl: 'http://hydra-admin.identity.svc/',
      publicUrl: 'https://oauth.example.test/',
      fetch: async (input, init) => {
        const request = new Request(input, init);
        methods.push(request.method);
        return Response.json({
          ...consentFixture(),
          requested_scope: ['openid', 'administrator'],
        });
      },
    });

    await expect(
      adapter.decide({
        flow: oauthFlow(),
        decision: 'approve',
        idempotencyKey: 'consent-idempotency-1',
      }),
    ).rejects.toMatchObject({ code: 'ORY_REQUEST_REJECTED' });
    expect(methods).toEqual(['GET']);
  });

  it('rejects a continuation emitted from an unexpected public origin', async () => {
    const adapter = new OryHydraOAuthAdapter({
      adminUrl: 'http://hydra-admin.identity.svc/',
      publicUrl: 'https://oauth.example.test/',
      fetch: async (input, init) => {
        const request = new Request(input, init);
        if (request.method === 'GET') return Response.json(consentFixture());
        return Response.json({
          redirect_to: 'https://attacker.example.test/continue',
        });
      },
    });

    await expect(
      adapter.decide({
        flow: oauthFlow(),
        decision: 'deny',
        idempotencyKey: 'consent-idempotency-1',
      }),
    ).rejects.toMatchObject({ code: 'ORY_RESPONSE_INVALID' });
  });

  it('provisions and revokes a provider-neutral OAuth client', async () => {
    const requests: Request[] = [];
    const adapter = new OryHydraOAuthAdapter({
      adminUrl: 'http://hydra-admin.identity.svc/',
      publicUrl: 'https://oauth.example.test/',
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        if (request.method === 'DELETE') return new Response(null, { status: 204 });
        if (request.method === 'GET') return Response.json(hydraClientFixture());
        return Response.json(hydraClientFixture(), { status: 201 });
      },
    });

    await expect(adapter.provisionClient({
      client: oauthClient(),
      name: 'Browser client',
    })).resolves.toEqual(oauthClient());
    await expect(adapter.client('public-client')).resolves.toEqual(oauthClient());
    await expect(adapter.rotateClient({
      client: { ...oauthClient(), type: 'confidential', requirePkce: false },
      name: 'Browser client',
      secret: 'rotated-private',
    })).resolves.toMatchObject({ id: 'public-client' });
    await expect(adapter.revokeClient('public-client')).resolves.toBeUndefined();
    expect(await requests[0]?.json()).toMatchObject({
      client_id: 'public-client',
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      metadata: {
        applik8s_revision: 'client-revision-1',
        applik8s_type: 'public',
        applik8s_require_pkce: true,
      },
    });
    expect(requests.map(({ method, url }) => `${method} ${url}`)).toEqual([
      'POST http://hydra-admin.identity.svc/admin/clients',
      'GET http://hydra-admin.identity.svc/admin/clients/public-client',
      'PUT http://hydra-admin.identity.svc/admin/clients/public-client',
      'DELETE http://hydra-admin.identity.svc/admin/clients/public-client',
    ]);
  });

  it('exchanges, introspects, and revokes tokens without leaking client secrets into URLs', async () => {
    const requests: Request[] = [];
    const adapter = new OryHydraOAuthAdapter({
      adminUrl: 'http://hydra-admin.identity.svc/',
      publicUrl: 'https://oauth.example.test/',
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        if (request.url.includes('/introspect')) {
          return Response.json({
            active: true,
            client_id: 'public-client',
            sub: 'human-1',
            scope: 'openid profile',
            aud: ['https://api.example.test'],
            exp: 1_785_383_600,
          });
        }
        if (request.url.includes('/revoke')) return new Response(null, { status: 204 });
        return Response.json({
          access_token: 'access-private',
          refresh_token: 'refresh-private',
          token_type: 'bearer',
          expires_in: 3600,
          scope: 'openid profile',
        });
      },
    });

    await expect(adapter.issueToken({
      grantType: 'authorization_code',
      client: { clientId: 'public-client' },
      code: 'authorization-private',
      redirectUri: 'https://client.example.test/callback',
      codeVerifier: 'pkce-private',
      resources: ['https://api.example.test/'],
    })).resolves.toEqual({
      accessToken: 'access-private',
      refreshToken: 'refresh-private',
      tokenType: 'bearer',
      expiresIn: 3600,
      scope: ['openid', 'profile'],
    });
    await expect(adapter.introspectToken('access-private')).resolves.toMatchObject({
      active: true,
      clientId: 'public-client',
      subject: 'human-1',
      scope: ['openid', 'profile'],
      audience: ['https://api.example.test'],
    });
    await expect(adapter.revokeToken(
      'refresh-private',
      { clientId: 'confidential-client', clientSecret: 'client-secret-private' },
      'refresh_token',
    )).resolves.toBeUndefined();
    expect(requests.every(({ url }) =>
      !url.includes('private')
      && !url.includes('client-secret'))).toBe(true);
    expect(await requests[0]?.text()).toContain('client_id=public-client');
    expect(requests[2]?.headers.get('authorization')).toMatch(/^Basic /u);
    expect(await requests[2]?.text()).not.toContain('client-secret-private');
  });
});

function oauthFlow(): ApplicationOAuthAuthorizationFlowRecord {
  return {
    apiVersion: 'applik8s.oauth/v1alpha1',
    id: 'oauth-flow-1',
    provider: 'ory-hydra',
    providerAuthorizationRequestId: 'consent-challenge-1',
    authorizationRequestId: 'authorization-request-1',
    clientId: 'public-client',
    clientRevision: 'client-revision-1',
    redirectUri: 'https://client.example.test/callback',
    scopes: ['openid', 'profile'],
    resources: ['https://api.example.test/'],
    audience: ['https://api.example.test'],
    codeChallenge: 'pkce-s256-challenge',
    codeChallengeMethod: 'S256',
    resourceOwner: {
      id: 'identity:ory:human-1',
      kind: 'human',
      issuer: 'https://identity.example.test',
      subject: 'human-1',
    },
    resourceOwnerPrincipalId: 'principal:human-1',
    sessionId: 'session-1',
    authenticationMethod: 'ory:password+totp',
    authorityRevision: 'authority-1',
    browserBindingDigest: 'browser-digest',
    csrfBindingDigest: 'csrf-digest',
    state: 'approving',
    issuedAt: '2026-07-29T00:00:00.000Z',
    expiresAt: '2026-07-29T00:10:00.000Z',
    version: 2,
  };
}

function consentFixture() {
  return {
    challenge: 'consent-challenge-1',
    consent_request_id: 'consent-request-1',
    subject: 'human-1',
    client: { client_id: 'public-client' },
    requested_scope: ['openid', 'profile'],
    requested_access_token_audience: ['https://api.example.test'],
  };
}

function oauthClient(): ApplicationOAuthClient {
  return {
    apiVersion: 'applik8s.oauth/v1alpha1',
    id: 'public-client',
    type: 'public',
    redirectUris: ['https://client.example.test/callback'],
    allowedScopes: ['openid', 'profile'],
    allowedResources: ['https://api.example.test/'],
    allowedAudience: ['https://api.example.test'],
    grantTypes: ['authorization_code', 'refresh_token'],
    requirePkce: true,
    state: 'active',
    revision: 'client-revision-1',
  };
}

function hydraClientFixture() {
  return {
    client_id: 'public-client',
    token_endpoint_auth_method: 'none',
    redirect_uris: ['https://client.example.test/callback'],
    grant_types: ['authorization_code', 'refresh_token'],
    scope: 'openid profile',
    audience: ['https://api.example.test'],
    metadata: {
      applik8s_revision: 'client-revision-1',
      applik8s_type: 'public',
      applik8s_state: 'active',
      applik8s_require_pkce: true,
      applik8s_resources: ['https://api.example.test/'],
    },
  };
}
