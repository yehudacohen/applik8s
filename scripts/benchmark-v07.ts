// typecast-file-boundary: benchmark fixtures are closed repository inputs and
// the report is validated against the tracked v0.7 budget contract.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus, platform } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  type ApplicationFrozenStreamBatchGroup,
  type ApplicationSignalDefinition,
  type ApplicationStreamDeliveryAdmitter,
  type ApplicationStreamEnvelope,
  type ApplicationStreamProcessorStore,
  createMemoryApplicationSignalStore,
  runApplicationStreamBatchProcessor,
} from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import type {
  ApplicationIdentityReference,
  ApplicationOperationCatalog,
  ApplicationOperationDescriptor,
  ApplicationPrincipal,
} from '@applik8s/core';
import {
  applicationAdmissionInvocationView,
  applicationCausalPrincipalContext,
  createApplicationAdmissionContextV1,
  createApplicationExecutionPrincipalV1,
  validateApplicationAdmissionContextV1WithoutReceipt,
  withApplicationAdmissionExecutionV1,
} from '@applik8s/core';
import {
  ApplicationAuthorityService,
  InMemoryApplicationAuthorityRepository,
} from '@applik8s/operations';

const execFileAsync = promisify(execFile);
const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const budgets = JSON.parse(
  await readFile(join(root, 'benchmarks/v0.7/budgets.json'), 'utf8'),
) as {
  readonly authority: {
    readonly minimumDecisionsPerSecond: number;
    readonly maximumP95Ms: number;
    readonly maximumRssGrowthBytes: number;
  };
  readonly signals: {
    readonly minimumIssuesPerSecond: number;
    readonly minimumResolutionsPerSecond: number;
    readonly maximumIssueP95Ms: number;
    readonly maximumResolutionP95Ms: number;
    readonly maximumRssGrowthBytes: number;
  };
  readonly frozenBatches: {
    readonly minimumEventsPerSecond: number;
    readonly maximumConvergenceMs: number;
    readonly maximumRssGrowthBytes: number;
  };
};
const quick = process.argv.includes('--quick');
const record = process.argv.includes('--record');
const operations = quick ? 2_000 : 10_000;

