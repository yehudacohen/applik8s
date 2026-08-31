# RFP: Explainable Domain Decisions — Bounded Investigation

**Status:** Complete; library-only disposition accepted; no first-class primitive

**Audience:** Applik8s maintainers, implementing agents, security reviewers, and application authors

**Requested by:** The v0.9 semantic-completion and 1.0-readiness program

**Revised:** 2026-08-30

**Target:** A closed v0.9 design decision; implementation is non-blocking for 1.0

**Disposition:** See [Explainable domain decisions: library-only disposition](./v0.9-explainable-decision-disposition.md).

## Executive summary

Applik8s already has identity-based and resource-based authorization, operation requirements, trusted
context, authority receipts, and plan/explain evidence. Applications also make domain eligibility
decisions—whether an order is refundable, a post is publishable, or an account qualifies for a limit—that
are important to users but are not always authorization.

This RFP investigates whether those decisions need a first-class `decision()` declaration. The burden of
proof is intentionally high. A new primitive is accepted only if ordinary typed functions, model queries,
operation admission, and transaction hooks cannot provide the required reuse, explanation, dependency
tracking, and evidence cleanly.

The proposal must not create a second permission model. Existing identity/resource authority remains the
only framework authorization authority. Domain decision explanations must also be redacted according to
that authority rather than leaking protected facts.

## Existing functionality that must not be duplicated

| Capability | Existing boundary to evaluate first |
| --- | --- |
| Identity/resource authorization | Existing grants, roles, resource checks, and operation requirements |
| Trusted admission | Principal, causal principal, trusted context, authority version, receipts |
| Domain computation | Ordinary typed functions and callable operations |
| State-dependent validation | Queries, model lifecycle hooks, transactions, and reconcilers |
| Explainability | `applik8s explain`, plan evidence, operation receipts, structured diagnostics |

## Candidate experience

Only if the investigation proves a distinct semantic boundary, the minimal experience should resemble:

```ts title="src/orders/refund-eligibility.ts"
export const RefundEligibility = decision(
  "order.refund-eligibility.v1",
  { input: RefundRequest, subject: Order },
  async input => {
    const order = await Order.get(input.orderId);

    if (order.status !== "paid") {
      return deny("ORDER_NOT_PAID", { status: order.status });
    }

    if (order.refundWindowEndsAt < new Date()) {
      return deny("REFUND_WINDOW_EXPIRED");
    }

    return allow();
  },
);
```

An operation could require the result without redefining authority:

```ts
await RefundOrder(input, {
  requires: RefundEligibility(input),
});
```

This sketch is a hypothesis, not an approved API.

## Problem statement

Domain decisions are frequently duplicated between UI previews, server admission, background jobs,
workflow steps, and audit explanations. Ordinary booleans lose reason codes and dependency evidence.
Authorization APIs are the wrong place for business eligibility and risk conflating “may the principal
act?” with “is the domain action currently valid?”

At the same time, a `decision()` noun could add ceremony, duplicate functions, or become an accidental
policy language. v0.9 must resolve that tension before freezing the 1.0 mental model.

## Questions the investigation must answer

1. Is domain eligibility semantically distinct from identity/resource authorization in common
   applications?
2. Can ordinary typed functions plus a small result helper provide the same DX?
3. Do decisions need graph-visible dependencies for invalidation, plan, or audit?
4. Must results be durable, cacheable, subscribable, or only recomputed?
5. How are reason details redacted for callers who may know the outcome but not the underlying fact?
6. How does a decision compose with operation requirements without becoming authorization?
7. Can a decision be used consistently from UI preview, server admission, jobs, workflows, and tests?
8. Does framework support materially reduce duplicated application code?

## Normative constraints

Any accepted design must preserve these constraints:

1. Existing identity/resource permission models remain authoritative.
2. An `allow` domain result never grants authority the caller does not have.
3. A `deny` result may be returned even when authorization would allow the operation.
4. Decision input cannot assert trusted identity, tenant, or resource scope.
5. Reasons are stable typed codes; human copy is presentation-layer localization.
6. Explanation details are redacted using the same authority model as their source facts.
7. Evaluation records immediate and causal principal, context digest, code version, and dependency
   revisions when it becomes durable evidence.
8. Provider-specific policy languages do not enter application code.
9. The investigation may explicitly reject the primitive.

## Architectural boundary

Existing identity/resource authorization remains wholly authoritative. This investigation may own only a
domain-eligibility result and its explanation/evidence semantics. Applications own the business rule;
Applik8s may own typed invocation, dependency attribution, redaction, and reuse if the prototypes prove
those need framework support.

## Alternatives

### Ordinary function returning a typed result

Lowest ceremony. It may be sufficient if no graph, invalidation, or durable evidence is needed.

### Callable operation in read-only mode

Reuses admission and evidence, but may misrepresent pure evaluation as an effectful operation.

### Query/view

Useful when the result is persistent/live and derived from models, but eligibility may span external
capabilities or invocation context.

### Operation admission hook

Keeps validation next to the mutation, but is harder to reuse for previews and explanations.

### First-class decision

Potentially provides one reusable typed artifact, but risks becoming a second policy system.

## Evaluation prototypes

The investigation implements the same three cases using every viable alternative:

- refund eligibility over relational state and identity/resource authority;
- publication eligibility over a Kubernetes-backed model and moderation evidence;
- spending approval over external risk data with redacted reasons.

Each prototype is judged on declaration size, call-site clarity, reuse, stale-result behavior, authority,
explanation, graph/plan value, testability, and generated client DX.

The review uses one published weighted rubric:

| Dimension | Weight |
| --- | ---: |
| Call-site and declaration clarity | 20% |
| Cross-context reuse without semantic distortion | 20% |
| Authority separation and explanation redaction | 20% |
| Staleness, invalidation, and evidence correctness | 15% |
| Graph/plan/runtime value unavailable to a library helper | 15% |
| Implementation and migration cost | 10% |

A first-class primitive is admitted only when it scores materially better than the library-only option and
the difference comes from distinct graph/runtime semantics rather than preferred spelling. The prototype
fixtures, measurements, clean-context notes, and dissenting assessment are retained as release evidence.

## If a primitive is accepted

The graph must record identity/version, input/output/reason schemas, dependencies, authority required to
evaluate and explain, caching/invalidation policy, and evidence retention. The public result is a typed
discriminated union, never a bare boolean.

Decision evaluation must remain callable like an ordinary function. No `.evaluate()` ceremony is added.

## Diagnostics

Potential diagnostics, only if accepted:

- `DECISION_AUTHORITY_INSUFFICIENT`
- `DECISION_EXPLANATION_REDACTED`
- `DECISION_DEPENDENCY_STALE`
- `DECISION_CONTRACT_INCOMPATIBLE`

## Acceptance decision

The maintainer review produces one of three outcomes:

1. **Reject:** ordinary functions/results are sufficient; document the pattern.
2. **Library only:** provide typed `allow`/`deny` helpers without a graph primitive.
3. **Admit primitive:** evidence proves distinct graph/runtime semantics and a materially better DX.

The decision, rationale, examples, and migration consequences are recorded before the v0.9 public
contract freeze.

The decision must close before `0.9.0-alpha.8`, when the foundational feature freeze begins. If evidence is
incomplete at that boundary, the default disposition is **library only** or **reject**; uncertainty cannot
silently admit a new 1.0 primitive.

## Non-goals

- replacing authorization;
- introducing a policy language;
- granting permissions;
- exposing protected reasons to unauthorized callers;
- blocking 1.0 on a speculative primitive.

## Definition of done

This RFP is complete when the prototypes and clean-context review yield a documented accept/library/reject
decision. Shipping no new primitive is a successful outcome.
