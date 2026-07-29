# RFP: Applik8s v0.7 — Agentic Start Distribution and Acceptance Applications

**Status:** Proposed; maintainer review required

**Charter:** [`charter-v07-agentic-platform.md`](charter-v07-agentic-platform.md)

**Depends on:** Completion candidates from the operation-authority, profiles-and-Starts, search, AI
runtime, identity-and-OAuth, and MCP RFPs

**Requested by:** Vasco, the agentic identity and authorization platform, CollectorBills, and the
migration away from Stimp runtime plumbing

## Purpose

Package the v0.7 primitives into one coherent, maintainable Agentic Start and prove them through real
Vasco and agentic-identity product paths. This RFP owns distribution and integration quality. It must not
repair missing foundational semantics by creating Start-local registries, databases, authorization,
workflow runtimes, or deployment mechanisms.

The current Stimp `agent-saas-starter` is the concrete application/product baseline. Applik8s replaces
its implementation plumbing and improves its generated source organization, but the v0.7 Start may not
silently regress its credential-free first run, onboarding/control-center experience, agentic product
surfaces, operational visibility, extension seams, generated-example parity, or release verification.

## Required outcome

```sh
bun create applik8s my-product --start agentic
```

produces a small upstream-shaped TanStack Start application:

```text
src/
  app.ts
  installation.ts
  providers.ts
  modules.ts
  features/
    sources/
      index.ts
      schema.ts
      model.ts
      operations.ts
      workflows.ts
      search.ts
      permissions.ts
      agent.ts
      routes.ts
    accounts/
    administration/
  routes/
vite.config.ts
package.json
```

The default is feature-first, not framework-artifact-first. A small feature may remain one file; a
larger feature splits its model, operations, workflows, authority, search, agent, and route adapters
without scattering one domain concept across application-wide directories. `src/routes/` remains the
thin upstream TanStack Start route tree required by the selected routing convention and imports
feature-owned route definitions. Shared infrastructure appears only after real reuse justifies it.

The generated project deploys a credential-free starter profile and can transition by explicit plan to
dedicated or external providers.

The ordinary authored experience should remain compact:

```ts
// src/app.ts
import { app } from "@applik8s/applik8s";

export const application = app("research-platform", {
  installation: Installation,
});
```

The generated project wires maintained modules explicitly rather than hiding them in the constructor:

```ts
// src/modules.ts
import { conversations } from "@applik8s/conversations";
import { approvals } from "@applik8s/approvals";
import { artifacts } from "@applik8s/artifacts";
import { tanstackAgents } from "@applik8s/ai-tanstack";
import { application } from "./app";

export const Conversations = conversations(application);
export const Artifacts = artifacts(application);
export const Approvals = approvals(application, {
  conversations: Conversations,
});
export const Agents = tanstackAgents(application, {
  conversations: Conversations,
  approvals: Approvals,
  artifacts: Artifacts,
});
```

These functions add ordinary typed nodes and return handles from the same application graph. They are
side-effect-free during discovery and do not create a module registry. An application can inspect,
replace, configure, or remove one import without replacing the application constructor or copying
package internals.

```ts
// src/features/sources/model.ts
import { database } from "../../providers";

const ObservationRequested = event("source.observation-requested.v1", {
  payload: type({
    requestId: "string",
    sourceId: "string",
    reason: "'created' | 'manual' | 'scheduled'",
  }),
});

export const Source = application
  .model(sources, { database })
  .operation(
    "observe",
    {
      input: ObserveSourceInput,
      output: ObserveSourceOutput,
      key: ({ sourceId }) => sourceId,
      events: [ObservationRequested],
    },
    async (source, input, context) => {
      const requestId = context.id("observation");
      source.patch({ spec: { observationState: "queued" } });
      context.emit(ObservationRequested, {
        requestId,
        sourceId: source.id,
        reason: input.reason,
      });
      return { requestId };
    },
  );
```

External observation work remains a separate, visible effect closure:

```ts
const ObserveSourceEffects = task("source.observe.effects.v1", {
  input: type({
    requestId: "string",
    sourceId: "string",
  }),
  output: type({
    evidenceCount: "number.integer >= 0",
  }),
});

export const observeSourceEffects = application.task(
  ObserveSourceEffects,
  {
    requires: [Http],
    operations: {
      recordEvidence: Evidence.create.onInput(
        (task) => ({
          sourceId: task.sourceId,
        }),
      ),
      completeObservation: Source.completeObservation.onInput(
        (task) => ({
          sourceId: task.sourceId,
          requestId: task.requestId,
        }),
      ),
    },
    queries: {
      source: Source.read.onInput(
        (task) => ({
          sourceId: task.sourceId,
        }),
      ),
    },
    idempotencyKey: ({ requestId }) => requestId,
    retries: 4,
  },
  async (input, context) => {
    const http = context.inject(Http);
    const source = await context.queries.source();
    const response = await http.get(source.url, { signal: context.signal });
    const evidence = await extractEvidence(response, context.signal);

    for (const item of evidence) {
      await context.operations.recordEvidence({
        title: item.title,
        excerpt: item.excerpt,
      });
    }
    await context.operations.completeObservation({
      evidenceCount: evidence.length,
    });
    return { evidenceCount: evidence.length };
  },
);

ObservationRequests.process(
  "execute-source-observation",
  {
    tasks: {
      observe: observeSourceEffects.onEvent(
        (event) => ({
          requestId: event.requestId,
          sourceId: event.sourceId,
        }),
      ),
    },
  },
  async (_requested, context) => {
    await context.tasks.observe();
  },
);
```

