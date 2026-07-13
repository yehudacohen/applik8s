export interface BoundedConcurrencyObservation {
  readonly active: number;
  readonly completed: number;
  readonly maximumActive: number;
}

/**
 * Consumes an async source without allowing more than `concurrency` tasks to run.
 * Backpressure is applied before requesting the next source item.
 */
export async function consumeWithBoundedConcurrency<T>(
  source: AsyncIterable<T>,
  concurrency: number,
  task: (item: T) => Promise<void>,
  observe?: (observation: BoundedConcurrencyObservation) => void,
): Promise<void> {
  const limit = Math.max(1, Math.floor(concurrency));
  const active = new Set<Promise<void>>();
  let completed = 0;
  let maximumActive = 0;
  let failure: unknown;
  try {
    for await (const item of source) {
      while (active.size >= limit) await Promise.race(active);
      if (failure !== undefined) throw failure;
      const running = task(item);
      active.add(running);
      maximumActive = Math.max(maximumActive, active.size);
      observe?.({ active: active.size, completed, maximumActive });
      const complete = () => {
        active.delete(running);
        completed += 1;
        observe?.({ active: active.size, completed, maximumActive });
      };
      void running.then(complete, (cause) => {
        failure ??= cause;
        complete();
      });
    }
  } catch (cause) {
    failure = cause;
  }
  const settled = await Promise.allSettled(active);
  failure ??= settled.find((result): result is PromiseRejectedResult => result.status === 'rejected')?.reason;
  if (failure !== undefined) throw failure;
}
