# RFP: Chirp — An Installable Social Application and Applik8s Flagship

**Status:** Accepted; implementation in progress

**Audience:** Applik8s maintainers, Chirp implementers, and provider-adapter authors

**Revised:** 2026-07-20

**Target:** The post-v0.6 flagship and the pressure test for the next Applik8s application-composition phase.
Version assignment follows API review; this RFP does not authorize a release tag.

### Implementation snapshot

The first executable increment now lives in `examples/chirp-start`. It proves the architecture rather than
silently narrowing the RFP:

- one official TanStack Start application builds browser, SSR, generated gateways, processors, workflows,
  operator, and TypeKro artifacts from a shared model surface;
- a typed `ChirpInstallation` RGD is emitted without fabricating an invalid empty instance;
- `chirp-control` is explicitly separated from the Application-owned `chirp` workload Namespace, preventing
  same-Namespace KRO finalizer deadlock;
- fifteen PostgreSQL-backed domain models cover accounts, posts, relationships, bookmarks, notifications,
  media metadata, moderation, and automation configuration/runs;
- direct model mutations, model views, committed events, replayable streams, bounded processors, SSE invalidation,
  three workload-scoped gateways, ClickHouse facts, Hatchet work, recurring schedule convergence, and a
  multi-route product UI compile;
- author handles are resolved from the authoritative Account transaction participant rather than accepted
  from the browser, and client-supplied audience lists do not exist;
- S3-compatible runtime semantics and a TypeKro-managed, direct-only Rook OBC preparation/teardown path are
  executable while preserving the controller-mutation boundary;
- the home timeline is a generation-scoped Valkey projection. `RebuildHomeTimelines` scans the canonical
  promoted Post model under a committed PostgreSQL snapshot, writes checksummed immutable S3 segments and a
  definition-bound manifest, catches up retained events, atomically publishes, resumes after interruption,
  and retains the prior generation until explicit retirement.

Still open—and therefore not claimed complete—are the remaining installation/status fields, complete hybrid
fan-out and repair policy, live loss/rebuild/rollback qualification, media processing, production Ory/Zitadel
substitution evidence, complete analytics rebuilds, the hosted control plane, and the full browser/failure
matrix. The phase gates below remain authoritative.

## Executive summary

Chirp should be a complete, attractive, self-hostable social application that can be launched publicly,
open-sourced, and used by real communities. It should not be a benchmark wearing a social UI. Its product
must stand on its own: accounts, profiles, follows, posts, replies, reposts, likes, bookmarks, media,
notifications, discovery, moderation, administration, and optional user-created automated accounts.

Chirp is also the Applik8s flagship. The entire system is authored from one framework-neutral TypeScript
application graph inside a TanStack Start project. Applik8s compiles that graph into the web application,
transactional model operations, durable event processors, online and analytical projections, workflows,
provider infrastructure, exposure, and an installable Kubernetes resource.

One Chirp installation is one isolated social site. A self-hoster applies a `ChirpInstallation` resource;
a hosted control plane creates the same resource on a customer's behalf. The installation resource owns or
references everything the site needs: an immutable `ApplicationHost`, PostgreSQL, event delivery, online
indexes, analytical projections, object storage, workflows, identity, authorization, DNS, TLS, and generated
workers. Its status reports the hydrated readiness and endpoints of the complete application graph.

Users create automated accounts through the same Chirp UI as other product objects. Automated-account
configuration is high-cardinality relational application data, not a Kubernetes database. Durable workflows
execute it, a provider-neutral structured-generation capability supplies optional inference, and every
automated post goes through the same `Post.create(...)` mutation as a human post. Kubernetes remains visible
in the product through the more appropriate low-cardinality `ChirpInstallation` control plane.

The framework work demanded by Chirp must consolidate existing Applik8s capabilities rather than create a
parallel product-specific runtime:

- the existing TypeKro-backed Application composition becomes a first-class installable resource;
- the existing JetStream stream and Valkey index machinery becomes a canonical processor/projection API;
- `app.query()` and model views lower through provider-neutral query authorities for relational, Kubernetes,
  online-index, and analytical sources;
- the existing `ObjectStorage` capability gains an S3-compatible runtime and TypeKro Rook/Ceph provisioning;
- `IdentityProvider` and a generic authorization capability accept Ory, Zitadel, OIDC, OpenFGA, local-test, or
  future adapters without changing Chirp domain code.

GuestBook remains the smallest complete teaching application. Chirp proves that the same developer
experience remains coherent under real product breadth, asynchronous processing, data skew, rebuilds,
provider failure, dynamic installation, and public operational scrutiny.

## Product thesis

Chirp should be credible in two modes:

1. **Self-hosted:** an operator installs one private or public social site from a typed resource, receives a
   URL and readiness status, upgrades it declaratively, and can export or restore its data.
2. **Hosted:** a separate Chirp control-plane application accepts a customer request and creates an isolated
   `ChirpInstallation` using the same artifact and lifecycle contract. Hosted provisioning is Chirp product
   behavior, not tenancy built into Applik8s.

The first public version should support a coherent social product rather than every historical Twitter/X
feature:

- registration, login, logout, session management, and account recovery through an injected identity system;
- user profile, handle, avatar, bio, account visibility, and automation disclosure;
- following, unfollowing, followers, and following lists;
- posts, threads, replies, quote posts, reposts, likes, bookmarks, and deletion;
- image attachments in the first release and a bounded path to video attachments;
- home, profile, conversation, notification, search, and trending views;
- live invalidation and authoritative requery without browser access to infrastructure credentials;
- block, mute, report, moderation queues, policy actions, and administrator audit evidence;
- optional user-created automated accounts with schedules, budgets, safety policy, and deterministic test mode;
- a product/operations dashboard backed by real analytical projections;
- accessible responsive UI, seed data, documentation, and a public demo suitable for a serious Show HN launch.

Direct messages, advertising, payments, federation, global multi-region active-active operation, and parity
with every Twitter/X feature are outside the first release. Their absence must not leave the supported public
product feeling incomplete.

## Success criteria

The RFP succeeds when all of the following are true:

- a developer can understand Chirp as ordinary domain modules, not infrastructure glue;
- a clean consumer can build the complete application from published Applik8s packages;
- the same authored models and operations are used by browser, SSR, workers, workflows, and operators;
- a `ChirpInstallation` instance creates the complete site and reports authoritative readiness;
- a provisioning operator can create multiple bounded installations without generating arbitrary graphs at
  reconciliation time;
- Ory can be replaced by a Zitadel or deterministic-test adapter without editing domain models, routes, or
  authorization call sites;
- Rook/Ceph can be replaced by an external S3-compatible service without editing media or batch code;
- a model-native view can be backed by PostgreSQL, Kubernetes, Valkey, or ClickHouse without changing its
  browser invocation shape;
- automated accounts use the same domain actions and policy boundaries as human accounts;
- every worker is bounded, observable, retryable, and recoverable;
- every public scalability or reliability claim has a reproducible evidence receipt.

## Normative design decisions

The implementation must preserve these decisions unless a reviewed ADR demonstrates a simpler and equally
safe design.

1. **Chirp is a product first.** Architecture exists to support product behavior and prove Applik8s, not to
   decorate the graph with unused technologies.
2. **One installation is one site.** Chirp owns that product boundary. Applik8s owns only the generic ability
   to define, instantiate, compose, observe, upgrade, and delete an Application resource.
3. **The Application is a resource graph.** `ApplicationHost` and every required provider are children or
   explicit external references of one typed Application definition. The definition compiles to a TypeKro
   RGD/CRD and exposes typed installation operations.
4. **Graphs are compiled; instances are dynamic.** The Application schema and graph are generated once.
   Operators dynamically create instances. Reconcile handlers must not construct novel RGDs or execute an
   imperative deployment engine.
5. **Application input and output are typed.** Installation spec is the graph input. Hydrated application
   status is the graph output. Provider readiness, endpoints, observed artifact digest, migrations, and
   conditions must be projected authoritatively.
6. **Authority is singular.** Every durable fact has one authority. Delivery systems, indexes, projections,
   caches, statuses, and browser stores may mirror facts but may not become competing authorities.
7. **PostgreSQL owns product state.** Accounts, posts, follows, relationships, automation definitions,
   moderation, command results, revisions, and transactional outboxes commit there.
8. **Kubernetes owns installation desired state.** It also owns genuinely operational resources. Ordinary
   users, posts, follows, notifications, and automated-account definitions are not stored as CRDs.
9. **Transport is not truth.** Event delivery is at least once. Transactional outbox/inbox, durable action
   results, and idempotent projections own correctness.
10. **External effects follow commit.** Object writes, HTTP calls, structured generation, workflow scheduling,
    email, and projection writes do not occur inside relational model transactions.
11. **Derived state is disposable.** Valkey and ClickHouse state can be destroyed and reconstructed from
    authoritative data plus retained events. Rebuild is tested behavior, not a comment.
12. **Provider interfaces describe capabilities.** Product code never depends on Ory, Zitadel, Rook, Ceph,
    Valkey, ClickHouse, Hatchet, JetStream, cert-manager, ExternalDNS, or KEDA types.
