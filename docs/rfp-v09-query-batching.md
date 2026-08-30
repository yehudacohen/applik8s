# RFP: Query Batching

**Status:** Accepted for implementation; architecture frozen on 2026-08-30

**Audience:** Applik8s maintainers, implementing agents, and query-provider authors

**Requested by:** The v0.9 semantic-completion and 1.0-readiness program

**Revised:** 2026-08-30

**Target:** Applik8s v0.9; stable 1.0 candidate only after provider consistency gates pass

**Depends on:** `job()`, query providers, cursor/frontier contracts, managed closures, and the Effect
Receipts, Fencing, and Unknown Outcomes RFP

**Unblocks:** Bounded backfills, bulk maintenance, and query-to-job processing

## Executive summary

Applik8s already supports one-time queries, live views, unbounded stream batching, projections, and
managed execution. A finite query is not an unbounded stream, however, and a loop over paginated results
does not by itself define stable membership, ordering, restart, acknowledgement, or concurrent-mutation
semantics.

This RFP adds `Query.onBatch(...)`. It compiles a bounded query plus a managed handler into a Job. The
application names the consistency it needs; the provider proves a compatible frontier and ordering
strategy or planning fails. Snapshot, monotonic, and explicitly hazardous best-effort execution remain
different contracts rather than documentation-only labels.

The proposal reuses the Job lifecycle, query authority, existing provider clients, and shared cursor and
admission kernels. It does not create a generic ETL language, disguise offset pagination as recovery, or
claim exactly-once external effects.

`Query.onBatch(...)` turns a finite query into a restartable Job without pretending that every database can provide the same snapshot semantics.

## Existing functionality that must not be duplicated

| Capability | Existing boundary to reuse |
| --- | --- |
| Finite execution | `job()` run, result, cancellation, retry, and evidence contracts |
| Query semantics | Native model/query providers and their normal authorization |
| Stream batching | `Stream.onBatch(...)` for unbounded sources and batch acknowledgement |
| Rebuilds | Pure projection `rebuildFrom(...)` where live/rebuild equivalence is provable |
| Cursor integrity | Shared scoped envelope and canonical serialization kernels |
| Admission | Shared principal, authority version, and trusted-context validation |

Query batching adapts those boundaries. It must not add another task runtime, query declaration language,
cursor codec, or authorization path. It extends the existing function-native
`Model.query(contract, implementation)` handle; it does not overload `Model.query(...)` with a second
object-only selector API.

## At a glance

```ts title="src/jobs/reindex-workspace.ts"
const DocumentsForWorkspace = Document.query(
  {
    input: type({ workspaceId: "string" }),
    output: type({
      id: "string",
      workspaceId: "string",
      createdAt: "string",
      body: "string",
    }).array(),
    authorize: ({ principal, input }) =>
      DocumentsPolicy.canRead(principal, input.workspaceId),
  },
  (input, context) =>
    context
      .select(Document)
      .where(document => document.workspaceId.eq(input.workspaceId))
      .orderBy(document => [document.createdAt.asc(), document.id.asc()]),
);

export const ReindexWorkspace = DocumentsForWorkspace
  .onBatch(
    {
      batch: { maxItems: 250 },
      concurrency: 8,
      consistency: QueryConsistency.repeatableSnapshot,
      retries: 3,
      timeout: "30m",
      resources: { cpu: "2", memory: "4Gi" },
    },
    async batch => {
      await SearchIndex.replace(batch.items);
    },
  );

const run = await ReindexWorkspace.start({ workspaceId });
```

## Use this when

- the source is a finite query result;
- processing should resume from a durable query frontier;
- a backfill or bulk operation needs a managed Job;
- the provider can state an honest mutation/ordering consistency guarantee.

Use `Stream.onBatch(...)` for an unbounded stream and acknowledgement semantics. Use an ordinary query for one-time reads that do not require managed processing.

## Problem statement

A naïve pagination loop can skip, duplicate, or reorder data when rows change. A process restart can lose
the only cursor. A long-lived snapshot can expire. Different databases expose different guarantees. If
Applik8s presents one magical API without making those differences explicit, it creates portability by
misrepresentation.

The framework needs a provider-neutral authoring surface whose semantic requirements are strong enough to
compile safely and whose plan explains the actual lowering.

## Normative decisions

1. `Query.onBatch(...)` returns a Job handle and inherits the Job lifecycle.
2. Every execution has a deterministic order or fails before deployment.
3. Provider cursors remain internal; application code receives typed batch windows.
4. Every admitted window has a durable receipt; the committed frontier advances only through the longest
   contiguous prefix of successfully receipted windows.
