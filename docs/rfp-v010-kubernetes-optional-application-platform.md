# RFP: Kubernetes-Optional Application Platform and Portable Runtime Providers

**Status:** Superseded as an implementation plan on 2026-08-29; retained as historical portability research

**Audience:** Applik8s maintainers, application authors, provider authors, TypeKro and Alchemy
integrators, runtime implementers, security reviewers, and operators of local, Kubernetes, AWS, and
externally managed targets

**Requested by:** The post-v0.9 portability program

**Target:** No active release target. Its managed-model reconciliation, scheduling, external-binding,
provider-anatomy, lifecycle, plan, and package-isolation contracts moved into the v0.9 RFP suite. Broad
multi-cloud parity, a general runtime/target plugin platform, broad database expansion, and cross-target
migration are not accepted v0.9 or v0.10 scope.

**Assembly authority:** [Profiles and Concrete Provider Bindings](./rfp-v09-profiles-and-concrete-provider-bindings.md)
supersedes this historical draft's independent `--target`, placement, substrate, and installation syntax.
Below, target is only descriptive historical/conformance vocabulary. Profiles and typed provider bindings
remain authoritative, and the plan reports actual physical resources and hosts.

**Depends on:** The released v0.9.x semantic application model, public-contract inventory, provider
qualification model, canonical application graph and `ApplicationPlan`, callable dependency injection,
managed execution, portable authority, inferred runtime access, scheduling, observability, migration,
and clean-context qualification

**Unblocks:** A Kubernetes-optional 1.0 candidate and future third-party deployment targets, execution
hosts, operator substrates, and capability providers

> Historical note: this document records the broader design space that exposed important semantic gaps.
> It is not implementation authority. Current work follows the
> [Managed Models and Portable Reconciliation RFP](./rfp-v09-managed-models-and-portable-reconciliation.md),
> [Scheduling Semantics and Convergence RFP](./rfp-v09-scheduling-semantics-and-convergence.md), and
> [Profiles and Concrete Provider Bindings RFP](./rfp-v09-profiles-and-concrete-provider-bindings.md), and
> [Public Contract and Compatibility Freeze RFP](./rfp-v09-public-contract-and-compatibility-freeze.md).
> Any future v0.10 program requires a new bounded manifesto rather than treating the unextracted sections
> below as accepted scope.

---

## Executive summary

Applik8s began with Kubernetes as its richest deployment and operational substrate. That origin supplied
valuable primitives: declarative resources, reconciliation, scheduling, workload identity, Secrets,
network policy, service discovery, rollout, status, finalization, and infrastructure composition through
TypeKro. The application model has since become broader than any one substrate. It describes models,
events, queries, commands, jobs, workflows, actors, agents, streams, projections, schedules, authority,
runtime access, infrastructure requirements, and continuous operation as one typed program.

v0.10 makes that architecture honest.

Applik8s becomes a **provider-neutral application control-plane framework with first-class local,
Kubernetes, and AWS targets**. Kubernetes remains exceptionally well supported, but it is no longer a
semantic or runtime prerequisite. The same authored application can be deployed:

- locally through supervised processes and local qualified providers;
- to Kubernetes through TypeKro, Alchemy, Kubernetes workload hosts, and CRD-backed operators;
- to AWS through Alchemy-native resources, Lambda, ECS/Fargate, SQS, EventBridge Scheduler, IAM, managed
  data services, and database-backed operators; or
- in the future through externally authored target and runtime providers that pass the same conformance
  contracts.

The promise is equivalence of **application semantics**, not sameness of physical infrastructure. A
workflow remains durable, an actor remains fenced and single-writer, a schedule preserves its declared
cadence, a managed resource remains generation-aware and finalizer-safe, and authority remains bounded
regardless of target. Each target may realize those guarantees differently. When a target or provider
cannot preserve a required guarantee, planning fails before mutation with a source-attributed diagnostic.

The ordinary application remains free of Kubernetes, AWS, TypeKro, Alchemy, Lambda, ECS, CRD, IAM, Helm,
and CloudFormation vocabulary. Provider selection remains typed dependency injection and profile/provider
policy. Provider-specific APIs remain explicit advanced escape hatches whose portability cost is visible in
the application plan.

The v0.10 thesis is:

> Build one serious distributed TypeScript application. Choose where it runs and which qualified
> implementations satisfy its capabilities. Deploy it locally, to managed/serverless AWS, or to
> Kubernetes without rewriting its domain model or distributed semantics. Bring additional runtimes and
> targets later through public, conformance-tested provider contracts.

---

## Relationship to v0.9 and 1.0

The accepted v0.9 manifesto describes v0.9 as the final semantic-completion release before a 1.0 release
candidate. Accepting this RFP materially changes that sequence. v0.10 would become the final architectural
portability release before 1.0, and `1.0.0-rc.1` would be blocked until the Kubernetes-optional contract is
qualified.

This RFP does not reopen v0.9's application vocabulary casually. It relies on the v0.9 freeze to distinguish
semantic application concepts from target implementations. Necessary changes should primarily move
Kubernetes-shaped assumptions below existing public contracts. Any authored API change requires an
explicit compatibility review against the v0.9 public-contract inventory.

The release must not claim that v0.9 or earlier applications were portable merely because they can be
compiled for more than one target. Portability is evidence derived and requirement specific.

---

## Product promise

The primary statement remains:

> **Build distributed applications and their infrastructure as one typed program.**

v0.10 adds:

> **Run that program on the substrate that fits the application. Kubernetes is a target, not a
> prerequisite.**

The shortest path should remain application shaped:

```ts
export const application = app("support-platform");

export const Conversation = application.model(ConversationSchema);

export const SummarizeConversation = application.job(
  SummarizeInput,
  async input => {
    const conversation = await Conversation.get(input.conversationId);
    return summaries.create(await Assistant.summarize(conversation));
  },
);

export const ProvisionWorkspace = Workspace.on.reconcile(
  async (workspace, context) => {
    const deployment = await ApplicationDeployment.ensure({
      workspaceId: workspace.id,
      version: workspace.spec.version,
    });

    await workspace.status.update({
      phase: deployment.ready ? "Ready" : "Provisioning",
      endpoint: deployment.endpoint,
    });

    if (!deployment.ready) {
      return context.requeueAfter("30s");
    }
  },
);
```

