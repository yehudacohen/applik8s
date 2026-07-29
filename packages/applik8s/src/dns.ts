import type {
  Applik8sError,
  Diagnostic,
  DnsControllerObservation,
  DnsEndpointObject,
  DnsEndpointResourceDefinition,
  DnsEndpointSpec,
  DnsIntentObservation,
  DnsName,
  DnsPropagationObservation,
  DnsPublicationApi,
  DnsPublicationCapabilities,
  DnsPublicationEvidence,
  DnsPublicationId,
  DnsPublicationIntentInput,
  DnsPublicationObservation,
  DnsPublicationOwnership,
  DnsPublicationPlacement,
  ExternalDnsEndpointResourceOptions,
  ExternalDnsInstallationCapabilities,
  ExternalDnsPublicationDecision,
  ExternalDnsPublicationDecisionInput,
  ExternalDnsPublicationDeletionInput,
  IPv4Address,
  IPv6Address,
  JsonPatch,
  JsonValue,
  NormalizedDnsPublicationIntent,
  NormalizedDnsPublicationRecord,
  ObjectRef,
  Result,
  Sha256Digest,
} from '@applik8s/core';
import { sdk } from '@applik8s/sdk';

export type {
  DnsControllerObservation,
  DnsEndpointObject,
  DnsEndpointResourceDefinition,
  DnsEndpointSpec,
  DnsEndpointSpecEndpoint,
  DnsEndpointStatus,
  DnsIntentObservation,
  DnsName,
  DnsPropagationEvidence,
  DnsPropagationObservation,
  DnsPublicationCapabilities,
  DnsPublicationEvidence,
  DnsPublicationId,
  DnsPublicationIntentInput,
  DnsPublicationObservation,
  DnsPublicationOwnership,
  DnsPublicationPlacement,
  DnsPublicationRecordInput,
  DnsPublicationRequirements,
  DnsPublicationSourceRef,
  DnsRecordType,
  ExternalDnsEndpointResourceOptions,
  ExternalDnsInstallationCapabilities,
  ExternalDnsPublicationDecision,
  ExternalDnsPublicationDecisionInput,
  ExternalDnsPublicationDeletionInput,
  IPv4Address,
  IPv6Address,
  NormalizedDnsPublicationIntent,
  NormalizedDnsPublicationRecord,
} from '@applik8s/core';

const DNS_API_VERSION = 'externaldns.k8s.io/v1alpha1';
const DNS_KIND = 'DNSEndpoint';
const NORMALIZATION_VERSION = 'applik8s.dns-normalization/v1';
const IDENTITY_VERSION = 'applik8s.dns-identity/v1';
const METADATA_VERSION = 'applik8s.dns-metadata/v1';
const MAX_TTL_SECONDS = 2_147_483_647;
const ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._:/-]{0,254})$/;

export const externalDnsPublicationMetadata = Object.freeze({
  managedByLabel: 'app.kubernetes.io/managed-by',
  controllerHashLabel: 'dns.applik8s.dev/controller-hash',
  publicationHashLabel: 'dns.applik8s.dev/publication-hash',
  sourceNameHashLabel: 'dns.applik8s.dev/source-name-hash',
  metadataVersionAnnotation: 'dns.applik8s.dev/metadata-version',
  controllerIdAnnotation: 'dns.applik8s.dev/controller-id',
  publicationIdAnnotation: 'dns.applik8s.dev/publication-id',
  sourceApiVersionAnnotation: 'dns.applik8s.dev/source-api-version',
  sourceKindAnnotation: 'dns.applik8s.dev/source-kind',
  sourceNamespaceAnnotation: 'dns.applik8s.dev/source-namespace',
  sourceNameAnnotation: 'dns.applik8s.dev/source-name',
  sourceUidAnnotation: 'dns.applik8s.dev/source-uid',
  normalizationVersionAnnotation: 'dns.applik8s.dev/normalization-version',
  digestAlgorithmAnnotation: 'dns.applik8s.dev/digest-algorithm',
  intentDigestAnnotation: 'dns.applik8s.dev/intent-digest',
});

export function normalizeDnsPublicationIntent(input: DnsPublicationIntentInput): Result<NormalizedDnsPublicationIntent> {
  const publicationId = normalizePublicationId(input.publicationId);
  if (!publicationId) return invalidIntent('DNS publicationId must be 1-255 characters and use only letters, digits, dot, underscore, colon, slash, or hyphen.');
  const dnsName = normalizeDnsName(input.dnsName);
  if (!dnsName) return invalidIntent(`DNS publication name ${JSON.stringify(input.dnsName)} is not a valid DNS name.`);
  if (input.ttlSeconds !== undefined && (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds < 1 || input.ttlSeconds > MAX_TTL_SECONDS)) {
    return invalidIntent(`DNS TTL must be an integer between 1 and ${MAX_TTL_SECONDS} seconds.`);
  }

  const record = normalizeRecord(input.record);
  if (!record.ok) return record;
  const canonical = canonicalIntent(publicationId, dnsName, record.value, input.ttlSeconds);
  const intentDigest = sha256Digest(JSON.stringify(canonical));
  return {
    ok: true,
    value: {
      publicationId,
      dnsName,
      record: record.value,
      ...(input.ttlSeconds === undefined ? {} : { ttlSeconds: input.ttlSeconds }),
      normalization: { version: NORMALIZATION_VERSION, digestAlgorithm: 'sha256', intentDigest },
    },
  };
}

