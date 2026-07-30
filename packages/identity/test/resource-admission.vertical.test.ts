import type {
  ApplicationPrincipal,
} from '@applik8s/core';
import { describe, expect, it, vi } from 'vitest';
import {
  ApplicationOAuthResourceAdmissionError,
  createApplicationOAuthResourceAdmission,
} from '../src/resource-admission.js';

const resource = 'https://research.example.test/mcp';
const now = new Date('2026-07-29T12:00:00.000Z');

describe('OAuth protected-resource admission', () => {
  it('introspects a header credential and delegates canonical principal admission', async () => {
    const introspectToken = vi.fn(async () => ({
      active: true,
      clientId: 'client-1',
      subject: 'user-1',
      scope: ['operations:invoke', 'profile'],
      audience: [resource],
      issuer: 'https://identity.example.test',
      tokenType: 'Bearer',
      expiresAt: now.getTime() / 1_000 + 300,
    }));
    const admit = createApplicationOAuthResourceAdmission({
      provider: { introspectToken },
      clock: () => now,
      admitPrincipal: (input) => principal(input.trustedContextDigest),
    });

    const admission = await admit(
      request('Bearer opaque-token'),
      context(),
    );

    expect(introspectToken).toHaveBeenCalledWith('opaque-token');
    expect(admission).toMatchObject({
      principal: {
        id: 'principal-1',
        clientId: 'client-1',
        audience: [resource],
      },
      trustedContext: {
        oauth: {
          subject: 'user-1',
          clientId: 'client-1',
          scopes: ['operations:invoke', 'profile'],
          audience: [resource],
        },
      },
    });
  });

  it.each([
    {
      name: 'revoked token',
      introspection: {
        active: false,
        scope: ['operations:invoke'],
        audience: [resource],
      },
      code: 'OAUTH_TOKEN_INACTIVE',
    },
    {
      name: 'wrong audience',
      introspection: {
        active: true,
        subject: 'user-1',
        scope: ['operations:invoke'],
        audience: ['https://other.example.test/mcp'],
      },
      code: 'OAUTH_AUDIENCE_DENIED',
    },
    {
      name: 'missing scope',
      introspection: {
        active: true,
        subject: 'user-1',
        scope: ['profile'],
        audience: [resource],
      },
      code: 'OAUTH_SCOPE_DENIED',
    },
    {
      name: 'expired token',
      introspection: {
        active: true,
        subject: 'user-1',
        scope: ['operations:invoke'],
        audience: [resource],
        expiresAt: now.getTime() / 1_000,
      },
      code: 'OAUTH_TOKEN_EXPIRED',
    },
  ])('rejects a $name', async ({ introspection, code }) => {
    const admit = createApplicationOAuthResourceAdmission({
      provider: { introspectToken: async () => introspection },
      clock: () => now,
      admitPrincipal: (input) => principal(input.trustedContextDigest),
    });

    await expect(admit(request('Bearer token'), context())).rejects.toMatchObject({
      code,
    });
  });

  it('rejects query-string and malformed bearer credentials before introspection', async () => {
    const introspectToken = vi.fn(async () => ({
      active: true,
      subject: 'user-1',
      scope: ['operations:invoke'],
      audience: [resource],
    }));
    const admit = createApplicationOAuthResourceAdmission({
      provider: { introspectToken },
      clock: () => now,
      admitPrincipal: (input) => principal(input.trustedContextDigest),
    });

    await expect(
      admit(
        new Request(`${resource}?access_token=secret`, {
          headers: { authorization: 'Bearer secret' },
        }),
        context(),
      ),
    ).rejects.toBeInstanceOf(ApplicationOAuthResourceAdmissionError);
    await expect(
      admit(request('Bearer one, Bearer two'), context()),
    ).rejects.toMatchObject({ code: 'OAUTH_AUTHENTICATION_REQUIRED' });
    expect(introspectToken).not.toHaveBeenCalled();
  });

  it('rejects a canonical principal that diverges from provider evidence', async () => {
    const admit = createApplicationOAuthResourceAdmission({
      provider: {
        introspectToken: async () => ({
          active: true,
          clientId: 'client-1',
          subject: 'user-1',
          scope: ['operations:invoke'],
          audience: [resource],
          issuer: 'https://identity.example.test',
        }),
      },
      clock: () => now,
      admitPrincipal: (input) => ({
        ...principal(input.trustedContextDigest),
        identity: {
          ...principal(input.trustedContextDigest).identity,
          subject: 'attacker',
        },
      }),
    });

    await expect(admit(request('Bearer token'), context())).rejects.toMatchObject({
      code: 'OAUTH_PRINCIPAL_INVALID',
    });
  });
});

function context() {
  return {
    audience: resource,
    resource,
    requiredScopes: ['operations:invoke'],
  };
}

function request(authorization: string): Request {
  return new Request(resource, { headers: { authorization } });
}

function principal(trustedContextDigest: string): ApplicationPrincipal {
  return {
    id: 'principal-1',
    identity: {
      id: 'identity-1',
      kind: 'human',
      issuer: 'https://identity.example.test',
      subject: 'user-1',
    },
    kind: 'human',
    authenticationMethod: 'oauth-bearer',
    audience: [resource],
    trustedContextDigest,
    catalogRevision: 'catalog-1',
    authorityRevision: 'authority-1',
    admittedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 300_000).toISOString(),
    clientId: 'client-1',
  };
}
