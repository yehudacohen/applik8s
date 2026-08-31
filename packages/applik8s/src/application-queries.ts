// typecast-file-boundary: Query schemas and model handles are validated before their generic types are restored at the public binding boundary.
import {
  type ApplicationOperationArguments,
  type ApplicationOperationAuthorizationContract,
  type ApplicationOperationContract,
  type ApplicationQueryInvocation,
  type ApplicationQueryOperation,
  createApplicationQueryOperation,
  observeApplicationOperationAuthority,
} from '@applik8s/client';
import type {
  ApplicationKubernetesQueryAuthorityContract,
  ApplicationMessageContractSchema,
  ApplicationPortableQuerySelectionContract,
  ApplicationPrincipal,
  ApplicationSerializedCallbackContract,
  JsonObject,
  RuntimeSchema,
} from '@applik8s/core';
import {
  emitArkTypeStructuralJsonSchema,
  normalizeSchema,
  type SchemaInput,
} from '@applik8s/sdk';
import type { Type } from 'arktype';
import type { ApplicationDatabaseBinding } from './application.js';
import { applicationActorDependencyBindings } from './application-actor-dependencies.js';
import {
  expandApplicationCallbackDependencies,
  serializeApplicationCallback,
} from './application-callback.js';
import type { ApplicationGraphState } from './application-graph-state.js';
import { addApplicationGraphEdge, addApplicationGraphNode } from './application-graph-state.js';
import { applicationTypeKroSerializedValue } from './application-typekro-values.js';
import {
  createApplicationQuerySelection,
  type ApplicationQuerySelectionContext,
  type ApplicationQuerySelectionContract,
  materializeApplicationQuerySelection,
} from './application-query-selection.js';
import type { ApplicationModelRelationshipContract, CommonApplicationModelFacet } from './native-models.js';
import { getApplicationModelFacet } from './native-models.js';
import {
  decorateApplicationBatchableQueryOperation,
  type ApplicationQueryBatchReplay,
} from './application-query-batching.js';
import type { ApplicationRelationalContext } from './relational-runtime.js';
import type { ApplicationTrustedContext } from './trusted-context.js';

/** Any schema accepted by the maintained runtime-schema boundary. */
export type ApplicationQuerySchema<TValue> =
  | Type<TValue>
  | (TValue extends object ? SchemaInput<TValue> : never);

/** Preserves the value carried by ArkType and normalized schema sources. */
export type ApplicationQuerySchemaValue<TSchema> =
  TSchema extends Type<infer TValue>
    ? TValue
    : TSchema extends { readonly inferredType?: infer TValue }
      ? Exclude<TValue, undefined>
      : TSchema extends SchemaInput<infer TValue>
      ? TValue
      : never;

export type ApplicationQuerySchemaSource = Type | SchemaInput<object>;

/** Canonical provider-neutral principal used by every query and transport. */
export type ApplicationQueryPrincipal = ApplicationPrincipal;

export type ApplicationQueryReadDependency = object | ApplicationModelRelationshipContract;

/** Structural declaration boundary implemented by online projection bindings without leaking Valkey. */
export interface ApplicationOnlineProjectionQueryBinding<TValue extends object = object> {
  readonly kind: 'applicationProjection';
  readonly storage: 'online';
  readonly name: string;
  readonly output: Type<TValue> | import('@applik8s/sdk').SchemaInput<TValue>;
  readonly source: { readonly database: ApplicationDatabaseBinding };
}

/** Structural declaration boundary implemented by analytical projection bindings without leaking ClickHouse. */
export interface ApplicationAnalyticalProjectionQueryBinding<TValue extends object = object> {
  readonly kind: 'applicationProjection';
  readonly storage: 'analytical';
  readonly name: string;
  readonly output: Type<TValue> | import('@applik8s/sdk').SchemaInput<TValue>;
  readonly source: { readonly database: ApplicationDatabaseBinding };
}

/** Provider-neutral source available to a projection-backed view callback. */
export interface ApplicationOnlineQuerySource<TValue extends object> {
  page(options: ApplicationOnlineQueryPageOptions): Promise<{
    readonly items: readonly TValue[];
    readonly cursor?: string;
    readonly projection: {
      readonly generation: string;
      readonly eventWatermark: string;
      readonly rebuilding: boolean;
      readonly degraded: boolean;
    };
  }>;
}

/** One partition or a bounded merge of partitions; exactly one selector is accepted at runtime. */
export type ApplicationOnlineQueryPageOptions =
  | { readonly partition: string; readonly partitions?: never; readonly limit: number; readonly cursor?: string }
  | {
      readonly partition?: never;
      readonly partitions: readonly string[];
      readonly limit: number;
      readonly cursor?: string;
    };

/** Runtime-only consistency controls supplied by the selected online provider adapter. */
export interface ApplicationOnlineQueryRuntimeSource<TValue extends object>
  extends ApplicationOnlineQuerySource<TValue> {
  revision(): Promise<string>;
  snapshot<TResult>(
    operation: (source: ApplicationOnlineQuerySource<TValue>) => Promise<TResult>,
  ): Promise<{ readonly value: TResult; readonly revision: string }>;
}

export type ApplicationAnalyticalMeasure<TValue extends object> =
  | { readonly operation: 'count'; readonly field?: keyof TValue & string }
  | { readonly operation: 'sum' | 'min' | 'max' | 'average'; readonly field: keyof TValue & string };

export type ApplicationAnalyticalAggregateRow<
  TValue extends object,
  TDimensions extends readonly (keyof TValue & string)[],
  TMeasures extends Readonly<Record<string, ApplicationAnalyticalMeasure<TValue>>>,
> = Pick<TValue, TDimensions[number]> & { readonly [TName in keyof TMeasures]: number };

