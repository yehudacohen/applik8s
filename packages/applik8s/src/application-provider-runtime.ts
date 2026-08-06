import type { ApplicationQualifiedProviderBinding } from './application-profiles.js';
import {
  applicationProviderSelectionFor,
  type ApplicationProviderSelectionValue,
} from './application-providers.js';

export class ApplicationProviderRuntimeSelectionError extends Error {
  readonly code = 'APPLIK8S_PROVIDER_RUNTIME_SELECTION';

  constructor(message: string) {
    super(message);
    this.name = 'ApplicationProviderRuntimeSelectionError';
  }
}

/**
 * Resolves a graph-selected provider inside a managed runtime.
 *
 * This is framework plumbing for maintained modules. Application authors keep
 * calling the module's ordinary functions; the compiler supplies the selected
 * profile variant through the managed workload environment.
 */
export function resolveApplicationProviderRuntimeImplementation<TImplementation>(
  binding:
    | ApplicationQualifiedProviderBinding<TImplementation>
    | TImplementation,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): TImplementation {
  const selection =
    applicationProviderSelectionFor<TImplementation>(binding);
  if (!selection) {
    return (
      isApplicationQualifiedProviderBinding<TImplementation>(binding)
        ? binding.implementation
        : binding
    );
  }
  return resolveSelection(selection, environment.APPLIK8S_PROFILE_VARIANT);
}

function resolveSelection<TImplementation>(
  selection: ApplicationProviderSelectionValue<TImplementation>,
  variant: string | undefined,
): TImplementation {
  if (!variant) {
    throw new ApplicationProviderRuntimeSelectionError(
      'Managed provider selection requires APPLIK8S_PROFILE_VARIANT.',
    );
  }
  if (!Object.hasOwn(selection.cases, variant)) {
    throw new ApplicationProviderRuntimeSelectionError(
      `Managed provider selection has no implementation for profile variant ${JSON.stringify(variant)}.`,
    );
  }
  const implementation = selection.cases[variant];
  if (implementation === undefined) {
    throw new ApplicationProviderRuntimeSelectionError(
      `Managed provider selection resolved profile variant ${JSON.stringify(variant)} to no implementation.`,
    );
  }
  return implementation;
}

function isApplicationQualifiedProviderBinding<TImplementation>(
  value: unknown,
): value is ApplicationQualifiedProviderBinding<TImplementation> {
  return Boolean(
    value
      && typeof value === 'object'
      && Reflect.get(value, 'kind') === 'applicationProvider'
      && Reflect.has(value, 'implementation'),
  );
}
