import {
  type ApplicationCallableProviderRuntimeOperation,
  type ApplicationProviderRef,
  isApplicationRuntimeAccessOperation,
} from '@applik8s/core';
import { applicationProviderGraphNodeId } from './application-identifiers.js';
import type { ApplicationProviderBinding } from './application-providers.js';
import {
  applicationProviderQualificationFor,
  applicationProviderTokenName,
  isApplicationQualifiedProviderToken,
} from './application-providers.js';

const applicationProviderDependencyRegistry =
  new WeakMap<object, readonly unknown[]>();
const applicationProviderDependenciesSymbol = Symbol.for(
  'applik8s.applicationProviderDependencies',
);
const applicationCallbackDependenciesSymbol = Symbol.for(
  'applik8s.applicationCallbackDependencies',
);
const applicationProviderOperationSymbol = Symbol.for(
  'applik8s.applicationProviderOperation',
);

export interface ApplicationMaintainedCallableDependency {
  readonly identifier: string;
  readonly value: unknown;
  readonly awaited?: boolean;
  readonly returned?: boolean;
}

export interface ApplicationMaintainedCallableRuntime {
  /** Compiler-recognized runtime factory; arbitrary graph-supplied modules are never loaded. */
  readonly id: 'notifications.request.v1';
}

const applicationCallableRuntimeSymbol = Symbol.for(
  'applik8s.applicationCallableRuntime',
);

/**
 * Attaches the exact capability leaves reached by an ordinary maintained-
 * module function. This is the hand-authored equivalent of the compiler's
 * recursive local-helper metadata for code that is already distributed as a
 * package when an application is compiled.
 *
 * @internal Framework and maintained-module integration seam.
 */
export function bindApplicationCallableDependencies<
  TCallable extends CallableFunction,
>(
  callable: TCallable,
  dependencies: readonly ApplicationMaintainedCallableDependency[],
  runtime?: ApplicationMaintainedCallableRuntime,
): TCallable {
  const existing = Reflect.get(callable, applicationCallbackDependenciesSymbol);
  const normalizedDependencies = dependencies.map((dependency) =>
    Object.freeze({
      identifier: dependency.identifier,
      value: dependency.value,
      awaited: dependency.awaited ?? true,
      returned: dependency.returned ?? false,
    }));
  const merged = [
    ...(Array.isArray(existing) ? existing : []),
    ...normalizedDependencies,
  ];
  for (const candidate of merged) {
    const conflicting = merged.find(
      (other) =>
        other !== candidate
        && Reflect.get(other, 'identifier') === Reflect.get(candidate, 'identifier')
        && Reflect.get(other, 'value') !== Reflect.get(candidate, 'value'),
    );
    if (conflicting) {
      throw new Error(
        `Application maintained callable dependency ${String(Reflect.get(candidate, 'identifier'))} resolves to multiple values.`,
      );
    }
  }
  const normalized = Object.freeze(
    merged.filter(
      (candidate, index, all) =>
        all.findIndex(
          (other) =>
            Reflect.get(other, 'identifier') === Reflect.get(candidate, 'identifier')
            && Reflect.get(other, 'value') === Reflect.get(candidate, 'value'),
        ) === index,
    ),
  );
  Object.defineProperty(callable, applicationCallbackDependenciesSymbol, {
    configurable: true,
    enumerable: false,
    writable: false,
    value: normalized,
  });
  if (runtime) {
    Object.defineProperty(callable, applicationCallableRuntimeSymbol, {
      configurable: true,
      enumerable: false,
      writable: false,
      value: Object.freeze({ ...runtime }),
    });
  }
  return callable;
}

/** @internal Compiler/runtime hydration metadata for an ordinary maintained callable. */
export function applicationCallableRuntimeFor(
  value: unknown,
): ApplicationMaintainedCallableRuntime | undefined {
  if (
    !value
    || (typeof value !== 'object' && typeof value !== 'function')
  ) {
    return undefined;
  }
  const runtime = Reflect.get(value, applicationCallableRuntimeSymbol);
  if (!runtime || typeof runtime !== 'object') return undefined;
  const id = Reflect.get(runtime, 'id');
  return id === 'notifications.request.v1'
    ? { id }
    : undefined;
}

/**
 * Maintained modules attach provider requirements to their ordinary callable
 * functions. The compiler then hydrates only the workloads that actually call
 * those functions; application authors never thread or select providers.
 *
 * @internal Framework and maintained-module integration seam.
 */
export function bindApplicationProviderDependencies<
  TCallable extends CallableFunction,
>(
  callable: TCallable,
  dependencies: readonly unknown[],
): TCallable {
  applicationProviderDependencyRegistry.set(
    callable,
    Object.freeze([...dependencies]),
  );
  Object.defineProperty(callable, applicationProviderDependenciesSymbol, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze([...dependencies]),
  });
  bindApplicationCallableDependencies(
    callable,
    dependencies.map((dependency, index) => ({
      identifier: `providerDependency${index + 1}`,
      value: dependency,
    })),
  );
  return callable;
}

export interface ApplicationProviderOperationMetadata {
  readonly member: string;
  readonly runtime?: ApplicationCallableProviderRuntimeOperation;
}

/** @internal Attaches the stable provider member/runtime identity to a bound operation. */
export function bindApplicationProviderOperation<
  TCallable extends CallableFunction,
>(
  callable: TCallable,
  operation: ApplicationProviderOperationMetadata,
): TCallable {
  Object.defineProperty(callable, applicationProviderOperationSymbol, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze({
      member: operation.member,
      ...(operation.runtime
        ? { runtime: Object.freeze({ ...operation.runtime }) }
        : {}),
    }),
  });
  return callable;
}