5. Repeatable-snapshot, version-pinned, monotonic-frontier, and best-effort are distinct provider
   guarantees.
6. Best effort requires explicit acknowledgement of membership drift and idempotency.
7. No provider silently changes the requested consistency.
8. Query authorization applies to every delivered item and every resumed batch.
9. Projection rebuilds remain preferable when a pure authoritative reconstruction exists.
10. Provider capability and frontier expiry are plan-visible.
11. `Query.onBatch(...)` is available only when an existing function-native Query implementation exposes a
    portable, ordered selection. Arbitrary queries remain callable but do not silently become resumable scans.
12. The implementation callback is the single query definition used for one-time invocation and batching;
    authors do not repeat `where`, authorization, projection, or ordering in a batch-only DSL.

## Architectural boundary

Applik8s owns the normalized query contract, ordering proof, consistency vocabulary, typed batch window,
durable frontier protocol, Job integration, authority propagation, diagnostics, and conformance suite.

Query providers own physical snapshot/keyset/revision mechanics and declare their limits. Applications own
handler idempotency and external effect correctness.

## Public contract

`onBatch(options, handler)` returns a Job handle. It does not execute during declaration. The receiver is
the ordinary Query handle returned by `Model.query(contract, implementation)`.

For batching, the implementation returns a provider-neutral selection through the existing query context.
`context.select(Model)` is a compiler-visible query operation inside that implementation, not a second
public declaration form. It carries filtering, projection, stable ordering, authorization scope, and the
provider source required to plan resumable windows. A Query whose implementation computes an arbitrary
aggregate, joins an unbounded source without a stable identity, or hides pagination behind an opaque
operation remains a valid one-time Query but planning `.onBatch(...)` fails with a precise diagnostic.

The type system distinguishes those cases before deployment. A `Model.query(...)` implementation that
returns `QuerySelection<TItem, TIdentity>` receives an `ApplicationBatchableQueryOperation`; other
implementations receive the ordinary `ApplicationQueryOperation`, which does not expose `onBatch`:

```ts
declare const querySelection: unique symbol;

interface QuerySelection<TItem, TIdentity> {
  readonly [querySelection]: true;
  readonly item: TItem;
  readonly identity: TIdentity;
}

interface ApplicationBatchableQueryOperation<TInput, TItem>
  extends ApplicationQueryOperation<TInput, readonly TItem[]> {
  onBatch(
    options: QueryBatchOptions,
    handler: (batch: QueryBatch<TItem>) => void | Promise<void>,
  ): ApplicationJobBinding<TInput, QueryBatchResult>;
}
```

These are illustrative structural names; the shipped declarations may use internal brands, but ordinary
TypeScript autocomplete must not offer `.onBatch(...)` for an opaque aggregate Query and then fail only at
runtime.

`context.select(Model)` builds one normalized selection IR from ordinary typed expression callbacks:

```ts
interface PortableQuerySelectionIR {
  version: "applik8s.query-selection/v1alpha1";
  sourceModel: string;
  predicate: PortableExpression;
  projection: PortableExpression;
  order: readonly { expression: PortableExpression; direction: "asc" | "desc" }[];
  identity: PortableExpression;
  relationshipReads: readonly RelationshipRead[];
  sourceAuthority: string;
  digest: string;
}
```

Selection construction is synchronous and pure. It may capture input values and compiler-known constants,
but cannot call a provider, read time/randomness, perform effects, or hide SQL/client objects. One-time
invocation and batching execute this exact IR; the application does not author a second `where`, projection,
or authorization callback for batch mode.

v0.9 requires one authoritative frontier-owning source model. Relationship reads are permitted only when
the provider proves that the selected consistency revision covers them and that they cannot independently
change membership or ordering. Cross-provider joins, unbounded fan-out, and relationship-dependent order
fail planning rather than degrading to per-item reads.

The generated Job input is exactly the source Query input schema. Its stable output is:

```ts
interface QueryBatchResult {
  processedItems: number;
  completedWindows: number;
  finalFrontier: QueryBatchFrontierReference;
  consistencyRevision: string;
}
```

Provider cursors and snapshot tokens remain opaque. They may be retained by the runtime but are not the
Job input/output or an application compatibility contract.

The handler receives:

```ts
interface QueryBatch<T> {
  items: readonly T[];
  window: QueryBatchWindow;
  processed: number;
  isFinal: boolean;
}
```

The framework owns the cursor/frontier. Applications consume typed items and stable metadata, not raw provider cursors.

Ordinary invocation of a batchable Query materializes the same selection under the Query's declared
`maxRows`, result-size, and timeout budgets. It is not an unbounded convenience read. `.onBatch(...)`
changes execution lifecycle and frontier persistence, not query meaning.

