#!/usr/bin/env node
// typecast-file-boundary: CLI boundaries validate dynamic imports, JSON, Kubernetes objects, and TypeKro receipts before invoking their typed contracts.
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { access, mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import * as http from 'node:http';
import * as https from 'node:https';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ApplicationGraph, KubernetesConnectionBinding } from '@applik8s/core';
import { type } from 'arktype';
import { Command, CommanderError } from 'commander';
import { createResource, externalRef, toResourceGraph } from 'typekro';
import { parse, parseAllDocuments, stringify } from 'yaml';
import {
  type ApplicationDeploymentReceiptScope,
  applicationDeploymentReceiptPath,
  existingApplicationDeploymentReceiptPath,
  unlinkApplicationDeploymentReceipt,
} from './application-deployment-receipts.js';
import { resolveApplicationInstallationValues } from './application-installation-values.js';
import {
  type ApplicationKroProviderMigrationReceipt,
  migrateApplicationKroOwnedProviderData,
} from './application-kro-provider-migration.js';
import { createKubernetesKroProviderMigrationRuntime } from './application-kro-provider-migration-kubernetes.js';
import {
  type ApplicationProviderPreparationReceipt,
  type ApplicationProviderPreparationRuntime,
  deleteApplicationProviderPrerequisites,
  prepareApplicationProviderPrerequisites,
  retainedApplicationProviderNamespaces,
} from './application-provider-preparation.js';
import type {
  ApplicationContainerRegistryEndpoint,
  ApplicationContainerRegistryProvider,
  ApplicationContainerRegistryTls,
} from './application-providers.js';
import { applicationPostgresClusterPreparation } from './application-postgres-preparation.js';
import { assertSafeManagedPostgresClusterUpdate } from './application-postgres-contract.js';
import { applicationValkeyClusterPreparation } from './application-valkey-preparation.js';
import {
  type ApplicationImageReceipt,
  applicationContainerRegistryFromGraph,
  applicationImageEvidence,
  materializeApplicationImages,
  type ResolvedApplicationContainerRegistry,
  resolveApplicationContainerRegistry,
  validateApplicationImageReceipts,
  validateApplicationPullSecretCoverage,
} from './container-deployment-plan.js';
import {
  type ApplicationContainerRegistryPreparationReceipt,
  type ApplicationContainerRegistryPreparationRuntime,
  type ApplicationDirectNamespacePreparationReceipt,
  type ApplicationHarborProjectPreparationRequest,
  deleteApplicationContainerRegistryPreparation,
  prepareApplicationContainerRegistry,
} from './container-registry-preparation.js';
import { makeKubernetesApiClient } from './kubernetes-api-client.js';

interface CliIo {
  readonly cwd: string;
  stdout(message: string): void;
  stderr(message: string): void;
}

interface BuildCommandOptions {
  readonly outDir?: string;
  readonly operatorName?: string;
  readonly typekro?: boolean;
  readonly compositionName?: string;
  readonly connectionBindings?: string;
}

interface DeployCommandOptions extends BuildCommandOptions {
  readonly context: string;
  readonly instance?: string;
  readonly skipAppBuild?: boolean;
  readonly skipImageBuild?: boolean;
  readonly migrateKroOwnedProviderData?: boolean;
  readonly confirmLegacyTypekroNodeFetchManager?: boolean;
}

export interface DeleteCommandOptions {
  readonly context: string;
  readonly outDir?: string;
  readonly compositionName?: string;
  readonly instanceName?: string;
  readonly controlPlaneNamespace?: string;
  readonly keepDirectPreparation?: boolean;
}

interface ChildProcessOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly input?: string;
  readonly stdio?: 'inherit' | 'ignore';
}

type ApplicationDeploymentPhase =
  | 'application-build'
  | 'composition-compile'
  | 'instance-selection'
  | 'registry-resolution'
  | 'registry-preparation'
  | 'pull-secret-verification'
  | 'provider-ownership-migration'
  | 'provider-preparation'
  | 'image-publication'
  | 'artifact-materialization'
  | 'runtime-preparation'
  | 'typekro-apply'
  | 'authoritative-readiness'
  | 'exposure-verification';

const applicationDeploymentPhaseRemediation: Readonly<Record<ApplicationDeploymentPhase, string>> = {
  'application-build': 'Run the application package build directly and fix its first reported error.',
  'composition-compile': 'Run applik8s build --typekro and inspect the compiler diagnostic and generated artifact paths.',
  'instance-selection': 'Provide exactly one authored root Application CR with --instance <path>.',
  'registry-resolution': 'Verify the selected Kubernetes context, registry Service/NodePort, and provider endpoint.',
  'registry-preparation': 'Verify Harbor readiness, admin Secret coordinates, project policy, and robot Secret namespace.',
  'pull-secret-verification': 'Ensure a kubernetes.io/dockerconfigjson pull Secret exists in every authored workload namespace.',
  'provider-ownership-migration': 'Keep every affected KRO instance suspended, repair the reported ownership conflict, and rerun with --migrate-kro-owned-provider-data; never delete the stateful provider object.',
  'provider-preparation': 'Inspect the selected provider prerequisites and their TypeKro direct/shared ownership evidence.',
  'image-publication': 'Inspect the named workload build, registry authentication/TLS, and the TypeKro container error.',
  'artifact-materialization': 'Inspect image receipts and generated resources; every authored image must resolve to one verified digest.',
  'runtime-preparation': 'Inspect direct preparation ownership and the ApplicationHost cursor Secret prerequisites.',
  'typekro-apply': 'Inspect the generated TypeKro resources and root instance status; retry only after the failing child is healthy.',
  'authoritative-readiness': 'Inspect the root Application status conditions and the pending provider/workload named by its status projection.',
  'exposure-verification': 'Inspect the root Application status URL, the selected HTTP exposure provider, and the externally reachable Service, Ingress, DNS, and certificate path.',
};

export async function runCli(args: readonly string[], io: CliIo = defaultIo()): Promise<number> {
  const program = createProgram(io);
  try {
    await program.parseAsync(args, { from: 'user' });
    return 0;
  } catch (cause) {
    if (cause instanceof CommanderError) {
      return cause.exitCode;
    }
    io.stderr(cause instanceof Error ? cause.message : String(cause));
    return 1;
  }
}

function createProgram(io: CliIo): Command {
  const program = new Command();
  program
    .name('applik8s')
    .description('Thin applik8s wrappers over compiler, diagnostics, replay, and tests.')
    .showHelpAfterError()
    .exitOverride()
    .configureOutput({
      writeOut: (message) => io.stdout(trimTrailingNewline(message)),
      writeErr: (message) => io.stderr(trimTrailingNewline(message)),
    });

  program
    .command('build')
    .description('Compile an operator entrypoint into applik8s artifacts.')
    .argument('<entrypoint>', 'operator entrypoint module')
    .option('--out-dir <dir>', 'output directory')
    .option('--operator-name <name>', 'operator export name when the entrypoint exports more than one operator')
    .option('--typekro', 'compile an exported applik8s TypeKro composition instead of a single operator')
    .option('--composition-name <name>', 'TypeKro composition export name when the entrypoint exports more than one composition')
    .option('--connection-bindings <path>', 'JSON connection bindings (alias map, or operator-to-alias map with --typekro)')
    .action(async (entrypoint: string, options: BuildCommandOptions) => {
      const code = await runBuild(entrypoint, options, io);
      if (code !== 0) {
        throw new CommanderError(code, 'applik8s.build.failed', 'Build failed.');
      }
    });

  program
    .command('deploy')
    .description('Build a complete TypeKro application and deploy its generated root instance to an explicit Kubernetes context.')
    .argument('<entrypoint>', 'application entrypoint module')
    .requiredOption('--context <context>', 'explicit kubeconfig context')
    .option('--out-dir <dir>', 'output directory', '.applik8s/deploy')
    .option('--composition-name <name>', 'TypeKro composition export name', 'app')
    .option('--connection-bindings <path>', 'JSON operator-to-alias connection bindings')
    .option('--instance <path>', 'explicit Application instance YAML; defaults to the one matching kubernetes/*.yaml')
    .option('--skip-app-build', 'do not run the package build before compiling the application graph')
    .option('--skip-image-build', 'do not build generated operator, host, migration, processor, gateway, projection, or workflow images')
    .option('--migrate-kro-owned-provider-data', 'explicitly preserve and move legacy KRO-owned stateful providers to the generated direct lifecycle')
    .option(
      '--confirm-legacy-typekro-node-fetch-manager',
      'confirm the ambiguous node-fetch field manager came from a reviewed TypeKro <=0.28 RGD before force-conflict ownership handoff',
    )
    .action(async (entrypoint: string, options: DeployCommandOptions) => {
      const code = await runDeploy(entrypoint, options, io);
      if (code !== 0) {
        throw new CommanderError(code, 'applik8s.deploy.failed', 'Deploy failed.');
      }
    });

  program
    .command('delete')
    .description('Delete a deployed Application instance through TypeKro, then clean up recorded app-owned direct preparation.')
    .argument('<entrypoint>', 'application entrypoint module used to construct the TypeKro factory')
    .requiredOption('--context <context>', 'explicit kubeconfig context')
    .option('--out-dir <dir>', 'existing deployment artifact directory', '.applik8s/deploy')
    .option('--composition-name <name>', 'TypeKro composition export name', 'app')
    .option('--instance-name <name>', 'instance name when the artifact contains no single authoritative instance')
    .option('--control-plane-namespace <namespace>', 'namespace containing the KRO instance owner')
    .option('--keep-direct-preparation', 'leave app-owned direct preparation such as the workload Namespace intact')
    .action(async (entrypoint: string, options: DeleteCommandOptions) => {
      const code = await runDelete(entrypoint, options, io);
      if (code !== 0) {
        throw new CommanderError(code, 'applik8s.delete.failed', 'Delete failed.');
      }
    });

  program
    .command('explain')
    .description('Explain a diagnostic reason and first recovery steps.')
    .argument('<reason>', 'diagnostic reason, such as UndeclaredPermission')
    .action(async (reason: string) => {
      const code = await runExplain(reason, io);
      if (code !== 0) {
        throw new CommanderError(code, 'applik8s.explain.failed', 'Explain failed.');
      }
    });

  const replay = program.command('replay').description('Replay artifact utilities.');
  replay
    .command('inspect')
    .description('Inspect an applik8s replay artifact.')
    .argument('<artifact>', 'replay artifact JSON path')
    .option('--bundle-dir <dir>', 'compiled dist/applik8s directory for digest verification')
    .option('--execute', 'execute full-payload deterministic replay locally')
    .option('--json', 'print JSON summary')
    .action(async (artifact: string, options: { readonly bundleDir?: string; readonly execute?: boolean; readonly json?: boolean }) => {
      const replayArgs = [artifact, ...(options.bundleDir ? ['--bundle-dir', options.bundleDir] : []), ...(options.execute ? ['--execute'] : []), ...(options.json ? ['--json'] : [])];
      const code = await runChild({ command: 'node', args: ['scripts/replay-artifact.mjs', ...replayArgs], cwd: io.cwd });
      if (code !== 0) {
        throw new CommanderError(code, 'applik8s.replay.inspect.failed', 'Replay inspect failed.');
      }
    });

  program
    .command('test')
    .description('Run Vitest through the workspace test setup.')
    .allowUnknownOption(true)
    .argument('[vitestArgs...]', 'arguments forwarded to vitest run')
    .action(async (vitestArgs: readonly string[]) => {
      const code = await runChild({ command: 'bunx', args: ['vitest', 'run', ...vitestArgs], cwd: io.cwd });
      if (code !== 0) {
        throw new CommanderError(code, 'applik8s.test.failed', 'Tests failed.');
      }
    });

  return program;
}

async function runDeploy(entrypoint: string, options: DeployCommandOptions, io: CliIo): Promise<number> {
  if (!options.context.trim()) {
    io.stderr('applik8s deploy requires a non-empty --context and never uses the ambient current context implicitly.');
    return 1;
  }
  if (!options.skipAppBuild) {
    const applicationPackage = await resolveApplicationBuildPackage(resolve(io.cwd, entrypoint));
    const buildCode = await runApplicationDeploymentPhase('application-build', io, () =>
      runChild({ command: 'bun', args: ['run', 'build'], cwd: applicationPackage.directory }));
    if (buildCode !== 0) throw applicationDeploymentProcessError('application-build', buildCode);
  }
  const outDir = options.outDir ?? '.applik8s/deploy';
  const buildCode = await runApplicationDeploymentPhase('composition-compile', io, () => runBuild(entrypoint, {
      outDir,
      typekro: true,
      compositionName: options.compositionName ?? 'app',
      ...(options.connectionBindings ? { connectionBindings: options.connectionBindings } : {}),
    }, io));
  if (buildCode !== 0) throw applicationDeploymentProcessError('composition-compile', buildCode);
  const bundlePath = resolve(io.cwd, outDir, 'typekro', 'typekro-composition.json');
  await invalidateGeneratedDeploymentMaterialization(bundlePath);
  const instance = await runApplicationDeploymentPhase('instance-selection', io, () => stageExplicitApplicationInstance(
    resolve(io.cwd, entrypoint),
    bundlePath,
    options.instance ? resolve(io.cwd, options.instance) : undefined,
  ));
  const receiptScope: ApplicationDeploymentReceiptScope = {
    controlPlaneNamespace: instance.namespace,
    instanceName: instance.name,
  };
  io.stdout(`Application instance: ${instance.apiVersion}/${instance.kind}/${instance.name} in ${instance.namespace}`);
  const registry = await runApplicationDeploymentPhase('registry-resolution', io, () =>
    resolveDeploymentContainerRegistry(bundlePath, options.context, instance.spec, io));
  if (options.skipImageBuild && registry.remote) {
    throw new Error('Remote ContainerRegistry deployments cannot use --skip-image-build because verified immutable image receipts are required before apply.');
  }
  const registryPreparation = await runApplicationDeploymentPhase('registry-preparation', io, () => prepareApplicationContainerRegistry(
    registry,
    options.context,
    typeKroContainerRegistryPreparationRuntime(io),
  ));
  if (registryPreparation.provider === 'managed-harbor') {
    io.stdout(`Harbor project ready: ${registryPreparation.project}`);
  }
  await writeContainerRegistryPreparationReceipt(bundlePath, receiptScope, registryPreparation);
  await runApplicationDeploymentPhase('pull-secret-verification', io, () =>
    verifyApplicationRegistryPullSecret(registry, options.context));
  if (options.migrateKroOwnedProviderData) {
    const migration = await runApplicationDeploymentPhase('provider-ownership-migration', io, async () => {
      const desiredResourceGraphDefinition = await readGeneratedResourceGraphDefinition(
        bundlePath,
        instance.resourceGraphDefinitionName,
      );
      const runtime = await createKubernetesKroProviderMigrationRuntime({
        context: options.context,
        log: (message) => io.stdout(message),
        allowLegacyTypeKroNodeFetchHandoff: options.confirmLegacyTypekroNodeFetchManager ?? false,
      });
      return migrateApplicationKroOwnedProviderData({
        resourceGraphDefinitionName: instance.resourceGraphDefinitionName,
        desiredResourceGraphDefinition,
        runtime,
      });
    });
    await writeApplicationKroProviderMigrationReceipt(bundlePath, receiptScope, migration);
    if (migration.state === 'completed') {
      io.stdout(
        `Provider ownership migration completed: ${migration.adoptedResources.length} resource${migration.adoptedResources.length === 1 ? '' : 's'} preserved; `
        + `${migration.externalizedNodeIds.length} RGD node${migration.externalizedNodeIds.length === 1 ? '' : 's'} externalized`,
      );
    }
  }
  const providerPreparation = await runApplicationDeploymentPhase('provider-preparation', io, async () => {
    const source = await readGeneratedApplicationGraph(bundlePath, io.cwd);
    const graph = resolveApplicationInstallationValues(
      applicationGraphDeploymentSlice(source, (node) => node.kind === 'provider' && [
        'IndexStore',
        'ModelStore',
        'ObjectStorage',
        'ProjectionStore',
        'RequestIdentity',
        'WorkflowEngine',
      ].includes(node.interface)),
      instance.spec,
    );
    return prepareApplicationProviderPrerequisites(
      graph,
      options.context,
      typeKroApplicationProviderPreparationRuntime(io),
    );
  });
  await writeApplicationProviderPreparationReceipt(bundlePath, receiptScope, providerPreparation);
  if (!options.skipImageBuild) {
    const imageReceipts = await runApplicationDeploymentPhase('image-publication', io, () =>
      buildGeneratedImages(bundlePath, options.context, registry, io));
    await runApplicationDeploymentPhase('artifact-materialization', io, async () => {
      validateApplicationImageReceipts(imageReceipts, registry.remote);
      if (registry.pullSecret) {
        const resources = JSON.parse(await readFile(join(dirname(bundlePath), 'resources.json'), 'utf8')) as unknown;
        // A bundle can contain prerequisite RGDs whose schema.spec paths belong
        // to those definitions rather than the root Application instance. Keep
        // such foreign references intact while resolving every root path that
        // participates in authored workload pull-Secret coverage.
        const namespaces = validateApplicationPullSecretCoverage(resolveApplicationInstallationValues(resources, instance.spec, { preserveUnknownReferences: true }), imageReceipts, registry.pullSecret);
        io.stdout(`Registry pull Secret coverage: ${namespaces.join(', ') || '<no authored workloads>'}`);
      }
      await materializeGeneratedDeployment(bundlePath, imageReceipts, registry);
    });
  }
  const hostPreparation = await runApplicationDeploymentPhase('runtime-preparation', io, () =>
    prepareGeneratedApplicationHosts(bundlePath, options.context, instance.namespace, instance.spec, io));
  await writeApplicationHostPreparationReceipt(bundlePath, receiptScope, hostPreparation);
  const applyScript = resolve(io.cwd, outDir, 'typekro', 'apply.sh');
  io.stdout(`Deploying through generated TypeKro artifacts to context ${options.context}`);
  const applyCode = await runApplicationDeploymentPhase('typekro-apply', io, () => runChild({
    command: 'sh',
    args: [applyScript],
    cwd: io.cwd,
    env: {
      ...process.env,
      APPLIK8S_KUBE_CONTEXT: options.context,
      ...(options.migrateKroOwnedProviderData
        ? { APPLIK8S_FORCE_RGD_NAME: instance.resourceGraphDefinitionName }
        : {}),
    },
  }));
  if (applyCode !== 0) throw applicationDeploymentProcessError('typekro-apply', applyCode);
  await runApplicationDeploymentPhase('authoritative-readiness', io, () =>
    waitForResourceGraphDefinitionReadiness(options.context, instance.resourceGraphDefinitionName, io));
  const readiness = await runApplicationDeploymentPhase('authoritative-readiness', io, () =>
    waitForApplicationInstanceReadiness(options.context, instance, io));
  if (readiness.url) {
    await runApplicationDeploymentPhase('exposure-verification', io, () =>
      waitForApplicationEndpoint(readiness.url as string, io));
  }
  io.stdout(`Application ready: ${instance.apiVersion}/${instance.kind}/${instance.name}${readiness.url ? ` at ${readiness.url}` : ''}`);
  return 0;
}

/**
 * A new composition compile invalidates every receipt produced for an older
 * artifact set. Keeping those files beside freshly generated sources makes a
 * failed pre-apply deploy look publishable and lets live evidence accidentally
 * describe the workload that is still running instead of the workload that was
 * just compiled.
 */
export async function invalidateGeneratedDeploymentMaterialization(bundlePath: string): Promise<void> {
  const directory = dirname(bundlePath);
  await Promise.all([
    'application-image-evidence.json',
    'image-receipts.json',
  ].map(async (file) => {
    try {
      await unlink(join(directory, file));
    } catch (cause) {
      if (cause && typeof cause === 'object' && Reflect.get(cause, 'code') === 'ENOENT') return;
      throw cause;
    }
  }));
}

export interface ApplicationInstallationReadiness {
  readonly state: 'pending' | 'ready' | 'failed';
  readonly summary: string;
  readonly url?: string;
}

/** Reject stale instance readiness until KRO accepts the exact graph generation just applied. */
export function resourceGraphDefinitionReadiness(value: unknown): ApplicationInstallationReadiness {
  if (!value || typeof value !== 'object') return { state: 'pending', summary: 'ResourceGraphDefinition has not been observed yet' };
  const metadata = Reflect.get(value, 'metadata');
  const status = Reflect.get(value, 'status');
  const generation = metadata && typeof metadata === 'object' ? Reflect.get(metadata, 'generation') : undefined;
  if (!status || typeof status !== 'object' || typeof generation !== 'number') {
    return { state: 'pending', summary: 'ResourceGraphDefinition status has not been projected yet' };
  }
  const conditions = Array.isArray(Reflect.get(status, 'conditions')) ? Reflect.get(status, 'conditions') as readonly unknown[] : [];
  const current = conditions.filter((condition): condition is object => {
    if (!condition || typeof condition !== 'object') return false;
    return Reflect.get(condition, 'observedGeneration') === generation;
  });
  const rejected = current.find((condition) => Reflect.get(condition, 'type') === 'GraphAccepted'
    && Reflect.get(condition, 'status') === 'False');
  if (rejected && typeof rejected === 'object') {
    const reason = Reflect.get(rejected, 'reason');
    const message = Reflect.get(rejected, 'message');
    return {
      state: 'failed',
      summary: [typeof reason === 'string' ? reason : 'InvalidResourceGraph', typeof message === 'string' ? message : undefined]
        .filter(Boolean)
        .join(': '),
    };
  }
  const accepted = current.some((condition) => Reflect.get(condition, 'type') === 'GraphAccepted'
    && Reflect.get(condition, 'status') === 'True');
  const ready = current.some((condition) => Reflect.get(condition, 'type') === 'Ready'
    && Reflect.get(condition, 'status') === 'True');
  if (accepted && ready) return { state: 'ready', summary: `generation ${generation} accepted` };
  const currentFailure = current.find((condition) => Reflect.get(condition, 'status') === 'False'
    && ['Ready', 'GraphRevisionsResolved'].includes(String(Reflect.get(condition, 'type'))));
  const reason = currentFailure && typeof currentFailure === 'object' ? Reflect.get(currentFailure, 'reason') : undefined;
  const message = currentFailure && typeof currentFailure === 'object' ? Reflect.get(currentFailure, 'message') : undefined;
  return {
    state: 'pending',
    summary: [typeof reason === 'string' ? reason : `waiting for generation ${generation}`, typeof message === 'string' ? message : undefined]
      .filter(Boolean)
      .join(': '),
  };
}

