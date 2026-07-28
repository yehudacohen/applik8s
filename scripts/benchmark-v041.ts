import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { cpus, freemem, platform, release, tmpdir, totalmem } from 'node:os';
import { extname, join, relative } from 'node:path';
import { promisify } from 'node:util';
import { consumeWithBoundedConcurrency } from '../packages/applik8s/src/bounded-concurrency.js';
import { startJetStreamCommandProcessor } from '@applik8s/runtime-nats';
import { AckPolicy, connect, JSONCodec, RetentionPolicy, StorageType } from 'nats';
import postgres from 'postgres';

const execFileAsync = promisify(execFile);
const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
// typecast: the tracked budget file is validated by its complete use below and remains a simple versioned data contract.
const budgets = JSON.parse(await readFile(join(root, 'benchmarks/v0.4.1/budgets.json'), 'utf8')) as BenchmarkBudgets;
const quick = process.argv.includes('--quick');
const record = process.argv.includes('--record');

const scheduler = await schedulerBenchmark();
const coldStart = await coldStartBenchmark();
const databaseContention = await databaseContentionBenchmark();
const consumerScaling = await consumerScalingBenchmark();
const builds = quick ? undefined : await buildBenchmarks();
const report = {
  schemaVersion: 1,
  release: 'v0.4.1',
  generatedAt: new Date().toISOString(),
  git: await gitRevision(),
  environment: {
    platform: platform(),
    release: release(),
    architecture: process.arch,
    cpuModel: cpus()[0]?.model ?? 'unknown',
    cpuCount: cpus().length,
    totalMemoryBytes: totalmem(),
    freeMemoryBytes: freemem(),
    runtime: `bun-${Bun.version}`,
    homeRedacted: true,
  },
  scheduler,
  coldStart,
  databaseContention,
  consumerScaling,
  ...(builds ? { builds } : {}),
  capacityScenarios: [1, 2, 4].map((replicas) => ({
    replicas,
    concurrencyPerReplica: 8,
    maximumInFlight: replicas * 8,
    requestedCpuMillicores: replicas * 50,
    requestedMemoryMiB: replicas * 128,
    limitedCpuMillicores: replicas * 1_000,
    limitedMemoryMiB: replicas * 512,
  })),
};

const violations = budgetViolations(report, budgets);
if (record) {
  const path = join(root, 'benchmarks/v0.4.1/baseline.json');
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
  const historyDirectory = join(root, 'benchmarks/v0.4.1/history');
  await mkdir(historyDirectory, { recursive: true });
  const historyName = `${report.generatedAt.replace(/[:.]/g, '-')}-${report.git.commit.slice(0, 8)}-${report.environment.platform}-${report.environment.architecture}.json`;
  await writeFile(join(historyDirectory, historyName), `${JSON.stringify(report, null, 2)}\n`);
}
process.stdout.write(`${JSON.stringify({ ...report, budgetViolations: violations }, null, 2)}\n`);
if (violations.length > 0) {
  process.stderr.write(`v0.4.1 benchmark budgets exceeded:\n${violations.map((violation) => `- ${violation}`).join('\n')}\n`);
  process.exitCode = 1;
}

async function schedulerBenchmark() {
  const count = quick ? 100 : 1_000;
  const concurrency = 8;
  const started = performance.now();
  const latencies: number[] = [];
  let maximumActive = 0;
  const memoryBefore = process.memoryUsage();
  async function* values() {
    for (let index = 0; index < count; index += 1) yield index;
  }
  await consumeWithBoundedConcurrency(values(), concurrency, async () => {
    const taskStarted = performance.now();
    await new Promise((resolve) => setTimeout(resolve, 1));
    latencies.push(performance.now() - taskStarted);
  }, (observation) => { maximumActive = Math.max(maximumActive, observation.maximumActive); });
  const durationMs = performance.now() - started;
  const memoryAfter = process.memoryUsage();
  return {
    operations: count,
    concurrency,
    durationMs: round(durationMs),
    throughputPerSecond: round(count / (durationMs / 1_000)),
    taskLatencyMs: quantiles(latencies),
    maximumActive,
    rssGrowthBytes: Math.max(0, memoryAfter.rss - memoryBefore.rss),
    heapGrowthBytes: Math.max(0, memoryAfter.heapUsed - memoryBefore.heapUsed),
  };
}

