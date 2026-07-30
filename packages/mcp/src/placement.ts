import { randomUUID } from 'node:crypto';
import type {
  ApplicationAuthorizationReceipt,
  ApplicationOperationDescriptor,
  ApplicationRequestAdmission,
  JsonValue,
} from '@applik8s/core';
import {
  type ApplicationOperationAuthorityRuntime,
  applicationInternalOperationInputDigest,
  encodeApplicationInternalOperationInvocation,
} from '@applik8s/operations';
import {
  ApplicationMcpError,
  type ApplicationMcpOperationExecutor,
} from './contracts.js';

export interface ApplicationMcpPlacementDispatch {
  dispatch(input: {
    readonly operation: ApplicationOperationDescriptor;
    readonly arguments: JsonValue;
    readonly invocationToken: string;
    readonly invocationId: string;
    readonly signal?: AbortSignal;
  }): Promise<JsonValue>;
}

export interface ApplicationMcpPlacementExecutorOptions {
  readonly authority: Pick<ApplicationOperationAuthorityRuntime, 'authorize'>;
  readonly transportSecret: string;
  readonly dispatch: ApplicationMcpPlacementDispatch;
  readonly invocationLifetimeMs?: number;
  readonly clock?: () => Date;
  readonly identifier?: () => string;
}

/**
 * Canonical MCP-to-placement bridge.
 *
 * Authorization happens once with transport=mcp. The owning workload receives
 * a signed receipt-bearing invocation, never the inbound OAuth credential and
 * never a copied operation implementation.
 */
export function createApplicationMcpPlacementExecutor(
  options: ApplicationMcpPlacementExecutorOptions,
): ApplicationMcpOperationExecutor {
  const lifetime = options.invocationLifetimeMs ?? 30_000;
  if (
    !Number.isSafeInteger(lifetime)
    || lifetime < 1_000
    || lifetime > 60_000
  ) {
    throw new Error(
      'MCP placement invocationLifetimeMs must be between one and 60 seconds.',
    );
  }
  const clock = options.clock ?? (() => new Date());
  const identifier = options.identifier ?? randomUUID;
  return {
    async execute(input) {
      if (effectful(input.operation) && !input.idempotencyKey?.trim()) {
        throw new ApplicationMcpError(
          'MCP_INPUT_INVALID',
          `MCP operation ${input.operation.id} requires an Idempotency-Key.`,
          400,
        );
      }
      const inputDigest = applicationInternalOperationInputDigest(
        input.arguments,
      );
      const authorization = await options.authority.authorize({
        principal: input.admission.principal,
        operationId: input.operation.id,
        target: input.operation.authority.defaultScope,
        audience: input.audience,
        transport: 'mcp',
        inputDigest,
        trustedContextDigest:
          input.admission.principal.trustedContextDigest,
        ...(input.idempotencyKey
          ? { idempotencyKey: input.idempotencyKey }
          : {}),
        applicationPolicyAllowed: true,
      });
      if (!authorization.allowed) {
        throw new ApplicationMcpError(
          'MCP_AUTHORIZATION_DENIED',
          authorization.message,
          403,
          { authorityCode: authorization.code },
        );
      }
      assertMcpReceipt(
        authorization.receipt,
        input.operation,
        input.admission,
        inputDigest,
        input.audience,
      );
      const issuedAt = clock();
      const invocationId = `internal_${identifier()}`;
      const invocationToken =
        encodeApplicationInternalOperationInvocation(
          options.transportSecret,
          {
            apiVersion: 'applik8s.internalOperation/v1alpha1',
            id: invocationId,
            operationId: input.operation.id,
            operationVersion: input.operation.version,
            inputDigest,
            audience: input.audience,
            source: {
              transport: 'mcp',
              workloadId: input.serverId,
              ...(input.sessionId ? { sessionId: input.sessionId } : {}),
            },
            admission: input.admission,
            authorizationReceipt: authorization.receipt,
            ...(input.idempotencyKey
              ? { idempotencyKey: input.idempotencyKey }
              : {}),
            issuedAt: issuedAt.toISOString(),
            expiresAt: new Date(
              issuedAt.getTime() + lifetime,
            ).toISOString(),
          },
        );
      return options.dispatch.dispatch({
        operation: input.operation,
        arguments: input.arguments,
        invocationToken,
        invocationId,
        ...(input.signal ? { signal: input.signal } : {}),
      });
    },
  };
}

function assertMcpReceipt(
  receipt: ApplicationAuthorizationReceipt,
  operation: ApplicationOperationDescriptor,
  admission: ApplicationRequestAdmission,
  inputDigest: string,
  audience: string,
): void {
  if (
    receipt.operationId !== operation.id
    || receipt.operationVersion !== operation.version
    || receipt.transport !== 'mcp'
    || receipt.inputDigest !== inputDigest
    || receipt.audience !== audience
    || receipt.principal.id !== admission.principal.id
    || receipt.principal.identity.id !== admission.principal.identity.id
    || receipt.catalogRevision !== admission.principal.catalogRevision
    || receipt.authorityRevision !== admission.principal.authorityRevision
    || receipt.trustedContextDigest
      !== admission.principal.trustedContextDigest
  ) {
    throw new ApplicationMcpError(
      'MCP_AUTHORIZATION_DENIED',
      `MCP authorization receipt for ${operation.id} is inconsistent.`,
      403,
    );
  }
}

function effectful(operation: ApplicationOperationDescriptor): boolean {
  return operation.kind === 'model.create'
    || operation.kind === 'model.update'
    || operation.kind === 'model.delete'
    || operation.kind === 'model.operation'
    || operation.kind === 'resource.create'
    || operation.kind === 'resource.update'
    || operation.kind === 'resource.delete'
    || operation.kind === 'resource.status'
    || operation.kind === 'resource.operation'
    || operation.kind === 'task'
    || operation.kind === 'workflow.start'
    || operation.kind === 'workflow.signal'
    || operation.kind === 'workflow.cancel';
}
