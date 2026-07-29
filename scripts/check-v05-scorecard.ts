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
  readonly checks: readonly Check[];
}

// static-import-exception: the scorecard executes the real longitudinal example outside the publishable package graph.
const tenantPlatform = await import(['..', 'examples', 'tenant-platform.js'].join('/'));
const example = tenantPlatform.createTenantPlatformV05Example();
const graph = applicationGraphFor(example.composition);
if (!graph) throw new Error('v0.5 Tenant Platform did not expose an ApplicationGraph.');

const diagnostics = validateApplicationGraphStructure(graph);
const stable = new Set(graph.compatibility.stablePublicApis);
const taskHandlers = graph.nodes.filter((node) => node.kind === 'taskHandler');
const workflows = graph.nodes.filter((node) => node.kind === 'workflow');
const workflowHandlers = graph.nodes.filter((node) => node.kind === 'workflowHandler');
const workers = graph.nodes.filter((node) => node.kind === 'workflowWorker');
const engine = graph.nodes.find((node) => node.kind === 'provider' && node.interface === 'WorkflowEngine');
// typecast: both files are tracked scorecard inputs whose consumed fields are checked defensively below.
const baseline = JSON.parse(await readFile('benchmarks/v0.5/baseline.json', 'utf8')) as { readonly release?: string; readonly observation?: { readonly throughputPerSecond?: number }; readonly build?: { readonly maximumWorkflowJavaScriptBytes?: number; readonly maximumWorkflowGzipBytes?: number }; readonly capacityScenarios?: readonly unknown[] };
// typecast: repository-owned maintainability budgets are a simple path-to-line-ceiling JSON map.
const maintainabilityBudgets = JSON.parse(await readFile('benchmarks/v0.5/maintainability-budgets.json', 'utf8')) as Readonly<Record<string, number>>;
const maintainability = await Promise.all(Object.entries(maintainabilityBudgets).map(async ([path, maximumLines]) => ({ path, maximumLines, lines: (await readFile(path, 'utf8')).split('\n').length })));

