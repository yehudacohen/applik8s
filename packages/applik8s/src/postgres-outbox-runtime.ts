import type { ApplicationMessageEnvelope } from './dsl.js';
import type { ApplicationEventLogPublisher, ApplicationMessageChannel, EventLogPublishAcknowledgement } from './event-log-runtime.js';
import { createApplicationPostgresSql } from './postgres-runtime-loader.js';

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
  readonly admissionsDeleted: number;
}

export interface PostgresOutboxLag {
  readonly pendingEvents: number;
  readonly pendingCommands: number;
  readonly oldestPendingSeconds: number;
}

export async function relayPostgresEventOutbox(options: EventOutboxRelayOptions): Promise<EventOutboxRelayResult> {
  return relayPostgresOutbox(options, 'applik8s_event_outbox', 'events');
}

export async function relayPostgresCommandOutbox(options: EventOutboxRelayOptions): Promise<EventOutboxRelayResult> {
  return relayPostgresOutbox(options, 'applik8s_command_outbox', 'commands');
}

async function relayPostgresOutbox(options: EventOutboxRelayOptions, table: 'applik8s_event_outbox' | 'applik8s_command_outbox', channel: ApplicationMessageChannel): Promise<EventOutboxRelayResult> {
  const sql = await createApplicationPostgresSql(options.databaseUrl, { max: 1 });
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
  if (options.bindingIds.length === 0) return { eventOutboxDeleted: 0, commandOutboxDeleted: 0, commandsDeleted: 0, admissionsDeleted: 0 };
  const auditWindowSeconds = positiveInteger(options.auditWindowSeconds, 'auditWindowSeconds');
  const publishedOutboxWindowSeconds = positiveInteger(options.publishedOutboxWindowSeconds, 'publishedOutboxWindowSeconds');
  const batchSize = Math.min(10_000, positiveInteger(options.batchSize ?? 1_000, 'batchSize'));
  const now = options.now ?? new Date().toISOString();
  const sql = await createApplicationPostgresSql(options.databaseUrl, { max: 1 });
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
      const admissionRows = await transaction.unsafe(`WITH candidates AS (
  SELECT admission.scope FROM applik8s_command_admissions admission
  WHERE admission.binding_id = ANY($1::text[])
    AND admission.admitted_at < $2::timestamptz - make_interval(secs => $3)
    AND NOT EXISTS (SELECT 1 FROM applik8s_command_inbox inbox WHERE inbox.scope = admission.scope)
  ORDER BY admission.admitted_at, admission.scope LIMIT $4
) DELETE FROM applik8s_command_admissions admission USING candidates WHERE admission.scope = candidates.scope RETURNING admission.scope, admission.command_id, admission.authorization_receipt`, [options.bindingIds, now, auditWindowSeconds, batchSize]);
      for (const row of admissionRows) {
        const receipt = jsonRecord(row.authorization_receipt);
        const application = receipt && typeof receipt.application === 'string' ? receipt.application : undefined;
        const catalogRevision = receipt && typeof receipt.catalogRevision === 'string' ? receipt.catalogRevision : undefined;
        const commandId = typeof row.command_id === 'string' ? row.command_id : undefined;
        if (!application || !catalogRevision || !commandId) continue;
        await transaction.unsafe(
          `DELETE FROM applik8s_operation_catalog_references
           WHERE application = $1 AND revision = $2 AND kind = 'envelope' AND reference_id = $3`,
          [application, catalogRevision, commandId],
        );
      }
      return { eventOutboxDeleted: eventRows.length, commandOutboxDeleted: commandRows.length, commandsDeleted: inboxRows.length, admissionsDeleted: admissionRows.length };
    });
  } finally {
    await sql.end({ timeout: 1 });
  }
}

function jsonRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Readonly<Record<string, unknown>>
        : undefined;
    } catch {
      return undefined;
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;
}

export async function observePostgresOutboxLag(databaseUrl: string): Promise<PostgresOutboxLag> {
  const sql = await createApplicationPostgresSql(databaseUrl, { max: 1 });
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

function eventOutboxEnvelope(row: EventOutboxRow): ApplicationMessageEnvelope<object> {
  const value = typeof row.envelope === 'string' ? JSON.parse(row.envelope) : row.envelope;
  if (!value || typeof value !== 'object' || typeof Reflect.get(value, 'id') !== 'string' || typeof Reflect.get(value, 'contract') !== 'object' || typeof Reflect.get(value, 'payload') !== 'object') {
    throw new Error(`applik8s-eventlog-outbox-invalid: Event outbox row ${row.id} does not contain a valid message envelope.`);
  }
  // typecast: required envelope fields are checked above; detailed payload validation belongs to its versioned event schema before outbox insertion.
  return value as ApplicationMessageEnvelope<object>;
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`applik8s-command-cleanup-invalid: ${field} must be a positive integer.`);
  return value;
}
