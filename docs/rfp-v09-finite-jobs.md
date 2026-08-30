# RFP: Finite Jobs

**Status:** Accepted for implementation; architecture frozen on 2026-08-30

**Audience:** Applik8s maintainers, implementing agents, and provider authors

**Requested by:** The v0.9 semantic-completion and 1.0-readiness program

**Revised:** 2026-08-30

**Target:** Applik8s v0.9; stable 1.0 candidate only after the conformance gates in this RFP pass

**Depends on:** Managed closures, application graph, operation authority, scheduling, runtime evidence,
and the Effect Receipts, Fencing, and Unknown Outcomes RFP

**Unblocks:** Query batching, bounded background work, and portable finite execution

## Executive summary

Applik8s already has ordinary async closures, durable workflows, scheduled work, stream processors, and
low-level Kubernetes/container jobs. It does not yet have one application-level contract for finite managed
work that may outlive its caller but does not need durable authored workflow steps.

This RFP introduces application-scoped `job()` registration as that missing semantic boundary. A job is callable like an ordinary typed
function, startable as a durable run, cancellable according to an explicit provider contract, observable
through typed application facts and OpenTelemetry, and portable across maintained execution providers.

The proposal deliberately separates semantic jobs from low-level workload declarations. The canonical
registrar is `application.job(...)`; application modules may bind `const job = application.job` and use the
concise `job(...)` spelling. Existing infrastructure-oriented `app.job(...)` vocabulary moves beneath
`application.workload.*`; it does not remain as an overlapping synonym.

## Current implementation status

The first compatibility-breaking vocabulary increment is implemented. Low-level Kubernetes `Job` and
`CronJob` generation now lives exclusively at `application.workload.job(...)` and
`application.workload.cronJob(...)`; the former top-level spellings have been removed rather than kept as
aliases. This reserves `application.job(...)` for the finite managed execution contract below and makes a
workload declaration visibly different from application behavior before either surface reaches 1.0.

The typed semantic Job handle, local runtime, durable provider, scheduling integration, graph/plan nodes,
and conformance evidence remain implementation work. The vocabulary move alone does not claim the Job
contract is available.

This RFP owns logical run identity, attempt identity, input/result/progress/cancellation contracts,
idempotency scope, retry and interruption semantics, authority and causal attribution, scheduling
integration, graph/plan representation, and provider conformance. It does not own workflow history,
arbitrary exactly-once side effects, or provider-specific batch APIs in application code.

`application.job()` defines finite managed work that may outlive its caller but does not require a workflow's durable orchestration history.

## Existing functionality that must not be duplicated

| Capability | Existing boundary to reuse |
| --- | --- |
| Serializable execution | Managed-closure discovery, bundling, dependency inference, and host execution |
| Durable orchestration | `workflow()` and its provider/runtime contracts |
| Immediate typed work | Ordinary callable operations and model methods |
| Infrastructure workloads | Application workload/container deployment graph |
| Scheduling | Existing static, dynamic, and one-time scheduling machinery |
| Authority | Principal, causal principal, trusted context, authority version, and receipts |
| Evidence | Application events, plan/explain, and OpenTelemetry |

The job implementation extends these shared kernels. It must not create a second closure compiler,
authorization envelope, scheduler, envelope codec, or observability system.

## At a glance

```ts title="src/jobs/rebuild-search.ts"
import {
  RebuildSearchError,
  RebuildSearchInput,
  RebuildSearchResult,
} from "../contracts/search";
import { application } from "../app";

const job = application.job;

export const RebuildSearch = job(
  "search.rebuild.v1",
  {
    input: RebuildSearchInput,
    output: RebuildSearchResult,
    progress: type({ indexed: "number.integer >= 0" }),
    error: RebuildSearchError,
  },
  {
    retries: 3,
    timeout: "30m",
    idempotencyKey: input => input.workspaceId,
  },
  async (input, execution) => {
    let indexed = 0;
    for await (const page of DocumentsForWorkspace.pages({
      workspaceId: input.workspaceId,
    })) {
      execution.throwIfCancelled();
      await SearchIndex.replace(page.rows);
      indexed += page.rows.length;
      await execution.progress({ indexed });
    }

    return { indexed };
  },
);

const result = await RebuildSearch({ workspaceId });
const run = await RebuildSearch.start({ workspaceId });
await run.cancel("Superseded by a newer rebuild");
```

