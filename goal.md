# Goal: Complete Chirp as the Harbor-backed Applik8s flagship

**Status:** In progress

**Prepared:** 2026-07-18; evidence refreshed 2026-07-21

**Primary specification:** [docs/rfp-scalable-chirp.md](docs/rfp-scalable-chirp.md)

**Execution target:** the local OrbStack Kubernetes cluster. A second cluster and multi-cluster qualification
are not required for this goal.

**Release rule:** do not tag, publish, or cut an Applik8s release until the completed work and evidence have
been reviewed explicitly.

## Objective

Finish the generic Applik8s and TypeKro capabilities required to make Chirp a coherent, installable social
application rather than a compile-time showcase. A single documented local command must bootstrap or reuse
the shared platform, build every Applik8s-authored workload as an immutable OCI image, push those images to a
private Harbor registry backed by Rook/Ceph, deploy a typed `ChirpInstallation` through TypeKro, wait for
authoritative readiness, and print the URL and useful diagnostics.

The deployed TanStack Start application must then pass real browser-level journeys and the complete
distributed path:

```text
browser action
  -> authenticated gateway
  -> durable result + PostgreSQL mutation + transactional outbox
  -> JetStream delivery
  -> bounded processor
  -> Valkey and/or ClickHouse projection
  -> SSE invalidation
  -> authoritative requery
  -> rendered browser update
```

The result must retain the architectural decisions in the Chirp RFP: one authority for every fact,
provider-neutral application code, bounded work, generated graphs rather than reconciliation-time graph
construction, direct TypeKro lifecycle operations, honest retention, and no framework primitive that exists
only for Chirp.

## What is already real

The current worktree is a substantial executable increment. Preserve and build on it.

| Area | Current evidence | Assessment |
| --- | --- | --- |
| Official web shape | `examples/chirp-start` is one official TanStack Start project producing browser, SSR, gateway, worker, operator, and TypeKro artifacts. | Implemented foundation |
| Domain authority | Fifteen promoted Drizzle models and one migration cover accounts, posts, relationships, bookmarks, notifications, media metadata, moderation, installation settings, and automation records. | Broad model foundation; incomplete product behavior |
| Durable behavior | Twenty-seven durable operations use PostgreSQL results, revisions, history, transactional outboxes, and idempotency keys. | Implemented substrate; API needs cleanup |
| Events and processing | Typed lifecycle/domain events, replayable streams, bounded stream processors, a Valkey online projection, and ClickHouse projections compile and run on OrbStack. | Executable processing foundation; recovery and full product topology remain incomplete |
| Query/UI bridge | Workload-scoped gateways, callable React mutations, SSR, resumable SSE invalidation, authoritative requery, and same-sequence multi-provider cursor handling pass the live golden path. | Live distributed path proven; complete browser journey coverage remains open |
| Installation graph | A typed `ChirpInstallation` RGD is emitted; its instance namespace is separated from the workload namespace; `spec.name` isolates namespaces, Harbor projects/robots, Secrets, direct-lifecycle receipts, and namespaced resources, while a bounded `spec.exposure.nodePort` isolates local exposure. Typed media, automation, and analytics feature switches omit their provider resources, workers, credentials, and readiness blockers. Two-spec materialization tests and an artifact-wide erased-namespace gate cover direct and KRO output. | Collision-safe bounded-instance shape with real optional branches; provider selection, backup, and full lifecycle policy remain incomplete |
| Status | `ready`, `phase`, `url`, `observedVersion`, artifact digest, normalized provider readiness, and conditions are hydrated by KRO. The deployer now verifies the projected URL from its own network boundary before reporting success. | Authoritative install/readiness contract is live; migration, lag, backup, and rollback detail remain open |
| OCI workloads | Every Applik8s-authored live workload is stored in Harbor and runs by verified `@sha256:` reference with a namespace-scoped pull Secret. Executable ConfigMaps are absent. Two consecutive deploys reused all 21 immutable receipts without rebuilding or pushing and preserved the installation UID, graph digest, and artifact-set digest. | Live incremental Harbor publication path implemented |
| Artifact size | The current root Chirp RGD remains within its tracked budget; the build emits 272 graph nodes and 401 TypeKro artifacts, including two condition-aware singleton prerequisite instances with TypeKro drift fingerprints. | Budgeted compact control-plane artifact |
| Storage boundary | TypeKro 0.28.1 supplies the released Rook/Ceph and Harbor integration; Applik8s prepares direct OBCs through recorded TypeKro lifecycle receipts. | Live local provider path exists; destructive retention qualification remains open |
| Providers | PostgreSQL, NATS/JetStream, Valkey, ClickHouse, Hatchet, Rook/S3, Harbor, local/external identity, authorization, and local/public exposure are materially generated; the core live data path is green. | Broad connected local profile; Ory/Zitadel and production exposure qualification remain open |
| Product UI | Home, profile, explore, notifications, bookmarks, automation, settings, and moderation routes build under the browser budget. Playwright proves no-reload posting, authoritative like removal/recreation and repost counts, a transactionally validated typed reply, principal-derived follow/unfollow, bookmark removal, accessible route hydration, profile update, idempotent automation configuration/suspension, and report-to-resolution moderation. | Usable flagship foundation; broader social journeys and failure states remain open |
| Verification | `bun run check:v06:chirp-build` passes with 272 graph nodes, 401 TypeKro artifacts, two prerequisite instances, a 296,938-byte RGD, 14,503,517 bytes of OCI contexts, and 124,479 gzip bytes of browser JavaScript. Fresh machine-readable OrbStack receipts prove three runtime/recovery/restart scenarios and nine browser journeys. The combined scorecard requires deployment, runtime, browser, datastore, and lifecycle receipts from one candidate and cluster. | Strong synthesis and durable golden-path evidence; rollback, destructive lifecycle, and production-provider qualification remain open |

