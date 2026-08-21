// typecast-file-boundary: stream envelope payloads are schema-authoritative and regain their declared payload generic after runtime decoding.

import { createHash } from 'node:crypto';
import type { ApplicationAdmissionInvocationContextV1 } from '@applik8s/core';
import type { ApplicationEventBatch, ApplicationStreamBatchContext, ApplicationStreamProcessContext } from './application-reactive.js';
import type { ApplicationPostgresSql } from './postgres-runtime-contract.js';
import { createApplicationPostgresSql } from './postgres-runtime-loader.js';
import type { ApplicationReplayableStream, ApplicationStreamEnvelope } from './projection-runtime-clickhouse.js';

export interface ApplicationStreamProcessorStore {
  prepare(): Promise<void>;
  checkpoint(processor: string, stream: string): Promise<number>;
  advance(processor: string, stream: string, sequence: number): Promise<void>;
  deadLetter(processor: string, stream: string, envelope: ApplicationStreamEnvelope, attempts: number, error: string): Promise<void>;
  pendingBatchGroup?(processor: string, stream: string): Promise<ApplicationFrozenStreamBatchGroup<object> | undefined>;
  freezeBatchGroup?(processor: string, stream: string, group: ApplicationFrozenStreamBatchGroup<object>): Promise<ApplicationFrozenStreamBatchGroup<object>>;
  markBatchComplete?(processor: string, stream: string, groupId: string, batchId: string): Promise<void>;
  completeBatchGroup?(processor: string, stream: string, groupId: string, sequence: number): Promise<void>;
  close(): Promise<void>;
}

export interface ApplicationFrozenStreamBatch<TPayload extends object> {
  readonly id: string;
  readonly partition?: string;
  readonly firstSequence: number;
  readonly lastSequence: number;
  readonly events: readonly ApplicationStreamEnvelope<TPayload>[];
}

export interface ApplicationFrozenStreamBatchGroup<TPayload extends object> {
  readonly id: string;
  readonly firstSequence: number;
  readonly lastSequence: number;
  readonly batches: readonly ApplicationFrozenStreamBatch<TPayload>[];
  readonly completedBatchIds: readonly string[];
}

export interface PostgresApplicationStreamProcessorStoreOptions {
  readonly databaseUrl?: string;
  readonly sql?: ApplicationPostgresSql;
}

/**
 * Decodes a persisted stream payload for an admitted server execution.
 *
 * The replay log and frozen batch manifests always retain their inert JSON
 * representation. Capability-bearing values, such as workflow signals, are
 * rehydrated for each delivery attempt so expiry and authority are evaluated
 * against current state. Projection runtimes deliberately do not expose this
 * seam.
 */
export type ApplicationStreamPayloadDecoder<
  TPersisted extends object,
  TDecoded extends object = TPersisted,
> = (
  payload: TPersisted,
  context: {
    readonly admission: ApplicationAdmissionInvocationContextV1;
    readonly event: {
      readonly id: string;
      readonly stream: { readonly name: string; readonly version: string };
      readonly sequence: number;
      readonly recordedAt: string;
      readonly partitionKey: string;
      readonly contextDigest?: string;
    };
    readonly principal?: ApplicationStreamEnvelope<TPersisted>['principal'];
    readonly trustedContext: Readonly<Record<string, import('@applik8s/core').JsonValue>>;
    readonly signal: AbortSignal;
  },
) => TDecoded | Promise<TDecoded>;

export interface ApplicationStreamDeliveryAdmissionRequest<
  TPayload extends object = object,
> {
  readonly envelope: ApplicationStreamEnvelope<TPayload>;
  readonly attempt: number;
  readonly signal: AbortSignal;
}

export type ApplicationStreamDeliveryAdmitter<TPayload extends object = object> = (
  request: ApplicationStreamDeliveryAdmissionRequest<TPayload>,
) =>
  | ApplicationAdmissionInvocationContextV1
  | Promise<ApplicationAdmissionInvocationContextV1>;

