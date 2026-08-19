# RFP: Applik8s v0.8 — Function-Native Scheduling

**Status:** Proposed v0.8 stable contract with individually qualified providers. This document
authorizes design review and provider spikes, not implementation or release.

**Manifesto:**
[`manifesto-v08-portable-stateful-development.md`](manifesto-v08-portable-stateful-development.md)

**Foundation gate:** The stable `graph-provenance` gate must pass before a captured scheduled closure,
its inferred dependencies, or its runtime access can be considered complete.

**Foundation dependencies:** The v0.7 function-native closure, workflow, task, event,
operation-authority, application-graph, qualified-provider, and causal-execution contracts plus the
manifesto's Phase 0 identity, target/provider, guarantee, execution-boundary, and provenance records

**v0.8 contract integrations:** Portable targets bind scheduler providers, the application plan explains
definitions and topology, inferred runtime access attributes schedule operations, and unified
observability correlates occurrences. The local semantic implementation can precede AWS and Kubernetes
provider qualification.

**Initial providers:** Deterministic local scheduler, bounded Kubernetes CronJob lowering, qualified
Hatchet recurring schedules for shared/high-cardinality Kubernetes use, and Amazon EventBridge Scheduler
on AWS

**Target disposition:** Local, AWS, and Kubernetes each require a qualified scheduling path for the
stable v0.8 contract. AWS-local is API-fidelity evidence only. Kubernetes CronJobs satisfy bounded
schedule topology; high-cardinality dynamic scheduling requires a separately qualified shared provider
and never silently expands into an unbounded number of control-plane resources.

## Purpose

Make time-driven execution feel like every other function-native Applik8s primitive:

```ts
import { Scheduler, schedule, type } from "@applik8s/applik8s";

export const CleanupExpiredEvidence = schedule(
  {
    id: "evidence.cleanup.v1",
    cron: "0 3 * * *",
    timezone: "UTC",
    overlap: "skip",
    misfires: "latest",
  },
  async context => {
    await Evidence.deleteExpired({
      before: context.scheduledAt,
      limit: 1_000,
    });
  },
);
```

The declaration is inert, typed, provider-neutral, source-attributed, callable for an immediate run,
and activated only when reachable from the compiled application entrypoint. The closure may call models,
events, workflows, actors, queries, objects, and other qualified capabilities through ordinary
TypeScript. The compiler discovers those calls and derives graph dependencies, runtime access, causal
links, deployment topology, and telemetry.

The application does not choose Kubernetes, Hatchet, EventBridge Scheduler, a local timer, a queue, or a
container. It chooses a qualified semantic `Scheduler` when it needs more than the default. Installation
and target resolution choose a compatible provider.

## Problem

Applik8s currently exposes correct but fragmented scheduling machinery:

- `app.schedule(...)` describes a Kubernetes image/command CronJob;
- workflow declarations may contain static cron triggers;
- task and workflow handles support one-time future execution;
- event processors receive `context.schedules.<alias>.reconcile(...)` for dynamic schedules; and
- Hatchet implements recurring schedule convergence.

Those mechanisms prove most of the required runtime behavior, but they expose deployment history rather
than one coherent application model. A developer should not need to decide whether time-driven work is a
CronJob, workflow cron, event-processor schedule target, or provider client call before writing the
behavior.

The destination is:

> A schedule is an inert typed definition that invokes one managed closure at a logical time through a
> qualified scheduler capability.

## General qualified dependency injection

Scheduling does not define a special provider-selection model. It uses the same qualified capability
contract as databases, object stores, event sources, actor runtimes, and lakehouse providers.

The unqualified helper consumes the default scheduler:

```ts
export const CompactOperationalHistory = schedule(
  {
    id: "operations.compact.v1",
    cron: "0 4 * * *",
  },
  compactOperationalHistory,
);
```

An application that requires a distinct logical scheduler declares a typed qualifier once:

```ts
export const SourcePolling = Scheduler.named("source-polling");

export const PollSource = SourcePolling.schedule(
  {
    id: "source.poll.v1",
    input: type({ sourceBindingId: "string" }),
    overlapBy: input => input.sourceBindingId,
    requirements: {
      configuration: "dynamic",
      cardinality: "high",
      precision: "minute",
    },
  },
  pollSource,
);
```

