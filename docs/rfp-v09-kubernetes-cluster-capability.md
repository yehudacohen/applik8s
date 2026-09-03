# RFP: Kubernetes Cluster Capability and Injection

**Status:** Accepted for implementation; architecture frozen on 2026-08-30

**Audience:** Applik8s maintainers, operator authors, provider authors, deployment integrators, and security reviewers

**Revised:** 2026-08-30

**Target:** Applik8s v0.9; stable 1.0 candidate after local and remote-cluster conformance

**Depends on:** Capability DI, existing operator Kubernetes connection bindings, runtime-access inference,
Secret/config bindings, network policy, the External Capability Bindings RFP, and `ApplicationPlan`

**Unblocks:** Portable reconcilers, multi-cluster application behavior, cluster-backed providers, and
replaceable Kubernetes destinations without ambient kubeconfig

## Executive summary

Kubernetes is a capability an application may consume, not an ambient global hidden in a process. v0.8
already supports named Kubernetes connections in generated operators. v0.9 promotes that machinery into
application-level DI so Jobs, workflows, agents, servers, processors, and reconcilers can depend on one
typed logical cluster handle.

The capability does not inject an unrestricted raw client. It records exact API groups, resources, verbs,
namespaces or cluster scope, endpoint/network policy, credentials, mutation ownership, and audit. Managed
closures call the imported handle directly; the compiler lowers those calls through a host-mediated
adapter suitable for Node, generated workers, and componentized/WASM handlers.

## At a glance

```ts title="src/providers.ts"
export const Destination = KubernetesCluster.named("destination");

application.provide(
  Destination,
  KubernetesCluster.external({
    kubeconfig: secret.env("DESTINATION_KUBECONFIG"),
    context: config.env("DESTINATION_CONTEXT"),
    endpointPolicy: ProductionClusterPolicy,
  }),
);
```

Consumer code imports the logical handle:

```ts title="src/replication.ts"
export const ReplicateWorkload = application.job(
  "workloads.replicate.v1",
  ReplicationContract,
  async input => {
    const deployment = await Destination.resources(Deployment).get({
      namespace: input.namespace,
      name: input.name,
    });

    await Destination.resources(Deployment).apply(
      destinationDeployment(deployment),
      { fieldManager: "workload-replicator" },
    );
  },
);
```

## Normative decisions

1. `KubernetesCluster.named(name)` defines logical capability identity; `application.provide(...)` selects
   its provider-specific implementation.
2. Application source imports and calls the handle directly. It does not read ambient kubeconfig or
   receive a global unrestricted Kubernetes client.
3. Existing `context.kubernetes.connection(alias)` operator declarations lower to the same capability
   identity and authority model. They remain a compatibility adapter, not a second DI system.
4. Every operation declares or infers API group, resource, verb, namespace/cluster scope, endpoint,
   credential, mutation ownership, and audit requirements.
5. Dynamic GVK/resource access is available only through an explicitly declared bounded capability; it
   never widens inferred access silently.
6. Runtime adapters are host-mediated. Closure serialization must not embed ambient credentials, Node-only
   transports, or an unrestricted client into WASM.
7. Cluster implementation lifecycle follows the External Capability Bindings contract. An external
   cluster contributes no cluster infrastructure. A managed cluster uses native Alchemy resources for its
   non-Kubernetes control plane; every Namespace, CRD, operator, Helm release, workload, Service, policy,
   or other object installed through its Kubernetes API is composed with TypeKro and deployed through
   TypeKro's Alchemy integration.
8. Replacing cluster identity, endpoint trust, credential authority, or mutation ownership is a migration.
9. Cluster access is an explicit portability constraint on only the executions that use it.
10. v0.9 qualifies the current/local cluster contract. A genuinely independent external-cluster binding
    remains beta until a second credential and control-plane boundary proves isolation, replacement, and
    lifecycle behavior; pointing two bindings at one context is useful parity evidence, not remote-cluster
    qualification. Broad multi-cloud cluster provisioning is not in scope.
11. A cluster implementation/reference is a composable implementation dependency. Operator, Actor,
    managed-store, and other providers may accept it directly without making cluster access visible to
    their application callbacks; explicit callback access still requires providing and using the cluster
    capability itself.

## Cluster implementation values

The cluster capability and its implementations use the same algebra as every other provider:

```ts
const currentCluster = KubernetesCluster.current();

const destinationCluster = KubernetesCluster.external({
  endpoint: config.env.url("DESTINATION_KUBERNETES_ENDPOINT"),
  credentials: secret.env("DESTINATION_KUBERNETES_CREDENTIALS"),
});
```

`external(...)` accepts exactly one of two mutually exclusive configuration forms:

```ts
interface KubernetesExternalClusterCommon {
  namespace?: ConfigBinding<string>;
  endpointPolicy?: KubernetesEndpointPolicy;
}

type KubernetesCredentialContract =
  | { version: "v1"; kind: "bearerToken"; keys: { token: "token"; ca?: "ca.crt" } }
  | {
      version: "v1";
      kind: "clientCertificate";
      keys: { certificate: "client.crt"; privateKey: "client.key"; ca: "ca.crt" };
    };

type KubernetesExternalClusterConfig = KubernetesExternalClusterCommon & (
  | {
      kubeconfig: SecretBinding<{ version: "v1"; keys: { kubeconfig: "kubeconfig" } }>;
      context?: ConfigBinding<string>;
      endpoint?: never;
      credentials?: never;
    }
  | {
      endpoint: ConfigBinding<URL>;
      credentials: SecretBinding<KubernetesCredentialContract>;
      kubeconfig?: never;
      context?: never;
    }
);
```

There is no precedence rule or implicit conversion between the forms. `kubeconfig` contains the endpoint,
trust, credential, and optional context authority in one Secret contract. The endpoint form separates the
public endpoint from a versioned credential/trust Secret contract. Common fields such as `namespace` and
`endpointPolicy` remain available in both forms.

`current()` denotes the deployment-host cluster only when the selected profile explicitly constructs that
implementation value. The authorized deployment host resolves its credential and endpoint binding, but an
environment/configuration-source flag cannot select `current()` or replace another cluster implementation.
It does not provision a cluster or expose ambient kubeconfig to application code. `external(...)` binds an
existing cluster and owns none of its control plane. A managed cloud-cluster implementation may contribute
its non-Kubernetes control plane through native Alchemy resources, but Kubernetes objects installed into
the resulting cluster remain TypeKro compositions deployed through TypeKro's Alchemy integration.

Either implementation value may be passed privately into `OperatorRuntime.kubernetes({ cluster })`,
`ActorRuntime.celld({ cluster })`, a Kubernetes-backed managed store, or another higher-level provider.
Providing the cluster under a named capability token is necessary only when application behavior itself
uses the cluster or when multiple higher-level implementations should refer to one independently selected
binding.

## Public capability

The handle exposes typed resource families and bounded discovery:

```ts
Destination.resources(Deployment).get(identity)
Destination.resources(Deployment).list(query)
Destination.resources(Deployment).watch(query, { from, timeout: "20s", maxEvents: 100 })
Destination.resources(Deployment).apply(value, ownership)
Destination.resources(Deployment).patch(identity, patch, ownership)
Destination.resources(Deployment).delete(identity, preconditions)
```

Typed definitions are preferred. Generic API discovery or arbitrary GVK use requires an explicit
capability declaration naming allowed groups/resources/verbs and bounded list/watch policy. Paginated
lists always resolve or reject within the execution deadline and preserve continuation semantics.

Direct `watch(...)` is a bounded watch window returning typed events plus the next resource version; it is
not an immortal socket or background callback hidden inside a closure. Continuous application behavior
uses `Resource.on.reconcile`, declared event sources, or another lifecycle-owned subscription. This keeps
Jobs, workflows, request handlers, and WASM invocations finite and restartable.

The handle may expose server version and qualified discovery facts, but credentials, raw transports, and
provider-private clients are never serializable application values.

## Versioned host ABI

Node and componentized/WASM executions use one logical protocol. The TypeScript handle is a generated
proxy that emits a versioned request; it does not serialize `@kubernetes/client-node`, kubeconfig, TLS
state, sockets, or provider credentials into the closure.

```ts
interface KubernetesCapabilityRequest {
  protocol: "applik8s.kubernetes-capability/v1alpha1";
  bindingId: string;
  operationId: string;
  resource: {
    group: string;
    version: string;
    kind: string;
    plural: string;
    scope: "namespaced" | "cluster";
    schemaDigest?: string;
  };
  operation:
    | { kind: "get"; identity: KubernetesIdentity }
    | { kind: "list"; query: KubernetesListQuery; page: KubernetesPageRequest }
    | { kind: "watch"; query: KubernetesListQuery; from?: string; maxEvents: number }
    | { kind: "apply"; value: JsonObject; ownership: KubernetesMutationOwnership }
    | { kind: "patch"; identity: KubernetesIdentity; patch: JsonValue; ownership: KubernetesMutationOwnership }
    | { kind: "delete"; identity: KubernetesIdentity; preconditions: KubernetesDeletePreconditions };
  deadlineUnixMs: number;
  authorityReceipt: string;
  causalContext: string;
  traceContext?: string;
}
```

The response is a versioned success or stable typed failure envelope. Required failure classes include
not-found, conflict, forbidden, unavailable, deadline, cancelled, response-limit, continuation-invalid,
schema-mismatch, and provider-protocol-incompatible. Raw provider payloads are redacted evidence, not the
public error contract.

The host resolves `bindingId` to credentials and endpoint policy, revalidates the operation against the
compiled runtime-access manifest, applies cancellation/deadline/response-size limits, invokes the
Kubernetes API, validates the response schema when declared, and records an audit receipt. A Node host may
use `@kubernetes/client-node`; a WASM host may use a Rust/native client. Both must pass the same protocol
suite and return identical semantic envelopes.

List continuation tokens are integrity-protected and scoped to binding, resource, normalized query,
authority/trusted-context digest, and expiry. They never expose raw provider credentials or allow a caller
to widen selectors. Required references fail when a producer is absent; optional references resolve to
typed absence rather than proxy-shaped `{}` values.

