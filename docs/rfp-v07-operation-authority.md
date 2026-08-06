# RFP: Applik8s v0.7 — Typed Operations and Authority

**Status:** Proposed; maintainer review required

**Charter:** [`charter-v07-agentic-platform.md`](charter-v07-agentic-platform.md)

**Depends on:** Existing v0.6 model operations, durable commands, trusted request context, workflows,
queries, streams, and application graph

**Unblocks:** Search authorization, agent tools, MCP exposure, Agentic Start permissions, and the agentic
identity acceptance application

## Purpose

Make every externally meaningful application behavior a stable typed operation and make authorization a
property of those existing operations. Static application policy and runtime-created permissions must
share one canonical, auditable, lifecycle-aware authority without introducing a second command surface or
policy graph.

This RFP is the semantic spine of v0.7. Provider-specific identity, OAuth, gateway, and relationship
systems may admit principals or project decisions, but they do not own canonical application grants.

## Required developer experience

Ordinary model behavior gains authority at the boundary where it is deliberately admitted or exposed,
without a parallel command or operation-definition API:

```ts
export async function deployApplication(
  input: typeof DeployInput.infer,
): Promise<typeof DeployOutput.infer> {
  return Application.edit(input.applicationId, async application => {
    const requestId = Id.create("deployment");
    await application.update({
      desiredVersion: input.version,
    });
    DeploymentRequested.emit({
      requestId,
      applicationId: application.id,
      version: input.version,
    });
    return { requestId };
  });
}

Administrator.can(
  Application.read.all(),
  deployApplication,
  {
    target: Application.where(application =>
      application.environment.ne("production")),
  },
);

const ReleaseAgentIdentity = application.serviceIdentity("release-agent");

ReleaseAgentIdentity.mayRequest(
  deployApplication,
  {
    target: Application.where(application =>
      application.environment.eq("production")),
    approval: ProductionOwner,
    expiresIn: "15m",
    maximumUses: 1,
    outcome: DeploymentHealthy,
  },
);
```

Tool visibility remains separate:

```ts
const ReleasePlannerTools = [
  Application.read,
  deployApplication,
] as const;
```

This is deliberately tool-availability metadata, not an executable agent declaration. The AI RFP owns
the agent closure and TanStack execution shape. A concrete execution principal may invoke
`deployApplication` only
after the authority service resolves a compatible static or runtime grant.

The same authority facet attaches to Kubernetes-resource operation handles without pretending that a
watch handler is a relational transaction:

```ts
const ImportSubmitter = application.role("import-submitter");
const ImportAdministrator = application.role("import-administrator");

ImportSubmitter.can(ImportJob.create);
ImportAdministrator.can(
  ImportJob.update.all(),
  ImportJob.delete.all(),
);

export const initializeImport = ImportJob.on.create(
  { namespace: application.installation.spec.name },
  async (created, context) => {
    created.status.phase = "Pending";
  },
);
```

`ImportJob.create/update/delete` are invocable operations and can be enforced for direct Kubernetes
writes through the optional admission integration. `ImportJob.on.create` consumes an observed lifecycle
fact as a workload identity; it is neither granted to the initiating user nor exposed as a callable
operation.

`application.role(...)` declares what a provider role means; it is not a role
claim parser. `principal.roles` may be populated only by the selected
server-side identity adapter from provider-verified evidence. Browser input,
route payloads, signal action payloads, and arbitrary trusted-context fields
cannot assign a role. The maintained Ory adapter derives roles from the
verified Kratos identity and rejects malformed role claims before principal
admission. The resulting authorization receipt records the exact static
permission matched through the admitted role, with no invented grant.

An externally authenticated machine gets the same concise, typed authority
surface without naming its provider:

```ts
const ReleaseAutomation = application.oauthClient(
  "release-automation",
  { issuer: "https://identity.example.test" },
);

ReleaseAutomation.can(Application.deploy.all());
```

`oauthClient(...)` binds the exact provider-asserted issuer and client subject
to a canonical workload identity. The issuer participates in the identity
digest, so a same-named client from another authorization server receives no
authority. Ory, Zitadel, or another OAuth implementation may admit the token;
none of them owns the application permission model. MCP resource, audience,
scope, expiry, and revocation validation occur before this static grant can
match.

Runtime administration composes the same deployed operation handles:

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

Possessing permission to invoke an operation does not imply authority to delegate it:

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

Relationships may derive lifecycle-bound grants:

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

The public documentation and generated Start use progressive disclosure:

1. **Static assignment:** `Administrator.can(Post.delete)` is the ordinary path.
2. **Runtime administration:** named permissions and bounded assignment appear only when an application
   needs runtime-managed roles.
3. **Delegation and governed effects:** grant requests, approvals, reservations, outcomes, and
   revocation frontiers appear only for temporary, delegated, or irreversible authority.

The complete authority model remains available without requiring simple applications to configure every
concept.

“Operation” remains the normalized catalog, authorization, receipt, and audit term. It is not a public
behavior-definition wrapper. A function acquires an internal stable operation identity only when it is
registered at a framework boundary, exposed through HTTP/MCP/agent tooling, or used as a durable
workflow step. The compiler derives that identity from its exported symbol, module, schemas, target
model, and explicit compatibility revision.

The v0.6 `.action(...)`, draft `.operation(...)`, and low-level model command registries are removed
from the public API before v0.7. There are no external consumers that justify preserving a misleading
compatibility surface. Historical `/actions/` catalog references remain relevant only to explicit
data-migration tooling; newly emitted catalog identities use `/operations/` because that is the
authority concept, not the authoring syntax.

