# RFP: Applik8s v0.8 — Durable Identity-Addressed Actors

**Status:** Accepted v0.8 beta implementation contract. Release publication remains separately authorized.

**Manifesto:** [`manifesto-v08-portable-stateful-development.md`](manifesto-v08-portable-stateful-development.md)

**Foundation gate:** The stable `graph-provenance` gate must pass before actor protocol execution and
effect attribution are considered qualified.

**Foundation dependencies:** v0.7 function-native execution, typed operations and authority, causal
principal propagation, durable effects, events, workflows, signals, schema evolution, application graph,
qualified providers, and the manifesto's Phase 0 identity, guarantee, execution-boundary, and provenance
records

**v0.8 contract integrations:** Portable targets deploy selected actor providers, inferred runtime access
attributes protocol operations, unified observability traces turns, function-native scheduling remains
separate from actor alarms, and the application plan explains capability and topology. Deterministic
semantics can be implemented before distributed provider qualification.

**First distributed provider candidate:** celld, behind an Applik8s-owned provider-neutral contract

**Second independent conformance target:** Rivet Actors, used to challenge the abstraction and compare
operational maturity

**Target disposition:** Deterministic local and one fully qualified distributed provider are required for
the v0.8 beta actor vertical. celld is implemented first and is the intended qualification candidate;
Rivet is the second independent target. Kubernetes requires a qualified distributed provider. AWS
requires an individually qualified provider and is not satisfied by local emulation or hidden
domain-source branching. AWS-local is not actor durability evidence.

## Purpose

Add a durable object-like execution primitive for stateful entities whose behavior must be serialized by
identity, addressable from ordinary typed code, able to hibernate when idle, and recoverable after process
or node failure.

Actors fill a specific gap. They do not replace relational models, Kubernetes resources, workflows,
streams, or ordinary TypeScript functions.

| Primitive | Canonical responsibility |
| --- | --- |
| Model | Durable queryable application data and relationships |
| Actor | Serialized stateful behavior for one logical identity |
| Workflow | Durable multi-step coordination across time and dependencies |
| Stream processor | Reaction to ordered or partitioned facts |
| Kubernetes reconciler | Convergence of an external resource's desired and observed state |
| Function | Ordinary stateless composition inside one admitted execution |

The public semantics belong to Applik8s. Rivet, celld, or another runtime may implement them only after
passing the same conformance contract.

## Required developer experience

An actor is an addressable state and execution boundary with one schema-backed protocol. Protocol
members generate both callback registration and the appropriate callable, sendable, scheduled, or
broadcast surface.

```ts
import { actor, application, event, type } from "@applik8s/applik8s";

const RenameWorkspace = type({
  title: "string > 0",
  expectedRevision: "number.integer >= 0",
});

const RenameWorkspaceResult = type({
  revision: "number.integer >= 0",
});

const CursorMoved = type({
  position: "number.integer >= 0",
});

const ActivityObserved = type({
  occurredAt: "string > 0",
});

const CursorPresence = type({
  principalId: "string > 0",
  position: "number.integer >= 0",
});

const ConnectionMetadata = type({
  clientId: "string > 0",
});

const ExpireDraft = type({
  expectedRevision: "number.integer >= 0",
});

const WorkspaceSnapshot = type({
  revision: "number.integer >= 0",
  title: "string",
});

export const WorkspaceChanged = event("workspace.changed.v1", {
  payload: type({
    workspaceId: "string",
    revision: "number.integer >= 0",
  }),
});

export const Workspace = application.actor("workspace", {
  key: type("string"),
  state: type({
    revision: "number.integer >= 0",
    title: "string",
  }),

  protocol: {
    rename: actor.command({
      input: RenameWorkspace,
      output: RenameWorkspaceResult,
    }),
    activityObserved: actor.message(ActivityObserved),
    cursorMoved: actor.connectionMessage(CursorMoved),
    connect: actor.connection(ConnectionMetadata),
    disconnect: actor.disconnection(ConnectionMetadata),
    snapshotUpdated: actor.broadcast(WorkspaceSnapshot),
    cursorPublished: actor.broadcast(CursorPresence),
    expireDraft: actor.alarm(ExpireDraft),
  },
});
```

Handlers attach through the same callback-oriented vocabulary as models, resources, events, and
projections:

