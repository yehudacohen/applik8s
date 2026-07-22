# API Reference

For the v0.6 native Drizzle/Kubernetes model, trusted-context, migration, query, stream, client, and
projection contracts, see [Native Models and Live Queries](./native-models-and-live-queries.md).

This is the supported public surface for the pending `applik8s` v0.6 release. It includes the v0.3 application substrate, v0.4 durable commands, v0.5 tasks/connections, and v0.6 native models, live queries, browser facades, and application hosting.

## Packages

- `@applik8s/applik8s`: umbrella package for normal users. Re-exports SDK, TypeKro adapter, and typed container helpers.
- `@applik8s/applik8s/dns`: handler-safe DNS normalization, observation, capability, ownership, and ExternalDNS `DNSEndpoint` decisions.
- `@applik8s/sdk`: CRD authoring, operator definitions, handler dispatch, runtime schema helpers, and status helpers.
- `@applik8s/compiler`: build pipeline, manifest generation, Kubernetes YAML generation, diagnostics, runtime contract helpers, and WASM component generation.
- `@applik8s/testing`: local operator test harness and proxy recorder utilities.
- `@applik8s/typekro-adapter`: TypeKro install composition and operation-target adapters.
- `@applik8s/core`: shared types and contracts.
- `@applik8s/runtime-contract`: generated runtime/handler ABI schema constants.
- `@applik8s/runtime`: TypeScript-facing operator runtime interfaces.
- `@applik8s/typetainer`: typed container image reference utilities.
- `@applik8s/client`: framework-neutral browser/server operation clients and transports.
- `@applik8s/react`: router-independent providers, hydration boundary, and live-query/mutation hooks.
- `@applik8s/server`: framework-neutral authenticated request scope and Fetch-compatible Kubernetes gateway.
- `@applik8s/vite`: graph discovery, dual-runtime facade partitioning, dependency-zone enforcement, and web-artifact recording.
- `@applik8s/tanstack-start`: the thin Nitro/TanStack adapter; it does not re-export application providers.

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
- `myApp.storage.postgres('db', { database, migrations: 'generated-job' })` for the concrete Postgres `ModelStore` slice
- `myApp.model('Name', { spec, indexes })` for storage-backed app data
- `myApp.http('server', (http) => { ... })` for generated HTTP workloads with inferred resources/models
- `myApp.on(Resource, { created, updated, finalize })` for explicit app-native lifecycle controllers
- `myApp.reconcile(Resource, handler)` as the continuous-reconciliation shorthand
- `myApp.install(childApp, { spec })` to statically nest another installable Application into the generated TypeKro graph
- `myApp.composition` when a TypeKro composition is needed

Provider APIs such as `app.provide(ModelStore, ...)`, `app.defaults(...)`, and explicit `app.server(...)` options remain supported for advanced composition. They should be treated as progressive disclosure: use them when you need a non-default binding, explicit provider ownership, or lower-level compatibility inspection.

PostgreSQL ownership is explicit when data must outlive the Application graph. The compact default,
`ModelStore.postgres()`, makes the CNPG `Cluster` a KRO child and therefore deletes it with the Application
instance. A retained application-owned database uses
`ModelStore.postgres({ ownership: 'direct-provisioned', lifecycle: { deletionPolicy: 'retain' } })`; deployment
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

No `dev` or `package` command is promised in v0.3.

## Native Model Lifecycle

A promoted Drizzle model exposes schema-derived `Model.create`, `Model.update`, and `Model.delete`
operations plus typed `Model.on.create`, `Model.on.update`, and `Model.on.delete` committed-event handlers.
`Model.<mutation>.beforeCommit(options, handler)` adds one transaction-authoritative policy hook for
authorization, validation, derivation, transaction participants, and declared event/command outboxes. It
does not create a second public action or event path. The framework owns the conventional mutation,
durable result, versioned lifecycle event, replay stream, and bounded processor lowering.

Lifecycle handlers receive inferred snapshots: create has `value`; update has `previous` and `current`;
delete has `previous` and a typed tombstone. Handler context exposes event identity, stream name/version,
sequence, recorded time, partition, opaque admitted-context digest, stable idempotency key, admitted
principal and trusted values, attempt, and abort signal. Principal/trusted values are available only inside
generated server-side processors and are excluded from public replay and SSE. Essential initialization
belongs in database defaults or `beforeCommit`; `on.*` is retryable post-commit work.