`application.task(contract, options, closure)` is the authored task-definition golden path. A standalone
`task(name, schemas)` value is only a reusable typed contract for package composition; it does not
register or execute work. `context.tasks.observe(...)` is the declared dependency alias for scheduling
the resulting task handle and lowers to the same internal invocation machinery.

The Start may supply safe processor/task defaults, but it may not fold this effect into the model
transaction or hide the authored closures in generated metadata.

```ts
// src/features/sources/agent.ts
import { chat } from "@tanstack/ai";
import { withPersistence } from "@tanstack/ai-persistence";

export const SourceResearcherIdentity = application.serviceIdentity(
  "source-researcher",
);

export const SourceResearcher = application.agent(
  "source-researcher",
  {
    identity: SourceResearcherIdentity,
    model: ReasoningModel,
    instructions: sourceResearcherInstructions,
    tools: [
      Source.read,
      Source.observe,
      EvidenceSearch.search,
      ExtractionProposal.create,
    ],
  },
  async (request, context) =>
    chat({
      adapter: context.tanstack.adapter,
      messages: request.messages,
      threadId: request.threadId,
      runId: context.runId,
      ...(request.resume ? { resume: request.resume } : {}),
      tools: context.tanstack.tools,
      middleware: [
        withPersistence(context.tanstack.persistence),
      ],
    }),
);

SourceResearcherIdentity.can(
  Source.read.all(),
  EvidenceSearch.search,
  ExtractionProposal.create,
  Source.observe.where((source) => source.risk.ne("restricted")),
);

SourceResearcherIdentity.mayRequest(
  Source.observe.where((source) => source.risk.eq("restricted")),
  {
    approval: SourceOwner,
    expiresIn: "15m",
    maximumUses: 1,
    outcome: ObservationRecorded,
  },
);
```

Domain files do not import Hatchet, OpenSearch, Ory, Envoy AI Gateway, TypeKro, Kubernetes clients, or
provider credentials. Agent files do import TanStack AI: it is the application-facing AI library and is
not hidden behind an Applik8s chat facade.

The generated project also demonstrates a Kubernetes-native model so the Start does not accidentally
teach that every application model is relational:

```ts
export const ImportJob = application.crd(ImportJobEntity, {
  apiVersion: "research.example.com/v1alpha1",
});

ImportJob.on.create(
  "initialize-import-job",
  { namespace: application.installation.spec.name },
  async (created, context) => {
    if (!created.spec.sourceUrl.trim()) {
      created.status.phase = "Rejected";
      created.status.reason = "A source URL is required.";
      return;
    }
    created.status.phase = "Pending";
  },
);
```

Relational models retain their Drizzle tables; CRD/resource models retain their ArkType definitions;
analytical models/projections retain their declared analytical schema/capability contract; framework
document/control-plane models retain their existing entity definitions. Maintained modules consume
their common operation/reference/event facets instead of translating them into a Start-owned model
schema.

The generated example keeps execution placement visible:

| Authored closure | Existing runtime boundary |
| --- | --- |
| Relational `beforeCommit` or named operation | Authoritative database transaction and declared outbox |
| Relational committed lifecycle or stream processor | Generated bounded processor workload |
| CRD/resource lifecycle or reconcile handler | Existing componentized operator/WASM path with inferred watches, RBAC, status, and finalizers |
| Durable task or workflow | Qualified `WorkflowEngine` worker; Hatchet is the first implementation |
| HTTP route or TanStack AI agent | Generated application server runtime with browser-safe facade separation |

The Start may infer compatible workloads and defaults, but it may not move a closure to a different
authority merely to simplify generation. A single source project does not mean a single process.

Within managed closures, direct imported-handle calls are not an alternate internal API.
`context.invoke(handle, input)` is the canonical internal authorized invocation, while declared
`context.operations`, `context.queries`, and `context.tasks` members are typed aliases that lower to it.
Ordinary application entrypoints still call handles directly. Transaction-local model mutation and
outbox emission retain their existing primitives rather than becoming nested operation invocations.

A task, workflow, processor, or reconciler dependency declaration defines its generated
`WorkloadIdentity`'s maximum operation, input, target, scope, audience, and transport envelope. Each
concrete input, workflow step, event delivery, or reconcile attempt executes under a distinct public
`ExecutionPrincipal`; task/workflow/processor/reconcile names are diagnostic kinds rather than parallel
principal APIs. Neither layer grants delegation authority, user impersonation, alternate transport
access, ambient caller authority, or an undeclared operation.

