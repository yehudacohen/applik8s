# RFP: Reusable DNS Publication Primitives for Applik8s Operators

**Status:** Implemented in the Applik8s v0.5 release candidate; contract, package, WASM, host, and OrbStack evidence complete

**Audience:** Applik8s maintainers

**Requested by:** Generic operator requirements

**Revised:** 2026-07-14

**Target:** Applik8s v0.5.0

## Executive summary

Applik8s already supports managed DNS for statically authored application exposure through
`DnsPublication.externalDns()`. That surface binds an ExternalDNS provider to `app.expose(...)`, emits
ExternalDNS annotations on the generated Ingress, records the provider in the application graph, and
reports DNS propagation as unverified.

Stateful operators also need generic DNS provider knowledge during durable runtime workflows. An
operator must be able to declare an explicit DNS publication intent, materialize it through ExternalDNS,
observe whether the current Kubernetes generation was read by the controller, and retain honest evidence
across retries, restarts, rollback, and source-object recreation.

This RFP delivered:

- provider-neutral DNS intent, normalization, observation, capability, ownership, and evidence contracts
- a first-party ExternalDNS adapter based on explicit `DNSEndpoint` resources
- a canonical structural `DNSEndpoint` resource definition for typed reads
- safe local and connection-scoped execution paths
- an exact mapped-secondary-watch primitive for local ownership wakeups
- a separate contract for durable DNS propagation verification

Applik8s owns the reusable integration. Domain operators remain responsible for deciding
when DNS changes, which target is active, and how a durable workflow rolls forward or back.

## Existing functionality that must not be duplicated

As of the Applik8s v0.5 release candidate:

| Capability | Existing behavior |
| --- | --- |
| Provider binding | `DnsPublication.externalDns()` is a public application provider. |
| Static exposure | `app.expose(..., dns: { mode: 'managed' })` binds DNS to an application Ingress. |
| ExternalDNS annotations | Hostname and optional TTL annotations are emitted on the Ingress. |
| Application graph | The `DnsPublication` provider and managed DNS intent are recorded. |
| Readiness honesty | Exposure readiness reports `propagationUnverified`; it does not claim DNS convergence. |
| TypeKro integration | `@applik8s/applik8s/factories/external-dns` re-exports TypeKro ExternalDNS factories. |
| ExternalDNS installation | TypeKro provides ExternalDNS Helm/bootstrap compositions. |
| Explicit record factory | TypeKro provides an `externaldns.k8s.io/v1alpha1` `DNSEndpoint` factory. |
| External resources | The SDK declares typed structural Kubernetes read resources with local, connection, or combined access. |
| Connection-scoped effects | Handlers can perform explicitly authorized reads and mutations through a named Kubernetes connection. |
| Secondary watches | Local watches support both namespace fan-out and an exact label/annotation-to-target-name mapper. |

These capabilities remain backward compatible. This RFP fills the missing operator-runtime contract; it
does not introduce another installation system, generic Kubernetes client, or durable workflow engine.

## Implementation evidence

The accepted implementation is split along the boundary described by this RFP:

- `packages/core/src/dns.ts` owns provider-neutral contracts.
- `packages/applik8s/src/dns.ts` owns the handler-safe ExternalDNS adapter and structural resource helper.
- `packages/core/src/handler.ts`, compiler lowering, and the Rust host own exact mapped wakeups.
- the runtime contract and bridge carry guarded delete preconditions through local and named-connection
  execution.
- `packages/applik8s/test/dns-publication.vertical.test.ts` covers normalization, capabilities, ownership,
  replacement, propagation evidence, and local/remote dispatch.
- `packages/e2e/test/dns-publication-live.e2e.test.ts` proves packaged ComponentizeJS execution against
  OrbStack with ExternalDNS, operator restart, stable-identity A-to-CNAME-to-A changes, exact local
  wakeup, connection isolation, guarded finalization, and complete teardown.

