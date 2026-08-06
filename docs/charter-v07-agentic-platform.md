# Charter: Applik8s v0.7 — Agentic Starts, Typed Authority, Search, and AI Infrastructure

**Status:** Proposed program charter; maintainer approval authorizes bounded implementation RFPs, not
release tagging

**Audience:** Applik8s maintainers, RFP owners, Start authors, TypeKro contributors, provider-adapter
authors, and acceptance-application implementers

**Requested by:** The first Applik8s Agentic Start, Chirp, GuestBook, and the agentic identity and
authorization platform

**Revised:** 2026-07-31

**Target:** Applik8s v0.7. No release tag is authorized by this document. The release is complete only
after the required local, package-consumer, OrbStack, security, lifecycle, and acceptance-application
gates pass and the maintainer has reviewed the resulting developer experience.

## Charter authority and document map

This charter owns the v0.7 product thesis, cross-cutting invariants, complete release definition, program
sequencing, and final acceptance applications. It is deliberately broader than an implementation RFP.
Implementation authority is delegated to bounded RFPs:

| RFP | Owns | Must not own |
| --- | --- | --- |
| [`rfp-v07-function-native-execution.md`](rfp-v07-function-native-execution.md) | Function-native execution grammar, callable handles, workflow call/admission semantics, inline durable closures and steps, signal event contracts, canonical signal-store transaction/recovery protocol and callable one-shot decisions, frozen-batch acknowledgement, projection transformation and rebuild declaration, resource/run tracking, context capability consistency, and migration from dependency aliases | Operation authorization enforcement, workflow-provider history, provider-specific event transport, projection storage/convergence implementation, or provider-specific runtime semantics |
| [`rfp-v07-operation-authority.md`](rfp-v07-operation-authority.md) | Stable operation catalog, identities, permissions, grants, delegation, authorization receipts, enforcement, catalog rollout | Provider-specific identity UI, AI protocol, search storage |
| [`rfp-v07-profiles-and-starts.md`](rfp-v07-profiles-and-starts.md) | Schema-derived profiles, qualified DI, Start packaging, generator, deployment-profile transitions | Domain authorization semantics, provider runtime internals |
| [`rfp-v07-search-projections.md`](rfp-v07-search-projections.md) | Named `Index(...)` contracts, relationship hydration, synchronization, rebuild, typed search, OpenSearch provider | Canonical application writes, identity policy |
| [`rfp-v07-ai-runtime.md`](rfp-v07-ai-runtime.md) | Logical models, agents, TanStack AI adapter, durable AI attempts, Envoy AI Gateway provider | Durable workflow authority, permission issuance |
| [`rfp-v07-identity-and-oauth.md`](rfp-v07-identity-and-oauth.md) | Authentication flows, provider sessions, OAuth, Ory qualification, and admission into canonical principals | Canonical application grant semantics, MCP transport |
| [`rfp-v07-mcp.md`](rfp-v07-mcp.md) | MCP client/server transports, protocol-version policy, operation exposure, external tool trust, and optional Envoy routing | Authentication-provider flows, canonical application grant semantics, AI orchestration |
| [`rfp-v07-agentic-start-distribution.md`](rfp-v07-agentic-start-distribution.md) | Maintained agentic modules, generated shell, operations UI, Chirp, GuestBook, and identity acceptance slices | A second runtime, graph, router, or deployment engine |

An implementation RFP may refine syntax and internal package boundaries. It may not contradict this
charter's authority boundaries, add a competing source of truth, silently weaken a gate, or claim the
v0.7 release independently. Conflicts return to maintainer review and require a charter amendment or ADR.

The shared seams are exact:

| Shared contract | Authority | Consumer rule |
| --- | --- | --- |
| Model-first definition and qualified provider facets | Existing Applik8s model/resource core | `model()` is authoritative; profiles derive compatible relational, Kubernetes, analytical, index, or document facets without requiring a second field map or promotion ceremony. |
| Operation identity, executable operation handle, principal, and grant | Operation-authority RFP | Identity admits a principal; AI and MCP adapt the same handle; no consumer registers a parallel handler or principal shape. |
| Signal issuance events, actions, and access | Function-native execution RFP for static event contracts, the primary transactional database's internal `SignalStore`, transactional instance/access/event/outbox commit, one-shot callable decisions, recovery, and execution-family decoding; profiles RFP for primary-database qualification; operation-authority RFP for canonical issue, exact issuance-read and action operations, grants, receipts, and enforcement | `SignalStore` is canonical but not independently selectable; workflow history and brokers converge by idempotent receipt and outbox retry; projections receive inert references; `authorize` requires existing exact-read/action authority; `grantAccessTo` derives exact-instance read/action grants only after `canGrant`; client payload never establishes actor identity; event delivery is not resolution authority. |
| Frozen batch manifest and whole-batch acknowledgement | Function-native execution RFP | Event providers may choose transport and batching mechanics but must preserve stable admitted membership, idempotent identity, retry membership, and checkpoint ordering. |
| Authentication and OAuth state | Identity/OAuth RFP | Authentication produces an admitted canonical principal but does not mint application grants independently. |
| Projection authoring and rebuild declaration | Function-native execution RFP | Projection runtimes consume the pure source-to-write transformation and explicit replay or authoritative-snapshot rebuild authority without introducing another public authoring model. |
| Search document, synchronization, frontier, cutover, and convergence | Search RFP | The index is a rebuildable projection of compatible provider-native paths, never canonical model authority. |
| Kubernetes resource/workflow tracking | Function-native execution RFP | Generated CR status is canonical; workflow push indexes are rebuildable optimizations; workflow providers remain authoritative only for run history and execution. |
| Agent execution and TanStack AI adapter | AI RFP | Agent source contains the execution closure and calls TanStack AI directly; Starts configure it but do not wrap it in another agent runtime. |
| MCP transport admission and mapping | MCP RFP | MCP exposes or invokes existing operations and cannot change their execution or authorization boundary. |
| Generated product shell and maintained module selection | Agentic Start distribution RFP | Generated source imports modules explicitly and remains an ordinary editable Applik8s application. |

### Release train

The work lands as independently reviewable prerelease increments:

```text
0.7.0-alpha.1  operation catalog and catalog activation
0.7.0-alpha.2  typed authority and durable enforcement
0.7.0-alpha.3  profiles, qualified DI, and Start packaging
0.7.0-alpha.4  named search projections and provider runtimes
0.7.0-alpha.5  AI, agents, durable attempts, and MCP
0.7.0-alpha.6  Ory completion and Agentic Start product paths
0.7.0-rc.1     Chirp, GuestBook, and identity acceptance qualification
0.7.0          maintainer-authorized release after every charter gate
```

The ordering is dependency-driven, not a promise that every alpha contains only one RFP. Each increment
must integrate into the primary development line, preserve package-consumer installation, and leave a
reviewable scorecard. No alpha or release candidate weakens the rule that only the final maintainer review
authorizes `v0.7.0`.

## Executive summary

Applik8s is the low-level distributed-application framework: models, Kubernetes resources, operations,
events, workflows, projections, providers, generated runtimes, and deployment graphs. It should remain
closer to React or Svelte than to a complete application distribution.

Applik8s Starts are the convention-over-configuration layer above that framework. A Start combines
maintained packages, a small generated application shell, coherent defaults, deployment profiles,
operational UI, and complete live evidence for a particular application archetype. Starts are not
forked frameworks, a second application graph, or a large directory of copied runtime code.

v0.7 delivers the first such distribution: the **Applik8s Agentic Start**. It must be capable of
supporting:

- Chirp's relational, streaming, projection, analytics, workflow, approval, agent, and replay paths;
- GuestBook's minimal model/resource, lifecycle, live-view, and browser-requery path;
- an Auth0-like agentic identity and authorization platform built on provider-neutral identity,
  authorization, OAuth, workflow, MCP, search, and enforcement contracts;
- Stimp's current `agent-saas-starter` as the concrete application/product baseline, including its
  credential-free first run, onboarding/control center, conversations, agents, tools, durable
  workflows, approvals, artifacts, evaluations, usage, audit, administration, safe configuration,
  generated-example parity, and release gates, while CollectorBills adds scheduled and artifact-heavy
  conformance pressure;
- future artifact-heavy or collaborative applications such as Flourishnplot without making that
  product a v0.7 release gate.

The release has four architectural centers:

1. **One typed operation and authority model.** Existing model CRUD operations, named model/resource operations,
   queries, searches, subscriptions, workflow operations, HTTP routes, MCP tools, and Kubernetes
   admission operations become authorizable operation handles. Identities receive those handles
   directly. Static and runtime-created permissions and grants use the same canonical model.
2. **One agentic application substrate.** TanStack AI owns application-facing chat, typed tools,
   streaming, and React integration. Applik8s owns application models, durable state, admission,
   workflows, events, approvals, artifacts, audit, and usage. Hatchet remains the first durable
   `WorkflowEngine`. Envoy AI Gateway becomes the default infrastructure implementation beneath the
   provider-neutral AI contract.
3. **One relationship-aware search projection.** `Index(...)` derives a searchable document from
   typed fields and declared relationships across compatible provider-native models. The source model
   remains authoritative;
   PostgreSQL provides the bounded starter implementation, while OpenSearch is a rebuildable projection
   and the default dedicated `Search` provider.
4. **One coherent Start and deployment experience.** Schema-derived exhaustive profiles provide
   qualified capabilities through dependency injection. The Start supplies package-backed local,
   dedicated, and external provider modules. TypeKro and Alchemy continue to own Kubernetes resource
   composition, output ordering, lifecycle, and deployment effects.

The release must not turn the Applik8s core into an identity product, policy product, AI SDK, frontend
router, or SaaS tenancy framework. Provider-neutral contracts live in Applik8s; the Agentic Start chooses
reviewed defaults and packages a complete experience.

## Product thesis and terminology

The intended layering is:

```text
Applik8s primitives
  models, resources, operations, events, streams, workflows, projections,
  providers, compiler, runtimes, deployment graph
        |
        v
Applik8s modules
  AI, MCP, conversations, approvals, artifacts, evaluations, usage,
  authorization, search, operations UI, provider adapters
        |
        v
Applik8s Starts
  small generated shell + maintained packages + profiles + defaults +
  deployment + operational product experience
        |
        v
Chirp / GuestBook / agentic identity / future products
```

The public term is **Start**, not kit. The initial command should be:

```sh
bun create applik8s my-product --start agentic
```

The initial package should be named:

```text
@applik8s/start-agentic
```

The name describes an application distribution, not a new runtime authority. The Start reuses the
framework-neutral Vite, client, React, TanStack Start, Fetch gateway, compiler, TypeKro, and Alchemy
layers introduced before v0.7.

## Required outcome

A new application should be able to begin with:

```ts
import { app } from "@applik8s/applik8s";
import { type } from "arktype";

export const application = app("research-platform", {
  installation: type({
    name: "string",
    profile: "'starter' | 'dedicated' | 'external'",
  }),
});
```

The Start generator writes this ordinary application source. `@applik8s/start-agentic` contributes
maintained modules, profile modules, routes, and generator metadata; it is not an alternate
application constructor and does not hide the public Applik8s framework behind `agenticStart(...)`.
Generated applications import the maintained modules they actually use and may replace them one at a
time.

Model declarations remain authoritative while preserving their provider-native identity. Relational
models use the Applik8s model/field authoring surface, which produces an ordinary Drizzle table and
derives the ArkType runtime schemas:

```ts
export const Source = model("Source", {
  id: field.uuid().primaryKey(),
  observationState: field.text().notNull(),
});

export async function observeSource(input: ObserveSourceInput) {
  return Source.edit(input.sourceId, async (source, context) => {
    const requestId = context.id("observation");
    source.observationState = "queued";
    ObservationRequested.emit({
      requestId,
      sourceId: source.id,
      reason: input.reason,
    });
    return { requestId };
  });
}
```

The closure is transaction-authoritative: it may validate, derive, mutate declared transactional state,
and emit declared outbox work, but it may not call a network, start an ambient workflow, or perform
another external effect. A committed event processor, durable task, or workflow owns that later effect.

A Kubernetes-backed model keeps its ArkType resource definition and its existing typed Kubernetes
lifecycle experience:

```ts
export const SourceImport = application.crd("SourceImport", {
  apiVersion: "research.example.com/v1alpha1",
  spec: SourceImportSpec,
  status: SourceImportStatus,
});

SourceImport.on.reconcile(async resource => {
  const run = await observeSource.start({
    sourceUrl: resource.spec.sourceUrl,
  });
  await resource.track("observation", run);
});
```

Declare a logical service identity and an agent definition with those operations as tools. Deployment
derives a workload identity for the agent server, and each run receives an execution principal. The
execution closure uses TanStack AI directly:

```ts
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
      context: context.tanstack.execution,
      middleware: [
        withPersistence(context.tanstack.persistence),
      ],
    }),
);
```

Assign typed authority without stringly provider calls:

```ts
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

The exported agent handle is dual-runtime. Browser routes import the same symbol from the application
entrypoint and pass it to the TanStack connection; the Vite facade makes that value inert and
browser-safe:

```tsx
import { createApplicationTanStackConnection } from "@applik8s/ai-tanstack/client";
import { SourceResearcher } from "../../application";

