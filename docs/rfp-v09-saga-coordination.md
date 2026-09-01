# RFP: Saga Coordination

**Status:** Accepted release-blocking beta contract; architecture frozen on 2026-08-30

**Audience:** Applik8s maintainers, implementing agents, provider authors, and reliability reviewers

**Requested by:** The v0.9 semantic-completion and 1.0-readiness program

**Revised:** 2026-08-30

**Target:** Applik8s v0.9 beta; explicitly non-blocking for 1.0

**Depends on:** Workflow durability and the Effect Receipts, Fencing, and Unknown Outcomes RFP

## Executive summary

Applik8s supports local database transactions, durable workflows, typed operations, authority receipts,
and provider-neutral execution. Applications still need a concise way to coordinate a small number of
distributed effects with explicit compensation and honest unknown-outcome handling.

This RFP introduces `application.transaction.saga(...)`. It is not distributed ACID and does not hide
two-phase commit. A Saga records each effect inside an explicit `step`, records its compensator before the
effect may become externally visible, and compensates committed steps in reverse order after failure.

The surface is beta in v0.9, but it is a committed release deliverable. It may ship only with one realistic
deployed durable-provider scenario proving crash recovery, idempotency, compensation, irreversible
boundaries, authority, upgrade, and honest unknown outcomes. Failure to qualify it blocks v0.9. Removing
the Saga export, graph disposition, documentation, examples, diagnostics, or maturity claim is not an
acceptable substitute. A reserved or ordinary-use fail-closed public node is not a beta implementation.

## Existing functionality that must not be duplicated

| Capability | Existing boundary to reuse |
| --- | --- |
| Durable execution | `workflow()` and maintained workflow providers |
| Callable effects | Typed operations/model methods and managed closure discovery |
| Local atomicity | Existing relational transaction/outbox kernel |
| Authority | Immediate/causal principal and authorization receipts |
| Evidence | Application events, plan/explain, OpenTelemetry, workflow run evidence |

Saga is a constrained semantic layer over these kernels. It must not create another workflow engine,
transaction log, permission language, or provider-specific activity API.

## At a glance

```ts title="src/checkout/checkout.ts"
export const Checkout = application.transaction.saga(
  "checkout.v1",
  {
    input: CheckoutInput,
    output: CheckoutResult,
  },
  async (input, tx) => {
    const reservation = await tx.step(
      "reserve-inventory",
      () => Inventory.reserve({ items: input.items }),
      {
        compensate: reservation =>
          Inventory.release({ reservationId: reservation.id }),
      },
    );

    const charge = await tx.step(
      "charge-payment",
      () => Billing.charge({ amount: input.total }),
      {
        compensate: charge => Billing.refund({ chargeId: charge.id }),
      },
    );

    const order = await tx.commit("create-order", () =>
      Order.create({ input, reservationId: reservation.id, chargeId: charge.id }),
    );

    return { orderId: order.id };
  },
);
```

## Problem statement

Ordinary functions cannot recover safely after a process crashes between distributed effects. A workflow
can implement compensation, but without a constrained contract it cannot prove that every effect has a
registered recovery path or distinguish reversible, committed, and intentionally irreversible work.

The framework needs an honest, inspectable coordination primitive for compensation—not a misleading
`transaction()` spelling that implies atomic rollback.

## Normative decisions

1. The public name is `application.transaction.saga(...)`; bare distributed `transaction()` is forbidden.
2. Effectful application calls inside a Saga occur only within `step`, `commit`, or `irreversible`.
3. A compensator and its durable metadata are recorded before a reversible effect may escape.
4. Committed reversible steps compensate in reverse committed order.
5. Unknown provider outcomes remain `unknown`; the runtime never guesses success or failure.
6. Compensation is at-least-once and must be idempotent.
7. Compensation runs with a framework workload identity while preserving the causal initiator and receipt.
8. Authority revalidation behavior is explicit per step; it never silently widens authority to finish.
9. Code and schema upgrades are run-versioned and plan-visible.
10. Saga remains beta until crash matrices and provider conformance are convincing.
11. Every step, commit, and irreversible boundary has an explicit stable authored ID; source position is
    diagnostic evidence, not durable identity.
12. Cancellation and execution deadlines resolve through the same durable recovery state machine as
    failure; they never abandon a prepared or unknown effect.

## Architectural boundary