The v0.5 scorecard and package-consumer gate include this surface. The live proof deliberately reports
propagation as `notChecked`; it proves ExternalDNS controller observation with an in-memory provider, not
public DNS propagation.

## Problem statement

Before this implementation, an Applik8s operator could not express the following without owning
provider-specific details:

1. Publish an explicit DNS record whose target is selected during reconciliation.
2. Change that record through a durable, idempotent operation.
3. Observe whether ExternalDNS read the current `DNSEndpoint` generation.
4. Distinguish Kubernetes intent state, controller observation, and actual DNS propagation.
5. Prove whether it may mutate or delete its deterministic Kubernetes intent object.
6. Retain serializable evidence across retry, restart, rollback, or replacement of the intent object.
7. Declare what an ExternalDNS installation is configured to support without confusing adapter support
   with installation support.
8. Use the same adapter locally or through a declared Kubernetes connection without embedding credentials
   in the handler artifact.

The adapter can prove ownership of a Kubernetes object. It cannot by itself prove exclusive ownership of
a provider DNS record. Another `DNSEndpoint`, Ingress, Service, ExternalDNS installation, or out-of-band
provider client may declare the same DNS name. Provider-record ownership remains a distinct installation
and ExternalDNS-registry concern.

## Architectural boundary

Applik8s owns:

- generic DNS input and normalized intent types
- validation and versioned normalization
- orthogonal observation and evidence vocabulary
- Kubernetes-object ownership and replacement detection
- provider capability requirements and installation capability facts
- the ExternalDNS `DNSEndpoint` renderer and observer
- local and connection-scoped execution documentation
- local exact mapped-watch support
- propagation-verifier interfaces and durable evidence types

Domain operators own:

- target selection and domain policy
- failover, failback, and traffic ordering
- retry, timeout, cancellation, and terminal workflow state
- accepted-risk policy when controller or propagation evidence is unavailable
- rollback to a prior normalized intent
- mapping domain capability references to an Applik8s DNS installation binding

ExternalDNS and its provider own:

- translating Kubernetes intent into provider operations
- provider credentials and provider-specific behavior
- ExternalDNS registry and owner-ID semantics
- controller status, events, logs, and metrics

## Required outcome

Applik8s exposes a provider-neutral DNS model usable from compiled handlers and ships an ExternalDNS
adapter that renders exactly one normalized endpoint in one explicitly owned `DNSEndpoint` object.

The first implementation supports:

- A records with one or more validated IPv4 addresses
- AAAA records with one or more validated IPv6 addresses
- CNAME records with exactly one validated DNS target
- optional positive integer TTL values with documented bounds
- deterministic resource identity that is stable across record mutations
- idempotent create, update, no-op, ownership-conflict, replacement-conflict, and delete decisions
- generation-aware controller observation
- durable, redacted Kubernetes evidence
- explicit installation capabilities, including ExternalDNS mutation policy and registry
- local and declared-connection execution
- compilation into the handler runtime without Node-only or TypeKro runtime dependencies

MX, SRV, TXT, NS, weighted routing, aliases, and provider-specific endpoint properties are future
extensions. Later record types use discriminated typed inputs and record-specific validation.

## Public semantic model

Exact names may follow repository conventions. The separation between untrusted input, normalized intent,
ownership, placement, observation, and adapter-specific decisions is normative.

### Input and normalization

Handlers receive ordinary strings from CRD specs and external observations. They must not need unsafe casts
to manufacture branded DNS values.

```ts
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
    readonly version: string;
    readonly digestAlgorithm: 'sha256';
    readonly intentDigest: Sha256Digest;
  };
}

export function normalizeDnsPublicationIntent(
  input: DnsPublicationIntentInput,
): Result<NormalizedDnsPublicationIntent>;
```

Normalization defines and tests case handling, trailing-dot behavior, IDNA profile, IPv4 and IPv6
canonicalization, CNAME target rules, array ordering, duplicate removal, TTL validation, and serialization.
The normalization version changes whenever those semantics change.

