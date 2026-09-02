# RFP: Specialized Code and Research Agent Compositions

**Status:** Accepted mixed-maturity contract; research vertical release-blocking; provider-neutral
code-agent preview release-blocking through its local OpenCode journey; Celld/OpenCode distributed
provider deferred and blocked on upstream runtime direction as of 2026-09-02

**Audience:** Applik8s maintainers, Agentic Start authors, implementing agents, and provider authors

**Requested by:** The v0.9 semantic-completion and 1.0-readiness program

**Revised:** 2026-09-02

**Target:** Applik8s v0.9 production-qualified research vertical and code-agent preview

## Executive summary

Applik8s already has typed agents, actors, durable execution, tools, approval signals, identity/resource
authority, application events, object storage, and provider-neutral dependency injection. Code and research
agents need recognizable product surfaces. A code agent is a first-class, provider-neutral semantic
execution-family node. Its placement and persistence are properties of the selected `AgentHarness`, not
of the application-domain declaration.

This RFP defines `codeAgent()` and `researchAgent()` as maintained application modules. They bundle useful
capability contracts, defaults, events, evidence, and UI integration while remaining replaceable. The
code-agent module registers a dedicated graph node. v0.9 qualifies the real local/worktree OpenCode path;
distributed implementations remain replaceable behind `AgentHarness`. SearXNG is one
`WebSearch` provider. Neither provider becomes part of application semantics.

The research vertical is a v0.9 release requirement. The code-agent vertical remains preview. Neither may
widen shell, repository, network, or search authority merely because an application uses a convenient
composition.

## Existing functionality that must not be duplicated

| Capability | Existing boundary to reuse |
| --- | --- |
| Agent identity and turns | `agent()` and actor/durable execution contracts |
| Model inference | `AI.model()` and provider injection |
| Tools | Typed callable application operations and authority receipts |
| Human decisions | Durable signal capabilities and application events |
| Files/artifacts | Object storage and application artifact contracts |
| Lifecycle | Actor/workflow/job evidence and OpenTelemetry |
| UI | Agentic Start conversation, review, artifact, and operations modules |

## At a glance

```ts title="src/agents/product-builder.ts"
const CodingHarness = AgentHarness.named("coding");
const Workspace = CodeWorkspace.named("primary");
const Source = SourceRepository.named("primary");

export const ProductBuilder = application.include(
  codeAgent("product-builder.v1", {
    identity: CoderIdentity,
    model: CodingModel,
    harness: CodingHarness,
    workspace: Workspace,
    source: Source,
    process: ProcessRunner.named("bounded"),
    validation: [
      { executable: "bun", arguments: ["test"] },
      { executable: "bun", arguments: ["run", "typecheck"] },
    ],
  }),
);

export const MarketResearcher = application.include(
  researchAgent("market-research.v1", {
    contract: {
      input: ResearchRequest,
      output: ResearchReport,
    },
    actor: { key: ResearchThreadId },
    identity: ResearcherIdentity,
    model: ResearchModel,
    search: WebSearch.named("research"),
    retrieve: SourceRetriever.named("research"),
    evidence: ResearchEvidence,
    publish: SaveArtifact,
    tools: [FetchDocument],
  }),
);

const report = await MarketResearcher({
  threadId,
  question: "Which approaches have the strongest primary-source evidence?",
});
```

## Problem statement

Every application can compose a general agent with shell, workspace, source, search, and evidence tools,
but rebuilding safe conventions repeatedly creates inconsistent authority, lifecycle, events, UI, and
provider assumptions. Conversely, a specialized inheritance tree or provider-shaped runtime would split
the framework.

The framework needs batteries-included compositions whose convenience does not obscure or widen their
underlying contracts.

## Normative decisions

1. Specialized agents are application modules, not subclasses. `codeAgent()` registers a first-class
   provider-neutral semantic node; `researchAgent()` composes the general agent model.
2. `codeAgent()` and `researchAgent()` return reusable modules; `application.include(...)` is the canonical
   registration spelling and returns an ordinary Promise-returning callable handle.
3. Research agents declare their durable thread key. Code agents use the required `repositoryId` as their
   stable isolation and fencing key without exposing a provider-specific actor or cell identity.
4. Every powerful capability is explicit in the declaration and application plan.
5. Provider implementations are replaceable behind small interfaces.
6. OpenCode v2 behind `AgentHarness` is the maintained first-party code-agent implementation in v0.9.
   The local/worktree provider is the release-qualified preview path. A distributed Celld provider is a
   later milestone and must not be approximated by reimplementing OpenCode's filesystem or agent loop.
