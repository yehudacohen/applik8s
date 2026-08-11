# RFP: Applik8s v0.7 — Schema-Derived Profiles and Starts

**Status:** Accepted v0.7 contract; implementation evidence remains governed by the release scorecard

**Charter:** [`charter-v07-agentic-platform.md`](charter-v07-agentic-platform.md)

**Depends on:** Existing provider tokens, `provide()`, application installation schemas, TypeKro
composition, Alchemy lifecycle, Vite, React, and TanStack Start adapters

**Unblocks:** The Agentic Start distribution and coherent local, dedicated, and external deployments

## Purpose

Replace repeated value-selection and provider wiring with schema-derived, exhaustive deployment profiles
while keeping dependency injection in ordinary TypeScript. Define the generic Start framework: versioned
distributions can contribute maintained packages, qualified defaults, profile modules, generator
overlays, and operational routes without creating another framework.

Starts must not create a second application graph, compiler, router, runtime, registry, or deployment
language.

## Required developer experience

```ts
import { app } from "@applik8s/applik8s";

export const application = app("research-platform", {
  installation: type({
    name: "string",
    profile: "'starter' | 'developer' | 'dedicated' | 'external'",
  }),
});

const PrimaryDatabase = TransactionalDatabase.named("primary");
const deployment = application.profile(
  application.installation.spec,
  "profile",
);

deployment
  .provide(PrimaryDatabase)
  .starter(() => Database.postgres({ provider: CNPG, instances: 1 }))
  .developer(() => Database.postgres({ provider: CNPG, instances: 1 }))
  .dedicated(() => Database.postgres({ provider: CNPG, instances: 3 }))
  .external((spec) => Database.externalPostgres(spec.providers.database))
  .exhaustive();

const database = application.inject(PrimaryDatabase);
```

The compiler rejects missing, duplicate, incompatible, or ambiguous provisions. Adding a profile variant
makes every exhaustive provider binding fail type checking until handled.

Models bind to typed capabilities rather than vendor strings:

```ts
const AnalyticsDatabase = AnalyticalDatabase.named("analytics");

const analytics = deployment
  .provide(AnalyticsDatabase)
  .starter(() =>
    Analytics.postgres({
      database,
      schema: "analytics",
    }),
  )
  .dedicated(() =>
    Analytics.clickHouse({
      cluster: {
        shards: 2,
        replicas: 2,
      },
    }),
  )
  .external((spec) =>
    Analytics.externalClickHouse({
      connection: spec.providers.analytics,
    }),
  )
  .exhaustive();

database.models(Account);
analytics.models(UsageFact);
```

Provider qualification must not turn every model into a relational model. One logical model
declaration receives only facets its qualified provider can honor:

```ts
// Kubernetes authority: the same model declaration gains resource semantics.
kubernetes.models(ImportJob, {
  apiVersion: "research.example.com/v1alpha1",
});
```

The common model/operation facade converges only where the backing authority provides the required
identity, read, mutation, revision, change, and transaction guarantees. Provider-specific behavior is an
explicit refinement, not a string branch and not a lowest-common-denominator promise.

Profile binding operates on capabilities, not on a universal model kind:

| Model binding | Binding role | Common facets | Required refinement |
| --- | --- | --- | --- |
| PostgreSQL/relational | `TransactionalDatabase` for authoritative writes | Typed identity, references, bounded reads, supported changes, committed facts, generated Drizzle facet | SQL joins, constraints, transactions, and provider query extensions remain relational. |
| Kubernetes resource | Kubernetes authority and its declared cluster/namespace access | Typed identity, references, reads, resource operations, lifecycle events | Admission, watches, status ownership, finalizers, optimistic concurrency, and RBAC remain Kubernetes-specific. |
| Document/control-plane | Compatible model-store capability | Only the facets guaranteed by that store | No relational or Kubernetes guarantee is inferred. |
| Analytical model/projection | `AnalyticalDatabase` | Declared reads, aggregates, ingestion, checkpoint, and rebuild handles | Provider-specific aggregate/query capabilities require an explicit refinement. |

A requested common facet that cannot be supported faithfully is absent at the type level and rejected
during graph construction if reached dynamically. Profiles may change a compatible implementation; they
may not silently change a model's authority kind or consistency contract.

