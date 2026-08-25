// typecast-file-boundary: durable AI records are checked against invocation and attempt invariants before JSON payloads are restored to protocol record types.
import {
  type ApplicationAdmissionContextV1,
  type ApplicationExecutionPrincipal,
  type ApplicationOperationId,
  type ApplicationTelemetryEnvelopeV1,
  canonicalJsonCompatibleV1Policy,
  canonicalJsonV1String,
  type JsonObject,
  validateApplicationAdmissionContextV1,
  validateApplicationTelemetryEnvelopeV1,
} from '@applik8s/core';
import type {
  ApplicationAIAdmissionEvidenceV1,
  ApplicationAIAttemptRecord,
  ApplicationAIAttemptRecoveryClass,
  ApplicationAIInvocationRecord,
  ApplicationAIResolvedRoute,
  ApplicationAIStreamDelta,
  ApplicationAIToolProposalRecord,
  ApplicationAIUsageRecord,
} from './contracts.js';

export interface ApplicationAIClock {
  now(): Date;
}

export interface ApplicationAIIdGenerator {
  next(prefix: 'attempt' | 'command'): string;
}

export interface ApplicationAIAttemptStore {
  transact<T>(
    invocationId: string,
    operation: (transaction: ApplicationAIAttemptTransaction) => Promise<T> | T,
  ): Promise<T>;
}

export interface ApplicationAIAttemptTransaction {
  getInvocation(): ApplicationAIInvocationRecord | undefined;
  putInvocation(record: ApplicationAIInvocationRecord): void;
  listAttempts(): readonly ApplicationAIAttemptRecord[];
  getAttempt(attemptId: string): ApplicationAIAttemptRecord | undefined;
  putAttempt(record: ApplicationAIAttemptRecord): void;
  appendDelta(delta: ApplicationAIStreamDelta): void;
  listDeltas(attemptId: string, afterSequence?: number): readonly ApplicationAIStreamDelta[];
  getToolProposal(
    attemptId: string,
    providerToolCallId: string,
  ): ApplicationAIToolProposalRecord | undefined;
  putToolProposal(record: ApplicationAIToolProposalRecord): void;
}

export interface ApplicationAIInvocationReservation {
  readonly invocationId: string;
  readonly conversationId: string;
  readonly protocolRunId: string;
  readonly agentRunId: string;
  readonly logicalModel: string;
  readonly request: unknown;
  readonly admittedPrincipal: ApplicationExecutionPrincipal;
  readonly admission: ApplicationAdmissionContextV1 & {
    readonly principal: ApplicationExecutionPrincipal;
  };
  readonly telemetry?: ApplicationTelemetryEnvelopeV1;
}

export interface ApplicationAIAttemptReservation {
  readonly invocationId: string;
  readonly redactedRequestMetadata: JsonObject;
  readonly route: ApplicationAIResolvedRoute;
  readonly retry?: 'never' | 'if-replay-safe';
}

export interface ApplicationAIAttemptDecision {
  readonly action: 'dispatch' | 'join' | 'return-terminal' | 'escalate';
  readonly invocation: ApplicationAIInvocationRecord;
  readonly attempt: ApplicationAIAttemptRecord;
}

export interface ApplicationAIToolProposalInput {
  readonly invocationId: string;
  readonly attemptId: string;
  readonly providerToolCallId: string;
  readonly operationId: ApplicationOperationId;
  readonly operationVersion: string;
  readonly arguments: unknown;
  readonly grantReservationId?: string;
}

export class ApplicationAIProtocolConflictError extends Error {
  readonly code = 'AI_PROTOCOL_CONFLICT';
}

export class ApplicationAIStateConflictError extends Error {
  readonly code = 'AI_STATE_CONFLICT';
}

