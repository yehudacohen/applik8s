// typecast-file-boundary: TanStack adapter requests, results, and stream chunks
// are external runtime values narrowed and JSON-retained at this boundary.
import { applicationAIDigest } from '@applik8s/ai';
import type { JsonValue } from '@applik8s/core';
import {
  type AnyTextAdapter,
  type ChatMiddleware,
  EventType,
} from '@tanstack/ai';

export type ApplicationTanStackPhysicalCallPhase =
  | 'agent-loop'
  | 'structured-output-finalization';

export interface ApplicationTanStackPhysicalCallUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly cachedInputTokens?: number;
  readonly reasoningTokens?: number;
  readonly costMicrounits?: number;
  readonly currency?: string;
  readonly confidence: 'provider-reported' | 'calculated' | 'unknown';
}

export type ApplicationTanStackPhysicalCallOutput =
  | { readonly kind: 'stream'; readonly chunks: readonly JsonValue[] }
  | { readonly kind: 'structured-output'; readonly result: JsonValue };

/** Credential-free identity and request facts for one actual adapter call. */
export interface ApplicationTanStackPhysicalCallFacts {
  readonly apiVersion: 'applik8s.tanstackPhysicalCall/v1alpha1';
  readonly providerCallId: string;
  readonly operationId: string;
  readonly invocationId: string;
  readonly runId: string;
  /** Stable call order within a native TanStack run and across deterministic retries. */
  readonly ordinal: number;
  readonly phase: ApplicationTanStackPhysicalCallPhase;
  readonly conversationCheckpointHash: string;
  readonly logicalModel: string;
  readonly provider: string;
  readonly providerRequestHash: string;
}

export type ApplicationTanStackPhysicalCallObservation =
  | {
      readonly state: 'issued';
      readonly facts: ApplicationTanStackPhysicalCallFacts;
    }
  | {
      readonly state: 'completed';
      readonly facts: ApplicationTanStackPhysicalCallFacts;
      readonly output: ApplicationTanStackPhysicalCallOutput;
      readonly usage?: ApplicationTanStackPhysicalCallUsage;
    }
  | {
      readonly state: 'failed' | 'cancelled' | 'uncertain';
      readonly facts: ApplicationTanStackPhysicalCallFacts;
      readonly reason: string;
      readonly usage?: ApplicationTanStackPhysicalCallUsage;
    };

/**
 * Application-owned durable fact sink. Applik8s defines observations, while
 * reservation, settlement, reconciliation, and product terminality remain
 * policies of the consuming application.
 */
export interface ApplicationTanStackPhysicalCallSink {
  record(observation: ApplicationTanStackPhysicalCallObservation): Promise<void>;
}

export type ApplicationTanStackPhysicalCallAdmissionDecision =
  | { readonly action: 'dispatch' }
  | {
      readonly action: 'replay';
      readonly output: ApplicationTanStackPhysicalCallOutput;
    }
  | {
      readonly action: 'reject';
      readonly reason: string;
    };

/**
 * Optional application-owned gate invoked before the adapter receives a
 * request. Implementations may atomically reserve a new call, join an
 * equivalent retained call before returning its output, or reject an unsafe
 * redispatch. Applik8s owns only the exact adapter seam and replay mechanics;
 * leases, accounting, reconciliation, and product terminality remain in the
 * application.
 */
export interface ApplicationTanStackPhysicalCallAdmission {
  admit(
    facts: ApplicationTanStackPhysicalCallFacts,
    signal?: AbortSignal,
  ): Promise<ApplicationTanStackPhysicalCallAdmissionDecision>;
  /** Optional durable run-level barrier beyond calls seen by this process. */
  assertTerminal?(input: {
    readonly operationId: string;
    readonly invocationId: string;
    readonly runId: string;
  }): Promise<void>;
}

export interface ApplicationTanStackPhysicalCallMiddlewareOptions {
  readonly operationId: string;
  readonly invocationId: string;
  readonly runId: string;
  readonly sink: ApplicationTanStackPhysicalCallSink;
  readonly admission?: ApplicationTanStackPhysicalCallAdmission;
  /** Maximum JSON bytes retained in one completion observation. */
  readonly maximumRetainedResultBytes?: number;
}

export interface ApplicationTanStackPhysicalCallMiddleware {
  readonly adapter: AnyTextAdapter;
  readonly middleware: ChatMiddleware;
  readonly observations: () => readonly ApplicationTanStackPhysicalCallObservation[];
}

/**
 * Observe the exact native adapter boundary without defining an agent loop or
 * application lifecycle. One adapter invocation produces one issued fact and
 * exactly one best-effort terminal fact.
 */
