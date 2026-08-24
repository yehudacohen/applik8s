# Release Notes

## v0.8.0

Workflow tasks can now declare the maintained Usage module's
`usage.providerAccounting` handle. The compiler injects a provider-neutral,
scope-bound accounting capability backed by the task's selected PostgreSQL
authority, so retries preserve one provider-call identity without exposing raw
store construction to application code.

Function-native HTTP routes now retain captured object-store bindings in the
public application graph and dependency edges. Deployment planning can prove
the route's object-storage access and place credentials without rediscovering
serialized callback internals.

- Release automation now separates cluster-free local qualification from
  target-live actor qualification and requires a v0.8-specific exact-commit
  evidence packet. The packet independently binds real AWS, Cilium-enforced
  Kubernetes, ClickStack/scheduling/Celld lifecycle, anonymous multi-architecture
  Celld operator image, and generated-product browser receipts; the tagged
  release fails closed on missing, stale, widened, or foreign-commit evidence.

Function-native schedules captured by deployed event processors now hydrate the
same typed `.schedule()` and `.unschedule()` handles used locally. Generated
processors forward an admitted, schema-validated management request to the
dedicated schedule-control service; no provider client or scheduler credential
enters application callbacks. The canonical desired-state authority replays
every active projection after restart, so Kubernetes, Hatchet, and EventBridge
adapters repair provider drift even after an earlier successful projection.
OrbStack receipts cover event-driven Kubernetes create/update/restart-repair/
remove and a real generated occurrence Job that reads Kubernetes' authoritative
CronJob scheduled timestamp through exact `jobs/get` RBAC before completing the
durable handler receipt. The admission container runs as the pinned image's
non-root user under the generated hardened security context. Hatchet evidence
adds fixed and dynamic firing, dynamic replacement, disable, deletion, exact
one-time timestamps, two schedule-control pod replacements, the existing
durable-workflow recovery packet, and leak-free teardown.

Generated Hatchet schedule-control workers now bundle the SDK's heartbeat
implementation as one ESM-safe file and decode the same canonical workflow
transport carrier used when recurring schedules are projected. The OrbStack
release receipt proves a real fixed schedule fires, survives deletion of its
Hatchet cron plus replacement of the complete schedule-control pod, repairs the
provider projection, fires again through the PostgreSQL occurrence authority,
and tears down without retained test resources.

Celld worker artifacts now consume Applik8s telemetry through the focused,
browser-safe runtime subpath. The compiler regression also rejects Node or
Kubernetes client dependency leakage from the emitted worker.

The CelldFleet admission contract now accepts both published
`repository@sha256:...` artifacts and immutable digest-only local-engine image
IDs, while continuing to reject mutable image tags.

Chirp now declares every package root imported by its target-portable generated
gateway, including the local, AWS, and Kubernetes schedule adapters, so clean
production installs no longer rely on transitive workspace hoisting.

Deployed schedules now run in one dedicated schedule-control workload for both
hosted and workflow-only applications. The TanStack/Vite web host embeds the
deterministic scheduler only during local `serve`; production web artifacts do
not contain schedule execution code or AWS, Kubernetes, or Hatchet scheduler
providers. Chirp's production build verifies this boundary while retaining the
same function-native schedule declarations.

Qualified scheduler tokens now retain their intended type-safe selection
semantics across discovery, runtime generation, callable-provider hydration,
credential placement, and deployment planning. A named concrete Hatchet
scheduler runs in the dedicated schedule-control workload; only a qualified
unresolved `target-selected` scheduler is treated as externally executed. The
clean packed-consumer gate proves that provider credentials reach exactly one
Deployment—the schedule-control worker—and never a web host.

The deployment compiler now publishes a focused `/runtime-access-parity`
subpath. TypeKro materialization uses that pure validator without importing the
compiler umbrella, while the module-boundary gate permits only the exact core,
integrity, schedule-authority, and provider-composition seams used by v0.8.

The Vite integration keeps target-specific AWS, Hatchet, Kubernetes, and
DuckDB server runtimes external at their package boundary. A portable gateway
therefore loads the selected provider without embedding every provider SDK in
the relational web artifact.

v0.8.0 makes one semantic application graph portable across local, AWS-local,
AWS, and Kubernetes targets. It adds the canonical ApplicationPlan, persistent
local supervision and Builder portal, Alchemy-owned AWS deployment, inferred
runtime access, provider-neutral OpenTelemetry, function-native schedules,
immutable lakehouse publication/query contracts, and durable actors with local
and celld runtimes. Agentic Start, Chirp, and GuestBook remain the maintained
acceptance applications. Real-target qualification remains mandatory before
the release is tagged or published.

The candidate now includes fail-closed plan serialization, known-secret
canaries across canonical/AWS plans and the independent Builder, a released
v0.7.1 source-and-export migration fixture, and a v0.8-specific synthetic
performance/cost history. Those are local evidence only: retained-data
OrbStack migration, MiniStack, real AWS, and distributed celld qualification
remain explicit release blockers until exact-commit live evidence exists.

