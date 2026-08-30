# Agentic Start capability map

**Status:** Normative v0.7 implementation and acceptance plan

This document maps the complete Agentic product baseline to Applik8s
primitives, maintained modules, provider adapters, generated application code,
and executable evidence. A capability is complete only when the generated
Agentic Start demonstrates its user-visible behavior.

## Ownership rules

Agentic Start preserves product behavior without copying prototype implementation:

- **Applik8s primitives** own generic execution, persistence, authority,
  identity, reactive delivery, infrastructure, and lifecycle semantics.
- **Maintained modules** own reusable product models and operations such as
  conversations, approvals, artifacts, evaluations, usage, billing, and the
  operations control center.
- **The generated application** owns workspace, membership, product policy,
  branding, plans, agents, tools, and feature composition.
- **Provider adapters** implement identity, AI, workflow, search, object,
  payment, and deployment interfaces without leaking provider types into
  application code.
- **TanStack Start** owns routes, SSR, hydration, and browser composition.
  Generated route files are ordinary, readable adapters over callable
  Applik8s models, views, operations, workflows, and signals.

Tenancy and billing policy remain application-owned. Applik8s supplies the
trusted execution context, typed authority, relational primitives, maintained
reusable modules, and provider seams needed to implement them.

## Developer-experience invariants

Product completeness does not justify reproducing prototype plumbing with different
names. The v0.7 Agentic Start is conformant only when authored source obeys
these rules:

1. **Declare domain shape once.** An app-owned relational model is one
   Drizzle-compatible `model(...)` declaration discovered through its typed
   database binding; there is no second `application.model(...)` promotion.
   Its columns, relationships, ArkType validation, operations, events, query
   types, and browser facade derive from that declaration. CRD models use the
   equivalent one-call `application.crd(...)` surface for app-owned resources;
   standalone `entity(...)` remains for reusable resource definitions.
2. **Call typed values directly.** CRUD handles, ordinary exported functions,
   queries, views, workflows, agents, tools, and signals are callable. Browser
   code does not construct command envelopes or call `.mutate(...)`.
3. **Ordinary functions are operations when they cross a managed boundary.**
   Custom application behavior is not wrapped in `operation(...)`,
   `.action(...)`, or a string registry merely to receive authority,
   idempotency, retries, or observability. When the function crosses a trust
   boundary, its parameter and result types must trace to ArkType contracts,
   model-derived schemas, or another registered runtime schema. Erased
   TypeScript types alone are not treated as validation.
4. **Providers are injected once.** Applications call
   `application.provide(Capability, implementation)`. Maintained modules and
   managed closures receive the hydrated capability automatically; authors do
   not thread `database`, `processor`, credentials, or provider clients through
   every module constructor.
5. **Modules include product behavior, not infrastructure configuration.**
   The target shape is:

   ```ts
   export const {
     Conversation,
     Message,
     Run,
     Memory,
   } = application.include(conversations);
   ```

   Inclusion registers the module's models, migrations, events, views, and
   operations once. Dependencies resolve from `provide(...)`. Business-level
   customization remains explicit; infrastructure plumbing does not.
6. **Transport is inferred from use.** Importing a callable server handle into
   a TanStack route or browser-safe facade causes the Vite/compiler boundary to
   generate its admitted transport. Applications do not maintain parallel
   gateway `commands`, `queries`, `subscriptions`, or `maintainedCommands`
   arrays. Reachability requests a transport; it does not grant authority.
   Compilation fails when a remotely reachable handle has neither an explicit
   public policy nor a typed role/identity admission.
7. **Authority is typed and attached to the same value.** Authors write
   `Member.can(Conversation.create)` or `Reviewer.can(reviewPost)`. They do not
   duplicate operation identities as strings or implement application
   authorization in `gateway.authorizeCommand`.
8. **Identity and scope are framework-derived.** Client inputs never supply the
   trusted actor, workspace, roles, receipt, or provider identity. Managed
   execution receives them from the authenticated principal and admitted
   context.
9. **Provider types stop at adapters.** Application models, functions, routes,
   agents, and workflows use `IdentityProvider`, `PaymentProvider`,
   `WorkflowEngine`, `StructuredGeneration`, `Search`, and object capabilities;
   they do not import Ory, Stripe, Hatchet, Envoy, OpenSearch, Rook, or NATS
   types.
10. **Infrastructure remains explainable.** Inference removes authored
    ceremony, not visibility. `plan`, `status`, graph inspection, diagnostics,
    and operations UI show every generated workload, permission, provider,
    dependency, ownership boundary, and readiness condition.
11. **Hydration fails closed.** Including a module with a missing or ambiguous
    capability binding is a compile/plan error. Calling a hydrated provider
    capability outside managed execution is an actionable runtime error, not
    an implicit global client or local fallback.
