# RFP: Applik8s v0.7 — AI Runtime, Agents, and Durable Attempts

**Status:** Proposed; maintainer review required

**Charter:** [`charter-v07-agentic-platform.md`](charter-v07-agentic-platform.md)

**Depends on:** Typed operations and authority, provider DI, Hatchet workflows, event streams, object
storage, Vite/React/TanStack Start, and TypeKro

**Unblocks:** Agentic Start conversations, Chirp automation agents, evaluations, and AI operations UI

## Purpose

Provide a provider-neutral application contract for logical AI models and agents while using TanStack AI
for application-facing protocol and rendering, Hatchet for durable orchestration, and Envoy AI Gateway
for dedicated Kubernetes inference routing.

No layer may become a second source of truth for application models, workflows, authority, or
conversations.

## Authority boundaries

```text
TanStack AI
  client/server chat protocol, typed tools, AG-UI events, streaming,
  framework hooks, approval presentation

Applik8s
  agent definitions and execution placement, provider-native product
  conversation/run/message records, admitted identity, typed operation tools,
  durable attempt records, usage, artifacts, causal linkage, audit

Hatchet
  durable waits, retries, schedules, child work, cancellation, compensation

Envoy AI Gateway
  provider credentials, protocol translation, backend routing, fallback,
  rate limits, telemetry, redaction, provider health
```

TanStack AI workflow/orchestrator features are adapter capabilities, not Applik8s durable workflow
authority. TanStack persistence and resumable transport may be implemented through Applik8s-backed
adapters rather than copied.

## Required developer experience

Logical model declarations remain provider-neutral graph metadata. Capability markers select a compatible
adapter; they are not an alternative chat API:

```ts
import { chat } from "@tanstack/ai";
import { withPersistence } from "@tanstack/ai-persistence";

const FastModel = AI.model("fast", {
  capabilities: [
    AI.chat,
    AI.tools,
    AI.streaming,
    AI.structuredOutput,
  ],
  constraints: {
    dataResidency: ["us"],
    maximumInputCostPerMillion: 5,
  },
});

const SourceResearcherIdentity = application.serviceIdentity(
  "source-researcher",
);

const SourceResearcher = application.agent(
  "source-researcher",
  {
    identity: SourceResearcherIdentity,
    model: FastModel,
    instructions: sourceResearcherInstructions,
    tools: [
      EvidenceSearch.search,
      Source.observe,
      ExtractionProposal.create,
    ],
  },
  async (request, context) =>
    chat({
      adapter: context.tanstack.adapter,
      messages: request.messages,
      threadId: request.threadId,
      runId: context.runId,
      ...(request.resume ? { resume: request.resume } : {}),
      tools: context.tanstack.tools,
      // Required by native TanStack server tools so provider call identity and
      // the admitted ExecutionPrincipal reach Applik8s invocation admission.
      context: context.tanstack.execution,
      middleware: [
        withPersistence(context.tanstack.persistence),
      ],
    }),
);

SourceResearcherIdentity.can(
  EvidenceSearch.search,
  ExtractionProposal.create,
  Source.read.all(),
  Source.observe.where((source) => source.risk.ne("restricted")),
);

SourceResearcherIdentity.mayRequest(
  Source.observe.where((source) => source.risk.eq("restricted")),
  {
    approval: SourceOwner,
    expiresIn: "15m",
    maximumUses: 1,
    outcome: ObservationRecorded,
  },
);
```

Tools are existing operation handles. Tool schemas, authority, idempotency, target ordering, durable
results, and audit are not reimplemented in the AI adapter. `context.tanstack.tools` contains native
TanStack `ToolDefinition` values produced from those handles. Application authors may mix them with a
native TanStack tool:

Agent diagnostics distinguish:

- a tool that is unavailable under every baseline, requestable, or caller-delegated grant;
- authority that exists but is absent from the agent's tool set;
- an operation that requires caller delegation for the current run;
- a target-space subset that is approval-gated;
- an operation whose schema, placement, or result cannot be adapted as a tool.

A production agent with a tool that is neither directly authorized, requestable, nor explicitly
caller-delegated fails construction. Authority absent from the tool set is informational because the same
logical `ServiceIdentity` may be used by another runtime surface.

