# Security Model

This document describes the current `applik8s` runtime security boundary. It is intentionally conservative: unsupported access fails closed rather than becoming implicit behavior.

## Trust Boundary

Generated handlers run as WASM components inside the Rust operator host. The host owns Kubernetes API access, operation-plan validation, status lifecycle writes, logs, metrics, replay artifacts, and declared host imports.

Handlers do not receive a Kubernetes client. They return a normalized operation plan, and the host validates the full plan before applying effects.

## What The Sandbox Provides

The WASM/component boundary prevents handler code from directly using host process APIs unless the host explicitly exposes imports.

Current host import policy:

- Generated manifests declare allowed imports in `spec.adapterRequirements.hostImports`.
- The Rust host inspects actual component imports before startup/invocation.
- Undeclared imports fail closed before handler execution.
- Canonical v1alpha1 imports are `capability-request`, `log`, and `cancel`.

The host import allowlist is an ABI contract, not a permission to perform arbitrary effects. A declared import must still have a safe implementation before it can do useful work.

## What The Sandbox Does Not Provide

The sandbox does not make captured application code automatically safe.

- It does not prove handler logic is correct or idempotent.
- It does not prevent intentionally returned Kubernetes operation plans unless validation rejects them.
- It does not turn embedded secrets into safe data.
- It does not make source maps, replay artifacts, logs, or status messages safe to expose when full payload capture is enabled.
- It does not provide filesystem or environment access to handlers. Direct `fetch` uses WASI HTTP host imports; richer external-effect policy still belongs in declared capabilities.

Compiler portability checks reduce obvious unsafe captures, but they are not a formal static security proof.

## Ambient Access Policy

Default generated bundles declare a fail-closed portability posture:

- ambient filesystem access: denied.
- direct `fetch` through WASI HTTP: allowed by policy.
- Node/raw network APIs such as `node:http`, `net`, `tls`, `dns`, and `WebSocket`: denied.
- ambient environment access: denied.
- dynamic module loading: denied.
- local credential paths: denied.
- embedded secret material: denied.
- unsupported Node-native modules: denied.

Generated Kubernetes and TypeKro resources mirror this posture through `applik8s.dev/*` annotations so cluster policy tools can inspect it before rollout.

## External Capabilities

External capabilities are opt-in live effect mechanisms. Unsupported capability kinds and unsafe policy shapes still fail closed.

The first implemented host protocol is intentionally narrow: `auth: none` HTTP capabilities using `execution.liveExecution: "hostProtocol"` and `execution.protocol: "applik8s.capability/v1alpha1"`. The Rust host performs these requests through the declared endpoint only; handler-provided request paths must be absolute paths without scheme or host. Responses must be JSON. Mutating HTTP methods require a handler-provided idempotency key, which the generated dispatcher rejects before the host import when absent and the host forwards as the `Idempotency-Key` header.

Capability request payloads include the current `reconcileId` so host logs, external audit trails, replay metadata, and any future durable external-effect records can correlate an external request with the reconciliation that requested it. Host success responses must include an explicit `value`; malformed success envelopes fail closed instead of becoming `undefined` handler data.

Handlers that rely on an external effect for correctness should record durable intent, result, or failure state in Kubernetes status or a related CRD. The SDK exposes external-effect status helpers that store records keyed by `capabilityName` and `idempotencyKey`, including request/response digests and an optional condition, so retries can reconcile from Kubernetes-visible state instead of hidden process memory.

HTTP capability timeout and retry policy are bounded by the declared descriptor policy. Manifest generation rejects timeout values outside `1..30000ms` and retry policies outside the supported `1..5` attempts and `1..30000ms` backoff bounds before a bundle can be emitted. The host repeats those checks for request-level timeout overrides and live retry execution. The host retries transient network errors, `5xx`, and `429` responses only; retry descriptors outside the supported attempt/backoff bounds fail closed before live effects.

Secret-backed auth is implemented only for the HTTP host protocol. A live HTTP capability may declare `auth: { type: "secretRef" }`; the Rust host reads the referenced Kubernetes Secret through the operator ServiceAccount, injects `Authorization: Bearer <secret-value>` into the outbound request, and keeps that header redacted from handler input, logs, status, and replay metadata. Generated RBAC grants `get` only on the named Secret resources required by live SecretRef capabilities.

