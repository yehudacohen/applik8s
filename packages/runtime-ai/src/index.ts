// typecast-file-boundary: compiler-normalized catalog descriptors and admitted
// execution principals are validated before erased AI/tool generics are
// restored at this runtime boundary.

export * from './agent-gateway.js';
export * from './operation-executor.js';
export * from './postgres-attempt-store.js';

import type {
  ApplicationAIAgentHandler,
  ApplicationAIAgentPersistence,
  ApplicationAIAgentPersistenceRun,
  ApplicationAIAttemptRecord,
  ApplicationAIInvocationRecord,
  ApplicationAIStreamDelta,
} from '@applik8s/ai';
import type {
  ApplicationTanStackAgentRuntime,
  ApplicationTanStackAIAgentRequest,
  ApplicationTanStackChatTranscriptPersistence,
  ApplicationTanStackToolExecutionContext,
  ApplicationTanStackToolInvocation,
  ApplicationTanStackToolOperation,
} from '@applik8s/ai-tanstack';
import {
  applicationTanStackStandardSchema,
  asTool,
  reconstructApplicationTanStackChat,
} from '@applik8s/ai-tanstack';
import {
  type ApplicationOperationAuthorizationContract,
  type ApplicationOperationContract,
  createApplicationMutationOperation,
  createApplicationQueryOperation,
  createApplicationRuntimeOperation,
} from '@applik8s/client';
import type {
  ApplicationAdmissionContextV1,
  ApplicationExecutionPrincipal,
  ApplicationOperationDescriptor,
  ApplicationTelemetryBoundaryKind,
  ApplicationTelemetryEnvelopeV1,
  ApplicationTelemetryInvocationKind,
  ApplicationWorkloadAuthorityEnvelope,
  JsonObject,
  JsonValue,
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
      readonly tool?: {
        readonly index?: number;
        readonly input: JsonObject;
        readonly inputFromLatestUser?: 'document';
        readonly required?: boolean;
      };
    }
  | {
      readonly kind: 'openai-compatible';
      readonly name: string;
      readonly baseUrl: string;
      readonly apiKey?: string;
      readonly model: string;
      readonly allowInsecureHttp?: boolean;
      readonly api?: 'chat-completions' | 'responses';
      readonly timeoutMs?: number;
      readonly maximumRetries?: number;
    };

export interface ApplicationAIAgentAttemptReservation {
  readonly action: 'dispatch' | 'join' | 'return-terminal' | 'escalate';
  readonly invocationId: string;
  readonly attemptId: string;
  readonly runId: string;
  readonly ordinal: number;
  readonly version: number;
  readonly telemetry?: ApplicationTelemetryEnvelopeV1;
  /**
   * Request-local, server-derived authority retained across provider stream
   * callbacks. This is never persisted with the durable attempt record; it
   * lets terminal framework effects avoid depending on an ambient scope that
   * may have unwound while an SSE response was consumed.
   */
  readonly executionAdmission?: ApplicationAdmissionContextV1 & {
    readonly principal: ApplicationExecutionPrincipal;
  };
}

export interface ApplicationAIAgentTelemetryBoundary {
  readonly kind: ApplicationTelemetryBoundaryKind;
  readonly identity: string;
  readonly attempt?: number;
  readonly execution?: string;
  readonly service?: string;
  readonly provider?: string;
  readonly definition?: string;
  readonly instance?: string;
  readonly invocation?: ApplicationTelemetryInvocationKind;
  readonly relationship?: 'asynchronous' | 'synchronous';
  readonly parent?: ApplicationTelemetryEnvelopeV1;
  readonly links?: readonly ApplicationTelemetryEnvelopeV1[];
  readonly attributes?: Readonly<Record<string, string | number | boolean>>;
}

