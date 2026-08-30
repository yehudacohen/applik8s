# applik8s Backlog

Last updated: 2026-08-27

- `[post-v0.7]` Add adapter-owned browser OAuth completion for provider-neutral
  Integration requests. Preserve the v0.7 safe intent/status model, keep
  credentials outside browser persistence, and hydrate provider-specific
  authorization only behind maintained adapters.

This backlog prioritizes correctness, excellence, and the public developer experience over feature completeness.

## v0.9 Semantic completion and 1.0-readiness program

Status: alpha.1 foundation started on `codex/v0.9-semantic-completion`.

- Added the first provider-neutral effect contract and receipt state machine,
  including stable logical identity, explicit provider guarantees, append-only
  transition validation, unknown outcomes, proven absence, and authorized
  operator resolution.
- Added a machine-readable alpha.1 foundation manifest and executable gate.
  It distinguishes the completed v0.8 source candidate from an exact released
  v0.8 migration baseline and fails closed before any v0.9 work writes
  deployment state.
- Derived the public contract inventory from all 62 publishable package
  manifests, 193 export-map entrypoints, 6,902 TypeScript exports, and 242
  typed diagnostic positions. The generated catalog stays dirty-checkable
  while per-symbol maturity/evidence review remains visibly in progress.
- Added deterministic authored implementation identity and a pure recursive
  profile-resolution plan. It preserves explicit sharing, inline parent/slot
  identity, typed guarantees, private provider-internal authority, source
  provenance, configuration-source provenance, lifecycle/readiness/migration
  metadata, and canonical serialization while rejecting missing bindings,
  incompatible capabilities, wildcard authority, identity collisions, and
  dependency cycles.
- Added the minimal development-only `journey()` declaration and local runner
  in `@applik8s/testing`. It traverses public admission, creates run-bound
  identities, records semantic assertions, returns a versioned public result,
  enforces real deadlines, and performs lease-authorized reverse-dependency
  cleanup with explicit absence proof and redacted evidence.
- Added the read-only deployment-migration proposal contract. It validates an
  exact source/codec baseline, maps semantic and provider-native physical
  identities deterministically, explains lifecycle-authority transfer and
  destructive consequences, and fails closed before mutation on ambiguity,
  provider incompatibility, unsafe ownership, or retained-data drift.
- Next foundation work: integrate the implementation plan with compilation and
  establish the documentation and first clean-context evidence. Active
  migration/provider writes remain blocked until the exact released v0.8
  baseline exists.

## v0.8 Explainable portable runtime program

Status: implementation started on `codex/v0.8-rfps`; no release is authorized.

- Added the v0.8 exact-commit release-evidence contract and workflow lane.
  Cluster-free qualification no longer smuggles the Kubernetes operator E2E
  into its local actor command; real AWS, active-Cilium Kubernetes, platform,
  multi-architecture image, and browser receipts remain explicit release
  boundaries.

Current foundation increment:

- Live-qualified the Kubernetes CronJob scheduler on OrbStack. The exact
  function-native path now runs from an event callback through the admitted
  management bridge and generated schedule-control service into a real Job.
  That Job uses a dedicated ServiceAccount with only `jobs/get`, reads
  `batch.kubernetes.io/cronjob-scheduled-timestamp`, runs as the pinned Node
  image's non-root UID/GID, completes the generated occurrence endpoint, and
  persists the exact durable receipt before update, restart repair, disable,
  removal, and leak-free cleanup.

- Live-qualified the generated Hatchet scheduling provider on OrbStack. The
  schedule-only worker uses an ESM-safe SDK heartbeat, decodes the canonical
  Hatchet transport carrier, and admits fixed, dynamic, and exact one-time
  occurrences through PostgreSQL. The receipt proves dynamic create, firing,
  replacement update, disable, deletion, exact scheduled-time preservation,
  two independent provider-deletion/pod-replacement repairs, the existing
  durable-workflow recovery packet, and leak-free TypeKro/Alchemy teardown.
  Deployed event callbacks now use the same typed `.schedule()`/`.unschedule()`
  surface through an admitted generated management bridge. Real EventBridge
  retry/DLQ/lifecycle/cost evidence remains separate release work.

- Kept generated Celld workers browser-safe by replacing their umbrella
  telemetry import with the focused runtime boundary and checking emitted
  artifacts for Node/Kubernetes dependency leakage.
- Aligned CelldFleet ArkType and CRD admission with the OCI provider's two
  immutable deployment forms: published repository digests and local-engine
  digest IDs; mutable tags remain rejected.
- Made Chirp's generated gateway dependencies explicit at the application
  boundary instead of relying on workspace-hoisted client, identity, runtime,
  AWS, or Kubernetes schedule packages.
- Kept target-specific server runtimes external in Vite/Nitro output so a
  portable application declares all providers but bundles only its shared web
  surface rather than every provider SDK.
- Separated deployed scheduling from the web host. Hosted and workflow-only
  applications emit the same focused schedule-control workload, while Vite
  `serve` retains the deterministic local scheduler. A clean Chirp production
  build now excludes TypeKro and the Kubernetes client from the relational web
  artifact without weakening target schedule ownership.
- Preserved qualified scheduler selection across the full compiler path. Named
  concrete schedulers, including Hatchet, execute in schedule control and
  receive only their captured provider bindings; only qualified unresolved
  `target-selected` schedulers remain external. The clean package-consumer gate
  packs all 60 packages, imports 108 public entrypoints, and proves exact
  schedule-control credential isolation.
- Narrowed TypeKro's compiler dependency to the public
  `@applik8s/deployment-compiler/runtime-access-parity` subpath and reconciled
  the executable module-boundary policy with the focused integrity,
  schedule-authority, core-contract, and provider-composition seams actually
  owned by v0.8 packages.

- Added versioned canonical application, graph-node, operation, source,
  provider, execution-boundary, artifact, and target identities without using
  source positions or timestamps as semantic identity.
- Added structured workspace-relative source provenance, provider guarantee,
  deployment-target, runtime-access, native-plan adapter, and bounded
  guest/host identity-envelope contracts in `@applik8s/core`.
- Added fail-closed foundation validation for identity collisions, ambiguous or
  wildcard runtime access, missing execution attribution, absolute source-path
  leakage, invalid native-plan summaries, and stale guest/host access records.
- Added the first canonical `ApplicationPlan` compiler over the existing
  `ApplicationGraph` and `ApplicationDeploymentGraph`, preserving distinct
  semantic, provider-resolution, and physical layers with deterministic JSON,
  timestamp-independent content identity, concise text, stable diffs, and
  Alchemy/TypeKro native-plan records.
- Added executable partial `check:v08:graph-provenance` and
  `check:v08:application-plan` gates. The machine-readable acceptance entries
  remain `implemented: false` until guest/host propagation, recursive source
  attribution, complete access inference, schemas, renderers, and integration
  evidence satisfy their full RFP evidence sets.
- Closed the generated Hatchet root-admission operational boundary with a
  configurable replay window, bounded paginated cleanup, terminal-provider
  verification, UID-fenced deletion, exact runtime-access projection for
  external OTLP credentials, and an OrbStack collector receipt proving the
  workflow/task retry link graph through worker replacement and cancellation.
- Closed function-native operation telemetry at the common framework execution
  seams. Generated HTTP and workflow/task calls, transaction-local handles, and
  compiler-owned atomic handles preserve one exact operation identity through
  direct, extracted, and helper-mediated invocation without double-wrapping AI
  tools or adjacent model/provider boundaries.
- Closed relational and Kubernetes model telemetry. PostgreSQL replay remains
  inert while live/retried attempts cover authorization and every authoritative
  write; ambient transactions propagate internal retry identity, and generated
  Kubernetes creates use the server-owned mutation seam.
- Added the independently consumable `@applik8s/celld-operator` package and
  provider-specific `CelldFleet` contract. TypeKro/Alchemy own singleton
  bootstrap and application inputs; the operator exclusively owns fleet
  children, current-generation status, restore-gated rollout, continuous drift
  repair, and blocking retained-data finalization. The aggregate actor gate now
  passes deterministic, Docker, realtime, and two-fleet OrbStack lifecycle
  evidence. The operator vertical also proves a distinct immutable Worker
  upgrade and reverse rollback with runtime-manifest evidence and state
  continuity; historical deployment receipts are replayed before rollback
  workloads advance. A distinct operator image upgrade now survives deliberate
  loss of every operator pod while preserving fleet readiness and actor state.
  A pinned prior CelldFleet structural schema also migrates through the normal
  TypeKro/Alchemy path while two persisted fleets survive the interrupted
  operator upgrade. Release qualification now requires only the published,
  anonymously verified multi-architecture operator image. Official Celld
  v0.2.1 to v0.3.0 and reverse replacement transitions pass with StatefulSet
  UID replacement and state continuity.
- Completed the local runtime gate with reload-group execution, authored-source watching, generated-output
  exclusion, retained credential/provider continuity, bounded child-runtime
  recovery, and dependency-aware structural reconciliation with rollback. A
  fresh npm-packed generated application proves cold start, real Start health,
  rebuild, structural reconciliation, child and supervisor recovery, retained
  data, reset, and teardown without app-local compiler dependencies. AWS-local
  structural hot reconciliation remains separate and explicitly unsupported.
- Qualified the supported AWS-local subset against pinned MiniStack: native
  S3, SQS, and ECR pass lifecycle, drift, restart, output, and cleanup evidence.
  Kinesis remains an upstream native AWS resource and now fails during
  AWS-local planning while the emulator lacks `ListTagsForResource`; it will
  not be replaced by a production provider fork. Corrected SQS duration units
  and enabled emulator persistence so restart evidence tests the intended
  contract.
- Completed the v0.8 development-agent preview vertical. Agentic Start emits
  opaque semantic provenance at selected product roots; the independent daemon
  resolves it against the current canonical ApplicationPlan into revision-bound
  source, graph, operation, and physical-plan attachments. The gate covers
  generated-app selection, named referent recovery, redaction, reviewed apply,
  truthful validation, broken-app portal survival, repair, journal recovery,
  source-governed OpenCode context, and undo.
- Completed bounded Kubernetes schedule capacity enforcement. The provider
  declares a 100-instance default ceiling, rejects high-cardinality schedules,
  and enforces create/remove capacity atomically in deterministic and
  PostgreSQL desired-state authorities with OrbStack lifecycle evidence.

Next, in manifesto dependency order:

1. Thread canonical execution/provenance identities through compiler discovery,
   generated artifacts, WIT, and the Rust host.
2. Emit source-attributed runtime-access requirements from typed handle calls
   and framework-generated behavior, failing closed on unresolved helper paths.
3. Complete ApplicationPlan schemas, authority/data-flow/access views, native
   plan adapters, graph renderer, diff policy, CLI output, and sensitive-canary
   qualification.
4. Build the lightweight local supervisor on the frozen plan/access contracts
   before expanding AWS, scheduling, observability, lakehouse, actors, or the
   development-agent preview.

## Guiding Priorities

`applik8s` should become the easiest serious way to build Kubernetes operators and durable, event-driven applications on the Kubernetes control plane. To get there, the next phase should harden the core programming and runtime semantics before expanding surface area.

The order below is intentional. Later packaging, CLI, and extension work should not outrun reconciliation correctness, observability, and ABI discipline.

## v0.7 Function-native and Agentic Start release

Status: active release qualification

Completed:

- Function-native one-shot `Model.query(contract, implementation)` across
  relational, analytical, and Kubernetes models, with graph-visible
  distinction from persistent `Model.view(...)` declarations.
- Maintained revisioned Documents, product-originated durable review, and
  execution-effective Agent Profile and Knowledge configuration in Agentic Start.
- Typed Agent Profile tool catalogs whose persisted selections resolve to the
  original compiled operation handles and fail closed before inference.
- Application-owned trusted-context scoping for collaborative agent
  conversations, runs, and usage, with personal causal-principal fallback.

Remaining release work is authoritative in `goal.md`, the v0.7 charter, and
the machine-readable v0.7 scorecard.

## v0.4 Durable Application Behavior Release

Status: release candidate

Completed:

