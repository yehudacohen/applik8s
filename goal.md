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

The branch `codex/v0.9-semantic-completion` is pushed through `b994f1f` before
the current managed-model slice. Completed foundations include concrete
provider planning, deployment migration proposals, journey declarations, the
documentation site foundation, shared effect-safety primitives, Job vocabulary
and runtime contracts, deterministic and durable PostgreSQL Job execution,
Kubernetes Job dispatch, the private controller/client boundary,
compiler-generated controller/worker artifacts, shared Job scheduling,
framework-owned Job lifecycle facts, and source-authoritative typed
`application.events` catalog selections.

The current Query batching slice implements the function-native
`context.select(Model)` algebra and `Query.onBatch(...)` Job surface, shared
one-shot/batch query meaning, deterministic local execution, safe PostgreSQL
lowering, transactionally materialized repeatable snapshots, durable
out-of-order window receipts with a contiguous frontier, authority-context
admission pinning, stale-attempt fencing, compiler-generated Kubernetes Job
runtime hydration, explicit graph lowering, and semantic plan state/capacity
evidence. The affected package builds and typechecks, 102 focused tests pass,
and an OrbStack PostgreSQL run proves mutation isolation, restart recovery,
out-of-order completion, authority-conflict rejection, and stale-fence
rejection. PostgreSQL is truthfully the only maintained repeatable-snapshot
lowering; unqualified consistency modes fail closed.

Full Kubernetes Job interruption qualification and AWS finite execution remain
open. The managed-model slice now freezes and implements the public
`application.model(table).managed({ status })` enrichment, qualified
`Model.store`, `Model.on.reconcile`, and `Model.on.finalize` surface; persists
that declaration through preview/materialization replay; serializes its exact
status, lease, resync, provider, callback, finalizer, and static condition-writer
contract into the application graph; and fails closed for dynamic or conflicting
condition ownership. A provider-neutral deterministic runtime proves desired
generation, schema-complete status, observed-generation conditions, monotonic
lease fencing, durable next-due intent, restart-safe finalizers, and stale-write
rejection. The PostgreSQL adapter now adds versioned framework-owned lifecycle
and invalidation tables, transactional desired observation, generation digests,
bounded resync, `SKIP LOCKED` claims, monotonic fences, CAS status/condition/
finalizer writes, restart-safe next-due state, and an optional live vertical.
Wiring native model mutations into this authority, generated operator lowering,
and Kubernetes parity remain the next work in this slice before beta Saga
coordination.

Continue in the sequence above until every stable-candidate gate is implemented
and evidenced. Keep beta/preview surfaces truthful; do not expand the frozen
scope merely to make a scorecard look complete.
