import type {
  ApplicationAuthorizationReceipt,
  ApplicationOperationDescriptor,
  ApplicationRequestAdmission,
  JsonValue,
} from '@applik8s/core';
import {
  createApplicationAdmissionContextV1,
  withApplicationAdmissionExecutionV1,
} from '@applik8s/core';
import { describe, expect, it, vi } from 'vitest';
import {
  type ApplicationInternalOperationBinding,
  type ApplicationInternalOperationHandlerOptions,
  createApplicationInternalOperationHandler,
} from '../src/internal-handler.js';
import {
  applicationInternalOperationInputDigest,
  encodeApplicationInternalOperationInvocation,
} from '../src/internal-transport.js';

const secret = 'internal-handler-secret-at-least-32-bytes';
const now = new Date('2026-07-30T00:00:00.000Z');
const operation = descriptor();
type Revalidate = ApplicationInternalOperationHandlerOptions['revalidate'];
type Invoke = ApplicationInternalOperationBinding['invoke'];

describe('internal operation placement handler', () => {
  it('verifies, revalidates, and invokes the existing operation binding', async () => {
    const revalidate = vi.fn<Revalidate>(async () => true);
    const invoke = vi.fn<Invoke>(async (input: JsonValue) => ({
      echoed: input,
    }));
    const handle = createApplicationInternalOperationHandler({
      secret,
      bindings: [{
        operation,
        audiences: ['https://research.example.test/mcp'],
        validateInput: (value) => value,
        validateOutput: (value) => value,
        invoke,
      }],
      revalidate,
      clock: () => now,
    });
    const input = { query: 'evidence' };
    const response = await handle(request(input));

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({
      value: { echoed: input },
      invocationId: 'invocation-1',
    });
    expect(revalidate).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith(
      input,
      expect.objectContaining({
        invocation: expect.objectContaining({ id: 'invocation-1' }),
      }),
    );
  });

  it('rejects public credential passthrough before placement invocation', async () => {
    const revalidate = vi.fn<Revalidate>();
    const invoke = vi.fn<Invoke>();
    const handle = handler(revalidate, invoke);
    const withCredential = request({}, {
      authorization: 'Bearer inbound-oauth-token',
    });
    const response = await handle(withCredential);

    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toEqual({
      error: 'credential_passthrough_forbidden',
    });
    expect(revalidate).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('rejects input tampering and stale authority without invoking', async () => {
    const invoke = vi.fn<Invoke>();
    const validInput = { query: 'evidence' };
    const tampered = request(
      { query: 'different' },
      {},
      invocationToken(validInput),
    );
    const tamperedResponse = await handler(vi.fn<Revalidate>(async () => true), invoke)(
      tampered,
    );
    expect(tamperedResponse?.status).toBe(400);

    const staleResponse = await handler(vi.fn<Revalidate>(async () => false), invoke)(
      request(validInput),
    );
    expect(staleResponse?.status).toBe(403);
    await expect(staleResponse?.json()).resolves.toEqual({
      error: 'authorization_stale',
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('does not claim unrelated routes', async () => {
    const handle = handler(vi.fn<Revalidate>(async () => true), vi.fn<Invoke>());
    await expect(
      handle(new Request('https://internal.example.test/healthz')),
    ).resolves.toBeUndefined();
  });
});

function handler(revalidate: Revalidate, invoke: Invoke) {
  return createApplicationInternalOperationHandler({
    secret,
    bindings: [{
      operation,
      audiences: ['https://research.example.test/mcp'],
      validateInput: (value) => value,
      validateOutput: (value) => value,
      invoke,
    }],
    revalidate,
    clock: () => now,
  });
}

function request(
  input: JsonValue,
  headers: Readonly<Record<string, string>> = {},
  token = invocationToken(input),
): Request {
  return new Request(
    'https://internal.example.test/__applik8s/internal/v1/operations',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...headers,
      },
      body: JSON.stringify({ operationId: operation.id, input, invocation: token }),
    },
  );
}

function invocationToken(input: JsonValue): string {
  const inputDigest = applicationInternalOperationInputDigest(input);
  const admission = admitted();
  const authorizationReceipt = receipt(admission, inputDigest);
  return encodeApplicationInternalOperationInvocation(secret, {
    apiVersion: 'applik8s.internalOperation/v1alpha1',
    id: 'invocation-1',
    operationId: operation.id,
    operationVersion: operation.version,
    inputDigest,
    audience: 'https://research.example.test/mcp',
    source: {
      transport: 'mcp',
      workloadId: 'mcpServer.research',
      sessionId: 'session-1',
    },
    context: withApplicationAdmissionExecutionV1(
      createApplicationAdmissionContextV1({
        admission,
        operation: { id: operation.id, transport: 'mcp' },
        correlationId: 'session-1',
      }),
      {
        causationId: 'invocation-1',
        deadline: '2026-07-30T00:00:30.000Z',
        authorizationReceipt,
        delivery: {
          id: 'invocation-1',
          source: 'applik8s://internal-operation/mcpServer.research',
        },
      },
    ),
    admission,
    authorizationReceipt,
    issuedAt: now.toISOString(),
    expiresAt: '2026-07-30T00:00:30.000Z',
  });
}

function descriptor(): ApplicationOperationDescriptor {
  return {
    apiVersion: 'applik8s.operation/v1alpha1',
    id: 'applik8s://queries/Evidence/operations/search',
    version: 'v1',
    name: 'search',
    kind: 'query',
    input: { digest: 'sha256:input-schema', schema: { type: 'object' } },
    output: { digest: 'sha256:output-schema', schema: { type: 'object' } },
    errors: {},
    authority: {
      classification: 'assigned',
      grantable: false,
      delegable: false,
      checks: ['admission'],
      defaultScope: { kind: 'all' },
      transports: ['mcp'],
    },
    transports: [],
    placement: { nodeId: 'query.search', runtime: 'server' },
  };
}

function admitted(): ApplicationRequestAdmission {
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
      audience: ['https://research.example.test/mcp'],
      trustedContextDigest: 'context-1',
      catalogRevision: 'catalog-1',
      authorityRevision: 'authority-1',
      admittedAt: now.toISOString(),
      expiresAt: '2026-07-30T00:05:00.000Z',
    },
    trustedContext: { tenant: 'tenant-1' },
  };
}

function receipt(
  admission: ApplicationRequestAdmission,
  inputDigest: string,
): ApplicationAuthorizationReceipt {
  return {
    apiVersion: 'applik8s.authorizationReceipt/v1alpha1',
    id: 'receipt-1',
    application: 'research',
    operationId: operation.id,
    operationVersion: operation.version,
    catalogRevision: admission.principal.catalogRevision,
    authorityRevision: admission.principal.authorityRevision,
    principal: admission.principal,
    trustedContextDigest: admission.principal.trustedContextDigest,
    matchedPermissionIds: ['permission-search'],
    matchedGrantIds: ['grant-search'],
    inputDigest,
    target: { kind: 'all' },
    scopeEvidence: [{ kind: 'all' }],
    audience: 'https://research.example.test/mcp',
    transport: 'mcp',
    admittedAt: now.toISOString(),
    expiresAt: '2026-07-30T00:00:30.000Z',
  };
}
