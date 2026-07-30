import { createDeterministicApplicationAdmission } from '@applik8s/identity';

export function fixtureAdmission(id: string) {
  return createDeterministicApplicationAdmission({
    mode: 'starter',
    application: 'vite-facade-fixture',
    subject: id,
    catalogRevision: 'fixture-catalog-v1',
    authorityRevision: 'fixture-v1',
    admittedAt: '2026-01-01T00:00:00.000Z',
  });
}
