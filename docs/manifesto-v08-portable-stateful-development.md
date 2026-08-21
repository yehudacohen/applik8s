# Manifesto: Applik8s v0.8 — Explainable Portable Runtime, Function-Native Scheduling, Inferred Least Privilege, Unified Observability, Lakehouse Analytics, Stateful Actors, and Agent-Assisted Development

**Status:** Accepted v0.8.0 implementation program. This document defines the product thesis, authority
boundaries, sequencing, and release bar. Tagging and publication still require explicit maintainer authorization.

**Audience:** Applik8s maintainers, Start authors, compiler/runtime owners, Alchemy and TypeKro provider
authors, security reviewers, and acceptance-application maintainers

**Target:** Applik8s v0.8.0

**Depends on:** The released Applik8s v0.7.x line and its function-native execution, typed authority, profiles,
provider-neutral modules, Agentic Start, application graph, Alchemy/TypeKro deployment, and release
evidence

## Thesis

Applik8s v0.7 proved that one TypeScript application can describe models, operations, events, workflows,
signals, projections, AI, authority, provider dependencies, and Kubernetes deployment without splitting
the application into unrelated programming models.

v0.8 removes the next nine forms of friction:

1. **Kubernetes is too heavy for the default local feedback loop.** Developers should get a faithful,
   observable application quickly, then select Kubernetes when they need control-plane fidelity.
2. **The application architecture is difficult to explain before deployment.** Semantic requirements,
   authority, data flow, state, provider resolution, physical topology, exposure, lifecycle, and cost
   should form one source-attributed plan rather than scattered compiler and infrastructure output.
3. **Runtime access repeats facts already present in the graph.** Known model, object, event, queue,
   workflow, actor, Secret, and resource calls should derive least-privilege workload access without
   becoming application authorization or requiring provider-policy duplication.
4. **Distributed behavior is not operable without correlated telemetry.** Managed boundaries should
   produce and propagate OpenTelemetry traces, structured logs, and metrics to a replaceable backend.
5. **Historical analytical data lacks an honest portable contract.** Snapshot-oriented object data and
   asynchronous scans should not pretend to be a mutable, low-latency analytical database.
6. **Time-driven execution is split across deployment-shaped APIs.** Fixed, dynamic, recurring, and
   one-time work should use one function-native closure and the same qualified dependency-injection model
   as every other capability, while local, Kubernetes, workflow-engine, and AWS schedulers retain their
   truthful provider differences.
7. **The framework lacks identity-addressed stateful execution.** Some problems fit neither relational
   models nor long-running workflows. Durable actors should become directly callable typed handles.
8. **The framework remains difficult to learn and evolve by inspection alone.** A development agent
   should understand the application graph, propose Applik8s-native changes, and prove them—but it must
   survive the code it edits and remain subordinate to developer review.
9. **Runtime integrity is implemented repeatedly at gateway and provider boundaries.** Canonical JSON,
   signed cursors, expiry, and principal/trusted-context admission must use versioned shared contracts so
   target and provider differences cannot create digest drift or weaken authority.

The v0.8 promise is:

> One application can explain its requirements and topology, run quickly on a developer machine, derive
> least-privilege runtime access from typed behavior, express time-driven work through ordinary managed
> closures, emit correlated traces/logs/metrics, deploy through managed AWS services or Kubernetes, query
> published historical datasets, express durable identity-scoped actors, and evolve through an
> independent evidence-driven development environment while preserving one canonical serialization,
> signed-envelope, and admission foundation across runtimes.

This is not a promise that every environment is identical. It is a promise that differences are typed,
planned, explained, and rejected when incompatible rather than hidden in application code.

## Program authority and document map

This manifesto owns the cross-cutting thesis, document boundaries, shared invariants, maturity labels,
program order, acceptance applications, and final release definition.

The accepted implementation order, checkpoint/reconciliation rules, Runtime Integrity workstream, and
evidence discipline are maintained in
[`v0.8-execution-plan.md`](v0.8-execution-plan.md). That plan sequences this manifesto and its RFPs; it
does not weaken or replace their normative contracts. The copy/paste execution goal is maintained in
[`v0.8-goal-prompt.md`](v0.8-goal-prompt.md).

| RFP | Owns | Must not own |
| --- | --- | --- |
| [`rfp-v08-runtime-integrity.md`](rfp-v08-runtime-integrity.md) | Canonical JSON policies, purpose-separated signed envelopes, canonical admission, package ownership, rolling migration, cross-runtime vectors, and source inventory | Application authorization policy, provider continuation semantics, TypeKro proxy inference, or transport authentication mechanisms |
| [`rfp-v08-portable-local-and-aws-runtime.md`](rfp-v08-portable-local-and-aws-runtime.md) | Local supervisor, deployment targets, AWS Alchemy providers, MiniStack fidelity, target compatibility, local/AWS/Kubernetes lifecycle, and provider guarantee vocabulary | Domain behavior, lakehouse query semantics, actor semantics, coding-agent mutation, or TypeKro's Kubernetes internals |
| [`rfp-v08-application-plan.md`](rfp-v08-application-plan.md) | Canonical semantic requirements, authority/data-flow views, provider resolution, physical topology, exposure, lifecycle, cost classes, provenance, plan composition, and stable diffs | Deployment-engine lifecycle, application authorization decisions, provider implementation, or an alternative application graph |
| [`rfp-v08-inferred-runtime-access.md`](rfp-v08-inferred-runtime-access.md) | Provider-neutral runtime access requirements, inference from known graph behavior, execution-identity attribution, explicit-access interaction, policy provenance, and least-privilege provider-lowering inputs | Application roles/grants, provider policy resource lifecycle, credential values, development-agent command approval, or wildcard fallback |
| [`rfp-v08-unified-observability.md`](rfp-v08-unified-observability.md) | OpenTelemetry context, managed-boundary instrumentation, structured logs, metrics, traces, collector topology, redaction/cardinality, ClickStack/HyperDX, CloudWatch, external OTLP, and telemetry evidence | A proprietary APM UI, business analytics, application authorization, or arbitrary vendor-specific SaaS adapters |
| [`rfp-v08-function-native-scheduling.md`](rfp-v08-function-native-scheduling.md) | Inert typed schedules, qualified `Scheduler` dependencies, fixed/dynamic/recurring/one-time instances, occurrence identity, admission, overlap/misfire semantics, local/Kubernetes/Hatchet/EventBridge providers, and schedule lifecycle | Workflow orchestration, actor alarms, raw Kubernetes jobs, provider-client APIs, or a scheduler-specific dependency-injection model |
| [`rfp-v08-lakehouse-query.md`](rfp-v08-lakehouse-query.md) | Published dataset snapshots, schema evolution, query lifecycle, DuckDB and Athena/Glue/S3 providers, compatibility, pagination, cancellation, and cost evidence | Low-latency analytical serving, mutable OLAP tables, general object-storage lifecycle, or arbitrary SQL portability |
| [`rfp-v08-durable-actors.md`](rfp-v08-durable-actors.md) | Actor identity, schema-backed protocol members, references, turns, state, optional realtime behavior, alarms, migration, authority, provider conformance, first celld adapter, and independent Rivet target | Workflow history, relational query semantics, cloud infrastructure graph, or development-agent policy |
| [`rfp-v08-independent-development-environment.md`](rfp-v08-independent-development-environment.md) | Independent portal/daemon, OpenCode provider, visual product selection, persistent context attachments/referents, workspace mutation, plans, diffs, approvals, validation, evidence, undo, and dev-only security | Product assistants, application backend authority, production operations, or provider-specific compiler semantics |

An RFP may refine internal packages and syntax. It may not introduce a second application graph, second
authority model, competing deployment engine, or undeclared source of truth. Conflicts return to
maintainer review and require a manifesto amendment or ADR.

### Contract dependency model

The program distinguishes four relationships that must not be collapsed into one `Depends on` list:

- **foundation dependency** — an already implemented v0.7 contract or a Phase 0 schema required before
  another public contract can freeze;
- **implementation dependency** — a component that must run before the dependent increment can work;
- **integration dependency** — sibling contracts that exchange versioned records but may be implemented
  incrementally in either order; and
- **qualification dependency** — live evidence required before a maturity claim, not before coding can
  begin.

Phase 0 freezes the minimal shared foundation used to break implementation cycles:

- canonical graph, operation, source, provider, and execution-boundary identities;
- source provenance and recursive supported closure discovery;
- deployment-target and qualified-provider descriptors;
- provider-guarantee manifest and maturity vocabulary;
- runtime-access operation descriptors;
- native-plan adapter records for Alchemy, TypeKro, and the local supervisor; and
- bounded guest/host identity envelopes used by compiler/runtime integrations; and
- Canonical JSON v1 policies, signed-envelope wire identity, and canonical admission records used by
  maintained ingress and runtime boundaries.

The application-plan, runtime-access, observability, portable-runtime, and scheduling RFPs integrate over
these records. None requires every sibling provider or renderer to be complete before its own semantic
contract can be implemented. Each RFP header names foundation dependencies separately from v0.8 sibling
integrations.

## Maturity contract

The ten program pillars deliberately ship at different maturity levels:

| Pillar | v0.8 promise | Reason |
| --- | --- | --- |
| Runtime integrity | Stable canonical JSON, signed-envelope, and admission contracts with cross-runtime and rolling-migration evidence | Every other v0.8 target and stateful feature depends on stable bytes and authority admission. |
| Local runtime | Stable v0.8 surface with production-quality lifecycle evidence | This is the prerequisite for the everyday development loop. |
| AWS target and core production slice | Stable target/plan contract; only individually qualified providers carry a stable label | A broad provider catalog must not inherit maturity from a smaller proven slice. |
| Application plan | Stable versioned semantic and target-plan contract | Every other v0.8 capability needs a truthful, reviewable explanation surface. |
| Inferred runtime access | Stable v0.8 graph contract with local, AWS, and Kubernetes least-privilege evidence | Access already knowable from typed behavior should not remain repetitive provider configuration. |
| Unified observability | Stable OTel context/instrumentation/collector contract; ClickStack and CloudWatch qualify independently | Distributed semantics require correlated evidence without coupling applications to one backend. |
| Function-native scheduling | Stable semantic contract with individually qualified local, Kubernetes, and AWS providers | Existing machinery is substantial, but occurrence identity, provider differences, high-cardinality behavior, and lifecycle must be unified before the API freezes. |
| Lakehouse query | Beta public contract with DuckDB and Athena/Glue/S3 conformance | Snapshot and asynchronous-query semantics need real workload evidence before a stronger promise. |
| Durable actors | Beta public contract with deterministic local and one qualified distributed provider; celld is implemented first and Rivet is the independent second target | Stateful execution needs real dogfooding and cross-provider pressure before a stronger compatibility promise. |
| Development agent | Opt-in developer preview | Coding-model behavior and OpenCode v2 integration must not weaken the release's deterministic core. |

Documentation, package metadata, CLI output, generated UI, and operations evidence must preserve these
labels. A preview Builder success cannot substitute for a failed stable runtime gate.

### Scope and drop policy

Phase 0 produces a machine-readable [`v0.8-scorecard.json`](v0.8-scorecard.json), executable
[`v0.8-acceptance.json`](v0.8-acceptance.json),
[`v0.8-target-compatibility.json`](v0.8-target-compatibility.json), and
[`v0.8-aws-provider-inventory.json`](v0.8-aws-provider-inventory.json). Every public surface, provider,
acceptance journey, maturity label, target disposition, and required live environment has one owner and
one release disposition.

- An unsafe preview may be omitted before release candidate.
- A beta pillar may be deferred only through an explicit manifesto amendment that also removes its API,
  packages, UI, documentation, scorecard entries, and acceptance claims.
- A stable claim cannot be weakened, mocked, or relabeled merely to meet a schedule.
- No capability is considered dropped while stale public exports or generated examples still promise it.

## Architectural center

The application graph remains the center:

```text
Authored TypeScript application
  models, operations, events, schedules, workflows, actors, providers, routes, authority
                           |
                           v
Canonical Applik8s semantic graph
  requirements, ownership, identities, effects, runtime access, outputs, provenance
                           |
             +-------------+-------------+
             |                           |
             v                           v
   Canonical application plan     OTel semantic telemetry
   demand -> providers ->         traces, logs, metrics,
   physical topology              causal links and evidence
             |                           |
             +-------------+-------------+
                           |
            +--------------+---------------+
            |              |               |
            v              v               v
      Local target      AWS target    Kubernetes target
      supervisor        Alchemy AWS   Alchemy + TypeKro
            |              |               |
            +--------------+---------------+
                           |
                           v
       Runtime/deployment evidence and independent developer portal
```

There is no local application graph, AWS application graph, actor graph, or Builder graph. Local process
nodes, AWS resources, TypeKro compositions, actor deployments, plans, telemetry identities, and
development views are projections or lowerings of the canonical graph.

## Shared invariants

### One semantic application

Domain source does not branch on `MiniStack`, Docker, ECS, Rivet, celld, or Kubernetes. It declares typed
capabilities and requirements. Installation/profile and deployment-target inputs select compatible
implementations.

### One canonical identity and provenance system

Canonical graph-node, operation, execution-boundary, provider, and source identities are frozen before
derived planning, access, telemetry, or Builder surfaces become stable. Recursive supported helper/module
closure discovery preserves exact source provenance; ambiguity, identity collision, or incomplete
execution attribution fails closed rather than becoming a plausible guess.

Source movement may change provenance without manufacturing a semantic replacement. No provenance
artifact contains credential values, private payloads, or confidential source outside the admitted
workspace boundary.

### One deployment authority per resource

Alchemy owns the complete deployment transaction and dependency graph. An Alchemy AWS provider owns AWS
resources. A TypeKro provider owns Kubernetes resources beneath the Alchemy deployment. The local
supervisor owns leased development processes and containers. No physical resource has multiple lifecycle
owners.

### One explainable application plan

The canonical graph produces one versioned application plan with a target-independent semantic layer,
provider-resolution layer, and target-specific physical topology. Alchemy and TypeKro plans remain the
authoritative lifecycle-engine details and are composed into—not replaced by—the Applik8s plan.

Counts, authority edges, data flow, exposure, retention, cost, provider maturity, runtime access, and
unresolved responsibilities preserve source provenance. Estimates and unknowns remain labeled; a plan
cannot present inferred topology as deployed fact.

### One operation and authority model

Actor protocol members, development deployment actions, existing model operations, workflows, signals,
queries, and HTTP routes use canonical typed operation identity where they cross an authority boundary.
Provider SDK objects do not create parallel authorization systems.

The development daemon has a separate development-security boundary because it must survive the
application. It may reuse common receipt and audit shapes, but it cannot delegate workspace mutation to a
possibly broken application backend.

### Runtime access is derived; application authorization remains explicit

Known typed capability calls and framework-generated behavior contribute runtime access requirements to
the canonical graph. Requirements attach to the execution identity that performs the action and lower to
local credentials, AWS IAM and network policy, Kubernetes RBAC and Secret bindings, or truthful external
provider evidence.

This inference never grants business authority to a caller. Application roles, grants, and operation
admission remain explicit. Unknown infrastructure access fails planning or uses a bounded explicit
declaration; it never becomes wildcard access so deployment happens to succeed.

### One causal chain

Calls across operations, events, schedules, workflows, agents, and actors preserve immediate execution
principal and original causal principal. Infrastructure retries cannot invent a new user. A recurring
schedule does not indefinitely impersonate the principal that configured it. Development-agent changes
record the approving developer separately from the coding-model/provider identity.

OpenTelemetry trace context and links carry that chain through synchronous and asynchronous boundaries.
Structured logs and bounded metrics use the same semantic operation, execution, application, deployment,
and provider identities. Telemetry is evidence of execution, not a second authority or application graph.

### Differences are capabilities, not wishful aliases

Athena does not become ClickHouse because both accept SQL. A deterministic local actor provider does not
become production durable because it passes type tests. MiniStack does not prove AWS IAM or availability.
Compatibility is a declared, tested contract.

### The recovery tool survives the thing it edits

The development portal and daemon run independently of generated application code. Breaking the app does
not remove logs, diffs, validation evidence, Builder session, or undo controls.

## Product experience

### First local run

```sh
bun create applik8s my-product --start agentic
cd my-product
bun install
applik8s dev
```

The developer receives:

- a working application without Kubernetes;
- local PostgreSQL, Valkey, NATS, and object storage only when required;
- stable endpoints and logs;
- hot reload for UI, server, and captured handlers;
- an independent developer portal;
- graph and provider visibility;
- inferred runtime-access provenance and provider-policy diffs;
- truthful failures and recovery actions.

The default loop optimizes time-to-useful-feedback. It does not start MiniStack or Kubernetes without an
express reason.

### Explain and plan

```sh
applik8s explain
applik8s plan --target aws --environment production
```