13. **Implementations remain visible.** Provider-neutral does not mean uninspectable. The graph records the
    selected implementation, resources, credentials, runtime bindings, ownership, limitations, and status.
14. **Domain operations express intent.** Users call `Post.create(...)`, not `enqueuePostCommand(...)`.
    Durable command transport remains an implementation contract beneath the direct model mutation.
15. **Queries have explicit authority.** Query lowering may be inferred when exactly one source is valid.
    Cross-provider joins and consistency are never silently invented.
16. **Backend processing is not a client subscription.** `process` names durable server-side stream work;
    `subscription` is reserved for client delivery such as SSE or polling.
17. **Bounds are part of the API.** Reads, event handlers, fan-out, workflows, uploads, structured generation,
    and installation counts declare time, bytes, items, concurrency, and retry limits.
18. **Authentication and authorization are separate capabilities.** An identity provider establishes a
    principal. Application policy and an optional authorization provider decide access. Neither is hard-coded
    to one vendor.
19. **Automated accounts are disclosed and stoppable.** They are owned by a user or site, use bounded
    schedules and budgets, follow moderation policy, and can be suspended without deleting prior posts.
20. **Lifecycle promises are physically true.** A namespace-owning installation cannot claim that PVCs in
    that namespace survive deletion. Shared resources and retained data require explicit external ownership,
    backup/export, or a separate lifecycle.
21. **The control resource cannot own its own namespace.** A KRO instance that owns a tenant namespace lives
    in a separate control-plane namespace. Existing TypeKro namespace-safety validation remains mandatory.
22. **Framework additions are generic.** A Chirp-specific shortcut may not masquerade as an Applik8s API.
    New APIs must be useful to another application with different models and providers.

## Vocabulary and API naming

The public API should use a small provider-neutral vocabulary. Vendor and deployment names belong only in
adapter modules and generated graph evidence.

| Term | Meaning | Not this |
| --- | --- | --- |
| **Application** | A typed complete graph of domain contracts, workloads, providers, and outputs | A single pod or frontend framework |
| **Installation** | One resource instance of an Application | A universal Applik8s tenancy model |
| **Model** | An authoritative domain object promoted from its native provider | An Applik8s-owned ORM row format |
| **Mutation** | A typed create, update, or delete of an authoritative model | A transport-specific queue command at the call site |
| **Operation** | An exceptional non-CRUD intent or workflow exposed as a direct typed method | A parallel vocabulary for ordinary model lifecycle changes |
| **View** | A typed bounded read operation attached to a model or projection | A database-specific query object exposed to the browser |
| **Event** | A versioned committed fact | An imperative request to do work |
| **Stream** | A replayable ordered-within-declared-key event contract | An authority for product state |
| **Processor** | A durable bounded server-side stream handler | A client subscription or arbitrary daemon |
| **Projection** | Rebuildable derived state produced from events or authoritative snapshots | A second authority |
| **Subscription** | Authorized client delivery of invalidation or public stream events | A backend worker |
| **Task** | One bounded retryable unit of external or computational work | A long-running controller loop |
| **Workflow** | Durable orchestration of tasks and child workflows | A Kubernetes reconcile handler |
| **Capability** | A provider-neutral application requirement | A vendor SDK |
| **Provider** | A selected implementation of a capability | Hidden global service location |

The source-level naming rules are:

- conventional model mutations are direct `create`, `update`, and `delete` methods and require no action
  declaration;
- committed lifecycle work uses `Model.on.create(...)`, `Model.on.update(...)`, and `Model.on.delete(...)`;
- publishing, following, liking, reporting, and similar CRUD-shaped facts use the corresponding model
  lifecycle rather than a parallel custom action;
- a genuinely non-CRUD operation uses a direct domain method or a task/workflow and is declared exactly once;
- that exceptional declaration derives both `Model.<verb>(...)` and the typed committed
  `Model.on.<verb>(...)` completion event; completion is not a second event path;
- direct methods are the ordinary API; `$model`, command identifiers, and transport receipts are advanced
  compatibility and observability surfaces;
- `$model.on.action(...)`, `$model.on.command(...)`, and stringly `Model.action('create', ...)` do not appear
  in ordinary application code; existing command/action APIs remain migration-only compatibility surfaces;
- `Stream.process(...)` declares backend work;
- `Stream.project(...)` or `app.projection(...)` declares derived state;
- `Model.view(...)` and `app.query(...)` declare reads;
- `Query.subscribe(...)` or generated React hooks declare client delivery;
- runtime deployments may be called processors or workers in graph evidence, but application code names the
  behavior, not the pod role.

Lifecycle and exceptional-completion payloads carry domain facts. Generated backend processor context
carries stream version/sequence, stable event idempotency, admitted principal, trusted values, and the
opaque context digest. Public replay and SSE never expose raw admitted values.

No generic framework type should be named `ChirpBotProvider`, `TimelineWorker`, `OryPrincipal`,
`CephObject`, `ValkeyQuery`, or `ClickHouseModel`.

## Existing substrate and required consolidation

This RFP begins from the current codebase rather than assuming a blank slate.

| Current capability | Current limitation | Required consolidation |
| --- | --- | --- |
| TypeKro-backed `app(...)` compositions and `.factory('kro')` | The TanStack builder path is primarily concrete-instance oriented | Make every complete Application optionally parameterized, installable, nestable, and status-projecting through the same graph engine |
| `ApplicationHost.kubernetes(...)` | Hosted artifact is not yet the obvious child of a reusable Application installation | Bind immutable artifact, web runtime, gateway, provider connections, exposure, and readiness into the installation resource |
| Transactional actions, outbox, JetStream, and public streams | Canonical arbitrary stream processing is not exposed consistently | Add provider-neutral `Stream.process(...)` lowering with partitions, bounds, retry, idempotency, scaling, and dead letters |
| Kubernetes `Resource.index(...)` backed by Valkey | Specialized to Kubernetes resource watches | Generalize the index maintenance runtime into an online projection target for durable streams and model snapshots |
| `app.projection(...)` backed by ClickHouse | Projection provider is analytical-only | Allow projection bindings to target compatible online or analytical capabilities without weakening their different guarantees |
| PostgreSQL and Kubernetes `app.query()` authorities | Valkey and ClickHouse reads require separate or incomplete paths | Introduce a common query-authority contract selected from the declared source |
| Bounded ConfigMap `ObjectStorage` default | Unsuitable for media and batch artifacts | Add S3-compatible runtime semantics plus Rook/Ceph and external-provider adapters |
| `IdentityProvider` | Application authorization is primarily callback-shaped | Preserve callbacks and add a separate generic `Authorization` capability with Ory, Zitadel, OpenFGA, and local adapters |
| Hatchet workflows | Dynamic batch and scheduled automation pressure remains | Qualify bounded child work, checkpoints, cancellation, schedules, progress, and artifact references |

This consolidation must remove duplicate concepts where possible. It must not add a second event runtime,
second graph builder, second gateway protocol, or second dependency-injection mechanism.

## System topology

```text
Hosted provisioning UI/API                  Self-hosted operator
             │                                      │
             └──────── create the same ─────────────┘
                              │
                              ▼
                  ChirpInstallation resource
                  (control-plane namespace)
                              │
                   TypeKro resource graph
       ┌──────────────┬───────┼────────┬───────────────┐
       ▼              ▼       ▼        ▼               ▼
 ApplicationHost   ModelStore EventLog IndexStore  ObjectStorage
 web + gateway     PostgreSQL JetStream Valkey      S3-compatible
       │                                      │
       ├──────── WorkflowEngine ───────────────┤
       │             Hatchet                  │
       └──────── ProjectionStore ─────────────┘
                     ClickHouse

Browser / SSR / API
       │
       ▼
IdentityProvider + Authorization + RequestAdmission
       │
       ▼
direct model mutations and views
       │
       ▼
PostgreSQL state + durable result + outbox
       │
       ▼
replayable streams ──► processors ──► online/analytical projections
       │                                      │
       └──────────── client invalidation ─────┘
```

## Authority and retention matrix

