import type {
  ApplicationQualifiedProviderBinding,
  ApplicationQualifiedProviderBindingMetadata,
} from './application-profiles.js';
import {
  bindApplicationProviderDependencies,
} from './application-provider-dependencies.js';
import {
  ApplicationProviderRuntimeSelectionError,
  resolveApplicationProviderRuntimeImplementation,
} from './application-provider-runtime.js';
import {
  type ApplicationProviderSelectionValue,
  applicationProviderSelectionFor,
} from './application-providers.js';

/** @internal Creates the lazy, compiler-visible handle returned by application.inject(). */
export function createApplicationQualifiedProviderBinding<TImplementation>(
  metadata: ApplicationQualifiedProviderBindingMetadata<TImplementation>,
): ApplicationQualifiedProviderBinding<TImplementation> {
  const operationCache = new Map<PropertyKey, CallableFunction>();
  let handle: ApplicationQualifiedProviderBinding<TImplementation>;
  const target = Object.freeze({ ...metadata });
  handle = new Proxy(target, {
    get(source, property, receiver) {
      if (Reflect.has(source, property)) {
        return Reflect.get(source, property, receiver);
      }
      // Framework/compiler probes use global symbols. Provider implementations
      // cannot claim those namespaces, and probing must stay build-time inert.
      if (typeof property === 'symbol') return undefined;
      const cached = operationCache.get(property);
      if (cached) return cached;
      const candidates = providerCandidates(metadata.implementation);
      const candidateValues = candidates.map((candidate) =>
        candidate && (typeof candidate === 'object' || typeof candidate === 'function')
          ? Reflect.get(candidate, property)
          : undefined,
      );
      if (candidateValues.every((candidate) => candidate === undefined)) {
        return undefined;
      }
      if (candidateValues.some((candidate) => typeof candidate === 'function')) {
        const operation = (...args: readonly unknown[]) => {
          const implementation = resolveApplicationProviderRuntimeImplementation(
            handle,
          );
          if (
            !implementation
            || (typeof implementation !== 'object'
              && typeof implementation !== 'function')
          ) {
            throw new ApplicationProviderRuntimeSelectionError(
              `Injected provider ${metadata.qualification.key} has no object implementation for ${String(property)}().`,
            );
          }
          const callable = Reflect.get(implementation, property);
          if (typeof callable !== 'function') {
            throw new ApplicationProviderRuntimeSelectionError(
              `Injected provider ${metadata.qualification.key} does not implement ${String(property)}() for the selected profile.`,
            );
          }
          return Reflect.apply(callable, implementation, args);
        };
        Object.defineProperty(operation, 'name', {
          configurable: true,
          value: `${metadata.qualification.name}_${String(property)}`,
        });
        bindApplicationProviderDependencies(operation, [handle]);
        operationCache.set(property, operation);
        return operation;
      }
      let implementation: TImplementation;
      try {
        implementation = resolveApplicationProviderRuntimeImplementation(handle);
      } catch (error) {
        if (error instanceof ApplicationProviderRuntimeSelectionError) {
          throw new ApplicationProviderRuntimeSelectionError(
            `Injected provider ${metadata.qualification.key} cannot read ${String(property)} before its managed profile is selected.`,
          );
        }
        throw error;
      }
      return implementation
        && (typeof implementation === 'object' || typeof implementation === 'function')
        ? Reflect.get(implementation, property)
        : undefined;
    },
  }) as ApplicationQualifiedProviderBinding<TImplementation>;
  return handle;
}

function providerCandidates<TImplementation>(
  implementation: TImplementation,
): readonly TImplementation[] {
  const selection = applicationProviderSelectionFor<TImplementation>(implementation);
  return selection ? selectionCandidates(selection) : [implementation];
}

function selectionCandidates<TImplementation>(
  selection: ApplicationProviderSelectionValue<TImplementation>,
): readonly TImplementation[] {
  return [...Object.values(selection.cases), selection.default];
}
