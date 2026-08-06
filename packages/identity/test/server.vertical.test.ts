import {
  createDeterministicApplicationAdmission,
} from '@applik8s/identity';
import {
  createApplicationIdentitySessionHandler,
} from '@applik8s/identity/server';
import { describe, expect, it } from 'vitest';

describe('application identity session boundary', () => {
  it('reconstructs the public session without provider claims or authority context', async () => {
    const admission = createDeterministicApplicationAdmission({
      mode: 'starter',
      application: 'research',
      subject: 'member-1',
      roles: ['workspace-owner'],
      audience: ['research'],
      trustedContext: { workspaceId: 'workspace-secret' },
      catalogRevision: 'catalog-v1',
      authorityRevision: 'authority-v1',
      admittedAt: '2026-08-05T00:00:00.000Z',
      sessionId: 'session-1',
    });
    const providerAdmission = {
      ...admission,
      principal: {
        ...admission.principal,
        attributes: { providerGroup: 'private-group' },
        identity: {
          ...admission.principal.identity,
          rawClaims: { email: 'private@example.test' },
        },
      },
      providerEvidence: { accessToken: 'never-public' },
    };
    const handle = createApplicationIdentitySessionHandler({
      authenticate: async () => providerAdmission,
    });

    const response = await handle(
      new Request('https://research.example.test/__applik8s/v1/identity/session'),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      protocol: 'applik8s.identityHttp/v1alpha1',
      kind: 'session',
      authenticated: true,
      principal: {
        id: admission.principal.id,
        identity: {
          id: admission.principal.identity.id,
          kind: admission.principal.identity.kind,
          issuer: admission.principal.identity.issuer,
          subject: admission.principal.identity.subject,
        },
        kind: admission.principal.kind,
        authenticationMethod: admission.principal.authenticationMethod,
        audience: ['research'],
        admittedAt: '2026-08-05T00:00:00.000Z',
        sessionId: 'session-1',
      },
      assurance: [],
    });
  });

  it('returns an enumeration-safe anonymous session when authentication fails', async () => {
    const handle = createApplicationIdentitySessionHandler({
      authenticate: async () => {
        throw new Error('provider-native credential detail');
      },
    });

    const response = await handle(
      new Request('https://research.example.test/__applik8s/v1/identity/session'),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      protocol: 'applik8s.identityHttp/v1alpha1',
      kind: 'session',
      authenticated: false,
      assurance: [],
    });
  });
});
