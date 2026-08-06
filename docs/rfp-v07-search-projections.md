# RFP: Applik8s v0.7 — Relationship-Aware Search Projections

**Status:** Proposed; maintainer review required

**Charter:** [`charter-v07-agentic-platform.md`](charter-v07-agentic-platform.md)

**Depends on:** v0.6 native models and relationships, committed change streams, durable processors,
provider DI, authorization operations, TypeKro, and object storage

**Unblocks:** Chirp content discovery, searchable authority audit, and Agentic Start administration

## Purpose

Add named, typed, relationship-aware search indexes whose documents are derived from canonical
provider-native model state, including relational, Kubernetes, and framework entity authorities. Search
providers are rebuildable projections. Application code never dual-writes search state and canonical
state.

The starter profile should use a bounded PostgreSQL search implementation where its declared capabilities
are sufficient. The dedicated profile uses OpenSearch by default. This proves provider neutrality and
keeps local resource requirements honest without weakening the OpenSearch production gate.

## Required developer experience

The ordinary path starts from a promoted model and follows its typed relationship graph:

```ts
export const ProductSearch = Product.index(
  "search",
  search.text(Product.title, { boost: 4 }).as("title"),
  search.text(Product.description).as("description"),
  search.facet(Product.category.name).as("categoryName"),
  search.filter(Product.marketValue).as("marketValue"),
);
```

The model supplies the canonical root identity. The explicit name remains stable graph identity, so
renaming the export does not rename the index.

One-to-many paths require explicit aggregation:

```ts
export const ProductSearch = Product.index(
  "search",
  search.text(Product.title, { boost: 4 }).as("title"),
  search.values(Product.listings.seller.name).as("sellerNames"),
  search.minimum(Product.listings.price).as("minimumPrice"),
  search.count(Product.listings.id).as("listingCount"),
);
```

`application.index(...)` is the advanced form for a custom root identity, a cross-model projection that
does not naturally belong to one promoted model, or a maintained module constructing an index from
model handles:

```ts
export const EvidenceSearch = application.index(
  "evidence-search",
  {
    root: Evidence,
    identity: Evidence.id,
  },
  search.text(Evidence.title, { boost: 3 }).as("title"),
  search.text(Evidence.excerpt).as("excerpt"),
  search.facet(Evidence.source.kind).as("sourceKind"),
);
```

Both forms lower to the same named index node, revision, synchronization plan, and `search` operation.
There is no separate shorthand runtime.

The returned index is an ordinary typed operation surface:

```ts
ProductReader.can(ProductSearch.search);
```

## Owned contracts

This RFP owns:

- the named `Model.index()` golden path and advanced `application.index()` construction API;
- path typing, aliases, mapping derivation, cardinality checks, and inverse invalidation plans;
- provider-neutral typed search requests and results;
- committed-change synchronization;
- physical generations, checkpoints, lag, rebuild, validation, alias cutover, and retirement;
- authorization-filter injection and cursor binding;
- PostgreSQL starter and OpenSearch dedicated/external providers;
- TypeKro OpenSearch lifecycle and recovery evidence.

It does not own canonical writes, a second model schema, product authorization decisions, arbitrary
OpenSearch DSL, or general analytical projections.

## One schema and relationship graph

An index selects from the existing promoted model and relationship graph. It does not require a second
search-document interface or manual database-to-schema mapper.

“Existing promoted model” is intentionally plural:

- a relational root/path retains its Drizzle table, columns, keys, and relations;
- a CRD/resource root/path retains its ArkType spec/status schema, identity, ownership, and watch
  frontier;
- an analytical model/projection root retains its declared analytical schema and checkpoint/change
  frontier when that provider capability can supply incremental synchronization;
- an existing framework entity retains its ArkType entity definition and declared reference graph.

The index compiler reads common promoted facets and explicit provider refinements. It does not make
Drizzle the universal model format, convert CRDs into synthetic tables, or require authors to repeat
fields in an index document type.

Each selected value retains:

- root and contributing model identity;
- Drizzle column/type information where relational;
- ArkType runtime value schema;
- relationship path and cardinality;
- nullable/optional semantics;
- public alias;
- search modifier and provider capability requirement;
- authorization-relevant provenance.

The compiler derives the document schema from those sources and emits a normalized, provider-neutral
index plan. Provider adapters consume that plan; application code does not define OpenSearch mappings and
PostgreSQL expressions separately.

