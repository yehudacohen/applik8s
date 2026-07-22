// typecast-file-boundary: Character tests intentionally construct boundary-shaped provider responses to verify runtime validation and substitution.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  authenticateConfiguredChirpRequest,
  chirpAuthorization,
  probeConfiguredChirpAuthorization,
  probeConfiguredChirpIdentity,
  type ChirpRuntimeProfile,
} from '../chirp-start/src/providers/identity';

const previousInstallationSpec = process.env.APPLIK8S_INSTALLATION_SPEC;

afterEach(() => {
  vi.unstubAllGlobals();
  if (previousInstallationSpec === undefined) delete process.env.APPLIK8S_INSTALLATION_SPEC;
  else process.env.APPLIK8S_INSTALLATION_SPEC = previousInstallationSpec;
});

describe('Chirp provider-neutral identity profiles', () => {
  it('keeps deterministic header identity restricted to the explicit starter profile', async () => {
    await expect(authenticateConfiguredChirpRequest(profile('dedicated', {
      mode: 'deterministic-local', authorizationVersion: 'policy-v1',
    }), new Request('http://chirp.localhost', { headers: { 'x-chirp-user': 'attacker' } })))
      .rejects.toThrow('restricted to the starter profile');

    await expect(authenticateConfiguredChirpRequest(profile('starter', {
      mode: 'deterministic-local', authorizationVersion: 'policy-v1',
    }), new Request('http://chirp.localhost', { headers: { 'x-chirp-user': 'demo-user' } })))
      .resolves.toMatchObject({
        principal: { id: 'demo-user', claims: { role: 'moderator' } },
        trustedContext: { issuer: 'chirp://deterministic-local', subject: 'demo-user', identityProvider: 'deterministic-local' },
        authorizationVersion: 'policy-v1',
      });
  });

  it('normalizes an active Ory session and forwards only session credentials', async () => {
    const requestFetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('cookie')).toBe('ory_kratos_session=session-cookie');
      expect(headers.get('x-authenticated-subject')).toBeNull();
      return Response.json({
        id: 'session-1', active: true, authenticated_at: '2026-07-20T12:00:00.000Z',
        identity: {
          id: 'account-1', updated_at: '2026-07-20T11:59:00.000Z',
          traits: { handle: 'ada', email: 'ada@example.test' },
          metadata_public: { role: 'moderator', kind: 'human', roles: ['moderator'] },
        },
      });
    });
    const admission = await authenticateConfiguredChirpRequest(profile('dedicated', {
      mode: 'ory',
      issuer: 'https://identity.example.test',
      sessionEndpoint: 'https://kratos.example.test/sessions/whoami',
      authorizationEndpoint: 'https://keto.example.test/relation-tuples/check',
      authorizationVersion: 'keto-policy-v4',
    }), new Request('https://chirp.example.test', {
      headers: { cookie: 'ory_kratos_session=session-cookie', 'x-authenticated-subject': 'spoofed' },
    }), { fetch: requestFetch as typeof fetch });

    expect(admission).toMatchObject({
      principal: { id: 'account-1', claims: { handle: 'ada', role: 'moderator', kind: 'human', roles: ['moderator'] } },
      trustedContext: { issuer: 'https://identity.example.test', subject: 'account-1', identityProvider: 'ory', sessionVersion: '2026-07-20T11:59:00.000Z' },
      authorizationVersion: 'keto-policy-v4:2026-07-20T11:59:00.000Z',
    });
  });

  it('fails closed for inactive, malformed, unavailable, and insecure Ory admission', async () => {
    const configuration = profile('dedicated', {
      mode: 'ory', issuer: 'https://identity.example.test',
      sessionEndpoint: 'https://kratos.example.test/sessions/whoami', authorizationVersion: 'policy-v1',
    });
    await expect(authenticateConfiguredChirpRequest(configuration, new Request('https://chirp.example.test'), {
      fetch: async () => Response.json({ active: false, identity: { id: 'account-1' } }, { status: 401 }),
    })).rejects.toThrow('did not admit');
    await expect(authenticateConfiguredChirpRequest(configuration, new Request('https://chirp.example.test'), {
      fetch: async () => new Response('<html>proxy error</html>', { status: 502, headers: { 'content-type': 'text/html' } }),
    })).rejects.toThrow('non-JSON');
    await expect(authenticateConfiguredChirpRequest(configuration, new Request('https://chirp.example.test'), {
      fetch: async () => { throw new Error('provider unavailable'); },
    })).rejects.toThrow('failed closed');
    await expect(authenticateConfiguredChirpRequest(profile('dedicated', {
      mode: 'ory', issuer: 'http://identity.example.test',
      sessionEndpoint: 'https://kratos.example.test/sessions/whoami', authorizationVersion: 'policy-v1',
    }), new Request('https://chirp.example.test'))).rejects.toThrow('must use HTTPS');
  });

  it('normalizes Zitadel userinfo and rejects missing bearer credentials or issuer mismatch', async () => {
    const configuration = profile('external', {
      mode: 'zitadel', issuer: 'https://identity.example.test',
      sessionEndpoint: 'https://identity.example.test/oidc/v1/userinfo', authorizationVersion: 'zitadel-policy-v2',
    });
    await expect(authenticateConfiguredChirpRequest(configuration, new Request('https://chirp.example.test')))
      .rejects.toThrow('requires a bearer');

    const admission = await authenticateConfiguredChirpRequest(configuration, new Request('https://chirp.example.test', {
      headers: { authorization: 'Bearer opaque-session-token' },
    }), {
      fetch: async (_input, init) => {
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer opaque-session-token');
        return Response.json({
          sub: 'zitadel-account-1', iss: 'https://identity.example.test', preferred_username: 'grace',
          auth_time: '1721476800',
          'urn:zitadel:iam:org:project:roles': { moderator: { 'org-1': 'chirp' }, member: { 'org-1': 'chirp' } },
        });
      },
    });
    expect(admission).toMatchObject({
      principal: { id: 'zitadel-account-1', claims: { handle: 'grace', role: 'moderator', roles: ['moderator', 'member'] } },
      trustedContext: { issuer: 'https://identity.example.test', subject: 'zitadel-account-1', identityProvider: 'zitadel' },
      authorizationVersion: 'zitadel-policy-v2:1721476800',
    });

    await expect(authenticateConfiguredChirpRequest(configuration, new Request('https://chirp.example.test', {
      headers: { authorization: 'Bearer opaque-session-token' },
    }), { fetch: async () => Response.json({ sub: 'subject', iss: 'https://wrong-issuer.example.test' }) }))
      .rejects.toThrow('configured issuer');
  });

  it('uses Keto for resource-scoped Ory decisions and role claims for Zitadel substitution', async () => {
    process.env.APPLIK8S_INSTALLATION_SPEC = JSON.stringify(profile('dedicated', {
      mode: 'ory', issuer: 'https://identity.example.test',
      sessionEndpoint: 'https://kratos.example.test/sessions/whoami',
      authorizationEndpoint: 'https://keto.example.test/relation-tuples/check',
      authorizationNamespace: 'chirp-posts', authorizationVersion: 'keto-policy-v4',
    }));
    const requestFetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      expect(Object.fromEntries(url.searchParams)).toEqual({
        namespace: 'chirp-posts', object: 'post-1', relation: 'Post.moderate', subject_id: 'moderator-1',
      });
      return Response.json({ allowed: true }, { headers: { etag: 'keto-revision-9' } });
    });
    vi.stubGlobal('fetch', requestFetch);
    await expect(chirpAuthorization.decide({
      principal: { id: 'moderator-1' }, action: 'Post.moderate',
      resource: { apiVersion: 'chirp.dev/v1', kind: 'Post', name: 'post-1', id: 'post-1' }, context: {},
    })).resolves.toMatchObject({ allowed: true, version: 'keto-revision-9' });

    process.env.APPLIK8S_INSTALLATION_SPEC = JSON.stringify(profile('external', {
      mode: 'zitadel', issuer: 'https://identity.example.test',
      sessionEndpoint: 'https://identity.example.test/oidc/v1/userinfo', authorizationVersion: 'zitadel-policy-v2',
    }));
    await expect(chirpAuthorization.decide({
      principal: { id: 'moderator-1', claims: { roles: ['moderator'] } }, action: 'Post.moderate',
      resource: { apiVersion: 'chirp.dev/v1', kind: 'Post', name: 'post-1', id: 'post-1' }, context: {},
    })).resolves.toMatchObject({ allowed: true, version: 'zitadel-policy-v2' });
  });

  it('makes identity and authorization readiness depend on the actual bounded provider endpoints', async () => {
    const configuration = profile('dedicated', {
      mode: 'ory', issuer: 'https://identity.example.test',
      sessionEndpoint: 'https://kratos.example.test/sessions/whoami',
      authorizationEndpoint: 'https://keto.example.test/relation-tuples/check',
      authorizationNamespace: 'chirp-posts', authorizationVersion: 'keto-policy-v4',
    });
    await expect(probeConfiguredChirpIdentity(configuration, {
      fetch: async () => Response.json({ error: { message: 'no valid session' } }, { status: 401 }),
    })).resolves.toBeUndefined();
    await expect(probeConfiguredChirpAuthorization(configuration, {
      fetch: async (input) => {
        expect(new URL(String(input)).searchParams.get('subject_id')).toBe('applik8s-readiness');
        return Response.json({ allowed: false });
      },
    })).resolves.toBeUndefined();
    await expect(probeConfiguredChirpIdentity(configuration, {
      fetch: async () => { throw new Error('dial failed with provider credential material'); },
      timeoutMs: 10,
    })).rejects.toThrow('failed closed');
    await expect(probeConfiguredChirpIdentity(configuration, {
      fetch: async () => Response.json({ error: 'misconfigured' }, { status: 503 }),
    })).rejects.toThrow('HTTP 503');
    await expect(probeConfiguredChirpAuthorization(configuration, {
      fetch: async () => Response.json({ message: 'unauthorized' }, { status: 401 }),
    })).rejects.toThrow('HTTP 401');
  });
});

function profile(
  profileName: ChirpRuntimeProfile['profile'],
  identity: Omit<ChirpRuntimeProfile['identity'], 'infrastructure'> & { readonly infrastructure?: ChirpRuntimeProfile['identity']['infrastructure'] },
): ChirpRuntimeProfile {
  return {
    profile: profileName,
    identity: {
      ...identity,
      infrastructure: identity.infrastructure ?? {
        mode: 'external',
        namespace: 'externally-managed-identity',
        deletionPolicy: 'retain',
      },
    },
  };
}
