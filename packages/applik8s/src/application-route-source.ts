import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

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
    ...bindingNames,
    ...analysis.declaredIdentifiers,
    'Array',
    'AbortController',
    'Boolean',
    'Date',
    'Error',
    'Headers',
    'JSON',
    'Math',
    'Number',
    'Object',
    'Promise',
    'RegExp',
    'Response',
    'String',
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
  const topLevelBindings = applicationRouteTopLevelBindings(fileSource, bindingNames);
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
      const nested = unsupportedRouteFreeIdentifiers(analyzeApplicationServerRouteSource(binding.analysisSource), new Set([...bindingNames, ...included.keys()]));
      for (const nestedName of nested) {
        if (!included.has(nestedName) && !unresolved.has(nestedName)) {
          queue.push(nestedName);
        }
      }
    }
  }
  if (unresolved.size > 0) return undefined;
  const imports = unique([...included.values()].filter((binding) => binding.kind === 'import').map((binding) => binding.source));
  const declarations = unique([...included.values()].filter((binding) => binding.kind === 'declaration').map((binding) => binding.source));
  return { source: [...imports, ...declarations].join('\n\n'), resolveDir: dirname(file) };
}

const applicationRouteSourceModulePath = fileURLToPath(import.meta.url);
const applicationDslModulePath = applicationRouteSourceModulePath.replace(/application-route-source(\.[cm]?[jt]sx?)$/, 'application$1');

export function extractApplicationRouteHandlerSource(method: ApplicationRouteSourceRoute['method']): { readonly source: string; readonly location: ApplicationRouteSourceLocation } | undefined {
  return extractApplicationCallArgumentSource(method.toLowerCase(), 1, true);
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
      return { source: transpileRouteHandlerExpression(expression), location };
    } catch (error) {
      debugRouteSourceExtraction(error instanceof Error ? error.message : String(error));
    }
  }
  return undefined;
}

export function splitTopLevelArguments(source: string): readonly string[] {
  const args: string[] = [];
  let start = 0;
  let index = 0;
  let parens = 0;
  let braces = 0;
  let brackets = 0;
  while (index < source.length) {
    const character = source[index];
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
    } else if (character === ',' && parens === 0 && braces === 0 && brackets === 0) {
      args.push(source.slice(start, index));
      start = index + 1;
    }
    index += 1;
  }
  args.push(source.slice(start));
  return args;
}

export function matchingDelimiter(source: string, openIndex: number, open: string, close: string): number | undefined {
  let depth = 0;
  let index = openIndex;
  while (index < source.length) {
    const character = source[index];
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
    if (character === open) {
      depth += 1;
    } else if (character === close) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
    index += 1;
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

function applicationRouteTopLevelBindings(source: string, bindingNames: ReadonlySet<string>): ReadonlyMap<string, ApplicationRouteTopLevelBinding> {
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
          bindings.set(name, { name, source: importBinding.source, analysisSource: importBinding.source, kind: 'import' });
        }
        index = importBinding.end;
        continue;
      }
      const declaration = topLevelDeclarationBindingAt(source, index, bindingNames);
      if (declaration) {
        for (const name of declaration.names) {
          bindings.set(name, { name, source: declaration.source, analysisSource: transpileRouteDependencySourceForAnalysis(declaration.source), kind: 'declaration' });
        }
        index = declaration.end;
        continue;
      }
    }
    index += 1;
  }
  return bindings;
}

function transpileRouteDependencySourceForAnalysis(source: string): string {
  try {
    return transformSync(source, { loader: 'ts', format: 'esm', target: 'node22' }).code;
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
    const open = source.indexOf('{', index + functionMatch[0].length);
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
  const names: string[] = [];
  const body = source.replace(/^(?:const|let|var)\s+/, '').replace(/;\s*$/, '');
  for (const part of splitTopLevelArguments(body)) {
    const name = part.trim().match(/^([A-Za-z_$][\w$]*)\b/)?.[1];
    if (name) {
      names.push(name);
    }
  }
  return names;
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
  'false',
  'finally',
  'for',
  'function',
  'if',
  'in',
  'instanceof',
  'let',
  'new',
  'null',
  'of',
  'return',
  'switch',
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
  for (const match of source.matchAll(/\(([^)]*)\)\s*=>/g)) {
    addParameterIdentifiers(declared, match[1] ?? '');
  }
  for (const match of source.matchAll(/\(\s*([A-Za-z_$][\w$]*)\s*\)\s*=>/g)) {
    declared.add(match[1] ?? '');
  }
  for (const match of source.matchAll(/\b([A-Za-z_$][\w$]*)\s*=>/g)) {
    declared.add(match[1] ?? '');
  }
  for (const match of source.matchAll(/\b(?:const|let|var)\s+/g)) {
    const start = match.index ?? 0;
    const end = statementSourceEnd(source, start);
    for (const name of variableDeclarationNames(source.slice(start, end))) declared.add(name);
  }
  for (const match of source.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)/g)) {
    declared.add(match[1] ?? '');
  }
  for (const match of source.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/g)) {
    declared.add(match[1] ?? '');
  }
  for (const match of source.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) {
    declared.add(match[1] ?? '');
  }
  declared.delete('');
  return declared;
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
  return /\bat (?:extractApplicationRouteHandlerSource|extractApplicationCallArgumentSource|applicationRouteCallsiteLocations?|record|Object\.(?:get|post))\b/.test(line);
}

