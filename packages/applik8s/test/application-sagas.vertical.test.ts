import {
  ApplicationSagaBoundaryError,
  ApplicationSagaExecutionError,
  ApplicationSagaOutcomeUnknownError,
  type ApplicationSagaDurableLease,
  type ApplicationSagaDurableRecord,
  type ApplicationSagaDurableStore,
  app,
  applicationGraphFor,
  createDeterministicApplicationSagaRuntime,
  createDurableApplicationSagaRuntime,
  installApplicationSagaRuntimeResolver,
} from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import { validateApplicationGraphStructure } from '@applik8s/core';
import { afterEach, describe, expect, it } from 'vitest';

const disposers: Array<() => void> = [];

afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose();
});

describe('v0.9 compensating Saga coordination', () => {
  it('records the provider-neutral Saga and its stable ordered boundaries', () => {
    const application = app('checkout-saga-contract');
    application.transaction.saga(
      'checkout.v1',
      {
        input: type({ orderId: 'string' }),
        output: type({ committed: 'boolean' }),
      },
      { deadline: '10m', recoveryDeadline: '12h' },
      async (_input, tx) => {
        const reservation = await tx.step(
          'reserve-inventory',
          async () => ({ id: 'reservation' }),
          { compensate: async () => undefined },
        );
        await tx.commit('create-order', async () => ({ id: reservation.id }));
        await tx.irreversible(
          'send-legal-notice',
          async () => ({ sent: true }),
          { reason: 'The external notice cannot be recalled.' },
        );
        return { committed: true };
      },
    );

    const graph = applicationGraphFor(application.composition);
    expect(graph?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'saga',
        name: 'checkout.v1',
        maturity: 'beta',
        atomicity: 'compensatingNoIsolation',
        deadlineSeconds: 600,
        recoveryDeadlineSeconds: 43_200,
        steps: [
          expect.objectContaining({ id: 'reserve-inventory', kind: 'step', order: 0, compensation: 'required' }),
          expect.objectContaining({ id: 'create-order', kind: 'commit', order: 1, compensation: 'forbidden' }),
          expect.objectContaining({ id: 'send-legal-notice', kind: 'irreversible', order: 2, compensation: 'forbidden' }),
        ],
      }),
    ]));
    expect(graph?.providerRequirements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        interface: 'WorkflowEngine',
        purpose: 'workflowEngine',
        consumer: { nodeId: 'saga.checkout.v1' },
      }),
    ]));
    expect(graph && validateApplicationGraphStructure(graph).filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
  });

  it('compensates the open frontier in reverse order and never crosses a commit', async () => {
    const runtime = createDeterministicApplicationSagaRuntime();
    disposers.push(installApplicationSagaRuntimeResolver(() => runtime));
    const events: string[] = [];
    const application = app('checkout-saga-runtime');
    const checkout = application.transaction.saga(
      'checkout.runtime.v1',
      { input: type({ fail: 'boolean' }), output: type({ committed: 'boolean' }) },
      async (input, tx) => {
        await tx.step('before-commit', async () => ({ id: 'before' }), {
          compensate: async result => { events.push(`undo:${result.id}`); },
        });
        await tx.commit('accept-order', async () => ({ id: 'order' }));
        await tx.step('after-commit-one', async () => ({ id: 'one' }), {
          compensate: async result => { events.push(`undo:${result.id}`); },
        });
        await tx.step('after-commit-two', async () => ({ id: 'two' }), {
          compensate: async result => { events.push(`undo:${result.id}`); },
        });
        if (input.fail) throw new Error('after commit failed');
        return { committed: true };
      },
    );

    await expect(checkout({ fail: true }, { idempotencyKey: 'failure' }))
      .rejects.toMatchObject({ code: 'SAGA_COMPENSATED' });
    expect(events).toEqual(['undo:two', 'undo:one']);
    expect(runtime.inspect('checkout.runtime.v1:failure')).toMatchObject({
      outcome: 'compensated',
      steps: expect.arrayContaining([
        expect.objectContaining({ id: 'before-commit', phase: 'committed' }),
        expect.objectContaining({ id: 'after-commit-one', phase: 'compensated' }),
        expect.objectContaining({ id: 'after-commit-two', phase: 'compensated' }),
      ]),
    });
  });

  it('holds unknown commit outcomes without compensating and resumes only after observation', async () => {
    const runtime = createDeterministicApplicationSagaRuntime();
    disposers.push(installApplicationSagaRuntimeResolver(() => runtime));
    const events: string[] = [];
    let observed: 'unknown' | 'committed' = 'unknown';
    let attempts = 0;
    const application = app('unknown-saga-runtime');
    const checkout = application.transaction.saga(
      'checkout.unknown.v1',
      { input: type({ orderId: 'string' }), output: type({ orderId: 'string' }) },
      async (input, tx) => {
        await tx.step('reserve', async () => ({ id: 'reservation' }), {
          compensate: async () => { events.push('compensated'); },
        });
        const order = await tx.commit<{ id: string }>(
          'create-order',
          async () => {
            attempts += 1;
            throw new ApplicationSagaOutcomeUnknownError('connection lost after provider acceptance', { id: input.orderId });
          },
          { observe: async () => observed },
        );
        return { orderId: order.id };
      },
    );

    await expect(checkout({ orderId: 'order-1' }, { idempotencyKey: 'unknown' }))
      .rejects.toMatchObject({ code: 'SAGA_OUTCOME_UNKNOWN' });
    expect(events).toEqual([]);
    expect(runtime.inspect('checkout.unknown.v1:unknown')).toMatchObject({
      outcome: 'outcomeUnknown',
      steps: expect.arrayContaining([expect.objectContaining({ id: 'create-order', phase: 'unknown' })]),
    });

    observed = 'committed';
    await expect(checkout({ orderId: 'order-1' }, { idempotencyKey: 'unknown' }))
      .resolves.toEqual({ orderId: 'order-1' });
    expect(attempts).toBe(1);
    expect(events).toEqual([]);
  });

  it('fails registration for dynamic or duplicate durable step identities', () => {
    const application = app('invalid-saga-contract');
    expect(() => application.transaction.saga(
      'dynamic.v1',
      { input: type({ id: 'string' }), output: type({ ok: 'boolean' }) },
      async (input, tx) => {
        await tx.commit(input.id, async () => ({ ok: true }));
        return { ok: true };
      },
    )).toThrow('statically discoverable string literals');

    expect(() => application.transaction.saga(
      'duplicate.v1',
      { input: type({ id: 'string' }), output: type({ ok: 'boolean' }) },
      async (_input, tx) => {
        await tx.step('same-step', async () => ({ ok: true }), { compensate: async () => undefined });
        await tx.commit('same-step', async () => ({ ok: true }));
        return { ok: true };
      },
    )).toThrow('SAGA_STEP_ID_CONFLICT');
  });

  it('surfaces failed compensation as a distinct durable terminal outcome', async () => {
    const runtime = createDeterministicApplicationSagaRuntime();
    disposers.push(installApplicationSagaRuntimeResolver(() => runtime));
    const application = app('failed-compensation-runtime');
    const saga = application.transaction.saga(
      'compensation.failure.v1',
      { input: type({ id: 'string' }), output: type({ ok: 'boolean' }) },
      async (_input, tx) => {
        await tx.step('effect', async () => ({ id: 'effect' }), {
          compensate: async () => { throw new Error('provider unavailable'); },
        });
        throw new Error('forward failure');
      },
    );

    const failure = await saga({ id: 'one' }, { idempotencyKey: 'compensation' }).catch(error => error);
    expect(failure).toBeInstanceOf(ApplicationSagaExecutionError);
    expect(failure).toMatchObject({ code: 'SAGA_COMPENSATION_FAILED' });
    expect(runtime.inspect('compensation.failure.v1:compensation')).toMatchObject({
      outcome: 'compensationFailed',
      steps: [expect.objectContaining({ phase: 'compensationFailed', compensationAttempts: 1 })],
    });
  });

  it('retries an interrupted durable compensation without re-running the forward effect', async () => {
    const store = new MemorySagaStore();
    let interruptAfterCompensationIntent = true;
    store.beforeWriteReturn = (record) => {
      if (
        interruptAfterCompensationIntent
        && record.steps.some((step) => step.phase === 'compensating')
      ) {
        interruptAfterCompensationIntent = false;
        throw new Error('simulated worker loss after durable compensation intent');
      }
    };
    const firstRuntime = createDurableApplicationSagaRuntime({
      store,
      owner: 'worker-one',
      leaseSeconds: 30,
    });
    disposers.push(installApplicationSagaRuntimeResolver(() => firstRuntime));
    let forwardAttempts = 0;
    let compensationAttempts = 0;
    const application = app('durable-compensation-recovery');
    const saga = application.transaction.saga(
      'durable.compensation.v1',
      { input: type({ id: 'string' }), output: type({ ok: 'boolean' }) },
      async (_input, tx) => {
        await tx.step('reserve', async () => {
          forwardAttempts += 1;
          return { reservationId: 'reservation-one' };
        }, {
          compensate: async () => {
            compensationAttempts += 1;
          },
        });
        throw new Error('force compensation');
      },
    );

    await expect(saga({ id: 'one' }, { idempotencyKey: 'recovery' }))
      .rejects.toThrow('simulated worker loss');
    expect(await store.inspect('durable.compensation.v1:recovery')).toMatchObject({
      outcome: 'running',
      steps: [expect.objectContaining({ phase: 'compensating', compensationAttempts: 1 })],
    });

    disposers.pop()?.();
    const replacementRuntime = createDurableApplicationSagaRuntime({
      store,
      owner: 'worker-two',
      leaseSeconds: 30,
    });
    disposers.push(installApplicationSagaRuntimeResolver(() => replacementRuntime));
    await expect(saga({ id: 'one' }, { idempotencyKey: 'recovery' }))
      .rejects.toMatchObject({ code: 'SAGA_COMPENSATED' });
    expect(forwardAttempts).toBe(1);
    expect(compensationAttempts).toBe(1);
    expect(await store.inspect('durable.compensation.v1:recovery')).toMatchObject({
      outcome: 'compensated',
      steps: [expect.objectContaining({ phase: 'compensated', compensationAttempts: 2 })],
    });
  });

  it('recovers an invoked effect only through an authored observer with a typed result', async () => {
    const store = new MemorySagaStore();
    let interruptAfterInvocationIntent = true;
    store.beforeWriteReturn = (record) => {
      if (
        interruptAfterInvocationIntent
        && record.steps.some((step) => step.phase === 'invoked')
      ) {
        interruptAfterInvocationIntent = false;
        throw new Error('simulated worker loss after durable invocation intent');
      }
    };
    const firstRuntime = createDurableApplicationSagaRuntime({
      store,
      owner: 'observer-worker-one',
      leaseSeconds: 30,
    });
    disposers.push(installApplicationSagaRuntimeResolver(() => firstRuntime));
    let effects = 0;
    let observations = 0;
    const application = app('durable-observer-recovery');
    const saga = application.transaction.saga(
      'durable.observer.v1',
      { input: type({ id: 'string' }), output: type({ reservationId: 'string' }) },
      async (_input, tx) => {
        const reservation = await tx.step('reserve', async () => {
          effects += 1;
          return { reservationId: 'forward-result' };
        }, {
          compensate: async () => undefined,
          observe: async (result) => {
            observations += 1;
            return result
              ? { status: 'committed', result }
              : { status: 'committed', result: { reservationId: 'observed-result' } };
          },
        });
        return reservation;
      },
    );

    await expect(saga({ id: 'one' }, { idempotencyKey: 'observer' }))
      .rejects.toThrow('simulated worker loss');
    expect(effects).toBe(0);
    expect(await store.inspect('durable.observer.v1:observer')).toMatchObject({
      outcome: 'running',
      steps: [expect.objectContaining({ phase: 'invoked' })],
    });

    disposers.pop()?.();
    const replacementRuntime = createDurableApplicationSagaRuntime({
      store,
      owner: 'observer-worker-two',
      leaseSeconds: 30,
    });
    disposers.push(installApplicationSagaRuntimeResolver(() => replacementRuntime));
    await expect(saga({ id: 'one' }, { idempotencyKey: 'observer' }))
      .resolves.toEqual({ reservationId: 'observed-result' });
    expect(effects).toBe(0);
    expect(observations).toBe(1);
  });

  it('rejects Saga effects outside a boundary and nested compensation authorities', async () => {
    const runtime = createDeterministicApplicationSagaRuntime();
    disposers.push(installApplicationSagaRuntimeResolver(() => runtime));
    const application = app('nested-saga-runtime');
    const child = application.transaction.saga(
      'child.v1',
      { input: type({ id: 'string' }), output: type({ ok: 'boolean' }) },
      async () => ({ ok: true }),
    );
    const outside = application.transaction.saga(
      'outside.v1',
      { input: type({ id: 'string' }), output: type({ ok: 'boolean' }) },
      async input => child(input),
    );
    const nested = application.transaction.saga(
      'nested.v1',
      { input: type({ id: 'string' }), output: type({ ok: 'boolean' }) },
      async (input, tx) => tx.commit('nested-child', () => child(input)),
    );

    const outsideFailure = await outside({ id: 'one' }).catch(error => error);
    expect(outsideFailure).toBeInstanceOf(ApplicationSagaExecutionError);
    expect(outsideFailure.cause).toBeInstanceOf(ApplicationSagaBoundaryError);
    expect(outsideFailure.cause).toMatchObject({ code: 'SAGA_EFFECT_OUTSIDE_BOUNDARY' });

    const nestedFailure = await nested({ id: 'one' }).catch(error => error);
    expect(nestedFailure).toBeInstanceOf(ApplicationSagaExecutionError);
    expect(nestedFailure.cause).toBeInstanceOf(ApplicationSagaBoundaryError);
    expect(nestedFailure.cause).toMatchObject({ code: 'SAGA_NESTING_UNSUPPORTED' });
  });
});

