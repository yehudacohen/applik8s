import { StringCodec } from 'nats';
import { describe, expect, it, vi } from 'vitest';
import type { ApplicationCommandObservation } from '../src/dsl.js';
import { consumeJetStreamCommandMessages, handleJetStreamCommandMessage } from '../src/model-command-processor-runtime.js';
import { DurableCommandRejectedError } from '../src/model-command-postgres-runtime.js';

const codec = StringCodec();

describe('generated JetStream command processor runtime', () => {
  it('acks only after the selected materialized binding commits', async () => {
    const calls: string[] = [];
    const message = fakeMessage(commandEnvelope(), 1, calls);
    const execute = vi.fn(async () => { calls.push('commit'); });

    await expect(handleJetStreamCommandMessage(message, fakeJetStream(), {
      bindings: [{ bindingId: 'Account-account.rename.v1', contract: { name: 'account.rename', version: 'v1' }, execute, recordTerminalFailure: async () => undefined }],
      subjectPrefix: 'applik8s',
    })).resolves.toBe('acked');

    expect(execute).toHaveBeenCalledWith({ accountId: 'account-1', displayName: 'Grace' }, expect.objectContaining({ id: 'message-1', attempt: 1, recordedAt: '2026-07-10T12:00:00.000Z', expectedRevision: 'revision-expected', targetKey: 'routed-account', idempotencyKey: 'outbox-request' }));
    expect(calls).toEqual(['commit', 'ack']);
  });

  it('naks retryable failures with bounded exponential delay', async () => {
    const calls: string[] = [];
    const message = fakeMessage(commandEnvelope(), 3, calls);

    await expect(handleJetStreamCommandMessage(message, fakeJetStream(), {
      bindings: [{ bindingId: 'Account-account.rename.v1', contract: { name: 'account.rename', version: 'v1' }, execute: async () => { throw new Error('database unavailable'); }, recordTerminalFailure: async () => undefined }],
      subjectPrefix: 'applik8s',
      maxAttempts: 5,
      retryDelayMs: 100,
      maxRetryDelayMs: 1_000,
    })).resolves.toBe('retried');

    expect(calls).toEqual(['nak:400']);
  });

  it('acks durable domain rejections instead of retrying expected application decisions', async () => {
    const calls: string[] = [];
    const logs: Readonly<Record<string, unknown>>[] = [];
    const message = fakeMessage(commandEnvelope(), 2, calls);

    await expect(handleJetStreamCommandMessage(message, fakeJetStream(), {
      bindings: [{
        bindingId: 'Account-account.rename.v1',
        contract: { name: 'account.rename', version: 'v1' },
        execute: async () => { throw new DurableCommandRejectedError({ name: 'accountClosed', payload: { accountId: 'account-1' } }, true, commandObservation('rejected', true)); },
        recordTerminalFailure: async () => undefined,
      }],
      subjectPrefix: 'applik8s',
      logger: (record) => logs.push(record),
    })).resolves.toBe('acked');

    expect(calls).toEqual(['ack']);
    expect(logs).toContainEqual(expect.objectContaining({ event: 'applik8s-command-rejected', replayed: true, rejection: { name: 'accountClosed', payload: { accountId: 'account-1' } }, observation: commandObservation('rejected', true) }));
  });

  it('logs the durable command observation after commit and before acknowledging delivery', async () => {
    const calls: string[] = [];
    const logs: Readonly<Record<string, unknown>>[] = [];
    const observation = commandObservation('completed', false);
    const message = fakeMessage(commandEnvelope(), 1, calls);

    await expect(handleJetStreamCommandMessage(message, fakeJetStream(), {
      bindings: [{ bindingId: 'Account-account.rename.v1', contract: { name: 'account.rename', version: 'v1' }, execute: async () => ({ observation }), recordTerminalFailure: async () => undefined }],
      subjectPrefix: 'applik8s',
      logger: (record) => logs.push(record),
    })).resolves.toBe('acked');

    expect(logs).toContainEqual(expect.objectContaining({ event: 'applik8s-command-processed', observation }));
    expect(calls).toEqual(['ack']);
  });

  it('publishes a stable dead letter before terminating exhausted delivery', async () => {
    const calls: string[] = [];
    const published: { subject: string; body: unknown; messageId?: string }[] = [];
    const message = fakeMessage(commandEnvelope(), 5, calls);

    await expect(handleJetStreamCommandMessage(message, fakeJetStream(published), {
      bindings: [{ bindingId: 'Account-account.rename.v1', contract: { name: 'account.rename', version: 'v1' }, execute: async () => { throw new Error('constraint failed'); }, recordTerminalFailure: async (_input, _delivery, failure) => { calls.push(`record:${failure.code}:${failure.attempts}`); } }],
      subjectPrefix: 'applik8s',
      maxAttempts: 5,
    })).resolves.toBe('terminated');

    expect(published).toEqual([expect.objectContaining({ subject: 'applik8s.dead-letter.account-account-rename-v1', messageId: 'message-1:dead-letter', body: expect.objectContaining({ id: 'message-1:dead-letter', causationId: 'message-1' }) })]);
    expect(calls).toEqual(['record:processing_failed:5', 'term:applik8s command attempts exhausted']);
  });

  it('does not terminate an exhausted delivery until its durable failure result is recorded', async () => {
    const calls: string[] = [];
    const published: { subject: string; body: unknown; messageId?: string }[] = [];
    const message = fakeMessage(commandEnvelope(), 5, calls);
    await expect(handleJetStreamCommandMessage(message, fakeJetStream(published), {
      bindings: [{
        bindingId: 'Account-account.rename.v1', contract: { name: 'account.rename', version: 'v1' },
        execute: async () => { throw new Error('constraint failed'); },
        recordTerminalFailure: async () => { throw new Error('result database unavailable'); },
      }],
      subjectPrefix: 'applik8s', maxAttempts: 5,
    })).rejects.toThrow(/result database unavailable/);
    expect(published).toHaveLength(1);
    expect(calls).toEqual([]);
  });

  it('fails malformed and ambiguously routed messages closed without invoking handlers', async () => {
    const malformedCalls: string[] = [];
    const malformed = fakeMessage({ nope: true }, 1, malformedCalls);
    const execute = vi.fn(async () => undefined);
    // typecast: preserve literal binding identifiers so this fixture matches the public processor contract.
    const options = {
      bindings: [{ bindingId: 'Account-account.rename.v1', contract: { name: 'account.rename', version: 'v1' }, execute, recordTerminalFailure: async () => undefined }],
      subjectPrefix: 'applik8s',
    } as const;

    await expect(handleJetStreamCommandMessage(malformed, fakeJetStream(), options)).resolves.toBe('terminated');
    const mismatchedCalls: string[] = [];
    const mismatched = fakeMessage({ ...commandEnvelope(), routing: { binding: 'Other-binding' } }, 1, mismatchedCalls);
    await expect(handleJetStreamCommandMessage(mismatched, fakeJetStream(), options)).resolves.toBe('terminated');

    expect(execute).not.toHaveBeenCalled();
    expect(malformedCalls).toEqual(['term:invalid applik8s command envelope']);
    expect(mismatchedCalls).toEqual(['term:unknown applik8s command binding']);
  });

  it('runs different deliveries with bounded concurrency and waits for every in-flight commit', async () => {
    let active = 0;
    let maximum = 0;
    const completed: string[] = [];
    const values = ['one', 'two', 'three', 'four'];
    const messages = values.map((id) => fakeMessage({ ...commandEnvelope(), id }, 1, []));
    const stream = {
      async *[Symbol.asyncIterator]() {
        for (const message of messages) yield message;
      },
    };
    const connection = { isClosed: () => false, flush: vi.fn(async () => undefined) };
    await consumeJetStreamCommandMessages(
      // typecast: the focused async-iterable fixture supplies the message surface consumed by the runtime.
      stream as never,
      // typecast: the runtime only requires isClosed and flush from this focused connection fixture.
      connection as never,
      // typecast: dead-letter publication is not reached in this successful-concurrency fixture.
      fakeJetStream() as never,
      {
        bindings: [{
          bindingId: 'Account-account.rename.v1',
          contract: { name: 'account.rename', version: 'v1' },
          async execute(_input, delivery) {
            active += 1;
            maximum = Math.max(maximum, active);
            await new Promise((resolve) => setTimeout(resolve, 10));
            completed.push(delivery.id);
            active -= 1;
          },
          async recordTerminalFailure() {},
        }],
        servers: [],
        stream: 'APPLIK8S_EVENTS',
        consumer: 'account-commands',
        subjectPrefix: 'applik8s',
        concurrency: 2,
      },
    );

    expect(maximum).toBe(2);
    expect(completed.sort()).toEqual([...values].sort());
    expect(connection.flush).toHaveBeenCalledOnce();
  });
});

