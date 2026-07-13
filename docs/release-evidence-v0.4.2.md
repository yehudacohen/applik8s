# v0.4.2 Release Evidence

Evidence date: 2026-07-13

Live context: `orbstack`

## Operator Host Distribution

The bootstrap [operator-host workflow run](https://github.com/yehudacohen/applik8s/actions/runs/29245288415) built the released v0.4.1 host natively on GitHub's amd64 and arm64 runners and assembled this public OCI index:

```text
ghcr.io/yehudacohen/applik8s-operator-host:v0.4.1@sha256:467f3e36eab0509c738025f9ea3e117320d9af3843eba9e5d3ac451c625b7869
```

The index contains `linux/amd64` and `linux/arm64` manifests plus their BuildKit attestations. An anonymous GHCR pull token returned the same digest with HTTP 200. The bootstrap run's builds and manifest assembly succeeded; its obsolete package-visibility API call returned 404 after publication. The release workflow now relies on the public repository's inherited package visibility and fails unless an anonymous manifest request and unauthenticated Buildx inspection both succeed.

The compiler records the tagged index and digest in one exported default. Generated Dockerfiles retain it as the `APPLIK8S_BASE_IMAGE` default while allowing an explicit local/test build-argument override.

## Clean Consumer and OrbStack Proof

`bun run check:release-candidate:orbstack`:

- built and packed all nine v0.4.2 packages
- installed those tarballs into an empty npm project with lifecycle scripts disabled
- compiled an operator through the packed `applik8s` executable
- verified the manifest and generated Dockerfile use the public digest-pinned host
- pulled the host and built the generated operator image
- deployed the generated CRD, RBAC, and controller to OrbStack
- created a real `Work` object and observed `status.phase=Ready`
- deleted the instance before its controller, removed generated resources, and proved the disposable CRD and namespace contained no instances/resources before applying the bounded OrbStack/K3s finalizer fallback
- left neither `applik8s-release-smoke` nor `works.smoke.applik8s.dev` behind

The live proof uses a hard context guard and refuses to mutate a cluster unless the current context exactly matches `orbstack`.

## Runtime and Deployment Hardening

- Rust and Debian bases in the v0.4.2 operator-host build recipe are digest-pinned.
- Generated operator images and Deployments select uid/gid `65532`; the v0.4.2 host build also selects that identity when run directly.
- Generated Deployments require non-root execution, `RuntimeDefault` seccomp, no privilege escalation, a read-only root filesystem, and all capabilities dropped.
- Only `/tmp` is writable, through an `emptyDir` used for replay artifacts and runtime scratch data.
- The complete Rust workspace passed, including 94 operator-host contract tests, 23 component bridge tests, and the remaining runtime suites.

## Package and Dependency Evidence

`bun run check:packages` passed for nine `0.4.2` tarballs, 16 public entrypoints, the packed executable, the v0.4 command/EventLog graph, and a clean-directory CLI build.

`bun run check:package-audit` passed against the expiring reviewed baseline:

```text
7 source advisories; 12 propagated package findings
6 critical, 1 high, 5 moderate
```

These are build-control-plane findings rooted in TypeKro/CEL dependencies and ComponentizeJS/weval archive extraction; they are not installed in the generated runtime image. The gate fails on a new advisory, severity/dependency drift, stale entries, or expiry. Containment and upstream remediation are documented in `build-supply-chain.md`.

## Released Artifact Evidence

The [v0.4.2 deploy run](https://github.com/yehudacohen/applik8s/actions/runs/29249224962) completed the coordinated npm publication, multi-platform host publication, clean registry-consumer build, and GitHub release. The released host index is:

```text
ghcr.io/yehudacohen/applik8s-operator-host:v0.4.2@sha256:be9fee0c214770d9def355083f039d311a6f95d01b6cc3de06da64a34f01e044
```

The exact published packages and host then passed `APPLIK8S_PUBLISHED_VERSION=0.4.2 bun run check:published-release:orbstack`, including a real reconcile and bounded lifecycle cleanup. Future v0.4 releases additionally require an unexpired successful live Release Evidence artifact for the exact commit before the tag workflow can publish.
