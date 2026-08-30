# RFP: Scheduling Semantics and Convergence

**Status:** Accepted for implementation; architecture frozen on 2026-08-30

**Audience:** Applik8s maintainers, workflow/job/operator authors, provider authors, and reliability reviewers

**Requested by:** The v0.9 semantic-completion and 1.0-readiness program

**Revised:** 2026-08-30

**Target:** Applik8s v0.9 public scheduling contract and 1.0 vocabulary freeze

**Depends on:** Jobs, workflows, actors, managed models, processors, authority, application events,
provider qualification, and the Effect Receipts, Fencing, and Unknown Outcomes RFP

## Executive summary

Applik8s has several legitimate forms of time-based execution: recurring application schedules, one-time
Job and workflow starts, dynamically reconciled schedules, workflow cron triggers, actor alarms, processor
convergence, and managed-resource `requeueAfter()`. Their semantic owners differ, but their identity,
occurrence, time, overlap, misfire, retry, cancellation, history, authority, and provider machinery overlap.

This RFP defines one scheduling algebra and provider contract while preserving those owners. A Job schedule
still starts a Job, an actor alarm remains actor state, and `requeueAfter()` remains reconciliation
lifecycle. The framework shares occurrence storage, time calculation, delivery, receipts, authority, plan,
and conformance instead of exposing several subtly incompatible schedulers.

Provider selection is semantic. Local durable scheduling, Kubernetes controllers, workflow-engine cron,
and EventBridge Scheduler may satisfy a schedule only when their documented precision, overlap, misfire,
history, cancellation, and identity guarantees match. No provider silently weakens a schedule.

## Existing functionality that must not be duplicated

| Capability | Existing boundary to reuse |
| --- | --- |
| Finite execution | `job()` lifecycle and result identity |
| Durable orchestration | Workflow run and schedule contracts |
| Continuous convergence | Managed-model `requeueAfter()` and processor reconciliation |
| Actor time | Actor-owned alarms and serialized state |
| Authority | Shared admission, causal principal, trusted context, and receipts |
| Evidence | Application events, `ApplicationPlan`, diagnostics, and OpenTelemetry |

The implementation consolidates scheduling kernels. It does not introduce a generic callback scheduler or
make all time-based concepts synonyms.

## At a glance

One-time scheduling uses the callable handle:

```ts
await RebuildSearch.schedule(
  { workspaceId },
  { at: new Date("2027-01-01T00:00:00Z") },
);
```

Recurring scheduling is a graph declaration:

```ts
export const NightlyRebuild = RebuildSearch.schedule(
  "search.rebuild.nightly.v1",
  { workspaceId },
  {
    cron: "0 2 * * *",
    timezone: "America/New_York",
    overlap: "skip",
    misfire: { policy: "runOnce", grace: "2h" },
  },
);
```

Dynamic desired schedules reconcile through the same contract:

```ts
await RebuildSearch.schedules.reconcile({
  id: `workspace:${workspace.id}:nightly`,
  input: { workspaceId: workspace.id },
  cron: workspace.settings.rebuildCron,
  timezone: workspace.settings.timezone,
  overlap: "replace",
});
```

Operator lifecycle remains deliberately different:

```ts
Workspace.on.reconcile(async (_workspace, context) => {
  return context.requeueAfter("30s");
});
```

## Semantic owners

| Surface | Owner | Occurrence result |
| --- | --- | --- |
| `Job.schedule` | Job contract | Job run/reference and terminal outcome |
| `Workflow.schedule` | Workflow contract | Workflow run/reference |
| Dynamic handle schedule reconciliation | Application graph desired schedule | Run of the target handle |
| Actor alarm | Actor identity/state | Serialized actor turn |
| `context.requeueAfter` | Managed resource identity | New reconcile attempt |
| Processor convergence | Processor binding | Processor convergence attempt |

The shared scheduler never erases these distinctions. Each occurrence retains its owner and target
contract identity.

## Normative decisions

1. Scheduling has one versioned definition/instance/occurrence algebra and one provider capability model.
2. Time-based surfaces retain distinct semantic owners and public handles.
3. One-time and recurring schedules target normal callable handles; provider callback vocabulary never
   enters application code.
