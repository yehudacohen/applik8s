# Reconciliation Correctness Contract

Last updated: 2026-06-22

This document defines the target correctness contract for an `applik8s` handler invocation and the runtime application of its operation plan.

It is an implementation target, not a complete description of current behavior. Where current behavior is known to differ, this document calls that out explicitly.

## Scope

This contract covers:
- handler invocation semantics.
- operation ordering.
- validation and failure behavior.
- Kubernetes API application behavior.
- retry and requeue behavior.
- status, finalizer, event, and delete semantics.
- ownership and field-manager rules.

It does not cover:
- TypeKro graph status semantics, except where TypeKro installs an `applik8s` operator.
- external capability protocols beyond the retry-safety requirements that affect handler idempotency.
- product-specific orchestration behavior outside the generated operator runtime contract.

## Core Principles

1. Kubernetes objects are durable application state.
2. Watches are reconciliation triggers, not reliable event delivery.
3. Handlers must be idempotent.
4. Runtime effects must come only from validated operation plans.
5. The runtime must fail closed on malformed plans and unsupported semantics.
6. Status is durable progress reporting, not an in-memory return value.
7. Finalizers must be explicit and observable.
8. Requeue is a scheduling hint, not a guarantee of exact timing.

## Handler Invocation

For every reconcile invocation, the Rust host must provide:
- `abiVersion`.
- `handlerId`.
- `event`.
- the current Kubernetes object.
- runtime metadata including operator name, reconcile ID, bundle digest, runtime version, and start timestamp.

The current Kubernetes object may include server-populated metadata such as `managedFields`. The runtime contract must preserve unknown metadata and object fields rather than rejecting normal Kubernetes API responses.

Handlers may be invoked more than once for the same object state. Handlers may observe stale cache state. Handlers must not rely on exactly-once execution.

## Operation Plan Validation

Before applying any effect, the runtime must validate the full normalized operation plan.

Validation must reject:
- unknown operation kinds.
- empty `apiVersion`, `kind`, or `metadata.name` on resource operations.
- empty object refs.
- non-object status payloads.
- empty JSON patches.
- invalid finalizer names.
- empty event reasons or messages.
- invalid delete propagation policies.
- invalid delete grace periods.
- event operations without a namespaced regarding object, whether explicit or defaulted from the owner.
- unsupported ABI versions.

Validation should eventually reject or warn on:
- child resources with missing ownership when ownership is required by policy.

Current status:
- Most structural validation exists in the Rust bridge.
- Runtime bridge tests decode and validate plans containing every operation kind.
- Live OrbStack e2e proves malformed handler output is rejected before any Kubernetes effects when full-plan validation fails.
- Local harness tests prove malformed explicit status output is preserved in the normalized operation plan so runtime validation can fail closed instead of silently coercing it.
- Rust host validates bundle `spec.requiresRuntime` against its host runtime semver before startup/reconcile and fails closed on missing, invalid, or incompatible declarations.
- Rust host validates bundle `spec.handlerAbi` against supported handler ABI `applik8s.handler/v1alpha1` before startup/reconcile and fails closed on missing or unsupported declarations.
- Rust host validates the operator manifest `apiVersion` against supported manifest version `applik8s.operator/v1alpha1` before startup/reconcile and fails closed on missing, invalid, or unsupported declarations.
- Generated manifests declare canonical WASM host imports in `spec.adapterRequirements.hostImports`, and the Rust host validates actual component imports against that allowlist before controller startup and before handler invocation.
- ABI compatibility is not yet mature beyond runtime semver and handler ABI declaration enforcement.
- RBAC preflight validates declared operation-plan write permissions before Kubernetes effects. Ownership policy validation is implemented for apply operations. Apply resources that try to set server-populated metadata such as `uid`, `resourceVersion`, `generation`, timestamps, or `managedFields` fail validation before Kubernetes effects. Opt-in HTTP capability execution is constrained by a typed host protocol; mutating capability requests require idempotency metadata and carry the reconcile ID for correlation.
- When handler metadata declares owned finalizer names, host preflight rejects handler-authored finalizer mutations for any undeclared finalizer before Kubernetes effects. Handlers without `handlerExports[].finalizers` keep legacy finalizer mutation behavior for persisted bundle compatibility.

