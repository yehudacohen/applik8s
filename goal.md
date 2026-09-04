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
     graph/plan/artifact compatibility, and the resumable v0.7.1-to-v0.9 state migration.
   - Qualify clean consumers, local lifecycle, OrbStack, maintained deployed
     providers, security/failure injection, package artifacts, performance/cost
     history, examples, and independent review.

## Current checkpoint

The branch `codex/v0.9-semantic-completion` is pushed through `2469d9e` before
the current Saga slice. Completed foundations include concrete
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

Kubernetes Job interruption now has deployed-provider evidence for the physical
recovery boundary: the generated `batch/v1` Job projects the logical attempt
budget into a bounded `backoffLimit`, a killed OrbStack worker Pod is replaced
under the same digest-pinned Job/run identity, active replacement attempts do
not inherit a false terminal phase from historical Pod failures, and UID-fenced
teardown removes the workload. The provider-neutral durable-store suite
separately proves lease expiry, reattachment, stale-attempt fencing, and one
terminal result. A single live PostgreSQL-backed run that crosses both seams in
one process-loss scenario remains the strictest outstanding Kubernetes Job
evidence. AWS finite execution now has its provider-side runtime foundation:
`@applik8s/runtime-aws/job-runtime` composes the same durable PostgreSQL kernel
with an identity-tagged ECS/Fargate dispatcher, bounded network placement,
attempt-scoped SDK idempotency, stopped-attempt history, duplicate-active-owner
rejection, exact-task cancellation, and normalized physical observation. Its
deterministic SDK suite proves create/adopt, retry, collision, cancellation,
terminal classification, and controller/exact-task-worker composition. AWS
compiler/deployment lowering now emits that same immutable controller/worker
artifact for the AWS target, resolves its exact running ECS task-definition
revision from task metadata, deploys the controller behind private Cloud Map
discovery, projects PostgreSQL and bounded subnet/security-group inputs through
Alchemy, gives typed HTTP Job handles only the controller endpoint, and lowers
Job attempt start/cancel into exact ECS/PassRole runtime-access grants. Focused
compiler, plan, access, Alchemy-boundary, SDK, and artifact-loader tests pass.
Real-AWS create/update/interruption/cancellation/teardown evidence remains open;
the implementation is not promoted on deterministic SDK evidence alone. The
frozen AWS profile can now be authored without generic-provider escape hatches:
`Database.auroraPostgres(...)`, `EventLog.kinesis(...)`, and
`ContainerRegistry.ecr(...)` retain their typed account/configuration inputs
through the application graph and lower to native Alchemy Aurora, Kinesis, and
ECR resources. Aurora uses the shared PostgreSQL runtime-binding contract,
Kinesis preserves authored retention, and ECR is kept out of the Kubernetes
OCI endpoint path. The native AWS adapter now applies every portable
delete/retain policy through Alchemy's removal-policy scope, closing a prior
gap between declared and executed lifecycle. MiniStack-incomplete Aurora and
Kinesis profiles fail before mutation. Thirty-nine focused authoring, planning,
and native-resource tests plus the affected package typechecks pass. Real AWS
Aurora/Kinesis lifecycle qualification remains open and is not implied by this
compiler/adapter evidence.

The remaining frozen AWS profile vocabulary is now concrete as well:
`ApplicationHost.aws(...)`, `ObjectStorage.s3(...)`, `HttpExposure.aws(...)`,
`Certificate.acm(...)`, and `DnsPublication.route53(...)` preserve their typed
account, lifecycle, hostname, certificate, and hosted-zone configuration in the
semantic graph. Managed AWS exposure lowers to ALB, ACM, and Route 53 resources;
S3 accepts the account-only frozen spelling, derives an application-scoped name
when no bucket is authored, and preserves retain/delete intent without
implicitly emptying a bucket. Native AWS desired state is separated from the
concrete S3 runtime binding so unresolved configuration sources never enter the
AWS SDK adapter. AWS host bindings no longer invent a Kubernetes namespace or
service URL. Kubernetes Ingress continues to require cert-manager and
external-dns, while the AWS path fails closed unless ACM and Route 53 own
managed TLS/DNS. Event-catalog sources are now captured before TypeKro probing
and restored at the durable graph boundary; malformed source contracts diagnose
fail-closed rather than crashing validation. Focused profile, graph, plan,
TypeKro integration, and reactive tests plus the affected package typechecks
pass. This is compiler/adapter evidence; real AWS lifecycle qualification is
still outstanding.

