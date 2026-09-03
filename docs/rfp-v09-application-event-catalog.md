# RFP: Application Event Catalog and Federated Event Selections

**Status:** Accepted for implementation; architecture frozen on 2026-08-30

**Audience:** Applik8s maintainers, implementing agents, provider authors, and security reviewers

**Requested by:** The v0.9 semantic-completion and 1.0-readiness program

**Revised:** 2026-08-30

**Target:** Applik8s v0.9; stable 1.0 candidate with a bounded provider fallback

## Executive summary

Applik8s applications already declare typed domain events, model lifecycle facts, job and workflow
outcomes, stream processors, projections, and subscriptions. Those facts remain discoverable only through
their individual producers. Applications lack one typed catalog from which they can select meaningful
facts without choosing a broker or reconstructing physical topology.

This RFP introduces `application.events`: a logical, typed catalog of application-significant facts.
Selections use `from(...)`, `of(...)`, `all()`, and `where(...)`, then compose with the existing
Stream-shaped processing surface. The catalog does not imply one bus, one cursor, global order, common
retention, or universal observation authority.

The compiler may consume one existing source, federate compatible sources with per-source receipts, or
materialize a normalized durable stream. The lowering is determined by requested semantics and appears in
the graph and plan. Unsafe authority, ordering, replay, acknowledgement, or retention combinations fail
closed.

## Existing functionality that must not be duplicated

| Capability | Existing boundary to reuse |
| --- | --- |
| Typed facts | `event(...)`, model lifecycle events, job/workflow/signal outcome contracts |
| Durable streams | `stream(Event, guarantees)` and maintained stream providers |
| Processing | `onEvent`, `onBatch`, projections, rebuilds, and subscriptions |
| Authority | Identity/resource authorization, trusted context, authority receipts, causal principals |
| Delivery | Provider outboxes, JetStream, SSE/live query gateways, workflow stores |
| Evidence | Application graph, plan/explain, lifecycle evidence, and OpenTelemetry |

The catalog is a semantic index and selection language over these primitives. It must not add another event
class, broker client, processor runtime, or policy system.

## At a glance

```ts title="src/events/audit.ts"
application.events
  .from(Order, Checkout, RebuildSearch)
  .onEvent(async event => {
    await AuditEntry.create({
      eventId: event.id,
      type: event.contract.id,
      subject: event.subject,
    });
  });

application.events
  .of(Order.events.updated)
  .where(event => event.detail.changed.has("status"))
  .project(OrderStatusHistory, (event, output) => {
    output.append({
      orderId: event.subject.id,
      status: event.detail.current.status,
      changedAt: event.occurredAt,
    });
  });
```

Broad selection is always explicit:

```ts
application.events.all().onEvent(recordApplicationFact);
```

## Problem statement

Applications need audit trails, notifications, analytical facts, cross-domain projections, automation,
and client subscriptions spanning multiple producers. Today each consumer must know which physical stream,
outbox, model hook, or workflow store contains those facts. That leaks topology into domain code and makes
cross-cutting behavior hard to discover.

A global EventBridge-shaped concept is attractive, but only if it remains honest: selected sources can
have different ordering, retention, tenancy, authorization, and acknowledgement authorities. The framework
must simplify authoring without inventing guarantees.

## Normative decisions

1. `application.events` is a logical typed catalog, not a mandatory physical bus.
2. Catalog membership comes from a primitive contract or explicit authored promotion, never consumer
   existence alone.
3. Model lifecycle handles use `Model.events.created`, `.updated`, and `.deleted`; callable mutation APIs
   remain separate.
4. `from(...)` selects producer families, `of(...)` selects exact event handles, and `.all()` is the only
   broad selection.
5. Selections retain exact union types and narrow before predicates execute.
6. Selection grants no observation authority.
7. Runtime infrastructure access and application/browser event visibility are separate calculations.
8. Source-local positions and causal identity are canonical; no universal total order is invented.
9. Multi-source batch/projection/subscription semantics materialize one durable acknowledgement authority
   unless a provider proves an equivalent atomic composite frontier.