## What is not done

The following are gaps, even when a related graph node or generated Deployment exists:

- installation identity, namespace, profile-derived capacity, exposure, media/automation/analytics feature
  switches, external provider references, backup, and retention policy drive the graph; `version` is observed,
  but a complete upgrade/failed-rollout/rollback policy is not yet qualified live;
- fixed workload names are isolated by installation-derived namespaces, Harbor project/robot identities,
  scoped lifecycle receipts, and explicit NodePorts; a live simultaneous-installation exercise is still required;
- no nested `app.install(...)` or hosted control-plane path has been proven;
- clean-from-zero Harbor/Rook bootstrap and retained-data lifecycle still need a repeatable destructive test;
- a complete NATS server/operator prerequisite chain is generated and live, but controller/provider-loss
  recovery still needs permanent coverage;
- `Post.homeTimeline` uses the Valkey online authority, relational views use PostgreSQL, and `Post.trending`
  queries the ClickHouse projection with bounded PostgreSQL hydration/fallback; Kubernetes and alternate
  analytical authority adapters still need product-level substitution evidence;
- the home timeline now reads a generation-aware Valkey projection with bounded authoritative relationship
  filtering, checksummed object-artifact rebuild, catch-up, atomic publication, rollback metadata, and explicit
  unavailable behavior; celebrity-policy load qualification and long-running repair evidence remain open;
- the Hatchet path now reconciles schedules, reserves quota, generates and validates bounded structured output,
  moderates and publishes through `Post.create`, records usage/results, uses an issued execution principal, and
  supports user and administrator suspension; production generation-provider outage qualification remains open;
- local header identity is useful for deterministic tests but Ory production and Zitadel substitution are
  not qualified;
- browser media uses bounded signed upload/download intents, size/type/checksum and signature validation,
  provider-side rejection, durable processing state, and credential-free delivery; multipart/transform policy,
  retained-object deletion semantics, and external-S3 qualification remain open;
- installation status exposes normalized provider readiness, artifact digest, migration, rollout, backup,
  projection, conditions, and degraded reasons; live failed-update/rollback evidence remains open;
- Chirp has build, contract, live OrbStack golden-path coverage, and durable Playwright coverage for nine
  principal journeys, including registration, posts/replies/quotes/reactions/bookmarks, relationships,
  verified media, profile/automation, administration, and moderation; complete notification/search/account-
  deletion and production-identity matrices remain open;
- there is no complete install, update, rollback, browser use, restart, rebuild, and TypeKro deletion receipt;
- production observability, load evidence, backup/restore, threat-model, and supply-chain gates remain open.

## Normative developer-experience amendment

The current RFP's event/action examples must be revised before implementation continues. `$model` is an
advanced metadata compatibility facet, not an ordinary application API. Stringly generic event registration
is not acceptable for known model lifecycle and named-action events.

The desired experience is:

```ts
export const Post = app.model(posts, {
  name: 'Post',
  database: Database,
});

Post.on.create('initialize-post', processorOptions, async (created, context) => {
  // created.value is the typed inserted Post snapshot.
});

Post.on.delete('remove-from-timelines', processorOptions, async (deleted, context) => {
  // deleted.previous and deleted.tombstone are inferred from Post.
});

ModerationPolicy.on.create('initialize-policy', reconcileOptions, async (policy, context) => {
  // policy.spec and policy.status are inferred from the CRD.
});

ModerationPolicy.on.update('apply-policy', reconcileOptions, async (change, context) => {
  // change.previous/current and resource metadata are typed.
});

await Post.create(input);
await Post.delete({ id: postId });
const timeline = await Post.homeTimeline({ limit: 50 });
```

No action declaration is required to obtain typed model lifecycle operations or their events. `Post.create`
is the durable mutation; `Post.on.create` reacts to its committed outcome. In Chirp, publishing a post is
normally creation of a `Post`, removing it is deletion or a typed state update, following is creation of a
`Follow`, and liking is creation of a `Like`. Model the domain fact directly instead of inventing a parallel
action vocabulary for CRUD-shaped behavior.

A genuinely non-CRUD operation may still receive a direct named method, but it is exceptional and declared
exactly once. Its callable method, input/result types, durable execution, and typed completion event must be
derived from that one declaration; ordinary lifecycle subscriptions must never depend on such a declaration.
The observable contract is:

- conventional mutations are direct `Model.create`, `Model.update`, and `Model.delete` operations when
  enabled, and require no `.actions({...})`, command registry, or duplicate schema;
- prefer a model lifecycle operation or a workflow/task for domain behavior; custom model verbs exist only
  when neither accurately represents the operation;
- exceptional custom operations are direct named methods and are declared once without exposing a raw
  action-name string at invocation or subscription sites;
- `Model.on.create`, `.on.update`, and `.on.delete` are typed lifecycle-event registration points;
- an exceptional custom operation may add a correspondingly typed completion registration, but it may not
  create a second event implementation path;