export function externalDnsEndpointResource(options: ExternalDnsEndpointResourceOptions = {}): DnsEndpointResourceDefinition {
  return sdk.kubernetes.resource({
    apiVersion: DNS_API_VERSION,
    kind: DNS_KIND,
    plural: 'dnsendpoints',
    scope: 'Namespaced',
    access: options.access ?? 'local',
    ...(options.namespaces ? { namespaces: options.namespaces } : {}),
  });
}

export function externalDnsCapabilities(installation: ExternalDnsInstallationCapabilities): DnsPublicationCapabilities {
  return {
    adapter: { explicitRecords: true, recordTypes: ['A', 'AAAA', 'CNAME'] },
    installation,
  };
}

export function externalDnsPublicationName(controllerId: string, publicationId: string): string {
  return `dns-${sha256Hex(`${IDENTITY_VERSION}\u0000${controllerId}\u0000${publicationId}`).slice(0, 32)}`;
}

export function decideExternalDnsPublication(input: ExternalDnsPublicationDecisionInput): ExternalDnsPublicationDecision {
  const identityDiagnostic = validateIdentity(input.intent, input.ownership, input.placement);
  if (identityDiagnostic) return conflictDecision(identityDiagnostic, absentObservation(input.capabilities));

  const desiredName = externalDnsPublicationName(input.ownership.controllerId, input.intent.publicationId);
  const desiredSpec = renderSpec(input.intent);
  if (!input.current) {
    const capabilityDiagnostic = validateCapabilities(input, 'create');
    if (capabilityDiagnostic) return unsupportedDecision(capabilityDiagnostic, absentObservation(input.capabilities));
    return {
      kind: 'apply',
      resource: renderDnsEndpoint(input.intent, input.ownership, input.placement, desiredName),
      observation: absentObservation(input.capabilities),
    };
  }

  const ownershipDiagnostic = validateCurrentOwnership(input.current, input.ownership, input.placement, desiredName);
  if (ownershipDiagnostic) {
    const observation = observedObjectObservation(input.current, input.intent, input.ownership, input.placement, input.capabilities, input.propagation);
    return conflictDecision(ownershipDiagnostic, addDiagnostic(observation, ownershipDiagnostic));
  }

  const safetyDiagnostic = validateObservedMutationPreconditions(input.current);
  if (safetyDiagnostic) {
    const observation = observedObjectObservation(input.current, input.intent, input.ownership, input.placement, input.capabilities, input.propagation);
    return conflictDecision(safetyDiagnostic, addDiagnostic(observation, safetyDiagnostic));
  }

  const specMatches = sameJson(input.current.spec, desiredSpec);
  const digestMatches = input.current.metadata.annotations?.[externalDnsPublicationMetadata.intentDigestAnnotation] === input.intent.normalization.intentDigest;
  const capabilityDiagnostic = validateCapabilities(input, specMatches && digestMatches ? 'observe' : 'update');
  const observation = observedObjectObservation(input.current, input.intent, input.ownership, input.placement, input.capabilities, input.propagation, specMatches ? undefined : (input.current.metadata.generation ?? 0) + 1);
  if (capabilityDiagnostic) return unsupportedDecision(capabilityDiagnostic, addDiagnostic(observation, capabilityDiagnostic));

  if (specMatches && digestMatches) return { kind: 'noop', observation };

  const uid = requiredMetadata(input.current, 'uid');
  const resourceVersion = requiredMetadata(input.current, 'resourceVersion');
  const desiredMetadata = renderManagedMetadata(input.intent, input.ownership);
  const labels = { ...(input.current.metadata.labels ?? {}), ...desiredMetadata.labels };
  const annotations = { ...(input.current.metadata.annotations ?? {}), ...desiredMetadata.annotations };
  const patch: JsonPatch = [
    { op: 'test', path: '/metadata/uid', value: uid },
    { op: 'test', path: '/metadata/resourceVersion', value: resourceVersion },
    { op: 'add', path: '/metadata/labels', value: labels },
    { op: 'add', path: '/metadata/annotations', value: annotations },
    // typecast: renderSpec constructs a JSON-only Kubernetes spec; the assertion bridges readonly domain types to the generic patch value.
    { op: 'add', path: '/spec', value: desiredSpec as unknown as JsonValue },
  ];
  return {
    kind: 'patch',
    ref: objectRef(input.current),
    patch,
    precondition: { uid, resourceVersion },
    observation,
  };
}

export function decideExternalDnsPublicationDelete(input: ExternalDnsPublicationDeletionInput): ExternalDnsPublicationDecision {
  if (!input.current) return { kind: 'noop', observation: absentObservation(input.capabilities) };
  const publicationId = input.ownership.publicationId;
  const desiredName = externalDnsPublicationName(input.ownership.controllerId, publicationId);
  const ownershipDiagnostic = validateCurrentOwnership(input.current, input.ownership, input.placement, desiredName);
  const observation = deletionObservation(input.current, input.ownership, input.placement, input.capabilities);
  if (ownershipDiagnostic) return conflictDecision(ownershipDiagnostic, addDiagnostic(observation, ownershipDiagnostic));
  const safetyDiagnostic = validateObservedMutationPreconditions(input.current);
  if (safetyDiagnostic) return conflictDecision(safetyDiagnostic, addDiagnostic(observation, safetyDiagnostic));
  const capabilityDiagnostic = validateDeletionCapabilities(input);
  if (capabilityDiagnostic) return unsupportedDecision(capabilityDiagnostic, addDiagnostic(observation, capabilityDiagnostic));
  const uid = requiredMetadata(input.current, 'uid');
  const resourceVersion = requiredMetadata(input.current, 'resourceVersion');
  return {
    kind: 'delete',
    ref: objectRef(input.current),
    precondition: { uid, resourceVersion },
    observation,
  };
}

