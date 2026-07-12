# v0.4 Release Evidence

Status: release-ready
Evidence date: 2026-07-12

## Outcome implemented

The v0.4 candidate adds inert versioned commands and events, `Model.on.command()`, explicit command/event/handler/processor graph nodes, a PostgreSQL command transaction kernel, generated Node processors, a NATS JetStream EventLog runtime, and tree-shaken `@kubernetes/client-node` execution inside WASM closures.

The command substrate is also projection-ready without shipping a browser projection system early. Submission returns an explicitly transport-only acknowledgement; durable completion and rejection observations retain command, correlation, causation, and target identity plus an opaque result revision. Successful state changes and committed event envelopes identify the authoritative model revision. Commands may carry an expected revision, and stale revisions become durable replayable conflicts before user handler execution. ApplicationGraph records these authorities so v0.6 can add snapshot, subscription, and React delivery without reinterpreting v0.4 behavior.

PostgreSQL is authoritative for keyed serialization, idempotency, durable results, transitions, history, and outboxes. JetStream provides acknowledged at-least-once transport and stable message IDs. TypeKro owns NATS, NACK, Stream, and Consumer infrastructure lifecycle; Applik8s verifies and consumes that infrastructure without mutating it.

The complete command surface is executable rather than declarative-only. Serial ordering uses target-scoped transaction locks; concurrent ordering uses optimistic revision checks with whole-transaction retry. Missing-target routing selects an alternate key in the same authoritative model transaction. Declared follow-up commands are schema-validated, committed to the command outbox with model changes, and relayed over the JetStream command channel with stable message IDs. A runtime transaction membrane independently denies dynamically reached `fetch` in addition to compile-time handler analysis.

Provider evolution no longer requires extending the built-in core interface union. `defineApplicationProvider()` creates versioned typed provider tokens with requirements, guarantees, implementation validation, and application-graph identity; a `WorkflowEngine` compatibility fixture proves the v0.5 extension path.

The Tenant Platform benchmark now has an opt-in v0.4 slice with a typed account rename command, committed account-change event, inferred processor, and a real Kubernetes SDK read in Tenant reconciliation. The generated processor is a least-privilege workload: it runs as a non-root user with a read-only root filesystem, drops Linux capabilities, disables service-account token mounting and privilege escalation, uses bounded resources, has heartbeat-backed liveness/readiness probes, and receives a deny-ingress/restricted-egress NetworkPolicy. The v0.3 baseline remains free of v0.4 transport resources.

Generic operator-substrate hardening now also includes handler-authoritative status ownership, declared read-only arbitrary GVKs, cluster/cross-namespace RBAC lowering, ordinary WASM `Date` support, handler-trap classification, normalized static dispatcher schemas, and Node-loadable compiled package artifacts.

The application surface now also has provider-neutral HTTP exposure intents. Local exposure remains a plain Ingress, while managed public exposure requires explicit Certificate and DNS providers, emits cert-manager `Certificate` plus external-dns annotations, projects the derived HTTPS URL into the application graph, and reports DNS propagation honestly as unverified. Generated servers enforce bounded request bodies and fixed-window mutation limits. The GuestBook launch example exercises local and public profiles, typed CRDs/indexes, input sanitization, bounded reads, managed TLS/DNS, and a compact teaching version.

## Scorecard

