# DNS Publication from Operators

Applik8s v0.5 provides provider-neutral DNS intent and observation contracts plus a first-party
ExternalDNS adapter. It is intended for records chosen during reconciliation. Static application
exposure continues to use `app.expose(..., { dns: ... })` and Ingress annotations.

Import the handler-safe API from the dedicated entrypoint:

```ts
import { dns, externalDnsPublicationMetadata, externalDnsPublicationName } from '@applik8s/applik8s/dns';
```

The adapter performs no I/O. It normalizes untrusted record input and returns exactly one semantic
decision: create-only `apply`, guarded `patch`, guarded `delete`, `noop`, `conflict`, or `unsupported`.
Handlers execute that decision through ordinary local or connection-scoped Kubernetes effects.

## Guarantees

- A, AAAA, and single-target CNAME records are normalized deterministically.
- DNS names are lower-cased and IDNA-normalized; IPv4 and IPv6 values are canonicalized and sorted.
- A versioned SHA-256 digest identifies the normalized intent.
- The Kubernetes object name is derived only from controller and publication identity. Record changes
  update the same `DNSEndpoint`.
- Existing objects are mutated only after all ownership labels and annotations match.
- Updates use JSON Patch tests for UID and resource version. Deletes use Kubernetes UID/resource-version
  preconditions.
- Installation capabilities are explicit. Unknown CRD-source, namespace, domain, policy, registry,
  observation, or ownership support fails closed when required.
- Desired Kubernetes state, ExternalDNS generation observation, and real DNS propagation are reported
  separately.
- Propagation evidence is accepted only when it is bound to the current normalized intent digest, DNS
  name, record type, and expected normalized answers.

`controller.state === 'observed'` proves only that ExternalDNS reported an observed generation at least
as new as the desired object generation. It is not proof that the provider accepted the record or that
recursive resolvers return it. A durable propagation verifier is a separate effect.

## Local handler shape

```ts
import { dns, externalDnsPublicationMetadata, externalDnsPublicationName } from '@applik8s/applik8s/dns';
import { sdk } from '@applik8s/sdk';

const Domain = sdk.crd({ /* domain spec/status schemas */ });
const DnsEndpoint = dns.externalDns.resource({
  access: 'local',
  namespaces: ['dns-system'],
});

const capabilities = dns.externalDns.capabilities({
  crdSource: 'enabled',
  configuredRecordTypes: ['A', 'AAAA', 'CNAME'],
  managedDomainPatterns: ['example.com'],
  watchedNamespaces: ['dns-system'],
  controllerObservation: 'supported',
  mutationPolicy: 'sync',
  registry: 'txt',
  providerRecordOwnership: 'configured',
  targetUpdates: 'supported',
  recordDeletion: 'supported',
  dryRun: false,
  propagationVerification: 'unavailable',
  configurationEvidenceRefs: [
    { apiVersion: 'apps/v1', kind: 'Deployment', namespace: 'dns-system', name: 'external-dns' },
  ],
});

export const domains = sdk.operator({
  name: 'domains',
  deployment: { namespace: 'dns-system' },
  resources: { Domain },
  reads: { DnsEndpoint },
  permissions: [
    { apiGroups: ['externaldns.k8s.io'], resources: ['dnsendpoints'], verbs: ['create', 'patch', 'delete'] },
  ],
  secondaryWatches: [
    sdk.watch(DnsEndpoint).enqueue(Domain, {
      namespace: 'source',
      map: {
        mode: 'targetNameFromSourceField',
        source: { kind: 'annotation', key: externalDnsPublicationMetadata.sourceNameAnnotation },
      },
    }),
  ],
  handlers: [
    Domain.on.reconcile(async (domain) => {
      const normalized = dns.normalize({
        publicationId: domain.spec.publicationId,
        dnsName: domain.spec.dnsName,
        record: domain.spec.record,
        ttlSeconds: domain.spec.ttlSeconds,
      });
      if (!normalized.ok) throw new Error(normalized.error.message);

      const ownership = {
        controllerId: 'domains.example.com/v1',
        publicationId: normalized.value.publicationId,
        source: {
          apiVersion: domain.object.apiVersion,
          kind: domain.object.kind,
          namespace: domain.metadata.namespace,
          name: domain.metadata.name,
          uid: domain.metadata.uid,
        },
        // Restore this from authoritative domain status after the first observation.
        previousEvidence: domain.status.publicationEvidence,
      };
      const name = externalDnsPublicationName(ownership.controllerId, ownership.publicationId);
      const current = await domain.read.resource(DnsEndpoint).get({ name, namespace: 'dns-system' });
      const decision = dns.externalDns.decide({
        intent: normalized.value,
        ownership,
        placement: { mode: 'local', namespace: 'dns-system' },
        capabilities,
        ...(current ? { current } : {}),
      });

      if (decision.kind === 'apply') domain.resources.apply(decision.resource, { ownership: { mode: 'none' } });
      if (decision.kind === 'patch') domain.resources.patch(decision.ref, decision.patch);
      if (decision.kind === 'noop' && decision.observation.controller.state !== 'observed') {
        domain.requeue({ afterSeconds: 5, reason: 'ExternalDNS observation is pending' });
      }
      if (decision.kind === 'conflict' || decision.kind === 'unsupported') {
        throw new Error(decision.diagnostic.message);
      }
      domain.status.publication = decision.observation;
    }),
  ],
});
```