CRD-backed and relational models use the same `Index` and `search` experience where their declared read,
identity, change, and relationship capabilities are equivalent. Unsupported relationships or change
frontiers fail construction rather than degrading silently.

Declarative field selection is intentionally not an execution closure: the compiler must inspect it to
derive inverse invalidation, authorization, and rebuild plans. Any application-supplied aggregation or
normalization closure is an explicitly bounded, serializable projection function with a source location
and direct/provider parity tests; an adapter may not replace it with an unrelated mapper.

## Logical identity, revision, and physical generation

Search lifecycle uses three separate identities:

```text
LogicalIndexIdentity
  application ID
  logical index name

IndexRevision
  root model and identity-schema revisions
  document-schema revision
  field/mapping plan revision
  relationship/invalidation-plan revision
  authorization-filter-plan revision

PhysicalGeneration
  logical index identity
  index revision
  provider binding and provider-generation ID
  physical index/alias names
  hydration checkpoint and creation provenance
```

`ProductSearch.search` is the stable operation belonging to `LogicalIndexIdentity`. Rebuilds, provider
replacement, and alias cutover do not create a new logical operation or silently invalidate grants.
Grants generally bind the logical operation plus explicit compatible revision constraints. A grant that
depends on fields or authorization behavior removed by a new revision becomes incompatible and fails
closed; ordinary physical-generation replacement does not alter authority.

Variable names and source locations are not stable identities. Field aliases are explicit when a path
does not have an unambiguous collision-free public name.

Compatible index revisions may roll forward in place only when the provider proves compatibility.
Incompatible revisions create a new physical generation and use the rebuild/catch-up/cutover protocol.

Composite model identities must either be supported by a canonical encoded identity contract or rejected
at compilation. v0.7 must not silently concatenate fields.

The normalized index artifact contains:

```text
logical identity and index revision
root identity encoder
typed document schema
provider-neutral field plan
forward hydration plan
inverse affected-root plan
change dependencies
authorization filter inputs
rebuild/cutover contract
required provider capabilities
```

This artifact is serializable and does not reconstruct authored ArkType or Drizzle graphs inside indexer
invocations.

## Relationship planning

For every selected path the compiler derives:

- forward hydration joins from the root;
- cardinality at each edge;
- relationship authority and integrity class;
- read-consistency and observed-revision requirements for every contributing authority;
- the changed models that can affect a document;
- an inverse affected-root lookup;
- a bounded fan-out estimate or declared ceiling;
- deletion and reparent behavior.

Compilation fails for:

- ambiguous relations;
- cycles without an explicit bound;
- many-valued paths without aggregation;
- missing inverse keys;
- unbounded affected-root scans;
- field-name collisions without aliases;
- provider-unsupported field semantics;
- unstable document identity.

Relationship planning preserves native meaning:

- Drizzle foreign keys and relations may supply relational integrity and one-transaction snapshot reads;
- Kubernetes owner references, typed references, selectors, and watches supply control-plane identity and
  observed-resource-version frontiers, not SQL foreign keys;
- cross-provider references remain reconcile-checked links and never imply a cross-provider transaction;
- analytical/projection relationships require an explicit source/checkpoint contract and cannot become
  canonical integrity constraints.

An index may span authorities only when it has a bounded hydration and inverse-invalidation plan for
each edge. It must not describe a PostgreSQL-plus-Kubernetes read as one atomic snapshot. Such a plan
records the observed frontier of every contributing authority, validates that the root did not change
during hydration, and schedules repair when a compatible snapshot cannot be assembled. An index that
requires strict cross-authority consistency fails construction unless a provider capability can
actually prove it.

When a related change exceeds its declared fan-out ceiling, the processor does not attempt an unbounded
transaction. It records lag/escalation and schedules bounded partitioned repair or a full rebuild.

Within one transactional authority, hydration reads use a consistent authoritative snapshot. Across
authorities, hydration uses the explicit frontier protocol above. Both paths return one document
candidate per root.
Delete, soft-delete, relationship removal, and reparent operations explicitly decide whether to replace
or delete the prior document. An inability to resolve the prior affected root is a repair condition, not
a successful no-op.

All relationship traversals require an inverse plan. Full-table rescans are permitted only as explicit
rebuild operations with recorded bounds; they may not appear in incremental synchronization.

## Typed search contract

