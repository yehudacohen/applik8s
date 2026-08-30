# RFP: Typed ML Models

**Status:** Accepted beta contract; architecture frozen on 2026-08-30

**Audience:** Applik8s maintainers, implementing agents, ML provider authors, and application developers

**Requested by:** The v0.9 semantic-completion and 1.0-readiness program

**Revised:** 2026-08-30

**Target:** Applik8s v0.9 beta; explicitly non-blocking for 1.0

## Executive summary

Applik8s has provider-neutral AI models and agent execution. Learned predictive models have a related but
different contract: a stable logical model identity, typed features and predictions, explicit artifact and
version provenance, online and batch inference, and deterministic evidence about which provider served a
result.

This RFP introduces `ML.model()`. Application code calls one typed logical model while deployment profiles
bind compatible inference providers. The framework owns schemas, provenance, admission, graph planning,
and conformance. Providers own artifact loading, acceleration, autoscaling, and physical inference.

Training orchestration, feature stores, experiment tracking, and a general ML platform are out of scope.
The surface remains beta unless multiple materially different providers prove the shared contract.

## Existing functionality that must not be duplicated

| Capability | Existing boundary to reuse |
| --- | --- |
| Typed model invocation | Existing AI model/function-native invocation grammar |
| Provider injection | Capabilities, qualifications, profiles, and concrete provider bindings |
| Finite batch execution | `job()` and `Query.onBatch(...)` |
| Artifacts | Object storage, OCI/container artifacts, content identities, plan evidence |
| Authority | Shared admission and runtime-access inference |
| Observability | Application facts, OpenTelemetry, evaluations, and operations UI |

## At a glance

```ts title="src/ml/risk-score.ts"
export const RiskScore = ML.model("risk-score.v1", {
  input: type({
    accountAgeDays: "number.integer >= 0",
    amount: "number >= 0",
    country: "string",
  }),
  output: type({
    score: "0 <= number <= 1",
    version: "string",
  }),
}, {
  capabilities: [ML.predict, ML.batchPrediction],
});

const prediction = await RiskScore({
  accountAgeDays: 45,
  amount: 120,
  country: "US",
});
```

Profiles bind providers without changing the model declaration:

```ts
application.provide(RiskScore, ML.onnx({ artifact: modelArtifact }));
```

The binding target is the logical model's generated implementation token; the ergonomic overload above is
canonical shorthand, not permission for arbitrary callable handles to become provider tokens.

## Problem statement

Calling a raw inference endpoint exposes transport and provider details, loses model/artifact provenance,
and produces inconsistent batch, timeout, retry, and version behavior. Treating predictive inference as a
text-generation model obscures different semantics such as fixed input tensors, calibrated numeric output,
artifact loading, and hardware constraints.

The framework needs one small provider-neutral contract without attempting to become an ML platform.

## Normative decisions

1. `ML.model()` defines a logical predictive contract, not a training pipeline.
2. Input and output are runtime-validated, versioned schemas.
3. Every prediction records logical model, artifact, provider, and serving-version provenance.
4. Application code never names ONNX, Triton, SageMaker, or another provider unless selecting a deployment
   implementation.
5. Online and batch inference share one model contract but may have different provider requirements.
6. Partial batch failures are typed and never silently replaced with missing results.
7. Determinism, latency, hardware, locality, and maximum batch size are explicit provider capabilities.
8. Provider migration cannot silently change a pinned model artifact/version.
9. Authority and sensitive-feature handling use existing framework contracts.
10. The API remains beta until materially different providers pass conformance.

## Architectural boundary

Applik8s owns logical model identity, typed contracts, requirements, artifact/provider provenance,
admission, runtime-access inference, graph/plan, receipts, and conformance. Providers own artifact loading,
physical inference, accelerators, scaling, and native error classification. Applications own feature
meaning, model suitability, business thresholds, and any training pipeline.

## Model identity and provenance

A prediction receipt contains:

- logical model ID and contract version;
- artifact content identity and model version;
- provider implementation/version;
- deployment/endpoint identity;
- feature schema version;
- invocation, trace, causal principal, and trusted-context digest;
- timing and optional explainability metadata;
- redaction policy.

Receipts are inspectable without making sensitive feature values broadly readable.

An artifact binding is a content-addressed immutable reference with media/format, digest, size, model
version, schema compatibility, provenance, and optional signature/attestation. A mutable URL or provider
endpoint cannot serve as the pinned artifact identity. Providers may cache or transform an artifact only
when the derived identity and transformation receipt remain reconstructible.

## Online inference

