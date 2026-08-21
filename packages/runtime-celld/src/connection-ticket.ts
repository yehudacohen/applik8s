import { validateApplicationAuthorizationReceipt, type ApplicationAuthorizationReceipt } from '@applik8s/core';

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

export async function signCelldActorConnectionTicket(
  claims: CelldActorConnectionTicketClaims,
  secret: string,
): Promise<string> {
  validateClaims(claims, Date.now(), false);
  const payload = base64Url(new TextEncoder().encode(canonicalJson(claims)));
  const signature = new Uint8Array(await crypto.subtle.sign(
    'HMAC',
    await hmacKey(secret, ['sign']),
    new TextEncoder().encode(payload),
  ));
  return `${payload}.${base64Url(signature)}`;
}

export async function verifyCelldActorConnectionTicket(
  ticket: string,
  secret: string,
  options: { readonly now?: number; readonly maximumClockSkewMilliseconds?: number } = {},
): Promise<CelldActorConnectionTicketClaims> {
  const [payload, signature, extra] = ticket.split('.');
  if (!payload || !signature || extra !== undefined) throw new CelldActorConnectionTicketError('Actor connection ticket must contain one payload and signature.');
  let signatureBytes: Uint8Array;
  let value: unknown;
  try {
    signatureBytes = fromBase64Url(signature);
    value = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
  } catch (cause) {
    throw new CelldActorConnectionTicketError('Actor connection ticket is not valid base64url JSON.', { cause });
  }
  const valid = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(secret, ['verify']),
    new Uint8Array([...signatureBytes]),
    new TextEncoder().encode(payload),
  );
  if (!valid) throw new CelldActorConnectionTicketError('Actor connection ticket signature is invalid.');
  const claims = validateClaims(value, options.now ?? Date.now(), true, options.maximumClockSkewMilliseconds ?? 30_000);
  return claims;
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
    || canonicalJson(claims.authorizationReceipt.target) !== canonicalJson(expectedTarget)) {
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

async function hmacKey(secret: string, usages: readonly KeyUsage[]): Promise<CryptoKey> {
  if (secret.length < 32) throw new CelldActorConnectionTicketError('Actor connection signing key must contain at least 32 characters.');
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usages);
}

function base64Url(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function fromBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new TypeError('invalid base64url');
  const standard = value.replaceAll('-', '+').replaceAll('_', '/');
  const decoded = atob(standard.padEnd(standard.length + ((4 - standard.length % 4) % 4), '='));
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(',')}}`;
}

function requiredObject(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CelldActorConnectionTicketError(`${label} must be an object.`);
  return value as Readonly<Record<string, unknown>>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new CelldActorConnectionTicketError(`${label} must be a non-empty string.`);
  return value;
}
