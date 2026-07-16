// typecast-file-boundary: benchmark argument and synthetic envelope fixtures are locally bounded and validated before measurement.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { queryCacheKey } from '../packages/client/src/store.js';
import {
  runApplicationProjection,
  type ApplicationProjectionStore,
  type ApplicationStreamEnvelope,
} from '../packages/applik8s/src/projection-runtime-clickhouse.js';
import {
  generatedApplicationFacadeSource,
  type ApplicationFacadeManifest,
} from '../packages/compiler/src/application-facade/index.js';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const budgets = JSON.parse(await readFile(join(root, 'benchmarks/v0.6/budgets.json'), 'utf8')) as {
  readonly client: { readonly minimumCacheKeysPerSecond: number };
  readonly projection: { readonly minimumEventsPerSecond: number; readonly maximumRssGrowthBytes: number };
  readonly facade: { readonly maximumMinimalGzipBytes: number; readonly maximumMarginalModelGzipBytes: number };
};
const operations = process.argv.includes('--quick') ? 2_000 : 20_000;
const clientStarted = performance.now();
for (let index = 0; index < operations; index += 1) queryCacheKey('accounts.list.v1', { organizationId: `organization-${index % 100}`, page: index });
const clientDurationMs = performance.now() - clientStarted;
const envelopes: ApplicationStreamEnvelope<{ accountId: string }>[] = Array.from({ length: operations }, (_, index) => ({ id: `event-${index}`, stream: { name: 'accounts.changed', version: 'v1' }, sequence: index + 1, partitionKey: `account-${index % 100}`, recordedAt: '2026-07-15T00:00:00.000Z', payload: { accountId: `account-${index % 100}` } }));
let offset = 0;
let checkpoint = 0;
const store: ApplicationProjectionStore<{ accountId: string }> = { async prepare() {}, async checkpoint(projection, stream) { return { projection, stream, sequence: checkpoint }; }, async write() {}, async advance(next) { checkpoint = next.sequence; }, async reset() { checkpoint = 0; } };
const memoryBefore = process.memoryUsage().rss;
const projectionStarted = performance.now();
await runApplicationProjection({ projection: 'accounts', streamName: 'accounts.changed.v1', source: { async read(_after, limit) { const items = envelopes.slice(offset, offset + limit); offset += items.length; return { items, nextSequence: items.at(-1)?.sequence ?? checkpoint, exhausted: offset >= envelopes.length, retentionFloor: envelopes.length > 0 ? 1 : 0 }; } }, store, project: (payload) => payload, batchSize: 500, maxBatches: Math.ceil(operations / 500) });
const projectionDurationMs = performance.now() - projectionStarted;
const oneModelFacadeBytes = facadeGzipBytes(1);
const twoModelFacadeBytes = facadeGzipBytes(2);
const report = {
  schemaVersion: 3,
  release: 'v0.6',
  evidenceClass: 'synthetic-local',
  limitations: ['No network, PostgreSQL, ClickHouse, Kubernetes scheduler, or multi-process contention is measured by this microbenchmark.', 'Datastore and cluster performance require the explicit live benchmark/evidence lanes.'],
  generatedAt: new Date().toISOString(),
  operations,
  client: { durationMs: round(clientDurationMs), cacheKeysPerSecond: round(operations / (clientDurationMs / 1000)) },
  projection: { durationMs: round(projectionDurationMs), eventsPerSecond: round(operations / (projectionDurationMs / 1000)), rssGrowthBytes: Math.max(0, process.memoryUsage().rss - memoryBefore) },
  facade: { minimalGzipBytes: oneModelFacadeBytes, marginalModelGzipBytes: twoModelFacadeBytes - oneModelFacadeBytes },
};
const violations = [
  report.client.cacheKeysPerSecond < budgets.client.minimumCacheKeysPerSecond ? 'client cache-key throughput' : '',
  report.projection.eventsPerSecond < budgets.projection.minimumEventsPerSecond ? 'projection throughput' : '',
  report.projection.rssGrowthBytes > budgets.projection.maximumRssGrowthBytes ? 'projection RSS growth' : '',
  report.facade.minimalGzipBytes > budgets.facade.maximumMinimalGzipBytes ? 'minimal browser facade gzip size' : '',
  report.facade.marginalModelGzipBytes > budgets.facade.maximumMarginalModelGzipBytes ? 'marginal browser facade growth' : '',
].filter(Boolean);
if (process.argv.includes('--record')) { await mkdir(join(root, 'benchmarks/v0.6/history'), { recursive: true }); await writeFile(join(root, 'benchmarks/v0.6/baseline.json'), `${JSON.stringify(report, null, 2)}\n`); await writeFile(join(root, 'benchmarks/v0.6/history', `${report.generatedAt.replace(/[:.]/g, '-')}.json`), `${JSON.stringify(report, null, 2)}\n`); }
console.log(JSON.stringify({ ...report, violations }, null, 2));
if (violations.length) throw new Error(`v0.6 benchmark budgets exceeded: ${violations.join(', ')}`);

function round(value: number): number { return Math.round(value * 100) / 100; }

function facadeGzipBytes(modelCount: number): number {
  const manifest: ApplicationFacadeManifest = {
    apiVersion: 'applik8s.facade/v1alpha1',
    application: 'benchmark',
    models: Array.from({ length: modelCount }, (_, index) => ({
      name: `Model${index + 1}`,
      operations: [{
        id: `Model${index + 1}.create`,
        name: 'create',
        operation: 'create',
        transport: 'command',
      }, {
        id: `Model${index + 1}.published`,
        name: 'published',
        operation: 'query',
        transport: 'query',
      }],
    })),
  };
  return gzipSync(generatedApplicationFacadeSource(manifest, 'browser'), { level: 9 }).byteLength;
}
