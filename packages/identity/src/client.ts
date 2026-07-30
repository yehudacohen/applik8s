import type { ApplicationIdentityReference, ApplicationPrincipal } from '@applik8s/core';
import type { ApplicationPreAuthenticationFlowKind } from './contracts.js';
export type { ApplicationPreAuthenticationFlowKind } from './contracts.js';

// typecast: the literal protocol identity must remain narrow in every public response discriminator.
export const applicationIdentityHttpProtocol = 'applik8s.identityHttp/v1alpha1' as const;

export type ApplicationIdentityPublicErrorCode =
  | 'invalid_request'
  | 'flow_expired'
  | 'flow_consumed'
  | 'continuity_lost'
  | 'rate_limited'
  | 'authentication_required'
  | 'authorization_required'
  | 'provider_unavailable'
  | 'conflict'
  | 'internal_error';

export interface ApplicationIdentityPublicError {
  readonly protocol: typeof applicationIdentityHttpProtocol;
  readonly kind: 'error';
  readonly code: ApplicationIdentityPublicErrorCode;
  /** Enumeration-safe message suitable for an end-user surface. */
  readonly message: string;
  readonly retryable: boolean;
  readonly retryAfterSeconds?: number;
}

export interface ApplicationIdentitySessionView {
  readonly protocol: typeof applicationIdentityHttpProtocol;
  readonly kind: 'session';
  readonly authenticated: boolean;
  readonly principal?: Pick<
    ApplicationPrincipal,
    | 'id'
    | 'identity'
    | 'kind'
    | 'authenticationMethod'
    | 'audience'
    | 'admittedAt'
    | 'expiresAt'
    | 'sessionId'
  >;
  readonly assurance: readonly string[];
}

export interface ApplicationIdentityFlowView {
  readonly protocol: typeof applicationIdentityHttpProtocol;
  readonly kind: 'flow';
  readonly id: string;
  readonly flowKind: ApplicationPreAuthenticationFlowKind;
  readonly state: 'active' | 'complete' | 'cancelled';
  readonly allowedTransitions: readonly string[];
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly continuationUri?: string;
}

export interface ApplicationIdentityAccountView {
  readonly protocol: typeof applicationIdentityHttpProtocol;
  readonly kind: 'account';
  readonly identity: ApplicationIdentityReference;
  readonly authenticationMethods: readonly string[];
  readonly assurance: readonly string[];
  readonly mfa: readonly ApplicationIdentityMfaMethodView[];
}

export interface ApplicationIdentityMfaMethodView {
  readonly id: string;
  readonly kind: 'totp' | 'webauthn' | 'recovery-code' | 'provider';
  readonly label?: string;
  readonly createdAt?: string;
}

export interface ApplicationIdentityMfaEnrollmentView {
  readonly protocol: typeof applicationIdentityHttpProtocol;
  readonly kind: 'mfa-enrollment';
  readonly id: string;
  readonly method: ApplicationIdentityMfaMethodView['kind'];
  readonly expiresAt: string;
  /** Display-only setup material; provider payloads and credentials remain server-side. */
  readonly setup?: {
    readonly uri?: string;
    readonly recoveryCodes?: readonly string[];
    readonly challenge?: string;
  };
}

export interface ApplicationOAuthConsentView {
  readonly protocol: typeof applicationIdentityHttpProtocol;
  readonly kind: 'consent';
  readonly id: string;
  readonly client: {
    readonly id: string;
    readonly name: string;
    readonly revision: string;
  };
  readonly scopes: readonly { readonly name: string; readonly description?: string }[];
  readonly resources: readonly string[];
  readonly audience: readonly string[];
  readonly expiresAt: string;
}

