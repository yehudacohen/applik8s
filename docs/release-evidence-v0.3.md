# v0.3 Release Evidence

This file packages the evidence needed before freezing or announcing v0.3. Keep it updated during each release-candidate pass; do not rely on chat logs as release evidence.

## Candidate

- Candidate: `v0.3.0`
- Flagship proof: `examples/tenant-platform.ts`
- Live context used for final release pass: `orbstack`

## Local Evidence

Required before v0.3 freeze:

```sh
bun run check:v03:local
```

This includes:

- `bun run typecheck`
- `bun run lint`
- `bun run test:v03:contracts`
- `bun run test:v03:generated`
- `bun run test:character`

The CI-safe v0.3 substrate gate is:

```sh
bun run test:v03:local
```

This gate is wired into CI and release evidence workflows and does not mutate a live cluster.

Captured for the current release-candidate pass on 2026-07-10:

```sh
bun run check:v03:local
```

Current-tree local candidate pass on 2026-07-10:

- `tsc --noEmit --project tsconfig.json`: passed
- `biome lint .`: checked 150 files, no fixes applied; existing GuestBook style warnings were reported
- runtime-contract, docs-consistency, release-readiness, typecast, static-import, and test-taxonomy checks: passed
- `test:v03:contracts`: 4 files passed, 135 tests passed, 8 skipped
- `test:v03:generated`: 1 file passed, 2 offline tests passed, 2 live tests skipped
- `test:character`: 2 files passed, 5 skipped, 15 tests passed, 78 todo

## Live Evidence

Required before v0.3 announcement against an explicitly selected local Kubernetes context:

```sh
bun run check:v03:prerelease:orbstack
```

For non-OrbStack local contexts:

```sh
APPLIK8S_E2E_CONTEXT=<context> bun run check:v03:prerelease
```

The live v0.3 gate must cover:

- Tenant Platform TypeKro/CNPG/Postgres/admin-server pressure test
- runtime-created durable status ConfigMap, retained job history, and KRO-owned app-status hydration
- Postgres ModelStore create/query/duplicate-key behavior
- migration drift preflight behavior
- TypeKro operation-target apply/delete/dry-run behavior
- scoped TypeKro listener routing
- live fail-closed diagnostics for unsupported watch predicates

When a Postgres URL is available for script-execution parity, also run:

```sh
APPLIK8S_MODELSTORE_SCRIPT_RUNTIME_DATABASE_URL=<postgres-url> bun run test:modelstore:script-runtime:live
```

The selected context is mutated. Do not use a shared or production cluster.

Captured for the current release-candidate pass on 2026-07-10:

```sh
bun run test:v03:live:orbstack
```

Current-tree live candidate pass completed against `orbstack`:

- `packages/e2e/test/tenant-platform-live.e2e.test.ts`: 1 test passed
- `packages/e2e/test/typekro-modelstore-postgres.e2e.test.ts`: 3 tests passed
- `packages/e2e/test/typekro-operation-target.e2e.test.ts`: 2 tests passed
- `packages/e2e/test/typekro-scoped-listener.e2e.test.ts`: 6 tests passed
- Overall live summary: 4 files passed, 12 tests passed

The final single-command pass completed in 140.76 seconds. Tenant Platform assertions read migration completion from the application CR's KRO-projected `status.applik8s.jobs` path; the durable ConfigMap is checked separately for retained history.

TypeKro 0.25 direct/KRO compatibility was also exercised explicitly against `orbstack`:

```sh
APPLIK8S_E2E=1 APPLIK8S_E2E_TYPEKRO=1 APPLIK8S_E2E_CONTEXT=orbstack bunx vitest run --config vitest.e2e.config.ts packages/e2e/test/typekro-deploy.e2e.test.ts
```

- direct factory deployment and reconciliation: passed
- KRO ResourceGraphDefinition/instance deployment and reconciliation: passed
- Overall compatibility summary: 1 file passed, 2 tests passed in 55.62 seconds

The TypeKro 0.25 pass also validates the public `typekro/containers` export and integer replica schema. This prevents KRO CEL from mixing `float` and `int` branches in the optional-replica fallback.

## Generated Artifact Evidence

Tenant Platform artifacts were generated for the current release-candidate pass on 2026-07-09:

```sh
bun run applik8s build examples/tenant-platform.ts --typekro --composition-name tenantPlatform --out-dir /var/folders/gv/vdxnlntj62s2r5pdznykd54h0000gn/T/opencode/tenant-platform-build-v03-evidence
```

Primary artifact paths:

- `/var/folders/gv/vdxnlntj62s2r5pdznykd54h0000gn/T/opencode/tenant-platform-build-v03-evidence/typekro/typekro-composition.json`
- `/var/folders/gv/vdxnlntj62s2r5pdznykd54h0000gn/T/opencode/tenant-platform-build-v03-evidence/typekro/resources.yaml`
- `/var/folders/gv/vdxnlntj62s2r5pdznykd54h0000gn/T/opencode/tenant-platform-build-v03-evidence/typekro/resources.json`
- `/var/folders/gv/vdxnlntj62s2r5pdznykd54h0000gn/T/opencode/tenant-platform-build-v03-evidence/typekro/application-graph.json`
- `/var/folders/gv/vdxnlntj62s2r5pdznykd54h0000gn/T/opencode/tenant-platform-build-v03-evidence/typekro/apply.sh`
- `/var/folders/gv/vdxnlntj62s2r5pdznykd54h0000gn/T/opencode/tenant-platform-build-v03-evidence/typekro/template-manifests.txt`

