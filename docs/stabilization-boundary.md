# Stabilization Boundary

This document records the compatibility boundaries for released framework generations. The v0.1 sections remain as historical context; v0.4 is the current release boundary.

## Public v0.4 Surfaces

- Versioned command and event definitions, canonical message envelopes, and app-scoped model command bindings.
- `Model.on.command()` declarations for keying, ordering, idempotency, expected revisions, missing-target policy, transaction participants, history, emitted events, and emitted commands.
- PostgreSQL command inbox, durable result, transition, history, event-outbox, and command-outbox authority semantics.
- NATS JetStream `EventLog` transport with stable IDs, explicit acknowledgement, retry, dead-letter, replay, retention, and lag-observation contracts.
- Generated command processor graph nodes, runtime bundles, Deployments, Stream/Consumer resources, NetworkPolicies, security posture, health checks, and graceful lifecycle.
- Tree-shakeable `@kubernetes/client-node` execution through the credential-safe Kubernetes WASM host boundary.
- Versioned typed provider contracts that permit later `WorkflowEngine` and `ProjectionStore` interfaces without extending a closed built-in union.

## Reserved Or Bounded In v0.4

- PostgreSQL owns canonical application state and command results; JetStream provides at-least-once transport and never becomes the transaction authority.
- General task/workflow orchestration, public streams/subscriptions, analytical projections, browser clients, and reactive UI adapters remain future surfaces.
- Generated processors use fixed bounded concurrency. KEDA, public processor placement/grouping overrides, and broad workload tuning are not v0.4 guarantees.
- Kubernetes SDK compatibility is limited to the tree-shaken, tested fetch/WASI-compatible paths and declared RBAC/origin boundary; unsupported Node transports fail closed.
- Public APIs may evolve before v1.0, but v0.4 authority, idempotency, revision, and failure-honesty semantics may not silently weaken.

## Public v0.3 Surfaces

- The `app(...)` golden path: schema-first resources, Postgres-backed models, HTTP servers, reconciliation, generated jobs/schedules, config, secrets, exposure, and TypeKro composition.
- Provider contracts plus one bounded Kubernetes-native default for every provider family. Additional adapters do not change the default contract.
- The Postgres/CNPG `ModelStore` slice, generated migration jobs, deterministic server/runtime-module bundles, generated-job status lifecycle, operation targets, and bounded watch scopes described in the API reference.
- Application graph schema and validation contracts used by v0.3 generated artifacts and pressure tests.
- Explicit generated/external Secret ownership and runtime-owned Secret data semantics.
- applik8s-owned CRD status schemas and validated Rust-host status operations.

## Reserved Or Bounded In v0.3

- Additional cloud-scale Queue, ObjectStorage, EventSource, IndexStore, CounterStore, secret-manager, and HTTP exposure adapters are incremental. The bounded Kubernetes-native defaults are public v0.3 behavior.
- Generated-job state is durably stored in a runtime-created ConfigMap and authoritatively projected onto the KRO-owned root application status by KRO itself.
- Runtime signing, SBOM, provenance, and admission verification are metadata-only declarations.
- Arbitrary Kubernetes discovery, arbitrary GVK access, owner-graph traversal, cross-cluster access, and general workflow/transformation engines are not applik8s v0.3 surfaces.

## v0.3 Compatibility Rules

- Public contracts may evolve before v1.0, but incompatible manifest, ABI, runtime requirement, provider support, schema, and host-import combinations fail closed.
- Generated artifacts must remain inspectable and deterministic; generated workloads do not install packages at startup.
- applik8s does not create or own an externally named Secret unless `ownership: 'generated'` is explicit.
- A runtime may write only status fields admitted by an applik8s-owned CRD or by an explicit compatible projection contract.

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
- Arbitrary filesystem, environment, Node/raw network, or dynamic import access from handlers. Direct `fetch` through WASI HTTP is part of the v0.1 handler runtime.
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
