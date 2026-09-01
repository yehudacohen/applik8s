// typecast-file-boundary: Live database fixtures intentionally narrow driver
// rows and failure causes to verify durable saga recovery contracts.
import {
  ApplicationSagaExecutionError,
  app,
  createDurableApplicationSagaRuntime,
  installApplicationSagaRuntimeResolver,
} from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import postgres from 'postgres';
import { afterAll, describe, expect, test } from 'vitest';
import {
  createPostgresApplicationSagaStore,
  PostgresApplicationSagaLeaseBusyError,
  PostgresApplicationSagaLeaseLostError,
} from '../src/saga-store.js';

const databaseUrl = process.env.APPLIK8S_JOB_POSTGRES_URL;
const live = databaseUrl ? describe : describe.skip;

live('PostgreSQL Saga receipt store', () => {
  const applicationId = `saga-live-${crypto.randomUUID()}`;
  const stores: Array<{ close(): Promise<void> }> = [];

  afterAll(async () => {
    await Promise.all(stores.splice(0).map((store) => store.close()));
    if (!databaseUrl) return;
    const sql = postgres(databaseUrl, { max: 1 });
    try {
      await sql`DELETE FROM applik8s_saga_runs WHERE application_id = ${applicationId}`;
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  test('persists one compensating run and replays its terminal receipt across runtime instances', async () => {
    if (!databaseUrl) throw new Error('APPLIK8S_JOB_POSTGRES_URL is required.');
    const deploymentId = 'runtime-restart';
    const firstStore = createPostgresApplicationSagaStore({ databaseUrl, applicationId, deploymentId });
    stores.push(firstStore);
    const first = createDurableApplicationSagaRuntime({ store: firstStore, owner: 'worker-one' });
    const disposeFirst = installApplicationSagaRuntimeResolver(() => first);
    let effects = 0;
    let compensations = 0;
    const application = app('postgres-saga-runtime');
    const checkout = application.transaction.saga(
      'checkout.postgres.v1',
      { input: type({ orderId: 'string' }), output: type({ accepted: 'boolean' }) },
      async (_input, tx) => {
        await tx.step('reserve', async () => {
          effects += 1;
          return { reservationId: 'reservation-one' };
        }, {
          compensate: async () => { compensations += 1; },
        });
        throw new Error('checkout rejected');
      },
    );

    const firstFailure = await checkout({ orderId: 'one' }, { idempotencyKey: 'order-one' }).catch(error => error);
    expect(firstFailure).toBeInstanceOf(ApplicationSagaExecutionError);
    expect(firstFailure).toMatchObject({ code: 'SAGA_COMPENSATED' });
    disposeFirst();
    await firstStore.close();
    stores.splice(stores.indexOf(firstStore), 1);

    const replacementStore = createPostgresApplicationSagaStore({ databaseUrl, applicationId, deploymentId });
    stores.push(replacementStore);
    const replacement = createDurableApplicationSagaRuntime({ store: replacementStore, owner: 'worker-two' });
    const disposeReplacement = installApplicationSagaRuntimeResolver(() => replacement);
    try {
      await expect(checkout({ orderId: 'one' }, { idempotencyKey: 'order-one' }))
        .rejects.toMatchObject({ code: 'SAGA_COMPENSATED' });
      expect(effects).toBe(1);
      expect(compensations).toBe(1);
      await expect(replacementStore.inspect('checkout.postgres.v1:order-one')).resolves.toMatchObject({
        outcome: 'compensated',
        steps: [expect.objectContaining({ id: 'reserve', phase: 'compensated', compensationAttempts: 1 })],
      });
    } finally {
      disposeReplacement();
    }
  }, 20_000);

  test('fences concurrent and stale owners without rewriting the durable record', async () => {
    if (!databaseUrl) throw new Error('APPLIK8S_JOB_POSTGRES_URL is required.');
    const deploymentId = 'lease-fencing';
    const left = createPostgresApplicationSagaStore({ databaseUrl, applicationId, deploymentId });
    const right = createPostgresApplicationSagaStore({ databaseUrl, applicationId, deploymentId });
    stores.push(left, right);
    const initial = {
      schemaVersion: 'applik8s.sagaRecord/v1alpha1' as const,
      invocationId: 'lease.v1:one',
      saga: 'lease.v1',
      inputDigest: `sha256:${'1'.repeat(64)}` as const,
      definitionDigest: `sha256:${'2'.repeat(64)}` as const,
      outcome: 'running' as const,
      steps: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const claimed = await left.claim(initial, {
      owner: 'left',
      now: '2026-01-01T00:00:00.000Z',
      leaseSeconds: 30,
    });
    await expect(right.claim(initial, {
      owner: 'right',
      now: '2026-01-01T00:00:01.000Z',
      leaseSeconds: 30,
    })).rejects.toBeInstanceOf(PostgresApplicationSagaLeaseBusyError);
    const replacement = await right.claim(initial, {
      owner: 'right',
      now: '2026-01-01T00:00:31.000Z',
      leaseSeconds: 30,
    });
    expect(replacement.lease.epoch).toBeGreaterThan(claimed.lease.epoch);
    await expect(left.write({ ...initial, updatedAt: '2026-01-01T00:00:32.000Z' }, claimed.lease))
      .rejects.toBeInstanceOf(PostgresApplicationSagaLeaseLostError);
    await right.release(initial.invocationId, replacement.lease);
  }, 20_000);
});
