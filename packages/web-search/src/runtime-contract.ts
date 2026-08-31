import type { ApplicationProviderRuntimeContract } from '@applik8s/core';
import type { ApplicationSourceRetrieverProvider, ApplicationWebSearchProvider } from './index.js';

const applicationWebSearchRuntimeBindingSymbol = Symbol.for(
  'applik8s.webSearchProviderRuntimeBinding',
);
const applicationSourceRetrieverRuntimeBindingSymbol = Symbol.for(
  'applik8s.sourceRetrieverRuntimeBinding',
);

/** @internal Provider-package integration seam. */
export function bindApplicationWebSearchProviderRuntime<
  TProvider extends ApplicationWebSearchProvider,
>(
  provider: TProvider,
  runtime: ApplicationProviderRuntimeContract,
): TProvider {
  Object.defineProperty(provider, applicationWebSearchRuntimeBindingSymbol, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze(runtime),
  });
  return provider;
}

/** @internal Authoring-time graph hydration for WebSearch.runtime.bind. */
export function applicationWebSearchProviderRuntime(
  provider: ApplicationWebSearchProvider,
): ApplicationProviderRuntimeContract | undefined {
  const runtime = Reflect.get(
    provider,
    applicationWebSearchRuntimeBindingSymbol,
  );
  // typecast: the private symbol is the sole writer and stores this exact portable contract shape.
  return runtime && typeof runtime === 'object'
    ? runtime as ApplicationProviderRuntimeContract // typecast: private symbol stores this exact contract.
    : undefined;
}

/** @internal Provider-package integration seam. */
export function bindApplicationSourceRetrieverRuntime<
  TProvider extends ApplicationSourceRetrieverProvider,
>(
  provider: TProvider,
  runtime: ApplicationProviderRuntimeContract,
): TProvider {
  Object.defineProperty(provider, applicationSourceRetrieverRuntimeBindingSymbol, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze(runtime),
  });
  return provider;
}

/** @internal Authoring-time graph hydration for SourceRetriever.runtime.bind. */
export function applicationSourceRetrieverRuntime(
  provider: ApplicationSourceRetrieverProvider,
): ApplicationProviderRuntimeContract | undefined {
  const runtime = Reflect.get(provider, applicationSourceRetrieverRuntimeBindingSymbol);
  return runtime && typeof runtime === 'object'
    ? runtime as ApplicationProviderRuntimeContract
    : undefined;
}
