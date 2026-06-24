# Troubleshooting

Use `applik8s explain <reason>` for diagnostic advice when a known reason is available.

## Build Fails

Common reasons:

- unsupported schema shape
- unsupported compiler option
- invalid runtime config
- unsupported handler ABI or host import policy
- local credential, ambient filesystem/environment capture, or unsupported Node/raw network access

What to do:

- read the first compiler diagnostic before later errors
- simplify schemas into Kubernetes structural OpenAPI
- remove unsupported options instead of expecting them to be ignored
- rerun `bun run typecheck` and the focused compiler test

## Schema Rejected

Reason: `SCHEMA_UNSUPPORTED`.

Typical causes:

- `oneOf`, `anyOf`, `allOf`, or unsafe mixed unions
- tuple arrays
- invalid `nullable`
- malformed `additionalProperties`
- Kubernetes list-map extensions without required merge keys
- unconstrained object preservation

Fix by rewriting schemas into the supported structural subset and rerunning compiler or TypeKro synthesis tests.

## RBAC Denied Before Effects

Reason: `UndeclaredPermission`.

The runtime rejected the plan before Kubernetes effects because the manifest did not declare a required permission.

Fix by adding explicit operator permissions for the resource, verb, and API group used by the handler.

## Kubernetes Apply Failed

Reason: `ApplyFailed`.

Common causes:

- server-side apply ownership conflict
- invalid namespace or cluster scope
- invalid server-populated metadata in handler-authored resources
- live Kubernetes RBAC denial
- CRD schema rejection

Check operation index, target ref, field manager, Kubernetes API message, and prior completed operation count. Partial effects may already be visible.

## Status Patch Failed

Reason: `StatusPatchFailed`.

Common causes:

- CRD lacks status subresource
- status schema rejects the value
- another field manager owns the status field

Ensure generated CRDs declare `statusSubresource`, keep status structural, and resolve field ownership conflicts.

## Handler Failed

Reason: `HandlerRuntimeFailed`.

Use source-mapped diagnostics and replay artifacts to find the application frame. Generated source maps omit embedded source content by default; keep the matching bundle artifacts for debugging.

## Handler Timed Out

Reason: `HandlerTimedOut`.

Handlers must be bounded and idempotent. Move durable progress into Kubernetes-visible state and requeue instead of waiting inside one handler invocation. Increase `handlerTimeoutSeconds` only when retries remain safe.

## Capability Denied

Reason: `CAPABILITY_DENIED`.

v0.1 only supports the narrow HTTP JSON capability protocol with explicit idempotency and SecretRef bearer auth. Missing secrets, unsupported auth descriptors, unsupported protocols, and mutation requests without idempotency keys fail closed.

## Replay Artifact Invalid

Reason: `ReplayArtifactInvalid`.

Metadata-only replay artifacts can be inspected but not executed. To execute replay locally, enable full-payload capture and pass `--bundle-dir` pointing at the matching generated bundle.

## Retry Exhausted

Reason: `RetryExhausted`.

The runtime exhausted configured retries for the same failing reconcile. Fix the root cause, then update the object or desired state to trigger a fresh reconcile.

## Live E2E Fails To Start

Live E2E suites require explicit opt-in:

```sh
APPLIK8S_E2E=1 APPLIK8S_E2E_CONTEXT=orbstack bun run test:e2e
```

The selected context is mutated. Do not run live E2E against a shared or production cluster.