## Owned contracts

This RFP owns:

- discriminated installation-profile extraction;
- exhaustive profile builders and branch narrowing;
- qualified provider tokens and `inject()`;
- capability-qualified model/provider binding;
- provider-native model authority and compatibility refinement;
- Start provider modules and override rules;
- graph-visible inactive and active provider branches;
- profile-transition contracts;
- the generic `create applik8s --start` extension protocol;
- package-backed generated project boundaries;
- packed-package consumer and browser/server dependency-zone gates.

It does not own provider runtime behavior, domain authority, AI protocol, search synchronization, or
product-specific tenancy. It also does not own the Agentic Start's module selection, default provider
choices, operations UI information architecture, or acceptance applications; those belong to the
Agentic Start distribution RFP.

## v0.6 provider-surface migration

v0.7 replaces storage-shaped provider names with behavioral capabilities:

```text
v0.6 ModelStore / { store }             -> TransactionalDatabase / { database }
v0.6 ProjectionStore.clickhouse(...)    -> AnalyticalDatabase implemented by Analytics.clickHouse(...)
v0.6 Postgres model-store constructor   -> Database.postgres(...)
```

This is a capability redesign, not a cosmetic alias. `TransactionalDatabase` promises authoritative
transactions, constraints, command/outbox atomicity, change capture, and bounded reads.
`AnalyticalDatabase` promises projection ingestion, checkpointing, rebuild, and declared analytical
queries. PostgreSQL may satisfy both through separately declared adapters; ClickHouse may satisfy only
the analytical capability.

`NotificationDelivery` is a separately qualified external-effect capability. It accepts an
idempotent application-owned rendered message outside the committing model transaction and returns a
redacted delivery receipt. Starter binds a deterministic inspectable sink; Dedicated and External bind
an explicit provider. The v0.7 Dedicated reference adapter is SMTP with Secret-reference credentials,
required transport security, sender policy, bounded retries, and authenticated delivery observations
where the server supports them; it does not install or claim ownership of a mail server. External may
bind another compatible provider. Identity-provider courier flows remain part of the qualified identity
provider because verification and recovery are provider protocol state, not application notification
state. A deployment may derive both SMTP bindings from one Secret reference without serializing its
contents or collapsing their delivery authorities.

Because no supported external consumers require compatibility, v0.7 source and manifests use the new
names directly. The implementation increment must migrate existing graph nodes, diagnostics, examples,
generated contracts, Chirp, and packed-consumer fixtures together and remove the old public names rather
than leave two permanent vocabularies. Migration documentation records the mapping for readers of v0.6
examples.

## Profile discovery

Schema derivation must use a reviewed, versioned ArkType inspection boundary rather than depending on
undocumented internal object layout. If the schema cannot expose a stable discriminated union, the API
must require an explicit variant tuple:

```ts
application.profile(InstallationSpec, {
  discriminator: "profile",
  variants: ["starter", "developer", "dedicated", "external"] as const,
});
```

The explicit tuple is preferable to unsafe runtime inference. Type-level and runtime variants must be
proven equal.

`developer` is an explicit, non-production installation variant rather than
an environment switch. It may reuse Starter-sized stateful providers while
binding live credentials from the deployment operation host. The same explicit
`hostEnvironment` credential source is valid for application-owned Dedicated
providers; enabling TypeKro filesystem hot reload is an independent deployment
option.

The derived profile descriptor records:

- discriminator path and schema revision;
- every variant and its narrowed schema;
- active-variant expression;
- installation instance identity;
- compatibility with prior profile descriptors;
- transition requirements for every variant pair.

Profile selection is installation data, not a build-only environment variable. A generated artifact can
be reused across compatible installation variants without rebundling domain code.

## Qualified providers

Qualification identifies semantic roles rather than vendors:

```text
TransactionalDatabase.named("primary")
AnalyticalDatabase.named("analytics")
Search.named("audit")
AI.named("inference")
IdentityProvider.named("primary")
```

A provider can implement multiple capabilities, but one capability cannot be satisfied by an
implementation that lacks its guarantees. Provider-specific refinements remain explicit.