Application models retain one authoritative `model()` definition. Qualified bindings derive native
relational, Kubernetes, analytical, index, or document facets without a second field map. The
authorizable facet attaches to the resulting CRUD handles and deliberately exposed domain functions;
this RFP does not translate provider-specific execution guarantees into one lowest-common-denominator
runtime.

The shared operation vocabulary does not erase model-kind execution semantics:

| Model authority | Invocable operations | Reactive lifecycle | Execution guarantee |
| --- | --- | --- | --- |
| Relationally bound application model | Derived CRUD and deliberately exposed domain functions | Committed `on.create`, `on.update`, `on.delete`, and admitted-function completion streams | `Model.edit(...)` closures run in the declared authoritative database transaction and may emit only declared transactional outbox work. |
| ArkType-backed CRD/resource | Typed create, update, delete, status, and explicitly declared resource operations | Kubernetes create/update/delete/reconcile/watch handlers | Kubernetes optimistic concurrency, admission, status ownership, finalizers, and inferred RBAC remain authoritative; no relational transaction is implied. |
| Framework entity/document model | Only operations supported by its bound model-store capability | Its existing committed lifecycle surface | The selected provider contract determines transaction and change-frontier guarantees; unsupported facets are absent. |
| Analytical model/projection | Declared reads, aggregates, rebuild, and projection-control operations | Declared ingestion/checkpoint events | It is not canonical transactional write authority unless a separate capability explicitly says so. |

Lifecycle handlers consume facts, authenticate through stable workload identities, and execute under
per-delivery principals; they are not themselves invocable permissions. Authority applies to the
operation that produced a fact, to protected work performed by the handler, and to admission of direct
resource mutations. A provider may expose a common facet only when it can prove the required identity,
revision, consistency, and change-frontier guarantees.

## Invocation, dependency, and closure grammar

All invocable handles use one execution model:

```text
await Handle(input)
  canonical authoring form at application entry and inside managed closures

await context.operations.name(input)
await context.queries.name(input)
await context.tasks.name(input)
  migration aliases only; they lower to the same internal invocation
```

The compiler statically discovers every imported exposed function, query, workflow, or other callable
handle called by an executable closure, including calls through included module-local helpers. It
proves the complete
input expression, target, call site, and bounded authority, then lowers the call through the internal
invocation primitive and normalized `ExecutionBinding`. Dynamic imports, reflective handle selection,
unresolved calls, and authority wider than the enclosing workload fail compilation.

Generated aliases preserve compatibility and the underlying handle's execution semantics but do not
define the golden path or create another invocation system. Framework-owned operation adapters such as
`Operation.http()` and MCP tools record the same dependency during graph construction.

Transaction-local state mutation and fact production are intentionally not nested result-bearing
invocations. `subject.patch(...)`, direct `Event.emit(...)`, lint-safe `void Command(...)` staging, and
typed reconciliation-plan mutation retain their transaction/outbox/operator semantics. The compiler
infers those statically reachable event and command contracts. `context.emit(...)` and
`context.send(...)` remain compatibility spellings, while `await Command(...)` fails discovery because
the nested command has no result until the owning transaction commits.

The authored closure grammar is:

```ts
// Ordinary domain behavior with an explicit model transaction
async (input) => Model.edit(input.id, async subject => {});

// Free query, workflow step, or agent
async (input, context) => {};

// Committed lifecycle or stream observation
async (event, context) => {};

// Raw HTTP route
async (request, context) => {};

// Reconciler
async (resource, context) => {};
```

Lifecycle `event` values retain their meaningful typed shapes, including `previous`, `current`, `value`,
result, revision, causation, or tombstone where applicable. Normalization standardizes argument roles and
context position; it does not flatten distinct facts into one generic subject.

### Exact execution binding

> Statically reachable calls plus any explicit fail-closed maximum envelope authorize a task,
> workflow, processor, or reconciler workload identity to invoke exactly those operations under their
> proven input, target, and scope constraints. They grant no delegation authority, user impersonation,
> alternate transport access, or undeclared operation. The resulting workload authority is serialized
> in the application graph and deployment plan.

The stable workload grant is the maximum envelope, distinct from authority to start that task/workflow,
the causal end-user's authority, and the effective authority of any concrete execution. Dependency
bindings record the complete callee-input fields and provenance from validated task input, event data,
or the reconciled resource:

```ts
await Source.completeObservation({
  sourceId: task.sourceId,
  requestId: task.requestId,
  evidenceCount,
});
```

The compiler lowers that complete expression to one internal `ExecutionBinding` containing the
operation handle, execution-source kind, serializable field provenance, and statically known keys.
`onInput(...)`, `onEvent(...)`, and `onResource(...)` remain typed partial-application compatibility
forms during migration; they are no longer required public ceremony for new source.

The compatibility methods' conceptual type contract is:

```ts
interface ExecutionBindable<TInput> {
  onInput<const TReturned extends object>(
    project: StaticKeyProjection<TaskInput, TInput, TReturned>,
  ): BoundDependency<this, ExactBoundKeys<TInput, TReturned>>;

  onEvent<const TReturned extends object>(
    project: StaticKeyProjection<ProcessorEvent, TInput, TReturned>,
  ): BoundDependency<this, ExactBoundKeys<TInput, TReturned>>;

  onResource<const TReturned extends object>(
    project: StaticKeyProjection<ReconciledResource, TInput, TReturned>,
  ): BoundDependency<this, ExactBoundKeys<TInput, TReturned>>;
}
```