export function createApplicationTanStackPhysicalCallMiddleware(
  adapter: AnyTextAdapter,
  options: ApplicationTanStackPhysicalCallMiddlewareOptions,
): ApplicationTanStackPhysicalCallMiddleware {
  const maximumBytes = options.maximumRetainedResultBytes ?? 8 * 1024 * 1024;
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 64 * 1024 * 1024) {
    throw new RangeError('TanStack physical-call retained results must be bounded between 1 byte and 64 MiB.');
  }
  const operationId = nonEmpty(options.operationId, 'operationId');
  const invocationId = nonEmpty(options.invocationId, 'invocationId');
  const runId = nonEmpty(options.runId, 'runId');
  const observations: ApplicationTanStackPhysicalCallObservation[] = [];
  const open = new Map<string, ApplicationTanStackPhysicalCallFacts>();
  let ordinal = 0;

  const structuredOutputStream = adapter.structuredOutputStream;
  const wrapped = Object.create(adapter) as AnyTextAdapter;
  const properties: PropertyDescriptorMap = {
    chatStream: method((request: Parameters<AnyTextAdapter['chatStream']>[0]) =>
      physicalStream('agent-loop', request, () => adapter.chatStream(request))),
    structuredOutput: method(async (request: Parameters<AnyTextAdapter['structuredOutput']>[0]) => {
      const call = await openCall('structured-output-finalization', request);
      if (call.action === 'replay') {
        return replayedStructuredOutput(call.output);
      }
      const facts = call.facts;
      try {
        const result = await adapter.structuredOutput(request);
        await complete(facts, retainedOutput('structured-output', result, maximumBytes), modelCallUsage(result.usage));
        return result;
      } catch (error) {
        await terminate(facts, terminalState(error, requestSignal(request)), error);
        throw error;
      }
    }),
  };
  if (structuredOutputStream) {
    properties.structuredOutputStream = method((request: Parameters<NonNullable<AnyTextAdapter['structuredOutputStream']>>[0]) =>
      physicalStream('structured-output-finalization', request, () =>
        structuredOutputStream.call(adapter, request)));
  }
  if (adapter.supportsCombinedToolsAndSchema) {
    properties.supportsCombinedToolsAndSchema = method((modelOptions: never) =>
      adapter.supportsCombinedToolsAndSchema?.call(adapter, modelOptions) ?? false);
  }
  if (adapter.combinedStructuredOutputSource) {
    properties.combinedStructuredOutputSource = method((modelOptions: never) =>
      adapter.combinedStructuredOutputSource?.call(adapter, modelOptions) ?? 'text');
  }
  Object.defineProperties(wrapped, properties);

  const assertTerminal = async () => {
    const first = open.values().next().value as ApplicationTanStackPhysicalCallFacts | undefined;
    if (first) {
      throw new ApplicationTanStackPhysicalCallStateError(
        first,
        `TanStack run cannot become terminal with ${open.size} physical call(s) still open.`,
      );
    }
    await options.admission?.assertTerminal?.({ operationId, invocationId, runId });
  };
  const middleware: ChatMiddleware = Object.freeze({
    name: 'applik8s-physical-call-terminal-observation',
    onFinish: assertTerminal,
    onAbort: assertTerminal,
    onError: assertTerminal,
  });
  return Object.freeze({
    adapter: wrapped,
    middleware,
    observations: () => Object.freeze([...observations]),
  });

  async function openCall(
    phase: ApplicationTanStackPhysicalCallPhase,
    request: unknown,
  ): Promise<
    | { readonly action: 'dispatch'; readonly facts: ApplicationTanStackPhysicalCallFacts }
    | { readonly action: 'replay'; readonly output: ApplicationTanStackPhysicalCallOutput }
  > {
    const callOrdinal = ordinal++;
    const providerRequestHash = await applicationTanStackProviderRequestHashV1(phase, request);
    const conversationCheckpointHash = await applicationTanStackConversationCheckpointHashV1(phase, request);
    const facts: ApplicationTanStackPhysicalCallFacts = Object.freeze({
      apiVersion: 'applik8s.tanstackPhysicalCall/v1alpha1',
      providerCallId: await applicationTanStackPhysicalCallIdV1({
        operationId,
        invocationId,
        runId,
        ordinal: callOrdinal,
        phase,
        conversationCheckpointHash,
      }),
      operationId,
      invocationId,
      runId,
      ordinal: callOrdinal,
      phase,
      conversationCheckpointHash,
      logicalModel: adapter.model,
      provider: adapterProvider(adapter),
      providerRequestHash,
    });
    const signal = requestSignal(request);
    if (signal?.aborted) throw abortReason(signal);
    const decision = options.admission
      ? await options.admission.admit(facts, signal)
      : { action: 'dispatch' as const };
    if (decision.action === 'replay') {
      return Object.freeze({
        action: 'replay' as const,
        output: retainedReplayOutput(decision.output, maximumBytes),
      });
    }
    if (decision.action === 'reject') {
      throw new ApplicationTanStackPhysicalCallStateError(
        facts,
        nonEmpty(decision.reason, 'physical-call admission rejection reason'),
      );
    }
    open.set(facts.providerCallId, facts);
    await observe(Object.freeze({ state: 'issued', facts }));
    return Object.freeze({ action: 'dispatch' as const, facts });
  }

  async function complete(
    facts: ApplicationTanStackPhysicalCallFacts,
    output: ApplicationTanStackPhysicalCallOutput,
    usage?: ApplicationTanStackPhysicalCallUsage,
  ): Promise<void> {
    open.delete(facts.providerCallId);
    await observe(Object.freeze({ state: 'completed', facts, output, ...(usage ? { usage } : {}) }));
  }

  async function terminate(
    facts: ApplicationTanStackPhysicalCallFacts,
    state: 'failed' | 'cancelled' | 'uncertain',
    reason: unknown,
    usage?: ApplicationTanStackPhysicalCallUsage,
  ): Promise<void> {
    if (!open.delete(facts.providerCallId)) return;
    await observe(Object.freeze({
      state,
      facts,
      reason: errorReason(reason),
      ...(usage ? { usage } : {}),
    }));
  }

  async function observe(observation: ApplicationTanStackPhysicalCallObservation): Promise<void> {
    observations.push(observation);
    await options.sink.record(observation);
  }

  function physicalStream<T extends { readonly type: string }>(
    phase: ApplicationTanStackPhysicalCallPhase,
    request: unknown,
    source: () => AsyncIterable<T>,
  ): AsyncIterable<T> {
    return (async function* () {
      const call = await openCall(phase, request);
      if (call.action === 'replay') {
        for (const chunk of replayedStreamOutput<T>(call.output)) yield chunk;
        return;
      }
      const facts = call.facts;
      const chunks: JsonValue[] = [];
      let bytes = 2;
      let terminal = false;
      const iterator = source()[Symbol.asyncIterator]();
      try {
        while (true) {
          const next = await nextStreamChunk(iterator, requestSignal(request));
          if (next.done) break;
          const chunk = next.value;
          const retained = jsonClone(chunk, 'TanStack provider stream chunk');
          bytes += jsonBytes(retained) + (chunks.length > 0 ? 1 : 0);
          if (bytes > maximumBytes) throw new ApplicationTanStackPhysicalCallRetentionError(maximumBytes);
          chunks.push(retained);
          if (chunk.type === EventType.RUN_FINISHED) {
            terminal = true;
            await complete(facts, Object.freeze({ kind: 'stream', chunks: Object.freeze(chunks) }), modelCallUsage(Reflect.get(chunk, 'usage')));
          } else if (chunk.type === EventType.RUN_ERROR) {
            terminal = true;
            await terminate(facts, 'failed', Reflect.get(chunk, 'error') ?? Reflect.get(chunk, 'message'), modelCallUsage(Reflect.get(chunk, 'usage')));
          }
          yield chunk;
        }
        if (!terminal) {
          await terminate(facts, 'uncertain', 'Provider stream ended without terminal evidence.');
          throw new ApplicationTanStackPhysicalCallStateError(facts, 'Provider stream ended without terminal evidence.');
        }
      } catch (error) {
        if (!terminal) await terminate(facts, terminalState(error, requestSignal(request)), error);
        throw error;
      } finally {
        if (!terminal && open.has(facts.providerCallId)) {
          await terminate(facts, 'uncertain', 'Provider stream consumption stopped before terminal evidence.');
        }
        if (!terminal) void iterator.return?.().catch(() => undefined);
      }
    })();
  }
}