Qualifier identity is a branded graph token containing capability ID, qualifier name, and compatibility
revision. Two packages requesting `TransactionalDatabase.named("primary")` resolve to the same logical
qualification without relying on ambient string lookup. Duplicate provisions are rejected before any
provider side effect.

Profile closures execute only during graph discovery under a side-effect-free construction contract.
Inactive branches may contribute inspectable graph alternatives but may not read credentials, connect to
providers, materialize resources, or leak secret references into the selected deployment.

### Capability-qualified model binding

Capability types describe behavioral guarantees:

```text
TransactionalDatabase
  transactions, relational constraints, command/outbox atomicity,
  authoritative change streams, bounded query contract,
  framework control-schema transaction support

AnalyticalDatabase
  analytical projection ingestion, declared aggregate/query capabilities,
  checkpointing, rebuild, and provider-specific refinements
```

A PostgreSQL implementation may satisfy both capabilities. A ClickHouse implementation may satisfy the
analytical capability but cannot bind an authoritative model that requires transactional command
semantics. Type checking rejects the mismatch before graph construction.

### Non-selectable framework transactional subsystems

`SignalStore` is not another qualified capability. It is a framework-owned subsystem installed in the
control schema of `TransactionalDatabase.named("primary")` alongside canonical operation receipts,
grants, idempotency records, and the transactional event outbox. This is required because signal
issuance and resolution must commit their state, access records, receipts, and outbox rows in one local
database transaction.

Consequently:

- there is no public `SignalStore.named(...)`, `provide(SignalStore, ...)`, profile branch, or
  application override;
- Starter, Dedicated, and External variants inherit signal storage from their selected primary
  transactional database;
- a primary database provider qualifies only if it supports the complete versioned framework control
  schema and transaction boundary;
- an External binding must permit framework migrations and control tables rather than supplying a
  read-only or application-table-only connection;
- a primary-database transition includes pending signal instances, terminal outcomes, exact grants,
  receipts, outbox rows, and workflow-wait recovery in its state-migration plan; and
- graph, `plan`, and `explain` show the internal subsystem and schema revision beneath the primary
  database without presenting it as an independently selectable provider.

The internal subsystem remains provider-neutral at the runtime interface, while PostgreSQL is the only
qualified v0.7 implementation. Supporting another transactional database requires proving the same
single-transaction and recovery contract; it does not add another application-facing provider choice.

Model, query, processor, and projection graph nodes depend on the qualified capability, not the concrete
provider. At runtime the generated server facade resolves the active binding for that installation.
Provider-neutral model operations retain the same source syntax; provider-specific analytical features
require an explicit capability refinement rather than conditional string matching.

This RFP owns binding and routing to declared capabilities. It does not define a new universal query
language or claim that PostgreSQL and ClickHouse support identical query behavior.

It also does not define a universal provider query language. The public `model()` declaration remains
the one logical source of field, identity, relationship, and boundary-schema truth; qualified bindings
derive their provider-native Drizzle, Kubernetes, analytical, index, or document representation.
Provider-native schema constructors remain explicit escape hatches for unsupported features, not the
generated-project path. Qualification never asks application authors to remap fields into a second
schema.

### Qualified existing query operations with capability refinements

Every query-like surface is still an ordinary typed, authorizable operation with the same invocation,
server/client facade, result, cursor, subscription, and audit machinery. This RFP binds those existing
declared operations to capabilities; it does not add `Model.find()`, `Model.aggregate()`, or another
implicit query language.

A relational query remains an explicit model view/query with schemas, authorization, and budgets. The
ordinary path uses the model's portable typed query facet; an explicitly qualified provider refinement
may expose native Drizzle when required:

```ts
export const Account = model("Account", {
  id: field.uuid().primary(),
  ownerId: field.uuid().index(),
  displayName: field.string(),
});

export const AccountsByOwner = Account.view({
    input: AccountsByOwnerInput,
    output: AccountsByOwnerOutput,
    authorize: ({ principal, input }) => principal.id === input.ownerId,
  }, async input => Account
    .where(account => account.ownerId.eq(input.ownerId))
    .limit(input.limit)
    .all())
  .budget({
    maxRows: 100,
    maxResultBytes: 256_000,
    timeoutMs: 2_000,
  });

await AccountsByOwner({ ownerId, limit: 50 });
await UsageByTopic({ from, to });
await PostSearch.search({ text: "release notes" });
await ActiveApplicationResources({ namespace: "products" });
```

