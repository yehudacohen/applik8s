import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { cpus, platform, tmpdir } from 'node:os';
import { extname, join, relative } from 'node:path';
import { promisify } from 'node:util';
import { applicationGraphFor } from '@applik8s/applik8s';
import { waitForHatchetResult } from '../packages/applik8s/src/workflow-runtime-hatchet.js';

const execFileAsync = promisify(execFile);
const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
// typecast: the tracked benchmark budget is a closed repository-owned JSON contract consumed completely below.
const budgets = JSON.parse(await readFile(join(root, 'benchmarks/v0.5/budgets.json'), 'utf8')) as {
  readonly observation: { readonly minimumThroughputPerSecond: number; readonly maximumP95Ms: number; readonly maximumRssGrowthBytes: number };
  readonly graph: { readonly minimumBuildsPerSecond: number };
  readonly build: { readonly maximumDurationMs: number; readonly maximumWorkflowJavaScriptBytes: number; readonly maximumWorkflowGzipBytes: number };
};
const quick = process.argv.includes('--quick');
const record = process.argv.includes('--record');

const observation = await observationBenchmark();
const graph = await graphBenchmark();
const build = quick ? undefined : await buildBenchmark();
const report = {
  schemaVersion: 1,
  release: 'v0.5',
  generatedAt: new Date().toISOString(),
  git: await gitRevision(),
  environment: { platform: platform(), architecture: process.arch, cpuModel: cpus()[0]?.model ?? 'unknown', cpuCount: cpus().length, runtime: `bun-${Bun.version}` },
  observation,
  graph,
  ...(build ? { build } : {}),
  capacityScenarios: [1, 2, 4].map((replicas) => ({
    replicas,
    taskSlotsPerReplica: 16,
    durableSlotsPerReplica: 16,
    maximumTaskConcurrency: replicas * 16,
    requestedCpuMillicores: replicas * 100,
    requestedMemoryMiB: replicas * 128,
    limitedCpuMillicores: replicas * 1_000,
    limitedMemoryMiB: replicas * 512,
    relativeRequestedCapacityCost: replicas,
  })),
};
const violations = budgetViolations(report);
if (record) {
  const directory = join(root, 'benchmarks/v0.5');
  await mkdir(join(directory, 'history'), { recursive: true });
  await writeFile(join(directory, 'baseline.json'), `${JSON.stringify(report, null, 2)}\n`);
  const name = `${report.generatedAt.replace(/[:.]/g, '-')}-${report.git.commit.slice(0, 8)}-${report.environment.platform}-${report.environment.architecture}.json`;
  await writeFile(join(directory, 'history', name), `${JSON.stringify(report, null, 2)}\n`);
}
process.stdout.write(`${JSON.stringify({ ...report, budgetViolations: violations }, null, 2)}\n`);
if (violations.length > 0) throw new Error(`v0.5 benchmark budgets exceeded:\n${violations.map((violation) => `- ${violation}`).join('\n')}`);

async function observationBenchmark() {
  const operations = quick ? 100 : 1_000;
  const latencies: number[] = [];
  const memoryBefore = process.memoryUsage().rss;
  const client = { runs: { get: async () => ({ run: { status: 'COMPLETED', output: { completed: true } } }) } };
  const started = performance.now();
  for (let index = 0; index < operations; index += 1) {
    const operationStarted = performance.now();
    // typecast: the benchmark deliberately isolates the runs.get observation boundary from the rest of the Hatchet SDK.
    await waitForHatchetResult<{ completed: boolean }>(client as never, `benchmark-${index}`, { timeoutMs: 1_000 });
    latencies.push(performance.now() - operationStarted);
  }
  const durationMs = performance.now() - started;
  return { operations, durationMs: round(durationMs), throughputPerSecond: round(operations / (durationMs / 1_000)), latencyMs: quantiles(latencies), rssGrowthBytes: Math.max(0, process.memoryUsage().rss - memoryBefore) };
}

async function graphBenchmark() {
  // static-import-exception: benchmark the real longitudinal application rather than a synthetic graph.
  const exampleModule = await import(['..', 'examples', 'tenant-platform.js'].join('/'));
  const builds = quick ? 5 : 25;
  const started = performance.now();
  let nodes = 0;
  for (let index = 0; index < builds; index += 1) {
    const example = exampleModule.createTenantPlatformV05Example();
    nodes = applicationGraphFor(example.composition)?.nodes.length ?? 0;
  }
  const durationMs = performance.now() - started;
  return { builds, nodes, durationMs: round(durationMs), buildsPerSecond: round(builds / (durationMs / 1_000)) };
}