export const dns: DnsPublicationApi = {
  normalize: normalizeDnsPublicationIntent,
  externalDns: {
    resource: externalDnsEndpointResource,
    capabilities: externalDnsCapabilities,
    decide: decideExternalDnsPublication,
    decideDelete: decideExternalDnsPublicationDelete,
  },
};

function normalizeRecord(input: DnsPublicationIntentInput['record']): Result<NormalizedDnsPublicationRecord> {
  if (input.type === 'A') {
    if (input.addresses.length === 0) return invalidIntent('An A record requires at least one IPv4 address.');
    const addresses: IPv4Address[] = [];
    for (const address of input.addresses) {
      const normalized = normalizeIpv4(address);
      if (!normalized) return invalidIntent(`A record target ${JSON.stringify(address)} is not a valid canonicalizable IPv4 address.`);
      addresses.push(normalized);
    }
    return { ok: true, value: { type: 'A', addresses: uniqueSorted(addresses) } };
  }
  if (input.type === 'AAAA') {
    if (input.addresses.length === 0) return invalidIntent('An AAAA record requires at least one IPv6 address.');
    const addresses: IPv6Address[] = [];
    for (const address of input.addresses) {
      const normalized = normalizeIpv6(address);
      if (!normalized) return invalidIntent(`AAAA record target ${JSON.stringify(address)} is not a valid canonicalizable IPv6 address.`);
      addresses.push(normalized);
    }
    return { ok: true, value: { type: 'AAAA', addresses: uniqueSorted(addresses) } };
  }
  const target = normalizeDnsName(input.target);
  if (!target) return invalidIntent(`CNAME target ${JSON.stringify(input.target)} is not a valid DNS name.`);
  return { ok: true, value: { type: 'CNAME', target } };
}

function normalizePublicationId(value: string): DnsPublicationId | undefined {
  const normalized = value.trim();
  if (!ID_PATTERN.test(normalized)) return undefined;
  // typecast: the complete publication-ID grammar has just been validated at this public boundary.
  return normalized as DnsPublicationId;
}

