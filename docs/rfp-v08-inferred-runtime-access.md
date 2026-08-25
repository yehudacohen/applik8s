# RFP: Applik8s v0.8 — Inferred Runtime Access and Least-Privilege Lowering

**Status:** Accepted v0.8 implementation contract. This document authorizes implementation, not
release.

**Manifesto:** [`manifesto-v08-portable-stateful-development.md`](manifesto-v08-portable-stateful-development.md)

**Foundation gate:** The stable `graph-provenance` gate must pass before inferred access is considered
safe or complete.

**Foundation dependencies:** v0.7 function-native closure discovery, canonical operation identity,
execution and causal principals, provider-neutral capabilities, application graph provenance, generated
workload boundaries, existing Kubernetes RBAC inference, and the manifesto's Phase 0 identity,
provenance, execution-boundary, and runtime-access operation records

**v0.8 contract integrations:** Portable local/AWS and TypeKro lowerers consume semantic access records;
the application plan explains them; observability correlates denials and policy generations; schedules,
actors, lakehouse, and development tooling register maintained operation descriptors. Those integrations
do not require every provider implementation before inference can be built and tested.

**Unblocks:** Least-privilege local, AWS, and Kubernetes workloads without requiring application authors
to duplicate statically knowable access in explicit IAM/RBAC configuration

## Purpose

Make runtime access a derived, inspectable part of the canonical application graph.

Applik8s already knows when a handler calls a model operation, reads an object, publishes an event,
starts a workflow, configures a schedule, invokes an actor, reads a Kubernetes resource, or consumes a
declared Secret. When the compiler can prove that behavior, authors should not also translate it into
provider-specific permission configuration.

This RFP generalizes the existing Kubernetes resource-helper inference into a provider-neutral contract:

```ts
ImageUploaded.on.create(async image => {
  const source = await Attachments.get(image.objectKey);
  const thumbnail = await resize(source);

  await Thumbnails.put(image.objectKey, thumbnail);
  ThumbnailReady.emit({ imageId: image.id });
});
```

The graph infers that the generated processor requires:

- read access to the qualified `Attachments` object store;
- write access to the qualified `Thumbnails` object store;
- publish access to the `ThumbnailReady` event authority.

The selected provider lowers the same semantic requirements into scoped local credentials, AWS IAM,
Kubernetes RBAC and Secret bindings, or an external-provider access contract. The application does not
repeat those known facts through `permissions: [...]` merely because the deployment target changed.

Inference is not business authorization. A function calling `Document.publish(...)` does not prove that
the current user may publish that document. Canonical operation authority still admits the caller. This
RFP governs which runtime identity can reach the infrastructure needed to attempt an already authorized
operation.

## Required developer experience

Known calls require no permission ceremony:

```ts
const ProcessAttachment = AttachmentUploaded.on.create(async attachment => {
  const bytes = await Attachments.get(attachment.objectKey);
  const result = await Classifier.classify({ bytes });

  await Attachment.update({
    id: attachment.id,
    classification: result.label,
  });

  AttachmentClassified.emit({
    attachmentId: attachment.id,
    label: result.label,
  });
});
```

`applik8s plan` explains the result in semantic terms:

```text
Runtime access for processor ProcessAttachment
  inferred  object.read       Attachments
            from Attachments.get at src/attachments/process.ts:18
  inferred  ai.invoke         Classifier
            from Classifier.classify at src/attachments/process.ts:19
  inferred  model.write       Attachment
            from Attachment.update at src/attachments/process.ts:21
  inferred  event.publish     AttachmentClassified
            from AttachmentClassified.emit at src/attachments/process.ts:27

AWS lowering
  task role process-attachment
    s3:GetObject       arn:aws:s3:::product-attachments/*
    execute-api:Invoke <qualified classifier target>
    database credential identity: attachment-writer
    kinesis:PutRecord  <application event stream>
```

The exact provider action is visible in the deployment plan, but provider actions are not the semantic
source of truth.

When access cannot be proven, compilation fails with an actionable diagnostic:

```text
ACCESS_REQUIREMENT_UNRESOLVED
ProcessAttachment performs a dynamic object-store operation whose target cannot be proven.
Use a typed qualified capability or declare the bounded runtime access requirement explicitly.
```

