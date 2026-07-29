// typecast-file-boundary: callable operation generics are intentionally erased only after their canonical runtime contracts and authoring schemas are validated.

import type {
  ApplicationAIAgentHandler,
  ApplicationAIModelDefinition,
} from '@applik8s/ai';
import type {
  ApplicationTanStackAgentRuntime,
  ApplicationTanStackAIAgentRequest,ApplicationTanStackToolOperation 
} from '@applik8s/ai-tanstack';
import { applicationTanStackAICompatibility } from '@applik8s/ai-tanstack';
import {
  type ApplicationOperationLike,
  getApplicationOperationContract,
  getApplicationOperationSchemas,
} from '@applik8s/client';
import {
  type ApplicationAIAgentNode,
  type ApplicationGraphNode,
  type ApplicationOperationId,
  applicationOperationId,
} from '@applik8s/core';
import type { ApplicationServiceIdentityBinding } from './application-authority.js';
import { serializeApplicationCallback } from './application-callback.js';
import {
  type ApplicationGraphState,
  addApplicationGraphEdge,
  addApplicationGraphNode,
  addApplicationProviderRequirement,
} from './application-graph-state.js';
import { applicationProviderGraphNodeId, kubernetesNameSegment } from './application-identifiers.js';

export interface ApplicationAgentDeploymentOptions {
  readonly replicas?: number;
  readonly port?: number;
  readonly healthPort?: number;
  readonly gracefulShutdownSeconds?: number;
  readonly maximumConcurrency?: number;
}

export interface ApplicationAgentOptions {
  readonly identity: ApplicationServiceIdentityBinding;
  readonly model: ApplicationAIModelDefinition;
  readonly instructions: string | ((context: Readonly<Record<string, unknown>>) => string);
  readonly tools: readonly ApplicationOperationLike[];
  readonly responseSchemaDigest?: string;
  readonly budgets?: {
    readonly maximumInputTokens?: number;
    readonly maximumOutputTokens?: number;
    readonly maximumCostMicrounits?: number;
    readonly timeoutMs?: number;
  };
  readonly executionPolicy?: {
    readonly callerDelegation?: 'forbidden' | 'declared';
    readonly uncertainCompletion?: 'escalate' | 'retry-if-replay-safe';
  };
  readonly deployment?: ApplicationAgentDeploymentOptions;
}

export interface ApplicationAgentBinding<
  TName extends string = string,
  TRequest extends ApplicationTanStackAIAgentRequest = ApplicationTanStackAIAgentRequest,
  TResult = unknown,
> {
  readonly kind: 'applicationAgent';
  readonly name: TName;
  readonly model: ApplicationAIModelDefinition;
  readonly identity: ApplicationServiceIdentityBinding;
  /** Type-only association with the colocated execution closure. */
  readonly handler?: ApplicationAIAgentHandler<
    TRequest,
    TResult,
    ApplicationTanStackAgentRuntime
  >;
}

export type ApplicationAgentHandler<
  TRequest extends ApplicationTanStackAIAgentRequest = ApplicationTanStackAIAgentRequest,
  TResult = unknown,
> = ApplicationAIAgentHandler<TRequest, TResult, ApplicationTanStackAgentRuntime>;

export function registerApplicationAgent<
  const TName extends string,
  TRequest extends ApplicationTanStackAIAgentRequest,
  TResult,
