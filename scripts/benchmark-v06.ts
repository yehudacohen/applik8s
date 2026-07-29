// typecast-file-boundary: benchmark arguments, tracked budgets, and synthetic fixtures are repository-owned inputs validated by the measurements below.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus, platform } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';
import { queryCacheKey } from '../packages/client/src/store.js';
import {
  runApplicationProjection,
  type ApplicationProjectionWriter,
  type ApplicationStreamEnvelope,
} from '../packages/applik8s/src/projection-runtime-clickhouse.js';
import {
  generatedApplicationFacadeSource,
  type ApplicationFacadeManifest,
} from '../packages/compiler/src/application-facade/index.js';

const execFileAsync = promisify(execFile);
const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const budgets = JSON.parse(await readFile(join(root, 'benchmarks/v0.6/budgets.json'), 'utf8')) as {
  readonly client: {
    readonly minimumCacheKeysPerSecond: number;
    readonly maximumP95Ms: number;
    readonly maximumRssGrowthBytes: number;
  };
  readonly projection: {
    readonly minimumEventsPerSecond: number;
    readonly maximumConvergenceMs: number;
    readonly maximumColdStartMs: number;
    readonly maximumRssGrowthBytes: number;
  };
  readonly facade: { readonly maximumMinimalGzipBytes: number; readonly maximumMarginalModelGzipBytes: number };
};
const quick = process.argv.includes('--quick');
const record = process.argv.includes('--record');
const operations = quick ? 2_000 : 20_000;

const client = benchmarkClientCacheKeys(operations);
const projection = await benchmarkProjectionReplay(operations);
const oneModelFacadeBytes = facadeGzipBytes(1);
const twoModelFacadeBytes = facadeGzipBytes(2);
const report = {
  schemaVersion: 4,
  release: 'v0.6',
  evidenceClass: 'synthetic-local',
  limitations: [
    'This benchmark measures in-process cache-key generation and projection replay only; it does not measure network, PostgreSQL, ClickHouse, Kubernetes scheduling, Harbor, Ceph, or multi-process contention.',
    'The consumer-lag and projection-convergence values describe a finite synthetic replay, not a sustained production arrival rate.',
    'Connection-pool, datastore, registry, object-storage, and cluster performance require explicit live evidence lanes.',
  ],
  generatedAt: new Date().toISOString(),
  git: await gitRevision(),
  environment: {
    platform: platform(),
    architecture: process.arch,
    cpuModel: cpus()[0]?.model ?? 'unknown',
    cpuCount: cpus().length,
    runtime: `bun-${Bun.version}`,
  },
  operations,
  client,
  projection,
  facade: { minimalGzipBytes: oneModelFacadeBytes, marginalModelGzipBytes: twoModelFacadeBytes - oneModelFacadeBytes },
};
const violations = [
  report.client.cacheKeysPerSecond < budgets.client.minimumCacheKeysPerSecond ? 'client cache-key throughput' : '',
  report.client.latencyMs.p95 > budgets.client.maximumP95Ms ? 'client cache-key p95 latency' : '',
  report.client.rssGrowthBytes > budgets.client.maximumRssGrowthBytes ? 'client cache-key RSS growth' : '',
  report.projection.eventsPerSecond < budgets.projection.minimumEventsPerSecond ? 'projection throughput' : '',
  report.projection.convergenceMs > budgets.projection.maximumConvergenceMs ? 'projection convergence' : '',
  report.projection.coldStartMs > budgets.projection.maximumColdStartMs ? 'projection cold start' : '',
  report.projection.rssGrowthBytes > budgets.projection.maximumRssGrowthBytes ? 'projection RSS growth' : '',
  report.facade.minimalGzipBytes > budgets.facade.maximumMinimalGzipBytes ? 'minimal browser facade gzip size' : '',
  report.facade.marginalModelGzipBytes > budgets.facade.maximumMarginalModelGzipBytes ? 'marginal browser facade growth' : '',
].filter(Boolean);
console.log(JSON.stringify({ ...report, violations }, null, 2));
if (violations.length) throw new Error(`v0.6 benchmark budgets exceeded: ${violations.join(', ')}`);
if (record) {
  const history = join(root, 'benchmarks/v0.6/history');
  await mkdir(history, { recursive: true });
  await writeFile(join(root, 'benchmarks/v0.6/baseline.json'), `${JSON.stringify(report, null, 2)}\n`);
  const name = `${report.generatedAt.replace(/[:.]/g, '-')}-${report.git.commit.slice(0, 8)}-${report.environment.platform}-${report.environment.architecture}.json`;
  await writeFile(join(history, name), `${JSON.stringify(report, null, 2)}\n`);
}

