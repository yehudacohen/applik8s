// typecast-file-boundary: benchmark fixtures are closed repository inputs and
// deliberately erase only the execution context assembled below.
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus, platform } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  QueryConsistency,
  app,
  createApplicationJobBinding,
  createDeterministicApplicationJobRuntime,
  createDeterministicApplicationManagedModelStore,
  createDeterministicApplicationQueryBatchRuntime,
  executeApplicationQueryBatch,
  installApplicationQueryBatchRuntimeResolver,
  runApplicationManagedModelOnce,
  type ApplicationJobExecution,
  type ApplicationManagedModelRuntimeBinding,
  type ApplicationQueryBatchProgress,
  type ApplicationQuerySelectableModel,
} from '@applik8s/applik8s';
import { event, type } from '@applik8s/applik8s/dsl';
import {
  captureApplicationQuerySelection,
} from '../packages/applik8s/src/application-query-selection.js';

const execFileAsync = promisify(execFile);
const root = resolve(new URL('..', import.meta.url).pathname);
const budgets = JSON.parse(
  await readFile(join(root, 'benchmarks/v0.9/budgets.json'), 'utf8'),
) as BenchmarkBudgets;
const quick = process.argv.includes('--quick');
const record = process.argv.includes('--record');

async function benchmarkJobs(count: number): Promise<ThroughputMetric<'runsPerSecond'>> {
  const runtime = createDeterministicApplicationJobRuntime({ maximumConcurrency: 8 });
  const job = createApplicationJobBinding({
    id: 'benchmark.double.v1',
    contract: {
      input: type({ value: 'number.integer' }),
      output: type({ doubled: 'number.integer' }),
      progress: type({ completed: 'number.integer' }),
    },
    options: {},
    async handler(input, execution) {
      await execution.progress({ completed: 1 });
      return { doubled: input.value * 2 };
    },
  }, runtime);
  const memory = process.memoryUsage().rss;
  const latencies: number[] = [];
  const started = performance.now();
  for (let index = 0; index < count; index += 1) {
    const operation = performance.now();
    await job({ value: index }, { idempotencyKey: `job-${index}` });
    latencies.push(performance.now() - operation);
  }
  return metric(count, performance.now() - started, latencies, process.memoryUsage().rss - memory, 'runsPerSecond');
}

function benchmarkEvents(count: number): ThroughputMetric<'catalogsPerSecond'> {
  const Published = event('benchmark.published.v1', {
    payload: type({ id: 'string' }),
  });
  const memory = process.memoryUsage().rss;
  const latencies: number[] = [];
  const started = performance.now();
  for (let index = 0; index < count; index += 1) {
    const operation = performance.now();
    const application = app(`v09-event-benchmark-${index}`);
    application.database.postgres('catalog', { schema: {} });
    application.events.of(Published);
    latencies.push(performance.now() - operation);
  }
  return metric(count, performance.now() - started, latencies, process.memoryUsage().rss - memory, 'catalogsPerSecond');
}

async function benchmarkManagedModels(count: number): Promise<ThroughputMetric<'reconcilesPerSecond'>> {
  interface Value { readonly version: number }
  interface Status { readonly observedGeneration: number }
  const store = createDeterministicApplicationManagedModelStore<string, Value, Status>();
  for (let index = 0; index < count; index += 1) {
    store.putDesired('Benchmark', `model-${index}`, { version: index }, { observedGeneration: 0 });
  }
  const binding: ApplicationManagedModelRuntimeBinding<string, Value, Status> = {
    model: 'Benchmark',
    status: type({ observedGeneration: 'number.integer >= 0' }),
    leaseDurationSeconds: 30,
    conditionTypes: [],
    finalizers: [],
    async reconcile(model) {
      await model.status.update({ observedGeneration: model.metadata.generation });
    },
  };
  const memory = process.memoryUsage().rss;
  const latencies: number[] = [];
  const started = performance.now();
  for (let index = 0; index < count; index += 1) {
    const operation = performance.now();
    await runApplicationManagedModelOnce({ store, binding });
    latencies.push(performance.now() - operation);
  }
  return metric(
    count,
    performance.now() - started,
    latencies,
    process.memoryUsage().rss - memory,
    'reconcilesPerSecond',
  );
}

