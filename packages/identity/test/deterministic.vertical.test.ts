import {
  createDeterministicApplicationAdmission,
  createDeterministicApplicationPrincipal,
  type ApplicationDeterministicIdentityOptions,
} from '@applik8s/identity';
import { describe, expect, it } from 'vitest';

describe('credential-free deterministic identity', () => {
  it('produces the one canonical principal and stable context binding', () => {
    const options: ApplicationDeterministicIdentityOptions = {
      mode: 'starter',
      application: 'research',
      subject: 'demo-user',
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
  });
});
