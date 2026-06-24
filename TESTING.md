# Test Taxonomy

Tests are named by intent so normal local runs, roadmap checks, and cluster checks stay separate.

- `*.character.test.ts`: executable roadmap promises. These are intentionally allowed to fail until implementation catches up.
- `*.vertical.test.ts`: passing in-process product slices that cross package boundaries without a Kubernetes cluster.
- `*.proxy.test.ts`: passing focused proxy semantics tests.
- `*.e2e.test.ts`: opt-in local Kubernetes tests, including OrbStack.
- Rust crate-level `tests/*.rs`: contract and integration behavior for Rust crates.

`bun run lint` enforces the TypeScript test suffixes with `scripts/check-test-taxonomy.mjs`.

Default Vitest includes implemented vertical and proxy tests. Character tests are the executable roadmap and run explicitly with `bun run test:character`. E2E tests use `vitest.e2e.config.ts` and are run explicitly with `bun run test:e2e` or `bun run test:e2e:orbstack`.

# Public Exports

Each workspace package has its own `package.json` with a single public `.` export pointing at `src/index.ts`.
Implementation submodules should stay internal unless they are intentionally re-exported from that index.