export function createPostgresApplicationStreamProcessorStore(options: PostgresApplicationStreamProcessorStoreOptions): ApplicationStreamProcessorStore {
  if (!options.sql && !options.databaseUrl) throw new Error('PostgreSQL stream processor store requires sql or databaseUrl.');
  const ownsClient = !options.sql;
  const sql = options.sql ? Promise.resolve(options.sql) : createApplicationPostgresSql(options.databaseUrl as string, { max: 4, idle_timeout: 20, connect_timeout: 10, prepare: false });
  let preparation: Promise<void> | undefined;
  async function prepareStore() {
    await (await sql).unsafe(`CREATE TABLE IF NOT EXISTS applik8s_stream_processor_checkpoints (
  processor text NOT NULL,
  stream text NOT NULL,
  sequence bigint NOT NULL CHECK (sequence >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (processor, stream)
)`);
    await (await sql).unsafe(`CREATE TABLE IF NOT EXISTS applik8s_stream_processor_dead_letters (
  processor text NOT NULL,
  stream text NOT NULL,
  event_id text NOT NULL,
  sequence bigint NOT NULL,
  partition_key text NOT NULL,
  recorded_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  attempts integer NOT NULL,
  error text NOT NULL,
  failed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (processor, stream, event_id)
)`);
    await (await sql).unsafe(`CREATE TABLE IF NOT EXISTS applik8s_stream_processor_batch_groups (
  processor text NOT NULL,
  stream text NOT NULL,
  group_id text NOT NULL,
  first_sequence bigint NOT NULL CHECK (first_sequence >= 0),
  last_sequence bigint NOT NULL CHECK (last_sequence >= first_sequence),
  batches jsonb NOT NULL,
  completed_batch_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (processor, stream),
  UNIQUE (group_id)
)`);
    // v0.7 development builds briefly persisted the otherwise valid batch
    // array as a JSONB string. Restore its exact structured value in place;
    // the checkpoint has not advanced while a group exists, so neither
    // membership nor replay identity changes during this repair.
    await (await sql).unsafe(`UPDATE applik8s_stream_processor_batch_groups
SET batches = (batches #>> '{}')::jsonb
WHERE jsonb_typeof(batches) = 'string'`);
  }
  return {
    prepare() {
      preparation ??= prepareStore().catch((cause: unknown) => {
        preparation = undefined;
        throw cause;
      });
      return preparation;
    },
    async checkpoint(processor, stream) {
      const rows = await (await sql).unsafe('SELECT sequence FROM applik8s_stream_processor_checkpoints WHERE processor = $1 AND stream = $2', [processor, stream]);
      const sequence = Number(rows[0]?.sequence ?? 0);
      if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error(`Stream processor ${processor} returned an invalid checkpoint.`);
      return sequence;
    },
    async advance(processor, stream, sequence) {
      if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error(`Stream processor ${processor} checkpoint must be a non-negative safe integer.`);
      await (await sql).unsafe(`INSERT INTO applik8s_stream_processor_checkpoints (processor, stream, sequence, updated_at)
VALUES ($1, $2, $3, now())
ON CONFLICT (processor, stream) DO UPDATE SET sequence = greatest(applik8s_stream_processor_checkpoints.sequence, EXCLUDED.sequence), updated_at = now()`, [processor, stream, sequence]);
    },
    async deadLetter(processor, stream, envelope, attempts, error) {
      await (await sql).begin(async (transaction) => {
        await transaction.unsafe(`INSERT INTO applik8s_stream_processor_dead_letters (processor, stream, event_id, sequence, partition_key, recorded_at, payload, attempts, error)
VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::jsonb, $8, $9)
ON CONFLICT (processor, stream, event_id) DO UPDATE SET attempts = greatest(applik8s_stream_processor_dead_letters.attempts, EXCLUDED.attempts), error = EXCLUDED.error, failed_at = now()`, [processor, stream, envelope.id, envelope.sequence, envelope.partitionKey, envelope.recordedAt, transaction.json(envelope.payload), attempts, error.slice(0, 4_000)]);
      });
    },
    async pendingBatchGroup(processor: string, stream: string) {
      const rows = await (await sql).unsafe(
        'SELECT group_id, first_sequence, last_sequence, batches, completed_batch_ids FROM applik8s_stream_processor_batch_groups WHERE processor = $1 AND stream = $2',
        [processor, stream],
      );
      return rows[0] ? postgresFrozenBatchGroup(rows[0]) : undefined;
    },
    async freezeBatchGroup(processor: string, stream: string, group: ApplicationFrozenStreamBatchGroup<object>) {
      return (await sql).begin(async (transaction) => {
        const existing = await transaction.unsafe(
          'SELECT group_id, first_sequence, last_sequence, batches, completed_batch_ids FROM applik8s_stream_processor_batch_groups WHERE processor = $1 AND stream = $2 FOR UPDATE',
          [processor, stream],
        );
        if (existing[0]) return postgresFrozenBatchGroup(existing[0]);
        await transaction.unsafe(
          `INSERT INTO applik8s_stream_processor_batch_groups
  (processor, stream, group_id, first_sequence, last_sequence, batches, completed_batch_ids)
VALUES ($1, $2, $3, $4, $5, $6::jsonb, '[]'::jsonb)`,
          [processor, stream, group.id, group.firstSequence, group.lastSequence, transaction.json(group.batches)],
        );
        return group;
      });
    },
    async markBatchComplete(processor, stream, groupId, batchId) {
      const rows = await (await sql).begin((transaction) =>
        transaction.unsafe(
          `UPDATE applik8s_stream_processor_batch_groups
SET completed_batch_ids = CASE
  WHEN completed_batch_ids @> $5::jsonb THEN completed_batch_ids
  ELSE completed_batch_ids || $5::jsonb
END
WHERE processor = $1 AND stream = $2 AND group_id = $3
  AND batches @> $4::jsonb
RETURNING group_id`,
          [
            processor,
            stream,
            groupId,
            transaction.json([{ id: batchId }]),
            transaction.json([batchId]),
          ],
        ));
      if (rows.length !== 1) throw new Error(`Frozen stream batch ${batchId} is missing or no longer owned by ${processor}.`);
    },
    async completeBatchGroup(processor, stream, groupId, sequence) {
      await (await sql).begin(async (transaction) => {
        const rows = await transaction.unsafe(
          'SELECT batches, completed_batch_ids FROM applik8s_stream_processor_batch_groups WHERE processor = $1 AND stream = $2 AND group_id = $3 FOR UPDATE',
          [processor, stream, groupId],
        );
        const group = rows[0];
        const batches = Array.isArray(group?.batches) ? group.batches : [];
        const completed = new Set(Array.isArray(group?.completed_batch_ids) ? group.completed_batch_ids : []);
        if (batches.length === 0 || batches.some((batch) => !completed.has(Reflect.get(batch, 'id')))) {
          throw new Error(`Frozen stream batch group ${groupId} cannot advance before every batch completes.`);
        }
        await transaction.unsafe(
          'DELETE FROM applik8s_stream_processor_batch_groups WHERE processor = $1 AND stream = $2 AND group_id = $3',
          [processor, stream, groupId],
        );
        await transaction.unsafe(`INSERT INTO applik8s_stream_processor_checkpoints (processor, stream, sequence, updated_at)
VALUES ($1, $2, $3, now())
ON CONFLICT (processor, stream) DO UPDATE SET sequence = greatest(applik8s_stream_processor_checkpoints.sequence, EXCLUDED.sequence), updated_at = now()`, [processor, stream, sequence]);
      });
    },
    async close() { if (ownsClient) await (await sql).end({ timeout: 5 }); },
  };
}