/** Interpret only the public, KRO-owned installation status contract. */
export function applicationInstallationReadiness(value: unknown): ApplicationInstallationReadiness {
  if (!value || typeof value !== 'object') return { state: 'pending', summary: 'status has not been projected yet' };
  const metadata = Reflect.get(value, 'metadata');
  const generation = metadata && typeof metadata === 'object' && typeof Reflect.get(metadata, 'generation') === 'number'
    ? Reflect.get(metadata, 'generation') as number
    : undefined;
  const status = Reflect.get(value, 'status');
  if (!status || typeof status !== 'object') return { state: 'pending', summary: 'status has not been projected yet' };
  const phase = Reflect.get(status, 'phase');
  const kroState = Reflect.get(status, 'state');
  const declaredReady = Reflect.get(status, 'ready');
  const url = typeof Reflect.get(status, 'url') === 'string' ? Reflect.get(status, 'url') as string : undefined;
  const conditions = Array.isArray(Reflect.get(status, 'conditions')) ? Reflect.get(status, 'conditions') as readonly unknown[] : [];
  const readyCondition = conditions.find((condition) => condition && typeof condition === 'object'
    && Reflect.get(condition, 'type') === 'Ready');
  const readyObservedGeneration = readyCondition && typeof readyCondition === 'object'
    ? Reflect.get(readyCondition, 'observedGeneration')
    : undefined;
  if (generation !== undefined && typeof readyObservedGeneration === 'number' && readyObservedGeneration !== generation) {
    return {
      state: 'pending',
      summary: `Ready condition observes generation ${readyObservedGeneration}; waiting for generation ${generation}`,
      ...(url ? { url } : {}),
    };
  }
  const failedCondition = conditions.find((condition) => condition && typeof condition === 'object'
    && Reflect.get(condition, 'type') === 'Failed'
    && Reflect.get(condition, 'status') === 'True'
    && (generation === undefined || Reflect.get(condition, 'observedGeneration') === undefined || Reflect.get(condition, 'observedGeneration') === generation));
  if (phase === 'Failed' || kroState === 'ERROR' || kroState === 'FAILED' || failedCondition) {
    const reason = failedCondition && typeof failedCondition === 'object' ? Reflect.get(failedCondition, 'reason') : undefined;
    const message = failedCondition && typeof failedCondition === 'object' ? Reflect.get(failedCondition, 'message') : undefined;
    return {
      state: 'failed',
      summary: [typeof reason === 'string' ? reason : 'ApplicationFailed', typeof message === 'string' ? message : undefined].filter(Boolean).join(': '),
      ...(url ? { url } : {}),
    };
  }
  const providerStatus = Reflect.get(status, 'providerStatus');
  const pendingProviders = providerStatus && typeof providerStatus === 'object'
    ? Object.entries(providerStatus)
      .filter(([, state]) => state !== 'Ready' && state !== 'NotConfigured')
      .map(([name]) => name)
      .sort()
    : [];
  const rolloutStatus = Reflect.get(status, 'rolloutStatus');
  const rolloutPending = typeof rolloutStatus === 'string' && !['Ready', 'Current'].includes(rolloutStatus);
  const declaredPhasePending = typeof phase === 'string' && phase !== 'Ready';
  if (declaredReady === true && !declaredPhasePending && pendingProviders.length === 0 && !rolloutPending) {
    return { state: 'ready', summary: typeof phase === 'string' ? phase : 'Ready', ...(url ? { url } : {}) };
  }
  // Once an Application publishes its own ready bit, that domain projection
  // is authoritative. KRO's Ready condition means the graph reconciled; it
  // must not override ready=false while provider/workload health is pending.
  if (declaredReady === undefined && readyCondition && typeof readyCondition === 'object'
    && Reflect.get(readyCondition, 'status') === 'True'
    && (kroState === undefined || kroState === 'ACTIVE')) {
    return {
      state: 'ready',
      summary: typeof phase === 'string' ? phase : 'Ready',
      ...(url ? { url } : {}),
    };
  }
  const pending = [...pendingProviders, ...(rolloutPending ? ['rollout'] : [])].sort();
  return {
    state: 'pending',
    summary: pending.length > 0
      ? `${typeof phase === 'string' ? phase : 'Installing'}; pending: ${pending.join(', ')}`
      : typeof phase === 'string'
        ? phase
        : readyCondition && typeof readyCondition === 'object'
          ? [Reflect.get(readyCondition, 'reason'), Reflect.get(readyCondition, 'message')].filter((value): value is string => typeof value === 'string' && value.length > 0).join(': ') || 'status is not ready'
          : typeof kroState === 'string' ? kroState : 'status is not ready',
    ...(url ? { url } : {}),
  };
}

async function waitForApplicationInstanceReadiness(
  context: string,
  instance: StagedApplicationInstance,
  io: CliIo,
  timeoutMs = 10 * 60_000,
): Promise<ApplicationInstallationReadiness> {
  const stableReadinessMs = 30_000;
  const [group, version] = instance.apiVersion.split('/');
  if (!group || !version) throw new Error(`Application instance apiVersion ${instance.apiVersion} is not a grouped Kubernetes API version.`);
  const name = instance.name;
  const namespace = instance.namespace;
  // static-import-exception: readiness loads the optional Kubernetes SDK only for live deployment commands, keeping compile-only CLI startup lightweight.
  const kubernetes = await import('@kubernetes/client-node');
  const kubeConfig = new kubernetes.KubeConfig();
  kubeConfig.loadFromDefault();
  kubeConfig.setCurrentContext(context);
  const extensions = makeKubernetesApiClient(kubeConfig, kubernetes.ApiextensionsV1Api);
  const crds = await extensions.listCustomResourceDefinition({});
  const crd = crds.items.find((candidate) => candidate.spec.group === group
    && candidate.spec.names.kind === instance.kind
    && candidate.spec.versions.some((candidateVersion) => candidateVersion.name === version && candidateVersion.served));
  const plural = crd?.spec.names.plural;
  if (!plural) throw new Error(`No served CRD matches ${instance.apiVersion}/${instance.kind}.`);
  const customObjects = makeKubernetesApiClient(kubeConfig, kubernetes.CustomObjectsApi);
  const startedAt = Date.now();
  let lastReport = 0;
  let lastSummary = '';
  let readySince: number | undefined;
  while (Date.now() - startedAt < timeoutMs) {
    const resource = await customObjects.getNamespacedCustomObject({ group, version, namespace, plural, name })
      .catch((cause: unknown) => {
        if (kubernetesStatusCode(cause) === 404) return undefined;
        throw cause;
      });
    const readiness = applicationInstallationReadiness(resource);
    if (readiness.state === 'ready') {
      readySince ??= Date.now();
      if (Date.now() - readySince >= stableReadinessMs) return readiness;
      const stableForMs = Date.now() - readySince;
      const summary = `${readiness.summary}; confirming stable reconciliation (${Math.floor(stableForMs / 1_000)}s/${stableReadinessMs / 1_000}s)`;
      if (summary !== lastSummary || Date.now() - lastReport >= 15_000) {
        io.stdout(`Waiting for ${instance.kind}/${name}: ${summary}`);
        lastSummary = summary;
        lastReport = Date.now();
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      continue;
    }
    readySince = undefined;
    if (readiness.state === 'failed') throw new Error(`${instance.kind}/${name} reported terminal failure: ${readiness.summary}`);
    if (readiness.summary !== lastSummary || Date.now() - lastReport >= 15_000) {
      io.stdout(`Waiting for ${instance.kind}/${name}: ${readiness.summary}`);
      lastSummary = readiness.summary;
      lastReport = Date.now();
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${instance.kind}/${name}; last status: ${lastSummary || 'unavailable'}.`);
}

async function waitForResourceGraphDefinitionReadiness(
  context: string,
  name: string,
  io: CliIo,
  timeoutMs = 2 * 60_000,
): Promise<void> {
  // static-import-exception: Kubernetes SDK loading remains confined to an explicit live deployment readiness operation.
  const kubernetes = await import('@kubernetes/client-node');
  const kubeConfig = new kubernetes.KubeConfig();
  kubeConfig.loadFromDefault();
  kubeConfig.setCurrentContext(context);
  const customObjects = makeKubernetesApiClient(kubeConfig, kubernetes.CustomObjectsApi);
  const startedAt = Date.now();
  let lastReport = 0;
  let lastSummary = '';
  while (Date.now() - startedAt < timeoutMs) {
    const resource = await customObjects.getClusterCustomObject({
      group: 'kro.run',
      version: 'v1alpha1',
      plural: 'resourcegraphdefinitions',
      name,
    }).catch((cause: unknown) => {
      if (kubernetesStatusCode(cause) === 404) return undefined;
      throw cause;
    });
    const readiness = resourceGraphDefinitionReadiness(resource);
    if (readiness.state === 'ready') return;
    if (readiness.state === 'failed') {
      throw new Error(`ResourceGraphDefinition/${name} rejected the applied graph: ${readiness.summary}`);
    }
    if (readiness.summary !== lastSummary || Date.now() - lastReport >= 15_000) {
      io.stdout(`Waiting for ResourceGraphDefinition/${name}: ${readiness.summary}`);
      lastSummary = readiness.summary;
      lastReport = Date.now();
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ResourceGraphDefinition/${name}; last status: ${lastSummary || 'unavailable'}.`);
}

export interface ApplicationEndpointVerificationOptions {
  readonly timeoutMs?: number;
  readonly requestTimeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

/**
 * Verify the public URL projected by the authoritative Application status.
 * This is deliberately a client-side reachability check: child readiness can
 * be green while a NodePort, Ingress, DNS record, or certificate is unusable
 * from the machine performing the deployment.
 */
export async function waitForApplicationEndpoint(
  url: string,
  io: Pick<CliIo, 'stdout'>,
  options: ApplicationEndpointVerificationOptions = {},
): Promise<void> {
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
    throw new Error(`Application status URL ${url} must use http or https.`);
  }
  const timeoutMs = options.timeoutMs ?? 2 * 60_000;
  const requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  const fetchEndpoint = options.fetch ?? fetch;
  const startedAt = Date.now();
  let lastFailure = 'no request completed';
  let lastReport = 0;
  while (Date.now() - startedAt < timeoutMs) {
    const remainingMs = timeoutMs - (Date.now() - startedAt);
    const controller = new AbortController();
    const requestTimeout = setTimeout(
      () => controller.abort(new Error(`request exceeded ${Math.min(requestTimeoutMs, remainingMs)}ms`)),
      Math.min(requestTimeoutMs, remainingMs),
    );
    try {
      const response = await fetchEndpoint(endpoint, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
      });
      if (response.status >= 200 && response.status < 400) return;
      lastFailure = `HTTP ${response.status}`;
    } catch (cause) {
      lastFailure = cause instanceof Error ? cause.message : String(cause);
    } finally {
      clearTimeout(requestTimeout);
    }
    if (Date.now() - lastReport >= 15_000) {
      io.stdout(`Waiting for public endpoint ${endpoint.toString()}: ${lastFailure}`);
      lastReport = Date.now();
    }
    if (Date.now() - startedAt < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, timeoutMs - (Date.now() - startedAt))));
    }
  }
  throw new Error(`Timed out after ${timeoutMs}ms reaching ${endpoint.toString()}; last result: ${lastFailure}.`);
}