Provider selection and placement stay outside domain behavior:

```ts
application.provide(ModelStore, ModelStore.postgres());
application.provide(WorkflowEngine, WorkflowEngine.hatchet());
application.provide(ActorRuntime, ActorRuntime.celld());
application.provide(OperatorRuntime, OperatorRuntime.automatic());
```

The selected deployment profile may bind those logical providers to local, Kubernetes, AWS, externally
managed, or future third-party implementations. `automatic()` means select a qualified implementation
from the selected profile; it never means silently weaken the capability.

```bash
applik8s dev
applik8s plan --profile production-kubernetes
applik8s deploy --profile production-kubernetes
applik8s plan --profile production-aws
applik8s deploy --profile production-aws
```

Changing profiles or provider implementations must not require changing application-domain source.
Explicit provider-specific escape hatches are allowed, but the plan reports the resulting portability
constraint.

---

## Problem statement

Kubernetes assumptions can enter a framework at several layers even when its public APIs appear generic:

- reconciliation may assume CRDs, watches, owner references, or the Kubernetes status subresource;
- execution may assume pods, Deployments, Jobs, CronJobs, Services, or a Kubernetes operator host;
- readiness may be inferred from Kubernetes conditions rather than semantic provider evidence;
- identity may assume ServiceAccounts and RBAC;
- Secrets may assume Kubernetes Secret projection;
- networking may assume Services, namespaces, DNS conventions, and NetworkPolicy;
- lifecycle may assume Kubernetes garbage collection and finalizers;
- deployment may assume rendered manifests or TypeKro graphs as the canonical plan;
- provider implementations may expose Helm values or cluster resources through application APIs;
- local and AWS targets may be treated as partial emulators of Kubernetes rather than first-class targets.

Those leaks create three product failures.

First, applications that are semantically portable remain operationally coupled to a cluster. Second,
AWS deployments either route through Kubernetes-shaped abstractions or receive weaker guarantees. Third,
new runtime authors cannot implement an Applik8s capability without depending on internal compiler or
Kubernetes machinery.

v0.10 removes those dependencies at their source rather than adding a second AWS-specific application
model.

---

## Goals

1. Run maintained acceptance applications without Kubernetes on a qualified AWS target.
2. Preserve one authored application graph across local, Kubernetes, and AWS targets.
3. Preserve semantic guarantees across different physical implementations or reject incompatibility
   before mutation.
4. Make continuous operators portable through a target-neutral reconciliation contract.
5. Make local, Kubernetes, and AWS execution hosts equally explicit implementation choices.
6. Keep TypeKro as the canonical Kubernetes composition layer without loading it in non-Kubernetes paths.
7. Use Alchemy-native AWS resources and state rather than CloudFormation-shaped intermediate authority.
8. Make provider requirements, implementation selection, qualification, runtime access, cost-relevant
   topology, and portability constraints visible in `ApplicationPlan`.
9. Publish a bounded provider SPI for future execution runtimes and deployment targets.
10. Retain target-specific escape hatches without pretending they are portable.
11. Qualify lifecycle, authority, observability, migration, and teardown rather than only successful
    creation.
12. Keep the ordinary TypeScript developer experience application-native and concise.

## Non-goals

- Removing or deprecating Kubernetes, TypeKro, KRO, or Kubernetes-native operators.
- Making AWS and Kubernetes infrastructure manifests look identical.
- Promising identical latency, cost, availability, scaling, or operational behavior across targets.
- Reducing every capability to the lowest common denominator.
- Automatically converting arbitrary Kubernetes YAML or Helm charts into AWS services.
- Hiding provider prerequisites, quotas, regional availability, or semantic limitations.
- Building a generic multi-cloud IaC language.
- Supporting every cloud in v0.10.
- Treating CloudFormation templates as the canonical AWS application plan.
- Allowing arbitrary third-party plugins to run with ambient compiler, filesystem, cloud, or deployment
  authority.
- Migrating a live application between targets without an explicit, separately qualified data and
  lifecycle migration.

---

## Terminology

| Term | Meaning |
| --- | --- |
| Semantic application graph | Target-neutral authority describing application concepts, requirements, relationships, execution, and lifecycle. |
| Target | A physical operational environment such as local, Kubernetes, or AWS. |
| Capability | A typed semantic requirement used by application code, such as `ModelStore`, `WorkflowEngine`, or `OperatorRuntime`. |
| Provider implementation | A qualified implementation of a capability. |
| Execution host | The physical process substrate that runs compiled closures: local process, Kubernetes workload, Lambda, ECS task, or an external host. |
| Deployment adapter | The target-specific planner/materializer that creates, updates, observes, and deletes physical resources. |
| Operator runtime | A continuous reconciliation substrate for `Resource.on.reconcile`. |
| Managed resource | A typed desired-state/status resource reconciled by an operator runtime. It may be CRD-, relational-, or key-value-backed. |
| Portability envelope | The exact targets and provider combinations that preserve a requirement's semantics. |
| Escape hatch | An explicit target-specific dependency or effect that narrows portability. |
| Conformance receipt | Reconstructible evidence that a provider and target preserve a named semantic contract. |

“Serverless AWS” means AWS-managed execution and infrastructure without a user-managed server fleet.
Lambda is preferred for bounded request/event/schedule/reconcile work; ECS/Fargate, Batch, or another
managed execution service is valid where duration, protocol, connection, memory, or stateful-runtime
requirements cannot be preserved by Lambda.

---

## Normative decisions

1. Kubernetes is a target implementation, not a required vocabulary of portable semantic graph nodes.
   Explicit Kubernetes resources may remain as target-constrained escape-hatch nodes with exact
   provenance and portability consequences.
