import type {
  ApplicationIdentityReference,
  ApplicationPreAuthenticationFlowPrincipal,
  ApplicationPrincipal,
  JsonValue,
} from '@applik8s/core';

export const applicationIdentityProtocolVersion =
  'applik8s.identity/v1alpha1' as const;

export type ApplicationPreAuthenticationFlowKind =
  | 'register'
  | 'login'
  | 'verify'
  | 'recover';

export type ApplicationPreAuthenticationFlowState =
  | 'active'
  | 'consumed'
  | 'cancelled'
  | 'superseded';

export interface ApplicationOAuthContinuation {
  readonly authorizationRequestId: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scopes: readonly string[];
  readonly resources: readonly string[];
  readonly audience: readonly string[];
  readonly codeChallenge?: string;
  readonly codeChallengeMethod?: 'S256';
}

export interface ApplicationPreAuthenticationFlowRecord {
  readonly apiVersion: typeof applicationIdentityProtocolVersion;
  readonly id: string;
  readonly kind: ApplicationPreAuthenticationFlowKind;
  readonly provider: string;
  readonly providerFlowId: string;
  readonly browserBindingDigest: string;
  readonly csrfBindingDigest: string;
  readonly providerContinuityDigest: string;
  readonly subjectHintDigest?: string;
  readonly networkBindingDigest?: string;
  readonly oauth?: ApplicationOAuthContinuation;
  readonly allowedTransitions: readonly string[];
  readonly completedTransitions: readonly string[];
  readonly state: ApplicationPreAuthenticationFlowState;
  readonly attempts: number;
  readonly maximumAttempts: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly consumedAt?: string;
  readonly cancelledAt?: string;
  readonly supersededAt?: string;
  readonly version: number;
}

export interface ApplicationProviderAuthenticationCompletion {
  readonly provider: string;
  readonly providerFlowId: string;
  readonly providerSessionId: string;
  readonly providerIdentity: ApplicationIdentityReference;
  readonly authenticationMethod: string;
  readonly assurance: readonly string[];
  readonly completedAt: string;
  readonly expiresAt?: string;
  readonly evidence: Readonly<Record<string, JsonValue>>;
}

export interface ApplicationIdentityAdmissionReceipt {
  readonly apiVersion: 'applik8s.identityAdmission/v1alpha1';
  readonly id: string;
  readonly flowId: string;
  readonly provider: string;
  readonly providerCompletionKey: string;
  readonly providerSessionId: string;
  readonly principal: ApplicationPrincipal;
  readonly authenticationMethod: string;
  readonly assurance: readonly string[];
  readonly trustedContextDigest: string;
  readonly oauth?: ApplicationOAuthContinuation;
  readonly issuedAt: string;
  readonly expiresAt?: string;
}

export interface ApplicationOrphanedProviderSession {
  readonly apiVersion: 'applik8s.identityOrphan/v1alpha1';
  readonly id: string;
  readonly flowId: string;
  readonly provider: string;
  readonly providerSessionId: string;
  readonly providerCompletionKey: string;
  readonly reason: string;
  readonly state: 'pending' | 'revoked' | 'expired' | 'transferred';
  readonly createdAt: string;
  readonly resolvedAt?: string;
  readonly resolutionEvidence?: Readonly<Record<string, JsonValue>>;
  readonly version: number;
}

export interface ApplicationIdentityFlowBinding {
  readonly browserBinding: string;
  readonly csrfToken: string;
  readonly providerContinuity: string;
  readonly networkBinding?: string;
}

