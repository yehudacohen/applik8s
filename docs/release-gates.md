# Release Gates

v0.1 release readiness has two layers: local gates and pre-release live gates.

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
- version `0.1.0`
- Apache-2.0 license metadata
- public publish config
- no `file:` dependency ranges in publishable packages
- required public docs exist
- public release files do not contain private branding or excluded product terms
- internal-only package paths are absent from the public tree

## Pre-Release Gates

Run against an explicitly selected local Kubernetes context:

```sh
APPLIK8S_RELEASE_LIVE_E2E=1 APPLIK8S_E2E_CONTEXT=orbstack bun run check:prerelease
```

This runs local gates and then live E2E suites for:

- generated artifacts
- CRD schema acceptance
- live reconcile
- TypeKro deploy
- live adversarial behavior
- partial operation failure

The selected context is mutated. Do not use a shared or production cluster.

## Skipping Live E2E

For local development only, live E2E may be skipped explicitly:

```sh
APPLIK8S_RELEASE_ALLOW_SKIP_LIVE_E2E=1 bun run check:prerelease
```

Do not use this for an actual v0.1 release announcement.

## Required Evidence For v0.1

Before announcing v0.1, capture:

- local gate output
- pre-release live gate output with context name
- generated `dist/applik8s` artifact listing
- generated runtime image build/publish decision
- release notes diff
- package publish dry-run output
- updated `docs/release-evidence-v0.1.md`

## CI Evidence

- `.github/workflows/ci.yml` runs local gates and package publish dry-run for normal repository changes.
- `.github/workflows/release-evidence.yml` is a manual release-candidate workflow that builds `dist/applik8s`, uploads generated artifacts, and can run live prerelease gates when a base64 kubeconfig secret and `APPLIK8S_E2E_CONTEXT` variable are configured.
- `.github/workflows/deploy.yml` follows the TypeKro release pattern: tag pushes run release gates, build and upload evidence artifacts, publish npm packages through OIDC trusted publishing, and create a GitHub release from `RELEASE_NOTES.md`.

## Publishing

Publishing is tag-driven. Push a tag such as `v0.1.0` to run the deploy workflow. The workflow requires npm trusted publishing to be configured for each `@applik8s/*` package and this repository workflow.

Local publish command, for maintainers only:

```sh
bun run publish:packages
```

Do not run local publishing unless package ownership and npm authentication are intentionally configured. Prefer the tag-driven GitHub Actions OIDC path.
