# RFP: Profiles and Concrete Provider Bindings

**Status:** Accepted for implementation; architecture frozen on 2026-08-30

**Audience:** Applik8s maintainers, application authors, provider authors, deployment/runtime owners,
Start authors, documentation maintainers, and release engineers

**Revised:** 2026-08-30

**Target:** Applik8s v0.9 public vocabulary freeze and bounded AWS/Kubernetes golden-profile parity

**Depends on:** Capability DI, qualifications, provider resolution, `ApplicationPlan`, external capability
bindings, typed configuration and Secrets, deployment implementation boundaries, runtime-access inference,
and lifecycle ownership

**Unblocks:** One coherent assembly experience for local, Kubernetes, AWS, external, and mixed-provider
applications without target, placement, substrate, or installation abstractions in application source

## Implementation progress

The target-free authoring and immutable planning vertical is implemented on the v0.9 branch:

- `application.profile(name, callback)` binds inspectable capability implementations without an
  installation discriminator or deployment target;
- direct bindings derive identity from the semantic capability binding, while `.identified(name)` is the
  explicit refactor-stability escape hatch;
- recursive private dependencies, reuse, guarantees, lifecycle, readiness, migration, maturity, evidence,
  and configuration-source metadata lower into `ApplicationImplementationPlan`;
- the compiler emits every authored profile in a versioned, digest-bound
  `application-implementation-plans.json` artifact;
- deployment selects exactly one plan for the installation profile and rejects missing, ambiguous, or
  tampered plan artifacts before infrastructure mutation.
- finite Jobs now require the experimental `JobRuntime` capability; validated `local`, `kubernetes`, and
  `aws` constructors participate in the same provider graph and profile planning algebra rather than
  branching inside the Job declaration;
- `AWS.account(...)` and `KubernetesCluster.current()`/`.external(...)` are typed, Secret-safe reusable
  configuration values, while `Queue.jetStream()`/`.sqs()`, `FiniteExecutionHost.kubernetes()`/`.aws()`,
  `JobResultStore.postgres()`, and `Scheduler.postgres()` form the first complete typed private dependency
  graph beneath a semantic provider.

Remaining provider-constructor coverage, runtime-adapter target parity, and deployment migration qualification remain subsequent
implementation phases. Deployment-state mutation remains blocked until the exact released v0.7.1 baseline
is recorded.

## Executive summary

Profiles and deployment targets currently overlap. Attempts to resolve that overlap with installation,
placement, or substrate abstractions merely move the same physical vocabulary into new framework nouns.
The application already has a stronger source of truth: typed dependency injection.

This RFP makes a **profile the sole optional assembly-policy selector**. Each profile binds semantic
capabilities directly to concrete provider implementations. Provider constructors accept their own typed
account, region, cluster, endpoint, configuration, and Secret bindings. Those implementations contribute
runtime adapters, infrastructure, readiness, lifecycle, guarantees, and evidence.

The framework then emits the actual physical plan. It does not introduce a global target, a placement
layer, a substrate enum, or an application-authored installation object between DI and physical resources.

```ts title="src/profiles.ts"
const aws = AWS.account({
  region: config.env("AWS_REGION"),
  credentials: secret.env("AWS_CREDENTIALS"),
});

const actorCluster = KubernetesCluster.external({
  endpoint: config.env.url("ACTOR_CLUSTER_ENDPOINT"),
  credentials: secret.env("ACTOR_CLUSTER_CREDENTIALS"),
});

application.profile("production", profile => {
  profile.provide(PrimaryDatabase, Database.auroraPostgres({ account: aws }));
  profile.provide(JobRuntime, JobRuntime.aws({ account: aws }));
  profile.provide(ObjectStorage, ObjectStorage.s3({ account: aws }));
  profile.provide(ActorRuntime, ActorRuntime.celld({ cluster: actorCluster }));
  profile.provide(AnalyticsDatabase, Analytics.externalClickHouse({
    endpoint: config.env.url("CLICKHOUSE_ENDPOINT"),
    credentials: secret.env("CLICKHOUSE_CREDENTIALS"),
  }));
});
```

That binding graph already says everything necessary. The plan may contain Lambda, Aurora, S3, TypeKro
compositions, a Celld fleet, and an external ClickHouse endpoint without asking the user to classify the
application as AWS, Kubernetes, hybrid, or anything else.

## Existing functionality that must not be duplicated

| Capability | Existing boundary to reuse |
| --- | --- |
| Semantic requirements | Canonical application graph |
| Provider selection | Typed capability DI and qualifications |
| Assembly alternatives | Existing profile concepts |
| Provider configuration | Typed provider constructors, config bindings, and Secret bindings |
| Physical plan | `ApplicationPlan` |
| Deployment state/lifecycle | Alchemy |
| Kubernetes resources | TypeKro through its Alchemy integration |
| AWS/non-Kubernetes resources | Native or focused Alchemy resources |
| Runtime authority | Inferred runtime access and receipts |
| Provider truth | Maturity and conformance evidence |

This RFP does not add a second provider resolver, generic environment object, string-based target switch,
placement engine, or infrastructure graph.

## Problem statement

The current vocabulary can ask developers to select a profile and a target. The proposed correction then
risked introducing profile, installation, placement, substrate, execution host, and contributor as public
concepts. Most of those are facts already contained by provider resolution and physical resources.

### A target conflicts with DI

```bash
applik8s deploy --profile dedicated-kubernetes --target aws
```

No precedence rule can make this coherent. Typed provider bindings should remain authoritative.

### A placement API recreates target selection

```ts
profile.placement(AWS.serverless());
profile.placement(Kubernetes.on(cluster));
```

This is a multiple-target API under a different name. It adds an intermediate decision layer between the
provider binding and the physical plan.

### A substrate enum repeats provider facts

An Aurora provider is an AWS implementation. A Celld provider configured with a Kubernetes cluster uses
that cluster. An external ClickHouse provider owns nothing. Requiring a second
`"aws" | "kubernetes" | "external"` classification can drift from the implementation that matters.

### Installation authoring duplicates deployment state

Alchemy already requires stable state identity. The CLI and deployment state need a concrete deployment
name, but application source does not need `application.installation(...)` merely to repeat profile,
credentials, and region configuration.

## Canonical concepts

| Concept | Public meaning |
| --- | --- |
| Capability | The semantic dependency application behavior consumes. |
| Provider implementation | The concrete runtime and optional infrastructure implementation satisfying a capability. |
| Provider configuration | Typed provider-native account, cluster, endpoint, config, and Secret bindings passed to an implementation constructor. |
| Profile | An optional named bundle of provider bindings and assembly policy. |
| Deployment name | Operational identity selecting persisted deployment state; not application semantics. |
| Physical plan | The actual resources, runtime hosts, external bindings, lifecycle, and evidence derived from selected providers. |