export interface ApplicationAIAgentTelemetryRuntime {
  run<TResult>(
    boundary: ApplicationAIAgentTelemetryBoundary,
    execute: () => Promise<TResult>,
  ): Promise<TResult>;
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
      readonly estimatedInputTokens?: number;
      readonly estimatedOutputTokens?: number;
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
  readonly persistence: ApplicationAIAgentPersistence;
  readonly tanstackPersistence: (input: {
    readonly principal: ApplicationExecutionPrincipal;
    readonly trustedContext: Readonly<Record<string, JsonValue>>;
    readonly threadId: string;
  }) => ApplicationTanStackChatTranscriptPersistence;
  readonly timeoutMs: number;
  readonly maximumConcurrency: number;
  readonly maximumRequestBytes?: number;
  readonly telemetry?: ApplicationAIAgentTelemetryRuntime;
  readonly admit: (
    request: Request,
    body: ApplicationAIAgentRequestBody,
  ) =>
    | Promise<ApplicationAIAgentExecutionAdmission>
    | ApplicationAIAgentExecutionAdmission;
  readonly reserveAttempt: (
    input: {
      readonly principal: ApplicationExecutionPrincipal;
      readonly admission: ApplicationAdmissionContextV1 & {
        readonly principal: ApplicationExecutionPrincipal;
      };
      readonly trustedContext: Readonly<Record<string, JsonValue>>;
      readonly threadId: string;
      readonly runId: string;
      readonly logicalModel: string;
      readonly request: ApplicationAIAgentRequestBody;
      readonly telemetry?: ApplicationTelemetryEnvelopeV1;
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
    admission: ApplicationAIAgentExecutionAdmission,
  ) => Promise<unknown>;
}

export interface ApplicationAIAgentExecutionAdmission {
  readonly context: ApplicationAdmissionContextV1 & {
    readonly principal: ApplicationExecutionPrincipal;
  };
  readonly telemetry?: ApplicationTelemetryEnvelopeV1;
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
    if (request.method === 'GET' && url.pathname === '/__applik8s/v1/ai/chat') {
      const threadId = url.searchParams.get('threadId')?.trim() ?? '';
      if (!threadId) {
        return Response.json({ messages: [], activeRun: null, interrupts: null }, {
          headers: { 'cache-control': 'no-store' },
        });
      }
      const runId = `hydrate:${threadId}`;
      const admission = await options.admit(request, {
        threadId,
        runId,
        messages: [],
      });
      const principal = admission.context.principal;
      const trustedContext = admission.context.trustedContext.values;
      assertAgentPrincipal(principal, options.name);
      const persistence = options.tanstackPersistence({
        principal,
        trustedContext,
        threadId,
      });
      return reconstructApplicationTanStackChat(persistence, request, {
        authorize: () => true,
      });
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
      const principal = admission.context.principal;
      const trustedContext = admission.context.trustedContext.values;
      assertAgentPrincipal(principal, options.name);
      let reservation = await options.reserveAttempt({
        principal,
        admission: admission.context,
        trustedContext,
        threadId: body.threadId,
        runId: body.runId,
        logicalModel: options.logicalModel,
        request: body,
        ...(admission.telemetry ? { telemetry: admission.telemetry } : {}),
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
      let persistedRun: ApplicationAIAgentPersistenceRun;
      try {
        persistedRun = await options.persistence.begin({
          principal,
          trustedContext,
          conversationId: body.threadId,
          protocolRunId: body.runId,
          agentRunId: principal.executionId,
          invocationId: reservation.invocationId,
          messages: body.messages.map((message, index) =>
            jsonValue(message, `Agent request message ${index}`)),
          startedAt: new Date().toISOString(),
        });
      } catch (error) {
        await options.attemptLifecycle.fail(reservation, {
          classification: 'provider-failed',
          reason: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      let persistenceTerminal = false;
      try {
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
            const invoke = () => options.invoke(
              tool.operation,
              input,
              invocation,
              admission,
            ) as Promise<TOutput>;
            if (!options.telemetry) return await invoke();
            return await options.telemetry.run({
              kind: 'operation',
              identity: tool.operation.id,
              execution: `${reservation.attemptId}:tool:${invocation.providerToolCallId}`,
              attempt: 1,
              instance: reservation.attemptId,
              relationship: 'synchronous',
              attributes: {
                'applik8s.ai.provider_tool_call': invocation.providerToolCallId,
              },
            }, invoke);
          },
        };
        const runtime: ApplicationTanStackAgentRuntime = {
          adapter: withApplicationInstructions(
            withApplicationAbortSignal(
              instrumentApplicationAITextAdapter(
                baseAdapter,
                options.telemetry,
                options.logicalModel,
                reservation,
              ),
              controller.signal,
            ),
            instructions,
          ),
          tools: operationTools,
          persistence: options.tanstackPersistence({
            principal,
            trustedContext,
            threadId: body.threadId,
          }),
          execution,
        };
        try {
          const result = await runApplicationAIAgentExecution(
            options.telemetry,
            {
              kind: 'agent',
              identity: options.name,
              execution: reservation.invocationId,
              attempt: reservation.ordinal,
              definition: options.name,
              instance: reservation.attemptId,
              relationship: 'asynchronous',
              ...(reservation.telemetry
                ? { links: [reservation.telemetry] }
                : admission.telemetry
                  ? { links: [admission.telemetry] }
                  : {}),
              attributes: {
                'applik8s.ai.logical_model': options.logicalModel,
              },
            },
            () => options.handler(
              {
                threadId: body.threadId,
                messages: body.messages,
                ...(body.resume !== undefined ? { resume: body.resume } : {}),
              },
              {
                runId: reservation.runId,
                invocationId: reservation.invocationId,
                attemptId: reservation.attemptId,
                principal,
                admission: admission.context,
                trustedContext,
                signal: controller.signal,
                tanstack: runtime,
              },
            ),
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
                persistedRun,
                controller.signal,
                estimatedTokenCount(body.messages),
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
            {
              messageId,
              estimatedInputTokens: estimatedTokenCount(body.messages),
              estimatedOutputTokens: estimatedTokenCount(result),
            },
          );
          const completedAt = new Date().toISOString();
          await persistedRun.complete({
            messageId,
            content: jsonValue(result, 'Agent result'),
            completedAt,
          });
          persistenceTerminal = true;
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
        const reason = error instanceof Error ? error.message : String(error);
        if (!persistenceTerminal) {
          await Promise.allSettled([
            persistedRun.terminate({
              status: request.signal.aborted ? 'cancelled' : 'failed',
              reason,
              terminatedAt: new Date().toISOString(),
            }),
            options.attemptLifecycle.fail(reservation, {
              classification: request.signal.aborted
                ? 'cancelled'
                : 'provider-failed',
              reason,
            }),
          ]);
        }
        throw error;
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
  persistence: ApplicationAIAgentPersistenceRun,
  signal: AbortSignal,
  estimatedInputTokens: number,
): AsyncIterable<StreamChunk> {
  let reservation = initialReservation;
  let terminal = false;
  let persistenceTerminal = false;
  let messageId: string | undefined;
  let content = '';
  try {
    for await (const chunk of source) {
      const event = jsonRecord(chunk, 'TanStack AI stream event');
      await persistence.append(event);
      reservation = await lifecycle.append(reservation, event);
      if (chunk.type === EventType.RUN_STARTED) {
        // TanStack emits one provider lifecycle pair per agent-loop turn.
        // A tool-call turn is durable evidence, but only the final assistant
        // turn owns the canonical response message.
        messageId = undefined;
        content = '';
      }
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
        const reason = streamErrorReason(chunk);
        await persistence.terminate({
          status: 'failed',
          reason,
          terminatedAt: new Date().toISOString(),
        });
        persistenceTerminal = true;
        reservation = await lifecycle.fail(reservation, {
          classification: 'provider-failed',
          reason,
        });
        terminal = true;
      } else if (
        chunk.type === EventType.RUN_FINISHED
        && chunk.finishReason !== 'tool_calls'
      ) {
        // Some OpenAI-compatible providers emit an explicit terminal
        // RUN_FINISHED after a successful tool turn without opening another
        // text-message envelope. The terminal event is still authoritative
        // provider evidence; use the physical attempt identity for the empty
        // canonical assistant turn rather than misclassifying the completed
        // tool execution as uncertain. Streams that end without RUN_FINISHED
        // remain fail-closed below.
        messageId ??= `message-${reservation.attemptId}`;
        reservation = await lifecycle.completeProvider(reservation, {
          messageId,
          estimatedInputTokens,
          estimatedOutputTokens: estimatedTokenCount(content),
          ...(chunk.usage
            ? { usage: jsonRecord(chunk.usage, 'TanStack AI usage') }
            : {}),
        });
        await persistence.complete({
          messageId,
          content,
          completedAt: new Date().toISOString(),
        });
        persistenceTerminal = true;
        reservation = await lifecycle.commitCanonical(reservation, {
          messageId,
          content,
        });
        terminal = true;
      }
      yield chunk;
    }
    if (!terminal) {
      const classification = signal.aborted
        ? 'cancelled'
        : 'completion-uncertain';
      const reason = signal.aborted
        ? 'The admitted agent request was cancelled before a terminal provider event.'
        : 'The provider stream ended without a terminal TanStack AI event.';
      await persistence.terminate({
        status: signal.aborted ? 'cancelled' : 'interrupted',
        reason,
        terminatedAt: new Date().toISOString(),
      });
      reservation = await lifecycle.fail(reservation, {
        classification,
        reason,
      });
    }
  } catch (error) {
    if (!terminal) {
      if (!persistenceTerminal) {
        await persistence.terminate({
          status: signal.aborted ? 'cancelled' : 'interrupted',
          reason: error instanceof Error ? error.message : String(error),
          terminatedAt: new Date().toISOString(),
        });
      }
      await lifecycle.fail(reservation, {
        classification: signal.aborted ? 'cancelled' : 'completion-uncertain',
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
}

function estimatedTokenCount(value: unknown): number {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  return Math.max(1, Math.ceil((serialized?.length ?? 0) / 4));
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
  if (
    endpoint.protocol !== 'https:'
    && endpoint.hostname !== 'localhost'
    && endpoint.hostname !== '127.0.0.1'
    && provider.allowInsecureHttp !== true
  ) {
    throw new Error('OpenAI-compatible AI provider endpoints must use HTTPS outside loopback.');
  }
  return openaiCompatibleText(provider.model, {
    name: provider.name,
    baseURL: endpoint.toString().replace(/\/$/u, ''),
    // The application-side client talks to the managed gateway, which owns
    // upstream provider credentials. The OpenAI-compatible adapter still
    // requires a non-empty local credential during construction, so use a
    // non-secret sentinel when the gateway does not require client auth.
    apiKey: provider.apiKey ?? 'applik8s-managed-gateway',
    api: provider.api ?? 'chat-completions',
    ...(provider.timeoutMs !== undefined ? { timeout: provider.timeoutMs } : {}),
    ...(provider.maximumRetries !== undefined ? { maxRetries: provider.maximumRetries } : {}),
  });
}

function applicationAgentTool(
  contract: ApplicationAIAgentToolContract,
): ReturnType<typeof asTool> {
  const presentation = applicationOperationPresentation(contract.operation);
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
    presentation,
  });
}

function applicationOperationPresentation(
  descriptor: ApplicationOperationDescriptor,
): {
  readonly label: string;
  readonly runningLabel: string;
  readonly completedLabel: string;
} {
  const target = humanizeApplicationOperationToken(
    descriptor.target?.model ?? descriptor.name,
  );
  const action = descriptor.kind === 'model.create'
    ? 'Create'
    : descriptor.kind === 'model.update'
      ? 'Update'
      : descriptor.kind === 'model.delete'
        ? 'Delete'
        : descriptor.kind === 'model.read' || descriptor.kind === 'model.query'
          ? 'Read'
          : humanizeApplicationOperationToken(descriptor.name);
  const label = `${action} ${target}`.trim();
  return Object.freeze({
    label,
    runningLabel: `${label}…`,
    completedLabel: `${target} ${action === 'Read' ? 'read' : `${action.toLowerCase()}d`}`,
  });
}

function humanizeApplicationOperationToken(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .replace(/[-_]+/gu, ' ')
    .trim()
    .replace(/^./u, character => character.toUpperCase());
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

/**
 * Makes request cancellation a property of the managed agent execution rather
 * than an opt-in responsibility of every authored `chat()` callback. TanStack
 * AI still accepts an explicit AbortController, but the framework-owned request
 * and budget signal remains authoritative even when the callback omits it.
 */
function withApplicationAbortSignal(
  adapter: AnyTextAdapter,
  signal: AbortSignal,
): AnyTextAdapter {
  const structuredOutputStream = adapter.structuredOutputStream;
  return {
    ...adapter,
    chatStream: (options) => abortableApplicationAIStream(
      adapter.chatStream({
        ...options,
        request: applicationAIRequestWithSignal(options.request, signal),
      }),
      signal,
    ),
    structuredOutput: (options) => abortableApplicationAIPromise(
      adapter.structuredOutput({
        ...options,
        chatOptions: {
          ...options.chatOptions,
          request: applicationAIRequestWithSignal(
            options.chatOptions.request,
            signal,
          ),
        },
      }),
      signal,
    ),
    ...(structuredOutputStream
      ? {
          structuredOutputStream: (options) => abortableApplicationAIStream(
            structuredOutputStream({
              ...options,
              chatOptions: {
                ...options.chatOptions,
                request: applicationAIRequestWithSignal(
                  options.chatOptions.request,
                  signal,
                ),
              },
            }),
            signal,
          ),
        }
      : {}),
  };
}

function applicationAIRequestWithSignal(
  request: Request | RequestInit | undefined,
  signal: AbortSignal,
): Request | RequestInit {
  const requestSignal = request instanceof Request ? request.signal : request?.signal;
  const combined = requestSignal
    ? AbortSignal.any([requestSignal, signal])
    : signal;
  return request instanceof Request
    ? new Request(request, { signal: combined })
    : { ...request, signal: combined };
}

async function abortableApplicationAIPromise<T>(
  source: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) throw abortError(signal.reason);
  let abort: (() => void) | undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(abortError(signal.reason));
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([source, cancelled]);
  } finally {
    if (abort) signal.removeEventListener('abort', abort);
  }
}

function abortableApplicationAIStream<T>(
  source: AsyncIterable<T>,
  signal: AbortSignal,
): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      const iterator = source[Symbol.asyncIterator]();
      try {
        while (true) {
          const result = await abortableApplicationAIPromise(
            iterator.next(),
            signal,
          );
          if (result.done) return;
          yield result.value;
        }
      } finally {
        // Provider transports receive the same signal through request options.
        // Do not hold the caller open while a non-cooperative adapter finishes
        // an already-cancelled `next()` promise.
        void iterator.return?.().catch(() => undefined);
      }
    },
  };
}

function instrumentApplicationAITextAdapter(
  adapter: AnyTextAdapter,
  telemetry: ApplicationAIAgentTelemetryRuntime | undefined,
  logicalModel: string,
  reservation: ApplicationAIAgentAttemptReservation,
): AnyTextAdapter {
  if (!telemetry) return adapter;
  let providerAttempt = 0;
  const boundary = (): ApplicationAIAgentTelemetryBoundary => {
    providerAttempt += 1;
    return {
      kind: 'provider',
      identity: `${logicalModel}.inference`,
      execution: `${reservation.attemptId}:provider:${providerAttempt}`,
      attempt: providerAttempt,
      provider: adapter.name,
      definition: logicalModel,
      instance: reservation.attemptId,
      relationship: 'synchronous',
      attributes: {
        'applik8s.ai.model': adapter.model,
      },
    };
  };
  const structuredOutputStream = adapter.structuredOutputStream;
  return {
    ...adapter,
    chatStream: (options) => applicationAITelemetryStream(
      telemetry,
      boundary(),
      adapter.chatStream(options),
    ),
    structuredOutput: (options) => telemetry.run(
      boundary(),
      () => adapter.structuredOutput(options),
    ),
    ...(structuredOutputStream
      ? {
          structuredOutputStream: (options) => applicationAITelemetryStream(
            telemetry,
            boundary(),
            structuredOutputStream(options),
          ),
        }
      : {}),
  };
}

function applicationAITelemetryStream<T>(
  telemetry: ApplicationAIAgentTelemetryRuntime,
  boundary: ApplicationAIAgentTelemetryBoundary,
  source: AsyncIterable<T>,
): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      const instrumented = await runApplicationAIAgentExecution(
        telemetry,
        boundary,
        async () => source,
      );
      yield* instrumented;
    },
  };
}

async function runApplicationAIAgentExecution<TResult>(
  telemetry: ApplicationAIAgentTelemetryRuntime | undefined,
  boundary: ApplicationAIAgentTelemetryBoundary,
  execute: () => TResult | Promise<TResult>,
): Promise<TResult> {
  if (!telemetry) return await execute();
  const ready = applicationAIDeferred<
    | { readonly kind: 'value'; readonly value: TResult }
    | { readonly kind: 'stream'; readonly value: AsyncIterable<unknown> }
  >();
  const channel = applicationAITelemetryChannel<unknown>();
  const running = telemetry.run(boundary, async () => {
    try {
      const value = await execute();
      if (!isAsyncIterable(value)) {
        ready.resolve({ kind: 'value', value });
        return;
      }
      ready.resolve({ kind: 'stream', value: channel.iterable });
      for await (const item of value) await channel.send(item);
      channel.close();
    } catch (error) {
      if (!ready.settled()) ready.reject(error);
      else channel.fail(error);
      throw error;
    }
  });
  // Stream failures are delivered by the channel. Immediate failures are
  // delivered by `ready`; this catch prevents a second unhandled rejection.
  void running.catch(() => {});
  const outcome = await ready.promise;
  if (outcome.kind === 'value') {
    await running;
    return outcome.value;
  }
  return outcome.value as TResult;
}

function applicationAIDeferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
  readonly settled: () => boolean;
} {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: unknown) => void;
  let isSettled = false;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve(value) {
      if (isSettled) return;
      isSettled = true;
      resolvePromise(value);
    },
    reject(error) {
      if (isSettled) return;
      isSettled = true;
      rejectPromise(error);
    },
    settled: () => isSettled,
  };
}