Local development now consumes the compiler's reload-group contract instead of
stopping every dependency for an ordinary source edit. The CLI watches authored
source while excluding generated output, rebuilds and validates the production
semantic graph, and reloads stable application-process topology while preserving
ports, generated credentials, provider containers, and retained volumes. The
supervisor also monitors unexpected process and container exits and attempts a
bounded recovery before surfacing terminal failure. Local structural topology
changes reconcile dependency-aware add, update, and removal under the active
lease and restore the previous healthy plan after a failed replacement.
AWS-local structural changes remain fail-closed. The complete packed generated-
application lifecycle is now qualified: an npm-packed Agentic Start and CLI
start a real TanStack application, preserve its URL through source and graph
changes, recover killed child and supervisor processes, retain object-store data,
and remove state and volumes on reset. Generated applications no longer need to
declare compiler, TypeKro, or esbuild merely so compiler-owned discovery can run.
The shared TanStack adapter also exposes `/-/healthz` and supports hosted graphs
without an application HTTP gateway while still hydrating a present gateway
fail-closed.

The independent Builder now binds visual product context to the current
canonical `ApplicationPlan` revision. Generated Agentic Start surfaces expose
opaque semantic provenance IDs; the loopback daemon—not browser-authored
paths—resolves those IDs into redacted source, graph, operation, and physical-
plan attachments. The bridge obtains the current source digest immediately
before capture, rejects stale or replayed selections, persists named referents
through daemon restart, and remains available while the generated application
is broken. Reviewed plans still require exact approval classes, optimistic file
digests, required validation evidence, and agent-owned undo.

Kubernetes provider qualification and runtime credentials are now consistent
with physical deployment. The maintained Envoy AI Gateway, OpenSearch,
notification, payment, and structured-generation adapters carry explicit
Kubernetes guarantees. Framework-generated application Secrets opt into exact
runtime projection; provider-infrastructure Secrets such as the Envoy MCP seed
remain infrastructure-only unless their contributor explicitly declares
`runtimeKeys`. Embedded callable implementations are represented as embedded
runtime-access targets instead of fabricated network dependencies.

Kubernetes dynamic schedules now enforce a configurable active-CronJob ceiling
(100 by default) in the canonical desired-state transaction. The provider
rejects high-cardinality definitions before projection, serializes concurrent
capacity changes across PostgreSQL reconcilers, and releases capacity through
the same authority during removal instead of counting eventually consistent
CronJob listings.

AWS-local now carries a versioned emulator capability boundary rather than
inheriting the entire real-AWS matrix. Native S3, SQS, and ECR pass the pinned
MiniStack lifecycle, including drift repair, configuration update, persisted
restart, output restoration, and teardown. Kinesis remains native on real AWS
but fails during AWS-local planning because MiniStack `1.4.20` lacks
`ListTagsForResource`. The same live gate corrected SQS duration mapping so
planned seconds cannot be interpreted as Alchemy's bare-number milliseconds.

Kubernetes actors now use the independently consumable
`@applik8s/celld-operator` package. TypeKro and Alchemy own the shared operator
bootstrap, external dependencies, immutable artifacts, and each `CelldFleet`
custom resource; the operator exclusively owns the fleet StatefulSet,
Services, deployment Job, network policy, disruption budget, status, and
restart-safe finalizer. The ordinary Applik8s actor-provider path infers this
installation, while `/typekro` and `/testing` subpaths support direct platform
consumers. Live OrbStack evidence covers two fleets sharing one bootstrap,
current-generation artifact proof, idempotent turns, pod-loss recovery,
scaling, controller restart, child repair, retained durable data, and
fleet-first deletion. The same vertical now performs a real immutable Worker
upgrade and reverse rollback, checks the runtime-reported manifest at every
generation, and proves actor state survives both directions. Historical Celld
deployment Jobs are replayed before a rollback StatefulSet advances, because a
past completion receipt cannot prove that its artifact remains active after a
later deployment. OrbStack now also proves an official Celld v0.2.1 to v0.3.0
replacement transition and reverse version rollback, with StatefulSet identity
replacement and actor-state continuity. The release remains blocked on
publishing and anonymously pulling the multi-architecture operator image plus
only publishing and anonymously pulling the multi-architecture operator image.
A second immutable operator build now upgrades in
place while every controller pod is deliberately removed; the two-replica
Deployment recovers on the new image, the existing fleet remains ready, actor
state is preserved, and the complete application teardown remains leak-free.
The same production deployment path migrates a live, pinned prior CelldFleet
structural schema revision to the current revision while two persisted fleets
remain admitted and ready.

Durable root-workflow admission now has a provider-neutral, configurable replay
window and bounded compaction policy. Generated Hatchet gateways page through
their Lease authority, preserve in-flight and recent runs, verify terminal or
missing provider state, and delete expired records with UID preconditions. The
live OrbStack workflow receipt now exports over custom-CA OTLP and proves the
workflow/task retry link graph through worker replacement, cancellation, and
managed teardown. External OTLP Secret projections are also represented in the
canonical runtime-access envelope for every generated JavaScript execution
boundary that receives them.

