// typecast-file-boundary: Focused JetStream fixtures implement only the message and publisher surface exercised by the consumer.

import {
  type ApplicationTelemetryBoundary,
  type ApplicationTelemetryRuntime,
  installApplicationTelemetryRuntimeResolver,
} from '@applik8s/applik8s';
import { handleJetStreamEventMessage } from '@applik8s/runtime-nats/event-consumer';
import { StringCodec } from 'nats';
import { describe, expect, it, vi } from 'vitest';

const codec = StringCodec();

describe('durable JetStream event consumer', () => {
  it('acknowledges only after the publication authority resolves', async () => {
    const order: string[] = [];
    const execute = vi.fn(async () => { order.push('manifest'); });
    const message = fakeMessage(1, order);
    await expect(handleJetStreamEventMessage(message as never, publisher() as never, {
      bindings: [{ bindingId: 'history', contract: { name: 'post.created', version: 'v1' }, execute }],
      subjectPrefix: 'applik8s',
    })).resolves.toBe('acked');
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ id: 'event-1', payload: { id: 'post-1' } }));
    expect(order).toEqual(['manifest', 'ack']);
  });

  it('leaves the source unacknowledged until retry and dead-letters exhausted failures first', async () => {
    const retryOrder: string[] = [];
    const records: Readonly<Record<string, unknown>>[] = [];
    await expect(handleJetStreamEventMessage(fakeMessage(2, retryOrder) as never, publisher() as never, {
      bindings: [{ bindingId: 'history', contract: { name: 'post.created', version: 'v1' }, execute: async () => { throw new Error('token sk-private must not escape'); } }],
      subjectPrefix: 'applik8s', maxAttempts: 3, retryDelayMs: 10,
      logger: (record) => records.push(record),
    })).resolves.toBe('retried');
    expect(retryOrder).toEqual(['nak:20']);
    expect(records).toEqual([expect.objectContaining({
      event: 'applik8s-event-retry',
      errorType: 'Error',
    })]);
    expect(JSON.stringify(records)).not.toContain('sk-private');

    const terminalOrder: string[] = [];
    const published: unknown[] = [];
    await expect(handleJetStreamEventMessage(fakeMessage(3, terminalOrder) as never, publisher(published) as never, {
      bindings: [{ bindingId: 'history', contract: { name: 'post.created', version: 'v1' }, execute: async () => { throw new Error('credential private-terminal must not escape'); } }],
      subjectPrefix: 'applik8s', maxAttempts: 3,
    })).resolves.toBe('terminated');
    expect(published).toEqual([expect.objectContaining({
      subject: 'applik8s.dead-letter.history',
      body: expect.objectContaining({
        id: 'event-1:dead-letter',
        routing: expect.objectContaining({ failureType: 'Error' }),
      }),
    })]);
    expect(JSON.stringify(published)).not.toContain('private-terminal');
    expect(terminalOrder).toEqual(['term:applik8s event attempts exhausted']);
  });

  it('maps JetStream delivery count to the canonical event attempt', async () => {
    const boundaries: ApplicationTelemetryBoundary[] = [];
    const runtime: ApplicationTelemetryRuntime = {
      async run(boundary, execute) { boundaries.push(boundary); return execute(); },
      capture: () => undefined,
      log() {}, count() {}, record() {},
    };
    const dispose = installApplicationTelemetryRuntimeResolver(() => runtime);
    try {
      await handleJetStreamEventMessage(fakeMessage(4, []) as never, publisher() as never, {
        bindings: [{ bindingId: 'history', contract: { name: 'post.created', version: 'v1' }, async execute() {} }],
        subjectPrefix: 'applik8s', maxAttempts: 5,
      });
    } finally {
      dispose();
    }
    expect(boundaries).toEqual([
      expect.objectContaining({
        kind: 'event', identity: 'history', attempt: 4,
        invocation: 'retry', relationship: 'asynchronous',
        attributes: expect.objectContaining({ 'applik8s.event.transport': 'jetstream' }),
      }),
    ]);
  });
});

function envelope() {
  return { id: 'event-1', contract: { name: 'post.created', version: 'v1' }, payload: { id: 'post-1' }, recordedAt: '2026-08-20T12:00:00.000Z' };
}

function fakeMessage(deliveryCount: number, order: string[]) {
  return {
    data: codec.encode(JSON.stringify(envelope())), subject: 'applik8s.events.post-created.v1', info: { deliveryCount },
    ack() { order.push('ack'); }, nak(delay?: number) { order.push(`nak:${delay}`); }, term(reason?: string) { order.push(`term:${reason}`); },
  };
}

function publisher(records: unknown[] = []) {
  return {
    async publish(subject: string, data: Uint8Array, options?: { readonly msgID?: string }) {
      records.push({ subject, body: JSON.parse(codec.decode(data)), messageId: options?.msgID });
      return {};
    },
  };
}
