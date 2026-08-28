// typecast-file-boundary: Live actor fixtures construct exact admitted authority records and deliberately invalid variants for provider conformance tests.
import { createHash, randomUUID } from 'node:crypto';
import type {
  ApplicationActorTurnAuthority,
  ApplicationAuthorizationReceipt,
} from '@applik8s/applik8s';
import {
  canonicalJsonCompatibleV1Policy,
  canonicalJsonV1String,
} from '@applik8s/core';

/** Canonical live-test authority matching the production actor input contract. */
export function createActorLiveAuthority(
  application: string,
  actorId: string,
  member: string,
  key: string,
  input: object,
): ApplicationActorTurnAuthority & {
  readonly authorizationReceipt: ApplicationAuthorizationReceipt;
} {
  const operationId = `applik8s://actors/${actorId}/operations/${member}` as const;
  const trustedContextDigest = 'sha256:actor-live-context';
  const catalogRevision = 'sha256:actor-live-catalog';
  const authorityRevision = 'sha256:actor-live-authority';
  const admittedAt = new Date().toISOString();
  const inputDigest = `sha256:${createHash('sha256')
    .update(canonicalJsonV1String(input, canonicalJsonCompatibleV1Policy))
    .digest('hex')}`;
  const principal = {
    id: 'principal:actor-live',
    identity: {
      id: 'identity:actor-live',
      kind: 'human' as const,
      issuer: 'applik8s-e2e',
      subject: 'actor-live',
    },
    kind: 'human' as const,
    authenticationMethod: 'e2e',
    audience: [application],
    trustedContextDigest,
    catalogRevision,
    authorityRevision,
    admittedAt,
  };
  return {
    principal: { id: principal.id },
    causalPrincipal: { id: principal.id },
    trustedContextDigest,
    authorizationReceipt: {
      apiVersion: 'applik8s.authorizationReceipt/v1alpha1',
      id: `receipt:${member}:${randomUUID()}`,
      application,
      operationId,
      operationVersion: 'v1',
      catalogRevision,
      authorityRevision,
      principal,
      trustedContextDigest,
      matchedPermissionIds: ['permission:actor-live'],
      matchedGrantIds: ['grant:actor-live'],
      inputDigest,
      target: { kind: 'target', model: actorId, identity: { key } },
      scopeEvidence: [{ kind: 'all' }],
      audience: application,
      transport: member.toLowerCase().includes('alarm')
        || member.toLowerCase().includes('expire')
        ? 'control-plane'
        : 'direct',
      admittedAt,
    },
  };
}
// typecast-file-boundary: Live actor fixtures construct exact admitted authority records and deliberately invalid variants for provider conformance tests.