2. The ordinary application surface contains no Kubernetes or AWS deployment vocabulary.
3. `ApplicationPlan` is derived from the semantic graph and selected profile plus per-node placement;
   rendered Kubernetes or AWS resources are substrate-specific projections, not semantic authority.
4. Every execution family declares its required guarantees independently of its implementation.
5. Target lowering preserves those guarantees exactly or fails before mutation.
6. Provider selection remains typed dependency injection; placement derivation does not create another
   application invocation grammar.
7. `Resource.on.reconcile` belongs to the core application model and does not require CRDs or a
   Kubernetes host.
8. Managed resources preserve identity, desired state, status, generation, concurrency, deletion, and
   finalization semantics across operator runtimes.
9. Change notification is an optimization; bounded resynchronization remains mandatory.
10. AWS operators use a durable database authority, immediate stream/outbox delivery, queued
    reconciliation, and EventBridge-backed delayed/recovery scheduling.
11. EventBridge Scheduler is not the source of truth for desired state or reconciliation ownership.
12. Reconciliation invocations are bounded convergence increments; they do not wait indefinitely for
    infrastructure or keep Lambda invocations open across delays.
13. Kubernetes operator status, database-backed operator status, and external operator status share one
    semantic condition contract while retaining provider-specific diagnostics separately.
14. TypeKro is loaded only by Kubernetes deployment paths or explicit TypeKro entrypoints.
15. AWS resources are materialized through Alchemy-native resource providers. Compatibility shims may
    read old CloudFormation-derived state but may not create new semantic authority.
16. Runtime access is inferred from exact logical capability use, then lowered to Kubernetes RBAC and
    NetworkPolicy, AWS IAM and Security Groups/VPC endpoints, or local process policy.
17. Sensitive values remain in target-native secret authorities and are never copied into graph, plan,
    status, diagnostics, generated source, or deployment state.
18. Observability uses one target-neutral causal model and target-native export wiring.
19. Provider maturity is target-specific and evidence-derived. A provider may be stable on Kubernetes
    and beta on AWS without weakening either contract.
20. A third-party runtime or target is selectable only after declaring capabilities, limitations,
    compatibility, security boundaries, lifecycle ownership, and conformance evidence.
21. Target-specific escape hatches are explicit graph nodes and narrow the portability envelope.
22. Application deletion follows semantic ownership and retention, not a target's default garbage
    collection behavior.
23. Cross-target migration is never implied by target portability. It requires an explicit migration
    plan and receipt.
24. Local is a real target with qualified semantics, not an untracked development shortcut.
25. Release claims are made per capability and target combination, never from a successful deployment
    alone.

---

## Layered architecture

```text
Authored TypeScript application
  models · events · jobs · workflows · actors · agents · schedules · operators
                               │
                               ▼
Semantic application graph and integrity foundation
  identity · authority · capabilities · execution · lifecycle · runtime access
                               │
                               ▼
Provider resolution and ApplicationPlan
  implementations · qualification · placement · secrets · network · migration
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
          Local target    Kubernetes target    AWS target
          supervisor      TypeKro + Alchemy    Alchemy native
          local stores    pods + operators     Lambda/ECS + managed services
                               │
                               ▼
                    Future external targets
```

No target may mutate the semantic graph to make its implementation convenient. Target planning may add
derived physical nodes, but every node retains provenance to its semantic requirement and selected
provider.

### Semantic graph requirements

The graph records at least:

- application and installation identity;
- logical models and storage semantics;
- operations, events, streams, queries, projections, and publications;
- bounded jobs and durable workflows;
- actors, alarms, realtime connections, and fencing requirements;
- agents, tools, model-provider requirements, and authority;
- schedules with precision, timezone, overlap, misfire, retry, cancellation, and history semantics;
- managed resources and reconciliation dependencies;
- callable provider dependencies;
- identity, principal, role, grant, and resource-authority requirements;
- secret, network, egress, ingress, and private-peer requirements;
- observability, data retention, deletion, migration, and recovery requirements;
- performance, architecture, and regional constraints where semantically required.

Portable semantic nodes do not contain Deployments, StatefulSets, Lambda functions, ECS services, IAM
roles, CRDs, CloudFormation stacks, Helm releases, or VPCs. Those are target projections. Explicit
target-specific resources may be represented in a separate constrained extension layer so existing
CRD-native and infrastructure escape hatches remain possible without becoming dependencies of the
portable graph.

---

## Execution-family portability

Each maintained execution family has a target-neutral semantic contract and one or more qualified
physical hosts.

| Execution family | Local | Kubernetes | AWS managed/serverless |
| --- | --- | --- | --- |
| HTTP/query/command | supervised server | Deployment/Service | Lambda + API Gateway or ECS/ALB |
| Event handler | local broker worker | processor Deployment/Job | SQS/EventBridge-triggered Lambda or ECS worker |
| Finite job | supervised bounded process | Job | Lambda, ECS task, or Batch according to envelope |
| Workflow | local qualified engine | Hatchet or other qualified engine | managed/external engine or AWS-qualified implementation |
| Schedule | local durable scheduler | qualified scheduler/CronJob where exact | EventBridge Scheduler where exact |
| Stream processor | local worker | Deployment with broker consumer | Lambda for bounded batches or ECS for continuous consumers |
| Actor | local deterministic runtime | Celld fleet/operator | qualified AWS Celld/ECS or future actor runtime |
| Agent | underlying job/workflow/actor hosts | selected qualified hosts | selected qualified hosts |
| Operator reconcile | local operator runtime | CRD watch/operator host | database/stream/SQS/EventBridge + Lambda/ECS |

The table describes candidates, not automatic equivalence. The planner chooses a host only after its
declared limits satisfy the execution envelope. For example, a function with an unbounded WebSocket,
process-local state, or duration beyond Lambda's contract cannot be lowered to Lambda merely because the
target is AWS.

Execution placement remains one framework decision. A provider may require several physical workloads,
but application code does not import separate Lambda, pod, and ECS callback APIs.

