# Goal: Converge Applik8s deployment on TypeKro and Alchemy v2

**Status:** TypeKro 0.32.0 is pinned, the pre-graph lifecycle engine has been removed, local qualification
is green, and GuestBook, Chirp, and the generated v0.6 application have each passed their live OrbStack
golden paths through the graph-backed Alchemy/TypeKro deployment engine. Operator-host reconciliation is
globally bounded to the declared single-worker contract and immutable WASM components are compiled once
while every invocation receives fresh host state, eliminating the publisher OOM exposed by the GuestBook
restart path. TypeKro 0.32.0 includes PR #126's status-projection fixes. Final qualification is focused on
refreshing exact-worktree evidence across the complete release cohort.

**Prepared:** 2026-07-27

**Baseline commit:** `0a90138` (`feat: complete v0.6 Chirp flagship foundation`)

**Execution target:** the local OrbStack Kubernetes cluster. A second cluster and multi-cluster
qualification remain explicitly deferred.

**Release rule:** do not tag, publish, or cut an Applik8s release until the refactor and live lifecycle
results have been reviewed explicitly.

**Upstream prerequisite:** TypeKro 0.32.0 contains PR #117's semantic planning, Alchemy v2,
artifact-output, singleton, scope, namespace-lifecycle, and structured-default fixes plus PR #126's secure,
unambiguous arbitrary-resource status projection. Applik8s pins it exactly; do not use a caret range until
the experimental planning DTOs have a qualified compatibility policy.

## Execution progress

As of 2026-07-29, the published TypeKro 0.32.0 cohort is pinned exactly and the ordinary deployment path is
graph-backed end to end:

- GuestBook Start passed its current-source live OrbStack lifecycle after rebuilding the Rust host:
  browser command admission, Kubernetes reconciliation, rejection, SSE invalidation, authoritative requery,
  SSR, component restarts, graph-backed CLI deletion, runtime data cleanup, retained-empty generated CRD,
  and Namespace removal all completed. Both operator rollouts remained at zero process restarts under the
  existing one-GiB memory limit after repeated reconciliations;
- the OCI Alchemy provider now treats a missing OrbStack-local Docker tag as live drift. Persisted artifact
  state is no longer sufficient evidence that a `Never`-pull image exists: a positive inspection keeps the
  no-op path, a missing image schedules an ordinary Alchemy update and TypeKro rebuild, and Docker inspection
  failures stop closed. The implementation and its regression coverage remain within the original 450-line
  provider ratchet;
- the generated v0.6 application passed its command/outbox, JetStream, SSE/requery, ClickHouse, restart,
  KRO readiness, and finalizer-safe deletion path;
- Chirp passed its runtime/recovery suite and all nine browser checks. Its production build remains within
  the tracked browser, server, RGD, OCI-context, and generated-artifact budgets;
- OrbStack Namespace deletion is currently slow because the shared Namespace controller is draining a large
  pre-existing backlog. Tests now wait for authoritative 404 and fail closed; no raw Namespace deletion or
  finalizer patch is accepted as a successful cleanup path;

- a fresh `chirp-refactor` deployment planned one 31-node portable graph, materialized 15 TypeKro
  declarations through a 39-resource Alchemy Stack, and completed its changed operations successfully.
  All 21 container artifacts resolved to immutable digests through Harbor; unchanged tags were adopted,
  while changed artifacts rebuilt and published. Pull-secret verification passed before authoritative
  readiness polling;
- an immediate replay produced the same
  `sha256:cadeb2516891ddc7a074ab5a5812bb01a82eff38f2937f97649ed19fb4f79dd3`
  deployment-graph digest and reported **39 resources, 0 changes, 15 TypeKro declarations**. This is the
  required zero-change convergence evidence for the current KRO path;
- the live `ChirpInstallation/chirp-refactor` reached KRO `GraphResolved=True`, `ResourcesReady=True`, and
  `Ready=True` for the generated graph and projected
  `status.observedVersion=0.7.0-dev` plus
  `status.artifactDigest=sha256:3a4e1bf58898cf2ac0995ee0a0a9a9529f7c68cc51def179766fcb8feae88476`.
  Published TypeKro 0.31 drops those two pure `ConfigMap.data` projections when reconstructing the
  composition; PR #126 fixes both the legacy classifier and semantic planner and is therefore a real release
  dependency rather than an Applik8s workaround;
- every starter-profile stateful claim—CNPG, JetStream, Hatchet CNPG, ClickHouse, and Valkey—bound to
  `csi-hostpath-sc`, proving storage intent now reaches each provider rather than falling back to an
  unsuitable class;
- the preceding ordinary Alchemy/TypeKro destroy removed all 39 graph resources without bypassing KRO or
  editing finalizers. Kubernetes took about five additional minutes to drain two protected PVCs after
  Alchemy printed success. This is an upstream completion-reporting gap: generic direct declarations must
  not be reported deleted until an owned Namespace reaches a real 404;
- the earlier shared-node pod ceiling was relieved without weakening the application topology. The compiler
  still co-locates compatible query gateways and reactive handlers while preserving individual Services,
  health ports, handler identity, conditions, and artifact digests; the current Chirp and GuestBook live
  paths schedule and recover successfully on OrbStack.

- `@applik8s/deployment-contract` defines strict portable graph codecs, validation, normalization, and
  deterministic digests without TypeKro, Alchemy, Kubernetes, or credential dependencies.
- `@applik8s/deployment-compiler` lowers the concrete profile into explicit artifact, generated-credential,
  namespace, direct-provider, external-provider, and root-composition nodes. The Chirp starter graph
  currently contains 31 nodes, 21 immutable artifacts, 79 causal edges, and no fallback resource type.
- `@applik8s/deployment-typekro` reconstructs the compiler-final Kubernetes graph as one TypeKro composition,
  consumes image and Secret-reference outputs through `artifactOutput(...)`, preserves canonical per-factory
  direct declarations, and leaves cross-composition ordering to the outer graph instead of corrupting
  TypeKro execution records. Its serialized KRO/CEL expression reconstruction is now a focused 296-line
  module with a separate ratchet, reducing the resource/composition assembler from 955 to 668 lines.
- `@applik8s/deployment-alchemy` owns collision-safe Stack identity, strategy claims, atomic state, leases,
  plan/apply/destroy, and TypeKro declaration materialization. It refuses an in-place direct/KRO strategy
  switch for the same installation identity. Its central coordinator is now 475 lines rather than a
  982-line provider switchboard: OCI artifacts, generated Secrets, Harbor projects, graph coverage, and
  TypeKro group ordering each live behind focused internal adapters with individual size ratchets.
- OCI building/publication, Harbor project/robot lifecycle, and Kubernetes-generated Secrets are isolated in
  `@applik8s/deployment-provider-oci`, `@applik8s/deployment-provider-harbor`, and
  `@applik8s/deployment-provider-kubernetes`. The generic backend composes these layers but does not own their
  SDK clients. Harbor and OCI reuse TypeKro 0.31's reviewed clients and container machinery.
- all compiler-declared images, including the framework Rust operator host and its derived operator images,
  are Alchemy artifact resources. Builds are dependency-aware, publish by immutable digest, distinguish
  publisher-visible from node-visible registry references, and share a bounded serial default.
  The lower default is deliberate: TypeKro opens an isolated BuildKit trust/auth session for each remote
  build, and a four-build live run saturated the local Harbor database and control plane before correctly
  surfacing registry 401/502 failures. A two-build resume then proved the Harbor registry's Rook OSD was
  repeatedly OOM-killed at its fixed 2Gi limit. Provider-level tests retain an explicit concurrency seam
  for installations with measured capacity.
- Valkey, PostgreSQL, OBC/object storage, Hatchet bootstrap credentials, application cursor credentials,
  namespaces, and the Harbor project are now graph resources rather than ordinary deploy preparation
  receipts. Generated credential bytes are produced only in the operation host; inspected live state contains
  only generation contracts, public Secret references, and key names.
- ordinary `applik8s deploy` previews and applies through Alchemy/TypeKro; `--plan-only` performs a complete
  preview and `--strategy kro|direct` selects the root factory. `applik8s delete` destroys the same Stack and
  fails closed when its scoped deployment graph is absent.
- the steady-state CLI is now a 305-line router published from the dedicated `@applik8s/cli` package.
  Graph deployment, Alchemy materialization, artifact selection, read-only Kubernetes observation, registry
  discovery, process-isolation runners, and the executable have all moved out of `@applik8s/applik8s`.
  There is no compatibility executor, migration command, receipt reader, or second CLI entrypoint.
- deploy and delete share one Node lifecycle runner; the duplicate delete runner has been removed. Normal
  registry discovery uses the Kubernetes SDK rather than shelling out to `kubectl`, and normal deploy contains
  no provider preparation engine, provider factory dispatch, generated-shell execution, or direct factory call.
- normal deployment writes no preparation receipts, and the obsolete receipt/adoption implementations and
  flags have been deleted because no released installation depends on them.
- `@applik8s/applik8s` no longer owns a binary and no longer depends directly on Commander, the compiler,
  Alchemy, the deployment contract, the OCI deployment provider, or the TypeKro deployment adapter. Package
  ratchets prevent those dependencies and CLI source files from returning to the authoring package.
- S3, Hatchet, NATS/JetStream, Kubernetes, and PostgreSQL wire-client implementations now live in
  `@applik8s/runtime-s3`, `@applik8s/runtime-hatchet`, `@applik8s/runtime-nats`, and
  `@applik8s/runtime-kubernetes`, and `@applik8s/runtime-postgres`.
  Generated workloads import those focused adapters explicitly; the authoring facade no longer installs either
  AWS SDK, the Hatchet SDK, either NATS client family, the Kubernetes SDK, or the PostgreSQL wire client,
  while provider-neutral object, workflow, event-log, installation, and SQL lifecycle contracts remain on
  the main API. NATS exposes separate `event-log` and `command-processor`
  entrypoints so an HTTP gateway does not retain the command-consumer client. Gateways and task operations now
  receive an event-log publisher implementation explicitly instead of constructing JetStream behind a
  provider-neutral facade. The Bun-safe Kubernetes generated-client helper is now owned by the CLI, while
  `installation.connect(...)` loads its default Kubernetes transport only when requested. PostgreSQL-backed
  commands, model stores, streams, projections, gateways, and outboxes lazily load the focused adapter; the
  Drizzle schema/model semantics remain with authoring, but connection creation and driver lifecycle do not.
- packed-consumer qualification now covers 27 packages and 43 public entrypoints; the executable is installed
  from `@applik8s/cli`, and clean-directory compilation plus the v0.4/v0.5/v0.6 consumer graphs pass.
