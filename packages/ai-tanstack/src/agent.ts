// typecast-file-boundary: this exact-native-type facade validates the unknown
// option/context object shape before passing it through to TanStack chat().
import { type ChatMiddleware, chat } from '@tanstack/ai';

/** Runtime-only context supplied by Applik8s application composition. */
export interface ApplicationTanStackPersistenceMiddlewareContext {
  readonly applik8s: {
    readonly persistenceMiddleware: ChatMiddleware;
  };
}

/**
 * Invoke native TanStack chat() with framework-bound persistence installed
 * before application middleware. The public callable type remains exactly
 * TanStack's, so Applik8s does not invent a second agent API.
 */
export const Applik8sTanStackAgent: typeof chat = ((options: unknown) => {
  const nativeOptions = objectValue(options, 'TanStack chat options');
  const context = objectValue(
    Reflect.get(nativeOptions, 'context'),
    'TanStack runtime context',
  );
  const applik8s = objectValue(
    Reflect.get(context, 'applik8s'),
    'Applik8s TanStack runtime context',
  );
  const persistenceMiddleware = Reflect.get(applik8s, 'persistenceMiddleware');
  if (!persistenceMiddleware || typeof persistenceMiddleware !== 'object') {
    throw new TypeError('Applik8s persistence middleware is required.');
  }
  const authoredMiddleware = Reflect.get(nativeOptions, 'middleware');
  if (authoredMiddleware !== undefined && !Array.isArray(authoredMiddleware)) {
    throw new TypeError('TanStack chat middleware must be an array when supplied.');
  }
  return chat({
    ...nativeOptions,
    middleware: [
      persistenceMiddleware,
      ...(authoredMiddleware ?? []),
    ],
  } as never);
}) as typeof chat;

function objectValue(value: unknown, label: string): Record<PropertyKey, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} is required.`);
  }
  return value as Record<PropertyKey, unknown>;
}