function benchmarkClientCacheKeys(count: number) {
  for (let index = 0; index < 100; index += 1) {
    queryCacheKey('accounts.list.v1', { organizationId: `organization-${index % 10}`, page: index });
  }
  const latencies: number[] = [];
  const memoryBefore = process.memoryUsage().rss;
  const started = performance.now();
  for (let index = 0; index < count; index += 1) {
    const operationStarted = performance.now();
    queryCacheKey('accounts.list.v1', { organizationId: `organization-${index % 100}`, page: index });
    latencies.push(performance.now() - operationStarted);
  }
  const durationMs = performance.now() - started;
  return {
    durationMs: round(durationMs),
    cacheKeysPerSecond: round(count / (durationMs / 1_000)),
    latencyMs: quantiles(latencies),
    rssGrowthBytes: Math.max(0, process.memoryUsage().rss - memoryBefore),
  };
}

async function benchmarkProjectionReplay(count: number) {
  const coldStartEnvelope = syntheticEnvelope(0);
  const coldStartStarted = performance.now();
  await replayProjection([coldStartEnvelope], 1);
  const coldStartMs = performance.now() - coldStartStarted;

  const envelopes = Array.from({ length: count }, (_, index) => syntheticEnvelope(index));
  const memoryBefore = process.memoryUsage().rss;
  const started = performance.now();
  const result = await replayProjection(envelopes, 500);
  const convergenceMs = performance.now() - started;
  if (result.processed !== count || result.checkpoint !== count || !result.exhausted) {
    throw new Error(`Synthetic projection benchmark did not consume its complete replay: ${JSON.stringify(result)}.`);
  }
  return {
    coldStartMs: round(coldStartMs),
    convergenceMs: round(convergenceMs),
    eventsPerSecond: round(count / (convergenceMs / 1_000)),
    batches: Math.ceil(count / 500),
    consumerLag: { initial: count, maximum: count, final: 0 },
    rssGrowthBytes: Math.max(0, process.memoryUsage().rss - memoryBefore),
  };
}

async function replayProjection(envelopes: readonly ApplicationStreamEnvelope<{ accountId: string }>[], batchSize: number) {
  let offset = 0;
  let checkpoint = 0;
  const store: ApplicationProjectionWriter<{ accountId: string }> = {
    async prepare() {},
    async checkpoint(projection, stream) { return { projection, stream, sequence: checkpoint }; },
    async write() {},
    async advance(next) { checkpoint = next.sequence; },
    async reset() { checkpoint = 0; },
  };
  return runApplicationProjection({
    projection: 'accounts',
    streamName: 'accounts.changed.v1',
    source: {
      async read(_after, limit) {
        const items = envelopes.slice(offset, offset + limit);
        offset += items.length;
        return {
          items,
          nextSequence: items.at(-1)?.sequence ?? checkpoint,
          exhausted: offset >= envelopes.length,
          retentionFloor: 0,
        };
      },
    },
    store,
    project: (payload) => payload,
    batchSize,
    maxBatches: Math.max(1, Math.ceil(envelopes.length / batchSize)),
  });
}

function syntheticEnvelope(index: number): ApplicationStreamEnvelope<{ accountId: string }> {
  return {
    id: `event-${index}`,
    stream: { name: 'accounts.changed', version: 'v1' },
    sequence: index + 1,
    partitionKey: `account-${index % 100}`,
    recordedAt: '2026-07-15T00:00:00.000Z',
    payload: { accountId: `account-${index % 100}` },
  };
}

function quantiles(values: readonly number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const at = (fraction: number) => round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0);
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99), maximum: round(sorted.at(-1) ?? 0) };
}

function round(value: number): number { return Math.round(value * 100) / 100; }

function facadeGzipBytes(modelCount: number): number {
  const manifest: ApplicationFacadeManifest = {
    apiVersion: 'applik8s.facade/v1alpha1',
    application: 'benchmark',
    objectStores: [],
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

async function gitRevision(): Promise<{ readonly commit: string; readonly dirty: boolean; readonly workingTreeDigest?: string }> {
  const [{ stdout: commit }, { stdout: status }, { stdout: diff }] = await Promise.all([
    execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root }),
    execFileAsync('git', ['status', '--porcelain'], { cwd: root }),
    execFileAsync('git', ['diff', '--binary', 'HEAD'], { cwd: root, maxBuffer: 100 * 1024 * 1024 }),
  ]);
  const dirty = status.trim().length > 0;
  return { commit: commit.trim(), dirty, ...(dirty ? { workingTreeDigest: createHash('sha256').update(diff).digest('hex') } : {}) };
}
