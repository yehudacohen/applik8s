# v0.4.3 Release Evidence

Status: candidate pending exact-commit CI attestation and publication

Evidence date: 2026-07-13

## Scope

v0.4.3 is the final v0.4 hardening release. It preserves v0.4.2's command, event, PostgreSQL authority, JetStream transport, TypeKro infrastructure, Kubernetes-WASM, HTTP exposure, TLS, DNS, packaging, and operator-host contracts. It does not add tasks, workflows, public subscriptions, projections, or reactive UI APIs.

## Transaction Effect Boundary

- Command key, idempotency, initialization, and handler sources are checked through the shared TypeScript-aware route-source analyzer rather than raw keyword matching.
- Transaction callbacks reject ambient network/process access, nondeterministic wall-clock/random access, dynamic code construction, prototype/constructor escape routes, and implicit `this` access.
- The PostgreSQL runtime independently installs async-context guards for `fetch`, `WebSocket`, `EventSource`, `process.getBuiltinModule`, `process.binding`, and `process._linkedBinding` while a transaction callback executes.
- The ApplicationGraph records `closedStructuralAllowlist`, `asyncContextAmbientIo`, and `outboxOrTaskOnly` as required command-handler enforcement metadata.
- This is a supported transaction-callback contract, not a sandbox for hostile code. External effects belong in declared outboxes or v0.5 durable tasks.

## Public Contract And Evidence

- `command`, `event`, `Model.on.command`, generated processors, `Certificate`, and `DnsPublication` are stable v0.4 APIs.
- `bun run check:v04:scorecard` evaluates 23 versioned criteria spanning architecture, stable APIs, authority, effect isolation, durability, runtime safety, Rust quality, the longitudinal example, performance, documentation, and release evidence.
- Every declared criterion currently has executable evidence. The scorecard explicitly distinguishes evidence coverage from subjective product maturity.
- Rust release gates require `cargo fmt --all -- --check`, workspace/all-target Clippy with warnings denied, and the complete Rust workspace test suite.
- Clean npm adoption is documented in `docs/npm-first-run.md` and verified through all coordinated packed packages.

## Local Verification

The final candidate must pass:

```sh
bun run check:v04:local
bun run check:v041:performance
bun run check:rust
bun run check:package-audit
```

The last pre-version candidate verification passed TypeScript typechecking, lint and release checks, 99 focused v0.4 contract tests with 18 explicit opt-in skips, 20 implemented character tests, all nine packed-package/consumer checks, 129 Rust tests, Rust formatting and warning-free Clippy, and every executable scorecard criterion.

## Live Verification

The candidate live suites use the guarded `orbstack` context:

```sh
bun run check:v04:prerelease:orbstack
```

The latest pre-version run passed the unified Tenant Platform durable-behavior suite in both tested behavior cases and passed the Kubernetes SDK WASM boundary suite. Infrastructure teardown uses TypeKro factory deletion for the KRO application and direct NATS installation. The harness waits for owned resources and only applies the bounded OrbStack/K3s namespace-finalizer fallback after independently proving the namespace contains no remaining resource types.

## Exact-Commit Release Gate

The manual Release Evidence workflow writes an attestation containing the commit, workflow run, cluster context, suite, and generation time after the complete live suite succeeds. It uploads an artifact named `applik8s-v0.4-live-<commit>` with fourteen-day retention.

The tag/publish workflow resolves the successful Release Evidence run through the GitHub Actions API, downloads the artifact, validates its schema and exact commit, and refuses npm/GHCR/GitHub publication when the attestation is missing, stale, malformed, or refers to another commit.

## Publication Completion

After the candidate commit is pushed:

1. Run Release Evidence with `run_live_e2e=true` for that exact commit.
2. Push tag `v0.4.3` without changing the commit.
3. Wait for coordinated npm packages, the multi-architecture operator host, clean published-consumer verification, and the GitHub release.
4. Run `APPLIK8S_PUBLISHED_VERSION=0.4.3 bun run check:published-release:orbstack` and record the final workflow and image digest here.