A genuinely exceptional non-CRUD declaration derives both a direct `Model.<verb>(input)` method and a typed
`Model.on.<verb>(...)` completion registration. Completion carries previous/current snapshots, result,
identity, and committed revision through the same transactional outbox. It does not require an
`.actions({...})` registry.

`$model.on.command`, `$model.on.action`, and generic command registration remain compatibility-only during
the v0.7 migration window and are scheduled for removal at 1.0. They are not the ordinary model API.

## Resource Operations

Generated `app.server(...)` routes can call typed resource helpers such as `Resource.create(...)`, `Resource.get(...)`, `Resource.query(...)`, `Resource.patch(...)`, `Resource.delete(...)`, and `Resource.increment(...)`. `increment(...)` is generated-runtime-only: route code declares the target resource, object identity, spec fields, labels, and numeric field, while the generated server batches increments and flushes them with create-on-miss and patch-on-existing-object semantics.

Server RBAC is inferred from direct helper calls. `Resource.increment(...)` requires `create`, `get`, and `patch` on the target resource.

## App-Scoped Entities

`@applik8s/applik8s/dsl` exports `entity(name, { spec, status })` as the schema-first definition shape for v0.3. Entities can be materialized honestly as Kubernetes control-plane resources with `app.crd(entity, { apiVersion, ... })`; the returned resource supports the same CRD actions, indexes, listeners, and permission inference as `sdk.crd(...)`.

`app.model(entity)` materializes application data through an explicit `ModelStore` provider. The v0.3 concrete storage-backed slice is Postgres/CNPG: generated artifacts include the database dependency, migration SQL, migration Job, generated runtime client, and diagnostics. Unsupported query/index/transaction/storage assumptions fail closed; applik8s does not silently treat CRDs as a hidden database.

## v0.3 Provider Boundary

`app.defaults(...)` and `app.provide(...)` bind capability interfaces such as `ModelStore`, `IndexStore`, `CounterStore`, `EventSource`, `Secret`, `Queue`, `ObjectStorage`, `HttpExposure`, and credential material. v0.3 supplies defaults for all of them, so native actors do not require custom provider wiring.

The defaults are deliberately bounded: Postgres/CNPG for models; Valkey for indexes; declared Kubernetes resources for buffered counters; Kubernetes watches for events; Secrets for secret material and credentials; a resourceVersion-safe ConfigMap queue capped at 1,000 messages and 64 KiB per message; ConfigMap-backed objects capped at 512 KiB each; and Ingress for HTTP exposure.

“Broad provider implementations” can also mean multiple production-scale adapters behind each contract—for example S3 and GCS, several hosted queues, multiple SQL databases, secret managers, and several gateway choices. v0.3 does not require that catalog: it requires one working zero-configuration default for every native interface. `defaultApplicationProviders` exposes those choices, while `app.defaults(...)` and `app.provide(...)` remain override points.

Applik8s consumes TypeKro 0.26 and re-exports its production Valkey, Rook/Ceph, and NATS/JetStream integration surfaces. These are explicit scale-up paths rather than unconditional defaults: operators and durable storage have platform lifecycle prerequisites, while data claims that cannot be reconciled safely by KRO remain direct-only. Keeping those lifecycle prerequisites explicit preserves the bounded-application contract.

## v0.4 Durable Behavior

`command(...)`, `event(...)`, and the `EventLog` provider remain the versioned durable-message foundation introduced in v0.4. Promoted relational models now derive direct CRUD operations and typed committed lifecycle handlers; one exceptional `Model.action(...)` declaration derives a direct method and its completion stream. Both paths lower into PostgreSQL command authority, declared transactional outboxes, bounded generated processors, and JetStream transport. PostgreSQL owns idempotency and durable results; JetStream is at-least-once delivery. `Model.on.command(...)` is compatibility-only. See `docs/commands.md` for ordering, missing-target, revision, recovery, and effect-boundary semantics.

## v0.5 Durable Tasks and Workflows

`task(...)`, `workflow(...)`, `app.task(...)`, `app.workflow(...)`, and `WorkflowEngine` are stable v0.5 APIs. App-bound task and workflow handles support run, start, schedule, result observation, cancellation, and declared signals. Workflow contexts expose declared task/child calls, durable sleep, event waits, a provider clock, and cancellation; direct external effects in orchestration fail compilation, including effects hidden in captured module-scope helpers.

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