- a real temporary PostgreSQL server qualified the adapter boundary with 24 live tests covering relational
  authority/RLS, CRUD and indexed queries, transactions, command/outbox atomicity and replay, concurrency,
  rollback, deadlock retry, retention, and fail-closed schema drift.
- focused graph, adapter, backend, state, OCI-provider, and CLI tests are green. The same real Chirp graph
  plans in direct mode, while the strategy claim prevents that plan from being applied over an existing KRO
  installation accidentally.

Earlier live OrbStack work published every Chirp image successfully, including both derived operator images,
and proved creation of the Harbor project, expandable 20Gi CNPG database, and the first artifact level. That
run then exposed insufficient Ceph daemon sizing under concurrent registry builds. TypeKro 0.32.0 exposes
the required Rook/Ceph resource overrides and fixes the object-valued `Cel.default()` output that was rejected by live
KRO because the schema-object branch and literal-map branch had incompatible CEL types. The local TypeKro
repair widens both structured branches to `dyn` while preserving direct-mode JavaScript semantics; the
repaired RGD was admitted live and the existing owner instance was reconciled without patching a
TypeKro-owned HelmRelease out of band. The Alchemy transaction can now be resumed from published packages.
The older retained CNPG cluster is not a supported migration target: its `local-path` PVC cannot expand from
1Gi to the new 20Gi desired size. Qualification should use a fresh graph identity; deleting that old fixture
still requires explicit approval because it removes its PVC and sample data.

The remaining steady-state cleanup and qualification work is:

- no pre-graph lifecycle compatibility code remains. CI now enforces physical absence of the executor,
  provider-adoption migration, preparation receipts, preparation engines, migration flags, and RGD
  force-conflict handoff;
- `@applik8s/applik8s` still contains the provider-neutral PostgreSQL/native-model execution semantics because
  they cross model methods, command execution, gateways, streams, projections, and relational transactions.
  The wire client and connection lifecycle have been extracted and are absent from authoring-only installs.
  Any further split should move this semantic runtime as one coherent internal API rather than scattering
  model behavior across provider packages; Drizzle authoring types intentionally remain on the main model API;
- `node-build-runner.mjs` is now a 106-line compiler-only process-isolation adapter. Its duplicate esbuild
  bundle, temporary runner source, workspace alias table, and container/artifact behavior are gone. Workspace
  source resolution is centralized in the shared TypeScript loader from package export maps, while installed
  packages load their published JavaScript. A 120-line ratchet prevents it from becoming a second build or
  deployment engine again;
- full direct-mode apply/update/delete evidence requires a distinct installation identity and namespace;
- the current GuestBook, generated-application, and Chirp golden paths are functionally green. Exact-source
  release receipts must be refreshed together after the final code change, along with PostgreSQL and
  ClickHouse datastore receipts, so the scorecard can reject stale working-tree evidence honestly;
- workload co-location is complete for the current surface: compatible relational gateways share a pod with
  unique ports and per-gateway Services; RBAC gateways remain dedicated; background projection and stream
  workers share bounded eight-container envelopes with unique health ports. Dedicated profiles may retain
  isolation. Further footprint work should be driven by measured scheduling, memory, cold-start, and
  contention evidence rather than another unbounded consolidation heuristic;
- TypeKro 0.32.0 contains PR #126. Its reviewed suite covered semantic and imperative alias-collision parity,
  secret-taint rejection, canonical expressions, nested identities, client hydration, and live OrbStack
  status projection/cleanup; Applik8s now qualifies only against that published cohort;
- TypeKro's Alchemy generic-resource deletion must wait for owned Namespace disappearance before returning
  success. Applik8s must consume that corrected contract rather than adding a second namespace finalizer
  engine;
- TypeKro still emits noisy but non-fatal namespace diagnostics while constructing some analysis graphs.
  Its dependency scanner also interprets literal Kubernetes `.svc` hostnames as unknown resource ids.
  These should be tracked upstream rather than patched around in Applik8s.

The first isolated TypeKro 0.31/Alchemy qualification pass added concrete evidence and narrowed the live
blockers:

- a fresh `chirp-refactor` plan compiled the real TanStack application, assembled one 31-node deployment
  graph with 21 immutable artifacts, decoded 15 TypeKro declarations, and previewed a 39-resource Alchemy
  Stack without effects;
- the starter profile now selects `csi-hostpath-sc` for its Valkey index, while the dedicated profile keeps
  `ceph-block`. An orphaned, unbound legacy claim was adopted and removed through a temporary TypeKro
  composition and `deleteInstance()`—not through an out-of-band Kubernetes delete. The resumed graph then
  created a healthy Valkey pod and bound 8Gi claim on `csi-hostpath-sc`;
- application host and generated gateway resolution initially exposed undeclared runtime adapter imports.
  Chirp and GuestBook now declare every focused generated-runtime dependency directly, and both official
  Vite production builds pass;
- TypeKro singleton-owner RGD/instance operations and hoisted namespace prerequisites are now translated to
  retained Alchemy resources. A vertical regression proves an application-owned root RGD/instance remains
  deletable while the shared singleton closure is retained;
- outer deployment-graph prerequisites are now additive to TypeKro's native declaration dependencies.
  Previously, declarations that already had a TypeKro `dependsOn` silently skipped the group-level Alchemy
  ordering input, allowing an application RGD/instance branch to start before its prerequisite singleton
  group. A regression covers the mixed native-plus-outer dependency case;
- the resumed Alchemy apply reached real image publication. The operator-host image built successfully, but
  Harbor returned repeated HTTP 500 responses while accepting blobs. Harbor's API and pods are reachable;
  its backing Rook OSD and RGW are crash-looping, so the transaction was interrupted before repeating the
  same storage failure for every artifact. The Alchemy Stack remains resumable;
- root-cause evidence showed the single OSD was cgroup OOM-killed at its original 2Gi limit (exit 137) while
  the node had no memory or disk pressure. The only OSD being down made 73 placement groups inactive and 88
  stale; RGW then failed startup, explaining why Harbor's control-plane ping remained healthy while registry
  blob operations returned HTTP 500. This was original under-sizing exposed by sustained registry load, not
  a later rollout: the OSD and RGW each had only one ReplicaSet revision from initial installation;
- the exact existing KRO instance was reconciled through TypeKro with OSD request/limit 2Gi/4Gi and RGW
  request/limit 512Mi/2Gi. No Namespace, PVC, CephCluster, HelmRelease, or object-store resource was deleted
  or patched directly. KRO accepted graph revision 3, the instance advanced to generation 2, both daemons
  rolled to zero-restart ready pods, inactive/stale placement groups cleared, and an authenticated Harbor
  blob upload, HEAD, and download round-trip passed;
- the repair also exposed a release-gate gap: TypeKro's serialization tests asserted expression text but did
  not submit the generated RGD to live KRO. A focused TypeKro core fix and regression now widen
  object-literal default branches to CEL `dyn`; its focused tests, complete typecheck/build, live RGD
  admission, and real Rook reconciliation pass. Published-package qualification must use a release
  containing that fix rather than relying on the local TypeKro build;
- Rook 1.20 separates CSI deployment into the `ceph-csi-drivers` chart. The complete TypeKro Rook platform
  currently installs the operator and cluster charts but not that CSI chart, and the live cluster contains
  neither CSI `OperatorConfig`/driver CRs nor driver workloads. A complete platform composition must install
  and qualify the CSI drivers before `ceph-block` can be treated as a usable default;
- TypeKro direct deployments created before the current planning/discovery contracts may lack the labels
  needed by a fresh process to discover and delete them. The Valkey CR could only be recovered by first
  applying the exact current composition to establish its identity. Cross-process adoption/discovery must be
  regression-tested for direct resources and documented as a migration boundary;
- future Harbor readiness must include an authenticated registry blob write/read canary and Ceph readiness
  must reject OSD-down or inactive/stale-PG states. The existing CR-level `Ready` projections remained true
  during the outage and are not authoritative enough for an artifact publication gate;
- the single-node profile remains a development topology with no data redundancy. Its capacity must be
  explicit and publication concurrency bounded; a production Harbor substrate requires multiple failure
  domains rather than merely larger limits.

No release, tag, commit, or push has been created by this execution pass.

The repository-local qualification lane is green at this worktree state. It was rerun after the Alchemy
ordering/lifecycle fixes and backend split:

- every gate composing `bun run check:v06:local` passed: TypeScript, lint/audit, module-boundary,
  deployment-maintainability, implemented-test, v0.6 contract, character, publish-dry-run, packed-consumer,
  scorecard, performance, GuestBook build, Chirp build, and Rust. The initial aggregate process reached the
  final Rust command before exposing a broken local Homebrew Cargo linkage; after repairing the installed
  toolchain, the Rust gate passed independently. The implemented tests passed across all 16 shards; the
  focused v0.6 contract lane passed 235 tests; 31 active character tests passed; and the clean consumer
  imported 33 public entrypoints from 21 packed packages.
- the full Chirp artifact build passed with 272 graph nodes, 400 generated TypeKro artifacts, two prerequisite
  instances, and enforced browser, server, RGD, and OCI-context budgets.
- `bun run check:rust` passed Rust formatting, Clippy with warnings denied, 9 operator-host unit tests,
  98 host contracts, 12 runtime-bridge unit tests, 26 bridge contracts, 6 generated-contract tests, and all
  doc tests. Four localhost HTTP contracts require an execution environment that permits ephemeral loopback
  listeners.
- `git diff --check` passed.

The rerun produced one environmental socket denial and one timing-only worker stall before going green:
the sandboxed Valkey redirect contract could not bind loopback, then passed under the unrestricted local
lane; two Vite discovery tests stalled once in a long-running worker, passed together in 11.7 seconds in
isolation, and passed again at normal speed in the clean 16-shard aggregate. The final evidence is 16/16
implemented-test shards, 235/235 v0.6 contract tests, 31 active character tests, 27 packed packages and 43
Node-imported public entrypoints, both production example builds, the Chirp graph/bundle budgets, Rust
formatting and Clippy, 9 operator-host unit tests, 98 host contracts, 12 bridge unit tests, 26 real bridge
contracts, 6 generated contracts, and all doc tests. The scorecard remains intentionally non-green until
every exact-worktree live receipt is refreshed together.

The scorecard correctly rejects receipts from an earlier dirty-worktree digest. The shared Ceph platform is
healthy, Harbor's authenticated data path is proven, the isolated Alchemy transaction converges to a
zero-change plan, and the GuestBook, generated-application, and Chirp runtime/browser paths are functionally
green. TypeKro 0.32.0 is now pinned; refresh the exact-worktree datastore and application receipts together
and complete the separate-identity direct lifecycle matrix.