- Versioned command/event contracts, canonical envelopes, and application-graph command/handler/processor nodes.
- PostgreSQL keyed serialization, optimistic concurrency, durable results, history, transitions, event/command outboxes, retention cleanup, and crash-safe relay.
- Generated JetStream processors with retry, dead-letter, lag observations, graceful drain, heartbeat probes, bounded resources, restricted networking, and non-root/read-only execution.
- Released TypeKro 0.26 NATS/NACK/JetStream integration with direct and KRO lifecycle evidence.
- Tree-shaken `@kubernetes/client-node` Core, Apps, and Custom Objects calls through the credential-safe WASM host boundary.
- Tenant Platform command, duplicate, concurrency, history/outbox, graceful restart, abrupt crash/redelivery, backlog, Kubernetes SDK, and clean deletion release evidence.
- Node-loadable packed JavaScript/declaration packages and normalized static handler schemas.

Deferred beyond v0.4:

- Provider-neutral tasks/workflows and Hatchet integration belong to v0.5.
- Public streams, subscriptions, projections, authenticated reactive delivery, ClickHouse, and React adapters belong to v0.6.
- KEDA and public processor placement/grouping overrides follow the fixed-concurrency release boundary.
- Refactor durable contract, graph, lowering, runtime, and provider modules before broadening v0.5 orchestration surface.

## Scoring

Each roadmap item has two scores from 1 to 10:

- Difficulty: implementation and verification complexity, including design ambiguity, cross-package scope, live-cluster behavior, and compatibility risk.
- Impact: expected improvement to correctness, excellence, and the public developer experience, independent of feature-count completeness.

## Milestone Tags

Roadmap work should use these tags so each milestone scope stays ambitious but honest:

- `[v0.1-required]`: must be true before a public v0.1 announcement.
- `[v0.1-wow]`: not strictly required for safety, but central to making v0.1 feel exceptional.
- `[v0.1-safety]`: release-blocking correctness, security, compatibility, or operational safety work.
- `[v0.2-typekro]`: required for applik8s v0.2 full TypeKro integration and the single-package integrated UX.
- `[v0.2-api]`: required for applik8s v0.2 typed Kubernetes API, application DSL, CRUD ergonomics, and permission bundle UX.
- `[v0.3-framework]`: required for applik8s v0.3 as a serious infrastructure-from-code framework and substrate-freeze release, including typed models, explicit storage semantics, migrations, generated jobs, stable app graph/runtime contracts, and production-grade app behavior.
- `[movement-v0.1]`: required for the first serious workload-movement operator built after applik8s v0.3 foundation work.
- `[post-v0.1]`: important, but should not block the first public release.
- `[later]`: strategic future work that should stay visible without expanding v0.1.

## v0.1 Go-Live Release Bar

Purpose: ship a first public release that proves the full developer experience end to end without claiming broad production maturity.

v0.1 should let a TypeScript developer:

- Done: author a typed CRD and proxy-first operator using the public package entrypoint.
- Done: run local operator tests that assert CRD schema, RBAC, operation plans, status, events, requeue, and finalizers.
- Done: build a WASM-backed operator bundle with predictable `dist/applik8s` output.
- Done: generate CRDs, RBAC, ServiceAccount, Deployment, runtime manifest, handler artifact, source maps, Dockerfile, and apply script.
- Done: deploy the generated operator to a pinned local Kubernetes context and watch it reconcile a sample CR.
- Done: see runtime-authored `Ready` conditions, handler-authored domain status, structured logs, and actionable diagnostics when things fail.
- Done: use TypeKro to install the operator and instantiate one of its CRDs through the ergonomic `typeKro.composition(...)` path.
- Done: run a polished ImageJob first-run path that demonstrates authoring, local test, build, live deploy, status, replay/debugging posture, and cleanup evidence.
- Done: document the TypeKro tutorial where an applik8s operator installs like a component, its CRD instantiates like a resource, and status composes through TypeKro-visible fields. Deeper live status-driven downstream composition is post-v0.1 polish.
- Done: fail closed for unsupported capabilities, unsafe schemas, unsupported runtime concurrency, incompatible ABI/manifest/runtime versions, and unsupported packaging/release claims.
- Done: publish clear maturity boundaries: v0.1 is for serious evaluation and early operator authoring, not yet a promise of multi-version CRD migration, arbitrary external capabilities, HA production rollout, or stateful cross-cluster failover.
- Done: enable ordinary async TypeScript handler code to execute in the WASM runtime, including direct `fetch` calls and SDK-backed tree-shaken bundled dependencies, while preserving operation-plan validation and runtime timeout enforcement.
- Done: define the v0.1 security boundary for direct handler `fetch`: no ambient filesystem/environment access, network enabled only through WASI HTTP, and release docs distinguish direct fetch from audited declared capabilities.

Release decision: v0.1.0 does not need an RC ceremony. Remaining roadmap items improve depth, portability, and polish after launch; they do not block the first pre-1.0 public evaluation release as long as public docs keep the supported path and unsupported boundaries explicit.

v0.1 should not require:

- `[post-v0.1]` Helm, Kustomize, OLM, or OCI bundle distribution.
- `[post-v0.1]` Multi-version CRDs, conversion webhooks, or storage migration.
- `[post-v0.1]` General cloud/database/queue/object-store/identity capabilities.
- `[v0.1-safety]` Any multi-cluster application movement or disaster-recovery work, demos, APIs, docs, package metadata, or v0.1 release commitments.
- `[post-v0.1]` Formal SLSA-level provenance enforcement, as long as unsigned/no-SBOM/no-provenance posture is explicit.

## v0.2 TypeKro And Typed Kubernetes API Release Bar

Purpose: make applik8s feel like one coherent TypeKro-native product and a typed Kubernetes application DSL while preserving the clean adapter boundary, explicit operation plans, fail-closed permissions, and shared runtime guarantees.

Positioning: v0.2 is allowed to be the memorable Kubernetes-native proof. GuestBook can remain CRD-backed because it demonstrates the machinery clearly, but the release must not imply that CRDs are a general-purpose application database. Public examples and docs should state the boundary: CRDs are appropriate for Kubernetes/control-plane resources and low/moderate Kubernetes-native domain state; high-volume product data belongs in explicit storage-backed models planned for v0.3.

applik8s v0.2 should let a TypeKro and operator author:

- Done: install one package, `@applik8s/applik8s`, and get the integrated SDK, compiler-facing authoring APIs, TypeKro adapter, and TypeKro factory re-exports.
- Done: import TypeKro factories from `@applik8s/applik8s/factories`, including `simple`, `kubernetes`, `helm`, and supported ecosystem factory namespaces that are safe to re-export.
- Done: import the grouping-aware TypeKro surface from `@applik8s/applik8s` or `@applik8s/applik8s/typekro`, including wrapped `kubernetesComposition`, `resource`, `resources`, `composition`, `operationTarget`, `targetFactory`, and `graphAdapter`.
- Done: support both explicit and implied application authoring for the v0.2 slice: the golden path infers generated servers, listener grouping, indexes, aggregations, RBAC, and TypeKro install relationships from the enclosing composition when unambiguous; explicit forms remain available for advanced control, libraries, custom boundaries, and ambiguity resolution.
- Done: read registered owned CRDs from handlers through typed live clients, e.g. `resource.read.resource(GuestBookEntry).get(...)` and `.list({ namespace, labels })`, returning typed objects instead of untyped Kubernetes JSON.
- Done: keep reads and writes semantically distinct: typed reads perform live Kubernetes reads through declared host support, while `apply`, `patch`, `delete`, status assignment, finalizers, events, and TypeKro operation targets append explicit operation-plan entries.
- Done: provide typed CRUD helpers around registered CRDs without hiding effects: handler writes remain explicit operation-plan entries, while generated app-server actions are resource-centric runtime calls with inferred RBAC and fail-closed dynamic access checks.
- Done: expose permission bundles as public API so common authoring code does not require hand-writing raw RBAC: `Resource.permissions.read()`, `watch()`, `apply()`, `patch()`, `patchStatus()`, `delete()`, `finalize()`, `manage()`, plus built-in bundles such as `sdk.permissions.k8s.ConfigMap.apply()` and `sdk.permissions.events.write()`.
- Done: infer safe permission bundles where usage is statically or declaratively known, and require explicit bundles where dynamic usage would otherwise be ambiguous; unsupported inferred permissions fail closed at compile/manifest generation time.
- Done: validate live read permissions before handler execution and validate planned write permissions before Kubernetes effects, with diagnostics that name the missing resource/verb path.
- Done: add runtime host support for typed CRD `get`/`list` reads with namespace, exact name, label selector, field selector, pagination token, and bounded result-size behavior.
- Done: keep the typed client generated from the operator's registered resources and declared external resources; no ambient cluster-wide dynamic Kubernetes client in the golden path.
- Done: make applik8s `operator(...)` results directly callable inside applik8s-wrapped `kubernetesComposition(...)`, so `const installed = imagePipeline({ namespace, replicas })` installs the operator and returns TypeKro-visible CRD factories/status.
- Done: preserve the rule of thumb: outside applik8s `kubernetesComposition(...)`, a callable operator is an operator object; inside it, calling the operator means install this operator as part of the TypeKro composition.
- Done: resolve callable operator install bindings at compile time into ordinary applik8s artifacts: CRDs, RBAC, ServiceAccount, Deployment, bundle/runtime metadata, generated CRD factories, and status projections.
- Done: keep plain YAML as the inspectable substrate while TypeKro becomes the preferred integrated application deployment experience.
- Done: use TypeKro resource instances as listener sources through `const deployment = Deployment(args); deployment.on.updated(handler)` without defining duplicate applik8s CRDs.
- Done: default TypeKro-backed listener grouping to the enclosing applik8s-wrapped `typeKro.kubernetesComposition(...)` and synthesize one operator manifest/RBAC/runtime bundle for that composition.
- Done: override listener grouping explicitly through `resource.on.updated(operator, handler)` for cross-composition or library-authored listener registration.
- Done: support scoped listener groups: `Resource.instances([...]).on.event(handler)`, `Resource.where(selector).on.event(handler)`, and `typeKro.resources([...]).on.event(handler)`.
- Done: lower listener scopes to explicit manifest watch scopes: exact namespace/name, finite address sets, label selectors, and field selectors where Kubernetes can enforce them.
- Done: reject selector/predicate forms that cannot be lowered to Kubernetes watch semantics or generated labels; no hidden global listener registration and no JavaScript-object-identity watch semantics.
- Done: infer watch/list/read/status/finalizer/event RBAC from TypeKro-backed listener sources and prove permissions through shared compiler/runtime gates.
- Done: prove permission bundle output through generated manifests and host preflight tests for read/list/watch/apply/patch/delete/status/finalizer/event cases.
- Done: make external TypeKro-backed resources visible in manifests and RBAC as watched resources while never emitting them as owned CRDs.
- Done: route runtime handler invocations according to the manifest watch scope, not only GVK/event.
- Done: preserve TypeKro operation-target apply/delete semantics in handlers, including reverse dependency ordering and RBAC inference.
- Done: provide character, vertical, generated-manifest, and live e2e tests for listener authoring, grouping, duplicate-scope diagnostics, scoped watch routing, RBAC inference, TypeKro operation targets, and TypeKro install composition.
- Done: replace the static SSR demo with a GuestBook flagship that uses `GuestBook`, `GuestBookEntry`, and `GuestBookPageViewBucket` CRDs; typed live reads; generated server/indexer/aggregate workloads; status updates; events; typed permission bundles; and buffered counters.
- Done: publish docs showing the typed CRUD mental model: live reads are explicit and permissioned, writes are planned and validated, generated RBAC is inspectable, and unsupported dynamic usage fails closed.
- Done: publish docs showing the single-package UX: infrastructure composition and event handlers in one TypeScript file using TypeKro factories plus applik8s listener semantics.
- Done: live TypeKro-native tutorial proves generated operator install through TypeKro artifacts, CRD factory-created `ImageJob` instances, status-composed downstream `ConfigMap`, and scoped external `Deployment` listener routing.
- Done: keep TypeKro itself independent from applik8s; the dependency direction remains adapter depends on TypeKro, not TypeKro depends on applik8s.
- Done: add composition-scoped application servers through `app.server(...)`, generating HTTP runtime bundles, Deployments, Services, ServiceAccounts, RBAC, generated source maps, and route diagnostics from the enclosing `kubernetesComposition(...)`. Optional ingress/gateway exposure remains post-v0.2.
- Done: add resource-centric runtime actions for app/server scopes: `Resource.create(...)`, `Resource.get(...)`, `Resource.query(...)`, `Resource.patch(...)`, `Resource.delete(...)`, and `Resource.increment(...)`, while preserving explicit permission validation and fail-closed dynamic access checks.
- Done: add cache-backed `Resource.index(...)` declarations for selector-compatible, sorted, and paginated read models so public request paths do not rely on unindexed list-all Kubernetes API calls.
- Done: add `app.aggregate(...)` for batched/debounced derived status updates over resource event streams. Hot-target/conflicting-aggregation diagnostics are post-v0.2 hardening.
- Done: add first-class bucketed counter primitives for traffic-style metrics, including page-view buckets, so high-frequency user actions do not become per-request Kubernetes writes.
- Done: make resource event examples demonstrate visible domain behavior such as moderation, status transitions, and counters, not only bookkeeping.
- Done: provide a whole-app TypeKro install surface for composed apps that includes CRDs, desired instances, generated servers, indexers, aggregations, handlers, RBAC, and status projection as one typed unit.
- Done: document GuestBook as a Kubernetes-native proof rather than a database pattern, including explicit guidance on when to use CRDs, when to use cache-backed indexes, and when future `model(...)`/database-backed state is the right abstraction. `entity(...)` and `app.crd(entity, ...)` are present; `app.model(entity)` fails closed until v0.3 storage semantics are real.

