import type { ApplicationObjectStoreBinding } from './application-object-storage.js';
import type { ApplicationOnlineProjectionBinding } from './application-reactive.js';
import type { ApplicationOnlineProjectionRebuildResult } from './projection-rebuild-runtime.js';

export interface ApplicationProjectionRuntime {
  rebuild(input: {
    readonly generation: string;
    readonly artifactPrefix?: string;
  }): Promise<ApplicationOnlineProjectionRebuildResult>;
  retire(input: {
    readonly generation: string;
    readonly references: readonly import('./application-object-storage.js').ApplicationObjectReference[];
  }): Promise<void>;
}

export interface ApplicationProjectionRebuildTarget {
  readonly artifacts: ApplicationObjectStoreBinding;
  readonly bounds?: {
    readonly batchSize?: number;
    readonly maxSegments?: number;
    readonly maxSegmentBytes?: number;
    readonly maxEvents?: number;
    readonly maxCatchUpRounds?: number;
  };
}

export type ApplicationProjectionRuntimeResolver = (
  binding: Pick<ApplicationOnlineProjectionBinding, 'kind' | 'storage' | 'name'>,
) => ApplicationProjectionRuntime | undefined;

const runtimeResolvers: ApplicationProjectionRuntimeResolver[] = [];
const rebuildTargets = new WeakMap<object, ApplicationProjectionRebuildTarget>();

export function installApplicationProjectionRuntimeResolver(
  resolver: ApplicationProjectionRuntimeResolver,
): () => void {
  runtimeResolvers.push(resolver);
  return () => {
    const index = runtimeResolvers.lastIndexOf(resolver);
    if (index >= 0) runtimeResolvers.splice(index, 1);
  };
}

export function applicationProjectionRuntime(
  binding: Pick<ApplicationOnlineProjectionBinding, 'kind' | 'storage' | 'name'>,
): ApplicationProjectionRuntime {
  for (let index = runtimeResolvers.length - 1; index >= 0; index -= 1) {
    const runtime = runtimeResolvers[index]?.(binding);
    if (runtime) return runtime;
  }
  throw new Error(
    `Application projection ${binding.name} has no runtime in this execution context.`,
  );
}

export function attachApplicationProjectionRebuildTarget(
  binding: object,
  target: ApplicationProjectionRebuildTarget,
): void {
  rebuildTargets.set(binding, target);
}

export function applicationProjectionRebuildTarget(
  binding: unknown,
): ApplicationProjectionRebuildTarget | undefined {
  return typeof binding === 'object' && binding !== null
    ? rebuildTargets.get(binding)
    : undefined;
}