```ts
import { toolDefinition } from "@tanstack/ai";

const calculator = toolDefinition({
  name: "calculator",
  description: "Evaluate a bounded numerical expression.",
  inputSchema: type({ expression: "string" }),
}).server(async ({ expression }) => evaluate(expression));

const tools = [
  ...context.tanstack.tools,
  calculator,
];
```

`@applik8s/ai-tanstack` may expose an explicit `asTool(operation)` adapter for code outside an agent
context, but its return value is an upstream TanStack tool definition. It must not define an
Applik8s-only tool protocol.

The Start provides the default qualified inference capability, so ordinary model declarations do not
repeat dependency wiring. Applications with multiple inference planes may select one explicitly with a
typed qualification:

```ts
const RestrictedInference = AI.named("restricted");

const RestrictedModel = AI.model("restricted", {
  inference: application.inject(RestrictedInference),
  capabilities: [AI.chat, AI.tools],
  constraints: { dataResidency: ["us"] },
});
```

Vendor names and provider credentials never enter either form.

`application.agent(...)` must include or reference an ordinary serializable execution closure. The
metadata-only form is insufficient for an executable agent and may be used only by reflection/testing
APIs that explicitly say they do not register execution.

`context.tanstack.adapter` is the upstream TanStack model adapter resolved from the agent's declared
logical model and qualified inference provider. `context.tanstack.tools` and
`context.tanstack.persistence` are likewise upstream-compatible values. The persistence value implements
TanStack AI's server `ChatPersistence` stores and is activated through the upstream
`withPersistence(...)` middleware; it is not the best-effort browser `ChatClientPersistence` adapter.
This keeps provider DI explicit in the graph without making application closures repeat provider
selection or use a second chat API.

`context.tanstack.execution` is TanStack AI's native runtime `context` value. It carries the
request-local admitted `ExecutionPrincipal`, logical invocation ID, physical attempt ID, and canonical
internal invocation bridge. Operation-derived tools require it at the type level and fail closed when
the upstream tool-call ID is absent. Application agent closures call imported operation handles
directly; the adapter bridge is runtime machinery for TanStack's generated tool callbacks.

At the pinned `@tanstack/ai@0.42.0` baseline, `@tanstack/ai-persistence` has not yet published its server
package. `@applik8s/ai-tanstack` records that state as `unreleased` and exposes a fail-closed compatibility
gate; it does not substitute the browser-only `ChatClientPersistence` contract. The middleware line
above remains the release target and becomes executable only after the upstream server contract is
published, pinned, and passes its conformance suite.

## Owned contracts

This RFP owns:

- logical model capabilities and constraints;
- agent definitions and their distinction from logical service identities, deployed workload
  identities, and public execution principals;
- TanStack AI protocol and framework adapters;
- provider-native product conversation, message, run, run-event, usage, and model-resolution models plus
  upstream TanStack persistence/connection adapters over them;
- durable AI invocation attempts and uncertain-completion semantics;
- operation-to-tool adaptation and physical-attempt-scoped tool-proposal identity;
- provider-neutral AI gateway requirements;
- Envoy AI Gateway TypeKro and runtime adapters;
- streaming delivery and replay integration;
- AI-specific metrics, redaction, cost attribution, and evaluation seams.

It does not own application authorization, Hatchet workflow persistence, OAuth/MCP transport,
application routing, or provider credentials in domain code.

It also does not own a replacement `chat()`, message model, tool-definition protocol, React chat hook,
connection protocol, interrupt protocol, or client persistence API. Application code imports those from
TanStack AI. Applik8s adapters implement or return the upstream contracts.

The package boundary is:

```text
@applik8s/ai
  provider-neutral logical models, agent graph metadata, durable attempts,
  product records, usage, causal linkage

@applik8s/ai-tanstack
  upstream-compatible tools, connection, persistence, lock, reconstruction,
  runtime context, and framework adapters

@applik8s/runtime-envoy-ai-gateway
  server-only provider routing and gateway runtime integration
```

`@applik8s/ai-tanstack` may depend on TanStack AI. `@applik8s/ai` may use shared protocol-neutral types
but may not re-export or reproduce TanStack's application-facing API.

## Versioned protocol boundary

