import type {
  ApplicationGatewayNode,
  ApplicationGraph,
  ApplicationMessageContractSchema,
} from '@applik8s/core';

export interface ApplicationFacadeOperationManifest {
  readonly id: string;
  readonly name: string;
  readonly owner?: string;
  readonly operation: 'create' | 'get' | 'query' | 'update' | 'delete' | 'custom';
  readonly transport: 'command' | 'query' | 'runtime';
  readonly input?: ApplicationMessageContractSchema;
  readonly output?: ApplicationMessageContractSchema;
  readonly exportNames?: readonly string[];
}

export interface ApplicationFacadeModelManifest {
  readonly name: string;
  readonly operations: readonly ApplicationFacadeOperationManifest[];
}

export interface ApplicationFacadeObjectStoreManifest {
  readonly name: string;
  readonly exportName: string;
  readonly operations: readonly ApplicationFacadeOperationManifest[];
}

export interface ApplicationFacadeSignalManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly actions: readonly string[];
  readonly subscription: string;
  readonly exportNames: readonly string[];
}

export interface ApplicationFacadeAgentManifest {
  readonly name: string;
  readonly exportNames: readonly string[];
}

export interface ApplicationFacadeManifest {
  readonly apiVersion: 'applik8s.facade/v1alpha1';
  readonly application: string;
  readonly models: readonly ApplicationFacadeModelManifest[];
  readonly operations: readonly ApplicationFacadeOperationManifest[];
  readonly objectStores: readonly ApplicationFacadeObjectStoreManifest[];
  readonly signals: readonly ApplicationFacadeSignalManifest[];
  readonly agents: readonly ApplicationFacadeAgentManifest[];
}

