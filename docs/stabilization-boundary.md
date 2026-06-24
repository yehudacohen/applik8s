# Stabilization Boundary

This document defines what v0.1 treats as public, experimental, or internal.

## Public v0.1 Surfaces

- `crd()` resource definitions.
- `operator()` definitions.
- Proxy handlers such as `Resource.on.reconcile`, `created`, `updated`, `deleted`, `finalize`, and `statusChanged`.
- Context handlers under `Resource.on.context`.
- Normalized operation-plan concepts: `apply`, `patch`, `delete`, `status`, `event`, `finalizer`, and `requeue`.
- Local testing harness expectations for manifest, RBAC, schema, apply, patch, delete, status, events, finalizers, requeue, and external-effect records.
- Compiler pipeline entrypoint through `createCompilerPipeline().run()` and the thin `applik8s build` CLI.
- Generated `operator-manifest.json` version `applik8s.operator/v1alpha1`.
- Handler ABI version `applik8s.handler/v1alpha1`.
- Runtime contract artifacts emitted by the compiler.
- TypeKro `asComposition()` integration over a compiled manifest.

## Experimental v0.1 Surfaces

- HTTP JSON host capabilities.
- SecretRef bearer auth for HTTP capabilities.
- Replay artifact schema.
- Source-map diagnostics and generated debug artifacts.
- Experimental examples that are explicitly documented as part of the public v0.1 release.
- Runtime image layout and generated Dockerfile.

Experimental surfaces are documented and tested, but may change before v1.0 if required for correctness or security.

## Internal Surfaces

- Generated dispatcher implementation details.
- Compiler stage internals.
- TypeKro install resource synthesis internals.
- Rust host internal structs that are not part of the manifest, ABI, or runtime contract.
- Internal research packages and demos that are not part of the public v0.1 release.

## Explicitly Not Public In v0.1

- `operatorBundle()` packaging API.
- Compiler facade emitters and lifecycle planners that do not have implemented semantics.
- Arbitrary Kubernetes client access from handlers.
- Arbitrary filesystem, environment, network, or dynamic import access from handlers.
- Multi-version CRD conversion and storage migration APIs.
- Helm, Kustomize, OLM, and OCI package emitters.
- Generated typed Kubernetes clients beyond CRD factories and TypeKro resource factories.
- Validating or mutating webhook generation.

## Compatibility Rules

- Unsupported manifest versions fail closed.
- Unsupported handler ABI versions fail closed.
- Missing or incompatible runtime requirements fail closed.
- Undeclared WASM host imports fail closed.
- Unsupported capabilities fail closed.
- Unsupported schema forms fail before generated CRDs are emitted.

The project should prefer removing unimplemented public promises over retaining throwing placeholders.