| Dimension | Score | Evidence and remaining gap |
| --- | ---: | --- |
| Vision alignment | 8.5/10 | The intended declaration-to-durable-processor path exists and infrastructure ownership follows the vision. General streams and workflows remain intentionally later work. |
| Developer experience | 8/10 | One `Model.on.command()` declaration infers SQL, graph nodes, a processor bundle, Deployment, and NACK Consumer. A digest-pinned runtime is the default with an explicit image override; advanced placement and KEDA remain beyond the fixed-concurrency v0.4 boundary. |
| Correctness | 9.3/10 | Schema validation, alternate-key routing, serial and optimistic concurrent ordering, durable domain errors and revision conflicts, same-domain participant transactions, rollback, duplicate replay, and deadlock retry are tested. |
| Durability | 9.3/10 | State, result, transition, history, event outbox, and command outbox commit atomically; PostgreSQL remains authoritative under duplicate delivery. Both outbox channels use stable relay IDs. |
| Failure honesty | 9/10 | Transport acknowledgement is distinct from durable completion; nonexistent state never receives an invented model revision; cross-domain transactions, stale revisions, undeclared events/errors, invalid payloads, unsafe external effects, incompatible streams, and undeclared Kubernetes origins fail closed. |
| Inspectability | 9/10 | Application graph, SQL, processor source, manifests, provider requirements, bundle metafile, WASM component, and stable digests are emitted artifacts. |
| Credential safety | 9.2/10 | Kubernetes bearer identity and CA trust remain host-owned; exact guest origins are enforced; rotating token files, custom roots, TLS name override, artifact/error credential scans, fail-closed processor Secret references, and explicit JetStream authentication modes are tested. |
| Portability | 8.5/10 | Core, Apps, and Custom Objects generated clients tree-shake into a ComponentizeJS WASM component and run through WASI HTTP. Unsupported Node client paths fail closed. |
| Operability | 9/10 | Generated processors have bounded concurrency, retry/dead-letter behavior, heartbeat-backed health checks, graceful drain, restart/crash recovery, hardened pod defaults, readiness dependencies, binding-scoped bounded SQL cleanup, and database plus consumer-lag observations. Automatic KEDA scaling remains explicitly post-v0.4. |
| Backward compatibility | 9/10 | v0.3 compatibility excludes the experimental EventLog requirement and the baseline Tenant graph has no v0.4 processor resources. Packed-consumer v0.4 coverage remains. |
| Executable evidence | 9.5/10 | Local, character, vertical, packed-consumer, CNPG, generated-processor, JetStream, OrbStack WASM, TLS policy, and unified Tenant v0.4 proofs pass. |

## Verified evidence

