import type { ApplicationProviderRuntimeContract } from '@applik8s/core';
import type { ApplicationResearchEvidenceProvider } from './contracts.js';

const runtimeBindingSymbol = Symbol.for('applik8s.researchEvidenceRuntimeBinding');

/** @internal Provider-package integration seam. */
export function bindResearchEvidenceRuntime<T extends ApplicationResearchEvidenceProvider>(
  provider: T,
  runtime: ApplicationProviderRuntimeContract,
): T {
  Object.defineProperty(provider, runtimeBindingSymbol, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze(runtime),
  });
  return provider;
}

/** @internal Authoring-time graph hydration for ResearchEvidence.runtime.bind. */
export function researchEvidenceRuntime(
  provider: ApplicationResearchEvidenceProvider,
): ApplicationProviderRuntimeContract | undefined {
  const runtime = Reflect.get(provider, runtimeBindingSymbol);
  return runtime && typeof runtime === 'object'
    ? runtime as ApplicationProviderRuntimeContract
    : undefined;
}