Explicit permission APIs remain valid for dynamic, external, administrative, or deliberately widened
access. They are the escape hatch and policy boundary, not required duplication of known calls.

## Terminology and authority boundary

This RFP uses **runtime access requirement** for infrastructure reachability granted to a deployed
execution identity.

It does not redefine:

- **application permission** — a typed unit of business authority granted to a principal;
- **operation admission** — the decision that a caller may invoke an application operation on a target;
- **provider credential** — secret or workload identity material used to authenticate to infrastructure;
- **provider policy** — IAM, RBAC, database grants, broker ACLs, or equivalent enforcement emitted from
  runtime access requirements.

Both application authorization and runtime access must succeed. Neither substitutes for the other.

Examples:

| Question | Authority |
| --- | --- |
| May Alice publish Document 42? | Application operation authority |
| May the document processor write to the publication stream? | Inferred runtime access |
| May the Kubernetes operator patch this CR status? | Inferred or explicit Kubernetes runtime access |
| May Builder run a dependency installation command? | Development-daemon command approval, not this RFP |
| May an AWS task read a named secret? | Inferred runtime access lowered to IAM and secret injection |

## Existing foundation

v0.7 already proves narrower forms of this design:

- direct Kubernetes resource helpers infer server RBAC;
- resource lifecycle handlers infer watch and reconciliation access;
- generated finalizers, status writes, leader election, and Events contribute known RBAC;
- `Resource.permissions.read()`, `watch()`, `apply()`, `patch()`, `patchStatus()`, `delete()`,
  `finalize()`, and `manage()` support explicit Kubernetes boundaries;
- the runtime rejects undeclared Kubernetes effects before touching the API;
- application authorization and Kubernetes RBAC are explicitly separate.

v0.8 preserves these contracts and lifts the inference model into the canonical application graph so
that local, AWS, Kubernetes, and external providers consume the same semantic requirements.

## Owned contracts

This RFP owns:

- the provider-neutral runtime access requirement model;
- access semantics attached to known capability operations;
- compiler inference from direct calls, callback closure graphs, generated behavior, and graph edges;
- attribution of requirements to exact execution identities and deployment artifacts;
- static scope extraction, normalization, union, minimization, and provenance;
- explicit-access interaction, widening diagnostics, ceilings, and fail-closed ambiguity;
- provider-lowering inputs and cross-target semantic parity;
- access-plan explanation, diffs, evidence, and least-privilege gates;
- detection of unused, redundant, or unexpectedly broad explicit access;
- runtime preflight against the compiled access manifest where the provider permits it.

This RFP does not own:

- application roles, grants, permissions, or operation admission;
- provider-specific IAM/RBAC resource lifecycle;
- credential generation, storage, or rotation implementation;
- business row-level or tenant authorization;
- arbitrary static analysis of untyped provider SDK calls;
- autonomous widening to wildcard access;
- development-agent command approval;
- a claim that every provider can enforce identical granularity.

## Canonical graph contract

Every inferred or explicit requirement becomes a graph record shaped conceptually as:

```ts
interface RuntimeAccessRequirement {
  id: string;
  consumer: {
    nodeId: string;
    executionIdentity: string;
    artifactId?: string;
  };
  target: {
    capabilityId: string;
    qualification?: string;
    operation: RuntimeAccessOperation;
    scope: RuntimeAccessScope;
  };
  origin: "inferred" | "explicit" | "framework" | "provider-required";
  provenance: readonly SourceProvenance[];
  sensitivity: "public" | "internal" | "credential";
  enforcement: "required" | "best-effort" | "application-only";
}
```

The semantic operation vocabulary is provider neutral. Initial families include:

```text
model.read             model.write            model.delete
object.list            object.read             object.write          object.delete
event.subscribe        event.publish
queue.consume          queue.publish
workflow.invoke        workflow.admin
schedule.configure     schedule.unschedule    schedule.admit         schedule.invoke
actor.invoke           actor.connect          actor.broadcast       actor.admin
ai.invoke              search.read             search.write
secret.read            connection.use
kubernetes.get         kubernetes.list         kubernetes.watch
kubernetes.create      kubernetes.patch        kubernetes.status
kubernetes.finalize    kubernetes.delete
network.connect        telemetry.write
```

