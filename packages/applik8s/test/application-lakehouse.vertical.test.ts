// typecast-file-boundary: Test fixtures intentionally exercise erased lakehouse row and cursor boundary values.
import {
  app,
  applicationGraphFor,
  createDeterministicApplicationLakehouseRuntime,
  classifyApplicationLakehouseSchemaEvolution,
  executeApplicationLakehousePublication,
  event,
  installApplicationLakehouseQueryRuntimeResolver,
  installApplicationLakehousePublicationRuntimeResolver,
  LakehouseDataset,
  Lakehouse,
  LakehouseQuery,
  type,
  type ApplicationLakehouseRowExpression,
} from '@applik8s/applik8s';
import { createApplicationLakehouseCursorCodec } from '@applik8s/applik8s/lakehouse-runtime';
import { installApplicationInvocationAdmissionResolver } from '@applik8s/client';
import type { ApplicationAdmissionInvocationContextV1, JsonValue } from '@applik8s/core';
import {
  createSignedEnvelopeCodec,
  signedEnvelopeUtf8Key,
  staticSignedEnvelopeKeyProvider,
  verifyLegacyCompactHmacJson,
} from '@applik8s/runtime/signed-envelope';
import { afterEach, describe, expect, it } from 'vitest';

const disposers: Array<() => void> = [];
afterEach(() => { while (disposers.length > 0) disposers.pop()?.(); });

function lakehouseAdmission(
  principalName: string,
  authorityRevision = 'authority:lakehouse:v1',
  tenantDigest = 'sha256:tenant-one',
): ApplicationAdmissionInvocationContextV1 {
  const principalId = `principal:lakehouse:human:${principalName}` as const;
  return Object.freeze({
    apiVersion: 'applik8s.admission/v1',
    principal: Object.freeze({
      id: principalId,
      identity: Object.freeze({
        id: `identity:lakehouse:human:${principalName}` as const,
        kind: 'human' as const,
        issuer: 'applik8s://test',
        subject: principalName,
      }),
      kind: 'human' as const,
      authenticationMethod: 'test',
      audience: Object.freeze(['applik8s://lakehouse']),
      trustedContextDigest: tenantDigest,
      catalogRevision: 'catalog:lakehouse:v1',
      authorityRevision,
      admittedAt: '2026-08-19T12:00:00.000Z',
    }),
    authorityRevision,
    trustedContext: Object.freeze({
      values: Object.freeze({ tenantId: tenantDigest }),
      digest: tenantDigest,
    }),
    operation: Object.freeze({
      id: 'applik8s://lakehouse/historical-queries/operations/query',
      transport: 'framework' as const,
    }),
    correlationId: `lakehouse-${principalName}`,
  });
}