- relational lifecycle events expose typed snapshots, identities, revisions, trusted context, and tombstones;
- Kubernetes lifecycle events expose typed spec/status, metadata, generation, and deletion/finalization state;
- explicit versioned domain events such as `PostPublished` remain available when a stable public event
  vocabulary is needed; lifecycle sugar must lower through the same outbox/stream/processor runtime;
- `$model.on.action(...)`, `$model.on.command(...)`, `Model.on.action('create', ...)`, and equivalent generic
  happy-path APIs do not appear in Chirp, GuestBook, first-run documentation, or public examples;
- `$model` may remain for reflection, schema metadata, compatibility, or collision escape hatches, but common
  schema/ref/relation/event needs receive direct typed APIs or symbol-backed helpers;
- callable React mutations remain functions; routes never use `.mutate(...)`;
- one Drizzle declaration remains the storage and type authority; event ergonomics must not introduce a
  second schema or manual row-to-domain mapping.

Compatibility aliases may remain temporarily, but deprecation, migration tests, and removal timing must be
explicit. Update the Chirp RFP, vision, API reference, GuestBook, and all fixtures to agree before calling the
API settled.

## Architectural invariants

- Harbor, Rook/Ceph, shared operators, and their namespaces are platform-owned resources. A
  `ChirpInstallation` references them and may own only its project, bucket/prefix, database, credentials,
  workload namespace, and application resources according to an explicit profile.
- Harbor cannot be bootstrapped by the same graph whose images must be pulled from Harbor. Platform
  preparation is a deliberate first phase that the CLI can orchestrate automatically.
- Harbor's own bootstrap images remain reachable from an upstream registry or an independently available
  mirror. Harbor must never need itself in order to start.
- Every Applik8s-authored image is built and pushed before its Kubernetes resource is applied. Workloads use
  immutable digest references, not mutable tags.
- Third-party images may initially remain upstream. A later Harbor proxy-cache step may route them through
  Harbor, but the bootstrap exception and source digest must remain visible.
- Registry, Ceph bucket, and PostgreSQL metadata lifecycles are independent. Deleting Chirp must not delete
  shared registry data; deleting Harbor must not silently delete a retained bucket.
- Direct-only resources such as an OBC are prepared and deleted through their TypeKro factory APIs. Normal
  lifecycle never uses ad-hoc `kubectl delete`.
- Credentials are read from or written to Kubernetes Secrets. They never enter application graphs, generated
  source, image layers, command lines, browser bundles, logs, status, or committed test artifacts.
- Application status has one KRO owner. Runtime lifecycle writers may not race the same status paths.
- Provider-specific code remains in provider modules or TypeKro integrations. Chirp domain, route, and
  component modules import provider-neutral contracts only.
- No live test manually writes database change rows, outboxes, public events, projection rows, status, or SSE
  payloads in place of exercising the real path.

## Workstream 0: Lock the public experience

- [x] Prototype direct model metadata and the typed `.on.create/.update/.delete/<action>` surface on both a
  promoted Drizzle table and a promoted Kubernetes resource.
- [x] Make built-in lifecycle mutations and registrations require only the model/resource declaration. Prove
  that no `.actions({...})`, `$model`, or generic command registry is needed for create/update/delete.
- [x] Audit every Chirp custom action and remap CRUD-shaped behavior to the corresponding model fact. For the
  small number of genuinely non-CRUD operations, choose a single typed declaration that derives the direct
  method and completion event without chained intermediate model types or arbitrary strings at use sites.
- [x] Define precise event payloads for create, update, delete, and named-action completion, including
  previous/current snapshots, result, revision, identity, tombstone, trusted context, idempotency, and event
  version.
- [x] Prove that lifecycle events share the existing transactional outbox, replay, processor bounds,
  dead-letter, and invalidation machinery.
- [x] Preserve native Drizzle table identity and assignability. Detect direct-member collisions at promotion
  with a useful symbol-based escape hatch rather than silently shadowing a column.
- [x] Migrate framework fixtures and examples away from `$model.on.*` and generic event-name registration.
- [x] Update the Chirp RFP's vocabulary and code sketches to this final API before expanding implementation.
- [x] Add compile-time tests proving handler payload inference and negative tests proving invalid lifecycle or
  action names fail TypeScript compilation.

**Gate:** Account, Post, and ModerationPolicy demonstrate direct lifecycle methods and typed event handlers
from their declarations alone, with no `.actions({...})`, `$model`, or stringly lifecycle registration in
ordinary source. Browser behavior remains direct and callable, and no duplicate event runtime has been
introduced.

## Workstream 1: Complete TypeKro's registry foundation

Implement this work in TypeKro from the latest released/upstream base, not from an obsolete local branch.
Implementation is based on TypeKro 0.27.1, including the namespace-ownership and teardown work merged in
TypeKro PR #113. Draft TypeKro PR #115 contains the registry, Rook/Ceph, Harbor, and supporting generic
lifecycle work described below.

- [x] Add a generic `OciRegistryConfig` and handler beneath provider-specific helpers. It must support a
  registry URL, repository/project prefix, TLS, custom CA trust, authentication, push, and manifest digest
  resolution without embedding secrets.
- [x] Add a thin Harbor registry configuration/helper over the generic OCI handler. Do not put Harbor API
  assumptions into the generic OCI transport.
- [x] Support Docker credential-store/config discovery and an explicit async credential provider. Use
  password-stdin or an equivalent non-command-line channel and an isolated temporary Docker configuration.
