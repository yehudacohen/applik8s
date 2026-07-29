// typecast-file-boundary: deployment commands validate generated JSON, dynamic application modules, and migration receipts before crossing typed backend contracts.
import { dirname, join, resolve } from 'node:path';
import { access, readFile } from 'node:fs/promises';
import {
  planApplicationProfileTransitions,
  type ApplicationProfileTransitionPlan,
} from '@applik8s/core';
import type { DeploymentJsonObject } from '@applik8s/deployment-contract';
import {
  loadTypeKroCompositionEntrypoint,
  resolveApplicationBuildPackage,
  resolveGeneratedApplicationDeleteTarget,
  stageExplicitApplicationInstance,
} from './application-deployment-files.js';
import {
  readApplicationInstanceSpec,
  verifyApplicationRegistryPullSecret,
  waitForApplicationEndpoint,
  waitForApplicationInstanceReadiness,
  waitForResourceGraphDefinitionReadiness,
} from './application-deployment-observer.js';
import {
  readGeneratedApplicationGraph,
  resolveDeploymentContainerRegistry,
} from './application-deployment-registry.js';
import { resolveApplicationInstallationValues } from './application-installation-values.js';

export interface ApplicationDeploymentCommandIo {
  readonly cwd: string;
  stdout(message: string): void;
  stderr(message: string): void;
}

export interface ApplicationDeployCommandOptions {
  readonly context: string;
  readonly strategy?: 'direct' | 'kro';
  readonly outDir?: string;
  readonly compositionName?: string;
  readonly connectionBindings?: string;
  readonly instance?: string;
  readonly skipAppBuild?: boolean;
  readonly skipImageBuild?: boolean;
  readonly planOnly?: boolean;
  readonly runtimeEntrypoint?: string;
  readonly acknowledge?: readonly string[];
}

export interface ApplicationDeleteCommandOptions {
  readonly context: string;
  readonly outDir?: string;
  readonly compositionName?: string;
  readonly instanceName?: string;
  readonly controlPlaneNamespace?: string;
}

export interface ApplicationDeploymentCommandRuntime {
  runChild(options: {
    readonly command: string;
    readonly args: readonly string[];
    readonly cwd: string;
  }): Promise<number>;
  runBuild(
    entrypoint: string,
    options: {
      readonly outDir?: string;
      readonly typekro?: boolean;
      readonly compositionName?: string;
      readonly connectionBindings?: string;
      readonly production?: boolean;
    },
    io: ApplicationDeploymentCommandIo,
  ): Promise<number>;
}

type ApplicationDeploymentPhase =
  | 'application-build'
  | 'composition-compile'
  | 'instance-selection'
  | 'profile-transition'
  | 'deployment-plan'
  | 'registry-resolution'
  | 'pull-secret-verification'
  | 'alchemy-plan'
  | 'alchemy-apply'
  | 'alchemy-destroy'
  | 'authoritative-readiness'
  | 'exposure-verification';

const remediation: Readonly<Record<ApplicationDeploymentPhase, string>> = {
  'application-build': 'Run the application package build directly and fix its first reported error.',
  'composition-compile': 'Run applik8s build --typekro and inspect the compiler diagnostic.',
  'instance-selection': 'Provide exactly one authored root Application CR with --instance <path>.',
  'profile-transition': 'Inspect the current and desired installation profiles, then supply only the exact acknowledgement printed by the plan when a reviewed destructive transition is intentional.',
  'deployment-plan': 'Inspect application-deployment-graph.json and fix the first invalid identity, dependency, output, ownership, or lifecycle diagnostic.',
  'registry-resolution': 'Verify the selected Kubernetes context, registry Service, and provider endpoint.',
  'pull-secret-verification': 'Ensure the graph-created pull Secret is present in every authored workload namespace.',
  'alchemy-plan': 'Inspect the portable deployment graph and TypeKro semantic diagnostics.',
  'alchemy-apply': 'Inspect the failed Alchemy resource and retry only after its dependency is healthy.',
  'alchemy-destroy': 'Inspect the failed resource/finalizer and resume the same Alchemy destroy transaction.',
  'authoritative-readiness': 'Inspect the root Application status and the pending provider or workload named by it.',
  'exposure-verification': 'Inspect the projected URL and the selected exposure provider.',
};