7. SearXNG is a `WebSearch` provider, not the public research API.
8. Workspace, repository, shell/process, browser, network, and evidence capabilities remain separable.
9. Human approvals use existing signal/event authority; no special approval channel is invented.
10. Specialized lifecycle facts enter `application.events` only according to declared contracts.
11. `researchAgent()`, `WebSearch`, `ResearchEvidence`, the maintained SearXNG provider, the local
    `codeAgent()` OpenCode journey, and Builder block v0.9 release qualification. The code and Builder
    surfaces remain preview maturity, but each included path must pass its complete real-provider journey.

## Architectural boundary

Applik8s owns the high-level compositions, capability interfaces, graph expansion, authority, lifecycle,
events, evidence, and conformance. Harness, workspace, repository, process, search, and model providers own
their physical implementations. Applications own tools, product behavior, configuration, and approval
policy.

## Capability contracts

### `AgentHarness`

Runs an agent loop against a model and typed tools. It owns provider session adaptation, streaming, context
limits, tool protocol translation, cancellation, and harness evidence.

### `CodeWorkspace`

Provides a leased filesystem/worktree with a stable workspace reference, lifecycle, capacity limits,
snapshot/export behavior, and ownership-safe cleanup.

### `SourceRepository`

Provides read/change/diff/commit operations under repository-specific authority. It does not imply shell
or network access.

### `ProcessRunner`

Executes declared processes under command, environment, working-directory, time, output, and network
limits. Raw unrestricted shell is never a hidden default.

### `WebSearch`

Returns normalized result/evidence contracts with provider, query, time, locale, and safe-fetch metadata.

The stable request includes a non-empty query, bounded result count, locale/language when relevant,
deadline, safe-search policy, and an admission/idempotency identity. The normalized result contains title,
canonical URL, provider rank, snippet, source/provider identity, retrieval eligibility, and an opaque
provider receipt. Provider-specific response objects never cross the capability boundary.

### `SourceRetriever`

Retrieves an explicitly selected search result under separate network authority. It owns URL
canonicalization, redirect limits, DNS rebinding protection, private/link-local/metadata-address denial,
scheme and port policy, byte/time/content-type limits, decompression bounds, cancellation, and normalized
document extraction. Search authority alone never grants retrieval authority.

JavaScript-rendered retrieval and interactive browser sessions are governed by
[`rfp-v09-durable-browser-actors.md`](rfp-v09-durable-browser-actors.md). A browser-backed implementation
must preserve this provider-neutral result/evidence contract; research application code never branches on
Moli or a browser protocol.

### `ResearchEvidence`

Stores citations, retrieved snapshots or hashes, provenance, synthesis links, and redaction policy.

Each evidence record contains the stable research run, logical query and retrieval identities, canonical
source URL, search receipt, retrieval timestamp, content digest, snapshot or licensed-reference policy,
extracted citation spans, visibility authority, and causal artifact links. Evidence is append-safe and
deduplicated by logical identity plus content digest; mutable pages create new evidence versions rather
than rewriting prior cited evidence.

## Stable research contract

`researchAgent()` is callable with its declared ArkType input and returns its declared ArkType output. The
composition requires a stable actor key, identity, model, `WebSearch`, `SourceRetriever`,
`ResearchEvidence`, and artifact implementation. Optional application tools are ordinary typed operations
and receive no implicit search, retrieval, or evidence authority.

The terminal result is one of:

- `completed`, with an artifact reference and complete citation/evidence references;
- `partial`, with an artifact or structured findings, retained evidence, unresolved claims, and typed
  reason;
- `failed`, with no claim of completed synthesis and references to any safely retained evidence.

Transport loss, timeout, provider unavailability, and malformed sources cannot be represented as an empty
successful report. Callable admission uses the shared effect receipt/fencing/unknown-outcome contract.
The run, each logical query, each selected-source retrieval, each evidence commit, and artifact publication
have stable idempotency identities. A retry reattaches to committed work and never infers completion from
transport loss.

## Code-agent lifecycle

A code-agent run leases or resumes a workspace, hydrates repository and process capabilities, executes the
normal agent/actor loop, emits inspectable changes and evidence, and releases or retains the workspace
according to policy.

The durable identity is the repository-scoped actor identity plus a per-request stable run identity and a
serializable workspace reference. The actor serializes turns for one repository, while effect receipts
preserve each admitted run independently and the workspace lease fences the single active writer.
Replacing a pod or harness does not create a new logical agent or run. Workspace loss is an explicit
terminal/recovery event.

## Research-agent lifecycle

A research-agent run records normalized queries, selected sources, retrieval evidence, model synthesis,
artifact output, and unresolved claims. Search results are untrusted data, not instructions. Evidence
visibility follows the caller's authority and source licensing constraints.