---

## Portable operators

### Authored contract

The existing resource-native surface remains canonical:

```ts
Resource.on.reconcile(async (resource, context) => {
  // Observe declared dependencies.
  // Perform one bounded convergence increment.
  // Write authoritative status.
  // Complete or durably request another reconciliation.
});
```

This RFP does not introduce `app.reconcile`, a separate AWS callback, or an EventBridge-specific handler.
Kubernetes-backed resource declarations retain their CRD behavior. Database-backed managed resources use
the same handler model and may share the same domain declaration where the storage facet is portable.

### Portable managed-resource envelope

Every operator runtime must preserve at least:

```ts
interface ManagedResourceMetadata {
  uid: string;
  generation: number;
  resourceVersion: string;
  createdAt: string;
  deletionTimestamp?: string;
  finalizers: string[];
}

interface ManagedResourceStatus {
  observedGeneration: number;
  conditions: Array<{
    type: string;
    status: "True" | "False" | "Unknown";
    observedGeneration: number;
    reason: string;
    message: string;
    lastTransitionTime: string;
  }>;
}
```

The exact storage schema is provider owned. The semantic fields and their concurrency/lifecycle meaning
are not.

### Reconciliation invariants

- Spec and status have separate declared writers.
- A stale generation cannot report current readiness.
- One reconcile lease is active for a resource at a time.
- The lease carries a monotonically fenced token; stale workers cannot commit effects or status.
- Duplicate notifications are safe and expected.
- Effects are idempotent or protected by durable operation receipts.
- `requeueAfter()` persists a semantic next-due request rather than a process timer.
- Secondary watches produce invalidation hints; periodic resync repairs missed delivery.
- Finalizers are durable before owned children are created.
- Deletion advances through an observed, restart-safe state machine.
- Force finalization is separately authorized, audited, explicit, and never an automatic timeout policy.
- Status records bounded diagnostic evidence without raw secrets or unbounded provider payloads.

### AWS operator runtime

The default AWS design is:

```text
Desired-state transaction
        │
        ├── managed-resource row/item
        └── transactional outbox or DynamoDB Stream
                         │
                         ▼
                 reconciliation queue
                         │
                         ▼
               leased bounded reconciler
                         │
            effects + status + nextDueAt
                         ▲
                         │
      EventBridge delayed wakeup/recovery sweep
```

PostgreSQL and DynamoDB are both valid store candidates when they pass the same contract. The initial
qualified provider should choose one canonical default rather than pretending their transaction and
stream semantics are identical.

SQS provides backpressure, retries, and delivery. EventBridge Scheduler supplies durable delayed wakeups
and bounded recovery sweeps. It does not own desired state, leases, finalizers, or completion. The default
implementation must avoid one permanent EventBridge schedule per resource unless scale and lifecycle
evidence proves that design preferable. A shared indexed `nextDueAt` sweep or ephemeral one-time schedules
may be selected transparently while preserving the same contract.

Lambda executes bounded reconcile increments when its duration and dependency requirements fit. ECS tasks
or services host reconcilers requiring longer execution, specialized networking, or persistent
connections. A reconcile waiting for infrastructure returns `requeueAfter()`; it does not hold either
host open.

### Kubernetes operator runtime

The Kubernetes implementation retains CRDs, watches, secondary watches, work queues, status subresources,
field ownership, finalizers, leases, and resync. The ordinary operator handler must not receive a weaker or
different application model than the AWS handler.

Kubernetes-specific reads and effects remain available through explicit capabilities. Using them marks
that handler Kubernetes-bound without contaminating unrelated handlers or the application as a whole.

### Local operator runtime

The local target uses a durable local store, transactional notification/outbox behavior, a supervised
work queue, persisted delayed wakeups, and the same lease/fencing/finalization contract. Process restart
and machine restart are separate qualification tiers. In-memory-only reconciliation may exist as a test
fixture but cannot satisfy the durable local contract.

---

## AWS target architecture

The AWS target is first-class and Alchemy native.

### Physical building blocks

The target may use:

- Lambda for bounded HTTP, command, query, event, schedule, job, and reconcile execution;
- ECS/Fargate for long-lived servers, continuous processors, WebSockets, specialized workers, and actor
  runtimes;
- SQS and EventBridge for delivery and routing according to semantic requirements;
- EventBridge Scheduler for qualified schedules and operator wakeups;
- API Gateway, ALB, CloudFront, and Route 53 for exposure;
- DynamoDB, Aurora/PostgreSQL, ElastiCache/Valkey, S3, OpenSearch, Athena, and other qualified providers;
- Secrets Manager or SSM Parameter Store for sensitive material;
- IAM roles and resource policies for workload authority;
- Security Groups, VPC endpoints, subnet routing, and service-native policies for runtime access;
- CloudWatch and OpenTelemetry-compatible export for target observations.

These are implementation options below capability contracts. An application author requests an object
store, workflow engine, actor runtime, or private database connection—not an AWS service unless they
deliberately choose an AWS-specific provider.

### Native Alchemy ownership

Alchemy owns AWS deployment state, dependency ordering, replacement, adoption, observation, and teardown.
Every maintained AWS resource must be a native Alchemy resource or a narrowly documented compatibility
bridge with a removal plan. New capabilities must not add CloudFormation templates, stacks, nested stacks,
or CloudFormation-shaped semantic records as the canonical deployment path.

The AWS plan retains the exact relationship between semantic requirement, provider selection, Alchemy
resource identity, physical AWS identity, runtime-access rule, and deployment output.

### Serverless does not mean Lambda-only

The target optimizes for managed/serverless operation while preserving semantics. Placement considers:

- maximum duration and cancellation;
- concurrency and ordering;
- protocol and connection lifetime;
- memory, architecture, storage, and ephemeral-disk requirements;
- cold-start sensitivity;
- private-network access;
- retry and duplicate-delivery behavior;
- cost and scaling policy;
- runtime compatibility and container requirements.

