// typecast-file-boundary: rich TanStack AI messages and stream events are
// normalized to JSON before crossing the canonical conversation-store boundary.
import { createHash } from 'node:crypto';
import type {
  ApplicationAIAgentPersistence,
  ApplicationAIAgentPersistenceInput,
  ApplicationAIAgentPersistenceRun,
  ApplicationAIMessageRecord,
  ApplicationAIProtocolRunRecord,
} from '@applik8s/ai';
import {
  type ApplicationExecutionPrincipal,
  type ApplicationIdentityReference,
  type ApplicationPrincipal,
  canonicalJsonV1String,
  type JsonObject,
  type JsonValue,
} from '@applik8s/core';
import {
  ApplicationConversationConflictError,
  type ApplicationConversationStore,
} from './contracts.js';

export interface ApplicationAIAgentConversationPersistenceOptions {
  readonly store: ApplicationConversationStore;
  readonly now?: () => Date;
  readonly scope?: (input: Pick<ApplicationAIAgentPersistenceInput, 'principal' | 'trustedContext'>) => string;
}

/**
 * Adapts the maintained conversation models to the provider-neutral agent
 * persistence seam. IDs, principal scope, input-message promotion, run events,
 * and terminal transitions are all idempotent so an admitted invocation can be
 * repaired after a process restart without duplicating inbox history.
 */
export function createApplicationAIAgentConversationPersistence(
  options: ApplicationAIAgentConversationPersistenceOptions,
): ApplicationAIAgentPersistence {
  const now = options.now ?? (() => new Date());
  return Object.freeze({
    async begin(input: ApplicationAIAgentPersistenceInput) {
      const principalScope = options.scope?.(input)
        ?? applicationAIConversationPrincipalScope(
          input.principal,
          input.trustedContext,
        );
      if (!principalScope.trim()) {
        throw new Error('Agent conversation persistence resolved an empty durable scope.');
      }
      const conversation = await ensureConversation(
        options.store,
        input,
        principalScope,
      );
      await ensureInputMessages(
        options.store,
        input,
        principalScope,
        conversation.revision,
      );
      await ensureRun(options.store, input, principalScope);
      let frontier = await options.store.getRunEventFrontier(
        input.protocolRunId,
        principalScope,
      );

      const run: ApplicationAIAgentPersistenceRun = {
        conversationId: input.conversationId,
        protocolRunId: input.protocolRunId,
        principalScope,

        async append(event) {
          const createdAt = now().toISOString();
          const expectedSequence = frontier;
          try {
            const stored = await options.store.appendRunEvent({
              runId: input.protocolRunId,
              principalScope,
              expectedSequence,
              event: {
                apiVersion: 'applik8s.aiRunEvent/v1alpha1',
                type: requiredString(event.type, 'agent stream event.type'),
                payload: cloneJsonObject(event),
                visibility: 'browser',
                createdAt,
              },
            });
            frontier = stored.sequence;
          } catch (error) {
            if (!(error instanceof ApplicationConversationConflictError)) {
              throw error;
            }
            const sequence = expectedSequence + 1;
            const existing = await options.store.getRunEvent({
              runId: input.protocolRunId,
              principalScope,
              sequence,
            });
            if (
              !existing
              || existing.type !== event.type
              || canonicalJsonV1String(existing.payload) !== canonicalJsonV1String(event)
            ) {
              throw error;
            }
            frontier = existing.sequence;
          }
        },

        async complete(terminal) {
          await ensureMessage(options.store, {
            conversationId: input.conversationId,
            principalScope,
            id: terminal.messageId,
            role: 'assistant',
            content: terminal.content,
            invocationId: input.invocationId,
            createdAt: terminal.completedAt,
          });
          await ensureRunStatus(
            options.store,
            input.protocolRunId,
            principalScope,
            'completed',
            terminal.completedAt,
          );
        },

        async terminate(terminal) {
          await ensureRunStatus(
            options.store,
            input.protocolRunId,
            principalScope,
            terminal.status,
            terminal.terminatedAt,
            terminal.reason,
          );
        },
      };
      return Object.freeze(run);
    },
  });
}

/**
 * Human/request identity plus admitted context, never ephemeral execution
 * identity, defines the durable inbox boundary. A workspace promoted into
 * trusted context therefore gets a distinct scope automatically.
 */
