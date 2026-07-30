import type { ApplicationPrincipal } from '@applik8s/core';
import { describe, expect, it } from 'vitest';
import {
  ApplicationOAuthAuthorizationFlowService,
  type ApplicationOAuthAuthorizationProviderAdapter,
  type ApplicationOAuthClient,
  MemoryApplicationOAuthAuthorizationFlowStore,
} from '../src/index.js';

const binding = {
  browserBinding: 'browser-session-1',
  csrfToken: 'csrf-token-1',
  providerContinuity: 'provider-continuity-1',
};

describe('OAuth authorization-flow authority', () => {
  it('binds consent to one authenticated resource owner and replays one provider decision', async () => {
    const decisions: string[] = [];
    const runtime = oauthRuntime({
      provider: {
        name: 'deterministic',
        async decide(input) {
          decisions.push(input.idempotencyKey);
          return {
            id: 'provider-decision-1',
            providerAuthorizationRequestId:
              input.flow.providerAuthorizationRequestId,
            accepted: input.decision === 'approve',
            continuationUri:
              `https://oauth.example.test/continue/${input.flow.id}`,
            evidence: { deterministic: true },
          };
        },
      },
    });
    const flow = await runtime.issue({
      client: oauthClient(),
      principal: humanPrincipal(),
      binding,
      request: authorizationRequest(),
    });
    const admitted = await runtime.admit(
      flow.id,
      binding,
      humanPrincipal(),
      admissionContext(),
    );

    expect(admitted).toMatchObject({
      kind: 'oauth-authorization-flow',
      resourceOwner: humanPrincipal().identity,
      authorizationRequestId: 'authorization-request-1',
      clientId: 'public-client',
      redirectUri: 'https://client.example.test/callback',
      scopes: ['openid', 'profile'],
      resources: ['https://api.example.test/'],
    });

    const first = await runtime.decide({
      flowId: flow.id,
      decision: 'approve',
      binding,
      principal: humanPrincipal(),
    });
    const replay = await runtime.decide({
      flowId: flow.id,
      decision: 'approve',
      binding,
      principal: humanPrincipal(),
    });

    expect(first.flow.state).toBe('approved');
    expect(replay).toEqual(first);
    expect(decisions).toHaveLength(2);
    expect(new Set(decisions).size).toBe(1);
  });

  it('rejects pre-authentication principals, session substitution, and authority changes', async () => {
    const runtime = oauthRuntime();
    const preAuthentication: ApplicationPrincipal = {
      ...humanPrincipal(),
      id: 'principal:pre-auth',
      identity: {
        id: 'identity:pre-auth',
        kind: 'pre-authentication-flow',
        issuer: 'applik8s://test',
        subject: 'flow-1',
      },
      kind: 'pre-authentication-flow',
      flowId: 'flow-1',
    };

    await expect(
      runtime.issue({
        client: oauthClient(),
        principal: preAuthentication,
        binding,
        request: authorizationRequest(),
      }),
    ).rejects.toMatchObject({
      code: 'OAUTH_RESOURCE_OWNER_INVALID',
      publicCode: 'oauth_authorization_unavailable',
    });

    const flow = await runtime.issue({
      client: oauthClient(),
      principal: humanPrincipal(),
      binding,
      request: authorizationRequest(),
    });
    await expect(
      runtime.admit(
        flow.id,
        binding,
        { ...humanPrincipal(), sessionId: 'substituted-session' },
        admissionContext(),
      ),
    ).rejects.toMatchObject({ code: 'OAUTH_RESOURCE_OWNER_INVALID' });
    await expect(
      runtime.admit(
        flow.id,
        binding,
        { ...humanPrincipal(), authorityRevision: 'authority-revoked' },
        {
          ...admissionContext(),
          authorityRevision: 'authority-revoked',
        },
      ),
    ).rejects.toMatchObject({ code: 'OAUTH_RESOURCE_OWNER_INVALID' });
  });

  it('requires exact registered redirects, scope/resource/audience subsets, and PKCE', async () => {
    const runtime = oauthRuntime();
    const {
      codeChallenge: _codeChallenge,
      codeChallengeMethod: _codeChallengeMethod,
      ...withoutPkce
    } = authorizationRequest();

    await expect(
      runtime.issue({
        client: oauthClient(),
        principal: humanPrincipal(),
        binding,
        request: {
          ...authorizationRequest(),
          redirectUri: 'https://attacker.example.test/callback',
        },
      }),
    ).rejects.toMatchObject({ code: 'OAUTH_REQUEST_INVALID' });
    await expect(
      runtime.issue({
        client: oauthClient(),
        principal: humanPrincipal(),
        binding,
        request: {
          ...authorizationRequest(),
          scopes: ['openid', 'administrator'],
        },
      }),
    ).rejects.toMatchObject({ code: 'OAUTH_REQUEST_INVALID' });
    await expect(
      runtime.issue({
        client: oauthClient(),
        principal: humanPrincipal(),
        binding,
        request: withoutPkce,
      }),
    ).rejects.toMatchObject({ code: 'OAUTH_REQUEST_INVALID' });
  });

  it('rejects a provider response that changes the bound redirect', async () => {
    const runtime = oauthRuntime({
      provider: {
        name: 'deterministic',
        async decide(input) {
          return {
            id: 'provider-decision-substituted',
            providerAuthorizationRequestId:
              input.flow.providerAuthorizationRequestId,
            accepted: true,
            continuationUri: 'ftp://attacker.example.test/continue',
            evidence: {},
          };
        },
      },
    });
    const flow = await runtime.issue({
      client: oauthClient(),
      principal: humanPrincipal(),
      binding,
      request: authorizationRequest(),
    });

    await expect(
      runtime.decide({
        flowId: flow.id,
        decision: 'approve',
        binding,
        principal: humanPrincipal(),
      }),
    ).rejects.toMatchObject({ code: 'OAUTH_PROVIDER_DECISION_INVALID' });
  });

  it('serializes conflicting consent decisions before calling the provider', async () => {
    const providerDecisions: string[] = [];
    const runtime = oauthRuntime({
      provider: {
        name: 'deterministic',
        async decide(input) {
          providerDecisions.push(input.decision);
          return {
            id: `provider-${input.decision}`,
            providerAuthorizationRequestId:
              input.flow.providerAuthorizationRequestId,
            accepted: input.decision === 'approve',
            continuationUri:
              `https://oauth.example.test/continue/${input.flow.id}`,
            evidence: {},
          };
        },
      },
    });
    const flow = await runtime.issue({
      client: oauthClient(),
      principal: humanPrincipal(),
      binding,
      request: authorizationRequest(),
    });

    const decisions = await Promise.allSettled([
      runtime.decide({
        flowId: flow.id,
        decision: 'approve',
        binding,
        principal: humanPrincipal(),
      }),
      runtime.decide({
        flowId: flow.id,
        decision: 'deny',
        binding,
        principal: humanPrincipal(),
      }),
    ]);

    expect(decisions.filter((decision) => decision.status === 'fulfilled'))
      .toHaveLength(1);
    expect(decisions.filter((decision) => decision.status === 'rejected'))
      .toHaveLength(1);
    expect(providerDecisions).toHaveLength(1);
  });
});

