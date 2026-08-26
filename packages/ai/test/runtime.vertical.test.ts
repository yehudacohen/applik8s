// typecast-file-boundary: adversarial AI runtime fixtures intentionally construct erased protocol values to exercise validation and recovery boundaries.
import {
  AI,
  AIBackend,
  ApplicationAIProtocolConflictError,
  ApplicationAIStateConflictError,
  createApplicationAIAttemptRuntime,
  createMemoryApplicationAIAttemptStore,
  defineApplicationAIAgent,
} from '@applik8s/ai';
import {
  type ApplicationExecutionPrincipal,
  type ApplicationOperationId,
  createApplicationAdmissionContextV1,
  createApplicationTelemetryEnvelopeV1,
  withApplicationAdmissionExecutionV1,
} from '@applik8s/core';
import { describe, expect, it } from 'vitest';

const principal = agentPrincipal('agent-run-1');
const route = {
  policyRevision: 'routing-v1',
  logicalModel: 'fast',
  providerClass: 'openai',
  backend: 'primary',
  concreteModel: 'gpt-test',
  capabilities: ['chat', 'tools', 'streaming'] as const,
  route: 'fast',
  fallbackChain: ['primary', 'secondary'],
};

describe('provider-neutral AI contracts', () => {
  it('declares capability-oriented models and qualified providers without vendor names', () => {
    const Dedicated = AI.named('restricted');
    const model = AI.model('reasoning', {
      inference: Dedicated,
      capabilities: [AI.chat, AI.tools, AI.streaming, AI.reasoning],
      constraints: {
        dataResidency: ['us'],
        maximumInputCostPerMillion: 5,
      },
    });
    expect(model).toMatchObject({
      name: 'reasoning',
      inference: { qualification: { key: 'AI@v1alpha1:restricted' } },
      constraints: { dataResidency: ['us'] },
    });
    expect(model.capabilities.map((candidate) => candidate.name)).toEqual([
      'chat',
      'tools',
      'streaming',
      'reasoning',
    ]);
  });

  it('keeps deterministic providers visibly non-production and validates pinned Envoy routes', () => {
    expect(AI.deterministic()).toMatchObject({
      kind: 'ai-deterministic',
      production: false,
    });
    expect(() =>
      AI.envoy({
        versions: {
          envoyGateway: 'latest',
          aiGateway: 'v0.0.0',
          gatewayApi: 'v1.4.0',
        },
        models: {
          fast: {
            fallback: 'ordered',
            backends: [
              AIBackend.openAI('primary', { model: 'gpt-test' }),
            ],
          },
        },
      }),
    ).toThrow(/explicit pinned revision/);
  });

  it('validates deterministic typed-tool fixtures at the provider boundary', () => {
    expect(
      AI.deterministic({
        fixture: {
          response: 'completed',
          tool: { index: 0, input: { text: 'bounded fixture' } },
        },
      }),
    ).toMatchObject({
      kind: 'ai-deterministic',
      production: false,
      fixture: {
        response: 'completed',
        tool: { index: 0, input: { text: 'bounded fixture' } },
      },
    });
    expect(() =>
      AI.deterministic({
        fixture: {
          tool: { index: -1, input: {} },
        },
      }),
    ).toThrow(/non-negative integer/);
  });

  it('requires executable agents and preserves service identity separately', () => {
    const serviceIdentity = principal.serviceIdentity;
    if (!serviceIdentity) throw new Error('Agent test principal requires a service identity.');
    const identity = {
      kind: 'applicationServiceIdentity' as const,
      name: 'researcher',
      identity: serviceIdentity,
    };
    const model = AI.model('fast', {
      capabilities: [AI.chat, AI.tools],
    });
    const agent = defineApplicationAIAgent(
      'researcher',
      {
        identity,
        model,
        instructions: 'Use only cited evidence.',
        tools: [{ operation: 'search' }],
      },
      async (request, context) => ({
        threadId: request.threadId,
        runId: context.runId,
      }),
    );
    expect(agent.handler).toBeTypeOf('function');
    expect(agent.options.identity.identity.kind).toBe('service');
  });
});