The vocabulary is versioned. Packages cannot create arbitrary near-duplicate operation strings. A new
public capability operation must declare its access semantics or explicitly declare that it introduces
no separate runtime access.

Graph records contain no credential values, bearer tokens, connection strings, private endpoints, or
provider-generated secret data.

## Known operation semantics

Each maintained capability handle declares access semantics alongside its callable contract:

```text
ObjectStorage.get      -> object.read
ObjectStorage.put      -> object.write
ObjectStorage.delete   -> object.delete
Event.emit             -> event.publish
Event.on                -> event.subscribe
Queue.send              -> queue.publish
Queue.on                -> queue.consume
Model.get/query         -> model.read
Model.create/edit       -> model.write
Model.delete            -> model.delete
Workflow.start          -> workflow.invoke
ScheduledClosure(...)          -> schedule.invoke
ScheduledClosure.schedule      -> schedule.configure
ScheduledClosure.unschedule    -> schedule.unschedule
Actor.command/message   -> actor.invoke
Actor.connection        -> actor.connect
Actor.broadcast         -> actor.broadcast
Search.query            -> search.read
Search.project          -> search.write
```

The declaration can derive scope from:

- the qualified capability binding;
- a statically known model, event, queue, actor, workflow, bucket, stream, or Secret identity;
- literal names and prefixes accepted by a typed operation;
- a closed selector or namespace set;
- profile and target bindings known during planning;
- framework-generated resources and lifecycle behavior.

Runtime input values such as a tenant ID or object key do not become infrastructure authorization by
magic. When the provider cannot enforce that granularity, application authorization remains responsible
for the business boundary and the access plan states the provider enforcement scope truthfully.

## Inference algorithm

The compiler performs inference after canonical handle discovery and before deployment lowering:

1. Discover each executable boundary: server route, processor, projection, workflow worker, schedule
   runner, actor runtime, reconciler, migration, job, agent tool receiver, application host, and generated
   helper.
2. Traverse the complete statically supported closure graph, including imported local helpers.
3. Resolve direct typed handle calls to canonical graph identities.
4. Ask each operation contract for its semantic access requirement and statically knowable scope.
5. Add framework-owned requirements for generated behavior such as health, checkpointing, outbox,
   migrations, status, finalizers, leader election, secret injection, and telemetry.
6. Attach every requirement to the execution identity that performs the action.
7. Normalize, union, and minimize requirements without losing provenance.
8. Compare inferred requirements with explicit declarations, organizational ceilings, and target
   capabilities.
9. Fail closed for unresolved access, unsupported scope, ambiguous targets, or prohibited widening.
10. Supply the canonical requirements to local, AWS, Kubernetes, or external provider lowerers.

Inference is based on canonical expression provenance, not arbitrary black-box re-execution or method-name
string matching. The compiler must not infer `object.write` merely because an unrelated function is named
`put`.

### Callback and helper closure completeness

Calls made through supported application-local helpers are included:

```ts
async function storeThumbnail(key: string, bytes: Uint8Array) {
  await Thumbnails.put(key, bytes);
}

ImageUploaded.on.create(async image => {
  await storeThumbnail(image.objectKey, await render(image));
});
```

If the compiler cannot prove the helper graph, it rejects inference for the affected boundary rather
than silently omitting access. This requirement builds on the v0.7 recursive closure-discovery contract.

### Generated and indirect behavior

Framework-generated behavior contributes requirements even when it does not appear as an authored call.
Examples include:

- a projection subscribing to its source and writing to its destination;
- a migration reading schema metadata and writing model storage;
- a workflow worker polling and acknowledging its provider;
- a scheduler creating provider definitions, admitting an occurrence, and invoking its managed closure;
- an actor runtime loading state, committing an outbox, and scheduling alarms;
- a Kubernetes reconciler watching a primary resource and patching status;
- a gateway reading an exact cursor-signing Secret;
- a server exporting telemetry to a configured collector.

These requirements use origin `framework` and point to the public declaration that caused the generated
behavior.

## Explicit access and policy ceilings

Existing explicit permission APIs remain supported. They serve four cases:

