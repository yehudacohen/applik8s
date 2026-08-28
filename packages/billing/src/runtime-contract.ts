// typecast-file-boundary: Billing runtime literals are closed protocol declarations and validated records, not unchecked external input.
import type { ApplicationProviderRuntimeContract } from '@applik8s/core';
import type { ApplicationPaymentProvider } from './index.js';

const applicationPaymentRuntimeBindingSymbol = Symbol.for(
  'applik8s.paymentProviderRuntimeBinding',
);

/**
 * Attaches portable, credential-free runtime hydration metadata to one payment
 * adapter. Provider packages use this seam; application source never does.
 *
 * @internal Provider-package integration contract.
 */
export function bindApplicationPaymentProviderRuntime<
  TProvider extends ApplicationPaymentProvider,
>(
  provider: TProvider,
  runtime: ApplicationProviderRuntimeContract,
): TProvider {
  Object.defineProperty(provider, applicationPaymentRuntimeBindingSymbol, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze(runtime),
  });
  return provider;
}

/** @internal Authoring-time graph hydration for PaymentProvider.runtime.bind. */
export function applicationPaymentProviderRuntime(
  provider: ApplicationPaymentProvider,
): ApplicationProviderRuntimeContract | undefined {
  const runtime = Reflect.get(
    provider,
    applicationPaymentRuntimeBindingSymbol,
  );
  return runtime && typeof runtime === 'object'
    ? runtime as ApplicationProviderRuntimeContract
    : undefined;
}
// typecast-file-boundary: Billing runtime literals are closed protocol declarations and validated records, not unchecked external input.