```ts
Workspace.on.initialize(async workspace => ({
  revision: 0,
  title: "Untitled workspace",
}));

Workspace.on.rename(async (workspace, input) => {
  const current = await workspace.state();

  if (current.revision !== input.expectedRevision) {
    throw RevisionConflict();
  }

  const next = {
    title: input.title,
    revision: current.revision + 1,
  };

  await workspace.setState(next);
  WorkspaceChanged.emit({
    workspaceId: workspace.key,
    revision: next.revision,
  });
  await workspace.broadcast.snapshotUpdated(next);

  return { revision: next.revision };
});

Workspace.on.activityObserved(async (workspace, message) => {
  // One-way durable addressed input.
});

Workspace.on.cursorMoved(async (workspace, connection, message) => {
  await workspace.broadcast.cursorPublished({
    principalId: connection.principal.id,
    position: message.position,
  });
});

Workspace.on.connect(async (workspace, connection) => {
  // Connection presence is framework-maintained and lease-backed.
});

Workspace.on.disconnect(async (workspace, connection) => {
  // May follow explicit close or bounded connection-lease expiry.
});

Workspace.on.expireDraft(async (workspace, alarm) => {
  // One typed serialized actor turn.
});
```

The example intentionally does not expose provider activation or shutdown callbacks. `initialize` means
first logical state creation. Explicit authorized deletion may attach `Workspace.on.finalize(...)`.
Physical activation, hibernation, relocation, crash, and process shutdown remain provider/runtime
concerns.

Protocol members derive interaction surfaces according to their semantics:

```ts
const result = await Workspace.rename(workspaceId, {
  title: "Launch plan",
  expectedRevision: 3,
});

const receipt = await Workspace.activityObserved.send(workspaceId, {
  occurredAt: new Date().toISOString(),
});

await Workspace.alarms.expireDraft.schedule(
  workspaceId,
  expiresAt,
  { expectedRevision: result.revision },
);
```

The durable boundary carries runtime schemas directly; TypeScript-only annotations are not executable
validation. The contract is fixed:

- protocol member names and semantic kinds are stable graph identities;
- commands are addressed serialized operations with typed promise results;
- messages are addressed serialized one-way inputs with durable admission receipts;
- connection messages, connections, disconnections, and broadcasts require optional realtime provider
  capabilities;
- alarms are typed scheduled inputs;
- every inbound member, including a read-only command, executes as one serialized actor turn in v0.8;
- actor state is available only inside an admitted turn;
- state and declared durable effects commit atomically where the provider contract says they do;
- provider injection, routing, serialization, retries, realtime transport, and hibernation are framework
  concerns;
- application source does not import Rivet or celld APIs.

An actor reference is serializable without pretending its protocol handlers are serialized JavaScript
functions:

```ts
const reference = Workspace.reference(workspaceId);
NotificationRequested.emit({ workspace: reference });

const workspace = Workspace.hydrate(reference);
await workspace.rename({
  title: "Reviewed launch plan",
  expectedRevision: result.revision,
});
```

Browser hydration is opt-in and authority checked. A serialized reference is an address, not permission
to invoke every protocol member.

## Protocol member semantics

ArkType supplies the runtime payload and result shapes. A semantic descriptor supplies delivery,
response, transaction, replay, provider-capability, and authority behavior that a schema alone cannot
express.

| Member | Admission and delivery | Result | Provider requirement |
| --- | --- | --- | --- |
| `command` | Addressed, durable, serialized turn | Typed result or typed failure | Durable actor state |
| `message` | Addressed, durable, serialized turn | Admission receipt | Durable actor state |
| `connectionMessage` | Connection-scoped ephemeral serialized input with declared buffering/delivery | Delivery receipt | Realtime connections and messages |
| `connection` | Authorized realtime connection admission | Connection receipt | Realtime connections and leases |
| `disconnection` | Explicit close or bounded lease-expiry turn | Terminal connection receipt | Realtime connections and leases |
| `broadcast` | Typed fan-out from an admitted turn | Publication receipt | Realtime broadcast |
| `alarm` | Durable scheduled serialized turn | Schedule/cancel receipt | Durable alarms |

An ordinary Applik8s event remains a published fact with the existing outbox and subscription semantics.
It is not renamed to an actor message. Actor messages have one addressed logical receiver; events may have
many subscribers.

`connectionMessage`, `connect`, `disconnect`, `broadcast`, and alarm names exist only when declared.
Protocol descriptors add capability requirements to the actor graph, so a non-realtime actor does not
require a provider to pretend it supports sockets or presence.

