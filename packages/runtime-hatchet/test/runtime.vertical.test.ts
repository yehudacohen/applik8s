// typecast-file-boundary: Hatchet adapter tests construct SDK-shaped fakes and decoded task payloads to verify the provider boundary.
import { ApplicationDurableError, ApplicationWorkflowObservationError } from '@applik8s/applik8s';
import { applicationWorkflowCausalPrincipalMetadata } from '@applik8s/applik8s/workflow-runtime';
import { createHatchetWorkflowRuntimeFromClient, createHatchetWorkflowRuntimeFromClientFactory, durableErrorFromMessage, observeHatchetWorkflowRun, reconcileHatchetWorkflowSchedule, waitForHatchetResult } from '@applik8s/runtime-hatchet';
import { describe, expect, it, vi } from 'vitest';
import { applicationMetadata } from '../src/workflow-runtime-hatchet-metadata.js';

describe('Hatchet workflow result observation', () => {
  it('durably serializes framework-owned causal attribution without adding an application option', () => {
    expect(applicationMetadata({
      idempotencyKey: 'workflow-1',
      [applicationWorkflowCausalPrincipalMetadata]: {
        id: 'principal:human:user-1',
        identity: {
          id: 'identity:human:user-1',
          kind: 'human',
          issuer: 'https://identity.example.test',
          subject: 'user-1',
        },
        grantIds: ['grant:workflow-1'],
      },
    })).toMatchObject({
      'applik8s.idempotency-key': 'workflow-1',
      'applik8s.causal-principal': JSON.stringify({
        id: 'principal:human:user-1',
        identity: {
          id: 'identity:human:user-1',
          kind: 'human',
          issuer: 'https://identity.example.test',
          subject: 'user-1',
        },
        grantIds: ['grant:workflow-1'],
      }),
    });
  });

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

  it('treats a newly-created run that is not yet visible as pending until it appears', async () => {
    const client = { runs: { get: vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('not found'), { response: { status: 404 } }))
      .mockRejectedValueOnce(Object.assign(new Error('not found'), { status: 404 }))
      .mockResolvedValue({ run: { status: 'COMPLETED', output: { endpoint: 'https://example.test' } } }) } };

    await expect(waitForHatchetResult<{ endpoint: string }>(client as never, 'run-eventually-visible', {
      timeoutMs: 1_000,
      pollIntervalMs: 1,
    })).resolves.toEqual({ endpoint: 'https://example.test' });
    expect(client.runs.get).toHaveBeenCalledTimes(3);
  });

  it('never exposes provider authorization headers through its durable error boundary', async () => {
    const secret = 'should-never-escape';
    const client = { runs: { get: vi.fn(async () => {
      throw Object.assign(new Error('request failed'), {
        response: { status: 503 },
        config: { headers: { Authorization: `Bearer ${secret}` } },
      });
    }) } };

    const error = await waitForHatchetResult(client as never, 'run-redacted', {
      timeoutMs: 2_000,
      pollIntervalMs: 1,
    }).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApplicationWorkflowObservationError);
    expect(error).toMatchObject({ failure: 'providerUnavailable', runId: 'run-redacted' });
    const serialized = JSON.stringify(error, Object.getOwnPropertyNames(error as object));
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('Authorization');
    expect((error as Error).cause).toMatchObject({ name: 'HatchetProviderError', status: 503 });
  });

  it('returns completed output and reports terminal cancellation distinctly', async () => {
    const completed = { runs: { get: vi.fn(async () => ({ run: { status: 'COMPLETED', output: { endpoint: 'https://example.test' } } })) } };
    // typecast: terminal-state fakes intentionally omit unrelated Hatchet client methods.
    await expect(waitForHatchetResult<{ endpoint: string }>(completed as never, 'run-complete', { timeoutMs: 100 })).resolves.toEqual({ endpoint: 'https://example.test' });
    const cancelled = { runs: { get: vi.fn(async () => ({ run: { status: 'CANCELLED' } })) } };
    // typecast: terminal-state fakes intentionally omit unrelated Hatchet client methods.
    await expect(waitForHatchetResult(cancelled as never, 'run-cancelled', { timeoutMs: 100 })).rejects.toMatchObject({ failure: 'cancelled' });
  });

  it('maps one provider observation into the provider-neutral tracking contract', async () => {
    const client = {
      runs: {
        get: vi.fn(async () => ({
          run: {
            status: 'COMPLETED',
            output: { endpoint: 'https://example.test' },
            createdAt: '2026-07-31T12:00:00Z',
            startedAt: '2026-07-31T12:00:01Z',
            finishedAt: '2026-07-31T12:00:02Z',
          },
        })),
      },
    };

    await expect(
      observeHatchetWorkflowRun<{ endpoint: string }>(
        client as never,
        'run-complete',
        '2026-07-31T11:59:59.000Z',
      ),
    ).resolves.toEqual({
      phase: 'Succeeded',
      result: { endpoint: 'https://example.test' },
      admittedAt: '2026-07-31T12:00:00.000Z',
      startedAt: '2026-07-31T12:00:01.000Z',
      finishedAt: '2026-07-31T12:00:02.000Z',
    });
  });
});

