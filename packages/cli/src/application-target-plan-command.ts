// typecast-file-boundary: CLI JSON and discovered graph values are validated before conversion into typed target plans.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  diffApplicationPlans,
  serializeApplicationPlan,
  validateApplicationGraph,
  validateApplicationPlan,
  type ApplicationGraph,
  type ApplicationPlan,
} from '@applik8s/core';
import {
  compileApplicationAwsApplicationPlan,
  compileApplicationAwsDeploymentPlan,
} from '@applik8s/deployment-compiler';
import {
  serializeApplicationAwsDeploymentPlan,
  validateApplicationAwsDeploymentPlan,
  type ApplicationAwsDeploymentPlan,
} from '@applik8s/deployment-contract';
import { resolveApplicationBuildPackage } from './application-build-package.js';
import { readLocalRuntimeArtifacts } from './local-development-command.js';
import type {
  ApplicationDeploymentCommandIo,
  ApplicationDeploymentCommandRuntime,
} from './application-deployment-command-contract.js';
import {
  readPriorApplicationPlan,
  renderApplicationPlanDiff,
  renderCanonicalApplicationPlan,
} from './application-plan-rendering.js';

export interface ApplicationTargetPlanCommandOptions {
  readonly target: 'aws';
  readonly environment: string;
  readonly region: string;
  readonly accountId: string;
  readonly availabilityZones?: readonly string[];
  readonly hostedZones?: Readonly<Record<string, string>>;
  readonly outDir?: string;
  readonly compositionName?: string;
  readonly connectionBindings?: string;
  readonly skipAppBuild?: boolean;
  readonly format?: 'text' | 'json' | 'graph';
  readonly diff?: string;
}

export interface CompiledApplicationTargetPlan {
  readonly plan: ApplicationAwsDeploymentPlan;
  readonly planPath: string;
  readonly applicationPlan: ApplicationPlan;
  readonly applicationPlanPath: string;
  readonly compileOutDir: string;
}

/** Compile a cloud target plan without consulting Kubernetes or applying effects. */
export async function runApplicationTargetPlan(
  entrypoint: string,
  options: ApplicationTargetPlanCommandOptions,
  io: ApplicationDeploymentCommandIo,
  runtime: ApplicationDeploymentCommandRuntime,
): Promise<number> {
  const compiled = await compileApplicationTargetPlan(entrypoint, options, io, runtime);
  const { plan, planPath, applicationPlan, applicationPlanPath } = compiled;

  io.stdout(renderCanonicalApplicationPlan(applicationPlan, options.format ?? 'text'));
  if (options.diff) {
    const previous = await readPriorApplicationPlan(resolve(io.cwd, options.diff));
    io.stdout(renderApplicationPlanDiff(diffApplicationPlans(previous, applicationPlan)));
  }
  io.stdout(`Canonical application plan: ${applicationPlanPath}`);
  io.stdout(`Alchemy AWS native plan: ${planPath}`);

  const validation = validateApplicationAwsDeploymentPlan(plan);
  const applicationValidation = validateApplicationPlan(applicationPlan);
  for (const diagnostic of [...validation, ...applicationValidation.diagnostics]) io.stderr(`${diagnostic.code}: ${diagnostic.message}`);
  return validation.some(({ severity }) => severity === 'error') || !applicationValidation.valid ? 1 : 0;
}