- [x] Add Kubernetes Secret-backed credential resolution for a selected context without serializing Secret
  values into TypeKro state or emitted artifacts.
- [x] Extend the build result with `digest` and a canonical immutable `repository@sha256:...` image URI. Keep
  the human-readable content tag for retention and inspection.
- [x] Verify that a pushed manifest's digest is resolved from the registry and matches the image deployed.
- [x] Make `container()` work through the supported TypeKro runtime on Node 22 and Bun, or expose one explicit
  supported runtime boundary. Remove Applik8s's raw-Docker behavioral fork once TypeKro provides the complete
  path.
- [x] Preserve content-hash determinism, memoization, `.dockerignore`, build arguments, timeouts, cancellation,
  useful progress, and redacted failures.
- [x] Add single-platform local builds and a reviewed multi-platform/buildx path for release artifacts.
- [ ] Add unit tests with a fake OCI registry and live tests against Harbor for login, push, re-push,
  deduplication, digest resolution, auth rejection, CA rejection, timeout, and cleanup.
- [x] Document the provider contract and add an extension-conformance test so future registries do not require
  edits throughout `container()`.

**Gate:** `await container({ registry: harbor(...) })` pushes once, returns a verified digest URI, works from
the supported CLI runtimes, leaks no credentials, and passes TypeKro unit and live Harbor tests.

## Workstream 2: Complete the TypeKro Rook/Ceph platform

The current TypeKro Rook surface includes the operator chart, `CephObjectStore`, bucket StorageClass,
users, and direct-only OBCs. A clean local deployment still lacks a complete CephCluster lifecycle.

- [x] Add a TypeKro composition for the official `rook-ceph-cluster` Helm chart, or an equivalently complete
  typed CephCluster composition. The official cluster chart can create `CephCluster`, object stores, and
  bucket StorageClasses and requires the Rook operator first.
- [x] Pin compatible Rook operator, cluster-chart, Ceph image, Kubernetes, and architecture versions. Record
  the exact compatibility matrix in generated evidence.
- [x] Provide an honest single-node OrbStack profile with bounded PVC-backed storage and replication-one
  warnings. Never describe that profile as production HA.
- [x] Provide a production profile requiring safe failure domains, replica counts, storage devices/classes,
  resource requests/limits, disruption policy, monitoring, and backup/restore decisions.
- [x] Create an RGW `CephObjectStore` and a bucket StorageClass with an explicit operator-namespace
  provisioner prefix and `Retain` reclaim policy for Harbor.
- [x] Preserve the existing direct-only OBC safety boundary. Bind the generated bucket name, endpoint
  ConfigMap, and credentials Secret without copying credentials into graph state.
- [x] Make the Harbor bucket externally/platform owned. Harbor installation deletion must leave the bucket
  and objects intact; platform destruction must require a separate explicit destructive action.
- [x] Hydrate CephCluster, RGW, StorageClass, and OBC readiness and failure status with bounded waits and useful
  reasons.
- [ ] Add direct and KRO integration tests for operator bootstrap, cluster readiness, RGW S3 put/get/delete,
  OBC binding, custom namespaces, provisioner prefix, Retain behavior, update, rollback, and TypeKro-first
  teardown.
- [x] Ensure failed cleanup is a failed test and never delete an RGD before all owned instances finish.

**Gate:** a clean supported OrbStack profile can be prepared through TypeKro, an S3 client can use the OBC
binding, deleting the consumer and Harbor leaves retained data intact, and all cleanup follows TypeKro
lifecycle APIs.

## Workstream 3: Add the official Harbor integration to TypeKro

Use the official Harbor Helm repository at `https://helm.goharbor.io` and the official `harbor` chart. The
reviewed baseline on 2026-07-18 is chart `v1.19.1`, which deploys Harbor `v2.15.1`; implementation must pin an
exact reviewed version rather than use `latest`.

Official references:

- <https://github.com/goharbor/harbor-helm>
- <https://goharbor.io/docs/main/install-config/harbor-ha-helm/>
- <https://rook.io/docs/rook/latest/Helm-Charts/ceph-cluster-chart/>
- <https://rook.io/docs/rook/latest/Storage-Configuration/Object-Storage-RGW/ceph-object-bucket-claim/>

- [x] Add `typekro/harbor` with a standard factory layout: typed schemas, official HelmRepository and
  HelmRelease resources, values mapper, readiness evaluators, compositions, docs, examples, and focused
  exports.
- [x] Model installation ownership explicitly: `harborInstallation` is a platform-owned composition;
  consumers reference it or its status. Shared mode must have a real singleton owner rather than lifecycle
  metadata alone.
- [x] Enforce separate control-plane and owned namespaces anywhere a KRO instance owns the Harbor namespace.
  The namespace-safety invariant must survive CEL, nesting, singleton ownership, YAML, deploy, and Alchemy.
- [x] Map the official chart values without inventing fields. Preserve an advanced typed values passthrough
  with immutable deep-merge semantics.
- [x] Configure `persistence.imageChartStorage.type: s3`, the Rook RGW `regionendpoint`, bucket, region,
  version-4 auth, secure/CA settings, root prefix, and `s3.existingSecret`. Adapt the OBC Secret into the
  official keys `REGISTRY_STORAGE_S3_ACCESSKEY` and `REGISTRY_STORAGE_S3_SECRETKEY` without exposing values.
