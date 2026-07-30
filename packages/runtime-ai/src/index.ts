// typecast-file-boundary: compiler-normalized catalog descriptors and admitted
// execution principals are validated before erased AI/tool generics are
// restored at this runtime boundary.

export * from './postgres-attempt-store.js';
export * from './agent-gateway.js';
export * from './operation-executor.js';

import type {
  ApplicationAIAgentHandler,
  ApplicationAIAttemptRecord,
  ApplicationAIInvocationRecord,
  ApplicationAIStreamDelta,
} from '@applik8s/ai';
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
  ApplicationRequestAdmission,
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
  readonly action: 'dispatch' | 'join' | 'return-terminal' | 'escalate';
  readonly invocationId: string;
  readonly attemptId: string;
  readonly runId: string;
  readonly version: number;
}

export interface ApplicationAIAgentAttemptObservation {
  readonly invocation: ApplicationAIInvocationRecord;
  readonly attempts: readonly ApplicationAIAttemptRecord[];
  readonly deltas: readonly ApplicationAIStreamDelta[];
}

export interface ApplicationAIAgentAttemptRecovery {
  readonly observe: (
    invocationId: string,
  ) => Promise<ApplicationAIAgentAttemptObservation>;
  readonly timeoutMs?: number;
  readonly minimumPollMs?: number;
  readonly maximumPollMs?: number;
}

export interface ApplicationAIAgentAttemptLifecycle {
  readonly dispatching: (
    reservation: ApplicationAIAgentAttemptReservation,
  ) => Promise<ApplicationAIAgentAttemptReservation>;
  readonly append: (
    reservation: ApplicationAIAgentAttemptReservation,
    event: Readonly<Record<string, unknown>>,
  ) => Promise<ApplicationAIAgentAttemptReservation>;
  readonly completeProvider: (
    reservation: ApplicationAIAgentAttemptReservation,
    terminal: {
      readonly messageId: string;
      readonly usage?: Readonly<Record<string, unknown>>;
    },
  ) => Promise<ApplicationAIAgentAttemptReservation>;
  readonly commitCanonical: (
    reservation: ApplicationAIAgentAttemptReservation,
    terminal: {
      readonly messageId: string;
      readonly content: string;
    },
  ) => Promise<ApplicationAIAgentAttemptReservation>;
  readonly fail: (
    reservation: ApplicationAIAgentAttemptReservation,
    failure: {
      readonly classification: 'provider-failed' | 'completion-uncertain' | 'cancelled';
      readonly reason: string;
    },
  ) => Promise<ApplicationAIAgentAttemptReservation>;
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
  ) =>
    | Promise<
      ApplicationRequestAdmission & {
        readonly principal: ApplicationExecutionPrincipal;
      }
    >
    | (ApplicationRequestAdmission & {
      readonly principal: ApplicationExecutionPrincipal;
    });
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
  readonly recovery: ApplicationAIAgentAttemptRecovery;
  readonly attemptLifecycle: ApplicationAIAgentAttemptLifecycle;
  readonly invoke: (
    operation: ApplicationOperationDescriptor,
    input: unknown,
    invocation: ApplicationTanStackToolInvocation,
    admission: ApplicationRequestAdmission & {
      readonly principal: ApplicationExecutionPrincipal;
    },
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
    let capacityTransferred = false;
    let capacityReleased = false;
    const releaseCapacity = () => {
      if (capacityReleased) return;
      capacityReleased = true;
      active -= 1;
    };
    try {
      const body = await boundedJson(request, maximumRequestBytes);
      assertAgentRequest(body);
      const admission = await options.admit(request, body);
      const principal = admission.principal;
      assertAgentPrincipal(principal, options.name);
      let reservation = await options.reserveAttempt({
        principal,
        threadId: body.threadId,
        runId: body.runId,
        logicalModel: options.logicalModel,
        request: body,
      });
      if (reservation.runId !== body.runId) {
        throw new Error(`Agent ${options.name} attempt reservation changed protocol run identity.`);
      }
      if (reservation.action !== 'dispatch') {
        const response = await recoverApplicationAIAgentAttempt(
          reservation,
          options.recovery,
          request.signal,
        );
        if (isServerSentEventsResponse(response)) {
          const managed = responseWithCapacity(response, releaseCapacity);
          capacityTransferred = true;
          return managed;
        }
        return response;
      }
      reservation = await options.attemptLifecycle.dispatching(reservation);
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
      let executionTransferred = false;
      const releaseExecution = () => {
        clearTimeout(timeout);
        request.signal.removeEventListener('abort', abort);
      };
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
          return await options.invoke(
            tool.operation,
            input,
            invocation,
            admission,
          ) as TOutput;
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
        if (result instanceof Response) {
          throw new Error(
            `Agent ${options.name} returned an opaque Response; managed agents must return a native TanStack stream or a serializable result so durability remains observable.`,
          );
        }
        if (isAsyncIterable(result)) {
          const response = toServerSentEventsResponse(managedAgentStream(
            durableAgentStream(
              result as AsyncIterable<StreamChunk>,
              reservation,
              options.attemptLifecycle,
              controller.signal,
            ),
            releaseExecution,
          ), {
            abortController: controller,
          });
          const managed = responseWithCapacity(response, releaseCapacity);
          executionTransferred = true;
          capacityTransferred = true;
          return managed;
        }
        const messageId = `message-${reservation.attemptId}`;
        reservation = await options.attemptLifecycle.completeProvider(
          reservation,
          { messageId },
        );
        await options.attemptLifecycle.commitCanonical(
          reservation,
          {
            messageId,
            content: JSON.stringify(result),
          },
        );
        return Response.json({ result });
      } finally {
        if (!executionTransferred) releaseExecution();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return Response.json({ error: 'agent_request_failed', message }, { status: 400 });
    } finally {
      if (!capacityTransferred) releaseCapacity();
    }
  };
}

