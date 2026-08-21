# RFP: Applik8s v0.8 — Portable Local Runtime and AWS Deployment

**Status:** Accepted v0.8 implementation contract. The local runtime and target/plan contract aim for stable; each AWS
provider remains experimental until its own guarantee manifest and real-target gates qualify it. Release
publication remains separately authorized.

**Manifesto:** [`manifesto-v08-portable-stateful-development.md`](manifesto-v08-portable-stateful-development.md)

**Foundation gate:** The stable `graph-provenance` gate must pass before target lowering is considered
qualified.

**Foundation dependencies:** The v0.7 application graph, schema-derived profiles, qualified dependency
injection, Alchemy deployment graph, TypeKro Kubernetes lowering, generated ApplicationHost, provider
contracts, operation authority, runtime diagnostics, Agentic Start distribution, and the manifesto's
Phase 0 target/provider/native-plan records

**v0.8 contract integrations:** Canonical application plan, inferred runtime access, unified
observability, function-native scheduling, lakehouse query, and actor provider target requirements. These
consume shared Phase 0 records and do not require each other's complete implementations before the local
or target contract can be built.

**Unblocks:** A fast Kubernetes-optional development loop, AWS production deployments backed by
managed services, MiniStack-backed AWS fidelity testing, and one application definition that can move
between local processes, AWS, and Kubernetes without changing domain code

## Purpose

Make Kubernetes an available fidelity and production target rather than a prerequisite for ordinary
local development. At the same time, add a coherent AWS target whose managed resources are owned by
Alchemy providers rather than represented as Kubernetes resources or TypeKro factories.

This RFP does not introduce a second application graph. The existing Applik8s graph remains the
semantic source of truth. Local processes, local containers, AWS resources, and Kubernetes resources
are alternative lowerings of typed application capabilities.

MiniStack is an implementation tool for AWS-compatible local execution. It is not a public Applik8s
capability, application profile, or source-level provider identity. A provider selected for AWS uses
the same graph contract against MiniStack or AWS; the deployment target supplies endpoint, account,
region, and credential policy.

The local supervisor contract is package-owned by this RFP. The development daemon hosts and composes
that supervisor during `applik8s dev`; it does not redefine process identity, leases, endpoint brokering,
recovery, or teardown semantics.

## Required developer experience

The default local loop is deliberately small:

```sh
bun create applik8s my-product --start agentic
cd my-product
bun install
applik8s dev
```

`applik8s dev` starts a stable local supervisor, the generated web application, captured handlers,
required stateful dependencies, file watching, and the independent development portal. It does not
require a Kubernetes cluster, container registry, Helm, Flux, or KRO.

AWS API fidelity is an explicit target:

```sh
applik8s dev --target aws-local
```

This uses the same AWS provider lowering that production uses, but points supported service clients
and Alchemy resources at a managed MiniStack process. Unsupported or materially divergent services
fail during planning; they do not silently fall back to a different semantic provider.

Production deployment remains one graph operation:

```sh
applik8s plan --target aws --environment production
applik8s deploy --target aws --environment production
```

Kubernetes remains available:

```sh
applik8s deploy --target kubernetes --environment production
```

Application code consumes qualified capabilities, not cloud SDK configuration:

```ts
const PrimaryDatabase = TransactionalDatabase.named("primary");
const Events = EventSource.named("application-events");
const Attachments = ObjectStorage.named("attachments");

const deployment = application.profile(Installation, {
  profile: installation => installation.spec.profile,
});

deployment
  .provide(PrimaryDatabase)
  .developer(() => Database.postgres({ name: "primary" }))
  .dedicated(() => Database.postgres({ name: "primary" }))
  .external(spec => Database.externalPostgres(spec.database));
```

The selected deployment target decides how a compatible declaration is realized. The application
does not branch on `MiniStack`, `AWS`, `Docker`, or `Kubernetes` inside domain code.

## Owned contracts

This RFP owns:

