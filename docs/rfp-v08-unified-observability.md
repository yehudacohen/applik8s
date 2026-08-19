# RFP: Applik8s v0.8 — Unified OpenTelemetry Observability

**Status:** Proposed stable v0.8 semantic and collector contract. ClickStack/HyperDX, CloudWatch, and
external OTLP providers qualify independently. This document authorizes design review, not implementation
or release.

**Manifesto:** [`manifesto-v08-portable-stateful-development.md`](manifesto-v08-portable-stateful-development.md)

**Foundation gate:** The stable `graph-provenance` gate must pass before semantic telemetry attribution
is considered qualified.

**Foundation dependencies:** v0.7 execution and causal principals, canonical operation identity,
application graph, maintained runtime-boundary hooks, and the manifesto's Phase 0 identity, provenance,
provider-guarantee, and guest/host envelope records

**v0.8 contract integrations:** The application plan explains effective telemetry; local, AWS, TypeKro,
and external providers supply collector/export topology; HTTP, model, event, processor, schedule,
workflow, actor, AI, query, and reconciler boundaries contribute instrumentation incrementally. The
semantic OTel contract does not wait for every backend provider to be complete.

**Unblocks:** Correlated traces, structured logs, and metrics across a distributed Applik8s application
without binding domain code to a monitoring vendor or requiring Applik8s to build an APM UI

## Purpose

Applik8s can infer and manage distributed execution boundaries, but those boundaries are difficult to
operate when each runtime logs differently, asynchronous work loses causal context, metrics have
unbounded labels, and Kubernetes or AWS deployment requires application-specific telemetry wiring.

v0.8 makes OpenTelemetry the stable instrumentation, propagation, and export boundary for maintained
runtimes. The framework emits:

- traces that reflect synchronous parentage and asynchronous causality honestly;
- structured logs correlated to traces and canonical execution identities; and
- bounded metrics with stable names, units, temporality, histograms, and cardinality policy.

Collectors and backends are replaceable. v0.8 maintains:

- ClickStack with HyperDX for local/Kubernetes observability through TypeKro;
- CloudWatch for AWS through an OpenTelemetry collector/agent path; and
- generic external OTLP for an operator-selected compatible backend.

Applik8s does not build a proprietary APM interface. HyperDX, CloudWatch, or the selected external backend
owns query, visualization, dashboards, alerts, and retention UI.