Applik8s owns Saga identity, compiler-enforced effect boundaries, step/compensation relationships,
authority, durable receipts, outcome semantics, graph/plan, and evidence. The workflow provider owns
durable scheduling and attempt recovery. Applications own forward effects, compensators, business
idempotency, and the decision to cross an irreversible boundary.

Compiler enforcement is deliberately bounded. It recognizes branded Applik8s operations/capabilities and
their recursively discovered calls using the shared effect metadata. It does not claim a sound effect
system for arbitrary SDK clients, dynamic imports, reflection, native addons, or untyped libraries. Such
calls inside a Saga closure must be wrapped in an explicit effect contract, placed inside
`irreversible(...)` with honest semantics, or rejected as `SAGA_EFFECT_UNCLASSIFIED`. A raw network or SDK
call cannot evade recovery merely because static analysis failed to name it.

`irreversible(...)` classifies compensation, not transport safety. A typed capability call inside it retains
its declared idempotency, fencing, receipt, observation, cancellation, and unknown-outcome guarantees. An
otherwise unclassified raw SDK/network call admitted only because it is inside `irreversible(...)` is
normalized as `unfencedExternal`: interruption may produce `unknown`, automatic retry is forbidden unless
absence is later proven, and plan/evidence identifies the exact unsound boundary. `irreversible(...)` never
turns an untracked effect into a known success or bypasses the shared effect receipt state machine.

The
[Effect Receipts, Fencing, and Unknown Outcomes RFP](./rfp-v09-effect-receipts-fencing-and-unknown-outcomes.md)
owns logical effect identity, provider acceptance, fencing, idempotency, receipts, cancellation races,
disclosure, and unknown resolution. Saga owns ordering, compensation, and commit boundaries over those
effects.

## Step kinds

### `step`

A reversible effect with a typed result and compensator. The runtime records intent, recovery closure,
idempotency identity, and authority evidence before invoking the effect.

The first argument is a stable ID unique within the Saga contract version. Renaming, reusing, or changing
its result/compensation contract is plan-visible and requires an in-flight-run migration or a new Saga
version.

### `commit`

A durable boundary after which earlier reversible steps are considered part of the accepted outcome. A
later failure does not compensate across a commit boundary. v0.9 has no implicit or configurable
cross-commit compensation group: effects that must roll back together remain before one commit. A broader
grouping API requires a separate contract amendment.

The commit participant must expose an idempotent invocation identity and an observation/reconciliation
contract capable of distinguishing committed, absent, and still-unknown outcomes. An effect without that
contract must be declared `irreversible` rather than presented as a safely observable commit.

### `irreversible`

An effect that cannot be compensated, such as sending an external legal notice. It requires an explicit
reason and must appear in plan/evidence. Planning warns when irreversible work precedes fallible reversible
work.

## Recovery protocol

Each step progresses through durable states:

```text
declared -> prepared -> invoked -> observed -> committed
                         |           |-> unknown
                         |-> failed
```

On failure, the runtime walks the committed reversible frontier backward. Each compensation has its own
attempt history and terminal evidence. A failed compensation produces a durable `compensationFailed`
outcome and operator action; it is never reported as a clean rollback.

Crash tests cover every boundary before and after intent, effect, observation, commit, compensation, and
workflow-history writes.

## Commit state machine and unknown outcomes

The commit effect has its own durable state machine:

```text
prepared -> invoked -> observed -> committed
                   |             |-> failed
                   |-> unknown <-+
```

`prepared` records the commit identity, input digest, idempotency key, authority receipt, and observer before
invocation. The outcomes are:

- **committed** — provider evidence proves the authoritative commit exists; the Saga terminalizes normally;
- **failed** — provider evidence proves the commit did not occur; the runtime may compensate the still-open
  reversible frontier;
- **unknown** — the effect may or may not exist; the Saga terminalizes neither success nor compensation and
  enters `outcomeUnknown` recovery.

An unknown commit never triggers automatic compensation. Doing so could release inventory or refund a
payment while the Order actually exists. Recovery repeats the idempotent commit or invokes its observer
under the recorded contract. If observation later proves absence, compensation may begin. If it proves
presence, the Saga records committed success. If it cannot converge before the declared deadline, operator
evidence and remediation remain required.

## Authority

The original admission records immediate and causal principals, trusted context, authority version, and
receipts. Each step declares whether it:

- requires current authority revalidation;
- may continue under its original receipt;
- requires a framework-owned recovery grant.

