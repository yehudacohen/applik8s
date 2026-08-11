# RFP: Applik8s v0.7 — Function-Native Execution and Durable Closures

**Status:** Accepted v0.7 contract; implementation in progress. The conformance matrix below is the
authoritative distinction between implemented compatibility foundations and the remaining golden-path
surface.

**Charter:** [`charter-v07-agentic-platform.md`](charter-v07-agentic-platform.md)

**Depends on:** Existing v0.6 models, operations, commands, queries, live subscriptions, streams,
projections, generated runtimes, application graph, and workflow engine; the v0.7 typed-operation and
authority contracts

**Refines:** Public execution and invocation syntax in
[`rfp-v07-operation-authority.md`](rfp-v07-operation-authority.md),
[`rfp-v07-profiles-and-starts.md`](rfp-v07-profiles-and-starts.md),
[`rfp-v07-agentic-start-distribution.md`](rfp-v07-agentic-start-distribution.md),
[`rfp-v07-ai-runtime.md`](rfp-v07-ai-runtime.md), and
[`rfp-v07-search-projections.md`](rfp-v07-search-projections.md)

**Supersedes:** The earlier callback-first draft retained in repository history.

**Unblocks:** A coherent function-native developer experience across workflows, events, batch
consumers, HTTP, queries, live views, model lifecycle, Kubernetes reconciliation, projections,
schedules, agents, MCP, Chirp, GuestBook, and the first Agentic Start

## Implementation conformance

Passing builds or compatibility lowering do not by themselves satisfy this RFP. A row is implemented
only when the golden-path source form, normalized graph contract, generated runtime, and focused
acceptance evidence agree.

| Capability | Designed | Implemented | GuestBook | Chirp |
| --- | --- | --- | --- | --- |
| Model-first `model()`/`field` authoring | Yes | Yes: the typed database schema binding discovers Applik8s-authored models, installs their graph/runtime facets, and preserves the original Drizzle table identity without `app.model(...)` | Not applicable to CRD model | Yes |
| Direct model CRUD handles | Yes | Yes | Yes | Yes |
| Named model lifecycle facts without string identities | Yes | Yes | Yes | Yes |
| Function-native query/view implementation argument | Yes | Yes: relational, analytical, and Kubernetes-backed models expose distinct `Model.query(contract, implementation)` and `Model.view(contract, implementation)` declarations with named identity, compiler capture, shared authority/budgets, and graph-visible lifecycle semantics | Yes | Yes |
| Direct callable dependency capture | Yes | Yes: compiler-captured workflow, operation, query, database, transaction-scoped model, event, projection, object-store, and recurring-schedule calls lower through execution-scoped runtimes; inline and same-file named callbacks share inference, while unresolved callback modules fail closed. The exact emitted event worker passes nested model/event hydration and duplicate recovery against live PostgreSQL. | Not exercised | Yes |
| Single-step workflow lowering without public tasks | Yes | Yes | Not exercised | Yes |
| Optionless named workflow authoring | Yes | Yes: `workflow(id, contract, handler)` omits placeholder options; the compiler inserts internal capture metadata when required | Not exercised | Yes |
| Same-authority lifecycle operation composition | Yes | Yes: committed lifecycle handlers `await Model.create/update/delete(...)`, observe a typed provisional snapshot, and atomically commit or roll back every same-PostgreSQL write and durable effect; cross-authority and unawaited calls fail closed | Not exercised | Yes |
| Before-commit staged command safety | Yes | Yes: aggregate policy callbacks retain explicit `void Command(input)` outbox staging and reject awaiting another model operation | Not exercised | Yes |
| `Stream.onEvent(...)` | Yes | Yes: it lowers to the existing whole-handler processor/checkpoint contract; `process` remains deprecated compatibility | Not exercised | Yes |
| Frozen whole-acknowledgement `Stream.onBatch(...)` | Yes | Yes | Yes: Chirp's generated JetStream worker persists one frozen engagement batch through the durable transaction path and records its retry-stable receipt before whole-batch acknowledgement | Yes |
| Single-transform projection write scope | Yes | Yes: one synchronous descriptor callback lowers to the existing projection runtime; fluent rebuild authority and retention remain graph-visible | Not exercised | Yes |
| Typed signal event plus callable one-shot decision | Yes | Yes: contract-derived streams, transactional PostgreSQL state/outbox, generated workflow issuance/waits, server/browser action hydration, exact-instance gateway and query-output admission, framework-derived actors, redacted losing outcomes, expiry, execution-family-specific inert projection decoding, bounded model-backed `field.signal(...)` persistence, and exact live PostgreSQL restart/recovery evidence exist | Yes: Chirp publishes the typed review issuance over SSE, survives reload, resolves the callable decision, and resumes its durable automation workflow | Yes |
| Canonical resource/workflow tracking | Yes | Yes: `Resource.on.reconcile` starts or adopts an idempotent run from canonical reserved CR status, uses framework-managed finalizers and bounded cancellation, preserves literal `supersede`/`cancel` generation semantics, and recovers through bounded exact-resource resync. The live Hatchet gate proved retry, worker replacement, terminal projection, and settled reconciliation; a progress push bridge is an optional latency optimization rather than required correctness state. | Yes: Chirp's moderation CR converges through its private workflow gateway with UID/generation-scoped idempotency, stable run adoption, and terminal result projection | Yes |
| Automatic TanStack Start loader hydration | Yes | Yes: the root adapter discovers typed snapshots in matched loader data; routes retain ordinary `snapshot()` and `useQuery()` calls | Yes | Yes |
| Maintained Start capacity defaults | Yes | Yes: Starter, Dedicated, and External capacity policy lives in `@applik8s/start-agentic` and remains individually overrideable | Not applicable | Yes |
| Packed-package build and generated browser facade | Yes | Yes | Yes | Yes |
| Callback-native application modules | Yes | Yes: `module(name, setup)` and `module(name, { schema }, setup)` return exact inferred exports, validate and freeze the plain-object boundary internally, install once per application, infer returned top-level models/relations conservatively, and retain `defineApplicationModule` only as compatibility machinery | Not applicable | Yes |

The rows above are release claims, not aspirational documentation. Frozen
batches, typed durable signals, and resource/workflow tracking are complete only
because the matrix, executable acceptance manifest, Chirp source, and exact
candidate evidence now agree on the same public paths and assertion identities.

This table must be updated in the same change that advances a row. Acceptance prose later in this
document describes the required destination unless the corresponding row says `Yes`.

## Executive summary

Applik8s should feel like a TypeScript application framework whose distributed guarantees are inferred
from ordinary code, not a collection of adjacent dependency-map DSLs. Authors should call typed
application capabilities as functions, register reactive work with serialized closures, define
projections as pure transformations, and opt into durable orchestration explicitly.

The framework has six related but distinct authoring forms:

```ts
// Ordinary local behavior.
async function helper(input: Input): Promise<Output> {
  // No application identity or distributed boundary.
}

// One authoritative model declaration.
const Post = model("Post", {
  id: field.uuid().primary(),
  authorId: field.uuid().index(),
  body: field.text("body"),
  state: field.enum("draft", "published"),
  publishedAt: field.timestamp().optional(),
});

// Callable application capability.
const Timeline = Post.query(contract, implementation);
const page = await Timeline(input);

// Reactive serialized closure.
export const notify = Events.onEvent(options, handler);
export const index = Events.onBatch(options, batchHandler);
Resource.on.reconcile(resourceProxyHandler);

// Persisted derivation.
export const Projection = Events.project(Output, transform)
  .retain(policy);

// Durable orchestration.
export const Workflow = workflow("workflow.process.v1", contract, durableImplementation);
const run = await Workflow.start(input);

// Reusable feature boundary: ordinary callback plus a plain return object.
const workspaces = module("workspaces", application => {
  const Member = application.role("workspace-member");
  Member.can(Workspace.create, WorkspaceList);
  return { Workspace, WorkspaceList, Member };
});
const { Workspace, WorkspaceList } = application.include(workspaces);
```

These forms share compiler discovery, callable handles, authority, source inclusion, graph planning,
runtime placement, diagnostics, and operations evidence. They do not pretend that queries,
projections, reconciliation, transactions, and event delivery have identical semantics.

Registered application capabilities are directly callable:

```ts
await SomeCapability(input, invocationOptions?);
```

Inline `workflow(...)` marks a supported reactive closure as durable. `context.step(...)` creates a
workflow-local durable boundary. Both lower to the selected provider-neutral `WorkflowEngine`; Applik8s
does not create another workflow history engine.

When a workflow body is itself one bounded external-effect closure, the compiler lowers it to one
internal retryable step automatically. Authors still declare only the workflow. The task node is
execution IR, not a second public authoring construct. Multi-step workflows use `context.step(...)`;
they do not pre-register an `app.task(...)` catalog.

Signals are typed event contracts with callable durable decisions. A workflow commits the pending
signal and its issuance outbox row in one canonical transaction. Event and batch handlers receive a
hydrated server capability, authorized SSE consumers receive a hydrated client stub, and projections
receive only immutable issuance metadata plus an inert typed reference. None need to know the
underlying workflow run:

```ts
const signal = reviewEvent.signal;
await signal.approve({ comment: "Looks good" });
```

This RFP removes dependency alias maps, public model `operation()` and `task()` wrappers,
callback-valued query `run` properties, split projection callbacks, provider selection from domain
code, repeated local string identities, and public `context.invoke(...)` from the golden path.
Existing normalized `ExecutionBinding` and operation-authority records remain internal planning,
admission, and invocation representations.

Reusable feature assembly follows the same callback-native rule. Public modules
use `module(name, setup)` or `module(name, { schema }, setup)`. Setup runs once
for each including application and returns one ordinary plain object whose exact
type is the public boundary. Applik8s validates and freezes that object; authors
do not write dummy callables, a second `install()` callback, or
`Object.freeze(...)`. The explicit schema overload is a typed pre-setup escape
hatch when a callback must use model facets before returned-model inference can
run. Inference must never guess across multiple qualified databases.

## Problem statement

The existing APIs contain several locally defensible but collectively inconsistent forms:

- workflows declare task and child-workflow alias maps, then call generated context aliases;
- stream processors repeat that pattern for tasks and schedules;
- queries and views place their implementation inside a `run` option;
- online projections split one transformation across `map`, `partitionBy`, `key`, `score`, `value`,
  and `removeWhen`;
- some APIs expose the normalized graph more directly than the causal TypeScript relationship;
- model lifecycle observations use names easily confused with mutation methods;
- HTTP handlers may repeat resource, model, index, and capture maps the compiler can prove;
- model declarations leak provider-native schema constructors and require a second promotion step;
- ordinary external-effect closures are wrapped in a redundant application-task abstraction;
- domain closures locate providers through `context.inject(...)` and `context.database(...)`;
- projection declarations select infrastructure through `.using(...)`; and
- workflow signals are addressed through workflow-engine topology rather than traveling as narrow
  application capabilities.

For example, this:

```ts
ObservationRequests.process(
  "execute-source-observation",
  {
    tasks: {
      observe: observeSourceEffects.onEvent(event => ({
        requestId: event.requestId,
        sourceId: event.sourceId,
      })),
    },
  },
  async (_event, context) => context.tasks.observe(),
);
```

should be:

```ts
export const executeSourceObservation = ObservationRequests.onEvent(
  async event => observeSourceEffects({
    requestId: event.requestId,
    sourceId: event.sourceId,
  }),
);
```

The compiler already must understand source, complete typed input, operation identity, authority,
causation, provider requirements, and runtime placement. Authors should not repeat that graph when the
relationship is statically provable.

## Goals

v0.7 must:

1. make registered distributed capabilities directly callable in managed execution;
2. leave ordinary local TypeScript functions ordinary;
3. preserve the current serialized Kubernetes resource-proxy experience;
4. add bounded single-event and microbatch stream consumption;
5. distinguish one-shot queries, persistent live views, and persisted projections;
6. express a projection as one synchronous pure source-to-write transformation;
7. introduce `workflow(handler)` and `context.step(...)` as explicit durable constructs;
8. make workflow signals typed issuance-event contracts whose one-shot decisions are canonical in a
   named transactional store, serializable, hydratable, callable, recoverable, and durably awaitable;
9. infer dependencies, causal inputs, authority, RBAC, placement, and providers where safe;
10. fail closed when inference cannot prove a bounded relationship;
11. specify trigger admission, checkpoint, idempotency, replay, revision, and cancellation semantics;
12. expose every inferred relationship through graph, `plan`, `explain`, and operations UI;
13. retain provider neutrality across deployment, workflow, event, database, index, and AI runtimes;
14. bind serialized signals to canonical identities, roles, relationships, exact issuance-read and
    action operations, grants, targets, and scopes; derive the trusted actor and receipt in the
    framework; and distinguish `authorize` from `grantAccessTo` without treating possession as
    authorization;
15. require explicit replay or authoritative-snapshot authority for projection rebuilds;
16. project durable workflow progress into CRD status through tracked fresh reconciliation without
    persisting resource proxies;
17. make `model()` the single authoritative model declaration and derive provider-native relational,
    analytical, index, and Kubernetes representations from typed bindings;
18. keep provider selection and dependency hydration in application assembly rather than domain
    closures;
19. derive local definition identity from exported symbols while retaining explicit wire-contract
    versions where compatibility requires them;