The plan explains why Lambda, ECS/Fargate, or another host was selected. Users may override placement only
with a compatible host. An incompatible override fails before mutation.

---

## Kubernetes target architecture

Kubernetes remains a first-class target with its own strengths:

- TypeKro expresses application infrastructure and provider compositions;
- Alchemy manages deployment ordering, state, adoption, and lifecycle;
- generated workloads run on the appropriate Applik8s hosts;
- CRD-backed operators use the ordinary `Resource.on.reconcile` model;
- workload identity, RBAC, Secrets, Services, NetworkPolicy, ingress, storage, and observability are
  inferred from semantic requirements;
- operator-owned children are not also continuously owned by TypeKro;
- namespace, CRD, singleton, retained-data, and finalizer lifecycle is explicit.

TypeKro imports and Kubernetes schemas must remain lazy, target-scoped, and absent from clean AWS/local
compiler and runtime paths. A basic application should install, plan, and run for AWS without a Kubernetes
client, schema loader, Helm dependency, cluster, or TypeKro runtime being required.

---

## Provider-neutral runtime contracts

Capabilities remain the primary extension boundary:

```ts
application.provide(WorkflowEngine, AcmeWorkflow.provider({ /* typed options */ }));
application.provide(ActorRuntime, AcmeActors.provider({ /* typed options */ }));
application.provide(OperatorRuntime, AcmeOperators.provider({ /* typed options */ }));
```

A provider package publishes:

- semantic capability and operation coverage;
- target support and physical deployment contributors;
- execution-host requirements;
- secret and runtime-access requirements;
- readiness and diagnostic projection;
- lifecycle, retention, upgrade, rollback, and deletion behavior;
- supported architecture, region, version, and provider prerequisites;
- compatibility and migration readers/writers;
- conformance fixtures and evidence metadata;
- package subpaths that do not eagerly load unrelated target SDKs.

Provider-owned infrastructure remains behind the implementation. Public application types cannot expose
Helm values, CloudFormation properties, AWS SDK clients, Kubernetes objects, or arbitrary stringly maps as
the ordinary configuration experience.

### Bring-your-own execution runtime

The future runtime SPI separates three concerns:

1. **Semantic implementation** — which application operations and guarantees the runtime implements.
2. **Execution adapter** — how compiled callbacks, inputs, results, cancellation, authority, telemetry,
   and retries cross the runtime boundary.
3. **Deployment contributor** — what each supported target must materialize and how readiness/lifecycle is
   observed.

A runtime can implement one execution family without becoming a whole deployment target. For example, a
third-party workflow engine may run on both Kubernetes and externally hosted infrastructure. Conversely,
a target adapter may reuse existing runtime providers.

The SPI must not expose compiler internals, mutable graph objects, ambient cloud credentials, or direct
state mutation. Contributions are declarative, validated, provenance-bearing, and scoped to their
capability.

### Bring-your-own target

A future target adapter must implement:

- deterministic planning from the semantic graph and selected providers;
- resource identity and dependency materialization;
- plan/apply/observe/update/delete/adopt semantics;
- exact Secret and runtime-access lowering;
- execution-host placement;
- status/readiness projection;
- migration and replacement policy;
- leak-free teardown and retained-data behavior;
- diagnostics and `explain` provenance;
- target conformance and clean-consumer packaging.

Target adapters do not invent new application semantics. A target may declare unsupported requirements,
which fail planning with the exact source and missing guarantee.

---

## Provider resolution and profiles

Provider resolution answers three separate questions:

1. What semantic capability does the application require?
2. Which implementation satisfies it for this installation/profile?
3. What runtime and physical resources will that implementation produce under the selected profile?

These decisions must not collapse into a target-name switch or string-matching API. Typed provider
bindings remain authoritative. Profiles are the sole optional user-facing assembly selector and may supply
defaults, qualifications, sizing, and ownership policy. Provider constructors accept concrete account,
cluster, endpoint, config, and Secret bindings and produce the physical plan directly.

Resolution is deterministic and emits:

- selected implementation and version;
- reason and source of selection;
- claimed semantic guarantees;
- target compatibility;
- maturity and evidence receipts;
- physical placement and prerequisites;
- secret/network/identity requirements;
- cost-relevant topology;
- rejected alternatives and why they were incompatible;
- portability envelope after explicit escape hatches.

No provider is selected merely because its package is installed.

---

## Runtime access, identity, and authorization

Application authority remains provider neutral.

- The authenticated principal and causal principal are semantic identities.
- Managed execution receives a bounded execution principal.
- Provider process identity never substitutes for application identity.
- Capability use and resource operations are authorized independently.
- Authorization receipts remain stable across target transport.

Physical lowering differs:

| Semantic requirement | Kubernetes | AWS | Local |
| --- | --- | --- | --- |
| Workload identity | ServiceAccount | IAM role | supervised process identity |
| Capability authorization | RBAC/provider policy | IAM/resource policy/provider policy | local capability policy |
| Private peer | Service selector + NetworkPolicy | endpoint + Security Groups/VPC policy | local network/process policy |
| Secret use | exact Secret projection | Secrets Manager/SSM grant | local secret store |
| Public ingress | Gateway/Ingress/Service | API Gateway/ALB/CloudFront | local gateway |

The framework derives physical permissions from exact workload placement and declared capability use.
Broad target credentials, first-role selection, namespace-wide Secret reads, and post-hoc policy appenders
fail release gates.

---

## Data and model portability

One logical model may be backed by PostgreSQL, DynamoDB, Kubernetes, object storage, an analytical store,
or another qualified provider according to its declared semantics. Portability does not mean all stores
have identical query, transaction, relationship, or consistency behavior.

The model contract records:

- key and identity semantics;
- mutation and transaction requirements;
- relationship and query requirements;
- consistency and snapshot semantics;
- change/event publication authority;
- retention and deletion policy;
- indexing and scale requirements;
- tenant/resource authority;
- migration and schema compatibility.

