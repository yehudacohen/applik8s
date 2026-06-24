# CRD Schema Evolution

`applik8s` currently treats generated CRDs as single-storage-version resources unless a future release implements Kubernetes conversion-webhook support.

## Current Contract

- Generated manifests record each owned CRD `versions` list and `storageVersion`.
- Manifest validation fails if `storageVersion` is not present in `versions`.
- Manifest generation currently fails closed unless each owned CRD has exactly one version, exactly one storage version, and `conversionStrategy: none`.
- Generated manifests record CRD posture metadata: single-version, no conversion webhook, no storage migration required, and rollback safety limited to schema-compatible changes.
- Generated Kubernetes and TypeKro resources mirror CRD posture and uninstall/domain-data policy through `applik8s.dev/*` annotations for policy and audit tooling.
- The compiler fails closed on schema forms that cannot be represented as Kubernetes structural OpenAPI.
- Structural validation rejects unsupported composition keywords, tuple arrays, arrays without item schemas, malformed `nullable`, `required` fields missing from `properties`, unsafe schema defaults, empty nested object schemas without properties/map semantics, invalid `additionalProperties`, and unsupported Kubernetes list-map extension shapes.
- Generated status-convention schemas include `observedGeneration` and Kubernetes map-list `conditions` when runtime-authored status is enabled.
- API-server-backed CRD schema acceptance e2e verifies generated CRDs against Kubernetes server-side dry-run.

## Not Yet Supported

- Conversion webhooks.
- Multi-storage-version migration workflows.
- Multi-version CRDs.
- Rollback guarantees across incompatible schema changes.
- Automatic stored-version migration.
- Kubernetes defaulting semantics for CRD fields; `default` fails closed until pruning/defaulting behavior is explicit and tested.

## Required Before Multi-Version CRDs

Before `applik8s` allows production multi-version CRDs beyond simple served/storage metadata, the implementation must add:

- explicit conversion strategy metadata in generated manifests.
- compatibility fixtures for old bundle/new host and new bundle/old object state.
- API-server-backed tests for served versions, storage version, and conversion failure behavior.
- rollback rules that refuse to imply safety when stored object data or external effects cannot be downgraded.
- admission-facing annotations that describe CRD version and conversion posture.

The safe rule today is: schema evolution is explicit and conservative; unsupported conversion semantics are not silently generated.
