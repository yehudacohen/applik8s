# Character Test Roadmap

This roadmap turns the public `applik8s` developer experience into executable product requirements.

Character tests should read like product promises. They should prove user-recognizable behavior across package boundaries rather than implementation details inside one helper.

## Test Philosophy

- Write tests as examples users would recognize.
- Prefer full product stories over isolated implementation details.
- Keep generated output assertions structural unless exact output is part of the public contract.
- Use hard tests where the system crosses boundaries: SDK to compiler, compiler to runtime, runtime to Kubernetes plans, TypeKro to applik8s, and local harness to generated artifacts.
- Do not add private strategy, private research, multi-cluster application movement, or disaster-recovery scenarios to public v0.1 character tests.
- Post-v0.1 character tests may cover applik8s v0.2 TypeKro integration explicitly when that milestone is the intended product surface.

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

## applik8s v0.2 TypeKro Product Stories

The required v0.2 TypeKro story is one package for infrastructure composition and event handlers:

- install `@applik8s/applik8s` as the only user-facing applik8s package
- import `typeKro` from `@applik8s/applik8s`
- import `kubernetesComposition` from `@applik8s/applik8s`
- import TypeKro factories from `@applik8s/applik8s/factories`
- call an applik8s `operator(...)` result directly inside applik8s `kubernetesComposition(...)` to install that operator
- use the returned install binding to create operator CRD instances through generated factories such as `pipeline.imageJob(...)`
- attach instance-scoped handlers to generated CRD instances through `pipeline.imageJob(...).on.reconcile(handler)` or `.on.updated(handler)` inside the wrapped composition
- add generated-CRD handlers outside the original `sdk.operator({ handlers: [...] })` block and verify they are grouped into the right generated operator rather than becoming hidden globals
- compose status from the generated CRD instances through TypeKro-visible status expressions
- verify compile-time lowering turns direct operator calls into ordinary applik8s install artifacts and fails with actionable diagnostics when required artifacts are missing
- define TypeKro resource bridges with `typeKro.resource(factory, options)`
- create TypeKro resource instances and attach instance listeners through `resource.on.updated(handler)`
- group listeners by an enclosing applik8s-wrapped `typeKro.kubernetesComposition(...)`
- override grouping through `resource.on.updated(operator, handler)`
- declare finite listener scopes through `Resource.instances([...]).on.event(handler)`
- declare selector listener scopes through `Resource.where(selector).on.event(handler)`
- declare mixed-resource listener groups through `typeKro.resources([...]).on.event(handler)`
- verify generated manifests emit watched external resources, scoped watches, inferred RBAC, handler exports, and no owned CRDs for external TypeKro resources
- verify runtime handler routing respects exact addresses, finite address sets, selectors, and duplicate-scope diagnostics
- verify TypeKro operation targets still work from applik8s handlers with apply/delete ordering and RBAC inference
- build the GuestBook flagship as a TypeKro-native application composition
- verify direct callable operator install lowering contributes CRDs, RBAC, generated CRD factories, generated server resources, indexer resources, aggregate workers, and status projections as ordinary TypeKro resources
- verify generated app servers infer resource/index bindings from app-scoped direct-call installs without hidden global registration
- verify route source metadata, route bundle inputs, source locations, route IDs, and route failure diagnostics are embedded in generated server artifacts
- verify `Resource.increment(...)` buffers page-view counters, emits get/create/patch RBAC, requeues failed flushes, and avoids per-request Kubernetes writes
- verify `Resource.index(...)` request paths are bounded by safe partition/filter semantics before Kubernetes access
- verify `app.aggregate(...)` commits object-store state only after reducer success and projects derived GuestBook status
- verify schema-first `entity(...)` can materialize as CRDs through `app.crd(entity, { apiVersion, ... })`
- verify `app.model(entity)` and `ModelStore` fail closed until real storage-backed model semantics are implemented

## applik8s v0.3 Substrate-Freeze Product Stories

The required v0.3 framework story is stable enough that a future workload-movement operator can depend on applik8s contracts without large rewrites after v0.3:

