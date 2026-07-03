# v0.2 Release Evidence

This file packages the evidence needed before announcing v0.2. Keep it updated during each release-candidate pass; do not rely on chat logs as release evidence.

## Candidate

- Candidate: `v0.2.0`
- Flagship proof: `examples/guestbook.ts`
- Live context used for this pass: `orbstack`

## Local Evidence

Captured in this workspace pass:

- `bun run typecheck`
- `bun run build:guestbook`
- `bun run check:docs-consistency`
- `node scripts/check-typecasts.mjs`
- `bunx vitest run packages/applik8s/test/integrated-typekro.vertical.test.ts`
- `bunx vitest run packages/compiler/test/compiler-artifacts.vertical.test.ts`
- `bunx vitest run packages/applik8s/test/integrated-typekro.vertical.test.ts packages/compiler/test/compiler-artifacts.vertical.test.ts`
- `bunx vitest run packages/applik8s/test/integrated-typekro.vertical.test.ts packages/typekro-adapter/test/typekro-adapter.vertical.test.ts packages/compiler/test/compiler-artifacts.vertical.test.ts packages/sdk/test/handler-dispatch.vertical.test.ts`
- targeted `bunx biome check` for changed TypeScript and docs files
- `bun run check:release`
- `git diff --check`
- `bun run check:local`
- `bun run check:publish-dry-run`

## Live Evidence

Captured in this workspace pass:

```sh
APPLIK8S_E2E_LIVE=1 APPLIK8S_E2E_CONTEXT=orbstack bunx vitest run --config vitest.e2e.config.ts packages/e2e/test/typekro-guestbook.e2e.test.ts
```

```sh
APPLIK8S_RELEASE_LIVE_E2E=1 APPLIK8S_E2E_CONTEXT=orbstack bun run check:prerelease
```

The live GuestBook proof covers TypeKro install, generated CRDs, generated server, cached typed index reads, typed resource writes, buffered page-view counters, aggregate status projection, and generated RBAC/preflight behavior.

The full prerelease gate also covered local release checks, publish dry-run packaging, TypeKro deployment e2e, live adversarial reconciliation e2e, and live partial-operation-failure e2e.

## v0.2 Release Bar

- GuestBook is the v0.2 pressure test.
- Broad workload movement is not a v0.2 release gate; it moves after the v0.3 foundation work.
- Public docs, package metadata, generated artifacts, and validation gates should describe `0.2.0` and the TypeKro-native GuestBook product slice consistently.