class MemorySagaStore implements ApplicationSagaDurableStore {
  readonly records = new Map<string, ApplicationSagaDurableRecord>();
  readonly leases = new Map<string, ApplicationSagaDurableLease>();
  beforeWriteReturn?: (record: ApplicationSagaDurableRecord) => void;

  async claim(
    initial: ApplicationSagaDurableRecord,
    request: { readonly owner: string; readonly now: string; readonly leaseSeconds: number },
  ): Promise<{ readonly record: ApplicationSagaDurableRecord; readonly lease: ApplicationSagaDurableLease }> {
    const previousLease = this.leases.get(initial.invocationId);
    if (previousLease && Date.parse(previousLease.expiresAt) > Date.parse(request.now) && previousLease.owner !== request.owner) {
      throw new Error('SAGA_LEASE_BUSY');
    }
    const lease = {
      owner: request.owner,
      epoch: (previousLease?.epoch ?? 0) + 1,
      expiresAt: new Date(Date.parse(request.now) + request.leaseSeconds * 1_000).toISOString(),
    };
    const record = structuredClone(this.records.get(initial.invocationId) ?? initial);
    this.records.set(initial.invocationId, structuredClone(record));
    this.leases.set(initial.invocationId, lease);
    return { record, lease };
  }

  async write(record: ApplicationSagaDurableRecord, lease: ApplicationSagaDurableLease): Promise<ApplicationSagaDurableLease> {
    this.assertLease(record.invocationId, lease);
    this.records.set(record.invocationId, structuredClone(record));
    this.beforeWriteReturn?.(record);
    return lease;
  }

