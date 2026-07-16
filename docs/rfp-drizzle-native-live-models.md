# RFP: Native-First Application Models and Live Relational Queries

**Status:** Proposed

**Audience:** Applik8s maintainers and implementing agents

**Requested by:** The future batteries-included TanStack Start framework, with CollectorBills and Vasco as tenant-zero applications

**Revised:** 2026-07-15

**Target:** Applik8s v0.6 contract and implementation track

## Executive summary

Applik8s already has useful but intentionally bounded application-model, durable-command, PostgreSQL,
outbox, workflow, Kubernetes-resource, and application-graph capabilities. Its current PostgreSQL model
stores `id`, `spec jsonb`, `status jsonb`, `revision`, and timestamps. That shape is appropriate for
control-plane-style records, but it must not evolve into a homegrown general-purpose ORM.

Applications such as CollectorBills and Vasco need normal relational data modeling, relations, joins,
aggregates, provider-specific SQL, generated migrations, and the complete Drizzle type experience. They
also need capabilities that Drizzle alone does not supply: durable commands, observable transaction
boundaries, change records, application-graph visibility, provider provisioning, authenticated live
queries, resumable clients, and Kubernetes-native deployment.

This RFP adopts a native-first boundary:

> Applik8s promotes native Drizzle tables and Kubernetes resources into a common distributed application
> model without replacing their native APIs, duplicating their schemas, or obscuring their
> provider-specific guarantees.

A promoted Drizzle table remains usable anywhere a Drizzle table is accepted. A promoted Kubernetes
resource remains usable anywhere its resource definition is accepted. Both gain a small common model
facet for identity, runtime schemas, references, snapshots, revisions, commands, changes, public query
dependencies, and application-graph metadata. Native capabilities remain additive: Drizzle owns
relational queries and SQL transactions; Kubernetes owns watches, status, metadata, and reconciliation.

The developer defines each field once:

- relational fields, constraints, indexes, foreign keys, and relations are defined in Drizzle
- ArkType select, insert, and update schemas are derived from the Drizzle table
- Kubernetes/CRD fields are defined in ArkType and lowered to CRD OpenAPI
- public input and output schemas compose from those model schemas at explicit trust boundaries
- no field-by-field Drizzle-to-ArkType or ArkType-to-Drizzle map is required

Applik8s does not own tenancy, organization membership, authentication policy, or application
authorization. Identity and application providers establish typed trusted-context values. Applications
define authorization policy. Applik8s propagates admitted context, binds it to provider enforcement such
as PostgreSQL RLS or Kubernetes namespace boundaries, and fails closed when a required value or
enforcement capability is missing.

The first live-query implementation remains invalidation and requery. It must not infer incremental
patches from arbitrary SQL. PostgreSQL remains the durable change authority; JetStream is an at-least-once
delivery mechanism. Cursors, reset behavior, and snapshot/resume capability remain explicit and honest.

The existing JSONB model path remains supported without silent reinterpretation. This RFP adds a common
native-model architecture and relational provider path; it does not require automatic migration of
existing JSONB model data.

## Normative decisions

The implementation must preserve these decisions unless a reviewed ADR proves that another design
satisfies the same developer experience and semantic guarantees more safely.

1. **Native objects remain native.** Promoted Drizzle tables remain assignable to Drizzle table APIs.
   Promoted Kubernetes resources retain their resource API, reconcile registration, status, and metadata
   capabilities.
2. **One common model contract exists.** Database models and Kubernetes models are not separate
   developer-facing species. They share identity, schema, snapshot, revision, reference, command, change,
   and query-dependency semantics.
3. **Provider capabilities are additive.** The common contract is intentionally small. It does not
   pretend that PostgreSQL transactions and Kubernetes reconciliation have identical guarantees.
4. **Fields are defined once.** Drizzle is authoritative for relational persistence. ArkType is
   authoritative for ArkType-backed resources and public runtime boundaries. Generated schema views do
   not become independent sources of truth.
5. **Promotion is explicit.** Registering a database schema does not make every table an application
   model. `app.model(table)` deliberately opts a table into distributed model semantics.
6. **Conventions remove ceremony but fail closed.** Primary keys, a conventional `revision` column,
   registered database membership, derived ArkType schemas, and provider-wide access policy may be
   inferred. Ambiguity requires an explicit declaration.
7. **Relationships remain native.** Drizzle relations remain the relational source of truth.
   ArkType-backed models express cross-model identity through an ArkType-compatible typed `Model.ref()`.
   Applik8s normalizes both for graph semantics without creating a competing query language.
8. **Applications own authorization.** Identity providers establish principal attributes; applications
   decide permissions and membership. Applik8s owns typed propagation and declared provider enforcement,
   not tenancy semantics.
9. **Reads and writes have different guarantees.** Normal Drizzle reads remain normal. Observable writes
   execute through revision-safe model updates or an Applik8s observable transaction.
