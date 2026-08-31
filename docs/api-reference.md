# API Reference

For the native Drizzle/Kubernetes model, trusted-context, migration, query,
stream, client, and projection contracts, see
[Native Models and Live Queries](./native-models-and-live-queries.md).

This is the supported public surface for the `applik8s` v0.8 candidate.
It includes the earlier application substrate, durable messaging and
workflows, native models, live queries, browser facades, application hosting,
the v0.7 function-native execution and Agentic Start contracts, and the v0.8
portable planning, scheduling, actor, observability, lakehouse, and development
environment extensions.

## Packages

The authoritative [package and module catalog](./packages.md) lists every
published boundary, its runtime zone, and when to install it.

Most application authors need only:

- `@applik8s/applik8s` for application authoring;
- selected application modules such as `documents`, `conversations`, or
  `billing`;
- selected provider/runtime adapters; and
- `@applik8s/react`, `@applik8s/server`, or a framework integration when the
  application has a web surface.

Operator-only and WASM code should prefer the focused `@applik8s/sdk` surface.
Compiler, deployment, and provider packages are public extension seams but are
normally reached through `@applik8s/cli`.

### Celld Kubernetes operator

`@applik8s/celld-operator` is an independently consumable provider package,
not part of the ordinary application-authoring surface. Its root exports the
`CelldFleet` CRD contract, exact versioned Secret contracts, the Applik8s
operator definition, and deterministic fleet-child rendering. The
`/typekro` subpath exposes the cluster-singleton bootstrap and namespaced fleet
installation compositions without eagerly loading TypeKro from the package
root. The `/testing` subpath exposes lifecycle fixtures.

Application authors continue to select the provider-neutral Celld actor
runtime. The compiler then builds the generated Worker and operator artifacts;
TypeKro/Alchemy owns the singleton control plane, dependencies, and
`CelldFleet`; the operator exclusively owns the fleet StatefulSet, Services,
Job, NetworkPolicy, PodDisruptionBudget, optional ServiceAccount, status, and
finalizer. Omitting the bootstrap `namespace` creates and owns
`applik8s-celld-system`; passing a namespace consumes that externally owned
namespace. There is no ambiguous namespace-ownership flag.

### Independent development environment

`@applik8s/dev` owns the local-only v0.8 Builder preview. Its root exports the
reviewed change coordinator, durable journal, workspace mutation contracts,
and `applicationPlanSelectionResolver()`. The `/server` and `/ui` subpaths own
the application-independent loopback daemon and portal; `/agent` defines the
provider-neutral coding-agent protocol; `/agent/opencode` is the maintained
OpenCode adapter; and `/skills` publishes the version-matched framework catalog.

Generated development UI may emit
`data-applik8s-provenance="<semantic-node-id>"`. This value is an opaque hint,
not a source path or mutation capability. Immediately before capture the Vite
toolbar reads the daemon's bridge context and submits the current
`ApplicationPlan.sourceDigest`; the daemon rejects stale revisions, replayed
nonces, hostile origins, oversized content, and unknown identities. Only the
daemon resolves the hint into workspace-relative source provenance, semantic
graph nodes, operation context, and plan records.

`DevelopmentCoordinator` persists admitted attachments, named conversation
referents, proposals, exact approval scopes, validation receipts, apply state,
and undo state in the hash-chained SQLite/WAL journal. Agent output remains
advisory: it cannot bypass approval, optimistic file digests, required
validation, path/symlink confinement, secret redaction, or agent-owned undo.
The portal and journal remain usable while the generated application fails to
compile or start.

### Code-agent preview

`@applik8s/code-agent` owns the provider-neutral `codeAgent()` composition and
the small `AgentHarness`, `CodeWorkspace`, `SourceRepository`, and
`ProcessRunner` capability contracts. Its `/runtime` subpath hydrates selected
providers, while `/http` exposes the authenticated, bounded provider boundary
used when actor execution and the harness/workspace processes have separate
execution identities. The package also includes deterministic and fenced local
providers for tests and development.

