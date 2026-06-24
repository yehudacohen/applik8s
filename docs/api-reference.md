# API Reference

This is the supported public surface for `applik8s` v0.1.

## Packages

- `@applik8s/applik8s`: umbrella package for normal users. Re-exports SDK, TypeKro adapter, and typed container helpers.
- `@applik8s/sdk`: CRD authoring, operator definitions, handler dispatch, runtime schema helpers, and status helpers.
- `@applik8s/compiler`: build pipeline, manifest generation, Kubernetes YAML generation, diagnostics, runtime contract helpers, and WASM component generation.
- `@applik8s/testing`: local operator test harness and proxy recorder utilities.
- `@applik8s/typekro-adapter`: TypeKro install composition and operation-target adapters.
- `@applik8s/core`: shared types and contracts.
- `@applik8s/runtime-contract`: generated runtime/handler ABI schema constants.
- `@applik8s/runtime`: runtime package placeholder for TypeScript-facing runtime exports.
- `@applik8s/typetainer`: typed container image reference utilities.

## SDK Authoring

Use `sdk.crd()` to define a Kubernetes custom resource shape from a supported schema source.

Supported v0.1 schema sources:

- JSON Schema in the supported Kubernetes structural subset
- ArkType schemas that normalize into that structural subset
- custom schema sources only when downstream compiler support can validate them safely

Use `sdk.operator()` to define:

- operator name
- deployment namespace and replica policy
- owned CRDs
- declared Kubernetes permissions
- optional runtime settings
- reconcile/finalize/event handlers
- declared external capabilities

Handlers may use proxy-first mutation syntax. The SDK records mutations as operation plans; handlers do not receive an ambient Kubernetes client.

Proxy handlers include small Kubernetes object factories for common built-ins used in examples. For example, `job.k8s.ConfigMap({ name, namespace, data })` returns a real ConfigMap object with top-level `data`, `job.apply(object)` records a server-side apply operation for it, and `job.delete(object)` records a delete by object reference. The older `job.batch.*` alias remains available for existing examples, but `job.k8s.*` is the v0.1 golden-path spelling.

## Operation Plans

v0.1 operation kinds are:

- `apply`
- `patch`
- `delete`
- `status`
- `event`
- `finalizer`
- `requeue`

The Rust host validates the normalized plan before effects. Invalid operation order, invalid refs, undeclared RBAC, undeclared finalizer ownership, malformed patches, invalid namespace/scope, and unsupported status writes fail closed.

## Status Helpers

`@applik8s/sdk` exports helpers for common condition and status patterns. v0.1 generated CRDs can admit runtime-authored `Ready` conditions, `observedGeneration`, phase/reason/message fields, and durable external-effect records.

## Testing Harness

`testing.testOperator(operator)` supports local assertions for:

- operator manifest metadata
- RBAC
- structural schema expectations
- apply/patch/delete/status/event/requeue/finalizer operations
- external-effect records

Local tests do not prove Kubernetes API acceptance; use E2E suites for that.

## Compiler

`createCompilerPipeline().run()` compiles an entrypoint into `dist/applik8s` by default.

The compiler emits:

- `operator-manifest.json`
- `contract/runtime-contract.json`
- `contract/applik8s-handler.wit`
- `wasm/handler.wasm`
- `bundle/handler.js`
- `bundle/handler.js.map`
- `kubernetes/*.yaml`
- `Dockerfile.applik8s-runtime`
- `apply.sh`

Unsupported compiler options fail closed or are documented as unsupported. v0.1 does not silently ignore unsupported runtime, ABI, schema, host-import, or packaging semantics.

## CLI

The `applik8s` CLI is intentionally thin:

- `applik8s build <entrypoint>` compiles generated artifacts.
- `applik8s explain <reason>` explains known diagnostics.
- `applik8s replay inspect <artifact>` inspects or executes replay artifacts.
- `applik8s test [...args]` forwards to Vitest.

No v0.1 `dev` or `package` command is promised.

## TypeKro Adapter

`typeKro.composition(operator, manifest, options)` adapts a compiled operator shape into a TypeKro install composition. `asComposition()` remains the precise lower-level alias.

The adapter provides:

- generated install resources
- direct and kro factory access
- CRD instance factories for owned CRDs
- `typeKro.operationTarget(graph, spec, options)` for values that can be passed directly to `ctx.apply()`, `ctx.delete()`, proxy `resource.apply()`, and proxy `resource.delete()`
- `typeKro.targetFactory(graph, options)` for reusable graph factories such as `const stack = tenantStack(tenant.spec)`
- operation-target apply/delete rendering with reverse dependency ordering where TypeKro graph dependencies are available

The precise aliases `toOperationTarget()`, `asOperationTargetFactory()`, and `createGraphAdapter()` remain available for integration authors that need the lower-level adapter vocabulary.

Handler bundles should import operation-target helpers from `@applik8s/typekro-adapter/targets`. That subpath is intentionally lightweight and does not pull TypeKro install/deployment tooling into WASM handler bundles.

TypeKro integration is an optional package. Core SDK, compiler, manifest, and runtime contracts remain TypeKro-neutral.

## Capabilities

v0.1 supports a narrow HTTP JSON capability protocol with explicit idempotency requirements and SecretRef bearer auth. Other capability kinds, protocols, and auth descriptors fail closed.

## Stability

Before `v1.0`, TypeScript APIs and generated manifests may change. Runtime/handler compatibility is guarded by explicit manifest, handler ABI, runtime requirement, and host-import declarations.
