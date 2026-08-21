// typecast-file-boundary: Admission tests deliberately inspect signed transport fixtures after verification.
import { createHash } from 'node:crypto';
import {
  type ApplicationRequestAdmission,
  createApplicationAdmissionContextV1,
  withApplicationAdmissionExecutionV1,
} from '@applik8s/core';
import { describe, expect, it } from 'vitest';
import {
  ApplicationExecutionAdmissionError,
  type ApplicationExecutionAdmissionInvocation,
  decodeApplicationExecutionAdmission,
  encodeApplicationExecutionAdmission,
} from '../src/execution-admission-transport.js';
import {
  canonicalInternalJson,
  internalTransportSecret,
  internalTransportSignature,
} from '../src/internal-signing.js';

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

  it('keeps every pre-v0.8 field readable while Release A dual-writes the canonical context', () => {
    const invocation = fixture();
    const token = encodeApplicationExecutionAdmission(secret, invocation);
    const [payload] = token.split('.');
    const decodedWire = JSON.parse(
      Buffer.from(payload!, 'base64url').toString('utf8'),
    ) as ApplicationExecutionAdmissionInvocation;
    const { context, ...legacyReadable } = decodedWire;
    const { context: _expectedContext, ...expectedLegacy } = invocation;

    expect(context.apiVersion).toBe('applik8s.admission/v1');
    expect(legacyReadable).toEqual(expectedLegacy);
  });

  it('accepts the existing raw SHA-256 trusted-context digest convention', () => {
    const invocation = fixture();
    const prefixed = invocation.admission.principal.trustedContextDigest;
    const rawDigest = prefixed.replace(/^sha256:/u, '');
    const rawInvocation = {
      ...invocation,
      context: {
        ...invocation.context,
        principal: {
          ...invocation.context.principal,
          trustedContextDigest: rawDigest,
        },
        trustedContext: {
          ...invocation.context.trustedContext,
          digest: rawDigest,
        },
      },
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

  it('hydrates a canonical context from a pre-v0.8 token without changing its signed fields', () => {
    const invocation = fixture();
    const { context: _context, ...legacy } = invocation;
    const token = encodeLegacyExecutionAdmission(legacy);

    const decoded = decodeApplicationExecutionAdmission(secret, token, {
      executionKind: 'agent',
      workloadIdentityId: invocation.workloadIdentityId,
      ...(invocation.serviceIdentityId
        ? { serviceIdentityId: invocation.serviceIdentityId }
        : {}),
      binding: invocation.binding,
      now,
    });

    expect(decoded.admission).toEqual(invocation.admission);
    expect(decoded.context).toMatchObject({
      apiVersion: 'applik8s.admission/v1',
      principal: invocation.admission.principal,
      operation: {
        id: `applik8s://execution/agent/${invocation.executionId}`,
        transport: 'framework',
      },
      correlationId: invocation.executionId,
      causationId: invocation.id,
      deadline: invocation.expiresAt,
      cancellation: { revision: invocation.cancellationRevision },
    });
  });

  it('rejects a dual-written canonical context that disagrees with compatibility fields', () => {
    const invocation = fixture();
    expect(() => encodeApplicationExecutionAdmission(secret, {
      ...invocation,
      context: {
        ...invocation.context,
        correlationId: 'different-correlation',
        deadline: '2026-07-30T12:04:00.000Z',
      },
    })).toThrow(ApplicationExecutionAdmissionError);
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
  const admission = admitted();
  const id = 'agent-admission-1';
  const expiresAt = '2026-07-30T12:05:00.000Z';
  const cancellationRevision = 'cancel-1';
  return {
    apiVersion: 'applik8s.executionAdmission/v1alpha1',
    id: 'agent-admission-1',
    executionKind: 'agent',
    executionId: 'agent-run-1',
    attempt: 1,
    workloadIdentityId: 'identity:research:workload:aiAgent.researcher',
    serviceIdentityId: 'identity:research:service:researcher',
    context: withApplicationAdmissionExecutionV1(
      createApplicationAdmissionContextV1({
        admission,
        operation: {
          id: 'applik8s://agent/aiAgent.researcher/execute',
          transport: 'framework',
        },
        correlationId: 'conversation-1',
      }),
      {
        causationId: 'protocol-run-1',
        deadline: expiresAt,
        cancellation: { revision: cancellationRevision },
        delivery: { id, source: 'applik8s://agent-gateway' },
      },
    ),
    admission,
    audience: ['identity:research:workload:aiAgent.researcher'],
    causalGrantIds: ['grant-research'],
    cancellationRevision,
    binding: {
      agentId: 'aiAgent.researcher',
      threadId: 'conversation-1',
      runId: 'protocol-run-1',
    },
    issuedAt: now.toISOString(),
    expiresAt,
  };
}

function encodeLegacyExecutionAdmission(
  invocation: Omit<ApplicationExecutionAdmissionInvocation, 'context'>,
): string {
  const payload = Buffer.from(canonicalInternalJson(invocation), 'utf8')
    .toString('base64url');
  return `${payload}.${internalTransportSignature(
    internalTransportSecret(secret),
    payload,
  )}`;
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