describe('Hatchet recurring schedule convergence', () => {
  function fakeCron() {
    const rows: Array<{ metadata: { id: string }; name: string; cron: string; enabled: boolean; additionalMetadata?: Record<string, unknown> }> = [];
    const cron = {
      list: vi.fn(async () => ({ rows: [...rows] })),
      create: vi.fn(async (_workflow: string, input: { name: string; expression: string; additionalMetadata?: Record<string, string> }) => {
        const row = {
          metadata: { id: `provider-${rows.length + 1}` },
          name: input.name,
          cron: input.expression,
          enabled: true,
          ...(input.additionalMetadata ? { additionalMetadata: input.additionalMetadata } : {}),
        };
        rows.push(row);
        return row;
      }),
      delete: vi.fn(async (row: string | { metadata: { id: string } }) => {
        const id = typeof row === 'string' ? row : row.metadata.id;
        const index = rows.findIndex((candidate) => candidate.metadata.id === id);
        if (index >= 0) rows.splice(index, 1);
      }),
    };
    return { rows, client: { cron } };
  }

  it('creates once, remains unchanged for the same revision, and replaces drifted desired state', async () => {
    const fixture = fakeCron();
    const desired = { id: 'automation-a', expression: '0 */6 * * *', revision: '7', enabled: true, input: { accountId: 'bot-a', nested: { b: 2, a: 1 } } } as const;
    await expect(reconcileHatchetWorkflowSchedule(fixture.client, 'automation.execute.v1', desired)).resolves.toMatchObject({ state: 'created', revision: '7' });
    await expect(reconcileHatchetWorkflowSchedule(fixture.client, 'automation.execute.v1', { ...desired, input: { nested: { a: 1, b: 2 }, accountId: 'bot-a' } })).resolves.toMatchObject({ state: 'unchanged' });
    expect(fixture.client.cron.create).toHaveBeenCalledTimes(1);
    await expect(reconcileHatchetWorkflowSchedule(fixture.client, 'automation.execute.v1', { ...desired, expression: '0 */4 * * *', revision: '8' })).resolves.toMatchObject({ state: 'created', revision: '8' });
    expect(fixture.client.cron.delete).toHaveBeenCalledTimes(1);
    expect(fixture.rows).toHaveLength(1);
    expect(fixture.rows[0]).toMatchObject({ name: 'automation-a', cron: '0 */4 * * *' });
  });

  it('removes suspended schedules and fails closed on invalid or unbounded desired state', async () => {
    const fixture = fakeCron();
    const desired = { id: 'automation-a', expression: '0 */6 * * *', revision: '1', enabled: true, input: { accountId: 'bot-a' } } as const;
    await reconcileHatchetWorkflowSchedule(fixture.client, 'automation.execute.v1', desired);
    await expect(reconcileHatchetWorkflowSchedule(fixture.client, 'automation.execute.v1', { ...desired, enabled: false, revision: '2' })).resolves.toMatchObject({ state: 'removed' });
    expect(fixture.rows).toHaveLength(0);
    await expect(reconcileHatchetWorkflowSchedule(fixture.client, 'automation.execute.v1', { ...desired, expression: '* * *' })).rejects.toThrow(/expression-invalid/);
    await expect(reconcileHatchetWorkflowSchedule(fixture.client, 'automation.execute.v1', { ...desired, input: { body: 'x'.repeat(70_000) } })).rejects.toThrow(/input-too-large/);
  });
});