- the local runtime supervisor and its process/container lifecycle;
- the distinction between application profile and deployment target;
- provider target descriptors for `local`, `aws-local`, `aws`, and `kubernetes`;
- AWS Alchemy resource planning, adoption, update, replacement, and deletion contracts;
- MiniStack lifecycle and endpoint injection for supported AWS resources;
- cross-target capability compatibility and fail-closed diagnostics;
- local secret loading without graph or log leakage;
- local networking, stable endpoint discovery, health, logs, and hot reload;
- AWS foundational infrastructure required by managed application providers;
- target-parity and lifecycle acceptance gates;
- the machine-readable provider guarantee vocabulary and provider-level maturity evidence.

This RFP does not own:

- domain models, operations, workflows, actors, or application authorization;
- provider-specific business configuration inside a Start;
- TypeKro's Kubernetes resource lifecycle implementation;
- semantic runtime-access inference or application authorization; this RFP's providers only lower the
  canonical access requirements they receive;
- MiniStack internals or unsupported AWS behavior;
- lakehouse dataset/query semantics, which belong to
  [`rfp-v08-lakehouse-query.md`](rfp-v08-lakehouse-query.md);
- a false semantic equivalence between incompatible analytical systems;
- production use of the local supervisor.

## Profile and target are separate dimensions

An application profile answers which capability family and capacity policy applies. A deployment
target answers where and by which lifecycle engine compatible providers are realized.

Examples:

| Profile concern | Target concern |
| --- | --- |
| starter, developer, dedicated, external | local, AWS-compatible local, AWS, Kubernetes |
| shared versus dedicated database | process, container, managed service, Kubernetes composition |
| retention and capacity policy | region, cluster, network, account, endpoint |
| internally managed versus externally supplied | Alchemy provider, TypeKro provider, or local supervisor |

The compiler produces a compatibility diagnostic when a profile requires guarantees that a target
cannot supply. Target selection does not rewrite application policy.

When one logical qualification deliberately uses different compatible provider implementations by
target, target selection composes inside the profile branch rather than leaking target checks into
domain code:

```ts
const HistoricalAnalytics = AnalyticalDatabase.named("historical");

deployment
  .provide(HistoricalAnalytics)
  .starter(() => app.selectTarget<ApplicationAnalyticalDatabaseProvider>({
    local: () => AnalyticalDatabase.clickhouse({ name: "analytics" }),
    awsLocal: () => Analytics.postgres({ database: PrimaryDatabase }),
    aws: () => Analytics.postgres({ database: PrimaryDatabase }),
    kubernetes: () => AnalyticalDatabase.clickhouse({ name: "analytics" }),
  }))
  .dedicated(() => /* the same target-shaped policy */)
  .external(spec => /* target-compatible external implementations */)
  .exhaustive();
```

`app.selectTarget(...)` is a typed provider-selection seam, not an execution-time branch. Its
factories remain inert until planning selects a target, the selected implementation is recorded in
the canonical graph, and every incompatible or missing branch fails during planning. This is useful
when systems are honestly different—such as ClickHouse locally and PostgreSQL-backed analytics on
AWS—without pretending the two provider contracts are identical or branching application behavior.

The normalized graph records:

- semantic capability and qualification;
- required guarantees and optional features;
- selected provider implementation;
- deployment target;
- lifecycle authority;
- external versus owned disposition;
- secret and endpoint outputs;
- target-specific diagnostics without target-specific domain nodes.

## Local runtime architecture

The local runtime is a long-lived development supervisor owned by the CLI. It remains alive when the
generated application fails to compile or restarts.

```text
applik8s development daemon
  local graph planner
  process supervisor
  container supervisor
  MiniStack supervisor when requested
  secret and endpoint broker
  log and health multiplexor
  file watcher and rebuild coordinator
  development portal bridge
        |
        +-- generated web/server process
        +-- generated worker processes
        +-- PostgreSQL / Valkey / NATS / other local containers
        +-- optional MiniStack
```

The default strategy is layered:

1. Run stateless JavaScript application and handler runtimes as local processes when supported.
2. Run stateful open-source dependencies as ordinary local containers when that is the fastest faithful
   implementation.