async function runApplicationDeploymentPhase<T>(
  phase: ApplicationDeploymentPhase,
  io: CliIo,
  operation: () => Promise<T>,
): Promise<T> {
  io.stdout(`Deployment phase: ${phase}`);
  try {
    return await operation();
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Deployment phase ${phase} failed: ${detail} Remediation: ${applicationDeploymentPhaseRemediation[phase]}`, { cause });
  }
}

function applicationDeploymentProcessError(phase: ApplicationDeploymentPhase, code: number): Error {
  return new Error(`Deployment phase ${phase} failed with exit code ${code}. Remediation: ${applicationDeploymentPhaseRemediation[phase]}`);
}

async function verifyApplicationRegistryPullSecret(
  registry: ResolvedApplicationContainerRegistry,
  context: string,
): Promise<void> {
  if (!registry.remote || !registry.pullSecret) {
    if (registry.remote && registry.provider.kind !== 'orbstack-container-registry' && registry.provider.pushCredentials) {
      throw new Error('Authenticated remote ContainerRegistry deployments require a namespace-scoped pullSecret before authored workloads can be applied.');
    }
    return;
  }
  // static-import-exception: registry verification needs the optional Kubernetes SDK only after a remote deployment selects a pull Secret.
  const kubernetes = await import('@kubernetes/client-node');
  const kubeConfig = new kubernetes.KubeConfig();
  kubeConfig.loadFromDefault();
  kubeConfig.setCurrentContext(context);
  const secret = await makeKubernetesApiClient(kubeConfig, kubernetes.CoreV1Api).readNamespacedSecret({
    name: registry.pullSecret.name,
    namespace: registry.pullSecret.namespace,
  }).catch((cause: unknown) => {
    if (kubernetesStatusCode(cause) === 404) {
      throw new Error(`ContainerRegistry pull Secret ${registry.pullSecret?.namespace}/${registry.pullSecret?.name} does not exist after registry preparation.`);
    }
    throw cause;
  });
  if (secret.type !== 'kubernetes.io/dockerconfigjson' || !secret.data?.['.dockerconfigjson']) {
    throw new Error(`ContainerRegistry pull Secret ${registry.pullSecret.namespace}/${registry.pullSecret.name} must be type kubernetes.io/dockerconfigjson with .dockerconfigjson data.`);
  }
}

export interface StagedApplicationInstance {
  readonly apiVersion: string;
  readonly kind: string;
  readonly name: string;
  readonly namespace: string;
  readonly spec: Readonly<Record<string, unknown>>;
  readonly path: string;
  readonly resourceGraphDefinitionName: string;
}

/**
 * Stage one authored root instance beside the generated TypeKro resources.
 * The compiler deliberately never fabricates desired installation state; the
 * deploy command therefore requires a checked-in object whose GVK matches the
 * application's RGD.
 */
export async function stageExplicitApplicationInstance(
  entrypoint: string,
  bundlePath: string,
  explicitPath?: string,
): Promise<StagedApplicationInstance> {
  const bundle = JSON.parse(await readFile(bundlePath, 'utf8')) as {
    readonly spec?: { readonly applicationGraph?: { readonly path?: string } };
  };
  const graphPath = bundle.spec?.applicationGraph?.path;
  if (!graphPath) throw new Error('Generated TypeKro bundle does not reference its ApplicationGraph.');
  const projectRoot = await findAncestorContaining(dirname(entrypoint), 'package.json');
  const graph = JSON.parse(await readFile(resolve(projectRoot ?? dirname(entrypoint), graphPath), 'utf8')) as ApplicationGraph;
  const resources = JSON.parse(await readFile(join(dirname(bundlePath), 'resources.json'), 'utf8')) as readonly unknown[];
  const applicationRgd = resources.find((resource) => {
    if (!resource || typeof resource !== 'object' || Reflect.get(resource, 'kind') !== 'ResourceGraphDefinition') return false;
    const metadata = Reflect.get(resource, 'metadata');
    return metadata && typeof metadata === 'object' && Reflect.get(metadata, 'name') === graph.metadata.name;
  });
  if (!applicationRgd || typeof applicationRgd !== 'object') {
    throw new Error(`Generated resources do not contain the root ResourceGraphDefinition ${graph.metadata.name}.`);
  }
  const schema = Reflect.get(Reflect.get(applicationRgd, 'spec') ?? {}, 'schema');
  const group = schema && typeof schema === 'object' ? Reflect.get(schema, 'group') : undefined;
  const version = schema && typeof schema === 'object' ? Reflect.get(schema, 'apiVersion') : undefined;
  const kind = schema && typeof schema === 'object' ? Reflect.get(schema, 'kind') : undefined;
  if (typeof group !== 'string' || typeof version !== 'string' || typeof kind !== 'string') {
    throw new Error(`Root ResourceGraphDefinition ${graph.metadata.name} has no concrete group, version, and kind.`);
  }
  const apiVersion = `${group}/${version}`;
  if (!projectRoot && !explicitPath) {
    throw new Error(`Cannot discover an explicit ${apiVersion}/${kind} instance because ${entrypoint} has no package root. Pass --instance <path>.`);
  }
  const sourcePaths = explicitPath
    ? [explicitPath]
    : await readdir(join(projectRoot as string, 'kubernetes'))
        .then((files) => files.filter((file) => /\.ya?ml$/.test(file)).sort().map((file) => join(projectRoot as string, 'kubernetes', file)))
        .catch((cause: unknown) => {
          if (kubernetesStatusCode(cause) === 2 || (cause && typeof cause === 'object' && Reflect.get(cause, 'code') === 'ENOENT')) return [];
          throw cause;
        });
  const candidates: { readonly value: Record<string, unknown>; readonly sourcePath: string }[] = [];
  for (const sourcePath of sourcePaths) {
    const documents = parseAllDocuments(await readFile(sourcePath, 'utf8'));
    for (const document of documents) {
      const value = document.toJSON() as unknown;
      if (!value || typeof value !== 'object') continue;
      if (Reflect.get(value, 'apiVersion') === apiVersion && Reflect.get(value, 'kind') === kind) {
        candidates.push({ value: value as Record<string, unknown>, sourcePath });
      }
    }
  }
  if (candidates.length !== 1) {
    const source = explicitPath ?? `${projectRoot}/kubernetes/*.yaml`;
    throw new Error(`Expected exactly one explicit ${apiVersion}/${kind} Application instance in ${source}, found ${candidates.length}. Pass --instance <path> to disambiguate.`);
  }
  // typecast: exact-one guard proves the selected candidate exists.
  const candidate = candidates[0] as { readonly value: Record<string, unknown>; readonly sourcePath: string };
  const metadata = candidate.value.metadata;
  const name = metadata && typeof metadata === 'object' ? Reflect.get(metadata, 'name') : undefined;
  const namespace = metadata && typeof metadata === 'object' ? Reflect.get(metadata, 'namespace') : undefined;
  if (typeof name !== 'string' || !name.trim() || typeof namespace !== 'string' || !namespace.trim()) {
    throw new Error(`Explicit Application instance ${candidate.sourcePath} requires concrete metadata.name and metadata.namespace.`);
  }
  const spec = candidate.value.spec;
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error(`Explicit Application instance ${candidate.sourcePath} requires a concrete object spec for deployment preparation.`);
  }
  const instancesDirectory = join(dirname(bundlePath), 'instances');
  await mkdir(instancesDirectory, { recursive: true });
  for (const file of (await readdir(instancesDirectory)).filter((file) => /\.ya?ml$/.test(file))) {
    const path = join(instancesDirectory, file);
    const documents = parseAllDocuments(await readFile(path, 'utf8'))
      .map((document) => document.toJSON() as unknown)
      .filter((value): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value)));
    if (documents.some((document) => document.apiVersion === apiVersion && document.kind === kind)) {
      await unlink(path);
      continue;
    }
    if (documents.length !== 1) {
      throw new Error(`Generated prerequisite instance ${path} must contain exactly one Kubernetes resource.`);
    }
    const prerequisite = documents[0] as Record<string, unknown>;
    const metadata = prerequisite.metadata;
    const annotations = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? Reflect.get(metadata, 'annotations')
      : undefined;
    const encodedConditions = annotations && typeof annotations === 'object' && !Array.isArray(annotations)
      ? Reflect.get(annotations, 'applik8s.dev/include-when')
      : undefined;
    if (encodedConditions === undefined) continue;
    const conditions = typeof encodedConditions === 'string' ? JSON.parse(encodedConditions) as unknown : undefined;
    if (!Array.isArray(conditions) || !conditions.every((condition) => typeof condition === 'string')) {
      throw new Error(`Generated prerequisite instance ${path} has an invalid applik8s.dev/include-when contract.`);
    }
    const active = conditions.every((condition) => {
      const resolved = resolveApplicationInstallationValues(condition, spec as Readonly<Record<string, unknown>>);
      if (typeof resolved !== 'boolean') {
        throw new Error(`Generated prerequisite condition ${condition} must resolve to a boolean installation value.`);
      }
      return resolved;
    });
    if (!active) {
      await unlink(path);
      continue;
    }
    const retainedAnnotations = { ...(annotations as Record<string, unknown>) };
    delete retainedAnnotations['applik8s.dev/include-when'];
    const retainedMetadata = { ...(metadata as Record<string, unknown>) };
    if (Object.keys(retainedAnnotations).length > 0) retainedMetadata.annotations = retainedAnnotations;
    else delete retainedMetadata.annotations;
    await writeFile(path, stringify({ ...prerequisite, metadata: retainedMetadata }));
  }
  const stagedPath = join(instancesDirectory, `${name.replace(/[^a-z0-9.-]+/gi, '-').toLowerCase()}.yaml`);
  await writeFile(stagedPath, stringify(candidate.value));
  return {
    apiVersion,
    kind,
    name,
    namespace,
    spec: spec as Readonly<Record<string, unknown>>,
    path: stagedPath,
    resourceGraphDefinitionName: graph.metadata.name,
  };
}

async function runDelete(entrypoint: string, options: DeleteCommandOptions, io: CliIo): Promise<number> {
  if (!options.context.trim()) {
    io.stderr('applik8s delete requires a non-empty --context and never uses the ambient current context implicitly.');
    return 1;
  }
  if (isBunRuntime() && process.env.APPLIK8S_DISABLE_NODE_DELETE_HANDOFF !== '1') {
    io.stdout('Handing TypeKro lifecycle deletion to Node for full Kubernetes discovery support.');
    return runChild({
      command: 'node',
      args: [fileURLToPath(new URL('./node-delete-runner.mjs', import.meta.url)), JSON.stringify({ entrypoint, options, cwd: io.cwd })],
      cwd: io.cwd,
    });
  }
  const outDir = options.outDir ?? '.applik8s/deploy';
  const bundlePath = resolve(io.cwd, outDir, 'typekro', 'typekro-composition.json');
  const target = await resolveGeneratedApplicationDeleteTarget(bundlePath, options);
  const receiptScope: ApplicationDeploymentReceiptScope = {
    controlPlaneNamespace: target.controlPlaneNamespace,
    instanceName: target.instanceName,
  };
  // static-import-exception: deletion loads the optional Kubernetes SDK only after the Node lifecycle handoff and explicit context validation.
  const kubernetes = await import('@kubernetes/client-node');
  const kubeConfig = new kubernetes.KubeConfig();
  kubeConfig.loadFromDefault();
  kubeConfig.setCurrentContext(options.context);
  const concreteSpec = target.resourceGraphDefinitionName
    ? await readGeneratedApplicationInstanceSpec(kubeConfig, kubernetes, target)
    : undefined;
  const composition = await loadGeneratedApplicationLifecycleComposition(
    bundlePath,
    target,
    resolve(io.cwd, entrypoint),
    options.compositionName ?? 'app',
    concreteSpec,
  );
  const factory = composition.factory('kro', {
    namespace: target.controlPlaneNamespace,
    kubeConfig,
    waitForReady: true,
    timeout: 10 * 60_000,
    conflictStrategy: 'patch',
  });
  io.stdout(`Deleting ${target.apiVersion}/${target.kind}/${target.instanceName} through TypeKro in context ${options.context}`);
  try {
    await factory.deleteInstance(target.instanceName);
  } catch (cause) {
    const absent = await waitForAbsence(
      async () => !await generatedApplicationInstanceExists(kubeConfig, kubernetes, target),
    );
    if (!absent) throw cause;
    io.stdout(`Application instance ${target.instanceName} is already absent; continuing idempotent direct-preparation cleanup`);
  }
  if (!options.keepDirectPreparation) {
    const providerReceipt = await readApplicationProviderPreparationReceipt(bundlePath, receiptScope);
    const hostReceipt = await readApplicationHostPreparationReceipt(bundlePath, receiptScope);
    const registryReceipt = await readContainerRegistryPreparationReceipt(bundlePath, receiptScope);
    const preserveNamespaces = retainedApplicationProviderNamespaces(providerReceipt);
    if (providerReceipt) {
      await deleteApplicationProviderPrerequisites(
        providerReceipt,
        options.context,
        typeKroApplicationProviderPreparationRuntime(io),
      );
    }
    if (hostReceipt) {
      await deleteGeneratedApplicationHostPreparation(hostReceipt, options.context, io, { preserveNamespaces });
    }
    if (registryReceipt) {
      await deleteApplicationContainerRegistryPreparation(
        registryReceipt,
        options.context,
        typeKroContainerRegistryPreparationRuntime(io),
        { preserveNamespaces },
      );
    }
    // Keep every receipt until all coordinated cleanup succeeds. A retry after
    // partial failure must still know which namespace contains retained data.
    if (providerReceipt) {
      await unlinkApplicationDeploymentReceipt(bundlePath, receiptScope, 'application-provider-preparation.json');
    }
    if (hostReceipt) {
      await unlinkApplicationDeploymentReceipt(bundlePath, receiptScope, 'application-host-preparation.json');
    }
    if (registryReceipt) {
      await unlinkApplicationDeploymentReceipt(bundlePath, receiptScope, 'container-registry-preparation.json');
    }
  }
  io.stdout(`Application instance ${target.instanceName} deleted; TypeKro finalization completed.`);
  return 0;
}

async function generatedApplicationInstanceExists(
  kubeConfig: InstanceType<typeof import('@kubernetes/client-node').KubeConfig>,
  kubernetes: typeof import('@kubernetes/client-node'),
  target: GeneratedApplicationDeleteTarget,
): Promise<boolean> {
  const [group, version] = target.apiVersion.split('/');
  if (!group || !version) throw new Error(`Application instance apiVersion ${target.apiVersion} is not a grouped Kubernetes API version.`);
  const crds = await makeKubernetesApiClient(kubeConfig, kubernetes.ApiextensionsV1Api).listCustomResourceDefinition({});
  const plural = crds.items.find((candidate) => candidate.spec.group === group
    && candidate.spec.names.kind === target.kind
    && candidate.spec.versions.some((candidateVersion) => candidateVersion.name === version && candidateVersion.served))?.spec.names.plural;
  if (!plural) return false;
  return makeKubernetesApiClient(kubeConfig, kubernetes.CustomObjectsApi).getNamespacedCustomObject({
    group,
    version,
    namespace: target.controlPlaneNamespace,
    plural,
    name: target.instanceName,
  }).then(() => true).catch((cause: unknown) => {
    if (kubernetesStatusCode(cause) === 404) return false;
    throw cause;
  });
}

export interface GeneratedApplicationDeleteTarget {
  readonly apiVersion: string;
  readonly kind: string;
  readonly instanceName: string;
  readonly controlPlaneNamespace: string;
  readonly resourceGraphDefinitionName?: string;
}

export async function resolveGeneratedApplicationDeleteTarget(
  bundlePath: string,
  options: DeleteCommandOptions,
): Promise<GeneratedApplicationDeleteTarget> {
  const instancesDirectory = join(dirname(bundlePath), 'instances');
  const rootIdentity = await generatedApplicationRootIdentity(bundlePath);
  const files = (await readdir(instancesDirectory)).filter((file) => file.endsWith('.yaml')).sort();
  const candidates = await Promise.all(files.map(async (file) => {
    const value = parse(await readFile(join(instancesDirectory, file), 'utf8')) as unknown;
    if (!value || typeof value !== 'object') return undefined;
    const resource = value as Readonly<Record<string, unknown>>;
    const metadata = resource.metadata;
    if (!metadata || typeof metadata !== 'object') return undefined;
    const name = Reflect.get(metadata, 'name');
    const namespace = Reflect.get(metadata, 'namespace');
    const labels = Reflect.get(metadata, 'labels');
    const apiVersion = resource.apiVersion;
    const kind = resource.kind;
    if (typeof name !== 'string' || typeof apiVersion !== 'string' || typeof kind !== 'string') return undefined;
    return {
      apiVersion,
      kind,
      instanceName: name,
      ...(typeof namespace === 'string' ? { controlPlaneNamespace: namespace } : {}),
      applicationInstance: labels && typeof labels === 'object'
        && (Reflect.get(labels, 'typekro.io/mode') === 'kro'
          || typeof Reflect.get(labels, 'typekro.io/factory') === 'string'
          || typeof Reflect.get(labels, 'typekro.io/rgd') === 'string')
        || rootIdentity?.apiVersion === apiVersion && rootIdentity.kind === kind,
    };
  }));
  const instances = candidates.filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== undefined);
  const applicationInstances = instances.filter((candidate) => candidate.applicationInstance);
  const selected = options.instanceName
    ? instances.find((candidate) => candidate.instanceName === options.instanceName)
    : applicationInstances.length === 1
      ? applicationInstances[0]
      : instances.length === 1
      ? instances[0]
      : undefined;
  if (!selected) {
    const available = instances.map((candidate) => candidate.instanceName).join(', ') || '<none>';
    throw new Error(`Unable to select one generated Application instance for TypeKro deletion. Available instances: ${available}. Pass --instance-name when necessary.`);
  }
  const controlPlaneNamespace = options.controlPlaneNamespace ?? selected.controlPlaneNamespace;
  if (!controlPlaneNamespace?.trim()) {
    throw new Error(`Application instance ${selected.instanceName} has no control-plane namespace. Pass --control-plane-namespace explicitly.`);
  }
  return {
    ...selected,
    controlPlaneNamespace,
    ...(rootIdentity ? { resourceGraphDefinitionName: rootIdentity.resourceGraphDefinitionName } : {}),
  };
}

async function generatedApplicationRootIdentity(
  bundlePath: string,
): Promise<{ readonly apiVersion: string; readonly kind: string; readonly resourceGraphDefinitionName: string } | undefined> {
  const directory = dirname(bundlePath);
  try {
    const graph = JSON.parse(await readFile(join(directory, 'application-graph.json'), 'utf8')) as unknown;
    const graphMetadata = graph && typeof graph === 'object' ? Reflect.get(graph, 'metadata') : undefined;
    const graphName = graphMetadata && typeof graphMetadata === 'object' ? Reflect.get(graphMetadata, 'name') : undefined;
    if (typeof graphName !== 'string' || !graphName.trim()) return undefined;
    const resources = JSON.parse(await readFile(join(directory, 'resources.json'), 'utf8')) as unknown;
    if (!Array.isArray(resources)) return undefined;
    const definition = resources.find((resource) => {
      if (!resource || typeof resource !== 'object' || Reflect.get(resource, 'kind') !== 'ResourceGraphDefinition') return false;
      const metadata = Reflect.get(resource, 'metadata');
      return metadata && typeof metadata === 'object' && Reflect.get(metadata, 'name') === graphName;
    });
    const spec = definition && typeof definition === 'object' ? Reflect.get(definition, 'spec') : undefined;
    const schema = spec && typeof spec === 'object' ? Reflect.get(spec, 'schema') : undefined;
    const group = schema && typeof schema === 'object' ? Reflect.get(schema, 'group') : undefined;
    const version = schema && typeof schema === 'object' ? Reflect.get(schema, 'apiVersion') : undefined;
    const kind = schema && typeof schema === 'object' ? Reflect.get(schema, 'kind') : undefined;
    return typeof group === 'string' && typeof version === 'string' && typeof kind === 'string'
      ? { apiVersion: `${group}/${version}`, kind, resourceGraphDefinitionName: graphName }
      : undefined;
  } catch (cause) {
    if (cause && typeof cause === 'object' && Reflect.get(cause, 'code') === 'ENOENT') return undefined;
    throw cause;
  }
}

export async function loadGeneratedApplicationLifecycleComposition(
  bundlePath: string,
  target: GeneratedApplicationDeleteTarget,
  entrypoint: string,
  exportName: string,
  concreteSpec?: Readonly<Record<string, unknown>>,
): Promise<TypeKroApplicationComposition> {
  if (!target.resourceGraphDefinitionName) {
    return loadTypeKroCompositionEntrypoint(entrypoint, exportName);
  }
  const [group, apiVersion] = target.apiVersion.split('/');
  if (!group || !apiVersion) {
    throw new Error(`Application instance apiVersion ${target.apiVersion} is not a grouped Kubernetes API version.`);
  }
  // Deletion depends only on the immutable generated lifecycle identity. Do
  // not re-evaluate the authored application: doing so unnecessarily reruns
  // callback capture and provider construction, and can make a valid deployed
  // application impossible to remove after its source or build environment
  // changes. TypeKro discovers the live CRD, instance, finalizer, and recorded
  // hoisted namespaces from this minimal identity-preserving composition.
  const resourceEntries = (await generatedApplicationLifecycleResourceEntries(bundlePath, target.resourceGraphDefinitionName))
    .filter((entry) => !concreteSpec || entry.includeWhen.every((condition) => {
      const active = resolveApplicationInstallationValues(condition, concreteSpec);
      if (typeof active !== 'boolean') {
        throw new Error(`Generated ResourceGraphDefinition/${target.resourceGraphDefinitionName} resource ${entry.id} includeWhen must resolve to a boolean.`);
      }
      return active;
    }));
  const lifecycle = toResourceGraph(
    {
      name: target.resourceGraphDefinitionName,
      group,
      apiVersion,
      kind: target.kind,
      spec: type({}),
      status: type({}),
    },
    () => Object.fromEntries(resourceEntries.map((entry) => {
      const source = entry.externalRef ?? entry.template;
      if (!source) throw new Error(`Generated lifecycle resource ${entry.id} has no source.`);
      const apiVersion = Reflect.get(source, 'apiVersion');
      const kind = Reflect.get(source, 'kind');
      const metadata = Reflect.get(source, 'metadata');
      const name = metadata && typeof metadata === 'object' ? Reflect.get(metadata, 'name') : undefined;
      const namespace = metadata && typeof metadata === 'object' ? Reflect.get(metadata, 'namespace') : undefined;
      const resolvedName = concreteSpec ? resolveApplicationInstallationValues(name, concreteSpec) : name;
      const resolvedNamespace = concreteSpec ? resolveApplicationInstallationValues(namespace, concreteSpec) : namespace;
      if (typeof apiVersion !== 'string' || typeof kind !== 'string' || typeof resolvedName !== 'string') {
        throw new Error(`Generated lifecycle resource ${entry.id} has no concrete apiVersion, kind, and metadata.name.`);
      }
      if (resolvedNamespace !== undefined && typeof resolvedNamespace !== 'string') {
        throw new Error(`Generated lifecycle resource ${entry.id} has a non-string metadata.namespace.`);
      }
      const resource = entry.externalRef
        ? externalRef({ apiVersion, kind, metadata: { name: resolvedName, ...(resolvedNamespace ? { namespace: resolvedNamespace } : {}) }, id: entry.id })
        : createResource({ apiVersion, kind, metadata: { name: resolvedName, ...(resolvedNamespace ? { namespace: resolvedNamespace } : {}) }, id: entry.id });
      return [entry.id, resource];
    })),
    () => ({}),
  );
  return lifecycle as TypeKroApplicationComposition;
}

async function readGeneratedApplicationInstanceSpec(
  kubeConfig: InstanceType<typeof import('@kubernetes/client-node').KubeConfig>,
  kubernetes: typeof import('@kubernetes/client-node'),
  target: GeneratedApplicationDeleteTarget,
): Promise<Readonly<Record<string, unknown>> | undefined> {
  const [group, version] = target.apiVersion.split('/');
  if (!group || !version) return undefined;
  const crds = await makeKubernetesApiClient(kubeConfig, kubernetes.ApiextensionsV1Api).listCustomResourceDefinition({});
  const plural = crds.items.find((candidate) => candidate.spec.group === group
    && candidate.spec.names.kind === target.kind
    && candidate.spec.versions.some((candidateVersion) => candidateVersion.name === version && candidateVersion.served))?.spec.names.plural;
  if (!plural) return undefined;
  return makeKubernetesApiClient(kubeConfig, kubernetes.CustomObjectsApi).getNamespacedCustomObject({
    group,
    version,
    namespace: target.controlPlaneNamespace,
    plural,
    name: target.instanceName,
  }).then((resource) => {
    const spec = resource && typeof resource === 'object' ? Reflect.get(resource, 'spec') : undefined;
    return spec && typeof spec === 'object' && !Array.isArray(spec)
      ? spec as Readonly<Record<string, unknown>>
      : undefined;
  }).catch((cause: unknown) => {
    if (kubernetesStatusCode(cause) === 404) return undefined;
    throw cause;
  });
}

interface GeneratedApplicationLifecycleResourceEntry {
  readonly id: string;
  readonly template?: Readonly<Record<string, unknown>>;
  readonly externalRef?: Readonly<Record<string, unknown>>;
  readonly includeWhen: readonly string[];
}

async function generatedApplicationLifecycleResourceEntries(
  bundlePath: string,
  resourceGraphDefinitionName: string,
): Promise<readonly GeneratedApplicationLifecycleResourceEntry[]> {
  const resources = JSON.parse(await readFile(join(dirname(bundlePath), 'resources.json'), 'utf8')) as unknown;
  if (!Array.isArray(resources)) throw new Error('Generated TypeKro resources.json must contain an array.');
  const definition = resources.find((resource) => {
    if (!resource || typeof resource !== 'object' || Reflect.get(resource, 'kind') !== 'ResourceGraphDefinition') return false;
    const metadata = Reflect.get(resource, 'metadata');
    return metadata && typeof metadata === 'object' && Reflect.get(metadata, 'name') === resourceGraphDefinitionName;
  });
  const spec = definition && typeof definition === 'object' ? Reflect.get(definition, 'spec') : undefined;
  const entries = spec && typeof spec === 'object' ? Reflect.get(spec, 'resources') : undefined;
  if (!Array.isArray(entries)) {
    throw new Error(`Generated ResourceGraphDefinition/${resourceGraphDefinitionName} has no resource list for lifecycle deletion.`);
  }
  return entries.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`Generated ResourceGraphDefinition/${resourceGraphDefinitionName} resource ${index} is not an object.`);
    }
    const id = Reflect.get(entry, 'id');
    const template = Reflect.get(entry, 'template');
    const reference = Reflect.get(entry, 'externalRef');
    const includeWhen = Reflect.get(entry, 'includeWhen');
    if (typeof id !== 'string' || !id.trim()) {
      throw new Error(`Generated ResourceGraphDefinition/${resourceGraphDefinitionName} resource ${index} has no stable id.`);
    }
    if ((!template || typeof template !== 'object') === (!reference || typeof reference !== 'object')) {
      throw new Error(`Generated ResourceGraphDefinition/${resourceGraphDefinitionName} resource ${id} must contain exactly one template or externalRef.`);
    }
    if (includeWhen !== undefined && (!Array.isArray(includeWhen) || includeWhen.some((condition) => typeof condition !== 'string'))) {
      throw new Error(`Generated ResourceGraphDefinition/${resourceGraphDefinitionName} resource ${id} has invalid includeWhen expressions.`);
    }
    return {
      id,
      ...(template && typeof template === 'object' ? { template: template as Readonly<Record<string, unknown>> } : {}),
      ...(reference && typeof reference === 'object' ? { externalRef: reference as Readonly<Record<string, unknown>> } : {}),
      includeWhen: (includeWhen ?? []) as readonly string[],
    };
  });
}

async function loadTypeKroCompositionEntrypoint(
  entrypoint: string,
  exportName: string,
): Promise<TypeKroApplicationComposition> {
  let module: Readonly<Record<string, unknown>>;
  try {
    // static-import-exception: the user-selected compiled or TypeScript entrypoint is a runtime path and cannot be a static module specifier.
    module = await import(pathToFileURL(entrypoint).href) as Readonly<Record<string, unknown>>;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(
      `Unable to load TypeKro composition entrypoint ${entrypoint} for lifecycle deletion. Run the CLI with Bun for TypeScript entrypoints or pass the built JavaScript entrypoint. ${detail}`,
      { cause },
    );
  }
  const composition = module[exportName];
  if (!composition || (typeof composition !== 'object' && typeof composition !== 'function') || typeof Reflect.get(composition, 'factory') !== 'function') {
    throw new Error(`Entrypoint ${entrypoint} does not export TypeKro composition ${exportName}.`);
  }
  return composition as TypeKroApplicationComposition;
}

// typecast-boundary: the compiler-owned bundle is parsed only for its validated operator artifact references.
async function buildGeneratedImages(
  bundlePath: string,
  context: string,
  registry: ResolvedApplicationContainerRegistry,
  io: CliIo,
): Promise<readonly ApplicationImageReceipt[]> {
  const bundle = JSON.parse(await readFile(bundlePath, 'utf8')) as {
    readonly spec?: {
      readonly operators?: readonly { readonly name?: string; readonly outDir?: string }[];
      readonly migrations?: readonly GeneratedContainerBundleEntry[];
      readonly processors?: readonly GeneratedContainerBundleEntry[];
      readonly workflows?: readonly GeneratedContainerBundleEntry[];
      readonly reactive?: readonly GeneratedContainerBundleEntry[];
    };
  };
  const receipts = new Map<string, ApplicationImageReceipt>();
  for (const operator of bundle.spec?.operators ?? []) {
    if (!operator.outDir) throw new Error(`Generated TypeKro operator ${operator.name ?? '<unnamed>'} does not declare its artifact directory.`);
    const kubernetesDir = resolve(operator.outDir, 'kubernetes');
    const deploymentFiles = (await readdir(kubernetesDir)).filter((file) => file.startsWith('deployment-') && file.endsWith('.yaml')).sort();
    if (deploymentFiles.length !== 1) throw new Error(`Generated operator ${operator.name ?? operator.outDir} must emit exactly one deployment manifest before local image build.`);
    // typecast: the exact-one-file guard proves this array element exists.
    const deployment = await readFile(resolve(kubernetesDir, deploymentFiles[0] as string), 'utf8');
    const image = /^\s*image:\s*(\S+)\s*$/m.exec(deployment)?.[1];
    if (!image) throw new Error(`Generated operator ${operator.name ?? operator.outDir} deployment does not declare a runtime image.`);
    const dockerfilePath = resolve(operator.outDir, 'Dockerfile.applik8s-runtime');
    const dockerfile = await readFile(dockerfilePath, 'utf8');
    const baseImage = /^ARG APPLIK8S_BASE_IMAGE=(\S+)$/m.exec(dockerfile)?.[1];
    if (!baseImage) throw new Error(`Generated operator ${operator.name ?? operator.outDir} Dockerfile does not declare APPLIK8S_BASE_IMAGE.`);
    let materializedBaseImage = baseImage;
    if (isFrameworkOperatorHostImage(baseImage)) {
      let hostReceipt = receipts.get(baseImage);
      if (!hostReceipt) {
        hostReceipt = await buildFrameworkOperatorHost(baseImage, io.cwd, context, registry, io);
        if (hostReceipt) receipts.set(baseImage, hostReceipt);
      }
      materializedBaseImage = hostReceipt?.publishedImage ?? hostReceipt?.immutableImage ?? baseImage;
    }
    const bundleDigest = /^LABEL .*"applik8s\.dev\/bundle-digest"="sha256:([a-f0-9]{64})"/m.exec(dockerfile)?.[1];
    if (!bundleDigest) throw new Error(`Generated operator ${operator.name ?? operator.outDir} Dockerfile does not declare a full content bundle digest.`);
    const sourceDigest = await generatedOperatorSourceDigest(operator.outDir, dockerfile, materializedBaseImage, bundleDigest);
    const imageParts = splitTaggedImage(image);
    receipts.set(image, await buildApplicationContainer({
      logicalImage: image,
      imageName: imageParts.imageName,
      tag: registry.remote ? `sha-${sourceDigest}` : imageParts.tag,
      contextPath: operator.outDir,
      dockerfilePath,
      buildArgs: { APPLIK8S_BASE_IMAGE: materializedBaseImage },
      sourceDigest,
      artifact: { class: 'operator', name: operator.name ?? imageParts.imageName },
    }, context, registry, io));
  }
  const generatedContainers = [
    ...(bundle.spec?.migrations ?? []).map((entry) => ({ entry, artifactClass: 'migration' as const })),
    ...(bundle.spec?.processors ?? []).map((entry) => ({ entry, artifactClass: 'command-processor' as const })),
    ...(bundle.spec?.workflows ?? []).map((entry) => ({ entry, artifactClass: 'workflow-worker' as const })),
    ...(bundle.spec?.reactive ?? []).map((entry) => ({ entry, artifactClass: 'reactive-worker' as const })),
  ];
  for (const { entry: artifact, artifactClass } of generatedContainers) {
    const recipe = artifact.container;
    if (!recipe) throw new Error(`Generated workload ${artifact.name ?? '<unnamed>'} does not declare an OCI container artifact.`);
    receipts.set(recipe.image, await buildGeneratedContainer(recipe, context, registry, {
      class: artifactClass,
      name: artifact.name ?? recipe.imageName,
    }, io));
  }
  const hostDirectory = resolve(dirname(bundlePath), 'application-host');
  const hostManifestPath = resolve(hostDirectory, 'application-host.json');
  if (await access(hostManifestPath).then(() => true).catch(() => false)) {
    const host = JSON.parse(await readFile(hostManifestPath, 'utf8')) as {
      readonly spec?: { readonly image?: string; readonly dockerfile?: string; readonly context?: string; readonly artifactDigest?: string };
    };
    const image = host.spec?.image;
    if (!image) throw new Error('Generated ApplicationHost artifact does not declare an image.');
    const artifactDigest = /^sha256:([a-f0-9]{64})$/.exec(host.spec?.artifactDigest ?? '')?.[1];
    if (!artifactDigest) throw new Error('Generated ApplicationHost artifact does not declare a full content artifact digest.');
    const imageParts = splitTaggedImage(image);
    receipts.set(image, await buildApplicationContainer({
      logicalImage: image,
      imageName: imageParts.imageName,
      tag: registry.remote ? `sha-${artifactDigest}` : imageParts.tag,
      contextPath: resolve(hostDirectory, host.spec?.context ?? '.'),
      dockerfilePath: resolve(hostDirectory, host.spec?.dockerfile ?? 'Dockerfile.applik8s-host'),
      sourceDigest: artifactDigest,
      artifact: { class: 'application-host', name: imageParts.imageName },
    }, context, registry, io));
  }
  return [...receipts.values()];
}

function isFrameworkOperatorHostImage(image: string): boolean {
  return /(?:^|\/)applik8s-operator-host(?::|@)/.test(image);
}

async function buildFrameworkOperatorHost(
  logicalImage: string,
  startDirectory: string,
  context: string,
  registry: ResolvedApplicationContainerRegistry,
  io: CliIo,
): Promise<ApplicationImageReceipt | undefined> {
  const sourceRoot = await findAncestorContaining(startDirectory, 'Dockerfile.operator-host');
  if (!sourceRoot) return undefined;
  const sourceDigest = await operatorHostSourceDigest(sourceRoot);
  return buildApplicationContainer({
    logicalImage,
    imageName: 'applik8s-operator-host',
    tag: `sha-${sourceDigest}`,
    contextPath: sourceRoot,
    dockerfilePath: resolve(sourceRoot, 'Dockerfile.operator-host'),
    sourceDigest,
    artifact: { class: 'operator-host', name: 'applik8s-operator-host' },
    // A clean Rust host build can exceed TypeKro's generic five-minute image
    // default on local builders. Keep it bounded, but give the framework build
    // enough room to compile before generated application images reuse it.
    buildTimeoutMs: 15 * 60_000,
  }, context, registry, io);
}

async function findAncestorContaining(startDirectory: string, file: string): Promise<string | undefined> {
  let current = resolve(startDirectory);
  while (true) {
    if (await access(resolve(current, file)).then(() => true).catch(() => false)) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export async function resolveApplicationBuildPackage(entrypoint: string): Promise<{
  readonly directory: string;
  readonly name?: string;
}> {
  const directory = await findAncestorContaining(dirname(resolve(entrypoint)), 'package.json');
  if (!directory) {
    throw new Error(`Application entrypoint ${entrypoint} is not contained by a package.json. Add an application package with a build script, or pass --skip-app-build for an operator-only application.`);
  }
  const path = resolve(directory, 'package.json');
  let manifest: { readonly name?: unknown; readonly scripts?: unknown };
  try {
    manifest = JSON.parse(await readFile(path, 'utf8')) as { readonly name?: unknown; readonly scripts?: unknown };
  } catch (cause) {
    throw new Error(`Application package manifest ${path} is invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  const scripts = manifest.scripts && typeof manifest.scripts === 'object' && !Array.isArray(manifest.scripts)
    ? manifest.scripts
    : undefined;
  const build = scripts ? Reflect.get(scripts, 'build') : undefined;
  if (typeof build !== 'string' || !build.trim()) {
    const label = typeof manifest.name === 'string' && manifest.name.trim() ? manifest.name : directory;
    throw new Error(`Application package ${label} containing ${entrypoint} has no non-empty build script. Add scripts.build, or pass --skip-app-build only when the application has no build-time host assets.`);
  }
  return {
    directory,
    ...(typeof manifest.name === 'string' && manifest.name.trim() ? { name: manifest.name } : {}),
  };
}

async function operatorHostSourceDigest(sourceRoot: string): Promise<string> {
  const rootFiles = ['Cargo.toml', 'Cargo.lock', 'Dockerfile.operator-host'];
  const crateFiles = (await readdir(resolve(sourceRoot, 'crates'), { recursive: true }))
    .filter((path) => /(?:\.rs|\.toml)$/.test(path))
    .map((path) => `crates/${path}`);
  const files = [...rootFiles, ...crateFiles].sort();
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update('\0');
    hash.update(await readFile(resolve(sourceRoot, file)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

async function generatedOperatorSourceDigest(
  operatorRoot: string,
  dockerfile: string,
  materializedBaseImage: string,
  bundleDigest: string,
): Promise<string> {
  const manifestPath = resolve(operatorRoot, 'operator-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    readonly spec?: {
      readonly handlerArtifact?: { readonly digest?: string };
      readonly container?: { readonly image?: { readonly tag?: string } };
    };
  };
  const handlerDigest = manifest.spec?.handlerArtifact?.digest;
  const bundleTag = manifest.spec?.container?.image?.tag;
  if (!handlerDigest || !/^sha256:[a-f0-9]{64}$/.test(handlerDigest) || !bundleTag) {
    throw new Error(`Generated operator at ${operatorRoot} is missing its component digest or bundle tag.`);
  }
  const packageEntry = fileURLToPath(import.meta.resolve('@bytecodealliance/componentize-js'));
  const componentizePackage = JSON.parse(await readFile(resolve(dirname(packageEntry), '../package.json'), 'utf8')) as { readonly version?: string };
  if (!componentizePackage.version) throw new Error('Unable to determine the ComponentizeJS version for operator source identity.');
  const normalizedManifest = JSON.stringify(manifest)
    .replaceAll(handlerDigest, 'sha256:__COMPONENT_BYTES__')
    .replaceAll(`sha256:${bundleDigest}`, 'sha256:__BUNDLE_BYTES__')
    .replaceAll(bundleTag, '__BUNDLE_TAG__');
  const normalizedDockerfile = dockerfile.replaceAll(`sha256:${bundleDigest}`, 'sha256:__BUNDLE_BYTES__');
  const files = [
    'bundle/handler.js',
    'bundle/handler.js.map',
    'contract/applik8s-handler.wit',
    'contract/runtime-contract.json',
  ];
  const hash = createHash('sha256');
  hash.update(`componentize-js@${componentizePackage.version}\0`);
  hash.update(`base-image\0${materializedBaseImage}\0`);
  hash.update(`Dockerfile.applik8s-runtime\0${normalizedDockerfile}\0`);
  hash.update(`operator-manifest.json\0${normalizedManifest}\0`);
  for (const file of files) {
    hash.update(`${file}\0`);
    hash.update(await readFile(resolve(operatorRoot, file)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

interface GeneratedContainerBundleEntry {
  readonly name?: string;
  readonly container?: GeneratedContainerRecipe;
}

interface GeneratedContainerRecipe {
  readonly image: string;
  readonly imageName: string;
  readonly tag: string;
  readonly baseImage: string;
  readonly contextPath: string;
  readonly dockerfilePath: string;
  readonly entrypoint: string;
  readonly command: readonly string[];
  readonly sourceDigest: string;
}

async function buildGeneratedContainer(
  recipe: GeneratedContainerRecipe,
  context: string,
  registry: ResolvedApplicationContainerRegistry,
  artifact: NonNullable<ApplicationImageReceipt['artifact']>,
  io: CliIo,
): Promise<ApplicationImageReceipt> {
  return buildApplicationContainer({
    logicalImage: recipe.image,
    imageName: recipe.imageName,
    tag: recipe.tag,
    contextPath: recipe.contextPath,
    dockerfilePath: recipe.dockerfilePath,
    buildArgs: { APPLIK8S_BASE_IMAGE: recipe.baseImage },
    sourceDigest: recipe.sourceDigest,
    artifact,
  }, context, registry, io);
}

interface ApplicationContainerBuildInput {
  readonly logicalImage: string;
  readonly imageName: string;
  readonly tag: string;
  readonly contextPath: string;
  readonly dockerfilePath: string;
  readonly buildArgs?: Readonly<Record<string, string>>;
  readonly sourceDigest?: string;
  readonly artifact?: NonNullable<ApplicationImageReceipt['artifact']>;
  readonly buildTimeoutMs?: number;
}

interface TypeKroContainerModule {
  container(options: Readonly<Record<string, unknown>>): Promise<{
    readonly imageUri: string;
    readonly taggedImageUri: string;
    readonly digest?: string;
    readonly pushed?: boolean;
    readonly platforms?: readonly string[];
  }>;
  harbor(options: Readonly<Record<string, unknown>>): unknown;
  ociRegistry(options: Readonly<Record<string, unknown>>): unknown;
  kubernetesSecretRegistryCredentials(options: Readonly<Record<string, unknown>>): unknown;
}

interface TypeKroKubernetesModule {
  namespace(resource: Readonly<Record<string, unknown>>): unknown;
  secret(resource: Readonly<Record<string, unknown>>): unknown;
}

interface TypeKroCompositionModule {
  kubernetesComposition(
    definition: Readonly<Record<string, unknown>>,
    composition: (spec: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>>,
  ): {
    factory(mode: 'direct', options: Readonly<Record<string, unknown>>): TypeKroDirectFactory;
  };
}

interface TypeKroDirectFactory {
  deploy(
    spec: Readonly<Record<string, unknown>>,
    options?: { readonly instanceNameOverride?: string; readonly targetScopes?: readonly string[] },
  ): Promise<unknown>;
  deleteInstance(
    name: string,
    options?: { readonly scopes?: readonly string[]; readonly includeUnscopedResources?: boolean },
  ): Promise<void>;
}

export interface TypeKroApplicationComposition {
  factory(mode: 'kro', options: Readonly<Record<string, unknown>>): {
    deleteInstance(name: string): Promise<void>;
  };
}

interface TypeKroHarborModule {
  HarborApiClient: new (options: Readonly<Record<string, unknown>>) => TypeKroHarborApiClient;
  reconcileHarborProject(
    client: unknown,
    options: Readonly<Record<string, unknown>>,
  ): Promise<unknown>;
  deleteHarborProject(
    client: unknown,
    project: string,
    options: Readonly<Record<string, unknown>>,
  ): Promise<void>;
}

interface TypeKroHarborApiClient {
  request(
    request: Readonly<{
      method: 'GET' | 'DELETE';
      path: string;
    }>,
    allowedStatuses?: readonly number[],
  ): Promise<Readonly<{ status: number; body?: unknown }>>;
}

interface TypeKroValkeyModule {
  readonly valkeyBootstrap: {
    factory(mode: 'direct', options: Readonly<Record<string, unknown>>): TypeKroDirectFactory;
  };
}

interface TypeKroRookModule {
  readonly rookObjectStorageClaim: {
    factory(mode: 'direct', options: Readonly<Record<string, unknown>>): TypeKroDirectFactory;
  };
}

interface TypeKroOryModule {
  readonly oryIdentityStack: {
    factory(mode: 'direct', options: Readonly<Record<string, unknown>>): TypeKroDirectFactory;
  };
  readonly oryPlatformStack: {
    factory(mode: 'direct', options: Readonly<Record<string, unknown>>): TypeKroDirectFactory;
  };
}

async function buildApplicationContainer(
  input: ApplicationContainerBuildInput,
  context: string,
  resolved: ResolvedApplicationContainerRegistry,
  io: CliIo,
): Promise<ApplicationImageReceipt> {
  // static-import-exception: TypeKro remains a deployment-only boundary and is loaded after the
  // application graph has selected a concrete registry implementation.
  const typeKro = await importProjectModule<TypeKroContainerModule>('typekro/containers', input.contextPath);
  const registry = typeKroRegistryConfig(typeKro, resolved, context);
  const existing = await reuseExistingImmutableHarborImage(input, resolved, registry);
  if (existing) {
    io.stdout(`Reusing immutable ${applicationContainerLabel(input)} ${existing.taggedImage} (${existing.digest})`);
    return existing;
  }
  io.stdout(`Building ${applicationContainerLabel(input)} ${input.imageName}:${input.tag}`);
  const dockerfile = relativeDockerfile(input.contextPath, input.dockerfilePath);
  const built = await typeKro.container({
    id: `${input.imageName}:${input.tag}`,
    context: input.contextPath,
    dockerfile,
    imageName: input.imageName,
    tag: input.tag,
    ...(input.buildArgs ? { buildArgs: { ...input.buildArgs } } : {}),
    ...(input.buildTimeoutMs ? { timeout: input.buildTimeoutMs } : {}),
    registry,
  });
  if (resolved.remote && (!built.digest || !built.imageUri.includes('@sha256:'))) {
    throw new Error(`TypeKro did not return a registry-verified immutable digest for ${input.logicalImage}.`);
  }
  // The framework host is a build input, not a directly deployed workload.
  // Local source builds intentionally retag it by source digest before using
  // it as APPLIK8S_BASE_IMAGE for the generated operator image. Every actual
  // workload must still resolve to the exact compiler-logical local image.
  const localBuildInputRetag = input.artifact?.class === 'operator-host';
  if (!resolved.remote && !localBuildInputRetag && built.imageUri !== input.logicalImage) {
    throw new Error(`TypeKro resolved ${built.imageUri}, but the local compiled workload requires ${input.logicalImage}.`);
  }
  return {
    logicalImage: input.logicalImage,
    immutableImage: resolved.remote && built.digest
      ? applicationPullImageReference(resolved, input.imageName, built.digest)
      : built.imageUri,
    ...(resolved.remote ? { publishedImage: built.imageUri } : {}),
    taggedImage: built.taggedImageUri,
    ...(built.digest ? { digest: built.digest } : {}),
    // TypeKro's public ContainerImage contract represents successful remote
    // publication with a registry-verified digest URI and no longer duplicates
    // that fact with the low-level builder's `pushed` flag.
    pushed: resolved.remote ? Boolean(built.digest && built.imageUri.includes('@sha256:')) : false,
    publication: 'built',
    ...(input.sourceDigest ? { sourceDigest: input.sourceDigest } : {}),
    ...(built.platforms ? { platforms: built.platforms } : {}),
    ...(input.artifact ? { artifact: input.artifact } : {}),
  };
}

async function reuseExistingImmutableHarborImage(
  input: ApplicationContainerBuildInput,
  resolved: ResolvedApplicationContainerRegistry,
  registry: unknown,
): Promise<ApplicationImageReceipt | undefined> {
  const provider = resolved.provider;
  if (
    provider.kind !== 'harbor-container-registry'
    || provider.management?.immutableTags?.tagPattern !== 'sha-*'
    || !resolved.origin
    || !resolved.repositoryPrefix
    || !/^sha-[a-f0-9]{64}$/.test(input.tag)
  ) return undefined;
  const credentialProvider = registry && typeof registry === 'object'
    ? Reflect.get(registry, 'credentialProvider')
    : undefined;
  if (typeof credentialProvider !== 'function') {
    throw new Error(`Managed immutable Harbor image ${input.imageName}:${input.tag} requires an execution-time push credential provider.`);
  }
  const credential = await credentialProvider() as { readonly username?: unknown; readonly password?: unknown };
  if (typeof credential.username !== 'string' || typeof credential.password !== 'string') {
    throw new Error(`Managed immutable Harbor image ${input.imageName}:${input.tag} resolved invalid registry credentials.`);
  }
  const repository = `${resolved.repositoryPrefix}/${input.imageName}`;
  const digest = await readOciManifestDigest(
    resolved.origin,
    repository,
    input.tag,
    { username: credential.username, password: credential.password },
    provider.tls,
  );
  if (!digest) return undefined;
  const taggedImage = `${new URL(resolved.origin).host}/${repository}:${input.tag}`;
  return {
    logicalImage: input.logicalImage,
    immutableImage: `${new URL(resolved.pullOrigin ?? resolved.origin).host}/${repository}@${digest}`,
    publishedImage: `${new URL(resolved.origin).host}/${repository}@${digest}`,
    taggedImage,
    digest,
    pushed: true,
    publication: 'reused',
    ...(input.sourceDigest ? { sourceDigest: input.sourceDigest } : {}),
    ...(input.artifact ? { artifact: input.artifact } : {}),
  };
}

function applicationContainerLabel(input: ApplicationContainerBuildInput): string {
  const name = input.artifact?.name ?? input.imageName;
  switch (input.artifact?.class) {
    case 'operator-host': return `framework operator host ${name}`;
    case 'operator': return `generated operator ${name}`;
    case 'migration': return `generated migration ${name}`;
    case 'command-processor': return `generated command processor ${name}`;
    case 'workflow-worker': return `generated workflow worker ${name}`;
    case 'reactive-worker': return `generated reactive worker ${name}`;
    case 'application-host': return `generated application host ${name}`;
    default: return `application image ${name}`;
  }
}

function applicationPullImageReference(
  resolved: ResolvedApplicationContainerRegistry,
  imageName: string,
  digest: string,
): string {
  const origin = resolved.pullOrigin ?? resolved.origin;
  if (!origin) throw new Error(`Remote image ${imageName} has no pull endpoint.`);
  const repository = resolved.repositoryPrefix ? `${resolved.repositoryPrefix}/${imageName}` : imageName;
  return `${new URL(origin).host}/${repository}@${digest}`;
}

async function readOciManifestDigest(
  origin: string,
  repository: string,
  tag: string,
  credential: { readonly username: string; readonly password: string },
  tls: ApplicationContainerRegistryTls | undefined,
): Promise<string | undefined> {
  const target = new URL(`/v2/${repository.split('/').map(encodeURIComponent).join('/')}/manifests/${encodeURIComponent(tag)}`, origin);
  const ca = tls?.caFile ? await readFile(resolve(tls.caFile)) : undefined;
  return new Promise((resolveDigest, reject) => {
    const outgoing = (target.protocol === 'https:' ? https : http).request({
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: `${target.pathname}${target.search}`,
      method: 'HEAD',
      agent: false,
      headers: {
        Accept: 'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json',
        Authorization: `Basic ${Buffer.from(`${credential.username}:${credential.password}`, 'utf8').toString('base64')}`,
        connection: 'close',
      },
      ...(target.protocol === 'https:' ? {
        rejectUnauthorized: tls?.insecure !== true,
        ...(ca ? { ca } : {}),
      } : {}),
    }, (incoming) => {
      incoming.resume();
      incoming.on('end', () => {
        if (incoming.statusCode === 404) return resolveDigest(undefined);
        if (incoming.statusCode !== 200) {
          return reject(new Error(`OCI manifest lookup for ${repository}:${tag} returned HTTP ${incoming.statusCode ?? 0}.`));
        }
        const digest = incoming.headers['docker-content-digest'];
        if (typeof digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(digest)) {
          return reject(new Error(`OCI manifest lookup for ${repository}:${tag} did not return a valid Docker-Content-Digest.`));
        }
        resolveDigest(digest);
      });
    });
    outgoing.on('error', reject);
    outgoing.setTimeout(30_000, () => outgoing.destroy(new Error(`OCI manifest lookup timed out for ${repository}:${tag}.`)));
    outgoing.on('socket', (socket) => socket.unref());
    outgoing.end();
  });
}

function typeKroRegistryConfig(
  typeKro: TypeKroContainerModule,
  resolved: ResolvedApplicationContainerRegistry,
  context: string,
): unknown {
  const provider = resolved.provider;
  if (provider.kind === 'orbstack-container-registry') return { type: 'orbstack' };
  if (!resolved.origin) throw new Error('Remote ContainerRegistry endpoint did not resolve to an origin.');
  const credentials = provider.pushCredentials
    ? typeKro.kubernetesSecretRegistryCredentials({
        namespace: provider.pushCredentials.namespace,
        name: provider.pushCredentials.name,
        registry: resolved.origin,
        context,
        ...(provider.pushCredentials.usernameKey ? { usernameKey: provider.pushCredentials.usernameKey } : {}),
        ...(provider.pushCredentials.passwordKey ? { passwordKey: provider.pushCredentials.passwordKey } : {}),
        ...(provider.pushCredentials.dockerConfigJsonKey ? { dockerConfigJsonKey: provider.pushCredentials.dockerConfigJsonKey } : {}),
      })
    : undefined;
  const plainHttp = provider.endpoint.kind === 'kubernetes-node-port'
    ? provider.endpoint.protocol === 'http'
    : provider.endpoint.origin.startsWith('http://');
  const tls = {
    ...provider.tls,
    ...(plainHttp ? { plainHttp: true } : {}),
  };
  const common = {
    registry: resolved.origin,
    ...(credentials ? { credentialProvider: credentials } : {}),
    ...(Object.keys(tls).length > 0 ? { tls } : {}),
  };
  return provider.kind === 'harbor-container-registry'
    ? typeKro.harbor({ ...common, project: provider.project })
    : typeKro.ociRegistry({ ...common, ...(provider.repositoryPrefix ? { repositoryPrefix: provider.repositoryPrefix } : {}) });
}

function typeKroContainerRegistryPreparationRuntime(
  io: CliIo,
): ApplicationContainerRegistryPreparationRuntime {
  return {
    async ensureNamespace(context, namespaceName) {
      return ensureDirectNamespace(io, context, namespaceName, 'container-registry');
    },
    async deleteNamespace(context, receipt) {
      await deleteDirectNamespace(io, context, receipt);
    },
    async reconcileHarborProject(request) {
      await reconcileTypeKroHarborProject(request, io);
    },
    async deleteHarborProject(request) {
      await deleteTypeKroHarborProject(request, io);
    },
  };
}

async function directNamespacePreparationFactory(
  io: CliIo,
  context: string,
  purpose: NonNullable<ApplicationDirectNamespacePreparationReceipt['purpose']> = 'container-registry',
): Promise<{
  readonly factory: TypeKroDirectFactory;
  readonly kubeConfig: InstanceType<typeof import('@kubernetes/client-node').KubeConfig>;
  readonly kubernetes: typeof import('@kubernetes/client-node');
}> {
  const typeKro = await importProjectModule<TypeKroCompositionModule>('typekro', io.cwd);
  const typeKroKubernetes = await importProjectModule<TypeKroKubernetesModule>('typekro/kubernetes', io.cwd);
  // static-import-exception: direct preparation dependencies load only for mutation commands so compile-only consumers do not eagerly initialize them.
  const { type } = await import('arktype');
  // static-import-exception: the Kubernetes SDK is an optional live-deployment dependency at the CLI boundary.
  const kubernetes = await import('@kubernetes/client-node');
  const kubeConfig = new kubernetes.KubeConfig();
  kubeConfig.loadFromDefault();
  kubeConfig.setCurrentContext(context);
  const namespacePreparation = typeKro.kubernetesComposition(
    {
      name: `applik8s-${purpose}-namespace`,
      apiVersion: 'deployment.applik8s.dev/v1alpha1',
      kind: purpose === 'container-registry'
        ? 'ContainerRegistryNamespace'
        : purpose === 'application-host'
          ? 'ApplicationHostNamespace'
          : purpose === 'provider-control-plane'
            ? 'ProviderControlPlaneNamespace'
            : purpose === 'identity-infrastructure'
              ? 'IdentityInfrastructureNamespace'
              : 'ApplicationControlPlaneNamespace',
      spec: type({ name: 'string' }),
      status: type({ ready: 'boolean' }),
    },
    (spec) => {
      typeKroKubernetes.namespace({
        id: 'credentialNamespace',
        metadata: {
          name: spec.name,
          labels: {
            // This Namespace is applied by TypeKro direct mode before the
            // owner RGD exists. Nested provider graphs (notably JetStream)
            // may later co-own the same standard label, so its value must be
            // identical across the preparation and KRO paths.
            'app.kubernetes.io/managed-by': 'typekro',
            'applik8s.dev/direct-preparation': purpose,
            'applik8s.dev/direct-preparation-instance': spec.name,
          },
        },
      });
      return { ready: true };
    },
  );
  return {
    kubernetes,
    kubeConfig,
    factory: namespacePreparation.factory('direct', {
      namespace: 'default',
      kubeConfig,
      waitForReady: true,
      // Namespace finalization includes every namespaced API and routinely
      // exceeds one minute on operator-heavy clusters. Keep the wait bounded,
      // but long enough for Kubernetes' namespace controller to finish.
      timeout: 5 * 60_000,
      conflictStrategy: 'patch',
    }),
  };
}

function directNamespacePreparationReceipt(
  namespace: string,
  ownership: ApplicationDirectNamespacePreparationReceipt['ownership'],
  purpose: NonNullable<ApplicationDirectNamespacePreparationReceipt['purpose']> = 'container-registry',
  created = false,
): ApplicationDirectNamespacePreparationReceipt {
  return {
    apiVersion: 'applik8s.deployment/v1alpha1',
    kind: 'DirectNamespacePreparation',
    namespace,
    instanceName: namespace,
    ownership,
    created,
    purpose,
  };
}

async function ensureDirectNamespace(
  io: CliIo,
  context: string,
  namespaceName: string,
  purpose: NonNullable<ApplicationDirectNamespacePreparationReceipt['purpose']>,
): Promise<ApplicationDirectNamespacePreparationReceipt> {
  const { factory, kubeConfig, kubernetes } = await directNamespacePreparationFactory(io, context, purpose);
  const existing = await makeKubernetesApiClient(kubeConfig, kubernetes.CoreV1Api).readNamespace({ name: namespaceName })
    .then((response) => response)
    .catch((cause: unknown) => {
      if (kubernetesStatusCode(cause) === 404) return undefined;
      throw cause;
    });
  const labels = existing?.metadata?.labels ?? {};
  const managed = labels['applik8s.dev/direct-preparation'] === purpose
    && labels['applik8s.dev/direct-preparation-instance'] === namespaceName;
  if (existing && !managed) {
    io.stdout(`Namespace ${namespaceName} already exists and remains externally owned for ${purpose} preparation`);
    return directNamespacePreparationReceipt(namespaceName, 'external', purpose, false);
  }
  io.stdout(`Preparing ${purpose} namespace ${namespaceName} through TypeKro direct mode`);
  await factory.deploy({ name: namespaceName });
  return directNamespacePreparationReceipt(namespaceName, 'managed', purpose, existing === undefined);
}

async function deleteDirectNamespace(
  io: CliIo,
  context: string,
  receipt: ApplicationDirectNamespacePreparationReceipt,
): Promise<void> {
  if (receipt.ownership !== 'managed') return;
  const purpose = receipt.purpose ?? 'container-registry';
  const { factory, kubeConfig, kubernetes } = await directNamespacePreparationFactory(io, context, purpose);
  const namespaceExists = await makeKubernetesApiClient(kubeConfig, kubernetes.CoreV1Api).readNamespace({ name: receipt.namespace })
    .then(() => true)
    .catch((cause: unknown) => {
      if (kubernetesStatusCode(cause) === 404) return false;
      throw cause;
    });
  if (!namespaceExists) {
    io.stdout(`Managed ${purpose} namespace ${receipt.namespace} is already absent; continuing idempotent cleanup`);
    return;
  }
  io.stdout(`Deleting ${purpose} namespace ${receipt.namespace} through TypeKro direct mode`);
  // TypeKro 0.28+ preserves scoped resources by default. Namespaces carry
  // cluster scope metadata, so explicit scope selection is required for an
  // owned direct preparation to be removed rather than silently retained.
  try {
    await factory.deleteInstance(receipt.instanceName, { scopes: ['cluster'] });
  } catch (cause) {
    const absent = await waitForAbsence(async () => makeKubernetesApiClient(kubeConfig, kubernetes.CoreV1Api)
      .readNamespace({ name: receipt.namespace })
      .then(() => false)
      .catch((readCause: unknown) => {
        if (kubernetesStatusCode(readCause) === 404) return true;
        throw readCause;
      }));
    if (!absent) throw cause;
    io.stdout(`Managed ${purpose} namespace ${receipt.namespace} reached 404 during TypeKro cleanup; continuing idempotently`);
  }
}

async function waitForAbsence(
  probe: () => Promise<boolean>,
  timeoutMs = 30_000,
  pollIntervalMs = 1_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  do {
    if (await probe()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, deadline - Date.now())));
  } while (Date.now() < deadline);
  return false;
}

function kubernetesStatusCode(cause: unknown): number | undefined {
  if (!cause || typeof cause !== 'object') return undefined;
  const direct = Reflect.get(cause, 'statusCode') ?? Reflect.get(cause, 'code');
  if (typeof direct === 'number') return direct;
  const response = Reflect.get(cause, 'response');
  if (response && typeof response === 'object') {
    const status = Reflect.get(response, 'statusCode') ?? Reflect.get(response, 'status');
    if (typeof status === 'number') return status;
  }
  return undefined;
}

/** Narrow TypeKro's cross-process idempotency signal without swallowing real cleanup failures. */
export function isTypeKroInstanceNotFound(cause: unknown): boolean {
  return Boolean(cause && typeof cause === 'object' && Reflect.get(cause, 'code') === 'INSTANCE_NOT_FOUND');
}

async function reconcileTypeKroHarborProject(
  request: ApplicationHarborProjectPreparationRequest,
  io: CliIo,
): Promise<void> {
  // Deliberately variable so Applik8s 0.27.1 consumers can compile before the Harbor subpath is
  // released. A managed Harbor binding fails with an actionable phase error until it is present.
  const harborSpecifier = 'typekro/harbor';
  let harborModule: TypeKroHarborModule;
  try {
    harborModule = await importProjectModule<TypeKroHarborModule>(harborSpecifier, io.cwd);
  } catch (cause) {
    const detail = cause instanceof Error ? ` ${cause.message}` : ` ${String(cause)}`;
    throw new Error(
      `Managed Harbor ContainerRegistry preparation requires a TypeKro release containing typekro/harbor.${detail}`,
      { cause },
    );
  }
  const typeKro = await importProjectModule<TypeKroContainerModule>('typekro/containers', io.cwd);
  const adminCredentials = typeKro.kubernetesSecretRegistryCredentials({
    namespace: request.adminCredentials.namespace,
    name: request.adminCredentials.name,
    context: request.context,
    ...(request.adminCredentials.username ? { username: request.adminCredentials.username } : {}),
    ...(request.adminCredentials.usernameKey ? { usernameKey: request.adminCredentials.usernameKey } : {}),
    ...(request.adminCredentials.passwordKey ? { passwordKey: request.adminCredentials.passwordKey } : {}),
    ...(request.adminCredentials.dockerConfigJsonKey ? { dockerConfigJsonKey: request.adminCredentials.dockerConfigJsonKey } : {}),
  });
  const ca = request.caFile ? await readFile(resolve(io.cwd, request.caFile)) : undefined;
  const client = new harborModule.HarborApiClient({
    endpoint: request.endpoint,
    credentialProvider: adminCredentials,
    allowPlainHttp: request.allowPlainHttp,
    rejectUnauthorized: !request.insecure,
    ...(ca ? { ca } : {}),
  });
  io.stdout(`Reconciling private Harbor project ${request.project} and purpose-scoped robot identities`);
  const robotsByRegistry = new Map<string, typeof request.robots[number][]>();
  for (const robot of request.robots) {
    const group = robotsByRegistry.get(robot.registry) ?? [];
    group.push(robot);
    robotsByRegistry.set(robot.registry, group);
  }
  for (const [registry, robots] of robotsByRegistry) {
    await harborModule.reconcileHarborProject(client, {
      project: {
        name: request.project,
        public: false,
        ...request.policy,
      },
      robots: robots.map(({ registry: _registry, ...robot }) => robot),
      secretNamespace: request.secretNamespace,
      registry,
      kubeConfig: { context: request.context },
    });
  }
}

async function deleteTypeKroHarborProject(
  request: import('./container-registry-preparation.js').ApplicationHarborProjectDeletionRequest,
  io: CliIo,
): Promise<void> {
  const harborModule = await importProjectModule<TypeKroHarborModule>('typekro/harbor', io.cwd);
  const typeKro = await importProjectModule<TypeKroContainerModule>('typekro/containers', io.cwd);
  const adminCredentials = typeKro.kubernetesSecretRegistryCredentials({
    namespace: request.adminCredentials.namespace,
    name: request.adminCredentials.name,
    context: request.context,
    ...(request.adminCredentials.username ? { username: request.adminCredentials.username } : {}),
    ...(request.adminCredentials.usernameKey ? { usernameKey: request.adminCredentials.usernameKey } : {}),
    ...(request.adminCredentials.passwordKey ? { passwordKey: request.adminCredentials.passwordKey } : {}),
    ...(request.adminCredentials.dockerConfigJsonKey ? { dockerConfigJsonKey: request.adminCredentials.dockerConfigJsonKey } : {}),
  });
  const ca = request.caFile ? await readFile(resolve(io.cwd, request.caFile)) : undefined;
  const client = new harborModule.HarborApiClient({
    endpoint: request.endpoint,
    credentialProvider: adminCredentials,
    allowPlainHttp: request.allowPlainHttp,
    rejectUnauthorized: !request.insecure,
    ...(ca ? { ca } : {}),
  });
  io.stdout(`Deleting installation-owned Harbor project ${request.project} after TypeKro finalization`);
  const timeoutMs = applicationHarborProjectDeletionTimeoutMs(request.timeoutMs);
  if (request.purgeRepositories) {
    await removeHarborProjectImmutableTagRulesForDeletion(client, request.project, io);
    await purgeHarborProjectRepositoriesForDeletion(client, request.project, { timeoutMs });
  }
  await harborModule.deleteHarborProject(client, request.project, {
    confirmProjectName: request.project,
    // Applik8s already purged with Harbor's required double encoding for nested
    // repository names. TypeKro remains authoritative for project convergence
    // and robot Secret cleanup.
    purgeRepositories: false,
    timeoutMs,
    secretNamespace: request.secretNamespace,
    robotSecretNames: [...new Set(request.robotSecretNames)],
    kubeConfig: { context: request.context },
  });
}

/** A project can contain dozens of asynchronously deleted OCI repositories; keep the wait bounded but operationally realistic. */
export function applicationHarborProjectDeletionTimeoutMs(requested?: number): number {
  return requested ?? 5 * 60_000;
}

interface HarborRepositoryPurgeOptions {
  readonly timeoutMs: number;
  readonly pollIntervalMs?: number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

/**
 * Purge every repository from one exact-name-confirmed project. Harbor requires
 * slashes inside `repository_name` to be URL encoded twice (for example,
 * `applik8s/web` -> `applik8s%252Fweb`); a single encode can be accepted without
 * deleting the nested repository. Keep listing, deletion, concurrency, and
 * convergence bounded.
 */
export async function purgeHarborProjectRepositoriesForDeletion(
  client: TypeKroHarborApiClient,
  project: string,
  options: HarborRepositoryPurgeOptions,
): Promise<void> {
  const deadline = Date.now() + options.timeoutMs;
  const pollIntervalMs = options.pollIntervalMs ?? 500;
  const sleep = options.sleep ?? (async (milliseconds: number) => {
    await new Promise<void>((resolveSleep) => setTimeout(resolveSleep, milliseconds));
  });
  const projectPath = `/projects/${encodeURIComponent(project)}`;

  while (Date.now() < deadline) {
    const repositories: Array<Readonly<Record<string, unknown>>> = [];
    const pageSize = 100;
    const maxPages = 20;
    for (let page = 1; page <= maxPages; page += 1) {
      const response = await client.request(
        { method: 'GET', path: `${projectPath}/repositories?page=${page}&page_size=${pageSize}` },
        [200, 404],
      );
      if (response.status === 404) return;
      if (!Array.isArray(response.body)) {
        throw new Error(`Harbor repository response for project ${project} was not an array.`);
      }
      const items = response.body as Array<Readonly<Record<string, unknown>>>;
      repositories.push(...items);
      if (items.length < pageSize) break;
      if (page === maxPages) {
        throw new Error(`Harbor project ${project} exceeds the bounded ${maxPages * pageSize}-repository deletion limit.`);
      }
    }
    if (repositories.length === 0) return;

    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, repositories.length) }, async () => {
      while (next < repositories.length) {
        const repository = repositories[next];
        next += 1;
        const fullName = repository?.name;
        if (typeof fullName !== 'string' || !fullName.trim()) {
          throw new Error(`Harbor repository response for project ${project} contained an invalid name.`);
        }
        const prefix = `${project}/`;
        const repositoryName = fullName.startsWith(prefix) ? fullName.slice(prefix.length) : fullName;
        const encodedRepositoryName = encodeURIComponent(encodeURIComponent(repositoryName));
        await client.request(
          { method: 'DELETE', path: `${projectPath}/repositories/${encodedRepositoryName}` },
          [200, 202, 404],
        );
      }
    }));
    await sleep(pollIntervalMs);
  }

  throw new Error(`Timed out after ${options.timeoutMs}ms purging repositories from Harbor project ${project}.`);
}