The following are not new public application concepts:

- global deployment target;
- placement;
- substrate;
- application-authored installation;
- generic cloud environment;
- target adapter selected independently of providers.

Words such as AWS, Kubernetes, Lambda, pod, and external remain valid descriptions of actual physical plan
nodes and evidence. They do not become an additional selection system.

## Normative decisions

1. Typed provider bindings are the sole authority for implementation selection.
2. Profiles are the sole optional user-facing assembly-policy selector.
3. Applications with one assembly may use unconditional `application.provide(...)` and need no explicit
   profile declaration.
4. `--target` is removed from the canonical CLI before 1.0 and cannot override provider bindings.
5. `profile.placement(...)`, public substrate enums, and `application.installation(...)` are not introduced.
6. Provider implementations accept their own typed configuration and Secret bindings directly.
7. Reusable provider configuration is an ordinary typed TypeScript value such as `AWS.account(...)` or a
   `KubernetesCluster.current()`/`.external(...)` implementation value, not a generic framework
   environment abstraction.
8. Configuration objects contain references to typed config and Secret sources, never eagerly resolved
   Secret values.
9. Provider credentials do not enter callback closures or application contexts. The deployment provider
   and runtime host resolve Secret bindings at their authorized boundaries.
10. A typed provider configuration may be shared by multiple implementations without becoming an
    application capability merely because it exists.
11. When application behavior genuinely requires a low-level provider capability, it must be explicitly
    provided and its portability cost is plan-visible.
12. Provider resolution emits the actual runtime adapter, deployment contributor, physical resources,
    lifecycle, guarantees, maturity, evidence, and rejected alternatives.
13. Provider implementations may internally select among qualified physical hosts, such as Lambda versus
    Fargate, only when they preserve the semantic execution envelope and explain the decision.
14. Cross-provider network, identity, Secret, latency, data-egress, and lifecycle requirements are
    validated from the resulting physical graph before mutation.
15. The deployment implementation invariant remains absolute: Kubernetes API resources use TypeKro
    through Alchemy; non-Kubernetes managed infrastructure uses native or focused Alchemy resources;
    external implementations contribute no infrastructure.
16. Changing provider identity, account, region, cluster, endpoint, lifecycle owner, or state authority is
    a plan-visible migration unless compatibility evidence proves otherwise.
17. A deployment name identifies operational state and receipts. It never changes provider selection.
18. A provider implementation may depend on other typed capability implementations or capability
    references. Recursive implementation composition is canonical across every framework building block.
19. Passing an implementation value creates a private or reusable implementation dependency; passing a
    capability reference consumes the implementation selected for that separately bound capability.
20. Nested dependencies never become application-visible capabilities or grant transitive runtime
    authority unless they are also explicitly provided and used.

## Public profile surface

Unconditional assembly remains concise:

```ts title="src/application.ts"
const database = Database.externalPostgres({
  url: secret.env("DATABASE_URL"),
});

application.provide(PrimaryDatabase, database);
```

Applications with multiple supported assemblies use profiles:

```ts title="src/profiles.ts"
application.profile("development", profile => {
  profile.provide(PrimaryDatabase, Database.postgres.local());
  profile.provide(JobRuntime, JobRuntime.local());
});

application.profile("production", profile => {
  const aws = AWS.account({
    region: config.env("AWS_REGION"),
    credentials: secret.env("AWS_CREDENTIALS"),
  });

  profile.provide(PrimaryDatabase, Database.auroraPostgres({ account: aws }));
  profile.provide(JobRuntime, JobRuntime.aws({ account: aws }));
});
```

`application.profile(name, configure)` is an application-owned assembly registrar. Its callback has the
same typed binding semantics as application assembly:

```ts
interface ApplicationProfileBuilder {
  provide<T>(token: CapabilityToken<T>, implementation: CapabilityImplementation<T>): void;
  include(fragment: ApplicationProfileFragment): void;
  qualify(qualification: ProviderQualification): void;
  defaults(defaults: ProviderResolutionDefaults): void;
}
```

`profile.provide(...)` is the conditional profile-scoped form of `application.provide(...)`, not a second
DI system. Unconditional bindings form the base assembly. A selected profile may supply only explicitly
profile-owned bindings. Duplicate binding authorities fail with source-attributed diagnostics rather than
implicit precedence.

Reusable profile fragments are context-free typed values:

```ts
export const ProductionSafety = profileFragment("production-safety", profile => {
  profile.defaults({ retention: "retain", deletionApproval: "required" });
  profile.qualify(ProviderEvidence.production());
});
```

Fragments do nothing when imported. Inclusion is explicit; cycles and conflicting authorities fail closed.

## Concrete provider configuration

Provider constructors own their configuration schema and validate it before planning:

```ts
const aws = AWS.account({
  accountId: config.env("AWS_ACCOUNT_ID"),
  region: config.env("AWS_REGION"),
  credentials: secret.env("AWS_CREDENTIALS"),
});

const cluster = KubernetesCluster.external({
  endpoint: config.env.url("KUBERNETES_ENDPOINT"),
  credentials: secret.env("KUBERNETES_CREDENTIALS"),
  namespace: config.env("ACTOR_NAMESPACE"),
});

profile.provide(JobRuntime, JobRuntime.aws({
  account: aws,
  memory: "2Gi",
  maximumDuration: "20m",
}));

profile.provide(ActorRuntime, ActorRuntime.celld({ cluster }));
```

Provider-native configuration values are immutable, serializable references with stable identity and
Secret-safe provenance. They may contain:

- config bindings and validated non-secret literals;
- Secret bindings and expected Secret contracts;
- account, region, project, subscription, or cluster identity;
- endpoints and TLS trust references;
- provider sizing, durability, retention, and lifecycle policy;
- references to other typed provider configurations.

Maintained provider implementations also declare their physical deployment family as provider metadata.
The CLI derives a headless profile's AWS or Kubernetes deployment connection from that metadata, so a
workflow-only, operator-only, or batch-only application never has to declare a fictitious
`ApplicationHost`. If reachable implementations declare conflicting physical families and no canonical
host resolves the connection, planning fails closed rather than asking the application author for a
duplicate target selector.

They must not contain resolved credentials, ambient SDK clients, live sockets, process-global mutation, or
unbounded provider-private objects.

The public callback receives the semantic capability client, not provider configuration:

```ts
await ObjectStorage.put(key, contents);
```

It does not receive `context.awsCredentials`, kubeconfig, or a database URL unless the application
explicitly requested the corresponding low-level capability.

## Semantic declarations versus implementation assembly

