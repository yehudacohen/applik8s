// typecast-file-boundary: operation decorators preserve generic input/output associations while installing runtime metadata on callable functions.

import type {
  ApplicationOperationId,
  ApplicationOperationTransport,
  ApplicationScopeExpression,
  ApplicationScopeScalar,
} from '@applik8s/core';
import { createHttpApplicationCommandTransport } from './command-http-transport.js';
import { ApplicationCommandClient } from './command-store.js';
import { createHttpApplicationQueryTransport } from './http-transport.js';
import type { ApplicationQuerySnapshot } from './protocol.js';
import { createHttpApplicationRuntimeTransport } from './runtime-http-transport.js';
import { ApplicationQueryClient } from './store.js';

export const applicationOperationContract = Symbol.for('@applik8s/application-operation');
export const applicationOperationSchemas = Symbol.for('@applik8s/application-operation-schemas');

/**
 * Authoring-time schemas associated with a callable operation. The values stay
 * opaque here so browser-safe operation handles do not acquire a schema-library
 * dependency. Adapters such as @applik8s/ai-tanstack may require Standard
 * Schema-compatible values and fail closed when an operation has only a
 * serialized runtime schema.
 */
export interface ApplicationOperationSchemaBinding<TInput = unknown, TOutput = unknown> {
  readonly input: unknown;
  readonly output: unknown;
  /** Type-only association retained by the callable operation. */
  readonly '~types'?: {
    readonly input: TInput;
    readonly output: TOutput;
  };
}

export interface ApplicationOperationContract {
  readonly apiVersion: 'applik8s.operation/v1alpha1';
  readonly kind: 'applicationOperation';
  readonly id: ApplicationOperationId | string;
  readonly model: string;
  readonly name: string;
  readonly operation: 'create' | 'get' | 'query' | 'update' | 'delete' | 'custom';
  readonly transport: 'command' | 'query' | 'runtime';
  readonly version?: string;
  readonly authority?: ApplicationOperationAuthorizationContract;
}

export interface ApplicationOperationAuthorizationContract {
  readonly classification: 'unclassified' | 'public' | 'assigned' | 'runtime-grantable' | 'application-policy';
  readonly permissionIds: readonly string[];
  readonly grantable: boolean;
  readonly delegable: boolean;
  readonly scope: ApplicationScopeExpression;
  readonly audiences?: readonly string[];
  readonly transports?: readonly ApplicationOperationTransport[];
  readonly lifetime?: ApplicationAuthorizationLifetime;
}

export interface ApplicationAuthorizationLifetime {
  readonly expiresIn?: string;
  readonly maximumUses?: number;
  readonly outcomeId?: string;
}

export interface ApplicationPermissionDefinition {
  readonly id: string;
}

export interface ApplicationModelReference<TTarget = unknown> {
  readonly model: string;
  readonly identity: Readonly<Record<string, ApplicationScopeScalar>>;
  /** Type-only target association. */
  readonly __target?: TTarget;
}

export interface ApplicationScopeComparator {
  eq(value: ApplicationScopeValueInput): ApplicationScopeExpression;
  ne(value: ApplicationScopeValueInput): ApplicationScopeExpression;
  lt(value: ApplicationScopeValueInput): ApplicationScopeExpression;
  lte(value: ApplicationScopeValueInput): ApplicationScopeExpression;
  gt(value: ApplicationScopeValueInput): ApplicationScopeExpression;
  gte(value: ApplicationScopeValueInput): ApplicationScopeExpression;
  in(...values: readonly ApplicationScopeValueInput[]): ApplicationScopeExpression;
}

export type ApplicationScopeValueInput =
  | ApplicationScopeScalar
  | {
    readonly source: 'target' | 'principal' | 'trusted-context' | 'input' | 'event' | 'resource';
    readonly path: string;
  };

export type ApplicationModelScopeFields<TTarget> = {
  readonly [TKey in keyof TTarget]-?: ApplicationScopeComparator;
};

export type ApplicationModelScopePredicate<TTarget> = (
  target: ApplicationModelScopeFields<TTarget>,
) => ApplicationScopeExpression;

export type ApplicationOperationInput<TOperation> =
  TOperation extends (input: infer TInput) => unknown ? TInput : never;
export type ApplicationOperationOutput<TOperation> =
  TOperation extends (input: infer _TInput) => Promise<infer TOutput>
    ? TOutput
    : TOperation extends (input: infer _TInput) => ApplicationQueryInvocation<infer TOutput>
      ? TOutput
      : never;

type OptionalKeys<T extends object> = {
  [TKey in keyof T]-?: {} extends Pick<T, TKey> ? TKey : never;
}[keyof T];

type ValidExecutionBindingProjection<
  TOperation,
  TBound extends Readonly<Record<string, unknown>>,