## Runtime Compatibility

Contract evolution policy is documented in `docs/contract-evolution.md`.

Target behavior:
- Every generated bundle must declare `spec.requiresRuntime`.
- The operator host must reject unsupported runtime requirements before invoking WASM or applying Kubernetes effects.
- Unsupported handler ABI versions must fail closed with actionable diagnostics.
- Compatibility fixtures should prove older persisted bundles against newer runtime hosts.

Current status:
- The Rust host parses `spec.requiresRuntime` as a semver requirement and compares it to the host runtime version.
- Missing, invalid, or incompatible runtime requirements fail closed before startup/reconcile proceeds.
- The Rust host checks `spec.handlerAbi` against supported ABI `applik8s.handler/v1alpha1`.
- Missing or unsupported handler ABI declarations fail closed before startup/reconcile proceeds.
- The Rust host checks manifest `apiVersion` against supported operator manifest version `applik8s.operator/v1alpha1`.
- Missing, non-string, or unsupported manifest apiVersions fail closed before startup/reconcile proceeds.
- Missing or invalid host import declarations fail closed; undeclared component imports fail before handler instantiation.
- Host contract tests cover compatible ranges, incompatible ranges, missing runtime declarations, invalid runtime declarations, missing handler ABI declarations, unsupported handler ABI declarations, and missing/invalid/unsupported manifest apiVersions.
- Host contract tests include a checked-in persisted generated bundle fixture and validate current host compatibility, owned watches, and reconcile routing.
- Host contract tests include explicit handler ABI evolution fixtures for a v1alpha1 bundle with omitted optional runtime fields, a v1alpha1 bundle with timeout/cancel host-import declarations, and an incompatible v2alpha1 handler ABI rejection case.
- A persisted compatibility matrix now covers current compatible bundles, legacy status-convention behavior, future manifest rejection, future handler ABI rejection, incompatible runtime requirements, host import declaration failures, and undeclared future host imports. Full cross-version migration fixtures for future supported ABI/manifest/CRD evolution are still pending.

## Operation Ordering

The canonical normalized operation order is:
1. `finalizer` add
2. `apply`
3. explicit `patch`
4. `delete`
5. `status`
6. `event`
7. `finalizer` remove
8. `requeue`

Within each group, operations preserve author order.

Rationale:
- Finalizer add must happen before child side effects so delete/finalize workflows cannot race past cleanup setup.
- Resource and patch mutations should happen before status reports success.
- Events should describe the effects that were attempted.
- Finalizer remove must happen after cleanup/effects so it does not release deletion before teardown work is attempted.
- Requeue is evaluated after effect application.

Current status:
- SDK/proxy and local harness tests assert canonical ordering across finalizer add, `apply`, `patch`, `delete`, `status`, `event`, finalizer remove, and `requeue`.
- Dispatcher, local harness, and proxy normalization split valid finalizer operations into pre-effect add and post-effect remove phases.
- Rust runtime bridge rejects non-canonical operation ordering during full-plan validation before applying Kubernetes effects.

## Partial Failure Semantics

The runtime validates the full normalized operation plan before applying any operation. A validation failure is a no-effect failure for that invocation.

After validation succeeds, operations are applied in canonical order. If operation `N` fails, operations before `N` may already be durable in Kubernetes, and operations after `N` must not be attempted. The next retry must reconcile from observed Kubernetes state rather than assuming an in-memory transaction rollback.

Target behavior:
- Operation failures include the failed operation index, kind, target ref, effective field manager when relevant, and root Kubernetes API cause.
- Operation failures distinguish validation-time no-effect failures from apply-time failures with prior completed effects.
- Structured logs, runtime-authored status, and replay artifacts carry enough progress metadata to see which operation categories completed before the failure without embedding object payloads by default.

