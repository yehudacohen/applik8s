# Runtime Image

Generated operators run a Rust host image plus the compiled handler artifacts.

## v0.1 Support Boundary

v0.1 supports local tutorial builds from `Dockerfile.applik8s-runtime`.

Generated YAML does not imply a floating production-grade image policy. Users should pin image tags or digests in GitOps workflows.

## Local Tutorial Image

After compiling:

```sh
bun run build:imagejob
docker build -f dist/applik8s/Dockerfile.applik8s-runtime -t applik8s/image-pipeline-operator:dev dist/applik8s
APPLIK8S_IMAGE=applik8s/image-pipeline-operator:dev dist/applik8s/apply.sh
```

## Published Image Decision

The v0.1 public tutorial path does not require a published runtime image. Generated artifacts include an image recipe and apply script so users can build and reference a local image explicitly.

Publishing `ghcr.io/applik8s/applik8s-operator-host:0.1.0` is allowed only if the release process builds, tests, documents, and pins it. Until then, published runtime images are not part of the v0.1 support promise.

## Digest Expectations

Generated manifests record bundle, source, compiler, runtime requirement, handler ABI, and host-import metadata. Image digest verification is metadata-only in v0.1 unless a release publishes signed artifacts and verification policy.

## Not Promised

v0.1 does not promise:

- automatic runtime image upgrades
- rollback safety across runtime or handler ABI changes
- SBOM/provenance enforcement
- image signature admission policy
- multi-architecture image availability unless explicitly published and tested