| Data or decision | Authority | Delivery or derived copy | Loss/recovery contract |
| --- | --- | --- | --- |
| Installation desired state | Kubernetes `ChirpInstallation` spec | TypeKro child resources | Reconcile from the surviving instance and compiled RGD |
| Installation observed state | KRO-owned `ChirpInstallation` status | Hosted control-plane/read UI | Rehydrate from child/provider status |
| Immutable application artifact | OCI registry digest | Node image cache | Pull by approved digest; registry retention is an operational requirement |
| Browser identity/session | Injected identity provider | Validated `IdentityProvider` principal | Provider-specific session recovery; no Applik8s session authority |
| Application account and identity link | PostgreSQL | Request principal enrichment | Restore from database backup; external subject remains provider-owned |
| Posts, follows, reactions, moderation, automation configuration | PostgreSQL | Events, indexes, analytics, browser snapshots | Restore from database backup/replication |
| Action results, idempotency, revisions, history | PostgreSQL | Gateway receipts and traces | Must survive processor and broker restarts |
| Domain outbox | PostgreSQL | EventLog relay | Resume unpublished rows; relay duplicates are tolerated |
| Event delivery/replay window | `EventLog` provider | Consumer checkpoints | At-least-once replay within declared retention |
| Home timeline and notification serving index | None; derived | `IndexStore`, initially Valkey | Delete and rebuild from authoritative state/events |
| Analytical facts and rollups | None; derived | `ProjectionStore`, initially ClickHouse | Replay/recompute from retained source contracts |
| Media metadata and ownership | PostgreSQL | Browser/query views | Restore from database backup |
| Media object bytes | `ObjectStorage` provider | CDN/read-through cache | Provider backup/versioning policy; not reconstructed from metadata |
| Batch segments and manifests | None; derived | `ObjectStorage` provider | Recompute unfinished/expired generations from source inputs |
| Workflow execution and schedule history | `WorkflowEngine` provider | Automation/rebuild status references | Resume/cancel according to durable workflow policy |
| Search index | None; derived | PostgreSQL FTS initially or future search provider | Reindex from authoritative product state |
| Browser query state | Query snapshot and cursor | Framework-neutral client store | Resume, reset, and authoritative requery |

Media bytes and media metadata are different facts with different authorities; their identifiers and
checksums bind them together. No row may acquire a second writer merely because a provider is temporarily
unavailable.

## Application as an installable resource

### Desired authoring experience

The existing Application builder should gain a typed installation input while retaining the module-friendly
shape required by Vite and shared model imports. The exact property spelling is prototype-gated, but the
ordinary experience should be no more complex than:

```ts
// src/app.ts
import {
  app,
  ApplicationHost,
  Authorization,
  ObjectStorage,
  IdentityProvider,
} from '@applik8s/applik8s';
import { type } from 'arktype';
import { namespace as kubernetesNamespace } from 'typekro/kubernetes';

export const chirp = app('chirp', {
  namespace: 'chirp',
  controlPlaneNamespace: 'chirp-control',
  apiVersion: 'applications.chirp.dev/v1alpha1',
  kind: 'ChirpInstallation',
  spec: type({
    hostname: 'string',
    profile: "'starter' | 'dedicated' | 'external'",
    version: 'string',
    features: {
      automatedAccounts: 'boolean',
      analytics: 'boolean',
      media: 'boolean',
    },
  }),
  status: type({
    phase: "'Installing' | 'Ready' | 'Upgrading' | 'Degraded' | 'Failed'",
    'url?': 'string',
    'observedVersion?': 'string',
    'conditions?': 'unknown[]',
  }),
});

// The instance owner remains in chirp-control. Owning the distinct workload
// Namespace is safe and makes a new installation self-contained.
chirp.infra(() => kubernetesNamespace({ metadata: { name: 'chirp' } }));

chirp.installation.configure((spec, installation) => {
  installation.expose('web', {
    service: host,
    hostnames: [spec.hostname],
    tls: { mode: 'managed' },
    dns: { mode: 'managed' },
  });
});

// A typed enhanced input backed by the KRO instance spec. A final implementation
// may call this `chirp.spec`; it must not require raw CEL expressions in app code.
const installation = chirp.installation;

export const ChirpInstallation = installation.model;

export const host = chirp.provide(
  ApplicationHost,
  ApplicationHost.kubernetes({
    artifact: chirp.currentArtifact(),
    namespace: installation.namespace,
    hostname: installation.spec.hostname,
    replicas: chirp.select(installation.spec.profile, {
      starter: 1,
      default: 3,
    }),
  }),
);

chirp.status({
  phase: chirp.when(host.ready, {
    then: 'Ready',
    otherwise: 'Installing',
  }),
  url: host.url,
  observedVersion: host.artifact.version,
  conditions: chirp.conditions(),
});
```

`installation.configure(...)` runs inside each TypeKro graph materialization. The compiler projects conventional
`ready`, `phase`, `url`, `observedVersion`, and `conditions` fields from the concrete child resources, including
generated workloads and required external credential references; static `ready: true` placeholders are not an
installation-status strategy.

Generated migrations, processors, gateways, projections, and workflow workers lower to immutable OCI build contexts. The CLI
resolves those contexts through the provider-selected `container()` side-effect before TypeKro applies the graph, and
the generated Deployments reference content-derived image tags. Executable source is never placed in a ConfigMap or
duplicated into the `ChirpInstallation` RGD. Kubernetes still rejects oversized API requests before KRO can reconcile
them, so the flagship build enforces a 2.5 MB RGD ceiling.

This sketch adds builder ergonomics over the existing typed composition engine. `select` and `when` represent
typed graph-expression helpers; application code must not need raw CEL for ordinary branching, and the API
must not pretend JavaScript `===` or `?:` can be overloaded. The sketch does not authorize a second
resource-graph implementation. If builder-time enhanced input cannot remain statically analyzable, the
implementation may retain the existing `app(definition, (spec, app) => ...)` composition form internally
while exposing equivalent module-safe bindings to application files.

### Installation operations

An Application definition should expose generic operations:

```ts
await ChirpInstallation.create({
  name: 'acme',
  namespace: 'chirp-control',
  spec: {
    hostname: 'social.acme.example',
    profile: 'dedicated',
    version: 'sha256:...',
    features: { automatedAccounts: true, analytics: true, media: true },
  },
});

const installation = await ChirpInstallation.require({
  name: 'acme',
  namespace: 'chirp-control',
});

await ChirpInstallation.update(installation, {
  version: 'sha256:new...',
});
```

For composition inside another Application, the generic operation should be `app.install(...)`:

```ts
const installed = platform.install(chirp, {
  name: 'customer-application',
  spec: {
    hostname: customer.hostname,
    profile: customer.plan,
    version: release.digest,
    features: customer.features,
  },
});

return {
  url: installed.status.url,
  phase: installed.status.phase,
};
```

`install` is a graph operation, not an imperative Helm wrapper. In composition code it statically merges the
child Application into the parent TypeKro graph and preserves dependency and typed status edges; it does not
create a separately owned child CR. A control plane that needs an independent child owner uses the generated
installation model's typed create/update/delete operations instead.

### Installation status

Application status must be KRO-owned and derived from graph evidence. It includes:

- requested and observed artifact digest/version;
- phase and conditions;
- public URL and service endpoint;
- migration state;
- web/gateway readiness;
- required provider readiness and provider references;
- current upgrade or rollback state;
- backup/export readiness when enabled;
- concise degraded reasons without credentials or large provider payloads.

No runtime field manager may race the Application graph for the same status paths. Provider-specific status
is normalized into capability-level conditions before being projected.

### Ownership and lifecycle profiles

The first implementation supports three Chirp product profiles without making profiles a framework enum:

| Profile | Product meaning | Typical provider ownership |
| --- | --- | --- |
| `starter` | Small self-hosted site | App-owned namespace and compact provider deployments; explicit data-loss warning on deletion |
| `dedicated` | Isolated production site | Dedicated namespace and data services with backup/export and deliberate retention policy |
| `external` | Organization supplies providers | App owns workloads and references external PostgreSQL, identity, S3, and optional analytics services |

Shared provider infrastructure must be singleton/external-owned. An Application instance may own only its
logical database, subject namespace, key prefix, bucket or bucket prefix, workflow namespace, and credentials.
Deleting one installation cannot delete shared operators or infrastructure.

If the Application owns its namespace, deletion necessarily removes namespaced PVCs. Any durable-retention
promise must instead rely on external storage ownership, snapshots/backups copied outside the namespace, or
an explicit retain/export workflow completed before namespace deletion.

### Dynamic provisioning

A hosted Chirp control plane is another ordinary Applik8s Application. A customer action creates a durable
provisioning record and, after commit, a bounded processor creates one `ChirpInstallation` resource. The
installation graph—not the provisioning handler—creates the site resources.

Provisioning must enforce:

- maximum active installations and per-customer limits;
- globally unique hostname admission;
- bounded namespaces and provider references;
- immutable artifact digest allowlists;
- explicit plan/profile mapping;
- idempotent create/update/delete;
- status observation and user-visible failure evidence;
- no same-namespace RGD ownership deadlock;
- provider-aware finalization and data-export policy.

Applik8s provides the generic Application installation primitive. It does not provide customers, plans,
billing, regions, or tenancy semantics.

## Provider-neutral capability model

### Interface and implementation separation

Application and domain modules import capability tokens and logical bindings only:

```ts
import {
  ApplicationHost,
  Authorization,
  EventLog,
  IndexStore,
  ModelStore,
  ObjectStorage,
  ProjectionStore,
  RequestAdmission,
  IdentityProvider,
  StructuredGeneration,
  WorkflowEngine,
} from '@applik8s/applik8s';
```

Provider profiles import implementations from adapters:

```ts
import { ory } from '@applik8s/typekro-ory';
import { rook } from '@applik8s/typekro-rook';
import { clickhouse, cnpg, hatchet, nats, valkey } from 'typekro';
```

Domain files do not import those modules. Generated browser bundles may import neither capability
implementations nor server credentials.