Function-native operations now create one synchronous semantic telemetry child
at the framework-owned execution seam. The same contract identity survives
direct calls, extracted handles, and module-local helpers in generated HTTP and
workflow/task workers as well as transaction-local and compiler-owned atomic
execution. Provider calls, model mutations, processors, and AI tool calls keep
their distinct semantic owners, avoiding duplicate spans and author ceremony.

Native model mutations now have one complete framework-owned telemetry
boundary. PostgreSQL spans begin after durable replay detection and cover
handler execution, pre-commit authorization, authoritative persistence,
transactional outboxes, typed rejection, and deterministic database retries.
Generated Kubernetes create commands use the same semantic model boundary at
their admitted mutation seam without asking application authors to instrument
their models.

## v0.7.1

v0.7.1 corrects the released-compiler and clean-consumer boundary discovered
while qualifying v0.7.0. The compiler now derives the immutable operator-host
tag from its own package version instead of carrying a release-specific
constant, and the published-artifact smoke installs the intentionally separate
`@applik8s/cli` package before invoking the `applik8s` executable. This makes
the host image, compiler output, npm package graph, and release evidence agree
at the same version and prevents future release lines from silently retaining
an older runtime host.

The v0.7.0 GitHub Release was intentionally withheld after the clean consumer
gate exposed the stale host default. Use v0.7.1 for the complete v0.7 release.

## v0.7.0

v0.7 makes model reads function-native without collapsing their lifecycle
semantics. Promoted relational, analytical, and Kubernetes models now expose
`Model.query(contract, implementation)` for one-shot authorized snapshots and
retain `Model.view(contract, implementation)` for persistent,
invalidation-aware observation. Named implementations provide deterministic
operation identity, and the application graph records `query` versus `view`
while reusing the established schema, provider, authority, dependency, budget,
compiler-capture, and generated gateway machinery.

The function-native model now extends across ordinary callable operations,
agents, typed HTTP routes, event and frozen-batch processors, durable workflows,
and one-shot signals. Managed closures infer the application handles reachable
through local helper graphs; durable execution preserves the initiating causal
principal without inheriting its authority. Signal issuance is an application
event and a serializable capability: authorized browser consumers hydrate the
exact instance, submit only action input, and receive a one-shot outcome whose
actor and authorization receipt are derived by the framework.

The independently built Identity Start keeps exported-agent chat, durable
review signals, account admission, and the operations control center in one
browser acceptance application. Its reviewed JavaScript ceiling is 160 kB
gzip after the TanStack AI 0.44 protocol upgrade; the release gate measured
154,250 bytes and continues to reject server-only package capture.

Generated callback capture preserves typed model deletion just like create,
update, and read operations, including calls reached through application-local
helpers. Generated query and search workloads lower runtime-safe helpers to
focused package entrypoints instead of initializing the authoring umbrella or
TypeKro inside application containers. Durable command progress authenticates
the current principal and revalidates current result-read authority against the
persisted admission receipt. An operation may therefore consume the mutable
workspace context that admitted it without making its signed terminal result
unobservable; unrelated requests continue to reject stale workspace selectors.

Committed model lifecycle handlers can await ordinary CRUD operations against
the same PostgreSQL authority. The call returns its typed provisional snapshot,
and the framework commits or rolls back the source callback, nested model
writes, command results, history, transitions, and outboxes as one transaction.
Unawaited direct operations and cross-authority composition fail during
discovery or compilation; `context.send(...)` remains the explicit post-commit
asynchronous boundary. Named lifecycle callbacks no longer require an empty
options object: `Workspace.on.create(createOwningMembership)` is canonical.

The maintained Agentic Start is generated over the pinned official TanStack
scaffold. It provides a responsive source-owned light/dark shell, public
identity and recovery routes, persistent workspace onboarding, resumable
conversations, maintained revisioned Documents, immutable Artifacts, durable Inbox,
provider-neutral billing and usage, account security, bounded product export
and deletion controls, and redacted operations integration. Starter remains
credential-free; explicit `.env` values remain valid in development and
production. Plain Vite development receives only deterministic framework-owned
fallbacks and never deploys infrastructure implicitly. CLI plan/deploy/destroy
remain the Alchemy and TypeKro lifecycle boundary.

Agentic Start now has an enforced source-ownership boundary. Product nouns,
policy, provider selection, branding, shell, routes, Documents, Inbox/reviews,
Library presentation, and account/workspace lifecycle choices remain generated
source. Provider-neutral billing contracts, artifact transfer/query helpers,
canonical TanStack conversation persistence, browser-safe operational-health
reduction, and generic lifecycle request/progress storage live in maintained
packages. The packed-consumer gate generates, migrates, discovers, compiles,
typechecks, tests, and production-builds the clean application so extraction
cannot hide undeclared dependencies or leak server packages into browser chunks.