const connection = createApplicationTanStackConnection({
  agent: SourceResearcher,
});
```

Applications do not repeat an agent name in `forwardedProps` or route configuration. The framework
owns that lowering and keeps the authored agent closure, provider configuration, and workload authority
out of the browser graph.

Build a search projection from existing model columns:

```ts
export const EvidenceSearch = Evidence.index(
  "search",
  Evidence.title,
  Evidence.body,
  Evidence.source.name,
  Evidence.observation.subject.canonicalName,
);
```

Expose existing operations over HTTP and MCP:

```ts
application.http("api", (http) => {
  const Administration = http.group("administration", {
    prefix: "/admin",
  });

  Administration.get(
    "evidence",
    "/evidence",
    EvidenceSearch.search.http(),
  );
  Administration.post(
    "observe-source",
    "/sources/:sourceId/observe",
    Source.observe.http(),
  );

  Administrator.can(Administration);
});

application.mcp("research", {
  tools: [
    EvidenceSearch.search,
    Source.observe,
  ],
});
```

The application must not import OpenSearch, Ory, Hatchet, Envoy AI Gateway, TypeKro, Kubernetes clients,
or provider credentials in its domain models, routes, agents, or UI.

### Authoring and execution invariants

Every bounded RFP and generated example must preserve these source-level invariants:

1. **Model-first, single-definition authority.** Fields, identity, relationships, and boundary types are
   defined once through `model()`. Typed assembly bindings derive provider-native relational,
   Kubernetes, analytical, index, or document representations. Native provider schemas remain explicit
   escape hatches for unsupported features, not a required promotion ceremony.
2. **One convergent model experience.** CRUD, named operations, lifecycle events, references, queries,
   authority, tools, and audit use the same concepts wherever the backing provider can supply their
   guarantees. Provider-specific behavior remains an explicit refinement.
3. **Colocated executable closures.** Model changes, event processors, workflow steps, routes,
   reconcilers, and agents show their ordinary TypeScript implementation closures at their declaration
   site. Handler-free metadata examples are incomplete unless the section is deliberately describing
   metadata only.
4. **Execution boundaries remain honest.** Transaction closures cannot perform external effects;
   workflows coordinate only declared durable work; steps and processors receive only inferred or declared
   capabilities. Convenience syntax may shorten a boundary but may not erase or weaken it.
5. **Function-native behavior.** Ordinary code invokes `Model.create(...)`, ordinary imported domain
   functions, `Workflow.start(...)`, or another returned typed handle. “Operation” is internal
   authority/catalog vocabulary; there is no public `.operation()`/`.action()` registry, `$model`-first
   golden path, or string lookup API.
6. **TanStack AI remains visible.** Agent closures call TanStack AI's `chat()` and use its native
   message, tool, streaming, interrupt, connection, persistence, and React contracts. Applik8s supplies
   adapters, authority, placement, durability, and deployment; it does not publish a competing chat/tool
   facade.
7. **Starts generate editable applications.** A Start is generator input plus maintained packages and
   profile modules. It does not replace `app(...)`, conceal the application graph, or make generated
   projects depend on an opaque Start runtime.
8. **One invocation model.** Application entrypoints and managed closures invoke statically reachable
   imported handles directly. The compiler lowers those calls through the same normalized
   `ExecutionBinding` and internal invocation primitive; `context.invoke(...)` is runtime machinery, not
   the public authoring model. Dynamic, reflective, unresolved, or authority-widening calls fail
   compilation. Compatibility aliases may lower to the same primitive during migration but are not the
   golden path.
9. **One closure grammar.** Model mutations are ordinary functions containing
   `Model.edit(key, transactionClosure)` or a conventional CRUD `beforeCommit` callback. Transactional
   facts use `Event.emit(...)`; nested model commands use the explicit lint-safe
   `void Command(...)` staging form and may not be awaited before commit. Free queries, workflow steps,
   and agents receive `(input, context)`; lifecycle observers receive `(event,
   context)`; raw routes receive `(request, context)`; and the golden-path
   `Resource.on.reconcile(resource => ...)` closure receives the typed
   resource proxy whose status, resources, finalizers, events, tracking, and
   requeue facets record its operation plan. The explicit SDK
   `Resource.on.context.reconcile((resource, context) => ...)` form remains
   available when a handler genuinely needs the lower-level context API; it
   is not a second registration authority. Typed event facts retain their
   provider-native fields. Ordinary errors thrown by a conventional CRUD
   `beforeCommit` policy are framework-owned durable policy rejections, not broker-retried infrastructure
   failures; the framework preserves retries for database concurrency failures without asking authors to
   classify either case.
10. **Dependencies become two-level least-privilege authority.** Statically reachable handle calls and
    any explicit fail-closed maximum envelope define the generated workload identity's maximum
    operation, input, target, scope, audience, and transport authority. Each admitted input, event,
    workflow step, or reconcile attempt receives a distinct `ExecutionPrincipal` narrowed to its
    concrete inputs, targets, and scopes. Neither level grants delegation, impersonation, alternate
    transport, or undeclared-operation authority; both are serialized in the application graph,
    deployment plan, receipts, and audit.
11. **Generated source is feature-first.** Maintained modules are imported explicitly, domain behavior
    is colocated by feature, and upstream route files remain thin. Empty global artifact taxonomies are
    not generated.
12. **Profiles are progressive disclosure.** Generated profile modules are complete and editable, but
    the first tutorial requires no profile knowledge. The same normalized graph and deployment plan
    power `plan`, `deploy`, `status`, `destroy`, and human/JSON `explain`.
13. **Resources own reconciliation.** Application-owned Kubernetes models register continuous behavior
    with `Resource.on.reconcile(handler)`. The framework infers and replays the generated operator,
    watch, namespace, workload identity, RBAC, closure bundle, and callable-handle authority. The
    redundant `app.reconcile(Resource, handler)` and `app.on(Resource, ...)` APIs are not part of
    v0.7. Multiple `Resource.on.*` callbacks share one inferred controller; advanced placement or
    explicit SDK RBAC is resource configuration, not a second behavior-registration surface. Public
    controller types use resource-owned names (`ApplicationResourceControllerOptions` and
    `ApplicationResourceEventHandler`); application-centric reconciliation aliases are removed.
14. **Modules are callback-native feature boundaries.** Reusable features use
    `module(name, setup)` or the explicit-schema overload and return an ordinary
    plain object. The framework validates, freezes, and includes that exact
    inferred value once per application. Dummy throwing installers, a second
    public `install()` callback, user-written `Object.freeze(...)`, mutable
    registries, and reachability-derived authority are not part of the v0.7
    authoring model. `defineApplicationModule(...)` is compatibility machinery
    during the transition, not the documented golden path.

## Existing functionality that must be reused

| Capability | Existing behavior to preserve |
| --- | --- |
| Application graph | Provider, model, command, event, stream, query, workflow, resource, artifact, and deployment nodes and edges remain the only application graph. |
| Model behavior | Models already derive direct `create`, `update`, `delete`, lifecycle, and completion-stream surfaces; v0.7 makes additional behavior function-native. |
| Durable commands | Principal, trusted context, authorization version, idempotency, target ordering, durable result, retry, outbox, progress, and recovery remain authoritative. |
| Workflows | Provider-neutral `workflow()` definitions, explicit durable steps, and the Hatchet runtime remain the durable orchestration foundation. |
| Events and streams | Transactional outboxes, JetStream delivery, replay, processors, subscriptions, and checkpoints remain the event foundation. |
| Public queries | Query contracts, bounded snapshots, context-scoped cursors, invalidation, SSE resume/reset, and browser requery remain authoritative. |
| Relational models | `model()` derives a Drizzle-compatible relational facet with shared schema, identity, relations, changes, and transactions. |
| Kubernetes models | `model()` with a Kubernetes binding retains typed lifecycle, reconciliation, status, reference, and query behavior. |
| Kubernetes resources | CRDs retain typed operations, reconcile handlers, status authority, watches, finalizers, and inferred Kubernetes RBAC. |
| Vite and TanStack Start | Framework-neutral browser/server facades, Fetch gateway, React stores, SSR hydration, and the first-party TanStack adapter remain layered. |
| Provider DI | `provide()` remains the provider-binding mechanism; no configuration registry replaces it. |
| Deployment | TypeKro materializes Kubernetes compositions; Alchemy performs effect ordering, state, adoption, and destruction. |
| Ory infrastructure | The released TypeKro Ory charts, compositions, Maester resources, local platform profile, status, and direct/KRO lifecycle are extended rather than duplicated. |
| Application hosting | `ApplicationHost` continues to own immutable web artifacts, Deployment, Service, health, RBAC, exposure, and status. |

This charter must not introduce another command bus, workflow engine, policy graph, search synchronization
daemon, provider registry, HTTP gateway, browser protocol, application router, Kubernetes deployment
engine, or identity database.

## Normative decisions

The implementation must preserve these decisions unless a reviewed ADR demonstrates an equally simple
and safer alternative.

1. **Starts are distributions, not forks.** A Start composes the public Applik8s graph and maintained
   packages. It does not create a second compiler, graph, runtime authority, or deployment language.
2. **Generated projects remain small.** Runtime implementations, auth adapters, UI primitives, workflow
   support, and operations pages live in versioned packages rather than hundreds of copied source files.
3. **The official TanStack Start generator remains the scaffold source.** The Start layers Applik8s onto
   an upstream project instead of maintaining a competing router/build scaffold.
4. **One model and relationship graph is shared.** Drizzle relationships and ArkType-backed typed
   references serve queries, invalidation, index hydration, permission scopes, and generated facades.
5. **Existing operations are extended.** v0.7 adds authorization behavior to current CRUD, named model/resource operation, query,
   workflow, route, and subscription handles. It does not create a parallel `secureAction()` API.
6. **An operation handle is the permission unit.** A typed operation automatically identifies its
   required authority. Explicit permission definitions group operations or add reusable policy semantics.
7. **Operations are assigned directly to identities.** `Administrator.can(User.disable)` is the ordinary
   API. String operation names are confined to serialized manifests and provider adapters.
8. **Tool knowledge and execution authority are distinct.** Listing an operation in an agent's tools makes
   the operation available to the model; it does not grant the identity permission to invoke it.
9. **Static and runtime permissions share one model.** Manifest-authored and runtime-authored permission
   definitions and grants are queryable, auditable, versioned, and enforced by the same authority.
10. **Permission administration is protected by operations.** Creating permissions, assigning grants,
    delegating authority, extending grants, and revoking grants are ordinary protected model operations.
11. **Possession does not imply delegation.** An identity may grant an operation only when it has explicit,
    scope-compatible delegation authority.
12. **Lifecycle-bound grants are authoritative.** Relational model/grant changes commit transactionally
    where possible. Kubernetes-backed resources use idempotent status and finalizer state machines and
    do not pretend to offer cross-database atomicity.
13. **External policy stores do not create a split brain.** PostgreSQL owns application lifecycle grants;
    Keto or Casbin may supply relationship/policy decisions or enforcement projections under explicit
    version and revocation guarantees.
14. **Events are facts, not operations.** Publishing follows an authorized transaction. Internal processors
    run as workload identities and retain the initiating principal only as causal audit context.
15. **Transport is a permission constraint.** HTTP, MCP, workflow, and control-plane selectors may grant
    an operation only through a particular invocation surface without broadening every transport.
16. **Routes are named operation handles.** The normative declaration API is
    `get(name, path, handler)` / `post(name, path, handler)` so every route has stable identity independent
    of its current path. Route selection lives under `http.match`; the historical
    `get(path, handler)` / `post(path, handler)` overloads are compatibility-only and must not appear in
    new examples.
17. **Route globs are compile-time selectors.** `*` matches one path segment and `**` matches descendants.
    Empty, ambiguous, or invalid selectors fail compilation.
18. **Raw routes do not become confused deputies.** Permission to invoke a route does not grant every
    protected downstream operation its handler may call. Explicit nested invocation reauthorizes.
19. **Kubernetes RBAC is not application authorization.** The current Kubernetes permission-rule type is
    renamed to make the distinction explicit.
20. **Control-plane reconciliation runs as a workload.** Direct Kubernetes mutation uses Kubernetes
    authentication/RBAC plus an optional generated application admission webhook. Reconcilers do not
    reconstruct a human identity from a later watch event.
21. **Durable operations revalidate authority.** The operation declares whether authority is checked at
    admission, execution, protected step, or commit. Mutations default to admission plus pre-commit
    revalidation.
22. **Dynamic policies use a bounded DSL.** Runtime permissions may compose deployed operation references,
    model references, relationship scopes, declared predicates, validity, use, approval, and outcome
    constraints. They may not persist arbitrary JavaScript or unreviewed CEL as authorization code.
23. **Unknown or retired operations fail closed.** Runtime permissions reference stable operation IDs.
    Operation removal or incompatible scope evolution requires migration.
24. **The core does not own tenancy.** A Start may provide tenant, organization, membership, entitlement,
    and billing modules, but the application owns their domain schemas and policy.
25. **Authority owns principals; identity owns authentication.** The operation-authority layer defines
    canonical `Principal` and `IdentityReference`. Provider-neutral identity/OAuth adapters own login,
    provider sessions, credentials, and admission into those contracts; MCP admits its transport into the
    same principal model. The core does not own product users.
26. **TanStack AI is the application-facing AI layer.** It owns chat/tool protocol, streaming, and React
    integration. Its persistence contracts are backed by ordinary provider-native product models; it
    does not become the durable workflow or product-data authority.
27. **Hatchet remains durable workflow authority.** Long waits, retries, schedules, approvals, child work,
    cancellation, and compensation execute through the `WorkflowEngine`.
28. **Envoy AI Gateway is infrastructure.** Logical models, provider routing, credentials, rate limits,
    telemetry, redaction, and MCP routing lower through a provider adapter. Envoy CRDs do not enter
    application-facing AI types.
29. **AI providers are selected by capability.** Agents request logical models with typed capabilities,
    not vendor model names scattered through domain code.
30. **Search indexes are projections.** PostgreSQL, Kubernetes, or another declared source remains
    canonical. OpenSearch is rebuildable and may lag.
31. **A named `Index(...)` is the fundamental search primitive.** A model-bound `.index(name, ...)` may
    remain shorthand, but every index has an explicit stable name and the standalone primitive honestly
    represents projections spanning model relationships.
32. **An index has one root identity.** The first root identity column establishes document identity and
    cardinality. One-to-many paths require explicit aggregation.
33. **Index synchronization uses committed changes.** Application code never dual-writes canonical state
    and OpenSearch.
34. **Search authorization is admission scoped.** Mandatory principal/context filters are injected and
    cannot be overridden by user query input. OpenSearch document security is defense in depth.
35. **Profiles are schema-derived and exhaustive.** Provider choices are selected from discriminated
    installation variants without repeated raw string comparisons.
36. **`provide()` and injection remain code.** Starts may provide profile modules and qualified defaults;
    `app.select()` remains a lower-level value-expression escape hatch.
37. **Provider selection is graph visible.** Each profile branch records provider nodes, dependencies,
    resources, status, credentials, lifecycle, and transition policy.
38. **TypeKro integrations are reviewed dependencies.** OpenSearch and Envoy AI Gateway support must land
    in released TypeKro versions with direct and KRO live lifecycle evidence before v0.7 consumes them.
39. **Alchemy remains the deployment effect layer.** Applik8s must not regain handwritten provider
    deployment, ordering, adoption, or deletion machinery.
40. **All browser boundaries fail closed.** Provider SDKs, secrets, policies, tokens, ORM implementations,
    TypeKro resources, Kubernetes clients, and AI gateway configuration stay server-only.
41. **A release requires real product paths.** Mock-only agent calls, manually inserted search documents,
    manually completed grants, or infrastructure-only readiness do not satisfy v0.7.
42. **Agent definitions are not execution principals.** An agent definition owns instructions, model,
    and tool knowledge. A logical `ServiceIdentity` owns reusable baseline authority, a deployed
    `WorkloadIdentity` authenticates the runtime and caps its dependency envelope, and every concrete
    agent run receives a distinct admitted `ExecutionPrincipal` with causal and delegated authority.
43. **Operation catalogs activate explicitly.** A new catalog is staged and migration-checked before it
    admits work. Prior revisions drain or fail closed under recorded compatibility; rolling deployments do
    not silently reinterpret grants or durable commands.
44. **Bounded grant uses are serialized.** Maximum-use grants reserve uses transactionally. Idempotent
    retry reuses a reservation, and uncertain external effects do not silently restore one.
45. **Outcomes are independently observed.** A protected operation cannot prove its own required outcome.
    Outcome-bound grants name a deterministic or separately authorized verifier.
46. **AI attempts are durable billable effects.** Workflow retry does not imply safe model-call retry.
    Every logical invocation and provider attempt is recorded, and uncertain completion requires declared
    recovery or escalation.
47. **Indexes have explicit stable names.** Export variable names and source locations never become index
    identity. Relationship field aliases are explicit when inference is ambiguous or colliding.
48. **Models preserve native authority.** Drizzle tables, ArkType-backed CRDs/resources, analytical
    model/projection definitions, and existing framework entity models are promoted rather than
    translated into a replacement universal model schema.
49. **Executable closures are the authored unit.** Public examples colocate implementation closures with
    model operations, processors, tasks, workflows, routes, reconcilers, and agents. Generated manifests
    may normalize them, but application source does not become handler-free configuration.
50. **Transaction and external-effect closures are distinct.** A transactional model operation commits
    canonical state and outbox facts. Network, AI, object-storage, Kubernetes, or other external work
    executes later through a declared processor, task, or workflow boundary.
51. **TanStack AI is integrated, not hidden.** `@applik8s/ai-tanstack` returns and implements upstream
    TanStack contracts. Application agent closures import and call TanStack AI directly; Applik8s does not
    introduce `AI.chat(...)`, `useApplik8sChat(...)`, or a parallel tool protocol.
52. **A common facet does not imply a common runtime.** Relational operations retain database
    transactions and committed outboxes; CRD/resource operations retain Kubernetes admission,
    optimistic concurrency, status, watches, finalizers, and RBAC; analytical models retain ingestion,
    checkpoint, aggregate, and rebuild contracts. Unsupported facets are absent or fail graph
    construction rather than being emulated with weaker semantics.
53. **An adapted route is a transport binding, not another operation.** Granting an adapted route or a
    group containing it authorizes the underlying operation only through that binding. A raw route
    closure remains its own operation and reauthorizes nested protected work.
54. **Unproven revocation obligations do not age out.** A tombstone ends only after observed
    neutralization or guaranteed expiry of a provider-enforced, non-renewable maximum lifetime.
    Break-glass transfers unresolved evidence; it does not erase it.
55. **OAuth consent requires an authenticated resource owner.** Pre-authentication flow principals may
    register, login, verify, or recover. A distinct OAuth authorization-flow principal binds the admitted
    human, client, redirect, scopes, resource, audience, and authorization request.
56. **Authentication completion is choreographed, not cross-provider atomic.** Provider completion,
    local flow consumption, admission receipt creation, callback retry, and orphan-session cleanup use
    stable identities and idempotent recovery.
57. **Profiles do not invent a query language.** They bind existing declared view, query, search, and
    resource operations to qualified capabilities. Native provider APIs remain inside bounded operation
    closures.
58. **AI tool-call identity includes the physical attempt.** Provider call IDs cannot deduplicate across
    attempts without explicit application policy.
59. **MCP schema compatibility is explicit.** Stateful sessions pin a catalog revision; incompatible
    stateless revisions use versioned tool names or a negotiated catalog extension. Tool name and
    arguments alone cannot reveal a client's cached schema revision.
60. **Internal calls are statically discovered dependencies.** Managed closures call imported handles
    directly. The compiler proves the handle, complete input mapping, target, call site, and bounded
    authority before lowering through the internal invocation primitive. Dynamic or unresolved calls
    fail compilation; compatibility aliases do not define a second invocation model.
61. **Workload identity is an envelope, not a delivery principal.** Declaring a task, workflow,
    processor, or reconciler dependency grants only its generated workload identity the maximum
    operation/input/target/scope envelope required to authenticate the runtime. Each delivery executes
    under
    the public `ExecutionPrincipal` contract, with a diagnostic task/workflow/processor/reconcile kind
    and fields narrowed from validated input/event/resource bindings. Neither level imports caller
    authority or implies delegation, impersonation, or access through another transport.
62. **Public closure roles are normalized.** Subject operations, free work, lifecycle observations, raw
    routes, and reconcilers use the charter closure grammar consistently; convenience APIs may not invent
    competing handler signatures.
63. **Generated applications are feature-first.** Starts do not generate empty global directories for
    every framework artifact. Maintained modules remain explicit in `modules.ts`, domain behavior
    is colocated under `features/<feature>/`, and upstream route files remain thin adapters.
64. **The command loop is complete and graph-native.** Create, dev, test, plan, deploy, status, and
    destroy work from packed packages. Deployment and destruction use TypeKro and Alchemy rather than
    generated imperative lifecycle scripts.
65. **Explanation is not a parallel analyzer.** `applik8s explain` renders the same normalized graph and
    deployment plan used by build and deploy, including operation identity, authority, dependencies,
    maximum workload envelope, effective execution-principal bindings, providers, resources, lifecycle,
    inference provenance, and diagnostics.
66. **Profile knowledge is not a beginner prerequisite.** The generated profile modules remain editable
    and exhaustive, but the first successful local application path does not ask the author to select or
    configure a profile.
67. **Stimp is the application baseline, not merely inspiration.** The pinned `agent-saas-starter`,
    rendered example, onboarding/control center, generator and package contracts, product paths, and
    release gates receive an evidenced preserved/improved/deferred/rejected disposition. Applik8s
    replaces Stimp plumbing and artifact-first source organization without silently reducing the
    generated application's usefulness or day-two operability.
68. **Execution-binding keys are exact, not widened approximations.** Values may vary by execution, but
    every reachable projection branch must return the same statically proven key set. Conditional keys,
    unresolved spreads, computed keys, and unnormalizable helper results fail compilation. Generated
    aliases omit exactly those keys, and runtime callers attempting to supply one fail before merge.
69. **Authority composition is monotonic.** Target selectors, static predicates, execution-derived
    inputs/targets, workload envelopes, and compatible grants always intersect. Execution binding is
    terminal and cannot replace or weaken a preceding `.on()`, `.all()`, or `.where()` restriction.
    Conflicts fail closed, and the normalized plan preserves every constituent restriction.
70. **External profile namespaces are external lifecycle boundaries.** The selected workload namespace
    must pre-exist and survives application destruction because it is allowed to contain externally
    supplied provider credential Secrets. Application-generated runtime Secrets remain individually
    application-owned; no separate namespace-ownership option is exposed.

## Developer experience

### Schema-derived profiles

Installation variants should be a discriminated schema:

```ts
const CommonInstallation = type({
  name: "string",
  hostname: "string",
});

