# Packages and modules

Applik8s publishes small packages so applications can select capabilities and
providers without installing unrelated product modules. Most application code
starts with `@applik8s/applik8s`; the other packages are focused integration,
provider, runtime, deployment, or tooling boundaries.

## Foundation and authoring

| Package | Use it for |
| --- | --- |
| `@applik8s/applik8s` | Full application authoring: models, resources, events, workflows, providers, HTTP, and TypeKro composition. |
| `@applik8s/core` | Dependency-light shared contracts used by packages and tooling. Most applications do not import it directly. |
| `@applik8s/sdk` | Focused Kubernetes operator and CRD authoring, including handler-safe imports. |
| `@applik8s/ai` | Provider-neutral logical models, agents, attempt records, usage, and AI contracts. |
| `@applik8s/identity` | Provider-neutral identity, session, admission, OAuth, and recovery contracts. |
| `@applik8s/operations` | Typed operation catalog, roles, grants, receipts, revocation, and authority. |
| `@applik8s/mcp` | Provider-neutral MCP catalog, transport, trust, and persistence contracts. |

## Web application integrations

| Package | Use it for |
| --- | --- |
| `@applik8s/client` | Browser-safe query, command, snapshot, resume, and transport clients. |
| `@applik8s/react` | Router-independent React providers and live query/mutation hooks. |
| `@applik8s/server` | Framework-neutral authenticated request scope and gateway integration. |
| `@applik8s/vite` | Browser/server partitioning, graph discovery, and Vite build integration. |
| `@applik8s/tanstack-start` | Thin TanStack Start server and Vite adapters. |
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
| `@applik8s/identity-ory` | Ory Kratos and Hydra identity/OAuth adapter. |
| `@applik8s/identity-postgres` | PostgreSQL persistence for identity admission and OAuth flows. |
| `@applik8s/runtime-s3` | S3-compatible object storage and signed object intents. |
| `@applik8s/runtime-hatchet` | Hatchet durable workflow execution. |
| `@applik8s/runtime-nats` | NATS JetStream event log and command consumers. |
| `@applik8s/runtime-kubernetes` | Kubernetes API runtime access for application workloads. |
| `@applik8s/runtime-postgres` | PostgreSQL model, command, stream, and projection runtime. |
| `@applik8s/runtime-opensearch` | OpenSearch projection, query, rebuild, and cutover runtime. |
| `@applik8s/runtime-ai` | Bounded server execution for agents, tools, attempts, and logical AI models. |

## Compiler, deployment, and tooling

These packages are public so tooling and custom integrations can compose them.
Normal applications usually reach them through the CLI.

| Package | Use it for |
| --- | --- |
| `@applik8s/cli` | Build, plan, deploy, status, destroy, operator authority, and Start commands. |
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
| `@applik8s/testing` | Local operator test harnesses and proxy recorders. |

`@applik8s/typekro-adapter` participates in authoring and compilation;
`@applik8s/deployment-typekro` binds the already-compiled deployment graph.
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