v0.2 should not require:

- `[later]` TypeKro core changes or global monkey-patching of TypeKro factories.
- `[later]` Arbitrary JavaScript predicate lowering beyond selectors or generated-label semantics.
- `[later]` Ambient untyped Kubernetes clients, broad dynamic API discovery from handlers, or direct in-handler Kubernetes writes outside operation plans.
- `[later]` Production multi-cluster movement guarantees outside the supported workload-movement scope.

## v0.3 Infrastructure-From-Code Framework And Substrate-Freeze Release Bar

Purpose: turn the v0.2 TypeKro-native application proof into a serious infrastructure-from-code framework with honest state semantics, typed app-data models, real storage backends, production-grade generated server/runtime behavior, and migration/diagnostic discipline. v0.3 should also freeze the applik8s substrate contracts that a future workload-movement operator can depend on without large API rewrites after v0.3.

applik8s v0.3 should let an infrastructure/application author:

- Decision: v0.3-required app/provider APIs are stable public APIs for the pre-v1 line, not experimental user-facing seams. Missing implementation may still fail closed, but the public contract should be shaped and tested before broad implementation.
- Decision: model operations inside callbacks that applik8s serializes into generated runtimes must execute through generated runtime clients. The same model operations in ordinary callbacks or async functions are script execution and must execute through an explicit script-execution runtime path rather than being silently treated as generated-runtime calls.
- `[v0.3-framework]` Define reusable typed shapes with schema-first `entity(...)`, then materialize them inside `app(...)` through `app.crd(entity)` or `app.model(entity)`, where both return objects that implement the same core resource-like ergonomics for `create`, `get`, `query`, `patch`, `delete`, `index`, and `on.created/on.updated/on.deleted` where those semantics are supported.
- `[v0.3-framework]` Keep backend semantics explicit at app materialization time: `app.crd(entity)` means Kubernetes control-plane resource; `app.model(entity)` means application data backed by an explicit `TransactionalDatabase` provider.
- `[v0.3-framework]` Treat `app(...)` as the distributed application context and dependency injection boundary, with `app.defaults(...)` and `app.provide(...)` binding typed capability interfaces such as `TransactionalDatabase`, `IndexStore`, `CounterStore`, `EventSource`, `Secret`, `Queue`, `ObjectStorage`, and `HttpExposure` to concrete providers.
- `[v0.3-framework]` Provide at least one production-plausible storage-backed model implementation, likely Postgres first, provisioned through TypeKro/Kubernetes resources and surfaced through generated app runtime clients.
- `[v0.3-framework]` Add model schema migration primitives with generated, inspectable migration jobs and compatibility checks.
- `[v0.3-framework]` Support typed database constraints and indexes for model-backed entities without pretending they are portable to CRD-backed resources.
- `[v0.3-framework]` Replace prototype generated app server source-string execution with real bundle extraction, runtime dispatch, closure/module semantics, source maps, and route/action-level diagnostics.
- `[v0.3-framework]` Add first-class typed `config(...)` and `secret(...)` primitives for environment variables, mounted files, Kubernetes Secret/ConfigMap references, generated RBAC, and redaction-aware diagnostics.
- `[v0.3-framework]` Add explicit `expose(...)` or equivalent ingress/gateway primitives for Service, Gateway/Ingress, TLS/cert-manager, hostnames, and status URL projection.
- `[v0.3-framework]` Add `job(...)` and `schedule(...)` primitives for durable background work, retries, cleanup, maintenance, and migration-style tasks.
- `[v0.3-framework]` Define and test a stable app graph IR for servers, operators, CRDs, models, indexes, aggregates, counters, jobs, providers, permissions, generated workloads, and TypeKro resources before lowering to Kubernetes/TypeKro artifacts.
- `[v0.3-framework]` Stabilize provider interfaces for `TransactionalDatabase`, `IndexStore`, `CounterStore`, `EventSource`, `Secret`, `Queue`, `ObjectStorage`, `HttpExposure`, and credential material so applications depend on contracts rather than concrete infrastructure helpers.
- `[v0.3-framework]` Add durable phase/status semantics for generated jobs and app-level processes: phase, step status, observed generation, retry policy, idempotency key, last successful step, terminal failure, blocked/progressing/ready/finalized conditions, and partial-failure diagnostics.
- `[v0.3-framework]` Stabilize operation-target contracts for `ctx.apply(ref)`, `ctx.delete(ref)`, TypeKro operation targets, dry-run/plan output, owner references, finalizers, and RBAC inference.
- `[v0.3-framework]` Stabilize watch/scope contracts for exact objects, finite object sets, label selectors, field selectors, mixed TypeKro resource groups, and external watched resources.
- `[v0.3-framework]` Define CRD/schema compatibility rules for v0.3-era domain CRDs, including what is stable before conversion webhooks or stored-version migration land.
- `[v0.3-framework]` Split generated app/runtime implementation into maintainable modules for server runtime, model runtime, indexer, aggregate worker, counter flushing, job runner, Kubernetes client, diagnostics, and provider adapters.
- `[v0.3-framework]` Publish a v0.3 release compatibility policy that marks stable public APIs, documented internal contracts, experimental seams, and post-v0.3 surfaces.
- `[v0.3-framework]` Add basic observability declarations for generated servers, indexers, jobs, and operators: health/readiness, structured logs, metrics hooks, events, replay artifacts where applicable, and source-mapped failure reports.
- `[v0.3-framework]` Make unsupported cross-backend assumptions fail closed. Shared ergonomics must not hide differences between Kubernetes watches, SQL transactions, cache consistency, and generated model events.
- `[v0.3-framework]` Provide a serious substrate pressure test, likely a tenant/platform control-plane application rather than workload movement itself, showing CRDs for control-plane state, models for app data where needed, real storage, generated servers, jobs, and TypeKro infrastructure as one typed unit.

Current prep status:

- Done: add core contract fixtures for migration plans, compatibility checks, migration history metadata, runtime module boundaries, diagnostic taxonomy, and v0.3 provider requirement breadth.
- Done: promote the first Postgres `TransactionalDatabase` vertical from placeholder to real generated infrastructure: CNPG Cluster, generated migration Job, SQL ConfigMap, diagnostics ConfigMap, generated server runtime client, and live E2E coverage.
- Done: support typed `app.defaults({ models })`, `app.provide(TransactionalDatabase, ...)`, and explicit model store bindings as stable app-scoped provider paths for the Postgres TransactionalDatabase slice.
- Done: freeze public `GeneratedJobContract`, generated phase/status, and TransactionalDatabase guarantee contracts with type, graph, integration, and character coverage.
- Done: add runtime-module artifact boundary coverage for server, model runtime, job runner, diagnostics, and provider adapter modules, including Kubernetes-safe ConfigMap key mapping.
- Done: add migration compatibility/history/failure-mode diagnostics contracts for missing credentials, bad SQL/job failure, schema drift, incompatible table/index shape, and destructive-change rejection.
- Done: enable the first public `app.job(...)` and `app.schedule(...)` slice as generated Kubernetes Job/CronJob resources with graph nodes, diagnostics ConfigMaps, durable status metadata, terminal-failure diagnostic templates, and public binding types.
- Done: route generated job and model-migration diagnostics through shared generated-job status/idempotency helpers so diagnostics encode phase, observed generation, retry count, status target, idempotency key, and partial effects.
- Done: add v0.3 runtime module ABI metadata and generated durable status-updater interfaces, plus emitted status-runtime ConfigMaps for public jobs and model migration jobs.
- Done: add the executing generated-job status reconciler slice: consolidated app-level status-runtime Deployments, ServiceAccounts, RBAC, Kubernetes Job/CronJob observation, durable status calculation/history, and a runtime-owned status ConfigMap observed by KRO for authoritative application-status projection.
- Done: prepare v0.3 freeze-interface tests for operation-target lowering, watch-scope lowering, migration drift checks, and the integrated pressure-test gate before broad implementation continues.
- Done: add v0.3 cleanup contract tests for concrete pressure-test graph/artifact anchoring, operation-target artifact-only lowering, compatibility-policy labels, CRD schema compatibility fixtures, Kubernetes-client runtime module separation, and fail-closed broad-watch rejection.
- Done: add `test:transactional-database:script-runtime:live` as the opt-in live Postgres script-runtime TransactionalDatabase validation command. Set `APPLIK8S_TRANSACTIONAL_DATABASE_SCRIPT_RUNTIME_DATABASE_URL` to run the live CRUD/diagnostic assertions.
- Done: live TypeKro/CNPG/Postgres TransactionalDatabase E2E validates the consolidated status reconciler's durable ConfigMap and KRO-owned hydration of the structural `status.applik8s.jobs` application status path.
- Done: add and live-confirm the Tenant Platform control-plane pressure test through TypeKro apply, CNPG provisioning, generated migration preflight/retry, authoritative generated-job app status, generated admin server, and Postgres-backed `TransactionalDatabase` Account create/query behavior in the pinned `orbstack` context.
- Done: close the generated status reconciler namespace bug exposed by the live Tenant Platform gate by emitting a concrete `APPLIK8S_NAMESPACE` for namespaced status reconcilers and adding generated-artifact coverage for that environment contract.
- Done: remove the Tenant Platform live-test query-string workaround by lowering Hono path parameters into generated route `request.query` alongside URL search params.
- Done: strengthen generated/script Postgres `TransactionalDatabase` parity guards and align generated runtime table-cache/status-patch behavior with the script-execution runtime.
- Done: implement public operation-target dry-run planning through `plan(target, { dryRun: true })`, backed by `operationTargetArtifacts.dryRunPlan`, fail-closed missing-artifact diagnostics, public type coverage, dispatcher/proxy tests, and live TypeKro operation-target E2E coverage.
- Done: harden durable generated-job status ConfigMap ownership by making it runtime-created and runtime-owned, leaving `status.json`, `applik8s-jobs.json`, and `updatedAt` outside KRO desired-state reconciliation while KRO observes it through `externalRef`; Tenant Platform live gate passes with the application CR as the authoritative read surface.
- Done: add generated-artifact coverage for unsupported watch predicates so unlowerable label selector expressions emit fail-closed app graph diagnostics instead of silently broadening runtime watches.
- Done: replace generated server startup-time dependency installation with a deterministic esbuild-produced server bundle, source map, route manifest, and runtime bundle manifest; generated artifact coverage asserts no `package.json`, no startup `npm install`, and Kubernetes ConfigMap size safety.
- Done: add generated-job status history retention in the runtime-owned status ConfigMap via `history.json`, preserving the latest job map and compact per-job history with a 20-entry cap; Tenant Platform live coverage checks a retained migration completion entry.
- Superseded: the earlier non-authoritative app-status fallback was replaced by a KRO-owned `externalRef`/CEL projection. The runtime-created ConfigMap remains the durable store, while KRO authoritatively owns `status.applik8s.jobs`.
- Done: add one bounded Kubernetes-native default for every v0.3 provider interface; additional cloud-scale adapters remain optional overrides.
- Done: strengthen generated-server route/action diagnostics so route action failures emit the declared `applik8s-route-action-failure` event with route metadata, failure policy, partial-effects marker, diagnostic payload, and stack fields.
- Done: durable generated-job status is locally covered for multi-job, CronJob, restart recovery, bounded history, idempotency, and conflict diagnostics. The current candidate adds authoritative KRO-owned root status hydration; live confirmation is required before release.
- Done: operation-target, watch-scope, migration-drift, and pressure-test contracts are shaped, tested, and covered by the v0.3 local/generated/live prerelease gates, including artifact-backed dry-run planning and fail-closed unsupported watch-predicate diagnostics.
- Done: generated server packaging no longer installs dependencies at pod startup for generated-source servers; deterministic bundles, source maps, route manifests, runtime bundle manifests, health checks, route/action diagnostics, and metadata-only supply-chain posture are part of the v0.3 release evidence.
- Remaining: script-execution `TransactionalDatabase` runtime live parity should be captured when the release context provides `APPLIK8S_TRANSACTIONAL_DATABASE_SCRIPT_RUNTIME_DATABASE_URL`; absent that URL, generated-runtime live Postgres evidence and script-runtime local/contract parity remain the v0.3 gate.
- Remaining: generated runtime implementation should continue deeper modularization after v0.3, especially around provider adapters and future indexer/aggregate/counter runtime split-out, but current runtime module boundaries are covered by v0.3 contracts.

