// typecast-file-boundary: canonical principals are structurally checked before crossing the durable JSON boundary.
import type { ApplicationPrincipal, JsonObject, JsonValue } from '@applik8s/core';
import type { ApplicationQueryPrincipal } from './application-queries.js';

const principalContextKey = 'applik8s.dev/principal';
const maximumPrincipalBytes = 8_192;

export type ApplicationCommandPrincipal = ApplicationPrincipal;

/**
 * Adds gateway-established identity to the opaque context shared by commands,
 * queries, changes, streams, and cursors. Every transport must derive the same
 * digest from these values or an admitted mutation becomes invisible to its
 * caller's subscription.
 */
export function applicationRequestContextValues(
  principal: ApplicationQueryPrincipal,
  authorizationVersion: string,
  trustedContext: Readonly<Record<string, JsonValue>>,
): Readonly<Record<string, JsonValue>> {
  if (principalContextKey in trustedContext) {
    throw new Error('Application identity providers may not write reserved durable command context keys.');
  }
  if (authorizationVersion !== principal.authorityRevision) {
    throw new Error('Application principal and authorization revision disagree.');
  }
  const encodedPrincipal = jsonPrincipal(principal);
  const encoded = JSON.stringify(encodedPrincipal);
  if (Buffer.byteLength(encoded) > maximumPrincipalBytes) {
    throw new Error(`Application command principal exceeds the bounded ${maximumPrincipalBytes}-byte durable context limit.`);
  }
  return Object.freeze({
    ...trustedContext,
    [principalContextKey]: encodedPrincipal,
  });
}

export function applicationCommandPrincipal(
  context: { readonly values: Readonly<Record<string, JsonValue>> } | undefined,
): ApplicationCommandPrincipal | undefined {
  const encoded = context?.values[principalContextKey];
  return isApplicationPrincipal(encoded) ? encoded : undefined;
}

/**
 * Restores the reserved principal key inside a framework delivery context.
 *
 * Stream sources strip the key from the handler-visible trusted context so
 * application code never observes it; framework hops fold it back when the
 * durable command kernel receives the carried lineage.
 */
export function applicationCommandPrincipalValues(
  principal: ApplicationCommandPrincipal,
): Readonly<Record<string, JsonValue>> {
  return Object.freeze({ [principalContextKey]: jsonPrincipal(principal) });
}

/**
 * Returns the trusted ownership-attribution principal for one durable command.
 *
 * The immediate execution principal remains the authorization actor.
 * Framework-admitted executions and canonical durable-task service principals
 * may redirect attribution to their causal requester; ordinary request and
 * service principals attribute to themselves.
 */
export function applicationCommandCausalPrincipalId(
  principal: ApplicationCommandPrincipal | undefined,
): string | undefined {
  if (!principal) return undefined;
  const frameworkManaged = principal.kind === 'execution'
    || (
      principal.kind === 'service'
      && principal.authenticationMethod.startsWith(
        'applik8s-task-service-principal/',
      )
    );
  if (!frameworkManaged) return principal.id;
  const causalPrincipalId = Reflect.get(principal, 'causalPrincipalId');
  return typeof causalPrincipalId === 'string' && causalPrincipalId.trim()
    ? causalPrincipalId
    : undefined;
}

export function applicationCommandTrustedContext(
  context: { readonly values: Readonly<Record<string, JsonValue>> } | undefined,
): Readonly<Record<string, JsonValue>> {
  if (!context) return {};
  const values = { ...context.values };
  delete values[principalContextKey];
  return Object.freeze(values);
}

function jsonPrincipal(input: ApplicationPrincipal): JsonObject {
  let encoded: string;
  try {
    encoded = JSON.stringify(input);
  } catch {
    throw new Error('Application command principal must be JSON-serializable.');
  }
  if (!encoded) throw new Error('Application command principal must be JSON-serializable.');
  const value = JSON.parse(encoded) as JsonValue;
  if (!isApplicationPrincipal(value)) {
    throw new Error('Application command principal does not satisfy the canonical principal contract.');
  }
  return value;
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isApplicationPrincipal(value: JsonValue | undefined): value is ApplicationPrincipal & JsonObject {
  if (!isJsonObject(value) || !isJsonObject(value.identity)) return false;
  const identity = value.identity;
  return nonEmpty(value.id)
    && nonEmpty(value.kind)
    && nonEmpty(value.authenticationMethod)
    && stringArray(value.audience)
    && (value.roles === undefined || stringArray(value.roles))
    && (value.attributes === undefined || isJsonObject(value.attributes))
    && nonEmpty(value.trustedContextDigest)
    && nonEmpty(value.catalogRevision)
    && nonEmpty(value.authorityRevision)
    && validTimestamp(value.admittedAt)
    && (value.expiresAt === undefined || validTimestamp(value.expiresAt))
    && nonEmpty(identity.id)
    && nonEmpty(identity.kind)
    && nonEmpty(identity.issuer)
    && nonEmpty(identity.subject);
}

function nonEmpty(value: JsonValue | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function stringArray(value: JsonValue | undefined): value is string[] {
  return Array.isArray(value) && value.every(nonEmpty);
}

function validTimestamp(value: JsonValue | undefined): value is string {
  return nonEmpty(value) && Number.isFinite(Date.parse(value));
}