Generated resource highlights:

- `ResourceGraphDefinition` for `tenant-platform`
- CNPG `Cluster` `tenant-platform-db`
- model migration `Job` resources `account-migration`, `audit-record-migration`, `invitation-migration`, and `usage-sample-migration`
- model migration `ConfigMap` resources `account-migration-migration`, `audit-record-migration-migration`, `invitation-migration-migration`, and `usage-sample-migration-migration`
- repair `Job` `tenant-platform-repair`
- cleanup `CronJob` `tenant-platform-cleanup`
- generated admin `Deployment` and `Service` for `tenant-admin`
- generated status reconciler `Deployment`, `ServiceAccount`, `Role`, `RoleBinding`, `ClusterRole`, and `ClusterRoleBinding`
- runtime and diagnostic `ConfigMap` resources for migration, repair, cleanup, admin server, and status reconciler
- a runtime-created durable status `ConfigMap` observed by the ResourceGraphDefinition through `externalRef`

## Runtime Image And Supply-Chain Posture

v0.3 generated server bundles are deterministic build-time artifacts. Generated server pods must not install packages at startup. The release posture is metadata-only for supply-chain verification:

- signing: `unsigned`
- SBOM: `notGenerated`
- provenance: `notGenerated`
- admission verification: `metadataOnly`

This is the intentional v0.3 support boundary, not a claim of signed artifacts or admission enforcement.

## Package Publish Dry-Run

Captured for the current release-candidate pass on 2026-07-10:

```sh
bun run check:publish-dry-run
```

Publish dry-run output:

- `@applik8s/applik8s`: `applik8s-applik8s-0.3.0.tgz`, 40 files, 449983 bytes unpacked
- `@applik8s/core`: `applik8s-core-0.3.0.tgz`, 13 files, 195385 bytes unpacked
- `@applik8s/sdk`: `applik8s-sdk-0.3.0.tgz`, 7 files, 97715 bytes unpacked
- `@applik8s/compiler`: `applik8s-compiler-0.3.0.tgz`, 16 files, 201839 bytes unpacked
- `@applik8s/runtime-contract`: `applik8s-runtime-contract-0.3.0.tgz`, 2 files, 13868 bytes unpacked
- `@applik8s/runtime`: `applik8s-runtime-0.3.0.tgz`, 4 files, 4809 bytes unpacked
- `@applik8s/testing`: `applik8s-testing-0.3.0.tgz`, 5 files, 56472 bytes unpacked
- `@applik8s/typekro-adapter`: `applik8s-typekro-adapter-0.3.0.tgz`, 5 files, 135780 bytes unpacked
- `@applik8s/typetainer`: `applik8s-typetainer-0.3.0.tgz`, 2 files, 3270 bytes unpacked

The release package gate also packs all nine packages into a clean temporary consumer tree and bundles imports from all 14 documented public entrypoints:

```sh
bun run check:package-consumer
```

This catches workspace-link success that would otherwise hide a missing tarball export or broken inter-package import.

## Broader Workspace Evidence

- `bun run test:implemented`: 20 files passed, 260 tests passed, 8 skipped
- `cargo test --workspace`: operator host 90 passed; runtime bridge 30 passed across unit and bridge-contract suites; runtime-contract generated schema 4 passed; all doc tests passed
- the Rust bridge closure portability canaries passed through esbuild, componentize-js, and Wasmtime, including an imported async recursive `Proxy` client plus direct `fetch`
- `git diff --check`: passed

## Status Authority Boundary

- applik8s-owned domain CRDs have explicit structural status schemas and authoritative Rust-host status writes. This is the status capability downstream operators need for their own APIs.
- KRO owns the root TypeKro application CR and is the only writer for `status.applik8s.jobs`.
- The ResourceGraphDefinition observes the runtime-created status ConfigMap via `externalRef` and hydrates `status.applik8s.jobs` with `json.unmarshal(...)`; the ConfigMap remains the durable concurrency/history store.

## Release Notes

`RELEASE_NOTES.md` now includes the `v0.3.0` supported path, flagship proof, maturity boundary, and evidence command.

## v0.3 Release Bar

- Stable public v0.3 app/provider APIs are shaped and tested.
- Every native provider surface has a bounded Kubernetes-native default; additional adapters remain optional.
- Generated server bundles do not install dependencies at pod startup.
- ModelStore semantics are explicit for storage, query, index, constraint, transaction, migration, and retention behavior.
- Generated jobs have durable phase/status ownership, bounded history, retry/conflict diagnostics, and authoritative KRO-projected application status.
- Operation-target, watch-scope, CRD compatibility, runtime module, provider, and pressure-test contracts are executable gates.
- Pressure-test contracts must declare canonical live assertions for migration completion, server readiness, model create/query, duplicate-key handling, durable job status, migration drift fail-closed behavior, artifact-backed operation-target dry-run, scoped listener routing, and unsupported watch-predicate fail-closed diagnostics.
- Pressure-test contracts must declare release evidence for durable status restart/concurrency/multi-job behavior, ModelStore generated/script parity, generated server/job operation-target execution, live unsupported watch-predicate diagnostics, and runtime image/supply-chain posture.
- Broad post-v0.3 claims remain absent or explicitly out of scope.

## Remaining Evidence To Capture

- Postgres script-runtime ModelStore live parity output, when the release context provides `APPLIK8S_MODELSTORE_SCRIPT_RUNTIME_DATABASE_URL`.
