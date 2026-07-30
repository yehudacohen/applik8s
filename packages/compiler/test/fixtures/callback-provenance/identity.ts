import type { ApplicationRequestAdmission } from '@applik8s/core';

function normalizeIdentity(request: Request) {
  return request.headers.get('x-user') ?? 'anonymous';
}

export async function authenticateRequest(request: Request): Promise<ApplicationRequestAdmission> {
  const subject = normalizeIdentity(request);
  return {
    principal: {
      id: subject,
      identity: { id: `identity:${subject}`, kind: 'human', issuer: 'fixture', subject },
      kind: 'human',
      authenticationMethod: 'fixture',
      audience: ['fixture'],
      trustedContextDigest: 'fixture-context',
      catalogRevision: 'fixture-catalog-v1',
      authorityRevision: 'v1',
      admittedAt: '2026-01-01T00:00:00.000Z',
    },
    trustedContext: {},
  };
}
