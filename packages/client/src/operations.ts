// typecast-file-boundary: operation decorators preserve generic input/output associations while installing runtime metadata on callable functions.
import type { ApplicationQuerySnapshot } from './protocol.js';

export const applicationOperationContract = Symbol.for('@applik8s/application-operation');

export interface ApplicationOperationContract {
  readonly apiVersion: 'applik8s.operation/v1alpha1';
  readonly kind: 'applicationOperation';
  readonly id: string;
  readonly model: string;
  readonly name: string;
  readonly operation: 'create' | 'get' | 'query' | 'update' | 'delete' | 'custom';
  readonly transport: 'command' | 'query' | 'runtime';
}

export interface ApplicationMutationState<TInput, TOutput> {
  (input: TInput): Promise<TOutput>;
  readonly pending: boolean;
  readonly paused: boolean;
  readonly data: TOutput | undefined;
  readonly error: Error | undefined;
  readonly submittedAt: number | undefined;
  readonly transport: 'idle' | 'submitting' | 'acknowledged' | 'failed';
  readonly durableResult: 'unknown' | 'pending' | 'succeeded' | 'rejected';
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

export interface ApplicationOperation<TInput, TOutput> {
  (input: TInput): Promise<TOutput>;
  readonly [applicationOperationContract]: ApplicationOperationContract;
  readonly operation: ApplicationOperationContract;
}

export interface ApplicationMutationOperation<TInput, TOutput> extends ApplicationOperation<TInput, TOutput> {
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

export interface ApplicationQueryOperation<TInput, TValue> {
  (input: TInput): ApplicationQueryInvocation<TValue>;
  readonly [applicationOperationContract]: ApplicationOperationContract;
  readonly operation: ApplicationOperationContract;
}

export interface ApplicationOperationLike {
  readonly [applicationOperationContract]: ApplicationOperationContract;
  readonly operation: ApplicationOperationContract;
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

let installedMutationHook: ApplicationMutationHook | undefined;
let installedQueryHook: ApplicationQueryHook | undefined;
let installedRuntime: ApplicationOperationRuntime | undefined;
let installedRuntimeResolver: (() => ApplicationOperationRuntime | undefined) | undefined;

export function installApplicationMutationHook(hook: ApplicationMutationHook): () => void {
  const previous = installedMutationHook;
  installedMutationHook = hook;
  return () => {
    if (installedMutationHook === hook) installedMutationHook = previous;
  };
}

export function installApplicationQueryHook(hook: ApplicationQueryHook): () => void {
  const previous = installedQueryHook;
  installedQueryHook = hook;
  return () => {
    if (installedQueryHook === hook) installedQueryHook = previous;
  };
}

export function installApplicationOperationRuntime(runtime: ApplicationOperationRuntime): () => void {
  const previous = installedRuntime;
  installedRuntime = runtime;
  return () => {
    if (installedRuntime === runtime) installedRuntime = previous;
  };
}

export function installApplicationOperationRuntimeResolver(
  resolver: () => ApplicationOperationRuntime | undefined,
): () => void {
  const previous = installedRuntimeResolver;
  installedRuntimeResolver = resolver;
  return () => {
    if (installedRuntimeResolver === resolver) installedRuntimeResolver = previous;
  };
}

export function createApplicationMutationOperation<TInput, TOutput>(
  contract: ApplicationOperationContract,
  invoke?: (input: TInput) => Promise<TOutput>,
): ApplicationMutationOperation<TInput, TOutput> {
  const callable = ((input: TInput) => {
    if (invoke) return invoke(input);
    const runtime = installedRuntimeResolver?.() ?? installedRuntime;
    if (!runtime) {
      throw new Error(`Application operation ${contract.id} has no active runtime. Install a request, browser, handler, command-processor, or deterministic test runtime before invoking it.`);
    }
    return runtime.execute<TInput, TOutput>(contract, input);
  }) as ApplicationMutationOperation<TInput, TOutput>;
  return decorateApplicationMutationOperation(callable, contract);
}

export function createApplicationQueryOperation<TInput, TValue>(
  contract: ApplicationOperationContract,
  authority?: {
    readonly snapshot: (operation: ApplicationOperationContract, input: TInput) => Promise<ApplicationQuerySnapshot<TValue>>;
  },
): ApplicationQueryOperation<TInput, TValue> {
  assertApplicationOperationContract(contract);
  if (contract.transport !== 'query' || contract.operation !== 'query') {
    throw new Error(`Application query operation ${contract.id} must use query transport and query operation metadata.`);
  }
  const callable = ((input: TInput): ApplicationQueryInvocation<TValue> => ({
    operation: contract,
    input,
    async snapshot(): Promise<ApplicationQuerySnapshot<TValue>> {
      if (authority) return authority.snapshot(contract, input);
      const runtime = installedRuntimeResolver?.() ?? installedRuntime;
      if (!runtime?.snapshotQuery) {
        throw new Error(`Application query ${contract.id} has no active query runtime. Install a request, browser, or deterministic test runtime before preloading it.`);
      }
      return runtime.snapshotQuery<TInput, TValue>(contract, input);
    },
    async preload(): Promise<TValue> {
      return (await this.snapshot()).value;
    },
    useQuery(): ApplicationQueryOperationState<TValue> {
      if (!installedQueryHook) {
        throw new Error(`Application query ${contract.id} requires a React query adapter. Import @applik8s/react before calling useQuery().`);
      }
      return installedQueryHook<TInput, TValue>(contract, input, false) as ApplicationQueryOperationState<TValue>;
    },
    useSuspenseQuery(): ApplicationQuerySuspenseResult<TValue> {
      if (!installedQueryHook) {
        throw new Error(`Application query ${contract.id} requires a React query adapter. Import @applik8s/react before calling useSuspenseQuery().`);
      }
      return installedQueryHook<TInput, TValue>(contract, input, true) as ApplicationQuerySuspenseResult<TValue>;
    },
  })) as ApplicationQueryOperation<TInput, TValue>;
  const frozen = Object.freeze({ ...contract });
  Object.defineProperties(callable, {
    [applicationOperationContract]: { value: frozen, enumerable: false },
    operation: { value: frozen, enumerable: false },
  });
  return callable;
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

export function decorateApplicationMutationOperation<TInput, TOutput>(
  callable: (input: TInput) => Promise<TOutput>,
  contract: ApplicationOperationContract,
): ApplicationMutationOperation<TInput, TOutput> {
  assertApplicationOperationContract(contract);
  const existing = Reflect.get(callable, applicationOperationContract) as ApplicationOperationContract | undefined;
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(contract)) {
      throw new Error(`Application operation ${existing.id} cannot be rebound as ${contract.id}.`);
    }
    return callable as ApplicationMutationOperation<TInput, TOutput>;
  }
  const frozen = Object.freeze({ ...contract });
  Object.defineProperties(callable, {
    [applicationOperationContract]: { value: frozen, enumerable: false },
    operation: { value: frozen, enumerable: false },
    useMutation: {
      value: (options?: ApplicationMutationHookOptions<TInput>) => {
        if (!installedMutationHook) {
          throw new Error(`Application operation ${contract.id} requires a React mutation adapter. Import @applik8s/react before calling useMutation().`);
        }
        return installedMutationHook<TInput, TOutput>(contract, options);
      },
      enumerable: false,
    },
  });
  return callable as ApplicationMutationOperation<TInput, TOutput>;
}

export function getApplicationOperationContract(value: unknown): ApplicationOperationContract | undefined {
  if (typeof value !== 'function') return undefined;
  return Reflect.get(value, applicationOperationContract) as ApplicationOperationContract | undefined;
}

function assertApplicationOperationContract(contract: ApplicationOperationContract): void {
  if (!contract.id || !contract.model || !contract.name) throw new Error('Application operations require stable id, model, and name values.');
  if (contract.id !== `${contract.model}.${contract.name}`) {
    throw new Error(`Application operation id ${contract.id} must equal ${contract.model}.${contract.name}.`);
  }
}
