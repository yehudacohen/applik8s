# Goal: Deliver Applik8s v0.9 completely

## Authority and release boundary

The accepted authority is
[`docs/manifesto-v09-semantic-completion-and-1.0-readiness.md`](./docs/manifesto-v09-semantic-completion-and-1.0-readiness.md)
and its linked v0.9 RFP suite. Architecture is frozen. Implementation may
correct unsafe or unimplementable details, but must not silently weaken the
programming model, provider neutrality, authority, lifecycle, or evidence
contracts.

No tag, npm publication, GitHub Release, or maturity promotion is authorized
without an explicit maintainer request. Local or simulated evidence must not be
reported as maintained deployed-provider qualification.

## Required outcome

Deliver the complete v0.9 semantic-completion program with exceptional
function-native developer experience, exact graph/plan representation,
provider-neutral runtime contracts, fail-closed authority, resumable lifecycle,
clean package boundaries, and executable evidence. Preserve the direct-call
illusion: authors call models, Jobs, workflows, queries, agents, events, and
capabilities as ordinary typed values while the compiler owns hydration and
deployment machinery.

## Execution sequence

1. **Finite Jobs**
   - Complete local, durable PostgreSQL, Kubernetes, and AWS runtime contracts.
   - Complete typed direct/start/attach/result/progress/cancel behavior,
     retention, idempotency, signed admission, causal identity, lifecycle facts,
     shared scheduling, graph/plan, interruption, and conformance evidence.
   - Ensure HTTP and other managed closures hydrate Job handles automatically;
     authored Job code belongs only in its immutable execution artifact.
2. **Shared schedules, application events, and effect outcomes**
   - Converge Job/workflow/actor/operator scheduling on the shared
     definition/instance/occurrence algebra.
   - Implement `application.events` catalog membership and typed
     `from`/`of`/`all`/`where` selections over existing Stream machinery.
   - Integrate the shared receipt/fencing/unknown-outcome contract across every
     stable effectful execution family.
3. **Queries, models, reconciliation, and Sagas**
   - Implement selection-backed `Query.onBatch(...)`, deterministic local
     batching, PostgreSQL snapshot/keyset lowering, durable contiguous-frontier
     receipts, cancellation, authority, and failure injection.
   - Complete managed relational and Kubernetes model parity through the one
     `Resource.on.reconcile` surface.
   - Complete beta Saga coordination without distributed-ACID claims.
4. **External bindings, Kubernetes clusters, ML, agents, and decisions**
   - Complete external capability binding conformance and migration.
   - Complete named Kubernetes-cluster DI with exact connection/access
     authority and no ambient kubeconfig.
   - Complete beta `ML.model`, production-qualified `researchAgent`, maintained
     SearXNG WebSearch, preview code-agent composition, and the explainable-
     decision disposition required by the frozen RFPs.
5. **Builder, documentation, public freeze, and release qualification**
   - Complete source-owned journeys, repo-aware Builder preview, product site,
     quickstart, primitive decision guide, explain/plan, troubleshooting, and
     upgrades.
   - Freeze public names, package boundaries, diagnostics, maturity labels,
     graph/plan/artifact compatibility, and the resumable v0.8 state migration.
   - Qualify clean consumers, local lifecycle, OrbStack, maintained deployed
     providers, security/failure injection, package artifacts, performance/cost
     history, examples, and independent review.

## Current checkpoint

The branch `codex/v0.9-semantic-completion` is pushed through `d79af16`.
Completed foundations include concrete provider planning, deployment migration
proposals, journey declarations, the documentation site foundation, shared
effect-safety primitives, Job vocabulary and runtime contracts, deterministic
and durable PostgreSQL Job execution, Kubernetes Job dispatch, the private
controller/client boundary, and compiler-generated controller/worker artifacts.

The Kubernetes Job vertical currently proves provider-neutral dynamic
`batch/v1 Job` creation with immutable image references, exact-run worker
claims, durable outcomes, UID-safe cancellation, signed framework admission,
raw-admission rejection, automatic HTTP closure hydration, framework
credentials, and TypeKro resource emission in focused tests and package
typechecks. Full live interruption qualification, lifecycle event publication,
shared Job scheduling, and AWS execution remain open.

Continue in the sequence above until every stable-candidate gate is implemented
and evidenced. Keep beta/preview surfaces truthful; do not expand the frozen
scope merely to make a scorecard look complete.
