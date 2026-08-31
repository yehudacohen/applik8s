# Manifesto: Applik8s v0.9 — Semantic Completion, Event Legibility, and 1.0 Readiness

**Status:** Accepted implementation program; architecture and RFP set frozen on 2026-08-30. This document defines the final semantic-completion pass,
application-event catalog, product-legibility program, documentation website, simplification boundary,
profile/provider-binding model, compatibility freeze, and release bar before `1.0.0-rc.1`. It does not by itself authorize a release,
promotion of beta/preview surfaces, or expansion beyond the closed v0.9 candidate scope.

**Audience:** Applik8s maintainers, Start authors, compiler/runtime owners, provider authors, TypeKro and
Alchemy integrators, documentation and website maintainers, security reviewers, acceptance-application
maintainers, and external TypeScript developers evaluating the 1.0 candidate.

**Target:** Applik8s v0.9.0

**Depends on:** An exact, machine-recorded released Applik8s v0.8.x baseline and its canonical application graph, `ApplicationPlan`,
provider profiles and concrete provider bindings, inferred runtime access, OpenTelemetry semantics, durable workflows,
actors, provider maturity contracts, Agentic Start, and independent development environment.

**Unblocks:** `1.0.0-rc.1`

---

## Thesis

Applik8s v0.8 should prove that one TypeScript application can describe a serious distributed system and
that the framework can explain, secure, run, observe, and evolve that application without splitting its
semantics across unrelated programming and infrastructure models.

v0.9 has two jobs.

First, it performs one final **semantic-completeness review** before the 1.0 programming model freezes.
Applik8s should not enter 1.0 with obvious holes in the application vocabulary when those holes can be
filled by small, compositional primitives that heavily reuse existing graph, runtime, provider, authority,
and observability machinery.

Second, it makes the resulting system understandable to someone who did not build it.

The release removes the next sixteen forms of friction:

1. **Finite managed work lacks a modern function-native primitive.** Imports, backfills, rebuilds,
   compactions, reports, model training, and other bounded background work should not masquerade as
   workflows or low-level container jobs.
2. **The existing `app.job(...)` vocabulary collides with that semantic need.** Infrastructure/container
   jobs must move behind an explicit workload namespace before `job()` becomes the application-level noun.
3. **Finite query processing lacks a canonical batch surface.** A query result should be processable in
   stable bounded windows without pretending it is a stream or inventing an ETL DSL.
4. **Application-significant facts are distributed across models, explicit events, workflows, jobs,
   actors, agents, approvals, and future transaction/ML surfaces.** Developers need one typed application
   event catalog whose narrowed selections behave like normal streams without pretending every source
   shares one physical log or one ordering/replay contract.
5. **Compensating distributed coordination is expressible as workflows but not named as a first-class
   application concept.** The framework should expose saga semantics honestly, including compensation,
   irreversible effects, recovery, and unknown outcomes, without calling them ACID.
6. **Machine-learned predictive behavior lacks a provider-neutral application primitive.** Typed learned
   computation should be possible without colliding with authoritative `model()` declarations or
   `AI.model()`.
7. **Persistent specialized agents risk becoming parallel runtimes.** Coding and research agents should be
   compositions of actors, agents, and capabilities rather than new identity/lifecycle systems.
8. **Continuous reconciliation is still physically identified with CRDs.** The valuable contract is a
   managed model with generations, authoritative status, fenced convergence, resync, deletion, and
   finalization. `Resource.on.reconcile` should preserve that meaning over Kubernetes, PostgreSQL, and
   qualified local providers without adding provider-specific handler APIs.
9. **Scheduling has several legitimate owners but too many partially overlapping kernels.** Jobs,
   workflows, dynamic schedules, actor alarms, processor convergence, and reconcile wakeups need one
   occurrence/provider algebra while remaining distinct application semantics.
10. **The product can be understood from implementation more easily than from the public story.** The
   website must explain what Applik8s is, who it is for, and why its programming model is different before
   introducing Kubernetes, TypeKro, Alchemy, or provider internals.
11. **The shortest successful path is not yet the canonical learning path.** A TypeScript developer should
   reach a working application quickly, change meaningful behavior, understand what was derived, and know
   where to go next without reading implementation history.
12. **The public vocabulary is not yet a 1.0 promise.** Names, aliases, package boundaries, generated
    conventions, maturity labels, diagnostics, and upgrade expectations must be reviewed deliberately.
13. **A 1.0 release candidate must be testable as a product, not only as a codebase.** A developer
    unfamiliar with the implementation must be able to create, modify, explain, debug, deploy, and upgrade
    a meaningful application without maintainer coaching.
14. **Profiles and deployment targets compete for assembly authority.** Typed provider bindings already
    contain the implementation, credentials, account, cluster, lifecycle, runtime, and infrastructure
    decision. Target, placement, substrate, and installation abstractions duplicate that authority.
15. **Simplifying assembly can orphan active deployment state.** Released v0.8 plans and Alchemy/TypeKro
    state need one exact, resumable identity and lifecycle-authority migration rather than a source-only
    rename or best-effort adoption.
16. **Effect safety is repeated and overclaimed across execution families.** Jobs, workflows, processors,
    reconcilers, commands, agents, and Sagas need one receipt/fencing/unknown-outcome contract without
    exposing effect plumbing in ordinary application handlers.

The v0.9 promise is:

> Applik8s closes the small set of missing semantics needed for a coherent 1.0 application model, exposes
> application-significant facts through one typed event catalog, then makes the whole system legible from
> the outside. A TypeScript developer can choose the right primitive, understand its guarantees, observe
> what happened, and deploy it without learning the implementation history.

v0.9 is intentionally broad across the closed semantic-completion program. It is not an open-ended
provider-catalog, multi-cloud-parity, or general plugin-platform expansion. Width is accepted where the
work closes one coherent pre-1.0 programming model; unrelated breadth remains out of scope.

It is the final **semantic-completion, event-legibility, simplification, documentation, website, migration,
effect-safety, and contract-freeze release** before 1.0.

---

## Positioning

The primary category is the application framework, not the deployment substrate.

The leading product statement is:

> **Build distributed applications and their infrastructure as one typed program.**

The supporting explanation is:

> Applik8s is a TypeScript framework for distributed applications. It combines an event-driven application
> model with capability-based dependency injection and Infrastructure from Code. Application source
> declares state, behavior, authority, and the capabilities it needs; Applik8s derives the runtime,
> permissions, providers, and infrastructure required to run it.

Infrastructure from Code and dependency injection explain how the system works. They do not reduce the
product to “TypeScript IaC” or “NestJS plus cloud resources.”

The website and docs must not lead with Kubernetes. Kubernetes, TypeKro, Alchemy, Hatchet, Rivet, Celld,
OpenCode, SearXNG, SageMaker, CNPG, ClickHouse, JetStream, EventBridge, or specific AWS services appear
only when they explain a selected provider implementation or execution host.

---

## v0.9 priority classes

The semantic-completeness pass distinguishes what must block 1.0 from what may remain beta or preview.

### 1.0 core and blocking

- resolve existing `app.job(...)` versus new application `job()` vocabulary;
- function-native finite `job()`;
- `Query.onBatch(...)`;
- `application.events` typed application event catalog;
- managed-model and portable `Resource.on.reconcile` semantic contract;
- canonical scheduling definition/instance/occurrence semantics;
- external capability bindings;
- Kubernetes-cluster dependency injection;
- profiles and concrete provider bindings without target/placement/substrate duplication;
- deterministic implementation identity and a resumable v0.8 deployment-state migration protocol;
- one shared receipt/fencing/unknown-outcome contract for stable effectful execution surfaces;
- production-qualified `researchAgent()` composition and provider-neutral `WebSearch`,
  `SourceRetriever`, and `ResearchEvidence` contracts;
- SearXNG-backed `WebSearch` through TypeKro's Alchemy integration, including external binding,
  authority, recovery, evidence, replacement, and teardown qualification;
- public API/package/diagnostic/compatibility freeze;
- documentation website, quickstart, primitive decision guide, `explain`/`plan`, troubleshooting, and
  upgrade journeys;
- continuous clean-context qualification.

### Beta and explicitly non-blocking for 1.0

- `application.transaction.saga(...)`;
- `ML.model(...)`;
- explainable domain `decision()` if the semantic-completeness investigation proves a distinct durable
  need beyond ordinary typed functions and operation admission.

### Preview/product modules and explicitly non-blocking for 1.0

- `codeAgent()`;
- OpenCode `AgentHarness` provider;
- Builder repo-aware visual development environment;
- other specialized durable-agent compositions.

### Development/testing product surface

- `journey()` as a discoverable acceptance artifact for Builder, testing, and clean-context validation.

As of 2026-08-30, the core semantic contracts are accepted and the v0.9 architecture/RFP set is frozen for
implementation. New foundational capability requires an explicit manifesto amendment. Editorial
clarifications and implementation corrections may refine wording without changing semantics; evidence
that a frozen contract cannot be implemented safely must reopen that contract explicitly rather than
silently changing it in code.

---

## Program authority and document map

This manifesto owns the v0.9 thesis, semantic-completeness gate, application-event catalog, product
narrative, documentation website hierarchy, public-vocabulary review, compatibility posture, acceptance
journeys, and the decision boundary for `1.0.0-rc.1`.

| Workstream | Owns | Must not own |
| --- | --- | --- |
| Finite jobs | `job()` identity/lifecycle/result/cancel/progress semantics; provider-neutral finite execution | workflow history, generic orchestration, provider-specific batch APIs in domain code |
| Query batching | finite query-window semantics, consistency guarantees, cursor/frontier rules, generated batch job surface | stream acknowledgement semantics, unbounded query scans, generic ETL language |
| Application events | typed event catalog, source narrowing, authority preservation, derived stream semantics, federation/materialization planning | one mandatory physical bus, fake global order, unrestricted all-event subscriptions |
| Managed models/reconciliation | provider-neutral desired state, status, generation, fencing, resync, finalization | broad multi-cloud parity, raw ambient clients, a second reconcile API |
| External capability bindings | runtime adapter, optional deployment contributor, readiness, lifecycle, Secret/config provenance, migration | a general plugin platform, provider catalog expansion, implicit ownership |
| Kubernetes cluster capability | named cluster DI, existing connection-alias convergence, exact API/network/credential access, mutation ownership | ambient kubeconfig, unrestricted clients, broad managed-cluster parity |
| Profiles/provider bindings | one optional assembly selector, provider-native typed configuration, deterministic provider resolution, actual physical plan | target/placement/substrate selectors, application installation objects, implicit provider replacement |
| Deployment-state migration | exact v0.8 baseline, logical-to-physical identity mapping, lifecycle-authority transfer, resumable migration, rollback and forward recovery | best-effort state adoption, silent destructive replacement, package-install-time mutation |
| Effect safety | effect identity, guarantee classification, receipts, fencing, explicit unknown outcomes, crash-boundary evidence | claiming exactly-once external side effects, guessing success or absence, hiding provider uncertainty |
| Scheduling | shared definition/instance/occurrence/provider semantics with distinct Job/workflow/actor/operator owners | one generic callback timer, provider-specific scheduling syntax |
| Saga coordination | saga identity, durable steps, compensation, commit/irreversible boundaries, recovery, plan/OTel semantics | distributed ACID, hidden 2PC, implicit compensation |
| ML models | typed logical predictive model identity, provider-neutral inference, artifact/version provenance | training scheduler, feature store, ML platform |
| Specialized agents | maintained code/research-agent compositions and capability contracts | new durable identity, new AI runtime, provider-specific application semantics |
| Builder development environment | repo-aware visual conversation, change/review/preview journey, development-only authority and workspace lifecycle | production application authority, hidden repository mutation, an OpenCode-specific public API |
| Development journeys | source-owned acceptance journeys and semantic event expectations | production orchestration/runtime state |
| Website/docs | positioning, mental model, quickstart, task docs, reference, maturity, upgrade path | second terminology system or unsupported claims |
| API/terminology freeze | canonical 1.0 vocabulary, package boundaries, aliases, deprecations | unrelated feature expansion |
| Diagnostics | semantic errors, source attribution, next actions, troubleshooting | suppressing provider truth or guessing state |
| Compatibility/upgrades | semantic-versioning policy, graph/plan/artifact compatibility, Start lineage, migrations | transparent destructive migration |
| 1.0 qualification | clean consumers, external review, docs/site acceptance, contract inventory | redefining scope to make a failing gate pass |

The detailed contracts live in:

- [Finite Jobs RFP](./rfp-v09-finite-jobs.md)
- [Query Batching RFP](./rfp-v09-query-batching.md)
- [Application Event Catalog RFP](./rfp-v09-application-event-catalog.md)
- [Managed Models and Portable Reconciliation RFP](./rfp-v09-managed-models-and-portable-reconciliation.md)
- [External Capability Bindings RFP](./rfp-v09-external-capability-bindings.md)
- [Kubernetes Cluster Capability and Injection RFP](./rfp-v09-kubernetes-cluster-capability.md)
- [Profiles and Concrete Provider Bindings RFP](./rfp-v09-profiles-and-concrete-provider-bindings.md)
- [ApplicationPlan and Deployment-State Migration RFP](./rfp-v09-application-plan-and-deployment-state-migration.md)
- [Effect Receipts, Fencing, and Unknown Outcomes RFP](./rfp-v09-effect-receipts-fencing-and-unknown-outcomes.md)
- [Scheduling Semantics and Convergence RFP](./rfp-v09-scheduling-semantics-and-convergence.md)
- [Saga Coordination RFP](./rfp-v09-saga-coordination.md)
- [ML Models RFP](./rfp-v09-ml-models.md)
- [Explainable Decisions Investigation](./rfp-v09-explainable-decisions.md)
- [Journeys RFP](./rfp-v09-journeys.md)
- [Specialized Agents RFP](./rfp-v09-specialized-agents.md)
- [Builder Development Environment RFP](./rfp-v09-builder-development-environment.md)
- [Documentation and Product Legibility RFP](./rfp-v09-documentation-and-product-legibility.md)
- [Public Contract and Compatibility Freeze RFP](./rfp-v09-public-contract-and-compatibility-freeze.md)

This manifesto is authoritative for program thesis, admitted scope, maturity, shared invariants,
sequencing, and release gates. Each linked RFP is authoritative for its detailed API and runtime contract.
When duplicated explanatory text drifts, the RFP governs and the manifesto must be corrected; duplicated
prose never creates a second implementation authority.

---

## Maturity contract

v0.9 does not automatically promote v0.8 beta, preview, or experimental features.

| Surface | v0.9 promise |
| --- | --- |
| `job()` | Stable candidate only after local and at least one maintained deployed profile pass lifecycle/interruption gates |
| `Query.onBatch(...)` | Stable candidate only after ordering/frontier/consistency/retry semantics are proven |
| `application.events` | Stable candidate only after typed narrowing, authority preservation, federation, and stream-derivation gates pass |
| Managed models and `Resource.on.reconcile` | Stable semantic candidate; PostgreSQL/non-Kubernetes providers remain evidence-qualified independently |
| External capability bindings | Stable candidate after managed/external lifecycle, readiness, Secret, migration, and no-mutation conformance |
| Kubernetes cluster capability | Stable candidate after existing operator aliases and imported handles share one authority across current and external clusters |
| Profiles/provider bindings | Stable candidate after target-selector removal, deterministic provider configuration/resolution, physical-plan evidence, and persisted-plan migration gates pass |
| Deployment-state migration | Stable release mechanism only after the exact released-v0.8 imperative, Alchemy, and GitOps paths pass interruption, rollback, forward-recovery, and deletion gates |
| Effect receipt/fencing contract | Stable shared runtime contract after Job, workflow, command, processor, and reconciler integrations preserve declared guarantees and honest unknown outcomes |
| Scheduling algebra | Stable candidate after Job/workflow scheduling and one lifecycle-owned timer pass shared identity/provider conformance |
| `application.transaction.saga(...)` | Beta unless compensation, crash recovery, idempotency, unknown-outcome, and upgrade semantics are convincingly evidenced |
| `ML.model()` | Beta and non-blocking unless materially different providers pass shared conformance |
| `researchAgent()` / `WebSearch` / `SourceRetriever` / `ResearchEvidence` | Stable candidate after the complete research lifecycle, authority, evidence, restart, replacement, and provider-conformance gates pass |
| SearXNG `WebSearch` provider | Maintained v0.9 provider; release-blocking after TypeKro/Alchemy deployment, external binding, safe retrieval, readiness, upgrade, and teardown qualification |
| `codeAgent()` | Preview maintained composition; never required for stable 1.0 core |
| Builder development environment | Preview development integration; independent and excluded from production by default; never required for stable 1.0 core |
| `journey()` | Development/testing contract; may stabilize independently from runtime semantics |
| Stable v0.8 authoring/runtime contracts | 1.0 candidates unless explicitly deprecated during v0.9 |
| Existing beta/preview features | Remain beta/preview unless separately promoted through evidence |
| Website/docs | Version matched, acceptance tested, and truthful for the exact package train |

Maturity is structured release data. Website copy cannot silently promote a provider or feature.

---

## Scope admission policy

A new core primitive is admitted only when:

- it represents a fundamental application semantic rather than implementation convenience;
- its meaning is distinct from existing primitives;
- it heavily reuses the existing semantic graph and runtime machinery;
- it composes with existing concepts instead of creating a second dependency or invocation grammar;
- its distributed guarantees can be stated precisely;
- provider-specific implementation remains below the application API;
- it materially improves the 1.0 mental model;
- it can be bounded and qualified before the contract freeze.

The closed semantic-completion candidate list is:

1. `job()`;
2. `Query.onBatch(...)`;
3. `application.events`;
4. managed-model and portable reconciliation semantics;
5. canonical scheduling and convergence semantics;
6. external capability bindings and Kubernetes cluster injection as DI completion;
7. saga-style distributed coordination under `application.transaction.saga(...)`;
8. `ML.model()`;
9. bounded investigation of explainable domain `decision()`;
10. `journey()` as development/testing infrastructure;
11. a release-qualified research-agent composition and SearXNG provider without making either a new
    foundational runtime, while other specialized-agent compositions remain preview evidence.

Any additional foundational runtime primitive requires a manifesto amendment.

---

## Architectural center

The canonical application graph remains the center:

```text
Authored TypeScript application
  state / behavior / authority / capabilities / execution semantics
                           |
                           v
Canonical Applik8s semantic graph
                           |
     +---------------------+---------------------+
     |                     |                     |
     v                     v                     v
ApplicationPlan      Runtime access        OTel evidence
     |                     |                     |
     +---------------------+---------------------+
                           |
               +-----------+-----------+
               |           |           |
               v           v           v
             local        AWS      Kubernetes
```

The v0.9 additions are semantic nodes, derived views, or reusable compositions inside that graph.

There is no separate job graph, event graph, saga graph, ML graph, or specialized-agent graph.

---

# Shared invariants

## One invocation grammar

Registered application capabilities are directly callable whenever their semantics permit it.

Prefer:

```ts
await SomeCapability(input);
```

over alias maps, provider calls, or generic `context.invoke(...)`.

A context method exists only when it marks a meaningful semantic boundary such as a workflow step, saga
step, signal, actor turn, finite-job execution context, or testing journey.

## One authority model

Jobs, workflows, sagas, actors, agents, ML inference, query batches, event subscriptions, and ordinary
operations use canonical operation identity and the existing principal/causal-principal model.

A new primitive does not create a parallel permission language.

## Providers remain below semantics

Application source does not name Hatchet, JetStream, EventBridge, OpenCode, SearXNG, SageMaker, Rivet,
Celld, ECS, Kubernetes Jobs, or AWS Batch when defining domain behavior.

Provider selection belongs to unconditional application assembly or the explicitly selected profile.

## Same programming model does not require same physical representation

A derived event selection may feel exactly like a Stream while being implemented as:

- one filtered consumer;
- several consumers with a vector frontier;
- a compiler-owned materialized stream;
- a provider-native event route;
- or a compilation failure because requested guarantees are incompatible.

Likewise a `job()` may lower through different provider implementations while preserving one application
contract.

## Specialized agents are compositions, not inheritance

Conceptually:

```text
codeAgent
  = actor
  + agent
  + workspace
  + source control
  + shell/process
  + coding harness

researchAgent
  = actor
  + agent
  + web search
  + source/evidence
  + research protocol
```

Not every agent is an actor. Not every actor is an agent.

## Lower layers remain extension seams

TypeKro and Alchemy remain implementation/provider-authoring layers.

An ordinary application author should not need their internals to understand `job()`, events, workflows,
sagas, actors, or agents.

## Deployment implementation invariant

Alchemy is the canonical deployment orchestration, state, dependency, and lifecycle engine for managed
infrastructure. The resource-authoring boundary is determined by what is being created:

```text
Kubernetes API resources
  authored/composed with TypeKro
  deployed and lifecycle-managed through TypeKro's Alchemy integration

Non-Kubernetes managed infrastructure
  authored as native Alchemy resources
  or as focused Alchemy resource extensions when upstream has no equivalent

External infrastructure
  no deployment contributor
  never created, adopted, mutated, or deleted by Applik8s
```

Creating a Kubernetes cluster is non-Kubernetes control-plane infrastructure: EKS, VPC, IAM, and analogous
resources use native Alchemy resources. Namespaces, CRDs, operators, Helm releases, workloads, Services,
policies, and other resources installed through that cluster's Kubernetes API use TypeKro.

Applik8s does not emit CloudFormation or another intermediate infrastructure template when a native
Alchemy resource lifecycle is available. It does not implement a parallel Kubernetes deployment engine
beside TypeKro, and TypeKro does not become a generic cloud-resource provider beside Alchemy.

Focused extensions preserve the same ownership rule: a missing Kubernetes integration is contributed to
TypeKro; a missing non-Kubernetes resource is implemented as an Alchemy resource and preferably
contributed upstream. Provider application code never selects or classifies these implementation details.

Local development supervisors, file watchers, preview processes, and in-memory fixtures are development
runtime state rather than managed infrastructure and are governed by `@applik8s/dev` lifecycle contracts.

## Deployment contribution is optional

A provider binding consists of semantic/runtime behavior plus an optional deployment contributor.
Managed implementations obey the deployment implementation invariant above. External implementations bind
validated endpoints and Secrets, contribute no owned infrastructure, and retain the same callable
capability contract. Dependency injection never implies provisioning ownership.

## Implementations compose recursively

A provider implementation is a typed, inspectable value. Higher-level implementations may accept other
implementation values or references to separately bound capabilities. This is the single composition
model for operator runtimes, managed stores, Jobs, workflows, actors, events/streams, schedulers, Sagas,
signals, projections, ML, agents, and Builder integrations.

```ts
const database = Database.auroraPostgres({ account: aws });
const scheduler = Scheduler.eventBridge({ account: aws });

application.provide(
  OperatorRuntime,
  OperatorRuntime.distributed({ database, scheduler }),
);
```

An integrated implementation may satisfy the same contract:

```ts
application.provide(
  OperatorRuntime,
  OperatorRuntime.kubernetes({ cluster }),
);
```

Reusing one implementation value or referencing one capability creates one dependency node. Equal
configuration does not imply sharing. Nested dependencies remain private unless explicitly provided,
never grant transitive callback authority, preserve one lifecycle owner, and participate in recursive
readiness, migration, dependency-first creation, and dependent-first teardown. The
[Profiles and Concrete Provider Bindings RFP](./rfp-v09-profiles-and-concrete-provider-bindings.md) owns
the canonical implementation algebra.

Process object identity is never persisted identity. The compiler derives a versioned implementation
identity from application/capability/provider/declaration provenance or an explicit `.identified(...)`
escape hatch, and rejects two logical nodes claiming one physical resource. Active v0.8 state crosses this
identity boundary only through the restart-safe [ApplicationPlan and Deployment-State Migration
RFP](./rfp-v09-application-plan-and-deployment-state-migration.md), including lifecycle-authority transfer,
rollback before commit, and forward recovery afterward.

Migration permits at most one active mutation/deletion authority. Source fencing, an epoch-bearing durable
handoff record, and target activation are separate compare-and-set phases. A bounded, visible quiescent
interval with no writer is safer than inventing cross-engine atomicity; two active writers are forbidden.

Kubernetes clusters are typed injectable capabilities. A closure receives only its declared resource and
endpoint authority, never ambient kubeconfig or an unrestricted raw cluster client. Explicit cluster use
constrains that execution without making unrelated application semantics Kubernetes-specific.
Node and componentized/WASM executions use one versioned host-mediated Kubernetes capability ABI; the
TypeScript handle is a generated proxy and credentials, transports, and `@kubernetes/client-node` are not
serialized into closures. Direct watches are bounded windows; continuous behavior remains lifecycle-owned.

---

# Effect safety across execution families

A lease can fence Applik8s-owned state; it cannot retract an external effect already accepted by another
system. Jobs, workflows, processors, reconcilers, commands, agents, and Sagas therefore share one logical
effect identity, guarantee classification, receipt, fencing, cancellation, retry, and unknown-outcome
contract. Providers may prove dependency fencing, idempotency, durable lookup, or transactional intent.
Transport failure and worker loss never prove absence.

The compiler enforces this contract for branded Applik8s handles and recursively discovered capability
calls. Arbitrary SDK behavior is not soundly inferred; stable managed closures must wrap it in an explicit
effect contract, mark the boundary unsafe, or reject it. The [Effect Receipts, Fencing, and Unknown
Outcomes RFP](./rfp-v09-effect-receipts-fencing-and-unknown-outcomes.md) owns the shared state machine and
crash matrix; each execution-family RFP owns its own admission and lifecycle. This introduces no public
`operation()` or `effect()` registrar: ordinary TypeScript closures call typed model/capability handles,
and the framework hydrates effect identity and receipts at the managed boundary.