`StaticKeyProjection` is a type-and-compiler contract, not merely
`TBound extends Partial<TInput>`. Inference begins from the callback's concrete `const TReturned` object
and validates that exact shape against `TInput`; it must not contextually widen the callback result to a
partial input. `ExactBoundKeys` rejects unknown, optional, or value-incompatible properties and derives
the alias omission set from the concrete returned keys. Compiler normalization independently proves the
same exact key set from the closure IR. Values may vary by execution, but key presence may not:

```ts
// Accepted: one fixed key whose value varies.
Source.read.onInput((task) => ({
  sourceId: task.preferredSourceId ?? task.fallbackSourceId,
}));

// Rejected: the key set varies by execution.
Source.read.onInput((task) =>
  task.scoped ? { sourceId: task.sourceId } : {},
);
```

All reachable return branches must produce the same statically known keys. Unresolved object spreads,
computed keys, conditional property insertion, optional returned properties, and helpers whose complete
return-key set cannot be normalized are rejected. The normalized `ExecutionBinding` records those exact
keys and its revision. Compiler behavior may not infer a broader `Partial<TInput>` key set from a widened
TypeScript type.

The concrete source type is inferred from the enclosing task/workflow, processor, or reconciler. These
methods declare how a dependency is bound by that execution; they do not register an event handler.
Handler registration retains the existing `process(...)`, lifecycle `on.create`/`on.update`/`on.delete`,
workflow, and reconciler APIs.

The projection is deterministic, serializable, side-effect free, and restricted to fields available in
the declared execution contract. The runtime evaluates it once when admitting the execution, combines
its result with caller-supplied unbound fields, validates the complete operation input, derives the
canonical operation target, and stores the normalized input/target/scope in the execution principal and
authorization receipt. Every protected invocation reauthorizes against that principal.

The generated alias schema omits every exact bound key and remains closed to those keys at runtime. An
untyped, JavaScript, stale, or malicious caller that supplies a bound key fails before merge with a
stable bound-field-override diagnostic; the runtime never silently strips the caller value and never
lets it replace the execution-derived value.

These methods construct dependency bindings only; they do not register another operation, create an
application permission, or change the underlying handle's stable catalog identity. Their input type is
derived from the enclosing managed closure contract, so using one outside the corresponding managed
dependency declaration or returning incompatible fields fails type checking.

The complete normalized input participates in schema validation, target resolution, idempotency,
ordering, command/result identity, causal audit, and authorization. A binding revision is part of the
dependency-plan revision, so changing it produces an authority and deployment diff.

### Monotonic scope composition and terminal binding

Static target and scope restrictions are selected before execution binding:

```ts
Evidence.create
  .where((evidence) => evidence.classification.ne("secret"))
  .onInput((task) => ({
    sourceId: task.sourceId,
  }));

Project.comment
  .on(project)
  .onEvent((event) => ({
    body: event.comment,
  }));

Source.read
  .all()
  .onResource((resource) => ({
    sourceId: resource.spec.sourceId,
  }));
```

The public grammar is:

```text
operation
  -> optional target selector: on(ref) | all()
  -> zero or more intersected where(predicate) scopes
  -> optional terminal execution binding: onInput | onEvent | onResource
```

`where(...)` may also begin directly from an unscoped operation. `.on(ref)` and `.all()` are mutually
exclusive target selectors. Multiple `where(...)` predicates combine with logical AND. Once an
execution binding is applied, the returned `BoundDependency` exposes no `.on()`, `.all()`, `.where()`,
or additional execution-binding methods. A dependency that needs no execution-derived fields may end
after its static target/scope.

Every method is monotonic: it adds a restriction and cannot replace or weaken an earlier one. Effective
authority is always the intersection of the base operation, explicit target selector, every static scope
predicate, execution-bound complete input and derived target, workload envelope, active catalog and
authority revisions, and any compatible explicit grant. A conflict between a static target/scope and
the completed execution-derived input fails closed; it does not choose one branch. `plan`, `explain`,
receipts, and audit preserve every constituent restriction and the normalized intersection.

The compiler may infer a binding only when it can prove the complete field projection from the validated
task input, event, workflow step, or resource. Inference is serialized into the application graph and
displayed with provenance by `plan` and `explain`. Ambiguity fails compilation with a diagnostic
suggesting an explicit binding or deliberately broad authority:

```ts
queries: {
  source: Source.read.all(),
},
```

`.all()` explicitly selects the complete target universe inside the declared operation, audience,
transport, installation, and trusted-context envelope. It is available only at the target-selection
stage and cannot replace an earlier target or predicate. It grants no delegation, impersonation,
caller-authority inheritance, or access to another operation or transport. An unbound bare dependency
may not silently mean `.all()`.

An execution binding proves the provenance of its bound fields and causally associates the complete
invocation with the parent execution. It does not claim that arbitrary unbound computed values were
mathematically derived from parent data; applications requiring that guarantee use a deterministic
transformation, validator, or independent outcome contract.

Removing or narrowing a dependency produces an authority and deployment-plan diff and revokes the
obsolete workload envelope through the normal catalog lifecycle. Provider capabilities declared under
`requires` authorize access only to that injected capability; they do not imply application-operation
authority.

## Owned contracts

This RFP owns:

- the authorizable operation facet on CRUD, named model/resource operations, queries, subscriptions,
  workflow operations, raw routes, adapted HTTP transport bindings, MCP exposures, and optional
  Kubernetes admission operations;
- stable operation IDs, versions, replacement metadata, and catalog revisions;
- normalized principals and identity references;
- permissions, roles, grants, delegation, grant requests, approvals, outcomes, revocations, and audit;
- static declaration reconciliation and runtime permission creation;
- target and relationship scopes;
- authorization receipts and revalidation for durable work;
- transport constraints and nested-operation reauthorization;
- statically discovered direct/internal invocation lowering, compatibility dependency aliases, and
  generated least-privilege workload authority;
- stable workload identities, the public `ExecutionPrincipal` contract, diagnostic execution kinds,
  internal `ExecutionBinding` IR, exact statically proven bound-key sets, monotonic
  field/target/scope composition, terminal bound dependencies, and execution authorization receipts;
- grant-use reservation and consumption;
- operation-catalog staging, activation, migration, and retirement.

It does not own:

- login, identity lifecycle, OAuth protocol, or account UI;
- provider SDKs or provider-specific decision shapes;
- AI chat/tool protocols;
- OpenSearch document filtering;
- product tenancy, organization, billing, or membership schemas.

## Authorizable operation contract

Every existing operation surface implements one common facet:

```ts
interface AuthorizableOperation<TInput, TOutput, TTarget = unknown> {
  readonly authority: OperationAuthorizationContract<TTarget>;
  readonly permission: OperationPermission<this>;

  requires(permission: PermissionDefinition): this;
  public(): this;
  all(): ScopedOperation<this>;
  on(target: ModelReference<TTarget>): ScopedOperation<this>;
  where(scope: ModelScopePredicate<TTarget>): ScopedOperation<this>;
  authorize(options: AuthorizationLifetime): this;
}
```

This extends rather than wraps:

- native-model `create`, `read`, `update`, and `delete`;
- named model and Kubernetes-resource operations;
- queries, indexed searches, and subscriptions;
- workflow start, signal, result-read, and cancellation;
- named and raw HTTP routes;
- MCP tool exposures;
- optional Kubernetes create, update, delete, and status admission operations.

The direct model method remains static and handle-based:

```ts
await Source.observe({ sourceId, reason: "manual" });
```

Rows and resource snapshots do not become hidden active-record objects merely to support authority.
Transport, tools, policies, and grants all reference the same `Source.observe` handle.

An externally reachable operation must be explicitly public, statically assigned, declared runtime
grantable, or protected by a supplied application policy. Production builds fail on unclassified
reachable operations. Health and readiness endpoints are explicitly public and limited to
non-sensitive status.

## Principal and execution identity model

The implementation must distinguish:

```text
AgentDefinition
  instructions, logical model, declared tools, default execution profile

ServiceIdentity
  logical non-human application identity
  stable baseline application authority independent of runtime placement

WorkloadIdentity
  stable identity authenticating a deployed agent, task, workflow, processor, or reconciler runtime
  maximum declared operation, target, scope, audience, and transport envelope

ExecutionPrincipal
  one admitted execution
  kind: agent | task | workflow | processor | reconcile
  exact task input, workflow step, event delivery, or resource/reconcile frontier
  causal principal and grant chain as audit context, never ambient authority
  normalized bound input, target, and scope derived from that execution
  expiration, cancellation, audience, catalog revision, and independent revocation revision

Diagnostic branded kinds
  AgentRunPrincipal | TaskRunPrincipal | WorkflowRunPrincipal |
  ProcessorRunPrincipal | ReconcilePrincipal
```

An `AgentDefinition` is not automatically an authorization principal. A Start may associate it with a
logical `ServiceIdentity` for baseline application authority, while the deployed server authenticates
through a `WorkloadIdentity`; each run receives a distinct `ExecutionPrincipal` with diagnostic kind
`AgentRunPrincipal`. Audit records must preserve the human or workload requester, agent definition,
concrete run, logical service identity, deployed workload identity, and grant chain without collapsing
them into one string.

The same identity separation applies to every generated runtime. An optional logical `ServiceIdentity`
owns reusable baseline application authority. A `WorkloadIdentity` authenticates the deployed process
and defines its maximum dependency envelope; it is not the effective principal of each delivery. Every
admitted task, workflow step, event delivery, or reconcile attempt receives a concrete
`ExecutionPrincipal` whose input, target, and scope are the intersection of the workload envelope, the
execution-bound dependency expressions, the active catalog/authority revision, and any explicitly
delegated grant required by the operation.

Kubernetes ServiceAccounts, workload credentials, and generated RBAC enforce the infrastructure
envelope. The Applik8s operation runtime enforces input/event/resource-specific narrowing because
Kubernetes RBAC cannot express a different model target for every delivery. Revocation or cancellation
prevents subsequent protected operations; it does not claim to undo an already committed transaction or
external effect.

The operation/authority layer is the sole owner of the canonical `Principal` and `IdentityReference`
contracts used by authorization, durable receipts, audit, and operation execution. The identity/OAuth
layer owns authentication flows, provider sessions, credential validation, and adapters that produce an
admitted `Principal`; MCP owns transport admission into that same contract. Neither adapter defines a
parallel principal type.