## Use this when

- work is finite but may take longer than an HTTP request;
- the caller needs a typed result, progress, cancellation, or a durable run reference;
- execution should move between local, Kubernetes, and cloud batch providers;
- retrying the whole attempt is valid under an explicit idempotency contract.

Do not use a job for multi-step durable orchestration, waiting on human signals, or logic that must resume at authored checkpoints. Use `application.workflow()` (or a local `workflow` alias bound from it) for those cases. Do not use it for an always-running service; use `application.workload.*`.

## Problem statement

Without a semantic job, users must choose between an ordinary promise that is tied to the caller, a
workflow that is heavier than the problem, or infrastructure-level workload construction that exposes
deployment concerns. Those alternatives fragment invocation, scheduling, progress, result, cancellation,
authority, and provider behavior.

The framework needs one finite-execution noun whose guarantees remain honest under process interruption,
provider replacement, duplicate admission, cancellation, and upgrades.

## Normative decisions

1. `application.job(...)` is the only application-level registrar. A bare `job(...)` in application source
   is a normal local alias bound from that registrar, not an ambient framework registry.
2. Direct invocation and `start()` address one logical execution contract, not separate APIs.
3. Logical runs and provider attempts have distinct durable identities.
4. Caller timeout never silently means durable-run cancellation.
5. Idempotency includes trusted context and authority scope.
6. Retry does not imply exactly-once external effects.
7. Causal principal survives scheduling, retry, provider handoff, nested agents, and task execution.
8. Application-significant lifecycle facts and operational telemetry remain distinct.
9. Provider differences are represented in requirements, plans, and evidence, not provider-shaped domain
   syntax.
10. Existing infrastructure jobs move beneath `application.workload.*`; v0.9 does not freeze a permanent synonym.

## Architectural boundary

Applik8s owns the semantic declaration, typed handle, admission and authority envelope, durable run/result
contract, inferred graph requirements, provider selection, plan, lifecycle facts, and conformance suite.

Providers own queueing, worker acquisition, cancellation mechanics, attempt leases, runtime isolation, and
physical result storage while satisfying the semantic contract. Applications own business idempotency and
the correctness of non-framework external effects.

The [Effect Receipts, Fencing, and Unknown Outcomes
RFP](./rfp-v09-effect-receipts-fencing-and-unknown-outcomes.md) owns effect identity, guarantee
classification, receipts, fencing, cancellation races, retries, and honest unknown outcomes. This RFP
owns Job admission, attempts, results, progress, and terminal lifecycle over those effects.

## Public contract

The canonical registrar is `application.job(...)`. Application modules may use
`const job = application.job` so declarations remain visually function-native without relying on ambient
registration. Low-level Kubernetes/container jobs live under `application.workload.job(...)` and are not
interchangeable with semantic jobs.

This follows the existing workflow rule: `application.workflow(...)` owns graph registration and provider
assembly, while `const workflow = application.workflow` is the concise authoring spelling. Package-level
contract factories may remain context-free only when they are later installed through
`application.include(...)`; a global helper may not mutate hidden process state or guess its owning
application.

The existing function-native single-step workflow overload is migrated deliberately. A declaration whose
entire public meaning is one retryable finite effect becomes a Job. A Workflow remains appropriate only
when durable authored steps, waits, signals, child orchestration, or replay history are part of its
contract. The compiler emits a migration diagnostic rather than keeping two equivalent spellings.

Every job has:

- a stable logical identifier;
- typed input, output, progress, error, and cancellation reason;
- one logical run identity and one or more attempt identities;
- an immediate principal, causal principal, authority version, and trusted context;
- a declared retry, timeout, cancellation, and idempotency contract;
- application facts for meaningful lifecycle transitions;
- OpenTelemetry for operational attempt detail.