export async function runApplicationDeploy(
  entrypoint: string,
  options: ApplicationDeployCommandOptions,
  io: ApplicationDeploymentCommandIo,
  runtime: ApplicationDeploymentCommandRuntime,
): Promise<number> {
  if (!options.context.trim()) {
    io.stderr('applik8s deploy requires a non-empty --context and never uses the ambient current context implicitly.');
    return 1;
  }
  if (options.strategy !== undefined && options.strategy !== 'direct' && options.strategy !== 'kro') {
    io.stderr(`applik8s deploy --strategy must be "direct" or "kro", received ${JSON.stringify(options.strategy)}.`);
    return 1;
  }
  if (!options.skipAppBuild) {
    const applicationPackage = await resolveApplicationBuildPackage(resolve(io.cwd, entrypoint));
    const buildCode = await runPhase('application-build', io, () =>
      runtime.runChild({ command: 'bun', args: ['run', 'build'], cwd: applicationPackage.directory }));
    if (buildCode !== 0) throw processError('application-build', buildCode);
  }
  const outDir = options.outDir ?? '.applik8s/deploy';
  const buildCode = await runPhase('composition-compile', io, () => runtime.runBuild(entrypoint, {
    outDir,
    typekro: true,
    // Deploy is a production boundary: externally reachable operations must
    // never reach a cluster with the development-only unclassified default.
    production: true,
    compositionName: options.compositionName ?? 'app',
    ...(options.connectionBindings ? { connectionBindings: options.connectionBindings } : {}),
  }, io));
  if (buildCode !== 0) throw processError('composition-compile', buildCode);
  const bundlePath = resolve(io.cwd, outDir, 'typekro', 'typekro-composition.json');
  const instance = await runPhase('instance-selection', io, () => stageExplicitApplicationInstance(
    resolve(io.cwd, entrypoint),
    bundlePath,
    options.instance ? resolve(io.cwd, options.instance) : undefined,
  ));
  io.stdout(`Application instance: ${instance.apiVersion}/${instance.kind}/${instance.name} in ${instance.namespace}`);
  const previousInstallationSpec = await runPhase(
    'profile-transition',
    io,
    () => readApplicationInstanceSpec(options.context, instance),
  );
  const emitted = await runPhase('deployment-plan', io, () => emitDeploymentGraph(
    bundlePath,
    options.context,
    instance,
    io.cwd,
    options.strategy ?? 'kro',
    previousInstallationSpec,
    options.acknowledge ?? [],
  ));
  io.stdout(`Application deployment graph: ${emitted.nodeCount} nodes, ${emitted.artifactCount} artifacts, ${emitted.digest}`);
  io.stdout(`Profile transition plan: ${emitted.profileTransition.mode}, ${emitted.profileTransition.entries.length} provider transition(s)`);
  for (const entry of emitted.profileTransition.entries) {
    io.stdout(
      `  ${entry.qualification}: ${entry.from} -> ${entry.to} (${entry.transition.kind}${entry.transition.destructive ? ', destructive' : ''})`,
    );
  }
  const registry = await runPhase('registry-resolution', io, () =>
    resolveDeploymentContainerRegistry(bundlePath, options.context, instance.spec, io));
  const source = await runPhase('alchemy-plan', io, () => loadTypeKroCompositionEntrypoint(
    resolve(io.cwd, options.runtimeEntrypoint ?? entrypoint),
    options.compositionName ?? 'app',
  ));
  // static-import-exception: keep Alchemy and provider implementations out of the thin CLI/router.
  const { createGeneratedApplicationAlchemyDeployment } = await import('./application-alchemy-deployment.js');
  const deployment = await createGeneratedApplicationAlchemyDeployment({
    graphPath: emitted.path,
    source: source as never,
    spec: instance.spec as never,
    context: options.context,
    registry,
    projectRoot: io.cwd,
  });
  const plan = await runPhase('alchemy-plan', io, () => deployment.plan());
  const effectful = plan.changes.filter((change) => change.action !== 'noop');
  io.stdout(`Alchemy plan: ${plan.changes.length} resources, ${effectful.length} changes, ${plan.declarationCount} TypeKro declarations`);
  for (const change of effectful) io.stdout(`  ${change.action} ${change.type} ${change.id}`);
  if (options.planOnly) {
    io.stdout('Plan-only deployment completed without applying effects.');
    return 0;
  }
  if (options.skipImageBuild) {
    throw new Error('--skip-image-build is incompatible with graph deployment because every compiler-declared artifact must resolve through its Alchemy resource before Kubernetes apply.');
  }
  io.stdout(`Deploying the TypeKro application graph through Alchemy to context ${options.context}`);
  const applied = await runPhase('alchemy-apply', io, () => deployment.apply());
  io.stdout(`Alchemy transaction applied: ${applied.declarationCount} TypeKro declarations, ${applied.artifacts.length} immutable artifacts`);
  await runPhase('pull-secret-verification', io, () =>
    verifyApplicationRegistryPullSecret(registry, options.context));
  await runPhase('authoritative-readiness', io, () =>
    waitForResourceGraphDefinitionReadiness(options.context, instance.resourceGraphDefinitionName, io));
  const readiness = await runPhase('authoritative-readiness', io, () =>
    waitForApplicationInstanceReadiness(options.context, instance, io));
  if (readiness.url) {
    await runPhase('exposure-verification', io, () =>
      waitForApplicationEndpoint(readiness.url as string, io));
  }
  io.stdout(`Application ready: ${instance.apiVersion}/${instance.kind}/${instance.name}${readiness.url ? ` at ${readiness.url}` : ''}`);
  return 0;
}