describe('durable AI attempts', () => {
  it('persists the first producer telemetry carrier with the logical invocation', async () => {
    const runtime = deterministicRuntime();
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
    const replacement = createApplicationTelemetryEnvelopeV1({
      traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      identity: {
        application: 'research',
        environment: 'test',
        target: 'local',
        operation: 'http:agent',
        execution: 'gateway-request-2',
        attempt: 1,
      },
    });

    const first = await runtime.reserveInvocation({
      ...invocation(),
      telemetry: producer,
    });
    const joined = await runtime.reserveInvocation({
      ...invocation(),
      telemetry: replacement,
    });
    const attempt = await runtime.reserveAttempt({
      invocationId: first.id,
      redactedRequestMetadata: {},
      route,
    });

    expect(first.telemetry).toEqual(producer);
    expect(joined.telemetry).toEqual(producer);
    await expect(runtime.observe(first.id)).resolves.toMatchObject({
      invocation: { telemetry: producer },
      attempts: [{ id: attempt.attempt.id, ordinal: 1 }],
    });
  });

  it('reserves one logical invocation and joins one physical attempt after worker replacement', async () => {
    const runtime = deterministicRuntime();
    const reservation = invocation();
    const [left, right] = await Promise.all([
      runtime.reserveInvocation(reservation),
      runtime.reserveInvocation(reservation),
    ]);
    expect(left).toEqual(right);
    expect(left.admissionEvidence).toMatchObject({
      apiVersion: 'applik8s.aiAdmissionEvidence/v1',
      admissionVersion: 'applik8s.admission/v1',
      principalId: principal.id,
      authorityRevision: principal.authorityRevision,
      trustedContextDigest: principal.trustedContextDigest,
      operation: {
        id: 'applik8s://agent/test/execute',
        transport: 'framework',
      },
      correlationId: 'protocol-run-1',
      causationId: 'invocation-1',
    });
    expect(JSON.stringify(left.admissionEvidence)).not.toContain('tenant-1');

    const decisions = await Promise.all([
      runtime.reserveAttempt({
        invocationId: reservation.invocationId,
        redactedRequestMetadata: { messageCount: 1 },
        route,
      }),
      runtime.reserveAttempt({
        invocationId: reservation.invocationId,
        redactedRequestMetadata: { messageCount: 1 },
        route,
      }),
    ]);
    expect(decisions.map((decision) => decision.action).sort()).toEqual([
      'dispatch',
      'join',
    ]);
    expect(new Set(decisions.map((decision) => decision.attempt.id))).toHaveLength(1);
  });

  it('accepts a freshly admitted delivery for the same logical run without changing first-issuance evidence', async () => {
    const runtime = deterministicRuntime();
    const first = await runtime.reserveInvocation(invocation());
    const refreshedPrincipal: ApplicationExecutionPrincipal = {
      ...principal,
      admittedAt: '2026-07-29T12:01:00.000Z',
      deadline: '2026-07-29T12:06:00.000Z',
    };
    const refreshed = await runtime.reserveInvocation({
      ...invocation(),
      admittedPrincipal: refreshedPrincipal,
      admission: agentAdmission(refreshedPrincipal),
    });

    expect(refreshed).toEqual(first);
    expect(refreshed.admissionEvidence.deadline).toBe(
      '2026-07-29T12:05:00.000Z',
    );

    await expect(runtime.reserveInvocation({
      ...invocation(),
      admittedPrincipal: {
        ...refreshedPrincipal,
        authorityRevision: 'authority-v2',
      },
      admission: agentAdmission({
        ...refreshedPrincipal,
        authorityRevision: 'authority-v2',
      }),
    })).rejects.toThrow(/another request or execution identity/);
  });

  it('does not infer retry safety from uncertain completion', async () => {
    const runtime = deterministicRuntime();
    await runtime.reserveInvocation(invocation());
    const reserved = await runtime.reserveAttempt({
      invocationId: 'invocation-1',
      redactedRequestMetadata: {},
      route,
    });
    const dispatching = await runtime.transition(
      'invocation-1',
      reserved.attempt.id,
      reserved.attempt.version,
      {
        state: 'dispatching',
        recovery: 'joinable',
      },
    );
    await runtime.transition(
      'invocation-1',
      dispatching.id,
      dispatching.version,
      {
        state: 'completion-uncertain',
        recovery: 'uncertain',
        terminalReason: 'connection lost after dispatch',
      },
    );
    await expect(runtime.reserveAttempt({
      invocationId: 'invocation-1',
      redactedRequestMetadata: {},
      route,
      retry: 'if-replay-safe',
    })).resolves.toMatchObject({ action: 'escalate' });
  });

  it('keeps partial streams non-canonical and rejects output after cancellation', async () => {
    const runtime = deterministicRuntime();
    await runtime.reserveInvocation(invocation());
    const reserved = await runtime.reserveAttempt({
      invocationId: 'invocation-1',
      redactedRequestMetadata: {},
      route,
    });
    const dispatching = await runtime.transition(
      'invocation-1',
      reserved.attempt.id,
      reserved.attempt.version,
      {
        state: 'dispatching',
        recovery: 'joinable',
      },
    );
    await runtime.appendDelta('invocation-1', dispatching.id, {
      type: 'text-delta',
      text: 'partial',
    });
    const observed = await runtime.observe('invocation-1');
    expect(observed.invocation.canonicalMessageId).toBeUndefined();
    await runtime.cancel('invocation-1', 'user cancelled');
    await expect(runtime.appendDelta('invocation-1', dispatching.id, {
      type: 'text-delta',
      text: 'late',
    })).rejects.toBeInstanceOf(ApplicationAIStateConflictError);
  });

  it('commits a canonical result only after authoritative provider completion', async () => {
    const runtime = deterministicRuntime();
    await runtime.reserveInvocation(invocation());
    const reserved = await runtime.reserveAttempt({
      invocationId: 'invocation-1',
      redactedRequestMetadata: {},
      route,
    });
    await expect(
      runtime.commitCanonicalResult('invocation-1', reserved.attempt.id, 'message-1'),
    ).rejects.toBeInstanceOf(ApplicationAIStateConflictError);
    const dispatching = await runtime.transition(
      'invocation-1',
      reserved.attempt.id,
      reserved.attempt.version,
      {
        state: 'dispatching',
        recovery: 'joinable',
      },
    );
    const completed = await runtime.transition(
      'invocation-1',
      dispatching.id,
      dispatching.version,
      {
        state: 'provider-completed',
        recovery: 'terminal',
        providerRequestId: 'provider-1',
      },
    );
    await runtime.commitCanonicalResult(
      'invocation-1',
      completed.id,
      'message-1',
    );
    await expect(runtime.observe('invocation-1')).resolves.toMatchObject({
      invocation: {
        state: 'completed',
        canonicalMessageId: 'message-1',
      },
      attempts: [{ state: 'canonical-committed' }],
    });
  });

  it('scopes tool-call replay to one physical attempt and rejects conflicting reuse', async () => {
    const runtime = deterministicRuntime();
    await runtime.reserveInvocation(invocation());
    const reserved = await runtime.reserveAttempt({
      invocationId: 'invocation-1',
      redactedRequestMetadata: {},
      route,
    });
    const input = {
      invocationId: 'invocation-1',
      attemptId: reserved.attempt.id,
      providerToolCallId: 'call-1',
      operationId: 'applik8s://example/search@v1' as ApplicationOperationId,
      operationVersion: 'v1',
      arguments: { query: 'evidence' },
    };
    const first = await runtime.reserveToolProposal(input);
    const replay = await runtime.reserveToolProposal(input);
    expect(replay).toEqual(first);
    expect(first.id).toMatch(/^proposal_[a-f0-9]{64}$/u);
    expect(first.id).not.toContain('\u0000');
    await expect(runtime.reserveToolProposal({
      ...input,
      arguments: { query: 'different' },
    })).rejects.toBeInstanceOf(ApplicationAIProtocolConflictError);
  });

  it('permits a new physical attempt only after an explicitly replay-safe failure', async () => {
    const runtime = deterministicRuntime();
    await runtime.reserveInvocation(invocation());
    const reserved = await runtime.reserveAttempt({
      invocationId: 'invocation-1',
      redactedRequestMetadata: {},
      route,
    });
    const dispatching = await runtime.transition(
      'invocation-1',
      reserved.attempt.id,
      reserved.attempt.version,
      {
        state: 'dispatching',
        recovery: 'joinable',
      },
    );
    await runtime.transition(
      'invocation-1',
      dispatching.id,
      dispatching.version,
      {
        state: 'provider-failed',
        recovery: 'replay-safe',
        terminalReason: 'provider rejected before inference',
      },
    );
    const retried = await runtime.reserveAttempt({
      invocationId: 'invocation-1',
      redactedRequestMetadata: {},
      route,
      retry: 'if-replay-safe',
    });
    expect(retried).toMatchObject({
      action: 'dispatch',
      attempt: { ordinal: 2 },
    });
    expect(retried.attempt.id).not.toBe(reserved.attempt.id);
  });
});

