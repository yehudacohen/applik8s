# Leader Election Notes

`applik8s` supports opt-in multi-replica operator Deployments through Kubernetes `coordination.k8s.io/v1` Leases. Operators remain single-replica by default; `deployment.replicas > 1` is accepted only when `runtime.leaderElection.enabled` is true and the Lease configuration is valid.

## Current Safety Gate

Current behavior intentionally fails closed unless the HA contract is explicit:

- compiler manifest generation rejects `deployment.replicas > 1` unless `runtime.leaderElection.enabled` is true.
- generated YAML and TypeKro install synthesis reject multi-replica installs unless the manifest enables leader election.
- the Rust host validates `leaseDurationSeconds > renewDeadlineSeconds > retryPeriodSeconds` before starting controllers.
- the Rust host keeps `/readyz` false until this replica holds the Lease and controller streams are running.
- unsupported `runtime.concurrency.*` settings are rejected rather than ignored.

This prevents users from accidentally running multiple independent controllers against the same resources without a coordination contract.

## Implemented Semantics

The host uses `kube-lease-manager = 0.12.0` rather than a bespoke watch/workqueue implementation. The crate owns Lease create/acquire/renew/release behavior and exposes leadership changes through a Tokio watch channel.

Implemented behavior:

- Lease name comes from `runtime.leaderElection.leaseName`.
- Lease namespace comes from `runtime.leaderElection.leaseNamespace`, generated deployment namespace metadata, or `APPLIK8S_POD_NAMESPACE`.
- holder identity comes from `APPLIK8S_LEADER_ELECTION_IDENTITY`, `APPLIK8S_POD_NAME`, `HOSTNAME`, or a process-local fallback.
- generated YAML and TypeKro Deployments set `APPLIK8S_LEADER_ELECTION_IDENTITY` from `metadata.name` and `APPLIK8S_POD_NAMESPACE` from `metadata.namespace`.
- generated manifests add unrestricted Lease `create` RBAC plus configured-name-scoped `get`, `update`, and `patch` RBAC.
- non-leaders keep `/healthz` healthy and `/readyz` not ready.
- the active leader starts `kube-runtime::Controller` streams and marks `/readyz` ready only while leadership is held.
- leadership loss marks `/readyz` not ready and drops controller streams.
- shutdown marks `/readyz` not ready, drops controller streams, and closes the Lease watch channel so the manager releases the Lease.

## Library Option

Two ecosystem crates were evaluated before implementation:

- `kube-leader-election = 0.44.0`: compatible with the selected `kube` major but less documented for this lifecycle integration.
- `kube-lease-manager = 0.12.0`: compatible with `kube = 4`, well documented, and exposes a watch-channel leadership model that maps directly to readiness and controller start/stop lifecycle.

`kube-lease-manager` was selected. Its `duration` maps to `leaseDurationSeconds`; its renewal grace window is derived as `leaseDurationSeconds - renewDeadlineSeconds`. The crate manages conflict retry/backoff internally, so `retryPeriodSeconds` remains part of the fail-closed timing contract but is not a precise host-controlled retry cadence.

## Remaining Proof Gaps

The implementation is intentionally narrow. Remaining work before calling HA fully production-proven:

- live e2e proving restart/resync does not produce unsafe duplicate effects beyond idempotent reconciliation expectations.
- richer leadership metrics beyond structured logs.
- deterministic tests around leadership loss while a reconcile is in flight.
- reconsider direct Lease API implementation if the runtime needs exact `retryPeriodSeconds` control.

## Readiness Policy

With leader election enabled, readiness should mean "this replica is able to serve as the active controller" rather than merely "the process is alive."

Expected policy:

- non-leader replicas: `/healthz` healthy, `/readyz` not ready.
- active leader after controller construction: `/readyz` ready.
- leadership lost or shutdown started: `/readyz` not ready before controller streams are dropped.
- invalid leader-election configuration: startup fails closed and readiness never becomes true.

## Live Proof

The opt-in adversarial live suite runs on `orbstack` with two replicas, a generated Lease-enabled operator, and assertions that deleting the current holder lets another replica acquire leadership and reconcile the next generation change. Non-leader replicas remain healthy but not ready.
