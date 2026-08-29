// typecast-file-boundary: adversarial stream fixtures deliberately restore provider records and callback generics after explicit shape checks.
import { type ApplicationEventBatch, type ApplicationFrozenStreamBatchGroup, type ApplicationReplayPage, type ApplicationStreamDeliveryAdmitter, ApplicationStreamProcessorPausedError, ApplicationStreamProcessorRetentionGapError, type ApplicationStreamProcessorStore, type ApplicationTelemetryBoundary, type ApplicationTelemetryRuntime, createPostgresApplicationStreamProcessorStore, installApplicationTelemetryRuntimeResolver, runApplicationStreamBatchProcessor, runApplicationStreamProcessor } from '@applik8s/applik8s';
import { applicationAdmissionInvocationView, applicationCausalPrincipalContext, createApplicationAdmissionContextV1, createApplicationExecutionPrincipalV1, createApplicationTelemetryEnvelopeV1, validateApplicationAdmissionContextV1WithoutReceipt, withApplicationAdmissionExecutionV1 } from '@applik8s/core';
import { describe, expect, it } from 'vitest';
import { testApplicationPrincipal } from '../../../test-support/application-principal.js';
import type { ApplicationPostgresSql, ApplicationPostgresTransactionSql } from '../src/postgres-runtime-contract.js';

function envelope(sequence: number) {
  return {
    id: `event-${sequence}`,
    stream: { name: 'posts.published', version: 'v1' },
    sequence,
    partitionKey: 'author-1',
    recordedAt: '2026-01-01T00:00:00.000Z',
    contextDigest: 'a'.repeat(64),
    changeScopes: {
      global: 'b'.repeat(64),
      'context:tenantId': 'c'.repeat(64),
    },
    principal: testApplicationPrincipal('author-1', { authorityRevision: 'authz-v1' }),
    trustedContext: { tenantId: 'tenant-1' },
    payload: { postId: `post-${sequence}` },
  };
}

function telemetry(sequence: number) {
  const span = sequence.toString(16).padStart(16, '0');
  return createApplicationTelemetryEnvelopeV1({
    traceparent: `00-0123456789abcdef0123456789abcdef-${span}-01`,
    identity: {
      application: 'test',
      environment: 'test',
      target: 'local',
      operation: 'posts.publish',
      execution: `publish:event-${sequence}`,
      attempt: 1,
      instance: `event-${sequence}`,
    },
  });
}

interface RecordedTelemetryMetric {
  readonly metric: string;
  readonly value: number;
  readonly attributes?: Readonly<Record<string, string | number | boolean>>;
}

interface RecordedTelemetryCompletion {
  readonly boundary: ApplicationTelemetryBoundary;
  readonly result: 'error' | 'ok';
  readonly errorType?: string;
}

function recordingTelemetryRuntime(
  boundaries: ApplicationTelemetryBoundary[],
  metrics: RecordedTelemetryMetric[] = [],
  completions: RecordedTelemetryCompletion[] = [],
): ApplicationTelemetryRuntime {
  return {
    async run(boundary, execute) {
      boundaries.push(boundary);
      try {
        const result = await execute();
        completions.push({ boundary, result: 'ok' });
        return result;
      } catch (error) {
        completions.push({
          boundary,
          result: 'error',
          errorType: error instanceof Error ? error.name : 'UnknownError',
        });
        throw error;
      }
    },
    log() {},
    count() {},
    record(metric, value, attributes) {
      metrics.push({ metric, value, ...(attributes ? { attributes } : {}) });
    },
    capture() { return undefined; },
  };
}