Protocol member names must be valid generated property names and may not collide with framework members
such as `on`, `initialize`, `finalize`, `reference`, `hydrate`, `alarms`, `broadcast`, or administrative
operations. The compiler reports the collision at declaration time rather than silently moving a member
or changing its identity.

Exactly one handler is required for every declared command, durable message, connection message, and
alarm. Duplicate or missing handlers fail compilation. Connection/disconnection observation handlers are
optional no-ops after framework admission and lease handling; broadcasts are outbound and cannot have
handlers. An actor with durable state declares exactly one `on.initialize` handler unless its state
contract provides one explicit schema-valid default.

## Typed authority

Every inbound actor protocol member is a canonical operation handle:

```ts
const WorkspaceEditor = application.role("workspace-editor");

WorkspaceEditor.can(
  Workspace.rename.where(target =>
    target.key.in(WorkspaceEditor.workspaceIds),
  ),
);
```

The admitted actor turn receives framework-derived execution identity:

```ts
const principal = context.principal;
const causalPrincipal = context.causalPrincipal;
const receipt = context.authorizationReceipt;
```

Client input cannot establish those values. Nested actor, workflow, event, agent, and operation calls
preserve the original causal human or workload lineage while identifying the immediate execution
principal separately.

## Owned contracts

This RFP owns:

- actor definition, key, reference, schema-backed protocol, lifecycle, and state contracts;
- generated command, message, connection, broadcast, and alarm handles plus compiler capture;
- operation identity and authority integration for inbound actor protocol members;
- actor-turn admission, serialization, idempotency, and retry semantics;
- state transaction, durable-effect, and outbox boundaries;
- hibernation, activation, placement, and bounded passivation semantics;
- actor-to-actor call and cycle rules;
- alarm/timer behavior;
- actor versioning and state migration;
- provider conformance and capability negotiation;
- deterministic local, celld, Rivet, and future provider acceptance;
- diagnostics, tracing, metrics, and administrative lifecycle.

This RFP does not own:

- workflow history or multi-step orchestration;
- relational query semantics;
- Kubernetes reconciliation;
- broker-specific event delivery;
- provider-specific placement APIs in application source;
- globally exactly-once external side effects;
- an unrestricted browser RPC system.

## Actor identity and lifecycle

Every actor declares a stable definition identity and revision family. The identity is an explicit
string, not an inferred export or source symbol, and therefore survives file, export, and local-variable
renames. The compiler rejects duplicate stable identities within one application.

An actor identity is the tuple:

```text
application identity
explicit actor definition identity and revision family
installation/environment identity
typed actor key
```

Provider routing may add physical region, shard, runner, or generation, but those are not logical
identity.

Admitting a command, durable message, connection message, connection, or alarm for an absent actor
activates it. Initialization is idempotently admitted before the first protocol turn. The provider
must not initialize two canonical states for the same identity.

Actors have the following logical lifecycle:

```text
absent -> activating -> active -> idle -> hibernated
                         |                    |
                         +------ recover <---+
                         |
                         +-> deleting -> deleted
```

An actor may be physically relocated without changing its logical reference. Application code cannot
depend on process identity, memory address, or runner hostname.

Deletion is an explicit authorized operation. Idle eviction is not deletion. A provider may discard
ephemeral memory during hibernation but must preserve canonical durable state and admitted alarms.

When deletion is requested, the actor rejects new ordinary inbound work and admits `on.finalize` as a
retryable serialized lifecycle turn when declared. State, alarms, references, and provider ownership are
retained until finalization commits or an explicit authorized orphan/force policy applies. Physical
shutdown, crash, eviction, or hibernation never masquerades as finalization.

## Turn and concurrency semantics

One actor identity processes at most one turn at a time in v0.8. That includes commands which only read
state. Providers may run different actors in parallel. Concurrent read optimization is deferred until a
later contract can define revision, ordering, authorization, and migration interactions portably.

A turn is:

1. admitted with stable input identity, protocol-member identity, target key, principal, and causal chain;
2. routed to the current activation or activates the actor;
3. executed against one state revision;
4. committed or rolled back as one actor-state transaction;
5. followed by durable delivery of committed outbox effects;
6. recorded with a terminal receipt or retry disposition.

Retries may re-execute application code. The runtime guarantees idempotent admission and commit for one
input identity; it does not claim an arbitrary network request inside a handler executes exactly once.