10. Every consumer is pinned to a catalog revision and exact event-contract versions.
11. Lifecycle facts remain distinct from operational telemetry.
12. Event cycles are bounded and inspectable.

## Architectural boundary

Applik8s owns catalog membership, versioned handles and envelopes, typed selection, semantic requirements,
authority/disclosure enforcement, graph planning, materialization identity, causal evidence, diagnostics,
and provider conformance. Source providers own durable physical positions, retention, delivery, and native
filtering while satisfying those requirements. Applications own their domain event contracts and explicit
promotions.

## Canonical model lifecycle details

Model lifecycle facts use one provider-independent detail contract:

```ts
type ModelCreated<T> = {
  value: T;
};

type ModelUpdated<T> = {
  previous: T;
  current: T;
  changed: ChangedFields<T>;
};

type ModelDeleted<T, TIdentity> = {
  previous: T;
  tombstone: ModelTombstone<TIdentity>;
};
```

`ChangedFields<T>` contains only string keys of `T`. Its canonical envelope encoding is a sorted, unique
array; declarative predicates expose typed membership through `.has(field)`. The portable tombstone
contains the model identity, deletion time, and optional model revision. Providers must not expose raw
database change records, Kubernetes deletion objects, or provider-specific metadata as lifecycle detail.

## Catalog membership

The catalog includes application-significant facts such as:

- explicit domain events;
- model created/updated/deleted facts;
- job and workflow terminal outcomes;
- saga compensation outcomes;
- durable signal resolution;
- declared actor/agent outcomes consumed by the application.

Worker heartbeats, retries, polls, queue deliveries, provider reconnects, token chunks, and physical restarts
remain OpenTelemetry by default.

A primitive contract may declare its lifecycle facts. Application code may explicitly promote an
operational transition, but promotion is a versioned catalog change and cannot promise retroactive replay
for facts that were not previously recorded.

### System-event bridge

The role previously described as a system-event bridge is implemented here as compiler-generated producer
adapters into the catalog, not as another public bus or capability. A Job, workflow, signal, Saga, actor,
agent, scheduler, or managed-model subsystem publishes only the versioned application-significant facts
declared by its semantic contract. Its queue deliveries, provider status objects, worker attempts, and
health transitions remain operational evidence unless explicitly promoted.

Each adapter preserves the source subsystem's canonical event identity, local position, authority receipt,
causal lineage, retention, and acknowledgement boundary. It cannot translate a provider lifecycle event
directly into a broadly visible application fact, and it cannot imply replay history that the source never
recorded. The planner may lower several adapters into one normalized stream, but that optimization does
not create a second event authority.

## Selection and typing

### `from(...)`

`from(Order, Checkout)` selects all catalog fact families owned by those handles at the consumer's pinned
catalog revision.

### `of(...)`

`of(Order.events.updated, Checkout.events.compensated)` selects exact versioned handles. This is the
preferred surface when a consumer depends on event-specific detail.

### `all()`

`.all()` makes breadth visible in code, plan, authority review, and cost. An already deployed `.all()`
consumer remains revision-pinned; adding a new producer does not silently expand it.

### `where(...)`

Predicates operate on the already-narrowed typed envelope. Provider-side filtering is an optimization.
Framework-owned authorization remains authoritative.

`where(...)` is a pure, deterministic predicate over declared envelope/detail fields. The compiler either
captures it as portable predicate IR or runs it after authorized delivery inside the framework consumer.
It cannot call capabilities, read ambient state, mutate data, depend on wall-clock time, or widen
observation authority. Effectful filtering belongs in `onEvent(...)`, where delivery and effects have
normal receipts.

## Canonical envelope

Every catalog fact normalizes to a versioned envelope with:

- event and contract identity;
- source kind and logical source identity;
- optional subject kind, ID, and revision;
- occurrence and recording time;
- source-local partition and sequence;
- invocation, correlation, causation, trace, and causal-principal references;
- trusted-context digest and authority evidence reference;
- typed detail.

