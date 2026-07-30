import type {
  ApplicationOAuthAuthorizationFlowRecord,
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