Use `externalDnsPublicationName(controllerId, publicationId)` for the exact read key. Persist returned
evidence in authoritative domain status and pass it back as `previousEvidence`. This detects same-name
deletion and recreation by UID.

For finalization, read the exact current object, call `dns.externalDns.decideDelete(...)`, and lower a
delete decision as:

```ts
domain.resources.delete(decision.ref, { preconditions: decision.precondition });
```

Deletion is supported only when the declared installation uses `sync`, supports deletion, and satisfies
the selected provider-record ownership requirement. Removing a Kubernetes object under `upsert-only`
does not prove provider-record cleanup, so the adapter rejects that promise.

## Connection-scoped execution

Declare the canonical read resource with `access: 'connection'` and grant the named connection an exact
remote permission envelope. This produces no management-cluster RBAC for `DNSEndpoint`.

```ts
const DnsEndpoint = dns.externalDns.resource({
  access: 'connection',
  namespaces: ['dns-system'],
});

const destination = sdk.kubernetes.connection.required({
  endpointPolicy: 'destination-dns',
  permissions: [{
    apiGroups: ['externaldns.k8s.io'],
    resources: ['dnsendpoints'],
    verbs: ['get', 'list', 'create', 'patch', 'delete'],
    namespaces: ['dns-system'],
  }],
});
```

Read through `ctx.kubernetes.connection('destination').read.resource(DnsEndpoint)`. Lower mutations
through the same connection. A create uses managed remote authority. A patch uses the decision's exact
UID/resource-version evidence:

```ts
remote.resources.patch(decision.ref, decision.patch, {
  authority: { mode: 'existing', precondition: decision.precondition },
});

remote.resources.delete(decision.ref, {
  preconditions: decision.precondition,
  authority: { mode: 'existing', precondition: decision.precondition },
});
```

Remote resources do not receive a local Kubernetes watch. Use a bounded durable poll or requeue until
the handler/workflow deadline. One mutation plan still addresses at most one remote connection.

## Ownership boundary

The adapter proves ownership of one deterministic Kubernetes object inside the caller's Kubernetes
authorization boundary. It does not claim exclusive ownership of the DNS name or provider record.
Ingresses, Services, another `DNSEndpoint`, another ExternalDNS installation, or an out-of-band provider
client can still declare the same DNS name. ExternalDNS registry/owner-ID policy and provider controls
remain separate installation concerns.

The complete design and acceptance matrix are recorded in
[the DNS publication RFP](./rfp-dns-publication.md).
