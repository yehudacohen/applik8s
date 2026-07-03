# Release Notes

## v0.2.0

v0.2.0 is the TypeKro-native Kubernetes application release. It keeps the v0.1 operator/runtime contract and adds the integrated app-composition proof centered on `examples/guestbook.ts`.

### Supported Path

- Install one user-facing package, `@applik8s/applik8s`, for SDK authoring, TypeKro integration, app DSL helpers, and selected TypeKro factory re-exports.
- Build wrapped TypeKro compositions with direct callable operator installs, e.g. `const install = guestBookRenderer({ namespace, replicas })` inside `sdk.kubernetesComposition(...)`.
- Instantiate generated CRD factories from the returned install binding and compose their status through TypeKro-visible expressions.
- Attach TypeKro-backed listeners to resource instances and scoped resource groups without hidden global registration.
- Generate composition-scoped app servers, Services, ServiceAccounts, RBAC, route bundles, source maps, route manifests, and route failure diagnostics from `app.server(...)`.
- Use typed resource actions in generated app servers: `create`, `get`, `query`, `patch`, `delete`, and buffered `increment`.
- Declare cache-backed indexes and aggregates so request paths avoid unbounded Kubernetes list-all behavior.
- Use first-class permission bundles and inferred RBAC while unsupported dynamic resource access fails closed.

### Flagship Proof

`examples/guestbook.ts` is the v0.2 pressure test. It proves:

- `GuestBook`, `GuestBookEntry`, and `GuestBookPageViewBucket` CRDs generated from typed schemas.
- direct callable TypeKro operator install through the wrapped application composition.
- generated web server and cached Valkey-backed `publishedGuestBookEntries` index.
- moderated `GuestBookEntry` reconciliation with typed live reads.
- buffered page-view counters through `GuestBookPageViewBucket.increment(...)` instead of per-request Kubernetes writes.
- aggregate workers that project entry counts and page-view totals into `GuestBook.status`.
- generated route diagnostics through route IDs, source locations, route manifests, bundle inputs, structured failure logs, and route IDs in failure responses.
- live local-cluster validation through the GuestBook e2e suite and full prerelease gate.

### Maturity Boundary

v0.2 is intentionally Kubernetes-native. CRDs are appropriate for control-plane resources and low/moderate Kubernetes-native domain state. applik8s does not claim CRDs are a general-purpose application database.

Not included:

- storage-backed `app.model(...)` semantics, migrations, or database constraints
- production-grade generated web framework behavior beyond the documented generated app-server path
- ingress/gateway/TLS exposure primitives
- arbitrary JavaScript predicate lowering beyond Kubernetes-lowerable selectors and generated-label semantics
- ambient untyped Kubernetes clients or direct in-handler Kubernetes writes outside operation plans
- workload-movement or disaster-recovery product guarantees

### Evidence

The release evidence is tracked in `docs/release-evidence-v0.2.md`. Before announcing v0.2, the required gate is:

```sh
APPLIK8S_RELEASE_LIVE_E2E=1 APPLIK8S_E2E_CONTEXT=orbstack bun run check:prerelease
```

## v0.1.0

v0.1.0 is the first public evaluation release of `applik8s`.

### Supported Path

- Define typed CRDs and proxy-first operator handlers in TypeScript.
- Test handlers locally without mutating a cluster.
- Compile handlers and reachable TypeScript code into a WASM component artifact.
- Generate Kubernetes CRDs, RBAC, ServiceAccount, Deployment, runtime manifest, Dockerfile, source maps, and apply script.
- Run generated handlers through the Rust operator host.
- Use runtime-authored `Ready` conditions, structured logs, source-mapped diagnostics, and replay artifact inspection.
- Install operators through plain Kubernetes YAML or TypeKro composition.

### Maturity Boundary

v0.1.0 is correctness-first and intentionally conservative. Unsupported features fail closed.

Not included:

- multi-version CRDs and conversion webhooks
- arbitrary external capability kinds
- full production HA and rollout/rollback guarantees
- Helm/Kustomize/OLM/OCI distribution
- signed provenance/SBOM enforcement
- production-grade multi-cluster or disaster-recovery automation

### Breaking Change Policy

Before `v1.0`, TypeScript authoring APIs and generated manifests may change. Runtime/handler compatibility is guarded by explicit manifest, ABI, and runtime requirement checks; unsupported combinations fail closed.

### Primary Docs

- `README.md`
- `BACKLOG.md`
- `RECONCILIATION_CONTRACT.md`
- `docs/first-run.md`
- `docs/imagejob-golden-path.md`
- `docs/typekro-golden-path.md`
- `docs/generated-artifacts.md`
- `docs/runtime-diagnostics.md`
- `docs/api-reference.md`
- `docs/troubleshooting.md`
- `docs/release-gates.md`
- `docs/runtime-image.md`
- `docs/scale-boundaries.md`
- `docs/kubernetes-compatibility.md`
- `docs/positioning.md`
- `docs/future-surface.md`
- `docs/decisions.md`
- `docs/maintainer-policy.md`
- `docs/security-model.md`
- `docs/contract-evolution.md`
- `docs/stabilization-boundary.md`
