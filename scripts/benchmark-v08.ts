// typecast-file-boundary: benchmark fixtures are closed repository inputs and
// reports are checked against the tracked v0.8 budget contract.
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus, platform } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  LakehouseDataset,
  actor,
  app,
  applicationScheduleOccurrenceId,
  createDeterministicApplicationActorRuntime,
  createDeterministicApplicationLakehouseRuntime,
  installApplicationActorRuntimeResolver,
  type,
} from '@applik8s/applik8s';
import {
  serializeApplicationPlanContent,
  type ApplicationGraph,
} from '@applik8s/core';
import {
  compileApplicationAwsDeploymentPlan,
  compileApplicationPlan,
} from '@applik8s/deployment-compiler';
import {
  type ApplicationDeploymentGraph,
  applicationRuntimeAccessPlanDigest,
} from '@applik8s/deployment-contract';
import { createApplicationOpenTelemetryRuntime } from '@applik8s/runtime-otel';

const execFileAsync = promisify(execFile);
const root = resolve(new URL('..', import.meta.url).pathname);
const budgets = JSON.parse(await readFile(join(root, 'benchmarks/v0.8/budgets.json'), 'utf8')) as BenchmarkBudgets;
const quick = process.argv.includes('--quick');
const record = process.argv.includes('--record');
const semanticGraph = {
  apiVersion: 'applik8s.appGraph/v1alpha1', kind: 'ApplicationGraph', metadata: { name: 'v08-benchmark' }, nodes: [], edges: [], providerRequirements: [], providerBindings: [],
  compatibility: { stablePublicApis: [], documentedInternalContracts: [], experimentalSurfaces: [], postV3Surfaces: [], labels: [] },
} satisfies ApplicationGraph;
const benchmarkSourceGraphDigest = `sha256:${'b'.repeat(64)}` as const;
const benchmarkRuntimeAccessContent = {
  apiVersion: 'applik8s.runtimeAccessPlan/v1alpha1' as const,
  application: 'v08-benchmark',
  target: 'local' as const,
  sourceGraphDigest: benchmarkSourceGraphDigest,
  executions: [],
  diagnostics: [],
};
const deploymentGraph = {
  apiVersion: 'applik8s.deploymentGraph/v1alpha1', kind: 'ApplicationDeploymentGraph',
  metadata: { identity: { connection: { provider: 'local', cluster: 'local', digest: `sha256:${'a'.repeat(64)}` }, application: 'v08-benchmark', controlPlaneNamespace: 'local', instance: 'benchmark', profile: 'starter' }, mode: 'fresh', strategy: 'direct', sourceGraphDigest: benchmarkSourceGraphDigest, compilerVersion: '0.8.0' },
  runtimeAccess: {
    ...benchmarkRuntimeAccessContent,
    digest: applicationRuntimeAccessPlanDigest(benchmarkRuntimeAccessContent),
  },
  nodes: [], edges: [],
} satisfies ApplicationDeploymentGraph;

const plan = benchmarkPlan(quick ? 500 : 3_000);
const actors = await benchmarkActors(quick ? 250 : 2_000);
const schedules = benchmarkSchedules(quick ? 2_000 : 20_000);
const lakehouse = await benchmarkLakehouse(quick ? 100 : 1_000);
const telemetry = await benchmarkTelemetry(quick ? 1_000 : 10_000);
const aws = compileApplicationAwsDeploymentPlan({ graph: semanticGraph, environment: 'benchmark', region: 'us-east-1', accountId: '123456789012' });
const report = {
  schemaVersion: 1,
  release: 'v0.8',
  evidenceClass: 'synthetic-local',
  limitations: [
    'This history isolates framework overhead and does not claim network, Kubernetes, MiniStack, or real-AWS latency.',
    'Actor measurements use the deterministic local semantic reference, not celld fleet capacity.',
    'Lakehouse measurements use the deterministic manifest/query authority, while DuckDB and Athena remain separate provider lanes.',
    'AWS cost evidence is a static resource/cost-class inventory and is not a cloud bill or price prediction.',
  ],
  generatedAt: new Date().toISOString(),
  git: await gitRevision(),
  environment: {
    platform: platform(), architecture: process.arch, cpuModel: cpus()[0]?.model ?? 'unknown', cpuCount: cpus().length, runtime: `bun-${Bun.version}`,
  },
  plan,
  actors,
  schedules,
  lakehouse,
  telemetry,
  cost: {
    evidenceClass: 'static-plan-inventory',
    awsResources: aws.resources.length,
    services: [...new Set(aws.resources.map(({ service }) => service))].sort(),
    estimates: aws.resources.map(({ id, service, resourceType }) => ({ id, service, resourceType })),
  },
} satisfies BenchmarkReport;
const violations = performanceViolations(report, budgets);
console.log(JSON.stringify({ ...report, violations }, null, 2));
if (violations.length > 0) throw new Error(`v0.8 benchmark budgets exceeded: ${violations.join(', ')}`);
if (record) {
  const directory = join(root, 'benchmarks/v0.8');
  const history = join(directory, 'history');
  await mkdir(history, { recursive: true });
  await writeFile(join(directory, 'baseline.json'), `${JSON.stringify(report, null, 2)}\n`);
  const name = `${report.generatedAt.replace(/[:.]/gu, '-')}-${report.git.commit.slice(0, 8)}-${report.environment.platform}-${report.environment.architecture}.json`;
  await writeFile(join(history, name), `${JSON.stringify(report, null, 2)}\n`);
}

