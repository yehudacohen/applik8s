# Release Notes

## v0.5.0 (in development)

v0.5 adds inert typed tasks and workflows, app-bound runtime handles, and a versioned `WorkflowEngine` provider contract. The first implementation pins Hatchet and its chart, runs it in PostgreSQL-only mode on external CNPG, disables RabbitMQ, and generates self-contained Node workers with health, graceful drain, retries, schedules, durable sleeps, child calls, event waits, cancellation, correlation propagation, fixed scaling, and optional KEDA task-stat scaling.

Durable orchestration is deliberately effect-free: external work belongs in retry-safe tasks, and canonical state still commits through v0.4 model transactions. Compiler analysis follows captured module-scope helpers and rejects hidden network, database, Kubernetes, filesystem, wall-clock, randomness, and ambient-timer access from workflows.

The longitudinal Tenant Platform adds onboarding and decommissioning workflows with compensation and explicit intervention. A fresh OrbStack Hatchet/CNPG proof exercises retry, idempotency, worker replacement during a durable wait, signal/resume, metadata propagation, compensation failure, cancellation, and TypeKro-first teardown.

v0.5 also introduces bounded connection-scoped Kubernetes execution for operators that coordinate a separately authorized cluster. Portable bundles declare named permission and endpoint-policy requirements; installation artifacts bind those aliases to namespace-local kubeconfig Secrets without exposing credentials to WASM. Remote reads are typed and paginated, remote mutations require owner-bound managed identity or UID/resourceVersion evidence, and the host pins one credential revision per invocation. Connection permissions never become management-cluster RBAC, remote owner references and cross-cluster atomicity remain unsupported, and a v1 mutation plan may address only one remote connection.

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
- Use the Postgres `ModelStore` slice with CNPG-generated infrastructure, migration Jobs, generated runtime clients, duplicate-key behavior, and migration drift preflight diagnostics.
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
