import type { ApplicationAIProtocolRunRecord } from '@applik8s/ai';
import type { JsonObject, JsonValue } from '@applik8s/core';
import {
  isRunStatus,
  type ModelMessage,
  type RunRecord,
  type RunStatus,
  type UIMessage,
  uiMessageToModelMessages,
} from '@tanstack/ai';
import {
  defineAIPersistence,
  defineMessageStore,
  defineRunStore,
  type ChatTranscriptPersistence,
} from '@tanstack/ai-persistence';
import { createHash } from 'node:crypto';

import type {
  ApplicationConversationMessageInput,
  ApplicationConversationStore,
} from './contracts.js';
import { ApplicationConversationConflictError } from './contracts.js';

export interface ApplicationTanStackConversationPersistenceOptions {
  readonly store: ApplicationConversationStore;
  /**
   * Server-derived authority scope. A browser-supplied thread id is never an
   * ownership proof and cannot select records outside this admitted scope.
   */
  readonly principalScope: string;
  readonly now?: () => Date;
}

/**
 * Adapt the canonical Applik8s conversation store to TanStack AI's published
 * transcript and run persistence contracts. TanStack owns lifecycle semantics;
 * Applik8s owns admission, tenant isolation, and the physical records.
 */
export function createApplicationTanStackConversationPersistence(
  options: ApplicationTanStackConversationPersistenceOptions,
): ChatTranscriptPersistence {
  const principalScope = options.principalScope.trim();
  if (!principalScope) {
    throw new Error('TanStack conversation persistence requires an admitted principal scope.');
  }
  const now = options.now ?? (() => new Date());

  const messages = defineMessageStore({
    async loadThread(threadId) {
      const conversation = await options.store.getConversation(threadId, principalScope);
      if (!conversation) return [];
      const records = await loadAllMessages(options.store, threadId, principalScope);
      return records.flatMap(record => modelMessagesFromStoredValue(
        record.content,
        record.id,
        record.createdAt,
      ));
    },
    async saveThread(threadId, transcript) {
      const instant = now().toISOString();
      await ensureConversation(options.store, threadId, principalScope, instant);
      const existing = await loadAllMessages(options.store, threadId, principalScope);
      const existingCreatedAt = new Map(existing.map(message => [message.id, message.createdAt]));
      const persisted = transcript.map((message, index) => {
        const id = message.id?.trim() || stableMessageId(threadId, message, index);
        // TanStack's public type uses Date, but browser/server transport
        // hydration necessarily crosses JSON and can therefore supply the
        // same instant as an ISO string. Normalize at this adapter boundary
        // instead of requiring every transport to reconstitute Date objects.
        const createdAt = normalizedInstant(
          message.createdAt,
          existingCreatedAt.get(id) ?? instant,
        );
        return {
          id,
          role: message.role,
          content: jsonValue({
            ...message,
            ...(message.createdAt ? { createdAt } : {}),
          }, `TanStack transcript message ${id}`),
          createdAt,
        } satisfies ApplicationConversationMessageInput;
      });
      await options.store.replaceMessages({
        conversationId: threadId,
        principalScope,
        messages: persisted,
        updatedAt: instant,
      });
    },
  });

  const runs = defineRunStore({
    async createOrResume(input) {
      const existing = await options.store.getRun(input.runId, principalScope);
      if (existing) return tanStackRun(existing);
      const startedAt = new Date(input.startedAt).toISOString();
      await ensureConversation(options.store, input.threadId, principalScope, startedAt);
      const created = await options.store.startRun({
        id: input.runId,
        conversationId: input.threadId,
        principalScope,
        startedAt,
      });
      if (input.status && input.status !== 'running') {
        const updated = await options.store.patchRun({
          runId: input.runId,
          principalScope,
          status: applicationRunStatus(input.status),
          updatedAt: now().toISOString(),
          runtimeState: runState({ status: input.status }),
        });
        if (updated) return tanStackRun(updated);
      }
      return tanStackRun(created);
    },
    async update(runId, patch) {
      const existing = await options.store.getRun(runId, principalScope);
      if (!existing) return;
      const currentState = existing.runtimeState ?? {};
      const nextState = runState({ ...currentState, ...patch });
      await options.store.patchRun({
        runId,
        principalScope,
        ...(patch.status ? { status: applicationRunStatus(patch.status) } : {}),
        updatedAt: now().toISOString(),
        ...(patch.error
          ? { terminalReason: patch.error.message }
          : patch.status === 'completed'
            ? { terminalReason: null }
            : {}),
        runtimeState: nextState,
      });
    },
    async get(runId) {
      const run = await options.store.getRun(runId, principalScope);
      return run ? tanStackRun(run) : null;
    },
    async findActiveRun(threadId) {
      const candidates = (await options.store.listRuns({
        conversationId: threadId,
        principalScope,
      }))
        .map(tanStackRun)
        .filter(run => run.status === 'running' || run.status === 'interrupted')
        .sort((left, right) => right.startedAt - left.startedAt);
      return candidates[0] ?? null;
    },
    async listByThread(threadId) {
      return (await options.store.listRuns({
        conversationId: threadId,
        principalScope,
      }))
        .map(tanStackRun)
        .sort((left, right) => left.startedAt - right.startedAt);
    },
  });

  return defineAIPersistence({ stores: { messages, runs } });
}

function normalizedInstant(value: unknown, fallback: string): string {
  if (value === undefined || value === null) return fallback;
  if (
    !(value instanceof Date)
    && typeof value !== 'string'
    && typeof value !== 'number'
  ) {
    throw new TypeError('TanStack transcript message createdAt must be a valid instant.');
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError('TanStack transcript message createdAt must be a valid instant.');
  }
  return date.toISOString();
}

