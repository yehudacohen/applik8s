# Test Taxonomy

Tests are named by intent so normal local runs, roadmap checks, and cluster checks stay separate.

- `*.character.test.ts`: executable roadmap promises. These are intentionally allowed to fail until implementation catches up.
- `*.vertical.test.ts`: passing in-process product slices that cross package boundaries without a Kubernetes cluster.
- `*.proxy.test.ts`: passing focused proxy semantics tests.
- `*.e2e.test.ts`: opt-in local Kubernetes tests, including OrbStack.
- Rust crate-level `tests/*.rs`: contract and integration behavior for Rust crates.

`bun run lint` enforces the TypeScript test suffixes with `scripts/check-test-taxonomy.mjs`.

Default Vitest includes implemented vertical and proxy tests. Character tests are the executable roadmap and run explicitly with `bun run test:character`. E2E tests use `vitest.e2e.config.ts` and are run explicitly with `bun run test:e2e` or `bun run test:e2e:orbstack`.

Environment-gated live tests self-skip until their credentials or infrastructure are present:

- `packages/billing-stripe/test/stripe.live.vertical.test.ts` runs the real Stripe API acceptance path only when `STRIPE_SECRET_KEY` starts with `sk_test` and `STRIPE_PRICE_ID` starts with `price_` (the `.env` placeholders keep dry-runs deterministic and skipped).
- `packages/e2e/test/function-native-generated-worker-live.e2e.test.ts` and `packages/e2e/test/causal-chain-generated-worker-live.e2e.test.ts` run compiler-emitted workers against real PostgreSQL when `APPLIK8S_V07_FUNCTION_NATIVE_WORKER_DATABASE_URL` / `APPLIK8S_V07_CAUSAL_CHAIN_DATABASE_URL` are set. The causal-chain variant proves the initiating human survives the generated processor hop durably.

# Public Exports

Each workspace package has its own `package.json` with a single public `.` export pointing at `src/index.ts`.
Implementation submodules should stay internal unless they are intentionally re-exported from that index.