function deterministicRuntime() {
  let sequence = 0;
  return createApplicationAIAttemptRuntime({
    store: createMemoryApplicationAIAttemptStore(),
    clock: { now: () => new Date('2026-07-29T12:00:00.000Z') },
    ids: {
      next(prefix) {
        sequence += 1;
        return `${prefix}-${sequence}`;
      },
    },
  });
}

function invocation() {
  return {
    invocationId: 'invocation-1',
    conversationId: 'conversation-1',
    protocolRunId: 'protocol-run-1',
    agentRunId: 'agent-run-1',
    logicalModel: 'fast',
    request: { messages: [{ role: 'user', content: 'hello' }] },
    admittedPrincipal: principal,
    admission: agentAdmission(principal),
  };
}

function agentAdmission(value: ApplicationExecutionPrincipal) {
  return withApplicationAdmissionExecutionV1(
    createApplicationAdmissionContextV1({
      admission: { principal: value, trustedContext: { tenant: 'tenant-1' } },
      operation: { id: 'applik8s://agent/test/execute', transport: 'framework' },
      correlationId: 'protocol-run-1',
    }),
    {
      causationId: 'invocation-1',
      deadline: value.deadline,
      cancellation: { revision: value.cancellationRevision },
      delivery: { id: 'agent-admission-1', source: 'applik8s://agent-gateway' },
    },
  );
}

function agentPrincipal(executionId: string): ApplicationExecutionPrincipal {
  return {
    id: `principal:${executionId}`,
    identity: {
      id: `identity:${executionId}`,
      kind: 'execution',
      issuer: 'applik8s://test',
      subject: executionId,
    },
    kind: 'execution',
    authenticationMethod: 'workload-jwt',
    audience: ['ai'],
    trustedContextDigest: 'sha256:context',
    catalogRevision: 'catalog-v1',
    authorityRevision: 'authority-v1',
    admittedAt: '2026-07-29T12:00:00.000Z',
    executionKind: 'agent',
    executionId,
    attempt: 1,
    workloadIdentity: {
      id: 'identity:workload',
      kind: 'workload',
      issuer: 'kubernetes://test',
      subject: 'agent-server',
    },
    serviceIdentity: {
      id: 'identity:service',
      kind: 'service',
      issuer: 'applik88s://test',
      subject: 'researcher',
    },
    causalGrantIds: [],
    deadline: '2026-07-29T12:05:00.000Z',
    cancellationRevision: 'cancel-v1',
    bindings: [],
    effectiveAuthority: [],
  };
}