The public package surface now has one authoritative package and module catalog.
It explains all publishable boundaries, distinguishes similarly named runtime
and deployment integrations, and is checked against package manifests so new,
removed, duplicated, or undocumented packages fail the release gates. Agentic
Start acceptance is likewise a self-contained, versioned product contract.

Generated product UI now uses a source-owned shadcn/ui substrate rather than
an Applik8s-specific component system: Radix primitives, CVA variants, the
canonical `cn()` utility, Lucide icons, and Tailwind animation utilities back
the maintained controls. ReactMarkdown and GFM replace the handwritten
Markdown renderer with raw HTML disabled, and axe-powered Chromium, Firefox,
WebKit, and mobile qualification covers the core product, builder, billing,
and operator journeys.

The product journey no longer exposes framework acceptance fixtures to ordinary
members. Review requests originate from real Documents and workflow decisions
advance their lifecycle. Outcome-driven onboarding follows creation, revision,
review, and publication. Published application-owned Agent Profiles are resolved
inside managed agent execution, while admitted Knowledge Sources augment new
runs through the same causal-principal boundary. `@applik8s/documents` carries
the reusable document/revision schema so generated applications extend a
maintained contract instead of copying a body-only table.

Application-owned Agent Profiles can select from a typed tool catalog through
`selectApplicationTanStackTools(...)`. The adapter resolves catalog keys back
to compiled operation identities, returns ordinary TanStack tools, and fails
closed when configuration names an unknown, duplicate, or unhydrated tool.

Agent definitions may now select an application-declared `trustedContext(...)`
as their durable scope. The admitted value consistently scopes conversations,
runs, and usage for collaborative agents, while omitted scope preserves the
personal causal-principal behavior. This is a persistence seam, not a tenancy
system: applications still own workspace identity, membership, and admission.

Publishing a Document now produces a real immutable object-backed Artifact,
while the product keeps editable Documents and immutable Artifacts as distinct
destinations. The generated workbench includes execution-effective Agents,
bounded Knowledge imports, redacted provider Integrations, durable
revision-bound Evaluations, complete catalog-version creation, workspace role
management, and guided Launchpad verification. Maintained Artifacts and
Evaluations also preserve their native model facets in emitted declarations,
so packed consumers keep the same `.view()`, lifecycle, and operation surface
as source consumers.

The release remains gated on the exact generated product, Chirp, and profile
acceptance paths. A final tag must additionally prove the route matrix, durable
decision reload/recovery, application-operator authority and read-only
Launchpad evidence, packed generation, cross-browser/accessibility behavior,
and graph-backed OrbStack teardown for the exact source candidate.

TypeKro 0.33.7 removes the previously nested `js-yaml` 4.1.0 installation and
updates the constrained dependency graph. The remaining `js-yaml` 4.3.0 and
unpatched `decompress` findings are explicitly time-bounded to trusted build
inputs in isolated compiler tooling; they do not ship in generated runtime
images. The audit gate records those narrow dispositions and will fail on any
unreviewed expansion while the upstream dependency upgrades are pursued.

## v0.6.0

v0.6 adds native relational models and the reactive application layer. A Drizzle table remains the single relational schema and relationship authority while Applik8s derives ArkType select, insert, and update contracts and attaches a provider-neutral model facet. The same table continues to work in ordinary Drizzle expressions; applications do not maintain a second field map.

Trusted context is declared once and carried through query, stream, and projection boundaries. The PostgreSQL provider lowers that contract to row-level security, transaction-scoped admitted settings, generated migrations, advisory locking, migration history, and pooled-connection cleanup. Queries are bounded authoritative snapshots with opaque resumable invalidation rather than inferred row diffs.

The release adds durable application streams, authorization-aware subscriptions, ClickHouse projections with idempotent writes and durable checkpoints, a framework-neutral browser store, React bindings, and a TanStack Start adapter. Generated gateways enforce authentication, query budgets, cursor integrity, subscription limits, replay bounds, and fail-closed model dependency declarations. Generated projection workers have bounded concurrency, restart-resume behavior, readiness, and explicit network access to application-owned ClickHouse installations.

The application graph now records native model, database, query, stream, subscription, projection, gateway, migration, and provider relationships as inspectable contracts. The compiler emits TypeKro resources for CNPG, migrations, gateways, ClickHouse, projection workers, Services, RBAC, and NetworkPolicy, and retries server-side apply while a same-named object is still terminating. Projection-store materialization and reactive compiler lowering are separated into focused modules with enforced dependency directions and line budgets.

The coordinated `0.6.0` package train includes `@applik8s/client`, `@applik8s/react`, and `@applik8s/tanstack-start`. Clean packed-consumer checks import every public entrypoint and build v0.4, v0.5, and v0.6 applications without workspace aliases. Runtime JSON Schema validation now enforces string patterns consistently with generated Kubernetes schemas.

