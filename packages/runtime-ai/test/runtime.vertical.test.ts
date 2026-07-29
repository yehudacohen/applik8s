import type {
  ApplicationExecutionPrincipal,
  ApplicationOperationDescriptor,
  ApplicationWorkloadAuthorityEnvelope,
} from '@applik8s/core';
import { chat } from '@tanstack/ai';
import { describe, expect, it } from 'vitest';
import {
  type ApplicationAIAgentAttemptLifecycle,
  type ApplicationAIAgentToolContract,
  createApplicationAIAgentRequestHandler,
} from '../src/index.js';

describe('generated application AI runtime', () => {
  it('runs a native TanStack stream with server instructions and physical attempt identity', async () => {
    const invocations: unknown[] = [];
    const lifecycleEvents: string[] = [];
    const handler = createApplicationAIAgentRequestHandler({
      name: 'researcher',
      logicalModel: 'fast',
      instructions: 'Answer with evidence.',
      provider: { kind: 'deterministic', response: 'evidenced' },
      tools: [toolContract()],
      persistence: Object.freeze({ kind: 'test-persistence' }),
      timeoutMs: 5_000,
      maximumConcurrency: 2,
      admit: () => principal(),
      reserveAttempt: ({ runId }) => ({
        runId,
        invocationId: 'invocation-1',
        attemptId: 'attempt-1',
        version: 1,
      }),
      attemptLifecycle: attemptLifecycle(lifecycleEvents),
      invoke: async (...args) => {
        invocations.push(args);
        return {};
      },
      handler: async (request, context) => chat({
        adapter: context.tanstack.adapter,
        messages: request.messages,
        threadId: request.threadId,
        runId: context.runId,
        tools: context.tanstack.tools,
        context: context.tanstack.execution,
      }),
    });

    const response = await handler(agentRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const events = await response.text();
    expect(events).toContain('"type":"RUN_STARTED"');
    expect(events).toContain('"delta":"evidenced"');
    expect(events).toContain('"type":"RUN_FINISHED"');
    expect(invocations).toEqual([]);
    expect(lifecycleEvents).toEqual([
      'dispatching:1',
      'append:RUN_STARTED:2',
      'append:TEXT_MESSAGE_START:3',
      'append:TEXT_MESSAGE_CONTENT:4',
      'append:TEXT_MESSAGE_END:5',
      'append:RUN_FINISHED:6',
      'complete:7',
      'commit:message-',
    ]);
  });

  it('fails closed when admission does not produce a live agent execution principal', async () => {
    const expired = {
      ...principal(),
      deadline: new Date(Date.now() - 1_000).toISOString(),
    };
    const handler = createApplicationAIAgentRequestHandler({
      name: 'researcher',
      logicalModel: 'fast',
      instructions: 'Do work.',
      provider: { kind: 'deterministic' },
      tools: [toolContract()],
      persistence: {},
      timeoutMs: 5_000,
      maximumConcurrency: 1,
      admit: () => expired,
      reserveAttempt: async () => {
        throw new Error('must not reserve');
      },
      attemptLifecycle: attemptLifecycle([]),
      invoke: async () => ({}),
      handler: async () => ({}),
    });

    const response = await handler(agentRequest());

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: 'agent_request_failed',
      message: expect.stringContaining('expired'),
    });
  });

  it('classifies a stream that ends without a terminal event as completion uncertain', async () => {
    const lifecycleEvents: string[] = [];
    const handler = createApplicationAIAgentRequestHandler({
      name: 'researcher',
      logicalModel: 'fast',
      instructions: 'Do work.',
      provider: { kind: 'deterministic' },
      tools: [],
      persistence: {},
      timeoutMs: 5_000,
      maximumConcurrency: 1,
      admit: () => principal(),
      reserveAttempt: ({ runId }) => ({
        runId,
        invocationId: 'invocation-uncertain',
        attemptId: 'attempt-uncertain',
        version: 1,
      }),
      attemptLifecycle: attemptLifecycle(lifecycleEvents),
      invoke: async () => ({}),
      handler: async () => (async function* () {
        yield {
          type: 'RUN_STARTED',
          runId: 'protocol-run-1',
          threadId: 'conversation-1',
          timestamp: 0,
        };
      })(),
    });

    const response = await handler(agentRequest());
    await response.text();

    expect(lifecycleEvents).toEqual([
      'dispatching:1',
      'append:RUN_STARTED:2',
      'fail:completion-uncertain:3',
    ]);
  });
});