This algebra does not turn every application primitive into `application.provide(...)`. Models, Jobs,
workflows, actors, projections, streams, queries, routes, and reconciler registrations declare semantic
application behavior through their canonical function-native or handle-owned APIs. `application.provide`
and `profile.provide` only bind replaceable capabilities used to execute or support that behavior.

Likewise, `OperatorRuntime.distributed(...)`, `JobRuntime.aws(...)`, or
`ApplicationHost.kubernetes(...)` construct implementation values; they do not register domain behavior.
The distinction is:

```text
semantic declaration  -> what the application means and owns
implementation value  -> how one capability is satisfied
provide                -> which implementation satisfies a top-level capability in this assembly
dependency edge        -> which lower-level implementations satisfy a higher-level implementation
```

Application-owned registrars may be lexically aliased for concise source, such as
`const workflow = application.workflow`. That registration rule is independent of dependency injection
and must not be used to justify provider-specific `application.*` methods.

## Composable implementation values

Every maintained provider constructor returns a typed implementation value. Higher-level implementations
may accept those values or references to separately bound capabilities:

```ts
type ImplementationDependency<TCapability> =
  | CapabilityReference<TCapability>
  | CapabilityImplementation<TCapability>;

interface CapabilityImplementation<TCapability> {
  readonly identity: CapabilityImplementationIdentity;
  readonly capability: CapabilityContractReference<TCapability>;
  readonly dependencies: readonly CapabilityImplementationDependency[];
  readonly configuration: ProviderConfigurationProvenance;
  readonly guarantees: readonly SemanticGuaranteeReference[];
  readonly runtimeAdapter: RuntimeAdapterReference;
  readonly deploymentContributor?: DeploymentContributorReference;
  readonly readiness: ReadinessObserverContract;
  readonly lifecycle: LifecycleClassification;
  readonly migration: ProviderMigrationContract;
  readonly evidence: ProviderEvidenceReference;
}

interface CapabilityImplementationDependency {
  readonly slot: string;
  readonly requirement: CapabilityRequirementReference;
  readonly input:
    | { readonly kind: "implementation"; readonly identity: CapabilityImplementationIdentity }
    | { readonly kind: "capability-reference"; readonly capability: CapabilityReference<unknown> };
  readonly visibility: "private" | "explicitly-provided";
}
```

The public TypeScript types preserve the exact capability and guarantee requirements for every dependency
slot. An analytical database cannot satisfy a transactional state-store slot merely because both expose a
query method. A development-only scheduler can typecheck as a scheduler implementation while production
qualification rejects its evidence.

### Integrated versus assembled implementations

One semantic runtime may have integrated and assembled implementations:

```ts
const cluster = KubernetesCluster.external({
  endpoint: config.env.url("KUBERNETES_ENDPOINT"),
  credentials: secret.env("KUBERNETES_CREDENTIALS"),
});

const kubernetesOperator = OperatorRuntime.kubernetes({ cluster });
```

or:

```ts
const database = Database.auroraPostgres({ account: aws });
const scheduler = Scheduler.eventBridge({ account: aws });

const distributedOperator = OperatorRuntime.distributed({
  database,
  scheduler,
});
```

Both values satisfy `OperatorRuntime`. `Resource.on.reconcile` and managed-model callbacks do not change.
The integrated Kubernetes implementation internally supplies watches, queues, leases, status, finalizers,
and resync. The assembled implementation proves equivalent guarantees through its database and scheduler
dependencies.

### Inline, shared, and exposed dependencies

An inline implementation dependency is provisioned and available to its parent implementation but is not
automatically visible to application callbacks:

```ts
profile.provide(
  OperatorRuntime,
  OperatorRuntime.distributed({
    database: Database.auroraPostgres({ account: aws }),
    scheduler: Scheduler.eventBridge({ account: aws }),
  }),
);
```

Reusing the same implementation value creates one implementation node with multiple consumers:

```ts
const database = Database.auroraPostgres({ account: aws });

profile.provide(PrimaryDatabase, database);
profile.provide(
  OperatorRuntime,
  OperatorRuntime.distributed({
    database,
    scheduler,
  }),
);
```

The same rule applies when several higher-level runtimes share one infrastructure implementation:

```ts
const cluster = KubernetesCluster.current();
const registry = ContainerRegistry.harbor({ cluster, project: "application" });

profile.provide(
  ApplicationHost,
  ApplicationHost.kubernetes({ cluster, registry }),
);
profile.provide(
  OperatorRuntime,
  OperatorRuntime.kubernetes({ cluster }),
);
profile.provide(
  ActorRuntime,
  ActorRuntime.celld({ cluster, registry }),
);
```

The plan contains one cluster node and one registry node with three consumer paths. Each consumer receives
only its declared provider-internal operations; sharing the cluster does not merge field ownership, and
sharing the registry does not grant image-push authority to the application host or actors.

Passing a capability reference consumes the separately selected binding and is preferable when the
dependency is part of public application assembly:

```ts
const ControlDatabase = TransactionalDatabase.named("control");

profile.provide(ControlDatabase, database);
profile.provide(
  OperatorRuntime,
  OperatorRuntime.distributed({
    database: ControlDatabase,
    scheduler,
  }),
);
```

The resolver does not structurally deduplicate two independent factory calls merely because their
configuration matches. Reusing one implementation value or referencing one capability is the authored
sharing signal. Explicit provider-native naming may supply stable identity where reuse crosses module or
generated-artifact boundaries.

### Deterministic implementation identity

Runtime object identity may help one compiler evaluation recognize reuse, but it is never persisted
identity. Every implementation node receives one deterministic authored identity by these rules:

1. A separately provided implementation derives identity from application identity, capability-token
   identity, provider constructor identity, binding/declaration provenance, and explicit provider-native
   name when one exists. The selected profile is recorded as decision provenance but is not itself part of
   lifecycle identity.
2. A named implementation value uses its explicit stable ID within the provider/capability identity
   domain. Duplicate IDs with incompatible configuration fail.
3. An unnamed value assigned to one statically discoverable declaration derives identity from its module
   provenance and declaration binding. Reusing that declaration preserves one node and every consumer
   edge.
4. An inline unnamed dependency derives identity from its parent implementation identity and typed
   dependency-slot path.
5. A capability reference resolves to the identity of the separately provided implementation; the
   reference does not create another node.
6. If aliasing, dynamic construction, module indirection, or serialization prevents the compiler from
   proving one declaration, shared lifecycle requires an explicit stable implementation ID. The compiler
   does not guess from equal configuration.

The compiled graph serializes implementation ID, identity version, provider constructor, capability,
profile binding provenance, parent/slot path where inline, explicit-name provenance, and configuration
digest excluding Secret values. Alchemy state and migration receipts use that identity rather than
process memory addresses.

