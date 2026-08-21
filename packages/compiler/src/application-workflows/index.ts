import { mkdir } from 'node:fs/promises';
import type { ApplicationGraph, ApplicationOperationCatalog, ApplicationWorkflowWorkerNode, ApplicationWorkloadAuthorityEnvelope, OperatorManifest } from '@applik8s/core';
import {
  applicationStaticAuthorityManifest,
  compileApplicationOperationCatalog,
  compileApplicationWorkloadAuthority,
} from '../application-operations/index.js';
import { workflowContract } from './contracts.js';
import { emitWorkflowWorker } from './emitter.js';
import type { GeneratedApplicationWorkflowArtifact } from './types.js';

export type { GeneratedApplicationWorkflowArtifact, GeneratedApplicationWorkflowResource } from './types.js';

export async function emitGeneratedApplicationWorkflows(options: {
  readonly graph: ApplicationGraph;
  readonly outDir: string;
  readonly entrypoint: string;
  readonly operationCatalog?: ApplicationOperationCatalog;
  readonly workloadAuthority?: readonly ApplicationWorkloadAuthorityEnvelope[];
  readonly operatorManifests?: readonly OperatorManifest[];
  readonly executionTarget?: 'kubernetes' | 'local' | 'aws-local' | 'aws';
}): Promise<readonly GeneratedApplicationWorkflowArtifact[]> {
  const operationCatalog = options.operationCatalog ?? compileApplicationOperationCatalog(options.graph);
  const workloadAuthority = options.workloadAuthority
    ?? compileApplicationWorkloadAuthority(options.graph, operationCatalog);
  const authorityManifest = applicationStaticAuthorityManifest(options.graph);
  const workers = options.graph.nodes.filter((node): node is ApplicationWorkflowWorkerNode => node.kind === 'workflowWorker');
  if (workers.length === 0) return [];
  await mkdir(options.outDir, { recursive: true });
  const artifacts: GeneratedApplicationWorkflowArtifact[] = [];
  const provisionedProviders = new Set<string>();
  for (const worker of workers) {
    const gatewayCallers = (options.operatorManifests ?? []).flatMap((manifest) =>
      Object.values(manifest.spec.capabilities ?? {}).flatMap((descriptor) => {
        const gateway = descriptor.workflowGateway;
        if (!gateway || gateway.worker !== worker.name) return [];
        return [{
          operator: gateway.caller.operator,
          namespace: gateway.caller.namespace,
          serviceAccount: gateway.caller.serviceAccount,
          contracts: gateway.contracts,
        }];
      }),
    );
    const contract = workflowContract(
      options.graph,
      worker,
      operationCatalog,
      workloadAuthority,
      gatewayCallers,
      authorityManifest,
    );
    const ownsProvider = !provisionedProviders.has(contract.provider.id);
    provisionedProviders.add(contract.provider.id);
    artifacts.push(await emitWorkflowWorker(
      contract,
      options.outDir,
      ownsProvider,
      options.executionTarget ?? 'kubernetes',
    ));
  }
  return artifacts;
}