The developer sees semantic requirements, authority edges, data flow, state, execution identities,
provider resolution, runtime access, public exposure, lifecycle/retention, maturity gaps, estimated
topology, cost classes, and the composed Alchemy/TypeKro physical plan. JSON and graph forms use the same
versioned artifact as the text and developer-portal views.

### Unified observability

Managed HTTP, model, event, processor, schedule, workflow, actor, AI, query, and reconciler boundaries emit
correlated OpenTelemetry traces, structured logs, and bounded metrics without application-specific
backend code. Local development uses a package-managed collector. Kubernetes may install ClickStack and
publish its HyperDX UI through TypeKro; AWS may export to CloudWatch; an external provider may supply a
generic OTLP endpoint.

Log levels and filters, metric export/scrape intervals, trace sampling, batching, retention, redaction,
and cardinality budgets are profile-aware and visible in the application plan. Applik8s does not build a
competing APM interface.

### Function-native scheduling

```ts
export const RefreshEntitlements = schedule(
  {
    id: "entitlements.refresh.v1",
    every: "15m",
    overlap: "skip",
    misfires: "latest",
    maximumLateness: "5m",
  },
  async context => {
    await RefreshEntitlementsWorkflow.start({
      occurrenceId: context.occurrenceId,
    });
  },
);
```

The developer writes one managed closure, not a CronJob, EventBridge target, Hatchet schedule, or local
timer. `Scheduler.named(...)` selects a distinct logical scheduler only when the application needs one;
installation maps it to the target provider through ordinary qualified dependency injection.

The application plan shows definition, fixed or dynamic instances, provider guarantees, physical
topology, inferred runtime access, next occurrence, overlap/misfire policy, retry/dead-letter behavior,
limits, and cost class. Operations links one occurrence to its admission receipt, closure attempt,
downstream workflow or effects, and causal OpenTelemetry trace.

Product-configured recurrence uses the same primitive with an explicit dynamic definition:

```ts
export const RefreshOrganizationEntitlements = schedule(
  {
    id: "organization-entitlements.refresh.v1",
    input: type({ organizationId: "string" }),
    requirements: { configuration: "dynamic", cardinality: "high" },
  },
  ({ organizationId }, context) =>
    RefreshEntitlementsWorkflow.start({ organizationId, occurrenceId: context.occurrenceId }),
);

await RefreshOrganizationEntitlements.schedule({
  id: organization.id,
  cron: organization.refreshSchedule,
  timezone: organization.timezone,
  revision: String(organization.revision),
  input: { organizationId: organization.id },
});
```

The principal configuring this instance remains audit evidence and is not impersonated by future
occurrences.

### AWS fidelity

```sh
applik8s dev --target aws-local
```

The same AWS provider graph uses pinned MiniStack endpoints for supported services. This target is for
AWS API and lifecycle fidelity, not the fastest edit loop.

### Stateful actor

```ts
const RenameWorkspace = type({
  title: "string > 0",
  expectedRevision: "number.integer >= 0",
});
const RenameResult = type({ revision: "number.integer >= 0" });

export const Workspace = application.actor("workspace", {
  key: type("string"),
  state: WorkspaceState,
  protocol: {
    rename: actor.command({ input: RenameWorkspace, output: RenameResult }),
  },
});

Workspace.on.rename(async (workspace, input) => {
  const current = await workspace.state();
  const next = {
    ...current,
    title: input.title,
    revision: current.revision + 1,
  };
  await workspace.setState(next);
  return { revision: next.revision };
});

await Workspace.rename(workspaceId, {
  title: "Launch plan",
  expectedRevision: 3,
});
```

The schema-backed protocol derives callback and interaction surfaces. The compiler/runtime owns routing,
admission, serialization, state transaction, retries, provider adaptation, and authority.

### Agent-assisted change

The stable developer portal remains available at its own origin. The developer can ask textually or use
the disposable toolbar to select an element, text range, or component region in the running product and
ask about that exact thing. The daemon resolves the bounded selection through development source
provenance, the semantic graph, runtime evidence, and `ApplicationPlan` nodes.

The resulting conversation uses explicit attachments and visible named referents rather than hidden
provider memory. The developer receives:

1. source and graph inspection;
2. an explicit implementation plan;
3. code, schema, authority, and infrastructure diffs;
4. risk-scoped approval;
5. optimistic patch application;
6. format, type, test, compile, plan, and runtime evidence;
7. undo that preserves unrelated developer work.

The toolbar does not upload arbitrary DOM, form values, screenshots, storage, or user content. The
developer previews and controls the resolved attachment classes before they reach the coding provider.

The generated application contains only an optional developer toolbar. The OpenCode server and mutation
authority live behind the independent daemon.

### Production deployment

```sh
applik8s plan --target aws --environment production
applik8s deploy --target aws --environment production
```

or:

```sh
applik8s deploy --target kubernetes --environment production
```

Changing target produces a plan and, when state moves, an explicit migration. It is not a string
replacement that silently moves canonical data.

The plan also explains which runtime identity can access each provider and why. Known typed calls require
no duplicate IAM/RBAC declaration; dynamic, external, or administrative access remains explicitly
reviewed.

## Provider and target model

v0.8 retains v0.7 schema-derived profiles. It adds a first-class deployment-target dimension.

| Dimension | Examples | Owns |
| --- | --- | --- |
| Application profile | developer, dedicated, external | capacity, sharing, managed/external disposition, provider guarantees |
| Deployment target | local, AWS-local, AWS, Kubernetes | lifecycle engine, endpoint/account/region/cluster, physical resource lowering |
| Capability qualification | primary database, attachment store, source-polling scheduler, historical analytics | which logical dependency is requested |
| Provider implementation | PostgreSQL, RDS PostgreSQL, S3, EventBridge Scheduler, celld, Rivet | behavior and deployment adapter satisfying the capability |

This separation prevents profile names from accumulating environment and cloud semantics.

Profile selection and target selection may be composed at the provider boundary. A profile branch
can return `app.selectTarget(...)` when the same qualified capability has deliberately different
compatible implementations on local, AWS-local, AWS, and Kubernetes. This selection is normalized
into the application graph and resolved during planning; domain models, handlers, workflows, and
queries never inspect the target.

## Implementation and package ownership

v0.8 prefers a cohesive internal module over a new public package. A boundary becomes independently
published only when users can reasonably install, replace, version, or prune it without importing the
rest of the pillar.

| Concern | Initial implementation home | Public-boundary rule |
| --- | --- | --- |
| Canonical identities, closure discovery, semantic graph, access descriptors, and guest/host envelopes | Existing compiler/core/runtime packages | Extend existing public contracts; do not publish a package per graph record family. |
| Application-plan schema and renderers | Internal plan modules behind existing CLI/compiler exports | Split only if non-CLI consumers require an independently versioned artifact SDK. |
| Local supervisor, endpoints, leases, and reload orchestration | Existing CLI/Vite runtime with internal modules | Publish separately only when useful without the CLI or development daemon. |
| Provider-neutral scheduling, actor, lakehouse, and observability definitions | Existing application-facing package and focused subpath exports | Keep provider implementations out of the domain package; avoid one package per primitive until pruning value is proven. |
| AWS target implementations | One cohesive Alchemy AWS provider family with tree-shakeable subpaths | Split a provider only when it has independent lifecycle/versioning or materially costly dependencies. |
| Kubernetes implementations | TypeKro factories/compositions plus the thin Applik8s target adapter | Do not copy TypeKro lifecycle code into Applik8s packages. |
| Development daemon, portal, provider adapter, and skills | One `@applik8s/dev` package with explicit subpaths | Existing RFP criteria govern any later split. |
| Acceptance fixtures and generated product features | Agentic Start, Chirp, and GuestBook source | Domain examples remain application code; reusable mechanics graduate only after a second real consumer. |

Every proposed package or public subpath records its consumer, replaceability, dependency weight, and
pruning value in the application plan/package review. Internal testability alone is not sufficient reason
to create another npm package.

## Core target matrix