/** Provider-neutral, bounded analytical source available inside a projection-backed view. */
export interface ApplicationAnalyticalQuerySource<TValue extends object> {
  aggregate<
    const TDimensions extends readonly (keyof TValue & string)[],
    const TMeasures extends Readonly<Record<string, ApplicationAnalyticalMeasure<TValue>>>,
  >(options: {
    readonly dimensions: TDimensions;
    readonly measures: TMeasures;
    readonly orderBy?: readonly {
      readonly field: TDimensions[number] | (keyof TMeasures & string);
      readonly direction: 'asc' | 'desc';
    }[];
    readonly limit: number;
  }): Promise<{
    readonly items: readonly ApplicationAnalyticalAggregateRow<TValue, TDimensions, TMeasures>[];
    readonly projection: { readonly revision: string; readonly degraded: boolean };
  }>;
}

/** Runtime-only consistency controls supplied by the selected analytical provider adapter. */
export interface ApplicationAnalyticalQueryRuntimeSource<TValue extends object>
  extends ApplicationAnalyticalQuerySource<TValue> {
  revision(): Promise<string>;
  snapshot<TResult>(
    operation: (source: ApplicationAnalyticalQuerySource<TValue>) => Promise<TResult>,
  ): Promise<{ readonly value: TResult; readonly revision: string }>;
}

export type ApplicationProjectionQuerySource<TValue extends object> =
  | ApplicationOnlineQuerySource<TValue>
  | ApplicationAnalyticalQuerySource<TValue>;
export type ApplicationProjectionQueryRuntimeSource<TValue extends object> =
  | ApplicationOnlineQueryRuntimeSource<TValue>
  | ApplicationAnalyticalQueryRuntimeSource<TValue>;
export type ApplicationQuerySourceBinding =
  | ApplicationOnlineProjectionQueryBinding<object>
  | ApplicationAnalyticalProjectionQueryBinding<object>;
type ApplicationQuerySourceValue<TSource> = TSource extends
  | ApplicationOnlineProjectionQueryBinding<infer TValue>
  | ApplicationAnalyticalProjectionQueryBinding<infer TValue>
  ? TValue
  : never;
export type ApplicationQuerySourceForBinding<TSource> =
  TSource extends ApplicationOnlineProjectionQueryBinding<object>
    ? ApplicationOnlineQuerySource<ApplicationQuerySourceValue<TSource>>
    : TSource extends ApplicationAnalyticalProjectionQueryBinding<object>
      ? ApplicationAnalyticalQuerySource<ApplicationQuerySourceValue<TSource>>
      : never;
type ApplicationQueryRunRequest<
  TInput,
  TPrincipal extends ApplicationQueryPrincipal,
  TSource extends ApplicationQuerySourceBinding | undefined,
> = {
  readonly context: ApplicationRelationalContext;
  readonly principal: TPrincipal;
  readonly input: TInput;
} & (TSource extends ApplicationQuerySourceBinding
  ? { readonly source: ApplicationQuerySourceForBinding<TSource> }
  : unknown);

export interface ApplicationQueryAuthorizationRequest<
  TInput,
  TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal,
> {
  readonly principal: TPrincipal;
  readonly context: Readonly<Record<string, unknown>>;
  readonly input: TInput;
}

export interface ApplicationKubernetesModelViewOptions<
  TInput,
  TObject,
  TOutput,
  TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal,
> {
  readonly input: ApplicationQuerySchema<TInput>;
  readonly output: ApplicationQuerySchema<TOutput>;
  readonly context?: readonly ApplicationTrustedContext<unknown>[];
  readonly reads?: readonly ApplicationQueryReadDependency[];
  readonly authorize: (request: ApplicationQueryAuthorizationRequest<TInput, TPrincipal>) => boolean | Promise<boolean>;
  readonly kubernetes: {
    readonly namespace?:
      | string
      | ((request: { readonly context: Readonly<Record<string, unknown>>; readonly input: TInput }) => string);
    readonly labelSelector?: (request: {
      readonly context: Readonly<Record<string, unknown>>;
      readonly input: TInput;
    }) => string | undefined;
    readonly fieldSelector?: (request: {
      readonly context: Readonly<Record<string, unknown>>;
      readonly input: TInput;
    }) => string | undefined;
    readonly filter?: (request: {
      readonly context: Readonly<Record<string, unknown>>;
      readonly input: TInput;
      readonly value: TObject;
    }) => boolean;
    readonly compare?: (request: {
      readonly context: Readonly<Record<string, unknown>>;
      readonly input: TInput;
      readonly left: TObject;
      readonly right: TObject;
    }) => number;
    readonly project: (request: {
      readonly context: Readonly<Record<string, unknown>>;
      readonly input: TInput;
      readonly value: TObject;
    }) => unknown;
    readonly limit?: (request: {
      readonly context: Readonly<Record<string, unknown>>;
      readonly input: TInput;
    }) => number;
    readonly pageSize?: number;
    readonly maxPages?: number;
    readonly maxItems?: number;
  };
  readonly budgets?: {
    readonly timeoutMs?: number;
    readonly maxResultBytes?: number;
    readonly maxRows?: number;
  };
}

export interface ApplicationKubernetesModelSelectionContext<TInput> {
  readonly input: TInput;
  readonly context: Readonly<Record<string, unknown>>;
}

/**
 * Model-native bounded selection for a Kubernetes-backed view.
 *
 * The outer view contract is authority-neutral while these selectors retain
 * the Kubernetes list/watch semantics that cannot honestly be represented as
 * relational SQL.
 */
export interface ApplicationKubernetesModelSelection<TInput, TObject> {
  readonly namespace?:
    | string
    | ((input: TInput, execution: ApplicationKubernetesModelSelectionContext<TInput>) => string);
  readonly labelSelector?: (
    input: TInput,
    execution: ApplicationKubernetesModelSelectionContext<TInput>,
  ) => string | undefined;
  readonly fieldSelector?: (
    input: TInput,
    execution: ApplicationKubernetesModelSelectionContext<TInput>,
  ) => string | undefined;
  readonly where?: (
    value: TObject,
    execution: ApplicationKubernetesModelSelectionContext<TInput>,
  ) => boolean;
  readonly orderBy?: (
    left: TObject,
    right: TObject,
    execution: ApplicationKubernetesModelSelectionContext<TInput>,
  ) => number;
  readonly limit?: (
    input: TInput,
    execution: ApplicationKubernetesModelSelectionContext<TInput>,
  ) => number;
  readonly bounds?: {
    readonly pageSize?: number;
    readonly maxPages?: number;
    readonly maxItems?: number;
  };
}