Current status:
- Full-plan structural validation fails closed before Kubernetes effects.
- Rust applier operation failures include `progress.completedOperations` plus per-kind counters for completed `apply`, `patch`, `delete`, `status`, `event`, `finalizer`, and `requeue` operations.
- Rust host exposes partial-effect state in structured `errorDetails.partialEffects` and `errorDetails.progress`.
- Runtime-authored `Ready=False` messages explicitly mention visible partial effects when prior operations completed before the failure.
- Replay artifacts include the same operation progress metadata in `failure.details`; metadata-only artifacts redact raw causes and payloads while preserving progress counters.
- Live OrbStack e2e proves apply/status/RBAC failures stop later effects and leave prior successful effects visible. A dedicated partial-operation-failure e2e now proves failed-operation diagnostics, visible prior finalizer/apply effects, skipped later status/event effects, and a post-preflight Kubernetes RBAC denial.
- Live OrbStack e2e also proves manifest undeclared-permission preflight is a no-effect failure even when supplemental live Kubernetes RBAC would allow the operation.

## Apply Semantics

`apply` means server-side apply of a full Kubernetes object.

Target behavior:
- Use Kubernetes server-side apply.
- Default field manager: `applik8s`.
- Allow explicit `fieldManager` per operation.
- Explicit field managers must be non-empty, at most 128 characters, and free of control characters.
- `force` defaults to `false`.
- The runtime must not shell out.
- Namespaced objects must include a namespace unless a future manifest-aware defaulting policy explicitly says otherwise.
- Cluster-scoped objects must not include a namespace.

Current status:
- Server-side apply is used.
- Field manager and force are supported in the Rust applier. Invalid explicit field managers are rejected during full-plan validation before Kubernetes effects.
- Handler-authored apply operations use the operation `fieldManager` when present, otherwise the handler applier default. Handler-authored status uses the handler status applier field manager. Runtime-authored lifecycle status uses a separate `applik8s-status-lifecycle` manager.
- Canonical dispatcher `applyGraph()` renders graph adapter operation plans for proxy and context handlers instead of exposing an unsupported placeholder.
- The Rust bridge rejects known built-in namespaced resources without a namespace and known built-in cluster-scoped resources with a namespace during full-plan validation before Kubernetes effects. Unknown CRD scope remains host/manifest-aware rather than guessed in the bridge.
- The Rust bridge rejects handler-authored apply resources that include server-populated metadata fields such as `uid`, `resourceVersion`, `generation`, `creationTimestamp`, `deletionTimestamp`, `managedFields`, or `selfLink` during full-plan validation before Kubernetes effects.

## Status Semantics

`status` means patching the target resource status through the status subresource.

Target behavior:
- Patch status through `patch_status` where the resource supports it.
- Default target is the reconciled owner object.
- Explicit status target is allowed for known resource refs.
- Status payload must be an object.
- Status patches should use server-side apply unless conflict behavior forces a more precise patch strategy.
- Status should eventually support standard conditions and `observedGeneration` helpers.