Generated query gateways can be passed directly to `app.expose(...)`; the gateway binding carries its generated Service name, namespace, and configured port so applications do not repeat compiler naming conventions. The GuestBook flagship makes its complete responsive UI and local/public deployment profiles visible in the rendered page. Its public profile demonstrates Ingress, namespaced cert-manager `Certificate`, ExternalDNS intent, and an HTTPS application-graph URL while remaining precise that platform-owned controllers, issuance, and DNS propagation are separate evidence.

The clean production-dependency audit passes its reviewed expiring baseline but is not vulnerability-free: the latest TypeKro and ComponentizeJS releases still contribute seven upstream build-tool advisories, propagated by npm to twelve package findings. Generated runtime images do not contain that compiler dependency tree; the release fails on any unreviewed, changed, stale, or expired advisory.

Live OrbStack evidence proves generated TypeKro apply, PostgreSQL RLS isolation, migration execution, gateway and projection readiness, SSE invalidation, stream replay, ClickHouse projection/checkpoint state, projection restart/resume, and TypeKro-owned application deletion. KRO 0.9 can leave completed ownerless Job Pods and an empty generated CRD finalizer during deletion; the disposable-cluster harness records and narrowly recovers those cases only after `factory.deleteInstance()` succeeds. This is an explicit dependency boundary, not a claim of native KRO lifecycle behavior.

v0.6 does not claim distributed transactions, global exactly-once processing, automatic CDC for writes outside the observable transaction boundary, arbitrary analytical query planning, or production capacity from synthetic benchmarks. A second Kubernetes API server remains outside this release's evidence boundary.

## v0.5.0

v0.5 adds inert typed tasks and workflows, app-bound runtime handles, and a versioned `WorkflowEngine` provider contract. The first implementation pins Hatchet and its chart, runs it in PostgreSQL-only mode on external CNPG, disables RabbitMQ, and generates self-contained Node workers with health, graceful drain, retries, schedules, durable sleeps, child calls, event waits, cancellation, correlation propagation, fixed scaling, and optional KEDA task-stat scaling.

Durable orchestration is deliberately effect-free: external work belongs in retry-safe tasks, and canonical state still commits through v0.4 model transactions. Compiler analysis follows captured module-scope helpers and rejects hidden network, database, Kubernetes, filesystem, wall-clock, randomness, and ambient-timer access from workflows.

The longitudinal Tenant Platform adds onboarding and decommissioning workflows with compensation and explicit intervention. A fresh OrbStack Hatchet/CNPG proof exercises retry, idempotency, worker replacement during a durable wait, signal/resume, metadata propagation, compensation failure, cancellation, and TypeKro-first teardown.

v0.5 also introduces bounded connection-scoped Kubernetes execution for operators that coordinate a separately authorized cluster. Portable bundles declare named permission and endpoint-policy requirements; installation artifacts bind those aliases to namespace-local kubeconfig Secrets without exposing credentials to WASM. Remote reads are typed and paginated, remote mutations require owner-bound managed identity or UID/resourceVersion evidence, and the host pins one credential revision per invocation. Connection permissions never become management-cluster RBAC, remote owner references and cross-cluster atomicity remain unsupported, and a v1 mutation plan may address only one remote connection.

Operator-runtime DNS publication is now a first-class handler-safe primitive. The dedicated
`@applik8s/applik8s/dns` entrypoint normalizes and digests A, AAAA, and CNAME intent, exposes a canonical
typed ExternalDNS `DNSEndpoint`, validates explicit installation capabilities, and returns pure
create/guarded-update/guarded-delete/observation decisions. Stable publication identity survives record
changes; complete ownership metadata and durable UID evidence prevent accidental adoption or deletion.
Exact metadata-mapped secondary watches reconcile one local owner without namespace fan-out, while
connection-scoped publication uses bounded polling. ExternalDNS generation observation is deliberately
not reported as provider success or DNS propagation.

The Tenant Platform v0.5 artifact now uses that same local adapter to publish and revise tenant DNS with stable identity, exact owner wakeup, and guarded finalization. The pre-v0.6 maintainability pass also separates generated HTTP bundle construction, exposure normalization, graph serialization, compatibility policy, and deterministic TypeKro emission planning; ratcheted module ceilings and dependency-direction checks keep those boundaries enforceable. External provider packages can run the new registration-conformance harness before adding provider-specific semantic and live suites.

The final operator-runtime hardening preserves source-module identity while statically capturing thin
entrypoints and imported operator factories. Reachable declarations execute in isolated module scopes,
including same-named helpers imported through different aliases; unresolved lexical state and capture
cycles still fail closed. Nested status fields retain their names through ComponentizeJS, WIT, and
Wasmtime, declared finalizers are attached and removed by the host, and focused handler-safe imports
remain the supported minimal-WASM path.