4. Recurring schedules are graph declarations. Dynamically varying schedules are reconciled desired state,
   not hidden timers created inside arbitrary closures.
5. Every schedule declares or inherits timezone, precision, overlap, misfire, retry, cancellation, and
   history behavior.
6. Every occurrence has stable identity and idempotent admission independent of provider delivery IDs.
7. Provider delivery is at least once unless a stronger qualified guarantee is named. Target admission
   deduplicates by semantic occurrence identity.
8. A provider cannot silently change cadence, timezone, overlap, misfire, or history behavior.
9. Updating a schedule has an explicit effective boundary and never silently reinterprets already admitted
   occurrences.
10. Deleting a schedule stops future admission but does not cancel admitted runs unless requested by an
    explicit cancellation policy.
11. Authority and causal identity are captured at schedule creation/reconciliation and revalidated under
    the declared execution policy.
12. Actor alarms, processor convergence, and reconcile wakeups may reuse provider machinery but are not
    application schedules.
13. EventBridge Scheduler, Kubernetes CronJob, and workflow-engine cron are providers, not public semantics.
14. Scheduling provider replacement is a migration with overlap/double-delivery protection.

## Canonical contracts

```ts
interface ScheduleDefinition<TInput> {
  id: string;
  target: string;
  input: TInput;
  timing:
    | { kind: "once"; at: string }
    | { kind: "cron"; expression: string; timezone: string }
    | { kind: "interval"; every: string; anchor?: string };
  precision: "minute" | "second";
  daylightSaving: ScheduleDaylightSavingPolicy;
  overlap: "allow" | "skip" | "queue" | "replace";
  misfire: ScheduleMisfirePolicy;
  retry: ScheduleDeliveryRetryPolicy;
  cancellation: "futureOnly" | "cancelOwnedRuns";
  history: ScheduleHistoryPolicy;
}

type ScheduleMisfirePolicy =
  | { policy: "skip" }
  | { policy: "runOnce"; grace: string }
  | { policy: "catchUp"; maximumOccurrences: number; grace: string };

interface ScheduleDaylightSavingPolicy {
  gap: "skip" | "nextValid";
  overlap: "onceFirst" | "onceSecond" | "twice";
}

interface ScheduleDeliveryRetryPolicy {
  maximumAttempts: number;
  backoff: "fixed" | "exponential";
  initialDelay: string;
  maximumDelay: string;
}

interface ScheduleHistoryPolicy {
  retention: string;
  maximumOccurrences: number;
  payloads: "digests" | "encrypted";
}
```

Every definition has a stable compatibility version. Every installed schedule has a provider-independent
instance identity and generation. Every occurrence records scheduled time, admission time, definition
generation, semantic occurrence ID, target run reference, attempt/delivery evidence, authority receipt,
and terminal disposition.

The public API may use ergonomic overloads, but generated graph/runtime contracts normalize to this model.

Omitted ergonomic options normalize before graph serialization using these stable v0.9 defaults:

| Field | One-time default | Recurring/dynamic default |
| --- | --- | --- |
| timezone | UTC instant from `at` | `"UTC"` when the author omits a timezone |
| precision | `"second"` | `"minute"` for five-field cron; `"second"` for interval |
| daylight saving | `{ gap: "skip", overlap: "onceFirst" }` | same |
| overlap | `"allow"` | `"skip"` |
| misfire | `{ policy: "runOnce", grace: "15m" }` | same |
| delivery retry | `{ maximumAttempts: 5, backoff: "exponential", initialDelay: "1s", maximumDelay: "1m" }` | same |
| cancellation | `"futureOnly"` | `"futureOnly"` |
| history | `{ retention: "30d", maximumOccurrences: 10_000, payloads: "digests" }` | same |

Cron syntax in the stable v0.9 contract is five-field minute precision. Second-precision recurring work uses
an interval or a separately versioned provider-qualified extension; a provider cannot reinterpret a
five-field cron as six-field syntax. Profiles may require authors to choose stricter values, but cannot
silently substitute different defaults. Changing any normalized default after v0.9 is a schedule-contract
compatibility change rather than a provider implementation detail.

`payloads: "digests"` retains input/result digests and authority/evidence references, not plaintext values.
`"encrypted"` is opt-in and requires a qualified encrypted history store plus the normal disclosure and
retention authority. History expiry never removes the minimal occurrence identity needed for admission
deduplication during its declared idempotency window.