The durable phase order is admission, bounded query planning, search, source selection, safe retrieval,
evidence commit, synthesis, artifact commit, and terminal receipt. Queries and retrievals may execute with
declared bounded concurrency, but evidence and terminal state advance only after their durable receipts
are recorded. Cancellation prevents new work, preserves committed evidence, cancels outstanding provider
calls, and produces an inspectable terminal or resumable state according to policy.

## Authority and safety

The plan separately lists:

- repository read/write scope;
- shell/process allowlist and environment exposure;
- network destinations;
- secret capabilities;
- browser/session access;
- application operations/tools;
- approval gates;
- workspace retention and deletion.

For research agents it additionally lists query disclosure classification, permitted search providers,
retrieval egress policy, evidence visibility/retention, source snapshot policy, artifact publication
authority, concurrency, budgets, and provider credentials. Raw user prompts and Secret-bearing context are
not sent as search queries unless an explicit disclosure policy authorizes that transformation.

A high-level `codeAgent()` default may be ergonomic, but it cannot silently combine those scopes. Secure
Starter defaults remain narrow; elevated examples show the explicit grant.

## Events and evidence

Application facts may include run requested, artifact proposed, review requested/resolved, changes ready,
research completed, or terminal failure. Token chunks, individual tool polling, and harness heartbeats are
operational telemetry unless promoted.

Every artifact links to the causal run, model/provider, tool receipts, workspace/repository revision, and
approvals that authorized it.

## Graph and plan

The graph expands specialized compositions into their ordinary agent, actor, model, capability, workspace,
tool, event, and infrastructure nodes. `applik8s explain` presents both the concise composition and expanded
dependencies. No opaque “agent platform” node hides security or cost.

## Provider implementations

The maintained v0.9 research vertical includes:

- SearXNG-backed `WebSearch` composed with TypeKro and deployed through TypeKro's Alchemy integration;
- an external SearXNG binding that owns no infrastructure;
- safe, bounded retrieval of selected result documents;
- durable `ResearchEvidence` persistence and artifact/citation linkage.

The maintained preview code vertical includes:

- a real local/worktree OpenCode v2 `AgentHarness` implementation;
- a local/worktree `CodeWorkspace`;
- Git source operations;
- a bounded process runner.

These provider-neutral contracts are published from `@applik8s/code-agent`. The local adapter is a runtime
implementation below those contracts, so importing the composition does not make OpenCode part of
application semantics. Test doubles may implement `AgentHarness` for component tests. Distributed
providers may be added after they satisfy the same contract and lifecycle suite; none is claimed by v0.9.

A direct HTTP search adapter may be supplied when explicitly configured, but it is not a substitute for
the managed and external SearXNG qualification gates.

Provider conformance tests cover cancellation, restart, capability scoping, secret redaction, output
limits, workspace replacement, source provenance, and teardown.

Specialized agents standardize both semantic and implementation composition. `codeAgent()` and
`researchAgent()` accept capability handles or implementation values for Agent harness,
workspace, repository, search, browser, process, and evidence dependencies. Inline dependencies remain
private to the composition; separately provided handles remain reusable application capabilities. The
expanded graph preserves each implementation identity, lifecycle, authority, readiness, and migration.

## Deferred Celld/OpenCode distributed provider

The provider-neutral `codeAgent()` and `AgentHarness` contracts remain part of v0.9. The attempted
Celld-native OpenCode provider is not. OpenCode currently requires filesystem and process behavior that
the released Celld Workerd runtime does not provide, and Applik8s will not ship a partial virtual
filesystem, an OpenCode-specific runtime fork, or a second authority disguised as compatibility code.

The complete experimental implementation is preserved on `codex/v0.9-celld-opencode-parked`. It is
blocked pending the upstream Celld maintainers' response on whether the missing Workerd-compatible
filesystem/process surface belongs upstream and whether they will accept a contribution. This is a
later-milestone provider investigation, not a v0.9 release gate. The upstream discussion is tracked at
<https://github.com/denoland/celld/issues/180#issuecomment-5508529943>.

Resuming the provider requires an explicit design decision and the following evidence:

- one pinned OpenCode artifact initializes and performs real filesystem and process work;
- suspension, restoration, worker replacement, cancellation, and retry reattach to one logical run;
- repository writes remain fenced and capability-scoped;
- credentials, network access, output, CPU, memory, and storage are bounded;
- cleanup is ordered and leaves no runtime, lease, workspace, or authorization residue; and
- the implementation does not widen the general Celld actor provider or leak Celld into application APIs.