The uncommon explicit escape hatch is uniform across provider implementations and deliberately distinct
from provider-native resource names:

```ts
const database = Database.postgres({
  cluster,
  database: "control",
}).identified("control-database.v1");
```

`identified(...)` sets logical implementation identity only. It does not rename a database, Kubernetes
object, Alchemy resource, Secret, endpoint, or capability token. Ordinary statically discoverable values
do not need it; diagnostics recommend it only when refactoring, dynamic construction, or shared lifecycle
would otherwise make identity unstable.

Moving or renaming an unnamed declaration may produce an identity migration. `applik8s plan` explains the
change and suggests an explicit stable ID when preserving identity is intended. Changing only a consumer
does not rename a reused dependency. Two IDs that claim one canonical physical resource fail before
mutation even when their semantic implementation identities differ.

Renaming a profile while its binding declaration remains the same does not rename the implementation.
Moving an unnamed declaration between modules or profile fragments may change authored provenance; when no
explicit stable ID exists, the planner emits a proposed identity migration rather than silently replacing
state. Provider, configuration, physical identity, and lifecycle changes remain independently
migration-significant.

### Recursive resolution invariants

Recursive implementation planning must:

1. preserve stable implementation identity and source provenance;
2. resolve capability references through the selected profile;
3. validate each dependency's semantic contract and required guarantees;
4. reject missing bindings, dependency cycles, and ambiguous identities with the complete dependency path;
5. materialize a reused implementation once while retaining every consumer edge;
6. preserve exactly one lifecycle authority for every physical resource;
7. create dependencies before consumers and delete consumers before dependencies;
8. keep shared, singleton, retained, and external lifecycle contracts explicit;
9. reject two implementation nodes that claim the same physical identity independently;
10. propagate readiness and migration impact through dependency edges without collapsing status authority;
11. infer application runtime access only from explicit closure capability use;
12. grant provider-internal runtime access separately and only for declared dependency operations;
13. never expose nested credentials, clients, or capabilities through the parent callback context;
14. preserve dependency identity and resumable lifecycle state in compiled artifacts and Alchemy state.

Required diagnostics include `PROVIDER_IMPLEMENTATION_IDENTITY_UNSTABLE`,
`PROVIDER_IMPLEMENTATION_IDENTITY_COLLISION`, and `PROVIDER_IMPLEMENTATION_RENAME_MIGRATION` in addition
to the dependency and physical-identity diagnostics below.

### Framework-wide building-block standard

The same composition rule applies across the maintained domain:

| Higher-level implementation | Representative typed dependencies |
| --- | --- |
| `OperatorRuntime.kubernetes(...)` | Kubernetes cluster implementation/reference |
| `OperatorRuntime.distributed(...)` | transactional database, scheduler, optional queue/lease implementations |
| `ManagedModelStore.*(...)` | database or Kubernetes cluster implementation/reference |
| durable `JobRuntime` | queue, execution host, result/progress store, scheduler |
| `WorkflowEngine` | durable store, queue, scheduler, execution host |
| `ActorRuntime` | cluster or compute implementation, durable store, object storage, scheduler/alarms |
| request/HTTP runtime | application host, identity admission, authorization, command/query/stream gateways |
| command/query/stream gateway | identity admission, authorization, cursor/envelope authority, semantic runtime/store |
| application-event/stream runtime | source outbox/log, consumer-state store, execution host |
| query-batch runtime | query source, finite Job runtime, checkpoint/result store |
| saga coordinator | Workflow engine and receipt/effect stores |
| signal/approval runtime | transactional store, outbox/event publication, authority receipt store |
| projection/index runtime | source log/query, destination store, rebuild Job runtime |
| object-storage runtime | object backend, intent/envelope authority, metadata store, optional upload gateway |
| search implementation | source/index store, ingestion Job or stream runtime, embedding/inference implementation |
| analytical projection implementation | source log/query, analytical database, checkpoint store, rebuild Job runtime |
| identity and authorization implementation | identity directory/session verifier, policy or relationship store, receipt/version authority |
| billing implementation | billing provider, transactional entitlement store, event ingress, reconciliation runtime |
| application host | artifact/registry, execution environment, networking, Secret/config projection, health contract |
| HTTP/DNS/TLS exposure | application endpoint, router/load balancer, certificate, DNS publication implementations |
| ML implementation | inference host/endpoint, model artifact store, optional batching runtime |
| `codeAgent()` / `researchAgent()` | Actor runtime, agent harness, workspace/search/browser/evidence capabilities |
| Builder | code-agent implementation, repository, workspace, process, preview, and journey implementations |

Each higher-level constructor accepts only the dependencies its semantic guarantee requires. Convenience
presets may assemble recommended defaults, but their result is an ordinary inspectable implementation
value with the same dependency graph.

### Building-block conformance rules

Every maintained provider family is audited against one shape before v0.9 freezes:

1. Semantic application behavior depends on a capability, never a provider client or infrastructure
   resource.
2. The top-level application assembly binds that capability to one inspectable implementation value.
3. A higher-level implementation accepts lower-level implementation values or capability references in
   named, typed dependency slots; it does not reach into a process-global registry or silently provision a
   hidden prerequisite.
4. Inline dependencies remain private provider machinery. A callback receives them only when application
   source explicitly consumes their capability.
5. Reusing one value or one capability reference is the only implicit sharing signal. Presets may name and
   expose their constituent implementation graph but may not erase it.
6. Runtime adaptation, deployment contribution, readiness, lifecycle, migration, evidence, and authority
   remain separable for every node in the graph.
7. Provider-internal access is least-privilege and derived from declared dependency operations. It is not
   inherited as the union of every operation the dependency could perform.
8. A graph containing the same physical resource under two lifecycle authorities fails before mutation.

The v0.9 work is therefore not complete merely because provider constructors accept nested objects. The
compiler and plan must recognize those objects as typed implementation nodes, preserve their identity and
edges, and apply the recursive invariants above. Existing flat provider records in the v0.8 implementation
are migration input, not evidence that this contract has already been attained.

### v0.8 provider-registry migration audit

The existing public registry is normalized deliberately rather than replaced with a second provider API:

| Existing family | v0.9 implementation dependency treatment |
| --- | --- |
| `IndexStore`, `ModelStore`, `CounterStore` | accept the concrete database, cache, Kubernetes cluster, or state-store implementation that owns persistence |
| `EventSource`, `EventLog`, `Queue` | expose integrated implementations or compose source/log, delivery, checkpoint, scheduler, and execution implementations explicitly |
| `Secret`, `CredentialStore` | accept typed Secret authority/backend implementations; never pass resolved values or ambient credential clients |
| `ObjectStorage` | compose backend, metadata/intents, envelope authority, and gateway only where the selected implementation requires them |
| `HttpExposure`, `Certificate`, `DnsPublication` | compose from an application endpoint and independently replaceable routing, certificate, and DNS implementations |
| `WorkflowEngine` | preserve one engine capability while making durable store, queue, scheduler, and execution-host dependencies inspectable |
| `ProjectionStore` | become one destination-store implementation consumed by projection runtimes rather than silently owning replay or worker infrastructure |
| `ContainerRegistry` | compose registry endpoint/service, credential authority, artifact publication, and lifecycle management without exposing push credentials to callbacks |
| `ApplicationHost` | accept artifact/registry, execution environment or cluster, networking, Secret/config projection, and health implementations |
| `RequestIdentity`, `Authorization` | keep authentication and policy decisions distinct while composing explicit directory/session, policy/relationship, receipt, and version authorities |
| `StructuredGeneration` and future inference providers | accept endpoint/host, credential, model-routing, usage, and optional batching implementations behind one semantic generation capability |

Existing compact constructors may remain as convenience presets when they return the same graph described
above. A preset must not hide a separately lifecycle-owned service, depend on an ambient singleton, or
make a private dependency callable from application code. Default implementations are ordinary named
implementation values selected by explicit assembly policy; they are not special compiler branches.

## Normative AWS and Kubernetes golden profiles

v0.9 must deliver Chirp with unchanged semantic source while two complete production profiles satisfy the
same bounded capability set. Chirp owns this gate because it is already the distributed-systems and
provider-composition pressure test; GuestBook remains the readability floor and Agentic Start remains the
production-shaped product convention. This is not broad multi-cloud parity. It is a deliberately narrow
proof that the profile and recursive implementation model works as a product rather than as disconnected
provider demonstrations.

The minimum shared capability set is:

- primary transactional database and managed-model store;
- `OperatorRuntime`;
- finite `JobRuntime`;
- `ApplicationHost` with immutable artifact, readiness, and graceful shutdown;
- object storage;
- durable application event log;
- analytical database and lakehouse query/dataset capabilities used by Chirp's maintained product
  experience;
- container registry;
- HTTP exposure, certificate, and DNS publication.

The shared set is derived from Chirp's unchanged semantic source and user-visible product behavior, not
from whichever constructors are easiest to lower. A profile may not leave an authored analytics handle
bound to an older ambient/default provider while claiming complete AWS or Kubernetes production parity.

For the maintained profiles:

- local analytics requires real DuckDB publication/query evidence;
- Kubernetes analytics requires a maintained provider such as ClickHouse with live readiness, query,
  update, recovery, schema-evolution, cancellation, pagination, and teardown evidence; and
- AWS analytics requires real Athena/Glue/S3 IAM, encryption, catalog-propagation, query, cancellation,
  retention, cost-boundary, drift, and cleanup evidence.

AWS cleanup authority is resource-scoped and fail-closed. A dataset publisher may always remove its own
exact staging lease objects, but unretained snapshot objects and Glue tables remain intact unless the
application explicitly opts into `forceDeleteUnretainedData`. Qualification fixtures use that same public
flag with a unique per-run dataset prefix and catalog identity; there is no ambient test-mode bypass. The
opt-in grants `s3:DeleteObject` only beneath the dataset's canonical prefix and `glue:DeleteTable` only for
its exact catalog database/table scope. Runtime cleanup additionally requires the deterministic snapshot
table identity and matching Applik8s dataset ownership metadata. Tests must prove neighboring S3 keys and
foreign Glue tables survive. Query workloads remain read-only against dataset objects and Glue metadata
regardless of the publisher's cleanup policy.

Chirp's maintained production profiles commit v0.9 to these analytical/lakehouse capabilities. They may not
be removed from the product behavior, plan, tutorial, or maturity claim to make the release pass. A
deterministic or simulated provider cannot qualify a real AWS or Kubernetes claim; failure of either live
production profile blocks v0.9.

### Frozen provider-constructor vocabulary

Provider implementations are discovered beneath the semantic capability they satisfy:

```text
Database.auroraPostgres(...)       Database.postgres(...)
OperatorRuntime.distributed(...)   OperatorRuntime.kubernetes(...)
JobRuntime.aws(...)                JobRuntime.kubernetes(...)
FiniteExecutionHost.aws(...)       FiniteExecutionHost.kubernetes(...)
Scheduler.eventBridge(...)         Scheduler.postgres(...)
Queue.sqs(...)                     Queue.jetStream(...)
JobResultStore.postgres(...)       shared portable implementation
ApplicationHost.aws(...)           ApplicationHost.kubernetes(...)
ObjectStorage.s3(...)              ObjectStorage.rookCeph(...)
EventLog.kinesis(...)              EventLog.jetStream(...)
Lakehouse.athenaQueries(...)       AnalyticalDatabase.clickhouse(...)
ContainerRegistry.ecr(...)         ContainerRegistry.harbor(...)
HttpExposure.aws(...)              HttpExposure.kubernetes(...)
Certificate.acm(...)               Certificate.certManager(...)
DnsPublication.route53(...)        DnsPublication.externalDns(...)
```

Provider namespaces such as `AWS` and `Kubernetes` construct reusable account/cluster configuration and
lower-level infrastructure implementations. They do not own parallel aliases such as
`AWS.managedJobs(...)` or `AWS.s3(...)` for the semantic provider constructors above.

### AWS profile

```ts title="src/profiles/production-aws.ts"
application.profile("production-aws", profile => {
  const account = AWS.account({
    accountId: config.env("AWS_ACCOUNT_ID"),
    region: config.env("AWS_REGION"),
    credentials: secret.env("AWS_CREDENTIALS"),
  });

  const database = Database.auroraPostgres({
    account,
    database: "application",
    retention: "retain",
  });
  const scheduler = Scheduler.eventBridge({ account });
  const queue = Queue.sqs({ account });
  const jobResults = JobResultStore.postgres({ database });
  const registry = ContainerRegistry.ecr({ account });
  const eventLog = EventLog.kinesis({ account });
  const researchSearch = WebSearch.searxng({
    endpoint: config.env.url("SEARXNG_ENDPOINT"),
    credentials: secret.env.optional("SEARXNG_CREDENTIALS"),
  });
  const researchRetriever = SourceRetriever.http({
    network: NetworkPolicy.publicWeb({ denyPrivateRanges: true }),
  });
  const jobHost = FiniteExecutionHost.aws({ account, registry });
  const host = ApplicationHost.aws({ account, registry });
  const certificate = Certificate.acm({
    account,
    domain: config.env("APPLICATION_DOMAIN"),
  });
  const dns = DnsPublication.route53({
    account,
    zone: config.env("ROUTE53_ZONE"),
    hostname: config.env("APPLICATION_DOMAIN"),
  });

  profile.provide(PrimaryDatabase, database);
  profile.provide(Workspace.store, ManagedModelStore.postgres({ database }));
  profile.provide(
    OperatorRuntime,
    OperatorRuntime.distributed({ database, scheduler, queue }),
  );
  profile.provide(
    JobRuntime,
    JobRuntime.aws({
      account,
      queue,
      executionHost: jobHost,
      results: jobResults,
      scheduler,
      events: eventLog,
    }),
  );
  profile.provide(ApplicationHost, host);
  profile.provide(
    Attachments,
    ObjectStorage.s3({
      account,
      bucket: "application-attachments",
      retention: "retain",
    }),
  );
  profile.provide(EventLog, eventLog);
  profile.provide(ResearchSearch, researchSearch);
  profile.provide(ResearchRetriever, researchRetriever);
  profile.provide(ContainerRegistry, registry);
  profile.provide(Certificate, certificate);
  profile.provide(DnsPublication, dns);
  profile.provide(
    HttpExposure,
    HttpExposure.aws({ account, host, certificate, dns }),
  );
});
```

