import { AsyncLocalStorage } from 'node:async_hooks';
import {
  createApplicationQueryOperation,
  installApplicationOperationRuntimeResolver,
  type ApplicationCommandClient,
  type ApplicationOperationContract,
  type ApplicationQueryClient,
  type ApplicationQueryOperation,
  type ApplicationQuerySnapshot,
} from '@applik8s/client';

export {
  createApplik8sKubernetesGateway,
  type Applik8sGatewayAdmission,
  type Applik8sKubernetesCreateContract,
  type Applik8sKubernetesGateway,
  type Applik8sKubernetesGatewayOptions,
  type Applik8sKubernetesQueryContract,
  type Applik8sKubernetesResourceContract,
} from './kubernetes-gateway.js';

export interface Applik8sServerRequestRuntime {
  readonly request: Request;
  readonly queryClient: ApplicationQueryClient;
  readonly commandClient: ApplicationCommandClient;
}

const requestScope = new AsyncLocalStorage<Applik8sServerRequestRuntime>();
installApplicationOperationRuntimeResolver(() => {
  const runtime = requestScope.getStore();
  if (!runtime) return undefined;
  return {
    execute(operation, input) {
      if (operation.transport !== 'command') throw new Error(`Request-scoped operation ${operation.id} cannot execute ${operation.transport} through the command runtime.`);
      return runtime.commandClient.execute(operation.id, input);
    },
    async snapshotQuery<TInput, TValue>(operation: ApplicationOperationContract, input: TInput): Promise<ApplicationQuerySnapshot<TValue>> {
      if (operation.transport !== 'query') throw new Error(`Request-scoped preload ${operation.id} cannot execute ${operation.transport} through the query runtime.`);
      const snapshot = await runtime.queryClient.transport.snapshot<TInput, TValue>(operation.id, input);
      runtime.queryClient.hydrate([snapshot]);
      return snapshot;
    },
  };
});

export function runWithApplik8sServerRequest<TResult>(runtime: Applik8sServerRequestRuntime, handler: () => TResult): TResult {
  return requestScope.run(runtime, handler);
}

export function currentApplik8sServerRequest(): Applik8sServerRequestRuntime {
  const runtime = requestScope.getStore();
  if (!runtime) throw new Error('No framework-neutral Applik8s server request runtime is active.');
  return runtime;
}

export function createApplik8sServerQueryOperation<TInput, TValue>(
  contract: ApplicationOperationContract,
): ApplicationQueryOperation<TInput, TValue> {
  return createApplicationQueryOperation<TInput, TValue>(contract, {
    async snapshot(operation, input) {
      const runtime = requestScope.getStore();
      if (runtime) {
        const snapshot = await runtime.queryClient.transport.snapshot<TInput, TValue>(operation.id, input);
        runtime.queryClient.hydrate([snapshot]);
        return snapshot;
      }
      const port = process.env.PORT ?? '3000';
      const internalBase = process.env.APPLIK8S_INTERNAL_URL ?? `http://127.0.0.1:${port}`;
      const response = await fetch(`${internalBase}/__applik8s/v1/queries/${encodeURIComponent(operation.id)}/snapshot`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ input }),
      });
      if (!response.ok) throw new Error(`Server snapshot request for ${operation.id} failed with HTTP ${response.status}.`);
      // typecast: the versioned gateway validates the snapshot before returning it to the generated server facade.
      return response.json() as Promise<ApplicationQuerySnapshot<TValue>>;
    },
  });
}
