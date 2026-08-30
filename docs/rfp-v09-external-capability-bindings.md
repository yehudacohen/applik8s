# RFP: External Capability Bindings

**Status:** Accepted for implementation; architecture frozen on 2026-08-30

**Audience:** Applik8s maintainers, provider authors, Start authors, deployment integrators, and security reviewers

**Revised:** 2026-08-30

**Target:** Applik8s v0.9; stable 1.0 candidate after provider and lifecycle conformance

**Depends on:** Capability DI, provider qualification, runtime-access inference, Secret/config bindings,
`ApplicationPlan`, TypeKro's Alchemy integration, and native Alchemy deployment resources

**Unblocks:** Externally managed databases, analytics, search, clusters, queues, object stores, identity,
inference, and application-specific provider implementations

## Executive summary

An Applik8s capability is a semantic dependency, not proof that Applik8s owns its infrastructure. The same
`TransactionalDatabase.named("primary")` may be implemented by a database installed into Kubernetes with
TypeKro and deployed through Alchemy, by a non-Kubernetes database provisioned with native Alchemy
resources, by a database installed by a platform team, or by a hosted service described only by validated
connection parameters and Secrets.

This RFP freezes one provider anatomy for both managed and external implementations:

```text
semantic implementation
runtime adapter
optional deployment contributor
readiness observer
lifecycle classification
migration contract
```

External bindings supply runtime behavior and truthful readiness while contributing no infrastructure and
owning no external lifecycle. Application source calls the same typed capability either way.

## At a glance

```ts title="src/providers.ts"
export const PrimaryDatabase = TransactionalDatabase.named("primary");
export const AnalyticsDatabase = AnalyticalDatabase.named("analytics");

application.provide(
  PrimaryDatabase,
  Database.externalPostgres({
    host: config.env("POSTGRES_HOST"),
    port: config.env.integer("POSTGRES_PORT", { default: 5432 }),
    database: config.env("POSTGRES_DATABASE"),
    user: secret.env("POSTGRES_USER"),
    password: secret.env("POSTGRES_PASSWORD"),
    tls: { mode: "verify-full", ca: secret.env("POSTGRES_CA") },
  }),
);

application.provide(
  AnalyticsDatabase,
  Analytics.externalClickHouse({
    endpoint: config.env.url("CLICKHOUSE_ENDPOINT"),
    database: config.env("CLICKHOUSE_DATABASE"),
    credentials: secret.env("CLICKHOUSE_CREDENTIALS"),
  }),
);
```

Changing the profile to managed implementations does not change consumer code:

```ts
const cluster = KubernetesCluster.current();

application.provide(
  PrimaryDatabase,
  Database.postgres({ cluster, storage: "50Gi" }),
);
application.provide(
  AnalyticsDatabase,
  Analytics.clickHouse({ cluster, replicas: 3 }),
);
```

The explicit `cluster` dependency is private implementation assembly. It is plan-visible and reusable by
other providers, but application callbacks gain no Kubernetes access unless the cluster capability is also
provided and used explicitly. A managed cloud implementation similarly receives an account/project
implementation value; no managed constructor discovers placement from ambient process state.

## Normative decisions

1. Capability identity and infrastructure ownership are independent.
2. `provide(token, implementation)` is the only binding operation: `application.provide(...)` supplies
   unconditional assembly and `profile.provide(...)` supplies the same operation inside an explicitly
   selected profile. No provider-specific binding DSL exists.
3. Every implementation declares a runtime adapter and lifecycle classification.
4. Deployment contribution is optional. Absence means Applik8s creates, adopts, mutates, and deletes no
   provider infrastructure.
5. External readiness observation is read-only and cannot repair or normalize the external service.
6. Secrets use Secret bindings. Complete credential-bearing URLs are Secrets, not ordinary config.
7. `.env` is a valid configuration/Secret source for local or production deployment when the selected
   profile/provider policy permits it. Plaintext values never enter the semantic graph, plan, generated
   source, diagnostics, logs, status, or Applik8s deployment metadata. A selected provider may create an
   explicitly declared encrypted/provider-managed runtime projection such as a Kubernetes Secret, AWS
   Secrets Manager version, or task/workload Secret reference.
8. A provider replacement or ownership change is a migration, not an in-place configuration update.
9. Runtime access is inferred per consumer. Binding an external service never grants ambient access to
   every closure in the application.
