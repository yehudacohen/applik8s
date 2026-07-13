# v0.4.1 Optimization Evidence

v0.4.1 is a semantic-preserving optimization and capacity-hardening release. It does not add workflows, public streams, projections, or automatic autoscaling.

## Implementation changes

- processor policy normalization is isolated from model graph registration
- bounded async scheduling and command-binding indexing are isolated runtime modules
- compiler capacity lowering is isolated from processor source generation
- handler bundles are minified with names retained for diagnostic stability
- processor graph contracts now record replicas, per-replica concurrency, aggregate `maxAckPending`, resources, node selection, disruption policy, and cost/capacity units
- multi-replica Deployments receive a default PodDisruptionBudget and soft hostname topology spreading
- the packed executable is invoked through `node_modules/.bin`, and the operator-only entrypoint is checked for Node-oriented application dependencies
- packed-package validation rejects emitted bare runtime imports that are absent from the importing package's direct dependency manifest
- runtime dispatch serializes normalized operator metadata and statically extracts reachable handler helpers/imports across local modules; selectively used properties from concrete operator-factory arguments are captured without retaining unused authoring inputs, while unrecoverable lexical state fails closed
- declared finalizers are installed before normal reconciliation and removed after successful finalize cleanup
- bounded secondary watches lower to source watch RBAC, target list RBAC, and host-side target reconciliation; undeclared sources and non-owned targets fail closed
- Kubernetes YAML is written to staging and atomically replaces the prior output directory

## Framework integration evidence

- A live OrbStack host regression creates two Deployments and proves positive list reads through namespace, labels, fields, bounded pages, and continuation tokens. The SDK decoder verifies the returned page contract.
- The compiler ArkType regression excludes the authored ArkType graph and enforces a sub-20 MB component ceiling for the normalized trivial operator.
- A thin-entrypoint regression imports an operator factory and a transitive helper, captures only the used factory argument property, and proves an unused authoring dependency is absent from the dispatcher. The unchanged downstream modular operator compiles to a 14.6 MB component with zero ArkType/schema source inputs.
- The live reconcile fixture now relies on the host to install and remove its declared finalizer.
- A two-pass YAML regression changes namespaced RBAC to cluster RBAC in one output directory and proves obsolete Role/RoleBinding files are absent.

## Recorded baseline

The complete local-container run is stored in [`benchmarks/v0.4.1/baseline.json`](../benchmarks/v0.4.1/baseline.json), with timestamped observations under `benchmarks/v0.4.1/history/`.

On the recorded Apple M5 Max / Bun 1.3.13 run:

- bounded scheduler: 1,000 tasks, maximum active `8`, about `6,679/s`, p95 task latency `1.54 ms`, RSS growth about `3.1 MiB`
- processor-runtime cold import: p95 `86.69 ms`
- PostgreSQL same-key contention: about `334/s`, p95 `27.35 ms`
- PostgreSQL distinct-key contention: about `1,162/s`, p95 `10.09 ms`
- JetStream, 500 messages at concurrency 4/pod: one replica `5,266/s`, two `7,868/s`, four `13,094/s`
- ImageJob build: `6.56 s`, JavaScript `335,094` bytes, WASM `17,540,924` bytes
- Tenant build: `11.00 s`, largest JavaScript `1,082,212` bytes, WASM `25,573,348` bytes; its canonical command processor is generated at two replicas with concurrency four per pod

These are observations, not universal throughput guarantees. PostgreSQL and NATS ran in short-lived local containers and the harness removed them after completion.

## Gates and ceilings

- normalized structural dispatch remains below 250 KB JavaScript and 20 MB WASM
- capability-rich closures remain below 4 MiB JavaScript and 40 MiB WASM
- generated Node processors remain below the safe 900 KB ConfigMap source limit
- scheduler maximum activity may never exceed configured concurrency
- a quick performance gate checks cold import, memory growth, throughput pathology, and artifact ceilings

Automatic lag-based scaling remains deferred. v0.4.1 provides a credible manual scaling contract and the evidence needed to design KEDA against measured consumer lag and database saturation rather than assumption.