### Capability matrix

| Capability | Required semantics | Initial implementation | Substitution examples |
| --- | --- | --- | --- |
| `ApplicationHost` | Run immutable server artifact, readiness, endpoint, dependencies | Kubernetes Deployment/Service | Knative, external container host |
| `ModelStore` | Transactional authority, migrations, observable revisions | CNPG/PostgreSQL | External PostgreSQL-compatible service |
| `EventLog` | Durable at-least-once event delivery, replay, lag | NATS JetStream | Kafka, Redpanda, Pulsar adapter |
| `IndexStore` | Low-latency bounded online indexes, atomic operations | Valkey | Redis-compatible provider |
| `ProjectionStore` | Rebuildable analytical facts, checkpoints, bounded queries | ClickHouse | Pinot, Druid, warehouse adapter |
| `ObjectStorage` | S3-like immutable and mutable objects, metadata, signed access | Rook/Ceph RGW | AWS S3, MinIO, GCS adapter |
| `WorkflowEngine` | Durable tasks/workflows, schedules, retries, cancellation | Hatchet | Temporal adapter |
| `IdentityProvider` | Resolve and validate request principal/session | Ory Kratos | Zitadel OIDC, Auth.js, generic OIDC, test provider |
| `Authorization` | Provider-assisted policy/relationship decision and versioning | Ory Keto | Zitadel roles, OpenFGA, SpiceDB, local policy |
| `RequestAdmission` | Transport-level rate, quota, and overload admission | Later gateway adapter | Envoy Gateway, Kong, application-local test |
| `StructuredGeneration` | Schema-bound generation, usage, cancellation, credential policy | HTTP adapter | OpenAI, Anthropic, local model, deterministic fake |

Provider contracts must publish honest limitations. For example, a ConfigMap object provider may advertise a
512 KiB ceiling and no signed browser access; it cannot satisfy a media store that requires multipart upload.

### Dependency injection

`provide()` remains the only dependency-injection mechanism:

```ts
chirp.provide(IdentityProvider, identityProvider);
chirp.provide(Authorization, authorizationProvider);
chirp.provide(ObjectStorage, objectStorageProvider);
```

A binding may materialize infrastructure, Secrets, RBAC, network policy, migrations, readiness dependencies,
and runtime environment. Provider construction remains pure during discovery. Runtime clients are hydrated
from generated bindings; application code does not receive ambient cluster or cloud credentials.

Ambiguous providers fail graph validation. Named bindings are permitted when an Application deliberately
uses more than one implementation of the same capability.

## Identity and authorization

### Generic contracts

`IdentityProvider` establishes who is making a request:

```ts
interface IdentityProviderProvider {
  authenticate(request: Request): Promise<{
    principal: {
      id: string;
      kind: 'human' | 'service' | 'automation';
      claims: Readonly<Record<string, unknown>>;
    };
    sessionVersion: string;
    expiresAt?: string;
  } | undefined>;
}
```

`Authorization` optionally answers provider-backed relationship or policy questions:

```ts
interface AuthorizationProvider {
  decide(input: {
    principal: Principal;
    action: string;
    resource?: ResourceReference;
    context: Readonly<Record<string, unknown>>;
  }): Promise<{
    allowed: boolean;
    version: string;
    reason?: string;
  }>;
}
```

These interfaces are semantic sketches, not permission to leak vendor responses. Cursor context binds both
session and authorization versions so a revoked session or changed relationship triggers reset/revalidation.

Application mutation admission and views continue to own policy. Policy runs before commit; lifecycle
processors observe only committed facts and cannot retroactively authorize them:

```ts
Post.delete.authorize(async ({ principal, current, access }) =>
    current.authorId === principal.id ||
    await access.can('post.moderate', current));
```

The provider assists evaluation. It does not silently replace application policy.

### Ory profile

```ts
const kratos = chirp.infra(ory.kratos({
  name: 'chirp-identity',
  namespace,
}));

const keto = chirp.infra(ory.keto({
  name: 'chirp-authorization',
  namespace,
}));

chirp.provide(IdentityProvider, ory.identityProvider({ kratos }));
chirp.provide(Authorization, ory.authorization({ keto }));
```

### Zitadel substitution proof

The following alternative must compile without changing any model, route, action, view, or React component:

```ts
chirp.provide(IdentityProvider, zitadel.oidcIdentity({
  issuer: chirp.secret('zitadel-issuer'),
  client: chirp.secret('zitadel-client'),
}));

chirp.provide(Authorization, zitadel.authorization({
  projectId: chirp.config('zitadel-project'),
}));
```

A deterministic test profile supplies the same capability contracts without installing an external identity
system. Insecure header identity remains limited to explicit local fixtures and fails closed on public hosts.

## Object storage and media

### Logical object stores

`ObjectStorage` is the provider capability. `app.objectStore(...)` is a named logical application store:

```ts
export const Media = chirp.objectStore('media', {
  provider: ObjectStorage,
  namespaces: {
    avatars: {
      maxBytes: 5_000_000,
      contentTypes: ['image/jpeg', 'image/png', 'image/webp'],
    },
    attachments: {
      maxBytes: 25_000_000,
      contentTypes: ['image/*', 'video/mp4'],
    },
  },
  access: {
    uploadExpiresIn: '10m',
    download: 'public-read-through-gateway',
  },
});
```

The logical API is provider-neutral:

```ts
const upload = await Media.attachments.createUpload({
  ownerId: principal.id,
  contentType: input.contentType,
  contentLength: input.contentLength,
  checksum: input.checksum,
});

await Media.attachments.completeUpload({
  uploadId: upload.id,
  objectId: upload.objectId,
  checksum: input.checksum,
});
```

Browser clients receive short-lived signed intent, never object-store credentials. Authoritative object
metadata and ownership live in PostgreSQL; the bucket contains bytes. Cleanup follows durable metadata and
idempotent post-commit processors.

### Rook/Ceph implementation

An ObjectBucketClaim is controller-mutated. TypeKro correctly exposes it only through a direct factory, so
it must not be nested in the continuously applied KRO Application graph. The installation planner must run
and await this preparation boundary, persist the returned binding, and only then allow consumers of the S3
capability to become ready:

```ts
const claim = rookObjectStorageClaim.factory('direct', {
  namespace,
  waitForReady: true,
  timeout: 300_000,
});

await claim.deploy({
  name: 'chirp-media',
  namespace,
  storageClassName: 'rook-ceph-bucket',
  bucket: { mode: 'fixed', name: 'chirp-media' },
});

chirp.provide(ObjectStorage, ObjectStorage.s3({
  endpoint: 'http://rook-ceph-rgw-chirp.rook-ceph.svc:80',
  bucket: 'chirp-media',
  region: 'us-east-1',
  credentialsSecret: { apiVersion: 'v1', kind: 'Secret', name: 'chirp-media', namespace },
  forcePathStyle: true,
  ownership: 'direct-provisioned',
}));
```

Rook owns bucket provisioning through TypeKro's direct lifecycle; `ObjectStorage.s3(...)` owns the runtime
protocol. Teardown uses `factory.deleteInstance('chirp-media')`, never ad-hoc `kubectl` deletion. The current
example exposes this as `prepare:objects`/`delete:objects`; automatic ordering and status hydration remain a
Phase 2 installation-planner deliverable. An external S3 binding supplies the same endpoint, bucket, and
credential contract without emitting Rook resources.

## Domain authority and model

### Authoritative relational models

- `Account`: handle, display name, profile, avatar reference, visibility, account kind, state, revision.
- `CredentialLink`: application reference to external identity subject; no password or session authority.
- `Post`: author, body, reply/quote references, publication state, moderation state, deletion tombstone.
- `Follow`: follower, followee, state, creation/deletion revision.
- `Reaction`: like or repost with stable idempotency key.
- `Bookmark`: private account/post relation.
- `MediaAttachment`: authoritative metadata, owner, post reference, object reference, processing state.
- `Notification`: durable user-facing notification state and read revision.
- `Block` and `Mute`: relationship policy state.
- `Report` and `ModerationCase`: report evidence and administrator workflow state.
- `Automation`: automated-account owner, target account, persona, schedule, provider profile, budget, policy,
  suspension state, and revision.
- `AutomationRun`: durable run/result/usage references, not complete model prompts or responses.
- `InstallationSetting`: site branding and product policy owned within one Chirp installation.

Drizzle remains the native schema and relationship authority. Applik8s derives runtime schemas and adds
mutations, events, revisions, graph contracts, and provider enforcement without duplicating field mappings.

### Kubernetes resources

The required public Kubernetes resource is `ChirpInstallation`. Optional operational resources may include
backup, restore, or load-test runs if their lifecycle is genuinely desired-state driven. Product rows do not
become CRDs merely to demonstrate an operator.

An optional future GitOps adapter may accept an automation CRD, but it must choose one authority. A
Kubernetes-authored automation would be read-only in the UI or reconciled through a clearly one-way import;
the same automation cannot be independently writable from both PostgreSQL and Kubernetes.

## Model lifecycle, events, and streams

### Direct lifecycle mutations