10. **One transaction kernel exists.** JSONB and Drizzle-backed models adapt to the existing durable
    command/result/history/outbox authority. A second relational command processor is forbidden.
11. **Unobserved writes are not misrepresented.** Raw or external writes require explicit
    invalidation/reset or a future CDC provider.
12. **Live SQL begins with invalidation.** Arbitrary relational query results are safely requeried;
    guessed incremental patches are forbidden.
13. **The v0.6 bridge remains layered.** Provider snapshot/change authorities, the authenticated
    application gateway, and browser-safe clients/adapters remain separate.
14. **Frontend integration remains optional.** TanStack Start is first-party integration, not an
    Applik8s-owned frontend framework.
15. **The API is prototype-gated.** Native enhancement, Drizzle Kit compatibility, schema derivation,
    relation inference, and CRD/model interoperability must be proven before the public contract freezes.

## Existing functionality that must be reused

The implementation extends rather than duplicates these capabilities:

| Capability | Existing behavior to preserve |
| --- | --- |
| Application graph | `app(...)` records providers, models, commands, jobs, resources, dependencies, generated artifacts, and authority contracts. |
| ArkType entities | `entity(...)` defines schema-first application data and can materialize CRDs. |
| Kubernetes resources | Resource definitions expose typed actions, listeners, reconciliation, permissions, and status handling. |
| JSONB application models | `app.model(EntityDefinition)` provides bounded PostgreSQL-backed CRUD, indexes, transactions, migrations, and commands. |
| PostgreSQL provider | `ModelStore.postgres(...)` and `app.storage.postgres(...)` provision or bind PostgreSQL/CNPG and generated migration work. |
| Durable commands | Keying, idempotency, ordering, durable results, history, retries, typed rejection, and transaction-safe effect enforcement already exist. |
| Transaction authority | Model state, command inbox/results, history, domain outboxes, and command outboxes share one physical PostgreSQL boundary. |
| Event delivery | PostgreSQL remains authoritative; NATS JetStream is at-least-once transport. |
| Workflows | Provider-neutral tasks and workflows use the v0.5 workflow substrate rather than executing effects in model transactions. |
| v0.6 foundation | Browser, React, and TanStack Start dependency zones already fail closed against server/runtime dependency leakage. |
| v0.6 vision | Explicit streams, subscriptions, projections, authenticated gateways, shared hooks, SSR/hydration, and router portability are already planned. |

The new path must not create another application graph, provider system, command processor, migration
runner, browser protocol, event transport, workflow engine, or Kubernetes deployment system.

## Problem statement

### The current model is not a relational application model

The existing PostgreSQL runtime uses a fixed table:

```text
id text primary key
spec jsonb not null
status jsonb
revision text not null
created_at timestamptz not null
updated_at timestamptz not null
```

Its query API deliberately fails closed for unsupported filters, ordering, and index semantics. It does
not attempt to expose joins, relations, arbitrary selection, aggregation, range predicates, SQL
expressions, full-text search, arrays, generated columns, bulk mutations, or the complete PostgreSQL
surface.

Expanding that API into a general relational abstraction would reproduce Drizzle incompletely and create
a permanent compatibility burden.

### A separate relational model type is also wrong

Adding `app.relationalModel(...)` beside existing models would divide the application into incompatible
species. Database rows and Kubernetes resources would acquire separate command, query, relationship,
change, authorization, and projection experiences even when application code wants to reason about them
as ordinary domain models.

Likewise, wrapping a Drizzle table in an Applik8s object would force developers to move between
`Card.table`, `Card.sql`, `context.drizzle(Card)`, and the original `cards` object. That loses the native
experience and makes Applik8s visible precisely where it should disappear.

### One universal schema language is not lossless

ArkType cannot uniquely determine whether a string should be PostgreSQL `text`, `varchar`, `uuid`,
`citext`, an enum, or a custom type. It cannot infer indexes, generated values, SQL defaults, foreign-key
actions, storage codecs, or provider-specific expressions. Requiring ArkType to generate every relational
schema would turn Applik8s into a second ORM.

Conversely, Kubernetes schemas and controller status semantics should not require Drizzle.

The correct promise is therefore one field definition per native authority, with derived common runtime
schemas:

- Drizzle-first for relational persistence
- ArkType-first for Kubernetes and nonrelational model definitions
- common Applik8s model semantics layered on both

## Target developer experience

The following API is illustrative. Exact names may change after the prototype gate, but the absence of
manual field mapping, native assignability, common model semantics, provider-wide access enforcement,
and explicit trust boundaries are normative.

### Native Drizzle schema and relations

```ts
export const sets = pgTable('sets', {
  id: uuid('id').primaryKey(),
  organizationId: uuid('organization_id').notNull(),
  name: text('name').notNull(),
  revision: text('revision').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const cards = pgTable('cards', {
  id: uuid('id').primaryKey(),
  organizationId: uuid('organization_id').notNull(),
  setId: uuid('set_id').notNull().references(() => sets.id),
  name: text('name').notNull(),
  revision: text('revision').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const setsRelations = relations(sets, ({ many }) => ({
  cards: many(cards),
}));

export const cardsRelations = relations(cards, ({ one }) => ({
  set: one(sets, {
    fields: [cards.setId],
    references: [sets.id],
  }),
}));

export const schema = { sets, cards, setsRelations, cardsRelations };
```