const authority = await benchmarkAuthority(operations);
const signals = await benchmarkSignals(operations);
const frozenBatches = await benchmarkFrozenBatches(operations);
const report = {
  schemaVersion: 1,
  release: 'v0.7',
  evidenceClass: 'synthetic-local',
  limitations: [
    'These measurements use in-memory canonical stores and isolate framework overhead; they do not claim PostgreSQL, JetStream, Hatchet, network, or Kubernetes latency.',
    'Signal issuance and resolution exercise immutable canonical state, authorization receipts, and outbox creation but not broker publication or workflow wakeup.',
    'Frozen-batch convergence exercises bounded parallel membership freezing and acknowledgement without datastore contention.',
    'Live database contention, workflow replacement, consumer scaling, provider cost, and cluster resource footprint remain separate release-candidate evidence lanes.',
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
  authority,
  signals,
  frozenBatches,
};

const violations = [
  authority.decisionsPerSecond < budgets.authority.minimumDecisionsPerSecond
    ? 'authority throughput'
    : '',
  authority.latencyMs.p95 > budgets.authority.maximumP95Ms
    ? 'authority p95 latency'
    : '',
  authority.rssGrowthBytes > budgets.authority.maximumRssGrowthBytes
    ? 'authority RSS growth'
    : '',
  signals.issuesPerSecond < budgets.signals.minimumIssuesPerSecond
    ? 'signal issuance throughput'
    : '',
  signals.resolutionsPerSecond < budgets.signals.minimumResolutionsPerSecond
    ? 'signal resolution throughput'
    : '',
  signals.issueLatencyMs.p95 > budgets.signals.maximumIssueP95Ms
    ? 'signal issuance p95 latency'
    : '',
  signals.resolutionLatencyMs.p95 > budgets.signals.maximumResolutionP95Ms
    ? 'signal resolution p95 latency'
    : '',
  signals.rssGrowthBytes > budgets.signals.maximumRssGrowthBytes
    ? 'signal RSS growth'
    : '',
  frozenBatches.eventsPerSecond
      < budgets.frozenBatches.minimumEventsPerSecond
    ? 'frozen-batch throughput'
    : '',
  frozenBatches.convergenceMs > budgets.frozenBatches.maximumConvergenceMs
    ? 'frozen-batch convergence'
    : '',
  frozenBatches.rssGrowthBytes
      > budgets.frozenBatches.maximumRssGrowthBytes
    ? 'frozen-batch RSS growth'
    : '',
].filter(Boolean);

console.log(JSON.stringify({ ...report, violations }, null, 2));
if (violations.length > 0) {
  throw new Error(`v0.7 benchmark budgets exceeded: ${violations.join(', ')}`);
}
if (record) {
  const history = join(root, 'benchmarks/v0.7/history');
  await mkdir(history, { recursive: true });
  await writeFile(
    join(root, 'benchmarks/v0.7/baseline.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  const name = `${
    report.generatedAt.replace(/[:.]/g, '-')
  }-${report.git.commit.slice(0, 8)}-${report.environment.platform}-${
    report.environment.architecture
  }.json`;
  await writeFile(join(history, name), `${JSON.stringify(report, null, 2)}\n`);
}

async function benchmarkAuthority(count: number) {
  const repository = new InMemoryApplicationAuthorityRepository();
  const service = new ApplicationAuthorityService(repository, {
    now: () => new Date('2026-08-01T00:00:00.000Z'),
  });
  const applicationIdentity: ApplicationIdentityReference = {
    id: 'identity:benchmark:application',
    kind: 'service',
    issuer: 'applik8s://benchmark',
    subject: 'application-authority',
  };
  const identity: ApplicationIdentityReference = {
    id: 'identity:benchmark:user',
    kind: 'human',
    issuer: 'benchmark',
    subject: 'user',
  };
  const operation: ApplicationOperationDescriptor = {
    apiVersion: 'applik8s.operation/v1alpha1',
    id: 'applik8s://models/Benchmark/operations/read',
    version: '1',
    name: 'read',
    kind: 'model.query',
    input: { digest: 'sha256:input', schema: { type: 'object' } },
    output: { digest: 'sha256:output', schema: { type: 'object' } },
    errors: {},
    authority: {
      classification: 'application-policy',
      grantable: false,
      delegable: false,
      checks: ['enqueue'],
      defaultScope: { kind: 'all' },
      audiences: ['benchmark'],
      transports: ['direct'],
    },
    transports: [],
    placement: { nodeId: 'benchmark.read', runtime: 'server' },
  };
  const catalog: ApplicationOperationCatalog = {
    apiVersion: 'applik8s.operationCatalog/v1alpha1',
    application: 'benchmark',
    revision: 'catalog-1',
    digest: 'sha256:catalog',
    state: 'active',
    operations: [operation],
  };
  await service.reconcileStaticAuthorityManifest({
    apiVersion: 'applik8s.authorityManifest/v1alpha1',
    application: 'benchmark',
    revision: 'authority-1',
    identities: [applicationIdentity],
    permissions: [{
      id: 'permission:benchmark:read',
      name: 'read',
      operationIds: [operation.id],
      scope: { kind: 'all' },
      transports: ['direct'],
      audiences: ['benchmark'],
      grantable: false,
    }],
    roles: [{
      id: 'role:benchmark:member',
      name: 'member',
      permissionIds: ['permission:benchmark:read'],
    }],
    grants: [],
    outcomes: [],
  }, catalog.revision);
  const principal: ApplicationPrincipal = {
    id: 'principal:benchmark:user',
    identity,
    kind: 'human',
    roles: ['member'],
    authenticationMethod: 'session',
    audience: ['benchmark'],
    trustedContextDigest: 'sha256:context',
    catalogRevision: catalog.revision,
    authorityRevision: 'authority-1',
    admittedAt: '2026-08-01T00:00:00.000Z',
  };
  const latencies: number[] = [];
  const memoryBefore = process.memoryUsage().rss;
  const started = performance.now();
  for (let index = 0; index < count; index += 1) {
    const operationStarted = performance.now();
    const result = await service.authorize({
      application: 'benchmark',
      catalog,
      operation,
      principal,
      target: { kind: 'all' },
      audience: 'benchmark',
      transport: 'direct',
      applicationPolicyAllowed: true,
      inputDigest: `sha256:${index}`,
      trustedContextDigest: principal.trustedContextDigest,
    });
    if (!result.allowed) {
      throw new Error(`Benchmark authority denied operation ${index}.`);
    }
    latencies.push(performance.now() - operationStarted);
  }
  const durationMs = performance.now() - started;
  return {
    durationMs: round(durationMs),
    decisionsPerSecond: round(count / (durationMs / 1_000)),
    latencyMs: quantiles(latencies),
    retainedAuditEvents: repository.audit().length,
    rssGrowthBytes: Math.max(0, process.memoryUsage().rss - memoryBefore),
    rssGrowthBytesPerDecision: round(
      Math.max(0, process.memoryUsage().rss - memoryBefore) / count,
    ),
  };
}

async function benchmarkSignals(count: number) {
  const store = createMemoryApplicationSignalStore();
  const definition: ApplicationSignalDefinition<
    { requestId: string },
    { approve: { comment?: string } }
  > = {
    kind: 'applicationSignalDefinition',
    id: 'benchmark-review.v1',
    name: 'benchmark-review',
    version: 'v1',
    input: type({ requestId: 'string' }),
    actions: { approve: type({ 'comment?': 'string' }) },
  };
  const ids: string[] = [];
  const issueLatencies: number[] = [];
  const memoryBefore = process.memoryUsage().rss;
  const issueStarted = performance.now();
  for (let index = 0; index < count; index += 1) {
    const started = performance.now();
    const issued = await store.issue({
      occurrenceKey: `benchmark:${index}`,
      definition,
      input: { requestId: `request-${index}` },
      issuedAt: '2026-08-01T00:00:00.000Z',
      expiresAt: '2026-08-02T00:00:00.000Z',
      target: { requestId: `request-${index}` },
      access: { mode: 'authorize', selectors: [{ role: 'reviewer' }] },
      issueReceipt: { id: `receipt:issue:${index}` },
    });
    ids.push(issued.instance.id);
    issueLatencies.push(performance.now() - started);
  }
  const issueDurationMs = performance.now() - issueStarted;
  const resolutionLatencies: number[] = [];
  const resolutionStarted = performance.now();
  for (let index = 0; index < count; index += 1) {
    const started = performance.now();
    await store.resolve({
      id: ids[index] ?? '',
      action: 'approve',
      input: {},
      actor: { id: 'reviewer', roles: ['reviewer'] },
      receipt: { id: `receipt:resolve:${index}` },
      decidedAt: '2026-08-01T01:00:00.000Z',
      idempotencyKey: `resolve:${index}`,
    });
    resolutionLatencies.push(performance.now() - started);
  }
  const resolutionDurationMs = performance.now() - resolutionStarted;
  return {
    issueDurationMs: round(issueDurationMs),
    resolutionDurationMs: round(resolutionDurationMs),
    issuesPerSecond: round(count / (issueDurationMs / 1_000)),
    resolutionsPerSecond: round(count / (resolutionDurationMs / 1_000)),
    issueLatencyMs: quantiles(issueLatencies),
    resolutionLatencyMs: quantiles(resolutionLatencies),
    rssGrowthBytes: Math.max(0, process.memoryUsage().rss - memoryBefore),
  };
}

async function benchmarkFrozenBatches(count: number) {
  const events = Array.from({ length: count }, (_, index) =>
    streamEnvelope(index));
  let offset = 0;
  const state = memoryBatchStore();
  const memoryBefore = process.memoryUsage().rss;
  const started = performance.now();
  const result = await runApplicationStreamBatchProcessor({
    processor: 'benchmark-batch',
    streamName: 'benchmark.events.v1',
    source: {
      async read(_after, limit) {
        const items = events.slice(offset, offset + limit);
        offset += items.length;
        return {
          items,
          nextSequence: items.at(-1)?.sequence ?? state.checkpoint(),
          exhausted: offset >= events.length,
          retentionFloor: 0,
        };
      },
    },
    store: state.store,
    admit: benchmarkStreamDeliveryAdmission,
    handle: async () => undefined,
    retry: {
      maxAttempts: 1,
      initialDelayMs: 1,
      maxDelayMs: 1,
      factor: 2,
    },
    failure: 'pause',
    timeoutMs: 5_000,
    maxInputBytes: 2_000_000,
    maxItems: 125,
    maxBytes: 2_000_000,
    concurrency: 8,
    maxBatches: Math.max(1, Math.ceil(count / 1_000)),
  });
  const convergenceMs = performance.now() - started;
  if (result.processed !== count || result.checkpoint !== count) {
    throw new Error(
      `Frozen-batch benchmark did not converge: ${JSON.stringify(result)}.`,
    );
  }
  return {
    convergenceMs: round(convergenceMs),
    eventsPerSecond: round(count / (convergenceMs / 1_000)),
    batches: Math.ceil(count / 125),
    concurrency: 8,
    maxItems: 125,
    rssGrowthBytes: Math.max(0, process.memoryUsage().rss - memoryBefore),
  };
}

function benchmarkStreamDeliveryAdmission({
  envelope,
  attempt,
  signal,
}: Parameters<ApplicationStreamDeliveryAdmitter>[0]): ReturnType<ApplicationStreamDeliveryAdmitter> {
  if (signal.aborted) throw new Error('Benchmark stream delivery was aborted.');
  const workloadIdentity = {
    id: 'identity:benchmark:workload:frozen-batch-processor',
    kind: 'workload' as const,
    issuer: 'applik8s://benchmark',
    subject: 'frozen-batch-processor',
  };
  const causalPrincipal = envelope.principal
    ? applicationCausalPrincipalContext(envelope.principal)
    : {
        id: workloadIdentity.id,
        identity: workloadIdentity,
        grantIds: [],
      };
  const executionId = `benchmark-frozen-batch:${envelope.id}`;
  const deadline = new Date(Date.now() + 60_000).toISOString();
  const cancellationRevision = `active:${executionId}`;
  const trustedContextDigest =
    envelope.contextDigest
    ?? envelope.principal?.trustedContextDigest
    ?? 'benchmark-context';
  const principal = createApplicationExecutionPrincipalV1({
    application: 'benchmark-v07',
    executionKind: 'processor',
    executionId,
    attempt,
    workloadIdentity,
    causalPrincipal,
    envelopes: [],
    trustedContextDigest,
    audience: ['benchmark-frozen-batch'],
    catalogRevision: 'benchmark-v07',
    authorityRevision: 'benchmark-v07',
    deadline,
    cancellationRevision,
    authenticationMethod: 'benchmark-stream-delivery',
  });
  return applicationAdmissionInvocationView(
    validateApplicationAdmissionContextV1WithoutReceipt(
      withApplicationAdmissionExecutionV1(
        createApplicationAdmissionContextV1({
          admission: {
            principal,
            trustedContext: envelope.trustedContext ?? {},
          },
          operation: {
            id: 'applik8s://processors/benchmark-frozen-batch/operations/deliver',
            transport: 'broker',
          },
          correlationId: envelope.id,
        }),
        {
          causationId: envelope.id,
          deadline,
          cancellation: { revision: cancellationRevision },
          delivery: { id: envelope.id, source: 'benchmark-stream' },
        },
      ),
    ),
  );
}

function memoryBatchStore(): {
  readonly store: ApplicationStreamProcessorStore;
  checkpoint(): number;
} {
  let checkpoint = 0;
  let pending:
    | ApplicationFrozenStreamBatchGroup<object>
    | undefined;
  const store: ApplicationStreamProcessorStore = {
    async prepare() {},
    async checkpoint() {
      return checkpoint;
    },
    async advance(_processor, _stream, sequence) {
      checkpoint = sequence;
    },
    async deadLetter() {},
    async pendingBatchGroup() {
      return pending;
    },
    async freezeBatchGroup(_processor, _stream, group) {
      pending = structuredClone(group);
      return pending;
    },
    async markBatchComplete(_processor, _stream, groupId, batchId) {
      if (!pending || pending.id !== groupId) {
        throw new Error(`Unknown frozen batch group ${groupId}.`);
      }
      pending = {
        ...pending,
        completedBatchIds: [...new Set([
          ...pending.completedBatchIds,
          batchId,
        ])],
      };
    },
    async completeBatchGroup(_processor, _stream, groupId, sequence) {
      if (!pending || pending.id !== groupId) {
        throw new Error(`Unknown frozen batch group ${groupId}.`);
      }
      checkpoint = sequence;
      pending = undefined;
    },
    async close() {},
  };
  return { store, checkpoint: () => checkpoint };
}

function streamEnvelope(
  index: number,
): ApplicationStreamEnvelope<{ itemId: string }> {
  return {
    id: `event-${index}`,
    stream: { name: 'benchmark.events', version: 'v1' },
    sequence: index + 1,
    partitionKey: `partition-${index % 8}`,
    recordedAt: '2026-08-01T00:00:00.000Z',
    payload: { itemId: `item-${index}` },
  };
}

function quantiles(values: readonly number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const at = (fraction: number) =>
    round(
      sorted[
        Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))
      ] ?? 0,
    );
  return {
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    maximum: round(sorted.at(-1) ?? 0),
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

async function gitRevision(): Promise<{
  readonly commit: string;
  readonly dirty: boolean;
  readonly workingTreeDigest?: string;
}> {
  const [{ stdout: commit }, { stdout: status }, { stdout: diff }] =
    await Promise.all([
      execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root }),
      execFileAsync('git', ['status', '--porcelain'], { cwd: root }),
      execFileAsync('git', ['diff', '--binary', 'HEAD'], {
        cwd: root,
        maxBuffer: 100 * 1024 * 1024,
      }),
    ]);
  const dirty = status.trim().length > 0;
  return {
    commit: commit.trim(),
    dirty,
    ...(dirty
      ? {
          workingTreeDigest: `sha256:${
            createHash('sha256').update(diff).digest('hex')
          }`,
        }
      : {}),
  };
}
