# Goal: Deliver Applik8s v0.8 completely

## Authority and release boundary

The v0.8 manifesto and RFP suite are accepted for implementation. The
authoritative dependency order and evidence discipline are defined by
[`docs/v0.8-execution-plan.md`](./docs/v0.8-execution-plan.md). The active
objective is to implement and qualify the complete program described by
[`docs/v0.8-scorecard.json`](./docs/v0.8-scorecard.json),
[`docs/v0.8-acceptance.json`](./docs/v0.8-acceptance.json), and
[`docs/v0.8-target-compatibility.json`](./docs/v0.8-target-compatibility.json).

No tag, npm publication, GitHub Release, or production deployment is authorized
until the maintainer explicitly requests it. A local implementation being green
must never be reported as real-AWS, distributed-actor, or release-candidate
evidence.

## Required outcome

One semantic application graph must explain and drive local, AWS-local, AWS,
and Kubernetes plans without domain-source target branching. Provider selection
must supply runtime machinery automatically, access must be inferred at the
smallest execution boundary, and unsupported target/provider combinations must
fail during planning with actionable diagnostics.

The v0.8 deliverable includes:

1. a deterministic canonical `ApplicationPlan`, source provenance, stable
   identity, native-plan composition, plan diff, redaction, and lifecycle owner;
2. a persistent local supervisor and independent development portal with safe
   reset, crash recovery, reviewed diffs, truthful validation, and undo;
3. an Alchemy-owned AWS target composed from current native Alchemy AWS
   resources, with custom lifecycle ownership limited to provisioned Valkey
   subnet/groups and receipt-bearing one-shot ECS tasks, and with exact IAM,
   networking, encryption,
   image-build adoption, create/update/drift/delete, AWS-local API fidelity, and
   real-AWS qualification;
4. provider-neutral OpenTelemetry at HTTP, operation, query, event, workflow,
   schedule, actor, and reconciler boundaries, plus local collector,
   ClickStack, CloudWatch, and external OTLP qualification;
5. function-native fixed and dynamic schedules with stable occurrences,
   durable receipts, lease fencing, overlap/misfire/retry/dead-letter behavior,
   local deterministic time, EventBridge Scheduler, and Kubernetes providers;
6. typed immutable lakehouse publication and queries with DuckDB locally and
   S3/Glue/Athena on AWS, atomic manifests, schema evolution, pagination,
   cancellation, access, lifecycle, and scan/cost evidence;
7. deterministic local durable actors plus one fully qualified distributed
   actor provider, with full-turn serialization, fencing, durable state/outbox/
   alarms, crash and rollout recovery, authority, optional realtime, and plan-
   visible provider differences;
8. inferred least-privilege runtime access across maintained typed capabilities
   while preserving independent application authorization; and
9. a versioned Runtime Integrity foundation: canonical JSON policies, shared
   purpose-separated signed envelopes, one canonical admission context, and
   cross-runtime fixed vectors; and
10. Agentic Start, Chirp, and GuestBook acceptance across every disposition in
   the target compatibility manifest.

## Execution sequence

The detailed tasks, exit criteria, and critical path live in
[`docs/v0.8-execution-plan.md`](./docs/v0.8-execution-plan.md). This summary must
not be used to reorder or bypass that plan.

### Phase 0 — checkpoint and release-line reconciliation

- Checkpoint and push the current v0.8 worktree before rebasing or changing
  history.
- Preserve unique changes from the maintained v0.7.x release work, focused
  typed-HTTP-to-workflow work, older worktrees, and known compatibility patches
  through a finding-to-fix-to-test ledger.
- Keep the narrow typed HTTP-to-workflow fix independently reviewable and
  releasable on v0.7.x.
- Rebase the checkpointed v0.8 branch only after the release-line fix is
  authoritative.

### Phase 1 — runtime integrity foundation

- Implement the accepted
  [`docs/rfp-v08-runtime-integrity.md`](./docs/rfp-v08-runtime-integrity.md)
  according to
  [`docs/adr-v08-runtime-integrity-package-ownership.md`](./docs/adr-v08-runtime-integrity-package-ownership.md).
- Define Canonical JSON v1 and explicit TypeKro/CEL adapters.
- Replace duplicated cryptographic envelopes with one versioned,
  purpose-separated signed-envelope substrate and Node/WebCrypto adapters.
- Replace repeated admission shapes with one canonical validated context and
  execution-family-specific narrowed views.
- Add cross-runtime fixed vectors, migration evidence, negative security tests,
  and source gates preventing duplicated cryptography from returning.
- Keep the machine-readable `runtime-integrity` acceptance gate false until the
  canonical implementation and mixed-version migration evidence pass.

### Phase 2 — callable providers and semantic foundation

- Make `application.inject()` return a typed callable provider handle while
  keeping provider implementation, qualification, credentials, private
  dependencies, readiness, access, and topology framework-managed.
