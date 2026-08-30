// typecast-file-boundary: AI runtime tests deliberately inspect provider payload fixtures after validation.

import type { ApplicationAIAgentPersistence } from '@applik8s/ai';
import {
  type ApplicationExecutionPrincipal,
  type ApplicationOperationDescriptor,
  type ApplicationWorkloadAuthorityEnvelope,
  createApplicationAdmissionContextV1,
  createApplicationTelemetryEnvelopeV1,
  withApplicationAdmissionExecutionV1,
} from '@applik8s/core';
import { chat } from '@tanstack/ai';
import { memoryPersistence } from '@tanstack/ai-persistence';
import { describe, expect, it } from 'vitest';
import {
  type ApplicationAIAgentAttemptLifecycle,
  type ApplicationAIAgentTelemetryBoundary,
  type ApplicationAIAgentToolContract,
  applicationAITextAdapter,
  createApplicationAIAgentRequestHandler,
} from '../src/index.js';

describe('generated application AI runtime', () => {
  it('links one durable agent attempt to its producer and nests provider and tool attempts', async () => {
    const boundaries: Array<{
      readonly boundary: ApplicationAIAgentTelemetryBoundary;
      readonly parent?: string;
    }> = [];
    let activeBoundary: string | undefined;
    const telemetry = {
      async run<TResult>(
        boundary: ApplicationAIAgentTelemetryBoundary,
        execute: () => Promise<TResult>,
      ): Promise<TResult> {
        const parent = activeBoundary;
        boundaries.push({ boundary, ...(parent ? { parent } : {}) });
        activeBoundary = String(boundary.kind);
        try {
          return await execute();
        } finally {
          activeBoundary = parent;
        }
      },
    };
    const producer = createApplicationTelemetryEnvelopeV1({
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      identity: {
        application: 'research',
        environment: 'test',
        target: 'local',
        operation: 'http:agent',
        execution: 'gateway-request-1',
        attempt: 1,
      },
    });
    const handler = createApplicationAIAgentRequestHandler({
      name: 'researcher',
      logicalModel: 'fast',
      instructions: 'Use the declared operation.',
      provider: {
        kind: 'deterministic',
        response: 'The typed operation completed.',
        tool: { input: { text: 'telemetry fixture' } },
      },
      tools: [toolContract()],
      persistence: persistence(),
      tanstackPersistence: memoryPersistence,
      timeoutMs: 5_000,
      maximumConcurrency: 1,
      telemetry,
      admit: () => ({ ...admission(), telemetry: producer }),
      reserveAttempt: ({ runId }) => ({
        action: 'dispatch',
        runId,
        invocationId: 'invocation-telemetry',
        attemptId: 'attempt-telemetry',
        ordinal: 2,
        version: 1,
        telemetry: producer,
      }),
      recovery: unavailableRecovery(),
      attemptLifecycle: attemptLifecycle([]),
      invoke: async () => ({ id: 'post-1' }),
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
    await response.text();

    expect(boundaries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        boundary: expect.objectContaining({
          kind: 'agent',
          identity: 'researcher',
          execution: 'invocation-telemetry',
          attempt: 2,
          relationship: 'asynchronous',
          links: [producer],
        }),
      }),
      expect.objectContaining({
        parent: 'agent',
        boundary: expect.objectContaining({
          kind: 'provider',
          provider: 'applik8s-deterministic',
          instance: 'attempt-telemetry',
        }),
      }),
      expect.objectContaining({
        parent: 'agent',
        boundary: expect.objectContaining({
          kind: 'operation',
          identity: 'applik8s://models/Post/operations/create',
          instance: 'attempt-telemetry',
        }),
      }),
    ]));
    expect(
      boundaries.filter(({ boundary }) => boundary.kind === 'agent'),
    ).toHaveLength(1);
    expect(
      boundaries.filter(({ boundary }) => boundary.kind === 'provider'),
    ).toHaveLength(2);
  });

  it('constructs a managed OpenAI-compatible gateway adapter without upstream credentials', () => {
    expect(() =>
      applicationAITextAdapter({
        kind: 'openai-compatible',
        name: 'managed-gateway',
        baseUrl: 'http://identity-start-inference.identity-start-system.svc:8080/v1',
        model: 'fast',
        allowInsecureHttp: true,
      }),
    ).not.toThrow();
  });

  it('runs a native TanStack stream with server instructions and physical attempt identity', async () => {
    const invocations: unknown[] = [];
    const lifecycleEvents: string[] = [];
    const providerTerminals: unknown[] = [];
    const handler = createApplicationAIAgentRequestHandler({
      name: 'researcher',
      logicalModel: 'fast',
      instructions: 'Answer with evidence.',
      provider: { kind: 'deterministic', response: 'evidenced' },
      tools: [toolContract()],
      persistence: persistence(),
      tanstackPersistence: memoryPersistence,
      timeoutMs: 5_000,
      maximumConcurrency: 2,
      admit: () => admission(),
      reserveAttempt: ({ runId }) => ({
        action: 'dispatch',
        runId,
        invocationId: 'invocation-1',
        attemptId: 'attempt-1',
        ordinal: 1,
        version: 1,
      }),
      recovery: unavailableRecovery(),
      attemptLifecycle: attemptLifecycle(lifecycleEvents, providerTerminals),
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
    expect(providerTerminals).toEqual([
      expect.objectContaining({
        estimatedInputTokens: expect.any(Number),
        estimatedOutputTokens: expect.any(Number),
      }),
    ]);
  });

  it('executes a declared typed tool from a deterministic starter fixture before returning text', async () => {
    const invocations: unknown[] = [];
    const handler = createApplicationAIAgentRequestHandler({
      name: 'researcher',
      logicalModel: 'fast',
      instructions: 'Use the declared operation.',
      provider: {
        kind: 'deterministic',
        response: 'The typed operation completed.',
        tool: { input: { text: 'from deterministic fixture' } },
      },
      tools: [toolContract()],
      persistence: persistence(),
      tanstackPersistence: memoryPersistence,
      timeoutMs: 5_000,
      maximumConcurrency: 1,
      admit: () => admission(),
      reserveAttempt: ({ runId }) => ({
        action: 'dispatch',
        runId,
        invocationId: 'invocation-tool',
        attemptId: 'attempt-tool',
        ordinal: 1,
        version: 1,
      }),
      recovery: unavailableRecovery(),
      attemptLifecycle: attemptLifecycle([]),
      invoke: async (operation, input, invocation) => {
        invocations.push({ operation: operation.id, input, invocation });
        return { id: 'post-1' };
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
    const events = await response.text();

    expect(events).toContain('"type":"TOOL_CALL_START"');
    expect(events).toContain('"delta":"The typed operation completed."');
    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toMatchObject({
      operation: 'applik8s://models/Post/operations/create',
      input: { text: 'from deterministic fixture' },
      invocation: {
        invocationId: 'invocation-tool',
        attemptId: 'attempt-tool',
        providerToolCallId: expect.stringMatching(/^tool-call-/),
      },
    });
  });

  it('shares one deterministic provider with a tool-free logical role when the fixture tool is optional', async () => {
    const handler = createApplicationAIAgentRequestHandler({
      name: 'durable-specialist',
      logicalModel: 'research-specialist',
      instructions: 'Synthesize only supplied evidence.',
      provider: {
        kind: 'deterministic',
        response: 'Evidence-bounded specialist result.',
        tool: { input: { text: 'interactive-only' }, required: false },
      },
      tools: [],
      persistence: persistence(),
      tanstackPersistence: memoryPersistence,
      timeoutMs: 5_000,
      maximumConcurrency: 1,
      admit: () => admission(),
      reserveAttempt: ({ runId }) => ({
        action: 'dispatch', runId, invocationId: 'invocation-specialist',
        attemptId: 'attempt-specialist', ordinal: 1, version: 1,
      }),
      recovery: unavailableRecovery(),
      attemptLifecycle: attemptLifecycle([]),
      invoke: async () => {
        throw new Error('A tool-free role must not invoke the interactive fixture tool.');
      },
      handler: async (request, context) => chat({
        adapter: context.tanstack.adapter,
        messages: request.messages,
        stream: false,
        context: context.tanstack.execution,
      }),
    });

    const response = await handler(agentRequest('Summarize supplied evidence.'));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Evidence-bounded specialist result.');
  });

  it('cancels provider work from the managed request signal without callback ceremony', async () => {
    const lifecycleEvents: string[] = [];
    const controller = new AbortController();
    const handler = createApplicationAIAgentRequestHandler({
      name: 'researcher',
      logicalModel: 'fast',
      instructions: 'Return a delayed response.',
      provider: {
        kind: 'deterministic',
        response: 'too late',
        latencyMs: 5_000,
      },
      tools: [toolContract()],
      persistence: persistence(),
      tanstackPersistence: memoryPersistence,
      timeoutMs: 10_000,
      maximumConcurrency: 1,
      admit: () => admission(),
      reserveAttempt: ({ runId }) => ({
        action: 'dispatch',
        runId,
        invocationId: 'invocation-cancelled',
        attemptId: 'attempt-cancelled',
        ordinal: 1,
        version: 1,
      }),
      recovery: unavailableRecovery(),
      attemptLifecycle: attemptLifecycle(lifecycleEvents),
      invoke: async () => ({}),
      // The callback intentionally does not create or pass an AbortController.
      handler: async (request, context) => chat({
        adapter: context.tanstack.adapter,
        messages: request.messages,
        threadId: request.threadId,
        runId: context.runId,
        tools: context.tanstack.tools,
        context: context.tanstack.execution,
      }),
    });
    const request = new Request('http://agent.test/__applik8s/v1/ai/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        threadId: 'conversation-cancelled',
        runId: 'protocol-run-cancelled',
        messages: [{ role: 'user', content: 'cancel this run' }],
      }),
      signal: controller.signal,
    });

    const response = await handler(request);
    const started = Date.now();
    const body = response.text();
    setTimeout(() => controller.abort(new Error('caller disconnected')), 25);
    expect(await body).toBe('');
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(lifecycleEvents).toEqual(expect.arrayContaining([
      expect.stringMatching(/^fail:cancelled:/),
    ]));
  });

  it('grounds the deterministic Starter document fixture in the latest request', async () => {
    const inputs: unknown[] = [];
    const handler = createApplicationAIAgentRequestHandler({
      name: 'writer',
      logicalModel: 'fast',
      instructions: 'Create the requested document.',
      provider: {
        kind: 'deterministic',
        tool: {
          input: { title: 'Fallback', body: 'Fallback', summary: 'Fallback', tags: [] },
          inputFromLatestUser: 'document',
        },
      },
      tools: [documentToolContract()],
      persistence: persistence(),
      tanstackPersistence: memoryPersistence,
      timeoutMs: 5_000,
      maximumConcurrency: 1,
      admit: () => admission(),
      reserveAttempt: ({ runId }) => ({
        action: 'dispatch', runId, invocationId: 'request-fixture', attemptId: 'attempt-fixture', ordinal: 1, version: 1,
      }),
      recovery: unavailableRecovery(),
      attemptLifecycle: attemptLifecycle([]),
      invoke: async (_operation, input) => {
        inputs.push(input);
        return { id: 'document-1' };
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
    const response = await handler(agentRequest(
      'Create a short live-review checklist document with exactly three checklist items.',
    ));
    expect(response.status).toBe(200);
    await response.text();
    expect(inputs).toHaveLength(1);
    const body = String(Reflect.get(inputs[0] as object, 'body'));
    expect(inputs[0]).toMatchObject({
      title: 'Short live-review checklist document',
      body: expect.stringContaining('## Objective'),
    });
    expect(body.length).toBeGreaterThan(900);
    expect(body).toContain('Create a short live-review checklist document with exactly three checklist items.');
    expect(body).toContain('## Risks and rollback');
    expect(body.match(/- \[ \]/gu)).toHaveLength(3);
  });

  it('persists a terminal failure when provider setup fails after the run begins', async () => {
    const lifecycleEvents: string[] = [];
    const persistenceEvents: string[] = [];
    const handler = createApplicationAIAgentRequestHandler({
      name: 'researcher',
      logicalModel: 'fast',
      instructions: async () => {
        throw new Error('provider credential rejected');
      },
      provider: { kind: 'deterministic', response: 'unused' },
      tools: [],
      persistence: {
        async begin(input) {
          persistenceEvents.push(`begin:${input.protocolRunId}`);
          return {
            conversationId: input.conversationId,
            protocolRunId: input.protocolRunId,
            principalScope: 'principal:test',
            async append() {},
            async complete() {
              persistenceEvents.push('complete');
            },
            async terminate(input) {
              persistenceEvents.push(`terminate:${input.status}:${input.reason}`);
            },
          };
        },
      },
      tanstackPersistence: memoryPersistence,
      timeoutMs: 5_000,
      maximumConcurrency: 1,
      admit: () => admission(),
      reserveAttempt: ({ runId }) => ({
        action: 'dispatch',
        runId,
        invocationId: 'invocation-provider-failure',
        attemptId: 'attempt-provider-failure',
        ordinal: 1,
        version: 1,
      }),
      recovery: unavailableRecovery(),
      attemptLifecycle: attemptLifecycle(lifecycleEvents),
      invoke: async () => ({}),
      handler: async () => ({ unused: true }),
    });

    const response = await handler(agentRequest());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'agent_request_failed',
      message: 'provider credential rejected',
    });
    expect(persistenceEvents).toEqual([
      'begin:protocol-run-1',
      'terminate:failed:provider credential rejected',
    ]);
    expect(lifecycleEvents).toEqual([
      'dispatching:1',
      'fail:provider-failed:2',
    ]);
  });

  it('commits a terminal empty assistant turn after a successful tool turn', async () => {
    const lifecycleEvents: string[] = [];
    const handler = createApplicationAIAgentRequestHandler({
      name: 'researcher',
      logicalModel: 'fast',
      instructions: 'Use the declared operation.',
      provider: { kind: 'deterministic' },
      tools: [],
      persistence: persistence(),
      tanstackPersistence: memoryPersistence,
      timeoutMs: 5_000,
      maximumConcurrency: 1,
      admit: () => admission(),
      reserveAttempt: ({ runId }) => ({
        action: 'dispatch',
        runId,
        invocationId: 'invocation-empty-terminal',
        attemptId: 'attempt-empty-terminal',
        ordinal: 1,
        version: 1,
      }),
      recovery: unavailableRecovery(),
      attemptLifecycle: attemptLifecycle(lifecycleEvents),
      invoke: async () => ({}),
      handler: async () => (async function* () {
        const run = {
          runId: 'protocol-run-1',
          threadId: 'conversation-1',
        };
        yield { type: 'RUN_STARTED', ...run, timestamp: 0 };
        yield {
          type: 'TEXT_MESSAGE_START',
          messageId: 'message-tool-turn',
          role: 'assistant',
          timestamp: 1,
        };
        yield {
          type: 'TEXT_MESSAGE_CONTENT',
          messageId: 'message-tool-turn',
          delta: 'I will use the tool.',
          timestamp: 2,
        };
        yield {
          type: 'TEXT_MESSAGE_END',
          messageId: 'message-tool-turn',
          timestamp: 3,
        };
        yield {
          type: 'RUN_FINISHED',
          ...run,
          finishReason: 'tool_calls',
          timestamp: 4,
        };
        yield { type: 'RUN_STARTED', ...run, timestamp: 5 };
        yield {
          type: 'RUN_FINISHED',
          ...run,
          finishReason: 'stop',
          timestamp: 6,
        };
      })(),
    });

    const response = await handler(agentRequest());
    expect(response.status).toBe(200);
    await response.text();

    expect(lifecycleEvents.at(-2)).toMatch(/^complete:/);
    expect(lifecycleEvents.at(-1)).toBe('commit:message-');
    expect(lifecycleEvents.some((event) => event.startsWith('fail:'))).toBe(false);
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
      persistence: persistence(),
      tanstackPersistence: memoryPersistence,
      timeoutMs: 5_000,
      maximumConcurrency: 1,
      admit: () => admission(expired),
      reserveAttempt: async () => {
        throw new Error('must not reserve');
      },
      recovery: unavailableRecovery(),
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
      persistence: persistence(),
      tanstackPersistence: memoryPersistence,
      timeoutMs: 5_000,
      maximumConcurrency: 1,
      admit: () => admission(),
      reserveAttempt: ({ runId }) => ({
        action: 'dispatch',
        runId,
        invocationId: 'invocation-uncertain',
        attemptId: 'attempt-uncertain',
        ordinal: 1,
        version: 1,
      }),
      recovery: unavailableRecovery(),
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

  it('joins a durable in-flight attempt and replays its canonical TanStack stream', async () => {
    let handlerInvoked = false;
    let observations = 0;
    const telemetryBoundaries: unknown[] = [];
    const handler = createApplicationAIAgentRequestHandler({
      name: 'researcher',
      logicalModel: 'fast',
      instructions: 'Do work.',
      provider: { kind: 'deterministic' },
      tools: [],
      persistence: persistence(),
      tanstackPersistence: memoryPersistence,
      timeoutMs: 5_000,
      maximumConcurrency: 1,
      telemetry: {
        async run(boundary, execute) {
          telemetryBoundaries.push(boundary);
          return await execute();
        },
      },
      admit: () => admission(),
      reserveAttempt: ({ runId }) => ({
        action: 'join',
        runId,
        invocationId: 'invocation-join',
        attemptId: 'attempt-join',
        ordinal: 1,
        version: 3,
      }),
      recovery: {
        minimumPollMs: 10,
        maximumPollMs: 10,
        timeoutMs: 1_000,
        async observe() {
          observations += 1;
          return recoveryObservation(
            observations === 1 ? 'streaming' : 'canonical-committed',
          );
        },
      },
      attemptLifecycle: attemptLifecycle([]),
      invoke: async () => ({}),
      handler: async () => {
        handlerInvoked = true;
        return {};
      },
    });

    const response = await handler(agentRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const events = await response.text();
    expect(events).toContain('"type":"RUN_STARTED"');
    expect(events).toContain('"type":"RUN_FINISHED"');
    expect(observations).toBe(2);
    expect(handlerInvoked).toBe(false);
    expect(telemetryBoundaries).toEqual([]);
  });

  it('returns a stable escalation response for completion-uncertain attempts', async () => {
    const handler = createApplicationAIAgentRequestHandler({
      name: 'researcher',
      logicalModel: 'fast',
      instructions: 'Do work.',
      provider: { kind: 'deterministic' },
      tools: [],
      persistence: persistence(),
      tanstackPersistence: memoryPersistence,
      timeoutMs: 5_000,
      maximumConcurrency: 1,
      admit: () => admission(),
      reserveAttempt: ({ runId }) => ({
        action: 'escalate',
        runId,
        invocationId: 'invocation-join',
        attemptId: 'attempt-join',
        ordinal: 1,
        version: 3,
      }),
      recovery: {
        async observe() {
          return recoveryObservation('completion-uncertain');
        },
      },
      attemptLifecycle: attemptLifecycle([]),
      invoke: async () => ({}),
      handler: async () => {
        throw new Error('must not dispatch');
      },
    });

    const response = await handler(agentRequest());

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: 'agent_completion_uncertain',
      invocationId: 'invocation-join',
      attemptId: 'attempt-join',
    });
  });

  it('holds bounded concurrency until a streaming response is finished', async () => {
    let finishStream: (() => void) | undefined;
    const streamGate = new Promise<void>((resolve) => {
      finishStream = resolve;
    });
    const handler = createApplicationAIAgentRequestHandler({
      name: 'researcher',
      logicalModel: 'fast',
      instructions: 'Do work.',
      provider: { kind: 'deterministic' },
      tools: [],
      persistence: persistence(),
      tanstackPersistence: memoryPersistence,
      timeoutMs: 5_000,
      maximumConcurrency: 1,
      admit: () => admission(),
      reserveAttempt: ({ runId }) => ({
        action: 'dispatch',
        runId,
        invocationId: 'invocation-capacity',
        attemptId: 'attempt-capacity',
        ordinal: 1,
        version: 1,
      }),
      recovery: unavailableRecovery(),
      attemptLifecycle: attemptLifecycle([]),
      invoke: async () => ({}),
      handler: async () => (async function* () {
        const event = {
          runId: 'protocol-run-1',
          threadId: 'conversation-1',
          timestamp: 0,
        };
        yield { type: 'RUN_STARTED', ...event };
        await streamGate;
        yield {
          type: 'TEXT_MESSAGE_START',
          messageId: 'message-capacity',
          role: 'assistant',
          timestamp: 1,
        };
        yield {
          type: 'TEXT_MESSAGE_CONTENT',
          messageId: 'message-capacity',
          delta: 'finished',
          timestamp: 2,
        };
        yield {
          type: 'TEXT_MESSAGE_END',
          messageId: 'message-capacity',
          timestamp: 3,
        };
        yield { type: 'RUN_FINISHED', ...event, timestamp: 4 };
      })(),
    });

    const streaming = await handler(agentRequest());
    const rejected = await handler(agentRequest());

    expect(streaming.status).toBe(200);
    expect(rejected.status).toBe(429);

    finishStream?.();
    await streaming.text();

    const admitted = await handler(agentRequest());
    expect(admitted.status).toBe(200);
    await admitted.text();
  });
});

function unavailableRecovery() {
  return {
    async observe(): Promise<never> {
      throw new Error('Attempt recovery must not run in this fixture.');
    },
  };
}

function recoveryObservation(
  state: 'streaming' | 'canonical-committed' | 'completion-uncertain',
) {
  const now = new Date().toISOString();
  const context = admission().context;
  return {
    invocation: {
      apiVersion: 'applik8s.aiInvocation/v1alpha1' as const,
      id: 'invocation-join',
      conversationId: 'conversation-1',
      protocolRunId: 'protocol-run-1',
      agentRunId: 'run-1',
      logicalModel: 'fast',
      requestHash: 'sha256:request',
      admittedPrincipal: principal(),
      admissionEvidence: {
        apiVersion: 'applik8s.aiAdmissionEvidence/v1' as const,
        admissionVersion: context.apiVersion,
        principalId: context.principal.id,
        authorityRevision: context.authorityRevision,
        trustedContextDigest: context.trustedContext.digest,
        operation: context.operation,
        correlationId: context.correlationId,
        ...(context.causationId ? { causationId: context.causationId } : {}),
        ...(context.deadline ? { deadline: context.deadline } : {}),
        ...(context.cancellation
          ? { cancellationRevision: context.cancellation.revision }
          : {}),
        ...(context.delivery ? { delivery: context.delivery } : {}),
      },
      authorityRevision: 'authority-1',
      state:
        state === 'canonical-committed'
          ? 'completed' as const
          : state === 'completion-uncertain'
            ? 'uncertain' as const
            : 'active' as const,
      currentAttemptId: 'attempt-join',
      ...(state === 'canonical-committed'
        ? { canonicalMessageId: 'message-join' }
        : {}),
      createdAt: now,
      updatedAt: now,
    },
    attempts: [{
      apiVersion: 'applik8s.aiAttempt/v1alpha1' as const,
      id: 'attempt-join',
      invocationId: 'invocation-join',
      ordinal: 1,
      state,
      recovery:
        state === 'completion-uncertain'
          ? 'uncertain' as const
          : state === 'canonical-committed'
            ? 'terminal' as const
            : 'joinable' as const,
      requestHash: 'sha256:request',
      redactedRequestMetadata: {},
      route: {
        policyRevision: 'routing-v1',
        logicalModel: 'fast',
        providerClass: 'deterministic',
        backend: 'deterministic',
        concreteModel: 'deterministic',
        capabilities: ['chat', 'streaming'] as const,
        route: 'deterministic/fast',
        fallbackChain: [],
      },
      streamFrontier: state === 'streaming' ? 1 : 2,
      ...(state === 'completion-uncertain'
        ? { terminalReason: 'provider outcome cannot be observed' }
        : {}),
      version: 3,
      createdAt: now,
      updatedAt: now,
    }],
    deltas: [
      {
        attemptId: 'attempt-join',
        sequence: 1,
        event: {
          type: 'RUN_STARTED',
          runId: 'protocol-run-1',
          threadId: 'conversation-1',
          timestamp: 0,
        },
        createdAt: now,
      },
      ...(state === 'streaming'
        ? []
        : [{
            attemptId: 'attempt-join',
            sequence: 2,
            event: {
              type: 'RUN_FINISHED',
              runId: 'protocol-run-1',
              threadId: 'conversation-1',
              timestamp: 1,
            },
            createdAt: now,
          }]),
    ],
  };
}

function attemptLifecycle(
  events: string[],
  providerTerminals: unknown[] = [],
): ApplicationAIAgentAttemptLifecycle {
  return {
    async dispatching(reservation) {
      events.push(`dispatching:${reservation.version}`);
      return { ...reservation, version: reservation.version + 1 };
    },
    async append(reservation, event) {
      events.push(`append:${String(event.type)}:${reservation.version}`);
      return { ...reservation, version: reservation.version + 1 };
    },
    async completeProvider(reservation, terminal) {
      events.push(`complete:${reservation.version}`);
      providerTerminals.push(terminal);
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

function persistence(): ApplicationAIAgentPersistence {
  return {
    async begin(input) {
      return {
        conversationId: input.conversationId,
        protocolRunId: input.protocolRunId,
        principalScope: 'principal:test',
        async append() {},
        async complete() {},
        async terminate() {},
      };
    },
  };
}

function agentRequest(text = 'hello'): Request {
  return new Request('http://agent.test/__applik8s/v1/ai/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      threadId: 'conversation-1',
      runId: 'protocol-run-1',
      messages: [{ role: 'user', content: text }],
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

function documentToolContract(): ApplicationAIAgentToolContract {
  const contract = toolContract();
  return {
    ...contract,
    operation: {
      ...contract.operation,
      input: {
        digest: 'sha256:document-input',
        schema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            body: { type: 'string' },
            summary: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
          },
          required: ['title', 'body', 'summary', 'tags'],
          additionalProperties: false,
        },
      },
    },
    workloadAuthority: {
      ...contract.workloadAuthority,
      inputSchemaDigest: 'sha256:document-input',
    },
  };
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

function admission(value = principal()) {
  const trustedContext = { tenant: 'tenant-1' };
  return {
    context: withApplicationAdmissionExecutionV1(
      createApplicationAdmissionContextV1({
        admission: { principal: value, trustedContext },
        operation: {
          id: 'applik8s://agent/researcher/execute',
          transport: 'framework',
        },
        correlationId: 'run-1',
      }),
      {
        causationId: 'invocation-1',
        deadline: value.deadline,
        cancellation: { revision: value.cancellationRevision },
        delivery: {
          id: 'agent-admission-1',
          source: 'applik8s://agent-gateway',
        },
      },
    ),
  };
}