function benchmarkPlan(count: number) {
  const latencies: number[] = [];
  const memory = process.memoryUsage().rss;
  const started = performance.now();
  for (let index = 0; index < count; index += 1) {
    const operation = performance.now();
    const value = compileApplicationPlan({
      graph: semanticGraph,
      deployment: deploymentGraph,
      target: 'local',
      lifecycleAuthority: 'local-supervisor',
      generatedAt: new Date(index).toISOString(),
    });
    serializeApplicationPlanContent(value);
    latencies.push(performance.now() - operation);
  }
  const durationMs = performance.now() - started;
  return metric(count, durationMs, latencies, process.memoryUsage().rss - memory, 'compilationsPerSecond');
}

async function benchmarkActors(count: number) {
  const application = app('v08-benchmark-actors');
  const Counter = application.actor('benchmark-counter.v1', {
    key: type('string'),
    state: type({ count: 'number.integer >= 0' }),
    protocol: { increment: actor.command({ input: type({ by: 'number.integer > 0' }), output: type({ count: 'number.integer >= 0' }) }) },
  });
  Counter.on.initialize(() => ({ count: 0 }));
  Counter.on.increment(async (turn, input) => {
    const current = await turn.state();
    const next = { count: current.count + input.by };
    await turn.setState(next);
    return next;
  });
  const runtime = createDeterministicApplicationActorRuntime();
  const dispose = installApplicationActorRuntimeResolver(() => runtime);
  const latencies: number[] = [];
  const memory = process.memoryUsage().rss;
  const started = performance.now();
  try {
    for (let index = 0; index < count; index += 1) {
      const operation = performance.now();
      await Counter.increment('one', { by: 1 }, { idempotencyKey: `turn-${index}` });
      latencies.push(performance.now() - operation);
    }
  } finally { dispose(); }
  const durationMs = performance.now() - started;
  return metric(count, durationMs, latencies, process.memoryUsage().rss - memory, 'turnsPerSecond');
}

function benchmarkSchedules(count: number) {
  const latencies: number[] = [];
  const started = performance.now();
  for (let index = 0; index < count; index += 1) {
    const operation = performance.now();
    applicationScheduleOccurrenceId({ applicationId: 'benchmark', environmentId: 'local', definitionId: 'cleanup.v1', instanceId: `instance-${index % 100}`, scheduledAt: new Date(index * 60_000).toISOString() });
    latencies.push(performance.now() - operation);
  }
  return metric(count, performance.now() - started, latencies, 0, 'identitiesPerSecond');
}

async function benchmarkLakehouse(count: number) {
  const Dataset = LakehouseDataset.named('benchmark-history');
  const runtime = createDeterministicApplicationLakehouseRuntime({
    datasetId: 'benchmark-history', schemaRevision: 'v1', schema: type({ id: 'string', score: 'number' }), cursorKey: 'b'.repeat(32),
  });
  await runtime.append({ frontier: 'seed', rows: Array.from({ length: 1_000 }, (_, index) => ({ id: `row-${index}`, score: index })) });
  const latencies: number[] = [];
  let scannedBytes = 0;
  const started = performance.now();
  for (let index = 0; index < count; index += 1) {
    const operation = performance.now();
    const result = await runtime.query({ dataset: Dataset, page: { size: 20 }, principalScope: `scope-${index % 4}` });
    scannedBytes = Math.max(scannedBytes, result.scannedBytes);
    latencies.push(performance.now() - operation);
  }
  const durationMs = performance.now() - started;
  return { ...metric(count, durationMs, latencies, 0, 'queriesPerSecond'), maximumScannedBytesPerQuery: scannedBytes };
}

async function benchmarkTelemetry(count: number) {
  const runtime = createApplicationOpenTelemetryRuntime({ application: 'benchmark', environment: 'local', target: 'local', log: () => undefined });
  const latencies: number[] = [];
  const memory = process.memoryUsage().rss;
  const started = performance.now();
  for (let index = 0; index < count; index += 1) {
    const operation = performance.now();
    await runtime.run({ kind: 'operation', identity: 'benchmark.read', attempt: index % 3 }, async () => index);
    latencies.push(performance.now() - operation);
  }
  const durationMs = performance.now() - started;
  return metric(count, durationMs, latencies, process.memoryUsage().rss - memory, 'boundariesPerSecond');
}

