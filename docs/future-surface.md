# Future Surface Decisions

v0.1 intentionally keeps the public surface narrow.

## Generated Typed Kubernetes Clients

v0.1 does not include generated typed Kubernetes clients beyond CRD factories and TypeKro CRD factory helpers.

Recommended v0.1 approach:

- use CRD factories to create typed custom resources
- let handlers return operation plans
- use generated YAML or TypeKro composition for installation

Generated clients are post-v0.1 work and need their own compatibility, auth, watch, cache, and status semantics.

## Admission Webhooks

v0.1 does not generate validating or mutating admission webhooks.

Recommended v0.1 approach:

- express schema constraints through CRD structural OpenAPI where possible
- fail closed during compile/generation for unsupported schema semantics
- keep reconciliation-time validation explicit in handlers and status

Webhook generation is post-v0.1 work because it needs TLS, deployment, ordering, failure policy, upgrade, and compatibility semantics.

## `applik8s dev`

v0.1 does not include a long-running watch/build/deploy development loop.

Use:

```sh
bun run build:imagejob
```

Then apply or test generated artifacts explicitly.

## `applik8s package`

v0.1 does not include a packaging command for Helm, Kustomize, OLM, or OCI bundles.

The supported packaging surface is generated plain Kubernetes YAML plus TypeKro install composition.

## Extension And Plugin APIs

v0.1 does not expose a plugin API. New extension seams must first prove stable contracts through docs, tests, compatibility notes, and release notes.
