# RFP: Managed Models and Portable Reconciliation

**Status:** Accepted for implementation; architecture frozen on 2026-08-30

**Audience:** Applik8s maintainers, model/runtime authors, provider authors, and security reviewers

**Requested by:** The v0.9 semantic-completion and 1.0-readiness program

**Revised:** 2026-08-30

**Target:** Applik8s v0.9 semantic contract with release-blocking Kubernetes and PostgreSQL qualification;
additional providers may qualify in v0.10

**Depends on:** Native models, `Resource.on.reconcile`, managed closures, operation authority, scheduling,
the External Capability Bindings RFP, the Kubernetes Cluster Capability RFP, the Effect Receipts, Fencing,
and Unknown Outcomes RFP, application events, and `ApplicationPlan`

## Executive summary

Applik8s already gives CRD-backed resources an excellent desired-state programming model:
`Resource.on.reconcile`. The useful semantic is not the CRD. It is a managed model with stable identity,
desired state, authoritative status, generations, fenced reconciliation, deletion intent, finalization,
secondary invalidation, and durable delayed convergence.

This RFP makes that semantic provider-neutral. The same managed-model declaration and reconcile closure may
be backed by Kubernetes resources, PostgreSQL rows plus a transactional outbox, or a qualified local store.
EventBridge Scheduler may implement delayed wakeups for an externally hosted/AWS reconciler, but it never
becomes desired-state authority. Kubernetes remains a first-class provider and explicit Kubernetes effects
remain valid capabilities; they are no longer assumptions baked into the reconciliation contract.

Portable reconcilers consume the separate external-capability and Kubernetes-cluster contracts. This RFP
does not own those framework-wide DI boundaries merely because reconciliation is one important consumer.

## Existing functionality that must not be duplicated

| Capability | Existing boundary to reuse |
| --- | --- |
| Kubernetes reconciliation | `Resource.on.reconcile`, watches, status, finalizers, leases, and resync |
| Native models | One logical model declaration with relational and Kubernetes facets |
| Change delivery | Model transactions/outboxes and application events |
| Delayed work | Shared scheduling occurrence and provider contracts |
| Authority | Immediate/causal principal, trusted context, receipts, and runtime-access inference |
| External effects | Typed operations, capabilities, idempotency receipts, and Sagas where needed |
| Deployment | Provider implementations whose actual contributors use TypeKro through Alchemy for Kubernetes API resources and native Alchemy for non-Kubernetes infrastructure |

This RFP does not add `app.reconcile`, an AWS callback API, a second model language, or a new permission
system.

## At a glance

```ts title="src/workspaces.ts"
export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey(),
  version: text("version").notNull(),
  plan: text("plan", { enum: ["starter", "team"] }).notNull(),
});

export const Workspace = application.model(workspaces).managed({
  status: type({
    observedGeneration: "number.integer >= 0",
    phase: "'Pending' | 'Ready' | 'Degraded'",
    endpoint: "string?",
  }),
  initialStatus: {
    observedGeneration: 0,
    phase: "Pending",
  },
});

Workspace.on.reconcile(async (workspace, context) => {
  const deployment = await ApplicationDeployment.ensure({
    workspaceId: workspace.id,
    version: workspace.value.version,
  });

  await workspace.status.update({
    observedGeneration: workspace.metadata.generation,
    phase: deployment.ready ? "Ready" : "Pending",
    endpoint: deployment.endpoint,
  });

  await workspace.conditions.set({
    type: "Ready",
    status: deployment.ready ? "True" : "False",
    reason: deployment.ready ? "DeploymentReady" : "DeploymentPending",
    message: deployment.ready ? "Application deployment is ready" : "Waiting for deployment readiness",
  });

  if (!deployment.ready) return context.requeueAfter("30s");
});
```

Provider selection remains assembly:

