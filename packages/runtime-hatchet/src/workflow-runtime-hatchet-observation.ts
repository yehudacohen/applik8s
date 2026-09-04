import {
  ApplicationDurableError,
  ApplicationWorkflowObservationError,
  type ApplicationWorkflowProviderObservation,
  type ApplicationWorkflowResultOptions,
} from '@applik8s/applik8s/workflow-runtime';
import type { HatchetClient } from '@hatchet-dev/typescript-sdk/v1/index.js';
import {
  abortableHatchetDelay,
  hatchetProviderStatusCode,
  positiveHatchetDuration,
  sanitizedHatchetProviderError,
  throwIfHatchetAborted,
} from './workflow-runtime-hatchet-operation.js';

const DEFAULT_RESULT_TIMEOUT_MS = 300_000;
const DEFAULT_POLL_INTERVAL_MS = 500;
const MAX_CONSECUTIVE_PROVIDER_FAILURES = 5;
const DURABLE_ERROR_PREFIX = 'applik8s-durable-error:';

export function durableErrorFromMessage(
  message: string,
): ApplicationDurableError | undefined {
  const start = message.indexOf(DURABLE_ERROR_PREFIX);
  if (start < 0) return undefined;
  const encoded = message.slice(start + DURABLE_ERROR_PREFIX.length).trim();
  try {
    // typecast: parsed provider text is immediately narrowed before any field is trusted.
    const parsed = JSON.parse(encoded) as unknown;
    if (!parsed || typeof parsed !== 'object') return undefined;
    const name = Reflect.get(parsed, 'name');
    const payload = Reflect.get(parsed, 'payload');
    if (
      typeof name !== 'string'
      || !payload
      || typeof payload !== 'object'
      || Array.isArray(payload)
    ) {
      return undefined;
    }
    return new ApplicationDurableError(name, payload);
  } catch {
    return undefined;
  }
}

export async function waitForHatchetResult<TOutput extends object>(
  client: HatchetClient,
  runId: string,
  options: ApplicationWorkflowResultOptions = {},
): Promise<TOutput> {
  const timeoutMs = positiveHatchetDuration(
    options.timeoutMs ?? DEFAULT_RESULT_TIMEOUT_MS,
    'workflow result timeoutMs',
  );
  const pollIntervalMs = positiveHatchetDuration(
    options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    'workflow result pollIntervalMs',
  );
  const deadline = Date.now() + timeoutMs;
  let consecutiveFailures = 0;
  while (Date.now() <= deadline) {
    throwIfHatchetAborted(options.signal, runId);
    try {
      const response = await client.runs.get(runId);
      consecutiveFailures = 0;
      const run = providerRun(response);
      const status = providerStatus(run);
      if (status === 'COMPLETED') {
        return providerOutput<TOutput>(run);
      }
      if (status === 'CANCELLED') {
        throw new ApplicationWorkflowObservationError(
          'cancelled',
          runId,
          `Workflow ${runId} was cancelled.`,
        );
      }
      if (
        terminalFailureStatus(status)
        && !transientHatchetExecutionFailure(run)
      ) {
        throw providerFailure(run, runId, status);
      }
    } catch (cause) {
      if (cause instanceof ApplicationDurableError) throw cause;
      if (cause instanceof ApplicationWorkflowObservationError) throw cause;
      if (hatchetProviderStatusCode(cause) !== 404) {
        consecutiveFailures += 1;
        if (consecutiveFailures >= MAX_CONSECUTIVE_PROVIDER_FAILURES) {
          throw new ApplicationWorkflowObservationError(
            'providerUnavailable',
            runId,
            `Hatchet could not observe workflow ${runId} after ${consecutiveFailures} consecutive provider failures.`,
            { cause: sanitizedHatchetProviderError(cause) },
          );
        }
      }
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await abortableHatchetDelay(
      Math.min(pollIntervalMs, remaining),
      options.signal,
      runId,
    );
  }
  throw new ApplicationWorkflowObservationError(
    'timeout',
    runId,
    `Timed out after ${timeoutMs}ms waiting for workflow ${runId}.`,
  );
}

export async function observeHatchetWorkflowRun<TOutput extends object>(
  client: HatchetClient,
  runId: string,
  admittedAt: string,
  options: ApplicationWorkflowResultOptions = {},
): Promise<ApplicationWorkflowProviderObservation<TOutput>> {
  throwIfHatchetAborted(options.signal, runId);
  let response: unknown;
  try {
    response = await client.runs.get(runId);
  } catch (cause) {
    if (hatchetProviderStatusCode(cause) === 404) {
      return { phase: 'Admitted', admittedAt: isoDate(admittedAt) };
    }
    throw new ApplicationWorkflowObservationError(
      'providerUnavailable',
      runId,
      `Hatchet could not observe workflow ${runId}.`,
      { cause: sanitizedHatchetProviderError(cause) },
    );
  }
  const run = providerRun(response);
  const status = providerStatus(run);
  const observedAdmittedAt = providerDate(run, 'createdAt') ?? isoDate(admittedAt);
  const startedAt = providerDate(run, 'startedAt');
  const finishedAt =
    providerDate(run, 'finishedAt')
    ?? providerDate(run, 'completedAt')
    ?? providerDate(run, 'cancelledAt');
  const common = {
    admittedAt: observedAdmittedAt,
    ...(startedAt ? { startedAt } : {}),
    ...(finishedAt ? { finishedAt } : {}),
  };
  if (terminalFailureStatus(status) && transientHatchetExecutionFailure(run)) {
    return {
      phase: 'Running',
      admittedAt: observedAdmittedAt,
      ...(startedAt ? { startedAt } : {}),
    };
  }
  if (status === 'COMPLETED') {
    return { phase: 'Succeeded', result: providerOutput<TOutput>(run), ...common };
  }
  if (status === 'CANCELLED') return { phase: 'Cancelled', ...common };
  if (status === 'TIMED_OUT' || status === 'TIMEDOUT') {
    return {
      phase: 'TimedOut',
      error: providerExecutionFailure(run, 'WORKFLOW_TIMED_OUT', true),
      ...common,
    };
  }
  if (terminalFailureStatus(status)) {
    return {
      phase: 'Failed',
      error: providerExecutionFailure(run, 'WORKFLOW_FAILED', false),
      ...common,
    };
  }
  return {
    phase: status === 'RUNNING' || startedAt ? 'Running' : 'Admitted',
    ...common,
  };
}

function providerRun(response: unknown): object {
  if (response && typeof response === 'object') {
    const run = Reflect.get(response, 'run');
    if (run && typeof run === 'object') return run;
    return response;
  }
  return {};
}

function providerStatus(run: object): string {
  const status = Reflect.get(run, 'status');
  return typeof status === 'string' ? status.toUpperCase() : 'PENDING';
}

function terminalFailureStatus(status: string): boolean {
  return new Set(['FAILED', 'TIMED_OUT', 'TIMEDOUT']).has(status);
}

function providerOutput<TOutput extends object>(run: object): TOutput {
  const output = Reflect.get(run, 'output');
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    // typecast: workflow contracts constrain successful outputs to objects.
    return {} as TOutput;
  }
  // typecast: the object/array guards establish the provider output object boundary.
  return output as TOutput;
}

