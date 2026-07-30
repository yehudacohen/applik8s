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
  readonly source?: string;
}

/** Serializes one app-scoped callback and closes over reachable module-local declarations/imports. */
export function serializeApplicationCallback(options: {
  readonly registrar: string;
  readonly argumentIndex: number;
  readonly property: string;
  readonly label: string;
  readonly callback: (...args: never[]) => unknown;
  readonly allowDeferredResolution?: boolean;
}): SerializedApplicationCallback {
  const cacheKey = `${options.registrar}:${options.argumentIndex}:${options.property}`;
  const cached = callbackCache.get(options.callback)?.get(cacheKey);
  if (cached) return cached;
  const instrumented = instrumentedApplicationCallbackSource(options.callback);
  const extracted = instrumented
    ? { source: instrumented.source ? transpileApplicationCallbackExpression(instrumented.source) : Function.prototype.toString.call(options.callback), location: { file: instrumented.file, line: instrumented.line, column: instrumented.column } }
    : extractApplicationCallObjectFunctionSource(options.registrar, options.argumentIndex, options.property);
  const source = normalizeSerializableFunctionSource((extracted?.source ?? Function.prototype.toString.call(options.callback)).trim());
  if (!source || source.includes('[native code]')) throw new Error(`${options.label} must be a serializable JavaScript function.`);
  try {
    Function(`return (${source});`);
  } catch (cause) {
    throw new Error(`${options.label} cannot be serialized: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  const unsupported = unsupportedRouteFreeIdentifiers(analyzeApplicationServerRouteSource(source), new Set());
  let dependencies: { readonly source: string; readonly resolveDir: string } | undefined;
  try {
    dependencies = applicationRouteSourceDependencies({
      id: options.label,
      method: 'POST',
      path: `/${options.registrar}/${options.property}`,
      handlerSource: source,
      handlerSourceKind: extracted ? 'source' : 'functionToString',
      ...(extracted ? { handlerSourceLocation: extracted.location } : {}),
    }, unsupported, new Set());
  } catch (error) {
    if (!options.allowDeferredResolution) throw error;
  }
  if (unsupported.length > 0 && !dependencies && !options.allowDeferredResolution) {
    throw new Error(serializedCallbackClosureMessage({
      label: options.label,
      identifiers: unsupported,
      ...(extracted ? { sourceLocation: extracted.location } : {}),
      guidance: 'Move referenced helpers, tables, and imports to module scope so Applik8s can include them in the generated runtime.',
    }));
  }
  const serialized = { source, ...(dependencies ? { dependencies } : {}), ...(extracted ? { location: extracted.location } : {}), ...(!dependencies && unsupported.length > 0 ? { unresolved: unsupported } : {}) };
  const entries = callbackCache.get(options.callback) ?? new Map<string, SerializedApplicationCallback>();
  entries.set(cacheKey, serialized);
  callbackCache.set(options.callback, entries);
  return serialized;
}

export function instrumentedApplicationCallbackSource(callback: (...args: never[]) => unknown): InstrumentedApplicationCallbackSource | undefined {
  const value = Reflect.get(callback, Symbol.for('applik8s.applicationCallbackSource'));
  if (!value || typeof value !== 'object') return undefined;
  const file = Reflect.get(value, 'file');
  const line = Reflect.get(value, 'line');
  const column = Reflect.get(value, 'column');
  const source = Reflect.get(value, 'source');
  if (typeof file !== 'string' || !Number.isSafeInteger(line) || !Number.isSafeInteger(column)) return undefined;
  return { file, line: Number(line), column: Number(column), ...(typeof source === 'string' ? { source } : {}) };
}