The repository-scoped actor serializes turns. Every request has a distinct
stable run identity and idempotency receipt, and the workspace lease fences one
active writer. Repository changes use compare-and-swap digests and validation
commands use stable receipt identities. `@applik8s/dev/agent/opencode-code-harness`
is the maintained OpenCode adapter; it is deliberately outside the semantic
package so another harness can replace it without changing application code.

The umbrella package is the normal application-authoring and integration surface. Code that must be captured inside a minimal WASM reconciliation closure should import focused handler-safe APIs from `@applik8s/sdk` or an explicitly documented handler-safe subpath. The compiler follows the reachable closure and fails closed on unsupported Node or integration dependencies; it does not promise that importing the umbrella entrypoint from inside a handler is minimal or portable.

Generated browser facades use the same-origin `/__applik8s/v1` authority for route-loader preloads even
before React mounts. `Applik8sProvider` supplies live-query/mutation hooks and may override the browser
clients or base URL. If overlapping providers make a direct model call ambiguous, the client fails closed;
context-bound React hooks continue to use their nearest provider.

Static dispatcher capture preserves the defining source module and authored handler expression through discovery metadata. Reachable declarations are emitted in isolated module scopes, so unrelated duplicate helper names and explicitly aliased same-named imports retain normal JavaScript module semantics. Missing source provenance, unresolved lexical state, and unsupported capture cycles still fail closed with the handler and dependency named.

## SDK Authoring

Use `sdk.crd()` to define a Kubernetes custom resource shape from a supported schema source.

Supported schema sources:

- JSON Schema in the supported Kubernetes structural subset
- ArkType schemas that normalize into that structural subset
- custom schema sources only when downstream compiler support can validate them safely

Use `sdk.operator()` to define:

- operator name
- deployment namespace and replica policy
- owned CRDs
- declared Kubernetes permissions
- optional runtime settings
- reconcile/finalize/event handlers
- declared external capabilities

Handlers may use proxy-first mutation syntax. The SDK records mutations as operation plans; handlers do not receive an ambient Kubernetes client.

For capability-aware handlers, use the operator-scoped registration form. It infers declared Kubernetes connection aliases and rejects undeclared or non-Kubernetes aliases at typecheck time:

```ts
sdk.operator({
  resources: { Work },
  capabilities: { destination },
  handlers: ({ resources }) => [
    resources.Work.on.context.reconcile((_work, ctx) => {
      const cluster = ctx.kubernetes.connection('destination');
      return ctx.noop();
    }),
  ],
});
```

Declare remote-readable kinds with `sdk.kubernetes.resource({ ..., access: 'connection' })`. Connection lists require an explicit `limit` from 1 through 500. Remote mutations require either owner-bound managed authority or an exact UID/resourceVersion precondition. Installation bindings are supplied through the compiler or CLI and never enter handler input. See [Kubernetes connections](kubernetes-connections.md).

Proxy handlers include small Kubernetes object factories for common built-ins used in examples. For example, `job.k8s.ConfigMap({ name, namespace, data })` returns a real ConfigMap object with top-level `data`, `job.apply(object)` records a server-side apply operation for it, and `job.delete(object)` records a delete by object reference. The older `job.batch.*` alias remains available for existing examples, but `job.k8s.*` is the golden-path spelling.

## v0.3 App Golden Path

Use the top-level `app(name, options)` builder for first-contact application authoring. It is the stable v0.3 inference boundary for resources, models, routes, reconciliation, jobs, default namespace, generated artifacts, and app graph metadata.

The primary authoring sequence is:

- `const myApp = app('name', { namespace, apiVersion, kind })`
- `myApp.resource('Kind', { spec, status })` for schema-first CRDs
- `myApp.storage.postgres('db', { database, migrations: 'generated-job' })` for the concrete Postgres `TransactionalDatabase` slice
- `myApp.model('Name', { spec, indexes })` for storage-backed app data
- `const api = myApp.http('public-api', options)` followed by
  `api.post(name, path, { input, output, authorize }, handler)` for typed,
  function-native HTTP routes
