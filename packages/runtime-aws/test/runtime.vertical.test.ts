// typecast-file-boundary: Test doubles intentionally implement partial AWS SDK clients and response envelopes.

import {
  type ApplicationLakehouseQueryRequest,
  type ApplicationLakehouseQueryRuntime,
  type ApplicationTelemetryBoundary,
  type ApplicationTelemetryRuntime,
  createDeterministicApplicationLakehouseRuntime,
  applicationLakehouseConformanceRows,
  installApplicationTelemetryRuntimeResolver,
  LakehouseDataset,
  runApplicationLakehouseConformance,
  type,
} from '@applik8s/applik8s';
import type { ApplicationEventLogPublisher } from '@applik8s/applik8s/processor-runtime';
import { createApplicationTelemetryEnvelopeV1 } from '@applik8s/core';
import type { AthenaClient } from '@aws-sdk/client-athena';
import type { GlueClient } from '@aws-sdk/client-glue';
import type { S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { createAwsApplicationLakehouseDatasetRuntime, createAwsApplicationLakehouseQueryRuntime, createKinesisEventLog, handleKinesisCommandRecord, handleKinesisEventRecord, initializeApplicationAwsRuntimeBindings, startKinesisCommandProcessor } from '../src/index.js';

describe('AWS runtime binding bootstrap', () => {
  it('hydrates exact authored database environment names without exposing the secret elsewhere', async () => {
    const environment: Record<string, string | undefined> = {
      APPLIK8S_AWS_RUNTIME_BINDING_0: JSON.stringify({ kind: 'postgresUrl', environmentName: 'APPLIK8S_DATABASE_DOCUMENTS_URL', database: 'documents', host: 'db.internal', port: 5432, secretEnvironmentName: 'APPLIK8S_AWS_RUNTIME_BINDING_SECRET_0' }),
      APPLIK8S_AWS_RUNTIME_BINDING_SECRET_0: JSON.stringify({ username: 'app user', password: 'p@ss/word' }),
    };
    let reads = 0;
    await expect(initializeApplicationAwsRuntimeBindings({ environment, readSecret: async () => { reads += 1; return '{}'; } })).resolves.toEqual(['APPLIK8S_DATABASE_DOCUMENTS_URL']);
    expect(environment.APPLIK8S_DATABASE_DOCUMENTS_URL).toBe('postgres://app%20user:p%40ss%2Fword@db.internal:5432/documents');
    expect(JSON.stringify(environment.APPLIK8S_AWS_RUNTIME_BINDING_0)).not.toContain('p@ss');
    expect(reads).toBe(0);
  });

  it('fails closed when an ECS-projected secret is absent and preserves the legacy ARN migration path', async () => {
    const projected = {
      APPLIK8S_AWS_RUNTIME_BINDING_0: JSON.stringify({ kind: 'postgresUrl', environmentName: 'DATABASE_URL', database: 'app', host: 'db', port: 5432, secretEnvironmentName: 'APPLIK8S_AWS_RUNTIME_BINDING_SECRET_0' }),
    };
    await expect(initializeApplicationAwsRuntimeBindings({ environment: projected, readSecret: async () => '{}' })).rejects.toThrow(/missing projected secret/u);
    const legacy: Record<string, string | undefined> = {
      APPLIK8S_AWS_RUNTIME_BINDING_0: JSON.stringify({ kind: 'postgresUrl', environmentName: 'DATABASE_URL', database: 'app', host: 'db', port: 5432, secretArn: 'arn:legacy' }),
    };
    await expect(initializeApplicationAwsRuntimeBindings({ environment: legacy, readSecret: async (arn) => {
      expect(arn).toBe('arn:legacy');
      return JSON.stringify({ username: 'app', password: 'secret' });
    } })).resolves.toEqual(['DATABASE_URL']);
    expect(legacy.DATABASE_URL).toBe('postgres://app:secret@db:5432/app');
  });

  it('fails closed on malformed descriptors and never overwrites an explicit binding', async () => {
    await expect(initializeApplicationAwsRuntimeBindings({ environment: { APPLIK8S_AWS_RUNTIME_BINDING_0: '{' }, readSecret: async () => '{}' })).rejects.toThrow(/valid JSON/u);
    const environment = { APPLIK8S_AWS_RUNTIME_BINDING_0: JSON.stringify({ kind: 'postgresUrl', environmentName: 'DATABASE_URL', database: 'app', host: 'db', port: 5432, secretArn: 'arn' }), DATABASE_URL: 'postgres://explicit' };
    let reads = 0;
    await expect(initializeApplicationAwsRuntimeBindings({ environment, readSecret: async () => { reads += 1; return '{}'; } })).resolves.toEqual([]);
    expect(reads).toBe(0);
    expect(environment.DATABASE_URL).toBe('postgres://explicit');
  });

  it('aliases the processor database only after its exact reference binding is hydrated', async () => {
    const environment: Record<string, string | undefined> = {
      APPLIK8S_AWS_RUNTIME_BINDING_0: JSON.stringify({ kind: 'postgresUrl', environmentName: 'APPLIK8S_DATABASE_POSTS_URL', database: 'posts', host: 'db', port: 5432, secretEnvironmentName: 'APPLIK8S_AWS_RUNTIME_BINDING_SECRET_0' }),
      APPLIK8S_AWS_RUNTIME_BINDING_SECRET_0: JSON.stringify({ username: 'app', password: 'secret' }),
      APPLIK8S_DATABASE_URL_BINDING: 'APPLIK8S_DATABASE_POSTS_URL',
    };
    await initializeApplicationAwsRuntimeBindings({ environment });
    expect(environment.DATABASE_URL).toBe(environment.APPLIK8S_DATABASE_POSTS_URL);
    await expect(initializeApplicationAwsRuntimeBindings({ environment: { APPLIK8S_DATABASE_URL_BINDING: 'MISSING' }, readSecret: async () => '{}' })).rejects.toThrow(/references missing/u);
  });
});

describe('AWS lakehouse runtime', () => {
  it('publishes immutable S3 snapshots, projects Glue once, and replays a durable frontier', async () => {
    const s3 = new MemoryS3();
    const glue = new MemoryGlue();
    const runtime = createAwsApplicationLakehouseDatasetRuntime({
      datasetId: 'history', bucket: 'history-bucket', prefix: 'history', catalogDatabase: 'history', schemaRevision: 'v1',
      schema: type({ id: 'string', quantity: 'number.integer' }), cursorKey: 'c'.repeat(32),
      s3Client: s3 as unknown as S3Client, glueClient: glue as unknown as GlueClient,
    });
    const first = await runtime.append({ frontier: 'event-1', rows: [{ id: 'payload-canary-not-in-authority', quantity: 2 }] });
    const replay = await runtime.append({ frontier: 'event-1', rows: [{ id: 'duplicate', quantity: 99 }] });
    expect(replay.snapshotId).toBe(first.snapshotId);
    expect([...s3.objects.keys()]).toEqual(expect.arrayContaining([
      expect.stringMatching(/^history\/objects\/object_/u),
      expect.stringMatching(/^history\/snapshot-links\/snapshot_.*\/objects\.symlink$/u),
      expect.stringMatching(/^history\/manifests\/snapshot_/u),
      'history/authority.json',
    ]));
    expect(s3.contentTypes).toContain('application/x-ndjson');
    expect(s3.contentTypes).toContain('application/json');
    expect(glue.tables).toHaveLength(1);
    const authority = JSON.parse(s3.objects.get('history/authority.json')!.body) as { manifests: Array<Record<string, unknown>> };
    expect(authority.manifests[0]).toMatchObject({ rowCount: 1 });
    expect(authority.manifests[0]).not.toHaveProperty('rows');
    expect(authority.manifests[0]).not.toHaveProperty('rowIdentities');
    expect(s3.objects.get('history/authority.json')!.body).not.toContain('payload-canary-not-in-authority');
  });

  it('pins Athena queries to one snapshot, emits scan evidence, signs principal-bound cursors, and cancels', async () => {
    const s3 = new MemoryS3();
    const glue = new MemoryGlue();
    const dataset = {
      datasetId: 'history', bucket: 'history-bucket', prefix: 'history', catalogDatabase: 'history', schemaRevision: 'v1',
      schema: type({ id: 'string', quantity: 'number.integer' }), cursorKey: 'd'.repeat(32),
      s3Client: s3 as unknown as S3Client, glueClient: glue as unknown as GlueClient,
    };
    const publisher = createAwsApplicationLakehouseDatasetRuntime(dataset);
    const manifest = await publisher.append({ frontier: 'event-1', rows: [{ id: 'one', quantity: 2 }, { id: 'two', quantity: 3 }] });
    const athena = new MemoryAthena();
    const runtime = createAwsApplicationLakehouseQueryRuntime({
      workgroup: 'history', maximumConcurrentQueries: 1, datasets: { history: dataset },
      s3Client: s3 as unknown as S3Client, athenaClient: athena as unknown as AthenaClient,
    }) as ApplicationLakehouseQueryRuntime<{ id: string; quantity: number }>;
    const History = LakehouseDataset.named('history');
    const result = await runtime.query({
      dataset: History, principalScope: 'org-1', where: (row) => row.quantity.gte(2), orderBy: (row) => [row.id.asc()], page: { size: 1 }, timeout: '2s',
    });
    expect(result).toMatchObject({ state: 'succeeded', snapshot: manifest.snapshotId, schemaRevision: 'v1', rows: [{ id: 'one', quantity: 2 }], scannedBytes: 512 });
    expect(result.evidence).toMatchObject({ provider: 'athena', cost: { kind: 'scanned-bytes', scannedBytes: 512 } });
    expect(result.cursor).toEqual(expect.any(String));
    expect(athena.sql).toMatch(/WHERE "quantity" >= 2 ORDER BY "id" ASC, "__applik8s_row_id" ASC LIMIT 2/u);
    await expect(runtime.query({ dataset: History, principalScope: 'org-2', orderBy: (row) => [row.id.asc()], page: { size: 1, cursor: result.cursor! } })).rejects.toThrow(/cursor does not match/u);

    athena.running = true;
    const controller = new AbortController();
    athena.onStart = () => controller.abort(new DOMException('cancelled', 'AbortError'));
    await expect(runtime.query({ dataset: History, orderBy: (row) => [row.id.asc()], signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
      receipt: { state: 'cancelled', provider: 'athena', providerQueryId: expect.any(String) },
    });
    expect(athena.stopped).toBe(true);
  });

  it('reports timeout and unresolved cancellation truthfully instead of claiming provider completion', async () => {
    const s3 = new MemoryS3();
    const dataset = {
      datasetId: 'terminal', bucket: 'terminal-bucket', prefix: 'terminal', catalogDatabase: 'terminal', schemaRevision: 'v1',
      schema: type({ id: 'string' }), cursorKey: 'q'.repeat(32),
      s3Client: s3 as unknown as S3Client, glueClient: new MemoryGlue() as unknown as GlueClient,
    };
    await createAwsApplicationLakehouseDatasetRuntime(dataset).append({ frontier: 'one', rows: [{ id: 'one' }] });
    const timedOut = new MemoryAthena();
    timedOut.running = true;
    const timedRuntime = createAwsApplicationLakehouseQueryRuntime({
      workgroup: 'terminal', datasets: { terminal: dataset }, cancellationConfirmationTimeoutMs: 10,
      s3Client: s3 as unknown as S3Client, athenaClient: timedOut as unknown as AthenaClient,
    });
    await expect(timedRuntime.query({ dataset: LakehouseDataset.named('terminal'), timeout: '1ms' })).rejects.toMatchObject({
      name: 'TimeoutError',
      receipt: { state: 'timed-out', provider: 'athena' },
    });

    const pending = new MemoryAthena();
    pending.running = true;
    pending.keepRunningAfterStop = true;
    const cancellation = new AbortController();
    pending.onStart = () => cancellation.abort();
    const pendingRuntime = createAwsApplicationLakehouseQueryRuntime({
      workgroup: 'terminal', datasets: { terminal: dataset }, cancellationConfirmationTimeoutMs: 5,
      s3Client: s3 as unknown as S3Client, athenaClient: pending as unknown as AthenaClient,
    });
    await expect(pendingRuntime.query({ dataset: LakehouseDataset.named('terminal'), signal: cancellation.signal })).rejects.toMatchObject({
      code: 'APPLIK8S_LAKEHOUSE_QUERY_TERMINAL',
      receipt: { state: 'cancellation-pending', provider: 'athena' },
    });
  });

  it('enforces Athena row and scanned-byte ceilings from the selected provider', async () => {
    const s3 = new MemoryS3();
    const glue = new MemoryGlue();
    const dataset = {
      datasetId: 'bounded', bucket: 'bounded-bucket', prefix: 'bounded', catalogDatabase: 'bounded', schemaRevision: 'v1',
      schema: type({ id: 'string' }), cursorKey: 'g'.repeat(32),
      s3Client: s3 as unknown as S3Client, glueClient: glue as unknown as GlueClient,
    };
    await createAwsApplicationLakehouseDatasetRuntime(dataset).append({ frontier: 'one', rows: [{ id: 'one' }] });
    const runtime = createAwsApplicationLakehouseQueryRuntime({
      workgroup: 'bounded', maximumRows: 1, maximumScannedBytes: 100, datasets: { bounded: dataset },
      s3Client: s3 as unknown as S3Client, athenaClient: new MemoryAthena() as unknown as AthenaClient,
    }) as ApplicationLakehouseQueryRuntime<{ id: string }>;
    await expect(runtime.query({ dataset: LakehouseDataset.named('bounded'), page: { size: 2 } })).rejects.toThrow(/page size/u);
    await expect(runtime.query({ dataset: LakehouseDataset.named('bounded'), page: { size: 1 }, orderBy: (row) => [row.id.asc()] })).rejects.toMatchObject({ code: 'APPLIK8S_AWS_LAKEHOUSE_LIMIT', limit: 'scannedBytes' });
  });

  it('rejects tampered manifest authority before Athena admission', async () => {
    const s3 = new MemoryS3();
    const dataset = {
      datasetId: 'tamper-proof', bucket: 'history-bucket', prefix: 'tamper-proof', catalogDatabase: 'history', schemaRevision: 'v1',
      schema: type({ id: 'string' }), cursorKey: 't'.repeat(32),
      s3Client: s3 as unknown as S3Client, glueClient: new MemoryGlue() as unknown as GlueClient,
    };
    await createAwsApplicationLakehouseDatasetRuntime(dataset).append({ frontier: 'event-1', rows: [{ id: 'one' }] });
    const authorityKey = 'tamper-proof/authority.json';
    const stored = s3.objects.get(authorityKey)!;
    const authority = JSON.parse(stored.body) as { manifests: Array<{ rowCount: number }> };
    authority.manifests[0]!.rowCount = 2;
    s3.objects.set(authorityKey, { body: JSON.stringify(authority), etag: stored.etag });
    const athena = new MemoryAthena();
    const runtime = createAwsApplicationLakehouseQueryRuntime({
      workgroup: 'history', datasets: { 'tamper-proof': dataset },
      s3Client: s3 as unknown as S3Client, athenaClient: athena as unknown as AthenaClient,
    });
    await expect(runtime.query({ dataset: LakehouseDataset.named('tamper-proof') })).rejects.toThrow(/integrity|immutable object evidence/u);
    expect(athena.sql).toBe('');
  });

  it('rejects an existing Glue table with the right columns but the wrong snapshot location', async () => {
    const s3 = new MemoryS3();
    const glue = new ConflictingGlue();
    const runtime = createAwsApplicationLakehouseDatasetRuntime({
      datasetId: 'glue-owner', bucket: 'history-bucket', prefix: 'glue-owner', catalogDatabase: 'history', schemaRevision: 'v1',
      schema: type({ id: 'string' }), cursorKey: 'u'.repeat(32),
      s3Client: s3 as unknown as S3Client, glueClient: glue as unknown as GlueClient,
    });
    await expect(runtime.append({ frontier: 'event-1', rows: [{ id: 'one' }] })).rejects.toThrow(/owner or storage descriptor/u);
  });

  it('publishes concurrent AWS writers as one canonical successor chain', async () => {
    const s3 = new MemoryS3();
    const runtime = createAwsApplicationLakehouseDatasetRuntime({
      datasetId: 'concurrent', bucket: 'concurrent-bucket', prefix: 'concurrent', catalogDatabase: 'concurrent', schemaRevision: 'v1',
      schema: type({ id: 'string' }), cursorKey: 'w'.repeat(32),
      s3Client: s3 as unknown as S3Client, glueClient: new MemoryGlue() as unknown as GlueClient,
    });
    await Promise.all([
      runtime.append({ frontier: 'one', rows: [{ id: 'one' }] }),
      runtime.append({ frontier: 'two', rows: [{ id: 'two' }] }),
    ]);
    const authority = JSON.parse(s3.objects.get('concurrent/authority.json')!.body) as {
      manifests: Array<{ readonly snapshotId: string; readonly parentSnapshotId?: string; readonly frontier: readonly string[]; readonly rowCount: number }>;
    };
    expect(authority.manifests).toHaveLength(2);
    expect(authority.manifests[1]).toMatchObject({
      parentSnapshotId: authority.manifests[0]!.snapshotId,
      frontier: ['one', 'two'],
      rowCount: 2,
    });
  });

  it('reattaches to an ambiguously admitted Athena query through its stable provider token', async () => {
    const s3 = new MemoryS3();
    const dataset = {
      datasetId: 'reattach', bucket: 'reattach-bucket', prefix: 'reattach', catalogDatabase: 'reattach', schemaRevision: 'v1',
      schema: type({ id: 'string' }), cursorKey: 'r'.repeat(32),
      s3Client: s3 as unknown as S3Client, glueClient: new MemoryGlue() as unknown as GlueClient,
    };
    await createAwsApplicationLakehouseDatasetRuntime(dataset).append({ frontier: 'one', rows: [{ id: 'one' }] });
    const athena = new MemoryAthena();
    athena.columns = ['id'];
    athena.rows = [['one']];
    athena.failAfterAdmissionOnce = true;
    const request: ApplicationLakehouseQueryRequest<{ id: string }> = {
      dataset: LakehouseDataset.named('reattach'), principalScope: 'tenant-a', orderBy: (row) => [row.id.asc()],
    };
    const firstRuntime = createAwsApplicationLakehouseQueryRuntime({
      workgroup: 'reattach', datasets: { reattach: dataset }, s3Client: s3 as unknown as S3Client, athenaClient: athena as unknown as AthenaClient,
    }) as ApplicationLakehouseQueryRuntime<{ id: string }>;
    await expect(firstRuntime.query(request)).rejects.toMatchObject({
      code: 'APPLIK8S_LAKEHOUSE_QUERY_TERMINAL', receipt: { state: 'outcome-unknown', provider: 'athena' },
    });
    const restartedRuntime = createAwsApplicationLakehouseQueryRuntime({
      workgroup: 'reattach', datasets: { reattach: dataset }, s3Client: s3 as unknown as S3Client, athenaClient: athena as unknown as AthenaClient,
    }) as ApplicationLakehouseQueryRuntime<{ id: string }>;
    await expect(restartedRuntime.query(request)).resolves.toMatchObject({
      state: 'succeeded', rows: [{ id: 'one' }], receipt: { providerQueryId: 'query-1' },
    });
    expect(athena.startTokens).toHaveLength(2);
    expect(new Set(athena.startTokens).size).toBe(1);
    expect(athena.queryIdsByToken.size).toBe(1);
  });

  it('rejects provider rows that do not satisfy the published dataset schema', async () => {
    const s3 = new MemoryS3();
    const dataset = {
      datasetId: 'validated', bucket: 'validated-bucket', prefix: 'validated', catalogDatabase: 'validated', schemaRevision: 'v1',
      schema: type({ id: 'string', quantity: 'number.integer' }), cursorKey: 'v'.repeat(32),
      s3Client: s3 as unknown as S3Client, glueClient: new MemoryGlue() as unknown as GlueClient,
    };
    await createAwsApplicationLakehouseDatasetRuntime(dataset).append({ frontier: 'one', rows: [{ id: 'one', quantity: 1 }] });
    const athena = new MemoryAthena();
    athena.rows = [['one', 'not-a-number']];
    const runtime = createAwsApplicationLakehouseQueryRuntime({
      workgroup: 'validated', datasets: { validated: dataset }, s3Client: s3 as unknown as S3Client, athenaClient: athena as unknown as AthenaClient,
    });
    await expect(runtime.query({ dataset: LakehouseDataset.named('validated') })).rejects.toMatchObject({
      code: 'APPLIK8S_LAKEHOUSE_QUERY_TERMINAL', receipt: { state: 'failed', provider: 'athena', providerQueryId: 'query-1' },
    });
  });

  it('reads a full-size Athena page through bounded provider continuations', async () => {
    const s3 = new MemoryS3();
    const dataset = {
      datasetId: 'full-page', bucket: 'full-page-bucket', prefix: 'full-page', catalogDatabase: 'full-page', schemaRevision: 'v1',
      schema: type({ id: 'string' }), cursorKey: 'p'.repeat(32),
      s3Client: s3 as unknown as S3Client, glueClient: new MemoryGlue() as unknown as GlueClient,
    };
    await createAwsApplicationLakehouseDatasetRuntime(dataset).append({ frontier: 'one', rows: [{ id: 'seed' }] });
    const athena = new MemoryAthena();
    athena.resultPages = [
      { columns: ['id'], rows: Array.from({ length: 999 }, (_, index) => [`row-${index}`]), nextToken: 'page-2' },
      { columns: ['id'], rows: [['row-999'], ['row-1000']] },
    ];
    const runtime = createAwsApplicationLakehouseQueryRuntime({
      workgroup: 'full-page', datasets: { 'full-page': dataset }, maximumRows: 1_000,
      s3Client: s3 as unknown as S3Client, athenaClient: athena as unknown as AthenaClient,
    }) as ApplicationLakehouseQueryRuntime<{ id: string }>;
    const result = await runtime.query({
      dataset: LakehouseDataset.named('full-page'), orderBy: (row) => [row.id.asc()], page: { size: 1_000 },
    });
    expect(result.rows).toHaveLength(1_000);
    expect(result.cursor).toEqual(expect.any(String));
    expect(athena.resultRequests).toHaveLength(2);
    expect(athena.resultRequests.every(({ MaxResults }) => Number(MaxResults) <= 1_000)).toBe(true);
  });

  it('passes the shared provider-neutral lakehouse conformance fixtures through Athena SQL and hydration', async () => {
    const s3 = new MemoryS3();
    const dataset = {
      datasetId: 'conformance', bucket: 'conformance-bucket', prefix: 'conformance', catalogDatabase: 'conformance', schemaRevision: 'v1',
      schema: type({ id: 'string', group: 'string', quantity: 'number', active: 'boolean', note: 'string | null' }),
      cursorKey: 'athena-conformance-key'.repeat(2),
      s3Client: s3 as unknown as S3Client, glueClient: new MemoryGlue() as unknown as GlueClient,
    };
    await createAwsApplicationLakehouseDatasetRuntime(dataset).append({ frontier: 'fixture', rows: applicationLakehouseConformanceRows });
    const athena = new MemoryAthena();
    athena.conformance = true;
    const runtime = createAwsApplicationLakehouseQueryRuntime({
      workgroup: 'conformance', datasets: { conformance: dataset },
      s3Client: s3 as unknown as S3Client, athenaClient: athena as unknown as AthenaClient,
    }) as ApplicationLakehouseQueryRuntime<(typeof applicationLakehouseConformanceRows)[number]>;
    await expect(runApplicationLakehouseConformance(runtime, LakehouseDataset.named('conformance'))).resolves.toMatchObject({
      provider: 'athena', cases: [{ rowIds: ['c', 'a'] }, { rowIds: ['a', 'd'] }, { rowIds: ['a', 'b', 'c'] }],
    });
    expect(athena.sqlHistory).toEqual([
      expect.stringMatching(/"group" = 'alpha'.*"quantity" >= 2.*"active" = TRUE.*ORDER BY "quantity" DESC, "id" ASC/u),
      expect.stringMatching(/"note" IS NULL.*ORDER BY "id" ASC/u),
      expect.stringMatching(/"group" = 'alpha'.*ORDER BY "quantity" ASC, "id" ASC/u),
    ]);
  });
});

describe('AWS Kinesis event log and command processing', () => {
  it('verifies the stream and returns its lossless provider-native sequence', async () => {
    const commands: string[] = [];
    const publisher = createKinesisEventLog({
      streamName: 'application-events',
      client: { async send(command) {
        commands.push(command.constructor.name);
        if (command.constructor.name === 'DescribeStreamSummaryCommand') return { StreamDescriptionSummary: { StreamStatus: 'ACTIVE' } } as never;
        return { SequenceNumber: '184467440737095516160', ShardId: 'shard-000' } as never;
      } },
    });
    await expect(publisher.verify()).resolves.toBeUndefined();
    await expect(publisher.publish(commandEnvelope('published'), 'commands')).resolves.toMatchObject({
      stream: 'application-events',
      sequence: '184467440737095516160',
      subject: 'commands:shard-000',
    });
    expect(commands).toEqual(['DescribeStreamSummaryCommand', 'PutRecordCommand']);
  });

  it('resumes delivery attempts from DynamoDB and checkpoints only after durable terminal evidence', async () => {
    const order: string[] = [];
    const firstController = new AbortController();
    const checkpoints = new MemoryKinesisCheckpoints('owner', order, () => firstController.abort());
    const attempts: number[] = [];
    const telemetry = telemetryCarrier('kinesis-command');
    const carriers: unknown[] = [];
    const options = {
      streamName: 'application-events', checkpointTable: 'checkpoints', consumer: 'posts', maxAttempts: 3, retryDelayMs: 1,
      bindings: [{
        bindingId: 'posts.create', contract: { name: 'post.create', version: 'v1' },
        async execute(_input: object, delivery: { readonly attempt?: number; readonly telemetry?: unknown }) { attempts.push(delivery.attempt ?? 0); carriers.push(delivery.telemetry); throw new Error('transient'); },
        async recordTerminalFailure() { order.push('terminal'); },
      }],
    } as const;
    const eventLog = memoryEventLog(order);
    const record = { SequenceNumber: '42', PartitionKey: 'retry', Data: new TextEncoder().encode(JSON.stringify({ ...commandEnvelope('retry'), telemetry, channel: 'commands' })) };
    await expect(handleKinesisCommandRecord(checkpoints, eventLog, options, 'shard-0', 'owner', record, 5, firstController.signal)).resolves.toBe('retried');
    expect(checkpoints.row.failureAttempts).toBe(1);
    expect(checkpoints.row.sequenceNumber).toBeUndefined();

    await expect(handleKinesisCommandRecord(checkpoints, eventLog, options, 'shard-0', 'owner', record, 0, new AbortController().signal)).resolves.toBe('terminated');
    expect(attempts).toEqual([1, 2, 3]);
    expect(carriers).toEqual([telemetry, telemetry, telemetry]);
    expect(order.slice(-3)).toEqual(['dead-letter', 'terminal', 'checkpoint']);
    expect(checkpoints.row).toMatchObject({ sequenceNumber: '42', millisBehindLatest: 0 });
    expect(checkpoints.row.failureAttempts).toBeUndefined();
  });

  it('advances past unrelated channels and durably records malformed poison records', async () => {
    const order: string[] = [];
    const checkpoints = new MemoryKinesisCheckpoints('owner', order);
    const options = {
      streamName: 'application-events', checkpointTable: 'checkpoints', consumer: 'posts',
      bindings: [{ bindingId: 'posts.create', contract: { name: 'post.create', version: 'v1' }, async execute() {}, async recordTerminalFailure() {} }],
    } as const;
    const event = { SequenceNumber: '8', PartitionKey: 'event', Data: new TextEncoder().encode(JSON.stringify({ ...commandEnvelope('event'), channel: 'events' })) };
    await expect(handleKinesisCommandRecord(checkpoints, memoryEventLog(order), options, 'shard-0', 'owner', event, 1, new AbortController().signal)).resolves.toBe('ignored');
    const invalid = { SequenceNumber: '9', PartitionKey: 'invalid', Data: new TextEncoder().encode('{') };
    await expect(handleKinesisCommandRecord(checkpoints, memoryEventLog(order), options, 'shard-0', 'owner', invalid, 0, new AbortController().signal)).resolves.toBe('terminated');
    expect(checkpoints.row).toMatchObject({ sequenceNumber: '9', lastInvalidSequence: '9' });
    expect(checkpoints.row.lastInvalidReason).toMatch(/JSON/u);
  });

  it('replays a committed lakehouse publication when checkpointing is interrupted without duplicating rows', async () => {
    const order: string[] = [];
    const boundaries: ApplicationTelemetryBoundary[] = [];
    const telemetryRuntime: ApplicationTelemetryRuntime = {
      async run(boundary, execute) { boundaries.push(boundary); return execute(); },
      capture: () => undefined,
      log() {}, count() {}, record() {},
    };
    const disposeTelemetry = installApplicationTelemetryRuntimeResolver(() => telemetryRuntime);
    let failCheckpoint = true;
    const checkpoints = new MemoryKinesisCheckpoints('owner', order, undefined, () => {
      if (failCheckpoint) {
        failCheckpoint = false;
        throw new Error('checkpoint authority unavailable');
      }
    });
    const lakehouse = createDeterministicApplicationLakehouseRuntime({
      datasetId: 'history', schemaRevision: 'v1', schema: type({ id: 'string' }), cursorKey: 'k'.repeat(32),
    });
    const options = {
      streamName: 'application-events', checkpointTable: 'checkpoints', consumer: 'lakehouse-history',
      bindings: [{
        bindingId: 'lakehouse-history', contract: { name: 'post.created', version: 'v1' },
        async execute(envelope: { readonly id: string; readonly payload: object }) {
          order.push('publish');
          await lakehouse.append({ frontier: envelope.id, rows: [envelope.payload as { id: string }] });
        },
      }],
    } as const;
    const producer = telemetryCarrier('model:post-1');
    const record = { SequenceNumber: '77', PartitionKey: 'post-1', Data: new TextEncoder().encode(JSON.stringify({ ...commandEnvelope('post-1'), contract: { name: 'post.created', version: 'v1' }, telemetry: producer, channel: 'events' })) };
    try {
      await expect(handleKinesisEventRecord(checkpoints, memoryEventLog(order), options, 'shard-0', 'owner', record, 2, new AbortController().signal)).rejects.toThrow(/checkpoint authority unavailable/u);
      expect(lakehouse.current()?.rows).toEqual([{ id: 'post-1' }]);
      expect(checkpoints.row.sequenceNumber).toBeUndefined();

      await expect(handleKinesisEventRecord(checkpoints, memoryEventLog(order), options, 'shard-0', 'owner', record, 0, new AbortController().signal)).resolves.toBe('acked');
    } finally {
      disposeTelemetry();
    }
    expect(lakehouse.current()?.rows).toEqual([{ id: 'post-1' }]);
    expect(order).toEqual(['publish', 'publish', 'checkpoint']);
    expect(checkpoints.row.sequenceNumber).toBe('77');
    expect(boundaries).toEqual([
      expect.objectContaining({
        kind: 'event', identity: 'lakehouse-history', attempt: 1,
        invocation: 'live', relationship: 'asynchronous', links: [producer],
      }),
      expect.objectContaining({
        kind: 'event', identity: 'lakehouse-history', attempt: 2,
        invocation: 'retry', relationship: 'asynchronous', links: [producer],
      }),
    ]);
  });

  it('redacts Kinesis event failures from logs and dead-letter payloads', async () => {
    const order: string[] = [];
    const checkpoints = new MemoryKinesisCheckpoints('owner', order);
    const deadLetters: object[] = [];
    const records: Readonly<Record<string, unknown>>[] = [];
    const eventLog: ApplicationEventLogPublisher = {
      async verify() {},
      async publish(envelope, channel = 'events') {
        order.push(channel);
        deadLetters.push(envelope);
        return { stream: 'events', sequence: 1, duplicate: false, subject: channel, messageId: envelope.id };
      },
      async consumerLag() { return { pending: 0, ackPending: 0, redelivered: 0 }; },
      async drain() {},
    };
    const options = {
      streamName: 'application-events', checkpointTable: 'checkpoints', consumer: 'history', maxAttempts: 1,
      bindings: [{
        bindingId: 'lakehouse-history', contract: { name: 'post.created', version: 'v1' },
        async execute() { throw new Error('credential sk-private must not escape'); },
      }],
      logger: (record: Readonly<Record<string, unknown>>) => records.push(record),
    } as const;
    const record = {
      SequenceNumber: '78',
      PartitionKey: 'post-1',
      Data: new TextEncoder().encode(JSON.stringify({
        ...commandEnvelope('post-1'),
        contract: { name: 'post.created', version: 'v1' },
        channel: 'events',
      })),
    };

    await expect(handleKinesisEventRecord(
      checkpoints,
      eventLog,
      options,
      'shard-0',
      'owner',
      record,
      0,
      new AbortController().signal,
    )).resolves.toBe('terminated');
    expect(deadLetters).toEqual([expect.objectContaining({
      id: 'post-1:dead-letter',
      routing: expect.objectContaining({ failureType: 'Error' }),
    })]);
    expect(records).toEqual([expect.objectContaining({
      event: 'applik8s-event-dead-lettered',
      errorType: 'Error',
    })]);
    expect(JSON.stringify({ deadLetters, records })).not.toContain('sk-private');
  });

  it('surfaces shard-loop failure through the processor lifecycle instead of silently losing supervision', async () => {
    const processor = await startKinesisCommandProcessor({
      streamName: 'application-events', checkpointTable: 'checkpoints', consumer: 'posts',
      bindings: [{
        bindingId: 'posts.create',
        contract: { name: 'post.create', version: 'v1' },
        async execute() {},
        async recordTerminalFailure() {},
      }],
      client: { async send(command) {
        if (command.constructor.name === 'DescribeStreamSummaryCommand') return { StreamDescriptionSummary: { StreamStatus: 'ACTIVE' } } as never;
        if (command.constructor.name === 'ListShardsCommand') return { Shards: [{ ShardId: 'shard-0' }] } as never;
        if (command.constructor.name === 'GetShardIteratorCommand') throw new Error('shard iterator failed');
        throw new Error(`Unexpected Kinesis command ${command.constructor.name}.`);
      } },
      checkpointClient: { async send(command) {
        if (command.constructor.name === 'UpdateItemCommand') return {} as never;
        if (command.constructor.name === 'GetItemCommand') return {} as never;
        throw new Error(`Unexpected checkpoint command ${command.constructor.name}.`);
      } },
    });
    await expect(processor.closed).rejects.toThrow(/shard iterator failed/u);
  });
});

function commandEnvelope(id: string) {
  return { id, contract: { name: 'post.create', version: 'v1' }, payload: { id }, recordedAt: '2026-08-20T12:00:00.000Z', partitionKey: id };
}

function telemetryCarrier(execution: string) {
  return createApplicationTelemetryEnvelopeV1({
    traceparent: '00-fedcba9876543210fedcba9876543210-fedcba9876543210-01',
    identity: {
      application: 'catalog',
      environment: 'test',
      target: 'aws',
      operation: 'command:post.create.v1',
      execution,
      attempt: 1,
    },
  });
}

function memoryEventLog(order: string[]): ApplicationEventLogPublisher {
  return {
    async verify() {},
    async publish(envelope, channel = 'events') { order.push(channel); return { stream: 'events', sequence: 1, duplicate: false, subject: channel, messageId: envelope.id }; },
    async consumerLag() { return { pending: 0, ackPending: 0, redelivered: 0 }; },
    async drain() {},
  };
}

class MemoryKinesisCheckpoints {
  readonly row: Record<string, string | number | undefined> = {};
  private failureRecorded = false;
  constructor(owner: string, private readonly order: string[], private readonly onFirstFailure?: () => void, private readonly onCheckpoint?: () => void) { this.row.ownerToken = owner; }
  async send(command: { constructor: { name: string }; input: Record<string, unknown> }): Promise<Record<string, unknown>> {
    if (command.constructor.name === 'GetItemCommand') return { Item: dynamoRow(this.row) };
    if (command.constructor.name !== 'UpdateItemCommand') throw new Error(`Unexpected DynamoDB command ${command.constructor.name}.`);
    const values = command.input.ExpressionAttributeValues as Record<string, { readonly S?: string; readonly N?: string }>;
    const update = String(command.input.UpdateExpression);
    if (update.startsWith('SET sequenceNumber')) {
      this.onCheckpoint?.();
      this.row.sequenceNumber = values[':sequence']?.S;
      this.row.millisBehindLatest = Number(values[':behind']?.N);
      delete this.row.failureSequence;
      delete this.row.failureAttempts;
      this.order.push('checkpoint');
    } else if (update.startsWith('SET failureSequence')) {
      this.row.failureSequence = values[':sequence']?.S;
      this.row.failureAttempts = Number(values[':attempts']?.N);
      if (!this.failureRecorded) { this.failureRecorded = true; this.onFirstFailure?.(); }
    } else if (update.includes('lastInvalidSequence')) {
      this.row.lastInvalidSequence = values[':sequence']?.S;
      this.row.lastInvalidReason = values[':reason']?.S;
    }
    return {};
  }
}

function dynamoRow(row: Readonly<Record<string, string | number | undefined>>): Record<string, { readonly S?: string; readonly N?: string }> {
  return Object.fromEntries(Object.entries(row).flatMap(([key, value]) => value === undefined ? [] : [[key, typeof value === 'number' ? { N: String(value) } : { S: value }]]));
}

class MemoryS3 {
  readonly objects = new Map<string, { body: string; etag: string }>();
  readonly contentTypes: string[] = [];
  async send(command: { constructor: { name: string }; input: Record<string, unknown> }): Promise<Record<string, unknown>> {
    const key = String(command.input.Key);
    if (command.constructor.name === 'GetObjectCommand') {
      const value = this.objects.get(key);
      if (!value) throw Object.assign(new Error('missing'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
      return { ETag: value.etag, Body: { transformToString: async () => value.body } };
    }
    if (command.constructor.name === 'PutObjectCommand') {
      const current = this.objects.get(key);
      if (command.input.IfNoneMatch === '*' && current) throw Object.assign(new Error('conflict'), { name: 'PreconditionFailed', $metadata: { httpStatusCode: 412 } });
      if (command.input.IfMatch && command.input.IfMatch !== current?.etag) throw Object.assign(new Error('conflict'), { name: 'PreconditionFailed', $metadata: { httpStatusCode: 412 } });
      const body = String(command.input.Body ?? '');
      const etag = `etag-${body.length}-${this.objects.size}`;
      this.objects.set(key, { body, etag });
      if (typeof command.input.ContentType === 'string') this.contentTypes.push(command.input.ContentType);
      return { ETag: etag };
    }
    throw new Error(`Unexpected S3 command ${command.constructor.name}.`);
  }
}

class MemoryGlue {
  readonly tables: Record<string, unknown>[] = [];
  async send(command: { constructor: { name: string }; input: Record<string, unknown> }): Promise<Record<string, unknown>> {
    if (command.constructor.name === 'CreateTableCommand') { this.tables.push(command.input); return {}; }
    if (command.constructor.name === 'GetTableCommand') return { Table: { StorageDescriptor: { Columns: [] } } };
    throw new Error(`Unexpected Glue command ${command.constructor.name}.`);
  }
}

class ConflictingGlue {
  private desired: Record<string, unknown> | undefined;
  async send(command: { constructor: { name: string }; input: Record<string, unknown> }): Promise<Record<string, unknown>> {
    if (command.constructor.name === 'CreateTableCommand') {
      this.desired = command.input;
      const error = new Error('already exists');
      error.name = 'AlreadyExistsException';
      throw error;
    }
    if (command.constructor.name === 'GetTableCommand') {
      const table = this.desired?.TableInput as Record<string, unknown>;
      const storage = table.StorageDescriptor as Record<string, unknown>;
      return { Table: { ...table, StorageDescriptor: { ...storage, Location: 's3://another-owner/' } } };
    }
    throw new Error(`Unexpected Glue command ${command.constructor.name}.`);
  }
}

class MemoryAthena {
  sql = '';
  readonly sqlHistory: string[] = [];
  running = false;
  stopped = false;
  cancelled = false;
  keepRunningAfterStop = false;
  failAfterAdmissionOnce = false;
  conformance = false;
  columns = ['id', 'quantity'];
  rows: (string | undefined)[][] = [['one', '2'], ['two', '3']];
  resultPages?: Array<{ readonly columns: readonly string[]; readonly rows: readonly (readonly (string | undefined)[])[]; readonly nextToken?: string }>;
  readonly startTokens: string[] = [];
  readonly queryIdsByToken = new Map<string, string>();
  readonly resultRequests: Record<string, unknown>[] = [];
  onStart?: () => void;
  async send(command: { constructor: { name: string }; input: Record<string, unknown> }): Promise<Record<string, unknown>> {
    if (command.constructor.name === 'StartQueryExecutionCommand') {
      this.sql = String(command.input.QueryString);
      this.sqlHistory.push(this.sql);
      if (this.conformance) this.selectConformanceRows();
      const token = String(command.input.ClientRequestToken);
      this.startTokens.push(token);
      const queryId = this.queryIdsByToken.get(token) ?? `query-${this.queryIdsByToken.size + 1}`;
      this.queryIdsByToken.set(token, queryId);
      this.onStart?.();
      if (this.failAfterAdmissionOnce) {
        this.failAfterAdmissionOnce = false;
        throw new Error('transport failed after Athena admitted the query');
      }
      return { QueryExecutionId: queryId };
    }
    if (command.constructor.name === 'GetQueryExecutionCommand') return { QueryExecution: { Status: { State: this.cancelled ? 'CANCELLED' : this.running ? 'RUNNING' : 'SUCCEEDED' }, Statistics: { DataScannedInBytes: 512 } } };
    if (command.constructor.name === 'GetQueryResultsCommand') {
      this.resultRequests.push(command.input);
      const pageIndex = command.input.NextToken ? 1 : 0;
      const page = this.resultPages?.[pageIndex];
      const columns = page?.columns ?? this.columns;
      const rows = page?.rows ?? this.rows;
      return {
        ...(page?.nextToken ? { NextToken: page.nextToken } : {}),
        ResultSet: {
          ResultSetMetadata: { ColumnInfo: columns.map((Name) => ({ Name })) },
          Rows: [
            ...(pageIndex === 0 ? [{ Data: columns.map((VarCharValue) => ({ VarCharValue })) }] : []),
            ...rows.map((values) => ({ Data: values.map((VarCharValue) => VarCharValue === undefined ? {} : { VarCharValue }) })),
          ],
        },
      };
    }
    if (command.constructor.name === 'StopQueryExecutionCommand') { this.stopped = true; if (!this.keepRunningAfterStop) { this.running = false; this.cancelled = true; } return {}; }
    throw new Error(`Unexpected Athena command ${command.constructor.name}.`);
  }

  private selectConformanceRows(): void {
    this.columns = ['id', 'group', 'quantity', 'active', 'note'];
    const rows: Record<string, (string | undefined)[]> = {
      a: ['a', 'alpha', '2', 'true', undefined],
      b: ['b', 'alpha', '2', 'false', 'second'],
      c: ['c', 'alpha', '5', 'true', 'third'],
      d: ['d', 'beta', '1', 'true', undefined],
    };
    const ids = this.sql.includes('"note" IS NULL')
      ? ['a', 'd']
      : this.sql.includes('"active" = TRUE')
        ? ['c', 'a']
        : ['a', 'b', 'c'];
    this.rows = ids.map((id) => rows[id]!);
  }
}