export interface ApplicationKubernetesModelViewContract<
  TInput,
  TObject,
  TOutput,
  TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal,
> {
  readonly input: ApplicationQuerySchema<TInput>;
  readonly output: ApplicationQuerySchema<TOutput>;
  readonly context?: readonly ApplicationTrustedContext<unknown>[];
  readonly reads?: readonly ApplicationQueryReadDependency[];
  readonly authorize: (
    request: ApplicationQueryAuthorizationRequest<TInput, TPrincipal>,
  ) => boolean | Promise<boolean>;
  readonly select: ApplicationKubernetesModelSelection<TInput, TObject>;
  readonly budgets?: {
    readonly timeoutMs?: number;
    readonly maxResultBytes?: number;
    readonly maxRows?: number;
  };
}

/**
 * Schema-preserving Kubernetes view contract.
 *
 * ArkType's generic Type shape cannot reliably contextually type sibling
 * selector callbacks while TypeScript is still inferring TInput/TOutput. Keep
 * the concrete schema values as the inference authority, matching relational
 * Model.view(...), so ordinary inline selectors never need reconstructed
 * framework generics.
 */
export type ApplicationKubernetesModelViewSchemaContract<
  TInputSchema extends ApplicationQuerySchemaSource,
  TObject,
  TOutputSchema extends ApplicationQuerySchemaSource,
  TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal,
> = Omit<
  ApplicationKubernetesModelViewContract<
    ApplicationQuerySchemaValue<TInputSchema>,
    TObject,
    ApplicationQuerySchemaValue<TOutputSchema>,
    TPrincipal
  >,
  'input' | 'output'
> & {
  readonly input: TInputSchema;
  readonly output: TOutputSchema;
};

export type ApplicationKubernetesModelViewImplementation<
  TInput,
  TObject,
  TOutput,
> = (
  value: TObject,
  execution: ApplicationKubernetesModelSelectionContext<TInput>,
) => TOutput extends readonly (infer TItem)[] ? TItem : TOutput;

export interface ApplicationQueryOptions<
  TInput,
  TOutput,
  TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal,
  TSource extends ApplicationQuerySourceBinding | undefined = undefined,
> {
  readonly input: ApplicationQuerySchema<TInput>;
  readonly output: ApplicationQuerySchema<TOutput>;
  readonly database?: ApplicationDatabaseBinding;
  readonly source?: TSource;
  readonly context?: readonly ApplicationTrustedContext<unknown>[];
  readonly reads: readonly ApplicationQueryReadDependency[];
  readonly authorize: (request: ApplicationQueryAuthorizationRequest<TInput, TPrincipal>) => boolean | Promise<boolean>;
  readonly run?: (request: ApplicationQueryRunRequest<TInput, TPrincipal, TSource>) => TOutput | Promise<TOutput>;
  readonly kubernetes?: ApplicationKubernetesModelViewOptions<TInput, unknown, TOutput, TPrincipal>['kubernetes'];
  readonly budgets?: {
    readonly timeoutMs?: number;
    readonly maxResultBytes?: number;
    readonly maxRows?: number;
  };
  /** Compiler-owned metadata for direct model-native named queries and views. */
  readonly modelOperation?: {
    readonly model: object;
    readonly name: string;
    readonly kind: 'query' | 'view';
  };
  /** Compiler-owned replay bridge; never serialized into the application graph. */
  readonly __authorityState?: ApplicationQueryAuthorityState;
  /**
   * Maintained modules may provide an already-normalized callback whose imports
   * are explicit. Application code should use ordinary callbacks.
   */
  readonly __generatedSources?: {
    readonly authorize?: ApplicationSerializedCallbackContract;
    readonly run?: ApplicationSerializedCallbackContract & {
      /** Maintained-source calling convention after compiler-owned normalization. */
      readonly invocation?: 'request' | 'input-context';
    };
  };
  /** Compiler-owned calling convention for function-native view callbacks. */
  readonly __handlerInvocation?: 'request' | 'input-context';
  /** Compiler-owned calling convention for model-native Kubernetes selectors. */
  readonly __kubernetesInvocation?: 'request' | 'model-native';
  /** Compiler-owned selection captured from synchronous context.select(...). */
  readonly __selection?: ApplicationQuerySelectionContract;
  /** Compiler-owned replay list for Query.onBatch declarations. */
  readonly __queryBatches?: ApplicationQueryBatchReplay[];
}

export type ApplicationModelViewOptions<
  TInput,
  TOutput,
  TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal,
  TSource extends ApplicationQuerySourceBinding | undefined = undefined,
> = Omit<ApplicationQueryOptions<TInput, TOutput, TPrincipal, TSource>, 'reads' | 'modelOperation'> & {
  readonly reads?: readonly ApplicationQueryReadDependency[];
};

/** Declarative half of the function-native Model.view(contract, implementation) API. */
export type ApplicationModelViewContract<
  TInput,
  TOutput,
  TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal,
  TSource extends ApplicationQuerySourceBinding | undefined = undefined,
> = Omit<ApplicationModelViewOptions<TInput, TOutput, TPrincipal, TSource>, 'run'>;

/** Declarative half of the function-native one-shot Model.query API. */
export type ApplicationModelQueryContract<
  TInput,
  TOutput,
  TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal,
  TSource extends ApplicationQuerySourceBinding | undefined = undefined,
> = ApplicationModelViewContract<TInput, TOutput, TPrincipal, TSource>;

/**
 * Schema-first view contract used by the function-native overload.
 *
 * Keeping the concrete ArkType values as type parameters prevents TypeScript
 * from widening discriminants through the implementation callback.
 */
export type ApplicationModelViewSchemaContract<
  TInputSchema extends ApplicationQuerySchemaSource,
  TOutputSchema extends ApplicationQuerySchemaSource,
  TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal,
  TSource extends ApplicationQuerySourceBinding | undefined = undefined,
> = Omit<
  ApplicationModelViewContract<ApplicationQuerySchemaValue<TInputSchema>, ApplicationQuerySchemaValue<TOutputSchema>, TPrincipal, TSource>,
  'input' | 'output'
