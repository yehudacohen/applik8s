// typecast-file-boundary: TanStack request context is validated and adapted once into the framework-neutral server runtime contract.
import {
  ApplicationCommandClient,
  ApplicationQueryClient,
  createHttpApplicationCommandTransport,
  createHttpApplicationQueryTransport,
  createHttpApplicationRuntimeTransport,
} from '@applik8s/client';
import {
  type ApplicationIdentitySessionView,
  createApplicationIdentityClient,
} from '@applik8s/identity/client';
import {
  type Applik8sServerRequestRuntime,
  currentApplik8sServerRequest,
  installApplik8sServerRequestRuntimeResolver,
} from '@applik8s/server';
import { useRequest } from 'nitro/context';

export interface Applik8sNitroGateway {
  handle(request: Request): Promise<Response> | Response;
}

export interface Applik8sNitroRequestRuntimeOptions {
  readonly gateway: Applik8sNitroGateway;
}

const nitroRequestRuntimes = new WeakMap<Request, Applik8sServerRequestRuntime>();
const resolverDisposerKey = Symbol.for('@applik8s/tanstack-start/nitro-request-runtime-disposer');
const hopByHopHeaders = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/** Connects Nitro's native async request context to the framework-neutral Applik8s server runtime. */
export function installApplik8sNitroRequestRuntime(options: Applik8sNitroRequestRuntimeOptions): () => void {
  // typecast: the symbol-keyed global slot is private to the adapter and contains only the prior resolver disposer.
  const globalState = globalThis as typeof globalThis & { [resolverDisposerKey]?: () => void };
  globalState[resolverDisposerKey]?.();
  const dispose = installApplik8sServerRequestRuntimeResolver(() => {
    let request: Request;
    try {
      // biome-ignore lint/correctness/useHookAtTopLevel: Nitro's useRequest reads async request context; it is not a React hook.
      request = useRequest();
    } catch {
      return undefined;
    }
    const existing = nitroRequestRuntimes.get(request);
    if (existing) return existing;
    const fetch = gatewayFetch(options.gateway, request);
    const runtime: Applik8sServerRequestRuntime = {
      request,
      fetch,
      queryClient: new ApplicationQueryClient(createHttpApplicationQueryTransport({
        baseUrl: new URL('/__applik8s/v1', request.url).href,
        fetch,
      })),
      commandClient: new ApplicationCommandClient(createHttpApplicationCommandTransport({
        baseUrl: new URL('/__applik8s/v1', request.url).href,
        fetch,
      })),
      runtimeClient: createHttpApplicationRuntimeTransport({
        baseUrl: new URL('/__applik8s/v1', request.url).href,
        fetch,
      }),
    };
    nitroRequestRuntimes.set(request, runtime);
    return runtime;
  });
  globalState[resolverDisposerKey] = dispose;
  return () => {
    if (globalState[resolverDisposerKey] === dispose) delete globalState[resolverDisposerKey];
    dispose();
  };
}

/**
 * Loads the provider-neutral identity session through the active request's
 * in-process gateway. The browser never sees provider cookies or native
 * identity payloads, and SSR does not need to loop through the public ingress.
 */
export async function loadApplicationIdentitySession(): Promise<ApplicationIdentitySessionView> {
  const runtime = currentApplik8sServerRequest();
  const client = createApplicationIdentityClient({
    baseUrl: new URL('/__applik8s/v1/identity', runtime.request.url).href,
    ...(runtime.fetch ? { fetch: runtime.fetch } : {}),
  });
  return client.session();
}

function gatewayFetch(gateway: Applik8sNitroGateway, sourceRequest: Request): typeof globalThis.fetch {
  const request = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const outbound = new Request(input, init);
    const headers = new Headers();
    for (const [name, value] of sourceRequest.headers.entries()) {
      if (!hopByHopHeaders.has(name.toLowerCase())) headers.append(name, value);
    }
    for (const [name, value] of outbound.headers.entries()) {
      if (!hopByHopHeaders.has(name.toLowerCase())) headers.set(name, value);
    }
    return gateway.handle(new Request(outbound, { headers }));
  };
  // Node 22's fetch implementation does not expose the optional preconnect
  // helper present in newer DOM typings. Do not let that optimization prevent
  // SSR from constructing its authenticated request-scoped transport.
  const preconnect = Reflect.get(globalThis.fetch, 'preconnect');
  return Object.assign(request, typeof preconnect === 'function'
    ? { preconnect: preconnect.bind(globalThis.fetch) }
    : {}) as typeof globalThis.fetch;
}