The managed-model slice now freezes and implements the public
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
Native relational mutations now commit desired-state generation, invalidation,
deletion intent, and a finalization-safe value snapshot in the same PostgreSQL
transaction as the domain write. The durable store uses an explicit
advisory-locked lifecycle state machine, clears ordinary leases when deletion
begins, retains tombstones through finalization, rejects premature recreation,
and starts a fresh UID/generation only after finalizers complete. Framework
reads hide deletion intent immediately, while the authoritative relational row
is retained until terminal finalizer completion removes it in the same
transaction as lifecycle completion. Lower-level
script mutation clients fail closed rather than bypassing this authority. Unit
and OrbStack PostgreSQL evidence cover mutation isolation, process replacement,
fencing, physical row deletion, snapshot-backed cleanup, and fresh-incarnation
recreation. The distributed OperatorRuntime lowering is now generated as a
two-replica, bounded-concurrency workload with readiness held behind a
checkpointed activation migration, health/failure reporting, compiler-owned
callback bundling, focused model-read hydration, transactional terminal
deletion, and provider-selected PostgreSQL Secret bindings. Activation pages
commit with a durable cursor, resume after process replacement, preserve
existing UIDs, reject status-schema drift, and coexist with lifecycle rows
created by concurrent framework mutations. OrbStack evidence covers
interrupted resume, idempotent completion, schema rejection, and the complete
relational lifecycle.

The Kubernetes parity slice now maps the same provider-neutral managed-model
object and reconcile context onto native CRD identity, `spec`, status,
conditions, UID/generation/resource-version fencing, finalizers, work-queue
wakeup, and bounded resync without introducing a second controller. Managed
graph membership is declaration-driven: a plain CRD remains plain, while
`Resource.on.reconcile` and `.on.finalize` record their serialized callbacks,
static condition ownership, provider requirements, and the integrated
Kubernetes store/runtime implementations. `@applik8s/runtime-kubernetes` now
publishes the previously reserved `managed-model-store` and `operator-runtime`
adapters, with exact identity/fence and lifecycle policy tests. The canonical
generated-operator OrbStack suite passes all nine cases using
`status.update(...)`, `conditions.set(...)`, and `context.requeueAfter(...)`,
including current-generation status, child ownership, restart/resync,
finalization, RBAC denial, apply/status conflicts, malformed output, timeout,
and teardown. Workspace typecheck passes across 64 packages and all package
artifacts build.

The beta Saga slice now establishes the exact
`application.transaction.saga(...)` public spelling, a first-class Saga graph
node, ordered stable `step`/`commit`/`irreversible` boundaries, its
WorkflowEngine requirement, an explicit compensating/no-isolation maturity
contract, and graph structure/foundation validation. Its deterministic
conformance runtime proves reverse compensation, commit-frontier isolation,
honest unknown outcomes with later observation, distinct compensation-failure
evidence, idempotent result adoption, and runtime rejection of effects outside
a Saga boundary or nested compensation authorities. Registration fails closed
for dynamic or duplicate durable step IDs. The focused suite passes six cases
and affected core, compiler, and authoring-package typechecks pass. This is a
truthful semantic foundation, not deployed-provider qualification:
compiler-enforced effect classification, a durable WorkflowEngine lowering,
interruption/upgrade matrices, application facts, and operations evidence
remain open before Saga satisfies its beta definition of done.