### Identity context and provider enforcement

The identity provider, not Applik8s, owns the meaning and origin of the organization attribute:

```ts
const Identity = catalog.identity(oidc({
  issuer: 'https://identity.example.com',
  audience: 'catalog',
}));

const OrganizationId = Identity.attribute('organizationId', {
  claim: 'organization_id',
  schema: type('string'),
});
```

The database declares enforcement once. Every promoted application table must have a compatible column
unless it explicitly opts out as global:

```ts
const Database = catalog.database.postgres('catalog', {
  schema,
  migrations: './drizzle',
  access: postgres.rls({
    context: OrganizationId,
    column: 'organizationId',
    default: 'required',
  }),
});
```

Applik8s propagates `OrganizationId` and installs it through transaction-local PostgreSQL context. It
does not create organizations, decide membership, or decide whether the principal may read a particular
set.

### Promote native tables

```ts
const Set = catalog.model(sets);
const Card = catalog.model(cards);
```

The promoted values remain usable by Drizzle:

```ts
const db = context.database(Database);

await db.select().from(Card).where(eq(Card.setId, setId));
await db.query.cards.findMany({ with: { set: true } });
```

They also expose common model semantics:

```ts
Card.schema.select;
Card.schema.insert;
Card.schema.update;
Card.identity;
Card.revision;
Card.relations.set;
Card.ref();
Card.on.command(...);
```

Primary-key identity, database membership, derived ArkType schemas, registered Drizzle relations, and a
compatible conventional `revision` column are inferred. Nonconventional schemas provide explicit
overrides. Ambiguous composite identity fails closed.

### ArkType and Kubernetes models

```ts
const CatalogImport = catalog.crd(
  entity('CatalogImport', {
    spec: type({
      setId: Set.ref(),
      sourceUrl: 'string',
      requestedAt: 'string',
    }),
    status: type({
      phase: "'Pending' | 'Importing' | 'Completed' | 'Failed'",
      importedCards: 'number.integer >= 0',
      observedSetRevision: 'string?',
      message: 'string?',
    }),
  }),
  {
    apiVersion: 'catalog.example/v1alpha1',
    access: {
      context: OrganizationId,
      namespaceLabel: 'catalog.example/organization-id',
    },
  },
);
```

`CatalogImport` remains a Kubernetes resource definition and supports native reconciliation and status
operations. It also implements the common model contract:

```ts
CatalogImport.on.reconcile(...);
CatalogImport.on.command(...);
CatalogImport.relations.set;

await context.get(CatalogImport, name);
await context.get(Set, setId);
```

`Set.ref()` is an ArkType-compatible identity schema carrying target-model metadata. It validates the
reference representation; it does not pretend that ArkType can synchronously prove target existence.
Existence and integrity are provider/runtime policies.

### Revision-safe commands

```ts
Card.on.command(
  RenameCard,
  {
    key: ({ cardId }) => cardId,
    idempotencyKey: ({ requestId }) => requestId,
    history: true,
    events: [CardChanged],
  },
  async (card, input, context) => {
    const updated = await context.update(
      card,
      { name: input.name, updatedAt: context.now },
      { ifRevision: input.expectedRevision },
    );

    context.emit(CardChanged, {
      cardId: updated.value.id,
      setId: updated.value.setId,
      revision: updated.revision,
    });

    return { changed: updated.changed, revision: updated.revision };
  },
);
```

The concise update path owns the revision predicate, durable conflict, history, change record, result,
and declared outbox semantics. It is not a general ORM.

Complex relational work uses the native database inside an observable transaction:

```ts
await context.transaction(Database, async ({ db, changes }) => {
  await db
    .update(Card)
    .set({ setId: destinationSetId })
    .where(eq(Card.setId, sourceSetId));

  changes.invalidate(Card);
});
```

Where a typed mutation can prove affected model identities, the runtime may derive compact changes.
Broad updates, raw SQL, and ambiguous mutations require an explicit bounded invalidation or reset.

### Public live queries

Public schemas compose from generated model schemas:

```ts
const PublicCard = Card.schema.select.pick('id', 'setId', 'name', 'updatedAt');
const PublicSet = Set.schema.select.pick('id', 'name');

const CardWithSet = type({
  card: PublicCard,
  set: PublicSet,
});

const CardsForSet = catalog.query('cards.for-set.v1', {
  input: type({ setId: Set.ref(), cursor: 'string?' }),
  output: CardWithSet.array(),

  authorize: ({ principal, input }) =>
    principal.can('read', Set, input.setId),

  reads: [Card.relations.set],

  run: async ({ context, input }) => {
    const db = context.database(Database);
    const rows = await db.query.cards.findMany({
      where: eq(cards.setId, input.setId),
      with: { set: true },
      orderBy: [desc(cards.updatedAt), desc(cards.id)],
      limit: 50,
    });

    return rows.map(({ set, ...card }) => ({ card, set }));
  },
});
```