- [x] Use `jobservice.jobLoggers: [database]` when registry blobs use object storage.
- [x] Validate object redirect behavior. Disable redirects when the RGW endpoint is not externally reachable;
  enable them only when clients can reach and trust the advertised RGW endpoint.
- [x] Support external CNPG/PostgreSQL through `database.type: external` and the official password Secret
  contract. Create the Harbor database and user idempotently and set an appropriate SSL mode.
- [x] Support external Redis-compatible/Valkey through `redis.type: external`, the official Secret contract,
  and the database-index requirements. Prove compatibility with the selected TypeKro Valkey topology; fail
  compatibility validation rather than assume cluster/sentinel/TLS semantics Harbor does not support.
- [x] Provide a small local profile and an HA-oriented profile. HA status is not claimed unless external
  Postgres, Redis-compatible state, object storage, ingress, and component replicas meet Harbor's documented
  requirements.
- [x] Configure HTTPS `externalURL`, ingress, cert-manager certificate/issuer binding, optional internal TLS,
  custom CA propagation, network policy, resources, probes, disruption budgets, metrics, and Trivy policy.
- [x] Use external Secrets for admin password, registry secrets, jobservice secrets, database, Redis, and S3.
  Reject the chart's default development passwords.
- [x] Hydrate schema-complete status: ready, failed, phase, chart/Harbor version, external endpoint, observed
  generation, database/Redis/storage readiness, and normalized conditions.
- [x] Add idempotent Harbor API resources for private projects, quotas, immutable tags, retention, proxy-cache
  projects, scanners, and separate push/pull robot accounts. Use a direct/Alchemy-style provider rather than
  a continuously re-applied immutable Job. Persist robot credentials immediately to named Kubernetes Secrets
  and redact them from state/logs.
- [ ] Define upgrade and rollback behavior, including Harbor database migrations and the fact that some
  upgrades may have downtime. Never advertise rollback across an irreversible schema migration.
- [ ] Add unit, direct, KRO, nesting, singleton, and live OrbStack integration tests. Live tests must push and
  pull an artifact, query Harbor's API/status, restart a component, upgrade safely, delete through TypeKro,
  and prove the Rook bucket and CNPG data lifecycle promised by the selected profile.
- [x] Open a reviewable TypeKro PR based on the most recent accepted factory contribution style. Address all
  review findings, merge it, publish a TypeKro release, and upgrade Applik8s to that release before relying on
  the integration.

**Gate:** TypeKro can install Harbor from the official pinned chart over Rook/Ceph S3, CNPG, and a proven
Redis-compatible service; create a private project and robot credentials; push/pull by digest; report complete
status; upgrade; and delete without violating retained-data or shared-lifecycle promises.

## Workstream 4: Make remote registries an Applik8s capability

- [x] Add a provider-neutral `ContainerRegistry` capability and graph contract. Harbor is one implementation;
  OrbStack local images, ECR, GHCR, and future registries remain substitutable.
- [x] Bind the selected registry in installation/provider code through `app.provide(...)`. Domain and route
  modules never import Harbor or registry credentials.
- [x] Select the registry before compilation finalizes workload image literals. Remove the current CLI rule
  that remote registries fail because manifests were already compiled with local image names.
- [x] Orchestrate the bootstrap phases explicitly: shared platform readiness, project/credentials readiness,
  generated image builds, verified pushes, pull-secret projection, RGD/CRD apply, and instance create/update.
- [x] Route every Applik8s-authored image through the binding: ApplicationHost, command processors, query
  gateways, stream processors, projection workers, workflow workers, migrations, and generated operators.
- [x] Emit digest references and image provenance into workloads, ApplicationGraph evidence, and
  `ChirpInstallation.status.observedVersion`.
- [x] Generate or reference least-privilege pull Secrets in every consuming namespace and inject
  `imagePullSecrets` into every Pod template. Push credentials must never be mounted into workloads.
- [ ] Optionally configure Harbor proxy-cache projects for third-party images. Do not make Harbor's bootstrap
  depend on its own proxy cache.
- [ ] Add retention coordination that preserves the current and rollback digests. A Harbor policy may not
  garbage-collect a still-deployed or rollback-eligible artifact.
- [ ] Sign generated images by digest and retain SBOM/provenance evidence when the selected profile enables
  supply-chain enforcement. Keep policy provider-neutral at the application layer.
- [x] Make repeated deployment incremental and understandable: unchanged contexts do not rebuild/push,
  changed contexts produce new digests, and progress identifies the workload currently building.
- [x] Ensure all errors identify the failing phase and remediation while redacting registry, database, and
  object-store credentials.
- [ ] Add compiler, CLI, packed-consumer, fake-registry, and live Harbor coverage for every generated workload
  class and for credential/TLS failure.

**Gate:** one Applik8s deploy operation builds all authored images through TypeKro `container()`, pushes them
to Harbor, deploys only verified digest references with pull credentials, and performs no raw-Docker fallback
with different semantics.

## Workstream 5: Finish the installable Application contract

- [x] Make the installation name/spec derive collision-free workload namespaces and resource names so several
  bounded `ChirpInstallation` instances can coexist.
- [x] Make `hostname`, `profile`, `version`, feature switches, replicas, resource budgets, storage sizes,
  provider references, backup policy, and retention policy drive the graph through typed expressions. Remove
  environment variables that duplicate installation desired state.
- [x] Implement starter, dedicated, and external profiles without making profile names framework concepts.
- [x] Make every operator/provider prerequisite owned by a safe shared platform singleton or represented by
  an explicit external reference. No CRD or controller may be an undocumented prerequisite.
