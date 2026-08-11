# AGENTS.md

applik8s: TypeScript framework for building applications on the Kubernetes control plane. TypeScript authoring APIs (packages/) are compiled to WASM components executed by a Rust operator host (crates/). Active release line is v0.7; see `goal.md` and `docs/charter-v07-agentic-platform.md`. CI on PRs runs `bun run check:v06:local`.

## Setup and toolchain

- Bun 1.3.13 is the package manager (`bun install --frozen-lockfile`), never npm.
- Rust workspace (`crates/`) uses edition 2024 and needs a current stable toolchain. Rust owns Kubernetes runtime behavior (watches, plan validation, apply); TypeScript owns authoring, compiler contracts, and generated artifacts.
- Biome linter only — formatter is disabled. Do not run `biome format`; match surrounding style.
- `.env` holds real secrets (STRIPE_*, STIMP_*, OPENROUTER_API_KEY). Never commit or print them.

## Test taxonomy (enforced by `lint`)

- `*.vertical.test.ts` / `*.proxy.test.ts`: default Vitest; in-process, no cluster.
- `*.character.test.ts`: executable roadmap promises, run explicitly with `test:character`; may intentionally fail until implemented.
- `*.e2e.test.ts`: opt-in cluster tests via `vitest.e2e.config.ts`; never run by default.
- No other `.test.ts` suffixes are allowed (`scripts/check-test-taxonomy.mjs`).

## Commands

```sh
bun run typecheck            # whole workspace, uses tsconfig.json path aliases
bun run lint                 # biome + check-typecasts + check-static-imports + check-test-taxonomy
                             # + check:runtime-contract + check:docs-consistency + check:release
bun run test:implemented     # sharded vitest (sequential, maxWorkers=1); runs build:packages first
bun run test:character       # roadmap tests
bun run check:rust           # cargo fmt --check + clippy -D warnings + cargo test
bun run check:local          # the full local gate: typecheck, lint, test:implemented, test:character, rust
bun run check:v06:local      # what CI runs; superset of check:local
bun run build:packages       # tsc emit into .package-build then copy to packages/*/dist
bun run applik8s build <entry.ts> --typekro --composition-name <name> --out-dir <dir>   # CLI entry
```

- Many gates (`test:implemented`, `test:v0X:contracts`, `check:v0X:...`) run `build:packages` first. If you run vitest directly after editing a workspace package's src, `vitest.workspace-aliases.ts` resolves `@applik8s/*` to source, so no build is needed for vertical tests.
- `test:implemented` shards by default 16 shards / 1 worker (`APPLIK8S_TEST_SHARDS`, `APPLIK8S_TEST_MAX_WORKERS`) and excludes `packages/compiler/test/application-workflows.vertical.test.ts` from shards, running it separately — compiler tests are heap-heavy, keep that split.

## E2E / cluster tests

- Require a local cluster (OrbStack) and explicit opt-in: `APPLIK8S_E2E=1 APPLIK8S_E2E_CONTEXT=orbstack bun run test:e2e`. `APPLIK8S_E2E_LIVE=1` enables tests that exercise the real operator host against the cluster. These mutate the selected context — never run against a context that is not yours.
- E2E config defaults `APPLIK8S_BASE_IMAGE=ghcr.io/applik8s/applik8s-operator-host:dev` — live tests run against the locally built Rust host. Release gates set `TYPEKRO_LOG_LEVEL=fatal` to keep output readable.

## Generated artifacts and codegen

- `crates/applik8s-runtime-contract/generated/runtime-contract.json` is generated from `packages/runtime-contract/src/index.ts` (`bun run generate:runtime-contract`). After changing runtime contract code, regenerate; `lint` fails if out of sync.
- `packages/*/dist` is build output (created by `build:packages`); never edit.
- `examples/*/routeTree.gen.ts` and example `.applik8s`/`.output`/`dist` dirs are generated and excluded from lint.

## Package boundaries and public API

- `scripts/check-module-boundaries.ts` enforces strict allowed-dependency rules for `core`, `ai`, `ai-tanstack`, `identity`, and all `deployment-*` packages (checked in `check:v06:local`/`check:v07:local`). Adding an import to a protected package is a likely lint failure.
- Each package exposes a single `.` export from `src/index.ts` (plus intentional subpaths). A new subpath entrypoint must be added in three places: the package's `exports` in `packages/*/package.json`, `tsconfig.json` `paths`, and `vitest.workspace-aliases.ts` — where subpaths must be listed before their umbrella `@applik8s/*` entry or vertical tests silently diverge from live tests.
- Public API changes need tests, docs, release notes, and `BACKLOG.md` roadmap updates (`docs/maintainer-policy.md`); throwing placeholders are not acceptable public contracts.

## Docs that matter

- `TESTING.md` (test taxonomy), `RECONCILIATION_CONTRACT.md`, `docs/commands.md`, `docs/workflows.md`, `docs/maintainer-policy.md`, `BACKLOG.md` (milestone tags), `RELEASE_NOTES.md`.