The AWS implementations use native or focused Alchemy resources. `FiniteExecutionHost.aws(...)` may
choose among maintained Lambda, ECS/Fargate, or Batch execution hosts only when the semantic execution
envelope permits the choice and the plan explains it. `JobRuntime.aws(...)` coordinates through the
explicit host, queue, result, scheduler, and event implementations. The profile does not emit
CloudFormation.

### Kubernetes profile

```ts title="src/profiles/production-kubernetes.ts"
application.profile("production-kubernetes", profile => {
  const cluster = KubernetesCluster.current();
  const database = Database.postgres({
    cluster,
    database: "application",
    storage: { size: "100Gi" },
    retention: "retain",
  });
  const eventLog = EventLog.jetStream({
    cluster,
    replicas: 3,
    storage: { size: "50Gi" },
  });
  const researchSearch = WebSearch.searxng({
    cluster,
    name: "research",
  });
  const researchRetriever = SourceRetriever.http({
    cluster,
    network: NetworkPolicy.publicWeb({ denyPrivateRanges: true }),
  });
  const jobQueue = Queue.jetStream({ eventLog });
  const scheduler = Scheduler.postgres({ database });
  const jobResults = JobResultStore.postgres({ database });
  const registry = ContainerRegistry.harbor({
    cluster,
    project: "application",
  });
  const jobHost = FiniteExecutionHost.kubernetes({ cluster, registry });
  const host = ApplicationHost.kubernetes({ cluster, registry });
  const certificate = Certificate.certManager({
    cluster,
    issuerRef: { name: "letsencrypt", kind: "ClusterIssuer" },
  });
  const dns = DnsPublication.externalDns({
    cluster,
    hostname: config.env("APPLICATION_DOMAIN"),
  });

  profile.provide(PrimaryDatabase, database);
  profile.provide(Workspace.store, ManagedModelStore.postgres({ database }));
  profile.provide(OperatorRuntime, OperatorRuntime.kubernetes({ cluster }));
  profile.provide(
    JobRuntime,
    JobRuntime.kubernetes({
      cluster,
      queue: jobQueue,
      executionHost: jobHost,
      results: jobResults,
      scheduler,
      events: eventLog,
    }),
  );
  profile.provide(ApplicationHost, host);
  profile.provide(
    Attachments,
    ObjectStorage.rookCeph({
      cluster,
      storageClassName: "ceph-bucket",
      retention: "retain",
    }),
  );
  profile.provide(EventLog, eventLog);
  profile.provide(ResearchSearch, researchSearch);
  profile.provide(ResearchRetriever, researchRetriever);
  profile.provide(ContainerRegistry, registry);
  profile.provide(Certificate, certificate);
  profile.provide(DnsPublication, dns);
  profile.provide(
    HttpExposure,
    HttpExposure.kubernetes({ cluster, host, certificate, dns }),
  );
});
```

Every Namespace, CRD, operator, Helm release, workload, Service, policy, certificate, and DNS-related
Kubernetes object is composed with TypeKro and deployed through TypeKro's Alchemy integration. The
profile does not construct raw Kubernetes resources or invoke a second deployment engine.

`WebSearch.searxng({ cluster, ... })` creates its deterministic Namespace through TypeKro when no
namespace is supplied. Supplying `namespace` means the Namespace is an injected, externally owned
dependency and the provider does not create or delete it; no separate namespace-ownership flag exists.
`WebSearch.searxng({ endpoint, credentials })` binds an externally managed deployment and contributes no
infrastructure. Both forms satisfy the same `ResearchSearch` capability and provider conformance suite.

### Golden-profile evidence

The same Chirp semantic source and journeys must pass both profiles. The maintained research acceptance
application likewise keeps its semantic source unchanged while the profiles select managed Kubernetes or
external SearXNG. Qualification requires:

1. deterministic `plan`, apply, update, drift repair, reconciliation, and dependent-first teardown;
2. actual live readiness for every capability in the minimum set;
3. one shared implementation node when a database, queue, registry, event log, or cluster value is reused;
4. no transitive callback authority from private scheduler, queue, cluster, registry, or credential
   dependencies;
5. identical managed-model reconcile behavior and finite-Job lifecycle semantics;
6. immutable artifact and endpoint evidence, including certificate and DNS readiness;
7. retained-data behavior and explicit destructive-deletion authority;
8. the same research-agent journey through managed Kubernetes SearXNG and externally bound SearXNG,
   including safe retrieval, evidence persistence, restart recovery, provider replacement, and teardown;
9. exact TypeKro/Alchemy implementation-boundary validation;
10. source-attributed plan differences that explain physical resources, lifecycle, guarantees, maturity,
   cost-relevant configuration, and rejected alternatives; and
11. clean packed-consumer and package-isolation tests proving one profile does not eagerly import the
    other's provider SDKs or deployment packages.

## Deployment identity

Deployment still requires a stable operational identity for Alchemy state, updates, migration, and
teardown. That identity belongs to CLI/project configuration:

```bash
applik8s deploy --profile production
applik8s deploy --profile production --name production-us
```

For the common case, the deployment name defaults deterministically from project and profile. Multiple
deployments may use the same profile with different externally resolved configuration values and names.

The deployment record contains profile digest, application digest, config/Secret provenance digests,
provider resolutions, physical identities, migration state, and receipts. It is not authored as an
application graph node and cannot override provider bindings.

`--environment` may remain a configuration-source convenience only if it cannot select providers or
deployment machinery independently of the profile. `--profile`, `--name`, and configuration-source flags
have non-overlapping authority.