The Drizzle declaration supplies the row, insert, update, identity, relationship, and runtime validation
types. No action registry or second schema is required:

```ts
export const Post = chirp.model(posts, {
  name: 'Post',
  database: Database,
});

Post.on.create('publish-post', publicationProcessor, async (created, context) => {
  await HomeTimeline.add(created.value, {
    idempotencyKey: context.idempotencyKey,
  });
});

Post.on.delete('remove-published-post', publicationProcessor, async (deleted) => {
  await HomeTimeline.remove(deleted.tombstone.identity);
});
```

Call sites remain direct and transport-independent:

```ts
await Post.create({ id: postId, body, visibility: 'public' });
await Post.delete({ identity: postId });
await Follow.create({ id: followId, followeeId });
await Reaction.create({ id: reactionId, postId, kind: 'like' });
await Automation.update({ identity: automationId, patch: { state: 'suspended' } });
```

The returned promise resolves according to the existing durable-result contract. It does not imply that
asynchronous moderation, fan-out, analytics, search, or UI invalidation has converged.

### Event vocabulary

Every public event has a versioned schema, stable event id, correlation/causation metadata, authoritative
commit revision, and explicit partition key.

| Event | Partition key | Primary consumers |
| --- | --- | --- |
| `PostPublished` | author id | moderation, fan-out planning, analytics, search |
| `PostDeleted` | post id | online removal, analytics tombstone, search removal |
| `PostModerationChanged` | post id | visibility projection, notifications, analytics |
| `FollowChanged` | follower id | timeline repair, suggestions, analytics |
| `ReactionChanged` | post id | counters, notifications, analytics |
| `NotificationRequested` | recipient id | notification model processor |
| `MediaUploadCompleted` | object id | scanning and transformation workflow |
| `AutomationScheduleChanged` | automation id | schedule processor |
| `TimelineChunkPlanned` | viewer bucket | bounded online fan-out |
| `TimelineViewerChanged` | viewer id | query invalidation |
| `ProjectionGenerationPublished` | projection id | serving pointer refresh and evidence |

Events do not contain unbounded follower lists, object bytes, credentials, complete prompts, or provider
responses.

### Stream processing

`Stream.process(...)` is the canonical non-HTTP event-handler experience:

```ts
export const PublishedPosts = chirp.stream(PostPublished, {
  retention: { maxAge: '30d', maxMessages: 10_000_000 },
  partitionBy: event => event.authorId,
  authorize: ({ principal }) => principal.id.length > 0,
});

PublishedPosts.process('plan-home-timeline', {
  partitionBy: event => event.authorId,
  concurrency: 32,
  retry: {
    maxAttempts: 8,
    initialDelay: '250ms',
    maxDelay: '30s',
    deadLetter: true,
  },
  budgets: {
    timeout: '30s',
    maxInputBytes: 256_000,
    maxOutputMessages: 1_000,
    maxOutputBytes: 4_000_000,
  },
  scaling: {
    pressure: 'consumer-lag',
    minReplicas: 1,
    maxReplicas: 50,
    targetPendingPerReplica: 2_000,
  },
}, async (event, context) => {
  for await (const page of Follow.followersOf(event.authorId).pages({ size: 1_000 })) {
    await context.emit(TimelineChunkPlanned, {
      operation: 'upsert',
      postId: event.postId,
      authorId: event.authorId,
      publishedAt: event.publishedAt,
      viewerBucket: page.key,
      viewerIds: page.items.map(item => item.followerId),
      cursor: page.cursor,
    });
  }
});
```

The exact paging helper is prototype-gated. The semantics are not: every invocation and emitted chunk is
bounded, replay is idempotent, and the generated processor exposes pressure and failure evidence.

## Unified projections

### One projection concept, multiple compatible stores

An Application projection declares source, derived schema, update semantics, rebuild semantics, and a
provider-neutral storage requirement. Online and analytical providers remain distinct capabilities because
they make different latency, query, retention, and atomicity promises.

An online projection can use the existing `IndexStore` machinery:

```ts
export const TimelineChunks = chirp.stream(TimelineChunkPlanned, {
  retention: { maxAge: '30d' },
  partitionBy: event => event.viewerBucket,
});

export const HomeTimeline = TimelineChunks.project('home-timeline', {
  store: IndexStore,
  output: TimelineEntry,
  map: event => event.viewerIds.map(viewerId => ({
    operation: event.operation,
    viewerId,
    postId: event.postId,
    authorId: event.authorId,
    publishedAt: event.publishedAt,
  })),
  partitionBy: entry => entry.viewerId,
  key: entry => entry.postId,
  removeWhen: entry => entry.operation === 'remove',
  score: entry => entry.publishedAt,
  value: entry => ({
    postId: entry.postId,
    authorId: entry.authorId,
    publishedAt: entry.publishedAt,
  }),
  retention: {
    maxItemsPerPartition: 2_000,
    maxAge: '30d',
  },
  generationScoped: true,
  rebuild: {
    source: Post,
    checkpoint: 'durable',
    map: post => post.deletedAt === null && post.moderationState === 'visible'
      ? [{
        operation: 'upsert',
        postId: post.id,
        authorId: post.authorId,
        publishedAt: post.publishedAt,
      }]
      : [],
  },
});
```

An analytical projection uses the same conceptual operation with `ProjectionStore`:

```ts
export const EngagementFacts = Engagements.project('engagement-facts', {
  store: ProjectionStore,
  output: EngagementFact,
  key: event => event.id,
  value: event => ({
    eventId: event.id,
    postId: event.postId,
    accountId: event.accountId,
    kind: event.kind,
    occurredAt: event.occurredAt,
  }),
  checkpoint: 'idempotent',
  rebuild: { source: Engagements },
});
```

`Stream.project(...)` is preferred when the source is already explicit. `app.projection(...)` remains the
general form for multiple sources or snapshot-driven rebuilds. Both lower through one graph contract.

### Projection semantics

Every projection declares:

- source event or snapshot contracts;
- key and partition semantics;
- idempotency authority;
- insert, update, and tombstone behavior;
- retention and capacity bounds;
- active generation and source watermark when generation-scoped;
- rebuild/checkpoint behavior;
- query capabilities;
- readiness, lag, last failure, and replay evidence.

An online projection provider must support the operations its declaration requires. A Valkey binding that
cannot perform atomic generation switching fails compatibility validation rather than silently weakening the
contract.

Kubernetes `Resource.index(...)` remains a concise specialized projection. Its implementation should reuse
the generalized online projection runtime rather than preserve a separate index engine indefinitely.

## Query authority multiplexing

### One public query protocol

The browser and server call model-native views uniformly:

```ts
await Account.byHandle({ handle });
await Post.homeTimeline({ limit: 50, cursor });
await Post.search({ query, limit: 20, cursor });
await Post.analytics({ range: '7d' });
await ChirpInstallation.readySites({ limit: 20 });
```

The view binding determines the source:

| Source | Query authority |
| --- | --- |
| Native Drizzle model or relationship | PostgreSQL/Drizzle |
| Kubernetes resource model | Kubernetes list/get/watch snapshot authority |
| Online projection | `IndexStore` query adapter, initially Valkey |
| Analytical projection | `ProjectionStore` query adapter, initially ClickHouse |

The generated gateway multiplexes these adapters behind one authenticated query, cursor, invalidation, and
error protocol.

### Desired declaration

The ordinary declaration should name the logical source, not its provider:

```ts
Post.view('homeTimeline', {
  source: HomeTimeline,
  input: HomeTimelineInput,
  output: HomeTimelinePage,
  reads: [Post, Follow, Block, Mute],
  authorize: ({ principal, input }) => principal.id === input.viewerId,
  run: ({ source, input }) => source.page({
    partition: input.viewerId,
    limit: input.limit,
    cursor: input.cursor,
  }),
  budgets: {
    timeout: '2s',
    maxRows: 100,
    maxResultBytes: 512_000,
  },
});
```

A native relational view can omit `source` when its registered database is the only valid authority. A
Kubernetes model view similarly defaults to its resource authority. A projection-backed view names the
projection so the compiler does not infer from the base model incorrectly.

`reads` describes authorization and invalidation dependencies. `source` owns the snapshot. These concepts
must not be conflated.

### Query authority contract

Each provider adapter implements a framework-owned semantic contract resembling:

```ts
interface QueryAuthority<TInput, TOutput> {
  snapshot(input: TInput, context: QueryContext): Promise<{
    value: TOutput;
    revision: string;
    cursor: string;
    convergence?: ProjectionConvergence;
  }>;

  changes?(
    input: TInput,
    cursor: string,
    context: QueryContext,
  ): AsyncIterable<QueryInvalidation>;
}
```

Provider cursors are wrapped in an Applik8s cursor that also binds query version, input digest, principal,
trusted context, authorization version, projection generation, and expiry.

### Cross-authority queries

Applik8s must not imply a consistent join across PostgreSQL, Kubernetes, Valkey, and ClickHouse. A view that
needs multiple authorities chooses one of three explicit patterns:

1. materialize the relationship into a projection and query that projection;
2. select one snapshot authority and declare bounded best-effort enrichment with visible staleness;
3. declare a composed query with explicit consistency and failure policy.

The first Chirp timeline uses a materialized online projection plus bounded authoritative post hydration or
embedded immutable display fields. The chosen contract must prevent deleted or moderated posts from being
resurrected by stale projection data.

### Client delivery

SSE carries invalidation and reset evidence, not invented incremental SQL patches. A changed model,
authorization version, projection generation, or retention gap causes the client to requery or reset through
the same view. React hooks remain framework-neutral underneath the TanStack adapter.

## Online timeline architecture

`PostPublished` never contains a client-supplied audience. After commit:

1. a processor resolves the author's current fan-out policy;
2. ordinary authors are expanded through stable bounded follower pages;
3. each page emits bounded idempotent fan-out chunks;
4. chunk processors update viewer partitions in the active online projection generation;
5. celebrity authors update a per-author recent-post index instead of enumerating every follower;
6. the timeline view performs a bounded merge of fan-out-on-write entries, followed celebrity entries, and
   the active offline candidate generation;
7. viewer projection changes coalesce client invalidations.

Fan-out policy is versioned and observable. Transitioning an author between ordinary and celebrity modes
schedules a repair workflow. The read path declares maximum celebrity authors, candidates, bytes, and time;
it never falls back to an unbounded PostgreSQL query when the online store is unavailable.

The timeline response includes projection evidence:

```ts
type HomeTimelinePage = {
  items: TimelinePost[];
  cursor?: string;
  projection: {
    generation: string;
    eventWatermark: string;
    rebuilding: boolean;
    degraded: boolean;
  };
};
```

## Analytics and batch reconstruction

ClickHouse receives idempotent publication, deletion, moderation, follow, reaction, impression, fan-out, and
automation facts keyed by stable source event id. The application queries real aggregate/materialized views
through the generic query-authority contract.

The first dashboard includes:

- active users and publication/reaction rates;
- top posts and authors over bounded windows;
- publication-to-fan-out and projection-convergence percentiles;
- consumer lag, rebuild progress, and provider saturation;
- human and automated traffic separation;
- moderation outcome and latency;
- object/media processing state and failure rate.

`RebuildHomeTimelines` is a durable workflow:

1. capture authoritative and stream watermarks;
2. create an immutable generation id and partition plan;
3. extract bounded analytical candidate segments;
4. write compressed checksummed artifacts through the logical object store;
5. validate all segments and quality bounds;
6. bulk-load generation-scoped online indexes;
7. catch up events after the captured watermark;
8. atomically publish the generation pointer;
9. retain the previous generation for rollback;
10. retire expired keys/artifacts according to explicit policy.

Tasks use object references instead of large payloads. Every stage and partition has a durable idempotency
key, checkpoint, retry policy, progress record, and cancellation behavior.

The implemented extraction path treats PostgreSQL as authority, not the retained event window. It reads the
promoted Post model and committed stream watermark from one bounded repeatable-read MVCC snapshot. Command
transactions serialize stream sequence allocation with commit, so transactions outside the snapshot appear
strictly after the captured watermark without the long-running scan blocking foreground writes.
The immutable manifest records a digest of the projection definition, source kind, starting generation,
watermarks, segment checksums, counts, and partition evidence. A retry validates that evidence and resumes
loading/catch-up without silently taking a newer snapshot under the same generation id. Already-published
retries are idempotent; corrupt objects, changed definitions, unexpected active generations, and retention
gaps fail closed. A new definition or an incomplete extraction whose authority has changed requires a new
generation id.

## Automated accounts

### Product model

An automated account is an ordinary `Account` with `kind: 'automation'` plus an owned `Automation` record:

```ts
export const Automation = chirp.model(automations, {
  name: 'Automation',
  database: Database,
});

Automation.on.create('install-automation-schedule', scheduleProcessor, installAutomationSchedule);
Automation.on.update('replace-automation-schedule', scheduleProcessor, replaceAutomationSchedule);
```

The configuration contains:

- owning human/site and target automated account;
- disclosed persona and bounded instructions;
- selected site-approved generation profile;
- schedule and trigger policy;
- maximum posts, generation units, cost proxy, and concurrent runs;
- content, link, mention, and moderation policy;
- suspend/emergency-stop state;
- revision and observed schedule state.

Provider credentials are Secret or provider references. They never appear in browser artifacts, relational
plaintext, events, prompts stored for replay, status, logs, or projection payloads.

### Scheduling processor and workflow

`AutomationScheduleChanged` is processed after commit. The processor creates, updates, suspends, or deletes a
deterministically named workflow schedule. Schedule identity is derived from automation id and generation.

Each run:

1. reserves a quota/idempotency window for automation and schedule tick;
2. queries a bounded authorized timeline/context view;
3. constructs a bounded structured-generation request with explicit source references;
4. invokes the injected `StructuredGeneration` capability in an idempotent task;
5. validates output with ArkType;
6. applies moderation and link policy;
7. calls `Post.create(...)` as the automated account with a deterministic request id;
8. records usage and durable result references;
9. emits safe run evidence and terminal outcome.

The workflow cannot write PostgreSQL tables, Valkey keys, or ClickHouse rows directly. It uses model mutations
and declared capabilities.

Workflow-originated model mutations carry an Applik8s-issued internal execution principal derived from the
durable Automation and Account references. It is not synthesized from a caller-controlled HTTP header and
does not require the browser identity provider to impersonate the automated account. The same generic
authorization and audit contracts still evaluate that principal.

### Generic structured generation

```ts
const GeneratePost = chirp.task('generate-post', {
  input: GeneratePostInput,
  output: GeneratedPost,
  requires: [StructuredGeneration],
  retry: { maxAttempts: 3 },
  timeout: '45s',
}, async (input, context) => {
  const generated = await context.use(StructuredGeneration).generate({
    profile: input.profile,
    input: input.context,
    output: GeneratedPost,
    idempotencyKey: input.runId,
    signal: context.signal,
  });
  // The calling workflow records generated.usage in its durable run model.
  return generated.value;
});
```

The interface includes schema-bound output, model/profile selection, timeout, retry classification,
cancellation, idempotency, usage/cost evidence, egress policy, and deterministic fake behavior. It is not an
agent framework and does not include Chirp concepts.

The current task runtime returns `{ value, usage, providerRequestId? }`; usage is bounded provider-neutral
evidence rather than a raw vendor response. Durable workflow-level evidence recording remains a follow-up,
so the optional `context.evidence` line above is the intended contract rather than a claim that it is already
implemented.

## Developer experience by file

```text
examples/chirp-start/
├── src/
│   ├── app.ts                     # Application definition and installation input
│   ├── application.ts             # host, exposure, DNS, TLS, status projection
│   ├── providers/
│   │   ├── production.ts          # capability bindings only
│   │   ├── external.ts
│   │   └── local.ts
│   ├── schema/
│   │   ├── accounts.ts            # Drizzle tables and relations
│   │   ├── posts.ts
│   │   ├── social.ts
│   │   ├── moderation.ts
│   │   └── automation.ts
│   ├── domain/
│   │   ├── accounts.ts            # promoted models, actions, views, events
│   │   ├── posts.ts
│   │   ├── follows.ts
│   │   ├── reactions.ts
│   │   ├── notifications.ts
│   │   ├── moderation.ts
│   │   └── automation.ts
│   ├── streams/
│   │   ├── publication.ts
│   │   ├── engagement.ts
│   │   └── notification.ts
│   ├── timelines/
│   │   ├── online.ts              # provider-neutral projection and view
│   │   ├── fanout.ts              # canonical Stream.process handlers
│   │   ├── ranking.ts
│   │   └── rebuild.ts
│   ├── media/
│   │   ├── objects.ts             # logical object store
│   │   └── processing.ts
│   ├── analytics/
│   │   ├── projections.ts
│   │   └── views.ts
│   ├── automation/
│   │   ├── workflow.ts
│   │   └── generation.ts
│   └── routes/                    # official TanStack Start routes
├── drizzle/
├── load/
├── public/
└── test/
    ├── product.vertical.test.ts
    ├── installation.vertical.test.ts
    ├── provider-substitution.vertical.test.ts
    ├── processing.vertical.test.ts
    ├── query-authority.vertical.test.ts
    ├── failure-matrix.vertical.test.ts
    └── chirp.live.e2e.test.ts
```

This is one Application and one source tree, not one file or one pod. Compiler-owned boundaries split browser,
SSR, gateway, processors, workflows, operators, and infrastructure without handwritten deployment projects.

## Complete application sketch

The key source files should read approximately as follows. These sketches are normative about separation,
authority, and call-site experience. Exact constructors remain subject to focused prototype review.

### `src/app.ts`

```ts
export const chirp = app('chirp', {
  apiVersion: 'applications.chirp.dev/v1alpha1',
  kind: 'ChirpInstallation',
  spec: InstallationSpec,
  status: InstallationStatus,
});

export const Database = chirp.database.postgres('primary', {
  schema,
  migrations: { path: '../drizzle' },
});

bindProviders(chirp, chirp.installation.spec.profile);
```

