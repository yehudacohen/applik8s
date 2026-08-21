import type {
  ApplicationAuthorizationReceipt,
  ApplicationRequestAdmission,
} from '@applik8s/core';
import {
  createApplicationAdmissionContextV1,
  withApplicationAdmissionExecutionV1,
} from '@applik8s/core';
import { describe, expect, it } from 'vitest';
import {
  type ApplicationInternalOperationInvocation,
  ApplicationInternalOperationTransportError,
  decodeApplicationInternalOperationInvocation,
  encodeApplicationInternalOperationInvocation,
} from '../src/internal-transport.js';
import {
  canonicalInternalJson,
  internalTransportSecret,
  internalTransportSignature,
} from '../src/internal-signing.js';

const secret = 'internal-transport-secret-at-least-32-bytes';
const now = new Date('2026-07-30T00:00:00.000Z');

describe('internal operation transport', () => {
  it('round-trips a short-lived MCP authority envelope', () => {
    const invocation = fixture();
    const token = encodeApplicationInternalOperationInvocation(
      secret,
      invocation,
    );

    expect(
      decodeApplicationInternalOperationInvocation(secret, token, {
        operationId: invocation.operationId,
        operationVersion: invocation.operationVersion,
        inputDigest: invocation.inputDigest,
        audience: invocation.audience,
        now,
      }),
    ).toEqual(invocation);
    expect(
      decodeApplicationInternalOperationInvocation(secret, token, {
        operationId: invocation.operationId,
        operationVersion: invocation.operationVersion,
        inputDigest: invocation.inputDigest,
        audience: [
          'https://other.example.test/mcp',
          invocation.audience,
        ],
        now,
      }),
    ).toEqual(invocation);
    expect(token).not.toContain('oauth-access-token');
  });

  it('rejects signature, operation, input, audience, and expiry mismatches', () => {
    const invocation = fixture();
    const token = encodeApplicationInternalOperationInvocation(
      secret,
      invocation,
    );
    const expected = {
      operationId: invocation.operationId,
      operationVersion: invocation.operationVersion,
      inputDigest: invocation.inputDigest,
      audience: invocation.audience,
      now,
    };

    expect(() =>
      decodeApplicationInternalOperationInvocation(
        secret,
        `${token.slice(0, -1)}x`,
        expected,
      ),
    ).toThrow(/signature/u);
    expect(() =>
      decodeApplicationInternalOperationInvocation(secret, token, {
        ...expected,
        operationId: 'applik8s://queries/Other/operations/read',
      }),
    ).toThrow(ApplicationInternalOperationTransportError);
    expect(() =>
      decodeApplicationInternalOperationInvocation(secret, token, {
        ...expected,
        inputDigest: 'sha256:other',
      }),
    ).toThrow(ApplicationInternalOperationTransportError);
    expect(() =>
      decodeApplicationInternalOperationInvocation(secret, token, {
        ...expected,
        audience: 'https://other.example.test/mcp',
      }),
    ).toThrow(ApplicationInternalOperationTransportError);
    expect(() =>
      decodeApplicationInternalOperationInvocation(secret, token, {
        ...expected,
        now: new Date('2026-07-30T00:01:00.000Z'),
      }),
    ).toThrow(ApplicationInternalOperationTransportError);
  });

  it('hydrates a canonical context from a pre-v0.8 internal invocation', () => {
    const invocation = fixture();
    const { context: _context, ...legacy } = invocation;
    const token = encodeLegacyInternalInvocation(legacy);
    const decoded = decodeApplicationInternalOperationInvocation(
      secret,
      token,
      {
        operationId: invocation.operationId,
        operationVersion: invocation.operationVersion,
        inputDigest: invocation.inputDigest,
        audience: invocation.audience,
        now,
      },
    );

    expect(decoded.context).toMatchObject({
      apiVersion: 'applik8s.admission/v1',
      principal: invocation.admission.principal,
      operation: {
        id: invocation.operationId,
        transport: 'mcp',
      },
      correlationId: invocation.source.sessionId,
      deadline: invocation.expiresAt,
      authorizationReceipt: invocation.authorizationReceipt,
      delivery: { id: invocation.id },
    });
  });

  it('rejects inconsistent authorization evidence before signing', () => {
    const invocation = fixture();
    expect(() =>
      encodeApplicationInternalOperationInvocation(secret, {
        ...invocation,
        authorizationReceipt: {
          ...invocation.authorizationReceipt,
          transport: 'http',
        },
      }),
    ).toThrow(/authority evidence/u);
    expect(() =>
      encodeApplicationInternalOperationInvocation(secret, {
        ...invocation,
        context: {
          ...invocation.context,
          operation: {
            ...invocation.context.operation,
            id: 'applik8s://models/Other/operations/update',
          },
        },
      }),
    ).toThrow(/canonical admission context/u);
  });

  it.each([
    ['accessToken', 'secret'],
    ['refresh_token', 'secret'],
    ['authorization', 'Bearer secret'],
    ['nested', { password: 'secret' }],
    ['header', 'Bearer secret'],
  ])('rejects credential passthrough through trusted-context field %s', (key, value) => {
    const invocation = fixture({
      trustedContext: { tenant: 'tenant-1', [key]: value },
    });
    expect(() =>
      encodeApplicationInternalOperationInvocation(secret, invocation),
    ).toThrow(/forbidden/u);
  });
});