## Resolution algorithm

Resolution is deterministic:

1. Load the canonical semantic application graph.
2. Select the profile, or the implicit default assembly when no profiles exist.
3. Compose profile fragments and reject duplicate/conflicting binding authorities.
4. Resolve every semantic capability through typed provider bindings and qualifications.
5. Recursively resolve implementation-value and capability-reference dependencies, preserving sharing and
   rejecting cycles or ambiguous identity.
6. Validate each provider's typed configuration, Secret provenance, dependency contracts, and guarantees.
7. Ask each provider for its semantic guarantees, runtime adapter, optional deployment contributor,
   lifecycle, maturity, evidence, and physical requirements.
8. Allow a provider to choose among its qualified internal hosts only when the execution envelope permits
   every candidate and the choice is deterministic.
9. Build the actual physical resource/dependency graph.
10. Validate cross-provider network, identity, Secret, data, lifecycle, and migration requirements.
11. Emit one deterministic `ApplicationPlan` with source provenance and rejected alternatives.

No stage may mutate the semantic application graph to make a provider implementation convenient.

## ApplicationPlan contract

The alpha.1 `ApplicationPlan.resolution` now carries the canonical recursive
`ApplicationImplementationPlan` alongside legacy capability-resolution facts.
Each capability resolution links to its canonical implementation identity;
the identity registry, validator, serializer, diff, text explanation, and graph
renderer all include implementation nodes and their private/reused dependency
edges. The compiler accepts this plan as an explicit discovered input and
preserves it into the emitted `application-plan.json`. Automatic discovery
from the new profile authoring surface remains the next implementation step;
the compiler does not infer a v0.9 implementation graph from installed
packages or silently reinterpret legacy target selection.

The plan records provider resolution and actual physical outputs rather than a global target, placement,
or substrate authority:

```ts
interface ApplicationProviderResolutionPlan {
  semanticRequirement: ApplicationGraphNodeReference;
  provider: ProviderImplementationReference;
  dependencies: readonly ProviderImplementationDependencyPlan[];
  configuration: ProviderConfigurationProvenance;
  runtimeAdapter: RuntimeAdapterReference;
  deployment?: {
    contributor: DeploymentContributorReference;
    resources: readonly PhysicalResourceReference[];
  };
  external?: ExternalBindingReference;
  executionHost?: PhysicalExecutionHostReference;
  lifecycle: LifecycleClassification;
  guarantees: readonly SemanticGuaranteeReference[];
  maturity: ProviderMaturity;
  evidence: readonly ConformanceReceiptReference[];
  decision: ProviderDecisionProvenance;
}
```

Physical references name what actually exists, for example an Alchemy `AWS.Lambda.Function`, an
`AWS.ECS.TaskDefinition`, a TypeKro composition, a Kubernetes resource emitted by that composition, or an
external endpoint binding. Derived summaries may group evidence by AWS, Kubernetes, local, or external
provider families, but those summaries do not become selection authority.

The TypeKro/Alchemy deployment boundary is validated from the actual contributor and resources. Provider
authors do not copy a public substrate field that can disagree with implementation.

## `explain` and diagnostics

`applik8s explain` answers:

- Which profile was selected?
- Which source selected each provider implementation?
- Which typed configuration and Secret bindings does it require?
- Which implementation dependencies were inlined, shared, or resolved through capability references?
- Which dependencies are private provider machinery versus explicitly application-visible capabilities?
- What runtime adapter will callbacks receive?
- What physical resources and execution hosts will exist?
- Why did an AWS job provider select Lambda, Fargate, or Batch?
- Which guarantee rejected another implementation?
- What crosses provider or network boundaries?
- Which resources are managed, shared, external, or retained?
- What changes if another profile is selected?

Required diagnostics include:

- `PROFILE_NOT_SELECTED`
- `PROFILE_BINDING_CONFLICT`
- `PROFILE_FRAGMENT_CYCLE`
- `PROFILE_PROVIDER_INCOMPATIBLE`
- `PROVIDER_DEPENDENCY_MISSING`
- `PROVIDER_DEPENDENCY_INCOMPATIBLE`
- `PROVIDER_DEPENDENCY_CYCLE`
- `PROVIDER_IMPLEMENTATION_IDENTITY_AMBIGUOUS`
- `PROVIDER_IMPLEMENTATION_IDENTITY_UNSTABLE`
- `PROVIDER_IMPLEMENTATION_IDENTITY_COLLISION`
- `PROVIDER_IMPLEMENTATION_RENAME_MIGRATION`
- `PROVIDER_PHYSICAL_IDENTITY_CONFLICT`
- `PROVIDER_CONFIGURATION_INVALID`
- `PROVIDER_SECRET_BINDING_INVALID`
- `PROVIDER_HOST_UNSATISFIABLE`
- `PROVIDER_GUARANTEE_WEAKENED`
- `PROVIDER_NETWORK_UNAVAILABLE`
- `PROVIDER_EVIDENCE_INSUFFICIENT`
- `DEPLOYMENT_IMPLEMENTATION_BOUNDARY_VIOLATION`
- `DEPLOYMENT_NAME_CONFLICT`
- `LEGACY_TARGET_SELECTOR_FORBIDDEN`
- `PROFILE_MIGRATION_REQUIRED`

Every failure names the semantic requirement, selected profile, binding source, provider configuration,
rejected implementation or host, missing guarantee, and concrete remediation.

## Lifecycle and migration

Changing a profile name does not itself define migration. The planner compares provider identity, physical
resource identity, account/region/cluster/endpoint identity, lifecycle authority, state authority, and
compatibility evidence.

Migration classes include:

- implementation-only compatible update;
- provider replacement;
- execution-host replacement;
- stateful data migration;
- ownership transition between managed/shared/external;
- deployment rename or split;
- unsupported cross-provider migration requiring explicit export/import or retention.

Running the same source against different providers does not imply live migration between them.

Persisted v0.8 plans containing a global target remain readable through a versioned compatibility decoder.
The decoder reconstructs provider and physical-resource facts only when the recorded plan makes them
unambiguous. It never writes new target-shaped authority. Reading is not active-state adoption. The
[ApplicationPlan and Deployment-State Migration RFP](./rfp-v09-application-plan-and-deployment-state-migration.md)
owns source-baseline qualification, physical identity mapping, Alchemy/TypeKro state adoption,
lifecycle-authority transfer, interruption recovery, rollback, GitOps procedures, and deletion during
migration. Ambiguous state fails before mutation with migration guidance.

## Documentation vocabulary

Ordinary documentation teaches:

```text
capability   what application behavior needs
provider     how that capability is implemented
profile      which provider bundle is selected
configuration typed inputs supplied to those providers
plan         what runtime and infrastructure those bindings produce
```