v0.3 should not require:

- `[later]` Transparent portability of arbitrary model code across CRD, SQL, document, queue, and cache backends.
- `[later]` Hiding Kubernetes, TypeKro, database, or cache operational semantics behind one universal object model.
- `[later]` Building a general web framework unrelated to Kubernetes/infrastructure composition.
- `[movement-v0.1]` Building the workload-movement operator itself, or implementing full stateless/stateful movement, beyond freezing the applik8s contracts it will depend on.
- `[later]` Generic workflow orchestration beyond Kubernetes-native generated jobs and durable phase/status primitives.
- `[later]` Broad external provider ecosystem coverage beyond the concrete providers needed to prove stable v0.3 seams.
- `[later]` Helm, Kustomize, OLM, OCI, SLSA, SBOM, or admission-policy enforcement, unless needed only as documented compatibility posture.

## Post-v0.3 Workload Movement Release Bar

Purpose: build the first serious workload-movement operator after the applik8s v0.3 framework foundation and prove that the applik8s TypeKro integration is strong enough for real workload movement, not only tutorial operators.

The workload-movement proof depends on the applik8s v0.3 foundation. It should act as the pressure-test application for TypeKro listeners, watch scopes, RBAC, runtime, storage semantics, jobs, diagnostics, and packaging surfaces.

The workload-movement release should let an operator user:

- `[movement-v0.1]` Install the workload-movement operator built with applik8s TypeKro factory/reconciliation APIs.
- `[movement-v0.1]` Model source and target environments, movement plans, workload selections, dependency ordering, policy gates, and movement status as Kubernetes resources with clear schemas and status conditions.
- `[movement-v0.1]` Move stateless workloads according to the supported spec, including Deployments, ReplicaSets where relevant, Services, ConfigMaps, Secrets by reference policy, ServiceAccounts, RBAC objects, Ingress/Gateway-facing resources where supported, PodDisruptionBudgets, and related selectors/labels/annotations.
- `[movement-v0.1]` Move stateful workloads according to the supported spec, including StatefulSets, PVC/PV relationships, StorageClasses where policy allows, volume snapshot/restore or equivalent data-transfer hooks, stable identity, ordering, readiness, and rollback/abort behavior.
- `[movement-v0.1]` Preserve workload dependency ordering so infrastructure, identity, configuration, networking, storage, and workloads are planned and applied in a safe sequence.
- `[movement-v0.1]` Expose dry-run/plan output before effects, with explicit apply/delete/status/finalizer operation plans visible through applik8s diagnostics.
- `[movement-v0.1]` Provide finalizer-driven cleanup and abort semantics so partially moved workloads have durable status and safe teardown behavior.
- `[movement-v0.1]` Track per-workload and whole-plan status with `Ready`, phase, observed generation, progress, errors, last successful step, and actionable recovery guidance.
- `[movement-v0.1]` Handle stateless cutover, stateful preflight, stateful data movement, readiness verification, and post-cutover validation as explicit phases rather than hidden side effects.
- `[movement-v0.1]` Use applik8s TypeKro listeners to watch selected workload resources and dependent resources through exact, finite, and selector scopes.
- `[movement-v0.1]` Use applik8s operation targets to render and apply TypeKro/Kubernetes desired target resources while preserving validation and RBAC preflight.
- `[movement-v0.1]` Generate least-privilege RBAC for all watched, read, apply, patch, delete, status, finalizer, event, and storage/snapshot resources used by the movement plan.
- `[movement-v0.1]` Include local, character, vertical, generated-manifest, and live e2e tests that prove stateless movement, stateful movement, failure diagnostics, abort/finalize behavior, and idempotent reruns.
- `[movement-v0.1]` Document the supported workload kinds, unsupported kinds, storage assumptions, cluster/version assumptions, credential boundaries, and safety limits without implying generic disaster recovery beyond the implemented spec.

The workload-movement release should not require:

- `[later]` Full arbitrary workload portability for every Kubernetes API or third-party CRD.
- `[later]` Transparent data-plane replication without explicit storage/snapshot/data-transfer semantics.
- `[later]` Production disaster-recovery claims beyond the supported movement spec and tested environments.

## 1. Reconciliation Correctness Contract

Status: in progress
Difficulty: 9/10
Impact: 10/10

Purpose: define and implement exact semantics for every operation a handler can return.

Work:
- Specify operation semantics for `apply`, `status`, `patch`, `delete`, `event`, `finalizer`, and `requeue`.
- Done: specify and implement operation-target apply/delete semantics through canonical dispatcher graph/target rendering, including TypeKro reverse dependency ordering for deletes.
- `[v0.1-safety]` Define handler idempotency expectations.
- Done: define and implement initial conflict retry/backoff behavior with manifest-driven bounded exponential backoff.
- Done: define retry attempt accounting as in-memory scheduling/diagnostic state only; durable correctness must still come from idempotent reconciliation and Kubernetes state.
- Done: define how retry exhaustion is reflected in status diagnostics without relying on in-memory state for correctness.
- Done: define partial failure behavior when one operation in a validated plan fails after prior operations succeeded.
- Done: add an explicit partial-failure recovery model that distinguishes validation-time no-effect failures from apply-time failures after earlier effects are visible.
- Done: define and implement server-side apply field-manager ownership: explicit apply managers are validated before effects, handler apply/status ownership is distinct from runtime-authored lifecycle status ownership, and invalid managers fail closed.
- Done: define and implement status subresource behavior and fallback policy: generated manifests declare `statusSubresource`, and the host rejects owned-CRD status writes without it before effects instead of falling back to spec patches.
- Done: validate operation-plan RBAC declarations before Kubernetes effects so undeclared apply/patch/delete/status/finalizer/event permissions fail closed.
- Done: validate JSON Patch operation structure before Kubernetes effects, including pointer-shaped `path`/`from` and operation-specific `value` requirements.
- Done: validate event regarding namespace semantics before effects, so Events require an explicit namespaced regarding object or a namespaced owner default.
- Done: validate delete options before Kubernetes effects, including rejecting negative or fractional `gracePeriodSeconds`.
- Done: define and implement initial safe ownerReference behavior for same-namespace applied child resources, preserving explicit ownerReferences.
- Done: define initial ownership policy for cluster-scoped resources, cross-namespace resources, explicit opt-out, and resources with handler-provided ownerReferences.
- Done: define and implement fail-closed namespace/scope policy for known built-in operation targets: namespaced resources must declare a namespace, cluster-scoped resources must not, and unknown CRD scope remains host/manifest-aware.
- Done: reject handler-authored apply resources that attempt to set server-populated Kubernetes metadata such as `uid`, `resourceVersion`, `generation`, timestamps, or `managedFields` before effects.
- Done: add operation-plan ownership policy metadata for applied resources so garbage-collection behavior is explicit and testable.
- Done: define and implement split finalizer phase ordering: add before child side effects; remove after cleanup/effects.
- Done: host preflight rejects finalizer mutations outside a handler's declared finalizer ownership metadata before effects, while preserving legacy behavior for handlers without finalizer declarations.
- Done: define handler event routing semantics for `created`, `updated`, `deleted`, and `finalize` as reconciliation predicates, not exactly-once events.
- Done: implement `deleted` as best-effort deletion-timestamp routing after `finalize` priority and before reconcile fallback.
- Done: define and implement `statusChanged` as a best-effort predicate over current observed status, without relying on lossless watch history.
- `[v0.1-safety]` Define delete/finalize lifecycle behavior, including deletion-timestamp routing and finalizer requirements.
- Done: define and implement exact finalizer ownership/routing when finalize handler registrations declare owned finalizer names; legacy non-empty-finalizer routing remains only for undeclared handlers.
- Done: add host contract tests for declared finalizer mutation allow/deny behavior and legacy undeclared-handler compatibility.
- Done: runtime rejects non-canonical operation ordering before effects instead of relying only on SDK/compiler producers.
- `[v0.1-safety]` Add tests that make these guarantees executable.

Primary artifact: `RECONCILIATION_CONTRACT.md`.

## 2. Adversarial E2E Coverage

Status: in progress
Difficulty: 8/10
Impact: 9/10

Purpose: prove the reconciliation contract against real Kubernetes behavior, not only happy paths.

Work:
- Done: status field ownership conflict e2e proves failed status stops later effects and preserves the external status owner.
- Done: server-side apply field ownership conflict e2e proves failed apply stops later effects and preserves the external field owner.
- Done: delete and finalize e2e proves deletion-timestamp reconciliation, child cleanup delete, finalizer removal, and owner CR deletion.
- Done: finalizer add/remove lifecycle e2e proves add before normal processing and remove during finalize cleanup.
- TypeKro operation-target delete e2e with dependency-aware reverse teardown ordering.
- Done: controller restart and resync e2e proves startup reconciliation recreates missing child state after the operator is scaled down and back up.
- Done: RBAC denial diagnostics e2e proves forbidden API calls surface operation-level diagnostics and stop later effects.
- Done: malformed handler output e2e proves full-plan validation rejects invalid status payloads before any Kubernetes effects.
- Done: same-namespace ownerReference e2e proves applied child resources default to a controller ownerReference for the reconciled owner.
- Done: `finalize` event-routing e2e proves deletion-timestamp objects dispatch to a registered finalize handler instead of the reconcile handler.
- Done: finalize routing requires a deletion timestamp and a non-empty finalizer list, with reconcile fallback for deletion-timestamp objects that have no finalizers.
- Done: exact matching-finalizer routing when handler registrations declare owned finalizer names.
- Done: `created` event-routing e2e proves generation-1 objects dispatch to a registered created handler instead of the reconcile handler.
- Done: `updated` event-routing e2e proves a spec patch increments generation and dispatches to a registered updated handler instead of the reconcile handler.
- Done: host contract tests prove generation greater than 1 dispatches to a registered updated handler, with reconcile fallback when no specific event handler exists.
- Done: cluster-scoped CRD/operator live e2e proves generated ClusterRole/ClusterRoleBinding behavior and no invalid namespaced ownerReference defaulting from a cluster-scoped owner.
- Done: multi-namespace child live e2e proves cross-namespace child writes require explicit live RBAC and do not receive invalid cross-namespace ownerReferences.
- Done: focused partial operation failure live e2e proves diagnostics identify the failed operation, prior successful effects are visible, and later effects are skipped after a post-preflight Kubernetes RBAC denial.
- Done: focused adversarial live suite covers cluster-scoped ownership, multi-namespace child behavior, undeclared-permission preflight, host-routed HTTP capability execution with SecretRef auth/idempotency/redaction, and Lease failover. Difficulty: 9/10. Impact: 10/10.
- `[v0.1-safety]` Add a live e2e fixture matrix that distinguishes no-effect validation failures from after-effect Kubernetes failures and records expected status/log/replay evidence for each. Difficulty: 8/10. Impact: 9/10.
- `[v0.1-safety]` Keep adversarial e2e maintainable by splitting scenario helpers or focused files before the live test becomes hard to diagnose.
- `[v0.1-safety]` Split live reconcile e2e into focused scenario files before adding another major adversarial matrix.
- `[v0.1-safety]` Add live e2e coverage for handler timeout/cancellation once the runtime enforces timeout policy.
- Decompose the dense live reconcile e2e into focused files before adding another broad adversarial scenario group.
- Treat live e2e decomposition as an engineering-quality blocker before adding more scenarios beyond schema/finalizer/leader-election essentials.
- Done: live coverage for undeclared-permission preflight distinctly from raw Kubernetes RBAC denial proves both fail-closed layers.
- Done: adversarial e2e for cluster-scoped ownership and cross-namespace child resources before broadening owner policy.
- `[v0.1-safety]` Add live e2e coverage for shutdown readiness and controller stream cancellation once a reliable harness can signal the operator pod.
- Done: live e2e coverage for Lease failover proves HA readiness and controller stream ownership against real Kubernetes behavior.
- Done: live e2e coverage for host-routed HTTP capabilities proves idempotency-key propagation, generated Secret RBAC, Kubernetes Secret lookup, redacted auth behavior, and fail-closed missing-secret behavior.
- Clean up opt-in e2e gating so optional suites skip clearly when their required environment flags/context are absent, instead of failing for expected non-configured local runs.
- Done: centralized e2e opt-in gating for generated-artifacts and live-reconcile suites so non-opted-in local runs skip clearly under the e2e Vitest config.

