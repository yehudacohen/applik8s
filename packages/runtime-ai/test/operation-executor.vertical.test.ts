// typecast-file-boundary: Executor tests use boundary fixtures to verify operation result validation and narrowing.
import type {
  ApplicationAuthorizationReceipt,
  ApplicationExecutionPrincipal,
  ApplicationOperationDescriptor,
  ApplicationWorkloadAuthorityEnvelope,
} from '@applik8s/core';
import {
  createApplicationAdmissionContextV1,
  withApplicationAdmissionExecutionV1,
} from '@applik8s/core';
import {
  applicationInternalOperationInputDigest,
  decodeApplicationInternalOperationInvocation,
} from '@applik8s/operations';
import { describe, expect, it, vi } from 'vitest';
import { createApplicationAIOperationExecutor } from '../src/operation-executor.js';

const secret = 'ai-operation-secret-with-at-least-32-bytes';
const now = new Date('2026-07-30T12:00:00.000Z');

describe('AI operation executor', () => {
  it('persists tool identity, narrows execution authority, and dispatches a signed placement', async () => {
    const operation = descriptor();
    const envelope = workloadEnvelope(operation);
    const admission = executionAdmission();
    const args = { query: 'evidence' };
    const inputDigest = applicationInternalOperationInputDigest(args);
    const proposal = {
      apiVersion: 'applik8s.aiToolProposal/v1alpha1' as const,
      id: 'proposal-1',
      invocationId: 'invocation-1',
      attemptId: 'attempt-1',
      providerToolCallId: 'tool-call-1',
      operationId: operation.id,
      operationVersion: operation.version,
      argumentsHash: inputDigest,
      commandId: 'command-1',
      createdAt: now.toISOString(),
    };
    const reserveToolProposal = vi.fn(async () => proposal);
    const expectedReceipt = receipt(
      operation,
      admission.context.principal,
      envelope,
      inputDigest,
    );
    const authorizeExecution = vi.fn(async () => ({
      allowed: true as const,
      principal: admission.context.principal,
      receipt: expectedReceipt,
    }));
    const dispatch = vi.fn(async ({
      invocationToken,
      authorizationReceipt,
      principal,
    }) => {
      const invocation = decodeApplicationInternalOperationInvocation(
        secret,
        invocationToken,
        {
          operationId: operation.id,
          operationVersion: operation.version,
          inputDigest,
          audience: envelope.audiences[0] ?? '',
          now,
        },
      );
      expect(invocation.source).toEqual({
        transport: 'http',
        workloadId: 'aiAgent.researcher',
        sessionId: 'invocation-1',
      });
      expect(invocation.idempotencyKey).toBe('command-1');
      expect(invocation.admission).toEqual({
        principal: admission.context.principal,
        trustedContext: admission.context.trustedContext.values,
      });
      expect(invocation.context).toMatchObject({
        principal: admission.context.principal,
        operation: { id: operation.id, transport: 'http' },
        correlationId: admission.context.correlationId,
        causationId: 'command-1',
        authorizationReceipt: expectedReceipt,
        delivery: {
          id: 'internal_internal-1',
          source: 'applik8s://internal-operation/aiAgent.researcher',
        },
      });
      expect(authorizationReceipt).toEqual(expectedReceipt);
      expect(principal).toMatchObject({
        id: 'principal:research:execution:agent:agent-run-1:1',
        causalPrincipalId: 'principal:research:human:user-1',
        causalPrincipal: {
          id: 'identity:user-1',
        },
      });
      return { items: ['source-1'] };
    });
    const invoke = createApplicationAIOperationExecutor({
      authority: { authorizeExecution },
      attemptRuntime: { reserveToolProposal },
      envelopes: [envelope],
      transportSecret: secret,
      dispatch: { dispatch },
      clock: () => now,
      identifier: () => 'internal-1',
    });

    await expect(
      invoke(operation, args, {
        context: admission.context,
        invocationId: 'invocation-1',
        attemptId: 'attempt-1',
        providerToolCallId: 'tool-call-1',
      }),
    ).resolves.toEqual({ items: ['source-1'] });
    expect(reserveToolProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        invocationId: 'invocation-1',
        operationId: operation.id,
        arguments: args,
      }),
    );
    expect(authorizeExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: admission.context.principal,
        envelope,
        transport: 'http',
        inputDigest,
        commandId: 'command-1',
      }),
    );
  });

  it('never dispatches an operation outside the workload envelope', async () => {
    const dispatch = vi.fn();
    const invoke = createApplicationAIOperationExecutor({
      authority: { authorizeExecution: vi.fn() },
      attemptRuntime: { reserveToolProposal: vi.fn() },
      envelopes: [],
      transportSecret: secret,
      dispatch: { dispatch },
      clock: () => now,
    });

    await expect(
      invoke(descriptor(), {}, {
        context: executionAdmission().context,
        invocationId: 'invocation-1',
        attemptId: 'attempt-1',
        providerToolCallId: 'tool-call-1',
      }),
    ).rejects.toThrow(/no workload authority/u);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

function descriptor(): ApplicationOperationDescriptor {
  return {
    apiVersion: 'applik8s.operation/v1alpha1',
    id: 'applik8s://queries/Evidence/operations/search',
    version: 'v1',
    name: 'search',
    kind: 'query',
    input: { digest: 'sha256:input', schema: { type: 'object' } },
    output: { digest: 'sha256:output', schema: { type: 'object' } },
    errors: {},
    authority: {
      classification: 'assigned',
      grantable: false,
      delegable: false,
      checks: ['admission'],
      defaultScope: { kind: 'all' },
      transports: ['http'],
    },
    transports: [],
    placement: { nodeId: 'query.evidence', runtime: 'server' },
  };
}

function workloadEnvelope(
  operation: ApplicationOperationDescriptor,
): ApplicationWorkloadAuthorityEnvelope {
  return {
    apiVersion: 'applik8s.workloadAuthority/v1alpha1',
    id: 'workload-envelope-1',
    workloadIdentity: {
      id: 'identity:research:workload:aiAgent.researcher',
      kind: 'workload',
      issuer: 'applik8s://research',
      subject: 'aiAgent.researcher',
    },
    serviceIdentity: {
      id: 'identity:research:service:researcher',
      kind: 'service',
      issuer: 'applik8s://research',
      subject: 'researcher',
    },
    operationId: operation.id,
    catalogRevision: 'catalog-1',
    restrictions: {
      target: { kind: 'all' },
      predicates: [],
    },
    inputSchemaDigest: operation.input.digest,
    audiences: ['identity:research:workload:aiAgent.researcher'],
    transports: ['http'],
    delegation: 'forbidden',
    impersonation: 'forbidden',
  };
}

function executionAdmission() {
  const principal: ApplicationExecutionPrincipal = {
      id: 'principal:research:execution:agent:agent-run-1:1',
      identity: {
        id: 'identity:research:service:researcher',
        kind: 'service',
        issuer: 'applik8s://research',
        subject: 'researcher',
      },
      kind: 'execution',
      executionKind: 'agent',
      executionId: 'agent-run-1',
      attempt: 1,
      workloadIdentity: {
        id: 'identity:research:workload:aiAgent.researcher',
        kind: 'workload',
        issuer: 'applik8s://research',
        subject: 'aiAgent.researcher',
      },
      serviceIdentity: {
        id: 'identity:research:service:researcher',
        kind: 'service',
        issuer: 'applik8s://research',
        subject: 'researcher',
      },
      causalPrincipal: {
        id: 'identity:user-1',
        kind: 'human',
        issuer: 'https://identity.example.test',
        subject: 'user-1',
      },
      causalPrincipalId: 'principal:research:human:user-1',
      causalGrantIds: [],
      authenticationMethod: 'workload-identity',
      audience: ['identity:research:workload:aiAgent.researcher'],
      trustedContextDigest: 'context-1',
      catalogRevision: 'catalog-1',
      authorityRevision: 'authority-1',
      admittedAt: now.toISOString(),
      deadline: '2026-07-30T12:05:00.000Z',
      expiresAt: '2026-07-30T12:05:00.000Z',
      cancellationRevision: 'cancel-1',
      bindings: [],
      effectiveAuthority: [],
  };
  const trustedContext = { tenant: 'tenant-1' };
  return {
    context: withApplicationAdmissionExecutionV1(
      createApplicationAdmissionContextV1({
        admission: { principal, trustedContext },
        operation: {
          id: 'applik8s://agent/researcher/execute',
          transport: 'framework',
        },
        correlationId: 'conversation-1',
      }),
      {
        causationId: 'agent-run-1',
        deadline: principal.deadline,
        cancellation: { revision: principal.cancellationRevision },
        delivery: {
          id: 'agent-admission-1',
          source: 'applik8s://agent-gateway',
        },
      },
    ),
  };
}

function receipt(
  operation: ApplicationOperationDescriptor,
  principal: ApplicationExecutionPrincipal,
  envelope: ApplicationWorkloadAuthorityEnvelope,
  inputDigest: string,
): ApplicationAuthorizationReceipt {
  return {
    apiVersion: 'applik8s.authorizationReceipt/v1alpha1',
    id: 'receipt-1',
    application: 'research',
    operationId: operation.id,
    operationVersion: operation.version,
    catalogRevision: principal.catalogRevision,
    authorityRevision: principal.authorityRevision,
    principal,
    trustedContextDigest: principal.trustedContextDigest,
    matchedPermissionIds: ['permission-search'],
    matchedGrantIds: [],
    inputDigest,
    target: { kind: 'all' },
    scopeEvidence: [{ kind: 'all' }],
    audience: envelope.audiences[0] ?? '',
    transport: 'http',
    admittedAt: now.toISOString(),
    expiresAt: '2026-07-30T12:00:30.000Z',
    workloadEnvelopeId: envelope.id,
    executionPrincipalId: principal.id,
  };
}
