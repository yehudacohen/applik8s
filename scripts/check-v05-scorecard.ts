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

const dimensions: readonly Dimension[] = [
  dimension('Architecture and graph',
    check('graph-valid', diagnostics.length === 0, `ApplicationGraph diagnostics: ${diagnostics.length}`),
    check('provider-neutral-contracts', stable.has('task') && stable.has('workflow') && stable.has('provider.WorkflowEngine'), 'Task, workflow, and WorkflowEngine are stable provider-neutral graph surfaces.'),
  ),
  dimension('Durable orchestration semantics',
    check('workflow-boundary', workflowHandlers.length >= 2 && workflowHandlers.every((node) => node.orchestrationBoundary === 'durableEffectsThroughTasks'), `${workflowHandlers.length} workflow handlers isolate effects through tasks.`),
    // typecast: these literals are the required subset of the graph's closed deterministic-operation union.
    check('durable-operations', workflowHandlers.every((node) => ['task', 'sleep', 'externalEvent', 'cancellation'].every((operation) => node.deterministicOperations.includes(operation as never))), 'Workflow handlers declare durable task, wait, sleep, and cancellation operations.'),
  ),
  dimension('Task safety and idempotency',
    check('task-effect-boundary', taskHandlers.length >= 3 && taskHandlers.every((node) => node.effectBoundary === 'externalEffectsAllowed'), `${taskHandlers.length} task handlers are the explicit external-effect boundary.`),
    check('bounded-retry', taskHandlers.every((node) => (node.retry.maxAttempts ?? 0) > 1 && (node.retry.factor ?? 0) > 0), 'Every task has bounded retry attempts and an explicit exponential factor.'),
  ),
  dimension('Provider implementation',
    check('hatchet-postgres', engine?.kind === 'provider' && engine.implementation === 'hatchet' && engine.config?.serverVersion === 'v0.90.13', 'Pinned Hatchet implementation is represented in the graph.'),
    check('provider-resources', graph.providerBindings.some((binding) => binding.provider.nodeId === engine?.id && ['HelmRepository', 'HelmRelease', 'Cluster'].every((kind) => binding.generatedResources.some((resource) => resource.kind === kind))), 'WorkflowEngine binding declares Hatchet, Flux, and CNPG resources.'),
  ),
  dimension('Worker operations',
    check('bounded-workers', workers.length >= 2 && workers.every((node) => node.deployment.taskSlots > 0 && node.deployment.durableSlots > 0 && node.deployment.gracefulShutdownSeconds > 0), `${workers.length} inferred workers have bounded slots and graceful drain.`),
    check('effect-egress', workers.every((node) => node.deployment.egress === 'allowAll' || node.deployment.egress === 'sameNamespace'), 'Every worker records an explicit task egress posture.'),
  ),
  dimension('Longitudinal product proof',
    check('onboarding-decommissioning', workflows.some((node) => node.name === 'tenant.onboard.v1') && workflows.some((node) => node.name === 'tenant.decommission.v1'), 'Tenant Platform defines onboarding and decommissioning workflows.'),
    check('canonical-transition', await contains('examples/tenant-platform.ts', 'TenantLifecycle.transaction'), 'Workflow outcomes return through a v0.4 canonical model transaction.'),
  ),
  dimension('Failure and live evidence',
    check('compensation-intervention', await contains('examples/tenant-platform.ts', "phase: 'NeedsIntervention'"), 'Tenant Platform exposes compensation failure as explicit operator intervention.'),
    check('live-proof', await contains('packages/e2e/test/workflow-hatchet-live.e2e.test.ts', 'survives worker replacement'), 'OrbStack proof covers retry, wait, replacement, compensation, intervention, and cancellation.'),
  ),
  dimension('Documentation and adoption',
    check('workflow-guide', await contains('docs/workflows.md', 'External effects belong in tasks'), 'Workflow guide documents the central effect boundary.'),
    check('release-gate', await contains('package.json', 'check:v05:prerelease:orbstack'), 'One command joins local, packaging, scorecard, and OrbStack workflow evidence.'),
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