1. **Dynamic scope:** the target cannot be statically resolved but can be bounded explicitly.
2. **External entrypoint:** another system needs access without an authored outbound call.
3. **Administrative behavior:** inspection, repair, migration, or cleanup access is deliberately broader
   than the golden path.
4. **Raw provider integration:** an approved provider SDK escape hatch supplies a reviewed access
   contract.

Explicit access is additive unless a policy ceiling says otherwise. It does not suppress a requirement
that the compiler proved is needed. An application or organization may define a maximum boundary that
both inferred and explicit requirements must remain within.

The plan distinguishes:

- exact inferred access;
- exact explicit access;
- redundant explicit access already covered by inference;
- unused explicit access with no discovered consumer;
- widening beyond inferred access;
- wildcard or provider-administrative access;
- access the selected provider cannot enforce precisely.

Wildcards, account-wide access, cluster-wide access, unrestricted secret reads, and administrative
provider actions require an explicit declaration and visible approval. The compiler never repairs an
unresolved requirement by emitting `*`.

## Execution identity and workload partitioning

Requirements attach to the smallest independently deployable execution identity, not to one global
application role.

Separate workers receive separate credentials when they have different requirements. For example:

```text
web application      model.read, operation.invoke
upload verifier      object.read, model.write, event.publish
search projection    event.subscribe, search.write
migration job        model.admin for one schema boundary
operator             exact Kubernetes watch/status/finalizer access
```

Artifact grouping may intentionally combine compatible handlers. The compiled access set is then the
union of handlers placed in that artifact, and the plan explains the union. Placement optimization may
not silently broaden credentials beyond the declared policy ceiling.

Leader followers, replicas, and replacement generations share a logical workload identity only when the
provider's identity contract supports it. Persisted deployment state records the exact policy digest
used by each generation.

### Componentized WASM guest/host enforcement

Captured TypeScript closures execute across ComponentizeJS, a versioned WIT world, Wasmtime, and the Rust
host. The guest/host boundary therefore carries a versioned runtime-access envelope containing:

- canonical application, operation, execution, artifact, and attempt identities;
- the digest and version of the admitted runtime-access requirement set;
- bounded capability/effect identifiers needed for the invocation; and
- causal and authorization receipt references without embedding credential values.

The Rust host validates that the envelope matches the deployed artifact and current access plan before it
performs a host-mediated Kubernetes or provider effect. Framework-generated status, Event, finalizer,
Lease, checkpoint, telemetry, and output effects retain explicit `framework` provenance rather than being
charged to an unrelated authored call.

A guest that performs direct network I/O still requires a proven `network.connect` or bounded provider
requirement enforced by the selected runtime/network layer. Componentization cannot become a bypass that
inherits the host's deployment credentials or broad network reachability. When a provider cannot enforce
the requested granularity, the application plan reports the larger physical scope and the semantic
requirement remains intact.

Host denial, stale artifact/access digest, unknown capability, and missing identity fail before the effect
and return a typed actionable diagnostic correlated to the logical invocation. No access envelope,
diagnostic, trace, or plan contains Secret values or bearer credentials.

## Provider lowering

The canonical graph records semantic need. Provider packages own physical enforcement.

### Local

The local supervisor issues capability-scoped runtime bindings and credentials where supported. It
prevents one generated process from receiving every project secret or provider endpoint merely because
they exist in `.env`.

Local enforcement may use separate database roles, broker credentials, scoped object-store credentials,
signed internal operation tokens, and process environment allowlists. When a local provider cannot
enforce a semantic scope, the plan marks that limitation.

### AWS

AWS lowerers map requirements to least-privilege task roles, resource policies, security-group egress,
database identities, broker policies, and exact Secrets Manager access.

AWS API transport is modeled independently from IAM authority. A workload is privately network-qualified
only when every required AWS API action has an explicit compatible VPC endpoint, every interface endpoint
has an exact endpoint SecurityGroup admitting only the consuming workload SecurityGroups, and every gateway
endpoint is reached through its service-managed prefix list. Framework-owned ECS image, log, object-layer,
and Secret bootstrap transports are recorded separately from application operations. An unsupported service
or missing endpoint leaves the workload unqualified; it is never translated into public/NAT or `0.0.0.0/0`
egress. Endpoint policy and IAM remain separate enforcement layers, and exact task-role authorization is still
required even when the network path is private.