A provider must satisfy those requirements or reject the model. The compiler cannot silently turn a
transactional relational model into an eventually consistent key-value model.

Managed-resource state may share a provider with domain models only when authority and transaction
boundaries remain explicit. Operator metadata must not pollute application-domain records through opaque
framework columns without a versioned schema contract.

---

## Scheduling portability

The existing schedule definition/instance/occurrence model remains semantic authority. Target providers
must preserve cadence, precision, timezone, overlap, misfire, retry, cancellation, and history semantics.

- Kubernetes may use a qualified controller, workflow engine, or CronJob only where exact.
- AWS may use EventBridge Scheduler only where its semantics match the declared schedule.
- Local uses a durable scheduler and occurrence store.
- Operator `requeueAfter()` remains operator lifecycle, not an application schedule.
- Actor alarms remain actor-owned timers.
- Processor convergence remains processor lifecycle.

The framework may reuse scheduling mechanics while retaining these separate semantic owners.

---

## Networking and exposure

Exposure is declared through provider-neutral application hosts, routes, certificates, DNS publication,
and private-peer requirements. Target lowering may produce:

- Kubernetes Gateway/Ingress, Services, cert-manager resources, and DNS publication;
- AWS API Gateway/ALB/CloudFront, ACM, and Route 53 records;
- local gateway routes and development certificates.

Plans expose protocol, endpoint identity, trust, TLS termination, authentication boundary, ingress source,
private-peer requirements, and cross-region implications. Target-specific annotations and listener
settings remain advanced provider configuration and narrow portability when used.

---

## Observability and operational equivalence

One causal observability contract spans targets:

- request, command, query, event, job, workflow, actor, agent, schedule, and reconcile identities;
- causal and execution principals;
- attempt, retry, idempotency, cancellation, and result relationships;
- provider and target attributes;
- deployment and runtime versions;
- semantic status transitions;
- redacted error classification.

Kubernetes events, CloudWatch records, EventBridge delivery metrics, pod state, Lambda reports, ECS task
state, and provider-native metrics are observations, not replacement semantic authorities.

The local and deployed targets must export the same trace relationships. Provider-specific details remain
available beneath stable semantic attributes.

---

## Lifecycle, ownership, and teardown

Every physical resource has one canonical owner and one lifecycle classification:

- application owned;
- installation owned;
- shared singleton;
- externally owned;
- retained data;
- ephemeral execution artifact.

Target garbage collection is an implementation detail. The semantic lifecycle defines creation,
adoption, update, replacement, finalization, retention, and deletion order.

Teardown must:

1. stop new application admission where required;
2. drain or cancel managed execution according to its contract;
3. finalize managed resources;
4. verify durable state and retention policy;
5. delete dependents before dependencies;
6. retain external/shared resources unless explicitly and safely torn down;
7. verify physical absence or documented retention;
8. retain retry state on interruption;
9. report blockers with physical identity, UID/version, finalizers/leases, and remediation.

AWS deletion, Kubernetes deletion, and local cleanup pass the same semantic lifecycle suite plus
target-specific adversarial tests.

---

## Migration and compatibility

### Same-target upgrades

Compiler, graph, plan, generated artifact, runtime protocol, provider state, and physical resource
upgrades follow the public compatibility inventory. New writers are introduced only after old readers are
compatible. Restart-safe migrations resume after interruption and preserve target state ownership.

### Provider replacement

Replacing one provider implementation with another is a migration, not ordinary configuration. The plan
must classify data movement, dual-read/write requirements, downtime, authority transfer, endpoint changes,
rollback boundary, and cleanup.

### Cross-target migration

An application that can be deployed independently to Kubernetes and AWS is not automatically movable
between them. Cross-target migration requires:

- compatible application and provider versions;
- explicit data export/import or replication;
- event/frontier and idempotency continuity;
- identity and authorization mapping;
- DNS/endpoint cutover;
- workflow/job/actor/operator drain and handoff;
- retained-state and rollback policy;
- a live migration receipt.

v0.10 may qualify selected migrations, but target portability does not claim universal live migration.

---

## Application plan and explainability

`applik8s plan` must answer, for every execution and resource:

- What authored construct caused this requirement?
- Which provider implementation was selected and why?
- Which target guarantees are required?
- What physical host and resources will be created?
- What identity, Secret, network, and data access will they receive?
- Which lifecycle owner updates and deletes them?
- Which guarantees are exact, degraded, unsupported, or unqualified?
- What prevents another target or implementation from being selected?
- What target-specific escape hatch reduced portability?
- What will an update replace, migrate, retain, or interrupt?

Example:

```text
SummarizeConversation
  semantic execution: finite job, <= 5m, cancellable, at-least-once admission
  provider: AwsManagedJobRuntime 1.0
  host: Lambda arm64
  reason: duration/memory/network requirements fit qualified Lambda envelope
  authority: Conversation.read, Summary.create, StructuredGeneration.invoke
  network: private PostgreSQL + OpenRouter egress
  portability: local, kubernetes, aws
```

Unsupported planning fails with a diagnostic such as:

```text
TARGET_EXECUTION_INCOMPATIBLE
RealtimeSession requires a connection lifetime not supported by the selected Lambda host.

Source: src/realtime/session.ts:18
Compatible AWS host: ECS/Fargate
Compatible targets: kubernetes, local
Next action: allow managed-container placement or select a compatible realtime provider.
```

---

## Package boundaries

The package topology should converge toward:

| Package boundary | Responsibility |
| --- | --- |
| Core/application packages | Target-neutral semantic contracts, graph, authority, execution families, and provider tokens |
| Compiler | Closure discovery, semantic graph compilation, requirements, and portable artifacts |
| Deployment compiler | Provider resolution and target-neutral plan derivation |
| Local target | Supervisor, local execution hosts, local operator runtime, and local providers |
| Kubernetes target | TypeKro adapter, Kubernetes execution hosts, CRD/operator runtime, and physical lowering |
| AWS target | Alchemy-native resources, Lambda/ECS hosts, AWS operator runtime, IAM/network/Secret lowering |
| Provider packages | Capability implementation, target contributors, conformance, and optional explicit configuration |
| Target SDK | Bounded public SPI for third-party target adapters |
| Runtime SDK | Bounded public SPI for third-party execution runtimes |

