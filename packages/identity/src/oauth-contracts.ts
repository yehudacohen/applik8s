import type {
  ApplicationIdentityReference,
  ApplicationOAuthAuthorizationFlowPrincipal,
  ApplicationPrincipal,
  JsonValue,
} from '@applik8s/core';
import type { ApplicationIdentityFlowBinding } from './contracts.js';

export const applicationOAuthProtocolVersion =
  'applik8s.oauth/v1alpha1' as const;

export interface ApplicationOAuthClient {
  readonly apiVersion: typeof applicationOAuthProtocolVersion;
  readonly id: string;
  readonly type: 'public' | 'confidential' | 'service';
  readonly redirectUris: readonly string[];
  readonly allowedScopes: readonly string[];
  readonly allowedResources: readonly string[];
  readonly allowedAudience: readonly string[];
  readonly grantTypes: readonly (
    | 'authorization_code'
    | 'refresh_token'
    | 'client_credentials'
  )[];
  readonly requirePkce: boolean;
  readonly state: 'active' | 'revoked';
  readonly revision: string;
}

export interface ApplicationOAuthAuthorizationRequest {
  readonly id: string;
  readonly provider: string;
  readonly providerAuthorizationRequestId: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scopes: readonly string[];
  readonly resources: readonly string[];
  readonly audience: readonly string[];
  readonly responseType: 'code';
  readonly codeChallenge?: string;
  readonly codeChallengeMethod?: 'S256';
}

export interface ApplicationOAuthAuthorizationFlowRecord {
  readonly apiVersion: typeof applicationOAuthProtocolVersion;
  readonly id: string;
  readonly provider: string;
  readonly providerAuthorizationRequestId: string;
  readonly authorizationRequestId: string;
  readonly clientId: string;
  readonly clientRevision: string;
  readonly redirectUri: string;
  readonly scopes: readonly string[];
  readonly resources: readonly string[];
  readonly audience: readonly string[];
  readonly codeChallenge?: string;
  readonly codeChallengeMethod?: 'S256';
  readonly resourceOwner: ApplicationIdentityReference;
  readonly resourceOwnerPrincipalId: string;
  readonly sessionId: string;
  readonly authenticationMethod: string;
  readonly authorityRevision: string;
  readonly browserBindingDigest: string;
  readonly csrfBindingDigest: string;
  readonly state:
    | 'active'
    | 'approving'
    | 'denying'
    | 'approved'
    | 'denied'
    | 'cancelled';
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly decidedAt?: string;
  readonly providerDecisionId?: string;
  readonly version: number;
}

export interface ApplicationOAuthConsentDecision {
  readonly flowId: string;
  readonly decision: 'approve' | 'deny';
  readonly binding: ApplicationIdentityFlowBinding;
  readonly principal: ApplicationPrincipal;
}

export interface ApplicationOAuthProviderDecision {
  readonly id: string;
  readonly providerAuthorizationRequestId: string;
  readonly accepted: boolean;
  readonly redirectUri: string;
  readonly code?: string;
  readonly evidence: Readonly<Record<string, JsonValue>>;
}

export interface ApplicationOAuthAuthorizationProviderAdapter {
  readonly name: string;
  decide(input: {
    readonly flow: ApplicationOAuthAuthorizationFlowRecord;
    readonly decision: 'approve' | 'deny';
    readonly idempotencyKey: string;
  }): Promise<ApplicationOAuthProviderDecision>;
}

export interface ApplicationOAuthAuthorizationFlowStore {
  create(
    flow: ApplicationOAuthAuthorizationFlowRecord,
  ): Promise<ApplicationOAuthAuthorizationFlowRecord>;
  get(flowId: string): Promise<ApplicationOAuthAuthorizationFlowRecord | undefined>;
  replace(
    flow: ApplicationOAuthAuthorizationFlowRecord,
    expectedVersion: number,
  ): Promise<ApplicationOAuthAuthorizationFlowRecord>;
}

export interface ApplicationOAuthAuthorizationFlowIssue {
  readonly request: ApplicationOAuthAuthorizationRequest;
  readonly client: ApplicationOAuthClient;
  readonly principal: ApplicationPrincipal;
  readonly binding: ApplicationIdentityFlowBinding;
  readonly lifetimeMs?: number;
}

export interface ApplicationOAuthAuthorizationFlowAdmissionContext {
  readonly application: string;
  readonly catalogRevision: string;
  readonly authorityRevision: string;
  readonly trustedContextDigest: string;
  readonly audience: readonly string[];
  readonly now?: Date;
}

export interface ApplicationOAuthAuthorizationFlowRuntime {
  issue(
    input: ApplicationOAuthAuthorizationFlowIssue,
  ): Promise<ApplicationOAuthAuthorizationFlowRecord>;
  admit(
    flowId: string,
    binding: ApplicationIdentityFlowBinding,
    principal: ApplicationPrincipal,
    context: ApplicationOAuthAuthorizationFlowAdmissionContext,
  ): Promise<ApplicationOAuthAuthorizationFlowPrincipal>;
  decide(
    input: ApplicationOAuthConsentDecision,
  ): Promise<{
    readonly flow: ApplicationOAuthAuthorizationFlowRecord;
    readonly provider: ApplicationOAuthProviderDecision;
  }>;
  cancel(
    flowId: string,
    binding: ApplicationIdentityFlowBinding,
    principal: ApplicationPrincipal,
  ): Promise<ApplicationOAuthAuthorizationFlowRecord>;
}