Commands and messages accept the same execution metadata convention as other function-native handles:

```ts
await Workspace.rename(
  workspaceId,
  { title: "Launch plan", expectedRevision: 3 },
  { idempotencyKey: request.id },
);
```

The framework supplies a stable key when a captured managed execution makes a direct call. External
gateways require or derive one according to the operation contract.

### Reentrancy

Implicit reentrancy is prohibited in v0.8. An actor protocol handler cannot synchronously invoke another
inbound member on the same actor and wait for it. The compiler/runtime diagnoses direct self-invocation
where provable; the provider rejects runtime cycles.

Ordinary helper functions remain the composition mechanism inside one turn. A later RFP may introduce
explicit reentrant or interleaving actor semantics.

### Actor-to-actor calls

Calls to another actor use durable admitted operation calls. They do not share an atomic transaction
across actors.

Call cycles must be detected. A runtime cycle terminates the current turn with `ACTOR_CALL_CYCLE`, rolls
back its state and staged effects, and returns a stable diagnostic containing the bounded actor and
protocol-member path without leaking sensitive keys. Long-lived coordination, fan-out, compensation,
and approval belong in workflows rather than lock chains between actors.

## State and durable effects

The actor-turn handle's `state()` returns an immutable typed snapshot for the current revision.
`setState()` stages a complete next state. Provider-specific mutable state objects are not exposed.

The canonical actor commit contains:

- actor identity and definition revision;
- previous and next state revision;
- serialized next state;
- call receipt and authorization provenance;
- staged framework-owned event/outbox effects;
- staged alarms;
- terminal result or typed error disposition.

State update and framework-owned durable effects commit atomically when they share the actor provider's
canonical transaction authority. Cross-authority effects use the existing outbox and idempotent receipt
protocol.

Actor protocol handlers may call transaction-compatible model operations requiring a result only when a
provider explicitly proves a shared transaction authority. Otherwise such a call is rejected before
execution.

One-way work outside the actor authority is declared function-natively and runs after a successful
commit:

```ts
workspace.afterCommit(() => ReindexWorkspace({ workspaceId: workspace.key }));
```

The runtime records a stable effect identity and idempotency receipt with the actor commit, retries
delivery durably, and does not expose a result to the committing turn. Ambient typed event emission
continues to use the transactional actor outbox and does not require `afterCommit`.

## Events, workflows, and signals

Actors emit ordinary typed Applik8s events. Event payloads may include inert actor references.

Workflows call actors for identity-scoped state transitions. Actors may start workflows for durable
coordination, but workflow completion does not occur inside the actor state transaction.

Typed signals remain workflow/application capabilities, not actor mailbox aliases. An actor may resolve
an authorized signal by calling its existing operation handle.

## Alarms and timers

Actors declare alarms as schema-backed protocol members and attach their handler through
`Actor.on.<alarm>()`. They schedule those alarms transactionally from an admitted turn:

```ts
await workspace.alarms.expireDraft.schedule(expiresAt, {
  expectedRevision: current.revision,
});
```

Alarm guarantees:

- a stable identity derived from actor, declared alarm identity, and scheduled generation;
- durable persistence with the committing turn;
- at-least-once wakeup with idempotent admission;
- replacement or cancellation by exact alarm identity;
- no early delivery beyond documented clock tolerance;
- observable overdue and failed state;
- recovery after provider restart or actor relocation.

Cron and fleet-wide work uses the function-native scheduling contract defined by
[`rfp-v08-function-native-scheduling.md`](rfp-v08-function-native-scheduling.md), not per-actor alarms.
Actor alarms remain identity-scoped, transactional actor effects and do not select or expose the
application's qualified `Scheduler` provider.

Alarm replacement and cancellation occur inside an admitted actor turn through
`actor.alarms.<name>.schedule(...)` and `actor.alarms.<name>.cancel()`. The public actor handle does
not expose a provider-direct `Actor.alarms.<name>.cancel(key)` escape hatch. An application that
needs an externally callable cancellation declares an ordinary typed actor command, authorizes that
command, and performs the bound cancellation from its handler. This keeps cancellation serialized
with the actor identity, operation-authorized, and provider-neutral.

## Realtime connections and presence

Realtime behavior is optional protocol surface, not a baseline property of every actor. Declaring
`connectionMessage`, `connection`, `disconnection`, or `broadcast` members requires matching provider
capabilities.