> = TBound
  & Record<Exclude<keyof TBound, keyof (ApplicationOperationInput<TOperation> & object)>, never>
  & Record<OptionalKeys<TBound>, never>
  & {
    readonly [TKey in keyof TBound]:
      TKey extends keyof (ApplicationOperationInput<TOperation> & object)
        ? TBound[TKey] extends ApplicationOperationInput<TOperation>[TKey]
          ? TBound[TKey]
          : never
        : never;
  };

export interface ApplicationOperationPermission<TOperation> {
  readonly operation: TOperation;
  readonly operationId: string;
}

export interface ApplicationScopedOperation<TOperation, TTarget = unknown> {
  readonly operation: TOperation;
  readonly target: ApplicationScopeExpression;
  readonly predicates: readonly ApplicationScopeExpression[];
  where(
    scope: ApplicationModelScopePredicate<TTarget>,
  ): ApplicationScopedOperation<TOperation, TTarget>;
  onInput<TSource, const TBound extends Readonly<Record<string, unknown>>>(
    projection: (input: TSource) => ValidExecutionBindingProjection<TOperation, TBound>,
  ): ApplicationBoundOperation<TOperation, keyof TBound & string, 'input'>;
  onEvent<TSource, const TBound extends Readonly<Record<string, unknown>>>(
    projection: (event: TSource) => ValidExecutionBindingProjection<TOperation, TBound>,
  ): ApplicationBoundOperation<TOperation, keyof TBound & string, 'event'>;
  onResource<TSource, const TBound extends Readonly<Record<string, unknown>>>(
    projection: (resource: TSource) => ValidExecutionBindingProjection<TOperation, TBound>,
  ): ApplicationBoundOperation<TOperation, keyof TBound & string, 'resource'>;
}

export interface ApplicationOperationScopeBuilder<TOperation, TTarget = unknown> extends ApplicationScopedOperation<TOperation, TTarget> {
  all(): ApplicationScopedOperation<TOperation, TTarget>;
  on(target: ApplicationModelReference<TTarget>): ApplicationScopedOperation<TOperation, TTarget>;
}

export interface ApplicationBoundOperation<
  TOperation,
  TBoundKey extends string,
  TSource extends 'input' | 'event' | 'resource',
> {
  readonly operation: TOperation;
  readonly source: TSource;
  readonly boundKeys: readonly TBoundKey[];
  readonly target: ApplicationScopeExpression;
  readonly predicates: readonly ApplicationScopeExpression[];
  readonly projectionSource: string;
  readonly projection: (value: unknown) => Readonly<Record<TBoundKey, unknown>>;
}

export type ApplicationBoundOperationInput<TDependency> =
  TDependency extends ApplicationBoundOperation<infer TOperation, infer TBoundKey, 'input' | 'event' | 'resource'>
    ? Omit<ApplicationOperationInput<TOperation>, TBoundKey>
    : TDependency extends ApplicationScopedOperation<infer TOperation, unknown>
      ? ApplicationOperationInput<TOperation>
    : TDependency extends AuthorizableOperation<infer TInput, unknown, unknown>
      ? TInput
      : never;

export type ApplicationBoundOperationOutput<TDependency> =
  TDependency extends ApplicationBoundOperation<infer TOperation, string, 'input' | 'event' | 'resource'>
    ? ApplicationOperationOutput<TOperation>
    : TDependency extends ApplicationScopedOperation<infer TOperation, unknown>
      ? ApplicationOperationOutput<TOperation>
    : TDependency extends AuthorizableOperation<unknown, infer TOutput, unknown>
      ? TOutput
      : never;

export interface AuthorizableOperation<TInput, TOutput, TTarget = unknown> {
  readonly authority: ApplicationOperationAuthorizationContract;
  readonly permission: ApplicationOperationPermission<this>;
  requires(permission: ApplicationPermissionDefinition): this;
  public(): this;
  all(): ApplicationScopedOperation<this, TTarget>;
  on(target: ApplicationModelReference<TTarget>): ApplicationScopedOperation<this, TTarget>;
  where(scope: ApplicationModelScopePredicate<TTarget>): ApplicationOperationScopeBuilder<this, TTarget>;
  authorize(options: ApplicationAuthorizationLifetime): this;
}

export interface ApplicationMutationState<TInput, TOutput> {
  (input: TInput): Promise<TOutput>;
  readonly pending: boolean;
  readonly paused: boolean;
  readonly data: TOutput | undefined;
  readonly error: Error | undefined;
  readonly submittedAt: number | undefined;
  readonly transport: 'idle' | 'submitting' | 'acknowledged' | 'failed';
  readonly durableResult: 'unknown' | 'pending' | 'succeeded' | 'rejected' | 'failed';
  readonly observation:
    | { readonly state: 'notDeclared' }
    | { readonly state: 'pending'; readonly identity?: unknown }
    | { readonly state: 'matched'; readonly snapshot?: unknown }
    | { readonly state: 'failed'; readonly error: Error };
  reset(): void;
}