export async function runApplicationDelete(
  entrypoint: string,
  options: ApplicationDeleteCommandOptions,
  io: ApplicationDeploymentCommandIo,
): Promise<number> {
  const outDir = options.outDir ?? '.applik8s/deploy';
  const bundlePath = resolve(io.cwd, outDir, 'typekro', 'typekro-composition.json');
  const graphPath = join(dirname(bundlePath), 'application-deployment-graph.json');
  if (!await access(graphPath).then(() => true).catch(() => false)) {
    throw new Error(
      `No deployment graph exists at ${graphPath}. Applik8s refuses to guess at ownership or run an obsolete lifecycle engine; rebuild or redeploy the application before deleting it.`,
    );
  }
  const target = await resolveGeneratedApplicationDeleteTarget(bundlePath, options);
  const {
    applicationDeploymentInstallationSpec,
    createGeneratedApplicationAlchemyDeployment,
    readApplicationDeploymentGraph,
    // static-import-exception: keep Alchemy and provider implementations out of the thin CLI/router.
  } = await import('./application-alchemy-deployment.js');
  const graph = await readApplicationDeploymentGraph(graphPath);
  if (
    graph.metadata.identity.instance !== target.instanceName ||
    graph.metadata.identity.controlPlaneNamespace !== target.controlPlaneNamespace
  ) {
    throw new Error(
      `Delete target ${target.controlPlaneNamespace}/${target.instanceName} does not match persisted Alchemy stack identity ${graph.metadata.identity.controlPlaneNamespace}/${graph.metadata.identity.instance}.`,
    );
  }
  const spec = applicationDeploymentInstallationSpec(graph);
  const source = await loadTypeKroCompositionEntrypoint(
    resolve(io.cwd, entrypoint),
    options.compositionName ?? 'app',
  );
  const registry = await resolveDeploymentContainerRegistry(
    bundlePath,
    options.context,
    spec,
    io,
  );
  const deployment = await createGeneratedApplicationAlchemyDeployment({
    graphPath,
    source: source as never,
    spec: spec as never,
    context: options.context,
    registry,
    projectRoot: io.cwd,
  });
  io.stdout(`Destroying ${target.apiVersion}/${target.kind}/${target.instanceName} through Alchemy and TypeKro in context ${options.context}`);
  await runPhase('alchemy-destroy', io, () => deployment.destroy());
  io.stdout(`Application instance ${target.instanceName} deleted; Alchemy and TypeKro finalization completed.`);
  return 0;
}