export async function recoverApplicationAIAgentAttempt(
  reservation: ApplicationAIAgentAttemptReservation,
  recovery: ApplicationAIAgentAttemptRecovery,
  signal: AbortSignal,
): Promise<Response> {
  if (reservation.action === 'dispatch') {
    throw new Error(
      `AI attempt ${reservation.attemptId} cannot enter recovery while dispatch is authoritative.`,
    );
  }
  const initial = await recovery.observe(reservation.invocationId);
  const attempt = requiredObservedAttempt(initial, reservation);
  if (reservation.action === 'escalate') {
    return Response.json(
      {
        error: 'agent_completion_uncertain',
        invocationId: reservation.invocationId,
        attemptId: reservation.attemptId,
        state: attempt.state,
        reason:
          attempt.terminalReason
          ?? 'Provider completion cannot be classified safely.',
      },
      { status: 409 },
    );
  }
  if (reservation.action === 'return-terminal') {
    return terminalAttemptResponse(reservation, initial, attempt);
  }
  const timeoutMs = boundedRecoveryNumber(
    recovery.timeoutMs ?? 120_000,
    'timeoutMs',
    1_000,
    15 * 60_000,
  );
  const minimumPollMs = boundedRecoveryNumber(
    recovery.minimumPollMs ?? 50,
    'minimumPollMs',
    10,
    5_000,
  );
  const maximumPollMs = boundedRecoveryNumber(
    recovery.maximumPollMs ?? 1_000,
    'maximumPollMs',
    minimumPollMs,
    10_000,
  );
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  return toServerSentEventsResponse(
    (async function* (): AsyncIterable<StreamChunk> {
      try {
        yield* replayDurableAttempt({
          reservation,
          recovery,
          initial,
          signal: controller.signal,
          timeoutMs,
          minimumPollMs,
          maximumPollMs,
        });
      } finally {
        signal.removeEventListener('abort', abort);
      }
    })(),
    { abortController: controller },
  );
}