Examples include:

- `object.read` -> `s3:GetObject` on the selected bucket/prefix;
- `object.write` -> bounded S3 write and multipart actions where the runtime requires them;
- `event.publish` -> Kinesis write actions on the selected stream;
- `queue.consume` -> SQS receive/delete/visibility actions on the selected queue;
- `secret.read` -> exact `secretsmanager:GetSecretValue` resource identities;
- `telemetry.write` -> exact actions and network access used by the selected OpenTelemetry/CloudWatch
  export path;
- `network.connect` -> security-group and service-connect edges rather than an IAM fiction.

AWS provider actions needed solely to create infrastructure belong to the Alchemy deployment identity,
not application task roles.

### Kubernetes

Kubernetes lowering preserves existing RBAC behavior and expands it from the canonical requirement
records. Namespaced, cluster-scoped, cross-namespace, named-resource, status, finalizer, event, Lease,
Secret, and connection-only access remain distinct.

Kubernetes RBAC is emitted per ServiceAccount/workload boundary where practical. Connection-only access
does not invent management-cluster RBAC. NetworkPolicy and provider credentials remain separate
enforcement mechanisms, both derived from the same graph where applicable.

Standard `networking.k8s.io/v1` NetworkPolicy is used only for exact namespace/pod-selector/port peers. Exact
external DNS-name egress requires a target-observed FQDN-capable provider. The maintained Cilium lowering is
selected only when the target has an established `CiliumNetworkPolicy` v2 CRD, a fully ready Cilium agent
fleet, and an explicitly enabled L7 proxy. It emits exact `toFQDNs.matchName` rules plus trusted cluster-DNS
proxy rules required to populate Cilium's per-endpoint FQDN cache. The DNS proxy may observe arbitrary query
names because DNS is framework bootstrap traffic; only declared exact FQDNs receive application data egress.
Missing or unreadable target capability leaves the workload unqualified rather than widening it to a CIDR.
This follows Cilium's documented requirement that `toFQDNs` be paired with an L7 DNS rule:
<https://docs.cilium.io/en/stable/security/policy/layer7/#dns-policy-and-ip-discovery>.

### External providers

An external binding may supply credentials or a workload identity whose policy is owned outside the
application deployment. Applik8s still records the required semantic access and verifies declared
compatibility where possible.

The plan must not claim least-privilege enforcement merely because an external credential works. It
reports whether access is:

- verified exactly;
- verified only at capability level;
- externally attested;
- not introspectable.

## Secrets and connection material

Using a declared Secret or provider connection infers access to its exact reference, not its value.

The graph may contain:

- secret authority and logical identity;
- consumer workload;
- required keys by schema;
- rotation dependency;
- provider lowering and ownership.

It may not contain secret values. Plans, artifacts, logs, Alchemy state, Builder context, and operations
evidence preserve the existing redaction contract.

A whole-environment secret grant is never inferred. `.env` remains a source from which the selected
secret authority receives only declared keys.

## Dynamic and raw provider access

The following fail inference unless accompanied by a bounded explicit requirement:

- computed capability lookup such as `providers[name]`;
- raw AWS, Kubernetes, database, broker, or object-store clients not wrapped by a known contract;
- dynamically constructed resource kinds, API groups, bucket names, stream names, or secret names;
- reflection that chooses an operation by user-controlled string;
- code loaded after compilation;
- opaque native modules that perform external access.

Provider packages may expose a typed escape hatch that carries both execution code and a semantic access
descriptor. The descriptor is reviewed and tested as provider API; it is not a free-form policy string.

## Plan, explain, and operations evidence

The compiler and deployment plan expose:

- access requirements grouped by workload and execution identity;
- semantic operation and target;
- inferred, framework, provider-required, or explicit origin;
- every contributing source location or declaration;
- provider policy diff;
- enforcement fidelity and known gaps;
- policy digest and last deployed digest;
- newly added, removed, broadened, and narrowed access;
- unused or redundant explicit permissions;
- wildcard and administrative warnings.

The operations UI can answer:

```text
Why can this workload read this bucket?
What source change added this IAM action?
Which handlers share this ServiceAccount?
Why does this external credential exceed the inferred requirement?
What will stop working if this permission is removed?
```

Removal is treated as a deployment change. The provider converges the policy before or with workloads in
an order that avoids using a new generation with stale, broader credentials longer than necessary.

## Runtime enforcement and drift

Where an Applik8s host mediates the effect, it validates the attempted operation against the compiled
access manifest before contacting the provider. Provider enforcement remains authoritative even when a
host preflight exists.

The deployment runtime detects:

- provider policy drift from the desired policy digest;
- a workload running with a stale policy generation;
- an external credential whose attestation no longer satisfies the requirement;
- runtime attempts not represented in the manifest;
- inferred access that no longer has a live consumer.

Runtime denial surfaces the semantic operation, execution identity, target, policy generation, and
actionable recovery without logging credentials or sensitive payloads.

## Compatibility and schema evolution

The runtime access vocabulary, graph codec, and provider-lowering contract are versioned. A new framework
release may improve inference and therefore add or remove desired permissions without application source
changes.

Upgrade planning must display those changes before apply. A newly inferred broad permission cannot be
silently deployed because the compiler became more capable.

Persisted manifests retain enough provenance to distinguish:

- application source changes;
- framework inference changes;
- provider lowering changes;
- physical provider-policy drift.

Provider packages declare the inference/lowering contract versions they implement. Unsupported
combinations fail before deployment.

## Security requirements

- Application authorization and runtime access remain independent gates.
- Inference never treats a caller-controlled value as proof of authority.
- Unknown or ambiguous access fails closed.
- Wildcards and administrative policies are never inferred as a fallback.
- Secret values never enter graph or policy provenance.
- Cross-tenant runtime identities cannot collide through normalization.
- Source provenance cannot be forged by generated provider output.
- One workload cannot inherit another workload's credentials through artifact caching or placement.
- Policy removal and replacement use stable resource identity and interruption-safe ordering.
- External access is not labeled least privilege without evidence.

## Implementation increments

### Increment 1 — Semantic access graph

- Define the versioned operation vocabulary and graph records.
- Freeze and test the componentized WASM guest/host runtime-access envelope and artifact binding.
- Lift existing Kubernetes inference into canonical provenance records.
- Attach requirements to execution identities and artifacts.
- Add plan/explain output and graph serialization.

### Increment 2 — Maintained capability registry

- Add access semantics to models, objects, events, queues, schedules, workflows, actors, search, AI, connections,
  secrets, and telemetry.
- Infer through supported local helper closure graphs.
- Add framework-generated requirements and fail-closed dynamic diagnostics.

### Increment 3 — Local and Kubernetes lowering

- Issue capability-scoped local bindings and environment allowlists.
- Lower canonical records to existing and expanded Kubernetes RBAC/Secret/NetworkPolicy contracts.
- Prove parity with current explicit Kubernetes APIs.

### Increment 4 — AWS lowering

- Lower requirements into workload IAM, resource policy, network, secret, database, Kinesis, SQS, and S3
  enforcement.
- Separate deployment identity permissions from runtime task permissions.
- Add policy diff, drift, replacement, and interruption evidence.

### Increment 5 — Explicit access, ceilings, and external evidence

- Diagnose widening, redundancy, unused declarations, and wildcards.
- Add organizational/application ceilings.
- Add external binding attestations and enforcement-fidelity reporting.

### Increment 6 — Product and conformance qualification

- Update Agentic Start, Chirp, and GuestBook to remove redundant permission ceremony where inference is
  complete.
- Run adversarial compiler, local, AWS, and Kubernetes suites.
- Publish policy-size, compile-time, cold-start, and least-privilege evidence.

## Required gates

### Compiler and provenance

- Every maintained capability operation either declares access semantics or explicitly declares none.
- Direct calls and calls through supported imported local helpers produce identical requirements.
- Generated behavior records the authored declaration that caused it.
- Ambiguous targets, computed operation access, and unsupported raw SDK use fail closed.
- Inference is deterministic across machines and source traversal order.
- ComponentizeJS/WIT/Wasmtime/Rust fixtures preserve application, operation, execution, artifact, attempt,
  requirement-set, and provenance identity through host effects and typed denials.