describe('v0.8 published lakehouse snapshots', () => {
  type UsageRow = { organizationId: string; occurredAt: string; quantity: number };
  it('keeps Release-A lakehouse cursors readable by v0.7 while accepting Signed Envelope v1', async () => {
    const now = Date.parse('2026-08-19T12:00:00.000Z');
    const expiresAt = now + 15 * 60_000;
    const secret = 'l'.repeat(32);
    const key = signedEnvelopeUtf8Key(secret);
    const payload = {
      snapshot: 'snapshot_one',
      queryShape: 'sha256:query',
      principalScope: 'principal:one',
      offset: 20,
      expiresAt,
    };
    const rolling = createApplicationLakehouseCursorCodec(secret, () => now);
    const legacy = await rolling.sign(payload, { expiresAt });
    await expect(verifyLegacyCompactHmacJson(legacy, {
      key,
      validatePayload: (value) => value,
    })).resolves.toEqual(payload);

    const current = createSignedEnvelopeCodec<JsonValue>({
      purpose: 'applik8s.lakehouse-cursor/v1',
      keys: staticSignedEnvelopeKeyProvider({
        current: { id: 'lakehouse-cursor-current', key },
      }),
      now: () => now,
      maximumLifetimeMs: 15 * 60_000,
      validatePayload: (value) => value,
    });
    const v1 = await current.sign(payload, { issuedAt: now, expiresAt });
    await expect(rolling.verify(v1)).resolves.toEqual(payload);
  });

  it('binds one qualified capability fluently across deployment targets', () => {
    const application = app('portable-history');
    const Dataset = LakehouseDataset.named('history');
    application.provide(Dataset)
      .local(() => Lakehouse.duckdbDataset({ root: '.applik8s/history' }))
      .aws(() => Lakehouse.s3Dataset({ bucket: 'managed', catalog: 'history', region: 'us-east-1' }))
      .kubernetes(() => Lakehouse.s3Dataset({ bucket: 'history', catalog: 'history', region: 'us-east-1' }));

    expect(applicationGraphFor(application.composition)?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'provider',
        interface: 'LakehouseDataset',
        implementation: 'application-target-provider-selection',
        config: expect.objectContaining({
          targetSelection: {
            targets: {
              local: expect.objectContaining({ implementation: 'duckdb-dataset' }),
              aws: expect.objectContaining({ implementation: 's3-dataset' }),
              kubernetes: expect.objectContaining({ implementation: 's3-dataset' }),
            },
          },
        }),
      }),
    ]));
  });
  it('declares one typed event publication without provider-shaped application code', () => {
    const UsageHistory = LakehouseDataset.named('historical-usage');
    const UsageRecorded = event('usage.recorded.v1', {
      payload: type({ organizationId: 'string', occurredAt: 'string', quantity: 'number' }),
    });
    const publication = UsageRecorded.publish(
      UsageHistory,
      type({ organizationId: 'string', occurredAt: 'string', quantity: 'number' }),
      (usage, output) => output.append(usage),
    ).partitionBy((row) => ({ organizationId: row.organizationId, month: row.occurredAt.slice(0, 7) }));

    expect(publication).toMatchObject({
      kind: 'applicationLakehousePublication',
      event: { id: 'usage.recorded.v1' },
      dataset: { name: 'LakehouseDataset', qualification: { name: 'historical-usage' } },
    });
    expect(publication.partition?.({ organizationId: 'org-1', occurredAt: '2026-08-01', quantity: 2 })).toEqual({ organizationId: 'org-1', month: '2026-08' });
  });

  it('publishes an admitted event frontier through the selected dataset runtime exactly once', async () => {
    const Dataset = LakehouseDataset.named('historical-usage');
    const Recorded = event('usage.recorded.v1', { payload: type({ organizationId: 'string', occurredAt: 'string', quantity: 'number' }) });
    const publication = Recorded.publish(
      Dataset,
      type({ organizationId: 'string', occurredAt: 'string', quantity: 'number' }),
      (value, output) => output.append(value),
    ).partitionBy((row) => ({ organizationId: row.organizationId }));
    const runtime = createDeterministicApplicationLakehouseRuntime({
      datasetId: 'historical-usage', schemaRevision: 'v1',
      schema: type({ organizationId: 'string', occurredAt: 'string', quantity: 'number' }),
      cursorKey: 'c'.repeat(32),
    });
    disposers.push(installApplicationLakehousePublicationRuntimeResolver((qualification) => qualification === 'historical-usage' ? runtime : undefined));
    const envelope = { id: 'event-1', payload: { organizationId: 'org-1', occurredAt: '2026-08-19T00:00:00.000Z', quantity: 3 } };
    const first = await executeApplicationLakehousePublication(publication, envelope);
    const replay = await executeApplicationLakehousePublication(publication, envelope);
    expect(replay.snapshotId).toBe(first.snapshotId);
    expect(first).toMatchObject({ frontier: ['event-1'], partitions: [{ organizationId: 'org-1' }], rows: [envelope.payload] });
  });

  it('expresses a validated one-shot dataset query as an ordinary async function', async () => {
    const UsageHistory = LakehouseDataset.named('historical-usage');
    const query = UsageHistory.query(
      { input: type({ organizationId: 'string' }), output: type({ count: 'number.integer >= 0' }) },
      async ({ organizationId }) => ({ count: organizationId === 'org-1' ? 2 : 0 }),
    );

    await expect(query({ organizationId: 'org-1' })).resolves.toEqual({ count: 2 });
    await expect(query({ organizationId: 1 } as never)).rejects.toThrow(/query\.input/u);
  });

  it('publishes atomically, deduplicates frontiers, pins pages, and scopes signed cursors', async () => {
    const Dataset = LakehouseDataset.named('historical-usage');
    const Queries = LakehouseQuery.named('historical-queries');
    let now = new Date('2026-08-19T12:00:00.000Z');
    const runtime = createDeterministicApplicationLakehouseRuntime({
      datasetId: 'historical-usage',
      schemaRevision: 'v1',
      schema: type({ organizationId: 'string', occurredAt: 'string', quantity: 'number' }),
      cursorKey: 'a'.repeat(32),
      now: () => now,
    });
    disposers.push(installApplicationLakehouseQueryRuntimeResolver((qualification) => qualification === 'historical-queries' ? runtime : undefined));
    const first = await runtime.append({
      frontier: 'event:1',
      rows: [
        { organizationId: 'org-1', occurredAt: '2026-08-01', quantity: 1 },
        { organizationId: 'org-1', occurredAt: '2026-08-02', quantity: 2 },
      ],
    });
    await expect(runtime.append({ frontier: 'event:1', rows: [{ organizationId: 'org-1', occurredAt: 'duplicate', quantity: 9 }] })).resolves.toEqual(first);
    await expect(Queries.query({ dataset: Dataset })).rejects.toThrow(/active managed-execution admission/u);
    let admission = lakehouseAdmission('one');
    disposers.push(installApplicationInvocationAdmissionResolver(() => admission));
    const page1 = await Queries.query({
      dataset: Dataset,
      where: (row: ApplicationLakehouseRowExpression<UsageRow>) => row.organizationId.eq('org-1'),
      orderBy: (row: ApplicationLakehouseRowExpression<UsageRow>) => [row.occurredAt.asc()],
      page: { size: 1 },
    });
    expect(page1).toMatchObject({
      state: 'succeeded', snapshot: first.snapshotId, rows: [{ quantity: 1 }], scannedBytes: expect.any(Number),
      receipt: { state: 'succeeded', provider: 'deterministic', dataset: 'historical-usage' },
    });
    expect(page1.cursor).toBeTruthy();
    const cursor = page1.cursor!;
    await runtime.append({ frontier: 'event:2', expectedSnapshot: first.snapshotId, rows: [{ organizationId: 'org-1', occurredAt: '2026-08-03', quantity: 3 }] });
    expect((await runtime.append({ frontier: 'event:1', rows: [] })).snapshotId).toBe(first.snapshotId);
    const page2 = await Queries.query({
      dataset: Dataset,
      snapshot: first.snapshotId,
      where: (row: ApplicationLakehouseRowExpression<UsageRow>) => row.organizationId.eq('org-1'),
      orderBy: (row: ApplicationLakehouseRowExpression<UsageRow>) => [row.occurredAt.asc()],
      page: { size: 1, cursor },
    });
    expect(page2).toMatchObject({ snapshot: first.snapshotId, rows: [{ quantity: 2 }] });
    admission = lakehouseAdmission('two');
    await expect(Queries.query({ dataset: Dataset, snapshot: first.snapshotId, page: { size: 1, cursor } })).rejects.toThrow(/principal/u);
    admission = lakehouseAdmission('one', 'authority:lakehouse:v2');
    await expect(Queries.query({ dataset: Dataset, snapshot: first.snapshotId, page: { size: 1, cursor } })).rejects.toThrow(/principal/u);
    admission = lakehouseAdmission('one', 'authority:lakehouse:v1', 'sha256:tenant-two');
    await expect(Queries.query({ dataset: Dataset, snapshot: first.snapshotId, page: { size: 1, cursor } })).rejects.toThrow(/principal/u);
    admission = lakehouseAdmission('one');
    now = new Date('2026-08-19T12:16:00.000Z');
    await expect(Queries.query({
      dataset: Dataset,
      snapshot: first.snapshotId,
      where: (row: ApplicationLakehouseRowExpression<UsageRow>) => row.organizationId.eq('org-1'),
      orderBy: (row: ApplicationLakehouseRowExpression<UsageRow>) => [row.occurredAt.asc()],
      page: { size: 1, cursor },
    })).rejects.toMatchObject({
      code: 'APPLIK8S_LAKEHOUSE_QUERY_TERMINAL',
      receipt: { state: 'expired', snapshot: first.snapshotId },
    });
  });

  it('persists before publication and proves only additive optional schema evolution', async () => {
    const v1Schema = type({ id: 'string' });
    const v2Schema = type({ id: 'string', note: 'string?' });
    const v1 = createDeterministicApplicationLakehouseRuntime({
      datasetId: 'evolving-history', schemaRevision: 'v1', schema: v1Schema, cursorKey: 'e'.repeat(32),
    });
    const first = await v1.append({ frontier: 'one', rows: [{ id: 'one' }] });
    expect(first.schema.family).toBe('evolving-history');
    expect(first.schema.revision).toBe('v1');
    expect(first.schema.fingerprint).toMatch(/^sha256:/u);
    expect(first.objects).toHaveLength(1);
    expect(first.objects[0]?.rowCount).toBe(1);
    expect(first.objects[0]?.bytes).toEqual(expect.any(Number));
    expect(first.objects[0]?.digest).toMatch(/^sha256:/u);
    expect(classifyApplicationLakehouseSchemaEvolution(
      { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
      { type: 'object', properties: { id: { type: 'string' }, note: { type: 'string' } }, required: ['id'], additionalProperties: false },
    )).toMatchObject({ compatible: true, changes: ['added optional field note'] });
    const v2 = createDeterministicApplicationLakehouseRuntime<{ id: string; note?: string }>({
      datasetId: 'evolving-history', schemaRevision: 'v2', schema: v2Schema, cursorKey: 'e'.repeat(32), snapshots: [first],
    });
    await expect(v2.append({ frontier: 'two', rows: [{ id: 'two', note: 'added' }] })).resolves.toMatchObject({ schemaRevision: 'v2', rows: [{ id: 'one' }, { id: 'two', note: 'added' }] });
    expect(() => createDeterministicApplicationLakehouseRuntime({
      datasetId: 'evolving-history', schemaRevision: 'v1', schema: v2Schema, cursorKey: 'e'.repeat(32), snapshots: [first],
    })).toThrow(/without a new revision/u);
    expect(() => createDeterministicApplicationLakehouseRuntime({
      datasetId: 'evolving-history', schemaRevision: 'v2', schema: type({ id: 'string', required: 'string' }), cursorKey: 'e'.repeat(32), snapshots: [first],
    })).toThrow(/explicit rebuild/u);

    let fail = true;
    const interrupted = createDeterministicApplicationLakehouseRuntime({
      datasetId: 'interrupted-history', schemaRevision: 'v1', schema: v1Schema, cursorKey: 'f'.repeat(32),
      persist() { if (fail) throw new Error('authority write interrupted'); },
    });
    await expect(interrupted.append({ frontier: 'one', rows: [{ id: 'one' }] })).rejects.toThrow('authority write interrupted');
    expect(interrupted.current()).toBeUndefined();
    fail = false;
    await expect(interrupted.append({ frontier: 'one', rows: [{ id: 'one' }] })).resolves.toMatchObject({ frontier: ['one'] });
  });

  it('fails closed on publication conflicts, cancellation, and corrupted restored manifests', async () => {
    const Dataset = LakehouseDataset.named('audit-history');
    const runtime = createDeterministicApplicationLakehouseRuntime({
      datasetId: 'audit-history', schemaRevision: 'v1', schema: type({ id: 'string' }), cursorKey: 'b'.repeat(32),
    });
    const snapshot = await runtime.append({ frontier: 'one', rows: [{ id: 'one' }] });
    await expect(runtime.append({ frontier: 'two', expectedSnapshot: 'stale', rows: [{ id: 'two' }] })).rejects.toThrow(/conflict/u);
    const controller = new AbortController();
    controller.abort();
    await expect(runtime.query({ dataset: Dataset, signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
      receipt: { state: 'cancelled', provider: 'deterministic', dataset: 'audit-history' },
    });
    expect(() => createDeterministicApplicationLakehouseRuntime({
      datasetId: 'audit-history', schemaRevision: 'v1', schema: type({ id: 'string' }), cursorKey: 'b'.repeat(32),
      snapshots: [{ ...snapshot, digest: `sha256:${'0'.repeat(64)}` }],
    })).toThrow(/integrity/u);
  });

  it('serializes concurrent publication so every frontier has one canonical successor', async () => {
    const persisted: Array<readonly { readonly snapshotId: string }[]> = [];
    let releaseFirstPersist!: () => void;
    const firstPersistBlocked = new Promise<void>((resolve) => {
      releaseFirstPersist = resolve;
    });
    let persistenceCalls = 0;
    const runtime = createDeterministicApplicationLakehouseRuntime({
      datasetId: 'concurrent-history',
      schemaRevision: 'v1',
      schema: type({ id: 'string' }),
      cursorKey: 'concurrent-test-cursor-key'.repeat(2),
      async persist(snapshots) {
        persistenceCalls += 1;
        if (persistenceCalls === 1) await firstPersistBlocked;
        persisted.push(snapshots.map(({ snapshotId }) => ({ snapshotId })));
      },
    });

    const first = runtime.append({ frontier: 'event:first', rows: [{ id: 'first' }] });
    const second = runtime.append({ frontier: 'event:second', rows: [{ id: 'second' }] });
    await Promise.resolve();
    expect(persistenceCalls).toBe(1);
    releaseFirstPersist();

    const [firstSnapshot, secondSnapshot] = await Promise.all([first, second]);
    expect(secondSnapshot.parentSnapshotId).toBe(firstSnapshot.snapshotId);
    expect(secondSnapshot.frontier).toEqual(['event:first', 'event:second']);
    expect(secondSnapshot.rows).toEqual([{ id: 'first' }, { id: 'second' }]);
    expect(runtime.current()?.snapshotId).toBe(secondSnapshot.snapshotId);
    expect(persisted).toHaveLength(2);

    const conflicted = createDeterministicApplicationLakehouseRuntime({
      datasetId: 'conflicting-history',
      schemaRevision: 'v1',
      schema: type({ id: 'string' }),
      cursorKey: 'conflicting-test-cursor-key'.repeat(2),
    });
    const baseline = await conflicted.append({ frontier: 'baseline', rows: [{ id: 'baseline' }] });
    const contenders = await Promise.allSettled([
      conflicted.append({ frontier: 'one', expectedSnapshot: baseline.snapshotId, rows: [{ id: 'one' }] }),
      conflicted.append({ frontier: 'two', expectedSnapshot: baseline.snapshotId, rows: [{ id: 'two' }] }),
    ]);
    expect(contenders.map(({ status }) => status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(contenders.find(({ status }) => status === 'rejected')).toMatchObject({
      reason: expect.objectContaining({ message: expect.stringMatching(/conflict/u) }),
    });
  });

  it('publishes immutable deltas, compacts within a bound, retains a bounded authority, and stabilizes tied ordering', async () => {
    const Dataset = LakehouseDataset.named('bounded-history');
    const runtime = createDeterministicApplicationLakehouseRuntime({
      datasetId: 'bounded-history', schemaRevision: 'v1', schema: type({ id: 'string', score: 'number' }),
      cursorKey: 'g'.repeat(32), maximumObjectsPerSnapshot: 2, retainedSnapshots: 2,
      now: () => new Date('2026-08-20T00:00:00.000Z'),
    });
    const first = await runtime.append({ frontier: 'one', rows: [{ id: 'first', score: 1 }] });
    const second = await runtime.append({ frontier: 'two', rows: [{ id: 'second', score: 1 }] });
    const third = await runtime.append({ frontier: 'three', rows: [{ id: 'third', score: 1 }] });
    expect(first.objects).toHaveLength(1);
    expect(second.objects).toHaveLength(2);
    expect(third).toMatchObject({ lifecycle: { disposition: 'compacted', maximumObjectsPerSnapshot: 2, retainedSnapshots: 2 } });
    expect(third.objects).toHaveLength(1);
    expect(third.objects[0]).toMatchObject({ rowOffset: 0, rowCount: 3 });
    expect(runtime.snapshots().map(({ snapshotId }) => snapshotId)).toEqual([second.snapshotId, third.snapshotId]);

    const page1 = await runtime.query({ dataset: Dataset, orderBy: (row) => [row.score.asc()], page: { size: 1 }, principalScope: 'same' });
    const page2 = await runtime.query({ dataset: Dataset, orderBy: (row) => [row.score.asc()], page: { size: 1, cursor: page1.cursor! }, principalScope: 'same' });
    expect(page1.rows[0]?.id).not.toBe(page2.rows[0]?.id);
    const restored = createDeterministicApplicationLakehouseRuntime({
      datasetId: 'bounded-history', schemaRevision: 'v1', schema: type({ id: 'string', score: 'number' }),
      cursorKey: 'g'.repeat(32), maximumObjectsPerSnapshot: 2, retainedSnapshots: 2, snapshots: runtime.snapshots(),
      now: () => new Date('2026-08-20T00:00:00.000Z'),
    });
    await expect(restored.query({ dataset: Dataset, orderBy: (row) => [row.score.asc()], page: { size: 1, cursor: page1.cursor! }, principalScope: 'same' }))
      .resolves.toMatchObject({ rows: page2.rows });
  });
});
