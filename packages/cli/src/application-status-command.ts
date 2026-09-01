// typecast-file-boundary: the validated generated composition and installation spec cross the generic TypeKro deployment boundary here.
import { access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  applicationDeploymentInstallationSpec,
  createGeneratedApplicationAlchemyDeployment,
  readApplicationDeploymentGraph,
} from './application-alchemy-deployment.js';
import { assertRequestedDeploymentProfile } from './application-deployment-profile.js';
import type {
  ApplicationDeploymentCommandIo,
  ApplicationStatusCommandOptions,
} from './application-deployment-command-contract.js';
import { recordApplicationStatusEvidence } from './application-deployment-evidence.js';
import { loadTypeKroCompositionEntrypoint, resolveGeneratedApplicationDeleteTarget } from './application-deployment-files.js';
import {
  applicationInstallationReadiness,
  readApplicationInstance,
  readResourceGraphDefinition,
  resourceGraphDefinitionReadiness,
} from './application-deployment-observer.js';
import { resolveApplicationProjectRoot } from './application-build-package.js';
import { resolveDeploymentContainerRegistry } from './application-deployment-registry.js';
import { prepareTypeKroCompositionRuntimeEntrypoint } from './application-deployment-runtime-entrypoint.js';

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
  assertRequestedDeploymentProfile(graph.metadata.identity.profile, options.profile, 'Status');
  if (
    graph.metadata.identity.instance !== target.instanceName
    || graph.metadata.identity.controlPlaneNamespace !== target.controlPlaneNamespace
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
      ? readResourceGraphDefinition(options.context, target.resourceGraphDefinitionName)
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
  await recordApplicationStatusEvidence({
    graph,
    state:
      installation.state === 'ready'
      && definition.state === 'ready'
      && changes.length === 0
        ? 'ready'
        : installation.state === 'failed' || definition.state === 'failed'
          ? 'action-required'
          : 'unknown',
    instanceState: installation.state,
    definitionState: definition.state,
    resourceCount: alchemy.changes.length,
    pendingChangeCount: changes.length,
    declarationCount: alchemy.declarationCount,
    outDir,
    cwd: io.cwd,
    stdout: io.stdout,
    deployment: {
      context: options.context,
      installationSpec: spec,
    },
  });
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
  return installation.state === 'failed' || definition.state === 'failed' ? 1 : 0;
}