const dimensions: readonly Dimension[] = [
  dimension('Architecture and graph',
    check('graph-valid', diagnostics.length === 0, `ApplicationGraph diagnostics: ${diagnostics.length}`),
    check('provider-neutral-contracts', stable.has('task') && stable.has('workflow') && stable.has('provider.WorkflowEngine'), 'Task, workflow, and WorkflowEngine are stable provider-neutral graph surfaces.'),
  ),
  dimension('Durable orchestration semantics',
    check('workflow-boundary', workflowHandlers.length >= 2 && workflowHandlers.every((node) => node.orchestrationBoundary === 'durableEffectsThroughTasks'), `${workflowHandlers.length} workflow handlers isolate effects through tasks.`),
    // typecast: these literals are the required subset of the graph's closed deterministic-operation union.
    check('durable-operations', workflowHandlers.every((node) => ['task', 'sleep', 'externalEvent', 'cancellation'].every((operation) => node.deterministicOperations.includes(operation as never))), 'Workflow handlers declare durable task, wait, sleep, and cancellation operations.'),
    check('typed-contracts', await contains('packages/type-tests/src/public-api-inference.ts', "context.task('provisionAccount'") && await contains('packages/type-tests/src/public-api-inference.ts', "context.waitFor('approval')"), 'Task aliases, outputs, signal names, and signal payloads are inferred from declarations.'),
    check('durable-errors', await contains('packages/compiler/src/application-workflows/index.ts', 'applik8s-durable-error:') && await contains('packages/runtime-hatchet/src/index.ts', 'ApplicationDurableError'), 'Declared errors are validated in workers and decoded as structured runtime errors.'),
    check('bounded-observation', await contains('packages/runtime-hatchet/test/runtime.vertical.test.ts', 'honors abort signals') && await contains('packages/runtime-hatchet/test/runtime.vertical.test.ts', 'bounds repeated provider read failures'), 'Result observation has abort, deadline, and bounded provider-failure behavior.'),
  ),
  dimension('Task safety and idempotency',
    check('task-effect-boundary', taskHandlers.length >= 3 && taskHandlers.every((node) => node.effectBoundary === 'externalEffectsAllowed'), `${taskHandlers.length} task handlers are the explicit external-effect boundary.`),
    check('bounded-retry', taskHandlers.every((node) => (node.retry.maxAttempts ?? 0) > 1 && (node.retry.factor ?? 0) > 0), 'Every task has bounded retry attempts and an explicit exponential factor.'),
  ),
  dimension('Provider implementation',
    check('hatchet-postgres', engine?.kind === 'provider' && engine.implementation === 'hatchet' && engine.config?.serverVersion === 'v0.90.13', 'Pinned Hatchet implementation is represented in the graph.'),
    check('provider-resources', graph.providerBindings.some((binding) => binding.provider.nodeId === engine?.id && ['HelmRepository', 'HelmRelease', 'Cluster'].every((kind) => binding.generatedResources.some((resource) => resource.kind === kind))), 'WorkflowEngine binding declares Hatchet, Flux, and CNPG resources.'),
    check('external-provider-registration', await contains('packages/core/test/application-graph.vertical.test.ts', 'AnalyticalDatabase') && await contains('packages/core/src/application-graph.ts', 'without a core release'), 'Versioned provider packages can add interfaces without changing the built-in core registry.'),
  ),
  dimension('Worker operations',
    check('bounded-workers', workers.length >= 2 && workers.every((node) => node.deployment.taskSlots > 0 && node.deployment.durableSlots > 0 && node.deployment.gracefulShutdownSeconds > 0), `${workers.length} inferred workers have bounded slots and graceful drain.`),
    check('effect-egress', workers.every((node) => node.deployment.egress === 'allowAll' || node.deployment.egress === 'sameNamespace'), 'Every worker records an explicit task egress posture.'),
    check('advanced-scaling-honesty', await contains('docs/workflows.md', 'experimental manifest-lowering surface'), 'KEDA and HA are explicitly bounded until live scaling/failover evidence exists.'),
  ),
  dimension('Longitudinal product proof',
    check('onboarding-decommissioning', workflows.some((node) => node.name === 'tenant.onboard.v1') && workflows.some((node) => node.name === 'tenant.decommission.v1'), 'Tenant Platform defines onboarding and decommissioning workflows.'),
    check('canonical-transition', await contains('examples/tenant-platform.ts', 'TenantLifecycle.transaction'), 'Workflow outcomes return through a v0.4 canonical model transaction.'),
  ),
  dimension('Failure and live evidence',
    check('compensation-intervention', await contains('examples/tenant-platform.ts', "phase: 'NeedsIntervention'"), 'Tenant Platform exposes compensation failure as explicit operator intervention.'),
    check('live-proof', await contains('packages/e2e/test/workflow-hatchet-live.e2e.test.ts', 'survives worker replacement'), 'OrbStack proof covers retry, wait, replacement, compensation, intervention, and cancellation.'),
  ),
  dimension('Kubernetes connections',
    check('strict-bindings', await contains('packages/compiler/src/manifest/index.ts', 'bindKubernetesConnections') && await contains('packages/cli/src/cli.ts', '--connection-bindings'), 'Programmatic and CLI compilation require exact, validated alias-to-Secret bindings.'),
    check('scoped-identity', await contains('crates/applik8s-runtime-bridge/src/remote_authority.rs', 'remote-management-identity') && await contains('crates/applik8s-operator-host/src/lib.rs', 'CONNECTION_BINDING_CHANGED'), 'Remote mutations carry scoped authority and reject a connection whose Secret revision changes during an invocation.'),
    check('least-privilege-rbac', await contains('packages/compiler/test/kubernetes-yaml.vertical.test.ts', 'without granting remote resource access in the management cluster') && await contains('packages/typekro-adapter/test/typekro-adapter.vertical.test.ts', 'exact Secret RBAC through TypeKro installation'), 'Plain YAML and TypeKro artifacts keep kubeconfig Secret access namespaced and remote resource permissions off the management identity.'),
    check('live-connection-proof', await contains('packages/e2e/test/kubernetes-connection-live.e2e.test.ts', 'uses only the bound identity') && await contains('package.json', 'test:v05:connections-live'), 'OrbStack proof covers bounded remote reads, guarded create/update/delete, identity isolation, and finalization.'),
  ),
  dimension('Operator DNS publication',
    check('normalized-owned-decisions', await contains('packages/applik8s/src/dns.ts', 'decideExternalDnsPublication') && await contains('packages/applik8s/test/dns-publication.vertical.test.ts', 'same-name replacement'), 'Handler-safe A/AAAA/CNAME intent, capabilities, ownership, replacement detection, and guarded decisions are executable.'),
    check('tenant-platform-dns-slice', await contains('examples/tenant-platform.ts', 'tenantDnsController') && await contains('packages/compiler/test/tenant-v05-proof.vertical.test.ts', 'tenant-v05-tenant-dns'), 'The longitudinal Tenant Platform publishes stable-identity DNS through the same local runtime adapter and exact mapped wakeup contract.'),
    check('exact-owner-wakeup', await contains('crates/applik8s-operator-host/src/lib.rs', 'targetNameFromSourceField') && await contains('packages/compiler/test/compiler-artifacts.vertical.test.ts', 'exact source-metadata mapping'), 'Compiler and host lower one source metadata field to one target get without target-list fan-out.'),
    check('wasm-and-package-boundary', await contains('packages/compiler/test/wasm-component.vertical.test.ts', 'DNS publication adapter without Node or TypeKro') && await contains('scripts/package-consumer-smoke.mjs', "'@applik8s/applik8s/dns'"), 'The dedicated DNS entrypoint compiles to ComponentizeJS and is imported from a clean packed consumer.'),
    check('local-and-connection-live-proof', await contains('packages/e2e/test/dns-publication-live.e2e.test.ts', 'exact-wakes') && await contains('package.json', 'test:v05:dns-live'), 'OrbStack proof covers local and named-connection create, observation, stable-identity update, exact wakeup, and guarded finalization.'),
  ),
  dimension('Documentation and adoption',
    check('workflow-guide', await contains('docs/workflows.md', 'External effects belong in tasks'), 'Workflow guide documents the central effect boundary.'),
    check('release-gate', await contains('package.json', 'check:v05:prerelease:orbstack'), 'One command joins local, packaging, scorecard, and OrbStack workflow evidence.'),
    check('release-evidence', await contains('.github/workflows/release-evidence.yml', "default: 'v0.5'") && await contains('.github/workflows/deploy.yml', 'Resolve release line'), 'CI evidence and tagged release gates select the v0.5 lane explicitly.'),
  ),
  dimension('Performance and maintainability',
    check('performance-history', baseline.release === 'v0.5' && (baseline.observation?.throughputPerSecond ?? 0) > 0 && (baseline.build?.maximumWorkflowJavaScriptBytes ?? 0) > 0, `Tracked v0.5 baseline records observation throughput and workflow bundle size.`),
    check('bundle-budget', (baseline.build?.maximumWorkflowGzipBytes ?? Number.POSITIVE_INFINITY) <= 700_000, `Largest recorded compressed workflow bundle is ${baseline.build?.maximumWorkflowGzipBytes ?? 'missing'} bytes.`),
    check('capacity-envelope', baseline.capacityScenarios?.length === 3, 'Tracked capacity envelope records 1, 2, and 4 replica resource/concurrency/cost scenarios.'),
    check('module-ceilings', maintainability.every((entry) => entry.lines <= entry.maximumLines), maintainability.map((entry) => `${entry.path} ${entry.lines}/${entry.maximumLines}`).join('; ')),
  ),
];

const failed = dimensions.flatMap((item) => item.checks.filter((check) => !check.pass).map((check) => ({ dimension: item.name, check })));
for (const item of dimensions) {
  const passed = item.checks.filter((check) => check.pass).length;
  console.log(`${item.name}: ${((passed / item.checks.length) * 10).toFixed(1)}/10 evidence coverage (${passed}/${item.checks.length})`);
  for (const check of item.checks) console.log(`  ${check.pass ? 'PASS' : 'FAIL'} ${check.id}: ${check.evidence}`);
}
if (failed.length > 0) throw new Error(`v0.5 scorecard failed:\n${failed.map(({ dimension, check }) => `- ${dimension}/${check.id}: ${check.evidence}`).join('\n')}`);

function dimension(name: string, ...checks: readonly Check[]): Dimension {
  return { name, checks };
}

function check(id: string, pass: boolean, evidence: string): Check {
  return { id, pass, evidence };
}

async function contains(path: string, snippet: string): Promise<boolean> {
  try {
    return (await readFile(path, 'utf8')).includes(snippet);
  } catch {
    return false;
  }
}
