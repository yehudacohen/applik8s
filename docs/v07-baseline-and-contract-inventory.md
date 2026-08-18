# v0.7 baseline and contract inventory

This inventory is the Phase 0 authority for the v0.7 Agentic Platform work. It
records the product behavior Applik8s preserves, improves, defers, or rejects
and the package boundaries that own each reusable mechanism.

## Agentic product baseline

[`v07-product-baseline.json`](./v07-product-baseline.json) is the self-contained
machine-readable product ledger.
[`v07-agentic-start-capability-map.md`](./v07-agentic-start-capability-map.md)
is the normative implementation and acceptance map for the complete
product surface. `bun run check:v07:product-baseline` must verify both the versioned
dispositions and the generated behavioral journeys; a source marker, prose-only
claim, or external checkout is not acceptance evidence.

## Baseline ledger

### Preserved

- Deterministic `create-app` planning, collision refusal, release/local dependency modes, and checked-in
  generated-example parity.
- Official TanStack Start/Vite ownership of routing, SSR, hydration, and production builds.
- A progressive onboarding cockpit that begins as a tutorial and grows into an operational control
  center.
- First-class folders for models, operations, agents, workflows, events, artifacts, evaluations,
  routes, and tests.
- Credential-free local startup with provider status represented explicitly rather than silently
  emulating production.
- Auth, organization/workspace, billing, policy, chat, approval, run, usage, and administration product
  paths as acceptance requirements.
- Server-only module boundaries and redacted onboarding/provider diagnostics.
- A release gate that validates generated output, package consumption, parity, and real application
  behavior.

### Improved by Applik8s

- Generated infrastructure becomes one inspectable application/deployment graph rather than handwritten
  TypeKro profile files in every generated application.
- Provider choices become typed, qualified, profile-driven dependencies instead of route-local
  configuration and string branching.
- PostgreSQL, analytics, search, workflows, identity, OAuth, AI, MCP, object storage, and hosting are
  provider-neutral capabilities with concrete TypeKro implementations.
- Operations, permissions, agents, tools, routes, workflow effects, and MCP tools share one stable typed
  operation catalog and authority.
- Durable workflows use Hatchet through Applik8s contracts; applications do not own provider-specific
  orchestration glue.
- Runtime state, grants, receipts, approvals, outcomes, revocation, and audit receive durable authority
  and explicit lifecycle semantics.
- The generator emits a small application-owned feature layer plus versioned Applik8s modules instead of
  copying hundreds of framework implementation files.
- Local, Kubernetes, and production profiles use the same logical application graph and differ only in
  qualified provider bindings and deployment policy.

### Deferred

- Additional hosted AI, identity, search, workflow, and billing adapters after the first concrete
  providers prove the contracts.
- Multi-cluster qualification, which requires a second real Kubernetes authority.
- A broad TUI; web operations and onboarding remain the first complete product surface.

### Rejected

- Copying runtime, auth, billing, policy, workflow, or route implementation into each
  generated application.
- Treating fixture-grade local auth, billing, policy, or deterministic agent execution as production
  implementations.
- Parallel MCP-, route-, AI-, or workflow-only operation registries.
- String provider selection, string operation lookup in authored code, and provider-specific types in
  core identity or authority contracts.
- A generic `tenantId` framework primitive. Applications and modules own organization/workspace domain
  models; the framework owns trusted-context propagation and bounded policy inputs.
- Browser-owned principal, organization, scope, provider credential, or operation authority.

The committed baseline's credential-free local billing behavior, checkout,
portal, signed Stripe webhook seam, entitlement projection, and billing
dashboard are v0.7 parity requirements. Product plans and workspace policy stay
application-owned; the provider-neutral billing contract and first server-only
Stripe adapter are maintained modules. A versioned plan/catalog and metering
outbox are explicit v0.7 Agentic Start improvements rather than framework
tenancy or pricing policy.

## Current Applik8s contract inventory

