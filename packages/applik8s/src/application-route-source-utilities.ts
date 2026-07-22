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