3. Use MiniStack only when AWS API, identity, event, or lifecycle fidelity is requested.
4. Use Kubernetes only when Kubernetes control-plane behavior is under test.

No provider may require MiniStack merely because an AWS implementation exists.

### Local state and identity

The supervisor stores non-secret runtime state beneath an ignored `.applik8s/` directory. State is
scoped by application identity, environment, target, and project-root digest. It includes assigned
ports, container identities, deployment receipts, schema revisions, and cleanup leases.

The supervisor must:

- take an exclusive project/target lease;
- recover or diagnose orphaned processes after interruption;
- preserve explicitly retained data across ordinary restarts;
- distinguish stop, reset, and destructive delete;
- never delete a resource whose persisted identity no longer matches;
- use bounded waits and report blockers;
- expose a machine-readable snapshot to the development portal.

### Hot reload

File changes are classified before action:

| Change | Required behavior |
| --- | --- |
| UI or ordinary server source | Vite or process-level hot reload |
| Captured handler closure | rebuild and restart only affected worker group |
| Application graph without state migration | incremental plan and converge |
| Schema migration | explicit migration preview and approval according to policy |
| Provider or target change | full target plan; never implicit destructive transition |
| Development daemon code | daemon restart with session recovery |

Reload does not claim exactly-once execution. Event and workflow runtimes retain their existing durable
admission and checkpoint contracts during worker replacement.

### Local networking and endpoints

Every local service receives a stable logical endpoint and a replaceable physical endpoint. Generated
processes consume endpoints through the same provider-output binding used by deployed runtimes.

The supervisor owns:

- collision-safe dynamic ports;
- stable local hostnames where supported;
- local HTTP routing and optional trusted development certificates;
- explicit browser-versus-server endpoint differences;
- late-bound credentials and connection strings;
- redacted diagnostics;
- recovery when a physical port changes.

Hard-coded `localhost` URLs in generated domain source are not an accepted lowering.

## AWS provider architecture

AWS infrastructure is represented by Alchemy resources and deployment outputs. TypeKro is used only
for Kubernetes resources that remain part of an AWS deployment, such as an explicitly selected EKS
target.

One resource has one lifecycle owner. An AWS resource cannot be owned simultaneously by an Alchemy AWS
provider, a TypeKro composition, and application runtime code.

The first AWS target requires more than the headline managed services. A deployable baseline includes:

- VPC, subnets, routing, security groups, and service discovery;
- IAM execution and task roles with least-privilege policies;
- Secrets Manager or an explicitly supplied external secret authority;
- ECR or an explicitly supplied OCI registry;
- ECS services/tasks for application and worker hosts;
- load balancing, health checks, Route53, and ACM for public HTTPS;
- RDS PostgreSQL for `TransactionalDatabase`;
- ElastiCache Valkey/Redis-compatible service for `IndexStore` and compatible caches;
- S3 for `ObjectStorage` and lakehouse objects;
- Kinesis for compatible `EventSource` workloads;
- SQS where the existing `Queue` contract requires queue rather than stream semantics;
- EventBridge Scheduler and schedule groups for the function-native scheduling contract, with SQS-backed
  admission where required to preserve stable occurrence receipts;
- CloudWatch logs, metrics, and deployment diagnostics;
- optional Athena and Glue for the lakehouse query capability defined below.

The exact release slice is machine-readable in
[`v0.8-aws-provider-inventory.json`](v0.8-aws-provider-inventory.json). Prose or implementation cannot
silently add, omit, or promote an adapter. The v0.8 dispositions are:

| Provider family | v0.8 disposition |
| --- | --- |
| VPC/networking, IAM, Secrets Manager, ECR | stable-required |
| ECS/Fargate web and processors, ALB, Route53, ACM | stable-required |
| RDS PostgreSQL, ElastiCache, S3, Kinesis, SQS, EventBridge Scheduler | stable-required |
| OpenTelemetry collector/agent and CloudWatch logs/metrics/traces | stable-required |
| Athena, Glue, S3 datasets, and query results | beta-required through the lakehouse pillar |

