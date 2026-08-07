// typecast-file-boundary: the compiler validates graph node discriminators and schema descriptors before lowering them to canonical operation and authority artifacts.
import { createHash } from 'node:crypto';
import type {
  ApplicationGraph,
  ApplicationCrdNode,
  ApplicationMessageContractSchema,
  ApplicationModelNode,
  ApplicationOperationAuthorityDescriptor,
  ApplicationOperationAuthorityGraphContract,
  ApplicationOperationCatalog,
  ApplicationOperationDescriptor,
  ApplicationOperationKind,
  ApplicationOperationTransportBinding,
  ApplicationSchemaDescriptor,
  ApplicationStaticGrantDefinition,
  ApplicationStaticAuthorityManifest,
  ApplicationStaticPermissionDefinition,
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
      const restrictedTransport = dependency.authority.restrictions.transport;
      if (
        restrictedTransport?.kind === 'transport'
        && restrictedTransport.transport !== 'workflow'
      ) {
        throw new Error(
          `Task handler ${handler.id} operation dependency ${dependency.alias} restricts execution to ` +
            `${restrictedTransport.transport}, but function-native task operations execute with workflow authority.`,
        );
      }
      // The durable workflow is the authorized caller even though the task
      // runtime publishes its command envelope through JetStream internally.
      // A model operation may also have an external event transport, so
      // inheriting the operation-wide transport set here would accidentally
      // deny the task's actual workflow execution.
      const transports = ['workflow'] as const;
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
          // Agent declarations are materialized before later
          // `ServiceIdentity.can(tool)` calls finish the static authority
          // manifest. In that ordinary ordering the tool still carries its
          // unclassified deny-all placeholder even though the compiled
          // operation catalog has the reviewed static scope. The workload
          // envelope must use that final catalog scope; retaining the
          // placeholder would make a valid static grant unusable at runtime.
          target:
            tool.authority.classification === 'unclassified'
              ? staticAgentToolScope(
                  graph,
                  agent.serviceIdentity.id,
                  operation,
                )
              : tool.authority.scope,
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

function staticAgentToolScope(
  graph: ApplicationGraph,
  serviceIdentityId: string,
  operation: ApplicationOperationDescriptor,
): ApplicationOperationDescriptor['authority']['defaultScope'] {
  const authority = graph.nodes.find(
    (node) => node.kind === 'authorityManifest',
  );
  const scopes = authority?.kind === 'authorityManifest'
    ? authority.manifest.grants
      .filter(
        (grant) =>
          grant.identity.id === serviceIdentityId
          && grant.operationIds.includes(operation.id),
      )
      .map((grant) => grant.scope)
    : [];
  if (scopes.length === 1) return scopes[0]!;
  if (scopes.length > 1) return { kind: 'or', expressions: scopes };
  return operation.authority.defaultScope;
}

export function compileApplicationOperationCatalog(
  graph: ApplicationGraph,
  options: CompileApplicationOperationCatalogOptions = {},
): ApplicationOperationCatalog {
  const baseOperations = [
    ...graph.nodes.filter(
      (node): node is ApplicationModelNode | ApplicationCrdNode =>
        node.kind === 'model' || node.kind === 'crd',
    )
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
    ...signalOperations(graph),
    ...agentLocalOperations(graph),
    ...graph.nodes.filter((node) => node.kind === 'subscription').map((subscription) => subscriptionOperation(graph, subscription)),
    ...graph.nodes.filter((node) => node.kind === 'server').flatMap((server) =>
      server.routes.map((route) => rawRouteOperation(server.id, server.name, route))),
  ].sort((left, right) => left.id.localeCompare(right.id));
  const compiledOperations = applyMcpTransportBindings(graph, baseOperations);
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

function agentLocalOperations(
  graph: ApplicationGraph,
): readonly ApplicationOperationDescriptor[] {
  const operations = new Map<string, ApplicationOperationDescriptor>();
  for (const agent of graph.nodes.filter((node) => node.kind === 'aiAgent')) {
    for (const tool of agent.tools) {
      if (!tool.local) continue;
      const operation: ApplicationOperationDescriptor = {
        apiVersion: 'applik8s.operation/v1alpha1',
        id: tool.operationId,
        version: tool.operationVersion,
        name: tool.local.name,
        kind: 'model.operation',
        input: schemaDescriptor(tool.local.input),
        output: schemaDescriptor(tool.local.output),
        errors: {},
        authority: operationAuthority(tool.authority, ['execution']),
        transports: [{
          id: `${agent.id}:${tool.operationId}`,
          transport: 'control-plane',
          server: agent.name,
        }],
        placement: { nodeId: agent.id, runtime: 'agent-worker' },
        effects: ['transactional-model-write'],
        emittedEvents: tool.local.functionNativeTransaction.outbox.map(
          (event) => event.nodeId,
        ),
        ...(tool.local.sourceLocation
          ? { sourceLocation: tool.local.sourceLocation }
          : {}),
      };
      const previous = operations.get(operation.id);
      if (
        previous
        && digestJson({
          input: previous.input,
          output: previous.output,
          authority: previous.authority,
        }) !== digestJson({
          input: operation.input,
          output: operation.output,
          authority: operation.authority,
        })
      ) {
        throw new Error(
          `Ordinary function tool ${operation.id} is exposed with incompatible schemas or authority by ${previous.placement.nodeId} and ${agent.id}.`,
        );
      }
      operations.set(operation.id, previous ?? operation);
    }
  }
  return [...operations.values()];
}

function signalOperations(
  graph: ApplicationGraph,
): readonly ApplicationOperationDescriptor[] {
  const contracts = new Map<
    string,
    {
      readonly id: string;
      readonly name: string;
      readonly version: string;
      readonly input: ApplicationMessageContractSchema;
      readonly actions: readonly {
        readonly name: string;
        readonly schema: ApplicationMessageContractSchema;
      }[];
      readonly nodeId: string;
      readonly sourceLocation?: ApplicationOperationDescriptor['sourceLocation'];
    }
  >();
  for (const handler of graph.nodes.filter(
    (node) => node.kind === 'workflowHandler' || node.kind === 'taskHandler',
  )) {
    for (const binding of handler.signalBindings ?? []) {
      const previous = contracts.get(binding.id);
      const candidate = {
        id: binding.id,
        name: binding.name,
        version: binding.version,
        input: binding.input,
        actions: binding.actions,
        nodeId: handler.id,
        ...(handler.sourceLocation ? { sourceLocation: handler.sourceLocation } : {}),
      };
      if (previous && digestJson({
        name: previous.name,
        version: previous.version,
        input: previous.input,
        actions: previous.actions,
      }) !== digestJson({
        name: candidate.name,
        version: candidate.version,
        input: candidate.input,
        actions: candidate.actions,
      })) {
        throw new Error(
          `Application signal ${binding.id} is captured with incompatible contracts by ${previous.nodeId} and ${handler.id}.`,
        );
      }
      contracts.set(binding.id, previous ?? candidate);
    }
  }
  return [...contracts.values()].flatMap((signal) => {
    const reference = signalReferenceSchema(signal.id);
    const issue: ApplicationOperationDescriptor = {
      apiVersion: 'applik8s.operation/v1alpha1',
      id: applicationOperationId({
        domain: 'signals',
        owner: signal.id,
        operation: 'issue',
      }),
      version: signal.version,
      name: 'issue',
      kind: 'signal.issue',
      input: schemaDescriptor(signal.input),
      output: schemaDescriptor(reference),
      errors: {},
      authority: {
        classification: 'application-policy',
        grantable: false,
        delegable: false,
        checks: ['execution', 'pre-commit'],
        defaultScope: { kind: 'all' },
        transports: ['workflow'],
      },
      transports: [{
        id: `${signal.id}.issue`,
        transport: 'workflow',
      }],
      placement: { nodeId: signal.nodeId, runtime: 'workflow-worker' },
      ...(signal.sourceLocation ? { sourceLocation: signal.sourceLocation } : {}),
    };
    const exactInstanceAuthority: ApplicationOperationAuthorityDescriptor = {
      classification: 'runtime-grantable',
      grantable: true,
      delegable: false,
      checks: ['admission', 'execution', 'result-read'],
      defaultScope: { kind: 'all' },
      transports: ['direct', 'http', 'event'],
    };
    const issuanceRead: ApplicationOperationDescriptor = {
      apiVersion: 'applik8s.operation/v1alpha1',
      id: applicationOperationId({
        domain: 'signals',
        owner: signal.id,
        operation: 'issuance.read',
      }),
      version: signal.version,
      name: 'issuance.read',
      kind: 'signal.issuance.read',
      input: schemaDescriptor(signalIdentitySchema()),
      output: schemaDescriptor(signalIssuanceSchema(signal.input)),
      errors: {},
      authority: exactInstanceAuthority,
      transports: [
        {
          id: `${signal.id}.issuance.read.direct`,
          transport: 'direct',
          server: 'application-signal-gateway',
        },
        {
          id: `${signal.id}.issuance.read.http`,
          transport: 'http',
          server: 'application-signal-gateway',
        },
        {
          id: `${signal.id}.issuance.read.event`,
          transport: 'event',
          server: 'application-signal-gateway',
        },
      ],
      placement: { nodeId: signal.nodeId, runtime: 'server' },
      ...(signal.sourceLocation ? { sourceLocation: signal.sourceLocation } : {}),
    };
    const actions = signal.actions.map(
      (action): ApplicationOperationDescriptor => ({
        apiVersion: 'applik8s.operation/v1alpha1',
        id: applicationOperationId({
          domain: 'signals',
          owner: signal.id,
          operation: action.name,
        }),
        version: signal.version,
        name: action.name,
        kind: 'signal.action',
        input: schemaDescriptor(action.schema),
        output: schemaDescriptor(signalActionResultSchema()),
        errors: {},
        authority: exactInstanceAuthority,
        transports: [
          {
            id: `${signal.id}.${action.name}.direct`,
            transport: 'direct',
            server: 'application-signal-gateway',
          },
          {
            id: `${signal.id}.${action.name}.http`,
            transport: 'http',
            server: 'application-signal-gateway',
          },
          {
            id: `${signal.id}.${action.name}.event`,
            transport: 'event',
            server: 'application-signal-gateway',
          },
        ],
        placement: { nodeId: signal.nodeId, runtime: 'server' },
        ...(signal.sourceLocation
          ? { sourceLocation: signal.sourceLocation }
          : {}),
      }),
    );
    return [issue, issuanceRead, ...actions];
  });
}

function signalIdentitySchema(): ApplicationMessageContractSchema {
  return {
    kind: 'declared',
    runtime: 'arktype',
    jsonSchema: {
      type: 'object',
      properties: { signalId: { type: 'string', minLength: 1 } },
      required: ['signalId'],
      additionalProperties: false,
    },
  };
}

function signalReferenceSchema(id: string): ApplicationMessageContractSchema {
  return {
    kind: 'declared',
    runtime: 'arktype',
    jsonSchema: {
      type: 'object',
      properties: {
        signalId: { type: 'string', minLength: 1 },
        contractId: { const: id },
        expiresAt: { type: 'string', format: 'date-time' },
        receiptId: { type: 'string', minLength: 1 },
      },
      required: ['signalId', 'contractId', 'expiresAt', 'receiptId'],
      additionalProperties: false,
    },
  };
}

function signalIssuanceSchema(
  input: ApplicationMessageContractSchema,
): ApplicationMessageContractSchema {
  return {
    kind: 'declared',
    runtime: 'arktype',
    jsonSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', minLength: 1 },
        input: input.jsonSchema,
        signal: { type: 'object', additionalProperties: true },
        issuedAt: { type: 'string', format: 'date-time' },
        expiresAt: { type: 'string', format: 'date-time' },
      },
      required: ['id', 'input', 'signal', 'issuedAt', 'expiresAt'],
      additionalProperties: false,
    },
  };
}

