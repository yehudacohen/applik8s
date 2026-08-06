// typecast-file-boundary: Admission tests deliberately inspect signed transport fixtures after verification.
import { createHash } from 'node:crypto';
import type { ApplicationRequestAdmission } from '@applik8s/core';
import { describe, expect, it } from 'vitest';
import {
  ApplicationExecutionAdmissionError,
  type ApplicationExecutionAdmissionInvocation,
  decodeApplicationExecutionAdmission,
  encodeApplicationExecutionAdmission,
} from '../src/execution-admission-transport.js';

const secret = 'execution-admission-secret-at-least-32-bytes';
const now = new Date('2026-07-30T12:00:00.000Z');

describe('execution admission transport', () => {
  it('binds one caller admission to one concrete agent run', () => {
    const invocation = fixture();
    const token = encodeApplicationExecutionAdmission(secret, invocation);

    expect(
      decodeApplicationExecutionAdmission(secret, token, {
        executionKind: 'agent',
        workloadIdentityId: invocation.workloadIdentityId,
        ...(invocation.serviceIdentityId
          ? { serviceIdentityId: invocation.serviceIdentityId }
          : {}),
        binding: invocation.binding,
        now,
      }),
    ).toEqual(invocation);
    expect(token).not.toContain('oauth-access-token');
  });

  it('accepts the existing raw SHA-256 trusted-context digest convention', () => {
    const invocation = fixture();
    const prefixed = invocation.admission.principal.trustedContextDigest;
    const rawDigest = prefixed.replace(/^sha256:/u, '');
    const rawInvocation = {
      ...invocation,
      admission: {
        ...invocation.admission,
        principal: {
          ...invocation.admission.principal,
          trustedContextDigest: rawDigest,
        },
      },
    };
    const token = encodeApplicationExecutionAdmission(
      secret,
      rawInvocation,
    );
    expect(
      decodeApplicationExecutionAdmission(secret, token, {
        executionKind: 'agent',
        workloadIdentityId: invocation.workloadIdentityId,
        ...(invocation.serviceIdentityId
          ? { serviceIdentityId: invocation.serviceIdentityId }
          : {}),
        binding: invocation.binding,
        now,
      }).admission.principal.trustedContextDigest,
    ).toBe(rawDigest);
  });

  it('rejects signature, run binding, identity, and expiry mismatches', () => {
    const invocation = fixture();
    const token = encodeApplicationExecutionAdmission(secret, invocation);
    const expectation = {
      executionKind: 'agent' as const,
      workloadIdentityId: invocation.workloadIdentityId,
      ...(invocation.serviceIdentityId
        ? { serviceIdentityId: invocation.serviceIdentityId }
        : {}),
      binding: invocation.binding,
      now,
    };

    expect(() =>
      decodeApplicationExecutionAdmission(
        secret,
        `${token.slice(0, -1)}x`,
        expectation,
      )).toThrow(/signature/u);
    expect(() =>
      decodeApplicationExecutionAdmission(secret, token, {
        ...expectation,
        binding: { ...invocation.binding, runId: 'other-run' },
      })).toThrow(ApplicationExecutionAdmissionError);
    expect(() =>
      decodeApplicationExecutionAdmission(secret, token, {
        ...expectation,
        workloadIdentityId: 'identity:other',
      })).toThrow(ApplicationExecutionAdmissionError);
    expect(() =>
      decodeApplicationExecutionAdmission(secret, token, {
        ...expectation,
        now: new Date('2026-07-30T12:06:00.000Z'),
      })).toThrow(ApplicationExecutionAdmissionError);
  });

  it('rejects a caller admission whose trusted context was changed', () => {
    const invocation = fixture();
    expect(() =>
      encodeApplicationExecutionAdmission(secret, {
        ...invocation,
        admission: {
          ...invocation.admission,
          trustedContext: { tenant: 'other-tenant' },
        },
      })).toThrow(ApplicationExecutionAdmissionError);
  });

  it('rejects public credential material in the signed causal context', () => {
    const invocation = fixture();
    const trustedContext = { authorization: 'Bearer oauth-access-token' };
    expect(() =>
      encodeApplicationExecutionAdmission(secret, {
        ...invocation,
        admission: {
          principal: {
            ...invocation.admission.principal,
            trustedContextDigest: `sha256:${createHash('sha256')
              .update('{"authorization":"Bearer oauth-access-token"}')
              .digest('hex')}`,
          },
          trustedContext,
        },
      })).toThrow(/Credential field/u);
  });
});

function fixture(): ApplicationExecutionAdmissionInvocation {
  return {
    apiVersion: 'applik8s.executionAdmission/v1alpha1',
    id: 'agent-admission-1',
    executionKind: 'agent',
    executionId: 'agent-run-1',
    attempt: 1,
    workloadIdentityId: 'identity:research:workload:aiAgent.researcher',
    serviceIdentityId: 'identity:research:service:researcher',
    admission: admitted(),
    audience: ['identity:research:workload:aiAgent.researcher'],
    causalGrantIds: ['grant-research'],
    cancellationRevision: 'cancel-1',
    binding: {
      agentId: 'aiAgent.researcher',
      threadId: 'conversation-1',
      runId: 'protocol-run-1',
    },
    issuedAt: now.toISOString(),
    expiresAt: '2026-07-30T12:05:00.000Z',
  };
}

function admitted(): ApplicationRequestAdmission {
  const trustedContext = { tenant: 'tenant-1' };
  return {
    principal: {
      id: 'principal-1',
      identity: {
        id: 'identity-1',
        kind: 'human',
        issuer: 'https://identity.example.test',
        subject: 'user-1',
      },
      kind: 'human',
      authenticationMethod: 'oauth-bearer',
      audience: ['https://research.example.test'],
      trustedContextDigest: `sha256:${createHash('sha256')
        .update('{"tenant":"tenant-1"}')
        .digest('hex')}`,
      catalogRevision: 'catalog-1',
      authorityRevision: 'authority-1',
      admittedAt: now.toISOString(),
      expiresAt: '2026-07-30T12:10:00.000Z',
    },
    trustedContext,
  };
}
