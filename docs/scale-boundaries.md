# Scale Boundaries

v0.1 is an evaluation release for serious operator authoring, not a high-scale production benchmark release.

## Expected v0.1 Shape

The public golden path is expected to work well for:

- one operator bundle
- one to a few owned CRDs
- small to moderate CR instances
- local-cluster development and evaluation
- bounded handler execution
- explicit requeue instead of long-running handler work
- generated YAML reviewed before apply

## Boundaries

Treat these as v0.1 assumptions, not hard product limits:

- keep handler bundles small enough to inspect and debug
- avoid large object payloads in replay unless full-payload debugging is explicitly needed
- keep watched resource cardinality modest
- keep per-reconcile operation plans bounded
- use one worker unless future concurrency policy is explicitly supported
- use multi-replica deployments only with supported leader election configuration

## Baseline Measurements

Observed on 2026-06-22 on a local macOS development machine using the documented command:

```sh
bun run applik8s build examples/imagejob.ts --out-dir dist/v0.1-metrics
```

Results:

- compile time: `real 5.13s`, `user 9.63s`, `sys 2.38s`
- `wasm/handler.wasm`: `12,775,349` bytes
- `bundle/handler.js`: `50,553` bytes
- `operator-manifest.json`: `9,609` bytes

Not yet claimed for v0.1 without a pinned live pre-release run:

- generated runtime image size, if locally built
- cold handler invocation latency from live logs or traces
- reconcile latency for a small sample object
- memory usage of the runtime pod in the selected local cluster

These measurements are observations, not guarantees.

## Performance Smoke Test Goal

v0.1 should include at least one smoke test or release note proving the dispatcher, manifest lookup, and status writing do not show obvious pathological behavior on multiple sample objects.

## Post-v0.1

Broader queue depth, controller concurrency, watch cardinality, cache behavior, and sustained soak testing are post-v0.1 work.
