import { mkdir } from 'node:fs/promises';
import type { ApplicationGraph, ApplicationWorkflowWorkerNode } from '@applik8s/core';
import { workflowContract } from './contracts.js';
import { emitWorkflowWorker } from './emitter.js';
import type { GeneratedApplicationWorkflowArtifact } from './types.js';

export type { GeneratedApplicationWorkflowArtifact, GeneratedApplicationWorkflowResource } from './types.js';

export async function emitGeneratedApplicationWorkflows(options: {
  readonly graph: ApplicationGraph;
  readonly outDir: string;
  readonly entrypoint: string;
}): Promise<readonly GeneratedApplicationWorkflowArtifact[]> {
  const workers = options.graph.nodes.filter((node): node is ApplicationWorkflowWorkerNode => node.kind === 'workflowWorker');
  if (workers.length === 0) return [];
  await mkdir(options.outDir, { recursive: true });
  const artifacts: GeneratedApplicationWorkflowArtifact[] = [];
  const provisionedProviders = new Set<string>();
  for (const worker of workers) {
    const contract = workflowContract(options.graph, worker);
    const ownsProvider = !provisionedProviders.has(contract.provider.id);
    provisionedProviders.add(contract.provider.id);
    artifacts.push(await emitWorkflowWorker(contract, options.outDir, ownsProvider));
  }
  return artifacts;
}