The opt-in adversarial live suite proves host-routed HTTP execution against an in-cluster endpoint, idempotency-key propagation, generated Secret RBAC, Kubernetes Secret lookup, redacted bearer material, and fail-closed behavior when the referenced Secret is removed.

Live SecretRef auth currently requires an explicit `deployment.namespace`, and Secret references must stay in that namespace. Manifest generation rejects unsupported auth descriptor types, including untyped custom auth metadata, until their protocol and redaction semantics are explicit. Cross-namespace Secret auth, custom auth headers, custom auth schemes, service-account live auth, cloud APIs, databases, queues, object stores, and identity providers remain fail-closed until their typed protocols, secret handling, cancellation, retry, idempotency, audit, and redaction semantics are implemented.

Generated manifests record declared capability posture so future admission and audit tools can reason about intent:

- capability name and kind.
- endpoint metadata where applicable.
- SecretRef auth metadata without embedding secret material.
- live execution posture, either `disabled`/`notImplemented` or the supported HTTP host protocol.
- audit posture, currently request metadata only and no payload capture.
- redaction posture, currently request body, response body, headers, and non-public error details redacted.
- idempotency posture for mutating external requests.

Manifest generation rejects descriptors that try to opt into live external capability execution unless the Rust host implements the corresponding typed protocol.

Before additional external capability kinds or auth modes become usable, each kind must define:

- descriptor schema and admission-facing metadata.
- secret reference handling with no embedded secret material.
- timeout and cancellation behavior.
- retry and idempotency semantics.
- redaction policy for logs, status, diagnostics, and replay artifacts.
- generated or documented policy/RBAC implications.

## Kubernetes Effects

Kubernetes effects must go through validated operation plans.

- Unknown operation kinds fail validation.
- Malformed operation payloads fail before effects.
- Undeclared operation-plan RBAC fails before effects.
- JSON Patch structure is validated before effects.
- Unsupported runtime concurrency and leader-election settings fail compatibility validation.

Failures after validation can still leave earlier operations visible in the cluster. Handlers must be idempotent, and status/log diagnostics should identify the failed operation.

## Replay And Diagnostics

Replay artifacts are opt-in. Metadata-only artifacts are the default. Full payload capture must be explicitly enabled and should be treated as sensitive because it can contain Kubernetes object bodies, status payloads, operation details, and handler errors.

Generated JavaScript bundle and source-map artifacts may be embedded in the runtime image for diagnostics. Source maps are emitted without embedded source content by default. Metadata-only replay artifacts record source-map identities and redact raw handler stack frames; full-payload replay artifacts and preserved source paths should still be treated as sensitive in locked-down environments.

## Supply Chain Posture

Generated manifests now make supply-chain posture explicit even before signing/SBOM/provenance tooling is fully implemented.

Current generated bundle posture:

- `signing: unsigned`.
- `sbom: notGenerated`.
- `provenance: notGenerated`.
- `admission: metadataOnly`.

Generated Kubernetes and TypeKro resources mirror this as annotations:

- `applik8s.dev/supply-chain-signing`.
- `applik8s.dev/supply-chain-sbom`.
- `applik8s.dev/supply-chain-provenance`.
- `applik8s.dev/admission-verification`.
- `applik8s.dev/handler-abi`.
- `applik8s.dev/requires-runtime`.
- `applik8s.dev/handler-timeout-seconds`.
- `applik8s.dev/host-imports`.
- `applik8s.dev/rbac-mode`.
- `applik8s.dev/rbac-least-privilege-reviewed`.
- `applik8s.dev/rbac-rule-count`.
- `applik8s.dev/capabilities`.
- `applik8s.dev/capability-kinds`.
- `applik8s.dev/capability-protocols`.
- `applik8s.dev/capability-live-execution`.
- `applik8s.dev/capability-redaction`.
- `applik8s.dev/capability-idempotency`.

This is intentionally honest metadata, not a claim of verification. Future signing/SBOM/provenance work must change these fields only when artifacts are actually generated and verifiable by admission or policy tooling.
