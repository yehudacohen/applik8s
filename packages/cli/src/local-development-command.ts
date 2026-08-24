// typecast-file-boundary: Generated graph JSON and optional instance YAML are validated before local planning.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applicationGeneratedSecretRequirements } from '@applik8s/compiler';
import { type ApplicationGraph, type ApplicationPlan, serializeApplicationPlan } from '@applik8s/core';
import { type ApplicationAwsDeployment, applicationAwsOutputKey, createApplicationAwsDeployment } from '@applik8s/deployment-alchemy';
import { type ApplicationLocalRuntimeArtifact, awsLocalOutputBindingId, awsLocalRuntimeBindingId, compileApplicationAwsDeploymentPlan, compileLocalApplicationPlan, compileLocalSupervisorPlan } from '@applik8s/deployment-compiler';
import { type ApplicationAwsDeploymentPlan, type DeploymentJsonObject, type LocalSupervisorTarget, serializeApplicationAwsDeploymentPlan, serializeLocalSupervisorPlan, validateApplicationAwsDeploymentPlan, validateApplicationRuntimeArtifact, validateLocalSupervisorPlan } from '@applik8s/deployment-contract';
import { OpenCodeAgentProvider } from '@applik8s/dev/agent/opencode';
import { createDevelopmentDaemon, type DevelopmentApplicationEvidence, type DevelopmentDaemonState } from '@applik8s/dev/server';
import { parse as parseYaml } from 'yaml';
import { resolveApplicationBuildPackage, resolveApplicationProjectRoot } from './application-build-package.js';
import { readApplicationProjectConfiguration } from './application-project-config.js';
import {
  type LocalSupervisorIo,
  type LocalSupervisorOptions,
  readLocalSupervisorStatus,
  resetLocalSupervisor,
  startLocalSupervisor,
} from './local-supervisor.js';

export interface LocalDevelopmentCommandOptions {
  readonly target?: LocalSupervisorTarget;
  readonly profile?: string;
  readonly outDir?: string;
  readonly compositionName?: string;
  readonly status?: boolean;
  readonly reset?: boolean;
  readonly json?: boolean;
  readonly portalPort?: number;
  readonly portal?: boolean;
  readonly agent?: boolean;
  readonly agentPort?: number;
  readonly agentExecutable?: string;
  readonly allowDockerSocket?: boolean;
}

export interface LocalDevelopmentCommandRuntime {
  runBuild(entrypoint: string, options: {
    readonly outDir: string;
    readonly typekro: true;
    readonly compositionName: string;
    readonly localDevelopment: true;
    readonly executionTarget: 'local' | 'aws-local';
  }, io: LocalSupervisorIo): Promise<number>;
  readonly supervisor?: LocalSupervisorOptions;
  /** Test seam for resuming the retained MiniStack container during offline reset. */
  readonly resumeAwsLocalTarget?: (runtimeId: string, endpoint: string) => Promise<void>;
}