export function createApplicationAIAttemptRuntime(options: {
  readonly store: ApplicationAIAttemptStore;
  readonly clock?: ApplicationAIClock;
  readonly ids?: ApplicationAIIdGenerator;
}) {
  const clock = options.clock ?? { now: () => new Date() };
  const ids = options.ids ?? {
    next(prefix: 'attempt' | 'command') {
      return `${prefix}_${globalThis.crypto.randomUUID()}`;
    },
  };

  return Object.freeze({
    async reserveInvocation(
      input: ApplicationAIInvocationReservation,
    ): Promise<ApplicationAIInvocationRecord> {
      validatePrincipal(input.admittedPrincipal, input.agentRunId);
      const admission = validateApplicationAdmissionContextV1(input.admission, {
        now: clock.now().getTime(),
      });
      if (admission.principal.id !== input.admittedPrincipal.id) {
        throw new ApplicationAIProtocolConflictError(
          `AI invocation ${input.invocationId} admission does not match its execution principal.`,
        );
      }
      const admissionEvidence = applicationAIAdmissionEvidence(admission);
      if (input.telemetry) validateApplicationTelemetryEnvelopeV1(input.telemetry);
      const requestHash = await applicationAIDigest(input.request);
      return options.store.transact(input.invocationId, (transaction) => {
        const existing = transaction.getInvocation();
        if (existing) {
          if (
            existing.requestHash !== requestHash
            || existing.conversationId !== input.conversationId
            || existing.protocolRunId !== input.protocolRunId
            || existing.agentRunId !== input.agentRunId
            || existing.logicalModel !== input.logicalModel
            || existing.admittedPrincipal.id !== input.admittedPrincipal.id
            || canonicalJsonV1String(existing.admissionEvidence)
              !== canonicalJsonV1String(admissionEvidence)
          ) {
            throw new ApplicationAIProtocolConflictError(
              `AI invocation ${input.invocationId} was reused with another request or execution identity.`,
            );
          }
          return existing;
        }
        const now = clock.now().toISOString();
        const invocation: ApplicationAIInvocationRecord = Object.freeze({
          apiVersion: 'applik8s.aiInvocation/v1alpha1',
          id: nonEmpty(input.invocationId, 'invocationId'),
          conversationId: nonEmpty(input.conversationId, 'conversationId'),
          protocolRunId: nonEmpty(input.protocolRunId, 'protocolRunId'),
          agentRunId: nonEmpty(input.agentRunId, 'agentRunId'),
          logicalModel: nonEmpty(input.logicalModel, 'logicalModel'),
          requestHash,
          admittedPrincipal: structuredClone(input.admittedPrincipal),
          admissionEvidence,
          authorityRevision: input.admittedPrincipal.authorityRevision,
          ...(input.telemetry ? { telemetry: structuredClone(input.telemetry) } : {}),
          state: 'active',
          createdAt: now,
          updatedAt: now,
        });
        transaction.putInvocation(invocation);
        return invocation;
      });
    },

    async reserveAttempt(
      input: ApplicationAIAttemptReservation,
    ): Promise<ApplicationAIAttemptDecision> {
      return options.store.transact(input.invocationId, (transaction) => {
        const invocation = requireInvocation(transaction, input.invocationId);
        const attempts = transaction
          .listAttempts()
          .slice()
          .sort((left, right) => left.ordinal - right.ordinal);
        const current = invocation.currentAttemptId
          ? transaction.getAttempt(invocation.currentAttemptId)
          : attempts.at(-1);
        if (current) {
          if (current.route.policyRevision !== input.route.policyRevision) {
            throw new ApplicationAIProtocolConflictError(
              `AI invocation ${input.invocationId} cannot silently change routing policy from ${current.route.policyRevision} to ${input.route.policyRevision}.`,
            );
          }
          if (
            current.state === 'reserved'
            || current.state === 'dispatching'
            || current.state === 'streaming'
            || current.state === 'provider-completed'
          ) {
            return { action: 'join', invocation, attempt: current };
          }
          if (
            current.state === 'canonical-committed'
            || current.state === 'cancelled'
          ) {
            return { action: 'return-terminal', invocation, attempt: current };
          }
          if (
            current.state === 'completion-uncertain'
            || current.recovery === 'uncertain'
          ) {
            return { action: 'escalate', invocation, attempt: current };
          }
          if (
            current.state === 'provider-failed'
            && (
              current.recovery !== 'replay-safe'
              || input.retry !== 'if-replay-safe'
            )
          ) {
            return { action: 'return-terminal', invocation, attempt: current };
          }
        }
        if (invocation.state !== 'active') {
          throw new ApplicationAIStateConflictError(
            `AI invocation ${input.invocationId} is ${invocation.state} and cannot reserve another attempt.`,
          );
        }
        const now = clock.now().toISOString();
        const attempt: ApplicationAIAttemptRecord = Object.freeze({
          apiVersion: 'applik8s.aiAttempt/v1alpha1',
          id: ids.next('attempt'),
          invocationId: invocation.id,
          ordinal: attempts.length + 1,
          state: 'reserved',
          recovery: 'joinable',
          requestHash: invocation.requestHash,
          redactedRequestMetadata: structuredClone(input.redactedRequestMetadata),
          route: structuredClone(input.route),
          streamFrontier: 0,
          version: 1,
          createdAt: now,
          updatedAt: now,
        });
        const updated = updateInvocation(invocation, now, {
          currentAttemptId: attempt.id,
          state: 'active',
        });
        transaction.putAttempt(attempt);
        transaction.putInvocation(updated);
        return { action: 'dispatch', invocation: updated, attempt };
      });
    },

    transition(
      invocationId: string,
      attemptId: string,
      expectedVersion: number,
      transition: {
        readonly state: ApplicationAIAttemptRecord['state'];
        readonly recovery: ApplicationAIAttemptRecoveryClass;
        readonly providerRequestId?: string;
        readonly deliveryLogReference?: string;
        readonly usage?: ApplicationAIUsageRecord;
        readonly terminalReason?: string;
      },
    ): Promise<ApplicationAIAttemptRecord> {
      return options.store.transact(invocationId, (transaction) => {
        const invocation = requireInvocation(transaction, invocationId);
        const current = requireAttempt(transaction, attemptId);
        if (current.invocationId !== invocationId || invocation.currentAttemptId !== attemptId) {
          throw new ApplicationAIStateConflictError(
            `AI attempt ${attemptId} is not the current attempt for ${invocationId}.`,
          );
        }
        if (current.version !== expectedVersion) {
          throw new ApplicationAIStateConflictError(
            `AI attempt ${attemptId} expected version ${expectedVersion}, observed ${current.version}.`,
          );
        }
        assertTransition(current.state, transition.state);
        const now = clock.now().toISOString();
        const updated: ApplicationAIAttemptRecord = Object.freeze({
          ...current,
          state: transition.state,
          recovery: transition.recovery,
          ...(transition.providerRequestId
            ? { providerRequestId: transition.providerRequestId }
            : {}),
          ...(transition.deliveryLogReference
            ? { deliveryLogReference: transition.deliveryLogReference }
            : {}),
          ...(transition.usage ? { usage: structuredClone(transition.usage) } : {}),
          ...(transition.terminalReason
            ? { terminalReason: transition.terminalReason }
            : {}),
          version: current.version + 1,
          updatedAt: now,
        });
        transaction.putAttempt(updated);
        transaction.putInvocation(
          updateInvocation(invocation, now, {
            state: invocationStateForAttempt(updated),
          }),
        );
        return updated;
      });
    },

    appendDelta(
      invocationId: string,
      attemptId: string,
      event: JsonObject,
    ): Promise<ApplicationAIStreamDelta> {
      return options.store.transact(invocationId, (transaction) => {
        const invocation = requireInvocation(transaction, invocationId);
        const attempt = requireAttempt(transaction, attemptId);
        if (
          invocation.state === 'cancelled'
          || attempt.state === 'cancelled'
          || attempt.state === 'canonical-committed'
        ) {
          throw new ApplicationAIStateConflictError(
            `AI attempt ${attemptId} cannot accept provider output after ${attempt.state}.`,
          );
        }
        if (attempt.state !== 'streaming' && attempt.state !== 'dispatching') {
          throw new ApplicationAIStateConflictError(
            `AI attempt ${attemptId} cannot append a delta while ${attempt.state}.`,
          );
        }
        const delta: ApplicationAIStreamDelta = Object.freeze({
          attemptId,
          sequence: attempt.streamFrontier + 1,
          event: structuredClone(event),
          createdAt: clock.now().toISOString(),
        });
        const updated = Object.freeze({
          ...attempt,
          state: 'streaming' as const,
          recovery: 'joinable' as const,
          streamFrontier: delta.sequence,
          version: attempt.version + 1,
          updatedAt: delta.createdAt,
        });
        transaction.appendDelta(delta);
        transaction.putAttempt(updated);
        return delta;
      });
    },

    commitCanonicalResult(
      invocationId: string,
      attemptId: string,
      messageId: string,
    ): Promise<ApplicationAIAttemptRecord> {
      return options.store.transact(invocationId, (transaction) => {
        const invocation = requireInvocation(transaction, invocationId);
        const attempt = requireAttempt(transaction, attemptId);
        if (attempt.state !== 'provider-completed') {
          throw new ApplicationAIStateConflictError(
            `AI attempt ${attemptId} must be provider-completed before canonical commit.`,
          );
        }
        if (invocation.state === 'cancelled') {
          throw new ApplicationAIStateConflictError(
            `AI invocation ${invocationId} was cancelled before canonical commit.`,
          );
        }
        const now = clock.now().toISOString();
        const updated: ApplicationAIAttemptRecord = Object.freeze({
          ...attempt,
          state: 'canonical-committed',
          recovery: 'terminal',
          version: attempt.version + 1,
          updatedAt: now,
        });
        transaction.putAttempt(updated);
        transaction.putInvocation(
          updateInvocation(invocation, now, {
            state: 'completed',
            canonicalMessageId: nonEmpty(messageId, 'messageId'),
          }),
        );
        return updated;
      });
    },

    cancel(invocationId: string, reason: string): Promise<ApplicationAIInvocationRecord> {
      return options.store.transact(invocationId, (transaction) => {
        const invocation = requireInvocation(transaction, invocationId);
        if (invocation.state === 'completed') {
          throw new ApplicationAIStateConflictError(
            `Completed AI invocation ${invocationId} cannot be cancelled.`,
          );
        }
        if (invocation.state === 'cancelled') return invocation;
        const now = clock.now().toISOString();
        if (invocation.currentAttemptId) {
          const current = requireAttempt(transaction, invocation.currentAttemptId);
          if (current.state !== 'canonical-committed') {
            transaction.putAttempt(Object.freeze({
              ...current,
              state: 'cancelled',
              recovery: 'terminal',
              terminalReason: nonEmpty(reason, 'cancellation reason'),
              version: current.version + 1,
              updatedAt: now,
            }));
          }
        }
        const updated = updateInvocation(invocation, now, { state: 'cancelled' });
        transaction.putInvocation(updated);
        return updated;
      });
    },

    async reserveToolProposal(
      input: ApplicationAIToolProposalInput,
    ): Promise<ApplicationAIToolProposalRecord> {
      const argumentsHash = await applicationAIDigest(input.arguments);
      const proposalIdentity = await applicationAIDigest({
        invocationId: input.invocationId,
        attemptId: input.attemptId,
        providerToolCallId: input.providerToolCallId,
        operationId: input.operationId,
        operationVersion: input.operationVersion,
        argumentsHash,
      });
      const proposalId = `proposal_${proposalIdentity.replace(/^sha256:/u, '')}`;
      return options.store.transact(input.invocationId, (transaction) => {
        const invocation = requireInvocation(transaction, input.invocationId);
        const attempt = requireAttempt(transaction, input.attemptId);
        if (
          invocation.currentAttemptId !== attempt.id
          || attempt.state === 'cancelled'
          || attempt.state === 'provider-failed'
          || attempt.state === 'completion-uncertain'
        ) {
          throw new ApplicationAIStateConflictError(
            `AI attempt ${attempt.id} cannot reserve a tool proposal while ${attempt.state}.`,
          );
        }
        const existing = transaction.getToolProposal(
          attempt.id,
          input.providerToolCallId,
        );
        if (existing) {
          if (
            existing.operationId !== input.operationId
            || existing.operationVersion !== input.operationVersion
            || existing.argumentsHash !== argumentsHash
          ) {
            throw new ApplicationAIProtocolConflictError(
              `Provider tool-call ${input.providerToolCallId} was reused with another operation or arguments in attempt ${attempt.id}.`,
            );
          }
          return existing;
        }
        const commandId = ids.next('command');
        const proposal: ApplicationAIToolProposalRecord = Object.freeze({
          apiVersion: 'applik8s.aiToolProposal/v1alpha1',
          id: proposalId,
          invocationId: input.invocationId,
          attemptId: input.attemptId,
          providerToolCallId: nonEmpty(
            input.providerToolCallId,
            'providerToolCallId',
          ),
          operationId: input.operationId,
          operationVersion: nonEmpty(input.operationVersion, 'operationVersion'),
          argumentsHash,
          commandId,
          ...(input.grantReservationId
            ? { grantReservationId: input.grantReservationId }
            : {}),
          createdAt: clock.now().toISOString(),
        });
        transaction.putToolProposal(proposal);
        return proposal;
      });
    },

    observe(invocationId: string): Promise<{
      readonly invocation: ApplicationAIInvocationRecord;
      readonly attempts: readonly ApplicationAIAttemptRecord[];
      readonly deltas: readonly ApplicationAIStreamDelta[];
    }> {
      return options.store.transact(invocationId, (transaction) => {
        const invocation = requireInvocation(transaction, invocationId);
        const attempts = transaction.listAttempts();
        return {
          invocation,
          attempts,
          deltas: attempts.flatMap((attempt) =>
            transaction.listDeltas(attempt.id),
          ),
        };
      });
    },
  });
}

