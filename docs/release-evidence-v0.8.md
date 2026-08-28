# v0.8 Release Evidence

v0.8 is the portable stateful runtime release. A candidate is qualified only
when deterministic/local gates and target-live receipts identify the same exact
commit. MiniStack, simulated providers, source assertions, and an OrbStack
cluster whose active CNI does not enforce Cilium policy cannot substitute for
the required target evidence.

## Local candidate gate

```sh
bun run check:v08:local-qualification
```

This lane is deliberately runnable without a Kubernetes cluster. It covers the
canonical graph and admission foundations, local and AWS-local lifecycle,
provider conformance, target parity, generated applications, Celld protocol and
realtime behavior, package consumers, Rust, security, migration, product, and
performance history. Kubernetes actor lifecycle remains in the target-live
packet rather than being hidden in a command named `local-qualification`.

## Exact-commit target packet

The Release Evidence workflow accepts one schema-v1 aggregate attestation for
the exact candidate commit. `scripts/verify-v08-live-evidence.mjs` requires all
of these independently identified receipts:

- `real-aws`: native Alchemy lifecycle, IAM, networking, encryption, bounded
  cost and cleanup, CloudWatch, EventBridge Scheduler, and Athena/Glue/S3;
- `kubernetes-cilium`: workload identity, Secret projection, allow/deny
  enforcement, restart continuity, drift repair, and UID-safe cleanup on a
  cluster where Cilium is the active pod CNI;
- `kubernetes-platform`: ClickStack, Kubernetes and Hatchet scheduling, and the
  independently consumable Celld operator fleet lifecycle;
- `celld-operator-image`: an immutable exact-commit manifest anonymously
  inspectable for both `linux/amd64` and `linux/arm64`; and
- `agentic-product-browser`: a freshly packed generated product publishing and
  querying historical usage through the browser transport with workspace
  isolation and graph-backed cleanup.

Each receipt binds its environment identity, run interval, content digest,
closed assertion set, bounded-cost statement, and leak-free cleanup. Missing,
duplicate, stale, future-dated, foreign-commit, or unrecognized evidence fails
closed. The verifier contract can be checked without credentials:

```sh
node scripts/verify-v08-live-evidence.mjs --self-test
```

The aggregate file is uploaded as
`applik8s-v0.8-live-<commit>/applik8s-v0.8-live-evidence.json`. The tagged release
workflow downloads and revalidates that artifact before package or image
publication. Receipts expire after fourteen days by default.

## Honest external boundaries

The current development machine has no real AWS credentials, and OrbStack's
installed Cilium components are not its active pod CNI. Those are execution
boundaries, not reasons to weaken the contract. The acceptance manifest remains
`proposed`, and target-dependent gates remain false, until the exact receipts
exist. The commit-addressed Celld candidate workflow can publish images before a
semver tag without weakening immutable release identity.