function applicationAITelemetryChannel<T>(): {
  readonly iterable: AsyncIterable<T>;
  readonly send: (value: T) => Promise<void>;
  readonly close: () => void;
  readonly fail: (error: unknown) => void;
} {
  type Consumer = {
    readonly resolve: (result: IteratorResult<T>) => void;
    readonly reject: (error: unknown) => void;
  };
  type Produced = {
    readonly value: T;
    readonly consumed: () => void;
    readonly rejected: (error: unknown) => void;
  };
  let consumer: Consumer | undefined;
  let produced: Produced | undefined;
  let terminal: { readonly error?: unknown } | undefined;
  const cancelled = new Error('Application AI telemetry stream consumer cancelled.');
  cancelled.name = 'AbortError';

  const fail = (error: unknown) => {
    if (terminal) return;
    terminal = { error };
    consumer?.reject(error);
    consumer = undefined;
    produced?.rejected(error);
    produced = undefined;
  };
  const close = () => {
    if (terminal) return;
    terminal = {};
    consumer?.resolve({ done: true, value: undefined });
    consumer = undefined;
  };
  const send = (value: T): Promise<void> => {
    if (terminal) return Promise.reject(terminal.error ?? cancelled);
    if (consumer) {
      const selected = consumer;
      consumer = undefined;
      selected.resolve({ done: false, value });
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      produced = { value, consumed: resolve, rejected: reject };
    });
  };
  const iterable: AsyncIterable<T> = {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<T>> {
          if (produced) {
            const selected = produced;
            produced = undefined;
            selected.consumed();
            return Promise.resolve({ done: false, value: selected.value });
          }
          if (terminal) {
            return terminal.error === undefined
              ? Promise.resolve({ done: true, value: undefined })
              : Promise.reject(terminal.error);
          }
          return new Promise<IteratorResult<T>>((resolve, reject) => {
            consumer = { resolve, reject };
          });
        },
        async return(): Promise<IteratorResult<T>> {
          fail(cancelled);
          return { done: true, value: undefined };
        },
      };
    },
  };
  return { iterable, send, close, fail };
}