export class ApplicationTanStackPhysicalCallStateError extends Error {
  readonly code = 'APPLIK8S_TANSTACK_PHYSICAL_CALL_STATE';
  constructor(
    readonly facts: ApplicationTanStackPhysicalCallFacts,
    message: string,
  ) {
    super(message);
  }
}

export class ApplicationTanStackPhysicalCallRetentionError extends Error {
  readonly code = 'APPLIK8S_TANSTACK_PHYSICAL_CALL_RETENTION_LIMIT';
  constructor(readonly maximumBytes: number) {
    super(`TanStack physical-call result exceeded ${maximumBytes} retained bytes.`);
  }
}

export async function applicationTanStackPhysicalCallIdV1(input: {
  readonly operationId: string;
  readonly invocationId: string;
  readonly runId: string;
  readonly ordinal: number;
  readonly phase: ApplicationTanStackPhysicalCallPhase;
  readonly conversationCheckpointHash: string;
}): Promise<string> {
  const digest = await applicationAIDigest({
    version: 'applik8s-tanstack-physical-call-identity-v1',
    ...input,
  });
  return `applik8s:tanstack-physical-call:${digest.slice('sha256:'.length)}`;
}

export function applicationTanStackConversationCheckpointHashV1(
  phase: ApplicationTanStackPhysicalCallPhase,
  value: unknown,
): Promise<string> {
  const request = record(value) ?? {};
  const chat = record(request.chatOptions) ?? request;
  return applicationAIDigest({
    version: 'applik8s-tanstack-conversation-checkpoint-v1',
    phase,
    messages: chat.messages,
    threadId: chat.threadId,
    runId: chat.runId,
    parentRunId: chat.parentRunId,
  });
}

