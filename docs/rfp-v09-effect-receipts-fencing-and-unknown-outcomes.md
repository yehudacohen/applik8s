# RFP: Effect Receipts, Fencing, and Unknown Outcomes

**Status:** Accepted; architecture frozen; release-blocking for stable effectful v0.9 surfaces

**Revised:** 2026-08-30

**Target:** Shared v0.9 effect-safety contract for reconcilers, Jobs, workflows, Sagas, processors,
commands, agents, and provider operations

**Depends on:** Capability authority, causal identity, transaction/outbox contracts, durable execution,
and provider error classification

**Coordinates with:** The Public Contract and Compatibility Freeze RFP, which catalogs the resulting
effect schemas and maturity without redefining effect safety

**Unblocks:** Honest portable retries and stale-worker safety without claiming universal exactly-once
effects

## Executive summary

An execution lease can fence framework state. It cannot retract an email, charge, deployment, database
write, or arbitrary SDK request already accepted by another system. Applik8s therefore needs one shared
effect protocol that distinguishes admission, dispatch, provider acceptance, durable receipt, cancellation,
and unknown outcome.

This RFP defines that protocol. Stable effectful surfaces use branded Applik8s operations with declared
identity, authority, idempotency, fencing, and receipt semantics. Raw SDK effects remain possible only as
explicitly unsafe or provider-classified boundaries; the compiler does not pretend it can infer arbitrary
JavaScript effects soundly.

## Normative decisions

1. Exactly-once external side effects are never a framework-wide promise.
2. Every managed effect has stable logical effect identity and distinct attempt identity.
3. Framework-state fencing and dependency-enforced effect fencing are separate guarantees.
4. A provider may claim a completed effect only from a durable provider or framework receipt.
5. Timeout, cancellation, transport failure, and worker loss may produce `unknown`; they do not prove the
   effect was absent.
6. Automatic retry is allowed only when absence is proven or the effect is idempotent under the same
   logical identity.
7. A stale lease holder cannot commit framework status, lifecycle, checkpoint, or terminal state. It may
   still have caused an unfenced external effect, which is handled through receipt/idempotency/unknown
   semantics.
8. Transactional outbox effects commit intent with authoritative state, but publication and provider
   acceptance remain separately receipted.
9. Compensation is allowed only for a completed effect with a declared compensation contract; unknown
   outcomes require resolution before compensation unless the provider proves compensation is safe.
10. Causal principal, execution principal, authority receipt, and delegated authority are preserved on
    effect admission and audit records.
11. Compile-time effect enforcement applies to branded Applik8s operations and statically identified
    capability calls. Arbitrary libraries and SDKs are outside the sound boundary unless wrapped.
12. Losing or duplicate callers receive policy-controlled receipt summaries and never gain authority to
    inspect secret inputs or another principal's sensitive result.
13. This contract does not add a public `operation()` or `effect()` registrar. Application closures remain
    ordinary TypeScript and become managed only through their owning Job/workflow/processor/reconciler and
    calls to typed model or capability handles.

## Effect contract

```ts
interface EffectContract<TInput, TResult> {
  identity: EffectContractIdentity;
  input: RuntimeSchema<TInput>;
  result: RuntimeSchema<TResult>;
  authority: EffectAuthorityRequirement;
  idempotency: EffectIdempotencyContract;
  fencing: EffectFencingContract;
  receipt: EffectReceiptContract;
  cancellation: EffectCancellationContract;
  retry: EffectRetryContract;
  compensation?: EffectCompensationContract;
}
```

An invocation derives:

```ts
interface EffectInvocationIdentity {
  effect: EffectContractIdentity;
  scope: string;
  logicalId: string;
  attemptId: string;
  causalExecutionId: string;
  causalPrincipalId?: string;
}
```

The logical ID is stable across retries of the same admitted effect. A new user request or intentionally
repeated semantic action receives a new logical ID even when its input is equal.

## Guarantee classes