A future Rivet agentOS or other distributed harness may qualify against the same contract. Provider
selection must not alter application-domain code or make any particular actor runtime authoritative for
application models, commands, workflows, identity, or audit history.
## Agentic Start integration

Agentic Start may offer these modules as configurable application features:

- conversation and run timeline;
- workspace/change review;
- artifact library;
- research source/evidence view;
- approval inbox;
- operations status.

The generated application owns its domain composition and configuration. Reusable harness, workspace,
search, evidence, health, and UI primitives belong in maintained packages where they have independent
consumer value.

## Diagnostics

- `CODE_AGENT_WORKSPACE_UNAVAILABLE`
- `CODE_AGENT_PROCESS_NOT_AUTHORIZED`
- `CODE_AGENT_NETWORK_NOT_AUTHORIZED`
- `CODE_AGENT_WORKSPACE_LOST`
- `RESEARCH_SEARCH_PROVIDER_UNAVAILABLE`
- `RESEARCH_SEARCH_ADMISSION_UNKNOWN`
- `RESEARCH_SOURCE_RETRIEVAL_NOT_AUTHORIZED`
- `RESEARCH_SOURCE_REJECTED`
- `RESEARCH_SOURCE_LIMIT_EXCEEDED`
- `RESEARCH_EVIDENCE_INCOMPLETE`
- `RESEARCH_ARTIFACT_PUBLICATION_UNKNOWN`
- `AGENT_HARNESS_PROVIDER_INCOMPATIBLE`

## Implementation increments

1. Freeze the small capability contracts and composition expansion.
2. Qualify the local/worktree OpenCode v2 harness and workspace provider behind those contracts; retain
   distributed harnesses as later provider work.
3. Build WebSearch/ResearchEvidence with managed and external SearXNG providers.
4. Complete search, safe retrieval, evidence, citation, artifact, signal, event, and Agentic Start
   integration.
5. Add plan, authority, lifecycle, interruption recovery, OpenCode process replacement, upgrade, and
   cleanup evidence for the qualified local provider.

## Acceptance

- A typed research request completes through search, selected-source retrieval, durable evidence, citation
  linkage, and authorized artifact publication.
- Interruptions after query admission, retrieval, evidence commit, and artifact commit recover without
  duplicate logical work or loss of committed evidence.
- Search, retrieval, evidence visibility, artifact publication, and browser observation are separately
  authorized and produce causal receipts/events.
- Managed SearXNG passes create, readiness, query, update, restart, provider replacement, and ordered
  teardown on the maintained Kubernetes profile through TypeKro's Alchemy integration.
- External SearXNG owns no infrastructure and passes the same provider-neutral WebSearch conformance.
- Malicious, malformed, oversized, disallowed, and unreachable results remain untrusted, bounded, and
  inspectable; they cannot grant tools or become instructions.
- Replacing the harness behind the provider-neutral contract or swapping a maintained search provider does
  not change agent domain code; v0.9 does not require a second first-party harness implementation.
- Expanded plans expose every powerful capability and scope.
- Workspace and agent identity survive runtime replacement correctly.
- A real public `codeAgent()` runs through the pinned local/worktree OpenCode provider rather than a
  protocol double, while preserving stable run/workspace identity and fenced repository writes.
- The exact OpenCode package version is frozen in release evidence; no floating development tag
  participates in a reproducible v0.9 build.
- The preview explicitly scopes shell, filesystem, repository, network, Secret, and Git authority;
  cancellation and ordered teardown leave no process, lease, workspace, volume, or authorization residue.
- OpenCode process replacement preserves run/workspace identity and is demonstrated explicitly; this
  cannot be inferred from protocol compatibility.
- Builder's loopback OpenCode mode is qualified separately and remains functional when Celld and the
  generated application are absent.
- Approval and event behavior use the same framework contracts as other applications.
- Agentic Start demonstrates both the research journey and code journey end to end, with the code journey
  clearly labeled preview maturity.
- Research-vertical, local code-agent, or Builder qualification failure blocks v0.9. The deferred
  Celld/OpenCode provider does not.

## Non-goals

- a new agent runtime;
- a specialized inheritance hierarchy;
- unrestricted shell/network defaults;
- OpenCode or SearXNG as public semantics;
- a separate approval, event, identity, or artifact system.

## Definition of done

The research vertical is complete when it feels batteries-included in Agentic Start, passes its managed
and external provider lifecycle gates, and its expanded graph proves that every behavior is ordinary
Applik8s composition with replaceable providers and explicit authority. The code vertical may ship as a
credible preview after the complete local/worktree OpenCode evidence above. Distributed Celld/OpenCode
qualification remains explicitly blocked and deferred rather than being represented by a protocol double.
