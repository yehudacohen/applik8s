// typecast-file-boundary: ClickHouse JSONEachRow responses are locally parsed and asserted only after protocol-level field checks.
import { createClickHouseAnalyticalProjectionWriter, runApplicationProjection, type ApplicationStreamEnvelope } from '@applik8s/applik8s';
import { type } from 'arktype';
import { describe, expect, test } from 'vitest';

const endpoint = process.env.APPLIK8S_V06_CLICKHOUSE_ENDPOINT;

describe.runIf(endpoint)('v0.6 real ClickHouse projection authority', () => {
  const projection = 'account-balances-live';
  const streamName = 'accounts.changed.v1';
  const table = 'account_balances_v06_live';
  const schema = type({ eventId: 'string', accountId: 'string', balance: 'number', active: 'boolean' });
  const store = createClickHouseAnalyticalProjectionWriter({ endpoint: endpoint ?? '', table, projection, stream: streamName, schema });
  const events: readonly ApplicationStreamEnvelope<{ readonly accountId: string; readonly balance: number }>[] = [
    { id: 'event-1', stream: { name: 'accounts.changed', version: 'v1' }, sequence: 1, partitionKey: 'account-1', recordedAt: '2026-07-15T00:00:00.000Z', payload: { accountId: 'account-1', balance: 42 } },
    { id: 'event-2', stream: { name: 'accounts.changed', version: 'v1' }, sequence: 2, partitionKey: 'account-2', recordedAt: '2026-07-15T00:00:01.000Z', payload: { accountId: 'account-2', balance: 84 } },
  ];

  test('prepares, deduplicates stable events, checkpoints, resets, and rebuilds from replay', async () => {
    await store.prepare();
    await store.reset(projection, streamName);
    const first = events[0];
    if (!first) throw new Error('ClickHouse live fixture requires its first event.');
    const projected = { eventId: first.id, accountId: first.payload.accountId, balance: first.payload.balance, active: true };
    await store.write([{ envelope: first, rows: [projected] }]);
    await store.write([{ envelope: first, rows: [projected] }]);
    await store.advance({ projection, stream: streamName, sequence: 1 });
    await store.advance({ projection, stream: streamName, sequence: 1 });
    await expect(store.checkpoint(projection, streamName)).resolves.toEqual({ projection, stream: streamName, sequence: 1 });
    await expect(countRows()).resolves.toEqual({ rows: 1, uniqueEvents: 1 });

    await store.reset(projection, streamName);
    await expect(store.checkpoint(projection, streamName)).resolves.toEqual({ projection, stream: streamName, sequence: 0 });
    await expect(countRows()).resolves.toEqual({ rows: 0, uniqueEvents: 0 });

    const result = await runApplicationProjection({
      projection,
      streamName,
      source: { async read(afterSequence) { const items = events.filter((event) => event.sequence > afterSequence); return { items, nextSequence: items.at(-1)?.sequence ?? afterSequence, exhausted: true, retentionFloor: 0 }; } },
      store,
      project: (payload, event) => ({ eventId: event.id, accountId: payload.accountId, balance: payload.balance, active: true }),
    });
    expect(result).toEqual({ processed: 2, checkpoint: 2, exhausted: true });
    await expect(countRows()).resolves.toEqual({ rows: 2, uniqueEvents: 2 });
  });

  async function countRows(): Promise<{ readonly rows: number; readonly uniqueEvents: number }> {
    const response = await fetch(`${endpoint}/?query=${encodeURIComponent(`SELECT count() AS rows, uniqExact(_applik8s_event_id) AS uniqueEvents FROM default.${table} FINAL FORMAT JSONEachRow`)}`, { method: 'POST' });
    if (!response.ok) throw new Error(`ClickHouse live count failed: ${response.status} ${await response.text()}`);
    const value = JSON.parse(await response.text()) as { readonly rows?: unknown; readonly uniqueEvents?: unknown };
    return { rows: Number(value.rows ?? 0), uniqueEvents: Number(value.uniqueEvents ?? 0) };
  }
});