Connection admission has a stable connection identity, authenticated immediate principal, causal
principal, actor key, protocol revision, and lease. Explicit close may produce disconnection promptly;
network loss is observed through bounded lease expiry. The runtime admits one logical disconnection turn
per connection identity even when providers deliver duplicate physical notifications.

An entrypoint-exported realtime actor is admitted through a short-lived, single-use signed connection
ticket minted by the authenticated ApplicationHost. Browser clients use the application origin under
`/__applik8s/v1/actors`; they never receive the actor-provider bearer or select a provider endpoint.
Planning fails closed unless that origin has an explicit `HttpExposure` provider. Kubernetes lowering
routes only the exact actor prefix from the declared ingress-controller namespace to celld's public
listener, while peer traffic remains namespace-private. AWS lowering attaches the same exact prefix to
the ApplicationHost ALB. Ticket claims carry the framework-derived principal, causal principal,
authorization receipt, trusted-context digest, actor/key/protocol identity, nonce, and expiry. Actor
turn callbacks receive that authority as framework metadata; client input cannot claim or replace it.

Framework presence is derived from live connection leases. Applications must not assume that a durable
participants array updated only by prompt disconnect callbacks is authoritative. An application may
deliberately persist membership or audit facts, but transient presence remains separately queryable and
reconcilable.

A `connectionMessage` is intended for transient realtime interaction such as cursor movement. It may
read the current snapshot and broadcast, but v0.8 rejects durable state changes and durable external
effects from its handler. A client requiring reliable state mutation invokes a typed actor `command` or
durable `message`, even when that call is transported over the same authenticated connection.

Broadcasts are typed ephemeral realtime delivery, not durable application facts. A handler that requires
durable replay also emits an ordinary Applik8s event or writes an authoritative model within the existing
effect contracts. Provider plans state broadcast ordering, buffering, payload, backpressure, reconnect,
and delivery limits truthfully.

A broadcast staged by a durable command, message, connection lifecycle, or alarm becomes eligible only
after that turn commits; a rolled-back turn publishes nothing. Broadcast delivery failure after commit
does not roll back durable state and is reflected in its publication receipt/metrics. A read-only
ephemeral connection-message turn may broadcast immediately because it cannot stage durable state or
effects.

## Versioning and migration

Actor state has an explicit schema revision. A deployment that changes persisted state must declare a
migration path before new code can activate old state.

```ts
state: actorState({
  version: 2,
  schema: WorkspaceStateV2,
  migrate: {
    1: async previous => ({
      ...previous,
      collaborators: [],
    }),
  },
}),
```

Migrations run as isolated actor turns with stable receipts. They must be restart-safe and idempotent.
Providers cannot silently erase state, coerce an incompatible schema, or activate two code revisions for
one actor unless an explicit compatibility policy permits it.

The protocol is versioned independently from the state schema. A protocol member name is a stable
identity within the actor revision family. Renaming creates a new member unless an explicit compatibility
alias preserves the old identity. Input widening, output changes, removal, and semantic-kind changes are
checked against admitted/in-flight envelopes, hydrated clients, alarm schedules, connection sessions, and
rolling provider generations.

Removing or incompatibly changing a member requires a drain, rejection, or migration policy. The runtime
cannot reinterpret an already admitted message as a new schema merely because the current source uses the
same property name.

Rolling deployment policy must define:

- accepted actor definition revisions;
- accepted protocol-member identities and input/output schema revisions;
- call routing during rollout;
- migration ownership;
- rollback boundary after state migration;
- alarm compatibility;
- serialization format compatibility.

## Provider capability contract

Actor providers declare capabilities rather than merely a provider name:

```ts
interface ActorProviderCapabilities {
  durableState: true;
  serializedTurns: true;
  transactionalOutbox: boolean;
  durableAlarms: boolean;
  realtimeConnections: boolean;
  connectionLeases: boolean;
  realtimeMessages: boolean;
  realtimeBroadcast: boolean;
  hibernation: boolean;
  placement: "single-region" | "multi-region";
  storage: "embedded" | "postgres" | "foundationdb" | "provider-defined";
  maximumStateBytes?: number;
  maximumTurnDuration?: string;
}
```

An actor definition may require capabilities. Planning fails when the selected provider cannot satisfy
them.

## celld provider

