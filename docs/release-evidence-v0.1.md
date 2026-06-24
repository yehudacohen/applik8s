# v0.1 Release Evidence

This file packages the evidence needed before announcing v0.1. Keep it updated during each release-candidate pass; do not rely on chat logs as release evidence.

## Current Candidate

- Candidate: `v0.1.0-rc1`
- Date: 2026-06-23
- Primary live context used locally: `orbstack`
- Runtime image posture: local tutorial image built from generated `Dockerfile.applik8s-runtime`; no published runtime image is claimed by default.

## Evidence Captured In This Pass

Local/static checks:

- Passed: `bun run check:local`
- Passed: `bun run typecheck`
- Passed: `bun run lint`
- Passed: `bun run check:docs-consistency`
- Passed: `bun run check:release`
- Passed: `bun run check:publish-dry-run`
- Passed: `bun run build:imagejob`
- Passed: `bunx vitest run packages/applik8s/test/cli.vertical.test.ts`
- Passed: `bunx vitest run packages/sdk/test/handler-dispatch.vertical.test.ts packages/testing/test/handler-proxy.proxy.test.ts`
- Passed: `bunx vitest run --config vitest.character.config.ts examples/test/product-stories.character.test.ts`

Full prerelease gate:

- Passed: `APPLIK8S_RELEASE_LIVE_E2E=1 APPLIK8S_E2E_CONTEXT=orbstack bun run check:prerelease`

Live focused proof:

- Passed: `APPLIK8S_E2E_LIVE=1 APPLIK8S_E2E_CONTEXT=orbstack bunx vitest run --config vitest.e2e.config.ts packages/e2e/test/readme-imagejob-live.e2e.test.ts`
- Live README proof uses the golden-path `job.k8s.ConfigMap(...)` handler surface.
- Cleanup verified: `namespace/media` absent after cleanup.
- Cleanup verified: `crd/imagejobs.media.applik8s.dev` absent after cleanup.

Package dry-run evidence:

- `@applik8s/applik8s`: 4 files, 12,846 bytes unpacked
- `@applik8s/core`: 12 files, 58,880 bytes unpacked
- `@applik8s/sdk`: 7 files, 83,249 bytes unpacked
- `@applik8s/compiler`: 16 files, 144,653 bytes unpacked
- `@applik8s/runtime-contract`: 2 files, 13,654 bytes unpacked
- `@applik8s/runtime`: 4 files, 4,809 bytes unpacked
- `@applik8s/testing`: 5 files, 55,608 bytes unpacked
- `@applik8s/typekro-adapter`: 5 files, 66,225 bytes unpacked
- `@applik8s/typetainer`: 2 files, 3,270 bytes unpacked

Generated `dist/applik8s` artifact listing:

- `apply.sh`
- `Dockerfile.applik8s-runtime`
- `operator-manifest.json`
- `bundle/handler-dispatcher.generated.ts`
- `bundle/handler.esbuild-meta.json`
- `bundle/handler.js`
- `bundle/handler.js.map`
- `contract/applik8s-handler.wit`
- `contract/runtime-contract.json`
- `kubernetes/customresourcedefinition-imagejobs.media.applik8s.dev.yaml`
- `kubernetes/deployment-image-pipeline.yaml`
- `kubernetes/role-image-pipeline-controller.yaml`
- `kubernetes/rolebinding-image-pipeline-controller.yaml`
- `kubernetes/serviceaccount-image-pipeline-controller.yaml`
- `wasm/handler.wasm`

## Required Before Announcement

- Review release notes and candidate file list.
- Create initial commit and push after review.
- If publishing packages, run `bun run check:publish-dry-run` immediately before publish.

## CI Evidence Path

- `.github/workflows/ci.yml` runs local gates and package dry-run on push, pull request, and manual dispatch.
- `.github/workflows/release-evidence.yml` runs local gates, package dry-run, builds `dist/applik8s`, uploads generated artifacts, and can optionally run live prerelease gates when `KUBECONFIG_B64` and `APPLIK8S_E2E_CONTEXT` are configured.
- `.github/workflows/deploy.yml` runs release gates on `v*` tags, uploads generated evidence, publishes packages through npm OIDC trusted publishing when package trust is configured, and creates the GitHub release.

## Supported Kubernetes Version Evidence

- Current local proof target: OrbStack Kubernetes through context `orbstack`.
- Server version captured during this pass: `v1.33.5+orb1`.
- Minimum Kubernetes version is not yet separately matrix-tested in CI; v0.1 describes Kubernetes compatibility as “tested against the release evidence context” until a version matrix is captured. See `docs/kubernetes-compatibility.md`.