```text
frameworkFenced
  stale executions cannot commit Applik8s-owned state

dependencyFenced
  dependency rejects attempts with an obsolete fence token

idempotent
  dependency returns the same logical outcome for repeated logical identity

receipted
  durable receipt can prove accepted/completed/failed

transactionalIntent
  effect intent commits with authoritative application state

unfencedExternal
  provider may accept the effect without a usable fence or idempotency key
```

Stable provider contracts state which combination they supply. `frameworkFenced` alone never implies
exactly-once external behavior.

## Developer and provider surface

Application code calls the same typed dependency it would call outside a retry boundary:

```ts
await Mail.send({ to: member.email, template: "welcome" });
```

The `Mail` capability method carries provider-authored effect metadata, and the owning managed closure
supplies logical identity, authority, and attempt context automatically. The application does not wrap the
call in `effect(...)`, construct receipts, or thread fence tokens manually.

Provider authors attach the low-level `EffectContract` through the capability/provider authoring API. A
direct arbitrary SDK call inside a stable managed closure fails with
`EFFECT_UNCLASSIFIED_IN_MANAGED_CLOSURE`; the normal repair is to place that SDK behind a typed capability
provider. `unsafeExternal` is an advanced provider-boundary classification that visibly weakens retry
guarantees, not a convenience escape hatch scattered through domain handlers.

The provider-facing contract is one versioned method definition, not an application registrar:

```ts
const send = defineCapabilityMethod({
  effect: MailSendEffect,
  async invoke(input, provider) {
    return provider.mail.send(input);
  },
  async observe(identity, providerReceipt, provider) {
    return provider.mail.observe(identity.logicalId, providerReceipt);
  },
  async cancel(identity, providerReceipt, provider) {
    return provider.mail.cancel(identity.logicalId, providerReceipt);
  },
});
```

`defineCapabilityMethod(...)` is provider-authoring vocabulary. The generated application handle remains
`Mail.send(input)`. `effect` supplies the complete `EffectContract`; `invoke` performs one provider
attempt; `observe` is required whenever the provider claims receipted, idempotent, or safely retryable
behavior after an ambiguous interruption; and `cancel` is present only when the cancellation contract says
the provider can prove cancellation. The observer returns exactly one of:

```ts
type EffectObservation<TResult> =
  | { status: "succeeded"; result: TResult; evidence: EffectEvidence }
  | { status: "failed"; error: DurableErrorDescriptor; evidence: EffectEvidence }
  | { status: "absent"; evidence: EffectEvidence }
  | { status: "unknown"; evidence: EffectEvidence };
```

Provider-private clients and credentials exist only in `provider`; they never enter the serializable
method handle, application closure, effect receipt, or observation result. A provider that cannot implement
`observe` must declare the corresponding limitation and cannot claim absence-aware automatic retry.

## State machine

```text
declared
  -> admitted
  -> dispatched
  -> accepted
  -> succeeded | failed | cancelled | unknown

unknown
  -> succeeded | failed | absent | operatorResolved

absent
  -> dispatched  (same logical identity, new attempt, only when retry policy permits)

operatorResolved
  -> succeeded | failed | absent  (only from later provider evidence)
  -> declared                     (new linked logical identity for an authorized forced retry)
```

`cancelled` means the provider proved cancellation before completion or the effect never left admission.
A cancellation request racing provider acceptance remains pending or unknown until resolved.

An `absent` resolution is evidence that retry may proceed. It is not inferred from timeout alone.

`operatorResolved` is an administrative disposition, not fabricated provider evidence. It records the
authorized operator, reason, evidence reviewed, chosen recovery action, and acknowledged risk. It cannot
be rewritten as `succeeded`, `failed`, or `absent` unless a provider observer later proves that state. A
forced retry after an unresolved outcome uses a new logical effect identity, exposes the duplicate-effect
risk in plan/operations UI, and never makes the original outcome disappear.

## Receipts