- `Resource.on.reconcile(handler)` for continuous reconciliation with an inferred generated operator
- `resource(..., { controller: ApplicationResourceControllerOptions })` for
  advanced placement, secondary watches, and explicit RBAC without a parallel
  application-level registrar
- `Resource.on.finalize(handler, options)` for resource-owned cleanup
- `Resource.on.created(handler)`, `.updated(handler)`, and `.deleted(handler)` for resource-owned lifecycle facts
- `myApp.resource('Kind', { ..., controller: deploymentOptions })` only when the inferred operator needs explicit placement or SDK RBAC
- `myApp.install(childApp, { spec })` to statically nest another installable Application into the generated TypeKro graph
- `myApp.composition` when a TypeKro composition is needed

The Application object deliberately exposes neither `reconcile` nor `on`.
Resource behavior is declared once on `Resource.on.*`; the framework groups
those declarations into one inferred controller per CRD and replays its
installation during Application materialization.

`app.http(...)` deliberately has no wrapping configuration callback. Its final
request closure is schema-validated, receives a framework-authenticated
principal, and contributes one context-scoped idempotent route boundary to the
application graph. `app.server(name, options, configure)` is the advanced raw
HTTP escape hatch for legacy HTML/form workloads; it is not an alias for
`app.http`.

Provider APIs such as `app.provide(TransactionalDatabase, ...)`, `app.defaults(...)`, and explicit `app.server(...)` options remain supported for advanced composition. They should be treated as progressive disclosure: use them when you need a non-default binding, explicit provider ownership, or lower-level compatibility inspection.

### Callback-native modules

Reusable application features use the top-level `module()` function:

```ts
const notes = module(
  'notes',
  { schema: { Note, NoteRelations } },
  application => {
    const Notes = Note.view(contract, listNotes);
    const Member = application.role('member');
    Member.can(Note.create, Notes);
    return { Note, Notes, Member };
  },
);

export const { Note, Notes } = application.include(notes);
```

Use `module(name, setup)` when the application database already contains the
models or when top-level returned models/relations can be inferred after setup.
Use `module(name, { schema }, setup)` when setup itself needs promoted model
facets. The returned plain object retains its exact inferred type and is
validated and frozen by Applik8s. Inclusion runs once per application; the
same module may be included in separate applications without sharing bindings.
Distinct modules with the same stable name, conflicting schema members,
ambiguous databases, missing providers, symbol exports, unsafe names, and
undefined exports fail closed. `defineApplicationModule()` is a deprecated
compatibility adapter, not the public golden path.

PostgreSQL ownership is explicit when data must outlive the Application graph. The compact default,
`TransactionalDatabase.postgres()`, makes the CNPG `Cluster` a KRO child and therefore deletes it with the Application
instance. A retained application-owned database uses
`TransactionalDatabase.postgres({ ownership: 'direct-provisioned', lifecycle: { deletionPolicy: 'retain' } })`; deployment
prepares it through a recorded TypeKro direct factory and the KRO graph observes it with `externalRef` without
adopting it. Use `deletionPolicy: 'delete'` for a disposable direct-managed database, or
`ownership: 'external'` with `provision: false` or an explicit `cluster` reference for infrastructure owned
outside Applik8s. Direct ownership without an explicit deletion policy fails at authoring time, and a KRO-owned
cluster is never silently adopted into the direct lifecycle.

`app.install(child, { name?, spec, dependsOn? })` calls the child Application's TypeKro composition while the
parent graph is being materialized. TypeKro statically merges the child resources and exposes the child's typed
status proxy to the parent; no operator builds a second graph during reconciliation. `name` is stable graph
evidence, while Kubernetes names and namespaces remain fields of the child's typed spec. Use the child
installation model's normal create/update/delete operations instead when an independently owned child CR and
separate lifecycle are required.

`app.secret(name, options)` makes Secret ownership explicit. An explicit `secretName` defaults to `ownership: 'external'`: applik8s emits references and workload wiring, but does not emit or own the Secret object. A generated name defaults to `ownership: 'generated'`; applik8s emits the empty Secret shell while leaving Secret data runtime/user-owned. Set `ownership` explicitly when the default is not the intended lifecycle. applik8s never emits an empty `data` map for an externally populated key, because doing so would claim and potentially erase that key under server-side apply.