>(
  state: ApplicationGraphState,
  name: TName,
  options: ApplicationAgentOptions,
  handler: ApplicationAgentHandler<TRequest, TResult>,
): ApplicationAgentBinding<TName, TRequest, TResult> {
  const normalizedName = stableAgentName(name);
  if (options.identity.kind !== 'applicationServiceIdentity') {
    throw new Error(`Application agent ${normalizedName} requires an application.serviceIdentity(...) binding.`);
  }
  if (options.model.apiVersion !== 'applik8s.aiModel/v1alpha1') {
    throw new Error(`Application agent ${normalizedName} requires an AI.model(...) logical model.`);
  }
  if (options.tools.length === 0) {
    throw new Error(`Application agent ${normalizedName} requires at least one application operation tool.`);
  }
  if (typeof handler !== 'function') {
    throw new Error(`Application agent ${normalizedName} requires a serializable execution closure.`);
  }

  const serializedHandler = serializeApplicationCallback({
    registrar: 'agent',
    argumentIndex: 2,
    property: 'handler',
    label: `Application agent ${normalizedName} handler`,
    callback: handler as (...args: never[]) => unknown,
    allowDeferredResolution: true,
  });
  const instructions = typeof options.instructions === 'string'
    ? staticInstructions(normalizedName, options.instructions)
    : closureInstructions(normalizedName, options.instructions);
  const tools = options.tools.map((operation, index) =>
    applicationAgentTool(state.graphNodes, normalizedName, operation, index));
  const duplicateTool = duplicate(tools.map((tool) => tool.operationId));
  if (duplicateTool) {
    throw new Error(`Application agent ${normalizedName} declares operation ${duplicateTool} more than once.`);
  }

  const qualification = options.model.inference?.qualification;
  const providerNodeId = applicationProviderGraphNodeId(
    'AI',
    qualification
      ? {
          name: qualification.name,
          compatibilityRevision: qualification.compatibilityRevision,
        }
      : undefined,
  );
  const stateProviderNodeId = applicationProviderGraphNodeId(
    'TransactionalDatabase',
  );
  const nodeId = `aiAgent.${kubernetesNameSegment(normalizedName)}`;
  const deployment = options.deployment ?? {};
  const node: ApplicationAIAgentNode = {
    id: nodeId,
    kind: 'aiAgent',
    name: normalizedName,
    stability: 'stable',
    serviceIdentity: options.identity.identity,
    model: {
      apiVersion: options.model.apiVersion,
      name: options.model.name,
      capabilities: options.model.capabilities.map((capability) => capability.name),
      constraints: options.model.constraints,
      ...(qualification ? { inference: { qualification } } : {}),
    },
    inference: { interface: 'AI', nodeId: providerNodeId },
    state: {
      interface: 'TransactionalDatabase',
      nodeId: stateProviderNodeId,
    },
    instructions,
    tools,
    ...(options.responseSchemaDigest
      ? { responseSchemaDigest: nonEmpty(options.responseSchemaDigest, 'response schema digest') }
      : {}),
    budgets: {
      ...(options.budgets?.maximumInputTokens !== undefined
        ? { maximumInputTokens: positiveInteger(options.budgets.maximumInputTokens, 'maximumInputTokens') }
        : {}),
      ...(options.budgets?.maximumOutputTokens !== undefined
        ? { maximumOutputTokens: positiveInteger(options.budgets.maximumOutputTokens, 'maximumOutputTokens') }
        : {}),
      ...(options.budgets?.maximumCostMicrounits !== undefined
        ? { maximumCostMicrounits: positiveInteger(options.budgets.maximumCostMicrounits, 'maximumCostMicrounits') }
        : {}),
      timeoutMs: positiveInteger(options.budgets?.timeoutMs ?? 120_000, 'timeoutMs'),
    },
    executionPolicy: {
      callerDelegation: options.executionPolicy?.callerDelegation ?? 'forbidden',
      uncertainCompletion: options.executionPolicy?.uncertainCompletion ?? 'escalate',
    },
    compatibility: {
      apiVersion: 'applik8s.aiCompatibility/v1alpha1',
      ...applicationTanStackAICompatibility,
    },
    handlerSource: serializedHandler.source,
    ...(serializedHandler.dependencies
      ? { handlerDependencies: serializedHandler.dependencies }
      : {}),
    ...(serializedHandler.location ? { sourceLocation: serializedHandler.location } : {}),
    runtime: 'node',
    lifecycle: 'longLived',
    deployment: {
      replicas: positiveInteger(deployment.replicas ?? 1, 'replicas'),
      port: port(deployment.port ?? 3000, 'port'),
      healthPort: port(deployment.healthPort ?? 8081, 'healthPort'),
      gracefulShutdownSeconds: positiveInteger(
        deployment.gracefulShutdownSeconds ?? 30,
        'gracefulShutdownSeconds',
      ),
      maximumConcurrency: positiveInteger(
        deployment.maximumConcurrency ?? 16,
        'maximumConcurrency',
      ),
    },
  };
  addApplicationGraphNode(state, node);
  addApplicationGraphEdge(state, {
    from: { nodeId: providerNodeId },
    to: { nodeId },
    relationship: 'provides',
  });
  addApplicationGraphEdge(state, {
    from: { nodeId: stateProviderNodeId },
    to: { nodeId },
    relationship: 'provides',
  });
  for (const tool of tools) {
    if (!tool.graphNode) continue;
    addApplicationGraphEdge(state, {
      from: { nodeId },
      to: tool.graphNode,
      relationship: tool.transport === 'query' ? 'reads' : 'writes',
    });
  }
  addApplicationProviderRequirement(state, {
    id: `requirement.${nodeId}.ai`,
    interface: 'AI',
    consumer: { nodeId },
    provider: { interface: 'AI', nodeId: providerNodeId },
    required: true,
    purpose: 'agentInference',
    diagnostics: {
      missing: `Application agent ${normalizedName} requires one compatible AI provider.`,
      ambiguous: `Application agent ${normalizedName} resolves more than one compatible AI provider.`,
    },
  });
  addApplicationProviderRequirement(state, {
    id: `requirement.${nodeId}.state`,
    interface: 'TransactionalDatabase',
    consumer: { nodeId },
    provider: {
      interface: 'TransactionalDatabase',
      nodeId: stateProviderNodeId,
    },
    required: true,
    purpose: 'agentDurability',
    diagnostics: {
      missing: `Application agent ${normalizedName} requires one durable TransactionalDatabase provider.`,
      ambiguous: `Application agent ${normalizedName} resolves more than one durable TransactionalDatabase provider.`,
    },
  });

  return Object.freeze({
    kind: 'applicationAgent',
    name,
    model: options.model,
    identity: options.identity,
    handler,
  });
}