20. migrate Chirp, GuestBook, and the identity acceptance slice to the new authoring model; and
21. preserve existing distributed guarantees while materially shrinking application source.

## Non-goals

This RFP does not:

- turn every callback into the same kind of handler;
- add a public `app.operation(...)` wrapper around ordinary TypeScript;
- add a public `app.task(...)` wrapper around ordinary external-effect closures;
- require `pgTable()`, `app.model(table)`, or another provider-native promotion ceremony for the
  ordinary model path;
- expose every exported helper as a transport-callable operation;
- create another workflow engine or persist closure objects;
- make ordinary HTTP, query, projection, transaction, or reconciliation work secretly durable;
- persist a raw HTTP request, response, socket, stream, or request context in workflow history;
- treat a Kubernetes watch as a durable application event log;
- introduce a symbolic JavaScript expression language for projections;
- expose workflow-engine run topology to application signal recipients;
- allow serialized signal references to bypass authentication or authorization;
- define multi-use signal completion, aggregation, concurrency, replay, or wait semantics in v0.7;
- add partial batch acknowledgement in the initial contract;
- claim transactional rollback or external atomicity for batched side effects;
- persist a Kubernetes resource proxy, client, field-owner context, or optimistic-concurrency token in
  workflow history;
- merge transactions, projections, admission, and reconciliation into a generic `pipe`;
- introduce ambient authority, clients, provider credentials, or global runtime binding;
- select a database, index, object store, or other provider from domain code;
- replace TypeKro or Alchemy deployment composition;
- make projection callbacks perform external effects;
- define general WebSocket or bidirectional streaming;
- add custom Kubernetes admission closures without a demonstrated requirement; or
- independently authorize a v0.7 release.

## Execution families

### Ordinary TypeScript functions

An ordinary function has no stable application operation identity:

```ts
async function calculateScore(input: ScoreInput): Promise<number> {
  return input.quality * input.confidence;
}
```

It is bundled and called as normal code. It does not automatically acquire transport, authorization,
idempotency, audit, retry, deployment, or durable-execution semantics.

Applik8s must not require authors to promote helpers into framework constructs merely so another
closure can call them.

### Authoritative application models

`model()` is the public source of truth for application data. A model is declared once in logical
application types and receives provider-native facets from its selected typed binding:

```ts
export const Subject = model("Subject", {
  id: field.uuid().primary(),
  tenantId: field.uuid().index(),
  canonicalState: field.json(),
  revision: field.integer().default(0),
  createdAt: field.timestamp().defaultNow(),
  updatedAt: field.timestamp().defaultNow(),
});

export const Observation = model("Observation", {
  id: field.uuid().primary(),
  tenantId: field.uuid().index(),
  subject: field.ref(() => Subject).optional(),
  observedAt: field.timestamp(),
  payload: field.json(),
});
```

The declaration derives ArkType boundary schemas, model identity and references, change metadata,
migration input, and the provider-native representation required by each qualified binding. A
PostgreSQL-bound model remains directly acceptable to Drizzle query builders:

```ts
await db
  .select()
  .from(Observation)
  .where(eq(Observation.tenantId, tenantId));
```

`pgTable()` and provider-native schemas remain advanced escape hatches for features the logical model
API cannot express. They are not the generated-project or ordinary application path, and they do not
require a second `app.model(table)` promotion step. Unsupported provider-specific behavior must be
declared as a typed refinement rather than silently erased.

Provider selection occurs once in application assembly:

```ts
provide(OperationalData, postgres({ migrations: "./migrations" }))
  .models(Subject, Observation, Assertion, Resolution);

provide(AnalyticsData, clickhouse())
  .models(SourceQuality, PipelineThroughput);
```

The qualifier values are typed capabilities, not strings. Domain code does not call
`.using(Postgres)`, inspect a profile name, or locate a database through execution context.

### Callable application capabilities

A capability becomes an Applik8s handle only because it owns a real framework boundary, including:

- a model-authoritative transaction;
- a validated and authorized query;
- a durable workflow;
- an agent execution;
- a transport-exposed operation; or
- another cataloged boundary with equivalent authority requirements.

Every callable handle retains its stable contract and methods:

```ts
interface CallableApplicationHandle<TInput, TOutput> {
  (
    input: TInput,
    options?: ApplicationInvocationOptions,
  ): Promise<TOutput>;

  readonly contract: ApplicationOperationContract<TInput, TOutput>;
}
```

Callable behavior must not erase selection, authorization, scheduling, result observation, AI-tool,
MCP, or lifecycle-event facets appropriate to the handle.

There is no generic public `app.operation(...)` in this RFP. A future cross-model transaction or other
missing boundary must be designed around its actual semantics rather than using a generic wrapper as
ceremony.

An ordinary function becomes managed only when it is registered at a framework trigger, used as a
durable workflow step, or deliberately exposed through a typed transport/tool boundary. Merely
exporting a helper does not create an RPC endpoint:

```ts
export async function acceptObservation(
  input: typeof AcceptObservation.infer,
) {
  return Subject.edit(input.subjectId, async subject => {
    const observation = await Observation.require(input.observationId);
    const next = reconcile(subject, observation);

    await subject.update({
      canonicalState: next.state,
      revision: subject.revision + 1,
    });

    EntityChanged.emit({
      subjectId: subject.id,
      revision: subject.revision + 1,
      changes: next.changes,
    });

    return next;
  });
}
```

`Subject.edit()` identifies the atomic model and partition boundary. It is not an operation registry.
When a route, event handler, agent tool, or workflow step references `acceptObservation`, the compiler
captures the statically reachable closure and records the operation identity, schema, authority, and
placement required by that registration.

The captured graph records the exact writable model, every nested
`Model.require/get/find` participant, and every `Event.emit` outbox contract.
This is semantic compiler metadata attached to promoted-model methods and
event handles, not a regex over callback source. A callback that reaches two
distinct writable models fails closed until an explicit cross-model atomicity
contract exists. Generated runtimes enter the existing durable command kernel;
they must not implement a second transaction, retry, result, or outbox engine.

The implemented lowering currently covers event handlers, frozen batch
handlers, model lifecycle handlers, and ordinary exported agent-tool
functions. A function-native workflow that reaches `Model.edit(...)`
automatically becomes an internal durable effect step; orchestration history
calls that step and the step uses its Hatchet invocation as the durable command
identity. Authors still write only the workflow and ordinary helper: there is
no public task catalog, participant map, outbox declaration, or operation
wrapper. The exact compiler-emitted event-worker `runtime.mjs` is qualified
against live PostgreSQL through restart and duplicate replay. Typed HTTP
routes now record their schemas, authority callback, authenticated-principal
boundary, context-scoped idempotency, raw-request rejection, and inferred
transaction in the graph; generated route execution still must join this same
kernel before the transaction surface is called complete.

### Reactive serialized closures

Reactive registrations include event delivery, batch delivery, schedules, model lifecycle facts, and
Kubernetes resource observation. Their trigger, retry, checkpoint, ordering, and durability semantics
remain specific to the source.

Resource handlers retain their current proxy-first form:

```ts
ImageJob.on.reconcile(async job => {
  job.status.phase = "Processing";
  job.apply(/* planned resource */);
});
```

The proxy records effects; it is not an ambient Kubernetes client.

`Resource.on.reconcile(...)` is the only public continuous-reconciliation
registration surface in v0.7. An Application-owned CRD carries enough
provenance for Applik8s to infer its generated operator, watch, service
account, namespace, RBAC, closure bundle, and declared workflow-gateway
authority. The older `app.reconcile(Resource, handler)` spelling is removed
rather than deprecated; it repeated information, centralized otherwise
resource-owned behavior, and existed only to simplify internal registration.
`app.on(...)` is removed from the public Application surface as well. Multiple
resource-owned callbacks automatically share one inferred controller. Advanced
placement or explicit SDK RBAC belongs to the resource declaration's
`controller` option; it does not move lifecycle behavior back onto the
Application builder.

The public type vocabulary follows the same ownership boundary:
`ApplicationResourceControllerOptions` configures the resource declaration's
inferred controller and `ApplicationResourceEventHandler` names a resource
callback. The older application-centric `ApplicationReconcileOptions` and
`ApplicationReconcileHandler` names are removed rather than retained as
aliases.

This is the already implemented reconciliation path, not aspirational syntax:
resource-owned callbacks coalesce into one inferred controller per CRD and the
compiler retains their closure bundle, watch/RBAC contract, operator
installation, and shared finalization authority. Removing `app.reconcile` does
not remove or defer controller functionality.

The concise application path remains proxy-first:

```ts
ImageJob.on.reconcile(async job => {
  job.status.phase = "Processing";
  job.apply(await prepareImage(job.spec.source));
});
```

The resource proxy records status, resource, finalizer, event, tracking, and
requeue effects without exposing an ambient Kubernetes client. The explicit
SDK form, `ImageJob.on.context.reconcile((job, context) => ...)`, remains for
handlers that genuinely need the lower-level context contract. Both spellings
join the same inferred controller; `.context` is an execution-style refinement,
not a separate application-level lifecycle registrar.

### Pure derivations

A projection is a synchronous deterministic function from one normalized source value to zero, one, or
many typed write descriptors:

```ts
(event, output) => output.upsert(/* descriptor */);
```

The returned value describes derived state. It does not perform the provider write.

### Durable programs

Named workflows and workflow-wrapped reactive closures are durable programs. Code outside a step or
callable child handle is deterministic orchestration. External effects occur through callable
capabilities or `context.step(...)`.

## Callable-handle runtime model

Direct syntax must have explicit runtime meaning:

| Runtime | Handle behavior |
| --- | --- |
| Application declaration/graph discovery | Records metadata only; invocation fails |
| Managed WASM or generated handler | Lowers to an admitted internal invocation |
| Ordinary task/worker execution | Uses the execution-scoped admitted runtime |
| Durable workflow | Creates or reattaches to a history-aware child invocation |
| Start/Vite server execution | Uses the authenticated request-scoped gateway/runtime |
| Browser | Only exposed client-safe handles become typed transport stubs |
| Test harness | Uses an explicitly installed deterministic test runtime |

The implementation must not depend on a process-global runtime or accidentally inherited ambient
authority. Calling a handle where no compatible runtime binding exists produces an actionable error.

Generated browser code contains no provider credentials or internal workload authority. Declaration
execution remains side-effect free. When application code exports a handle under an authored name,
the generated browser and server facades preserve that exact identifier; deterministic
`ModelNameOperationName` aliases remain compatibility conveniences, not a naming requirement.

### Workflow call and admission semantics

A workflow has two deliberately different invocation forms:

```ts
// Admit the workflow and await its durable result.
const output = await ProcessImage(input);

// Admit the workflow and return its run handle after durable admission.
const run = await ProcessImage.start(input);
```

```ts
interface WorkflowHandle<TInput, TOutput>
  extends CallableApplicationHandle<TInput, TOutput> {
  start(
    input: TInput,
    options?: WorkflowStartOptions,
  ): Promise<WorkflowRun<TOutput>>;
}

interface WorkflowRun<TOutput> {
  readonly reference: WorkflowReference<TOutput>;
  result(options?: WorkflowResultOptions): Promise<TOutput>;
  status(): Promise<ExecutionObservation<TOutput, unknown>>;
  cancel(options: WorkflowCancellationOptions): Promise<WorkflowCancellationReceipt>;
}
```

The semantics are normative:

- inside a workflow, `Workflow(input)` is a history-recorded child invocation and awaits its result;
- inside a workflow, `Workflow.start(input)` history-records child admission and returns the durable run
  without waiting for its result; parent completion does not implicitly cancel that run unless an
  explicit child-lifecycle policy says so;
- inside an ordinary managed callback, `Workflow(input)` admits and observes the result within the
  callback's bounded deadline; observation timeout does not implicitly cancel the admitted run;
- `.start(input)` returns only after durable admission and is the preferred form for reconciliation,
  detached work, and accepted HTTP mutations;
- HTTP `accepted` uses `.start()`;
- HTTP bounded `await` may invoke directly or start and observe within its declared timeout;
- `Workflow.schedule(...)` starts one run per admitted tick and does not wait for completion;
- a workflow-wrapped schedule is itself the top-level scheduled run;
- browser or external server invocation requires an explicitly exposed transport; and
- importing a workflow handle into browser code never grants workload authority.

Application-facing workflow signals are not addressed through `WorkflowRun`. They travel as the
serialized signal capabilities defined below.

## Static discovery and authority

### Call discovery

The compiler discovers statically reachable application-handle calls in managed closures and included
module-local helpers. It records:

- caller and callee stable identity and revision;
- call-site identity;
- complete input expression and provenance;
- principal, trusted-context, trigger, model, and resource-derived fields;
- invocation timeout, idempotency, occurrence, and cancellation policy;
- possible target and scope restrictions;
- provider and transport requirements; and
- causal relationships.

The current normalized `ExecutionBinding` remains the internal representation. Direct syntax is an
authoring improvement, not weaker admission.

### Fail-closed inference

Compilation fails for unresolved:

- runtime-selected arbitrary handles;
- dynamic imports;
- computed application-handle access;
- unincludable helper call graphs;
- unknown spreads hiding target fields;
- reflective invocation;
- unbounded loop occurrences; or
- authority broader than the enclosing workload may receive.