function deterministicTextAdapter(
  provider: Extract<ApplicationAITextProvider, { readonly kind: 'deterministic' }>,
): AnyTextAdapter {
  const delay = provider.latencyMs ?? 0;
  const adapter: AnyTextAdapter = {
    kind: 'text',
    name: 'applik8s-deterministic',
    model: 'deterministic',
    '~types': undefined as never,
    async *chatStream(options): AsyncIterable<StreamChunk> {
      if (delay > 0) {
        const requestSignal = options.request instanceof Request
          ? options.request.signal
          : options.request?.signal;
        await applicationAIProviderDelay(delay, requestSignal);
      }
      const runId = options.runId ?? `run-${crypto.randomUUID()}`;
      const threadId = options.threadId ?? `thread-${crypto.randomUUID()}`;
      const timestamp = Date.now();
      yield { type: EventType.RUN_STARTED, runId, threadId, model: adapter.model, timestamp };
      const fixtureTool = provider.tool;
      if (
        fixtureTool
        && !hasToolResultAfterLatestUser(options.messages)
        && (fixtureTool.required !== false || (options.tools?.length ?? 0) > 0)
      ) {
        const toolIndex = fixtureTool.index ?? 0;
        const tool = options.tools?.[toolIndex];
        if (!tool) {
          throw new Error(
            `Deterministic AI fixture selects tool index ${toolIndex}, but the agent exposes ${options.tools?.length ?? 0} tools.`,
          );
        }
        const toolCallId = `tool-call-${crypto.randomUUID()}`;
        const toolInput = fixtureTool.inputFromLatestUser === 'document'
          ? deterministicDocumentInput(options.messages)
          : fixtureTool.input;
        const argumentsJson = JSON.stringify(toolInput);
        yield {
          type: EventType.TOOL_CALL_START,
          toolCallId,
          toolCallName: tool.name,
          toolName: tool.name,
          index: toolIndex,
          model: adapter.model,
          timestamp,
        };
        yield {
          type: EventType.TOOL_CALL_ARGS,
          toolCallId,
          delta: argumentsJson,
          args: argumentsJson,
          model: adapter.model,
          timestamp,
        };
        yield {
          type: EventType.TOOL_CALL_END,
          toolCallId,
          toolCallName: tool.name,
          toolName: tool.name,
          input: toolInput,
          model: adapter.model,
          timestamp,
        };
        yield {
          type: EventType.RUN_FINISHED,
          runId,
          threadId,
          model: adapter.model,
          timestamp,
          finishReason: 'tool_calls',
        };
        return;
      }
      const response = deterministicResponse(provider, options.messages);
      const messageId = `message-${crypto.randomUUID()}`;
      yield { type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant', model: adapter.model, timestamp };
      yield { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: response, model: adapter.model, timestamp };
      yield { type: EventType.TEXT_MESSAGE_END, messageId, model: adapter.model, timestamp };
      yield { type: EventType.RUN_FINISHED, runId, threadId, model: adapter.model, timestamp, finishReason: 'stop' };
    },
    async structuredOutput() {
      const response = provider.response ?? 'Deterministic Applik8s AI response.';
      const parsed = JSON.parse(response) as unknown;
      return { data: parsed, rawText: response };
    },
  };
  return adapter;
}

function applicationAIProviderDelay(
  delayMs: number,
  signal?: AbortSignal | null,
): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError(signal.reason));
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, delayMs);
    const abort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      reject(abortError(signal?.reason));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function deterministicResponse(
  provider: Extract<ApplicationAITextProvider, { readonly kind: 'deterministic' }>,
  messages: readonly unknown[],
): string {
  if (provider.tool?.inputFromLatestUser !== 'document') {
    return provider.response ?? 'Deterministic Applik8s AI response.';
  }
  const input = deterministicDocumentInput(messages);
  return `I created “${String(input.title)}” from your request. The saved Document is the authoritative result.`;
}