12. **Bindings are application-scoped and type-qualified.** Capability tokens
    are declarations, not mutable global clients. `provide(...)` or an
    exhaustive profile provision returns the callable binding captured by
    managed code. Multiple applications and qualified bindings can coexist in
    one JavaScript process without string lookup or ambient singleton state.
13. **Storage families preserve one outer model experience.** Relational,
    Kubernetes, analytical, search, and index-backed models use the same direct
    operation/query/view/event vocabulary. Provider-specific query expressions
    may appear inside the implementation where semantics genuinely differ, but
    routes and callers do not branch on storage kind.
14. **Defaults are progressive, not hidden.** The generated Starter works
    without infrastructure ceremony. Dedicated and External expose only the
    decisions the application must own. Advanced capacity, lifecycle, and
    provider overrides remain typed and inspectable without entering ordinary
    feature code.
15. **The web application is itself inferred infrastructure.** The
    Applik8s/Vite integration contributes the TanStack server build,
    `ApplicationHost`, container artifact, Service, health contract, and
    deployment dependencies. Generated applications do not hand-author a
    Dockerfile, host deployment, gateway registry, or Kubernetes resources.
    `provide(ApplicationHost, ...)` remains an advanced override.
16. **The callable client is framework-neutral.** Direct browser handles,
    authenticated transport, resumable events, and cache-independent
    subscriptions belong to `@applik8s/client`. React contributes optional
    lifecycle hooks, and TanStack Start contributes SSR and routing integration;
    neither is required to call an Applik8s operation from another Vite
    application.

### Canonical authored experience

App-owned model shape and relationships are declared once:

```ts
export const Workspace = model('Workspace', {
  id: field.uuid().primary(),
  slug: field.text().unique(),
  name: field.text(),
});

export const WorkspaceRelations = relations(Workspace, ({ many }) => ({
  memberships: many(Membership),
}));
```

CRUD is direct, while custom behavior remains an ordinary function whose
runtime input contract is declared once:

```ts
export const RenameWorkspace = type({
  workspaceId: 'string',
  name: 'string > 0',
});

export async function renameWorkspace(
  input: typeof RenameWorkspace.infer,
) {
  return Workspace.edit(input.workspaceId, workspace => {
    workspace.patch({ name: input.name });
  });
}

WorkspaceOwner.can(Workspace.create, renameWorkspace);
```

If `renameWorkspace` becomes a route, tool, workflow step, or other admitted
boundary, the compiler follows the `typeof RenameWorkspace.infer` reference
and emits that schema. A private helper may use ordinary TypeScript types.
Public exposure fails closed when no runtime boundary schema can be proven.

One-time reads and live observations differ by semantics, not transport:

```ts
export const WorkspaceBySlug = Workspace.query(
  {
    input: type({ slug: 'string' }),
    output: Workspace.schema.select.or('undefined'),
  },
  input => Workspace
    .where(workspace => workspace.slug.eq(input.slug))
    .first(),
);

export const WorkspaceMembers = Workspace.view(
  {
    input: type({ workspaceId: 'string' }),
    output: MemberSummary.array(),
    invalidatesOn: [Workspace, Membership],
  },
  input => Membership
    .where(member => member.workspaceId.eq(input.workspaceId))
    .all(),
);
```

The selector form is intentionally bounded and portable. A relational query
that needs joins, aggregates, aliases, or provider SQL receives the
model-bound native database facet from managed query execution:

```ts
export const WorkspaceUsage = Workspace.query(
  {
    input: type({ workspaceId: 'string' }),
    output: WorkspaceUsageSummary,
  },
  async (input, { database }) => database
    .select({
      workspaceId: Workspace.id,
      units: sum(UsageFact.units),
    })
    .from(Workspace)
    .innerJoin(UsageFact, eq(UsageFact.workspaceId, Workspace.id))
    .where(eq(Workspace.id, input.workspaceId))
    .groupBy(Workspace.id)
    .then(exactlyOne),
);
```

`database` is hydrated from the model's typed binding; it is not selected by a
route, passed into the module constructor, or resolved from a string. The model
and its relationships remain ordinary Drizzle values.

Any browser-safe Vite module calls the same generated facade:

```ts
await Workspace.create({ slug, name });
const workspace = await WorkspaceBySlug({ slug });
```

React can optionally add reactive invocation state without changing the
callable contract:

```tsx
const createWorkspace = useOperation(Workspace.create);

await createWorkspace({ slug, name });
```

The hook returns the same callable with reactive pending/error state; there is
no `.mutate(...)`. TanStack Start adds SSR preload and hydration, but does not
own the application operation API.

Dependencies are provided once and the returned application-scoped binding is
used as the hydrated capability:

```ts
export const Payments = application.provide(
  PaymentProvider,
  StripePayments.fromSecret('payments'),
);

export async function startCheckout(input: StartCheckoutInput) {
  return Payments.checkout({
    plan: input.plan,
    returnTo: input.returnTo,
  });
}
```