The application owns `authorize`. The gateway establishes the principal and admitted context.
`reads` declares the safe invalidation dependency. Invalidation and requery is the default first-party
live behavior. The framework does not inspect arbitrary Drizzle SQL and invent a delta.

## Common model contract

### Model snapshot

Generic reads and command targets use one provider-neutral shape:

```ts
interface ApplicationModelSnapshot<TValue, TIdentity = string> {
  readonly identity: TIdentity;
  readonly value: TValue;
  readonly revision?: string;
}
```

The common contract does not absorb provider-specific state:

- Kubernetes metadata, resource version, generation, status subresources, and finalizers remain on the
  Kubernetes capability
- Drizzle clients, relations, selected row types, transactions, and provider SQL remain on the database
  capability
- common code may depend only on identity, value, revision, commands, references, and declared changes

### Native enhancement

Promotion must preserve native assignability and inference. The implementation may use safe
non-enumerable augmentation, a transparent proxy, a sidecar registry plus typed facet, or another proven
mechanism. The prototype must decide the mechanism.

The implementation must prove:

- promoted tables work with `select().from(...)`, `insert`, `update`, `delete`, aliases, subqueries, and
  relational queries
- relation inference remains intact
- Drizzle Kit and migration/schema tooling do not observe Applik8s metadata as database schema
- table symbols, column identity, schema identity, and driver behavior are preserved
- promotion does not mutate shared source objects in surprising or order-dependent ways
- model metadata cannot collide with native APIs or leak as enumerable schema fields
- promoted Kubernetes resources preserve their existing handlers, actions, status, and compiler behavior

If direct top-level augmentation cannot satisfy those requirements, a single discoverable model facet is
acceptable. Requiring developers to unwrap a native object for ordinary Drizzle or Kubernetes use is not.

### Identity and revision

- A single-column Drizzle primary key is inferred as identity.
- Composite identities require a canonical, versioned tuple codec or fail closed.
- Kubernetes model identity defaults to its declared resource identity.
- A model has a stable graph identity derived from its application, provider, and native table/GVK
  identity. Renames that would change durable identity require an explicit compatibility alias or
  migration.
- Internal generic change compatibility may use the normalized model-contract/schema digest. Public
  commands, events, streams, and queries retain their own explicit semantic versions; a schema digest is
  not silently presented as a public API version.
- Mutable command-enabled relational models require a durable revision authority.
- A compatible conventional `revision` column may be inferred.
- Nonconventional columns are explicit.
- Expected revisions participate in the SQL mutation predicate or an equivalent locked operation.
- Revision conflicts become typed durable outcomes.
- Kubernetes revision semantics remain resource-version/generation aware and must not be falsely equated
  with PostgreSQL transaction revisions.

### Generated schemas

The relational adapter derives ArkType select, insert, and update schemas from Drizzle using the supported
Drizzle ArkType integration.

Generated schemas:

- preserve inferred nullability, optionality, generated/default behavior, enums, supported column
  refinements, and branded types where the adapter supports them
- remain traceable to the table and schema digest
- may be composed with ArkType `pick`, `omit`, intersections, and refinements
- do not become an independent persistence definition
- fail closed for unsupported custom types unless the application supplies an explicit adapter

Public query, command, and event boundaries remain runtime validated. Compile-time inference is not
runtime validation.

## Relationship semantics

### Relational models

Drizzle table constraints and Drizzle relations remain authoritative. Applik8s must not require users to
repeat:

- foreign-key columns or targets
- one/many relation definitions
- relation aliases
- junction tables
- selected relation types

The relational adapter normalizes enough metadata for:

- application-graph edges
- command participant validation
- query invalidation dependencies
- authorization-policy inputs
- projection dependencies
- diagnostics and documentation

Normalized relation metadata is not a provider-neutral query AST. Relational traversal remains Drizzle.

### ArkType-backed and cross-provider models

`Model.ref()` produces an ArkType-compatible identity schema and a typed relationship descriptor.

The descriptor records:

- source and target model identity
- local field path
- cardinality where known
- optional inverse name
- representation
- integrity classification
- validation/reconciliation policy

Integrity classifications distinguish at least:

- database foreign key
- Kubernetes owner reference
- admission-validated reference
- reconcile-checked reference
- observed reference
- soft/unverified reference

Cross-provider references never imply an atomic foreign key. The graph and diagnostics expose the exact
guarantee.

## Trusted context, access, and authorization

### Ownership boundary

Applik8s does not own:

- tenants or organizations
- membership lifecycle
- authentication semantics
- roles or permissions
- billing boundaries
- administrative policy