Umbrella imports must not eagerly load Kubernetes, AWS, TypeKro, Alchemy, cloud SDK, Helm, or provider
compiler code into authored callbacks. Generated runtime bundles include only the selected execution
surface and declared dependencies.

Package count is not a success metric. Boundaries are justified by independent consumption, target
isolation, optional dependency pruning, security authority, or release compatibility.

---

## Escape hatches

Advanced users may deliberately access target-specific capabilities:

```ts
application.provide(ImageProcessor, AwsLambdaImageProcessor.provider({ /* ... */ }));
```

or within an explicitly constrained handler:

```ts
const kubernetes = context.require(KubernetesEffects);
```

The graph records the constraint at the smallest provable execution boundary. One Kubernetes-specific
operator does not make unrelated HTTP handlers Kubernetes-only. Plans and docs distinguish:

- portable application constructs;
- target-qualified provider selection;
- explicit target-specific application dependencies;
- raw infrastructure escape hatches.

Escape hatches never receive ambient authority and cannot bypass plan, Secret, runtime-access, or lifecycle
validation.

---

## Delivery program

### Increment 0 — Kubernetes dependency audit

- Inventory every Kubernetes, TypeKro, KRO, Helm, CRD, pod, namespace, ServiceAccount, RBAC, Secret,
  Service, NetworkPolicy, owner-reference, and finalizer assumption in public, graph, compiler, runtime,
  provider, deployment, CLI, example, and documentation paths.
- Classify each as semantic concept, Kubernetes implementation, explicit escape hatch, or stale leak.
- Add source gates preventing Kubernetes dependencies from entering target-neutral packages and AWS/local
  runtime bundles.
- Record package-load and clean-consumer baselines.

### Increment 1 — Portable target and execution contracts

- Freeze the target-neutral semantic application graph.
- Define execution envelopes and host-selection constraints for every maintained execution family.
- Separate runtime provider, execution host, deployment contributor, and target adapter contracts.
- Extend `ApplicationPlan` with portability, qualification, physical placement, and rejection provenance.
- Preserve v0.9 authoring compatibility or document deliberate pre-1.0 corrections.

### Increment 2 — Portable operators

- Move reconciliation semantics out of Kubernetes packages.
- Define the managed-resource envelope, leases, fencing, status, finalizers, secondary watches, resync,
  durable `requeueAfter`, idempotent effects, and administrative force-finalization.
- Qualify the local durable operator runtime.
- Retain and qualify the Kubernetes CRD operator runtime.
- Implement one canonical AWS database/queue/EventBridge operator runtime.
- Run one shared conformance suite across all three.

### Increment 3 — AWS-native deployment and execution

- Complete Alchemy-native AWS materialization for every maintained AWS target resource.
- Remove new-write CloudFormation authority and retain only explicit migration readers where necessary.
- Implement exact Lambda/ECS host selection and generated artifacts.
- Complete IAM, Secrets Manager/SSM, Security Group, VPC endpoint, exposure, DNS/TLS, observability, and
  lifecycle lowering.
- Prove plan/apply/update/replacement/adoption/interruption/teardown against real AWS.

### Increment 4 — Provider parity

- Qualify the required v0.10 provider set on local, Kubernetes, and AWS.
- Preserve one application-facing capability per semantic need.
- Expose target-specific provider limitations and maturity honestly.
- Prove application-domain code remains unchanged across target profiles.

### Increment 5 — Public runtime and target SPI

- Publish bounded runtime-provider and target-adapter SDKs.
- Build one maintained independent runtime fixture without private imports.
- Build one constrained external-target fixture or reference adapter.
- Prove clean package consumption, version negotiation, diagnostics, plan provenance, and authority
  isolation.
- Keep third-party targets preview until live lifecycle and security evidence exists.

### Increment 6 — Product qualification

- Run GuestBook, Chirp, and Agentic Start locally, on Kubernetes, and on AWS from unchanged domain source.
- Exercise meaningful distributed behavior rather than static health pages.
- Compare plans and explain provider/host choices.
- Prove target-specific lifecycle, failure recovery, observability, and leak-free teardown.
- Publish migration, troubleshooting, cost/topology, and provider-selection documentation.

---

## Acceptance matrix

### Application-source invariance

- The same domain modules compile for local, Kubernetes, and AWS.
- Target/profile modules contain provider and deployment policy, not duplicated business behavior.
- Generated target artifacts are deterministic.
- Target-specific imports are absent from portable callback closures.
- Explicit escape hatches constrain only the affected graph boundary.

### Operator conformance

Every operator runtime proves:

- create/update/status generation fidelity;
- duplicate and reordered notifications;
- process/host restart;
- lease expiry and stale-worker fencing;
- secondary dependency invalidation;
- lost-event recovery through resync;
- persisted `requeueAfter`;
- idempotent effect replay;
- deletion during active reconciliation;
- finalizer blocking and authorized force-finalization;
- retained external data;
- migration and mixed-version behavior;
- bounded diagnostics and zero leaked resources.

### Execution-host conformance

Every maintained host proves:

- exact input/output/error codecs;
- trusted admission and execution authority;
- causal-principal preservation;
- cancellation, timeout, retry, and duplicate behavior;
- secret and network isolation;
- telemetry propagation;
- generated artifact compatibility;
- deployment update and rollback behavior;
- host loss and recovery;
- clean teardown.

### AWS qualification

- Real AWS evidence is required; local emulators cannot qualify IAM, VPC, EventBridge, Lambda, ECS,
  managed-data, regional, or quota semantics.
