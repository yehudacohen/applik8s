import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

export async function digestFile(path: string): Promise<string> {
  return `sha256:${createHash('sha256').update(await readFile(path)).digest('hex')}`;
}

export function safePathSegment(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9_.-]/g, '-');
  if (sanitized.length <= 120) return sanitized;
  const digest = createHash('sha256').update(value).digest('hex').slice(0, 24);
  return `${sanitized.slice(0, 95)}-${digest}`;
}

export function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