async function coldStartBenchmark() {
  const samples: number[] = [];
  const target = join(root, 'packages/applik8s/dist/processor-runtime.js');
  try {
    await stat(target);
  } catch {
    return { samples: 0, importLatencyMs: { p50: 0, p95: 0, p99: 0, maximum: 0 }, skipped: 'Run bun run build:packages before recording a cold-start baseline.' };
  }
  for (let index = 0; index < (quick ? 2 : 5); index += 1) {
    const started = performance.now();
    await execFileAsync(process.execPath, ['--input-type=module', '--eval', `await import(${JSON.stringify(new URL(`file://${target}`).href)})`], { timeout: 15_000 });
    samples.push(performance.now() - started);
  }
  return { samples: samples.length, importLatencyMs: quantiles(samples) };
}

async function buildBenchmarks() {
  const directory = await mkdtemp(join(tmpdir(), 'applik8s-v041-benchmark-'));
  try {
    const imagejob = await measuredBuild(['run', 'applik8s', 'build', join(root, 'examples/imagejob.ts'), '--out-dir', join(directory, 'imagejob')], join(directory, 'imagejob'));
    const tenant = await measuredBuild(['run', 'applik8s', 'build', join(root, 'examples/tenant-platform.ts'), '--typekro', '--composition-name', 'tenantPlatformV04', '--out-dir', join(directory, 'tenant')], join(directory, 'tenant'));
    return { imagejob, tenant };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function databaseContentionBenchmark() {
  const databaseUrl = process.env.APPLIK8S_BENCH_DATABASE_URL;
  if (!databaseUrl) return { skipped: 'Set APPLIK8S_BENCH_DATABASE_URL to benchmark transaction and advisory-lock contention.' };
  const sql = postgres(databaseUrl, { max: 16, idle_timeout: 2 });
  const table = 'applik8s_v041_benchmark_contention';
  try {
    await sql.unsafe(`CREATE TABLE IF NOT EXISTS ${table} (id text PRIMARY KEY, value bigint NOT NULL DEFAULT 0)`);
    for (let index = 0; index < 64; index += 1) await sql.unsafe(`INSERT INTO ${table} (id) VALUES ($1) ON CONFLICT (id) DO UPDATE SET value = 0`, [`key-${index}`]);
    const sameKey = await contentionScenario(sql, table, 'same-key', () => 'key-0');
    const distinctKeys = await contentionScenario(sql, table, 'distinct-keys', (index) => `key-${index % 64}`);
    return { sameKey, distinctKeys };
  } finally {
    await sql.unsafe(`DROP TABLE IF EXISTS ${table}`);
    await sql.end({ timeout: 2 });
  }
}

async function contentionScenario(sql: postgres.Sql, table: string, name: string, key: (index: number) => string) {
  const operations = quick ? 40 : 200;
  const concurrency = 8;
  const latencies: number[] = [];
  const started = performance.now();
  async function* indexes() { for (let index = 0; index < operations; index += 1) yield index; }
  await consumeWithBoundedConcurrency(indexes(), concurrency, async (index) => {
    const operationStarted = performance.now();
    await sql.begin(async (transaction) => {
      await transaction.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key(index)]);
      await transaction.unsafe(`UPDATE ${table} SET value = value + 1 WHERE id = $1`, [key(index)]);
    });
    latencies.push(performance.now() - operationStarted);
  });
  const durationMs = performance.now() - started;
  return { name, operations, concurrency, durationMs: round(durationMs), throughputPerSecond: round(operations / (durationMs / 1_000)), latencyMs: quantiles(latencies) };
}

async function consumerScalingBenchmark() {
  const server = process.env.APPLIK8S_BENCH_NATS_URL;
  if (!server) return { skipped: 'Set APPLIK8S_BENCH_NATS_URL to benchmark one, two, and four replicas against a real JetStream server.' };
  const connection = await connect({ servers: server, name: 'applik8s-v041-benchmark-manager' });
  const manager = await connection.jetstreamManager();
  const codec = JSONCodec<object>();
  const scenarios = [];
  const activeStreams = new Set<string>();
  try {
    for (const replicas of [1, 2, 4]) {
      const suffix = `${process.pid}-${replicas}`;
      const stream = `APPLIK8S_BENCH_${suffix}`.replace(/[^A-Z0-9_]/g, '_');
      const consumer = `bench-${suffix}`;
      const subjectPrefix = `applik8s-bench-${suffix}`;
      await manager.streams.add({ name: stream, subjects: [`${subjectPrefix}.>`], retention: RetentionPolicy.Limits, storage: StorageType.Memory });
      activeStreams.add(stream);
      await manager.consumers.add(stream, { durable_name: consumer, ack_policy: AckPolicy.Explicit, filter_subject: `${subjectPrefix}.commands.benchmark.v1.>` });
      let completed = 0;
      const processors = await Promise.all(Array.from({ length: replicas }, () => startJetStreamCommandProcessor({
        servers: [server], stream, consumer, subjectPrefix, concurrency: 4,
        bindings: [{ bindingId: 'benchmark', contract: { name: 'benchmark', version: 'v1' }, async execute() { completed += 1; } }],
      })));
      const operations = quick ? 100 : 500;
      const started = performance.now();
      const jetStream = connection.jetstream();
      await Promise.all(Array.from({ length: operations }, (_, index) => jetStream.publish(`${subjectPrefix}.commands.benchmark.v1.key-${index % 32}`, codec.encode({
        id: `benchmark-${replicas}-${index}`, contract: { name: 'benchmark', version: 'v1' }, payload: { index }, recordedAt: new Date().toISOString(), routing: { binding: 'benchmark' },
      }))));
      while (completed < operations && performance.now() - started < 30_000) await new Promise((resolve) => setTimeout(resolve, 10));
      const durationMs = performance.now() - started;
      await Promise.all(processors.map((processor) => processor.drain()));
      if (completed !== operations) throw new Error(`JetStream scaling benchmark timed out after processing ${completed}/${operations} messages with ${replicas} replicas.`);
      scenarios.push({ replicas, concurrencyPerReplica: 4, operations, durationMs: round(durationMs), throughputPerSecond: round(operations / (durationMs / 1_000)) });
      await manager.streams.delete(stream);
      activeStreams.delete(stream);
    }
    return { server: '<redacted>', scenarios };
  } finally {
    await Promise.all([...activeStreams].map(async (stream) => { try { await manager.streams.delete(stream); } catch { /* best-effort cleanup after a benchmark failure */ } }));
    await connection.drain();
  }
}

async function measuredBuild(args: string[], outputDirectory: string) {
  const started = performance.now();
  await execFileAsync('bun', args, { cwd: root, timeout: 180_000, maxBuffer: 20 * 1024 * 1024 });
  const durationMs = performance.now() - started;
  const files = await artifactFiles(outputDirectory);
  const sizes = files.map((file) => file.sizeBytes);
  return {
    durationMs: round(durationMs),
    fileCount: files.length,
    totalBytes: sizes.reduce((sum, size) => sum + size, 0),
    maximumFileBytes: Math.max(0, ...sizes),
    maximumJavaScriptBytes: Math.max(0, ...files.filter((file) => ['.js', '.mjs'].includes(file.extension)).map((file) => file.sizeBytes)),
    maximumWasmBytes: Math.max(0, ...files.filter((file) => file.extension === '.wasm').map((file) => file.sizeBytes)),
    largestFiles: [...files].sort((left, right) => right.sizeBytes - left.sizeBytes).slice(0, 8),
  };
}

async function artifactFiles(directory: string): Promise<{ readonly path: string; readonly extension: string; readonly sizeBytes: number }[]> {
  const result: { path: string; extension: string; sizeBytes: number }[] = [];
  async function visit(current: string) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) result.push({ path: relative(directory, path), extension: extname(path), sizeBytes: (await stat(path)).size });
    }
  }
  await visit(directory);
  return result;
}