Generated route handlers receive `{ params, query, form, formData }`. Prefer `params` for route variables and `form.string(...)` / `form.enum(...)` for HTML form inputs. Model `create(...)` accepts flat spec input in the generated path, so `Account.create({ tenant, email })` is the preferred spelling for app routes.

## Operation Plans

Operation kinds are:

- `apply`
- `patch`
- `delete`
- `status`
- `event`
- `finalizer`
- `requeue`

The Rust host validates the normalized plan before effects. Invalid operation order, invalid refs, undeclared RBAC, undeclared finalizer ownership, malformed patches, invalid namespace/scope, and unsupported status writes fail closed.

Delete options may include `{ preconditions: { uid, resourceVersion? } }`. The host forwards these as
Kubernetes delete preconditions; connection-scoped deletes also require the same precondition to match
verified remote mutation authority.

## DNS Publication

`@applik8s/applik8s/dns` exports provider-neutral A, AAAA, and CNAME normalization plus a first-party
ExternalDNS adapter. `dns.externalDns.resource(...)` declares the structural `DNSEndpoint` read surface.
`dns.externalDns.decide(...)` returns one create apply, guarded update patch, no-op, conflict, or
unsupported decision; `decideDelete(...)` requires current UID evidence and an installation that proves
sync deletion semantics.

Local controller observation can use
`targetNameFromSourceField` secondary-watch mapping to read one declared source label or annotation and
enqueue exactly one target by name. Connection-scoped resources use bounded polling/requeue and never
receive a local watch. See [DNS publication from operators](dns-publication.md) for the ownership,
capability, observation, and propagation boundaries.

## Status Helpers

`@applik8s/sdk` exports helpers for common condition and status patterns. Generated CRDs can admit runtime-authored `Ready` conditions, `observedGeneration`, phase/reason/message fields, and durable external-effect records.

## Testing Harness

`testing.testOperator(operator)` supports local assertions for:

- operator manifest metadata
- RBAC
- structural schema expectations
- apply/patch/delete/status/event/requeue/finalizer operations
- external-effect records

Local tests do not prove Kubernetes API acceptance; use E2E suites for that.

## Compiler

`createCompilerPipeline().run()` compiles an entrypoint into `dist/applik8s` by default.

The compiler emits:

- `operator-manifest.json`
- `contract/runtime-contract.json`
- `contract/applik8s-handler.wit`
- `wasm/handler.wasm`
- `bundle/handler.js`
- `bundle/handler.js.map`
- `kubernetes/*.yaml`
- `Dockerfile.applik8s-runtime`
- `apply.sh`

For `applik8s build <entrypoint> --typekro`, the compiler also emits `typekro/apply.sh`. That script applies TypeKro composition resources in CRD-first phases and retries later resources so KRO-generated APIs can become discoverable before graph instances are applied. Programmatic `factory('kro').deploy(...)` flows use TypeKro's public `kroPrerequisites.resources` support so generated applik8s CRDs are established before the ResourceGraphDefinition that references their custom resources.

Unsupported compiler options fail closed or are documented as unsupported. applik8s does not silently ignore unsupported runtime, ABI, schema, host-import, or packaging semantics.

## CLI

The `applik8s` CLI is intentionally thin:

- `applik8s build <entrypoint>` compiles generated operator artifacts.
- `applik8s build <entrypoint> --connection-bindings <file>` applies the exact alias-to-Secret/context/endpoint-policy installation overlay before emitting artifacts.
- `applik8s build <entrypoint> --typekro [--composition-name <export>]` compiles an exported applik8s TypeKro composition and emits inspectable composition resources.
- With `--typekro`, the connection-binding file is an operator-name-to-alias-map so each nested operator receives its own exact installation overlay.
- `applik8s explain <reason>` explains known diagnostics.
- `applik8s replay inspect <artifact>` inspects or executes replay artifacts.
- `applik8s test [...args]` forwards to Vitest.

