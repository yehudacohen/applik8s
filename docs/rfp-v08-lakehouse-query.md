# RFP: Applik8s v0.8 — Published Lakehouse Datasets and Queries

**Status:** Accepted v0.8 beta implementation contract. Release publication remains separately authorized.

**Manifesto:** [`manifesto-v08-portable-stateful-development.md`](manifesto-v08-portable-stateful-development.md)

**Foundation gate:** The stable `graph-provenance` gate must pass before publication and query execution
attribution are considered qualified.

**Foundation dependencies:** The v0.7 model, query, projection, event, object-storage, provider,
application-graph, authority, and causal-execution contracts plus the manifesto's Phase 0 identity,
provider-guarantee, target, and provenance records

**v0.8 contract integrations:** Portable targets bind DuckDB and AWS resources, inferred runtime access
attributes dataset/query operations, the application plan explains snapshots and topology, and unified
observability records query execution. Provider implementations qualify independently after the semantic
contract exists.

**Initial providers:** DuckDB over local object data and Athena/Glue/S3 on AWS

**Target disposition:** DuckDB local and real-AWS Athena/Glue/S3 are required v0.8 lakehouse verticals.
AWS-local is API-fidelity evidence only. Kubernetes requires an explicitly qualified external engine and
does not silently reinterpret ClickHouse or another `AnalyticalDatabase` as lakehouse support.

## Purpose

Provide an honest portable contract for historical analytical data published as immutable object-backed
snapshots and queried asynchronously. The contract must not pretend that Athena is ClickHouse, that an
object manifest is a mutable table, or that arbitrary SQL has identical behavior across providers.

Two capabilities remain deliberately distinct:

| Capability | Canonical responsibility |
| --- | --- |
| `AnalyticalDatabase` | Incremental, low-latency analytical serving and mutable projection targets |
| `LakehouseDataset` | Versioned immutable files, schema revisions, manifests, and published frontiers |
| `LakehouseQuery` | Asynchronous queries against one published dataset snapshot |

An application may maintain both a serving projection and a historical dataset. Provider selection must
never silently substitute one contract for the other.

## Required developer experience

A dataset is declared from typed application data without exposing Parquet, Glue, or DuckDB mechanics:

```ts
const UsageHistoryDataset = LakehouseDataset.named("historical-usage");
const HistoricalQueries = LakehouseQuery.named("historical-queries");

UsageRecorded
  .publish(UsageHistoryDataset, UsageHistoryRow, (event, output) =>
    output.append({
      organizationId: event.organizationId,
      occurredAt: event.occurredAt,
      kind: event.kind,
      quantity: event.quantity,
    }),
  )
  .partitionBy(row => ({
    organizationId: row.organizationId,
    month: row.occurredAt.slice(0, 7),
  }));
```

A query is an ordinary function-native operation whose implementation consumes the typed capability:

```ts
export const UsageHistory = UsageHistoryDataset.query(
  {
    input: type({
      organizationId: "string",
      from: "string",
      to: "string",
      cursor: "string?",
    }),
    output: type({
      rows: UsageHistoryRow.array(),
      cursor: "string?",
      snapshot: "string",
      scannedBytes: "number.integer >= 0?",
    }),
  },
  async input =>
    HistoricalQueries.query({
      dataset: UsageHistoryDataset,
      snapshot: "latest-published",
      where: row =>
        row.organizationId.eq(input.organizationId)
          .and(row.occurredAt.gte(input.from))
          .and(row.occurredAt.lt(input.to)),
      orderBy: row => [row.occurredAt.asc()],
      page: { size: 200, cursor: input.cursor },
      timeout: "20s",
    }),
);
```

The typed query expression is intentionally narrower than provider SQL. Raw provider queries require an
explicit provider boundary and do not claim cross-provider portability.

Installation supplies providers without changing domain behavior:

```ts
installation
  .provide(UsageHistoryDataset)
  .local(() => Lakehouse.duckdbDataset({ storage: LocalObjects }))
  .aws(() => Lakehouse.s3Dataset({ storage: HistoricalObjects, catalog: UsageCatalog }));

installation
  .provide(HistoricalQueries)
  .local(() => Lakehouse.duckdbQueries())
  .aws(() => Lakehouse.athenaQueries({ workgroup: UsageWorkgroup }));
```

