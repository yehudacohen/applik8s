# v0.6 Release Evidence

v0.6 is the native relational model and reactive application release. Its supported path keeps Drizzle
as the relational schema and relationship authority, derives ArkType runtime contracts, and connects
PostgreSQL RLS, bounded queries, durable streams, authenticated subscriptions, ClickHouse projections,
and browser stores through one inspectable application graph. It also adds the framework-neutral Vite
and Fetch application boundary: one authored model contract lowers to browser/server facades, TanStack
Start mounts the generic gateway, and `ApplicationHost.kubernetes(...)` packages the immutable server
artifact as an OCI workload rather than embedding application source in a ConfigMap.
The same compiler boundary now covers relational migration Jobs, inferred command processors, query gateways, projection and stream
workers, and Hatchet workflow workers. Each artifact records a source digest, pinned base, emitted build
context, and content-derived image reference; `applik8s deploy` builds it through TypeKro `container()`
before applying the graph. The Chirp pressure test rejects executable JavaScript in ConfigMaps and caps
its ResourceGraphDefinition below 2.5 MB. Generated Node source maps remain inspectable build artifacts but
exclude `sourcesContent` and are not copied into runtime OCI contexts by default; the full Chirp artifact
baseline enforces browser, server, RGD, per-context, and aggregate-context ceilings.

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
- a generated application deployed by the public CLI with every authored image built through TypeKro,
  pushed to Harbor, verified by registry digest, and pulled with a namespace-scoped runtime credential;
- direct `Card.create(...)` and `Card.update(...)` admission through JetStream, durable PostgreSQL results,
  transactionally emitted domain events, authenticated query snapshots, and SSE invalidation;
- bounded public-stream replay, authoritative requery, and ClickHouse projection without manual database,
  outbox, public-stream, projection, status, or SSE writes;
- projection worker deletion, recreation, checkpoint resume, continued commands, and continued projection;
- a disposable GuestBook Start application built by Vite and deployed through `ApplicationHost`;
- browser-shaped `GuestBookEntry.create(...)` submission, Kubernetes creation, operator publication and
  rejection, resumable SSE invalidation, authoritative requery, SSR rendering, and host/operator restart
  recovery without manually inserting events or status;
- root deletion initiated and awaited by `applik8s delete`, which resumes the scoped Alchemy transaction
  and delegates Kubernetes finalization to its TypeKro resources;
- runtime-created GuestBook model instances removed before application-root teardown;
- absence of generated children, CR instances, the RGD, graph-owned resources, and application
  namespaces after teardown; and
- the KRO-generated application CRD retained `Active`, empty, and KRO-labeled for safe reuse, matching
  TypeKro 0.31.1's deliberate generated-CRD lifecycle contract;
- two consecutive Chirp deployments that preserve installation UID and immutable artifact identity.

Receipts under `.applik8s-tmp/evidence/v0.6/`, including `chirp-deployment.json` and
`guestbook-start.json`, are machine-local, expire after 24 hours, and are
accepted by `bun run scripts/check-v06-scorecard.ts --require-live --require-chirp`. The release-evidence
workflow runs this complete lane and emits a schema-v2 exact-commit attestation that binds every required
schema-v3 receipt by SHA-256 digest and assertion set. A smaller legacy live subset or schema-v1 summary
cannot attest v0.6. Receipts are not committed substitutes for a fresh candidate run.

## Build dependency audit

`bun run check:package-audit` passes the reviewed, expiring baseline for the coordinated 0.6.0 package
graph. It currently observes seven upstream source advisories propagated to twelve npm findings. The
latest published TypeKro and ComponentizeJS releases still contain those dependency paths. They are
confined to trusted build/compiler tooling and are absent from generated runtime images; they are not a
zero-vulnerability claim. The baseline fails on new, changed, stale, or expired advisories, and
`docs/build-supply-chain.md` records the required upstream remediation and containment.

## Dependency boundary

KRO 0.9 can finish a graph deletion after the first bounded client wait expires. TypeKro 0.31.1 deliberately
leaves the RGD and generated CRD intact on that timeout; resuming the same Alchemy destroy operation repeats
the supported TypeKro deletion until the durable root, child, Namespace, and RGD cleanup completes. The
generated CRD is deliberately retained `Active` for reuse even after successful normal cleanup. The release
lane treats a timeout as failure and never removes an RGD, CRD, Namespace finalizer, or application finalizer
underneath KRO. A successful receipt proves the root, RGD, graph-owned resources, and namespaces reached
absence and the retained generated CRD is empty before the test reported success. Deleting a retained
generated CRD is a separate administrative garbage-collection operation, not part of normal application
teardown.

## Maturity boundary

The release does not claim cross-provider transactions, universal exactly-once delivery, inferred CDC
for writes outside the observable PostgreSQL boundary, unbounded subscriptions, automatic production
capacity planning, or a second-cluster portability proof. Synthetic performance receipts are labeled as
such and are never presented as database or cluster throughput. The tracked Chirp artifact report measures
uncompressed build inputs, not final image layers, Harbor transfer time, Ceph throughput, or pod cold start;
those remain live evidence requirements.