function postgresFrozenBatchGroup(row: Readonly<Record<string, unknown>>): ApplicationFrozenStreamBatchGroup<object> {
  const id = row.group_id;
  const firstSequence = Number(row.first_sequence);
  const lastSequence = Number(row.last_sequence);
  const batches = row.batches;
  const completedBatchIds = row.completed_batch_ids;
  if (typeof id !== 'string' || !Number.isSafeInteger(firstSequence) || !Number.isSafeInteger(lastSequence) || !Array.isArray(batches) || !Array.isArray(completedBatchIds) || !completedBatchIds.every((value) => typeof value === 'string')) {
    throw new Error('PostgreSQL returned an invalid frozen stream batch-group manifest.');
  }
  return {
    id,
    firstSequence,
    lastSequence,
    // typecast: event payloads are validated by the replay source before they
    // enter this framework-owned manifest.
    batches: batches as readonly ApplicationFrozenStreamBatch<object>[],
    completedBatchIds: completedBatchIds as readonly string[],
  };
}

export interface RunApplicationStreamProcessorOptions<
  TPersisted extends object,
  TDecoded extends object = TPersisted,
> {
  readonly processor: string;
  readonly streamName: string;
  readonly source: ApplicationReplayableStream<TPersisted>;
  readonly store: ApplicationStreamProcessorStore;
  readonly handle: (payload: TDecoded, context: ApplicationStreamProcessContext) => void | Promise<void>;
  readonly admit: ApplicationStreamDeliveryAdmitter<TPersisted>;
  readonly decodePayload?: ApplicationStreamPayloadDecoder<TPersisted, TDecoded>;
  readonly concurrency: number;
  readonly retry: { readonly maxAttempts: number; readonly initialDelayMs: number; readonly maxDelayMs: number; readonly factor: number };
  readonly failure: 'pause' | 'deadLetter';
  readonly timeoutMs: number;
  readonly maxInputBytes: number;
  readonly batchSize?: number;
  readonly maxBatches?: number;
}