### Ownership and placement

Ownership and execution placement are not DNS record fields:

```ts
export interface DnsPublicationOwnership {
  readonly controllerId: string;
  readonly publicationId: DnsPublicationId;
  readonly source: {
    readonly apiVersion: string;
    readonly kind: string;
    readonly namespace?: string;
    readonly name: string;
    readonly uid: string;
  };
  readonly previousEvidence?: DnsPublicationEvidence;
}

export type DnsPublicationPlacement =
  | { readonly mode: 'local'; readonly namespace: string }
  | { readonly mode: 'connection'; readonly connection: string; readonly namespace: string };
```

The Kubernetes object name is derived from a versioned hash of `controllerId + publicationId`. The
namespace and cluster or connection scope complete the Kubernetes object key. DNS name, record type,
target, TTL, source UID, and intent digest are deliberately excluded from the object name so changing any
record field updates the same object.

The source UID participates in ownership proof, not object identity. A source recreated with the same
name receives a different UID and does not silently acquire the prior object.

### Observation

The observation axes are discriminated facts rather than strings plus one ambiguous reason:

```ts
export type DnsIntentObservation =
  | { readonly state: 'absent' }
  | { readonly state: 'drifted'; readonly desiredDigest: Sha256Digest; readonly observedDigest?: Sha256Digest }
  | { readonly state: 'current'; readonly generation: number; readonly intentDigest: Sha256Digest };

export type DnsControllerObservation =
  | { readonly state: 'unsupported'; readonly capabilityEvidence: readonly ObjectRef[] }
  | { readonly state: 'pending'; readonly desiredGeneration: number; readonly observedGeneration?: number }
  | { readonly state: 'observed'; readonly desiredGeneration: number; readonly observedGeneration: number }
  | { readonly state: 'unavailable'; readonly desiredGeneration?: number };

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
```

`controller.state === 'observed'` means only that ExternalDNS recorded an observed generation at least as
new as the desired Kubernetes generation. It is not proof of provider success or DNS propagation. A stale
or missing observed generation never completes controller observation.

A UI may derive a summary phase, but the phase is not persisted as a second source of truth. `applying` is
an action in the parent durable operation, not an observed DNS state.

## ExternalDNS adapter

Provider-neutral contracts live with stable core DNS concepts. ExternalDNS artifacts and decisions live
in the runtime-safe ExternalDNS adapter exported initially from `@applik8s/applik8s/dns`.

```ts
export type ExternalDnsPublicationDecision =
  | {
      readonly kind: 'apply';
      readonly resource: DnsEndpointObject;
      readonly observation: DnsPublicationObservation;
    }
  | {
      readonly kind: 'patch';
      readonly ref: OwnedObjectRef;
      readonly patchType: 'json';
      readonly patch: readonly JsonPatchOperation[];
      readonly observation: DnsPublicationObservation;
    }
  | {
      readonly kind: 'delete';
      readonly ref: OwnedObjectRef;
      readonly precondition: { readonly uid: string; readonly resourceVersion?: string };
      readonly observation: DnsPublicationObservation;
    }
  | { readonly kind: 'noop'; readonly observation: DnsPublicationObservation }
  | {
      readonly kind: 'conflict';
      readonly diagnostic: Diagnostic;
      readonly observation: DnsPublicationObservation;
    }
  | {
      readonly kind: 'unsupported';
      readonly diagnostic: Diagnostic;
      readonly observation: DnsPublicationObservation;
    };
```

The adapter accepts normalized desired intent, ownership, installation capabilities, current observed
objects, and optional durable verifier evidence. It returns a pure semantic decision. It performs no
hidden writes, retries, watches, provider calls, or network access.

The parent handler lowers create-only apply, UID/resource-version-tested JSON Patch, delete, or requeue
through the selected local or connection-scoped Kubernetes effect path. Server-side apply is used only
when no object exists because Kubernetes apply does not provide an atomic UID/resource-version update
precondition. The adapter emits exactly one ordered mutation decision rather than exposing a generic
effect list that could contain contradictory writes.

