# Design Decisions

This file records v0.1 product-boundary decisions. It is intentionally concise; deeper design documents can follow after v0.1.

## WASM Runtime

Decision: compile TypeScript handlers into WASM component artifacts and run them through a Rust host.

Reason: this gives the runtime a narrow invocation boundary, explicit host imports, compatibility checks, timeout/cancellation control, and room for source-mapped diagnostics.

Consequence: handlers may use direct `fetch` through the WASI HTTP runtime, but must not depend on ambient filesystem, environment, Node-native network APIs, or dynamic imports unless the compiler/runtime explicitly support that behavior.

## Operation-Plan Effects

Decision: handlers return operation plans rather than mutating Kubernetes directly.

Reason: the runtime can validate RBAC, finalizer ownership, operation order, namespace/scope, status behavior, and malformed payloads before effects.

Consequence: arbitrary Kubernetes clients inside handlers are out of scope for v0.1.

## Fail-Closed Capabilities

Decision: unsupported capability protocols, auth descriptors, runtime imports, schemas, packaging modes, and concurrency settings fail closed.

Reason: v0.1 should not create accidental contracts from ignored options or placeholder behavior.

Consequence: users may need to simplify inputs or wait for explicit support rather than relying on best-effort behavior.

## TypeKro Extension Seam

Decision: TypeKro support lives in `@applik8s/typekro-adapter` and uses real TypeKro concepts.

Reason: TypeKro is a first-class v0.1 integration target, but core SDK/compiler/runtime contracts should remain TypeKro-neutral.

Consequence: TypeKro-specific helpers should not leak into core packages.

## Packaging Posture

Decision: v0.1 supports generated plain Kubernetes YAML and TypeKro install composition.

Reason: broader packaging formats need their own lifecycle, upgrade, rollback, signing, and compatibility semantics.

Consequence: Helm, Kustomize, OLM, and OCI bundle distribution are post-v0.1.

## Runtime Image Posture

Decision: v0.1 tutorials are supported through generated local image recipes. A published runtime image is only supported if a release explicitly builds, tests, and documents it.

Reason: generated operators must be deployable without implying untested image distribution or provenance guarantees.

Consequence: users should pin local or release-provided image references explicitly.