Starter binds the same capability to a clearly simulated local
implementation. The application function, authority, route, and result type do
not change. Profile-dependent wiring returns the same typed binding after all
branches are proven exhaustive:

```ts
export const Payments = deployment
  .provide(PaymentProvider)
  .starter(() => LocalPayments.simulated())
  .dedicated(() => StripePayments.fromSecret('payments'))
  .external(spec => ExternalPayments.from(spec.providers.payments))
  .exhaustive();
```

Qualifiers are typed tokens rather than strings:

```ts
const PrimarySearch = SearchProvider.named('primary');
const AuditSearch = SearchProvider.named('audit');

application.provide(PrimarySearch, PostgresSearch.defaults());
application.provide(AuditSearch, OpenSearch.external());
```

Model placement uses those same typed bindings once in assembly:

```ts
const OperationalData = TransactionalDatabase.named('operational');
const AnalyticalData = AnalyticalDatabase.named('analytics');

export const Operational = deployment
  .provide(OperationalData)
  .starter(() => Postgres.local())
  .dedicated(() => Postgres.cnpg())
  .external(spec => Postgres.external(spec.providers.database))
  .exhaustive();

export const Analytics = deployment
  .provide(AnalyticalData)
  .starter(() => Postgres.analytics())
  .dedicated(() => ClickHouse.managed())
  .external(spec => ClickHouse.external(spec.providers.analytics))
  .exhaustive();

Operational.models(
  Workspace,
  Membership,
  Conversation,
  Message,
  UsageFact,
);

Analytics.models(DailyUsage, AgentLatency, WorkflowThroughput);
```

The qualifier literal creates a typed token once; application code imports the
token or returned binding rather than comparing strings. Models do not call
`.using(Postgres)`, inspect a profile, or map their fields again. A projection
targeting `DailyUsage` is assembled against the compatible analytical binding
without naming ClickHouse.

Maintained product modules require no dependency threading:

```ts
export const Conversations = application.include(conversations);
export const Usage = application.include(usage);
export const Billing = application.include(billing);
```

Billing strategy is exhaustive at the profile boundary:

- Starter uses a clearly simulated provider with production-shaped contracts.
- Developer remains simulated unless the application opts into a live
  test-mode provider.
- Dedicated requires a live provider; Stripe is maintained by default.
- External binds an externally owned live provider.
- `agenticProfilesWith({ developerPayments, dedicatedPayments,
  externalPayments })` replaces those live adapters without changing product
  models, operations, routes, usage delivery, or entitlement policy.

The uncommon module-local provider override still uses ordinary application
injection. Maintained modules export typed capability ports for dependencies
that may be rebound:

```ts
application.provide(conversations.Database, ArchiveData);
export const Conversations = application.include(conversations);
```

`conversations.Database` is a typed qualified capability, not a string or a
mutable module setting. Inclusion fails during discovery for missing or
ambiguous capabilities, dependency cycles, duplicate model/resource
ownership, or conflicting transport identities.

The maintained profile pack is included once; it obtains application identity,
installation schema, registered module models/migrations, and safe defaults
from the same graph:

```ts
application.include(agenticProfiles);

// Optional typed override; ordinary features do not import this file.
application.provide(
  StructuredGeneration.named('fast'),
  MyGenerationProvider.fromSecret('generation'),
);
```

The compiler registers their schemas and migrations, resolves their database,
events, processors, and objects from provided capabilities, and exposes only
the callable handles imported by application/browser code. A handle imported
by browser code is still unusable until its public policy or typed role/identity
binding admits the authenticated principal and trusted context.

Local and cluster development are deliberately distinct and both remain one
command:

```sh
# Official TanStack/Vite loop with credential-free development providers.
bun dev

# Build, plan, deploy, and wait for the complete Kubernetes Starter profile,
# then run the graph-owned Vite server with allowlisted source mounts.
bun dev:cluster

# Select explicitly credentialed live providers with the same source-mount
# loop. Unused providers do not demand credentials.
bun dev:live

# Explicit durable-environment lifecycle.
bun applik8s plan
bun applik8s deploy
```

`bun dev` does not mutate an ambient Kubernetes cluster. `bun dev:cluster`
uses the ordinary application graph and lifecycle rather than a second
development deployment system. The onboarding and operations UI identify
which loop and provider/profile evidence the user is observing.
The default cluster loop is credential-free. `dev:live` opts into the
Developer installation, and Stripe remains simulated unless the application
actually includes billing and selects the live adapter.

Events, batches, and projections preserve the same callback-native shape:

```ts
export const welcomeMember = Membership.on.create(async membership => {
  await sendWelcomeMessage({
    workspaceId: membership.workspaceId,
    identityId: membership.identityId,
  });
});

export const indexConversationBatch = MessagePublished.onBatch(
  { batch: { maxItems: 250, maxWait: '1s' } },
  async batch => SearchDocuments.upsert(
    batch.events.map(event => event.value),
    { idempotencyKey: batch.id },
  ),
);

export const UsageByDay = UsageRecorded.project(
  DailyUsage,
  (event, output) => output.append({
    workspaceId: event.workspaceId,
    day: event.recordedAt.slice(0, 10),
    units: event.units,
  }),
);
```

Durability is introduced only where it is semantically required:

```ts
export const ReviewDecision = workflow.signal('review-decision.v1', {
  input: ReviewRequest,
  actions: {
    approve: ApprovalInput,
    reject: RejectionInput,
  },
});

export const ReviewArtifact = type({
  artifactId: 'string',
});

export const reviewArtifact = workflow(async (
  input: typeof ReviewArtifact.infer,
) => {
  const decision = await workflow.emitSignal(ReviewDecision, {
    input,
    authorize: [Reviewer],
  });

  return (await decision()).match({
    approve: ({ principal }) => publishArtifact({
      artifactId: input.artifactId,
      approvedBy: principal.id,
    }),
    reject: ({ input: rejection }) => rejectArtifact({
      artifactId: input.artifactId,
      reason: rejection.reason,
    }),
    expired: () => expireReview(input.artifactId),
  });
});
```

Kubernetes-backed models keep the same outer experience:

```ts
export const ImportJob = application.crd('ImportJob', {
  apiVersion: 'imports.example.dev/v1alpha1',
  spec: ImportJobSpec,
  status: ImportJobStatus,
});

ImportJob.on.reconcile(async job => {
  const run = await importArtifact.start({
    jobId: job.metadata.uid,
    source: job.spec.source,
  });
  await job.track('import', run);
});
```

## Primitive vocabulary

| Concern | Canonical Applik8s surface |
| --- | --- |
| Relational state | One authoritative Drizzle-compatible `model(...)`, `field`, and `relations` declaration discovered through typed database/module binding; no app-level promotion |
| Transactional mutation | Ordinary exported functions containing `Model.edit(...)` |
| One-time read | `Model.query(...)` |
| Persistent/live read | `Model.view(...)`, browser hydration, resumable SSE |
| Domain facts | Model lifecycle streams and explicitly declared typed events |
| Batch processing | `Stream.onBatch(...)` with frozen membership and whole-batch acknowledgement |
| Durable orchestration | `workflow(...)`, direct workflow calls, `context.step(...)` |
| Human decision | `workflow.signal(...)`, `workflow.emitSignal(...)`, callable one-shot signal |
| Identity | `IdentityProvider`, canonical principal/identity references, `serviceIdentity(...)` |
| Authority | Typed operations, `Role.can(...)`, grants, receipts, scopes, revocation |
| HTTP | Compiler-generated admitted transport for callable handles; explicit named `application.http(...)` only for raw/protocol-specific routes |
| Reactive browser | `@applik8s/react`, `@applik8s/tanstack-start`, authenticated SSE |
| Infrastructure | Application-scoped bindings returned by `application.provide(...)`, typed qualifiers, one included profile pack, exhaustive installation profiles |
| Deployment | One application graph lowered through TypeKro and Alchemy |
| Operations | Maintained observations and redacted `@applik8s/operations-ui` projections |

## Product capability mapping

Status values describe the current Applik8s worktree, not the intended release:

- **Implemented** means the primitive and generated product path exist.
- **Qualified** means the implementation also has exact generated-application
  browser or live-cluster evidence.
- **Partial** means useful implementation exists but the generated product or
  end-to-end evidence is incomplete.
- **Missing** means v0.7 implementation work remains.

### Generation, onboarding, and lifecycle

