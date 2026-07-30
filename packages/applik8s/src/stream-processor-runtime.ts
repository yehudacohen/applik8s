// typecast-file-boundary: stream envelope payloads are schema-authoritative and regain their declared payload generic after runtime decoding.

import type { ApplicationStreamProcessContext } from './application-reactive.js';
import type { ApplicationPostgresSql } from './postgres-runtime-contract.js';
import { createApplicationPostgresSql } from './postgres-runtime-loader.js';
import type { ApplicationReplayableStream, ApplicationStreamEnvelope } from './projection-runtime-clickhouse.js';

export interface ApplicationStreamProcessorStore {
  prepare(): Promise<void>;
  checkpoint(processor: string, stream: string): Promise<number>;
  advance(processor: string, stream: string, sequence: number): Promise<void>;
  deadLetter(processor: string, stream: string, envelope: ApplicationStreamEnvelope, attempts: number, error: string): Promise<void>;
  close(): Promise<void>;
}

export interface PostgresApplicationStreamProcessorStoreOptions {
  readonly databaseUrl?: string;
  readonly sql?: ApplicationPostgresSql;
}

export function createPostgresApplicationStreamProcessorStore(options: PostgresApplicationStreamProcessorStoreOptions): ApplicationStreamProcessorStore {
  if (!options.sql && !options.databaseUrl) throw new Error('PostgreSQL stream processor store requires sql or databaseUrl.');
  const ownsClient = !options.sql;
  const sql = options.sql ? Promise.resolve(options.sql) : createApplicationPostgresSql(options.databaseUrl as string, { max: 4, idle_timeout: 20, connect_timeout: 10, prepare: false });
  return {
    async prepare() {
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
      await (await sql).unsafe(`INSERT INTO applik8s_stream_processor_dead_letters (processor, stream, event_id, sequence, partition_key, recorded_at, payload, attempts, error)
VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::jsonb, $8, $9)
ON CONFLICT (processor, stream, event_id) DO UPDATE SET attempts = greatest(applik8s_stream_processor_dead_letters.attempts, EXCLUDED.attempts), error = EXCLUDED.error, failed_at = now()`, [processor, stream, envelope.id, envelope.sequence, envelope.partitionKey, envelope.recordedAt, JSON.stringify(envelope.payload), attempts, error.slice(0, 4_000)]);
    },
    async close() { if (ownsClient) await (await sql).end({ timeout: 5 }); },
  };
}

export interface RunApplicationStreamProcessorOptions<TPayload extends object> {
  readonly processor: string;
  readonly streamName: string;
  readonly source: ApplicationReplayableStream<TPayload>;
  readonly store: ApplicationStreamProcessorStore;
  readonly handle: (payload: TPayload, context: ApplicationStreamProcessContext) => void | Promise<void>;
  readonly concurrency: number;
  readonly retry: { readonly maxAttempts: number; readonly initialDelayMs: number; readonly maxDelayMs: number; readonly factor: number };
  readonly failure: 'pause' | 'deadLetter';
  readonly timeoutMs: number;
  readonly maxInputBytes: number;
  readonly batchSize?: number;
  readonly maxBatches?: number;
}

export async function runApplicationStreamProcessor<TPayload extends object>(options: RunApplicationStreamProcessorOptions<TPayload>): Promise<{ readonly processed: number; readonly deadLettered: number; readonly checkpoint: number; readonly exhausted: boolean }> {
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
    const results = await concurrentMap(page.items, options.concurrency, async (envelope) => processEnvelope(options, envelope));
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

type ProcessResult = { readonly state: 'processed'; readonly eventId: string } | { readonly state: 'deadLettered'; readonly eventId: string } | { readonly state: 'failed'; readonly eventId: string; readonly error: string };

async function processEnvelope<TPayload extends object>(options: RunApplicationStreamProcessorOptions<TPayload>, envelope: ApplicationStreamEnvelope<TPayload>): Promise<ProcessResult> {
  const bytes = Buffer.byteLength(JSON.stringify(envelope.payload));
  if (bytes > options.maxInputBytes) return terminalFailure(options, envelope, 0, `Payload is ${bytes} bytes and exceeds the ${options.maxInputBytes}-byte processor limit.`);
  let lastError = 'unknown stream processor failure';
  for (let attempt = 1; attempt <= options.retry.maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      await options.handle(envelope.payload, {
        event: {
          id: envelope.id,
          stream: envelope.stream,
          sequence: envelope.sequence,
          recordedAt: envelope.recordedAt,
          partitionKey: envelope.partitionKey,
          ...(envelope.contextDigest ? { contextDigest: envelope.contextDigest } : {}),
        },
        ...(envelope.principal ? { principal: envelope.principal } : {}),
        trustedContext: envelope.trustedContext ?? {},
        schedules: Object.freeze({}),
		tasks: Object.freeze({}),
        idempotencyKey: envelope.id,
        attempt,
        signal: controller.signal,
      });
      return { state: 'processed', eventId: envelope.id };
    } catch (error) {
      lastError = controller.signal.aborted ? `Timed out after ${options.timeoutMs}ms` : error instanceof Error ? error.message : String(error);
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < options.retry.maxAttempts) await sleep(Math.min(options.retry.maxDelayMs, options.retry.initialDelayMs * options.retry.factor ** (attempt - 1)));
  }
  return terminalFailure(options, envelope, options.retry.maxAttempts, lastError);
}

async function terminalFailure<TPayload extends object>(options: RunApplicationStreamProcessorOptions<TPayload>, envelope: ApplicationStreamEnvelope<TPayload>, attempts: number, error: string): Promise<ProcessResult> {
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