Diagnostics identify the closure, source location, unresolved relationship, and supported remedy.

An explicit maximum set remains available:

```ts
export const dispatchNotification = Events.onEvent(
  {
    authority: [
      SendEmail.where(message =>
        message.organizationId.eq(CurrentOrganization)),
      SendSms.where(message =>
        message.organizationId.eq(CurrentOrganization)),
    ],
  },
  async event => selectChannel(event.channel)({
    organizationId: event.organizationId,
    message: event.message,
  }),
);
```

The list is only a maximum candidate envelope. Runtime dispatch still proves exact membership,
validates complete input, derives the target, authorizes, audits, and admits the invocation.

### Concrete authority and replay

The workload envelope is the bounded union of reachable handles and static selectors. Every concrete
execution receives narrower authority from its admitted principal, trusted context, trigger, complete
callee input, target, call site, catalog revision, and compatible delegation.

Completed durable calls replay from their exact recorded receipt and result. They are not retroactively
reauthorized and repeated. New or incomplete protected calls authorize against current active catalog
and authority revisions.

Recorded results may replay only within their exact workflow, principal, operation, input, target,
receipt, and revision scope.

## Ordinary and durable execution

### Whole-handler delivery

An ordinary event callback has durable delivery and a checkpoint but no step history:

```ts
export const notify = Events.onEvent(
  async event => SendNotification(
    event,
    { idempotencyKey: event.id },
  ),
);
```

Failure before checkpoint completion may rerun the whole handler.

The compiler must not allow an innocent-looking non-idempotent direct call to imply exactly-once
behavior. A protected effect in an at-least-once callback requires either:

- a runtime-derived identity from trigger identity, stable call site, callee, and occurrence key; or
- an explicit compatible idempotency key.

### Inline durable closures

The wrapper has two overloads:

```ts
workflow(handler);
workflow(options, handler);
```

It is accepted only by registration points that explicitly support durable execution. It does not run
the closure at declaration time.

```ts
export const notifyDurably = Events.onEvent(
  workflow(async (event, context) => {
    const message = await context.step(
      "render",
      () => renderNotification(event),
    );

    await DeliverNotification(
      { message },
      { idempotencyKey: event.id },
    );
  }),
);
```

The parent registration supplies stable definition identity. Code revision derives from normalized
AST/module IR, statically included dependencies, durable options, and the parent contract—not raw
formatting.

### Durable steps

The public forms are:

```ts
context.step(name, callback);
context.step(name, options, callback);
```

Step callbacks may capture only durable values, included code, approved capability handles, and
explicit step-runtime capabilities. Captured clients, credentials, execution contexts, arbitrary class
instances, and unresolved mutable module state fail compilation.

Completed results replay from history. Repeated or loop-created steps require a deterministic key.
Large inputs or outputs must be stored through a declared artifact/object-store capability and carried
as a typed reference.

### Revisions and upgrades

Workflow definition identity is stable across formatting-only changes. Revision changes for
compatibility-significant normalized code, included dependencies, contracts, steps, or policies.

- existing runs remain pinned to their admitted revision;
- new runs use the active revision;
- deploys retain worker artifacts required by live runs;
- renamed or removed deployed steps require an explicit compatibility decision;
- plan and explain display definition and revision changes; and
- uninstall or revision retirement fails closed while live runs still require an artifact unless an
  explicit migration or abandonment policy is approved.

## Serializable signal capabilities

### Static event contract

A signal contract declares the immutable issuance-event input and its typed terminal actions:

```ts
const ReviewRequest = type({
  postId: "string",
  organizationId: "string",
});

const ApprovalInput = type({
  "comment?": "string",
});

const RejectionInput = type({
  reason: "string",
});

export const ReviewDecision = workflow.signal("review-decision.v1", {
  input: ReviewRequest,
  actions: {
    approve: ApprovalInput,
    reject: RejectionInput,
  },
});

type ReviewSignal = Signal<typeof ReviewDecision>;
```

The exported contract is both the stable signal definition and the typed stream of issuance facts. It
supports the ordinary event surfaces:

```ts
export const notifyReviewer = ReviewDecision.onEvent(notifyReviewerHandler);
export const auditReviewRequests = ReviewDecision.onBatch(batchOptions, auditRequestsHandler);
ReviewDecision.subscribe(subscriptionInput);
export const pendingReviewIndex = ReviewDecision.project(PendingReview, transform);
```

These surfaces share one logical issuance schema and identity, not one executable source type.
`onEvent`/`onBatch`, `subscribe`, and `project` receive the handler, client, and inert projection
facets defined below.

An inline `emitSignal<...>("name", ...)` declaration is intentionally not the golden path. TypeScript
generic arguments disappear at runtime, action schemas would be repeated at every emission site, and
other event handlers would have no importable typed contract. The exported ArkType-backed contract
infers all TypeScript input and action types without duplication.

The compiler registers issue, exact issuance read, and each action as stable canonical operations:

```text
signal/review-decision.v1/issue
signal/review-decision.v1/issuance.read
signal/review-decision.v1/approve
signal/review-decision.v1/reject
```

Those operations use the ordinary catalog, permission, grant, authorization, target, idempotency,
receipt, audit, compatibility, and revocation machinery. `issuance.read` is always scoped to a
particular signal instance; it is not contract-stream enumeration authority. Signals do not create a
parallel operation or grant system.

The authored contract exposes non-callable typed authority facets for the
exact-read operation and each declared action. Roles and service identities
therefore authorize signal access without string IDs, while actual actions
remain callable only on an exact hydrated signal instance:

```ts
const Reviewer = app.role("reviewer");
Reviewer.can(
  ReviewDecision.read,
  ReviewDecision.approve,
  ReviewDecision.reject,
);
```

`Signal<TContract>` is the hydrated server capability type. Each declared action accepts only its own
schema-derived input and returns an action-correlated result:

```ts
type SignalActions<T extends SignalContract> = {
  [Action in SignalActionName<T>]: (
    input: InferSignalActionInput<T, Action>,
    options?: SignalActionOptions,
  ) => Promise<SignalActionResult<T, Action>>;
};

type Signal<T extends SignalContract> =
  SignalActions<T> & ServerSignalFacet<T>;

type SignalClient<T extends SignalContract> =
  SignalActions<T> & ClientSignalFacet<T>;

declare const signal: ReviewSignal;

const result = await signal.approve({ comment: "Looks good" });
await signal.reject({ reason: "Needs revision" });
```

`approve` and `reject` exist because `ReviewDecision` declares those actions. Other contracts expose
their own typed action names. Action payload schemas contain application input only. Authenticated
actor identity and authorization evidence are always supplied by the framework.

### Emit and await

```ts
const decision = await workflow.emitSignal(ReviewDecision, {
  input: {
    postId: input.postId,
    organizationId: input.organizationId,
  },
  expiresIn: "24h",
  authorize: [
    Reviewers.for({
      organizationId: input.organizationId,
    }),
  ],
  target: {
    organizationId: input.organizationId,
    reviewId: input.reviewId,
  },
});

const outcome = await decision();

return outcome.match({
  approve: async ({ input: approval, actor, receipt }) => PublishPost({
    postId: input.postId,
    approvedBy: actor.id,
    approvalComment: approval.comment,
    approvalReceipt: receipt.id,
  }),
  reject: async ({ input: rejection, actor, receipt }) => RejectPost({
    postId: input.postId,
    rejectedBy: actor.id,
    reason: rejection.reason,
    rejectionReceipt: receipt.id,
  }),
  expired: async () => ({ state: "expired" }),
});
```

`workflow.emitSignal()` is available only in durable orchestration. It invokes the contract's
idempotent framework-owned issue operation with a replay-stable occurrence key derived from the
workflow run, pinned revision, call site, and deterministic occurrence. Workflow replay returns the
same callable decision, signal identity, issue receipt, and event identity.

Generated durable coordinators use a framework-bounded, long-lived
orchestration timeout so a legitimate signal wait is not terminated by an
engine's ordinary short task default. Captured effect steps retain their own
independent retry and execution timeout. Client/HTTP observation deadlines
bound only the observer and never alter the durable run's lifetime.

`decision()` suspends durably until the one-shot signal reaches a terminal action or expiry and returns
a typed discriminated outcome. It does not poll the event stream.

`authorize` only narrows invocation to subjects that already possess compatible authority. When the
recipient does not already possess it, issuance uses the mutually exclusive `grantAccessTo` form:

```ts
const decision = await workflow.emitSignal(ReviewDecision, {
  input: {
    postId: input.postId,
    organizationId: input.organizationId,
  },
  expiresIn: "24h",
  grantAccessTo: reviewer.identity,
  target: {
    organizationId: input.organizationId,
    reviewId: input.reviewId,
  },
});
```

The framework derives canonical exact-instance issuance-read and action grants bounded by target,
context, subject, use, and expiry, and verifies that the issuer possesses compatible `canGrant`
authority. Application code does not construct an approval-specific grant object.

For a statically captured signal contract, the compiler derives the emitting
workflow worker's internal, grantable permission template and `canGrant`
workload grant. This is deployment authority, not another application-facing
registration: application code writes only `grantAccessTo`. The generated
authority is limited to that signal contract's exact-instance read and declared
action operations, and the runtime still narrows every issued grant to the
concrete signal identity, authored target, recipient, transports, and expiry.
No compiler inference may grant contract-stream enumeration or unrelated
signal access.

### Canonical signal authority and transactional protocol

`SignalStore` is a provider-neutral internal subsystem of the canonical
`TransactionalDatabase.named("primary")` binding, not a public provider token or independently
selectable profile capability. It is the only source of truth for issuance,
pending/resolved/expired state, validated action input, framework-derived actor and receipt, access
mode, consumption, and idempotency.

The selected primary transactional database qualifies only if its framework control schema can commit
signal state, canonical operation receipts/grants, and the application event outbox in one local
transaction domain. PostgreSQL is the required v0.7 implementation. Starter, Dedicated, and External
profiles inherit this subsystem from their primary database; none may bind or override it separately.
An External primary database must permit the framework schema and migrations. Profile transitions must
account for pending signals, retained outcomes, outbox rows, grants, and workflow waits as primary
database state.

A workflow engine, broker, SSE gateway, notification provider, or in-memory index may observe or
accelerate this state but may not become another authority.

Every static signal contract registers these canonical operations:

```text
signal/<contract-revision>/issue
signal/<contract-revision>/issuance.read
signal/<contract-revision>/<action>
```

The issuing workflow's current `ExecutionPrincipal` must authorize the canonical issue operation.
`grantAccessTo` additionally requires compatible `canGrant` authority before the transaction may
commit. Issuance then executes one transaction:

```text
idempotent issue operation
  -> insert or reuse Pending signal instance
  -> persist authorize selectors or exact bounded grants
  -> insert immutable issuance event
  -> insert issuance outbox row
  -> commit one issue receipt
```

For `grantAccessTo`, the same transaction records exact-instance grants for
`issuance.read` and the declared signal actions. For `authorize`, no grant is created; the selectors
narrow subjects that must already possess compatible read and action authority.

Action authorization, the one-shot terminal compare-and-swap, grant retirement,
resolution fact, and outbox insertion also share one primary-database
transaction. Expiry retires the same exact-instance grants in its terminal
transaction. A losing action observes the existing redacted terminal result
without reauthorizing or running terminal hooks.

The transaction commits an outbox row; it does not claim that broker publication, workflow-history
recording, or workflow resumption participates in that transaction. After commit:

- the outbox publisher retries broker publication until acknowledged;
- workflow history records the issue receipt and callable decision;
- if the worker crashes after commit but before recording the receipt, replay invokes the same issue
  occurrence and receives the existing receipt; and
- the workflow provider registers a wait bridge keyed by signal identity and also reads terminal store
  state when attaching, so a notification that races registration cannot be lost.

An action invocation authenticates and authorizes the canonical action operation, validates the action
payload, and executes one compare-and-swap transaction:

```text
Pending
  -> Resolved(action, input, actor, receipt, decidedAt)
  -> immutable resolution event and outbox row
```

Expiry performs the corresponding idempotent `Pending -> Expired` transition. The workflow-provider
bridge wakes the suspended decision after commit. If notification or resumption fails, reattachment
reads the already-terminal canonical state and resumes without repeating resolution.

Resolution and expiry outbox facts are framework-owned wake, audit, and operation-completion facts;
they do not create another public issuance event or silently invent an application business event.

There is deliberately no distributed transaction between `SignalStore` and workflow history or the
broker. Correctness comes from the store's local transaction, replay-stable operation identity,
idempotent receipts, transactional outbox publication, compare-and-swap terminal state, and
reattachable waits.

### Event delivery, wire format, and execution-family decoding

The emitted fact has one stable logical envelope whose signal field is decoded according to the
execution family:

```ts
interface SignalIssuance<
  TContract extends SignalContract,
  TSignal,
> {
  readonly id: string;
  readonly input: InferSignalInput<TContract>;
  readonly signal: TSignal;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

type SignalHandlerEvent<T extends SignalContract> =
  SignalIssuance<T, Signal<T>>;

type SignalClientEvent<T extends SignalContract> =
  SignalIssuance<T, SignalClient<T>>;

interface SignalReference<T extends SignalContract> {
  readonly $type: "applik8s.signal/v1";
  readonly contract: SignalContractIdentity<T>;
  readonly issuance: SignalIdentity;
  readonly expiresAt: string;
}

type PersistedSignalReference<T extends SignalContract> =
  SignalReference<T> & PersistedCapabilityFacet<T>;

type SignalProjectionSource<T extends SignalContract> =
  SignalIssuance<T, SignalReference<T>>;
```