Installation binds the qualifier without changing domain behavior:

```ts
installation
  .provide(SourcePolling)
  .local(() => Scheduler.local())
  .aws(() => Scheduler.eventBridge())
  .kubernetes(() => Scheduler.hatchet())
  .exhaustive();
```

The qualifier identifies a logical application dependency. It does not name a provider. Domain source
must not call `EventBridgeScheduler.schedule(...)`, `CronJob.schedule(...)`, or Hatchet APIs.

`schedule(parameters, closure)` is equivalent to `Scheduler.default.schedule(parameters, closure)`.
The qualifier, provider selection, provider guarantees, inferred access, and physical topology appear in
the canonical application plan.

## Required developer experience

### Fixed recurring schedule

```ts
export const RebuildSearch = schedule(
  {
    id: "search.rebuild.v1",
    cron: "0 2 * * *",
    timezone: "UTC",
    overlap: "skip",
    misfires: "latest",
    retry: {
      maxAttempts: 8,
      maximumAge: "6h",
    },
  },
  async context => {
    return RebuildSearchIndex.start({
      generation: context.occurrenceId,
    });
  },
);
```

The closure launches a workflow through ordinary function-native code. A special
`schedule(parameters, workflow)` overload is unnecessary. Returning `Workflow.start(...)` completes the
schedule occurrence after durable workflow admission. Awaiting a result keeps the scheduled closure
active and therefore affects overlap semantics.

### Dynamically configured schedule instances

```ts
export const PollSource = SourcePolling.schedule(
  {
    id: "source.poll.v1",
    input: type({ sourceBindingId: "string" }),
    overlapBy: input => input.sourceBindingId,
    overlap: "skip",
    misfires: "latest",
    requirements: {
      configuration: "dynamic",
      cardinality: "high",
    },
  },
  async ({ sourceBindingId }, context) => {
    const binding = await SourceBinding.get(sourceBindingId);
    if (!binding.enabled) return;

    return AcquireSource.start({
      sourceBindingId,
      scheduledAt: context.scheduledAt,
    });
  },
);
```

An authorized model lifecycle callback may converge one instance:

```ts
SourceBinding.on.create(async binding => {
  await PollSource.schedule({
    id: binding.id,
    cron: binding.schedule,
    timezone: binding.timezone,
    enabled: binding.enabled,
    revision: String(binding.revision),
    input: { sourceBindingId: binding.id },
  });
});

SourceBinding.on.update(async binding => {
  await PollSource.schedule({
    id: binding.id,
    cron: binding.schedule,
    timezone: binding.timezone,
    enabled: binding.enabled,
    revision: String(binding.revision),
    input: { sourceBindingId: binding.id },
  });
});

SourceBinding.on.delete(async binding => {
  await PollSource.unschedule(binding.id);
});
```

The framework internally retains desired-state reconciliation, deterministic provider identity,
revision ordering, conflict detection, no-op convergence, and cleanup. Application code does not receive
a provider schedule client or a generic reconciliation context.

### Immediate and one-time execution

The returned handle is callable for an immediate managed execution:

```ts
await PollSource({ sourceBindingId: binding.id });
```

The same definition can create a one-time future instance:

```ts
await PollSource.schedule({
  id: `retry-${attempt.id}`,
  at: attempt.retryAt,
  input: { sourceBindingId: binding.id },
  deleteAfterCompletion: true,
});
```

Exactly one of `cron`, `every`, or `at` is accepted for a configured instance. A fixed declaration may
provide the expression in its parameters; a dynamic declaration supplies it per instance.

### Context

The callback receives a small semantic context:

```ts
interface ScheduleContext {
  readonly definitionId: string;
  readonly instanceId: string;
  readonly occurrenceId: string;
  readonly scheduledAt: string;
  readonly admittedAt: string;
  readonly startedAt: string;
  readonly attempt: number;
  readonly signal: AbortSignal;
}
```

Provider names, ARNs, Kubernetes objects, cron controller state, Hatchet clients, queue clients, and
credentials are absent.

## Terminology

The contract distinguishes:

- **definition** — the inert authored schedule and closure;
- **instance** — one configured fixed, recurring, or one-time schedule identity;
- **occurrence** — one logical time at which an instance should run;
- **delivery attempt** — one provider or framework attempt to admit that occurrence;
- **run** — one managed closure execution admitted for the occurrence; and
- **downstream execution** — a workflow, task, actor call, operation, or event initiated by the closure.

Provider retry never creates a new logical occurrence. A downstream workflow is not part of the schedule
run after `Workflow.start(...)` returns its durable admission receipt.

## Semantic contract

### Stable identity

Definition identity is explicit, rename-stable, application-scoped, revision-family-scoped, and duplicate
checked. Instance identity is unique within its definition and environment.

Occurrence identity is derived from:

```text
application identity
+ environment identity
+ schedule definition identity
+ instance identity
+ canonical scheduled time
```

It does not derive from provider delivery ID, retry attempt, Pod UID, workflow run ID, wall-clock start
time, random value, traversal order, or target-specific resource name.

The same occurrence delivered twice returns or reuses the prior admission receipt. Reusing a definition,
instance, revision, or occurrence identity with materially different canonical input fails with a typed
conflict.

### Delivery and execution

- Provider delivery and closure execution are at least once physically.
- Framework admission is logically idempotent by occurrence ID.
- A successful admission has a durable prior-result or prior-run receipt.
- The closure and every external effect remain retry safe.
- Provider acknowledgement occurs only after durable occurrence admission.
- A crash after admission but before provider acknowledgement returns the existing receipt on retry.
- A crash after provider acknowledgement cannot erase the admitted run.
- Retry exhaustion produces a terminal diagnostic and, when configured, a dead-letter reference.

This contract does not claim globally exactly-once arbitrary external I/O.

### Overlap

v0.8 portable overlap modes are:

- `allow` — occurrences may execute concurrently;
- `skip` — a new occurrence is recorded as skipped while the same overlap key has an active schedule
  run.

The overlap key is the instance identity unless `overlapBy(input)` declares a narrower typed key.
`overlapBy` must be a compiler-proven pure, synchronous, deterministic selector whose canonical output
is bounded and schema serializable. It cannot read ambient time, perform effects, or capture application
handles. Unsupported selectors fail compilation rather than changing overlap behavior by target.
`replace` is deferred from the stable portable contract because cancelling an active closure and all
downstream effects is not equivalent across providers. A provider-specific escape hatch cannot claim
portable schedule semantics.

Overlap covers the scheduled closure. If the closure durably starts a workflow and returns, later
occurrences do not treat that workflow as active. If the closure awaits the workflow result, the schedule
run remains active until completion or cancellation.

### Misfires and flexible windows

Portable misfire modes are:

- `skip` — do not admit an occurrence after its allowed lateness;
- `latest` — admit at most the latest eligible missed occurrence; and
- `all-bounded` — admit missed occurrences up to an explicit `maximumCatchUp`.

Every provider states its precision, lateness, outage recovery, and catch-up behavior. A provider whose
native behavior is weaker must route through the framework admission layer or reject the requested
policy. It cannot silently reinterpret `latest` as unbounded catch-up.

Optional jitter or a flexible window is semantic only when the application permits it. The plan shows
whether the provider enforces it natively or the framework applies it before admission.

### Dynamic desired state

`ScheduledClosure.schedule(instance)` is a convergent typed operation:

- a new identity creates the desired provider schedule;
- identical desired state returns unchanged;
- a higher revision updates it;
- the same revision with different canonical state conflicts;
- a stale revision is rejected without reverting provider state;
- `enabled: false` prevents new occurrences without cancelling admitted runs;
- `unschedule(id)` removes future execution and retains bounded history according to policy; and
- interruption recovery resumes from persisted desired state without abandoning provider resources.

Configuration authority and execution authority are separate. The principal that configured a recurring
schedule is recorded in its management receipt but is not impersonated by every future occurrence.

### Principal and causal identity

A recurring occurrence begins with a framework schedule service principal scoped to the exact definition
and instance. The configuration operation's principal remains audit evidence, not the occurrence's causal
principal. Applications requiring a domain service identity declare it explicitly through the ordinary
authority model.

The occurrence becomes the causal root for its closure. Workflow starts, model operations, events, actor
calls, and provider effects preserve that schedule identity and the resulting trace context. Provider
retries do not invent a new principal or causal chain.