/**
 * Harbor deliberately rejects deletion of repositories containing immutable tags. Project
 * deletion is already an explicit, exact-name-confirmed operation, so remove those project-local
 * guards immediately before TypeKro purges the installation-owned repositories. This keeps the
 * normal steady-state policy strict while making the requested destructive lifecycle complete.
 */
export async function removeHarborProjectImmutableTagRulesForDeletion(
  client: TypeKroHarborApiClient,
  project: string,
  io?: Pick<CliIo, 'stdout'>,
): Promise<void> {
  const projectPath = `/projects/${encodeURIComponent(project)}`;
  const rulesPath = `${projectPath}/immutabletagrules`;
  const response = await client.request({ method: 'GET', path: rulesPath }, [200, 404]);
  if (response.status === 404) return;
  if (!Array.isArray(response.body)) {
    throw new Error(`Harbor immutable-tag response for project ${project} was not an array.`);
  }

  const ruleIds = response.body.map((rule, index) => {
    const id = typeof rule === 'object' && rule !== null && 'id' in rule
      ? (rule as { readonly id?: unknown }).id
      : undefined;
    if ((typeof id !== 'number' || !Number.isInteger(id) || id <= 0) && (typeof id !== 'string' || !/^\d+$/.test(id))) {
      throw new Error(`Harbor immutable-tag rule ${index} for project ${project} did not contain a valid ID.`);
    }
    return String(id);
  });

  if (ruleIds.length > 0) {
    io?.stdout(`Removing ${ruleIds.length} immutable-tag rule${ruleIds.length === 1 ? '' : 's'} before purging Harbor project ${project}`);
  }
  for (const id of ruleIds) {
    await client.request({ method: 'DELETE', path: `${rulesPath}/${encodeURIComponent(id)}` }, [200, 204, 404]);
  }
}

