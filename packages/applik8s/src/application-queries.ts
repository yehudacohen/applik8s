import type { ApplicationMessageContractSchema, JsonObject } from '@applik8s/core';
import type { Type } from 'arktype';
import type { ApplicationGraphState } from './application-graph-state.js';
import { addApplicationGraphEdge, addApplicationGraphNode } from './application-graph-state.js';
import type { ApplicationDatabaseBinding } from './application.js';
import type { ApplicationModelRelationshipContract, CommonApplicationModelFacet } from './native-models.js';
import { getApplicationModelFacet } from './native-models.js';
import type { ApplicationRelationalContext } from './relational-runtime.js';
import type { ApplicationTrustedContext } from './trusted-context.js';
import { serializeApplicationCallback } from './application-callback.js';

export interface ApplicationQueryPrincipal {
  readonly id: string;
  readonly claims?: Readonly<Record<string, unknown>>;
  can?(action: string, model: unknown, identity?: unknown): boolean | Promise<boolean>;
}

export type ApplicationQueryReadDependency = object | ApplicationModelRelationshipContract;

export interface ApplicationQueryOptions<TInput, TOutput, TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal> {
  readonly input: Type<TInput>;
  readonly output: Type<TOutput>;
  readonly database?: ApplicationDatabaseBinding;
  readonly context?: readonly ApplicationTrustedContext<unknown>[];
  readonly reads: readonly ApplicationQueryReadDependency[];
  readonly authorize: (request: { readonly principal: TPrincipal; readonly input: TInput }) => boolean | Promise<boolean>;
  readonly run: (request: { readonly context: ApplicationRelationalContext; readonly principal: TPrincipal; readonly input: TInput }) => TOutput | Promise<TOutput>;
  readonly budgets?: {
    readonly timeoutMs?: number;
    readonly maxResultBytes?: number;
    readonly maxRows?: number;
  };
}

export interface ApplicationQueryBinding<TInput = unknown, TOutput = unknown, TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal> {
  readonly kind: 'applicationQuery';
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly input: Type<TInput>;
  readonly output: Type<TOutput>;
  readonly database?: ApplicationDatabaseBinding;
  readonly trustedContext: readonly ApplicationTrustedContext<unknown>[];
  readonly reads: readonly ApplicationQueryReadDependency[];
  readonly budgets: {
    readonly timeoutMs: number;
    readonly maxResultBytes: number;
    readonly maxRows: number;
  };
  authorize(principal: TPrincipal, input: TInput): Promise<boolean>;
  run(context: ApplicationRelationalContext, principal: TPrincipal, input: TInput): Promise<TOutput>;
}

export function registerApplicationQuery<TInput, TOutput, TPrincipal extends ApplicationQueryPrincipal>(state: ApplicationGraphState, id: string, options: ApplicationQueryOptions<TInput, TOutput, TPrincipal>): ApplicationQueryBinding<TInput, TOutput, TPrincipal> {
  const parsed = parseVersionedQueryId(id);
  const nodeId = `query.${id}`;
  if (state.graphNodes.some((node) => node.id === nodeId)) throw new Error(`Application query ${id} is already registered.`);
  if (options.reads.length === 0) throw new Error(`Application query ${id} must declare at least one model or relationship read dependency.`);
  const reads = options.reads.map((dependency) => queryReadContract(state, dependency, id));
  const budgets = {
    timeoutMs: options.budgets?.timeoutMs ?? 5_000,
    maxResultBytes: options.budgets?.maxResultBytes ?? 1_048_576,
    maxRows: options.budgets?.maxRows ?? 1_000,
  };
  if (budgets.timeoutMs < 1 || budgets.maxResultBytes < 1 || budgets.maxRows < 1) throw new Error(`Application query ${id} budgets must be positive and bounded.`);
  // typecast: callback serialization erases only generic parameter names; runtime schemas remain authoritative for their values.
  const authorization = serializeApplicationCallback({ registrar: 'query', argumentIndex: 1, property: 'authorize', label: `Application query ${id} authorization`, callback: options.authorize as (...args: never[]) => unknown, allowDeferredResolution: true });
  // typecast: callback serialization preserves executable source while the query binding validates input and output at runtime.
  const handler = serializeApplicationCallback({ registrar: 'query', argumentIndex: 1, property: 'run', label: `Application query ${id} handler`, callback: options.run as (...args: never[]) => unknown, allowDeferredResolution: true });
  addApplicationGraphNode(state, {
    id: nodeId,
    kind: 'query',
    name: parsed.name,
    version: parsed.version,
    stability: 'stable',
    input: querySchema(options.input),
    output: querySchema(options.output),
    reads,
    authorization: 'application-defined',
    trustedContext: (options.context ?? []).map((context) => context.name).sort(),
    budgets,
    snapshotResume: options.database ? 'resumableInvalidation' : 'resetOnly',
    incremental: 'invalidation-requery',
    cursor: 'opaque-query-version-context-scoped',
    ...(options.database ? { database: reactiveDatabaseRuntime(options.database) } : {}),
    authorizationSource: authorization.source,
    ...(authorization.dependencies ? { authorizationDependencies: authorization.dependencies } : {}),
    ...(authorization.location ? { authorizationLocation: authorization.location } : {}),
    ...(authorization.unresolved ? { authorizationUnresolved: authorization.unresolved } : {}),
    handlerSource: handler.source,
    ...(handler.dependencies ? { handlerDependencies: handler.dependencies } : {}),
    ...(handler.location ? { handlerLocation: handler.location } : {}),
    ...(handler.unresolved ? { handlerUnresolved: handler.unresolved } : {}),
  });
  for (const read of reads) addApplicationGraphEdge(state, { from: { nodeId }, to: read.model, relationship: 'reads' });
  return {
    kind: 'applicationQuery',
    id,
    name: parsed.name,
    version: parsed.version,
    input: options.input,
    output: options.output,
    ...(options.database ? { database: options.database } : {}),
    trustedContext: options.context ?? [],
    reads: options.reads,
    budgets,
    async authorize(principal, input) {
      return options.authorize({ principal, input });
    },
    async run(context, principal, input) {
      return options.run({ context, principal, input });
    },
  };
}