Provider observation may append proven `succeeded`, `failed`, or `absent` receipts after an unknown
outcome. Administrative resolution is a distinct `operatorResolved` receipt with actor, evidence, action,
and acknowledged risk; it never fabricates provider evidence or rewrites history.

---

# Semantic primitive taxonomy

| Primitive | Responsibility |
| --- | --- |
| ordinary function | local in-process computation with no distributed identity |
| `model()` | authoritative queryable application data |
| managed-model facet | desired state, authoritative status, generation, deletion, and portable reconciliation |
| operation | typed callable application behavior with authority |
| `event()` | typed application fact |
| event processor | reactive work caused by a durable fact |
| `application.events` | logical typed catalog/federation of application-significant facts |
| `stream(Event, guarantees)` | explicit durable stream requirements for a source/fact family |
| `Query.onBatch(...)` | finite windowed processing of a bounded query source |
| `application.job()` / bound `job` alias | finite managed background computation |
| `application.workflow()` / bound `workflow` alias | durable multi-step orchestration through time |
| schedule | versioned desired timing and occurrence admission for a callable semantic owner |
| `application.transaction.saga(...)` | durable compensating coordination across independently committed systems |
| `actor()` | identity-addressed serialized stateful execution |
| `AI.model()` | logical generative-model capability |
| `ML.model()` | logical typed predictive/learned computation |
| `agent()` | AI execution with logical model, tools, identity, attempts, and run/conversation semantics |
| `codeAgent()` | preview reusable composition built from actor + agent + coding capabilities |
| `researchAgent()` | release-qualified reusable composition built from actor + agent + research capabilities |
| `journey()` | source-owned development/testing acceptance artifact |

The taxonomy exists to answer “which primitive should I use?” rather than to maximize nouns.

## Registration and contract-factory rule

`application.*` owns declarations that immediately register an application graph node, attach provider
selection, or participate in application assembly. Jobs and workflows therefore use
`application.job(...)` and `application.workflow(...)`. A domain module may bind those methods locally:

```ts
const job = application.job;
const workflow = application.workflow;
```

The resulting `job(...)` and `workflow(...)` source remains concise, but ownership is lexical and no
ambient process-global registry is involved.

A package-level bare or namespaced helper is appropriate when it creates a context-free contract, token,
or reusable module. Examples include `KubernetesCluster.named(...)`, `ML.model(...)`, `journey(...)`, and
`codeAgent(...)`. Such a value enters one application only through an explicit registration edge such as
`application.provide(...)`, `application.include(...)`, use by an application-owned declaration, or a
development-only discovery manifest. Ordinary TypeScript functions remain ordinary functions.

The framework does not expose both a global registrar and an application registrar for the same semantic
noun. Concision comes from lexical aliases and reusable modules, not hidden registration.

---

# Managed models and portable reconciliation

`<ManagedModel>.on.reconcile` is the canonical convergence surface whether the managed model is stored as a
Kubernetes resource, PostgreSQL row plus outbox, or qualified local record. Managed lifecycle enriches the
existing logical model and its native schema; it does not introduce a second model declaration language or
force relational data into a CRD-shaped JSON envelope. The portable contract owns identity, desired-value/
status writer separation, generation, resource version, fenced leases, resync, delayed
next-due intent, deletion, finalization, conditions, authority, and evidence. CRDs and EventBridge are
provider mechanisms, not application semantics.

The v0.9 stable candidate freezes this semantic model and qualifies Kubernetes plus a bounded
PostgreSQL/local path. It does not require broad AWS parity, DynamoDB, or a public target SPI. See the
[Managed Models and Portable Reconciliation RFP](./rfp-v09-managed-models-and-portable-reconciliation.md).

The release does require bounded golden-profile parity at the application-assembly level: Chirp must run
from unchanged semantic source under complete `production-aws` and `production-kubernetes` profiles
covering database, reconciliation, finite Jobs, hosting, object storage, event log, registry, and public
HTTP. This is a narrow integration commitment, not broad service, cloud, database, or feature parity. The
[Profiles and Concrete Provider Bindings RFP](./rfp-v09-profiles-and-concrete-provider-bindings.md) owns
the exact constructor vocabulary and evidence gate.

The portable callback observes one `value`/`status`/`conditions`/`metadata` shape. PostgreSQL preserves the authored
Drizzle row and relationships as desired-value authority while framework-owned lifecycle tables store only
UID/generation, typed status, finalizers, deletion, next-due, fencing, and receipts. Kubernetes maps the
same view to spec/status/metadata. Out-of-band SQL writes require qualified CDC/version evidence rather
than being silently treated as managed-model events.

The portable public lifecycle surface is explicit: schema-complete `status.update(...)`,
generation-stamped `object.conditions.set/remove`, and handle-owned `<ManagedModel>.on.finalize(...)`.
Finalizers are installed before owned effects become visible and removed automatically only after
successful terminal cleanup. Ambiguous partial nested-status patch semantics are not frozen in v0.9.

External services and Kubernetes clusters are framework-wide capability dependencies rather than
managed-model subtypes. Their ownership, readiness, credentials, runtime adapters, deployment
contribution, access, and migration contracts are owned by the
[External Capability Bindings RFP](./rfp-v09-external-capability-bindings.md) and
[Kubernetes Cluster Capability RFP](./rfp-v09-kubernetes-cluster-capability.md).

---

# Scheduling semantics and convergence

Job schedules, workflow schedules, dynamically reconciled schedules, actor alarms, processor convergence,
and `requeueAfter()` share one definition/instance/occurrence/provider algebra but retain distinct semantic
owners. The shared contract freezes occurrence identity, timezone, precision, overlap, misfire, retry,
daylight-saving gap/overlap behavior, cancellation, history, authority, migration, and provider evidence.
Provider-delivery retry remains distinct from target-execution retry. No generic `schedule(callback)` API
is introduced.

Ergonomic omissions normalize through one versioned framework default table before graph serialization;
providers cannot choose their own precision, daylight-saving, overlap, misfire, retry, cancellation, or
history defaults.

EventBridge Scheduler, Kubernetes controllers/CronJobs, workflow-engine cron, and local schedulers qualify
only the subset they can preserve exactly. See the
[Scheduling Semantics and Convergence RFP](./rfp-v09-scheduling-semantics-and-convergence.md).

---

# `job()` — finite managed execution

## Vocabulary migration

The existing low-level container/infrastructure `app.job(...)` spelling conflicts with the desired
application-level `job()` noun.

Before stable `job()` is introduced:

```ts
app.job(...)
```

must migrate to the explicit low-level namespace:

```ts
application.workload.job(...)
application.workload.cronJob(...)
```

The 1.0 vocabulary is:

```text
job()
  application finite work

application.workload.job()
  explicit low-level workload/container escape hatch
```

The old ambiguous spelling must not remain the canonical path.

The canonical application registrar is `application.job(...)`, matching the implemented
`application.workflow(...)` ownership model. A module may bind `const job = application.job` and
`const workflow = application.workflow` so declarations read as concise function-native `job(...)` and
`workflow(...)` calls without relying on ambient process-global registration. Low-level container
execution remains exclusively under `application.workload.job(...)`.

Package-level context-free factories are valid only when they return a module or contract later installed
through `application.include(...)`. A bare imported helper may not guess the owning application, mutate a
hidden registry, or select providers outside application assembly.

## Purpose

`job()` represents one finite unit of managed background computation.

Examples:

- import/export;
- backfill;
- reindex;
- report generation;
- object compaction;
- media/document processing;
- model training;
- one-time maintenance;
- bulk transformation.

A job is not a workflow with fewer steps.

It has start/run/terminal semantics, but it does not expose durable workflow control flow, waits, signals,
child orchestration, or replay history as its public model.

## Required developer experience

```ts
export const RebuildSearch = job(
  "search.rebuild.v1",
  {
    input: type({
      workspaceId: "string",
    }),
    output: type({
      indexed: "number.integer >= 0",
    }),
    progress: type({
      indexed: "number.integer >= 0",
      total: "number.integer >= 0",
    }),
    error: RebuildSearchError,
  },
  {
    retries: 3,
    timeout: "30m",
    idempotencyKey: input => input.workspaceId,
  },
  async (input, execution) => {
    let indexed = 0;

    for await (const page of DocumentsForWorkspace.pages({
      workspaceId: input.workspaceId,
    })) {
      execution.throwIfCancelled();

      await SearchIndex.replace(page.rows);

      indexed += page.rows.length;

      await execution.progress({
        indexed,
        total: page.total ?? indexed,
      });
    }

    return { indexed };
  },
);
```

Direct call waits for result:

```ts
const result = await RebuildSearch({
  workspaceId,
});
```

If the caller's bounded wait expires while the durable Job continues, the typed timeout error carries the
serializable run reference so the caller can rejoin. Caller timeout does not cancel the Job and is distinct
from the Job execution deadline.

Explicit asynchronous start:

```ts
const run = await RebuildSearch.start({
  workspaceId,
});

await run.result();
await run.cancel();
```

The execution context may expose:

```text
signal
throwIfCancelled()
progress(...)
invocationId
attempt
deadline
```

A generic arbitrary-state `checkpoint()` is not part of the initial stable contract until resume/replay
semantics are precisely defined.

The optional authored error schema describes expected domain failures. `execution.fail(error)` reports one
with a `never` return type. Unexpected exceptions become redacted framework execution failures;
cancellation and execution timeout remain distinct terminal outcomes rather than authored errors.

## Lifecycle

```text
declared
  -> admitted
  -> queued
  -> running
  -> succeeded | failed | cancelled | timedOut
```

Exactly one durable compare-and-set terminalizes the run. A cancellation request is a receipt-backed
request, not an immediate terminal claim: success/failure may win before `cancelled`, while a late provider
success cannot replace an already committed `cancelled` or `timedOut` outcome. The first terminal receipt
wins and remains immutable.

The application fact handles include:

```text
Job.events.started
Job.events.progressed
Job.events.succeeded
Job.events.failed
Job.events.cancelled
Job.events.timedOut
```

`Job.events.progressed` is a durable, coalesced progress snapshot. An individual
`execution.progress(...)` call is not promised as an independently replayable application fact.

The graph records:

- job identity;
- typed input/output/progress and optional domain error;
- execution identity;
- provider requirements;
- inferred runtime access;
- retry/idempotency policy;
- resource and execution-envelope requirements;
- cancellation/deadlines;
- progress/artifact evidence;
- terminal receipts;
- physical provider.

## Provider lowering

Possible lowerings:

```text
local        supervised process/container
AWS          ECS task; AWS Batch may be a later provider
Kubernetes   batch/v1 Job
external     qualified finite-compute provider
```

Provider guarantees determine interruption, retry, resource, and cancellation behavior.

---

# `Query.onBatch(...)` — finite query processing

## Purpose

A query can be a finite processing source without pretending to be an event stream.

The source owns the declaration:

```ts
const UnscoredCustomers = Customer.query(...);

export const ScoreCustomers = UnscoredCustomers.onBatch(
  {
    batch: { maxItems: 1_000 },
    concurrency: 8,
    consistency: QueryConsistency.repeatableSnapshot,
    retries: 3,
    timeout: "30m",
    resources: { cpu: "2", memory: "4Gi" },
  },
  async batch => {
    ...
  },
);
```

`Query.onBatch(...)` returns a `Job` handle.

The application does not separately declare a batch processor and then wrap it in another job.

The receiver remains the existing function-native `Model.query(contract, implementation)` handle. Only an
implementation returning the compiler-owned portable `QuerySelection` type exposes `.onBatch(...)` in
TypeScript. One-time invocation and batching execute the same normalized predicate, projection, authority,
ordering, identity, and relationship-read IR; opaque aggregate Queries remain valid one-time reads but do
not pretend to be resumable scans.

## Consistency is an explicit provider guarantee

The word `"snapshot"` is too vague.

The initial contract distinguishes at least:

```text
repeatable-snapshot
  all windows belong to one stable logical source snapshot

version-pinned
  provider exposes an explicit immutable source version/snapshot ID

monotonic-frontier
  source may change, but admitted traversal moves forward without silently
  reinterpreting earlier windows

best-effort
  provider pagination is usable but concurrent mutation may alter membership
```

The public API may expose:

```ts
QueryConsistency.repeatableSnapshot
QueryConsistency.versionPinned
QueryConsistency.monotonicFrontier
QueryConsistency.bestEffort
```

A consumer may require one.

Provider resolution must fail when the selected provider cannot deliver the requested guarantee.

It must never silently reinterpret a stronger requirement as a weaker one.

`bestEffort` is an explicit hazardous choice, never the default. It accepts that concurrent mutation may
change membership, ordering, or repeatability across windows. The author must acknowledge that limitation:

```ts
consistency: QueryConsistency.bestEffort({
  acceptsMembershipDrift: true,
})
```

A best-effort query-batch job:

- must use an idempotent handler/output identity;
- cannot drive an authoritative rebuild cutover;
- reports a non-reproducible result guarantee in `ApplicationPlan` and runtime evidence; and
- cannot be promoted to a stronger consistency class by a provider adapter.

PostgreSQL repeatable snapshots are a versioned framework-owned subsystem, not an indefinitely open
transaction. The admitted scan records tenant/application scope, query and parameter digests, authority,
source revision, row/byte limits, deadline, retention, and cleanup owner. Publication is atomic only within
the provider's declared bound; oversized snapshots fail before partial visibility, and crash/orphan tests
prove bounded cleanup and tenant isolation. The Query Batching RFP owns the complete operational contract.

## Distinction from `Stream.onBatch(...)`

```text
Stream.onBatch(...)
  source authority   ordered/replayable facts
  frontier           broker/source checkpoint
  completion         acknowledgement
  retry unit         frozen event batch

Query.onBatch(...)
  source authority   bounded query source
  frontier           query snapshot/version/cursor
  completion         finite scan frontier
  retry unit         stable query window
```

Concurrent query windows use durable per-window receipts and one contiguous committed frontier. A later
window may finish before an earlier one, but the frontier cannot advance across the gap. After a crash, an
already receipted later window is not rerun; the missing earlier window resumes, then the frontier advances
through the longest completed prefix. Providers unable to retain or reconstruct admitted windows must
serialize execution or reject concurrency.

Because the result is a Job, `onBatch` accepts the same retry, timeout, cancellation, execution-envelope,
and resource policy names directly alongside batch and consistency options.

## Projection and aggregation

v0.9 does not introduce a general query dataflow language.

The baseline composition is:

```text
query
  -> onBatch
  -> Job
  -> existing model/projection/analytical write capability
```

A future `Query.project(...)` or aggregation helper is justified only when it carries additional provable
semantics rather than duplicating `onBatch`.

---

# `application.events` — application event catalog and federated default stream

## Purpose

Applik8s already knows many application-significant fact families:

- model lifecycle facts;
- explicitly emitted domain events;
- job terminal outcomes;
- workflow terminal outcomes;
- approval resolution;
- saga outcomes;
- declared actor protocol outcomes;
- agent completion where consumed by application behavior;
- future ML invocation outcomes where explicitly durable.

Developers need one canonical place to discover and consume those facts.

The root is:

```ts
const Events = application.events;
```

`application.events` is not itself a claim that all facts already share one physical broker, cursor,
retention, ordering, authority, or replay contract.

It is a **logical typed application event catalog**.

Typed source selection derives a Stream-shaped view.

## Required developer experience

Source-family narrowing:

```ts
application.events
  .from(Order)
  .onEvent(async event => {
    ...
  });
```

Exact event-family selection:

```ts
application.events
  .of(
    DocumentPublished,
    RebuildSearch.events.succeeded,
    PublishWorkflow.events.failed,
  )
  .onEvent(async event => {
    ...
  });
```

Payload narrowing:

```ts
application.events
  .of(Order.events.updated)
  .where(event =>
    event.detail.current.status.eq("paid")
  )
  .onBatch(
    {
      batch: {
        maxItems: 500,
        maxWait: "2s",
      },
    },
    async batch => {
      ...
    },
  );
```

Broad access is explicit:

```ts
application.events
  .all()
  .onEvent(async event => {
    ...
  });
```

The narrowed selection should expose the familiar Stream experience where its requested guarantees are
satisfiable:

```text
where(...)
onEvent(...)
onBatch(...)
project(...)
subscribe(...)
replay/consumer options where supported
```

There is no second event-processing API for the catalog.

## Handle-based narrowing

The common path uses application handles, not strings.

Prefer:

```ts
application.events.from(Order)
application.events.of(Order.events.updated)
application.events.of(RebuildSearch.events.succeeded)
```

over:

```ts
event.kind === "job"
event.source === "RebuildSearch"
event.type === "succeeded"
```

The compiler may still expose typed metadata predicates, but application handles preserve identity and
type narrowing.

Lifecycle fact handles use one consistent facet:

```ts
Order.events.created
Order.events.updated
Order.events.deleted

RebuildSearch.events.succeeded
PublishWorkflow.events.failed
```

`Order.update` remains the callable mutation operation; `Order.events.updated` is the committed fact.
`application.events.from(Order)` returns the typed union of the model's catalogued lifecycle facts, while
`.of(Order.events.updated)` narrows the payload before `where(...)` evaluates update-specific fields.

Lifecycle details use one portable, provider-independent contract:

```ts
type ModelCreated<T> = {
  value: T;
};

type ModelUpdated<T> = {
  previous: T;
  current: T;
  changed: ChangedFields<T>;
};

type ModelDeleted<T, TIdentity> = {
  previous: T;
  tombstone: ModelTombstone<TIdentity>;
};
```

`ChangedFields<T>` is restricted to string keys of `T`, has a canonical sorted, unique array encoding,
and exposes typed membership in declarative selectors. `ModelTombstone<TIdentity>` contains the portable
model identity, deletion time, and optional model revision. It is never a raw database row, Kubernetes
deletion object, or provider-specific change record.

## Logical federation

Selected facts may originate from:

- PostgreSQL transactional outboxes;
- JetStream;
- workflow result/receipt stores;
- actor outboxes;
- Kubernetes observations;
- external provider events;
- different databases;
- different namespaces, clusters, or provider bindings.

They do not automatically share:

- total order;
- partitioning;
- cursor;
- retention;
- authorization boundary;
- tenant scope;
- consistency;
- physical provider.

Therefore the compiler derives a concrete stream topology only when a consumer requires one.

Possible lowerings:

```text
one compatible existing source
  -> filtered consumer

several compatible sources used only through onEvent
  -> composite consumer with per-source receipts and vector frontier

multi-source onBatch/project/subscribe, or normalized replay/ordering
  -> compiler-owned materialized stream

provider guarantees incompatible
  -> fail compilation with an explicit diagnostic
```

`Stream.onBatch(...)` already promises frozen membership and whole-batch acknowledgement. A vector
frontier alone cannot make acknowledgement atomic across independent source authorities. Therefore:

- a single compatible source may retain its native `onBatch` implementation;
- a multi-source `onEvent` selection may federate through independent source receipts;
- a multi-source `onBatch`, `project`, or `subscribe` selection materializes into one compiler-owned
  normalized stream unless a provider explicitly proves equivalent atomic composite-frontier semantics;
- materialization identity, migration, retention, and deletion appear in the graph and `ApplicationPlan`;
  and
- a crash between source observation and normalized publication is recovered through a durable inbox/outbox
  receipt rather than best-effort republishing.

The magical DX must never imply false distributed guarantees.

The stable v0.9 boundary is deliberately achievable. If heterogeneous live federation cannot prove these
semantics by the alpha.6 gate, the stable surface is:

- the typed application catalog;
- one compatible physical source selected directly; and
- compiler-materialized multi-source selections with one durable acknowledgement authority.

Non-materialized heterogeneous vector federation then remains beta. This narrows an implementation
strategy, not the application programming model, and prevents an ambitious provider optimization from
blocking semantic completion.

## No universal total ordering

A federated event selection does not imply one global causal sequence.

The canonical envelope records source-local position and causal metadata.

Conceptually:

```ts
interface ApplicationEvent<TDetail> {
  id: string;

  contract: {
    id: string;
    version: string;
  };

  source: {
    kind: ApplicationEventSourceKind;
    id: string;
  };

  subject?: {
    kind: string;
    id: string;
    revision?: string;
  };

  occurredAt: string;
  recordedAt: string;

  position: {
    source: string;
    partition: string;
    sequence: string;
  };

  invocation?: {
    id: string;
    correlationId?: string;
    causationId?: string;
    traceId?: string;
  };

  detail: TDetail;
}
```

A composite durable cursor may be a vector frontier over underlying positions.

If selected facts are materialized into one normalized provider stream, that provider may expose an
**arrival order**. The framework must not call arrival order a global causal order.

## Authority and disclosure

Selecting the catalog grants no authority:

```ts
const Events = application.events;
```

Runtime access and application observation authority are separate calculations.

For a backend consumer workload:

```text
runtime access
  = exact union of the physical source reads and normalized-stream writes
    required by that consumer
```

For an application or browser principal:

```text
observation authority
  = per-event-family and per-resource authorization evaluated for every
    delivered fact
```

This must remain true for:

```ts
application.events.from(Order).subscribe(...)
```

A server's ability to process Order lifecycle facts does not imply a browser may subscribe to every Order
fact.

Framework-owned authorization remains authoritative even when a broker can perform only a coarse physical
filter.

Provider-side filtering is optimization, not authorization.

Unauthorized facts do not reveal payload, type, subject, count, or source position. Opaque resumable
cursors may advance across undisclosed facts without exposing those positions. If selected event families
do not admit one safe observation contract, compilation fails instead of widening access.

## Application facts versus operational telemetry

The catalog contains application-significant facts.

Examples:

```text
model created/updated/deleted
explicit domain event
job terminal outcome
workflow terminal outcome
saga compensated/compensation-failed
durable approval resolution
declared actor outcome
agent completion when consumed by the application
```

OpenTelemetry remains the default for:

```text
worker acquired
retry attempt
heartbeat
poll
provider reconnect
queue delivery attempt
actor turn started
token chunk
physical worker restart
```

A lifecycle transition belongs to the catalog only when:

- the primitive contract declares it;
- or application code explicitly promotes it.

Consumer existence determines whether an additional physical materialization is required. It does not
silently change semantic catalog membership. Explicit promotion is a versioned graph/catalog change and
cannot claim historical replay for transitions that were not durably recorded before that revision.

This prevents write amplification and prevents application logic from depending on operational internals.

## Lazy materialization

The compiler should reuse authoritative receipts/outboxes where possible.

If a job's terminal result already exists durably, selecting:

```ts
application.events.of(RebuildSearch.events.succeeded)
```

does not require publishing a duplicate event to another broker unless a consumer requires a materialized
stream topology.

The catalog exposes semantic truth; providers choose the cheapest correct representation.

## Catalog revision and evolution

Every event consumer binds to a catalog revision and exact event-contract versions. Broad `.all()` is
explicit but revision-pinned by default: adding a model, job, workflow, or event family does not silently
expand an already deployed consumer.

An application plan shows catalog changes before deployment:

```text
Catalog consumer AuditAllEvents
  previous revision: 17
  desired revision: 18
  added:
    RebuildSearch.failed.v1
    Checkout.compensated.v1
```

The catalog contract defines:

- producer/consumer compatibility during rolling deployment;
- retained replay of older event-contract versions;
- explicit replacement and retirement of event families;
- unknown-event handling for broad consumers;
- schema compatibility and migration diagnostics;
- materialized-stream migration and replay-frontier preservation; and
- an explicit opt-in if a future API permits forward-expanding `.all()` behavior.

No catalog or consumer upgrade silently reinterprets an older payload as a newer contract.

## Recursion and event storms

A root selection can easily create cycles:

```ts
application.events
  .all()
  .onEvent(async event => {
    AuditRecorded.emit(...);
  });
```

The compiler/runtime therefore retain:

- causation chain;
- event depth;
- cycle signature;
- loop budget;
- dead-letter/terminal evidence.

Obvious unconditional self-cycles should fail at compile time where provable.

Possible or intentional cycles require bounded runtime behavior and inspectable evidence.

## Specialized streams remain explicit semantic requests

`application.events` does not eliminate `stream(...)`.

The distinction is:

```text
event(...)
  typed application fact

application.events
  logical catalog/federation of application facts

stream(Event, guarantees)
  explicit durable stream requirements
```

For example:

```ts
const PaymentCaptured = event(...);

const Payments = stream(PaymentCaptured, {
  partitionBy: event => event.accountId,
  retention: "7y",
  ordering: "partition",
});
```

The application explicitly asks for those semantics.

Applik8s infers whether they become JetStream, Kinesis, EventBridge, a materialized stream, or another
compatible provider topology.

The semantic requirements are explicit; the physical bus is inferred.

---

# `application.transaction.saga(...)` — compensating distributed coordination

## Naming

The framework must not expose a misleading bare:

```ts
application.transaction(...)
```

for a non-ACID distributed construct.

The initial public form is explicit:

```ts
application.transaction.saga(...)
```

This preserves a future transaction family while naming the guarantee.

Possible future strategies such as TCC require separate provider contracts and do not redefine Saga.

## Required developer experience

```ts
export const Checkout = application.transaction.saga(
  "checkout.v1",
  {
    input: CheckoutInput,
    output: CheckoutResult,
  },
  async (input, tx) => {
    const reservation = await tx.step(
      () => Inventory.reserve({
        items: input.items,
      }),
      {
        compensate: reservation =>
          Inventory.release({
            reservationId: reservation.id,
          }),
      },
    );

    const payment = await tx.step(
      () => Payments.capture({
        amount: input.total,
      }),
      {
        compensate: payment =>
          Payments.refund({
            paymentId: payment.id,
          }),
      },
    );

    const order = await tx.commit(() =>
      Order.create({
        reservationId: reservation.id,
        paymentId: payment.id,
      }),
    );

    return {
      orderId: order.id,
    };
  },
);
```