/** Produces the environment-neutral public operation manifest consumed by Vite and framework adapters. */
export function applicationFacadeManifest(
  graph: ApplicationGraph,
  options: {
    readonly operationExports?: readonly { readonly name: string; readonly operationId: string }[];
    readonly modelExports?: readonly { readonly name: string; readonly modelName: string }[];
    readonly signalExports?: readonly { readonly name: string; readonly signalId: string }[];
    readonly agentExports?: readonly { readonly name: string; readonly agentName: string }[];
  } = {},
): ApplicationFacadeManifest {
  const exportNamesByOperation = new Map<string, string[]>();
  for (const operationExport of options.operationExports ?? []) {
    assertJavaScriptExportName(operationExport.name, `Application operation ${operationExport.operationId}`);
    exportNamesByOperation.set(operationExport.operationId, [
      ...(exportNamesByOperation.get(operationExport.operationId) ?? []),
      operationExport.name,
    ]);
  }
  const exportedModels = new Set(
    (options.modelExports ?? []).map((model) => model.modelName),
  );
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const gateways = graph.nodes.filter(
    (node): node is ApplicationGatewayNode => node.kind === 'gateway',
  );
  const publicGateways = graph.nodes.filter(
    (node): node is ApplicationGatewayNode =>
      node.kind === 'gateway' && node.visibility === 'public',
  );
  const assignedQueryNodeIds = new Set(
    gateways.flatMap((gateway) => gateway.queries.map((query) => query.nodeId)),
  );
  const publicQueryNodeIds = new Set(
    [
      ...publicGateways.flatMap((gateway) =>
        gateway.queries.map((query) => query.nodeId)),
      // Kubernetes-backed model views without an explicit gateway are served
      // by the generated application-host gateway. Relational views remain
      // private unless assigned to a public gateway, and anything assigned to
      // an internal gateway must never fall back into this implicit surface.
      ...graph.nodes
        .filter(
          (node) =>
            node.kind === 'query'
            && node.kubernetes !== undefined
            && !assignedQueryNodeIds.has(node.id),
        )
        .map((node) => node.id),
    ],
  );
  const assignedCommandIds = new Set(
    gateways.flatMap((gateway) =>
      gateway.commands.flatMap((command) => {
        const node = nodes.get(command.command.nodeId);
        return node?.kind === 'command' ? [node.name] : [];
      })),
  );
  const publicCommandIds = new Set(
    [
      ...publicGateways.flatMap((gateway) =>
        gateway.commands.flatMap((command) => {
          const node = nodes.get(command.command.nodeId);
          return node?.kind === 'command' ? [node.name] : [];
        })),
      // CRD create operations have the same implicit application-host route as
      // their Kubernetes views. Other model commands stay private unless an
      // explicit public gateway owns them.
      ...graph.nodes.flatMap((node) =>
        node.kind === 'crd' && node.create
          ? (node.common?.operations ?? [])
            .filter(
              (operation) =>
                operation.operation === 'create'
                && operation.transport === 'command'
                && !assignedCommandIds.has(operation.publicId),
            )
            .map((operation) => operation.publicId)
          : []),
    ],
  );
  const models = new Map<string, Map<string, ApplicationFacadeOperationManifest>>();
  const nodeNames = new Map<string, string>();
  for (const node of graph.nodes) {
    if (node.kind !== 'model' && node.kind !== 'crd') continue;
    nodeNames.set(node.id, node.name);
    const operations = models.get(node.name) ?? new Map<string, ApplicationFacadeOperationManifest>();
    for (const operation of node.common?.operations ?? []) {
      if (operation.authorization === 'undeclared') continue;
      if (
        operation.transport === 'command'
        && !publicCommandIds.has(operation.publicId)
        && !exportedModels.has(node.name)
        && !(node.kind === 'crd' && operation.operation === 'create' && node.create)
      ) {
        continue;
      }
      const exportNames = exportNamesByOperation.get(operation.publicId);
      operations.set(operation.name, {
        id: operation.publicId,
        name: operation.name,
        operation: operation.operation,
        transport: operation.transport,
        ...(operation.input ? { input: operation.input } : {}),
        ...(operation.output ? { output: operation.output } : {}),
        ...(exportNames ? { exportNames } : {}),
      });
    }
    if (operations.size > 0) models.set(node.name, operations);
  }
  for (const node of graph.nodes) {
    if (node.kind !== 'query' || !node.modelOperation) continue;
    if (!publicQueryNodeIds.has(node.id)) continue;
    const modelName = nodeNames.get(node.modelOperation.model.nodeId);
    if (!modelName) throw new Error(`Application facade query ${node.id} references missing model ${node.modelOperation.model.nodeId}.`);
    const operations = models.get(modelName) ?? new Map<string, ApplicationFacadeOperationManifest>();
    const id = node.publicId ?? `${node.name}.${node.version}`;
    const exportNames = exportNamesByOperation.get(id);
    operations.set(node.modelOperation.name, {
      id,
      name: node.modelOperation.name,
      operation: 'query',
      transport: 'query',
      input: node.input,
      output: node.output,
      ...(exportNames ? { exportNames } : {}),
    });
    models.set(modelName, operations);
  }
  const modelManifests = [...models.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, operations]) => ({
      name,
      operations: [...operations.values()].sort((left, right) => left.name.localeCompare(right.name)),
    }));
  const modelNames = new Set(modelManifests.map((model) => model.name));
  const operations = graph.nodes
    .filter((node) => node.kind === 'server')
    .flatMap((server) =>
      server.routes.flatMap((route): ApplicationFacadeOperationManifest[] => {
        if (
          !route.functionNative
          || route.functionNative.publication?.boundary !== 'entrypoint-export'
        ) {
          return [];
        }
        const id = `applik8s://http/${encodeURIComponent(server.name)}/operations/${encodeURIComponent(route.id)}`;
        const exportNames = [...new Set(exportNamesByOperation.get(id) ?? [])];
        if (exportNames.length === 0) {
          throw new Error(
            `Published application HTTP route ${server.name}.${route.id} has no entrypoint export name.`,
          );
        }
        return [{
          id,
          name: route.id,
          owner: server.name,
          operation: 'custom',
          transport: 'runtime',
          input: route.functionNative.input,
          output: route.functionNative.output,
          exportNames,
        }];
      }),
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  const objectStores = graph.nodes
    .filter((node) => node.kind === 'objectStore')
    .map((node): ApplicationFacadeObjectStoreManifest => {
      const exportName = javascriptExportName(node.name);
      if (modelNames.has(exportName)) throw new Error(`Application object store ${node.name} conflicts with model facade export ${exportName}. Rename the logical store.`);
      return {
        name: node.name,
        exportName,
        operations: ['createUpload', 'completeUpload', 'createDownload'].map((name) => ({
          id: `objectStore.${node.name}.${name}`,
          name,
          operation: 'custom',
          transport: 'runtime',
        })),
      };
    })
    .sort((left, right) => left.exportName.localeCompare(right.exportName));
  if (new Set(objectStores.map((store) => store.exportName)).size !== objectStores.length) {
    throw new Error('Application logical object stores must have distinct JavaScript facade export names.');
  }
  const signalExports = new Map<string, string[]>();
  for (const exported of options.signalExports ?? []) {
    assertJavaScriptExportName(exported.name, `Application signal ${exported.signalId}`);
    signalExports.set(exported.signalId, [
      ...(signalExports.get(exported.signalId) ?? []),
      exported.name,
    ]);
  }
  const publicSubscriptionIds = new Set(
    publicGateways
      .flatMap((gateway) => gateway.subscriptions.map((subscription) => subscription.nodeId)),
  );
  const signals = graph.nodes
    .filter((
      node,
    ): node is Extract<
      ApplicationGraph['nodes'][number],
      { readonly kind: 'stream' }
    > & {
      readonly signal: NonNullable<
        Extract<
          ApplicationGraph['nodes'][number],
          { readonly kind: 'stream' }
        >['signal']
      >;
    } => node.kind === 'stream' && node.signal !== undefined)
    .map((stream): ApplicationFacadeSignalManifest | undefined => {
      const subscriptions = graph.nodes.filter(
        (node) =>
          node.kind === 'subscription'
          && node.source.nodeId === stream.id
          && publicSubscriptionIds.has(node.id),
      );
      if (subscriptions.length === 0) return undefined;
      if (subscriptions.length > 1) {
        throw new Error(
          `Application signal ${stream.signal.id} has multiple public subscriptions; the function-native facade requires one unambiguous subscription.`,
        );
      }
      const subscription = subscriptions[0];
      if (!subscription) return undefined;
      const exportNames = [...new Set(signalExports.get(stream.signal.id) ?? [])];
      if (exportNames.length === 0) return undefined;
      return {
        id: stream.signal.id,
        name: stream.signal.name,
        version: stream.signal.version,
        actions: stream.signal.actions.map((action) => action.name).sort(),
        subscription: subscription.name,
        exportNames,
      };
    })
    .filter((signal): signal is ApplicationFacadeSignalManifest => signal !== undefined)
    .sort((left, right) => left.id.localeCompare(right.id));
  const agentExports = new Map<string, string[]>();
  for (const exported of options.agentExports ?? []) {
    assertJavaScriptExportName(exported.name, `Application agent ${exported.agentName}`);
    agentExports.set(exported.agentName, [
      ...(agentExports.get(exported.agentName) ?? []),
      exported.name,
    ]);
  }
  const agents = graph.nodes
    .filter((node): node is Extract<ApplicationGraph['nodes'][number], { readonly kind: 'aiAgent' }> =>
      node.kind === 'aiAgent')
    .flatMap((agent): ApplicationFacadeAgentManifest[] => {
      const exportNames = [...new Set(agentExports.get(agent.name) ?? [])];
      return exportNames.length > 0 ? [{ name: agent.name, exportNames }] : [];
    })
    .sort((left, right) => left.name.localeCompare(right.name));
  return {
    apiVersion: 'applik8s.facade/v1alpha1',
    application: graph.metadata.name,
    models: modelManifests,
    operations,
    objectStores,
    signals,
    agents,
  };
}

