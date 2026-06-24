# Kubernetes Compatibility

v0.1 compatibility is evidence-based and intentionally narrow.

## Tested v0.1 Target

- Local cluster: OrbStack Kubernetes
- Context used for release-candidate live evidence: `orbstack`
- Server version captured during this pass: `v1.33.5+orb1`
- Client version captured during this pass: `v1.32.7`

The live release gates exercise CRDs, structural OpenAPI acceptance, server-side apply, status subresources, Events, finalizers, RBAC, Leases, generated Deployments, and runtime pod logs against that target.

## v0.1 Support Statement

For v0.1, treat Kubernetes compatibility as validated for the release-evidence target above. Other local Kubernetes distributions and versions may work if they support the same stable Kubernetes APIs, but they are not part of the v0.1 release evidence until a matrix run is captured.

## Not Yet Claimed

v0.1 does not yet claim:

- a minimum Kubernetes version across distributions
- managed-cluster compatibility
- multi-version compatibility matrix coverage
- upgrade or rollback safety across Kubernetes minor versions

Before broadening this statement, add matrix evidence for CRD schema acceptance, server-side apply, status subresources, Events, finalizers, Leases, and RBAC behavior.
