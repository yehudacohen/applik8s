# Contract Evolution

This document defines how `applik8s` changes generated bundles and runtime hosts without silently running incompatible code.

## Compatibility Gates

Every generated operator bundle must declare three independent compatibility contracts:

- `apiVersion`: the operator manifest schema version.
- `spec.handlerAbi`: the guest handler ABI and payload contract.
- `spec.requiresRuntime`: the host runtime semver range required by the bundle.

The Rust host validates all three before controller startup and before handler invocation paths trust manifest fields. Missing, malformed, or unsupported declarations fail closed.

## Version Meanings

`apiVersion` changes when the operator manifest shape changes in a way that an older host cannot safely interpret. The current supported version is `applik8s.operator/v1alpha1`.

`spec.handlerAbi` changes when the handler input, handler output, WIT world, host imports, guest exports, or canonical payload schemas change in a way that affects generated WASM compatibility. The current supported ABI is `applik8s.handler/v1alpha1`.

`spec.requiresRuntime` changes when a compiler-generated bundle depends on host behavior that is not available in older runtimes, even if the manifest and handler ABI version strings are unchanged.

## Allowed Changes Within V1alpha1

Compatible changes may include:

- adding optional manifest fields that older hosts can ignore safely.
- adding optional runtime configuration fields that default to existing behavior.
- tightening compiler validation for unsafe inputs before bundle generation.
- adding host diagnostics, status details, logs, metrics, or replay metadata that do not change handler ABI payloads.
- accepting additional declared host imports only when the generated component actually imports them and the host implements fail-closed validation.

Incompatible changes include:

- changing required manifest fields or their meaning.
- changing handler input or operation-plan payload semantics.
- changing WIT import/export names or required signatures.
- making an optional runtime behavior required without updating `spec.requiresRuntime`.
- treating undeclared host imports, undeclared RBAC, or unsupported runtime settings as allowed.

## Fixture Policy

Compatibility changes should add or update checked-in fixtures before the behavior is treated as stable.

- Persisted generated bundle fixtures prove old generated artifacts against the current host.
- Handler ABI evolution fixtures prove timeout, cancellation, host-import, and optional-runtime behavior.
- Incompatible fixtures prove future ABI or manifest versions fail closed with specific diagnostics.

Fixtures should be small JSON manifests unless the compatibility behavior depends on actual WASM imports. When WASM imports matter, use minimal component fixtures in host contract tests.

## Runtime Behavior

Startup and reconcile paths must not rely on best-effort compatibility. The host must reject incompatible bundles before applying Kubernetes effects.

Generated bundles should remain explicit about their requirements even when the current default runtime satisfies them. This keeps GitOps, admission policy, and future migration tooling able to reason about bundle safety without running handlers.

## Current Status

Implemented today:

- host validation for `apiVersion`, `spec.handlerAbi`, and `spec.requiresRuntime`.
- compiler validation for canonical manifest `apiVersion` and `kind`.
- runtime contract schema pinning for operator manifest `apiVersion`.
- persisted generated bundle compatibility fixture.
- handler ABI fixtures for omitted optional runtime fields, timeout/cancel host imports, and incompatible future ABI rejection.
- fail-closed manifest generation and validation for CRDs that declare multiple versions or conversion webhooks before conversion/migration compatibility exists.
- CRD storage-version, conversion-strategy, rollback-safety, and uninstall/domain-data posture annotations on generated install resources.

Still pending:

- multi-version migration fixtures across future released compiler/runtime versions.
- executable CRD storage-version and conversion compatibility rules for real multi-version CRDs.
- upgrade and rollback policy for runtime image, handler ABI, and CRD schema changes.