### Time

The scheduled time comes from the provider-admitted occurrence envelope and is validated against the
desired instance. Handler code does not use ambient `Date.now()` to determine occurrence identity.

Local and test providers expose a controllable framework clock. Time-zone names use an explicit versioned
IANA contract. Changes to time-zone data, daylight-saving interpretation, clock skew, or provider cron
syntax appear in compatibility evidence.

The portable expression surface is deliberately narrower than provider syntax:

- `cron` uses a versioned five-field minute/hour/day-of-month/month/day-of-week grammar;
- `every` uses the framework duration grammar and must satisfy the selected provider's minimum interval;
- `at` is an RFC 3339 timestamp with an explicit offset;
- `timezone` defaults to `UTC` and otherwise uses an IANA zone name; and
- AWS-only, Kubernetes-only, or provider-native extensions require an explicit provider escape hatch and
  cannot claim portable schedule semantics.

Definition parameters containing `cron`, `every`, or `at` create one fixed instance whose identity is
derived from the definition. A dynamic definition has no implicit configured instance; its typed
`.schedule(...)` operation owns each explicit instance identity and revision.

### Invocation and results

Immediate invocation creates a synthetic one-time instance and occurrence using the framework clock and
the caller's execution/causal principal. It runs through the same admission, access, timeout, telemetry,
and receipt path as provider-delivered work, but it does not create a persistent recurring provider
resource.

The handle's immediate call returns the managed closure's natural typed result. A provider-triggered
occurrence records its admission and terminal result metadata; it does not retain arbitrary result
payloads unless an explicit bounded retention contract requests that. Returning a workflow reference
records the durable downstream admission. It does not make the downstream workflow part of the schedule
run unless the closure explicitly awaits workflow completion.

## Canonical graph and application plan

Each definition contributes:

- canonical definition, instance family, closure, and execution identities;
- input/output schemas and closure provenance;
- qualified `Scheduler` dependency and semantic requirements;
- fixed or dynamic configuration mode;
- expression, time-zone, overlap, misfire, retry, lateness, and retention policies;
- called capability and downstream execution edges;
- inferred and explicit runtime access;
- provider resolution and guarantee comparison;
- physical scheduler, admission, queue, worker, role, Secret, and dead-letter topology;
- lifecycle ownership and deletion order;
- telemetry, cost class, estimates, quotas, and unknowns; and
- observed occurrence/run evidence linked separately from planned state.

Plans distinguish a declared schedule from a configured instance, a planned provider resource, an
observed provider resource, an admitted occurrence, and a completed run.

## Inferred runtime access

The schedule closure is an independently deployable execution identity. Supported direct calls and
captured helper/module graphs infer exact access for that identity.

The scheduler provider separately requires permission to deliver to the schedule admission boundary.
The admission runner receives permission to invoke only the exact compiled schedule definition. A
closure that starts one workflow does not inherit the workflow's database, object, network, or provider
permissions.

Initial access operations include:

```text
schedule.configure
schedule.unschedule
schedule.admit
schedule.invoke
```

Provider lowering may produce local capability tokens, AWS IAM and queue policies, Kubernetes service
accounts/RBAC/network policy, or external-provider attestations. Business authorization remains
independent.

## Provider capability contract

Every provider publishes at least:

```ts
interface SchedulerProviderCapabilities {
  readonly recurring: boolean;
  readonly oneTime: boolean;
  readonly dynamicConfiguration: boolean;
  readonly timezones: boolean;
  readonly minimumPrecision: string;
  readonly maximumSchedules?: number;
  readonly maximumConfigurationRate?: number;
  readonly nativeOverlap: readonly ("allow" | "skip")[];
  readonly misfires: readonly ("skip" | "latest" | "all-bounded")[];
  readonly flexibleWindow: boolean;
  readonly retry: boolean;
  readonly deadLetter: boolean;
  readonly disable: boolean;
  readonly deleteAfterCompletion: boolean;
  readonly occurrenceMetadata: boolean;
}
```

Provider limits and target-specific behavior are facts, not marketing labels. Planning fails when the
selected binding cannot satisfy a required semantic and no framework admission protocol can strengthen
it safely.

## Local provider

