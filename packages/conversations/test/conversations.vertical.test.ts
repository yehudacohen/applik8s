import { app, applicationGraphFor } from '@applik8s/applik8s';
import { describe, expect, it } from 'vitest';
import {
  ApplicationConversationConflictError,
  applicationConversationSchema,
  conversations,
  createMemoryApplicationConversationStore,
} from '../src/index.js';

describe('canonical conversations', () => {
  it('registers ordinary provider-native models and relationships', () => {
    const application = app('conversation-fixture');
    const database = application.database.postgres('application', {
      schema: applicationConversationSchema,
    });
    const module = conversations(application, { database });

    expect(module.Conversation.$model.name).toBe('Conversation');
    expect(module.Message.$model.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'conversation',
          target: 'Conversation',
        }),
      ]),
    );
    expect(module.RunEvent.$model.identity.fields).toEqual(['id']);

    const graph = applicationGraphFor(application.composition);
    expect(
      graph?.nodes
        .filter((node) => node.kind === 'model')
        .map((node) => node.name)
        .sort(),
    ).toEqual(['Conversation', 'Memory', 'Message', 'ProtocolRun', 'RunEvent']);
  });

  it('enforces scope, optimistic revisions, ordered events, and terminal runs', async () => {
    const store = createMemoryApplicationConversationStore();
    await store.createConversation({
      apiVersion: 'applik8s.aiConversation/v1alpha1',
      id: 'conversation-1',
      principalScope: 'principal-a',
      revision: 0,
      createdAt: '2026-07-30T00:00:00.000Z',
      updatedAt: '2026-07-30T00:00:00.000Z',
    });
    const committed = await store.appendMessage({
      conversationId: 'conversation-1',
      principalScope: 'principal-a',
      expectedRevision: 0,
      message: {
        id: 'message-1',
        role: 'user',
        content: { text: 'hello' },
        createdAt: '2026-07-30T00:00:01.000Z',
      },
    });
    expect(committed.message.revision).toBe(1);
    expect(
      await store.listMessages({
        conversationId: 'conversation-1',
        principalScope: 'principal-b',
        limit: 10,
      }),
    ).toEqual([]);
    await expect(
      store.appendMessage({
        conversationId: 'conversation-1',
        principalScope: 'principal-a',
        expectedRevision: 0,
        message: {
          id: 'message-stale',
          role: 'user',
          content: 'stale',
          createdAt: '2026-07-30T00:00:02.000Z',
        },
      }),
    ).rejects.toBeInstanceOf(ApplicationConversationConflictError);

    await store.startRun({
      id: 'run-1',
      conversationId: 'conversation-1',
      principalScope: 'principal-a',
      agentRunId: 'agent-run-1',
      invocationId: 'invocation-1',
      startedAt: '2026-07-30T00:00:03.000Z',
    });
    const event = await store.appendRunEvent({
      runId: 'run-1',
      principalScope: 'principal-a',
      expectedSequence: 0,
      event: {
        apiVersion: 'applik8s.aiRunEvent/v1alpha1',
        type: 'RUN_STARTED',
        payload: { invocationId: 'invocation-1' },
        visibility: 'browser',
        createdAt: '2026-07-30T00:00:03.000Z',
      },
    });
    expect(event.sequence).toBe(1);
    await store.transitionRun({
      runId: 'run-1',
      principalScope: 'principal-a',
      from: 'running',
      to: 'completed',
      updatedAt: '2026-07-30T00:00:04.000Z',
    });
    await expect(
      store.transitionRun({
        runId: 'run-1',
        principalScope: 'principal-a',
        from: 'completed',
        to: 'running',
        updatedAt: '2026-07-30T00:00:05.000Z',
      }),
    ).rejects.toBeInstanceOf(ApplicationConversationConflictError);
  });
});