```ts
type EffectReceipt<TResult> =
  | { status: "admitted"; identity: EffectInvocationIdentity; admittedAt: string }
  | { status: "accepted"; identity: EffectInvocationIdentity; providerReceipt: string }
  | { status: "succeeded"; identity: EffectInvocationIdentity; result: TResult }
  | { status: "failed"; identity: EffectInvocationIdentity; error: DurableErrorDescriptor }
  | { status: "cancelled"; identity: EffectInvocationIdentity; cancelledAt: string }
  | { status: "unknown"; identity: EffectInvocationIdentity; lastEvidence: EffectEvidence }
  | {
      status: "absent";
      identity: EffectInvocationIdentity;
      observedAt: string;
      evidence: EffectEvidence;
      safeToRetry: true;
    }
  | {
      status: "operatorResolved";
      identity: EffectInvocationIdentity;
      resolvedAt: string;
      operator: PrincipalReference;
      reason: string;
      evidenceReviewed: readonly EvidenceReference[];
      action: "stop" | "retryWithNewLogicalIdentity" | "awaitFurtherEvidence";
      acknowledgedRisk: string;
    };
```

Receipts are immutable facts. Resolution appends a newer receipt; it does not rewrite history. Provider
receipt identifiers are redacted or encrypted where they carry sensitive material.

`absent` is written only from qualified provider observation and authorizes retry of the same logical
identity according to its retry contract. `operatorResolved` records an administrative disposition but
does not assert provider success, failure, or absence. If its action is `retryWithNewLogicalIdentity`, the
new effect links to the unresolved predecessor and remains visibly at risk of duplication. Receipt readers
receive only the fields their authority permits; another principal's input, result, provider receipt, or
operator evidence is never disclosed merely because they know the logical effect ID.

### Receipt-store authority

`EffectReceiptStore` is framework runtime machinery, not a general application capability and not an
independently selectable database that can violate an owning transaction boundary. For transactional
intent it is colocated with the authoritative transaction/outbox store. For a workflow, Job, actor, or
provider with an integrated durable engine, that engine may implement the same versioned receipt protocol
internally. An assembled runtime exposes the receipt store as a private typed implementation dependency so
its identity, lifecycle, readiness, retention, and migration remain plan-visible without granting callback
access.

One effect invocation has exactly one canonical receipt authority. Mirroring receipts into analytics,
events, or operations views never creates another writer.

## Transaction and outbox boundary

When an authoritative transaction stages an effect, it writes application state, effect intent, causal
identity, authority receipt, and outbox record atomically. A dispatcher later claims the outbox record with
a fence, invokes the provider, and records evidence. A crash after provider acceptance but before receipt
persistence becomes `unknown` unless the provider supports lookup by logical identity.

Direct effects outside a transaction still use the same identity and receipt contract but cannot claim
atomic state/effect intent.

## Reconciler semantics

A reconciler lease fences status, finalizer, next-due, and lifecycle commits. Effectful calls inside a
reconcile attempt must declare one of:

- dependency-fenced execution using the reconcile fence;
- idempotent execution under a stable object/generation/effect identity;
- transactional intent committed with authoritative desired state;
- receipted execution with explicit unknown-outcome handling;
- `unsafeExternal`, which prevents the reconciler/provider combination from claiming automatic safe retry.

The managed-model RFP may promise that stale workers cannot commit framework state. It may promise stale
external-effect rejection only when the selected dependency proves `dependencyFenced`.

## Jobs, workflows, processors, and Sagas

- Jobs preserve logical effect identity across infrastructure attempts.
- Workflow replay reads receipts and never redispatches a completed logical effect.
- Stream processors advance checkpoints only after their effect policy permits acknowledgement.
- Sagas compensate only completed, compensable effects and stop at commit boundaries.
- Agents and tools preserve causal identity and expose unknown outcomes rather than inventing success.

Each owning RFP defines its admission and lifecycle policy while importing this effect state machine.

## Static analysis boundary

The compiler recognizes:

- declared operations and capabilities carrying `EffectContract` metadata;
- direct and recursively discovered calls to branded Applik8s handles;
- provider adapters generated from cataloged effect contracts.

It does not claim sound classification for arbitrary SDK clients, reflection, dynamic imports, native
addons, or untyped network calls. Stable Saga/reconcile enforcement either rejects these in managed
closures, requires an explicit wrapper, or marks the execution as containing unclassified effects.

## Authority and disclosure

Effect admission validates current principal, causal principal, delegated authority, scope, policy version,
and trusted context. Retry never reuses expired authority silently; the contract declares whether the
original admission receipt remains sufficient or reauthorization is required.

Duplicate or losing callers receive one of:

- the full prior result when authorized for it;
- a redacted terminal summary;
- only `alreadyResolved` with receipt identity;
- `notAuthorized` without confirming sensitive effect existence.

## Diagnostics

```text
EFFECT_IDENTITY_UNSTABLE
EFFECT_AUTHORITY_UNAVAILABLE
EFFECT_FENCE_UNSUPPORTED
EFFECT_RETRY_UNSAFE
EFFECT_OUTCOME_UNKNOWN
EFFECT_RECEIPT_CONFLICT
EFFECT_COMPENSATION_UNSAFE
EFFECT_UNCLASSIFIED_IN_MANAGED_CLOSURE
EFFECT_RESULT_DISCLOSURE_FORBIDDEN
```

## Crash matrix

Required conformance tests interrupt:

- before admission commit;
- after admission but before outbox publication;
- after dispatch but before provider acceptance;
- after provider acceptance but before receipt persistence;
- after completion receipt but before caller resumption;
- during cancellation/acceptance races;
- after lease loss but before framework commit;
- during compensation;
- during unknown-outcome resolution.

Tests prove only the guarantees claimed by the selected provider.

## Implementation sequence

1. Freeze effect identity, guarantee classes, receipt schema, and diagnostics.
2. Add branded effect metadata to maintained operation/capability handles.
3. Implement the shared receipt store and transactional outbox integration.
4. Integrate Job, workflow, command, processor, reconciler, and Saga runtimes.
5. Add compiler classification and fail-closed unclassified-effect boundaries.
6. Qualify one dependency-fenced, one idempotent, one receipted, and one unknown-outcome provider.
7. Generate plan/explain and public provider evidence from the contract catalog.

## Acceptance

- Retrying a logical effect never creates a new logical identity accidentally.
- A stale worker cannot commit framework-owned state.
- No provider is described as externally fenced unless it rejects stale fence tokens live.
- Provider acceptance followed by worker death resolves from a receipt or becomes honest `unknown`.
- Qualified observers can append typed `succeeded`, `failed`, or `absent` resolution receipts without
  rewriting the original unknown receipt.
- Administrative resolution appends `operatorResolved` with actor, evidence, action, and acknowledged risk;
  it never masquerades as provider evidence.
- Cancellation races cannot overwrite an accepted/completed receipt.
- Workflow replay and Job retry do not redispatch completed effects.
- Saga compensation never runs for an unproven or unknown original effect.
- Raw/unclassified effects fail stable managed-closure gates or visibly downgrade guarantees.
- Receipt disclosure follows current authority and redaction policy.
- Provider conformance proves `defineCapabilityMethod(...)` invocation, observation, cancellation, Secret
  isolation, and disclosure behavior for every guarantee it claims.

## Non-goals

- distributed XA/2PC;
- universal exactly-once external effects;
- sound static analysis of arbitrary JavaScript libraries;
- automatic compensation generation;
- hiding provider-specific idempotency or lookup limitations;
- converting every ordinary TypeScript function into a managed effect.

## Definition of done

The contract is complete when every stable effectful surface names its logical identity, authority,
fencing, idempotency, receipt, retry, cancellation, compensation, and unknown-outcome semantics and passes
the shared crash matrix without claiming guarantees its provider cannot enforce.