## 3. Status And Lifecycle Conventions

Status: in progress
Difficulty: 7/10
Impact: 9/10

Purpose: give operator authors a predictable way to report durable progress and failure.

Work:
- Standardize `conditions`, `observedGeneration`, `phase`, `message`, and `lastTransitionTime` conventions.
- Done: define and implement success `Ready=True` and stale-generation `Ready=Unknown` conventions, not only failure conditions, for convention-enabled CRDs.
- `[v0.1-required]` Decide how handler diagnostics surface on CR status and Kubernetes Events.
- Done: surface handler invocation and plan-application failures as best-effort `Ready=False` object status conditions.
- Done: runtime-authored success `Ready=True` is written only after the handler invocation and operation plan application succeed.
- Done: runtime-authored stale-generation `Ready=Unknown` makes it visible when status does not yet reflect the latest `metadata.generation`.
- `[v0.1-safety]` Define transient retry and backoff status conventions beyond current failure and exhaustion reasons.
- Done: define and implement durable `Ready=False` / `RetryExhausted` status distinct from transient runtime failure reasons.
- Done: represent retry exhaustion durably through a best-effort spawned status update so kube-runtime's synchronous error policy does not block on async status writes.
- Done: add SDK helpers for common condition/status patterns, including standard condition creation/upsert and Ready shortcut.
- Done: ensure generated CRD status schemas admit standard runtime-authored conditions when status conventions are enabled.
- Done: prove runtime-authored failure conditions in live reconcile e2e for apply conflict, status conflict, RBAC denial, and malformed output.
- `[v0.1-required]` Ensure TypeKro composition can consume the relevant status shape naturally.
- `[v0.1-wow]` Add TypeKro-native examples and live tests where `Ready`, `observedGeneration`, and domain status drive downstream resource composition.

## 4. Runtime Observability

Status: in progress
Difficulty: 8/10
Impact: 8/10

Purpose: make live operators diagnosable without reading framework internals.

Work:
- Done: add initial structured JSON reconcile logs with reconcile ID, handler ID, resource ref, bundle digest, runtime version, handler ABI, and operation summary.
- Done: add operation failure logs with operation index, kind, target ref, field manager when relevant, root cause, and prior completed operation progress.
- Done: include requeue count in structured operation summary logs.
- Done: move host structured log emission to `tracing`/`tracing-subscriber` JSON instead of hand-emitted JSON lines.
- Error chains that preserve root cause from handler, bridge, validation, and Kubernetes API failures.
- `[v0.1-safety]` Preserve enough structured error-chain context for source-map mapping and replay without embedding sensitive object payloads in logs by default.
- `[v0.1-safety]` Define and implement a structured error-chain taxonomy across handler, ABI, bridge validation, host preflight, Kubernetes API, capability, replay, and status-writer failures without leaking payloads by default. Difficulty: 8/10. Impact: 8/10.
- Source-map-aware handler error reporting for generated WASM/JS failures.
- Done: generated source-map/metafile artifact identity is recorded in manifests and replay artifacts before implementing frame remapping.
- Done: replay inspection enables Node's maintained source-map runtime when available and reports whether source-map runtime support was active during local replay execution.
- Done: generated dispatcher preserves thrown/rejected handler stack frames across the handler ABI instead of reducing failures to message-only strings.
- Done: Rust host exposes handler failure stack frames as structured `handlerFailed` source-mapping diagnostics and metadata-only replay artifacts redact raw frames while preserving frame count.
- Done: replay inspection has an executable source-map fixture proving maintained Node source-map runtime can map local generated-bundle failures back to TypeScript source paths when debug artifacts are present.
- Done: generated runtime images embed diagnostic JavaScript bundle/source-map artifacts and source maps are emitted without embedded source content by default.
- Done: Rust host uses the maintained `sourcemap` crate to map preserved generated JavaScript handler stack frames back to TypeScript source frames when `/handler/handler.js.map` is present.
- Use existing source-map tooling for generated JS/WASM error mapping; do not hand-roll source map parsing.
- Done: add initial opt-in replay artifacts for handler invocation, plan-validation, and operation-application failures using `APPLIK8S_REPLAY_ARTIFACT_DIR`.
- Done: default replay artifacts use metadata-only object snapshots, redacted operation summaries, and redacted error causes; full input/plan/error capture requires `APPLIK8S_REPLAY_INCLUDE_PAYLOADS=1`.
- Done: generated plain YAML and TypeKro Deployment synthesis can opt into replay artifacts from `runtime.replayArtifacts`, with explicit directory validation and separate full-payload opt-in.
- `[v0.1-required]` Define replay artifact retention assumptions.
- Done: expand replay artifacts and tooling until a handler invocation can be reproduced locally without cluster access for full-payload artifacts.
- Done: add a concrete local replay artifact inspection workflow that validates replay artifacts, summarizes correlation metadata, and verifies debug artifact digests against a local bundle.
- Done: add full local replay execution that consumes full-payload replay artifacts and the compiled JavaScript bundle without requiring cluster access.
- Done: ensure replay execution clearly distinguishes deterministic handler replay from non-replayable Kubernetes API side effects.
- `[v0.1-safety]` Define replay artifact retention, rotation, and access-control assumptions for clusters where replay payload capture is enabled.
- `[v0.1-safety]` Safe replay redaction policy for future capability descriptors and richer status/error payloads.
- `[v0.1-safety]` Add capability-aware replay redaction rules before enabling more real external capabilities.
- `[v0.1-safety]` Add replay artifact retention/rotation/access-control guidance and executable redaction fixtures for capability requests, SecretRef auth, status payloads, and source-map diagnostics. Difficulty: 7/10. Impact: 8/10.
- Done: initial replay artifacts carry reconcile/log/status correlation IDs without storing full Kubernetes object payloads by default.
- Done: add initial trace/reconcile correlation conventions that connect logs, status conditions, metrics dimensions, and replay artifact metadata without leaking object payloads.
- Done: add Rust host `/healthz` and `/readyz` endpoints plus generated Deployment liveness/readiness probes.
- Done: add initial OpenTelemetry metrics using maintained Rust OTEL crates, with optional OTLP export via standard `OTEL_EXPORTER_OTLP_*` environment variables and no hand-rolled metrics encoding.
- Done: record reconcile starts, failures, duration, and operation counts.
- Done: add OpenTelemetry metrics for retry scheduling/exhaustion decisions.
- Done: add OpenTelemetry reconcile traces with OTLP export, safe reconcile/resource/handler attributes, lifecycle phase events, failure status, retry attributes, and operation summary counts.
- `[post-v0.1]` Add metrics for queue depth once the runtime exposes trustworthy kube-runtime/controller signals.
- Done: add source-map frame remapping for handler failures using maintained source-map tooling and keep metadata-only replay artifacts source-content-free by default.
- Done: add an end-to-end source-mapped handler failure fixture that proves TypeScript source locations appear in user-facing diagnostics.
- Done: add live/runtime source-mapped handler failure diagnostics that point TypeScript application developers to source frames without requiring generated JavaScript inspection.
- Treat source-mapped TypeScript diagnostics as a top-tier developer-excellence frog: handler crashes, thrown errors, rejected promises, and replay execution should identify application source frames when source maps are available.
- `[v0.1-safety]` Add richer structured error chains that preserve root causes from handler, bridge, validation, and Kubernetes API layers without leaking object payloads by default.
- Done: handler timeout diagnostics surface through structured logs/status as `HandlerTimedOut`.
- Done: handler invocation uses Wasmtime async calls plus Tokio wall-clock timeout, and host imports must be async/cancellable rather than blocking runtime worker threads.
- `[v0.1-safety]` Unsupported external capability protocols remain fail-closed placeholders until their typed request/response and cancellation semantics are implemented.
- Done: replace placeholder reconcile metadata with real per-reconcile correlation values, including unique reconcile IDs and actual start timestamps in handler input, logs, status diagnostics, metrics, and replay artifacts where applicable.
- Done: make structured tracing fields query-friendly without requiring downstream systems to parse a nested serialized event payload for common dimensions such as operator, handler ID, resource ref, bundle digest, operation index, failure reason, retry decision, and operation summary counts.

## 5. API Honesty And Product Proof

Status: in progress
Difficulty: 7/10
Impact: 9/10

Purpose: ensure public surfaces and executable product stories do not imply maturity that the implementation has not earned.

Work:
- Done: convert the first placeholder character promises into real executable product-story tests covering SDK authoring/local testing, compiler artifact generation, and TypeKro consumption.
- `[v0.1-required]` Keep character tests as user-recognizable product promises, not implementation-detail unit tests or permanently failing scenario catalogs.
- Done: remove `operatorBundle()` and pre-compile callable `installResources` from the v0.1 SDK surface instead of retaining throwing placeholders; install synthesis remains compiler/TypeKro manifest-aware.
- Done: remove or complete remaining public API placeholders before they become accidental contract: compiler facade methods now stay out of the public surface until implemented.
- Done: canonical dispatcher `applyGraph()` renders graph adapter operation plans for proxy and context handlers, with adapter errors surfaced instead of a placeholder exception.
- Done: compiler planning rejects unsupported `packageName`, non-canonical handler ABI versions, caller-supplied adapter requirement overrides, and non-empty caller host-import allowlists instead of silently ignoring them.
- `[v0.1-safety]` Ensure remaining compiler options are honest: implement, reject, or explicitly mark unsupported options such as deterministic build policy, source-map policy, and portability enforcement.
- Done: reject ambiguous multi-handler registrations before artifact emission: only one handler may own a resource/event route, except disjoint declared `finalize` finalizers.
- Done: add regression tests that fail if public SDK placeholders or unsupported compiler options become silently ignored again.
- Done: generated dispatcher wraps thrown/rejected handler failures into the WIT result shape so the host can classify them as handler failures with preserved stack text.
- `[v0.1-required]` Keep product-story tests focused on correctness, excellence, and vision alignment, not broad feature completeness.

## 6. Developer Experience Golden Path

Status: in progress
Difficulty: 6/10
Impact: 8/10

Purpose: make the happy path feel obvious and low-friction.