The workspace exposes the v0.3 flagship through `examples/tenant-platform.ts`. Build its artifacts with `bun run applik8s build examples/tenant-platform.ts --typekro --composition-name tenantPlatform --out-dir dist/examples/tenant-platform`.

The v0.2 flagship TypeKro example remains available through `examples/guestbook.ts`. It is a pure applik8s/TypeKro composition: `GuestBook` reconciles a responsive rendered website from typed live `GuestBookEntry` reads into authoritative status, serves cached entries through an `app.server(...)`, buffers page views into bounded `GuestBookPageViewBucket` resources, and uses `app.expose(...)` for local HTTP or public Ingress/cert-manager/ExternalDNS intent. Build its artifacts with `bun run build:guestbook`.

`app.expose(...)` accepts a generated server binding, a generated v0.6 gateway binding, or an explicit Service name. Binding the workload is preferred because Applik8s derives its generated Service name, namespace, and port. Managed TLS requires an explicit `Certificate` provider such as `Certificate.certManager(...)`; managed DNS requires an explicit `DnsPublication` provider such as `DnsPublication.externalDns()`. Those declarations create application-owned namespaced intent and do not install or own the cluster-wide controllers.

TLS is one explicit ownership intent: `{ mode: "managed" }` asks the selected Certificate provider to own the Secret, `{ mode: "external", secretName }` references an externally owned Secret, and `{ mode: "disabled" }` requests plaintext transport. The former string-mode plus separate `tlsSecretName` shape has been removed so ownership cannot be inferred from two independent fields.

No `dev` or `package` command is promised in v0.3.

## Native Model Lifecycle

A promoted Drizzle model exposes schema-derived `Model.create`, `Model.update`, and `Model.delete`
operations plus typed `Model.on.create`, `Model.on.update`, and `Model.on.delete` committed-event handlers.
`Model.<mutation>.beforeCommit(options, handler)` adds one transaction-authoritative policy hook for
authorization, validation, derivation, transaction participants, and declared event/command outboxes. It
does not create a second public action or event path. The framework owns the conventional mutation,
durable result, versioned lifecycle event, replay stream, and bounded processor lowering.
An ordinary error thrown by this policy becomes the conventional operation's durable
`policyRejected` result and is acknowledged without broker redelivery; authors do not classify expected
policy decisions manually. PostgreSQL serialization, deadlock, and optimistic-concurrency failures remain
retryable from a clean transaction boundary. Policy rejection rolls back the model mutation, history,
transition, and outbox before recording its idempotently replayable terminal result.

Lifecycle handlers receive inferred snapshots: create has `value`; update has `previous` and `current`;
delete has `previous` and a typed tombstone. Handler context exposes event identity, stream name/version,
sequence, recorded time, partition, opaque admitted-context digest, stable idempotency key, admitted
principal and trusted values, attempt, and abort signal. Principal/trusted values are available only inside
generated server-side processors and are excluded from public replay and SSE. Essential initialization
belongs in database defaults or `beforeCommit`; `on.*` is retryable post-commit work.

Genuinely exceptional non-CRUD behavior is an ordinary exported TypeScript
function containing `Model.edit(...)` or direct model calls. The compiler
discovers its statically reachable model/event dependencies and lowers the
function through the same operation catalog, authority, durable-result, and
transactional-outbox machinery. Authors do not maintain `.actions({...})`,
`.operation(...)`, or `.action(...)` registries. Public type and runtime tests
enforce that those registries are absent.

A promoted relational, analytical, or Kubernetes model exposes two
function-native read declarations. `Model.query(contract, implementation)` is
a one-shot authorized snapshot; `Model.view(contract, implementation)` is the
persistent invalidation-aware form used by live clients. Both infer stable
identity from a named implementation and share typed input/output schemas,
read dependencies, provider authority, trusted context, and hard budgets. The
application graph records `query` versus `view` explicitly rather than making
the runtime infer lifecycle semantics from client usage.