function deterministicDocumentInput(messages: readonly unknown[]): JsonObject {
  const prompt = latestUserText(messages) || 'Create a useful workspace document.';
  const requestedTitle = prompt
    .replace(/^(?:please\s+)?(?:create|write|draft|make)\s+(?:a|an|the)?\s*/iu, '')
    .split(/\s+(?:with|containing|that)\s+/iu)[0]
    ?.replace(/[.!?]+$/u, '')
    .trim();
  const title = sentenceCase((requestedTitle || 'Requested deliverable').slice(0, 96));
  const count = requestedChecklistCount(prompt);
  const checklist = [
    'Confirm the scope, accountable owner, intended audience, and decision deadline before work begins.',
    'Exercise the critical path in the target environment and attach the observable result to this document.',
    'Resolve or explicitly assign every blocker, then record the next decision and the person responsible for it.',
    'Share the outcome with affected stakeholders and confirm that each dependency has an acknowledged owner.',
    'Schedule a time-boxed follow-up verification with an explicit success or rollback decision.',
  ].slice(0, count);
  return {
    title,
    body: [
      `# ${title}`,
      '',
      '## Objective',
      `Turn the request below into a reviewable, owned result rather than an informal conversation. The work is complete only when the critical path has evidence, remaining risk has an owner, and the next decision is unambiguous.`,
      '',
      '> Requested outcome',
      `> ${prompt}`,
      '',
      '## Execution plan',
      '1. **Frame the outcome.** Confirm the audience, scope, constraints, deadline, and the decision this document needs to support. Record assumptions instead of silently filling gaps.',
      '2. **Exercise the path.** Run the smallest representative journey that proves the outcome in the environment where it matters. Capture concrete observations, not only implementation activity.',
      '3. **Review the evidence.** Compare the result with the success measures below, identify gaps, and assign each follow-up to one accountable person.',
      '4. **Communicate the decision.** Publish the result, its limitations, and the next checkpoint in the shared workspace so downstream work can rely on one authoritative artifact.',
      '',
      '## Success measures',
      '- The requested outcome is demonstrated through an observable end-to-end result.',
      '- A reviewer can understand what was tested, what passed, and what remains uncertain without reconstructing the conversation.',
      '- Every blocker and dependency has an owner and a bounded next action.',
      '- The artifact is stored in the workspace and can be found, reviewed, revised, and published through the normal product journey.',
      '',
      '## Risks and rollback',
      'The primary risk is mistaking a plausible-looking artifact for completed work. Treat unverified assumptions, unavailable dependencies, and partial environment coverage as explicit open items. If the representative journey fails or evidence is incomplete, do not present the outcome as finished: preserve the last known-good state, record the failed observation, assign remediation, and return to the previous checkpoint.',
      '',
      '## Checklist',
      ...checklist.map(item => `- [ ] ${item}`),
      '',
      '## Next action',
      'Name the accountable owner and schedule the first evidence-producing step. Update this document with the observed result before requesting approval or publication.',
    ].join('\n'),
    summary: `A deterministic Starter document grounded in the request: ${prompt.slice(0, 180)}`,
    tags: ['assistant-created', 'starter-demo'],
  };
}