export interface ApplicationMutationHookOptions<TInput> {
  readonly commandId?: () => string;
  readonly idempotencyKey?: (input: TInput) => string;
  readonly expectedRevision?: (input: TInput) => string | undefined;
}

export interface ApplicationOperation<TInput, TOutput, TTarget = unknown> extends AuthorizableOperation<TInput, TOutput, TTarget> {
  (input: TInput): Promise<TOutput>;
  readonly [applicationOperationContract]: ApplicationOperationContract;
  readonly [applicationOperationSchemas]?: ApplicationOperationSchemaBinding<TInput, TOutput>;
  readonly operation: ApplicationOperationContract;
}

export interface ApplicationMutationOperation<TInput, TOutput, TTarget = unknown> extends ApplicationOperation<TInput, TOutput, TTarget> {
  useMutation(options?: ApplicationMutationHookOptions<TInput>): ApplicationMutationState<TInput, TOutput>;
}

export interface ApplicationQueryInvocation<TValue> {
  readonly operation: ApplicationOperationContract;
  readonly input: unknown;
  snapshot(): Promise<ApplicationQuerySnapshot<TValue>>;
  preload(): Promise<TValue>;
  useQuery(): ApplicationQueryOperationState<TValue>;
  useSuspenseQuery(): ApplicationQuerySuspenseResult<TValue>;
}

export interface ApplicationQueryOperationState<TValue> {
  readonly phase: 'idle' | 'loading' | 'ready' | 'reconnecting' | 'error';
  readonly data: TValue | undefined;
  readonly error: Error | undefined;
  readonly stale: boolean;
  readonly revision: number;
  refresh(): Promise<void>;
}

export interface ApplicationQuerySuspenseResult<TValue> {
  readonly data: TValue;
  readonly stale: boolean;
  readonly revision: number;
  refresh(): Promise<void>;
}

export interface ApplicationQueryOperation<TInput, TValue, TTarget = unknown> extends AuthorizableOperation<TInput, TValue, TTarget> {
  (input: TInput): ApplicationQueryInvocation<TValue>;
  readonly [applicationOperationContract]: ApplicationOperationContract;
  readonly [applicationOperationSchemas]?: ApplicationOperationSchemaBinding<TInput, TValue>;
  readonly operation: ApplicationOperationContract;
}

export interface ApplicationOperationLike {
  readonly [applicationOperationContract]: ApplicationOperationContract;
  readonly [applicationOperationSchemas]?: ApplicationOperationSchemaBinding;
  readonly operation: ApplicationOperationContract;
  readonly authority: ApplicationOperationAuthorizationContract;
}

export interface ApplicationOperationRuntime {
  execute<TInput, TOutput>(operation: ApplicationOperationContract, input: TInput): Promise<TOutput>;
  snapshotQuery?<TInput, TValue>(operation: ApplicationOperationContract, input: TInput): Promise<ApplicationQuerySnapshot<TValue>>;
}

export type ApplicationMutationHook = <TInput, TOutput>(
  operation: ApplicationOperationContract,
  options?: ApplicationMutationHookOptions<TInput>,
) => ApplicationMutationState<TInput, TOutput>;

export type ApplicationQueryHook = <TInput, TValue>(
  operation: ApplicationOperationContract,
  input: TInput,
  suspense: boolean,
) => ApplicationQueryOperationState<TValue> | ApplicationQuerySuspenseResult<TValue>;

const installedMutationHooks: ApplicationMutationHook[] = [];
const installedQueryHooks: ApplicationQueryHook[] = [];
const installedRuntimes: ApplicationOperationRuntime[] = [];
const installedRuntimeResolvers: Array<() => ApplicationOperationRuntime | undefined> = [];
const operationAuthorityObservers = new WeakMap<object, Set<(authority: ApplicationOperationAuthorizationContract) => void>>();
let defaultBrowserRuntime: ApplicationOperationRuntime | undefined;
let defaultBrowserBaseUrl = '/__applik8s/v1';

/** Configures the authority used by direct browser operations and pre-React route loaders. Call during application bootstrap. */
export function configureDefaultApplicationBrowserRuntime(options: { readonly baseUrl: string }): void {
  const baseUrl = options.baseUrl.trim().replace(/\/$/, '');
  if (!baseUrl) throw new Error('Default application browser runtime baseUrl must not be empty.');
  if (defaultBrowserRuntime && baseUrl !== defaultBrowserBaseUrl) {
    throw new Error('Default application browser runtime was already used and cannot change authority. Configure it before invoking an operation or route loader.');
  }
  defaultBrowserBaseUrl = baseUrl;
}