function metric<TName extends string>(count: number, durationMs: number, latencies: readonly number[], rssGrowthBytes: number, throughputName: TName): BaseMetric & Record<TName, number> {
  return { operations: count, durationMs: round(durationMs), [throughputName]: round(count / (durationMs / 1_000)), latencyMs: quantiles(latencies), rssGrowthBytes: Math.max(0, rssGrowthBytes) } as BaseMetric & Record<TName, number>;
}

function quantiles(values: readonly number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const at = (fraction: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
  return { p50: round(at(0.5)), p95: round(at(0.95)), p99: round(at(0.99)), maximum: round(sorted.at(-1) ?? 0) };
}
function round(value: number): number { return Number(value.toFixed(2)); }

function performanceViolations(report: BenchmarkReport, tracked: BenchmarkBudgets): string[] {
  return [
    report.plan.compilationsPerSecond < tracked.plan.minimumCompilationsPerSecond ? 'plan throughput' : '',
    report.plan.latencyMs.p95 > tracked.plan.maximumP95Ms ? 'plan p95' : '',
    report.plan.rssGrowthBytes > tracked.plan.maximumRssGrowthBytes ? 'plan RSS' : '',
    report.actors.turnsPerSecond < tracked.actors.minimumTurnsPerSecond ? 'actor throughput' : '',
    report.actors.latencyMs.p95 > tracked.actors.maximumP95Ms ? 'actor p95' : '',
    report.actors.rssGrowthBytes > tracked.actors.maximumRssGrowthBytes ? 'actor RSS' : '',
    report.schedules.identitiesPerSecond < tracked.schedules.minimumIdentitiesPerSecond ? 'schedule identity throughput' : '',
    report.schedules.latencyMs.p95 > tracked.schedules.maximumP95Ms ? 'schedule p95' : '',
    report.lakehouse.queriesPerSecond < tracked.lakehouse.minimumQueriesPerSecond ? 'lakehouse throughput' : '',
    report.lakehouse.latencyMs.p95 > tracked.lakehouse.maximumP95Ms ? 'lakehouse p95' : '',
    report.lakehouse.maximumScannedBytesPerQuery > tracked.lakehouse.maximumScannedBytesPerQuery ? 'lakehouse scanned bytes' : '',
    report.telemetry.boundariesPerSecond < tracked.telemetry.minimumBoundariesPerSecond ? 'telemetry throughput' : '',
    report.telemetry.latencyMs.p95 > tracked.telemetry.maximumP95Ms ? 'telemetry p95' : '',
    report.telemetry.rssGrowthBytes > tracked.telemetry.maximumRssGrowthBytes ? 'telemetry RSS' : '',
  ].filter(Boolean);
}

async function gitRevision() {
  const commit = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
  const dirty = (await execFileAsync('git', ['status', '--porcelain'], { cwd: root })).stdout.trim();
  return { commit, dirty: Boolean(dirty) };
}

interface Latency { readonly p50: number; readonly p95: number; readonly p99: number; readonly maximum: number }
interface BaseMetric { readonly operations: number; readonly durationMs: number; readonly latencyMs: Latency; readonly rssGrowthBytes: number }
interface BenchmarkReport {
  readonly schemaVersion: 1;
  readonly release: 'v0.8';
  readonly evidenceClass: 'synthetic-local';
  readonly limitations: readonly string[];
  readonly plan: BaseMetric & { readonly compilationsPerSecond: number };
  readonly actors: BaseMetric & { readonly turnsPerSecond: number };
  readonly schedules: BaseMetric & { readonly identitiesPerSecond: number };
  readonly lakehouse: BaseMetric & { readonly queriesPerSecond: number; readonly maximumScannedBytesPerQuery: number };
  readonly telemetry: BaseMetric & { readonly boundariesPerSecond: number };
  readonly generatedAt: string;
  readonly git: { readonly commit: string; readonly dirty: boolean };
  readonly environment: Readonly<Record<string, string | number>>;
  readonly cost: Readonly<Record<string, unknown>>;
}
interface BenchmarkBudgets {
  readonly plan: { readonly minimumCompilationsPerSecond: number; readonly maximumP95Ms: number; readonly maximumRssGrowthBytes: number };
  readonly actors: { readonly minimumTurnsPerSecond: number; readonly maximumP95Ms: number; readonly maximumRssGrowthBytes: number };
  readonly schedules: { readonly minimumIdentitiesPerSecond: number; readonly maximumP95Ms: number };
  readonly lakehouse: { readonly minimumQueriesPerSecond: number; readonly maximumP95Ms: number; readonly maximumScannedBytesPerQuery: number };
  readonly telemetry: { readonly minimumBoundariesPerSecond: number; readonly maximumP95Ms: number; readonly maximumRssGrowthBytes: number };
}
