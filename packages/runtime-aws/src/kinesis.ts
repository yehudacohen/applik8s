// typecast-file-boundary: Kinesis and DynamoDB transport payloads are validated before conversion to provider-neutral command envelopes and checkpoint state.
import { createHash, randomUUID } from 'node:crypto';
import type { ApplicationMessageEnvelope, ApplicationModelCommandDeliveryOptions } from '@applik8s/applik8s';
import { type ApplicationEventConsumerBinding, executeApplicationEventConsumerBinding, type RunningApplicationEventConsumer } from '@applik8s/applik8s/event-log-runtime';
import type { ApplicationCommandProcessorBinding, ApplicationEventLogPublisher, RunningApplicationCommandProcessor } from '@applik8s/applik8s/processor-runtime';
import { isDurableCommandRejectedError } from '@applik8s/applik8s/processor-runtime';
import type { ApplicationAuthorizationReceipt } from '@applik8s/core';
import { validateApplicationAuthorizationReceipt } from '@applik8s/core';
import {
  type AttributeValue,
  ConditionalCheckFailedException,
  DynamoDBClient,
  type DynamoDBClientConfig,
  GetItemCommand,
  QueryCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import {
  DescribeStreamSummaryCommand,
  GetRecordsCommand,
  GetShardIteratorCommand,
  KinesisClient,
  type KinesisClientConfig,
  type _Record as KinesisRecord,
  ListShardsCommand,
  PutRecordCommand,
} from '@aws-sdk/client-kinesis';

export interface KinesisEventLogOptions {
  readonly streamName: string;
  readonly checkpointTable?: string;
  readonly region?: string;
  readonly endpoint?: string;
  readonly client?: Pick<KinesisClient, 'send'>;
  readonly checkpointClient?: Pick<DynamoDBClient, 'send'>;
}

interface KinesisCheckpointConsumerOptions extends KinesisEventLogOptions {
  readonly checkpointTable: string;
  readonly consumer: string;
  readonly maxAttempts?: number;
  readonly retryDelayMs?: number;
  readonly maxRetryDelayMs?: number;
  readonly leaseDurationMs?: number;
  readonly pollIntervalMs?: number;
  readonly logger?: (record: Readonly<Record<string, unknown>>) => void;
}

export interface KinesisCommandProcessorOptions extends KinesisCheckpointConsumerOptions {
  readonly bindings: readonly ApplicationCommandProcessorBinding[];
  readonly databaseUrl?: string;
}

export interface KinesisEventConsumerOptions extends KinesisCheckpointConsumerOptions {
  readonly bindings: readonly ApplicationEventConsumerBinding[];
}

export type KinesisCommandRecordDisposition = 'acked' | 'ignored' | 'retried' | 'terminated';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function createKinesisEventLog(options: KinesisEventLogOptions): ApplicationEventLogPublisher {
  const stream = options.client ?? new KinesisClient(clientConfig(options));
  const checkpoints = options.checkpointTable
    ? options.checkpointClient ?? new DynamoDBClient(clientConfig(options))
    : undefined;
  return {
    async verify() {
      const response = await stream.send(new DescribeStreamSummaryCommand({ StreamName: options.streamName }));
      if (response.StreamDescriptionSummary?.StreamStatus !== 'ACTIVE') throw new Error(`applik8s-eventlog-stream-incompatible: Kinesis ${options.streamName} is not ACTIVE.`);
    },
    async publish(envelope, channel = 'events') {
      const partitionKey = boundedPartitionKey(envelope.partitionKey ?? envelope.tenant ?? envelope.id);
      const response = await stream.send(new PutRecordCommand({
        StreamName: options.streamName,
        PartitionKey: partitionKey,
        Data: encoder.encode(JSON.stringify({ ...envelope, channel })),
      }));
      if (!response.SequenceNumber || !response.ShardId) throw new Error(`Kinesis ${options.streamName} did not acknowledge message ${envelope.id}.`);
      return { stream: options.streamName, sequence: response.SequenceNumber, duplicate: false, subject: `${channel}:${response.ShardId}`, messageId: envelope.id };
    },
    async consumerLag(consumer) {
      if (!checkpoints || !options.checkpointTable) return { pending: 0, ackPending: 0, redelivered: 0 };
      const response = await checkpoints.send(new QueryCommand({
        TableName: options.checkpointTable,
        KeyConditionExpression: 'consumerKey = :consumer',
        ExpressionAttributeValues: { ':consumer': { S: consumerKey(options.streamName, consumer) } },
        ProjectionExpression: 'millisBehindLatest, failureAttempts',
        ConsistentRead: true,
      }));
      const items = response.Items ?? [];
      return {
        pending: items.filter((item) => numberAttribute(item.millisBehindLatest) > 0).length,
        ackPending: 0,
        redelivered: items.reduce((sum, item) => sum + numberAttribute(item.failureAttempts), 0),
      };
    },
    async drain() {},
  };
}

export async function startKinesisCommandProcessor(options: KinesisCommandProcessorOptions): Promise<RunningApplicationCommandProcessor> {
  validateBindings(options.bindings);
  const stream = options.client ?? new KinesisClient(clientConfig(options));
  const checkpoints = options.checkpointClient ?? new DynamoDBClient(clientConfig(options));
  const eventLog = createKinesisEventLog({ ...options, client: stream, checkpointClient: checkpoints });
  await eventLog.verify();
  const controller = new AbortController();
  const normalShutdown = Symbol('applik8s-kinesis-normal-shutdown');
  const owner = randomUUID();
  const loops = new Map<string, Promise<void>>();
  let rejectFailure!: (cause: unknown) => void;
  const failure = new Promise<never>((_resolve, reject) => { rejectFailure = reject; });
  const fail = (cause: unknown): void => {
    if (controller.signal.aborted) return;
    controller.abort(cause);
    rejectFailure(cause);
  };
  const supervise = (async () => {
    while (!controller.signal.aborted) {
      const response = await stream.send(new ListShardsCommand({ StreamName: options.streamName }));
      for (const shard of response.Shards ?? []) {
        if (!shard.ShardId || loops.has(shard.ShardId)) continue;
        const shardId = shard.ShardId;
        const running = consumeShard(stream, checkpoints, eventLog, options, shardId, owner, controller.signal)
          .catch((cause: unknown) => { fail(cause); })
          .finally(() => loops.delete(shardId));
        loops.set(shardId, running);
      }
      await abortableDelay(10_000, controller.signal);
    }
  })().catch((cause: unknown) => { fail(cause); });
  const completion = Promise.all([supervise, allShardLoops(loops, controller.signal)]).then(() => {
    if (controller.signal.reason !== normalShutdown) throw controller.signal.reason ?? new Error('Kinesis command processor stopped unexpectedly.');
  });
  const closed = Promise.race([completion, failure]);
  return {
    closed,
    async drain() {
      if (!controller.signal.aborted) controller.abort(normalShutdown);
      await Promise.allSettled([supervise, ...loops.values()]);
      await completion;
    },
  };
}

/** Starts a durable event consumer whose DynamoDB checkpoint advances only after the binding resolves. */
export async function startKinesisEventConsumer(options: KinesisEventConsumerOptions): Promise<RunningApplicationEventConsumer> {
  validateEventBindings(options.bindings);
  const stream = options.client ?? new KinesisClient(clientConfig(options));
  const checkpoints = options.checkpointClient ?? new DynamoDBClient(clientConfig(options));
  const eventLog = createKinesisEventLog({ ...options, client: stream, checkpointClient: checkpoints });
  await eventLog.verify();
  const controller = new AbortController();
  const normalShutdown = Symbol('applik8s-kinesis-event-normal-shutdown');
  const owner = randomUUID();
  const loops = new Map<string, Promise<void>>();
  let rejectFailure!: (cause: unknown) => void;
  const failure = new Promise<never>((_resolve, reject) => { rejectFailure = reject; });
  const fail = (cause: unknown): void => {
    if (controller.signal.aborted) return;
    controller.abort(cause);
    rejectFailure(cause);
  };
  const supervise = (async () => {
    while (!controller.signal.aborted) {
      const response = await stream.send(new ListShardsCommand({ StreamName: options.streamName }));
      for (const shard of response.Shards ?? []) {
        if (!shard.ShardId || loops.has(shard.ShardId)) continue;
        const shardId = shard.ShardId;
        const running = consumeEventShard(stream, checkpoints, eventLog, options, shardId, owner, controller.signal)
          .catch((cause: unknown) => { fail(cause); })
          .finally(() => loops.delete(shardId));
        loops.set(shardId, running);
      }
      await abortableDelay(10_000, controller.signal);
    }
  })().catch((cause: unknown) => { fail(cause); });
  const completion = Promise.all([supervise, allShardLoops(loops, controller.signal)]).then(() => {
    if (controller.signal.reason !== normalShutdown) throw controller.signal.reason ?? new Error('Kinesis event consumer stopped unexpectedly.');
  });
  return {
    closed: Promise.race([completion, failure]),
    async drain() {
      if (!controller.signal.aborted) controller.abort(normalShutdown);
      await Promise.allSettled([supervise, ...loops.values()]);
      await completion;
    },
  };
}

async function consumeEventShard(
  stream: Pick<KinesisClient, 'send'>,
  checkpoints: Pick<DynamoDBClient, 'send'>,
  eventLog: ApplicationEventLogPublisher,
  options: KinesisEventConsumerOptions,
  shardId: string,
  owner: string,
  signal: AbortSignal,
): Promise<void> {
  const leaseDurationMs = Math.max(5_000, options.leaseDurationMs ?? 30_000);
  while (!signal.aborted) {
    const lease = await acquireLease(checkpoints, options, shardId, owner, leaseDurationMs);
    if (!lease) {
      await abortableDelay(Math.min(2_000, leaseDurationMs / 4), signal);
      continue;
    }
    let iterator = await stream.send(new GetShardIteratorCommand({
      StreamName: options.streamName,
      ShardId: shardId,
      ShardIteratorType: lease.sequenceNumber ? 'AFTER_SEQUENCE_NUMBER' : 'TRIM_HORIZON',
      ...(lease.sequenceNumber ? { StartingSequenceNumber: lease.sequenceNumber } : {}),
    })).then(({ ShardIterator }) => ShardIterator);
    while (iterator && !signal.aborted) {
      await renewLease(checkpoints, options, shardId, owner, leaseDurationMs);
      const response = await stream.send(new GetRecordsCommand({ ShardIterator: iterator, Limit: 100 }));
      iterator = response.NextShardIterator;
      for (const record of response.Records ?? []) {
        if (!record.SequenceNumber) continue;
        await handleKinesisEventRecord(checkpoints, eventLog, options, shardId, owner, record, response.MillisBehindLatest ?? 0, signal);
      }
      if ((response.Records?.length ?? 0) === 0) await abortableDelay(options.pollIntervalMs ?? 250, signal);
    }
  }
}

export async function handleKinesisEventRecord(
  checkpoints: Pick<DynamoDBClient, 'send'>,
  eventLog: ApplicationEventLogPublisher,
  options: KinesisEventConsumerOptions,
  shardId: string,
  owner: string,
  record: KinesisRecord,
  millisBehindLatest: number,
  signal: AbortSignal,
): Promise<KinesisCommandRecordDisposition> {
  if (!record.SequenceNumber) throw new Error('Kinesis event record has no sequence number.');
  let decoded: DecodedKinesisEnvelope;
  try {
    decoded = parseEnvelope(record.Data);
  } catch (cause) {
    await recordInvalidEnvelope(checkpoints, options, shardId, owner, record.SequenceNumber, cause);
    await checkpoint(checkpoints, options, shardId, owner, record.SequenceNumber, millisBehindLatest);
    options.logger?.({ event: 'applik8s-event-envelope-invalid', shardId, sequence: record.SequenceNumber, error: safeErrorMessage(cause) });
    return 'terminated';
  }
  if (decoded.channel !== 'events') {
    await checkpoint(checkpoints, options, shardId, owner, record.SequenceNumber, millisBehindLatest);
    return 'ignored';
  }
  const binding = eventBindingFor(options.bindings, decoded.envelope.contract);
  if (!binding) {
    await eventLog.publish({ ...decoded.envelope, id: `${decoded.envelope.id}:dead-letter`, causationId: decoded.envelope.id }, 'dead-letter');
    await checkpoint(checkpoints, options, shardId, owner, record.SequenceNumber, millisBehindLatest);
    return 'terminated';
  }
  const failureState = await readFailureState(checkpoints, options, shardId);
  let attempt = failureState.sequence === record.SequenceNumber ? failureState.attempts : 0;
  for (;;) {
    signal.throwIfAborted();
    attempt += 1;
    // Persist the physical attempt before executing application work. If the
    // process or checkpoint write fails after the binding commits, the next
    // worker resumes with a retry attempt instead of fabricating another live
    // delivery for the same logical event.
    await recordFailure(checkpoints, options, shardId, owner, record.SequenceNumber, attempt);
    try {
      await executeApplicationEventConsumerBinding(binding, decoded.envelope, {
        attempt,
        transport: 'kinesis',
      });
    } catch (cause) {
      if (attempt < Math.max(1, options.maxAttempts ?? 5)) {
        await abortableDelay(retryDelay(attempt, options.retryDelayMs ?? 100, options.maxRetryDelayMs ?? 30_000), signal);
        if (signal.aborted) return 'retried';
        continue;
      }
      await eventLog.publish({ ...decoded.envelope, id: `${decoded.envelope.id}:dead-letter`, causationId: decoded.envelope.id }, 'dead-letter');
      await checkpoint(checkpoints, options, shardId, owner, record.SequenceNumber, millisBehindLatest);
      options.logger?.({ event: 'applik8s-event-dead-lettered', messageId: decoded.envelope.id, binding: binding.bindingId, attempt, error: safeErrorMessage(cause) });
      return 'terminated';
    }
    // The binding's manifest/frontier commit is the publication receipt.
    // This checkpoint deliberately follows it and is outside the handler
    // retry boundary: a checkpoint outage replays the idempotent publication
    // instead of falsely dead-lettering an already committed source fact.
    await checkpoint(checkpoints, options, shardId, owner, record.SequenceNumber, millisBehindLatest);
    options.logger?.({ event: 'applik8s-event-consumed', messageId: decoded.envelope.id, binding: binding.bindingId, attempt });
    return 'acked';
  }
}

async function consumeShard(
  stream: Pick<KinesisClient, 'send'>,
  checkpoints: Pick<DynamoDBClient, 'send'>,
  eventLog: ApplicationEventLogPublisher,
  options: KinesisCommandProcessorOptions,
  shardId: string,
  owner: string,
  signal: AbortSignal,
): Promise<void> {
  const leaseDurationMs = Math.max(5_000, options.leaseDurationMs ?? 30_000);
  while (!signal.aborted) {
    const lease = await acquireLease(checkpoints, options, shardId, owner, leaseDurationMs);
    if (!lease) {
      await abortableDelay(Math.min(2_000, leaseDurationMs / 4), signal);
      continue;
    }
    let iterator = await stream.send(new GetShardIteratorCommand({
      StreamName: options.streamName,
      ShardId: shardId,
      ShardIteratorType: lease.sequenceNumber ? 'AFTER_SEQUENCE_NUMBER' : 'TRIM_HORIZON',
      ...(lease.sequenceNumber ? { StartingSequenceNumber: lease.sequenceNumber } : {}),
    })).then(({ ShardIterator }) => ShardIterator);
    while (iterator && !signal.aborted) {
      await renewLease(checkpoints, options, shardId, owner, leaseDurationMs);
      const response = await stream.send(new GetRecordsCommand({ ShardIterator: iterator, Limit: 100 }));
      iterator = response.NextShardIterator;
      for (const record of response.Records ?? []) {
        if (!record.SequenceNumber) continue;
        await handleKinesisCommandRecord(checkpoints, eventLog, options, shardId, owner, record, response.MillisBehindLatest ?? 0, signal);
      }
      if ((response.Records?.length ?? 0) === 0) await abortableDelay(options.pollIntervalMs ?? 250, signal);
    }
  }
}

/**
 * Executes one Kinesis record against the durable shard checkpoint.
 *
 * Exported so runtime integrations can prove acknowledgement ordering without
 * starting a polling loop. The DynamoDB row remains the attempt and offset
 * authority across worker restarts.
 */
export async function handleKinesisCommandRecord(
  checkpoints: Pick<DynamoDBClient, 'send'>,
  eventLog: ApplicationEventLogPublisher,
  options: KinesisCommandProcessorOptions,
  shardId: string,
  owner: string,
  record: KinesisRecord,
  millisBehindLatest: number,
  signal: AbortSignal,
): Promise<KinesisCommandRecordDisposition> {
  if (!record.SequenceNumber) throw new Error('Kinesis command record has no sequence number.');
  let decoded: DecodedKinesisEnvelope;
  try {
    decoded = parseEnvelope(record.Data);
  } catch (cause) {
    await recordInvalidEnvelope(checkpoints, options, shardId, owner, record.SequenceNumber, cause);
    await checkpoint(checkpoints, options, shardId, owner, record.SequenceNumber, millisBehindLatest);
    options.logger?.({ event: 'applik8s-command-envelope-invalid', shardId, sequence: record.SequenceNumber, error: safeErrorMessage(cause) });
    return 'terminated';
  }
  if (decoded.channel !== 'commands') {
    await checkpoint(checkpoints, options, shardId, owner, record.SequenceNumber, millisBehindLatest);
    return 'ignored';
  }
  const envelope = decoded.envelope;
  const failure = await readFailureState(checkpoints, options, shardId);
  let attempt = failure.sequence === record.SequenceNumber ? failure.attempts : 0;
  for (;;) {
    signal.throwIfAborted();
    attempt += 1;
    const result = await executeEnvelope(envelope, attempt, options, eventLog);
    if (result === 'retry') {
      await recordFailure(checkpoints, options, shardId, owner, record.SequenceNumber!, attempt);
      await abortableDelay(retryDelay(attempt, options.retryDelayMs ?? 100, options.maxRetryDelayMs ?? 30_000), signal);
      if (signal.aborted) return 'retried';
      continue;
    }
    await checkpoint(checkpoints, options, shardId, owner, record.SequenceNumber!, millisBehindLatest);
    return result === 'ack' ? 'acked' : 'terminated';
  }
}

async function executeEnvelope(
  envelope: ApplicationMessageEnvelope<object>,
  attempt: number,
  options: KinesisCommandProcessorOptions,
  eventLog: ApplicationEventLogPublisher,
): Promise<'ack' | 'retry' | 'terminal'> {
  const binding = bindingFor(options.bindings, envelope.contract);
  if (!binding || (envelope.routing?.binding && envelope.routing.binding !== binding.bindingId)) {
    await eventLog.publish({ ...envelope, id: `${envelope.id}:dead-letter`, causationId: envelope.id }, 'dead-letter');
    options.logger?.({ event: 'applik8s-command-binding-missing', messageId: envelope.id, contract: envelope.contract });
    return 'terminal';
  }
  const delivery: ApplicationModelCommandDeliveryOptions = {
    id: envelope.id,
    ...(envelope.tenant ? { tenant: envelope.tenant } : {}),
    ...(envelope.correlationId ? { correlationId: envelope.correlationId } : {}),
    ...(envelope.causationId ? { causationId: envelope.causationId } : {}),
    ...(envelope.traceparent ? { traceparent: envelope.traceparent } : {}),
    ...(envelope.telemetry ? { telemetry: envelope.telemetry } : {}),
    attempt,
    recordedAt: envelope.recordedAt,
    ...(envelope.expectedRevision ? { expectedRevision: envelope.expectedRevision } : {}),
    ...(envelope.trustedContext ? { context: envelope.trustedContext } : {}),
    ...(envelope.authorizationReceipt ? { authorizationReceipt: envelope.authorizationReceipt } : {}),
    ...(envelope.routing?.targetKey ? { targetKey: envelope.routing.targetKey } : {}),
    ...(envelope.routing?.idempotencyKey ? { idempotencyKey: envelope.routing.idempotencyKey } : {}),
    ...(options.databaseUrl ? { databaseUrl: options.databaseUrl } : {}),
  };
  try {
    if (envelope.authorizationReceipt) {
      if (!binding.revalidateAuthorization || !binding.releaseAuthorization) throw new Error(`Binding ${binding.bindingId} lacks durable authorization hooks.`);
      const decision = await binding.revalidateAuthorization(envelope.authorizationReceipt, 'execution', delivery);
      if (!decision.allowed) {
        if (!binding.recordTerminalFailure) throw new Error(`Binding ${binding.bindingId} lacks a durable terminal recorder.`);
        await binding.recordTerminalFailure(envelope.payload, delivery, { code: 'authorization_denied', attempts: attempt });
        await binding.releaseAuthorization(envelope.authorizationReceipt, envelope.id);
        return 'ack';
      }
    }
    await binding.execute(envelope.payload, delivery);
    if (envelope.authorizationReceipt) await binding.releaseAuthorization!(envelope.authorizationReceipt, envelope.id);
    options.logger?.({ event: 'applik8s-command-processed', messageId: envelope.id, binding: binding.bindingId, attempt });
    return 'ack';
  } catch (cause) {
    if (isDurableCommandRejectedError(cause)) {
      if (envelope.authorizationReceipt) await binding.releaseAuthorization?.(envelope.authorizationReceipt, envelope.id);
      return 'ack';
    }
    if (attempt < Math.max(1, options.maxAttempts ?? 5)) return 'retry';
    if (!binding.recordTerminalFailure) throw new Error(`Binding ${binding.bindingId} lacks a durable terminal recorder.`, { cause });
    await eventLog.publish({ ...envelope, id: `${envelope.id}:dead-letter`, causationId: envelope.id }, 'dead-letter');
    await binding.recordTerminalFailure(envelope.payload, delivery, { code: 'processing_failed', attempts: attempt });
    if (envelope.authorizationReceipt) await binding.releaseAuthorization?.(envelope.authorizationReceipt, envelope.id);
    options.logger?.({ event: 'applik8s-command-dead-lettered', messageId: envelope.id, binding: binding.bindingId, attempt });
    return 'terminal';
  }
}

async function acquireLease(checkpoints: Pick<DynamoDBClient, 'send'>, options: KinesisCheckpointConsumerOptions, shardId: string, owner: string, leaseDurationMs: number): Promise<{ readonly sequenceNumber?: string } | undefined> {
  const now = Date.now();
  try {
    const response = await checkpoints.send(new UpdateItemCommand({
      TableName: options.checkpointTable,
      Key: checkpointKey(options, shardId),
      UpdateExpression: 'SET ownerToken = :owner, leaseUntil = :until, updatedAt = :now',
      ConditionExpression: 'attribute_not_exists(leaseUntil) OR leaseUntil < :now OR ownerToken = :owner',
      ExpressionAttributeValues: { ':owner': { S: owner }, ':until': { N: String(now + leaseDurationMs) }, ':now': { N: String(now) } },
      ReturnValues: 'ALL_NEW',
    }));
    const sequenceNumber = stringAttribute(response.Attributes?.sequenceNumber);
    return sequenceNumber ? { sequenceNumber } : {};
  } catch (cause) {
    if (cause instanceof ConditionalCheckFailedException || (cause && typeof cause === 'object' && Reflect.get(cause, 'name') === 'ConditionalCheckFailedException')) return undefined;
    throw cause;
  }
}

async function renewLease(checkpoints: Pick<DynamoDBClient, 'send'>, options: KinesisCheckpointConsumerOptions, shardId: string, owner: string, leaseDurationMs: number): Promise<void> {
  const now = Date.now();
  await checkpoints.send(new UpdateItemCommand({
    TableName: options.checkpointTable, Key: checkpointKey(options, shardId),
    UpdateExpression: 'SET leaseUntil = :until, updatedAt = :now', ConditionExpression: 'ownerToken = :owner',
    ExpressionAttributeValues: { ':owner': { S: owner }, ':until': { N: String(now + leaseDurationMs) }, ':now': { N: String(now) } },
  }));
}

async function recordFailure(checkpoints: Pick<DynamoDBClient, 'send'>, options: KinesisCheckpointConsumerOptions, shardId: string, owner: string, sequence: string, attempts: number): Promise<void> {
  await checkpoints.send(new UpdateItemCommand({
    TableName: options.checkpointTable, Key: checkpointKey(options, shardId),
    UpdateExpression: 'SET failureSequence = :sequence, failureAttempts = :attempts, updatedAt = :now', ConditionExpression: 'ownerToken = :owner',
    ExpressionAttributeValues: { ':owner': { S: owner }, ':sequence': { S: sequence }, ':attempts': { N: String(attempts) }, ':now': { N: String(Date.now()) } },
  }));
}

async function readFailureState(
  checkpoints: Pick<DynamoDBClient, 'send'>,
  options: KinesisCheckpointConsumerOptions,
  shardId: string,
): Promise<{ readonly sequence?: string; readonly attempts: number }> {
  const response = await checkpoints.send(new GetItemCommand({
    TableName: options.checkpointTable,
    Key: checkpointKey(options, shardId),
    ConsistentRead: true,
    ProjectionExpression: 'failureSequence, failureAttempts',
  }));
  const sequence = stringAttribute(response.Item?.failureSequence);
  return {
    ...(sequence ? { sequence } : {}),
    attempts: numberAttribute(response.Item?.failureAttempts),
  };
}

async function recordInvalidEnvelope(
  checkpoints: Pick<DynamoDBClient, 'send'>,
  options: KinesisCheckpointConsumerOptions,
  shardId: string,
  owner: string,
  sequence: string,
  cause: unknown,
): Promise<void> {
  await checkpoints.send(new UpdateItemCommand({
    TableName: options.checkpointTable,
    Key: checkpointKey(options, shardId),
    UpdateExpression: 'SET lastInvalidSequence = :sequence, lastInvalidReason = :reason, updatedAt = :now',
    ConditionExpression: 'ownerToken = :owner',
    ExpressionAttributeValues: {
      ':owner': { S: owner },
      ':sequence': { S: sequence },
      ':reason': { S: safeErrorMessage(cause).slice(0, 1_024) },
      ':now': { N: String(Date.now()) },
    },
  }));
}

async function checkpoint(checkpoints: Pick<DynamoDBClient, 'send'>, options: KinesisCheckpointConsumerOptions, shardId: string, owner: string, sequence: string, millisBehindLatest: number): Promise<void> {
  await checkpoints.send(new UpdateItemCommand({
    TableName: options.checkpointTable, Key: checkpointKey(options, shardId),
    UpdateExpression: 'SET sequenceNumber = :sequence, millisBehindLatest = :behind, updatedAt = :now REMOVE failureSequence, failureAttempts',
    ConditionExpression: 'ownerToken = :owner',
    ExpressionAttributeValues: { ':owner': { S: owner }, ':sequence': { S: sequence }, ':behind': { N: String(Math.max(0, millisBehindLatest)) }, ':now': { N: String(Date.now()) } },
  }));
}

function checkpointKey(options: KinesisCheckpointConsumerOptions, shardId: string): Record<string, AttributeValue> {
  return { consumerKey: { S: consumerKey(options.streamName, options.consumer) }, shardId: { S: shardId } };
}
function consumerKey(stream: string, consumer: string): string { return `${stream}\u0000${consumer}`; }

interface DecodedKinesisEnvelope {
  readonly channel: string;
  readonly envelope: ApplicationMessageEnvelope<object>;
}

function parseEnvelope(data: Uint8Array | undefined): DecodedKinesisEnvelope {
  if (!data) throw new Error('Kinesis command record has no data.');
  const value: unknown = JSON.parse(decoder.decode(data));
  if (!value || typeof value !== 'object') throw new Error('Kinesis command envelope must be an object.');
  const envelope = value as ApplicationMessageEnvelope<object>;
  if (!envelope.id || !envelope.contract?.name || !envelope.contract.version || !envelope.payload || !envelope.recordedAt) throw new Error('Kinesis command envelope is incomplete.');
  if (envelope.authorizationReceipt) {
    const diagnostics = validateApplicationAuthorizationReceipt(envelope.authorizationReceipt as ApplicationAuthorizationReceipt);
    if (diagnostics.length > 0) throw new Error(`Kinesis command authorization receipt is invalid: ${diagnostics.map(({ message }) => message).join(' ')}`);
  }
  const channel = Reflect.get(value, 'channel');
  return { channel: typeof channel === 'string' ? channel : 'commands', envelope };
}

function validateBindings(bindings: readonly ApplicationCommandProcessorBinding[]): void {
  if (bindings.length === 0) throw new Error('A Kinesis command processor requires at least one binding.');
  const identities = new Set<string>();
  for (const binding of bindings) {
    const identity = `${binding.contract.name}\u0000${binding.contract.version}`;
    if (identities.has(identity)) throw new Error(`Multiple Kinesis command bindings consume ${binding.contract.name}.${binding.contract.version}.`);
    identities.add(identity);
    if (!binding.recordTerminalFailure) throw new Error(`Kinesis command binding ${binding.bindingId} requires a durable terminal-failure recorder.`);
  }
}

function validateEventBindings(bindings: readonly ApplicationEventConsumerBinding[]): void {
  if (bindings.length === 0) throw new Error('A Kinesis event consumer requires at least one binding.');
  const contracts = new Set<string>();
  for (const binding of bindings) {
    const identity = `${binding.contract.name}\0${binding.contract.version}`;
    if (contracts.has(identity)) throw new Error(`Multiple Kinesis event bindings consume ${binding.contract.name}.${binding.contract.version}.`);
    contracts.add(identity);
  }
}

function eventBindingFor(bindings: readonly ApplicationEventConsumerBinding[], contract: { readonly name: string; readonly version: string }): ApplicationEventConsumerBinding | undefined {
  return bindings.find((binding) => binding.contract.name === contract.name && binding.contract.version === contract.version);
}

function bindingFor(bindings: readonly ApplicationCommandProcessorBinding[], contract: { readonly name: string; readonly version: string }): ApplicationCommandProcessorBinding | undefined {
  return bindings.find((binding) => binding.contract.name === contract.name && binding.contract.version === contract.version);
}
function retryDelay(attempt: number, initial: number, maximum: number): number { return Math.max(1, Math.min(maximum, initial * (2 ** Math.max(0, attempt - 1)))); }
function boundedPartitionKey(value: string): string {
  const normalized = value.trim() || 'unpartitioned';
  if (encoder.encode(normalized).byteLength <= 256) return normalized;
  return `sha256:${createHash('sha256').update(normalized).digest('hex')}`;
}
function clientConfig(options: { readonly region?: string; readonly endpoint?: string }): KinesisClientConfig & DynamoDBClientConfig { return { ...(options.region ? { region: options.region } : {}), ...(options.endpoint ? { endpoint: options.endpoint } : {}) }; }
function stringAttribute(value: AttributeValue | undefined): string | undefined { return value && 'S' in value ? value.S : undefined; }
function numberAttribute(value: AttributeValue | undefined): number { const parsed = value && 'N' in value ? Number(value.N) : 0; return Number.isFinite(parsed) ? parsed : 0; }
async function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> { if (signal.aborted) return; await new Promise<void>((resolve) => { const timer = setTimeout(resolve, milliseconds); signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true }); }); }
async function allShardLoops(loops: ReadonlyMap<string, Promise<void>>, signal: AbortSignal): Promise<void> { while (!signal.aborted) await abortableDelay(100, signal); await Promise.allSettled([...loops.values()]); }
function safeErrorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
