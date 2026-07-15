# v0.5 Release Evidence

v0.5 is the durable workflow, bounded connection-scoped Kubernetes, and operator-runtime DNS publication release. Its supported path is the provider-neutral task/workflow graph with the pinned PostgreSQL-only Hatchet implementation, named Kubernetes connections whose credentials remain host-owned, and the handler-safe provider-neutral DNS contract with its first-party ExternalDNS adapter.

The final runtime-hardening proof also covers module-provenance-aware static handler capture, including
same-named helpers reached through different import aliases; two independently bound Kubernetes
connection aliases against the OrbStack API; two-replica follower readiness; Lease renewal during a
reconcile longer than the Lease duration; graceful rolling handoff before expiry; and forced-holder
crash failover. Cross-API-server execution remains intentionally unclaimed until a second Kubernetes
cluster is available to the release suite.

## Local evidence

The release gate is:

```sh
bun run check:v05:local
```

It covers the coordinated package build, typecheck, lint, module dependency directions and generated runtime-contract parity, workflow and connection contracts, character tests, package-consumer installation, the executable v0.5 scorecard, performance budgets, Rust formatting, Clippy, and the complete Rust suite. The maintainability test consumes `benchmarks/v0.5/maintainability-budgets.json` as its single line-budget authority.

Connection-specific contract evidence includes:

- host protocol compatibility between generated bundles and the built `0.1.1` host;
- strict installation-binding and endpoint-policy schemas;
- connection-only read declarations that do not generate management-cluster RBAC;
- complete implicit verb enforcement for guarded apply, patch, and delete;
- owner-bound managed identity and optimistic apply preconditions;
- create-only remote writes that hand ownership to SSA under resource-version tests and remove only the temporary create-manager entry;
- exact kubeconfig Secret RBAC and credential-profile rejection;
- plain Kubernetes and TypeKro installation lowering.

DNS-specific contract evidence includes:

- deterministic IDNA, IPv4, IPv6, ordering, digest, and stable-publication-identity normalization;
- explicit CRD-source, domain, namespace, record-type, observation, mutation-policy, registry, dry-run,
  provider-ownership, update, and deletion capability matrices;
- complete ownership metadata, durable same-name-replacement detection, UID/resource-version JSON Patch
  tests, and UID/resource-version Kubernetes delete preconditions;
- typed local and connection-scoped `DNSEndpoint` reads and mutations;
- exact label/annotation-to-target-name compiler and host lowering without list fan-out;
- a clean packed `@applik8s/applik8s/dns` import and ComponentizeJS compilation without Node or TypeKro
  runtime dependencies.
- the longitudinal Tenant Platform v0.5 artifact includes the local DNS controller, stable identity, guarded finalization, and exact label/annotation-to-owner wakeup contract instead of proving DNS only in an isolated fixture.
- graph serialization, compatibility validation, generated HTTP bundling, exposure normalization, and TypeKro emission planning remain separate internal modules with ratcheted ceilings.

## Live evidence

Run the exact candidate against OrbStack with:

```sh
bun run check:v05:prerelease:orbstack
```

The workflow proof exercises durable retry, waits, worker replacement, resume, compensation, intervention, cancellation, and TypeKro-first teardown. The live connection proof binds a separate kubeconfig identity, proves bounded reads and guarded create/update/finalization delete, verifies both local and remote RBAC isolation, and cleans up the direct installation. The DNS proof runs ExternalDNS v0.21.0 with its in-memory provider, publishes through both local and named-connection paths, waits for current-generation controller observation, restarts the parent operator, performs stable-identity A-to-CNAME-to-A changes, proves an exact local owner wakeup, and finalizes through UID/resource-version-preconditioned deletion. It reports propagation as not checked. Rust contract tests separately reject stale mutation authority and credential rotation within an invocation; TypeKro synthesis tests prove the same binding schema and exact Secret RBAC.

The quick performance gate retains a 1,000-operation steady-state observation sample, records cold start separately, and warms the observation path before applying throughput and latency budgets. This prevents a single scheduler pause from dominating a 100-operation micro-sample while keeping cold-start evidence visible.

The tag-driven release workflow additionally builds the v0.5.0 operator host for `linux/amd64` and `linux/arm64`, anonymously verifies the public OCI manifest, publishes all npm packages together, installs them in a clean consumer, resolves the host tag to its immutable digest, and builds the generated operator image before creating the GitHub release.

## Explicit boundary

v0.5 does not claim cross-cluster transactions, remote watches, remote owner references, remote status/events/finalizers, arbitrary credential plugins, a cluster registry, or a multi-cluster workflow engine. One mutation plan may address at most one remote connection. Public streams, distributed projections, authenticated subscriptions, and reactive UI delivery remain v0.6 work.