> & {
  readonly input: TInputSchema;
  readonly output: TOutputSchema;
};

export type ApplicationModelQuerySchemaContract<
  TInputSchema extends ApplicationQuerySchemaSource,
  TOutputSchema extends ApplicationQuerySchemaSource,
  TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal,
  TSource extends ApplicationQuerySourceBinding | undefined = undefined,
> = ApplicationModelViewSchemaContract<TInputSchema, TOutputSchema, TPrincipal, TSource>;

/** Executable half of the function-native Model.view(contract, implementation) API. */
export type ApplicationModelViewImplementation<
  TInput,
  TOutput,
  TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal,
  TSource extends ApplicationQuerySourceBinding | undefined = undefined,
> = (
  input: TInput,
  context: ApplicationModelViewContext<TPrincipal, TSource>,
) => TOutput | Promise<TOutput>;

export type ApplicationModelQueryImplementation<
  TInput,
  TOutput,
  TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal,
  TSource extends ApplicationQuerySourceBinding | undefined = undefined,
> = ApplicationModelViewImplementation<TInput, TOutput, TPrincipal, TSource>;

/** Execution-scoped facts available to a function-native view implementation. */
export type ApplicationModelViewContext<
  TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal,
  TSource extends ApplicationQuerySourceBinding | undefined = undefined,
> = ApplicationRelationalContext
  & ApplicationQuerySelectionContext
  & { readonly principal: TPrincipal }
  & (TSource extends ApplicationQuerySourceBinding
    ? { readonly source: ApplicationQuerySourceForBinding<TSource> }
    : { readonly source?: never });

export interface ApplicationQueryBinding<
  TInput = unknown,
  TOutput = unknown,
  TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal,
  TSource extends ApplicationQuerySourceBinding | undefined = undefined,
> {
  readonly kind: 'applicationQuery';
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly input: Type<TInput> | RuntimeSchema<object>;
  readonly output: Type<TOutput> | RuntimeSchema<object>;
  readonly database?: ApplicationDatabaseBinding;
  readonly source?: TSource;
  /** Generated provider adapter; authoring bindings intentionally do not carry connections. */
  readonly sourceRuntime?: ApplicationProjectionQueryRuntimeSource<object>;
  readonly trustedContext: readonly ApplicationTrustedContext<unknown>[];
  readonly reads: readonly ApplicationQueryReadDependency[];
  readonly budgets: {
    readonly timeoutMs: number;
    readonly maxResultBytes: number;
    readonly maxRows: number;
  };
  readonly kubernetes?: ApplicationKubernetesQueryAuthorityContract;
  readonly selection?: ApplicationQuerySelectionContract;
  authorize(principal: TPrincipal, input: TInput, context?: Readonly<Record<string, unknown>>): Promise<boolean>;
  run(
    context: ApplicationRelationalContext,
    principal: TPrincipal,
    input: TInput,
    source?: ApplicationProjectionQuerySource<object>,
  ): Promise<TOutput>;
}

/** Authoring query binding: server execution metadata plus direct client invocation. */
export interface ApplicationCallableQueryBinding<
  TInput = unknown,
  TOutput = unknown,
  TPrincipal extends ApplicationQueryPrincipal = ApplicationQueryPrincipal,
  TSource extends ApplicationQuerySourceBinding | undefined = undefined,
> extends ApplicationQueryBinding<TInput, TOutput, TPrincipal, TSource> {
  (...args: ApplicationOperationArguments<TInput>): ApplicationQueryInvocation<TOutput>;
  readonly operation: ApplicationOperationContract;
}

const applicationQueryOperationBindings = new WeakMap<object, ApplicationQueryBinding>();
interface ApplicationQueryAuthorityState {
  current?: ApplicationOperationAuthorizationContract;
}
const applicationQueryAuthorityStates = new WeakMap<object, ApplicationQueryAuthorityState>();

export function applicationQueryBindingForOperation(value: unknown): ApplicationQueryBinding | undefined {
  return (typeof value === 'object' || typeof value === 'function') && value !== null
    ? applicationQueryOperationBindings.get(value)
    : undefined;
}

/**
 * Register a framework-owned query operation whose graph node is emitted by a
 * specialized authority registrar (for example, a named search index).
 *
 * Application authors should use the owning primitive instead of this
 * boundary. Keeping the association in the canonical query registry lets
 * gateways expose every query operation uniformly without manufacturing a
 * second operation vocabulary.
 */
export function bindFrameworkApplicationQueryOperation(operation: object, binding: ApplicationQueryBinding): void {
  const existing = applicationQueryOperationBindings.get(operation);
  if (existing && existing !== binding) {
    throw new Error(`Application query operation ${binding.id} is already bound to another authority.`);
  }
  applicationQueryOperationBindings.set(operation, binding);
}

export function registerApplicationQuery<
  TInput,
  TOutput,
  TPrincipal extends ApplicationQueryPrincipal,
  TSource extends ApplicationQuerySourceBinding | undefined = undefined,