export interface ApplicationIdentityFlowStore {
  createFlow(
    flow: ApplicationPreAuthenticationFlowRecord,
  ): Promise<ApplicationPreAuthenticationFlowRecord>;
  getFlow(flowId: string): Promise<ApplicationPreAuthenticationFlowRecord | undefined>;
  replaceFlow(
    flow: ApplicationPreAuthenticationFlowRecord,
    expectedVersion: number,
  ): Promise<ApplicationPreAuthenticationFlowRecord>;
  getAdmissionReceipt(
    providerCompletionKey: string,
  ): Promise<ApplicationIdentityAdmissionReceipt | undefined>;
  commitAdmission(input: {
    readonly flow: ApplicationPreAuthenticationFlowRecord;
    readonly expectedFlowVersion: number;
    readonly receipt: ApplicationIdentityAdmissionReceipt;
  }): Promise<
    | {
        readonly kind: 'committed';
        readonly flow: ApplicationPreAuthenticationFlowRecord;
        readonly receipt: ApplicationIdentityAdmissionReceipt;
      }
    | {
        readonly kind: 'replayed';
        readonly flow: ApplicationPreAuthenticationFlowRecord;
        readonly receipt: ApplicationIdentityAdmissionReceipt;
      }
  >;
  recordOrphan(
    orphan: ApplicationOrphanedProviderSession,
  ): Promise<ApplicationOrphanedProviderSession>;
  listPendingOrphans(limit: number): Promise<readonly ApplicationOrphanedProviderSession[]>;
  resolveOrphan(
    orphanId: string,
    expectedVersion: number,
    resolution: {
      readonly state: Exclude<ApplicationOrphanedProviderSession['state'], 'pending'>;
      readonly resolvedAt: string;
      readonly evidence?: Readonly<Record<string, JsonValue>>;
    },
  ): Promise<ApplicationOrphanedProviderSession>;
}

export interface ApplicationIdentityFlowAdmissionContext {
  readonly application: string;
  readonly catalogRevision: string;
  readonly authorityRevision: string;
  readonly trustedContextDigest: string;
  readonly audience: readonly string[];
  readonly now?: Date;
}

export interface ApplicationIdentityProviderAdapter {
  readonly name: string;
  revokeSession(
    providerSessionId: string,
    reason: string,
  ): Promise<Readonly<Record<string, JsonValue>>>;
  sessionState?(
    providerSessionId: string,
  ): Promise<'active' | 'revoked' | 'expired' | 'unknown'>;
}

export interface ApplicationIdentityPrincipalAdmission {
  readonly completion: ApplicationProviderAuthenticationCompletion;
  readonly flow: ApplicationPreAuthenticationFlowRecord;
  readonly context: ApplicationIdentityFlowAdmissionContext;
}

export type ApplicationIdentityPrincipalAdmitter = (
  input: ApplicationIdentityPrincipalAdmission,
) => Promise<ApplicationPrincipal>;

export interface ApplicationPreAuthenticationFlowIssue {
  readonly kind: ApplicationPreAuthenticationFlowKind;
  readonly provider: string;
  readonly providerFlowId: string;
  readonly binding: ApplicationIdentityFlowBinding;
  readonly allowedTransitions: readonly string[];
  readonly subjectHint?: string;
  readonly oauth?: ApplicationOAuthContinuation;
  readonly maximumAttempts?: number;
  readonly lifetimeMs?: number;
}

export interface ApplicationPreAuthenticationTransition {
  readonly flowId: string;
  readonly transition: string;
  readonly binding: ApplicationIdentityFlowBinding;
}

export interface ApplicationProviderCompletionAdmission {
  readonly flowId: string;
  readonly binding: ApplicationIdentityFlowBinding;
  readonly completion: ApplicationProviderAuthenticationCompletion;
  readonly context: ApplicationIdentityFlowAdmissionContext;
}

export interface ApplicationPreAuthenticationFlowRuntime {
  issue(
    input: ApplicationPreAuthenticationFlowIssue,
  ): Promise<ApplicationPreAuthenticationFlowRecord>;
  admit(
    flowId: string,
    binding: ApplicationIdentityFlowBinding,
    context: ApplicationIdentityFlowAdmissionContext,
  ): Promise<ApplicationPreAuthenticationFlowPrincipal>;
  transition(
    input: ApplicationPreAuthenticationTransition,
  ): Promise<ApplicationPreAuthenticationFlowRecord>;
  complete(
    input: ApplicationProviderCompletionAdmission,
  ): Promise<ApplicationIdentityAdmissionReceipt>;
  cancel(
    flowId: string,
    binding: ApplicationIdentityFlowBinding,
  ): Promise<ApplicationPreAuthenticationFlowRecord>;
  reconcileOrphans(limit?: number): Promise<readonly ApplicationOrphanedProviderSession[]>;
}
