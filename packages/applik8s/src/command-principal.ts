// typecast-file-boundary: authenticated claim documents are structurally checked before conversion to the trusted principal contract.
import type { JsonObject, JsonValue } from '@applik8s/core';
import type { ApplicationQueryPrincipal } from './application-queries.js';

const principalContextKey = 'applik8s.dev/principal';
const authorizationVersionContextKey = 'applik8s.dev/authorization-version';
const maximumPrincipalBytes = 8_192;

export interface ApplicationCommandPrincipal {
  readonly id: string;
  readonly claims?: JsonObject;
  readonly authorizationVersion: string;
}

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
  if (principalContextKey in trustedContext || authorizationVersionContextKey in trustedContext) {
    throw new Error('Application identity providers may not write reserved durable command context keys.');
  }
  const claims = jsonClaims(principal.claims);
  const encodedPrincipal: JsonObject = {
    id: principal.id,
    ...(claims ? { claims } : {}),
  };
  const encoded = JSON.stringify(encodedPrincipal);
  if (Buffer.byteLength(encoded) > maximumPrincipalBytes) {
    throw new Error(`Application command principal exceeds the bounded ${maximumPrincipalBytes}-byte durable context limit.`);
  }
  return Object.freeze({
    ...trustedContext,
    [principalContextKey]: encodedPrincipal,
    [authorizationVersionContextKey]: authorizationVersion,
  });
}

/** @deprecated Prefer the transport-neutral applicationRequestContextValues name. */
export const applicationCommandContextValues = applicationRequestContextValues;

export function applicationCommandPrincipal(
  context: { readonly values: Readonly<Record<string, JsonValue>> } | undefined,
): ApplicationCommandPrincipal | undefined {
  const encoded = context?.values[principalContextKey];
  const authorizationVersion = context?.values[authorizationVersionContextKey];
  if (!isJsonObject(encoded) || typeof authorizationVersion !== 'string') return undefined;
  const id = encoded.id;
  if (typeof id !== 'string' || !id) return undefined;
  const claims = encoded.claims;
  return {
    id,
    ...(isJsonObject(claims) ? { claims } : {}),
    authorizationVersion,
  };
}

export function applicationCommandTrustedContext(
  context: { readonly values: Readonly<Record<string, JsonValue>> } | undefined,
): Readonly<Record<string, JsonValue>> {
  if (!context) return {};
  const values = { ...context.values };
  delete values[principalContextKey];
  delete values[authorizationVersionContextKey];
  return Object.freeze(values);
}

function jsonClaims(input: Readonly<Record<string, unknown>> | undefined): JsonObject | undefined {
  if (!input) return undefined;
  let encoded: string;
  try {
    encoded = JSON.stringify(input);
  } catch {
    throw new Error('Application command principal claims must be JSON-serializable.');
  }
  if (!encoded) throw new Error('Application command principal claims must be JSON-serializable.');
  const value = JSON.parse(encoded) as JsonValue;
  if (!isJsonObject(value)) {
    throw new Error('Application command principal claims must be a JSON object.');
  }
  return value;
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
