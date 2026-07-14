import { HatchetClient, type JsonObject, Priority } from '@hatchet-dev/typescript-sdk/v1';

import type { ApplicationHatchetWorkflowEngineProvider } from './application-providers.js';
import { ApplicationDurableError, type ApplicationWorkflowInvocationMetadata, ApplicationWorkflowObservationError, type ApplicationWorkflowResultOptions, type ApplicationWorkflowRun, type ApplicationWorkflowRuntime } from './workflow-runtime.js';

const durableErrorMarker = 'applik8s-durable-error:';
const defaultResultTimeoutMs = 24 * 60 * 60 * 1_000;
const defaultCancelTimeoutMs = 30_000;
const maximumConsecutiveReadFailures = 5;

export function createHatchetWorkflowRuntime(provider: ApplicationHatchetWorkflowEngineProvider): ApplicationWorkflowRuntime {
  const token = process.env.HATCHET_CLIENT_TOKEN;
  const hostPort = provider.hostPort ?? process.env.HATCHET_CLIENT_HOST_PORT;
  const apiUrl = provider.apiUrl ?? process.env.HATCHET_CLIENT_API_URL;
  // typecast: Hatchet's JsonObject boundary accepts schema-validated application inputs; the literal TLS strategy retains its SDK discriminant.
  const client = HatchetClient.init({
    ...(token ? { token } : {}),
    ...(hostPort ? { host_port: hostPort } : {}),
    ...(apiUrl ? { api_url: apiUrl } : {}),
    ...(provider.tls !== true ? { tls_config: { tls_strategy: 'none' as const } } : {}), // typecast: retain Hatchet's literal TLS strategy discriminant.
  });
  return {
    async run<TInput extends object, TOutput extends object>(contract: string, input: TInput, metadata?: ApplicationWorkflowInvocationMetadata, result?: ApplicationWorkflowResultOptions) {
      // typecast: schema-validated application input satisfies Hatchet's JSON object transport boundary.
      const reference = await client.runNoWait<JsonObject, JsonObject>(contract, input as JsonObject, hatchetRunOptions(metadata));
      return waitForHatchetResult<TOutput>(client, await reference.runId, result);
    },
    async start<TInput extends object, TOutput extends object>(contract: string, input: TInput, metadata?: ApplicationWorkflowInvocationMetadata) {
      // typecast: schema-validated application input satisfies Hatchet's JSON object transport boundary.
      const reference = await client.runNoWait<JsonObject, JsonObject>(contract, input as JsonObject, hatchetRunOptions(metadata));
      const id = await reference.runId;
      return {
        id,
        result: (options) => waitForHatchetResult<TOutput>(client, id, options),
        cancel: async (options) => {
          await boundedOperation(client.runs.cancel({ ids: [id] }), id, 'cancel', {
            ...options,
            timeoutMs: options?.timeoutMs ?? defaultCancelTimeoutMs,
          });
        },
      } satisfies ApplicationWorkflowRun<TOutput>;
    },
    async schedule(contract, input, at, metadata) {
      const declaration = client.workflow({ name: contract });
      const scheduled = await declaration.schedule(at, input, hatchetRunOptions(metadata));
      const id = Reflect.get(scheduled, 'metadata')?.id ?? Reflect.get(scheduled, 'id');
      return { id: typeof id === 'string' ? id : `${contract}:${at.toISOString()}` };
    },
    async signal(contract, runId, signal, payload, metadata) {
      await client.events.push(`${contract}.${signal}`, payload, {
        scope: runId,
        additionalMetadata: applicationMetadata(metadata),
      });
    },
  };
}

export async function waitForHatchetResult<TOutput extends object>(client: Pick<HatchetClient, 'runs'>, id: string, options: ApplicationWorkflowResultOptions = {}): Promise<TOutput> {
  const timeoutMs = positiveDuration(options.timeoutMs ?? defaultResultTimeoutMs, 'result timeoutMs');
  const pollIntervalMs = positiveDuration(options.pollIntervalMs ?? 250, 'result pollIntervalMs');
  const deadline = Date.now() + timeoutMs;
  let consecutiveReadFailures = 0;
  for (;;) {
    throwIfAborted(options.signal, id);
    if (Date.now() >= deadline) throw new ApplicationWorkflowObservationError('timeout', id, `Timed out waiting ${timeoutMs}ms for workflow ${id}.`);
    let details: Awaited<ReturnType<typeof client.runs.get>>;
    try {
      details = await boundedOperation(client.runs.get(id), id, 'observe', { ...(options.signal ? { signal: options.signal } : {}), timeoutMs: Math.max(1, deadline - Date.now()) });
      consecutiveReadFailures = 0;
    } catch (error) {
      if (error instanceof ApplicationWorkflowObservationError && (error.failure === 'aborted' || error.failure === 'timeout')) throw error;
      consecutiveReadFailures += 1;
      if (consecutiveReadFailures >= maximumConsecutiveReadFailures) {
        throw new ApplicationWorkflowObservationError('providerUnavailable', id, `Unable to observe workflow ${id} after ${consecutiveReadFailures} consecutive provider errors.`, { cause: error });
      }
      await abortableDelay(Math.min(pollIntervalMs * consecutiveReadFailures, Math.max(1, deadline - Date.now())), options.signal, id);
      continue;
    }
    if (details.run.status === 'COMPLETED') {
      // typecast: generated workers validate the declared workflow output before Hatchet persists it.
      return details.run.output as TOutput;
    }
    if (details.run.status === 'FAILED') {
      const durable = durableErrorFromMessage(details.run.errorMessage);
      if (durable) throw durable;
      throw new ApplicationWorkflowObservationError('failed', id, `Hatchet workflow ${id} failed: ${details.run.errorMessage ?? 'no error message'}`);
    }
    if (details.run.status === 'CANCELLED') throw new ApplicationWorkflowObservationError('cancelled', id, `Hatchet workflow ${id} was cancelled.`);
    await abortableDelay(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())), options.signal, id);
  }
}

