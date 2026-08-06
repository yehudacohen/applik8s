import type {
  ApplicationAIConversationRecord,
  ApplicationAIMessageRecord,
  ApplicationAIProtocolRunRecord,
  ApplicationAIRunEventRecord,
} from '@applik8s/ai';
import {
  ApplicationConversationConflictError,
  type ApplicationConversationStore,
} from './contracts.js';

export function createMemoryApplicationConversationStore(): ApplicationConversationStore {
  const conversations = new Map<string, ApplicationAIConversationRecord>();
  const messages = new Map<string, ApplicationAIMessageRecord[]>();
  const runs = new Map<string, ApplicationAIProtocolRunRecord>();
  const events = new Map<string, ApplicationAIRunEventRecord[]>();

  const store: ApplicationConversationStore = {
    async createConversation(conversation) {
      if (conversations.has(conversation.id)) {
        throw new ApplicationConversationConflictError(
          `Conversation ${conversation.id} already exists.`,
        );
      }
      const created = clone(conversation);
      conversations.set(created.id, created);
      return clone(created);
    },

    async getConversation(id, principalScope) {
      const conversation = conversations.get(id);
      return conversation?.principalScope === principalScope
        ? clone(conversation)
        : undefined;
    },

    async getMessage(input) {
      if (
        conversations.get(input.conversationId)?.principalScope
        !== input.principalScope
      ) {
        return undefined;
      }
      const message = (messages.get(input.conversationId) ?? []).find(
        (candidate) => candidate.id === input.id,
      );
      return message ? clone(message) : undefined;
    },

    async appendMessage(input) {
      const conversation = conversations.get(input.conversationId);
      if (
        !conversation
        || conversation.principalScope !== input.principalScope
        || conversation.revision !== input.expectedRevision
      ) {
        throw new ApplicationConversationConflictError(
          `Conversation ${input.conversationId} is absent, outside the admitted scope, or no longer at revision ${input.expectedRevision}.`,
        );
      }
      const existing = messages.get(input.conversationId) ?? [];
      if (existing.some((message) => message.id === input.message.id)) {
        throw new ApplicationConversationConflictError(
          `Message ${input.message.id} already exists.`,
        );
      }
      const nextConversation: ApplicationAIConversationRecord = {
        ...conversation,
        revision: conversation.revision + 1,
        updatedAt: input.message.createdAt,
      };
      const message: ApplicationAIMessageRecord = {
        apiVersion: 'applik8s.aiMessage/v1alpha1',
        id: input.message.id,
        conversationId: input.conversationId,
        revision: nextConversation.revision,
        role: input.message.role,
        content: clone(input.message.content),
        state: input.message.state ?? 'committed',
        ...(input.message.invocationId
          ? { invocationId: input.message.invocationId }
          : {}),
        createdAt: input.message.createdAt,
      };
      conversations.set(input.conversationId, nextConversation);
      messages.set(input.conversationId, [...existing, message]);
      return {
        conversation: clone(nextConversation),
        message: clone(message),
      };
    },

    async listMessages(input) {
      assertLimit(input.limit);
      const conversation = conversations.get(input.conversationId);
      if (conversation?.principalScope !== input.principalScope) return [];
      return (messages.get(input.conversationId) ?? [])
        .filter((message) => message.revision > (input.afterRevision ?? 0))
        .slice(0, input.limit)
        .map(clone);
    },

    async startRun(input) {
      const conversation = conversations.get(input.conversationId);
      if (
        conversation?.principalScope !== input.principalScope
        || runs.has(input.id)
      ) {
        throw new ApplicationConversationConflictError(
          `Run ${input.id} already exists or its conversation is outside the admitted scope.`,
        );
      }
      const run: ApplicationAIProtocolRunRecord = {
        apiVersion: 'applik8s.aiProtocolRun/v1alpha1',
        id: input.id,
        conversationId: input.conversationId,
        principalScope: input.principalScope,
        status: 'running',
        ...(input.agentRunId ? { agentRunId: input.agentRunId } : {}),
        ...(input.invocationId ? { invocationId: input.invocationId } : {}),
        startedAt: input.startedAt,
        updatedAt: input.startedAt,
      };
      runs.set(run.id, run);
      return clone(run);
    },

    async getRun(id, principalScope) {
      const run = runs.get(id);
      return run?.principalScope === principalScope ? clone(run) : undefined;
    },

    async transitionRun(input) {
      const run = runs.get(input.runId);
      if (
        !run
        || run.principalScope !== input.principalScope
        || run.status !== input.from
        || !allowedRunTransition(input.from, input.to)
      ) {
        throw new ApplicationConversationConflictError(
          `Run ${input.runId} cannot transition from ${input.from} to ${input.to}.`,
        );
      }
      const transitioned = {
        ...run,
        status: input.to,
        ...(input.terminalReason
          ? { terminalReason: input.terminalReason }
          : {}),
        updatedAt: input.updatedAt,
      };
      runs.set(run.id, transitioned);
      return clone(transitioned);
    },

    async appendRunEvent(input) {
      const run = runs.get(input.runId);
      const existing = events.get(input.runId) ?? [];
      if (
        run?.principalScope !== input.principalScope
        || existing.length !== input.expectedSequence
      ) {
        throw new ApplicationConversationConflictError(
          `Run ${input.runId} is outside the admitted scope or no longer at event sequence ${input.expectedSequence}.`,
        );
      }
      const event: ApplicationAIRunEventRecord = {
        ...clone(input.event),
        runId: input.runId,
        sequence: input.expectedSequence + 1,
      };
      events.set(input.runId, [...existing, event]);
      return clone(event);
    },

    async getRunEvent(input) {
      if (runs.get(input.runId)?.principalScope !== input.principalScope) {
        return undefined;
      }
      const event = (events.get(input.runId) ?? []).find(
        (candidate) => candidate.sequence === input.sequence,
      );
      return event ? clone(event) : undefined;
    },

    async getRunEventFrontier(runId, principalScope) {
      if (runs.get(runId)?.principalScope !== principalScope) return 0;
      return events.get(runId)?.at(-1)?.sequence ?? 0;
    },

    async listRunEvents(input) {
      assertLimit(input.limit);
      if (runs.get(input.runId)?.principalScope !== input.principalScope) {
        return [];
      }
      return (events.get(input.runId) ?? [])
        .filter(
          (event) =>
            event.sequence > (input.afterSequence ?? 0)
            && (!input.visibility || event.visibility === input.visibility),
        )
        .slice(0, input.limit)
        .map(clone);
    },
  };
  return Object.freeze(store);
}

function allowedRunTransition(
  from: ApplicationAIProtocolRunRecord['status'],
  to: ApplicationAIProtocolRunRecord['status'],
): boolean {
  if (from === 'running') {
    return (
      to === 'interrupted'
      || to === 'completed'
      || to === 'failed'
      || to === 'cancelled'
    );
  }
  return from === 'interrupted'
    && (to === 'running' || to === 'failed' || to === 'cancelled');
}

function assertLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error('Conversation page limit must be between 1 and 1000.');
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