Compensation never accepts identity from application payloads. Losing a user's current permission does not
silently grant the workload new domain rights; the contract must define whether recovery may proceed under
the recorded receipt or pause for operator resolution.

## Cancellation, deadlines, and composition

A Saga declares an execution deadline and cancellation policy. Cancellation stops admission of new
forward steps, observes any invoked or unknown step to a safe state, then compensates the current
uncommitted reversible frontier. It cannot interrupt an external effect and assume absence. If observation
cannot resolve before the recovery deadline, the Saga remains `unknown` with operator action.

Cancellation never compensates across the last durable commit. Compensation is not cancelled merely
because the initiating request disappeared; it proceeds or pauses according to its recorded recovery
grant.

A Saga may be called from an operation, Job, agent, or workflow. Directly nesting a Saga inside a Saga
step is forbidden in v0.9 because it creates competing compensation authorities. A Saga also cannot
contain raw workflow waits or human signals; a surrounding workflow invokes the Saga at a bounded point.

## Graph and plan

The graph records Saga identity/version, input/output contracts, ordered step identities, effect and
compensation dependencies, idempotency, authority policy, commit/irreversible boundaries, provider
requirements, and retention.

The plan identifies irreversibility, unsupported compensation semantics, version migrations, and any step
whose provider can return an ambiguous outcome.

## Provider lowering

The first maintained lowering may use Hatchet or the existing workflow provider, but provider vocabulary
does not enter domain code. Conformance covers duplicate delivery, worker loss, provider failover,
cancellation, compensation interruption, unknown results, and code upgrades.

The Saga coordinator is a composable implementation value over a qualified Workflow engine plus typed
receipt/effect-store dependencies. It may consume a separately provided Workflow engine or inline a
private implementation. Reuse preserves one engine identity while Saga authority, history, and receipts
remain separate semantic nodes; nested engine credentials and operations never enter Saga closures.

## Events and evidence

Application facts include Saga started, committed, failed, compensated, compensation failed, and outcome
unknown. Per-attempt polling and worker mechanics remain OpenTelemetry.

The operations UI can explain the forward and reverse path, causal identity, receipts, failure source,
and remaining operator action without exposing secret inputs.

## Diagnostics

- `SAGA_EFFECT_OUTSIDE_BOUNDARY`
- `SAGA_EFFECT_UNCLASSIFIED`
- `SAGA_COMPENSATION_FAILED`
- `SAGA_OUTCOME_UNKNOWN`
- `SAGA_IRREVERSIBLE_ORDER_UNSAFE`
- `SAGA_AUTHORITY_RECOVERY_BLOCKED`
- `SAGA_VERSION_INCOMPATIBLE`
- `SAGA_COMMIT_OUTCOME_UNKNOWN`
- `SAGA_STEP_ID_CONFLICT`
- `SAGA_NESTING_UNSUPPORTED`

## Implementation increments

1. Freeze step/commit/irreversible vocabulary and compiler restrictions.
2. Implement durable step and compensation receipts on one workflow provider.
3. Add commit prepared/invoked/observed state, unknown-outcome reconciliation, and authority recovery
   contracts.
4. Add upgrade/version and interruption matrices.
5. Add plan, application facts, OTel, and operations evidence.

## Acceptance

- Branded/inferred effects outside explicit boundaries fail compilation; arbitrary unclassified SDK or
  network effects fail the stable Saga closure boundary unless explicitly wrapped or irreversible.
- Stable duplicate/reused step IDs and unsupported nested Saga composition fail compilation.
- Every crash point converges to success, compensated failure, compensation failure, or honest unknown.
- A crash or timeout around the commit effect never causes compensation until commit absence is proven.
- Compensation order and idempotency are deterministic.
- Authority and causal attribution survive forward and reverse execution.
- Cancellation/deadline at every prepared/invoked/unknown boundary converges through the same recovery
  protocol and never compensates across a commit.
- Upgrading code does not reinterpret an in-flight Saga silently.
- A realistic checkout proves the contract end to end.

## Non-goals

- distributed ACID;
- hidden two-phase commit;
- automatic compensation synthesis;
- guaranteed reversal of irreversible external effects;
- a replacement for ordinary local transactions or general workflows.

## Definition of done

The beta may ship when one maintained provider passes the full interruption/compensation matrix and the UI,
plan, and diagnostics state exactly what happened. Promotion beyond beta requires materially broader
provider evidence. If that qualification gate is not met, v0.9 is not ready.