- [x] Integrate direct-only preparation, including OBCs and Harbor project/robot setup, into the installation
  plan. Delete it through the same planner according to ownership and retention.
- [x] Complete generic typed create/get/require/update/delete/watch operations for Application installations.
- [x] Implement and prove nested `app.install(...)` as a statically merged TypeKro composition without reconciliation-time graph generation.
- [x] Project authoritative, schema-complete status for artifact, migrations, web/gateways, registry,
  PostgreSQL, JetStream, Valkey, ClickHouse, object storage, workflows, identity/authorization, exposure,
  backup/export, upgrade/rollback, and degraded reasons.
- [x] Keep conditions concise, stable, generation-aware, credential-free, and owned only by KRO.
- [ ] Prove update by digest, failed rollout behavior, rollback policy, deletion, finalizer completion, and
  shared-resource preservation in direct and KRO modes.

**Gate:** an explicit instance created in `chirp-control` reaches Ready from the declared platform, updates by
digest, reports the actual endpoint/provider state, and deletes through TypeKro without orphans or shared-data
loss.

## Workstream 6: Finish provider-complete Chirp

- [x] Bind a complete NATS/JetStream installation, including the required server and controllers, through the
  TypeKro NATS integration. Streams/Consumers alone are not a complete provider.
- [x] Bind a complete Valkey installation through the TypeKro Valkey integration and record topology,
  authentication, storage, resources, and readiness.
- [x] Bind CNPG/PostgreSQL, ClickHouse, Hatchet, Rook/S3, Harbor, identity, authorization, DNS, TLS, and exposure
  through explicit provider modules and readiness dependencies.
- [x] Remove the current environment-variable provider switch from ordinary authoring. Local, production,
  and external profiles must be hydrated through typed provider bindings and Secrets.
- [ ] Prove Ory identity/authorization as the first production implementation and Zitadel substitution without
  changing a model, action, view, route, or component.
- [x] Preserve deterministic local identity only as an explicit test profile; it must fail closed on public
  exposure.
- [x] Complete network policies, egress contracts, Secret scoping, service accounts, RBAC, resource limits,
  probes, disruption budgets, and graceful drain for all generated workloads.
- [ ] Add provider-substitution tests for Ory/Zitadel and Rook/external S3 and conformance tests for every
  capability adapter.

**Gate:** changing a provider changes only provider modules, installation values, and generated evidence;
the product compiles and its provider semantics are proven live rather than inferred from graph metadata.

## Workstream 7: Finish the social product and canonical processing

- [ ] Complete registration/account linking, profile editing, follows, blocks, mutes, posts, replies, quote
  posts, reposts, likes, bookmarks, notifications, media, discovery/search/trending, reports, moderation,
  administration, account suspension, and deletion as usable browser journeys.
- [x] Validate relationships and authorization transactionally. Client-submitted owner/actor identifiers may
  not substitute for the authenticated principal or authoritative model participants.
- [x] Generate typed lifecycle and explicit domain events for every relevant committed state change,
  including tombstones and moderation changes.
- [x] Implement readable bounded processors for publication fan-out, relationship repair, reactions/counters,
  notification delivery, media processing, automation schedules, analytics facts, and rebuilds.
- [x] Declare and enforce partitioning, ordering, timeout, bytes/items, concurrency, connection pools,
  idempotency, retry/backoff, dead letter, drain, scaling pressure, and maximum replicas for every processor.
- [x] Implement the Valkey online timeline with generation-scoped partitions, tombstones, bounded hybrid
  fan-out, celebrity policy, repair, rebuild, atomic generation switching, and explicit degraded behavior.
- [x] Implement PostgreSQL, Kubernetes, Valkey, and ClickHouse query-authority adapters behind the same public
  view protocol. Never imply cross-authority consistency.
- [x] Move `Post.homeTimeline` to the declared online source with bounded authoritative hydration or embedded
  immutable display fields and safe deletion/moderation filtering.
- [ ] Query real ClickHouse projections from product/operations UI and implement idempotent facts, rollups,
  checkpoints, retention, rebuild, and provider-loss recovery.
- [x] Implement media upload intent and completion with size/type/checksum/expiry policy, no browser
  credentials, idempotent cleanup, and visible processing outcomes.
- [ ] Polish responsive, accessible UI states for loading, empty, stale, degraded, failed, unauthorized,
  reconnecting, and optimistic/durable/converged operation phases.

**Gate:** all supported product journeys pass browser tests, all server-side event handlers are canonical and
readable in source, and the online timeline survives duplicate, reordered, replayed, deleted, moderated, and
full-loss/rebuild scenarios.

## Workstream 8: Finish automation, analytics, and recovery

- [x] Implement the generic `StructuredGeneration` capability with schema-bound output, provider-neutral
  profiles, timeout, cancellation, idempotency, usage/cost evidence, Secret-backed credentials, egress policy,
  and a deterministic fake.
- [x] Process `AutomationScheduleChanged` into deterministic Hatchet schedules with replacement, suspension,
  deletion, credential rotation, and observable generation.
- [x] Implement the complete automation workflow: quota reservation, bounded context query, generation,
  ArkType validation, moderation, `Post.publish(...)`, usage/result recording, retry, cancellation, and outage
  behavior.