function budgetViolations(report: BenchmarkReportMetrics, limits: BenchmarkBudgets): string[] {
  const violations: string[] = [];
  if (report.scheduler.maximumActive > report.scheduler.concurrency) violations.push(`scheduler maximum active ${report.scheduler.maximumActive} exceeded concurrency ${report.scheduler.concurrency}`);
  if (report.scheduler.throughputPerSecond < limits.scheduler.minimumThroughputPerSecond) violations.push(`scheduler throughput ${report.scheduler.throughputPerSecond}/s is below ${limits.scheduler.minimumThroughputPerSecond}/s`);
  if (report.scheduler.rssGrowthBytes > limits.scheduler.maximumRssGrowthBytes) violations.push(`scheduler RSS growth ${report.scheduler.rssGrowthBytes} exceeds ${limits.scheduler.maximumRssGrowthBytes}`);
  if (!('skipped' in report.coldStart) && report.coldStart.importLatencyMs.p95 > limits.coldStart.maximumP95Ms) violations.push(`cold-start p95 ${report.coldStart.importLatencyMs.p95}ms exceeds ${limits.coldStart.maximumP95Ms}ms`);
  for (const [name, build] of Object.entries(report.builds ?? {})) {
    if (build.durationMs > limits.build.maximumDurationMs) violations.push(`${name} build ${build.durationMs}ms exceeds ${limits.build.maximumDurationMs}ms`);
    if (build.maximumJavaScriptBytes > limits.artifacts.maximumJavaScriptBytes) violations.push(`${name} JavaScript artifact ${build.maximumJavaScriptBytes} bytes exceeds ${limits.artifacts.maximumJavaScriptBytes}`);
    if (build.maximumWasmBytes > limits.artifacts.maximumWasmBytes) violations.push(`${name} WASM artifact ${build.maximumWasmBytes} bytes exceeds ${limits.artifacts.maximumWasmBytes}`);
  }
  return violations;
}