function commandEnvelope(): object {
  return {
    id: 'message-1',
    contract: { name: 'account.rename', version: 'v1' },
    payload: { accountId: 'account-1', displayName: 'Grace' },
    partitionKey: 'accountId=account-1',
    recordedAt: '2026-07-10T12:00:00.000Z',
    expectedRevision: 'revision-expected',
    routing: { binding: 'Account-account.rename.v1', targetKey: 'routed-account', idempotencyKey: 'outbox-request' },
  };
}

function commandObservation(phase: 'completed' | 'rejected', replayed: boolean): ApplicationCommandObservation {
  return {
    commandId: 'message-1',
    correlationId: 'message-1',
    target: { model: 'Account', key: 'account-1' },
    phase,
    replayed,
    resultRevision: 'result-revision-1',
    stateRevision: { authority: 'model', model: 'Account', target: 'account-1', revision: 'revision-1' },
  };
}

function fakeMessage(value: object, deliveryCount: number, calls: string[]) {
  return {
    data: codec.encode(JSON.stringify(value)),
    subject: 'applik8s.commands.account-rename.v1.account-1',
    // typecast: the processor reads only deliveryCount from NATS DeliveryInfo in this focused fixture.
    info: { deliveryCount } as never,
    ack: () => calls.push('ack'),
    nak: (delay?: number) => calls.push(`nak:${delay}`),
    term: (reason?: string) => calls.push(`term:${reason}`),
  };
}

function fakeJetStream(published: { subject: string; body: unknown; messageId?: string }[] = []) {
  return {
    async publish(subject: string, data: Uint8Array, options?: { readonly msgID?: string }) {
      published.push({ subject, body: JSON.parse(codec.decode(data)), ...(options?.msgID ? { messageId: options.msgID } : {}) });
      // typecast: the processor ignores PubAck contents after durable dead-letter publication succeeds.
      return {} as never;
    },
  };
}