const admitStreamDelivery: ApplicationStreamDeliveryAdmitter<{
  readonly postId: string;
}> = ({ envelope: delivery, attempt, signal }) => {
  if (signal.aborted) throw new Error('test delivery aborted');
  const workloadIdentity = {
    id: 'identity:test:workload:stream-processor',
    kind: 'workload' as const,
    issuer: 'applik8s://test',
    subject: 'stream-processor',
  };
  const causal = delivery.principal
    ? applicationCausalPrincipalContext(delivery.principal)
    : { id: workloadIdentity.id, identity: workloadIdentity, grantIds: [] };
  const executionId = `stream-processor:${delivery.id}`;
  const deadline = new Date(Date.now() + 60_000).toISOString();
  const cancellationRevision = `active:${executionId}`;
  const principal = createApplicationExecutionPrincipalV1({
    application: 'test',
    executionKind: 'processor',
    executionId,
    attempt,
    workloadIdentity,
    causalPrincipal: causal,
    envelopes: [],
    trustedContextDigest: delivery.contextDigest ?? delivery.principal?.trustedContextDigest ?? 'test-context',
    audience: ['stream-processor'],
    catalogRevision: 'catalog-v1',
    authorityRevision: 'authority-v1',
    deadline,
    cancellationRevision,
    authenticationMethod: 'test-stream-delivery',
  });
  return applicationAdmissionInvocationView(
    validateApplicationAdmissionContextV1WithoutReceipt(
      withApplicationAdmissionExecutionV1(
        createApplicationAdmissionContextV1({
          admission: {
            principal,
            trustedContext: delivery.trustedContext ?? {},
          },
          operation: {
            id: 'applik8s://processors/test/operations/deliver',
            transport: 'broker',
          },
          correlationId: delivery.id,
        }),
        {
          causationId: delivery.id,
          deadline,
          cancellation: { revision: cancellationRevision },
          delivery: { id: delivery.id, source: 'test-stream' },
        },
      ),
    ),
  );
};

function store() {
  let checkpoint = 0;
  const deadLetters: string[] = [];
  const value: ApplicationStreamProcessorStore = {
    async prepare() {},
    async checkpoint() { return checkpoint; },
    async advance(_processor, _stream, sequence) { checkpoint = Math.max(checkpoint, sequence); },
    async deadLetter(_processor, _stream, event) { deadLetters.push(event.id); },
    async close() {},
  };
  return { value, deadLetters, checkpoint: () => checkpoint };
}

function batchStore() {
  let checkpoint = 0;
  let group: ApplicationFrozenStreamBatchGroup<{ postId: string }> | undefined;
  const deadLetters: string[] = [];
  const value: ApplicationStreamProcessorStore = {
    async prepare() {},
    async checkpoint() { return checkpoint; },
    async advance(_processor, _stream, sequence) { checkpoint = Math.max(checkpoint, sequence); },
    async deadLetter(_processor, _stream, event) { deadLetters.push(event.id); },
    async pendingBatchGroup() { return group; },
    async freezeBatchGroup(_processor, _stream, candidate) {
      group ??= candidate as ApplicationFrozenStreamBatchGroup<{ postId: string }>;
      return group;
    },
    async markBatchComplete(_processor, _stream, groupId, batchId) {
      if (!group || group.id !== groupId) throw new Error('unknown group');
      group = {
        ...group,
        completedBatchIds: [...new Set([...group.completedBatchIds, batchId])],
      };
    },
    async completeBatchGroup(_processor, _stream, groupId, sequence) {
      if (!group || group.id !== groupId || group.batches.some((batch) => !group?.completedBatchIds.includes(batch.id))) {
        throw new Error('incomplete group');
      }
      group = undefined;
      checkpoint = Math.max(checkpoint, sequence);
    },
    async close() {},
  };
  return {
    value,
    deadLetters,
    checkpoint: () => checkpoint,
    pending: () => group,
  };
}