```ts title="src/app.ts"
const database = Database.externalPostgres({
  url: secret.env("DATABASE_URL"),
});

const scheduler = Scheduler.postgres({ database });

application.provide(
  Workspace.store,
  ManagedModelStore.postgres({ database }),
);

application.provide(
  OperatorRuntime,
  OperatorRuntime.distributed({ database, scheduler }),
);
```

The Kubernetes form promotes the Kubernetes resource as the same logical managed-model facet and uses the
same canonical `value`/`status`/`conditions`/`metadata` reconcile view:

```ts
const cluster = KubernetesCluster.current();

application.provide(Workspace.store, ManagedModelStore.kubernetes({ cluster }));
application.provide(OperatorRuntime, OperatorRuntime.kubernetes({ cluster }));
```

The exact provider constructors may remain package-owned, but the `Workspace.on.reconcile` authoring
surface and semantic model are canonical. A schema-first model may use the existing
`application.model("Workspace", { spec, status })` form when no provider-native schema exists; it is not a
second managed-model declaration API. `.managed(...)` enriches that same model handle and graph node.

## Normative decisions

1. `<ManagedModel>.on.reconcile` is the canonical continuous-convergence surface. Existing
   `Resource.on.reconcile` is that same registrar on a Kubernetes-backed managed model; no
   `app.reconcile` synonym is introduced.
2. A managed model is a semantic facet on the existing model handle, not a second declaration language or
   a CRD abstraction copied into PostgreSQL. Drizzle, Kubernetes, and schema-first models retain one schema
   authority and their native relationships.
3. Managed models preserve identity, desired value, status, generation, resource version, deletion intent,
   finalizers, conditions, and observed generation across providers.
4. Change notification is an optimization. Every provider supplies bounded resynchronization.
5. Exactly one fenced reconcile lease may commit effects or status for one model identity at a time.
6. `requeueAfter()` records semantic next-due intent. It is not a process timer or application schedule.
7. EventBridge Scheduler may deliver delayed wakeups or recovery sweeps; it never owns desired state,
   leases, finalizers, or completion.
8. Kubernetes-cluster access follows the separate typed cluster-capability contract; no closure receives
   ambient kubeconfig or a raw unrestricted client.
9. Store and runtime implementations follow the separate external-capability binding anatomy, including
   optional deployment contribution and explicit lifecycle ownership.
10. Replacing a store, operator runtime, cluster, or external endpoint is classified as a migration.
11. Provider-specific effects constrain only the closures that use them.
12. Store and runtime providers are composable implementation values. Integrated Kubernetes and assembled
    database/scheduler implementations satisfy the same contracts, recursively expose their dependencies
    to planning, and never expose those dependencies to callbacks implicitly.
13. `status.update(...)` is schema-complete across providers. No ambiguous partial nested-status merge is
    part of the stable v0.9 contract.
14. Conditions use the portable `object.conditions` facet with one declared writer per condition type;
    framework generation and transition-time stamping cannot be forged by application payloads.
15. `<ManagedModel>.on.finalize(...)` is the portable finalization registrar. The runtime installs and
    removes its declared finalizer automatically around restart-safe terminal cleanup.

`OperatorRuntime` is the semantic execution capability for continuous managed-model reconciliation. It is
not a Kubernetes client and does not imply a Deployment. Its maintained constructors produce ordinary
implementation values:

```ts
OperatorRuntime.kubernetes({ cluster })
OperatorRuntime.distributed({ database, scheduler, queue?, lease? })
```

Both implementations must prove the same admission, deduplication, fencing, resync, delayed-wakeup,
status, deletion, and finalization guarantees. The Kubernetes implementation may satisfy them as an
integrated controller runtime. The distributed implementation satisfies them by composing its declared
dependencies. Provider packages may offer presets, but they cannot add a second reconcile API or expose
the nested database, scheduler, queue, lease, or cluster to the reconcile callback.

## Managed-model contract

Every managed provider implements the following semantic envelope, regardless of physical storage:

```ts
interface ManagedModelMetadata {
  uid: string;
  generation: number;
  resourceVersion: string;
  createdAt: string;
  deletionTimestamp?: string;
  finalizers: readonly string[];
}

interface ManagedModelCondition {
  type: string;
  status: "True" | "False" | "Unknown";
  observedGeneration: number;
  reason: string;
  message: string;
  lastTransitionTime: string;
}

interface ManagedModelConditionInput {
  type: string;
  status: "True" | "False" | "Unknown";
  reason: string;
  message: string;
}

interface ManagedModelObject<TIdentity, TValue, TStatus> {
  readonly id: TIdentity;
  readonly value: Readonly<TValue>;
  readonly metadata: ManagedModelMetadata;
  readonly status: {
    readonly current: Readonly<TStatus>;
    update(next: TStatus): Promise<ManagedStatusWriteReceipt>;
  };
  readonly conditions: {
    readonly current: readonly ManagedModelCondition[];
    set(next: ManagedModelConditionInput): Promise<ManagedConditionWriteReceipt>;
    remove(type: string): Promise<ManagedConditionWriteReceipt>;
  };
}
```

The portable reconcile callback receives `ManagedModelObject`. `value` is the model's existing typed native
value: a Drizzle row for a relational model and the resource `spec` for a Kubernetes model. The status
schema is declared once by `.managed({ status })`. Relationships remain attached to the original model
handle and are not copied into a framework schema.

`initialStatus` is omitted when the declared schema can derive a complete value from its own defaults.
Otherwise it is required, validated during graph construction, and used by the idempotent activation/backfill
migration and new lifecycle rows. The framework never invents provider-specific zero values or expose a
schema-invalid partial status before the first reconcile.

`status.update(...)` is intentionally schema-complete. v0.9 does not freeze a public `Partial<TStatus>`
patch whose nested merge, omission, `undefined`, and deletion semantics differ across PostgreSQL and
Kubernetes. Providers may lower one complete update to an efficient compare-and-set patch internally, but
the resulting authoritative status must validate against the declared schema and preserve nested-field
fidelity.

`conditions.set(...)` stamps the current object's `generation` as `observedGeneration` and computes
`lastTransitionTime` from the previous condition of the same type. An unchanged `{ status, reason,
message }` preserves the previous transition time. `remove(type)` is explicit; omission from a status
update never deletes a condition. Condition type ownership belongs to the declaring reconcile/finalize
registration. In v0.9, condition `type` must be a statically discoverable string literal and two
registrations that may write one type fail graph construction. Applications that need several code paths to
update one condition factor those paths through the one owning handler; no shared-writer escape hatch or
dynamic condition namespace is inferred.

Portable finalization reuses the existing handle-owned registrar:

```ts
Workspace.on.finalize(
  async workspace => {
    await ApplicationDeployment.remove({ workspaceId: workspace.id });
  },
  { finalizer: "workspaces.applik8s.dev/application-deployment" },
);
```

The framework durably installs every declared finalizer before normal reconciliation may expose an owned
child or external effect. Once deletion intent exists, the matching finalize handler runs under the same
lease, effect, authority, and receipt rules as reconciliation. Successful terminal completion removes the
declared finalizer automatically; requeue, failure, cancellation, timeout, or unknown effect outcome retains
it. Application callbacks never mutate the raw finalizer array directly. Force removal is a separately
authorized operational action with blocker evidence and orphan policy.

Kubernetes-backed resource handles may retain `.spec` as a compatibility/resource-specific view. A
reconcile closure that reads `.spec`, raw Kubernetes metadata, or another resource-only member is
correctly classified as Kubernetes-constrained. Portable examples and generated Starts use
`value`/`status`/`conditions`/`metadata` so the same closure can run on every qualified provider.

Desired value and status have separately declared writers. Kubernetes maps desired value to `spec`;
relational providers retain the provider-native row shape and framework lifecycle authority without
forcing user fields into a JSON `spec` column. A stale generation cannot report current readiness. Status
mutation uses compare-and-set or an equivalent fenced write and never overwrites concurrent desired state.