The public envelope does not expose the trusted context itself. Application filtering uses typed subject or
event detail fields deliberately declared by the event contract. Providers may use the trusted-context
digest internally for scoping and evidence, but arbitrary context is not a catalog payload or side channel.
The envelope does not expose provider credentials or pretend timestamps establish causality.

Every fact also has one canonical semantic event identity. Producers allocate it before publication and
preserve it through outbox delivery, federation, materialization, replay, and provider migration. A
normalized stream deduplicates by source contract/version plus semantic event identity; broker delivery
IDs, offsets, and timestamps are evidence rather than identity. Conflicting payload digests under one
semantic identity fail closed with `EVENT_IDENTITY_CONFLICT`.

## Federation and materialization

The planner chooses among:

```text
one compatible source
  -> native filtered consumer

several compatible sources + onEvent
  -> composite consumer with independent receipts and a vector frontier

multi-source onBatch/project/subscribe or normalized replay/order
  -> compiler-owned normalized durable stream

incompatible semantics
  -> source-attributed compile failure
```

A normalized stream owns a stable graph identity, inbox/outbox receipt protocol, retention, migration,
replay frontier, deletion policy, runtime access, and cost evidence. A crash between source observation and
publication resumes from the durable receipt.

The default normalized-stream lifecycle is application-owned topology with retained history governed by
the selected consumer's declared replay window. Removing the last consumer does not immediately destroy
history: the plan applies the profile's explicit orphan/retention grace, then verifies that no pinned
consumer or migration depends on it. Shared/external materializations are never deleted by one consumer.
Changing retention below a promised replay frontier is a destructive migration, not an optimization.

Until heterogeneous federation and normalized-stream materialization pass their deployed crash/recovery
gate, they remain beta. The v0.9 stable surface is the catalog, direct single-source selection, and
same-transactional-authority event sets. Cross-authority selection fails explicitly with
`EVENT_MATERIALIZATION_REQUIRED`; it is not represented as a successful stable lowering. Once the
materializer is qualified, it may broaden the stable surface without changing application syntax.
Provider optimization never blocks or silently weakens the public programming model.

## Ordering and replay

Source-local position is authoritative. A federated cursor is a vector frontier. A materialized provider
may offer arrival order, but documentation and types never call it global causal order.

Replay requirements are expressed semantically. The planner verifies retained history, event-version
availability, authorization re-evaluation, and provider frontier compatibility. If a requested replay can
omit facts or cannot preserve its cursor, planning fails.

## Authority and disclosure

Backend runtime access is the exact union of physical source reads and normalized-stream writes required
by the consumer.

Event visibility is evaluated per event family, resource, principal, trusted context, and authority
version. Possessing infrastructure read access does not grant application observation authority.

Unauthorized facts reveal no payload, type, subject, or direct source position through the application
protocol. Opaque cursors may advance past undisclosed facts without encoding a readable count or physical
position. If a selected union cannot support one safe disclosure contract, compilation fails with
`EVENT_SOURCE_AUTHORITY_INCOMPATIBLE`.

### Disclosure threat boundary

The stable contract protects application-level content and explicit metadata. It does not claim resistance
to all traffic analysis. Without padding and traffic shaping, response timing, connection activity, batch
fullness, backpressure, and cursor-update frequency may reveal coarse activity. Public documentation and
provider evidence state whether a subscription is:

- content confidential only;
- count-obscuring at the protocol envelope;
- padded to a declared traffic-analysis class; or
- unsuitable for hiding source activity.

No maintained provider may claim that unauthorized facts leak no count unless its batching, timing, and
cursor behavior pass the corresponding side-channel tests. Default browser/SSE subscriptions promise
content confidentiality and opaque positions, not universal traffic-analysis resistance.

Replay re-evaluates event visibility under the recorded policy: either current authority is checked for
every fact, or an original bounded observation receipt explicitly remains valid. An authority-version
change invalidates resumable cursors unless the provider can prove safe reauthorization without exposing
filtered positions. Losing access cannot be bypassed by retaining an old cursor.

## Catalog revision and schema evolution

Every consumer records:

- catalog revision;
- selected event handles and versions;
- unknown-event policy;
- retained replay window;
- materialization topology version.

`applik8s plan` shows added/removed families and migration consequences. Rolling upgrades define producer
and consumer compatibility. Unknown payloads never flow into a typed handler. Retired contracts remain
readable for their promised retention window or require an explicit destructive migration.

## Cycles and causation

Every emitted fact carries correlation, causation, depth, and cycle signatures. Obvious unconditional
self-cycles fail compilation. Dynamic or intentional loops have a declared budget and terminal evidence.
Dead-lettering does not erase the causation chain.

## Graph and plan

The semantic graph records catalog membership, consumer revision, selection, type union, requested stream
semantics, authority requirements, physical source set, materialization decision, retention, frontier,
cycle policy, and provider maturity.

Plan output explains why a materialized stream is or is not needed and which guarantees prevent a cheaper
lowering.

## Provider conformance

Conformance covers PostgreSQL outboxes, JetStream, workflow/job receipt stores, actor outboxes,
Kubernetes observations, and at least one external provider event source where maintained.

Event-catalog and materialized-stream providers follow the composable implementation algebra. A provider
may consume source outbox/log implementations, consumer-state storage, a finite/continuous execution
runtime, and optional materialization storage. Reusing an implementation preserves its identity and
ordering evidence without exposing broker or storage clients to event callbacks.

Tests verify filtering, ordering, replay, duplicates, restart, retention expiry, authority changes,
unauthorized cursor behavior, schema evolution, materialization migration, cycles, and complete teardown.

## Diagnostics

- `EVENT_SOURCE_AUTHORITY_INCOMPATIBLE`
- `EVENT_DISCLOSURE_CLASS_UNAVAILABLE`
- `EVENT_CURSOR_REAUTHORIZATION_REQUIRED`
- `EVENT_REPLAY_GUARANTEE_INCOMPATIBLE`
- `EVENT_MATERIALIZATION_REQUIRED`
- `EVENT_GLOBAL_ORDER_UNAVAILABLE`
- `EVENT_CYCLE_UNBOUNDED`
- `EVENT_CATALOG_REVISION_INCOMPATIBLE`
- `EVENT_CONTRACT_VERSION_UNAVAILABLE`
- `EVENT_DISCLOSURE_UNSAFE`
- `EVENT_IDENTITY_CONFLICT`

## Implementation increments

1. Build the compiler-owned catalog and canonical lifecycle handles.
2. Add typed `from`, `of`, `all`, and `where` selection IR.
3. Lower compatible single-source consumers.
4. Add materialized multi-source topology and durable receipts.
5. Add authority/disclosure enforcement and browser subscription evidence.
6. Add revision, rolling-upgrade, retention, and cycle semantics.
7. Qualify optional non-materialized vector federation separately.

## Acceptance

- Type inference remains precise after every selection and predicate.
- Effectful or nondeterministic `where(...)` predicates fail compilation.
- Duplicate source delivery/materialization retains one semantic event identity, and conflicting payloads
  under one identity fail closed.
- Broad access is explicit and revision-pinned.
- Unauthorized facts leak no payload, type, subject, or direct source position. Any claimed count or
  traffic-analysis protection is evidence-qualified rather than implied.
- Replay and cursor resumption cannot bypass current or explicitly receipted observation authority.
- Multi-source batch acknowledgement survives crashes without partial advancement.
- Plan output truthfully exposes topology, guarantees, authority, and cost.
- Schema/catalog upgrades preserve or explicitly migrate replay.
- Normalized-stream retention and last-consumer teardown cannot destroy a promised replay frontier.
- Clean-context users understand catalog versus stream versus telemetry.

## Non-goals

- one mandatory broker;
- universal global order;
- implicit broad subscriptions;
- a new authorization model;
- operational telemetry as domain events;
- retroactive replay of facts that were never durably recorded.

## Definition of done

The catalog is stable-candidate only when typing, authority, ordering, replay, acknowledgement,
materialization, evolution, causation, plan, provider conformance, and the stable fallback boundary are all
evidenced end to end.
