import { jetstream, jetstreamManager, type JetStreamClient, type JetStreamManager } from '@nats-io/jetstream';
import type { NatsConnection } from '@nats-io/nats-core';
import { connect } from '@nats-io/transport-node';
import type { ApplicationMessageEnvelope } from '@applik8s/applik8s/dsl';
import type { ApplicationEventLogPublisher, ApplicationMessageChannel } from '@applik8s/applik8s/event-log-runtime';

export interface JetStreamEventLogOptions {
  readonly servers: readonly string[];
  readonly stream: string;
  readonly subjectPrefix: string;
  readonly connectionName?: string;
  readonly token?: string;
  readonly user?: string;
  readonly pass?: string;
  readonly timeoutMs?: number;
}

const textEncoder = new TextEncoder();

export function createJetStreamEventLog(options: JetStreamEventLogOptions): ApplicationEventLogPublisher {
  let connection: NatsConnection | undefined;
  let jetStream: JetStreamClient | undefined;
  let manager: JetStreamManager | undefined;
  const connected = async () => {
    if (connection && jetStream && manager) {
      return { connection, jetStream, manager };
    }
    connection = await connect({
      servers: [...options.servers],
      name: options.connectionName ?? 'applik8s-event-log',
      timeout: options.timeoutMs ?? 5_000,
      ...(options.token ? { token: options.token } : {}),
      ...(options.user ? { user: options.user } : {}),
      ...(options.pass ? { pass: options.pass } : {}),
    });
    jetStream = jetstream(connection);
    manager = await jetstreamManager(connection);
    return { connection, jetStream, manager };
  };
  return {
    async verify() {
      const runtime = await connected();
      const info = await runtime.manager.streams.info(options.stream);
      const expected = `${options.subjectPrefix}.>`;
      if (!info.config.subjects?.includes(expected)) {
        throw new Error(`applik8s-eventlog-stream-incompatible: JetStream ${options.stream} must include subject ${expected}. Infrastructure lifecycle belongs to TypeKro; the runtime will not mutate the stream.`);
      }
    },
    async publish(envelope, channel = 'events') {
      const runtime = await connected();
      const subject = eventLogSubject(options.subjectPrefix, envelope, channel);
      const acknowledgement = await runtime.jetStream.publish(subject, textEncoder.encode(JSON.stringify(envelope)), { msgID: envelope.id });
      if (acknowledgement.stream !== options.stream) {
        throw new Error(`applik8s-eventlog-stream-mismatch: Subject ${subject} was acknowledged by ${acknowledgement.stream}, expected ${options.stream}.`);
      }
      return { stream: acknowledgement.stream, sequence: acknowledgement.seq, duplicate: acknowledgement.duplicate, subject, messageId: envelope.id };
    },
    async consumerLag(consumer) {
      const runtime = await connected();
      const info = await runtime.manager.consumers.info(options.stream, consumer);
      return { pending: info.num_pending, ackPending: info.num_ack_pending, redelivered: info.num_redelivered };
    },
    async drain() {
      if (!connection) {
        return;
      }
      await connection.drain();
      connection = undefined;
      jetStream = undefined;
      manager = undefined;
    },
  };
}

export function eventLogSubject(prefix: string, envelope: Pick<ApplicationMessageEnvelope<object>, 'contract' | 'partitionKey'>, channel: ApplicationMessageChannel = 'events'): string {
  const contract = natsSubjectToken(envelope.contract.name);
  const version = natsSubjectToken(envelope.contract.version);
  const partition = natsSubjectToken(envelope.partitionKey ?? 'unpartitioned');
  return `${prefix}.${channel}.${contract}.${version}.${partition}`;
}

function natsSubjectToken(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || 'value';
}