| Product capability | Prior product shape | Applik8s implementation | Agentic Start product shape | Current |
| --- | --- | --- | --- | --- |
| Deterministic generation | `legacy generator registry`, app config, registry test | `ApplicationStartDefinition`, deterministic generator plan, collision refusal | Run official TanStack CLI, apply deterministic feature packs, produce identical output twice | Implemented |
| Official web foundation | `router.ts`, `ssr.tsx`, `client.tsx`, `vite.config.ts` | `@applik8s/vite`, `@applik8s/tanstack-start` | Preserve the official TanStack Start scaffold and file router | Implemented |
| Feature-first organization | agents, tools, workflows, inbox, billing, routes | Maintained modules plus application feature directories | Generated research and workspace source is organized by product feature; account protocol plumbing and runtime artifacts remain framework-owned | Implemented |
| Explicit lifecycle | `deployment.example`, TypeKro local/dev files | Applik8s CLI plan/deploy/status/destroy over one application graph | `bun run plan`, `deploy`, `status`, and `destroy` require no handwritten TypeKro | Implemented |
| Credential-free first run | local auth, billing, inference, onboarding | Starter profile and deterministic providers | One command produces a clearly non-production local application without provider credentials; the generated application is built, deployed, exercised through its owner, assistant, billing, and conversation browser journeys, and graph-destroyed on OrbStack | Implemented |
| Progressive onboarding | onboarding guide/configuration and onboarding component | Stateless Start controllers plus application-owned `OnboardingProgress`, profile diagnostics, and redacted operational observations | Product-member, workspace-owner, and separately authorized operator journeys; resume/skip/remove without exposing secrets | Partial — normative product journey and exact browser evidence remain |
| Public acquisition and admission | public landing and auth routes | Provider-neutral identity/session contracts plus generated application routes | Landing, sign-up/sign-in, verification, recovery, MFA, invitation continuation, and intended-route resumption | Partial — complete route/state matrix remains |
| Application notification delivery | invitation and transactional email seams | Existing transaction/outbox plus a bounded `NotificationDelivery` provider capability | Deterministic Starter inbox and external production delivery; identity courier remains provider-owned | Partial — capability, adapter, and live evidence remain |
| Generated-source update awareness | generator/config lineage | tracked `.applik8s-start.json` and deterministic template ownership | `applik8s start update --check` reports three-way drift, compatibility, and security relevance without rewriting source | Complete for read-only conservative update planning; automatic rewriting remains deferred |
| Safe provider configuration | onboarding configuration and runtime status | Qualified provider tokens, installation schema, profile validation | Typed Starter/Dedicated/External choices with redacted readiness and corrective diagnostics | Implemented |
| Database migrations | Drizzle migrations and `migrate.ts` | Single-definition models, generated Drizzle schema/migrations, deployment migration workload | Generated app can create, upgrade, and verify its authoritative schema | Implemented |

### Authentication, identity, and sessions

| Product capability | Prior product shape | Applik8s implementation | Agentic Start product shape | Current |
| --- | --- | --- | --- | --- |
| Email sign-up and sign-in | Better Auth adapter and auth routes | Provider-neutral identity operations through `IdentityProvider`; deterministic Starter and Ory Dedicated adapters | Ordinary typed `signUp`, `signIn`, and `signOut` calls; TanStack imports generate the admitted transport | Implemented |
| Canonical session | session route and signed cookie | The compiler-owned Fetch gateway authenticates once and emits the provider-neutral public session view; the TanStack request adapter loads that view through the in-process gateway and hydrates the React identity provider | Generated browser components use `useApplicationIdentitySession()` without provider imports or a client-only loading shell; the identity acceptance suite covers restoration, expiry, and provider transitions | Implemented |
| Local owner bootstrap | auth seed and onboarding bootstrap | Deterministic Starter identity plus an explicit application-owned bootstrap migration | The research application idempotently creates one local owner workspace, owner membership, and Starter entitlement from the exact generated application identity; the generic identity provider does not invent tenancy. Live evidence proves the state survives route reload and an exact graph reapply | Implemented |
| Secure production cookies | Better Auth production configuration | Identity adapter owns secure, expiring, HTTP-only cookie/session policy | Dedicated and External fail closed when production session configuration is incomplete | Implemented |
| Provider-neutral production identity | Better Auth implementation seam | `IdentityProvider` plus `@applik8s/identity-ory`; External accepts an owned provider binding | Application roles and operations do not import Ory types | Implemented |
| Service/workload identities | runtime actors | `application.serviceIdentity(...)`, workload principals, admission receipts | Agents, processors, workflows, and migrations receive typed identities without constructing principal-shaped objects | Implemented |

### Workspaces, membership, and application-owned tenancy

| Product capability | Prior product shape | Applik8s implementation | Agentic Start product shape | Current |
| --- | --- | --- | --- | --- |
| Workspace model | tenancy context/service and migration | Application-owned `Workspace`, `Membership`, and `Invitation` models | Generated `features/workspaces` declares the domain once with Drizzle relationships | Complete |
| Create/select workspace | tenant routes and dashboard | Direct `Workspace.create(...)`, URL-addressable selection, and a server-side membership-filtered live view; browser route state remains an untrusted selector until membership is proven | The generated Start creates workspaces directly, writes only an untrusted UUID selector cookie, validates ownership or membership in PostgreSQL, and promotes the result into trusted context with a canonical digest; the live journey rejects a forged selector | Implemented |
| Membership roles | tenant service and policy | Application roles bound to membership relationships and typed operations | Owner/admin/member roles and workspace-scoped CRUD permissions are authored in the generated feature; the live generated application creates an invitation, admits a member identity, and changes its role through direct model calls | Implemented |
| Cross-workspace isolation | tenant-scoped runtime test | Query, mutation, stream, signal, object, and command admission bind the trusted workspace scope | Reads and writes for another workspace fail through every transport | Implemented |
| Workspace dashboard | tenant/user dashboards | `Workspace.view(...)` with declared Workspace, Membership, and Invitation read dependencies | The selected route SSR-preloads a live dashboard, returns no data for a non-member, and exposes typed invitation and member-role administration only to owner/administrator roles | Implemented |