`Signal<T>` and `SignalClient<T>` expose the same typed action methods, but the first invokes through an
admitted server execution and the second is a browser-safe authenticated transport stub.
`SignalReference<T>` is inert: it preserves stable contract, issuance, expiry, and opaque-reference
identity for equality, serialization, and causal metadata, but exposes no action methods or hydration
method.

An ordinary event or batch handler receives `SignalHandlerEvent<T>` and may perform authorized causal
work:

```ts
export const notifyReviewer = ReviewDecision.onEvent(
  async event => SendReviewEmail({
    postId: event.input.postId,
    signal: event.signal,
  }),
);
```

SSE consumes the same issuance stream rather than a signal-specific transport and decodes each admitted
event as `SignalClientEvent<T>`:

```ts
const subscription = ReviewDecision.subscribe(
  { organizationId },
  { cursor, signal: abortSignal },
);

for await (const event of subscription) {
  await event.signal.approve({ comment: "Looks good" });
}
```

The signal is one logical value with four deliberately different facets:

- the issuing workflow receives a callable decision whose invocation durably waits for an outcome;
- event and batch handlers receive a server capability with declared action methods;
- authorized SSE/browser consumers receive a client transport stub with the same declared action
  methods; and
- projections receive an inert `SignalReference<T>` and therefore remain incapable of invoking or
  hydrating the signal.

A representative wire value is:

```json
{
  "$type": "applik8s.signal/v1",
  "contract": "review-decision.v1",
  "capability": "opaque-reference",
  "expiresAt": "2026-07-31T18:00:00.000Z"
}
```

Authorized non-projection server/client codecs may explicitly hydrate:

```ts
const signal = ReviewDecision.hydrate(serializedReference, runtime);
await signal.approve({ comment: "Looks good" });
```

`ReviewDecision.hydrate(...)` is absent from projection runtimes and projection source types. A cast,
opaque decoding trick, or serialization round trip cannot obtain an admitted invocation runtime.

The public application path does not require or expose the underlying workflow run. Event delivery is
not the source of truth for resolution; replaying an issuance event carries the same signal identity
rather than creating another signal.

### Projection decoding and capability-bearing outputs

`ReviewDecision.project(...)` is an ordinary projection surface, but its transformation receives
`SignalProjectionSource<typeof ReviewDecision>`, not a hydrated handler or client event:

```ts
export const pendingReviewIndex = ReviewDecision.project(
  PendingReviewMetadata,
  (event, output) => output.upsert({
    partition: event.input.organizationId,
    key: event.id,
    value: {
      id: event.id,
      postId: event.input.postId,
      expiresAt: event.expiresAt,
    },
  }),
);
```

The inert reference may be used for equality, causal identity, or explicitly discarded, but passing it
into a normal projection output fails planning. This keeps ordinary projection state non-capability
bearing and makes live processing and rebuild use the same immutable source value.

Persisting a resolvable reference is an advanced, explicit model-field contract:

```ts
const PendingReviewWithCapability = model("PendingReviewWithCapability", {
  id: field.text("id").primaryKey(),
  signal: field.signal(ReviewDecision, {
    visibility: "same-as-issuance",
    maxAge: "24h",
  }),
});

export const pendingReviewCapabilities = ReviewDecision.project(
  PendingReviewWithCapability,
  (event, output) => output.upsert({
    partition: event.input.organizationId,
    key: event.id,
    value: {
      id: event.id,
      signal: event.signal,
    },
  }),
);
```

`field.signal()` derives its type and contract revision from the static signal declaration and records
the maximum retention and visibility envelope once. Assigning the exact issuance received by the
transformation is a pure descriptor operation, not hydration or invocation. It preserves the exact
issuance-read scope, cannot outlive the signal's effective expiry as a callable capability, and cannot
broaden subjects, targets, actions, context, or transport. The compiler rejects plain-object/string
laundering, ordinary output fields, missing retention, ambiguous rebuild authorization, or a
destination whose read authority is broader than the issuance.

### Signal security and lifecycle

A signal issuance record carries or references:

- opaque identity;
- signal contract and revision;
- immutable event identity and causal workflow occurrence;
- stable canonical issue, exact issuance-read, and action operations;
- expiry;
- `authorize` or `grantAccessTo` access mode;
- canonical authorized subjects;
- role, relationship, permission, or grant selectors where applicable;
- exact target and scope;
- trusted-context digest;
- authorization revision;
- one-shot terminal state and consumption receipt; and
- idempotency scope.

`authorize` accepts provider-neutral authority selectors, including identities that already possess
authority, roles, service identities, and bounded relationship-derived subject selectors. It does not
store a snapshot-expanded list of current role members. Invocation reevaluates current identity, role,
relationship, permission, grant, and revocation state.

`authorize` and `grantAccessTo` are a type-level exclusive union:

```ts
type SignalAccess =
  | {
      authorize: readonly SignalSubjectSelector[];
      grantAccessTo?: never;
    }
  | {
      authorize?: never;
      grantAccessTo: IdentityReference | readonly IdentityReference[];
    };
```

`grantAccessTo` creates authority only for the exact issuance's canonical `issuance.read` operation and
declared actions. It does not grant general contract-stream enumeration, unrelated issuance
visibility, history access, or another transport. A selective action form may be added when
demonstrated, but no unbounded grant is inferred.

The opaque wire value does not expose those identities or selectors. Possession is necessary to
address the signal but is not sufficient authority to exercise it. Signal-event subscription admission
must authorize the typed subscription transport and the exact issuance's `issuance.read` operation
before delivering the event. The gateway filters by authorized issuance target; it does not disclose an
event and then check whether the caller may read it. An event handler receives the fact under its own
admitted workload identity; observing issuance does not grant permission to resolve it.
Batch consumers, live views, and projections inherit the same visibility boundary. A projection may
persist non-capability issuance metadata, but it may not widen access to the live signal reference.
Persisting a resolvable reference requires a `field.signal(...)` output-model field with the same exact
issuance visibility and bounded retention; ambiguous or broader storage fails planning. The ordinary
query gateway discovers these reserved references after output-schema validation and before returning
either a public or internal result. It reads canonical signal state and applies the exact
`issuance.read` operation to the current admitted principal; missing authority, a mismatched contract,
or unavailable canonical state fails closed. Applications do not duplicate this check in query code.

Every action requires the intersection of:

```text
authenticated principal
∩ current identity/role/relationship membership
∩ current permission or grant for the exact stable action operation
∩ signal-authorized subjects
∩ exact signal target, scope, and trusted context
∩ expiration, consumption, and idempotency policy
```

`authorize` never creates a grant. `grantAccessTo` uses the existing canonical grant machinery. The
issuer must possess compatible `canGrant` authority, and the resulting exact-instance read/action
grants are operation-, target-, subject-, context-, use-, outcome-, and expiry-bound. Naming an
identity through `authorize` cannot mint authority. A subject selected through `authorize` must already
possess compatible `issuance.read` and relevant action authority to receive and resolve the issuance.

Authorized subjects may be inferred from a typed recipient or notification operation only when the
compiler can prove the same canonical subject selector. Missing or ambiguous authorization fails
closed. Anonymous or bearer-style magic links require a future explicit delegation mode and are not
the default signal contract.

Every action authenticates the caller, validates the reference and payload, resolves current subjects
and grants, reauthorizes the canonical operation, enforces target/context/expiry/consumption, commits
the canonical terminal outcome and resolution outbox row, and returns an idempotent receipt. Workflow
resumption happens after that commit through the reattachable provider bridge.

The delivered outcome is derived from the complete signal contract. Each action produces a distinct
discriminated member containing its correlated validated input plus framework-derived
`actor: IdentityReference`, authorization receipt reference, action identity, decision time, and signal
identity. Expiry is its own terminal member. Client payload fields never establish the actor. A payload
may name a domain subject, but that subject is not treated as evidence of who invoked the action.

```ts
type ResolvedOutcomesByAction<T extends SignalContract> = {
  [Action in SignalActionName<T>]: {
    readonly status: "resolved";
    readonly action: Action;
    readonly input: InferSignalActionInput<T, Action>;
    readonly actor: IdentityReference;
    readonly receipt: AuthorizationReceiptReference;
    readonly signal: SignalReference<T>;
    readonly decidedAt: string;
  };
}[SignalActionName<T>];

interface ExpiredSignalOutcome<T extends SignalContract> {
  readonly status: "expired";
  readonly signal: SignalReference<T>;
  readonly expiredAt: string;
}

type SignalOutcomeValue<T extends SignalContract> =
  | ResolvedOutcomesByAction<T>
  | ExpiredSignalOutcome<T>;

type SignalOutcomeMatcher<T extends SignalContract, TResult> = {
  [Action in SignalActionName<T>]: (
    outcome: Extract<
      SignalOutcomeValue<T>,
      { status: "resolved"; action: Action }
    >,
  ) => TResult | Promise<TResult>;
} & {
  expired: (
    outcome: ExpiredSignalOutcome<T>,
  ) => TResult | Promise<TResult>;
};

type SignalOutcome<T extends SignalContract> =
  SignalOutcomeValue<T> & {
    match<TResult>(
      handlers: SignalOutcomeMatcher<T, TResult>,
    ): Promise<TResult>;
  };

interface SignalDecision<T extends SignalContract> {
  (): Promise<SignalOutcome<T>>;
  readonly signal: SignalReference<T>;
}

type SignalActionResult<
  T extends SignalContract,
  Action extends SignalActionName<T>,
> =
  | {
      readonly status: "resolved";
      readonly outcome: Extract<
        SignalOutcomeValue<T>,
        { status: "resolved"; action: Action }
      >;
      readonly receipt: AuthorizationReceiptReference;
    }
  | {
      readonly status: "alreadyResolved";
      readonly signal: SignalReference<T>;
      readonly terminalStatus: "resolved" | "expired";
      readonly terminalAt: string;
    };
```

`match()` is exhaustive over every declared action and `expired`; omitting or confusing an action's
payload fails type checking. Callers may instead narrow directly on `status` and then `action`.

v0.7 signals are strictly one-shot terminal decisions. Exactly one declared action or expiry wins the
`Pending` compare-and-swap. Event or SSE replay rehydrates the same pending, resolved, or expired
capability identity. The winning invocation and an exact idempotent replay return `status: "resolved"`
with the action-correlated outcome and same receipt. Any other invocation after the terminal transition
returns a redacted `status: "alreadyResolved"` summary without altering the decision.

The losing caller learns only that the issuance is terminal, whether it resolved or expired, and when.
It does not receive the winning action name, input, actor, or authorization receipt. The issuing
workflow's `decision()` receives the complete outcome. A future public full-resolution read would
require a separately declared and authorized canonical operation; v0.7 does not infer that authority
from issuance read or action permission. Event retention may outlive signal expiry, but an expired
reference remains inert.
Multi-use capabilities require independently designed completion, aggregation, concurrency, replay,
and wait semantics and are deferred beyond v0.7.

## Trigger admission and checkpoint ordering

The following ordering is normative:

- ordinary events checkpoint only after successful handler completion;
- workflow-wrapped events checkpoint only after durable workflow admission is recorded;
- duplicate event delivery reattaches to the same derived workflow identity;
- accepted HTTP responses return only after durable admission;
- bounded HTTP await observes an admitted run without converting a request into workflow history;
- emitted signals become observable only after the canonical pending instance, access records,
  immutable issuance event, and outbox row commit in one `SignalStore` transaction under the same
  replay-stable occurrence;
- workflow-history receipt recording, broker publication, and workflow resumption remain outside that
  local transaction and converge through idempotent retry and reattachment;
- resource reconciliation may start and track a named workflow, but every status projection occurs
  through a fresh level-triggered reconcile;
- schedules derive identity from the admitted tick; and
- batches checkpoint only after successful whole-batch completion or durable admission of the frozen
  batch.

## Construct shapes

### HTTP

HTTP remains a registrar with final request closure:

```ts
const api = app.http("public-api", {
  namespace,
  replicas: 2,
});

api.post(
  "create-post",
  "/posts",
  {
    input: CreatePostInput,
    output: CreatePostOutput,
    authorize: canCreatePost,
  },
  async (request, context) => Post.create({
    ...request.input,
    authorId: context.principal.id,
  }),
);
```

Dependencies, captures, provider requirements, permissions, and callable handles are inferred where
provable. Manual declarations remain fail-closed escape hatches.

The compiler is the sole deployment authority for this surface. `app.http`
contributes typed route semantics to the Application graph but emits no raw
source ConfigMap, provisional `app.server` Deployment, or parallel request
runtime. Compilation produces one OCI worker and its Service/Deployment
resources. At execution, the boundary authenticates through the selected
`IdentityProvider`, pins the admitted principal to the exact compiled operation
catalog, derives opaque relational change scopes from server-held authority,
requires a context-scoped `Idempotency-Key`, validates input and output, and
enters the same durable PostgreSQL command kernel used by event, batch,
workflow, lifecycle, and agent execution. Retried authorization evaluations
may have new receipt identities and timestamps; durable adoption compares
their security evidence and revalidates the current receipt before commit.