function applicationAIAdmissionEvidence(
  context: ApplicationAdmissionContextV1,
): ApplicationAIAdmissionEvidenceV1 {
  return Object.freeze({
    apiVersion: 'applik8s.aiAdmissionEvidence/v1',
    admissionVersion: context.apiVersion,
    principalId: context.principal.id,
    authorityRevision: context.authorityRevision,
    trustedContextDigest: context.trustedContext.digest,
    operation: Object.freeze({ ...context.operation }),
    correlationId: context.correlationId,
    ...(context.causationId ? { causationId: context.causationId } : {}),
    ...(context.deadline ? { deadline: context.deadline } : {}),
    ...(context.cancellation
      ? { cancellationRevision: context.cancellation.revision }
      : {}),
    ...(context.trace ? { traceparent: context.trace.traceparent } : {}),
    ...(context.delivery
      ? { delivery: Object.freeze({ ...context.delivery }) }
      : {}),
    ...(context.authorizationReceipt
      ? { authorizationReceiptId: context.authorizationReceipt.id }
      : {}),
  });
}

export async function applicationAIDigest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(
    canonicalJsonV1String(value, canonicalJsonCompatibleV1Policy),
  );
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')).join('')}`;
}

function validatePrincipal(
  principal: ApplicationExecutionPrincipal,
  agentRunId: string,
): void {
  if (
    principal.kind !== 'execution'
    || principal.executionKind !== 'agent'
    || principal.executionId !== agentRunId
  ) {
    throw new ApplicationAIProtocolConflictError(
      `AI invocation agent run ${agentRunId} requires its distinct admitted agent execution principal.`,
    );
  }
  if (
    principal.workloadIdentity.kind !== 'workload'
    || principal.serviceIdentity?.kind !== 'service'
  ) {
    throw new ApplicationAIProtocolConflictError(
      'AI execution principal must preserve separate workload and logical service identities.',
    );
  }
}