Identity or application providers define typed trusted-context values. Applications define
authorization. Applik8s owns:

- recording trusted-context requirements
- preventing public request input from impersonating provider-established values
- propagating admitted values through commands, queries, tasks, workflows, events, cursors, and
  subscriptions
- installing declared provider enforcement
- fail-closed diagnostics when context or enforcement is absent
- explicit administrative bypass capabilities and audit evidence

### PostgreSQL enforcement

For the first-party relational provider:

- public/request-path access uses transaction-local context such as `SET LOCAL` or transaction-local
  `set_config`
- session-scoped context on pooled connections is forbidden
- RLS policies are generated or packaged through migrations and verified before readiness
- required-context tables fail closed when their compatible access column is missing
- global tables opt out explicitly
- framework inbox, result, history, outbox, and generic-change records retain the admitted context needed
  for authorization and replay, while remaining inaccessible as public application tables
- administrative and cross-context access requires a separate declared capability, preferably a separate
  role or pool
- public query clients are read-only by default

### Kubernetes enforcement

Kubernetes-backed context may be established by an explicit namespace boundary, trusted namespace label,
admission policy, resource field plus admission evidence, or another declared provider capability.
Applik8s must not treat an arbitrary user-authored resource field as trusted merely because it has a
matching name.

### Authorization lifecycle

Authorization runs at snapshot admission and is revalidated for cursor resume, subscription lifecycle,
and delivery when membership or policy may have changed. Signed cursors do not freeze authorization.

## Observable relational writes

### Simple model updates

The concise `context.update(snapshot, patch, options)` lane supports identity-targeted insert/update/delete
operations with:

- expected revision
- typed missing/conflict outcomes
- validation
- history
- generic change record
- declared domain outboxes
- command inbox/result authority

It covers common durable model mutations without exposing a competing general ORM.

### Observable transactions

The advanced lane exposes a normal typed Drizzle transaction for declared participants in one physical
database. The transaction kernel atomically commits:

- domain mutations
- expected revisions where declared
- command inbox and result state
- history/transition records
- domain event and command outboxes
- generic model change/invalidation records

Cross-database and cross-provider atomicity fail closed. External effects remain forbidden while the
transaction is held and must execute through idempotent tasks, workflows, or outboxes.

### Direct and raw writes

Ordinary Drizzle reads remain available. Writable access outside the observable transaction boundary is
explicitly unobserved.

Direct writes, raw SQL, administrative tools, migrations, backfills, and external services are outside
live guarantees unless they:

- emit a compatible change record in the same transaction
- record a bounded model/query invalidation or reset
- use a future CDC provider

The documentation and diagnostics must never imply that all database writes are automatically observed.

## Generic change and live-query semantics

### Change record

Every committed observable mutation emits a compact durable record in the same PostgreSQL transaction:

```ts
interface ApplicationModelChange {
  readonly changeId: string;
  readonly model: string;
  readonly modelVersion: string;
  readonly operation: 'created' | 'updated' | 'deleted' | 'invalidated';
  readonly identity?: string;
  readonly context?: Readonly<Record<string, string>>;
  readonly revision?: string;
  readonly transactionId: string;
  readonly changedFields?: readonly string[];
  readonly recordedAt: string;
}
```

Context is server-owned and bounded. Changed fields are optional optimization metadata, never
authorization evidence. Full rows are not included by default. Domain events remain separate typed
facts.

### Invalidation before patching

For v1, a query `reads` declaration causes an authorized relevant model change to invalidate and safely
requery the affected query context. Narrowing by identity, relationship, partition, or predicate is
allowed only when proven safe.

Arbitrary SQL results are not incrementally patched by guessed semantics. Unsupported incremental
behavior emits `invalidate` or `reset`.

### Snapshot and resume

Every public snapshot is paired with an opaque provider/query-scoped cursor. The first-party PostgreSQL,
outbox, and JetStream implementation must prevent a change between SSR snapshot and browser subscription
from being lost.

PostgreSQL remains the durable change authority. JetStream may carry delivery position, but a cursor must
encode or reference enough authoritative state to detect publication lag, retention gaps, query-version
changes, context changes, and authorization changes.

Capability classification remains:

- `atomicSnapshotResume`
- `resumableInvalidation`
- `resetOnly`
- `unsupported`

The PostgreSQL/JetStream invalidation implementation must not claim atomic incremental delivery when it
provides resumable invalidation and requery.

## Public gateway and client integration

Browsers never receive PostgreSQL, NATS, Kubernetes, CNPG, ClickHouse, Hatchet, TypeKro, or provider
credentials.

The authenticated application gateway owns:

- principal establishment
- trusted-context admission
- query and command authorization
- input and output validation
- redaction
- query result/time/cardinality budgets
- snapshot execution
- cursor validation/signing or server-side state
- subscription admission, cleanup, resume, reset, and resynchronization
- rate limits, diagnostics, and audit metadata

SSE is the first-party streaming transport. WebSockets remain optional.

The framework-neutral browser client owns:

- validated snapshots
- normalized query state
- bounded caching
- deduplication
- reconnect and cancellation
- invalidation/requery
- reset
- transport, durable-command, workflow, model-revision, and reconciliation progress as separate states

React hooks use the framework-neutral store. TanStack Start supplies SSR/prefetch/hydration and SSE
integration. The same hooks and components must work unchanged in the React Router fixture. TanStack
Query may be an adapter; it is not the projection/change authority.

## Migration semantics

Drizzle migrations remain application-authored or application-generated artifacts. Applik8s owns
execution and deployment semantics:

- immutable artifact digests
- deterministic composition of application and framework migration sources
- advisory locking
- idempotent migration history
- generated job readiness
- bounded retry
- structured status and diagnostics
- drift and missing-migration policy
- explicit destructive-change and backfill posture

Package installation never mutates a database. Migration execution is an explicit generated job or local
developer command.

Schema registration records only serializable artifact identity, digests, dependency edges, and
capabilities in the application graph. Drizzle runtime objects and credentials are not serialized into
the graph or browser artifacts.

## Backward compatibility

The existing path remains supported:

```ts
const Account = app.model(AccountEntity, { ... });
```

It retains its JSONB storage and bounded query semantics. The new native Drizzle overload is
distinguishable in types, graph metadata, migration artifacts, diagnostics, and runtime adapters.

The implementation must not:

- reinterpret existing JSONB model tables as relational tables
- silently change existing command semantics
- require existing applications to adopt Drizzle
- claim relational behavior for the current bounded model query API

No automatic JSONB-to-relational migration is required. A documented migration seam is required.

## Application graph requirements

The graph records nodes and edges for:

- native schema/table/resource artifact
- promoted application model
- database/provider and migration artifacts
- identity and revision authority
- native and normalized relationships
- trusted-context requirement and provider enforcement
- public queries and authorization contracts
- durable commands and transaction participants
- generic change authority
- domain streams and outboxes
- gateway routes and delivery capability
- cursor and resume classification
- browser/client adapter consumption
- workflows, tasks, and projections depending on the model

The graph distinguishes:

- native persistence authority
- durable command-result authority
- model revision authority
- generic change authority
- transport delivery authority
- query snapshot authority
- subscription cursor authority
- Kubernetes reconciliation authority

Secrets, credentials, raw identity tokens, and nonserializable native runtime objects are never graph
data.

## Package and dependency boundaries

Expected internal responsibility zones include:

- provider-neutral common model, relationship, context, change, query, and cursor contracts
- application-authoring promotion and graph registration
- server-only Drizzle/PostgreSQL adapter
- generated transaction, migration, outbox, and gateway runtimes
- browser-safe protocol and client store
- router-independent React hooks
- TanStack Start integration
- React Router acceptance fixture

Dependency rules:

- core contracts do not import Drizzle runtime, PostgreSQL clients, Kubernetes clients, TypeKro, Node, or
  browser frameworks
- the relational adapter may depend on Drizzle and ArkType server-side
- browser and React packages do not import Drizzle, PostgreSQL, Kubernetes, TypeKro, compiler, runtime, or
  provider SDKs
- TanStack Start integration depends on browser-safe protocol/client and server gateway seams
- TypeKro remains infrastructure composition, not request-path runtime
- operator closure entrypoints remain WASM-safe

## Security requirements

The threat model covers:

- forged trusted-context values
- cross-context identity access
- missing RLS predicates
- pooled-connection context leakage
- cross-context cursor replay
- stale authorization after membership change
- query/command contract confusion
- unsafe public query registration
- SQL injection through dynamic fields/order/filter input
- raw SQL and administrative bypass
- unauthorized subscription fan-out
- leaked credentials or schema implementation details
- sensitive data in generic change records
- event overcollection
- expensive query/subscription denial of service
- migration artifact tampering
- cross-provider reference confusion

Required controls include runtime validation, parameterized framework-owned SQL, transaction-local
provider context, explicit administrative capability, nontransferable cursors, bounded query and
subscription budgets, server-side redaction, secret-reference-only graph data, and browser dependency
zone enforcement.

## Observability requirements

Structured logs, metrics, traces, status, and diagnostics cover:

- database and migration readiness
- promotion/schema derivation failures
- access-context admission and provider enforcement
- RLS policy/context failures
- query duration, result count, timeout, and rejection
- command submission, duplicate recovery, execution, rejection, and revision conflict
- observable transaction duration and rollback
- history/change/outbox commit
- outbox backlog and publish lag
- invalidation, requery, duplicate suppression, and reset
- subscription admission, active count, resume, disconnect, and expiry
- snapshot-to-subscription handoff
- authorization denial
- cursor validation/version/context failures
- cross-provider reference validation

Metrics avoid unbounded context, identity, query-input, command-ID, and cursor labels.

## Prototype gate

No broad implementation or public API freeze begins until a disposable prototype proves:

1. One Drizzle table can be promoted while remaining accepted by native select, insert, update, delete,
   alias, subquery, and relation APIs.
2. Drizzle Kit schema discovery and migration generation remain unchanged.
3. ArkType select, insert, and update schemas derive without manual field mapping.
4. A Drizzle relation remains fully inferred and appears as normalized graph metadata.
5. One CRD remains a native resource definition while implementing the common model contract.
6. One `Set.ref()`-style ArkType field records a cross-provider relationship without pretending to enforce
   a foreign key.
7. Generic `context.get()` works for both promoted table and CRD models with one snapshot shape.
8. One provider-wide trusted-context/RLS declaration fails closed for an incompatible table and admits an
   explicitly global table.
9. One revision-safe command uses the existing transaction kernel.
10. One observable Drizzle transaction records a bounded invalidation.
11. Generated graph serialization contains no Drizzle runtime objects, functions, or credentials.
12. Browser dependency gates exclude Drizzle and server implementations.

The prototype report must compare direct non-enumerable augmentation, transparent proxying, and a single
model facet if relevant. The selected mechanism must be justified by native compatibility, typing,
discoverability, collision safety, and serialization behavior.

## Acceptance tests

### Type and native-compatibility evidence

1. A published-package consumer defines related Drizzle tables and promotes them with no casts.
2. Promoted tables retain select, insert, update, column, relation, and query inference.
3. Derived ArkType schemas retain supported nullability, optionality, enum, default, and custom refinement
   behavior.
4. Invalid identity, revision, relationship, database, and context declarations fail at the declaration
   site or before effects.
5. Existing entity-backed models compile and behave unchanged.
6. Promoted CRDs retain resource, reconcile, permission, and status typing.
7. Browser bundles exclude native server/provider implementations.

### Local PostgreSQL evidence

1. Committed Drizzle migrations apply through the packaged migration path.
2. Relations, joins, selected fields, descending order, aggregates, and provider SQL work on promoted
   tables.
3. Provider-wide RLS prevents cross-context reads and mutations, including omitted predicates.
4. Pooled connections cannot retain prior request context.
5. A durable command atomically commits row mutation, revision, result, history, domain event, and generic
   change.
6. Duplicate command delivery returns the original result without repeating mutation or events.
7. A stale expected revision produces a typed durable conflict.
8. A failing handler rolls back all domain and framework records.
9. Same-database multi-model work succeeds; cross-database atomic work fails closed.
10. Raw/ambiguous writes require explicit invalidation/reset.

Real PostgreSQL is authoritative for RLS, locking, concurrency, migrations, and transaction evidence.
PGlite may provide faster nonauthoritative unit coverage.

### Cross-provider model evidence

1. A CRD uses a typed reference to a promoted relational model.
2. The reference identity is runtime validated.
3. Reconcile-time existence checks use the current admitted context.
4. Another context cannot resolve the referenced row.
5. Missing references surface typed status/diagnostics.
6. The graph reports soft/reconcile-checked integrity rather than a false foreign key.

### Live-query evidence

1. A public relational query returns a validated snapshot and opaque cursor.
2. An observable model mutation invalidates only authorized relevant query contexts.
3. Another context receives no invalidation, identity, cursor, or row information.
4. An update between SSR snapshot and subscription is not lost.
5. Duplicate and out-of-order delivery does not regress client state.
6. A disconnected client resumes or receives an authorized reset.
7. Expired, wrong-context, wrong-query-version, stale-authorization, or invalid cursors reset safely.
8. Unobserved direct writes do not falsely appear observed; explicit reset restores correctness.

### Frontend evidence

1. A real TanStack Start application performs authenticated SSR of a promoted relational query.
2. Hydration consumes the SSR snapshot without duplicate initial fetch.
3. SSE resume observes a later command-driven mutation.
4. The UI distinguishes transport acknowledgement, durable result, model revision, workflow progress,
   and Kubernetes reconciliation.
5. The same client, hooks, and component work unchanged in the React Router fixture.

### Live Kubernetes evidence

1. A published-package consumer deploys to an explicit OrbStack context.
2. TypeKro installs or binds CNPG, migrations, gateway/server, command processor, outbox runtime, and
   transport.
3. Restarting server, processor, and transport does not lose durable results or safe resume.
4. Migration failure, drift, missing credentials, RLS failure, cross-provider reference failure, and
   outbox lag surface in status and diagnostics.
5. Teardown follows declared retention and does not orphan framework-owned workloads or credentials.

## Performance and scale requirements

Reproducible baselines retain longitudinal evidence for:

- indexed snapshot latency
- revision-safe command latency
- observable transaction overhead
- well-distributed and hot-identity throughput
- connection-pool contention
- outbox publish lag
- invalidation-to-client latency
- concurrent SSE subscriptions
- reconnect/reset behavior
- browser protocol/client bundle size
- generated server memory
- broad invalidation fan-out

Correctness must not depend on polling every row, replaying complete model history, broadcasting every
change to every client, or loading unbounded query results.

