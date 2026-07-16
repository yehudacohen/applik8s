import type { ApplicationGraph, ApplicationMessageContractSchema } from '@applik8s/core';

export interface ApplicationFacadeOperationManifest {
  readonly id: string;
  readonly name: string;
  readonly operation: 'create' | 'get' | 'query' | 'update' | 'delete' | 'custom';
  readonly transport: 'command' | 'query' | 'runtime';
  readonly input?: ApplicationMessageContractSchema;
  readonly output?: ApplicationMessageContractSchema;
}

export interface ApplicationFacadeModelManifest {
  readonly name: string;
  readonly operations: readonly ApplicationFacadeOperationManifest[];
}

export interface ApplicationFacadeManifest {
  readonly apiVersion: 'applik8s.facade/v1alpha1';
  readonly application: string;
  readonly models: readonly ApplicationFacadeModelManifest[];
}

/** Produces the environment-neutral public operation manifest consumed by Vite and framework adapters. */
export function applicationFacadeManifest(graph: ApplicationGraph): ApplicationFacadeManifest {
  const models = new Map<string, Map<string, ApplicationFacadeOperationManifest>>();
  const nodeNames = new Map<string, string>();
  for (const node of graph.nodes) {
    if (node.kind !== 'model' && node.kind !== 'crd') continue;
    nodeNames.set(node.id, node.name);
    const operations = models.get(node.name) ?? new Map<string, ApplicationFacadeOperationManifest>();
    for (const operation of node.common?.operations ?? []) {
      if (operation.authorization === 'undeclared') continue;
      operations.set(operation.name, {
        id: operation.publicId,
        name: operation.name,
        operation: operation.operation,
        transport: operation.transport,
        ...(operation.input ? { input: operation.input } : {}),
        ...(operation.output ? { output: operation.output } : {}),
      });
    }
    models.set(node.name, operations);
  }
  for (const node of graph.nodes) {
    if (node.kind !== 'query' || !node.modelOperation) continue;
    const modelName = nodeNames.get(node.modelOperation.model.nodeId);
    if (!modelName) throw new Error(`Application facade query ${node.id} references missing model ${node.modelOperation.model.nodeId}.`);
    const operations = models.get(modelName) ?? new Map<string, ApplicationFacadeOperationManifest>();
    const id = node.publicId ?? `${node.name}.${node.version}`;
    operations.set(node.modelOperation.name, {
      id,
      name: node.modelOperation.name,
      operation: 'query',
      transport: 'query',
      input: node.input,
      output: node.output,
    });
    models.set(modelName, operations);
  }
  return {
    apiVersion: 'applik8s.facade/v1alpha1',
    application: graph.metadata.name,
    models: [...models.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, operations]) => ({
        name,
        operations: [...operations.values()].sort((left, right) => left.name.localeCompare(right.name)),
      })),
  };
}

export function generatedApplicationFacadeSource(manifest: ApplicationFacadeManifest, target: 'browser' | 'server'): string {
  const hasQueries = manifest.models.some((model) => model.operations.some((operation) => operation.transport === 'query'));
  const imports = ['createApplicationMutationOperation', ...(target === 'browser' && hasQueries ? ['createApplicationQueryOperation'] : [])];
  const lines = [
    `import { ${imports.sort().join(', ')} } from '@applik8s/client';`,
    ...(target === 'server' && hasQueries
      ? ["import { createApplik8sServerQueryOperation } from '@applik8s/vite/server';"]
      : []),
  ];
  for (const model of manifest.models) {
    const operations = model.operations.map((operation) => `${JSON.stringify(operation.name)}: ${operationSource(model.name, operation, target)}`);
    lines.push(`export const ${model.name} = Object.freeze({ name: ${JSON.stringify(model.name)}${operations.length > 0 ? `, ${operations.join(', ')}` : ''} });`);
  }
  return `${lines.join('\n')}\n`;
}

function operationSource(model: string, operation: ApplicationFacadeOperationManifest, target: 'browser' | 'server'): string {
  const contract = JSON.stringify({
    apiVersion: 'applik8s.operation/v1alpha1',
    kind: 'applicationOperation',
    id: operation.id,
    model,
    name: operation.name,
    operation: operation.operation,
    transport: operation.transport,
  });
  if (operation.transport === 'query') {
    return target === 'server'
      ? `createApplik8sServerQueryOperation(${contract})`
      : `createApplicationQueryOperation(${contract})`;
  }
  return `createApplicationMutationOperation(${contract})`;
}