async function importProjectModule<T>(specifier: string, projectPath: string): Promise<T> {
  const typeKroRoot = process.env.APPLIK8S_TYPEKRO_ROOT;
  if (typeKroRoot && (specifier === 'typekro' || specifier.startsWith('typekro/'))) {
    const packageJson = JSON.parse(await readFile(resolve(typeKroRoot, 'package.json'), 'utf8')) as {
      readonly exports?: Readonly<Record<string, string | Readonly<Record<string, string>>>>;
    };
    const subpath = specifier === 'typekro' ? '.' : `./${specifier.slice('typekro/'.length)}`;
    const exported = packageJson.exports?.[subpath];
    const target = typeof exported === 'string'
      ? exported
      : exported?.import ?? exported?.default;
    if (!target) {
      throw new Error(`TypeKro module override ${typeKroRoot} does not export ${specifier}.`);
    }
    // static-import-exception: APPLIK8S_TYPEKRO_ROOT deliberately selects a runtime TypeKro checkout by resolved filesystem path.
    return await import(pathToFileURL(resolve(typeKroRoot, target)).href) as T;
  }
  // The regular release path resolves through the package's ESM `import` condition. `projectPath`
  // remains part of the signature because build contexts are useful diagnostics for provider-load
  // failures and the local override deliberately avoids mutating consumer lockfiles.
  void projectPath;
  // static-import-exception: provider subpaths are selected at runtime while preserving the package ESM import condition.
  return await import(specifier) as T;
}

async function resolveDeploymentContainerRegistry(
  bundlePath: string,
  context: string,
  spec: Readonly<Record<string, unknown>>,
  io: CliIo,
): Promise<ResolvedApplicationContainerRegistry> {
  const bundle = JSON.parse(await readFile(bundlePath, 'utf8')) as {
    readonly spec?: { readonly applicationGraph?: { readonly path?: string } };
  };
  const graphPath = bundle.spec?.applicationGraph?.path;
  const graph = graphPath ? await readGeneratedApplicationGraph(bundlePath, io.cwd) : undefined;
  // Registry resolution must materialize only the registry contract. Resolving
  // the entire graph here would incorrectly demand optional values belonging
  // to unrelated providers (for example external generation credentials while
  // deploying the local profile).
  const registryGraph = graph
    ? applicationGraphDeploymentSlice(graph, (node) => node.kind === 'provider' && node.interface === 'ContainerRegistry')
    : undefined;
  const authoredProvider = registryGraph
    ? applicationContainerRegistryFromGraph(resolveApplicationInstallationValues(registryGraph, spec, { preserveInstallationReferences: true }))
    : { kind: 'orbstack-container-registry' } satisfies ApplicationContainerRegistryProvider;
  const provider = registryGraph
    ? applicationContainerRegistryFromGraph(resolveApplicationInstallationValues(registryGraph, spec))
    : authoredProvider;
  const resolved = await resolveApplicationContainerRegistry(
    provider,
    (endpoint) => resolveKubernetesNodePortEndpoint(context, endpoint),
  );
  io.stdout(resolved.remote
    ? `Container registry: ${resolved.origin}/${resolved.repositoryPrefix ?? ''}`.replace(/\/$/, '')
    : 'Container registry: OrbStack local image store');
  const deploymentRepositoryPrefix = authoredProvider.kind === 'harbor-container-registry'
    ? authoredProvider.project
    : authoredProvider.kind === 'oci-container-registry'
      ? authoredProvider.repositoryPrefix
      : undefined;
  return deploymentRepositoryPrefix && deploymentRepositoryPrefix !== resolved.repositoryPrefix
    ? { ...resolved, deploymentRepositoryPrefix }
    : resolved;
}

export async function readGeneratedApplicationGraph(bundlePath: string, projectRoot = process.cwd()): Promise<ApplicationGraph> {
  const bundle = JSON.parse(await readFile(bundlePath, 'utf8')) as {
    readonly spec?: { readonly applicationGraph?: { readonly path?: string } };
  };
  const graphPath = bundle.spec?.applicationGraph?.path;
  if (!graphPath) throw new Error('Generated TypeKro bundle does not reference an ApplicationGraph.');
  // Compiler artifact paths are rooted at the project working directory so
  // every manifest can be inspected directly from the command invocation.
  // Accept a bundle-relative path as a compatibility fallback for bundles
  // produced by older/custom compilers.
  const projectPath = graphPath.startsWith('/') ? graphPath : resolve(projectRoot, graphPath);
  const bundlePathCandidate = resolve(dirname(bundlePath), graphPath);
  const resolvedPath = await access(projectPath).then(() => projectPath).catch(async () =>
    access(bundlePathCandidate).then(() => bundlePathCandidate));
  const graph = JSON.parse(await readFile(resolvedPath, 'utf8')) as ApplicationGraph;
  if (graph.apiVersion !== 'applik8s.appGraph/v1alpha1' || graph.kind !== 'ApplicationGraph') {
    throw new Error(`Generated application graph ${resolvedPath} has an unsupported contract.`);
  }
  return graph;
}

/**
 * Materialize only the nodes consumed by one deployment phase. Provider
 * bindings, requirements, and edges may legitimately retain references for
 * inactive branches and must not make an unrelated phase demand them.
 */
export function applicationGraphDeploymentSlice(
  graph: ApplicationGraph,
  include: (node: ApplicationGraph['nodes'][number]) => boolean,
): ApplicationGraph {
  return {
    ...graph,
    nodes: graph.nodes.filter(include),
    edges: [],
    providerBindings: [],
    providerRequirements: [],
  };
}

async function writeApplicationProviderPreparationReceipt(
  bundlePath: string,
  scope: ApplicationDeploymentReceiptScope,
  receipt: ApplicationProviderPreparationReceipt,
): Promise<void> {
  const path = applicationDeploymentReceiptPath(bundlePath, scope, 'application-provider-preparation.json');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`);
}

async function writeApplicationKroProviderMigrationReceipt(
  bundlePath: string,
  scope: ApplicationDeploymentReceiptScope,
  receipt: ApplicationKroProviderMigrationReceipt,
): Promise<void> {
  const path = applicationDeploymentReceiptPath(bundlePath, scope, 'application-kro-provider-migration.json');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`);
}

export async function readGeneratedResourceGraphDefinition(
  bundlePath: string,
  name: string,
): Promise<import('./application-kro-provider-migration.js').ApplicationKubernetesObject> {
  const path = join(dirname(bundlePath), 'resources.json');
  const resources = JSON.parse(await readFile(path, 'utf8')) as unknown;
  if (!Array.isArray(resources)) throw new Error(`Generated TypeKro resources ${path} must be an array.`);
  const match = resources.find((resource) => resource && typeof resource === 'object'
    && Reflect.get(resource, 'apiVersion') === 'kro.run/v1alpha1'
    && Reflect.get(resource, 'kind') === 'ResourceGraphDefinition'
    && Reflect.get(Reflect.get(resource, 'metadata'), 'name') === name);
  if (!match || typeof match !== 'object') {
    throw new Error(`Generated TypeKro resources do not contain ResourceGraphDefinition/${name}.`);
  }
  return match as import('./application-kro-provider-migration.js').ApplicationKubernetesObject;
}

async function readApplicationProviderPreparationReceipt(bundlePath: string, scope: ApplicationDeploymentReceiptScope): Promise<ApplicationProviderPreparationReceipt | undefined> {
  const path = await existingApplicationDeploymentReceiptPath(bundlePath, scope, 'application-provider-preparation.json');
  if (!path) return undefined;
  const value = JSON.parse(await readFile(path, 'utf8')) as ApplicationProviderPreparationReceipt;
  if (value.apiVersion !== 'applik8s.deployment/v1alpha1' || value.kind !== 'ApplicationProviderPreparationReceipt') {
    throw new Error(`Application provider preparation receipt ${path} has an unsupported contract.`);
  }
  return value;
}

