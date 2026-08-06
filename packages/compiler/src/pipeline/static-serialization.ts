import type { Applik8sError, JsonValue, Result } from '@applik8s/core';

export function registrationWithoutHandler<T extends object>(
  registration: T,
): Omit<T, 'handler'> {
  const result = { ...registration };
  Reflect.deleteProperty(result, 'handler');
  return result;
}

export function toSerializableJson(
  value: unknown,
  label: string,
): Result<JsonValue> {
  try {
    const serialized = JSON.stringify(value, function (key, candidate: unknown) {
      if (typeof candidate === 'function') {
        const toJSON = Reflect.get(candidate, 'toJSON');
        if (typeof toJSON === 'function') return toJSON.call(candidate);
        const properties = { ...candidate };
        if (Object.keys(properties).length > 0) return properties;
        // JSON object properties that are authoring-only methods (for example
        // normalized schema validators) are deliberately omitted. Executable
        // handlers are serialized separately before this boundary.
        if (key) return undefined;
        throw new Error(`${label} is a non-serializable function.`);
      }
      if (typeof candidate === 'symbol' || typeof candidate === 'bigint') {
        throw new Error(
          `${label} contains non-serializable ${typeof candidate} at ${jsonPath(this, key)}.`,
        );
      }
      return candidate;
    });
    if (serialized === undefined) {
      return error(`${label} is not JSON-serializable.`);
    }
    // typecast: JSON.parse establishes the recursive JsonValue boundary.
    return { ok: true, value: JSON.parse(serialized) as JsonValue };
  } catch (cause) {
    return error(
      cause instanceof Error
        ? cause.message
        : `${label} is not JSON-serializable.`,
    );
  }
}

function jsonPath(holder: unknown, key: string): string {
  if (!key) return '$';
  if (Array.isArray(holder)) return `$[${key}]`;
  return `$.${key}`;
}

function error<T = never>(message: string): Result<T> {
  const diagnostic: Applik8sError = {
    code: 'BUNDLE_INVALID',
    message,
    severity: 'error',
    context: {},
    recovery: { summary: message },
  };
  return { ok: false, error: diagnostic };
}