Execution bindings such as `Source.read.onInput(task => ({ sourceId: task.sourceId }))` and
`observeSourceEffects.onEvent(event => ({ requestId: event.requestId, sourceId: event.sourceId }))` fix
callee-input fields from the enclosing execution and remove those fields from the generated alias input.
They lower to one internal `ExecutionBinding` IR serialized in the application graph, run receipt, and
deployment plan. The compiler may infer a binding only when it can prove the complete field projection
and must display that inference in `plan` and `explain`. Ambiguous bare dependencies fail; broad access
is visible as `.all()`. Dependency removal or narrowing appears as an authority/deployment diff.
Here, `onEvent(...)` declares causal binding from the processor's current event; it does not register the
processor. `process(...)` remains the registration boundary.

The compiler records the exact returned key set, not a widened `Partial<OperationInput>`. Conditional
values are valid, but conditional keys, optional keys, unresolved spreads, computed keys, divergent
return branches, and unnormalizable helper results fail compilation. Generated aliases omit exactly the
bound keys, and untyped callers attempting to submit one fail before bound and unbound values are
merged.

Execution binding is terminal. Static restrictions come first:

```ts
Evidence.create
  .where((evidence) => evidence.classification.ne("secret"))
  .onInput((task) => ({
    sourceId: task.sourceId,
  }));
```

The base operation, optional `.on(ref)` or `.all()` target selector, every `.where()` predicate,
execution-derived complete input and target, workload envelope, and compatible grant always intersect.
No later operation can discard an earlier restriction, and a static/execution-derived conflict fails
closed.

## Command loop, explanation, and progressive disclosure

The generated package pins the released CLI and exposes one predictable lifecycle:

```sh
bun create applik8s my-product --start agentic
cd my-product

bun dev
bun test

bun applik8s plan
bun applik8s deploy
bun applik8s status
bun applik8s destroy
```

`dev` starts the upstream Vite/TanStack development experience plus only the credential-free starter
dependencies required by the application graph. The generated local installation selects the starter
profile, so the first loop requires no profile flag; explicit dedicated/external selection appears in a
later deployment tutorial. `plan` is effect-free and reports provider, workload,
authority, data-lifecycle, and destructive changes. `deploy`, `status`, and `destroy` operate through the
application graph, TypeKro, and Alchemy; they do not wrap generated imperative `kubectl` lifecycle
scripts. The same commands run from packed and published packages in acceptance.

Inference is explainable:

```sh
bun applik8s explain Source.observe
bun applik8s explain Source.observe --json
```

The explanation includes:

- source location, stable operation ID/revision, schemas, and declared errors;
- authoritative model/provider and selected profile qualification;
- direct/internal invocation paths and declared dependency aliases;
- transaction, outbox, task, workflow, processor, and external-effect boundaries;
- generated runtime placement, maximum workload envelope, public `ExecutionPrincipal`, bound
  input/target/scope, binding provenance, operation grants, and inferred Kubernetes RBAC;
- baseline, requestable, delegated, and approval-gated authority;
- HTTP, MCP, agent, workflow, event, query, and subscription bindings;
- generated images, workloads, TypeKro resources, Alchemy dependencies, and lifecycle/retention policy;
- every inferred default, its provenance, alternatives, and actionable warnings.

`explain` reads the same normalized application/deployment plan used by build and deploy. Human and JSON
outputs cannot be maintained by a parallel analyzer.

Profiles remain progressive disclosure. The generated `providers.ts` is complete, boring, and working,
but the first tutorial teaches only a model, conventional or named operation, static permission, route,
and local run. Tasks, agents, provider overrides, runtime permissions, dedicated/external profiles, and
stateful profile transitions are introduced only when their product need appears. The beginner never
has to author a profile to reach the first working application.

## Distribution boundary

The Start is:

- maintained module packages;
- reviewed default profile modules;
- a small generator overlay;
- operational and administration routes;
- example policies and application seams;
- deployment, recovery, and upgrade runbooks;
- complete live acceptance evidence.

The Start is not:

- a fork of Applik8s;
- a second application graph;
- a copied private runtime;
- a framework-owned tenant or user model;
- a new frontend router;
- a wrapper that hides operation, provider, or deployment boundaries;
- an opaque `agenticStart(...)` application constructor;
- a TanStack AI replacement facade.

The generic `StartDefinition`, profile DSL, generator extension protocol, and override mechanics belong
to the profiles-and-Starts RFP. This RFP supplies one concrete consumer:
`@applik8s/start-agentic`, its maintained modules, default profile modules, operations experience, and
acceptance applications.

## Required maintained modules

The first distribution supplies:

- TanStack AI client/server integration;
- native TanStack AI execution in authored agent closures;
- logical models, agents, and typed operation tools;
- conversations, messages, runs, and resumable run events;
- Hatchet workflows, schedules, waits, cancellation, and recovery;
- approvals, review queues, independent outcomes, and audit;
- artifacts and S3-compatible object references;
- evaluations, datasets, scorers, and result history;
- memory records with explicit scope and retention;
- usage, model cost, quotas, and entitlement seams;
- identity, OAuth, permissions, grants, sessions, and client administration;
- MCP server/client integration;
- named relationship-aware search indexes;
- first-run onboarding, safe non-secret configuration, local bootstrap, and a product/control-center
  shell derived from the pinned Stimp baseline;
- health, readiness, provider, lag, and recovery status;
- starter, dedicated, and external profile modules.

Organization/membership and billing integrations may be optional modules. Applications retain their
own schemas and policy.

The initial package boundaries should permit independent adoption and browser/server isolation:

```text
@applik8s/start-agentic
@applik8s/ai
@applik8s/ai-tanstack
@applik8s/runtime-envoy-ai-gateway
@applik8s/search
@applik8s/runtime-opensearch
@applik8s/mcp
@applik8s/identity
@applik8s/identity-ory
@applik8s/authorization
@applik8s/conversations
@applik8s/approvals
@applik8s/artifacts
@applik8s/evals
@applik8s/operations
```

Packages may initially be consolidated where their dependency zones and release cadence are identical.
The Start package composes them; it does not become the package that contains every provider SDK.

## Capability and ownership matrix

Before implementation, every required module must have an audited baseline, v0.7 delta, owner, and live
gate. The initial plan is:

| Capability | Starter default | Dedicated default | v0.7 ownership |
| --- | --- | --- | --- |
| Transactional database | PostgreSQL | CNPG PostgreSQL | Existing database capability plus profiles RFP |
| Analytical database | PostgreSQL analytical adapter | ClickHouse | Existing/qualified analytical provider plus profiles RFP |
| Event log and queues | JetStream | JetStream | Existing event/stream runtime; distribution qualification |
| Durable workflows | Hatchet | Hatchet | New TypeKro Hatchet lifecycle plus workflow-provider migration and AI/distribution qualification |
| Object storage | local S3-compatible provider | Rook/Ceph S3-compatible object storage | Existing object-intent capability; distribution qualification |
| Search | bounded PostgreSQL | OpenSearch | Search RFP |
| AI | deterministic or developer-supplied local provider | Envoy AI Gateway | AI RFP |
| Identity/OAuth | deterministic development providers | Ory | Identity/OAuth RFP |
| Authorization | canonical PostgreSQL authority | canonical authority plus qualified projections | Operation-authority RFP |
| MCP | in-process/HTTP development path | protected HTTP plus optional Envoy `MCPRoute` | MCP RFP |
| Application hosting | local Vite/TanStack Start | `ApplicationHost`, TLS, DNS, exposure | Existing hosting plus distribution qualification |
| Images | local cluster-compatible build path | qualified registry/adoption policy | Existing container/TypeKro lifecycle; distribution qualification |
| Operations UI | maintained local routes | same routes with production providers | Distribution RFP |

“Existing” is not evidence by assertion. The implementation scorecard must record the current package,
test, known limitations, required delta, and responsible RFP/issue for every row. Missing ownership blocks
the distribution rather than being repaired inside generated application code.

Hatchet is not yet lifecycle-complete under this matrix. Current compiler-authored Flux, CNPG, Helm,
NetworkPolicy, and KEDA resources must move into a released TypeKro composition before the Start can
claim the TypeKro/Alchemy deployment invariant. The scorecard must not mark Hatchet complete merely
because workflow execution already functions.

## Minimum operations UI

The v0.7 UI must provide real product paths for:

- conversations and active/completed runs;
- tool calls, approvals, artifacts, and evaluations;
- workflow queue, wait, retry, cancellation, and failure;
- identities, OAuth clients, permissions, grants, requests, uses, outcomes, and revocations;
- provider and installation readiness;
- event consumer lag and dead letters;
- search generation, lag, rebuild, validation, cutover, and failure;
- AI backend resolution, latency, tokens, cost, fallback, and redaction-safe diagnostics;
- MCP servers, clients, tools, denials, and latency;
- audit and causal timelines.

These routes live in maintained packages and use the same generated facades and typed operations as
application routes. They are not a privileged backdoor.

The UI must distinguish canonical application state, delivery state, provider state, and inferred
health. It must not report an operation, workflow, index, grant, or AI attempt successful merely because a
frontend request was accepted.

Every administration route is protected through the ordinary typed operation authority. A package route
cannot assume administrator access from path location, deployment namespace, or possession of an
operations cookie.

## Generated-source budget

The generator may copy only application-owned shell and example extension points. Release review must
record:

- generated file and line count;
- package-owned versus application-owned code;
- dependency count;
- browser/server bundle size;
- time from generation to first local page;
- time from generation to a ready starter installation.

Generated source must remain understandable in one maintainer review session. Large generated runtime,
registry, provider, auth, workflow, SSE, or deployment implementations fail the Start boundary.

The initial release budget is:

- at most 12 generated application-owned shell/configuration files before examples;
- at most 600 non-generated nonblank lines for the Start integration shell;
- no copied provider client, registry, workflow engine, auth service, event gateway, SSE runtime, or
  deployment reconciler;
- generated route trees, manifests, facades, and container contexts live under ignored build output;
- one command identifies which lines/files are application-owned versus package/generated.

Exceeding the numeric budget requires a maintainer-approved exception explaining why the code is
application policy rather than package responsibility.

## Generated project contracts

`src/app.ts` creates the application. `src/installation.ts` declares only the application-owned
installation schema. `src/providers.ts` selects Start profile modules and intentional overrides.
`src/modules.ts` explicitly imports and composes maintained modules one at a time.
`src/features/<feature>/` co-locates ordinary provider-native models, operations, events, workflows,
agents, indexes, permissions, MCP exposure, and route implementations. `src/routes/` contains only the
thin upstream-shaped route modules required by TanStack Start and imports those feature definitions.

The generated project must:

- use the official supported TanStack Start generator as its scaffold source;
- preserve a normal Vite/TanStack Start development and routing experience;
- preserve direct imports and use of TanStack AI's `chat`, tool, connection, persistence, interrupt, and
  React contracts in application code;
- work with framework-neutral Applik8s Vite/server and React packages underneath;
- import released packages, never workspace source paths;
- build browser, server, workflow, processor, and deployment artifacts through one documented command;
- deploy all inferred application and infrastructure dependencies through the Applik8s graph,
  TypeKro, and Alchemy;
- support removal of the Agentic Start package without reverse-engineering generated runtime internals.

## Default profiles

### Starter

- credential-free deterministic identity and AI, visibly non-production;
- PostgreSQL for transactional and compatible analytical/search roles;
- JetStream, local S3-compatible object storage, and Hatchet;
- one-node capacity appropriate for OrbStack;
- no claim of production durability or identity qualification.

Starter is the first-run profile, not a mock-only path. Canonical commands, outboxes, streams, workflows,
approvals, object intents, search projection, browser delivery, permissions, audit, and cleanup use their
real runtime contracts. Only external credentials and production infrastructure are substituted.

### Dedicated

- CNPG or another qualified transactional database;
- ClickHouse or another qualified analytical database;
- JetStream and qualified Rook/Ceph-backed object storage;
- Hatchet;
- OpenSearch;
- Envoy AI Gateway;
- Ory identity/OAuth and reviewed authorization projections;
- production exposure, TLS, DNS, backup, rotation, and retention.

Dedicated live evidence may use development credentials for an AI backend, but it must traverse the real
Envoy AI Gateway route and record that it is non-production evidence. Ory, OpenSearch, storage, workflow,
event, database, application-host, TLS, and DNS paths must be real.

## Evidence tiers and cluster budgets

The complete dedicated topology is intentionally too large and timing-sensitive to run as one opaque
gate on every pull request. Evidence is divided into:

1. **Per-change contract gates:** packed consumers, graph/plan snapshots, deterministic runtimes, browser
   boundaries, and affected provider tests.
2. **Provider qualification lanes:** each stateful or cluster-wide provider independently proves direct
   and KRO install, status, update, failure, recovery, retained-data policy, and deletion through
   TypeKro/Alchemy.
3. **Integrated Start lane:** the credential-free starter plus one reviewed dedicated composition proves
   cross-capability identity, authority, commands, events, workflows, AI, search, object storage, browser
   delivery, and cleanup.
4. **Release-candidate showcase:** the complete dedicated profile runs on a recorded cluster class before
   an RC/final release and on a schedule after release.

Every lane records CPU, memory, storage, install duration, readiness duration, cleanup duration, and
provider versions. The starter has a hard OrbStack resource ceiling. The integrated and showcase lanes
declare their minimum cluster class and fail as an unmet prerequisite rather than timing out
nondeterministically. Independent provider qualification may satisfy a module lifecycle gate, but the
release-candidate showcase must still prove the modules compose.

### External

- typed endpoint and Secret references;
- explicit ownership, capability, readiness, migration, backup, and deletion responsibility;
- no ambient credentials or provider-specific imports in domain/UI code.

Every external provider reports verified endpoint/capability readiness separately from ownership.
Deletion removes only application-owned projections, credentials, routes, and bindings.

## Vasco acceptance slice

The slice must prove:

1. A customer or agent registers a source through an authorized typed operation.
2. A Hatchet workflow retrieves content through a declared provider capability.
3. Raw evidence is stored through object storage with provenance.
4. An agent run proposes a normalized observation and extraction configuration.
5. A deterministic validator accepts, rejects, or requests approval.
6. Approval waits durably and resumes through a typed operation.
7. A short-lived grant is reserved and consumed at the protected boundary.
8. Canonical state commits in PostgreSQL and emits a durable transition event.
9. A named index follows source, observation, and entity relationships.
10. TanStack Start server-renders and live-requeries authorized evidence.
11. An MCP client searches evidence and requests a permitted observation.
12. Principal, agent definition, run identity, model attempt, workflow, grant, artifact, and outcome are
    visible in one causal timeline.