Current status:
- Status is patched through the status subresource.
- Generated operator manifests declare whether each owned CRD has a status subresource.
- The Rust host rejects handler-authored status operations targeting owned CRDs that do not declare a status subresource during plan validation, before any Kubernetes effects.
- Non-object status payloads are rejected.
- Live OrbStack e2e proves server-side apply status field ownership conflicts fail the reconcile after prior apply effects and before later event/finalizer/requeue effects.
- Core exposes standard `Condition`/`ConditionedStatus` types, and the SDK provides helpers for standard condition creation/upsert while preserving `lastTransitionTime` until condition status changes.
- Generated manifests carry `statusConvention` metadata on owned CRDs that opt into runtime-authored condition fields.
- Rust host patches runtime-authored status conditions only for owned resources whose manifest metadata declares a `statusConvention`.
- Rust host best-effort patches a runtime-authored `Ready=Unknown` condition with reason `Reconciling` when `status.observedGeneration` is absent or behind `metadata.generation`.
- Rust host best-effort patches a runtime-authored `Ready=True` condition with reason `ReconcileSucceeded` only after handler invocation and operation plan application succeed.
- Rust host best-effort patches a runtime-authored `Ready=False` condition on handler invocation failures and plan-application failures, including `reason`, truncated `message`, `lastTransitionTime`, and `observedGeneration` when the owner object has `metadata.generation`.
- Runtime-authored lifecycle conditions use a separate server-side apply field manager from handler-authored status so `Ready` condition patches do not prune domain status fields written by the handler plan.
- Runtime-authored lifecycle condition patches force ownership of the framework-owned `Ready`/`observedGeneration` fields so stale handler drafts cannot permanently retain those fields and block later success/stale updates.
- Runtime-authored conditions preserve `lastTransitionTime` when the existing `Ready` condition already has the same condition `status`; they change it when condition `status` changes.
- Runtime-authored failure status never masks the original reconcile error; failure to write the failure condition is logged as a warning and the original error is returned to kube-runtime.
- Runtime-authored stale/success status failures are logged as warnings and do not mask reconcile progress or success.
- Generated CRDs for resources with `statusConvention` include structural schema fields for `observedGeneration` and Kubernetes map-list `conditions`, so runtime-authored failure conditions are admitted even when the user status schema is otherwise closed.
- Live OrbStack e2e proves runtime-authored `Ready=False` conditions for server-side apply conflicts, status conflicts, RBAC denial, and malformed handler output.
- Live OrbStack e2e proves runtime-authored `Ready=True` conditions for successful created and updated reconciliations.
- Resources without `statusConvention` do not receive injected condition schema or runtime-authored Ready conditions yet.
- Conflict remediation is not yet explicit; current behavior surfaces the error and relies on kube-runtime retry policy.

## Patch Semantics

`patch` means applying an explicit JSON Patch to a target object.

Target behavior:
- JSON Patch entries must be non-empty and structurally valid.
- Patch target must be an explicit object ref.
- Runtime should not infer status patches from generic patches.
- Status mutations should use `status`, not `patch`.

Current status:
- Runtime applies JSON Patch through the Kubernetes API.
- Structural validation rejects empty patch arrays and invalid JSON Patch entries before Kubernetes effects.
- JSON Patch validation requires pointer-shaped `path`, requires `value` for `add`/`replace`/`test`, requires pointer-shaped `from` for `move`/`copy`, and rejects invalid `value`/`from` fields for operations that do not use them.

## Delete Semantics

`delete` means deleting the target Kubernetes object.

Target behavior:
- Delete target must be an explicit object ref.
- Delete options must preserve propagation policy and grace period.
- Missing target should be treated as success for idempotency unless strict mode is requested.
- Delete should be safe to retry.

Current status:
- Runtime supports delete options.
- Runtime rejects negative or fractional `delete.options.gracePeriodSeconds` during full-plan validation before Kubernetes effects.
- Proxy and local testing normalization preserve `delete(ref, options)` as a normalized delete operation.
- TypeKro operation-target deletes use reverse topological order when graph dependency metadata is available, and handler/proxy plus generated-dispatcher normalization preserve delete options for `delete(typeKroTarget, options)`.
- Rust applier treats Kubernetes `404 NotFound` from delete as success so delete operations are retry-safe and idempotent.

## Event Semantics

`event` means recording a Kubernetes Event related to the owner or explicit regarding object.

Target behavior:
- Events require a namespaced regarding object.
- Event reason and message must be non-empty.
- Event regarding must be namespaced. If `regarding` is omitted, the reconciled owner is the regarding object and must itself be namespaced.
- Event creation should be idempotent enough for retry loops.
- Event failures should not mask prior successful mutations unless policy says events are required.