| Capability | Local | AWS-local | AWS | Kubernetes |
| --- | --- | --- | --- | --- |
| Application host | process/container | MiniStack ECS when selected | ECS/Fargate | TypeKro host |
| Transactional database | PostgreSQL | MiniStack RDS | RDS PostgreSQL; Aurora only after separate qualification | CNPG |
| Index/cache | Valkey | MiniStack ElastiCache | ElastiCache | Valkey |
| Object storage | local/S3-compatible | MiniStack S3 | S3 | Rook/Ceph or external S3 |
| Stream | NATS/compatible local | MiniStack Kinesis | Kinesis | NATS/JetStream |
| Queue | local queue | MiniStack SQS | SQS | selected provider |
| Scheduler | deterministic local | API-fidelity only | EventBridge Scheduler | bounded CronJob or qualified shared provider |
| DNS/HTTP | development router | local AWS evidence | Route53/ACM/ALB | DNS/certificate/gateway providers |
| Observability | local OTel collector | compatible collector evidence | CloudWatch through OTel | ClickStack/HyperDX or external OTLP |
| Low-latency analytics | PostgreSQL/ClickHouse | compatible provider only | external/managed compatible provider | ClickHouse |
| Lakehouse query | DuckDB | Athena/Glue/S3 emulation | Athena/Glue/S3 | compatible external provider |
| Actors | deterministic local/celld local | provider-compatible target | qualified distributed provider | celld or another qualified self-hosted provider |

The matrix is an intended baseline, not permission to hide unsupported semantics. Each provider publishes
capabilities and evidence.

## AWS boundary

AWS support is not complete if it provisions only ECS, RDS, S3, ElastiCache, Kinesis, Route53, and EBS.
A safe target also needs:

- VPC and private networking;
- IAM roles and least-privilege policies;
- secret authority;
- OCI image authority, normally ECR;
- ingress/load balancing;
- certificates;
- health and autoscaling policy;
- CloudWatch logs, metrics, and diagnostics;
- adoption, drift, replacement, retention, and teardown behavior.

These are maintained provider implementation concerns. Generated domain source should not become a
directory of AWS resource constructors.

EBS remains private to providers unless a portable application requirement proves otherwise.

## MiniStack boundary

MiniStack provides valuable AWS-compatible development fidelity and advertises support for the services
needed by this program. Applik8s pins and tests a known version through its own compatibility manifest;
it does not dynamically trust an upstream service list.

MiniStack is:

- an endpoint and lifecycle target for AWS providers;
- optional;
- local-only;
- useful for ECS/RDS/ElastiCache/S3/Kinesis/Route53/Athena-style integration.

MiniStack is not:

- an application-facing provider capability;
- the fastest default development mode;
- evidence for AWS production IAM, networking, quotas, encryption, availability, or upgrades;
- a production target.

## Analytics decision

v0.8 refuses to flatten different analytical products into one misleading interface.

- `AnalyticalDatabase` remains the low-latency analytical-serving contract used by PostgreSQL and
  ClickHouse-compatible projections.
- `LakehouseQuery` is introduced for published object snapshots queried by DuckDB or Athena/Glue/S3.
- Queries declare consistency and latency requirements.
- Planning rejects incompatible bindings.

Applications may use both. This is more honest and more expressive than forcing one to impersonate the
other.

## Actor decision

Actors are a beta execution family with a stable semantic ambition:

- identity-addressed with one schema-backed typed protocol;
- callback-oriented `Actor.on.<member>()` handlers;
- directly callable typed commands and one-way typed messages derived from that protocol;
- optional typed realtime connections, broadcasts, and durable alarms expressed as provider
  capabilities rather than universal assumptions;
- one serialized inbound turn per key in v0.8;
- durable typed state;
- idempotent command, message, connection, and alarm admission;
- framework-owned outbox effects;
- durable alarms;
- hibernation and recovery;
- explicit state migration;
- canonical operation authority;
- provider capability negotiation.

celld is the first distributed implementation candidate because its identity-addressed SQLite cells,
object-storage fencing, alarms, hibernatable WebSockets, and small self-hosted topology closely fit the
requirement. Its native Durable Objects interleaving across `await` does not satisfy Applik8s full-turn
serialization by itself; the adapter must strengthen that behavior and prove it. Rivet follows as an
independent conformance and operational-maturity target. Neither reputation, adoption, nor provider
claims confer beta qualification, and the Applik8s API must not become a thin spelling over either
provider.

## Development-agent decision

The development agent is an independent development system:

```text
package-owned portal -> Applik8s development daemon -> OpenCode provider
                                      |
                                      +-> mutable application and local runtime
```

It is not a feature route in the generated backend. It remains available through compile errors, server
crashes, broken migrations, and router failures.

The coding provider cannot mutate files or run arbitrary commands directly from browser requests. The
daemon brokers typed operations, plans, approvals, patches, validation, and journals. OpenCode is the
first replaceable backend, not part of the application programming model.

## Agentic Start responsibility

Agentic Start remains the primary product-level acceptance application. v0.8 extends it without turning
generated source into framework implementation:

- generated domain features remain editable application code;
- maintained local/AWS/Kubernetes providers live in packages;
- generated workloads receive graph-derived access rather than application-wide credentials;
- the developer portal and OpenCode integration live in packages/processes outside the generated app;
- an optional toolbar connects the product UI to the portal;
- one bounded collaborative feature exercises actors;
- one fixed maintenance schedule and one product-configured recurring schedule exercise function-native
  scheduling without provider-specific application code;
- one historical usage/evaluation feature exercises lakehouse query;
- existing billing, identity, assistant, documents, reviews, operations, and lifecycle journeys must not
  regress.

The Start must demonstrate the architecture rather than contain alternate local runtimes, actor stores,
or coding-agent registries.

## Acceptance applications

Acceptance is vertical- and target-scoped by
[`v0.8-target-compatibility.json`](v0.8-target-compatibility.json). The portable stable core runs on local,
AWS, and Kubernetes without domain-source branching. Actors, lakehouse, observability backends, and the
development agent qualify only on targets that implement their declared semantics. A missing qualified
provider fails planning or requires an explicitly selected external provider; it never creates a hidden
target branch in domain code.

### Agentic Start

Required target-scoped journeys:

1. **Local:** create and run without Kubernetes.
2. **Local:** complete the credential-free product journey.
3. **Local:** add one developer-provided AI credential without exposing it to the coding agent.
4. **Local, AWS, and Kubernetes:** inspect source-attributed inferred access for the web, processor,
   agent, workflow, and migration workloads without granting application-wide credentials.
5. **Every compatible target:** inspect one canonical application plan in text, JSON, graph, and diff
   forms and trace every physical resource, access edge, and estimate back to its authored semantic
   requirement.
6. **Local and Kubernetes with ClickStack; AWS with CloudWatch:** follow one
   HTTP-to-model-to-event-to-processor-to-AI-to-workflow journey through correlated traces, logs, and
   metrics.
7. **Local, AWS, and Kubernetes:** declare one fixed recurring schedule and one dynamically configured
   schedule, launch a workflow from the scheduled closure, and observe the same logical occurrence,
   prior-receipt recovery, runtime-access attribution, and causal telemetry without provider APIs in
   application source.
8. **Local and Kubernetes with a qualified distributed provider:** use a Workspace actor whose typed
   protocol exercises one command,
   one-way message, durable alarm, and optional realtime connection/broadcast without provider APIs in
   application source. celld is the intended first candidate; AWS requires an explicitly qualified actor
   provider rather than a source branch.
9. **Local and AWS:** write historical usage/evaluation data to object storage and query it through
   `LakehouseQuery`. Kubernetes requires a qualified external lakehouse provider.
10. **Local:** select a running product control and ask Builder to add a reviewed cross-cutting typed
   feature using visible UI/source/graph/trace/plan attachments; validate it, observe hot reload, and
   undo it.
11. **AWS and Kubernetes:** produce deployment plans from the same source as the local application.
12. **Real AWS acceptance account:** deploy and exercise the stable-required provider inventory and the
    beta-required lakehouse slice.

### Chirp

Chirp remains a distributed-systems pressure test:

- local stream and projection path without Kubernetes;
- Kinesis/S3/RDS-compatible AWS plan;
- inferred per-workload stream, object, model, projection, and Secret access with no wildcard fallback;
- one actor-backed hot identity such as timeline cursor or rate-limit/session coordination only where the
  actor abstraction is genuinely appropriate;
- no replacement of relational social data with actor blobs.

### GuestBook

GuestBook remains the readability floor. It must not become complex merely because v0.8 exists. Its
local path should become simpler and faster, and its AWS/Kubernetes target differences should be visible
only in installation/provider code and plans.

## Feasibility-spike policy

A provider spike is a bounded decision instrument, not an open-ended implementation stream. Before it
starts, it records the pinned provider version, fixture, questions, time/cost budget, responsible owner,
required evidence, and the public contract it is allowed to influence.

Every spike ends in exactly one disposition:

