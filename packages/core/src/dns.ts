import type { KubernetesConnectionName } from './capability.js';
import type { Diagnostic, ObjectRef, Result, Sha256Digest } from './common.js';
import type { JsonPatch } from './operation-plan.js';
import type { KubernetesReadAccess, KubernetesReadResourceDefinition, ResourceObject } from './resource.js';

declare const dnsNameBrand: unique symbol;
declare const ipv4AddressBrand: unique symbol;
declare const ipv6AddressBrand: unique symbol;
declare const dnsPublicationIdBrand: unique symbol;

export type DnsName = string & { readonly [dnsNameBrand]: 'DnsName' };
export type IPv4Address = string & { readonly [ipv4AddressBrand]: 'IPv4Address' };
export type IPv6Address = string & { readonly [ipv6AddressBrand]: 'IPv6Address' };
export type DnsPublicationId = string & { readonly [dnsPublicationIdBrand]: 'DnsPublicationId' };
export type DnsRecordType = 'A' | 'AAAA' | 'CNAME';

export type DnsPublicationRecordInput =
  | { readonly type: 'A'; readonly addresses: readonly string[] }
  | { readonly type: 'AAAA'; readonly addresses: readonly string[] }
  | { readonly type: 'CNAME'; readonly target: string };

export interface DnsPublicationIntentInput {
  readonly publicationId: string;
  readonly dnsName: string;
  readonly record: DnsPublicationRecordInput;
  readonly ttlSeconds?: number;
}

export type NormalizedDnsPublicationRecord =
  | { readonly type: 'A'; readonly addresses: readonly IPv4Address[] }
  | { readonly type: 'AAAA'; readonly addresses: readonly IPv6Address[] }
  | { readonly type: 'CNAME'; readonly target: DnsName };

export interface NormalizedDnsPublicationIntent {
  readonly publicationId: DnsPublicationId;
  readonly dnsName: DnsName;
  readonly record: NormalizedDnsPublicationRecord;
  readonly ttlSeconds?: number;
  readonly normalization: {
    readonly version: 'applik8s.dns-normalization/v1';
    readonly digestAlgorithm: 'sha256';
    readonly intentDigest: Sha256Digest;
  };
}

export interface DnsPublicationSourceRef {
  readonly apiVersion: string;
  readonly kind: string;
  readonly namespace?: string;
  readonly name: string;
  readonly uid: string;
}

export interface DnsPublicationOwnership {
  readonly controllerId: string;
  readonly publicationId: DnsPublicationId;
  readonly source: DnsPublicationSourceRef;
  readonly previousEvidence?: DnsPublicationEvidence;
}

export type DnsPublicationPlacement =
  | { readonly mode: 'local'; readonly namespace: string }
  | { readonly mode: 'connection'; readonly connection: KubernetesConnectionName; readonly namespace: string };

export type DnsIntentObservation =
  | { readonly state: 'absent' }
  | { readonly state: 'drifted'; readonly desiredDigest: Sha256Digest; readonly observedDigest?: Sha256Digest }
  | { readonly state: 'current'; readonly generation: number; readonly intentDigest: Sha256Digest };

export type DnsControllerObservation =
  | { readonly state: 'unsupported'; readonly capabilityEvidence: readonly ObjectRef[] }
  | { readonly state: 'pending'; readonly desiredGeneration: number; readonly observedGeneration?: number }
  | { readonly state: 'observed'; readonly desiredGeneration: number; readonly observedGeneration: number }
  | { readonly state: 'unavailable'; readonly desiredGeneration?: number };

export interface DnsPropagationEvidence {
  readonly verifier: string;
  readonly checkedAt: string;
  readonly intentDigest: Sha256Digest;
  readonly dnsName: DnsName;
  readonly recordType: DnsRecordType;
  readonly expected: readonly string[];
  readonly observed: readonly string[];
  readonly evidenceDigest: Sha256Digest;
}

export type DnsPropagationObservation =
  | { readonly state: 'notChecked' }
  | { readonly state: 'verified'; readonly verification: DnsPropagationEvidence }
  | { readonly state: 'mismatch'; readonly verification: DnsPropagationEvidence }
  | { readonly state: 'inconclusive'; readonly verification: DnsPropagationEvidence };

export interface DnsPublicationObservation {
  readonly intent: DnsIntentObservation;
  readonly controller: DnsControllerObservation;
  readonly propagation: DnsPropagationObservation;
  readonly evidence: readonly DnsPublicationEvidence[];
  readonly diagnostics: readonly Diagnostic[];
}

export interface DnsPublicationEvidence {
  readonly adapter: 'external-dns';
  readonly apiVersion: 'externaldns.k8s.io/v1alpha1';
  readonly kind: 'DNSEndpoint';
  readonly placement: DnsPublicationPlacement;
  readonly name: string;
  readonly uid: string;
  readonly resourceVersion: string;
  readonly desiredGeneration: number;
  readonly observedGeneration?: number;
  readonly controllerId: string;
  readonly publicationId: DnsPublicationId;
  readonly sourceUid: string;
  readonly normalizationVersion: 'applik8s.dns-normalization/v1';
  readonly digestAlgorithm: 'sha256';
  readonly intentDigest: Sha256Digest;
  readonly capabilityEvidenceRefs: readonly ObjectRef[];
}