## Effect boundaries

Effectful calls inside a saga must occur inside an explicit saga boundary.

The compiler fails closed when an independently committed effect is performed outside:

```text
tx.step(...)
tx.commit(...)
tx.irreversible(...)
```

Semantics:

```text
tx.step(forward, { compensate })
  reversible participant

tx.commit(effect)
  final authoritative commit frontier for the saga

tx.irreversible(effect)
  explicitly non-compensatable effect
  strongly surfaced as risk in plan/explain
```

The final API may refine naming, but the semantic distinction is required.

The commit effect itself is durable state:

```text
prepared -> invoked -> observed -> committed | failed | unknown
```

Preparation records an idempotent commit identity and observer before invocation. A definitive failure may
compensate the still-open reversible frontier. An unknown result never triggers automatic compensation,
because the authoritative commit may exist. Recovery repeats the idempotent commit or observes it until
presence or absence is proven; unresolved ambiguity remains an operator-visible unknown outcome.

## Runtime lowering

Saga uses the existing durable workflow substrate:

```text
application.transaction.saga(...)
    -> saga semantic graph
    -> compiler-owned durable workflow lowering
    -> WorkflowEngine
    -> Hatchet initially
```

Hatchet owns durable execution/retry/recovery.

Applik8s owns:

- saga identity;
- step/compensation relationships;
- commit/irreversible boundaries;
- authority;
- causal principal;
- unknown-outcome semantics;
- `ApplicationPlan`;
- OTel correlation;
- application event outcomes.

## Honest plan contract

The plan states:

```text
Transaction Checkout
  strategy: saga
  atomicity: compensating
  isolation: none
  coordinator: WorkflowEngine -> Hatchet
  external exactly-once: not provided
```

Unknown external outcomes remain unknown rather than being guessed.

Saga remains beta unless its failure/recovery semantics are convincingly proven.

---

# `ML.model()` — typed learned computation

## Naming

The namespaces remain:

```text
model()
  authoritative application data

AI.model()
  logical generative-model capability

ML.model()
  predictive/learned computation
```

`ML.model()` lives in a distinct package/namespace and remains beta/non-blocking unless conformance becomes
strong enough to justify promotion.

## Required developer experience

```ts
export const ChurnModel = ML.model(
  "customer-churn",
  {
    input: type({
      tenureDays: "number",
      monthlySpend: "number",
      supportTickets: "number",
    }),
    output: type({
      probability: "number",
    }),
  },
  {
    capabilities: [
      ML.predict,
      ML.batchPrediction,
    ],
  },
);
```

Function-native online prediction:

```ts
const prediction = await ChurnModel(features);
```

Batch prediction when supported:

```ts
const predictions = await ChurnModel.batch(features);
```

## Owned semantics

`ML.model()` owns:

- logical identity;
- typed input/output;
- artifact/version provenance;
- inference capabilities;
- provider resolution;
- runtime-access requirements;
- online/batch inference receipts;
- observed physical model/version where available.

It does not own:

- feature stores;
- training orchestration;
- experiment tracking;
- distributed training runtime;
- hyperparameter search;
- promotion workflow;
- drift/retraining platform.

Training remains composition:

```text
LakehouseDataset/query
  -> Query.onBatch
  -> Job
  -> training capability
  -> model artifact/version
  -> ML.model()
```

ML must not block `1.0.0-rc.1` merely because its beta conformance matrix is incomplete.

---

# Explainable domain decisions — bounded investigation

Operation authority answers:

> Is this principal allowed to perform this operation?

That is not always the same as:

> Is this action currently eligible under product/domain state, and why not?

Examples:

- publication requires completed review;
- upgrade requires an entitlement;
- export requires a completed snapshot;
- a workspace may be frozen;
- a billing transition may require current account state.

v0.9 investigates whether those rules deserve a reusable graph-visible decision contract.

A possible shape is:

```ts
export const CanPublish = decision(
  "document.can-publish",
  {
    input: PublishEligibility,
    reasons: [
      "review-required",
      "entitlement-required",
    ],
  },
  async input => {
    if (!input.reviewed) {
      return deny("review-required");
    }

    if (!input.entitlements.includes("public-publication")) {
      return deny("entitlement-required");
    }

    return allow();
  },
);

Document.publish.requires(CanPublish);
```

The investigation asks whether this adds distinct value beyond:

- ordinary typed functions;
- queries;
- operation admission;
- authorization predicates;
- `beforeCommit`;
- Builder source/graph analysis.

If the answer is yes, it may ship beta.

If not, the framework should not add another noun merely to improve documentation.

The preferred noun is `decision()`, not `policy()`, because “policy” is already heavily overloaded.

---

# `journey()` — development/testing acceptance artifact

`journey()` is not a production execution primitive.

It is a source-owned artifact describing a user/product promise that Builder, tests, and maintainers can
discover and rerun.

Conceptually:

```ts
export const PublishDocumentJourney = journey(
  "documents.publish",
  async context => {
    const author = await context.identity({ roles: [Author] });
    const publisher = await context.identity({ roles: [Publisher] });

    const document = await context.as(author, () =>
      Document.create({
        ...
      }),
    );

    await context.as(publisher, () =>
      Document.publish({
        documentId: document.id,
      }),
    );

    await context.expectEvent(
      application.events.of(DocumentPublished),
      event =>
        event.detail.documentId === document.id,
    );
  },
);
```

Journeys may assert:

- operation result;
- model state;
- application event;
- authorization decision;
- UI/product interaction through development tooling;
- plan/runtime evidence where relevant.

Builder can use journeys to answer:

> Which user promise should I validate after this change?

A journey does not become production runtime state, workflow history, or application authority.

It belongs in `@applik8s/testing`, `@applik8s/dev`, or the final reviewed development package boundary.

Journey execution is isolated and explicit:

- roles remain authority definitions; `context.identity(...)` creates or selects fixture identities;
- each run receives a unique fixture/data namespace and stable journey/run identity;
- setup, cleanup, retention, and destructive behavior are declared and receipt-backed;
- execution eligibility and provider/Secret prerequisites are visible before execution;
- destructive deployed-profile journeys require separate approval;
- journeys are excluded from production runtime bundles and do not grant application authority; and
- compiler-discovered handle dependencies let Builder select the journeys affected by a proposed graph or
  source change.

---

# Specialized durable agents

## Architectural rule

`codeAgent()` and `researchAgent()` are high-level compositions, not peers of `actor()`, `workflow()`,
`job()`, or `application.events`. `researchAgent()` and its maintained SearXNG provider are
release-qualified v0.9 surfaces. `codeAgent()`, OpenCode, Builder, and other specialized compositions
remain preview.

They reuse:

```text
actor()
  identity / addressing / serialization / state / lifecycle

agent()
  logical AI model / tools / attempts / conversation/run semantics

capabilities
  workspace / search / source / shell / evidence / artifacts
```

## `codeAgent()`

Conceptually:

```ts
const CodingHarness = AgentHarness.named("coding");
const Workspace = CodeWorkspace.named("primary");
const Source = SourceRepository.named("primary");

export const Coding = application.include(
  codeAgent("coder", {
    actor: {
      key: RepositoryId,
    },
    identity: CoderIdentity,
    model: CodingModel,
    harness: CodingHarness,
    workspace: Workspace,
    source: Source,
    authority: {
      write: "workspace",
      shell: ["bun", "git diff", "git status"],
      network: "declared",
      gitPush: approval.required(),
    },
  }),
);
```

OpenCode is one replaceable `AgentHarness` provider.

The durable entity is the actor-backed coding agent, not OpenCode.

In a distributed application deployment, Celld may provide the actor runtime that owns the coding-agent
identity, mailbox, serialized state, fencing, and recovery. OpenCode remains a separately authorized
`AgentHarness` execution boundary called by that actor through a stable, idempotent run contract. It is not
embedded with implicit privilege inside the general Celld worker, and a retried actor turn reattaches to
the prior harness run rather than creating a second run. Workspace leases are durable references whose
placement, retention, replacement, and teardown remain explicit in the graph and plan.

The independent Builder daemon does not require Celld. It may run OpenCode as a loopback child while the
generated application or its actor runtime is absent or broken; Builder-owned conversations, attachments,
journal, authority, evidence, and undo never become OpenCode or Celld state.

## `researchAgent()`

Conceptually:

```ts
const Web = WebSearch.named("research");

export const Research = application.include(
  researchAgent("researcher.v1", {
    contract: {
      input: ResearchRequest,
      output: ResearchReport,
    },
    actor: {
      key: ResearchThreadId,
    },
    identity: ResearcherIdentity,
    model: ResearchModel,
    search: Web,
    retrieve: SourceRetriever.named("research"),
    evidence: ResearchEvidence.named("research"),
    publish: Artifact.create,
    tools: [Source.observe],
  }),
);

const terminal = await Research({
  threadId,
  question: "Which claims have the strongest primary-source evidence?",
});
```

A Kubernetes `WebSearch` provider may lower to TypeKro's SearXNG composition.

The application never names SearXNG directly.

The maintained v0.9 research vertical is complete only when one typed request executes through the
actor-backed research agent, performs bounded searches, safely retrieves selected sources through a
separately authorized `SourceRetriever`, records
normalized evidence and citations, produces an authorized artifact, and exposes causal events and
telemetry. The same run must recover after process/provider interruption without duplicating logical
queries or losing evidence already committed.

The SearXNG provider is qualified both as managed Kubernetes infrastructure and as an externally bound
endpoint. Managed Kubernetes resources are composed with TypeKro and deployed through TypeKro's Alchemy
integration. The provider owns readiness, bounded query concurrency, timeout/cancellation, credential and
Secret handling, egress policy, normalized result mapping, upgrade compatibility, replacement, and
ordered teardown. Search results and retrieved pages remain untrusted data; provider output never becomes
instructions or grants follow-up network authority.

## Builder development environment

The optional Builder refines the accepted v0.8 Independent Development Environment contract; it does not
replace it with a chat page hosted by the generated application. Its independent daemon/portal remains
usable through source, compile, startup, and route failure. The v0.8 visual-selection provenance,
persistent attachment/referent, mutation journal, undo, recovery, and security contracts remain normative.

Builder turns `codeAgent()` into a repo-aware visual development journey for Agentic Start and other
Applik8s applications:

```text
element/text/region selection
  -> source/graph/trace/plan resolution
  -> named context referent
  -> conversation -> plan -> changes -> preview -> evidence -> apply/undo/discard
```

Builder understands source dependencies, the semantic application graph, `ApplicationPlan`, generated
contracts, and impacted `journey()` declarations. Resolution remains exact/candidate/stale/unresolved/
external rather than guessed. It may use OpenCode through `AgentHarness`, but its thread, workspace,
attachments, referents, journal, authority, diff, preview, undo, and evidence contracts remain
provider-neutral.

Builder is development-only by default. Repository editing, process execution, network, Secrets,
deployment, apply, commit, push, and pull-request actions remain separately authorized. Agentic Start owns
only thin configuration and its product journeys; reusable Builder machinery belongs in maintained
packages and production builds exclude it unless explicitly productized.

The v0.9 preview is closed to one complete change journey: converse, inspect the source/graph/plan,
authorize one isolated-workspace mutation, review source and semantic diffs, run impacted checks/journeys,
preview, then apply/discard and conflict-safe undo. Conversation, Plan, Changes, Preview, and Evidence are
the complete primary views. A terminal emulator, file editor, issue tracker, multi-agent board,
production-deployment console, and autonomous Git publishing are outside the preview.

## Swarms

A swarm is application logic, not a new runtime:

```text
                    Coordinator actor
                          |
          +---------------+---------------+
          |               |               |
          v               v               v
     codeAgent A      codeAgent B    researchAgent
          |               |               |
      workspace A      workspace B       WebSearch
          |               |               |
          +------- evaluator/integrator --+
```

The coordinator may use `actor()` or `workflow()` according to actual semantics.

---

# Product experience

## Homepage

The homepage must answer:

1. What is Applik8s?
2. What applications is it for?
3. What does the code feel like?
4. What does Applik8s derive from the code?

The opening example should show application semantics, not infrastructure constructors.

Representative story:

```ts
const Document = model(...);

Document.create.beforeCommit(...);

Document.on.create(async document => {
  DocumentCreated.emit({
    documentId: document.id,
  });
});

const PublishDocument = workflow(...);

Publisher.can(
  Document.publish.where(...),
);
```

followed by:

```text
Applik8s understands:
  authoritative state
  transactional behavior
  durable reactions
  business authority
  provider requirements
  runtime access
  application facts
  deployment topology
```

## Ten-minute success path

Canonical first run:

```sh
bun create applik8s my-product --start agentic
cd my-product
bun install
applik8s dev
```

The user reaches a working application within a published cold-start budget.

The first tutorial:

```text
edit application behavior
  -> hot reload / affected convergence
  -> inspect graph
  -> explain semantic nodes
  -> inspect application facts
  -> inspect runtime evidence
```