### `src/providers/production.ts`

```ts
export function bindProductionProviders(application: Application) {
  const postgres = application.infra(cnpg.database(/* ... */));
  const events = application.infra(nats.jetstream(/* ... */));
  const online = application.infra(valkey.cluster(/* ... */));
  const analytics = application.infra(clickhouse.cluster(/* ... */));
  const objects = application.infra(rook.objectBucket(/* ... */));
  const workflows = application.infra(hatchet.engine(/* ... */));
  const identity = application.infra(ory.kratos(/* ... */));
  const authorization = application.infra(ory.keto(/* ... */));

  application.provide(ModelStore, providers.postgres(postgres));
  application.provide(EventLog, providers.jetstream(events));
  application.provide(IndexStore, providers.valkey(online));
  application.provide(ProjectionStore, providers.clickhouse(analytics));
  application.provide(ObjectStorage, providers.s3(objects));
  application.provide(WorkflowEngine, providers.hatchet(workflows));
  application.provide(IdentityProvider, providers.oryIdentity(identity));
  application.provide(Authorization, providers.oryAuthorization(authorization));
}
```

The example uses neutral placeholder adapter names until the actual packages are reviewed. Core Applik8s
must not grow a `providers.oryIdentity` implementation merely because Chirp uses Ory.

### `src/domain/posts.ts`

```ts
export const Post = chirp.model(posts, {
  name: 'Post',
  database: Database,
})
  .view('thread', threadView)
  .view('homeTimeline', {
    ...homeTimelineContract,
    source: HomeTimeline,
  });

Post.on.create('fan-out-published-post', timelineProcessor, fanOutPublishedPost);
Post.on.update('apply-post-visibility', timelineProcessor, applyPostVisibility);
Post.on.delete('remove-deleted-post', timelineProcessor, removeDeletedPost);
```

### `src/routes/home.tsx`

```tsx
export const Route = createFileRoute('/')({
  loader: ({ context }) => Post.homeTimeline.preload({
    viewerId: context.identity.id,
    limit: 50,
  }),
  component: Home,
});

function Home() {
  const timeline = Post.homeTimeline.useQuery();
  const publish = Post.create.useMutation();

  return (
    <Timeline
      items={timeline.data.items}
      onPublish={input => publish(input)}
      refreshing={timeline.isRefreshing}
    />
  );
}
```

### `src/routes/settings/automation.new.tsx`

```tsx
function NewAutomation() {
  const create = Automation.create.useMutation();

  return (
    <AutomationForm
      profiles={Automation.availableProfiles.useQuery().data}
      onSubmit={input => create(input)}
      pending={create.isPending}
    />
  );
}
```

No route imports Ory, Hatchet, JetStream, Valkey, ClickHouse, Rook, Ceph, or Kubernetes clients.

## Scaling and backpressure

Every generated processor declares:

- partition/ordering key;
- maximum messages and bytes per invocation;
- maximum in-flight work per replica;
- acknowledgement deadline and extension policy;
- retry/backoff and terminal dead-letter policy;
- idempotency authority;
- CPU/memory requests and limits;
- graceful drain behavior;
- minimum/maximum replicas;
- provider-neutral pressure metric and target;
- connection-pool budget;
- timeout and output bounds.

KEDA may implement scaling, but public contracts speak in consumer pressure, queue depth, oldest age, task
backlog, or resource saturation. A future implementation may use a different autoscaler.

The system degrades deliberately:

- unavailable online projections produce an explicit degraded timeline, not an unbounded database fallback;
- unavailable analytics do not block publishing;
- unavailable object storage does not advance a batch generation or commit a media attachment;
- unavailable workflow execution leaves scheduled work visibly pending;
- unavailable event delivery leaves committed outbox records and visible relay lag;
- unavailable identity fails closed for protected operations;
- unavailable authorization fails according to an explicit fail-closed policy;
- unavailable structured generation produces a typed automation outcome and no post.

## Observability

One correlation chain connects:

```text
request/session
  → mutation id and durable result
  → PostgreSQL revision and outbox id
  → stream event id and sequence
  → processor attempt and checkpoint
  → online/analytical projection watermark
  → client invalidation
  → authoritative requery
  → rendered projection generation
```

Installation evidence additionally connects:

```text
ChirpInstallation generation
  → artifact digest
  → provider resources and migrations
  → ApplicationHost rollout
  → endpoint/DNS/certificate
  → hydrated Application status
```

Metrics and logs remain provider-neutral at the application layer and may expose provider-specific detail in
adapter dashboards. User, post, event, and installation identifiers are trace/log fields where required, not
unbounded metric labels.

## Performance, load, and evidence profiles

Performance results are evidence, not architectural decoration. Every receipt records code revision,
artifact digest, provider versions, installation profile, cluster/hardware, requests and limits, dataset
shape, duration, warmup, concurrency, latency distribution, throughput, error/retry counts, backlog, memory,
storage growth, and cost proxies.

### Profile A — deterministic CI

Purpose: correctness, idempotency, replay, and boundedness on ordinary changes.

- 1,000 accounts, including deterministic automated accounts;
- 25,000 follows with a skewed author distribution;
- 10,000 posts and 100,000 reactions;
- duplicate and reordered delivery;
- forced processor restart;
- full online-index loss and rebuild;
- interrupted batch generation;
- identity revocation and authorization-version change;
- deterministic structured generation with no paid provider.

The gate checks exact authoritative counts, stable durable results, no duplicate projection entries,
tombstone propagation, bounded payloads, generation atomicity, replay convergence, and complete cleanup. It
is not a throughput claim.

### Profile B — OrbStack integration and capacity discovery

Purpose: complete provider and Application lifecycle on the persistent development cluster.

- installation created through its KRO instance in a separate control-plane namespace;
- CNPG/PostgreSQL, JetStream, Valkey, ClickHouse, Hatchet, Rook/Ceph S3, identity/authorization, web host,
  exposure, and processors connected through normal provider bindings;
- a recorded starting dataset of at least 10,000 accounts, 250,000 follows, 100,000 posts, and 1,000,000
  reactions, followed by controlled growth until a documented local resource boundary is reached;
- rolling restart during publishing, fan-out, automation, and rebuild;
- provider destruction/recovery where the authority contract permits it;
- Application update and deletion through TypeKro instance lifecycle, never ad hoc cleanup as the normal path.

The result is explicitly an OrbStack receipt. It establishes semantic integration and a local capacity
envelope, not production scale.

### Profile C — multi-node scale qualification

Purpose: validate horizontal behavior and discover provider/system ceilings. Initial qualification targets:

- 1,000 sustained publish actions per second with a 5,000/second burst;
- 20,000 reaction actions per second;
- 10,000 home-timeline views per second;
- one one-million-follower author publishing during steady load;
- p95 healthy durable publish result below 500 ms;
- p95 warm online-timeline response below 200 ms;
- p95 ordinary-author projection convergence below 30 seconds;
- no lost committed event, unbounded heap growth, connection exhaustion, or partial generation publication;
- controlled outage backlog drains without exceeding declared provider saturation policy;
- complete timeline generation rebuild while foreground traffic remains inside its documented degraded SLO.

These are targets, not present claims. A failed target is useful evidence and should identify whether the
limit belongs to application design, generated topology, provider configuration, hardware, or test harness.

### Product launch SLOs

Before a public hosted demo, Chirp publishes a smaller evidence-backed SLO set appropriate to the deployed
profile:

- successful and rejected actions return durable results without ambiguous transport acknowledgement;
- timeline and profile views have declared p50/p95/p99 latency and error budgets;
- projection freshness and consumer oldest age are user/administrator visible when degraded;
- identity, authorization, object storage, event delivery, and workflow failure modes fail according to the
  contracts in this RFP;
- installation, upgrade, backup, restore, and deletion have measured completion bounds;
- resource and cost ceilings prevent an automated account or viral post from causing unbounded spend.

## Failure and recovery matrix

| Failure | Required outcome |
| --- | --- |
| Duplicate action submission | Same durable result; one logical mutation and event |
| Outbox relay crash after publish | Resume without lost committed event; downstream duplicates tolerated |
| Processor crash mid-page | Resume from durable cursor; bounded repeated work; no duplicate projection entry |
| Celebrity post | Bounded write amplification and observable read-time policy |
| Event provider outage | Product authority remains PostgreSQL; relay lag visible; later drain succeeds |
| Online store loss | Explicit degraded reads followed by complete generation rebuild |
| Analytical store loss | Foreground product continues; replay reconstructs facts and rollups |
| Object corruption | Checksum/manifest validation fails; active generation and media metadata remain safe |
| Workflow worker crash | Completed partitions/runs resume idempotently |
| Generation publication crash | Pointer remains wholly old or wholly new |
| Post deletion during rebuild | Tombstone prevents resurrection |
| Identity session revocation | Cursor and subscription revalidate/reset; protected actions fail |
| Authorization relationship change | Cached decision/cursor version invalidates |
| Ory replacement with Zitadel profile | Domain source and browser operations are unchanged |
| Rook replacement with external S3 | Media and batch source are unchanged |
| Automation suspension during run | No future run; current-run cancellation follows declared policy |
| Installation upgrade failure | Prior healthy artifact remains or rollback is explicit; status reports failure |
| Installation deletion | KRO instance is awaited before RGD removal; shared infra remains; data policy is honest |
| Browser disconnect/reconnect | Resume or explicit reset without silent gaps |