function normalizeDnsName(value: string): DnsName | undefined {
  const candidate = value.trim().replace(/\.$/, '');
  if (!candidate || candidate.length > 253 || /[\s/:?#@[\]]/.test(candidate)) return undefined;
  let ascii: string;
  try {
    ascii = new URL(`http://${candidate}`).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return undefined;
  }
  if (!ascii || ascii.length > 253 || ascii.includes(':')) return undefined;
  const labels = ascii.split('.');
  if (labels.some((label) => label.length < 1 || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return undefined;
  // typecast: URL/IDNA conversion and every DNS label constraint have been validated above.
  return ascii as DnsName;
}

function normalizeIpv4(value: string): IPv4Address | undefined {
  const parts = value.trim().split('.');
  if (parts.length !== 4) return undefined;
  const normalized: number[] = [];
  for (const part of parts) {
    if (!/^(?:0|[1-9][0-9]{0,2})$/.test(part)) return undefined;
    const octet = Number(part);
    if (octet > 255) return undefined;
    normalized.push(octet);
  }
  // typecast: all four canonical decimal IPv4 octets have been validated and normalized.
  return normalized.join('.') as IPv4Address;
}

function normalizeIpv6(value: string): IPv6Address | undefined {
  let candidate = value.trim().toLowerCase();
  if (!candidate || candidate.includes('%') || candidate.startsWith('[') || candidate.endsWith(']')) return undefined;
  if (candidate.includes('.')) {
    const lastColon = candidate.lastIndexOf(':');
    if (lastColon < 0) return undefined;
    const ipv4 = normalizeIpv4(candidate.slice(lastColon + 1));
    if (!ipv4) return undefined;
    const octets = ipv4.split('.').map(Number);
    const high = ((octets[0] ?? 0) << 8) | (octets[1] ?? 0);
    const low = ((octets[2] ?? 0) << 8) | (octets[3] ?? 0);
    candidate = `${candidate.slice(0, lastColon)}:${high.toString(16)}:${low.toString(16)}`;
  }
  const compressed = candidate.split('::');
  if (compressed.length > 2) return undefined;
  const left = parseIpv6Words(compressed[0] ?? '');
  const right = parseIpv6Words(compressed[1] ?? '');
  if (!left || !right) return undefined;
  let words: number[];
  if (compressed.length === 1) {
    if (left.length !== 8) return undefined;
    words = left;
  } else {
    const missing = 8 - left.length - right.length;
    if (missing < 1) return undefined;
    words = [...left, ...Array.from({ length: missing }, () => 0), ...right];
  }
  // typecast: the input has been parsed into exactly eight valid IPv6 words and canonically serialized.
  return serializeIpv6(words) as IPv6Address;
}

function parseIpv6Words(value: string): number[] | undefined {
  if (!value) return [];
  const parts = value.split(':');
  const words: number[] = [];
  for (const part of parts) {
    if (!/^[0-9a-f]{1,4}$/.test(part)) return undefined;
    words.push(Number.parseInt(part, 16));
  }
  return words;
}

function serializeIpv6(words: readonly number[]): string {
  let bestStart = -1;
  let bestLength = 0;
  for (let index = 0; index < words.length;) {
    if (words[index] !== 0) {
      index += 1;
      continue;
    }
    let end = index;
    while (end < words.length && words[end] === 0) end += 1;
    const length = end - index;
    if (length >= 2 && length > bestLength) {
      bestStart = index;
      bestLength = length;
    }
    index = end;
  }
  const rendered = words.map((word) => word.toString(16));
  if (bestStart < 0) return rendered.join(':');
  const before = rendered.slice(0, bestStart).join(':');
  const after = rendered.slice(bestStart + bestLength).join(':');
  if (before && after) return `${before}::${after}`;
  if (before) return `${before}::`;
  if (after) return `::${after}`;
  return '::';
}

function canonicalIntent(publicationId: DnsPublicationId, dnsName: DnsName, record: NormalizedDnsPublicationRecord, ttlSeconds: number | undefined): object {
  const canonicalRecord = record.type === 'CNAME'
    ? { type: record.type, target: record.target }
    : { type: record.type, addresses: record.addresses };
  return {
    normalizationVersion: NORMALIZATION_VERSION,
    publicationId,
    dnsName,
    record: canonicalRecord,
    ...(ttlSeconds === undefined ? {} : { ttlSeconds }),
  };
}

function renderSpec(intent: NormalizedDnsPublicationIntent): DnsEndpointSpec {
  const targets = intent.record.type === 'CNAME' ? [intent.record.target] : intent.record.addresses;
  return {
    endpoints: [{
      dnsName: intent.dnsName,
      recordType: intent.record.type,
      targets,
      ...(intent.ttlSeconds === undefined ? {} : { recordTTL: intent.ttlSeconds }),
    }],
  };
}

function renderManagedMetadata(intent: NormalizedDnsPublicationIntent, ownership: DnsPublicationOwnership): { readonly labels: Readonly<Record<string, string>>; readonly annotations: Readonly<Record<string, string>> } {
  const source = ownership.source;
  return {
    labels: {
      [externalDnsPublicationMetadata.managedByLabel]: 'applik8s',
      [externalDnsPublicationMetadata.controllerHashLabel]: sha256Hex(ownership.controllerId).slice(0, 16),
      [externalDnsPublicationMetadata.publicationHashLabel]: sha256Hex(intent.publicationId).slice(0, 16),
      [externalDnsPublicationMetadata.sourceNameHashLabel]: sha256Hex(source.name).slice(0, 16),
    },
    annotations: {
      [externalDnsPublicationMetadata.metadataVersionAnnotation]: METADATA_VERSION,
      [externalDnsPublicationMetadata.controllerIdAnnotation]: ownership.controllerId,
      [externalDnsPublicationMetadata.publicationIdAnnotation]: intent.publicationId,
      [externalDnsPublicationMetadata.sourceApiVersionAnnotation]: source.apiVersion,
      [externalDnsPublicationMetadata.sourceKindAnnotation]: source.kind,
      [externalDnsPublicationMetadata.sourceNamespaceAnnotation]: source.namespace ?? '',
      [externalDnsPublicationMetadata.sourceNameAnnotation]: source.name,
      [externalDnsPublicationMetadata.sourceUidAnnotation]: source.uid,
      [externalDnsPublicationMetadata.normalizationVersionAnnotation]: intent.normalization.version,
      [externalDnsPublicationMetadata.digestAlgorithmAnnotation]: intent.normalization.digestAlgorithm,
      [externalDnsPublicationMetadata.intentDigestAnnotation]: intent.normalization.intentDigest,
    },
  };
}

function renderDnsEndpoint(intent: NormalizedDnsPublicationIntent, ownership: DnsPublicationOwnership, placement: DnsPublicationPlacement, name: string): DnsEndpointObject {
  const metadata = renderManagedMetadata(intent, ownership);
  return {
    apiVersion: DNS_API_VERSION,
    kind: DNS_KIND,
    metadata: { name, namespace: placement.namespace, labels: metadata.labels, annotations: metadata.annotations },
    spec: renderSpec(intent),
  };
}

function validateIdentity(intent: NormalizedDnsPublicationIntent, ownership: DnsPublicationOwnership, placement: DnsPublicationPlacement): Diagnostic | undefined {
  if (ownership.publicationId !== intent.publicationId) return diagnostic('SCHEMA_INVALID', 'DNS ownership publicationId must equal the normalized intent publicationId.', 'Build ownership from the same publication identity passed to dns.normalize(...).');
  if (!ID_PATTERN.test(ownership.controllerId)) return diagnostic('SCHEMA_INVALID', 'DNS controllerId must be 1-255 characters and use only letters, digits, dot, underscore, colon, slash, or hyphen.', 'Use a stable versioned controller identity.');
  if (!ownership.source.apiVersion || !ownership.source.kind || !ownership.source.name || !ownership.source.uid) return diagnostic('SCHEMA_INVALID', 'DNS ownership requires a complete source apiVersion, kind, name, and UID.', 'Pass the live owning resource identity into the DNS ownership contract.');
  if (!isKubernetesNamespaceName(placement.namespace)) return diagnostic('SCHEMA_INVALID', 'DNS publication placement requires a valid Kubernetes namespace name.', 'Select an explicitly bounded local or connection namespace.');
  if (placement.mode === 'connection' && !isKubernetesConnectionName(placement.connection)) return diagnostic('SCHEMA_INVALID', 'Connection-scoped DNS publication requires a valid declared Kubernetes connection name.', 'Select a lowercase DNS-label-like connection alias declared by the operator.');
  if (ownership.previousEvidence) {
    const evidence = ownership.previousEvidence;
    if (evidence.controllerId !== ownership.controllerId || evidence.publicationId !== ownership.publicationId || evidence.sourceUid !== ownership.source.uid) {
      return diagnostic('RESOURCE_CONFLICT', 'Durable DNS evidence belongs to a different controller, publication, or source UID.', 'Do not reuse DNS evidence across publication or source-object identities.');
    }
    if (!samePlacement(evidence.placement, placement)) return diagnostic('RESOURCE_CONFLICT', 'Durable DNS evidence belongs to a different Kubernetes placement.', 'Use evidence only with the cluster or connection and namespace that produced it.');
  }
  return undefined;
}

function validateCurrentOwnership(current: DnsEndpointObject, ownership: DnsPublicationOwnership, placement: DnsPublicationPlacement, desiredName: string): Diagnostic | undefined {
  if (current.apiVersion !== DNS_API_VERSION || current.kind !== DNS_KIND || current.metadata.name !== desiredName || current.metadata.namespace !== placement.namespace) {
    return diagnostic('RESOURCE_CONFLICT', 'Observed DNS object does not match the deterministic publication object key.', 'Read the exact DNSEndpoint derived from the publication identity and selected placement.');
  }
  const labels = current.metadata.labels ?? {};
  const expectedLabels: Readonly<Record<string, string>> = {
    [externalDnsPublicationMetadata.managedByLabel]: 'applik8s',
    [externalDnsPublicationMetadata.controllerHashLabel]: sha256Hex(ownership.controllerId).slice(0, 16),
    [externalDnsPublicationMetadata.publicationHashLabel]: sha256Hex(ownership.publicationId).slice(0, 16),
    [externalDnsPublicationMetadata.sourceNameHashLabel]: sha256Hex(ownership.source.name).slice(0, 16),
  };
  for (const [key, value] of Object.entries(expectedLabels)) {
    if (labels[key] !== value) return diagnostic('RESOURCE_CONFLICT', `Observed DNSEndpoint ownership label ${key} is missing or does not match.`, 'Refuse adoption; recover or remove the conflicting object through an explicit operator policy.');
  }
  const annotations = current.metadata.annotations ?? {};
  const expected: Readonly<Record<string, string>> = {
    [externalDnsPublicationMetadata.metadataVersionAnnotation]: METADATA_VERSION,
    [externalDnsPublicationMetadata.controllerIdAnnotation]: ownership.controllerId,
    [externalDnsPublicationMetadata.publicationIdAnnotation]: ownership.publicationId,
    [externalDnsPublicationMetadata.sourceApiVersionAnnotation]: ownership.source.apiVersion,
    [externalDnsPublicationMetadata.sourceKindAnnotation]: ownership.source.kind,
    [externalDnsPublicationMetadata.sourceNamespaceAnnotation]: ownership.source.namespace ?? '',
    [externalDnsPublicationMetadata.sourceNameAnnotation]: ownership.source.name,
    [externalDnsPublicationMetadata.sourceUidAnnotation]: ownership.source.uid,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (annotations[key] !== value) return diagnostic('RESOURCE_CONFLICT', `Observed DNSEndpoint ownership metadata ${key} is missing or does not match.`, 'Refuse adoption; recover or remove the conflicting object through an explicit operator policy.');
  }
  if (ownership.previousEvidence) {
    if (ownership.previousEvidence.name !== current.metadata.name || ownership.previousEvidence.uid !== current.metadata.uid) {
      return diagnostic('RESOURCE_CONFLICT', 'Observed DNSEndpoint was replaced after durable evidence was recorded.', 'Do not mutate or delete the replacement; require explicit recovery.');
    }
  }
  return undefined;
}

function validateObservedMutationPreconditions(current: DnsEndpointObject): Diagnostic | undefined {
  if (!current.metadata.uid || !current.metadata.resourceVersion) {
    return diagnostic('RESOURCE_CONFLICT', 'Observed DNSEndpoint lacks UID or resourceVersion required for a guarded mutation.', 'Read the live object again before updating or deleting it.');
  }
  return undefined;
}

function validateCapabilities(input: ExternalDnsPublicationDecisionInput, operation: 'create' | 'update' | 'observe'): Diagnostic | undefined {
  const installation = input.capabilities.installation;
  if (!input.capabilities.adapter.explicitRecords || !input.capabilities.adapter.recordTypes.includes(input.intent.record.type)) return capabilityDiagnostic('The selected DNS adapter cannot represent the requested record type.');
  if (installation.configurationEvidenceRefs.length === 0) return capabilityDiagnostic('ExternalDNS installation capabilities have no configuration evidence reference.');
  if (installation.crdSource !== 'enabled') return capabilityDiagnostic(`ExternalDNS CRD source is ${installation.crdSource}.`);
  if (!installation.configuredRecordTypes?.includes(input.intent.record.type)) return capabilityDiagnostic(`ExternalDNS does not explicitly advertise ${input.intent.record.type} record management.`);
  if (!installation.managedDomainPatterns || !domainMatches(input.intent.dnsName, installation.managedDomainPatterns)) return capabilityDiagnostic(`ExternalDNS does not explicitly advertise management of ${input.intent.dnsName}.`);
  if (!namespaceMatches(input.placement.namespace, installation.watchedNamespaces)) return capabilityDiagnostic(`ExternalDNS does not explicitly advertise watching namespace ${input.placement.namespace}.`);
  if (installation.dryRun !== false) return capabilityDiagnostic(`ExternalDNS dry-run state is ${String(installation.dryRun)}; real publication is not proven.`);
  if (operation === 'update' && (installation.mutationPolicy === 'create-only' || installation.mutationPolicy === 'unknown' || installation.targetUpdates !== 'supported')) return capabilityDiagnostic('ExternalDNS installation does not prove that target updates are supported.');
  if (operation === 'create' && installation.mutationPolicy === 'unknown') return capabilityDiagnostic('ExternalDNS mutation policy is unknown.');
  if ((input.requirements?.controllerObservation ?? 'required') === 'required' && installation.controllerObservation !== 'supported') return capabilityDiagnostic('ExternalDNS controller-generation observation is required but not supported by installation capabilities.');
  if ((input.requirements?.providerRecordOwnership ?? 'required') === 'required' && (installation.providerRecordOwnership !== 'configured' || installation.registry === 'noop' || installation.registry === 'unknown')) return capabilityDiagnostic('ExternalDNS provider-record ownership is required but not proven by the installation registry configuration.');
  return undefined;
}

function validateDeletionCapabilities(input: ExternalDnsPublicationDeletionInput): Diagnostic | undefined {
  const installation = input.capabilities.installation;
  if (installation.configurationEvidenceRefs.length === 0) return capabilityDiagnostic('ExternalDNS installation capabilities have no configuration evidence reference.');
  if (installation.crdSource !== 'enabled') return capabilityDiagnostic(`ExternalDNS CRD source is ${installation.crdSource}.`);
  if (!namespaceMatches(input.placement.namespace, installation.watchedNamespaces)) return capabilityDiagnostic(`ExternalDNS does not explicitly advertise watching namespace ${input.placement.namespace}.`);
  if (installation.dryRun !== false) return capabilityDiagnostic(`ExternalDNS dry-run state is ${String(installation.dryRun)}; provider cleanup is not proven.`);
  if (installation.mutationPolicy !== 'sync' || installation.recordDeletion !== 'supported') return capabilityDiagnostic('Deleting a DNSEndpoint cannot promise provider-record cleanup unless ExternalDNS uses sync policy and advertises record deletion.');
  if ((input.requirements?.providerRecordOwnership ?? 'required') === 'required' && (installation.providerRecordOwnership !== 'configured' || installation.registry === 'noop' || installation.registry === 'unknown')) return capabilityDiagnostic('ExternalDNS provider-record ownership is required for deletion but not proven by installation capabilities.');
  return undefined;
}

function observedObjectObservation(current: DnsEndpointObject, intent: NormalizedDnsPublicationIntent, ownership: DnsPublicationOwnership, placement: DnsPublicationPlacement, capabilities: DnsPublicationCapabilities, propagation: DnsPropagationObservation | undefined, desiredGenerationOverride?: number): DnsPublicationObservation {
  const generation = current.metadata.generation;
  const observedDigest = current.metadata.annotations?.[externalDnsPublicationMetadata.intentDigestAnnotation];
  const desiredSpec = renderSpec(intent);
  const currentIntent: DnsIntentObservation = generation !== undefined && sameJson(current.spec, desiredSpec) && observedDigest === intent.normalization.intentDigest
    ? { state: 'current', generation, intentDigest: intent.normalization.intentDigest }
    : { state: 'drifted', desiredDigest: intent.normalization.intentDigest, ...(observedDigest ? { observedDigest } : {}) };
  const desiredGeneration = desiredGenerationOverride ?? generation;
  const controller = controllerObservation(current, capabilities, desiredGeneration);
  const checkedPropagation = validatePropagationObservation(intent, capabilities, propagation);
  return {
    intent: currentIntent,
    controller,
    propagation: checkedPropagation.observation,
    evidence: publicationEvidence(current, ownership, placement, capabilities),
    diagnostics: checkedPropagation.diagnostic ? [checkedPropagation.diagnostic] : [],
  };
}

function deletionObservation(current: DnsEndpointObject, ownership: DnsPublicationOwnership, placement: DnsPublicationPlacement, capabilities: DnsPublicationCapabilities): DnsPublicationObservation {
  const generation = current.metadata.generation;
  const intentDigest = current.metadata.annotations?.[externalDnsPublicationMetadata.intentDigestAnnotation];
  const intent: DnsIntentObservation = generation !== undefined && intentDigest
    ? { state: 'current', generation, intentDigest }
    : { state: 'drifted', desiredDigest: intentDigest ?? sha256Digest('unknown-dns-intent') };
  return {
    intent,
    controller: controllerObservation(current, capabilities, generation),
    propagation: { state: 'notChecked' },
    evidence: publicationEvidence(current, ownership, placement, capabilities),
    diagnostics: [],
  };
}

function absentObservation(capabilities: DnsPublicationCapabilities): DnsPublicationObservation {
  const controller: DnsControllerObservation = capabilities.installation.controllerObservation === 'unsupported'
    ? { state: 'unsupported', capabilityEvidence: capabilities.installation.configurationEvidenceRefs }
    : { state: 'unavailable' };
  return { intent: { state: 'absent' }, controller, propagation: { state: 'notChecked' }, evidence: [], diagnostics: [] };
}

function validatePropagationObservation(intent: NormalizedDnsPublicationIntent, capabilities: DnsPublicationCapabilities, propagation: DnsPropagationObservation | undefined): { readonly observation: DnsPropagationObservation; readonly diagnostic?: Diagnostic } {
  if (!propagation || propagation.state === 'notChecked') return { observation: { state: 'notChecked' } };
  if (capabilities.installation.propagationVerification !== 'available') {
    return {
      observation: { state: 'notChecked' },
      diagnostic: diagnostic('CAPABILITY_MISSING', 'DNS propagation evidence was supplied without an available propagation-verification capability.', 'Bind a declared durable propagation verifier before reporting checked propagation.'),
    };
  }
  const verification = propagation.verification;
  const expected: string[] = intent.record.type === 'CNAME' ? [intent.record.target] : [...intent.record.addresses];
  const evidenceExpected = uniqueSorted(verification.expected);
  const observed = uniqueSorted(verification.observed);
  if (verification.intentDigest !== intent.normalization.intentDigest || verification.dnsName !== intent.dnsName || verification.recordType !== intent.record.type || !sameJson(evidenceExpected, uniqueSorted(expected)) || !/^sha256:[a-f0-9]{64}$/.test(verification.evidenceDigest) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(verification.checkedAt) || !verification.verifier) {
    return {
      observation: { state: 'notChecked' },
      diagnostic: diagnostic('SCHEMA_INVALID', 'DNS propagation evidence does not match the normalized desired answers or required redacted evidence shape.', 'Discard stale or malformed verifier evidence and run the declared verifier for the current intent.'),
    };
  }
  const answersMatch = sameJson(observed, evidenceExpected);
  if (propagation.state === 'verified' && !answersMatch) {
    return {
      observation: { state: 'mismatch', verification },
      diagnostic: diagnostic('RESOURCE_CONFLICT', 'DNS propagation evidence was classified as verified but its observed answers do not match the expected answers.', 'Treat the evidence as a mismatch and rerun verification under the durable verifier policy.'),
    };
  }
  if (propagation.state === 'mismatch' && answersMatch) {
    return {
      observation: { state: 'inconclusive', verification },
      diagnostic: diagnostic('SCHEMA_INVALID', 'DNS propagation evidence was classified as a mismatch even though its normalized answers match.', 'Do not elevate contradictory evidence to verified; rerun the verifier.'),
    };
  }
  return { observation: propagation };
}

function controllerObservation(current: DnsEndpointObject, capabilities: DnsPublicationCapabilities, desiredGeneration: number | undefined): DnsControllerObservation {
  if (capabilities.installation.controllerObservation !== 'supported') return { state: 'unsupported', capabilityEvidence: capabilities.installation.configurationEvidenceRefs };
  if (desiredGeneration === undefined) return { state: 'unavailable' };
  const observedGeneration = current.status?.observedGeneration;
  if (observedGeneration !== undefined && observedGeneration >= desiredGeneration) return { state: 'observed', desiredGeneration, observedGeneration };
  return { state: 'pending', desiredGeneration, ...(observedGeneration === undefined ? {} : { observedGeneration }) };
}

function publicationEvidence(current: DnsEndpointObject, ownership: DnsPublicationOwnership, placement: DnsPublicationPlacement, capabilities: DnsPublicationCapabilities): readonly DnsPublicationEvidence[] {
  const uid = current.metadata.uid;
  const resourceVersion = current.metadata.resourceVersion;
  const desiredGeneration = current.metadata.generation;
  const digest = current.metadata.annotations?.[externalDnsPublicationMetadata.intentDigestAnnotation];
  if (!uid || !resourceVersion || desiredGeneration === undefined || !digest) return [];
  return [{
    adapter: 'external-dns',
    apiVersion: DNS_API_VERSION,
    kind: DNS_KIND,
    placement,
    name: current.metadata.name,
    uid,
    resourceVersion,
    desiredGeneration,
    ...(current.status?.observedGeneration === undefined ? {} : { observedGeneration: current.status.observedGeneration }),
    controllerId: ownership.controllerId,
    publicationId: ownership.publicationId,
    sourceUid: ownership.source.uid,
    normalizationVersion: NORMALIZATION_VERSION,
    digestAlgorithm: 'sha256',
    intentDigest: digest,
    capabilityEvidenceRefs: capabilities.installation.configurationEvidenceRefs,
  }];
}

function domainMatches(dnsName: string, patterns: readonly string[]): boolean {
  return patterns.some((patternInput) => {
    const pattern = patternInput.trim().toLowerCase().replace(/\.$/, '');
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(2);
      return dnsName.endsWith(`.${suffix}`) && dnsName !== suffix;
    }
    return dnsName === pattern || dnsName.endsWith(`.${pattern}`);
  });
}

function namespaceMatches(namespace: string, namespaces: readonly string[] | 'all' | undefined): boolean {
  return namespaces === 'all' || Boolean(namespaces?.includes(namespace));
}

function isKubernetesNamespaceName(value: string): boolean {
  return value.length >= 1 && value.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value);
}

function isKubernetesConnectionName(value: string): boolean {
  return value.length >= 1 && value.length <= 63 && /^[a-z](?:[a-z0-9-]*[a-z0-9])?$/.test(value);
}

function objectRef(current: DnsEndpointObject): ObjectRef {
  return {
    apiVersion: current.apiVersion,
    kind: current.kind,
    name: current.metadata.name,
    ...(current.metadata.namespace ? { namespace: current.metadata.namespace } : {}),
    ...(current.metadata.uid ? { uid: current.metadata.uid } : {}),
    ...(current.metadata.resourceVersion ? { resourceVersion: current.metadata.resourceVersion } : {}),
  };
}

function requiredMetadata(current: DnsEndpointObject, field: 'uid' | 'resourceVersion'): string {
  const value = current.metadata[field];
  if (!value) throw new Error(`DNSEndpoint metadata.${field} was validated before guarded mutation.`);
  return value;
}

function samePlacement(left: DnsPublicationPlacement, right: DnsPublicationPlacement): boolean {
  return left.mode === right.mode && left.namespace === right.namespace && (left.mode === 'local' || (right.mode === 'connection' && left.connection === right.connection));
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== 'object') return value;
  const canonical: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const next = Reflect.get(value, key);
    if (next !== undefined) canonical[key] = canonicalJson(next);
  }
  return canonical;
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort();
}