## Delivery phases

### Phase 0: Prototype and ADR

- complete the prototype gate
- select the native enhancement mechanism
- define the exact common model and snapshot types
- define supported Drizzle-to-ArkType behavior
- define native and normalized relationship contracts
- define trusted-context/provider-enforcement contracts
- define mutation and change/invalidation APIs
- define package boundaries and compatibility policy

### Phase 1: Native promotion and schema derivation

- promote Drizzle tables
- preserve native assignability and relation inference
- derive ArkType schemas
- enhance CRD/resource models with the common contract
- implement `Model.ref()`
- record serializable graph metadata
- preserve existing JSONB behavior

### Phase 2: Provider enforcement and observable writes

- implement PostgreSQL provider-wide RLS conventions
- propagate trusted context through request and durable paths
- implement concise revision-safe updates
- adapt observable Drizzle transactions to the existing transaction kernel
- emit generic changes and bounded invalidations
- prove rollback, duplicate recovery, and raw-write limitations

### Phase 3: Public queries and live gateway

- add explicit public query contracts and compositional schemas
- add read-dependency/invalidation semantics
- implement authenticated snapshot, cursor, SSE resume, reset, and requery
- implement framework-neutral protocol and client store
- prove no-lost-update handoff

### Phase 4: TanStack Start and React portability

- add TanStack Start SSR/prefetch/hydration integration
- add router-independent React hooks
- add the React Router fixture
- expose command, model, workflow, and reconciliation progress separately

### Phase 5: Hardening and adoption

- run CollectorBills-shaped relational/context pressure tests
- run Vasco-shaped cross-provider/reference pressure tests
- capture performance and failure evidence
- publish migration, access, relationship, and troubleshooting guides
- update API reference, v0.6 scorecard, release evidence, and package-consumer gates

## Non-goals

This RFP does not require:

- an Applik8s ORM or replacement for Drizzle
- an ArkType-to-general-SQL schema generator
- a generic provider-neutral query language
- a separate `relationalModel` species
- automatic observation of every raw or external PostgreSQL write
- PostgreSQL logical decoding or CDC in v1
- inferred incremental maintenance of arbitrary SQL query results
- an Applik8s-owned tenant, organization, membership, role, or billing system
- an Applik8s-owned frontend router, bundler, component library, or full-stack framework
- the future seeded TanStack application framework itself
- product-specific CollectorBills or Vasco behavior
- non-PostgreSQL relational providers in the first release
- cross-database transactions
- cross-provider exactly-once delivery
- automatic JSONB-to-relational data migration
- a universal cross-provider relationship traversal engine
- WebSockets when SSE satisfies the contract
- ClickHouse implementation beyond preserving the existing v0.6 projection boundary in this workstream

## Required documentation

The implementation is incomplete without:

- a native-first model positioning guide
- a Drizzle table promotion and ArkType derivation reference
- a common model versus native provider capability guide
- a relationship and integrity-classification guide
- a trusted-context, application authorization, PostgreSQL RLS, and Kubernetes boundary guide
- a revision, transaction, history, outbox, and raw-write guide
- a migration authoring, packaging, deployment, and recovery guide
- a public query, cursor, resume, invalidation, and reset guide
- a TanStack Start SSR/hydration guide
- a React Router portability example
- a JSONB model versus native relational model decision guide
- troubleshooting for promotion, schema derivation, migrations, drift, context, RLS, references, revision
  conflicts, outbox lag, invalid cursors, resets, and unobserved writes

## Definition of done

This RFP is complete only when:

1. An application defines relational fields and relations once in Drizzle.
2. Selected tables are promoted without wrappers, casts, or loss of native Drizzle behavior.
3. ArkType select, insert, and update schemas derive without manual field mapping.
4. A CRD defined once in ArkType exposes the same common model semantics while retaining native resource
   behavior.
5. Native Drizzle relations and ArkType model references normalize into honest application-graph
   relationship contracts.
6. Identity/application providers own context meaning; applications own authorization; Applik8s
   propagates and enforces admitted context without claiming tenancy ownership.
7. Simple and advanced observable writes atomically commit domain state, revisions, durable command
   state, history, events, and generic changes through one transaction kernel.
8. A public query composes schemas from models, executes normal Drizzle, invalidates safely, SSRs,
   hydrates without duplicate fetch, and resumes without losing an intervening update.
9. The same browser client and React hooks work in the React Router fixture.
10. Existing JSONB models remain backward compatible and honestly bounded.
11. Published-package, local PostgreSQL, and live Kubernetes gates prove the behavior without repository
    aliases, hidden credentials, or native-object compatibility exceptions.
12. Graph, diagnostics, documentation, and release evidence accurately describe every authority,
    relationship, context requirement, capability, and limitation.

The resulting system can truthfully be summarized as:

> Applik8s turns selected native tables and Kubernetes resources into durable, observable, live,
> deployable application models while preserving the tools and semantics developers already chose.