Durable HTTP behavior remains ordinary explicit code. An accepted mutation starts a named workflow and
returns its admitted reference:

```ts
api.post(
  "create-post-accepted",
  "/posts/async",
  acceptedContract,
  async request => {
    const run = await CreatePost.start(request.input);
    return http.accepted(run.reference);
  },
);
```

A bounded synchronous attempt calls the same workflow handle directly:

```ts
api.post(
  "create-post-bounded",
  "/posts/wait",
  boundedContract,
  async request => CreatePost(request.input, {
    timeout: "10s",
  }),
);
```

The timeout bounds result observation; it does not cancel the admitted workflow. Expiry raises a typed
`WorkflowResultTimeout` carrying the run reference. A route that wants a `202 Accepted` fallback catches
that value explicitly and returns `http.accepted(error.run)`.

The route closure itself is never workflow-wrapped. Only normalized, schema-validated durable values
may cross into workflow input. The compiler rejects capture or passage of the raw request, response,
socket, body stream, cookies or headers container, abort controller, and HTTP context. Selected scalar
metadata may be mapped explicitly through a declared schema; large or streaming bodies become typed
artifact/object references. The authenticated principal and trusted context travel as admitted
invocation metadata rather than client-controlled workflow input.

v0.7 also supplies a minimal typed server-to-client streaming contract for AI and equivalent streaming
responses:

- typed chunks;
- bounded buffering and backpressure;
- cancellation and disconnect propagation;
- authorization revalidation;
- separately recorded final result; and
- no claim that delivered chunks are durable workflow history.

General WebSockets and arbitrary bidirectional protocols remain out of scope.

### One-shot queries

A query executes once against an authorized snapshot:

```ts
export const TimelineSnapshot = Post.query(
  {
    input: TimelineInput,
    output: TimelineOutput,
  },
  async input => Post
    .where(post => post.authorId.in(input.followedAuthorIds))
    .orderBy(post => post.publishedAt.desc())
    .limit(input.limit)
    .all(),
)
  .authorize(canReadTimeline)
  .reads(Post, Follow)
  .budget({ timeout: "2s", maxRows: 100 });

const page = await TimelineSnapshot(input);
```

Input/output contracts required to type the implementation appear before it. Optional policies may be
attached fluently. `app.query(...)` remains the cross-model/application form.

### Persistent live views

A view is a restartable invalidation-aware observation contract over a query. It is persistent in the
sense of snapshot, cursor, subscription, authorization revalidation, reset, and resume. It is not
persisted derived storage.

```ts
export const Timeline = Post.view(
  {
    input: TimelineInput,
    output: TimelineOutput,
    invalidatesOn: [Post, Follow],
  },
  async (input, context) => {
    // Authorized query implementation.
  },
);

const snapshot = await Timeline(input);
const subscription = Timeline.subscribe(input, {
  after: snapshot.cursor,
  signal,
});
```

Function-native invocation returns the initial `ViewSnapshot<TOutput>`:

```ts
interface ViewSnapshot<TOutput> {
  readonly value: TOutput;
  readonly cursor: ViewCursor;
  readonly observedAt: string;
  readonly authorizationRevision: string;
}
```

`Timeline.snapshot(input)` is retained as the explicit equivalent of `Timeline(input)`. Passing the
returned cursor to `subscribe` closes the snapshot-to-subscription gap. Calling `subscribe` without an
`after` cursor establishes its own atomic initial snapshot and delivers that snapshot as the first
observation rather than racing a separate query.

TanStack integration may expose `useView(Timeline, input)` while retaining the same query/view gateway,
cursor, authorization, and reset semantics.

The normalized model may represent a view as a query plus live-observation metadata. `Query.view(...)`
may expose that composition directly; `Model.view(...)` may remain concise combined authoring.

Kubernetes-backed models use the same outer contract. Their `select` block deliberately retains the
bounded selector and pagination semantics of the Kubernetes authority rather than inventing a false
provider-neutral query language:

```ts
export const PublishedEntries = GuestBookEntry.view(
  {
    input: type({ guestbook: "string", "limit?": "number" }),
    output: PublishedGuestBookEntry.array(),
    authorize: ({ principal, context, input }) =>
      principal.id.length > 0 && context.guestbook === input.guestbook,
    select: {
      namespace: (_input, { context }) => String(context.namespace),
      labelSelector: input => `guestbook.applik8s.dev/book=${input.guestbook}`,
      where: entry => entry.status?.phase === "Published",
      orderBy: (left, right) =>
        String(right.metadata.creationTimestamp ?? "")
          .localeCompare(String(left.metadata.creationTimestamp ?? "")),
      limit: input => input.limit ?? 20,
      bounds: { pageSize: 250, maxPages: 20, maxItems: 5_000 },
    },
  },
  function published(entry) {
    return {
      id: entry.metadata.name,
      author: entry.spec.author,
      message: entry.spec.message,
      publishedAt: entry.status?.publishedAt ?? entry.metadata.creationTimestamp ?? "",
    };
  },
);
```

The compiler lowers this contract to a bounded Kubernetes list/watch authority. Selection callbacks
receive model-native values and inputs in both generated gateway implementations; the compatibility
`kubernetes: { ... }` request-object form remains available for migration and advanced integrations.

### Persisted projections

A projection materializes derived state. It is not a query and is not invoked by application code.

```ts
export const HomeTimeline = PostPublished.project(
  TimelinePost,
  (event, output) => output.upsert({
    partition: event.authorId,
    key: event.postId,
    score: Date.parse(event.publishedAt),
    value: {
      id: event.postId,
      authorId: event.authorId,
      body: event.body,
    },
  }),
).retain({
    maxItemsPerPartition: 1_000,
    maxAge: "30d",
  });
```

Analytical append:

```ts
export const PostAnalytics = PostPublished.project(
  PostAnalyticsRow,
  (event, output) => output.append({
    eventId: output.sourceId,
    authorId: event.authorId,
    hour: event.publishedAt.slice(0, 13),
    posts: 1,
  }),
);
```

The source type comes from the stream. The output schema precedes and types the transformation.
The output model's typed assembly binding selects the compatible provider; returned descriptor type
constrains compatible providers and fluent policies. The projection never names infrastructure.

The second argument is a deliberately narrow write scope rather than a general execution context:

```ts
interface ProjectionWriteScope<TValue> {
  readonly sourceId: string;
  readonly sequence: string;
  readonly recordedAt: string;
  readonly sourcePartition?: string;

  upsert(input: KeyedProjectionWrite<TValue>): ProjectionWrite<TValue>;
  remove(input: ProjectionKey): ProjectionWrite<TValue>;
  append(value: TValue): ProjectionWrite<TValue>;
  skip(): ProjectionWrite<TValue>;
}
```

It exposes only causal source metadata and pure descriptor constructors. Capability retention is
declared once by a capability-bearing output-model field; assigning an inert source reference cannot
invoke or hydrate it. The scope does not grow provider, logger, clock, network, or application-handle
capabilities.

The transformation:

- is synchronous and deterministic;
- rejects promises, handles, providers, ambient I/O, clocks, and nondeterminism;
- accepts inert capability references only as immutable source data and permits persistence solely
  through an explicit bounded capability-bearing output field;
- returns `upsert`, `remove`, `append`, `skip`, or bounded fan-out descriptors;
- runs once per logical source value during both live processing and rebuild; and
- permits the runtime to batch provider writes without changing logical semantics.

`Stream.project(...)` is the golden path. Generic `app.projection(...)` remains advanced support for
genuinely multi-source/application derivation.

#### Rebuild authority

Live processing and rebuilding use the same source-to-write transformation, but a projection must
declare where rebuild input comes from. The declaration is explicit because an event log and an
authoritative model snapshot have different retention, deletion, ordering, and catch-up semantics.

Replay from a retained source stream is concise:

```ts
export const HomeTimeline = PostPublished.project(
  TimelinePost,
  (event, output) => output.upsert(/* ... */),
)
  .rebuildFromReplay();
```

When the stream is not retained for the full rebuild horizon, the author declares an authoritative
snapshot source and a pure mapper into the projection's live source type:

```ts
export const HomeTimeline = PostPublished.project(
  TimelinePost,
  (event, output) => output.upsert(/* ... */),
)
  .rebuildFrom(
    Post.where(post => post.state.eq("published")),
    post => ({
      postId: post.id,
      authorId: post.authorId,
      body: post.body,
      publishedAt: post.publishedAt,
    }),
  );
```

The typed selector is the preferred filtering boundary because compatible providers can push it into
the authoritative snapshot query and plan indexes, pagination, cardinality, and authorization. For a
pure condition that cannot be expressed by the selector vocabulary, the mapper receives a restricted
descriptor scope:

```ts
HomeTimeline.rebuildFrom(
  Post,
  (post, rebuild) =>
    canReconstructPublishedSource(post)
      ? rebuild.source({
          postId: post.id,
          authorId: post.authorId,
          body: post.body,
          publishedAt: post.publishedAt,
        })
      : rebuild.skip(),
);
```

`rebuild.source(value)` and `rebuild.skip()` are pure descriptors. Returning `undefined`, filtering
through ambient reads, or writing the projection directly is rejected.

The mapper is separate from the projection transformation because it crosses an authority and type
boundary. It is synchronous, pure, compiler-inspectable, and must produce the same normalized source
type that live delivery provides. It cannot write the projection directly.

Snapshot reconstruction is valid only when current authoritative state is sufficient to reproduce the
desired converged logical source set. Filtering cannot recover historical information that the model
does not retain. An event containing overwritten values, repeated transitions, deleted-row history,
historical ordering, prior actor/context evidence, or other irrecoverable facts must use retained replay
or another authoritative history source. Append-oriented historical projections require replay unless
their complete fact set is independently authoritative and enumerable.

Calling `rebuildFrom(...)` is an explicit author assertion that the selected snapshot is sufficient for
that projection; `plan` and review evidence expose the assertion rather than presenting it as compiler
proof.

`await HomeTimeline.rebuild()` requests a framework-owned rebuild generation; it does not run the
mapper in the caller. The runtime:

- records whether replay or an authoritative snapshot is the rebuild authority;
- establishes a snapshot frontier and catches up committed changes before cutover;
- derives deterministic source identities from model identity and snapshot generation;
- accounts for deletion or source absence rather than silently retaining stale projection rows;
- supplies declared relationship hydration without ambient database access;
- isolates generations until successful publication; and
- proves that equivalent logical sources produce equivalent live and rebuilt writes.

If neither retained replay nor an authoritative snapshot mapper is declared, rebuild is unsupported
and `plan` reports that limitation. The graph and plan record the selected snapshot predicate, mapper,
declared sufficiency assertion, and any inability to prove pushdown. The framework does not guess a
rebuild source or claim that a current snapshot recreates lost history.

Projection lifecycle remains framework-owned. Committed lifecycle streams may include rebuilt,
rebuild-failed, generation-published, degraded, and recovered without permitting callbacks to control
checkpoint or cutover internals.

### Model-authoritative changes

Named domain behavior remains ordinary TypeScript. The model API marks only the transaction boundary:

```ts
export async function publishPost(
  input: typeof PublishPostInput.infer,
) {
  return Post.edit(input.postId, async post => {
    const publishedAt = Clock.now();

    await post.update({
      state: "published",
      publishedAt,
    });

    PostPublished.emit({
      postId: post.id,
      authorId: post.authorId,
      revision: post.revision,
      publishedAt,
    });

    return post.value;
  });
}
```

An HTTP route, agent tool, workflow step, event registration, or explicit public exposure can admit and
authorize `publishPost`; defining the function alone does not expose it. There is no parallel
`Post.operation()` registry. A transaction closure cannot be workflow-wrapped or suspend while holding
authoritative locks. Before-commit policy remains effect-restricted and synchronous with the
authoritative transaction.

When an ordinary function is deliberately exposed as an agent tool, its
exported module-plus-symbol identity is the operation identity. The compiler
derives its input/output schemas from the typed function signature, decorates
that same function before `identity.can(publishPost)` or
`tools: [publishPost]` is evaluated, and injects its recursively reached model
and event handles into the generated worker. AI inference never holds the
model transaction open. Only the selected tool invocation enters the ordinary
function-native transaction kernel, using the provider tool call's
retry-stable durable identity and the canonical execution principal and
authorization receipt. Two modules may export the same symbol name without
colliding; a private helper is not silently promoted into a public operation.

Inside committed model-lifecycle handlers, an awaited direct model operation joins the source
event's compiler-owned PostgreSQL transaction when both models share one database authority. It
returns the operation's ordinary typed snapshot immediately, but that snapshot is provisional until
the lifecycle callback completes. A later exception, policy rejection, deadlock retry, or processor
failure rolls back the nested result, model writes, durable command result, history, transitions, and
outboxes together. The compiler assigns deterministic nested-command identities, deduplicates local
aliases of the same operation, and rejects cross-database or cross-provider composition with guidance
to use a workflow or a post-commit event boundary.

Direct `Event.emit(payload)` remains atomic outbox staging inside an explicit `Model.edit(...)`
transaction. `context.send(...)` remains the explicit post-commit asynchronous command boundary; it
does not pretend to return the destination operation result.

