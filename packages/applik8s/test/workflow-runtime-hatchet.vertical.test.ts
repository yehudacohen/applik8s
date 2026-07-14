import { ApplicationDurableError, ApplicationWorkflowObservationError } from '@applik8s/applik8s';
import { describe, expect, it, vi } from 'vitest';

import { durableErrorFromMessage, waitForHatchetResult } from '../src/workflow-runtime-hatchet.js';

describe('Hatchet workflow result observation', () => {
  it('decodes declared durable errors into structured application errors', () => {
    const error = durableErrorFromMessage('worker failed: applik8s-durable-error:{"name":"providerUnavailable","payload":{"retryAfterSeconds":10}}');
    expect(error).toBeInstanceOf(ApplicationDurableError);
    expect(error?.durable).toEqual({ name: 'providerUnavailable', payload: { retryAfterSeconds: 10 } });
  });

  it('honors abort signals instead of polling forever', async () => {
    const controller = new AbortController();
    const client = { runs: { get: vi.fn(async () => ({ run: { status: 'RUNNING' } })) } };
    // typecast: the minimal fake supplies only the Hatchet runs.get surface exercised by result observation.
    const pending = waitForHatchetResult(client as never, 'run-abort', { signal: controller.signal, timeoutMs: 5_000, pollIntervalMs: 5 });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ failure: 'aborted', runId: 'run-abort' });
    await pending.catch((error: unknown) => expect(error).toBeInstanceOf(ApplicationWorkflowObservationError));
  });

  it('bounds repeated provider read failures', async () => {
    const client = { runs: { get: vi.fn(async () => { throw new Error('unavailable'); }) } };
    // typecast: the minimal fake supplies only the Hatchet runs.get surface exercised by result observation.
    await expect(waitForHatchetResult(client as never, 'run-unavailable', { timeoutMs: 2_000, pollIntervalMs: 1 })).rejects.toMatchObject({ failure: 'providerUnavailable', runId: 'run-unavailable' });
    expect(client.runs.get).toHaveBeenCalledTimes(5);
  });

  it('returns completed output and reports terminal cancellation distinctly', async () => {
    const completed = { runs: { get: vi.fn(async () => ({ run: { status: 'COMPLETED', output: { endpoint: 'https://example.test' } } })) } };
    // typecast: terminal-state fakes intentionally omit unrelated Hatchet client methods.
    await expect(waitForHatchetResult<{ endpoint: string }>(completed as never, 'run-complete', { timeoutMs: 100 })).resolves.toEqual({ endpoint: 'https://example.test' });
    const cancelled = { runs: { get: vi.fn(async () => ({ run: { status: 'CANCELLED' } })) } };
    // typecast: terminal-state fakes intentionally omit unrelated Hatchet client methods.
    await expect(waitForHatchetResult(cancelled as never, 'run-cancelled', { timeoutMs: 100 })).rejects.toMatchObject({ failure: 'cancelled' });
  });
});