export async function runLocalDevelopmentCommand(
  entrypoint: string,
  options: LocalDevelopmentCommandOptions,
  io: LocalSupervisorIo,
  runtime: LocalDevelopmentCommandRuntime,
): Promise<number> {
  const applicationEntrypoint = resolve(io.cwd, entrypoint);
  const projectRoot = await resolveApplicationProjectRoot(applicationEntrypoint);
  const projectDigest = `sha256:${createHash('sha256').update(projectRoot).digest('hex')}`;
  const target = options.target ?? 'local';
  const stateDirectory = resolve(io.cwd, '.applik8s', 'local', target, safeProjectDigest(projectDigest));
  if (options.status) {
    const state = await readLocalSupervisorStatus(stateDirectory);
    if (options.json) io.stdout(JSON.stringify(state ?? { state: 'stopped' }, null, 2));
    else io.stdout(state ? `${state.application} ${state.target}/${state.profile} started ${state.startedAt} (${state.resources.length} resources)` : 'Local application is stopped.');
    return 0;
  }
  if (options.reset) {
    if (target === 'aws-local') await resetAwsLocalDeployment(stateDirectory, io, runtime);
    await resetLocalSupervisor(stateDirectory, io);
    io.stdout(`Reset local application state at ${stateDirectory}.`);
    return 0;
  }

  const configuration = await readApplicationProjectConfiguration(io.cwd);
  const developmentState: {
    application: DevelopmentDaemonState['application'];
    runtime: DevelopmentDaemonState['runtime'];
    evidence?: DevelopmentApplicationEvidence;
  } = {
    application: { state: 'building', message: 'Compiling the semantic application graph.' },
    runtime: { state: 'stopped', message: 'The local supervisor has not started.' },
  };
  const applicationOrigins = new Set<string>();
  const agentProvider = options.agent
    ? new OpenCodeAgentProvider({
        executable: options.agentExecutable ?? 'opencode',
        port: options.agentPort ?? 4389,
        protocolVersion: 'latest-v2',
      })
    : undefined;
  const daemon = options.portal === false ? undefined : await createDevelopmentDaemon({
    projectName: applicationEntrypoint.split('/').at(-2) ?? 'applik8s-application',
    workspaceRoot: projectRoot,
    revision: projectDigest,
    target,
    port: options.portalPort ?? 4388,
    state: async () => developmentState,
    allowedOrigins: () => [...applicationOrigins],
    ...(agentProvider ? { agentProvider } : {}),
  });
  await daemon?.start();
  const developmentEnvironment = daemon ? {
    APPLIK8S_DEV_PORTAL_ORIGIN: daemon.origin,
    APPLIK8S_DEV_BRIDGE_TOKEN: daemon.bridgeToken,
    APPLIK8S_DEV_REVISION: projectDigest,
  } : undefined;
  if (daemon) {
    applicationOrigins.add(daemon.origin);
    applicationOrigins.add(daemon.origin.replace('127.0.0.1', 'localhost'));
    io.stdout(`Independent Applik8s Builder portal: ${daemon.origin}`);
  }
  const abort = new AbortController();
  const stop = (): void => abort.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const outDir = options.outDir ?? '.applik8s/local-build';
  const previousDevelopmentEnvironment = developmentEnvironment
    ? Object.fromEntries(Object.keys(developmentEnvironment).map((name) => [name, process.env[name]]))
    : undefined;
  if (developmentEnvironment) Object.assign(process.env, developmentEnvironment);
  try {
    const buildCode = await runtime.runBuild(entrypoint, {
      outDir,
      typekro: true,
      compositionName: options.compositionName ?? configuration.compositionName ?? 'app',
      localDevelopment: true,
      executionTarget: target,
    }, io);
    if (buildCode !== 0) {
      developmentState.application = { state: 'failed', message: `Application compilation failed with exit code ${buildCode}. Fix source while the Builder portal remains available.` };
      if (!daemon) return buildCode;
      io.stderr(`Application compilation failed; Builder remains available at ${daemon.origin}. Press Ctrl-C to stop.`);
      await waitForAbort(abort.signal);
      return buildCode;
    }
    const graphPath = resolve(io.cwd, outDir, 'typekro', 'application-graph.json');
    const graph = await readApplicationGraph(graphPath);
    const bundlePath = resolve(io.cwd, outDir, 'typekro', 'typekro-composition.json');
    const runtimeArtifacts = await readLocalRuntimeArtifacts(
      bundlePath,
      resolve(io.cwd, outDir),
      target,
    );
    const applicationHostFrameworkCredentials = await readLocalApplicationHostFrameworkCredentials(bundlePath);
    const installationSpec = await configuredInstallationSpec(
      configuration.instance ? resolve(io.cwd, configuration.instance) : undefined,
    );
    const profile = options.profile
      ?? (typeof installationSpec?.profile === 'string' && installationSpec.profile.trim()
        ? installationSpec.profile
        : undefined)
      ?? 'starter';
    const generatedSecrets = installationSpec
      ? await applicationGeneratedSecretRequirements(
          bundlePath,
          graph.metadata.namespace,
          graph,
          installationSpec,
        )
      : [];
    const applicationPackage = await resolveApplicationBuildPackage(applicationEntrypoint);
    const plan = compileLocalSupervisorPlan({
      graph,
      target,
      profile,
      projectDigest,
      projectDirectory: applicationPackage.directory,
      runtimeArtifacts,
      applicationHostFrameworkCredentials,
      generatedSecrets,
      localResourceAuthorityModule: fileURLToPath(import.meta.resolve('@applik8s/server/local-resource-authority-process')),
      ...(installationSpec ? { installationSpec } : {}),
      ...(options.allowDockerSocket ? { allowDockerSocket: true } : {}),
    });
    const validation = validateLocalSupervisorPlan(plan);
    const planPath = resolve(io.cwd, outDir, 'local-supervisor-plan.json');
    await mkdir(dirname(planPath), { recursive: true });
    await writeFile(planPath, serializeLocalSupervisorPlan(plan));
    io.stdout(`Local supervisor plan: ${planPath}`);
    if (!validation.valid) {
      for (const diagnostic of validation.diagnostics) io.stderr(`${diagnostic.code}: ${diagnostic.message}`);
      developmentState.application = { state: 'failed', message: validation.diagnostics.map(({ message }) => message).join(' ') };
      if (!daemon) return 1;
      await waitForAbort(abort.signal);
      return 1;
    }
    const applicationPlanPath = resolve(io.cwd, outDir, 'application-plan.json');
    const applicationPlan = compileLocalApplicationPlan({ graph, supervisor: plan, workspaceRoot: projectRoot });
    await writeFile(applicationPlanPath, serializeApplicationPlan(applicationPlan));
    io.stdout(`Canonical application plan: ${applicationPlanPath}`);

    const awsLocalPlan = target === 'aws-local'
      ? compileApplicationAwsDeploymentPlan({
          graph,
          environment: profile,
          profile,
          region: 'us-east-1',
          accountId: '000000000001',
          target: 'aws-local',
          includeApplicationHosts: false,
          ...(installationSpec ? { installationSpec } : {}),
        })
      : undefined;
    if (awsLocalPlan) {
      const awsPlanPath = resolve(io.cwd, outDir, 'aws-local-plan.json');
      await writeFile(awsPlanPath, serializeApplicationAwsDeploymentPlan(awsLocalPlan));
      await mkdir(stateDirectory, { recursive: true });
      await writeFile(resolve(stateDirectory, 'aws-local-plan.json'), serializeApplicationAwsDeploymentPlan(awsLocalPlan), { mode: 0o600 });
      io.stdout(`AWS-local target plan: ${awsPlanPath}`);
    }
    developmentState.evidence = developmentApplicationEvidence({
      graph,
      applicationPlan,
      localPlanResources: plan.resources.length,
      target,
      projectRoot,
      applicationPlanPath,
      targetPlanPath: target === 'aws-local'
        ? resolve(io.cwd, outDir, 'aws-local-plan.json')
        : planPath,
      ...(awsLocalPlan ? { awsLocalResources: awsLocalPlan.resources.length } : {}),
    });

    developmentState.runtime = { state: 'degraded', message: 'Starting declared local providers and application processes.' };
    let awsDeployment: ApplicationAwsDeployment | undefined;
    const session = await startLocalSupervisor(plan, io, {
      ...runtime.supervisor,
      stateRoot: stateDirectory,
      signal: abort.signal,
      ...(awsLocalPlan ? {
        lifecycle: {
          async resourceReady(resource, context) {
            if (resource.id !== 'target:ministack') return;
            const endpoint = context.bindings['endpoint:target:ministack:aws'];
            if (typeof endpoint !== 'string') throw new Error('MiniStack became ready without its AWS endpoint binding.');
            awsDeployment = createApplicationAwsDeployment({
              plan: awsLocalPlan,
              endpoint,
              stateRoot: resolve(stateDirectory, 'aws-state'),
              dev: true,
            });
            const applied = await awsDeployment.apply();
            const resolved: Record<string, string | number> = {};
            for (const targetResource of awsLocalPlan.resources) {
              for (const output of targetResource.outputs) {
                const value = applied.aws.directOutputs[targetResource.id]?.[output.name]
                  ?? applied.aws.outputs[applicationAwsOutputKey(targetResource.id, output.name)];
                if (value !== undefined) resolved[awsLocalOutputBindingId(targetResource.id, output.name)] = value;
              }
            }
            for (const binding of awsLocalPlan.runtimeBindings) {
              const targetResource = awsLocalPlan.resources.find(({ id }) => id === binding.resourceId);
              if (!targetResource) throw new Error(`AWS-local runtime binding ${binding.id} references missing resource ${binding.resourceId}.`);
              const output = (name: string): string | number | undefined => applied.aws.directOutputs[targetResource.id]?.[name]
                ?? applied.aws.outputs[applicationAwsOutputKey(targetResource.id, name)];
              const host = output('endpoint');
              const port = output('port');
              const secretArn = output('secretArn');
              if (typeof host !== 'string' || (typeof port !== 'string' && typeof port !== 'number') || typeof secretArn !== 'string') throw new Error(`AWS-local runtime binding ${binding.id} is missing endpoint, port, or secret reference output.`);
              resolved[awsLocalRuntimeBindingId(binding.id)] = JSON.stringify({ kind: binding.kind, environmentName: binding.environmentName, database: binding.database, host, port: Number(port), secretArn });
            }
            const missing = plan.bindings.filter(({ kind, id }) => kind === 'targetOutput' && resolved[id] === undefined);
            if (missing.length > 0) throw new Error(`AWS-local reconciliation omitted required target outputs: ${missing.map(({ id }) => id).join(', ')}`);
            io.stdout(`AWS-local resources reconciled through Alchemy (${awsLocalPlan.resources.length} resources).`);
            return resolved;
          },
          async beforeReset() {
            if (awsDeployment) await awsDeployment.destroy();
          },
        },
      } : {}),
    });
    developmentState.runtime = { state: 'ready', message: `${session.state.resources.length} supervised resources are healthy.` };
    developmentState.application = { state: 'ready', message: 'The compiled application and its declared dependencies are ready.' };
    const applicationProcess = plan.resources.find(({ id, kind }) => kind === 'process' && id.startsWith('process:'));
    const applicationEndpoint = applicationProcess
      ? plan.bindings.find(({ owner, kind }) => owner === applicationProcess.id && kind === 'endpoint')
      : undefined;
    const url = applicationEndpoint ? session.state.bindings[applicationEndpoint.id] : undefined;
    if (typeof url === 'string') applicationOrigins.add(new URL(url).origin);
    io.stdout(`Local application ready${url ? ` at ${url}` : ''}. Press Ctrl-C to stop; retained provider volumes survive restarts.`);
    await waitForAbort(abort.signal);
    await session.stop();
    return 0;
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    await daemon?.stop();
    if (previousDevelopmentEnvironment) for (const [name, value] of Object.entries(previousDevelopmentEnvironment)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
}

function developmentApplicationEvidence(input: {
  readonly graph: ApplicationGraph;
  readonly applicationPlan: ApplicationPlan;
  readonly localPlanResources: number;
  readonly target: LocalSupervisorTarget;
  readonly projectRoot: string;
  readonly applicationPlanPath: string;
  readonly targetPlanPath: string;
  readonly awsLocalResources?: number;
}): DevelopmentApplicationEvidence {
  const unresolved = input.applicationPlan.resolution.capabilities.filter(({ disposition }) =>
    disposition === 'unresolved' || disposition === 'incompatible');
  const gaps = input.applicationPlan.resolution.capabilities.reduce((total, capability) => total + capability.gaps.length, 0);
  const executionIdentities = [...new Set(input.applicationPlan.semantic.runtimeAccess.map(({ consumer }) => consumer.executionIdentity))].sort();
  const localTarget = {
    target: input.target,
    lifecycleAuthority: input.target === 'local' ? 'local-supervisor' : 'alchemy',
    resources: input.target === 'aws-local' ? input.awsLocalResources ?? 0 : input.localPlanResources,
    status: 'materialized' as const,
  };
  return {
    schemaVersion: 'applik8s.developmentEvidence/v1alpha1',
    sourceDigest: input.applicationPlan.sourceDigest,
    artifacts: {
      applicationPlan: portableDevelopmentPath(input.applicationPlanPath, input.projectRoot),
      targetPlan: portableDevelopmentPath(input.targetPlanPath, input.projectRoot),
    },
    semantic: {
      nodes: input.applicationPlan.semantic.nodes.length,
      executions: input.applicationPlan.semantic.executions.length,
      authorityGrants: input.applicationPlan.semantic.authority.length,
      dataFlows: input.applicationPlan.semantic.dataFlows.length,
      stateAuthorities: input.applicationPlan.semantic.state.length,
      exposures: input.applicationPlan.semantic.exposures.length,
    },
    providers: {
      total: input.applicationPlan.resolution.capabilities.length,
      resolved: input.applicationPlan.resolution.capabilities.length - unresolved.length,
      unresolved: unresolved.length,
      gaps,
    },
    runtimeAccess: {
      requirements: input.applicationPlan.semantic.runtimeAccess.length,
      executionIdentities,
    },
    telemetry: input.applicationPlan.semantic.observability.map(({ subject, signals, collector, export: exportTarget }) => ({
      subject,
      signals,
      collector,
      export: exportTarget,
    })),
    schedules: input.graph.nodes.flatMap((node) => node.kind === 'schedule'
      ? [{ id: node.definition.id, configuration: node.definition.configuration }]
      : []),
    datasets: input.graph.nodes.flatMap((node) => node.kind === 'lakehousePublication'
      ? [{ id: node.id, event: node.sourceEventId }]
      : []),
    actors: input.graph.nodes.flatMap((node) => node.kind === 'actor'
      ? [{
          id: node.definition.id,
          published: node.publication?.boundary === 'entrypoint-export',
          realtime: node.definition.requirements.realtimeConnections,
        }]
      : []),
    targetPlans: [
      localTarget,
      ...(input.target === 'local' ? [{ target: 'aws-local', lifecycleAuthority: 'alchemy', resources: 0, status: 'available-on-demand' as const }] : []),
      { target: 'aws', lifecycleAuthority: 'alchemy', resources: 0, status: 'external-evidence-required' as const },
      { target: 'kubernetes', lifecycleAuthority: 'alchemy/typekro', resources: 0, status: 'available-on-demand' as const },
    ],
    diagnostics: {
      errors: input.applicationPlan.diagnostics.filter(({ severity }) => severity === 'error').length,
      warnings: input.applicationPlan.diagnostics.filter(({ severity }) => severity === 'warning').length,
    },
  };
}

function portableDevelopmentPath(path: string, root: string): string {
  const value = relative(root, path);
  return value && !value.startsWith('..') ? value : path;
}

async function resetAwsLocalDeployment(
  stateDirectory: string,
  io: LocalSupervisorIo,
  runtime: LocalDevelopmentCommandRuntime,
): Promise<void> {
  const state = await readLocalSupervisorStatus(stateDirectory);
  const planPath = resolve(stateDirectory, 'aws-local-plan.json');
  const plan = await readAwsLocalPlan(planPath);
  if (!state && !plan) return;
  if (!state || !plan) {
    throw new Error(
      `AWS-local reset cannot prove its lifecycle authority at ${stateDirectory}: both supervisor state and aws-local-plan.json are required. Preserve the directory for inspection.`,
    );
  }
  if (state.target !== 'aws-local') throw new Error(`AWS-local reset found incompatible supervisor target ${state.target}.`);
  const target = state.resources.find(({ resourceId }) => resourceId === 'target:ministack' && resourceId && runtimeIdIsContainer(state, 'target:ministack'));
  if (!target) throw new Error('AWS-local reset cannot find the retained MiniStack container identity in supervisor state.');
  const endpoint = state.bindings['endpoint:target:ministack:aws'];
  if (typeof endpoint !== 'string') throw new Error('AWS-local reset cannot find the retained MiniStack endpoint binding.');
  await (runtime.resumeAwsLocalTarget ?? resumeAwsLocalTarget)(target.runtimeId, endpoint);
  const deployment = createApplicationAwsDeployment({
    plan,
    endpoint,
    stateRoot: resolve(stateDirectory, 'aws-state'),
    dev: true,
  });
  await deployment.destroy();
  io.stdout(`Destroyed ${plan.resources.length} AWS-local resources through Alchemy before supervisor reset.`);
}

interface LocalRuntimeBundleEntry {
  readonly name: string;
  readonly nodeId: string;
  readonly source: string;
  readonly digest: string;
  readonly localSource?: string;
  readonly localDigest?: string;
  readonly container?: ApplicationLocalRuntimeArtifact['container'];
  readonly runtimeEndpoints?: ApplicationLocalRuntimeArtifact['runtimeEndpoints'];
  readonly frameworkCredentials?: ApplicationLocalRuntimeArtifact['frameworkCredentials'];
}

/**
 * Treats compiler output as an untrusted hand-off even though it is produced in
 * the same command. Only digest-verified entrypoints inside the build root may
 * become supervised processes.
 */
export async function readLocalRuntimeArtifacts(
  manifestPath: string,
  buildRoot: string,
  target: 'local' | 'aws-local' | 'aws' | 'kubernetes' = 'local',
): Promise<readonly ApplicationLocalRuntimeArtifact[]> {
  const manifest = jsonRecord(JSON.parse(await readFile(manifestPath, 'utf8')));
  if (manifest?.apiVersion !== 'applik8s.dev/v1alpha1' || manifest.kind !== 'TypeKroCompositionBundle') {
    throw new Error(`Compiler bundle ${manifestPath} has an unsupported schema.`);
  }
  const spec = jsonRecord(manifest.spec);
  if (!spec) throw new Error(`Compiler bundle ${manifestPath} has no spec object.`);
  const groups = [
    ['processors', 'processor'],
    ['lakehousePublishers', 'lakehouse'],
    ['workflows', 'workflow'],
    ['reactive', 'reactive'],
    ['agents', 'agent'],
    ['http', 'http'],
    ['mcp', 'mcp'],
  ] as const;
  const artifacts: ApplicationLocalRuntimeArtifact[] = [];
  const identities = new Set<string>();
  for (const [field, role] of groups) {
    const raw = spec[field];
    if (raw === undefined) continue;
    if (!Array.isArray(raw)) throw new Error(`Compiler bundle ${manifestPath} field spec.${field} must be an array.`);
    for (const [index, value] of raw.entries()) {
      const entry = localRuntimeBundleEntry(value, field, index);
      const selectedSource = target === 'local' && entry.localSource ? entry.localSource : entry.source;
      const expectedDigest = target === 'local' && entry.localDigest ? entry.localDigest : entry.digest;
      const source = isAbsolute(selectedSource) ? resolve(selectedSource) : resolve(dirname(manifestPath), selectedSource);
      assertPathInside(source, buildRoot, `${field}[${index}].source`);
      const actualDigest = `sha256:${createHash('sha256').update(await readFile(source)).digest('hex')}` as const;
      if (actualDigest !== expectedDigest) {
        throw new Error(`Compiler runtime artifact ${entry.nodeId} digest mismatch: expected ${expectedDigest}, received ${actualDigest}.`);
      }
      const container = entry.container ? {
        ...entry.container,
        contextPath: isAbsolute(entry.container.contextPath) ? resolve(entry.container.contextPath) : resolve(dirname(manifestPath), entry.container.contextPath),
        dockerfilePath: isAbsolute(entry.container.dockerfilePath) ? resolve(entry.container.dockerfilePath) : resolve(dirname(manifestPath), entry.container.dockerfilePath),
      } : undefined;
      if (container) {
        assertPathInside(container.contextPath, buildRoot, `${field}[${index}].container.contextPath`);
        assertPathInside(container.dockerfilePath, buildRoot, `${field}[${index}].container.dockerfilePath`);
      }
      const identity = `${role}:${entry.nodeId}`;
      if (identities.has(identity)) throw new Error(`Compiler bundle ${manifestPath} repeats runtime artifact ${identity}.`);
      identities.add(identity);
      const artifact: ApplicationLocalRuntimeArtifact = {
        name: entry.name,
        nodeId: entry.nodeId,
        role,
        source,
        digest: actualDigest,
        ...(container ? { container } : {}),
        ...(entry.runtimeEndpoints?.length ? { runtimeEndpoints: entry.runtimeEndpoints } : {}),
        ...(entry.frameworkCredentials?.length ? { frameworkCredentials: entry.frameworkCredentials } : {}),
      };
      const artifactErrors = validateApplicationRuntimeArtifact(artifact);
      if (artifactErrors.length > 0) {
        throw new Error(`Compiler bundle entry spec.${field}[${index}] is invalid: ${artifactErrors.join('; ')}.`);
      }
      artifacts.push(artifact);
    }
  }
  const rawOperators = spec.operators;
  if (rawOperators !== undefined) {
    if (!Array.isArray(rawOperators)) throw new Error(`Compiler bundle ${manifestPath} field spec.operators must be an array.`);
    for (const [index, value] of rawOperators.entries()) {
      const entry = jsonRecord(value);
      if (!entry || typeof entry.name !== 'string' || !entry.name.trim() || typeof entry.manifest !== 'string' || !entry.manifest.trim()) throw new Error(`Compiler bundle entry spec.operators[${index}] is incomplete or invalid.`);
      const operatorManifest = isAbsolute(entry.manifest) ? resolve(entry.manifest) : resolve(dirname(manifestPath), entry.manifest);
      assertPathInside(operatorManifest, buildRoot, `operators[${index}].manifest`);
      const parsed = jsonRecord(JSON.parse(await readFile(operatorManifest, 'utf8')));
      const operatorSpec = jsonRecord(parsed?.spec);
      const bundle = jsonRecord(operatorSpec?.bundle);
      const inventory = bundle?.artifacts;
      if (!Array.isArray(inventory)) throw new Error(`Compiler operator manifest ${operatorManifest} has no artifact inventory.`);
      const javascript = inventory.map(jsonRecord).find((artifact) => artifact?.kind === 'javascript-bundle');
      if (!javascript || typeof javascript.path !== 'string' || typeof javascript.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(javascript.digest)) throw new Error(`Compiler operator manifest ${operatorManifest} has no valid JavaScript dispatcher artifact.`);
      const source = isAbsolute(javascript.path) ? resolve(javascript.path) : resolve(dirname(operatorManifest), javascript.path);
      assertPathInside(source, buildRoot, `operators[${index}].source`);
      const actualDigest = `sha256:${createHash('sha256').update(await readFile(source)).digest('hex')}` as const;
      if (actualDigest !== javascript.digest) throw new Error(`Compiler operator artifact ${entry.name} digest mismatch: expected ${javascript.digest}, received ${actualDigest}.`);
      const identity = `operator:${entry.name}`;
      if (identities.has(identity)) throw new Error(`Compiler bundle ${manifestPath} repeats runtime artifact ${identity}.`);
      identities.add(identity);
      artifacts.push({ name: entry.name, nodeId: `operator.${entry.name}`, role: 'operator', source, manifest: operatorManifest, digest: actualDigest });
    }
  }
  return artifacts.sort((left, right) => `${left.role}:${left.nodeId}`.localeCompare(`${right.role}:${right.nodeId}`));
}

export async function readLocalApplicationHostFrameworkCredentials(
  manifestPath: string,
): Promise<NonNullable<ApplicationLocalRuntimeArtifact['frameworkCredentials']>> {
  const manifest = jsonRecord(JSON.parse(await readFile(manifestPath, 'utf8')));
  if (manifest?.apiVersion !== 'applik8s.dev/v1alpha1' || manifest.kind !== 'TypeKroCompositionBundle') {
    throw new Error(`Compiler bundle ${manifestPath} has an unsupported schema.`);
  }
  const spec = jsonRecord(manifest.spec);
  if (!spec) throw new Error(`Compiler bundle ${manifestPath} has no spec object.`);
  if (spec.applicationHost === undefined) return [];
  const host = jsonRecord(spec.applicationHost);
  if (!host || typeof host.nodeId !== 'string' || !host.nodeId.trim()) {
    throw new Error(`Compiler bundle ${manifestPath} field spec.applicationHost is incomplete or invalid.`);
  }
  return localRuntimeFrameworkCredentialDependencies(
    host.frameworkCredentials,
    'applicationHost',
    0,
  );
}

function localRuntimeBundleEntry(value: unknown, field: string, index: number): LocalRuntimeBundleEntry {
  const entry = jsonRecord(value);
  if (!entry) throw new Error(`Compiler bundle entry spec.${field}[${index}] must be an object.`);
  const nodeId = typeof entry.nodeId === 'string' ? entry.nodeId : typeof entry.serverId === 'string' ? entry.serverId : undefined;
  if (typeof entry.name !== 'string' || !entry.name.trim() || !nodeId?.trim() || typeof entry.source !== 'string' || !entry.source.trim() || typeof entry.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(entry.digest)) {
    throw new Error(`Compiler bundle entry spec.${field}[${index}] is incomplete or invalid.`);
  }
  const hasLocalSource = entry.localSource !== undefined;
  const hasLocalDigest = entry.localDigest !== undefined;
  if (hasLocalSource !== hasLocalDigest) {
    throw new Error(`Compiler bundle entry spec.${field}[${index}] must declare localSource and localDigest together.`);
  }
  if (hasLocalSource && (
    typeof entry.localSource !== 'string'
    || !entry.localSource.trim()
    || typeof entry.localDigest !== 'string'
    || !/^sha256:[a-f0-9]{64}$/u.test(entry.localDigest)
  )) {
    throw new Error(`Compiler bundle entry spec.${field}[${index}] has an invalid local runtime artifact.`);
  }
  return {
    name: entry.name,
    nodeId,
    source: entry.source,
    digest: entry.digest,
    ...(hasLocalSource ? { localSource: entry.localSource as string, localDigest: entry.localDigest as string } : {}),
    ...(entry.runtimeEndpoints !== undefined
      ? { runtimeEndpoints: localRuntimeEndpointDependencies(entry.runtimeEndpoints, field, index) }
      : {}),
    ...(entry.frameworkCredentials !== undefined
      ? { frameworkCredentials: localRuntimeFrameworkCredentialDependencies(entry.frameworkCredentials, field, index) }
      : {}),
    ...(entry.container ? { container: localRuntimeContainerArtifact(entry.container, field, index) } : {}),
  };
}

function localRuntimeFrameworkCredentialDependencies(
  value: unknown,
  field: string,
  index: number,
): NonNullable<ApplicationLocalRuntimeArtifact['frameworkCredentials']> {
  if (!Array.isArray(value)) throw new Error(`Compiler bundle entry spec.${field}[${index}].frameworkCredentials must be an array.`);
  const supported = new Set([
    'agent-query-context',
    'context',
    'cursor',
    'http-context',
    'internal-operation',
    'local-resource',
    'task-operation-context',
    'task-query-context',
  ]);
  const credentials = value.map((candidate, credentialIndex) => {
    const credential = jsonRecord(candidate);
    if (!credential || typeof credential.kind !== 'string' || !supported.has(credential.kind) || typeof credential.environmentName !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(credential.environmentName)) {
      throw new Error(`Compiler bundle entry spec.${field}[${index}].frameworkCredentials[${credentialIndex}] is incomplete or invalid.`);
    }
    return {
      kind: credential.kind as NonNullable<ApplicationLocalRuntimeArtifact['frameworkCredentials']>[number]['kind'],
      environmentName: credential.environmentName,
    };
  });
  if (new Set(credentials.map(({ environmentName }) => environmentName)).size !== credentials.length) {
    throw new Error(`Compiler bundle entry spec.${field}[${index}].frameworkCredentials repeats an environment name.`);
  }
  return credentials;
}

function localRuntimeEndpointDependencies(
  value: unknown,
  field: string,
  index: number,
): NonNullable<ApplicationLocalRuntimeArtifact['runtimeEndpoints']> {
  if (!Array.isArray(value)) throw new Error(`Compiler bundle entry spec.${field}[${index}].runtimeEndpoints must be an array.`);
  const endpoints = value.map((candidate, endpointIndex) => {
    const endpoint = jsonRecord(candidate);
    if (!endpoint || typeof endpoint.nodeId !== 'string' || !endpoint.nodeId.trim() || typeof endpoint.environmentName !== 'string' || !endpoint.environmentName.trim()) {
      throw new Error(`Compiler bundle entry spec.${field}[${index}].runtimeEndpoints[${endpointIndex}] is incomplete or invalid.`);
    }
    return { nodeId: endpoint.nodeId, environmentName: endpoint.environmentName };
  });
  if (new Set(endpoints.map(({ environmentName }) => environmentName)).size !== endpoints.length) {
    throw new Error(`Compiler bundle entry spec.${field}[${index}].runtimeEndpoints repeats an environment name.`);
  }
  return endpoints;
}

function localRuntimeContainerArtifact(value: unknown, field: string, index: number): NonNullable<ApplicationLocalRuntimeArtifact['container']> {
  const container = jsonRecord(value);
  const command = container?.command;
  const required = ['image', 'imageName', 'tag', 'baseImage', 'contextPath', 'dockerfilePath', 'entrypoint', 'sourceDigest'] as const;
  if (!container || required.some((key) => typeof container[key] !== 'string' || !(container[key] as string).trim()) || !Array.isArray(command) || command.length === 0 || command.some((entry) => typeof entry !== 'string')) {
    throw new Error(`Compiler bundle entry spec.${field}[${index}].container is incomplete or invalid.`);
  }
  if (!/^sha256:[a-f0-9]{64}$/u.test(container.sourceDigest as string)) throw new Error(`Compiler bundle entry spec.${field}[${index}].container.sourceDigest is invalid.`);
  return {
    image: container.image as string,
    imageName: container.imageName as string,
    tag: container.tag as string,
    baseImage: container.baseImage as string,
    contextPath: container.contextPath as string,
    dockerfilePath: container.dockerfilePath as string,
    entrypoint: container.entrypoint as string,
    command: command as string[],
    sourceDigest: container.sourceDigest as `sha256:${string}`,
  };
}

function assertPathInside(path: string, root: string, label: string): void {
  const normalizedRoot = resolve(root);
  const candidate = relative(normalizedRoot, path);
  if (candidate === '' || (!candidate.startsWith('..') && !isAbsolute(candidate))) return;
  throw new Error(`Compiler bundle ${label} escapes its build root: ${path}.`);
}

function jsonRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function runtimeIdIsContainer(state: NonNullable<Awaited<ReturnType<typeof readLocalSupervisorStatus>>>, resourceId: string): boolean {
  return state.resources.some((resource) => resource.resourceId === resourceId && resource.kind === 'container');
}

async function readAwsLocalPlan(path: string): Promise<ApplicationAwsDeploymentPlan | undefined> {
  if (!await access(path).then(() => true).catch(() => false)) return undefined;
  const plan = JSON.parse(await readFile(path, 'utf8')) as ApplicationAwsDeploymentPlan;
  if (plan.apiVersion !== 'applik8s.awsPlan/v1alpha1') throw new Error(`Persisted AWS-local plan ${path} has an unsupported schema.`);
  const diagnostics = validateApplicationAwsDeploymentPlan(plan).filter(({ severity }) => severity === 'error');
  if (diagnostics.length > 0) throw new Error(`Persisted AWS-local plan ${path} is invalid: ${diagnostics.map(({ message }) => message).join(' ')}`);
  return plan;
}

async function resumeAwsLocalTarget(runtimeId: string, endpoint: string): Promise<void> {
  await runResetCommand('docker', ['start', runtimeId]);
  const health = `${endpoint.replace(/\/$/u, '')}/_ministack/health`;
  const deadline = Date.now() + 60_000;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(health, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
      last = new Error(`HTTP ${response.status}`);
    } catch (cause) {
      last = cause;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`Retained MiniStack container ${runtimeId} did not recover for reset: ${last instanceof Error ? last.message : String(last)}`);
}

async function runResetCommand(command: string, args: readonly string[]): Promise<void> {
  await new Promise<void>((resolveCommand, reject) => {
    const child = spawn(command, [...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    const stderr: Buffer[] = [];
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => code === 0
      ? resolveCommand()
      : reject(new Error(`${command} ${args.join(' ')} failed: ${Buffer.concat(stderr).toString('utf8').trim()}`)));
  });
}

async function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolveStop) => signal.addEventListener('abort', () => resolveStop(), { once: true }));
}

async function readApplicationGraph(path: string): Promise<ApplicationGraph> {
  const candidate = JSON.parse(await readFile(path, 'utf8')) as ApplicationGraph;
  if (candidate.apiVersion !== 'applik8s.appGraph/v1alpha1' || candidate.kind !== 'ApplicationGraph' || !Array.isArray(candidate.nodes)) {
    throw new Error(`Generated local application graph ${path} is invalid.`);
  }
  return candidate;
}

async function configuredInstallationSpec(instancePath: string | undefined): Promise<DeploymentJsonObject | undefined> {
  if (!instancePath || !await access(instancePath).then(() => true).catch(() => false)) return undefined;
  const candidate = parseYaml(await readFile(instancePath, 'utf8')) as unknown;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
  const spec = Reflect.get(candidate, 'spec');
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return undefined;
  return spec as DeploymentJsonObject;
}

function safeProjectDigest(projectDigest: string): string {
  return createHash('sha256').update(projectDigest).digest('hex').slice(0, 24);
}