- No maintained AWS path creates CloudFormation stacks.
- Every physical resource is represented in Alchemy state with semantic provenance.
- Lambda/ECS selection is explained and adversarially tested.
- EventBridge scheduling and operator recovery preserve semantic timing.
- IAM and network deny tests accompany allow tests.
- Upgrade and teardown begin from the previous released version.
- Cost and scale histories are recorded for representative workloads.

### Kubernetes qualification

- TypeKro and Alchemy own only their declared resources.
- Operator-owned resources have no competing continuous owner.
- CRD, namespace, singleton, retained-state, finalizer, and version-skew lifecycle is live tested.
- Workload identity, Secret projection, NetworkPolicy, rollout, and repair are live tested.
- Kubernetes packages remain absent from clean AWS/local paths.

### Product qualification

GuestBook proves the minimal readable path. Chirp proves event, stream, projection, analytics, scheduling,
and scale composition. Agentic Start proves identity, billing, agents, workflows, documents, approvals,
operators, observability, and a polished generated product journey.

For each target, a clean external consumer must:

1. generate or install the application;
2. configure target credentials and providers;
3. plan and understand the derived topology;
4. deploy successfully;
5. execute its canonical journeys;
6. observe and diagnose a forced failure;
7. update safely;
8. delete without unexplained leftovers.

---

## Release-blocking criteria

v0.10 is not ready unless:

- Kubernetes is absent from portable semantic nodes and target-neutral runtime contracts; any explicit
  Kubernetes extension node is isolated, provenance-bearing, and correctly narrows portability;
- a clean AWS application installs and deploys without Kubernetes or TypeKro dependencies;
- maintained local, Kubernetes, and AWS targets pass their claimed capability gates;
- portable operator conformance passes on all three targets;
- GuestBook, Chirp, and Agentic Start execute meaningful unchanged-domain journeys on Kubernetes and AWS;
- Alchemy-native AWS deployment has no maintained CloudFormation write path;
- IAM, networking, secrets, authority, observability, migration, and teardown are live qualified;
- provider and target limitations are visible before mutation;
- target/runtime SPI consumers build without private imports;
- package and generated bundle audits prove target dependency isolation;
- previous-release upgrade and interrupted-migration tests pass;
- documentation accurately distinguishes semantic portability from physical equivalence and live
  cross-target migration.

AWS may have lower provider maturity than Kubernetes for optional capabilities, but the release cannot
claim target equivalence for a capability lacking shared conformance. A required acceptance-application
capability must either have a qualified AWS implementation or make that application's AWS target
explicitly unsupported; it cannot silently disappear.

---

## Risks and tradeoffs

### Lowest-common-denominator design

**Risk:** Portable APIs lose the distinctive power of Kubernetes or AWS.

**Response:** Define rich semantic guarantees and allow multiple physical realizations. Use explicit
escape hatches for target-exclusive capabilities rather than weakening the common model.

### False equivalence

**Risk:** Successful creation is presented as proof of equivalent behavior.

**Response:** Qualify semantics through shared lifecycle, failure, authority, timing, and recovery suites;
report maturity per capability and target.

### Framework complexity

**Risk:** The compiler, plan, and package graph become harder to maintain.

**Response:** Separate semantic graph, provider resolution, execution hosts, and target materialization.
Do not create parallel AWS and Kubernetes application APIs.

### AWS service coupling

**Risk:** “Kubernetes optional” becomes “AWS required.”

**Response:** AWS is the second first-class target and strongest portability proof, not the definition of
the model. Runtime and target SPIs remain provider neutral.

### Serverless mismatch

**Risk:** Long-lived or stateful workloads are forced into Lambda.

**Response:** Managed/serverless AWS includes Fargate and other appropriate managed hosts. Placement is
semantic and explained.

### Operator-store fragmentation

**Risk:** Database-backed reconciliation creates another hidden source of truth.

**Response:** Name the canonical managed-resource store, version its schema, expose ownership in the plan,
and keep queues/EventBridge as rebuildable delivery/wakeup mechanisms.

### Third-party runtime safety

**Risk:** Plugins gain broad compiler or deployment authority.

**Response:** Use declarative contributions, scoped credentials, signed/versioned artifacts, capability
manifests, and conformance. No ambient mutation or private compiler imports.

### Scope before 1.0

**Risk:** v0.10 delays the 1.0 freeze indefinitely.

**Response:** Treat this as one bounded substrate-portability program. Do not add new domain primitives.
Reuse the frozen v0.9 semantics and admit only work required to implement them independently of
Kubernetes.

---

## Open decisions

These decisions require implementation research before architecture freeze:

1. Whether DynamoDB or PostgreSQL is the canonical first AWS managed-resource store.
2. Whether delayed operator wakeups use ephemeral one-time EventBridge schedules, an indexed shared
   sweep, or a qualified hybrid based on cardinality and delay.
3. Which workflow provider supplies the first fully qualified AWS path.
4. Whether the first AWS Celld actor provider runs on ECS/Fargate or remains explicitly beta while another
   actor provider qualifies AWS semantics.
5. Which execution-envelope fields are stable public contract versus derived plan data.
6. How third-party target adapters are isolated and version negotiated.
7. Profile syntax and concrete provider configuration follow the accepted v0.9 Profiles and Concrete
   Provider Bindings RFP; target, placement, substrate, and application-installation selectors are closed.
8. Which cross-target migration, if any, is required for v0.10 versus deferred with an explicit contract.

Open implementation choices may not weaken the normative semantic guarantees.

---

## Final vision

After v0.10, Applik8s should be accurately describable as:

> A TypeScript framework for building and operating distributed applications as one typed program.
> Applications declare their state, behavior, authority, dependencies, and lifecycle. Applik8s derives a
> qualified runtime and infrastructure plan for local development, Kubernetes, AWS, or future provider
> targets. Kubernetes is deeply supported, but never required by the programming model.

The strongest proof is not that one example renders both YAML and AWS resources. It is that a complex
application—with durable workflows, actors, agents, streams, schedules, authorization, continuous
operators, data, networking, and observability—keeps one domain implementation while surviving real
failure, upgrade, and teardown on both Kubernetes and managed AWS.