The implementation pins and records a compatibility tuple:

```text
TanStack AI package versions
AG-UI protocol revision
Applik8s AI adapter revision
Envoy AI Gateway release and CRD revisions
provider adapter revisions
```

The tuple appears in the application manifest and run provenance. A dependency upgrade that changes
message, tool, interrupt, stream, usage, or provider semantics requires contract fixtures and an adapter
compatibility report. Depending on an unpinned `latest` or beta range is not release-acceptable.

TanStack AI owns the application-facing client/server protocol and framework hooks. Applik8s implements
its connection, persistence, tool, and runtime-context adapter contracts rather than forking its message
or stream protocol. Experimental TanStack workflow/orchestrator features remain unavailable as durable
Applik8s workflow authority.

## Logical model resolution

Logical models select by capability and constraint, not vendor name. Resolution considers:

- input/output modalities;
- tool and structured-output support;
- reasoning support;
- context and output limits;
- latency and availability class;
- cost budget;
- data residency and compliance tags;
- allowed providers and fallback policy.

Every attempt records the logical model, resolution-policy revision, selected provider/backend, concrete
model identifier and version where observable, capabilities, route, pricing revision, and fallback chain.
Replaying a historical run does not silently resolve to a different provider unless explicitly requested.

Resolution has two stages:

1. the qualified `AI` provider selects a routing-policy revision compatible with the logical model;
2. the gateway resolves an eligible backend for the concrete attempt.

Both stages are recorded. Hard constraints fail before dispatch when no eligible route exists. Preferences
may affect weighting but cannot relax data-residency, modality, tool, structured-output, authorization, or
declared maximum-cost requirements.

Logical model names are stable application graph identities. Concrete vendor/model names remain
provider configuration. Provider-specific options require an explicit refined model capability and stay
server-only.

## Agent definitions and execution principals

An `AgentDefinition` contains instructions, logical model, declared tools, response contract, budgets,
default execution policy, and a serializable execution closure that calls TanStack AI directly. Its
associated logical `ServiceIdentity` owns baseline application authority independent of placement. The
deployed agent server authenticates through a `WorkloadIdentity`. Every execution receives a distinct
public `ExecutionPrincipal`, branded as `AgentRunPrincipal` in diagnostics and manifests, admitted by
the operation-authority runtime.

The `ExecutionPrincipal` contains causal requester, logical service identity, deployed workload identity,
run ID, delegated grants, audience, trusted-context digest, expiration, and authorization revision.
Agent source code cannot obtain broader authority by adding a tool to the definition.

This is the agent specialization of the authority RFP's execution model: `ServiceIdentity` supplies
logical baseline application authority, `WorkloadIdentity` authenticates the deployed runtime and
defines its maximum dependency envelope, and `ExecutionPrincipal` defines one narrow admitted run.
Agent/task/workflow/processor/reconcile labels are diagnostic kinds, not parallel public principal APIs.
AI tooling must not implement a competing execution-principal contract.

Instructions may be static, versioned artifacts, or server-side functions over trusted declared context.
They are recorded by content digest and must not interpolate secrets into model-visible text.

## Durable AI attempts

An AI invocation is not assumed idempotent. It uses:

```text
logical invocation
  -> attempt reserved
  -> request dispatching
  -> streaming
  -> provider completed | provider failed | completion uncertain
  -> canonical result committed
  -> downstream tool proposal or message committed
```

The record contains:

- invocation and attempt IDs;
- conversation/run/step causation;
- admitted `ExecutionPrincipal` and authority revision;
- normalized request hash and redacted metadata;
- resolved provider route;
- provider request ID where available;
- stream frontier and delivery log reference;
- token/cost measurements;
- terminal or uncertain state.

Hatchet retries never create a second attempt implicitly. The workflow asks the AI runtime whether to
join, recover, retry, or escalate an existing attempt. `completion uncertain` requires declared policy or
human intervention before another billable attempt.

Provider responses and tool calls are validated before canonical commit. A partial stream visible to a
browser is not a committed assistant message.

Attempt recovery classifies provider behavior:

```text
joinable
  provider request can be observed or resumed by request ID

replay-safe
  provider contract and application policy permit a new attempt

uncertain
  dispatch may have completed but no authoritative result is observable

terminal
  completion or declared failure is authoritative
```