- [x] Ensure automated accounts use an Applik8s-issued execution principal and cannot bypass authorization,
  moderation, disclosure, idempotency, or budgets.
- [x] Add administrator emergency stop and user-visible automation disclosure/status.
- [ ] Implement `RebuildHomeTimelines` with source watermarks, partition plans, checksummed object artifacts,
  validation, bulk load, catch-up, atomic publication, rollback, and retirement.
- [ ] Add backup/export and restore for authoritative PostgreSQL state, Harbor metadata, object storage, and
  required identity configuration. Derived Valkey/ClickHouse state must be reconstructible.
- [ ] Exercise interrupted workflows, worker replacement, object corruption, provider loss, rollback, and
  foreground traffic during rebuild.

**Gate:** deterministic automation and rebuild scenarios pass without direct database/projection writes, and
loss of disposable providers converges to a correct new generation from retained authority.

## Workstream 9: One-command OrbStack deployment and end-to-end proof

The ordinary local experience must be:

```sh
bun run --cwd examples/chirp-start deploy:local
```

That command must be idempotent and must:

1. verify the exact Kubernetes context is `orbstack` before mutation;
2. inspect prerequisites and bootstrap or reuse TypeKro/Flux, cert-manager, CNPG, Rook/Ceph, NATS, Valkey,
   ClickHouse, Hatchet, Ory, and Harbor according to declared ownership;
3. wait for the shared Harbor platform and its Rook bucket, database, Redis-compatible service, HTTPS
   endpoint, project, and robot Secrets;
4. build all Applik8s-authored images through TypeKro `container()`;
5. push them to the private Harbor project, resolve and record digests, and create least-privilege pull
   Secrets;
6. apply the compiled RGD and an explicit `ChirpInstallation` instance through TypeKro;
7. wait for schema-complete Ready status and print the Chirp URL, Harbor project URL, artifact digest, and
   concise provider evidence without printing secrets.

Add an equally explicit lifecycle command that deletes the Chirp instance through TypeKro, awaits finalizer
completion, deletes app-owned direct preparation according to policy, and leaves shared Harbor/Rook/operator
infrastructure intact. Platform destruction must be separate, named as destructive, and tested carefully.

Required live tests on OrbStack:

- [x] Clean-ish platform bootstrap or idempotent reuse from declared state, with no hidden manual OBC step.
- [ ] Harbor login, project/robot creation, image push, digest verification, Kubernetes pull, scan evidence,
  retention behavior, and restart.
- [ ] `ChirpInstallation` create, Ready status, public HTTPS reachability, update by new digest, failed update or
  rollback evidence, and TypeKro deletion.
- [ ] Playwright registration/login/session, profile, publish, reply, follow, like, repost, bookmark,
  notification, search, media, moderation, and automation journeys.
- [x] The golden path from browser command through PostgreSQL/outbox, JetStream, processor, Valkey projection,
  SSE invalidation, authoritative requery, and rendered update—without manual writes.
- [ ] ClickHouse product query and total analytical-store rebuild.
- [x] Valkey loss, degraded read, full generation rebuild, atomic switch, and correct rendered recovery.
- [x] Processor/gateway/web/Harbor component restart during traffic, followed by bounded recovery and no lost
  committed event or duplicate logical state.
- [ ] Rook S3 browser upload/download through safe intents, checksum validation, retained-object policy, and
  external-S3 substitution contract.
- [ ] Ory production-path behavior plus deterministic test identity; Zitadel substitution may use a focused
  provider integration test if a full local Zitadel installation is not economical.
- [ ] Direct and KRO lifecycle agreement, namespace-safety validation, no orphan instances/finalizers, and no
  ad-hoc normal cleanup.
- [ ] Evidence receipts recording commit, generated graph digest, image digests, chart/provider versions,
  cluster/hardware, resources, timings, restarts, dataset, observed limits, and cleanup outcome.

**Gate:** the complete local deployment and browser suite passes twice—once from prepared shared platform
state and once as an idempotent redeploy/update—with useful evidence and clean application teardown.

## Workstream 10: Quality, security, and launch evidence

- [ ] Add Chirp unit, vertical, contract, failure-matrix, browser, provider-substitution, generated-artifact,
  and live tests under the structure described by the RFP.
- [ ] Add adversarial tests for duplicate and reordered events, idempotency collisions, authorization changes,
  stale cursors, retention gaps, partial generation publication, object corruption, credential rotation,
  registry outage, and cleanup timeout.
- [x] Keep browser/server/worker dependency zones and bundle ceilings. Add OCI context/image-size and RGD-size
  budgets with tracked history.
- [ ] Add throughput, latency, cold-start, memory, connection-pool, consumer lag, projection convergence,
  Harbor push/pull, Ceph throughput, and storage-growth baselines. Label OrbStack results honestly.
- [ ] Add correlation across request, durable result, database revision/outbox, event, processor attempt,
  projection watermark, invalidation, requery, render, installation generation, and image digest.
- [ ] Complete threat-model review for identity, authorization, media, automation, registry credentials,
  image pulls, Harbor API access, object-store credentials, SSR/browser boundaries, and supply chain.
- [ ] Scan generated images, generate SBOM/provenance, sign by digest when enabled, and prove browser/artifact/log
  secret scans.
- [ ] Document install, provider profiles, operations, upgrade, rollback, backup, restore, deletion, Harbor
  retention/GC, Ceph health, troubleshooting, architecture, and known limits.
