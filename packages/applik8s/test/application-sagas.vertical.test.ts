import {
  ApplicationSagaBoundaryError,
  ApplicationSagaExecutionError,
  ApplicationSagaOutcomeUnknownError,
  app,
  applicationGraphFor,
  createDeterministicApplicationSagaRuntime,
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