No Kubernetes, cloud account, coding harness, or external model provider is required.

## First distributed feature

A second tutorial teaches:

```text
model change
 -> operation
 -> authority
 -> event/reaction
 -> optional job/workflow
 -> query/view
 -> application.events
 -> UI
 -> ApplicationPlan diff
```

It explains synchronous, transactional, post-commit, finite, durable, retryable, compensating, and
eventually consistent boundaries.

## Primitive decision guide

The documentation contains a first-class decision guide:

```text
Need authoritative queryable state?
  -> model()

Need to define a typed fact?
  -> event()

Need to react to a fact?
  -> event handler / stream consumer

Need to observe facts across the application?
  -> application.events

Need specialized retention/ordering/partition guarantees?
  -> stream(Event, guarantees)

Need finite background work?
  -> job()

Need finite processing over query results?
  -> Query.onBatch()

Need multi-step durable orchestration over time?
  -> workflow()

Need compensating distributed coordination?
  -> application.transaction.saga()

Need identity-addressed serialized state?
  -> actor()

Need predictive learned computation?
  -> ML.model()

Need generative AI execution with tools?
  -> agent()

Need a persistent evidence-producing research worker?
  -> researchAgent()

Need a persistent coding worker?
  -> codeAgent() preview composition

Need a source-owned acceptance promise?
  -> journey()
```

## Explain the application

`applik8s explain` must answer questions such as:

```text
What models and operations exist?
What application facts can this feature emit?
What event sources feed this consumer?
What ordering/replay guarantee does this event selection have?
What job/workflow/saga can run?
What consistency guarantee does this query batch require?
Which actor owns this stateful identity?
Which provider serves this ML model?
What runtime access was inferred?
Where will each selected provider and execution be placed?
```

## Plan before deploy

Production guides use:

```sh
applik8s plan --profile production-aws
```

or:

```sh
applik8s plan --profile production-kubernetes
```

before deploy.

The plan explains:

- semantic demand;
- provider resolution;
- runtime access;
- event topology;
- vector/materialized frontiers where relevant;
- physical topology;
- maturity;
- unknowns;
- destructive changes;
- retained state;
- cost/capacity evidence;
- external responsibilities.

## Debugging

Maintained troubleshooting deliberately covers:

- compile failure;
- application authorization failure;
- runtime-access denial;
- provider incompatibility;
- job execution failure;
- query batch consistency/frontier failure;
- event federation/materialization failure;
- event subscription disclosure failure;
- workflow failure;
- saga compensation failure;
- actor state/migration failure;
- ML inference failure;
- local runtime failure;
- profile/provider deployment drift.

The independent development portal may assist, but canonical troubleshooting knowledge remains usable
without a coding model.

---

# Documentation website

The v0.9 documentation website is a release artifact and part of acceptance.

It is developed continuously alongside semantic work, not after the implementation is “finished.”

## Required top-level navigation

```text
Home
Start Here
Build Applications
Events & Reactive Systems
Distributed Behavior
Data & Analytics
AI & Agents
Security
Infrastructure & Providers
Understand & Operate
Examples & Starts
Reference
Upgrade & Migrate
```

## Start Here

- What Applik8s is
- Installation
- Create an application
- Run locally
- Make the first change
- Understand generated source
- Explain the application
- Observe application events
- Next steps

## Build Applications

- Models and state
- Operations and lifecycle
- Events
- Queries and views
- Modules and composition
- HTTP/UI integration

## Events & Reactive Systems

- `event()`
- `application.events`
- `from(...)`, `of(...)`, `all()`
- `where(...)`
- `onEvent(...)`
- `onBatch(...)`
- projections
- subscriptions
- specialized `stream(...)`
- ordering and replay
- vector frontiers
- retention
- event authority/disclosure
- causation and cycle protection
- OTel versus application facts

## Distributed Behavior

- Finite jobs
- Query batching and windowed processing
- Workflows and signals
- Saga transactions and compensation
- Actors
- Scheduling
- Consistency boundaries
- Idempotency and retries
- Choosing a primitive

## Data & Analytics

- Relational models
- Queries and live views
- Streams
- Projections
- Analytical databases
- Lakehouse datasets and queries
- Query consistency guarantees
- rebuilds/backfills

## AI & Agents

- `AI.model()`
- `ML.model()`
- `agent()`
- tools and authority
- durable attempts
- evaluations
- `researchAgent()` and provider-neutral search/retrieval/evidence contracts
- SearXNG-backed `WebSearch` provider and external `WebSearch` bindings
- `codeAgent()` preview
- Builder development environment preview
- harness/workspace/search/source capabilities
- provider selection and portability

## Security

- Authentication
- Roles and grants
- Operation authority
- Immediate and causal principals
- Event selection versus observation authority
- client/server subscription boundaries
- inferred runtime access
- secrets
- approval-gated capabilities

## Infrastructure & Providers

- Capabilities and dependency injection
- Qualifications
- Profiles
- Profiles and concrete provider configuration
- Local
- AWS
- Kubernetes
- External providers
- provider guarantees and maturity
- event provider topology
- TypeKro and Alchemy extension seams

## Understand & Operate

- `explain`
- `plan`
- application graph
- `ApplicationPlan`
- application events
- runtime evidence
- OpenTelemetry
- operations UI
- jobs/workflows/sagas/actors
- migrations
- lifecycle/deletion
- cost/capacity
- troubleshooting

## Examples & Starts

- GuestBook
- Chirp
- Agentic Start
- one finite-job example
- one query-batch example
- one application-events example
- one saga example
- one ML inference example
- one release-qualified research-agent example and one code-agent preview example

## Reference

- API reference
- CLI reference
- configuration
- package catalog
- graph schema
- `ApplicationPlan` schema
- event-envelope schema
- diagnostic codes
- provider catalog
- maturity matrix
- compatibility matrix

## Upgrade & Migrate

- release notes
- deprecations
- migration guides
- `app.job()` -> `application.workload.job()` migration
- Start lineage
- provider changes
- pre-1.0 to 1.0 migration
- rollback boundaries

## Website quality

The site must:

- render version-matched docs;
- use stable URLs;
- provide search that prefers canonical current APIs;
- typecheck or execute canonical code examples;
- expose maturity labels visibly;
- be responsive and accessible;
- remain useful without heavyweight client-side visualization;
- avoid leading with implementation substrates;
- link examples to `explain`/plan/event semantics where appropriate.

---

# Public API and terminology freeze

After semantic completion, every public concept is classified:

```text
stable-1.0-candidate
beta
preview
experimental
deprecated
internal
```

The review asks:

- Is this the final noun?
- Is this the final spelling?
- Is this the correct package/namespace?
- Does it represent a distinct semantic boundary?
- Is another public concept overlapping?
- Can ordinary application code avoid provider names?
- Does autocomplete guide users toward the canonical path?
- Can misuse be explained without compiler-internal vocabulary?
- Does generated source teach the same convention as docs?

Particular scrutiny applies to:

- `job()` versus `application.workload.job()`;
- `model()` versus `AI.model()` versus `ML.model()`;
- `application.events` versus `stream(...)`;
- `Query.onBatch()` versus `Stream.onBatch()`;
- `workflow()` versus `application.transaction.saga()`;
- local database transaction vocabulary versus distributed Saga;
- `agent()` versus `actor()`;
- specialized agents as compositions;
- capability/provider/qualification/profile/configuration/physical-plan terminology;
- package boundaries.

A rename in v0.9 is cheaper than a permanent 1.x synonym.

Machine schemas are classified at field or subtree granularity:

```text
stable        semver-governed name, shape, and meaning
additive      stable meaning; new optional members may appear
informational human-facing evidence, not supported automation
experimental no compatibility promise yet
opaque        retain/compare/round-trip only; internals are not public
```

Serializing a field in the application graph, `ApplicationPlan`, diagnostic details, or provider evidence
does not automatically make it stable. Builder, CI, and other supported tooling depend only on explicitly
classified stable/additive machine views.

---

# Diagnostics and troubleshooting contract

Every stable diagnostic has:

- stable code;
- human summary;
- semantic category;
- source provenance;
- affected graph/plan identity;
- profile/provider/implementation context;
- maturity context;
- concrete remediation;
- documentation link;
- redacted details;
- machine-readable form.

Required new diagnostic families include:

```text
JOB_PROVIDER_UNSUPPORTED
JOB_CANCEL_UNSUPPORTED
QUERY_BATCH_ORDER_UNSTABLE
QUERY_BATCH_CONSISTENCY_UNSUPPORTED
QUERY_BATCH_FRONTIER_EXPIRED
EVENT_SOURCE_AUTHORITY_INCOMPATIBLE
EVENT_REPLAY_GUARANTEE_INCOMPATIBLE
EVENT_MATERIALIZATION_REQUIRED
EVENT_GLOBAL_ORDER_UNAVAILABLE
EVENT_CYCLE_UNBOUNDED
SAGA_EFFECT_OUTSIDE_BOUNDARY
SAGA_COMPENSATION_FAILED
SAGA_OUTCOME_UNKNOWN
ML_PROVIDER_INCOMPATIBLE
ML_MODEL_VERSION_UNAVAILABLE
CODE_AGENT_WORKSPACE_UNAVAILABLE
RESEARCH_SEARCH_PROVIDER_UNAVAILABLE
```

---

# Example responsibilities

## GuestBook

GuestBook remains the readability floor.

It teaches:

```text
application
model
behavior
event
authority
provider requirement
local/public exposure
```

It does not absorb every advanced v0.9 feature.

## Chirp

Chirp remains the distributed-systems pressure test.

It should naturally exercise:

- streams;
- projections;
- application event catalog;
- query batching where appropriate;
- one finite job;
- durable workflow;
- authority;
- provider selection;
- plan/runtime evidence;
- the complete `production-aws` and `production-kubernetes` golden-profile capability set and live
  lifecycle evidence;
- actor or Saga only when genuinely appropriate.

## Agentic Start

Agentic Start remains the production-shaped application convention.

It may exercise:

- one maintenance/backfill `job()`;
- one query-batch rebuild;
- `application.events` for product-significant facts;
- one Saga beta flow if naturally useful;
- one ML beta inference example only if it serves a real product journey;
- one complete `researchAgent()` journey using the maintained `WebSearch` and `ResearchEvidence`
  contracts;
- the existing Builder;
- an optional code-agent preview module.

The Start must not become a feature catalogue.

---

# Compatibility and upgrade contract

Before `1.0.0-rc.1`, v0.9 publishes a concrete compatibility policy.

## Authoring compatibility

Which TypeScript APIs and semantics are 1.0 candidates.

## Artifact compatibility

Versioning/migration rules for:

- canonical application graph;
- `ApplicationPlan`;
- operation identities;
- event contracts and catalog source identities;
- event consumer/vector/materialized frontiers;
- job/workflow/Saga/actor identities;
- runtime-access manifests;
- provider guarantee manifests;
- generated runtime contracts;
- Start lineage.

## Runtime compatibility

Which compiler/runtime/provider combinations may execute together and how incompatibility fails.

## Generated-source compatibility

Generated applications own their source.

Upgrades distinguish:

- maintained package upgrade;
- safe generated-file regeneration;
- application-owned source requiring review;
- template convention changes;
- migrations that cannot be automated safely.

## Provider compatibility

A stable semantic contract does not make every provider stable.

## Deprecation

1.x deprecations require:

- replacement;
- diagnostic;
- migration guidance;
- documented support window;
- no silent semantic reinterpretation.

---

# Continuous clean-context review

Clean-context review is not an RC-only activity.

At minimum it occurs at:

```text
alpha.1
alpha.3
alpha.7
RC
```

and should run continuously where practical.

A competent TypeScript developer who did not implement the relevant feature attempts canonical journeys
and records:

- terminology confusion;
- implicit prerequisites;
- surprising generated source;
- diagnostics requiring maintainer translation;
- docs relying on unpublished repository state;
- provider claims exceeding maturity;
- overlapping concepts;
- unclear next actions;
- confusion between `job`, `workflow`, and Saga;
- confusion between `application.events` and specialized streams;
- confusion about event authority and replay/order;
- confusion between `model`, `AI.model`, and `ML.model`;
- confusion about why OpenCode/SearXNG are providers rather than application primitives.

A maintainer may not resolve the review by verbal explanation alone.

The fix must land in API, diagnostics, docs, or examples.

---

# Program execution model

v0.9 does not run as one long serial pipeline. It begins with one mandatory compatibility foundation, then
four tracks run concurrently. No semantic or provider increment may write deployment state until the
foundation can identify the exact released v0.8 input and explain its migration.