`UsageByTopic` remains an explicitly declared analytical query/projection operation owned by the existing
query/projection contract. `ActiveApplicationResources` remains an explicitly declared Kubernetes query
with bounded list/watch semantics. The search RFP owns `PostSearch.search`. Profiles only prove that the
selected provider satisfies each operation's serialized requirements.

Transactional models expose existing bounded relational reads. Analytical bindings expose only
previously declared aggregate/projection operations. Search indexes and Kubernetes resources retain their
own typed operations through the common authorizable-operation facet. An operation may be portable across
providers only when its serialized capability requirements are satisfied; unsupported behavior fails
graph construction rather than branching on `"postgres"` or `"clickhouse"` at runtime.

## Profile transitions

Every provider binding declares transition policy:

```text
starter -> dedicated
dedicated -> external
external -> dedicated
```

The graph must distinguish:

- in-place reconfiguration;
- replicated migration and cutover;
- export/import;
- unsupported transition;
- replacement requiring explicit data-loss acknowledgement.

Changing a profile does not imply that stateful provider migration is safe. The deployment plan reports
every retained, adopted, replaced, imported, exported, and deleted resource before effects execute.

The External profile also defines the workload namespace as an external lifecycle boundary. It must
exist before deployment because it is the Kubernetes scope in which externally supplied provider
credential Secrets are referenced. Applik8s may create and delete its own generated runtime Secrets
inside that namespace, but it must not adopt or delete the namespace itself. This rule is inferred from
the profile; applications do not configure a separate namespace-ownership flag.

Each binding contributes a transition descriptor containing:

- source and destination capability/provider revisions;
- data authority before, during, and after cutover;
- export, replication, import, validation, and rollback operations;
- credential and endpoint activation order;
- dependent workload drain/restart requirements;
- retained-data and destructive-effect policy;
- observed readiness and cutover frontier.

Unsupported transitions fail planning before mutations. Destructive transitions require an explicit
installation-scoped acknowledgement that is included in the Alchemy plan identity.

## Start contract

A Start consists of:

- a versioned package that composes public Applik8s primitives and modules;
- reviewed default profile modules;
- a small generator overlay on the upstream TanStack Start scaffold;
- operational and administration routes supplied by packages;
- generated deployment and recovery documentation;
- acceptance fixtures and live evidence.

Application-owned files contain domain models, operations, routes, policies, agents, and intentional
overrides. Runtime-heavy code remains in maintained packages.

The generated `src/app.ts` calls the public `app(...)` constructor. A Start definition guides generation
and records compatibility, but it is not an `agenticStart(...)` runtime constructor. Generated source
imports maintained application modules and profile modules explicitly so an application can inspect, replace, or
remove one contribution without reverse-engineering an opaque Start application object.

The generator command is:

```sh
bun create applik8s my-product --start agentic
```

The generated project must remain recognizable as a normal TanStack Start application and removable
without reverse-engineering copied internals.

A Start package exports a declarative definition:

```ts
interface StartDefinition {
  readonly name: string;
  readonly compatibility: StartCompatibility;
  readonly packages: readonly StartPackageContribution[];
  readonly profiles: StartProfileModules;
  readonly generator: StartGeneratorOverlay;
  readonly routes: readonly StartRouteContribution[];
  readonly diagnostics: readonly StartDiagnosticContribution[];
}
```

The definition contributes to the existing application graph. It does not execute package installation,
write source files, or deploy resources itself. The generator consumes the definition in a separate
build-time process and records the selected Start/version in generated project metadata.

`packages` is a generator compatibility/catalog input, not a runtime module
registry. The generated project explicitly imports and includes every selected
maintained application module:

```ts
import { conversations } from "@applik8s/conversations";
import { approvals } from "@applik8s/approvals";

export const Conversations = application.include(conversations);
export const Approvals = application.include(approvals);
```