/** @internal Compiler-visible identity for an extracted provider operation. */
export function applicationProviderOperationFor(
  value: unknown,
): ApplicationProviderOperationMetadata | undefined {
  if (typeof value !== 'function') return undefined;
  const operation = Reflect.get(value, applicationProviderOperationSymbol);
  if (!operation || typeof operation !== 'object') return undefined;
  const member = Reflect.get(operation, 'member');
  const runtime = Reflect.get(operation, 'runtime');
  if (typeof member !== 'string') return undefined;
  if (runtime === undefined) return { member };
  const access = runtime && typeof runtime === 'object'
    ? Reflect.get(runtime, 'access')
    : undefined;
  const accessOperations = access && typeof access === 'object'
    ? Reflect.get(access, 'operations')
    : undefined;
  if (
    !runtime
    || typeof runtime !== 'object'
    || typeof Reflect.get(runtime, 'module') !== 'string'
    || typeof Reflect.get(runtime, 'export') !== 'string'
    || !(
      access === 'none'
      || (
        access
        && typeof access === 'object'
        && Reflect.get(access, 'kind') === 'provider'
        && Array.isArray(accessOperations)
        && accessOperations.length > 0
        && accessOperations.every(isApplicationRuntimeAccessOperation)
      )
    )
  ) {
    return undefined;
  }
  return {
    member,
    runtime: {
      module: String(Reflect.get(runtime, 'module')),
      export: String(Reflect.get(runtime, 'export')),
      access: access === 'none'
        ? 'none'
        : {
            kind: 'provider',
            operations: [...accessOperations],
          },
    },
  };
}

/** @internal Compiler dependency discovery. */
export function applicationProviderDependenciesFor(
  value: unknown,
): readonly unknown[] {
  if (
    !value
    || (typeof value !== 'object' && typeof value !== 'function')
  ) {
    return [];
  }
  const registered = applicationProviderDependencyRegistry.get(value);
  if (registered) return registered;
  const portable = Reflect.get(value, applicationProviderDependenciesSymbol);
  return Array.isArray(portable) ? portable : [];
}

export interface ApplicationCallableProviderDependency {
  readonly identifier: string;
  readonly provider: ApplicationProviderRef;
  readonly placement?: 'objectStore' | 'providerDependency';
  readonly operation?: ApplicationProviderOperationMetadata;
}

/**
 * Converts maintained-module dependency metadata into portable graph
 * references. The qualified provider binding remains the runtime value in the
 * callback bundle; this contract exists solely for placement and least-
 * privilege credential hydration.
 *
 * @internal Compiler dependency discovery.
 */
export function applicationCallableProviderDependencies(
  bindings: Readonly<Record<string, unknown>>,
): readonly ApplicationCallableProviderDependency[] {
  const discovered: ApplicationCallableProviderDependency[] = [];
  for (const [identifier, callable] of Object.entries(bindings)) {
    const operation = applicationProviderOperationFor(callable);
    if (isApplicationObjectStoreBinding(callable)) {
      discovered.push({
        identifier,
        provider: {
          interface: 'ObjectStorage',
          nodeId: applicationProviderGraphNodeId('ObjectStorage'),
        },
        placement: 'objectStore',
      });
    }
    const dependencies = [
      ...(isApplicationProviderBinding(callable) ? [callable] : []),
      ...applicationProviderDependenciesFor(callable),
    ];
    for (const dependency of dependencies) {
      const token = isApplicationProviderBinding(dependency)
        ? dependency.token
        : isApplicationQualifiedProviderToken(dependency)
          ? dependency
          : undefined;
      if (!token) continue;
      const tokenName = applicationProviderTokenName(token);
      const qualification = applicationProviderQualificationFor(dependency);
      discovered.push({
        identifier,
        provider: {
          interface: tokenName,
          nodeId: applicationProviderGraphNodeId(tokenName, qualification),
          ...(qualification ? { qualification } : {}),
        },
        ...(!operation ? { placement: 'providerDependency' as const } : {}),
        ...(operation ? { operation } : {}),
      });
    }
  }
  return discovered
    .filter(
      (dependency, index, dependencies) =>
        dependencies.findIndex(
          (candidate) =>
            candidate.identifier === dependency.identifier
            && candidate.provider.nodeId === dependency.provider.nodeId
            && candidate.placement === dependency.placement
            && candidate.operation?.member === dependency.operation?.member
            && candidate.operation?.runtime?.module
              === dependency.operation?.runtime?.module
            && candidate.operation?.runtime?.export
              === dependency.operation?.runtime?.export
        ) === index,
    )
    .sort((left, right) =>
      `${left.identifier}:${left.provider.nodeId}`.localeCompare(
        `${right.identifier}:${right.provider.nodeId}`,
      ));
}

function isApplicationObjectStoreBinding(
  value: unknown,
): value is { readonly kind: 'applicationObjectStore' } {
  return Boolean(
    value
      && typeof value === 'object'
      && Reflect.get(value, 'kind') === 'applicationObjectStore',
  );
}

function isApplicationProviderBinding(
  value: unknown,
): value is ApplicationProviderBinding<unknown> {
  return Boolean(
    value
      && typeof value === 'object'
      && (Reflect.get(value, 'kind') === 'applicationProvider'
        || Reflect.get(value, 'kind') === 'applicationHost')
      && Reflect.get(value, 'token'),
  );
}