```text
┌──────────────────────────────────────────────┐
│ Mandatory compatibility foundation           │
│                                              │
│ exact v0.8 baseline → provider identity      │
│ → resolver/plan → effect safety → migration  │
└──────────────────────────────────────────────┘
                       ↓
┌──────────────────────────────────────────────┐
│ Semantic completion                          │
│                                              │
│ job → query batching → application.events    │
│ managed models + scheduling convergence      │
│ saga beta → ML beta                          │
└──────────────────────────────────────────────┘
                       ↕
┌──────────────────────────────────────────────┐
│ Product legibility                           │
│                                              │
│ homepage → quickstart → decision guide       │
│ tutorials → reference → upgrade docs         │
└──────────────────────────────────────────────┘
                       ↕
┌──────────────────────────────────────────────┐
│ Clean-context qualification                  │
│                                              │
│ fresh install → confusion → diagnostics      │
│ docs/API refinement → repeat                 │
└──────────────────────────────────────────────┘
                       ↕
┌──────────────────────────────────────────────┐
│ Provider and deployment qualification        │
│                                              │
│ local → Kubernetes → AWS → external          │
│ plan → apply → update → recover → delete     │
└──────────────────────────────────────────────┘
```

A semantic API is not “done” merely because tests pass if the docs cannot explain it coherently.

Documentation is not “done” if it papers over an awkward API that can still be simplified pre-1.0.

---

# Proposed implementation/release train

```text
0.9.0-alpha.1
  exact released-v0.8 package/artifact/plan/catalog/runtime/evidence baseline
  machine-readable public-contract/package/diagnostic inventory
  deterministic implementation identity and profile resolver/plan schema
  read-only v0.8 logical-to-physical mapping and migration proposal
  effect guarantee/receipt/unknown-outcome schemas and crash harness
  minimal journey() runner used by every following semantic increment
  website skeleton + first primitive guide
  first clean-context review

0.9.0-alpha.2
  resumable active-state migration with interruption, rollback, forward recovery, and GitOps procedures
  profiles and external/Kubernetes-cluster dependency injection
  Kubernetes TypeKro-through-Alchemy and non-Kubernetes native-Alchemy physical-plan foundation
  lifecycle-authority transfer and provider-replacement evidence

0.9.0-alpha.3
  application.job() contract + application.workload.job() vocabulary migration
  single-step Workflow migration classification
  scheduling occurrence, retry, timezone, overlap, and daylight-saving normalization
  finite Job local and deployed-provider qualification with explicit JobRuntime dependencies
  second clean-context review

0.9.0-alpha.4
  function-native Query portable-selection extension
  Query.onBatch() consistency/frontier implementation and PostgreSQL snapshot qualification
  managed-model/reconcile provider-neutral facet
  durable Kubernetes and PostgreSQL reconcile qualification under the shared effect contract
  external PostgreSQL/ClickHouse and current/external Kubernetes-cluster conformance

0.9.0-alpha.5
  application.events catalog
  typed from/of/all narrowing
  authority/disclosure/replay/federation planning
  event docs/tutorials

0.9.0-alpha.6
  application.events batching/projection/subscription qualification
  normative Chirp production-kubernetes profile qualification
  normative Chirp production-aws profile qualification
  unchanged-source cross-profile plan/readiness/update/reconcile/delete evidence

0.9.0-alpha.7
  Saga beta with explicit step/commit/irreversible/effect-classification semantics
  ML.model() beta
  complete journey() development/testing product surface
  decision() investigation result
  production-qualified researchAgent(), WebSearch, SourceRetriever, ResearchEvidence, and SearXNG provider
  managed-Kubernetes and external-SearXNG lifecycle/conformance evidence
  end-to-end search → retrieval → evidence → artifact acceptance journey
  specialized code-agent preview modules/providers
  Builder v0.8-contract reconciliation and initial visual development integration
    (preview, non-blocking, may slip without holding the core train)
  third clean-context review across the complete candidate semantic surface

0.9.0-alpha.8
  foundational feature freeze
  public-contract inventory freeze
  terminology/package simplification
  deprecations and migration paths

0.9.0-alpha.9
  diagnostics/troubleshooting
  compatibility and upgrades
  website/reference completion

0.9.0-alpha.10
  packed-package qualification
  example/Start normalization
  accessibility/search/performance/security pass

0.9.0-rc.1
  clean-context RC review
  docs/site qualification
  machine-readable 1.0 contract inventory

0.9.0
  maintainer-authorized semantic-completion and product-legibility release

1.0.0-rc.1
  first stable-contract candidate
  no new foundational scope
```

The release train is semantic/dependency guidance, not permission to defer product legibility until late
alphas.

---

# Cross-cutting release gates

## Semantic completeness

- `job()` is distinct from low-level `application.workload.job()`.
- `Query.onBatch()` is distinct from `Stream.onBatch()`.
- `application.events` is a logical catalog whose selections become stream-shaped views.
- `Resource.on.reconcile` has one managed-model contract across qualified storage/operator providers.
- schedule definition/instance/occurrence semantics are shared without erasing Job, workflow, actor,
  processor, or managed-resource ownership.
- external provider bindings omit deployment ownership while preserving readiness, Secret, migration, and
  plan contracts.
- Kubernetes clusters are typed injected capabilities rather than ambient clients.
- no event API implies universal total order or unrestricted observation.
- Saga names compensating semantics explicitly.
- effectful Saga calls outside explicit boundaries fail closed.
- `ML.model()` does not collide with application `model()` or `AI.model()`.
- specialized agents remain compositions.
- provider implementations remain below semantics.

## Jobs

- direct call/start/result/cancel behavior is receipt-backed;
- direct-call timeout returns the durable run reference and does not cancel the Job;
- progress is typed and observable;
- cancellation semantics are explicit;
- success/failure/cancel/deadline races have one immutable terminal winner;
- started/progressed/succeeded/failed/cancelled/timedOut application facts are complete;
- retries/idempotency are explicit;
- provider limits are visible in `ApplicationPlan`;
- low-level workload jobs use the explicit workload namespace.

## Query batching

- stable ordering/frontiers are required;
- requested consistency guarantee is explicit;
- provider cannot silently weaken consistency;
- restart does not duplicate a completed logical window;
- concurrent windows use durable receipts and one contiguous committed frontier;
- out-of-order success is retained without advancing across a gap or rerunning after restart;
- unbounded/unstable sources fail closed;
- provider limitations are plan-visible.

## Application events

- `from(...)`, `of(...)`, and `all()` preserve type narrowing;
- broad `.all()` is explicit;
- event selection grants no authority;
- browser/server disclosure remains distinct;
- source-local positions and causation are retained;
- federation never invents total order;
- vector/materialized frontiers are explainable;
- `.onEvent()`, `.onBatch()`, `.project()`, and `.subscribe()` reuse normal Stream semantics where
  guarantees can be satisfied;
- incompatible guarantees fail compilation;
- application facts remain distinct from OTel;
- event cycles are bounded and inspectable;
- specialized `stream(...)` semantics remain explicit.

## Managed models and reconciliation

- one declaration and `Resource.on.reconcile` closure run on Kubernetes and PostgreSQL-backed providers;
- spec/status ownership, generations, fenced leases, resync, deletion, and finalization remain equivalent;
- delayed wakeups survive restart and never become desired-state authority;
- explicit Kubernetes effects constrain only their consumer;
- external database/cluster bindings create and delete no infrastructure;
- provider replacement produces migration evidence.

## Scheduling

- Job/workflow schedules share occurrence identity, timezone, overlap, misfire, cancellation, and history;
- actor alarms, processor convergence, and `requeueAfter()` retain distinct semantic owners;
- duplicate delivery admits one target occurrence;
- dynamic reconciliation and provider replacement cannot double-own schedules;
- provider limitations fail before mutation and appear in `ApplicationPlan`.

## Saga beta

- forward/compensation pairs are graph-visible;
- effectful calls outside explicit Saga boundaries fail closed;
- compensation order is deterministic;
- compensation retry is durable/idempotency-aware;
- crash recovery retains committed frontier;
- commit preparation, observation, and unknown-outcome recovery are explicit;
- an unknown commit cannot trigger compensation until absence is proven;
- unknown external outcomes remain unknown;
- `ApplicationPlan` states compensating atomicity and lack of isolation;
- Saga failure does not block 1.0 if correctly labeled beta and isolated from stable core.

## ML beta

- typed input/output enforced;
- logical identity provider-neutral;
- physical model/version provenance recorded;
- batch/online distinctions explicit;
- training remains compositional;
- incomplete ML provider conformance does not block 1.0.

## Research-agent release qualification and specialized-agent preview

- one typed research request reaches a terminal artifact through actor-backed execution, bounded search,
  safe source retrieval, evidence persistence, and citation linkage;
- restart after query admission, result retrieval, evidence commit, and artifact commit resumes without
  duplicate logical work or lost committed evidence;
- authorization separately governs search invocation, source retrieval, evidence visibility, artifact
  publication, and browser subscription;
- SearXNG managed Kubernetes deployment passes create, readiness, query, update, interruption recovery,
  provider replacement, and ordered deletion through TypeKro's Alchemy integration;
- external SearXNG binding owns no infrastructure and passes the same semantic WebSearch conformance;
- malformed, poisoned, oversized, disallowed, or unreachable sources fail safely with inspectable partial
  evidence rather than becoming agent instructions;
- code agent retains actor-owned identity across harness restart/replacement;
- OpenCode is replaceable;
- workspace/source/shell/network/approval capabilities remain separately authorized;
- research agent can replace SearXNG with another conforming provider without application-source changes;
- Builder exposes conversation, plan, changes, preview, and evidence without hiding mutation or authority;
- Builder preserves the v0.8 independent daemon, visual provenance, attachments/referents, journal, undo,
  application-failure recovery, and security contracts;
- Agentic Start includes only thin development configuration while reusable Builder machinery remains packaged;
- production builds exclude Builder unless an application explicitly productizes it;
- code-agent, Builder, and other specialized-agent surfaces remain outside stable core.

## Documentation truthfulness

- canonical samples typecheck;
- complete tutorials execute in clean workspaces;
- provider maturity is visible;
- search prefers canonical APIs;
- website copy never silently upgrades maturity.

## Public vocabulary

- every 1.0-candidate noun/spelling reviewed;
- deprecated aliases emit diagnostics;
- package names match documented ownership;
- generated apps teach canonical vocabulary.

## Explainability/debugging

- `explain`/`plan` used in tutorials;
- application events appear in explain/plan where relevant;
- stable errors identify semantic context and next action;
- one intentionally broken application can be repaired from published guidance without maintainer help.

## Compatibility/upgrades

- stable candidate surface machine-inventoried;
- graph/plan/event/frontier/runtime-access/provider/generated-source contracts versioned;
- representative v0.8 upgrade produces explicit migration/policy diffs;
- `app.job()` vocabulary migration documented;
- destructive migration never hidden behind package installation.

## Documentation website

- responsive/accessibility pass;
- stable URLs;
- versioned docs;
- accurate search;
- mobile-readable code;
- visible maturity labels;
- navigation works without heavyweight visualization;
- performance/third-party script budgets recorded.

---

# Migration requirements

v0.9 preserves v0.8 applications unless an explicit pre-1.0 simplification is approved and migrated.

- existing low-level `app.job(...)` receives migration to `application.workload.job(...)`;
- existing stable authoring APIs remain valid or emit explicit deprecation guidance;
- existing local/AWS/Kubernetes/external classifications remain readable as provider/resource evidence;
- existing profiles retain meaning and become the sole assembly-policy selector;
- persisted v0.8 target/installation state enters the versioned deployment-state migration protocol;
  read-only discovery maps logical provider identity, canonical physical identity, lifecycle authority,
  and configuration digest before mutation;
- ambiguous mappings, competing owners, identity collisions, and unsupported provider transitions fail
  with actionable guidance before state or infrastructure changes;
- interrupted migrations resume from durable receipts, and every migration declares whether rollback or
  forward recovery remains safe at each state;
- `model()` remains authoritative application-data terminology;
- `AI.model()` retains generative logical-model meaning;
- `ML.model()` is additive/beta;
- `workflow()` remains durable orchestration;
- Saga is additive under `application.transaction.saga(...)`;
- existing stream batching keeps event acknowledgement semantics;
- query batching is additive finite-query semantics;
- application-event catalog derives from existing semantic facts without silently changing their source
  authority/retention/order;
- existing Builder remains separate from application-level specialized agents;
- provider maturity cannot regress silently;
- graph/plan/event-envelope/frontier schema changes are versioned.

Pre-1.0 permits deliberate API refinement.

It does not permit silent data loss, ambiguous ownership, undocumented compatibility breaks, or stale
migration guidance.

---

# Non-goals

- one mandatory physical application event bus;
- universal total ordering across application facts;
- unrestricted `.all()` subscriptions;
- automatic durable publication of every operational lifecycle transition;
- automatic cross-provider replay equivalence;
- provider-specific routing rules in domain source;
- a new event-processing API separate from existing Stream semantics;
- general distributed ACID;
- building XA/2PC in v0.9;
- turning Saga into a synonym for local database transaction;
- turning `job()` into another workflow syntax;
- generic arbitrary-state job checkpoint/replay before semantics are defined;
- general event-time streaming windows/watermarks/lateness/joins;
- generic ETL/dataflow DSL;
- ML training platform;
- feature store;
- mandatory ML maturity before 1.0;
- `computer()` as a foundational primitive;
- OpenCode as durable identity;
- SearXNG as research-agent semantics;
- code-agent, Builder, or other specialized-agent previews blocking 1.0;
- broad parity with another cloud provider;
- replacing TypeKro or Alchemy;
- proprietary APM;
- preserving every pre-1.0 alias forever;
- marketing Applik8s as generic TypeScript IaC.

