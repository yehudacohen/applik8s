import { readFile } from 'node:fs/promises';
import { applicationGraphFor } from '@applik8s/applik8s';
import { validateApplicationGraphStructure } from '@applik8s/core';

interface Check {
  readonly id: string;
  readonly pass: boolean;
  readonly evidence: string;
}

interface Dimension {
  readonly name: string;
  readonly releaseBlocking: boolean;
  readonly checks: readonly Check[];
}

interface PerformanceEvidence {
  readonly scheduler: { readonly throughputPerSecond: number; readonly rssGrowthBytes: number };
  readonly coldStart: { readonly importLatencyMs: { readonly p95: number } };
  readonly builds: {
    readonly imagejob: { readonly maximumWasmBytes: number };
    readonly tenant: { readonly maximumWasmBytes: number };
  };
}

interface PerformanceBudgets {
  readonly scheduler: { readonly minimumThroughputPerSecond: number; readonly maximumRssGrowthBytes: number };
  readonly coldStart: { readonly maximumP95Ms: number };
  readonly artifacts: { readonly maximumWasmBytes: number };
}

interface ScorecardInventory {
  readonly checkIds: readonly string[];
}

// Keep examples outside the workspace typecheck root while still exercising the
// real longitudinal program at runtime.
// static-import-exception: the example intentionally remains outside the publishable workspace typecheck root.
const tenantPlatform = await import(['..', 'examples', 'tenant-platform.js'].join('/'));
const [baselineExample, candidateExample, performance, budgets, expected] = await Promise.all([
  Promise.resolve(tenantPlatform.createTenantPlatformExample()),
  Promise.resolve(tenantPlatform.createTenantPlatformV04Example()),
  json<PerformanceEvidence>('benchmarks/v0.4.1/baseline.json'),
  json<PerformanceBudgets>('benchmarks/v0.4.1/budgets.json'),
  json<ScorecardInventory>('benchmarks/v0.4/scorecard.json'),
]);

const baseline = requiredGraph(applicationGraphFor(baselineExample.composition), 'v0.3 Tenant Platform');
const candidate = requiredGraph(applicationGraphFor(candidateExample.composition), 'v0.4 Tenant Platform');
const handler = candidate.nodes.find((node) => node.kind === 'commandHandler');
const processor = candidate.nodes.find((node) => node.kind === 'processor');
const stable = new Set(candidate.compatibility.stablePublicApis);
const graphDiagnostics = validateApplicationGraphStructure(candidate);