const StarterInstallation = type({
  profile: "'starter'",
});

const DedicatedInstallation = type({
  profile: "'dedicated'",
  lifecycle: {
    databaseDeletion: "'retain' | 'delete'",
  },
});

const ExternalInstallation = type({
  profile: "'external'",
  providers: {
    database: {
      connectionSecretName: "string",
      connectionSecretKey: "string",
    },
    analytics: {
      endpoint: "string",
      credentialsSecretName: "string",
    },
    search: {
      endpoint: "string",
      credentialsSecretName: "string",
    },
    ai: {
      endpoint: "string",
      credentialsSecretName: "string",
    },
  },
});

export const InstallationSpec = CommonInstallation.and(
  StarterInstallation
    .or(DedicatedInstallation)
    .or(ExternalInstallation),
);
```

The profile binder derives variants from that schema:

```ts
const deployment = application.profile(
  application.installation.spec,
  "profile",
);
```

Provider qualifications are branded values written once:

```ts
const PrimaryDatabase = TransactionalDatabase.named("primary");
const AnalyticsDatabase = AnalyticalDatabase.named("analytics");
const AuditSearch = Search.named("audit");
const InferenceGateway = AI.named("inference");
const PrimaryIdentity = IdentityProvider.named("primary");
```

Profile provision is exhaustive and branch narrowed:

```ts
const database = deployment
  .provide(PrimaryDatabase)
  .starter(() =>
    Database.postgres({
      provider: CNPG,
      database: "application",
      instances: 1,
    }),
  )
  .dedicated((dedicated) =>
    Database.postgres({
      provider: CNPG,
      database: "application",
      instances: 3,
      deletionPolicy: dedicated.lifecycle.databaseDeletion,
    }),
  )
  .external((external) =>
    Database.externalPostgres({
      connection: {
        secretName: external.providers.database.connectionSecretName,
        key: external.providers.database.connectionSecretKey,
      },
    }),
  )
  .exhaustive();
```

The result is an injected provider-neutral handle. Another module may request the same qualifier:

```ts
const database = application.inject(PrimaryDatabase);
```

The compiler must reject missing, duplicate, ambiguous, or incompatible profile providers. Adding a new
installation variant must make every exhaustive provider selection fail type checking until handled.

### Type-safe storage binding

Qualifications identify a logical role; capability types describe what that role may provide. Models do
not select a database through provider names or string matching:

```ts
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
  .external((external) =>
    Analytics.externalClickHouse({
      connection: external.providers.analytics,
    }),
  )
  .exhaustive();
```

Provider selection binds the single authoritative model declarations:

```ts
provide(OperationalData, database)
  .models(Account, CredentialLink, Post);

provide(AnalyticsData, analytics)
  .models(UsageFact, TimelineThroughput);
```

The distinction is semantic rather than a provider enumeration:

- a `TransactionalDatabase` must support transactions, relational constraints, authoritative changes,
  and the command/outbox contract;
- an `AnalyticalDatabase` must support the declared analytical query and projection capabilities;
- a provider may implement more than one capability, which is why the starter profile may use PostgreSQL
  for both roles;
- ClickHouse may satisfy the analytical role but cannot be bound to an authoritative model that requires
  transactional command semantics;
- a model may expose storage-neutral read/query operations while provider-specific advanced operations
  require an explicit capability refinement.

This gives profiles freedom to switch implementations without allowing an invalid provider to satisfy a
model accidentally. The application graph records the logical qualification, concrete implementation,
model binding, migration/transition policy, and dependency edges.

### Start provider modules

The generated application should not repeat every capability selection. The Agentic Start supplies
reviewed modules:

```ts
deployment
  .starter(AgenticLocalPlatform)
  .dedicated(AgenticDedicatedPlatform)
  .external(AgenticExternalPlatform)
  .exhaustive();