Work:
- Done: decide CLI shape: v0.1 exposes thin `applik8s build`, `applik8s explain`, `applik8s replay inspect`, and `applik8s test` commands; `applik8s dev` and `applik8s package` remain explicitly out of v0.1.
- Done: keep default output predictable: `dist/applik8s`.
- Done: add one initial ImageJob tutorial tied to executable product-story tests.
- `[v0.1-wow]` Turn the ImageJob tutorial into a polished end-to-end walkthrough with authoring, local test, build, live deploy, status inspection, source-mapped failure, replay inspection, and cleanup.
- Done: add an initial TypeKro tutorial tied to executable adapter vertical tests.
- Done: add initial generated-artifact walkthrough docs for plain YAML, TypeKro install, and GitOps consumption.
- Done: document the failure model for retries, partial effects, finalizers, status conflicts, SSA conflicts, RBAC denial, and malformed handler output in the reconciliation contract and runtime diagnostics guide.
- Done: document the security model in `docs/security-model.md`, including declared capabilities, host import policy, secret references, WASM sandbox boundaries, and what is not sandboxed.
- `[v0.1-required]` Improve generated artifact names and layout enough that users can understand `dist/applik8s` without reading compiler code.
- `[v0.1-required]` Make compile and runtime errors actionable.
- Done: make source-mapped handler failures actionable enough that TypeScript application developers do not need to inspect generated JS/WASM by default.
- `[v0.1-wow]` Add one excellent golden-path tutorial that proves the core promise end-to-end: typed CRD, proxy handler, generated artifacts, local test, live deploy, status, and cleanup.
- Done: make the ImageJob tutorial lead with streamlined proxy semantics plus real SDK-backed work: status assignment, finalizer add/remove, typed child resource apply/delete through the golden-path `job.k8s.ConfigMap(...)` factory, Events, and S3-compatible object processing in one concise handler.
- Done: add an executable product-story assertion that the primary documented handler shape stays aligned with the real `examples/imagejob.ts` API surface.
- Done: ensure the documented one-command build path in the golden path remains covered by CLI regression tests and release gates.
- Done: make the generated-artifact walkthrough connect each tiny TypeScript handler operation to generated YAML, RBAC/runtime validation, status/events/requeue/finalizer behavior, and manifest routing evidence.
- Done: local `testOperator()` supports honest `expectManifest`, `expectRbac`, `expectSchema`, and `expectExternalEffect` assertions for locally knowable metadata/status without pretending to prove live Kubernetes acceptance.
- Done: local `testOperator()` supports `expectPatch`, `expectDelete`, and `expectFinalizer` so golden-path tests can assert every stable operation kind without inspecting raw plans.
- Done: `examples/imagejob.ts` is the canonical golden-path source consumed by the product-story character test, compiler artifact test path, TypeKro adapter test, and docs.
- Done: upgrade the canonical ImageJob story from placeholder output URLs to real AWS S3 SDK reads/writes against S3-compatible storage, with local fixture tests and Ministack-backed live proof.
- Done: teach the generic synth/deploy workflow in the README: `applik8s build`, inspect `dist/applik8s`, run the generated apply script locally, set `APPLIK8S_IMAGE`/`APPLIK8S_PUSH_IMAGE` for remote clusters, and apply CR instances with `kubectl`.
- Done: add `docs/imagejob-golden-path.md`, `docs/generated-artifacts.md`, and `docs/replay-debugging.md` as user-facing walkthroughs tied to executable surfaces.
- Done: add a thin `applik8s` CLI wrapper for build, diagnostic explain, replay inspect, and test commands over existing compiler/replay/Vitest behavior.
- Done: add initial docs for plain YAML, TypeKro installation, GitOps consumption, replay artifacts, and security posture.
- Done: add a minimal CLI only after the build/runtime contracts are stable enough that the CLI is a thin wrapper, not a second product surface.
- `[v0.1-required]` Expand generated-artifact docs so the operator manifest, runtime image, CRDs, RBAC, Deployment, replay artifacts, and fail-closed unsupported features are explained from the user's point of view.
- `[v0.1-required]` Make runtime timeout, cancellation, compatibility, and capability-denial errors actionable in status/log diagnostics and user docs.
- Done: add a concise golden-path diagnostic guide that maps common runtime reasons such as `ApplyFailed`, `UndeclaredPermission`, `HandlerTimedOut`, and `InvalidRuntimePayload` to fixes.
- `[v0.1-required]` Keep CLI/docs polish behind correctness, but do not let runtime sophistication become inaccessible to TypeScript application developers.
- Done: add adversarial SDK/local harness normalization tests for mixed proxy/explicit handler results and malformed explicit status returns.
- Done: add public package/release-readiness work once the API is honest enough to publish: package metadata, exports, semver posture, release notes, and stabilization boundaries.
- `[post-v0.1]` Add a polished failure/replay first-run chapter that intentionally breaks the ImageJob handler, shows source-mapped TypeScript diagnostics, inspects a replay artifact, and explains how to fix the failure without reading generated JavaScript. Difficulty: 6/10. Impact: 8/10.

## 7. TypeKro Polish

Status: v0.2 release slice complete; broader polish continues after v0.2
Difficulty: 8/10
Impact: 8/10

Purpose: make operators feel like first-class TypeKro components.

Work:
- Done: hide remaining internal seams in `asComposition()` for the v0.1 install-composition path.
- Done: document and stabilize direct/kro readiness behavior as part of the integrated TypeKro UX.
- Done: preserve TypeKro graph teardown semantics for operation-target deletes, including reverse-topological deletion and resource scopes where applicable.
- Done: add vertical tests proving `ctx.delete(typeKroTarget)` deletes dependents before dependencies and preserves delete options through handler/proxy and generated-dispatcher normalization.
- Done: add TypeKro operation-target apply/delete e2e proving live runtime operation-target semantics against Kubernetes resources.
- Done: make TypeKro status composition consume runtime `Ready`/`observedGeneration` conventions naturally in live compositions.
- Done: add a TypeKro status-composition contract test proving graph status projections can be mapped into handler status without relying on static fallback readiness.
- Done: add TypeKro-native live status composition proof where operator CR status drives a downstream TypeKro resource without static fallback readiness.
- Done: make callable operator install/status ergonomics match the public product phrase for the v0.1 `typeKro.composition(...)` path: operators install like components, CRDs instantiate like resources, statuses compose like TypeKro resources.
- Done: make the integrated TypeKro-facing golden path use one package: TypeKro factories, applik8s-wrapped `kubernetesComposition`, resource listeners, operator install, CRD factory usage, and status composition in one user experience.
- Done: `[v0.2-typekro]` Make the flagship operator install story direct-call authoring: `const pipeline = imagePipeline({ namespace, replicas })` inside applik8s `kubernetesComposition(...)`, followed by `pipeline.imageJob(...)` and status composition.
- Done: `[v0.2-typekro]` Add compile-time lowering for operator install bindings captured in applik8s TypeKro compositions, with diagnostics when compiled artifacts, manifests, runtime metadata, or CRD factories cannot be resolved.
- Done: make TypeKro operation targets inside applik8s handlers public v0.1 surface through ergonomic aliases: `typeKro.operationTarget()`, `typeKro.targetFactory()`, `typeKro.graphAdapter()`, and `typeKro.composition()`, while preserving precise lower-level aliases for integration authors.
- Done: add API docs, public type inference coverage, character-test language, and adapter vertical tests for the ergonomic TypeKro handler-target surface.
- Done: add live validation for `ctx.apply(typeKroTarget)` and `ctx.delete(typeKroTarget)` semantics before announcing this as a release-highlight path.
- Done: prove RBAC inference, reverse-topological deletion, status mapping, and failure diagnostics through shared compiler/runtime gates rather than adapter-only tests.
- Done: reduce noisy static-status fallback warnings where practical and document remaining TypeKro fallback analyzer messages as expected for unsupported status-builder patterns.
- Done: add examples for operator install, CRD factory usage, status composition, TypeKro factory re-exports, and listener-backed composition authoring.
- Done: keep TypeKro integration as an extension seam, not a core dependency.
- Done: integrate the upstream TypeKro KRO-factory lifecycle seam for generated-CRD prerequisites through public `kroPrerequisites.resources`; applik8s does not depend on private TypeKro internals.
- Done: build a TypeKro-native live tutorial where an applik8s operator is installed as a composition, CRD instances are created through generated factories, observed `Ready`/domain status drives downstream TypeKro resources, and TypeKro resource listeners reconcile external watched resources. Difficulty: 9/10. Impact: 10/10.
- Done: expose instance-scoped `.on.*` handlers on CRD resources returned from direct-call operator install bindings, e.g. `const image = pipeline.imageJob(...); image.on.reconcile(handler)`, grouped by the enclosing wrapped `kubernetesComposition(...)` or an explicit operator/group override.
- Done: let composition authors add generated-CRD handlers outside the original `sdk.operator({ handlers: [...] })` block, while preserving owned-CRD semantics, scoped watches, RBAC inference, and duplicate route diagnostics.
- Done: `[v0.2-typekro]` Add a live direct-call composition proof where `applik8s build --typekro` compiles a mixed TypeKro/operator entrypoint, generated resources install the operator, and the generated CRD instance reconciles on a pinned Kubernetes context.
- Done: `[v0.2-typekro]` Harden mixed TypeKro/operator entrypoint compilation for self-contained handlers by using a static nested dispatcher instead of importing TypeKro's Node-only composition runtime into the WASM handler bundle.
- Done: add a TypeKro-native resource listener bridge so TypeKro resource instances expose applik8s-compatible `.on.reconcile`, `.on.created`, `.on.updated`, `.on.deleted`, `.on.finalize`, and `.on.statusChanged` handlers without requiring users to define duplicate applik8s CRDs.
- Done: default TypeKro-backed listener grouping to the enclosing applik8s-wrapped `kubernetesComposition`, so handlers declared on resource instances in one composition lower into one generated operator manifest/RBAC/runtime bundle.
- Done: support an explicit operator/grouping argument on TypeKro-backed listener registration, e.g. `deployment.on.updated(platformOperator, handler)`, so users can force grouping across composition boundaries or resolve ambiguous grouping instead of relying on hidden global registration.
- Done: make TypeKro listener registration instance-addressed by namespace/name when the TypeKro resource instance exposes concrete metadata; avoid misleading factory-level `.on.*` semantics.
- Done: `[v0.2-typekro]` Make generated TypeKro build artifacts deploy KRO graphs safely with `typekro/apply.sh`: generated CRDs first, wait for establishment, KRO `ResourceGraphDefinition` resources next, then retry remaining resources while KRO-generated APIs and client discovery settle.
- Done: add finite and selector-scoped listener groups through `Resource.instances([...])`, `Resource.where(selector)`, and `typeKro.resources([...])`.
- Done: infer watch/list/read/status/finalizer/event RBAC from TypeKro-backed listener sources and prove those permissions through compiler gates, generated manifest tests, and live handler-routing e2e.
- Done: add TypeKro listener authoring character scenarios plus executable vertical/generated/live tests for registration-only form, operator-grouped form, duplicate scope rejection, addressed/selector watch routing, and handler grouping diagnostics.
- Done: add umbrella-package exports for `@applik8s/applik8s/factories` and `@applik8s/applik8s/typekro`, including package export maps, type declarations, and bundle tests.

## 8. Schema And CRD Correctness

Status: in progress
Difficulty: 9/10
Impact: 10/10

Purpose: ensure TypeScript types, runtime validation, and Kubernetes structural OpenAPI schemas describe the same contract.

