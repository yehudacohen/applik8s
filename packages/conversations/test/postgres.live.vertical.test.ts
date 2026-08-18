import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createPostgresApplicationConversationStore } from '../src/postgres.js';

const databaseUrl = process.env.APPLIK8S_CONVERSATIONS_POSTGRES_DATABASE_URL;
const liveDescribe = databaseUrl ? describe : describe.skip;

liveDescribe('PostgreSQL conversation authority', () => {
  const sql = postgres(databaseUrl ?? '', { prepare: false });
  const schema = `applik8s_conversations_${process.pid}_${Date.now()}`;
  const accessSetting = 'applik8s.context.principalScope';
  const store = createPostgresApplicationConversationStore({
    sql,
    schema,
    access: { setting: accessSetting },
  });

  beforeAll(async () => {
    await sql.unsafe(`CREATE SCHEMA "${schema}"`);
    await store.prepare();
    await sql.unsafe(
      `ALTER TABLE "${schema}"."applik8s_conversations" ENABLE ROW LEVEL SECURITY`,
    );
    await sql.unsafe(
      `ALTER TABLE "${schema}"."applik8s_conversations" FORCE ROW LEVEL SECURITY`,
    );
    await sql.unsafe(
      `CREATE POLICY conversation_scope ON "${schema}"."applik8s_conversations"
       USING (principal_scope = current_setting('${accessSetting}', true))
       WITH CHECK (principal_scope = current_setting('${accessSetting}', true))`,
    );
  });

  afterAll(async () => {
    await sql.unsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await sql.end({ timeout: 5 });
  });

  test('round-trips structured messages and run events without driver-specific JSON assumptions', async () => {
    const now = new Date().toISOString();
    await store.createConversation({
      apiVersion: 'applik8s.aiConversation/v1alpha1',
      id: 'conversation-1',
      principalScope: 'principal-scope-1',
      revision: 0,
      createdAt: now,
      updatedAt: now,
    });
    const appended = await store.appendMessage({
      conversationId: 'conversation-1',
      principalScope: 'principal-scope-1',
      expectedRevision: 0,
      message: {
        id: 'message-1',
        role: 'user',
        content: {
          parts: [{ type: 'text', content: 'durable evidence' }],
        },
        createdAt: now,
      },
    });
    expect(appended.message.content).toEqual({
      parts: [{ type: 'text', content: 'durable evidence' }],
    });

    await store.startRun({
      id: 'run-1',
      conversationId: 'conversation-1',
      principalScope: 'principal-scope-1',
      startedAt: now,
    });
    await expect(
      store.getConversation('conversation-1', 'another-principal-scope'),
    ).resolves.toBeUndefined();
    const event = await store.appendRunEvent({
      runId: 'run-1',
      principalScope: 'principal-scope-1',
      expectedSequence: 0,
      event: {
        apiVersion: 'applik8s.aiRunEvent/v1alpha1',
        type: 'RUN_STARTED',
        payload: { type: 'RUN_STARTED', timestamp: 1 },
        visibility: 'browser',
        createdAt: now,
      },
    });
    expect(event.payload).toEqual({ type: 'RUN_STARTED', timestamp: 1 });
    await expect(
      store.listRunEvents({
        runId: 'run-1',
        principalScope: 'principal-scope-1',
        limit: 10,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        sequence: 1,
        payload: { type: 'RUN_STARTED', timestamp: 1 },
      }),
    ]);
  });
});