Portable limits are explicit: page size, maximum pages/items/bytes, watch events, watch duration, and
overall execution deadline. The host must always resolve or reject; transport loss cannot leave the
managed closure suspended indefinitely.

## Authority and access lowering

The compiler takes the exact union of statically reachable cluster operations for each execution. The
runtime adapter enforces the same contract independently of generated Kubernetes RBAC.

For in-cluster execution, deployment lowers access to the minimum Role/ClusterRole and network policy. For
an external endpoint, deployment binds only the selected Secret keys, endpoint hosts/ports, TLS trust, and
egress. Cross-namespace or cluster-scoped access is explicit and plan-visible.

Mutation operations require ownership policy such as a field manager, expected UID/resource version, or
provider-specific compare-and-set. The framework does not infer ownership merely from permission to call
an API verb.

## Existing operator compatibility

Existing operator manifests may continue to declare connection aliases. During compilation each alias is
normalized to a `KubernetesCluster` capability identity. Generated handler context hydrates a compatibility
view over that same handle.

The graph, authority, RBAC/network lowering, and audit receipt are singular. A connection alias and an
imported handle resolving to the same logical cluster cannot create two credential authorities or combine
their permissions accidentally.

## Lifecycle and migration

An external cluster binding has lifecycle `external`: Applik8s never creates, adopts, upgrades, or deletes
the cluster. It may create application-owned workloads in that cluster only through declared operations.

A managed implementation may provision a cluster control plane, network, IAM, and related cloud resources
through native Alchemy resources and then expose the same runtime adapter. Any bootstrap or application
resources installed through that cluster's Kubernetes API use TypeKro; direct Alchemy construction of
Kubernetes objects is not a second supported path. Cluster deletion remains separately authorized and
follows the deployment contributor's lifecycle; deleting one application consumer does not imply deleting
a shared cluster.

Provider replacement records source and destination cluster identities, affected consumers, credential
and endpoint changes, owned remote resources, required cutover, rollback, and orphan policy.

## Graph, plan, and diagnostics

The graph records logical cluster identity, consumers, resource operations, authority, mutation ownership,
and portability constraints. The plan records implementation, endpoint identity, credential binding,
allowed APIs/scopes, network access, lifecycle ownership, remote resource ownership, migration, maturity,
and evidence.

Required diagnostics include:

- `KUBERNETES_CLUSTER_BINDING_MISSING`
- `KUBERNETES_CLUSTER_AUTHORITY_UNDECLARED`
- `KUBERNETES_CLUSTER_SCOPE_UNBOUNDED`
- `KUBERNETES_CLUSTER_ENDPOINT_FORBIDDEN`
- `KUBERNETES_CLUSTER_MUTATION_OWNERSHIP_REQUIRED`
- `KUBERNETES_CLUSTER_LIST_UNBOUNDED`
- `KUBERNETES_CLUSTER_MIGRATION_REQUIRED`
- `KUBERNETES_CLUSTER_PROTOCOL_INCOMPATIBLE`
- `KUBERNETES_CLUSTER_RESPONSE_LIMIT`
- `KUBERNETES_CLUSTER_CONTINUATION_INVALID`

## Acceptance

- The same Job or reconciler source runs against the current cluster and an external cluster binding.
- A managed EKS plan uses native Alchemy resources for EKS, VPC, IAM, and related cloud control-plane
  infrastructure, while all in-cluster objects appear as TypeKro compositions deployed through Alchemy.
- The plan rejects direct Alchemy Kubernetes-object contributors and TypeKro-authored cloud control-plane
  resources with `DEPLOYMENT_IMPLEMENTATION_BOUNDARY_VIOLATION`.
- Existing operator connection aliases and imported handles lower to one capability identity and identical
  authority.
- A closure receives only the API operations and namespaces it declared.
- Namespaced, cross-namespace, and cluster-scoped access lower correctly and fail closed when undeclared.
- Paginated generic list/read operations obey cancellation and deadlines.
- Bounded watch windows resume from their returned resource version, reject expired/compacted versions
  explicitly, and cannot become hidden long-lived closure state.
- Remote credentials and clients do not enter serialized closures, graphs, plans, status, or logs.
- External cluster deletion never occurs when an application consumer is removed.
- A cluster replacement produces a migration plan and does not silently orphan remotely owned resources.
- Node and componentized/WASM execution pass the same host-mediated capability conformance suite.
- Golden protocol fixtures are replayed against the Node and WASM hosts for every request, response,
  failure, pagination, cancellation, size-limit, and authority case.

## Non-goals

- ambient kubeconfig;
- unrestricted raw client injection;
- arbitrary unbounded GVK access;
- broad managed-cluster or multi-cloud parity;
- treating Kubernetes as mandatory for Applik8s applications;
- making permission equivalent to mutation ownership;
- silently deleting remote resources during provider replacement.

## Definition of done

The cluster capability is ready when every consuming execution uses one typed logical handle, existing
operator connections converge onto the same identity, access and ownership remain exact, external cluster
lifecycle is untouched, and current plus remote cluster conformance passes across supported execution
runtimes.
