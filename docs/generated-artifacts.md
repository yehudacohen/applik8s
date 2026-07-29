# Generated Artifacts

`applik8s build` and `createCompilerPipeline().run()` emit a deterministic operator bundle under `dist/applik8s` by default.

`applik8s build <entrypoint> --typekro` and `compileTypeKroComposition(...)` emit an exported TypeKro composition bundle in the same output tree.

## Layout

- `operator-manifest.json`: canonical manifest consumed by the Rust host and by TypeKro install synthesis. Installed connection builds include the environment-specific alias bindings; portable builds do not.
- `contract/runtime-contract.json`: runtime contract schema and ABI metadata.
- `contract/applik8s-handler.wit`: WIT interface for the generated handler component.
- `wasm/handler.wasm`: WASM component loaded by the operator host.
- `bundle/handler.js`: generated JavaScript dispatcher bundle used to build the component and for replay/debugging.
- `bundle/handler.js.map`: source map for handler failure diagnostics. Source content is omitted by default.
- `bundle/handler.esbuild-meta.json`: dependency graph metadata for diagnostics and replay verification.
- `kubernetes/*.yaml`: CRD, RBAC, ServiceAccount, Deployment, and optional runtime resources.
- `Dockerfile.applik8s-runtime`: image recipe for packaging the manifest, handler component, and debug artifacts with the operator host.
- `apply.sh`: thin local build/apply script for the generated Kubernetes YAML.

When an application composition declares `app.server(...)`, the TypeKro output also contains an inspectable generated server bundle:

- `server.mjs`: Node HTTP adapter that forwards requests into the generated Hono app via `app.fetch(...)`.
- `server.mjs.map`: server source map for route/runtime diagnostics.
- `runtime.mjs`: small generated runtime for request parsing, response normalization, Kubernetes calls, and optional cache clients.
- `bindings.mjs`: generated resource, index, cache, and capture bindings made available to route modules.
- `routes.mjs`: route registration module.
- `routes.manifest.json`: route metadata for diagnostics and review.
- `route-<id>.mjs`: one module per discovered route handler.

Generated route modules include diagnostic comments when source-backed extraction succeeds:

- `applik8s-route-source-kind`: whether the handler came from source extraction or `Function.prototype.toString()` fallback.
- `applik8s-route-source-location`: source file, line, and column for the route declaration.
- `applik8s-route-bundle-inputs`: bundled helper/import inputs when a route uses module-scope or imported helpers.

Generated server Deployments set `NODE_OPTIONS=--enable-source-maps`, return `No route for METHOD /path` for 404s, and log route failures as JSON events with `event: "applik8s-server-route-failure"`. Route failure logs include route ID, method, path, module, source kind, source location, bundled helper inputs, message, and captured stack frames before returning `Route <id> (METHOD /path) failed: ...`.

For release review, `routes.manifest.json` is the fastest way to confirm the generated server did not rely on hidden route registration. Each entry should identify the route ID, method/path, module file, source kind, source location when available, and bundle inputs used to produce the route module.

## What To Review

- CRDs include only structural schema accepted by the shared compiler gate.
- RBAC rules should match declared operator permissions, generated CRD permissions, status/finalizer permissions, Events, capabilities, and leader-election Leases when enabled.
- Kubernetes connection Secret rules must remain namespaced, use `resourceNames`, and must not grant the remote resource envelope in the management cluster.
- Deployment image and env should match the manifest container recipe.
- Generated app-server source ConfigMaps should include `routes.manifest.json`, `route-<id>.mjs`, `bindings.mjs`, `runtime.mjs`, `server.mjs`, and `server.mjs.map` when `app.server(...)` is used.
- Generated route modules should include source diagnostics comments, and `server.mjs` should include `applik8s-server-route-failure` logging.
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
| `ImageJob.on.finalize(..., { finalizer })` | `operator-manifest.json` records handler event/finalizer metadata. The Rust host installs the declared finalizer before normal reconciliation, routes deletion-timestamp objects to the matching finalize handler, automatically removes it after successful terminal cleanup (but retains it when cleanup requeues), and rejects foreign finalizer ownership. |

This is the core operator contract: tiny TypeScript syntax, explicit operation plans, ordinary Kubernetes YAML, and fail-closed runtime validation.

## GitOps Use

Commit or publish the generated Kubernetes YAML only after reviewing `operator-manifest.json`. The manifest is the source of truth for bundle digest, handler ABI, runtime version range, owned CRDs, RBAC posture, capability declarations, replay settings, and supply-chain metadata.

Use server-side apply with a stable field manager:

```sh
kubectl apply --server-side --field-manager=applik8s-gitops --filename dist/applik8s/kubernetes
```

## TypeKro Use

Use `typeKro.composition(operator.definition, manifest, options)` from `@applik8s/applik8s` or `@applik8s/typekro-adapter` when another TypeKro graph should install the operator and create instances of its owned CRDs. The lower-level `asComposition()` alias remains available for adapter authors.

The TypeKro adapter consumes the same manifest and schema gates as plain YAML emission. It does not invent different RBAC, schema, runtime, or Kubernetes-connection semantics. TypeKro composition compilation accepts a per-operator connection-binding map so nested installs receive the same exact binding validation as plain YAML.

