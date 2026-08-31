import {
  runApplicationManagedModelOnce,
  type ApplicationManagedModelRunResult,
  type ApplicationManagedModelRuntimeBinding,
  type ApplicationManagedModelStore,
} from '@applik8s/applik8s';

export interface PostgresApplicationOperatorWorkItem {
  readonly model: string;
  readonly resyncIntervalSeconds: number;
  readonly maximumResyncItems: number;
  reconcileOnce(options: {
    readonly now: () => Date;
    readonly signal: AbortSignal;
  }): Promise<ApplicationManagedModelRunResult<unknown>>;
  requestResync(maximumItems: number, now: string): Promise<number>;
}

export interface PostgresApplicationOperatorRuntimeOptions {
  readonly work: readonly PostgresApplicationOperatorWorkItem[];
  readonly maximumConcurrency?: number;
  readonly maximumWorkPerTick?: number;
  readonly idlePollMilliseconds?: number;
  readonly now?: () => Date;
}

export interface PostgresApplicationOperatorRuntimeSnapshot {
  readonly state: 'idle' | 'running' | 'closing' | 'closed' | 'failed';
  readonly startedAt?: string;
  readonly stoppedAt?: string;
  readonly lastProgressAt?: string;
  readonly reconciled: number;
  readonly finalized: number;
  readonly failed: number;
  readonly resyncs: number;
  readonly lastError?: string;
}

export interface PostgresApplicationOperatorRuntime {
  runOnce(signal?: AbortSignal): Promise<{
    readonly attempted: number;
    readonly progressed: number;
    readonly results: readonly ApplicationManagedModelRunResult<unknown>[];
  }>;
  start(): Promise<void>;
  close(): Promise<void>;
  snapshot(): PostgresApplicationOperatorRuntimeSnapshot;
}

export function postgresApplicationOperatorWorkItem<
  TIdentity,
  TValue extends object,
  TStatus extends object,
>(options: {
  readonly store: ApplicationManagedModelStore<TIdentity, TValue, TStatus> & {
    requestResync(maximumItems: number, now?: string): Promise<number>;
  };
  readonly binding: ApplicationManagedModelRuntimeBinding<TIdentity, TValue, TStatus>;
  readonly resyncIntervalSeconds: number;
  readonly maximumResyncItems: number;
}): PostgresApplicationOperatorWorkItem {
  return Object.freeze({
    model: options.binding.model,
    resyncIntervalSeconds: positiveInteger(
      options.resyncIntervalSeconds,
      `${options.binding.model} resyncIntervalSeconds`,
    ),
    maximumResyncItems: positiveInteger(
      options.maximumResyncItems,
      `${options.binding.model} maximumResyncItems`,
    ),
    reconcileOnce: async ({ now, signal }: {
      readonly now: () => Date;
      readonly signal: AbortSignal;
    }) => runApplicationManagedModelOnce({
      store: options.store,
      binding: options.binding,
      now,
      signal,
    }),
    requestResync: (maximumItems: number, now: string) =>
      options.store.requestResync(maximumItems, now),
  });
}

export function createPostgresApplicationOperatorRuntime(
  options: PostgresApplicationOperatorRuntimeOptions,
): PostgresApplicationOperatorRuntime {
  const work = [...options.work];
  if (new Set(work.map(({ model }) => model)).size !== work.length) {
    throw new Error('PostgreSQL OperatorRuntime requires one work item per managed model.');
  }
  const maximumConcurrency = positiveInteger(
    options.maximumConcurrency ?? 4,
    'maximumConcurrency',
  );
  const maximumWorkPerTick = positiveInteger(
    options.maximumWorkPerTick ?? Math.max(work.length * 4, 16),
    'maximumWorkPerTick',
  );
  const idlePollMilliseconds = positiveInteger(
    options.idlePollMilliseconds ?? 1_000,
    'idlePollMilliseconds',
  );
  const now = options.now ?? (() => new Date());
  const controller = new AbortController();
  const nextResync = new Map(work.map((item) => [item.model, 0]));
  let cursor = 0;
  let state: PostgresApplicationOperatorRuntimeSnapshot['state'] = 'idle';
  let startedAt: string | undefined;
  let stoppedAt: string | undefined;
  let lastProgressAt: string | undefined;
  let lastError: string | undefined;
  let reconciled = 0;
  let finalized = 0;
  let failed = 0;
  let resyncs = 0;
  let loop: Promise<void> | undefined;

  const requestDueResyncs = async (instant: Date): Promise<void> => {
    for (const item of work) {
      if ((nextResync.get(item.model) ?? 0) > instant.getTime()) continue;
      await item.requestResync(item.maximumResyncItems, instant.toISOString());
      resyncs += 1;
      nextResync.set(
        item.model,
        instant.getTime() + item.resyncIntervalSeconds * 1_000,
      );
    }
  };

  const runOnce = async (signal = controller.signal) => {
    signal.throwIfAborted();
    if (work.length === 0) return { attempted: 0, progressed: 0, results: [] };
    await requestDueResyncs(now());
    const count = Math.min(maximumConcurrency, maximumWorkPerTick);
    const selected = Array.from({ length: count }, (_, index) =>
      work[(cursor + index) % work.length] as PostgresApplicationOperatorWorkItem);
    cursor = (cursor + count) % work.length;
    const results = await Promise.all(selected.map((item) =>
      item.reconcileOnce({ now, signal })));
    let progressed = 0;
    for (const result of results) {
      if (result.kind === 'idle') continue;
      progressed += 1;
      lastProgressAt = now().toISOString();
      if (result.kind === 'reconciled') reconciled += 1;
      else if (result.kind === 'finalized') finalized += 1;
      else failed += 1;
    }
    return { attempted: selected.length, progressed, results };
  };

  const start = async (): Promise<void> => {
    if (loop) return loop;
    if (state === 'closed' || state === 'closing') {
      throw new Error('PostgreSQL OperatorRuntime cannot restart after close().');
    }
    state = 'running';
    startedAt = now().toISOString();
    loop = (async () => {
      try {
        while (!controller.signal.aborted) {
          let processed = 0;
          let progress = 0;
          do {
            const result = await runOnce(controller.signal);
            processed += result.attempted;
            progress = result.progressed;
          } while (
            progress > 0
            && processed < maximumWorkPerTick
            && !controller.signal.aborted
          );
          if (!controller.signal.aborted) {
            await abortableDelay(idlePollMilliseconds, controller.signal);
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          state = 'failed';
          lastError = error instanceof Error ? error.message : String(error);
          throw error;
        }
      } finally {
        if (state !== 'failed') state = 'closed';
        stoppedAt = now().toISOString();
      }
    })();
    return loop;
  };

  return Object.freeze({
    runOnce,
    start,
    async close() {
      if (state === 'closed') return;
      state = 'closing';
      controller.abort(new Error('PostgreSQL OperatorRuntime is closing.'));
      await loop?.catch((error) => {
        if (!controller.signal.aborted) throw error;
      });
      if (!loop) {
        state = 'closed';
        stoppedAt = now().toISOString();
      }
    },
    snapshot() {
      return Object.freeze({
        state,
        ...(startedAt ? { startedAt } : {}),
        ...(stoppedAt ? { stoppedAt } : {}),
        ...(lastProgressAt ? { lastProgressAt } : {}),
        reconciled,
        finalized,
        failed,
        resyncs,
        ...(lastError ? { lastError } : {}),
      });
    },
  });
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

async function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}
