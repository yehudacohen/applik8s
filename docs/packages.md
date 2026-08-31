# Packages and modules

Applik8s publishes small packages so applications can select capabilities and
providers without installing unrelated product modules. Most application code
starts with `@applik8s/applik8s`; the other packages are focused integration,
provider, runtime, deployment, or tooling boundaries.

## Foundation and authoring

| Package | Use it for |
| --- | --- |
| `@applik8s/applik8s` | Full application authoring: models, resources, events, workflows, providers, HTTP, and TypeKro composition. |
| `@applik8s/core` | Dependency-light shared contracts used by packages and tooling. Most applications do not import it directly. Focused runtime consumers use `/canonical-json` for canonical bytes or `/admission` for validated admission and redacted observation primitives without pulling the umbrella surface. |
| `@applik8s/sdk` | Focused Kubernetes operator and CRD authoring, including handler-safe imports. |
| `@applik8s/ai` | Provider-neutral logical models, agents, attempt records, usage, and AI contracts. |
| `@applik8s/ml` | Beta provider-neutral typed predictive models, content-addressed artifact provenance, receipts, and deterministic conformance execution. |
| `@applik8s/identity` | Provider-neutral identity, session, admission, OAuth, and recovery contracts. |
| `@applik8s/operations` | Typed operation catalog, roles, grants, receipts, revocation, and authority. |
| `@applik8s/dev` | Independent local development daemon, durable change journal, reviewed workspace mutation, revision-bound ApplicationPlan selection resolution, portal UI, coding-agent adapters, and version-matched skills. Public subpaths are `/server`, `/ui`, `/agent`, `/agent/opencode`, and `/skills`. |
| `@applik8s/mcp` | Provider-neutral MCP catalog, transport, trust, and persistence contracts. |

## Web application integrations

| Package | Use it for |
| --- | --- |
| `@applik8s/client` | Browser-safe query, command, snapshot, resume, and transport clients. |
| `@applik8s/react` | Router-independent React providers and live query/mutation hooks. |
| `@applik8s/server` | Framework-neutral authenticated request scope and gateway integration. |
| `@applik8s/vite` | Browser/server partitioning, graph discovery, and Vite build integration. |
| `@applik8s/tanstack-start` | Thin TanStack Start server and Vite adapters, including fail-closed generated-gateway hydration and `/-/healthz`. |
| `@applik8s/ai-tanstack` | TanStack AI tools, persistence, connection, and client adapters. |
| `@applik8s/operations-ui` | Optional redacted operational queries and React control-center surfaces. |

## Optional application modules

These modules provide reusable models and mechanics. Generated applications
still own their product vocabulary, policy, routes, and presentation.

| Package | Module boundary |
| --- | --- |
| `@applik8s/approvals` | Product-facing review queues and outcome observations over durable authority. |
| `@applik8s/artifacts` | Immutable artifact metadata, object references, and scoped queries. |
| `@applik8s/documents` | Mutable documents, revisions, comments, provenance, and generic queries. |
| `@applik8s/agents` | Application-owned agent profiles, versions, policies, and publication state. |
| `@applik8s/knowledge` | Knowledge sources, verified objects, ingestion state, and indexing lifecycle. |
| `@applik8s/integrations` | Provider-neutral connection intent, scopes, and safe lifecycle state. |
| `@applik8s/billing` | Provider-neutral plans, subscriptions, checkout, portal, and entitlement models. |
| `@applik8s/notifications` | Transactional notification contracts, durable requests, and local inspection. |
| `@applik8s/web-search` | Bounded provider-neutral web retrieval, deterministic local execution, and source provenance. |
| `@applik8s/conversations` | Conversations, messages, protocol runs, run events, memory, and TanStack persistence. |
| `@applik8s/data-lifecycle` | Provider-neutral lifecycle request state and progress vocabulary; applications own deletion policy. |
| `@applik8s/evals` | Versioned datasets, scorers, evaluation runs, cases, and results. |
| `@applik8s/usage` | Usage facts, cost, quotas, and entitlement accounting. |
| `@applik8s/search` | Provider-neutral search projection sources and PostgreSQL synchronization. |

## Provider and runtime adapters

Install only the providers selected by the application profile.

