import { describe, expect, it } from 'bun:test';
import {
  createIdentityStartOrySession,
  type IdentityStartFetch,
} from './identity-start-ory-session';

describe('Identity Start Ory session fixture', () => {
  it('derives the expected principal and browser cookie from provider responses', async () => {
    const requests: Request[] = [];
    const fetcher: IdentityStartFetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      if (request.url.endsWith('/admin/identities')) {
        return Response.json(
          { id: 'provider-identity-1' },
          { status: 201 },
        );
      }
      if (request.url.endsWith('/self-service/login/browser')) {
        return responseWithCookies(
          {
            id: 'flow-1',
            ui: {
              nodes: [
                {
                  attributes: {
                    name: 'csrf_token',
                    value: 'csrf-1',
                  },
                },
              ],
            },
          },
          ['ory_csrf=csrf-1; Path=/; HttpOnly'],
        );
      }
      return responseWithCookies(
        { session: { id: 'session-1' } },
        ['ory_kratos_session=session-1; Path=/; HttpOnly'],
      );
    };

    const session = await createIdentityStartOrySession({
      publicUrl: 'http://kratos-public.identity.svc:4433',
      adminUrl: 'http://kratos-admin.identity.svc:4434',
      roles: ['reviewer', 'administrator'],
      fetch: fetcher,
    });

    expect(session).toMatchObject({
      identityId: 'provider-identity-1',
      expectedPrincipal: 'identity:ory:provider-identity-1',
      cookie: 'ory_kratos_session=session-1',
    });
    expect(requests).toHaveLength(3);
    expect(requests[2]?.headers.get('cookie')).toBe('ory_csrf=csrf-1');
    const login = await requests[2]?.json();
    expect(login).toMatchObject({
      method: 'password',
      csrf_token: 'csrf-1',
    });
    const identity = await requests[0]?.json();
    expect(identity).toMatchObject({
      metadata_public: { roles: ['reviewer', 'administrator'] },
    });
    expect(String(login.password)).not.toContain(
      String(identity.traits.email).split('@', 1)[0],
    );
  });

  it('fails closed when the provider does not issue a session cookie', async () => {
    let request = 0;
    const fetcher: IdentityStartFetch = async () => {
      request += 1;
      if (request === 1) {
        return Response.json({ id: 'identity-1' }, { status: 201 });
      }
      if (request === 2) {
        return Response.json({ id: 'flow-1', ui: { nodes: [] } });
      }
      return Response.json({ session: { id: 'session-1' } });
    };

    await expect(
      createIdentityStartOrySession({
        publicUrl: 'http://kratos-public.identity.svc:4433',
        adminUrl: 'http://kratos-admin.identity.svc:4434',
        roles: ['reviewer'],
        fetch: fetcher,
      }),
    ).rejects.toThrow(/did not return a session cookie/);
  });
});

function responseWithCookies(
  body: unknown,
  cookies: readonly string[],
): Response {
  const headers = new Headers({ 'content-type': 'application/json' });
  for (const cookie of cookies) headers.append('set-cookie', cookie);
  return new Response(JSON.stringify(body), { status: 200, headers });
}