Input and output accept the same `SchemaInput<T>` boundary as the SDK. ArkType
remains the concise authoring default, while a typed `JsonSchemaSource<T>` or
maintained runtime schema preserves `T`, emits its normalized structural JSON
Schema, and validates through the shared runtime adapter.

## Maintained Operations UI

`application.include(operationsOverview)` installs the bounded,
administrator-authorized provider/workflow/delivery/authority overview used by
a fresh product. It contributes only the operational-observation and
authority-audit schema; it does not silently add conversations, approvals,
artifacts, evaluations, billing, or usage.

Applications that intentionally include that complete maintained product suite
use `application.include(operationsControlCenter)` instead. Both expose an
`ApplicationOperationsSnapshot` to the router-neutral React control center.
The UI leads with failed, blocked, waiting, degraded, and unknown evidence and
retains category/id identifiers while keeping raw evidence and credentials
server-side.

Pure browser health classification is exported separately from
`@applik8s/operations-ui/health`. Importing that entrypoint cannot pull the
server-only authority, receipt-signing, or PostgreSQL runtime into a browser
bundle.

## Resource Operations

Generated `app.server(...)` routes can call typed resource helpers such as `Resource.create(...)`, `Resource.get(...)`, `Resource.query(...)`, `Resource.patch(...)`, `Resource.delete(...)`, and `Resource.increment(...)`. `increment(...)` is generated-runtime-only: route code declares the target resource, object identity, spec fields, labels, and numeric field, while the generated server batches increments and flushes them with create-on-miss and patch-on-existing-object semantics.

Server RBAC is inferred from direct helper calls. `Resource.increment(...)` requires `create`, `get`, and `patch` on the target resource.

## App-Scoped Entities

`@applik8s/applik8s/dsl` exports `entity(name, { spec, status })` as the schema-first definition shape for v0.3. Entities can be materialized honestly as Kubernetes control-plane resources with `app.crd(entity, { apiVersion, ... })`; the returned resource supports the same CRD actions, indexes, listeners, and permission inference as `sdk.crd(...)`.

`app.model(entity)` materializes application data through an explicit `TransactionalDatabase` provider. The v0.3 concrete storage-backed slice is Postgres/CNPG: generated artifacts include the database dependency, migration SQL, migration Job, generated runtime client, and diagnostics. Unsupported query/index/transaction/storage assumptions fail closed; applik8s does not silently treat CRDs as a hidden database.

## v0.3 Provider Boundary

`app.defaults(...)` and `app.provide(...)` bind capability interfaces such as `TransactionalDatabase`, `IndexStore`, `CounterStore`, `EventSource`, `Secret`, `Queue`, `ObjectStorage`, `HttpExposure`, and credential material. v0.3 supplies defaults for all of them, so native actors do not require custom provider wiring.

The defaults are deliberately bounded: Postgres/CNPG for models; Valkey for indexes; declared Kubernetes resources for buffered counters; Kubernetes watches for events; Secrets for secret material and credentials; a resourceVersion-safe ConfigMap queue capped at 1,000 messages and 64 KiB per message; ConfigMap-backed objects capped at 512 KiB each; and Ingress for HTTP exposure.

“Broad provider implementations” can also mean multiple production-scale adapters behind each contract—for example S3 and GCS, several hosted queues, multiple SQL databases, secret managers, and several gateway choices. v0.3 does not require that catalog: it requires one working zero-configuration default for every native interface. `defaultApplicationProviders` exposes those choices, while `app.defaults(...)` and `app.provide(...)` remain override points.

Applik8s v0.8 qualifies TypeKro 0.33.8 with Alchemy beta.74 and consumes its production Valkey,
Rook/Ceph, NATS/JetStream, Harbor, Hatchet, OpenSearch, Ory, and deployment
planning surfaces through the focused deployment packages. These are explicit
profile scale-up paths rather than unconditional defaults: operators and
durable storage have platform lifecycle prerequisites, while data claims that
cannot be reconciled safely by KRO remain direct-only. Keeping those lifecycle
prerequisites explicit preserves the bounded-application contract.

## v0.4 Durable Behavior