Current status:
- Live runtime routes non-deleting objects with `metadata.generation <= 1` to a registered `created` handler when one exists, otherwise it falls back to `reconcile`.
- Live runtime routes non-deleting objects with `metadata.generation > 1` to a registered `updated` handler when one exists, otherwise it falls back to `reconcile`.
- Live runtime routes non-deleting objects with non-empty status to a registered `statusChanged` handler when the current status appears to have observed the current generation. This is a best-effort predicate over current object state, not a durable status event log.
- Stale status, where `status.observedGeneration` is behind `metadata.generation`, routes to generation-based `created`/`updated` handlers before `statusChanged` so spec reconciliation is not skipped.
- Deletion-timestamp objects do not route to generation-based `created` or `updated`; they route through `finalize`, then best-effort `deleted`, then reconcile fallback.
- Host routing selects `finalize` first for deletion-timestamp objects with non-empty finalizers and a registered finalize handler. When generated handler metadata declares owned finalizer names, routing requires one of those finalizers to be present on the object.
- Host preflight enforces declared finalizer ownership for finalizer mutations before effects, so a declared finalize handler cannot remove or add unrelated finalizers even if the operator has RBAC to patch the `/finalizers` subresource.
- Host routing selects a registered `deleted` handler for other deletion-timestamp objects, including objects without finalizers.
- Host contract tests prove `created`, `updated`, `statusChanged`, stale-status precedence, and reconcile fallback routing.
- Live OrbStack e2e proves a generated `created` handler receives `event: "created"` for generation-1 objects.
- Live OrbStack e2e proves a spec patch increments generation and dispatches to a generated `updated` handler receiving `event: "updated"`.
- Runtime records core/v1 Event objects.
- Runtime bridge validation rejects event operations whose explicit regarding ref is not namespaced, and rejects omitted regarding refs when the reconciled owner is cluster-scoped, before applying any effects.
- Duplicate event names are treated as success on conflict.
- Event failure policy is not configurable.

## Finalizer Semantics

`finalizer` means adding or removing a finalizer on the reconciled owner object.

Target behavior:
- Finalizer names must be qualified.
- Add is idempotent.
- Remove is idempotent.
- Finalize handlers must run when deletion timestamp is present and matching finalizer exists.
- Finalizer add happens before child side effects.
- Finalizer remove happens after cleanup/effects.

Current status:
- Runtime add/remove is idempotent at the list level.
- Live OrbStack e2e proves finalizer add, deletion timestamp reconciliation, child cleanup delete, finalizer removal, and owner CR deletion.
- Live runtime routes deletion-timestamp objects with non-empty finalizers to a registered `finalize` handler when one exists and, for handlers with declared finalizer ownership metadata, when one declared finalizer is present on the object. Otherwise it tries registered `deleted` routing before reconcile fallback.
- Host contract tests prove deletion-timestamp objects without finalizers use registered `deleted` routing and that deleting objects without a matching event handler still use reconcile fallback.
- Live OrbStack e2e proves a separate generated `finalize` handler receives `event: "finalize"` and performs child cleanup, finalization event recording, finalizer removal, and owner CR deletion.
- Generated manifests can declare `handlerExports[].finalizers` for finalize handlers. Host contract tests prove matching finalizers select the declared finalize handler and foreign-only finalizers skip declared finalize handlers.
- TypeKro/graph-backed deletes remain responsible for reverse-topological resource teardown; finalizer ordering only controls object lifecycle safety around those effects.

## Requeue Semantics

`requeue` means requesting another reconcile after a delay.

Target behavior:
- `afterSeconds` maps to `kube_runtime::controller::Action::requeue`.
- Missing `afterSeconds` should use the runtime default requeue policy.
- Requeue must not imply prior effects succeeded unless the plan application succeeded.
- Handler failures should use controller error policy, not handler requeue policy.

Current status:
- Rust host maps requeue to kube-runtime action.
- Handler-returned `requeue` remains separate from failure retry policy.
- Handler failures use the kube-runtime controller error policy with manifest-driven bounded exponential backoff.

## Handler Timeout Semantics

Target behavior:
- Handler invocations must have a bounded runtime so stuck user code cannot block reconcile workers indefinitely.
- Timeout must fail the reconcile before operation-plan application and before Kubernetes side effects from that invocation.
- Timeout diagnostics should be visible in structured logs and runtime-authored status conditions.
- Timeout configuration should be explicit in generated artifacts and overridable by platform operators.
- Host calls and external capabilities must be implemented through async/cancellable host imports; blocking host imports that can park runtime worker threads are prohibited.