function typeKroApplicationProviderPreparationRuntime(io: CliIo): ApplicationProviderPreparationRuntime {
  return {
    async ensureValkeyOperator(context, prerequisite) {
      // static-import-exception: provider preparation loads the optional Kubernetes SDK only for this live lifecycle operation.
      const kubernetes = await import('@kubernetes/client-node');
      const kubeConfig = new kubernetes.KubeConfig();
      kubeConfig.loadFromDefault();
      kubeConfig.setCurrentContext(context);
      const extensionApi = makeKubernetesApiClient(kubeConfig, kubernetes.ApiextensionsV1Api);
      const operatorExists = await extensionApi.readCustomResourceDefinition({ name: 'valkeys.hyperspike.io' })
        .then(() => true)
        .catch((cause: unknown) => {
          if (kubernetesStatusCode(cause) === 404) return false;
          throw cause;
        });
      if (operatorExists) {
        await assertValkeyOperatorReady(kubeConfig, kubernetes, prerequisite.namespace);
        io.stdout(`Reusing ready shared Valkey operator in ${prerequisite.namespace}`);
        return {
          provider: 'valkey',
          ownership: 'external',
          name: prerequisite.name,
          namespace: prerequisite.namespace,
          ...(prerequisite.version ? { version: prerequisite.version } : {}),
          ready: true,
        };
      }
      const module = await importProjectModule<TypeKroValkeyModule>('typekro/valkey', io.cwd);
      const factory = module.valkeyBootstrap.factory('direct', {
        namespace: 'default',
        kubeConfig,
        waitForReady: true,
        timeout: 5 * 60_000,
        conflictStrategy: 'patch',
      });
      io.stdout(`Preparing shared Valkey operator ${prerequisite.namespace}/${prerequisite.name} through TypeKro direct mode`);
      await factory.deploy({
        name: prerequisite.name,
        namespace: prerequisite.namespace,
        ...(prerequisite.version ? { version: prerequisite.version } : {}),
      });
      await assertValkeyOperatorReady(kubeConfig, kubernetes, prerequisite.namespace);
      return {
        provider: 'valkey',
        ownership: 'shared-managed',
        name: prerequisite.name,
        namespace: prerequisite.namespace,
        ...(prerequisite.version ? { version: prerequisite.version } : {}),
        ready: true,
      };
    },
    async ensureValkeyCluster(context, prerequisite) {
      // static-import-exception: provider preparation loads the optional Kubernetes SDK only for this live lifecycle operation.
      const kubernetes = await import('@kubernetes/client-node');
      const kubeConfig = new kubernetes.KubeConfig();
      kubeConfig.loadFromDefault();
      kubeConfig.setCurrentContext(context);
      const customObjects = makeKubernetesApiClient(kubeConfig, kubernetes.CustomObjectsApi);
      const existing = await customObjects.getNamespacedCustomObject({
        group: 'hyperspike.io',
        version: 'v1',
        namespace: prerequisite.namespace,
        plural: 'valkeys',
        name: prerequisite.name,
      }).catch((cause: unknown) => {
        if (kubernetesStatusCode(cause) === 404) return undefined;
        throw cause;
      });
      if (existing) {
        const metadata = Reflect.get(existing, 'metadata');
        const labels = metadata && typeof metadata === 'object' ? Reflect.get(metadata, 'labels') : undefined;
        const managed = labels && typeof labels === 'object'
          && Reflect.get(labels, 'typekro.io/factory-name') === 'applik8s-valkey-cluster-preparation'
          && Reflect.get(labels, 'typekro.io/instance-name') === prerequisite.name;
        const kroOwned = labels && typeof labels === 'object' && Reflect.get(labels, 'kro.run/owned') === 'true';
        if (kroOwned) {
          throw new Error(
            `Valkey ${prerequisite.namespace}/${prerequisite.name} is owned by a KRO ApplySet and cannot be adopted by the safe direct lifecycle. `
            + 'Delete its owning Application instance through TypeKro or select a new provider name before redeploying.',
          );
        }
        assertValkeyClusterContract(existing, prerequisite.spec, prerequisite.namespace, prerequisite.name);
        if (!managed) {
          await assertValkeyClusterReady(kubeConfig, kubernetes, prerequisite.namespace, prerequisite.name);
          io.stdout(`Reusing externally owned Valkey cluster ${prerequisite.namespace}/${prerequisite.name}`);
          return valkeyClusterPreparationReceipt(prerequisite, 'external');
        }
      }
      const factory = applicationValkeyClusterPreparation.factory('direct', {
        namespace: prerequisite.namespace,
        kubeConfig,
        waitForReady: true,
        timeout: prerequisite.timeoutMs,
      });
      io.stdout(`Preparing Valkey cluster ${prerequisite.namespace}/${prerequisite.name} through TypeKro direct mode`);
      await factory.deploy({
        name: prerequisite.name,
        namespace: prerequisite.namespace,
        spec: prerequisite.spec as never,
      });
      await assertValkeyClusterReady(kubeConfig, kubernetes, prerequisite.namespace, prerequisite.name);
      return valkeyClusterPreparationReceipt(prerequisite, 'managed');
    },
    async deleteValkeyCluster(context, receipt) {
      if (receipt.ownership !== 'managed') return;
      // static-import-exception: provider cleanup loads the optional Kubernetes SDK only for this live lifecycle operation.
      const kubernetes = await import('@kubernetes/client-node');
      const kubeConfig = new kubernetes.KubeConfig();
      kubeConfig.loadFromDefault();
      kubeConfig.setCurrentContext(context);
      const customObjects = makeKubernetesApiClient(kubeConfig, kubernetes.CustomObjectsApi);
      const exists = await customObjects.getNamespacedCustomObject({
        group: 'hyperspike.io', version: 'v1', namespace: receipt.namespace, plural: 'valkeys', name: receipt.name,
      }).then(() => true).catch((cause: unknown) => {
        if (kubernetesStatusCode(cause) === 404) return false;
        throw cause;
      });
      if (!exists) {
        io.stdout(`Managed Valkey cluster ${receipt.namespace}/${receipt.name} is already absent; continuing idempotent cleanup`);
        return;
      }
      const factory = applicationValkeyClusterPreparation.factory('direct', {
        namespace: receipt.namespace,
        kubeConfig,
        waitForReady: true,
        timeout: 5 * 60_000,
      });
      io.stdout(`Deleting Valkey cluster ${receipt.namespace}/${receipt.name} through TypeKro direct mode`);
      try {
        await factory.deleteInstance(receipt.name);
      } catch (cause) {
        const stillExists = await customObjects.getNamespacedCustomObject({
          group: 'hyperspike.io', version: 'v1', namespace: receipt.namespace, plural: 'valkeys', name: receipt.name,
        }).then(() => true).catch((readCause: unknown) => {
          if (kubernetesStatusCode(readCause) === 404) return false;
          throw readCause;
        });
        if (stillExists) throw cause;
        io.stdout(`Managed Valkey cluster ${receipt.namespace}/${receipt.name} reached 404 during TypeKro cleanup; continuing idempotently`);
      }
    },
    async ensurePostgresCluster(context, prerequisite) {
      // static-import-exception: provider preparation loads the optional Kubernetes SDK only for this live lifecycle operation.
      const kubernetes = await import('@kubernetes/client-node');
      const kubeConfig = new kubernetes.KubeConfig();
      kubeConfig.loadFromDefault();
      kubeConfig.setCurrentContext(context);
      const customObjects = makeKubernetesApiClient(kubeConfig, kubernetes.CustomObjectsApi);
      const existing = await customObjects.getNamespacedCustomObject({
        group: 'postgresql.cnpg.io', version: 'v1', namespace: prerequisite.namespace, plural: 'clusters', name: prerequisite.name,
      }).catch((cause: unknown) => {
        if (kubernetesStatusCode(cause) === 404) return undefined;
        throw cause;
      });
      if (existing) {
        const metadata = Reflect.get(existing, 'metadata');
        const labels = metadata && typeof metadata === 'object' ? Reflect.get(metadata, 'labels') : undefined;
        const managed = labels && typeof labels === 'object'
          && Reflect.get(labels, 'typekro.io/factory-name') === 'applik8s-postgres-cluster-preparation'
          && Reflect.get(labels, 'typekro.io/instance-name') === prerequisite.name;
        const kroOwned = labels && typeof labels === 'object' && Reflect.get(labels, 'kro.run/owned') === 'true';
        if (kroOwned) {
          throw new Error(
            `CloudNativePG Cluster ${prerequisite.namespace}/${prerequisite.name} is owned by a KRO ApplySet and cannot be silently adopted by the retained direct lifecycle. `
            + 'A new cluster name alone is not a safe migration because updating the old RGD can still prune the authoritative cluster. '
            + 'Rerun the deploy explicitly with --migrate-kro-owned-provider-data to suspend every affected instance, preserve the object UID, detach ApplySet ownership, and externalize the RGD node.',
          );
        }
        if (!managed) {
          assertJsonSubset(Reflect.get(existing, 'spec'), prerequisite.spec, `CloudNativePG Cluster ${prerequisite.namespace}/${prerequisite.name}.spec`);
          await assertPostgresClusterReady(kubeConfig, kubernetes, prerequisite.namespace, prerequisite.name);
          io.stdout(`Reusing externally owned CloudNativePG Cluster ${prerequisite.namespace}/${prerequisite.name}`);
          return postgresClusterPreparationReceipt(prerequisite, 'external');
        }
        assertSafeManagedPostgresClusterUpdate(
          Reflect.get(existing, 'spec'),
          prerequisite.spec,
          `CloudNativePG Cluster ${prerequisite.namespace}/${prerequisite.name}`,
        );
      }
      const factory = applicationPostgresClusterPreparation.factory('direct', {
        namespace: prerequisite.namespace,
        kubeConfig,
        waitForReady: true,
        timeout: prerequisite.timeoutMs,
      });
      io.stdout(`Preparing CloudNativePG Cluster ${prerequisite.namespace}/${prerequisite.name} through TypeKro direct mode`);
      await factory.deploy({ name: prerequisite.name, namespace: prerequisite.namespace, spec: prerequisite.spec as never });
      await assertPostgresClusterReady(kubeConfig, kubernetes, prerequisite.namespace, prerequisite.name);
      return postgresClusterPreparationReceipt(prerequisite, 'managed');
    },
    async deletePostgresCluster(context, receipt) {
      if (receipt.ownership !== 'managed' || receipt.deletionPolicy !== 'delete') return;
      // static-import-exception: provider cleanup loads the optional Kubernetes SDK only for this live lifecycle operation.
      const kubernetes = await import('@kubernetes/client-node');
      const kubeConfig = new kubernetes.KubeConfig();
      kubeConfig.loadFromDefault();
      kubeConfig.setCurrentContext(context);
      const customObjects = makeKubernetesApiClient(kubeConfig, kubernetes.CustomObjectsApi);
      const exists = await customObjects.getNamespacedCustomObject({
        group: 'postgresql.cnpg.io', version: 'v1', namespace: receipt.namespace, plural: 'clusters', name: receipt.name,
      }).then(() => true).catch((cause: unknown) => {
        if (kubernetesStatusCode(cause) === 404) return false;
        throw cause;
      });
      if (!exists) {
        io.stdout(`Managed CloudNativePG Cluster ${receipt.namespace}/${receipt.name} is already absent; continuing idempotent cleanup`);
        return;
      }
      const factory = applicationPostgresClusterPreparation.factory('direct', {
        namespace: receipt.namespace,
        kubeConfig,
        waitForReady: true,
        timeout: 10 * 60_000,
      });
      io.stdout(`Deleting CloudNativePG Cluster ${receipt.namespace}/${receipt.name} through TypeKro direct mode`);
      try {
        await factory.deleteInstance(receipt.name);
      } catch (cause) {
        const stillExists = await customObjects.getNamespacedCustomObject({
          group: 'postgresql.cnpg.io', version: 'v1', namespace: receipt.namespace, plural: 'clusters', name: receipt.name,
        }).then(() => true).catch((readCause: unknown) => {
          if (kubernetesStatusCode(readCause) === 404) return false;
          throw readCause;
        });
        if (stillExists) throw cause;
        io.stdout(`Managed CloudNativePG Cluster ${receipt.namespace}/${receipt.name} reached 404 during TypeKro cleanup; continuing idempotently`);
      }
    },
    async ensureClickHouseOperatorNamespace(context, namespace) {
      return ensureDirectNamespace(io, context, namespace, 'provider-control-plane');
    },
    async ensureObjectStorageClaim(context, prerequisite) {
      // static-import-exception: provider preparation loads the optional Kubernetes SDK only for this live lifecycle operation.
      const kubernetes = await import('@kubernetes/client-node');
      const kubeConfig = new kubernetes.KubeConfig();
      kubeConfig.loadFromDefault();
      kubeConfig.setCurrentContext(context);
      const customObjects = makeKubernetesApiClient(kubeConfig, kubernetes.CustomObjectsApi);
      const existing = await customObjects.getNamespacedCustomObject({
        group: 'objectbucket.io',
        version: 'v1alpha1',
        namespace: prerequisite.namespace,
        plural: 'objectbucketclaims',
        name: prerequisite.name,
      }).catch((cause: unknown) => {
        if (kubernetesStatusCode(cause) === 404) return undefined;
        throw cause;
      });
      if (existing) {
        const metadata = Reflect.get(existing, 'metadata');
        const labels = metadata && typeof metadata === 'object' ? Reflect.get(metadata, 'labels') : undefined;
        const spec = Reflect.get(existing, 'spec');
        if (spec && typeof spec === 'object') {
          const storageClassName = Reflect.get(spec, 'storageClassName');
          const bucketName = Reflect.get(spec, 'bucketName');
          if (storageClassName !== prerequisite.storageClassName || (bucketName && bucketName !== prerequisite.bucket)) {
            throw new Error(`Existing ObjectBucketClaim ${prerequisite.namespace}/${prerequisite.name} does not match the declared StorageClass and fixed bucket.`);
          }
        }
        await assertObjectStorageBindingReady(kubeConfig, kubernetes, prerequisite.namespace, prerequisite.name);
        const managed = labels && typeof labels === 'object'
          && Reflect.get(labels, 'typekro.io/instance-name') === prerequisite.name;
        io.stdout(`Reusing ${managed ? 'managed' : 'externally owned'} ObjectBucketClaim ${prerequisite.namespace}/${prerequisite.name}`);
        return {
          provider: 'rook-obc',
          ownership: managed ? 'managed' : 'external',
          name: prerequisite.name,
          namespace: prerequisite.namespace,
          bucket: prerequisite.bucket,
          storageClassName: prerequisite.storageClassName,
          ready: true,
        };
      }
      const module = await importProjectModule<TypeKroRookModule>('typekro/rook', io.cwd);
      const factory = module.rookObjectStorageClaim.factory('direct', {
        namespace: prerequisite.namespace,
        kubeConfig,
        waitForReady: true,
        timeout: prerequisite.timeoutMs,
        conflictStrategy: 'patch',
      });
      io.stdout(`Preparing ObjectBucketClaim ${prerequisite.namespace}/${prerequisite.name} through TypeKro direct mode`);
      await factory.deploy({
        name: prerequisite.name,
        namespace: prerequisite.namespace,
        storageClassName: prerequisite.storageClassName,
        bucket: { mode: 'fixed', name: prerequisite.bucket },
      });
      await assertObjectStorageBindingReady(kubeConfig, kubernetes, prerequisite.namespace, prerequisite.name);
      return {
        provider: 'rook-obc',
        ownership: 'managed',
        name: prerequisite.name,
        namespace: prerequisite.namespace,
        bucket: prerequisite.bucket,
        storageClassName: prerequisite.storageClassName,
        ready: true,
      };
    },
    async deleteObjectStorageClaim(context, receipt) {
      if (receipt.ownership !== 'managed') return;
      // static-import-exception: provider cleanup loads the optional Kubernetes SDK only for this live lifecycle operation.
      const kubernetes = await import('@kubernetes/client-node');
      const kubeConfig = new kubernetes.KubeConfig();
      kubeConfig.loadFromDefault();
      kubeConfig.setCurrentContext(context);
      const module = await importProjectModule<TypeKroRookModule>('typekro/rook', io.cwd);
      const claimExists = await makeKubernetesApiClient(kubeConfig, kubernetes.CustomObjectsApi).getNamespacedCustomObject({
        group: 'objectbucket.io',
        version: 'v1alpha1',
        namespace: receipt.namespace,
        plural: 'objectbucketclaims',
        name: receipt.name,
      }).then(() => true).catch((cause: unknown) => {
        if (kubernetesStatusCode(cause) === 404) return false;
        throw cause;
      });
      if (!claimExists) {
        io.stdout(`Managed ObjectBucketClaim ${receipt.namespace}/${receipt.name} is already absent; continuing idempotent cleanup`);
        return;
      }
      const factory = module.rookObjectStorageClaim.factory('direct', {
        namespace: receipt.namespace,
        kubeConfig,
        waitForReady: true,
        timeout: 5 * 60_000,
        conflictStrategy: 'patch',
      });
      io.stdout(`Deleting ObjectBucketClaim ${receipt.namespace}/${receipt.name} through TypeKro direct mode`);
      try {
        await factory.deleteInstance(receipt.name);
      } catch (cause) {
        const stillExists = await makeKubernetesApiClient(kubeConfig, kubernetes.CustomObjectsApi).getNamespacedCustomObject({
          group: 'objectbucket.io', version: 'v1alpha1', namespace: receipt.namespace, plural: 'objectbucketclaims', name: receipt.name,
        }).then(() => true).catch((readCause: unknown) => {
          if (kubernetesStatusCode(readCause) === 404) return false;
          throw readCause;
        });
        if (stillExists) throw cause;
        io.stdout(`Managed ObjectBucketClaim ${receipt.namespace}/${receipt.name} reached 404 during TypeKro cleanup; continuing idempotently`);
      }
    },
    async ensureWorkflowAdminCredentials(context, prerequisite) {
      // static-import-exception: provider preparation loads the optional Kubernetes SDK only for this live lifecycle operation.
      const kubernetes = await import('@kubernetes/client-node');
      const kubeConfig = new kubernetes.KubeConfig();
      kubeConfig.loadFromDefault();
      kubeConfig.setCurrentContext(context);
      const core = makeKubernetesApiClient(kubeConfig, kubernetes.CoreV1Api);
      const namespaceExists = await core.readNamespace({ name: prerequisite.namespace })
        .then(() => true)
        .catch((cause: unknown) => {
          if (kubernetesStatusCode(cause) === 404) return false;
          throw cause;
        });
      if (!namespaceExists) {
        throw new Error(`Hatchet WorkflowEngine namespace ${prerequisite.namespace} must be prepared before its bootstrap credentials.`);
      }
      const existing = await core.readNamespacedSecret({
        namespace: prerequisite.namespace,
        name: prerequisite.name,
      }).catch((cause: unknown) => {
        if (kubernetesStatusCode(cause) === 404) return undefined;
        throw cause;
      });
      if (existing) {
        if (existing.type !== 'Opaque' || !existing.data?.adminEmail || !existing.data?.adminPassword) {
          throw new Error(`Existing Hatchet admin Secret ${prerequisite.namespace}/${prerequisite.name} must be Opaque and contain adminEmail and adminPassword.`);
        }
        const labels = existing.metadata?.labels ?? {};
        const managed = labels['applik8s.dev/direct-preparation'] === 'hatchet-admin'
          && labels['applik8s.dev/direct-preparation-instance'] === prerequisite.name;
        io.stdout(`Reusing ${managed ? 'managed' : 'externally owned'} Hatchet admin Secret ${prerequisite.namespace}/${prerequisite.name}`);
        return {
          provider: 'hatchet-admin',
          ownership: managed ? 'managed' : 'external',
          name: prerequisite.name,
          namespace: prerequisite.namespace,
          ...(prerequisite.managedWorkerTokenSecret ? { managedWorkerTokenSecret: prerequisite.managedWorkerTokenSecret } : {}),
          ready: true,
        };
      }
      if (!prerequisite.createIfMissing) {
        throw new Error(`Declared Hatchet admin Secret ${prerequisite.namespace}/${prerequisite.name} does not exist.`);
      }
      const factory = await applicationWorkflowAdminSecretFactory(kubeConfig, {
        email: 'admin@applik8s.local',
        password: randomBytes(32).toString('base64url'),
      }, io);
      io.stdout(`Preparing Hatchet admin Secret ${prerequisite.namespace}/${prerequisite.name} through TypeKro direct mode`);
      await factory.deploy({ name: prerequisite.name, namespace: prerequisite.namespace });
      return {
        provider: 'hatchet-admin',
        ownership: 'managed',
        name: prerequisite.name,
        namespace: prerequisite.namespace,
        ...(prerequisite.managedWorkerTokenSecret ? { managedWorkerTokenSecret: prerequisite.managedWorkerTokenSecret } : {}),
        ready: true,
      };
    },
    async deleteWorkflowAdminCredentials(context, receipt) {
      // static-import-exception: provider cleanup loads the optional Kubernetes SDK only for this live lifecycle operation.
      const kubernetes = await import('@kubernetes/client-node');
      const kubeConfig = new kubernetes.KubeConfig();
      kubeConfig.loadFromDefault();
      kubeConfig.setCurrentContext(context);
      if (receipt.managedWorkerTokenSecret) {
        await deleteManagedHatchetWorkerTokenSecret(io, kubeConfig, kubernetes, receipt.managedWorkerTokenSecret);
      }
      if (receipt.ownership !== 'managed') return;
      const secretExists = await makeKubernetesApiClient(kubeConfig, kubernetes.CoreV1Api).readNamespacedSecret({
        namespace: receipt.namespace,
        name: receipt.name,
      }).then(() => true).catch((cause: unknown) => {
        if (kubernetesStatusCode(cause) === 404) return false;
        throw cause;
      });
      if (!secretExists) {
        io.stdout(`Managed Hatchet admin Secret ${receipt.namespace}/${receipt.name} is already absent; continuing idempotent cleanup`);
        return;
      }
      const factory = await applicationWorkflowAdminSecretFactory(kubeConfig, {
        email: 'deletion-placeholder@applik8s.local',
        password: 'deletion-placeholder-not-applied',
      }, io);
      io.stdout(`Deleting Hatchet admin Secret ${receipt.namespace}/${receipt.name} through TypeKro direct mode`);
      try {
        await factory.deleteInstance(receipt.name);
      } catch (cause) {
        const stillExists = await makeKubernetesApiClient(kubeConfig, kubernetes.CoreV1Api).readNamespacedSecret({
          namespace: receipt.namespace,
          name: receipt.name,
        }).then(() => true).catch((readCause: unknown) => {
          if (kubernetesStatusCode(readCause) === 404) return false;
          throw readCause;
        });
        if (stillExists) throw cause;
        io.stdout(`Managed Hatchet admin Secret ${receipt.namespace}/${receipt.name} reached 404 during TypeKro cleanup; continuing idempotently`);
      }
    },
    async ensureIdentityInfrastructure(context, prerequisite) {
      // static-import-exception: provider preparation loads deployment-only clients after selecting the concrete Ory implementation.
      const kubernetes = await import('@kubernetes/client-node');
      const kubeConfig = new kubernetes.KubeConfig();
      kubeConfig.loadFromDefault();
      kubeConfig.setCurrentContext(context);
      const spec = prerequisite.spec;
      const namespace = spec.namespace;
      if (!namespace?.trim()) throw new Error('Ory identity infrastructure requires a concrete namespace after installation materialization.');
      const namespacePreparation = await ensureDirectNamespace(io, context, namespace, 'identity-infrastructure');
      const module = await importProjectModule<TypeKroOryModule>('typekro/ory', io.cwd);
      const composition = prerequisite.stack === 'platform' ? module.oryPlatformStack : module.oryIdentityStack;
      const factory = composition.factory('direct', {
        namespace,
        kubeConfig,
        waitForReady: true,
        timeout: prerequisite.timeoutMs ?? 15 * 60_000,
        conflictStrategy: 'patch',
      });
      io.stdout(`Preparing Ory ${prerequisite.stack} stack ${namespace}/${spec.name} through TypeKro direct mode`);
      const { managed: _platformOnlyManagedConfig, ...identityStackSpec } = spec as unknown as Readonly<Record<string, unknown>>;
      try {
        // The Ory compositions declare a Namespace because they must also work
        // standalone. Applik8s prepares that lifecycle boundary separately and
        // deploys only instance-private children, preventing an existing
        // production namespace from being adopted or deleted by the Ory stack.
        await factory.deploy(prerequisite.stack === 'platform'
          ? spec as unknown as Readonly<Record<string, unknown>>
          : identityStackSpec, { targetScopes: [] });
      } catch (cause) {
        if (namespacePreparation.ownership === 'managed' && namespacePreparation.created === true) {
          await deleteDirectNamespace(io, context, namespacePreparation).catch((cleanupCause: unknown) => {
            throw new AggregateError([cause, cleanupCause], `Ory ${prerequisite.stack} preparation failed and its newly created namespace could not be rolled back.`);
          });
        }
        throw cause;
      }
      return {
        provider: 'ory',
        stack: prerequisite.stack,
        ownership: 'managed',
        name: spec.name,
        namespace,
        deletionPolicy: prerequisite.deletionPolicy,
        namespacePreparation,
        ready: true,
      };
    },
    async deleteIdentityInfrastructure(context, receipt) {
      if (receipt.ownership !== 'managed' || receipt.deletionPolicy !== 'delete') return;
      // static-import-exception: provider cleanup uses the same released TypeKro factory that created the stack.
      const kubernetes = await import('@kubernetes/client-node');
      const kubeConfig = new kubernetes.KubeConfig();
      kubeConfig.loadFromDefault();
      kubeConfig.setCurrentContext(context);
      const module = await importProjectModule<TypeKroOryModule>('typekro/ory', io.cwd);
      const composition = receipt.stack === 'platform' ? module.oryPlatformStack : module.oryIdentityStack;
      const factory = composition.factory('direct', {
        namespace: receipt.namespace,
        kubeConfig,
        waitForReady: true,
        timeout: 15 * 60_000,
        conflictStrategy: 'patch',
      });
      io.stdout(`Deleting Ory ${receipt.stack} stack ${receipt.namespace}/${receipt.name} through TypeKro direct mode`);
      try {
        await factory.deleteInstance(receipt.name);
      } catch (cause) {
        if (!isTypeKroInstanceNotFound(cause)) throw cause;
        io.stdout(`Managed Ory ${receipt.stack} stack ${receipt.namespace}/${receipt.name} is already absent; continuing idempotent cleanup`);
      }
      if (receipt.namespacePreparation?.ownership === 'managed') {
        await deleteDirectNamespace(io, context, receipt.namespacePreparation);
      }
    },
  };
}

function valkeyClusterPreparationReceipt(
  prerequisite: {
    readonly name: string;
    readonly namespace: string;
    readonly topology: { readonly shards: number; readonly replicas: number };
    readonly storage?: { readonly size: string; readonly storageClassName?: string };
  },
  ownership: 'managed' | 'external',
) {
  return {
    provider: 'hyperspike-valkey' as const,
    ownership,
    name: prerequisite.name,
    namespace: prerequisite.namespace,
    endpoint: `${prerequisite.name}.${prerequisite.namespace}.svc.cluster.local`,
    port: 6379,
    topology: prerequisite.topology,
    ...(prerequisite.storage ? { storage: prerequisite.storage } : {}),
    ready: true as const,
  };
}