### Rendering

The ExternalDNS adapter must:

- render `externaldns.k8s.io/v1alpha1` `DNSEndpoint`
- render exactly one normalized endpoint per object
- derive the object name only from the stable publication identity
- update the same object when DNS name, record type, target, or TTL changes
- include stable managed-by metadata, controller identity, publication identity, source identity, source
  UID, normalization version, digest algorithm, and normalized-intent digest
- use short labels for selection and mapped-watch routing, and annotations for full or potentially long
  identity and digest values
- avoid provider credentials, account identifiers, or Secret values
- exclude `providerSpecific`, aliases, routing policy, and provider extensions initially

The existing Ingress annotation path remains the representation for static `app.expose()` declarations.

### Ownership and conflict semantics

Kubernetes-object ownership is proven from the complete versioned ownership metadata. If durable prior
evidence exists, its UID must match the observed object UID. A different UID is a replacement conflict,
even if labels and annotations match.

The adapter must fail closed when:

- the deterministic object exists without complete matching ownership metadata
- controller identity or publication identity differs
- source UID differs
- prior evidence names a different object UID
- installation capabilities do not permit the requested operation

An exact matching ownership tuple permits retry after a crash between object application and status
evidence persistence. A recreated source object does not adopt the prior endpoint by name. An explicit
future recovery policy may permit adoption only with durable evidence of the prior ownership transition.

A Kubernetes owner reference may supplement metadata only when source and endpoint share a namespace and
the declared lifecycle is correct. Owner references are not portable ownership proof for connection,
cross-namespace, or retained-resource lifecycles.

Deletion requires the currently observed UID. When prior evidence exists, its UID must also match.
Resource-version preconditions are used where the Kubernetes operation supports them. Target changes and
record-type changes update the existing object and do not require deletion.

The adapter does not claim to discover every competing declaration of the same DNS name. Optional visible
conflict detection may inspect a bounded declared set of `DNSEndpoint` objects, but Kubernetes-object
ownership remains distinct from ExternalDNS registry and provider-record ownership.

## Installation capability contract

Static adapter support must not imply that an ExternalDNS installation enables the CRD source, watches a
namespace, manages a record type or domain, writes status, permits an operation, owns provider records, or
performs real provider writes.

```ts
export interface DnsPublicationCapabilities {
  readonly adapter: {
    readonly explicitRecords: true;
    readonly recordTypes: readonly ('A' | 'AAAA' | 'CNAME')[];
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
```

At minimum:

- `create-only` cannot advertise reversible target updates.
- `upsert-only` cannot advertise provider-record deletion.
- `noop` registry cannot advertise configured provider-record ownership.
- `dryRun: true` cannot satisfy a real-publication requirement.
- unknown source, domain, namespace, record-type, or operation support remains explicitly unknown and is
  rejected when the caller requires that guarantee.

Installation facts come from an explicit deployment binding or platform-maintained capability object.
TypeKro may emit that object for installations it owns. Existing installations may supply the same
contract independently. The handler artifact declares requirements but contains neither provider
credentials nor environment-specific Secret coordinates.

## Operator integration

Applik8s provides a canonical structural `DNSEndpoint` read definition with typed spec and status. It is
not an operator-owned CRD and does not expose TypeKro enhanced-resource types at runtime.

The helper supports the SDK's existing access modes:

- `local`: typed reads and writes use the operator cluster and generate declared RBAC
- `connection`: typed reads and writes use one named connection and generate no local RBAC for the remote
  resource
- `both`: the operator may deliberately select either path

Local mutation uses the ordinary handler resource effect path. Connection mutation uses the existing
connection resource effect path and must include declared remote mutation authority. Adapter output is
therefore a serializable Kubernetes resource decision rather than a TypeKro runtime object.

