import { applicationCallbackSourceMatchesRuntime } from './application-callback-source-equivalence.js';
import { applicationCallableRuntimeFor } from './application-provider-dependencies.js';
import {
  type ApplicationRouteSourceLocation,
  analyzeApplicationServerRouteSource,
  applicationRouteSourceDependencies,
  extractApplicationCallObjectFunctionSource,
  normalizeSerializableFunctionSource,
  serializedCallbackClosureMessage,
  transpileApplicationCallbackExpression,
  unsupportedRouteFreeIdentifiers,
} from './application-route-source.js';

export interface SerializedApplicationCallback {
  readonly source: string;
  readonly dependencies?: { readonly source: string; readonly resolveDir: string };
  readonly location?: ApplicationRouteSourceLocation;
  readonly unresolved?: readonly string[];
}

const callbackCache = new WeakMap<(...args: never[]) => unknown, Map<string, SerializedApplicationCallback>>();

export interface InstrumentedApplicationCallbackSource {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly name?: string;
  readonly source?: string;
  /** Framework-generated self-contained source that has already crossed the closure boundary. */
  readonly generated?: boolean;
}

export interface InstrumentedApplicationCallbackDependency {
  readonly identifier: string;
  readonly value: unknown;
  readonly awaited: boolean;
  readonly returned: boolean;
}

export interface ExpandedApplicationCallbackDependencies {
  readonly calls: readonly unknown[];
  readonly bindings: Readonly<Record<string, unknown>>;
  readonly awaited: Readonly<Record<string, unknown>>;
  readonly callables: readonly {
    readonly identifier: string;
    readonly runtime: 'notifications.request.v1';
    readonly dependencies: readonly string[];
  }[];
}

const applicationCallbackDependenciesSymbol = Symbol.for(
  'applik8s.applicationCallbackDependencies',
);

/**
 * Resolves compiler-instrumented helper call graphs to their application
 * capability leaves. Metadata stays attached to the authored functions, so an
 * imported callback can carry dependencies that are private to its module
 * without leaking aliases into the importing application.
 */
export function expandApplicationCallbackDependencies(options: {
  readonly calls?: readonly unknown[] | undefined;
  readonly bindings?: Readonly<Record<string, unknown>> | undefined;
  readonly awaited?: Readonly<Record<string, unknown>> | undefined;
}): ExpandedApplicationCallbackDependencies {
  const leaves: InstrumentedApplicationCallbackDependency[] = [];
  const callables: {
    readonly identifier: string;
    readonly runtime: 'notifications.request.v1';
    readonly dependencies: readonly string[];
  }[] = [];
  const roots: InstrumentedApplicationCallbackDependency[] = [];
  const boundValues = new Set(Object.values(options.bindings ?? {}));
  for (const [identifier, value] of Object.entries(options.bindings ?? {})) {
    roots.push({
      identifier,
      value,
      awaited: Object.values(options.awaited ?? {}).includes(value),
      returned: false,
    });
  }
  for (const [identifier, value] of Object.entries(options.awaited ?? {})) {
    if (boundValues.has(value)) continue;
    roots.push({ identifier, value, awaited: true, returned: false });
    boundValues.add(value);
  }
  for (const [index, value] of (options.calls ?? []).entries()) {
    if (boundValues.has(value)) continue;
    roots.push({
      identifier: `generatedCall${index + 1}`,
      value,
      awaited: false,
      returned: false,
    });
  }

  const visiting = new Set<unknown>();
  const visit = (
    dependency: InstrumentedApplicationCallbackDependency,
    inheritedAwaited: boolean,
  ): void => {
    const metadata = instrumentedApplicationCallbackDependencies(
      dependency.value,
    );
    if (!metadata) {
      leaves.push({
        ...dependency,
        awaited: dependency.awaited || inheritedAwaited,
      });
      return;
    }
    if (visiting.has(dependency.value)) {
      throw new Error(
        `Application callback dependency graph contains a cycle through ${dependency.identifier}.`,
      );
    }
    const runtime = applicationCallableRuntimeFor(dependency.value);
    if (runtime && !/^generatedCall\d+$/.test(dependency.identifier)) {
      callables.push({
        identifier: dependency.identifier,
        runtime: runtime.id,
        dependencies: metadata.map((nested) => nested.identifier),
      });
    }
    visiting.add(dependency.value);
    for (const nested of metadata) {
      visit(
        nested,
        nested.awaited || (inheritedAwaited && nested.returned),
      );
    }
    visiting.delete(dependency.value);
  };
  for (const root of roots) visit(root, root.awaited);

  const calls: unknown[] = [];
  const bindings: Record<string, unknown> = {};
  const awaited: Record<string, unknown> = {};
  const seenValues = new Set<unknown>();
  for (const leaf of leaves) {
    if (!seenValues.has(leaf.value)) {
      calls.push(leaf.value);
      seenValues.add(leaf.value);
    }
    const existing = bindings[leaf.identifier];
    if (existing !== undefined && existing !== leaf.value) {
      throw new Error(
        `Application callback dependency identifier ${leaf.identifier} resolves to multiple values.`,
      );
    }
    bindings[leaf.identifier] = leaf.value;
    if (leaf.awaited) awaited[leaf.identifier] = leaf.value;
  }
  return {
    calls: Object.freeze(calls),
    bindings: Object.freeze(bindings),
    awaited: Object.freeze(awaited),
    callables: Object.freeze(
      callables.filter(
        (candidate, index, all) =>
          all.findIndex(
            (other) =>
              other.identifier === candidate.identifier
              && other.runtime === candidate.runtime,
          ) === index,
      ),
    ),
  };
}