function addDiagnostic(observation: DnsPublicationObservation, next: Diagnostic): DnsPublicationObservation {
  return { ...observation, diagnostics: [...observation.diagnostics, next] };
}

function conflictDecision(next: Diagnostic, observation: DnsPublicationObservation): ExternalDnsPublicationDecision {
  return { kind: 'conflict', diagnostic: next, observation };
}

function unsupportedDecision(next: Diagnostic, observation: DnsPublicationObservation): ExternalDnsPublicationDecision {
  return { kind: 'unsupported', diagnostic: next, observation };
}

function diagnostic(code: Diagnostic['code'], message: string, recovery: string): Diagnostic {
  return { severity: 'error', code, message, recovery: { summary: recovery } };
}

function capabilityDiagnostic(message: string): Diagnostic {
  return diagnostic('CAPABILITY_MISSING', message, 'Bind explicit ExternalDNS installation capabilities that satisfy this publication operation.');
}

function invalidIntent(message: string): Result<never> {
  const error: Applik8sError = {
    code: 'SCHEMA_INVALID',
    message,
    severity: 'error',
    context: {},
    recovery: { summary: 'Correct the DNS publication input before creating an ExternalDNS decision.' },
  };
  return { ok: false, error };
}

function sha256Digest(value: string): Sha256Digest {
  return `sha256:${sha256Hex(value)}`;
}