13. Exact tool-call replay within one physical attempt reuses its operation; another physical attempt
    cannot collide merely because the provider reused a tool-call ID.
14. Duplicate, replay, related change, history loss, rebuild, and index cutover are tested.
15. Concurrent source-observation task/processor executions share a stable workload identity but receive
    distinct execution principals; each can read or complete only its own bound source.

No acceptance step may manually insert application, outbox, index, grant, event, or audit records.
No acceptance step may replace an executable application closure with fixture-only metadata or bypass
the transaction/outbox/task boundary to make the demonstration shorter.

The Vasco slice must be created from packed public packages and the same Start generator available to a
clean consumer. Product-specific code may define sources, evidence, observations, validators, policies,
agents, and UI, but it may not import internal packages or replace a Start runtime module.

## Agentic identity acceptance slice

The slice must prove:

1. Kratos human registration/login and idempotent session admission, including callback retry and
   orphan-session reconciliation.
2. Hydra authorization code with PKCE for an MCP client, with consent performed only by an authenticated
   OAuth authorization-flow principal.
3. Selected client-credentials extension for a machine principal.
4. Typed protected application operations.
5. Static authority assigned to an identity or role.
6. Runtime permission composed from deployed operation handles.
7. Scoped grant assignment, reservation, consumption, expiration, and revocation.
8. Agent request for a production-sensitive operation with evidence and intended outcome.
9. Hatchet approval wait and human decision.
10. Short-lived audience-, operation-, target-, transport-, use-, and outcome-bound authority.
11. Invocation through MCP or HTTP without token passthrough.
12. Independent outcome observation and escalation.
13. Searchable audit and live administration UI.
14. Catalog migration while an older grant, durable command, and MCP catalog-pinned session exist.
15. Incompatible stateless MCP revisions coexist under versioned names or fail closed.
16. Denied, expired, revoked, consumed, replayed, wrong-audience, wrong-target, self-escalation, and
    confused-deputy cases.
17. A shared worker credential cannot use one task, processor, workflow, or reconcile execution
    principal to invoke an operation on another execution's target.

The identity slice is a separate generated application using the same Start and modules. This proves
that authority, Ory, MCP, workflows, search, and operations UI are reusable modules rather than
Vasco-specific code.

## CollectorBills and future-product conformance

Design fixtures must demonstrate that packages can represent:

- schedules and acquisition;
- agent-proposed configuration;
- approval and review;
- images and arbitrary artifacts;
- relational catalog state;
- analytical and search projections;
- usage and entitlement enforcement;
- operations and administration.

Flourishnplot is not a v0.7 acceptance application. The Start must nevertheless avoid assumptions that
all artifacts are text, every experience is chat, or every agent operates synchronously.

At least one conformance fixture must use an image or binary artifact and one scheduled/batch workflow so
the package contracts preserve non-chat and non-text applications.

## Stimp application baseline and migration boundary

The checked-in Stimp `agent-saas-starter`, its rendered example, onboarding/control-center experience,
generator contracts, package boundaries, and release verification are the concrete starting baseline for
the Agentic Start. Stimp is not merely an inspiration or comparison target: every baseline product
capability, generated-application responsibility, first-run behavior, extension seam, and release proof
must be preserved, deliberately improved, explicitly deferred, or explicitly rejected with a reviewed
reason.

The baseline revision is pinned in the v0.7 scorecard. The audit records at least:

- deterministic generation and template/rendered-example parity;
- non-interactive CLI automation and the optional rich terminal/control experience;
- release-package versus local-dogfood dependency modes;
- credential-free first start and optional-provider skipped/blocked diagnostics;
- upstream TanStack Start/Vite routing, SSR, hydration, and server-only module boundaries;
- agents, tools, workflows, events, approvals, artifacts, evaluations, conversations, inbox, memory,
  runs, causal timelines, and administration;
- local authentication/session, safe configuration, onboarding guide, control center, status, and
  bootstrap behavior;
- tenant, policy, billing, usage, and entitlement seams without making those product schemas core;
- database migrations, operational dashboards, production runbook, and provider/lifecycle status;
- TypeKro profile intent and generated deployment ownership;
- clean generated-app, HTTP, real-app, package-consumer, security, reliability, and optional-provider
  smoke evidence.

The Applik8s Start keeps that product baseline while replacing Stimp implementation authority:

- static registries become the application graph and explicit module composition;
- artifact-first generated source becomes feature-first application source with thin upstream route
  adapters;
- Inngest/Mastra authority becomes Hatchet and TanStack AI's bounded responsibilities;
- direct model-provider calls become logical AI and gateway providers;
- manual SSE becomes authenticated resumable delivery;
- copied runtime/auth/workflow/deployment implementations become maintained packages;
- string tool/identity lookup becomes typed operations and principals;
- fixture-grade identity becomes the provider-neutral identity/OAuth contract with deterministic starter
  and Ory dedicated implementations;