export function installApplicationMutationHook(hook: ApplicationMutationHook): () => void {
  installedMutationHooks.push(hook);
  return removableInstallation(installedMutationHooks, hook);
}

export function installApplicationQueryHook(hook: ApplicationQueryHook): () => void {
  installedQueryHooks.push(hook);
  return removableInstallation(installedQueryHooks, hook);
}

export function installApplicationOperationRuntime(runtime: ApplicationOperationRuntime): () => void {
  installedRuntimes.push(runtime);
  return removableInstallation(installedRuntimes, runtime);
}

export function installApplicationOperationRuntimeResolver(
  resolver: () => ApplicationOperationRuntime | undefined,
): () => void {
  installedRuntimeResolvers.push(resolver);
  return removableInstallation(installedRuntimeResolvers, resolver);
}

/** Compiler-authoring bridge. Runtime adapters should consume the serialized catalog instead. */
export function observeApplicationOperationAuthority(
  operation: ApplicationOperationLike,
  observer: (authority: ApplicationOperationAuthorizationContract) => void,
): () => void {
  const key = operation as object;
  const observers = operationAuthorityObservers.get(key) ?? new Set();
  observers.add(observer);
  operationAuthorityObservers.set(key, observers);
  observer(operation.authority);
  return () => {
    observers.delete(observer);
    if (observers.size === 0) operationAuthorityObservers.delete(key);
  };
}

export function createApplicationMutationOperation<TInput, TOutput, TTarget = unknown>(
  contract: ApplicationOperationContract,
  invoke?: (input: TInput) => Promise<TOutput>,
  schemas?: ApplicationOperationSchemaBinding<TInput, TOutput>,
): ApplicationMutationOperation<TInput, TOutput, TTarget> {
  const callable = ((input: TInput) => {
    if (invoke) return invoke(input);
    const runtime = currentOperationRuntime();
    if (!runtime) {
      throw new Error(`Application operation ${contract.id} has no active runtime. Install a request, browser, handler, command-processor, or deterministic test runtime before invoking it.`);
    }
    return runtime.execute<TInput, TOutput>(contract, input);
  }) as ApplicationMutationOperation<TInput, TOutput, TTarget>;
  return decorateApplicationMutationOperation(callable, contract, schemas);
}

/** Creates a direct callable whose authority is an authenticated server runtime rather than a durable command processor. */
export function createApplicationRuntimeOperation<TInput, TOutput, TTarget = unknown>(
  contract: ApplicationOperationContract,
  invoke?: (input: TInput) => Promise<TOutput>,
  schemas?: ApplicationOperationSchemaBinding<TInput, TOutput>,
): ApplicationOperation<TInput, TOutput, TTarget> {
  assertApplicationOperationContract(contract);
  if (contract.transport !== 'runtime') throw new Error(`Application runtime operation ${contract.id} must use runtime transport.`);
  const callable = ((input: TInput) => {
    if (invoke) return invoke(input);
    const runtime = currentOperationRuntime();
    if (!runtime) throw new Error(`Application runtime operation ${contract.id} has no active authenticated runtime.`);
    return runtime.execute<TInput, TOutput>(contract, input);
  }) as ApplicationOperation<TInput, TOutput, TTarget>;
  const decorated = decorateAuthorizableOperation(callable, contract);
  if (schemas) bindApplicationOperationSchemas(decorated, schemas);
  return decorated;
}