function fixture(
  admissionOverrides: Partial<ApplicationRequestAdmission> = {},
): ApplicationInternalOperationInvocation {
  const admission: ApplicationRequestAdmission = {
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
      audience: ['https://research.example.test/mcp'],
      trustedContextDigest: 'context-1',
      catalogRevision: 'catalog-1',
      authorityRevision: 'authority-1',
      admittedAt: now.toISOString(),
      expiresAt: '2026-07-30T00:05:00.000Z',
      clientId: 'client-1',
    },
    trustedContext: { tenant: 'tenant-1' },
    ...admissionOverrides,
  };
  const receipt: ApplicationAuthorizationReceipt = {
    apiVersion: 'applik8s.authorizationReceipt/v1alpha1',
    id: 'receipt-1',
    application: 'research',
    operationId: 'applik8s://queries/Evidence/operations/search',
    operationVersion: 'v1',
    catalogRevision: 'catalog-1',
    authorityRevision: 'authority-1',
    principal: admission.principal,
    trustedContextDigest: 'context-1',
    matchedPermissionIds: ['permission-search'],
    matchedGrantIds: ['grant-search'],
    inputDigest: 'sha256:input',
    target: { kind: 'all' },
    scopeEvidence: [{ kind: 'all' }],
    audience: 'https://research.example.test/mcp',
    transport: 'mcp',
    admittedAt: now.toISOString(),
    expiresAt: '2026-07-30T00:00:30.000Z',
  };
  return {
    apiVersion: 'applik8s.internalOperation/v1alpha1',
    id: 'invocation-1',
    operationId: receipt.operationId,
    operationVersion: receipt.operationVersion,
    inputDigest: receipt.inputDigest,
    audience: receipt.audience,
    source: {
      transport: 'mcp',
      workloadId: 'mcpServer.research',
      sessionId: 'session-1',
    },
    context: withApplicationAdmissionExecutionV1(
      createApplicationAdmissionContextV1({
        admission,
        operation: { id: receipt.operationId, transport: 'mcp' },
        correlationId: 'session-1',
      }),
      {
        causationId: 'invocation-1',
        deadline: '2026-07-30T00:00:30.000Z',
        authorizationReceipt: receipt,
        delivery: {
          id: 'invocation-1',
          source: 'applik8s://internal-operation/mcpServer.research',
        },
      },
    ),
    admission,
    authorizationReceipt: receipt,
    idempotencyKey: 'idempotency-1',
    issuedAt: now.toISOString(),
    expiresAt: '2026-07-30T00:00:30.000Z',
  };
}

function encodeLegacyInternalInvocation(
  invocation: Omit<ApplicationInternalOperationInvocation, 'context'>,
): string {
  const payload = Buffer.from(canonicalInternalJson(invocation), 'utf8')
    .toString('base64url');
  return `${payload}.${internalTransportSignature(
    internalTransportSecret(secret),
    payload,
  )}`;
}