function providerFailure(
  run: object,
  runId: string,
  status: string,
): Error {
  const message = providerFailureMessage(run);
  const durable = durableErrorFromMessage(message);
  if (durable) return durable;
  return new ApplicationWorkflowObservationError(
    status === 'TIMED_OUT' || status === 'TIMEDOUT' ? 'timeout' : 'failed',
    runId,
    message || `Workflow ${runId} failed.`,
  );
}

function providerExecutionFailure(
  run: object,
  fallbackCode: string,
  retryable: boolean,
): { readonly code: string; readonly message: string; readonly retryable: boolean } {
  const message = providerFailureMessage(run) || fallbackCode;
  const durable = durableErrorFromMessage(message);
  return {
    code: durable?.durable.name ?? fallbackCode,
    message: durable?.message ?? message,
    retryable,
  };
}

function providerFailureMessage(run: object): string {
  for (const key of ['errorMessage', 'error', 'failureReason', 'message']) {
    const value = Reflect.get(run, key);
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object') {
      const message = Reflect.get(value, 'message');
      if (typeof message === 'string') return message;
    }
  }
  return '';
}

/**
 * Hatchet can briefly expose an execution attempt as FAILED while its durable
 * listener is being reattached after a worker replacement. The provider then
 * retries the same logical run and eventually exposes its authoritative
 * terminal state. Treating this SDK transport message as application failure
 * breaks `run.result()` exactly at the process-recovery boundary durable
 * workflows promise to survive.
 *
 * Keep the classification deliberately narrow: authored failures, durable
 * application errors, and every other provider failure remain terminal.
 */
function transientHatchetExecutionFailure(run: object): boolean {
  return providerFailureMessage(run)
    .toLocaleLowerCase('en-US')
    .includes('durablelistener stopped');
}

function providerDate(run: object, key: string): string | undefined {
  const value = Reflect.get(run, key);
  return typeof value === 'string' && value.length > 0 ? isoDate(value) : undefined;
}

function isoDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}
