import { describe, expect, it } from 'vitest';
import {
  createMemoryApplicationConversationStore,
} from '../src/index.js';
import { createApplicationTanStackConversationPersistence } from '../src/runtime.js';

describe('TanStack AI conversation persistence adapter', () => {
  it('round-trips an authoritative transcript through the admitted Applik8s scope', async () => {
    const store = createMemoryApplicationConversationStore();
    const persistence = createApplicationTanStackConversationPersistence({
      store,
      principalScope: 'workspace-1',
      now: () => new Date('2026-08-17T12:00:00.000Z'),
    });
    await persistence.stores.messages.saveThread('conversation-1', [
      { role: 'user', content: 'Create a launch brief.', id: 'message-1' },
      { role: 'assistant', content: 'I created the brief.', id: 'message-2' },
    ]);

    await expect(persistence.stores.messages.loadThread('conversation-1')).resolves.toEqual([
      expect.objectContaining({ role: 'user', content: 'Create a launch brief.', id: 'message-1' }),
      expect.objectContaining({ role: 'assistant', content: 'I created the brief.', id: 'message-2' }),
    ]);
    await expect(store.getConversation('conversation-1', 'workspace-1')).resolves.toMatchObject({
      revision: 2,
      principalScope: 'workspace-1',
    });
    await expect(createApplicationTanStackConversationPersistence({
      store,
      principalScope: 'workspace-2',
    }).stores.messages.loadThread('conversation-1')).resolves.toEqual([]);
  });

  it('normalizes JSON-hydrated message timestamps at the persistence boundary', async () => {
    const store = createMemoryApplicationConversationStore();
    const persistence = createApplicationTanStackConversationPersistence({
      store,
      principalScope: 'workspace-1',
      now: () => new Date('2026-08-17T12:00:00.000Z'),
    });
    await persistence.stores.messages.saveThread('conversation-1', [{
      role: 'assistant',
      content: 'Transport-hydrated response.',
      id: 'message-1',
      // A browser/server JSON boundary serializes Date to an ISO string even
      // though TanStack's in-process type is Date.
      // typecast: model the hydrated runtime value while retaining TanStack's Date-typed fixture contract.
      createdAt: '2026-08-17T12:00:01.000Z' as unknown as Date,
    }]);

    await expect(store.listMessages({
      conversationId: 'conversation-1',
      principalScope: 'workspace-1',
      limit: 10,
    })).resolves.toEqual([
      expect.objectContaining({
        id: 'message-1',
        createdAt: '2026-08-17T12:00:01.000Z',
        content: expect.objectContaining({
          createdAt: '2026-08-17T12:00:01.000Z',
        }),
      }),
    ]);
  });

  it('preserves TanStack protocol-run state without weakening canonical status', async () => {
    const store = createMemoryApplicationConversationStore();
    const persistence = createApplicationTanStackConversationPersistence({
      store,
      principalScope: 'workspace-1',
    });
    await persistence.stores.messages.saveThread('conversation-1', []);
    const runs = persistence.stores.runs;
    expect(runs).toBeDefined();
    if (!runs) throw new Error('TanStack run persistence was not installed.');
    const run = await runs.createOrResume({
      runId: 'run-1',
      threadId: 'conversation-1',
      startedAt: Date.parse('2026-08-17T12:00:00.000Z'),
    });
    expect(run.status).toBe('running');
    await runs.update('run-1', {
      status: 'completed',
      finishedAt: Date.parse('2026-08-17T12:00:02.000Z'),
      usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
    });

    await expect(runs.get('run-1')).resolves.toMatchObject({
      status: 'completed',
      finishedAt: Date.parse('2026-08-17T12:00:02.000Z'),
      usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
    });
    await expect(store.getRun('run-1', 'workspace-1')).resolves.toMatchObject({
      status: 'completed',
      runtimeState: { status: 'completed' },
    });
  });
});