Conditions and finalizers are framework lifecycle state with separately declared writers; they are not
application status fields smuggled into the model row. PostgreSQL stores them in the framework lifecycle
authority. Kubernetes projects conditions into the configured status condition field and finalizers into
metadata while preserving the same handle-owned contract. Provider-specific status managers cannot race
the application condition authority.

Provider-private bookkeeping must be versioned and isolated from application fields. A relational provider
may use framework tables or explicitly declared columns; it may not silently append opaque columns to an
application-owned table without a schema contract and migration.

### Relational authority layout

The PostgreSQL lowering preserves the user-authored Drizzle table as the desired-value and relationship
authority. Applik8s does not replace it with a generic JSON model table. Framework lifecycle state lives in
versioned framework-owned tables keyed by `{ application, model, objectIdentity }` and contains only:

```text
uid
generation and desired-value digest
resource version
typed-status payload and schema version
deletion intent
finalizers
conditions
next-due intent
lease/fencing state
reconciliation receipts
```

An authoritative model mutation and its generation increment, lifecycle-row creation/update, and outbox
append commit in one database transaction. A value digest change increments generation exactly once;
status, lease heartbeat, condition, and next-due changes do not.

Writes that bypass Applik8s model operations are not silently assumed observable. A deployment that allows
external SQL writers must select a qualified CDC/version integration that can establish identity,
generation, ordering, and outbox facts transactionally or planning fails with
`MANAGED_MODEL_EXTERNAL_WRITE_UNQUALIFIED`.

Enabling `.managed(...)` on an existing populated relational model is an explicit migration. Before the
reconciler starts, a versioned migration transaction creates/backfills lifecycle rows with stable UIDs,
generation `1`, desired-value digests, status defaults, and an initial outbox/resync frontier. The migration
is idempotent and blocks admission until every source row has exactly one lifecycle identity. Removing the
facet or changing identity/status schema likewise requires a declared migration; the runtime never
reinterprets existing rows opportunistically.

Status commits compare `{ uid, generation, leaseFence, resourceVersion }`. A stale worker cannot write even
when it still holds database credentials. Deleting desired state first records deletion intent; the user row
is removed only after finalizers complete, according to declared retention. Framework lifecycle rows retain
the minimum tombstone required for idempotency and diagnostics.

### Kubernetes authority mapping

The Kubernetes lowering is exact and reversible:

| Managed semantic | Kubernetes authority |
| --- | --- |
| `id` | namespaced or cluster-scoped object identity |
| `value` | `spec` |
| typed status | status subresource |
| UID/generation/resource version/deletion | object metadata |
| finalizers | `metadata.finalizers` |
| conditions | configured status condition field |
| next-due | operator state/queue authority, never an application annotation timer |
| fence | lease plus current UID/generation/resource-version preconditions |

The provider does not copy Kubernetes metadata into application fields. Existing Kubernetes watch,
secondary-watch, RBAC, finalizer, status, and bounded-resync machinery remains the lowering rather than a
parallel controller runtime.

The configured Kubernetes condition field must use list-map semantics keyed by condition `type`, or the
provider must maintain one authoritative read/merge/compare-and-set writer for the complete array. A CRD
whose condition schema cannot preserve per-type ownership fails planning rather than accepting lossy
replacement behavior.

## Reconciliation protocol

One reconcile attempt performs one bounded convergence increment:

```text
observe desired state
  -> acquire fenced lease
  -> observe declared dependencies
  -> admit effects under the shared effect contract
  -> commit status/finalizer/next-due intent
  -> release or renew lease
```

Required invariants:

- duplicate and reordered notifications are safe;
- stale lease holders cannot commit framework-owned status, finalizer, next-due, lifecycle, or reconcile
  receipt state;
- an external effect is stale-worker safe only when its dependency enforces the reconcile fence, preserves
  idempotency under stable logical effect identity, or supplies a durable receipt/lookup protocol;