interface BatchRow {
  readonly id: string;
  readonly partition: string;
}

const BatchModel = {
  $inferSelect: undefined as unknown as BatchRow,
  $model: {
    kind: 'applicationModelFacet' as const,
    name: 'BatchRow',
    provider: 'postgres',
    database: 'catalog',
    table: {
      name: 'batch_rows',
      columns: [
        { property: 'id', column: 'id', logicalType: 'string', nullable: false },
        { property: 'partition', column: 'partition', logicalType: 'string', nullable: false },
      ],
    },
    identity: { fields: ['id'] },
  },
} satisfies ApplicationQuerySelectableModel<BatchRow>;

function batchSelection(input: { readonly partition: string }, context: {
  readonly select: typeof import('../packages/applik8s/src/application-query-selection.js').createApplicationQuerySelection;
}) {
  return context.select(BatchModel)
    .where(row => row.partition.eq(input.partition))
    .orderBy(row => row.id.asc());
}

async function benchmarkQueryBatches(count: number): Promise<ThroughputMetric<'batchesPerSecond'>> {
  const selection = captureApplicationQuerySelection(
    batchSelection as (input: unknown, context: unknown) => unknown,
    batchSelection.toString(),
  );
  if (!selection) throw new Error('Could not capture the v0.9 query-batch benchmark selection.');
  const rows = Array.from({ length: 100 }, (_, index) => ({
    id: `row-${String(index).padStart(3, '0')}`,
    partition: 'one',
  }));
  const runtime = createDeterministicApplicationQueryBatchRuntime({ rows: () => rows });
  const remove = installApplicationQueryBatchRuntimeResolver(() => runtime);
  const memory = process.memoryUsage().rss;
  const latencies: number[] = [];
  const started = performance.now();
  try {
    for (let index = 0; index < count; index += 1) {
      const operation = performance.now();
      await executeApplicationQueryBatch({
        selection,
        input: { partition: 'one' },
        policy: {
          batch: { maxItems: 25 },
          concurrency: 4,
          consistency: QueryConsistency.repeatableSnapshot,
        },
        execution: batchExecution(`batch-${index}`),
        async handler() {},
      });
      latencies.push(performance.now() - operation);
    }
  } finally {
    remove();
  }
  return metric(
    count,
    performance.now() - started,
    latencies,
    process.memoryUsage().rss - memory,
    'batchesPerSecond',
  );
}

function batchExecution(runId: string): ApplicationJobExecution<ApplicationQueryBatchProgress, never> {
  const controller = new AbortController();
  return {
    // typecast: the benchmark isolates batching overhead; admission correctness has separate conformance evidence.
    admission: {
      authorityRevision: 'benchmark',
      trustedContext: { values: {}, digest: 'benchmark' },
    } as never,
    run: {
      protocol: 'applik8s.jobRuntime/v1alpha1',
      job: 'benchmark.batch.v1',
      runId,
      admittedAt: '2026-01-01T00:00:00.000Z',
    },
    invocationId: runId,
    attempt: 1,
    signal: controller.signal,
    async progress(value) {
      return {
        run: this.run,
        sequence: 1,
        recordedAt: '2026-01-01T00:00:00.000Z',
        value,
      };
    },
    throwIfCancelled() { controller.signal.throwIfAborted(); },
    fail(error) { throw error; },
  };
}

function metric<TName extends string>(
  count: number,
  durationMs: number,
  latencies: readonly number[],
  rssGrowthBytes: number,
  throughputName: TName,
): ThroughputMetric<TName> {
  return {
    operations: count,
    durationMs: round(durationMs),
    [throughputName]: round(count / (durationMs / 1_000)),
    latencyMs: quantiles(latencies),
    rssGrowthBytes: Math.max(0, rssGrowthBytes),
  } as ThroughputMetric<TName>;
}