/** Compile and persist the canonical AWS artifact for plan/apply/status reuse. */
export async function compileApplicationTargetPlan(
  entrypoint: string,
  options: ApplicationTargetPlanCommandOptions,
  io: ApplicationDeploymentCommandIo,
  runtime: ApplicationDeploymentCommandRuntime,
): Promise<CompiledApplicationTargetPlan> {
  const applicationEntrypoint = resolve(io.cwd, entrypoint);
  if (!options.skipAppBuild) {
    const applicationPackage = await resolveApplicationBuildPackage(applicationEntrypoint);
    const code = await runtime.runChild({ command: 'bun', args: ['run', 'build'], cwd: applicationPackage.directory });
    if (code !== 0) throw new Error(`Application build failed with exit code ${code}.`);
  }

  const outDir = options.outDir ?? '.applik8s/plans';
  const compileOutDir = resolve(io.cwd, outDir, 'compiled');
  const code = await runtime.runBuild(entrypoint, {
    outDir: compileOutDir,
    typekro: true,
    production: true,
    executionTarget: 'aws',
    compositionName: options.compositionName ?? 'app',
    ...(options.connectionBindings ? { connectionBindings: options.connectionBindings } : {}),
  }, io);
  if (code !== 0) throw new Error(`Application graph compilation failed with exit code ${code}.`);

  const graphPath = resolve(compileOutDir, 'typekro', 'application-graph.json');
  const graph = JSON.parse(await readFile(graphPath, 'utf8')) as ApplicationGraph;
  const graphDiagnostics = validateApplicationGraph(graph);
  if (graphDiagnostics.length > 0) {
    for (const diagnostic of graphDiagnostics) io.stderr(`${diagnostic.code}: ${diagnostic.message}`);
    throw new Error('The semantic ApplicationGraph is invalid; AWS planning did not run.');
  }

  const runtimeArtifacts = await readLocalRuntimeArtifacts(
    resolve(compileOutDir, 'typekro', 'typekro-composition.json'),
    compileOutDir,
    'aws',
  );
  const plan = compileApplicationAwsDeploymentPlan({
    graph,
    environment: options.environment,
    region: options.region,
    accountId: options.accountId,
    runtimeArtifacts,
    workspaceRoot: io.cwd,
    ...(options.availabilityZones?.length ? { availabilityZones: options.availabilityZones } : {}),
    ...(options.hostedZones && Object.keys(options.hostedZones).length > 0 ? { hostedZones: options.hostedZones } : {}),
  });
  const planPath = resolve(io.cwd, outDir, `${options.environment}.aws.json`);
  const applicationPlan = compileApplicationAwsApplicationPlan({
    graph,
    aws: plan,
    workspaceRoot: io.cwd,
  });
  const applicationPlanPath = resolve(io.cwd, outDir, `${options.environment}.application-plan.json`);
  await mkdir(dirname(planPath), { recursive: true });
  await writeFile(planPath, serializeApplicationAwsDeploymentPlan(plan), 'utf8');
  await writeFile(applicationPlanPath, serializeApplicationPlan(applicationPlan), 'utf8');

  const validation = validateApplicationAwsDeploymentPlan(plan);
  if (validation.some(({ severity }) => severity === 'error')) {
    throw new Error(validation.map(({ code, message }) => `${code}: ${message}`).join('\n'));
  }
  const applicationValidation = validateApplicationPlan(applicationPlan);
  if (!applicationValidation.valid) {
    throw new Error(applicationValidation.diagnostics.map(({ code, message }) => `${code}: ${message}`).join('\n'));
  }
  return { plan, planPath, applicationPlan, applicationPlanPath, compileOutDir };
}

export function renderAwsPlanText(plan: ApplicationAwsDeploymentPlan, previous?: ApplicationAwsDeploymentPlan): string {
  const lines = [
    `Application ${plan.application}`,
    `Target AWS ${plan.accountId ?? '<unresolved>'}/${plan.region} (${plan.environment})`,
    `Lifecycle authority ${plan.lifecycleAuthority}`,
    '',
    'Physical topology',
    ...plan.resources.map((resource) => `  ${resource.service.padEnd(24)} ${resource.resourceType.padEnd(28)} ${resource.physicalName}${resource.semanticNodeId ? ` <- ${resource.semanticNodeId}` : ''}`),
  ];
  if (previous) {
    const changes = diffAwsPlans(previous, plan);
    lines.push('', 'Changes', ...changes.map((change) => `  ${change}`));
  }
  if (plan.diagnostics.length > 0) lines.push('', 'Diagnostics', ...plan.diagnostics.map((diagnostic) => `  ${diagnostic.severity.toUpperCase()} ${diagnostic.code}: ${diagnostic.message}`));
  lines.push('', `Digest ${plan.digest}`);
  return lines.join('\n');
}

export function renderAwsPlanGraph(plan: ApplicationAwsDeploymentPlan): string {
  const lines = ['flowchart LR'];
  for (const resource of plan.resources) lines.push(`  ${graphId(resource.id)}[\"${escapeGraphLabel(resource.service)}: ${escapeGraphLabel(resource.resourceType)}\\n${escapeGraphLabel(resource.physicalName)}\"]`);
  for (const edge of plan.edges) lines.push(`  ${graphId(edge.from)} -->|${edge.relationship}${edge.output ? `:${escapeGraphLabel(edge.output)}` : ''}| ${graphId(edge.to)}`);
  return lines.join('\n');
}

function diffAwsPlans(previous: ApplicationAwsDeploymentPlan, next: ApplicationAwsDeploymentPlan): readonly string[] {
  const before = new Map(previous.resources.map((resource) => [resource.id, JSON.stringify(resource)]));
  const after = new Map(next.resources.map((resource) => [resource.id, JSON.stringify(resource)]));
  const changes = [
    ...[...after].filter(([id]) => !before.has(id)).map(([id]) => `create ${id}`),
    ...[...after].filter(([id, value]) => before.has(id) && before.get(id) !== value).map(([id]) => `update ${id}`),
    ...[...before].filter(([id]) => !after.has(id)).map(([id]) => `delete ${id}`),
  ].sort();
  return changes.length > 0 ? changes : ['no changes'];
}

function graphId(value: string): string { return `n_${Buffer.from(value).toString('hex')}`; }
function escapeGraphLabel(value: string): string { return value.replace(/["\\]/gu, (character) => `\\${character}`); }
