export interface ApplicationKubernetesListPage<TObject> {
  readonly items: readonly TObject[];
  readonly resourceVersion: string;
  readonly continueToken?: string;
}

export type ApplicationKubernetesWatchEvent<TObject> =
  | { readonly type: 'ADDED' | 'MODIFIED' | 'DELETED'; readonly object: TObject; readonly resourceVersion: string }
  | { readonly type: 'BOOKMARK'; readonly resourceVersion: string }
  | { readonly type: 'ERROR'; readonly code: number; readonly message: string };

export interface ApplicationKubernetesSnapshotWatchClient<TObject, TQuery> {
  list(query: TQuery & {
    readonly limit: number;
    readonly continueToken?: string;
    readonly signal?: AbortSignal;
  }): Promise<ApplicationKubernetesListPage<TObject>>;
  watch(query: TQuery & {
    readonly resourceVersion: string;
    readonly allowBookmarks: true;
    readonly signal?: AbortSignal;
  }): AsyncIterable<ApplicationKubernetesWatchEvent<TObject>>;
}

export interface ApplicationKubernetesSnapshot<TObject> {
  readonly items: readonly TObject[];
  readonly resourceVersion: string;
  readonly pages: number;
}

export type ApplicationKubernetesInvalidation =
  | { readonly kind: 'invalidate'; readonly resourceVersion: string }
  | { readonly kind: 'bookmark'; readonly resourceVersion: string }
  | { readonly kind: 'reset'; readonly reason: 'resourceVersionExpired'; readonly message: string };

export interface ApplicationKubernetesSnapshotWatchOptions {
  readonly pageSize?: number;
  readonly maxPages?: number;
  readonly maxItems?: number;
}

export class ApplicationKubernetesSnapshotBoundError extends Error {
  readonly code = 'APPLIK8S_KUBERNETES_SNAPSHOT_BOUND';
}

/**
 * Establishes a Kubernetes list/watch frontier without exposing raw watch events as the public UI protocol.
 * A snapshot cursor is the list resourceVersion; changes become invalidations and 410 compaction becomes reset.
 */
export class ApplicationKubernetesSnapshotWatchAuthority<TObject, TQuery extends object> {
  readonly #pageSize: number;
  readonly #maxPages: number;
  readonly #maxItems: number;

  constructor(
    readonly client: ApplicationKubernetesSnapshotWatchClient<TObject, TQuery>,
    options: ApplicationKubernetesSnapshotWatchOptions = {},
  ) {
    this.#pageSize = positiveBound(options.pageSize, 250, 'pageSize');
    this.#maxPages = positiveBound(options.maxPages, 100, 'maxPages');
    this.#maxItems = positiveBound(options.maxItems, 10_000, 'maxItems');
  }

  async snapshot(query: TQuery, signal?: AbortSignal): Promise<ApplicationKubernetesSnapshot<TObject>> {
    const items: TObject[] = [];
    let continueToken: string | undefined;
    let resourceVersion: string | undefined;
    let pages = 0;
    do {
      throwIfAborted(signal);
      if (pages >= this.#maxPages) throw new ApplicationKubernetesSnapshotBoundError(`Kubernetes snapshot exceeded ${this.#maxPages} pages.`);
      const page = await this.client.list({
        ...query,
        limit: this.#pageSize,
        ...(continueToken ? { continueToken } : {}),
        ...(signal ? { signal } : {}),
      });
      pages += 1;
      if (!page.resourceVersion) throw new Error('Kubernetes list response omitted metadata.resourceVersion.');
      if (resourceVersion && page.resourceVersion !== resourceVersion) {
        throw new Error(`Kubernetes paginated snapshot changed resourceVersion from ${resourceVersion} to ${page.resourceVersion}.`);
      }
      resourceVersion = page.resourceVersion;
      items.push(...page.items);
      if (items.length > this.#maxItems) throw new ApplicationKubernetesSnapshotBoundError(`Kubernetes snapshot exceeded ${this.#maxItems} items.`);
      continueToken = page.continueToken;
    } while (continueToken);
    return { items, resourceVersion: resourceVersion ?? '0', pages };
  }

  async watch(
    query: TQuery,
    resourceVersion: string,
    onEvent: (event: ApplicationKubernetesInvalidation) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!resourceVersion) throw new Error('Kubernetes watch requires a snapshot resourceVersion.');
    try {
      for await (const event of this.client.watch({
        ...query,
        resourceVersion,
        allowBookmarks: true,
        ...(signal ? { signal } : {}),
      })) {
        throwIfAborted(signal);
        if (event.type === 'ERROR') {
          if (event.code === 410) {
            onEvent({ kind: 'reset', reason: 'resourceVersionExpired', message: event.message });
            return;
          }
          throw new Error(`Kubernetes watch failed with ${event.code}: ${event.message}`);
        }
        if (event.type === 'BOOKMARK') {
          onEvent({ kind: 'bookmark', resourceVersion: event.resourceVersion });
          continue;
        }
        onEvent({ kind: 'invalidate', resourceVersion: event.resourceVersion });
      }
      if (!signal?.aborted) throw new Error('Kubernetes watch ended before cancellation.');
    } catch (error) {
      if (signal?.aborted) return;
      throw error;
    }
  }
}

function positiveBound(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new Error(`Kubernetes snapshot/watch ${name} must be a positive integer.`);
  return resolved;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new Error('Kubernetes snapshot/watch operation was aborted.');
}
