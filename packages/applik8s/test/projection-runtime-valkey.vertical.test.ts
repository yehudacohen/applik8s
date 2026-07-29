import { type } from 'arktype';
import { describe, expect, test } from 'vitest';
import { ApplicationOnlineProjectionUnavailableError, createValkeyOnlineProjectionReader, createValkeyOnlineProjectionWriter } from '../src/projection-runtime-valkey.js';
import type { ApplicationValkeyCommand, ValkeyArgument, ValkeyResponse } from '../src/valkey-protocol.js';

interface Row { readonly partition: string; readonly id: string; readonly score: number; readonly body: string; readonly removed: boolean }

describe('Valkey online projection runtime', () => {
  test('applies ordered idempotent rows, bounds partitions, pages values, and switches generations atomically', async () => {
    const memory = inMemoryValkey();
    const store = createValkeyOnlineProjectionWriter<Row, { readonly id: string; readonly body: string }>({
      command: memory.command,
      prefix: 'chirp',
      projection: 'home-timeline',
      stream: 'PostPublished.v1',
      schema: type({ partition: 'string', id: 'string', score: 'number', body: 'string', removed: 'boolean' }),
      valueSchema: type({ id: 'string', body: 'string' }),
      partitionBy: (row) => row.partition,
      key: (row) => row.id,
      score: (row) => row.score,
      value: (row) => ({ id: row.id, body: row.body }),
      removeWhen: (row) => row.removed,
      retention: { maxItemsPerPartition: 2 },
    });
    await store.prepare();
    await store.write([event(1, [row('a', 1), row('b', 2), row('c', 3)])]);
    await store.advance({ projection: 'home-timeline', stream: 'PostPublished.v1', sequence: 1 });
    const first = await store.page({ partition: 'viewer-1', limit: 1 });
    expect(first).toMatchObject({
      items: [{ id: 'c', body: 'body-c' }],
      projection: { generation: 'live', eventWatermark: '1', rebuilding: false, degraded: false },
    });
    expect(first.cursor).toEqual(expect.any(String));
    if (!first.cursor) throw new Error('First online projection page did not expose its continuation cursor.');
    await expect(store.page({ partition: 'viewer-1', limit: 2, cursor: first.cursor })).resolves.toMatchObject({ items: [{ id: 'b', body: 'body-b' }] });

    const reader = createValkeyOnlineProjectionReader({
      command: memory.command,
      prefix: 'chirp', projection: 'home-timeline', stream: 'PostPublished.v1',
      valueSchema: type({ id: 'string', body: 'string' }),
    });
    let moved = false;
    const consistent = await reader.snapshot(async (source) => {
      const page = await source.page({ partition: 'viewer-1', limit: 2 });
      if (!moved) {
        moved = true;
        await store.advance({ projection: 'home-timeline', stream: 'PostPublished.v1', sequence: 2 });
      }
      return page.items;
    });
    expect(consistent).toMatchObject({ revision: 'live:2', value: [{ id: 'c' }, { id: 'b' }] });

    await store.write([event(2, [{ ...row('c', 3), removed: true }])]);
    await store.write([event(1, [row('stale', 99)])]);
    await store.advance({ projection: 'home-timeline', stream: 'PostPublished.v1', sequence: 2 });
    await expect(store.page({ partition: 'viewer-1', limit: 2, cursor: first.cursor })).rejects.toThrow(/cursor is stale/);
    await expect(store.page({ partition: 'viewer-1', limit: 10 })).resolves.toMatchObject({ items: [{ id: 'b', body: 'body-b' }] });
    await store.write([event(3, [{ ...row('newest', 4), partition: 'viewer-2' }])]);
    await store.advance({ projection: 'home-timeline', stream: 'PostPublished.v1', sequence: 3 });
    await expect(store.page({ partitions: ['viewer-1', 'viewer-2'], limit: 2 })).resolves.toMatchObject({
      items: [{ id: 'newest', body: 'body-newest' }, { id: 'b', body: 'body-b' }],
    });

    await store.beginGeneration('rebuild-1', 'attempt-1', 120_000);
    await store.resetGeneration('rebuild-1', 'attempt-1');
    await expect(store.beginGeneration('rebuild-1', 'attempt-2', 120_000)).rejects.toThrow(/another rebuild attempt/);
    await expect(store.rebuildState()).resolves.toEqual({ activeGeneration: 'live', eventWatermark: 3, rebuildingGeneration: 'rebuild-1' });
    await expect(store.page({ partition: 'viewer-1', limit: 10 })).resolves.toMatchObject({ projection: { generation: 'live', rebuilding: true } });
    await store.writeGeneration('rebuild-1', 'attempt-1', [event(1, [row('a', 1), row('b', 2), row('c', 3)]), event(2, [{ ...row('c', 3), removed: true }])]);
    await expect(store.generationHighwater('rebuild-1')).resolves.toBe(2);
    await expect(store.publishGeneration('rebuild-1', 'live', 'attempt-1')).resolves.toBe(false);
    await store.writeGeneration('rebuild-1', 'attempt-1', [event(3, [{ ...row('newest', 4), partition: 'viewer-2' }])]);
    await memory.command(['SET', '{chirp:projection:home-timeline:metadata}:checkpoint:PostPublished.v1', '0']);
    await expect(store.publishGeneration('rebuild-1', 'live', 'attempt-1')).resolves.toBe(true);
    await expect(store.publishGeneration('other', 'live', 'attempt-1')).resolves.toBe(false);
    await expect(store.activeGeneration()).resolves.toBe('rebuild-1');
    await expect(store.rebuildState()).resolves.toEqual({ activeGeneration: 'rebuild-1', eventWatermark: 3 });
    // A live processor can finish a batch captured before publication after
    // the generation switch. Its stale checkpoint must not regress the
    // atomically published watermark.
    await store.advance({ projection: 'home-timeline', stream: 'PostPublished.v1', sequence: 2 });
    await expect(store.rebuildState()).resolves.toEqual({ activeGeneration: 'rebuild-1', eventWatermark: 3 });
    await expect(store.page({ partition: 'viewer-1', limit: 10 })).resolves.toMatchObject({ items: [{ id: 'b' }], projection: { generation: 'rebuild-1', rebuilding: false } });
    await expect(store.resetGeneration('rebuild-1')).rejects.toThrow(/cannot reset active generation/);
    await store.resetGeneration('live');
  });

  test('fails closed on invalid bounds, cursors, values, and scope', async () => {
    expect(() => createValkeyOnlineProjectionWriter({
      command: async () => null,
      prefix: 'chirp', projection: 'timeline', stream: 'posts',
      schema: type({ id: 'string' }), valueSchema: type({ id: 'string' }),
      partitionBy: () => 'p', key: (row) => row.id, score: () => 1, value: (row) => row,
      retention: { maxItemsPerPartition: 0 },
    })).toThrow(/maxItemsPerPartition/);
    const store = createValkeyOnlineProjectionWriter({
      command: inMemoryValkey().command,
      prefix: 'chirp', projection: 'timeline', stream: 'posts',
      schema: type({ id: 'string' }), valueSchema: type({ id: 'string' }),
      partitionBy: () => 'p', key: (row) => row.id, score: () => 1, value: (row) => row,
      retention: { maxItemsPerPartition: 10 },
    });
    await store.prepare();
    await expect(store.page({ partition: 'p', limit: 1, cursor: 'nope' })).rejects.toThrow(/cursor/);
    await expect(store.checkpoint('other', 'posts')).rejects.toThrow(/outside/);
    // typecast: deliberately crosses the static row contract to prove the runtime schema fails closed.
    await expect(store.write([event(1, [{ id: 42 }]) as never])).rejects.toThrow(/validation/);

    const bounded = createValkeyOnlineProjectionWriter<{ readonly partition: string; readonly id: string }, { readonly id: string }>({
      command: inMemoryValkey().command,
      prefix: 'chirp', projection: 'bounded', stream: 'posts',
      schema: type({ partition: 'string', id: 'string' }), valueSchema: type({ id: 'string' }),
      partitionBy: (row) => row.partition, key: (row) => row.id, score: () => 1, value: ({ id }) => ({ id }),
      retention: { maxItemsPerPartition: 10, maxPartitions: 1 },
    });
    await bounded.prepare();
    await bounded.write([event(1, [{ partition: 'one', id: 'one' }])]);
    await expect(bounded.write([event(2, [{ partition: 'two', id: 'two' }])])).rejects.toThrow(/PARTITION_LIMIT/);
  });

  test('classifies a missing published generation as recoverable projection unavailability', async () => {
    const reader = createValkeyOnlineProjectionReader({
      command: async () => null,
      prefix: 'chirp', projection: 'timeline', stream: 'posts',
      valueSchema: type({ id: 'string' }),
    });
    await expect(reader.revision()).rejects.toMatchObject({
      name: 'ApplicationOnlineProjectionUnavailableError',
      code: 'APPLIK8S_ONLINE_PROJECTION_UNAVAILABLE',
      projection: 'timeline',
    });
    await expect(reader.revision()).rejects.toBeInstanceOf(ApplicationOnlineProjectionUnavailableError);
  });
});