- `qualify` — proceed with the proposed provider and contract;
- `qualify-with-degradation` — publish an explicit capability limitation and planning diagnostic;
- `replace-provider` — retain the semantic contract and evaluate another adapter;
- `defer-pillar` — remove the beta/preview surface according to the drop policy; or
- `amend-contract` — return to maintainer review before implementation continues.

| Spike | Must prove before its public boundary freezes | Failure disposition |
| --- | --- | --- |
| MiniStack | Pinned API compatibility, endpoint injection, restart, drift, cleanup, and truthful unsupported-service diagnostics | AWS-local is narrowed or omitted; real AWS remains authoritative. |
| EventBridge Scheduler | Required occurrence metadata, SQS admission, retry/DLQ behavior, IAM, update/adoption, quotas, and deletion | Replace the AWS scheduler provider or mark the scheduling vertical incompatible with AWS; do not leak AWS APIs into domain code. |
| celld | Full-turn serialization across `await`, admission/result recovery, atomic state/effects/alarms or an equivalent protocol, fencing, migration, realtime, and lifecycle | Evaluate another distributed provider or defer actor beta; deterministic local evidence cannot substitute. |
| Rivet | Independent protocol, durability, realtime, migration, and operational comparison | Remains nonblocking evidence unless explicitly promoted. |
| DuckDB/Athena | One bounded typed query subset, snapshot fidelity, schema mapping, pagination, cancellation truthfulness, and cost evidence | Narrow or defer lakehouse beta rather than pretending provider parity. |
| ClickStack/CloudWatch | OTLP signal fidelity, trace links, metric temporality, log correlation, redaction, backpressure, readiness, and lifecycle | Degrade the individual provider maturity; retain the provider-neutral OTel contract when sound. |
| OpenCode | Supported protocol, streaming/cancellation, restart recovery, source-governance boundaries, and stable adapter behavior | Omit the development-agent preview without weakening stable runtime work. |

A failed spike cannot silently widen a provider escape hatch, weaken a stable semantic guarantee, or
become production code merely because substantial implementation effort was spent.

## Program sequencing

### Phase 0 — Contract inventory and target separation

- Freeze profile-versus-target terminology.
- Inventory provider guarantees, lifecycle owners, local/Kubernetes assumptions, and AWS gaps.
- Define cross-target graph artifacts and compatibility diagnostics.
- Freeze and gate canonical graph-node, operation, execution-boundary, provider, and source identities;
  recursive helper/module closure discovery; provenance stability; ambiguity rejection; and sensitive-
  data exclusion before dependent pillars implement public projections.
- Create the machine-readable v0.8 scorecard and executable acceptance manifest before implementation.
- Create the target-compatibility matrix, exact AWS provider inventory, and gate-cadence policy before
  provider implementation expands.
- Define the provider guarantee vocabulary, maturity labels, differential conformance fixtures, and drop
  disposition for every promised provider.
- Define the versioned runtime-access vocabulary, execution-identity model, and provider-enforcement
  fidelity contract.
- Freeze the versioned `ApplicationPlan` schema, stable node identities, provenance, renderers, and diff
  contract before target-specific plan output becomes public.
- Freeze the OpenTelemetry semantic attributes, propagation/link rules, redaction policy, cardinality
  budgets, and profile-aware logs/metrics/traces configuration contract.
- Freeze the function-native scheduling definition/instance/occurrence contract, overlap and misfire
  policies, stable occurrence identity, prior-receipt recovery, qualified-provider requirements, and
  fixed-versus-high-cardinality topology limits.
- Complete bounded MiniStack, EventBridge Scheduler, ClickStack/CloudWatch, celld, Rivet,
  DuckDB/Athena, and OpenCode feasibility spikes before their public APIs or adapter boundaries freeze.
  The celld spike must cover full-turn serialization across `await`, state/outbox/alarm durability,
  Worker artifact generation, object-store fencing, realtime, and deployment lifecycle.

### Phase 1 — Canonical application plan

- Derive target-independent semantic demand and provider resolution from the canonical graph.
- Define the versioned native-plan adapter contract and compose existing TypeKro/Alchemy Kubernetes plan
  records without creating another deployment authority.
- Ship stable text, JSON, graph, and diff renderers with source provenance, labeled estimates, unknowns,
  maturity, and security-safe redaction.
- Make the plan artifact the common input to CLI, developer portal, Builder review, CI, and operations.

### Phase 2 — Lightweight local runtime

- Run web/server and captured handlers as supervised local processes.
- Add local PostgreSQL, Valkey, NATS, and object providers.
- Lift existing Kubernetes RBAC inference into provider-neutral, source-attributed access records and
  issue only required local bindings to each generated process.
- Implement stable endpoints, logs, hot reload, recovery, and reset safety.
- Add the local-supervisor physical-plan adapter and reconcile planned local topology with live evidence.
- Move the development portal onto the independent daemon foundation.
- Run a package-managed OpenTelemetry collector and surface correlated local traces, logs, and metrics.
- Add imported `schedule(parameters, closure)`, qualified `Scheduler` declarations, and the deterministic
  local-clock provider using the same captured-closure, authority, runtime-access, and telemetry paths as
  other managed execution boundaries.

### Phase 3 — Function-native scheduling qualification

- Converge existing workflow cron, one-time, Hatchet, and Kubernetes scheduling machinery on the shared
  definition/instance/occurrence contract without retaining competing application APIs.
- Qualify bounded Kubernetes CronJob lowering and one shared high-cardinality Kubernetes scheduler
  provider through TypeKro; fail planning before schedule-per-instance control-plane growth exceeds the
  provider's declared bound.
- Prove fixed, dynamic, recurring, and one-time behavior; overlap/misfire semantics; occurrence receipts;
  crash recovery; authority; inferred runtime access; causal telemetry; and lifecycle on the deterministic
  local clock and OrbStack.

### Phase 4 — Unified observability

- Instrument every maintained HTTP, model, event, processor, schedule, workflow, actor, AI, query, and reconciler
  boundary with stable OpenTelemetry semantics.
- Propagate trace context synchronously and use causal links for queues, streams, batches, retries,
  fan-out, durable workflows, and actor turns.
- Add structured-log, metric, and trace controls for levels, filters, intervals, temporality, sampling,
  batching, redaction, retention, and cardinality.
- Qualify ClickStack/HyperDX through TypeKro and generic external OTLP without building an Applik8s APM
  UI. CloudWatch qualification follows the AWS foundation.

### Phase 5 — AWS Alchemy foundation

- Add network, IAM, secrets, registry, ECS, ingress, DNS/certificate, and observability providers.
- Add RDS, ElastiCache, S3, Kinesis, and SQS capability bindings.
- Add EventBridge Scheduler, schedule groups, SQS admission, retry/DLQ behavior, IAM, and stable
  occurrence metadata without exposing AWS schedule APIs to domain source.
- Add the AWS physical-plan adapter and qualify CloudWatch through the AWS collector/agent path.
- Qualify every entry in [`v0.8-aws-provider-inventory.json`](v0.8-aws-provider-inventory.json) at its
  declared release disposition.
- Lower semantic access records into distinct Alchemy deployment permissions and application task
  permissions; prove narrowing, drift repair, and interruption-safe policy updates.
- Establish create/update/adopt/drift/delete evidence.

### Phase 6 — MiniStack fidelity

- Pin MiniStack and route supported AWS providers through it.
- Publish compatibility evidence and fail-closed exclusions.
- Keep it opt-in rather than default.

### Phase 7 — Durable actors

- Land schema-backed actor protocol, generated callback/call surfaces, and deterministic provider.
- Integrate compiler, authority, state, messages, commands, optional realtime behavior, alarms, migration,
  and operations.
- Implement celld first across local, TypeKro/Kubernetes, Alchemy/AWS, and external fleet bindings.
- Prove full-turn serialization, fencing, state/outbox/alarm durability, node loss, realtime, migration,
  and Kubernetes lifecycle before celld can satisfy beta qualification.
- Add Rivet second as an independent nonblocking conformance and operational-maturity target.

### Phase 8 — Lakehouse query

- Implement the bounded lakehouse contract without expanding the portable-runtime RFP.
- Add DuckDB and Athena/Glue/S3 providers behind one differential conformance suite.
- Prove snapshot frontier, schema evolution, pagination, timeout, cancellation, cost, and real-AWS
  compatibility.

### Phase 9 — Development-agent preview

- Add independent portal, change journal, OpenCode adapter, versioned skills, semantic diffs, validation,
  and undo.
- Add development-only component provenance, accessible element/text/region selection, daemon-side
  source/graph/trace/plan resolution, and persistent conversation attachments/referents.