The optional authored `error` schema describes expected domain failures. A closure reports one through
`execution.fail(error)`, whose return type is `never`, so normal successful control flow still returns only
the declared output. Unexpected exceptions do not masquerade as domain errors: the runtime normalizes and
redacts them as framework-owned execution failures.

```ts
type JobFailure<TError> =
  | { kind: "application"; error: TError }
  | {
      kind: "execution";
      code: string;
      message: string;
      retryable: boolean;
      evidence?: EvidenceReference;
    }
  | {
      kind: "provider";
      provider: string;
      code: string;
      message: string;
      retryable: boolean;
      evidence?: EvidenceReference;
    };

type JobTerminalOutcome<TOutput, TError = never> =
  | { status: "succeeded"; output: TOutput }
  | { status: "failed"; failure: JobFailure<TError> }
  | { status: "cancelled"; reason?: string }
  | { status: "timedOut"; deadline: string };
```

The callable handle and `run.result()` both return `Promise<TOutput>`. A non-successful terminal outcome
rejects with a typed `JobRunError<TError>` containing the serializable run reference and complete terminal
outcome. Callers that want data rather than control-flow errors use `run.outcome()` and receive
`JobTerminalOutcome<TOutput, TError>`. Providers may not make these three paths behave differently.

Cancellation and execution timeout are distinct terminal outcomes, not authored application errors. When
no `error` schema is declared, only framework-owned failure variants are available.

Direct invocation waits for the typed terminal result:

```ts
const result = await RebuildSearch(input, {
  wait: { timeout: "30s" },
});
```

`start()` returns immediately with a serializable run reference:

```ts
const run = await RebuildSearch.start(input, {
  idempotencyKey: `workspace:${input.workspaceId}`,
});

await run.result();
await run.cancel("No longer needed");
```

Caller timeout and job cancellation are distinct. A timed-out caller does not cancel a durable run unless it explicitly requests that behavior.

The declaration option `timeout` is the Job execution deadline. Invocation option `wait.timeout` bounds
only how long this caller waits. Reusing the bare name `timeout` for both contracts is forbidden.

When direct invocation reaches its caller timeout, it rejects with a typed `JobInvocationTimeoutError`
containing the durable `run` reference. The caller can immediately rejoin without reconstructing an
idempotency key:

```ts
try {
  await RebuildSearch(input, { wait: { timeout: "30s" } });
} catch (error) {
  if (error instanceof JobInvocationTimeoutError) {
    return error.run;
  }
  throw error;
}
```

This caller timeout is not the Job's execution deadline and emits no `timedOut` Job fact.

## Identity and idempotency

The logical job ID is part of the durable compatibility contract. Renaming or reusing it is a plan-visible migration.

An idempotency key is scoped by:

```text
application + deployment identity + job contract version + trusted context digest + authority scope
```

The same scoped key returns the existing run or terminal receipt. A different input under the same scope fails with a deterministic conflict; it never silently aliases work.

## Lifecycle

```text
declared -> admitted -> queued -> running -> succeeded
                                      |-> failed
                                      |-> cancelled
                                      |-> timedOut
```

Infrastructure interruptions create attempts, not new logical runs. Providers must preserve terminal-result uniqueness across retries and worker replacement.

### Terminal linearization

The Job result authority permits exactly one atomic transition from non-terminal state to:

```text
succeeded | failed | cancelled | timedOut
```

The first durable compare-and-set wins. Terminal state is immutable.

A cancellation request is a durable request receipt, not itself a terminal outcome. While cancellation is
being delivered, the running attempt may still complete. If `succeeded` or `failed` terminalizes first,
`cancel()` returns `alreadyTerminal` with that outcome. If `cancelled` terminalizes first, a later provider
success cannot replace it and is retained only as late-attempt evidence. A Job execution deadline races
under the same rule through the `timedOut` transition.

```ts
type JobCancellationResult<TOutput, TError = never> =
  | { status: "requested"; receipt: JobCancellationReceipt }
  | { status: "alreadyTerminal"; outcome: JobTerminalOutcome<TOutput, TError> };
```

After `requested`, callers use `run.result()` or observe the run to learn which terminal outcome won.