>(
  state: ApplicationGraphState,
  id: string,
  options: ApplicationQueryOptions<TInput, TOutput, TPrincipal, TSource>,
): ApplicationCallableQueryBinding<TInput, TOutput, TPrincipal, TSource> {
  const authorityState = options.__authorityState ?? authorityStateFor(options);
  authorityState.current ??= applicationQueryPolicyAuthority();
  const parsed = parseVersionedQueryId(id);
  const nodeId = `query.${id}`;
  if (state.graphNodes.some((node) => node.id === nodeId))
    throw new Error(`Application query ${id} is already registered.`);
  if (options.reads.length === 0)
    throw new Error(`Application query ${id} must declare at least one model or relationship read dependency.`);
  const source = options.source;
  const authorityCount =
    Number(Boolean(options.database && !source)) + Number(Boolean(options.kubernetes)) + Number(Boolean(source));
  if (authorityCount !== 1) {
    throw new Error(
      `Application query ${id} must declare exactly one PostgreSQL, Kubernetes, or projection snapshot authority.`,
    );
  }
  if ((options.database || source) && !options.run)
    throw new Error(`Application query ${id} requires run() for its PostgreSQL or projection snapshot authority.`);
  if (options.kubernetes && options.run)
    throw new Error(`Application query ${id} must use declarative kubernetes projection callbacks instead of run().`);
  const projection = source ? projectionQueryAuthority(state, id, source) : undefined;
  const database = source?.source.database ?? options.database;
  const normalizedDependencies = options.reads.map((dependency) => normalizeQueryReadDependency(state, dependency));
  const reads = normalizedDependencies.map((dependency) => queryReadContract(state, dependency, id));
  const selection = options.__selection
    ? applicationGraphQuerySelection(state, id, options.__selection, reads)
    : undefined;
  const budgets = {
    timeoutMs: options.budgets?.timeoutMs ?? 5_000,
    maxResultBytes: options.budgets?.maxResultBytes ?? 1_048_576,
    maxRows: options.budgets?.maxRows ?? 1_000,
  };
  if (budgets.timeoutMs < 1 || budgets.maxResultBytes < 1 || budgets.maxRows < 1)
    throw new Error(`Application query ${id} budgets must be positive and bounded.`);
  const inputSchema = runtimeQuerySchema(options.input, `${id}.input`);
  const outputSchema = runtimeQuerySchema(options.output, `${id}.output`);
  const registrar = options.modelOperation?.kind ?? 'query';
  const inferredHandlerDependencies = options.run
    ? expandApplicationCallbackDependencies({ calls: [options.run] })
    : { calls: [], bindings: {}, awaited: {}, callables: [], providerBindings: [] };
  const actorBindings = applicationActorDependencyBindings(
    state,
    `Application query ${id}`,
    inferredHandlerDependencies,
  ).map(({ alias, actor, member, memberKind }) => ({
    identifier: alias,
    actor,
    member,
    memberKind,
  }));
  // typecast: callback serialization erases only generic parameter names; runtime schemas remain authoritative for their values.
  const authorization =
    options.__generatedSources?.authorize ??
    serializeApplicationCallback({
      registrar,
      argumentIndex: 1,
      property: 'authorize',
      label: `Application query ${id} authorization`,
      callback: options.authorize as (...args: never[]) => unknown,
      allowDeferredResolution: true,
    });
  // typecast: callback serialization preserves executable source while the query binding validates input and output at runtime.
  const handler =
    options.__generatedSources?.run ??
    (options.run
      ? serializeApplicationCallback({
          registrar,
          argumentIndex: 1,
          property: 'run',
          label: `Application query ${id} handler`,
          // typecast: serialization needs only the callback's executable shape; the public binding retains its input/output generics.
          callback: options.run as (...args: never[]) => unknown,
          allowDeferredResolution: true,
          injectedIdentifiers: actorBindings.flatMap(({ identifier }) => [
            identifier,
            identifier.split('.')[0] ?? identifier,
          ]),
        })
      : { source: '() => { throw new Error("Kubernetes queries execute through their snapshot/watch authority."); }' });
  const kubernetes = options.kubernetes
    ? kubernetesQueryAuthority(
        state,
        id,
        normalizedDependencies[0],
        options.kubernetes,
        options.__kubernetesInvocation,
      )
    : undefined;
  addApplicationGraphNode(state, {
    id: nodeId,
    kind: 'query',
    name: parsed.name,
    version: parsed.version,
    ...(parsed.publicId ? { publicId: parsed.publicId } : {}),
    ...(options.modelOperation
      ? {
          modelOperation: {
            model: queryReadContract(state, options.modelOperation.model, id).model,
            name: options.modelOperation.name,
            kind: options.modelOperation.kind,
          },
        }
      : {}),
    stability: 'stable',
    input: querySchema(options.input),
    output: querySchema(options.output),
    reads,
    authorization: 'application-defined',
    ...(authorityState.current ? { authority: authorityState.current } : {}),
    trustedContext: (options.context ?? []).map((context) => context.name).sort(),
    ...((options.context?.length ?? 0) > 0
      ? {
          trustedContextSchemas: Object.fromEntries(
            (options.context ?? []).map((context) => [context.name, context.contract.jsonSchema]),
          ),
        }
      : {}),
    budgets,
    snapshotResume: database || kubernetes ? 'resumableInvalidation' : 'resetOnly',
    incremental: 'invalidation-requery',
    cursor: 'opaque-query-version-context-scoped',
    ...(database ? { database: reactiveDatabaseRuntime(database) } : {}),
    ...(kubernetes ? { kubernetes } : {}),
    ...(projection ? { projection } : {}),
    ...(selection ? { selection } : {}),
    authorizationSource: authorization.source,
    ...(authorization.dependencies ? { authorizationDependencies: authorization.dependencies } : {}),
    ...(authorization.location ? { authorizationLocation: authorization.location } : {}),
    ...(authorization.unresolved ? { authorizationUnresolved: authorization.unresolved } : {}),
    handlerSource: handler.source,
    ...((options.__generatedSources?.run?.invocation ?? options.__handlerInvocation)
      ? {
          handlerInvocation:
            options.__generatedSources?.run?.invocation
            ?? options.__handlerInvocation,
        }
      : {}),
    ...(handler.dependencies ? { handlerDependencies: handler.dependencies } : {}),
    ...(actorBindings.length > 0 ? { actorBindings } : {}),
    ...(handler.location ? { handlerLocation: handler.location } : {}),
    ...(handler.unresolved ? { handlerUnresolved: handler.unresolved } : {}),
  });
  for (const read of reads) addApplicationGraphEdge(state, { from: { nodeId }, to: read.model, relationship: 'reads' });
  for (const actor of actorBindings) {
    addApplicationGraphEdge(state, {
      from: { nodeId },
      to: actor.actor,
      relationship: 'dependsOn',
    });
  }
  const execution = createApplicationQueryOperation<TInput, TOutput>({
    apiVersion: 'applik8s.operation/v1alpha1',
    kind: 'applicationOperation',
    id,
    model: 'Application',
    name: parsed.name,
    operation: 'query',
    transport: 'query',
    ...(authorityState.current ? { authority: authorityState.current } : {}),
  }, undefined, { input: inputSchema, output: outputSchema });
  const callable = ((...args: ApplicationOperationArguments<TInput>) => execution(...args));
  Object.defineProperty(callable, 'operation', {
    get: () => execution.operation,
    enumerable: false,
    configurable: false,
  });
  const properties = {
    kind: 'applicationQuery',
    id,
    name: parsed.name,
    version: parsed.version,
    input: inputSchema,
    output: outputSchema,
    ...(database ? { database } : {}),
    ...(source ? { source } : {}),
    ...(kubernetes ? { kubernetes } : {}),
    ...(options.__selection ? { selection: options.__selection } : {}),
    trustedContext: options.context ?? [],
    reads: normalizedDependencies,
    budgets,
    async authorize(principal: TPrincipal, input: TInput, context: Readonly<Record<string, unknown>> = {}) {
      return options.authorize({ principal, context, input });
    },
    async run(
      context: ApplicationRelationalContext,
      principal: TPrincipal,
      input: TInput,
      runtimeSource?: ApplicationProjectionQuerySource<object>,
    ) {
      if (options.__selection) {
        return materializeApplicationQuerySelection({
          selection: options.__selection,
          input,
          principal,
          trustedContext: context.trustedContext,
          maximumRows: budgets.maxRows,
        }) as unknown as Promise<TOutput>;
      }
      if (!options.run)
        throw new Error(`Application query ${id} executes through its Kubernetes snapshot/watch authority.`);
      if (source && !runtimeSource)
        throw new Error(`Application query ${id} requires its generated projection source runtime.`);
      if (options.__handlerInvocation === 'input-context') {
        return (options.run as unknown as (
          input: TInput,
          context: ApplicationModelViewContext<TPrincipal, TSource>,
        ) => TOutput | Promise<TOutput>)(
          input,
          Object.assign(context, {
            principal,
            select: createApplicationQuerySelection,
            ...(source ? { source: runtimeSource } : {}),
          }) as unknown as ApplicationModelViewContext<TPrincipal, TSource>,
        );
      }
      // typecast: the source discriminant above supplies the provider-neutral projection source only for projection-backed options.
      return options.run({
        context,
        principal,
        input,
        ...(source ? { source: runtimeSource } : {}),
      } as ApplicationQueryRunRequest<TInput, TPrincipal, TSource>);
    },
  };
  for (const [property, value] of Object.entries(properties)) {
    Object.defineProperty(callable, property, {
      value,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  const binding = callable as unknown as ApplicationCallableQueryBinding<TInput, TOutput, TPrincipal, TSource>;
  applicationQueryOperationBindings.set(binding, binding as ApplicationQueryBinding);
  return binding;
}

export function registerApplicationModelView<
  TInput,
  TOutput,
  TPrincipal extends ApplicationQueryPrincipal,
  TSource extends ApplicationQuerySourceBinding | undefined = undefined,
>(
  state: ApplicationGraphState,
  model: object,
  name: string,
  options: ApplicationModelViewOptions<TInput, TOutput, TPrincipal, TSource>,
  operationKind: 'query' | 'view' = 'view',
): ApplicationQueryOperation<TInput, TOutput> {
  const facet = getApplicationModelFacet<object, unknown, unknown, unknown>(model);
  if (!facet) throw new Error('Application model queries and views require a promoted application model.');
  if (!/^[a-z][A-Za-z0-9]*$/.test(name))
    throw new Error(`Application model ${operationKind} ${JSON.stringify(name)} must be a lowerCamelCase identifier.`);
  const id = `${facet.name}.${name}`;
  const authorityState = authorityStateFor(options);
  const binding = registerApplicationQuery(state, id, {
    ...options,
    reads: [model, ...(options.reads ?? [])],
    modelOperation: { model, name, kind: operationKind },
    __authorityState: authorityState,
  });
  const operation = createApplicationQueryOperation<TInput, TOutput>(
    {
      apiVersion: 'applik8s.operation/v1alpha1',
      kind: 'applicationOperation',
      id,
      model: facet.name,
      name,
      operation: 'query',
      transport: 'query',
      ...(authorityState.current ? { authority: authorityState.current } : {}),
    },
    undefined,
    {
      input: options.input,
      output: options.output,
    },
  );
  // typecast: the operation's generic input/output pair comes from the same binding schemas and the private registry intentionally erases only those generics.
  applicationQueryOperationBindings.set(operation, binding as ApplicationQueryBinding);
  observeApplicationOperationAuthority(operation, (authority) => {
    authorityState.current = authority;
    const nodeId = `query.${id}`;
    const query = state.graphNodes.find((node) => node.id === nodeId && node.kind === 'query');
    if (query?.kind !== 'query')
      throw new Error(`Application model ${operationKind} ${id} cannot classify a missing query graph node.`);
    addApplicationGraphNode(state, { ...query, authority });
  });
  return binding.selection
    ? decorateApplicationBatchableQueryOperation({
        state,
        operation: operation as unknown as ApplicationQueryOperation<object, readonly object[]>,
        query: binding as unknown as ApplicationQueryBinding<object, readonly object[]>,
        selection: binding.selection,
        ...(options.__queryBatches ? { replays: options.__queryBatches } : {}),
      }) as unknown as ApplicationQueryOperation<TInput, TOutput>
    : operation;
}

function authorityStateFor(value: object): ApplicationQueryAuthorityState {
  const existing = applicationQueryAuthorityStates.get(value);
  if (existing) return existing;
  const created: ApplicationQueryAuthorityState = {};
  applicationQueryAuthorityStates.set(value, created);
  return created;
}

/**
 * Every query declares an authorization callback as part of its contract.
 * That callback is the application policy at the generated admission boundary,
 * so authors must not repeat the same fact with `.applicationPolicy()`.
 */
function applicationQueryPolicyAuthority(): ApplicationOperationAuthorizationContract {
  return {
    classification: 'application-policy',
    permissionIds: [],
    grantable: false,
    delegable: false,
    scope: { kind: 'all' },
    transports: ['http'],
  };
}

function projectionQueryAuthority(
  state: ApplicationGraphState,
  id: string,
  source: ApplicationQuerySourceBinding,
): { readonly nodeId: string; readonly storage: 'online' | 'analytical' } {
  const nodeId = `projection.${reactiveName(source.name)}`;
  const node = state.graphNodes.find((candidate) => candidate.id === nodeId);
  if (node && (node.kind !== 'projection' || node.storage !== source.storage)) {
    throw new Error(`Application query ${id} references incompatible projection ${source.name}.`);
  }
  // Composition materialization replays registrars grouped by resource type,
  // so a view may be replayed before its already-declared projection. Keep the
  // deterministic reference here and let whole-graph validation prove that the
  // compatible projection exists after every registrar has run.
  return { nodeId, storage: source.storage };
}

function kubernetesQueryAuthority<TInput, TOutput, TPrincipal extends ApplicationQueryPrincipal>(
  state: ApplicationGraphState,
  id: string,
  dependency: ApplicationQueryReadDependency | undefined,
  options: ApplicationKubernetesModelViewOptions<TInput, unknown, TOutput, TPrincipal>['kubernetes'],
  invocation: 'request' | 'model-native' | undefined,
): ApplicationKubernetesQueryAuthorityContract {
  if (!dependency || isRelationship(dependency)) {
    throw new Error(
      `Application Kubernetes query ${id} must read a promoted Kubernetes model as its first dependency.`,
    );
  }
  const model = getApplicationModelFacet<object, unknown, unknown, unknown>(dependency);
  if (model?.native !== 'kubernetes-resource') {
    throw new Error(`Application Kubernetes query ${id} must read a Kubernetes-backed model as its first dependency.`);
  }
  const node = state.graphNodes.find((candidate) => candidate.kind === 'crd' && candidate.name === model.name);
  if (node?.kind !== 'crd')
    throw new Error(`Application Kubernetes query ${id} cannot resolve CRD graph metadata for ${model.name}.`);
  const pageSize = positiveInteger(options.pageSize ?? 250, `${id}.kubernetes.pageSize`);
  const maxPages = positiveInteger(options.maxPages ?? 100, `${id}.kubernetes.maxPages`);
  const maxItems = positiveInteger(options.maxItems ?? 10_000, `${id}.kubernetes.maxItems`);
  const namespaceResolver =
    typeof options.namespace === 'function' ? serializeQueryCallback(id, 'namespace', options.namespace) : undefined;
  const namespace =
    options.namespace === undefined || typeof options.namespace === 'function'
      ? undefined
      : applicationTypeKroSerializedValue(options.namespace);
  return {
    kind: 'kubernetes-list-watch',
    ...(invocation ? { invocation } : {}),
    model: { nodeId: node.id },
    resource: {
      apiVersion: node.resource.apiVersion,
      kind: node.resource.kind,
      plural: node.resource.plural,
      scope: node.resource.scope,
    },
    ...(namespace ? { namespace } : {}),
    ...(namespaceResolver ? { namespaceResolver } : {}),
    ...(options.labelSelector
      ? { labelSelector: serializeQueryCallback(id, 'labelSelector', options.labelSelector) }
      : {}),
    ...(options.fieldSelector
      ? { fieldSelector: serializeQueryCallback(id, 'fieldSelector', options.fieldSelector) }
      : {}),
    ...(options.filter ? { filter: serializeQueryCallback(id, 'filter', options.filter) } : {}),
    ...(options.compare ? { compare: serializeQueryCallback(id, 'compare', options.compare) } : {}),
    project: serializeQueryCallback(id, 'project', options.project),
    ...(options.limit ? { limit: serializeQueryCallback(id, 'limit', options.limit) } : {}),
    pageSize,
    maxPages,
    maxItems,
  };
}

function serializeQueryCallback(
  id: string,
  property: string,
  callback: (...args: never[]) => unknown,
): ApplicationSerializedCallbackContract {
  const serialized = serializeApplicationCallback({
    registrar: 'query',
    argumentIndex: 1,
    property,
    label: `Application query ${id} Kubernetes ${property}`,
    callback,
    allowDeferredResolution: true,
  });
  return {
    source: serialized.source,
    ...(serialized.dependencies ? { dependencies: serialized.dependencies } : {}),
    ...(serialized.location ? { location: serialized.location } : {}),
    ...(serialized.unresolved ? { unresolved: serialized.unresolved } : {}),
  };
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`Application query ${name} must be a positive integer.`);
  return value;
}

function normalizeQueryReadDependency(
  state: ApplicationGraphState,
  dependency: ApplicationQueryReadDependency,
): ApplicationQueryReadDependency {
  if (!isRelationship(dependency)) return dependency;
  const source = canonicalApplicationModelName(state, dependency.source) ?? dependency.source;
  const target = canonicalApplicationModelName(state, dependency.target) ?? dependency.target;
  return source === dependency.source && target === dependency.target ? dependency : { ...dependency, source, target };
}

function canonicalApplicationModelName(state: ApplicationGraphState, value: string): string | undefined {
  const direct = state.graphNodes.find((node) => (node.kind === 'model' || node.kind === 'crd') && node.name === value);
  if (direct) return direct.name;
  const native = state.graphNodes.find((node) => {
    if (node.kind === 'model') return node.native?.artifact.name === value;
    if (node.kind === 'crd') return node.resource.plural === value || node.resource.kind === value;
    return false;
  });
  return native?.name;
}

function reactiveDatabaseRuntime(binding: ApplicationDatabaseBinding): {
  readonly name: string;
  readonly connectionEnvName: string;
  readonly secretName: string;
  readonly secretKey: string;
  readonly secretNamespace?: string;
  readonly access?: {
    readonly context: string;
    readonly contextSchema: JsonObject;
    readonly setting: string;
    readonly column: string;
    readonly default: 'required' | 'global';
  };
} {
  const provider = binding.provider;
  const clusterName = provider.clusterName ?? provider.name ?? `${reactiveName(binding.name)}-db`;
  const secret = provider.connectionSecret ?? {
    apiVersion: 'v1',
    kind: 'Secret',
    name: `${clusterName}-app`,
    ...(provider.namespace ? { namespace: provider.namespace } : {}),
  };
  return {
    name: binding.name,
    connectionEnvName: `APPLIK8S_DATABASE_${reactiveName(binding.name)
      .replace(/[^A-Z0-9_a-z]+/g, '_')
      .toUpperCase()}_URL`,
    secretName: applicationTypeKroSerializedValue(secret.name ?? `${clusterName}-app`),
    secretKey: applicationTypeKroSerializedValue(provider.connectionSecretKey ?? 'uri'),
    ...((secret.namespace ?? provider.namespace)
      ? { secretNamespace: applicationTypeKroSerializedValue(secret.namespace ?? provider.namespace) }
      : {}),
    ...(binding.access
      ? {
          access: {
            context: binding.access.context.name,
            contextSchema: binding.access.context.contract.jsonSchema,
            setting: binding.access.setting,
            column: binding.access.column,
            default: binding.access.default,
          },
        }
      : {}),
  };
}

function reactiveName(value: string): string {
  return (
    value
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .toLowerCase()
      .replace(/[^a-z0-9.-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'app'
  );
}

function queryReadContract(
  state: ApplicationGraphState,
  dependency: ApplicationQueryReadDependency,
  query: string,
): { readonly model: { readonly nodeId: string }; readonly relationship?: string } {
  if (isRelationship(dependency)) {
    const node = state.graphNodes.find(
      (candidate) => (candidate.kind === 'model' || candidate.kind === 'crd') && candidate.name === dependency.source,
    );
    if (!node)
      throw new Error(
        `Application query ${query} reads relationship ${dependency.source}.${dependency.name}, but source model ${dependency.source} is not registered in this app.`,
      );
    return { model: { nodeId: node.id }, relationship: dependency.name };
  }
  const model = getApplicationModelFacet<object, unknown, unknown, unknown>(dependency);
  if (!model)
    throw new Error(
      `Application query ${query} reads an object that is not a promoted application model or relationship.`,
    );
  const node = state.graphNodes.find(
    (candidate) => (candidate.kind === 'model' || candidate.kind === 'crd') && candidate.name === model.name,
  );
  if (!node)
    throw new Error(
      `Application query ${query} reads model ${model.name}, but that model is not registered in this app.`,
    );
  return { model: { nodeId: node.id } };
}

function isRelationship(value: object): value is ApplicationModelRelationshipContract {
  return (
    typeof Reflect.get(value, 'source') === 'string' &&
    typeof Reflect.get(value, 'target') === 'string' &&
    typeof Reflect.get(value, 'integrity') === 'string'
  );
}

function applicationGraphQuerySelection(
  state: ApplicationGraphState,
  queryId: string,
  selection: ApplicationQuerySelectionContract,
  reads: readonly { readonly model: { readonly nodeId: string } }[],
): ApplicationPortableQuerySelectionContract {
  const sourceRead = reads.find(({ model }) => {
    const node = state.graphNodes.find((candidate) => candidate.id === model.nodeId);
    return node?.kind === 'model' && node.name === selection.sourceModel;
  });
  if (!sourceRead) {
    throw new Error(
      `Batchable query ${queryId} selects ${selection.sourceModel}, but that model is not one of its declared read authorities.`,
    );
  }
  const sourceNode = state.graphNodes.find(
    (candidate) => candidate.id === sourceRead.model.nodeId,
  );
  if (
    sourceNode?.kind !== 'model'
    || sourceNode.runtime?.provider !== 'postgres'
    || sourceNode.runtime.tableName !== selection.source.table
    || sourceNode.runtime.database !== selection.source.database
  ) {
    throw new Error(
      `Batchable query ${queryId} selection does not match the promoted PostgreSQL authority for ${selection.sourceModel}.`,
    );
  }
  const relationshipReads = selection.relationshipReads.map((name) => {
    const node = state.graphNodes.find(
      (candidate) => candidate.kind === 'model' && candidate.name === name,
    );
    if (!node) throw new Error(`Batchable query ${queryId} reads unknown related model ${name}.`);
    return { nodeId: node.id };
  });
  return {
    ...selection,
    sourceModel: sourceRead.model,
    relationshipReads,
  };
}

function querySchema<TValue>(schema: ApplicationQuerySchema<TValue>): ApplicationMessageContractSchema {
  if (typeof schema === 'function') {
    return {
      kind: 'declared',
      runtime: 'arktype',
      jsonSchema: emitArkTypeStructuralJsonSchema(schema as Type<TValue>),
    };
  }
  const emitted = normalizeSchema(
    schema as SchemaInput<object>,
    'application.query',
  ).emitJsonSchema();
  if (!emitted.ok) {
    throw new Error(`applik8s-query-schema-unsupported: ${emitted.error.message}`);
  }
  return { kind: 'declared', runtime: 'arktype', jsonSchema: emitted.value.schema };
}

function runtimeQuerySchema<TValue>(
  schema: ApplicationQuerySchema<TValue>,
  name: string,
): Type<TValue> | RuntimeSchema<object> {
  // typecast: only ArkType is callable within the accepted schema union.
  if (typeof schema === 'function') return schema as Type<TValue>;
  return normalizeSchema(schema as SchemaInput<object>, name);
}

function parseVersionedQueryId(id: string): {
  readonly name: string;
  readonly version: string;
  readonly publicId?: string;
} {
  const match = /^(?<name>[a-z][a-z0-9.-]*)\.(?<version>v[1-9][0-9]*)$/.exec(id);
  if (!match?.groups) {
    const modelView = /^(?<model>[A-Z][A-Za-z0-9]*)\.(?<view>[a-z][A-Za-z0-9]*)$/.exec(id);
    if (modelView?.groups) return { name: id, version: 'v1', publicId: id };
    throw new Error(
      `Application query id ${JSON.stringify(id)} must end in a stable version such as cards.for-set.v1 or use the direct Model.view form.`,
    );
  }
  // typecast: the regex requires both named groups and the guard proves the groups object exists.
  return { name: match.groups.name as string, version: match.groups.version as string };
}

// Compile-time boundary: query authoring consumes the common facet but never serializes native objects into the graph.
export type ApplicationQueryModel = object & {
  readonly $model?: CommonApplicationModelFacet<object, unknown, unknown, unknown>;
};
