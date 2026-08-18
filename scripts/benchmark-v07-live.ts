// typecast-file-boundary: Kubernetes and benchmark payloads are validated at
// each narrow read boundary before they enter the recorded evidence contract.
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { cpus, platform } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { consumeWithBoundedConcurrency } from '../packages/applik8s/src/bounded-concurrency.js';
import { startJetStreamCommandProcessor } from '@applik8s/runtime-nats';
import {
  AckPolicy,
  connect,
  JSONCodec,
  RetentionPolicy,
  StorageType,
} from 'nats';
import postgres from 'postgres';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const context = process.env.APPLIK8S_E2E_CONTEXT ?? 'orbstack';
const namespace = process.env.APPLIK8S_AGENTIC_NAMESPACE
  ?? 'agentic-product-evidence-system';
const application = process.env.APPLIK8S_AGENTIC_APPLICATION
  ?? 'agentic-product-evidence';
const quick = process.argv.includes('--quick');
const record = process.argv.includes('--record');
const budgets = JSON.parse(
  await readFile(join(root, 'benchmarks/v0.7/live-budgets.json'), 'utf8'),
) as LiveBudgets;
const forwards: PortForward[] = [];

try {
  const [databaseForward, natsForward, applicationForward] = await Promise.all([
    portForward(`${application}-db-rw`, 5432),
    portForward(`${application}-events`, 4222),
    portForward(`${application}-app`, 3000),
  ]);
  forwards.push(databaseForward, natsForward, applicationForward);
  const databaseCredentials = await applicationDatabaseCredentials();
  const databaseUrl = `postgres://${encodeURIComponent(databaseCredentials.username)}:${encodeURIComponent(databaseCredentials.password)}@127.0.0.1:${databaseForward.port}/${encodeURIComponent(databaseCredentials.database)}`;
  const database = await benchmarkDatabase(databaseUrl);
  const jetStream = await benchmarkJetStream(`nats://127.0.0.1:${natsForward.port}`);
  const http = await benchmarkHttp(`http://127.0.0.1:${applicationForward.port}/app`);
  const kubernetes = await benchmarkKubernetes();
  const report = {
    schemaVersion: 1,
    release: 'v0.7',
    evidenceClass: 'live-orbstack',
    limitations: [
      'This is a bounded single-node OrbStack observation, not a public-cloud capacity guarantee.',
      'Database contention measures a temporary table through the application PostgreSQL provider, not every authored transaction shape.',
      'JetStream scaling uses the production runtime consumer with one shared durable consumer, but does not claim sustained soak capacity.',
      'HTTP latency includes the generated application SSR path over kubectl port-forward and is not internet-edge latency.',
      'Resource requests and limits are portable capacity and cost proxies; they are not dollar estimates.',
    ],
    generatedAt: new Date().toISOString(),
    git: await gitRevision(),
    environment: {
      context,
      namespace,
      platform: platform(),
      architecture: process.arch,
      cpuModel: cpus()[0]?.model ?? 'unknown',
      cpuCount: cpus().length,
      runtime: `bun-${Bun.version}`,
    },
    database,
    jetStream,
    http,
    kubernetes,
  };
  const violations = liveViolations(report, budgets);
  console.log(JSON.stringify({ ...report, violations }, null, 2));
  if (violations.length > 0) {
    throw new Error(`v0.7 live benchmark budgets exceeded: ${violations.join(', ')}`);
  }
  if (record) {
    const directory = join(root, 'benchmarks/v0.7/live');
    const history = join(directory, 'history');
    await mkdir(history, { recursive: true });
    await writeFile(join(directory, 'baseline.json'), `${JSON.stringify(report, null, 2)}\n`);
    const filename = `${report.generatedAt.replace(/[:.]/gu, '-')}-${report.git.commit.slice(0, 8)}-${report.environment.platform}-${report.environment.architecture}.json`;
    await writeFile(join(history, filename), `${JSON.stringify(report, null, 2)}\n`);
  }
} finally {
  await Promise.all(forwards.map(forward => forward.close()));
}

async function applicationDatabaseCredentials() {
  const secret = await kubectlJson([
    'get',
    'secret',
    `${application}-db-app`,
    '--namespace',
    namespace,
  ]);
  const data = objectValue(secret, 'data');
  return {
    username: decodedSecret(data, 'username'),
    password: decodedSecret(data, 'password'),
    database: decodedSecret(data, 'dbname'),
  };
}