Empty result sets complete successfully without invoking the handler. A final partial batch is delivered once.
`isFinal` is true only when the provider has proven that the window reaches the immutable terminal bound
for this run. Providers that cannot prove such a bound omit speculative prefetch and discover the final
window before invoking its handler; they may not guess from page size alone.

## Stable ordering

A batch query must have a deterministic total order within the declared source. If the authored order is not unique, the compiler appends a stable identity only when the provider can prove one. Otherwise compilation fails with `QUERY_BATCH_ORDER_UNSTABLE`.

Offset pagination is not a restart frontier. Maintained providers use keyset, snapshot, exported snapshot, temporal revision, or another provider-backed strategy.

## Consistency choices

Consistency is named, typed, and provider-qualified.

```ts
QueryConsistency.repeatableSnapshot
QueryConsistency.versionPinned
QueryConsistency.monotonicFrontier
QueryConsistency.bestEffort({
  acceptsMembershipDrift: true,
})
```

### Repeatable snapshot

The logical membership and values are frozen at one provider-defined revision. The provider must keep that revision available for the maximum declared run duration or fail with an expiring-frontier diagnostic before starting.

For providers such as PostgreSQL whose exported snapshots depend on a live owning transaction/session, the
provider contract states who owns that session, how worker windows import it, how failover is detected, and
when it expires. A provider cannot claim restartable repeatable-snapshot execution when loss of one hidden
connection irrecoverably destroys the snapshot. It must use a durable/versioned snapshot, constrain the
execution envelope to the session lifetime, or reject the plan.

The initial PostgreSQL qualification does not keep an exported transaction snapshot alive across Job
restarts. For `repeatableSnapshot`, it atomically materializes the normalized selection's projected item,
stable identity, and order key into a framework-owned, run-scoped snapshot relation before admitting the
first window. The committed snapshot revision and terminal bound become the prepared-scan authority.
Windows then use keyset reads over that immutable relation. Snapshot creation is one retryable database
transaction; partial materialization is never visible. Retention and storage estimates appear in the plan,
and the provider rejects the mode before execution when permissions, capacity, maximum source cardinality,
or declared setup deadline cannot support materialization.

The materialized snapshot is a versioned framework-owned subsystem, not an anonymous temporary table.
Its contract records application/tenant scope, query contract/version, normalized parameter digest,
authority version, run identity, projected schema version, source revision, item count, byte estimate,
creation deadline, retention deadline, and cleanup owner. Table/relation names are derived from framework
identity and never from untrusted query text.

Before admission, the provider obtains or proves a cardinality/size bound and rejects work exceeding the
profile's item, byte, transaction-duration, or storage budget. It may use chunked population only when no
partial snapshot becomes readable and final publication is atomic. Schema changes require a new snapshot
schema version; in-flight runs retain their recorded reader or fail with an explicit migration diagnostic.

Cleanup is lifecycle-owned by the Job run plus a bounded orphan sweeper. Successful, failed, cancelled,
expired, and controller-lost runs each have explicit retention. Cleanup uses run UID/version preconditions
so it cannot remove a replacement run's snapshot. Tenant authorization is preserved in both population and
window reads; shared physical tables require row-level scope in every primary key and cleanup predicate.

Required failure tests cover DDL permission denial, capacity-estimate rejection, transaction timeout,
partial population rollback, database failover, worker/controller loss, schema upgrade, tenant collision,
retention expiry, orphan sweep, and cleanup interruption.

The initial PostgreSQL `monotonicFrontier` lowering reads the authoritative source directly with a proven
unique keyset order and documents concurrent-mutation behavior. `bestEffort` uses the same direct source
only after the explicit hazard acknowledgement. `versionPinned` requires a provider-native immutable
dataset/revision supplied by the selected source. These are distinct execution paths and evidence, not
labels applied to one pagination loop.

### Version pinned

The query names an immutable provider snapshot or dataset version. Retries use that same version; absence
or expiry fails rather than silently selecting a replacement.

### Monotonic frontier

The frontier advances without moving backward. Concurrent changes may affect later pages only according to the provider's documented contract. The result is safe for idempotent convergence but not equivalent to a point-in-time snapshot.

### Best effort

Best effort is hazardous and explicit. It permits omissions or duplicates caused by concurrent membership changes. It therefore requires an idempotency declaration and records that the result is not an authoritative cutover boundary.

No provider silently downgrades or upgrades the requested mode.

## Batch identity and retry

Every batch has a stable logical window identity derived from:

```text
query contract + parameter digest + consistency revision + lower/upper frontier
```

Retrying the handler for the same window preserves that identity. The runtime advances the durable frontier only after the handler succeeds and its framework-owned receipt commits.

The framework does not claim an external side effect is exactly once. Handlers use idempotent operations,
window identity as a deduplication key, or the shared [Effect Receipts, Fencing, and Unknown Outcomes
contract](./rfp-v09-effect-receipts-fencing-and-unknown-outcomes.md).
If the handler's external effect succeeds and the worker dies before the framework receipt commits, that
window is retried. This may duplicate the external effect; it may not skip the window. The plan warns when
an effectful dependency exposes neither idempotency nor a compatible receipt contract.

## Concurrent windows and contiguous frontier

When `concurrency` is greater than one, the runtime assigns immutable ordered window ordinals and bounds
before dispatch. Each window has its own durable receipt:

```text
admitted -> running -> succeeded
                    |-> failed/retryable
```

Completion may be out of order, but the committed scan frontier advances only across the longest
contiguous `succeeded` prefix. If window 8 succeeds before window 7, its receipt is retained while the
frontier remains at 6. After a crash, window 8 is not rerun; window 7 resumes or retries, and a successful
receipt advances the frontier through both 7 and 8.

A provider must retain or deterministically reconstruct every admitted window until it joins the committed
prefix. If its snapshot/frontier mechanism cannot do so, it must force `concurrency: 1` or fail planning
with `QUERY_BATCH_CONCURRENCY_UNSUPPORTED`. It may not claim concurrency while using one lossy page cursor.

Cancellation stops admitting new windows, applies normal Job cancellation to active windows, and records
the final contiguous frontier and any completed out-of-order receipts as evidence. A later run starts under
its own declared consistency/version contract; it does not silently continue a cancelled logical Job.

## Generated Job policy

Because `Query.onBatch(...)` returns a Job, its options include ordinary finite-execution policy directly:

```ts
{
  batch: { maxItems: 1_000 },
  concurrency: 8,
  consistency: QueryConsistency.repeatableSnapshot,
  retries: 3,
  timeout: "30m",
  resources: { cpu: "2", memory: "4Gi" },
}
```

Idempotency scope, cancellation, execution-envelope requirements, and other maintained Job options use the
same names and semantics as `job()`. The API does not introduce a nested provider-shaped batch-job
configuration.

## Mutation during execution

Provider conformance explicitly tests:

- inserts before and after the frontier;
- updates to ordering columns;
- deletes of unseen and already-seen rows;
- snapshot expiry;
- retries after handler success but before frontier commit;
- provider failover and transaction interruption.

The behavior is documented per consistency mode and represented in the plan.

## Authority and tenancy

The source query retains its normal row/resource authorization. Starting a batch job does not grant broader visibility.

The admission envelope binds the query parameters, trusted context digest, authority version, and causal principal. Every resumed batch revalidates the recorded authority according to the job policy; it never accepts client-authored tenant or principal claims.

Runtime access is the exact union of query reads, frontier storage, handler dependencies, and result/progress writes.

## Graph and plan

The graph stores:

- normalized query and parameter contract;
- stable ordering proof;
- requested consistency;
- provider frontier strategy and expiry;
- batch size and concurrency;
- returned Job contract;
- handler dependencies and idempotency evidence.

`applik8s plan` must show the physical query provider, consistency lowering, ordering key, checkpoint authority, and any best-effort hazard.

## Provider contract

Each provider declares support for:

```ts
interface QueryBatchCapabilities {
  repeatableSnapshot: boolean;
  versionPinned: boolean;
  monotonicFrontier: boolean;
  stableKeyset: boolean;
  resumableFrontier: boolean;
  durableWindowReceipts: boolean;
  concurrentWindows: boolean;
  maximumSnapshotAge?: string;
}
```

The runtime adapter implements one restartable protocol:

```ts
interface QueryBatchRuntime<TInput, TItem> {
  prepare(request: QueryBatchPrepareRequest<TInput>): Promise<QueryBatchPreparedScan>;
  readWindow(request: QueryBatchWindowRequest): Promise<{
    items: readonly TItem[];
    bounds: QueryBatchWindowBounds;
    next?: QueryBatchFrontierReference;
    terminal: boolean;
  }>;
  release(request: QueryBatchReleaseRequest): Promise<void>;
}
```

`prepare()` atomically establishes the consistency revision, terminal bound where one exists, normalized
order, and first frontier. `readWindow()` is idempotent for the same scan/window identity. Framework-owned
Job state stores prepared-scan references, immutable admitted-window bounds, receipts, and the committed
contiguous frontier before another window is admitted. `release()` is retryable cleanup; loss of cleanup
does not erase Job outcome or frontier evidence.

