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

The v0.7 Agentic Start release also has an explicit live OrbStack lane:

- `bun run check:v07:performance:live` runs a bounded regression sample against
  the deployed application's real PostgreSQL, JetStream, SSR route, and
  Kubernetes pods; and
- `bun run check:v07:performance:live:record` records a Git/worktree-identified
  baseline and append-only history entry under `benchmarks/v0.7/live/`.

The live contract measures hot-identity and distributed-key PostgreSQL
contention, one/two/four-consumer JetStream convergence, concurrent generated
SSR requests, pod-ready latency, restarts, and aggregate requested/limited
CPU and memory. It creates only temporary database and JetStream benchmark
state and removes that state before exit. The report explicitly identifies
OrbStack, port-forward overhead, bounded duration, missing Metrics API data,
and portable capacity units so these observations cannot be mistaken for EKS,
internet-edge, sustained-soak, or dollar-cost guarantees.

The current v0.6 lanes are:

- `bun run benchmark:v06:record`, which records a Git/worktree- and hardware-identified synthetic-local
  baseline for cache-key latency/throughput/RSS and finite projection cold start, lag, convergence,
  throughput, and RSS; and
- `bun run benchmark:v06:chirp-artifacts:record`, which builds the complete Chirp flagship and records
  browser gzip, server output, RGD size, web/compiler wall time, and each generated OCI context.

Both reports state their limitations. Neither measures PostgreSQL/ClickHouse contention, connection-pool
saturation, sustained JetStream arrivals, Harbor transfer, Ceph throughput, Kubernetes startup, pod memory,
or cost. Those require the explicit live benchmark lane and must not be inferred from local values. The
current reports are [the v0.6 synthetic baseline](../benchmarks/v0.6/baseline.json) and
[the Chirp artifact baseline](../benchmarks/v0.6/chirp-artifacts/baseline.json).

### v0.4.1 historical lane

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
