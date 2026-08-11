import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { JsonObject } from '@applik8s/core';
import { transformSync } from 'esbuild';
import { blockCommentEnd, escapeRegExp, isDeclarationIdentifier, isRegexLiteralStart, lineCommentEnd, matchingDelimiter, nextNonWhitespace, previousNonWhitespace, quotedSourceEnd, regexLiteralEnd, splitTopLevelArguments, templateSourceEnd, unique } from './application-route-source-utilities.js';

export { matchingDelimiter, splitTopLevelArguments } from './application-route-source-utilities.js';
export interface ApplicationRouteSourceLocation {
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

export interface ApplicationRouteSourceRoute {
  readonly id: string;
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly handlerSource: string;
  readonly handlerSourceKind?: 'source' | 'functionToString';
  readonly handlerSourceLocation?: ApplicationRouteSourceLocation;
  readonly functionNative?: {
    readonly input: JsonObject;
    readonly output: JsonObject;
    readonly transaction?: unknown;
  };
}

export interface SerializedApplicationServerRouteWithDependencies extends ApplicationRouteSourceRoute {
  readonly handlerDependencySource?: string;
  readonly handlerDependencyResolveDir?: string;
}

export interface ApplicationServerRouteSourceAnalysis {
  readonly strippedSource: string;
  readonly declaredIdentifiers: ReadonlySet<string>;
  readonly memberCalls: readonly ApplicationServerMemberCall[];
  readonly methodAliases: readonly ApplicationServerMethodAlias[];
  readonly functionCalls: ReadonlySet<string>;
  readonly freeIdentifiers: readonly string[];
}

export interface ApplicationServerMemberCall {
  readonly objectName: string;
  readonly methodName: string;
}

export interface ApplicationServerMethodAlias {
  readonly aliasName: string;
  readonly objectName: string;
  readonly methodName: string;
}

export interface ApplicationRouteSourceDependencies {
  readonly source: string;
  /**
   * Executable helper declarations that belong to the callback itself.
   *
   * Framework handle registrations are omitted here because their callbacks
   * are admitted and validated independently when the handle is registered.
   * Consumers performing closure-safety analysis must use this source instead
   * of rescanning the complete module materialization source.
   */
  readonly analysisSource: string;
  readonly resolveDir: string;
}

export interface ApplicationCommandSourceViolation {
  readonly name: string;
  readonly reason: 'ambientIo' | 'nondeterminism' | 'dynamicCode';
}

/**
 * Command handlers execute while the authoritative model transaction is open.
 * Keep their supported closure deliberately smaller than normal server/operator
 * callbacks: no ambient I/O, wall clock, random source, dynamic code, or route
 * to the Node global object is admitted. Strings and comments have already been
 * removed by the shared lexical scanner, so diagnostics are based on executable
 * source rather than keyword text.
 */
export function applicationCommandSourceViolations(source: string, kind: 'key' | 'idempotencyKey' | 'initialize' | 'handler'): readonly ApplicationCommandSourceViolation[] {
  const analysis = analyzeApplicationServerRouteSource(source);
  const violations = new Map<string, ApplicationCommandSourceViolation>();
  const add = (name: string, reason: ApplicationCommandSourceViolation['reason']) => violations.set(`${reason}:${name}`, { name, reason });
  const free = new Set(analysis.freeIdentifiers);

  const nondeterministicGlobals = ['Date', 'performance', 'crypto'];
  for (const name of nondeterministicGlobals) {
    if (free.has(name)) add(name, 'nondeterminism');
  }
  // Constructor calls are not ordinary function-call tokens in the lightweight
  // route analyzer, so reject the ambient Date constructor explicitly unless a
  // handler-local binding deliberately shadows it.
  if (!analysis.declaredIdentifiers.has('Date') && /\b(?:new\s+Date\s*\(|Date\s*\.)/.test(analysis.strippedSource)) add('Date', 'nondeterminism');
  if (analysis.memberCalls.some((call) => call.objectName === 'Math' && call.methodName === 'random')) add('Math.random', 'nondeterminism');

  if (kind === 'handler' || kind === 'initialize') {
    const ambientGlobals = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'navigator', 'process', 'require', 'module', 'global', 'globalThis', 'Bun', 'Deno'];
    for (const name of ambientGlobals) {
      if (free.has(name)) add(name, 'ambientIo');
    }
    for (const name of ['setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask']) {
      if (free.has(name)) add(name, 'ambientIo');
    }
  }

  for (const name of ['eval', 'Function', 'AsyncFunction', 'WebAssembly']) {
    if (free.has(name)) add(name, 'dynamicCode');
  }
  if (/\bimport\s*\(/.test(analysis.strippedSource)) add('import()', 'dynamicCode');
  if (/\bthis\b/.test(analysis.strippedSource)) add('this', 'dynamicCode');
  if (/\.\s*(?:constructor|__proto__|prototype)\b/.test(analysis.strippedSource)) add('.constructor/prototype', 'dynamicCode');

  return [...violations.values()].sort((left, right) => left.name.localeCompare(right.name));
}

interface ApplicationRouteTopLevelBinding {
  readonly name: string;
  readonly source: string;
  readonly analysisSource: string;
  readonly kind: 'declaration' | 'import';
  readonly position: number;
}

export function normalizeSerializableFunctionSource(source: string): string {
  if (/^async\s*\(/.test(source)) {
    return source.replace(/^async\s*\(/, 'async (');
  }
  return /^[$A-Z_a-z][$\w]*\s*\(/.test(source) ? `function ${source}` : source;
}

export function analyzeApplicationServerRouteSource(source: string): ApplicationServerRouteSourceAnalysis {
  const strippedSource = stripCommentsAndStrings(source);
  const declaredIdentifiers = declaredRouteIdentifiers(strippedSource);
  const functionCalls = routeFunctionCalls(strippedSource);
  const memberCalls = routeMemberCalls(strippedSource);
  const methodAliases = routeMethodAliases(strippedSource);
  const freeIdentifiers = routeFreeIdentifiers(strippedSource, declaredIdentifiers);
  return { strippedSource, declaredIdentifiers, memberCalls, methodAliases, functionCalls, freeIdentifiers };
}

export function routeAnalysisCallsMethod(analysis: ApplicationServerRouteSourceAnalysis, bindingName: string, methodName: string): boolean {
  return analysis.memberCalls.some((call) => call.objectName === bindingName && call.methodName === methodName) || analysis.methodAliases.some((alias) => alias.objectName === bindingName && alias.methodName === methodName && analysis.functionCalls.has(alias.aliasName));
}

export function routeDynamicBindingAccesses(analysis: ApplicationServerRouteSourceAnalysis, bindingNames: ReadonlySet<string>): readonly string[] {
  const dynamicAccesses = new Set<string>();
  for (const bindingName of bindingNames) {
    if (new RegExp(`\\b${escapeRegExp(bindingName)}\\s*\\[`).test(analysis.strippedSource)) {
      dynamicAccesses.add(bindingName);
    }
  }
  return [...dynamicAccesses].sort();
}

export function unsupportedRouteFreeIdentifiers(analysis: ApplicationServerRouteSourceAnalysis, bindingNames: ReadonlySet<string>): readonly string[] {
  const allowed = new Set([
    'Buffer',
    ...bindingNames,
    ...analysis.declaredIdentifiers,
    'Array',
    'AbortController',
    'AbortSignal',
    'Boolean',
    'Date',
    'Error',
    'Headers',
    'JSON',
    'Map',
    'Math',
    'Number',
    'Object',
    'Promise',
    'RegExp',
    'Reflect',
    'Response',
    'Set',
    'String',
		'TextDecoder',
		'TextEncoder',
		'Uint8Array',
    'WeakMap',
    'WeakSet',
    'any',
    'boolean',
    'URL',
    'URLSearchParams',
    'clearTimeout',
    'console',
    'decodeURIComponent',
    'encodeURIComponent',
    'fetch',
    'crypto',
    'globalThis',
    'parseFloat',
    'parseInt',
    'process',
    'setTimeout',
    'string',
    'undefined',
    'unknown',
    'void',
  ]);
  return analysis.freeIdentifiers.filter((name) => !allowed.has(name) && !routeKeywords.has(name));
}

export function serializedCallbackClosureMessage(options: {
  readonly label: string;
  readonly identifiers: readonly string[];
  readonly route?: Pick<ApplicationRouteSourceRoute, 'method' | 'path'>;
  readonly sourceLocation?: ApplicationRouteSourceLocation;
  readonly guidance?: string;
}): string {
  const route = options.route ? ` route ${options.route.method} ${options.route.path}` : '';
  const location = options.sourceLocation ? ` at ${options.sourceLocation.file}:${options.sourceLocation.line}:${options.sourceLocation.column}` : '';
  const guidance = options.guidance ?? 'Bind framework objects through app.http/app.server resources, models, indexes, or captures; keep plain constants inside the callback; or move reusable helpers to module scope so applik8s can include their declarations/imports.';
  return `${options.label}${route}${location} references module-scope identifier(s) that are not available inside the generated runtime: ${options.identifiers.join(', ')}. ${guidance}`;
}

export function applicationRouteSourceDependencies(route: ApplicationRouteSourceRoute, unsupported: readonly string[], bindingNames: ReadonlySet<string>): ApplicationRouteSourceDependencies | undefined {
  if (unsupported.length === 0) {
    return undefined;
  }
  if (!route.handlerSourceLocation || route.handlerSourceKind !== 'source') {
    return undefined;
  }
  const discoveryEntrypoint = Reflect.get(globalThis, Symbol.for('applik8s.discovery.entrypoint'));
  const candidateFiles = unique([
    route.handlerSourceLocation.file,
    ...(typeof discoveryEntrypoint === 'string' && existsSync(discoveryEntrypoint) ? [discoveryEntrypoint] : []),
  ]);
  for (const candidateFile of candidateFiles) {
    const resolved = resolveApplicationRouteSourceDependencies(candidateFile, unsupported, bindingNames);
    if (resolved) return resolved;
  }
  throw new Error(serializedCallbackClosureMessage({ label: 'app.server', route, identifiers: unsupported, sourceLocation: route.handlerSourceLocation }));
}

function resolveApplicationRouteSourceDependencies(file: string, unsupported: readonly string[], bindingNames: ReadonlySet<string>): ApplicationRouteSourceDependencies | undefined {
  const fileSource = readFileSync(file, 'utf8');
  const topLevelBindings = applicationRouteTopLevelBindings(fileSource, bindingNames, file);
  const included = new Map<string, ApplicationRouteTopLevelBinding>();
  const unresolved = new Set<string>();
  const queue = [...unsupported];
  for (let index = 0; index < queue.length; index += 1) {
    const name = queue[index] ?? '';
    if (!name || bindingNames.has(name) || included.has(name) || routeKeywords.has(name) || unresolved.has(name)) {
      continue;
    }
    const binding = topLevelBindings.get(name);
    if (!binding) {
      unresolved.add(name);
      continue;
    }
    included.set(name, binding);
    if (binding.kind === 'declaration') {
      // Maintained modules are promoted through application.include(...).
      // Replaying only the selected module handle is not equivalent to the
      // authored module when its application profile/database binding is a
      // sibling declaration. Discover the provider selection from its value
      // expression rather than a conventional local identifier: `db`,
      // `primaryStore`, and `database` are semantically equivalent here.
      if (/\.\s*include\s*\(/.test(binding.analysisSource)) {
        for (const prerequisite of topLevelBindings.values()) {
          if (
            prerequisite.kind === 'declaration'
            && applicationDatabaseProviderPrerequisite(
              prerequisite.analysisSource,
            )
            && !included.has(prerequisite.name)
          ) {
            queue.push(prerequisite.name);
          }
        }
      }
      const nested = unsupportedRouteFreeIdentifiers(analyzeApplicationServerRouteSource(binding.analysisSource), new Set([...bindingNames, ...included.keys()]));
      for (const nestedName of nested) {
        if (!included.has(nestedName) && !unresolved.has(nestedName)) {
          queue.push(nestedName);
        }
      }
    }
  }
  if (unresolved.size > 0) {
    if (process.env.APPLIK8S_DEBUG_CALLBACK_DEPENDENCIES === '1') {
      console.error(JSON.stringify({ component: 'application-callback-dependencies', file, unsupported, bindings: [...topLevelBindings.keys()], included: [...included.keys()], unresolved: [...unresolved] }));
    }
    return undefined;
  }
  const ordered = [...new Map([...included.values()].map((binding) => [`${binding.kind}:${binding.position}:${binding.source}`, binding])).values()].sort((left, right) => left.position - right.position);
  const imports = ordered.filter((binding) => binding.kind === 'import').map((binding) => binding.source);
  const declarations = ordered.filter((binding) => binding.kind === 'declaration').map((binding) => binding.source);
  const analysisDeclarations = applicationRouteAnalysisBindings(
    unsupported,
    bindingNames,
    topLevelBindings,
  ).map((binding) => binding.source);
  return {
    source: [...imports, ...declarations].join('\n\n'),
    analysisSource: analysisDeclarations.join('\n\n'),
    resolveDir: dirname(file),
  };
}

function applicationRouteAnalysisBindings(
  roots: readonly string[],
  bindingNames: ReadonlySet<string>,
  topLevelBindings: ReadonlyMap<string, ApplicationRouteTopLevelBinding>,
): readonly ApplicationRouteTopLevelBinding[] {
  const included = new Map<string, ApplicationRouteTopLevelBinding>();
  const queue = [...roots];
  for (let index = 0; index < queue.length; index += 1) {
    const name = queue[index] ?? '';
    if (!name || bindingNames.has(name) || included.has(name)) continue;
    const binding = topLevelBindings.get(name);
    if (!binding || binding.kind === 'import') continue;
    // A referenced durable handle is executable setup, but its callback owns
    // an independent purity/admission check. Re-scanning that implementation
    // as part of the caller would reject the ordinary function-native pattern
    // where orchestration calls an effect workflow or emits a typed signal.
    if (isDirectApplicationWorkflowHandleRegistration(binding.source)
      || isDirectApplicationSignalHandleRegistration(binding.source)) {
      continue;
    }
    included.set(name, binding);
    const nested = unsupportedRouteFreeIdentifiers(
      analyzeApplicationServerRouteSource(binding.analysisSource),
      new Set([...bindingNames, ...included.keys()]),
    );
    for (const nestedName of nested) {
      if (!included.has(nestedName)) queue.push(nestedName);
    }
  }
  return [...included.values()].sort(
    (left, right) => left.position - right.position,
  );
}

function applicationDatabaseProviderPrerequisite(source: string): boolean {
  const analysis = analyzeApplicationServerRouteSource(source);
  return analysis.memberCalls.some(
    (call) => call.methodName === 'database',
  ) || /\.\s*database\s*(?:;|$)/.test(analysis.strippedSource);
}

/**
 * A direct `const effect = application.workflow(...)` declaration is a typed
 * durable handle, not executable orchestration. Its implementation callback is
 * validated through its own registration path (task rules for a single-step
 * workflow, orchestration rules for a durable workflow). Rescanning the whole
 * declaration while validating a caller would incorrectly reject legal
 * coordinator-to-effect calls.
 *
 * The recognition is intentionally narrow and fail-closed: one identifier,
 * one direct member call, and no second declarator or trailing expression.
 */
function isDirectApplicationWorkflowHandleRegistration(source: string): boolean {
  const stripped = stripCommentsAndStrings(source);
  const match = stripped.match(
    /^(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:workflow|[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*\.\s*workflow)\s*\(/,
  );
  if (!match) return false;
  const open = stripped.lastIndexOf('(', match[0].length - 1);
  if (open < 0) return false;
  const close = matchingDelimiter(stripped, open, '(', ')');
  if (close === undefined) return false;
  return /^;?\s*$/.test(stripped.slice(close + 1));
}

function isDirectApplicationSignalHandleRegistration(source: string): boolean {
  const stripped = stripCommentsAndStrings(source);
  const match = stripped.match(
    /^(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*\.\s*signal\s*\(/,
  );
  if (!match) return false;
  const open = stripped.lastIndexOf('(', match[0].length - 1);
  if (open < 0) return false;
  const close = matchingDelimiter(stripped, open, '(', ')');
  if (close === undefined) return false;
  return /^;?\s*$/.test(stripped.slice(close + 1));
}

const applicationRouteSourceModulePath = fileURLToPath(import.meta.url);
const applicationDslModulePath = applicationRouteSourceModulePath.replace(/application-route-source(\.[cm]?[jt]sx?)$/, 'application$1');

export function extractApplicationRouteHandlerSource(
  method: ApplicationRouteSourceRoute['method'],
  handlerArgumentIndex: 1 | 2 = 1,
): { readonly source: string; readonly location: ApplicationRouteSourceLocation } | undefined {
  return extractApplicationCallArgumentSource(method.toLowerCase(), handlerArgumentIndex, true);
}

export function extractApplicationCallArgumentSource(methodName: string, argumentIndex: number, requireLiteralFirstArgument = false): { readonly source: string; readonly location: ApplicationRouteSourceLocation } | undefined {
  const previousStackTraceLimit = Error.stackTraceLimit;
  Error.stackTraceLimit = Math.max(previousStackTraceLimit, 50);
  const stack = new Error().stack;
  Error.stackTraceLimit = previousStackTraceLimit;
  const locations = applicationRouteCallsiteLocations(stack);
  if (locations.length === 0) {
    debugRouteSourceExtraction('no callsite location');
    return undefined;
  }
  for (const location of locations) {
    try {
      const fileSource = readFileSync(location.file, 'utf8');
      const expression = callArgumentExpressionAtLocation(fileSource, location, methodName, argumentIndex, requireLiteralFirstArgument);
      if (!expression) {
        debugRouteSourceExtraction(`no route expression at ${location.file}:${location.line}:${location.column}`);
        continue;
      }
      return { source: transpileApplicationCallbackExpression(expression), location };
    } catch (error) {
      debugRouteSourceExtraction(error instanceof Error ? error.message : String(error));
    }
  }
  return undefined;
}

/** Extracts a function-valued property from an object literal passed to an app registrar. */
export function extractApplicationCallObjectFunctionSource(methodName: string, argumentIndex: number, property: string): { readonly source: string; readonly location: ApplicationRouteSourceLocation } | undefined {
  const previousStackTraceLimit = Error.stackTraceLimit;
  Error.stackTraceLimit = Math.max(previousStackTraceLimit, 50);
  const stack = new Error().stack;
  Error.stackTraceLimit = previousStackTraceLimit;
  const locations = applicationRouteCallsiteLocations(stack);
  if (locations.length === 0) debugRouteSourceExtraction(`no ${methodName}.${property} callsite location`);
  for (const location of locations) {
    try {
      const fileSource = readFileSync(location.file, 'utf8');
      const objectSource = callArgumentRawAtLocation(fileSource, location, methodName, argumentIndex);
      const expression = objectSource ? objectLiteralFunctionProperty(objectSource, property) : undefined;
      if (expression) return { source: transpileApplicationCallbackExpression(expression), location };
      debugRouteSourceExtraction(`no ${methodName}.${property} expression at ${location.file}:${location.line}:${location.column}`);
    } catch (error) {
      debugRouteSourceExtraction(error instanceof Error ? error.message : String(error));
    }
  }
  return undefined;
}


function routeMemberCalls(source: string): readonly ApplicationServerMemberCall[] {
  const calls: ApplicationServerMemberCall[] = [];
  for (const match of source.matchAll(/\b([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g)) {
    calls.push({ objectName: match[1] ?? '', methodName: match[2] ?? '' });
  }
  return calls.filter((call) => call.objectName.length > 0 && call.methodName.length > 0);
}

function routeMethodAliases(source: string): readonly ApplicationServerMethodAlias[] {
  const aliases: ApplicationServerMethodAlias[] = [];
  for (const match of source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\b/g)) {
    aliases.push({ aliasName: match[1] ?? '', objectName: match[2] ?? '', methodName: match[3] ?? '' });
  }
  return aliases.filter((alias) => alias.aliasName.length > 0 && alias.objectName.length > 0 && alias.methodName.length > 0);
}

function routeFunctionCalls(source: string): ReadonlySet<string> {
  const calls = new Set<string>();
  for (const match of source.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = match[1] ?? '';
    const index = match.index ?? 0;
    if (!name || previousNonWhitespace(source, index) === '.') {
      continue;
    }
    calls.add(name);
  }
  return calls;
}

function routeFreeIdentifiers(source: string, declared: ReadonlySet<string>): readonly string[] {
  const unsupported = new Set<string>();
  const identifiers = source.matchAll(/\b[A-Za-z_$][\w$]*\b/g);
  for (const match of identifiers) {
    const name = match[0];
    const index = match.index ?? 0;
    if (declared.has(name) || routeKeywords.has(name)) {
      continue;
    }
    const previous = previousNonWhitespace(source, index);
    const next = nextNonWhitespace(source, index + name.length);
    if (previous === '.' || next === ':' || isDeclarationIdentifier(source, index, name)) {
      continue;
    }
    unsupported.add(name);
  }
  return [...unsupported].sort();
}

function applicationRouteTopLevelBindings(source: string, bindingNames: ReadonlySet<string>, file: string): ReadonlyMap<string, ApplicationRouteTopLevelBinding> {
  // Parse the transpiled module rather than individual declaration substrings.
  // A substring scanner cannot reliably distinguish a function body from an
  // object default (`options = {}`) or an object-shaped return type. Module-
  // level transpilation strips type-only identifiers and preserves executable
  // imports/declarations for the generated runtime dependency bundle.
  source = transpileApplicationRouteModuleForDependencies(source, file);
  const bindings = new Map<string, ApplicationRouteTopLevelBinding>();
  let index = 0;
  let depth = 0;
  while (index < source.length) {
    const character = source[index] ?? '';
    if (character === '\'' || character === '"') {
      index = quotedSourceEnd(source, index, character);
      continue;
    }
    if (character === '`') {
      index = templateSourceEnd(source, index);
      continue;
    }
    if (character === '/' && source[index + 1] === '/') {
      index = lineCommentEnd(source, index);
      continue;
    }
    if (character === '/' && source[index + 1] === '*') {
      index = blockCommentEnd(source, index);
      continue;
    }
    if (character === '/' && isRegexLiteralStart(source, index)) {
      index = regexLiteralEnd(source, index);
      continue;
    }
    if (character === '{') {
      depth += 1;
      index += 1;
      continue;
    }
    if (character === '}') {
      depth = Math.max(0, depth - 1);
      index += 1;
      continue;
    }
    if (depth === 0) {
      const importBinding = topLevelImportBindingAt(source, index);
      if (importBinding) {
        for (const name of importBinding.names) {
          bindings.set(name, { name, source: importBinding.source, analysisSource: importBinding.source, kind: 'import', position: index });
        }
        index = importBinding.end;
        continue;
      }
      const declaration = topLevelDeclarationBindingAt(source, index, bindingNames);
      if (declaration) {
        for (const name of declaration.names) {
          bindings.set(name, { name, source: declaration.source, analysisSource: declaration.source, kind: 'declaration', position: index });
        }
        index = declaration.end;
        continue;
      }
    }
    index += 1;
  }
  return bindings;
}

function transpileApplicationRouteModuleForDependencies(source: string, file: string): string {
  try {
    return transformSync(source, { loader: file.endsWith('.tsx') || file.endsWith('.jsx') ? 'tsx' : file.endsWith('.js') || file.endsWith('.mjs') || file.endsWith('.cjs') ? 'js' : 'ts', format: 'esm', target: 'node22' }).code;
  } catch (_error) {
    return source;
  }
}

function topLevelImportBindingAt(source: string, index: number): { readonly names: readonly string[]; readonly source: string; readonly end: number } | undefined {
  if (!keywordAt(source, index, 'import') || source.slice(index).match(/^import\s*\(/)) {
    return undefined;
  }
  const end = statementSourceEnd(source, index);
  const importSource = source.slice(index, end).trim();
  if (/^import\s+type\b/.test(importSource)) {
    return { names: [], source: importSource, end };
  }
  return { names: importedLocalNames(importSource), source: importSource, end };
}

function topLevelDeclarationBindingAt(source: string, index: number, bindingNames: ReadonlySet<string>): { readonly names: readonly string[]; readonly source: string; readonly end: number } | undefined {
  const snippet = source.slice(index);
  const functionMatch = snippet.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\b/);
  if (functionMatch) {
    const parameterOpen = source.indexOf('(', index + functionMatch[0].length);
    const parameterClose = parameterOpen >= 0 ? matchingDelimiter(source, parameterOpen, '(', ')') : undefined;
    const open = parameterClose === undefined ? -1 : source.indexOf('{', parameterClose + 1);
    const close = open >= 0 ? matchingDelimiter(source, open, '{', '}') : undefined;
    const end = close === undefined ? statementSourceEnd(source, index) : close + 1;
    const names = [functionMatch[1] ?? ''].filter((name) => name && !bindingNames.has(name));
    return { names, source: stripTopLevelExport(source.slice(index, end).trim()), end };
  }
  const classMatch = snippet.match(/^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)\b/);
  if (classMatch) {
    const open = source.indexOf('{', index + classMatch[0].length);
    const close = open >= 0 ? matchingDelimiter(source, open, '{', '}') : undefined;
    const end = close === undefined ? statementSourceEnd(source, index) : close + 1;
    const names = [classMatch[1] ?? ''].filter((name) => name && !bindingNames.has(name));
    return { names, source: stripTopLevelExport(source.slice(index, end).trim()), end };
  }
  const variableMatch = snippet.match(/^(?:export\s+)?(?:const|let|var)\s+/);
  if (variableMatch) {
    const end = statementSourceEnd(source, index);
    const declarationSource = stripTopLevelExport(source.slice(index, end).trim());
    const names = variableDeclarationNames(declarationSource).filter((name) => !bindingNames.has(name));
    return { names, source: declarationSource, end };
  }
  return undefined;
}

function importedLocalNames(source: string): readonly string[] {
  const names: string[] = [];
  const defaultMatch = source.match(/^import\s+([A-Za-z_$][\w$]*)\s*(?:,|from\b)/);
  if (defaultMatch?.[1]) {
    names.push(defaultMatch[1]);
  }
  const namespaceMatch = source.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
  if (namespaceMatch?.[1]) {
    names.push(namespaceMatch[1]);
  }
  const named = source.match(/\{([^}]*)\}/)?.[1];
  if (named) {
    for (const part of named.split(',')) {
      const match = part.trim().match(/^(?:type\s+)?[A-Za-z_$][\w$]*(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      const local = match?.[1] ?? part.trim().replace(/^type\s+/, '').split(/\s+/)[0];
      if (local && /^[A-Za-z_$][\w$]*$/.test(local)) {
        names.push(local);
      }
    }
  }
  return unique(names);
}

function variableDeclarationNames(source: string): readonly string[] {
  const names = new Set<string>();
  const body = source.replace(/^(?:const|let|var)\s+/, '').replace(/;\s*$/, '');
  for (const part of splitTopLevelArguments(body)) {
    const declaration = part.trim();
    const assignment = topLevelCharacterIndex(declaration, '=');
    addBindingPatternIdentifiers(names, assignment >= 0 ? declaration.slice(0, assignment) : declaration);
  }
  return [...names];
}

function statementSourceEnd(source: string, start: number): number {
  let index = start;
  let parens = 0;
  let braces = 0;
  let brackets = 0;
  while (index < source.length) {
    const character = source[index] ?? '';
    if (character === '\'' || character === '"') {
      index = quotedSourceEnd(source, index, character);
      continue;
    }
    if (character === '`') {
      index = templateSourceEnd(source, index);
      continue;
    }
    if (character === '/' && source[index + 1] === '/') {
      index = lineCommentEnd(source, index);
      continue;
    }
    if (character === '/' && source[index + 1] === '*') {
      index = blockCommentEnd(source, index);
      continue;
    }
    if (character === '/' && isRegexLiteralStart(source, index)) {
      index = regexLiteralEnd(source, index);
      continue;
    }
    if (character === '(') {
      parens += 1;
    } else if (character === ')') {
      parens -= 1;
    } else if (character === '{') {
      braces += 1;
    } else if (character === '}') {
      braces -= 1;
    } else if (character === '[') {
      brackets += 1;
    } else if (character === ']') {
      brackets -= 1;
    } else if (character === ';' && parens === 0 && braces === 0 && brackets === 0) {
      return index + 1;
    }
    index += 1;
  }
  return source.length;
}

function stripTopLevelExport(source: string): string {
  return source.replace(/^export\s+/, '');
}

function keywordAt(source: string, index: number, keyword: string): boolean {
  return source.startsWith(keyword, index) && !/[A-Za-z0-9_$]/.test(source[index - 1] ?? '') && !/[A-Za-z0-9_$]/.test(source[index + keyword.length] ?? '');
}

const routeKeywords = new Set([
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'default',
  'delete',
  'do',
  'else',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'let',
  'new',
  'null',
  'of',
  'return',
  'switch',
  'super',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
]);

function stripCommentsAndStrings(source: string): string {
  const output = [...source];
  const blank = (start: number, end: number): void => {
    for (let position = start; position < end; position += 1) {
      if (output[position] !== '\n' && output[position] !== '\r') {
        output[position] = ' ';
      }
    }
  };
  const scanQuotedString = (start: number, quote: string): number => {
    let position = start + 1;
    while (position < source.length) {
      if (source[position] === '\\') {
        position += 2;
        continue;
      }
      if (source[position] === quote) {
        position += 1;
        break;
      }
      position += 1;
    }
    blank(start, position);
    return position;
  };
  const scanRegexLiteral = (start: number): number => {
    let position = start + 1;
    let inCharacterClass = false;
    while (position < source.length) {
      const character = source[position];
      if (character === '\\') {
        position += 2;
        continue;
      }
      if (character === '[') {
        inCharacterClass = true;
      } else if (character === ']') {
        inCharacterClass = false;
      } else if (character === '/' && !inCharacterClass) {
        position += 1;
        while (/[A-Za-z]/.test(source[position] ?? '')) {
          position += 1;
        }
        break;
      }
      position += 1;
    }
    blank(start, position);
    return position;
  };
  const scanTemplate = (start: number): number => {
    output[start] = ' ';
    let position = start + 1;
    while (position < source.length) {
      const character = source[position];
      if (character === '\\') {
        blank(position, Math.min(position + 2, source.length));
        position += 2;
        continue;
      }
      if (character === '`') {
        output[position] = ' ';
        return position + 1;
      }
      if (character === '$' && source[position + 1] === '{') {
        blank(position, position + 2);
        const close = scanRange(position + 2, true);
        if (close < source.length) {
          output[close] = ' ';
          position = close + 1;
          continue;
        }
        return close;
      }
      output[position] = character === '\n' || character === '\r' ? character : ' ';
      position += 1;
    }
    return position;
  };
  const scanRange = (start: number, stopOnBrace: boolean): number => {
    let position = start;
    while (position < source.length) {
      const character = source[position];
      const next = source[position + 1];
      if (stopOnBrace && character === '}') {
        return position;
      }
      if (character === '/' && next === '/') {
        let end = position + 2;
        while (end < source.length && source[end] !== '\n' && source[end] !== '\r') {
          end += 1;
        }
        blank(position, end);
        position = end;
        continue;
      }
      if (character === '/' && next === '*') {
        const end = source.indexOf('*/', position + 2);
        const commentEnd = end === -1 ? source.length : end + 2;
        blank(position, commentEnd);
        position = commentEnd;
        continue;
      }
      if (character === '/' && isRegexLiteralStart(source, position)) {
        position = scanRegexLiteral(position);
        continue;
      }
      if (character === '\'' || character === '"') {
        position = scanQuotedString(position, character);
        continue;
      }
      if (character === '`') {
        position = scanTemplate(position);
        continue;
      }
      if (stopOnBrace && character === '{') {
        const close = scanRange(position + 1, true);
        position = close < source.length ? close + 1 : close;
        continue;
      }
      position += 1;
    }
    return position;
  };
  scanRange(0, false);
  return output.join('');
}

function declaredRouteIdentifiers(source: string): ReadonlySet<string> {
  const declared = new Set<string>();
  addParameterIdentifiers(declared, leadingRouteParameterList(source));
  addArrowParameterIdentifiers(declared, source);
  for (const match of source.matchAll(/\b(?:const|let|var)\s+/g)) {
    const start = match.index ?? 0;
    const end = statementSourceEnd(source, start);
    for (const name of variableDeclarationNames(source.slice(start, end))) declared.add(name);
  }
  for (const match of source.matchAll(/\bfunction(?:\s+([A-Za-z_$][\w$]*))?\s*\(/g)) {
    declared.add(match[1] ?? '');
    const open = source.indexOf('(', match.index ?? 0);
    const close = open >= 0
      ? matchingDelimiter(source, open, '(', ')')
      : undefined;
    if (open >= 0 && close !== undefined) {
      addParameterIdentifiers(declared, source.slice(open + 1, close));
    }
  }
  for (const match of source.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/g)) {
    declared.add(match[1] ?? '');
  }
  for (const match of source.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) {
    declared.add(match[1] ?? '');
  }
  addClassRouteIdentifiers(declared, source);
  declared.delete('');
  return declared;
}

function addClassRouteIdentifiers(
  declared: Set<string>,
  source: string,
): void {
  for (const match of source.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)[^{]*\{/g)) {
    const className = match[1];
    if (className) declared.add(className);
    const open = source.indexOf('{', match.index ?? 0);
    const close = open >= 0
      ? matchingDelimiter(source, open, '{', '}')
      : undefined;
    if (open < 0 || close === undefined) continue;
    let position = open + 1;
    while (position < close) {
      while (position < close && /\s/.test(source[position] ?? '')) {
        position += 1;
      }
      if (position >= close) break;
      const memberStart = position;
      let parentheses = 0;
      while (position < close) {
        const character = source[position] ?? '';
        if (character === '(') parentheses += 1;
        else if (character === ')') parentheses = Math.max(0, parentheses - 1);
        if (parentheses === 0 && (character === ';' || character === '{')) {
          const header = source.slice(memberStart, position).trim();
          const method = header.match(
            /^(?:(?:static|async|get|set)\s+)*([A-Za-z_$][\w$]*)\s*\((.*)\)$/s,
          );
          if (method) {
            if (method[1]) declared.add(method[1]);
            addParameterIdentifiers(declared, method[2] ?? '');
          } else {
            const field = header.match(
              /^(?:(?:static|readonly|declare)\s+)*([A-Za-z_$][\w$]*)\b/,
            );
            if (field?.[1]) declared.add(field[1]);
          }
          if (character === '{') {
            const memberClose = matchingDelimiter(source, position, '{', '}');
            position = memberClose === undefined ? close : memberClose + 1;
          } else {
            position += 1;
          }
          break;
        }
        position += 1;
      }
    }
  }
}

function addArrowParameterIdentifiers(declared: Set<string>, source: string): void {
  for (const arrow of source.matchAll(/=>/g)) {
    let end = (arrow.index ?? 0) - 1;
    while (end >= 0 && /\s/.test(source[end] ?? '')) end -= 1;
    if (end < 0) continue;
    if (source[end] === ')') {
      const open = matchingOpeningDelimiter(source, end, '(', ')');
      if (open !== undefined) addParameterIdentifiers(declared, source.slice(open + 1, end));
      continue;
    }
    const prefix = source.slice(0, end + 1);
    const name = prefix.match(/([A-Za-z_$][\w$]*)$/)?.[1];
    if (name) declared.add(name);
  }
}

function matchingOpeningDelimiter(source: string, closeIndex: number, open: string, close: string): number | undefined {
  let depth = 0;
  for (let index = closeIndex; index >= 0; index -= 1) {
    const character = source[index];
    if (character === close) depth += 1;
    else if (character === open) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return undefined;
}

function leadingRouteParameterList(source: string): string {
  const trimmed = source.trimStart();
  const withoutAsync = trimmed.startsWith('async ') ? trimmed.slice(6).trimStart() : trimmed;
  if (withoutAsync.startsWith('function')) {
    const open = withoutAsync.indexOf('(');
    const close = open >= 0 ? matchingDelimiter(withoutAsync, open, '(', ')') : undefined;
    return close === undefined ? '' : withoutAsync.slice(open + 1, close);
  }
  if (withoutAsync.startsWith('(')) {
    const close = matchingDelimiter(withoutAsync, 0, '(', ')');
    if (close !== undefined && withoutAsync.slice(close + 1).trimStart().startsWith('=>')) {
      return withoutAsync.slice(1, close);
    }
    if (close !== undefined && withoutAsync.slice(close + 1).trim().replace(/;$/, '') === '') {
      return leadingRouteParameterList(withoutAsync.slice(1, close));
    }
  }
  const simpleArrow = withoutAsync.match(/^([A-Za-z_$][\w$]*)\s*=>/);
  return simpleArrow?.[1] ?? '';
}

function addParameterIdentifiers(declared: Set<string>, parameters: string): void {
  for (const part of splitTopLevelArguments(parameters)) {
    addBindingPatternIdentifiers(declared, part);
  }
}

function addBindingPatternIdentifiers(declared: Set<string>, pattern: string): void {
  const normalized = pattern.trim().replace(/^\.\.\./, '').replace(/\s*=.*$/s, '').trim();
  if (!normalized) {
    return;
  }
  if (normalized.startsWith('{')) {
    const close = matchingDelimiter(normalized, 0, '{', '}');
    if (close === undefined) {
      return;
    }
    for (const field of splitTopLevelArguments(normalized.slice(1, close))) {
      const fieldPattern = field.trim().replace(/^\.\.\./, '');
      const aliasIndex = topLevelCharacterIndex(fieldPattern, ':');
      addBindingPatternIdentifiers(declared, aliasIndex >= 0 ? fieldPattern.slice(aliasIndex + 1) : fieldPattern);
    }
    return;
  }
  if (normalized.startsWith('[')) {
    const close = matchingDelimiter(normalized, 0, '[', ']');
    if (close === undefined) {
      return;
    }
    for (const element of splitTopLevelArguments(normalized.slice(1, close))) {
      addBindingPatternIdentifiers(declared, element);
    }
    return;
  }
  const name = normalized.match(/^([A-Za-z_$][\w$]*)/)?.[1];
  if (name) {
    declared.add(name);
  }
}

function topLevelCharacterIndex(source: string, target: string): number {
  let parens = 0;
  let braces = 0;
  let brackets = 0;
  let index = 0;
  while (index < source.length) {
    const character = source[index] ?? '';
    if (character === '\'' || character === '"') {
      index = quotedSourceEnd(source, index, character);
      continue;
    }
    if (character === '`') {
      index = templateSourceEnd(source, index);
      continue;
    }
    if (character === '/' && source[index + 1] === '/') {
      index = lineCommentEnd(source, index);
      continue;
    }
    if (character === '/' && source[index + 1] === '*') {
      index = blockCommentEnd(source, index);
      continue;
    }
    if (character === '/' && isRegexLiteralStart(source, index)) {
      index = regexLiteralEnd(source, index);
      continue;
    }
    if (character === '(') {
      parens += 1;
    } else if (character === ')') {
      parens -= 1;
    } else if (character === '{') {
      braces += 1;
    } else if (character === '}') {
      braces -= 1;
    } else if (character === '[') {
      brackets += 1;
    } else if (character === ']') {
      brackets -= 1;
    } else if (character === target && parens === 0 && braces === 0 && brackets === 0) {
      return index;
    }
    index += 1;
  }
  return -1;
}

function debugRouteSourceExtraction(message: string): void {
  if (process.env.APPLIK8S_DEBUG_ROUTE_SOURCE === '1') {
    console.error(`[applik8s] route source extraction fallback: ${message}`);
  }
}

function applicationRouteCallsiteLocations(stack: string | undefined): readonly ApplicationRouteSourceLocation[] {
  if (!stack) {
    return [];
  }
  const locations: ApplicationRouteSourceLocation[] = [];
  for (const line of stack.split('\n')) {
    const match = line.match(/\(?((?:file:\/\/)?\/[^():]+):(\d+):(\d+)\)?$/);
    if (!match) {
      continue;
    }
    const rawFile = match[1] ?? '';
    const normalizedRawFile = rawFile.replace(/[?#].*$/, '');
    const file = normalizedRawFile.startsWith('file://') ? fileURLToPath(normalizedRawFile) : normalizedRawFile;
    if (!file || isApplicationRouteInternalStackFrame(line, file) || file.includes('/node_modules/') || !existsSync(file) || !/\.[cm]?[jt]sx?$/.test(file)) {
      continue;
    }
    locations.push({ file, line: Number(match[2]), column: Number(match[3]) });
  }
  return locations;
}

function isApplicationRouteInternalStackFrame(line: string, file: string): boolean {
  if (file === applicationRouteSourceModulePath || file === applicationDslModulePath) {
    return true;
  }
  return /\bat (?:extractApplicationRouteHandlerSource|extractApplicationCallArgumentSource|extractApplicationCallObjectFunctionSource|applicationRouteCallsiteLocations?|record|Object\.(?:get|post))\b/.test(line);
}

function callArgumentExpressionAtLocation(source: string, location: ApplicationRouteSourceLocation, methodName: string, argumentIndex: number, requireLiteralFirstArgument: boolean): string | undefined {
  const args = callArgumentsAtLocation(source, location, methodName);
  const firstArgument = args?.[0]?.trim() ?? '';
  const handlerSource = args?.[argumentIndex]?.trim();
  if (!handlerSource || (argumentIndex >= 1 && !/(?:=>|^\s*(?:async\s+)?function\b)/.test(handlerSource)) || (requireLiteralFirstArgument && !/^['"`]/.test(firstArgument))) return undefined;
  return handlerSource;
}

function callArgumentRawAtLocation(source: string, location: ApplicationRouteSourceLocation, methodName: string, argumentIndex: number): string | undefined {
  return callArgumentsAtLocation(source, location, methodName)?.[argumentIndex]?.trim();
}

function callArgumentsAtLocation(source: string, location: ApplicationRouteSourceLocation, methodName: string): readonly string[] | undefined {
  const position = sourceOffsetForLineColumn(source, location.line, location.column);
  const searchStart = Math.max(0, position - 4000);
  const searchEnd = Math.min(source.length, position + 8000);
  const windowSource = source.slice(searchStart, searchEnd);
  const calls: { readonly openParen: number; readonly closeParen: number; readonly distance: number; readonly args: readonly string[] }[] = [];
  const callPattern = new RegExp(
    `(?:\\.\\s*|\\b)${escapeRegExp(methodName)}\\s*\\(`,
    'g',
  );
  for (const match of windowSource.matchAll(callPattern)) {
    const openParen = searchStart + (match.index ?? 0) + match[0].lastIndexOf('(');
    const closeParen = matchingDelimiter(source, openParen, '(', ')');
    if (closeParen === undefined) {
      continue;
    }
    const args = splitTopLevelArguments(source.slice(openParen + 1, closeParen));
    calls.push({ openParen, closeParen, distance: position >= openParen && position <= closeParen ? 0 : Math.abs(openParen - position), args });
  }
  const call = calls.sort((left, right) => left.distance - right.distance)[0];
  if (!call) {
    return undefined;
  }
  return call.args;
}

function objectLiteralFunctionProperty(source: string, property: string): string | undefined {
  const path = property.split('.');
  if (path.some((segment) => !/^[$A-Z_a-z][$\w]*$/.test(segment))) return undefined;
  let owner = source;
  for (const segment of path.slice(0, -1)) {
    const nested = objectLiteralPropertyValue(owner, segment);
    if (!nested) return undefined;
    owner = nested;
  }
  return objectLiteralDirectFunctionProperty(owner, path.at(-1) ?? '');
}

function objectLiteralPropertyValue(source: string, property: string): string | undefined {
  const trimmed = source.trim();
  if (!trimmed.startsWith('{')) return undefined;
  const close = matchingDelimiter(trimmed, 0, '{', '}');
  if (close === undefined) return undefined;
  for (const entry of splitTopLevelArguments(trimmed.slice(1, close))) {
    const candidate = entry.trim();
    const assignment = candidate.match(new RegExp(`^(?:['"]${escapeRegExp(property)}['"]|${escapeRegExp(property)})\\s*:\\s*([\\s\\S]+)$`));
    if (assignment?.[1]) return assignment[1].trim();
  }
  return undefined;
}

function objectLiteralDirectFunctionProperty(source: string, property: string): string | undefined {
  const trimmed = source.trim();
  if (!trimmed.startsWith('{')) return undefined;
  const close = matchingDelimiter(trimmed, 0, '{', '}');
  if (close === undefined) return undefined;
  for (const entry of splitTopLevelArguments(trimmed.slice(1, close))) {
    const candidate = entry.trim();
    const assignment = candidate.match(new RegExp(`^(?:['"]${escapeRegExp(property)}['"]|${escapeRegExp(property)})\\s*:\\s*([\\s\\S]+)$`));
    if (assignment?.[1]) return assignment[1].trim();
    const method = candidate.match(new RegExp(`^(async\\s+)?${escapeRegExp(property)}\\s*(\\([^)]*\\)\\s*\\{[\\s\\S]*\\})$`));
    if (method?.[2]) return `${method[1] ?? ''}function ${property}${method[2]}`;
  }
  return undefined;
}

function sourceOffsetForLineColumn(source: string, line: number, column: number): number {
  let currentLine = 1;
  let offset = 0;
  while (currentLine < line && offset < source.length) {
    if (source[offset] === '\n') {
      currentLine += 1;
    }
    offset += 1;
  }
  return Math.min(source.length, offset + Math.max(0, column - 1));
}

export function transpileApplicationCallbackExpression(source: string): string {
  const wrapped = `const __applik8sRouteHandler = (${source});\nexport { __applik8sRouteHandler };\n`;
  const output = transformSync(wrapped, { loader: 'ts', format: 'esm', target: 'node22' }).code.trim();
  const prefix = 'const __applik8sRouteHandler = ';
  const start = output.indexOf(prefix);
  const end = output.lastIndexOf(';\nexport');
  if (start < 0 || end < 0 || end <= start + prefix.length) {
    throw new Error('Generated server route source transform did not produce the expected wrapper.');
  }
  return output.slice(start + prefix.length, end).trim();
}