  async heartbeat(
    lease: ApplicationSagaDurableLease,
    invocationId: string,
    now: string,
    leaseSeconds: number,
  ): Promise<ApplicationSagaDurableLease> {
    this.assertLease(invocationId, lease);
    const next = {
      ...lease,
      expiresAt: new Date(Date.parse(now) + leaseSeconds * 1_000).toISOString(),
    };
    this.leases.set(invocationId, next);
    return next;
  }

  async release(invocationId: string, lease: ApplicationSagaDurableLease): Promise<void> {
    const current = this.leases.get(invocationId);
    if (!current) return;
    this.assertLease(invocationId, lease);
    this.leases.delete(invocationId);
  }

  async inspect(invocationId: string): Promise<ApplicationSagaDurableRecord | undefined> {
    const record = this.records.get(invocationId);
    return record ? structuredClone(record) : undefined;
  }

  private assertLease(invocationId: string, lease: ApplicationSagaDurableLease): void {
    const current = this.leases.get(invocationId);
    if (!current || current.owner !== lease.owner || current.epoch !== lease.epoch) {
      throw new Error(`SAGA_LEASE_LOST:${invocationId}:${current?.owner ?? 'none'}/${current?.epoch ?? 0}:${lease.owner}/${lease.epoch}`);
    }
  }
}
