export async function consumeWithBoundedConcurrency<T>(
  source: AsyncIterable<T>,
  concurrency: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  const limit = Math.max(1, Math.floor(concurrency));
  const active = new Set<Promise<void>>();
  let failure: unknown;
  try {
    for await (const item of source) {
      while (active.size >= limit) await Promise.race(active);
      if (failure !== undefined) throw failure;
      const running = task(item);
      active.add(running);
      const complete = () => active.delete(running);
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