The adapter must not infer retry safety merely because an HTTP request failed or a worker restarted.
Cost, usage, and rate-limit accounting retain every physical attempt even when the logical invocation
ultimately fails.

Attempt cancellation is best effort against the provider but authoritative for Applik8s follow-on work:
after cancellation is committed, no newly arriving provider output may trigger undeclared tool calls or
become a canonical assistant message.

## Conversation and delivery model

Canonical conversation state and live delivery are separate:

```text
Conversation/Message/Run records  durable product state
Run event log                    resumable delivery and progress
TanStack AI connection adapter   client protocol and reconstruction
```

TanStack AI persistence and durability interfaces should be backed by these application models where
compatible. The implementation must not maintain an unrelated private chat database. “Canonical” here
means product conversation state represented through ordinary provider-native Applik8s models; it does
not authorize Applik8s to fork TanStack's message, run, chunk, interrupt, lock, or resume semantics.

The adapter uses the following normative identity mapping:

| TanStack AI contract | Applik8s authority |
| --- | --- |
| `threadId` | `Conversation.id` within admitted application/principal scope |
| persisted messages | canonical `Message` records and their ordered conversation revision |
| TanStack persisted run | application-facing protocol/delivery run; it is not implicitly an `AgentRun`, `WorkflowRun`, or `AIInvocation` |
| `runId` | protocol/delivery-run ID causally linked to relevant agent, workflow, and invocation IDs |
| interrupt | presentation/resumption record linked to a canonical `GrantRequest`, `Approval`, or declared non-authority pause |
| metadata store | namespaced adapter metadata; never canonical permission or workflow state |
| connection/resumable-stream cursor | authorized run-event delivery frontier |
| lock store | injected distributed coordination capability scoped by conversation/run |

Applik8s implements TanStack AI persistence, lock, connection, reconstruction, and resumable-stream
contracts through adapters over these records. It runs the upstream adapter conformance suites and does
not fork TanStack message, interrupt, chunk, or resume semantics. Client-side persistence is
best-effort presentation state only; server-authoritative reconstruction always comes from admitted
canonical records. Cross-store composition declares transaction, retry, and idempotency behavior
explicitly.

Client reconnection binds to run, principal, authorization revision, and stream frontier. Revocation
closes or resets delivery without deleting canonical audit history.

The adapter preserves the distinction between:

- canonical message content;
- provider deltas;
- AG-UI delivery events;
- tool proposals and approved tool executions;
- reasoning or provider metadata that may be streamed but is not retained;
- redacted audit and usage facts.

AG-UI events use the existing authenticated Applik8s delivery boundary and bounded replay contract.
Browser clients never connect directly to model providers or Envoy administration endpoints.

## Tool execution

Operation tools preserve:

- exact input/output schema;
- stable operation ID and version;
- current `ExecutionPrincipal`;
- approval and grant requirements;
- idempotency and target ordering;
- durable result and declared errors;
- causal link to model output and attempt.

Tool names exposed to a model may be shortened or namespaced for provider limits, but the reversible
mapping to the stable operation ID is recorded. Provider-generated duplicate calls reuse the declared
tool-call identity or fail safely.

A provider tool-call ID is unique only within one physical provider attempt. The durable proposal and
operation idempotency identity contains:

```text
logical AI invocation ID
physical provider-attempt ID
provider tool-call ID
operation ID and version
normalized validated arguments hash
```

Within one physical attempt, replay of the exact tuple reuses the same durable operation command and
grant reservation. Reuse of a provider tool-call ID with another operation or argument hash is a
protocol conflict and fails closed. A new physical attempt does not deduplicate merely because a
provider reused its tool-call ID; cross-attempt semantic reuse requires an explicit application policy
and separately recorded causal identity.

Server-tool adapters invoke the internal operation boundary with the current `ExecutionPrincipal`.
Client tools are explicitly classified, presented, and confirmed through the TanStack AI protocol but
cannot perform a protected server effect without invoking an authorized operation.

Provider-supplied tool arguments are untrusted input. They pass the operation's normalized runtime schema,
size limits, target resolution, authority, and idempotency checks. Tool results are separately classified
for model visibility, browser visibility, persistence, redaction, and audit.