The normalized principal contract supports human, pre-authentication-flow, authenticated
OAuth-authorization-flow, service, workload, execution, OAuth-client, and MCP-client identities.
Execution principals carry a diagnostic kind rather than defining five unrelated public principal
contracts. The contract records issuer, subject, authentication method,
session/client/run/delivery/resource/flow reference, audience, admitted trusted-context digest, and
authorization revision. Provider-specific profile, session, token, flow, or relationship shapes remain
outside the contract.

## Stable operation catalog

Every operation has an explicit stable name and serialized ID:

```text
applik8s://models/Application/operations/deploy
applik8s://queries/EvidenceSearch/search
applik8s://workflows/Observation/start
applik8s://http/api/routes/administration.disable-user
```

The catalog records schemas, declared errors, target identity, transport aliases, handler placement,
authorization lifetime, grantability, delegation policy, effects, deprecation, and replacements.

Variable names and source locations must not become public IDs. Raw HTTP path and method may appear as
diagnostic metadata, but named route groups and named routes provide migration-safe identity.

### Catalog activation

Rolling deployment is a state transition:

```text
proposed
  -> staged
  -> compatibility and grant migration validated
  -> admission revision activated
  -> previous revision draining
  -> previous revision retired
```

The authority service must:

- admit new operations only against the active revision;
- allow compatible in-flight work to finish against a recorded prior revision;
- fail closed when a durable envelope references an incompatible retired operation;
- prevent two application revisions from silently assigning different semantics to the same ID/version;
- produce a migration report for renamed, removed, narrowed, or broadened operations;
- retain sufficient catalog history to explain every non-expired grant and durable command.

## Canonical authority records

Static and runtime records use the same models but retain ownership:

```text
origin: application
  reconciled from a versioned application manifest
  immutable to runtime administration

origin: runtime
  created through protected operations
  lifecycle owned by the creating application object or explicit administrator
```

Runtime records may not shadow, mutate, or reuse the identity of application-owned records. Removing a
static declaration produces an explicit revocation/migration plan; absence from a new manifest must not
silently delete authority while old application revisions are still active.

PostgreSQL is the default canonical store for application permissions, grants, reservations,
revocations, and authority revisions. Static application declarations reconcile into that store through
versioned manifests. External policy and relationship systems consume a committed outbox and report
their applied frontier. They may fail a request closed when required, but they do not independently
create application authority.

Permission administration is itself expressed through protected operations:

```text
Permission.create
Permission.update
Permission.retire
Grant.assign
Grant.extend
Grant.revoke
GrantRequest.approve
GrantRequest.reject
Delegation.assign
```

Static definitions are immutable through these runtime operations. Runtime definitions may select only
active catalog operations and bounded scope forms declared grantable by those operations.

## Grant-use lifecycle

Bounded-use grants require transactionally serialized reservations:

```text
available
  -> reserved(commandId, operationId, target, authorizationRevision)
  -> consumed
  -> outcomePending
  -> outcomeVerified | outcomeFailed | expired
```

A reservation may be released only before the protected effect boundary and according to declared retry
semantics. Retrying the same idempotency key reuses the reservation. A different idempotency key competes
for another use. An uncertain external effect does not automatically restore a use.

The audit history records reservation, execution, consumption, retry, outcome observation, revocation,
and expiration as distinct facts.

## Independent outcomes

An outcome event emitted by the protected operation cannot prove its own success. Outcome definitions
must identify an authoritative verifier:

```ts
const DeploymentHealthy = application.outcome("deployment-healthy", {
  subject: Application,
  observe: Application.health,
  accepts: (health) => health.ready.eq(true),
  verifier: DeploymentObserver,
  timeout: "10m",
});
```

The verifier must be a deterministic query, independent workload identity, or separately authorized
observation. Outcome failure, timeout, and unverifiable state have explicit escalation behavior.

## Enforcement boundaries

Protected operations declare checks at one or more boundaries:

- admission;
- enqueue;
- execution;
- protected external step;
- pre-commit;
- result read;
- subscription resume.

Mutations default to admission plus pre-commit. Irreversible external workflow effects require a
protected-step check. Query cursors and subscriptions bind to principal, trusted-context digest,
authorization revision, operation revision, and provider generation.

A nested direct-handle call always reauthorizes through the internal invocation boundary. Entry through
an authorized raw route does not lend the handler ambient authority.

A model operation closure is transaction-authoritative and may validate, derive, mutate declared
transactional state, emit declared outbox events, and enqueue declared transactional commands. It may
not call AI, HTTP, object storage, Kubernetes, or a workflow engine directly. Post-commit processors,
tasks, and workflows perform those effects under their own workload identity and authorization receipt.

Durable command envelopes persist an authorization receipt containing the operation/catalog revision,
principal, trusted-context digest, matched permission and grant, target, scope evidence, authority
revision, admission time, expiration, and reservation. Revalidation never trusts a previously serialized
boolean decision.

### HTTP routes