## Occurrence identity and admission

Occurrence identity derives from:

```text
application + deployment identity + schedule identity + definition generation + canonical scheduled time
```

Provider delivery IDs are evidence only. Duplicate delivery admits the same target run. A definition
update increments generation and declares the first affected scheduled time. Already admitted occurrences
remain attached to their recorded definition.

For daylight-saving transitions, cron schedules use their named IANA timezone and the normalized
`daylightSaving` policy. The canonical default is `{ gap: "skip", overlap: "onceFirst" }`: a nonexistent
wall-clock occurrence is skipped and a repeated wall-clock occurrence runs at its first instant only.
`nextValid`, `onceSecond`, and `twice` are explicit compatibility-significant alternatives. Occurrence
identity records local scheduled time, timezone database version, UTC instant, and overlap fold so replay
cannot collapse the two instants of `twice`. Providers that cannot reproduce the selected policy fail
planning.

`retry` governs provider delivery and semantic target-admission attempts before one target run is admitted.
After admission, the target Job, workflow, actor, processor, or reconciler owns its own retry policy. The
scheduler never turns a target execution failure into another schedule occurrence. Exhausted delivery
records a terminal failed occurrence with evidence.

## Overlap and misfire

Overlap is evaluated against semantic target runs, not provider processes:

- `allow` admits every occurrence;
- `skip` records a skipped occurrence when a prior owned run is active;
- `queue` retains occurrences and admits them in order;
- `replace` requests cancellation of the prior owned run and admits according to the target's cancellation
  contract.

`replace` is unsupported when the target cannot expose compatible cancellation semantics.

Misfire policy applies when the provider/runtime was unavailable near scheduled time. `catchUp` is bounded;
unbounded historical replay is forbidden. Every skipped or coalesced occurrence remains explainable.

## Dynamic schedule reconciliation

Dynamic schedules are desired resources keyed by stable authored identity. Reconciliation creates,
updates, or deletes provider instances through compare-and-set generation. It never creates duplicate
schedules after a crash between provider mutation and state commit; provider operations use stable
idempotency identity and observation receipts.

If provider acceptance cannot be observed after interruption, the schedule mutation follows the shared
effect contract and remains `unknown`; the reconciler does not create a second provider schedule until it
proves absence or reattaches by stable logical identity.

Changing target input under the same schedule ID is a versioned desired-state update. An incompatible
target contract change requires migration rather than provider patching.

## Lifecycle-owned timers

The shared machinery supports, but does not expose as general schedules:

- managed-resource next-due requests;
- actor alarms;
- processor recovery/convergence wakeups.

These records are scoped to their owner UID and generation. Deleting/finalizing the owner removes or
terminalizes its future wakeups through a UID/fencing precondition so a replacement identity cannot be
affected. Their histories appear under the owner rather than in the application schedule catalog.

## Authority

Creating or reconciling a schedule requires authority over the target operation and schedule identity.
The schedule records immediate principal, causal principal, authority version, trusted-context digest, and
receipt. Occurrence execution uses the declared policy:

- revalidate current authority;
- continue under the original bounded receipt; or
- pause with an actionable authority diagnostic.

Client-authored identity or tenant fields never substitute for the recorded envelope.

## Provider contract

Providers declare:

```ts
interface ScheduleProviderCapabilities {
  precision: readonly ("minute" | "second")[];
  timezones: "iana" | "utcOnly";
  daylightSaving: {
    gap: readonly ("skip" | "nextValid")[];
    overlap: readonly ("onceFirst" | "onceSecond" | "twice")[];
  };
  overlap: readonly ("allow" | "skip" | "queue" | "replace")[];
  misfire: readonly ("skip" | "runOnce" | "catchUp")[];
  oneTime: boolean;
  recurring: boolean;
  dynamicReconciliation: boolean;
  cancellation: boolean;
  occurrenceHistory: boolean;
  maximumDelay?: string;
  maximumSchedules?: number;
}
```

The first maintained providers are a durable local implementation and one deployed implementation.
EventBridge Scheduler may qualify as a delivery/wakeup provider where exact. Kubernetes CronJob may qualify
only for the subset whose overlap, misfire, history, identity, and cancellation semantics it can prove.

