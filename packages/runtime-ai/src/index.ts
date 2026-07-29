// typecast-file-boundary: compiler-normalized catalog descriptors and admitted
// execution principals are validated before erased AI/tool generics are
// restored at this runtime boundary.

import type { ApplicationAIAgentHandler } from '@applik8s/ai';
import type {
  ApplicationTanStackAgentRuntime,
  ApplicationTanStackAIAgentRequest,
  ApplicationTanStackToolExecutionContext,
  ApplicationTanStackToolInvocation,
  ApplicationTanStackToolOperation,
} from '@applik8s/ai-tanstack';
import {
  applicationTanStackStandardSchema,
  asTool,
} from '@applik8s/ai-tanstack';
import {
  type ApplicationOperationAuthorizationContract,
  type ApplicationOperationContract,
  createApplicationMutationOperation,
  createApplicationQueryOperation,
  createApplicationRuntimeOperation,
} from '@applik8s/client';
import type {
  ApplicationExecutionPrincipal,
  ApplicationOperationDescriptor,
  ApplicationWorkloadAuthorityEnvelope,
} from '@applik8s/core';
import {
  type AnyTextAdapter,
  EventType,
  type StreamChunk,
  toServerSentEventsResponse,
} from '@tanstack/ai';
import { openaiCompatibleText } from '@tanstack/ai-openai/compatible';

export interface ApplicationAIAgentToolContract {
  readonly operation: ApplicationOperationDescriptor;
  readonly transport: 'command' | 'query' | 'runtime';
  readonly workloadAuthority: ApplicationWorkloadAuthorityEnvelope;
}

export type ApplicationAITextProvider =
  | {
      readonly kind: 'deterministic';
      readonly response?: string;
      readonly latencyMs?: number;
    }
  | {
      readonly kind: 'openai-compatible';
      readonly name: string;
      readonly baseUrl: string;
      readonly apiKey: string;
      readonly model: string;
      readonly api?: 'chat-completions' | 'responses';
      readonly timeoutMs?: number;
      readonly maximumRetries?: number;
    };

export interface ApplicationAIAgentAttemptReservation {
  readonly invocationId: string;
  readonly attemptId: string;
  readonly runId: string;
}

