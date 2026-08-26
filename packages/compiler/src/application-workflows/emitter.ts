import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'esbuild';
import { emitGeneratedApplicationContainer } from '../application-containers/index.js';
import type { ApplicationRuntimeExecutionTarget } from '../application-event-log-runtime-source.js';
import { applicationFrameworkCredentialDependencies } from '../application-framework-credentials.js';
import { applik8sWorkspaceSourcePlugin } from '../bundling/index.js';
import type { WorkflowContract } from './contracts.js';
import { workflowResources } from './resources.js';
import {
  generatedHandlerModule,
  generatedOperationPrincipalModule,
  generatedWorkerSource,
  handlerModuleFile,
  hatchetSingleFileHeartbeatPlugin,
  operationPrincipalModuleFile,
  uniqueWorkflowProjectionEffects,
  writeWorkflowProjectionCallbackModules,
} from './source.js';
import type { GeneratedApplicationWorkflowArtifact } from './types.js';
import { kubernetesName, stringConfig } from './utilities.js';

export async function emitWorkflowWorker(
  contract: WorkflowContract,
  outDir: string,
  ownsProvider: boolean,
  executionTarget: ApplicationRuntimeExecutionTarget = 'kubernetes',
): Promise<GeneratedApplicationWorkflowArtifact> {
  const name = kubernetesName(contract.worker.name);
  const workerDir = join(outDir, name);
  const generatedEntrypoint = join(workerDir, 'workflow-worker.generated.ts');
  const sourcePath = join(workerDir, 'workflow-worker.mjs');
  const sourceMapPath = `${sourcePath}.map`;
  const manifestPath = join(workerDir, 'workflow-worker.manifest.json');
  const metafilePath = join(workerDir, 'workflow-worker.esbuild-meta.json');
  await mkdir(workerDir, { recursive: true });
  for (const handler of [...contract.tasks.map((entry) => entry.handler), ...contract.workflows.map((entry) => entry.handler)]) {
    const capabilityNames = handler.kind === 'taskHandler'
      ? (handler.capabilities ?? []).map((reference) => {
          const provider = contract.capabilities.find(
            (candidate) => candidate.id === reference.nodeId,
          );
          if (!provider) {
            throw new Error(
              `Workflow handler ${handler.id} references unavailable capability ${reference.nodeId}.`,
            );
          }
          return provider.interface;
        })
      : [];
    await writeFile(
      join(workerDir, handlerModuleFile(handler.id)),
      generatedHandlerModule(handler, capabilityNames),
    );
    if (handler.kind === 'taskHandler' && handler.operationPrincipalSource) {
      await writeFile(join(workerDir, operationPrincipalModuleFile(handler.id)), generatedOperationPrincipalModule(handler));
    }
  }
  for (const effect of uniqueWorkflowProjectionEffects(contract)) await writeWorkflowProjectionCallbackModules(workerDir, effect);
  await writeFile(generatedEntrypoint, generatedWorkerSource(contract, executionTarget));
  const result = await build({
    entryPoints: [generatedEntrypoint],
    outfile: sourcePath,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    legalComments: 'none',
    minify: true,
    keepNames: true,
    sourcemap: 'external',
    sourcesContent: false,
    metafile: true,
    banner: { js: "import { createRequire as __applik8sCreateRequire } from 'node:module'; const require = __applik8sCreateRequire(import.meta.url);" },
    nodePaths: [join(process.cwd(), 'node_modules')],
    plugins: [hatchetSingleFileHeartbeatPlugin(), applik8sWorkspaceSourcePlugin()],
  });
  const source = await readFile(sourcePath, 'utf8');
  const sizeBytes = Buffer.byteLength(source);
  const digest = `sha256:${createHash('sha256').update(source).digest('hex')}`;
  const container = await emitGeneratedApplicationContainer({
    graphName: contract.graphName,
    workloadName: name,
    role: 'workflow-worker',
    artifactDir: workerDir,
    sourcePath,
    sourceMapPath,
    entrypoint: '/app/workflow-worker.mjs',
    baseImage: contract.image,
    sourceDigest: digest,
  });
  const resources = workflowResources(contract, name, container.image, digest, ownsProvider);
  const runtimeEndpoints = [...new Map((contract.queryEffects?.queries ?? []).map(({ gateway, endpointEnvironmentName }) => [
    endpointEnvironmentName,
    { nodeId: gateway.id, environmentName: endpointEnvironmentName },
  ])).values()].sort((left, right) => left.environmentName.localeCompare(right.environmentName));
  const manifest = {
    apiVersion: 'applik8s.workflow/v1alpha1',
    kind: 'GeneratedWorkflowWorker',
    metadata: { name },
    spec: {
      graph: contract.graphName,
      worker: contract.worker.id,
      provider: { interface: 'WorkflowEngine', implementation: 'hatchet', version: stringConfig(contract.providerConfig.serverVersion) },
      tasks: contract.tasks.map(({ task }) => task.id),
      workflows: contract.workflows.map(({ workflow }) => workflow.id),
      runtimeEndpoints,
      runtime: { entrypoint: sourcePath, sourceMap: sourceMapPath, digest, sizeBytes, distribution: 'ociImage', packageManagerAtStartup: false, image: container.image, baseImage: container.baseImage, hatchetHeartbeat: 'inProcessPinnedSdkAdapter' },
      container,
      guarantees: { tasks: 'atLeastOnceRetrySafe', workflows: 'durableHistory', externalEffects: 'tasksOnly', operationalAuthority: 'hatchetPostgres', canonicalAuthority: 'applik8sModelTransactions' },
      deployment: contract.worker.deployment,
    },
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(metafilePath, `${JSON.stringify(result.metafile, null, 2)}\n`);
  const frameworkCredentials = applicationFrameworkCredentialDependencies(source);
  const credentialProjections = [{
    target: 'kubernetes' as const,
    namespace: contract.namespace,
    name: contract.workerTokenSecret,
    keys: [contract.tokenKey],
  }];
  const kubernetesPermissions = contract.gatewayCallers.length > 0
    ? [{
        apiGroup: 'authentication.k8s.io',
        resource: 'tokenreviews',
        scope: 'Cluster' as const,
        verbs: ['create'],
      }, {
        apiGroup: 'coordination.k8s.io',
        resource: 'leases',
        scope: 'Namespaced' as const,
        verbs: ['create', 'get', 'list', 'update', 'patch'],
      }]
    : [];
  return {
    name,
    workerId: contract.worker.id,
    sourcePath,
    sourceMapPath,
    manifestPath,
    metafilePath,
    digest,
    sizeBytes,
    container,
    resources,
    runtimeEndpoints,
    frameworkCredentials,
    credentialProjections,
    kubernetesPermissions,
  };
}