async function benchmarkDatabase(url: string) {
  const sql = postgres(url, { max: 20, idle_timeout: 2 });
  const table = `applik8s_v07_live_${process.pid}`;
  try {
    await sql.unsafe(`CREATE TABLE ${table} (id text PRIMARY KEY, value bigint NOT NULL DEFAULT 0)`);
    for (let index = 0; index < 64; index += 1) {
      await sql.unsafe(`INSERT INTO ${table} (id) VALUES ($1)`, [`key-${index}`]);
    }
    return {
      sameKey: await databaseContention(sql, table, 'same-key', () => 'key-0'),
      distinctKeys: await databaseContention(
        sql,
        table,
        'distinct-keys',
        index => `key-${index % 64}`,
      ),
    };
  } finally {
    await sql.unsafe(`DROP TABLE IF EXISTS ${table}`);
    await sql.end({ timeout: 2 });
  }
}

async function databaseContention(
  sql: postgres.Sql,
  table: string,
  name: string,
  key: (index: number) => string,
) {
  const operations = quick ? 200 : 1_000;
  const concurrency = 16;
  const latencies: number[] = [];
  const started = performance.now();
  async function* indexes() {
    for (let index = 0; index < operations; index += 1) yield index;
  }
  await consumeWithBoundedConcurrency(indexes(), concurrency, async index => {
    const operationStarted = performance.now();
    await sql.begin(async transaction => {
      await transaction.unsafe(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [key(index)],
      );
      await transaction.unsafe(
        `UPDATE ${table} SET value = value + 1 WHERE id = $1`,
        [key(index)],
      );
    });
    latencies.push(performance.now() - operationStarted);
  });
  const durationMs = performance.now() - started;
  return {
    name,
    operations,
    concurrency,
    durationMs: round(durationMs),
    throughputPerSecond: round(operations / (durationMs / 1_000)),
    latencyMs: quantiles(latencies),
  };
}

async function benchmarkJetStream(server: string) {
  const connection = await connect({
    servers: server,
    name: 'applik8s-v07-live-benchmark',
  });
  const manager = await connection.jetstreamManager();
  const codec = JSONCodec<object>();
  const activeStreams = new Set<string>();
  const scenarios = [];
  try {
    for (const replicas of [1, 2, 4]) {
      const suffix = `${process.pid}_${replicas}_${randomUUID().slice(0, 8)}`.toUpperCase();
      const stream = `APPLIK8S_V07_LIVE_${suffix}`.replace(/[^A-Z0-9_]/gu, '_');
      const consumer = `v07-live-${suffix.toLowerCase()}`;
      const subjectPrefix = `applik8s-v07-live-${suffix.toLowerCase()}`;
      await manager.streams.add({
        name: stream,
        subjects: [`${subjectPrefix}.>`],
        retention: RetentionPolicy.Limits,
        storage: StorageType.File,
      });
      activeStreams.add(stream);
      await manager.consumers.add(stream, {
        durable_name: consumer,
        ack_policy: AckPolicy.Explicit,
        filter_subject: `${subjectPrefix}.commands.benchmark.v1.>`,
      });
      let completed = 0;
      const processors = await Promise.all(
        Array.from({ length: replicas }, () => startJetStreamCommandProcessor({
          servers: [server],
          stream,
          consumer,
          subjectPrefix,
          concurrency: 8,
          bindings: [{
            bindingId: 'benchmark',
            contract: { name: 'benchmark', version: 'v1' },
            async execute() {
              completed += 1;
            },
            async recordTerminalFailure() {
              // The benchmark handler cannot fail, but the production runtime
              // requires an explicit durable terminal-failure authority.
            },
          }],
        })),
      );
      const operations = quick ? 250 : 1_000;
      const started = performance.now();
      const jetStream = connection.jetstream();
      await Promise.all(Array.from({ length: operations }, (_, index) =>
        jetStream.publish(
          `${subjectPrefix}.commands.benchmark.v1.key-${index % 64}`,
          codec.encode({
            id: `benchmark-${replicas}-${index}`,
            contract: { name: 'benchmark', version: 'v1' },
            payload: { index },
            recordedAt: new Date().toISOString(),
            routing: { binding: 'benchmark' },
          }),
        )));
      while (completed < operations && performance.now() - started < 30_000) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      const durationMs = performance.now() - started;
      await Promise.all(processors.map(processor => processor.drain()));
      if (completed !== operations) {
        throw new Error(
          `JetStream processed ${completed}/${operations} messages with ${replicas} consumer replicas.`,
        );
      }
      scenarios.push({
        replicas,
        concurrencyPerReplica: 8,
        operations,
        durationMs: round(durationMs),
        throughputPerSecond: round(operations / (durationMs / 1_000)),
      });
      await manager.streams.delete(stream);
      activeStreams.delete(stream);
    }
    return { scenarios };
  } finally {
    await Promise.all([...activeStreams].map(async stream => {
      try {
        await manager.streams.delete(stream);
      } catch {
        // The benchmark reports the primary failure after bounded cleanup.
      }
    }));
    await connection.drain();
  }
}