export function generatedApplicationFacadeSource(
  manifest: ApplicationFacadeManifest,
  target: 'browser' | 'server',
  options: {
    readonly browserBaseUrl?: string;
    /** Framework adapter that installs hook implementations before handles are created. */
    readonly browserAdapterModule?: string;
  } = {},
): string {
  const hasQueries = manifest.models.some((model) => model.operations.some((operation) => operation.transport === 'query'));
  const imports = ['createApplicationMutationOperation', ...(manifest.objectStores.length + manifest.operations.length > 0 ? ['createApplicationRuntimeOperation'] : []), ...(manifest.signals.length > 0 ? ['createApplicationSignalOperation'] : []), ...(target === 'browser' && hasQueries ? ['createApplicationQueryOperation'] : []), ...(target === 'browser' && options.browserBaseUrl ? ['configureDefaultApplicationBrowserRuntime'] : [])];
  const lines = [
    ...(target === 'browser' && options.browserAdapterModule
      ? [`import ${JSON.stringify(options.browserAdapterModule)};`]
      : []),
    `import { ${imports.sort().join(', ')} } from '@applik8s/client';`,
    ...(target === 'server' && hasQueries
      ? ["import { createApplik8sServerQueryOperation } from '@applik8s/server';"]
      : []),
  ];
  if (target === 'browser' && options.browserBaseUrl) lines.push(`configureDefaultApplicationBrowserRuntime({ baseUrl: ${JSON.stringify(options.browserBaseUrl)} });`);
  const emittedExports = new Set<string>();
  for (const model of manifest.models) {
    assertUniqueFacadeExport(emittedExports, model.name, `model ${model.name}`);
    const operations = model.operations.map((operation) => `${JSON.stringify(operation.name)}: ${operationSource(model.name, operation, target)}`);
    lines.push(`export const ${model.name} = Object.freeze({ name: ${JSON.stringify(model.name)}${operations.length > 0 ? `, ${operations.join(', ')}` : ''} });`);
    for (const operation of model.operations) {
      const operationExports = [...new Set([
        ...(operation.transport === 'query' ? [javascriptExportName(`${model.name}-${operation.name}`)] : []),
        ...(operation.exportNames ?? []),
      ])];
      for (const exportName of operationExports) {
        assertUniqueFacadeExport(emittedExports, exportName, `operation ${operation.id}`);
        lines.push(`export const ${exportName} = ${model.name}[${JSON.stringify(operation.name)}];`);
      }
    }
  }
  for (const operation of manifest.operations) {
    for (const exportName of operation.exportNames ?? []) {
      assertUniqueFacadeExport(
        emittedExports,
        exportName,
        `HTTP operation ${operation.id}`,
      );
      lines.push(
        `export const ${exportName} = ${operationSource(operation.owner ?? 'http', operation, target)};`,
      );
    }
  }
  for (const store of manifest.objectStores) {
    assertUniqueFacadeExport(emittedExports, store.exportName, `object store ${store.name}`);
    const operations = store.operations.map((operation) => `${JSON.stringify(operation.name)}: ${operationSource(store.name, operation, target)}`);
    lines.push(`export const ${store.exportName} = Object.freeze({ name: ${JSON.stringify(store.name)}, ${operations.join(', ')} });`);
  }
  for (const signal of manifest.signals) {
    const variable = javascriptExportName(`signal-${signal.id}`);
    assertUniqueFacadeExport(emittedExports, variable, `signal ${signal.id} internal binding`);
    lines.push(`const ${variable} = createApplicationSignalOperation(${JSON.stringify({
      id: signal.id,
      name: signal.name,
      version: signal.version,
      actions: signal.actions,
      subscription: signal.subscription,
    })});`);
    for (const exportName of signal.exportNames) {
      assertUniqueFacadeExport(emittedExports, exportName, `signal ${signal.id}`);
      lines.push(`export const ${exportName} = ${variable};`);
    }
  }
  for (const agent of manifest.agents) {
    for (const exportName of agent.exportNames) {
      assertUniqueFacadeExport(emittedExports, exportName, `agent ${agent.name}`);
      lines.push(`export const ${exportName} = Object.freeze({ kind: 'applicationAgent', name: ${JSON.stringify(agent.name)} });`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function assertUniqueFacadeExport(exports: Set<string>, name: string, owner: string): void {
  if (exports.has(name)) throw new Error(`Application facade export ${name} is claimed more than once; conflict at ${owner}.`);
  exports.add(name);
}

function assertJavaScriptExportName(name: string, owner: string): void {
  if (!/^[$A-Z_a-z][$\w]*$/.test(name)) {
    throw new Error(`${owner} export ${JSON.stringify(name)} is not a valid JavaScript identifier.`);
  }
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
  if (operation.transport === 'runtime') return `createApplicationRuntimeOperation(${contract})`;
  return `createApplicationMutationOperation(${contract})`;
}

function javascriptExportName(value: string): string {
  const name = value.split(/[^A-Za-z0-9_$]+/).filter(Boolean).map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join('');
  if (!/^[$A-Z_a-z][$\w]*$/.test(name)) throw new Error(`Application logical object store ${JSON.stringify(value)} cannot be represented as a JavaScript facade export.`);
  return name;
}