Work:
- Harden ArkType-to-Kubernetes structural OpenAPI conversion, including optional, nullable, enum, array, map, and object behavior.
- Done: add SDK runtime parity coverage for ArkType optional fields, scalar enums, arrays, maps, nested objects, nullable unions, and boolean literals, with unsupported emitted schemas failing closed before validation.
- Done: normalize safe ArkType JSON Schema dialect output into the supported structural subset before runtime validation and artifact emission: nullable `anyOf` pairs become `nullable`, scalar `const` becomes single-value `enum`, and scalar `enum` output gets an inferred type.
- Fail closed at build time for schema forms Kubernetes cannot represent safely.
- `[v0.1-safety]` Add compatibility tests for generated CRDs against Kubernetes structural schema requirements.
- Done: add opt-in Kubernetes-apiserver-backed CRD schema acceptance e2e using server-side dry-run against generated CRDs.
- Done: treat API-server-backed CRD schema acceptance as a quality gate before broad schema feature expansion.
- Use existing JSON Schema/OpenAPI/Kubernetes validation libraries where possible for validation and golden checks; keep only product-specific ArkType-to-Kubernetes translation custom.
- Done: factor Kubernetes structural OpenAPI validation and normalization into one shared compiler schema gate consumed by both plain YAML and TypeKro synthesis, so artifact adapters cannot drift silently.
- Done: ensure status subresources, pruning behavior, and unknown-field behavior are explicit and tested, including fail-closed rejection of `x-kubernetes-preserve-unknown-fields: true` until retention semantics are designed.
- `[v0.1-safety]` Add adversarial schema fixtures for unsupported unions, nullable/optional mismatches, map/list schemas, nested objects, status conventions, and Kubernetes pruning behavior.
- Done: preserve malformed ArkType-emitted nested schema shapes through normalization so diagnostics report them instead of silently erasing unsupported properties.
- Done: add compiler/YAML fixtures proving safe ArkType enum, const, nullable, array, map, and nested object output emits structural CRD OpenAPI, while unsafe mixed unions still fail before CRD emission.
- Done: add TypeKro adapter fixtures proving the same ArkType-normalized structural schemas survive TypeKro CRD synthesis and unsafe mixed unions fail through the shared schema gate.
- Done: add storage-version and conversion-webhook design notes before supporting multi-version CRDs beyond simple served/storage metadata.
- Done: manifest generation and validation fail closed for multi-version CRDs and conversion webhooks until conversion, storage migration, and rollback compatibility are implemented.
- `[v0.1-safety]` Add tests for generated CRD OpenAPI behavior around required fields, additionalProperties, oneOf/anyOf/allOf rejection, nullable fields, arrays, maps, nested objects, metadata preservation, status subresource shape, and Kubernetes list-map conditions.
- `[v0.1-safety]` Expand API-server-backed CRD schema acceptance with more focused fixtures once the schema matrix grows.
- `[v0.1-safety]` Keep the schema adapter boundary neutral so future schema systems can integrate without changing the operator model.
- Treat deep ArkType-to-structural-OpenAPI correctness as a top-tier frog: TypeScript types, runtime validation, and Kubernetes schema must not diverge silently.
- Done: harden Kubernetes structural schema validation for forbidden composition keywords, tuple arrays, invalid `additionalProperties`, invalid `nullable` usage, malformed Kubernetes list-map extensions, missing object property schemas, and unsafe defaulting/pruning assumptions.
- Done: harden scalar enum validation so malformed, empty, non-scalar, missing-type, and type-inconsistent enum schemas fail closed before artifact emission.
- Done: harden Kubernetes list-map validation so merge-key fields must exist and be required on array item schemas, preventing optional identity keys from silently producing misleading CRD merge behavior.
- Done: add golden schema fixtures that prove accepted schemas preserve map/list/object/status semantics and rejected schemas fail before artifact emission.
- Done: add TypeKro adapter regression coverage proving structural schema hazards fail closed through the same schema gate as plain YAML.
- `[v0.1-safety]` Keep every generated-artifact adapter on the shared structural schema gate; future Helm/GitOps/OCI emitters must not copy or weaken CRD schema validation.
- `[v0.1-safety]` Keep source maps and diagnostics strong, but treat schema correctness as the foundation for CRDs-as-durable-domain-state.
- `[post-v0.1]` Define and eventually implement CRD multi-version, conversion webhook, storage migration, and rollback compatibility semantics; keep current fail-closed behavior until that contract is real.

## 9. ABI And Contract Maturity

Status: in progress
Difficulty: 8/10
Impact: 9/10

Purpose: make independently generated bundles and runtime hosts compatible over time.

Work:
- Done: Rust operator host validates `spec.handlerAbi` against supported handler ABI `applik8s.handler/v1alpha1` and fails closed on missing or unsupported declarations.
- Done: Added a persisted generated bundle fixture test against the current runtime host.
- Done: Rust operator host validates `spec.requiresRuntime` against the host runtime semver before startup/reconcile and fails closed on missing, invalid, or incompatible declarations.
- Done: document contract evolution policy in `docs/contract-evolution.md`, including manifest version, handler ABI, runtime semver, fixture policy, and fail-closed behavior.
- Done: add explicit handler ABI evolution fixtures for timeout/cancellation, host imports, optional runtime fields, and an incompatible future ABI rejection case.
- Done: add manifest-version compatibility checks separately from handler ABI and runtime semver checks; Rust host rejects missing, invalid, and unsupported operator manifest apiVersions before trusting spec fields.
- `[v0.1-safety]` Expand migration/compatibility fixture tests across future bundle/runtime versions, including incompatible handler ABI, manifest version, and CRD schema evolution cases.
- `[post-v0.1]` Add CRD schema evolution compatibility fixtures before supporting multi-version CRDs or conversion webhooks.
- Done: add a persisted bundle compatibility matrix covering older/current/future manifest versions, handler ABIs, runtime requirements, host import declarations/evolution, and owned CRD status metadata. Difficulty: 8/10. Impact: 9/10.
- `[v0.1-safety]` Add explicit ABI migration fixtures for optional field additions, required field additions, host import evolution, and incompatible output schema changes before introducing `v1beta1`. Difficulty: 9/10. Impact: 9/10.
- Done: record bundle digest, source digest, compiler version, handler ABI, and runtime requirement annotations on generated Kubernetes resources and operator pod templates for audit.

## 10. Security And Capability Enforcement

Status: in progress
Difficulty: 9/10
Impact: 9/10

Purpose: ensure handlers only do what the operator contract declares.

Work:
- `[v0.1-safety]` Strengthen runtime capability enforcement.
- `[v0.1-safety]` Ensure undeclared external access is impossible or explicitly denied.
- Done: define initial SecretRef handling and prevent embedded secret material by default for supported HTTP capabilities.
- Done: define and enforce ambient filesystem/network assumptions for handler WASM execution through build checks, ComponentizeJS feature controls, and fail-closed host imports.
- Done: generated manifests declare WASM host imports and Rust host validates actual component imports against the allowlist before startup/invocation.
- Done: harden compiler build checks for Node-native runtime assumptions, dynamic module loading, absolute environment-specific paths, common local/cloud credential files, and obvious hardcoded secret material.
- Done: implement the first real external capability host import for opt-in `auth:none` HTTP JSON capabilities through `applik8s.capability/v1alpha1`, with redacted audit logs and mutation idempotency-key enforcement.
- Done: generated dispatcher exposes declared capability descriptors as clients that call the host protocol only when the ComponentizeJS WIT import is supplied; local/no-host execution still fails closed.
- Done: Rust `capability-request` host import returns structured JSON responses and keeps unsupported capability execution denied.
- `[v0.1-safety]` Preserve the operation-plan model when adding capabilities; external effects must be typed, cancellable, auditable host protocols rather than arbitrary handler escape hatches.
- `[post-v0.1]` Define capability manifest schema for external cloud/database/queue/object-store/identity access, including secret refs, audit metadata, and generated policy/RBAC implications.
- Done: define and implement bounded retry and `Idempotency-Key` header propagation for the initial `auth:none` HTTP JSON capability host protocol.
- Done: reject unsafe capability timeout and retry policy during manifest generation, matching host bounds before bundles can be emitted.
- Done: generated dispatcher and runtime contract propagate `reconcileId` on capability requests, reject declared mutation capability calls without handler-provided idempotency keys before the host import, and fail closed on malformed successful host responses.
- `[post-v0.1]` Define per-capability cancellation and broader auth semantics before allowing additional live external capability effects beyond the supported HTTP SecretRef path.
- Done: implement secret-backed HTTP capability auth using Kubernetes Secret references, generated least-privilege Secret RBAC, strict redaction, and fail-closed missing/malformed secret behavior.
- Done: preserve explicit SDK capability timeout values, including invalid values such as `0`, so manifest validation rejects them instead of silently treating them as omitted.
- `[post-v0.1]` Define custom HTTP auth header/scheme descriptors separately from the initial narrow `Authorization: Bearer <secret>` SecretRef behavior.
- Done: reject unsupported capability auth descriptor types during manifest generation, including untyped/casted custom auth metadata, until custom HTTP auth headers and schemes have explicit semantics.
- Done: define durable external-effect guidance: intent, idempotency key, observed result, and failure state should live in Kubernetes status or related CRDs when correctness depends on the external effect.
- Done: add SDK status helpers for durable external-effect records keyed by capability name and idempotency key, including request/response digests, phase, observed time, and optional condition.
- Done: generated manifests normalize declared capability names, record disabled live-execution posture, and include audit/redaction/idempotency metadata before any real external effects are enabled.
- Done: manifest generation rejects unsupported live capability execution/protocol declarations until the Rust host implements the external capability protocol.
- Done: add build-time checks for likely captured local credentials, environment-specific absolute paths, unsupported filesystem/environment/raw-network assumptions, and unsupported native modules.
- Done: add initial policy/admission-facing validation metadata for declared capabilities, RBAC, runtime image provenance posture, and bundle compatibility.
- Done: generated YAML and TypeKro install resources annotate RBAC posture with mode, least-privilege review flag, and rule count for admission/policy inspection.
- Done: detect likely local credential or secret capture during bundling where feasible, including common kubeconfig, cloud credential, dotenv, SSH, npm, Docker, and token/private-key patterns.
- `[v0.1-safety]` Add provenance, SBOM, signing, and verification plan that is honest about v0.1 metadata-only posture.
- Done: generated manifests and deployed resource annotations explicitly record the current supply-chain posture as unsigned, no SBOM, no provenance, metadata-only admission verification.
- `[post-v0.1]` Add concrete SBOM/provenance/signing artifact fields and verification enforcement only after choosing supported tooling and verification semantics.
- Done: define admission/policy metadata annotations for timeout, runtime ABI, runtime requirement, host imports, declared capabilities, capability protocols, live execution, redaction, and idempotency posture so clusters can inspect unsafe bundles before rollout.
- `[post-v0.1]` Choose maintained tooling for SBOM/signing/provenance/admission integration, then move from honest metadata to verifiable artifacts and enforceable policy.
- `[post-v0.1]` Select and integrate maintained SBOM/signing/provenance tooling, then emit verifiable artifacts and update admission annotations only when verification is real. Difficulty: 9/10. Impact: 9/10.
- `[post-v0.1]` Add admission-policy verification fixtures for unsigned/no-SBOM/no-provenance bundles, signed bundles, declared capabilities, runtime compatibility, and least-privilege RBAC posture. Difficulty: 8/10. Impact: 8/10.
- Done: document the runtime sandbox boundary precisely, including what WASM/ComponentizeJS/host imports do and do not isolate.
- Done: document that fail-closed capability placeholders are a safety boundary, not yet a usable external effects feature.
- `[post-v0.1]` Define the production credential and auth posture for direct SDK/fetch examples, including how local emulator credentials differ from AWS/cloud credentials and when authors should prefer declared host capabilities. Difficulty: 7/10. Impact: 8/10.
- `[post-v0.1]` Decide whether direct SDK/fetch should support optional manifest-declared endpoint/auth/audit metadata so teams can keep SDK ergonomics while gaining policy inspection, redaction posture, and idempotency guidance. Difficulty: 9/10. Impact: 9/10.
- `[later]` Align with policy/admission ecosystems later.

## 11. Operational Maturity

Status: in progress
Difficulty: 8/10
Impact: 8/10

Purpose: make generated operators behave predictably under real controller lifecycle and rollout conditions.

Work:
- Done: add Lease-based leader election using `kube-lease-manager`, including leadership-driven readiness and controller stream start/stop.
- Done: document and enforce the current explicit single-replica/single-worker concurrency contract while real leader election and controller concurrency policy remain unavailable.
- Done: fail closed for `deployment.replicas > 1` at compiler/YAML/TypeKro synthesis unless leader election is explicitly enabled.
- Done: validate `spec.runtime.leaderElection.enabled` in generated manifests and Rust host compatibility validation before controller startup.
- Done: define and implement basic health/readiness behavior separately from Deployment rollout readiness.
- Done: define and implement initial production-oriented retry/backoff policy for handler and Kubernetes API failures using kube-runtime error policy plus a maintained backoff crate.
- Done: surface retry/backoff decisions through structured logs and OpenTelemetry metrics.
- `[v0.1-safety]` Surface retry/backoff decisions through durable status conventions where safe.
- Done: add initial graceful shutdown behavior using Tokio signal handling; shutdown marks readiness false, signals the probe server to drain, and drops kube-runtime controller streams.
- Done: define readiness behavior during shutdown and failed bundle/runtime compatibility validation; readiness stays false until compatibility/import/controller construction succeeds and flips false during shutdown.
- `[post-v0.1]` Add upgrade and rollback semantics for runtime image changes, handler ABI changes, and CRD schema evolution.
- `[post-v0.1]` Add executable rollout/rollback compatibility checks for runtime image changes, handler ABI changes, manifest evolution, CRD storage-version changes, and external-effect posture. Difficulty: 9/10. Impact: 9/10.
- `[post-v0.1]` Define how generated Deployments roll forward/back when runtime image tags are digest-derived and bundle compatibility changes.
- `[post-v0.1]` Define CRD storage-version and conversion compatibility rules before implying rollback safety across schema changes.
- `[v0.1-required]` Define uninstall semantics that clearly distinguish controller removal, retained CRDs, retained instances, and destructive domain-data deletion in generated docs/artifacts.
- `[post-v0.1]` Turn upgrade/rollback/uninstall posture into executable compatibility checks and generated user-facing guidance; do not imply rollback safety across unsafe CRD storage/schema/external-effect changes.
- Done: generated install resources annotate CRD storage version, conversion strategy, storage-migration posture, rollback safety, and uninstall/delete-domain-data posture for audit/policy tooling.
- `[v0.1-safety]` Add e2e coverage for restart/resync and minimal rollout safety; keep deeper multi-replica behavior post-v0.1 unless needed for the public demo.
- Done: generated operators do not default to or imply HA/multi-replica safety; unsafe multi-replica requests are rejected unless the Lease-based leader-election contract is configured.
- Done: unsupported `runtime.concurrency.workerCount`, `maxInFlightPerResource`, and `maxQueueDepth` settings fail closed instead of being silently ignored.
- Done: add handler timeout enforcement using Wasmtime epoch interruption so stuck handlers cannot block reconcile workers indefinitely.
- Done: define initial per-capability retry, idempotency, and timeout semantics for `auth:none` HTTP JSON capabilities.
- `[post-v0.1]` Define per-capability cancellation and richer protocol semantics before allowing additional live external capability effects.
- `[post-v0.1]` Add multi-replica safety/failover e2e for the Lease-based leader-election implementation.
- `[v0.1-required]` Add generated operator lifecycle guidance for startup, readiness, shutdown, leader failover posture, upgrade/rollback limitations, and uninstall/data-retention semantics. Difficulty: 6/10. Impact: 8/10.
- Done: add leader-election implementation notes in `docs/leader-election.md`, comparing a `kube-leader-election` dependency against direct Lease API implementation before enabling `replicas > 1`.