export function applicationTanStackProviderRequestHashV1(
  phase: ApplicationTanStackPhysicalCallPhase,
  value: unknown,
): Promise<string> {
  const request = record(value) ?? {};
  const chat = record(request.chatOptions) ?? request;
  return applicationAIDigest({
    version: 'applik8s-tanstack-provider-request-v1',
    phase,
    model: chat.model,
    messages: chat.messages,
    systemPrompts: chat.systemPrompts,
    tools: credentialFreeProjection(chat.tools),
    modelOptions: credentialFreeProjection(chat.modelOptions),
    threadId: chat.threadId,
    runId: chat.runId,
    parentRunId: chat.parentRunId,
    approvals: sortedApprovals(chat.approvals),
    outputSchema: request.outputSchema ?? chat.outputSchema,
  });
}

function modelCallUsage(value: unknown): ApplicationTanStackPhysicalCallUsage | undefined {
  const usage = record(value);
  if (!usage
    || !nonNegativeInteger(usage.promptTokens)
    || !nonNegativeInteger(usage.completionTokens)
    || !nonNegativeInteger(usage.totalTokens)) return undefined;
  const promptDetails = record(usage.promptTokensDetails);
  const completionDetails = record(usage.completionTokensDetails);
  const cached = promptDetails?.cachedTokens;
  const reasoning = completionDetails?.reasoningTokens;
  const cost = usage.cost;
  const costMicrounits = typeof cost === 'number' && Number.isFinite(cost) && cost >= 0
    ? Math.round(cost * 1_000_000)
    : undefined;
  return Object.freeze({
    inputTokens: usage.promptTokens as number,
    outputTokens: usage.completionTokens as number,
    totalTokens: usage.totalTokens as number,
    ...(nonNegativeInteger(cached) ? { cachedInputTokens: cached as number } : {}),
    ...(nonNegativeInteger(reasoning) ? { reasoningTokens: reasoning as number } : {}),
    ...(costMicrounits !== undefined ? { costMicrounits, currency: 'USD' } : {}),
    confidence: costMicrounits !== undefined ? 'provider-reported' : 'unknown',
  });
}

function retainedOutput(kind: 'structured-output', value: unknown, maximumBytes: number): ApplicationTanStackPhysicalCallOutput {
  const result = jsonClone(value, 'TanStack structured-output result');
  if (jsonBytes(result) > maximumBytes) throw new ApplicationTanStackPhysicalCallRetentionError(maximumBytes);
  return Object.freeze({ kind, result });
}

function retainedReplayOutput(
  output: ApplicationTanStackPhysicalCallOutput,
  maximumBytes: number,
): ApplicationTanStackPhysicalCallOutput {
  if (output.kind === 'structured-output') {
    return retainedOutput('structured-output', output.result, maximumBytes);
  }
  const chunks = output.chunks.map((chunk) =>
    jsonClone(chunk, 'Retained TanStack provider stream chunk'));
  const bytes = jsonBytes(chunks);
  if (bytes > maximumBytes) {
    throw new ApplicationTanStackPhysicalCallRetentionError(maximumBytes);
  }
  return Object.freeze({ kind: 'stream', chunks: Object.freeze(chunks) });
}