10. This contract normalizes maintained providers; it does not create a general plugin platform or admit
    broad provider expansion into v0.9.
11. Every managed deployment contributor identifies its actual TypeKro composition or Alchemy resource
    definitions. The compiler validates their implementation boundary from those resources; provider
    authors do not repeat it as a public classification.
12. A provider must not emit CloudFormation or another intermediate infrastructure template when a native
    Alchemy resource lifecycle exists, and must not deploy Kubernetes objects through a parallel Alchemy
    provider that bypasses TypeKro.
13. Provider constructors accept their own typed account, region, cluster, endpoint, config, and Secret
    bindings directly. No generic target, placement, substrate, environment, or application-installation
    wrapper is required.
14. Higher-level provider implementations accept typed implementation values or capability references as
    dependencies. Recursive resolution, sharing, lifecycle, authority, and migration follow the Profiles
    and Concrete Provider Bindings RFP.

## Provider anatomy

Every implementation contributes a serializable contract equivalent to:

```ts
interface CapabilityImplementationContract {
  semanticImplementation: string;
  runtimeAdapter: RuntimeAdapterReference;
  dependencies: readonly CapabilityImplementationDependency[];
  deploymentContributor?: DeploymentContributorReference;
  readiness: ReadinessObserverContract;
  lifecycle: "managed" | "shared" | "external";
  migration: ProviderMigrationContract;
  evidence: ProviderEvidenceReference;
}
```

`managed` means the deployment contributor owns the declared resources under its normal lifecycle.
`shared` requires a separately identified singleton/shared owner and explicit consumer references.
`external` means deletion is `none`; no Applik8s deployment resource may claim ownership of the external
service.

Provider-specific implementation details remain in provider packages. Application code sees the semantic
capability token and typed methods only.

An inline dependency is private to provider assembly unless it is also explicitly provided as an
application capability. Passing a capability reference consumes the separately selected implementation.
Reusing one implementation value preserves one implementation identity; equal configuration alone never
implies sharing.

## Configuration and Secrets

Configuration fields declare type, validation, provenance, optional default, and whether they affect
identity or migration. Secret fields declare the expected Secret contract or key shape.

The plan records:

- binding name and source kind;
- non-secret normalized configuration where policy permits;
- Secret reference identity and digest/provenance, never value;
- endpoint/network requirements;
- TLS identity and trust requirements;
- selected readiness observer;
- lifecycle and migration classification.

A missing or malformed Secret fails before dependent workloads report ready. A readiness observer may
authenticate and perform a bounded provider-specific health check, but it may not create schemas, users,
databases, buckets, indexes, or other external state unless that mutation is a separately declared setup
or migration operation authorized by the user.

### Secret persistence boundary

The contract distinguishes three layers:

1. **Source value:** plaintext read from `.env`, a local credential helper, external-secret service, or
   deployment credential boundary. Applik8s does not serialize it into graph/plan/source/log/status or
   general deployment state.
2. **Secret binding metadata:** source kind, identity, expected keys/schema, version/digest provenance,
   destination policy, and authorized consumers. This is safe, redacted plan/state material.
3. **Runtime projection:** an explicitly declared provider-managed encrypted object or workload reference
   required to deliver the Secret to an authorized runtime. It has lifecycle, encryption, rotation,
   deletion, audit, and redaction contracts and is visible in the physical plan.

A Kubernetes Secret or cloud secret resource is not described as “the value never persisted.” It is a
managed encrypted/access-controlled projection whose plaintext is excluded from Applik8s metadata and
whose provider lifecycle is explicit. Plaintext task-definition environment, generated manifest literals,
container build arguments, and command lines are forbidden. Rotation changes projection version and
readiness without changing the semantic capability identity unless the provider contract requires a
migration.

## Runtime and deployment boundary

The runtime adapter implements the semantic capability. The optional deployment contributor follows one
closed implementation rule:

```text
resource is created through a Kubernetes API
  -> TypeKro composition
  -> deployed through TypeKro's Alchemy integration

resource is non-Kubernetes managed infrastructure
  -> native Alchemy resource
  -> focused Alchemy extension only when upstream has no lifecycle resource

resource is externally owned
  -> no deployment contributor
```

Creating a Kubernetes cluster is non-Kubernetes control-plane infrastructure and therefore uses native
Alchemy resources. Installing a Namespace, CRD, operator, Helm release, workload, Service, or policy in
that cluster uses TypeKro. Provider application code never selects between these implementations, and
neither the runtime adapter nor one implementation layer may masquerade as the other.