Current status:
- Rust runtime bridge enables Wasmtime epoch interruption and sets a per-invocation epoch deadline.
- Rust host resolves handler timeout from `APPLIK8S_HANDLER_TIMEOUT_SECONDS`, then `spec.runtime.handlerTimeoutSeconds`, then a default of 30 seconds.
- Invalid timeout configuration fails closed with `InvalidRuntimeConfig`.
- Generated Deployments set `APPLIK8S_HANDLER_TIMEOUT_SECONDS` from manifest runtime config or the default `30`.
- Non-terminating handler WASM traps as `HandlerTimedOut` and returns a failed reconcile before operation-plan application.
- Runtime-authored failure status maps timeout failures to `Ready=False` with reason `HandlerTimedOut` for convention-enabled CRDs.
- Structured failure details include `type: "handlerTimedOut"` and `timeoutMs`.
- Rust runtime bridge invokes handlers through Wasmtime async `instantiate_async`/`call_async` and wraps the full invocation in a Tokio wall-clock timeout.
- Canonical host imports are registered with Wasmtime async host functions, so external capability implementations inherit the invocation cancellation boundary when implemented without blocking the runtime thread.
- Blocking host imports remain prohibited; external integrations that need blocking clients must wrap them in cancellable async work with their own timeout policy before being exposed to handlers.

## Runtime Concurrency Semantics

Leader-election implementation notes are documented in `docs/leader-election.md`.

Target behavior:
- Operator concurrency must be explicit and tested before generated operators run with multiple workers or multiple in-flight reconciles for the same resource.
- Without leader election, the runtime contract is single-replica and single-worker.
- Unsupported concurrency declarations must fail closed rather than being silently ignored.

Current status:
- Generated manifests, generated YAML, TypeKro install synthesis, and the Rust host accept only `runtime.concurrency.workerCount: 1` and `runtime.concurrency.maxInFlightPerResource: 1`.
- `runtime.concurrency.maxQueueDepth` is rejected until the runtime exposes trustworthy kube-runtime queue-depth controls.
- Multi-replica Deployments are accepted only when `runtime.leaderElection.enabled` is true. Kubernetes Lease-based leader election is implemented with active-leader readiness and non-leader `/readyz` false.
- Generated Lease RBAC splits unrestricted `leases/create` from resource-name-scoped `leases/get/update/patch`, because Kubernetes cannot authorize create through a pre-existing `resourceNames` constraint.
- Live OrbStack e2e proves deleting the current Lease holder causes another replica to acquire leadership and reconcile a later generation change.

## Operator Health Semantics

Target behavior:
- Generated operators should expose Kubernetes-native liveness and readiness probes.
- Liveness should report that the Rust host process can serve probe traffic.
- Readiness should not become true until runtime compatibility, handler ABI compatibility, host import policy, and controller construction have succeeded.
- Readiness should become false during shutdown before controller streams are dropped.
- Probe configuration should be generated by default and remain inspectable in the Deployment manifest.

Current status:
- Rust host serves `/healthz` and `/readyz` on `APPLIK8S_HEALTH_ADDR`, defaulting to `0.0.0.0:8080`.
- Rust host serves probes through `axum` rather than custom HTTP parsing.
- `/healthz` returns healthy while the probe server is running.
- `/readyz` returns `503 notReady` until startup validation and controller construction complete, then returns ready.
- `run_from_env()` listens for a Tokio shutdown signal, marks readiness false, signals the probe server to drain, and drops kube-runtime controller streams so no new reconciles are driven after shutdown starts.
- Generated Deployments expose a named `health` container port and configure liveness/readiness HTTP probes for `/healthz` and `/readyz`.
- Host contract tests prove the probe response contract and shutdown readiness transition, and compiler tests prove generated Deployment probe shape.

## Operator Metrics Semantics

Target behavior:
- Runtime metrics should use OpenTelemetry-compatible libraries and standard OTEL environment configuration.
- Metrics export must be optional; an operator without OTEL endpoint configuration should still run normally.
- Metrics should identify the operator, handler route, event, and outcome without embedding object payloads or secrets.
- Generated Deployments should include useful OTEL service/resource metadata while leaving exporter endpoints to the platform.