## Owned contracts

This RFP owns:

- dataset identity, schema revision, partition specification, file set, manifest, and publication frontier;
- append/publish semantics and atomic visibility of immutable snapshots;
- query admission, execution, timeout, cancellation, pagination, result, and terminal receipt contracts;
- the provider-neutral typed query subset and compatibility diagnostics;
- schema evolution and reader compatibility;
- DuckDB and Athena/Glue/S3 provider conformance;
- scan/cost evidence and operations visibility;
- dataset/query access descriptors consumed by inferred runtime access.

This RFP does not own:

- low-latency analytical serving or `AnalyticalDatabase` semantics;
- mutable row updates, deletes, indexes, or transactional table writes;
- arbitrary provider SQL portability;
- general object-storage lifecycle;
- event checkpointing before the dataset publisher accepts its input;
- cross-provider historical-data migration without an explicit plan;
- application authorization or tenant visibility policy.

## Dataset identity and publication

A dataset identity includes application, installation/environment, qualification, dataset definition
identity, and schema family. A published snapshot contains:

- immutable snapshot identity;
- dataset and schema revision;
- ordered manifest of immutable object identities and checksums;
- partition metadata and statistics allowed by policy;
- publication time and causal receipt;
- parent snapshot when incremental;
- exact frontier of accepted source facts;
- retention and supersession disposition.

Writers may stage objects in any order. Readers see either the previous published snapshot or the next
complete snapshot, never a partially uploaded file set. Publication is one compare-and-swap transition
against the dataset frontier.

Object existence alone is not publication. A manifest that has not won the canonical publication lease
is garbage-collectable staging data.

## Ingestion and replay

Publishers consume admitted events, batches, projections, or explicit application operations. The
dataset provider records a stable input frontier and idempotency identity.

The contract is:

- at-least-once publisher execution;
- idempotent logical acceptance of one input identity;
- immutable output files;
- atomic manifest publication;
- no acknowledgement of a source checkpoint before the publish receipt is durable;
- deterministic replay or explicit replacement when transformation code changes;
- bounded compaction that preserves the logical snapshot.

Exactly-once arbitrary producer behavior is not claimed. Duplicate physical staging files may exist
temporarily but cannot produce duplicate logical rows in a published snapshot.

## Schema and evolution

Dataset schemas use normalized Applik8s types and carry a stable schema-family identity plus revision.

Compatible evolution includes changes the selected providers and readers prove safe, such as adding an
optional field with an explicit absent/default interpretation. Incompatible changes require a new schema
revision and one of:

- a new dataset identity;
- a full rebuild to a new published snapshot;
- an explicitly versioned reader capable of both revisions.

The planner rejects provider mappings that silently narrow nullability, numeric precision, timestamp
semantics, nested collection behavior, or field names. Provider-specific physical types remain evidence,
not the public application type.

## Query lifecycle

Every query has a stable admission identity and terminal receipt:

```text
admitted -> queued -> running -> succeeded
                    |          -> failed
                    +----------> cancelled
                    +----------> timed-out
```

The admitted query pins one published snapshot before execution. `latest-published` is resolved once; it
does not move between pages.

A query result includes:

- snapshot identity and schema revision;
- typed rows or a typed result-object reference;
- opaque continuation cursor when more results exist;
- execution state and timing;
- scanned bytes and provider cost evidence when available;
- provider and target evidence;
- redacted diagnostic details.

Timeout requests cancellation but does not lie about provider completion. If the provider cannot prove
cancellation, the receipt says `cancellation-pending` or `outcome-unknown` until reconciled.

## Pagination and cursors

Cursors are opaque, signed, versioned, snapshot-bound, query-shape-bound, principal/authorization-bound,
and expiring. They cannot be replayed against another dataset, snapshot, tenant, sort order, or filter.

Ordering must be deterministic. A paginated query without a unique terminal ordering key is rejected or
augmented by a framework-declared stable tie-breaker visible in the plan.