```ts
const result = await ProductSearch.search({
  text: "first edition charizard",
  where: {
    categoryName: "pokemon",
    marketValue: { gte: 100 },
  },
  facets: [ProductSearch.categoryName],
  orderBy: ProductSearch.marketValue.desc(),
  limit: 24,
});
```

Results include typed documents, scores where supported, highlights, facets, an opaque cursor, logical
index identity, index revision, physical generation, authoritative source projection revision, and
measured lag. Capability-dependent features fail at
construction or require an explicit refinement; a PostgreSQL provider must not pretend to provide an
OpenSearch-specific guarantee.

`search` is an `ApplicationQueryOperation`. It participates in the operation catalog, authority, browser
facade, SSR, live invalidation, result bounds, deadline, cancellation, and audit contracts. The gateway
dispatches to the model/index's qualified provider; callers do not select `"postgres"` or
`"opensearch"`.

An explicit advanced provider escape hatch may exist only on a provider-refined index:

```ts
const OpenSearchEvidence = EvidenceSearch.require(
  SearchCapabilities.openSearchQuery,
);
```

Using it makes the provider requirement graph-visible and invalidates profiles that cannot supply it.

## Synchronization

```text
canonical transaction
  -> committed change/outbox
  -> durable index processor
  -> affected-root resolution
  -> bounded authoritative hydration
  -> idempotent replace/delete
  -> checkpoint and lag publication
  -> live-query invalidation
```

Retries use the same logical change identity. Search visibility does not acknowledge the canonical
command and cannot make it successful or failed retroactively.

If the indexer falls behind the retained change frontier, it enters `rebuildRequired`; it must not claim
to catch up from incomplete history.

The change identity contains source model, canonical identity, committed change ID, transaction/causal
identity, and schema revision. Allocation sequence and wall-clock timestamp are metadata, not commit
frontiers. A provider checkpoint advances only after every earlier committed change in its source
frontier is applied or durably classified for repair.

Index writes use whole-document replace/delete semantics. Incremental field patches are permitted only
when the compiler can prove equivalence with authoritative rehydration; they are not required for v0.7.

## Rebuild and cutover

Rebuild requires:

1. committed authoritative source frontier;
2. versioned physical generation;
3. bounded snapshot scan;
4. idempotent bulk hydration;
5. retained change catch-up;
6. count, sample, schema, and checksum validation;
7. authorization-filter compatibility validation;
8. atomic logical alias cutover;
9. observed reader transition;
10. explicit prior-generation retirement.

Timestamps and allocated sequence values are not assumed to be commit order.

Rebuild and incremental processors share the same hydration and serialization plan. Cutover is blocked
when required authorization filters, document schema, counts, validation samples, retained-change
frontier, or provider health cannot be proven compatible. Rollback never reuses a cursor from the
rejected generation.

## Search authorization

Search itself is an operation governed by the typed authority RFP. The search gateway resolves mandatory
filters from admitted principal, trusted context, target scope, relationships, and authorization
revision. Caller input may narrow but never remove or broaden mandatory filters.

Cursors bind to:

- logical index identity;
- index revision;
- physical generation;
- principal and trusted-context digest;
- permission/grant and authorization revision;
- normalized query digest;

OpenSearch document/field security is defense in depth and never canonical application authority.

Authorization-filter plans are compiled from bounded authority scopes and relationships. They are
separate from user filters and combined monotonically. If a scope cannot be represented faithfully by
the provider, ordinary page-level post-filtering is forbidden: unauthorized candidates may otherwise
affect totals, facets, aggregations, ranking, highlights, page fullness, and cursor progression even when
their rows are removed.

Post-filtering is permitted only when the gateway retrieves the complete candidate universe under a
proven cardinality and resource ceiling, applies authorization before every observable result is
constructed, and recomputes results, totals, facets, aggregations, ranking, highlights, pagination, and
cursor state solely from authorized documents. If complete bounded retrieval or faithful recomputation
cannot be proven, the query is rejected. Provider-side document/field security remains defense in depth
and never relaxes this requirement.

## Provider profiles

### Starter

A PostgreSQL implementation may satisfy:

- bounded text search;
- typed filters and sort;
- declared facets where supported;
- cursor pagination;
- lag and rebuild contracts.

Unsupported fuzzy, vector, analyzer, or highlight semantics require capability refinement.

The PostgreSQL implementation must use bounded indexed predicates and supported full-text facilities. It
must expose honest explain/cost ceilings and reject a query that would require an unbounded scan.

