import {
  ApplicationIdentityClientError,
  applicationIdentityHttpProtocol,
  createApplicationIdentityClient,
  type ApplicationIdentitySessionView,
  type ApplicationOAuthClientView,
} from '@applik8s/identity/client';
import {
  ApplicationIdentityHttpError,
  createApplicationIdentityHttpHandler,
  type ApplicationIdentityHttpOperations,
} from '@applik8s/identity/server';
import { describe, expect, it, vi } from 'vitest';

const anonymousSession: ApplicationIdentitySessionView = {
  protocol: applicationIdentityHttpProtocol,
  kind: 'session',
  authenticated: false,
  assurance: [],
};

const clientView: ApplicationOAuthClientView = {
  protocol: applicationIdentityHttpProtocol,
  kind: 'oauth-client',
  id: 'client-1',
  name: 'CLI',
  type: 'public',
  redirectUris: ['http://127.0.0.1/callback'],
  allowedScopes: ['profile'],
  revision: '1',
  state: 'active',
  createdAt: '2026-07-29T00:00:00.000Z',
  updatedAt: '2026-07-29T00:00:00.000Z',
};

describe('framework-neutral identity HTTP seams', () => {
  it('keeps the browser client provider-neutral and same-origin', async () => {
    const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('/identity/clients');
      expect(init?.credentials).toBe('same-origin');
      return new Response(JSON.stringify({
        protocol: applicationIdentityHttpProtocol,
        kind: 'oauth-client-list',
        items: [clientView],
      }), { headers: { 'content-type': 'application/json' } });
    });
    const client = createApplicationIdentityClient({
      baseUrl: '/identity',
      fetch: testFetch(request),
    });

    await expect(client.clients()).resolves.toEqual([clientView]);
    expect(JSON.stringify(await client.clients())).not.toMatch(/kratos|hydra|cookie|token/u);
  });

  it('routes account flows without exposing provider failures', async () => {
    const operations = identityOperations({
      async beginFlow(kind) {
        expect(kind).toBe('recover');
        throw new Error('provider says user@example.com does not exist');
      },
    });
    const handle = createApplicationIdentityHttpHandler({ operations });
    const response = await handle(new Request(
      'http://application.local/__applik8s/v1/identity/flows/recover',
      { method: 'POST', body: JSON.stringify({ subject: 'user@example.com' }) },
    ));
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(text).toContain('The identity request could not be completed.');
    expect(text).not.toContain('user@example.com');
    expect(text).not.toContain('provider says');
  });

  it('preserves typed public retry semantics', async () => {
    const handle = createApplicationIdentityHttpHandler({
      operations: identityOperations({
        async session() {
          throw new ApplicationIdentityHttpError('rate_limited', 'Try again later.', 30);
        },
      }),
    });
    const client = createApplicationIdentityClient({
      fetch: testFetch(async (input, init) => handle(new Request(
        new URL(String(input), 'http://application.local'),
        init,
      ))),
    });

    await expect(client.session()).rejects.toMatchObject({
      name: 'ApplicationIdentityClientError',
      code: 'rate_limited',
      status: 429,
      retryable: true,
      retryAfterSeconds: 30,
    } satisfies Partial<ApplicationIdentityClientError>);
  });

  it('validates OAuth client requests before invoking application operations', async () => {
    const createClient = vi.fn();
    const handle = createApplicationIdentityHttpHandler({
      operations: identityOperations({ createClient }),
    });
    const response = await handle(new Request(
      'http://application.local/__applik8s/v1/identity/clients',
      { method: 'POST', body: JSON.stringify({ name: 'bad', type: 'public' }) },
    ));

    expect(response.status).toBe(400);
    expect(createClient).not.toHaveBeenCalled();
  });
});

function identityOperations(
  overrides: Partial<ApplicationIdentityHttpOperations> = {},
): ApplicationIdentityHttpOperations {
  return {
    async session() { return anonymousSession; },
    async beginFlow(kind) {
      return {
        protocol: applicationIdentityHttpProtocol,
        kind: 'flow',
        id: 'flow-1',
        flowKind: kind,
        state: 'active',
        allowedTransitions: ['complete'],
        issuedAt: '2026-07-29T00:00:00.000Z',
        expiresAt: '2026-07-29T00:10:00.000Z',
      };
    },
    async transitionFlow() { return anonymousSession; },
    async cancelFlow() { throw new Error('not implemented'); },
    async logout() { return anonymousSession; },
    async account() { throw new Error('not implemented'); },
    async updateAccount() { throw new Error('not implemented'); },
    async beginMfa() { throw new Error('not implemented'); },
    async completeMfa() { throw new Error('not implemented'); },
    async removeMfa() { throw new Error('not implemented'); },
    async consent() { throw new Error('not implemented'); },
    async decideConsent() { throw new Error('not implemented'); },
    async clients() { return [clientView]; },
    async createClient() { throw new Error('not implemented'); },
    async rotateClient() { throw new Error('not implemented'); },
    async revokeClient() { throw new Error('not implemented'); },
    ...overrides,
  };
}

function testFetch(
  implementation: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
): typeof globalThis.fetch {
  // typecast: Bun augments fetch with preconnect; the identity client exercises only the standards-based callable contract.
  return implementation as unknown as typeof globalThis.fetch;
}
