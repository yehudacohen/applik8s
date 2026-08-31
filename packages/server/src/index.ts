// typecast-file-boundary: symbol-keyed process registries bridge separately bundled server chunks while preserving request-runtime identity.
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  type ApplicationCommandClient,
  createApplicationAgentClient,
  createApplicationAgentHttpRuntime,
  type ApplicationAgentClientContract,
  type ApplicationAgentInvocationOptions,
  installApplicationAgentInvocationRuntimeResolver,
  type ApplicationOperationContract,
  type ApplicationOperationRuntime,
  type ApplicationQueryClient,
  type ApplicationQueryOperation,
  type ApplicationQuerySnapshot,
  createApplicationQueryOperation,
  installApplicationOperationRuntimeResolver,
} from '@applik8s/client';

export interface Applik8sServerRequestRuntime {
  readonly request: Request;
  /** Request-scoped same-origin transport supplied by the server adapter. */
  readonly fetch?: typeof globalThis.fetch;
  readonly queryClient: ApplicationQueryClient;
  readonly commandClient: ApplicationCommandClient;
  /** Immediate authenticated operations that do not claim durable-command semantics. */
  readonly runtimeClient?: ApplicationOperationRuntime;
}

const requestScope = new AsyncLocalStorage<Applik8sServerRequestRuntime>();
const requestRuntimeResolversKey = Symbol.for('@applik8s/server/request-runtime-resolvers');
type RequestRuntimeResolver = () => Applik8sServerRequestRuntime | undefined;

/**
 * Server frameworks commonly split their request adapter and SSR route modules
 * into separate chunks. Each chunk can contain its own bundled copy of this
 * package, so module-local resolver storage makes an adapter installed by the
 * host invisible to the SSR copy. A symbol-keyed process-local registry keeps
 * those copies joined without putting request or identity data in global
 * state; the resolver itself still reads the framework's async request scope.
 */
function requestRuntimeResolvers(): RequestRuntimeResolver[] {
  const state = globalThis as typeof globalThis & { [requestRuntimeResolversKey]?: RequestRuntimeResolver[] };
  const existing = state[requestRuntimeResolversKey];
  if (existing) return existing;
  const resolvers: RequestRuntimeResolver[] = [];
  state[requestRuntimeResolversKey] = resolvers;
  return resolvers;
}
installApplicationOperationRuntimeResolver(() => {
  const runtime = resolvedServerRequestRuntime();
  if (!runtime) return undefined;
  return {
    execute(operation, input) {
      if (operation.transport === 'command') return runtime.commandClient.execute(operation.id, input);
      if (operation.transport === 'runtime' && runtime.runtimeClient) return runtime.runtimeClient.execute(operation, input);
      throw new Error(`Request-scoped operation ${operation.id} cannot execute ${operation.transport} through the installed server runtime.`);
    },
    async snapshotQuery<TInput, TValue>(operation: ApplicationOperationContract, input: TInput): Promise<ApplicationQuerySnapshot<TValue>> {
      if (operation.transport !== 'query') throw new Error(`Request-scoped preload ${operation.id} cannot execute ${operation.transport} through the query runtime.`);
      const snapshot = await runtime.queryClient.transport.snapshot<TInput, TValue>(operation.id, input);
      runtime.queryClient.hydrate([snapshot]);
      return snapshot;
    },
  };
});
installApplicationAgentInvocationRuntimeResolver(() => {
  const runtime = resolvedServerRequestRuntime();
  if (!runtime) return undefined;
  return createApplicationAgentHttpRuntime({
    baseUrl: runtime.request.url,
    ...(runtime.fetch ? { fetch: runtime.fetch } : {}),
  });
});

export function runWithApplik8sServerRequest<TResult>(runtime: Applik8sServerRequestRuntime, handler: () => TResult): TResult {
  return requestScope.run(runtime, handler);
}

export function currentApplik8sServerRequest(): Applik8sServerRequestRuntime {
  const runtime = resolvedServerRequestRuntime();
  if (!runtime) throw new Error('No framework-neutral Applik8s server request runtime is active.');
  return runtime;
}

/** Installs a framework adapter that can recover the currently active request. */
export function installApplik8sServerRequestRuntimeResolver(
  resolver: () => Applik8sServerRequestRuntime | undefined,
): () => void {
  const resolvers = requestRuntimeResolvers();
  resolvers.push(resolver);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    const index = resolvers.lastIndexOf(resolver);
    if (index >= 0) resolvers.splice(index, 1);
  };
}

export function createApplik8sServerQueryOperation<TInput, TValue>(
  contract: ApplicationOperationContract,
): ApplicationQueryOperation<TInput, TValue> {
  return createApplicationQueryOperation<TInput, TValue>(contract, {
    async snapshot(operation, input) {
      const runtime = resolvedServerRequestRuntime();
      if (runtime) {
        const snapshot = await runtime.queryClient.transport.snapshot<TInput, TValue>(operation.id, input);
        runtime.queryClient.hydrate([snapshot]);
        return snapshot;
      }
      throw new Error(
        `Server snapshot ${operation.id} has no authenticated request runtime. `
        + 'Run inside runWithApplik8sServerRequest() or install the adapter for your server framework.',
      );
    },
  });
}

/**
 * Reconstructs a function-native application agent inside authenticated SSR.
 * The request adapter supplies an in-process, same-origin transport carrying
 * the active principal and trusted context; no public ingress round trip or
 * browser global is required.
 */
export function createApplik8sServerAgentOperation<TInput extends object, TResult>(
  contract: ApplicationAgentClientContract,
): (input: TInput, invocation?: ApplicationAgentInvocationOptions) => Promise<TResult> {
  return async (input, invocation) => {
    const runtime = resolvedServerRequestRuntime();
    if (!runtime) {
      throw new Error(
        `Server agent ${contract.name} has no authenticated request runtime. `
        + 'Run inside runWithApplik8sServerRequest() or install the adapter for your server framework.',
      );
    }
    return createApplicationAgentClient<TInput, TResult>(contract, {
      baseUrl: runtime.request.url,
      ...(runtime.fetch ? { fetch: runtime.fetch } : {}),
    })(input, invocation);
  };
}

function resolvedServerRequestRuntime(): Applik8sServerRequestRuntime | undefined {
  const scoped = requestScope.getStore();
  if (scoped) return scoped;
  const resolvers = requestRuntimeResolvers();
  for (let index = resolvers.length - 1; index >= 0; index -= 1) {
    const runtime = resolvers[index]?.();
    if (runtime) return runtime;
  }
  return undefined;
}