`stable-required` means real-AWS create, no-op, update, interruption recovery, drift repair, security,
retention, and deletion gates must pass before v0.8.0. `beta-required` must pass the owning beta vertical's
real-AWS gates and remain labeled beta. Experimental adapters cannot satisfy either requirement.

EBS is normally an implementation detail of compute or database providers. A public block-volume
capability is added only when an application has a genuine portable block-device requirement. ECS
Fargate is the default stateless host; EBS attachment must not distort that default.

### Capability mapping

| Applik8s capability | Local default | AWS-local fidelity | AWS production | Kubernetes |
| --- | --- | --- | --- | --- |
| `ApplicationHost` | supervised process or container | MiniStack ECS when selected | ECS/Fargate | TypeKro Deployment/Service |
| `TransactionalDatabase` | PostgreSQL container | MiniStack RDS PostgreSQL | RDS PostgreSQL; Aurora only after separate qualification | CNPG |
| `IndexStore` | Valkey container | MiniStack ElastiCache | ElastiCache | Valkey |
| `ObjectStorage` | filesystem or S3-compatible container | MiniStack S3 | S3 | Rook/Ceph or external S3 |
| `EventSource` stream | NATS or in-process test provider when compatible | MiniStack Kinesis | Kinesis | NATS/JetStream |
| `Queue` | local queue provider | MiniStack SQS | SQS | selected Kubernetes queue |
| `Scheduler` | deterministic local supervisor | API-fidelity only | EventBridge Scheduler | bounded CronJob or qualified shared scheduler |
| `DnsPublication` | development router | MiniStack Route53 evidence | Route53 | ExternalDNS/provider adapter |
| public HTTP | development router | local ECS endpoint | ALB + ACM + Route53 | Service/Ingress/Gateway + certificate |
| low-latency analytics | ClickHouse or PostgreSQL | not Athena by substitution | compatible managed/external provider | ClickHouse |
| lakehouse query | DuckDB over local objects | MiniStack Athena/Glue/S3 | Athena/Glue/S3 | compatible external engine |
| `ActorRuntime` | deterministic local or pinned celld local | API wiring only | celld or another separately qualified provider | qualified celld/Rivet TypeKro or external binding |