The beta predictive-model slice now adds the independently prunable
`@applik8s/ml` package and the intended direct-call surface:
`ML.model(...)`, `await Model(input)`, `Model.batch(...)`, and
`application.provide(Model, provider)`. A logical model is simultaneously a
callable typed value and its generated qualified implementation token; no
separate registry or string-based provider lookup is exposed to application
authors. The application graph records the logical schema/version,
capabilities, provider qualification, requirements, content-addressed artifact
identity, and receipt/redaction posture. The deterministic provider validates
inputs and outputs, emits artifact-bound redacted receipts, preserves every
batch position, distinguishes collected from rejecting partial failures, and
fails closed for incompatible providers, missing hydration, and deadlines.
The deterministic implementation now also publishes a portable managed-worker
runtime binding. Compiler-generated HTTP workers replace direct `Model(...)`
and `Model.batch(...)` calls with the static `@applik8s/ml/runtime` operations,
project the exact content-addressed model/provider configuration, and select it
from the compiler-authenticated qualified provider identity. Concurrent models
remain isolated rather than sharing a process-global resolver. Six focused ML
tests, a real generated HTTP-worker compile, the affected typechecks, package
build, package catalog, public-contract inventory, and documentation checks
pass. The surface remains truthfully beta: a materially different deployed
provider, broader cancellation/failure injection, and provider-replacement
compatibility evidence remain open for maturity promotion.

The explainable-domain-decision investigation is closed with an explicit
library-only disposition. Three representative prototypes showed that an
ordinary typed function is clearer and more reusable than a new graph
primitive; the existing query, operation, Job, workflow, reconcile, and event
surfaces already add invalidation, authority, durability, and evidence when
those semantics are actually required. The additive `domainDecision.allow()` /
`.deny(code, details?)` / `.match(...)` algebra standardizes discriminated
outcomes and stable reason codes without granting authority or creating state.
The weighted disposition, compatibility consequence, and canonical usage are
recorded in `docs/v0.9-explainable-decision-disposition.md`; three focused tests,
the authoring-package typecheck, public-contract regeneration, and documentation
checks pass. A first-class `decision()` registrar is rejected from the v0.9/1.0
foundational vocabulary.

The research vertical now has separate provider-neutral `WebSearch` and
`SourceRetriever` authorities. `@applik8s/web-retrieval-http` implements the
maintained server-only retrieval boundary with HTTPS and port policy, DNS
resolution that rejects every non-public answer, per-hop redirect
revalidation, DNS-pinned connections, response and deadline bounds,
identity-only content encoding, accepted media types, normalized text, and
content-addressed receipts. Deterministic fixtures hydrate through the same
managed-worker contract, and the application graph records the selected
retriever and its safe policy independently from search.

`@applik8s/research` now supplies the separate `ResearchEvidence` capability
with local deterministic and PostgreSQL durable providers. Evidence commits
are content-addressed, immutable, idempotent, scope/run bounded, versioned for
mutable pages, and retain normalized query, retrieval, search-receipt,
citation, visibility, snapshot, and causal-artifact provenance. Artifact links
are independently append-safe and refuse absent or cross-scope evidence. The
selected profile, portable runtime binding, store identity, and PostgreSQL
connection environment (never a URL) are plan-visible. Kubernetes runtime
placement now projects that connection through an explicit Secret/key
contract rather than guessing or serializing a URL. Focused semantic tests,
the package typecheck, package build, package catalog, public-contract
inventory, and documentation checks pass.

The maintained `researchAgent()` orchestration now composes the
normal AI agent, service identity, qualified `WebSearch`, qualified
`SourceRetriever`, qualified `ResearchEvidence`, bounded concurrency/context,
untrusted-source isolation, evidence-before-synthesis ordering, and
application-owned publication tools. The package preserves a generated,
closure-free handler source across the package boundary, and compiler evidence
proves that a thin external application hydrates only the three public runtime
operations without replaying profile setup or `application.inject()`. A core
callback fix also treats a public provider operation as the executable leaf,
so multiple maintained provider calls no longer collide through their private
`providerDependency1` metadata. Fourteen affected agent/research/compiler tests,
the three affected package typechecks, the complete publishable-package build,
catalog/docs checks, and the 65-package/219-entrypoint public inventory pass.
The publication operation is now distinct from optional supporting tools:
`publish` is the one application-owned operation whose result must expose an
authoritative artifact ID. The generated worker links every committed evidence
record to that artifact before allowing the tool call to return success;
supporting reads cannot trigger linkage, missing artifact identity fails closed,
and evidence-store failure prevents false completion while retaining the
idempotent application artifact for retry/adoption. The exported composition is
now a callable typed agent with actor-keyed execution and a discriminated
`completed`/`partial`/`failed` terminal. Browser calls, authenticated server
requests, and the application facade hydrate the same invocation contract.
Actor-owned run state provides terminal reattachment and durable phase
checkpoints for search, evidence commit, and synthesis; a lost checkpoint
response remains an unknown outcome, and replay uses the same provider
idempotency identities instead of falsely settling the run as failed.