function requireInvocation(
  transaction: ApplicationAIAttemptTransaction,
  invocationId: string,
): ApplicationAIInvocationRecord {
  const invocation = transaction.getInvocation();
  if (!invocation || invocation.id !== invocationId) {
    throw new ApplicationAIStateConflictError(
      `AI invocation ${invocationId} does not exist.`,
    );
  }
  return invocation;
}

function requireAttempt(
  transaction: ApplicationAIAttemptTransaction,
  attemptId: string,
): ApplicationAIAttemptRecord {
  const attempt = transaction.getAttempt(attemptId);
  if (!attempt) {
    throw new ApplicationAIStateConflictError(`AI attempt ${attemptId} does not exist.`);
  }
  return attempt;
}

function updateInvocation(
  invocation: ApplicationAIInvocationRecord,
  updatedAt: string,
  patch: {
    readonly state: ApplicationAIInvocationRecord['state'];
    readonly currentAttemptId?: string;
    readonly canonicalMessageId?: string;
  },
): ApplicationAIInvocationRecord {
  return Object.freeze({
    ...invocation,
    state: patch.state,
    ...(patch.currentAttemptId
      ? { currentAttemptId: patch.currentAttemptId }
      : {}),
    ...(patch.canonicalMessageId
      ? { canonicalMessageId: patch.canonicalMessageId }
      : {}),
    updatedAt,
  });
}