Providers may materialize bounded result objects rather than keep a remote query open. Result retention
and cursor expiry are explicit. Expired results return a typed expiry outcome rather than silently
rerunning against a newer snapshot.

## Consistency and compatibility

The v0.8 consistency contract is `published-snapshot`. It does not include read-your-unpublished-write,
mutable-table transactions, or continuous incremental visibility.

Queries declare requirements including:

- maximum tolerated latency;
- maximum scanned bytes or cost class;
- required functions and type operations;
- pagination and result-size bounds;
- snapshot age tolerance;
- cancellation requirement.

Planning fails when the selected provider cannot satisfy the requirements. A sub-second requirement,
for example, cannot bind to Athena merely because the query text is accepted.

## Provider guarantee vocabulary

Each lakehouse provider publishes machine-readable guarantees for:

- supported logical types and query operators;
- null, timestamp, numeric, and string comparison semantics;
- snapshot and manifest enforcement;
- ordering and pagination stability;
- timeout and cancellation behavior;
- result and cursor retention;
- duplicate and replay behavior;
- maximum query/result/payload sizes;
- scanned-byte and cost evidence;
- schema evolution support;
- access-control enforcement fidelity;
- create, update, interruption recovery, drift, retention, and delete lifecycle.

The DuckDB and Athena providers run the same differential fixtures for every shared claim. A guarantee
not proven by both is either provider-specific or unavailable to portable operations.

## DuckDB provider

The local provider reads the same immutable object/manifest representation used by remote providers. It
must not bypass snapshot publication by scanning arbitrary workspace files.

It owns:

- local object and manifest resolution;
- deterministic schema mapping;
- bounded DuckDB process/connection lifecycle;
- query cancellation and timeout;
- result-object storage and cursor signing;
- restart recovery and cleanup leases.

It is development and conformance evidence, not proof of Athena cost, IAM, quotas, or availability.

## Athena, Glue, and S3 provider

The AWS provider uses S3 for immutable files/manifests/results, Glue for catalog projection, and a
dedicated Athena workgroup for admission, limits, encryption, and cost evidence.

It must:

- publish S3 objects before atomically advancing the canonical manifest;
- update Glue compatibly without exposing a partial snapshot as canonical;
- use workgroup-enforced result location, encryption, byte limits, and tags;
- reconcile asynchronous query state after client or worker interruption;
- cancel when requested and truthfully report uncertain outcomes;
- bind exact per-workload IAM derived from dataset/query operations;
- retain or delete data only according to explicit dataset lifecycle policy;
- produce real-AWS evidence for IAM, encryption, Glue propagation, quotas, cancellation, and teardown.

MiniStack may prove supported API flow. It is not production evidence for those properties.

## Runtime access and application authorization

Known typed operations infer provider-neutral requirements:

- publishers require append/stage/publish access to one qualified dataset;
- queries require catalog/read/query/result access to one qualified dataset/query provider;
- compactors require bounded read/rewrite/publish access;
- lifecycle workers require only their explicit administrative operations.

AWS lowering may create S3, Glue, and Athena IAM statements; local lowering may issue exact brokered
paths and query capabilities. No provider may grant a shared application-wide lakehouse credential as a
fallback.

Application authorization remains separate. A query may have infrastructure access and still be denied
because the principal cannot view the requested organization or dataset partition.

## Operations and cost evidence

The operations surface shows:

- dataset, schema revision, current published snapshot, and frontier;
- staged/unpublished and garbage-collectable objects;
- file/partition counts, logical rows, bytes, and retention;
- query state, snapshot, duration, rows, scanned bytes, result retention, and cost evidence;
- provider compatibility and unsupported requirements;
- compaction, rebuild, schema migration, and deletion state;
- source-to-dataset and query-to-provider provenance.

Costs are evidence, not a portable exact currency promise. Where the provider cannot return exact cost,
the UI shows scanned bytes and a labeled estimate or `unavailable`.

## Failure and lifecycle semantics

The runtime distinguishes staging failure, publication conflict, manifest corruption, catalog lag,
query rejection, provider failure, timeout, cancellation pending, result expiry, and authorization
failure.

