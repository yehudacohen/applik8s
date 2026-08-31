// typecast-file-boundary: authenticated, bounded controller responses are
// discriminated and validated before restoring generic Job handle payloads.
import type {
  ApplicationJobCancellationResult,
  ApplicationJobDefinition,
  ApplicationJobInvocationOptions,
  ApplicationJobProgressSnapshot,
  ApplicationJobReference,
  ApplicationJobRun,
  ApplicationJobRuntime,
  ApplicationJobTerminalOutcome,
} from './application-finite-jobs.js';
import {
  ApplicationJobResultExpiredError,
  ApplicationJobRunError,
  applicationJobRuntimeProtocol,
} from './application-finite-jobs.js';

const protocol = 'applik8s.jobControllerRequest/v1alpha1';
const maximumResponseBytes = 1_048_576;

export interface RemoteApplicationJobRuntimeOptions {
  readonly endpoint: string;
  readonly authorization: string;
  readonly providerNodeId?: string;
  readonly timeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly fetch?: (
    input: string | URL,
    init?: RequestInit,
  ) => Promise<Response>;
}

/** Rehydrates function-native Job handles over the private controller boundary. */
export function createRemoteApplicationJobRuntime(
  options: RemoteApplicationJobRuntimeOptions,
): ApplicationJobRuntime {
  const endpoint = requiredHttpUrl(options.endpoint);
  const authorization = required(options.authorization, 'Job controller authorization');
  const request = options.fetch ?? globalThis.fetch;
  const pollIntervalMs = positiveInteger(options.pollIntervalMs ?? 250, 'Job controller pollIntervalMs');
  if (typeof request !== 'function') throw new Error('Remote Job runtime requires a Fetch implementation.');

  const invoke = async <T>(body: Readonly<Record<string, unknown>>): Promise<T> => {
    const response = await request(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${authorization}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        apiVersion: protocol,
        ...(options.providerNodeId ? { providerNodeId: options.providerNodeId } : {}),
        ...body,
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
    });
    const text = await boundedResponseText(response);
    let decoded: unknown;
    try {
      decoded = text.length > 0 ? JSON.parse(text) : undefined;
    } catch {
      throw new ApplicationJobControllerRequestError(`Job controller returned non-JSON HTTP ${response.status}.`, `http_${response.status}`);
    }
    if (!response.ok) {
      const code = objectString(decoded, 'error') ?? `http_${response.status}`;
      throw new ApplicationJobControllerRequestError(`Job controller request failed: ${code}.`, code);
    }
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded) || Reflect.get(decoded, 'ok') !== true) {
      throw new ApplicationJobControllerRequestError('Job controller returned an invalid success envelope.', 'invalid_response');
    }
    return Reflect.get(decoded, 'result') as T;
  };

  const runFor = <TOutput extends object, TProgress extends object, TError extends object>(
    reference: ApplicationJobReference,
  ): ApplicationJobRun<TOutput, TProgress, TError> => {
    const outcome = async (): Promise<ApplicationJobTerminalOutcome<TOutput, TError>> => {
      while (true) {
        const observation = await invoke<{
          readonly status: 'pending' | 'terminal' | 'expired';
          readonly outcome?: ApplicationJobTerminalOutcome<TOutput, TError>;
          readonly expiredAt?: string;
        }>({ action: 'outcome', reference });
        if (observation.status === 'terminal' && observation.outcome) return observation.outcome;
        if (observation.status === 'expired') {
          throw new ApplicationJobResultExpiredError(reference, observation.expiredAt ?? reference.admittedAt);
        }
        await delay(pollIntervalMs);
      }
    };
    return Object.freeze({
      reference,
      outcome,
      async result() {
        const terminal = await outcome();
        if (terminal.status === 'succeeded') return terminal.output;
        throw new ApplicationJobRunError(reference, terminal);
      },
      cancel(reason?: string) {
        return invoke<ApplicationJobCancellationResult<TOutput, TError>>({
          action: 'cancel',
          reference,
          ...(reason?.trim() ? { reason: reason.trim() } : {}),
        });
      },
      progress() {
        return invoke<ApplicationJobProgressSnapshot<TProgress> | undefined>({
          action: 'progress',
          reference,
        });
      },
    });
  };

  return Object.freeze({
    protocol: applicationJobRuntimeProtocol,
    register() {
      // The immutable controller artifact owns the authoritative definitions.
    },
    async start<TInput extends object, TOutput extends object, TProgress extends object, TError extends object>(
      definition: ApplicationJobDefinition<TInput, TOutput, TProgress, TError>,
      input: TInput,
      invocation?: Omit<ApplicationJobInvocationOptions, 'wait'>,
    ) {
      const reference = await invoke<ApplicationJobReference>({
        action: 'start',
        job: definition.id,
        input,
        ...(invocation ? { invocation } : {}),
      });
      assertReference(reference, definition.id);
      return runFor<TOutput, TProgress, TError>(reference);
    },
    async attach<TOutput extends object, TProgress extends object, TError extends object>(
      job: string,
      reference: ApplicationJobReference,
    ) {
      assertReference(reference, job);
      const attached = await invoke<ApplicationJobReference>({ action: 'attach', job, reference });
      assertReference(attached, job);
      return runFor<TOutput, TProgress, TError>(attached);
    },
  });
}

export class ApplicationJobControllerRequestError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'ApplicationJobControllerRequestError';
  }
}

function assertReference(value: ApplicationJobReference, job: string): void {
  if (
    !value
    || value.protocol !== applicationJobRuntimeProtocol
    || value.job !== job
    || !value.runId?.trim()
    || !Number.isFinite(Date.parse(value.admittedAt))
  ) {
    throw new ApplicationJobControllerRequestError(`Job controller returned an invalid ${job} run reference.`, 'invalid_reference');
  }
}

async function boundedResponseText(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximumResponseBytes) {
    throw new ApplicationJobControllerRequestError('Job controller response exceeds the byte limit.', 'response_too_large');
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maximumResponseBytes) {
    throw new ApplicationJobControllerRequestError('Job controller response exceeds the byte limit.', 'response_too_large');
  }
  return text;
}

function objectString(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result = Reflect.get(value, key);
  return typeof result === 'string' && result.length > 0 ? result : undefined;
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} is required.`);
  return normalized;
}

function requiredHttpUrl(value: string): string {
  const url = new URL(required(value, 'Job controller endpoint'));
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('Job controller endpoint must use HTTP or HTTPS.');
  }
  return url.toString();
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} must be a positive integer.`);
  return value;
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