function replayedStructuredOutput(
  output: ApplicationTanStackPhysicalCallOutput,
): JsonValue {
  if (output.kind !== 'structured-output') {
    throw new TypeError('Retained TanStack physical call is not structured output.');
  }
  return jsonClone(output.result, 'Retained TanStack structured output');
}

function replayedStreamOutput<T extends { readonly type: string }>(
  output: ApplicationTanStackPhysicalCallOutput,
): readonly T[] {
  if (output.kind !== 'stream') {
    throw new TypeError('Retained TanStack physical call is not a stream.');
  }
  return output.chunks.map((chunk) =>
    jsonClone(chunk, 'Retained TanStack provider stream chunk') as T);
}

function requestSignal(value: unknown): AbortSignal | undefined {
  const request = record(value);
  const chat = record(request?.chatOptions) ?? request;
  const direct = record(chat?.request)?.signal;
  if (direct instanceof AbortSignal) return direct;
  const controller = chat?.abortController;
  const signal = controller && typeof controller === 'object'
    ? Reflect.get(controller, 'signal')
    : undefined;
  return signal instanceof AbortSignal ? signal : undefined;
}

function terminalState(error: unknown, signal?: AbortSignal): 'failed' | 'cancelled' {
  return signal?.aborted
    || error instanceof DOMException && error.name === 'AbortError'
    ? 'cancelled'
    : 'failed';
}

function adapterProvider(adapter: AnyTextAdapter): string {
  const provider = Reflect.get(adapter, 'provider');
  return typeof provider === 'string' && provider.trim()
    ? provider.trim()
    : nonEmpty(adapter.name, 'adapter.name');
}

function nextStreamChunk<T>(iterator: AsyncIterator<T>, signal?: AbortSignal): Promise<IteratorResult<T>> {
  if (!signal) return iterator.next();
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortReason(signal));
    signal.addEventListener('abort', abort, { once: true });
    iterator.next().then((value) => {
      signal.removeEventListener('abort', abort);
      resolve(value);
    }, (error) => {
      signal.removeEventListener('abort', abort);
      reject(error);
    });
  });
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException(errorReason(signal.reason ?? 'provider call aborted'), 'AbortError');
}

function sortedApprovals(value: unknown): unknown {
  return value instanceof Map
    ? [...value.entries()].sort(([left], [right]) => String(left).localeCompare(String(right)))
    : value;
}

function credentialFreeProjection(value: unknown): unknown {
  return project(value, new WeakSet<object>());
  function project(current: unknown, ancestors: WeakSet<object>): unknown {
    if (typeof current === 'function' || typeof current === 'symbol') return undefined;
    if (current === null || current === undefined || typeof current !== 'object') return current;
    if (ancestors.has(current)) throw new TypeError('TanStack provider request projection must be acyclic.');
    ancestors.add(current);
    try {
      if (Array.isArray(current)) return current.map((entry) => project(entry, ancestors));
      return Object.fromEntries(Object.entries(current)
        .filter(([key]) => !credentialField(key))
        .map(([key, entry]) => [key, project(entry, ancestors)]));
    } finally {
      ancestors.delete(current);
    }
  }
}

function credentialField(key: string): boolean {
  const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/gu, '');
  return normalized === 'authorization'
    || normalized === 'proxyauthorization'
    || normalized === 'cookie'
    || normalized === 'setcookie'
    || normalized === 'token'
    || normalized.endsWith('apikey')
    || normalized.endsWith('authtoken')
    || normalized.endsWith('accesstoken')
    || normalized.endsWith('refreshtoken')
    || normalized.endsWith('sessiontoken')
    || normalized.endsWith('bearertoken')
    || normalized.endsWith('clientsecret')
    || normalized.endsWith('password')
    || normalized.endsWith('credential');
}

function jsonClone(value: unknown, label: string): JsonValue {
  let encoded: string | undefined;
  try { encoded = JSON.stringify(value); } catch (cause) {
    throw new TypeError(`${label} must be JSON-serializable.`, { cause });
  }
  if (encoded === undefined) throw new TypeError(`${label} must be JSON-serializable.`);
  return JSON.parse(encoded) as JsonValue;
}

function jsonBytes(value: JsonValue): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function method(value: unknown): PropertyDescriptor {
  return Object.freeze({ configurable: false, enumerable: false, writable: false, value });
}

function record(value: unknown): Record<PropertyKey, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<PropertyKey, unknown>
    : undefined;
}

function nonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function nonEmpty(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${name} must not be empty.`);
  return normalized;
}

function errorReason(value: unknown): string {
  return (value instanceof Error ? value.message : String(value ?? 'provider error')).slice(0, 2_048);
}