export interface DnsPublicationCapabilities {
  readonly adapter: {
    readonly explicitRecords: true;
    readonly recordTypes: readonly DnsRecordType[];
  };
  readonly installation: {
    readonly crdSource: 'enabled' | 'disabled' | 'unknown';
    readonly configuredRecordTypes?: readonly DnsRecordType[];
    readonly managedDomainPatterns?: readonly string[];
    readonly watchedNamespaces?: readonly string[] | 'all';
    readonly controllerObservation: 'supported' | 'unsupported' | 'unknown';
    readonly mutationPolicy: 'sync' | 'upsert-only' | 'create-only' | 'unknown';
    readonly registry: 'txt' | 'dynamodb' | 'aws-sd' | 'noop' | 'unknown';
    readonly providerRecordOwnership: 'configured' | 'unconfigured' | 'unknown';
    readonly targetUpdates: 'supported' | 'unsupported' | 'unknown';
    readonly recordDeletion: 'supported' | 'unsupported' | 'unknown';
    readonly dryRun: boolean | 'unknown';
    readonly propagationVerification: 'available' | 'unavailable';
    readonly configurationEvidenceRefs: readonly ObjectRef[];
  };
}

export type ExternalDnsInstallationCapabilities = DnsPublicationCapabilities['installation'];

export interface DnsPublicationRequirements {
  readonly controllerObservation?: 'required' | 'optional';
  readonly providerRecordOwnership?: 'required' | 'optional';
}

export interface DnsEndpointSpecEndpoint {
  readonly dnsName: string;
  readonly recordType: DnsRecordType;
  readonly targets: readonly string[];
  readonly recordTTL?: number;
}

export interface DnsEndpointSpec {
  readonly endpoints: readonly DnsEndpointSpecEndpoint[];
}

export interface DnsEndpointStatus {
  readonly observedGeneration?: number;
}

/** A structural DNSEndpoint value. Runtime decisions still validate its apiVersion and kind exactly. */
export type DnsEndpointObject = ResourceObject<DnsEndpointSpec, DnsEndpointStatus>;

export interface ExternalDnsPublicationDecisionInput {
  readonly intent: NormalizedDnsPublicationIntent;
  readonly ownership: DnsPublicationOwnership;
  readonly placement: DnsPublicationPlacement;
  readonly capabilities: DnsPublicationCapabilities;
  readonly requirements?: DnsPublicationRequirements;
  readonly current?: DnsEndpointObject;
  readonly propagation?: DnsPropagationObservation;
}

export interface ExternalDnsPublicationDeletionInput {
  readonly ownership: DnsPublicationOwnership;
  readonly placement: DnsPublicationPlacement;
  readonly capabilities: DnsPublicationCapabilities;
  readonly requirements?: Pick<DnsPublicationRequirements, 'providerRecordOwnership'>;
  readonly current?: DnsEndpointObject;
}

export type ExternalDnsPublicationDecision =
  | { readonly kind: 'apply'; readonly resource: DnsEndpointObject; readonly observation: DnsPublicationObservation }
  | { readonly kind: 'patch'; readonly ref: ObjectRef; readonly patch: JsonPatch; readonly precondition: { readonly uid: string; readonly resourceVersion: string }; readonly observation: DnsPublicationObservation }
  | { readonly kind: 'delete'; readonly ref: ObjectRef; readonly precondition: { readonly uid: string; readonly resourceVersion?: string }; readonly observation: DnsPublicationObservation }
  | { readonly kind: 'noop'; readonly observation: DnsPublicationObservation }
  | { readonly kind: 'conflict'; readonly diagnostic: Diagnostic; readonly observation: DnsPublicationObservation }
  | { readonly kind: 'unsupported'; readonly diagnostic: Diagnostic; readonly observation: DnsPublicationObservation };

export interface ExternalDnsEndpointResourceOptions {
  readonly access?: KubernetesReadAccess;
  readonly namespaces?: readonly string[] | 'all';
}

export type DnsEndpointResourceDefinition = KubernetesReadResourceDefinition<DnsEndpointSpec, DnsEndpointStatus>;

export interface DnsPublicationApi {
  normalize(input: DnsPublicationIntentInput): Result<NormalizedDnsPublicationIntent>;
  readonly externalDns: {
    resource(options?: ExternalDnsEndpointResourceOptions): DnsEndpointResourceDefinition;
    capabilities(installation: ExternalDnsInstallationCapabilities): DnsPublicationCapabilities;
    decide(input: ExternalDnsPublicationDecisionInput): ExternalDnsPublicationDecision;
    decideDelete(input: ExternalDnsPublicationDeletionInput): ExternalDnsPublicationDecision;
  };
}