- an accepted external effect without sufficient completion evidence becomes an honest unknown outcome and
  cannot be treated as absent merely because the reconcile attempt timed out or lost its lease;
- finalizers are durable before owned children become visible;
- secondary watches are invalidation hints with source identity and bounded fan-out;
- periodic resync repairs missed notifications;
- deletion is a restart-safe state machine;
- force finalization is separately authorized and audited;
- timeouts preserve retry state and concrete blocker evidence;
- readiness compares observed state with the current generation.

Provider interruption tests cover every boundary around lease acquisition, effect receipt, status write,
next-due persistence, finalizer mutation, and deletion completion.

The
[Effect Receipts, Fencing, and Unknown Outcomes RFP](./rfp-v09-effect-receipts-fencing-and-unknown-outcomes.md)
owns logical effect identity, dependency fencing, idempotency, receipts, cancellation races, retries,
compensation eligibility, and unknown outcomes. This RFP owns when reconciliation may commit its
framework state. A selected `OperatorRuntime` cannot claim automatic safe external-effect retry when a
dependency supplies only `frameworkFenced` behavior.

## Provider lowerings

### Kubernetes

CRDs, watches, status subresources, work queues, leases, finalizers, secondary watches, RBAC, and resync
implement the contract. Kubernetes-specific reads and writes are explicit capabilities.

### PostgreSQL

The initial non-Kubernetes lowering uses one transaction to mutate desired state and append an outbox
record. A durable queue admits work. Reconciliation uses a fenced lease and compare-and-set status write.
An indexed `nextDueAt` authority plus a qualified scheduler supplies delayed wakeups and recovery sweeps.

PostgreSQL is the first relational provider, not the semantic definition. DynamoDB or other stores require
separate conformance and are not v0.9 scope.

The provider contract exposes atomic desired mutation/outbox append, bounded resync scans, fenced lease
acquisition/renewal, status/finalizer compare-and-set, persisted next-due intent, deletion completion, and
tombstone retention. Implementations may optimize storage but must pass the same black-box state-machine
suite.

### Local

The durable local provider uses a persisted store, outbox/notification queue, fenced leases, and persisted
wakeups. An in-memory provider is a test fixture and cannot claim durable conformance.

## Capability dependencies

Managed reconciliation consumes, but does not redefine, two framework-wide contracts:

- [External Capability Bindings](./rfp-v09-external-capability-bindings.md) owns runtime adapters, optional
  deployment contributors, readiness, lifecycle ownership, Secret/config sources, and migration.
- [Kubernetes Cluster Capability and Injection](./rfp-v09-kubernetes-cluster-capability.md) owns logical
  cluster identity, application DI, compatibility with existing operator connection aliases, RBAC,
  endpoint/network policy, credentials, and mutation ownership.

The managed-model plan references those capability identities and includes their effective evidence. It
does not create narrower model-specific variants. Physical contributors retain the implementation
boundary from the external-capability contract: Kubernetes-backed reconciliation infrastructure is
composed with TypeKro and deployed through Alchemy, while non-Kubernetes scheduler, database, queue, and
control-plane infrastructure uses native or focused Alchemy resources. The actual contributors provide
this evidence; provider authors do not copy a public classification field.

## Scheduling boundary

`requeueAfter()` creates an operator-owned next-due request. It may share scheduler machinery with Jobs or
workflows but cannot be listed, cancelled, or migrated as an application schedule. The scheduling RFP owns
the shared occurrence/provider algebra and preserves this semantic owner.

## Authority and causality

Reconciliation executes as a bounded workload principal and preserves the causal principal and trusted
context associated with the desired-state mutation where policy allows. A provider notification never
becomes proof of application authority.

Runtime access is inferred from model reads/writes, injected capabilities, status/finalizer operations,
queue/lease/wakeup authorities, and declared effects. It is not widened to a database, cluster, namespace,
or account merely because the provider runs there.