The deterministic local provider owns:

- a durable local desired-schedule registry;
- a controllable test clock and production wall-clock adapter;
- cron/rate/one-time calculation under the versioned time-zone contract;
- occurrence admission, prior receipt lookup, overlap leases, and bounded catch-up;
- process restart, machine sleep/wake, hot reload, and source revision convergence;
- loopback-only management endpoints;
- schedule/run logs, traces, metrics, and diagnostics; and
- lease-safe reset and deletion.

An in-memory timer alone cannot satisfy stable local evidence. Local restart must not duplicate or forget
an already admitted occurrence. Deterministic tests advance the framework clock without sleeping.

## Kubernetes providers

### Bounded CronJob provider

The TypeKro provider may lower a bounded fixed or dynamic schedule instance into:

```text
CronJob
  -> generated schedule-runner Job/Pod
  -> durable Applik8s occurrence admission
  -> captured closure
```

It maps supported cron, time-zone, suspension, starting-deadline, concurrency, and history settings while
retaining the framework occurrence envelope. Jobs use the Kubernetes scheduled-timestamp metadata when
available, but canonical occurrence identity remains framework defined.

CronJob creation is approximate and may duplicate or omit Jobs. The provider therefore cannot bypass
framework admission or handler idempotency. `Forbid` is not assumed to implement portable overlap when
the closure only admits downstream work or when multiple physical CronJobs share a logical overlap key.

The provider contract is grounded in the official
[Kubernetes CronJob behavior and limitations](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/),
but qualification remains pinned to the Kubernetes versions Applik8s tests.

The provider declares and enforces a bounded instance ceiling. Planning rejects a high-cardinality
dynamic requirement rather than materializing an unbounded number of CronJobs and status resources in
the Kubernetes control plane.

### Shared scheduler provider

Hatchet is the first shared/high-cardinality Kubernetes candidate because Applik8s already has recurring
schedule convergence and workflow/task admission support. Its provider must use the same definition,
instance, occurrence, revision, authority, prior-result, and telemetry contracts as local, CronJob, and
AWS providers. Hatchet operational history does not become canonical application state.

Another provider may qualify through the same suite. Application source and schedule identities do not
change when moving between bounded CronJob and shared scheduling.

## AWS provider

Amazon EventBridge Scheduler is the maintained AWS implementation. Legacy EventBridge scheduled rules are
not the default provider.

