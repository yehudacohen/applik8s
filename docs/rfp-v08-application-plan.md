# RFP: Applik8s v0.8 — Canonical Application Plan

**Status:** Proposed stable v0.8 contract. This document authorizes design review, not implementation or
release.

**Manifesto:** [`manifesto-v08-portable-stateful-development.md`](manifesto-v08-portable-stateful-development.md)

**Foundation gate:** The stable `graph-provenance` gate must pass before this contract is considered
implemented.

**Foundation dependencies:** The canonical v0.7 application graph, operation and authority identities,
closure discovery, Alchemy and TypeKro planning, and the manifesto's Phase 0 canonical identity,
provenance, target/provider, guarantee, and native-plan adapter records

**v0.8 contract integrations:** Portable local/AWS runtime, inferred runtime access, unified
observability, scheduling, lakehouse, actors, and the development environment contribute records
incrementally. The semantic/provider plan can be implemented before every physical adapter or vertical is
complete; unavailable native detail remains explicitly unresolved.

**Unblocks:** One truthful explanation surface for developers, CI, Builder, operations, security review,
and deployment approval across local, AWS-local, AWS, and Kubernetes targets

## Purpose

Applik8s already contains most facts needed to explain an application, but those facts are fragmented
across compiler output, provider selection, authority metadata, Alchemy plans, TypeKro graphs, generated
manifests, and runtime diagnostics.

v0.8 introduces one canonical, versioned `ApplicationPlan` derived from the application graph. It answers:

- what semantic behavior the application requires;
- which principals may cause which operations;
- how data and causality move through the system;
- which execution identities and state authorities exist;
- which providers satisfy the requirements for a selected profile and target;
- which physical processes, containers, services, policies, and resources will be managed;
- what is public, retained, shared, migrated, or external;
- what observability is installed and where it is exported;
- which facts are known, estimated, unknown, or unsupported; and
- what changed since the previous plan.

This is not a new application graph or deployment engine. Alchemy, TypeKro, and the local supervisor
retain lifecycle authority. The Applik8s plan composes their native plans by stable identity and relates
them back to semantic requirements.

## Required developer experience

```sh
applik8s explain
applik8s plan --target aws --environment production
applik8s plan --target kubernetes --format graph
applik8s plan --target aws --diff .applik8s/plans/production.json
```

The concise text view should read like an architectural review, not raw provider output:

```text
Application agentic-product

Semantic demand
  3 transactional models
  2 durable processors
  1 recurring schedule
  1 workflow
  1 AI agent
  1 transactional database
  1 event log
  1 notification provider
  1 HTTP application host

Authority
  web-user       -> Invoice.create
  billing-agent  -> Invoice.update
  invoice-worker -> Notification.request

Data flow
  Invoice.create
    -> transactional outbox
    -> InvoiceCreated
    -> processor invoice-notification
    -> Notification.request

  EntitlementsRefresh occurrence
    -> managed schedule closure
    -> RefreshEntitlementsWorkflow.start

Provider resolution
  TransactionalDatabase.primary -> RDS PostgreSQL       stable
  EventLog.primary               -> Kinesis             stable
  Scheduler.default              -> EventBridge Scheduler stable
  Notification.default           -> external provider   external evidence

Physical topology
  VPC, RDS, Kinesis, EventBridge schedule group and schedule,
  SQS schedule-admission queue, ECS web service, 2 ECS processors,
  task roles, ALB, Route53 record, ACM certificate, OTel collector

External exposure
  HTTPS billing.example.com

Estimates
  topology       4 compute tasks at minimum capacity
  cost class     medium, region dependent
  uncertainty    notification-provider egress is external
```

Every line can reveal source provenance and the lower-level provider plan without exposing credentials.
The JSON, graph, portal, CI, and Builder views render the same plan artifact.

## Owned contracts

This RFP owns:

- the versioned `ApplicationPlan` schema and compatibility policy;
- stable semantic, provider, and physical node identities;
- source provenance and derivation records;
- semantic-demand, authority, data-flow, state, execution, runtime-access, exposure, lifecycle,
  observability, provider-maturity, estimate, cost-class, diagnostic, and evidence sections;
- composition of Alchemy, TypeKro, and local-supervisor native plans;
- deterministic text, JSON, graph, portal, and diff renderers;
- planned, estimated, unknown, external, and observed fact classifications;
- security-safe redaction and plan artifact retention;
- cross-target and cross-version plan comparison; and
- release gates for completeness, stability, and truthfulness.

This RFP does not own:

- application authorization policy or admission decisions;
- provider implementation or resource lifecycle;
- Alchemy or TypeKro internal plan schemas;
- runtime reconciliation or observed-state collection;
- exact cloud billing prediction;
- an alternative application graph; or
- a generic infrastructure-as-code plan language.

## Three-layer contract

Every plan has three explicit layers.

### Semantic demand

The target-independent layer describes what application source requires:

- models, resources, operations, routes, events, processors, projections, schedules, workflows, signals,
  actors, AI agents, tools, queries, and reconcilers;
- state authorities, transaction/outbox boundaries, delivery semantics, and retention requirements;
- application authority edges and execution/causal principal boundaries;
- inferred and explicit runtime-access requirements;
- data-flow and causal edges;
- public exposure, identity, secret, availability, locality, and recovery requirements; and
- telemetry requirements and signal policy.

This layer must remain stable when only the deployment target changes.

### Provider resolution

The resolution layer records how qualified capabilities satisfy semantic requirements:

- capability identity and qualifier;
- selected provider and version;
- profile and target inputs that selected it;
- stable, beta, preview, experimental, or external maturity;
- supported, degraded, incompatible, or unresolved disposition;
- provider guarantees and semantic gaps;
- external responsibilities and required evidence; and
- source-attributed runtime-access lowering intent.

An unresolved or incompatible required capability is a planning failure, not a hidden physical omission.

### Physical topology

The target layer records expected managed and external topology:

- local processes, containers, ports, volumes, leases, and credentials;
- AWS accounts, regions, networks, roles, policies, services, databases, streams, buckets, registries,
  schedule groups, schedules, load balancers, DNS, certificates, collectors, and retention policies;
- Kubernetes namespaces, workloads, CronJobs, shared scheduler installations, Services, RBAC, Secrets,
  CRDs, operators, TypeKro compositions, and externally owned resources;
- dependency and deletion ordering;
- create, adopt, update, replace, retain, migrate, or external lifecycle intent;
- estimates for replica counts, storage, throughput class, and cost class; and
- stable links to native Alchemy, TypeKro, and local-supervisor plan records.

Physical topology is expected state. It does not become observed fact until deployment or reconciliation
evidence attaches separately.

## Canonical artifact

The public schema is versioned independently from internal compiler objects:

```ts
interface ApplicationPlan {
  schemaVersion: string;
  application: ApplicationIdentity;
  target: TargetIdentity;
  generatedAt: string;
  sourceDigest: string;
  semantic: SemanticPlan;
  resolution: ProviderResolutionPlan;
  physical: PhysicalTopologyPlan;
  diagnostics: PlanDiagnostic[];
  estimates: PlanEstimate[];
  evidence: PlanEvidenceReference[];
}
```

The actual schema may refine these names, but it must preserve the three layers and fact classes.
Internal pointers, closures, provider clients, credentials, and arbitrary objects are forbidden.
`generatedAt` and other evidence timestamps are excluded from content identity and semantic diffing.

### Stable identity

Plan node identity derives from canonical graph identity, qualifier, target, and lifecycle-owner identity.
It must not depend on traversal order, generated display names, source line numbers, timestamps, or random
values.

Source movement may change provenance without manufacturing a semantic create/delete. Provider or
physical identity changes remain visible even when the semantic node is unchanged.

### Provenance

Every derived claim records one or more origins:

- authored declaration and module;
- captured call site or helper path;
- framework-generated behavior;
- profile/provider selection rule;
- provider plan record; or
- external responsibility declaration.

Provenance is structured data. Renderers may show file and line hints, but source locations are not node
identity.

### Fact classes

Every value that might imply certainty is classified:

- `declared` — explicitly authored or configured;
- `derived` — deterministically inferred from canonical inputs;
- `resolved` — selected by provider/profile/target rules;
- `planned` — produced by a lifecycle authority before apply;
- `estimated` — calculated with stated assumptions;
- `unknown` — required but not currently knowable;
- `external` — owned outside the deployment with named evidence responsibility; or
- `observed` — attached from a separately identified reconciliation evidence source.

Renderers must not collapse `estimated`, `unknown`, `planned`, and `observed` into one apparent truth.

## Plan sections

The stable contract includes at least:

1. application and target identity;
2. semantic requirements and counts;
3. execution identities and scaling boundaries;
4. application authority;
5. runtime access and provider-policy lowering;
6. data and causal flow;
7. state authorities, consistency, retention, and recovery;
8. provider resolution, guarantees, maturity, and gaps;
9. physical topology and lifecycle intent;
10. external exposure and trust boundaries;
11. observability signals, collectors, exports, retention, and cost controls;
12. estimates, cost classes, assumptions, and unknowns;
13. diagnostics, migration requirements, and destructive changes; and
14. links to native plan and runtime evidence records.

Optional sections may be added compatibly. A required semantic or physical node may not disappear merely
because a renderer does not understand its subtype.

## Composition with lifecycle authorities

### Alchemy

Alchemy remains authoritative for deployment ordering, state, adoption, replacement, and deletion of
resources it owns. The Applik8s plan imports stable resource identities, lifecycle actions, dependencies,
and sanitized diffs through a versioned adapter.

### TypeKro

TypeKro remains authoritative for Kubernetes resource graphs and Alchemy-backed Kubernetes lifecycle.
The plan composes TypeKro semantic artifacts, composition identities, ownership boundaries, and sanitized
resource actions. It must not reverse-engineer YAML as its primary contract.

### Local supervisor

The supervisor reports processes, containers, ports, volumes, leases, reload groups, credentials, and
dependencies through the same adapter boundary. Local topology is not hand-maintained CLI prose.

If a native plan is unavailable, the plan marks the physical section unresolved or uses a bounded
provider-declared estimate. It does not invent exact resources.

## Renderers and consumers

### Text

The default view is concise and progressive. `--details`, provenance expansion, and native-plan links
provide depth without flooding first-time users.

### JSON

JSON is the canonical serialized form. It validates against a published schema, uses deterministic
ordering, and is suitable for CI policy and archival comparison.

### Graph

The graph view distinguishes semantic, provider, and physical nodes and supports authority, data-flow,
runtime-access, dependency, lifecycle, and telemetry edge filters. It is a renderer, not a mutable graph.

### Portal and Builder

The developer portal and Builder consume JSON rather than re-infer architecture. Builder proposals show
the pre-change and post-change plan diff before mutation approval.

### CI and policy

CI can fail on explicit machine-readable conditions such as:

- unresolved stable capability;
- new public exposure;
- destructive state replacement;
- wildcard access;
- provider maturity regression;
- unbounded cardinality or retention;
- cost-class increase; or
- missing real-target evidence.

Policy operates on structured plan facts, never formatted text.

## Plan diff

Diffs classify changes as:

- semantic behavior;
- authority;
- data flow;
- runtime access;
- provider selection or maturity;
- physical topology;
- lifecycle or state migration;
- exposure or trust boundary;
- observability/cost policy;
- estimate only; or
- provenance only.

Stable identities prevent reorder noise. A renderer states when comparison crosses incompatible plan
schema versions. Plan migration must be deterministic and must not conceal a previously visible
destructive change.

## Security and privacy

The plan may include Secret identities and access relationships, but never Secret values, credential
material, raw environment contents, authorization tokens, private prompts, model inputs, or captured
payloads.

