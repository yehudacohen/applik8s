import type { ApplicationRuntimeModuleKind } from '@applik8s/core';

import { runtimeModuleEntrypoint, runtimeModuleMetadata } from './application-runtime-module-manifest.js';

export interface ApplicationRuntimeModuleSourceTemplates {
  readonly modelRuntime: () => string;
  readonly jobRunnerRuntime: () => string;
}

export function generatedRuntimeModuleSource(kind: ApplicationRuntimeModuleKind, templates: ApplicationRuntimeModuleSourceTemplates): string {
  if (kind === 'jobRunnerRuntime') {
    return templates.jobRunnerRuntime();
  }
  if (kind === 'modelRuntime') {
    return templates.modelRuntime();
  }
  return generatedGenericRuntimeModuleSource(kind);
}

export function generatedGenericRuntimeModuleSource(kind: ApplicationRuntimeModuleKind): string {
  const entrypoint = runtimeModuleEntrypoint(kind);
  return `${generatedRuntimeModuleSourcePreamble(kind)}\nexport function ${entrypoint}(options = {}) {\n  return { runtimeModule, options };\n}\n`;
}

export function generatedRuntimeModuleSourcePreamble(kind: ApplicationRuntimeModuleKind): string {
  return `export const runtimeModule = ${JSON.stringify(runtimeModuleMetadata(kind))};`;
}
