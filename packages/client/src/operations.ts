// typecast-file-boundary: operation decorators preserve generic input/output associations while installing runtime metadata on callable functions.
import type { ApplicationQuerySnapshot } from './protocol.js';
import { ApplicationCommandClient } from './command-store.js';
import { createHttpApplicationCommandTransport } from './command-http-transport.js';
import { createHttpApplicationQueryTransport } from './http-transport.js';
import { createHttpApplicationRuntimeTransport } from './runtime-http-transport.js';
import { ApplicationQueryClient } from './store.js';

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

const installedMutationHooks: ApplicationMutationHook[] = [];
const installedQueryHooks: ApplicationQueryHook[] = [];
const installedRuntimes: ApplicationOperationRuntime[] = [];
const installedRuntimeResolvers: Array<() => ApplicationOperationRuntime | undefined> = [];
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

export function createApplicationMutationOperation<TInput, TOutput>(
  contract: ApplicationOperationContract,
  invoke?: (input: TInput) => Promise<TOutput>,
): ApplicationMutationOperation<TInput, TOutput> {
  const callable = ((input: TInput) => {
    if (invoke) return invoke(input);
    const runtime = currentOperationRuntime();
    if (!runtime) {
      throw new Error(`Application operation ${contract.id} has no active runtime. Install a request, browser, handler, command-processor, or deterministic test runtime before invoking it.`);
    }
    return runtime.execute<TInput, TOutput>(contract, input);
  }) as ApplicationMutationOperation<TInput, TOutput>;
  return decorateApplicationMutationOperation(callable, contract);
}

/** Creates a direct callable whose authority is an authenticated server runtime rather than a durable command processor. */
export function createApplicationRuntimeOperation<TInput, TOutput>(
  contract: ApplicationOperationContract,
  invoke?: (input: TInput) => Promise<TOutput>,
): ApplicationOperation<TInput, TOutput> {
  assertApplicationOperationContract(contract);
  if (contract.transport !== 'runtime') throw new Error(`Application runtime operation ${contract.id} must use runtime transport.`);
  const callable = ((input: TInput) => {
    if (invoke) return invoke(input);
    const runtime = currentOperationRuntime();
    if (!runtime) throw new Error(`Application runtime operation ${contract.id} has no active authenticated runtime.`);
    return runtime.execute<TInput, TOutput>(contract, input);
  }) as ApplicationOperation<TInput, TOutput>;
  const frozen = Object.freeze({ ...contract });
  Object.defineProperties(callable, {
    [applicationOperationContract]: { value: frozen, enumerable: false },
    operation: { value: frozen, enumerable: false },
  });
  return callable;
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
        const hook = installedMutationHooks.at(-1);
        if (!hook) {
          throw new Error(`Application operation ${contract.id} requires a React mutation adapter. Import @applik8s/react before calling useMutation().`);
        }
        return hook<TInput, TOutput>(contract, options);
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
  if (/\s/.test(contract.id)) throw new Error(`Application operation id ${contract.id} must not contain whitespace.`);
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
