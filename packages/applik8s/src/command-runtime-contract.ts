import { createHash } from 'node:crypto';
import type { ApplicationCommandKey } from './application-models.js';

export function canonicalApplicationCommandKey(value: ApplicationCommandKey): string {
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return entries.map(([key, item]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(item))}`).join('&');
  }
  return String(value);
}

export function applicationCommandScope(bindingId: string, model: string, targetKey: string, idempotencyKey: string, contextDigest: string): string {
  if (!contextDigest.trim()) throw new Error('Application command scope requires an admitted context digest.');
  return `sha256:${createHash('sha256').update(JSON.stringify(['v2', bindingId, model, targetKey, idempotencyKey, contextDigest])).digest('hex')}`;
}