export function durableErrorFromMessage(message: unknown): ApplicationDurableError | undefined {
  if (typeof message !== 'string') return undefined;
  const markerIndex = message.indexOf(durableErrorMarker);
  if (markerIndex < 0) return undefined;
  const encoded = message.slice(markerIndex + durableErrorMarker.length).split('\n', 1)[0]?.trim();
  if (!encoded) return undefined;
  try {
    const value: unknown = JSON.parse(encoded);
    if (!value || typeof value !== 'object') return undefined;
    const name = Reflect.get(value, 'name');
    const payload = Reflect.get(value, 'payload');
    if (typeof name !== 'string' || name.length === 0 || !payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
    // typecast: runtime guards above establish a non-array object payload at the JSON transport boundary.
    return new ApplicationDurableError(name, payload as object, `Durable application error ${name} from workflow execution.`);
  } catch {
    return undefined;
  }
}

async function boundedOperation<T>(operation: Promise<T>, id: string, action: string, options: Omit<ApplicationWorkflowResultOptions, 'pollIntervalMs'>): Promise<T> {
  const timeoutMs = positiveDuration(options.timeoutMs ?? defaultCancelTimeoutMs, `${action} timeoutMs`);
  throwIfAborted(options.signal, id);
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new ApplicationWorkflowObservationError('timeout', id, `Timed out after ${timeoutMs}ms while attempting to ${action} workflow ${id}.`)), timeoutMs);
    const abort = () => {
      clearTimeout(timeout);
      reject(new ApplicationWorkflowObservationError('aborted', id, `Observation of workflow ${id} was aborted.`));
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    operation.then(resolve, reject).finally(() => {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abort);
    });
  });
}

function abortableDelay(durationMs: number, signal: AbortSignal | undefined, id: string): Promise<void> {
  throwIfAborted(signal, id);
  let abort: (() => void) | undefined;
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, durationMs);
    abort = () => {
      clearTimeout(timeout);
      reject(new ApplicationWorkflowObservationError('aborted', id, `Observation of workflow ${id} was aborted.`));
    };
    signal?.addEventListener('abort', abort, { once: true });
  }).finally(() => {
    if (abort) signal?.removeEventListener('abort', abort);
  });
}

function throwIfAborted(signal: AbortSignal | undefined, id: string): void {
  if (signal?.aborted) throw new ApplicationWorkflowObservationError('aborted', id, `Observation of workflow ${id} was aborted.`);
}

function positiveDuration(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a positive finite number.`);
  return Math.round(value);
}

function hatchetRunOptions(metadata: ApplicationWorkflowInvocationMetadata | undefined): { readonly additionalMetadata?: Record<string, string>; readonly priority?: Priority; readonly childKey?: string } {
  const additionalMetadata = applicationMetadata(metadata);
  const priority = metadata?.priority === 'high' ? Priority.HIGH : metadata?.priority === 'low' ? Priority.LOW : metadata?.priority === 'medium' ? Priority.MEDIUM : undefined;
  return {
    ...(Object.keys(additionalMetadata).length > 0 ? { additionalMetadata } : {}),
    ...(priority ? { priority } : {}),
    ...(metadata?.idempotencyKey ? { childKey: metadata.idempotencyKey } : {}),
  };
}

function applicationMetadata(metadata: ApplicationWorkflowInvocationMetadata | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries({
    'applik8s.idempotency-key': metadata?.idempotencyKey,
    'applik8s.tenant': metadata?.tenant,
    'applik8s.correlation-id': metadata?.correlationId,
    'applik8s.causation-id': metadata?.causationId,
    traceparent: metadata?.traceparent,
  }).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0));
}