Generated local RBAC uses a namespaced Role when the endpoint namespace is statically bounded to the
operator or source namespace. ClusterRole or multi-namespace lowering requires an explicit broader
declaration. Connection-only access is authorized by the connection permission envelope rather than local
RBAC.

### Local exact mapped watches

The existing `mapper: { mode: 'all' }` secondary watch is insufficient for this integration because every
`DNSEndpoint` status update would reconcile every domain owner in the namespace.

Applik8s adds a generic exact mapper whose conceptual contract is:

```ts
sdk.watch(DnsEndpoint).enqueue(PublicationOwner, {
  namespace: 'source',
  map: {
    mode: 'targetNameFromSourceField',
    source: {
      kind: 'annotation',
      key: 'dns.applik8s.dev/source-name',
    },
  },
});
```

The generic mapper accepts one declared source label or annotation. The compiler validates the metadata
key and target scope. The host reads that one field, validates the value as a Kubernetes name, performs
one target `get`, and reconciles only that object. Missing, invalid, or out-of-scope mappings fail closed
with diagnostics. The target handler still validates source UID and publication evidence; mapped
metadata is routing data, not ownership proof. The DNS adapter uses an annotation because Kubernetes
object names may exceed the 63-character label-value limit.

Remote connection resources do not receive local secondary watches. A connection-scoped DNS operation
uses bounded durable polling or explicit requeue until its deadline. Remote event streaming is outside
this RFP.

## Evidence

Evidence is serializable, redacted, and safe to retain in domain status:

```ts
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
  readonly normalizationVersion: string;
  readonly digestAlgorithm: 'sha256';
  readonly intentDigest: Sha256Digest;
  readonly capabilityEvidenceRefs: readonly ObjectRef[];
}
```

Evidence never contains provider credentials, Secret data, kubeconfig coordinates, arbitrary object
bodies, unrestricted controller logs, or provider account identifiers.

## Propagation verification

Propagation verification is nondeterministic external I/O and is not part of rendering or controller
observation. It is a separate durable task or effect, such as `DnsPropagationVerifier`, with explicit
policy for:

- authoritative, recursive, or combined observation
- resolver allowlists and quorum
- expected-answer normalization
- deadline, retry, and inconclusive outcomes
- TTL, negative caching, and resolver caching expectations
- evidence retention and redaction
- network policy and host-protocol execution

The verifier returns durable evidence interpreted by the generic observation model. Compiled handlers do
not receive unrestricted network access or provider credentials merely to verify propagation. A mismatch
is distinct from an inconclusive lookup, and neither is silently treated as success.

Verifier evidence binds the normalized intent digest, DNS name, record type, expected normalized
answers, verifier identity, and check time. Evidence from another publication or an earlier semantic
intent is rejected even when its observed answer set happens to match.

A concrete verifier implementation is not required for the initial ExternalDNS adapter.

## Compatibility

- Existing `DnsPublication.externalDns()` and `app.expose()` behavior remains source compatible.
- Existing `propagationUnverified` readiness retains its historical meaning.
- Existing application graph artifacts are not reinterpreted by the new observation model.
- Provider-neutral types expose no ExternalDNS wire fields.
- ExternalDNS types are isolated to the adapter subpath.
- The adapter remains deterministic and replayable for identical normalized input, capabilities, observed
  objects, and verifier evidence.
- Normalization, identity, metadata, and digest contracts are explicitly versioned.
- The canonical external resource supports local and connection-scoped reads without creating a second
  generic Kubernetes API.

## Security requirements

- No provider credential, kubeconfig, Secret value, or provider account identifier enters the handler
  artifact, intent object, diagnostic, or retained evidence.
- Local and connection-scoped permissions are least privilege and independently declared.
- Remote mutations require explicit connection mutation authority.
- Unknown installation capabilities fail closed when the operation requires them.
- Kubernetes metadata is ownership evidence only within the Kubernetes authorization boundary.
- Kubernetes-object ownership is never described as provider-record exclusivity.
- Propagation verification uses bounded host-mediated networking and redacted durable evidence.