function signalActionResultSchema(): ApplicationMessageContractSchema {
  return {
    kind: 'declared',
    runtime: 'arktype',
    jsonSchema: {
      type: 'object',
      properties: {
        status: { enum: ['resolved', 'alreadyResolved'] },
      },
      required: ['status'],
      additionalProperties: true,
    },
  };
}

function applyMcpTransportBindings(
  graph: ApplicationGraph,
  operations: readonly ApplicationOperationDescriptor[],
): readonly ApplicationOperationDescriptor[] {
  const byId = new Map(operations.map((operation) => [operation.id, operation]));
  for (const server of graph.nodes.filter((node) => node.kind === 'mcpServer')) {
    for (const tool of server.tools) {
      const operation = byId.get(tool.operationId);
      if (!operation) {
        throw new Error(
          `Application MCP server ${server.name} exposes unknown operation ${tool.operationId}.`,
        );
      }
      if (
        operation.authority.transports
        && !operation.authority.transports.includes('mcp')
      ) {
        throw new Error(
          `Application MCP server ${server.name} cannot expose ${operation.id} because its authority excludes MCP transport.`,
        );
      }
      const existing = operation.transports.find(
        (transport) =>
          transport.transport === 'mcp'
          && transport.mcp?.server === server.name
          && transport.mcp.tool === tool.publicName,
      );
      if (existing) continue;
      const transportBinding: ApplicationOperationTransportBinding = {
        id: `mcp.${server.name}.${tool.publicName}`,
        transport: 'mcp',
        server: server.name,
        mcp: {
          server: server.name,
          tool: tool.publicName,
          schemaRevision: `${operation.input.digest}:${operation.output.digest}`,
        },
      };
      byId.set(operation.id, {
        ...operation,
        transports: [
          ...operation.transports,
          transportBinding,
        ].sort((left, right) => left.id.localeCompare(right.id)),
      });
    }
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
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
  const generated = generatedSignalGrantAuthority(graph);
  if (generated.permissions.length === 0) return manifest;
  const applicationIdentity = {
    id: `identity:${graph.metadata.name}:application`,
    kind: 'service' as const,
    issuer: `applik8s://${graph.metadata.name}`,
    subject: 'application-authority',
  };
  const base: ApplicationStaticAuthorityManifest = manifest ?? {
    apiVersion: 'applik8s.authorityManifest/v1alpha1',
    application: graph.metadata.name,
    revision: 'sha256:empty',
    identities: [applicationIdentity],
    permissions: [],
    roles: [],
    grants: [],
    outcomes: [],
  };
  const combined = {
    ...base,
    identities: mergeAuthorityRecords(
      base.identities,
      [applicationIdentity, ...generated.identities],
      'identity',
    ),
    permissions: mergeAuthorityRecords(
      base.permissions,
      generated.permissions,
      'permission',
    ),
    grants: mergeAuthorityRecords(base.grants, generated.grants, 'grant'),
  };
  return {
    ...combined,
    revision: digestJson({
      application: combined.application,
      identities: combined.identities,
      permissions: combined.permissions,
      roles: combined.roles,
      grants: combined.grants,
      outcomes: combined.outcomes,
    }),
  };
}

/**
 * Compiler-owned permission identity for the exact-instance grants created by
 * one workflow worker. Application code only declares `grantAccessTo`; the
 * compiler proves the captured signal contract and supplies this narrow
 * delegation authority.
 */
export function applicationSignalGrantPermissionId(
  application: string,
  workerId: string,
  signalId: string,
): string {
  return `permission:${application}:internal:signal-grant:${digestJson({
    workerId,
    signalId,
  }).slice('sha256:'.length, 'sha256:'.length + 24)}`;
}

function generatedSignalGrantAuthority(graph: ApplicationGraph): {
  readonly identities: readonly ApplicationStaticAuthorityManifest['identities'][number][];
  readonly permissions: readonly ApplicationStaticPermissionDefinition[];
  readonly grants: readonly ApplicationStaticGrantDefinition[];
} {
  const handlers = new Map(
    graph.nodes
      .filter(
        (node) => node.kind === 'workflowHandler' || node.kind === 'taskHandler',
      )
      .map((handler) => [handler.id, handler]),
  );
  const identities: ApplicationStaticAuthorityManifest['identities'][number][] = [];
  const permissions: ApplicationStaticPermissionDefinition[] = [];
  const grants: ApplicationStaticGrantDefinition[] = [];
  const applicationIdentity = {
    id: `identity:${graph.metadata.name}:application`,
    kind: 'service' as const,
    issuer: `applik8s://${graph.metadata.name}`,
    subject: 'application-authority',
  };
  for (const worker of graph.nodes.filter((node) => node.kind === 'workflowWorker')) {
    const signals = new Map<
      string,
      NonNullable<
        Extract<
          ApplicationGraph['nodes'][number],
          { readonly kind: 'workflowHandler' }
        >['signalBindings']
      >[number]
    >();
    for (const reference of worker.handlers) {
      const handler = handlers.get(reference.nodeId);
      for (const signal of handler?.signalBindings ?? []) {
        signals.set(signal.id, signal);
      }
    }
    if (signals.size === 0) continue;
    const workloadIdentity = {
      id: `identity:${graph.metadata.name}:workload:${worker.id}`,
      kind: 'workload' as const,
      issuer: `applik8s://${graph.metadata.name}`,
      subject: worker.id,
    };
    identities.push(workloadIdentity);
    for (const signal of [...signals.values()].sort((left, right) =>
      left.id.localeCompare(right.id))) {
      const permissionId = applicationSignalGrantPermissionId(
        graph.metadata.name,
        worker.id,
        signal.id,
      );
      const operationIds = [
        applicationOperationId({
          domain: 'signals',
          owner: signal.id,
          operation: 'issuance.read',
        }),
        ...signal.actions.map((action) =>
          applicationOperationId({
            domain: 'signals',
            owner: signal.id,
            operation: action.name,
          })),
      ].sort();
      permissions.push({
        id: permissionId,
        name: `internal-signal-grant-${signal.id}`,
        operationIds,
        scope: { kind: 'all' },
        transports: ['direct', 'event', 'http'],
        grantable: true,
        lifecycleOwner: worker.id,
      });
      grants.push({
        id: `grant:${graph.metadata.name}:internal:signal-grant:${digestJson({
          workerId: worker.id,
          signalId: signal.id,
        }).slice('sha256:'.length, 'sha256:'.length + 24)}`,
        identity: workloadIdentity,
        permissionId,
        operationIds,
        scope: { kind: 'all' },
        transports: ['direct', 'event', 'http'],
        issuedBy: applicationIdentity,
        canGrant: true,
        lifecycleOwner: worker.id,
        reason:
          'Compiler-derived authority to issue exact-instance grants for a statically captured signal contract.',
      });
    }
  }
  return {
    identities: mergeAuthorityRecords([], identities, 'identity'),
    permissions: mergeAuthorityRecords([], permissions, 'permission'),
    grants: mergeAuthorityRecords([], grants, 'grant'),
  };
}

function mergeAuthorityRecords<TValue extends { readonly id: string }>(
  existing: readonly TValue[],
  added: readonly TValue[],
  kind: string,
): readonly TValue[] {
  const values = new Map(existing.map((record) => [record.id, record]));
  for (const record of added) {
    const previous = values.get(record.id);
    if (previous && canonicalJson(previous) !== canonicalJson(record)) {
      throw new Error(
        `Application compiler-owned ${kind} ${record.id} conflicts with an authored authority record.`,
      );
    }
    values.set(record.id, previous ?? record);
  }
  return [...values.values()].sort((left, right) => left.id.localeCompare(right.id));
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
    const permissions = manifest.permissions.filter((permission) =>
      permission.operationIds.includes(operation.id));
    if (
      operation.authority.classification === 'runtime-grantable'
      && permissions.every((permission) => permission.grantable)
    ) {
      // A grantable permission is the reviewed template from which exact,
      // narrower runtime grants are derived. It does not replace the
      // operation's runtime-grantable classification.
      return operation;
    }
    if (
      operation.authority.classification !== 'unclassified'
      && operation.authority.classification !== 'assigned'
      && !isLatentOperationAuthority(operation)
    ) {
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

function isLatentOperationAuthority(
  operation: ApplicationOperationDescriptor,
): boolean {
  return operation.authority.classification === 'application-policy'
    && operation.authority.defaultScope.kind === 'none'
    && operation.transports.length === 1
    && operation.transports[0]?.transport === 'control-plane';
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
  model: ApplicationModelNode | ApplicationCrdNode,
): readonly ApplicationOperationDescriptor[] {
  return (model.common?.operations ?? []).map((operation) => {
    const operationId = applicationOperationId({
      domain: 'models',
      owner: model.name,
      operation: operation.name,
    });
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
    const reachability = modelOperationReachability(
      graph,
      operationId,
      command?.id,
    );
    const transport: ApplicationOperationTransportBinding = {
      id: operation.publicId,
      transport: operation.transport === 'query' ? 'http' : 'event',
      server: operation.transport === 'query' ? 'application-query-gateway' : 'application-command-gateway',
    };
    return {
      apiVersion: 'applik8s.operation/v1alpha1',
      id: operationId,
      version: command?.kind === 'command' ? command.contract.version : 'v1',
      name: operation.name,
      kind,
      input: schemaDescriptor(input),
      output: schemaDescriptor(output),
      errors,
      target: {
        model: model.name,
        identity: {
          digest: digestJson(
            model.common?.identity
              ?? { fields: model.kind === 'model' ? model.schema.identity : ['metadata.name'] },
          ),
          schema: {
            type: 'object',
            properties: Object.fromEntries(
              (
                model.common?.identity?.fields
                  ?? (model.kind === 'model' ? model.schema.identity : ['metadata.name'])
              ).map((field) => [field, {}]),
            ),
            required: [
              ...(
                model.common?.identity?.fields
                  ?? (model.kind === 'model' ? model.schema.identity : ['metadata.name'])
              ),
            ],
            additionalProperties: false,
          },
        },
      },
      authority: reachability === 'external'
        ? operationAuthority(
            operation.authority,
            operation.transport === 'command'
              ? ['admission', 'enqueue', 'execution', 'pre-commit', 'result-read']
              : ['admission'],
          )
        : reachability === 'workflow'
          ? workflowModelOperationAuthority()
          : latentOperationAuthority(),
      transports: reachability === 'external'
        ? [transport]
        : reachability === 'workflow'
          ? [{
              id: operation.publicId,
              transport: 'workflow',
              server: 'application-command-processor',
            }]
          : [{
              id: operation.publicId,
              transport: 'control-plane',
              server: 'application-command-processor',
            }],
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

function modelOperationReachability(
  graph: ApplicationGraph,
  operationId: string,
  commandNodeId: string | undefined,
): 'external' | 'workflow' | 'latent' {
  let workflow = false;
  for (const node of graph.nodes) {
      if (
        node.kind === 'gateway'
        && commandNodeId
        && node.commands.some((binding) => binding.command.nodeId === commandNodeId)
      ) {
        return 'external';
      }
      if (
        node.kind === 'mcpServer'
        && node.tools.some((tool) => tool.operationId === operationId)
      ) {
        return 'external';
      }
      if (
        node.kind === 'aiAgent'
        && node.tools.some((tool) => tool.operationId === operationId)
      ) {
        return 'external';
      }
      if (
        node.kind === 'server'
        && node.routes.some((route) =>
          route.functionNative?.operationBindings?.some(
            (binding) => binding.operationId === operationId,
          ))
      ) {
        return 'external';
      }
      if (
        node.kind === 'taskHandler'
        && (node.operations ?? []).some(
          (dependency) => dependency.authority.operationId === operationId,
        )
      ) {
        workflow = true;
      }
  }
  return workflow ? 'workflow' : 'latent';
}

function workflowModelOperationAuthority(): ApplicationOperationAuthorityDescriptor {
  return {
    classification: 'application-policy',
    grantable: false,
    delegable: false,
    checks: ['execution', 'pre-commit', 'result-read'],
    defaultScope: { kind: 'all' },
    transports: ['workflow'],
  };
}

function latentOperationAuthority(): ApplicationOperationAuthorityDescriptor {
  return {
    classification: 'application-policy',
    grantable: false,
    delegable: false,
    checks: ['execution'],
    defaultScope: {
      kind: 'none',
      reason: 'operation has no compiled transport',
    },
    transports: ['control-plane'],
  };
}

function queryOperation(
  graph: ApplicationGraph,
  query: Extract<ApplicationGraph['nodes'][number], { readonly kind: 'query' }>,
): ApplicationOperationDescriptor {
  const model = query.modelOperation
    ? graph.nodes.find(
        (node) =>
          node.id === query.modelOperation?.model.nodeId
          && (node.kind === 'model' || node.kind === 'crd'),
      )
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
    ...(model && (model.kind === 'model' || model.kind === 'crd') ? {
      target: {
        model: model.name,
        identity: {
          digest: digestJson(
            model.common?.identity
              ?? { fields: model.kind === 'model' ? model.schema.identity : ['metadata.name'] },
          ),
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
  const authority: ApplicationOperationAuthorityDescriptor = {
    // A workflow transport is not a public admission surface. The engine
    // credential and compiler-issued workload envelope are the application
    // policy: callers can reach this operation only through a generated
    // gateway whose service account, contract set, audience, and scope are
    // fixed by the compiled graph. Adding HTTP/MCP/event exposure remains a
    // separate transport binding and still requires its own classification.
    classification: 'application-policy',
    grantable: false,
    delegable: false,
    checks: ['execution', 'protected-step', 'result-read'],
    defaultScope: { kind: 'all' },
    transports: ['workflow'],
  };
  return {
    apiVersion: 'applik8s.operation/v1alpha1',
    id: applicationOperationId({ domain, owner, operation: name }),
    version: contract.version,
    name,
    kind,
    input: schemaDescriptor(contract.input),
    output: schemaDescriptor(contract.output),
    errors: Object.fromEntries(contract.errors.map((error) => [error.name, schemaDescriptor(error.schema)])),
    authority,
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
    authority: operationAuthority(subscription.authority, ['admission', 'subscription-resume']),
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
    readonly functionNative?: {
      readonly input: ApplicationMessageContractSchema;
      readonly output: ApplicationMessageContractSchema;
    };
    readonly sourceLocation?: ApplicationOperationDescriptor['sourceLocation'];
  },
): ApplicationOperationDescriptor {
  return {
    apiVersion: 'applik8s.operation/v1alpha1',
    id: applicationOperationId({ domain: 'http', owner: serverName, operation: route.id }),
    version: 'v1',
    name: route.id,
    kind: route.functionNative ? 'http.route' : 'http.raw',
    input: route.functionNative
      ? schemaDescriptor(route.functionNative.input)
      : emptySchemaDescriptor(),
    output: route.functionNative
      ? schemaDescriptor(route.functionNative.output)
      : emptySchemaDescriptor(),
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
