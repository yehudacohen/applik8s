import {
  createDeterministicApplicationAdmission,
  createDeterministicApplicationPrincipal,
} from '@applik8s/identity';
import type { ApplicationDeterministicIdentityOptions } from '@applik8s/identity';
import { describe, expect, it } from 'vitest';

describe('credential-free deterministic identity', () => {
  it('is byte-stable when portable Starter graphs omit an admission instant', () => {
    const options: ApplicationDeterministicIdentityOptions = {
      mode: 'starter',
      application: 'stable-app',
      subject: 'local-developer',
      catalogRevision: 'catalog-v1',
      authorityRevision: 'authority-v1',
    };

    expect(createDeterministicApplicationPrincipal(options)).toEqual(
      createDeterministicApplicationPrincipal(options),
    );
    expect(createDeterministicApplicationPrincipal(options).admittedAt).toBe(
      '1970-01-01T00:00:00.000Z',
    );
  });

  it('produces the one canonical principal and stable context binding', () => {
    const options: ApplicationDeterministicIdentityOptions = {
      mode: 'starter',
      application: 'research',
      subject: 'demo-user',
      roles: ['reviewer', 'administrator'],
      catalogRevision: 'catalog-1',
      authorityRevision: 'authority-1',
      trustedContext: { organizationId: 'organization-1', region: 'local' },
      admittedAt: '2026-07-29T00:00:00.000Z',
    };
    const first = createDeterministicApplicationAdmission(options);
    const reordered = createDeterministicApplicationAdmission({
      ...options,
      trustedContext: { region: 'local', organizationId: 'organization-1' },
    });

    expect(first.principal).toMatchObject({
      id: 'principal:research:deterministic:demo-user',
      identity: {
        id: 'identity:deterministic:demo-user',
        kind: 'human',
        issuer: 'applik8s://research/identity/deterministic',
        subject: 'demo-user',
      },
      kind: 'human',
      authenticationMethod: 'deterministic-starter',
      roles: ['reviewer', 'administrator'],
      audience: ['research'],
      catalogRevision: 'catalog-1',
      authorityRevision: 'authority-1',
      admittedAt: '2026-07-29T00:00:00.000Z',
    });
    expect(first.principal.trustedContextDigest).toBe(
      reordered.principal.trustedContextDigest,
    );
    expect(first.principal).not.toHaveProperty('claims');
    expect(first.trustedContext).toEqual(options.trustedContext);
  });

  it('fails closed for incomplete identity and invalid time bounds', () => {
    expect(() => createDeterministicApplicationPrincipal({
      mode: 'starter',
      application: '',
      subject: 'demo',
      catalogRevision: 'catalog-1',
      authorityRevision: 'authority-1',
    })).toThrow(/application must not be empty/u);
    expect(() => createDeterministicApplicationPrincipal({
      mode: 'starter',
      application: 'research',
      subject: 'demo',
      catalogRevision: 'catalog-1',
      authorityRevision: 'authority-1',
      admittedAt: 'not-a-time',
    })).toThrow(/admittedAt must be an ISO timestamp/u);
    expect(() => createDeterministicApplicationPrincipal({
      mode: 'starter',
      application: 'research',
      subject: 'demo',
      catalogRevision: 'catalog-1',
      authorityRevision: 'authority-1',
      roles: ['reviewer', 'reviewer'],
    })).toThrow(/roles must be unique/u);
  });
});