export interface ApplicationOAuthClientView {
  readonly protocol: typeof applicationIdentityHttpProtocol;
  readonly kind: 'oauth-client';
  readonly id: string;
  readonly name: string;
  readonly type: 'public' | 'confidential' | 'service';
  readonly redirectUris: readonly string[];
  readonly allowedScopes: readonly string[];
  readonly revision: string;
  readonly state: 'active' | 'revoked';
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ApplicationOAuthClientCredential {
  readonly protocol: typeof applicationIdentityHttpProtocol;
  readonly kind: 'oauth-client-credential';
  readonly client: ApplicationOAuthClientView;
  /** Returned exactly once by create/rotate. */
  readonly secret?: string;
}

export interface ApplicationIdentityClientOptions {
  readonly baseUrl?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly credentials?: RequestCredentials;
  readonly maxResponseBytes?: number;
}

export interface ApplicationIdentityClient {
  session(options?: { readonly signal?: AbortSignal }): Promise<ApplicationIdentitySessionView>;
  beginFlow(
    kind: ApplicationPreAuthenticationFlowKind,
    input?: Readonly<Record<string, unknown>>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ApplicationIdentityFlowView>;
  transitionFlow(
    flowId: string,
    transition: string,
    input?: Readonly<Record<string, unknown>>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ApplicationIdentityFlowView | ApplicationIdentitySessionView>;
  cancelFlow(flowId: string, options?: { readonly signal?: AbortSignal }): Promise<ApplicationIdentityFlowView>;
  logout(options?: { readonly signal?: AbortSignal }): Promise<ApplicationIdentitySessionView>;
  account(options?: { readonly signal?: AbortSignal }): Promise<ApplicationIdentityAccountView>;
  updateAccount(
    input: Readonly<Record<string, unknown>>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ApplicationIdentityAccountView>;
  beginMfa(
    method: ApplicationIdentityMfaMethodView['kind'],
    options?: { readonly signal?: AbortSignal },
  ): Promise<ApplicationIdentityMfaEnrollmentView>;
  completeMfa(
    enrollmentId: string,
    input: Readonly<Record<string, unknown>>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ApplicationIdentityAccountView>;
  removeMfa(methodId: string, options?: { readonly signal?: AbortSignal }): Promise<ApplicationIdentityAccountView>;
  consent(consentId: string, options?: { readonly signal?: AbortSignal }): Promise<ApplicationOAuthConsentView>;
  decideConsent(
    consentId: string,
    decision: 'approve' | 'deny',
    options?: { readonly signal?: AbortSignal },
  ): Promise<{ readonly continuationUri: string }>;
  clients(options?: { readonly signal?: AbortSignal }): Promise<readonly ApplicationOAuthClientView[]>;
  createClient(
    input: {
      readonly name: string;
      readonly type: ApplicationOAuthClientView['type'];
      readonly redirectUris: readonly string[];
      readonly allowedScopes: readonly string[];
    },
    options?: { readonly signal?: AbortSignal },
  ): Promise<ApplicationOAuthClientCredential>;
  rotateClient(clientId: string, options?: { readonly signal?: AbortSignal }): Promise<ApplicationOAuthClientCredential>;
  revokeClient(clientId: string, options?: { readonly signal?: AbortSignal }): Promise<ApplicationOAuthClientView>;
}

export class ApplicationIdentityClientError extends Error {
  readonly code: ApplicationIdentityPublicErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly retryAfterSeconds: number | undefined;

  constructor(error: ApplicationIdentityPublicError, status: number) {
    super(error.message);
    this.name = 'ApplicationIdentityClientError';
    this.code = error.code;
    this.status = status;
    this.retryable = error.retryable;
    this.retryAfterSeconds = error.retryAfterSeconds;
  }
}

/** Browser-safe identity client. Provider sessions and provider-native payloads never cross this seam. */
export function createApplicationIdentityClient(
  options: ApplicationIdentityClientOptions = {},
): ApplicationIdentityClient {
  const baseUrl = (options.baseUrl ?? '/__applik8s/v1/identity').replace(/\/+$/u, '');
  const requestFetch = options.fetch ?? globalThis.fetch;
  const credentials = options.credentials ?? 'same-origin';
  const maximumBytes = options.maxResponseBytes ?? 256 * 1024;
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1_024 || maximumBytes > 4 * 1024 * 1024) {
    throw new Error('Application identity client maxResponseBytes must be between 1 KiB and 4 MiB.');
  }
  const request = async <T>(
    path: string,
    init: RequestInit = {},
    signal?: AbortSignal,
  ): Promise<T> => {
    const response = await requestFetch(`${baseUrl}${path}`, {
      ...init,
      credentials,
      ...(signal ? { signal } : {}),
      headers: {
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
    });
    const text = await boundedResponseText(response, maximumBytes);
    let value: unknown;
    try {
      value = text ? JSON.parse(text) : undefined;
    } catch (cause) {
      throw new Error('Application identity server returned invalid JSON.', { cause });
    }
    if (!response.ok) {
      if (isPublicError(value)) throw new ApplicationIdentityClientError(value, response.status);
      throw new Error(`Application identity request failed with HTTP ${response.status}.`);
    }
    if (!value || typeof value !== 'object' || Reflect.get(value, 'protocol') !== applicationIdentityHttpProtocol) {
      throw new Error('Application identity server returned an incompatible response.');
    }
    // typecast: each typed route validates the protocol discriminator; the concrete operation owns its response schema.
    return value as T;
  };
  const body = (value: unknown): string => JSON.stringify(value ?? {});
  const client: ApplicationIdentityClient = {
    session: (invoke) => request<ApplicationIdentitySessionView>('/session', {}, invoke?.signal),
    beginFlow: (kind, input = {}, invoke) =>
      request<ApplicationIdentityFlowView>(`/flows/${encodeURIComponent(kind)}`, { method: 'POST', body: body(input) }, invoke?.signal),
    transitionFlow: (flowId, transition, input = {}, invoke) =>
      request<ApplicationIdentityFlowView | ApplicationIdentitySessionView>(
        `/flows/${pathSegment(flowId)}/transitions/${pathSegment(transition)}`,
        { method: 'POST', body: body(input) },
        invoke?.signal,
      ),
    cancelFlow: (flowId, invoke) =>
      request<ApplicationIdentityFlowView>(`/flows/${pathSegment(flowId)}`, { method: 'DELETE' }, invoke?.signal),
    logout: (invoke) => request<ApplicationIdentitySessionView>('/session', { method: 'DELETE' }, invoke?.signal),
    account: (invoke) => request<ApplicationIdentityAccountView>('/account', {}, invoke?.signal),
    updateAccount: (input, invoke) =>
      request<ApplicationIdentityAccountView>('/account', { method: 'PATCH', body: body(input) }, invoke?.signal),
    beginMfa: (method, invoke) =>
      request<ApplicationIdentityMfaEnrollmentView>('/account/mfa', { method: 'POST', body: body({ method }) }, invoke?.signal),
    completeMfa: (enrollmentId, input, invoke) =>
      request<ApplicationIdentityAccountView>(
        `/account/mfa/${pathSegment(enrollmentId)}`,
        { method: 'POST', body: body(input) },
        invoke?.signal,
      ),
    removeMfa: (methodId, invoke) =>
      request<ApplicationIdentityAccountView>(`/account/mfa/${pathSegment(methodId)}`, { method: 'DELETE' }, invoke?.signal),
    consent: (consentId, invoke) =>
      request<ApplicationOAuthConsentView>(`/consents/${pathSegment(consentId)}`, {}, invoke?.signal),
    decideConsent: (consentId, decision, invoke) =>
      request<{ readonly continuationUri: string }>(
        `/consents/${pathSegment(consentId)}`,
        { method: 'POST', body: body({ decision }) },
        invoke?.signal,
      ),
    clients: async (invoke) => {
      const result = await request<{
        readonly protocol: typeof applicationIdentityHttpProtocol;
        readonly kind: 'oauth-client-list';
        readonly items: readonly ApplicationOAuthClientView[];
      }>('/clients', {}, invoke?.signal);
      return result.items;
    },
    createClient: (input, invoke) =>
      request<ApplicationOAuthClientCredential>('/clients', { method: 'POST', body: body(input) }, invoke?.signal),
    rotateClient: (clientId, invoke) =>
      request<ApplicationOAuthClientCredential>(`/clients/${pathSegment(clientId)}/rotate`, { method: 'POST', body: '{}' }, invoke?.signal),
    revokeClient: (clientId, invoke) =>
      request<ApplicationOAuthClientView>(`/clients/${pathSegment(clientId)}`, { method: 'DELETE' }, invoke?.signal),
  };
  return Object.freeze(client);
}

function pathSegment(value: string): string {
  if (!value.trim() || value.length > 512) throw new Error('Application identity path identifier is invalid.');
  return encodeURIComponent(value);
}

function isPublicError(value: unknown): value is ApplicationIdentityPublicError {
  return Boolean(
    value
    && typeof value === 'object'
    && Reflect.get(value, 'protocol') === applicationIdentityHttpProtocol
    && Reflect.get(value, 'kind') === 'error'
    && typeof Reflect.get(value, 'code') === 'string'
    && typeof Reflect.get(value, 'message') === 'string',
  );
}

async function boundedResponseText(response: Response, maximumBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > maximumBytes) throw new Error('Application identity response exceeds its declared size bound.');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel('application-identity-response-too-large');
        throw new Error('Application identity response exceeds its size bound.');
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
