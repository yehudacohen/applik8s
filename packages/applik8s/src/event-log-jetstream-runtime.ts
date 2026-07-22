import { jetstream, jetstreamManager, type JetStreamClient, type JetStreamManager } from '@nats-io/jetstream';
import type { NatsConnection } from '@nats-io/nats-core';
import { connect } from '@nats-io/transport-node';
import postgres from 'postgres';
import type { ApplicationMessageEnvelope } from './dsl.js';

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

export interface EventLogPublishAcknowledgement {
  readonly stream: string;
  readonly sequence: number;
  readonly duplicate: boolean;
  readonly subject: string;
  readonly messageId: string;
}

export type ApplicationMessageChannel = 'commands' | 'events';

export interface ApplicationEventLogPublisher {
  verify(): Promise<void>;
  publish(envelope: ApplicationMessageEnvelope<object>, channel?: ApplicationMessageChannel): Promise<EventLogPublishAcknowledgement>;
  consumerLag(consumer: string): Promise<JetStreamConsumerLag>;
  drain(): Promise<void>;
}

export interface JetStreamConsumerLag {
  readonly pending: number;
  readonly ackPending: number;
  readonly redelivered: number;
}

export interface EventOutboxRelayOptions {
  readonly databaseUrl: string;
  readonly eventLog: Pick<ApplicationEventLogPublisher, 'publish'>;
  readonly limit?: number;
  readonly onPublishAcknowledged?: (acknowledgement: EventLogPublishAcknowledgement) => void | Promise<void>;
}

export interface EventOutboxRelayResult {
  readonly selected: number;
  readonly published: number;
  readonly duplicates: number;
  readonly messageIds: readonly string[];
}

interface EventOutboxRow {
  readonly id: string;
  readonly envelope: unknown;
}

export interface CommandDataCleanupOptions {
  readonly databaseUrl: string;
  readonly bindingIds: readonly string[];
  readonly auditWindowSeconds: number;
  readonly publishedOutboxWindowSeconds: number;
  readonly batchSize?: number;
  readonly now?: string;
}

export interface CommandDataCleanupResult {
  readonly eventOutboxDeleted: number;
  readonly commandOutboxDeleted: number;
  readonly commandsDeleted: number;
}