The canonical lifecycle form is therefore ordinary awaited TypeScript:

```ts
async function createOwningMembership(event: ModelEvent<typeof Workspace, "create">) {
  const membership = await Membership.create({
    id: `${event.identity}:owner`,
    workspaceId: event.identity,
    principalId: event.value.ownerPrincipalId,
    role: "owner",
  });

  return membership.value;
}

Workspace.on.create(createOwningMembership);
```

Calling a direct model operation without `await` fails during application discovery: silently
discarding a provisional result makes rollback intent unclear and looks indistinguishable from an
accidental promise leak. Asynchronous delivery is explicit:

```ts
async function publishPost(event: ModelEvent<typeof Post, "create">, context: EventContext) {
  context.send(NotifyFollowers, {
    postId: event.identity,
  }, {
    targetKey: event.value.authorId,
  });
}

Post.on.create(publishPost);
```

Before-commit policy callbacks are intentionally narrower than committed lifecycle handlers. They
may mutate or reject the currently locked aggregate and stage its declared events, but may not await
another model operation. That keeps policy evaluation local and prevents an authorization rule from
quietly growing into distributed orchestration.

Explicit transaction code continues to stage ordinary events:

```ts
PostPublished.emit({
  postId: post.id,
  revision: post.revision,
});
```

Conventional CRUD `beforeCommit` callbacks remain ordinary policy closures. Throwing an ordinary error
from one produces a framework-owned, durable `policyRejected` outcome, rolls back every staged model,
history, transition, event, and command write, and acknowledges the broker message without redelivery.
The framework—not each application—distinguishes that expected application decision from PostgreSQL
serialization, deadlock, and concurrent-modification failures, which retry from the clean transaction
boundary. This distinction is part of the generated create/update/delete contract and requires no
authored error registry or retry classifier.

Committed model lifecycle is registered through typed create, update, and delete facts. Exported
symbols supply local handler identity:

```ts
export const moderateNewPost = Post.on.create(moderatePost);
export const reindexPost = Post.on.update(reindexPostSearch);
export const retirePost = Post.on.delete(removePostArtifacts);

// Add deployment policy only when it differs from the application default.
export const fanOutPost = Post.on.create({ concurrency: 20 }, fanOutPublishedPost);
```

These are observed committed facts, unlike the model's callable CRUD methods and unlike Kubernetes
watch predicates.

### Events and microbatches

Single-event delivery:

```ts
export const observeSource = ObservationRequested.onEvent(
  {
    concurrency: 20,
    retries: 5,
    deadLetter: true,
  },
  async event => ObserveSource({
    requestId: event.requestId,
    sourceId: event.sourceId,
  }),
);
```

Consumer microbatching:

```ts
export const indexPosts = PostPublished.onBatch(
  {
    batch: {
      maxItems: 500,
      maxBytes: "4MiB",
      maxWait: "1s",
    },
    ordering: "partition",
    concurrency: 8,
    acknowledgement: "wholeBatch",
  },
  async batch => BulkIndex(
    {
      posts: batch.events.map(event => event.value),
    },
    {
      idempotencyKey: batch.id,
    },
  ),
);
```

```ts
interface EventBatch<T> {
  readonly id: string;
  readonly events: readonly EventEnvelope<T>[];
  readonly partition?: string;
  readonly firstSequence: string;
  readonly lastSequence: string;
}
```

Batch membership freezes and is durably recorded before handler execution. Ordered batches do not
cross partitions. Providers may deliver smaller batches. A stable batch identity is derived from the
consumer, stream, partition, and exact ordered membership. Every retry observes the same manifest.

The initial contract supports only `acknowledgement: "wholeBatch"`; it is the default when omitted:

- the checkpoint advances only after the handler succeeds or the exact frozen batch is durably
  admitted to a workflow;
- a failure retries or dead-letters the whole frozen batch;
- downstream effects must use `batch.id` and item identity for idempotency; and
- effects completed before a later failure may be observed and repeated during retry.

This is not an external transaction across arbitrary databases, APIs, or brokers. Applik8s guarantees
stable membership and acknowledgement ordering, not rollback of already committed side effects.
Partial acknowledgement and per-item retry require a future explicit contract.

A public `failure: "atomic"` option is intentionally omitted because that name would overstate the
contract. A transactionally produced source array remains one ordinary event. Stateful windows, joins,
lateness, and aggregation remain projection/dataflow semantics rather than delivery batching.

### Kubernetes resource proxies

The current proxy-first surface remains:

```ts
ImageJob.on.reconcile(async job => {
  job.finalizers.add("media.applik8s.dev/imagejob");
  job.status.phase = "Processing";
  job.apply(job.k8s.ConfigMap(/* ... */));
  job.events.normal("ImageJobComplete", "Processing completed");
});

ImageJob.on.finalize(
  async job => {
    job.delete(job.k8s.ConfigMap(/* ... */));
    job.finalizers.remove("media.applik8s.dev/imagejob");
  },
  {
    finalizer: "media.applik8s.dev/imagejob",
  },
);
```

Resource behavior stays separate from operator placement:

```ts
sdk.operator({
  name: "image-operator",
  deployment: { namespace: "media" },
  resources: { ImageJob },
  secondaryWatches: [/* ... */],
  handlers: [
    ImageJob.on.reconcile(reconcileImage),
    ImageJob.on.finalize(finalizeImage, finalizerOptions),
  ],
});
```

The operator owns deployment, replicas, reads, permissions, secondary watches, mapped watches, and
resource registration. These do not move into each resource closure.

Created, updated, deleted, status-changed, reconcile, and finalize proxy registrations remain
available, but documentation identifies Kubernetes observations as level-triggered predicates, not a
lossless event log. Durable downstream work is emitted as a committed application event and consumed
through `onEvent` or `onBatch`.

Resource proxies are invocation-scoped and may not cross a workflow suspension boundary. A proxy can
contain a live Kubernetes read, optimistic-concurrency token, effect buffer, and field-ownership
context; persisting it into workflow history would make all four stale. The compiler therefore rejects
wrapping `reconcile` or `finalize` itself as a workflow.

A reconcile starts a named workflow and tracks its provider-neutral execution instead:

```ts
ImageJob.on.reconcile(async job => {
  const run = await ProcessImage.start(
    {
      jobId: job.metadata.uid,
      source: job.spec.source,
    },
    {
      idempotencyKey: `${job.metadata.uid}:${job.metadata.generation}`,
    },
  );

  const process = await job.track("process-image", run, {
    onDelete: {
      action: "cancel",
      timeout: "2m",
      onTimeout: "detach",
    },
    onGenerationChange: "supersede",
    updates: {
      phases: true,
      progress: true,
      minInterval: "5s",
    },
  });

  job.status.observedGeneration = job.metadata.generation;
  job.status.process = {
    reference: process.reference,
    revision: process.workflowRevision,
    phase: process.phase,
    progress: process.progress,
    result: process.result,
    error: process.error,
  };
});
```

The explicit tracking key is stable application identity for the relationship and permits one resource
to track multiple runs without relying on source formatting or status-property inference.

`job.track()` does not wait for the workflow and does not give the workflow a Kubernetes proxy. It:

- records the exact resource UID, generation, workflow definition, run reference, and lifecycle policy;
- returns the current observation immediately;
- schedules a bounded exact-resource resync until the tracked run is terminal;
- allows a provider bridge to enqueue that exact resource promptly when workflow phase, progress, or
  terminal state changes;
- projects observations into CRD status only through a fresh Kubernetes read and reconcile; and
- reattaches to the same run under reconcile retry.

#### Tracking persistence authority

For an Applik8s-owned CRD, the canonical resource/run relationship is a generated, framework-managed
status field:

```yaml
status:
  applik8s:
    trackedExecutions:
      process-image:
        resourceGeneration: 7
        workflow: process-image
        workflowRevision: sha256:abc123
        run: run_123
        phase: Running
        onGenerationChange: supersede
```

This status field is written through the same authoritative resource-proxy status effect as domain
status. It does not introduce a second field manager, annotation protocol, tracking CR, or opaque
runtime database. The generated CRD schema reserves and types the `status.applik8s` subtree; application
status code cannot write that reserved subtree directly.

The relationship becomes canonical only when the status write succeeds. If workflow admission succeeds
but the Kubernetes write fails, the reconcile retries the same idempotent start, receives the same run,
and records it. Workflow events that occur before the relationship is recorded may delay observation
but cannot lose correctness because bounded resource resync observes the run afterward.

Bounded exact-resource resync is the v0.7 correctness mechanism and requires
no private operator-to-provider subscription protocol. A provider may
maintain an in-memory workflow-run-to-resource projection from ordinary
list/watch state and use it to enqueue prompt reconciles, but that bridge is an
optimization, not authority or a release prerequisite. Operator restart needs
only the canonical CR status; the next bounded resync reattaches to the
persisted run. Missed, reordered, or coalesced workflow notifications therefore
cannot lose a terminal observation.

`job.track()` is initially available only where Applik8s owns or can safely augment the resource status
schema. Tracking an externally owned CRD without a declared compatible status binding fails closed.
A companion tracking CR may be considered later for external resources, but it is not an alternative
source of truth in this contract.

The provider-neutral observation contract is:

```ts
interface ExecutionObservation<TResult, TProgress = unknown> {
  readonly reference: WorkflowReference<TResult>;
  readonly workflowRevision: string;
  readonly phase:
    | "Admitted"
    | "Running"
    | "Succeeded"
    | "Failed"
    | "Cancelled"
    | "TimedOut";
  readonly progress?: TProgress;
  readonly result?: TResult;
  readonly error?: ExecutionFailure;
  readonly admittedAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
}
```

Providers may use a push bridge to enqueue prompt reconciles. Bounded resync
continues until terminal state and is the delivery guarantee. Progress updates
are optional, coalesced, and rate-limited by the declared minimum interval.
Sensitive or large results remain artifact references rather than being copied
into status.

Lifecycle is explicit:

- `onDelete: "detach"` records no tracking finalizer and allows the run to continue under workflow
  retention after resource deletion;
- `onDelete: { action: "cancel", timeout, onTimeout }` automatically manages a framework-owned tracking
  finalizer, requests idempotent cancellation, and removes the finalizer after terminal cancellation;
- `onTimeout: "detach" | "block"` is required for cancellation: `detach` records an orphan/detachment
  outcome and permits deletion, while `block` intentionally retains the finalizer and produces a
  prominent lifecycle warning;
- `onGenerationChange: "supersede" | "cancel"` controls replacement;
- `"supersede"` starts the new generation and marks the prior observation superseded without assuming
  provider cancellation or hiding that the old run remains governed by
  workflow retention;
- `"cancel"` starts the new generation, requests idempotent cancellation of
  the prior run by its persisted reference, and records that request in the
  bounded superseded summary; and
- status projection records `observedGeneration` so stale workflow observations cannot make a newer
  resource generation ready.

`"finish"` is intentionally not exposed with the start-then-track API: by the
time `track()` sees the policy, the new run has already been admitted, so
pretending to wait for the prior generation would strand or cancel an admitted
run. A future finish-before-replace policy would require a resource-aware
admission primitive, not a misleading tracking option.

An active relationship remains in canonical status until its terminal observation is projected. It may
then be compacted into a bounded terminal summary according to declared retention. Deleting the CR
deletes its canonical Kubernetes relationship, but not workflow history, authorization receipts, or
audit records governed by their own retention policies.

Operator uninstall performs a fail-closed preflight for active framework tracking finalizers. It must
either finish their declared cancellation policy or require an explicit orphan/detach decision before
removing the controller. Reinstalling the operator against retained CRs rebuilds the tracking index from
status.

Admission continues to derive from ArkType schemas, resource ownership, operation authority, and
immutable-field policy. This RFP does not add custom admission closures. A future demonstrated need
requires a separate effect-restricted admission proxy rather than overloading reconciliation.

### Schedules and low-level workloads

Application schedules invoke closures or callable handles:

```ts
export const dailyTimelineRebuild = schedule(
  {
    cron: "0 3 * * *",
    concurrency: "forbid",
  },
  workflow(async tick => RebuildTimeline({
    generation: tick.scheduledAt,
  })),
);
```

Low-level generated container workloads remain under:

```ts
app.workload.job(...);
app.workload.cronJob(...);
```

They do not share workflow or application-schedule vocabulary.

### Effect progress and bounded fan-out

A registered event, schedule, agent, route, or workflow-step closure may report:

```ts
context.heartbeat(progress);
context.reportProgress(progress);
```

Heartbeat is execution liveness. Progress is typed observation. These methods do not turn an ordinary
function into a public `task`; retry and idempotency belong to the registration or durable step that
owns the closure.

Durable orchestration must define deterministic bounded concurrency. Large fan-out uses a bounded
durable map rather than unbounded `Promise.all` history:

```ts
await context.map(
  "process-items",
  items,
  {
    concurrency: 20,
    key: item => item.id,
  },
  item => ProcessItem(item),
);
```

### Agents and streaming

Agents remain callable handles. Existing application handles are AI tools without another business
closure.

Non-streaming agent orchestration may be durable. Streaming chunks are typed, bounded, cancellable,
and authorization-aware, but already delivered chunks are not replayed as workflow effects. Durable
attempt identity and final result remain distinct from client token delivery.

### MCP

Existing handles are exposed directly:

```ts
mcp.expose(SearchObservations);
```

A custom MCP tool uses a final closure only when it represents genuinely custom behavior. MCP
transport admission cannot bypass the underlying operation receipt or authorization.

### Subscriptions and lifecycle facts

Subscriptions remain declarative. Transformations are projections; backend causal work is an event or
batch handler.

Only committed terminal lifecycle facts become application streams:

```ts
ImportWorkflow.events.completed.onEvent(/* ... */);
ImportWorkflow.events.failed.onBatch(/* ... */);
ImportWorkflow.events.cancelled.project(/* ... */);
```

- workflows and agents may expose completed, failed, cancelled, and timed-out streams;
- admitted model changes may expose completed and rejected streams;
- projections expose their declared rebuild/degradation lifecycle;
- queries, views, and HTTP requests do not automatically become business-event sources; and
- started, retrying, attempt, and heartbeat remain operations telemetry.

## Public API consistency matrix

| Construct | Golden-path form | Durable behavior |
| --- | --- | --- |
| Ordinary helper | Normal TypeScript function | None |
| HTTP route | `http.post(name, path, options, handler)` | Ordinary route explicitly starts or awaits workflow handle |
| Model | `model(name, fields)` plus typed assembly binding | Provider-native authority selected outside domain code |
| One-shot query | `export const Query = Model.query(contract, async implementation)` | No |
| Persistent view | `export const View = Model.view(contract, async implementation)` | Callable snapshot plus live observation, not workflow |
| Model change | Ordinary function containing `Model.edit(key, transactionClosure)` | Transaction-authoritative |
| Before commit | Existing typed transaction policy | No |
| Model lifecycle | `export const Name = Model.on.create/update/delete(...)` | May wrap workflow |
| Event | `export const Name = Stream.onEvent(options?, handler)` | May wrap workflow |
| Batch | `export const Name = Stream.onBatch(options, handler)` | May wrap frozen batch |
| Reconcile/finalize | Existing resource proxy closure | Start and track named workflow; proxy is never durable |
| Projection | `export const Name = Stream.project(OutputModel, transform)` | Pure, not workflow |
| Schedule | `export const Name = schedule(options, handler)` | May wrap workflow |
| Workflow step | `context.step(name, closure)` | Durable effect boundary inside workflow |
| Named workflow | `export const Name = workflow(id, contract, handler)` or `workflow(id, contract, options, handler)` | Direct call awaits result; `.start()` returns admitted run |
| Inline durable wrapper | `workflow(handler)` or `workflow(options, handler)` at a supported registration | Makes that registered closure durable |
| Signal | `workflow.emitSignal(Contract, options)` then `await decision()` | Canonical stored issuance event plus callable one-shot durable decision |
| Agent | `app.agent(name, options, handler)` | Durable non-streaming orchestration |
| MCP tool | Existing handle or custom tool closure | Underlying handle semantics |
| Subscription | Declarative stream/view subscription | Not workflow |
| Raw workload | `app.workload.job/cronJob(...)` | Kubernetes workload semantics |

## ApplicationGraph and compiler requirements

The public source must lower to a complete declarative graph containing:

- execution family and source location;
- ordinary versus durable mode;
- stable definition and code revision;
- trigger, causation, admission, checkpoint, and occurrence identity;
- callable dependencies and call sites;
- complete input and target provenance;
- maximum and concrete authority provenance;
- provider, transport, placement, RBAC, and context-capability requirements;
- batch bounds, frozen membership identity, and whole-batch acknowledgement boundary;
- query versus live-view versus persisted-projection semantics;
- projection source/write descriptor, rebuild authority/frontier/predicate/mapper, snapshot-sufficiency
  assertion, and purity evidence;
- workflow steps, call/admission mode, signals, revisions, and retained runtime artifacts;
- signal input/action contract, canonical primary-transactional-database signal subsystem,
  replay-stable issue occurrence, immutable issuance event and outbox identity, callable one-shot
  decision, canonical issue/issuance-read/action operations, `authorize` selectors or `grantAccessTo`
  subjects and exact read/action grants, framework-derived actor/receipt envelope, target, expiry,
  terminal-state transaction, action-correlated/redacted method results, server/client/projection
  decoding, and any explicitly bounded capability-bearing projection output;
- tracked resource/run relationships, stable tracking keys, canonical CR-status representation,
  lifecycle/finalizer policy, rebuildable index, and status-observation mappings;
- lifecycle event versus operations telemetry classification; and
- compatibility aliases.

Generated runtime source binds handles to the admitted runtime without exposing credentials or ambient
clients. Compiler output is deterministic across equivalent normalized source trees. Formatting-only
changes do not change operation, workflow, step, signal, batch, projection, or binding identity.

## Plan, explain, and operations UI

For each managed execution, `plan` and `explain` show:

- execution family, trigger, handler/implementation, runtime, and placement;
- ordinary, whole-handler, or durable-step retry boundary;
- reachable handles and local helper calls;
- inferred or explicit maximum authority;
- concrete input and target provenance;
- provider and RBAC requirements;
- idempotency, timeout, checkpoint, batch, and cancellation policy;
- workflow key, revision, direct-await versus start semantics, steps, emitted signal events, callable
  decisions, canonical primary database signal subsystem, local transaction boundary,
  issue/read/action operations,
  `authorize` versus `grantAccessTo`, exact issuance visibility, framework-derived actors, grants,
  terminal states, action-result redaction, execution-family decoding, capability-bearing projection
  retention, and retained artifacts;
- query/view/projection distinction, dependencies, projection rebuild authority, predicate, and
  snapshot-sufficiency assertion;
- tracked resource/run relationship, canonical status location, requeue/index policy, observation
  mapping, finalizer deadline/orphan policy, and generation lifecycle;
- unresolved inference failures; and
- deployment and authority diff from the prior graph.

Operations UI distinguishes delivery attempts, frozen batches, workflow runs, steps, signal issue
operations and receipts, pending/resolved/expired canonical state, outbox/broker delivery, exact
issuance reads, callable decision waits, action consumption, workflow wake/reattachment, direct calls,
local helpers, projection convergence, view subscriptions, and Kubernetes reconciliation.

## Compatibility and migration

| Existing form | New golden path |
| --- | --- |
| `app.task(...)` / `context.tasks.name(input)` | Ordinary closure at its event/route registration or `context.step(name, closure)` inside a workflow |
| `context.operations.name(input)` | Appropriate registered handle call |
| `context.queries.name(input)` | `QueryHandle(input)` |
| dependency alias maps | Compiler-inferred direct calls |
| `.onInput/.onEvent/.onResource` input binders | Complete direct input with inferred provenance |
| `Stream.process(...)` | `Stream.onEvent(...)` |
| no batch processor | `Stream.onBatch(...)` |
| query/view `{ run() {} }` | Async implementation argument |
| split projection callbacks | One synchronous `(event, output)` transformation |
| workflow-engine signal addressing | Static signal event contract plus `workflow.emitSignal(...)` |
| workflow-wrapped resource proxy | Ordinary reconcile starts and tracks a named workflow |
| raw `app.job` | `app.workload.job` |
| raw CronJob-shaped `app.schedule` | `app.workload.cronJob` |

Existing resource-proxy registrations are retained rather than migrated to named option-heavy handler
forms.

Migration requires deprecation annotations, precise diagnostics, bounded codemods where mechanical,
graph-equivalence tests, and release notes for intentionally manual changes. No migration may silently
change retry, checkpoint, ordering, authority, signal, projection, or transaction semantics.

## Charter and sibling-RFP amendments

The charter document map and shared-contract table are amended alongside this RFP to assign:

- public execution grammar, frozen-batch acknowledgement, projection authoring/rebuild declaration,
  serializable-signal authoring, canonical `SignalStore` transaction/recovery protocol, and Kubernetes
  resource/run tracking to this RFP;
- signal issue, exact issuance-read and action operations, grants, receipts, actor derivation, and
  enforcement to operation authority;
- projection frontier, cutover, storage, and convergence correctness to the search/projection RFP;
- workflow history and run execution to workflow providers; and
- provider-specific batch transport to event providers.

This revision also amends the charter's normative invocation principles, the profiles-and-Starts RFP,
the Start distribution, the operation-authority RFP, and the AI runtime RFP so:

- managed closures call statically reachable imported handles directly while runtime adapters retain
  only an internal invocation primitive;
- signal persistence is a non-selectable subsystem of the primary transactional database rather than
  another profile capability;
- Start hydrates signal capabilities through the ordinary authenticated, resumable event/SSE codec;
  and
- AI approval presentation consumes the same static signal-event contract without becoming approval
  authority.

Remaining implementation work and sibling-document amendments must:

1. keep workflow, projection, and transaction-model examples on the implemented direct-call surface;
2. adapt existing handles in MCP rather than create alternate invocation authority;
3. adopt synchronous source-to-write projection semantics and explicit replay or
   authoritative-snapshot rebuild sources in the search/projection RFP;
4. define direct-call versus `.start()` admission, revisions, idempotent signal issue receipts,
   reattachable decision waits, canonical CR-status tracking observations, and old-run retention in
   workflow documentation;
5. define frozen `onBatch` membership, whole-batch acknowledgement, and ordering contracts in reactive
   documentation; and
6. preserve typed input, framework-derived actor, principal, receipt, target, idempotency, audit,
   replay, provider, and capability-boundary enforcement.

## Implementation sequence

### Phase 1: Callable handles and inference

- make models, queries, workflows, and agents directly callable while capturing ordinary registered
  closures without a task or operation wrapper;
- preserve handle metadata and specialized methods;
- discover calls through included local modules;
- lower to existing runtimes and normalized bindings;
- add fail-closed diagnostics and explain provenance; and
- prove there is no ambient authority or credential capture.

### Phase 2: Durable closures, revisions, and signals

- implement inline workflow markers and durable steps;
- implement direct-call await and explicit `.start()` admission semantics consistently across callback
  contexts;
- define stable identity, revision, and retained-artifact behavior;
- add replay-safe time, sleep, waits, cancellation, and bounded durable maps;
- implement static `workflow.signal` event contracts, the non-selectable PostgreSQL `SignalStore`
  subsystem of the primary transactional database, idempotent issue operation, single-transaction
  pending instance/access/event/outbox commit, callable one-shot durable decisions, reattachable
  provider waits, compare-and-swap resolution/expiry, wire serialization, execution-family-specific
  decoding, schema-aware handler/client hydration, inert projection references, canonical
  issue/issuance-read/action operations, framework-derived actor envelopes,
  `authorize`/`grantAccessTo`, exact issuance visibility, identity/role/relationship/grant
  authorization, expiry, consumption, receipts, and outbox recovery;
- lower all durability to `WorkflowEngine`; and
- prove restart, retry, signal replay, revocation, cancellation, and version behavior.

### Phase 3: Reactive and callable surface migration

- add `onEvent` compatibility migration and `onBatch`;
- move query and live-view implementations out of `run`;
- add query/view distinction and persistent subscription behavior;
- retain resource proxies, prohibit them across suspension, and add provider-neutral workflow tracking
  with canonical CR-status persistence, rebuildable workflow indexes, managed finalizers, and
  fresh-reconcile status projection;
- infer HTTP dependencies and add typed streaming;
- add committed terminal lifecycle streams; and
- move raw jobs under `app.workload`.

### Phase 4: Projection coherence

- replace split callbacks with one synchronous source-to-write transformation;
- require replay or authoritative-snapshot rebuild authority and pure snapshot-to-source mapping;
- preserve append, upsert, removal, bounded fan-out, retention, checkpoint, generation, and rebuild;
- batch provider writes without changing logical per-source semantics;
- enforce projection purity statically and at runtime; and
- prove live/rebuild equivalence.

### Phase 5: Acceptance applications

- migrate Chirp;
- migrate GuestBook;
- migrate identity administration;
- update generators, docs, and templates;
- complete package-consumer and live-cluster evidence; and
- obtain maintainer developer-experience review.

## Acceptance applications

### Chirp

Chirp demonstrates:

- direct HTTP-to-model capability invocation;
- one-shot query and persistent live view;
- before-commit policy and committed lifecycle fact;
- ordinary single-event and frozen whole-batch-acknowledgement consumers;
- workflow-wrapped event processing with multiple steps;
- a serialized approval signal using `authorize` and another using `grantAccessTo`, both delivered
  through SSE after exact `issuance.read` admission, hydrated by the web application, resolved once,
  and returning framework-derived actors and receipts;
- direct invocation of child workflows and ordinary effect closures through explicit durable steps;
- keyed online and append analytical projections using one transformation each;
- replay and authoritative-snapshot rebuild and lifecycle evidence;
- a resource reconcile that persists a named workflow relationship in canonical CR status, survives
  controller restart, projects progress through fresh reconciliation, and exercises bounded deletion;
- raw workloads only through `app.workload`; and
- no dependency alias maps in golden-path source.

### GuestBook

```text
browser create
  -> typed resource/model create
  -> committed on.create fact
  -> ordinary publication closure
  -> persistent published-entry view
  -> SSE invalidation and browser requery
```

GuestBook is the minimal readability gate: one model/resource declaration, no `operation()` or `task()`,
no repeated local string identities, and no provider lookup inside a handler. It must remain small
enough that a new user can understand the complete application in one sitting.

Its lifecycle handler can be shared without unpacking the resource definition's generic parameters:

```ts
async function publish(entry: ModelEvent<typeof GuestBookEntry, "create">) {
  entry.status.phase = "Published";
  entry.status.publishedAt = new Date().toISOString();
}

GuestBookEntry.on.create({ namespace }, publish);
GuestBookEntry.on.update({ namespace }, publish);
```

`ModelEvent<typeof Model, "create" | "update" | "delete">` derives the native lifecycle value for
both promoted CRDs and promoted Drizzle models. Inline handlers infer the same value without an
annotation.

### Identity and authorization

The identity slice demonstrates direct agent tools, an approval-required operation, signal
`authorize` against an existing role, signal `grantAccessTo` for a bounded identity, framework-derived
actors, durable resumption, role or grant revocation before a later protected call, MCP exposure of the
same handle, and operations evidence connecting principal, actor, role, grant, signal, receipt,
workflow, steps, and outcome.

## Required tests

### Type and API tests

- every public implementation infers source/input, output, context, and result;
- ordinary functions remain unbranded and directly callable;
- projections reject async, effects, providers, and unsupported output descriptors;
- query and view APIs expose distinct invocation/subscription surfaces;
- batch handlers receive frozen typed envelopes and bounded options;
- resource proxies retain current status/effect typing;
- resource proxy handlers reject workflow wrapping and expose typed `track()` observations;
- workflow APIs exist only in durable contexts;
- workflow handles distinguish awaited invocation from admitted `.start()` runs;
- signal definitions are importable typed event contracts and `workflow.emitSignal()` is restricted to
  durable contexts;
- emitted decisions are callable and return the exact contract-derived discriminated action/expiry
  outcome;
- outcome narrowing correlates each action with only its declared input, while `match()` requires every
  action and `expired`;
- each signal action method returns only its action-correlated winning outcome or a redacted terminal
  summary;
- v0.7 signal contracts cannot request multi-use completion semantics;
- event/batch handlers hydrate server signal capabilities and SSE/browser consumers hydrate client
  stubs with exactly the declared methods;
- projections receive only `SignalProjectionSource<T>` with inert `SignalReference<T>` and cannot
  invoke or hydrate it;
- projection persistence rejects signal-reference laundering unless the output model declares a
  bounded `field.signal(...)` and the transform assigns the same inert issuance reference;
- signal action payloads cannot provide their trusted actor;
- signal issuance exposes a type-level XOR between `authorize` selectors and `grantAccessTo`
  identities without exposing either on the wire;
- raw HTTP request, response, socket, stream, cookie/header container, abort controller, and route
  context types cannot enter durable workflow input;
- callable views return typed snapshots with resumable cursors and retain `.snapshot()` as an explicit
  equivalent;
- tracking requires a stable key, typed canonical status, and an explicit bounded deletion policy;
- invocation options remain handle-specific; and
- raw workload names cannot collide with task/workflow/schedule APIs.

### Compiler tests

- direct calls lower to exact stable handles and complete inputs;
- same-file named function declarations and `const` callbacks preserve the same inferred dependencies
  as inline callbacks;
- unresolved imported callbacks fail closed with a supported local-callback or explicit
  authority-envelope remedy;
- committed lifecycle handlers lower awaited same-authority model operations into one retryable
  transaction and reject unawaited or cross-authority calls;
- before-commit policy commands invoked through `await` fail discovery while `void Command(...)`
  remains captured and lowers to the command outbox;
- helpers remain local calls;
- dynamic relationships fail closed;
- explicit authority is only a maximum envelope;
- normalized formatting does not change identity;
- old workflow revisions remain addressable while live;
- signal contracts, wire codecs, canonical issue/issuance-read/action operations, `authorize`
  selectors or `grantAccessTo` identities and exact read/action grants, framework-derived actor/receipt
  envelopes, targets, and action authority appear in the graph;
- signal issuance lowers to one replay-stable issue occurrence, the primary transactional database's
  internal signal subsystem, signal identity, issue receipt, event identity, and transactional outbox
  identity;
- signal event codecs lower separately for server handlers, browser/SSE clients, and pure projections
  without changing the logical issuance identity;
- batch manifest identity, whole-batch acknowledgement, and checkpoint plans are deterministic;
- projection transformations and declared replay/snapshot rebuild authorities lower to equivalent
  live/rebuild programs;
- snapshot predicates are provider-plannable where supported; snapshot rebuild mappers and
  source/skip descriptors are pure, typed into the live source contract, and carry complete authority
  provenance;
- resource/run tracking lowers to an exact UID/generation relation, stable key, canonical CR-status
  schema, lifecycle/finalizer policy, rebuildable requeue index, and status mapping;
- compatibility forms produce equivalent graphs where promised.

### Runtime tests

- ordinary failure reruns the whole handler with idempotent child calls;
- workflow failure resumes after completed steps;
- worker restart preserves history and old revision routing;
- duplicate event and batch delivery reattach correctly;
- batch retry preserves exact membership;
- failure after a committed batch side effect retries the frozen batch and relies on stable
  item/batch idempotency rather than claiming rollback;
- step and durable-map retry respect keys, bounds, and cancellation;
- direct workflow invocation awaits the durable result while `.start()` returns only after admission in
  every supported callback context;
- `workflow.emitSignal()` commits the pending instance, access state, issuance event, and outbox row in
  one `SignalStore` transaction; replay returns the same receipt, event, and callable decision; and
  `await decision()` resumes with the typed terminal outcome;
- a crash before issuance commit creates no observable signal and retry commits exactly one;
- a crash after issuance commit but before workflow history records the receipt reuses the committed
  issue receipt and signal identity;
- a crash after outbox commit but before broker publication is recovered by outbox retry without a
  duplicate logical event;
- a crash after action resolution commit but before workflow resumption reattaches to the canonical
  terminal state and resumes exactly once logically;
- the same issuance identity crosses ordinary event, batch, projection, and SSE paths; event/batch and
  SSE consumers receive the appropriate callable facet while projections receive only the inert
  reference;
- a winning signal action ignores or rejects client attempts to claim actor identity and returns only
  its action-correlated outcome with the authenticated canonical actor and authorization receipt;
- SSE replay returns the same capability;
- an exact idempotent same-action replay returns the same action-correlated outcome and receipt;
- concurrent or conflicting terminal actions admit exactly one winner and return typed
  redacted already-resolved summaries for the rest;
- expiry, role/relationship/grant revocation, authorized-subject, target, and context mismatch fail
  closed;
- query executes once while view snapshot/resume/reset remains live;
- projection live/rebuild outputs are equivalent;
- filtered snapshot rebuild excludes authoritative rows that never produced the live fact;
- snapshot rebuild refuses or documents sources that cannot reconstruct irrecoverable event history;
- snapshot rebuild establishes a frontier, catches up live changes, handles deletion, and cuts over
  generations without mixed output;
- reconcile retry attaches to the same run for the same resource generation;
- operator restart rebuilds the run-to-resource index solely from canonical CR status;
- workflow progress enqueues the exact resource and only a fresh reconcile projects it into status;
- deletion and generation change enforce the declared cancellation deadline, detach/block,
  finalizer, and supersede policy without retaining a stale resource proxy; and
- HTTP accepted and bounded-await routes use ordinary workflow calls, observation timeout does not
  cancel the run, raw HTTP objects cannot cross the durable boundary, and typed streaming behaves as
  declared.

### Security tests

- no direct handle gains ambient authority;
- captured handles expose no credentials;
- complete input is validated before target derivation;
- signal wire values expose no workflow-provider topology or credentials;
- `authorize` cannot create authority or broaden action, subject, target, context, or expiry;
- `authorize` delivery requires existing exact `issuance.read` as well as relevant action authority;
- `grantAccessTo` cannot create a grant without compatible `canGrant`, grants exact issuance read plus
  declared actions, and cannot broaden stream history, target, context, use count, or expiry;
- client-supplied identity fields cannot replace the framework-derived actor;
- a losing or conflicting action caller cannot observe the winning action, input, actor, or receipt;
- unauthorized event or SSE subscribers cannot observe the issuance reference;
- possession of an action grant without exact `issuance.read` cannot reveal the event, and exact
  issuance read cannot enumerate unrelated contract events;
- an admitted event handler does not gain signal-action authority merely by receiving the issuance
  event;
- cross-principal and cross-context signal use fails;
- stale authority/catalog revisions fail at the next protected call;
- replay cannot reuse a receipt outside exact scope;
- browser bundles contain only client-safe transport bindings; and
- MCP, AI, SSE, batch, and resource paths preserve normal authorization.

### Live evidence

- clean package-consumer installation through public exports;
- OrbStack deployment of migrated Chirp;
- event and batch consumers with checkpoint/retry evidence;
- batch failure after a partial external effect with idempotent frozen-manifest replay evidence;
- workflow restart between steps;
- old workflow revision completing after a new deploy;
- signal committed with its issuance outbox row in the canonical store, consumed by an ordinary event
  handler and SSE, hydrated in Start, invoked, and awaited through the callable decision;
- the same issuance passes through a projection as an inert reference, live/rebuild outputs match, and
  unapproved capability persistence fails planning;
- all four issuance/resolution crash windows recover without loss or duplicate logical issuance;
- actor spoofing rejected, existing-role `authorize` with preexisting issuance-read/action authority
  exercised, and bounded exact-read/action `grantAccessTo` revoked;
- authority revocation before a later workflow call;
- persistent view reconnect/reset and projection rebuild;
- Kubernetes workflow tracking persisted in CR status, controller index rebuild after restart,
  progress-to-fresh-reconcile status projection, cancellation-timeout behavior, generation
  supersession, and clean uninstall;
- GuestBook create, lifecycle, live-view, and browser-requery paths; and
- captured graph, plan, explain, operations UI, receipts, and provider evidence.

## Release gates

This RFP is complete only when:

- charter and sibling-RFP amendments are reviewed;
- no acceptance source uses dependency alias maps;
- ordinary functions remain ordinary and distributed handles remain explicit graph boundaries;
- direct handles preserve or narrow all authority;
- `onBatch` has bounded frozen-manifest and whole-batch-acknowledgement evidence without claiming
  external atomicity;
- query, live view, and persisted projection are observably distinct;
- resource proxies remain at least as concise and capable as the current API;
- workflow identity, revision, step, signal, and retained-artifact behavior is deterministic;
- signal issuance passes canonical-store transaction, issue-receipt replay, all four crash windows,
  outbox recovery, exact issuance-read admission, event replay, ordinary event/SSE delivery, callable
  one-shot decision, exhaustive correlated outcomes, action-correlated method results, redacted losing
  results, execution-family-specific decoding, inert projection purity, explicit bounded capability
  persistence, framework-derived actor, `authorize`, `grantAccessTo`, `canGrant`, target, expiry,
  compare-and-swap resolution, and revocation gates;
- HTTP durability passes explicit start/await, typed timeout, non-cancellation, and raw-request capture
  rejection gates without a route execution DSL;
- resource tracking passes canonical-status, restart-index-rebuild, fresh-reconcile, bounded-finalizer,
  uninstall, and orphan-policy gates;
- unsupported dynamic relationships fail closed;
- Application-owned `Resource.on.reconcile(...)` declarations synthesize and
  replay their operator installation without a parallel `app.reconcile(...)`
  registration;
- the Application value and public type exports contain no application-level
  reconciliation aliases, including the removed `app.on`, `app.reconcile`,
  `ApplicationReconcileOptions`, and `ApplicationReconcileHandler` names;
- migration diagnostics and compatibility tests pass;
- local typecheck, lint, unit, vertical, compiler, package-consumer, and supply-chain gates pass;
- OrbStack security, restart, lifecycle, streaming, and uninstall evidence passes;
- Chirp, GuestBook, and identity acceptance slices pass;
- the v0.7 scorecard links durable evidence rather than path-existence placeholders; and
- the maintainer explicitly approves the resulting application source.

No alpha, release candidate, or final release tag is authorized by this RFP.

## Definition of done

An author understands the framework through six ideas:

```ts
// Local code stays local.
function helper() {}

// Distributed capabilities are called like functions.
await SomeHandle(input);

// Reactive work is registered against its real trigger.
Stream.onEvent(...);
Stream.onBatch(...);
Resource.on.reconcile(...);

// Persisted derivation is a pure transformation.
export const Projection = Stream.project(Output, (event, output) => output.upsert(...));

// Durability is explicit, and approval travels as data.
workflow(handler);
context.step(name, callback);
const decision = await workflow.emitSignal(ReviewDecision, {
  input: reviewRequest,
  authorize: [Reviewers.for(scope)],
});
const outcome = await decision();

// Kubernetes status observes durable work through fresh reconciliation.
const run = await Workflow.start(input);
const observation = await resource.track("workflow", run, lifecyclePolicy);
```

From those relationships Applik8s produces a complete, inspectable, provider-neutral application graph
covering workloads, operation authority, runtime identity, events, batches, workflows, revisions,
steps, serializable signals, queries, live views, projections, rebuild authority, checkpoints, tracked
resource/run observations, RBAC, providers, deployment ordering, lifecycle, and operations evidence.

Authors do not repeat dependency graphs, expose workflow-engine topology, replace ordinary functions
with catalog ceremony, turn projections into expression DSLs, or sacrifice explicit
distributed-systems guarantees for a smaller surface.