| Package | Boundary |
| --- | --- |
| `@applik8s/billing-stripe` | Server-only Stripe implementation of the billing capability. |
| `@applik8s/notifications-smtp` | Server-only SMTP implementation of notification delivery. |
| `@applik8s/web-search-searxng` | Optional SearXNG runtime and TypeKro-managed web-search provider. |
| `@applik8s/web-retrieval-http` | Server-only DNS-pinned, redirect-bounded public HTTP source retrieval with SSRF and response-size protection. |
| `@applik8s/research` | Append-only research evidence, citation provenance, artifact linkage, and maintained specialized research composition contracts. |
| `@applik8s/identity-ory` | Ory Kratos and Hydra identity/OAuth adapter. |
| `@applik8s/identity-postgres` | PostgreSQL persistence for identity admission and OAuth flows. |
| `@applik8s/runtime-s3` | S3-compatible object storage and signed object intents. |
| `@applik8s/runtime-hatchet` | Hatchet durable workflow execution. |
| `@applik8s/runtime-nats` | NATS JetStream event log and command consumers. |
| `@applik8s/runtime-kubernetes` | Kubernetes API runtime access for application workloads. |
| `@applik8s/runtime-postgres` | PostgreSQL model, command, stream, and projection runtime. |
| `@applik8s/runtime-aws` | AWS runtime bindings for managed secrets, Kinesis delivery, EventBridge schedule admission, and S3/Glue/Athena lakehouse queries. |
| `@applik8s/runtime-celld` | celld-backed distributed durable actor admission, state, receipts, broadcasts, and alarms. |
| `@applik8s/celld-operator` | Independently consumable Kubernetes `CelldFleet` CRD and Applik8s operator. The root exports contracts and rendering; `/typekro` installs the singleton control plane or a fleet; `/testing` exposes conformance fixtures. |
| `@applik8s/runtime-otel` | OpenTelemetry spans, correlated structured logs, bounded metrics, and OTLP export. |
| `@applik8s/runtime-duckdb` | DuckDB-backed local lakehouse snapshots and bounded query execution. |
| `@applik8s/runtime-opensearch` | OpenSearch projection, query, rebuild, and cutover runtime. |
| `@applik8s/runtime-ai` | Bounded server execution for agents, tools, attempts, and logical AI models. |

Generated publisher workers use the focused
`@applik8s/applik8s/lakehouse-runtime` subpath. It contains only portable
publication, immutable-manifest, cursor, and query execution contracts; normal
application source continues to declare publications from the main
`@applik8s/applik8s` authoring surface.

Generated actor hosts similarly use the focused
`@applik8s/applik8s/actor-runtime` subpath. The authoring surface stays on the
root package, while deployed request hosts do not inherit TypeKro or Kubernetes
compiler dependencies merely to execute actor protocol operations.

## Compiler, deployment, and tooling

These packages are public so tooling and custom integrations can compose them.
Normal applications usually reach them through the CLI.

| Package | Use it for |
| --- | --- |
| `@applik8s/cli` | Build, plan, deploy, status, destroy, operator authority, and Start commands. Its local command owns source watching, process-group reload, bounded child recovery, retained provider state, and lease-safe reset. |
| `@applik8s/compiler` | Application/operator discovery, lowering, artifacts, manifests, and WASM components. |
| `@applik8s/runtime-contract` | Canonical handler/runtime ABI schemas and generated WIT. |
| `@applik8s/runtime` | Interfaces for implementing a custom operator runtime. |
| `@applik8s/deployment-contract` | Portable application deployment-graph contracts. |
| `@applik8s/deployment-compiler` | Pure application-graph to deployment-graph lowering. |
| `@applik8s/deployment-typekro` | TypeKro deployment composition and output binding. |
| `@applik8s/deployment-provider-harbor` | Harbor resources for Alchemy deployment graphs. |
| `@applik8s/deployment-provider-kubernetes` | Kubernetes-specific Alchemy resources. |
| `@applik8s/deployment-provider-oci` | OCI build and artifact resources for Alchemy. |
| `@applik8s/deployment-alchemy` | Alchemy v2 deployment backend. |
| `@applik8s/typekro-adapter` | TypeKro integration for authored operators and operation targets. |
| `@applik8s/typetainer` | Dependency-light typed container image and build recipe utilities. |
| `@applik8s/testing` | Source-owned application journeys, public-admission local runners, ownership-safe fixture cleanup, provider conformance, local operator harnesses, and proxy recorders. It is a development/test dependency and is excluded from production application bundles. |

`@applik8s/typekro-adapter` participates in authoring and compilation;
`@applik8s/deployment-typekro` binds the already-compiled deployment graph.
It consumes the focused
`@applik8s/deployment-compiler/runtime-access-parity` validator to prove that
TypeKro's materialized workloads exactly implement the canonical RBAC,
credential, and network envelope without importing the compiler umbrella.
`@applik8s/runtime-contract` defines the host ABI; `@applik8s/runtime` defines
TypeScript interfaces for alternate runtime implementations.

## Starts

| Package | Use it for |
| --- | --- |
| `@applik8s/start-agentic` | Maintained Agentic Start definition, profiles, generator overlay, and shared presentation controllers. |
| `create-applik8s` | `bun create applik8s` command that scaffolds a selected Start. |

## Choosing dependencies

- Use `@applik8s/applik8s` for ordinary application authoring.
- Add only the application modules imported by your product.
- Add one provider/runtime implementation for each selected capability.
- Use browser-safe subpaths from `client`, `react`, identity, and integration
  packages in browser code; provider and deployment packages remain server or
  build-time dependencies.
- Use `@applik8s/sdk` rather than the umbrella inside minimal WASM handlers.
