import type { ApplicationExecutionPrincipal } from '@applik8s/core';
import { describe, expect, it } from 'vitest';
import {
  applicationAIConversationPrincipalScope,
  createApplicationAIAgentConversationPersistence,
  createMemoryApplicationConversationStore,
} from '../src/index.js';

describe('application AI conversation persistence', () => {
  it('promotes an admitted native agent run into canonical inbox records', async () => {
    const store = createMemoryApplicationConversationStore();
    const persistence = createApplicationAIAgentConversationPersistence({
      store,
      now: () => new Date('2026-08-05T12:00:01.000Z'),
    });
    const input = runInput();
    const run = await persistence.begin(input);

    await run.append({
      type: 'RUN_STARTED',
      runId: input.protocolRunId,
      threadId: input.conversationId,
    });
    await run.complete({
      messageId: 'assistant-1',
      content: 'A durable answer.',
      completedAt: '2026-08-05T12:00:02.000Z',
    });

    const conversation = await store.getConversation(
      input.conversationId,
      run.principalScope,
    );
    expect(conversation).toMatchObject({ revision: 2 });
    expect(
      await store.listMessages({
        conversationId: input.conversationId,
        principalScope: run.principalScope,
        limit: 10,
      }),
    ).toEqual([
      expect.objectContaining({
        id: 'user-1',
        role: 'user',
        content: { id: 'user-1', role: 'user', content: 'Investigate this.' },
      }),
      expect.objectContaining({
        id: 'assistant-1',
        role: 'assistant',
        content: 'A durable answer.',
      }),
    ]);
    expect(
      await store.getRun(input.protocolRunId, run.principalScope),
    ).toMatchObject({
      conversationId: input.conversationId,
      invocationId: input.invocationId,
      status: 'completed',
    });
    expect(
      await store.listRunEvents({
        runId: input.protocolRunId,
        principalScope: run.principalScope,
        limit: 10,
      }),
    ).toEqual([
      expect.objectContaining({
        sequence: 1,
        type: 'RUN_STARTED',
        visibility: 'browser',
      }),
    ]);
  });

  it('makes conversation and protocol-run admission idempotent', async () => {
    const store = createMemoryApplicationConversationStore();
    const persistence = createApplicationAIAgentConversationPersistence({
      store,
    });
    const input = runInput();

    const first = await persistence.begin(input);
    const second = await persistence.begin(input);

    expect(second).toEqual(
      expect.objectContaining({
        conversationId: first.conversationId,
        protocolRunId: first.protocolRunId,
        principalScope: first.principalScope,
      }),
    );
    expect(
      await store.listMessages({
        conversationId: input.conversationId,
        principalScope: first.principalScope,
        limit: 10,
      }),
    ).toHaveLength(1);
    expect(
      await store.getRun(input.protocolRunId, first.principalScope),
    ).toMatchObject({ status: 'running' });
  });

  it('scopes inbox identity to the causal actor and admitted trusted context', () => {
    const base = principal();
    const context = { workspaceId: 'workspace-one' };
    expect(applicationAIConversationPrincipalScope(base, context)).toBe(
      applicationAIConversationPrincipalScope({
        ...base,
        id: 'principal://execution/another-attempt',
        executionId: 'agent-run-2',
        attempt: 2,
      }, context),
    );
    expect(
      applicationAIConversationPrincipalScope(
        base,
        { workspaceId: 'another-workspace' },
      ),
    ).not.toBe(applicationAIConversationPrincipalScope(base, context));
  });
});

function runInput() {
  // Preserve the closed persistence contract without widening its literals.
  // typecast: retain literal message roles and stable protocol identifiers.
  return {
    principal: principal(),
    trustedContext: { workspaceId: 'workspace-one' },
    conversationId: 'conversation-1',
    protocolRunId: 'protocol-run-1',
    agentRunId: 'agent-run-1',
    invocationId: 'invocation-1',
    messages: [
      {
        id: 'user-1',
        role: 'user',
        content: 'Investigate this.',
      },
    ],
    startedAt: '2026-08-05T12:00:00.000Z',
  } as const;
}

function principal(): ApplicationExecutionPrincipal {
  return {
    id: 'principal://execution/agent-run-1',
    identity: {
      id: 'identity://execution/agent-run-1',
      kind: 'execution',
      issuer: 'applik8s',
      subject: 'agent-run-1',
    },
    kind: 'execution',
    authenticationMethod: 'workload-envelope',
    audience: ['agent:researcher'],
    trustedContextDigest: 'sha256:workspace-one',
    catalogRevision: 'catalog-1',
    authorityRevision: 'authority-1',
    admittedAt: '2026-08-05T12:00:00.000Z',
    executionKind: 'agent',
    executionId: 'agent-run-1',
    attempt: 1,
    workloadIdentity: {
      id: 'identity://workload/researcher',
      kind: 'workload',
      issuer: 'applik8s',
      subject: 'researcher',
    },
    causalPrincipal: {
      id: 'identity://human/user-1',
      kind: 'human',
      issuer: 'identity.example',
      subject: 'user-1',
    },
    causalGrantIds: [],
    deadline: '2026-08-05T13:00:00.000Z',
    cancellationRevision: 'cancel-1',
    bindings: [],
    effectiveAuthority: [],
  };
}