function reactiveDatabaseRuntime(binding: ApplicationDatabaseBinding): {
  readonly name: string;
  readonly connectionEnvName: string;
  readonly secretName: string;
  readonly secretKey: string;
  readonly secretNamespace?: string;
  readonly access?: { readonly context: string; readonly contextSchema: JsonObject; readonly setting: string; readonly column: string };
} {
  const provider = binding.provider;
  const clusterName = provider.name ?? `${reactiveName(binding.name)}-db`;
  const secret = provider.connectionSecret ?? { apiVersion: 'v1', kind: 'Secret', name: `${clusterName}-app`, ...(provider.namespace ? { namespace: provider.namespace } : {}) };
  return {
    name: binding.name,
    connectionEnvName: `APPLIK8S_DATABASE_${reactiveName(binding.name).replace(/[^A-Z0-9_a-z]+/g, '_').toUpperCase()}_URL`,
    secretName: secret.name ?? `${clusterName}-app`,
    secretKey: provider.connectionSecretKey ?? 'uri',
    ...(secret.namespace ?? provider.namespace ? { secretNamespace: secret.namespace ?? provider.namespace } : {}),
    ...(binding.access ? { access: { context: binding.access.context.name, contextSchema: binding.access.context.contract.jsonSchema, setting: binding.access.setting, column: binding.access.column } } : {}),
  };
}

function reactiveName(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
}

function queryReadContract(state: ApplicationGraphState, dependency: ApplicationQueryReadDependency, query: string): { readonly model: { readonly nodeId: string }; readonly relationship?: string } {
  if (isRelationship(dependency)) {
    const node = state.graphNodes.find((candidate) => (candidate.kind === 'model' || candidate.kind === 'crd') && candidate.name === dependency.source);
    if (!node) throw new Error(`Application query ${query} reads relationship ${dependency.source}.${dependency.name}, but source model ${dependency.source} is not registered in this app.`);
    return { model: { nodeId: node.id }, relationship: dependency.name };
  }
  const model = getApplicationModelFacet<object, unknown, unknown, unknown>(dependency);
  if (!model) throw new Error(`Application query ${query} reads an object that is not a promoted application model or relationship.`);
  const node = state.graphNodes.find((candidate) => (candidate.kind === 'model' || candidate.kind === 'crd') && candidate.name === model.name);
  if (!node) throw new Error(`Application query ${query} reads model ${model.name}, but that model is not registered in this app.`);
  return { model: { nodeId: node.id } };
}

function isRelationship(value: object): value is ApplicationModelRelationshipContract {
  return typeof Reflect.get(value, 'source') === 'string' && typeof Reflect.get(value, 'target') === 'string' && typeof Reflect.get(value, 'integrity') === 'string';
}

function querySchema<TValue>(schema: Type<TValue>): ApplicationMessageContractSchema {
  // typecast: ArkType's JSON Schema result is validated by the shared schema adapter at runtime.
  return { kind: 'declared', runtime: 'arktype', jsonSchema: schema.toJsonSchema() as JsonObject };
}

function parseVersionedQueryId(id: string): { readonly name: string; readonly version: string } {
  const match = /^(?<name>[a-z][a-z0-9.-]*)\.(?<version>v[1-9][0-9]*)$/.exec(id);
  if (!match?.groups) throw new Error(`Application query id ${JSON.stringify(id)} must end in a stable version such as cards.for-set.v1.`);
  // typecast: the regex requires both named groups and the guard proves the groups object exists.
  return { name: match.groups.name as string, version: match.groups.version as string };
}

// Compile-time boundary: query authoring consumes the common facet but never serializes native objects into the graph.
export type ApplicationQueryModel = object & { readonly $model?: CommonApplicationModelFacet<object, unknown, unknown, unknown> };