For an external binding:

```text
plan -> validate config/Secret provenance -> observe readiness -> inject runtime adapter
```

There is no create, adopt, update, repair, or delete step for the service itself.

## Migration

Changing any of the following creates a plan-visible migration:

- managed/shared/external lifecycle;
- physical provider family;
- endpoint or account/cluster identity;
- credential/TLS identity when it affects provider ownership or stored state;
- state authority, schema authority, or durability class;
- deployment contributor identity.

The migration contract states compatibility, required data movement, cutover authority, rollback boundary,
and whether active work can continue. Applik8s never silently adopts an external service as managed.

## Graph, plan, and diagnostics

The graph records semantic capability identity, recursive implementation requirements, implementation
identity, consuming implementations/executions, and authority. The plan records dependency edges, runtime
adapter, deployment contribution or explicit absence, readiness, lifecycle, physical endpoint identity,
Secret/network access, migration, maturity, and evidence.

Physical attribution is many-to-many. A provider-specific deployment node names the exact implementation
that authored it, while one root TypeKro composition may name every implementation whose provider fragment
it contains. The compiler derives those links from semantic provider provenance and fragment identity; it
must not guess from resource names, configuration equality, or package naming. Each attribution records the
declared deployment contributor, and plan validation fails closed when the implementation is missing or the
contributor disagrees with the resolved implementation plan.

Required diagnostics include:

- `EXTERNAL_BINDING_CONFIGURATION_INVALID`
- `EXTERNAL_BINDING_SECRET_UNSAFE`
- `EXTERNAL_BINDING_READINESS_FAILED`
- `EXTERNAL_BINDING_DEPLOYMENT_CONTRIBUTION_FORBIDDEN`
- `DEPLOYMENT_IMPLEMENTATION_BOUNDARY_VIOLATION`
- `EXTERNAL_BINDING_MIGRATION_REQUIRED`
- `EXTERNAL_BINDING_EVIDENCE_INSUFFICIENT`
- `PROVIDER_DEPENDENCY_MISSING`
- `PROVIDER_DEPENDENCY_INCOMPATIBLE`
- `PROVIDER_DEPENDENCY_CYCLE`
- `PROVIDER_PHYSICAL_IDENTITY_CONFLICT`

## Acceptance

- The same application source runs against managed and external PostgreSQL implementations.
- Managed provider plans expose their actual TypeKro compositions or Alchemy resources, and boundary
  validation rejects incompatible implementation paths.
- Every managed physical resource is traceable through its owning deployment node to the exact concrete
  implementation and contributor; shared compositions preserve all contributors rather than choosing one.
- Kubernetes-hosted PostgreSQL is composed with TypeKro and deployed through its Alchemy integration;
  non-Kubernetes managed PostgreSQL uses native or focused Alchemy resources.
- No maintained provider emits CloudFormation or constructs Kubernetes API objects through a parallel
  deployment engine.
- External PostgreSQL and ClickHouse bindings create, adopt, mutate, and delete no infrastructure.
- Deleting the application leaves external services untouched while removing only application-owned
  runtime resources and credentials.
- Readiness failure blocks dependents and exposes actionable, redacted evidence.
- Secrets never appear in graph, plan, generated source, diagnostics, logs, status, or persisted provider
  metadata; physical plans expose only redacted binding/projection identity, while authorized encrypted
  runtime projections obey their declared lifecycle.
- Only consuming executions receive network and credential access.
- Nested provider dependencies receive only their declared provider-internal access and never widen
  application callback authority transitively.
- Shared implementation values materialize once with one lifecycle owner and dependent-first teardown.
- Changing managed/external ownership produces a migration plan.
- Clean `.env`, Kubernetes Secret, and maintained external-secret sources pass the same binding contract.

## Non-goals

- a general provider/plugin SPI;
- broad cloud or database catalog expansion;
- automatically importing ambient process credentials;
- provisioning external services as a readiness side effect;
- cross-provider live data migration in v0.9;
- hiding consistency or capability differences.

## Definition of done

External capability bindings are ready when application code is identical across managed and external
implementations, lifecycle ownership is fail-closed, Secrets and runtime access remain exact, migration is
explicit, recursive implementation dependencies remain inspectable and private by default, and PostgreSQL
plus ClickHouse pass black-box conformance without infrastructure mutation.