For the integrated v0.2 path, export the applik8s operator and wrapped TypeKro composition from the same entrypoint, then run:

```sh
applik8s build ./src/media-stack.ts --typekro --composition-name mediaStack --out-dir dist/applik8s
```

The composition build emits:

- `typekro/typekro-composition.json`: bundle metadata, selected composition export, resource count, and nested operator artifact references.
- `typekro/resources.json`: JSON resources produced after direct operator calls are lowered to compiled install resources.
- `typekro/resources.yaml`: combined YAML for inspecting or applying the resolved composition resources.
- `typekro/resources/*.yaml`: one YAML file per resolved resource.
- `typekro/instances/*.yaml`: one generated KRO instance manifest per empty-spec exported composition, used to let KRO render status-composed template resources.
- `typekro/template-manifests.txt`: sidecar list of resource YAMLs owned by a KRO `ResourceGraphDefinition`; `apply.sh` skips these instead of directly applying template placeholders.
- `typekro/apply.sh`: staged apply helper that installs generated CRDs first, waits for establishment, applies KRO `ResourceGraphDefinition` resources next, skips RGD-owned template resources, applies ordinary remaining resources, and then applies generated KRO instances.
- `operators/<operator-name>/`: normal nested operator artifacts used to synthesize the TypeKro install resources.

Prefer `typekro/apply.sh` over a naive `kubectl apply -f typekro/resources.yaml` when the composition contains generated applik8s CRDs or KRO graphs. Kubernetes and KRO validate custom resources against established CRDs, and KRO template resources can contain expression placeholders that are only valid inside the `ResourceGraphDefinition`, so the generated script makes the ordering and ownership boundaries explicit.

## TypeKro GuestBook Example

The flagship v0.2 TypeKro example is `examples/guestbook.ts`. Build its artifacts with:

```sh
bun run build:guestbook
```

The example is intentionally the applik8s/TypeKro program, not shell orchestration. It compiles into `dist/examples/guestbook`, where the generated artifacts include the nested operator bundle, inspectable TypeKro resources, generated Hono server modules, a cached indexer workload, and a standalone Valkey `Deployment`/`Service` by default.

The proof is intentionally artifact-inspectable:

- the wrapped TypeKro composition lowers `guestBookRenderer({ namespace, replicas })` into ordinary operator install resources
- the generated server Role grants `create`, `get`, and `patch` on `guestbookpageviewbuckets` because the route uses `GuestBookPageViewBucket.increment(...)`
- the server source contains route modules for `GET /` and `POST /entries`, `routes.manifest.json`, route source metadata, and route failure diagnostics
- the generated runtime contains `bufferResourceCounterIncrement` and `applik8s-server-counter-flush-failure`, proving page views are buffered instead of written synchronously per request
- the generated runtime does not need old request-path `GuestBookPageViewBucket.get/create/patch` route calls for the counter path

`examples/guestbook.ts` uses `app.defaults({ indexes: 'valkey' })`, so generated request paths read `GuestBookEntry` pages from the cached `publishedGuestBookEntries` index instead of listing CRDs on every HTTP request. The server also calls `GuestBookPageViewBucket.increment(...)`; generated runtime code buffers those increments, flushes them into per-minute `GuestBookPageViewBucket` CRDs with inferred get/create/patch RBAC, and logs `applik8s-server-counter-flush-failure` if a flush fails. The page-view aggregate watches those buckets and updates `GuestBook.status.pageViewsTotal` and `pageViewsLastMinute` without hot parent patches.

The default generated Valkey backend is a plain Kubernetes `Deployment` plus `Service` using `valkey/valkey:8.1-alpine`. Set the Valkey index backend `provisioner` to `hyperspike` only when the generated client and deployment environment are ready for that CRD-backed topology. Applik8s also re-exports TypeKro 0.25's `valkeyBootstrap` and Valkey resource factories for explicitly owned operator installations.

For production S3-compatible object storage, import the TypeKro 0.25 Rook surface from `@applik8s/applik8s/factories/rook`. `rookCephOperatorBootstrap` owns the operator installation; `rookObjectStorageClaim` owns an application claim against a platform-provided bucket `StorageClass`. The claim factory is direct-only by design because Rook mutates `ObjectBucketClaim` resources continuously. The bounded ConfigMap object provider remains the zero-configuration v0.3 default.

## App-Scoped Inference

Inside `sdk.kubernetesComposition(...)`, `app(...)` is the inference boundary for generated application workloads:

- `app.operator(...)` contributes the installed operator's SDK resources to the current app scope.
- `app.aggregate(...)` contributes its source index to the current app scope.
- `app.server(...)` infers referenced resources and indexes from route source when identifiers are unambiguous.
- `app.defaults({ indexes: 'valkey' })` makes Valkey the default cache/backend for inferred indexes when safe.
- Explicit `resources`, `indexes`, `cache`, `indexBackend`, and `permissions` remain overrides or additive controls.

Inference is fail-closed. Missing or ambiguous resource/index bindings are rejected during artifact generation instead of becoming runtime `ReferenceError`s or unbounded Kubernetes list calls. Cached indexes do not grant server-side CRD `list` RBAC; the generated indexer gets Kubernetes `get/list/watch`, and the generated server reads Valkey.