- Integrate with Agentic Start through a disposable toolbar.

### Phase 10 — Acceptance and release qualification

- Complete local, AWS-local, AWS, Kubernetes, actor, security, package-consumer, and product gates.
- Conduct clean-context source and browser review.
- Publish explicit stable/beta/preview labels.

## Proposed release train

```text
0.8.0-alpha.1  canonical application plan and runtime-access graph
0.8.0-alpha.2  local target, function-native schedule contract/local provider, OTel collector, and independent daemon foundation
0.8.0-alpha.3  Kubernetes scheduling qualification, unified instrumentation, ClickStack/HyperDX, and external OTLP
0.8.0-alpha.4  AWS Alchemy foundation, EventBridge Scheduler, managed providers, AWS plan adapter, CloudWatch, and MiniStack
0.8.0-alpha.5  actor contract, deterministic runtime, celld provider, and Rivet conformance target
0.8.0-alpha.6  lakehouse query providers
0.8.0-alpha.7  OpenCode-backed Builder preview
0.8.0-rc.1     Agentic Start, Chirp, GuestBook, real AWS, and Kubernetes qualification
0.8.0          maintainer-authorized release with maturity labels intact
```

This is dependency order, not permission to leave earlier alpha foundations broken while adding later
surface area.

## Cross-cutting release gates

### Developer experience

- A clean Agentic Start runs without Kubernetes and reaches useful UI within published budgets.
- Kubernetes and MiniStack are opt-in fidelity targets.
- Target selection does not require domain source changes.
- Every failure state names the failing semantic node and a useful next action.

### Canonical identity and provenance

- Graph-node, operation, execution-boundary, provider, and source identities are stable, duplicate-
  checked, and independent of traversal order or incidental source location.
- Recursive supported helper/module closure discovery attributes every known typed effect to the exact
  execution boundary that performs it.
- Source movement changes provenance without creating false semantic or physical replacement.
- Ambiguous handles, incomplete closure discovery, identity collision, and unsupported dynamic behavior
  fail closed with bounded explicit escape hatches.
- ComponentizeJS/WIT/Wasmtime/Rust host fixtures preserve identities and provenance across the guest/host
  boundary.
- Credential, payload, private prompt, and confidential-source canaries remain absent from graph and
  provenance artifacts.

### Application and graph parity

- One authored target-compatible application graph lowers without domain-source branching to every
  target marked required by `v0.8-target-compatibility.json`.
- Capability mismatches fail during planning.
- Source-to-node provenance remains intact across targets.
- No resource has multiple lifecycle owners.
- The machine-readable scorecard, executable acceptance manifest, public exports, package metadata, and
  documentation agree on scope and maturity.

### Application planning

- One versioned artifact contains semantic demand, resolved providers, and physical topology without
  becoming a second application or deployment graph.
- Authority, data flow, runtime access, state, execution, exposure, lifecycle, retention, observability,
  provider maturity, cost classes, unknowns, and estimates preserve source provenance.
- Text, JSON, graph, portal, CI, and Builder views are deterministic renderers of the same artifact.
- Alchemy, TypeKro, and local-supervisor plan details retain their native authority and are composed by
  stable identity rather than copied into an untraceable summary.
- Plan diffs distinguish semantic, provider, physical, access, lifecycle, and estimate changes.
- Secrets and sensitive values never enter the artifact; estimates and unknowns cannot be presented as
  deployed facts.

### Provider maturity

- Every provider publishes machine-readable guarantees for ordering, replay, retention, acknowledgement,
  duplicate behavior, transaction/outbox boundaries, consistency, payload limits, access enforcement,
  and lifecycle support.
- Differential conformance tests cover every guarantee claimed by more than one provider.
- AWS-local proves API compatibility only; IAM, networking, encryption, availability, quotas, upgrades,
  and cost require real-AWS evidence.
- An unqualified provider remains experimental even when it implements a stable target contract.
- Every AWS provider appears exactly once in `v0.8-aws-provider-inventory.json` with a required,
  experimental, or deferred release disposition; an unlisted adapter cannot satisfy v0.8 acceptance.

### Acceptance cadence

- Per-PR gates contain deterministic static, compiler, unit, conformance, security, and package checks.
- Nightly gates contain stateful local, OrbStack, MiniStack, browser, lifecycle, and integration checks.
- Release-candidate gates contain real AWS, CloudWatch, Athena, a qualified distributed actor provider,
  EventBridge Scheduler, Kubernetes scheduling/lifecycle, migration, upgrade, and clean-consumer
  qualification. Rivet remains nonblocking unless explicitly promoted in the scorecard.
- Historical benchmarks record performance, scale, telemetry overhead, and provider cost without making
  timing-sensitive measurements ordinary PR blockers.
- Every executable gate declares at least one cadence in `v0.8-acceptance.json`; unchanged external state
  or cost never justifies silently skipping a required release-candidate gate.

### Runtime access and least privilege

- Every maintained capability operation declares semantic access behavior or explicitly declares none.
- Direct typed calls and supported helper closure graphs infer source-attributed requirements.
- Requirements attach to the smallest independently deployable execution identity rather than one
  application-wide role.
- Local, AWS, and Kubernetes lowerings preserve semantic intent and state their enforcement fidelity.
- Dynamic or raw provider access fails closed unless a bounded explicit requirement is reviewed.
- Wildcards and provider-administrative access are never inferred as fallback.
- Application authorization remains an independent required gate.
- Policy addition, narrowing, drift, interruption recovery, and deletion pass live gates.

### Unified observability

- All maintained managed boundaries propagate one stable OpenTelemetry resource and causal vocabulary.
- Synchronous calls use trace parentage; asynchronous delivery, fan-out, batching, replay, and retries
  use trace links without falsifying execution order.
- Structured logs correlate with trace, operation, execution, tenant, application, deployment, and
  provider identities subject to redaction and cardinality policy.
- Metric names, units, temporality, histogram boundaries, export intervals, and cardinality budgets are
  versioned and tested; trace sampling and log filtering are profile-aware and visible in the plan.
- Telemetry export has bounded queues, retry budgets, drop counters, and failure isolation so a backend
  outage cannot block business execution.
- ClickStack/HyperDX passes local/Kubernetes live gates, CloudWatch passes real-AWS live gates, and a
  generic external OTLP endpoint passes compatibility gates.
- Applik8s does not ship a competing APM UI or require application code to depend on a backend SDK.

### Function-native scheduling

- Imported `schedule(parameters, closure)` and qualified `Scheduler.named(...)` declarations compile to
  inert graph definitions rather than starting timers during module import.
- Fixed recurring, one-time, and dynamically configured schedule instances share one typed closure and
  one definition/instance/occurrence/attempt vocabulary across targets.
- Every logical occurrence has a stable identity and prior receipt, so physical at-least-once delivery
  cannot silently duplicate the managed closure's admitted logical execution.
- Overlap, misfire, retry, timeout, dead-letter, pause/resume, update, drift, and deletion behavior are
  explicit provider requirements and visible in the application plan.
- Scheduled closures may naturally call `Workflow.start(...)`; there is no separate workflow overload or
  provider-shaped schedule API in domain source.
- The scheduling principal is framework-derived from the admitted occurrence. A principal that creates
  or edits a dynamic schedule is recorded for audit but is never replayed as the runtime caller.
- Deterministic local, real-AWS EventBridge Scheduler, bounded Kubernetes CronJob, and a qualified shared
  Kubernetes scheduler pass the evidence declared by `v0.8-acceptance.json`.

### Lifecycle

- Create, no-op, update, interruption recovery, drift repair, retention, migration, and deletion pass for
  each stable provider.
- UID/account/region/environment leases prevent cross-installation deletion.
- External/shared resources are retained and diagnosed.

### Actors

- Deterministic local and celld providers pass protocol typing, full-turn serialization across `await`,
  idempotency, fencing, crash, state/outbox/alarm durability, migration, authority, optional realtime,
  and rollout conformance before celld satisfies the beta gate.
- Rivet runs the same suite as an independent nonblocking target until explicitly promoted.
- Actor beta status and provider limits are visible.
- Models and workflows remain authoritative for their existing responsibilities.

### Development environment

- Portal, session, diff, and undo remain available while the app is broken.
- Unrelated dirty changes survive agent apply/undo.
- Agent claims require executable validation evidence.
- Element, text, and region selections resolve with explicit exact/candidate/stale/unresolved/external
  evidence and never invent source or graph relationships.