function postgresClusterPreparationReceipt(
  prerequisite: {
    readonly name: string;
    readonly namespace: string;
    readonly database: string;
    readonly deletionPolicy: 'delete' | 'retain';
  },
  ownership: 'managed' | 'external',
) {
  return {
    provider: 'cloudnative-pg' as const,
    ownership,
    name: prerequisite.name,
    namespace: prerequisite.namespace,
    database: prerequisite.database,
    deletionPolicy: prerequisite.deletionPolicy,
    ready: true as const,
  };
}

function assertValkeyClusterContract(
  resource: unknown,
  declaredSpec: Readonly<Record<string, unknown>>,
  namespace: string,
  name: string,
): void {
  const liveSpec = resource && typeof resource === 'object' ? Reflect.get(resource, 'spec') : undefined;
  if (!liveSpec || typeof liveSpec !== 'object' || Array.isArray(liveSpec)) {
    throw new Error(`Existing Valkey ${namespace}/${name} has no readable spec.`);
  }
  const { shards, ...rest } = declaredSpec;
  const expected = { ...rest, ...(shards !== undefined ? { nodes: shards } : {}) };
  assertJsonSubset(liveSpec, expected, `Valkey ${namespace}/${name}.spec`);
}

function assertJsonSubset(actual: unknown, expected: unknown, path: string): void {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) {
      throw new Error(`${path} does not match the declared provider contract.`);
    }
    expected.forEach((value, index) => {
      assertJsonSubset(actual[index], value, `${path}[${index}]`);
    });
    return;
  }
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
      throw new Error(`${path} does not match the declared provider contract.`);
    }
    for (const [key, value] of Object.entries(expected)) {
      assertJsonSubset(Reflect.get(actual, key), value, `${path}.${key}`);
    }
    return;
  }
  if (actual !== expected) {
    throw new Error(`${path} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}.`);
  }
}

async function assertValkeyClusterReady(
  kubeConfig: InstanceType<typeof import('@kubernetes/client-node').KubeConfig>,
  kubernetes: typeof import('@kubernetes/client-node'),
  namespace: string,
  name: string,
): Promise<void> {
  const customObjects = makeKubernetesApiClient(kubeConfig, kubernetes.CustomObjectsApi);
  const resource = await customObjects.getNamespacedCustomObject({
    group: 'hyperspike.io', version: 'v1', namespace, plural: 'valkeys', name,
  });
  const status = Reflect.get(resource, 'status');
  if (!status || typeof status !== 'object' || Reflect.get(status, 'ready') !== true) {
    throw new Error(`Valkey ${namespace}/${name} did not report status.ready=true.`);
  }
  const core = makeKubernetesApiClient(kubeConfig, kubernetes.CoreV1Api);
  await Promise.all([name, `${name}-headless`].map(async (serviceName) => {
    const service = await core.readNamespacedService({ namespace, name: serviceName }).catch((cause: unknown) => {
      throw new Error(`Valkey ${namespace}/${name} did not produce Service ${namespace}/${serviceName}: ${cause instanceof Error ? cause.message : String(cause)}`);
    });
    if (!service.spec?.ports?.some((port) => port.port === 6379)) {
      throw new Error(`Valkey Service ${namespace}/${serviceName} does not expose port 6379.`);
    }
  }));
}

async function assertPostgresClusterReady(
  kubeConfig: InstanceType<typeof import('@kubernetes/client-node').KubeConfig>,
  kubernetes: typeof import('@kubernetes/client-node'),
  namespace: string,
  name: string,
): Promise<void> {
  const resource = await makeKubernetesApiClient(kubeConfig, kubernetes.CustomObjectsApi).getNamespacedCustomObject({
    group: 'postgresql.cnpg.io', version: 'v1', namespace, plural: 'clusters', name,
  });
  const status = Reflect.get(resource, 'status');
  const phase = status && typeof status === 'object' ? Reflect.get(status, 'phase') : undefined;
  const conditions = status && typeof status === 'object' ? Reflect.get(status, 'conditions') : undefined;
  const ready = phase === 'Cluster in healthy state' || (Array.isArray(conditions) && conditions.some((condition) =>
    condition && typeof condition === 'object' && Reflect.get(condition, 'type') === 'Ready' && Reflect.get(condition, 'status') === 'True'));
  if (!ready) {
    throw new Error(`CloudNativePG Cluster ${namespace}/${name} did not report a healthy phase or Ready=True condition.`);
  }
}

async function applicationWorkflowAdminSecretFactory(
  kubeConfig: InstanceType<typeof import('@kubernetes/client-node').KubeConfig>,
  credentials: { readonly email: string; readonly password: string },
  io: CliIo,
): Promise<TypeKroDirectFactory> {
  const typeKro = await importProjectModule<TypeKroCompositionModule>('typekro', io.cwd);
  const typeKroKubernetes = await importProjectModule<TypeKroKubernetesModule>('typekro/kubernetes', io.cwd);
  // static-import-exception: ArkType is loaded only when constructing this direct TypeKro preparation graph.
  const { type } = await import('arktype');
  const preparation = typeKro.kubernetesComposition({
    name: 'applik8s-hatchet-admin-secret',
    apiVersion: 'deployment.applik8s.dev/v1alpha1',
    kind: 'HatchetAdminSecret',
    spec: type({ name: 'string', namespace: 'string' }),
    status: type({ ready: 'boolean' }),
  }, (spec) => {
    typeKroKubernetes.secret({
      id: 'hatchetAdminSecret',
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: {
        name: spec.name,
        namespace: spec.namespace,
        labels: {
          'app.kubernetes.io/managed-by': 'applik8s',
          'applik8s.dev/provider': 'hatchet',
          'applik8s.dev/direct-preparation': 'hatchet-admin',
          'applik8s.dev/direct-preparation-instance': spec.name,
        },
      },
      type: 'Opaque',
      stringData: {
        adminEmail: credentials.email,
        adminPassword: credentials.password,
      },
    });
    return { ready: true };
  });
  return preparation.factory('direct', {
    namespace: 'default',
    kubeConfig,
    waitForReady: true,
    timeout: 60_000,
    conflictStrategy: 'patch',
  });
}

async function applicationHatchetWorkerTokenCleanupFactory(
  kubeConfig: InstanceType<typeof import('@kubernetes/client-node').KubeConfig>,
  io: CliIo,
): Promise<TypeKroDirectFactory> {
  const typeKro = await importProjectModule<TypeKroCompositionModule>('typekro', io.cwd);
  const typeKroKubernetes = await importProjectModule<TypeKroKubernetesModule>('typekro/kubernetes', io.cwd);
  // static-import-exception: ArkType is loaded only when constructing this direct TypeKro cleanup graph.
  const { type } = await import('arktype');
  const cleanup = typeKro.kubernetesComposition({
    name: 'applik8s-hatchet-worker-token-cleanup',
    apiVersion: 'deployment.applik8s.dev/v1alpha1',
    kind: 'HatchetWorkerTokenCleanup',
    spec: type({ name: 'string', namespace: 'string' }),
    status: type({ ready: 'boolean' }),
  }, (spec) => {
    // Hatchet's Helm hook creates this Secret without an ownerReference. The
    // metadata-only apply adopts it into a bounded TypeKro direct lifecycle
    // without reading, copying, or taking ownership of credential data.
    typeKroKubernetes.secret({
      id: 'hatchetWorkerToken',
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: {
        name: spec.name,
        namespace: spec.namespace,
        labels: {
          'app.kubernetes.io/managed-by': 'applik8s',
          'applik8s.dev/provider': 'hatchet',
          'applik8s.dev/direct-cleanup': 'hatchet-worker-token',
        },
      },
      type: 'Opaque',
    });
    return { ready: true };
  });
  return cleanup.factory('direct', {
    namespace: 'default',
    kubeConfig,
    waitForReady: true,
    timeout: 60_000,
    conflictStrategy: 'patch',
  });
}

async function deleteManagedHatchetWorkerTokenSecret(
  io: CliIo,
  kubeConfig: InstanceType<typeof import('@kubernetes/client-node').KubeConfig>,
  kubernetes: typeof import('@kubernetes/client-node'),
  secretRef: { readonly name: 'hatchet-client-config'; readonly namespace: string },
): Promise<void> {
  const core = makeKubernetesApiClient(kubeConfig, kubernetes.CoreV1Api);
  const existing = await core.readNamespacedSecret(secretRef).catch((cause: unknown) => {
    if (kubernetesStatusCode(cause) === 404) return undefined;
    throw cause;
  });
  if (!existing) {
    io.stdout(`Managed Hatchet worker-token Secret ${secretRef.namespace}/${secretRef.name} is already absent; continuing idempotent cleanup`);
    return;
  }
  const dataKeys = Object.keys(existing.data ?? {});
  if (existing.type !== 'Opaque' || !dataKeys.includes('HATCHET_CLIENT_TOKEN')) {
    throw new Error(
      `Refusing to clean Hatchet worker-token Secret ${secretRef.namespace}/${secretRef.name}: expected an Opaque chart output containing HATCHET_CLIENT_TOKEN.`,
    );
  }
  if ((existing.metadata?.ownerReferences?.length ?? 0) > 0) {
    throw new Error(
      `Refusing to adopt Hatchet worker-token Secret ${secretRef.namespace}/${secretRef.name}: it has an active Kubernetes owner and should be finalized by that owner.`,
    );
  }
  const factory = await applicationHatchetWorkerTokenCleanupFactory(kubeConfig, io);
  io.stdout(`Adopting and deleting Hatchet worker-token Secret ${secretRef.namespace}/${secretRef.name} through TypeKro direct mode`);
  await factory.deploy({ name: secretRef.name, namespace: secretRef.namespace });
  await factory.deleteInstance(secretRef.name);
  const remains = await core.readNamespacedSecret(secretRef).then(() => true).catch((cause: unknown) => {
    if (kubernetesStatusCode(cause) === 404) return false;
    throw cause;
  });
  if (remains) {
    throw new Error(`TypeKro cleanup left Hatchet worker-token Secret ${secretRef.namespace}/${secretRef.name} behind.`);
  }
}

async function assertObjectStorageBindingReady(
  kubeConfig: InstanceType<typeof import('@kubernetes/client-node').KubeConfig>,
  kubernetes: typeof import('@kubernetes/client-node'),
  namespace: string,
  name: string,
): Promise<void> {
  const core = makeKubernetesApiClient(kubeConfig, kubernetes.CoreV1Api);
  const [secret, config] = await Promise.all([
    core.readNamespacedSecret({ namespace, name }).catch((cause: unknown) => {
      throw new Error(`ObjectBucketClaim ${namespace}/${name} did not produce its credentials Secret: ${cause instanceof Error ? cause.message : String(cause)}`);
    }),
    core.readNamespacedConfigMap({ namespace, name }).catch((cause: unknown) => {
      throw new Error(`ObjectBucketClaim ${namespace}/${name} did not produce its connection ConfigMap: ${cause instanceof Error ? cause.message : String(cause)}`);
    }),
  ]);
  if (!secret.data?.AWS_ACCESS_KEY_ID || !secret.data?.AWS_SECRET_ACCESS_KEY) {
    throw new Error(`ObjectBucketClaim ${namespace}/${name} credentials Secret is missing S3 access keys.`);
  }
  if (!config.data?.BUCKET_NAME || !config.data?.BUCKET_HOST || !config.data?.BUCKET_PORT) {
    throw new Error(`ObjectBucketClaim ${namespace}/${name} connection ConfigMap is incomplete.`);
  }
}

async function assertValkeyOperatorReady(
  kubeConfig: InstanceType<typeof import('@kubernetes/client-node').KubeConfig>,
  kubernetes: typeof import('@kubernetes/client-node'),
  namespace: string,
): Promise<void> {
  const deployments = await makeKubernetesApiClient(kubeConfig, kubernetes.AppsV1Api).listNamespacedDeployment({ namespace });
  const ready = deployments.items.some((deployment) => {
    const name = deployment.metadata?.name ?? '';
    const desired = deployment.spec?.replicas ?? 1;
    return /valkey/i.test(name) && (deployment.status?.availableReplicas ?? 0) >= Math.max(1, desired);
  });
  if (!ready) {
    throw new Error(`Valkey CRD exists, but no ready Valkey operator Deployment was found in ${namespace}.`);
  }
}

async function resolveKubernetesNodePortEndpoint(
  context: string,
  endpoint: Extract<ApplicationContainerRegistryEndpoint, { readonly kind: 'kubernetes-node-port' }>,
): Promise<string> {
  const serviceSource = await runChildCapture({
    command: 'kubectl',
    args: ['--context', context, '--namespace', endpoint.namespace, 'get', 'service', endpoint.service, '--output=json'],
    cwd: process.cwd(),
  });
  const service = JSON.parse(serviceSource) as {
    readonly spec?: { readonly type?: string; readonly ports?: readonly { readonly nodePort?: number }[] };
  };
  if (service.spec?.type !== 'NodePort' || !service.spec.ports?.some((port) => port.nodePort === endpoint.port)) {
    throw new Error(`ContainerRegistry NodePort ${endpoint.namespace}/${endpoint.service}:${endpoint.port} is not exposed by the selected Kubernetes context.`);
  }
  if (endpoint.publishHost) {
    return `${endpoint.protocol}://${endpoint.publishHost}:${endpoint.port}`;
  }
  const nodeSource = await runChildCapture({
    command: 'kubectl',
    args: ['--context', context, 'get', 'nodes', '--output=json'],
    cwd: process.cwd(),
  });
  const nodes = JSON.parse(nodeSource) as {
    readonly items?: readonly { readonly status?: { readonly addresses?: readonly { readonly type?: string; readonly address?: string }[] } }[];
  };
  const address = nodes.items
    ?.flatMap((node) => node.status?.addresses ?? [])
    .find((candidate) => candidate.type === 'InternalIP' && typeof candidate.address === 'string')
    ?.address;
  if (!address) throw new Error(`Kubernetes context ${context} has no node InternalIP for the configured registry NodePort.`);
  return `${endpoint.protocol}://${address}:${endpoint.port}`;
}

async function materializeGeneratedDeployment(
  bundlePath: string,
  receipts: readonly ApplicationImageReceipt[],
  registry: ResolvedApplicationContainerRegistry,
): Promise<void> {
  const directory = dirname(bundlePath);
  const bundle = JSON.parse(await readFile(bundlePath, 'utf8')) as Record<string, unknown>;
  const graphReference = bundle.spec && typeof bundle.spec === 'object'
    ? Reflect.get(bundle.spec, 'applicationGraph')
    : undefined;
  if (!graphReference || typeof graphReference !== 'object' || typeof Reflect.get(graphReference, 'path') !== 'string' || typeof Reflect.get(graphReference, 'digest') !== 'string') {
    throw new Error('Generated TypeKro bundle has no validated ApplicationGraph reference for image provenance.');
  }
  const evidence = applicationImageEvidence({
    path: Reflect.get(graphReference, 'path') as string,
    digest: Reflect.get(graphReference, 'digest') as string,
  }, registry, receipts);
  const evidenceSource = `${JSON.stringify(evidence, null, 2)}\n`;
  const evidencePath = join(directory, 'application-image-evidence.json');
  const evidenceDigest = `sha256:${createHash('sha256').update(evidenceSource).digest('hex')}`;
  const materializedBundle = materializeDeploymentImages(bundle, receipts, registry) as Record<string, unknown>;
  const spec = materializedBundle.spec && typeof materializedBundle.spec === 'object'
    ? materializedBundle.spec as Record<string, unknown>
    : {};
  spec.imageReceipts = receipts;
  spec.artifactSetDigest = evidence.artifactSetDigest;
  spec.imageEvidence = { path: evidencePath, digest: evidenceDigest };
  materializedBundle.spec = spec;
  await writeFile(bundlePath, `${JSON.stringify(materializedBundle, null, 2)}\n`);
  await writeFile(evidencePath, evidenceSource);
  await writeFile(join(directory, 'image-receipts.json'), `${JSON.stringify({
    apiVersion: 'applik8s.dev/v1alpha1',
    kind: 'ApplicationImageReceipts',
    artifactSetDigest: evidence.artifactSetDigest,
    images: receipts,
  }, null, 2)}\n`);

  const resourcesJsonPath = join(directory, 'resources.json');
  const resources = materializeApplicationArtifactDigest(materializeDeploymentImages(
    JSON.parse(await readFile(resourcesJsonPath, 'utf8')),
    receipts,
    registry,
  ), evidence.artifactSetDigest);
  await writeFile(resourcesJsonPath, `${JSON.stringify(resources, null, 2)}\n`);

  const resourcesDirectory = join(directory, 'resources');
  for (const file of (await readdir(resourcesDirectory)).filter((entry) => entry.endsWith('.yaml'))) {
    const path = join(resourcesDirectory, file);
    const resource = parse(await readFile(path, 'utf8')) as unknown;
    await writeFile(path, stringify(materializeApplicationArtifactDigest(
      materializeDeploymentImages(resource, receipts, registry),
      evidence.artifactSetDigest,
    )));
  }
  const combinedPath = join(directory, 'resources.yaml');
  const combined = parseAllDocuments(await readFile(combinedPath, 'utf8'))
    .map((document) => materializeApplicationArtifactDigest(
      materializeDeploymentImages(document.toJSON(), receipts, registry),
      evidence.artifactSetDigest,
    ));
  await writeFile(combinedPath, combined.map((resource) => stringify(resource)).join('---\n'));

  const materializedSpec = materializedBundle.spec as {
    readonly operators?: readonly { readonly outDir?: string }[];
    readonly migrations?: readonly { readonly manifest?: string }[];
    readonly processors?: readonly { readonly manifest?: string }[];
    readonly workflows?: readonly { readonly manifest?: string }[];
    readonly reactive?: readonly { readonly manifest?: string }[];
  };
  const jsonManifests = [
    ...materializedSpec.migrations ?? [],
    ...materializedSpec.processors ?? [],
    ...materializedSpec.workflows ?? [],
    ...materializedSpec.reactive ?? [],
  ].map((artifact) => artifact.manifest).filter((path): path is string => typeof path === 'string');
  const hostManifest = join(directory, 'application-host', 'application-host.json');
  if (await access(hostManifest).then(() => true).catch(() => false)) jsonManifests.push(hostManifest);
  for (const path of jsonManifests) {
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown;
    await writeFile(path, `${JSON.stringify(materializeDeploymentImages(value, receipts, registry), null, 2)}\n`);
  }
  for (const operator of materializedSpec.operators ?? []) {
    if (!operator.outDir) continue;
    const kubernetesDirectory = join(operator.outDir, 'kubernetes');
    for (const file of (await readdir(kubernetesDirectory)).filter((entry) => entry.endsWith('.yaml'))) {
      const path = join(kubernetesDirectory, file);
      const value = parse(await readFile(path, 'utf8')) as unknown;
      await writeFile(path, stringify(materializeDeploymentImages(value, receipts, registry)));
    }
  }
  const instancesDirectory = join(directory, 'instances');
  for (const file of (await readdir(instancesDirectory)).filter((entry) => /\.ya?ml$/.test(entry))) {
    const path = join(instancesDirectory, file);
    const value = parse(await readFile(path, 'utf8')) as unknown;
    const materialized = materializeDeploymentImages(value, receipts, registry);
    await writeFile(path, stringify(annotateApplicationInstance(materialized, evidence.artifactSetDigest)));
  }
}

function materializeDeploymentImages<T>(
  value: T,
  receipts: readonly ApplicationImageReceipt[],
  registry: ResolvedApplicationContainerRegistry,
): T {
  const repositoryProjection = registry.repositoryPrefix && registry.deploymentRepositoryPrefix
    ? { published: registry.repositoryPrefix, deployment: registry.deploymentRepositoryPrefix }
    : undefined;
  return materializeApplicationImages(value, receipts, registry.pullSecretName, repositoryProjection);
}

function materializeApplicationArtifactDigest<T>(value: T, artifactSetDigest: string): T {
  if (value === '__APPLIK8S_ARTIFACT_SET_DIGEST__') return artifactSetDigest as T;
  if (Array.isArray(value)) {
    return value.map((item) => materializeApplicationArtifactDigest(item, artifactSetDigest)) as T;
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) =>
    [key, materializeApplicationArtifactDigest(child, artifactSetDigest)])) as T;
}

function annotateApplicationInstance(value: unknown, artifactSetDigest: string): unknown {
  if (!value || typeof value !== 'object') return value;
  const resource = value as Record<string, unknown>;
  const metadata = resource.metadata && typeof resource.metadata === 'object'
    ? resource.metadata as Record<string, unknown>
    : {};
  const annotations = metadata.annotations && typeof metadata.annotations === 'object'
    ? metadata.annotations as Record<string, unknown>
    : {};
  return {
    ...resource,
    metadata: {
      ...metadata,
      annotations: { ...annotations, 'applik8s.dev/artifact-set-digest': artifactSetDigest },
    },
  };
}

async function writeContainerRegistryPreparationReceipt(
  bundlePath: string,
  scope: ApplicationDeploymentReceiptScope,
  receipt: ApplicationContainerRegistryPreparationReceipt,
): Promise<void> {
  const path = applicationDeploymentReceiptPath(bundlePath, scope, 'container-registry-preparation.json');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({
    apiVersion: 'applik8s.deployment/v1alpha1',
    kind: 'ContainerRegistryPreparationReceipt',
    ...receipt,
  }, null, 2)}\n`);
}

async function readContainerRegistryPreparationReceipt(
  bundlePath: string,
  scope: ApplicationDeploymentReceiptScope,
): Promise<ApplicationContainerRegistryPreparationReceipt | undefined> {
  const path = await existingApplicationDeploymentReceiptPath(bundlePath, scope, 'container-registry-preparation.json');
  if (!path) return undefined;
  const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Container registry preparation receipt ${path} is not an object.`);
  }
  const provider = Reflect.get(parsed, 'provider');
  if (provider !== 'external' && provider !== 'managed-harbor') {
    throw new Error(`Container registry preparation receipt ${path} has an unsupported provider.`);
  }
  const preparations = Reflect.get(parsed, 'directPreparations');
  if (preparations !== undefined && (!Array.isArray(preparations) || !preparations.every(isDirectNamespacePreparationReceipt))) {
    throw new Error(`Container registry preparation receipt ${path} has invalid direct preparation evidence.`);
  }
  const projectDeletion = Reflect.get(parsed, 'projectDeletion');
  if (projectDeletion !== undefined && !isHarborProjectDeletionReceipt(projectDeletion)) {
    throw new Error(`Container registry preparation receipt ${path} has invalid Harbor project deletion evidence.`);
  }
  return {
    provider,
    ...(typeof Reflect.get(parsed, 'project') === 'string' ? { project: Reflect.get(parsed, 'project') as string } : {}),
    ...(typeof Reflect.get(parsed, 'secretNamespace') === 'string' ? { secretNamespace: Reflect.get(parsed, 'secretNamespace') as string } : {}),
    ...(typeof Reflect.get(parsed, 'pushSecretName') === 'string' ? { pushSecretName: Reflect.get(parsed, 'pushSecretName') as string } : {}),
    ...(typeof Reflect.get(parsed, 'pullSecretName') === 'string' ? { pullSecretName: Reflect.get(parsed, 'pullSecretName') as string } : {}),
    ...(isHarborProjectDeletionReceipt(projectDeletion) ? { projectDeletion } : {}),
    ...(Array.isArray(preparations) ? { directPreparations: preparations } : {}),
  };
}