`command(...)`, `event(...)`, and the `EventLog` provider remain the versioned
durable-message foundation introduced in v0.4. Relational models derive direct
CRUD operations and typed committed lifecycle handlers; exceptional domain
behavior is an ordinary exported function over those handles. Both paths lower
into PostgreSQL command authority, declared transactional outboxes, bounded
generated processors, and JetStream transport. PostgreSQL owns idempotency and
durable results; JetStream is at-least-once delivery. See `docs/commands.md` for
ordering, missing-target, revision, recovery, and effect-boundary semantics.

## v0.7 Durable workflows and managed closures

`workflow(...)` is the sole public durable-execution declaration.

External-effect tasks may declare `providerAccounting: { alias:
Usage.providerAccounting }` together with `identity`. The typed capability is
then available at `context.providerAccounting.alias`. Its begin, uncertainty,
terminal, reconciliation, adjustment, and scoped-read methods are backed by
compiler-owned PostgreSQL authority. The retained partition is the exact
server-admitted `trustedContext.values.principalScope` (or the admitted
principal ID for personal work when that field is absent), never the rotatable
transport digest or workspace role; see `docs/workflows.md` for the security
and hashing boundary.
Function-native calls to ordinary operations, queries, providers, and child
workflows become compiler-owned retryable steps; applications do not declare a
task catalog or invoke `context.task(...)`. Workflow handles support direct
invocation, start, schedule, result observation, cancellation, and typed
signals. Direct ambient effects in durable orchestration fail compilation,
including effects hidden in captured module-local helpers.

When a function-native workflow declares task capabilities such as `requires`,
`authority`, `objects`, `providerAccounting`, retry policy, or service identity,
that explicit effect boundary takes precedence over captured child-workflow
dependencies. The complete authored handler is lowered to one retryable task;
captured workflow calls remain injected task effects rather than causing the
handler itself to be classified as deterministic orchestration.

An explicit task service identity is authority for authenticated operations,
queries, actor calls, provider accounting, and function-native model writes.
Read-only model scopes, object-store credentials, and callable provider calls
do not consume that identity; they retain their admitted context and declared
provider/object authority instead.

The initial provider is pinned Hatchet in PostgreSQL-only mode with CNPG and no RabbitMQ. Generated worker groups include a self-contained bundle, health, graceful drain, bounded slots, disruption policy, explicit egress, fixed replicas, and optional KEDA task-stat scaling. Hatchet is operational workflow authority; canonical application transitions still commit through the v0.4 PostgreSQL transaction boundary. See `docs/workflows.md`.

There are two distinct status ownership cases:

- CRDs declared by applik8s admit their status schema, and the Rust host is the authoritative status writer through validated `status` operations. This is the relevant substrate for downstream workload, replica, and failover APIs.
- A TypeKro root application CR is owned and reconciled by KRO. KRO currently derives that CR's status schema and projections from its ResourceGraphDefinition. applik8s must not race KRO by claiming the same status fields from a separate controller.

Generated jobs use a runtime-created ConfigMap as the durable concurrency and history store. The app ResourceGraphDefinition observes that ConfigMap through a KRO `externalRef`, decodes `applik8s-jobs.json` with CEL, and declares `status.applik8s.jobs` in the generated root schema. KRO is therefore the sole, authoritative root app-status writer; the generated reconciler does not request app-status RBAC or race KRO with patches.

## Permission Bundles

Every `sdk.crd(...)` resource exposes typed permission bundles for common Kubernetes operations:

- `Resource.permissions.read()` for `get`/`list`
- `Resource.permissions.watch()` for `get`/`list`/`watch`
- `Resource.permissions.apply()` for create/update/patch-style object writes
- `Resource.permissions.patch()` for JSON patch writes
- `Resource.permissions.patchStatus()` for status subresource writes
- `Resource.permissions.delete()` for deletes
- `Resource.permissions.finalize()` for finalizer subresource writes
- `Resource.permissions.manage()` for the full object/status/finalizer rule family