This makes cancellation honest: acceptance means the runtime will attempt the declared cancellation
behavior, not that arbitrary external effects are guaranteed to stop.

Cancellation is cooperative first and bounded-forceful second:

1. record the cancellation request durably;
2. signal the active attempt;
3. give the closure a bounded cleanup window;
4. terminate the provider workload when supported;
5. publish exactly one terminal cancellation outcome.

A provider that cannot support the declared cancellation level fails planning with `JOB_CANCEL_UNSUPPORTED`.

## Effects and retries

The framework does not pretend arbitrary side effects are exactly once. A retryable job must use one or more of:

- idempotent callable operations;
- framework transactions/outboxes;
- provider receipts;
- an authored deduplication key;
- a workflow when effects require durable step boundaries.

The plan records the effective retry policy and warns when an effectful dependency has no compatible retry
evidence. An accepted but unobserved external effect becomes `unknown`; a Job may not report failed,
cancelled, or safely retryable merely because its worker disappeared.

## Authority and causality

Job admission records the trusted execution envelope. Every attempt hydrates both:

- `principal`: the workload/execution identity allowed to act now;
- `causalPrincipal`: the authenticated identity that initiated the chain.

Retries, schedules, nested agents, and provider handoffs preserve causal lineage. A job never accepts client-authored identity fields as trusted metadata.

Runtime access is inferred from the closure dependency graph. It does not widen domain authority.

## Events and telemetry

Application-significant facts include:

```ts
RebuildSearch.events.started
RebuildSearch.events.progressed
RebuildSearch.events.succeeded
RebuildSearch.events.failed
RebuildSearch.events.cancelled
RebuildSearch.events.timedOut
```

`Job.events.progressed` is a durable, coalesced progress snapshot governed by the declared publication
policy. Individual `execution.progress()` calls are not each promised as independently replayable
application facts. Worker acquisition, retries, heartbeats, and provider polling remain OpenTelemetry
signals unless explicitly promoted.

## Retention and expiration

Every Job declares or inherits separate retention for terminal results, progress snapshots, application
facts, and provider attempt evidence. Stable defaults are published per profile and appear in the plan.
Expiration never changes the terminal state: it removes payload availability while retaining the minimal
run identity and terminal digest required for idempotency and diagnostics.

`run.result()` and `run.outcome()` fail with `JOB_RESULT_EXPIRED` when their required payload has expired;
they never return an empty or reconstructed value. Progress subscriptions begin with the latest retained
snapshot and expose a retention-floor error when requested history is unavailable. Extending retention is
a deployment policy and shortening it is a compatibility/lifecycle change for active runs.

## Scheduling

One-time and recurring scheduling target the same job handle:

```ts
await RebuildSearch.schedule(input, {
  at: new Date("2027-01-01T00:00:00Z"),
});
```

Recurring schedules are declarations in the application graph, not hidden timers created by a closure. Dynamic schedule reconciliation uses the shared scheduling contract and remains plan-visible.

The [Scheduling Semantics and Convergence RFP](./rfp-v09-scheduling-semantics-and-convergence.md) owns
definition/instance/occurrence identity, timezone, overlap, misfire, history, authority, and provider
migration. Job scheduling contributes the typed target input and Job run/result/cancellation semantics; it
does not fork those shared rules.

## Graph and plan

The semantic graph records:

- job contract identity and version;
- closure artifact and dependencies;
- authority requirements;
- retry/cancellation/deadline/idempotency semantics;
- selected provider and provider guarantees;
- queue, result, progress, and event authorities;
- schedule declarations;
- capacity and cost-relevant hints.

`applik8s plan` explains why a provider was selected and which guarantees are native, emulated, or unsupported.

## Provider lowering

Required conformance implementations:

| Implementation | Expected lowering |
| --- | --- |
| `JobRuntime.local(...)` | bounded worker pool with durable local run/result state |
| `JobRuntime.kubernetes(...)` | provider-neutral controller/queue plus finite workload execution |
| `JobRuntime.aws(...)` | maintained batch/serverless lowering selected by declared requirements |

Provider conformance tests cover admission, duplicate admission, retry, interruption, cancellation before
and after completion, deadline races, direct caller timeout/rejoin, result hydration, progress, causal
identity, and upgrade compatibility.