- Complete graph/provenance, `ApplicationPlan`, provider guarantee manifests,
  target selection, local supervisor, AWS compiler, Alchemy lifecycle, runtime
  bindings, security bounds, and deterministic plan/diff output.
- Lower the AWS semantic plan directly into Alchemy resources and `Output`
  dependencies. CloudFormation templates, stack orchestration, and AWS CLI
  reconciliation are not an accepted deployment layer. Delete the superseded
  CloudFormation seam and its tests during the cutover; do not preserve it as a
  compatibility path in this pre-1.0 release.
- Keep AWS-local explicitly labelled API-fidelity-only.
- Qualify clean local and MiniStack create/update/restart/reset/delete before
  using those paths as acceptance evidence.

### Phase 3 — stable runtime verticals

- Complete automatic OpenTelemetry runtime installation and boundary coverage.
- Complete local, AWS, and Kubernetes schedule adapters and durable admission.
- Complete inferred runtime access and exact provider policy lowering.
- Add differential provider conformance fixtures across all four targets.

### Phase 4 — beta stateful verticals

- Complete the immutable lakehouse publisher, DuckDB and Athena query runtimes,
  manifest authority, recovery, lifecycle, and cost evidence.
- Complete the actor protocol and local semantic reference, then qualify celld
  (or amend the manifesto and remove the beta surface in full if qualification
  proves impossible). Rivet remains nonblocking.

### Phase 5 — product and example acceptance

- Add one fixed maintenance schedule and one product-configured schedule to
  Agentic Start.
- Add a visible actor-backed workspace capability and a historical usage or
  evaluation lakehouse journey without exposing provider APIs in product code.
- Make the Builder show canonical plan, provider guarantees, runtime access,
  telemetry, schedule, dataset, and actor evidence.
- Keep GuestBook the readability floor and use Chirp for distributed stream,
  access, object, and lifecycle pressure.
- Prove production bundles omit the development daemon, toolbar, and source
  provenance.

### Phase 6 — release qualification

- Implement every command in `docs/v0.8-acceptance.json` and keep its
  `implemented` flag synchronized with executable evidence.
- Add v0.7→v0.8 migration fixtures, package-consumer checks, secret canaries,
  dependency/container provenance, failure injection, and performance/cost
  history.
- Run local, OrbStack, MiniStack, browser, and clean-consumer gates.
- Run real AWS, CloudWatch, Athena, EventBridge Scheduler, and the qualified
  distributed actor provider before setting either manifest to
  `release-candidate`.
- Produce a final gap analysis and exact-commit attestation for maintainer
  review. Do not tag or publish until separately authorized.

## Current checkpoint

The implementation and all locally executable release-candidate gates are
complete at code commit `63951de9f15614ac187773f5027af37232fe7a9c`.
`bun run check:v08:local-qualification` passed on 2026-08-29 across 62 package
typechecks, four script shards, the three acceptance applications, local and
MiniStack lifecycles, Runtime Integrity, ApplicationPlan, runtime access,
observability, scheduling, lakehouse, actor state/realtime recovery, provider
conformance, migration, security, performance history, 60 packed packages, 109
public entrypoints, generated Agentic Start browser/server builds, the complete
Rust workspace, scorecard, and evidence-verifier self-test.

The Kubernetes runtime-access slice is also live-qualified at that code commit.
A disposable Kind v1.36.1 cluster using Cilium 1.20.1 as its active CNI passed
the exact RBAC and Secret-key allows, sibling Secret/wrong-port/wrong-host
denials, FQDN policy, restart continuity, single-resource policy drift repair,
and reverse-topological TypeKro/Alchemy teardown of all fourteen resources.
Agentic Start's graph-backed browser/lakehouse journey and the operator-backed
Celld fleet lifecycle retain their recorded live evidence. These receipts do
not imply real-AWS or published-image qualification.

Three external boundaries remain:

1. TypeKro PR `#165` at `9abe26f3` is mergeable and green. It resolves the
   ClickStack credential, rotation, typing, generation-readiness, documentation,
   and transformed nested-output findings. After it is merged and released,
   consume the published TypeKro version and rerun the complete authenticated
   OrbStack ClickStack create/ingest/query/destroy receipt.
2. Publish the exact-commit Celld operator candidate through the prepared
   multi-architecture workflow and anonymously verify its immutable
   `linux/amd64` and `linux/arm64` manifest. Publication is not authorized by
   this goal alone.
3. Run the real-AWS CloudWatch, EventBridge Scheduler, Athena/Glue/S3,
   IAM/network/encryption, drift/delete, cleanup, and bounded-cost packet once
   credentials and an acceptance account are available.

The exact aggregate release attestation must bind every remote receipt to one
unchanged candidate commit. Do not set aggregate acceptance flags, tag, publish
npm packages, create a GitHub Release, or claim v0.8 release readiness before
those boundaries close and the maintainer explicitly authorizes publication.