export interface ApplicationAIAgentRequestBody
  extends ApplicationTanStackAIAgentRequest {
  readonly runId: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface ApplicationAIAgentRuntimeOptions<
  TResult = unknown,
  TRequest extends ApplicationTanStackAIAgentRequest = ApplicationTanStackAIAgentRequest,
> {
  readonly name: string;
  readonly logicalModel: string;
  readonly instructions:
    | string
    | ((context: Readonly<Record<string, unknown>>) => string | Promise<string>);
  readonly handler: ApplicationAIAgentHandler<
    TRequest,
    TResult,
    ApplicationTanStackAgentRuntime
  >;
  readonly provider: ApplicationAITextProvider;
  readonly tools: readonly ApplicationAIAgentToolContract[];
  readonly persistence: unknown;
  readonly timeoutMs: number;
  readonly maximumConcurrency: number;
  readonly maximumRequestBytes?: number;
  readonly admit: (
    request: Request,
    body: ApplicationAIAgentRequestBody,
  ) => Promise<ApplicationExecutionPrincipal> | ApplicationExecutionPrincipal;
  readonly reserveAttempt: (
    input: {
      readonly principal: ApplicationExecutionPrincipal;
      readonly threadId: string;
      readonly runId: string;
      readonly logicalModel: string;
      readonly request: ApplicationAIAgentRequestBody;
    },
  ) =>
    | Promise<ApplicationAIAgentAttemptReservation>
    | ApplicationAIAgentAttemptReservation;
  readonly invoke: (
    operation: ApplicationOperationDescriptor,
    input: unknown,
    invocation: ApplicationTanStackToolInvocation,
  ) => Promise<unknown>;
}

/**
 * Creates one bounded, request-local agent execution boundary. The caller owns
 * HTTP placement and principal admission; this runtime owns native TanStack
 * adaptation, attempt identity, operation-tool authority, timeout, and
 * streaming response semantics.
 */
export function createApplicationAIAgentRequestHandler<TResult>(
  options: ApplicationAIAgentRuntimeOptions<TResult>,
): (request: Request) => Promise<Response> {
  const maximumRequestBytes = options.maximumRequestBytes ?? 1024 * 1024;
  const baseAdapter = applicationAITextAdapter(options.provider);
  const operationTools = options.tools.map(applicationAgentTool);
  let active = 0;

  return async (request) => {
    const url = new URL(request.url);
    if (request.method === 'GET' && (url.pathname === '/healthz' || url.pathname === '/readyz')) {
      return Response.json({ ready: true, agent: options.name });
    }
    if (request.method !== 'POST' || url.pathname !== '/__applik8s/v1/ai/chat') {
      return Response.json({ error: 'not_found' }, { status: 404 });
    }
    if (active >= options.maximumConcurrency) {
      return Response.json(
        { error: 'agent_capacity_exhausted' },
        { status: 429, headers: { 'retry-after': '1' } },
      );
    }
    active += 1;
    try {
      const body = await boundedJson(request, maximumRequestBytes);
      assertAgentRequest(body);
      const principal = await options.admit(request, body);
      assertAgentPrincipal(principal, options.name);
      const reservation = await options.reserveAttempt({
        principal,
        threadId: body.threadId,
        runId: body.runId,
        logicalModel: options.logicalModel,
        request: body,
      });
      if (reservation.runId !== body.runId) {
        throw new Error(`Agent ${options.name} attempt reservation changed protocol run identity.`);
      }
      const instructions = typeof options.instructions === 'string'
        ? options.instructions
        : await options.instructions(body.data ?? {});
      if (!instructions.trim()) {
        throw new Error(`Agent ${options.name} resolved empty instructions.`);
      }
      const controller = new AbortController();
      const abort = () => controller.abort(request.signal.reason);
      request.signal.addEventListener('abort', abort, { once: true });
      const timeout = setTimeout(
        () => controller.abort(new Error(`Agent ${options.name} exceeded ${options.timeoutMs}ms.`)),
        options.timeoutMs,
      );
      const execution: ApplicationTanStackToolExecutionContext = {
        principal,
        invocationId: reservation.invocationId,
        attemptId: reservation.attemptId,
        async invoke<TInput, TOutput>(
          operation: ApplicationTanStackToolOperation<TInput, TOutput>,
          input: TInput,
          invocation: ApplicationTanStackToolInvocation,
        ): Promise<TOutput> {
          const tool = requiredTool(options.tools, operation.operation.id);
          if (tool.workloadAuthority.operationId !== tool.operation.id) {
            throw new Error(`Agent ${options.name} tool authority does not match ${tool.operation.id}.`);
          }
          return await options.invoke(tool.operation, input, invocation) as TOutput;
        },
      };
      const runtime: ApplicationTanStackAgentRuntime = {
        adapter: withApplicationInstructions(baseAdapter, instructions),
        tools: operationTools,
        persistence: options.persistence,
        execution,
      };
      try {
        const result = await options.handler(
          {
            threadId: body.threadId,
            messages: body.messages,
            ...(body.resume !== undefined ? { resume: body.resume } : {}),
          },
          {
            runId: reservation.runId,
            invocationId: reservation.invocationId,
            principal,
            signal: controller.signal,
            tanstack: runtime,
          },
        );
        if (result instanceof Response) return result;
        if (isAsyncIterable(result)) {
          return toServerSentEventsResponse(result as AsyncIterable<StreamChunk>, {
            abortController: controller,
          });
        }
        return Response.json({ result });
      } finally {
        clearTimeout(timeout);
        request.signal.removeEventListener('abort', abort);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return Response.json({ error: 'agent_request_failed', message }, { status: 400 });
    } finally {
      active -= 1;
    }
  };
}

export function applicationAITextAdapter(
  provider: ApplicationAITextProvider,
): AnyTextAdapter {
  if (provider.kind === 'deterministic') {
    return deterministicTextAdapter(provider);
  }
  const endpoint = new URL(provider.baseUrl);
  if (endpoint.protocol !== 'https:' && endpoint.hostname !== 'localhost'
    && endpoint.hostname !== '127.0.0.1') {
    throw new Error('OpenAI-compatible AI provider endpoints must use HTTPS outside loopback.');
  }
  return openaiCompatibleText(provider.model, {
    name: provider.name,
    baseURL: endpoint.toString().replace(/\/$/u, ''),
    apiKey: provider.apiKey,
    api: provider.api ?? 'chat-completions',
    ...(provider.timeoutMs !== undefined ? { timeout: provider.timeoutMs } : {}),
    ...(provider.maximumRetries !== undefined ? { maxRetries: provider.maximumRetries } : {}),
  });
}

function applicationAgentTool(
  contract: ApplicationAIAgentToolContract,
): ReturnType<typeof asTool> {
  const operationContract = clientOperationContract(
    contract.operation,
    contract.transport,
  );
  const schemas = {
    input: applicationTanStackStandardSchema(
      contract.operation.input.schema,
      `${contract.operation.id}:input`,
    ),
    output: applicationTanStackStandardSchema(
      contract.operation.output.schema,
      `${contract.operation.id}:output`,
    ),
  };
  const invoke = async (): Promise<never> => {
    throw new Error(
      `Application operation ${contract.operation.id} must execute through the request-local TanStack tool context.`,
    );
  };
  const operation = operationContract.transport === 'query'
    ? createApplicationQueryOperation(operationContract, {
        snapshot: async () => ({
          kind: 'snapshot',
          protocol: 'applik8s.query/v1alpha1',
          query: operationContract.id,
          value: await invoke(),
          cursor: '',
          inputKey: '',
          generatedAt: new Date(0).toISOString(),
          capability: 'resetOnly',
        }),
      }, schemas)
    : operationContract.transport === 'runtime'
      ? createApplicationRuntimeOperation(operationContract, invoke, schemas)
      : createApplicationMutationOperation(operationContract, invoke, schemas);
  return asTool(operation, {
    needsApproval: contract.operation.authority.grantable,
  });
}

function clientOperationContract(
  descriptor: ApplicationOperationDescriptor,
  transport: ApplicationAIAgentToolContract['transport'],
): ApplicationOperationContract {
  const operation = descriptor.kind === 'model.create'
    ? 'create'
    : descriptor.kind === 'model.read'
      ? 'get'
      : descriptor.kind === 'model.query' || descriptor.kind === 'query'
        ? 'query'
        : descriptor.kind === 'model.update'
          ? 'update'
          : descriptor.kind === 'model.delete'
            ? 'delete'
            : 'custom';
  const authority: ApplicationOperationAuthorizationContract = {
    classification: descriptor.authority.classification,
    permissionIds: [],
    grantable: descriptor.authority.grantable,
    delegable: descriptor.authority.delegable,
    scope: descriptor.authority.defaultScope,
    ...(descriptor.authority.audiences
      ? { audiences: descriptor.authority.audiences }
      : {}),
    transports: descriptor.transports.map((binding) => binding.transport),
  };
  return {
    apiVersion: 'applik8s.operation/v1alpha1',
    kind: 'applicationOperation',
    id: descriptor.id,
    model: descriptor.target?.model ?? descriptor.name,
    name: descriptor.name,
    operation,
    transport,
    version: descriptor.version,
    authority,
  };
}

function withApplicationInstructions(
  adapter: AnyTextAdapter,
  instructions: string,
): AnyTextAdapter {
  const structuredOutputStream = adapter.structuredOutputStream;
  return {
    ...adapter,
    chatStream: (options) => adapter.chatStream({
      ...options,
      systemPrompts: [instructions, ...(options.systemPrompts ?? [])],
    }),
    structuredOutput: (options) => adapter.structuredOutput({
      ...options,
      chatOptions: {
        ...options.chatOptions,
        systemPrompts: [
          instructions,
          ...(options.chatOptions.systemPrompts ?? []),
        ],
      },
    }),
    ...(structuredOutputStream
      ? {
          structuredOutputStream: (options) => structuredOutputStream({
            ...options,
            chatOptions: {
              ...options.chatOptions,
              systemPrompts: [
                instructions,
                ...(options.chatOptions.systemPrompts ?? []),
              ],
            },
          }),
        }
      : {}),
  };
}

function deterministicTextAdapter(
  provider: Extract<ApplicationAITextProvider, { readonly kind: 'deterministic' }>,
): AnyTextAdapter {
  const response = provider.response ?? 'Deterministic Applik8s AI response.';
  const delay = provider.latencyMs ?? 0;
  const adapter: AnyTextAdapter = {
    kind: 'text',
    name: 'applik8s-deterministic',
    model: 'deterministic',
    '~types': undefined as never,
    async *chatStream(options): AsyncIterable<StreamChunk> {
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      const runId = options.runId ?? `run-${crypto.randomUUID()}`;
      const threadId = options.threadId ?? `thread-${crypto.randomUUID()}`;
      const messageId = `message-${crypto.randomUUID()}`;
      const timestamp = Date.now();
      yield { type: EventType.RUN_STARTED, runId, threadId, model: adapter.model, timestamp };
      yield { type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant', model: adapter.model, timestamp };
      yield { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: response, model: adapter.model, timestamp };
      yield { type: EventType.TEXT_MESSAGE_END, messageId, model: adapter.model, timestamp };
      yield { type: EventType.RUN_FINISHED, runId, threadId, model: adapter.model, timestamp, finishReason: 'stop' };
    },
    async structuredOutput() {
      const parsed = JSON.parse(response) as unknown;
      return { data: parsed, rawText: response };
    },
  };
  return adapter;
}

async function boundedJson(
  request: Request,
  maximumBytes: number,
): Promise<unknown> {
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new Error(`Agent request exceeds the ${maximumBytes}-byte limit.`);
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > maximumBytes) {
    throw new Error(`Agent request exceeds the ${maximumBytes}-byte limit.`);
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

function assertAgentRequest(
  value: unknown,
): asserts value is ApplicationAIAgentRequestBody {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Agent request body must be an object.');
  }
  if (typeof Reflect.get(value, 'threadId') !== 'string'
    || !String(Reflect.get(value, 'threadId')).trim()) {
    throw new Error('Agent request requires a non-empty threadId.');
  }
  if (typeof Reflect.get(value, 'runId') !== 'string'
    || !String(Reflect.get(value, 'runId')).trim()) {
    throw new Error('Agent request requires a non-empty runId.');
  }
  if (!Array.isArray(Reflect.get(value, 'messages'))) {
    throw new Error('Agent request messages must be an array.');
  }
}

function assertAgentPrincipal(
  principal: ApplicationExecutionPrincipal,
  agent: string,
): void {
  if (principal.kind !== 'execution' || principal.executionKind !== 'agent') {
    throw new Error(`Agent ${agent} requires an admitted agent execution principal.`);
  }
  if (!principal.deadline || Date.parse(principal.deadline) <= Date.now()) {
    throw new Error(`Agent ${agent} execution principal is expired.`);
  }
}

function requiredTool(
  tools: readonly ApplicationAIAgentToolContract[],
  operationId: string,
): ApplicationAIAgentToolContract {
  const candidates = tools.filter((tool) => tool.operation.id === operationId);
  if (candidates.length !== 1) {
    throw new Error(
      `Agent tool operation ${operationId} resolved ${candidates.length} contracts.`,
    );
  }
  const tool = candidates[0];
  if (!tool) throw new Error(`Agent tool operation ${operationId} is unavailable.`);
  return tool;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return Boolean(
    value
    && (typeof value === 'object' || typeof value === 'function')
    && typeof Reflect.get(value, Symbol.asyncIterator) === 'function',
  );
}

export type {
  ApplicationTanStackToolExecutionContext,
  ApplicationTanStackToolInvocation,
  ApplicationTanStackToolOperation,
};