Crash tests cover before and after prepare persistence, window admission, provider read, handler effect,
window receipt, contiguous-frontier advancement, cancellation, and provider release.

Capabilities are evidence, not a user-facing provider switch. Domain code names semantics; the deployment profile selects a compatible provider.

The complete query-batch implementation is compositional: it may accept a typed query source/runtime,
finite `JobRuntime`, and checkpoint/result-store implementation or references to separately bound
capabilities. Reusing the application's Job runtime does not expose its queue or result store to the batch
handler, and the batch runtime cannot replace the query provider selected for the authored query.

## Projection and aggregation

Batch handlers may call ordinary typed operations or projection outputs. `Query.onBatch(...)` does not introduce a second projection DSL.

If a rebuild can be expressed as a pure projection from authoritative state, the projection's `rebuildFrom(...)` contract remains preferable because it can prove live/rebuild equivalence. Query batching is for effectful or operationally bounded processing.

## Failure and cancellation

The returned Job owns retry, timeout, cancellation, progress, and terminal result semantics. Cancellation stops future windows and applies the Job cleanup contract to the active handler.

An expired snapshot/frontier fails with `QUERY_BATCH_FRONTIER_EXPIRED`; it does not silently restart under a different revision. The application may explicitly begin a new run.

## Diagnostics

- `QUERY_BATCH_ORDER_UNSTABLE`
- `QUERY_BATCH_CONSISTENCY_UNSUPPORTED`
- `QUERY_BATCH_FRONTIER_EXPIRED`
- `QUERY_BATCH_IDEMPOTENCY_REQUIRED`
- `QUERY_BATCH_AUTHORITY_CHANGED`
- `QUERY_BATCH_PROVIDER_MIGRATION_UNSAFE`
- `QUERY_BATCH_CONCURRENCY_UNSUPPORTED`
- `QUERY_BATCH_SELECTION_NOT_PORTABLE`
- `QUERY_BATCH_RELATIONSHIP_FRONTIER_UNPROVEN`
- `QUERY_BATCH_SNAPSHOT_CAPACITY_EXCEEDED`
- `QUERY_BATCH_SNAPSHOT_SCHEMA_INCOMPATIBLE`
- `QUERY_BATCH_SNAPSHOT_CLEANUP_BLOCKED`
- `QUERY_BATCH_SNAPSHOT_TENANT_SCOPE_INVALID`

## Implementation increments

1. Extend the existing function-native Query contract with portable selection evidence and freeze the
   query-batch input and returned Job surface.
2. Implement deterministic local/provider-independent batching tests.
3. Add one relational snapshot/keyset provider.
4. Add monotonic and explicit best-effort contracts.
5. Prove crash recovery around out-of-order handler receipts and contiguous-frontier commits.
6. Add authority, plan, telemetry, cancellation, and migration evidence.

## Acceptance

- Stable ordering is proven or compilation fails.
- `.onBatch(...)` is present in TypeScript only on selection-backed Query handles.
- One-time invocation and batching use one normalized selection digest and return the same projected item
  shape for the same consistency revision.
- The returned Job input/output are provider-independent and expose no physical cursor.
- A crash at every receipt/frontier boundary does not skip a committed window.
- Out-of-order completion never advances past a gap or reruns an already receipted later window.
- Repeatable-snapshot, version-pinned, monotonic-frontier, and best-effort modes behave differently and
  truthfully.
- The same job can resume after worker replacement.
- A claimed repeatable snapshot survives the provider's documented worker/session failure envelope or is
  rejected before execution.
- PostgreSQL repeatable-snapshot qualification proves atomic materialization, immutable keyset windows,
  cleanup/retention, capacity rejection, and restart after every setup/window boundary without a hidden
  live-session dependency.
- Snapshot qualification proves cardinality/transaction limits, schema migration, tenant isolation,
  controller-loss recovery, UID-safe orphan cleanup, and every terminal-run retention path.
- Tenant and row/resource authority remain enforced on every delivered item.
- Provider differences appear in plan/evidence, not application syntax.
- A clean-context user can explain when to choose Query batching versus Stream batching.

## Non-goals

- unbounded stream processing;
- a portable full-database snapshot protocol;
- a generic ETL language;
- hidden offset pagination;
- exactly-once external side effects.

## Definition of done

`Query.onBatch(...)` is stable-candidate only when ordering, mutation, consistency, retry, cancellation, authority, and frontier semantics are proven against maintained providers and exposed honestly in the application plan.
