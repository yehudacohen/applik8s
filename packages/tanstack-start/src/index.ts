import type { ApplicationQueryClient, ApplicationQuerySnapshot } from '@applik8s/client';
import {
  app,
  RequestIdentity,
  type ApplicationRequestAdmission,
  type KubernetesApplicationBuilder,
  type SchemaInput,
} from '@applik8s/applik8s';

export {
  ApplicationHost,
  Certificate,
  DnsPublication,
  EventLog,
  HttpExposure,
  IndexStore,
  ModelStore,
} from '@applik8s/applik8s';

export type Applik8sStartAuthentication = ApplicationRequestAdmission;

export type Applik8sAuthenticationHandler = (request: Request) => Applik8sStartAuthentication | Promise<Applik8sStartAuthentication>;

export interface CreateApplik8sStartOptions<TContext extends object> {
  readonly name: string;
  readonly namespace?: string;
  readonly context: SchemaInput<TContext>;
  readonly authenticate: Applik8sAuthenticationHandler;
}

export interface Applik8sStartApplication<TContext extends object = object> extends KubernetesApplicationBuilder {
  readonly start: {
    readonly apiVersion: 'applik8s.start/v1alpha1';
    readonly context: SchemaInput<TContext>;
    readonly authenticate: Applik8sAuthenticationHandler;
  };
}

/** Creates the dependency root shared by Start routes, model declarations, discovery, and generated hosting. */
export function createApplik8sStart<TContext extends object>(options: CreateApplik8sStartOptions<TContext>): Applik8sStartApplication<TContext> {
  if (!options.name.trim()) throw new Error('createApplik8sStart({ name }) must not be empty.');
  const application = app(options.name, options.namespace ? { namespace: options.namespace } : {});
  application.provide(RequestIdentity, RequestIdentity.from(options.authenticate));
  Object.defineProperty(application, 'start', {
    value: Object.freeze({
      apiVersion: 'applik8s.start/v1alpha1',
      context: options.context,
      authenticate: options.authenticate,
    }),
    enumerable: false,
    configurable: false,
    writable: false,
  });
  // typecast: the immutable start metadata was just installed on this Kubernetes application builder.
  return application as Applik8sStartApplication<TContext>;
}

export interface ApplicationQueryLoaderResult<TValue = unknown> {
  readonly applik8s: readonly ApplicationQuerySnapshot<TValue>[];
}

/** Prefetches a query for a TanStack Start route loader and returns serializable hydration state. */
export async function preloadApplicationQuery<TInput, TValue>(client: ApplicationQueryClient, query: string, input: TInput): Promise<ApplicationQueryLoaderResult<TValue>> {
  await client.query<TInput, TValue>(query, input).refresh();
  // typecast: the selected query's value is TValue; dehydrate intentionally returns all ready query snapshots for one request-scoped client.
  return { applik8s: client.dehydrate() as readonly ApplicationQuerySnapshot<TValue>[] };
}

/** Creates a route-loader-compatible prefetch function without importing server providers into route code. */
export function createApplicationQueryLoader<TContext, TInput, TValue>(options: {
  readonly client: (context: TContext) => ApplicationQueryClient;
  readonly query: string;
  readonly input: (context: TContext) => TInput;
}): (context: TContext) => Promise<ApplicationQueryLoaderResult<TValue>> {
  return (context) => preloadApplicationQuery<TInput, TValue>(options.client(context), options.query, options.input(context));
}

/** Installs loader-dehydrated snapshots before React hydration, preventing a duplicate initial fetch. */
export function hydrateApplicationQueries(client: ApplicationQueryClient, result: ApplicationQueryLoaderResult): void {
  client.hydrate(result.applik8s);
}