- Builder attachments and named referents are persistent, inspectable, detachable, redacted, revision-
  aware, and independent of provider chat memory.
- One visual request produces code, semantic-graph, authority, runtime, and `ApplicationPlan` context and
  a correctly scoped change proposal.
- OpenCode is not exposed directly and is replaceable.

### Security

- Secret canaries are absent from graph artifacts, Alchemy state, logs, images, Builder context, and UI.
- AWS tasks receive least-privilege IAM.
- Runtime access cannot grant application permission, and application permission cannot conceal missing
  infrastructure access.
- Local management services bind to loopback.
- Actor references do not grant authority.
- Prompt injection cannot expand development-agent tools or approvals.
- Selected page text, DOM metadata, route content, source comments, traces, and plan labels remain
  untrusted; visual selection cannot grant source egress, tools, operation authority, or deployment.
- Production artifacts omit development component provenance as well as the daemon and toolbar.
- Telemetry baggage is allowlisted; secret and PII canaries are absent from spans, logs, metrics,
  collector buffers, and backend indexes; tenant fields cannot bypass isolation policy.

### Supply chain and packaging

- Every new package has a justified public boundary or remains internal.
- Clean consumers install only declared dependencies.
- Container and provider artifacts are pinned, signed where supported, and provenance recorded.
- MiniStack, celld, Rivet, OpenCode, OpenTelemetry Collector, ClickStack, HyperDX, and AWS compatibility
  versions are explicit.

### Performance and cost

- Local cold start, warm restart, hot reload, memory, CPU, and disk budgets are recorded historically.
- AWS plans identify cost classes and resources before apply.
- Actor activation, turn latency, hot-key behavior, state size, and capacity are benchmarked.
- Athena queries expose scanned bytes/cost evidence where available.
- Telemetry overhead, collector memory, queue depth, dropped records, ingestion volume, sampling,
  retention, ClickHouse storage, and CloudWatch cost classes have recorded budgets.
- Schedule configuration rate, active instances, admission latency, missed/late occurrences, queue lag,
  retries, dead letters, control-plane resources, and provider cost have recorded budgets.
- The development agent has bounded context, command, token, time, and output budgets.

Phase 0 records the reference hardware, operating system, dataset, fixture revision, sample count, and
measurement method in acceptance metadata. The initial falsifiable ceilings are:

| Budget | Initial ceiling |
| --- | --- |
| Local first useful Agentic Start route | 30 seconds from `applik8s dev` with dependencies installed and provider images cached; uncached download time is reported separately |
| Warm application restart | 5 seconds p95 without restarting unaffected stateful providers |
| UI hot update | 2 seconds p95 from file event to usable browser update |
| Captured-handler rebuild | 8 seconds p95 from file event to replacement worker readiness |
| Canonical plan generation | 5 seconds p95 for Agentic Start and byte-stable output after timestamp normalization |
| Graph/provenance/access inference overhead | No more than 25% wall-time and 20% peak-memory regression over the same compile with derived analysis disabled |
| Default telemetry overhead | No more than 5% p95 request-latency and 10% steady-state CPU regression in the reference journey; outage queues remain bounded and drops are counted |
| Kubernetes CronJob topology | 100 active CronJob-backed instances per application/environment by default; larger declared cardinality requires a qualified shared scheduler or an explicit lower bounded ceiling |
| Development-daemon recovery | Portal health and journal-backed session visibility restored within 5 seconds after daemon restart on the reference fixture |
| Real-cloud acceptance spend | Every run has a maintainer-configured hard ceiling and pre-apply estimate; exceeding either aborts before new paid resources are created |

Actor latency/state/capacity, Athena scan/result, EventBridge configuration-rate, and provider-specific
telemetry ceilings are spike outputs and must be frozen before the corresponding beta or provider API
freezes. A threshold may change only with recorded benchmark evidence and an explicit scorecard/acceptance
review; a failing measurement cannot be relabeled informational during release qualification.

## Migration requirements

v0.8 must preserve v0.7 applications:

- existing Kubernetes/TypeKro deployment remains valid;
- local target is additive and does not silently replace current development mode until qualified;
- profile declarations retain meaning while target becomes separately explicit;
- existing `AnalyticalDatabase` bindings do not become Athena;
- existing raw Kubernetes scheduling remains available as an explicit deployment primitive while the
  imported function-native `schedule()` becomes the application golden path;
- actors are additive and do not rewrite models or workflows;
- existing explicit Kubernetes permission declarations remain valid while equivalent known typed calls
  may become redundant diagnostics rather than breaking changes;
- Agentic Start generated projects do not suddenly include a production coding-agent service;
- target/data migrations require explicit plans.

Pre-1.0 permits API refinement, not silent data loss or ambiguous ownership.

The release publishes and tests this migration matrix:

| v0.7 surface/state | v0.8 treatment |
| --- | --- |
| Existing Kubernetes/TypeKro application deployment | Continues to plan and reconcile under its existing lifecycle owner; selecting `local` or `aws` is an explicit target migration. |
| Existing Alchemy/TypeKro persisted state | Adopted by stable logical/physical identity or rejected with a migration diagnostic; it is never silently recreated under a new owner. |
| Explicit Kubernetes permission declarations | Remain valid; equivalent inferred access is reported as redundant before any optional cleanup. |
| Raw Kubernetes `app.schedule(...)` image/command declarations | Remain an explicit Kubernetes infrastructure escape hatch or receive a codemod diagnostic; they are never reinterpreted as captured function-native closures. |
| Workflow cron and compatible one-time scheduling | Lower through the shared schedule graph with a previewed stable-identity mapping and no duplicate active schedule. |
| Existing models, workflows, events, signals, and projections | Preserve public semantic identity unless the application accepts an explicit migration plan. |
| Agentic Start generated application | Gains local target and optional development tooling through regeneration/update guidance; production does not acquire a coding daemon or toolbar implicitly. |
| New application-plan/runtime-access/telemetry artifacts | Additive derived artifacts whose first deployment shows policy/topology changes before apply; no credential or application state is imported into them. |

Release qualification includes a v0.7 fixture with retained relational/object data, explicit RBAC,
workflow scheduling, and TypeKro state. It upgrades, plans, converges, rolls back where supported, and
deletes without duplicate ownership or data loss.

## Non-goals

- Supporting every AWS service.
- Declaring MiniStack a production environment.
- Removing Kubernetes or TypeKro.
- Multi-cloud parity.
- Transparent movement of canonical state between providers.
- Multi-region active-active actors in the first actor release.
- Turning every stateful entity into an actor.
- Replacing workflows with actor calls.
- Treating actor alarms as application schedules or exposing scheduler-provider APIs in domain source.
- Inferring application roles or user grants from runtime call sites.
- Emitting wildcard infrastructure access when static inference is incomplete.
- Shipping an autonomous unreviewed coding agent.
- Hosting the development agent in the generated backend.
- Building a full IDE or generic cloud-management console.
- Making the preview Builder a release-evidence authority.
- Treating a broad AWS provider catalog as stable because the target contract or a smaller core slice is
  stable.
- Building a proprietary Applik8s APM, logging, or metrics UI instead of integrating standard backends.
- Maintaining a Datadog-specific provider in v0.8; compatible users may select generic external OTLP.
- Treating the observability ClickHouse store as an application `AnalyticalDatabase` by default.
- Claiming exact cost or capacity prediction from a static application plan.

## Principal risks

### Breadth without depth

Nine program pillars can produce nine incomplete systems. Mitigation: stable/beta/preview labels, dependency
ordering, and no weakening of stable runtime gates to advance preview work.

### Misleading plans

A polished plan can imply certainty the compiler does not possess. Mitigation: source provenance,
separate semantic/provider/physical layers, explicit unknown and estimate classes, stable diffs, native
Alchemy/TypeKro detail links, and reconciliation evidence that remains distinct from planned state.

### Telemetry cost, cardinality, and privacy

Automatic instrumentation can create runaway cost or leak sensitive context. Mitigation: stable semantic
attributes, allowlisted baggage, framework redaction, per-signal budgets, bounded queues, sampling,
drop/ingestion metrics, retention defaults, tenant isolation, and secret/PII canary tests.

### Maturity contagion

A stable target abstraction can accidentally make every adapter appear production-ready. Mitigation:
provider-level labels, machine-readable guarantees, differential conformance, real-target evidence, and
fail-closed planning for unqualified providers.

### False portability

Cloud and Kubernetes services differ. Mitigation: typed requirements, capability negotiation, distinct
analytics contracts, and real-target gates.

### Split lifecycle authority