function attemptLifecycle(events: string[]): ApplicationAIAgentAttemptLifecycle {
  return {
    async dispatching(reservation) {
      events.push(`dispatching:${reservation.version}`);
      return { ...reservation, version: reservation.version + 1 };
    },
    async append(reservation, event) {
      events.push(`append:${String(event.type)}:${reservation.version}`);
      return { ...reservation, version: reservation.version + 1 };
    },
    async completeProvider(reservation) {
      events.push(`complete:${reservation.version}`);
      return { ...reservation, version: reservation.version + 1 };
    },
    async commitCanonical(reservation, terminal) {
      events.push(`commit:${terminal.messageId.slice(0, 8)}`);
      return { ...reservation, version: reservation.version + 1 };
    },
    async fail(reservation, failure) {
      events.push(`fail:${failure.classification}:${reservation.version}`);
      return { ...reservation, version: reservation.version + 1 };
    },
  };
}

function agentRequest(): Request {
  return new Request('http://agent.test/__applik8s/v1/ai/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      threadId: 'conversation-1',
      runId: 'protocol-run-1',
      messages: [{ role: 'user', content: 'hello' }],
    }),
  });
}

function toolContract(): ApplicationAIAgentToolContract {
  const operation: ApplicationOperationDescriptor = {
    apiVersion: 'applik8s.operation/v1alpha1',
    id: 'applik8s://models/Post/operations/create',
    version: 'v1',
    name: 'create',
    kind: 'model.create',
    input: {
      digest: 'sha256:input',
      schema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
        additionalProperties: false,
      },
    },
    output: {
      digest: 'sha256:output',
      schema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        additionalProperties: false,
      },
    },
    errors: {},
    target: {
      model: 'Post',
      identity: {
        digest: 'sha256:identity',
        schema: { type: 'object', additionalProperties: true },
      },
    },
    authority: {
      classification: 'assigned',
      grantable: false,
      delegable: false,
      checks: ['admission', 'execution'],
      defaultScope: { kind: 'all' },
    },
    transports: [{ id: 'Post.create.v1', transport: 'event' }],
    placement: { nodeId: 'model.Post', runtime: 'command-processor' },
  };
  const workloadAuthority: ApplicationWorkloadAuthorityEnvelope = {
    apiVersion: 'applik8s.workloadAuthority/v1alpha1',
    id: 'envelope-agent-create',
    workloadIdentity: {
      id: 'identity://workloads/researcher',
      kind: 'workload',
      issuer: 'applik8s',
      subject: 'researcher',
    },
    serviceIdentity: {
      id: 'identity://services/researcher',
      kind: 'service',
      issuer: 'applik8s',
      subject: 'researcher',
    },
    operationId: operation.id,
    catalogRevision: 'catalog-1',
    restrictions: { predicates: [] },
    inputSchemaDigest: operation.input.digest,
    audiences: [],
    transports: ['event'],
    delegation: 'forbidden',
    impersonation: 'forbidden',
  };
  return { operation, transport: 'command', workloadAuthority };
}

function principal(): ApplicationExecutionPrincipal {
  return {
    id: 'principal://agent/researcher/run-1',
    identity: {
      id: 'identity://executions/researcher/run-1',
      kind: 'execution',
      issuer: 'applik8s',
      subject: 'researcher/run-1',
    },
    kind: 'execution',
    authenticationMethod: 'workload-envelope',
    audience: ['agent:researcher'],
    trustedContextDigest: 'sha256:context',
    catalogRevision: 'catalog-1',
    authorityRevision: 'authority-1',
    admittedAt: new Date().toISOString(),
    executionKind: 'agent',
    executionId: 'run-1',
    attempt: 1,
    workloadIdentity: {
      id: 'identity://workloads/researcher',
      kind: 'workload',
      issuer: 'applik8s',
      subject: 'researcher',
    },
    serviceIdentity: {
      id: 'identity://services/researcher',
      kind: 'service',
      issuer: 'applik8s',
      subject: 'researcher',
    },
    causalGrantIds: [],
    deadline: new Date(Date.now() + 60_000).toISOString(),
    cancellationRevision: 'cancel-1',
    bindings: [],
    effectiveAuthority: [],
  };
}
