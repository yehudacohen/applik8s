import type { ApplicationIdentityReference } from '@applik8s/core';
import { describe, expect, it } from 'vitest';
import {
  ApplicationPreAuthenticationFlowService,
  MemoryApplicationIdentityFlowStore,
  deterministicApplicationIdentityPrincipal,
  type ApplicationIdentityFlowBinding,
  type ApplicationIdentityFlowStore,
  type ApplicationIdentityProviderAdapter,
} from '../src/index.js';

const binding: ApplicationIdentityFlowBinding = {
  browserBinding: 'browser-session-1',
  csrfToken: 'csrf-token-1',
  providerContinuity: 'provider-continuity-1',
  networkBinding: 'network-class-1',
};

describe('provider-neutral identity flow runtime', () => {
  it('admits only the bound pre-authentication flow and exposes no consent authority', async () => {
    const runtime = identityRuntime();
    const flow = await runtime.issue({
      kind: 'login',
      provider: 'deterministic',
      providerFlowId: 'provider-flow-1',
      binding,
      allowedTransitions: ['submit-login', 'verify-factor'],
    });

    const principal = await runtime.admit(flow.id, binding, admissionContext());

    expect(principal).toMatchObject({
      kind: 'pre-authentication-flow',
      flowId: flow.id,
      allowedTransitions: ['submit-login', 'verify-factor'],
      audience: ['https://application.example.test'],
    });
    expect(principal.allowedTransitions).not.toContain('consent.approve');
    await expect(
      runtime.admit(
        flow.id,
        { ...binding, csrfToken: 'substituted' },
        admissionContext(),
      ),
    ).rejects.toMatchObject({
      name: 'ApplicationIdentityFlowError',
      code: 'FLOW_BINDING_INVALID',
      publicCode: 'identity_flow_unavailable',
    });
    await expect(
      runtime.admit(
        flow.id,
        { ...binding, providerContinuity: 'lost' },
        admissionContext(),
      ),
    ).rejects.toMatchObject({
      code: 'PROVIDER_CONTINUITY_INVALID',
      publicCode: 'identity_flow_unavailable',
    });
  });

  it('consumes provider completion once and replays one canonical admission receipt', async () => {
    const store = new MemoryApplicationIdentityFlowStore();
    const runtime = identityRuntime({ store });
    const flow = await runtime.issue({
      kind: 'register',
      provider: 'deterministic',
      providerFlowId: 'provider-flow-register',
      binding,
      allowedTransitions: ['submit-registration'],
      oauth: {
        authorizationRequestId: 'authorization-request-1',
        clientId: 'public-client',
        redirectUri: 'https://client.example.test/callback',
        scopes: ['openid', 'profile'],
        resources: ['https://api.example.test/'],
        audience: ['https://api.example.test'],
        codeChallenge: 'pkce-s256-challenge',
        codeChallengeMethod: 'S256',
      },
    });
    const completion = providerCompletion(
      flow.providerFlowId,
      'provider-session-1',
    );

    const [first, replay] = await Promise.all([
      runtime.complete({
        flowId: flow.id,
        binding,
        completion,
        context: admissionContext(),
      }),
      runtime.complete({
        flowId: flow.id,
        binding,
        completion,
        context: admissionContext(),
      }),
    ]);

    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      flowId: flow.id,
      providerSessionId: 'provider-session-1',
      principal: {
        kind: 'human',
        sessionId: 'provider-session-1',
      },
      oauth: {
        authorizationRequestId: 'authorization-request-1',
        clientId: 'public-client',
        redirectUri: 'https://client.example.test/callback',
        codeChallengeMethod: 'S256',
      },
    });
    expect(await store.getFlow(flow.id)).toMatchObject({
      state: 'consumed',
      attempts: 1,
      version: 2,
    });
  });

  it('rejects callback substitution, replay against another flow, and exhausted attempts', async () => {
    const runtime = identityRuntime();
    const first = await runtime.issue({
      kind: 'recover',
      provider: 'deterministic',
      providerFlowId: 'provider-flow-first',
      binding,
      allowedTransitions: ['submit-recovery'],
      maximumAttempts: 1,
    });
    const second = await runtime.issue({
      kind: 'recover',
      provider: 'deterministic',
      providerFlowId: 'provider-flow-second',
      binding,
      allowedTransitions: ['submit-recovery'],
    });

    await runtime.transition({
      flowId: first.id,
      transition: 'submit-recovery',
      binding,
    });
    await expect(
      runtime.complete({
        flowId: first.id,
        binding,
        completion: providerCompletion(
          first.providerFlowId,
          'provider-session-exhausted',
        ),
        context: admissionContext(),
      }),
    ).rejects.toMatchObject({ code: 'FLOW_RATE_LIMITED' });

    const firstCompletion = providerCompletion(
      second.providerFlowId,
      'provider-session-shared',
    );
    await runtime.complete({
      flowId: second.id,
      binding,
      completion: firstCompletion,
      context: admissionContext(),
    });
    await expect(
      runtime.complete({
        flowId: first.id,
        binding,
        completion: firstCompletion,
        context: admissionContext(),
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_COMPLETION_INVALID' });
  });

  it('records and later neutralizes a provider session orphan after local failure', async () => {
    let revocationAvailable = false;
    const revoked: string[] = [];
    const provider: ApplicationIdentityProviderAdapter = {
      name: 'deterministic',
      async revokeSession(sessionId) {
        if (!revocationAvailable) throw new Error('provider unavailable');
        revoked.push(sessionId);
        return { revoked: true };
      },
    };
    const store = new FailingAdmissionStore();
    const runtime = identityRuntime({ store, provider });
    const flow = await runtime.issue({
      kind: 'login',
      provider: 'deterministic',
      providerFlowId: 'provider-flow-orphan',
      binding,
      allowedTransitions: ['submit-login'],
    });

    await expect(
      runtime.complete({
        flowId: flow.id,
        binding,
        completion: providerCompletion(
          flow.providerFlowId,
          'provider-session-orphan',
        ),
        context: admissionContext(),
      }),
    ).rejects.toMatchObject({
      code: 'PROVIDER_SESSION_ORPHANED',
      publicCode: 'identity_flow_unavailable',
    });
    expect(await store.listPendingOrphans(10)).toHaveLength(1);

    revocationAvailable = true;
    const resolved = await runtime.reconcileOrphans();

    expect(resolved).toEqual([
      expect.objectContaining({
        state: 'revoked',
        providerSessionId: 'provider-session-orphan',
      }),
    ]);
    expect(revoked).toEqual(['provider-session-orphan']);
    expect(await store.listPendingOrphans(10)).toEqual([]);
  });

  it('normalizes OAuth continuation constraints before provider redirection', async () => {
    const runtime = identityRuntime();

    await expect(
      runtime.issue({
        kind: 'login',
        provider: 'deterministic',
        providerFlowId: 'provider-flow-oauth',
        binding,
        allowedTransitions: ['submit-login'],
        oauth: {
          authorizationRequestId: 'request-1',
          clientId: 'client-1',
          redirectUri: 'https://client.example.test/callback#substituted',
          scopes: ['openid'],
          resources: ['https://api.example.test/'],
          audience: ['https://api.example.test'],
        },
      }),
    ).rejects.toThrow(/fragment/u);
    await expect(
      runtime.issue({
        kind: 'login',
        provider: 'deterministic',
        providerFlowId: 'provider-flow-oauth',
        binding,
        allowedTransitions: ['submit-login'],
        oauth: {
          authorizationRequestId: 'request-1',
          clientId: 'client-1',
          redirectUri: 'http://client.example.test/callback',
          scopes: ['openid'],
          resources: ['https://api.example.test/'],
          audience: ['https://api.example.test'],
        },
      }),
    ).rejects.toThrow(/HTTPS/u);
  });
});

function identityRuntime(options: {
  readonly store?: ApplicationIdentityFlowStore;
  readonly provider?: ApplicationIdentityProviderAdapter;
} = {}) {
  return new ApplicationPreAuthenticationFlowService({
    store: options.store ?? new MemoryApplicationIdentityFlowStore(),
    providers: [
      options.provider ?? {
        name: 'deterministic',
        async revokeSession() {
          return { revoked: true };
        },
      },
    ],
    admitPrincipal: async (input) =>
      deterministicApplicationIdentityPrincipal(input),
    bindingSecret: 'test-identity-binding-secret-with-32-bytes',
    identifier: (() => {
      let id = 0;
      return () => String(++id).padStart(32, '0');
    })(),
    clock: () => new Date('2026-07-29T00:00:00.000Z'),
  });
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

function providerCompletion(
  providerFlowId: string,
  providerSessionId: string,
) {
  const providerIdentity: ApplicationIdentityReference = {
    id: 'identity:deterministic:human-1',
    kind: 'human',
    issuer: 'https://identity.example.test',
    subject: 'human-1',
  };
  return {
    provider: 'deterministic',
    providerFlowId,
    providerSessionId,
    providerIdentity,
    authenticationMethod: 'password+mfa',
    assurance: ['aal2'],
    completedAt: '2026-07-29T00:00:00.000Z',
    expiresAt: '2026-07-29T01:00:00.000Z',
    evidence: { fixture: true },
  };
}

class FailingAdmissionStore extends MemoryApplicationIdentityFlowStore {
  override async commitAdmission(
    _input: Parameters<
      MemoryApplicationIdentityFlowStore['commitAdmission']
    >[0],
  ): Promise<never> {
    throw new Error('local transaction unavailable');
  }
}
