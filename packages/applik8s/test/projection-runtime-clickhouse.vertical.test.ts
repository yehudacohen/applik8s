import { createClickHouseProjectionStore, runApplicationProjection, type ApplicationStreamEnvelope } from '@applik8s/applik8s';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';

describe('ClickHouse analytical projection runtime', () => {
  it('writes stable source event IDs before advancing an idempotent checkpoint', async () => {
    const requests: { readonly query: string; readonly body?: string }[] = [];
    const request = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = new URL(String(input));
      expect(url.searchParams.get('date_time_input_format')).toBe('best_effort');
      const query = url.searchParams.get('query') ?? '';
      requests.push({ query, ...(typeof init?.body === 'string' ? { body: init.body } : {}) });
      return new Response(query.startsWith('SELECT') ? '{"sequence":0}\n' : '', { status: 200 });
    };
    const schema = type({ eventId: 'string', accountId: 'string', balance: 'number', active: 'boolean', 'note?': 'string' });
    const store = createClickHouseProjectionStore({ endpoint: 'http://clickhouse.test:8123', database: 'analytics', table: 'account_balances', projection: 'account-balances', stream: 'accounts.changed.v1', schema, fetch: request });
    const envelope: ApplicationStreamEnvelope<{ readonly accountId: string; readonly balance: number }> = { id: 'event-1', stream: { name: 'accounts.changed', version: 'v1' }, sequence: 1, partitionKey: 'account-1', recordedAt: '2026-07-15T00:00:00.000Z', payload: { accountId: 'account-1', balance: 42 } };

    const result = await runApplicationProjection({
      projection: 'account-balances',
      streamName: 'accounts.changed.v1',
      source: { async read() { return { items: [envelope], nextSequence: 1, exhausted: true, retentionFloor: 1 }; } },
      store,
      project: (payload, event) => ({ eventId: event.id, accountId: payload.accountId, balance: payload.balance, active: true }),
    });

    expect(result).toEqual({ processed: 1, checkpoint: 1, exhausted: true });
    expect(requests[0]?.query).toContain('ReplacingMergeTree(_applik8s_source_sequence)');
    expect(requests[0]?.query).toContain('ORDER BY (_applik8s_event_id, _applik8s_row_index)');
    expect(requests[0]?.query).toContain('`balance` Float64');
    expect(requests[0]?.query).toContain('`note` Nullable(String)');
    expect(requests[1]?.query).toContain('`projection` String');
    expect(requests[1]?.query).toContain('ReplacingMergeTree(`sequence`)');
    const rowWrite = requests.findIndex((entry) => entry.query.includes('account_balances') && entry.query.startsWith('INSERT'));
    const checkpointWrite = requests.findIndex((entry) => entry.query.includes('applik8s_projection_checkpoints') && entry.query.startsWith('INSERT'));
    expect(rowWrite).toBeGreaterThan(0);
    expect(checkpointWrite).toBeGreaterThan(rowWrite);
    expect(JSON.parse(requests[rowWrite]?.body?.trim() ?? '{}')).toMatchObject({ _applik8s_event_id: 'event-1', _applik8s_row_index: 0, _applik8s_source_sequence: 1, accountId: 'account-1', balance: 42 });
  });

  it('fails closed for nested analytical rows and cross-projection reset', async () => {
    expect(() => createClickHouseProjectionStore({ endpoint: 'http://clickhouse.test:8123', table: 'nested_rows', projection: 'nested', stream: 'source.v1', schema: type({ nested: { value: 'string' } }), fetch: async () => new Response('', { status: 200 }) })).toThrow(/unsupported/);
    const store = createClickHouseProjectionStore({ endpoint: 'http://clickhouse.test:8123', table: 'rows', projection: 'owned', stream: 'source.v1', schema: type({ value: 'string' }), fetch: async () => new Response('', { status: 200 }) });
    await expect(store.reset('other', 'source.v1')).rejects.toThrow(/scoped/);
  });
});