`sdk.watch(source).enqueue(target, options)` declares a bounded secondary watch. The source may be an owned CRD or a declared Kubernetes read resource; the target must be an owned CRD. In v0.4.1 the explicit mapper is `mode: 'all'`, with `source`, `operator`, or `all` namespace fan-out. The host watches the source and reconciles the bounded set of target instances without placing application-specific graph traversal in the framework.

Built-in bundles are available under `sdk.permissions.k8s.*`, and Events use `sdk.permissions.events.write()`. These helpers return plain Kubernetes RBAC rules that can be passed directly to `sdk.operator({ permissions })` or `app.server({ permissions })`.

## TypeKro Adapter

`typeKro.composition(operator, manifest, options)` adapts a compiled operator shape into a TypeKro install composition. `asComposition()` remains the precise lower-level alias.

The adapter provides:

- generated install resources
- direct and kro factory access
- CRD instance factories for owned CRDs
- `typeKro.operationTarget(graph, spec, options)` for values that can be passed directly to `ctx.apply()`, `ctx.delete()`, proxy `resource.apply()`, and proxy `resource.delete()`
- `typeKro.targetFactory(graph, options)` for reusable graph factories such as `const stack = tenantStack(tenant.spec)`
- `typeKro.inferRbac(graphOrTarget)` for fail-closed RBAC inference as a `Result`
- `typeKro.permissions(graphOrTarget)` for ergonomic RBAC rules, throwing if the graph or target cannot be inspected. Pass them at operator scope with `sdk.operator({ permissions })`, or keep them local to the handler with `sdk.withPermissions(handlerRegistration, typeKro.permissions(target))`.
- operation-target apply/delete rendering with reverse dependency ordering where TypeKro graph dependencies are available
- `typeKro.resource(factory, options)` for TypeKro resource factories whose returned resource instances expose addressed applik8s listener methods such as `deployment.on.updated(handler)`
- `typeKro.kubernetesComposition(...)` and `composition.listenerOperator(...)` for grouping TypeKro-backed instance listeners by composition
- explicit operator grouping overrides such as `deployment.on.updated(platformOperator, handler)`
- finite listener scopes through `Resource.instances([api, worker]).on.updated(handler)`
- selector listener scopes through `Resource.where({ namespace, labels }).on.updated(handler)`
- mixed-resource listener groups through `typeKro.resources([api, worker, service]).on.deleted(handler)`
- `cel` re-exported from the integrated package for TypeKro string expressions such as `ConfigMap({ data: { phase: cel\`${imageStatus.phase}\` } })`

TypeKro listener registration is instance-based. The adapter attaches `.on.*` to the resource returned by the bridged factory, captures concrete `metadata.namespace`/`metadata.name` when present, and emits those addresses into manifest watches. Selector and mixed-resource scopes lower to explicit watch metadata and generated RBAC when Kubernetes can enforce them. The factory itself does not expose `.on.*`, and unsupported predicates fail before artifact emission.

KRO validates ResourceGraphDefinition schemas before applying instances. Graphs that include custom resources from generated applik8s CRDs need those CRDs established before the KRO graph containing the custom resources is accepted; resolved applik8s TypeKro compositions pass those CRDs through TypeKro's public KRO prerequisite resource API.

The precise aliases `toOperationTarget()`, `asOperationTargetFactory()`, and `createGraphAdapter()` remain available for integration authors that need the lower-level adapter vocabulary.

Plain operator handler bundles should import operation-target helpers from `@applik8s/typekro-adapter/targets`, including `operationTarget`, `targetFactory`, `inferRbac`, and `permissions`. That subpath is intentionally lightweight and does not pull TypeKro install/deployment tooling into WASM handler bundles.

TypeKro integration is an optional package. Core SDK, compiler, manifest, and runtime contracts remain TypeKro-neutral.

## Capabilities

v0.3 supports a narrow HTTP JSON capability protocol with explicit idempotency requirements and SecretRef bearer auth. Other capability kinds, protocols, and auth descriptors fail closed.

## Stability

Before `v1.0`, TypeScript APIs and generated manifests may change. Runtime/handler compatibility is guarded by explicit manifest, handler ABI, runtime requirement, and host-import declarations.
