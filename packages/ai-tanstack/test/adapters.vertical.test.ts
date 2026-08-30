// typecast-file-boundary: adapter tests restore generic executor outputs and branded operation IDs after exercising their runtime validation boundaries.
import {
  createApplicationMutationOperation,
  createApplicationQueryOperation,
} from '@applik8s/client';
import type { ApplicationExecutionPrincipal, ApplicationOperationId } from '@applik8s/core';
import { type } from 'arktype';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { hydrateApplicationConversationMessage } from '../src/client.js';
import {
  type ApplicationTanStackToolExecutionContext,
  type ApplicationTanStackToolInvocation,
  type ApplicationTanStackToolOperation,
  applicationTanStackAICompatibility,
  applicationTanStackServerPersistenceCompatibility,
  applicationTanStackToolName,
  assertApplicationTanStackServerPersistenceAvailable,
  asTool,
  createApplicationAICompatibilityTuple,
  createApplicationTanStackConnection,
  selectApplicationTanStackTools,
} from '../src/index.js';

const Input = type({ query: 'string' });
const Output = type({ count: 'number' });
const operation = createApplicationMutationOperation(
  {
    apiVersion: 'applik8s.operation/v1alpha1',
    kind: 'applicationOperation',
    id: 'applik8s://Evidence/search@v1' as ApplicationOperationId,
    model: 'Evidence',
    name: 'search',
    operation: 'custom',
    transport: 'command',
    version: 'v1',
  },
  async ({ query }: typeof Input.infer) => ({ count: query.length }),
  { input: Input, output: Output },
);