async function buildBenchmark() {
  const directory = await mkdtemp(join(tmpdir(), 'applik8s-v05-benchmark-'));
  try {
    const started = performance.now();
    await execFileAsync('bun', ['run', 'applik8s', 'build', join(root, 'examples/tenant-platform.ts'), '--typekro', '--composition-name', 'tenantPlatformV05', '--out-dir', directory], { cwd: root, timeout: 240_000, maxBuffer: 20 * 1024 * 1024 });
    const durationMs = performance.now() - started;
    const files = await artifactFiles(directory);
    // typecast: generated workflow manifests are repository-owned and only the defensive optional size field is consumed.
    const manifests = await Promise.all(files.filter((file) => file.path.endsWith('workflow-worker.manifest.json')).map(async (file) => JSON.parse(await readFile(join(directory, file.path), 'utf8')) as { readonly spec?: { readonly runtime?: { readonly compressedSizeBytes?: number } } }));
    return {
      durationMs: round(durationMs),
      fileCount: files.length,
      totalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
      maximumWorkflowJavaScriptBytes: Math.max(0, ...files.filter((file) => file.path.endsWith('workflow-worker.mjs')).map((file) => file.sizeBytes)),
      maximumWorkflowGzipBytes: Math.max(0, ...manifests.map((manifest) => manifest.spec?.runtime?.compressedSizeBytes ?? 0)),
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function artifactFiles(directory: string): Promise<{ readonly path: string; readonly extension: string; readonly sizeBytes: number }[]> {
  const result: { path: string; extension: string; sizeBytes: number }[] = [];
  async function visit(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) result.push({ path: relative(directory, path), extension: extname(path), sizeBytes: (await stat(path)).size });
    }
  }
  await visit(directory);
  return result;
}

type BenchmarkReport = {
  readonly observation: Awaited<ReturnType<typeof observationBenchmark>>;
  readonly graph: Awaited<ReturnType<typeof graphBenchmark>>;
  readonly build?: Awaited<ReturnType<typeof buildBenchmark>>;
};

function budgetViolations(report: BenchmarkReport): string[] {
  const violations: string[] = [];
  if (report.observation.throughputPerSecond < budgets.observation.minimumThroughputPerSecond) violations.push(`result observation throughput ${report.observation.throughputPerSecond}/s is below ${budgets.observation.minimumThroughputPerSecond}/s`);
  if (report.observation.latencyMs.p95 > budgets.observation.maximumP95Ms) violations.push(`result observation p95 ${report.observation.latencyMs.p95}ms exceeds ${budgets.observation.maximumP95Ms}ms`);
  if (report.observation.rssGrowthBytes > budgets.observation.maximumRssGrowthBytes) violations.push(`result observation RSS growth ${report.observation.rssGrowthBytes} exceeds ${budgets.observation.maximumRssGrowthBytes}`);
  if (report.graph.buildsPerSecond < budgets.graph.minimumBuildsPerSecond) violations.push(`workflow graph builds ${report.graph.buildsPerSecond}/s is below ${budgets.graph.minimumBuildsPerSecond}/s`);
  if (report.build && report.build.durationMs > budgets.build.maximumDurationMs) violations.push(`workflow build ${report.build.durationMs}ms exceeds ${budgets.build.maximumDurationMs}ms`);
  if (report.build && report.build.maximumWorkflowJavaScriptBytes > budgets.build.maximumWorkflowJavaScriptBytes) violations.push(`workflow bundle ${report.build.maximumWorkflowJavaScriptBytes} bytes exceeds ${budgets.build.maximumWorkflowJavaScriptBytes}`);
  if (report.build && report.build.maximumWorkflowGzipBytes > budgets.build.maximumWorkflowGzipBytes) violations.push(`compressed workflow bundle ${report.build.maximumWorkflowGzipBytes} bytes exceeds ${budgets.build.maximumWorkflowGzipBytes}`);
  return violations;
}

function quantiles(values: readonly number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const at = (fraction: number) => round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0);
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99), maximum: round(sorted.at(-1) ?? 0) };
}

function round(value: number): number { return Math.round(value * 100) / 100; }

async function gitRevision(): Promise<{ readonly commit: string; readonly dirty: boolean; readonly workingTreeDigest?: string }> {
  const [{ stdout: commit }, { stdout: status }, { stdout: diff }] = await Promise.all([
    execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root }),
    execFileAsync('git', ['status', '--porcelain'], { cwd: root }),
    execFileAsync('git', ['diff', '--binary', 'HEAD'], { cwd: root, maxBuffer: 20 * 1024 * 1024 }),
  ]);
  const dirty = status.trim().length > 0;
  return { commit: commit.trim(), dirty, ...(dirty ? { workingTreeDigest: createHash('sha256').update(diff).digest('hex') } : {}) };
}