```

The modules provide qualified capabilities such as:

```text
PrimaryDatabase
AnalyticsDatabase
EventLog
WorkflowEngine
Search
AI
ObjectStorage
IdentityProvider
OAuthAuthorizationServer
AuthorizationAuthority
AccessGateway
ApplicationHost
```

Applications can replace one provider without copying the profile:

```ts
deployment.dedicated.override(
  AuditSearch,
  Search.openSearch({
    nodes: 5,
    storage: "500Gi",
  }),
);
```

The starter profile must be credential-free and runnable on OrbStack. Deterministic local AI and identity
implementations are permitted only in that explicit profile and must be visibly marked non-production.

## Unified operation model

### Existing operation extension

The common operation contract should gain an authorization facet:

```ts
interface AuthorizableOperation<TInput, TOutput, TTarget = unknown> {
  readonly authority: OperationAuthorizationContract<TTarget>;
  readonly permission: OperationPermission<this>;

  requires(permission: PermissionDefinition): this;
  public(): this;
  on(target: ModelReference<TTarget>): ScopedOperation<this>;
  where(scope: ModelScopePredicate<TTarget>): ScopedOperation<this>;
  authorize(options: AuthorizationLifetime): this;
}
```

The implementation must extend:

- `ApplicationMutationOperation`;
- `ApplicationModelMutationOperation`;
- `ApplicationQueryOperation`;
- search and subscription operations;
- workflow start, signal, result-read, and cancellation operations;
- route and route-set handles;
- MCP tool exposure handles;
- Kubernetes resource create/update/delete admission operations.

The v0.6 model action semantics remain valid after lowering to the canonical v0.7 operation catalog.
Application authors export ordinary functions or use the model's typed CRUD/edit methods; they do not
maintain a second `.operation(...)` registry. Existing native-model CRUD operations receive the same
authority behavior without a new declaration.

### Default-deny reachability

An externally reachable operation must be one of:

- explicitly `public()`;
- assigned statically to at least one identity, role, permission, or transport group;
- grantable through a declared runtime permission template;
- protected by an explicitly supplied application authorization policy.

Unclassified exposed operations fail the production build. Health and readiness endpoints are explicitly
public and limited to non-sensitive status.

### Stable operation catalog

Every operation receives a stable reference:

```text
applik8s://models/Application/operations/deploy
applik8s://models/Application/operations/update
applik8s://queries/EvidenceSearch/search
applik8s://workflows/Observation/start
applik8s://http/api/POST/admin/sources/:sourceId/observe
```

The catalog records:

- operation ID and version;
- target model/resource and identity schema;
- input, output, and declared errors;
- transport aliases and constraints;
- required permission;
- authorization lifetime;
- grantability and delegation policy;
- handler/runtime placement;
- deprecation or replacement metadata;
- browser/server visibility;
- emitted events and effects where declared.

Renames require explicit replacement metadata attached to the exported function:

```ts
export const deployVersion = replaces(Application.deploy, async function deployVersion(input) {
  return Application.edit(input.id, application => {
    application.version = input.version;
  });
});
```

Runtime permissions referencing retired operations fail closed and produce migration diagnostics.

## Identities, permissions, roles, and grants

### Identity kinds

The provider-neutral principal model must support:

- human identities;
- constrained pre-authentication-flow identities;
- authenticated OAuth authorization-flow identities;
- service and workload identities;
- one public execution-principal contract with task, workflow, processor, reconcile, and agent
  diagnostic kinds;
- agents;
- OAuth clients;
- MCP clients;
- provider-defined external principals normalized at admission.

Applik8s core owns only normalized identity references, trusted admission, authorization versioning, and
operation enforcement. The application or Start modules own user profiles, organizations, membership,
and product policy.

Stable and concrete execution identities are distinct:

```text
ServiceIdentity
  logical non-human application identity
  stable baseline application authority independent of runtime placement

WorkloadIdentity
  authenticates one deployed runtime
  maximum declared dependency, target, scope, audience, and transport envelope

ExecutionPrincipal
  one admitted input, step, event delivery, or reconcile attempt
  kind: agent | task | workflow | processor | reconcile
  deterministic bound input, target, and scope
  causal identity as audit context
  expiration, cancellation, audience, catalog revision, and revocation revision

Diagnostic branded kinds
  AgentRunPrincipal | TaskRunPrincipal | WorkflowRunPrincipal |
  ProcessorRunPrincipal | ReconcilePrincipal
```

The effective execution authority is the intersection of the workload envelope, execution-derived
bindings, active catalog/authority revision, and any explicit compatible delegation. Kubernetes
ServiceAccounts and workload credentials enforce only the infrastructure envelope; the Applik8s
operation runtime enforces per-execution input/target narrowing. A `ServiceIdentity` may supply logical
baseline application authority, but it neither authenticates the deployed runtime nor replaces the
concrete execution principal. An initiating principal is not inherited implicitly.

Direct calls make causal input binding visible:

```ts
await Source.completeObservation({
  sourceId: task.sourceId,
  requestId: task.requestId,
  evidenceCount,
});
```

The compiler lowers the complete expression to one internal `ExecutionBinding` and records provenance
for every field. Complete input validation, target derivation, authorization, idempotency, and audit run
at admission. `onInput(...)`, `onEvent(...)`, `onResource(...)`, and generated aliases remain bounded
migration forms only; new golden-path source does not split a callee input across a dependency map and
later alias invocation.

The key set is a compiler-proven constant even when the TypeScript return type could widen. Values may
be conditional; key presence may not. Every reachable return branch must produce the same exact keys.
Conditional insertion, unresolved spreads, computed keys, optional returned properties, and helper
results whose keys cannot be normalized fail compilation. An untyped caller that submits a bound key is
rejected before merge rather than silently losing or overriding a value.

Static restrictions precede an optional terminal execution binding:

```text
operation
  -> optional on(ref) | all()
  -> zero or more where(predicate) scopes
  -> optional terminal onInput | onEvent | onResource
```

`.on(ref)` and `.all()` are mutually exclusive, repeated `.where()` predicates combine with logical AND,
and a bound dependency exposes no further scoping or binding methods. Effective authority is the
intersection of the base operation, target selector, all predicates, execution-derived complete input
and target, workload envelope, catalog/authority revision, and compatible explicit grant. No later
method may erase an earlier constraint.

The compiler may infer an equivalent binding only when it can prove the complete field projection; the
inferred binding and provenance appear in `plan` and `explain`. Ambiguity fails compilation. Truly broad
target access requires explicit `Source.read.all()`, which does not broaden audience, transport,
delegation, or impersonation authority. A bare dependency never silently means `.all()`.

### Static assignment

Typed operations are assigned directly:

```ts
Administrator.can(
  Identity.read.all(),
  Identity.disable.all(),
  OAuthClient.create,
  Grant.revoke.all(),
);

ReleaseAgent.can(
  Application.read.all(),
  Application.deploy.where((target) =>
    target.environment.eq("staging"),
  ),
);
```

Conditional authority is an explicit request capability:

```ts
ReleaseAgent.mayRequest(
  Application.deploy.where((target) =>
    target.environment.eq("production"),
  ),
  {
    approval: ProductionOwner,
    expiresIn: "15m",
    maximumUses: 1,
    outcome: DeploymentHealthy,
  },
);
```

Direct possession and permission-request authority must never be conflated.

### Permission groups and roles

Explicit permissions group operations:

```ts
const ManageApplication = Application.permission("manage", {
  allows: [
    Application.read,
    Application.deploy,
    Application.rollback,
    Application.changeConfiguration,
  ],
});
```

Roles are typed permission sets:

```ts
const ApplicationOperator = application
  .role("application-operator")
  .can(ManageApplication.all());

ReleaseAgent.is(ApplicationOperator);
```

Roles are not required for direct assignment and must not force every provider into RBAC terminology.

### Runtime permission creation

Runtime administration composes deployed operation handles:

```ts
const BillingOperator = await Application.permissions.create({
  name: "billing-operator",
  operations: [
    Application.read,
    Application.restart,
    Application.inspectLogs,
  ],
  scope: Application.where((target) =>
    target.teamId.eq(currentTeam.id),
  ),
});

await BillingOperator.assign(BillingAgent, {
  expiresIn: "8h",
  maximumUses: 50,
  reason: "Incident response",
});
```

Runtime APIs use canonical `Permission`, `Grant`, `GrantRequest`, `Approval`, `Outcome`, `Revocation`, and
`AuditEvent` models. Static graph declarations reconcile into the same records with an
`origin: "application"` marker; runtime records use `origin: "runtime"`.

### Delegation

Executing an operation does not imply authority to grant it:

```ts
SecurityAdministrator.canGrant(
  Application.deploy.all(),
);

TeamAdministrator.canGrant(
  Application.deploy.where((target) =>
    target.teamId.eq(TeamAdministrator.teamId),
  ),
);
```

Grant creation must prove that the grantor has compatible delegation authority over every selected
operation and scope. Self-escalation, scope broadening, operation broadening, validity extension, use-count
extension, and approval bypass fail closed.

### Model-derived permissions

Permissions may follow model relationships:

```ts
Project.permissions.derive((project) => [
  project.owner.can(
    Project.read.on(project),
    Project.update.on(project),
    Project.delete.on(project),
  ),
  project.members.can(
    Project.read.on(project),
    Project.comment.on(project),
  ),
]);
```

Relational changes reconcile those grants in the model transaction where possible. Resource deletion
removes or invalidates lifecycle-owned grants. Relationship reparenting revokes the previous relationship
before or atomically with activating the new one.

### Imperative transaction-time grants

Model command contexts gain a transaction-aware permission capability:

```ts
Organization.create.beforeCommit(
  {
    transaction: {
      models: [Permission, Grant],
    },
  },
  async (organization, input, context) => {
    context.permissions.grant({
      identity: Identity.ref(input.ownerId),
      operations: [
        Organization.read,
        Organization.update,
        Organization.inviteMember,
      ],
      on: organization,
      lifecycle: organization,
    });
  },
);
```

External authorization projections are updated through the committed outbox. They do not participate in
or weaken the authoritative transaction.

## Handler and transport integration

### Model and actor handlers

Model handlers keep their existing signature. Context gains:

```ts
context.principal;
context.trustedContext;
context.authorization;
context.permissions;
context.inject(capability);
```

The runtime may implement direct calls through an internal `invoke(operation, input)` primitive, but
that primitive is not an application-context authoring API.

Actor-style serialized model commands authorize against the resolved actor/model identity before enqueue,
persist an authorization receipt in the durable envelope, and revalidate according to the operation's
lifetime before execution or commit.

### HTTP routes

Route declarations return handles:

```ts
interface ApplicationHttp {
  readonly match: {
    get(pattern: string): HttpRouteSet;
    post(pattern: string): HttpRouteSet;
  };
  get(
    name: string,
    path: string,
    handler: ApplicationRouteHandler,
  ): RawHttpRoute;
  get<TOperation extends AuthorizableOperation>(
    name: string,
    path: string,
    adapter: HttpOperationAdapter<TOperation>,
  ): HttpOperationBinding<TOperation>;
  post(
    name: string,
    path: string,
    handler: ApplicationRouteHandler,
  ): RawHttpRoute;
  post<TOperation extends AuthorizableOperation>(
    name: string,
    path: string,
    adapter: HttpOperationAdapter<TOperation>,
  ): HttpOperationBinding<TOperation>;
  group(name: string, options: { prefix: string }): HttpRouteGroup;

  /** @deprecated Compatibility only; new routes require an explicit stable name. */
  get(path: string, handler: ApplicationRouteHandler): RawHttpRoute;
  /** @deprecated Compatibility only; new routes require an explicit stable name. */
  post(path: string, handler: ApplicationRouteHandler): RawHttpRoute;
}
```

This enables:

```ts
application.http("api", (http) => {
  Administrator.can(
    http.match.get("/admin/**"),
    http.match.post("/admin/**"),
  );

  http.get("admin-users", "/admin/users", listUsers);
  http.get("admin-audit", "/admin/audit", searchAudit);
  const DisableUserRoute = http.post(
    "disable-admin-user",
    "/admin/users/:id/disable",
    User.disable.http(),
  );
});
```

Named groups are migration-safe:

```ts
const Administration = http.group("administration", {
  prefix: "/admin",
});