export async function runApplicationStreamProcessor<
  TPersisted extends object,
  TDecoded extends object = TPersisted,
>(options: RunApplicationStreamProcessorOptions<TPersisted, TDecoded>): Promise<{ readonly processed: number; readonly deadLettered: number; readonly checkpoint: number; readonly exhausted: boolean }> {
  const batchSize = options.batchSize ?? Math.min(1_000, Math.max(1, options.concurrency * 8));
  const maxBatches = options.maxBatches ?? 100;
  if (!Number.isSafeInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 64) throw new Error('Stream processor concurrency must be between 1 and 64.');
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1_000) throw new Error('Stream processor batchSize must be between 1 and 1000.');
  if (!Number.isSafeInteger(maxBatches) || maxBatches < 1 || maxBatches > 10_000) throw new Error('Stream processor maxBatches must be between 1 and 10000.');
  await options.store.prepare();
  let checkpoint = await options.store.checkpoint(options.processor, options.streamName);
  let processed = 0;
  let deadLettered = 0;
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const page = await options.source.read(checkpoint, batchSize);
    if (page.retentionFloor > checkpoint) throw new ApplicationStreamProcessorRetentionGapError(options.processor, options.streamName, checkpoint, page.retentionFloor);
    const results = await processPartitionedEnvelopes(
      page.items,
      options.concurrency,
      (envelope) => processEnvelope(options, envelope),
    );
    const failed = results.find((result) => result.state === 'failed');
    if (failed?.state === 'failed') throw new ApplicationStreamProcessorPausedError(options.processor, failed.eventId, failed.error);
    processed += results.filter((result) => result.state === 'processed').length;
    deadLettered += results.filter((result) => result.state === 'deadLettered').length;
    checkpoint = page.nextSequence;
    await options.store.advance(options.processor, options.streamName, checkpoint);
    if (page.exhausted) return { processed, deadLettered, checkpoint, exhausted: true };
  }
  return { processed, deadLettered, checkpoint, exhausted: false };
}

export interface RunApplicationStreamBatchProcessorOptions<
  TPersisted extends object,
  TDecoded extends object = TPersisted,
> {
  readonly processor: string;
  readonly streamName: string;
  readonly source: ApplicationReplayableStream<TPersisted>;
  readonly store: ApplicationStreamProcessorStore;
  readonly handle: (batch: ApplicationEventBatch<TDecoded>, context: ApplicationStreamBatchContext) => void | Promise<void>;
  readonly admit: ApplicationStreamDeliveryAdmitter<TPersisted>;
  readonly decodePayload?: ApplicationStreamPayloadDecoder<TPersisted, TDecoded>;
  readonly retry: RunApplicationStreamProcessorOptions<TPersisted>['retry'];
  readonly failure: RunApplicationStreamProcessorOptions<TPersisted>['failure'];
  readonly timeoutMs: number;
  readonly maxInputBytes: number;
  readonly maxItems: number;
  readonly maxBytes: number;
  readonly concurrency: number;
  readonly maxBatches?: number;
}

export async function runApplicationStreamBatchProcessor<
  TPersisted extends object,
  TDecoded extends object = TPersisted,