function isHarborProjectDeletionReceipt(
  value: unknown,
): value is NonNullable<ApplicationContainerRegistryPreparationReceipt['projectDeletion']> {
  if (!value || typeof value !== 'object') return false;
  const adminCredentials = Reflect.get(value, 'adminCredentials');
  const robotSecretNames = Reflect.get(value, 'robotSecretNames');
  return typeof Reflect.get(value, 'endpoint') === 'string'
    && Boolean((Reflect.get(value, 'endpoint') as string).trim())
    && typeof Reflect.get(value, 'project') === 'string'
    && Boolean((Reflect.get(value, 'project') as string).trim())
    && typeof Reflect.get(value, 'allowPlainHttp') === 'boolean'
    && typeof Reflect.get(value, 'insecure') === 'boolean'
    && typeof Reflect.get(value, 'purgeRepositories') === 'boolean'
    && typeof Reflect.get(value, 'secretNamespace') === 'string'
    && Boolean((Reflect.get(value, 'secretNamespace') as string).trim())
    && Array.isArray(robotSecretNames)
    && robotSecretNames.every((name) => typeof name === 'string' && Boolean(name.trim()))
    && adminCredentials !== null
    && typeof adminCredentials === 'object'
    && Reflect.get(adminCredentials, 'apiVersion') === 'v1'
    && Reflect.get(adminCredentials, 'kind') === 'Secret'
    && typeof Reflect.get(adminCredentials, 'name') === 'string'
    && typeof Reflect.get(adminCredentials, 'namespace') === 'string';
}

function isDirectNamespacePreparationReceipt(value: unknown): value is ApplicationDirectNamespacePreparationReceipt {
  return Boolean(
    value
    && typeof value === 'object'
    && Reflect.get(value, 'apiVersion') === 'applik8s.deployment/v1alpha1'
    && Reflect.get(value, 'kind') === 'DirectNamespacePreparation'
    && typeof Reflect.get(value, 'namespace') === 'string'
    && Boolean((Reflect.get(value, 'namespace') as string).trim())
    && typeof Reflect.get(value, 'instanceName') === 'string'
    && Boolean((Reflect.get(value, 'instanceName') as string).trim())
    && (Reflect.get(value, 'ownership') === 'managed' || Reflect.get(value, 'ownership') === 'external')
    && (Reflect.get(value, 'purpose') === undefined
      || Reflect.get(value, 'purpose') === 'container-registry'
      || Reflect.get(value, 'purpose') === 'application-host'
      || Reflect.get(value, 'purpose') === 'application-control-plane'
      || Reflect.get(value, 'purpose') === 'provider-control-plane'
      || Reflect.get(value, 'purpose') === 'identity-infrastructure')
  );
}

function splitTaggedImage(image: string): { readonly imageName: string; readonly tag: string } {
  const separator = image.lastIndexOf(':');
  if (separator <= image.lastIndexOf('/')) {
    throw new Error(`Generated image ${image} must include an explicit tag before deployment.`);
  }
  return { imageName: image.slice(0, separator), tag: image.slice(separator + 1) };
}

function relativeDockerfile(contextPath: string, dockerfilePath: string): string {
  const normalizedContext = resolve(contextPath);
  const normalizedDockerfile = resolve(dockerfilePath);
  const prefix = `${normalizedContext}/`;
  if (!normalizedDockerfile.startsWith(prefix)) {
    throw new Error(`Generated Dockerfile ${dockerfilePath} is outside its declared context ${contextPath}.`);
  }
  return normalizedDockerfile.slice(prefix.length);
}

interface ApplicationHostDirectSecretPreparationReceipt {
  readonly apiVersion: 'applik8s.deployment/v1alpha1';
  readonly kind: 'DirectSecretPreparation';
  readonly namespace: string;
  readonly name: string;
  readonly key: string;
  readonly instanceName: string;
  readonly ownership: 'managed' | 'external';
}

interface ApplicationHostPreparationReceipt {
  readonly apiVersion: 'applik8s.deployment/v1alpha1';
  readonly kind: 'ApplicationHostPreparationReceipt';
  readonly controlPlaneNamespace?: ApplicationDirectNamespacePreparationReceipt;
  /** @deprecated v0.6 receipt compatibility; use namespaces. */
  readonly namespace?: ApplicationDirectNamespacePreparationReceipt;
  readonly namespaces?: readonly ApplicationDirectNamespacePreparationReceipt[];
  /** @deprecated v0.6 receipt compatibility; use cursorSecrets. */
  readonly cursorSecret?: ApplicationHostDirectSecretPreparationReceipt;
  readonly cursorSecrets?: readonly ApplicationHostDirectSecretPreparationReceipt[];
}

export interface ApplicationRuntimeCursorSecretTarget {
  readonly namespace: string;
  readonly name: string;
  readonly key: string;
  readonly consumerName: string;
}

async function writeApplicationHostPreparationReceipt(
  bundlePath: string,
  scope: ApplicationDeploymentReceiptScope,
  receipt: ApplicationHostPreparationReceipt,
): Promise<void> {
  const path = applicationDeploymentReceiptPath(bundlePath, scope, 'application-host-preparation.json');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`);
}

async function readApplicationHostPreparationReceipt(bundlePath: string, scope: ApplicationDeploymentReceiptScope): Promise<ApplicationHostPreparationReceipt | undefined> {
  const path = await existingApplicationDeploymentReceiptPath(bundlePath, scope, 'application-host-preparation.json');
  if (!path) return undefined;
  const value = JSON.parse(await readFile(path, 'utf8')) as ApplicationHostPreparationReceipt;
  if (value.apiVersion !== 'applik8s.deployment/v1alpha1' || value.kind !== 'ApplicationHostPreparationReceipt') {
    throw new Error(`ApplicationHost preparation receipt ${path} has an unsupported contract.`);
  }
  return value;
}

async function prepareGeneratedApplicationHosts(
  bundlePath: string,
  context: string,
  controlPlaneNamespace: string,
  spec: Readonly<Record<string, unknown>>,
  io: CliIo,
): Promise<ApplicationHostPreparationReceipt> {
  const controlPlaneNamespaceReceipt = await ensureDirectNamespace(io, context, controlPlaneNamespace, 'application-control-plane');
  const hostManifestPath = resolve(dirname(bundlePath), 'application-host', 'application-host.json');
  const host = await access(hostManifestPath).then(() => true).catch(() => false)
    ? resolveApplicationInstallationValues(JSON.parse(await readFile(hostManifestPath, 'utf8')), spec) as {
    readonly metadata?: { readonly name?: string };
    readonly spec?: {
      readonly namespace?: string;
      readonly cursorSecret?: { readonly name?: string; readonly key?: string };
    };
      }
    : undefined;
  if (host && (!host.spec?.namespace || !host.spec.cursorSecret?.name || !host.spec.cursorSecret.key)) {
    throw new Error('Generated ApplicationHost artifact is missing namespace or cursor Secret metadata.');
  }
  const source = await readGeneratedApplicationGraph(bundlePath, io.cwd);
  const graph = resolveApplicationInstallationValues(
    applicationGraphDeploymentSlice(source, (node) => node.kind === 'gateway'),
    spec,
  );
  const targets = collectApplicationRuntimeCursorSecrets(graph, host);
  const namespaceNames = [...new Set(targets.map((target) => target.namespace))]
    .filter((namespace) => namespace !== controlPlaneNamespace)
    .sort();
  const namespaces: ApplicationDirectNamespacePreparationReceipt[] = [];
  for (const namespace of namespaceNames) {
    namespaces.push(await ensureDirectNamespace(io, context, namespace, 'application-host'));
  }
  const cursorSecrets: ApplicationHostDirectSecretPreparationReceipt[] = [];
  for (const target of targets) {
    cursorSecrets.push(await ensureApplicationHostCursorSecret(context, target, io));
  }
  return {
    apiVersion: 'applik8s.deployment/v1alpha1',
    kind: 'ApplicationHostPreparationReceipt',
    controlPlaneNamespace: controlPlaneNamespaceReceipt,
    ...(namespaces.length > 0 ? { namespaces } : {}),
    ...(cursorSecrets.length > 0 ? { cursorSecrets } : {}),
  };
}

export function collectApplicationRuntimeCursorSecrets(
  graph: ApplicationGraph,
  host?: {
    readonly metadata?: { readonly name?: string };
    readonly spec?: {
      readonly namespace?: string;
      readonly cursorSecret?: { readonly name?: string; readonly key?: string };
    };
  },
): readonly ApplicationRuntimeCursorSecretTarget[] {
  const candidates: ApplicationRuntimeCursorSecretTarget[] = [];
  if (host?.spec?.namespace && host.spec.cursorSecret?.name && host.spec.cursorSecret.key) {
    candidates.push({
      namespace: host.spec.namespace,
      name: host.spec.cursorSecret.name,
      key: host.spec.cursorSecret.key,
      consumerName: host.metadata?.name ?? 'application-host',
    });
  }
  for (const node of graph.nodes) {
    if (node.kind !== 'gateway' || node.materialization !== 'generatedDeployment') continue;
    if (!node.deployment || !node.cursorSecret?.name || !node.cursorSecret.key) {
      throw new Error(`Generated application gateway ${node.id} is missing deployment or cursor Secret metadata.`);
    }
    if ((node.cursorSecret.apiVersion ?? 'v1') !== 'v1' || (node.cursorSecret.kind ?? 'Secret') !== 'Secret') {
      throw new Error(`Generated application gateway ${node.id} cursor signing material must be a core/v1 Secret.`);
    }
    candidates.push({
      namespace: node.cursorSecret.namespace ?? node.deployment.namespace,
      name: node.cursorSecret.name,
      key: node.cursorSecret.key,
      consumerName: node.name,
    });
  }
  const targets = new Map<string, ApplicationRuntimeCursorSecretTarget>();
  for (const candidate of candidates) {
    const identity = `${candidate.namespace}/${candidate.name}`;
    const existing = targets.get(identity);
    if (existing && existing.key !== candidate.key) {
      throw new Error(`Runtime cursor Secret ${identity} is referenced with conflicting keys ${existing.key} and ${candidate.key}.`);
    }
    if (!existing) targets.set(identity, candidate);
  }
  return [...targets.values()].sort((left, right) =>
    `${left.namespace}/${left.name}`.localeCompare(`${right.namespace}/${right.name}`));
}

async function ensureApplicationHostCursorSecret(
  context: string,
  secret: ApplicationRuntimeCursorSecretTarget,
  io: CliIo,
): Promise<ApplicationHostDirectSecretPreparationReceipt> {
  // static-import-exception: host preparation loads the optional Kubernetes SDK only for live deployment.
  const kubernetes = await import('@kubernetes/client-node');
  const kubeConfig = new kubernetes.KubeConfig();
  kubeConfig.loadFromDefault();
  kubeConfig.setCurrentContext(context);
  const existing = await makeKubernetesApiClient(kubeConfig, kubernetes.CoreV1Api).readNamespacedSecret({
    namespace: secret.namespace,
    name: secret.name,
  }).catch((cause: unknown) => {
    if (kubernetesStatusCode(cause) === 404) return undefined;
    throw cause;
  });
  const labels = existing?.metadata?.labels ?? {};
  const managed = labels['applik8s.dev/direct-preparation'] === 'application-host-cursor'
    || labels['applik8s.dev/direct-preparation'] === 'application-runtime-cursor';
  if (existing) {
    if (existing.type !== 'Opaque' || !existing.data?.[secret.key]) {
      throw new Error(`Existing ApplicationHost cursor Secret ${secret.namespace}/${secret.name} must be Opaque and contain ${secret.key}.`);
    }
    io.stdout(`Reusing ${managed ? 'managed' : 'externally owned'} runtime cursor Secret ${secret.namespace}/${secret.name}`);
    return directSecretPreparationReceipt(
      secret,
      managed ? 'managed' : 'external',
      managed
        ? labels['applik8s.dev/direct-preparation-instance'] ?? applicationRuntimeCursorSecretInstanceName(secret)
        : applicationRuntimeCursorSecretInstanceName(secret),
    );
  }
  const factory = await applicationHostCursorSecretFactory(kubeConfig, secret, randomBytes(48).toString('base64url'), io);
  const instanceName = applicationRuntimeCursorSecretInstanceName(secret);
  io.stdout(`Preparing stable runtime cursor Secret ${secret.namespace}/${secret.name} through TypeKro direct mode`);
  await factory.deploy({ name: secret.name, namespace: secret.namespace }, { instanceNameOverride: instanceName });
  return directSecretPreparationReceipt(secret, 'managed');
}

async function applicationHostCursorSecretFactory(
  kubeConfig: InstanceType<typeof import('@kubernetes/client-node').KubeConfig>,
  secret: ApplicationRuntimeCursorSecretTarget,
  value: string,
  io: CliIo,
): Promise<TypeKroDirectFactory> {
  const typeKro = await importProjectModule<TypeKroCompositionModule>('typekro', io.cwd);
  const typeKroKubernetes = await importProjectModule<TypeKroKubernetesModule>('typekro/kubernetes', io.cwd);
  // static-import-exception: ArkType is loaded only when constructing this direct TypeKro preparation graph.
  const { type } = await import('arktype');
  const preparation = typeKro.kubernetesComposition({
    name: 'applik8s-application-host-cursor',
    apiVersion: 'deployment.applik8s.dev/v1alpha1',
    kind: 'ApplicationHostCursor',
    spec: type({ name: 'string', namespace: 'string' }),
    status: type({ ready: 'boolean' }),
  }, (spec) => {
    typeKroKubernetes.secret({
      id: 'cursorSecret',
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: {
        name: spec.name,
        namespace: spec.namespace,
        labels: {
          'app.kubernetes.io/managed-by': 'applik8s',
          'applik8s.dev/application-host-secret': 'cursor-signing',
          'applik8s.dev/runtime-cursor-consumer': secret.consumerName,
          'applik8s.dev/direct-preparation': 'application-runtime-cursor',
          'applik8s.dev/direct-preparation-instance': applicationRuntimeCursorSecretInstanceName(secret),
        },
      },
      type: 'Opaque',
      stringData: { [secret.key]: value },
    });
    return { ready: true };
  });
  return preparation.factory('direct', {
    namespace: 'default',
    kubeConfig,
    waitForReady: true,
    timeout: 60_000,
    conflictStrategy: 'patch',
  });
}

function directSecretPreparationReceipt(
  secret: { readonly namespace: string; readonly name: string; readonly key: string },
  ownership: ApplicationHostDirectSecretPreparationReceipt['ownership'],
  instanceName = applicationRuntimeCursorSecretInstanceName(secret),
): ApplicationHostDirectSecretPreparationReceipt {
  return {
    apiVersion: 'applik8s.deployment/v1alpha1',
    kind: 'DirectSecretPreparation',
    namespace: secret.namespace,
    name: secret.name,
    key: secret.key,
    instanceName,
    ownership,
  };
}

function applicationRuntimeCursorSecretInstanceName(
  secret: { readonly namespace: string; readonly name: string },
): string {
  const readable = `${secret.namespace}-${secret.name}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 44)
    .replace(/-+$/g, '');
  const digest = createHash('sha256').update(`${secret.namespace}/${secret.name}`).digest('hex').slice(0, 12);
  return `${readable || 'cursor'}-${digest}`;
}

async function deleteGeneratedApplicationHostPreparation(
  receipt: ApplicationHostPreparationReceipt,
  context: string,
  io: CliIo,
  options: { readonly preserveNamespaces?: readonly string[] } = {},
): Promise<void> {
  const cursorSecrets = receipt.cursorSecrets ?? (receipt.cursorSecret ? [receipt.cursorSecret] : []);
  for (const cursorSecret of [...cursorSecrets].reverse()) {
    if (cursorSecret.ownership !== 'managed') continue;
    // static-import-exception: host cleanup loads the optional Kubernetes SDK only for live lifecycle work.
    const kubernetes = await import('@kubernetes/client-node');
    const kubeConfig = new kubernetes.KubeConfig();
    kubeConfig.loadFromDefault();
    kubeConfig.setCurrentContext(context);
    const factory = await applicationHostCursorSecretFactory(kubeConfig, {
      namespace: cursorSecret.namespace,
      name: cursorSecret.name,
      key: cursorSecret.key,
      consumerName: 'application-runtime',
    }, 'deletion-placeholder-not-applied', io);
    const secretExists = await makeKubernetesApiClient(kubeConfig, kubernetes.CoreV1Api).readNamespacedSecret({
      namespace: cursorSecret.namespace,
      name: cursorSecret.name,
    }).then(() => true).catch((cause: unknown) => {
      if (kubernetesStatusCode(cause) === 404) return false;
      throw cause;
    });
    if (!secretExists) {
      io.stdout(`Managed runtime cursor Secret ${cursorSecret.namespace}/${cursorSecret.name} is already absent; continuing idempotent cleanup`);
      continue;
    }
    io.stdout(`Deleting runtime cursor Secret ${cursorSecret.namespace}/${cursorSecret.name} through TypeKro direct mode`);
    try {
      await factory.deleteInstance(cursorSecret.instanceName);
    } catch (cause) {
      const stillExists = await makeKubernetesApiClient(kubeConfig, kubernetes.CoreV1Api).readNamespacedSecret({
        namespace: cursorSecret.namespace,
        name: cursorSecret.name,
      }).then(() => true).catch((readCause: unknown) => {
        if (kubernetesStatusCode(readCause) === 404) return false;
        throw readCause;
      });
      if (stillExists) throw cause;
      io.stdout(`Managed runtime cursor Secret ${cursorSecret.namespace}/${cursorSecret.name} reached 404 during TypeKro cleanup; continuing idempotently`);
    }
  }
  const preserved = new Set(options.preserveNamespaces ?? []);
  const namespaces = receipt.namespaces ?? (receipt.namespace ? [receipt.namespace] : []);
  for (const namespace of [...namespaces].reverse()) {
    if (namespace.ownership === 'managed' && !preserved.has(namespace.namespace)) {
      await deleteDirectNamespace(io, context, namespace);
    }
  }
  if (receipt.controlPlaneNamespace?.ownership === 'managed'
    && !preserved.has(receipt.controlPlaneNamespace.namespace)) {
    await deleteDirectNamespace(io, context, receipt.controlPlaneNamespace);
  }
}

async function runBuild(entrypoint: string, options: BuildCommandOptions, io: CliIo): Promise<number> {
  if (isBunRuntime()) {
    return runChild({
      command: 'node',
      args: [fileURLToPath(new URL('./node-build-runner.mjs', import.meta.url)), JSON.stringify({ entrypoint, options, cwd: io.cwd })],
      cwd: io.cwd,
    });
  }

  // static-import-exception: Bun CLI must not eagerly load the compiler because ComponentizeJS requires Node APIs before build delegation can run.
  const { compileTypeKroComposition, createCompilerPipeline } = await import('@applik8s/compiler');
  const connectionBindings = options.connectionBindings
    // typecast: the compiler validates the complete installation binding contract before emitting artifacts.
    ? JSON.parse(await readFile(resolve(io.cwd, options.connectionBindings), 'utf8')) as Readonly<Record<string, KubernetesConnectionBinding | Readonly<Record<string, KubernetesConnectionBinding>>>>
    : undefined;
  // typecast: preserve literal compiler option types across the lazy compiler import without importing runtime compiler types into the CLI entrypoint.
  const request = {
    entrypoint,
    ...(options.outDir ? { outDir: options.outDir } : {}),
    ...(options.operatorName ? { operatorName: options.operatorName } : {}),
    ...(options.compositionName ? { compositionName: options.compositionName } : {}),
    runtimeVersionRange: '^0.1.0',
    handlerAbiVersion: 'applik8s.handler/v1alpha1',
    adapter: 'wasmComponent',
    ...(connectionBindings
      ? options.typekro
        // typecast: --typekro binding files are operator-name maps; each nested alias map is validated by the compiler.
        ? { operatorKubernetesConnectionBindings: connectionBindings as Readonly<Record<string, Readonly<Record<string, KubernetesConnectionBinding>>>> }
        // typecast: single-operator binding files are alias maps validated by the compiler.
        : { kubernetesConnectionBindings: connectionBindings as Readonly<Record<string, KubernetesConnectionBinding>> }
      : {}),
    portability: {
      deterministicBuild: true,
      allowEnvironmentAccess: false,
      allowFilesystemAccess: false,
      allowNetworkAccess: true,
      allowedHostImports: [],
      sourceMaps: { emit: true, includeSourceContent: false, redactPaths: false },
    },
  } as const;
  if (options.typekro) {
    const typeKroResult = await compileTypeKroComposition(request);
    if (!typeKroResult.ok) {
      io.stderr(typeKroResult.error.message);
      return 1;
    }
    io.stdout(`Built TypeKro composition ${typeKroResult.value.artifacts.manifest.metadata.name}`);
    io.stdout(`Composition: ${typeKroResult.value.artifacts.manifestJsonPath}`);
    io.stdout(`Resources: ${typeKroResult.value.artifacts.combinedYamlPath}`);
    io.stdout(`Apply: ${typeKroResult.value.artifacts.applyScriptPath}`);
    io.stdout(`Operators: ${typeKroResult.value.artifacts.operatorArtifacts.length}`);
    return 0;
  }

  const result = await createCompilerPipeline().run(request);
  if (!result.ok) {
    io.stderr(result.error.message);
    return 1;
  }
  io.stdout(`Built ${result.value.manifest.metadata.name}`);
  io.stdout(`Manifest: ${result.value.artifacts.manifestJsonPath}`);
  io.stdout(`Kubernetes: ${result.value.artifacts.generatedDeploymentYamlPath ? result.value.artifacts.generatedDeploymentYamlPath.replace(/deployment-[^/]+\.yaml$/, '') : '<not emitted>'}`);
  io.stdout(`Apply: ${result.value.artifacts.generatedApplyScriptPath ?? '<not emitted>'}`);
  return 0;
}

function isBunRuntime(): boolean {
  return typeof process.versions.bun === 'string';
}

async function runExplain(reason: string, io: CliIo): Promise<number> {
  // static-import-exception: keep compiler loading lazy so non-build CLI commands stay usable under Bun's Node API gaps.
  const { diagnosticAdviceForReason } = await import('@applik8s/compiler');
  const advice = diagnosticAdviceForReason(reason);
  if (!advice) {
    io.stderr(`No diagnostic advice is registered for ${reason}.`);
    return 1;
  }
  io.stdout(`${advice.reason} (${advice.category})`);
  io.stdout(`What happened: ${advice.whatHappened}`);
  io.stdout(`Likely cause: ${advice.likelyCause}`);
  io.stdout(`How to fix: ${advice.howToFix}`);
  io.stdout(`Effects: ${advice.effects}`);
  io.stdout(`Retry: ${advice.retry}`);
  return 0;
}

async function runChild(options: ChildProcessOptions): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      stdio: options.input !== undefined ? ['pipe', options.stdio ?? 'inherit', options.stdio ?? 'inherit'] : options.stdio ?? 'inherit',
      env: options.env ?? process.env,
    });
    if (options.input !== undefined) {
      child.stdin?.end(options.input);
    }
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}

async function runChildCapture(options: Omit<ChildProcessOptions, 'input' | 'stdio'>): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: options.env ?? process.env,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolveOutput(Buffer.concat(stdout).toString('utf8'));
        return;
      }
      reject(new Error(`${options.command} ${options.args.join(' ')} failed: ${Buffer.concat(stderr).toString('utf8').trim()}`));
    });
  });
}

function defaultIo(): CliIo {
  return {
    cwd: process.cwd(),
    stdout: (message) => process.stdout.write(`${message}\n`),
    stderr: (message) => process.stderr.write(`${message}\n`),
  };
}

function trimTrailingNewline(message: string): string {
  return message.endsWith('\n') ? message.slice(0, -1) : message;
}
