# Runtime Diagnostics

This guide maps common runtime failure reasons to the first checks to make when an `applik8s` operator reports `Ready=False` or emits a structured failure log.

Runtime failures are reconcile failures. Earlier successful operations may already be visible in the cluster, and kube-runtime may retry the reconcile according to the operator retry policy.

Each top-level reason should answer five questions for users:

- what happened
- likely cause
- how to fix
- whether Kubernetes effects happened
- retry behavior

Use the thin CLI for the shared taxonomy entries:

```sh
bun run applik8s explain UndeclaredPermission
```

## Common Reasons

| Reason | Meaning | First fixes |
| --- | --- | --- |
| `ApplyFailed` | A server-side apply operation failed. | Check the failure `operation.target`, `fieldManager`, and Kubernetes API cause. Look for SSA conflicts, invalid resource fields, missing namespace, or missing RBAC. |
| `PatchFailed` | A JSON Patch operation failed. | Check the patch target and ensure the JSON Pointer path exists or is valid for the patch operation. |
| `DeleteFailed` | A delete operation failed for a target object. | Confirm the target ref, namespace/scope, delete propagation policy, and RBAC. Missing objects are treated as success by the runtime. |
| `StatusPatchFailed` | A status subresource patch failed. | Confirm the CRD has a status subresource, the status schema admits the patch, and no external field owner is conflicting with server-side apply. |
| `EventRecordFailed` | Kubernetes Event creation failed. | Confirm the regarding object is namespaced and the operator has `events/create` permission. |
| `FinalizerFailed` | Finalizer add/remove failed. | Confirm the finalizer name is qualified and the operator has `<resource>/finalizers` patch permission. |
| `UndeclaredPermission` | The operation plan needs a Kubernetes write permission not declared in the operator manifest. | Add the required RBAC rule or remove the operation. The host rejects this before Kubernetes effects. |
| `CapabilityDenied` / `CAPABILITY_DENIED` | A handler attempted a declared external capability that the host denied. | Confirm the capability uses the supported HTTP host protocol, required idempotency key, allowed path/header policy, and SecretRef auth/RBAC when configured. Unsupported protocols and auth modes fail closed. |
| `HandlerTimedOut` | Handler invocation exceeded the configured timeout. | Make the handler bounded and idempotent. Increase `runtime.handlerTimeoutSeconds` only when the work is expected and safe to retry. |
| `RetryExhausted` | The configured retry policy reached `maxRetries`; the runtime is waiting for the next Kubernetes object change. | Fix the underlying failure, then update the object or related desired state so Kubernetes triggers another reconcile. |
| `InvalidRuntimePayload` | The handler returned malformed output for the runtime contract. | Use proxy operations or `dispatchOperatorHandler()` helpers rather than constructing raw operation plans by hand. |
| `HandlerRuntimeFailed` | Wasmtime/component execution failed. | Inspect the handler error and generated artifact metadata. Use source-map artifacts when available to map generated JS frames back to source. |
| `UnsupportedOperation` | The handler returned an operation kind or semantic not supported by the runtime. | Upgrade both compiler/runtime together or remove the unsupported operation. |
| `KubernetesApiFailed` | A Kubernetes client/API call outside an operation-specific wrapper failed. | Check API server availability, discovery, RBAC, and generated CRD/resource scope. |

For sandbox, host-import, and external capability boundaries, see `docs/security-model.md`.

For full replay workflows, see `docs/replay-debugging.md`.

## Operation Progress

For operation application failures, structured logs and replay artifacts include:

- `errorDetails.operation.index`
- `errorDetails.operation.kind`
- `errorDetails.operation.target`
- `errorDetails.operation.fieldManager` for apply/status failures
- `errorDetails.partialEffects`
- `errorDetails.progress.completedOperations`
- `errorDetails.progress.applied`, `patched`, `deleted`, `statusPatched`, `eventsRecorded`, `finalizersMutated`, and `requeued`