>(
  options: RunApplicationStreamBatchProcessorOptions<TPersisted, TDecoded>,
): Promise<{ readonly processed: number; readonly deadLettered: number; readonly checkpoint: number; readonly exhausted: boolean }> {
  const maxBatches = options.maxBatches ?? 100;
  if (!Number.isSafeInteger(options.maxItems) || options.maxItems < 1 || options.maxItems > 1_000) throw new Error('Stream batch processor maxItems must be between 1 and 1000.');
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1) throw new Error('Stream batch processor maxBytes must be a positive safe integer.');
  if (!Number.isSafeInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 64) throw new Error('Stream batch processor concurrency must be between 1 and 64.');
  if (!Number.isSafeInteger(maxBatches) || maxBatches < 1 || maxBatches > 10_000) throw new Error('Stream batch processor maxBatches must be between 1 and 10000.');
  if (!options.store.pendingBatchGroup || !options.store.freezeBatchGroup || !options.store.markBatchComplete || !options.store.completeBatchGroup) {
    throw new Error('Stream batch processor store does not support durable frozen manifests.');
  }
  await options.store.prepare();
  let checkpoint = await options.store.checkpoint(options.processor, options.streamName);
  let processed = 0;
  let deadLettered = 0;
  for (let index = 0; index < maxBatches; index += 1) {
    // typecast: the stream source validates every payload before the
    // provider-neutral store restores this processor's frozen manifest.
    let group = await options.store.pendingBatchGroup(options.processor, options.streamName) as ApplicationFrozenStreamBatchGroup<TPersisted> | undefined;
    let exhausted = false;
    if (!group) {
      const page = await options.source.read(
        checkpoint,
        Math.min(1_000, options.maxItems * options.concurrency),
      );
      if (page.retentionFloor > checkpoint) throw new ApplicationStreamProcessorRetentionGapError(options.processor, options.streamName, checkpoint, page.retentionFloor);
      const frozen = freezeStreamBatchGroup(
        options.processor,
        options.streamName,
        page.items,
        options.maxItems,
        options.maxBytes,
        options.concurrency,
      );
      if (!frozen) return { processed, deadLettered, checkpoint, exhausted: true };
      exhausted = page.exhausted && frozen.lastSequence === page.nextSequence;
      group = await options.store.freezeBatchGroup(
        options.processor,
        options.streamName,
        frozen as ApplicationFrozenStreamBatchGroup<object>,
      ) as ApplicationFrozenStreamBatchGroup<TPersisted>;
    }
    const completed = new Set(group.completedBatchIds);
    const pending = group.batches.filter((batch) => !completed.has(batch.id));
    const results = await concurrentMap(pending, options.concurrency, async (batch) => {
      const result = await processFrozenBatch(options, batch);
      if (result.state !== 'failed') {
        await options.store.markBatchComplete?.(
          options.processor,
          options.streamName,
          group.id,
          batch.id,
        );
      }
      return { batch, result };
    });
    const failed = results.find(({ result }) => result.state === 'failed');
    if (failed?.result.state === 'failed') {
      throw new ApplicationStreamProcessorPausedError(options.processor, failed.batch.id, failed.result.error);
    }
    processed += results
      .filter(({ result }) => result.state === 'processed')
      .reduce((sum, { batch }) => sum + batch.events.length, 0);
    deadLettered += results
      .filter(({ result }) => result.state === 'deadLettered')
      .reduce((sum, { batch }) => sum + batch.events.length, 0);
    checkpoint = group.lastSequence;
    await options.store.completeBatchGroup(options.processor, options.streamName, group.id, checkpoint);
    if (exhausted) return { processed, deadLettered, checkpoint, exhausted: true };
  }
  return { processed, deadLettered, checkpoint, exhausted: false };
}

function partitionOrderedBatches<TPayload extends object>(
  events: readonly ApplicationStreamEnvelope<TPayload>[],
  maxItems: number,
  maxBytes: number,
  concurrency: number,
): readonly (readonly ApplicationStreamEnvelope<TPayload>[])[] {
  const batches = new Map<string, { events: ApplicationStreamEnvelope<TPayload>[]; bytes: number }>();
  for (const event of events) {
    let batch = batches.get(event.partitionKey);
    if (!batch) {
      if (batches.size >= concurrency) break;
      batch = { events: [], bytes: 0 };
      batches.set(event.partitionKey, batch);
    }
    const eventBytes = Buffer.byteLength(JSON.stringify(event));
    if (
      batch.events.length >= maxItems
      || (batch.events.length > 0 && batch.bytes + eventBytes > maxBytes)
    ) {
      break;
    }
    batch.events.push(event);
    batch.bytes += eventBytes;
  }
  return [...batches.values()].map((batch) => batch.events);
}