The provider design is grounded in the official [ClickStack overview](https://clickhouse.com/clickstack)
and [CloudWatch OpenTelemetry guidance](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-OTLPGettingStarted.html).
Provider conformance remains pinned to the exact versions qualified by Applik8s rather than whichever
upstream behavior happens to be current.

## Required developer experience

Application code does not import a backend SDK:

```ts
Invoice.on.create(async invoice => {
  InvoiceCreated.emit({ invoiceId: invoice.id });
});

InvoiceCreated.on(async event => {
  await SendInvoiceNotification({ invoiceId: event.invoiceId });
});
```

The framework instruments the model operation, outbox publication, broker delivery, processor attempt,
operation call, provider request, retry, and result.

Signal policy is one reusable provider-neutral value:

```ts
const ProductTelemetry = telemetryPolicy({
  logs: {
    level: "info",
    overrides: {
      "billing.checkout": "debug",
      "framework.health": "warn",
    },
    sample: { debug: 0.1 },
  },
  metrics: {
    interval: "30s",
    cardinalityBudget: "bounded",
  },
  traces: {
    headSample: 0.1,
    alwaysSampleErrors: true,
    tailSample: { latency: ">2s" },
  },
});
```

Installation selects an observability provider using ordinary dependency injection:

```ts
deployment
  .provide(Observability)
  .clickStack({
    policy: ProductTelemetry,
    retention: { logs: "14d", traces: "14d", metrics: "30d" },
  })
  .exhaustive();
```

or:

```ts
deployment
  .provide(Observability)
  .cloudWatch({
    policy: ProductTelemetry,
    retention: { logs: "30d" },
  })
  .exhaustive();
```

or:

```ts
deployment
  .provide(Observability)
  .otlp({
    policy: ProductTelemetry,
    endpoint: ExternalTelemetryEndpoint,
    authentication: ExternalTelemetryCredential,
  })
  .exhaustive();
```

Exact surface naming may refine during implementation, but configuration must describe signal semantics,
not HyperDX, CloudWatch, or vendor SDK objects.

`applik8s plan` explains instrumentation, collector topology, export destination, retention, sampling,
redaction, estimated volume/cost class, and unsupported policy before deployment.

## Owned contracts

This RFP owns:

- stable OpenTelemetry resource and span semantic attributes for Applik8s identities;
- trace-context propagation and asynchronous trace-link rules;
- framework instrumentation of maintained execution boundaries;
- structured-log event schema and trace correlation;
- stable framework metric names, units, temporality, histogram, and cardinality rules;
- profile-aware logs, metrics, and traces configuration;
- collector topology and failure-isolation requirements;
- redaction, baggage, tenant, and sensitive-data policy;
- bounded ClickStack/HyperDX, CloudWatch, and external OTLP provider contracts;
- telemetry representation in the canonical application plan; and
- conformance, security, performance, and cost evidence.

This RFP does not own:

- business analytics or application projection schemas;
- a new Applik8s monitoring UI;
- backend-specific query languages, dashboards, or alert editors;
- application authorization;
- exact backend retention implementation outside declared guarantees;
- automatic instrumentation of arbitrary third-party code;
- a maintained Datadog-specific adapter in v0.8; or
- use of the observability ClickHouse deployment as application data storage.

## Semantic identity

Every signal uses stable shared resource attributes where applicable:

- application identity and version;
- environment and deployment target;
- deployment and release identity;
- service/workload/execution identity;
- operation, model, event, schedule definition/occurrence, workflow, actor, agent, query, or reconciler
  identity;
- provider and qualified capability identity;
- immediate execution principal class and causal principal class;
- tenant/organization scope only through approved bounded identifiers; and
- source and graph node identity.

Canonical names are versioned. High-cardinality values such as raw user IDs, resource payloads, prompts,
object keys, URLs with identifiers, and exception bodies are not default metric labels.

Telemetry identity is evidence and correlation metadata. It cannot grant authority, recover a missing
authorization receipt, or become a second application graph.

## Componentized WASM guest/host propagation

Applik8s closures cross a first-class runtime boundary:

```text
TypeScript closure
  -> ComponentizeJS component
  -> versioned WIT world
  -> Wasmtime invocation
  -> Rust operator/runtime host
  -> provider or Kubernetes effect
```

The compiler/runtime defines a versioned, serialization-safe execution telemetry envelope containing only
the context required to continue correlation:

- W3C trace context and bounded tracestate;
- allowlisted baggage;
- canonical application, operation, execution, attempt, and causal identities;
- invocation/replay classification;
- sampling disposition; and
- semantic-version/digest information needed to reject incompatible carriers.

The envelope contains no credential values, provider clients, raw principal records, prompts, request
bodies, or arbitrary log fields. The host validates size, version, identity, and invocation binding before
continuing context.

Guest and host agree on one span owner for each logical boundary so the same invocation is not double-
counted. Guest structured logs and metrics are normalized through the WIT/host contract or an equivalent
versioned carrier and receive the same trace/execution identity as host effects. Traps, deadline
expiration, fuel/resource exhaustion, cancellation, and host-effect denial become typed terminal span/log
outcomes without exposing private payloads.

Workflow replay, handler retry, and stale-generation suppression do not emit duplicate external business
spans. Each real attempt remains observable through attempt identity and a causal link to the logical
operation.

## Trace contract

### Synchronous boundaries

Ordinary in-process and request/response calls preserve parent-child context:

- inbound and outbound HTTP;
- direct operation calls;
- model transaction and provider calls;
- AI/model provider calls;
- object, database, and external provider requests; and
- query execution where the provider supports it.

### Asynchronous boundaries

Queues, streams, outboxes, processors, batches, retries, replay, schedules, workflows, signals, actors,
alarms, and fan-out do not fabricate one long synchronous stack. The runtime records:

- producer span and issuance identity;
- durable propagation envelope;
- consumer-attempt span;
- trace link to the producer or prior attempt;
- delivery, sequence, batch, retry, replay, and idempotency metadata within cardinality limits; and
- causal-principal lineage independently from transport topology.

A batch consumer links to bounded producer contexts. It does not select one arbitrary event as the parent.
When link count exceeds policy, the runtime records a summarized bounded link set and a truncation metric.

### Retries and durable execution

Each attempt is observable without changing logical operation identity. Workflow history replay must not
emit duplicate external spans as if business work happened again. Durable task execution, compensation,
schedule occurrence, signal resolution, actor turn, and alarm delivery record logical and attempt
identities separately.

### Sampling

The stable policy supports:

- head sampling;
- always-sample errors or explicit critical operations;
- provider-capable tail sampling for latency and failure;
- per-operation bounded overrides;
- deterministic sampling where required for retries; and
- explicit unsampled/drop counters.

Provider adapters report unsupported sampling behavior during planning.

## Structured-log contract

Framework and application logs share a structured envelope:

- timestamp and severity;
- stable event/message identity;
- trace and span correlation when present;
- application, execution, operation, provider, and target attributes;
- bounded error type/code and sanitized stack metadata;
- structured fields after redaction and cardinality policy; and
- source classification: application, framework, provider, audit, or collector.

Configuration includes:

- default severity threshold;
- namespace/operation/provider overrides;
- rate and sample limits for verbose levels;
- multiline parsing policy for collected external logs;
- batch and flush bounds;
- redaction and field allow/deny rules; and
- retention requested from the provider.

Logs do not have a collection interval. They have filters, rate/sampling controls, buffering, flush, and
retention. The API must not conflate those with metric export intervals.

Audit/security records use a separately declared non-debuggable floor and retention policy. Turning the
application log level to `error` cannot silently disable required audit evidence.

## Metrics contract

Applik8s defines a bounded core metric set for:

- request, operation, event, processor, schedule occurrence, workflow, actor, agent, query, and reconciler
  latency/results;
- queue/stream admission, delivery, lag, acknowledgement, retry, replay, and dead-letter behavior;
- database/object/provider request latency and failures;
- schedule configuration/admission/lag/misfire/retry/dead-letter behavior;
- workflow/actor activation, hot keys, concurrency, state size, and alarms;
- collector queues, export failures, retry, drops, and backpressure;
- runtime CPU, memory, event-loop, process, container, and restart health where available; and
- plan/reconciliation drift and deployment health where appropriate.

Every metric specifies:

- name and description;
- unit;
- counter, gauge, or histogram kind;
- delta or cumulative temporality requirements;
- default and configurable histogram boundaries;
- allowed attribute keys and cardinality budget;
- collection/export interval; and
- provider transformation notes.

Dynamic model IDs, actor keys, user IDs, URLs, prompts, and error messages are forbidden default labels.
Providers may aggregate or drop optional labels but must report semantic degradation.

## Managed infrastructure signals

The framework cannot truthfully promise telemetry for arbitrary external software merely because it runs
in the same cluster or account. Every maintained provider instead declares its managed-infrastructure
coverage:

- application and generated workload stdout/stderr collection;
- Kubernetes Events and workload lifecycle diagnostics where applicable;
- service logs exposed by maintained PostgreSQL, Valkey, NATS, ClickHouse, workflow, actor, identity,
  ingress, and object-storage providers;
- service/runtime metrics obtained through OTLP, Prometheus/OpenMetrics receivers, Kubernetes sources,
  or cloud-native integrations; and
- provider health and reconciliation evidence.

Provider adapters own parsers, receivers, resource enrichment, version compatibility, and default
cardinality limits for infrastructure they install. Unsupported logs or metrics are visible in the
application plan. External providers declare their own coverage; Applik8s does not scrape arbitrary
endpoints or mount arbitrary host paths as a permissive fallback.

Infrastructure logs remain distinguishable from application logs, and Kubernetes Events remain
diagnostic records rather than invented application spans. A service log may correlate to a trace only
when the service actually propagates or records that context.

## Configuration and precedence

Configuration has explicit precedence:

1. framework-safe defaults;
2. application semantic policy;
3. application profile policy;
4. deployment environment/provider policy; and
5. bounded runtime override for incident response.

Provider configuration may narrow volume or retention because of capacity or cost. It may not disable a
required security signal silently. Every effective policy appears in the application plan.

Runtime log-level and sampling changes are authenticated, audited, time-bounded by default, and restored
after restart from declared policy. The telemetry backend is not automatically an application control
plane.

## Collector topology

### Local

`applik8s dev` starts or reuses a package-managed collector process/container only when observability is
required. Application processes export OTLP to loopback. Stable ports, health, logs, shutdown, reset,
configuration digest, and lease ownership are supervised.

ClickStack may be an opt-in richer local profile because ClickHouse/HyperDX is heavier than the default
feedback loop. A lightweight console/file test exporter may satisfy basic local conformance without
claiming full backend qualification.

### Kubernetes

TypeKro installs ClickStack/HyperDX and the required collector topology as bounded infrastructure. The
provider may use node/daemon collectors plus a gateway/cluster collector where appropriate. Namespace,
storage, retention, ingress, TLS, authentication, network policy, upgrades, adoption, and deletion remain
explicit lifecycle choices.

Application workloads receive only OTLP endpoint and identity configuration. They do not receive
ClickHouse administrative credentials.

### AWS

The AWS provider deploys or configures an OpenTelemetry collector/agent compatible with the selected
compute topology and exports logs, metrics, and traces to CloudWatch using workload identity. IAM,
endpoints, encryption, log groups, retention, service naming, retry, and teardown are Alchemy-owned.

The AWS provider documents any signal that requires a CloudWatch-specific transformation. Application
instrumentation remains standard OpenTelemetry.

### External OTLP

An external provider accepts an OTLP endpoint, protocol, headers/credential reference, TLS/trust policy,
signal support, and declared guarantees. Credentials remain behind the Secret authority and inferred
runtime access. The provider must fail planning when required signals or protocol features are unsupported.

External OTLP is the vendor-neutral escape hatch. v0.8 does not maintain bespoke SaaS adapters.

## ClickStack and HyperDX provider

The maintained ClickStack provider owns:

- TypeKro composition and Alchemy lifecycle integration;
- pinned compatible ClickStack, ClickHouse, HyperDX, and collector versions;
- storage class, capacity, retention, backup/restore, upgrade, and deletion policy;
- HyperDX authentication, TLS, ingress/exposure, and endpoint status;
- collector configuration for logs, metrics, traces, and supported session data;
- health/readiness based on observed generations and usable ingestion/query paths; and
- plan and runtime evidence.

The observability ClickHouse lifecycle is independent from application `AnalyticalDatabase`. A deliberate
shared development optimization requires an explicit provider mode and cannot become the production
default.

HyperDX is the UI. Applik8s may deep-link trace, service, or time-range context from the developer portal
or operations output, but it does not recreate trace search, log search, charts, dashboards, or alerts.

## CloudWatch provider

The maintained CloudWatch provider owns:

- collector/agent topology appropriate to ECS and other qualified compute;
- OTLP signal export and CloudWatch translation;
- task/execution role access, endpoints, encryption, and network reachability;
- log group/stream, metric namespace, trace destination, and retention lifecycle;
- resource-attribute normalization and service correlation;
- throttling, retry, buffering, and drop diagnostics;
- sanitized Console deep links; and
- real-AWS create/update/drift/delete and ingestion/query evidence.

MiniStack can test bounded API wiring only. It cannot qualify CloudWatch production semantics, IAM,
quotas, retention, cost, or availability.

## Failure isolation and backpressure

Telemetry is not in the business transaction's success path unless an explicit audit requirement says
otherwise. Export uses:

- bounded memory and optional disk queues;
- bounded batch size and flush time;
- retry budgets with jitter;
- circuit breaking/backoff;
- drop policy by signal/severity;
- self-observability counters; and
- graceful shutdown flush with a bounded deadline.

A backend outage cannot indefinitely block HTTP, database commits, event acknowledgement, workflow
progress, or actor turns. Required audit persistence uses an explicit durable authority rather than
pretending a best-effort telemetry exporter is a transaction log.

## Security, privacy, and tenancy

The runtime applies redaction before export. Collector-side redaction is defense in depth, not the first
protection.

Required controls include:

- exact Secret/credential field suppression;
- prompt, model input/output, document, request-body, header, cookie, token, and query-value capture off by
  default;
- baggage allowlists and size bounds;
- PII field classification and tenant policy;
- tenant-scoped views or attributes only when the backend can enforce the required isolation;
- no raw principal identity in metrics;
- authenticated, encrypted export;
- separate collector and backend credentials;
- sanitized exceptions and stack traces; and
- secret/PII canary tests across runtime, buffers, backend, UI, and exported evidence.

Session replay or frontend capture is a separate opt-in capability with its own consent and redaction
requirements. ClickStack support does not enable it by default.

## Application-plan integration

The canonical plan shows:

- instrumented boundaries and semantic version;
- collector processes/resources and lifecycle owners;
- export routes and required runtime access;
- provider maturity and unsupported signals;
- log levels/filters, metric intervals/temporality, trace sampling, batching, and retry;
- retention, encryption, redaction, tenancy, and data-residency policy;
- estimated ingestion/storage/cost class and assumptions; and
- backend UI/deep-link endpoints after deployment.

Changes to signal volume, cardinality, retention, public exposure, or backend ownership receive explicit
plan-diff classifications.

## Provider conformance

Every provider publishes:

- supported OTLP transports and signal types;
- semantic-attribute fidelity;
- logs, metrics, and traces transformation behavior;
- sampling, temporality, histogram, exemplars, and trace-link support;
- maximum batch/attribute/payload sizes;
- buffering, retry, drop, and shutdown behavior;
- retention and deletion guarantees;
- encryption and authentication;
- tenancy and redaction responsibilities;
- query/readiness evidence; and
- managed-infrastructure log and metric coverage;
- lifecycle maturity.

Unsupported behavior is visible during planning. A provider that accepts OTLP but drops trace links or
changes metric temporality does not silently inherit full conformance.

## Implementation sequence

1. Complete bounded ClickStack/HyperDX and CloudWatch OTLP fidelity/lifecycle spikes, then freeze semantic
   resource/span/log/metric attributes and sensitive-data rules.
2. Implement context propagation and test exporters across all maintained execution boundaries.
3. Implement and differentially test the componentized WASM/WIT/Wasmtime/Rust telemetry envelope,
   including traps, retries, replay, cancellation, and redaction.
4. Instrument framework logs and bounded metrics with failure-isolated SDK configuration.
5. Add package-managed local collector and deterministic conformance fixtures.
6. Add ClickStack/HyperDX TypeKro provider with live local/Kubernetes evidence.
7. Add CloudWatch AWS provider with real-AWS evidence after the AWS foundation exists.
8. Add generic external OTLP provider and compatibility diagnostics.
9. Integrate application plan, portal deep links, operations evidence, budgets, and historical benchmarks.

## Release gates

- One vertical preserves causal correlation across HTTP, model commit/outbox, event delivery, processor,
  scheduled occurrence, AI provider, workflow/task, actor turn, query, and reconciler boundaries.
- A real ComponentizeJS/WIT/Wasmtime/Rust invocation preserves trace, operation, execution, attempt, and
  causal identity through success, host effect, trap, timeout, retry, replay, and cancellation.
- Synchronous parentage and asynchronous links are semantically correct under fan-out, batch, retry,
  replay, and cancellation.
- Trace/log correlation and metric exemplars work where provider support is claimed.
- Log levels/filters, metric intervals/temporality, trace sampling, batching, redaction, retention, and
  cardinality controls behave consistently across targets or report explicit degradation.
- Every maintained infrastructure provider either proves its declared log/metric coverage or reports the
  unsupported signal in the application plan.
- Backend outage, throttling, malformed export, and collector restart cannot block business progress;
  queues and drops remain bounded and observable.
- ClickStack/HyperDX ingests and queries logs, metrics, and traces in a live TypeKro deployment with clean
  lifecycle teardown.
- CloudWatch ingests and correlates all claimed signals in a real AWS acceptance account with least-
  privilege IAM and retention lifecycle evidence.
- Generic external OTLP passes protocol, auth, TLS, failure, and signal-support conformance.
- Secret and PII canaries remain absent from all signals and backends.
- Telemetry overhead, memory, latency, volume, storage, and cost remain within recorded budgets.
- The canonical application plan truthfully explains the effective topology and policy.

## Non-goals

- Building an Applik8s APM, log explorer, dashboard editor, or alerting UI.
- Making ClickStack or CloudWatch application-facing APIs.
- A maintained Datadog-specific provider in v0.8.
- Instrumenting arbitrary libraries or raw provider SDK calls without a declared boundary.
- Capturing prompts, request bodies, documents, cookies, tokens, or user data by default.
- Using metrics as exact billing authority.
- Replacing durable audit logs with best-effort telemetry.
- Sharing observability ClickHouse with application analytics by default.
- Promising identical backend query languages, dashboards, or retention implementations.

## Closed decisions

- OpenTelemetry is the stable instrumentation, propagation, and export boundary.
- Traces, structured logs, and metrics are all in scope.
- Asynchronous causality uses trace links rather than false synchronous parentage.
- Componentized WASM guests and the Rust host exchange one versioned, bounded telemetry envelope with
  explicit span ownership, trap/retry/replay semantics, and no sensitive payloads.
- Signal policy is provider-neutral and profile-aware.
- ClickStack/HyperDX, CloudWatch, and generic external OTLP are the v0.8 provider set.
- HyperDX or the provider UI owns observability UX; Applik8s supplies plan context and deep links only.
- A maintained Datadog-specific adapter is outside scope.
- Telemetry export is bounded and failure-isolated from business execution.
- Redaction occurs before export, baggage is allowlisted, and cardinality is budgeted.
- Observability storage has separate lifecycle from application analytical storage by default.

## Definition of done

This RFP is complete when one Agentic Start journey is causally inspectable through correlated traces,
logs, and metrics across every maintained distributed boundary, including a real
ComponentizeJS/WIT/Wasmtime/Rust invocation; ClickStack/HyperDX and CloudWatch each
pass their live provider gates; external OTLP passes conformance; effective policy and topology appear in
the canonical application plan; backend outages remain bounded and nonblocking; sensitive canaries are
absent; volume, performance, storage, retention, and cost evidence are recorded; and no application
domain code imports a backend-specific telemetry SDK.