Two-replica operators now keep healthy followers Pod-ready, cooperatively yield CPU-bound WASM work so
Lease renewal and health tasks continue, handle Kubernetes `SIGTERM`, release leadership during rolling
replacement, and retain Lease-expiry failover for forced crashes. OrbStack evidence covers two distinct
connection aliases with separate credentials and management identities against one API server. A
genuinely separate second Kubernetes API server remains an explicit post-v0.5 portability proof rather
than a release claim.

## v0.4.3

v0.4.3 is the final v0.4 correctness and release-discipline release. It closes the remaining gap between the durable-behavior implementation and its executable public contract without broadening into v0.5 workflow orchestration.

Transactional command callbacks now have two independent enforcement layers. The compiler applies a closed structural allowlist that rejects ambient I/O, wall-clock and random globals, dynamic code, and routes to the Node global object. The runtime separately installs an async-context membrane over `fetch`, browser network constructors, and Node process escape hatches while a model transaction is open. The serialized ApplicationGraph records both mechanisms and requires external effects to leave the transaction through declared outboxes or future durable tasks.

The release also makes the v0.4 command, event, handler, processor, Certificate, and DnsPublication surfaces consistently stable; adds a versioned executable scorecard over the longitudinal Tenant Platform graph; adds a clean npm first-run path; and enforces warning-free Rust formatting and Clippy gates across all targets. The scorecard's `10/10` values represent complete evidence coverage for declared v0.4 criteria, not a claim of perfect product maturity.

Release publication is now gated by a successful, unexpired live prerelease attestation for the exact commit being tagged. The OrbStack Tenant Platform and Kubernetes-WASM suites pass with TypeKro-owned installation deletion, bounded namespace cleanup, and no manual deletion of KRO-owned resources.

## v0.4.2

v0.4.2 closes the operator-image distribution gap in v0.4.1. The release publishes the Rust operator host to public GHCR for `linux/amd64` and `linux/arm64`, pins the compiler default to an immutable tagged manifest digest, and verifies a clean npm consumer can compile and build an operator from the public host before the GitHub release is created.

Generated operators now run as uid/gid `65532` with `RuntimeDefault` seccomp, a read-only root filesystem, dropped capabilities, disabled privilege escalation, and a bounded writable `/tmp`. The v0.4.2 host build recipe pins its Rust and Debian bases and selects the same non-root identity when run directly. Local source-tree tests and generated `apply.sh` retain an explicit base-image build-argument override without weakening the release default.

The release process also adds an expiring npm audit baseline over the complete candidate dependency graph. It distinguishes seven source advisories from npm's propagated parent-package count, documents the TypeKro and ComponentizeJS roots, fails on new or changed advisories, and treats the remaining build-tool findings as explicit remediation/containment work rather than runtime-image findings.

## v0.4.1

v0.4.1 is an optimization and capacity-hardening release. It preserves v0.4 command semantics while adding validated manual processor replicas/concurrency/resources/placement/disruption policy, multi-replica JetStream consumer lowering, bounded runtime scheduling modules, minified WASM handler bundles, and environment-tagged benchmark history for build size/time, cold start, memory, PostgreSQL contention, JetStream scaling, and capacity cost units.

Automatic lag-driven scaling remains deferred; PostgreSQL remains the serialization authority across all replicas.

Framework hardening in this bugfix also fixes the packed CLI executable and direct ArkType runtime dependencies; adds the WASM-safe `@applik8s/applik8s/operator` entrypoint; replaces authored-schema/entrypoint runtime loading with normalized metadata and statically extracted handler dependencies across local modules and ordinary operator factories; makes declared finalizers operational; adds fail-closed bounded secondary watches with generated RBAC; proves positive paginated Kubernetes list reads; and atomically replaces generated Kubernetes output.

## v0.4.0

v0.4.0 is the durable application-behavior release. It adds versioned command and event contracts, keyed PostgreSQL model transactions, inferred command processors, NATS JetStream transport, and ordinary Kubernetes SDK execution inside WASM closures without changing the v0.3 reconciliation substrate.

### Supported Path

- Define inert, schema-checked `command()` and `event()` contracts and bind model behavior through `Model.on.command()`.
- Declare command identity, target key, ordering, idempotency, expected revision, missing-target policy, transaction participants, history, emitted facts, and follow-up commands.
- Commit model state, transitions, history, durable results, and event/command outboxes atomically in PostgreSQL.
- Recover duplicate delivery from durable results without invoking the handler again; retain stable command, correlation, causation, target, result-revision, and model-revision identities.
- Generate self-contained Node processors, NACK Consumers, JetStream Streams, Deployments, NetworkPolicies, source maps, retention cleanup, lag observations, retry/dead-letter behavior, heartbeat probes, and graceful drain lifecycle.
- Run generated processors on a digest-pinned multi-architecture Node runtime by default (with an explicit image override), as non-root, read-only workloads with no service-account token, dropped capabilities, bounded resources, restricted ingress/egress, and fail-closed token or username/password Secret bindings.
- Use released TypeKro 0.26 NATS/NACK/JetStream infrastructure in direct and KRO modes, with application-owned Stream/Consumer/processor lifecycle.
- Import tree-shakeable `@kubernetes/client-node` Core, Apps, and Custom Objects clients inside WASM handlers through the host-owned Kubernetes credential and trust boundary.
- Use provider-neutral HTTP exposure intents with local Ingress or explicit cert-manager and external-dns bindings for managed public HTTPS.