- [ ] Run typecheck, lint/format, module boundaries, package consumer, publish dry-run, TypeScript contracts,
  Rust host contracts, deterministic Chirp tests, and all required OrbStack live gates.
- [ ] Obtain an isolated architecture review with no prior implementation context and address every P1/P2
  finding before declaring completion.

**Gate:** no production, portability, performance, recovery, or security statement exceeds recorded evidence,
and an isolated review finds no hidden second authority, unbounded work, provider leakage, secret exposure,
unsafe lifecycle, or Chirp-specific framework shortcut.

## Required test matrix

| Layer | Minimum required evidence |
| --- | --- |
| Types | Positive inference and negative compile fixtures for direct methods and typed lifecycle/action events |
| Unit | Registry auth/digest, Harbor values mapping, status evaluators, provider compatibility, event payloads, projection semantics |
| TypeKro direct | Harbor/Rook/Ceph/CNPG/Valkey preparation, readiness, update, retention, deletion |
| TypeKro KRO | Namespace safety, nesting, singleton ownership, status hydration, instance update/delete/finalizers |
| Compiler | Every generated workload uses a Harbor digest, pull Secrets are complete, no executable ConfigMaps, no secret leakage |
| Application vertical | Product actions, authorization, outbox/events, processors, projections, tombstones, automation, rebuild |
| Framework adapters | PostgreSQL, Kubernetes, Valkey, and ClickHouse query authorities share one protocol without false consistency |
| Browser | SSR/hydration, callable mutation, SSE resume/reset, requery, product journeys, accessible states |
| Live OrbStack | Platform bootstrap, image push/pull, complete installation, golden path, failures/recovery, update, TypeKro teardown |
| Packed consumer | Build and deploy from packed/published-shape packages rather than workspace-only import accidents |
| Performance | Repeatable local baseline with explicit hardware/profile and no production-scale claim |

## Critical execution order

1. Lock the typed model/event API and update the RFP.
2. Complete TypeKro generic OCI/digest support.
3. Complete the TypeKro Rook/Ceph cluster path.
4. Implement and qualify TypeKro Harbor over the official chart.
5. Release the reviewed TypeKro version and upgrade Applik8s.
6. Add the Applik8s `ContainerRegistry` capability and two-phase deployment planner.
7. Make `ChirpInstallation` dynamically complete and status-authoritative.
8. Complete provider materialization, social journeys, Valkey timelines, query multiplexing, automation,
   analytics, media, identity, and recovery.
9. Deploy and qualify the complete application on OrbStack.
10. Finish security, performance, documentation, isolated review, and release-readiness evidence.

Work may proceed in parallel only when lifecycle and API contracts are already fixed. Do not build the
Chirp-specific half of a generic capability while its TypeKro or Applik8s contract is still ambiguous.

## Definition of done

This goal is complete only when all of the following are true:

- [x] The RFP and public examples use the final direct, typed model/action/event experience with no ordinary
  `$model.on.*` or stringly lifecycle registration.
- [x] The TypeKro Harbor and generic OCI work is merged, released as TypeKro 0.28.1, and consumed by Applik8s.
- [ ] Harbor uses the official pinned Helm chart, Rook/Ceph S3, external Secret-backed dependencies, HTTPS,
  private projects, least-privilege robots, verified digest push/pull, and honest status/lifecycle semantics.
- [x] Every Applik8s-authored Chirp image is stored in Harbor and deployed by digest with correct pull
  credentials; executable ConfigMaps remain absent.
- [ ] `ChirpInstallation` owns or explicitly references every dependency, supports bounded dynamic instances,
  and reports authoritative schema-complete status.
- [ ] PostgreSQL, JetStream, Valkey, ClickHouse, S3, Hatchet, identity/authorization, DNS/TLS, Harbor, and the web
  host are materially connected, not merely named in graph metadata.
- [ ] Chirp is a usable social application with complete supported journeys and polished accessible states.
- [ ] Online timelines, analytics views, automation, media, rebuilds, tombstones, retries, idempotency,
  backpressure, and recovery implement the RFP rather than remain sketches.
- [x] `bun run --cwd examples/chirp-start deploy:local` performs the complete idempotent OrbStack deployment
  without a manual object-storage or image-push step.
- [x] A Playwright suite proves the browser-to-projection-to-SSE-to-requery path and the principal product
  journeys against the deployed application.
- [ ] Update, restart, provider-loss/rebuild, rollback, and TypeKro-first deletion scenarios pass with retained
  shared platform/data behavior matching documentation.
- [ ] Typecheck, tests, packaging, module boundaries, browser/server/worker budgets, security scans, and live
  evidence gates are green.
- [ ] An isolated architectural review has no unresolved P1/P2 findings.
- [ ] The completion report lists exact commands, versions, image/RGD digests, URLs, evidence receipts, observed
  limits, deferred second-cluster work, and remaining non-blocking risks.
- [ ] No release or tag has been created without explicit review and authorization.

## Explicitly deferred

- multi-cluster behavior and a second Kubernetes cluster;
- global multi-region active-active operation;
- federation, direct messages, advertising, payments, and complete Twitter/X feature parity;
- production-scale claims that cannot be supported by the local OrbStack evidence profile;
- mandatory mirroring of Harbor's own bootstrap images into Harbor;
- provider catalogs beyond the implementations and substitution proofs needed by this goal.

These deferrals may not be used to skip bounds, security, lifecycle, provider neutrality, or correctness in
the single-cluster implementation.