### Dedicated

OpenSearch is the default and must support the charter's typed search surface, secure credentials, TLS,
snapshots to S3-compatible storage, topology, disruption policy, monitoring, and generation cutover.

The TypeKro integration must provide:

- explicitly owned operator/chart bootstrap and externally managed alternatives;
- single-node development and highly available production clusters;
- external Secret references and generated credential ownership;
- TLS and certificate-manager paths;
- persistent storage, topology, disruption budgets, retention, and deletion policy;
- S3-compatible snapshot repositories with restore evidence;
- network policy, Service/exposure, and monitoring hooks;
- complete public status in direct and KRO modes;
- update and deletion behavior that does not strand namespaces, finalizers, PVCs, or RGDs.

The upstream contribution must be merged and released before the Applik8s runtime pins it. Applik8s must
consume the released TypeKro composition rather than copying its Helm values or lifecycle logic.

### External

The application graph contains endpoint, credential reference, expected capabilities, ownership,
retention, snapshot responsibility, and readiness evidence without provider credentials.

External readiness verifies declared capabilities and version compatibility without mutating the remote
cluster. Destruction removes only Applik8s-owned credentials and projections; it never deletes the
external service or snapshots.

## Implementation increments

1. Define logical index identity, index revision, physical generation, field alias, capability, and
   schema-evolution contracts.
2. Implement relationship planning and compile-time rejection fixtures.
3. Implement committed-change synchronization and deterministic test provider.
4. Implement the bounded PostgreSQL starter provider.
5. Land and release TypeKro OpenSearch lifecycle support.
6. Implement OpenSearch runtime, security, snapshots, rebuild, and cutover.
7. Integrate typed operations, browser queries, live invalidation, and authorization filters.
8. Qualify Chirp and authority-audit search paths.

## Required gates

- Every index has an explicit stable name.
- Public examples use `Model.index()` for ordinary model-rooted indexes and reserve
  `application.index()` for custom-root, cross-model, or maintained-module construction.
- `Model.index()` and `application.index()` lower to the same logical index, revision, synchronization,
  authority, and search-operation contracts.
- Rebuild and cutover preserve the logical search operation while cursors bind the exact revision and
  physical generation.
- Grants survive physical-generation replacement unless their explicit revision constraints become
  incompatible.
- Index plans are serialized without authoring-time ArkType/Drizzle graph reconstruction.
- Relational, CRD/resource, analytical, and framework entity models retain their native authoritative definitions
  and share the search contract only where they declare equivalent capabilities.
- Relational, Kubernetes, analytical, and cross-provider relationship plans preserve native integrity
  and read-frontier semantics rather than claiming a universal transaction.
- Related update, delete, and reparent produce the correct root replacements/deletions.
- Duplicate and reordered deliveries remain idempotent.
- Fan-out above the declared ceiling does not run unbounded.
- History loss causes `rebuildRequired`.
- Rebuild never serves a partially populated generation.
- Cutover and rollback preserve cursor/index-revision/physical-generation safety.
- Caller filters cannot remove mandatory authorization scope.
- A provider incapable of representing a required authorization scope rejects or retrieves the complete
  bounded universe and recomputes every observable result after authorization; page-level filtering is
  forbidden.
- PostgreSQL and OpenSearch pass the same provider-neutral contract where they claim the same capability.
- Direct and KRO OpenSearch install, update, snapshot, restore, deletion, and cleanup pass.
- A fresh packed Agentic Start reaches search through canonical writes and committed changes without
  manual document insertion.

## Open questions

1. Which minimum relevance, facet, and highlight capabilities belong in the provider-neutral contract?
2. Should vector retrieval extend `Index` in v0.7 or remain a follow-on provider refinement?
3. Which fan-out estimates can be derived statically and which require declared runtime ceilings?
4. Which complete candidate universes are small and predictable enough to permit fully recomputed
   gateway authorization in v0.7?

## Definition of done

This RFP is complete when named indexes compile into bounded inverse invalidation and rebuild plans,
PostgreSQL and OpenSearch providers satisfy their declared capabilities, search remains authorization
scoped, TypeKro owns the complete OpenSearch lifecycle, and Chirp can rebuild and live-query related
content without manual document writes. The public example must demonstrate a related-model change,
reparent, delete, history-loss rebuild, atomic cutover, authorization denial, SSR query, and live
requery through the same typed index. Completion does not authorize v0.7.