### Flagship Proof

The v0.4 Tenant Platform slice proves command submission, keyed serialization, duplicate-result replay, concurrent delivery, atomic history/outbox visibility, broker relay, graceful processor restart, abrupt crash/redelivery, backlog recovery, consumer/database lag observations, Kubernetes SDK reconciliation, and clean TypeKro deletion against OrbStack.

### Maturity Boundary

PostgreSQL is canonical application state; JetStream remains at-least-once transport. v0.4 does not claim cross-database transactions, universal exactly-once processing, public replay/subscription APIs, analytical projections, automatic KEDA scaling, or durable workflow orchestration. Tasks and workflows are v0.5; public streams, projections, authenticated subscriptions, and reactive UI delivery are v0.6.

### Evidence

The release evidence is tracked in `docs/release-evidence-v0.4.md`. The complete release gate is:

```sh
bun run check:v04:prerelease:orbstack
```

## v0.3.0

v0.3.0 is the infrastructure-from-code substrate-freeze release. It turns the v0.2 TypeKro application proof into stable framework contracts for schema-first entities, storage-backed models, generated jobs, provider boundaries, durable status, operation targets, watch scopes, and generated runtime bundles.

### Supported Path

- Define reusable schema-first entities and materialize them inside `app(...)` as CRDs or Postgres-backed models with explicit backend semantics.
- Use bounded Kubernetes-native defaults for every app-scoped provider interface, with `app.defaults(...)` and `app.provide(...)` available for overrides.
- Use the Postgres `TransactionalDatabase` slice with CNPG-generated infrastructure, migration Jobs, generated runtime clients, duplicate-key behavior, and migration drift preflight diagnostics.
- Define generated `app.job(...)` and `app.schedule(...)` tasks with a durable runtime-created status ConfigMap, bounded history, conflict diagnostics, and authoritative KRO-owned app-status projection.
- Use stable operation-target contracts for TypeKro apply/delete and artifact-backed dry-run planning.
- Use stable TypeKro watch-scope contracts for exact objects, finite sets, label selectors, field selectors, and mixed resource groups; unsupported predicates fail closed.
- Consume TypeKro 0.25 through the published package, including first-class Valkey operator and Rook/Ceph object-storage factory re-exports.
- Generate deterministic server bundles with source maps, route manifests, runtime bundle manifests, health checks, route/action diagnostics, and no startup package installation.
- Declare generated versus external Secret object ownership without claiming externally populated Secret data.
- Validate packed packages through a clean consumer import smoke test, and exercise imported async `Proxy` plus `fetch` closure bundling through the Rust runtime bridge.

### Flagship Proof

`examples/tenant-platform.ts` is the v0.3 pressure test. It proves:

- TypeKro/CNPG/Postgres infrastructure for a Tenant Platform control plane.
- Postgres-backed `Account` model create/query behavior through the generated admin API.
- generated migration preflight/retry behavior and drift fail-closed diagnostics.
- authoritative KRO-projected generated-job application status and retained migration completion history in the durable runtime store.
- generated repair Job, cleanup CronJob, admin server, status reconciler, RBAC, runtime modules, and diagnostics as inspectable TypeKro/Kubernetes artifacts.

### Maturity Boundary

v0.3 ships one bounded Kubernetes-native default for every native provider interface: Postgres/CNPG models, Valkey indexes, Kubernetes-resource counters and watches, Kubernetes Secret material and credentials, bounded ConfigMap queue/object storage, and Ingress exposure. Users do not need `app.provide(...)` for the golden path. TypeKro 0.25's operator-backed Valkey and Rook/Ceph surfaces are available for explicit production-scale infrastructure, where their cluster lifecycle prerequisites remain visible. KRO owns the root application status projection, while the runtime-created status ConfigMap remains the durable concurrency/history store. Runtime supply-chain posture is metadata-only: generated artifacts declare unsigned/no-SBOM/no-provenance status rather than claiming verification.

Not included:

- broad external provider catalogs beyond the concrete and explicitly re-exported infrastructure slices
- generic workflow orchestration beyond Kubernetes-native generated jobs and durable phase/status primitives
- full Helm, Kustomize, OLM, OCI, SLSA, SBOM, or admission-policy enforcement
- workload-movement or disaster-recovery product guarantees

### Evidence

The release evidence is tracked in `docs/release-evidence-v0.3.md`. The required gate for the current release candidate is:

```sh
bun run check:v03:prerelease:orbstack
```

## v0.2.0

v0.2.0 is the TypeKro-native Kubernetes application release. It keeps the v0.1 operator/runtime contract and adds the integrated app-composition proof centered on `examples/guestbook.ts`.

