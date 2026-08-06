/**
 * Browser-safe TanStack AI transport surface.
 *
 * Keep this entrypoint separate from server tool adaptation so Vite never has
 * to tree-shake operation executors, durable stores, or Node cryptography out
 * of a browser graph.
 */
import type { UIMessage } from '@tanstack/ai';

export {
  type ApplicationTanStackAgentReference,
  type ApplicationTanStackConnectionOptions,
  createApplicationTanStackConnection,
} from './connection.js';

/**
 * Rehydrates the canonical conversation record without coupling the database
 * model to TanStack's transport. Rich persisted UI messages retain their
 * parts; legacy/string records receive one ordinary text part.
 */
export function hydrateApplicationConversationMessage(
  record: Readonly<{
    id: string;
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: unknown;
    createdAt: string;
  }>,
): UIMessage {
  const content = record.content;
  const contentRecord = isJsonRecord(content) ? content : undefined;
  if (
    Array.isArray(contentRecord?.parts)
    && contentRecord.parts.every(
      (part) =>
        isJsonRecord(part)
        && typeof part.type === 'string',
    )
  ) {
    return {
      id: record.id,
      role: browserRole(record.role),
      // The structural guard validates each part's browser-visible shape.
      // typecast: restore the AI SDK's discriminated UIMessage parts union.
      parts: structuredClone(contentRecord.parts) as UIMessage['parts'],
      createdAt: new Date(record.createdAt),
    };
  }
  const text = typeof content === 'string'
    ? content
    : content
      && typeof contentRecord?.content === 'string'
      ? contentRecord.content
      : JSON.stringify(content);
  return {
    id: record.id,
    role: browserRole(record.role),
    parts: [{ type: 'text', content: text }],
    createdAt: new Date(record.createdAt),
  };
}

function isJsonRecord(
  value: unknown,
): value is Readonly<Record<string, import('@applik8s/core').JsonValue>> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function browserRole(
  role: 'system' | 'user' | 'assistant' | 'tool',
): UIMessage['role'] {
  return role === 'tool' ? 'assistant' : role;
}
