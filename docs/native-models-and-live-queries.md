# Native Models and Live Queries (v0.6)

Applik8s v0.6 promotes provider-native objects into one small application-model contract. It does not
replace Drizzle, Kubernetes, ArkType, an identity provider, or a frontend router.

## Define relational fields once

Define tables, constraints, indexes, foreign keys, and relations in Drizzle. Register the schema and its
committed SQL migrations, then promote only the tables that participate in application semantics:

```ts
const Database = catalog.database.postgres('catalog', {
  schema,
  migrations: './drizzle',
  access: postgres.rls({ context: OrganizationId, column: 'organizationId' }),
});

const Card = catalog.model(cards, { name: 'Card', database: Database });
```

`Card === cards`: promotion uses one non-enumerable, immutable `$model` facet. Drizzle table/column
identity, relation inference, Drizzle Kit discovery, aliases, native queries, and migrations remain
unchanged. `$model.schema.select`, `.insert`, and `.update` are derived ArkType views. They are runtime
boundaries, not a second persistence schema. A `$model` column collision, composite identity, ambiguous
database, unsupported custom schema, or incompatible revision/access column fails before deployment.

Existing JSONB application models remain supported. Prefer them for control-plane-shaped records with
bounded framework queries. Prefer native relational models for joins, aggregates, provider SQL, and
ordinary application data. There is no automatic JSONB-to-relational migration.

## Relationships and integrity

Drizzle foreign keys and relations remain authoritative. Applik8s normalizes enough metadata for graph
edges, command participants, invalidation, projections, and diagnostics; it does not create a universal
relationship query language. `OtherModel.$model.ref()` is an ArkType-compatible identity schema for
ArkType/CRD fields. A cross-provider reference is recorded as `reconcile-checked`, never as a foreign
key or cross-provider transaction.

`createApplicationModelContext(...)` exposes `get()` and `require()` for promoted Drizzle and Kubernetes
models with the same `{ identity, value, revision? }` snapshot. `require()` throws the typed
`APPLIK8S_MODEL_REFERENCE_MISSING` diagnostic. Kubernetes namespace access declarations compare an
admitted context value with a Namespace label before reading the resource; absent context, Namespace,
or label agreement fails closed.

## Trusted context, RLS, and authorization

Applik8s does not own tenants, organizations, membership, roles, or authentication. Identity/application
providers admit typed values; applications authorize operations; Applik8s propagates those values and
binds provider enforcement.

PostgreSQL access uses transaction-local `set_config(..., true)`, forced RLS, and `USING` plus
`WITH CHECK`. Public code cannot supply admitted values as query input. Pooled connections cannot retain
transaction-local context. Durable commands, emitted commands/events, tasks, workflows, cursors, and
subscriptions carry the admitted context or its server-held digest. Administrative/global tables require
an explicit `access: 'global'` opt-out and should be audited by the application.

## Observable writes and revisions

Normal Drizzle reads remain normal. Writes that must drive durable results or live invalidation use a
revision-safe model command or `context.transaction(Database, ({ db, changes }) => ...)`. The existing
transaction kernel atomically owns domain rows, command inbox/result/history, transitions, event and
command outboxes, and generic model changes. Duplicate delivery returns the recorded result; stale
revisions become a durable conflict; handler failure rolls everything back; cross-database atomic work
fails closed.

Raw or external SQL is not magically observed. Call `changes.invalidate(Model)` when affected identities
are bounded, or `changes.reset(Model)` when they are not. A future CDC adapter may provide another honest
authority; v0.6 never guesses patches from arbitrary SQL.

## Migrations and recovery

Native relational deployment requires `app.database.postgres(..., { migrations })`. The compiler
deterministically combines sorted committed SQL with framework tables, indexes, and RLS; verifies an
optional immutable digest; stores it in a bounded ConfigMap; and emits a retry-bounded PostgreSQL Job
using a Secret-backed URL and advisory lock. Missing files, empty migration directories, digest drift,
oversized bundles, and missing migration authority fail compilation. The migration history makes a
completed digest idempotent. Author migrations remain responsible for PostgreSQL operations that cannot
run transactionally; recover those according to the authored migration's own procedure, then rerun the
same immutable digest or publish a corrective migration.

## Public queries, cursors, and reset

`app.query('name.v1', ...)` declares ArkType input/output, application authorization, trusted-context
requirements, read dependencies, and hard time/result/row budgets. Query code uses normal Drizzle.
The first implementation is authoritative snapshot plus invalidation/requery, not inferred SQL deltas.

The HTTP/SSE gateway authenticates each request, admits context, invokes application authorization,
signs opaque query/input/context/authorization-scoped cursors, limits concurrent subscriptions, audits
admission/reset/close, and periodically rechecks authorization. Expired, tampered, cross-context,
wrong-version, retention-gap, or stale-authorization cursors reset safely. Snapshot and change sequence
share a repeatable-read handoff, so an update between SSR and subscription is not lost. Browser events
carry an explicit monotonic provider sequence; duplicate/out-of-order events cannot regress state.

PostgreSQL outbox streams are explicit versioned contracts with retention, partitioning, replay, and
authorization. `createPostgresApplicationStream` performs bounded, schema-validated, context-digest-
scoped replay. PostgreSQL is the durable authority; JetStream remains at-least-once delivery.

## React and TanStack Start

`@applik8s/client` contains the browser-safe store and HTTP/SSE transport. `@applik8s/react` uses
`useSyncExternalStore` and has no router dependency. `@applik8s/tanstack-start` preloads a request-scoped
client and serializes hydration snapshots so the browser does not repeat the initial fetch. The same
client, provider, and hook work under React Router. Transport acknowledgement, durable result, model
revision, workflow progress, and Kubernetes reconciliation are separate fields; never present broker
acknowledgement as completed domain or reconciliation work.

## Analytical projections

`app.projection()` consumes a replayable stream. The ClickHouse provider is disposable derived state:
stable event ID plus row index makes writes idempotent, checkpoints are explicit, lag is measurable, and
reset performs a full replay. PostgreSQL/outbox remains authoritative; no exactly-once claim crosses
PostgreSQL, transport, and ClickHouse. TypeKro provisions or binds the ClickHouse operator and cluster.

## Troubleshooting checklist

- Promotion failure: verify one primary key, an optional non-null string revision, `$model` collision,
  registered schema membership, and supported Drizzle-to-ArkType columns.
- Empty/cross-context reads: verify provider-admitted context, RLS setting/column, Namespace labels, and
  application authorization separately.
- Migration failure: inspect generated digest, Job logs/status, Secret URL, drift diagnostic, and authored
  nontransactional SQL before retrying.
- Revision conflict: re-read the authoritative snapshot and deliberately retry with its revision.
- Missing reference: surface `APPLIK8S_MODEL_REFERENCE_MISSING` in CRD status; do not manufacture a row.
- Cursor reset: obtain a new snapshot; never decode or transfer cursors between principals or contexts.
- Outbox lag: inspect unpublished rows and transport health; durable rows remain replayable.
- Direct write absent from UI: emit explicit invalidation/reset or move the write into an observable
  transaction. This is expected, not eventual CDC.

