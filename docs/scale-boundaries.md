# Scale and Performance Boundaries

Applik8s v0.4.1 makes capacity explicit and establishes repeatable evidence; it does not claim unlimited or automatic scaling.

## Control-plane reconciliation

Operator-host reconciliation remains intentionally single-worker and single-in-flight per resource. Reconcile plans are bounded, deadlines are mandatory, and queue depth is controlled by the host. Multi-replica operator deployments still require the supported leader-election contract. This conservative control-plane policy is separate from generated command processors.

## Generated command processors

Each model processor has one normalized deployment policy in the application graph:

- `replicas`: `1..32`
- `concurrency`: `1..64` per replica
- `maxAckPending`: at least `replicas * concurrency`, at most `65,536`
- explicit CPU/memory requests and limits
- optional node selection
- a PodDisruptionBudget and soft hostname topology spreading by default when replicas are greater than one

The effective execution ceiling is `replicas * concurrency`. Every replica shares the durable JetStream consumer, while PostgreSQL inbox, idempotency, revision, and advisory-lock contracts remain authoritative. Conflicting processor policies on commands sharing a model fail during graph construction.

This is a manual, bounded scaling story. Lag-driven KEDA scaling is deliberately deferred until lag metrics, scale-down draining, database saturation, and minimum/maximum replica semantics can be specified together.

## Performance evidence

`bun run benchmark:v041:record` records:

- local bounded-scheduler throughput, latency, maximum concurrency, RSS, and heap growth
- cold processor-runtime import latency
- ImageJob and Tenant Platform build latency and artifact sizes
- declared CPU/memory capacity and cost units for one, two, and four replicas
- PostgreSQL same-key versus distinct-key contention when `APPLIK8S_BENCH_DATABASE_URL` is set
- real JetStream consumer scaling at one, two, and four replicas when `APPLIK8S_BENCH_NATS_URL` is set

The latest observation is [the v0.4.1 baseline](../benchmarks/v0.4.1/baseline.json). Timestamped reports in `benchmarks/v0.4.1/history/` are append-only evidence. Reports include runtime, architecture, CPU, memory, Git revision, and dirty state so unlike environments are not silently compared.

`bun run check:v041:performance` is the fast regression gate. It verifies hard concurrency and memory bounds plus generous pathology ceilings. Timing observations are history, not portable guarantees.

Two bundle profiles are intentionally distinct:

- normalized structural dispatch is kept below 250 KB JavaScript and 20 MB WASM by compiler tests;
- capability-rich import-entrypoint bundles, including libraries such as the AWS SDK or Kubernetes client, are bounded at 4 MiB JavaScript and 40 MiB WASM.

The import-entrypoint profile remains the largest optimization opportunity. When a handler captures arbitrary module-scope libraries, reconstructing the authored module retains authoring-time initialization that normalized structural dispatch avoids.

## Cost interpretation

Applik8s records requested and limited CPU millicores and memory MiB per replica count. These are portable capacity/cost units, not dollar estimates. Dollar cost depends on cluster bin-packing, node prices, reservations, and provider billing and should be applied outside the framework.

## Remaining boundaries

- no automatic consumer autoscaling
- no published sustained soak or maximum-throughput claim
- database contention depends on command key distribution and handler transaction duration
- capability-rich bundle size depends on the libraries captured by the handler
- Kubernetes pod memory requires a cluster metrics source and is not inferred from local Node RSS
