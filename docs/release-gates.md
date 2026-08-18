# Release Gates

Release readiness has two layers: local gates and pre-release live gates. v0.6 retains the earlier substrate, command, workflow, connection, and DNS gates and adds native-model, PostgreSQL RLS, live-query, stream, projection, browser-client, performance-history, and generated TypeKro lifecycle evidence.

## Local Gates

Run:

```sh
bun run check:local
```

This executes:

- `bun run typecheck`
- `bun run lint`
- `bun run test:implemented`
- `bun run test:character`
- `cargo fmt --all -- --check`
- `cargo clippy --workspace --all-targets -- -D warnings`
- `cargo test --workspace`

`bun run lint` also runs runtime-contract checks and the release-readiness checker.

## Package Publish Dry-Run

Run:

```sh
bun run check:publish-dry-run
```

This executes `npm pack --dry-run --json` inside each publishable package and verifies that package contents include `package.json`, source files, declared export targets, and CLI bin targets.

## Release Readiness Checker

Run:

```sh
bun run check:release
```

The checker verifies:

- publishable package metadata
- version `0.7.1` by default, or `APPLIK8S_RELEASE_VERSION` when validating a different candidate
- Apache-2.0 license metadata
- public publish config
- no `file:` dependency ranges in publishable packages
- required public docs exist
- public release files do not contain private branding or excluded product terms
- internal-only package paths are absent from the public tree

## v0.6 Native-Model and Reactive-Application Gates

Run the complete local candidate gate:

```sh
bun run check:v06:local
```

It combines type, lint, module-boundary, full implemented, focused v0.6 contract, character, coordinated
dry-pack, clean-consumer, executable scorecard, synthetic performance-budget, Rust formatting, Clippy,
host-contract, and real ComponentizeJS/WIT/Wasmtime checks.

Run the complete live candidate against the explicitly selected OrbStack context:

```sh
bun run check:v06:prerelease:orbstack
```

That lane refreshes PostgreSQL and ClickHouse integration receipts, deploys the generated v0.6
application through TypeKro, proves RLS isolation, query invalidation, stream replay, projection
checkpointing and restart/resume, deletes through the owning TypeKro factory, and requires unexpired live
evidence in the executable scorecard. See `docs/release-evidence-v0.6.md` for the exact claims and
`docs/v0.6-foundation.md` for provider and KRO lifecycle boundaries.

## Historical v0.2 Pre-Release Gates

Run against an explicitly selected local Kubernetes context:

```sh
APPLIK8S_RELEASE_LIVE_E2E=1 APPLIK8S_E2E_CONTEXT=orbstack bun run check:prerelease
```

This runs local gates and then live E2E suites for:

- generated artifacts
- CRD schema acceptance
- live reconcile
- TypeKro deploy
- TypeKro GuestBook flagship
- TypeKro-native tutorial/status/listener composition
- live adversarial behavior
- partial operation failure

The selected context is mutated. Do not use a shared or production cluster.

## v0.3 Substrate-Freeze Gates

v0.3 release candidates use additional gates for framework substrate contracts.

Run the full local v0.3 substrate gate:

```sh
bun run check:v03:local
```

This executes typecheck, lint, v0.3 contract coverage, generated-artifact checks, and character tests.

Run only local v0.3 contract coverage:

```sh
bun run test:v03:contracts
```

This exercises app graph stability, provider support contracts, TransactionalDatabase semantics, generated job durable status ownership, TypeKro CRD/status parity, generated server/runtime module boundaries, and public v0.3 pressure-test contracts. The pressure-test contract now requires explicit evidence declarations for durable status concurrency/restart/multi-job behavior, TransactionalDatabase generated/script parity, generated server/job operation-target execution, unsupported watch-predicate diagnostics, runtime image/supply-chain posture, and the canonical live assertion checklist.

Run the CI-safe non-live v0.3 substrate gate:

```sh
bun run test:v03:local
```

This combines v0.3 contract coverage and generated-artifact checks without live cluster mutation.

Run generated-artifact checks without live cluster mutation:

```sh
bun run test:v03:generated
```

This command runs the two offline Tenant Platform artifact assertions. The two Kubernetes acceptance assertions in the same test file remain skipped unless both live E2E environment flags are set.

Run opt-in live v0.3 substrate evidence against an explicitly selected local Kubernetes context:

```sh
bun run check:v03:prerelease:orbstack
```

For a non-OrbStack local context, set `APPLIK8S_E2E_CONTEXT` and run:

```sh
bun run check:v03:prerelease
```

