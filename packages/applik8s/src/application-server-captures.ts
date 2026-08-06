import type { JsonValue } from '@applik8s/core';
import {
  analyzeApplicationServerRouteSource,
  normalizeSerializableFunctionSource,
  unsupportedRouteFreeIdentifiers,
} from './application-route-source.js';

export type SerializedApplicationServerCapture =
  | { readonly kind: 'json'; readonly value: JsonValue }
  | {
      readonly kind: 'function';
      readonly source: string;
      readonly aliasName?: string;
    };

export type SerializedApplicationServerCaptures = Readonly<
  Record<string, SerializedApplicationServerCapture>
>;

export function serializeApplicationServerCaptures(
  captures: Readonly<Record<string, unknown>>,
): SerializedApplicationServerCaptures {
  const names = Object.keys(captures);
  const available = new Set(names);
  const serialized: Record<string, SerializedApplicationServerCapture> = {};
  const aliases = new Map<string, string>();

  for (const [name, value] of Object.entries(captures)) {
    assertCaptureName(name);
    if (typeof value === 'function') {
      const source = normalizeSerializableFunctionSource(value.toString().trim());
      try {
        Function(`return (${source});`);
      } catch (error) {
        throw new Error(
          `app.server capture ${JSON.stringify(name)} must be a serializable function expression: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      const unsupported = unsupportedRouteFreeIdentifiers(
        analyzeApplicationServerRouteSource(source),
        available,
      );
      if (unsupported.length > 0) {
        throw new Error(
          `app.server capture ${JSON.stringify(name)} references module-scope identifier(s) that are not available inside the generated runtime: ${unsupported.join(', ')}`,
        );
      }
      const functionName = value.name;
      const aliasName =
        functionName
        && functionName !== name
        && /^[$A-Z_a-z][$\w]*$/.test(functionName)
          ? functionName
          : undefined;
      if (aliasName) {
        const owner = aliases.get(aliasName) ?? (available.has(aliasName) ? aliasName : undefined);
        if (owner) {
          throw new Error(
            `app.server capture ${JSON.stringify(name)} function alias ${JSON.stringify(aliasName)} conflicts with capture ${JSON.stringify(owner)}.`,
          );
        }
        aliases.set(aliasName, name);
      }
      serialized[name] = {
        kind: 'function',
        source,
        ...(aliasName ? { aliasName } : {}),
      };
      continue;
    }
    serialized[name] = { kind: 'json', value: jsonCapture(name, value) };
  }

  return Object.freeze(serialized);
}

export function serializedApplicationServerCaptureAliases(
  captures: SerializedApplicationServerCaptures,
): Readonly<Record<string, true>> {
  const aliases: Record<string, true> = {};
  for (const capture of Object.values(captures)) {
    if (capture.kind === 'function' && capture.aliasName) {
      aliases[capture.aliasName] = true;
    }
  }
  return Object.freeze(aliases);
}

function assertCaptureName(name: string): void {
  if (!/^[$A-Z_a-z][$\w]*$/.test(name)) {
    throw new Error(
      `app.server capture ${JSON.stringify(name)} must be a valid JavaScript identifier.`,
    );
  }
}

function jsonCapture(name: string, value: unknown): JsonValue {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(value);
  } catch (error) {
    throw new Error(
      `app.server capture ${JSON.stringify(name)} must be JSON serializable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (encoded === undefined) {
    throw new Error(
      `app.server capture ${JSON.stringify(name)} must be JSON serializable.`,
    );
  }
  // typecast: a successful JSON stringify/parse round trip establishes the framework's JsonValue runtime boundary.
  return JSON.parse(encoded) as JsonValue;
}