### Supported Path

- Install one user-facing package, `@applik8s/applik8s`, for SDK authoring, TypeKro integration, app DSL helpers, and selected TypeKro factory re-exports.
- Build wrapped TypeKro compositions with direct callable operator installs, e.g. `const install = guestBookRenderer({ namespace, replicas })` inside `sdk.kubernetesComposition(...)`.
- Instantiate generated CRD factories from the returned install binding and compose their status through TypeKro-visible expressions.
- Attach TypeKro-backed listeners to resource instances and scoped resource groups without hidden global registration.
- Generate composition-scoped app servers, Services, ServiceAccounts, RBAC, route bundles, source maps, route manifests, and route failure diagnostics from `app.server(...)`.
- Use typed resource actions in generated app servers: `create`, `get`, `query`, `patch`, `delete`, and buffered `increment`.
- Declare cache-backed indexes and aggregates so request paths avoid unbounded Kubernetes list-all behavior.
- Use first-class permission bundles and inferred RBAC while unsupported dynamic resource access fails closed.

### Flagship Proof

`examples/guestbook.ts` is the v0.2 pressure test. It proves:

- `GuestBook`, `GuestBookEntry`, and `GuestBookPageViewBucket` CRDs generated from typed schemas.
- direct callable TypeKro operator install through the wrapped application composition.
- generated web server and cached Valkey-backed `publishedGuestBookEntries` index.
- moderated `GuestBookEntry` reconciliation with typed live reads.
- buffered page-view counters through `GuestBookPageViewBucket.increment(...)` instead of per-request Kubernetes writes.
- aggregate workers that project entry counts and page-view totals into `GuestBook.status`.
- generated route diagnostics through route IDs, source locations, route manifests, bundle inputs, structured failure logs, and route IDs in failure responses.
- live local-cluster validation through the GuestBook e2e suite and full prerelease gate.

### Maturity Boundary

v0.2 is intentionally Kubernetes-native. CRDs are appropriate for control-plane resources and low/moderate Kubernetes-native domain state. applik8s does not claim CRDs are a general-purpose application database.

Not included:

- storage-backed `app.model(...)` semantics, migrations, or database constraints
- production-grade generated web framework behavior beyond the documented generated app-server path
- ingress/gateway/TLS exposure primitives
- arbitrary JavaScript predicate lowering beyond Kubernetes-lowerable selectors and generated-label semantics
- ambient untyped Kubernetes clients or direct in-handler Kubernetes writes outside operation plans
- workload-movement or disaster-recovery product guarantees

### Evidence

The release evidence is tracked in `docs/release-evidence-v0.2.md`. Before announcing v0.2, the required gate is:

```sh
APPLIK8S_RELEASE_LIVE_E2E=1 APPLIK8S_E2E_CONTEXT=orbstack bun run check:prerelease
```

## v0.1.0

v0.1.0 is the first public evaluation release of `applik8s`.

### Supported Path

- Define typed CRDs and proxy-first operator handlers in TypeScript.
- Test handlers locally without mutating a cluster.
- Compile handlers and reachable TypeScript code into a WASM component artifact.
- Generate Kubernetes CRDs, RBAC, ServiceAccount, Deployment, runtime manifest, Dockerfile, source maps, and apply script.
- Run generated handlers through the Rust operator host.
- Use runtime-authored `Ready` conditions, structured logs, source-mapped diagnostics, and replay artifact inspection.
- Install operators through plain Kubernetes YAML or TypeKro composition.

### Maturity Boundary

v0.1.0 is correctness-first and intentionally conservative. Unsupported features fail closed.

Not included:

- multi-version CRDs and conversion webhooks
- arbitrary external capability kinds
- full production HA and rollout/rollback guarantees
- Helm/Kustomize/OLM/OCI distribution
- signed provenance/SBOM enforcement
- production-grade multi-cluster or disaster-recovery automation

### Breaking Change Policy

Before `v1.0`, TypeScript authoring APIs and generated manifests may change. Runtime/handler compatibility is guarded by explicit manifest, ABI, and runtime requirement checks; unsupported combinations fail closed.

### Primary Docs

- `README.md`
- `BACKLOG.md`
- `RECONCILIATION_CONTRACT.md`
- `docs/first-run.md`
- `docs/imagejob-golden-path.md`
- `docs/typekro-golden-path.md`
- `docs/generated-artifacts.md`
- `docs/runtime-diagnostics.md`
- `docs/api-reference.md`
- `docs/troubleshooting.md`
- `docs/release-gates.md`
- `docs/runtime-image.md`
- `docs/scale-boundaries.md`
- `docs/kubernetes-compatibility.md`
- `docs/positioning.md`
- `docs/future-surface.md`
- `docs/decisions.md`
- `docs/maintainer-policy.md`
- `docs/security-model.md`
- `docs/contract-evolution.md`
- `docs/stabilization-boundary.md`