async function emitDeploymentGraph(
  bundlePath: string,
  context: string,
  instance: {
    readonly name: string;
    readonly namespace: string;
    readonly spec: Readonly<Record<string, unknown>>;
  },
  projectRoot: string,
  strategy: 'direct' | 'kro',
  previousInstallationSpec: DeploymentJsonObject | undefined,
  acknowledgements: readonly string[],
): Promise<{
  readonly path: string;
  readonly digest: string;
  readonly nodeCount: number;
  readonly artifactCount: number;
  readonly profileTransition: ApplicationProfileTransitionPlan;
}> {
  const bundle = JSON.parse(await readFile(bundlePath, 'utf8')) as {
    readonly spec?: { readonly applicationGraph?: { readonly digest?: string } };
  };
  const sourceGraphDigest = bundle.spec?.applicationGraph?.digest;
  if (!sourceGraphDigest || !/^sha256:[a-f0-9]{64}$/.test(sourceGraphDigest)) {
    throw new Error('Generated TypeKro bundle must reference an ApplicationGraph with a full sha256 digest.');
  }
  const source = await readGeneratedApplicationGraph(bundlePath, projectRoot);
  const graph = resolveApplicationInstallationValues(source, instance.spec, {
    preserveUnknownReferences: true,
  });
  const profileTransition = planApplicationProfileTransitions({
    graph,
    installation: {
      namespace: instance.namespace,
      name: instance.name,
    },
    ...(previousInstallationSpec ? { previousInstallationSpec } : {}),
    // typecast-boundary: staged Application YAML was parsed to JSON and its
    // spec root was validated before this deployment boundary.
    desiredInstallationSpec: instance.spec as unknown as DeploymentJsonObject,
    acknowledgements,
  });
  // static-import-exception: compiler workers are loaded only for an active Node deployment command.
  const { applicationDeploymentCompilerVersion, emitApplicationDeploymentGraph } = await import('@applik8s/compiler');
  const emitted = await emitApplicationDeploymentGraph({
    bundlePath,
    projectRoot,
    graph,
    sourceGraphDigest,
    compilerVersion: applicationDeploymentCompilerVersion,
    context,
    controlPlaneNamespace: instance.namespace,
    instance: instance.name,
    profile: typeof instance.spec.profile === 'string' && instance.spec.profile.trim()
      ? instance.spec.profile
      : 'default',
    strategy,
    installationSpec: instance.spec,
    profileTransition: profileTransition.identityInput,
  });
  return {
    path: emitted.path,
    digest: emitted.digest,
    nodeCount: emitted.graph.nodes.length,
    artifactCount: emitted.artifactCount,
    profileTransition,
  };
}

async function runPhase<T>(
  phase: ApplicationDeploymentPhase,
  io: ApplicationDeploymentCommandIo,
  operation: () => Promise<T>,
): Promise<T> {
  io.stdout(`Deployment phase: ${phase}`);
  try {
    return await operation();
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Deployment phase ${phase} failed: ${detail} Remediation: ${remediation[phase]}`, { cause });
  }
}

function processError(phase: ApplicationDeploymentPhase, code: number): Error {
  return new Error(`Deployment phase ${phase} failed with exit code ${code}. Remediation: ${remediation[phase]}`);
}