Route declarations distinguish raw route operations from transport bindings of existing operations:

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
  group(
    name: string,
    options: { prefix: string },
  ): HttpRouteGroup;

  /** @deprecated Compatibility only; new routes require an explicit stable name. */
  get(path: string, handler: ApplicationRouteHandler): RawHttpRoute;
  /** @deprecated Compatibility only; new routes require an explicit stable name. */
  post(path: string, handler: ApplicationRouteHandler): RawHttpRoute;
}
```

```ts
application.http("api", (http) => {
  const Administration = http.group("administration", {
    prefix: "/admin",
  });

  Administrator.can(
    Administration,
    http.match.get("/operations/**"),
  );

  Administration.get("users", "/users", listUsers);
  const DisableUserRoute = Administration.post(
    "disable-user",
    "/users/:id/disable",
    User.disable.http(),
  );
});
```

`DisableUserRoute` is an `HttpOperationBinding<typeof User.disable>`, not an independent operation.
Granting it is equivalent to granting the existing operation through exactly that route:

```ts
Administrator.can(
  User.disable.via(DisableUserRoute),
);
```

Granting `Administration` expands raw members to their raw-route operations and adapted members to their
underlying operations constrained to the corresponding HTTP bindings. It does not grant `User.disable`
through direct invocation, MCP, workflows, or another route, and it does not require a redundant second
permission for an invented route operation.

Named raw routes and all bindings have stable transport identity. `*` matches exactly one path segment
and `**` matches descendants. Selectors resolve after the complete route graph is known; invalid or empty
matches fail compilation, and newly matched routes appear in manifest compatibility reports.

A raw route closure is an operation in its own right. Nested protected direct-handle calls reauthorize
through the internal invocation boundary; authorizing the raw route does not lend authority to its
nested operations. An adapted route has no second business closure or permission: it validates and maps
HTTP input, then invokes the one underlying operation under the route-constrained grant.
Transport-constrained authority to HTTP or MCP never broadens the underlying operation to another
transport.

### Queries and subscriptions

Query, search, and subscription admission resolves mandatory scope from the principal and trusted
context. Cursors and resumable subscriptions bind to operation/catalog revision, authority revision,
principal, context digest, query digest, and provider generation. A relevant authorization change closes
or resets the subscription before delivering additional protected data.

### Events and processors

Events are immutable facts, not invocable permissions. Publication follows the authorized canonical
transaction. A processor authenticates with its stable `WorkloadIdentity`, while each delivery executes
as an `ExecutionPrincipal` with diagnostic kind `ProcessorRunPrincipal`, bound to the event identity,
delivery/attempt, declared dependency inputs/targets, deadline, and active authority revision. The
initiating principal, grant, and operation remain causal audit context but do not become ambient
processor authority. Impersonation or delegation requires an explicit bounded grant.

### Workflows and tasks

Workflow start, signal, cancellation, result read, and protected task effects are distinct operations.
Workflow state records the initiating principal, an `ExecutionPrincipal` with diagnostic kind
`WorkflowRunPrincipal`, operation and catalog revision, grant chain, expiration, and approval state.
Each task attempt receives an execution principal with diagnostic kind `TaskRunPrincipal`, narrowed by
its validated input and declared dependency bindings. Long-running work revalidates before protected
external steps and cannot silently retain expired authority.

Each static signal contract declares canonical issue, exact-instance `issuance.read`, and action
operations. `authorize` restricts issuance-event visibility and action admission to subjects that
already possess compatible exact-read and relevant action authority; it cannot create a grant.
`grantAccessTo` derives only exact-instance issuance-read and declared-action grants bounded by target,
context, subject, use, and expiry after proving compatible `canGrant`. It never grants general contract
stream enumeration or history. Signal-event delivery is not resolution authority. Action payloads are
untrusted application input, while the authenticated actor and authorization receipt are
framework-derived outcome metadata.

Each action method returns only its own action-correlated successful outcome. An exact idempotent replay
returns the same outcome and receipt. A losing or later conflicting invocation receives only a redacted
terminal summary and cannot observe the winning action, input, actor, or receipt. Exact
`issuance.read` does not imply full-resolution-read authority; adding such a public operation requires
an explicit future authorization contract.

The function-native execution RFP's non-selectable primary-transactional-database `SignalStore`
transaction is canonical for signal state and transactionally associated grants, receipts, and outbox
records. Operation authority owns their authorization meaning and enforcement, not a separate signal
database. Workflow history and event delivery retain causal references to those records but cannot
resolve or recreate them independently.

### Kubernetes admission and reconciliation

Reconcilers authenticate with a stable `WorkloadIdentity` and retain inferred Kubernetes read/write
RBAC. Each attempt executes as an `ExecutionPrincipal` with diagnostic kind `ReconcilePrincipal`, bound
to resource UID, generation/resource version, handler/catalog revision, installation and namespace
context, attempt/deadline, and dependency bindings. A watch event supplies no trustworthy human identity;
any initiating user remains unknown unless a separate admitted operation receipt provides causal
evidence. Direct Kubernetes resource mutations use Kubernetes authentication and RBAC. Applications that
require domain authorization for CRD mutation enable a generated validating admission webhook that maps
Kubernetes `UserInfo` into a normalized principal and evaluates the corresponding resource operation.

Lifecycle-derived Kubernetes grants use an explicit status/finalizer state machine:

```text
resource observed
  -> desired authority calculated
  -> canonical grants committed
  -> required enforcement projections observed
  -> authorizationReady reported

resource deletion
  -> lifecycle grants revoked
  -> required revocation frontier observed
  -> authorization finalizer removed
```

The implementation must not claim a transaction spanning Kubernetes and PostgreSQL. If required
revocation cannot be proven, finalization remains pending with actionable status and bounded retry
during normal operation. Application teardown adds an explicit, bounded protocol:

```text
application deletion admitted
  -> new external and control-plane admissions disabled
  -> canonical authority enters draining mode
  -> lifecycle grants revoked and retained revocation tombstone committed
  -> required in-graph projections observe the revocation frontier
  -> authorization-bearing dependents and finalizers complete
  -> authority/projection infrastructure becomes deletable