export function createApplicationQueryOperation<TInput, TValue, TTarget = unknown>(
  contract: ApplicationOperationContract,
  authority?: {
    readonly snapshot: (operation: ApplicationOperationContract, input: TInput) => Promise<ApplicationQuerySnapshot<TValue>>;
  },
  schemas?: ApplicationOperationSchemaBinding<TInput, TValue>,
): ApplicationQueryOperation<TInput, TValue, TTarget> {
  assertApplicationOperationContract(contract);
  if (contract.transport !== 'query' || contract.operation !== 'query') {
    throw new Error(`Application query operation ${contract.id} must use query transport and query operation metadata.`);
  }
  const callable = ((input: TInput): ApplicationQueryInvocation<TValue> => ({
    operation: contract,
    input,
    async snapshot(): Promise<ApplicationQuerySnapshot<TValue>> {
      if (authority) return authority.snapshot(contract, input);
      const runtime = currentOperationRuntime();
      if (!runtime?.snapshotQuery) {
        throw new Error(`Application query ${contract.id} has no active query runtime. Install a request, browser, or deterministic test runtime before preloading it.`);
      }
      return runtime.snapshotQuery<TInput, TValue>(contract, input);
    },
    async preload(): Promise<TValue> {
      return (await this.snapshot()).value;
    },
    useQuery(): ApplicationQueryOperationState<TValue> {
      const hook = installedQueryHooks.at(-1);
      if (!hook) {
        throw new Error(`Application query ${contract.id} requires a React query adapter. Import @applik8s/react before calling useQuery().`);
      }
      return hook<TInput, TValue>(contract, input, false) as ApplicationQueryOperationState<TValue>;
    },
    useSuspenseQuery(): ApplicationQuerySuspenseResult<TValue> {
      const hook = installedQueryHooks.at(-1);
      if (!hook) {
        throw new Error(`Application query ${contract.id} requires a React query adapter. Import @applik8s/react before calling useSuspenseQuery().`);
      }
      return hook<TInput, TValue>(contract, input, true) as ApplicationQuerySuspenseResult<TValue>;
    },
  })) as ApplicationQueryOperation<TInput, TValue, TTarget>;
  const decorated = decorateAuthorizableOperation(callable, contract);
  if (schemas) bindApplicationOperationSchemas(decorated, schemas);
  return decorated;
}

export function attachApplicationOperations<
  TModel extends object,
  TOperations extends Readonly<Record<string, ApplicationOperationLike>>,