async function ensureConversation(
  store: ApplicationConversationStore,
  threadId: string,
  principalScope: string,
  instant: string,
): Promise<void> {
  if (await store.getConversation(threadId, principalScope)) return;
  try {
    await store.createConversation({
      apiVersion: 'applik8s.aiConversation/v1alpha1',
      id: threadId,
      principalScope,
      revision: 0,
      createdAt: instant,
      updatedAt: instant,
    });
  } catch (error) {
    if (
      error instanceof ApplicationConversationConflictError
      && await store.getConversation(threadId, principalScope)
    ) return;
    throw error;
  }
}

async function loadAllMessages(
  store: ApplicationConversationStore,
  conversationId: string,
  principalScope: string,
) {
  const values = [];
  let afterRevision: number | undefined;
  while (true) {
    const page = await store.listMessages({
      conversationId,
      principalScope,
      ...(afterRevision !== undefined ? { afterRevision } : {}),
      limit: 250,
    });
    values.push(...page);
    if (page.length < 250) return values;
    afterRevision = page.at(-1)?.revision;
  }
}

function modelMessagesFromStoredValue(
  value: JsonValue,
  id: string,
  createdAt: string,
): ModelMessage[] {
  // typecast: stored JSON crosses a validated role/parts/content discriminant
  // before restoring TanStack's published message shapes.
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [{ role: 'assistant', content: printable(value), id, createdAt: new Date(createdAt) }];
  }
  const role = Reflect.get(value, 'role');
  const parts = Reflect.get(value, 'parts');
  if ((role === 'user' || role === 'assistant' || role === 'system') && Array.isArray(parts)) {
    const uiMessage: UIMessage = {
      ...(value as unknown as UIMessage), // typecast: role and parts discriminants validated above
      id: typeof Reflect.get(value, 'id') === 'string' ? Reflect.get(value, 'id') : id,
      createdAt: new Date(createdAt),
    };
    return uiMessageToModelMessages(uiMessage);
  }
  if (role === 'user' || role === 'assistant' || role === 'tool') {
    const content = Reflect.get(value, 'content');
    return [{
      ...(value as unknown as ModelMessage), // typecast: role and content discriminants validated above
      role,
      content: isModelContent(content) ? content : printable(content),
      id: typeof Reflect.get(value, 'id') === 'string' ? Reflect.get(value, 'id') : id,
      createdAt: new Date(createdAt),
    }];
  }
  return [{ role: 'assistant', content: printable(value), id, createdAt: new Date(createdAt) }];
}

function isModelContent(value: unknown): value is ModelMessage['content'] {
  return value === null || typeof value === 'string' || Array.isArray(value);
}

function stableMessageId(threadId: string, message: ModelMessage, index: number): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([threadId, index, message.role, message.content]))
    .digest('hex')
    .slice(0, 24);
  return `message-${digest}`;
}

function tanStackRun(record: ApplicationAIProtocolRunRecord): RunRecord {
  const runtime = record.runtimeState ?? {};
  const storedStatus = Reflect.get(runtime, 'status');
  const status = isRunStatus(storedStatus)
    ? storedStatus
    : tanStackRunStatus(record.status);
  return {
    runId: record.id,
    threadId: record.conversationId,
    status,
    startedAt: Date.parse(record.startedAt),
    ...numberField(runtime, 'finishedAt'),
    ...objectField(runtime, 'error'),
    ...objectField(runtime, 'usage'),
    ...stringField(runtime, 'sandboxKey'),
    ...numberField(runtime, 'detachedSince'),
    ...booleanField(runtime, 'cancelRequested'),
    ...numberField(runtime, 'driverEpoch'),
  };
}

function applicationRunStatus(status: RunStatus): ApplicationAIProtocolRunRecord['status'] {
  switch (status) {
    case 'running': return 'running';
    case 'interrupted': return 'interrupted';
    case 'completed': return 'completed';
    case 'failed': return 'failed';
    case 'aborted': return 'cancelled';
  }
}

function tanStackRunStatus(status: ApplicationAIProtocolRunRecord['status']): RunStatus {
  switch (status) {
    case 'running': return 'running';
    case 'interrupted': return 'interrupted';
    case 'completed': return 'completed';
    case 'failed': return 'failed';
    case 'cancelled': return 'aborted';
  }
}

function runState(value: Record<string, unknown>): JsonObject {
  // typecast: jsonValue recursively rejects non-JSON run-state values.
  return jsonValue(value, 'TanStack run state') as JsonObject;
}

function stringField(value: JsonObject, key: string): Record<string, string> {
  const field = Reflect.get(value, key);
  return typeof field === 'string' ? { [key]: field } : {};
}

function numberField(value: JsonObject, key: string): Record<string, number> {
  const field = Reflect.get(value, key);
  return typeof field === 'number' && Number.isFinite(field) ? { [key]: field } : {};
}

function booleanField(value: JsonObject, key: string): Record<string, boolean> {
  const field = Reflect.get(value, key);
  return typeof field === 'boolean' ? { [key]: field } : {};
}

function objectField(value: JsonObject, key: string): Record<string, never> | Record<string, object> {
  const field = Reflect.get(value, key);
  return field && typeof field === 'object' && !Array.isArray(field) ? { [key]: field } : {};
}

function jsonValue(value: unknown, label: string): JsonValue {
  try {
    // typecast: the JSON stringify/parse round trip is the runtime validator.
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch (error) {
    throw new Error(`${label} must be JSON-serializable.`, { cause: error });
  }
}

function printable(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}