function freezeStreamBatchGroup<TPayload extends object>(
  processor: string,
  stream: string,
  events: readonly ApplicationStreamEnvelope<TPayload>[],
  maxItems: number,
  maxBytes: number,
  concurrency: number,
): ApplicationFrozenStreamBatchGroup<TPayload> | undefined {
  const partitions = partitionOrderedBatches(events, maxItems, maxBytes, concurrency);
  const included = partitions.flat();
  const first = included[0];
  const last = included.reduce<ApplicationStreamEnvelope<TPayload> | undefined>(
    (latest, event) => !latest || event.sequence > latest.sequence ? event : latest,
    undefined,
  );
  if (!first || !last) return undefined;
  const batches = partitions.map((partition) => freezeStreamBatch(processor, stream, partition));
  const orderedMembership = [...included].sort(
    (left, right) => left.sequence - right.sequence,
  );
  const identity = createHash('sha256')
    .update(JSON.stringify({
      processor,
      stream,
      membership: orderedMembership.map((event) => [event.id, event.sequence]),
    }))
    .digest('hex');
  return Object.freeze({
    id: `batch-group-${identity}`,
    firstSequence: orderedMembership[0]?.sequence ?? first.sequence,
    lastSequence: last.sequence,
    batches: Object.freeze(batches),
    completedBatchIds: Object.freeze([]),
  });
}

function freezeStreamBatch<TPayload extends object>(
  processor: string,
  stream: string,
  events: readonly ApplicationStreamEnvelope<TPayload>[],
): ApplicationFrozenStreamBatch<TPayload> {
  const first = events[0];
  const last = events[events.length - 1];
  if (!first || !last) throw new Error('Cannot freeze an empty stream batch.');
  const identity = createHash('sha256')
    .update(JSON.stringify({
      processor,
      stream,
      partition: first.partitionKey,
      membership: events.map((event) => [event.id, event.sequence]),
    }))
    .digest('hex');
  return Object.freeze({
    id: `batch-${identity}`,
    partition: first.partitionKey,
    firstSequence: first.sequence,
    lastSequence: last.sequence,
    events: Object.freeze([...events]),
  });
}

async function processFrozenBatch<
  TPersisted extends object,
  TDecoded extends object,
>(
  options: RunApplicationStreamBatchProcessorOptions<TPersisted, TDecoded>,
  frozen: ApplicationFrozenStreamBatch<TPersisted>,
): Promise<ProcessResult> {
  const inputBytes = Buffer.byteLength(JSON.stringify(frozen.events));
  if (inputBytes > options.maxInputBytes) {
    return terminalBatchFailure(options, frozen, 0, `Batch is ${inputBytes} bytes and exceeds the ${options.maxInputBytes}-byte processor limit.`);
  }
  let lastError = 'unknown stream batch processor failure';
  for (let attempt = 1; attempt <= options.retry.maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const values = await Promise.all(frozen.events.map(async (event) => {
        const admission = await options.admit({
          envelope: event,
          attempt,
          signal: controller.signal,
        });
        controller.signal.throwIfAborted();
        return {
          event,
          admission,
          value: await decodeStreamPayload(
            options.decodePayload,
            event.payload,
            streamPayloadDecodeContext(event, controller.signal, admission),
          ),
        };
      }));
      controller.signal.throwIfAborted();
      const batch = Object.freeze({
        id: frozen.id,
        events: Object.freeze(values.map(({ event, admission, value }) => Object.freeze({
          admission,
          id: event.id,
          stream: event.stream,
          sequence: event.sequence,
          recordedAt: event.recordedAt,
          partitionKey: event.partitionKey,
          ...(event.contextDigest ? { contextDigest: event.contextDigest } : {}),
          ...(event.changeScopes ? { changeScopes: event.changeScopes } : {}),
          ...(event.principal ? { principal: event.principal } : {}),
          trustedContext: Object.freeze({ ...(event.trustedContext ?? {}) }),
          value,
        }))),
        ...(frozen.partition ? { partition: frozen.partition } : {}),
        firstSequence: String(frozen.firstSequence),
        lastSequence: String(frozen.lastSequence),
      }) satisfies ApplicationEventBatch<TDecoded>;
      await options.handle(batch, {
        batch: {
          id: frozen.id,
          ...(frozen.partition ? { partition: frozen.partition } : {}),
          firstSequence: String(frozen.firstSequence),
          lastSequence: String(frozen.lastSequence),
        },
        schedules: Object.freeze({}),
        workflows: Object.freeze({}),
        tasks: Object.freeze({}),
        idempotencyKey: frozen.id,
        attempt,
        signal: controller.signal,
      });
      return { state: 'processed', eventId: frozen.id };
    } catch (error) {
      lastError = controller.signal.aborted
        ? `Timed out after ${options.timeoutMs}ms`
        : applicationStreamProcessorErrorMessage(error);
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < options.retry.maxAttempts) await sleep(Math.min(options.retry.maxDelayMs, options.retry.initialDelayMs * options.retry.factor ** (attempt - 1)));
  }
  return terminalBatchFailure(options, frozen, options.retry.maxAttempts, lastError);
}

