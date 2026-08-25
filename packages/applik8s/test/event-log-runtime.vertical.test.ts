import { createApplicationTelemetryEnvelopeV1 } from '@applik8s/core';
import { describe, expect, it } from 'vitest';
import {
  type ApplicationTelemetryBoundary,
  type ApplicationTelemetryRuntime,
  installApplicationTelemetryRuntimeResolver,
} from '../src/application-telemetry-runtime.js';
import {
  type ApplicationEventLogPublisher,
  createApplicationEventLogPublisherFromEnvironment,
  executeApplicationEventConsumerBinding,
} from '../src/event-log-runtime.js';

describe('target-selected event-log runtime', () => {
  it('hydrates Kinesis lazily without consulting JetStream configuration', async () => {
    const calls: unknown[] = [];
    const runtime = createApplicationEventLogPublisherFromEnvironment({
      connectionName: 'processor.posts',
      environment: {
        APPLIK8S_EVENT_TRANSPORT: 'kinesis',
        APPLIK8S_KINESIS_STREAM: 'posts-events',
        APPLIK8S_KINESIS_CHECKPOINT_TABLE: 'posts-checkpoints',
        AWS_REGION: 'us-east-1',
      },
    }, {
      async nats() { throw new Error('JetStream must not load for an AWS binding.'); },
      async kinesis(options) { calls.push(options); return publisher('kinesis'); },
    });
    expect(calls).toEqual([]);
    await runtime.verify();
    await runtime.consumerLag('posts');
    expect(calls).toEqual([{ streamName: 'posts-events', checkpointTable: 'posts-checkpoints', region: 'us-east-1' }]);
  });

  it('uses authored JetStream defaults for direct calls and fails closed on incomplete bindings', async () => {
    const calls: unknown[] = [];
    const runtime = createApplicationEventLogPublisherFromEnvironment({
      connectionName: 'direct.posts',
      environment: {},
      nats: { servers: ['nats://events:4222'], stream: 'POSTS', subjectPrefix: 'posts' },
    }, {
      async nats(options) { calls.push(options); return publisher('nats'); },
      async kinesis() { throw new Error('Kinesis must not load for a direct JetStream binding.'); },
    });
    await runtime.verify();
    expect(calls).toEqual([{
      servers: ['nats://events:4222'], stream: 'POSTS', subjectPrefix: 'posts', connectionName: 'direct.posts',
    }]);
    await expect(createApplicationEventLogPublisherFromEnvironment({
      connectionName: 'broken', environment: { APPLIK8S_EVENT_TRANSPORT: 'kinesis' },
    }, {
      async nats() { return publisher('nats'); }, async kinesis() { return publisher('kinesis'); },
    }).verify()).rejects.toThrow(/APPLIK8S_KINESIS_STREAM/u);
  });

  it('owns one retry-aware event boundary and discards malformed producer telemetry', async () => {
    const boundaries: ApplicationTelemetryBoundary[] = [];
    const active: Array<ReturnType<typeof producerCarrier> | undefined> = [];
    const runtime: ApplicationTelemetryRuntime = {
      async run(boundary, execute) {
        boundaries.push(boundary);
        active.push(producerCarrier(boundary.identity, boundary.execution ?? boundary.identity, boundary.attempt ?? 1));
        try { return await execute(); } finally { active.pop(); }
      },
      capture: () => active.at(-1),
      log() {}, count() {}, record() {},
    };
    const dispose = installApplicationTelemetryRuntimeResolver(() => runtime);
    const producer = producerCarrier('model:posts.create', 'model:event-1', 1);
    const observed: unknown[] = [];
    const binding = {
      bindingId: 'lakehouse-posts',
      contract: { name: 'post.created', version: 'v1' },
      async execute(envelope: { readonly telemetry?: unknown }) {
        observed.push({ envelope, active: runtime.capture() });
      },
    };
    try {
      await executeApplicationEventConsumerBinding(binding, {
        id: 'event-1', contract: binding.contract, payload: { id: 'post-1' },
        recordedAt: '2026-08-25T12:00:00.000Z', telemetry: producer,
      }, { attempt: 2, transport: 'kinesis' });
      await executeApplicationEventConsumerBinding(binding, {
        id: 'event-2', contract: binding.contract, payload: { id: 'post-2' },
        recordedAt: '2026-08-25T12:00:00.000Z', telemetry: { traceparent: 'caller-authored' } as never,
      }, { attempt: 1, transport: 'jetstream' });
    } finally {
      dispose();
    }

    expect(boundaries).toEqual([
      expect.objectContaining({
        kind: 'event', identity: 'lakehouse-posts',
        execution: 'event:lakehouse-posts:event-1', definition: 'post.created.v1',
        instance: 'event-1', occurrence: 'event-1', attempt: 2,
        invocation: 'retry', relationship: 'asynchronous', links: [producer],
        attributes: { 'applik8s.event.contract': 'post.created.v1', 'applik8s.event.transport': 'kinesis' },
      }),
      expect.objectContaining({
        execution: 'event:lakehouse-posts:event-2', attempt: 1,
        invocation: 'live', links: [],
      }),
    ]);
    expect(observed[0]).toEqual(expect.objectContaining({
      envelope: expect.objectContaining({ telemetry: producer }),
      active: expect.objectContaining({ identity: expect.objectContaining({ operation: 'lakehouse-posts', attempt: 2 }) }),
    }));
    expect(observed[1]).toEqual(expect.objectContaining({ envelope: expect.not.objectContaining({ telemetry: expect.anything() }) }));
  });

  it('rejects invalid attempt metadata before executing application work', async () => {
    let executed = false;
    await expect(executeApplicationEventConsumerBinding({
      bindingId: 'events', contract: { name: 'post.created', version: 'v1' },
      async execute() { executed = true; },
    }, {
      id: 'event-1', contract: { name: 'post.created', version: 'v1' },
      payload: {}, recordedAt: '2026-08-25T12:00:00.000Z',
    }, { attempt: 0, transport: 'jetstream' })).rejects.toThrow(/positive safe integer/u);
    expect(executed).toBe(false);
  });
});

function producerCarrier(operation: string, execution: string, attempt: number) {
  return createApplicationTelemetryEnvelopeV1({
    traceparent: `00-0123456789abcdef0123456789abcdef-${String(attempt).padStart(16, '0')}-01`,
    identity: {
      application: 'event-runtime', environment: 'test', target: 'local',
      operation, execution, attempt,
    },
  });
}

function publisher(stream: string): ApplicationEventLogPublisher {
  return {
    async verify() {},
    async publish(envelope, channel = 'events') { return { stream, sequence: '1', duplicate: false, subject: channel, messageId: envelope.id }; },
    async consumerLag() { return { pending: 0, ackPending: 0, redelivered: 0 }; },
    async drain() {},
  };
}