Administrator.can(Administration);
```

Route selectors resolve after the complete server graph is known and appear in manifest diffs when new
routes broaden an existing group grant.

Direct operation adapters create transport bindings to the existing operation:

```ts
http.post(
  "deploy-application",
  "/applications/:applicationId/deploy",
  Application.deploy.http(({ params, form }) => ({
    applicationId: params.applicationId,
    version: form.string("version"),
  })),
);
```

An adapted route such as `DisableUserRoute` is not a second operation. Granting it—or a route group that
contains it—grants `User.disable` only through that exact HTTP binding. The operation remains one catalog
entry and one business closure; direct, MCP, workflow, and other HTTP bindings are not granted
implicitly. Raw route closures are operations in their own right. Protected nested direct-handle calls
reauthorize through the internal invocation boundary; authorizing a raw route does not lend its handler
arbitrary application authority.

### Queries, search, and browser subscriptions

Queries, indexed searches, and subscriptions are authorizable operations:

```ts
Customer.can(
  Invoice.read.where((invoice, identity) =>
    invoice.customerId.eq(identity.id),
  ),
  InvoiceSearch.search,
  InvoiceEvents.subscribe.where((event, identity) =>
    event.customerId.eq(identity.id),
  ),
);
```

Authorization is enforced at snapshot, cursor resume, subscription creation, and authorization-version
change. Revocation closes or resets affected live subscriptions. Browser cursors never transfer between
principals, scopes, queries, indexes, or authorization revisions.

### Events and processors

Events remain immutable facts. A processor authenticates as its stable workload identity while each
delivery executes under `ExecutionPrincipal` with diagnostic kind `ProcessorRunPrincipal`:

```ts
ApplicationDeployed.onEvent(
  processorOptions,
  async (event, context) => {
    context.principal; // ExecutionPrincipal<"processor">
    context.causation;
    context.permissions;
  },
);
```

The `ExecutionPrincipal` binds event identity, delivery/attempt, deadline, bound dependency inputs and
targets, and the active authority revision. The initiating principal and grant remain causal audit
context but do not automatically impersonate the processor or inherit its capabilities. Delegation
requires an explicit compatible grant.

### Workflows and tasks

Workflow start, signal, result read, cancellation, and protected task effects are separate operations:

```ts
ReleaseAgent.can(
  DeploymentWorkflow.start.on(PaymentsApplication),
);

Operator.can(
  DeploymentWorkflow.cancel.where((run, identity) =>
    run.requestedBy.eq(identity.id),
  ),
);
```

Workflow state persists the initiating identity, an `ExecutionPrincipal` with diagnostic kind
`WorkflowRunPrincipal`, operation, target, grant revision, approval chain, causal operations, expiration,
and delegated capabilities. Each task attempt receives the same public execution-principal contract with
diagnostic kind `TaskRunPrincipal`, narrowed by its validated input and declared dependency bindings.
Long-running work cannot retain expired authority silently.

### Kubernetes admission and reconciliation

Reconcilers authenticate as workload identities and retain existing inferred watch/read/write RBAC.
Each attempt executes under `ExecutionPrincipal` with diagnostic kind `ReconcilePrincipal`, bound to
resource UID, generation/resource version, handler/catalog revision, installation and namespace context,
attempt/deadline, and declared dependency inputs/targets. A watch event does not supply trustworthy human
attribution. Direct Kubernetes writes use Kubernetes authentication and RBAC. Applications that require
the same domain permissions for direct CRD mutation enable a generated validating admission webhook that
maps Kubernetes `UserInfo` into normalized application admission and evaluates resource
create/update/delete operations.

CRD-derived grants use a status/finalizer state machine:

```text
resource observed
  -> desired grants calculated
  -> authoritative grants committed
  -> external enforcement projected
  -> authorizationReady reported
  -> resource becomes Ready

resource deletion requested
  -> lifecycle grants revoked
  -> enforcement revision observed
  -> authorization finalizer removed
```

No cross-Kubernetes/PostgreSQL transaction is claimed. Application deletion first disables admission and
drains protected work, then retains canonical authority and required projections until lifecycle
revocations and authorization finalizers complete. A retained revocation tombstone records unexpired
obligations without reusable credentials and lives in installation/deployment state outside the
application-owned authority database. External projections must be neutralized through revocation, lease
expiry, credential rotation, route detachment, or an explicit deny-all revision.

An unproven tombstone cannot expire because an ordinary retention period elapsed. It remains live until
neutralization is proven or a provider-enforced, non-renewable maximum lifetime has elapsed and expiry is
independently observed or guaranteed. Break-glass transfers any remaining tombstone to
installation-level safety/audit state; it does not delete the evidence or reinterpret an unproven
obligation as revoked.

If authority infrastructure is irrecoverably lost, only an installation-scoped, audited break-glass
plan may remove finalizers. It records every unproven obligation and recovery action and may not report
ordinary successful revocation. TypeKro/Alchemy dependency ordering must prevent authority teardown from
deadlocking the application lifecycle during the normal path.

### Kubernetes RBAC naming

The existing `ApplicationPermissionRule` type means Kubernetes API RBAC. Before exposing domain
permissions, it must become:

```ts
ApplicationKubernetesRbacRule
```

Related options should use names such as `kubernetesRbac`, `serviceAccountPermissions`, or `workloadAccess`
rather than overloading `permissions`.

## Agent and AI architecture

### TanStack AI boundary

TanStack AI owns:

- typed chat messages and tool calls;
- application-facing streaming events;
- React chat state and components;
- model/tool protocol adaptation;
- client reconnection and tool-approval presentation.

Applik8s owns:

- agent metadata, logical model requirements, operation-tool registration, and execution placement in the
  application graph;
- canonical product conversation/message/run records through ordinary provider-native application
  models, plus artifacts, approvals, usage, causal linkage, and audit;
- admitted principal and trusted context;
- durable workflow execution and long waits;
- event replay and resumable application delivery;
- provider selection and deployment;
- authorization of every tool operation.

TanStack AI must not become a second workflow authority or canonical database. Hatchet must not replace
TanStack AI's chat and tool protocol.

`@applik8s/ai-tanstack` is an adapter package, not an application-facing AI facade. It may provide
`asTool(operation)`, connection, persistence, lock, reconstruction, and runtime-context adapters only
when their public values implement or return upstream TanStack AI contracts. Native TanStack tools and
operation-derived tools must compose in one `tools` array.

The adapter mapping is normative: TanStack `threadId` is an admitted `Conversation.id`; its persisted
messages adapt canonical `Message` records; its persisted `runId` is the protocol/delivery run and remains
distinct from `AgentRun`, `WorkflowRun`, `AIInvocation`, and physical attempt IDs; interrupts present and
resume canonical approval/grant state but do not create authority. TanStack persistence, lock,
reconstruction, connection, and resumable-stream contracts are implemented as adapters and must pass
their upstream conformance suites.

### Logical models

Applications declare capability-oriented logical models:

```ts
const FastModel = AI.model("fast", {
  capabilities: [
    AI.chat,
    AI.tools,
    AI.streaming,
    AI.structuredOutput,
  ],
});

const ReasoningModel = AI.model("reasoning", {
  capabilities: [
    AI.chat,
    AI.tools,
    AI.streaming,
    AI.structuredOutput,
    AI.reasoning,
  ],
});
```

Agent code does not name vendor endpoints and does not hide TanStack execution:

```ts
import { chat } from "@tanstack/ai";
import { withPersistence } from "@tanstack/ai-persistence";

const SourceResearcher = application.agent(
  "source-researcher",
  {
    identity: SourceResearcherIdentity,
    model: ReasoningModel,
    tools: [
      EvidenceSearch.search,
      Source.observe,
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
      context: context.tanstack.execution,
      middleware: [
        withPersistence(context.tanstack.persistence),
      ],
    }),
);