Current status:
- Rust host initializes an OTLP metric exporter only when `OTEL_EXPORTER_OTLP_ENDPOINT` or `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` is configured.
- Missing OTEL endpoint configuration leaves OpenTelemetry in its safe no-op/global behavior.
- Invalid OTEL exporter configuration logs a warning and does not prevent operator startup.
- Rust host records `applik8s_reconcile_total`, `applik8s_reconcile_failures_total`, `applik8s_reconcile_duration_seconds`, `applik8s_operations_total`, and `applik8s_reconcile_retries_total`.
- Reconcile metrics include `operator`, `handler_id`, `event`, `result`, and failure `reason` where relevant.
- Operation-count metrics include operation kind labels for apply, patch, delete, status, event, finalizer, and requeue counts.
- Generated Deployments set `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES`, and `OTEL_METRIC_EXPORT_INTERVAL`, but do not hardcode collector endpoints.
- Retry metrics include operator, attempt, delay, and exhaustion labels.
- Queue-depth metrics are not implemented yet because the runtime does not expose reliable controller signals for them.

## Conflict And Retry Semantics

Target behavior:
- Handler invocation can be retried by kube-runtime.
- Runtime API operations should be safe to retry where possible.
- Status conflicts should retry with fresh object state or fail with actionable diagnostics.
- Server-side apply conflicts should surface field owner information where Kubernetes provides it.
- Reconcile errors should include operation kind, target ref, field manager, and root Kubernetes API error.
- Error retry policy should use bounded exponential backoff configured by `spec.runtime.rateLimit` when present.
- Retry exhaustion should stop scheduled retries and wait for the next Kubernetes object change rather than spinning forever.

Current status:
- Kube-runtime retries failed reconciles through the host error policy.
- Rust host resolves retry policy from `spec.runtime.rateLimit.baseDelayMs`, `maxDelayMs`, and optional `maxRetries`, defaulting to 5 seconds base delay and 300 seconds max delay when absent.
- Invalid retry policy configuration fails closed for manifest parsing in host contract tests; controller error-policy fallback logs the invalid policy and uses the safe default rather than panicking.
- Rust host uses the maintained `backoff` crate to compute deterministic bounded exponential retry delays.
- Retry state is in-memory and used only for scheduling diagnostics/backoff; correctness still relies on idempotent reconciliation and durable Kubernetes state.
- When `maxRetries` is exceeded, the host returns `Action::await_change()` so kube-runtime waits for the next watch/change instead of scheduling another timed retry.
- Structured retry logs include attempt, delay, exhaustion state, object key, operator name, and error text.
- OpenTelemetry retry metrics record scheduled/exhausted retry decisions.
- When `maxRetries` is exceeded for a convention-enabled CRD, the host spawns a best-effort status update that writes `Ready=False` with reason `RetryExhausted`, records the latest `observedGeneration`, and states that the runtime is waiting for a Kubernetes object change before retrying.
- Live OrbStack e2e proves controller startup/resync reconciles existing owner objects and recreates missing child state after an operator scale-down/scale-up.
- Rust applier failures include operation index, operation kind, target ref, field manager for apply/status operations, and root error text.
- Rust host emits structured JSON reconcile logs with handler ID, event, object ref, reconcile ID, bundle digest, runtime version, handler ABI, success operation summary including requeue count, and operation-failure details when plan application fails.
- Rust host emits structured logs through `tracing`/`tracing-subscriber` JSON rather than hand-emitted JSON lines.
- Rust host attempts a best-effort failure status patch before returning handler invocation and plan-application failures to kube-runtime.
- Live OrbStack e2e proves server-side apply field ownership conflicts fail the reconcile before later status/event/finalizer effects and preserve the externally owned field.
- Live OrbStack e2e proves status field ownership conflicts preserve the externally owned status field and stop later event/finalizer/requeue effects.
- Live OrbStack e2e proves Kubernetes RBAC denial surfaces as an operation-level apply failure, preserves prior successful apply effects, and stops later status/event/finalizer effects.
- Host contract tests and live OrbStack e2e prove operation plans requiring undeclared RBAC permissions fail before any Kubernetes effect is attempted, even when live RBAC would otherwise allow the operation.
- Conflict remediation is not mature beyond surfacing actionable diagnostics and applying the configured retry policy.
- Retry/backoff status conventions now expose retry exhaustion durably, but do not persist every transient retry attempt counter.

