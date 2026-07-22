import { ApplicationWorkflowObservationError, type ApplicationWorkflowResultOptions } from './workflow-runtime.js';

export const defaultHatchetOperationTimeoutMs = 30_000;

/**
 * Executes one Hatchet provider request behind the common timeout, abort, and
 * credential-redaction boundary. The thunk form also catches synchronous SDK
 * failures before a Promise exists.
 */
export async function boundedHatchetOperation<T>(
  operation: () => Promise<T>,
  id: string,
  action: string,
  options: Omit<ApplicationWorkflowResultOptions, 'pollIntervalMs'>,
): Promise<T> {
  const timeoutMs = positiveHatchetDuration(options.timeoutMs ?? defaultHatchetOperationTimeoutMs, `${action} timeoutMs`);
  throwIfHatchetAborted(options.signal, id);
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new ApplicationWorkflowObservationError('timeout', id, `Timed out after ${timeoutMs}ms while attempting to ${action} workflow ${id}.`)), timeoutMs);
    const abort = () => {
      clearTimeout(timeout);
      reject(new ApplicationWorkflowObservationError('aborted', id, `Observation of workflow ${id} was aborted.`));
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    let pending: Promise<T>;
    try {
      pending = operation();
    } catch (error) {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abort);
      reject(error instanceof ApplicationWorkflowObservationError ? error : sanitizedHatchetProviderError(error));
      return;
    }
    pending.then(resolve, (error: unknown) => {
      reject(error instanceof ApplicationWorkflowObservationError ? error : sanitizedHatchetProviderError(error));
    }).finally(() => {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abort);
    });
  });
}

export function hatchetProviderStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  for (const candidate of [
    Reflect.get(error, 'status'),
    Reflect.get(error, 'statusCode'),
    Reflect.get(error, 'code'),
    Reflect.get(Reflect.get(error, 'response') ?? {}, 'status'),
  ]) {
    const numeric = typeof candidate === 'string' && /^\d{3}$/.test(candidate) ? Number(candidate) : candidate;
    if (typeof numeric === 'number' && Number.isInteger(numeric)) return numeric;
  }
  return undefined;
}

export function sanitizedHatchetProviderError(error: unknown): Error {
  if (error instanceof ApplicationWorkflowObservationError) return error;
  const status = hatchetProviderStatusCode(error);
  const code = error && typeof error === 'object' ? Reflect.get(error, 'code') : undefined;
  const safeCode = typeof code === 'string' && /^[A-Z0-9_-]{1,64}$/i.test(code) ? code : undefined;
  const suffix = [status ? `status ${status}` : undefined, safeCode && safeCode !== String(status) ? `code ${safeCode}` : undefined]
    .filter(Boolean)
    .join(', ');
  const sanitized = new Error(`Hatchet provider request failed${suffix ? ` (${suffix})` : ''}.`);
  sanitized.name = 'HatchetProviderError';
  if (status) Reflect.set(sanitized, 'status', status);
  if (safeCode) Reflect.set(sanitized, 'code', safeCode);
  return sanitized;
}

export function abortableHatchetDelay(durationMs: number, signal: AbortSignal | undefined, id: string): Promise<void> {
  throwIfHatchetAborted(signal, id);
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

export function throwIfHatchetAborted(signal: AbortSignal | undefined, id: string): void {
  if (signal?.aborted) throw new ApplicationWorkflowObservationError('aborted', id, `Observation of workflow ${id} was aborted.`);
}

export function positiveHatchetDuration(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a positive finite number.`);
  return Math.round(value);
}