A scheduler provider is a composable implementation value. It may accept typed durable-definition store,
delivery, clock, and target-admission implementations, or provide those guarantees as one integrated
implementation. Reconcile wakeups, Job schedules, and workflow schedules may reuse the same scheduler
implementation value without merging their semantic owners or granting mutation authority transitively.

## Graph and plan

The graph records owner, target handle/version, timing, timezone, precision, overlap, misfire, retries,
cancellation, history, authority, and lifecycle policy. The plan shows selected provider, native/emulated
guarantees, occurrence authority, physical identity, limits, cost-relevant cardinality, migration behavior,
and rejected providers.

Plans keep application schedules, actor alarms, reconcile wakeups, and processor timers in separate
semantic sections even when one provider stores them together.

## Events and telemetry

Application-significant facts include schedule created/updated/deleted and occurrence admitted, skipped,
cancelled, or failed when those transitions matter to the application. Provider polls, clock checks,
delivery attempts, and lease heartbeats remain OpenTelemetry.

Schedule facts join `application.events` through versioned handles. Publishing them does not grant schedule
mutation or target invocation authority.

## Compatibility and migration

Changing schedule identity, target contract, timezone interpretation, occurrence identity, overlap, or
misfire semantics is compatibility-significant. Provider replacement uses a migration protocol that:

1. establishes a cutover frontier;
2. prevents double ownership;
3. preserves occurrence/admission receipts;
4. verifies the old provider is quiesced;
5. retains rollback evidence until the declared boundary.

No deployment may run two active providers for one schedule identity without explicit dual-delivery
deduplication evidence.

## Diagnostics

- `SCHEDULE_PROVIDER_INCOMPATIBLE`
- `SCHEDULE_TIMEZONE_UNSUPPORTED`
- `SCHEDULE_DAYLIGHT_SAVING_UNSUPPORTED`
- `SCHEDULE_DELIVERY_RETRY_UNSUPPORTED`
- `SCHEDULE_PRECISION_UNSUPPORTED`
- `SCHEDULE_OVERLAP_UNSUPPORTED`
- `SCHEDULE_MISFIRE_UNSUPPORTED`
- `SCHEDULE_OCCURRENCE_CONFLICT`
- `SCHEDULE_AUTHORITY_CHANGED`
- `SCHEDULE_MIGRATION_REQUIRED`
- `SCHEDULE_OWNER_REPLACED`

## Implementation increments

1. Inventory and normalize existing schedule/cron/one-time/dynamic occurrence contracts.
2. Freeze definition, instance, occurrence, identity, timezone/DST, overlap, misfire, delivery retry,
   history, and authority schemas.
3. Route Job and workflow scheduling through the shared kernel.
4. Adapt actor alarms, managed-model wakeups, and processor convergence without changing their owners.
5. Add durable local and one deployed provider with migration and crash conformance.
6. Add plan, application events, OTel, diagnostics, docs, and compatibility fixtures.

## Acceptance

- Equivalent Job and workflow schedules share occurrence semantics without sharing result types.
- Duplicate provider deliveries create one semantic occurrence and one target admission.
- Timezone/DST, overlap, misfire, update, deletion, and restart behavior pass deterministic clock tests.
- Provider delivery retries cannot create multiple semantic occurrences or target runs, and target retry
  remains owned by the target contract.
- Dynamic reconciliation survives crashes without duplicate provider schedules.
- Deleting an owner cannot cancel timers belonging to a replacement UID.
- Provider replacement cannot double-deliver across its cutover frontier.
- Actor alarms and `requeueAfter()` remain clearly distinct in API, plan, and evidence.
- Unsupported provider guarantees fail before mutation with remediation.

## Non-goals

- one public generic `schedule(callback)` API;
- treating every timer as an application schedule;
- provider-specific cron/application syntax;
- unbounded catch-up;
- exactly-once external effects;
- making EventBridge Scheduler or CronJob semantic authority;
- a general temporal workflow engine.

## Definition of done

Scheduling is ready when every maintained time-based surface has one explicit semantic owner, all shared
identity/occurrence/time/authority/provider behavior uses the canonical algebra, provider limitations are
plan-visible, and no target silently weakens cadence, overlap, misfire, history, or cancellation.
