import type {
  ApplicationAIAttemptRecord,
  ApplicationAIInvocationRecord,
  ApplicationAIStreamDelta,
  ApplicationAIToolProposalRecord,
} from './contracts.js';
import type {
  ApplicationAIAttemptStore,
  ApplicationAIAttemptTransaction,
} from './runtime.js';

interface InvocationState {
  invocation?: ApplicationAIInvocationRecord;
  readonly attempts: Map<string, ApplicationAIAttemptRecord>;
  readonly deltas: Map<string, ApplicationAIStreamDelta[]>;
  readonly proposals: Map<string, ApplicationAIToolProposalRecord>;
}

/**
 * Reference store for tests and explicit local profiles. It is process-local
 * and therefore cannot satisfy a dedicated/production AI qualification.
 */
export function createMemoryApplicationAIAttemptStore(): ApplicationAIAttemptStore {
  const states = new Map<string, InvocationState>();
  const queues = new Map<string, Promise<void>>();
  return {
    transact(invocationId, operation) {
      const previous = queues.get(invocationId) ?? Promise.resolve();
      let release: (() => void) | undefined;
      const current = new Promise<void>((resolve) => {
        release = resolve;
      });
      const tail = previous.then(() => current);
      queues.set(invocationId, tail);
      return previous.then(async () => {
        const state = states.get(invocationId) ?? {
          attempts: new Map(),
          deltas: new Map(),
          proposals: new Map(),
        };
        states.set(invocationId, state);
        const transaction = createTransaction(state);
        try {
          return await operation(transaction);
        } finally {
          release?.();
          if (queues.get(invocationId) === tail) queues.delete(invocationId);
        }
      });
    },
  };
}

function createTransaction(state: InvocationState): ApplicationAIAttemptTransaction {
  return {
    getInvocation() {
      return state.invocation;
    },
    putInvocation(record) {
      state.invocation = structuredClone(record);
    },
    listAttempts() {
      return [...state.attempts.values()].map((attempt) => structuredClone(attempt));
    },
    getAttempt(attemptId) {
      const attempt = state.attempts.get(attemptId);
      return attempt ? structuredClone(attempt) : undefined;
    },
    putAttempt(record) {
      state.attempts.set(record.id, structuredClone(record));
    },
    appendDelta(delta) {
      const existing = state.deltas.get(delta.attemptId) ?? [];
      if (existing.some((candidate) => candidate.sequence === delta.sequence)) {
        throw new Error(
          `AI attempt ${delta.attemptId} already contains stream sequence ${delta.sequence}.`,
        );
      }
      existing.push(structuredClone(delta));
      state.deltas.set(delta.attemptId, existing);
    },
    listDeltas(attemptId, afterSequence = 0) {
      return (state.deltas.get(attemptId) ?? [])
        .filter((delta) => delta.sequence > afterSequence)
        .map((delta) => structuredClone(delta));
    },
    getToolProposal(attemptId, providerToolCallId) {
      const proposal = state.proposals.get(proposalKey(attemptId, providerToolCallId));
      return proposal ? structuredClone(proposal) : undefined;
    },
    putToolProposal(record) {
      state.proposals.set(
        proposalKey(record.attemptId, record.providerToolCallId),
        structuredClone(record),
      );
    },
  };
}

function proposalKey(attemptId: string, providerToolCallId: string): string {
  return `${attemptId}\u0000${providerToolCallId}`;
}
