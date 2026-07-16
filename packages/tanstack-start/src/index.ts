import type { ApplicationQueryClient, ApplicationQuerySnapshot } from '@applik8s/client';

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
