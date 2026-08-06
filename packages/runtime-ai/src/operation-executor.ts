import { randomUUID } from 'node:crypto';
import type {
  ApplicationAuthorizationReceipt,
  ApplicationExecutionPrincipal,
  ApplicationOperationDescriptor,
  ApplicationOperationTransport,
  ApplicationRequestAdmission,
  ApplicationWorkloadAuthorityEnvelope,
  JsonValue,
} from '@applik8s/core';
import {
  type ApplicationOperationAuthorityRuntime,
  applicationInternalOperationInputDigest,
  encodeApplicationInternalOperationInvocation,
} from '@applik8s/operations';
import type { ApplicationAIToolProposalRecord } from '@applik8s/ai';
import type {
  ApplicationAIToolProposalInput,
} from '@applik8s/ai';

export interface ApplicationAIOperationDispatch {
  dispatch(input: {
    readonly operation: ApplicationOperationDescriptor;
    readonly arguments: JsonValue;
    readonly invocationToken: string;
    readonly invocationId: string;
    /** Retry-stable provider-tool proposal identity. */
    readonly idempotencyKey: string;
    readonly principal: ApplicationExecutionPrincipal;
    readonly authorizationReceipt: ApplicationAuthorizationReceipt;
    readonly trustedContext: Readonly<Record<string, JsonValue>>;
    readonly signal?: AbortSignal;
  }): Promise<JsonValue>;
}

export interface ApplicationAIOperationExecutorOptions {
  readonly authority: Pick<
    ApplicationOperationAuthorityRuntime,
    'authorizeExecution'
  >;
  readonly attemptRuntime: {
    readonly reserveToolProposal: (
      input: ApplicationAIToolProposalInput,
    ) => Promise<ApplicationAIToolProposalRecord>;
  };
  readonly envelopes: readonly ApplicationWorkloadAuthorityEnvelope[];
  readonly transportSecret: string;
  readonly dispatch: ApplicationAIOperationDispatch;
  readonly invocationLifetimeMs?: number;
  readonly clock?: () => Date;
  readonly identifier?: () => string;
}

export interface ApplicationAIOperationInvocation {
  readonly admission: ApplicationRequestAdmission & {
    readonly principal: ApplicationExecutionPrincipal;
  };
  readonly invocationId: string;
  readonly attemptId: string;
  readonly providerToolCallId: string;
  readonly signal?: AbortSignal;
}

/**
 * Executes a provider-proposed tool through the canonical operation placement.
 *
 * The durable proposal establishes retry identity before authorization. The
 * operation-authority runtime narrows the current execution principal against
 * its compiled workload envelope, and only a signed receipt-bearing internal
 * invocation crosses into the owning workload.
 */
export function createApplicationAIOperationExecutor(
  options: ApplicationAIOperationExecutorOptions,
): (
  operation: ApplicationOperationDescriptor,
  input: JsonValue,
  invocation: ApplicationAIOperationInvocation,
) => Promise<JsonValue> {
  const lifetime = options.invocationLifetimeMs ?? 30_000;
  if (
    !Number.isSafeInteger(lifetime)
    || lifetime < 1_000
    || lifetime > 60_000
  ) {
    throw new Error(
      'AI operation invocationLifetimeMs must be between one and 60 seconds.',
    );
  }
  const clock = options.clock ?? (() => new Date());
  const identifier = options.identifier ?? randomUUID;
  const envelopes = new Map(
    options.envelopes.map((envelope) => [envelope.operationId, envelope]),
  );
  if (envelopes.size !== options.envelopes.length) {
    throw new Error(
      'AI operation executor requires one workload envelope per operation.',
    );
  }
  return async (operation, input, invocation) => {
    const envelope = envelopes.get(operation.id);
    if (!envelope) {
      throw new Error(
        `AI execution has no workload authority for ${operation.id}.`,
      );
    }
    const proposal = await options.attemptRuntime.reserveToolProposal({
      invocationId: invocation.invocationId,
      attemptId: invocation.attemptId,
      providerToolCallId: invocation.providerToolCallId,
      operationId: operation.id,
      operationVersion: operation.version,
      arguments: input,
    });
    const inputDigest = applicationInternalOperationInputDigest(input);
    const transport = operationExecutionTransport(operation, envelope);
    const audience = envelope.audiences.at(0);
    if (!audience) {
      throw new Error(
        `AI workload envelope ${envelope.id} has no admitted audience.`,
      );
    }
    const authorization = await options.authority.authorizeExecution({
      principal: invocation.admission.principal,
      envelope,
      target: operation.authority.defaultScope,
      audience,
      transport,
      inputDigest,
      trustedContextDigest:
        invocation.admission.principal.trustedContextDigest,
      currentCancellationRevision:
        invocation.admission.principal.cancellationRevision,
      idempotencyKey: proposal.commandId,
      commandId: proposal.commandId,
    });
    if (!authorization.allowed) {
      throw new Error(
        `AI operation ${operation.id} was denied by canonical authority (${authorization.code}).`,
      );
    }
    const issuedAt = clock();
    const principalExpiry = Date.parse(
      authorization.principal.deadline,
    );
    const expiresAt = new Date(
      Math.min(issuedAt.getTime() + lifetime, principalExpiry),
    );
    const internalInvocationId = `internal_${identifier()}`;
    const invocationToken = encodeApplicationInternalOperationInvocation(
      options.transportSecret,
      {
        apiVersion: 'applik8s.internalOperation/v1alpha1',
        id: internalInvocationId,
        operationId: operation.id,
        operationVersion: operation.version,
        inputDigest,
        audience,
        source: {
          transport,
          workloadId: authorization.principal.workloadIdentity.subject,
          sessionId: invocation.invocationId,
        },
        admission: {
          principal: authorization.principal,
          trustedContext: invocation.admission.trustedContext,
        },
        authorizationReceipt: authorization.receipt,
        idempotencyKey: proposal.commandId,
        issuedAt: issuedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      },
    );
    return options.dispatch.dispatch({
      operation,
      arguments: input,
      invocationToken,
      invocationId: internalInvocationId,
      idempotencyKey: proposal.commandId,
      principal: authorization.principal,
      authorizationReceipt: authorization.receipt,
      trustedContext: invocation.admission.trustedContext,
      ...(invocation.signal ? { signal: invocation.signal } : {}),
    });
  };
}

function operationExecutionTransport(
  operation: ApplicationOperationDescriptor,
  envelope: ApplicationWorkloadAuthorityEnvelope,
): Exclude<ApplicationOperationTransport, 'direct'> {
  const preferred: Exclude<ApplicationOperationTransport, 'direct'> =
    operation.placement.runtime === 'command-processor'
      ? 'event'
      : operation.placement.runtime === 'workflow-worker'
        ? 'workflow'
        : operation.placement.runtime === 'event-processor'
          ? 'event'
          : operation.placement.runtime === 'operator'
            ? 'control-plane'
            : 'http';
  if (envelope.transports.includes(preferred)) return preferred;
  const supported = envelope.transports.find(
    (transport): transport is Exclude<ApplicationOperationTransport, 'direct'> =>
      transport !== 'direct',
  );
  if (!supported) {
    throw new Error(
      `AI workload envelope ${envelope.id} exposes no internal placement transport for ${operation.id}.`,
    );
  }
  return supported;
}
