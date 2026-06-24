# applik8s Backlog

Last updated: 2026-06-22

This backlog prioritizes correctness, excellence, and the public developer experience over feature completeness.

## Guiding Priorities

`applik8s` should become the easiest serious way to build Kubernetes operators and durable, event-driven applications on the Kubernetes control plane. To get there, the next phase should harden the core programming and runtime semantics before expanding surface area.

The order below is intentional. Later packaging, CLI, and extension work should not outrun reconciliation correctness, observability, and ABI discipline.

## Scoring

Each roadmap item has two scores from 1 to 10:

- Difficulty: implementation and verification complexity, including design ambiguity, cross-package scope, live-cluster behavior, and compatibility risk.
- Impact: expected improvement to correctness, excellence, and the public developer experience, independent of feature-count completeness.

## Milestone Tags

Roadmap work should use these tags so v0.1 scope stays ambitious but honest:

- `[v0.1-required]`: must be true before a public v0.1 announcement.
- `[v0.1-wow]`: not strictly required for safety, but central to making v0.1 feel exceptional.
- `[v0.1-safety]`: release-blocking correctness, security, compatibility, or operational safety work.
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
- `[v0.1-wow]` Enable ordinary async TypeScript handler code to execute in the WASM runtime, including direct `fetch` calls with tree-shaken bundled dependencies, while preserving operation-plan validation and runtime timeout enforcement.
- `[v0.1-safety]` Define the v0.1 security boundary for direct handler `fetch`: no ambient filesystem/environment access, network enabled only through WASI HTTP, and release docs must distinguish direct fetch from audited declared capabilities.

Release decision: v0.1.0 does not need an RC ceremony. Remaining roadmap items improve depth, portability, and polish after launch; they do not block the first pre-1.0 public evaluation release as long as public docs keep the supported path and unsupported boundaries explicit.

v0.1 should not require:

- `[post-v0.1]` Helm, Kustomize, OLM, or OCI bundle distribution.
- `[post-v0.1]` Multi-version CRDs, conversion webhooks, or storage migration.
- `[post-v0.1]` General cloud/database/queue/object-store/identity capabilities.
- `[v0.1-safety]` Any multi-cluster application movement or disaster-recovery work, demos, APIs, docs, package metadata, or roadmap commitments.
- `[post-v0.1]` Formal SLSA-level provenance enforcement, as long as unsigned/no-SBOM/no-provenance posture is explicit.

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
- Done: make the ImageJob tutorial lead with streamlined proxy semantics: status assignment, finalizer add/remove, typed child resource apply/delete through the golden-path `job.k8s.ConfigMap(...)` factory, events, and requeue in one concise handler.
- Done: add an executable product-story assertion that the primary documented handler shape stays aligned with the real `examples/imagejob.ts` API surface.
- Done: ensure the documented one-command build path in the golden path remains covered by CLI regression tests and release gates.
- Done: make the generated-artifact walkthrough connect each tiny TypeScript handler operation to generated YAML, RBAC/runtime validation, status/events/requeue/finalizer behavior, and manifest routing evidence.
- Done: local `testOperator()` supports honest `expectManifest`, `expectRbac`, `expectSchema`, and `expectExternalEffect` assertions for locally knowable metadata/status without pretending to prove live Kubernetes acceptance.
- Done: local `testOperator()` supports `expectPatch`, `expectDelete`, and `expectFinalizer` so golden-path tests can assert every stable operation kind without inspecting raw plans.
- Done: `examples/imagejob.ts` is the canonical golden-path source consumed by the product-story character test, compiler artifact test path, TypeKro adapter test, and docs.
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

## 7. TypeKro Polish

Status: in progress
Difficulty: 8/10
Impact: 8/10

Purpose: make operators feel like first-class TypeKro components.

Work:
- `[v0.1-required]` Hide remaining internal seams in `asComposition()`.
- `[v0.1-required]` Document and stabilize direct/kro readiness behavior.
- `[v0.1-safety]` Preserve TypeKro graph teardown semantics for operation-target deletes, including reverse-topological deletion and resource scopes where applicable.
- Done: add vertical tests proving `ctx.delete(typeKroTarget)` deletes dependents before dependencies and preserves delete options through handler/proxy and generated-dispatcher normalization.
- `[v0.1-safety]` Add TypeKro operation-target delete e2e proving reverse-topological teardown against live Kubernetes resources.
- `[v0.1-required]` Make TypeKro status composition consume runtime `Ready`/`observedGeneration` conventions naturally in live compositions.
- Done: add a TypeKro status-composition contract test proving graph status projections can be mapped into handler status without relying on static fallback readiness.
- `[v0.1-wow]` Add TypeKro-native live status composition proof where operator CR status drives a downstream TypeKro resource without static fallback readiness.
- `[v0.1-required]` Make callable operator install/status ergonomics match the public product phrase: operators install like components, CRDs instantiate like resources, statuses compose like TypeKro resources.
- `[v0.1-wow]` Make the TypeKro-facing golden path match the public product story: install the operator as a callable composition, instantiate the operator CRD through generated resource factories, and consume status through TypeKro expressions without adapter-shaped ceremony.
- Done: make TypeKro operation targets inside applik8s handlers public v0.1 surface through ergonomic aliases: `typeKro.operationTarget()`, `typeKro.targetFactory()`, `typeKro.graphAdapter()`, and `typeKro.composition()`, while preserving precise lower-level aliases for integration authors.
- Done: add API docs, public type inference coverage, character-test language, and adapter vertical tests for the ergonomic TypeKro handler-target surface.
- `[v0.1-safety]` Add live validation for `ctx.apply(typeKroTarget)` and `ctx.delete(typeKroTarget)` semantics before announcing this as a release-highlight path.
- `[v0.1-safety]` Prove RBAC inference, reverse-topological deletion, status mapping, and failure diagnostics through shared compiler/runtime gates rather than adapter-only tests.
- `[v0.1-required]` Reduce noisy static-status fallback warnings where possible and document the remaining cases honestly.
- `[v0.1-wow]` Add examples for operator install, CRD factory usage, and status composition.
- `[v0.1-safety]` Keep TypeKro integration as an extension seam, not a core dependency.

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
- `[v0.1-safety]` Do not publish multi-cluster application movement or disaster-recovery APIs, docs, examples, tests, packages, roadmap sections, or demos.
- `[v0.1-safety]` Do not publish private research packages or product-story tests as part of the v0.1 release surface.
- `[v0.1-safety]` Do not use private product names, domains, package scopes, repository orgs, or CRD API groups in public v0.1 artifacts.
- Done: public examples and tutorials use `media.applik8s.dev` API groups and `@applik8s/*` package imports.
- Done: release readiness checks fail on private branding and workload-mobility terms in public release files.
- Done: move internal-only packages out of the public tree rather than relying only on package-publish exclusions.
- Done: release readiness fails if internal-only package paths reappear in the public v0.1 tree.

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