Human approval presentation is not approval authority. A TanStack interrupt creates or observes the
canonical Applik8s approval/grant workflow and resumes only after Hatchet observes its committed result.
The workflow issues an exported static `workflow.signal(...)` contract through
`workflow.emitSignal(...)`; its pending instance, access state, issuance event, and outbox row commit
in the primary transactional database's internal `SignalStore` transaction, and the workflow awaits
the returned one-shot callable decision. TanStack/AG-UI/SSE presents the event only after exact
issuance-read admission and hydrates only its opaque signal capability. The authenticated principal and
current authorization state determine the actor and receipt when an action is invoked; interrupt
payloads, provider messages, and client tool arguments cannot claim actor identity or create resolution
authority.

Operation-to-tool adaptation reuses the existing operation closure; it does not copy the closure into a
second AI handler. Adapting a relational model operation, CRD/resource operation, query, search, or
workflow operation uses the same path whenever the operation's schema and transport guarantees are
compatible. Unsupported client/server placement or result semantics fail construction.

## Envoy AI Gateway provider

The dedicated adapter lowers the provider-neutral contract into pinned v1beta1 resources:

- `GatewayConfig`;
- `AIGatewayRoute`;
- `AIServiceBackend`;
- `BackendSecurityPolicy`;
- optional `MCPRoute` integration owned with the MCP RFP.

It owns credentials, workload identity, backend health, routing, fallback, model rewriting, request
costs, rate limits, telemetry, and body redaction. Domain and browser code never imports its CRDs.

The starter profile uses deterministic and/or explicitly developer-supplied local inference. It is
visibly non-production and must not satisfy dedicated provider qualification.

The TypeKro integration must provide:

- explicitly owned Envoy Gateway and AI Gateway bootstrap or external prerequisites;
- `GatewayConfig`, `AIGatewayRoute`, `AIServiceBackend`, and `BackendSecurityPolicy` resources;
- provider credential Secret references and supported workload-identity paths;
- logical model rewriting and backend weighting/failover;
- rate-limit, timeout, body-size, concurrency, and retry policy;
- telemetry, usage, cost, tracing, and body-redaction configuration;
- TLS, DNS/exposure integration, NetworkPolicy, health, and complete hydrated status;
- safe update and deletion in direct and KRO modes without stranded namespaces, finalizers, or RGDs.

`MCPRoute` lifecycle is coordinated with the MCP RFP. The AI RFP owns the common gateway installation and
AI routes; the MCP RFP owns MCP routing semantics and authorization. Both consume the same released
TypeKro integration rather than creating competing installations.

The upstream TypeKro contribution must land and release before the Applik8s provider pins it.

## Hatchet workflow integration

Hatchet owns durable sequencing around AI work:

```text
workflow step
  -> reserve logical invocation
  -> dispatch or join provider attempt
  -> wait for committed result or escalation
  -> validate proposed tool operations
  -> request approval/grant when required
  -> invoke protected operation
  -> continue, compensate, or fail
```

Hatchet retries a workflow step, not a provider request. The AI runtime decides whether that step joins,
recovers, creates, or escalates an attempt. Workflow cancellation, timeout, replacement, and replay are
tested against attempt and grant state.

## Evaluations, artifacts, and usage

The AI runtime emits provider-neutral records sufficient for maintained Start modules to implement:

- datasets and versioned evaluation inputs;
- scorer definitions and evaluation results;
- prompt/model/tool/output provenance;
- typed artifact and object-storage references;
- input/output/cached/reasoning token usage where observable;
- cost with pricing-source revision and confidence;
- latency, fallback, cancellation, uncertainty, and safety outcomes.

This RFP owns the runtime seams and canonical run linkage. The Agentic Start distribution owns which
evaluation and operations experiences ship by default.

## Implementation increments

1. Pin the TanStack AI/AG-UI/Envoy compatibility tuple and define adapter dependency zones.
2. Define logical model, capability, constraint, agent definition, `ServiceIdentity`,
   `WorkloadIdentity`, and public `ExecutionPrincipal` contracts.