const dimensions: readonly Dimension[] = [
  dimension('Architecture and scope', true,
    check('graph-valid', graphDiagnostics.length === 0, `ApplicationGraph diagnostics: ${graphDiagnostics.length}`),
    check('bounded-scope', candidate.compatibility.postV3Surfaces.includes('generic-workflow-orchestration') && candidate.compatibility.postV3Surfaces.includes('workload-movement-operator'), 'Workflow orchestration and workload movement remain explicitly post-v0.4.'),
  ),
  dimension('Public API stability', true,
    check('durable-apis-stable', ['command', 'event', 'Model.on.command', 'provider.EventLog'].every((name) => stable.has(name)), 'Durable command/event and EventLog APIs are stable v0.4 surfaces.'),
    check('managed-networking-stable', ['provider.Certificate', 'provider.DnsPublication'].every((name) => stable.has(name)), 'Managed TLS and DNS intent are stable v0.4 surfaces.'),
  ),
  dimension('Transaction semantics', true,
    check('postgres-authority', handler?.kind === 'commandHandler' && handler.projectionReadiness.durableResultAuthority === 'postgresCommandResults' && handler.projectionReadiness.resultRevisionAuthority === 'postgresCommandResults', 'PostgreSQL remains durable command-result and result-revision authority.'),
    check('projection-readiness', handler?.kind === 'commandHandler' && handler.projectionReadiness?.duplicateRecovery === 'idempotentRedelivery', 'Graph records duplicate recovery and projection readiness.'),
  ),
  dimension('Effect isolation', true,
    check('closed-source-contract', handler?.kind === 'commandHandler' && handler.effectEnforcement?.sourceAnalysis === 'closedStructuralAllowlist', 'Transaction callbacks use the closed structural source contract.'),
    check('runtime-membrane', handler?.kind === 'commandHandler' && handler.effectEnforcement?.runtimeMembrane === 'asyncContextAmbientIo', 'Runtime independently denies ambient I/O while a transaction callback runs.'),
  ),
  dimension('Durability and recovery', true,
    check('declared-outbox', handler?.kind === 'commandHandler' && (handler.transaction?.outbox.length ?? 0) > 0, 'Committed events use the declared transactional outbox.'),
    check('event-log-required', candidate.providerRequirements.some((requirement) => requirement.interface === 'EventLog' && requirement.required), 'Generated processor has a required EventLog binding.'),
  ),
  dimension('Generated runtime safety', true,
    check('bounded-processor', processor?.kind === 'processor' && typeof processor.deployment.concurrency === 'number' && typeof processor.deployment.maxAckPending === 'number' && processor.deployment.concurrency > 0 && processor.deployment.maxAckPending >= processor.deployment.concurrency, 'Processor concurrency and acknowledgement window are explicit and bounded.'),
    check('generated-resources', processor?.kind === 'processor' && ['Deployment', 'Consumer'].every((kind) => processor.generatedResources?.some((resource) => resource.resource?.kind === kind) === true), 'Processor Deployment and JetStream Consumer are represented in the graph.'),
  ),
  dimension('Rust host quality', true,
    await fileCheck('clippy-gate', 'scripts/check-local-gates.mjs', "'clippy', '--workspace', '--all-targets'", 'The local/release gate enforces warning-free Clippy across all targets.'),
    await fileCheck('format-gate', 'scripts/check-local-gates.mjs', "'fmt', '--all', '--', '--check'", 'The local/release gate enforces Rust formatting.'),
  ),
  dimension('Longitudinal example', true,
    check('graph-growth', baseline.nodes.length === 28 && candidate.nodes.length === 33 && baseline.edges.length === 13 && candidate.edges.length === 19, `Tenant Platform graph delta: ${baseline.nodes.length}→${candidate.nodes.length} nodes, ${baseline.edges.length}→${candidate.edges.length} edges.`),
    check('behavior-inferred', ['command', 'event', 'commandHandler', 'processor'].every((kind) => candidate.nodes.some((node) => node.kind === kind)), 'One behavior declaration infers all durable graph node kinds.'),
  ),
  dimension('Performance budgets', true,
    check('scheduler-budget', performance.scheduler.throughputPerSecond >= budgets.scheduler.minimumThroughputPerSecond && performance.scheduler.rssGrowthBytes <= budgets.scheduler.maximumRssGrowthBytes, 'Scheduler throughput and RSS are inside the recorded budget.'),
    check('cold-start-budget', performance.coldStart.importLatencyMs.p95 <= budgets.coldStart.maximumP95Ms, 'Cold-start p95 is inside budget.'),
    check('artifact-budget', performance.builds.imagejob.maximumWasmBytes <= budgets.artifacts.maximumWasmBytes && performance.builds.tenant.maximumWasmBytes <= budgets.artifacts.maximumWasmBytes, 'Flagship WASM artifacts are inside budget.'),
  ),
  dimension('Documentation and adoption', true,
    await fileCheck('npm-first-run', 'docs/npm-first-run.md', 'npm install @applik8s/applik8s', 'A clean npm consumer path is documented.'),
    await fileCheck('command-boundary-doc', 'docs/commands.md', 'closed structural', 'The transaction effect contract is documented.'),
  ),
  dimension('Release evidence', true,
    await fileCheck('live-attestation-verifier', 'scripts/verify-v04-live-evidence.mjs', 'workflow_run?.head_sha', 'Release automation verifies exact-commit live evidence.'),
    await fileCheck('release-workflow-gate', '.github/workflows/deploy.yml', 'Verify exact-commit v0.4 live evidence', 'Tag publication is gated by live evidence.'),
  ),
];

const actualIds = dimensions.flatMap((dimension) => dimension.checks.map((item) => `${dimension.name}:${item.id}`)).sort();
const expectedIds = expected.checkIds.slice().sort();
if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
  throw new Error('benchmarks/v0.4/scorecard.json does not match the executable scorecard check inventory. Update both intentionally.');
}

const failed = dimensions.flatMap((dimension) => dimension.checks.filter((item) => !item.pass).map((item) => ({ dimension, item })));
for (const dimension of dimensions) {
  const passed = dimension.checks.filter((item) => item.pass).length;
  const score = Number(((passed / dimension.checks.length) * 10).toFixed(1));
  console.log(`${dimension.name}: ${score}/10 evidence coverage (${passed}/${dimension.checks.length})`);
  for (const item of dimension.checks) console.log(`  ${item.pass ? 'PASS' : 'FAIL'} ${item.id}: ${item.evidence}`);
}
if (failed.length > 0) {
  throw new Error(`v0.4 scorecard failed:\n${failed.map(({ dimension, item }) => `- ${dimension.name}/${item.id}: ${item.evidence}`).join('\n')}`);
}

function dimension(name: string, releaseBlocking: boolean, ...checks: readonly Check[]): Dimension {
  return { name, releaseBlocking, checks };
}

function check(id: string, pass: boolean, evidence: string): Check {
  return { id, pass, evidence };
}

async function fileCheck(id: string, path: string, snippet: string, evidence: string): Promise<Check> {
  try {
    return check(id, (await readFile(path, 'utf8')).includes(snippet), evidence);
  } catch {
    return check(id, false, `${evidence} Missing ${path}.`);
  }
}

async function json<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8'));
}

function requiredGraph<T>(graph: T | undefined, name: string): T {
  if (!graph) throw new Error(`${name} did not expose an ApplicationGraph.`);
  return graph;
}