If `partialEffects` is `false`, the failing operation was the first attempted effect after validation. If `partialEffects` is `true`, at least one earlier operation already completed and may be visible in Kubernetes. Reconcile handlers must recover by reading current Kubernetes state on retry; the runtime does not roll back prior effects.

Plan validation failures such as malformed status payloads, invalid JSON Patch entries, unsupported operation kinds, undeclared RBAC permissions, and unsupported host imports fail before Kubernetes effects.

## Handler Source Diagnostics

Generated dispatchers preserve JavaScript handler stack frames when a handler throws or rejects. The Rust host exposes those frames in structured `handlerFailed` diagnostics under `errorDetails.sourceMapping.frames` when they are available.

Generated runtime images embed the generated JavaScript bundle and source map at `/handler/handler.js` and `/handler/handler.js.map` for diagnostics. Source maps are emitted without embedded source content by default. When the source map is present, the Rust host uses the maintained `sourcemap` crate to populate `errorDetails.sourceMapping.mappedFrames` with TypeScript source path, line, column, and symbol metadata where the map can resolve the generated JavaScript frame.

Metadata-only replay artifacts redact raw handler failure messages and stack frames, but preserve the frame count and debug artifact identities. Full-payload replay artifacts may include raw handler failure details and should be treated as sensitive.

Local replay execution uses Node's maintained `node:module.setSourceMapsEnabled` runtime when available. With the original generated JavaScript bundle and `.map` file present, `bun run replay:inspect -- <artifact> --bundle-dir dist/applik8s --execute --json` can report stack frames mapped back to TypeScript source paths. Source-map contents are not embedded in metadata-only replay artifacts.

## Event Routing Notes

`statusChanged` is a best-effort reconciliation predicate, not a durable event stream. The runtime routes to `statusChanged` only when the current object has non-empty status and that status appears to have observed the current generation. Stale status routes through `created` or `updated` first. Handlers may still run more than once for the same status state and must remain idempotent.

## Correlation Fields

Structured logs, runtime-authored status, and replay artifacts should be correlated by:

- `operatorName`
- `handlerId`
- `event`
- `objectRef`
- `reconcileId`
- `bundleDigest`
- `runtimeVersion`
- `handlerAbi`

## Replay Artifacts

Replay artifact emission is opt-in.

- Set `runtime.replayArtifacts.enabled: true` and `runtime.replayArtifacts.directory` to generate Deployment env for artifact writing.
- By default, replay artifacts redact object bodies, status payloads, operation payloads, diagnostics, and raw error causes.
- Set `runtime.replayArtifacts.includePayloads: true` only in environments where storing full handler input, plan, and error strings is acceptable.
- Operation failure replay artifacts keep operation progress counters even when payloads and raw causes are redacted.

Replay artifacts include source-map-relevant artifact identities when available:

- `javascript-bundle`
- `javascript-source-map`
- `esbuild-metafile`

These identities support digest verification and local source-map-aware replay. Frame remapping uses maintained runtime/tooling; do not hand-map source maps manually.

When `replay:inspect --execute` runs on a Node version with `node:module.setSourceMapsEnabled`, the summary reports `execution.sourceMapRuntime.status` so diagnostics can tell whether maintained source-map runtime support was active during local replay execution.

Inspect a replay artifact locally with:

```sh
bun run replay:inspect -- path/to/replay-artifact.json
```

If the original compiled bundle directory is available, verify source-map-related artifact digests with:

```sh
bun run replay:inspect -- path/to/replay-artifact.json --bundle-dir dist/applik8s
```

Deterministically execute a full-payload artifact against the local generated JavaScript bundle with:

```sh
bun run replay:inspect -- path/to/replay-artifact.json --bundle-dir dist/applik8s --execute
```

Replay execution invokes the generated handler dispatcher with the captured handler input and compares the resulting normalized operation plan with the captured plan when one is present. It does not apply Kubernetes operations, call the Kubernetes API, or replay external side effects. Metadata-only artifacts can identify the failing reconcile, handler, object, operation, bundle, and debug artifacts, but cannot execute locally.