### Workload isolation

- Separate workloads do not receive the application-wide union of permissions.
- Artifact grouping reports and tests the exact union it introduces.
- Replicas and rolling generations receive the intended policy digest.
- Removing one handler removes only access no remaining colocated handler requires.

### Kubernetes

- Namespaced, cluster, cross-namespace, named-resource, status, finalizer, Event, Lease, Secret, and
  connection-only cases lower correctly.
- Runtime preflight rejects an undeclared effect before contacting Kubernetes.
- Explicit permission APIs and inferred equivalents have semantic parity.
- Live denial, policy update, narrowing, restart, and teardown are exercised.

### AWS

- S3, Kinesis, SQS, Secrets Manager, RDS access, telemetry, and network edges lower from semantic
  requirements with no application-authored IAM.
- Runtime task roles exclude Alchemy deployment actions.
- Resource identifiers and prefixes are scoped where statically known.
- Policy update, interrupted replacement, drift repair, narrowing, and deletion pass in a real acceptance
  account.
- AWS-local validates policy construction but does not substitute for real IAM evidence.

### Explicit and dynamic access

- Bounded explicit access resolves an otherwise rejected dynamic case.
- Wildcard and administrative access require explicit review and cannot arise from inference.
- Redundant and unused explicit access produce actionable diagnostics.
- A configured ceiling rejects both inferred and explicit widening.

### Authorization separation

- Infrastructure access does not let an unauthorized application principal invoke an operation.
- Application authorization does not conceal a missing runtime-access policy.
- Actor, workflow, agent, event, HTTP, browser, and reconciler calls preserve immediate and causal
  principal behavior while using their own execution credentials.

### Secrets and supply chain

- Secret canaries remain absent from graphs, policies, plans, logs, state, images, and Builder context.
- Guest/host envelopes contain identity and requirement digests but never credential values, connection
  strings, raw principals, or provider-generated secret data.
- Clean package consumers receive the same deterministic access manifest.
- Provider-lowering packages are version pinned and policy changes are attributable.

### Performance and limits

- Inference adds a bounded, historically tracked compile-time cost.
- Policy minimization stays within provider document and attachment limits or fails with a useful
  partitioning diagnostic.
- Large closure graphs do not produce quadratic permission analysis.

## Non-goals

- Inferring application roles or user grants from call sites.
- Proving arbitrary JavaScript or raw SDK behavior through whole-program analysis.
- Generating wildcard access so an application happens to run.
- Making IAM, Kubernetes RBAC, database grants, and broker ACLs appear semantically identical.
- Encoding tenant row-level authorization into infrastructure policies when the provider cannot enforce
  it.
- Replacing explicit access for external callers, administration, or genuinely dynamic behavior.
- Letting the development agent inherit application runtime access.
- Treating successful provider authentication as evidence of least privilege.

## Closed v0.8 decisions

- Known typed capability calls infer runtime access by default.
- Runtime access is distinct from application authorization and both are enforced.
- Requirements live in the canonical application graph with source provenance.
- Requirements attach to the smallest independently deployable execution identity.
- Componentized WASM guests and the Rust host exchange a versioned identity/requirement envelope and
  cannot use componentization to inherit undeclared host credentials or network access.
- Provider-neutral semantic operations lower to provider-specific policy.
- Existing explicit permission APIs remain supported for dynamic, external, administrative, and escape-
  hatch cases.
- Unknown access fails planning; wildcard fallback is prohibited.
- Framework-generated behavior contributes visible requirements.
- Secret references may be inferred; secret values never enter the graph.
- Local, AWS, Kubernetes, and external plans report enforcement fidelity truthfully.
- Compiler and provider inference changes appear as deployment policy diffs during upgrades.

## Definition of done

This RFP is complete when Agentic Start, Chirp, and GuestBook can use maintained typed capability calls
without duplicating statically knowable runtime permissions; the canonical graph attributes exact access
to each execution identity; local, AWS, and Kubernetes lowerers produce bounded least-privilege evidence;
dynamic and raw access fail closed or use reviewed explicit declarations; application authorization
remains independent; and live denial, update, narrowing, drift, interruption, secret, and teardown gates
pass without wildcard fallback or credential leakage.