async function terminalBatchFailure<
  TPersisted extends object,
  TDecoded extends object,
>(
  options: RunApplicationStreamBatchProcessorOptions<TPersisted, TDecoded>,
  frozen: ApplicationFrozenStreamBatch<TPersisted>,
  attempts: number,
  error: string,
): Promise<ProcessResult> {
  if (options.failure === 'pause') return { state: 'failed', eventId: frozen.id, error };
  await Promise.all(frozen.events.map((event) => options.store.deadLetter(
    options.processor,
    options.streamName,
    event,
    attempts,
    `Batch ${frozen.id}: ${error}`,
  )));
  return { state: 'deadLettered', eventId: frozen.id };
}

type ProcessResult = { readonly state: 'processed'; readonly eventId: string } | { readonly state: 'deadLettered'; readonly eventId: string } | { readonly state: 'failed'; readonly eventId: string; readonly error: string };

async function processEnvelope<
  TPersisted extends object,
  TDecoded extends object,
>(
  options: RunApplicationStreamProcessorOptions<TPersisted, TDecoded>,
  envelope: ApplicationStreamEnvelope<TPersisted>,
): Promise<ProcessResult> {
  const bytes = Buffer.byteLength(JSON.stringify(envelope.payload));
  if (bytes > options.maxInputBytes) return terminalFailure(options, envelope, 0, `Payload is ${bytes} bytes and exceeds the ${options.maxInputBytes}-byte processor limit.`);
  let lastError = 'unknown stream processor failure';
  for (let attempt = 1; attempt <= options.retry.maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const admission = await options.admit({
        envelope,
        attempt,
        signal: controller.signal,
      });
      controller.signal.throwIfAborted();
      const context: ApplicationStreamProcessContext = {
        admission,
        event: {
          id: envelope.id,
          stream: envelope.stream,
          sequence: envelope.sequence,
          recordedAt: envelope.recordedAt,
          partitionKey: envelope.partitionKey,
          ...(envelope.contextDigest ? { contextDigest: envelope.contextDigest } : {}),
          ...(envelope.changeScopes ? { changeScopes: envelope.changeScopes } : {}),
        },
        ...(envelope.principal ? { principal: envelope.principal } : {}),
        trustedContext: envelope.trustedContext ?? {},
        schedules: Object.freeze({}),
        workflows: Object.freeze({}),
        tasks: Object.freeze({}),
        idempotencyKey: envelope.id,
        attempt,
        signal: controller.signal,
      };
      const payload = await decodeStreamPayload(
        options.decodePayload,
        envelope.payload,
        streamPayloadDecodeContext(envelope, controller.signal, admission),
      );
      controller.signal.throwIfAborted();
      await options.handle(payload, context);
      return { state: 'processed', eventId: envelope.id };
    } catch (error) {
      lastError = controller.signal.aborted
        ? `Timed out after ${options.timeoutMs}ms`
        : applicationStreamProcessorErrorMessage(error);
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < options.retry.maxAttempts) await sleep(Math.min(options.retry.maxDelayMs, options.retry.initialDelayMs * options.retry.factor ** (attempt - 1)));
  }
  return terminalFailure(options, envelope, options.retry.maxAttempts, lastError);
}

/**
 * Preserves the public-safe durable rejection envelope in dead-letter evidence.
 * Error.message alone drops the model and target that operators need to repair
 * an inferred transaction, while stack traces and arbitrary enumerable fields
 * can contain implementation or credential detail and must not be persisted.
 */
function applicationStreamProcessorErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (!error || typeof error !== 'object') return message;
  const code = Reflect.get(error, 'code');
  const rejection = Reflect.get(error, 'rejection');
  if (
    code !== 'applik8s-command-rejected'
    || !rejection
    || typeof rejection !== 'object'
  ) {
    return message;
  }
  const name = Reflect.get(rejection, 'name');
  const payload = Reflect.get(rejection, 'payload');
  if (typeof name !== 'string' || !payload || typeof payload !== 'object') {
    return message;
  }
  return `${message}: ${JSON.stringify({ name, payload })}`;
}