describe('durable replay stream processor runtime', () => {
  it('persists batch manifests and dead letters as structured JSONB values', async () => {
    const calls: Array<{ readonly query: string; readonly parameters: readonly unknown[] }> = [];
    const json = (value: unknown) => ({ __postgresJson: value });
    const execute = async (query: string, parameters: readonly unknown[] = []) => {
      calls.push({ query, parameters });
      if (query.includes('SELECT group_id') && query.includes('FOR UPDATE')) return [];
      if (query.includes('RETURNING group_id')) return [{ group_id: 'batch-group-1' }];
      return [];
    };
    const transaction: ApplicationPostgresTransactionSql = {
      unsafe: execute,
      json,
    };
    const sql: ApplicationPostgresSql = {
      unsafe: execute,
      begin: async (operation) => operation(transaction),
      async end() {},
    };
    const processorStore = createPostgresApplicationStreamProcessorStore({ sql });
    const event = envelope(1);
    const batch = {
      id: 'batch-1',
      partition: event.partitionKey,
      firstSequence: 1,
      lastSequence: 1,
      events: [event],
    };
    const group = {
      id: 'batch-group-1',
      firstSequence: 1,
      lastSequence: 1,
      batches: [batch],
      completedBatchIds: [],
    };

    await Promise.all([
      processorStore.prepare(),
      processorStore.prepare(),
      processorStore.prepare(),
    ]);
    await processorStore.deadLetter('batch-worker', 'posts.published.v1', event, 2, 'failed');
    await processorStore.freezeBatchGroup?.('batch-worker', 'posts.published.v1', group);
    await processorStore.markBatchComplete?.(
      'batch-worker',
      'posts.published.v1',
      group.id,
      batch.id,
    );

    expect(calls.some(({ query }) =>
      query.includes("SET batches = (batches #>> '{}')::jsonb"))).toBe(true);
    expect(calls.filter(({ query }) =>
      query.includes('pg_advisory_xact_lock'))).toHaveLength(1);
    expect(calls.filter(({ query }) =>
      query.includes('CREATE TABLE IF NOT EXISTS applik8s_stream_processor_'))).toHaveLength(3);
    expect(calls.filter(({ query }) =>
      query.includes("SET batches = (batches #>> '{}')::jsonb"))).toHaveLength(1);
    const deadLetter = calls.find(({ query }) =>
      query.includes('INSERT INTO applik8s_stream_processor_dead_letters'));
    expect(deadLetter?.parameters[6]).toEqual(json(event.payload));
    const frozen = calls.find(({ query }) =>
      query.includes('INSERT INTO applik8s_stream_processor_batch_groups'));
    expect(frozen?.parameters[5]).toEqual(json(group.batches));
    const completed = calls.find(({ query }) =>
      query.includes('SET completed_batch_ids = CASE'));
    expect(completed?.parameters[3]).toEqual(json([{ id: batch.id }]));
    expect(completed?.parameters[4]).toEqual(json([batch.id]));
  });

  it('uses stable event idempotency keys and advances only after a terminal batch', async () => {
    const checkpoints = store();
    const observed: Array<{ readonly idempotencyKey: string; readonly version: string; readonly contextDigest?: string; readonly globalChangeScope?: string; readonly principal?: string; readonly tenant?: string }> = [];
    const source = { async read(): Promise<ApplicationReplayPage<{ postId: string }>> { return { items: [envelope(1), envelope(2)], nextSequence: 2, exhausted: true, retentionFloor: 0 }; } };
    const result = await runApplicationStreamProcessor({
      processor: 'timeline', streamName: 'posts.published.v1', source, store: checkpoints.value,
      admit: admitStreamDelivery,
      handle: async (_payload, context) => {
        observed.push({
          idempotencyKey: context.idempotencyKey,
          version: context.event.stream.version,
          ...(context.event.contextDigest ? { contextDigest: context.event.contextDigest } : {}),
          ...(context.event.changeScopes?.global ? { globalChangeScope: context.event.changeScopes.global } : {}),
          ...(context.principal ? { principal: context.principal.id } : {}),
          ...(typeof context.trustedContext.tenantId === 'string' ? { tenant: context.trustedContext.tenantId } : {}),
        });
      },
      concurrency: 2,
      retry: { maxAttempts: 2, initialDelayMs: 1, maxDelayMs: 1, factor: 2 },
      failure: 'pause', timeoutMs: 1_000, maxInputBytes: 1_000,
    });
    expect(result).toEqual({ processed: 2, deadLettered: 0, checkpoint: 2, exhausted: true });
    expect(observed).toEqual([
      { idempotencyKey: 'event-1', version: 'v1', contextDigest: 'a'.repeat(64), globalChangeScope: 'b'.repeat(64), principal: 'author-1', tenant: 'tenant-1' },
      { idempotencyKey: 'event-2', version: 'v1', contextDigest: 'a'.repeat(64), globalChangeScope: 'b'.repeat(64), principal: 'author-1', tenant: 'tenant-1' },
    ]);
    expect(checkpoints.checkpoint()).toBe(2);
  });

  it('links every asynchronous processor attempt to the durable producer carrier and preserves retry identity', async () => {
    const parent = telemetry(1);
    const boundaries: ApplicationTelemetryBoundary[] = [];
    const metrics: RecordedTelemetryMetric[] = [];
    const completions: RecordedTelemetryCompletion[] = [];
    const dispose = installApplicationTelemetryRuntimeResolver(
      () => recordingTelemetryRuntime(boundaries, metrics, completions),
    );
    const persisted = store();
    let attempts = 0;
    try {
      await runApplicationStreamProcessor({
        processor: 'timeline',
        streamName: 'posts.published.v1',
        source: {
          async read() {
            return {
              items: [{ ...envelope(1), telemetry: parent }],
              nextSequence: 1,
              exhausted: true,
              retentionFloor: 0,
            };
          },
        },
        store: persisted.value,
        admit: admitStreamDelivery,
        handle: async () => {
          attempts += 1;
          if (attempts === 1) throw new Error('retry once');
        },
        concurrency: 1,
        retry: { maxAttempts: 2, initialDelayMs: 1, maxDelayMs: 1, factor: 2 },
        failure: 'pause',
        timeoutMs: 1_000,
        maxInputBytes: 1_000,
      });
    } finally {
      dispose();
    }

    expect(boundaries).toHaveLength(2);
    expect(boundaries.map((boundary) => ({
      kind: boundary.kind,
      identity: boundary.identity,
      execution: boundary.execution,
      instance: boundary.instance,
      attempt: boundary.attempt,
      invocation: boundary.invocation,
      relationship: boundary.relationship,
      links: boundary.links,
    }))).toEqual([
      {
        kind: 'processor',
        identity: 'timeline',
        execution: 'processor:timeline:event-1',
        instance: 'event-1',
        attempt: 1,
        invocation: 'live',
        relationship: 'asynchronous',
        links: [parent],
      },
      {
        kind: 'processor',
        identity: 'timeline',
        execution: 'processor:timeline:event-1',
        instance: 'event-1',
        attempt: 2,
        invocation: 'retry',
        relationship: 'asynchronous',
        links: [parent],
      },
    ]);
    expect(completions.map(({ result, errorType }) => ({ result, errorType }))).toEqual([
      { result: 'error', errorType: 'Error' },
      { result: 'ok', errorType: undefined },
    ]);
    expect(metrics).toHaveLength(2);
    expect(metrics.every(({ metric, value }) => metric === 'applik8s.delivery.lag' && value >= 0)).toBe(true);
    expect(metrics.map(({ attributes }) => attributes?.['applik8s.result'])).toEqual(['error', 'ok']);
  });

  it('classifies explicit history replay without relabeling its physical retry', async () => {
    const boundaries: ApplicationTelemetryBoundary[] = [];
    const dispose = installApplicationTelemetryRuntimeResolver(
      () => recordingTelemetryRuntime(boundaries),
    );
    let attempts = 0;
    try {
      await runApplicationStreamProcessor({
        processor: 'timeline-replay',
        streamName: 'posts.published.v1',
        source: {
          async read() {
            return {
              items: [envelope(1)],
              nextSequence: 1,
              exhausted: true,
              retentionFloor: 0,
            };
          },
        },
        store: store().value,
        admit: admitStreamDelivery,
        handle: async () => {
          attempts += 1;
          if (attempts === 1) throw new Error('retry replay');
        },
        concurrency: 1,
        retry: { maxAttempts: 2, initialDelayMs: 1, maxDelayMs: 1, factor: 2 },
        failure: 'pause',
        timeoutMs: 1_000,
        maxInputBytes: 1_000,
        invocation: 'replay',
      });
    } finally {
      dispose();
    }
    expect(boundaries.map(({ attempt, invocation }) => ({ attempt, invocation }))).toEqual([
      { attempt: 1, invocation: 'replay' },
      { attempt: 2, invocation: 'retry' },
    ]);
  });

  it('retains bounded producer fan-in as links on one frozen batch attempt', async () => {
    const parents = [telemetry(1), telemetry(2)] as const;
    const boundaries: ApplicationTelemetryBoundary[] = [];
    const dispose = installApplicationTelemetryRuntimeResolver(
      () => recordingTelemetryRuntime(boundaries),
    );
    const persisted = batchStore();
    try {
      await runApplicationStreamBatchProcessor({
        processor: 'timeline-batch',
        streamName: 'posts.published.v1',
        source: {
          async read() {
            return {
              items: [
                { ...envelope(1), telemetry: parents[0] },
                { ...envelope(2), telemetry: parents[1] },
              ],
              nextSequence: 2,
              exhausted: true,
              retentionFloor: 0,
            };
          },
        },
        store: persisted.value,
        admit: admitStreamDelivery,
        handle: async () => {},
        concurrency: 1,
        retry: { maxAttempts: 1, initialDelayMs: 1, maxDelayMs: 1, factor: 2 },
        failure: 'pause',
        timeoutMs: 1_000,
        maxInputBytes: 10_000,
        maxItems: 10,
        maxBytes: 5_000,
        maxBatches: 1,
      });
    } finally {
      dispose();
    }

    expect(boundaries).toHaveLength(1);
    expect(boundaries[0]).toMatchObject({
      kind: 'processor',
      identity: 'timeline-batch',
      attempt: 1,
      invocation: 'live',
      relationship: 'asynchronous',
      links: parents,
    });
  });

  it('preserves event order within each partition while processing independent partitions concurrently', async () => {
    const checkpoints = store();
    let releaseFirstPartition: (() => void) | undefined;
    const firstPartitionGate = new Promise<void>((resolve) => {
      releaseFirstPartition = resolve;
    });
    let confirmSecondPartition: (() => void) | undefined;
    const secondPartitionFinished = new Promise<void>((resolve) => {
      confirmSecondPartition = resolve;
    });
    const calls: string[] = [];
    const source = {
      async read(): Promise<ApplicationReplayPage<{ postId: string }>> {
        return {
          items: [
            { ...envelope(1), partitionKey: 'author-a' },
            { ...envelope(2), partitionKey: 'author-a' },
            { ...envelope(3), partitionKey: 'author-b' },
            { ...envelope(4), partitionKey: 'author-b' },
          ],
          nextSequence: 4,
          exhausted: true,
          retentionFloor: 0,
        };
      },
    };
    const running = runApplicationStreamProcessor({
      processor: 'partitioned-timeline',
      streamName: 'posts.published.v1',
      source,
      store: checkpoints.value,
      admit: admitStreamDelivery,
      handle: async (_payload, context) => {
        const key = `${context.event.partitionKey}:${context.event.sequence}`;
        calls.push(`start:${key}`);
        if (context.event.sequence === 1) await firstPartitionGate;
        calls.push(`finish:${key}`);
        if (context.event.sequence === 4) confirmSecondPartition?.();
      },
      concurrency: 2,
      retry: { maxAttempts: 1, initialDelayMs: 1, maxDelayMs: 1, factor: 2 },
      failure: 'pause',
      timeoutMs: 1_000,
      maxInputBytes: 1_000,
    });

    await secondPartitionFinished;
    expect(calls).toEqual([
      'start:author-a:1',
      'start:author-b:3',
      'finish:author-b:3',
      'start:author-b:4',
      'finish:author-b:4',
    ]);
    expect(calls).not.toContain('start:author-a:2');
    releaseFirstPartition?.();

    await expect(running).resolves.toEqual({
      processed: 4,
      deadLettered: 0,
      checkpoint: 4,
      exhausted: true,
    });
    expect(calls.indexOf('finish:author-a:1')).toBeLessThan(
      calls.indexOf('start:author-a:2'),
    );
    expect(calls.indexOf('finish:author-b:3')).toBeLessThan(
      calls.indexOf('start:author-b:4'),
    );
  });

  it('does not execute later events from a paused partition before replay', async () => {
    const checkpoints = store();
    const invoked: number[] = [];
    const source = {
      async read(): Promise<ApplicationReplayPage<{ postId: string }>> {
        return {
          items: [
            { ...envelope(1), partitionKey: 'author-a' },
            { ...envelope(2), partitionKey: 'author-a' },
            { ...envelope(3), partitionKey: 'author-b' },
          ],
          nextSequence: 3,
          exhausted: true,
          retentionFloor: 0,
        };
      },
    };
    await expect(
      runApplicationStreamProcessor({
        processor: 'partitioned-failure',
        streamName: 'posts.published.v1',
        source,
        store: checkpoints.value,
        admit: admitStreamDelivery,
        handle: async (_payload, context) => {
          invoked.push(context.event.sequence);
          if (context.event.sequence === 1) throw new Error('pause author-a');
        },
        concurrency: 2,
        retry: { maxAttempts: 1, initialDelayMs: 1, maxDelayMs: 1, factor: 2 },
        failure: 'pause',
        timeoutMs: 1_000,
        maxInputBytes: 1_000,
      }),
    ).rejects.toMatchObject({
      eventId: 'event-1',
    });
    expect(invoked).toContain(1);
    expect(invoked).toContain(3);
    expect(invoked).not.toContain(2);
    expect(checkpoints.checkpoint()).toBe(0);
  });

  it('dead-letters only after bounded retries and otherwise pauses without advancing', async () => {
    const source = { async read(): Promise<ApplicationReplayPage<{ postId: string }>> { return { items: [envelope(1)], nextSequence: 1, exhausted: true, retentionFloor: 0 }; } };
    const dead = store();
    await expect(runApplicationStreamProcessor({ processor: 'timeline', streamName: 'posts.published.v1', source, store: dead.value, admit: admitStreamDelivery, handle: async () => { throw new Error('boom'); }, concurrency: 1, retry: { maxAttempts: 2, initialDelayMs: 1, maxDelayMs: 1, factor: 2 }, failure: 'deadLetter', timeoutMs: 1_000, maxInputBytes: 1_000 })).resolves.toMatchObject({ deadLettered: 1, checkpoint: 1 });
    expect(dead.deadLetters).toEqual(['event-1']);

    const paused = store();
    const privateFailure = 'processor-private-credential-must-not-leak';
    const pausedFailure = await runApplicationStreamProcessor({ processor: 'timeline', streamName: 'posts.published.v1', source, store: paused.value, admit: admitStreamDelivery, handle: async () => { throw new Error(privateFailure); }, concurrency: 1, retry: { maxAttempts: 1, initialDelayMs: 1, maxDelayMs: 1, factor: 2 }, failure: 'pause', timeoutMs: 1_000, maxInputBytes: 1_000 }).catch((error: unknown) => error);
    expect(pausedFailure).toBeInstanceOf(ApplicationStreamProcessorPausedError);
    expect(pausedFailure).toMatchObject({ detail: 'Processor attempt failed (Error).' });
    expect(JSON.stringify(pausedFailure)).not.toContain(privateFailure);
    expect(paused.checkpoint()).toBe(0);
  });

  it('never invokes the handler when broker delivery provenance is substituted', async () => {
    const checkpoints = store();
    const substituted = {
      ...envelope(1),
      contextDigest: 'substituted-context',
      trustedContext: { tenantId: 'tenant-2', secret: 'must-not-cross' },
    };
    const source = {
      async read(): Promise<ApplicationReplayPage<{ postId: string }>> {
        return {
          items: [substituted],
          nextSequence: 1,
          exhausted: true,
          retentionFloor: 0,
        };
      },
    };
    let handled = false;
    await expect(runApplicationStreamProcessor({
      processor: 'timeline',
      streamName: 'posts.published.v1',
      source,
      store: checkpoints.value,
      admit: async (request) => {
        if (request.envelope.contextDigest !== 'a'.repeat(64)) {
          throw Object.assign(
            new Error('trustedContext=must-not-be-observed'),
            { code: 'ADMISSION_CONTEXT_INVALID' },
          );
        }
        return admitStreamDelivery(request);
      },
      handle: async () => {
        handled = true;
      },
      concurrency: 1,
      retry: { maxAttempts: 1, initialDelayMs: 1, maxDelayMs: 1, factor: 2 },
      failure: 'pause',
      timeoutMs: 1_000,
      maxInputBytes: 1_000,
    })).rejects.toMatchObject({
      name: 'ApplicationStreamProcessorPausedError',
      detail: 'Admission rejected: ADMISSION_CONTEXT_INVALID',
    });
    expect(handled).toBe(false);
    expect(checkpoints.checkpoint()).toBe(0);
  });

  it('rehydrates inert event payloads for every admitted delivery attempt', async () => {
    const checkpoints = store();
    const inert = envelope(1);
    let decodes = 0;
    let attempts = 0;
    const order: string[] = [];
    const decodedAdmissions: object[] = [];
    const handledAdmissions: object[] = [];
    const source = {
      async read(): Promise<ApplicationReplayPage<{ postId: string }>> {
        return { items: [inert], nextSequence: 1, exhausted: true, retentionFloor: 0 };
      },
    };
    await expect(runApplicationStreamProcessor({
      processor: 'signal-handler',
      streamName: 'review-decision.v1',
      source,
      store: checkpoints.value,
      admit: async (request) => {
        order.push(`admit:${request.attempt}`);
        return admitStreamDelivery(request);
      },
      decodePayload: async (payload, context) => {
        decodes += 1;
        order.push(`decode:${decodes}`);
        decodedAdmissions.push(context.admission);
        expect(payload).toBe(inert.payload);
        expect(context.event.id).toBe('event-1');
        expect(context.principal?.id).toBe('author-1');
        return { ...payload, approve: async () => 'approved' } as typeof payload;
      },
      handle: async (payload, context) => {
        attempts += 1;
        order.push(`handle:${attempts}`);
        handledAdmissions.push(context.admission);
        expect(typeof Reflect.get(payload, 'approve')).toBe('function');
        if (attempts === 1) throw new Error('retry after authority changed');
      },
      concurrency: 1,
      retry: { maxAttempts: 2, initialDelayMs: 1, maxDelayMs: 1, factor: 2 },
      failure: 'pause',
      timeoutMs: 1_000,
      maxInputBytes: 1_000,
    })).resolves.toMatchObject({ processed: 1, checkpoint: 1 });
    expect(decodes).toBe(2);
    expect(order).toEqual([
      'admit:1',
      'decode:1',
      'handle:1',
      'admit:2',
      'decode:2',
      'handle:2',
    ]);
    expect(handledAdmissions[0]).toBe(decodedAdmissions[0]);
    expect(handledAdmissions[1]).toBe(decodedAdmissions[1]);
    expect(handledAdmissions[0]).not.toBe(handledAdmissions[1]);
    expect(inert.payload).toEqual({ postId: 'post-1' });
  });

  it('never decodes or invokes a delivery whose canonical admission exceeded the handler deadline', async () => {
    const checkpoints = store();
    let decoded = false;
    let handled = false;
    await expect(runApplicationStreamProcessor({
      processor: 'bounded-admission',
      streamName: 'posts.published.v1',
      source: {
        async read() {
          return {
            items: [envelope(1)],
            nextSequence: 1,
            exhausted: true,
            retentionFloor: 0,
          };
        },
      },
      store: checkpoints.value,
      admit: async (request) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return admitStreamDelivery(request);
      },
      decodePayload: async (payload) => {
        decoded = true;
        return payload;
      },
      handle: async () => {
        handled = true;
      },
      concurrency: 1,
      retry: {
        maxAttempts: 1,
        initialDelayMs: 1,
        maxDelayMs: 1,
        factor: 2,
      },
      failure: 'pause',
      timeoutMs: 1,
      maxInputBytes: 1_000,
    })).rejects.toBeInstanceOf(ApplicationStreamProcessorPausedError);
    expect(decoded).toBe(false);
    expect(handled).toBe(false);
    expect(checkpoints.checkpoint()).toBe(0);
  });

  it('does not confuse a globally allocated first event sequence with retention, but fails closed for an actual deletion watermark', async () => {
    const globallyInterleaved = store();
    await expect(runApplicationStreamProcessor({
      processor: 'timeline',
      streamName: 'posts.published.v1',
      source: { async read() { return { items: [envelope(2)], nextSequence: 2, exhausted: true, retentionFloor: 0 }; } },
      store: globallyInterleaved.value,
      admit: admitStreamDelivery,
      handle: async () => undefined,
      concurrency: 1,
      retry: { maxAttempts: 1, initialDelayMs: 1, maxDelayMs: 1, factor: 2 },
      failure: 'pause',
      timeoutMs: 1_000,
      maxInputBytes: 1_000,
    })).resolves.toMatchObject({ processed: 1, checkpoint: 2 });

    const actuallyTrimmed = store();
    await expect(runApplicationStreamProcessor({
      processor: 'timeline',
      streamName: 'posts.published.v1',
      source: { async read() { return { items: [], nextSequence: 0, exhausted: true, retentionFloor: 2 }; } },
      store: actuallyTrimmed.value,
      admit: admitStreamDelivery,
      handle: async () => undefined,
      concurrency: 1,
      retry: { maxAttempts: 1, initialDelayMs: 1, maxDelayMs: 1, factor: 2 },
      failure: 'pause',
      timeoutMs: 1_000,
      maxInputBytes: 1_000,
    })).rejects.toBeInstanceOf(ApplicationStreamProcessorRetentionGapError);
  });

  it('freezes exact partition batches and resumes only unfinished membership after failure', async () => {
    const persisted = batchStore();
    let sourceReads = 0;
    const source = {
      async read(after: number): Promise<ApplicationReplayPage<{ postId: string }>> {
        sourceReads += 1;
        const items = [
          { ...envelope(1), partitionKey: 'author-a' },
          { ...envelope(2), partitionKey: 'author-b' },
          { ...envelope(3), partitionKey: 'author-a' },
          { ...envelope(4), partitionKey: 'author-b' },
        ].filter((event) => event.sequence > after);
        return { items, nextSequence: 4, exhausted: true, retentionFloor: 0 };
      },
    };
    const calls: Array<{ readonly id: string; readonly partition?: string; readonly values: readonly string[]; readonly frozen: boolean }> = [];
    let failAuthorA = true;
    const options = {
      processor: 'bulk-index',
      streamName: 'posts.published.v1',
      source,
      store: persisted.value,
      admit: admitStreamDelivery,
      handle: async (batch: ApplicationEventBatch<{ postId: string }>) => {
        calls.push({
          id: batch.id,
          ...(batch.partition ? { partition: batch.partition } : {}),
          values: batch.events.map((event) => event.value.postId),
          frozen: Object.isFrozen(batch) && Object.isFrozen(batch.events),
        });
        if (batch.partition === 'author-a' && failAuthorA) {
          failAuthorA = false;
          throw new Error('temporary index failure');
        }
      },
      concurrency: 2,
      retry: { maxAttempts: 1, initialDelayMs: 1, maxDelayMs: 1, factor: 2 },
      failure: 'pause' as const,
      timeoutMs: 1_000,
      maxInputBytes: 10_000,
      maxItems: 2,
      maxBytes: 5_000,
      maxBatches: 1,
    };

    await expect(runApplicationStreamBatchProcessor(options)).rejects.toBeInstanceOf(ApplicationStreamProcessorPausedError);
    expect(persisted.checkpoint()).toBe(0);
    expect(persisted.pending()?.completedBatchIds).toHaveLength(1);

    await expect(runApplicationStreamBatchProcessor(options)).resolves.toMatchObject({
      processed: 2,
      checkpoint: 4,
      exhausted: false,
    });
    expect(sourceReads).toBe(1);
    expect(calls.filter((call) => call.partition === 'author-a')).toHaveLength(2);
    expect(calls.filter((call) => call.partition === 'author-b')).toHaveLength(1);
    expect(calls.every((call) => call.frozen)).toBe(true);
    expect(calls.find((call) => call.partition === 'author-a')?.values).toEqual(['post-1', 'post-3']);
    expect(calls.find((call) => call.partition === 'author-b')?.values).toEqual(['post-2', 'post-4']);
  });

  it('keeps frozen batch manifests inert and decodes each event only for invocation', async () => {
    const persisted = batchStore();
    const source = {
      async read(): Promise<ApplicationReplayPage<{ postId: string }>> {
        return {
          items: [envelope(1)],
          nextSequence: 1,
          exhausted: true,
          retentionFloor: 0,
        };
      },
    };
    let observedCallable = false;
    let decodedAdmission: object | undefined;
    let handledAdmission: object | undefined;
    const result = await runApplicationStreamBatchProcessor({
      processor: 'signal-batch',
      streamName: 'review-decision.v1',
      source,
      store: persisted.value,
      admit: admitStreamDelivery,
      decodePayload: async (payload, context) => {
        decodedAdmission = context.admission;
        return ({ ...payload, approve: async () => 'approved' }) as typeof payload;
      },
      handle: async (batch) => {
        const value = batch.events[0]?.value;
        handledAdmission = batch.events[0]?.admission;
        observedCallable =
          value !== undefined
          && typeof Reflect.get(value, 'approve') === 'function';
      },
      concurrency: 1,
      retry: { maxAttempts: 1, initialDelayMs: 1, maxDelayMs: 1, factor: 2 },
      failure: 'pause',
      timeoutMs: 1_000,
      maxInputBytes: 10_000,
      maxItems: 10,
      maxBytes: 5_000,
      maxBatches: 1,
    });
    expect(result).toMatchObject({ processed: 1, checkpoint: 1 });
    expect(observedCallable).toBe(true);
    expect(handledAdmission).toBe(decodedAdmission);
    expect(persisted.pending()).toBeUndefined();
  });
});
