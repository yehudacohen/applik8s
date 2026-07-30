// typecast-file-boundary: Drizzle's generic table metadata is promoted into an equivalent model type after runtime table validation.
import { type SQL, sql } from 'drizzle-orm';

const authenticatedPrincipalDefault = Symbol.for('@applik8s/drizzle-authenticated-principal-default');

export type ApplicationAuthenticatedPrincipalDefault = SQL<string> & {
  readonly [authenticatedPrincipalDefault]: true;
};

/**
 * PostgreSQL default established from the gateway-admitted durable principal.
 *
 * When this default is also the scalar model identity, Applik8s derives the
 * command partition key from that principal and initializes the row with the
 * same value. The browser therefore omits actor identity without sacrificing
 * deterministic routing, idempotency, or relational primary-key fidelity.
 */
export const authenticatedPrincipalId = sql<string>`nullif(current_setting('applik8s.principal.id', true), '')` as ApplicationAuthenticatedPrincipalDefault;
Object.defineProperty(authenticatedPrincipalId, authenticatedPrincipalDefault, {
  value: true,
  enumerable: false,
  configurable: false,
  writable: false,
});

export function isApplicationAuthenticatedPrincipalDefault(value: unknown): value is ApplicationAuthenticatedPrincipalDefault {
  if (!value || typeof value !== 'object') return false;
  if (Reflect.get(value, authenticatedPrincipalDefault) === true) return true;
  // Vite/Drizzle can recreate SQL wrappers while evaluating an application
  // entrypoint. Recognize only the exact fail-closed SQL emitted above; nearby
  // current_setting expressions must not silently gain identity semantics.
  const chunks = Reflect.get(value, 'queryChunks');
  if (!Array.isArray(chunks)) return false;
  return chunks.some((chunk) => {
    if (!chunk || typeof chunk !== 'object') return false;
    const text = Reflect.get(chunk, 'value');
    return Array.isArray(text)
      && text.join('') === "nullif(current_setting('applik8s.principal.id', true), '')";
  });
}