The durable evidence provider now also passes a real disposable-PostgreSQL
replacement gate: a committed record survives provider shutdown/recreation,
concurrent retries adopt the same immutable version, listing recovers the exact
frontier, an artifact link with missing evidence rolls back, and the corrected
link is idempotent. The gate exposed and fixed two live-only codec defects:
Postgres.js string parameters previously stored serialized JSON as JSON string
scalars, and round-tripping an omitted `causalArtifactIds` field as `[]` broke
retry equality. JSON parameters now cross an explicit text-to-JSONB boundary,
and optional empty provenance remains absent. The gate owns and removes a
disposable native PostgreSQL instance. Kubernetes/managed-PostgreSQL placement,
mid-transaction process termination, and the complete research run remain
separate evidence.

The maintained Agentic Start now qualifies and injects all three research
authorities. Starter and non-Kubernetes development use coherent deterministic
search, source, and evidence fixtures; Kubernetes development/dedicated use
managed SearXNG, bounded HTTP retrieval, and the selected PostgreSQL Secret;
external mode consumes explicit SearXNG and PostgreSQL authorities. The
generated research feature now declares `researchAgent('researcher.v1', ...)`
with only its identity, model, application-owned publication/search tools, and
bounded policy instead of rebuilding TanStack orchestration. Generic
deployment lowering was extended so newly defined callable providers receive
the same profile/target selection semantics as built-ins. The generated
application now supplies its application Service and immutable Celld/operator
artifacts, and real generator, compiler, local, AWS, and Kubernetes planning
evidence passes without assigning actor execution to both the application
Deployment and Celld StatefulSet. Search and retrieval requests carry stable
run-derived admission/idempotency identities, while provider receipts flow
unchanged into committed evidence. A single live browser-to-publication run
that crosses the generated HTTP surface, managed actor runtime, SearXNG,
retrieval, durable evidence, model synthesis, publication, and artifact/evidence
receipt remains the strictest open research qualification. Universal direct
agent invocation from every managed closure family also remains to be proven;
the current evidence covers browser, authenticated server request, generated
worker execution, and actor-backed research execution.

The deployed-provider Saga gate is now complete on OrbStack. Three live cases
cross the generated Hatchet/controller boundary and prove schedule repair,
worker replacement, durable waits and signals, correlation, compensation,
intervention, cancellation, fenced recovery, reverse compensation, and managed
cleanup. The gate does not promote Saga beyond its accepted beta contract.

The unchanged-source Chirp AWS-local qualification now builds the production
AWS plan through native Alchemy resources and exercises the S3/Glue/Athena
lakehouse lifecycle. Destructive cleanup remains impossible by default.
`forceDeleteUnretainedData` adds full-prefix S3 deletion and Glue table deletion
only for the exact application dataset; the live fixture proves that a
neighboring object beneath the owned prefix and a foreign Glue table survive.
Test fixtures may clean only their own identity-tagged resources. Real AWS
qualification remains blocked on explicit account, region, confirmation, and
credential inputs and is not inferred from AWS-local evidence.

The generated Agentic Start product gate now passes a fresh 77-resource
OrbStack deployment, authoritative readiness, an exact 77-resource no-op
reapply, 49 browser cases across Chromium, Firefox, WebKit, and mobile, and
ordered Alchemy/TypeKro teardown. The v0.9 evidence contract is independent
from the historical v0.7 receipt and requires every current product journey,
including route reliability, provider-neutral billing, account security, and
durable decisions. Future receipts are written beneath
`.applik8s-tmp/evidence/v0.9`.