The live v0.3 gate covers Tenant Platform, durable generated-status history, TypeKro Postgres TransactionalDatabase, migration drift preflight, TypeKro operation targets, scoped TypeKro listeners, unsupported watch-predicate fail-closed diagnostics, and the live evidence required by the pressure-test contract. It mutates the selected context and may install or reuse TypeKro/CNPG prerequisites.

## Skipping Live E2E

For local development only, live E2E may be skipped explicitly:

```sh
APPLIK8S_RELEASE_ALLOW_SKIP_LIVE_E2E=1 bun run check:prerelease
```

Do not use this for an actual v0.2 release announcement.

## v0.4 Durable-Behavior Release Gates

Run the CI-safe v0.4 contract and artifact suite:

```sh
bun run check:v04:local
```

This covers command/event contracts, application-graph authority metadata, PostgreSQL transactional behavior, outbox recovery, generated processors, JetStream transport, packed packages, character tests, and Kubernetes SDK WASM artifacts.

Run the executable evidence inventory:

```sh
bun run check:v04:scorecard
```

Its per-dimension `10/10` values mean all declared objective evidence checks pass; they are coverage scores, not subjective maturity claims. The inventory is versioned in `benchmarks/v0.4/scorecard.json`.

Run the complete live release candidate against OrbStack:

```sh
bun run check:v04:prerelease:orbstack
```

For another explicitly selected disposable context:

```sh
APPLIK8S_E2E_CONTEXT=<context> bun run check:v04:prerelease
```

The live gate proves Core/Apps/Custom Objects Kubernetes SDK calls through WASM plus the unified Tenant Platform command path. The Tenant proof includes keyed concurrency, duplicate recovery, atomic history/outbox visibility, graceful drain/restart, abrupt processor crash, backlog redelivery, lag observations, and TypeKro `deleteInstance()` cleanup before RGD deletion.

## Required Evidence For v0.4

Before announcing v0.4, capture:

- complete local and packed-package gate output
- OrbStack Kubernetes SDK WASM output
- unified Tenant Platform v0.4 output, including restart/crash/backlog and cleanup assertions
- generated processor security, NetworkPolicy, health, and graceful-lifecycle artifact assertions
- TypeKro 0.26 direct and KRO lifecycle evidence
- release notes, clean version metadata, and `docs/release-evidence-v0.4.md`

## Historical Required Evidence For v0.3

Before announcing v0.3, capture:

- local gate output
- pre-release live v0.3 gate output with context name
- Tenant Platform generated artifact listing
- generated runtime image/build/signing posture decision
- release notes diff
- package publish dry-run and clean packed-consumer smoke output
- updated `docs/release-evidence-v0.3.md`

## CI Evidence

- `.github/workflows/ci.yml` runs local gates, package publish dry-run, and a clean packed-consumer import smoke test for normal repository changes.
- `.github/workflows/release-evidence.yml` is a manual release-candidate workflow that builds `dist/applik8s` and uploads generated artifacts. It can run live prerelease gates against a cluster reachable from GitHub, or validate a non-secret base64 JSON attestation produced by an authorized maintainer on a loopback-only local cluster such as OrbStack.
- A successful live Release Evidence run uploads an expiring artifact named for its exact commit. `.github/workflows/deploy.yml` refuses tag publication or npm recovery publication unless that exact commit has a successful, unexpired manual live attestation.
- `.github/workflows/deploy.yml` runs the expiring reviewed npm audit baseline in addition to the local and package gates. After the live-evidence check, tag pushes publish the multi-architecture host image, publish npm packages through OIDC trusted publishing, verify released artifacts, and only then create the GitHub release.

The dependency gate is:

```sh
bun run check:package-audit
```

It fails on new, changed, stale, or expired advisories. The current reviewed findings and containment boundary are documented in `docs/build-supply-chain.md`.

## Publishing

Publishing is tag-driven. On the final release commit, first run **Release Evidence** with `run_live_e2e=true`. For a loopback-only cluster, run `bun run attest:v04:orbstack -- --out /tmp/applik8s-v0.4-live-evidence.json`, base64 that non-secret JSON into `live_attestation_b64`, and never upload a local kubeconfig merely to satisfy the workflow. Do not change the commit after the evidence workflow succeeds. Push the release tag only after that exact-commit gate passes. The deploy workflow uses npm trusted publishing for every `@applik8s/*` package and `packages: write` for the public GHCR operator host.

Validate package contents and imports from unpacked tarballs before tagging:

```sh
bun run check:packages
bun run check:package-audit
```

Local publish command, for maintainers only:

```sh
bun run publish:packages
```

Do not run local publishing unless package ownership and npm authentication are intentionally configured. Prefer the tag-driven GitHub Actions OIDC path.