The provider uses the official
[EventBridge Scheduler service contract](https://docs.aws.amazon.com/scheduler/latest/UserGuide/what-is-scheduler.html)
for cron/rate/one-time schedules, time zones, flexible windows, retries, and dead-letter behavior while
retaining Applik8s occurrence admission as the portable semantic boundary.

The Alchemy provider owns:

- schedule groups and deterministic schedule identities;
- cron/rate/one-time expressions, time zones, state, start/end bounds, and completion deletion;
- flexible windows where permitted;
- a narrowly scoped execution role;
- an SQS schedule-admission target or another separately qualified target;
- retry age/count and dead-letter queue policy;
- encryption and sensitive-input exclusion;
- update, adoption, drift repair, interruption recovery, and deletion; and
- CloudWatch/OTel evidence and quota diagnostics.

The target payload carries provider schedule identity, scheduled time, provider execution ID, attempt
number, logical definition/instance identity, and the immutable input reference or bounded input. The
framework derives occurrence identity from logical identity and scheduled time, never the provider
execution attempt.

The default scalable topology is:

```text
EventBridge Scheduler
  -> SQS schedule-admission queue
  -> Applik8s schedule runner
  -> durable occurrence admission
  -> captured closure
```

ECS `RunTask` may qualify for isolated heavyweight schedules but cannot silently replace the queue-backed
contract or receive broader IAM. The provider exposes schedule-count, configuration-rate, invocation,
throttle, retry, DLQ, and cost evidence in the application plan.

## Existing-surface consolidation

v0.8 makes imported `schedule(parameters, closure)` the golden path.

- Existing workflow cron declarations lower through the same semantic graph or are migrated to an
  explicit schedule closure.
- Existing event-processor schedule reconciliation remains an internal implementation seam, not the
  preferred public application API.
- Existing one-time task/workflow scheduling delegates to the qualified scheduler where compatible.
- Existing raw `app.schedule(...)` Kubernetes image/command behavior moves behind TypeKro or an explicit
  Kubernetes escape hatch and no longer defines portable application scheduling.
- Provider clients remain internal.

The migration may be breaking before 1.0, but documentation and generated examples must expose only one
canonical schedule model after the v0.8 freeze.

## Observability and operations

Every definition, instance, occurrence, attempt, run, downstream start, skip, misfire, conflict, retry,
dead-letter, disable, and deletion carries stable application, environment, definition, instance,
occurrence, execution, provider, and trace identities subject to redaction/cardinality policy.

Operations surfaces show:

- desired and observed schedule state;
- provider, qualifier, maturity, limits, and compatibility gaps;
- next and prior scheduled times;
- active, completed, skipped, missed, retried, and failed occurrence counts;
- last admission/run/terminal receipt;
- overlap and misfire decisions;
- delivery age, queue lag, throttling, and dead letters;
- provider drift and unresolved cleanup;
- bounded input/schema information without secret values; and
- links to workflow, model, event, actor, trace, and native deployment evidence.

Metrics use bounded labels. Dynamic instance IDs and tenant IDs do not become unbounded metric labels by
default.

## Security

- Schedule input is schema validated, size bounded, and secret safe.
- Credentials and provider clients cannot enter schedule input, closure captures, graph artifacts, or
  telemetry.
- Dynamic configuration is an authorized typed operation.
- The principal configuring a schedule is not replayed as the principal of future occurrences.
- The provider can invoke only the intended schedule admission boundary.
- The admission runner can invoke only the exact compiled definition and qualified dependencies.
- Cross-application, environment, qualifier, definition, or instance identity reuse fails closed.
- Dead-letter payloads preserve redaction and do not become an alternate artifact store.
- Raw provider schedule access requires an explicit bounded escape hatch and cannot claim portable
  semantics.
- Deletion is leased to application/account/region/cluster/environment identity and cannot remove a
  replacement installation's schedule.

## Implementation increments

### Increment 1 — Contract and local runtime

- Complete a bounded EventBridge Scheduler/SQS admission and Kubernetes CronJob metadata/lifecycle spike
  before the provider and occurrence-envelope contracts freeze.
- Freeze definition, instance, occurrence, attempt, run, context, expression, overlap, misfire, retry,
  authority, and receipt schemas.
- Implement inert discovery, function-native typing, closure compilation, callable immediate execution,
  and qualified `Scheduler` dependencies.
- Implement deterministic local provider, clock, restart recovery, and conformance harness.
- Emit application-plan, runtime-access, and OTel records.

### Increment 2 — Existing-surface convergence

- Lower static workflow crons, dynamic Hatchet reconciliation, and one-time scheduling into the shared
  semantic contract.
- Remove raw Kubernetes scheduling from the application golden path.
- Migrate examples and documentation without retaining two competing APIs.

### Increment 3 — Kubernetes qualification

- Implement TypeKro CronJob provider with durable admission and bounded topology.
- Qualify Hatchet or another shared provider for dynamic/high-cardinality use.
- Prove create, no-op, update, disable, catch-up, duplicate delivery, overlap, drift, restart, finalizer-
  safe deletion, and retained-history behavior on OrbStack.

### Increment 4 — AWS qualification

- Implement the Alchemy EventBridge Scheduler provider, IAM, SQS admission path, retry, DLQ, encryption,
  metrics, and lifecycle.
- Prove real-AWS create, no-op, update, one-time completion, disable, duplicate delivery, retry, DLQ,
  drift repair, interruption recovery, quota evidence, and deletion.
- Keep AWS-local evidence labeled API fidelity.

### Increment 5 — Product acceptance and optimization

- Add one fixed Agentic Start maintenance schedule and one product-configured recurring schedule.
- Prove a scheduled closure launching a workflow and one executing direct bounded model work.
- Record high-cardinality configuration/invocation history and provider cost without making timing-
  sensitive performance measurements ordinary PR blockers.

## Required gates

### Type and compiler

- Input, output, context, instance, expression, qualifier, and called handles are fully inferred.
- Invalid expression combinations, provider values, closure captures, dynamic targets, ambiguous
  identities, and incomplete helper graphs fail compilation.
- Importing an inert definition has no deployment side effect.
- Only reachable/exported definitions enter the graph.

### Semantic conformance

- Fixed, dynamic, recurring, one-time, immediate, enable/disable, update, unschedule, retry, skip,
  catch-up, overlap, conflict, and prior-result fixtures pass against every advertised capability.
- Occurrence identity remains stable across delivery retries, process/Pod/task restart, provider update,
  and target lowering.
- Fake-clock tests cover daylight-saving transitions, time-zone updates, clock skew, sleep/wake, and
  bounded catch-up without wall-clock sleeps.
- A crash at every admission/acknowledgement/run boundary recovers without losing or materially
  duplicating the logical occurrence.

### Access, authority, and security

- Closure calls infer access for the schedule-runner identity only.
- Provider delivery and schedule-management permissions are exact and independently attributed.
- Application authorization remains required for configuration operations.
- Principal, tenant, Secret, input, dead-letter, and cross-environment canaries pass.
- Narrowing provider or closure access produces a visible plan diff and live denial evidence.

### Provider and lifecycle

- Deterministic local, OrbStack Kubernetes, and real-AWS EventBridge Scheduler gates pass.
- Kubernetes proves bounded control-plane topology and fail-closed high-cardinality rejection.
- AWS proves IAM, SQS admission, retry/DLQ, drift, quotas, cost evidence, and account/region leases.
- Create, no-op, update, adopt, interruption recovery, drift repair, disable, retained history, and delete
  are repeatable without orphaned provider schedules.

### Product and packaging

- Agentic Start demonstrates fixed and dynamically configured schedules without provider imports.
- `applik8s plan` explains qualifier, semantic policy, provider selection, physical topology, runtime
  access, occurrences, limits, maturity, and cost class.
- Clean package consumers compile, test, plan, and run schedules locally.
- Public documentation contains one canonical function-native surface.

## Non-goals

- A general distributed workflow engine.
- Globally exactly-once external effects.
- Unbounded Kubernetes CronJob creation.
- Provider-independent sub-second timers.
- Replacing actor alarms tied to one actor identity.
- Replacing durable workflow sleep or signal semantics.
- Scheduling an already started workflow run.
- Persisting a human principal for indefinite future impersonation.
- Exposing EventBridge, Hatchet, Kubernetes, queue, or local-scheduler clients to application source.
- Claiming every provider has identical precision, catch-up, overlap, retry, or cost behavior.

## Closed v0.8 decisions

- `schedule(parameters, closure)` is the default function-native API.
- `Scheduler.default.schedule(...)` is its semantic expansion.
- `Scheduler.named(...)` uses the general qualified dependency-injection model.
- Qualified application capabilities never encode provider names.
- Definitions are inert and activate only through application reachability.
- Closures launch workflows through ordinary calls; no workflow-target overload is required.
- Definition, instance, occurrence, delivery attempt, schedule run, and downstream execution are distinct.
- Occurrence identity derives from logical identity and scheduled time, not provider attempt identity.
- Physical delivery is at least once; admission retains a durable prior receipt.
- Portable overlap is `allow` or `skip`; portable `replace` is deferred.
- Dynamic schedule configuration is desired-state convergence with ordered revisions and conflict checks.
- Configuration principals are audit evidence and are not impersonated by future occurrences.
- CronJob is the bounded Kubernetes provider; a shared provider is required for declared high-cardinality
  dynamic scheduling.
- EventBridge Scheduler is the maintained AWS provider; legacy scheduled rules are not the default.
- Actor alarms remain the primitive for timers attached to actor state.
- Raw Kubernetes image/command schedules are an explicit infrastructure escape hatch, not application
  scheduling.

## Definition of done

This RFP is complete when an author can import `schedule`, declare an inert typed closure, optionally
select a qualified scheduler through the same dependency-injection model as every other capability,
invoke it immediately, converge recurring or one-time instances, call workflows and other application
handles naturally, infer exact runtime access, inspect its plan and telemetry, and run the same semantic
contract through deterministic local, qualified Kubernetes, and real-AWS EventBridge Scheduler providers
without importing provider APIs or confusing schedules with workflows, actor alarms, events, or raw
CronJobs.