Direct invocation is an ordinary awaitable typed call. The provider must honor declared timeout,
concurrency, maximum input size, and locality. Retries occur only when provider error classification and
the invocation contract make them safe.

## Batch inference

Batching may be called explicitly or lowered through `Query.onBatch(...)`/`job()`. The framework records
input-to-output correlation, provider batch limits, partial failures, and retry identity. Providers may
coalesce online calls only when this preserves deadline and isolation semantics.

The canonical explicit surface is:

```ts
const result = await RiskScore.batch(inputs, {
  partialFailure: "collect",
});

type MLBatchResult<TOutput> = {
  items: readonly (
    | { index: number; status: "succeeded"; output: TOutput; receipt: MLPredictionReceipt }
    | { index: number; status: "failed"; failure: MLPredictionFailure }
  )[];
};
```

`partialFailure: "fail"` rejects with the same indexed failure information; it never drops successful or
failed positions. Retry identity is per input index and model/artifact version, so provider regrouping
cannot change correlation.

Online invocation rejects with a typed `MLPredictionError` whose failure distinguishes validated
application input rejection, provider execution failure, timeout, artifact/version unavailability, and
policy/data-residency rejection. Provider-native payloads remain redacted evidence.

## Requirements and provider selection

Requirements may include:

- online or batch;
- latency class;
- throughput/concurrency;
- CPU/GPU/accelerator class;
- data residency and network isolation;
- deterministic execution;
- explainability support;
- artifact format and size;
- maximum feature/batch shape.

The plan compares these requirements with provider evidence and fails with `ML_PROVIDER_INCOMPATIBLE`
instead of accepting an approximate provider silently.

## Authority and data handling

The inference workload receives only the declared features and exact provider credentials. Runtime access
does not grant the caller authority to retrieve the artifact, other tenants' predictions, or provider
logs.

Sensitive feature and prediction fields retain taint through logs, events, receipts, and operations views.
Remote providers require an explicit egress/data-residency decision.

## Graph and plan

The graph records logical identity, schemas, artifact requirement, selected provider, capability evidence,
runtime resources, autoscaling bounds, locality, authority, and observability. Plan diffs show artifact or
provider changes and whether existing reproducibility remains possible.

## Provider conformance

At minimum, conformance tests validate schemas, online/batch parity, ordering, partial failures, timeouts,
cancellation where supported, artifact pinning, cold start, sensitive-data redaction, causal attribution,
and provider replacement.

Promotion requires at least one local/open provider and one operationally different deployed provider.

An ML provider is a composable implementation value. It may accept typed inference-host/endpoint, pinned
artifact store, batch Job runtime, cache, and evaluation-store implementations. Online and batch paths may
reuse those implementations, but nested credentials and provider clients remain private and every reused
artifact/runtime retains one identity and lifecycle owner.

Replacing a provider while retaining one pinned artifact requires an explicit compatibility receipt for
format, preprocessing, numeric tolerances, determinism, and output schema. If equivalence cannot be proved,
the plan treats the change as a model-version migration rather than an implementation-only update.

## Diagnostics

- `ML_PROVIDER_INCOMPATIBLE`
- `ML_MODEL_VERSION_UNAVAILABLE`
- `ML_ARTIFACT_INTEGRITY_FAILED`
- `ML_BATCH_PARTIAL_FAILURE`
- `ML_DATA_RESIDENCY_UNSATISFIED`
- `ML_DETERMINISM_UNSUPPORTED`

## Implementation increments

1. Freeze logical model, schemas, requirements, and receipt contracts.
2. Implement a local deterministic provider and artifact identity.
3. Add batch inference through the Job/query-batch kernel.
4. Add one deployed provider with materially different runtime behavior.
5. Add plan, operations evidence, security, and evaluation integration.

## Acceptance

- The same declaration runs on two materially different providers.
- Artifact and serving versions are always reconstructible from evidence.
- Batch outputs correlate exactly with inputs and expose partial failures.
- Online and explicit batch failures use stable typed envelopes independent of provider-native payloads.
- Artifact identity is content-addressed and provider replacement cannot silently change preprocessing or
  numeric semantics.
- Sensitive features never leak through standard evidence paths.
- Provider incompatibility fails before deployment with a useful explanation.
- Provider replacement is plan-visible and does not silently change pinned artifacts.

## Non-goals

- model training;
- feature-store ownership;
- experiment tracking;
- automatic model selection;
- a generic tensor library;
- pretending generative AI and predictive ML have identical semantics.

## Definition of done

The beta may ship with truthful contracts and one complete provider. It becomes a promotion candidate only
after two materially different providers pass shared conformance and clean-context applications find the
logical model useful without provider leakage.