## Objective

Replace Applik8s's accumulated imperative deployment orchestration with one explicit deployment
architecture:

```text
Applik8s authoring API
  -> canonical ApplicationGraph
  -> deterministic ApplicationDeploymentGraph
  -> provider lowering and artifact preparation
  -> one dynamically assembled TypeKro kubernetesComposition
  -> Alchemy v2 deployment stack
       -> TypeKro direct or KRO resources
       -> non-Kubernetes provider resources
  -> authoritative Kubernetes/Application status
```

The public developer experience remains provider-neutral and graph-first. Application authors declare
models, operations, handlers, queries, streams, projections, workflows, hosting, exposure, and providers.
They do not manually sequence infrastructure, invoke Alchemy, construct TypeKro factories, manage lifecycle
receipts, or copy resolved provider outputs into workload configuration.

The compiler must lower the canonical semantic graph into a deployment graph with stable identities,
explicit dependency edges, ownership, retention, readiness, outputs, secret references, and deployment
phases. TypeKro must own Kubernetes composition and lifecycle semantics. Alchemy v2 must own deployment
state, idempotent reconciliation, cross-provider dependency ordering, and reverse-topological teardown.

The goal is not merely to introduce another abstraction. It is to delete the bespoke orchestration paths
that the new deployment graph supersedes and make Chirp's complex installation materially simpler to build,
understand, update, and delete.

## Why this refactor exists

The v0.6/Chirp baseline is functionally strong, but deployment responsibility is fragmented:

- `ApplicationGraph` correctly represents domain and runtime semantics;
- compiler modules independently emit TypeKro resources and preparation metadata;
- the CLI manually discovers provider types and sequences namespaces, PostgreSQL, Valkey, object storage,
  Harbor, container publication, installation resources, and cleanup;
- scoped JSON receipts partially recreate deployment state and ownership tracking;
- TypeKro direct and KRO factories are invoked imperatively in many branches;
- TypeKro's released Alchemy v2 integration is re-exported but not used by Applik8s;
- dependency, retention, and deletion policy are therefore split among semantic nodes, compiler output,
  CLI conditionals, TypeKro factories, local receipts, and Kubernetes state.

The result works, but it is difficult to audit and makes adding a provider or changing lifecycle semantics
more expensive than it should be. This refactor must produce one explainable source of deployment truth.

## Upstream seams now available

TypeKro PR #117 supplies the upstream seams this refactor was waiting for. Applik8s should consume these
seams directly instead of recreating them:

| TypeKro/Alchemy seam                                                                             | Applik8s use                                                                                                        | Bespoke behavior it replaces                                                            |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `factory.toAlchemyResources()`                                                                   | Convert one direct or KRO factory into deterministic per-resource Alchemy declarations                              | CLI-owned factory sequencing and hand-built deployment records                          |
| `materializeAlchemyResources(...)`                                                               | Materialize declarations inside an Alchemy Stack and wire dependency Outputs                                        | Manual provider/resource ordering and readiness handoffs                                |
| `KroResource` and `kroProvider`                                                                  | Reconcile TypeKro resources through the supported Alchemy v2 provider                                               | Direct `factory.deploy()`/`deleteInstance()` branches in the ordinary CLI path          |
| `artifactOutput(...)` and artifact requirements                                                  | Bind built/published image digests and non-Kubernetes outputs into TypeKro resources                                | Rewriting generated JSON, YAML, TypeScript, and shell artifacts after image publication |
| `typekro/containers` OCI build, publish, credential, digest, timeout, and cancellation machinery | Implement the Alchemy container-artifact provider using the reviewed TypeKro primitives where their contracts match | Duplicate Docker/Harbor transport, credential-session, and digest-verification code     |
| canonical desired-state/artifact plans                                                           | Inspect, compare, encode, and execute TypeKro's portion of the plan through a version-pinned adapter                | YAML reparsing, inferred runtime dependency reconstruction, and ad-hoc drift evidence   |
| singleton owners and fingerprint drift rejection                                                 | Own shared chart repositories, operators, and platform prerequisites once                                           | Receipt-based shared-resource ownership guesses                                         |
| resource scopes and cross-process discovery                                                      | Represent retained/shared lifecycle and recover deployment inventory from Kubernetes labels/annotations             | Local receipt files as the authority for deletion inventory                             |
| unconditional KRO Namespace hoisting and empty-gated teardown                                    | Keep workload namespaces outside unsafe RGD ownership and delete them last only when owned and empty                | Direct namespace preparation/deletion and finalizer workarounds                         |
| dependency-aware direct fan-out                                                                  | Preserve TypeKro references and readiness dependencies as Alchemy edges in direct mode                              | Timing assumptions and provider-specific wait loops                                     |
| KRO RGD/instance/singleton ordering                                                              | Apply and destroy KRO definitions, owners, and instances in the safe order                                          | Generated `apply.sh` as the production deployment state machine                         |
| sensitive bindings and credential-safe kubeconfig state                                          | Resolve named host bindings only at reconciliation time                                                             | Persisted credentials, copied kubeconfig material, and secret-bearing receipts          |
| TypeKro readiness/status materialization                                                         | Report resource truth from Kubernetes and KRO                                                                       | Alchemy success or receipt existence being mistaken for application readiness           |

These APIs are implementation seams, not the Applik8s public model. TypeKro's semantic planning DTOs are
explicitly experimental. Applik8s must:

- keep its own stable, provider-neutral `ApplicationDeploymentGraph`;
- isolate TypeKro planning DTOs behind one version-pinned adapter;
- never expose TypeKro plans, Alchemy Resources, or Alchemy Outputs in application authoring APIs;
- translate at the adapter boundary and fail closed when the pinned TypeKro capability set changes;
- retain generated YAML as inspection/GitOps output, not as the in-process deployment IR.

TypeKro does **not** provide the Alchemy runtime, Stack identity allocation, state backend, application
provider selection, external-provider resources, release migration, or Application status UX. Those remain
Applik8s responsibilities.

## Deployment execution contexts

Not every resource creation belongs in an Alchemy Stack. The implementation must distinguish these four
contexts and reject accidental crossover:

| Context                          | Authority                                       | Examples                                                                                                    | Rule                                                                                                                           |
| -------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Release/install transaction      | Applik8s deployment graph -> Alchemy -> TypeKro | image builds, Harbor publication, shared operators, RGD installation, one explicitly deployed root instance | Alchemy owns durable effect ordering and state                                                                                 |
| Runtime Kubernetes desired state | Kubernetes API -> KRO/TypeKro controller        | a Tenant/Application instance created by an operator, dynamically requested single-tenant instances         | the CR is durable intent; do not create a hidden local Alchemy Stack per runtime CR                                            |
| External control plane           | a provider's controller or Alchemy provider     | DNS SaaS records, cloud buckets, remote registries, hosted identity systems                                 | use an Alchemy resource for release-time effects or a real controller for runtime effects; never fake it as a Kubernetes child |
| Compatibility migration          | bounded Applik8s migration command              | receipt import, KRO-owned provider detachment, pre-hoist ownership repair                                   | isolated, resumable, explicitly invoked, and never part of steady-state deploy                                                 |

Alchemy installs the reusable RGD/control plane and may create an explicitly selected initial instance.
Afterward, runtime-created instances are reconciled from Kubernetes desired state. If a dynamically created
instance requires an external side effect, that effect requires a durable controller reachable from the
cluster; the local CLI's Alchemy state cannot be its hidden authority.

## Baseline that must remain green

The pre-refactor checkpoint is commit `0a90138`. It passed `bun run check:v06:local`, including:

- TypeScript typecheck, lint policy, static-import/typecast/test-taxonomy checks, and module boundaries;
- the complete implemented-test shard set;
- 235 focused v0.6 contract tests and the character suite;
- coordinated dry-pack and clean packed-consumer checks for 14 packages and 25 public entrypoints;
- the v0.6 scorecard at 10/10 evidence coverage;
- performance, generated-runtime, RGD, OCI-context, GuestBook, and Chirp build budgets;
- the official GuestBook and Chirp TanStack Start production builds;
- Rust formatting, clippy, 98 operator-host tests, 12 runtime-bridge unit tests, 26 bridge contracts,
  generated-contract tests, and real ComponentizeJS/WIT/Wasmtime regressions.

Fresh OrbStack evidence already proves the Chirp browser-to-command-to-PostgreSQL/outbox-to-JetStream-to-
projection-to-SSE-to-requery path, immutable Harbor images, provider readiness, recovery scenarios, and
idempotent redeployment. The refactor must preserve or strengthen those results.

## Architectural boundaries

### 1. `ApplicationGraph` remains the semantic source of truth

`ApplicationGraph` is the portable, serializable representation of what an application means. It contains
models, commands, lifecycle events, handlers, queries, streams, projections, workflows, gateways, hosting,
exposure, provider requirements, permissions, compatibility, and compiler artifact references.

It must remain:

- deterministic JSON with a versioned compatibility contract;
- inspectable without credentials, an Alchemy state store, or a Kubernetes cluster;
- consumable by compiler, browser, server, WASM/operator, documentation, and policy tooling;
- free of Alchemy Resource objects, Outputs, provider clients, live credentials, and deployment state;
- the authority for semantic dependency and capability requirements, but not a second deployment engine.

### 2. `ApplicationDeploymentGraph` is a compiled deployment IR

Introduce a versioned, normalized deployment graph generated from `ApplicationGraph` plus the selected
installation profile and compiled artifacts. It must contain only deployment concerns:

- stable logical resource identity and installation scope;
- resource kind: TypeKro composition/resource, artifact build/publication, external-provider resource,
  secret projection, or explicit retained/external reference;
- typed inputs and typed output references;
- explicit `dependsOn` edges with cycle diagnostics;
- create/update/readiness/delete contracts;
- ownership, sharing, adoption, retain/orphan, and destructive-cleanup policy;
- deployment phase only where a real bootstrap boundary exists;
- sensitive-input classification and state-persistence policy;
- direct/KRO eligibility and selected deployment strategy;
- source links back to semantic graph nodes and generated artifacts;
- a deterministic digest suitable for evidence, drift detection, and status.

The deployment graph is data, not an executable closure graph. It must serialize without secrets and pass
strict structural and semantic validation before any side effect.

### 3. One generated TypeKro composition owns the Kubernetes application graph

For one concrete installation, dynamically assemble a single TypeKro `kubernetesComposition` at compile or
deployment-plan construction time. Dynamic assembly must never occur during reconciliation.