- `bun run typecheck`
- `bun run lint` (existing GuestBook warning baseline, no errors)
- `bun run test:implemented`: 287 passed, 18 opt-in live tests skipped; the loopback performance test was rerun outside the filesystem/network sandbox and passed
- `bun run test:character`: 20 passed, 78 roadmap-character tests remain marked todo
- Tenant v0.4 compiler proof: emitted non-empty WASM, retained `CoreV1Api`, and excluded credential markers
- `cargo check -p applik8s-operator-host`
- packed-package dry run and consumer smoke: 9 packages and 15 public entrypoints passed with an isolated npm cache
- Rust Kubernetes HTTP policy proof: self-signed cluster CA, IP endpoint, TLS server-name override, rotating token file, exact-origin denial, and credential-redacted error
- OrbStack Kubernetes SDK WASM proof: Core, Apps, and KRO Custom Objects API calls plus `new Date().toISOString()` executed through the Wasmtime host
- plain Node 22 loaded all packed entrypoints and ran a clean-directory CLI build from JavaScript plus declaration tarballs
- ArkType-authored CRDs compiled through normalized static dispatch with ArkType absent from the handler metafile, JavaScript below 250 KB, and WASM below 20 MB
- Live CNPG command-kernel suite: 17 passed, including duplicate replay, same-key serialization, rollback, participants, durable rejection, and induced deadlock retry
- Focused live CNPG completion proof: alternate-key routing, optimistic same-key concurrency, different-key overlap, transactional command emission/relay, and dynamic-fetch runtime denial passed against the existing OrbStack CNPG cluster.
- Existing-stream JetStream proof: four runtime tests passed against the TypeKro-provisioned `APPLIK8S_EVENTS` stream, including duplicate acknowledgement, incompatibility failure, lag observation, and real command-channel publication.
- Live JetStream proof: TypeKro-provisioned NATS/NACK and persisted Stream/Consumer reconciled in direct and KRO modes; publication and duplicate handling observed
- Released TypeKro v0.26.0 JetStream integration: PR #112 merged, release published, dependency selected in every applik8s package, and direct plus KRO OrbStack integration evidence retained.
- Unified OrbStack Tenant v0.4 gate: 2 passed; the final feature assertions completed in 79 seconds and the full lifecycle completed in 528 seconds. Coverage includes the generated admin API, CNPG migrations and authoritative app status, durable command execution, duplicate and concurrent delivery, PostgreSQL history/outbox, JetStream facts, and `@kubernetes/client-node` execution inside the generated WASM operator.
- Processor lifecycle pressure proof: after the initial three commands, the gate published an eight-command backlog and deleted the processor pod normally, observed graceful drain, replacement, and all 11 durable results. It then published a sixteen-command backlog, force-deleted the replacement pod, and observed redelivery/recovery to all 27 durable results and history entries without losing the KRO-owned Deployment.
- Generated processor security proof: compiler artifacts and the live workload include a digest-pinned multi-architecture Node runtime (with an explicit application override), non-root execution, read-only root filesystem, dropped capabilities, disabled privilege escalation and service-account token mounting, seccomp, resource bounds, writable ephemeral `/tmp`, real heartbeat probes, fail-closed Secret keys, and a generated NetworkPolicy.
- Generated SDK permissions lower consistently through both standalone and TypeKro compiler paths to a ClusterRole and ClusterRoleBinding; the live Tenant reconcile successfully listed Namespaces
- Cluster-scoped RBAC identities now include the deployment namespace in both standalone and TypeKro lowering, preventing unrelated installations with the same operator name from colliding through KRO ApplySet ownership.
- Full and minimal GuestBook profiles compile through the published-package entrypoints. The public profile emits an Issuer-backed cert-manager Certificate, external-dns hostname/TTL annotations, TLS Ingress configuration, and an HTTPS application-graph URL.
- Embedded HTML, CSS, client JavaScript, and template literals are analyzed as closure data by the TypeScript-AST free-identifier pass; real unsupported module captures still fail with an actionable diagnostic.
- Final OrbStack Tenant rerun: the generated admin API, CNPG migrations, durable JetStream commands, duplicate suppression, concurrent keyed updates, history/outbox relay, lag observations, and Kubernetes SDK WASM reconcile all succeeded. The Tenant reached `phase: Ready` with `observedGeneration: 1` and `message: Kubernetes SDK observed 1 namespace`.

## Live cleanup evidence

The final OrbStack run used `factory.deleteInstance()` for both the KRO-owned Tenant application and the direct-mode NATS installation. The harness awaited Tenant instance deletion before deleting its RGD, then removed installation-scoped application CRDs and requested deletion of the external test namespace. No KRO finalizer was cleared manually and no KRO-owned resource was deleted out from under its controller.

All run-specific workloads and custom resources were removed. The external Namespace entered `Terminating` with only Kubernetes' own namespace finalizer, matching a pre-existing OrbStack cluster condition affecting numerous historical test namespaces; it was not force-finalized for this evidence. This is cluster hygiene outside the TypeKro ownership boundary, and it does not weaken the application or infrastructure lifecycle assertions above.

TypeKro v0.26.0 can report a late direct-mode 404 when duplicate deployment records refer to resources that the same deletion already removed. The harness does not blindly suppress this: it accepts that diagnostic only after independently proving that every declared NATS Service, StatefulSet, NACK Deployment, and HelmRelease is absent. This is a TypeKro cleanup-diagnostic defect rather than an Applik8s runtime or lifecycle blocker.

## Release blockers

None. TypeKro v0.26.0 contains the required JetStream implementation and is selected by the workspace, public package, adapter, lockfile, generated artifacts, and packed-consumer tests.
