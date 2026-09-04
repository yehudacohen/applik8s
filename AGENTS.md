# AGENTS.md

applik8s: TypeScript framework for describing distributed applications as one typed application graph. TypeScript authoring APIs (`packages/`) compile into Node workloads and WASM reconciliation components executed by the Rust operator host (`crates/`). Active release line is v0.9; see `goal.md`, `docs/v0.9-manifesto.md`, and `docs/v0.9-public-contract.json`. The exact local CI aggregate is `bun run check:v09:ci`.

## Setup and toolchain

- Bun 1.3.13 is the package manager (`bun install --frozen-lockfile`), never npm.
- Rust workspace (`crates/`) uses edition 2024 and needs a current stable toolchain. Rust owns Kubernetes runtime behavior (watches, plan validation, apply); TypeScript owns authoring, compiler contracts, and generated artifacts.
- Biome linter only — formatter is disabled. Do not run `biome format`; match surrounding style.
- `.env` may hold real provider credentials and application secrets. Never commit, inspect, or print them.

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
bun run check:local          # historical general local gate
bun run check:v09:ci         # exact v0.9 static, package-consumer, docs, evidence, and Rust gate
bun run build:packages       # tsc emit into .package-build then copy to packages/*/dist
bun run applik8s build <entry.ts> --typekro --composition-name <name> --out-dir <dir>   # CLI entry
```

- Many gates (`test:implemented`, `test:v0X:contracts`, `check:v0X:...`) run `build:packages` first. If you run vitest directly after editing a workspace package's src, `vitest.workspace-aliases.ts` resolves `@applik8s/*` to source, so no build is needed for vertical tests.
- `test:implemented` shards by default 32 shards / 1 worker (`APPLIK8S_TEST_SHARDS`, `APPLIK8S_TEST_MAX_WORKERS`) and runs the artifact, reactive, and workflow compiler monoliths in bounded fresh-process groups — compiler tests retain generated ESM graphs, so keep those splits.

## E2E / cluster tests

- Require a local cluster (OrbStack) and explicit opt-in: `APPLIK8S_E2E=1 APPLIK8S_E2E_CONTEXT=orbstack bun run test:e2e`. `APPLIK8S_E2E_LIVE=1` enables tests that exercise the real operator host against the cluster. These mutate the selected context — never run against a context that is not yours.
- E2E config defaults `APPLIK8S_BASE_IMAGE=ghcr.io/applik8s/applik8s-operator-host:dev` — live tests run against the locally built Rust host. Release gates set `TYPEKRO_LOG_LEVEL=fatal` to keep output readable.

## Generated artifacts and codegen

- `crates/applik8s-runtime-contract/generated/runtime-contract.json` is generated from `packages/runtime-contract/src/index.ts` (`bun run generate:runtime-contract`). After changing runtime contract code, regenerate; `lint` fails if out of sync.
- `packages/*/dist` is build output (created by `build:packages`); never edit.
- `examples/*/routeTree.gen.ts` and example `.applik8s`/`.output`/`dist` dirs are generated and excluded from lint.

## Package boundaries and public API

- `scripts/check-module-boundaries.ts` enforces strict allowed-dependency rules for portable contracts, maintained feature modules, runtimes, browser adapters, and all `deployment-*` packages. Adding an import to a protected package is a likely lint failure.
- Maintained feature packages use `@applik8s/applik8s/provider-extension-runtime` for provider metadata. Those extension seams are intentionally absent from the umbrella root used by application authors.
- Each package exposes a single `.` export from `src/index.ts` (plus intentional subpaths). A new subpath entrypoint must be added in three places: the package's `exports` in `packages/*/package.json`, `tsconfig.json` `paths`, and `vitest.workspace-aliases.ts` — where subpaths must be listed before their umbrella `@applik8s/*` entry or vertical tests silently diverge from live tests.
- Public API changes need tests, docs, release notes, and `BACKLOG.md` roadmap updates (`docs/maintainer-policy.md`); throwing placeholders are not acceptable public contracts.

## Docs that matter

- `TESTING.md` (test taxonomy), `RECONCILIATION_CONTRACT.md`, `docs/commands.md`, `docs/workflows.md`, `docs/maintainer-policy.md`, `BACKLOG.md` (milestone tags), `RELEASE_NOTES.md`.
