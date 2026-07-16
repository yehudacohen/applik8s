# v0.6 Release Evidence

v0.6 is the native relational model and reactive application release. Its supported path keeps Drizzle
as the relational schema and relationship authority, derives ArkType runtime contracts, and connects
PostgreSQL RLS, bounded queries, durable streams, authenticated subscriptions, ClickHouse projections,
and browser stores through one inspectable application graph. It also adds the framework-neutral Vite
and Fetch application boundary: one authored model contract lowers to browser/server facades, TanStack
Start mounts the generic gateway, and `ApplicationHost.kubernetes(...)` packages the immutable server
artifact as an OCI workload rather than embedding application source in a ConfigMap.

## Local candidate gate

```sh
bun run check:v06:local
```

The local lane covers coordinated package builds, typecheck, lint, module dependency directions, all
implemented tests, focused v0.6 contracts, clean packed-consumer imports and builds, the executable
scorecard, and synthetic performance ceilings. The Rust lane adds formatting, warning-free Clippy, host
and bridge contracts, real ComponentizeJS/WIT/Wasmtime invocation, nested status fidelity, timeout and
capability enforcement, and generated-contract parity.

## Live candidate gate

```sh
bun run check:v06:prerelease:orbstack
```

The live lane requires an explicitly selected disposable OrbStack context. It proves:

- PostgreSQL migrations, RLS tenant isolation, locking, rollback, duplicate recovery, and ordered change observation;
- ClickHouse idempotent projection writes, checkpoint durability, and provider restart behavior;
- generated TypeKro apply plus migration, gateway, and projection readiness;
- authenticated query snapshots and SSE invalidation;
- bounded public-stream replay and continuation;
- projection worker deletion, recreation, checkpoint resume, and continued projection;
- a disposable GuestBook Start application built by Vite and deployed through `ApplicationHost`;
- browser-shaped `GuestBookEntry.create(...)` submission, Kubernetes creation, operator publication and
  rejection, resumable SSE invalidation, authoritative requery, SSR rendering, and host/operator restart
  recovery without manually inserting events or status;
- root deletion initiated and awaited through `composition.factory('kro').deleteInstance()`;
- runtime-created GuestBook model instances removed before application-root teardown;
- absence of generated children, CR instances, generated CRD, and application namespaces after teardown.

Receipts under `.applik8s-tmp/evidence/v0.6/`, including `guestbook-start.json`, are machine-local, expire after 24 hours, and are accepted by
`bun run scripts/check-v06-scorecard.ts --require-live`. They are not committed substitutes for a fresh
candidate run.

## Build dependency audit

`bun run check:package-audit` passes the reviewed, expiring baseline for the coordinated 0.6.0 package
graph. It currently observes seven upstream source advisories propagated to twelve npm findings. The
latest published TypeKro and ComponentizeJS releases still contain those dependency paths. They are
confined to trusted build/compiler tooling and are absent from generated runtime images; they are not a
zero-vulnerability claim. The baseline fails on new, changed, stale, or expired advisories, and
`docs/build-supply-chain.md` records the required upstream remediation and containment.

## Dependency boundary

KRO 0.9 may orphan completed Pods when deleting generated migration Jobs and may leave an empty generated
CRD terminating after the RGD and all instances are gone. Application deletion still goes through and
awaits the TypeKro factory. The disposable test harness records narrowly bounded recovery only after that
root deletion succeeds and fail-closed absence checks prove the objects are safe to remove. These
recoveries are cluster hygiene, not native KRO lifecycle claims.

## Maturity boundary

The release does not claim cross-provider transactions, universal exactly-once delivery, inferred CDC
for writes outside the observable PostgreSQL boundary, unbounded subscriptions, automatic production
capacity planning, or a second-cluster portability proof. Synthetic performance receipts are labeled as
such and are never presented as database or cluster throughput.