| Surface | Existing authority | v0.7 convergence |
| --- | --- | --- |
| Model mutation | Direct CRUD and named operation handles in `@applik8s/client` and promoted models | Add the shared authorizable facet, catalog identity/version, target/scope binding, and receipts without replacing the callable. |
| Model lifecycle | Typed committed create/update/delete and named-operation completion events | Preserve fact semantics; execute handlers as workload/execution principals rather than inheriting caller authority. |
| Kubernetes lifecycle | Typed create/update/delete/reconcile/finalize/watch handlers with inferred RBAC | Keep Kubernetes authority and add optional domain admission plus revocation-aware finalization. |
| Queries | Versioned query operations, authenticated gateway, cursor/context binding | Add catalog and authority revisions, mandatory scope, and authorization-driven subscription reset. |
| Streams/subscriptions | Replayable streams, processors, projections, SSE subscriptions | Treat publication as fact production and processors/subscribers as independently authorized workloads. |
| Tasks/workflows | Typed durable tasks/workflows and Hatchet runtime | Serialize exact declared operation dependencies, workload envelopes, and per-attempt execution principals. |
| Routes | Generated named/compatibility HTTP routes and source-backed closures | Make stable names normative; distinguish raw route operations from adapters of existing operations. |
| Identity | Provider-neutral request admission and canonical request context | Split authentication from canonical principal/identity-reference authority and remove provider-specific core types. |
| Authorization | Provider token and route/query callbacks | Replace isolated callbacks as the primary model with one canonical static/runtime grant authority; provider policy remains an enforcement projection. |
| Deployment | ApplicationGraph lowered through TypeKro and Alchemy | Add catalog, profile, provider, workload-authority, search, AI, identity, OAuth, MCP, and distribution nodes to the same graph. |

## Canonical v0.7 vocabulary

| Deprecated v0.6 vocabulary | Canonical v0.7 vocabulary |
| --- | --- |
| `ModelStore`, `{ store }` | `TransactionalDatabase`, `{ database }` |
| `ProjectionStore` | `AnalyticalDatabase` |
| exceptional model `.action(...)` / draft `.operation(...)` | ordinary exported function containing `Model.edit(...)` |
| `/actions/` catalog identity | `/operations/` catalog identity |
| Kubernetes `ApplicationPermissionRule` | `ApplicationKubernetesRbacRule` |

The obsolete model action/operation/command registries are physically absent from the v0.7 public
types and runtime objects. The database aliases may remain import-compatible while migration tooling
exists, but new graphs, diagnostics, examples, generated projects, manifests, and provider registries
emit only the canonical vocabulary.

## Package and runtime zones

- `@applik8s/core`: serializable graph, identity, operation, authority, profile, and diagnostic contracts.
- `@applik8s/client`: browser-safe callable operation/query facades and transport-neutral metadata.
- `@applik8s/operations`: catalog, scope IR, grants, receipts, execution bindings, and authority runtime.
- `@applik8s/applik8s`: authoring DSL and application-graph registration.
- `@applik8s/server`: authenticated Request/Response runtime and server-only adapters.
- `@applik8s/react`: browser-safe hooks over callable operations and queries.
- `@applik8s/vite`: build discovery and browser/server partitioning only.
- Provider runtimes: concrete server/worker adapters; never imported by browser entrypoints.
- Deployment packages: graph lowering, TypeKro declarations, Alchemy resources, and provider lifecycle.

Browser packages may depend on client contracts and serializable public descriptors. They may not import
provider credentials, policy evaluators, database clients, Kubernetes clients, workflow workers, AI
provider clients, OAuth private clients, or deployment code.

## Phase 0 exit checks

- The pinned revision and baseline ledger above are reviewed.
- Current source emits `TransactionalDatabase`, `AnalyticalDatabase`, `{ database }`,
  function-native `Model.edit(...)`, `/operations/`, and `ApplicationKubernetesRbacRule`.
- Negative public type/runtime tests prove `.action(...)`, `.operation(...)`, and model command
  registries are absent.
- The operation/catalog, principal, scope, execution-binding, workload-envelope, and explain contracts
  are public and type-tested before runtime authority is enabled.
- Named routes are normative and compatibility overloads are visibly deprecated.
- Browser/server dependency-zone checks reject unsafe imports.
- Typecheck, focused graph/model tests, and `git diff --check` pass.