function quantiles(values: readonly number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const at = (fraction: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
  return {
    p50: round(at(0.5)),
    p95: round(at(0.95)),
    p99: round(at(0.99)),
    maximum: round(sorted.at(-1) ?? 0),
  };
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

function performanceViolations(report: BenchmarkReport, tracked: BenchmarkBudgets): string[] {
  const findings: string[] = [];
  for (const { key, measured, throughput, budget } of [
    { key: 'jobs', measured: report.jobs, throughput: report.jobs.runsPerSecond, budget: tracked.jobs },
    { key: 'events', measured: report.events, throughput: report.events.catalogsPerSecond, budget: tracked.events },
    { key: 'managedModels', measured: report.managedModels, throughput: report.managedModels.reconcilesPerSecond, budget: tracked.managedModels },
    { key: 'queryBatches', measured: report.queryBatches, throughput: report.queryBatches.batchesPerSecond, budget: tracked.queryBatches },
  ] as const) {
    if (throughput < budget.minimumThroughput) findings.push(`${key} throughput`);
    if (measured.latencyMs.p95 > budget.maximumP95Ms) findings.push(`${key} p95`);
    if (measured.rssGrowthBytes > budget.maximumRssGrowthBytes) findings.push(`${key} RSS`);
  }
  return findings;
}

async function gitRevision() {
  const commit = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
  const dirty = (await execFileAsync('git', ['status', '--porcelain'], { cwd: root })).stdout.trim();
  return { commit, dirty: Boolean(dirty) };
}

interface Latency {
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly maximum: number;
}
interface BaseMetric {
  readonly operations: number;
  readonly durationMs: number;
  readonly latencyMs: Latency;
  readonly rssGrowthBytes: number;
}
type ThroughputMetric<TName extends string> = BaseMetric & Readonly<Record<TName, number>>;
interface BenchmarkReport {
  readonly jobs: ThroughputMetric<'runsPerSecond'>;
  readonly events: ThroughputMetric<'catalogsPerSecond'>;
  readonly managedModels: ThroughputMetric<'reconcilesPerSecond'>;
  readonly queryBatches: ThroughputMetric<'batchesPerSecond'>;
}
type MetricBudget = {
  readonly minimumThroughput: number;
  readonly maximumP95Ms: number;
  readonly maximumRssGrowthBytes: number;
};
interface BenchmarkBudgets {
  readonly jobs: MetricBudget;
  readonly events: MetricBudget;
  readonly managedModels: MetricBudget;
  readonly queryBatches: MetricBudget;
}

async function main(): Promise<void> {
  const report = {
    schemaVersion: 1 as const,
    release: 'v0.9' as const,
    evidenceClass: 'synthetic-local' as const,
    limitations: [
      'This lane measures framework overhead and does not claim network, Kubernetes, or AWS latency.',
      'Finite Jobs use the deterministic semantic runtime; deployed recovery is qualified separately.',
      'Managed models and query batches use deterministic stores; PostgreSQL contention is qualified separately.',
      'Event measurements cover catalog construction for one authority and do not claim multi-authority federation.',
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
    jobs: await benchmarkJobs(quick ? 100 : 1_000),
    events: benchmarkEvents(quick ? 25 : 100),
    managedModels: await benchmarkManagedModels(quick ? 100 : 1_000),
    queryBatches: await benchmarkQueryBatches(quick ? 20 : 200),
  };
  const violations = performanceViolations(report, budgets);
  console.log(JSON.stringify({ ...report, violations }, null, 2));
  if (violations.length > 0) {
    throw new Error(`v0.9 benchmark budgets exceeded: ${violations.join(', ')}`);
  }
  if (record) {
    const directory = join(root, 'benchmarks/v0.9');
    const history = join(directory, 'history');
    await mkdir(history, { recursive: true });
    await writeFile(join(directory, 'baseline.json'), `${JSON.stringify(report, null, 2)}\n`);
    const name = [
      report.generatedAt.replace(/[:.]/gu, '-'),
      report.git.commit.slice(0, 8),
      report.environment.platform,
      report.environment.architecture,
    ].join('-');
    await writeFile(join(history, `${name}.json`), `${JSON.stringify(report, null, 2)}\n`);
  }
}

await main();