- custom TypeKro scaffolding becomes the application deployment graph lowered through TypeKro and
  Alchemy.

Stimp remains an executable baseline and migration fixture, not a runtime dependency. The implementation
must maintain:

1. a pinned baseline manifest mapping each Stimp capability and product path to its Applik8s
   package/model/operation/profile;
2. a generated Applik8s example that exercises the corresponding baseline paths;
3. automated parity at the behavioral/product-contract level rather than file-for-file source parity;
4. an explicit ledger of improved, deferred, and rejected Stimp behavior with rationale and replacement
   guidance.

No Stimp source is copied merely to preserve an internal API. Feature-first organization, public
Applik8s primitives, maintained packages, and the TypeKro/Alchemy lifecycle remain normative even where
Stimp's generated file topology differs.

## Release qualification

The Start RFP owns the integrated gates:

- fresh generation and install from packed packages;
- real browser SSR, hydration, streaming, authorization change, and requery;
- pod replacement for web, gateway, worker, workflow, indexer, and agent execution;
- complete starter deletion and documented retained data;
- dedicated dependency lifecycle and recovery;
- external-provider readiness and failure diagnostics;
- browser/server/provider dependency-zone inspection;
- security adversarial matrix;
- recorded build, bundle, latency, throughput, lag, cost, and resource-footprint history;
- generated-source and maintainer-DX review.

Foundational RFP tests are reused; this RFP does not copy their harnesses.

The release evidence includes a machine-readable compatibility manifest for every third-party boundary:

```text
package/chart/controller/container versions and immutable digests
CRD and wire-protocol revisions
Applik8s adapter and TypeKro composition revisions
supported profile/capability combinations
upstream conformance suite and last passing evidence
known incompatibilities, migration boundary, and rollback target
```

Unpinned beta ranges, ambient cluster versions, and “latest” charts or images cannot satisfy a release
gate.

The integrated product path is:

```text
browser or MCP intent
  -> admitted principal
  -> typed operation authorization
  -> durable command or workflow
  -> canonical model transaction
  -> committed event/outbox
  -> processors, index, artifacts, and audit
  -> authenticated live invalidation/delivery
  -> browser requery and rendered state
```

Both acceptance applications must prove this path without manual record creation or provider-side
shortcuts.

Release evidence records:

- generation, install, build, deploy, ready, update, recovery, and delete durations;
- generated shell and application-domain line counts;
- browser/server/workflow/processor/component bundle sizes;
- steady and peak CPU/memory/storage for starter and dedicated fixtures;
- command, workflow, AI attempt, index, permission, MCP, and live-query latency/throughput;
- queue, projection, revocation, and delivery lag;
- clean-cluster and retained-data outcomes;
- package and container provenance.

## Implementation increments

1. Pin and audit the Stimp `agent-saas-starter`, rendered example, generator, onboarding, and release
   evidence as the application baseline.
2. Publish the baseline manifest and improved/deferred/rejected migration ledger; audit the
   capability/ownership matrix, evidence tiers, cluster budgets, and unowned prerequisites.
3. Define package composition, dependency zones, generator contract, and generated-source budget.
4. Build the Start package and real starter profile from packed dependencies.
5. Package conversation, run, approval, artifact, usage, evaluation, and operations modules.
6. Package dedicated/external profiles and recovery runbooks.
7. Implement the Vasco slice without internal imports or manual state writes.
8. Implement the independent agentic identity slice and adversarial matrix.
9. Run integrated lifecycle, replacement, performance, supply-chain, and browser-boundary gates.
10. Conduct maintainer source/DX review and prepare the charter scorecard.

## Required gates

- A clean directory generates and builds from packed packages using the documented command.
- The scorecard pins a Stimp baseline revision and accounts for every baseline product capability,
  generated-app responsibility, first-run path, extension seam, and release proof as preserved,
  improved, deferred, or rejected.
- Behavioral parity proves credential-free start, safe configuration/onboarding, core agentic product
  paths, operations visibility, template/rendered-example consistency, and clean release consumption
  without requiring Stimp at runtime or copying its registry/runtime/deployment code.
- The generated integration shell remains within its source budget and contains no runtime copy.
- Generated `src/app.ts` uses the public `app(...)` constructor, and generated agent source calls
  TanStack AI directly through upstream contracts.
- The flagship agent visibly covers baseline, target-scoped, and approval-request authority for every
  declared operation tool; unreachable tools fail and non-tool authority remains an explainable
  informational diagnostic.
- Generated `src/modules.ts` imports every maintained module explicitly; removing one module does
  not require replacing `app(...)` or editing a generated registry.
- Generated application code is feature-first; no empty global `models/`, `operations/`, `events/`,
  `workflows/`, `agents/`, `indexes/`, or `permissions/` taxonomy is created.
- TanStack route files remain thin upstream-compatible adapters over feature-owned route behavior.
- Managed closures use the normalized subject/free/lifecycle/route/reconciler grammar; declared
  operation aliases lower to `context.invoke()` rather than creating another invocation system.
