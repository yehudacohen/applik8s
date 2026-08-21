import { createApplicationEventLogPublisherFromEnvironment, type ApplicationEventLogPublisher } from '../src/event-log-runtime.js';
import { describe, expect, it } from 'vitest';

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
});

function publisher(stream: string): ApplicationEventLogPublisher {
  return {
    async verify() {},
    async publish(envelope, channel = 'events') { return { stream, sequence: '1', duplicate: false, subject: channel, messageId: envelope.id }; },
    async consumerLag() { return { pending: 0, ackPending: 0, redelivered: 0 }; },
    async drain() {},
  };
}