export interface PostgresOutboxLag {
  readonly pendingEvents: number;
  readonly pendingCommands: number;
  readonly oldestPendingSeconds: number;
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

export async function relayPostgresEventOutbox(options: EventOutboxRelayOptions): Promise<EventOutboxRelayResult> {
  return relayPostgresOutbox(options, 'applik8s_event_outbox', 'events');
}

export async function relayPostgresCommandOutbox(options: EventOutboxRelayOptions): Promise<EventOutboxRelayResult> {
  return relayPostgresOutbox(options, 'applik8s_command_outbox', 'commands');
}

async function relayPostgresOutbox(options: EventOutboxRelayOptions, table: 'applik8s_event_outbox' | 'applik8s_command_outbox', channel: ApplicationMessageChannel): Promise<EventOutboxRelayResult> {
  const sql = postgres(options.databaseUrl, { max: 1 });
  try {
    const limit = Math.max(1, Math.min(options.limit ?? 100, 1_000));
    const rows = await sql.unsafe(`SELECT id, envelope FROM ${table} WHERE published_at IS NULL ORDER BY created_at, id LIMIT $1`, [limit]);
    // typecast: this query selects the exact durable outbox row shape from an Applik8s-owned migration.
    const outbox = rows as unknown as readonly EventOutboxRow[];
    let published = 0;
    let duplicates = 0;
    const messageIds: string[] = [];
    for (const row of outbox) {
      const envelope = eventOutboxEnvelope(row);
      const acknowledgement = await options.eventLog.publish(envelope, channel);
      await options.onPublishAcknowledged?.(acknowledgement);
      await sql.unsafe(`UPDATE ${table} SET published_at = now() WHERE id = $1 AND published_at IS NULL`, [row.id]);
      published += 1;
      duplicates += acknowledgement.duplicate ? 1 : 0;
      messageIds.push(envelope.id);
    }
    return { selected: outbox.length, published, duplicates, messageIds };
  } finally {
    await sql.end({ timeout: 1 });
  }
}

export async function cleanupPostgresCommandData(options: CommandDataCleanupOptions): Promise<CommandDataCleanupResult> {
  if (options.bindingIds.length === 0) return { eventOutboxDeleted: 0, commandOutboxDeleted: 0, commandsDeleted: 0 };
  const auditWindowSeconds = positiveInteger(options.auditWindowSeconds, 'auditWindowSeconds');
  const publishedOutboxWindowSeconds = positiveInteger(options.publishedOutboxWindowSeconds, 'publishedOutboxWindowSeconds');
  const batchSize = Math.min(10_000, positiveInteger(options.batchSize ?? 1_000, 'batchSize'));
  const now = options.now ?? new Date().toISOString();
  const sql = postgres(options.databaseUrl, { max: 1 });
  try {
    return await sql.begin(async (transaction) => {
      const eventRows = await transaction.unsafe(`WITH candidates AS (
  SELECT outbox.id FROM applik8s_event_outbox outbox
  JOIN applik8s_command_inbox inbox ON inbox.scope = outbox.scope
  WHERE inbox.binding_id = ANY($1::text[]) AND outbox.published_at IS NOT NULL
    AND outbox.published_at < $2::timestamptz - make_interval(secs => $3)
  ORDER BY outbox.published_at, outbox.id LIMIT $4
) DELETE FROM applik8s_event_outbox outbox USING candidates WHERE outbox.id = candidates.id RETURNING outbox.id`, [options.bindingIds, now, publishedOutboxWindowSeconds, batchSize]);
      const commandRows = await transaction.unsafe(`WITH candidates AS (
  SELECT outbox.id FROM applik8s_command_outbox outbox
  JOIN applik8s_command_inbox inbox ON inbox.scope = outbox.scope
  WHERE inbox.binding_id = ANY($1::text[]) AND outbox.published_at IS NOT NULL
    AND outbox.published_at < $2::timestamptz - make_interval(secs => $3)
  ORDER BY outbox.published_at, outbox.id LIMIT $4
) DELETE FROM applik8s_command_outbox outbox USING candidates WHERE outbox.id = candidates.id RETURNING outbox.id`, [options.bindingIds, now, publishedOutboxWindowSeconds, batchSize]);
      const inboxRows = await transaction.unsafe(`WITH candidates AS (
  SELECT inbox.scope FROM applik8s_command_inbox inbox
  WHERE inbox.binding_id = ANY($1::text[])
    AND inbox.received_at < $2::timestamptz - make_interval(secs => $3)
    AND EXISTS (SELECT 1 FROM applik8s_command_results result WHERE result.scope = inbox.scope)
    AND NOT EXISTS (SELECT 1 FROM applik8s_event_outbox event_outbox WHERE event_outbox.scope = inbox.scope AND (event_outbox.published_at IS NULL OR event_outbox.published_at >= $2::timestamptz - make_interval(secs => $4)))
    AND NOT EXISTS (SELECT 1 FROM applik8s_command_outbox command_outbox WHERE command_outbox.scope = inbox.scope AND (command_outbox.published_at IS NULL OR command_outbox.published_at >= $2::timestamptz - make_interval(secs => $4)))
  ORDER BY inbox.received_at, inbox.scope LIMIT $5
) DELETE FROM applik8s_command_inbox inbox USING candidates WHERE inbox.scope = candidates.scope RETURNING inbox.scope`, [options.bindingIds, now, auditWindowSeconds, publishedOutboxWindowSeconds, batchSize]);
      return { eventOutboxDeleted: eventRows.length, commandOutboxDeleted: commandRows.length, commandsDeleted: inboxRows.length };
    });
  } finally {
    await sql.end({ timeout: 1 });
  }
}

export async function observePostgresOutboxLag(databaseUrl: string): Promise<PostgresOutboxLag> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const rows = await sql.unsafe(`SELECT
  (SELECT count(*) FROM applik8s_event_outbox WHERE published_at IS NULL) AS pending_events,
  (SELECT count(*) FROM applik8s_command_outbox WHERE published_at IS NULL) AS pending_commands,
  GREATEST(0, EXTRACT(EPOCH FROM (now() - LEAST(
    COALESCE((SELECT min(created_at) FROM applik8s_event_outbox WHERE published_at IS NULL), now()),
    COALESCE((SELECT min(created_at) FROM applik8s_command_outbox WHERE published_at IS NULL), now())
  )))) AS oldest_pending_seconds`);
    // typecast: postgres returns untyped rows; constrain the three scalar aggregate columns read below.
    const row = rows[0] as
      | {
          readonly pending_events?: string | number;
          readonly pending_commands?: string | number;
          readonly oldest_pending_seconds?: string | number;
        }
      | undefined;
    return {
      pendingEvents: Number(row?.pending_events ?? 0),
      pendingCommands: Number(row?.pending_commands ?? 0),
      oldestPendingSeconds: Number(row?.oldest_pending_seconds ?? 0),
    };
  } finally {
    await sql.end({ timeout: 1 });
  }
}

export function eventLogSubject(prefix: string, envelope: Pick<ApplicationMessageEnvelope<object>, 'contract' | 'partitionKey'>, channel: ApplicationMessageChannel = 'events'): string {
  const contract = natsSubjectToken(envelope.contract.name);
  const version = natsSubjectToken(envelope.contract.version);
  const partition = natsSubjectToken(envelope.partitionKey ?? 'unpartitioned');
  return `${prefix}.${channel}.${contract}.${version}.${partition}`;
}

function eventOutboxEnvelope(row: EventOutboxRow): ApplicationMessageEnvelope<object> {
  const value = typeof row.envelope === 'string' ? JSON.parse(row.envelope) : row.envelope;
  if (!value || typeof value !== 'object' || typeof Reflect.get(value, 'id') !== 'string' || typeof Reflect.get(value, 'contract') !== 'object' || typeof Reflect.get(value, 'payload') !== 'object') {
    throw new Error(`applik8s-eventlog-outbox-invalid: Event outbox row ${row.id} does not contain a valid message envelope.`);
  }
  // typecast: required envelope fields are checked above; detailed payload validation belongs to its versioned event schema before outbox insertion.
  return value as ApplicationMessageEnvelope<object>;
}

function natsSubjectToken(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || 'value';
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`applik8s-command-cleanup-invalid: ${field} must be a positive integer.`);
  return value;
}