function sha256Hex(value: string): string {
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const bytes = utf8Bytes(value);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const high = Math.floor(bitLength / 0x1_0000_0000);
  const low = bitLength >>> 0;
  for (const shift of [24, 16, 8, 0]) bytes.push((high >>> shift) & 0xff);
  for (const shift of [24, 16, 8, 0]) bytes.push((low >>> shift) & 0xff);

  const hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const words = new Array<number>(64).fill(0);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const start = offset + index * 4;
      words[index] = (((bytes[start] ?? 0) << 24) | ((bytes[start + 1] ?? 0) << 16) | ((bytes[start + 2] ?? 0) << 8) | (bytes[start + 3] ?? 0)) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const word15 = words[index - 15] ?? 0;
      const word2 = words[index - 2] ?? 0;
      const small0 = rotateRight(word15, 7) ^ rotateRight(word15, 18) ^ (word15 >>> 3);
      const small1 = rotateRight(word2, 17) ^ rotateRight(word2, 19) ^ (word2 >>> 10);
      words[index] = (((words[index - 16] ?? 0) + small0 + (words[index - 7] ?? 0) + small1) >>> 0);
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const upper1 = rotateRight(e ?? 0, 6) ^ rotateRight(e ?? 0, 11) ^ rotateRight(e ?? 0, 25);
      const choice = ((e ?? 0) & (f ?? 0)) ^ (~(e ?? 0) & (g ?? 0));
      const temporary1 = (((h ?? 0) + upper1 + choice + (constants[index] ?? 0) + (words[index] ?? 0)) >>> 0);
      const upper0 = rotateRight(a ?? 0, 2) ^ rotateRight(a ?? 0, 13) ^ rotateRight(a ?? 0, 22);
      const majority = ((a ?? 0) & (b ?? 0)) ^ ((a ?? 0) & (c ?? 0)) ^ ((b ?? 0) & (c ?? 0));
      const temporary2 = (upper0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = ((d ?? 0) + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    hash[0] = ((hash[0] ?? 0) + (a ?? 0)) >>> 0;
    hash[1] = ((hash[1] ?? 0) + (b ?? 0)) >>> 0;
    hash[2] = ((hash[2] ?? 0) + (c ?? 0)) >>> 0;
    hash[3] = ((hash[3] ?? 0) + (d ?? 0)) >>> 0;
    hash[4] = ((hash[4] ?? 0) + (e ?? 0)) >>> 0;
    hash[5] = ((hash[5] ?? 0) + (f ?? 0)) >>> 0;
    hash[6] = ((hash[6] ?? 0) + (g ?? 0)) >>> 0;
    hash[7] = ((hash[7] ?? 0) + (h ?? 0)) >>> 0;
  }
  return hash.map((word) => (word >>> 0).toString(16).padStart(8, '0')).join('');
}

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function utf8Bytes(value: string): number[] {
  const bytes: number[] = [];
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) bytes.push(codePoint);
    else if (codePoint <= 0x7ff) bytes.push(0xc0 | (codePoint >>> 6), 0x80 | (codePoint & 0x3f));
    else if (codePoint <= 0xffff) bytes.push(0xe0 | (codePoint >>> 12), 0x80 | ((codePoint >>> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    else bytes.push(0xf0 | (codePoint >>> 18), 0x80 | ((codePoint >>> 12) & 0x3f), 0x80 | ((codePoint >>> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
  }
  return bytes;
}