Provider diffs are sanitized before composition. Provenance paths are workspace-relative. External plan
sharing is opt-in. Tenant identifiers are summarized or redacted unless the plan is explicitly scoped to
that tenant and the viewer is authorized.

Secret and PII canaries must be absent from serialized plans, native-plan summaries, diagnostics, portal
views, CI artifacts, and Builder context.

## Failure semantics

Planning fails closed when:

- required provider resolution is ambiguous or unsupported;
- a physical resource cannot be attributed to one lifecycle authority;
- native plan identities collide;
- a stable semantic requirement disappears during lowering;
- dynamic runtime access has no bounded explicit declaration;
- required target facts cannot be represented truthfully; or
- a plan schema cannot be migrated safely.

Unknown estimates and external responsibilities may remain nonfatal when explicitly classified and when
the selected profile permits them.

## Implementation sequence

1. Freeze schema, stable identities, provenance, fact classes, and compatibility rules.
2. Emit semantic demand from the canonical graph with golden deterministic fixtures.
3. Integrate provider resolution and inferred runtime access.
4. Add the versioned native-plan adapter contract and compose the existing TypeKro/Alchemy Kubernetes
   adapter without waiting for new targets.
5. Add text, JSON, graph, and diff renderers over the semantic/provider artifact.
6. Add the local-supervisor physical adapter alongside the v0.8 local runtime.
7. Add the AWS physical adapter alongside the AWS Alchemy foundation.
8. Integrate portal, Builder, CI, operations, and release evidence.
9. Qualify each target adapter against the verticals required by `v0.8-target-compatibility.json` and live
   reconciliation evidence.

## Release gates

- Equivalent source produces byte-stable canonical JSON after timestamp normalization.
- Content digests and node identities are unchanged when only generation or evidence timestamps differ.
- Source movement changes provenance without causing false topology replacement.
- Required local, AWS, and Kubernetes verticals retain one semantic node identity for the same
  target-compatible requirement.
- Every physical resource links to exactly one lifecycle authority and at least one semantic origin.
- Text, graph, portal, CI, and Builder views agree with canonical JSON.
- Alchemy and TypeKro lifecycle actions are composed and traceable without being reimplemented.
- Plan diffs correctly classify security, state, exposure, maturity, cost, and estimate-only changes.
- Unsupported and ambiguous resolution fails before deployment.
- Secret and PII canaries never enter artifacts.
- Planned topology reconciles to live evidence or reports a structured drift reason.

## Non-goals

- Replacing Alchemy, TypeKro, Terraform, Pulumi, or Kubernetes planning.
- Predicting exact cloud bills or production capacity.
- Inferring business authorization from data-flow edges.
- Treating deployment success as proof of application correctness.
- Reverse-engineering arbitrary provider SDK usage.
- Making the graph renderer an infrastructure editor.
- Persisting credentials so a plan is self-deploying.

## Closed decisions

- `ApplicationPlan` is a stable versioned artifact derived from the canonical graph.
- It has distinct semantic-demand, provider-resolution, and physical-topology layers.
- Alchemy, TypeKro, and the local supervisor retain lifecycle authority.
- All public views render the same artifact.
- Provenance, estimates, unknowns, maturity, and external responsibilities are first-class.
- JSON is canonical; text and graph are deterministic renderers.
- Plans are security-safe and contain identities and relationships, not secret values.
- The plan is the review substrate for CI and Builder, but not an automatic deployment approval.

## Definition of done

This RFP is complete when the generated acceptance applications produce every plan required by
`v0.8-target-compatibility.json` with aligned semantic identities; every resolved provider and physical
resource is source-attributed;
authority, data flow, access, state, exposure, lifecycle, observability, estimates, unknowns, and cost
classes are visible; Alchemy and TypeKro native plan details remain authoritative and linked; text, JSON,
graph, diff, portal, CI, and Builder agree; sensitive canaries remain absent; and live reconciliation can
explain drift from the planned topology without rewriting history.