async function benchmarkHttp(url: string) {
  const operations = quick ? 100 : 500;
  const concurrency = 16;
  const latencies: number[] = [];
  let errors = 0;
  const started = performance.now();
  async function* indexes() {
    for (let index = 0; index < operations; index += 1) yield index;
  }
  await consumeWithBoundedConcurrency(indexes(), concurrency, async () => {
    const requestStarted = performance.now();
    const response = await fetch(url, {
      headers: { accept: 'text/html', connection: 'keep-alive' },
    });
    await response.arrayBuffer();
    if (!response.ok) errors += 1;
    latencies.push(performance.now() - requestStarted);
  });
  const durationMs = performance.now() - started;
  return {
    operations,
    concurrency,
    errors,
    durationMs: round(durationMs),
    throughputPerSecond: round(operations / (durationMs / 1_000)),
    latencyMs: quantiles(latencies),
  };
}

async function benchmarkKubernetes() {
  const pods = await kubectlJson(['get', 'pods', '--namespace', namespace]);
  const items = arrayValue(pods, 'items');
  const readyDurations: number[] = [];
  let restartCount = 0;
  let requestedCpuMillicores = 0;
  let requestedMemoryMiB = 0;
  let limitedCpuMillicores = 0;
  let limitedMemoryMiB = 0;
  for (const item of items) {
    const metadata = objectValue(item, 'metadata');
    const status = objectValue(item, 'status');
    const spec = objectValue(item, 'spec');
    const createdAt = Date.parse(stringValue(metadata, 'creationTimestamp'));
    const conditions = optionalArray(status, 'conditions');
    const ready = conditions.find(condition =>
      optionalString(condition, 'type') === 'Ready'
      && optionalString(condition, 'status') === 'True');
    const readyAt = ready ? Date.parse(optionalString(ready, 'lastTransitionTime') ?? '') : NaN;
    if (Number.isFinite(createdAt) && Number.isFinite(readyAt)) {
      readyDurations.push(Math.max(0, readyAt - createdAt));
    }
    for (const containerStatus of optionalArray(status, 'containerStatuses')) {
      restartCount += optionalNumber(containerStatus, 'restartCount') ?? 0;
    }
    for (const container of optionalArray(spec, 'containers')) {
      const resources = optionalObject(container, 'resources');
      const requests = resources ? optionalObject(resources, 'requests') : undefined;
      const limits = resources ? optionalObject(resources, 'limits') : undefined;
      requestedCpuMillicores += cpuMillicores(requests ? optionalString(requests, 'cpu') : undefined);
      requestedMemoryMiB += memoryMiB(requests ? optionalString(requests, 'memory') : undefined);
      limitedCpuMillicores += cpuMillicores(limits ? optionalString(limits, 'cpu') : undefined);
      limitedMemoryMiB += memoryMiB(limits ? optionalString(limits, 'memory') : undefined);
    }
  }
  const metrics = await optionalPodMetrics();
  return {
    podCount: items.length,
    readyPodSamples: readyDurations.length,
    readyLatencyMs: quantiles(readyDurations),
    restartCount,
    capacity: {
      requestedCpuMillicores: round(requestedCpuMillicores),
      requestedMemoryMiB: round(requestedMemoryMiB),
      limitedCpuMillicores: round(limitedCpuMillicores),
      limitedMemoryMiB: round(limitedMemoryMiB),
    },
    metrics,
  };
}

