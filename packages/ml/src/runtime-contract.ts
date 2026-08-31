/** @internal Shared identity between ML authoring bindings and generated runtimes. */
export function applicationMLRuntimeEnvironmentName(providerNodeId: string): string {
  return `APPLIK8S_ML_${providerNodeId.replace(/[^A-Za-z0-9]+/gu, '_').toUpperCase()}`;
}

/** @internal Mirrors the framework's qualified MLModel graph identity. */
export function applicationMLProviderNodeId(id: string): string {
  return `provider.mlmodel.v1alpha1.${id.toLowerCase().replace(/[^a-z0-9.-]+/gu, '-').replace(/^-+|-+$/gu, '')}`;
}