describe('TanStack AI operation tools', () => {
  it('hydrates canonical conversation records into browser-native messages', () => {
    expect(
      hydrateApplicationConversationMessage({
        id: 'message-1',
        role: 'assistant',
        content: {
          id: 'message-1',
          role: 'assistant',
          parts: [{ type: 'text', content: 'Durable response.' }],
        },
        createdAt: '2026-08-05T12:00:00.000Z',
      }),
    ).toMatchObject({
      id: 'message-1',
      role: 'assistant',
      parts: [{ type: 'text', content: 'Durable response.' }],
    });
  });

  it('adapts the original ArkType schemas into a native server tool and invokes canonical authority', async () => {
    const tool = asTool(operation);
    expect(tool.__toolSide).toBe('server');
    expect(tool.inputSchema).toBe(Input);
    expect(tool.outputSchema).toBe(Output);
    expect(tool.metadata).toMatchObject({
      applik8s: {
        operationId: 'applik8s://Evidence/search@v1',
        approvalPresentationOnly: true,
      },
    });
    const invoke = vi.fn();
    const execution: ApplicationTanStackToolExecutionContext = {
      principal,
      invocationId: 'invocation-1',
      attemptId: 'attempt-1',
      async invoke<TInput, TOutput>(
        candidate: ApplicationTanStackToolOperation<TInput, TOutput>,
        input: TInput,
        invocation: ApplicationTanStackToolInvocation,
      ) {
        invoke(candidate, input, invocation);
        return Output.assert({
          count: Input.assert(input).query.length,
        }) as TOutput;
      },
    };
    await expect(tool.execute?.(
      { query: 'evidence' },
      {
        context: execution,
        toolCallId: 'provider-call-1',
        emitCustomEvent: vi.fn(),
      },
    )).resolves.toEqual({ count: 8 });
    expect(invoke).toHaveBeenCalledWith(operation, { query: 'evidence' }, {
      principal,
      invocationId: 'invocation-1',
      attemptId: 'attempt-1',
      providerToolCallId: 'provider-call-1',
    });
    expectTypeOf(tool).toHaveProperty('execute');
  });

  it('treats approval as presentation while retaining authority in the executor', () => {
    operation.authorize({ maximumUses: 1 });
    const tool = asTool(operation);
    expect(tool.needsApproval).toBe(true);
    expect(tool.metadata).toMatchObject({
      applik8s: { approvalPresentationOnly: true },
    });
  });

  it('fails closed for absent schemas, non-standard schemas, and absent provider call identity', async () => {
    const missing = createApplicationMutationOperation<
      { query: string },
      { count: number }
    >({ ...operation.operation, id: 'applik8s://Evidence/missing@v1' }, async () => ({ count: 0 }));
    expect(() => asTool(missing)).toThrow(/authored input\/output schemas are unavailable/);
    const invalid = createApplicationMutationOperation(
      { ...operation.operation, id: 'applik8s://Evidence/invalid@v1' },
      async () => ({ count: 0 }),
      { input: {}, output: {} },
    );
    expect(() => asTool(invalid)).toThrow(/must implement Standard Schema/);
    const tool = asTool(operation);
    await expect(tool.execute?.(
      { query: 'evidence' },
      {
        context: {
          principal,
          invocationId: 'invocation-1',
          attemptId: 'attempt-1',
          invoke: vi.fn(),
        },
        emitCustomEvent: vi.fn(),
      },
    )).rejects.toThrow(/provider tool-call ID/);
  });

  it('derives bounded collision-resistant provider names while preserving the operation ID in metadata', () => {
    const name = applicationTanStackToolName(
      'applik8s://Very Long Model Name/'.repeat(8),
    );
    expect(name).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(applicationTanStackToolName('applik8s://a-b/c')).not.toBe(
      applicationTanStackToolName('applik8s://a/b-c'),
    );
    expect(applicationTanStackToolName(
      'applik8s://models/Document/operations/create',
      'Create document',
    )).toMatch(/^applik8s_Create_document_[a-z0-9]{7}$/u);
  });

  it('retains product-facing presentation metadata without replacing canonical authority identity', () => {
    const tool = asTool(operation, {
      presentation: {
        label: 'Search evidence',
        runningLabel: 'Searching evidence…',
        completedLabel: 'Evidence searched',
      },
    });
    expect(tool.name).toMatch(/^applik8s_Search_evidence_[a-z0-9]{7}$/u);
    expect(tool.metadata).toMatchObject({
      applik8s: {
        operationId: operation.operation.id,
        presentation: {
          label: 'Search evidence',
          runningLabel: 'Searching evidence…',
          completedLabel: 'Evidence searched',
        },
      },
    });
  });

  it('selects hydrated tools through stable application-owned catalog keys', () => {
    const tool = asTool(operation);
    expect(selectApplicationTanStackTools(
      [tool],
      { 'Evidence.search': operation },
      ['Evidence.search'],
    )).toEqual([tool]);
    expect(() => selectApplicationTanStackTools(
      [tool],
      { 'Evidence.search': operation },
      ['Evidence.missing'],
    )).toThrow(/does not declare selected tool/);
    expect(() => selectApplicationTanStackTools(
      [],
      { 'Evidence.search': operation },
      ['Evidence.search'],
    )).toThrow(/did not hydrate selected application tools/);
  });

  it('infers canonical Owner.operation keys from hydrated operation metadata', () => {
    const canonicalOperation = createApplicationMutationOperation(
      {
        ...operation.operation,
        id: 'applik8s://models/Evidence/operations/search',
      },
      undefined,
      { input: Input, output: Output },
    );
    const tool = asTool(canonicalOperation);
    expect(selectApplicationTanStackTools(
      [tool],
      ['Evidence.search'],
    )).toEqual([tool]);
    expect(() => selectApplicationTanStackTools(
      [tool],
      ['Evidence.missing'],
    )).toThrow(/does not declare selected tool/);
  });

  it('fails closed when inferred operation keys collide across domains', () => {
    const modelOperation = createApplicationMutationOperation(
      {
        ...operation.operation,
        id: 'applik8s://models/Evidence/operations/search',
      },
      undefined,
      { input: Input, output: Output },
    );
    const modelTool = asTool(modelOperation);
    const query = createApplicationQueryOperation(
      {
        ...operation.operation,
        id: 'applik8s://queries/Evidence/operations/search',
        operation: 'query',
        transport: 'query',
      },
      undefined,
      { input: Input, output: Output },
    );
    const queryTool = asTool(query);
    expect(() => selectApplicationTanStackTools(
      [modelTool, queryTool],
      ['Evidence.search'],
    )).toThrow(/is ambiguous/);
  });
});