- `application.task(...)` is the task-definition golden path; reusable task contracts do not register a
  second task, and `context.tasks.*` aliases schedule the declared task handles.
- Task, workflow, processor, and reconciler dependency declarations generate only exact
  operation/input/target/scope workload grants, serialize them in graph/deployment plans, and never
  confer delegation, impersonation, alternate-transport, or ambient caller authority.
- Every task attempt, workflow run/step, processor delivery, and reconcile attempt receives a distinct
  execution principal; the same workload credential cannot use one execution to access another
  execution's target.
- `onInput`/`onEvent`/`onResource` fix typed operation-input fields from the enclosing execution, remove
  those fields from generated aliases, and lower to one serialized `ExecutionBinding`; callers cannot
  override bound fields.
- Generated examples infer every binding callback's task/event/resource type without annotations and
  infer each dependency alias as accepting only the remaining unbound fields.
- Generated and type fixtures prove exact-key capture independently of TypeScript widening; fixed keys
  with execution-varying values pass, while conditional/optional keys, unresolved spreads, computed
  keys, divergent branches, and unnormalizable helpers fail.
- Untyped and stale alias calls that supply a bound key fail before merge.
- `.on(ref)` and `.all()` are mutually exclusive, repeated `.where()` predicates intersect, execution
  binding is terminal, and the generated plan proves that no binding weakens a prior static
  target/scope.
- Dependencies use a proven inferred execution binding, an explicit binding, or visible `.all()`; a bare
  ambiguous dependency fails compilation.
- The documented create/dev/test/plan/deploy/status/destroy loop passes from packed packages, and
  deployment/destruction use the TypeKro/Alchemy lifecycle.
- `explain` human and JSON output derives from the real graph/plan and distinguishes maximum workload
  authority from effective per-execution authority while accounting for operation, provider, resource,
  and lifecycle consequences.
- The first tutorial reaches a working starter application without asking the author to edit or
  understand profile selection.
- Relational, CRD/resource, analytical, and framework entity acceptance models retain their native
  definitions while exposing the common operation, authority, event, and tool experience where their
  capabilities overlap.
- The CRD acceptance handler compiles and runs through the existing componentized operator path with
  inferred watch/RBAC/status behavior; it is not silently converted into a server or database handler.
- Model transaction closures contain no external effects; committed processors/tasks/workflows own AI,
  network, object-storage, and other external work.
- Every capability in the ownership matrix has a named owner and passing release evidence.
- Every provider qualification lane records its required cluster class and passes independently through
  TypeKro/Alchemy.
- Starter exercises real canonical, event, workflow, permission, object, search, and live-delivery
  contracts without production credentials.
- The release-candidate dedicated showcase deploys through TypeKro/Alchemy and uses the real CNPG,
  ClickHouse, JetStream, Hatchet, object-storage, OpenSearch, Envoy, Ory, hosting, TLS, and DNS
  integration paths.
- Browser artifacts contain no provider SDK, database client, Kubernetes client, Secret, token, or
  authorization implementation.
- Operations UI routes enforce the same typed authority as application routes.
- Adapted operation routes and raw route closures display and enforce their distinct authority semantics.
- Identity acceptance separates pre-authentication from authenticated OAuth consent and proves
  idempotent provider/local completion.
- MCP acceptance proves catalog-pinned sessions and versioned incompatible stateless revisions.
- AI acceptance proves physical-attempt-scoped tool-call idempotency and conflict rejection.
- Vasco and the identity application use only public packed packages and share maintained modules.
- At least one binary artifact and scheduled/batch conformance path passes.
- Pod replacement and retry do not lose committed work or duplicate protected/billable effects silently.
- Complete deletion uses the TypeKro/Alchemy lifecycle and leaves only explicitly retained, documented
  data.
- Recorded performance history includes cold start, throughput, latency, lag, contention, memory,
  storage, and cost-relevant signals.

## Open questions

1. Which evaluation and memory views are required for v0.7 versus optional maintained modules?
2. What minimum entitlement model avoids future replacement without turning the Start into a billing
   product?
3. Should Chirp remain a v0.6 regression application or also become a non-blocking Start conformance
   fixture?
4. Is ClickHouse required in every dedicated acceptance run, or may its complete provider qualification
   run separately while the product slices use PostgreSQL analytics?
5. Which local S3-compatible implementation best preserves object-intent semantics without making
   starter installation unreasonably heavy?

## Definition of done

This RFP is complete when a clean consumer can generate, understand, run, deploy, operate, recover, and
delete the Agentic Start; Vasco and agentic identity pass without privileged/manual shortcuts; and the
maintainer judges the authored application source succinct relative to the distributed behavior it
expresses. The capability matrix must contain no unowned or assertion-only capability, the generated shell
must remain within budget, every pinned Stimp baseline behavior must have an evidenced disposition, and
starter/dedicated evidence must prove the same public contracts at their declared capability levels.
Only the charter-level maintainer review may authorize `v0.7.0`.