async function gitRevision(): Promise<{ readonly commit: string; readonly dirty: boolean; readonly workingTreeDigest?: string }> {
  const [{ stdout: commit }, { stdout: status }, { stdout: trackedDiff }, { stdout: untrackedOutput }] = await Promise.all([
    execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root }),
    execFileAsync('git', ['status', '--porcelain'], { cwd: root }),
    execFileAsync('git', ['diff', '--binary', 'HEAD'], { cwd: root, maxBuffer: 20 * 1024 * 1024 }),
    execFileAsync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: root }),
  ]);
  const dirty = status.trim().length > 0;
  if (!dirty) return { commit: commit.trim(), dirty };
  const digest = createHash('sha256').update(trackedDiff);
  const untracked = untrackedOutput.split('\n').filter((path) => path && !path.startsWith('benchmarks/v0.4.1/')).sort();
  for (const path of untracked) {
    digest.update(`\0${path}\0`);
    digest.update(await readFile(join(root, path)));
  }
  return { commit: commit.trim(), dirty, workingTreeDigest: `sha256:${digest.digest('hex')}` };
}

function quantiles(values: readonly number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const at = (fraction: number) => round(sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))] ?? 0);
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99), maximum: round(sorted.at(-1) ?? 0) };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

interface BenchmarkBudgets {
  readonly scheduler: { readonly minimumThroughputPerSecond: number; readonly maximumRssGrowthBytes: number };
  readonly coldStart: { readonly maximumP95Ms: number };
  readonly build: { readonly maximumDurationMs: number };
  readonly artifacts: { readonly maximumJavaScriptBytes: number; readonly maximumWasmBytes: number };
}

interface BenchmarkReportMetrics {
  readonly scheduler: Awaited<ReturnType<typeof schedulerBenchmark>>;
  readonly coldStart: Awaited<ReturnType<typeof coldStartBenchmark>>;
  readonly builds?: Readonly<Record<string, Awaited<ReturnType<typeof measuredBuild>>>>;
}
