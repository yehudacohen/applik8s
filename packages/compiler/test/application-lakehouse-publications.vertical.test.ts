import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { emitGeneratedApplicationLakehousePublishers } from '../src/application-lakehouse-publishers/index.js';
import { discoverApplicationGraphWithExports } from '../src/pipeline/index.js';

describe('v0.8 lakehouse publication discovery', () => {
  it('lowers exported publications into one provider-bound execution graph', async () => {
    const discovered = await discoverApplicationGraphWithExports(
      new URL('./fixtures/v08-lakehouse-app.ts', import.meta.url).pathname,
      'lakehouseProof',
    );
    expect(discovered.ok, discovered.ok ? undefined : discovered.error.message).toBe(true);
    if (!discovered.ok) return;

    expect(discovered.value.lakehousePublicationExports).toEqual([
      {
        name: 'HistoricalUsage',
        id: 'lakehouse-publication.usage.recorded.v1.historical-usage',
      },
    ]);
    expect(discovered.value.graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'lakehouse-publication.usage.recorded.v1.historical-usage',
        kind: 'lakehousePublication',
        sourceEventId: 'usage.recorded.v1',
        sourceContract: { name: 'usage.recorded', version: 'v1' },
        source: expect.objectContaining({
          jsonSchema: expect.objectContaining({ type: 'object' }),
        }),
        dataset: {
          interface: 'LakehouseDataset',
          nodeId: 'provider.lakehouse-dataset.v1alpha1.historical-usage',
        },
        eventLog: {
          interface: 'EventLog',
          nodeId: 'provider.event-log',
        },
        transform: expect.objectContaining({
          source: expect.stringContaining('output.append'),
          location: expect.objectContaining({ file: expect.stringContaining('v08-lakehouse-app.ts') }),
        }),
        partition: expect.objectContaining({
          source: expect.stringContaining('organizationId'),
          location: expect.objectContaining({ file: expect.stringContaining('v08-lakehouse-app.ts') }),
        }),
      }),
      expect.objectContaining({
        id: 'provider.lakehouse-dataset.v1alpha1.historical-usage',
        kind: 'provider',
        implementation: 'application-target-provider-selection',
        config: expect.objectContaining({
          targetSelection: expect.objectContaining({
            targets: expect.objectContaining({
              local: expect.objectContaining({ implementation: 'duckdb-dataset' }),
              aws: expect.objectContaining({ implementation: 's3-dataset' }),
              kubernetes: expect.objectContaining({ implementation: 's3-dataset' }),
            }),
          }),
        }),
      }),
    ]));
    expect(discovered.value.graph.providerRequirements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        consumer: { nodeId: 'lakehouse-publication.usage.recorded.v1.historical-usage' },
        interface: 'LakehouseDataset',
        purpose: 'lakehouseDataset',
      }),
      expect.objectContaining({
        consumer: { nodeId: 'lakehouse-publication.usage.recorded.v1.historical-usage' },
        interface: 'EventLog',
        purpose: 'eventSubscription',
      }),
    ]));

    const [artifact] = await emitGeneratedApplicationLakehousePublishers({
      graph: discovered.value.graph,
      outDir: await mkdtemp(join(tmpdir(), 'applik8s-lakehouse-publisher-')),
      executionTarget: 'kubernetes',
    });
    const [awsArtifact] = await emitGeneratedApplicationLakehousePublishers({
      graph: discovered.value.graph,
      outDir: await mkdtemp(join(tmpdir(), 'applik8s-lakehouse-publisher-aws-')),
      executionTarget: 'aws',
    });
    expect(artifact).toBeDefined();
    expect(awsArtifact).toBeDefined();
    if (!artifact || !awsArtifact) return;
    expect(artifact.publicationId).toBe('lakehouse-publication.usage.recorded.v1.historical-usage');
    expect(artifact.name).toMatch(/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/u);
    expect(artifact.name).not.toContain('.');
    expect(artifact.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'Consumer',
        spec: expect.objectContaining({
          ackPolicy: 'explicit',
          durableName: artifact.name,
        }),
      }),
      expect.objectContaining({ kind: 'Deployment' }),
    ]));
    const bundled = await readFile(artifact.sourcePath, 'utf8');
    const generated = await readFile(
      join(artifact.sourcePath, '..', 'publisher.cloud.generated.ts'),
      'utf8',
    );
    const awsBundle = await readFile(awsArtifact.sourcePath, 'utf8');
    const localBundle = await readFile(artifact.localSourcePath, 'utf8');
    expect(bundled).toContain('startJetStreamEventConsumer');
    expect(generated).toContain("return normalizeSchema(");
    expect(generated).not.toContain('if (!normalized.ok)');
    expect(generated).toContain('transformCallback(event, { append })');
    expect(generated).toContain('const validated = rowSchema.validate(row)');
    expect(generated).toContain("typeof runtime.close === 'function'");
    expect(bundled).not.toContain('APPLIK8S_KINESIS_CHECKPOINT_TABLE');
    expect(awsBundle).toContain('APPLIK8S_KINESIS_CHECKPOINT_TABLE');
    expect(awsBundle).not.toContain('APPLIK8S_NATS_STREAM');
    expect(bundled).not.toContain('createDuckDbApplicationLakehouseRuntime');
    expect(awsBundle).not.toContain('createDuckDbApplicationLakehouseRuntime');
    expect(localBundle).toContain('createDuckDbApplicationLakehouseRuntime');
    expect(localBundle).toContain('startJetStreamEventConsumer');
    expect(localBundle).not.toContain('APPLIK8S_KINESIS_CHECKPOINT_TABLE');
    expect(Buffer.byteLength(bundled)).toBeLessThan(2 * 1024 * 1024);
    expect(Buffer.byteLength(awsBundle)).toBeLessThan(2 * 1024 * 1024);
    expect(Buffer.byteLength(localBundle)).toBeLessThan(512 * 1024);
  }, 60_000);

  it('installs the selected telemetry runtime around the complete event-consumer lifecycle', async () => {
    const discovered = await discoverApplicationGraphWithExports(
      new URL('./fixtures/v08-observed-lakehouse-app.ts', import.meta.url).pathname,
      'observedLakehouseProof',
    );
    expect(discovered.ok, discovered.ok ? undefined : discovered.error.message).toBe(true);
    if (!discovered.ok) return;

    const [artifact] = await emitGeneratedApplicationLakehousePublishers({
      graph: discovered.value.graph,
      outDir: await mkdtemp(join(tmpdir(), 'applik8s-observed-lakehouse-publisher-')),
      executionTarget: 'kubernetes',
    });
    expect(artifact).toBeDefined();
    if (!artifact) return;
    const bundled = await readFile(artifact.sourcePath, 'utf8');
    const sourceMap = JSON.parse(await readFile(artifact.sourceMapPath, 'utf8')) as {
      readonly sources?: readonly unknown[];
    };
    const generated = await readFile(
      join(artifact.sourcePath, '..', 'publisher.cloud.generated.ts'),
      'utf8',
    );
    expect(bundled).toContain('startApplicationOpenTelemetryRuntime');
    const telemetrySources = (sourceMap.sources ?? []).filter(
      (source): source is string => typeof source === 'string'
        && /application-telemetry-runtime\.[jt]s$/u.test(source),
    );
    expect(telemetrySources).toHaveLength(1);
    expect(telemetrySources[0]).toContain('packages/applik8s/src/application-telemetry-runtime.ts');
    expect(generated).toContain('installApplicationTelemetryRuntimeResolver');
    expect(generated).toContain('closeApplicationTelemetryRuntime');
    expect(generated).toContain("finally { await drain('runner-closed'); }");
    expect(bundled).toContain('startJetStreamEventConsumer');
    // This worker contains both the selected S3/Glue dataset adapter and the
    // complete OTLP runtime. Keep a role-specific ceiling rather than reusing
    // the smaller agent-only budget.
    expect(Buffer.byteLength(bundled)).toBeLessThan(3 * 1024 * 1024);
  }, 60_000);
});
