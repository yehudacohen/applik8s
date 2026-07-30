import type {
  ApplicationAuthorizationReceipt,
  ApplicationOperationDescriptor,
  ApplicationRequestAdmission,
} from '@applik8s/core';
import {
  applicationInternalOperationInputDigest,
  decodeApplicationInternalOperationInvocation,
} from '@applik8s/operations';
import { describe, expect, it, vi } from 'vitest';
import { createApplicationMcpPlacementExecutor } from '../src/placement.js';

const secret = 'mcp-placement-secret-with-at-least-32-bytes';
const now = new Date('2026-07-30T00:00:00.000Z');

describe('MCP placement executor', () => {
  it('authorizes MCP and dispatches a signed placement envelope', async () => {
    const operation = descriptor('query');
    const admission = admitted();
    const args = { query: 'evidence' };
    const inputDigest = applicationInternalOperationInputDigest(args);
    const authorize = vi.fn(async () => ({
      allowed: true as const,
      receipt: receipt(operation, admission, inputDigest),
    }));
    const dispatch = vi.fn(async (input) => {
      const invocation = decodeApplicationInternalOperationInvocation(
        secret,
        input.invocationToken,
        {
          operationId: operation.id,
          operationVersion: operation.version,
          inputDigest,
          audience: 'https://research.example.test/mcp',
          now,
        },
      );
      expect(invocation.admission).toEqual(admission);
      expect(invocation.source).toEqual({
        transport: 'mcp',
        workloadId: 'mcpServer.research',
        sessionId: 'session-1',
      });
      return { items: ['source-1'] };
    });
    const executor = createApplicationMcpPlacementExecutor({
      // typecast: the executor deliberately consumes only the canonical
      // authority runtime's authorize method.
      authority: { authorize } as never,
      transportSecret: secret,
      dispatch: { dispatch },
      clock: () => now,
      identifier: () => 'invocation-1',
    });

    await expect(
      executor.execute({
        operation,
        arguments: args,
        admission,
        audience: 'https://research.example.test/mcp',
        transport: 'mcp',
        serverId: 'mcpServer.research',
        sessionId: 'session-1',
      }),
    ).resolves.toEqual({ items: ['source-1'] });
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: operation.id,
        transport: 'mcp',
        inputDigest,
      }),
    );
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it('requires idempotency for effectful operations before authorization', async () => {
    const authorize = vi.fn();
    const dispatch = vi.fn();
    const executor = createApplicationMcpPlacementExecutor({
      authority: { authorize } as never,
      transportSecret: secret,
      dispatch: { dispatch },
      clock: () => now,
    });

    await expect(
      executor.execute({
        operation: descriptor('model.create'),
        arguments: { title: 'new' },
        admission: admitted(),
        audience: 'https://research.example.test/mcp',
        transport: 'mcp',
        serverId: 'mcpServer.research',
      }),
    ).rejects.toMatchObject({ code: 'MCP_INPUT_INVALID' });
    expect(authorize).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does not dispatch denied or inconsistent authority results', async () => {
    const operation = descriptor('query');
    const admission = admitted();
    const dispatch = vi.fn();
    const denied = createApplicationMcpPlacementExecutor({
      authority: {
        authorize: async () => ({
          allowed: false,
          code: 'AUTHORIZATION_DENIED',
          message: 'denied',
        }),
      } as never,
      transportSecret: secret,
      dispatch: { dispatch },
      clock: () => now,
    });
    await expect(
      denied.execute({
        operation,
        arguments: {},
        admission,
        audience: 'https://research.example.test/mcp',
        transport: 'mcp',
        serverId: 'mcpServer.research',
      }),
    ).rejects.toMatchObject({ code: 'MCP_AUTHORIZATION_DENIED' });

    const inconsistent = createApplicationMcpPlacementExecutor({
      authority: {
        authorize: async () => ({
          allowed: true,
          receipt: {
            ...receipt(
              operation,
              admission,
              applicationInternalOperationInputDigest({}),
            ),
            transport: 'http',
          },
        }),
      } as never,
      transportSecret: secret,
      dispatch: { dispatch },
      clock: () => now,
    });
    await expect(
      inconsistent.execute({
        operation,
        arguments: {},
        admission,
        audience: 'https://research.example.test/mcp',
        transport: 'mcp',
        serverId: 'mcpServer.research',
      }),
    ).rejects.toMatchObject({ code: 'MCP_AUTHORIZATION_DENIED' });
    expect(dispatch).not.toHaveBeenCalled();
  });
});

function descriptor(
  kind: ApplicationOperationDescriptor['kind'],
): ApplicationOperationDescriptor {
  return {
    apiVersion: 'applik8s.operation/v1alpha1',
    id: 'applik8s://queries/Evidence/operations/search',
    version: 'v1',
    name: 'search',
    kind,
    input: {
      digest: 'sha256:input-schema',
      schema: { type: 'object' },
    },
    output: {
      digest: 'sha256:output-schema',
      schema: { type: 'object' },
    },
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
      clientId: 'client-1',
    },
    trustedContext: { tenant: 'tenant-1' },
  };
}

function receipt(
  operation: ApplicationOperationDescriptor,
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
