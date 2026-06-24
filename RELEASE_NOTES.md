# Release Notes

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
