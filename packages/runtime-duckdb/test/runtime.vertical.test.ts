// typecast-file-boundary: Test fixtures intentionally exercise native DuckDB and persisted manifest boundary values.
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LakehouseDataset, type, type ApplicationLakehouseRowExpression } from '@applik8s/applik8s';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ApplicationDuckDbLakehouseCorruptionError,
  ApplicationDuckDbLakehouseLimitError,
  createDuckDbApplicationLakehouseRuntime,
} from '../src/index.js';

const roots: string[] = [];
afterEach(async () => {
  while (roots.length > 0) await rm(roots.pop()!, { recursive: true, force: true });
});

describe('DuckDB lakehouse runtime', () => {
  it('publishes an immutable snapshot, queries it through DuckDB, and recovers after restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-duckdb-'));
    roots.push(root);
    const Dataset = LakehouseDataset.named('usage-history');
    const options = {
      datasetId: 'usage-history',
      schemaRevision: 'v1',
      schema: type({ organizationId: 'string', occurredAt: 'string', quantity: 'number' }),
      cursorKey: 'local-lakehouse-cursor-key'.repeat(2),
      root,
      now: () => new Date('2026-08-19T12:00:00.000Z'),
    } as const;
    let runtime = await createDuckDbApplicationLakehouseRuntime(options);
    const snapshot = await runtime.append({
      frontier: 'event:one',
      rows: [
        { organizationId: 'org-1', occurredAt: '2026-08-01', quantity: 1 },
        { organizationId: 'org-1', occurredAt: '2026-08-02', quantity: 2 },
      ],
    });
    const first = await runtime.query({
      dataset: Dataset,
      snapshot: snapshot.snapshotId,
      where: (row: ApplicationLakehouseRowExpression<{ organizationId: string; occurredAt: string; quantity: number }>) => row.organizationId.eq('org-1').and(row.quantity.gte(1)),
      orderBy: (row: ApplicationLakehouseRowExpression<{ organizationId: string; occurredAt: string; quantity: number }>) => [row.occurredAt.asc()],
      page: { size: 1 },
      principalScope: 'org-1',
    });
    expect(first).toMatchObject({ rows: [{ quantity: 1 }] });
    expect(first.scannedBytes).toBeGreaterThan(0);
    await runtime.close();

    runtime = await createDuckDbApplicationLakehouseRuntime(options);
    const restored = await runtime.query({
      dataset: Dataset,
      snapshot: snapshot.snapshotId,
      page: { size: 10 },
      principalScope: 'org-1',
    });
    expect(restored.rows).toHaveLength(2);
    await runtime.close();
  });

  it('fails closed when a published object diverges from its signed manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-duckdb-corrupt-'));
    roots.push(root);
    const runtime = await createDuckDbApplicationLakehouseRuntime({
      datasetId: 'audit-history', schemaRevision: 'v1', schema: type({ id: 'string' }),
      cursorKey: 'corruption-test-cursor-key'.repeat(2), root,
    });
    const snapshot = await runtime.append({ frontier: 'one', rows: [{ id: 'one' }] });
    const authority = JSON.parse(await readFile(join(runtime.root, 'authority.json'), 'utf8')) as { manifests: Array<{ snapshotId: string }> };
    expect(authority.manifests[0]?.snapshotId).toBe(snapshot.snapshotId);
    await writeFile(join(runtime.root, 'objects', `${snapshot.objects[0]!.objectId}.ndjson`), `${JSON.stringify({ id: 'tampered' })}\n`);
    await expect(runtime.query({ dataset: LakehouseDataset.named('audit-history') })).rejects.toBeInstanceOf(ApplicationDuckDbLakehouseCorruptionError);
    await runtime.close();
  });

  it('cancels while waiting for a bounded query slot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-duckdb-cancel-'));
    roots.push(root);
    const runtime = await createDuckDbApplicationLakehouseRuntime({
      datasetId: 'cancel-history', schemaRevision: 'v1', schema: type({ id: 'string' }),
      cursorKey: 'cancellation-test-cursor-key'.repeat(2), root, maximumConcurrentQueries: 1,
    });
    await runtime.append({ frontier: 'one', rows: [{ id: 'one' }] });
    const controller = new AbortController();
    controller.abort();
    await expect(runtime.query({ dataset: LakehouseDataset.named('cancel-history'), signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
      receipt: { state: 'cancelled', provider: 'duckdb', dataset: 'cancel-history' },
    });
    await runtime.close();
  });

  it('enforces configured row and scan ceilings before exposing results', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-duckdb-limits-'));
    roots.push(root);
    const runtime = await createDuckDbApplicationLakehouseRuntime({
      datasetId: 'bounded-history', schemaRevision: 'v1', schema: type({ id: 'string' }),
      cursorKey: 'bounded-test-cursor-key'.repeat(2), root, maximumRows: 1, maximumScannedBytes: 1,
    });
    await runtime.append({ frontier: 'one', rows: [{ id: 'one' }] });
    await expect(runtime.query({ dataset: LakehouseDataset.named('bounded-history'), page: { size: 2 } })).rejects.toBeInstanceOf(ApplicationDuckDbLakehouseLimitError);
    await expect(runtime.query({ dataset: LakehouseDataset.named('bounded-history'), page: { size: 1 } })).rejects.toMatchObject({ code: 'APPLIK8S_DUCKDB_LAKEHOUSE_LIMIT', limit: 'scannedBytes' });
    await runtime.close();
  });

  it('compacts immutable deltas and removes objects no retained snapshot can reference', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-duckdb-retention-'));
    roots.push(root);
    const runtime = await createDuckDbApplicationLakehouseRuntime({
      datasetId: 'retained-history', schemaRevision: 'v1', schema: type({ id: 'string' }),
      cursorKey: 'retention-test-cursor-key'.repeat(2), root,
      maximumObjectsPerSnapshot: 1, retainedSnapshots: 1,
    });
    const first = await runtime.append({ frontier: 'one', rows: [{ id: 'one' }] });
    const second = await runtime.append({ frontier: 'two', rows: [{ id: 'two' }] });
    expect(second.lifecycle.disposition).toBe('compacted');
    expect(second.objects).toHaveLength(1);
    const files = await readdir(join(runtime.root, 'objects'));
    expect(files).toEqual([`${second.objects[0]!.objectId}.ndjson`]);
    expect(files).not.toContain(`${first.objects[0]!.objectId}.ndjson`);
    await runtime.close();
  });
});
