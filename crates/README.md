# Rust Runtime Crates

The Rust workspace owns deployable Kubernetes runtime behavior for `applik8s`.

- `applik8s-operator-host` is the operator process entrypoint and host composition layer.
- `applik8s-runtime-bridge` owns the kube-rs/Wasmtime boundary for invoking handler components and applying operation plans.
- `applik8s-runtime-contract` consumes the generated ABI and payload schema contract emitted from TypeScript.

The structural rule is that TypeScript packages define authoring APIs, compiler contracts, and generated
artifacts, while these Rust crates own Kubernetes watches, work queues, runtime validation, status
patching, server-side apply, retries, requeues, finalizers, events, metrics, logs, and handler execution.