function latestUserText(messages: readonly unknown[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== 'object' || Reflect.get(message, 'role') !== 'user') continue;
    const directContent = Reflect.get(message, 'content');
    if (typeof directContent === 'string' && directContent.trim()) return directContent.trim();
    const parts = Reflect.get(message, 'parts');
    if (!Array.isArray(parts)) continue;
    const text = parts.map(part => {
      if (!part || typeof part !== 'object') return '';
      const content = Reflect.get(part, 'content');
      return typeof content === 'string' ? content : '';
    }).filter(Boolean).join('\n').trim();
    if (text) return text;
  }
  return '';
}

function requestedChecklistCount(prompt: string): number {
  const match = /\b(?:exactly\s+)?(one|two|three|four|five|[1-5])\s+(?:checklist\s+)?items?\b/iu.exec(prompt);
  const value = match?.[1]?.toLowerCase();
  const wordCounts: Readonly<Record<string, number>> = {
    one: 1, two: 2, three: 3, four: 4, five: 5,
  };
  return (value ? wordCounts[value] : undefined)
    ?? (value ? Number(value) : 3);
}

function sentenceCase(value: string): string {
  return value ? `${value[0]?.toUpperCase()}${value.slice(1)}` : value;
}

function hasToolResultAfterLatestUser(
  messages: readonly { readonly role: string }[],
): boolean {
  let lastUser = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      lastUser = index;
      break;
    }
  }
  return messages
    .slice(lastUser + 1)
    .some((message) => message.role === 'tool');
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
): JsonObject {
  const normalized = JSON.parse(JSON.stringify(value)) as unknown;
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
    throw new Error(`${description} must be a JSON object.`);
  }
  return normalized as JsonObject;
}

function jsonValue(
  value: unknown,
  description: string,
): import('@applik8s/core').JsonValue {
  const normalized = JSON.parse(JSON.stringify(value)) as unknown;
  if (
    normalized === null
    || typeof normalized === 'string'
    || typeof normalized === 'number'
    || typeof normalized === 'boolean'
    || Array.isArray(normalized)
    || (normalized && typeof normalized === 'object')
  ) {
    return normalized as import('@applik8s/core').JsonValue;
  }
  throw new Error(`${description} must be JSON-serializable.`);
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