function instrumentedApplicationCallbackDependencies(
  value: unknown,
): readonly InstrumentedApplicationCallbackDependency[] | undefined {
  if (
    (typeof value !== 'object' && typeof value !== 'function')
    || value === null
  ) {
    return undefined;
  }
  const metadata = Reflect.get(value, applicationCallbackDependenciesSymbol);
  if (!Array.isArray(metadata)) return undefined;
  const dependencies: InstrumentedApplicationCallbackDependency[] = [];
  for (const candidate of metadata) {
    if (!candidate || typeof candidate !== 'object') return undefined;
    const identifier = Reflect.get(candidate, 'identifier');
    const dependency = Reflect.get(candidate, 'value');
    const awaited = Reflect.get(candidate, 'awaited');
    const returned = Reflect.get(candidate, 'returned');
    if (
      typeof identifier !== 'string'
      || typeof awaited !== 'boolean'
      || typeof returned !== 'boolean'
    ) {
      return undefined;
    }
    dependencies.push({
      identifier,
      value: dependency,
      awaited,
      returned,
    });
  }
  return dependencies;
}

/** Serializes one app-scoped callback and closes over reachable module-local declarations/imports. */
export function serializeApplicationCallback(options: {
  readonly registrar: string;
  readonly argumentIndex: number;
  readonly property: string;
  readonly label: string;
  readonly callback: (...args: never[]) => unknown;
  readonly allowDeferredResolution?: boolean;
  /** Internal wrapper paths can disable stack-based callsite guessing. */
  readonly extractCallsite?: boolean;
  /** Compiler-owned runtime bindings that are injected into the callback factory. */
  readonly injectedIdentifiers?: readonly string[];
}): SerializedApplicationCallback {
  const injectedIdentifiers = new Set(options.injectedIdentifiers ?? []);
  const cacheKey =
    `${options.registrar}:${options.argumentIndex}:${options.property}:`
    + [...injectedIdentifiers].sort().join(',');
  const cached = callbackCache.get(options.callback)?.get(cacheKey);
  if (cached) return cached;
  const runtimeSource = Function.prototype.toString.call(options.callback);
  const instrumented = instrumentedApplicationCallbackSource(options.callback);
  if (instrumented?.generated && instrumented.source) {
    const durableLocation = durableApplicationCallbackLocation({
      file: instrumented.file,
      line: instrumented.line,
      column: instrumented.column,
    });
    const serialized = {
      source: instrumented.source,
      ...(durableLocation ? { location: durableLocation } : {}),
    };
    const entries = callbackCache.get(options.callback) ?? new Map<string, SerializedApplicationCallback>();
    entries.set(cacheKey, serialized);
    callbackCache.set(options.callback, entries);
    return serialized;
  }
  const candidate = instrumented
    ? { source: instrumented.source ? transpileApplicationCallbackExpression(instrumented.source) : Function.prototype.toString.call(options.callback), location: { file: instrumented.file, line: instrumented.line, column: instrumented.column } }
    : options.extractCallsite === false
      ? undefined
      : extractApplicationCallObjectFunctionSource(options.registrar, options.argumentIndex, options.property);
  const extracted = candidate && (
    instrumented
    || applicationCallbackSourceMatchesRuntime(candidate.source, runtimeSource, candidate.location.file)
  )
    ? candidate
    : undefined;
  const durableLocation = extracted
    ? durableApplicationCallbackLocation(extracted.location)
    : undefined;
  const source = normalizeSerializableFunctionSource((extracted?.source ?? runtimeSource).trim());
  if (!source || source.includes('[native code]')) throw new Error(`${options.label} must be a serializable JavaScript function.`);
  try {
    Function(`return (${source});`);
  } catch (cause) {
    throw new Error(`${options.label} cannot be serialized: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  const unsupported = unsupportedRouteFreeIdentifiers(
    analyzeApplicationServerRouteSource(source),
    injectedIdentifiers,
  );
  let dependencies: { readonly source: string; readonly resolveDir: string } | undefined;
  try {
    dependencies = applicationRouteSourceDependencies({
      id: options.label,
      method: 'POST',
      path: `/${options.registrar}/${options.property}`,
      handlerSource: source,
      handlerSourceKind: extracted ? 'source' : 'functionToString',
      ...(durableLocation ? { handlerSourceLocation: durableLocation } : {}),
    }, unsupported, injectedIdentifiers);
  } catch (error) {
    if (!options.allowDeferredResolution) throw error;
  }
  if (unsupported.length > 0 && !dependencies && !options.allowDeferredResolution) {
    throw new Error(serializedCallbackClosureMessage({
      label: options.label,
      identifiers: unsupported,
      ...(durableLocation ? { sourceLocation: durableLocation } : {}),
      guidance: 'Move referenced helpers, tables, and imports to module scope so Applik8s can include them in the generated runtime.',
    }));
  }
  const serialized = { source, ...(dependencies ? { dependencies } : {}), ...(durableLocation ? { location: durableLocation } : {}), ...(!dependencies && unsupported.length > 0 ? { unresolved: unsupported } : {}) };
  const entries = callbackCache.get(options.callback) ?? new Map<string, SerializedApplicationCallback>();
  entries.set(cacheKey, serialized);
  callbackCache.set(options.callback, entries);
  return serialized;
}

/**
 * Discovery bundles are compiler scratch space. Their process, timestamp, and
 * cache-busting query are intentionally unique on every compile, so persisting
 * them as callback provenance makes otherwise identical application graphs
 * nondeterministic. Authored module locations remain available for dependency
 * resolution and diagnostics; scratch-bundle locations carry neither value
 * once discovery has completed.
 */
function durableApplicationCallbackLocation(
  location: ApplicationRouteSourceLocation,
): ApplicationRouteSourceLocation | undefined {
  return /(?:^|\/)\.applik8s-tmp\/discovery-[^/]+\/entrypoint\.mjs(?:\?.*)?$/u
    .test(location.file)
    ? undefined
    : location;
}

export function instrumentedApplicationCallbackSource(callback: (...args: never[]) => unknown): InstrumentedApplicationCallbackSource | undefined {
  const value = Reflect.get(callback, Symbol.for('applik8s.applicationCallbackSource'));
  if (!value || typeof value !== 'object') return undefined;
  const file = Reflect.get(value, 'file');
  const line = Reflect.get(value, 'line');
  const column = Reflect.get(value, 'column');
  const name = Reflect.get(value, 'name');
  const source = Reflect.get(value, 'source');
  const generated = Reflect.get(value, 'generated');
  if (typeof file !== 'string' || !Number.isSafeInteger(line) || !Number.isSafeInteger(column)) return undefined;
  return { file, line: Number(line), column: Number(column), ...(typeof name === 'string' ? { name } : {}), ...(typeof source === 'string' ? { source } : {}), ...(generated === true ? { generated: true } : {}) };
}