### Typed authority and product policy

| Product capability | Prior product shape | Applik8s implementation | Agentic Start product shape | Current |
| --- | --- | --- | --- | --- |
| Role-based product authority | Casbin model, seed, and checks | Typed operations, `Role.can(...)`, scope selectors, grants, receipts, revocation | Generated roles refer to callable handles rather than resource/action strings | Implemented |
| Workflow/tool admission | workflow and tool policy checks | The same operation identity is used by HTTP, MCP, agents, workflows, and direct calls | A member may call a tool or workflow only when its typed role permits that handle and scope | Implemented |
| Policy administration | role-policy routes | Runtime role/grant operations plus redacted operations UI | Administrators inspect and change bounded application policy without editing string registries | Implemented |
| Entitlement admission | billing-entitlement policy checks | `@applik8s/usage` entitlement model plus transaction-authoritative `requireActiveEntitlement(...)` | The ordinary `ResearchReview.create(...)` call is admitted inside its model transaction against the trusted workspace scope; entitlements narrow existing role authority and never manufacture identity | Implemented |
| Auditable decisions | Decision and result history | Canonical admission, grant, signal, and execution receipts | Operations UI correlates principal, role, operation, scope, decision, run, and outcome | Implemented |

### Conversations, AI, tools, and memory

| Product capability | Prior product shape | Applik8s implementation | Agentic Start product shape | Current |
| --- | --- | --- | --- | --- |
| Public safe assistant | `/chat/public` | A deliberately public typed operation with bounded deterministic Starter inference | Public chat answers onboarding questions through its generated function-native facade and cannot read private models, tools, or workspace context; the exact generated application path passes on OrbStack | Implemented |
| Conversation inbox | inbox and conversation routes | `@applik8s/conversations` models, relationships, operations, and views | Generated routes list, create, rename, archive, and select conversations through direct callable handles; before-commit policy recomputes principal scope and permits only title/archive patches; the exact generated app proves reload and graph-reapply durability | Implemented |
| Durable messages | chat service and database schema | Maintained Message model and transactional `Model.edit(...)` | User and assistant messages survive process restart and are scoped to the selected workspace | Implemented |
| Streaming response | chat routes/runtime | `@applik8s/ai-tanstack`, application events, resumable authenticated SSE | UI renders model/tool/workflow updates incrementally and reattaches after reconnect | Implemented |
| Agent execution | reviewer agent and Mastra runtime | Provider-neutral agent contract, structured generation, typed tools, execution receipts | Starter is deterministic; Dedicated uses Envoy AI Gateway; External injects an owned provider | Implemented |
| Typed tools | lookup tool | Ordinary callable operation exposed to the agent and optionally MCP | Tool input/output, authority, target, scope, attempt, and usage are inferred from one handle | Implemented |
| Durable memory | runtime snapshots and inbox | Maintained Memory model plus model queries/views | Memory is workspace/principal scoped, durable, inspectable, and excluded from public chat | Implemented |
| Search | implicit product reads | `Model.search(...)`, PostgreSQL Starter runtime, OpenSearch Dedicated runtime | Conversation and artifact search use one logical query independent of backing provider | Implemented |

### Workflows, approvals, runs, and artifacts

| Product capability | Prior product shape | Applik8s implementation | Agentic Start product shape | Current |
| --- | --- | --- | --- | --- |
| Durable review workflow | review workflow and Inngest adapter | Function-native `workflow(...)`, Hatchet provider, direct child calls, `context.step(...)` | Authored as ordinary control flow with provider-safe external effects | Implemented |
| Human approval | approval route and workflow approval | Typed signal event plus `workflow.emitSignal(...)` and callable one-shot decision | Approval appears over normal SSE; authenticated reviewer calls `signal.approve(...)` or `reject(...)` | Implemented |
| Run list/detail/events | run routes and admin pages | Workflow observations, maintained run/event models, operations UI | User-scoped run pages and administrator control center use redacted views | Implemented |
| Idempotent workflow start | workflow request id | Operation idempotency plus workflow occurrence identity | Duplicate browser/agent/MCP submissions return the same accepted run | Implemented |
| Cancellation and replay | runtime run controls | Typed workflow-run cancellation, bounded provider retries, idempotent occurrence identity, and authority receipts | v0.7 deliberately does not expose unsafe generic history replay: callers cancel an eligible run or start/adopt an explicitly keyed occurrence, while provider retry topology stays hidden | Implemented |
| Worker exclusion | runtime leases | Workflow provider plus Applik8s deployment/consumer concurrency contracts | Duplicate workers cannot execute the same admitted step concurrently | Implemented |
| Artifact provenance | artifact plan | `@applik8s/artifacts`, object storage intent, causal references | Metadata is relational; bytes use object storage; run/step/principal provenance is retained | Implemented |
| Evaluation history | review evaluator | `@applik8s/evals` models and callable evaluation workflows | Datasets, cases, scorers, runs, and results are inspectable from the control center | Implemented |