No provider-specific handle leaks into application code.

A maintained `JobRuntime` is an ordinary composable implementation value. It may be integrated or assembled
from typed queue, execution-host, result/progress-store, event/outbox, and scheduler implementations. Those
dependencies follow the canonical implementation algebra: inline dependencies remain private, capability
references consume separately selected bindings, reuse preserves one identity, and no nested queue or
compute authority enters the Job closure implicitly.

Every stable `JobRuntime` declares how it satisfies these slots:

```ts
interface JobRuntimeDependencies {
  queue: ImplementationDependency<JobQueue>;
  executionHost: ImplementationDependency<FiniteExecutionHost>;
  results: ImplementationDependency<JobResultProgressStore>;
  scheduler: ImplementationDependency<Scheduler>;
  events: ImplementationDependency<ApplicationEventPublication>;
  artifacts?: ImplementationDependency<ObjectStorage>;
}
```

An integrated implementation may construct private adapters internally, but the compiled implementation
graph still exposes each slot, identity, guarantee, lifecycle, and provider-internal authority. Passing an
`EventLog` where a queue or result store is required is valid only through a typed adapter such as
`Queue.jetStream({ eventLog })`; structural method similarity is not sufficient.

An `EventLog` implementation may satisfy `ApplicationEventPublication` directly when its declared type and
evidence include transactional or receipted publication; otherwise the profile supplies an explicit
publication adapter. The compiler never infers this from similar methods.

The normative AWS and Kubernetes profiles qualify all slots. Queue delivery, target execution retry,
scheduled admission, result retention, progress coalescing, and event publication remain distinct
semantic authorities even when one physical service implements several slots.

## Compatibility

Changing input/result schemas, identity, idempotency scope, or terminal semantics produces an explicit compatibility diagnostic. Existing runs continue under their recorded contract version.

Generated artifacts carry the job contract version required to resume or inspect them. A runtime must reject an artifact it cannot interpret rather than guessing.

## Diagnostics

Required stable diagnostics include:

- `JOB_PROVIDER_UNSUPPORTED`
- `JOB_CANCEL_UNSUPPORTED`
- `JOB_IDEMPOTENCY_CONFLICT`
- `JOB_EFFECT_RETRY_UNSAFE`
- `JOB_CONTRACT_INCOMPATIBLE`
- `JOB_RESULT_EXPIRED`

Each diagnostic names the job, source declaration, selected profile/provider, physical execution host,
missing guarantee, and concrete remediation.

## Implementation increments

1. Freeze vocabulary, migrate finite single-step workflows, and move low-level `app.job(...)` beneath
   `application.workload.*`.
2. Implement local run/result/cancel/progress semantics.
3. Compile closure dependencies, authority, and causal envelopes.
4. Add one deployed provider with interruption recovery.
5. Unify one-time and recurring scheduling around job handles.
6. Add lifecycle event handles, OTel, plan, and migration evidence.

## Acceptance

- Direct call and `start()` return the same typed result semantics.
- Duplicate scoped idempotency keys never run twice.
- A killed worker resumes or retries without duplicating the terminal result.
- Direct invocation timeout returns a usable run reference without terminating the Job.
- Success/cancellation/deadline races converge to the first durable terminal transition.
- Cancellation behaves according to the declared provider capability.
- Causal identity survives schedules, retries, and nested calls.
- Local and one deployed provider pass the same black-box conformance suite.
- Result/progress retention and expiration fail explicitly rather than returning incomplete values.
- Clean-context users choose an application Job over a Workflow and workload Job without coaching, while
  understanding that local `job(...)`/`workflow(...)` spellings are aliases of application-owned registrars.

## Non-goals

- durable authored checkpoints;
- human-signal orchestration;
- arbitrary exactly-once side effects;
- provider-specific batch APIs in domain code;
- an unbounded worker/service primitive.

## Definition of done

`application.job()` is stable-candidate only when its lifecycle, identity, authority, interruption, cancellation, retry, result, scheduling, graph, plan, and provider conformance contracts are evidenced end to end.
