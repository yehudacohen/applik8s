import type {
  ApplicationObjectStorageRuntime,
  ApplicationObjectStoreBinding,
} from './application-object-storage.js';

export type ApplicationObjectStorageRuntimeResolver = (
  binding: ApplicationObjectStoreBinding,
) => ApplicationObjectStorageRuntime | undefined;

export type ApplicationObjectStorageRuntimeFactory =
  | ApplicationObjectStorageRuntimeResolver
  | undefined;

const runtimeResolvers: ApplicationObjectStorageRuntimeResolver[] = [];
let runtimeFactory: ApplicationObjectStorageRuntimeFactory;

export function installApplicationObjectStorageRuntimeResolver(
  resolver: ApplicationObjectStorageRuntimeResolver,
): () => void {
  runtimeResolvers.push(resolver);
  return () => {
    const index = runtimeResolvers.lastIndexOf(resolver);
    if (index >= 0) runtimeResolvers.splice(index, 1);
  };
}

export function setApplicationObjectStorageRuntimeFactory(
  factory: ApplicationObjectStorageRuntimeFactory,
): void {
  runtimeFactory = factory;
}

export function applicationObjectStorageRuntime(
  binding: ApplicationObjectStoreBinding,
): ApplicationObjectStorageRuntime {
  for (let index = runtimeResolvers.length - 1; index >= 0; index -= 1) {
    const runtime = runtimeResolvers[index]?.(binding);
    if (runtime) return runtime;
  }
  const runtime = runtimeFactory?.(binding);
  if (runtime) return runtime;
  throw new Error(
    `Application object store ${binding.name} has no runtime in this execution context.`,
  );
}