Module definitions are typed and side-effect-free during graph discovery. They
return ordinary handles, declare their capability/module requirements, and
resolve those requirements from the application's `provide(...)` bindings.
They do not spawn runtimes or deploy resources during authoring. The complete
provider, workload, permission, and lifecycle wiring remains visible in the
normalized graph and `explain` output rather than being manually threaded
through every inclusion. Removing one module inclusion produces a normal graph
diff and compile diagnostics for any remaining dependent module.

Start profile modules are generic collections of qualified provisions:

```ts
deployment
  .starter(AgenticLocalPlatform)
  .dedicated(AgenticDedicatedPlatform)
  .external(AgenticExternalPlatform)
  .exhaustive();
```

The Agentic names are illustrative consumers of this generic protocol. Their contents are specified by
the distribution RFP.

### Progressive disclosure and the ordinary provider path

The generated `src/providers.ts` is complete, exhaustive, and editable, but profile construction is not
part of the beginner application path. It exports hydrated, qualified handles for feature code:

```ts
// src/providers.ts
export const database = application.inject(PrimaryDatabase);
export const search = application.inject(ApplicationSearch);
export const workflows = application.inject(WorkflowEngine);
```

Ordinary feature code imports those handles and declares native models, operations, and work. It does
not repeat qualification or branch on the active profile. The first tutorial introduces a provider-native
model, a typed operation, a permission, a route, and local execution before explaining
`application.profile(...)`.

The profile builder is the golden path for authors changing deployment topology, provider
implementations, external bindings, or transition policy. `app.select()` remains a lower-level graph
value-expression escape hatch and vendor-name branching is not a competing public path. Starts may ship
reviewed default profile modules, but generated source retains explicit imports and can replace those
defaults without an opaque configuration registry.

## Override rules

An application may replace one qualified provider:

```ts
deployment.dedicated.override(
  AuditSearch,
  Search.openSearch({ nodes: 5, storage: "500Gi" }),
);
```

Overrides:

- must satisfy the same capability contract;
- must declare lifecycle and transition behavior;
- must appear in application-graph and deployment-plan diffs;
- cannot override a provider after a dependent graph node has captured a concrete implementation;
- cannot expose inactive credentials or leave both implementations authoritative.

Start defaults expand before application overrides and dependency capture. The final graph retains both
the default and override provenance so upgrades can distinguish “new Start default” from “application
intentionally replaced this qualification.” Removing an override restores the compatible current Start
default only after a reviewed plan.

## Graph and deployment lowering

The application graph records one logical provider-selection node per qualification, with:

- profile branches and conditions;
- selected capability/provider revision;
- provider resource and secret dependencies;
- model/query/processor consumers;
- status and output contract;
- transition descriptor;
- Start/default/override provenance.

TypeKro materializes the selected Kubernetes composition. Alchemy owns effects, state, adoption,
ordering, rollback, and deletion. Profile selection must not reintroduce handwritten deployment loops,
imperative `kubectl`, or a second Applik8s lifecycle engine.

The existing compiler-authored Hatchet `HelmRepository`, CNPG, `HelmRelease`, NetworkPolicy, and KEDA
resources violate this boundary and are a required v0.7 migration. A released TypeKro Hatchet
composition must own bootstrap, external database references, Secrets, worker scaling dependencies,
status, update, backup/recovery responsibility, and deletion in direct and KRO modes. Applik8s then binds
the provider and worker workloads into the application composition; it must not retain a parallel
Hatchet installation renderer.

Status reports logical qualification readiness separately from concrete provider status. Domain handlers
receive only the provider-neutral hydrated handle; provider credentials and TypeKro resource objects stay
server-only.

## Implementation increments

1. Inventory current `app.select()` and provider-binding patterns in Chirp and approve the v0.6
   `ModelStore`/`ProjectionStore` migration map.
2. Migrate the provider vocabulary, model bindings, graph contracts, diagnostics, examples, and generated
   facades as one breaking change.
3. Define stable profile-schema inspection and exhaustive type fixtures.
4. Implement qualifications, `inject()`, capability compatibility, and graph contracts.
5. Bind model, relational, analytical, search, Kubernetes, processor, and projection operations to
   qualified capabilities.