---

# Principal risks

## Semantic completion becomes feature creep

Mitigation: closed candidate list, priority classes, manifesto amendment required for new foundational
scope.

## `job()` overlaps `workflow()`

Mitigation: job owns finite managed execution; workflow owns durable orchestration through time.

## Existing `app.job()` creates permanent ambiguity

Mitigation: move low-level container workload under `application.workload.*` before 1.0.

## Query consistency becomes hand-wavy portability

Mitigation: applications request named guarantees; providers fail when they cannot satisfy them.

## Event catalog becomes dangerously magical

Mitigation: catalog is logical federation, not physical-log assertion. Derived streams carry explicit
provider guarantees and may fail compilation.

## Event catalog erases type safety

Mitigation: handle-based `from(...)`/`of(...)` narrowing before payload predicates; `.all()` explicit.

## Event catalog leaks authority

Mitigation: selection grants nothing; consumer observation authority derives independently and fails
closed when unsafe.

## Event catalog invents global order

Mitigation: source-local positions, causal metadata, vector frontiers, and explicit arrival-order language
for materialized streams.

## Event storms

Mitigation: compile-time cycle detection where provable; causal depth/loop budgets/dead-letter evidence at
runtime.

## Saga name implies ACID

Mitigation: public spelling names `.saga`, plan states compensating atomicity/no isolation, no bare
distributed `transaction()`.

## Saga effects escape recovery semantics

Mitigation: effectful calls outside `step`/`commit`/`irreversible` fail closed.

## ML vocabulary adds cognitive weight

Mitigation: namespaced beta surface; non-blocking for 1.0.

## Specialized agents become parallel platforms

Mitigation: compositions of actor + agent + capabilities; providers own only harness/workspace/search
implementation.

## Documentation discovers problems too late

Mitigation: docs/site and clean-context review run concurrently from alpha.1.

## Documentation explains bad APIs instead of fixing them

Mitigation: repeated confusion triggers simplification/rename/deletion while pre-1.0 changes are cheap.

---

# Closed v0.9 decisions

- v0.9 begins with the exact-v0.8 identity/migration/effect-safety foundation, then executes the closed
  semantic-completion program before freezing foundational scope.
- The only new stable-candidate application-level semantic nouns are `job()`, `Query.onBatch(...)`, and
  `application.events`. Managed-model portability, scheduling convergence, external/Kubernetes DI,
  profile/provider simplification, deterministic implementation identity, deployment-state migration,
  effect safety, compatibility, and product legibility are also release-blocking contract work.
- `researchAgent()` is a release-qualified composition over existing actor, agent, search, evidence, and
  artifact contracts; it is not a new foundational semantic noun.
- SearXNG is the maintained v0.9 `WebSearch` provider and never becomes application semantics.
- existing low-level `app.job(...)` must migrate beneath `application.workload.*`.
- `application.events` is a logical typed application event catalog.
- `application.events.from(...)`, `.of(...)`, and `.all()` derive Stream-shaped selections.
- derived event selections reuse normal `where`, `onEvent`, `onBatch`, `project`, and `subscribe` semantics
  when provider guarantees allow.
- `application.events` does not imply one physical bus, total order, cursor, retention policy, or authority.
- broad all-event access is explicit through `.all()`.
- event selection never grants observation authority.
- source-local positions and causal identities remain canonical; composite replay may use vector frontiers.
- specialized `stream(Event, guarantees)` remains the explicit way to request strong durable stream
  semantics.
- application-significant facts remain distinct from OTel operational telemetry.
- event cycles are bounded and inspectable.
- `<ManagedModel>.on.reconcile` is the only public continuous-reconciliation spelling; the existing
  `Resource.on.reconcile` is its Kubernetes-backed form, not a separate reconcile API.
- PostgreSQL/local reconciliation and EventBridge-delivered wakeups may implement the same semantic
  contract without making EventBridge desired-state authority.
- Kubernetes clusters are typed DI capabilities; ambient kubeconfig and unrestricted raw clients are not
  application dependencies.
- provider implementations separate runtime adapters from optional deployment contributors.
- Alchemy is the single deployment state, dependency, and lifecycle engine for managed infrastructure.
- Kubernetes API resources are authored with TypeKro and deployed through TypeKro's Alchemy integration;
  non-Kubernetes managed infrastructure uses native or focused Alchemy resources.
- external bindings contribute no infrastructure, and maintained providers do not emit CloudFormation or
  use a parallel Kubernetes deployment engine.
- external PostgreSQL, ClickHouse, cluster, and other capability bindings are first-class, own no
  infrastructure, and retain Secret/readiness/migration evidence.
- Job/workflow schedules share one occurrence algebra while actor alarms, processor convergence, and
  `requeueAfter()` retain separate semantic owners.
- provider replacement is a migration unless compatibility evidence proves otherwise.
- `Query.onBatch(...)` uses explicit named consistency guarantees and returns a Job handle.
- bare distributed `transaction()` is not introduced.
- the initial distributed coordination surface is `application.transaction.saga(...)`.
- Saga effects outside explicit `step`/`commit`/`irreversible` boundaries fail closed.
- Saga and `ML.model()` are beta/non-blocking for 1.0.
- `decision()` is investigated but not assumed to be a core primitive.
- The completed investigation rejects a first-class `decision()` graph primitive; ordinary typed functions use the library-only `domainDecision` result algebra and inherit authority, durability, invalidation, and evidence from their enclosing semantic surface.
- `journey()` is a development/testing acceptance artifact.
- `researchAgent()` is a release-qualified composition rather than a foundational runtime;
  `codeAgent()` remains preview.
- OpenCode is a replaceable `AgentHarness` provider.
- SearXNG is a replaceable `WebSearch` provider, composed with TypeKro and deployed through TypeKro's
  Alchemy integration when Kubernetes-hosted.
- documentation website is a release artifact and 1.0 gate.
- docs/site and clean-context review run continuously with semantic implementation.
- the application programming model remains the primary product category.
- one canonical golden path is taught before escape hatches.
- `applik8s explain` and `applik8s plan` are learning/debugging surfaces.
- GuestBook, Chirp, and Agentic Start retain distinct responsibilities.
- every public concept receives an explicit 1.0 disposition.
- `1.0.0-rc.1` freezes the candidate programming model and public contracts.
- external clean-context use is required evidence for the RC.

---

# Definition of done

Applik8s v0.9.0 is ready only when:

1. the semantic-completeness review is closed and no unreviewed foundational concept remains in scope;
2. the old low-level `app.job(...)` vocabulary is migrated or explicitly deprecated in favor of an
   unambiguous workload namespace;
3. application `job()` provides one coherent finite managed-execution contract across local and at least
   one maintained deployed profile;
4. `Query.onBatch(...)` processes bounded query sources with explicit provider-backed consistency/frontier
   guarantees and returns a Job handle;
5. `application.events` exposes a typed logical event catalog with handle-based narrowing through
   `from(...)`, `of(...)`, and explicit broad `.all()`;
6. narrowed event selections support ordinary Stream-shaped processing, including `onEvent`, `onBatch`,
   projection, and subscription when requested guarantees can be satisfied;
7. event federation preserves source-local ordering, causal identities, authority boundaries, and
   replay/frontier truth without inventing one global sequence;
8. incompatible event authority/replay/ordering requirements fail closed with source-attributed
   diagnostics;
9. event selection never grants observation authority and browser/server subscription boundaries are
   tested explicitly;
10. application facts remain distinct from OTel operational telemetry and lazy materialization avoids
    unnecessary duplicate publication;
11. obvious event cycles fail where provable and dynamic cycles remain bounded and inspectable;
12. `application.transaction.saga(...)` demonstrates one realistic compensating workflow with explicit
    `step`/`commit`/`irreversible` semantics or remains correctly beta without blocking 1.0;
13. Saga effectful calls outside explicit recovery boundaries fail closed;
14. `ML.model()` demonstrates typed provider-neutral inference or remains explicitly beta/non-blocking;
15. `journey()` provides a source-owned acceptance artifact that Builder/testing can discover and can
    assert application events without knowing physical providers;
16. `researchAgent()`, its search/retrieval/evidence contracts, and the maintained SearXNG `WebSearch`
    provider pass the complete research lifecycle,
    authority, evidence, recovery, replacement, and teardown gates, while code-agent and other
    specialized-agent previews preserve actor/agent/capability ownership without becoming 1.0 blockers;
17. Builder can prompt, plan, review, preview, verify, and apply an isolated application change through
    replaceable agent/workspace/source capabilities, or remains correctly preview without blocking 1.0;
18. the website explains the product, intended users, programming model, application-event model, and
    application-to-infrastructure thesis without requiring TypeKro, Alchemy, Kubernetes, or repository
    history;
19. the documentation site provides canonical quickstart, primitive decision guide, event/reactive
    semantics, distributed behavior, data/analytics, AI/agents, security, profiles/providers, operations,
    reference, and upgrade journeys;
20. a clean TypeScript developer can generate Agentic Start, run it locally, and reach useful UI through
    published instructions and packed packages;
21. the developer can make a meaningful source-owned change and understand the resulting semantic behavior
    and application facts;
22. `applik8s explain` and `applik8s plan` provide source-attributed explanations matching docs and portal;
23. one intentionally broken application can be diagnosed and repaired from maintained diagnostics and
    troubleshooting guidance without maintainer interpretation;
24. local, AWS, and Kubernetes documentation preserves profile/provider maturity under one application
    mental model;
25. GuestBook, Chirp, and Agentic Start teach one vocabulary while retaining distinct acceptance roles;
26. every public package, export, CLI command, graph/artifact schema, event/frontier schema, generated
    convention, provider surface, and semantic primitive has a 1.0 maturity disposition;
27. the candidate 1.0 vocabulary and package boundaries receive explicit maintainer review;
28. compatibility, deprecation, Start-lineage, artifact-versioning, provider-maturity, event-frontier, and
    upgrade policies are published and exercised on representative upgrades;
29. canonical code samples and complete tutorials pass clean packed-consumer gates;
30. the public website/docs pass responsive, accessibility, link, versioning, search, performance, and
    security review;
31. clean-context developers have completed at least alpha.1, alpha.3, alpha.7, and RC qualification rounds without
    unresolved maintainer-only knowledge;
32. no release-blocking ambiguity is papered over with prose when the public surface can still be
    simplified; and
33. the maintainer explicitly authorizes `1.0.0-rc.1`;
34. managed-model reconciliation proves generation, fenced lease, resync, delayed wakeup, schema-complete
    nested status, per-type conditions, deletion, and handle-owned finalization semantics on Kubernetes and
    one non-Kubernetes provider;
35. the scheduling kernel proves normalized defaults, occurrence identity, timezone, precision,
    daylight-saving behavior, overlap, misfire, delivery retry, cancellation, history, dynamic convergence,
    lifecycle-owned timers, and provider migration without semantic-owner confusion;
36. Kubernetes-cluster and external-service DI prove that runtime use does not imply provisioning,
    deletion, ambient credentials, or eager deployment-tool imports;
37. every maintained provider family represents higher-level prerequisites as typed recursive
    implementation dependencies, with stable identity, explicit sharing, cycle detection, one physical
    lifecycle owner, recursive readiness/migration, and dependency-ordered creation and teardown;
38. nested implementation dependencies remain private unless explicitly provided, and generated callback
    authority proves that provider-internal access never becomes transitive application authority; and
39. Chirp passes the normative `production-aws` and `production-kubernetes` profiles with unchanged
    semantic source, the frozen provider-constructor vocabulary, live readiness, update/reconcile/delete
    evidence, package isolation, and the required TypeKro/Alchemy boundaries;
40. an exact released-v0.8 fixture upgrades through the versioned deployment-state protocol in imperative
    and declarative paths, including interruption, retry, conflict, rollback, forward recovery, and
    deletion with at most one active lifecycle authority, resumable quiescent handoff, no duplicate
    physical owners, and no silent replacement; and
41. every stable effectful execution surface classifies its guarantees through the shared effect contract
    and passes the applicable receipt, observation, proven-absence, administrative-resolution, fencing,
    cancellation, retry, and unknown-outcome crash matrix.

The `1.0.0-rc.1` acceptance question is:

> Can a competent TypeScript engineer who did not build Applik8s create, modify, observe, explain, debug,
> deploy, and upgrade a meaningful distributed application—and choose correctly among its core state,
> execution, query-batch, and event semantics—without needing a maintainer to explain the framework
> personally?

If the answer is yes, the programming model and public contracts are ready to enter the 1.0 release
candidate.
