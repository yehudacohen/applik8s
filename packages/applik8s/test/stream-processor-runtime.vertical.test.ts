import { type ApplicationReplayPage, ApplicationStreamProcessorPausedError, ApplicationStreamProcessorRetentionGapError, type ApplicationStreamProcessorStore, runApplicationStreamProcessor } from '@applik8s/applik8s';
import { describe, expect, it } from 'vitest';
import { testApplicationPrincipal } from '../../../test-support/application-principal.js';

function envelope(sequence: number) {
  return {
    id: `event-${sequence}`,
    stream: { name: 'posts.published', version: 'v1' },
    sequence,
    partitionKey: 'author-1',
    recordedAt: '2026-01-01T00:00:00.000Z',
    contextDigest: 'a'.repeat(64),
    principal: testApplicationPrincipal('author-1', { authorityRevision: 'authz-v1' }),
    trustedContext: { tenantId: 'tenant-1' },
    payload: { postId: `post-${sequence}` },
  };
}

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

describe('durable replay stream processor runtime', () => {
  it('uses stable event idempotency keys and advances only after a terminal batch', async () => {
    const checkpoints = store();
    const observed: Array<{ readonly idempotencyKey: string; readonly version: string; readonly contextDigest?: string; readonly principal?: string; readonly tenant?: string }> = [];
    const source = { async read(): Promise<ApplicationReplayPage<{ postId: string }>> { return { items: [envelope(1), envelope(2)], nextSequence: 2, exhausted: true, retentionFloor: 0 }; } };
    const result = await runApplicationStreamProcessor({
      processor: 'timeline', streamName: 'posts.published.v1', source, store: checkpoints.value,
      handle: async (_payload, context) => {
        observed.push({
          idempotencyKey: context.idempotencyKey,
          version: context.event.stream.version,
          ...(context.event.contextDigest ? { contextDigest: context.event.contextDigest } : {}),
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
      { idempotencyKey: 'event-1', version: 'v1', contextDigest: 'a'.repeat(64), principal: 'author-1', tenant: 'tenant-1' },
      { idempotencyKey: 'event-2', version: 'v1', contextDigest: 'a'.repeat(64), principal: 'author-1', tenant: 'tenant-1' },
    ]);
    expect(checkpoints.checkpoint()).toBe(2);
  });

  it('dead-letters only after bounded retries and otherwise pauses without advancing', async () => {
    const source = { async read(): Promise<ApplicationReplayPage<{ postId: string }>> { return { items: [envelope(1)], nextSequence: 1, exhausted: true, retentionFloor: 0 }; } };
    const dead = store();
    await expect(runApplicationStreamProcessor({ processor: 'timeline', streamName: 'posts.published.v1', source, store: dead.value, handle: async () => { throw new Error('boom'); }, concurrency: 1, retry: { maxAttempts: 2, initialDelayMs: 1, maxDelayMs: 1, factor: 2 }, failure: 'deadLetter', timeoutMs: 1_000, maxInputBytes: 1_000 })).resolves.toMatchObject({ deadLettered: 1, checkpoint: 1 });
    expect(dead.deadLetters).toEqual(['event-1']);

    const paused = store();
    await expect(runApplicationStreamProcessor({ processor: 'timeline', streamName: 'posts.published.v1', source, store: paused.value, handle: async () => { throw new Error('boom'); }, concurrency: 1, retry: { maxAttempts: 1, initialDelayMs: 1, maxDelayMs: 1, factor: 2 }, failure: 'pause', timeoutMs: 1_000, maxInputBytes: 1_000 })).rejects.toBeInstanceOf(ApplicationStreamProcessorPausedError);
    expect(paused.checkpoint()).toBe(0);
  });

  it('does not confuse a globally allocated first event sequence with retention, but fails closed for an actual deletion watermark', async () => {
    const globallyInterleaved = store();
    await expect(runApplicationStreamProcessor({
      processor: 'timeline',
      streamName: 'posts.published.v1',
      source: { async read() { return { items: [envelope(2)], nextSequence: 2, exhausted: true, retentionFloor: 0 }; } },
      store: globallyInterleaved.value,
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
      handle: async () => undefined,
      concurrency: 1,
      retry: { maxAttempts: 1, initialDelayMs: 1, maxDelayMs: 1, factor: 2 },
      failure: 'pause',
      timeoutMs: 1_000,
      maxInputBytes: 1_000,
    })).rejects.toBeInstanceOf(ApplicationStreamProcessorRetentionGapError);
  });
});