6. Implement profile provision, inactive-branch isolation, and override validation.
7. Land and release the TypeKro Hatchet composition, then remove compiler-authored Hatchet
   infrastructure.
8. Implement transition descriptors, plan validation, and Alchemy lowering.
9. Define the generic Start definition, profile-module, route-contribution, and generator protocols.
10. Convert Chirp provider wiring into a conformance fixture without changing domain behavior.
11. Prove packed-package generation, deployment, override provenance, transition diagnostics, and
    deletion.

## Required gates

- A new profile variant breaks every incomplete exhaustive binding.
- Inactive branches cannot read credentials or emit selected deployment resources.
- Duplicate and incompatible qualified provisions fail compilation.
- ClickHouse cannot satisfy a transactional model binding; PostgreSQL can satisfy both declared roles
  only when its analytical adapter declares the required capabilities.
- The primary transactional database qualifies only with the versioned framework control schema,
  transactional signal/grant/receipt/outbox support, and required migration permissions.
- `SignalStore` cannot be independently selected, provided, overridden, or split from the primary
  transactional database transaction domain in Starter, Dedicated, or External profiles.
- Primary-database transition plans include pending signals, retained terminal outcomes, grants,
  receipts, outbox rows, and workflow-wait recovery.
- Model operations resolve through the selected qualified binding without provider-name branching.
- Relational, Kubernetes, and framework entity models retain their native authoritative declarations;
  no profile or Start asks authors to mirror fields into a universal schema.
- Relational, analytical, search, and Kubernetes queries share operation/facade semantics while exposing
  only refinements their selected capability supports.
- Profiles add no implicit `find`, `aggregate`, or universal query DSL; examples use existing declared
  view/query/search/resource operations and native provider APIs inside their bounded closures.
- The old `ModelStore`, `ProjectionStore`, and `{ store }` public vocabulary is absent from v0.7 generated
  source, graph contracts, and diagnostics.
- Generated browser code cannot import provider implementations.
- The generated project contains no copied registry, workflow engine, auth server, or deployment stack.
- Selected Start modules appear as explicit application-owned imports/calls, never as an opaque
  constructor or runtime registry.
- Generated provider modules are complete and editable, while ordinary feature code consumes hydrated
  handles without profile branches and the first tutorial requires no profile configuration.
- Documentation presents schema-derived profile provision as the topology-customization golden path;
  `app.select()` appears only as a lower-level value-expression escape hatch.
- A provider override produces a complete graph and deployment diff.
- Removing an override does not silently adopt a changed Start default.
- Stateful profile changes report migration policy before mutation.
- A clean consumer generates from packed packages without workspace dependencies.
- Starter deployment remains credential-free and fits the recorded OrbStack resource ceiling.
- TypeKro owns Kubernetes composition and Alchemy owns effect ordering, state, adoption, and deletion.
- Hatchet installation resources are emitted by the released TypeKro integration, not handwritten
  compiler manifests.

## Closed v0.7 decisions

1. v0.7 uses the explicit variant tuple whenever ArkType cannot expose a stable supported discriminator
   API. No private ArkType AST dependency enters the public contract.
2. Fresh Starter, Developer, Dedicated, and External installations are executable. In-place transitions
   are executable only when the plan proves ownership and state migration; otherwise they are
   diagnostics-only and fail before mutation.
3. The public distribution is `@applik8s/start-agentic`, selected by `--start agentic`.
4. The base analytical contract covers bounded append, idempotent event identity, checkpoints, rebuild,
   lag, and aggregate query. Provider-specific joins, materialized-view syntax, and advanced ClickHouse
   features remain explicit refinements.

## Definition of done

This RFP is complete when application profiles are exhaustive, qualified, graph-visible, side-effect
safe, and transition-aware; transactional and analytical models resolve through type-compatible bindings;
existing declared query/view/resource/search operations retain their schemas, bounds, and native
provider closures without an implicit profile-owned query language; and a packed Start can generate a
small upstream-shaped application that deploys through the existing TypeKro and Alchemy lifecycle. Chirp
must prove ordinary qualified provider use, while the Agentic Start must consume only the generic Start
descriptor and override protocol defined here. Completion does not authorize v0.7.
