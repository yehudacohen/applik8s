import { AckPolicy, connect, RetentionPolicy, StorageType } from 'nats';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createJetStreamEventLog, eventLogSubject } from '@applik8s/runtime-nats';

const liveServers = process.env.APPLIK8S_JETSTREAM_SERVERS;
const existingStream = process.env.APPLIK8S_JETSTREAM_EXISTING_STREAM;
const stream = existingStream ?? `APPLIK8S_V04_TEST_${process.pid}`;
const subjectPrefix = 'applik8s';
const lagConsumer = `applik8s-v04-lag-${process.pid}`;

describe('JetStream EventLog runtime', () => {
  it('maps event contracts and partition keys to bounded deterministic NATS subjects', () => {
    expect(eventLogSubject(subjectPrefix, { contract: { name: 'Account Changed', version: 'v1' }, partitionKey: 'tenant/a:account/1' })).toBe('applik8s.events.account-changed.v1.tenant-a-account-1');
    expect(eventLogSubject(subjectPrefix, { contract: { name: 'Account.Changed', version: 'v1' } })).toBe('applik8s.events.account-changed.v1.unpartitioned');
    expect(eventLogSubject(subjectPrefix, { contract: { name: 'Account.Rename', version: 'v1' }, partitionKey: 'account-1' }, 'commands')).toBe('applik8s.commands.account-rename.v1.account-1');
  });
});

describe.runIf(liveServers)('JetStream EventLog runtime live behavior', () => {
  beforeAll(async () => {
    if (existingStream) return;
    const connection = await connect({ servers: requiredLiveServers() });
    try {
      const manager = await connection.jetstreamManager();
      await manager.streams.add({
        name: stream,
        subjects: [`${subjectPrefix}.>`],
        retention: RetentionPolicy.Limits,
        storage: StorageType.Memory,
        max_msgs: 1_000,
        duplicate_window: 120_000_000_000,
      });
      await manager.consumers.add(stream, { durable_name: lagConsumer, ack_policy: AckPolicy.Explicit, filter_subject: `${subjectPrefix}.events.>` });
    } finally {
      await connection.drain();
    }
  });

  afterAll(async () => {
    if (existingStream) return;
    const connection = await connect({ servers: requiredLiveServers() });
    try {
      const manager = await connection.jetstreamManager();
      await manager.streams.delete(stream);
    } finally {
      await connection.drain();
    }
  });

  it('verifies externally managed stream compatibility and acknowledges duplicate message IDs honestly', async () => {
    if (!liveServers) {
      throw new Error('Live JetStream test requires APPLIK8S_JETSTREAM_SERVERS.');
    }
    const eventLog = createJetStreamEventLog({ servers: [liveServers], stream, subjectPrefix });
    const envelope = {
      id: `account-changed-message-${process.pid}`,
      contract: { name: 'account.changed', version: 'v1' },
      payload: { accountId: 'account-1', changed: true },
      partitionKey: 'account-1',
      recordedAt: '2026-07-10T12:00:00.000Z',
    };
    try {
      await expect(eventLog.verify()).resolves.toBeUndefined();
      const first = await eventLog.publish(envelope);
      const duplicate = await eventLog.publish(envelope);
      const commandAck = await eventLog.publish({ ...envelope, id: `${envelope.id}-command`, contract: { name: 'account.followup', version: 'v1' } }, 'commands');
      expect(first).toMatchObject({ stream, duplicate: false, messageId: envelope.id, subject: 'applik8s.events.account-changed.v1.account-1' });
      expect(duplicate).toMatchObject({ stream, duplicate: true, messageId: envelope.id, sequence: first.sequence });
      expect(commandAck).toMatchObject({ stream, duplicate: false, subject: 'applik8s.commands.account-followup.v1.account-1', messageId: `${envelope.id}-command` });
    } finally {
      await eventLog.drain();
    }
  });

  it('fails closed when TypeKro-managed stream subjects do not satisfy the application contract', async () => {
    if (!liveServers) {
      throw new Error('Live JetStream test requires APPLIK8S_JETSTREAM_SERVERS.');
    }
    const incompatible = createJetStreamEventLog({ servers: [liveServers], stream, subjectPrefix: 'wrong.prefix' });
    try {
      await expect(incompatible.verify()).rejects.toThrow(/stream-incompatible/);
    } finally {
      await incompatible.drain();
    }
  });

  it('reports inspectable JetStream consumer lag for generated-processor observations', async () => {
    if (!liveServers) throw new Error('Live JetStream test requires APPLIK8S_JETSTREAM_SERVERS.');
    const eventLog = createJetStreamEventLog({ servers: [liveServers], stream, subjectPrefix });
    try {
      await eventLog.publish({ id: 'lag-message-1', contract: { name: 'lag.changed', version: 'v1' }, payload: { value: 1 }, recordedAt: '2026-07-11T00:00:00.000Z' });
      if (existingStream) return;
      await expect(eventLog.consumerLag(lagConsumer)).resolves.toEqual(expect.objectContaining({ pending: expect.any(Number), ackPending: 0, redelivered: 0 }));
      expect((await eventLog.consumerLag(lagConsumer)).pending).toBeGreaterThan(0);
    } finally {
      await eventLog.drain();
    }
  });
});

function requiredLiveServers(): string {
  if (!liveServers) {
    throw new Error('Live JetStream test requires APPLIK8S_JETSTREAM_SERVERS.');
  }
  return liveServers;
}