function invocationStateForAttempt(
  attempt: ApplicationAIAttemptRecord,
): ApplicationAIInvocationRecord['state'] {
  if (attempt.state === 'completion-uncertain') return 'uncertain';
  if (attempt.state === 'provider-failed' && attempt.recovery === 'terminal') {
    return 'failed';
  }
  if (attempt.state === 'cancelled') return 'cancelled';
  if (attempt.state === 'canonical-committed') return 'completed';
  return 'active';
}

const transitions: Readonly<
  Record<ApplicationAIAttemptRecord['state'], readonly ApplicationAIAttemptRecord['state'][]>
> = {
  reserved: ['dispatching', 'cancelled'],
  dispatching: [
    'streaming',
    'provider-completed',
    'provider-failed',
    'completion-uncertain',
    'cancelled',
  ],
  streaming: [
    'provider-completed',
    'provider-failed',
    'completion-uncertain',
    'cancelled',
  ],
  'provider-completed': ['canonical-committed', 'cancelled'],
  'provider-failed': [],
  'completion-uncertain': [],
  'canonical-committed': [],
  cancelled: [],
};

function assertTransition(
  current: ApplicationAIAttemptRecord['state'],
  next: ApplicationAIAttemptRecord['state'],
): void {
  if (!transitions[current].includes(next)) {
    throw new ApplicationAIStateConflictError(
      `AI attempt cannot transition from ${current} to ${next}.`,
    );
  }
}

function nonEmpty(value: string, name: string): string {
  if (!value.trim()) throw new ApplicationAIProtocolConflictError(`AI ${name} must not be empty.`);
  return value;
}