```

The deployment graph must keep canonical authority and every required in-graph enforcement projection
available until their revocation work and dependent authorization finalizers complete. A retained
revocation tombstone contains application, authority revision, affected identities/operations/scopes,
projection obligations, issuance time, and audit provenance without retaining reusable credentials.
The tombstone is stored in installation/deployment lifecycle state that is not deleted with the
application-owned authority database. An unproven obligation cannot disappear because a reviewed
retention period elapsed. The tombstone remains live until every obligation is proven neutralized or a
provider-enforced, non-renewable maximum lifetime has elapsed and expiration is independently observed
or guaranteed by the provider contract. Audit-retention policy may retain a proven tombstone longer; it
may not shorten the safety lifetime of an unproven one.

External projections must support an explicit neutralization operation—revocation, lease expiry,
credential rotation, route detachment, or deny-all revision—before forced cleanup. If canonical authority
is irrecoverably lost, only an audited break-glass operation may remove finalizers. It requires an
installation-scoped acknowledgement, records the unproven external obligations, attempts provider
neutralization, emits durable recovery instructions, and never reports ordinary successful revocation.
Break-glass transfers every remaining tombstone to installation-level safety/audit state; it does not
delete the evidence or reinterpret an unproven obligation as expired.
Alchemy plans and deletion status distinguish normal completion from break-glass cleanup.

The Kubernetes workload-RBAC type currently named `ApplicationPermissionRule` becomes
`ApplicationKubernetesRbacRule`; compatibility aliases may exist only for the documented migration
window.

## Runtime scope language

Dynamic policy may compose:

- deployed operation references;
- exact targets and typed model references;
- bounded equality/range/set predicates over declared fields;
- declared relationship traversal;
- transport and audience;
- validity and maximum use;
- required approval and independently verified outcome.

It may not persist arbitrary JavaScript, source text, or unreviewed CEL. Unsupported or ambiguous scope
evolution fails closed.

Scopes compile into a closed, versioned intermediate representation. Static TypeScript predicates and
runtime-created predicates must lower to the same supported IR. Compilation fails when a static
predicate cannot be represented faithfully; it must not fall back to shipping executable closure code
as policy.

## Implementation increments

1. Rename Kubernetes `ApplicationPermissionRule` and add migration/type compatibility fixtures.
2. Add the authorizable facet, default-deny reachability analysis, stable descriptors, and explicit
   naming to current operations.
3. Lower deliberately exposed ordinary functions and `Model.edit(...)` transaction closures into the
   canonical operation graph after physically removing `.action(...)`, draft `.operation(...)`, and
   model command registries from the public authoring surface.
4. Implement catalog staging, activation, compatibility reports, replacement, draining, and retirement.
5. Add normalized principals, canonical authority models, and static manifest reconciliation.
6. Add runtime permissions, bounded scopes, delegation, grants, reservations, revocation, and audit.
7. Add derived relational grants and Kubernetes lifecycle grant reconciliation.
8. Add authority draining, retained revocation tombstones, dependency-ordered teardown, external
   neutralization, and audited break-glass recovery.
9. Add durable receipts and boundary-specific revalidation.
10. Implement statically discovered direct/internal invocation lowering, compatibility dependency
    aliases, normalized closure signatures, stable workload envelopes, public `ExecutionPrincipal`
    admission, exact-key inferred/explicit `ExecutionBinding` field projections, terminal/monotonic
    scope composition, runtime bound-field override rejection, and exact generated workload grants.
11. Integrate raw routes, adapted HTTP bindings, route-group lowering, queries, subscriptions, workflows,
    processors, MCP handles, and Kubernetes admission.
12. Add enforcement-projection frontier and fail-closed provider behavior.
13. Complete adversarial, concurrency, replay, deletion, and rolling-deployment qualification.

## Required gates

- Existing CRUD behavior and admitted domain functions remain valid; v0.7 examples contain no public
  `.operation(...)` or `.action(...)` declaration.
- One registered or deliberately exposed function derives the callable binding, typed completion
  stream, catalog entry, authority facet, and transport/tool adapters without copying its closure.
- Public type and runtime tests prove `.action(...)`, draft `.operation(...)`, and model command
  registries are absent rather than deprecated aliases.
- Relational, CRD/resource, framework entity, and analytical bindings derive from one authoritative
  `model()` declaration while sharing the authorizable operation facet.
- Relational transaction operations, Kubernetes resource operations, reactive lifecycle handlers, and
  analytical operations retain distinct execution guarantees and fail closed when a requested facet is
  unsupported.
- Transaction closures cannot perform external effects, and later processors/workflow steps do not
  inherit the initiating principal implicitly.
- Direct handle invocation is canonical at generated entry facades and inside managed closures; compiler
  lowering and compatibility aliases preserve the underlying operation semantics.
- A managed closure cannot invoke a dynamic, unresolved, or authority-widening operation dependency.
- Workflow, processor, route, agent, and reconciler workload identities receive exactly their serialized maximum
  operation/input/target/scope envelopes, with no delegation, impersonation, alternate-transport, or
  ambient caller authority.
- Every workflow step, processor delivery, route/agent execution, and reconcile attempt executes under a
  distinct `ExecutionPrincipal` narrowed to its validated input/event/resource, bound operation input,
  target/scope, audience, deadline, and active authority revision.
- `onInput`/`onEvent`/`onResource` bind typed callee-input fields from the enclosing execution, remove
  those fields from generated alias inputs, and lower to one `ExecutionBinding`; bound fields cannot be
  supplied or overridden by the caller.
- Type fixtures prove that the projection parameter is inferred from the enclosing workflow input,
  processor event, or reconciled resource without annotations, and that incompatible or unknown bound
  fields fail at the declaration site.
- Compiler fixtures prove exact returned-key capture independently of TypeScript widening: varying
  values with fixed keys pass, while conditional key sets, optional keys, unresolved spreads, computed
  keys, divergent return branches, and unnormalizable helper results fail at the binding declaration.
- Untyped, JavaScript, stale, and malicious alias callers supplying a bound key fail before bound and
  unbound input are merged; the execution-derived value is never replaced or silently selected.
- `.on(ref)` and `.all()` are mutually exclusive target selectors, repeated `.where()` predicates
  intersect, and `onInput`/`onEvent`/`onResource` return terminal dependencies that expose no subsequent
  target, scope, or binding methods.
- Static targets/scopes and execution-derived input/targets are enforced as an intersection. A binding
  cannot replace or weaken an earlier `.where()`, `.on()`, or `.all()` restriction, and conflicts fail
  closed.
- A bare dependency cannot silently mean broad access: the compiler proves and serializes the complete
  execution binding, requires an explicit binding, or requires `.all()`.
- One execution principal cannot use the same workload credential to read or mutate another execution's
  target, and revocation/cancellation prevents its subsequent protected invocations.
- `plan`, `explain`, durable receipts, and audit distinguish the maximum workload envelope from the
  effective per-execution authority; report exact bound keys and binding provenance; and retain the base
  operation, target selector, every static predicate, execution-derived restriction, and normalized
  intersection.
- Public examples follow the normalized subject/free/lifecycle/route/reconciler closure grammar and
  preserve typed lifecycle facts.
- Every externally reachable production operation is explicitly classified.
- Tool declaration does not imply authority.
- Agent definition, logical `ServiceIdentity`, deployed `WorkloadIdentity`, and every concrete
  `ExecutionPrincipal` remain distinguishable in audit.
- Application and runtime authority records cannot shadow or mutate one another.
- Static and runtime scopes lower to the same closed IR.
- Concurrent use of a one-use grant permits at most one distinct command.
- Same-idempotency-key retry does not consume another use.
- Every signal contract registers one issue operation, one exact-instance `issuance.read` operation,
  and its declared action operations without creating a parallel authority namespace.
- `authorize` creates no grant and requires compatible exact-read/action authority;
  `grantAccessTo` requires `canGrant`, grants only exact issuance read and declared actions, and cannot
  enumerate unrelated contract events.
- Signal action payloads cannot establish actor identity, while the committed terminal outcome
  references the authenticated actor and canonical authorization receipt.
- Winning action results are correlated to the invoked action; exact retries reuse them, while losing
  callers receive redacted terminal summaries and cannot inspect the winning decision.
- Self-grant, delegation broadening, target broadening, transport broadening, and validity extension fail.
- Conditional-key execution bindings, bound-field override attempts, post-binding scope changes, and
  any composition that drops an earlier target or predicate fail deterministically.
- Revoked authority blocks a queued mutation before its protected effect or commit.
- An operation cannot verify its own required outcome.
- Old and new application catalogs can coexist during a tested rolling transition.
- Unknown and retired operations fail closed with migration diagnostics.
- Raw routes cannot become confused deputies.
- Adapted routes authorize exactly one underlying operation through one transport binding; route-group
  expansion neither requires a duplicate route permission nor grants that operation through another
  transport.
- Empty route selectors and silent route-group broadening fail.
- Event processors do not inherit the initiating principal's authority.
- Kubernetes resource deletion does not remove its authorization finalizer before required revocation is
  observed.
- Application deletion disables admission and keeps canonical authority alive until the normal revocation
  frontier completes.
- Lost authority infrastructure requires an explicit audited break-glass acknowledgement and leaves a
  retained tombstone plus external-neutralization obligations.
- An unproven revocation tombstone survives every ordinary retention deadline and can end only after
  observed neutralization or guaranteed expiry of a provider-enforced, non-renewable maximum lifetime.
- Subscription and cursor reuse fails after principal, scope, grant, operation, or catalog revision changes.
- Browser bundles contain neither policy implementations nor provider credentials.

## Open questions

1. Should sensitive operations opt into runtime grantability, with non-sensitive operations grantable by
   default, or should all runtime grantability be explicit?
2. Which bounded relationship predicates belong in the first runtime scope language?
3. How long must catalog revisions be retained after every dependent grant and workflow expires?
4. Which outcome states consume a grant permanently versus permit an explicit administrator-authorized
   retry?
5. Which application authorization projections, if any, are mandatory in the dedicated profile rather
   than optional defense in depth?

## Definition of done

This RFP is complete when every existing operation surface can participate in one catalog and authority
model, dynamic authority survives safe application evolution, durable work revalidates at the correct
effect boundary, relational and Kubernetes lifecycle grants revoke safely, and the full denial,
concurrency, replay, revocation, route, subscription, control-plane, and rolling-catalog matrices pass.
The public examples must demonstrate direct typed assignment, a runtime-created permission, delegation,
an approval/outcome-bound request, HTTP protection, a stable processor workload envelope plus
per-delivery principal, cross-execution target isolation, and Kubernetes admission without
provider-specific policy code. Completion does not authorize the v0.7 release.