The composition must include or explicitly reference:

- namespaces and service accounts;
- generated application workloads and Services;
- migrations, processors, gateways, projection workers, stream workers, workflow workers, and operators;
- PostgreSQL, JetStream, Valkey, ClickHouse, Hatchet, object-storage, registry, identity, authorization,
  certificate, DNS, and exposure resources selected by the profile;
- pull Secrets and other credential projections by reference, never raw values;
- shared/singleton prerequisites as explicit TypeKro external or singleton-owned resources;
- readiness and status hydration for every required dependency;
- include conditions, values, and provider output references derived from the installation spec.

Do not flatten genuinely external side effects into fake Kubernetes resources. The single composition is the
Kubernetes deployment unit; Alchemy remains the outer deployment transaction that can also contain external
provider and artifact resources.

### 4. Alchemy v2 is an internal deployment backend

Applik8s must lower the deployment graph into an Alchemy v2 Stack without exposing Alchemy in the ordinary
authoring API. Use TypeKro's released v2 integration, including `factory.toAlchemyResources()`,
`materializeAlchemyResources(...)`, `KroResource`, and `kroProvider`, instead of imperatively reproducing
their behavior.

Alchemy must provide:

- stable state identity scoped by application, control-plane namespace, instance, profile, and connection;
- idempotent create/update reconciliation;
- dependency and output ordering across artifact, external-provider, and TypeKro resources;
- reverse-topological destruction;
- retained/shared resource behavior represented explicitly rather than inferred from filenames;
- useful previews/plans and structured failure attribution;
- resumable deployment after a partial failure;
- migration/version metadata for state compatibility.

Alchemy state is not application status and is not a credential store. Persist secret references and
non-sensitive metadata only. Never serialize kubeconfig contents, bearer tokens, robot passwords, database
passwords, S3 credentials, generated private keys, or resolved Secret values.

### 5. Kubernetes remains authoritative for runtime readiness

Alchemy records deployment transaction state. TypeKro and Kubernetes remain authoritative for actual
resource readiness and deletion. The generated Application/KRO status remains the user-visible status
contract. Local receipt existence, Alchemy success, manifest acceptance, or process completion must never be
reported as provider readiness by themselves.

## Responsibility matrix

Every concern must have one steady-state authority. An adapter may translate a contract, but it may not
become a second authority.

| Concern                      | Authority                                                            | Applik8s responsibility                                                                                                       | Must disappear from steady state                                                |
| ---------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Application semantics        | `ApplicationGraph`                                                   | authoring capture, compatibility, provider requirements, source mapping                                                       | deployment/runtime objects inside the semantic graph                            |
| Concrete installation plan   | `ApplicationDeploymentGraph`                                         | identity, selected profile, node/edge validation, source links, deterministic digest                                          | provider-specific CLI conditionals                                              |
| Installation/Stack identity  | Applik8s deployment backend                                          | derive a collision-resistant key from connection, application, control-plane namespace, instance, and profile; reject aliases | filenames or current working directory as identity                              |
| Kubernetes composition       | TypeKro                                                              | lower validated contributions into one composition/factory                                                                    | manual manifest-array dependency reconstruction                                 |
| Kubernetes resource identity | TypeKro artifact/declaration identity                                | preserve stable logical source IDs through the adapter                                                                        | independently invented receipt IDs                                              |
| Kubernetes dependency order  | TypeKro references/`dependsOn` -> Alchemy Outputs                    | validate semantic edges and translate once                                                                                    | sleeps, phases without causal edges, array-order dependencies                   |
| Cross-provider output order  | Alchemy                                                              | declare typed resource Outputs and dependencies                                                                               | copying outputs into generated files after deploy                               |
| Artifact build/publication   | Alchemy artifact resources                                           | provide build recipes, registry policy, immutable-output validation                                                           | CLI build loops and `image-receipts.json` as state                              |
| External provider effects    | provider-specific Alchemy Resource or real controller                | provider-neutral requirement and lowerer registration                                                                         | fake Kubernetes resources and central CLI switch statements                     |
| Shared prerequisites         | TypeKro singleton owner                                              | choose implementation and stable singleton identity/spec                                                                      | receipt-based “already installed” ownership                                     |
| Retained lifecycle           | TypeKro scopes plus Alchemy retain policy                            | declare retention and validate cross-node consequences                                                                        | delete-time namespace preservation guesses                                      |
| Namespace lifecycle          | TypeKro hoisting/adoption/empty-gated teardown                       | declare desired namespace and external/owned policy                                                                           | `ensureDirectNamespace()` and `deleteDirectNamespace()`                         |
| Apply/update/idempotency     | Alchemy state plus TypeKro reconcile                                 | select operation and render progress                                                                                          | handwritten retry/idempotency state machines                                    |
| Destruction order            | Alchemy reverse dependency graph plus TypeKro deletion               | request destroy and await authoritative completion                                                                            | provider cleanup ordering in `runDelete()`                                      |
| Kubernetes readiness         | TypeKro/Kubernetes                                                   | define provider-neutral readiness requirements and project them                                                               | duplicate resource-specific readiness polling in the CLI                        |
| Application status           | root TypeKro/KRO status hydrated from Kubernetes                     | define and publish the status schema and source mapping                                                                       | lifecycle writers racing domain status or Alchemy state presented as readiness  |
| Secrets                      | Kubernetes Secret references, Effect `Redacted`, named host bindings | classify sensitivity and ensure references reach consumers                                                                    | raw values in graph, Alchemy state, receipts, logs, generated source, or status |
| Kubeconfig                   | TypeKro credential-safe Alchemy configuration                        | bind explicit connection identity and supported credential source                                                             | serialized static tokens/certs or ambient-context guessing                      |
| Preview/explain              | `ApplicationDeploymentGraph` plus Alchemy preview                    | merge semantic and effect diagnostics for the user                                                                            | preview assembled from shell commands or live mutation                          |
| Runtime-created instances    | Kubernetes CR and KRO controller                                     | expose typed create/update/delete semantics and status                                                                        | per-instance local Alchemy state hidden behind an operator                      |

## Target package and dependency topology

The refactor should reduce dependency reachability as well as line count. Use the following logical
boundaries; they may begin as internal workspace modules, but their import rules are mandatory:

```text
@applik8s/core
  ApplicationGraph and portable semantic contracts

@applik8s/deployment-contract
  ApplicationDeploymentGraph, codecs, digests, diagnostics
  no TypeKro, Alchemy, Kubernetes SDK, Node, provider SDK, or credentials

@applik8s/deployment-compiler
  ApplicationGraph + installation profile + compiled artifacts
    -> ApplicationDeploymentGraph
  pure aside from reading already-produced compiler artifacts at its outer boundary

@applik8s/deployment-typekro
  version-pinned adapter
  deployment graph -> one TypeKro composition/factory/declarations

@applik8s/deployment-alchemy
  Alchemy runtime, Stack identity, provider layers, state, apply/destroy/refresh
  consumes TypeKro declarations and external/artifact resource contributions

@applik8s/cli
  command parsing, compilation invocation, progress rendering
  dynamically loads the deployment backend only for plan/apply/destroy

@applik8s/runtime-postgres
@applik8s/runtime-nats
@applik8s/runtime-s3
@applik8s/runtime-hatchet
@applik8s/runtime-clickhouse
  focused optional runtime clients/adapters; generated workloads install only what they use
```

Package decisions:

- Make `@applik8s/applik8s` a lightweight authoring facade. It currently installs the compiler,
  TypeKro adapter, TypeKro, Kubernetes SDK, AWS S3 SDK, Hatchet SDK, two NATS client families,
  PostgreSQL client, Commander, esbuild, and YAML even when an author uses none of those runtime or
  deployment paths. Remove those dependencies from the main package's install graph.
- Move the `applik8s` executable to `@applik8s/cli`; examples and applications take it as a development
  dependency. Do not make the lightweight authoring package depend back on the CLI.
- Move provider runtime implementations into focused packages (or equivalently isolated optional
  workspace packages with public subpath exports during migration). Generated workloads declare only the
  adapter packages selected by their graph.
- Keep `@applik8s/typekro-adapter` focused on authoring-time TypeKro resource/listener bridges. Do not turn
  it into the stateful deployment backend.
- Move the CLI and deployment-only modules out of the ordinary authoring/runtime import path. Importing
  `@applik8s/applik8s`, handler-safe SDK entrypoints, browser facades, React, or server runtime contracts
  must not initialize Alchemy, TypeKro deployment providers, Commander, the Kubernetes SDK, AWS build
  clients, or filesystem/process modules.
- The broad `@applik8s/applik8s/factories/alchemy` re-export has been removed. Advanced deployment code uses
  the focused `@applik8s/deployment-alchemy` contract; ordinary authoring cannot accidentally couple itself
  to Alchemy resources or state.
- Make Alchemy, TypeKro, Kubernetes, registry, and provider SDK dependencies direct only in the package that
  imports them. Do not rely on accidental umbrella or workspace hoisting.
- Keep provider runtime clients such as PostgreSQL, NATS, Hatchet, and S3 in focused runtime entrypoints.
  Deployment lowerers depend on provider contracts/factories, not on application request-path clients.
- Add import-boundary and packed-consumer tests proving that browser, WASM handler, server-facade, authoring,
  and runtime packages do not gain deployment-only transitive initialization.

Package-footprint gates:

- installing the authoring facade does not install Alchemy, Commander, esbuild, TypeKro deployment
  adapters, Kubernetes deployment clients, AWS, Hatchet, NATS, PostgreSQL, or YAML;
- installing a browser/client package does not install server, compiler, runtime-provider, TypeKro, or
  deployment packages;
- each generated workload package/image contains only its selected runtime adapters;
- CLI/deployment dependencies are loaded only by `plan`, `deploy`, `status`, or `delete`;
- packed dependency-tree and cold-import-size snapshots enforce these rules in CI.

## Current footprint and required disposition

The current baseline has roughly 3,942 lines in `packages/applik8s/src/cli.ts`, including 14 direct/KRO
factory constructions, 9 imperative deploy calls, and 11 deletion calls. This is the primary deletion
target, not the foundation for another orchestration layer.