function callArgumentExpressionAtLocation(source: string, location: ApplicationRouteSourceLocation, methodName: string, argumentIndex: number, requireLiteralFirstArgument: boolean): string | undefined {
  const position = sourceOffsetForLineColumn(source, location.line, location.column);
  const searchStart = Math.max(0, position - 4000);
  const searchEnd = Math.min(source.length, position + 8000);
  const windowSource = source.slice(searchStart, searchEnd);
  const calls: { readonly openParen: number; readonly closeParen: number; readonly distance: number; readonly handlerSource: string }[] = [];
  const callPattern = new RegExp(`\\.\\s*${methodName}\\s*\\(`, 'g');
  for (const match of windowSource.matchAll(callPattern)) {
    const openParen = searchStart + (match.index ?? 0) + match[0].lastIndexOf('(');
    const closeParen = matchingDelimiter(source, openParen, '(', ')');
    if (closeParen === undefined) {
      continue;
    }
    const args = splitTopLevelArguments(source.slice(openParen + 1, closeParen));
    const firstArgument = args[0]?.trim() ?? '';
    const handlerSource = args[argumentIndex]?.trim();
    if (!handlerSource || (argumentIndex >= 1 && !/(?:=>|^\s*(?:async\s+)?function\b)/.test(handlerSource)) || (requireLiteralFirstArgument && !/^['"`]/.test(firstArgument))) {
      continue;
    }
    calls.push({ openParen, closeParen, distance: position >= openParen && position <= closeParen ? 0 : Math.abs(openParen - position), handlerSource });
  }
  const call = calls.sort((left, right) => left.distance - right.distance)[0];
  if (!call) {
    return undefined;
  }
  return call.handlerSource;
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

function transpileRouteHandlerExpression(source: string): string {
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

function quotedSourceEnd(source: string, start: number, quote: string): number {
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === '\\') {
      index += 2;
      continue;
    }
    if (source[index] === quote) {
      return index + 1;
    }
    index += 1;
  }
  return source.length;
}

function templateSourceEnd(source: string, start: number): number {
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === '\\') {
      index += 2;
      continue;
    }
    if (source[index] === '$' && source[index + 1] === '{') {
      index = templateExpressionSourceEnd(source, index + 2);
      continue;
    }
    if (source[index] === '`') {
      return index + 1;
    }
    index += 1;
  }
  return source.length;
}

function templateExpressionSourceEnd(source: string, start: number): number {
  let depth = 1;
  let index = start;
  while (index < source.length) {
    const character = source[index];
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
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
    index += 1;
  }
  return source.length;
}

function lineCommentEnd(source: string, start: number): number {
  const end = source.indexOf('\n', start + 2);
  return end < 0 ? source.length : end + 1;
}

function blockCommentEnd(source: string, start: number): number {
  const end = source.indexOf('*/', start + 2);
  return end < 0 ? source.length : end + 2;
}

function regexLiteralEnd(source: string, start: number): number {
  let index = start + 1;
  let inCharacterClass = false;
  while (index < source.length) {
    const character = source[index];
    if (character === '\\') {
      index += 2;
      continue;
    }
    if (character === '[') {
      inCharacterClass = true;
    } else if (character === ']') {
      inCharacterClass = false;
    } else if (character === '/' && !inCharacterClass) {
      index += 1;
      while (index < source.length && /[a-z]/i.test(source[index] ?? '')) {
        index += 1;
      }
      return index;
    } else if (character === '\n' || character === '\r') {
      return start + 1;
    }
    index += 1;
  }
  return source.length;
}

function isRegexLiteralStart(source: string, index: number): boolean {
  const previous = previousNonWhitespace(source, index);
  if (previous === undefined || ['(', ',', '=', ':', '[', '{', '!', '?', ';', '&', '|'].includes(previous)) return true;
  return /(?:^|[^\w$])(?:return|throw|case|delete|typeof|void|yield|await)\s*$/.test(source.slice(0, index));
}

function previousNonWhitespace(source: string, index: number): string | undefined {
  for (let position = index - 1; position >= 0; position -= 1) {
    if (!/\s/.test(source[position] ?? '')) {
      return source[position];
    }
  }
  return undefined;
}

function nextNonWhitespace(source: string, index: number): string | undefined {
  for (let position = index; position < source.length; position += 1) {
    if (!/\s/.test(source[position] ?? '')) {
      return source[position];
    }
  }
  return undefined;
}

function isDeclarationIdentifier(source: string, index: number, name: string): boolean {
  const prefix = source.slice(Math.max(0, index - 32), index);
  return /(?:const|let|var|function)\s+$/.test(prefix) || /catch\s*\(\s*$/.test(prefix) || /for\s*\(\s*(?:const|let|var)\s+$/.test(prefix) || prefix.endsWith(`${name}.`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