function oauthRuntime(options: {
  readonly provider?: ApplicationOAuthAuthorizationProviderAdapter;
} = {}) {
  return new ApplicationOAuthAuthorizationFlowService({
    store: new MemoryApplicationOAuthAuthorizationFlowStore(),
    providers: [
      options.provider ?? {
        name: 'deterministic',
        async decide(input) {
          return {
            id: `provider-decision-${input.flow.id}`,
            providerAuthorizationRequestId:
              input.flow.providerAuthorizationRequestId,
            accepted: input.decision === 'approve',
            continuationUri:
              `https://oauth.example.test/continue/${input.flow.id}`,
            evidence: { deterministic: true },
          };
        },
      },
    ],
    bindingSecret: 'test-oauth-binding-secret-with-32-bytes',
    clock: () => new Date('2026-07-29T00:00:00.000Z'),
    identifier: () => '00000000000000000000000000000001',
  });
}

function humanPrincipal(): ApplicationPrincipal {
  return {
    id: 'principal:human-1',
    identity: {
      id: 'identity:human-1',
      kind: 'human',
      issuer: 'https://identity.example.test',
      subject: 'human-1',
    },
    kind: 'human',
    authenticationMethod: 'password+mfa',
    audience: ['https://application.example.test'],
    trustedContextDigest: 'context-1',
    catalogRevision: 'catalog-1',
    authorityRevision: 'authority-1',
    admittedAt: '2026-07-29T00:00:00.000Z',
    expiresAt: '2026-07-29T01:00:00.000Z',
    sessionId: 'session-1',
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

function authorizationRequest() {
  return {
    id: 'authorization-request-1',
    provider: 'deterministic',
    providerAuthorizationRequestId: 'provider-request-1',
    clientId: 'public-client',
    redirectUri: 'https://client.example.test/callback',
    scopes: ['openid', 'profile'],
    resources: ['https://api.example.test/'],
    audience: ['https://api.example.test'],
    responseType: 'code' as const,
    codeChallenge: 'pkce-s256-challenge',
    codeChallengeMethod: 'S256' as const,
  };
}

function admissionContext() {
  return {
    application: 'identity-test',
    catalogRevision: 'catalog-1',
    authorityRevision: 'authority-1',
    trustedContextDigest: 'context-1',
    audience: ['https://application.example.test'],
    now: new Date('2026-07-29T00:00:00.000Z'),
  };
}
