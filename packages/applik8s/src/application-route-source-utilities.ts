import * as nodeModule from 'node:module';
import { applicationTransformSync } from './application-build-tool.js';

export function normalizeSerializableFunctionSource(source: string): string {
  if (/^async\s*\(/.test(source)) {
    return source.replace(/^async\s*\(/, 'async (');
  }
  return /^[$A-Z_a-z][$\w]*\s*\(/.test(source) ? `function ${source}` : source;
}

export function transpileApplicationCallbackExpression(source: string): string {
  const normalized = normalizeSerializableFunctionSource(source.trim());
  try {
    Function(`return (${normalized});`);
    return normalized;
  } catch {
    // Authored callback metadata can retain TypeScript annotations. Production
    // Node runtimes have a built-in syntax eraser, while Bun-based authoring
    // and older supported tool hosts fall back to the package's build-time
    // esbuild dependency. Resolve esbuild dynamically so it is not bundled
    // into every generated operation image (where its worker-thread bootstrap
    // is both unnecessary and invalid inside a single-file ESM artifact).
  }
  const wrapped = `const __applik8sRouteHandler = (${source});\nexport { __applik8sRouteHandler };\n`;
  const stripTypeScriptTypes = Reflect.get(nodeModule, 'stripTypeScriptTypes');
  const output = typeof stripTypeScriptTypes === 'function'
    ? String(stripTypeScriptTypes(wrapped, { mode: 'transform' })).trim()
    : applicationBuildToolTransform(wrapped, 'ts');
  const prefix = 'const __applik8sRouteHandler = ';
  const start = output.indexOf(prefix);
  const end = output.lastIndexOf(';\nexport');
  if (start < 0 || end < 0 || end <= start + prefix.length) {
    throw new Error('Generated server route source transform did not produce the expected wrapper.');
  }
  return output.slice(start + prefix.length, end).trim();
}

function applicationBuildToolTransform(
  source: string,
  loader: 'js' | 'jsx' | 'ts' | 'tsx',
): string {
  return applicationTransformSync(
    source,
    { loader, format: 'esm', target: 'node22' },
  ).code.trim();
}

export function transpileApplicationRouteModuleForDependencies(source: string, file: string): string {
  try {
    const loader = file.endsWith('.tsx')
      ? 'tsx'
      : file.endsWith('.jsx')
        ? 'jsx'
        : file.endsWith('.js') || file.endsWith('.mjs') || file.endsWith('.cjs')
          ? 'js'
          : 'ts';
    if (loader === 'js') return source;
    const stripTypeScriptTypes = Reflect.get(nodeModule, 'stripTypeScriptTypes');
    if (loader === 'ts' && typeof stripTypeScriptTypes === 'function') {
      return String(stripTypeScriptTypes(source, { mode: 'transform' }));
    }
    return applicationBuildToolTransform(source, loader);
  } catch (_error) {
    return source;
  }
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export function lineCommentEnd(source: string, start: number): number {
  const end = source.indexOf('\n', start + 2);
  return end < 0 ? source.length : end + 1;
}

export function blockCommentEnd(source: string, start: number): number {
  const end = source.indexOf('*/', start + 2);
  return end < 0 ? source.length : end + 2;
}

export function regexLiteralEnd(source: string, start: number): number {
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
      while (index < source.length && /[a-z]/i.test(source[index] ?? '')) index += 1;
      return index;
    } else if (character === '\n' || character === '\r') {
      return start + 1;
    }
    index += 1;
  }
  return source.length;
}

export function isRegexLiteralStart(source: string, index: number): boolean {
  const previous = previousNonWhitespace(source, index);
  if (previous === undefined || ['(', ',', '=', ':', '[', '{', '!', '?', ';', '&', '|'].includes(previous)) return true;
  return /(?:^|[^\w$])(?:return|throw|case|delete|typeof|void|yield|await)\s*$/.test(source.slice(0, index));
}

export function previousNonWhitespace(source: string, index: number): string | undefined {
  for (let position = index - 1; position >= 0; position -= 1) {
    if (!/\s/.test(source[position] ?? '')) return source[position];
  }
  return undefined;
}

export function nextNonWhitespace(source: string, index: number): string | undefined {
  for (let position = index; position < source.length; position += 1) {
    if (!/\s/.test(source[position] ?? '')) return source[position];
  }
  return undefined;
}

export function isDeclarationIdentifier(source: string, index: number, name: string): boolean {
  const prefix = source.slice(Math.max(0, index - 32), index);
  return /(?:const|let|var|function)\s+$/.test(prefix) || /catch\s*\(\s*$/.test(prefix) || /for\s*\(\s*(?:const|let|var)\s+$/.test(prefix) || prefix.endsWith(`${name}.`);
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
    if (character === '(') parens += 1;
    else if (character === ')') parens -= 1;
    else if (character === '{') braces += 1;
    else if (character === '}') braces -= 1;
    else if (character === '[') brackets += 1;
    else if (character === ']') brackets -= 1;
    else if (character === ',' && parens === 0 && braces === 0 && brackets === 0) {
      args.push(source.slice(start, index));
      start = index + 1;
    }
    index += 1;
  }
  args.push(source.slice(start));
  return args;
}

export function matchingDelimiter(
  source: string,
  openIndex: number,
  open: string,
  close: string,
): number | undefined {
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
    if (character === open) depth += 1;
    else if (character === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
    index += 1;
  }
  return undefined;
}

export function quotedSourceEnd(source: string, start: number, quote: string): number {
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === '\\') {
      index += 2;
      continue;
    }
    if (source[index] === quote) return index + 1;
    index += 1;
  }
  return source.length;
}

export function templateSourceEnd(source: string, start: number): number {
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
    if (source[index] === '`') return index + 1;
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
    if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
    index += 1;
  }
  return source.length;
}
