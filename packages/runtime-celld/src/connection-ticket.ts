import {
  type ApplicationAuthorizationReceipt,
  canonicalJsonCompatibleV1Policy,
  canonicalJsonV1String,
  canonicalJsonV1Value,
  type JsonValue,
  validateApplicationAuthorizationReceipt,
} from '@applik8s/core';
import {
  createSignedEnvelopeCodec,
  signedEnvelopeUtf8Key,
  staticSignedEnvelopeKeyProvider,
} from '@applik8s/runtime/signed-envelope';

// typecast-file-boundary: Signed JSON claims are restored only after signature, expiry, and structural validation.
/** Short-lived signed capability used only to admit one public actor WebSocket. */

export interface CelldActorConnectionTicketClaims {
  readonly schemaVersion: 'applik8s.actorConnectionTicket/v1alpha1';
  readonly actor: string;
  readonly key: string;
  readonly connectionId: string;
  readonly connect: { readonly member: string; readonly input: object };
  readonly disconnect: { readonly member: string; readonly input: object };
  readonly protocolRevision: string;
  readonly causalPrincipalId: string;
  readonly authorizationReceipt: ApplicationAuthorizationReceipt;
  readonly trustedContextDigest: string;
  readonly leaseMilliseconds: number;
  readonly nonce: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export class CelldActorConnectionTicketError extends Error {
  readonly code = 'APPLIK8S_ACTOR_CONNECTION_TICKET_INVALID';
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CelldActorConnectionTicketError';
  }
}

const CELLD_ACTOR_CONNECTION_TICKET_PURPOSE =
  'applik8s.actor-connection-ticket/v1' as const;
const CELLD_ACTOR_CONNECTION_TICKET_KEY_ID = 'actor-connection-current';
const CELLD_ACTOR_CONNECTION_TICKET_MAXIMUM_LIFETIME_MS = 300_000;
const CELLD_ACTOR_CONNECTION_TICKET_MAXIMUM_BYTES = 32_768;

export async function signCelldActorConnectionTicket(
  claims: CelldActorConnectionTicketClaims,
  secret: string,
): Promise<string> {
  validateClaims(claims, Date.now(), false);
  const issuedAt = Date.parse(claims.issuedAt);
  const expiresAt = Date.parse(claims.expiresAt);
  try {
    return await actorConnectionTicketCodec(secret, {
      now: Date.now(),
      validateTime: false,
      clockSkewMilliseconds: 0,
    }).sign(
      canonicalJsonV1Value(
        claims,
        canonicalJsonCompatibleV1Policy,
      ),
      { issuedAt, expiresAt },
    );
  } catch (cause) {
    throw connectionTicketError(cause);
  }
}

export async function verifyCelldActorConnectionTicket(
  ticket: string,
  secret: string,
  options: { readonly now?: number; readonly maximumClockSkewMilliseconds?: number } = {},
): Promise<CelldActorConnectionTicketClaims> {
  const now = options.now ?? Date.now();
  const clockSkewMilliseconds = options.maximumClockSkewMilliseconds ?? 30_000;
  try {
    const envelope = await actorConnectionTicketCodec(secret, {
      now,
      validateTime: true,
      clockSkewMilliseconds,
    }).verify(ticket);
    return validateClaims(envelope.payload, now, true, clockSkewMilliseconds);
  } catch (cause) {
    if (cause instanceof CelldActorConnectionTicketError) throw cause;
    throw connectionTicketError(cause);
  }
}

function actorConnectionTicketCodec(
  secret: string,
  options: {
    readonly now: number;
    readonly validateTime: boolean;
    readonly clockSkewMilliseconds: number;
  },
) {
  return createSignedEnvelopeCodec({
    purpose: CELLD_ACTOR_CONNECTION_TICKET_PURPOSE,
    keys: staticSignedEnvelopeKeyProvider({
      current: {
        id: CELLD_ACTOR_CONNECTION_TICKET_KEY_ID,
        key: signedEnvelopeUtf8Key(secret),
      },
    }),
    now: () => options.validateTime
      ? options.now - options.clockSkewMilliseconds
      : options.now,
    maximumLifetimeMs: CELLD_ACTOR_CONNECTION_TICKET_MAXIMUM_LIFETIME_MS,
    maximumEncodedBytes: CELLD_ACTOR_CONNECTION_TICKET_MAXIMUM_BYTES,
    validatePayload(value: JsonValue) {
      validateClaims(
        value,
        options.now,
        options.validateTime,
        options.clockSkewMilliseconds,
      );
      return value;
    },
  });
}

