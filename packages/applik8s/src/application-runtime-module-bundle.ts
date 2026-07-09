import type { ApplicationRuntimeModuleKind } from '@applik8s/core';

import { generatedApplicationRuntimeModuleManifest } from './application-runtime-module-manifest.js';

export type ApplicationRuntimeModuleSourceResolver = (kind: ApplicationRuntimeModuleKind) => string;

export function generatedRuntimeModuleBundle(resolveSource: ApplicationRuntimeModuleSourceResolver): Readonly<Record<string, string>> {
  const manifest = generatedApplicationRuntimeModuleManifest();
  const bundle: Record<string, string> = {
    'runtime.modules.json': `${JSON.stringify(manifest, null, 2)}\n`,
  };
  for (const module of manifest.modules) {
    bundle[module.path] = resolveSource(module.kind);
  }
  return bundle;
}
