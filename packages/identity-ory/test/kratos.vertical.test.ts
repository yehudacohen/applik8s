import { describe, expect, it } from 'vitest';
import {
  OryAdapterError,
  OryKratosIdentityAdapter,
} from '../src/index.js';

describe('Ory Kratos identity adapter', () => {
  it('admits one canonical human principal from a server-side session cookie', async () => {
    const requests: Request[] = [];
    const adapter = new OryKratosIdentityAdapter({
      publicUrl: 'http://kratos-public.identity.svc/',
      adminUrl: 'http://kratos-admin.identity.svc/',
      issuer: 'https://identity.example.test',
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        return Response.json(sessionFixture());
      },
    });
    const request = new Request('https://application.example.test/account', {
      headers: {
        cookie: 'ory_kratos_session=session-cookie',
        authorization: 'Bearer must-not-pass-through',
      },
    });

    const principal = await adapter.authenticate(request, {
      application: 'identity-test',
      catalogRevision: 'catalog-1',
      authorityRevision: 'authority-1',
      trustedContextDigest: 'context-1',
      audience: ['https://application.example.test'],
      now: new Date('2026-07-29T00:00:00.000Z'),
    });

    expect(principal).toMatchObject({
      kind: 'human',
      identity: {
        id: 'identity:ory:human-1',
        issuer: 'https://identity.example.test',
        subject: 'human-1',
      },
      sessionId: 'session-1',
      authenticationMethod: 'ory:password+totp',
      authorityRevision: 'authority-1',
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(
      'http://kratos-public.identity.svc/sessions/whoami',
    );
    expect(requests[0]?.headers.get('cookie')).toBe(
      'ory_kratos_session=session-cookie',
    );
    expect(requests[0]?.headers.has('authorization')).toBe(false);
  });

  it('rejects native session tokens unless the boundary opts in', async () => {
    let called = false;
    const adapter = new OryKratosIdentityAdapter({
      publicUrl: 'http://kratos-public.identity.svc/',
      adminUrl: 'http://kratos-admin.identity.svc/',
      issuer: 'https://identity.example.test',
      fetch: async () => {
        called = true;
        return Response.json(sessionFixture());
      },
    });

    await expect(
      adapter.session(
        new Request('https://application.example.test', {
          headers: { 'x-session-token': 'native-secret' },
        }),
      ),
    ).rejects.toMatchObject({
      code: 'ORY_UNAUTHORIZED',
      status: 401,
    });
    expect(called).toBe(false);
  });

  it('revokes through the admin endpoint and classifies missing sessions as expired', async () => {
    const requests: Request[] = [];
    const adapter = new OryKratosIdentityAdapter({
      publicUrl: 'http://kratos-public.identity.svc/',
      adminUrl: 'http://kratos-admin.identity.svc/',
      issuer: 'https://identity.example.test',
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        if (request.method === 'DELETE') return new Response(null, { status: 204 });
        return Response.json(
          { error: { message: 'not found' } },
          { status: 404 },
        );
      },
    });

    await expect(adapter.revokeSession('session-1', 'local admission failed'))
      .resolves.toMatchObject({ revoked: true, sessionId: 'session-1' });
    await expect(adapter.sessionState('session-missing')).resolves.toBe(
      'expired',
    );
    expect(requests.map((request) => `${request.method} ${request.url}`))
      .toEqual([
        'DELETE http://kratos-admin.identity.svc/admin/sessions/session-1',
        'GET http://kratos-admin.identity.svc/admin/sessions/session-missing',
      ]);
  });

  it('rejects inactive or malformed session evidence', async () => {
    const adapter = new OryKratosIdentityAdapter({
      publicUrl: 'http://kratos-public.identity.svc/',
      adminUrl: 'http://kratos-admin.identity.svc/',
      issuer: 'https://identity.example.test',
      fetch: async () => Response.json({ ...sessionFixture(), active: false }),
    });

    await expect(
      adapter.session(
        new Request('https://application.example.test', {
          headers: { cookie: 'ory_kratos_session=session-cookie' },
        }),
      ),
    ).rejects.toBeInstanceOf(OryAdapterError);
  });
});

function sessionFixture() {
  return {
    id: 'session-1',
    active: true,
    authenticated_at: '2026-07-29T00:00:00.000Z',
    issued_at: '2026-07-29T00:00:00.000Z',
    expires_at: '2026-07-29T01:00:00.000Z',
    authenticator_assurance_level: 'aal2',
    authentication_methods: [
      { method: 'password', completed_at: '2026-07-29T00:00:00.000Z' },
      { method: 'totp', completed_at: '2026-07-29T00:00:00.000Z' },
    ],
    identity: {
      id: 'human-1',
      schema_id: 'human',
      schema_url: 'https://identity.example.test/schemas/human',
      traits: { email: 'hidden@example.test' },
    },
  };
}