Documentation may say “AWS provider,” “Kubernetes implementation,” or “external database” when describing
real implementations and evidence. It does not teach target, placement, substrate, or installation as
additional application assembly concepts.

A named Kubernetes cluster may be a provider configuration value or an explicitly injected capability. It
does not imply where the rest of the application runs. Likewise, using S3 does not classify the whole
application as an AWS target.

## Package boundary

Core profile contracts belong with application assembly. Provider configuration types belong to their
provider packages. Physical planning belongs to deployment/provider packages. Kubernetes and AWS
dependencies stay outside semantic profile types and load only when their implementations are selected.

No profile package may eagerly import all providers. Optional presets return typed profile fragments or
profile constructors and preserve package pruning.

## Implementation sequence

### Current implementation status

The target-free profile registrar, deterministic recursive resolver, digest-bound plan-set artifact, and
deployment-time profile selection are implemented. Maintained database, search, object-storage,
workflow, scheduling, actor, and analytics constructors now carry inspectable implementation metadata
automatically, including reusable private dependency edges. Application authors use the constructors
directly; `defineApplicationCapabilityImplementation(...)` remains a provider-author seam.

The first configuration contract is also implemented: `config.env(...)`, typed URL/integer/boolean
variants, and `secret.env(...)` produce immutable source references with deterministic, Secret-safe
provenance. They never read `process.env` while authoring the application and never place resolved Secret
values in implementation plans or configuration digests.

Increment 3 remains in progress until every maintained constructor accepts its provider-native binding
types and the deployment compiler resolves those bindings into explicit runtime projections. Increment 4
physical resource planning and Increment 5 active-state migration remain open. The exact v0.7.1 baseline
is recorded, but active-state writes remain prohibited until the executable handoff fixture passes; that
does not block these additive semantic contracts.

### Increment 1 — Contract and vocabulary

- Freeze profile, provider-configuration, provider-resolution, deployment-name, and physical-plan schemas.
- Remove target, placement, substrate, and installation from new public assembly contracts.
- Add the read-only compatibility decoder and mapping proposal for persisted target-shaped plans; do not
  adopt active state in this increment.
- Reserve stable diagnostics.

### Increment 2 — Deterministic profile resolution

- Implement profile-scoped provider bindings and fragment composition.
- Add conflict, cycle, provenance, and deterministic digest checks.
- Implement deterministic authored implementation identity, artifact serialization, rename diagnostics,
  and Alchemy-state lookup before provider materialization.
- Resolve implementation dependencies recursively, preserving sharing, consumer edges, privacy, and one
  lifecycle authority per physical identity.
- Ensure installed packages never select providers implicitly.

### Increment 3 — Concrete provider configuration

- Add typed provider-native configuration values with config/Secret provenance.
- Normalize the v0.8 provider registry through the migration audit above; retain compact constructors only
  as inspectable presets over the same implementation graph.
- Prove reusable configuration does not leak credentials into callbacks, graph, plan, status, or state.
- Validate provider requirements and cross-provider physical dependencies before mutation.

### Increment 4 — Physical planning and explanation

- Emit actual runtime adapters, contributors, resources, external bindings, and execution hosts.
- Add provider-internal host-decision evidence.
- Integrate physical resource provenance into `plan` and `explain`.

### Increment 5 — CLI, migration, and qualification

- Make `--profile` and optional operational `--name` canonical.
- Remove `--target` before 1.0 and prevent `--environment` from selecting providers.
- Execute the versioned active-state migration protocol, including lifecycle-authority transfer,
  interruption recovery, rollback, forward recovery, and GitOps procedures.
- Qualify local, Kubernetes, AWS, external, and mixed-provider profiles through maintained journeys.
- Qualify the normative `production-aws` and `production-kubernetes` profiles against the same maintained
  application and minimum capability set.
- Prove deterministic plan/apply/update/migrate/delete and package isolation.

## Acceptance

- A developer selects at most one profile and never separately chooses a target, placement, or substrate.
- A simple application with unconditional providers requires no explicit profile.
- Provider constructors accept typed credentials, config, endpoint, account, region, and cluster bindings
  directly.
- Shared provider configuration is reusable without creating ambient credentials or a generic environment
  abstraction.
- Higher-level implementations accept nested implementation values or capability references and preserve
  one recursively inspectable dependency graph.
- Reusing one implementation value or capability binding materializes one implementation node; separate
  factory calls remain separate even when their configuration is equal.
- Nested dependencies remain private unless explicitly provided and do not grant transitive callback
  authority.
- Dependency cycles, capability/guarantee mismatches, and duplicate physical ownership fail before
  mutation with their complete dependency paths.
- Callback closures receive semantic capabilities, never provider credentials by default.
- One profile can bind HTTP/jobs to AWS providers, actors to a Kubernetes Celld provider, and analytics to
  external ClickHouse without classifying the whole application.
- The plan reports actual runtime adapters, resources, external bindings, hosts, lifecycle, guarantees,
  maturity, and evidence.
- No authoritative global target, placement, substrate, or application installation appears in the new
  stable graph or plan.
- An AWS managed-job provider deterministically explains Lambda versus Fargate/Batch selection from the job
  execution envelope.
- Cross-provider network, identity, Secret, lifecycle, and data requirements fail before mutation when
  unsatisfied.
- Kubernetes resources use TypeKro through Alchemy, non-Kubernetes managed resources use native/focused
  Alchemy, and external providers contribute no resources.
- `--profile production --target aws` fails with `LEGACY_TARGET_SELECTOR_FORBIDDEN` rather than applying
  precedence.
- Profile, provider-configuration, and deployment-state digests are deterministic and Secret-safe.
- Existing target-shaped persisted artifacts either migrate deterministically or fail with actionable
  guidance.
- GuestBook, Chirp, and Agentic Start use profiles and direct provider bindings as their only assembly
  model.
- Chirp passes the complete AWS and Kubernetes profile evidence contract,
  including database, reconciliation, Jobs, hosting, object storage, event log, registry, and public HTTP.

## Non-goals

- a general target/plugin marketplace;
- public placement or substrate abstractions;
- `application.installation(...)`;
- a generic cloud environment wrapper;
- string-matched provider selection;
- universal cross-provider live migration;
- identical cost, latency, availability, or scaling across implementations;
- hiding explicit provider-specific portability constraints;
- selecting providers from installed packages;
- adding provider vocabulary to domain callbacks;
- replacing TypeKro or Alchemy.

## Final decision

Profiles optionally group typed provider bindings. Provider implementations accept their own typed
configuration and Secret bindings directly. Provider resolution produces the actual runtime and physical
plan. Target, placement, substrate, and application-authored installation are not independent public
abstractions.