## Acceptance tests

### Unit and contract tests

1. Normalize valid A, AAAA, and CNAME inputs into branded canonical values.
2. Reject invalid DNS names, IPv4/IPv6 addresses, empty targets, CNAME cardinality, and TTLs.
3. Exercise case, trailing-dot, IDNA, duplicate, ordering, and record-specific normalization.
4. Produce stable normalization digests and change the digest for every semantic record mutation.
5. Keep the Kubernetes object name stable when DNS name, type, target, TTL, source UID, or digest changes.
6. Distinguish the same publication identity in different namespaces and connection scopes.
7. Return `apply` for a missing intent and a UID/resource-version-tested `patch` for drift on an
   ownership-proven object.
8. Return `noop` when normalized intent, ownership, and current generation match.
9. Fail closed on missing ownership metadata, controller mismatch, publication mismatch, or source-UID
   mismatch.
10. Detect deleted-and-recreated objects by UID and refuse mutation or deletion using stale evidence.
11. Require the observed UID for deletion and use resource-version preconditions where supported.
12. Keep stale or missing `observedGeneration` pending.
13. Report controller observation only when observed generation reaches the desired generation.
14. Never reinterpret controller observation as propagation or provider success.
15. Report unsupported observation when installation capabilities say status is unavailable.
16. Exercise `sync`, `upsert-only`, `create-only`, registry, dry-run, domain, namespace, and record-type
    capability matrices.
17. Reject an operation whose required installation capability is false or unknown.
18. Never report propagation verification without matching durable verifier evidence.
19. Distinguish propagation mismatch from inconclusive verification.
20. Produce stable redacted evidence with no credential or unrestricted object content.
21. Compile the adapter into a handler component without Node-only or TypeKro runtime dependencies.
22. Prove that visible Kubernetes ownership does not claim exhaustive DNS-name or provider ownership.

### Integrated Applik8s tests

1. Declare the canonical resource for local, connection, and combined access.
2. Dispatch a real SDK handler and verify typed `DNSEndpoint` spec and status reads.
3. Apply and delete adapter decisions through the local resource effect path.
4. Apply and delete decisions through a declared Kubernetes connection with remote authority.
5. Verify connection-only declarations generate no local `DNSEndpoint` RBAC.
6. Verify local declarations generate only the explicitly bounded Role or broader declared permissions.
7. Lower the exact metadata-to-target-name secondary watch and reconcile only the owning resource.
8. Reject invalid, missing, or out-of-scope exact mappings.
9. Use bounded requeue rather than local watches for connection-scoped observation.
10. Confirm the application-authoring Ingress annotation path remains unchanged.
11. Confirm existing application graphs continue to report `propagationUnverified`.
12. Confirm installation capabilities are not inferred from adapter support.

### Local Kubernetes E2E

Using ExternalDNS with the CRD source and a non-production in-memory provider:

1. Apply publication target A.
2. Wait for the current `DNSEndpoint` generation to be observed.
3. Change the same publication to target B without changing the Kubernetes object identity.
4. Change record type and prove the same Kubernetes object is updated.
5. Restore target A using the same publication identity.
6. Restart the parent operator between changes and prove idempotent continuation.
7. Exercise an exact local secondary-watch wakeup and prove unrelated owners are not reconciled.
8. Exercise the same adapter through an isolated v0.5 Kubernetes connection and bounded polling.
9. Demonstrate that stale status, ownership conflict, replacement UID, unsupported policy, and unavailable
   controller remain non-success states with actionable diagnostics.
10. Confirm cleanup requires the owned UID and cannot delete a same-name replacement.
11. Inspect status plus controller logs or metrics to prove only that ExternalDNS read the current object.
12. Complete lifecycle-aware teardown without stranded resources. A TypeKro deployment must delete its
    instance before its RGD; the direct proof removes compiler-owned resources before its CRD and
    namespaces.