>(model: TModel, operations: TOperations): TModel & TOperations {
  for (const [name, operation] of Object.entries(operations)) {
    if (name in model) {
      throw new Error(`Application model operation ${String(Reflect.get(operation, 'operation')?.id ?? name)} cannot replace existing model member ${name}.`);
    }
    Object.defineProperty(model, name, {
      value: operation,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
  return model as TModel & TOperations;
}

export function decorateApplicationMutationOperation<TInput, TOutput, TTarget = unknown>(
  callable: (input: TInput) => Promise<TOutput>,
  contract: ApplicationOperationContract,
  schemas?: ApplicationOperationSchemaBinding<TInput, TOutput>,
): ApplicationMutationOperation<TInput, TOutput, TTarget> {
  assertApplicationOperationContract(contract);
  const existing = Reflect.get(callable, applicationOperationContract) as ApplicationOperationContract | undefined;
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(contract)) {
      throw new Error(`Application operation ${existing.id} cannot be rebound as ${contract.id}.`);
    }
    const decorated = callable as ApplicationMutationOperation<TInput, TOutput, TTarget>;
    if (schemas) bindApplicationOperationSchemas(decorated, schemas);
    return decorated;
  }
  const decorated = decorateAuthorizableOperation(callable as ApplicationMutationOperation<TInput, TOutput, TTarget>, contract);
  Object.defineProperties(decorated, {
    useMutation: {
      value: (options?: ApplicationMutationHookOptions<TInput>) => {
        const hook = installedMutationHooks.at(-1);
        if (!hook) {
          throw new Error(`Application operation ${contract.id} requires a React mutation adapter. Import @applik8s/react before calling useMutation().`);
        }
        return hook<TInput, TOutput>(contract, options);
      },
      enumerable: false,
    },
  });
  if (schemas) bindApplicationOperationSchemas(decorated, schemas);
  return decorated;
}

export function bindApplicationOperationSchemas<TInput, TOutput>(
  operation: ApplicationOperation<TInput, TOutput> | ApplicationQueryOperation<TInput, TOutput>,
  schemas: ApplicationOperationSchemaBinding<TInput, TOutput>,
): void {
  const existing = Reflect.get(operation, applicationOperationSchemas) as
    | ApplicationOperationSchemaBinding<TInput, TOutput>
    | undefined;
  if (existing) {
    if (existing.input !== schemas.input || existing.output !== schemas.output) {
      throw new Error(`Application operation ${operation.operation.id} cannot be rebound to different authoring schemas.`);
    }
    return;
  }
  Object.defineProperty(operation, applicationOperationSchemas, {
    value: Object.freeze({ input: schemas.input, output: schemas.output }),
    enumerable: false,
    configurable: false,
    writable: false,
  });
}

export function getApplicationOperationSchemas<TInput, TOutput>(
  operation: ApplicationOperation<TInput, TOutput> | ApplicationQueryOperation<TInput, TOutput>,
): ApplicationOperationSchemaBinding<TInput, TOutput> | undefined {
  return Reflect.get(operation, applicationOperationSchemas) as
    | ApplicationOperationSchemaBinding<TInput, TOutput>
    | undefined;
}

export function getApplicationOperationContract(value: unknown): ApplicationOperationContract | undefined {
  if (typeof value !== 'function') return undefined;
  return Reflect.get(value, applicationOperationContract) as ApplicationOperationContract | undefined;
}

function assertApplicationOperationContract(contract: ApplicationOperationContract): void {
  if (!contract.id || !contract.model || !contract.name) throw new Error('Application operations require stable id, model, and name values.');
  if (/\s/.test(contract.id)) throw new Error(`Application operation id ${contract.id} must not contain whitespace.`);
}

function decorateAuthorizableOperation<
  TOperation extends ((input: never) => unknown) | ApplicationOperation<unknown, unknown> | ApplicationQueryOperation<unknown, unknown>,
>(callable: TOperation, contract: ApplicationOperationContract): TOperation {
  let current = freezeOperationContract(contract);
  const authority = (): ApplicationOperationAuthorizationContract => current.authority ?? defaultOperationAuthority();
  const updateAuthority = (
    update: (value: ApplicationOperationAuthorizationContract) => ApplicationOperationAuthorizationContract,
  ): void => {
    current = freezeOperationContract({ ...current, authority: update(authority()) });
    for (const observer of operationAuthorityObservers.get(callable) ?? []) observer(authority());
  };
  Object.defineProperties(callable, {
    [applicationOperationContract]: { get: () => current, enumerable: false },
    operation: { get: () => current, enumerable: false },
    authority: { get: authority, enumerable: false },
    permission: {
      get: () => Object.freeze({ operation: callable, operationId: current.id }),
      enumerable: false,
    },
    requires: {
      value: (permission: ApplicationPermissionDefinition) => {
        if (!permission.id.trim()) throw new Error(`Application operation ${current.id} requires a stable permission id.`);
        updateAuthority((value) => ({
          ...value,
          classification: 'assigned',
          permissionIds: [...new Set([...value.permissionIds, permission.id])],
        }));
        return callable;
      },
      enumerable: false,
    },
    public: {
      value: () => {
        updateAuthority((value) => ({
          ...value,
          classification: 'public',
          permissionIds: [],
          grantable: false,
          delegable: false,
        }));
        return callable;
      },
      enumerable: false,
    },
    all: {
      value: () => createScopedOperation(callable, { kind: 'all' }, []),
      enumerable: false,
    },
    on: {
      value: (target: ApplicationModelReference) => {
        if (!target.model.trim() || Object.keys(target.identity).length === 0) {
          throw new Error(`Application operation ${current.id} exact target requires a model and identity.`);
        }
        return createScopedOperation(callable, {
          kind: 'target',
          model: target.model,
          identity: target.identity,
        }, []);
      },
      enumerable: false,
    },
    where: {
      value: <TTarget>(predicate: ApplicationModelScopePredicate<TTarget>) =>
        createScopedOperation(callable, { kind: 'all' }, [captureScopePredicate(predicate)], true),
      enumerable: false,
    },
    authorize: {
      value: (options: ApplicationAuthorizationLifetime) => {
        if (options.maximumUses !== undefined && (!Number.isInteger(options.maximumUses) || options.maximumUses < 1)) {
          throw new Error(`Application operation ${current.id} maximumUses must be a positive integer.`);
        }
        updateAuthority((value) => ({
          ...value,
          classification: value.classification === 'unclassified' ? 'runtime-grantable' : value.classification,
          grantable: true,
          lifetime: Object.freeze({ ...options }),
        }));
        return callable;
      },
      enumerable: false,
    },
  });
  return callable;
}

function createScopedOperation<TOperation, TTarget = unknown>(
  operation: TOperation,
  target: ApplicationScopeExpression,
  predicates: readonly ApplicationScopeExpression[],
  selectable = false,
): ApplicationScopedOperation<TOperation, TTarget> | ApplicationOperationScopeBuilder<TOperation, TTarget> {
  const scoped: ApplicationScopedOperation<TOperation, TTarget> & Partial<ApplicationOperationScopeBuilder<TOperation, TTarget>> = {
    operation,
    target,
    predicates: Object.freeze([...predicates]),
    where(predicate: ApplicationModelScopePredicate<TTarget>) {
      return createScopedOperation<TOperation, TTarget>(operation, target, [...predicates, captureScopePredicate(predicate)]) as ApplicationScopedOperation<TOperation, TTarget>;
    },
    onInput: (projection) => createBoundOperation(operation, 'input', target, predicates, projection),
    onEvent: (projection) => createBoundOperation(operation, 'event', target, predicates, projection),
    onResource: (projection) => createBoundOperation(operation, 'resource', target, predicates, projection),
  };
  if (selectable) {
    scoped.all = () => createScopedOperation<TOperation, TTarget>(operation, { kind: 'all' }, predicates) as ApplicationScopedOperation<TOperation, TTarget>;
    scoped.on = (reference) => createScopedOperation(operation, {
      kind: 'target',
      model: reference.model,
      identity: reference.identity,
    }, predicates) as ApplicationScopedOperation<TOperation, TTarget>;
  }
  return Object.freeze(scoped) as ApplicationScopedOperation<TOperation, TTarget> | ApplicationOperationScopeBuilder<TOperation, TTarget>;
}

function createBoundOperation<
  TOperation,
  TSource extends 'input' | 'event' | 'resource',
  const TBound extends Readonly<Record<string, unknown>>,
>(
  operation: TOperation,
  source: TSource,
  target: ApplicationScopeExpression,
  predicates: readonly ApplicationScopeExpression[],
  projection: (value: never) => TBound,
): ApplicationBoundOperation<TOperation, keyof TBound & string, TSource> {
  const captured = projection(pathCaptureProxy() as never);
  if (!captured || typeof captured !== 'object' || Array.isArray(captured)) {
    throw new Error(`Application operation ${String(Reflect.get(operation as object, 'operation')?.id ?? '<unknown>')} ${source} binding must return an object with a fixed key set.`);
  }
  const boundKeys = Object.keys(captured);
  if (boundKeys.length === 0) throw new Error('Application operation execution binding must bind at least one input key.');
  return Object.freeze({
    operation,
    source,
    boundKeys,
    target,
    predicates: Object.freeze([...predicates]),
    projectionSource: projection.toString(),
    projection: projection as (value: unknown) => Readonly<Record<keyof TBound & string, unknown>>,
  });
}

export function isApplicationBoundOperation(
  value: unknown,
): value is ApplicationBoundOperation<ApplicationOperationLike, string, 'input' | 'event' | 'resource'> {
  return Boolean(
    value
    && typeof value === 'object'
    && Reflect.get(value, 'source')
    && Array.isArray(Reflect.get(value, 'boundKeys'))
    && typeof Reflect.get(value, 'projection') === 'function'
    && Reflect.get(value, 'operation'),
  );
}

export function isApplicationScopedOperation(
  value: unknown,
): value is ApplicationScopedOperation<ApplicationOperationLike, unknown> {
  return Boolean(
    value
    && typeof value === 'object'
    && !isApplicationBoundOperation(value)
    && Reflect.get(value, 'operation')
    && Reflect.get(value, 'target')
    && Array.isArray(Reflect.get(value, 'predicates')),
  );
}

/**
 * Completes an execution-bound operation input. The caller-supplied object is
 * checked before projection or merge so stale JavaScript cannot override a
 * field whose provenance belongs to the admitted execution.
 */
export function completeApplicationBoundOperationInput(
  dependency: ApplicationBoundOperation<ApplicationOperationLike, string, 'input' | 'event' | 'resource'>,
  executionSource: unknown,
  supplied: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) {
    throw new ApplicationBoundFieldOverrideError(
      String(dependency.operation.operation.id),
      dependency.boundKeys,
      'Operation alias input must be an object.',
    );
  }
  const overridden = dependency.boundKeys.filter((key) => Object.hasOwn(supplied, key));
  if (overridden.length > 0) {
    throw new ApplicationBoundFieldOverrideError(
      String(dependency.operation.operation.id),
      overridden,
      `Caller input attempts to override execution-bound field(s): ${overridden.join(', ')}.`,
    );
  }
  const bound = dependency.projection(executionSource);
  if (!bound || typeof bound !== 'object' || Array.isArray(bound)) {
    throw new ApplicationBoundFieldOverrideError(
      String(dependency.operation.operation.id),
      dependency.boundKeys,
      'Execution binding projection did not return an object.',
    );
  }
  const keys = Object.keys(bound).sort();
  const expected = [...dependency.boundKeys].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new ApplicationBoundFieldOverrideError(
      String(dependency.operation.operation.id),
      dependency.boundKeys,
      `Execution binding returned a variable key set; expected ${expected.join(', ')}, received ${keys.join(', ')}.`,
    );
  }
  return Object.freeze({ ...supplied, ...bound });
}