export function applicationAIConversationPrincipalScope(
  principal: ApplicationPrincipal | ApplicationExecutionPrincipal,
  trustedContext: Readonly<Record<string, JsonValue>>,
): string {
  const actor = 'causalPrincipal' in principal
    ? principal.causalPrincipal ?? principal.identity
    : principal.identity;
  return `principal_${createHash('sha256')
    .update(canonicalJsonV1String({
      actor: identityScope(actor),
      trustedContext,
    }))
    .digest('hex')}`;
}

async function ensureConversation(
  store: ApplicationConversationStore,
  input: ApplicationAIAgentPersistenceInput,
  principalScope: string,
) {
  const existing = await store.getConversation(
    input.conversationId,
    principalScope,
  );
  if (existing) return existing;
  const title = conversationTitle(input.messages);
  try {
    return await store.createConversation({
      apiVersion: 'applik8s.aiConversation/v1alpha1',
      id: requiredString(input.conversationId, 'conversationId'),
      principalScope,
      ...(title ? { title } : {}),
      revision: 0,
      createdAt: input.startedAt,
      updatedAt: input.startedAt,
    });
  } catch (error) {
    if (!(error instanceof ApplicationConversationConflictError)) throw error;
    const raced = await store.getConversation(
      input.conversationId,
      principalScope,
    );
    if (raced) return raced;
    throw new ApplicationConversationConflictError(
      `Conversation ${input.conversationId} already belongs to another admitted principal scope.`,
    );
  }
}

function conversationTitle(messages: readonly JsonValue[]): string | undefined {
  for (const value of messages) {
    const message = jsonObjectOrUndefined(value);
    if (messageRole(message?.role) !== 'user') continue;
    const direct = typeof message?.content === 'string'
      ? message.content
      : undefined;
    const parts = Array.isArray(message?.parts) ? message.parts : [];
    const fromParts = parts
      .map(part => jsonObjectOrUndefined(part))
      .filter(part => part?.type === 'text' && typeof part.content === 'string')
      .map(part => String(part?.content))
      .join(' ');
    const source = (direct ?? fromParts).replace(/\s+/gu, ' ').trim();
    if (!source) continue;
    const prefix = source.slice(0, 69).trimEnd();
    const wordBoundary = prefix.lastIndexOf(' ');
    const bounded = source.length > 72
      ? `${wordBoundary >= 48 ? prefix.slice(0, wordBoundary) : prefix}…`
      : source;
    return bounded.replace(/^./u, character => character.toUpperCase());
  }
  return undefined;
}

async function ensureInputMessages(
  store: ApplicationConversationStore,
  input: ApplicationAIAgentPersistenceInput,
  principalScope: string,
  initialRevision: number,
): Promise<void> {
  let revision = initialRevision;
  for (const [index, value] of input.messages.entries()) {
    const normalized = normalizedInputMessage(input, index, value);
    const existing = await store.getMessage({
      id: normalized.id,
      conversationId: input.conversationId,
      principalScope,
    });
    if (existing) {
      assertSameMessage(existing, normalized);
      revision = Math.max(revision, existing.revision);
      continue;
    }
    try {
      const appended = await store.appendMessage({
        conversationId: input.conversationId,
        principalScope,
        expectedRevision: revision,
        message: normalized,
      });
      revision = appended.conversation.revision;
    } catch (error) {
      if (!(error instanceof ApplicationConversationConflictError)) throw error;
      const raced = await store.getMessage({
        id: normalized.id,
        conversationId: input.conversationId,
        principalScope,
      });
      if (raced) {
        assertSameMessage(raced, normalized);
        revision = Math.max(revision, raced.revision);
        continue;
      }
      const conversation = await store.getConversation(
        input.conversationId,
        principalScope,
      );
      if (!conversation) throw error;
      revision = conversation.revision;
      const appended = await store.appendMessage({
        conversationId: input.conversationId,
        principalScope,
        expectedRevision: revision,
        message: normalized,
      });
      revision = appended.conversation.revision;
    }
  }
}

async function ensureRun(
  store: ApplicationConversationStore,
  input: ApplicationAIAgentPersistenceInput,
  principalScope: string,
): Promise<ApplicationAIProtocolRunRecord> {
  const existing = await store.getRun(input.protocolRunId, principalScope);
  if (existing) {
    assertSameRun(existing, input);
    return existing;
  }
  try {
    return await store.startRun({
      id: input.protocolRunId,
      conversationId: input.conversationId,
      principalScope,
      agentRunId: input.agentRunId,
      invocationId: input.invocationId,
      startedAt: input.startedAt,
    });
  } catch (error) {
    if (!(error instanceof ApplicationConversationConflictError)) throw error;
    const raced = await store.getRun(input.protocolRunId, principalScope);
    if (!raced) throw error;
    assertSameRun(raced, input);
    return raced;
  }
}