Create, update, adopt, drift repair, interruption recovery, retention, compaction, schema migration, and
delete use stable identities and deletion leases. Deleting a query runtime does not delete its dataset.
Deleting an application does not delete retained dataset objects unless the dataset policy explicitly
authorizes it and ownership is proven.

## Implementation increments

### Increment 1 — Contract and manifest authority

- Finalize dataset, snapshot, schema, frontier, query, cursor, and receipt contracts.
- Implement canonical manifest publication and corruption checks.
- Add provider guarantee manifests and differential fixture format.

### Increment 2 — DuckDB local provider

- Publish and query typed local object snapshots.
- Implement pagination, timeout, cancellation, results, reset, and recovery.
- Integrate source-attributed runtime access.

### Increment 3 — AWS provider

- Add S3 dataset, Glue catalog, and Athena workgroup/query lifecycle.
- Add Alchemy lifecycle and least-privilege IAM lowering.
- Prove MiniStack-supported flows without promoting them to production evidence.

### Increment 4 — Evolution and product integration

- Add compatible evolution, rebuild, compaction, retention, cost evidence, and operations UI.
- Exercise one Agentic Start historical usage/evaluation journey.
- Run real-AWS and cross-provider differential gates.

## Required gates

### Publication

- Interrupted upload never advances the published snapshot.
- Retry of one input frontier does not duplicate logical rows.
- Concurrent publishers produce one canonical successor or an explicit conflict/retry.
- Manifest/object corruption fails closed with actionable evidence.

### Schema

- Shared logical types round-trip identically through DuckDB and Athena fixtures.
- Nullability, precision, timestamp, nested, and rename incompatibilities are rejected before publish.
- Compatible and incompatible evolution paths are live tested.

### Query

- DuckDB and Athena return equivalent results for the shared query subset.
- Pagination is stable across process restart and later snapshot publication.
- Timeout, cancellation, provider interruption, result expiry, and retry have terminal typed outcomes.
- Unsupported latency, function, size, and cost requirements fail planning.

### Security

- Tenant/application authorization is enforced independently of infrastructure access.
- Cursors cannot cross principal, tenant, query, or snapshot boundaries.
- Per-workload access excludes unrelated buckets, prefixes, catalogs, workgroups, and result objects.
- Secret and row canaries do not leak through plans, logs, errors, metrics, or cost evidence.

### Lifecycle and evidence

- Local and real-AWS create, no-op, update, drift, interruption recovery, retention, and delete pass.
- MiniStack limitations are labeled and never counted as IAM/encryption/availability evidence.
- Scanned bytes and cost evidence are reconciled from authoritative provider state.
- Acceptance cleanup proves no unintended catalog, result, or staging resources remain.

## Non-goals

- Replacing `AnalyticalDatabase`.
- Sub-second interactive analytics on every provider.
- Mutable lakehouse rows or transactional updates.
- Arbitrary portable SQL.
- Automatic movement of retained datasets between providers.
- Streaming partial query results in v0.8 unless both providers prove one bounded common contract.
- General-purpose ETL orchestration beyond dataset publication/rebuild.
- Claiming exact cost prediction before provider execution.

## Closed v0.8 decisions

- `LakehouseDataset` and `LakehouseQuery` are distinct from `AnalyticalDatabase`.
- Published immutable manifests are the read authority.
- `published-snapshot` is the v0.8 consistency contract.
- DuckDB and Athena/Glue/S3 share one bounded typed query subset and differential suite.
- Raw provider SQL is explicit and nonportable.
- Query calls are asynchronous, cancellable where supported, paginated, and receipt-backed.
- Lakehouse ships beta and does not inherit stable AWS-target maturity.
- MiniStack evidence cannot replace real-AWS evidence.

## Definition of done

This RFP is complete when one typed historical dataset can be published without partial visibility,
queried through the same compatible contract by DuckDB and Athena, evolved and rebuilt explicitly,
paginated and cancelled truthfully, authorized independently of least-privilege runtime access, observed
with scan/cost evidence, and created, recovered, retained, and deleted through live local and real-AWS
lifecycle gates.
