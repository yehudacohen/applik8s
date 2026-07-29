import type { ApplicationRuntimeModuleExportContract, ApplicationRuntimeModuleInterfaceContract, ApplicationRuntimeModuleKind, ApplicationRuntimeModuleManifestContract, ApplicationRuntimeModuleManifestEntryContract, ApplicationRuntimeModuleRef } from '@applik8s/core';

export const generatedRuntimeModuleApiVersion = 'applik8s.runtime/v1alpha1';

// typecast: generated runtime bundles intentionally freeze this exact module set while preserving literal kind order for manifest tests.
export const generatedApplicationRuntimeModuleKinds = ['serverRuntime', 'modelRuntime', 'jobRunnerRuntime', 'kubernetesClient', 'diagnostics', 'providerAdapter'] as const satisfies readonly ApplicationRuntimeModuleKind[];

export function generatedApplicationRuntimeModuleManifest(): ApplicationRuntimeModuleManifestContract {
  const modules = generatedApplicationRuntimeModuleKinds.map((kind) => runtimeModuleManifestEntry(kind)) satisfies readonly ApplicationRuntimeModuleManifestEntryContract[];
  return { apiVersion: generatedRuntimeModuleApiVersion, kind: 'GeneratedRuntimeModuleManifest', modules };
}

export function runtimeModuleManifestEntry(kind: ApplicationRuntimeModuleKind): ApplicationRuntimeModuleManifestEntryContract {
  return runtimeModuleMetadata(kind);
}

export function runtimeModuleEntrypoint(kind: ApplicationRuntimeModuleKind): string {
  if (kind === 'serverRuntime') {
    return 'createServerRuntime';
  }
  if (kind === 'modelRuntime') {
    return 'createModelRuntime';
  }
  if (kind === 'jobRunnerRuntime') {
    return 'createJobStatusUpdater';
  }
  if (kind === 'diagnostics') {
    return 'createDiagnosticsRuntime';
  }
  if (kind === 'providerAdapter') {
    return 'createProviderAdapter';
  }
  if (kind === 'kubernetesClient') {
    return 'createKubernetesClient';
  }
  if (kind === 'indexerRuntime') {
    return 'createIndexerRuntime';
  }
  if (kind === 'aggregateWorkerRuntime') {
    return 'createAggregateWorkerRuntime';
  }
  if (kind === 'counterFlusherRuntime') {
    return 'createCounterFlusherRuntime';
  }
  return 'createRuntimeModule';
}

export function runtimeModuleName(kind: ApplicationRuntimeModuleKind): string {
  if (kind === 'serverRuntime') {
    return 'server';
  }
  if (kind === 'modelRuntime') {
    return 'postgres-models';
  }
  if (kind === 'jobRunnerRuntime') {
    return 'generated-job-status';
  }
  if (kind === 'kubernetesClient') {
    return 'kubernetes';
  }
  if (kind === 'diagnostics') {
    return 'diagnostics';
  }
  if (kind === 'providerAdapter') {
    return 'postgres';
  }
  return kind;
}

export function runtimeModulePath(kind: ApplicationRuntimeModuleKind): string {
  if (kind === 'serverRuntime') {
    return 'runtime/server.mjs';
  }
  if (kind === 'modelRuntime') {
    return 'runtime/transactional-database-postgres.mjs';
  }
  if (kind === 'jobRunnerRuntime') {
    return 'runtime/job-runner.mjs';
  }
  if (kind === 'kubernetesClient') {
    return 'runtime/kubernetes-client.mjs';
  }
  if (kind === 'diagnostics') {
    return 'runtime/diagnostics.mjs';
  }
  if (kind === 'providerAdapter') {
    return 'runtime/providers/postgres.mjs';
  }
  return `runtime/${kind}.mjs`;
}

export function runtimeModuleImports(kind: ApplicationRuntimeModuleKind): readonly ApplicationRuntimeModuleRef[] {
  if (kind === 'serverRuntime') {
    return [{ kind: 'modelRuntime', name: 'postgres-models' }, { kind: 'diagnostics', name: 'diagnostics' }];
  }
  if (kind === 'modelRuntime') {
    return [{ kind: 'providerAdapter', name: 'postgres' }, { kind: 'diagnostics', name: 'diagnostics' }];
  }
  if (kind === 'jobRunnerRuntime') {
    return [{ kind: 'kubernetesClient', name: 'kubernetes' }, { kind: 'diagnostics', name: 'diagnostics' }];
  }
  if (kind === 'providerAdapter') {
    return [{ kind: 'diagnostics', name: 'diagnostics' }];
  }
  return [];
}

export function runtimeModuleExports(kind: ApplicationRuntimeModuleKind): readonly ApplicationRuntimeModuleExportContract[] {
  if (kind === 'modelRuntime') {
    return [{ name: 'createModelRuntime', kind: 'function', stability: 'stable' }, { name: 'createPostgresModelClient', kind: 'function', stability: 'stable' }];
  }
  if (kind === 'jobRunnerRuntime') {
    return [{ name: 'createJobStatusUpdater', kind: 'function', stability: 'stable' }, { name: 'generatedJobStatusFromResource', kind: 'function', stability: 'stable' }, { name: 'runGeneratedJobStatusReconciler', kind: 'function', stability: 'stable' }];
  }
  return [{ name: runtimeModuleEntrypoint(kind), kind: 'function', stability: 'stable' }];
}

export function runtimeModuleSourceMaps(kind: ApplicationRuntimeModuleKind): ApplicationRuntimeModuleInterfaceContract['sourceMaps'] {
  return kind === 'diagnostics' ? 'notApplicable' : 'required';
}

export function runtimeModuleMetadata(kind: ApplicationRuntimeModuleKind, path = runtimeModulePath(kind), entrypoint = runtimeModuleEntrypoint(kind), imports = runtimeModuleImports(kind), exports = runtimeModuleExports(kind), sourceMaps = runtimeModuleSourceMaps(kind)): ApplicationRuntimeModuleManifestEntryContract {
  return {
    apiVersion: generatedRuntimeModuleApiVersion,
    kind,
    name: runtimeModuleName(kind),
    artifact: { kind: 'runtimeModule', path, name: runtimeModuleName(kind) },
    path,
    entrypoint,
    imports,
    exports,
    interface: runtimeModuleInterface(imports, exports, sourceMaps),
  };
}

export function runtimeModuleInterface(imports: readonly ApplicationRuntimeModuleRef[], exports: readonly ApplicationRuntimeModuleExportContract[], sourceMaps: ApplicationRuntimeModuleInterfaceContract['sourceMaps']): ApplicationRuntimeModuleInterfaceContract {
  return {
    apiVersion: generatedRuntimeModuleApiVersion,
    imports,
    exports,
    diagnostics: 'structured',
    sourceMaps,
    failurePolicy: 'failClosed',
  };
}