function applicationAgentTool(
  nodes: readonly ApplicationGraphNode[],
  agentName: string,
  operation: ApplicationOperationLike,
  index: number,
): ApplicationAIAgentNode['tools'][number] {
  const contract = getApplicationOperationContract(operation);
  if (!contract) {
    throw new Error(
      `Application agent ${agentName} tool ${index} must be an application operation handle.`,
    );
  }
  if (!getApplicationOperationSchemas(
    operation as ApplicationTanStackToolOperation<unknown, unknown>,
  )) {
    throw new Error(
      `Application agent ${agentName} tool ${contract.id} has no authored input/output schemas and cannot be adapted safely.`,
    );
  }
  const operationId = canonicalOperationId(contract);
  const graphNode = operationGraphNode(nodes, contract.model, contract.id, contract.name);
  return {
    operationId,
    operationVersion: contract.version ?? 'v1',
    transport: contract.transport,
    ...(graphNode ? { graphNode: { nodeId: graphNode.id } } : {}),
    authority: {
      classification: contract.authority?.classification ?? 'unclassified',
      grantable: contract.authority?.grantable ?? false,
      delegable: contract.authority?.delegable ?? false,
      scope: contract.authority?.scope ?? {
        kind: 'none',
        reason: `Operation ${operationId} has no declared authority.`,
      },
    },
  };
}

function canonicalOperationId(
  contract: NonNullable<ReturnType<typeof getApplicationOperationContract>>,
): ApplicationOperationId {
  if (contract.id.startsWith('applik8s://')) return contract.id as ApplicationOperationId;
  return applicationOperationId({
    domain: contract.transport === 'query' ? 'queries' : 'models',
    owner: contract.model,
    operation: contract.name,
  });
}

function operationGraphNode(
  nodes: readonly ApplicationGraphNode[],
  model: string,
  publicId: string,
  operationName: string,
): ApplicationGraphNode | undefined {
  return nodes.find((node) =>
    (node.kind === 'query' && (node.publicId === publicId || node.name === publicId))
    || (node.kind === 'model' && node.name === model
      && (node.common?.operations ?? []).some((operation) =>
        operation.publicId === publicId || operation.name === operationName)));
}

function staticInstructions(agentName: string, value: string): ApplicationAIAgentNode['instructions'] {
  return {
    kind: 'static',
    value: nonEmpty(value, `Application agent ${agentName} instructions`),
  };
}

function closureInstructions(
  agentName: string,
  value: (context: Readonly<Record<string, unknown>>) => string,
): ApplicationAIAgentNode['instructions'] {
  const serialized = serializeApplicationCallback({
    registrar: 'agent',
    argumentIndex: 1,
    property: 'instructions',
    label: `Application agent ${agentName} instructions`,
    callback: value as (...args: never[]) => unknown,
    allowDeferredResolution: true,
  });
  return {
    kind: 'closure',
    source: serialized.source,
    ...(serialized.dependencies ? { dependencies: serialized.dependencies } : {}),
    ...(serialized.location ? { location: serialized.location } : {}),
    ...(serialized.unresolved ? { unresolved: serialized.unresolved } : {}),
  };
}

function stableAgentName(value: string): string {
  const normalized = value.trim();
  if (!normalized || !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(normalized)) {
    throw new Error(
      `Application agent name ${JSON.stringify(value)} must be a stable lower-case identifier.`,
    );
  }
  return normalized;
}

function nonEmpty(value: string, label: string): string {
  if (!value.trim()) throw new Error(`${label} must not be empty.`);
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Application agent ${label} must be a positive integer.`);
  }
  return value;
}

function port(value: number, label: string): number {
  const validated = positiveInteger(value, label);
  if (validated > 65_535) {
    throw new Error(`Application agent ${label} must be at most 65535.`);
  }
  return validated;
}

function duplicate(values: readonly string[]): string | undefined {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return undefined;
}