async function* durableAgentStream(
  source: AsyncIterable<StreamChunk>,
  initialReservation: ApplicationAIAgentAttemptReservation,
  lifecycle: ApplicationAIAgentAttemptLifecycle,
  signal: AbortSignal,
): AsyncIterable<StreamChunk> {
  let reservation = initialReservation;
  let terminal = false;
  let messageId: string | undefined;
  let content = '';
  try {
    for await (const chunk of source) {
      const event = jsonRecord(chunk, 'TanStack AI stream event');
      reservation = await lifecycle.append(reservation, event);
      if (
        chunk.type === EventType.TEXT_MESSAGE_START
        || chunk.type === EventType.TEXT_MESSAGE_CONTENT
        || chunk.type === EventType.TEXT_MESSAGE_END
      ) {
        messageId = chunk.messageId;
      }
      if (chunk.type === EventType.TEXT_MESSAGE_CONTENT) {
        content += chunk.delta;
      }
      if (chunk.type === EventType.RUN_ERROR) {
        terminal = true;
        reservation = await lifecycle.fail(reservation, {
          classification: 'provider-failed',
          reason: streamErrorReason(chunk),
        });
      } else if (chunk.type === EventType.RUN_FINISHED) {
        if (!messageId) {
          throw new Error(
            `AI attempt ${reservation.attemptId} completed without an assistant message identity.`,
          );
        }
        reservation = await lifecycle.completeProvider(reservation, {
          messageId,
          ...(chunk.usage
            ? { usage: jsonRecord(chunk.usage, 'TanStack AI usage') }
            : {}),
        });
        reservation = await lifecycle.commitCanonical(reservation, {
          messageId,
          content,
        });
        terminal = true;
      }
      yield chunk;
    }
    if (!terminal) {
      reservation = await lifecycle.fail(reservation, {
        classification: signal.aborted ? 'cancelled' : 'completion-uncertain',
        reason: signal.aborted
          ? 'The admitted agent request was cancelled before a terminal provider event.'
          : 'The provider stream ended without a terminal TanStack AI event.',
      });
    }
  } catch (error) {
    if (!terminal) {
      await lifecycle.fail(reservation, {
        classification: signal.aborted ? 'cancelled' : 'completion-uncertain',
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
}

async function* managedAgentStream(
  source: AsyncIterable<StreamChunk>,
  release: () => void,
): AsyncIterable<StreamChunk> {
  try {
    yield* source;
  } finally {
    release();
  }
}

async function* replayDurableAttempt(options: {
  readonly reservation: ApplicationAIAgentAttemptReservation;
  readonly recovery: ApplicationAIAgentAttemptRecovery;
  readonly initial: ApplicationAIAgentAttemptObservation;
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  readonly minimumPollMs: number;
  readonly maximumPollMs: number;
}): AsyncIterable<StreamChunk> {
  const deadline = Date.now() + options.timeoutMs;
  let observation = options.initial;
  let sequence = 0;
  let delayMs = options.minimumPollMs;
  while (true) {
    const attempt = requiredObservedAttempt(observation, options.reservation);
    const deltas = observation.deltas
      .filter(
        (delta) =>
          delta.attemptId === options.reservation.attemptId
          && delta.sequence > sequence,
      )
      .sort((left, right) => left.sequence - right.sequence);
    for (const delta of deltas) {
      if (delta.sequence !== sequence + 1) {
        throw new Error(
          `AI attempt ${attempt.id} durable replay expected sequence ${sequence + 1}, observed ${delta.sequence}.`,
        );
      }
      sequence = delta.sequence;
      yield streamChunk(delta.event);
    }
    if (attempt.state === 'canonical-committed') return;
    if (attempt.state === 'completion-uncertain') {
      throw new Error(
        attempt.terminalReason
          ?? `AI attempt ${attempt.id} completion became uncertain while joining.`,
      );
    }
    if (attempt.state === 'provider-failed' || attempt.state === 'cancelled') {
      throw new Error(
        attempt.terminalReason
          ?? `AI attempt ${attempt.id} became ${attempt.state} while joining.`,
      );
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `AI attempt ${attempt.id} did not reach a durable terminal state within ${options.timeoutMs}ms.`,
      );
    }
    await abortableDelay(delayMs, options.signal);
    delayMs = Math.min(options.maximumPollMs, Math.ceil(delayMs * 1.75));
    observation = await options.recovery.observe(
      options.reservation.invocationId,
    );
  }
}

function terminalAttemptResponse(
  reservation: ApplicationAIAgentAttemptReservation,
  observation: ApplicationAIAgentAttemptObservation,
  attempt: ApplicationAIAttemptRecord,
): Response {
  if (attempt.state === 'canonical-committed') {
    const deltas = observation.deltas
      .filter((delta) => delta.attemptId === reservation.attemptId)
      .sort((left, right) => left.sequence - right.sequence);
    if (deltas.length === 0) {
      return Response.json(
        {
          error: 'agent_terminal_result_unavailable',
          invocationId: reservation.invocationId,
          attemptId: reservation.attemptId,
        },
        { status: 409 },
      );
    }
    const controller = new AbortController();
    return toServerSentEventsResponse(
      (async function* (): AsyncIterable<StreamChunk> {
        let sequence = 0;
        for (const delta of deltas) {
          if (delta.sequence !== sequence + 1) {
            throw new Error(
              `AI attempt ${attempt.id} durable replay expected sequence ${sequence + 1}, observed ${delta.sequence}.`,
            );
          }
          sequence = delta.sequence;
          yield streamChunk(delta.event);
        }
      })(),
      { abortController: controller },
    );
  }
  const status = attempt.state === 'cancelled' ? 410 : 409;
  return Response.json(
    {
      error:
        attempt.state === 'cancelled'
          ? 'agent_invocation_cancelled'
          : 'agent_invocation_terminal',
      invocationId: reservation.invocationId,
      attemptId: reservation.attemptId,
      state: attempt.state,
      ...(attempt.terminalReason ? { reason: attempt.terminalReason } : {}),
    },
    { status },
  );
}

function requiredObservedAttempt(
  observation: ApplicationAIAgentAttemptObservation,
  reservation: ApplicationAIAgentAttemptReservation,
): ApplicationAIAttemptRecord {
  if (observation.invocation.id !== reservation.invocationId) {
    throw new Error(
      `AI attempt recovery for ${reservation.invocationId} observed invocation ${observation.invocation.id}.`,
    );
  }
  if (observation.invocation.currentAttemptId !== reservation.attemptId) {
    throw new Error(
      `AI attempt recovery for ${reservation.invocationId} expected current attempt ${reservation.attemptId}, observed ${observation.invocation.currentAttemptId}.`,
    );
  }
  const attempt = observation.attempts.find(
    (candidate) => candidate.id === reservation.attemptId,
  );
  if (!attempt || attempt.invocationId !== reservation.invocationId) {
    throw new Error(
      `AI attempt recovery cannot observe ${reservation.attemptId} in ${reservation.invocationId}.`,
    );
  }
  return attempt;
}

function streamChunk(event: Readonly<Record<string, unknown>>): StreamChunk {
  if (typeof event.type !== 'string' || !event.type.trim()) {
    throw new Error(
      'Durable AI replay encountered an event without a TanStack type.',
    );
  }
  return event as StreamChunk;
}

function boundedRecoveryNumber(
  value: number,
  field: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `AI attempt recovery ${field} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError(signal.reason));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(done, ms);
    const abort = () => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      reject(abortError(signal.reason));
    };
    function done() {
      signal.removeEventListener('abort', abort);
      resolve();
    }
    signal.addEventListener('abort', abort, { once: true });
  });
}

function abortError(reason: unknown): Error {
  const error = new Error(
    reason instanceof Error
      ? reason.message
      : 'AI attempt recovery was aborted.',
  );
  error.name = 'AbortError';
  return error;
}

function isServerSentEventsResponse(response: Response): boolean {
  return response.headers.get('content-type')
    ?.toLowerCase()
    .includes('text/event-stream') === true;
}

function responseWithCapacity(
  response: Response,
  release: () => void,
): Response {
  if (!response.body) {
    release();
    return response;
  }
  const reader = response.body.getReader();
  let released = false;
  const releaseOnce = () => {
    if (released) return;
    released = true;
    release();
  };
  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const result = await reader.read();
          if (result.done) {
            releaseOnce();
            controller.close();
            return;
          }
          controller.enqueue(result.value);
        } catch (error) {
          releaseOnce();
          controller.error(error);
        }
      },
      async cancel(reason) {
        try {
          await reader.cancel(reason);
        } finally {
          releaseOnce();
        }
      },
    }),
    {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    },
  );
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

function jsonRecord(
  value: unknown,
  description: string,
): Readonly<Record<string, unknown>> {
  const normalized = JSON.parse(JSON.stringify(value)) as unknown;
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
    throw new Error(`${description} must be a JSON object.`);
  }
  return normalized as Readonly<Record<string, unknown>>;
}

function streamErrorReason(
  chunk: Extract<StreamChunk, { readonly type: typeof EventType.RUN_ERROR }>,
): string {
  const message = Reflect.get(chunk, 'message');
  if (typeof message === 'string' && message.trim()) return message;
  return 'The provider emitted a terminal TanStack AI error event.';
}

export type {
  ApplicationTanStackToolExecutionContext,
  ApplicationTanStackToolInvocation,
  ApplicationTanStackToolOperation,
};