The exact MiniStack support matrix is versioned in the provider package and tested. Documentation may
link to [MiniStack's service documentation](https://ministack.org/docs/), but runtime planning relies on
the pinned compatibility manifest rather than an unversioned marketing list.

## Analytics compatibility boundary

Athena is not an `AnalyticalDatabase` replacement for ClickHouse. It has a materially different query,
latency, mutation, ingestion, and cost contract.

v0.8 retains `AnalyticalDatabase` for low-latency analytical serving. The distinct `LakehouseDataset`
and `LakehouseQuery` contracts are defined by
[`rfp-v08-lakehouse-query.md`](rfp-v08-lakehouse-query.md):

```ts
const HistoricalAnalytics = LakehouseQuery.named("historical");
```

This RFP owns only target binding and lifecycle of the physical providers. It must reject binding a
low-latency analytical requirement to Athena and must carry the lakehouse RFP's compatibility evidence
through planning. It does not define query syntax, snapshot publication, cursors, or schema evolution.

## Provider guarantee vocabulary

Every provider publishes a machine-readable guarantee manifest. It covers at least:

- ordering and partitioning;
- replay, retention, acknowledgement, and duplicate behavior;
- transaction and outbox boundaries;
- read/write consistency;
- payload, batch, connection, and duration limits;
- runtime-access enforcement fidelity;
- readiness and output authority;
- create, update, adopt, interruption recovery, drift, migration, retention, and delete lifecycle;
- target-specific limitations and evidence level.

The planner compares application requirements with these guarantees before deployment. Shared claims run
through differential conformance fixtures; target-specific claims require target-specific evidence.

Provider maturity is individual. A stable target contract or one qualified provider cannot promote a
new adapter. AWS-local evidence proves only the pinned API flows it exercises. IAM, networking,
encryption, availability, quotas, upgrades, and cost require real AWS.

## MiniStack contract

MiniStack runs behind the AWS target adapter. The adapter owns:

- version pinning and compatibility evidence;
- daemon lifecycle and health;
- endpoint injection into AWS clients and Alchemy providers;
- deterministic local account and region identity;
- credential isolation;
- service bootstrap ordering;
- data retention/reset policy;
- known semantic differences and fail-closed exclusions.

The application graph never contains a node whose semantic interface is `MiniStack`. Plans may display
MiniStack as target evidence.

AWS-local is not accepted as proof of AWS production behavior for IAM, networking, quotas, availability,
managed upgrades, encryption, or cost. Those require opt-in real-AWS acceptance.

## Scheduling target requirements

The semantic definition, instance, occurrence, overlap, misfire, admission, and authority contracts
belong to [`rfp-v08-function-native-scheduling.md`](rfp-v08-function-native-scheduling.md). This RFP owns
only target binding and physical lifecycle for a selected `Scheduler` provider.

- The local target runs a deterministic supervisor clock whose occurrences use the same admission and
  prior-receipt path as remote providers.
- AWS uses Alchemy-owned EventBridge Scheduler resources, schedule groups, IAM, retry/DLQ policy, and an
  SQS-backed admission route when direct invocation cannot preserve the framework receipt contract.
- Kubernetes uses TypeKro-owned CronJobs only for bounded fixed or low-cardinality schedules.
- Dynamic or high-cardinality Kubernetes schedules require a qualified shared scheduler such as Hatchet;
  planning fails before schedule-per-instance resource growth exceeds the provider's declared bound.
- AWS-local is API-fidelity evidence only and cannot prove production quotas, IAM, timing, retry, or
  dead-letter behavior.

All targets preserve one canonical schedule definition and logical occurrence identity. Physical
delivery guarantees and timing precision remain provider-specific and visible in the application plan.

## Distributed actor target requirements

The actor semantics and provider qualification contract belong to
[`rfp-v08-durable-actors.md`](rfp-v08-durable-actors.md). This RFP owns only the physical target planning
and lifecycle surfaces required by a selected actor provider.

celld is implemented first. A celld physical plan includes:

- replaceable compute nodes and a pinned runtime/deployment artifact;
- an S3-compatible or otherwise qualified object store with the exact conditional-write behavior needed
  for ownership fencing and acknowledged-write durability;
- narrowly scoped workload identity for fleet storage and deployment objects;
- a private internal listener and routable peer addresses that are never exposed as the public ingress;
- load balancing and TLS termination for public actor traffic;
- stable fleet/application/environment identity and isolated object prefixes or buckets;
- deployment publication, readiness, pressure/capacity, node replacement, rolling update, rollback,
  retained-state, and teardown evidence; and
- sanitized outputs for the actor runtime adapter, application plan, telemetry, and operations UI.

Local celld development therefore uses a pinned conditional-write-compatible object store; an ordinary
filesystem directory cannot silently stand in for the fencing authority. Kubernetes plans use TypeKro
for nodes, private networking, ingress, and the selected object-store binding. AWS plans use Alchemy for
compute, load balancing, private networking, S3, IAM, deployment, and lifecycle.

celld and Rivet remain actor-beta providers with their own conformance gates. Their adapters do not enter
the stable AWS provider inventory merely because the stable AWS foundation can deploy their physical
resources.

## Secrets and `.env`

The existing `.env` workflow remains supported for local development and for an explicitly selected
deployment environment. The loader reads a closed schema of declared secret names and passes values to
the selected secret provider without writing them into generated artifacts, Alchemy state, application
graphs, logs, diagnostics, or container image layers.

Rules:

- `.env` is a source, not the canonical secret store;
- unknown keys are ignored or diagnosed according to policy;
- secret values are never read by the development agent unless a separately reviewed capability grants
  exact access;
- production deployment from `.env` requires explicit confirmation and writes to the target secret
  authority before workloads start;
- rotation updates the secret authority and causes only dependent workloads to converge;
- deletion does not delete an externally owned secret.

## Alchemy lifecycle requirements

Every AWS and local deployment resource participates in one canonical `ApplicationPlan` defined by
[`rfp-v08-application-plan.md`](rfp-v08-application-plan.md). Alchemy retains authoritative lifecycle
planning and contributes sanitized, stable-identity plan records to that artifact. Providers must
support:

- preview without writes;
- stable logical and physical identity;
- import/adoption with ownership evidence;
- immutable-field replacement ordering;
- optimistic concurrency and conflict retry;
- cancellation and resumable convergence;
- retained-data policy;
- dependency-aware teardown;
- protection of shared or external infrastructure;
- output hydration only after authoritative readiness;
- drift detection and actionable diagnostics;
- redaction of credentials and sensitive outputs.

Target transitions are explicit migrations, never an in-place provider-name edit. Moving from
Kubernetes PostgreSQL to RDS, for example, requires a data migration plan, cutover frontier, rollback
boundary, and final ownership disposition.

## Observability

The stable instrumentation, collector, signal-policy, and provider contracts belong to
[`rfp-v08-unified-observability.md`](rfp-v08-unified-observability.md). This RFP owns only the local and
AWS lifecycle surfaces needed to deploy those contracts.

The provider UI or operations links present the same semantic application identities across targets.
Provider evidence may differ, but users see:

- logical capability and selected implementation;
- owning lifecycle engine;
- process/container/cloud/Kubernetes identity;
- health and readiness;
- endpoint publication state;
- last plan and convergence receipt;
- logs and metrics links;
- retained or external resources;
- unsupported fidelity warnings.

Local signals route through the package-managed OpenTelemetry collector. AWS signals route through the
qualified collector/agent to CloudWatch. Both retain the shared semantic identity and diagnostic envelope;
the portable-runtime implementation does not introduce separate log or metric semantics.

## Security requirements

- Local services bind to loopback unless explicitly exposed.
- MiniStack's management surface is never published by default.
- AWS credentials are scoped to the environment and are not inherited by arbitrary generated processes.
- ECS tasks receive least-privilege task roles derived from graph requirements.
- Public ingress requires TLS in production.
- Databases and caches are private by default.
- S3 public access is blocked unless an explicit object-publication operation owns it.
- Cross-account and external resources require explicit ownership and deletion policy.
- Plan artifacts redact sensitive values while preserving enough provenance for audit.

## Implementation increments

### Increment 1 — Local graph runner

- Normalize process, container, endpoint, health, and secret bindings.
- Run the generated ApplicationHost and handlers without Kubernetes.
- Provide PostgreSQL, Valkey, NATS, and object-storage local providers.
- Implement stable logs, hot reload, stop, reset, and recovery.
- Publish the initial provider guarantee schema and differential conformance harness.

### Increment 2 — AWS resource foundation

- Add Alchemy AWS provider packages and target contract.
- Implement network, IAM, secret, registry, ECS, ingress, DNS, and observability foundations.
- Add RDS, ElastiCache, S3, Kinesis, and SQS mappings.
- Add EventBridge Scheduler, schedule-group, SQS admission, retry, and DLQ mappings.
- Add the AWS physical-plan adapter and reconcile it with the canonical semantic/provider plan.
- Qualify CloudWatch only after the collector/agent, workload identity, network, and lifecycle foundations
  exist.

### Increment 3 — MiniStack target

- Complete a bounded feasibility spike before freezing the target adapter API.
- Pin MiniStack and publish a compatibility manifest.
- Route supported AWS resources through the local endpoint adapter.
- Prove service creation, application use, restart, drift, and teardown.

### Increment 4 — Lakehouse target bindings

- Implement only the DuckDB and Athena/Glue/S3 target resources required by the lakehouse RFP.
- Carry its guarantee, lifecycle, access, and evidence contracts without redefining them here.
- Reject incompatible `AnalyticalDatabase` substitutions.

### Increment 5 — Target parity and production qualification

- Run every vertical required by `v0.8-target-compatibility.json` on its declared targets.
- Qualify every AWS provider at the disposition declared by `v0.8-aws-provider-inventory.json`.
- Prove explicit target migration plans and ownership boundaries.
- Publish cost, latency, and fidelity evidence.

## Required gates

### Local experience

- Clean generated Agentic Start reaches an interactive page without Kubernetes.
- First useful route is ready within a documented warm and cold budget.
- Source edits update UI and one captured worker without restarting unrelated stateful services.
- Compile failure leaves the development portal, logs, and rollback controls available.
- Stop/restart preserves retained data; reset deletes only leased project resources.

### Provider parity

- The same application source and target-compatible semantic graph pass every target marked `required`
  in `v0.8-target-compatibility.json`; target-scoped verticals are not falsely advertised as universal.
- Only installation/target inputs, qualified provider selection, and external secret values differ.
- Provider requirements reject an incompatible target during planning.
- Late-bound endpoints and credentials hydrate without source-level branching.
- Every shared guarantee has a differential fixture; every provider-specific guarantee identifies its
  required live target.

### AWS lifecycle

- Clean create, no-op replay, update, interrupted update recovery, drift repair, and delete pass.
- Shared/external resource deletion is rejected.
- Retained database and object data survive application-host deletion.
- IAM, networking, secret rotation, image update, and DNS/certificate convergence are exercised.

### MiniStack fidelity

- ECS workload, RDS connection, ElastiCache access, S3 objects, Kinesis delivery, and Route53 evidence
  pass at the pinned version.
- Unsupported semantics produce a planning diagnostic.
- MiniStack interruption recovers without losing Alchemy ownership state.

### Analytics

- The lakehouse RFP's DuckDB/Athena differential and real-AWS gates pass.
- Interactive ClickHouse requirements are rejected for Athena.
- Target planning preserves snapshot, access, cost, and lifecycle requirements without reinterpreting
  them.

### Security

- Secret canaries do not appear in graphs, plans, logs, state, images, or development-agent context.
- Public AWS resources are absent unless explicitly requested.
- Task-role permissions match declared application requirements.
- Destructive reset cannot cross project, environment, account, region, or UID leases.

## Non-goals

- Emulating every AWS service in v0.8.
- Treating MiniStack as production infrastructure.
- Replacing TypeKro for Kubernetes.
- Making EKS the default AWS host.
- Claiming Athena and ClickHouse are interchangeable.
- Transparent cross-provider data migration without an explicit plan.
- A production-grade local process supervisor for non-development use.
- Multi-cloud parity in this release.
- Declaring every AWS adapter stable when only the target contract or core production slice is qualified.

## Closed v0.8 decisions

- Domain code does not name MiniStack, Docker, AWS SDK endpoints, or Kubernetes.
- Local is the default development target; Kubernetes is an explicit fidelity target.
- AWS resources are Alchemy-owned; Kubernetes resources are TypeKro-owned beneath the same Alchemy
  application deployment.
- MiniStack uses the AWS provider path rather than a parallel set of application providers.
- Application profile and deployment target remain separate.
- EBS remains an implementation detail unless a later workload proves a public block-volume need.
- Athena implements `LakehouseQuery`, not low-latency `AnalyticalDatabase` by assertion.
- Provider maturity is individual and backed by machine-readable guarantees plus required live evidence.
- `.env` remains a supported secret source, including explicit production use, without becoming state.

## Definition of done

This RFP is complete when a newly generated Agentic Start runs productively without Kubernetes, can opt
into pinned AWS fidelity through MiniStack, and every vertical required by
`v0.8-target-compatibility.json` deploys without domain-source branching through the individually
qualified real-AWS provider slice in Alchemy and the required TypeKro target; every provider in
`v0.8-aws-provider-inventory.json` retains its declared disposition; and the program
demonstrates lifecycle, security, observability, provider maturity, and compatibility behavior through
live repeatable gates.