function validateClaims(
  value: unknown,
  now: number,
  validateTime: boolean,
  skew = 0,
): CelldActorConnectionTicketClaims {
  const claims = requiredObject(value, 'actor connection ticket') as unknown as CelldActorConnectionTicketClaims;
  if (claims.schemaVersion !== 'applik8s.actorConnectionTicket/v1alpha1') throw new CelldActorConnectionTicketError('Actor connection ticket schema version is unsupported.');
  for (const [label, candidate] of Object.entries({
    actor: claims.actor,
    key: claims.key,
    connectionId: claims.connectionId,
    protocolRevision: claims.protocolRevision,
    causalPrincipalId: claims.causalPrincipalId,
    trustedContextDigest: claims.trustedContextDigest,
    nonce: claims.nonce,
    issuedAt: claims.issuedAt,
    expiresAt: claims.expiresAt,
  })) requiredString(candidate, label);
  const receiptDiagnostics = validateApplicationAuthorizationReceipt(claims.authorizationReceipt);
  if (receiptDiagnostics.length > 0) {
    throw new CelldActorConnectionTicketError(`Actor connection ticket authorization receipt is invalid: ${receiptDiagnostics.map(({ message }) => message).join('; ')}`);
  }
  if (claims.authorizationReceipt.trustedContextDigest !== claims.trustedContextDigest) {
    throw new CelldActorConnectionTicketError('Actor connection ticket receipt does not match its trusted context.');
  }
  requiredString(claims.connect?.member, 'connect.member');
  requiredObject(claims.connect?.input, 'connect.input');
  requiredString(claims.disconnect?.member, 'disconnect.member');
  requiredObject(claims.disconnect?.input, 'disconnect.input');
  const expectedOperationId = `applik8s://actors/${claims.actor}/operations/${claims.connect.member}`;
  const expectedTarget = { kind: 'target', model: claims.actor, identity: { key: claims.key } };
  if (claims.authorizationReceipt.operationId !== expectedOperationId
    || canonicalJsonV1String(
      claims.authorizationReceipt.target,
      canonicalJsonCompatibleV1Policy,
    ) !== canonicalJsonV1String(expectedTarget, canonicalJsonCompatibleV1Policy)) {
    throw new CelldActorConnectionTicketError('Actor connection ticket receipt does not match its actor, key, and member.');
  }
  if (!Number.isSafeInteger(claims.leaseMilliseconds) || claims.leaseMilliseconds < 5_000 || claims.leaseMilliseconds > 300_000) {
    throw new CelldActorConnectionTicketError('Actor connection ticket lease must be from 5 seconds through 5 minutes.');
  }
  const issuedAt = Date.parse(claims.issuedAt);
  const expiresAt = Date.parse(claims.expiresAt);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt || expiresAt - issuedAt > 300_000) {
    throw new CelldActorConnectionTicketError('Actor connection ticket lifetime is invalid or exceeds five minutes.');
  }
  if (validateTime && (issuedAt > now + skew || expiresAt <= now - skew)) {
    throw new CelldActorConnectionTicketError('Actor connection ticket is expired or not yet valid.');
  }
  return claims;
}

function requiredObject(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CelldActorConnectionTicketError(`${label} must be an object.`);
  return value as Readonly<Record<string, unknown>>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new CelldActorConnectionTicketError(`${label} must be a non-empty string.`);
  return value;
}

function connectionTicketError(cause: unknown): CelldActorConnectionTicketError {
  const message = cause instanceof Error
    ? cause.message
    : 'Actor connection ticket validation failed.';
  return new CelldActorConnectionTicketError(
    `Actor connection ticket is invalid: ${message}`,
    { cause },
  );
}