async function ensureMessage(
  store: ApplicationConversationStore,
  input: {
    readonly conversationId: string;
    readonly principalScope: string;
    readonly id: string;
    readonly role: ApplicationAIMessageRecord['role'];
    readonly content: JsonValue;
    readonly invocationId: string;
    readonly createdAt: string;
  },
): Promise<void> {
  const existing = await store.getMessage({
    id: input.id,
    conversationId: input.conversationId,
    principalScope: input.principalScope,
  });
  if (existing) {
    assertSameMessage(existing, input);
    return;
  }
  const conversation = await store.getConversation(
    input.conversationId,
    input.principalScope,
  );
  if (!conversation) {
    throw new ApplicationConversationConflictError(
      `Conversation ${input.conversationId} disappeared before message ${input.id} could be committed.`,
    );
  }
  try {
    await store.appendMessage({
      conversationId: input.conversationId,
      principalScope: input.principalScope,
      expectedRevision: conversation.revision,
      message: input,
    });
  } catch (error) {
    if (!(error instanceof ApplicationConversationConflictError)) throw error;
    const raced = await store.getMessage({
      id: input.id,
      conversationId: input.conversationId,
      principalScope: input.principalScope,
    });
    if (!raced) throw error;
    assertSameMessage(raced, input);
  }
}

async function ensureRunStatus(
  store: ApplicationConversationStore,
  runId: string,
  principalScope: string,
  status: 'completed' | 'interrupted' | 'failed' | 'cancelled',
  updatedAt: string,
  terminalReason?: string,
): Promise<void> {
  const run = await store.getRun(runId, principalScope);
  if (!run) {
    throw new ApplicationConversationConflictError(
      `Run ${runId} disappeared before terminal persistence.`,
    );
  }
  if (run.status === status) return;
  if (run.status !== 'running') {
    throw new ApplicationConversationConflictError(
      `Run ${runId} is already ${run.status}; it cannot become ${status}.`,
    );
  }
  await store.transitionRun({
    runId,
    principalScope,
    from: 'running',
    to: status,
    updatedAt,
    ...(terminalReason ? { terminalReason } : {}),
  });
}

function normalizedInputMessage(
  input: ApplicationAIAgentPersistenceInput,
  index: number,
  value: JsonValue,
) {
  const record = jsonObjectOrUndefined(value);
  const role = messageRole(record?.role);
  const content = cloneJson(value);
  const explicitId = typeof record?.id === 'string' && record.id.trim()
    ? record.id
    : undefined;
  return {
    id: explicitId ?? `input_${createHash('sha256')
      .update(input.conversationId)
      .update('\0')
      .update(String(index))
      .update('\0')
      .update(canonicalJsonV1String(content))
      .digest('hex')}`,
    role,
    content,
    invocationId: input.invocationId,
    createdAt: input.startedAt,
  } as const;
}

function messageRole(value: unknown): ApplicationAIMessageRecord['role'] {
  return value === 'system'
    || value === 'user'
    || value === 'assistant'
    || value === 'tool'
    ? value
    : 'user';
}

function assertSameMessage(
  existing: ApplicationAIMessageRecord,
  expected: {
    readonly id: string;
    readonly role: ApplicationAIMessageRecord['role'];
    readonly content: JsonValue;
  },
): void {
  if (
    existing.id !== expected.id
    || existing.role !== expected.role
    || canonicalJsonV1String(existing.content) !== canonicalJsonV1String(expected.content)
  ) {
    throw new ApplicationConversationConflictError(
      `Message ${expected.id} was reused with different durable content.`,
    );
  }
}

function assertSameRun(
  run: ApplicationAIProtocolRunRecord,
  input: ApplicationAIAgentPersistenceInput,
): void {
  if (
    run.conversationId !== input.conversationId
    || run.agentRunId !== input.agentRunId
    || run.invocationId !== input.invocationId
  ) {
    throw new ApplicationConversationConflictError(
      `Run ${input.protocolRunId} was reused for another conversation or invocation.`,
    );
  }
}

function identityScope(identity: ApplicationIdentityReference): JsonObject {
  return {
    id: identity.id,
    kind: identity.kind,
    issuer: identity.issuer,
    subject: identity.subject,
  };
}

function jsonObjectOrUndefined(
  value: JsonValue,
): Readonly<Record<string, JsonValue>> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function cloneJson<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneJsonObject(value: JsonObject): JsonObject {
  return cloneJson(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Application AI conversation persistence requires ${field}.`);
  }
  return value;
}