function row(id: string, score: number): Row {
  return { partition: 'viewer-1', id, score, body: `body-${id}`, removed: false };
}

function event<TRow extends object>(sequence: number, rows: readonly TRow[]) {
  return {
    envelope: { id: `event-${sequence}`, stream: { name: 'PostPublished', version: 'v1' }, sequence, partitionKey: 'author', recordedAt: '2026-07-19T12:00:00.000Z', payload: {} },
    rows,
  };
}

function inMemoryValkey(): { readonly command: ApplicationValkeyCommand } {
  const strings = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  const hashes = new Map<string, Map<string, string>>();
  const sorted = new Map<string, Map<string, number>>();
  const command: ApplicationValkeyCommand = async (parts) => {
    const op = String(parts[0]).toUpperCase();
    if (op === 'SETNX') {
      const key = String(parts[1]);
      if (strings.has(key)) return 0;
      strings.set(key, String(parts[2]));
      return 1;
    }
    if (op === 'GET') return strings.get(String(parts[1])) ?? null;
    if (op === 'MGET') return parts.slice(1).map((key) => strings.get(String(key)) ?? null);
    if (op === 'SET') { strings.set(String(parts[1]), String(parts[2])); return 'OK'; }
    if (op === 'SMEMBERS') return [...(sets.get(String(parts[1])) ?? [])];
    if (op === 'DEL') {
      let deleted = 0;
      for (const raw of parts.slice(1)) {
        const key = String(raw);
        if (strings.delete(key) || sets.delete(key) || hashes.delete(key) || sorted.delete(key)) deleted += 1;
      }
      return deleted;
    }
    if (op === 'ZREVRANGE') {
      const entries = [...(sorted.get(String(parts[1])) ?? [])].sort((left, right) => right[1] - left[1] || right[0].localeCompare(left[0]));
      const selected = entries.slice(Number(parts[2]), Number(parts[3]) + 1);
      return String(parts[4] ?? '').toUpperCase() === 'WITHSCORES'
        ? selected.flatMap(([member, score]) => [member, String(score)])
        : selected.map(([member]) => member);
    }
    if (op === 'HGET') return hashes.get(String(parts[1]))?.get(String(parts[2])) ?? null;
    if (op === 'HMGET') {
      const hash = hashes.get(String(parts[1])) ?? new Map();
      return parts.slice(2).map((member) => hash.get(String(member)) ?? null);
    }
    if (op === 'EVAL') return evaluate(parts, strings, sets, hashes, sorted);
    throw new Error(`Unsupported in-memory Valkey command ${op}.`);
  };
  return { command };
}