celld is the first distributed provider implementation candidate because its named cells, one SQLite
database per identity, one-writer fencing, object-storage durability, alarms, hibernatable WebSockets,
and inactive scale-to-zero model closely match the Applik8s actor contract. Its small control-plane
surface also maps cleanly to local, AWS, and Kubernetes target planning.

Relevant upstream references include the [celld repository](https://github.com/denoland/celld),
[documentation](https://github.com/denoland/celld/tree/main/docs),
[Cloudflare compatibility surface](https://github.com/denoland/celld/blob/main/docs/cloudflare-compat.md),
[testing contract](https://github.com/denoland/celld/blob/main/docs/testing.md), and
[current limitations](https://github.com/denoland/celld/blob/main/docs/limitations.md).

celld's native Durable Objects execution permits another request to interleave when a handler awaits.
Applik8s v0.8 does not. The adapter must durably admit and serialize one complete Applik8s actor turn,
including awaited application work, rather than weakening the public contract or relying only on SQLite
storage serialization. The conformance suite must prove that a second command cannot observe or mutate
the actor between the first turn's state read and committed result.

The adapter must additionally prove:

- one stable command/message admission identity and prior-result lookup across retry and caller timeout;
- atomic SQLite state, framework outbox, result receipt, and alarm behavior or an explicitly equivalent
  durable protocol;
- acknowledged-write recovery and one-writer fencing under node loss, lost responses, object-store
  throttling, ownership transfer, and stale owners;
- generated Workers/Wrangler deployment artifacts without exposing Workers or Durable Objects APIs to
  application source;
- typed RPC/fetch/alarm/WebSocket translation into the Applik8s actor envelope;
- hibernation, inbound WebSocket reconnection, node movement, pressure shedding, and capacity behavior;
- schema/protocol migration, rolling deployment, rollback boundaries, finalization, and teardown;
- OpenTelemetry identity and context propagation through celld and the generated actor adapter; and
- loud planning diagnostics for unsupported runtime, network, storage, realtime, or operational
  guarantees.

The provider is split into:

- an Applik8s-generated Worker/runtime adapter translating admission, state, alarms, connections,
  broadcasts, results, effects, authority, and traces;
- a TypeKro composition for celld nodes, private peer networking, ingress/TLS termination, object-store
  binding, readiness, upgrades, and deletion;
- an Alchemy AWS adapter for compute, load balancing, private networking, S3 authority, IAM, deployment,
  and cross-resource outputs;
- a local target using a pinned conditional-write-compatible object store rather than pretending the
  filesystem satisfies celld's fencing contract; and
- an external celld binding for an already managed fleet.

celld remains alpha until the submitted version passes Applik8s conformance. Rapid adoption, maintainer
reputation, or upstream claims cannot substitute for repeatable release evidence. No v0.8 application API
may be designed solely to make the celld adapter easy.

## Rivet provider and independent conformance target

Rivet is implemented after the celld adapter as an independent challenge to the public semantics and as
an operational-maturity comparison. It supplies actor identity, long-lived execution, durable state,
hibernation, realtime communication, management surfaces, and self-hosted deployment. Its different
runtime and storage model helps detect assumptions that accidentally encode celld or Durable Objects.

Relevant upstream references include the [Rivet Actors documentation](https://rivet.dev/docs/actors/),
[Kubernetes deployment guidance](https://rivet.dev/docs/deploy/kubernetes/), and
[production checklist](https://rivet.dev/docs/self-hosting/production-checklist/).

The provider includes an Applik8s runtime adapter, TypeKro self-hosted composition, Alchemy lifecycle
adapter, local conformance target, and external binding. Rivet-specific actions, clients, placement,
queues, schedules, workflows, and management APIs do not appear in generated application source.

Rivet is nonblocking until its adapter is complete. It cannot weaken celld qualification, but it can
expose a provider-specific assumption that requires correcting the Applik8s contract or provider
capability model before actor beta freezes.

## Local deterministic provider

Tests and the default local target require a deterministic actor provider. It may run in process but must
use the same serialized call envelope, state codec, admission receipts, and alarm abstraction as remote
providers.

It is not accepted as distributed durability evidence. Crash/recovery conformance must also run against
celld or another fully qualified distributed provider.

## Deployment and operations

Actor definitions become graph nodes with:

- definition identity and schema revision;
- protocol revision, member identities, schemas, directions, and semantic kinds;
- generated command, message, connection, broadcast, and alarm operation identities;
- provider qualification and capability requirements;
- state codec and migration digest;
- alarm declarations;
- authority requirements;
- runtime artifact and routing outputs;
- scaling and placement policy;
- lifecycle and readiness evidence.

Operations UI shows:

- active and hibernated actor counts;
- activation, turn, retry, and failure rates;
- queue and execution latency;
- state size and migration revision;
- overdue alarms;
- hot keys and throttling;
- provider health and placement;
- causal traces from caller through actor effects;
- authorized inspect, drain, migrate, and delete operations.

Actor state is not a general administrative table. Inspection is authorized, redacted, size bounded,
and audited.

## Failure semantics

Typed application errors may be returned as stable operation failures. Infrastructure interruption,
provider unavailability, serialization failure, lost lease, and migration failure are framework
failures with retry dispositions.

The runtime must distinguish:

- rejected before admission;
- admitted and pending;
- executing;
- committed;
- retryable failure before commit;
- terminal application failure committed as result;
- unknown provider outcome requiring receipt lookup.

Timeout of the caller does not imply cancellation of an admitted turn. Cancellation is an explicit
operation with provider capability and race semantics.

## Security requirements

- Inbound actor protocol admission uses canonical operation authority per member.
- Actor references do not confer authority.
- Browser calls pass through an authorized gateway and never reach provider control APIs directly.
- Causal identity survives nested actor/workflow/agent calls.
- State and results use schema-based redaction in logs and operations UI.
- Provider credentials are runtime secrets, not actor state.
- Administrative operations are separately authorized and audited.
- Cross-tenant keys cannot collide through normalization or provider routing.
- Untrusted actor state cannot inject runtime routing or code identities.

## Implementation increments

### Increment 1 — Contract and deterministic runtime

- Complete a bounded celld feasibility spike and a smaller Rivet semantic comparison before freezing the
  public actor/provider API. The celld spike must cover full-turn serialization, state/effect/alarm
  durability, Workers artifact generation, object-store fencing, WebSockets, and deployment lifecycle.
- Finalize actor definition, schema-backed protocol, generated handles, reference, turn, state, and receipt
  contracts.
- Integrate protocol members with compiler discovery and operation authority.
- Implement deterministic local provider and conformance harness.

### Increment 2 — State, events, and alarms

- Add transactional state, outbox effects, actor references, and durable alarms.
- Prove retries, duplicate calls, caller timeout, and restart recovery.

### Increment 3 — Optional realtime protocol

- Add connection admission, leases, presence, connection messages, and typed broadcasts.
- Prove that non-realtime actors remain compatible with providers lacking those capabilities.
- Prove ephemeral/durable boundaries and connection-loss recovery locally.

### Increment 4 — celld provider

- Implement the generated Worker/runtime adapter and local, TypeKro/Kubernetes, Alchemy/AWS, and external
  fleet bindings.
- Prove full-turn serialization across `await`, admission/result recovery, activation, fencing,
  hibernation, state/outbox/alarm durability, optional realtime behavior, node loss, rolling update, and
  teardown.

### Increment 5 — Migration and operations

- Add schema migration, rollout policy, observability, drain, and administrative operations.
- Pressure-test hot keys and provider capacity.

### Increment 6 — Rivet provider and contract review

- Implement enough of the independent Rivet adapter to run the complete shared semantic suite where the
  provider advertises the required capabilities.
- Record incompatibilities and remove accidental celld, Durable Objects, or Rivet leakage.
- Keep Rivet nonblocking for v0.8 beta unless the scorecard is explicitly amended to require it.

## Required gates

### Type and compiler

- Key, state, protocol members, inputs, results, references, realtime requirements, alarms, and authority
  are inferred.
- Invalid state transitions and unserializable values fail before deployment.
- `Actor.on.<member>()` and generated command/message/alarm/broadcast properties are fully type safe.
- Missing, duplicate, outbound, reserved-name, and semantic-kind-incompatible handlers fail compilation.
- Direct command/message calls through captured local helpers resolve to canonical protocol members.
- Browser bundles contain references/stubs but no provider credentials or server implementation.

### Concurrency and durability

- Hundreds of concurrent calls to one key produce serialized monotonic state.
- Read-only commands and mutating protocol members share one serialized order for an actor identity.
- Different keys execute concurrently.
- Duplicate admission commits once and returns the prior receipt/result.
- Crash before commit retries safely; crash after commit recovers the committed result.
- Caller timeout followed by retry does not double-commit.

### Effects and alarms

- State and local outbox effects commit or roll back together.
- `afterCommit` effects are durably admitted only after commit and replay with one logical identity.
- Broker interruption after commit republishes without duplicate logical facts.
- Alarms survive restart, fire no earlier than allowed, and admit once logically.
- Alarm replacement and cancellation are race tested.

### Realtime

- Providers without realtime capabilities accept actors that do not declare realtime protocol members.
- Connection admission, explicit close, abrupt loss, lease expiry, duplicate notifications, reconnect,
  and authorization pass one semantic suite.
- Presence converges from connection leases rather than relying on an infallible disconnect callback.
- Ephemeral connection-message handlers cannot mutate durable state or stage durable effects; reliable
  changes use commands or durable messages.
- Broadcast type validation, ordering claims, backpressure, payload limits, and reconnect behavior match
  the provider guarantee manifest.
- Rolled-back durable turns publish no broadcast; post-commit delivery failure does not corrupt committed
  actor state.
- Durable application facts use the ordinary event/outbox contract rather than ephemeral broadcast.

### Migration and rollout

- Old state activates only through a declared migration.
- Interrupted migration resumes.
- Unsupported rollback is rejected before deployment.
- Mixed-version routing preserves the declared compatibility policy.

### Authority and security

- Protocol-member authority is enforced for HTTP, browser, workflow, agent, actor, event, connection, and
  alarm callers.
- Immediate and causal principals remain distinct and correct.
- Forged references, keys, principals, receipts, and revisions are rejected.
- Losing or unauthorized callers do not receive sensitive winning results.

### Provider conformance

- Deterministic local and celld providers pass the complete shared semantic suite before celld can satisfy
  the v0.8 beta gate.
- The suite proves the celld adapter prevents Durable Objects-style interleaving across awaited work and
  preserves one complete serialized Applik8s turn.
- Rivet runs the same suite as an independent nonblocking target until explicitly promoted.
- Kubernetes installation, upgrade, finalizer-safe deletion, and retained state are live tested.
- Finalization retries safely, blocks deletion while unresolved, and never runs merely because an actor
  hibernates or its process crashes.
- Provider capability differences appear in plan and operations evidence.

## Non-goals

- Globally exactly-once arbitrary external I/O.
- Distributed transactions across actors.
- Replacing relational models with actor state.
- Making every CRD reconcile through an actor.
- Implicit reentrancy or arbitrary turn interleaving.
- Multi-region active-active actor state in the first release.
- Exposing Rivet or celld client objects in application source.
- Treating the local deterministic provider as production-ready.

## Closed v0.8 decisions

- Actors declare one schema-backed protocol that derives callback and interaction surfaces.
- Commands are promise-returning direct callable handles; messages return durable admission receipts.
- Connection messages, connections, disconnections, broadcasts, and alarms appear only when declared
  and add provider capability requirements.
- Actor identity is logical and provider independent.
- Actor definition identity is explicit, rename-stable, revision-family-scoped, and duplicate checked.
- Protocol member identity and schemas are stable, versioned graph contracts.
- Every inbound protocol member executes as one serialized turn per actor identity in v0.8; concurrent
  reads are deferred.
- Actor references are serializable addresses, not authority grants.
- Cross-authority result-bearing calls are rejected; one-way post-commit work uses the actor turn's
  `afterCommit`.
- Runtime actor-call cycles fail with `ACTOR_CALL_CYCLE` and roll back the current turn.
- `setState()` remains a whole-state replacement; mutable provider state objects are not public.
- Workflows remain the primitive for long-running coordination.
- Provider-specific placement and storage choices stay behind capability negotiation.
- celld is the first distributed provider implementation candidate; it earns beta qualification only by
  passing the full conformance and lifecycle suite.
- Rivet is the second independent conformance and operational-maturity target and is initially
  nonblocking.
- Actors ship as beta in v0.8 even if local/AWS portability is declared stable.

## Definition of done

This RFP is complete when application authors can define one typed actor, call it directly by identity,
declare schema-backed commands, messages, optional realtime connections/broadcasts, and alarms, attach
handlers through `Actor.on.<member>()`, authorize each inbound member, persist and migrate state, emit
durable effects, observe lifecycle and presence, and run the same semantic contract through deterministic
local and one fully qualified distributed deployment—celld is the intended first candidate—without
importing provider APIs or confusing actors with workflows, events, or models. Rivet independently
challenges that contract before any stronger maturity claim.