SourceResearcherIdentity.can(
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

### AI tool-call identity

Provider tool-call IDs are scoped to one physical provider attempt. The durable proposal and operation
idempotency identity includes logical invocation ID, physical attempt ID, provider tool-call ID,
operation ID/version, and normalized validated arguments hash. Exact replay within one attempt reuses
the same durable command and grant reservation. Reuse with another operation or arguments is a protocol
conflict. A new physical attempt does not deduplicate merely because a provider reused the same call ID;
cross-attempt semantic reuse requires explicit application policy.

### Envoy AI Gateway provider

The default dedicated provider lowers logical models through Envoy AI Gateway:

```ts
deployment.provide(InferenceGateway).dedicated(() =>
  AI.envoy({
    models: {
      fast: [
        AIBackend.openAI("fast-primary"),
        AIBackend.bedrock("fast-fallback"),
      ],
      reasoning: [
        AIBackend.anthropic("reasoning-primary"),
        AIBackend.openAI("reasoning-fallback"),
      ],
    },
  }),
);
```

The adapter owns:

- `GatewayConfig`;
- `AIGatewayRoute`;
- `AIServiceBackend`;
- `BackendSecurityPolicy`;
- `MCPRoute`;
- provider credential references and workload identity;
- logical model rewriting;
- route weighting/failover;
- rate-limit integration;
- token and cost metrics;
- tracing and body redaction;
- health and status hydration.

Applik8s public types must not reproduce Envoy CRDs. A pinned reviewed adapter translates the
provider-neutral contract.

### Conversations, approvals, artifacts, and evaluations

The Start supplies canonical modules for:

- conversations and messages;
- agent and workflow runs;
- run events and progress;
- durable tool calls and results;
- approvals and review queues;
- artifacts and object references;
- evaluations, datasets, scorers, and results;
- memory records with explicit scope and retention;
- usage, model cost, rate, and entitlement attribution;
- audit and causal timelines.

The generated application imports and extends those models rather than receiving copied implementations.

Tool approval follows:

```text
TanStack AI interrupt/presentation
  -> typed Applik8s grant or approval operation
  -> durable Hatchet workflow wait
  -> PostgreSQL approval and audit transition
  -> committed event
  -> workflow and UI continuation
```

## MCP architecture

The Start must support both consuming and exposing MCP.

### Exposing application operations

```ts
application.mcp("identity", {
  tools: [
    Permission.create,
    Grant.request,
    Grant.revoke,
    SecurityAudit.search,
  ],
});
```

Existing operation schemas become MCP tool schemas. MCP exposure does not create a parallel handler or bypass
the operation's permission, target, idempotency, workflow, result, or audit semantics.

Ordinary MCP `tools/call` input identifies a tool by name and arguments; it does not prove which schema
revision the client previously discovered. Every stateful MCP connection/session is therefore pinned at
initialization to one MCP server and Applik8s operation-catalog revision. `tools/list` and `tools/call`
resolve through that immutable session mapping while compatible prior bindings drain. Incompatible
retirement requires reinitialization and rediscovery.

Catalog pinning never freezes authorization: every call revalidates current principal, grant, target,
audience, and authority revision against the operation represented by the pinned mapping.

Machine clients receive application authority through the provider-neutral
typed declaration:

```ts
const ReleaseAutomation = application.oauthClient(
  "release-automation",
  { issuer: "https://identity.example.test" },
);

ReleaseAutomation.can(AccessRequest.create.all());
```

The selected identity provider proves the issuer and client subject. Applik8s
derives the same issuer-bound canonical workload identity at declaration and
admission time; MCP then evaluates the ordinary operation grant. A client ID
alone, a token scope alone, or a same-named client issued elsewhere cannot
manufacture application authority.

For stateless transports that cannot prove session pinning, incompatible revisions coexist under
versioned public tool names. A negotiated catalog-revision extension may provide another safe path.
`notifications/tools/list_changed` requests rediscovery but is not evidence that the client actually
updated its cached schema. Name-and-arguments validation alone never claims to detect semantic staleness.

### Consuming MCP servers

External MCP tools are provider-bound capabilities with:

- explicit server identity and audience;
- tool allowlist or typed discovery contract;
- credential source;
- timeout, retry, and concurrency budget;
- input/output validation;
- egress declaration;
- audit and cost attribution;
- prompt-injection and untrusted-content boundaries.

### Authorization

HTTP MCP transport must implement the reviewed MCP OAuth requirements, including resource metadata,
audience-bound tokens, protected resource identifiers, PKCE where applicable, expiration, and token
revocation. Token passthrough is forbidden.

Envoy `MCPRoute` may aggregate and route servers, filter tools, and provide defense-in-depth authorization.
The Applik8s operation/grant authority remains authoritative for application tools.

## Search and indexing

### Named `Index(...)`

The ordinary path starts from the promoted root model. Its canonical model identity becomes the search
document identity:

```ts
const ProductSearch = Product.index(
  "search",
  Product.title,
  Product.description,
  Product.category.name,
  Product.brand.name,
  Product.marketValue,
);
```

Applik8s infers:

- root model and one-document-per-root cardinality;
- relational hydration query;
- search document type;
- default OpenSearch mapping;
- contributing models and relationships;
- invalidation edges;
- affected-root lookup for related-model changes;
- rebuild source and checkpoint;
- typed query result.

The advanced `application.index(...)` form is reserved for a custom root identity, cross-model
projection, or maintained module that cannot naturally belong to one model:

```ts
const EvidenceSearch = application.index(
  "evidence-search",
  {
    root: Evidence,
    identity: Evidence.id,
  },
  Evidence.title,
  Evidence.excerpt,
  Evidence.source.kind,
);
```

Both forms lower to the same named index node and search operation.

Index lifecycle separates:

```text
LogicalIndexIdentity = application ID + logical index name
IndexRevision = root/schema/mapping/relationship/authorization plan revisions
PhysicalGeneration = provider binding + physical generation + checkpoint/cutover provenance
```

The search operation and ordinary grants bind `LogicalIndexIdentity`; rebuilding or cutting over a
physical generation does not create a new operation. Revision constraints fail closed when a change is
incompatible with a grant. Cursors bind the logical identity, exact index revision, and physical
generation.

### Search behavior

Plain columns receive safe type-derived defaults. Explicit modifiers provide relevance semantics without
defining a second data schema:

```ts
const ProductSearch = Product.index(
  "search",
  search.text(Product.title, { boost: 4 }),
  search.text(Product.description),
  search.facet(Product.category.name),
  search.filter(Product.marketValue),
  search.sort(Product.createdAt),
);
```

One-to-many relationships require explicit aggregation:

```ts
const ProductSearch = Product.index(
  "search",
  Product.title,
  search.values(Product.listings.seller.name),
  search.minimum(Product.listings.price),
  search.maximum(Product.listings.price),
  search.count(Product.listings.id),
);
```

The compiler must reject ambiguous relationship paths, cycles without a bound, fan-out without an
aggregation, unstable identity, unsupported value types, unbounded affected-root scans, and mappings that
would silently change document cardinality.

### Typed search

```ts
const results = await ProductSearch.search({
  text: "first edition charizard",
  where: {
    categoryName: "pokemon",
    marketValue: {
      gte: 100,
    },
  },
  facets: [
    ProductSearch.categoryName,
    ProductSearch.brandName,
  ],
  orderBy: ProductSearch.marketValue.desc(),
  limit: 24,
});
```

Search results include typed values, score, highlights, facets, opaque cursor, projection revision, and
lag metadata. Provider-specific query DSL is available only through an explicit advanced escape hatch.

### Synchronization and rebuilding

```text
authoritative model transaction
  -> committed change/outbox
  -> bounded index processor
  -> affected-root resolution
  -> ORM rehydration
  -> idempotent bulk replace/delete
  -> checkpoint and lag update
  -> live-query invalidation
```

Full rebuild uses:

1. a committed source frontier;
2. a versioned physical index;
3. bounded snapshot scanning and bulk writes;
4. retained change catch-up;
5. validation and count/checksum evidence;
6. atomic alias cutover;
7. explicit prior-generation retirement.

Allocation sequence values or timestamps must not be treated as commit order.

### Search security

The gateway injects mandatory admitted-context filters. Callers cannot override, remove, or broaden those
filters. Search cursors bind to principal, trusted-context digest, logical index identity, index
revision, authorization version, and physical generation.

Filtering unauthorized rows from a provider page is forbidden because those rows can still affect
counts, facets, aggregations, ranking, highlights, page fullness, and cursor progression. Gateway
post-filtering is permitted only when the complete candidate universe is retrieved under a proven bound
and every observable result and cursor is recomputed from authorized documents. Otherwise the query
fails closed.

OpenSearch document and field security may provide defense in depth but does not replace application
authorization or write protection.

## TypeKro provider work

### Hatchet

The current compiler-authored Hatchet HelmRepository, CNPG cluster, HelmRelease, NetworkPolicy, and KEDA
resources must move into a released TypeKro composition. The integration owns managed and external
database modes, credentials, worker scaling prerequisites, status, update, recovery responsibility, and
deletion in direct and KRO modes. Applik8s binds that composition into the application graph; it does not
retain a second Hatchet deployment renderer.

### OpenSearch

A released TypeKro integration is required before Applik8s enables the OpenSearch provider. It should
cover:

- the reviewed official OpenSearch operator or chart installation path;
- typed cluster resources and external-cluster references;
- single-node local and highly available production profiles;
- persistent storage and explicit deletion/retention policy;
- optional Dashboards;
- TLS, credentials, NetworkPolicy, and ServiceMonitor;
- index template and alias initialization;
- security roles and role mappings;
- snapshot repositories backed by S3-compatible object storage;
- resource requests, limits, disruption, topology, and anti-affinity;
- status hydration;
- direct and KRO lifecycle, update, deletion, and cleanup evidence;
- backup/restore and rolling-upgrade evidence.

Automatic infrastructure installation on an existing cluster must remain explicit and lifecycle owned.

### Envoy AI Gateway

A released TypeKro integration is required before the dedicated Agentic Start profile consumes Envoy AI
Gateway. It should cover:

- Envoy Gateway prerequisites;
- official Envoy AI Gateway Helm/controller installation;
- pinned CRDs and typed resources;
- `GatewayConfig`, `AIGatewayRoute`, `AIServiceBackend`, `BackendSecurityPolicy`, and `MCPRoute`;
- secret, AWS, and GCP credential/workload-identity references;
- cross-namespace `ReferenceGrant` where required;
- rate-limit and telemetry dependencies;
- readiness and hydrated route/backend status;
- direct and KRO install, update, delete, and cleanup evidence;
- mock/local backend E2E plus credential-gated provider E2E.

### Ory completion

The current Ory integration is retained and extended with:

- complete Kratos registration, login, verification, recovery, settings, MFA, session, and logout proof;
- a packaged account UI suitable for the Start;
- Hydra login/consent integration;
- authorization code with PKCE, client credentials, refresh, introspection, and revocation proof;
- typed OAuth client lifecycle;
- typed Keto namespace and relationship management;
- Oathkeeper-enforced upstream proof;
- MCP OAuth resource-server integration;
- courier/email dependency profiles;
- key and secret rotation;
- production exposure, TLS, and DNS;
- backup/restore and upgrade evidence;
- explicit external and managed production dependency sources.

Ory Enterprise-only features must not become prerequisites for the open-source Start.

## Identity and authorization provider architecture

The provider boundary should separate:

```text
IdentityProvider
  authentication, sessions, identity lifecycle

OAuthAuthorizationServer
  OAuth/OIDC clients, consent, tokens, delegation

RelationshipStore
  principal/resource relationships

PolicyEngine
  contextual deterministic policy evaluation

AuthorizationAuthority
  canonical permissions, grants, revisions, use, revocation

AccessGateway
  request enforcement and identity propagation
```

The authority layer alone defines canonical `Principal` and `IdentityReference`. Identity/OAuth adapters
authenticate provider sessions and admit those canonical types; MCP performs transport admission into
the same contract.

Registration, login, verification, and recovery are not anonymous public operations. They run as bounded
`PreAuthenticationFlowPrincipal` instances tied to a high-entropy, expiring, single-use flow ID;
browser/session and CSRF state; provider continuity; attempt/rate limits; enumeration-resistant results;
and any OAuth request that must resume after login. This principal can invoke only its declared next
authentication transition and cannot approve OAuth scopes.

Consent uses a separate `OAuthAuthorizationFlowPrincipal` containing an admitted authenticated human
principal and exact session/assurance, client, authorization request, redirect URI, scopes, resource,
audience, CSRF/browser binding, expiry, and provider continuity. It may approve or deny only that
resource owner's bound request. Login alone is not consent.

Applik8s does not claim an atomic transaction across local flow state and an Ory/provider session.
Provider completion is validated, then one local transaction consumes the flow and writes an idempotent
admission receipt keyed by stable provider completion/session identity. Callback retry returns the same
receipt. Provider completion followed by unrecoverable local failure leaves an orphan obligation that
must be reconciled, revoked, or allowed to expire under a provider-enforced maximum lifetime.
Administrative identity changes use ordinary application authority.

The default dedicated profile is:

```ts
Authorization.composite({
  authority: Authorization.postgres(),
  relationships: Authorization.oryKeto(),
  enforcement: Authorization.oryOathkeeper(),
});
```

Casbin is a supported future or preview `PolicyEngine`/authorization adapter, not a replacement for
identity, OAuth, sessions, or MCP token lifecycle:

```ts
Authorization.composite({
  authority: Authorization.postgres(),
  policy: Authorization.casbin(),
  enforcement: Authorization.envoy(),
});
```

Domain source may not import Ory or Casbin response shapes. Provider decisions normalize into allowed,
version, reason, constraints, evidence, and revocation metadata.

## Agentic Start contents

The required maintained modules are:

- framework-neutral and TanStack Start application host integration;
- TanStack AI client/server integration;
- logical AI models and Envoy provider adapter;
- provider-neutral agents and typed tool binding;
- Hatchet workflows, schedules, approvals, cancellation, and recovery;
- conversations, messages, runs, run events, and resumable delivery;
- artifacts and S3-compatible object references;
- approvals, review queues, and outcome verification;
- evaluations, datasets, scorers, and result history;
- scoped memory contracts;
- usage, cost, quotas, and entitlement seams;
- identity, OAuth, authorization, permission, grant, and audit modules;
- MCP server/client integration;
- OpenSearch-backed `Index(...)`;
- first-run onboarding, safe non-secret configuration, local bootstrap, and an application/control-center
  shell derived from the pinned Stimp baseline;
- operations and administration UI;
- health, readiness, dependency, lag, and provider status;
- local, dedicated, and external provider modules;
- example policies, tests, deployment, and recovery runbooks.

Billing remains optional for ordinary Applik8s applications, but the full
Agentic Start must preserve the pinned Stimp baseline's local billing,
checkout, portal, signed webhook, entitlement-projection, and dashboard
behavior. v0.7 therefore supplies a provider-neutral maintained billing module,
an explicitly simulated Starter implementation, and one server-only Stripe
adapter. Product plans, pricing, catalog policy, and workspace ownership remain
application-owned. Applications do not replace agent, workflow, usage,
entitlement, or operation models when changing payment providers.

The Start may provide an optional organization/membership module. It must not make its tenant model a
framework requirement.

## Generated project shape

The generated project should remain recognizable and small:

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

Generated browser facades, server entrypoints, workflow workers, event processors, MCP routes, manifests,
container contexts, TypeKro resources, and Alchemy state inputs belong under ignored build output.

`modules.ts` explicitly imports and composes maintained modules one at a time. It is editable
application source, not a generated registry; removing a module must not require replacing `app(...)`
or copying package internals. Application behavior is organized feature-first under
`features/<feature>/`; small features may remain one file. The top-level TanStack `routes/` tree stays
upstream-shaped and thin, importing feature-owned route implementations rather than forcing domain logic
into framework route files.

The generator must not copy an internal registry, workflow runtime, auth server, conversation service,
SSE implementation, or provider-specific deployment stack into the new application.

### Command loop and explanation

A clean generated project supports one predictable loop from packed packages:

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

`dev` preserves the upstream Vite/TanStack experience and starts only credential-free starter
dependencies. The generated local installation selects the starter profile, so the first loop requires
no profile flag; explicit dedicated/external selection appears in the deployment tutorial. `plan` is
effect-free and reports operation-catalog, authority, provider, workload,
resource, image, lifecycle, data-retention, and destructive changes. `deploy`, `status`, and `destroy`
operate through the application graph, TypeKro, and Alchemy.

Every generated application also supports:

```sh
bun applik8s explain Source.observe
bun applik8s explain Source.observe --json
```

`explain` identifies the operation and schema revisions, source declaration, model/provider authority,
invocation and declared dependency paths, transaction/effect boundary, execution placement, workload
identity grants and Kubernetes RBAC, caller authority, profile bindings, generated workloads/resources,
TypeKro/Alchemy lifecycle, inferred defaults with provenance, and actionable warnings. Human and JSON
views consume the same normalized graph and deployment plan as build and deploy.

The first tutorial introduces a native model, one operation, one permission, one route, and local
execution. It may use generated provider exports without teaching profile construction. Profile
selection, overrides, transitions, and external providers appear only after the ordinary application
path works.

## Stimp application baseline and replacement of plumbing

The pinned Stimp `agent-saas-starter`, its rendered example, generator contracts,
onboarding/control-center behavior, and release verification are the concrete application baseline for
the Agentic Start. This is stronger than using Stimp as inspiration or a benchmark: every baseline
capability, generated-application responsibility, first-run path, extension seam, and release proof is
preserved, deliberately improved, explicitly deferred, or explicitly rejected with reviewed rationale.

The baseline includes:

- agents and typed tools;
- durable workflows;
- approvals;
- artifacts;
- evaluations;
- conversations and memory;
- inbox/review work;
- authentication and sessions;
- authorization and audit;
- billing/entitlement seams;
- operations and onboarding;
- credential-free first start with optional providers visibly skipped or blocked;
- safe configuration and local bootstrap without browser persistence of raw secrets;
- upstream TanStack Start/Vite SSR, hydration, routing, and server-only boundaries;
- generated template/rendered-example parity, package-consumer checks, real-app smoke, and production
  runbook expectations;
- non-interactive CLI automation and an explicit disposition for Stimp's optional rich terminal
  experience.

Applik8s preserves that product behavior while replacing:

- static array/index registries with the Applik8s graph;
- separate Inngest/Mastra runtime authority with Hatchet and TanStack AI;
- direct provider HTTP calls with the AI provider/Envoy layer;
- manual SSE with the existing authenticated stream/query gateway;
- copied runtime-heavy templates with maintained packages;
- string identities and tool lookup with typed operation references;
- custom deployment stacks with TypeKro and Alchemy.

The v0.7 scorecard pins the baseline revision and contains:

1. a manifest mapping every Stimp capability and product path to an Applik8s
   package/model/operation/profile;
2. a generated Applik8s behavioral parity fixture;
3. an improved/deferred/rejected ledger with rationale and replacement guidance;
4. evidence that feature-first source and maintained packages preserve the baseline without copying
   Stimp's registry, runtime, auth, workflow, or deployment implementations.

Stimp remains an executable application baseline and migration fixture, not a runtime dependency of the
Start. Its artifact-first source topology is not normative; Applik8s keeps feature-first domain source,
thin upstream routes, explicit modules, and the TypeKro/Alchemy lifecycle.

## Acceptance applications

### Chirp and GuestBook vertical slices

The required public slices divide acceptance deliberately:

Downstream products such as Vasco are post-release customer-zero dogfooding, not source-tree fixtures
or v0.7 release gates. They may discover framework defects after consuming the released public
packages, but Applik8s must not couple its package graph, examples, or release authority to their
private domain models.

1. GuestBook proves the complete minimal path from typed create through `on.create`/`on.update`,
   publication, persistent view, SSE invalidation, and browser requery.
2. GuestBook contains one readable authoritative model/resource declaration and no public
   `operation()`, `action()`, `task()`, repeated local handler-name string, provider lookup, internal
   import, or manual state/outbox write.
3. Chirp proves relational and analytical model bindings while its domain files remain provider
   agnostic.
4. Chirp proves single-event and frozen microbatch processing, whole-batch acknowledgement, replay,
   checkpoints, and execution-scoped authority.
5. Chirp proves online and analytical projections, rebuild from replay and authoritative snapshots,
   relationship invalidation, and generation cutover.
6. Chirp proves durable workflows and explicit steps, typed signals delivered through SSE, exact
   issuance visibility, approval/rejection, restart recovery, and framework-derived actors.
7. Chirp proves object storage, search, agents, MCP, TanStack Start SSR/live queries, and one causal
   operations timeline.
8. Both applications build from packed public packages and deploy without privileged fixture writes or
   provider-specific imports in domain/UI code.

### Agentic identity vertical slice

The required identity slice must prove:

1. Human registration/login and session admission through Ory.
2. OAuth authorization-code with PKCE for an MCP client.
3. Machine/client-credential identity for an agent or workload.
4. A typed protected application operation.
5. A static permission assigned directly to an identity.
6. A runtime-created permission containing existing deployed operations.
7. A scoped grant assigned and later revoked.
8. A production-sensitive operation requested by an agent with evidence and intended outcome.
9. A Hatchet approval wait and human decision.
10. Issuance of a short-lived, audience-, operation-, target-, use-, and outcome-bound grant.
11. Invocation through MCP or HTTP without token passthrough.
12. Independent outcome observation, grant consumption/revocation, and failure escalation.
13. Searchable audit history in OpenSearch.
14. A live admin UI for identities, clients, permissions, grants, requests, approvals, sessions, and audit.
15. A denied, expired, revoked, replayed, wrong-audience, wrong-target, and self-escalation matrix.
16. A shared workload credential cannot use one execution principal to invoke protected work on another
    execution's target.

The slice may use the Start's product models; it must not hard-code Ory terminology into shared Applik8s
contracts.

### CollectorBills and future-product conformance

CollectorBills is not required to migrate in v0.7, but design fixtures must prove that the Start can
represent:

- scheduled catalog acquisition;
- agent-proposed configuration changes;
- human approval;
- object/image storage;
- relational catalog state;
- analytical projections;
- OpenSearch browse/search;
- usage and entitlement enforcement;
- operations and administration.

Flourishnplot requirements remain to be documented. v0.7 must avoid assumptions that agents operate only
on text or that artifacts are always chat messages.

## Security requirements

The release must satisfy:

- explicit public operations and default-deny production exposure;
- no provider credentials or identity tokens in browser artifacts;
- audience/resource binding for OAuth and MCP tokens;
- no token passthrough;
- PKCE for applicable public-client flows;
- short-lived grants with bounded use and revocation;
- authorization revalidation for durable protected mutations;
- transactional or fail-closed lifecycle grant semantics;
- grantor delegation checks and no self-escalation;
- immutable causal audit records;
- redaction of secrets, credentials, prompts, model bodies, and sensitive tool results;
- model/tool input and output validation;
- bounded external calls, retries, concurrency, and response sizes;
- prompt-injection boundaries for MCP and retrieved content;
- one principal/context/authorization scope per cursor, result, stream, conversation, and grant;
- one independently identified, expiring execution principal per task attempt, workflow run/step,
  processor delivery, reconcile attempt, and agent run, narrowed beneath its stable workload envelope;
- no arbitrary runtime JavaScript/CEL authorization policy;
- no route selector that silently matches nothing;
- no new route broadening without manifest visibility;
- no control-plane user attribution inferred from watch timing;
- secret and key rotation without accepting stale credentials indefinitely;
- fail-closed provider readiness and authorization outages;
- explicit retention and deletion policy for conversations, artifacts, evidence, audit, and search.

## Observability and operations

The Start operations UI and metrics must expose:

- application and installation readiness;
- provider and dependency readiness;
- active agents and workflows;
- workflow queue, slot, retry, cancellation, and wait state;
- event consumer lag and dead letters;
- index projection lag, generation, rebuild, cutover, and failure;
- AI request rate, latency, token usage, estimated cost, backend, and fallback;
- MCP requests, tool selection, denials, and latency;
- permission/grant creation, use, expiration, revocation, and projection lag;
- identity/session/OAuth health without exposing credentials;
- object-store and artifact health;
- database pool, transaction, and contention signals;
- browser gateway request, subscription, reset, and authorization failures.

Every run, operation, workflow, tool call, grant, event, and artifact should share stable causal IDs where
applicable.

## Performance and capacity requirements

v0.7 must establish recorded benchmark history and explicit ceilings for:

- Start build time and browser/server bundle size;
- agent cold start and first streamed token;
- AI gateway overhead;
- concurrent streaming conversations;
- Hatchet workflow start, wait, resume, and worker replacement;
- permission decision latency and cache invalidation;
- grant creation/revocation propagation;
- operation-catalog size and selector resolution;
- OpenSearch indexing throughput, bulk size, retry, and lag;
- related-model invalidation fan-out;
- full index rebuild throughput and alias cutover;
- search latency, cursor size, and result bounds;
- MCP request and tool-routing overhead;
- PostgreSQL connection and transaction contention;
- memory per worker and per live subscription;
- object/artifact throughput;
- local starter resource footprint.

All processors, indexers, workflow workers, agent runs, searches, list operations, and replay loops require
bounded concurrency and cancellation. A fixed one-replica starter profile is acceptable; the dedicated
profile must expose an honest scaling contract.

## Package and module boundaries

The exact package count may be refined, but source boundaries should separate:

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
@applik8s/authorization-casbin
@applik8s/conversations
@applik8s/approvals
@applik8s/artifacts
@applik8s/evals
@applik8s/operations
```

Packages may begin consolidated where that reduces ceremony, but provider SDKs must remain out of core and
browser dependency zones. The Start package should compose modules rather than become a monolith
containing provider clients and deployment logic.

## Implementation phases

These phases define program sequencing. Detailed implementation authority, owned contracts, and local
definitions of done live in the bounded RFPs listed in the charter document map.

### Phase 0 — Contract and maintainability preparation

- pin the Stimp `agent-saas-starter` baseline revision and inventory its generator, product paths,
  onboarding/control center, extension seams, package boundaries, generated-example parity, and release
  evidence;
- publish the preserved/improved/deferred/rejected baseline ledger before replacing implementation
  plumbing;
- inventory current operation, route, query, stream, workflow, identity, and authorization types;
- replace the v0.6 `ModelStore`/`ProjectionStore` vocabulary with the reviewed transactional/analytical
  capability model across source, graph contracts, diagnostics, and examples;
- rename Kubernetes `ApplicationPermissionRule`;
- define shared authorizable operation and stable operation-catalog contracts;
- replace the v0.6 exceptional-model `.action(...)` spelling with ordinary exported functions and
  the internal `/operations/` catalog vocabulary without creating a second handler surface;
- remove `.action(...)`, draft `.operation(...)`, and model command registries from the public API;
  no compatibility window is required before the first v0.7 consumer;
- make named route declarations normative and confine two-argument route declarations to compatibility;
- define the direct-facade/internal-invocation relationship, normalized closure grammar, declared
  dependency IR, and graph-native `explain` projection;
- remove remaining Ory-specific types from core provider-neutral identity contracts;
- define package and browser/server dependency zones;
- add type-level fixtures before implementing runtime behavior.

### Phase 1 — Operation catalog and typed authority

- extend existing operations with authorization facets;
- create the stable operation catalog, staging/activation protocol, and migration metadata;
- implement identities, permissions, roles, grants, delegation, requests, approvals, outcomes, and audit;
- distinguish agent definitions, logical service identities, deployed workload identities, and the
  public execution-principal contract;
- apply the same separation to task/workflow/processor/reconciler workload envelopes and concrete
  execution principals;
- implement static reconciliation and runtime creation;
- serialize bounded grant reservations and independently verified outcomes;
- implement transaction-time and derived model grants;
- implement admission drain, revocation tombstones, dependency-ordered authority teardown, external
  neutralization, and audited break-glass recovery;
- distinguish raw route operations from adapted transport bindings and lower group grants to the exact
  underlying operation plus binding constraint;
- persist and revalidate authorization receipts in durable commands;
- integrate routes, queries, streams, workflows, events, and control-plane admission.
- derive exact task, workflow, processor, and reconciler workload-identity grants from declared
  operation dependencies, require exact-key explicit or provably inferred execution field bindings,
  enforce terminal monotonic target/scope composition and runtime bound-field override rejection, and
  serialize workload envelopes, internal `ExecutionBinding` plans, and public `ExecutionPrincipal`
  contracts in graph/deployment plans;

### Phase 2 — Profiles and dependency injection

- implement schema-derived discriminated profile extraction;
- implement exhaustive `.provide(...).variant(...).exhaustive()`;
- implement qualified provider tokens and `inject()`;
- preserve existing declared query/view/resource/search contracts without adding implicit
  `find`/`aggregate` APIs in the profile layer;
- land and consume a TypeKro Hatchet composition, then remove compiler-authored Hatchet infrastructure;
- implement Start provider modules and safe override rules;
- lower branch predicates and provider dependencies into the graph;
- define and test profile transitions and inactive credential isolation.

### Phase 3 — Search

- implement named `Index(...)`, relationship traversal, cardinality checks, invalidation, and rebuild
  contracts;
- implement the bounded PostgreSQL starter provider;
- land and release TypeKro OpenSearch support;
- implement the OpenSearch runtime provider;
- implement typed search, facets, highlights, cursors, security scope, lag, and live invalidation;
- prove related-model update/delete/reparent and full rebuild/cutover.

### Phase 4 — AI and agents

- define provider-neutral logical AI model and agent contracts;
- integrate TanStack AI chat, tools, streaming, persistence, connections, and React through upstream
  contracts returned or implemented by `@applik8s/ai-tanstack`;
- require every agent declaration to include or reference a serializable execution closure that calls
  TanStack AI directly;
- land and release TypeKro Envoy AI Gateway support;
- implement the Envoy provider, logical routing, credentials, rate, metrics, redaction, and fallback;
- adapt existing operations into native TanStack tools without duplicate schemas or a parallel tool
  protocol;
- implement conversation, run, usage, and audit models plus the normative TanStack
  thread/run/interrupt mapping and upstream conformance suites;
- implement durable provider attempts, recovery, and uncertain-completion behavior;
- scope durable AI tool proposals to logical invocation, physical attempt, provider call ID, operation
  revision, and normalized arguments.

### Phase 5 — Identity and OAuth

- define separate pre-authentication and authenticated OAuth authorization-flow principals and state;
- implement CSRF/session/redirect/audience binding, single-use flow transitions, rate/abuse policy,
  enumeration-resistant results, and provider continuity;
- implement idempotent provider-completion admission receipts, callback replay, and orphan-session
  reconciliation/revocation;
- complete Ory flows, lifecycle, projection frontiers, rotation, recovery, and provider adapters;
- package framework-neutral account, consent, client, session, and recovery modules.

### Phase 6 — MCP and durable agentic workflows

- implement MCP server and client contracts;
- pin the MCP protocol revision and selected authorization extensions;
- implement session catalog pinning, compatible binding drain, reinitialization, and versioned stateless
  names for incompatible revisions;
- expose existing operations and searches as tools;
- implement OAuth resource metadata and protected MCP transport;
- integrate Envoy `MCPRoute`;
- package approval, artifact, evaluation, memory, and outcome workflows;
- prove cancellation, resume, failure, compensation, and grant expiration.

### Phase 7 — Start completion

- package account, consent, permission, grant, review, and operations UI;
- reach evidenced behavioral parity with the pinned Stimp baseline for credential-free first run,
  onboarding/safe configuration, core agentic product paths, operational visibility, and generated
  application release gates;
- build the small feature-first generator and local/dedicated/external modules;
- complete and test the create/dev/test/plan/deploy/status/destroy loop from packed packages;
- implement human and JSON `explain` from the normalized graph/deployment plan;
- prove the beginner path without profile configuration while preserving editable exhaustive profile
  modules;
- add recovery and production runbooks;
- confirm clean install and upgrade from packed packages.

### Phase 8 — Acceptance applications and release qualification

- run the pinned Stimp behavioral baseline fixture and require an explicit disposition for every
  baseline capability and product path;
- migrate the Chirp and GuestBook vertical slices;
- implement the identity vertical slice;
- run the complete live and adversarial matrices;
- record performance/capacity evidence;
- review generated source and public API ergonomics;
- update vision, roadmap, API reference, migration guide, examples, and release scorecard;
- do not tag until maintainer approval.

## Required tests and release gates

### Type and contract gates

- existing operation declarations retain type compatibility;
- CRUD and custom operations expose typed authorization facets;
- operation/input/target/scope mismatches fail type checking;
- raw route operations, adapted operation bindings, groups, and selectors are method/path/group typed;
- profile binding adds no implicit `find`/`aggregate` query language;
- profile branches narrow installation variants;
- exhaustive profile provision fails after adding an unhandled variant;
- index relationship paths and result types are inferred;
- one-to-many index paths require aggregation;
- browser facades omit server/provider/permission implementation types;
- agent tools accept operation handles and do not imply `.can()`;
- direct entry and managed-closure handle calls, the internal invocation lowering, and compatibility
  aliases preserve one operation identity, schema, result, and authority contract;
- dynamic, unresolved, or authority-widening managed-closure dependencies fail type checking or static
  compilation;
- ambiguous existing-target dependencies fail unless explicitly bound or visibly broadened with
  `.all()`;
- execution-binding projections preserve exact literal bound keys despite TypeScript widening;
  conditional key sets, optional keys, unresolved spreads, computed keys, divergent return branches,
  and unnormalizable helpers fail compilation;
- bound dependencies are terminal at the type level, `.on(ref)` and `.all()` are mutually exclusive,
  and repeated `.where()` scopes remain intersected;
- public examples conform to the subject/free/lifecycle/route/reconciler closure grammar.

### Local runtime gates

- static permission reconciliation;
- runtime permission creation and assignment;
- delegation subset checks;
- expiration, use count, revocation, and outcome consumption;
- durable command revalidation;
- transaction-time lifecycle grants;
- derived relationship grant reconciliation;
- route group and glob resolution;
- adapted-route group grants resolve to the underlying operation plus exact transport binding without a
  duplicate permission or cross-transport broadening;
- raw-route nested-operation reauthorization;
- unproven revocation tombstones survive retention deadlines and break-glass transfer;
- subscription revocation/reset;
- event processor workload identity, per-delivery principal, and causal context;
- task, workflow, processor, and reconciler dependencies generate only their exact maximum
  operation/input/target/scope workload envelopes and are removed or narrowed by an inspectable plan
  diff;
- task attempts, workflow runs/steps, processor deliveries, and reconcile attempts receive distinct
  execution principals with serialized input/event/resource bindings and cannot access another
  execution's target;
- execution-binding callbacks infer their task/workflow input, processor event, or reconciled resource
  without annotations; generated aliases expose only unbound callee-input fields;
- untyped and stale callers cannot submit a bound field, static target/scope constraints survive
  execution binding, and a static/execution-derived target conflict fails closed;
- graph plans, receipts, audit, and `explain` preserve exact bound keys and every constituent target,
  predicate, execution-derived restriction, and resulting intersection;
- workflow authority expiration and protected-step checks;
- index change, related-model invalidation, delete, reparent, retry, replay, rebuild, and cutover;
- AI streaming, tools, structured output, cancellation, redaction, usage, and fallback;
- AI tool-call replay/conflict/cross-attempt identity;
- pre-authentication flow admission-receipt replay and orphan provider-session recovery;
- authenticated OAuth consent-flow binding;
- MCP discovery, auth, tool filtering, collision, invocation, cancellation, errors, session catalog
  pinning, compatible drain, reinitialization, and stateless versioned-name coexistence.

### TypeKro live gates

- Hatchet direct and KRO install, status, update, recovery responsibility, worker-scaling dependencies,
  and deletion without compiler-authored installation manifests;
- OpenSearch direct install, update, status, snapshot, restore, and delete;
- OpenSearch KRO install, update, status, and delete without leaked namespaces, finalizers, PVCs, or RGDs;
- Envoy AI Gateway direct and KRO install, route/backend status, request flow, update, and delete;
- completed Ory direct and KRO lifecycle;
- explicit failure for missing cluster prerequisites;
- no automatic cluster-wide installation on an existing cluster without explicit ownership.

### OrbStack product gates

- generate a fresh Agentic Start from packed packages;
- prove the pinned Stimp baseline's credential-free onboarding, safe configuration, agent/workflow/
  approval/artifact/eval/admin product paths, and operational status through Applik8s-owned behavior;
- start the credential-free local profile;
- complete the documented create/dev/test/plan/deploy/status/destroy loop;
- explain `Source.observe` in human and JSON form from the same plan used to deploy;
- deploy through the application deployment graph rather than handwritten `kubectl`;
- complete the Chirp and GuestBook vertical slices;
- complete the identity vertical slice;
- exercise a real browser through SSR, hydration, streaming update, permission change, and requery;
- exercise an MCP client through OAuth, operation authorization, workflow, result, and revocation;
- rebuild an index from canonical data and cut over without serving partial results;
- replace a workflow, indexer, gateway, and application pod without losing committed work;
- delete through TypeKro/Alchemy lifecycle and prove complete cleanup or documented retained data.

The complete dedicated topology is a release-candidate and scheduled showcase, not an opaque per-change
gate. Per-change contracts, independent provider lifecycle qualification, and the integrated Start lane
record explicit cluster-class and CPU/memory/storage/time budgets. Missing capacity fails as an unmet
prerequisite rather than as a nondeterministic readiness timeout.

### Package and supply-chain gates

- every public package builds to JavaScript plus declarations;
- a clean package consumer installs without workspace leakage;
- all runtime imports are declared dependencies;
- generated browser and server bundles pass dependency-zone inspection;
- generated container images use immutable released bases;
- TypeKro, Envoy AI Gateway, OpenSearch, Ory, Hatchet, TanStack AI, and MCP SDK versions are pinned and
  recorded;
- audit findings are classified by runtime reachability and severity;
- published-package smoke uses the same Start and provider paths as the repository.

### Security adversarial matrix

Required denials include:

- anonymous invocation of a protected operation;
- wrong identity, target, relationship, route, method, transport, or tenant/context;
- expired, revoked, consumed, wrong-audience, or wrong-version grant;
- permission broadening during assignment;
- self-grant without delegation;
- stale durable command after revocation;
- stale cursor or subscription after authorization change;
- MCP token passthrough or wrong resource indicator;
- agent tool present but ungranted;
- route permission used to invoke another transport;
- adapted route treated as a second independent operation or granted through an unselected binding;
- raw route used as a confused deputy;
- pre-authentication flow attempting OAuth consent;
- duplicate authentication callback producing another admission transition;
- orphaned provider session remaining usable after failed local admission;
- provider tool-call ID reused across physical attempts to suppress a new operation;
- stale MCP schema executed without session catalog pinning, versioned name, or negotiated revision;
- runtime permission referencing a retired operation;
- search query attempting to remove mandatory scope filters;
- control-plane reconciliation attributing authority to an unauthenticated watch event;
- browser bundle containing provider credentials or authorization implementation.
- workload dependency used to invoke an undeclared operation, exceed its input/target/scope, impersonate
  a user, delegate authority, or access the operation through an undeclared transport;
- one task, processor, workflow, or reconcile execution using the shared workload credential to access a
  target admitted only for another execution;
- conditional-key execution binding or widened bound-key inference;
- untyped caller attempting to override an execution-bound field;
- execution binding replacing a preceding target selector or static predicate;
- post-binding `.on()`, `.all()`, `.where()`, or second execution-binding attempt;

## Migration requirements

v0.7 may make reviewed breaking changes before a broader consumer base exists, but migration must be
explicit:

- current `ApplicationPermissionRule` becomes `ApplicationKubernetesRbacRule`;
- route declaration methods return handles rather than `void`;
- current `Authorization.from(decide)` remains an adapter escape hatch, not the golden-path application
  API;
- Ory infrastructure types move behind provider packages;
- scattered `app.select()` provider selection migrates to schema-derived profile provision;
- exceptional model `.action(...)`, draft `.operation(...)`, and model command registries are removed
  before release; ordinary exported functions and internal `/operations/` catalog nodes are the only
  v0.7 path, while historical catalog data can be handled by explicit migration tooling;
- dynamic permission migration reports retired, renamed, or incompatible operation references;
- existing applications without public exposure may adopt authorization incrementally;
- production-exposed operations require explicit classification.

## Non-goals

v0.7 does not require:

- Applik8s core to own organizations, tenancy, membership, billing policy, or user lifecycle;
- every Ory, Casbin, OpenSearch, Envoy, TanStack AI, Hatchet, or MCP feature;
- a universal policy language capable of executing arbitrary application code;
- exactly-once effects across PostgreSQL, NATS, Hatchet, OpenSearch, Ory, and external providers;
- synchronous OpenSearch consistency with authoritative model commits;
- inferred incremental patches for arbitrary SQL or search queries;
- automatic denormalization of unbounded relationship graphs;
- global multi-region identity or search federation;
- a finished commercial social network or Auth0 competitor;
- migration of CollectorBills or an unspecified Flourishnplot product;
- replacing framework-neutral Vite/React support with TanStack-only contracts;
- replacing TypeKro or Alchemy deployment machinery;
- permitting models or agents to obtain provider credentials directly.

## Principal risks

1. **Authorization authority ambiguity.** PostgreSQL, Keto, Casbin, Oathkeeper, Envoy, and tokens can
   accidentally become competing decision authorities. The composite contract and revision semantics must
   remain explicit.
2. **Durable command revocation races.** Authorization at submission alone is insufficient for queued or
   long-running mutations.
3. **Dynamic permission compatibility.** Runtime policy data can outlive the operation version that created
   it; operation IDs, replacement, migration, and fail-closed behavior are mandatory.
4. **Cross-model index fan-out.** Related-model changes can create unbounded reindex work unless path,
   cardinality, and capacity are planned.
5. **Start monolith growth.** Packaging every capability in one module would recreate Stimp's upgrade and
   copy-surface problem.
6. **Provider leakage.** Envoy, Ory, OpenSearch, and Hatchet types can easily enter core contracts or
   browser bundles.
7. **AI and MCP trust confusion.** Tool availability, tool authority, retrieved content, and delegated
   identity must remain distinct.
8. **Control-plane identity attribution.** Kubernetes watch events do not contain a trustworthy initiating
   application principal.
9. **Local success masking production gaps.** Credential-free deterministic providers must not satisfy
   production Ory, Envoy, OpenSearch, TLS, retention, backup, or revocation evidence.
10. **Release scope.** The release is large. Phase gates must produce independently reviewable vertical
    increments without narrowing the final required experience silently.

## Open design questions requiring maintainer review

1. Should the initial package be `@applik8s/start-agentic`, with `--start agentic`, or should the public
   package be broader while retaining that generator name?
2. Should an operation's implicit permission always be grantable, or must sensitive operations explicitly opt
   into runtime grant creation?
3. Which bounded runtime predicate forms are sufficient for v0.7 dynamic permission scopes?
4. Which authorization checks must be transaction-local versus revalidated at gateway, processor, or
   provider enforcement boundaries?
5. Should Keto remain the default relationship store when PostgreSQL owns canonical grants, or should the
   first profile use PostgreSQL relationships and qualify Keto as a production projection?
6. Should the first OpenSearch TypeKro integration use the official operator, the official Helm chart, or
   support both under one lifecycle contract?
7. Which Envoy AI Gateway provider and credential paths can be required without external paid credentials
   in continuous integration?
8. What minimum billing/entitlement module belongs in the first Agentic Start versus a follow-on
   module release?

These questions may refine syntax and provider choice. They must not weaken the core semantic decisions:
existing typed operations, static and dynamic grants, provider-neutral identity, durable authority,
relationship-aware indexes, package-backed Starts, and complete live application evidence.

## Definition of done

v0.7 is ready for maintainer release review when:

- the Agentic Start generator produces a small, understandable, upstream-shaped TanStack Start project;
- profile DI is exhaustive, typed, graph-visible, and replaceable;
- relational, CRD/resource, analytical, and framework entity models retain their native definitions,
  authority, and execution semantics while sharing only compatible promoted facets;
- existing CRUD and named operations carry authorization without a parallel DSL;
- identities receive typed operation handles directly;
- runtime permissions and grants are safe, lifecycle-aware, delegable, auditable, and migration-aware;
- HTTP, MCP, actor, event, workflow, query, subscription, and Kubernetes boundaries share one normalized
  operation and authority model;
- direct handle calls share one invocation contract across entrypoints and managed closures, while
  statically discovered dependencies compile into exact least-privilege workload grants;
- generated source is feature-first, the full command loop works from packed packages, `explain` derives
  from the deployment plan, and the beginner path does not require profile configuration;
- `Index(...)` follows model relationships, maintains OpenSearch from committed changes, and rebuilds
  safely;
- TanStack AI, Hatchet, and Envoy AI Gateway have non-overlapping authorities;
- Ory provides complete default identity/OAuth infrastructure while Casbin and other providers remain
  possible;
- the Start packages conversations, workflows, approvals, artifacts, evaluations, usage, audit, MCP,
  search, operations, and deployment without copying a private runtime into applications;
- the pinned Stimp application baseline is fully dispositioned and its preserved/improved behavior passes
  through the generated Applik8s Start without a Stimp runtime dependency;
- Chirp, GuestBook, and the agentic identity vertical slices pass locally and on OrbStack;
- adversarial security, cleanup, upgrade, package-consumer, browser-boundary, and performance gates pass;
- the maintainer judges the resulting source examples succinct relative to the distributed behavior they
  express;
- no release tag has been created before that review.