## 12. Packaging And Distribution

Status: in progress
Difficulty: 6/10
Impact: 6/10

Purpose: distribute the same underlying operator bundle through multiple Kubernetes-native packaging channels.

Work:
- `[v0.1-required]` Keep plain YAML as the baseline artifact.
- `[post-v0.1]` Add OCI bundle/image story.
- `[v0.1-required]` Add GitOps-friendly output and docs for committing/reviewing generated YAML without divergent runtime semantics.
- `[v0.1-safety]` Ensure generated artifacts remain a single underlying operator definition consumable by YAML, TypeKro, GitOps, and future OCI packaging without divergent behavior.
- `[post-v0.1]` Harden and test remote-registry deployment workflows across local Docker-backed clusters and remote clusters, including generated image tags, push behavior, Deployment patching, image pull policy, and diagnostics when the cluster cannot pull the runtime image. Difficulty: 7/10. Impact: 8/10.
- `[post-v0.1]` Consider Helm, Kustomize, and OLM once the artifact model is stable.
- `[v0.1-safety]` Keep deployment orchestration out of core.
- `[v0.1-safety]` Track feature completeness explicitly without allowing packaging breadth to outrun reconciliation, status, observability, and security correctness.

## 13. Explicitly Out Of v0.1

Status: release boundary
Difficulty: 5/10
Impact: 10/10

Purpose: make the first public release focused, honest, and free of private strategy.

Work:
- `[v0.1-safety]` Keep public v0.1 limited to the applik8s author/test/build/deploy/diagnose/TypeKro path.
- `[v0.1-safety]` Do not publish multi-cluster application movement or disaster-recovery APIs, docs, examples, tests, packages, or demos as part of the v0.1 release surface.
- `[v0.1-safety]` Do not publish private research packages or product-story tests as part of the v0.1 release surface.
- `[v0.1-safety]` Do not use private product names, domains, package scopes, repository orgs, or CRD API groups in public v0.1 artifacts.
- Done: public examples and tutorials use `media.applik8s.dev` API groups and `@applik8s/*` package imports.
- Done: release readiness checks fail on private branding and workload-mobility terms in public release files.
- Done: move internal-only packages out of the public tree rather than relying only on package-publish exclusions.
- Done: release readiness fails if internal-only package paths reappear in the public release tree.

## 16. Public Release Readiness

Status: ready for v0.1.0
Difficulty: 7/10
Impact: 9/10

Purpose: make v0.1 installable, understandable, versioned, and honest for public users.

Work:
- Done: decide public package names and exports for the umbrella package and subpackages: SDK, compiler, testing, TypeKro adapter, runtime contract, and CLI.
- Done: remove `private: true` from packages intended for publication and add package metadata: description, license, repository, files, exports, and bin where applicable.
- Done: define v0.1 semver posture, public/experimental/internal surfaces, and generated-bundle compatibility in `docs/stabilization-boundary.md`, `docs/contract-evolution.md`, and `RELEASE_NOTES.md`.
- Done: add release notes for v0.1 that state the exact supported path: author, local test, build, deploy, diagnose, and TypeKro install boundaries.
- Done: add a stabilization boundary document covering `crd()`, `operator()`, proxy handlers, context handlers, operation plans, capabilities, manifests, runtime contract, and generated artifacts.
- Done: add a publishing dry-run workflow that verifies package contents, exports, CLI bin, generated artifacts, and no accidental private/internal files.
- Done: add an automated release preflight that checks publishable package metadata, local dependency ranges, and required public docs before publishing.
- Done: decide v0.1 runtime image posture: tutorials build locally from generated artifacts; published image support is not promised until build/publish evidence is captured.
- `[post-v0.1]` Add automated changelog generation and signed release artifacts after the first manual release process is proven.

## 17. CI, Quality Gates, And Kubernetes Compatibility

Status: ready for v0.1.0
Difficulty: 8/10
Impact: 9/10

Purpose: make the release process trustworthy and repeatable without requiring every contributor to run a full cluster matrix locally.

Work:
- Done: define and script required local gates: typecheck, lint, implemented Vitest suite, character tests, Rust workspace tests, runtime contract check, release-readiness checks, and CLI build smoke coverage.
- Done: define and script pre-release gates: local gates plus generated-artifact, CRD schema acceptance, live reconcile, TypeKro deploy, live adversarial, and partial-failure E2E against an explicit local Kubernetes context.
- Done: make opt-in E2E skips explicit and add a manual release-evidence workflow that requires live prerelease gates when cluster credentials/context are configured.
- Done: add CI artifact retention for generated `dist/applik8s` and artifact listings in the release-evidence workflow; logs, replay artifacts, source maps, and Kubernetes events on live failure still need richer capture.
- Deferred: formal E2E flake policy can mature post-v0.1; current release evidence does not use retries to hide reconciliation failures.
- Done: define v0.1 Kubernetes compatibility as evidence-based for the tested OrbStack `orbstack` target, with server version `v1.33.5+orb1`; broader minimum-version claims stay out of v0.1 until matrix evidence exists.
- Deferred: a Kubernetes compatibility matrix is post-v0.1; v0.1.0 documents evidence-based compatibility for the tested OrbStack `orbstack` target.
- `[post-v0.1]` Expand CI to run against multiple Kubernetes distributions and versions.
- `[post-v0.1]` Add nightly stress/adversarial suites that are not release-blocking until stable.

## 18. Performance And Scale

Status: ready for v0.1.0
Difficulty: 7/10
Impact: 7/10

Purpose: prevent v0.1 from feeling impressive only on tiny demos while avoiding premature optimization.

Work:
- Done: establish local ImageJob build and artifact-size baseline metrics; runtime image size, cold invocation, live reconcile latency, and pod memory still require the pinned live pre-release run.
- Done: document expected v0.1 scale boundaries: number of owned CRDs, watched resources, object size, bundle size, and local-cluster assumptions.
- Done: add a smoke performance test that reconciles enough sample objects to catch pathological O(n^2) behavior in dispatcher, manifest lookup, or status writing.
- Deferred: bundle-size regression thresholds are post-v0.1; v0.1.0 captures generated artifact/package size evidence without claiming scale guarantees.
- `[post-v0.1]` Benchmark queue depth, controller concurrency, watch cardinality, cache behavior, and multi-replica leader-election failover once concurrency policy exists.
- `[post-v0.1]` Add sustained soak tests with replay artifact rotation and metrics export enabled.

## 19. Documentation, Examples, And Product Positioning

Status: ready for v0.1.0
Difficulty: 6/10
Impact: 9/10

Purpose: make v0.1 legible, exciting, and honest to developers encountering the project for the first time.

Work:
- Done: write a top-level README that explains the product in one minute, shows the ImageJob example, states the v0.1 maturity boundary, and links to the tutorial/docs.
- Done: produce `docs/first-run.md` and the ImageJob guide as the canonical first-run experience.
- Done: edit public docs so the first impression leads with tiny TypeScript semantics, then inspectable Kubernetes artifacts, fail-closed runtime validation, and TypeKro composition proof.
- Done: add a docs consistency pass that checks README, ImageJob guide, API reference, TypeKro guide, release notes, and troubleshooting describe the same streamlined supported path.
- Done: produce the initial TypeKro guide as the proof that operators install and compose like resources.
- Done: add API reference docs for `crd()`, `operator()`, proxy handlers, context handlers, status helpers, capabilities, testing harness, compiler CLI, generated artifacts, and runtime diagnostics.
- Done: add troubleshooting docs for build failures, schema failures, live deploy failures, RBAC failures, SSA conflicts, status conflicts, handler timeouts, capability denial, and replay debugging.
- Done: add comparison/positioning docs against Kubebuilder, Operator SDK, Kopf, Metacontroller, Pulumi/cdk8s, Dapr/Knative, and TypeKro.
- Done: add contribution docs, test taxonomy, release gates, coding standards, and character-test guidance.
- Done: add security disclosure and vulnerability reporting docs before public release.
- Deferred: additional serious examples beyond ImageJob are post-v0.1 so the first release stays narrow and excellent.
- `[post-v0.1]` Build a larger example catalog only after the first three public stories are excellent.

## 20. Capability Roadmap Sequencing

Status: ready for v0.1.0
Difficulty: 8/10
Impact: 8/10

Purpose: make external effects powerful without compromising the operation-plan safety model.

Work:
- Done: document the v0.1 capability boundary: supported HTTP JSON host protocol, `auth:none`, SecretRef bearer auth, idempotency requirements, timeout/retry bounds, redaction, and unsupported capability kinds.
- Deferred: richer executable redaction fixtures for logs, status, replay metadata, and full-payload replay posture are post-v0.1 hardening.
- Done: missing, malformed, or unauthorized SecretRefs fail closed with actionable diagnostics in local/host/live tests.
- Deferred: safe HTTP capability examples are post-v0.1 unless they can avoid distracting from the Kubernetes operation-plan story.
- `[post-v0.1]` Define custom HTTP auth headers and schemes.
- `[post-v0.1]` Define cloud API capability descriptors and host protocols.
- `[post-v0.1]` Define database, queue, object store, and identity capability descriptors and host protocols.
- `[post-v0.1]` Define per-capability cancellation, audit event schemas, status conventions, and generated policy/RBAC implications before enabling live effects.

## 21. Future Surface Decisions

Status: ready for v0.1.0
Difficulty: 6/10
Impact: 6/10

Purpose: make explicit what v0.1 does not include so users do not infer accidental promises.

Work:
- Done: document that v0.1 does not support generated typed Kubernetes clients beyond CRD factories and TypeKro CRD factories.
- Done: document that validating/mutating webhooks are out of v0.1 scope.
- Done: document that `applik8s dev` remains post-v0.1.
- Done: document that `applik8s package` remains post-v0.1 behind OCI/Helm/Kustomize design.
- `[post-v0.1]` Design generated clients, admission webhooks, dev-loop hot reload, package distribution, and extension/plugin APIs only after the core v0.1 path is excellent.

## 22. Governance And Community

Status: ready for v0.1.0
Difficulty: 5/10
Impact: 7/10

Purpose: make the project safe and welcoming to adopt or contribute to after v0.1 goes live.

Work:
- Done: add license, code of conduct, contributing guide, security policy, and issue templates.
- Done: add design decision records for major product boundaries: WASM runtime, operation-plan-only effects, fail-closed capabilities, TypeKro extension seam, runtime image posture, and packaging posture.
- Done: define maintainer policy for accepting new public APIs: every new promise needs docs, tests, compatibility notes, and release-note coverage.
- `[post-v0.1]` Add extension authoring guidance once extension seams are stable enough for external contributors.

## Execution Rule

Do not add broad new surface area until the current reconciliation contract is executable through focused unit, vertical, and e2e tests.
