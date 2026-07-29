// typecast-file-boundary: the compiler validates graph node discriminators and schema descriptors before lowering them to canonical operation and authority artifacts.
import { createHash } from 'node:crypto';
import type {
  ApplicationGraph,
  ApplicationMessageContractSchema,
  ApplicationModelNode,
  ApplicationOperationAuthorityDescriptor,
  ApplicationOperationAuthorityGraphContract,
  ApplicationOperationCatalog,
  ApplicationOperationDescriptor,
  ApplicationOperationKind,
  ApplicationOperationTransportBinding,
  ApplicationSchemaDescriptor,
  ApplicationStaticAuthorityManifest,
  ApplicationWorkloadAuthorityEnvelope,
  JsonObject,
} from '@applik8s/core';
import { applicationOperationId, validateApplicationOperationCatalog } from '@applik8s/core';

export interface CompileApplicationOperationCatalogOptions {
  readonly revision?: string;
  readonly predecessor?: string;
  readonly requireClassified?: boolean;
}

export function compileApplicationWorkloadAuthority(
  graph: ApplicationGraph,
  catalog: ApplicationOperationCatalog,
): readonly ApplicationWorkloadAuthorityEnvelope[] {
  if (catalog.application !== graph.metadata.name) {
    throw new Error(`Operation catalog ${catalog.application} does not belong to ${graph.metadata.name}.`);
  }
  const operations = new Map(catalog.operations.map((operation) => [operation.id, operation]));
  const taskEnvelopes = graph.nodes
    .filter((node) => node.kind === 'taskHandler')
    .flatMap((handler) => (handler.operations ?? []).map((dependency) => {
      const operation = operations.get(dependency.authority.operationId);
      if (!operation) {
        throw new Error(
          `Task handler ${handler.id} workload authority references unavailable operation ${dependency.authority.operationId}.`,
        );
      }
      const workloadIdentity = {
        id: `identity:${graph.metadata.name}:workload:${handler.id}`,
        kind: 'workload' as const,
        issuer: `applik8s://${graph.metadata.name}`,
        subject: handler.id,
      };
      const serviceIdentity = handler.serviceIdentity;
      const transports = dependency.authority.restrictions.transport?.kind === 'transport'
        ? [dependency.authority.restrictions.transport.transport]
        : operation.authority.transports
          ?? [...new Set(operation.transports.map((transport) => transport.transport))];
      return {
        apiVersion: 'applik8s.workloadAuthority/v1alpha1' as const,
        id: `workload-authority:${digestJson({
          application: graph.metadata.name,
          handler: handler.id,
          alias: dependency.alias,
          authority: dependency.authority,
          catalogRevision: catalog.revision,
        }).slice('sha256:'.length)}`,
        workloadIdentity,
        ...(serviceIdentity ? { serviceIdentity } : {}),
        operationId: operation.id,
        catalogRevision: catalog.revision,
        restrictions: dependency.authority.restrictions,
        ...(dependency.authority.binding ? { binding: dependency.authority.binding } : {}),
        inputSchemaDigest: operation.input.digest,
        audiences: operation.authority.audiences ?? [workloadIdentity.id],
        transports,
        delegation: 'forbidden' as const,
        impersonation: 'forbidden' as const,
      };
    }));
  const agentEnvelopes = graph.nodes
    .filter((node) => node.kind === 'aiAgent')
    .flatMap((agent) => agent.tools.map((tool) => {
      const operation = operations.get(tool.operationId);
      if (!operation) {
        throw new Error(
          `AI agent ${agent.id} workload authority references unavailable operation ${tool.operationId}.`,
        );
      }
      const workloadIdentity = {
        id: `identity:${graph.metadata.name}:workload:${agent.id}`,
        kind: 'workload' as const,
        issuer: `applik8s://${graph.metadata.name}`,
        subject: agent.id,
      };
      const transports = operation.authority.transports
        ?? [...new Set(operation.transports.map((transport) => transport.transport))];
      return {
        apiVersion: 'applik8s.workloadAuthority/v1alpha1' as const,
        id: `workload-authority:${digestJson({
          application: graph.metadata.name,
          agent: agent.id,
          operationId: tool.operationId,
          authority: tool.authority,
          catalogRevision: catalog.revision,
        }).slice('sha256:'.length)}`,
        workloadIdentity,
        serviceIdentity: agent.serviceIdentity,
        operationId: operation.id,
        catalogRevision: catalog.revision,
        restrictions: {
          target: tool.authority.scope,
          predicates: [],
        },
        inputSchemaDigest: operation.input.digest,
        audiences: operation.authority.audiences ?? [workloadIdentity.id],
        transports,
        delegation: 'forbidden' as const,
        impersonation: 'forbidden' as const,
      };
    }));
  return [...taskEnvelopes, ...agentEnvelopes]
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function compileApplicationOperationCatalog(
  graph: ApplicationGraph,
  options: CompileApplicationOperationCatalogOptions = {},
): ApplicationOperationCatalog {
  const compiledOperations = [
    ...graph.nodes.filter((node): node is ApplicationModelNode => node.kind === 'model')
      .flatMap((model) => modelOperations(graph, model)),
    ...graph.nodes.filter((node) => node.kind === 'query').map((query) => queryOperation(graph, query)),
    ...graph.nodes.filter((node) => node.kind === 'task').map((task) => durableOperation('tasks', task.name, 'run', 'task', task.contract, task.id)),
    ...graph.nodes.filter((node) => node.kind === 'workflow').flatMap((workflow) => [
      durableOperation('workflows', workflow.name, 'start', 'workflow.start', workflow.contract, workflow.id),
      durableOperation('workflows', workflow.name, 'cancel', 'workflow.cancel', workflow.contract, workflow.id),
      durableOperation('workflows', workflow.name, 'result', 'workflow.result', workflow.contract, workflow.id),
      ...workflow.contract.signals.map((signal) => ({
        ...durableOperation('workflows', workflow.name, `signal-${signal.name}`, 'workflow.signal', {
          ...workflow.contract,
          input: signal.schema,
        }, workflow.id),
        name: signal.name,
      })),
    ]),
    ...graph.nodes.filter((node) => node.kind === 'subscription').map((subscription) => subscriptionOperation(graph, subscription)),
    ...graph.nodes.filter((node) => node.kind === 'server').flatMap((server) =>
      server.routes.map((route) => rawRouteOperation(server.id, server.name, route))),
  ].sort((left, right) => left.id.localeCompare(right.id));
  const authorityManifest = applicationStaticAuthorityManifest(graph);
  const operations = applyStaticAuthorityManifest(compiledOperations, authorityManifest);
  const revision = options.revision ?? digestJson(operations);
  const digest = digestJson({
    application: graph.metadata.name,
    revision,
    operations,
    predecessor: options.predecessor,
  });
  const catalog: ApplicationOperationCatalog = {
    apiVersion: 'applik8s.operationCatalog/v1alpha1',
    application: graph.metadata.name,
    revision,
    digest,
    state: 'proposed',
    operations,
    ...(options.predecessor ? { predecessor: options.predecessor } : {}),
  };
  if (options.requireClassified) {
    const diagnostics = validateApplicationOperationCatalog(catalog, { requireClassified: true });
    if (diagnostics.length > 0) {
      throw new Error(`Application ${graph.metadata.name} operation catalog is not production-ready:\n${diagnostics.map((diagnostic) => `- ${diagnostic.path ?? 'catalog'}: ${diagnostic.message}`).join('\n')}`);
    }
  }
  return catalog;
}

export function applicationStaticAuthorityManifest(
  graph: ApplicationGraph,
): ApplicationStaticAuthorityManifest | undefined {
  const nodes = graph.nodes.filter((node) => node.kind === 'authorityManifest');
  if (nodes.length > 1) {
    throw new Error(`Application ${graph.metadata.name} declares multiple static authority manifests.`);
  }
  const manifest = nodes[0]?.manifest;
  if (manifest && manifest.application !== graph.metadata.name) {
    throw new Error(
      `Application authority manifest ${manifest.application} does not belong to ${graph.metadata.name}.`,
    );
  }
  return manifest;
}

function applyStaticAuthorityManifest(
  operations: readonly ApplicationOperationDescriptor[],
  manifest: ApplicationStaticAuthorityManifest | undefined,
): readonly ApplicationOperationDescriptor[] {
  if (!manifest) return operations;
  const assigned = new Set(manifest.permissions.flatMap((permission) => permission.operationIds));
  const known = new Set(operations.map((operation) => operation.id));
  const unknown = [...assigned].filter((operationId) => !known.has(operationId));
  if (unknown.length > 0) {
    throw new Error(
      `Application authority manifest ${manifest.revision} references unknown operations: ${unknown.sort().join(', ')}.`,
    );
  }
  return operations.map((operation) => {
    if (!assigned.has(operation.id)) return operation;
    if (operation.authority.classification !== 'unclassified'
      && operation.authority.classification !== 'assigned') {
      throw new Error(
        `Application operation ${operation.id} is ${operation.authority.classification} and cannot also be assigned by static authority manifest ${manifest.revision}.`,
      );
    }
    return {
      ...operation,
      authority: {
        ...operation.authority,
        classification: 'assigned',
        defaultScope: staticOperationScope(manifest, operation.id),
      },
    };
  });
}

function staticOperationScope(
  manifest: ApplicationStaticAuthorityManifest,
  operationId: ApplicationOperationDescriptor['id'],
): ApplicationOperationDescriptor['authority']['defaultScope'] {
  const scopes = manifest.permissions
    .filter((permission) => permission.operationIds.includes(operationId))
    .map((permission) => permission.scope);
  return scopes.length === 1
    ? scopes[0]!
    : { kind: 'or', expressions: scopes };
}

function modelOperations(
  graph: ApplicationGraph,
  model: ApplicationModelNode,
): readonly ApplicationOperationDescriptor[] {
  return (model.common?.operations ?? []).map((operation) => {
    const command = graph.nodes.find((node) => node.kind === 'command' && node.name === operation.publicId);
    const handler = command
      ? graph.nodes.find((node) => node.kind === 'commandHandler' && node.command.nodeId === command.id && node.model.nodeId === model.id)
      : undefined;
    const kind = modelOperationKind(operation.operation);
    const input = operation.input ?? (command?.kind === 'command' ? command.contract.input : emptySchema());
    const output = operation.output ?? (command?.kind === 'command' ? command.contract.output : emptySchema());
    const errors = command?.kind === 'command'
      ? Object.fromEntries(command.contract.errors.map((error) => [error.name, schemaDescriptor(error.schema)]))
      : {};
    const transport: ApplicationOperationTransportBinding = {
      id: operation.publicId,
      transport: operation.transport === 'query' ? 'http' : 'event',
      server: operation.transport === 'query' ? 'application-query-gateway' : 'application-command-gateway',
    };
    return {
      apiVersion: 'applik8s.operation/v1alpha1',
      id: applicationOperationId({ domain: 'models', owner: model.name, operation: operation.name }),
      version: command?.kind === 'command' ? command.contract.version : 'v1',
      name: operation.name,
      kind,
      input: schemaDescriptor(input),
      output: schemaDescriptor(output),
      errors,
      target: {
        model: model.name,
        identity: {
          digest: digestJson(model.common?.identity ?? { fields: model.schema?.identity ?? ['id'] }),
          schema: {
            type: 'object',
            properties: Object.fromEntries((model.common?.identity?.fields ?? model.schema?.identity ?? ['id']).map((field) => [field, {}])),
            required: [...(model.common?.identity?.fields ?? model.schema?.identity ?? ['id'])],
            additionalProperties: false,
          },
        },
      },
      authority: operationAuthority(
        operation.authority,
        operation.transport === 'command'
          ? ['admission', 'enqueue', 'execution', 'pre-commit', 'result-read']
          : ['admission'],
      ),
      transports: [transport],
      placement: {
        nodeId: handler?.id ?? model.id,
        runtime: operation.transport === 'query' ? 'server' : 'command-processor',
      },
      ...(handler?.kind === 'commandHandler'
        ? { emittedEvents: handler.transaction.outbox.map((reference) => reference.nodeId) }
        : {}),
      ...(model.sourceLocation ? { sourceLocation: model.sourceLocation } : {}),
    };
  });
}

function queryOperation(
  graph: ApplicationGraph,
  query: Extract<ApplicationGraph['nodes'][number], { readonly kind: 'query' }>,
): ApplicationOperationDescriptor {
  const model = query.modelOperation
    ? graph.nodes.find((node) => node.id === query.modelOperation?.model.nodeId && node.kind === 'model')
    : undefined;
  const owner = model?.name ?? query.name;
  const name = query.modelOperation?.name ?? 'read';
  return {
    apiVersion: 'applik8s.operation/v1alpha1',
    id: applicationOperationId({ domain: 'queries', owner, operation: name }),
    version: query.version,
    name,
    kind: 'query',
    input: schemaDescriptor(query.input),
    output: schemaDescriptor(query.output),
    errors: {},
    ...(model?.kind === 'model' ? {
      target: {
        model: model.name,
        identity: {
          digest: digestJson(model.common?.identity ?? { fields: model.schema.identity }),
          schema: { type: 'object', additionalProperties: true },
        },
      },
    } : {}),
    authority: operationAuthority(query.authority, ['admission']),
    transports: [{
      id: query.publicId ?? query.name,
      transport: 'http',
      server: 'application-query-gateway',
    }],
    placement: { nodeId: query.id, runtime: 'server' },
    ...(query.sourceLocation ? { sourceLocation: query.sourceLocation } : {}),
  };
}

function durableOperation(
  domain: 'tasks' | 'workflows',
  owner: string,
  name: string,
  kind: Extract<ApplicationOperationKind, 'task' | `workflow.${string}`>,
  contract: {
    readonly version: string;
    readonly input: ApplicationMessageContractSchema;
    readonly output: ApplicationMessageContractSchema;
    readonly errors: readonly { readonly name: string; readonly schema: ApplicationMessageContractSchema }[];
  },
  nodeId: string,
): ApplicationOperationDescriptor {
  return {
    apiVersion: 'applik8s.operation/v1alpha1',
    id: applicationOperationId({ domain, owner, operation: name }),
    version: contract.version,
    name,
    kind,
    input: schemaDescriptor(contract.input),
    output: schemaDescriptor(contract.output),
    errors: Object.fromEntries(contract.errors.map((error) => [error.name, schemaDescriptor(error.schema)])),
    authority: operationAuthority(undefined, ['execution', 'protected-step', 'result-read']),
    transports: [{ id: nodeId, transport: 'workflow' }],
    placement: { nodeId, runtime: 'workflow-worker' },
  };
}

function subscriptionOperation(
  graph: ApplicationGraph,
  subscription: Extract<ApplicationGraph['nodes'][number], { readonly kind: 'subscription' }>,
): ApplicationOperationDescriptor {
  const source = graph.nodes.find((node) => node.id === subscription.source.nodeId);
  const name = source?.name ?? subscription.name;
  return {
    apiVersion: 'applik8s.operation/v1alpha1',
    id: applicationOperationId({ domain: 'queries', owner: name, operation: 'subscribe' }),
    version: 'v1',
    name: 'subscribe',
    kind: 'subscription',
    input: emptySchemaDescriptor(),
    output: emptySchemaDescriptor(),
    errors: {},
    authority: operationAuthority(undefined, ['admission', 'subscription-resume']),
    transports: [{ id: subscription.id, transport: subscription.delivery === 'sse' ? 'http' : 'event' }],
    placement: { nodeId: subscription.id, runtime: 'server' },
    ...(subscription.sourceLocation ? { sourceLocation: subscription.sourceLocation } : {}),
  };
}

function rawRouteOperation(
  serverId: string,
  serverName: string,
  route: {
    readonly id: string;
    readonly method: string;
    readonly path: string;
    readonly authority?: ApplicationOperationAuthorityGraphContract;
    readonly sourceLocation?: ApplicationOperationDescriptor['sourceLocation'];
  },
): ApplicationOperationDescriptor {
  return {
    apiVersion: 'applik8s.operation/v1alpha1',
    id: applicationOperationId({ domain: 'http', owner: serverName, operation: route.id }),
    version: 'v1',
    name: route.id,
    kind: 'http.raw',
    input: emptySchemaDescriptor(),
    output: emptySchemaDescriptor(),
    errors: {},
    authority: operationAuthority(route.authority, ['admission']),
    transports: [{
      id: route.id,
      transport: 'http',
      server: serverName,
      route: {
        name: route.id,
        method: httpMethod(route.method),
        path: route.path,
      },
    }],
    placement: { nodeId: serverId, runtime: 'server' },
    ...(route.sourceLocation ? { sourceLocation: route.sourceLocation } : {}),
  };
}

function operationAuthority(
  authority?: ApplicationOperationAuthorityGraphContract,
  checks: ApplicationOperationAuthorityDescriptor['checks'] = ['execution'],
): ApplicationOperationAuthorityDescriptor {
  return authority
    ? {
      classification: authority.classification,
      grantable: authority.grantable,
      delegable: authority.delegable,
      checks,
      defaultScope: authority.scope,
      ...(authority.audiences ? { audiences: authority.audiences } : {}),
      ...(authority.transports ? { transports: authority.transports } : {}),
    }
    : {
      classification: 'unclassified',
      grantable: false,
      delegable: false,
      checks,
      defaultScope: { kind: 'none', reason: 'operation has not been classified' },
    };
}

function modelOperationKind(
  operation: 'create' | 'get' | 'query' | 'update' | 'delete' | 'custom',
): ApplicationOperationKind {
  switch (operation) {
    case 'create': return 'model.create';
    case 'get': return 'model.read';
    case 'query': return 'model.query';
    case 'update': return 'model.update';
    case 'delete': return 'model.delete';
    case 'custom': return 'model.operation';
  }
}

function schemaDescriptor(schema: ApplicationMessageContractSchema): ApplicationSchemaDescriptor {
  return { digest: digestJson(schema.jsonSchema), schema: schema.jsonSchema };
}

function emptySchema(): ApplicationMessageContractSchema {
  return { kind: 'declared', runtime: 'arktype', jsonSchema: { type: 'object', additionalProperties: false } };
}

function emptySchemaDescriptor(): ApplicationSchemaDescriptor {
  return schemaDescriptor(emptySchema());
}

function httpMethod(method: string): 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' {
  const normalized = method.toUpperCase();
  if (normalized === 'GET' || normalized === 'HEAD' || normalized === 'POST' || normalized === 'PUT' || normalized === 'PATCH' || normalized === 'DELETE' || normalized === 'OPTIONS') {
    return normalized;
  }
  throw new Error(`Application raw route method ${method} is unsupported by the operation catalog.`);
}

function digestJson(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value as JsonObject)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(',')}}`;
}
