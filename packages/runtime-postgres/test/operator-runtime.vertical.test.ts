import { describe, expect, test, vi } from 'vitest';
import {
  createPostgresApplicationOperatorRuntime,
  type PostgresApplicationOperatorWorkItem,
} from '../src/operator-runtime.js';

function workItem(
  model: string,
  results: Array<'idle' | 'reconciled' | 'finalized' | 'failed'>,
): PostgresApplicationOperatorWorkItem & { readonly resync: ReturnType<typeof vi.fn> } {
  const resync = vi.fn(async () => 1);
  return {
    model,
    resyncIntervalSeconds: 60,
    maximumResyncItems: 50,
    resync,
    requestResync: resync,
    async reconcileOnce() {
      return { kind: results.shift() ?? 'idle' };
    },
  };
}

describe('PostgreSQL OperatorRuntime', () => {
  test('runs managed models fairly with bounded concurrency and persisted resync admission', async () => {
    const first = workItem('First', ['reconciled', 'idle']);
    const second = workItem('Second', ['finalized', 'idle']);
    const runtime = createPostgresApplicationOperatorRuntime({
      work: [first, second],
      maximumConcurrency: 1,
      maximumWorkPerTick: 1,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });

    await expect(runtime.runOnce()).resolves.toMatchObject({ attempted: 1, progressed: 1 });
    await expect(runtime.runOnce()).resolves.toMatchObject({ attempted: 1, progressed: 1 });
    expect(first.resync).toHaveBeenCalledOnce();
    expect(second.resync).toHaveBeenCalledOnce();
    expect(runtime.snapshot()).toMatchObject({
      state: 'idle',
      reconciled: 1,
      finalized: 1,
      failed: 0,
      resyncs: 2,
    });
    await runtime.close();
  });

  test('stops an active poll loop without converting cancellation into runtime failure', async () => {
    const runtime = createPostgresApplicationOperatorRuntime({
      work: [workItem('Workspace', ['idle'])],
      idlePollMilliseconds: 60_000,
    });
    const running = runtime.start();
    await vi.waitFor(() => expect(runtime.snapshot().state).toBe('running'));
    await runtime.close();
    await running;
    expect(runtime.snapshot()).toMatchObject({ state: 'closed', failed: 0 });
  });

  test('uses bounded parallel claims even when one model owns all pending identities', async () => {
    let active = 0;
    let maximumActive = 0;
    let calls = 0;
    const item: PostgresApplicationOperatorWorkItem = {
      model: 'Workspace',
      resyncIntervalSeconds: 60,
      maximumResyncItems: 50,
      requestResync: async () => 0,
      async reconcileOnce() {
        calls += 1;
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise(resolve => setTimeout(resolve, 5));
        active -= 1;
        return { kind: 'reconciled' };
      },
    };
    const runtime = createPostgresApplicationOperatorRuntime({
      work: [item],
      maximumConcurrency: 3,
      maximumWorkPerTick: 3,
    });
    await expect(runtime.runOnce()).resolves.toMatchObject({ attempted: 3, progressed: 3 });
    expect(calls).toBe(3);
    expect(maximumActive).toBe(3);
    await runtime.close();
  });

  test('rejects duplicate model ownership and invalid capacity', () => {
    const first = workItem('Workspace', []);
    expect(() => createPostgresApplicationOperatorRuntime({ work: [first, first] }))
      .toThrow(/one work item per managed model/);
    expect(() => createPostgresApplicationOperatorRuntime({ work: [first], maximumConcurrency: 0 }))
      .toThrow(/positive integer/);
  });
});
