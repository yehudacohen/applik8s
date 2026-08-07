// typecast-file-boundary: deployment commands validate generated JSON, dynamic application modules, and migration receipts before crossing typed backend contracts.
import { dirname, join, resolve } from 'node:path';
import { access, readFile } from 'node:fs/promises';
import {
  planApplicationProfileTransitions,
  type ApplicationProfileTransitionPlan,
} from '@applik8s/core';
import type { DeploymentJsonObject } from '@applik8s/deployment-contract';
import {
  applicationDeploymentPhaseRemediation as remediation,
  type ApplicationDeleteCommandOptions,
  type ApplicationDeployCommandOptions,
  type ApplicationDeploymentCommandIo,
  type ApplicationDeploymentCommandRuntime,
  type ApplicationDeploymentPhase,
  type ApplicationStatusCommandOptions,
} from './application-deployment-command-contract.js';
import {
  loadTypeKroCompositionEntrypoint,
  resolveGeneratedApplicationDeleteTarget,
  stageExplicitApplicationInstance,
} from './application-deployment-files.js';
import {
  resolveApplicationBuildPackage,
  resolveApplicationProjectRoot,
} from './application-build-package.js';
import { prepareTypeKroCompositionRuntimeEntrypoint } from './application-deployment-runtime-entrypoint.js';
import {
  applicationInstallationReadiness,
  readApplicationInstanceSpec,
  readApplicationInstance,
  readResourceGraphDefinition,
  resourceGraphDefinitionReadiness,
  verifyApplicationRegistryPullSecret,
  waitForApplicationOwnedNamespaceDeletion,
  waitForApplicationEndpoint,
  waitForApplicationInstanceReadiness,
  waitForResourceGraphDefinitionReadiness,
} from './application-deployment-observer.js';
import {
  readGeneratedApplicationGraph,
  resolveDeploymentContainerRegistry,
} from './application-deployment-registry.js';
import { resolveApplicationInstallationValues } from './application-installation-values.js';
import {
  applicationDeploymentInstallationSpec,
  createGeneratedApplicationAlchemyDeployment,
  readApplicationDeploymentGraph,
} from './application-alchemy-deployment.js';

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
  const applicationEntrypoint = resolve(io.cwd, entrypoint);
  const projectRoot = await resolveApplicationProjectRoot(applicationEntrypoint);
  if (!options.skipAppBuild) {
    const applicationPackage = await resolveApplicationBuildPackage(applicationEntrypoint);
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
    applicationEntrypoint,
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
    projectRoot,
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
  const runtimeEntrypoint = await runPhase('alchemy-plan', io, () =>
    prepareTypeKroCompositionRuntimeEntrypoint(
      resolve(io.cwd, options.runtimeEntrypoint ?? entrypoint),
      bundlePath,
      projectRoot,
    ));
  const source = await runPhase('alchemy-plan', io, () => loadTypeKroCompositionEntrypoint(
    runtimeEntrypoint,
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
    projectRoot,
    ...(options.development ? { development: true } : {}),
    ...(options.allowBreakingChanges
      ? { allowBreakingChanges: true }
      : {}),
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
  const applicationEntrypoint = resolve(io.cwd, entrypoint);
  const projectRoot = await resolveApplicationProjectRoot(applicationEntrypoint);
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
  const runtimeEntrypoint = await prepareTypeKroCompositionRuntimeEntrypoint(
    applicationEntrypoint,
    bundlePath,
    projectRoot,
  );
  const source = await loadTypeKroCompositionEntrypoint(
    runtimeEntrypoint,
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
    projectRoot,
  });
  io.stdout(`Destroying ${target.apiVersion}/${target.kind}/${target.instanceName} through Alchemy and TypeKro in context ${options.context}`);
  await runPhase('alchemy-destroy', io, () => deployment.destroy());
  await runPhase('alchemy-destroy', io, () =>
    waitForApplicationOwnedNamespaceDeletion(options.context, graph, io));
  io.stdout(`Application instance ${target.instanceName} deleted; Alchemy and TypeKro finalization completed.`);
  return 0;
}

export async function runApplicationStatus(
  entrypoint: string,
  options: ApplicationStatusCommandOptions,
  io: ApplicationDeploymentCommandIo,
): Promise<number> {
  const applicationEntrypoint = resolve(io.cwd, entrypoint);
  const projectRoot = await resolveApplicationProjectRoot(applicationEntrypoint);
  const outDir = options.outDir ?? '.applik8s/deploy';
  const bundlePath = resolve(io.cwd, outDir, 'typekro', 'typekro-composition.json');
  const graphPath = join(dirname(bundlePath), 'application-deployment-graph.json');
  if (!await access(graphPath).then(() => true).catch(() => false)) {
    throw new Error(
      `No deployment graph exists at ${graphPath}. Run applik8s plan or applik8s deploy before requesting graph-native status.`,
    );
  }
  const target = await resolveGeneratedApplicationDeleteTarget(bundlePath, options);
  const graph = await readApplicationDeploymentGraph(graphPath);
  if (
    graph.metadata.identity.instance !== target.instanceName
    || graph.metadata.identity.controlPlaneNamespace
      !== target.controlPlaneNamespace
  ) {
    throw new Error(
      `Status target ${target.controlPlaneNamespace}/${target.instanceName} does not match persisted Alchemy stack identity ${graph.metadata.identity.controlPlaneNamespace}/${graph.metadata.identity.instance}.`,
    );
  }
  const spec = applicationDeploymentInstallationSpec(graph);
  const runtimeEntrypoint = await prepareTypeKroCompositionRuntimeEntrypoint(
    applicationEntrypoint,
    bundlePath,
    projectRoot,
  );
  const source = await loadTypeKroCompositionEntrypoint(
    runtimeEntrypoint,
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
    projectRoot,
  });
  const [alchemy, definitionResource, instanceResource] = await Promise.all([
    deployment.plan(),
    target.resourceGraphDefinitionName
      ? readResourceGraphDefinition(
          options.context,
          target.resourceGraphDefinitionName,
        )
      : Promise.resolve(undefined),
    readApplicationInstance(options.context, {
      apiVersion: target.apiVersion,
      kind: target.kind,
      name: target.instanceName,
      namespace: target.controlPlaneNamespace,
    }),
  ]);
  const definition = resourceGraphDefinitionReadiness(definitionResource);
  const installation = applicationInstallationReadiness(instanceResource);
  const changes = alchemy.changes.filter((change) => change.action !== 'noop');
  const report = {
    apiVersion: 'applik8s.status/v1alpha1',
    application: graph.metadata.identity.application,
    context: options.context,
    deploymentGraph: {
      digest: graph.metadata.sourceGraphDigest,
      profile: graph.metadata.identity.profile,
      strategy: graph.metadata.strategy,
    },
    instance: {
      apiVersion: target.apiVersion,
      kind: target.kind,
      name: target.instanceName,
      namespace: target.controlPlaneNamespace,
      state: installation.state,
      summary: installation.summary,
      ...(installation.url ? { url: installation.url } : {}),
    },
    resourceGraphDefinition: {
      name: target.resourceGraphDefinitionName,
      state: definition.state,
      summary: definition.summary,
    },
    alchemy: {
      resources: alchemy.changes.length,
      pendingChanges: changes.map((change) => ({
        action: change.action,
        type: change.type,
        id: change.id,
      })),
      declarationCount: alchemy.declarationCount,
    },
  } as const;
  if (options.json) {
    io.stdout(JSON.stringify(report));
  } else {
    io.stdout(
      `${target.apiVersion}/${target.kind}/${target.controlPlaneNamespace}/${target.instanceName}: ${installation.state} (${installation.summary})`,
    );
    io.stdout(
      `ResourceGraphDefinition/${target.resourceGraphDefinitionName ?? '<unknown>'}: ${definition.state} (${definition.summary})`,
    );
    io.stdout(
      `Alchemy: ${alchemy.changes.length} resources, ${changes.length} pending change(s), ${alchemy.declarationCount} TypeKro declaration(s)`,
    );
    for (const change of changes) {
      io.stdout(`  ${change.action} ${change.type} ${change.id}`);
    }
    if (installation.url) io.stdout(`URL: ${installation.url}`);
  }
  return installation.state === 'failed' || definition.state === 'failed'
    ? 1
    : 0;
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

export type {
  ApplicationDeleteCommandOptions,
  ApplicationDeployCommandOptions,
  ApplicationDeploymentCommandIo,
  ApplicationDeploymentCommandRuntime,
  ApplicationStatusCommandOptions,
} from './application-deployment-command-contract.js';