| Current path                                                        | Current responsibility                                                                      | Target disposition                                                                                                                                           |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/applik8s/src/cli.ts`                                      | historical build, provider discovery, image publication, apply, readiness, delete, receipts | removed; the dedicated CLI is a thin graph-backed command/progress shell                                                                                     |
| `runDeploy()` / `runDelete()`                                       | handwritten deployment and reverse cleanup state machines                                   | replace with `planInstallation()`, `applyInstallation()`, `destroyInstallation()`, and `observeInstallation()`                                               |
| generated `apply.sh`                                                | production apply sequencing                                                                 | retain only as optional GitOps/debug output; never use it as the ordinary Alchemy-backed deploy path                                                         |
| `node-delete-runner.mjs`                                            | duplicate Node handoff for manual TypeKro deletion                                          | removed; deploy and delete now share the graph-backed Node lifecycle runner                                                                                  |
| `node-build-runner.mjs`                                             | compiler-only Node isolation handoff                                                        | retained as a 106-line compiler adapter using the shared TypeScript loader; OCI/container effects remain exclusively in Alchemy artifact providers           |
| `application-deployment-receipts.ts`                                | historical lifecycle identity and inventory                                                 | removed                                                                                                                                                      |
| `application-provider-preparation.ts`                               | historical central provider prepare/delete interface and ordering                           | removed                                                                                                                                                      |
| `container-registry-preparation.ts`                                 | historical namespace/Harbor preparation and cleanup                                         | removed                                                                                                                                                      |
| `container-deployment-plan.ts`                                      | historical image planning, receipt state, and generated-file rewriting                      | removed; registry selection now lives in `deployment-registry.ts`, while artifact identity and execution belong to the deployment graph and Alchemy provider |
| `application-postgres-preparation.ts`                               | historical direct CNPG composition                                                          | removed; deployment lowering uses the released TypeKro contribution                                                                                          |
| `application-valkey-preparation.ts`                                 | historical direct Valkey composition                                                        | removed; deployment lowering uses the released TypeKro contribution                                                                                          |
| OBC/Rook preparation in `cli.ts`                                    | direct-only object storage lifecycle                                                        | emit an explicit direct TypeKro declaration in the Alchemy graph; never place unsafe OBC continuous apply inside the KRO RGD                                 |
| Ory/Hatchet/ClickHouse preparation in `cli.ts`                      | provider-specific namespace, secret, factory, readiness, and cleanup logic                  | move to provider contributors using TypeKro factories and Alchemy resources                                                                                  |
| `application-kro-provider-migration*.ts`                            | historical pre-graph ownership migration                                                    | removed because no released consumers require adoption                                                                                                       |
| `application-status-reconciler.ts`                                  | generated Application status projection                                                     | retain schema/source compilation; remove any writer duplicated by root TypeKro hydration                                                                     |
| `application-installation-client.ts`                                | typed runtime creation/deletion of Application instances                                    | retain as the runtime-CR path; make clear it is Kubernetes desired-state management, not release-time Alchemy orchestration                                  |
| `application.ts` infrastructure recording                           | semantic provider/resource capture mixed into a large authoring module                      | keep capture semantics, move deployment lowering and concrete TypeKro construction out                                                                       |
| compiler `typekro-emission-plan.ts` and pipeline resource gathering | deterministic array assembly and YAML-oriented emission                                     | replace with deployment-graph lowering and the TypeKro adapter; keep only GitOps/export emission over canonical declarations                                 |
| compiler `resources.json` mutation and post-build materialization   | resolved image/output substitution                                                          | replace with symbolic artifact outputs resolved by Alchemy at materialization time                                                                           |
| readiness helpers in `cli.ts`                                       | RGD, instance, provider, and endpoint polling                                               | TypeKro owns Kubernetes readiness; retain only generic status observation and optional endpoint smoke verification                                           |
| raw Kubernetes reads in normal deployment                           | registry endpoint and authoritative status observation                                      | keep exact reads in focused observation/diagnostic modules only; ownership and readiness remain TypeKro/Alchemy concerns                                     |

Steady-state deletion targets:

- zero receipt writes during normal plan/apply/destroy;
- zero provider names or provider-specific factories in CLI command implementations;
- zero direct `factory.deploy()` or `factory.deleteInstance()` calls in the normal CLI path;
- zero generated-file mutation after artifact publication;
- zero handwritten namespace create/delete in normal deployment;
- zero duplicate Kubernetes dependency graphs or reverse-delete algorithms;
- zero readiness success inferred from Alchemy completion alone;
- zero ordinary deployment dependence on generated shell scripts;
- zero migration-module imports from the normal backend;
- zero deployment-only imports reachable from browser, handler-safe, or runtime-client entrypoints.

Initial maintainability budgets:

- CLI command parsing/progress code at most 1,000 non-test lines, with no provider branching;
- one provider contribution registry and one TypeKro adapter;
- one Alchemy Stack identity implementation and one state-backend abstraction;
- one canonical deployment graph codec/digest implementation;
- one generic plan/apply/destroy/observe backend interface;
- migration code measured and reported separately from steady-state deployment code;
- at least 40% reduction in steady-state deployment/lifecycle LOC from the baseline inventory, with no
  functionality moved into generated string templates to game the metric.

### File-level disposition ledger

This is the starting disposition ledger for the currently visible deployment-related surface. Workstream 0
must keep it current as additional side-effect paths are discovered.

| Current module(s)                                                                                                                                                      | Classification                                              | Required change                                                                                                                                                                                                              | Exit condition                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `cli.ts`                                                                                                                                                               | historical orchestration/UI mixture                         | replaced by the focused CLI router and graph-backed command modules                                                                                                                                                          | no provider factory/import, direct deployment, receipt write, namespace mutation, or delete ordering in command handlers |
| `node-build-runner.mjs`                                                                                                                                                | artifact execution adapter                                  | move immutable build/publish behavior behind the Alchemy artifact provider, reuse TypeKro's reviewed OCI build/publish/digest machinery, and retain a child-process worker only if isolation is an explicit backend contract | it is either deleted or contains no deployment ordering/state                                                            |
| `node-delete-runner.mjs`                                                                                                                                               | duplicate lifecycle executor                                | removed                                                                                                                                                                                                                      | all normal deletion runs through the Alchemy Stack and TypeKro provider                                                  |
| `application-deployment-receipts.ts`                                                                                                                                   | historical state                                            | removed                                                                                                                                                                                                                      | absent and guarded by maintainability checks                                                                             |
| `application-provider-preparation.ts`                                                                                                                                  | historical central provider effect registry                 | removed                                                                                                                                                                                                                      | one pure contributor registry, no provider switch in the backend                                                         |
| `application-postgres-preparation.ts`, `application-valkey-preparation.ts`                                                                                             | TypeKro composition wrappers                                | convert to pure contribution descriptors or remove if the upstream factory already expresses the complete contract                                                                                                           | no imperative deploy/delete or receipt ownership                                                                         |
| `container-registry-preparation.ts`                                                                                                                                    | Harbor/platform effect orchestration                        | lower registry bootstrap, project, robot, and Secret references into artifact/external/TypeKro nodes                                                                                                                         | registry outputs flow through typed Alchemy Outputs; no generated-file mutation                                          |
| `container-deployment-plan.ts`                                                                                                                                         | historical artifact planning plus local-state concepts      | removed; generated-workload contracts lower into deployment artifact nodes, and Alchemy owns build/publication state                                                                                                         | file absent; evidence derives from the canonical deployment graph and live immutable bindings                            |
| `application-kro-provider-migration.ts`, `application-kro-provider-migration-kubernetes.ts`                                                                            | historical compatibility migration                          | removed                                                                                                                                                                                                                      | absent and guarded by maintainability checks                                                                             |
| `application-status-reconciler.ts`, `application-generated-job-status.ts`                                                                                              | status schema/source compilation                            | retain pure status description; delete duplicate effectful writers                                                                                                                                                           | one root TypeKro/KRO status projection owns each installation status field                                               |
| `application-installation-client.ts`, `application-installation-runtime.ts`                                                                                            | runtime CR client                                           | retain and clarify the runtime desired-state boundary                                                                                                                                                                        | creating a runtime instance requires no local Alchemy Stack or receipt                                                   |
| `application-installation-values.ts`, `application-typekro-values.ts`                                                                                                  | normalized install inputs/TypeKro values                    | move generic normalized inputs into deployment contract/compiler; keep TypeKro mapping only in adapter                                                                                                                       | no TypeKro types in the portable contract                                                                                |
| `application-event-log-resources.ts`, `application-projection-store-resources.ts`, `application-generated-job-resources.ts`, `application-infrastructure-resources.ts` | semantic-to-resource generation                             | split provider-neutral requirements from concrete TypeKro fragments; register the latter with the TypeKro adapter                                                                                                            | application/compiler core emits requirements, not live factories or deployment effects                                   |
| `application-providers.ts`                                                                                                                                             | large public provider contract surface                      | preserve provider-neutral authoring types; extract concrete deployment contributors and runtime clients into focused modules/packages                                                                                        | importing authoring types initializes no TypeKro, Alchemy, Kubernetes, provider SDK, or Node deployment code             |
| `application-runtime-module-manifest.ts`                                                                                                                               | runtime packaging contract                                  | retain; consume symbolic artifact references rather than deployment receipts                                                                                                                                                 | manifests remain deterministic before artifact outputs resolve                                                           |
| `kubernetes-api-client.ts`                                                                                                                                             | raw Kubernetes access                                       | restrict to observation, diagnostics, and runtime client use                                                                                                                                                                 | no normal apply/destroy ownership or ordering decisions are implemented here                                             |
| `factories/alchemy.ts`                                                                                                                                                 | broad upstream re-export                                    | removed; focused deployment code uses `@applik8s/deployment-alchemy`                                                                                                                                                         | normal authors and examples cannot import Alchemy from the authoring facade                                              |
| `typekro.ts`, `factories/containers.ts`                                                                                                                                | public convenience exports                                  | audit reachability; keep only authoring-safe exports and move deployment factories to adapter/backend entrypoints                                                                                                            | handler/browser/authoring imports do not pull deployment machinery                                                       |
| compiler `application-containers/*`, `container-image/*`                                                                                                               | artifact description                                        | retain pure build inputs and symbolic outputs; move publication effects to Alchemy                                                                                                                                           | compiler emits typed artifact requirements, not a publication state machine                                              |
| compiler `pipeline/typekro-api-resources.ts`, `pipeline/typekro-emission-plan.ts`                                                                                      | TypeKro/YAML-oriented assembly                              | replace with deployment-graph construction plus the single TypeKro adapter                                                                                                                                                   | no parallel manifest dependency/order IR                                                                                 |
| compiler `manifest/index.ts`, `manifest/validation.ts`                                                                                                                 | mixed runtime manifest generation and deployment validation | keep runtime-image/manifest concerns; move lifecycle/ownership/output checks to the deployment graph validator                                                                                                               | each invariant has one validator and one source location                                                                 |
| generated `resources.json`, `apply.sh`, YAML and TypeScript deployment output                                                                                          | inspection/GitOps artifacts                                 | regenerate from canonical deployment/TypeKro plans; make immutable after compilation                                                                                                                                         | ordinary deployment does not edit or execute them                                                                        |
| `projection-runtime-clickhouse.ts` and other request/worker clients                                                                                                    | runtime provider client                                     | retain outside deployment packages                                                                                                                                                                                           | importing deployment contracts does not import runtime clients, and vice versa                                           |

The initial filename scan covers approximately 14,644 lines across deployment-adjacent CLI, provider,
installation, status, compiler, runtime, and migration modules. That is an audit scope, not a deletion
target: runtime contracts and semantic generation remain valuable. The reduction metric applies to
steady-state deployment orchestration, lifecycle, and duplicated planning code after the ledger classifies
each module.

### Public command and authoring surface after convergence

The refactor should make deployment internals smaller without changing the basic author experience:

```text
applik8s plan [--profile ...] [--strategy direct|kro]
applik8s deploy [--profile ...] [--strategy direct|kro]
applik8s status
applik8s delete
```

- `plan` compiles and validates the deployment graph and renders the Alchemy preview without effects.
- `deploy` reconciles the same Stack, streams graph-source-aware progress, then waits for authoritative
  Application readiness.
- `status` reads Alchemy transaction health and Kubernetes/Application readiness as distinct sections.
- `delete` destroys the same Stack and waits for TypeKro/Kubernetes deletion; it does not rediscover a
  separate cleanup algorithm from compiler artifacts.
- ordinary application code continues to declare `ApplicationHost`, storage, event, query, identity,
  authorization, DNS/TLS, and other provider-neutral requirements through the Applik8s authoring API.

## `ApplicationDeploymentGraph` catalog

The graph must be small enough to reason about but complete enough that no deploy/delete policy lives only
in an adapter. Use a closed, versioned node taxonomy:

| Node kind               | Represents                                                                 | Materialization                                                                |
| ----------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `artifact`              | container build, WASM/component bundle, migration asset, generated runtime | Alchemy artifact Resource with immutable typed outputs                         |
| `externalProvider`      | non-Kubernetes provider effect                                             | provider-specific Alchemy Resource                                             |
| `kubernetesComposition` | the root application TypeKro composition                                   | one direct or KRO factory converted with `toAlchemyResources()`                |
| `kubernetesDirect`      | an explicitly direct-only TypeKro resource/composition                     | direct factory declarations in the same Stack                                  |
| `singleton`             | shared TypeKro owner with deterministic identity/spec                      | TypeKro singleton declarations                                                 |
| `externalReference`     | pre-existing/shared resource not owned by this installation                | validated TypeKro `externalRef` or provider reference; no create/delete effect |
| `secretReference`       | named Secret/key or named host binding                                     | reference/Redacted binding only; never raw secret bytes                        |
| `statusProjection`      | authoritative installation output projected from live resources            | TypeKro/KRO status definition plus Applik8s source mapping                     |

Every node includes:

- `id`, `kind`, contract version, source semantic node/artifact, connection and installation scope;
- typed JSON-compatible inputs or symbolic references;
- declared typed outputs with sensitivity and persistence classification;
- create/update/readiness/delete behavior;
- owner, sharing, retention, deletion, and orphan policy;
- direct/KRO/Alchemy capability requirements;
- provider implementation identity and version;
- deterministic configuration digest;
- diagnostics and source locations safe for serialization.

Use typed edges rather than one overloaded phase field:

| Edge             | Meaning                                                                        |
| ---------------- | ------------------------------------------------------------------------------ |
| `requiresOutput` | consumer input uses a named producer output                                    |
| `requiresReady`  | consumer may reconcile only after producer readiness                           |
| `installsApi`    | CRD/controller prerequisite must be established before the consumer definition |
| `owns`           | owner controls child lifecycle                                                 |
| `retains`        | target must survive source teardown                                            |
| `publishes`      | artifact or provider output becomes a deployable reference                     |
| `projectsStatus` | target contributes authoritative status to the root installation               |

Validation must reject:

- duplicate stable IDs or two installation identities mapping to one Alchemy Stack key;
- missing output names, incompatible output types, sensitive output use without a protected binding, and
  secret values marked persistable;
- dependency, ownership, retention, or status-projection cycles;
- a retained child inside an application-owned namespace that will be deleted;
- cross-connection ownership or output references without an explicit supported bridge;
- an external reference carrying create/delete policy;
- singleton identity/spec drift within the plan;
- direct-only resources selected for KRO continuous apply;
- an owned Namespace nested into an RGD rather than delegated to TypeKro hoisting;
- status fields without an authoritative live source or an explicit static/desired classification;
- an external provider required by a runtime-created CR when no durable controller implements it;
- a migration node in a fresh deployment or without exact live identity evidence.

## Provider contribution contract

Provider packages contribute data; they do not execute effects while the graph is being built. The
contributor shape should be equivalent to:

```ts
interface ApplicationDeploymentContributor<TRequirement> {
  readonly interface: string;
  readonly implementation: string;
  readonly version: number;
  validate(
    requirement: TRequirement,
    context: DeploymentPlanningContext,
  ): readonly Diagnostic[];
  contribute(
    requirement: TRequirement,
    context: DeploymentPlanningContext,
  ): ApplicationDeploymentContribution;
}

interface ApplicationDeploymentContribution {
  readonly nodes: readonly ApplicationDeploymentNode[];
  readonly edges: readonly ApplicationDeploymentEdge[];
  readonly compositionFragments: readonly TypeKroFragmentDescriptor[];
  readonly statusProjections: readonly DeploymentStatusProjection[];
}
```

`TypeKroFragmentDescriptor` is Applik8s-owned portable data or a stable generated-artifact reference, not a
live TypeKro object in the portable graph. The TypeKro adapter resolves descriptors only after graph
validation. Contributor construction, validation, and contribution must not:

- contact Kubernetes, registries, databases, or external APIs;
- read ambient kube context or credentials;
- create an Alchemy Resource or Output;
- call a TypeKro factory;
- mutate global registries;
- build/push an image;
- write a receipt or generated deployment file.

The single registry key is `(provider interface, implementation, contributor contract version)`. Adding a
provider must require exactly one registration plus conformance tests.

## Concrete provider migration catalog

| Capability/implementation          | New graph contribution                                                                           | TypeKro/Alchemy treatment                                                                                        | Current code to retire or narrow                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `ApplicationHost/kubernetes`       | image artifact, pull-secret reference, Deployment, Service, RBAC, probes, status                 | image output -> root TypeKro composition                                                                         | CLI host preparation, cursor-Secret receipts, post-build JSON rewriting          |
| `ContainerRegistry/Harbor`         | registry endpoint/ref, optional Harbor singleton/platform, project, robot/pull Secret references | registry bootstrap/project as Alchemy resources; Harbor/Rook via TypeKro; image publication depends on readiness | registry preparation runtime, direct namespace receipts, manual project cleanup  |
| `ModelStore/PostgreSQL`            | CNPG singleton/operator reference, Cluster/Secret/migration nodes, retention policy              | released TypeKro CNPG factory; retained data represented by scopes/policy                                        | direct CNPG deploy/delete and readiness branches                                 |
| `IndexStore/Valkey`                | Valkey operator singleton and cluster resource                                                   | TypeKro Valkey singleton/composition                                                                             | Valkey operator/cluster receipts and direct deletion                             |
| `EventLog/JetStream`               | NATS operator/server singleton, Stream, Consumer, credentials, processors                        | TypeKro NATS composition/resources; stream dependencies in root graph                                            | any manual event infrastructure ordering                                         |
| `ProjectionStore/ClickHouse`       | operator singleton, CHI/database/user Secret, projection workers                                 | TypeKro ClickHouse/ClickStack factories                                                                          | clickhouse namespace preparation and provider waits                              |
| `ObjectStorage/Rook OBC`           | external/singleton Rook platform plus explicit direct-only OBC declaration and binding outputs   | OBC remains TypeKro direct under Alchemy; never embedded in KRO continuous apply                                 | OBC existence/readiness/delete code and receipts                                 |
| `WorkflowEngine/Hatchet`           | Hatchet stack, database/cache references, admin/worker Secret references, workers                | TypeKro Hatchet composition plus protected Alchemy-generated secret material when necessary                      | random-secret generation in CLI, Secret factories, worker-token cleanup ordering |
| `IdentityProvider/Ory`             | Ory platform singleton/stack, database and route dependencies, Secret refs                       | TypeKro Ory composition with namespace lifecycle delegated upstream                                              | Ory namespace preparation, `targetScopes` workaround, direct cleanup             |
| `Authorization/Ory or alternative` | provider-neutral policy capability and concrete provider contribution                            | external or Kubernetes provider selected through registry                                                        | provider-brand branching in CLI/application code                                 |
| `HttpExposure`                     | Gateway/Ingress, Certificate, DNS publication, endpoint status                                   | TypeKro resources in root composition; external DNS API only through provider controller/Alchemy                 | manual endpoint readiness except optional smoke probe                            |
| generated operator/WASM            | build artifact plus CRDs, RBAC, Deployment, prerequisite edge                                    | artifact output and TypeKro `installsApi` ordering                                                               | shell-script CRD/RGD ordering and rewritten image refs                           |
| application cursor/config Secrets  | Secret references or explicitly generated direct resources                                       | TypeKro/Alchemy sensitive bindings, scope-aware deletion                                                         | host preparation receipts and direct secret cleanup                              |

For every row, define:

- exact stable node IDs and outputs;
- direct/KRO support matrix;
- singleton/external/application ownership;
- default and configurable retain/delete behavior;
- status source and failure semantics;
- secret binding contract;
- update safety and destructive-change rejection;
- migration from current receipt/live-resource identity;
- packed-consumer and OrbStack conformance.

## TypeKro adapter catalog

The adapter is deliberately narrow. It must:

1. Check the pinned TypeKro semantic-plan/artifact capability version.
2. Resolve provider fragment descriptors and generated resources into one composition capture.
3. Attach explicit `dependsOn`, scopes, singleton owners, external refs, aspects, include conditions, and
   readiness/status definitions without YAML round-tripping.
4. Compile/inspect TypeKro's canonical direct or KRO artifact plan for diagnostics and evidence.
5. Call `factory.toAlchemyResources()` exactly once for the root factory and once for each explicit
   direct-only composition not representable in the root KRO graph.
6. Preserve TypeKro declaration IDs and dependency edges; never rename/reorder them based on provider type.
7. Bind `artifactOutput` requirements to typed Alchemy artifact/external-provider Outputs.
8. Configure credential-safe kubeconfig sources/bindings and reject static credentials before state.
9. Return declarations, status/source metadata, canonical digests, and diagnostics to the Alchemy backend.
10. Expose no deploy/delete operation itself.

It must not:

- implement a second Kubernetes dependency graph;
- parse generated YAML to recover references;
- patch TypeKro internals or monkey-patch composition behavior;
- manually hoist Namespaces, reproduce singleton drift checks, or reconstruct cross-process inventory;
- persist TypeKro's experimental planning DTO as Applik8s's stable public state;
- weaken a direct-only safety invariant merely to achieve one-RGD aesthetics.

## Alchemy backend catalog

The backend owns these operations:

- `plan`: validate graph, allocate Stack identity, instantiate resources in preview/no-effect mode, and
  return structured changes/diagnostics;
- `apply`: reconcile artifacts, external providers, direct prerequisites, and root TypeKro declarations;
- `refresh`: compare Alchemy state, provider outputs, TypeKro declarations, and live readiness without
  changing semantic desired state;
- `destroy`: reverse-topological deletion honoring retain/shared/external policy and waiting for TypeKro
  finalization;
- `resume`: reopen the same Stack after interruption and continue from durable provider state;
- `export/import`: encrypted or access-controlled state backup plus version metadata;
- `observe`: read authoritative TypeKro/Kubernetes status and merge transaction progress without conflating
  them.

Required backend contracts:

- one canonical Stack key derived from a length-prefixed/hash-safe encoding of connection identity,
  application identity, control-plane namespace, instance, and profile;
- a persisted reverse lookup that rejects two full identities resolving to the same Stack key;
- one writer/lease per Stack with bounded acquisition and stale-owner diagnostics;
- atomic state writes, schema/version checks, backup-before-migration, and corruption rejection;
- provider registration without central conditionals;
- Effect `Redacted` or named host bindings for sensitive inputs;
- output validation before a dependent TypeKro operation begins;
- cancellation/deadline propagation through Alchemy, TypeKro, container builds, provider calls, and status
  observation;
- structured progress keyed back to deployment-graph and semantic source IDs;
- no successful return until TypeKro/Kubernetes reports the requested readiness/deletion terminal state.

Container artifacts are durable Alchemy Resources. Their provider should reuse TypeKro's reviewed generic
OCI/Harbor credential-session, build, push, digest-verification, timeout, and cancellation primitives rather
than forking them. Do not call eager `container()` while constructing the deployment graph: that compatibility
API performs a pre-deploy side effect and would put planning outside Alchemy state. The Alchemy Resource
invokes the lower-level operation during reconciliation and supplies the resulting immutable digest through
`artifactOutput(...)`.

## Required bootstrap model

One composition does not eliminate real causal boundaries. Preserve only boundaries that are unavoidable:

1. Select or prepare an independently reachable container registry. Harbor cannot bootstrap from images
   that exist only inside that same Harbor installation.
2. Build Applik8s-authored OCI artifacts, publish them, and resolve immutable digests.
3. Instantiate the final Kubernetes composition using those digest references.
4. Wait for TypeKro/KRO readiness and publish authoritative Application status.

Alchemy should express these phases as resource dependencies inside one deployment transaction. The CLI
must not implement them as a parallel handwritten state machine.

Shared platform resources such as Rook/Ceph, Harbor, cluster operators, and their CRDs may be retained,
singleton-owned, or externally referenced. Application instances must never accidentally own shared
platform namespaces or data.

## Completed replacement sequence

The refactor characterized the old effects, introduced the portable deployment graph, proved the
TypeKro/Alchemy vertical slice, moved provider effects behind focused contributors, and then physically
removed the old engine. CI now enforces that preparation receipts, compatibility adoption, direct factory
orchestration, generated-shell application, and provider-specific CLI branches cannot return. Remaining
work is qualification of the single graph-backed engine, not migration between engines.

## Locked implementation decisions

| Decision                 | Default for this goal                                                                                                         | Required evidence                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| TypeKro version/API      | exact pin to the first reviewed release containing PR #117; all experimental planning access isolated in one adapter          | API capability contract and packed-import test                      |
| Alchemy version cohort   | use the exact Alchemy/Effect cohort required by that TypeKro release                                                          | dependency-cohort check; no duplicate incompatible Effect runtime   |
| local/CI state backend   | one secured, atomic filesystem-backed implementation for local use and an isolated CI location; in-memory only for unit tests | restart/resume, lock contention, corruption, backup/restore tests   |
| production state backend | interface and threat model documented, but a remote implementation may follow this single-cluster goal                        | no claim that local filesystem state is multi-host production state |
| Stack identity           | canonical encoded full identity plus digest and persisted reverse lookup                                                      | adversarial collision/property tests and two simultaneous installs  |
| default strategy         | preserve the current public default; direct and KRO consume the same graph                                                    | parity and mode-specific lifecycle tests                            |
| registry bootstrap       | explicit external/bootstrap registry boundary; final application artifacts may target managed Harbor                          | fresh-cluster dependency graph has no cycle                         |
| shared platform          | TypeKro singleton ownership or explicit external reference, never application-instance ownership                              | two-install teardown and spec-drift tests                           |
| retained data            | data namespace/volume ownership must make the promise physically true                                                         | destructive teardown/re-adoption tests                              |
| runtime-created CRs      | Kubernetes/KRO reconciliation, not hidden local Alchemy Stacks                                                                | operator-created second instance test on the same cluster           |
| external runtime effects | require a durable in-cluster/provider controller                                                                              | compile-time rejection without one                                  |

## Workstream 0: Inventory and freeze the lifecycle contract

- [x] Inventory every deploy, prepare, migrate, receipt, cleanup, direct-factory, KRO-factory, `kubectl`, and
      raw Kubernetes mutation path in the compiler, CLI, adapters, scripts, and examples.
- [x] Classify each path as semantic compilation, artifact preparation, Kubernetes resource, external
      provider resource, status observation, or obsolete duplication.
- [x] Write a responsibility matrix naming the single owner for identity, dependency order, readiness,
      update, deletion, retention, outputs, credentials, and status.
- [x] Capture the current Chirp deployment graph, generated TypeKro artifacts, resource inventory, image
      digests, Alchemy state, and deletion order as local qualification fixtures.
- [x] Specify stable deployment identity and collision behavior for multiple applications, installations,
      namespaces, clusters/connections, profiles, and shared platform resources.
- [x] Prohibit new provider-specific branching in the CLI while the refactor is underway.

**Gate:** every current side effect has one destination in the new architecture, and no lifecycle concern has
two intended authorities.

## Workstream 1: Define and validate `ApplicationDeploymentGraph`

- [x] Add the versioned deployment-graph types to a focused portable package with no Alchemy, TypeKro,
      Kubernetes-client, Node-only, or provider-runtime imports.
- [x] Implement canonical serialization, deterministic ordering/digesting, strict parsing, compatibility,
      source mapping, and actionable diagnostics.
- [x] Model nodes, typed outputs, dependency edges, connection scope, ownership, retention, sensitivity,
      readiness, update, and deletion explicitly.
- [x] Validate missing dependencies, cycles, illegal cross-connection ownership, unsafe namespace ownership,
      secret persistence, unsupported direct/KRO resources, ambiguous provider bindings, and conflicting stable
      identities before effects.
- [x] Lower a normalized `ApplicationGraph` and concrete installation spec into a deployment graph without
      importing the author's module a second time or reconstructing authoring-time schemas.
- [ ] Add graph snapshots and profile tests for GuestBook, Chirp starter, Chirp dedicated, and Chirp
      external-provider profiles.

**Gate:** the deployment graph completely describes the current plan, is deterministic across builds, and
fails closed before any effect when lifecycle or dependency semantics are ambiguous.

## Workstream 2: Assemble the unified TypeKro composition

- [x] Create a focused compiler/lowerer that consumes only validated deployment-graph nodes and generated
      artifacts and produces one `kubernetesComposition` per concrete application installation.
- [x] Replace artifact-array concatenation and provider-specific resource gathering with one registry of
      provider-neutral deployment-node lowerers.
- [x] Preserve TypeKro references, CEL/include conditions, external references, singleton ownership,
      connection scoping, resource scope, and readiness evaluators without stringifying and reparsing YAML.
- [x] Ensure every Kubernetes dependency is represented by a TypeKro reference or explicit dependency edge;
      avoid timing dependencies and arbitrary waits.
- [x] Generate both direct and KRO factories from the same composition and prove artifact equivalence where
      the strategies are expected to agree.
- [x] Keep direct-only resources explicit. If an OBC or other resource is unsafe under continuous KRO apply,
      model it as a separate Alchemy/TypeKro direct resource dependency rather than weakening its safety rule.
- [x] Make TypeKro status hydration the only Application installation status writer.
- [x] Enforce RGD/instance/namespace deletion ordering and safe singleton/shared ownership through TypeKro's
      current lifecycle machinery.

**Gate:** GuestBook and each Chirp profile compile to one inspectable application composition plus only the
explicit direct-only/shared prerequisites required by their contracts.

## Workstream 3: Implement the Alchemy v2 deployment backend

- [x] Add an internal Alchemy backend package/module with no public authoring API leakage.
- [x] Materialize TypeKro declarations through the released Alchemy v2 integration rather than invoking
      `factory.deploy()` and `factory.deleteInstance()` independently from CLI branches.
- [x] Lower artifact builds/publication and supported non-Kubernetes providers into Alchemy resources with
      stable IDs, typed outputs, and explicit dependencies.
- [x] Merge `kroProvider` with the required provider layers and define one scoped Stack per concrete
      installation.
- [x] Implement plan, apply, refresh/reconcile, destroy, and failure-resume operations.
- [x] Ensure reverse-topological destroy deletes application instances before RGDs and dependents before
      dependencies, while honoring retain/shared/external policies.
- [x] Define an Alchemy state backend and scope safe for local use and CI, with locking, concurrent-run
      rejection, schema migration, corruption diagnostics, and backup/export.
- [x] Redact sensitive inputs and add structural tests proving secrets and kubeconfig contents never enter
      serialized deployment graphs, Alchemy props/outputs, logs, status, or committed evidence.
- [ ] Add deterministic fake-provider tests and live direct/KRO tests against OrbStack.

**Gate:** applying and destroying the same deployment graph through Alchemy is idempotent, resumable,
dependency-correct, secret-safe, and finalizer-safe.

## Workstream 4: Narrow the CLI and delete bespoke orchestration

- [x] Reduce `applik8s deploy` to compilation, deployment-graph selection, Alchemy invocation, progress
      rendering, and authoritative status reporting.
- [x] Reduce `applik8s delete` to selecting the same scoped Alchemy Stack, performing reverse-topological
      destruction, and awaiting TypeKro/Kubernetes completion.
- [x] Move provider selection and lowering out of `cli.ts`; providers implement one generic deployment-lowerer
      contract registered at package boundaries.
- [x] Replace per-provider preparation receipts with Alchemy state.
- [x] Remove pre-graph receipt and provider-adoption paths; no released consumers require compatibility.
- [x] Delete obsolete runners, manual dependency sequencing, duplicated readiness loops, provider switch
      statements, and receipt helpers; retain only the bounded Node process-isolation adapters.
- [x] Preserve current commands and understandable phase-specific progress; changing the internal engine
      must not make the ordinary developer experience more verbose.
- [x] Add maintainability budgets for CLI size, provider branching, deployment modules, and duplicate
      lifecycle concepts.

**Gate:** adding a conforming provider requires a provider package/lowerer and tests, not edits throughout the
CLI, compiler pipeline, deletion runner, and receipt machinery.

## Workstream 5: Prove lifecycle and failure semantics

- [ ] Prove first install, idempotent redeploy, changed-artifact update, changed-provider configuration,
      interrupted apply, resume, readiness failure, and corrected retry.
- [ ] Prove direct and KRO deployment strategies from the same deployment graph.
- [ ] Prove destroy waits for instances/finalizers before RGDs and leaves no orphan resources or terminating
      namespaces.
- [ ] Prove shared Harbor/Rook/operator resources and retained PostgreSQL/object data survive application
      teardown exactly when policy says they should.
- [ ] Prove application-owned ephemeral resources are removed and external resources are never deleted.
- [ ] Prove concurrent installations cannot collide in Alchemy state, Harbor projects, namespaces,
      Kubernetes objects, NodePorts, databases, buckets, streams, or credentials.
- [ ] Prove dependency cycles, missing outputs, failed secret resolution, stale state, state corruption,
      connection mismatch, and unsafe ownership fail with actionable diagnostics before destructive effects.
- [ ] Never use ad-hoc `kubectl delete` as the successful lifecycle path in tests or implementation.
- [ ] Characterize and bound slow namespace-controller convergence seen on OrbStack: TypeKro/Alchemy
      deletion removed every graph-owned object and awaited a real namespace 404, but empty test
      namespaces took roughly five to eight minutes to clear Kubernetes' built-in finalizer.
- [ ] Remove TypeKro planning noise that currently misclassifies the `svc` segment of Kubernetes DNS names
      as a resource reference and reports Namespaces as missing a namespace. These warnings are false
      positives, but they obscure actionable deployment diagnostics.

**Gate:** lifecycle behavior is derived from the graph and executed by Alchemy/TypeKro, not from cleanup
knowledge duplicated in tests or the CLI.

## Workstream 6: Requalify Chirp and GuestBook end to end

- [x] Keep `bun run --cwd examples/chirp-start deploy:local` as the ordinary local entrypoint, now backed by
      the deployment graph and Alchemy.
- [x] Rebuild and deploy every Applik8s-authored image to Harbor by digest and prove unchanged deployments
      avoid unnecessary build/push/apply work.
- [x] Re-run the complete Chirp runtime and Playwright golden paths without direct database, outbox,
      projection, event, status, or SSE writes.
- [x] Re-run provider recovery, processor/web/gateway restart, Valkey loss/rebuild, projection catch-up, and
      authoritative requery evidence.
- [x] Re-run GuestBook as the minimal counterexample proving the architecture is not Chirp-specific.
- [ ] Record deployment-graph digest, Alchemy Stack identity, TypeKro composition/RGD digest, image digests,
      resource inventory, provider versions, timings, status, update behavior, and cleanup outcome.
- [ ] Compare pre/post deployment time, no-op time, graph size, RGD size, OCI context size, CLI complexity,
      and lifecycle code size. Regressions require an explicit explanation and budget update.

**Gate:** both examples retain their developer experience and behavior while deployment implementation and
evidence become simpler and more uniform.

## Workstream 7: Documentation, modularity, and review

- [ ] Update vision, roadmap, architecture, provider authoring, operations, troubleshooting, and examples to
      distinguish semantic graph, deployment graph, Alchemy transaction state, TypeKro composition, and
      Kubernetes status.
- [ ] Document the bootstrap exception, state location/locking, credential policy,
      retention, shared ownership, direct vs KRO selection, preview, and destroy semantics.
- [x] Split large deployment/compiler/CLI modules along the responsibility boundaries above before adding
      new provider features.
- [x] Add boundary checks preventing Alchemy imports in portable core, browser, React, SDK, WASM handler,
      application-domain, and provider-neutral authoring modules.
- [x] Add boundary checks preventing TypeKro resources from leaking into Chirp/GuestBook domain and route
      modules.
- [x] Require package-consumer tests to exercise the Alchemy backend from packed packages rather than
      workspace aliases.
- [ ] Run the complete local and OrbStack gates and obtain an isolated architectural review with no prior
      implementation context.
- [ ] Address every P1/P2 finding and document any accepted lower-priority limitation before release review.

**Gate:** an independent reviewer can identify one owner for every lifecycle concern and can add a small
provider without discovering hidden CLI or receipt coupling.

## Required test matrix

| Layer                   | Required evidence                                                                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Types                   | Deployment-node/output inference, provider-lowerer conformance, illegal edge/ownership negatives                                                                       |
| Pure graph              | Determinism, serialization, digest, validation, compatibility, cycles, secret classification                                                                           |
| Compiler                | One composition, direct/KRO parity, conditions, external refs, status, source mapping                                                                                  |
| Alchemy fake            | IDs, dependencies, outputs, no-op reconcile, partial failure/resume, reverse destroy                                                                                   |
| TypeKro direct          | Apply/update/readiness/delete from materialized Alchemy resources                                                                                                      |
| TypeKro KRO             | RGD/instance ordering, finalizers, namespace safety, singleton/shared lifecycle                                                                                        |
| Security                | No credentials or kubeconfig contents in graph, state, logs, artifacts, status, or evidence                                                                            |
| Identity/property       | Adversarial Stack-key collisions, canonical encoding, graph ordering, digest stability, and source-ID round trips                                                      |
| Concurrency             | Same-Stack lock rejection, different-Stack parallelism, cancellation, deadline propagation, and interrupted writer recovery                                            |
| Dependency reachability | Browser, handler-safe, WASM, authoring, and runtime-client entrypoints cannot reach Alchemy, Commander, Kubernetes deployment, filesystem, or provider deployment SDKs |
| Packed consumer         | Deployment from packed packages with no workspace-only import behavior                                                                                                 |
| Live OrbStack           | Fresh apply, no-op apply, update, interrupted resume, direct/KRO delete, retained resources                                                                            |
| Runtime CR              | Operator-created additional Application/Tenant instance reconciles through KRO without local Alchemy state                                                             |
| Browser/runtime         | GuestBook and complete Chirp golden paths after deployment-engine replacement                                                                                          |
| Maintainability         | CLI/module/provider-branching budgets and deleted duplicate lifecycle code                                                                                             |

## Critical execution order

1. Inventory and freeze identity, ownership, readiness, retention, and deletion semantics.
2. Define and validate the portable `ApplicationDeploymentGraph`.
3. Lower the graph into one TypeKro application composition.
4. Implement the Alchemy v2 backend using TypeKro's released integration.
5. Prove apply/update/destroy and secret safety with fakes and focused OrbStack tests.
6. Narrow the CLI and delete superseded orchestration.
7. Requalify GuestBook and Chirp, compare pre/post evidence, and complete isolated review.

Do not begin by rewriting the CLI around new conditionals. Establish the deployment IR and provider-lowering
contract first, then make both Alchemy and the CLI consume those contracts.

## Definition of done

This goal is complete only when all of the following are true:

- [x] `ApplicationGraph` remains the portable semantic contract and contains no Alchemy deployment state.
- [x] A deterministic, versioned `ApplicationDeploymentGraph` completely describes each concrete install.
- [x] Each application installation lowers to one TypeKro Kubernetes composition plus explicit direct-only,
      shared, retained, or external prerequisites.
- [x] Alchemy v2 owns deployment state, dependency ordering, idempotent reconcile, outputs, and reverse
      teardown through TypeKro's supported integration.
- [x] Kubernetes/TypeKro remain authoritative for readiness, status, finalizers, and resource deletion.
- [x] The ordinary Applik8s API and examples expose neither Alchemy nor manual TypeKro deployment machinery.
- [x] Provider-specific CLI sequencing and bespoke preparation/deletion receipt machinery have been removed.
- [ ] Direct and KRO modes pass apply, no-op, update, interrupted-resume, and deletion tests on OrbStack.
- [ ] Shared/retained/external lifecycle promises are proven and no successful cleanup path uses ad-hoc
      `kubectl delete`.
- [x] No credential, Secret value, private key, token, or kubeconfig content enters serialized graph/state,
      generated source, image layers, logs, status, or evidence.
- [ ] GuestBook and Chirp pass their build, runtime, browser, recovery, package-consumer, performance, and
      lifecycle gates through the graph-backed deployment engine.
- [x] The steady-state CLI is at most 1,000 non-test lines, contains zero provider branches/factories, normal
      lifecycle writes zero receipts, and steady-state deployment/lifecycle LOC is at least 40% below the
      characterized baseline without regressing graph, bundle, RGD, OCI, startup, no-op deployment, or runtime
      budgets.
- [x] Deployment-only imports are unreachable from browser, handler-safe, WASM, authoring, and runtime-client
      entrypoints in both workspace and packed-package tests.
- [ ] Documentation and an isolated review confirm one authority for every deployment concern with no
      unresolved P1/P2 findings.
- [ ] No release or tag has been created without explicit review and authorization.

## Explicitly deferred

- second-cluster and multi-cluster qualification;
- global/multi-region deployment state and active-active orchestration;
- provider implementations unrelated to proving the deployment-lowerer contract;
- replacing TypeKro's or Alchemy's internal deployment engines;
- using Alchemy as the application domain model or exposing it in ordinary authoring APIs;
- removing real registry-bootstrap boundaries by pretending cyclic dependencies do not exist;
- remaining Chirp product expansion that is unrelated to validating the new deployment architecture;
- production-scale claims not supported by the local OrbStack evidence profile.

These deferrals may not be used to skip correctness, bounded execution, lifecycle safety, provider
neutrality, credential safety, or single-cluster end-to-end evidence.