export class ApplicationBoundFieldOverrideError extends Error {
  readonly code = 'AUTHORITY_BOUND_FIELD_OVERRIDE';
  readonly operationId: string;
  readonly boundKeys: readonly string[];

  constructor(operationId: string, boundKeys: readonly string[], message: string) {
    super(`${message} (${operationId})`);
    this.name = 'ApplicationBoundFieldOverrideError';
    this.operationId = operationId;
    this.boundKeys = Object.freeze([...boundKeys]);
  }
}

function captureScopePredicate<TTarget>(
  predicate: ApplicationModelScopePredicate<TTarget>,
): ApplicationScopeExpression {
  const expression = predicate(scopeFieldsProxy<TTarget>());
  if (!expression || typeof expression !== 'object' || typeof expression.kind !== 'string') {
    throw new Error('Application operation where(...) must return one serializable scope expression.');
  }
  return expression;
}

function scopeFieldsProxy<TTarget>(path: readonly string[] = []): ApplicationModelScopeFields<TTarget> {
  return new Proxy({}, {
    get(_target, property) {
      if (typeof property !== 'string') return undefined;
      const field = [...path, property].join('.');
      const comparator: ApplicationScopeComparator = {
        eq: (value) => comparisonScope(field, 'eq', value),
        ne: (value) => comparisonScope(field, 'ne', value),
        lt: (value) => comparisonScope(field, 'lt', value),
        lte: (value) => comparisonScope(field, 'lte', value),
        gt: (value) => comparisonScope(field, 'gt', value),
        gte: (value) => comparisonScope(field, 'gte', value),
        in: (...values) => ({ kind: 'in', field, values: values.map(scopeValue) }),
      };
      return comparator;
    },
  }) as ApplicationModelScopeFields<TTarget>;
}

