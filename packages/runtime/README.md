# @applik8s/runtime

This package is the TypeScript contract surface for the runtime: controller lifecycle interfaces,
handler invocation contracts, operation application contracts, replay contracts, and health/metrics
types.

The deployable Kubernetes runtime host is implemented in Rust under `crates/`:

- `crates/applik8s-operator-host`: operator process entrypoint and host composition
- `crates/applik8s-runtime-bridge`: kube-rs, Wasmtime, and operation-plan bridge boundary
- `crates/applik8s-runtime-contract`: generated ABI/payload schema contract consumed by Rust

The structural rule is: TypeScript packages define authoring and artifact contracts; Rust crates own
Kubernetes watches, handler invocation, validation, operation application, retries, and observability.
