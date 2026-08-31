import type { ApplicationQuerySelectionContract } from '@applik8s/applik8s/query-runtime';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createPostgresApplicationQueryBatchRuntime } from '../src/query-batch.js';

const databaseUrl = process.env.APPLIK8S_JOB_POSTGRES_URL;
const requiredDatabaseUrl = databaseUrl ?? 'postgres://query-batch-live-test-not-configured';
const live = databaseUrl ? describe : describe.skip;
const applicationId = `query-batch-${process.pid}`;
const deploymentId = 'vertical';
const table = `query_batch_source_${process.pid}`;

live('PostgreSQL durable query-batch runtime', () => {
  const sql = postgres(requiredDatabaseUrl, { max: 2 });
  const selection: ApplicationQuerySelectionContract = {
    protocol: 'applik8s.query-selection/v1alpha1',
    sourceModel: 'Document',
    source: {
      provider: 'postgres', database: 'catalog', table,
      columns: [
        { property: 'id', column: 'id', logicalType: 'string', nullable: false },
        { property: 'workspaceId', column: 'workspace_id', logicalType: 'string', nullable: false },
        { property: 'body', column: 'body', logicalType: 'string', nullable: false },
      ],
    },
    predicate: {
      kind: 'comparison', operation: 'eq',
      left: { kind: 'field', path: ['workspaceId'] },
      right: { kind: 'input', path: ['workspaceId'] },
    },
    order: [{ expression: { kind: 'field', path: ['id'] }, direction: 'asc' }],
    identity: [{ kind: 'field', path: ['id'] }],
    relationshipReads: [],
    sourceAuthority: `postgres:catalog:public.${table}`,
    digest: `selection-${process.pid}`,
  };

  beforeAll(async () => {
    await sql.unsafe(`CREATE TABLE ${table} (id text PRIMARY KEY, workspace_id text NOT NULL, body text NOT NULL)`);
    await sql.unsafe(`INSERT INTO ${table} (id, workspace_id, body) VALUES ('a', 'one', 'A'), ('b', 'one', 'B'), ('c', 'one', 'C'), ('x', 'other', 'X')`);
  });

  afterAll(async () => {
    await sql`DELETE FROM applik8s_query_batch_scans WHERE application_id = ${applicationId}`.catch(() => undefined);
    await sql.unsafe(`DROP TABLE IF EXISTS ${table}`);
    await sql.end({ timeout: 5 });
  });

  test('atomically freezes membership and resumes the contiguous receipt frontier after restart', async () => {
    const request = {
      selection,
      input: { workspaceId: 'one' },
      trustedContext: {},
      authorityRevision: 'authority-v1',
      runId: 'run-1',
      executionFence: 'attempt-1',
      consistency: { mode: 'repeatableSnapshot' as const },
      batchSize: 1,
    };
    const first = createPostgresApplicationQueryBatchRuntime({
      databaseUrl: requiredDatabaseUrl, applicationId, deploymentId,
    });
    const scan = await first.prepare(request);
    await sql.unsafe(`INSERT INTO ${table} (id, workspace_id, body) VALUES ('d', 'one', 'late')`);
    const zero = await first.readWindow<{ id: string }>({
      scan, maximumItems: 1, signal: new AbortController().signal,
    });
    const one = await first.readWindow<{ id: string }>({
      scan, after: zero.window.upper, maximumItems: 1, signal: new AbortController().signal,
    });
    expect(zero.items.map(({ id }) => id)).toEqual(['a']);
    expect(one.items.map(({ id }) => id)).toEqual(['b']);
    expect(await first.completeWindow({ scan, window: one.window, outcome: 'succeeded' })).toEqual({});
    await first.close();

    const resumed = createPostgresApplicationQueryBatchRuntime({
      databaseUrl: requiredDatabaseUrl, applicationId, deploymentId,
    });
    const sameScan = await resumed.prepare({ ...request, executionFence: 'attempt-2' });
    expect(sameScan.scanId).toBe(scan.scanId);
    await expect(resumed.prepare({
      ...request,
      executionFence: 'attempt-3',
      trustedContext: { organizationId: 'different-authority-context' },
    })).rejects.toThrow('QUERY_BATCH_ADMISSION_CONFLICT');
    await expect(
      resumed.completeWindow({ scan, window: zero.window, outcome: 'succeeded' }),
    ).rejects.toThrow('QUERY_BATCH_FENCE_LOST');
    const advanced = await resumed.completeWindow({ scan: sameScan, window: zero.window, outcome: 'succeeded' });
    expect(advanced.committedFrontier?.ordinal).toBe(1);
    if (!advanced.committedFrontier) throw new Error('Expected the contiguous receipt frontier to advance.');
    const two = await resumed.readWindow<{ id: string }>({
      scan: sameScan, after: advanced.committedFrontier, maximumItems: 1,
      signal: new AbortController().signal,
    });
    expect(two.items.map(({ id }) => id)).toEqual(['c']);
    expect(two.terminal).toBe(true);
    expect(two.items.some(({ id }) => id === 'd')).toBe(false);
    await expect(resumed.release({ scan, terminal: 'failed' })).rejects.toThrow('QUERY_BATCH_FENCE_LOST');
    await expect(resumed.release({ scan: sameScan, terminal: 'succeeded' })).resolves.toBeUndefined();
    await resumed.close();
  });
});