describe('TanStack AI connection and compatibility', () => {
  it('delegates AG-UI framing to the upstream SSE adapter and preserves thread/run identity', async () => {
    const request = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response('', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }));
    const fetchClient = Object.assign(request, { preconnect: vi.fn() });
    const connection = createApplicationTanStackConnection({
      endpoint: '/api/agent',
      fetchClient,
      agent: {
        kind: 'applicationAgent',
        name: 'access-advisor',
      },
    });
    for await (const _chunk of connection.connect(
      [],
      { request: 'value' },
      undefined,
      { threadId: 'conversation-1', runId: 'protocol-run-1' },
    )) {
      // Empty upstream evidence stream.
    }
    const body = JSON.parse(String(request.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      threadId: 'conversation-1',
      runId: 'protocol-run-1',
      forwardedProps: {
        applik8s: { agent: 'access-advisor' },
        request: 'value',
      },
    });
    expect(String(request.mock.calls[0]?.[0])).toContain('agent=access-advisor');
  });

  it('preserves upstream server-authoritative hydration on the admitted agent endpoint', async () => {
    const request = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      expect(url).toContain('agent=access-advisor');
      expect(url).toContain('threadId=conversation-1');
      return Response.json({ messages: [], activeRun: null, interrupts: null });
    });
    const connection = createApplicationTanStackConnection({
      endpoint: '/api/agent',
      fetchClient: Object.assign(request, { preconnect: vi.fn() }),
      agent: { kind: 'applicationAgent', name: 'access-advisor' },
    });
    await expect(connection.hydrate?.('conversation-1')).resolves.toEqual({
      messages: [],
      activeRun: null,
      interrupts: null,
    });
  });

  it('fails closed instead of accepting an untyped or empty agent selector', () => {
    expect(() => createApplicationTanStackConnection({
      // @ts-expect-error Agent selection is a typed application handle, not a string.
      agent: 'access-advisor',
    })).toThrow(/application\.agent/);
    expect(() => createApplicationTanStackConnection({
      agent: { kind: 'applicationAgent', name: ' ' },
    })).toThrow(/application\.agent/);
  });

  it('rejects synthesized identities and forwards cancellation to fetch', async () => {
    const request = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBe(signal);
      return new Response('', { status: 200 });
    });
    const fetchClient = Object.assign(request, { preconnect: vi.fn() });
    const connection = createApplicationTanStackConnection({ fetchClient });
    await expect(collect(connection.connect([], {}, undefined, undefined))).rejects.toThrow(
      /explicit Conversation-backed threadId/,
    );
    const controller = new AbortController();
    const signal = controller.signal;
    await collect(connection.connect(
      [],
      {},
      signal,
      { threadId: 'conversation-1', runId: 'protocol-run-1' },
    ));
  });

  it('pins released upstream contracts and exposes the supported server persistence seam', () => {
    expect(applicationTanStackAICompatibility).toEqual({
      tanstackAI: '0.45.1',
      tanstackAIClient: '0.23.3',
      tanstackAIReact: '0.19.3',
      tanstackAIPersistence: '0.1.5',
      agUi: '0.1.1-canary.beta.0',
      applik8sAdapter: 'applik8s.ai-tanstack/v1alpha1',
    });
    expect(applicationTanStackServerPersistenceCompatibility.status).toBe('supported');
    expect(() => assertApplicationTanStackServerPersistenceAvailable()).not.toThrow();
    expect(createApplicationAICompatibilityTuple({
      envoyGateway: 'v1.5.0',
      envoyAIGateway: 'v0.4.0',
      providerAdapters: { openai: 'v1.0.0' },
    })).toMatchObject({
      apiVersion: 'applik8s.aiCompatibility/v1alpha1',
      envoyGateway: 'v1.5.0',
      envoyAIGateway: 'v0.4.0',
    });
    expect(() => createApplicationAICompatibilityTuple({
      envoyGateway: 'latest',
      envoyAIGateway: 'v0.4.0',
    })).toThrow(/exact, non-latest version/);
  });
});

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const value of values) collected.push(value);
  return collected;
}

const principal: ApplicationExecutionPrincipal = {
  id: 'principal:agent-run-1',
  identity: {
    id: 'identity:agent-run-1',
    kind: 'execution',
    issuer: 'applik8s://test',
    subject: 'agent-run-1',
  },
  kind: 'execution',
  authenticationMethod: 'workload-jwt',
  audience: ['ai'],
  trustedContextDigest: 'sha256:context',
  catalogRevision: 'catalog-v1',
  authorityRevision: 'authority-v1',
  admittedAt: '2026-07-29T12:00:00.000Z',
  executionKind: 'agent',
  executionId: 'agent-run-1',
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
    issuer: 'applik8s://test',
    subject: 'source-researcher',
  },
  causalGrantIds: [],
  deadline: '2026-07-29T12:05:00.000Z',
  cancellationRevision: 'cancel-v1',
  bindings: [],
  effectiveAuthority: [],
};