function comparisonScope(
  field: string,
  operator: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte',
  value: ApplicationScopeValueInput,
): ApplicationScopeExpression {
  return { kind: 'compare', field, operator, value: scopeValue(value) };
}

function scopeValue(value: ApplicationScopeValueInput): Extract<ApplicationScopeExpression, { readonly kind: 'compare' }>['value'] {
  return typeof value === 'object' && value !== null
    ? { kind: 'reference', source: value.source, path: value.path }
    : { kind: 'literal', value };
}

function pathCaptureProxy(path: readonly string[] = []): object {
  return new Proxy(Object.freeze({}), {
    get(_target, property) {
      if (property === Symbol.toPrimitive) return () => path.join('.');
      if (property === 'toJSON') return () => ({ __applik8sPath: path.join('.') });
      if (typeof property !== 'string') return undefined;
      return pathCaptureProxy([...path, property]);
    },
  });
}

function defaultOperationAuthority(): ApplicationOperationAuthorizationContract {
  return Object.freeze({
    classification: 'unclassified',
    permissionIds: Object.freeze([]),
    grantable: false,
    delegable: false,
    scope: Object.freeze({ kind: 'all' }),
  });
}

function freezeOperationContract(contract: ApplicationOperationContract): ApplicationOperationContract {
  return Object.freeze({
    ...contract,
    ...(contract.authority ? {
      authority: Object.freeze({
        ...contract.authority,
        permissionIds: Object.freeze([...contract.authority.permissionIds]),
      }),
    } : {}),
  });
}

function currentOperationRuntime(): ApplicationOperationRuntime | undefined {
  for (let index = installedRuntimeResolvers.length - 1; index >= 0; index -= 1) {
    const runtime = installedRuntimeResolvers[index]?.();
    if (runtime) return runtime;
  }
  if (installedRuntimes.length > 1) {
    throw new Error(
      'Application operation runtime is ambiguous because multiple browser authorities are active. '
      + 'Use the React-bound useMutation()/useQuery() operation or remove the overlapping provider.',
    );
  }
  return installedRuntimes.at(-1) ?? browserOperationRuntime();
}

function browserOperationRuntime(): ApplicationOperationRuntime | undefined {
  if (typeof window === 'undefined') return undefined;
  if (defaultBrowserRuntime) return defaultBrowserRuntime;
  const commandClient = new ApplicationCommandClient(createHttpApplicationCommandTransport({ baseUrl: defaultBrowserBaseUrl }));
  const queryClient = new ApplicationQueryClient(createHttpApplicationQueryTransport({ baseUrl: defaultBrowserBaseUrl }));
  const runtimeClient = createHttpApplicationRuntimeTransport({ baseUrl: defaultBrowserBaseUrl });
  defaultBrowserRuntime = {
    execute(operation, input) {
      if (operation.transport === 'command') return commandClient.execute(operation.id, input);
      if (operation.transport === 'runtime') return runtimeClient.execute(operation, input);
      throw new Error(`Default browser operation ${operation.id} cannot execute ${operation.transport} through a mutation transport.`);
    },
    async snapshotQuery<TInput, TValue>(operation: ApplicationOperationContract, input: TInput): Promise<ApplicationQuerySnapshot<TValue>> {
      if (operation.transport !== 'query') throw new Error(`Default browser preload ${operation.id} cannot execute ${operation.transport} through the query transport.`);
      const snapshot = await queryClient.transport.snapshot<TInput, TValue>(operation.id, input);
      queryClient.hydrate([snapshot]);
      return snapshot;
    },
  };
  return defaultBrowserRuntime;
}

function removableInstallation<T>(installations: T[], value: T): () => void {
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    const index = installations.lastIndexOf(value);
    if (index >= 0) installations.splice(index, 1);
  };
}