## Ownership Semantics

Target behavior:
- Child resources created from a namespaced owner should default to ownerReferences when safe.
- Cluster-scoped resources must not receive invalid namespaced ownerReferences.
- Cross-namespace ownerReferences must be rejected or omitted according to Kubernetes rules.
- Ownership policy should be explicit for resources that should not be garbage-collected with the owner.

Current status:
- Runtime apply injects a default controller ownerReference for applied child resources when the owner has a UID and the child is explicitly in the same namespace as the owner.
- Runtime apply preserves explicit `metadata.ownerReferences` supplied by the handler instead of overwriting them.
- Runtime apply omits default ownerReferences when the owner UID is unavailable, when the child is cross-namespace, or when the applied resource is the owner itself.
- Apply operations support explicit `ownership` metadata.
- `ownership: { mode: "auto" }` preserves the default safe ownerReference behavior.
- `ownership: { mode: "none" }` disables runtime ownerReference injection while preserving any handler-provided `metadata.ownerReferences`.
- `ownership: { mode: "reference", ref }` injects a controller ownerReference from the provided ref only when the ref has a UID, does not reference the applied object itself, does not cross namespaces, and does not make a namespaced owner own a cluster-scoped resource.
- `ownership.reference` fails full-plan validation before Kubernetes effects when it is combined with handler-provided `metadata.ownerReferences` or violates Kubernetes ownerReference scope rules.
- Live OrbStack e2e proves a same-namespace ConfigMap child receives a controller ownerReference to the reconciled custom resource.
- Live OrbStack e2e proves cluster-scoped owners and cross-namespace child resources do not receive invalid namespaced ownerReferences.
- Runtime bridge unit tests prove default ownership, explicit opt-out, explicit cluster-scoped owner references for namespaced children, and invalid cross-namespace reference rejection.
- Live e2e coverage for explicit ownerReference opt-out remains pending.

## Field Manager Semantics

Target behavior:
- Default field manager is `applik8s`.
- Compiler or runtime may derive a more specific manager such as `applik8s/<operator>` later.
- User-provided `fieldManager` must be non-empty.
- Runtime should expose field ownership conflicts clearly.

Current status:
- Empty field managers are rejected.
- Default field manager exists.
- Operation-failure diagnostics expose the effective field manager for apply/status failures.

## Namespace And Scope Semantics

Target behavior:
- Namespaced owned resources should be watched in the deployment namespace by default.
- A manifest namespace annotation takes precedence over pod namespace fallback.
- Cluster-scoped owned resources are watched cluster-wide.
- Generated Deployment must inject pod namespace via downward API.

Current status:
- Pod namespace fallback is implemented.
- Owned CRD scope is recorded in the bundle.
- TypeKro direct and kro installs prove live namespaced reconciliation.

## First Implementation Targets

1. Done: add unit and vertical tests for full operation ordering across every operation kind.
2. Done: add e2e coverage for finalizer add/remove and delete/finalize behavior through deletion-timestamp reconciliation.
3. Done: add structured operation failure diagnostics in the Rust applier.
4. Done: decide finalizer ordering before expanding ownership policy beyond conservative same-namespace ownerReference injection.
5. Done: define delete-not-found idempotency behavior and implement it in the Rust applier.

## Acceptance Criteria For Item 1

Item 1 is done when:
- `RECONCILIATION_CONTRACT.md` reflects the implemented semantics.
- Unit and vertical tests assert normalized operation ordering.
- Runtime bridge tests assert validation behavior for every operation kind; application behavior that requires Kubernetes API side effects is proven by e2e.
- At least one OrbStack e2e proves status, apply, event, finalizer, delete, and requeue behavior.
- Known deviations are either fixed or explicitly documented as follow-up backlog items.

Current gap:
- `finalize` routing exists for deletion-timestamp objects with non-empty finalizers, followed by best-effort `deleted` routing and reconcile fallback. Exact matching-finalizer gating is implemented for finalize handlers that declare owned finalizer names.