3. Implement the normative TanStack/Applik8s identity mapping, provider-native product conversation/run
   records, run events, usage, and persistence/lock/connection/reconstruction adapters.
4. Implement durable attempt reservation, recovery, retry, and uncertain-completion behavior.
5. Implement `@applik8s/ai-tanstack` as upstream-compatible connection, persistence, lock,
   reconstruction, runtime-context, and operation-to-tool adapters; bind typed operations as native
   TanStack tools with authority and audit.
6. Land and release TypeKro Envoy AI Gateway support.
7. Implement the dedicated provider adapter and provider E2E.
8. Add artifacts, evaluations, metrics, cost, redaction, and operations views.

## Required gates

- Browser/server bundles keep provider SDKs and credentials server-only.
- The manifest records exact TanStack AI, AG-UI, adapter, Envoy, and provider compatibility revisions.
- TanStack persistence and delivery conformance suites pass against the Applik8s adapters.
- `threadId`, protocol `runId`, `AgentRun`, `WorkflowRun`, `AIInvocation`, and physical attempt identities
  remain distinct and causally linked.
- A TanStack interrupt cannot itself create or approve canonical authority.
- Existing ArkType operation schemas pass through TanStack AI's Standard Schema tool boundary without a
  second schema declaration; normalized schema hashes remain linked to the operation catalog revision.
- Authored agent execution uses TanStack AI's `chat()` directly; no `AI.chat(...)`,
  `useApplik8sChat(...)`, parallel message protocol, or parallel tool protocol appears in public examples.
- Native TanStack tools and operation-derived tools execute together in the same agent invocation.
- Every executable agent graph node has a serializable closure and source location.
- A thin generated/server entrypoint may import an agent closure and its local helpers transitively;
  closure capture produces one bounded server runtime without reconstructing authoring metadata on each
  invocation.
- Agent tool presence does not grant authority.
- Production diagnostics fail a tool with no baseline, requestable, or declared caller-delegated
  authority and separately explain absent-tool authority, caller delegation, approval-gated target
  subsets, and incompatible tool adaptation.
- Agent definition, logical `ServiceIdentity`, deployed `WorkloadIdentity`, and public
  `ExecutionPrincipal` remain distinct; `AgentRunPrincipal` is a diagnostic/manifest kind, not a
  parallel authorization type.
- Worker restart joins or safely classifies an existing attempt instead of duplicating it.
- Hatchet retry does not directly redeliver a provider request.
- Partial streams do not become canonical completed messages.
- Tool retries preserve operation idempotency and grant-use semantics.
- Tool-call idempotency includes logical invocation, physical attempt, provider call ID, operation
  revision, and normalized arguments; exact replay reuses one command, conflicting reuse fails closed,
  and a new physical attempt cannot collide accidentally.
- Logical routing records the exact resolved backend and policy revision.
- Fallback respects capability, cost, residency, and authorization constraints.
- Cancellation stops delivery and prevents undeclared follow-on tool work.
- Client-tool presentation cannot bypass a protected server operation.
- Prompt, response, tool-result, and provider telemetry redaction pass adversarial fixtures.
- Envoy direct and KRO install, update, route/backend status, provider request, and deletion pass.
- The starter deterministic provider is visibly non-production and cannot satisfy dedicated
  qualification.

## Open questions

1. Which TanStack AI beta version becomes the v0.7 compatibility baseline?
2. Which provider protocols expose enough request identity for recovery after connection loss?
3. Which logical constraints are hard requirements versus routing preferences?
4. Should the first evaluation package be required for v0.7 or remain a Start module layered on the
   canonical run and artifact models?
5. Which non-text modalities must the v0.7 logical model and artifact contracts preserve even when the
   first acceptance slice uses primarily text?

## Definition of done

This RFP is complete when an authorized agent can stream through TanStack AI, invoke existing operations,
survive worker and connection replacement without silent duplicate attempts, record exact model/cost
provenance, and run through the qualified Envoy provider without leaking provider types into application
code. The public example must prove logical-service/deployed-workload/execution-principal separation, constrained logical
routing, resumable AG-UI delivery, a protected tool approval, an uncertain provider completion, Hatchet
recovery, cancellation, and an auditable artifact/evaluation result. Completion does not authorize v0.7.