## Graph and plan

The graph records model identity/schema, managed lifecycle, storage requirements, reconcile closure,
dependencies, secondary invalidations, lease/fencing, resync, finalizers, next-due semantics, capabilities,
authority, and migration compatibility.

The plan separately shows semantic requirement, selected store/runtime, runtime adapter, deployment
contributor or external binding, physical identities, Secret/network access, ownership, readiness,
retention, teardown, provider evidence, and portability constraints.

## Diagnostics

- `MANAGED_MODEL_PROVIDER_INCOMPATIBLE`
- `MANAGED_MODEL_GENERATION_STALE`
- `RECONCILE_LEASE_LOST`
- `RECONCILE_EFFECT_UNSAFE`
- `RECONCILE_RESYNC_UNAVAILABLE`
- `RECONCILE_FINALIZATION_BLOCKED`
- `MANAGED_MODEL_EXTERNAL_WRITE_UNQUALIFIED`
- `MANAGED_MODEL_STATUS_SCHEMA_INCOMPATIBLE`
- `MANAGED_MODEL_ACTIVATION_MIGRATION_REQUIRED`
- `PROVIDER_REPLACEMENT_MIGRATION_REQUIRED`

## Implementation increments

1. Freeze managed-model envelope and make `on.reconcile` storage-provider neutral.
2. Consume the canonical external-binding and Kubernetes-cluster capabilities without creating
   model-specific adapters.
3. Implement durable local reconciliation and the PostgreSQL outbox/lease/status provider.
4. Integrate shared delayed scheduling without conflating `requeueAfter()` with application schedules.
5. Add graph, plan, authority, migration, lifecycle, and provider-conformance evidence.

## Acceptance

- One managed-model declaration and reconcile closure run unchanged on Kubernetes and PostgreSQL-backed
  providers.
- The relational provider retains the original Drizzle row and relationship schema while storing only
  framework lifecycle/status state separately.
- Desired mutation, generation, lifecycle state, and outbox append are atomic; status-only writes never
  advance generation.
- Enabling managed lifecycle over preexisting relational rows performs a restart-safe backfill with stable
  UIDs and one initial reconcile frontier before workers start.
- Type tests prove that portable callbacks receive the same `value`/`status`/`conditions`/`metadata` shape, while use of
  `.spec` or raw Kubernetes metadata constrains only that callback to Kubernetes.
- Worker death at every lease/effect/status boundary cannot let a stale worker commit framework-owned
  state. Unfenced external effects resolve through provider receipt/idempotency or remain `unknown`.
- Missed notifications are repaired by bounded resync.
- `requeueAfter()` survives restart and does not create desired-state authority in the scheduler.
- Generation and finalization semantics match across providers.
- Condition writes preserve per-type ownership, current-generation observation, and transition-time
  semantics across PostgreSQL and Kubernetes.
- Finalizers are durable before owned effects become visible, survive restart/requeue/unknown outcomes, and
  are removed automatically only after successful terminal cleanup.
- Nested status values round-trip unchanged through each provider's compare-and-set lowering.
- The standalone Kubernetes-cluster and external-binding conformance suites pass for every capability used
  by the reconciler.
- Provider replacement produces a migration plan rather than an in-place configuration update.
- Explicit Kubernetes effects constrain only their consuming execution.

## Non-goals

- broad multi-cloud provider parity;
- a general provider/plugin SPI;
- DynamoDB managed models in v0.9;
- cross-provider live migration;
- hiding provider consistency differences;
- raw ambient Kubernetes or database clients;
- treating unqualified out-of-band SQL writes as managed-model events;
- making EventBridge the reconciliation authority;
- adding `app.reconcile`.

## Definition of done

The semantic contract is ready when managed identity, status, generation, fencing, resync, delayed
convergence, deletion, finalization, authority, external binding, graph, plan, and migration behavior are
provider-neutral and the Kubernetes/PostgreSQL/local qualification boundaries are stated truthfully.