The E2E reports `controller.state: 'observed'` and `propagation.state: 'notChecked'` unless it installs and
exercises a real DNS-query verifier. An in-memory provider proves controller processing, not public DNS
propagation.

## Deliverables

1. Provider-neutral input, normalized intent, observation, capability, ownership, and evidence contracts.
2. First-party ExternalDNS `DNSEndpoint` renderer and observer.
3. Canonical structural `DNSEndpoint` resource definition for local and connection access.
4. Generic exact label/annotation-to-target-name secondary-watch mapping.
5. Explicit deployment binding or capability-object contract for installation facts.
6. Unit, SDK-dispatch, compiler, host, regression, and local Kubernetes E2E coverage.
7. API reference documentation with local and connection-scoped handler examples.
8. Compatibility, ownership, normalization, recovery, and security notes.
9. A separately specified durable propagation-verifier interface.
10. Release evidence naming the first package version satisfying this RFP.

## Non-goals

This RFP does not request:

- failover, failback, traffic, or active-endpoint policy in Applik8s
- a domain-specific CRD or workflow
- installation of ExternalDNS when an installation already exists
- automatic discovery of arbitrary ExternalDNS deployment flags
- provider credentials inside a compiled operator artifact
- direct Route53, Cloud DNS, Azure DNS, or other provider SDK integrations
- proof of global DNS propagation from `observedGeneration`
- exhaustive discovery of every competing declaration of a DNS name
- a second generic Kubernetes read or mutation framework
- remote Kubernetes event streaming
- replacement of the existing `app.expose()` annotation integration
- runtime DNS mutation through Ingress annotations
- provider-specific `DNSEndpoint` fields in the initial public contract
- untyped MX, SRV, TXT, or NS records

## Accepted design decisions

1. Generic DNS concepts belong in Applik8s; failover policy remains in domain operators.
2. Provider-neutral contracts and ExternalDNS artifacts are separate type layers.
3. Runtime workflows standardize initially on explicit `DNSEndpoint` resources.
4. Static `app.expose()` continues using Ingress annotations.
5. Publication identity is stable across every record mutation.
6. Source UID is ownership evidence, not publication identity.
7. Controller observation, provider-record ownership, and DNS propagation are separate guarantees.
8. Installation mutation policy and registry are required capability facts.
9. Local operation uses exact mapped watches; connection-scoped operation uses bounded polling.
10. Propagation verification is a separate durable effect with bounded network policy.
11. Provider-specific endpoint properties and later record types remain excluded initially.

## Recommendation

Adopt explicit `DNSEndpoint` objects as the canonical ExternalDNS representation for operator-runtime DNS
publication, retain annotations for static exposure, and preserve the following evidence chain:

```text
untrusted input
  -> versioned normalized intent
  -> pure ExternalDNS decision
  -> ownership-proven Kubernetes object current
  -> controller observed current generation
  -> propagation not checked
  -> optional durable propagation verification
```

This is the smallest generic addition that enables safe, reversible DNS cutover without importing domain-specific policy
policy into Applik8s or overstating what Kubernetes and ExternalDNS prove.

## References

- ExternalDNS CRD source and `DNSEndpointStatus.observedGeneration`:
  <https://kubernetes-sigs.github.io/external-dns/latest/docs/sources/crd/>
- ExternalDNS source model:
  <https://kubernetes-sigs.github.io/external-dns/latest/docs/sources/about/>
- ExternalDNS installation flags and mutation policy:
  <https://kubernetes-sigs.github.io/external-dns/latest/docs/flags/>
- Existing Applik8s provider implementation:
  `packages/applik8s/src/application-providers.ts`
- Existing Applik8s exposure lowering:
  `packages/applik8s/src/application.ts`
- Existing secondary-watch contract:
  `packages/core/src/handler.ts`
- Existing connection-scoped SDK surface:
  `packages/sdk/src/interfaces.ts`
- Existing TypeKro `DNSEndpoint` factory:
  `../typekro/src/factories/external-dns/resources/dns-endpoint.ts`