function evaluate(
  parts: readonly ValkeyArgument[],
  strings: Map<string, string>,
  sets: Map<string, Set<string>>,
  hashes: Map<string, Map<string, string>>,
  sorted: Map<string, Map<string, number>>,
): ValkeyResponse {
  const script = String(parts[1]);
  const keyCount = Number(parts[2]);
  const keys = parts.slice(3, 3 + keyCount).map(String);
  const args = parts.slice(3 + keyCount).map(String);
  if (keyCount === 1) {
    const key = keys[0] ?? '';
    if (key.endsWith(':partitions')) {
      const partitions = sets.get(key) ?? new Set<string>();
      if (!partitions.has(args[0] ?? '') && partitions.size >= Number(args[1])) throw new Error('Valkey error: APPLIK8S_PROJECTION_PARTITION_LIMIT');
      const added = partitions.has(args[0] ?? '') ? 0 : 1;
      partitions.add(args[0] ?? '');
      sets.set(key, partitions);
      return added;
    }
    if (key.endsWith(':highwater') || key.includes(':checkpoint:')) {
      const current = Number(strings.get(key) ?? 0);
      if (Number(args[0]) > current) strings.set(key, args[0] ?? '0');
      return 1;
    }
    throw new Error('Unsupported one-key in-memory Valkey script.');
  }
  if (script.includes('local current') || script.includes('local checkpoint')) {
    if (keyCount === 2) {
      const [activeKey = '', checkpointKey = ''] = keys;
      if ((strings.get(activeKey) ?? null) !== args[0]) return 0;
      const current = Number(strings.get(checkpointKey) ?? 0);
      if (Number(args[1]) > current) strings.set(checkpointKey, args[1] ?? '0');
      return 1;
    }
    if (keyCount === 5) {
      const [activeKey = '', checkpointKey = '', highwaterKey = '', rebuildingKey = '', attemptKey = ''] = keys;
      if ((strings.get(activeKey) ?? null) !== args[0]) return 0;
      if ((strings.get(rebuildingKey) ?? null) !== args[1]) return 0;
      if ((strings.get(attemptKey) ?? null) !== args[2]) return 0;
      if (!strings.has(highwaterKey) || Number(strings.get(highwaterKey)) < Number(strings.get(checkpointKey) ?? 0)) return 0;
      strings.set(checkpointKey, strings.get(highwaterKey) ?? '0');
      strings.set(activeKey, args[1] ?? '');
      strings.delete(rebuildingKey);
      strings.delete(attemptKey);
      return 1;
    }
  }
  if (keyCount === 4 && script.includes('local rebuilding')) {
    const [_markerKey = '', _highwaterKey = '', rebuildingKey = '', attemptKey = ''] = keys;
    const rebuilding = strings.get(rebuildingKey);
    if (rebuilding && rebuilding !== args[0]) return 0;
    const attempt = strings.get(attemptKey);
    if (attempt && attempt !== args[1]) return 0;
    strings.set(attemptKey, args[1] ?? '');
    strings.set(rebuildingKey, args[0] ?? '');
    return 1;
  }
  if (keyCount === 2 && script.includes('PEXPIRE') && script.includes("GET', KEYS[1]) ~= ARGV[1]")) {
    const [rebuildingKey = '', attemptKey = ''] = keys;
    return strings.get(rebuildingKey) === args[0] && strings.get(attemptKey) === args[1] ? 1 : 0;
  }
  if (keyCount === 5 && script.includes("redis.call('DEL', KEYS[1], KEYS[2], KEYS[3])")) {
    const [markerKey = '', highwaterKey = '', partitionsKey = '', rebuildingKey = '', attemptKey = ''] = keys;
    if (strings.get(rebuildingKey) !== args[0] || strings.get(attemptKey) !== args[1]) return 0;
    strings.delete(markerKey); strings.delete(highwaterKey); sets.delete(partitionsKey);
    strings.set(markerKey, '1'); strings.set(highwaterKey, '0');
    return 1;
  }
  if (keyCount === 2 && script.includes("redis.call('DEL', KEYS[1], KEYS[2])")) {
    const [rebuildingKey = '', attemptKey = ''] = keys;
    if (strings.get(rebuildingKey) !== args[0] || strings.get(attemptKey) !== args[1]) return 0;
    strings.delete(rebuildingKey); strings.delete(attemptKey);
    return 1;
  }
  expect(new Set(keys.map(hashTag)).size).toBe(1);
  const [orderKey = '', valuesKey = '', versionsKey = ''] = keys;
  const [sequenceRaw = '0', member = '', scoreRaw = '0', remove = '0', value = '', maximumRaw = '1', minimumRaw = ''] = args;
  const sequence = Number(sequenceRaw);
  const order = sorted.get(orderKey) ?? new Map<string, number>();
  const values = hashes.get(valuesKey) ?? new Map<string, string>();
  const versions = hashes.get(versionsKey) ?? new Map<string, string>();
  if (Number(versions.get(member) ?? -1) > sequence) return 0;
  versions.set(member, String(sequence));
  if (remove === '1') { order.delete(member); values.delete(member); }
  else { order.set(member, Number(scoreRaw)); values.set(member, value); }
  const maximum = Number(maximumRaw);
  const ascending = [...order].sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]));
  for (const [expired] of ascending.slice(0, Math.max(0, ascending.length - maximum))) { order.delete(expired); values.delete(expired); versions.delete(expired); }
  if (minimumRaw) for (const [expired, score] of [...order]) if (score <= Number(minimumRaw)) { order.delete(expired); values.delete(expired); versions.delete(expired); }
  sorted.set(orderKey, order);
  hashes.set(valuesKey, values);
  hashes.set(versionsKey, versions);
  return 1;
}

function hashTag(key: string): string {
  return key.match(/\{([^}]+)\}/)?.[1] ?? key;
}