## Implementation phases

### Phase 0 — API prototypes and naming review

- prototype builder-safe Application installation input and status output;
- prototype `app.install(...)` composition/nesting;
- prototype `Stream.process(...)`, `Stream.project(...)`, and provider-selected query authority;
- prototype `app.objectStore(...)` against a fake S3 provider;
- prototype `IdentityProvider` plus `Authorization` with two interchangeable adapters;
- decide compatibility aliases for `Model.command(...)` and current `app.subscription(...)` behavior;
- run module-boundary and browser-bundle review.

Gate: one minimal fixture demonstrates every proposed call shape without hidden globals, raw CEL, vendor
types, ambiguous authority, or duplicate graph engines.

### Phase 1 — Installable Application

- make the complete TanStack Application graph parameterized and RGD-backed;
- include `ApplicationHost`, gateway, provider resources/references, exposure, and status;
- add typed create/get/update/delete and nested `app.install(...)` operations;
- enforce control-plane namespace safety and shared-resource ownership;
- test direct and KRO lifecycle, update, rollback, and cleanup.

Gate: an operator-created `ChirpInstallation` reaches Ready from an empty namespace, upgrades by digest, and
deletes through TypeKro lifecycle without orphaning resources or deleting shared infrastructure.

### Phase 2 — Provider-complete application substrate

- implement S3-compatible `ObjectStorage` runtime semantics;
- bind TypeKro Rook/Ceph OBC outputs to the S3 provider;
- implement identity/authorization capability separation;
- qualify Ory production, Zitadel substitution, and deterministic local profiles;
- complete Secret, egress, network-policy, and browser-boundary review.

Gate: provider substitution tests change only provider modules and generated graph evidence.

### Phase 3 — Complete social domain

- implement accounts, profiles, social relationships, posts, threads, reactions, bookmarks, media metadata,
  notifications, discovery, moderation, administration, and account lifecycle;
- remove client-supplied audience data and other current demo shortcuts;
- connect every state change to transactional events and durable result semantics;
- build the polished accessible TanStack product surface.

Gate: all supported user journeys pass browser-level tests against authoritative providers.

### Phase 4 — Processing, online projections, and multiplexed queries

- expose canonical stream processors;
- generalize Valkey indexes into online projections;
- implement bounded hybrid fan-out, tombstones, repair, generation rebuild, and client invalidation;
- add PostgreSQL, Kubernetes, IndexStore, and ProjectionStore query-authority adapters;
- make model-native views choose authority from their declared logical source.

Gate: the same browser query protocol serves all four authority types, and online state survives duplicate,
reordered, replayed, and loss/rebuild tests.

### Phase 5 — Automated accounts

- implement Automation domain model and UI;
- implement schedule processors and Hatchet workflows;
- add generic structured-generation capability and deterministic fake;
- enforce budgets, suspension, moderation, credential references, and action-only posting;
- expose automation disclosure and administrator emergency stop.

Gate: creation, update, schedule replacement, run, retry, moderation rejection, suspension, credential
rotation, provider outage, and deletion pass without Kubernetes product-data authority.

### Phase 6 — Analytics and batch reconstruction

- implement ClickHouse facts, rollups, retention, and query adapter;
- implement product and operational analytics views;
- implement object-artifact rebuild, validation, catch-up, atomic publication, rollback, and retirement;
- test provider destruction and reconstruction under foreground activity.

Gate: analytics are genuinely queried by the product, and a total online-store loss yields a correct atomic
new generation.

### Phase 7 — Hosted provisioning

- build the separate Chirp control-plane Application;
- create installations through generic Application operations;
- add hostname, plan, quota, artifact, and provider-reference admission;
- expose installation status and failure recovery to users;
- prove multiple bounded installations and deletion isolation.

Gate: hosted and self-hosted paths create the same `ChirpInstallation` contract and artifact.

### Phase 8 — Launch hardening

- add provider-neutral request admission and an initial gateway adapter;
- complete backup/restore, upgrade/rollback, observability, threat model, supply-chain, and capacity work;
- run deterministic CI, OrbStack, and explicitly resourced scale profiles;
- publish architecture, generated graph, operational guide, demo, and evidence receipts.

Gate: no public production, performance, recovery, or portability claim exceeds its evidence.

## Release and review gates

The flagship is ready only when:

- the Application CRD owns or explicitly references every required dependency;
- Application status is authoritative and schema-complete;
- same-namespace ownership, shared deletion, and data-retention hazards are prevented or honestly rejected;
- product source outside provider modules contains no vendor implementation types;
- Ory/Zitadel and Rook/external-S3 substitution proofs pass;
- direct model actions and callable React mutations preserve the intended v0.6 experience;
- canonical non-HTTP processors are readable in source and inspectable in the graph;
- query authorities cover PostgreSQL, Kubernetes, online projections, and analytical projections;
- cross-authority consistency is explicit;
- browser and server bundles pass dependency-zone and size ceilings;
- all processors expose bounds, retry, idempotency, drain, and pressure evidence;
- media uploads never expose credentials and enforce size/type/checksum policy;
- automated accounts cannot bypass domain authorization, moderation, idempotency, or disclosure;
- the complete browser-command-to-event-to-projection-to-SSE-to-requery path passes live;
- installations deploy and delete through TypeKro instance APIs rather than ad hoc `kubectl` cleanup;
- clean packed-consumer, direct, KRO, and OrbStack gates agree;
- an isolated architectural review finds no hidden second authority, unbounded work, provider leakage, or
  Chirp-specific framework primitive.

## Open questions requiring prototype evidence

1. Can the current replayable builder expose enhanced installation input without disrupting module-level
   model exports and Vite static discovery, or should it provide generated installation bindings over the
   existing composition callback?
2. Should the product CRD kind be `Chirp`, `ChirpSite`, or `ChirpInstallation`? The framework concept remains
   Application installation regardless of product spelling.
3. What is the smallest type-safe pre-commit admission surface for direct model mutations? It must remain
   distinct from post-commit `Model.on.create/update/delete` processing and may not require a second schema.
4. Should `Stream.project(...)` be only sugar for `app.projection(...)`, and can both share one binding without
   duplicate graph nodes?
5. Does the existing `IndexStore` contract safely grow generation-aware projection semantics, or does it need
   versioned optional capabilities that fail compatibility checks?
6. What is the smallest query-authority adapter that supports PostgreSQL, Kubernetes, Valkey, and ClickHouse
   without erasing provider-native query strengths?
7. Which cross-authority enrichment patterns are safe enough to support initially, and which should fail
   closed in favor of materialization?
8. What generic installation-preparation artifact should carry TypeKro's direct-only OBC readiness and
   stable Secret/ConfigMap binding into a KRO-owned Application status without allowing two lifecycle owners?
9. What authorization-version signal can Ory Keto, Zitadel, OpenFGA, and local adapters provide consistently
   for cursor/subscription invalidation?
10. Should named installation profiles be compiled variants, includeWhen branches inside one RGD, or separate
    provider compositions sharing one Application contract?
11. What product-scale threshold justifies an external search capability rather than PostgreSQL full-text
    search behind the same model view?
12. Which scale profile is affordable to run routinely, and which remains a scheduled qualification lane?

Prototype results must choose a contract and record failures. “Provider-specific” is not an acceptable reason
to leak an implementation into the application interface.

## Final desired experience

A developer works in one TanStack Start project and writes ordinary code:

```ts
await Post.create({ id: postId, body, visibility });
await Follow.create({ followerId, followeeId, requestId });
const timeline = await Post.homeTimeline({ limit: 50 });
const automation = await Automation.create({ ownerId, accountId, persona, schedule });
```

A self-hoster installs the complete application:

```sh
kubectl apply -f chirp-installation.yaml
```

A hosted control plane performs the same operation through the model facade:

```ts
await ChirpInstallation.create(request);
```

An infrastructure author can replace Ory with Zitadel, Rook/Ceph with external S3, or Hatchet with another
workflow adapter by changing provider bindings rather than product code.

An architect can inspect the generated graph and answer:

- which resource is the Application installation;
- which children it owns and which providers it references;
- what is authoritative, replayable, derived, or disposable;
- how each query chooses its authority;
- where ordering, bounds, idempotency, retries, and scaling exist;
- how online and analytical projections are rebuilt;
- how a user-created automation is authenticated, authorized, moderated, budgeted, and stopped;
- what survives installation deletion and why;
- which behavior is generic Applik8s and which is Chirp product code;
- which claims have actually been proven.

The intended reaction is not “this demo has many technologies.” It is:

> This is a real social application, and the surprising part is that its domain, frontend, distributed
> processing, providers, and Kubernetes installation still read like one coherent TypeScript program.