describe('Hatchet provider credential boundary', () => {
  it('resolves a fresh provider client for each newly-started operation', async () => {
    const clients = [
      {
        runNoWait: vi.fn(async () => ({ runId: 'first-run' })),
        runs: { get: vi.fn(), cancel: vi.fn() },
      },
      {
        runNoWait: vi.fn(async () => ({ runId: 'second-run' })),
        runs: { get: vi.fn(), cancel: vi.fn() },
      },
    ];
    const factory = vi.fn(() => clients.shift() as never);
    const runtime = createHatchetWorkflowRuntimeFromClientFactory(factory);

    await expect(runtime.start('example.start.v1', {})).resolves.toMatchObject({ id: 'first-run' });
    await expect(runtime.start('example.start.v1', {})).resolves.toMatchObject({ id: 'second-run' });
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('bounds and redacts start, schedule, and signal failures', async () => {
    const secret = 'hatchet-secret-that-must-not-escape';
    const providerFailure = () => Object.assign(new Error(`Bearer ${secret}`), {
      response: { status: 503 },
      config: { headers: { Authorization: `Bearer ${secret}` } },
    });
    const client = {
      runNoWait: vi.fn(async () => { throw providerFailure(); }),
      workflow: vi.fn(() => ({ schedule: vi.fn(async () => { throw providerFailure(); }) })),
      events: { push: vi.fn(async () => { throw providerFailure(); }) },
      runs: { get: vi.fn(), cancel: vi.fn() },
      cron: { list: vi.fn(), create: vi.fn(), delete: vi.fn() },
    };
    // typecast: the fake deliberately implements only the provider methods
    // reached by these workflow-runtime operations.
    const runtime = createHatchetWorkflowRuntimeFromClient(client as never);
    const errors = await Promise.all([
      runtime.start('example.start.v1', {}).catch((error: unknown) => error),
      runtime.schedule('example.schedule.v1', {}, new Date('2026-07-21T12:00:00.000Z')).catch((error: unknown) => error),
      runtime.signal('example.signal.v1', 'run-1', 'continue', {}).catch((error: unknown) => error),
    ]);

    for (const error of errors) {
      expect(error).toMatchObject({ name: 'HatchetProviderError', status: 503 });
      const serialized = JSON.stringify(error, Object.getOwnPropertyNames(error as object));
      expect(serialized).not.toContain(secret);
      expect(serialized).not.toContain('Authorization');
    }
  });

  it('redacts synchronous provider throws before a Promise exists', async () => {
    const secret = 'sync-secret-that-must-not-escape';
    const client = {
      runNoWait: vi.fn(() => { throw Object.assign(new Error(secret), { status: 401 }); }),
      workflow: vi.fn(), events: { push: vi.fn() },
      runs: { get: vi.fn(), cancel: vi.fn() },
      cron: { list: vi.fn(), create: vi.fn(), delete: vi.fn() },
    };
    const runtime = createHatchetWorkflowRuntimeFromClient(client as never);
    const error = await runtime.start('example.start.v1', {}).catch((cause: unknown) => cause);
    expect(error).toMatchObject({ name: 'HatchetProviderError', status: 401 });
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error as object))).not.toContain(secret);
  });
});