async function optionalPodMetrics() {
  try {
    const { stdout } = await execFileAsync(
      'kubectl',
      ['--context', context, 'top', 'pods', '--namespace', namespace, '--no-headers'],
      { cwd: root, maxBuffer: 10 * 1024 * 1024 },
    );
    const rows = stdout.trim().split('\n').filter(Boolean);
    return {
      available: true,
      podSamples: rows.length,
      cpuMillicores: rows.reduce((total, row) =>
        total + cpuMillicores(row.trim().split(/\s+/u)[1]), 0),
      memoryMiB: rows.reduce((total, row) =>
        total + memoryMiB(row.trim().split(/\s+/u)[2]), 0),
    };
  } catch {
    return { available: false, reason: 'Kubernetes Metrics API is not installed.' };
  }
}

async function portForward(service: string, remotePort: number): Promise<PortForward> {
  const port = await availablePort();
  const child = spawn(
    'kubectl',
    [
      '--context',
      context,
      '--namespace',
      namespace,
      'port-forward',
      `service/${service}`,
      `${port}:${remotePort}`,
    ],
    { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  await waitForForward(child, port);
  return {
    port,
    async close() {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      await Promise.race([
        new Promise<void>(resolve => child.once('exit', () => resolve())),
        new Promise<void>(resolve => setTimeout(resolve, 2_000)),
      ]);
      if (child.exitCode === null) child.kill('SIGKILL');
    },
  };
}

async function waitForForward(child: ChildProcessWithoutNullStreams, port: number) {
  await new Promise<void>((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Port-forward ${port} did not become ready.`)), 15_000);
    const observe = (chunk: Buffer) => {
      output += chunk.toString();
      if (!output.includes('Forwarding from')) return;
      clearTimeout(timer);
      resolve();
    };
    child.stdout.on('data', observe);
    child.stderr.on('data', observe);
    child.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`Port-forward ${port} exited with code ${code ?? 1}: ${output.trim()}`));
    });
  });
}

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate a local benchmark port.'));
        return;
      }
      const port = address.port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function kubectlJson(args: readonly string[]) {
  const { stdout } = await execFileAsync(
    'kubectl',
    ['--context', context, ...args, '--output=json'],
    { cwd: root, maxBuffer: 20 * 1024 * 1024 },
  );
  return JSON.parse(stdout) as unknown;
}

function liveViolations(report: LiveReport, limits: LiveBudgets) {
  return [
    report.database.sameKey.throughputPerSecond < limits.database.minimumSameKeyThroughputPerSecond
      ? 'database same-key throughput' : '',
    report.database.sameKey.latencyMs.p95 > limits.database.maximumSameKeyP95Ms
      ? 'database same-key p95' : '',
    report.database.distinctKeys.throughputPerSecond < limits.database.minimumDistinctKeyThroughputPerSecond
      ? 'database distinct-key throughput' : '',
    report.database.distinctKeys.latencyMs.p95 > limits.database.maximumDistinctKeyP95Ms
      ? 'database distinct-key p95' : '',
    report.jetStream.scenarios.some(scenario =>
      scenario.throughputPerSecond < limits.jetStream.minimumThroughputPerSecond)
      ? 'JetStream throughput' : '',
    report.jetStream.scenarios.some(scenario =>
      scenario.durationMs > limits.jetStream.maximumConvergenceMs)
      ? 'JetStream convergence' : '',
    report.http.throughputPerSecond < limits.http.minimumThroughputPerSecond
      ? 'HTTP throughput' : '',
    report.http.latencyMs.p95 > limits.http.maximumP95Ms ? 'HTTP p95' : '',
    report.http.errors > limits.http.maximumErrorCount ? 'HTTP errors' : '',
    report.kubernetes.readyLatencyMs.p95 > limits.kubernetes.maximumReadyP95Ms
      ? 'Kubernetes ready p95' : '',
    report.kubernetes.restartCount > limits.kubernetes.maximumRestartCount
      ? 'Kubernetes restarts' : '',
  ].filter(Boolean);
}

async function gitRevision() {
  const [{ stdout: commit }, { stdout: status }, { stdout: diff }, { stdout: untracked }] = await Promise.all([
    execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root }),
    execFileAsync('git', ['status', '--porcelain'], { cwd: root }),
    execFileAsync('git', ['diff', '--binary', 'HEAD'], { cwd: root, maxBuffer: 30 * 1024 * 1024 }),
    execFileAsync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: root }),
  ]);
  const dirty = status.trim().length > 0;
  if (!dirty) return { commit: commit.trim(), dirty };
  const digest = createHash('sha256').update(diff);
  for (const path of untracked.split('\n').filter(Boolean).sort()) {
    if (path.startsWith('benchmarks/v0.7/live/')) continue;
    digest.update(`\0${path}\0`);
    digest.update(await readFile(join(root, path)));
  }
  return {
    commit: commit.trim(),
    dirty,
    workingTreeDigest: `sha256:${digest.digest('hex')}`,
  };
}

function decodedSecret(data: Record<string, unknown>, key: string) {
  const value = data[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Database Secret is missing ${key}.`);
  }
  return Buffer.from(value, 'base64').toString('utf8');
}

function objectValue(value: unknown, key: string): Record<string, unknown> {
  const field = optionalObject(value, key);
  if (!field) throw new Error(`Expected object field ${key}.`);
  return field;
}

function arrayValue(value: unknown, key: string): unknown[] {
  const field = optionalArray(value, key);
  if (!Array.isArray(field)) throw new Error(`Expected array field ${key}.`);
  return field;
}

function stringValue(value: unknown, key: string) {
  const field = optionalString(value, key);
  if (field === undefined) throw new Error(`Expected string field ${key}.`);
  return field;
}

function optionalObject(value: unknown, key: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const field = Reflect.get(value, key) as unknown;
  return field && typeof field === 'object' && !Array.isArray(field)
    ? field as Record<string, unknown>
    : undefined;
}

function optionalArray(value: unknown, key: string): unknown[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const field = Reflect.get(value, key) as unknown;
  return Array.isArray(field) ? field : [];
}

function optionalString(value: unknown, key: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const field = Reflect.get(value, key) as unknown;
  return typeof field === 'string' ? field : undefined;
}

function optionalNumber(value: unknown, key: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const field = Reflect.get(value, key) as unknown;
  return typeof field === 'number' && Number.isFinite(field) ? field : undefined;
}

function cpuMillicores(value: string | undefined) {
  if (!value) return 0;
  if (value.endsWith('m')) return Number.parseFloat(value.slice(0, -1));
  if (value.endsWith('u')) return Number.parseFloat(value.slice(0, -1)) / 1_000;
  if (value.endsWith('n')) return Number.parseFloat(value.slice(0, -1)) / 1_000_000;
  return Number.parseFloat(value) * 1_000;
}

function memoryMiB(value: string | undefined) {
  if (!value) return 0;
  const number = Number.parseFloat(value);
  if (value.endsWith('Ki')) return number / 1_024;
  if (value.endsWith('Mi')) return number;
  if (value.endsWith('Gi')) return number * 1_024;
  if (value.endsWith('K')) return number * 1_000 / 1_048_576;
  if (value.endsWith('M')) return number * 1_000_000 / 1_048_576;
  if (value.endsWith('G')) return number * 1_000_000_000 / 1_048_576;
  return number / 1_048_576;
}

function quantiles(values: readonly number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const at = (fraction: number) => round(
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))] ?? 0,
  );
  return {
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    maximum: round(sorted.at(-1) ?? 0),
  };
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

interface PortForward {
  readonly port: number;
  readonly close: () => Promise<void>;
}

interface LiveBudgets {
  readonly database: {
    readonly minimumSameKeyThroughputPerSecond: number;
    readonly maximumSameKeyP95Ms: number;
    readonly minimumDistinctKeyThroughputPerSecond: number;
    readonly maximumDistinctKeyP95Ms: number;
  };
  readonly jetStream: {
    readonly minimumThroughputPerSecond: number;
    readonly maximumConvergenceMs: number;
  };
  readonly http: {
    readonly minimumThroughputPerSecond: number;
    readonly maximumP95Ms: number;
    readonly maximumErrorCount: number;
  };
  readonly kubernetes: {
    readonly maximumReadyP95Ms: number;
    readonly maximumRestartCount: number;
  };
}

type LiveReport = {
  readonly database: Awaited<ReturnType<typeof benchmarkDatabase>>;
  readonly jetStream: Awaited<ReturnType<typeof benchmarkJetStream>>;
  readonly http: Awaited<ReturnType<typeof benchmarkHttp>>;
  readonly kubernetes: Awaited<ReturnType<typeof benchmarkKubernetes>>;
};