### Usage, entitlements, and billing

| Product capability | Prior product shape | Applik8s implementation | Agentic Start product shape | Current |
| --- | --- | --- | --- | --- |
| Usage facts | usage dashboard and provider status | `@applik8s/usage` UsageFact model populated from AI/tool/workflow observations | Dashboard reports bounded provider/model/operation usage without exposing credentials | Implemented |
| Entitlements | billing entitlement route | Maintained Entitlement model plus typed operation admission | Application plans map to provider-neutral capability limits and periods | Implemented |
| Credential-free local billing | local billing provider | Provider-neutral billing interface with an in-memory/PostgreSQL Starter adapter | Checkout and portal flows are visibly simulated and non-production; both pass through the generated browser, HTTP worker, qualified provider binding, and Starter adapter on OrbStack | Implemented |
| Checkout and portal | billing service/routes | Ordinary exported `startCheckout`/`openBillingPortal` functions call the framework-hydrated `PaymentProvider`; qualification selects the implementation inside managed execution | Routes call the ordinary functions directly without Stripe types, selector dispatch, or command envelopes; exact generated-application browser evidence passes | Implemented |
| Stripe integration | Stripe adapter and signed webhook | `@applik8s/billing-stripe` server-only adapter; secret references and raw-body verification | Dedicated/External may inject Stripe; missing credentials fail closed; webhook input is authenticated before event publication | Implemented |
| Subscription → entitlement projection | webhook handling and dashboards | Transactional webhook event, idempotent processor, Entitlement projection | Duplicate/out-of-order provider events cannot regress canonical entitlement state | Implemented |
| Billing dashboard | billing dashboard | Application plan/catalog models, `Model.view(...)`, usage and entitlement relationships | The live generated dashboard renders provider-neutral plans, subscription state, usage, and the Starter research-review entitlement, then exercises simulated checkout and portal calls | Implemented |

### Operations, security, and distribution

| Product capability | Prior product shape | Applik8s implementation | Agentic Start product shape | Current |
| --- | --- | --- | --- | --- |
| Health/readiness | health and runtime routes | Provider observations, workload readiness, migration state, consumer lag, workflow health | `/healthz` is liveness; readiness and degraded dependencies are separately projected | Implemented |
| Operations control center | admin routes and dashboards | `@applik8s/operations-ui` redacted snapshot and typed administrative operations | One maintained route covers runs, providers, consumers, projections, authority, identity, storage, and gateways | Implemented |
| Browser secret safety | server boundaries and onboarding redaction | Browser/server import zoning, explicit public schemas, taint/redaction checks | Packed browser chunks contain no credentials, Kubernetes clients, provider clients, or raw evidence | Implemented |
| Request authenticity | auth server routes | Framework-derived principal and trusted context; client payload cannot claim actor/workspace | Every HTTP, SSE, signal, object, and operation path shares admission semantics | Implemented |
| Provider failure safety | blocked Stripe and skipped AI status | Profile validation, provider readiness probes, fail-closed external bindings | Unconfigured production providers block readiness with actionable diagnostics rather than silently emulating success | Implemented |
| Packed consumer | generated package and build | Coordinated packages, browser-safe exports, real compiler discovery | Clean generated app installs only published/packed packages, builds, plans, and compiles | Implemented |
| Kubernetes lifecycle | TypeKro local/dev infrastructure | Application graph → TypeKro → Alchemy with owned/external lifecycle contracts | Apply, no-op, update, resume, destroy, retained data, and external ownership are exact-candidate tested | Implemented |

## Explicit Applik8s v0.7 extensions

These are deliberate improvements that make sense for a production-oriented
Agentic Start:

| Extension | Primitive implementation | Reason |
| --- | --- | --- |
| Email verification and password recovery | Maintained `AgenticAccountSettings` calls provider-neutral bounded flows; Ory/native data remains server-side | A production identity start should not stop at sign-up/sign-in parity |
| MFA and recovery codes | Maintained `AgenticAccountSettings` uses the provider-neutral enrollment capability; Dedicated/External translate to Ory and Starter remains deterministic | Dedicated profile already claims production identity |
| Session/device administration | Provider-neutral session views and typed revoke operations validate ownership before provider revocation | Users need visibility and bounded revocation |
| Workspace invitations | Application-owned Invitation model, typed signal/event delivery, single-use acceptance operation | Natural completion of the committed workspace baseline |
| Versioned plan/catalog and metering | Provider-neutral version, price, customer, item, meter, and idempotent delivery-ledger models; application-owned seeded plans | Keeps pricing/product policy out of the framework while making billing usable |
| Search across conversations/artifacts/runs | One logical model search contract with PostgreSQL/OpenSearch providers | Demonstrates provider multiplexing without changing application queries |
| MCP exposure of authorized tools | The same callable tool handles and operation authority | Makes the starter genuinely agentic rather than merely chat-enabled |
| Projection-backed live dashboards | `Model.view(...)`, projections, rebuild authority, resumable SSE | Demonstrates the function-native reactive thesis |
| Complete deployment profiles | Starter, explicit non-production Developer, Dedicated, and External from one installation schema; TypeKro hot reload remains an independent deployment aspect | Earlier prototypes required handwritten local/dev TypeKro files |