function streamPayloadDecodeContext<TPayload extends object>(
  envelope: ApplicationStreamEnvelope<TPayload>,
  signal: AbortSignal,
  admission: ApplicationAdmissionInvocationContextV1,
): Parameters<ApplicationStreamPayloadDecoder<TPayload, object>>[1] {
  return {
    admission,
    event: {
      id: envelope.id,
      stream: envelope.stream,
      sequence: envelope.sequence,
      recordedAt: envelope.recordedAt,
      partitionKey: envelope.partitionKey,
      ...(envelope.contextDigest ? { contextDigest: envelope.contextDigest } : {}),
      ...(envelope.changeScopes ? { changeScopes: envelope.changeScopes } : {}),
    },
    ...(envelope.principal ? { principal: envelope.principal } : {}),
    trustedContext: envelope.trustedContext ?? {},
    signal,
  };
}

async function decodeStreamPayload<
  TPersisted extends object,
  TDecoded extends object,
>(
  decoder: ApplicationStreamPayloadDecoder<TPersisted, TDecoded> | undefined,
  payload: TPersisted,
  context: Parameters<
    ApplicationStreamPayloadDecoder<TPersisted, TDecoded>
  >[1],
): Promise<TDecoded> {
  if (decoder) return await decoder(payload, context);
  // typecast: when no decoder is supplied the public options default TDecoded
  // to TPersisted. Callers selecting a distinct decoded type must provide the
  // decoder that establishes that boundary.
  return payload as unknown as TDecoded;
}

async function terminalFailure<
  TPersisted extends object,
  TDecoded extends object,
>(
  options: RunApplicationStreamProcessorOptions<TPersisted, TDecoded>,
  envelope: ApplicationStreamEnvelope<TPersisted>,
  attempts: number,
  error: string,
): Promise<ProcessResult> {
  if (options.failure === 'pause') return { state: 'failed', eventId: envelope.id, error };
  await options.store.deadLetter(options.processor, options.streamName, envelope, attempts, error);
  return { state: 'deadLettered', eventId: envelope.id };
}

async function concurrentMap<TInput, TOutput>(items: readonly TInput[], concurrency: number, map: (item: TInput) => Promise<TOutput>): Promise<readonly TOutput[]> {
  const results = new Array<TOutput>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item !== undefined) results[index] = await map(item);
    }
  }));
  return results;
}

/**
 * Preserves the stream partition contract without giving up bounded
 * concurrency. Events from one partition are always handled in source order;
 * independent partitions may execute in parallel. A paused partition never
 * executes later events from the same page after its first failure.
 */
async function processPartitionedEnvelopes<TPayload extends object>(
  items: readonly ApplicationStreamEnvelope<TPayload>[],
  concurrency: number,
  process: (item: ApplicationStreamEnvelope<TPayload>) => Promise<ProcessResult>,
): Promise<readonly ProcessResult[]> {
  const partitions = new Map<
    string,
    Array<{
      readonly index: number;
      readonly envelope: ApplicationStreamEnvelope<TPayload>;
    }>
  >();
  for (const [index, envelope] of items.entries()) {
    const partition = partitions.get(envelope.partitionKey) ?? [];
    partition.push({ index, envelope });
    partitions.set(envelope.partitionKey, partition);
  }
  const results = new Array<ProcessResult>(items.length);
  await concurrentMap(
    [...partitions.values()],
    concurrency,
    async (partition) => {
      let blocked: Extract<ProcessResult, { readonly state: 'failed' }> | undefined;
      for (const item of partition) {
        if (blocked) {
          results[item.index] = blocked;
          continue;
        }
        const result = await process(item.envelope);
        results[item.index] = result;
        if (result.state === 'failed') blocked = result;
      }
    },
  );
  return results;
}

function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

export class ApplicationStreamProcessorRetentionGapError extends Error {
  readonly code = 'APPLIK8S_STREAM_PROCESSOR_RETENTION_GAP';
  constructor(readonly processor: string, readonly stream: string, readonly checkpoint: number, readonly retentionFloor: number) {
    super(`Stream processor ${processor} checkpoint ${checkpoint} is behind retained stream ${stream} floor ${retentionFloor}. Rebuild from authority or increase retention.`);
    this.name = 'ApplicationStreamProcessorRetentionGapError';
  }
}

export class ApplicationStreamProcessorPausedError extends Error {
  readonly code = 'APPLIK8S_STREAM_PROCESSOR_PAUSED';
  constructor(readonly processor: string, readonly eventId: string, readonly detail: string) {
    super(`Stream processor ${processor} paused at event ${eventId}: ${detail}`);
    this.name = 'ApplicationStreamProcessorPausedError';
  }
}
