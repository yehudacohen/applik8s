# Generated Artifacts

`applik8s build` and `createCompilerPipeline().run()` emit a deterministic operator bundle under `dist/applik8s` by default.

## Layout

- `operator-manifest.json`: canonical manifest consumed by the Rust host and by TypeKro install synthesis.
- `contract/runtime-contract.json`: runtime contract schema and ABI metadata.
- `contract/applik8s-handler.wit`: WIT interface for the generated handler component.
- `wasm/handler.wasm`: WASM component loaded by the operator host.
- `bundle/handler.js`: generated JavaScript dispatcher bundle used to build the component and for replay/debugging.
- `bundle/handler.js.map`: source map for handler failure diagnostics. Source content is omitted by default.
- `bundle/handler.esbuild-meta.json`: dependency graph metadata for diagnostics and replay verification.
- `kubernetes/*.yaml`: CRD, RBAC, ServiceAccount, Deployment, and optional runtime resources.
- `Dockerfile.applik8s-runtime`: image recipe for packaging the manifest, handler component, and debug artifacts with the operator host.
- `apply.sh`: thin local build/apply script for the generated Kubernetes YAML.

## What To Review

- CRDs include only structural schema accepted by the shared compiler gate.
- RBAC rules should match declared operator permissions, generated CRD permissions, status/finalizer permissions, Events, capabilities, and leader-election Leases when enabled.
- Deployment image and env should match the manifest container recipe.
- `applik8s.dev/*` annotations are metadata unless the docs explicitly state enforcement exists.
- Source-map artifacts are diagnostic assets and should not embed source content unless explicitly configured later.

## ImageJob Handler To Artifact Map

The canonical `examples/imagejob.ts` handler is intentionally small, but every line lowers into inspectable Kubernetes/runtime contract:

| Handler operation | Generated/runtime evidence |
| --- | --- |
| `sdk.crd({ apiVersion, kind, spec, status })` | `kubernetes/customresourcedefinition-*.yaml` contains the structural OpenAPI schema, status subresource, and served/storage version metadata. `operator-manifest.json` records the owned CRD and schema posture. |
| `job.finalizers.add(...)` | Generated RBAC includes owned-CRD finalizer permissions. The runtime applies finalizer adds before child side effects and rejects undeclared finalizer mutations before effects. |
| `await readSourceObject(job.spec)` | `bundle/handler.js` contains the tree-shaken AWS SDK closure and the WASM component imports WASI HTTP for SDK-backed `fetch` requests. |
| `job.status.phase = 'Complete'` | Generated RBAC includes owned-CRD status permissions. The runtime writes handler-authored domain status separately from runtime-authored `Ready` conditions. |
| `job.k8s.ConfigMap({ data })` | The handler produces a normal Kubernetes ConfigMap object with top-level `data`; there is no hidden client call or non-Kubernetes resource model. |
| `job.apply(output)` | The WASM handler returns an `apply` operation. The Rust host validates RBAC, scope, server-populated metadata, ownership policy, and field-manager behavior before server-side apply. |
| `job.events.normal(...)` | Generated RBAC includes core `events` create/patch/update. Runtime diagnostics and live E2E prove the Event is emitted for the reconciled object. |
| `job.delete(job.k8s.ConfigMap(...))` | The proxy converts the factory-built object to an object reference. The finalize route deletes the child before removing the owned finalizer. |
| `ImageJob.on.finalize(..., { finalizer })` | `operator-manifest.json` records handler event/finalizer metadata. The Rust host routes deletion-timestamp objects to the matching finalize handler and rejects foreign finalizer ownership. |

This is the v0.1 contract: tiny TypeScript syntax, explicit operation plans, ordinary Kubernetes YAML, and fail-closed runtime validation.

## GitOps Use

Commit or publish the generated Kubernetes YAML only after reviewing `operator-manifest.json`. The manifest is the source of truth for bundle digest, handler ABI, runtime version range, owned CRDs, RBAC posture, capability declarations, replay settings, and supply-chain metadata.

Use server-side apply with a stable field manager:

```sh
kubectl apply --server-side --field-manager=applik8s-gitops --filename dist/applik8s/kubernetes
```

## TypeKro Use

Use `typeKro.composition(operator.definition, manifest, options)` from `@applik8s/applik8s` or `@applik8s/typekro-adapter` when another TypeKro graph should install the operator and create instances of its owned CRDs. The lower-level `asComposition()` alias remains available for adapter authors.

The TypeKro adapter consumes the same manifest and schema gates as plain YAML emission. It does not invent different RBAC, schema, or runtime semantics.