AWS, Kubernetes, local processes, and actors could each grow competing graphs. Mitigation: one semantic
graph and explicit lowerer/owner for every physical resource.

### Incorrect or over-broad access inference

A missing requirement can break production while an over-broad one can become a security vulnerability.
Mitigation: capability-owned semantic descriptors, canonical expression provenance, fail-closed dynamic
access, per-workload identities, provider policy diffs, explicit ceilings, live denial/narrowing tests,
and no wildcard fallback.

### Actor semantic leakage

The first provider could dictate the public model. Mitigation: deterministic conformance runtime, a
celld adapter that explicitly bridges rather than exports Durable Objects semantics, independent Rivet
conformance, and provider capability contracts.

### Scheduler semantic leakage and topology explosion

A local timer, Kubernetes CronJob, shared workflow scheduler, and EventBridge Scheduler do not have
identical delivery, overlap, misfire, quota, or lifecycle behavior, and schedule-per-instance lowering can
overload a Kubernetes control plane. Mitigation: one semantic contract with explicit provider guarantees,
stable occurrence admission, qualified-provider selection, graph-visible topology estimates, hard
high-cardinality bounds, and fail-closed planning rather than hidden emulation.

### Coding agent damages its host

Embedding it in the generated backend would strand recovery. Mitigation: independent daemon/frontend,
optimistic patches, journals, validation, and undo.

### Secret exposure

Local credentials and coding models create a dangerous boundary. Mitigation: exact secret schemas,
default exclusion, redaction, canary tests, and separate grants for narrow diagnostics.

### Local runtime becomes another platform

A complex supervisor could recreate Kubernetes poorly. Mitigation: process-first layering, containers only
for stateful fidelity, MiniStack/Kubernetes opt-in, and a strictly development-only scope.

## Closed v0.8 decisions

- Local process/container execution is the default development path.
- Kubernetes remains a first-class fidelity and production target.
- AWS infrastructure is expressed through Alchemy providers; TypeKro continues to own Kubernetes
  compositions.
- MiniStack is an AWS-local target implementation, not a public capability.
- Application profile and deployment target are distinct.
- Canonical identity, execution-boundary attribution, recursive closure discovery, and source provenance
  form a stable Gate 0 shared by planning, access, telemetry, actors, lakehouse, and Builder.
- Target portability means one target-compatible semantic graph without domain-source branching; the
  machine-readable compatibility matrix defines required verticals and missing providers fail planning.
- The exact AWS v0.8 provider slice and maturity disposition are frozen in the machine-readable AWS
  provider inventory.
- Acceptance gates declare per-PR, nightly, release-candidate, or historical-benchmark cadence.
- v0.8 implementation starts with cohesive internal modules and existing package/subpath boundaries;
  public package splitting requires independent consumer value, replaceability, versioning, dependency
  weight, or meaningful pruning value.
- One versioned `ApplicationPlan` is the shared explanation artifact for CLI, portal, CI, Builder, and
  operations; it composes rather than replaces Alchemy, TypeKro, and local-supervisor plans.
- Plan output separates semantic demand, provider resolution, and physical topology and labels
  provenance, estimates, unknowns, maturity, and cost classes.
- Known typed capability calls and framework-generated behavior infer provider-neutral runtime access.
- Runtime access requirements attach to exact execution identities and remain distinct from application
  authorization.
- Explicit permission APIs remain for dynamic, external, administrative, and raw-provider boundaries;
  unknown access fails closed and never widens to wildcard automatically.
- AWS support includes foundational networking, IAM, secrets, images, ingress, certificates, and
  observability.
- OpenTelemetry is the stable telemetry protocol and semantic boundary for traces, structured logs, and
  metrics across all maintained runtimes.
- Imported `schedule(parameters, closure)` is the function-native scheduling golden path;
  `Scheduler.named(...)` uses the existing qualified dependency-injection model rather than creating a
  scheduler-specific configuration system.
- Scheduled closures launch workflows through ordinary `Workflow.start(...)`; v0.8 does not add a direct
  `schedule(parameters, workflow)` overload.
- Deterministic local supervision, EventBridge Scheduler, bounded Kubernetes CronJob, and a qualified
  shared Kubernetes scheduler are provider implementations of the same declared requirement, not APIs
  imported by domain code.
- Scheduling uses stable occurrence identities and prior receipts, and never impersonates the principal
  who configured a dynamic schedule when executing a later occurrence.
- ClickStack/HyperDX and CloudWatch are bounded maintained providers; generic external OTLP is the
  portability escape hatch. Applik8s does not build its own APM UI.
- A maintained Datadog-specific provider is outside v0.8 scope.
- Athena implements a separate lakehouse query capability rather than impersonating ClickHouse.
- Lakehouse query is a bounded beta pillar with its own RFP and does not inherit stable AWS-target
  maturity.
- Actors are provider-neutral schema-backed protocols with generated callback and interaction surfaces,
  authority integration, optional realtime capabilities, and beta maturity in v0.8.
- celld is the first distributed actor implementation candidate and earns beta qualification only from
  the complete shared conformance and lifecycle suite.
- Rivet is the second independent conformance and operational-maturity target and is initially
  nonblocking.
- The development agent uses an independent portal and daemon with OpenCode as a replaceable backend.
- Its optional toolbar is a bounded product-context bridge; daemon-owned resolution maps visual
  selections to source, graph, runtime, and `ApplicationPlan` evidence with explicit uncertainty.
- Builder conversations persist explicit developer-controlled attachments and named referents rather
  than relying on opaque coding-provider memory.
- The generated application backend never owns its own coding-agent control plane.
- Agent changes require plan, diff, approval, optimistic apply, validation, evidence, and undo.
- Stable portability work is not blocked on preview coding-model quality once preview safety gates pass.

## Definition of done

Applik8s v0.8.0 is ready only when:

1. the machine-readable scorecard and executable acceptance manifest agree with public exports,
   target compatibility, AWS provider inventory, packages, documentation, maturity labels, cadence, and
   live evidence;
2. a generated Agentic Start runs quickly and usefully without Kubernetes;
3. canonical identities, recursive closure discovery, execution-boundary attribution, and source
   provenance pass deterministic, ambiguity, source-movement, WASM/host, and sensitive-data gates;
4. one versioned application plan truthfully explains semantic demand, provider resolution, physical
   topology, authority, data flow, runtime access, lifecycle, exposure, observability, maturity,
   estimates, unknowns, and cost classes across text, JSON, graph, diff, portal, and CI surfaces;
5. known typed behavior produces source-attributed, per-workload runtime access that lowers without
   duplicate provider policy and never substitutes for application authorization;
6. one correlated execution journey is inspectable through OpenTelemetry traces, logs, and metrics in
   ClickStack/HyperDX and CloudWatch, with bounded failure, redaction, sampling, and cardinality evidence;
7. fixed, dynamic, recurring, and one-time schedules preserve one function-native closure, qualified
   provider selection, stable occurrence identity, prior-receipt recovery, runtime access, causal
   telemetry, and bounded lifecycle behavior across local, AWS, and Kubernetes;
8. the portable stable-core semantic graph plans and converges through required local, AWS, and
   Kubernetes targets without domain-source branching, while target-scoped verticals follow the
   compatibility manifest;
9. every stable-required AWS provider and the beta-required lakehouse provider pass their declared real-
   AWS lifecycle and security gates;
10. MiniStack provides repeatable opt-in AWS fidelity without leaking into application source;
11. incompatible provider semantics and unresolved runtime access fail before deployment;
12. one published historical dataset passes DuckDB and Athena/Glue/S3 snapshot, schema, cancellation,
   pagination, and cost-evidence gates;
13. one real actor-backed feature passes deterministic local and a qualified distributed provider's
   serialization, durability, authority, alarm, migration, and lifecycle gates; celld is the intended
   first candidate and Rivet supplies independent conformance evidence;
14. the independent development portal survives application failure and performs one reviewed,
   evidence-backed, reversible OpenCode-assisted change anchored to a developer-selected product element,
   with inspectable visual/source/graph/trace/plan attachments and persistent referents;
15. Agentic Start, Chirp, and GuestBook preserve their v0.7 product and readability contracts;
16. stable, beta, and preview claims are explicit and independently evidenced;
17. per-PR, nightly, release-candidate, and historical-benchmark evidence is current at the cadence
    required by the acceptance manifest;
18. clean package-consumer, security, lifecycle, performance, real AWS, and Kubernetes gates pass; and
19. the maintainer reviews the resulting developer experience and explicitly authorizes release.