## Generated application shape

The generated application should remain readable, but the previous global
`15 files / 600 integration lines` target is not an excuse to omit product
features. v0.7 measures:

1. application-owned source separately from generated route adapters;
2. maintained module code separately from application glue;
3. no copied provider/runtime implementation;
4. one obvious file for each application-owned concern;
5. generated adapters that are mechanical, readable, and replaceable.

The intended application-owned files are approximately:

```text
src/
  app.ts
  installation.ts
  providers.ts
  application.ts
  roles.ts
  modules.ts
  features/
    workspaces/{model,operations,view}.ts
    billing/{model,plans}.ts
    assistant/{agent,tools,workflow}.ts
  routes/                    # ordinary thin TanStack route adapters
```

Conversations, approvals, artifacts, evaluations, usage, operations, identity
runtime, billing provider plumbing, AI transport, search runtime, object
transport, and workflow provider glue remain maintained packages.

## Generator convergence achieved

The v0.7 generator now enforces the target authoring surface:

- maintained modules are included directly and hydrate their declared
  dependencies from the selected application profile;
- model declarations contribute their relational schema without a second
  registration or promotion call;
- imported callable handles are discovered by the compiler, so application
  authors do not maintain command, query, subscription, or authorization
  registries;
- identity, authority, idempotency, provider selection, and trusted context are
  framework-derived at the managed boundary;
- Vite and the selected profile infer the application host, processors,
  containers, and infrastructure graph;
- `provide(...)` and typed qualifiers bind application-scoped capabilities
  without string selection or provider imports in feature code;
- account security is a maintained component, leaving the generated account
  route as a replaceable three-line adapter;
- Starter, Developer, Dedicated, and External use one installation schema;
  local source mounting remains an explicit deployment aspect rather than an
  application runtime fork.

Transport-level admission remains compiler-owned. The application author sees
typed roles, callable handles, framework-derived principals, and ordinary
TanStack routes.

## Release qualification

The implementation surface is converged. The release retains these evidence
and product-hardening gates:

1. retain exact packed-consumer and official TanStack generation/build gates;
2. keep the research starter's workspace, assistant, billing, conversation,
   workflow/signal, artifact, usage, and operations journeys green on OrbStack;
3. keep the smaller product starter's causal agent, simulated billing, and
   maintained account journeys green on OrbStack;
4. run browser zoning, identity profile, TypeKro/Alchemy lifecycle, performance,
   and release-scorecard gates against the same commit;
5. require current exact-candidate receipts and explicit maintainer review
   before publishing the v0.7 tag.

The maintainer completed that review and explicitly authorized v0.7.0 on
2026-08-18. The publication workflow must still prove the tag, packages,
operator-host image, and published-consumer build before reporting success.

## Acceptance matrix

Parity requires executable generated-application journeys, not source markers:

1. Generate twice from the official TanStack CLI and prove deterministic
   Applik8s augmentation.
2. Start credential-free, bootstrap an owner and workspace, and prove no secret
   is returned or rendered.
3. Sign in, restore an SSR session, create/select a workspace, and reject a
   cross-workspace read.
4. Create a private conversation, stream an assistant response, invoke an
   authorized tool, persist messages/memory, and observe usage.
5. Start the durable review workflow twice with one idempotency key, receive a
   typed signal over SSE, approve it as the authenticated reviewer, and observe
   the completed run and artifact.
6. Reject an unauthorized workflow/tool/signal call and correlate the denial
   receipt in the operations control center.
7. Exercise local billing, then verify the Stripe adapter rejects an invalid
   signature and applies a valid provider event idempotently without exposing
   credentials.
8. Build from clean packed packages, run migrations, deploy each applicable
   profile, update it, resume after interruption, and destroy it through the
   Applik8s lifecycle.
9. Prove browser bundle zoning, redacted public schemas, authenticated SSE
   resumption, CSRF/origin policy, and context-bound cursors.

The scorecard may mark the Agentic product baseline complete only after the
capability map, generated behavior fixture, and applicable live/browser
journeys all pass against one commit.