The public-contract inventory has advanced from discovery-only to
candidate-review-ready. All 66 publishable packages belong to exactly one
checked-in disposition group; their 234 entrypoints and 7,946 exported symbols
inherit explicit owner, maturity, compatibility, stability, documentation,
evidence, and replacement policy. The inventory also classifies 310 public
diagnostics, 18 CLI commands, 114 visible CLI options, and 109 runtime environment
names. Release mode now requires the maintainer to mark the disposition frozen
and verifies that every acceptance evidence path exists. This explicit review
decision remains open and is not silently converted into a passing freeze.

The final local qualification pass is green across all sixteen ordinary test
shards, all six isolated compiler-artifact groups, and all seven
process-isolated workflow-compiler cases. Workspace typecheck passes for 68
packages, four script shards, and the root TypeScript configurations. Lint,
release checks, documentation generation, the v0.9 foundation gate, the
contract-mode scorecard, Rust formatting/clippy/tests, package catalog,
publish dry-run, clean packed-consumer smoke, quick performance benchmark,
performance-history validation, and `git diff --check` pass.

The generated Agentic Start gate now includes a fresh 77-resource
OrbStack/Alchemy/TypeKro deployment, 30 immutable artifacts, 38 TypeKro
declarations, authoritative readiness held stable for 30 seconds, an exact
77-resource no-op reapply, 50 passing browser journeys across Chromium,
Firefox, WebKit, and mobile with one intentional skip, and complete ordered
teardown. Hydration-sensitive account controls are inert until the browser
owns them, and a stale workspace selector preserves only authenticated identity
while failing closed for every workspace-scoped role and trusted-context field.

The callback compiler now preserves exact object-store method authority through
recursive same-file and imported-helper metadata. `head`/`get` remain read
authority, `put`/`delete` remain write authority, an uncalled captured store
grants nothing, and any object-store effect forces a durable task boundary
rather than executing in workflow history. Chirp's media verification uses this
function-native path and its pure signature helpers remain independently
importable without initializing the application graph.

Concrete assembly-profile planning now carries the selected implementation's
normalized callable-runtime binding into the canonical implementation plan and
treats it as authoritative during physical lowering. Inactive profile branches
can no longer reintroduce their endpoints, credentials, or required environment
through stale semantic-provider metadata. Target selection remains intact for
the target adapter that owns it, while already-resolved target providers no
longer require a redundant profile binding. The source CLI also hands `build`
off from Bun to Node before compiler discovery, avoiding unsupported Bun Node
internals in generated Saga and worker builds. Finally, terminal Alchemy destroy
releases the reverse stack-identity claim under the deployment lease, allowing a
cleanly removed application identity to be safely reused without weakening
strategy-conflict protection. Focused regression suites and the complete v0.9
static candidate aggregate pass with these corrections.

The contract-mode v0.9 scorecard has 25 gates: 19 passing, two intentionally
non-release-blocking provider-expansion lanes blocked, two exact-candidate
foundation/product gates awaiting manifest promotion, and two credentialed
release lanes blocked. The public-contract inventory is
`candidate-review-ready`, but the maintainer-owned freeze remains open and must
not be promoted implicitly. The exact released-v0.7.1 baseline is now recorded,
and a clean committed-candidate OrbStack migration proved fenced ownership
handoff, physical UID preservation, readiness, and TypeKro-ordered teardown.
The same candidate also passed the complete generated Agentic Start product
journey. Their authoritative manifests still need promotion after maintainer
approval, after which both exact-candidate receipts must be regenerated from
the final commit. The managed research journey remains blocked on explicit
OpenRouter credential authority, and real AWS lifecycle qualification remains
blocked on explicit account, region, credentials, and cost/destructive-action
authority. Multi-authority event federation and a genuinely independent second
Kubernetes cluster remain truthful non-release-blocking beta lanes. Chirp's
production Kubernetes lifecycle and the named current-cluster capability are
passing. Credentials are not copied into OrbStack without explicit destination
authorization.

The npm audit gate was not executed because its registry request transmits the
candidate dependency graph and execution authority was not granted. This is an
explicit evidence gap, not a hidden pass.

Continue in the sequence above until every stable-candidate gate is implemented
and evidenced. Keep beta/preview surfaces truthful; do not expand the frozen
scope merely to make a scorecard look complete.
