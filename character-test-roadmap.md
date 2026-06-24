# Character Test Roadmap

This roadmap turns the public `applik8s` developer experience into executable product requirements.

Character tests should read like product promises. They should prove user-recognizable behavior across package boundaries rather than implementation details inside one helper.

## Test Philosophy

- Write tests as examples users would recognize.
- Prefer full product stories over isolated implementation details.
- Keep generated output assertions structural unless exact output is part of the public contract.
- Use hard tests where the system crosses boundaries: SDK to compiler, compiler to runtime, runtime to Kubernetes plans, TypeKro to applik8s, and local harness to generated artifacts.
- Do not add private strategy, private research, multi-cluster application movement, or disaster-recovery scenarios to public v0.1 character tests.

## Proposed Test Layout

- `packages/sdk/test/*.character.test.ts` for public SDK authoring behavior.
- `packages/compiler/test/*.character.test.ts` for build-pipeline and artifact behavior.
- `packages/runtime/test/*.character.test.ts` for ABI, invocation, plan application, failure, replay, and observability behavior.
- `packages/testing/test/*.character.test.ts` for local test harness behavior.
- `packages/typekro-adapter/test/*.character.test.ts` for TypeKro consumption and operation targets.
- `examples/test/*.character.test.ts` for full user-facing product stories that span packages.
- `packages/e2e/test/*.e2e.test.ts` for opt-in local-cluster validation against an explicitly selected Kubernetes context.

## v0.1 Product Stories

The required public v0.1 story is ImageJob:

- define a typed `ImageJob` CRD
- write proxy-first reconcile and finalize handlers
- test schema, RBAC, finalizers, operation plans, status, events, and requeue locally
- build generated artifacts into `dist/applik8s`
- inspect CRDs, RBAC, ServiceAccount, Deployment, runtime manifest, source maps, Dockerfile, and apply script
- install through plain Kubernetes YAML
- install through TypeKro composition
- create an `ImageJob` instance through the generated TypeKro CRD factory

## Local Cluster E2E Tests

Character tests define product promises, but they do not prove generated operators work on Kubernetes.

The local E2E suite should be run explicitly with `bun run test:e2e:orbstack` when OrbStack's Kubernetes context is available, or `bun run test:e2e` with `APPLIK8S_E2E_CONTEXT` set for another local cluster.

The first E2E vertical slice should validate:

- the requested `kubectl` context is active
- generated CRDs, RBAC, ServiceAccount, ConfigMap, and Deployment YAML apply successfully
- the generated runtime Deployment becomes ready
- a sample custom resource can be created
- the operator reconciles it and writes the expected status
- the operator applies at least one expected Kubernetes resource
- namespace cleanup is automatic and does not delete user namespaces

## v0.1 Safety Tests

Public character and vertical tests should keep proving these boundaries:

- unsupported schemas fail before artifact emission
- unsupported compiler options fail or are explicitly documented
- undeclared RBAC fails before effects
- finalizer ownership is enforced
- malformed operation plans fail before effects
- handler timeout and cancellation are surfaced in diagnostics
- incompatible manifest, runtime, handler ABI, and host-import declarations fail closed
- TypeKro synthesis uses the same schema and runtime gates as plain YAML
- unsupported package/distribution channels are not implied by public APIs

## Public Release Rule

The public v0.1 character suite must stay limited to applik8s itself. Internal research scenarios belong outside the public release surface until they are intentionally announced as their own product.