- define schema-first entities and materialize them as either CRDs or storage-backed models with explicit backend semantics
- bind app-scoped providers through `app.defaults(...)` and `app.provide(...)` using stable capability interfaces such as `ModelStore`, `IndexStore`, `CounterStore`, `EventSource`, `Secret`, `Queue`, `ObjectStorage`, `HttpExposure`, and credential material
- compile an app into an explicit app graph IR before emitting Kubernetes, TypeKro, generated runtime, RBAC, and diagnostics artifacts
- inspect generated artifacts and see the same app graph relationships represented in manifests, runtime metadata, route/job diagnostics, and provider dependencies
- define generated jobs for preflight, migration, cleanup, repair, and maintenance-style tasks without hand-authoring Deployments or one-off scripts
- model durable phase/status progress with observed generation, step status, retry policy, idempotency key, last successful step, terminal failure, blocked/progressing/ready/finalized conditions, and partial-failure diagnostics
- use stable operation-target contracts for `ctx.apply(ref)`, `ctx.delete(ref)`, TypeKro operation targets, dry-run/plan output, owner references, finalizers, and RBAC inference
- use stable watch/scope contracts for exact objects, finite object sets, label selectors, field selectors, mixed TypeKro resource groups, and external watched resources
- prove CRD/schema compatibility rules for v0.3-era domain CRDs without requiring conversion webhooks or stored-version migration in v0.3
- prove generated server, model, indexer, aggregate, counter, job, Kubernetes-client, diagnostics, and provider-adapter runtimes are modular artifacts or templates with focused tests rather than one monolithic DSL implementation
- publish a v0.3 compatibility boundary that marks stable public APIs, documented internal contracts, experimental seams, and post-v0.3 surfaces

## Post-v0.3 Workload Movement Product Stories

The required workload-movement story is a real operator built after the applik8s v0.3 framework foundation:

- install the workload-movement operator generated by applik8s
- define source and target environments as Kubernetes resources
- define workload selection and movement policy resources
- plan stateless workload movement before effects
- move supported stateless workloads with configuration, identity, networking, and dependency ordering preserved
- plan stateful workload movement before effects
- move supported stateful workloads with storage identity, PVC/PV or snapshot/data-transfer semantics, readiness checks, and abort/finalize behavior preserved
- expose dry-run movement plans, operation summaries, and per-workload status conditions
- watch selected source workloads and dependent resources through applik8s v0.2 TypeKro listener scopes
- render target resources through TypeKro/applik8s operation targets
- fail closed when an unsupported workload kind, storage mode, selector, RBAC permission, or movement phase is requested
- prove idempotent reruns, partial-failure diagnostics, finalizer cleanup, and safe abort behavior in local, vertical, generated-manifest, and live e2e tests

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

## v0.2 Safety Tests

The v0.2 character and vertical suites should add these boundaries:

- TypeKro factory re-exports do not import raw grouping-blind composition APIs in the integrated path
- listener scopes lower only to exact addresses, finite address sets, label selectors, field selectors, or generated-label semantics
- unsupported predicates fail before artifact emission
- external TypeKro resources are watched but not emitted as owned CRDs
- inferred RBAC covers every watched/read/applied/deleted/status/finalizer/event resource and fails closed when incomplete
- generated app-server route inference rejects computed resource access unless explicit permissions make the boundary unambiguous
- generated server source ConfigMaps are KRO-template-safe and fail closed if raw JavaScript template placeholders remain
- generated TypeKro apply scripts wait for KRO-created stack APIs before applying graph instances

## v0.3 Substrate-Freeze Safety Tests

The v0.3 character, vertical, generated-artifact, and live suites should add these boundaries:

- app graph IR is deterministic, inspectable, and stable across generated YAML, TypeKro resources, runtime metadata, and diagnostics
- provider bindings fail closed when a model, index, counter, event source, secret, queue, object storage, HTTP exposure, or credential requirement is missing or ambiguous
- model-backed entities expose storage, migration, constraint, index, transaction, retention, and query semantics without pretending they are portable to CRD-backed resources
- generated jobs are idempotent, restart-safe, permissioned, and observable through durable phase/status conditions
- operation targets preserve ordering, dry-run/plan output, owner/finalizer semantics, and RBAC inference across handlers, jobs, generated servers, and TypeKro resources
- watch scopes reject unlowerable predicates and route only exact, finite, selector, field-selector, or mixed-resource scopes that the manifest/runtime can enforce
- CRD/schema compatibility fixtures distinguish stable v0.3 rules from explicitly post-v0.3 conversion-webhook or stored-version migration support
- generated runtime modules share Kubernetes clients, diagnostics, source maps, and failure taxonomy instead of duplicating unsafe ad hoc clients
- post-v0.3 surfaces such as workload movement, generic workflow orchestration, broad provider ecosystems, Helm/OLM/OCI, and SLSA/SBOM/admission enforcement remain absent or explicitly experimental

## Post-v0.3 Workload Movement Safety Tests

The later workload-movement suites should add these boundaries:

- movement plans are inspectable before effects
- stateless and stateful movement phases are idempotent and restart-safe
- stateful movement refuses unsupported storage modes instead of silently degrading durability
- abort/finalize behavior leaves durable status and avoids deleting user data unless the spec explicitly requests it

## Public Release Rule

The public v0.1 character suite must stay limited to applik8s itself. Workload-movement scenarios belong in a later workload-movement milestone and should not be backported into v0.1 or v0.2 release promises.
