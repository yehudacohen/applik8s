import type { Applik8sError, CapabilityFailureMode, CapabilityKind, Condition, ExternalEffectPhase, JsonArray, JsonPrimitive, KubernetesName, NamespaceName, ReconcileId, Result, Sha256Digest, Timestamp } from './common.js';
import type { DeleteResult, PermissionRule } from './resource.js';

export interface CapabilityClientSet { readonly [capabilityName: string]: CapabilityClient; }
export type CapabilityPayload = JsonPrimitive | JsonArray | object;
export interface CapabilityClient<TResponse = CapabilityPayload> { readonly descriptor: CapabilityDescriptor; get(path: string, options?: CapabilityRequestOptions): Promise<TResponse>; post<TBody = CapabilityPayload>(path: string, body: TBody, options?: CapabilityRequestOptions): Promise<TResponse>; put<TBody = CapabilityPayload>(path: string, body: TBody, options?: CapabilityRequestOptions): Promise<TResponse>; delete(path: string, options?: CapabilityRequestOptions): Promise<TResponse>; }
export interface KubernetesConnectionCapabilityClient extends CapabilityClient { readonly descriptor: KubernetesConnectionCapabilityDescriptor; }
export interface CapabilityRequestOptions { readonly idempotencyKey?: string; readonly timeoutMs?: number; readonly headers?: Readonly<Record<string, string>>; }
export type CapabilityRequestMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
export interface CapabilityRequestPayload<TBody = CapabilityPayload> { readonly capabilityName: string; readonly method: CapabilityRequestMethod; readonly path: string; readonly body?: TBody; readonly options?: CapabilityRequestOptions; readonly reconcileId?: ReconcileId; }
export type CapabilityResponsePayload<TResponse = CapabilityPayload> =
  | { readonly ok: true; readonly value: TResponse; readonly observedAt?: Timestamp }
  | { readonly ok: false; readonly error: Applik8sError };
export interface CapabilityHost { request<TResponse = CapabilityPayload, TBody = CapabilityPayload>(request: CapabilityRequestPayload<TBody>): Promise<CapabilityResponsePayload<TResponse>>; }
export interface CapabilityDescriptor { readonly name: string; readonly kind: CapabilityKind; readonly auth?: CapabilityAuth; readonly endpoint?: string; readonly permissions?: readonly PermissionRule[]; readonly kubernetesConnection?: KubernetesConnectionCapability; readonly workflowGateway?: WorkflowGatewayCapability; readonly policy?: CapabilityPolicy; readonly execution?: CapabilityExecutionPolicy; readonly sensitive?: boolean; }

/**
 * Canonical compiler/adapter contract for the private operator-to-workflow
 * caller credential. It is deliberately separate from Kubernetes' default
 * automount because that token's audience is cluster-dependent.
 */
export const workflowGatewayServiceAccountTokenProjection = Object.freeze({
  name: 'workflow-gateway-token',
  mountPath: '/var/run/secrets/applik8s/workflow-gateway',
  filePath: '/var/run/secrets/applik8s/workflow-gateway/token',
  path: 'token',
  audience: 'https://kubernetes.default.svc',
  expirationSeconds: 3_600,
  defaultMode: 0o400,
} as const);

export function usesWorkflowGatewayCapability(
  capabilities: Readonly<Record<string, CapabilityDescriptor>> | undefined,
): boolean {
  return Object.values(capabilities ?? {}).some(
    (descriptor) => descriptor.workflowGateway?.protocol === 'applik8s.workflow-gateway/v1alpha1',
  );
}
export interface KubernetesConnectionCapabilityDescriptor extends CapabilityDescriptor { readonly kind: 'kubernetes'; readonly kubernetesConnection: KubernetesConnectionCapability; readonly execution: CapabilityExecutionPolicy & { readonly protocol: 'applik8s.kubernetes-connection/v1alpha1' }; }
export type CapabilityAuth =
  | { readonly type: 'secretRef'; readonly secretRef: SecretRef }
  | { readonly type: 'serviceAccount' }
  | { readonly type: 'none' };
export interface SecretRef { readonly name: KubernetesName; readonly namespace?: import('./common.js').NamespaceName; readonly key: string; }
/** Portable declaration for one named Kubernetes execution capability. */
export interface KubernetesConnectionCapability { readonly endpointPolicy: string; }
/** Framework-owned metadata for the private operator-to-workflow bridge. */
export interface WorkflowGatewayCapability {
  readonly protocol: 'applik8s.workflow-gateway/v1alpha1';
  readonly worker: KubernetesName;
  readonly contracts: readonly string[];
  readonly caller: {
    readonly operator: KubernetesName;
    readonly namespace: NamespaceName;
    readonly serviceAccount: KubernetesName;
  };
}
/** Environment-specific binding. This is installation data and never enters the handler ABI. */
export interface KubernetesConnectionBinding { readonly kubeconfigSecretRef: SecretRef; readonly context: string; readonly endpointPolicy: KubernetesEndpointPolicy; }
export interface KubernetesEndpointPolicy { readonly name: string; readonly version: string; readonly scheme: 'https'; readonly hosts: readonly string[]; readonly ports: readonly number[]; readonly allowedCidrs?: readonly string[]; readonly tlsServerNames?: readonly string[]; readonly redirects: 'deny'; }
/** Handler-visible connection identity. Secret coordinates are deliberately excluded. */
export type KubernetesConnectionName = string;
export interface CapabilityPolicy { readonly timeoutMs?: number; readonly retry?: RetryPolicy; readonly networkPolicy?: NetworkPolicyDescriptor; readonly idempotencyKeyRequired?: boolean; readonly failureMode: CapabilityFailureMode; }
export interface CapabilityExecutionPolicy { readonly liveExecution: 'disabled' | 'hostProtocol'; readonly protocol: 'notImplemented' | 'applik8s.capability/v1alpha1' | 'applik8s.kubernetes-connection/v1alpha1'; readonly audit: CapabilityAuditPolicy; readonly redaction: CapabilityRedactionPolicy; readonly idempotency: CapabilityIdempotencyPolicy; }
export interface CapabilityAuditPolicy { readonly recordRequests: boolean; readonly recordResponses: boolean; readonly includePayloads: false; }
export interface CapabilityRedactionPolicy { readonly requestBody: 'redacted'; readonly responseBody: 'redacted'; readonly headers: 'redacted'; readonly errors: 'publicMessageOnly'; }
export interface CapabilityIdempotencyPolicy { readonly requiredForMutations: boolean; readonly keySource: 'handlerProvided' | 'notApplicable'; }
export interface NetworkPolicyDescriptor { readonly allowedHosts: readonly string[]; readonly allowedPorts?: readonly number[]; }
export interface RetryPolicy { readonly maxAttempts: number; readonly backoffMs: number; readonly maxBackoffMs?: number; }
export interface ExternalEffectRecord { readonly capabilityName: string; readonly phase: ExternalEffectPhase; readonly idempotencyKey: string; readonly requestDigest: Sha256Digest; readonly responseDigest?: Sha256Digest; readonly condition?: Condition; readonly observedAt: Timestamp; }
export interface ExternalEffectState { readonly effects: readonly ExternalEffectRecord[]; }
export interface CapabilityRegistry { create(name: string, descriptor: CapabilityDescriptor): Result<CapabilityDescriptor>; read(name: string): Result<CapabilityDescriptor>; list(): Result<Readonly<Record<string, CapabilityDescriptor>>>; update(name: string, descriptor: CapabilityDescriptor): Result<CapabilityDescriptor>; delete(name: string): Result<DeleteResult>; }
