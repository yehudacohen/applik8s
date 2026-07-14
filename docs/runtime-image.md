# Runtime Image

Generated operators run a compiled WASM handler inside the published Rust operator host.

## Published Host Contract

Starting with v0.4.2, the compiler defaults to a public, immutable operator-host reference under:

```text
ghcr.io/yehudacohen/applik8s-operator-host
```

For v0.5.0 the compiler records the matching immutable semver tag. The release workflow publishes and anonymously verifies its multi-platform manifest before publishing npm packages, then records the resolved `sha256` digest in release evidence. This ordering avoids requiring the compiler package to predict the digest of a host image built from the same release tag. Generated Dockerfiles declare the tag as the default `APPLIK8S_BASE_IMAGE` build argument; builds may deliberately override it.

The release image is published for:

- `linux/amd64`
- `linux/arm64`

The image workflow publishes OCI source/version/revision labels, a BuildKit provenance attestation, and an SBOM attestation. Applik8s does not yet claim signature or admission-policy enforcement.

## Runtime Hardening

Generated operator images and Deployments run as numeric uid/gid `65532`. The shared host build selects that identity when run directly, and generated Dockerfiles and Deployments retain the same identity. Generated Deployments set:

- `runAsNonRoot`, an explicit uid/gid, and `RuntimeDefault` seccomp
- no privilege escalation
- a read-only root filesystem
- all Linux capabilities dropped
- a writable `emptyDir` mounted only at `/tmp` for replay artifacts and runtime scratch data

The v0.4.2 host build's Rust and Debian base indexes are digest-pinned. The generated handler image copies artifacts with uid/gid `65532` ownership and restores the non-root user after its build steps.

## Generated Build

After compiling:

```sh
docker build \
  -f dist/applik8s/Dockerfile.applik8s-runtime \
  -t applik8s/image-pipeline-operator:dev \
  dist/applik8s
```

To test a locally built host while preserving the compiler's release default:

```sh
docker build -f Dockerfile.operator-host -t applik8s-operator-host:dev .
docker build \
  --build-arg APPLIK8S_BASE_IMAGE=applik8s-operator-host:dev \
  -f dist/applik8s/Dockerfile.applik8s-runtime \
  -t applik8s/image-pipeline-operator:dev \
  dist/applik8s
```

`APPLIK8S_BASE_IMAGE` provides the same explicit override when using the generated `apply.sh`.

## Release Verification

The tag-driven workflow publishes the host before npm packages. It then installs the released npm package into an empty directory, compiles an operator, anonymously resolves the public host tag to its digest, and builds the generated operator image before creating the GitHub release.

Run the same released-artifact proof against OrbStack with:

```sh
APPLIK8S_PUBLISHED_VERSION=0.5.0 bun run check:published-release:orbstack
```

The live script refuses to mutate a cluster unless the current kubectl context exactly matches `orbstack`. It deploys the generated CRD/controller, observes a real reconciliation status write, and cleans up its namespace and CRD.

## Remaining Boundary

Generated manifests record bundle, source, compiler, runtime, handler ABI, host-import, and image identity metadata. SBOM/provenance are now emitted for the shared host, but signature verification and cluster admission enforcement remain future work. The npm compiler dependency boundary is documented separately in `docs/build-supply-chain.md`.
