# RFP: Builder Development Environment

**Status:** Accepted preview contract; architecture frozen on 2026-08-30

**Audience:** Applik8s maintainers, Agentic Start authors, developer-tooling implementers, and security reviewers

**Requested by:** The v0.9 specialized-agent and product-legibility program

**Revised:** 2026-08-30

**Target:** Applik8s v0.9 release-blocking preview; development-only in Agentic Start and non-stable for 1.0

**Contract lineage:** Refines and supersedes the accepted v0.8 Independent Development Environment and
Coding Agent RFP only where this document says so explicitly. Its independent daemon/portal,
visual-selection provenance, persistent attachment/referent, mutation journal, undo, recovery, security,
and production-exclusion contracts remain normative.

**Deployment disposition:** The daemon and portal remain local-only in v0.9. They may plan or operate a
separately authorized application deployment, but deployed-profile support does not expose or
deploy Builder remotely.

## Executive summary

Applik8s can explain an application graph, derive infrastructure, run journeys, and compose a code agent
from an actor, model, harness, workspace, repository, process, and approval capabilities. Those pieces
should produce a development experience that is more approachable than a collection of CLI commands.

This RFP evolves that accepted v0.8 environment rather than creating another one. Builder remains an
independent portal and daemon that survives malformed source, compile failure, route crashes, and generated
application downtime. A developer can describe a change or select an element, text range, or bounded region
in the running product; inspect the resolved source, graph, trace, runtime, and plan context; review file and
semantic diffs; run targeted journeys; open a live preview; and explicitly apply, undo, or reject the
change.

Agentic Start includes Builder development integration and configuration in its development experience.
Applications may disable the disposable bridge after generation, and the independent Builder daemon and
portal are excluded from production bundles and routes unless an application deliberately productizes
them. OpenCode may implement the initial
`AgentHarness`; it is not the public API or durable identity.

## Existing functionality that must not be duplicated

| Capability | Existing boundary to reuse |
| --- | --- |
| Code execution | `codeAgent()` and replaceable `AgentHarness` |
| Durable identity | Existing actor/agent identity and run semantics |
| Repository/workspace | `SourceRepository` and `CodeWorkspace` capabilities |
| Change understanding | Compiler source graph, application graph, `explain`, and `plan` |
| Verification | `journey()`, unit/integration gates, and provider conformance |
| Preview | Existing Vite/local development runtime and generated application host |
| Approval | Typed signals, authorization receipts, and application events |
| UI | Agentic Start shell and reusable conversation/artifact/review components |
| Independent development host | Accepted v0.8 daemon, portal, local supervisor, protocol, authentication, and recovery model |
| Product-context bridge | Accepted v0.8 disposable toolbar, visual selection, provenance resolution, attachments, and referents |
| Mutation recovery | Accepted v0.8 optimistic patch, durable change journal, validation, evidence, and undo contracts |

Builder composes these pieces. It must not create another agent runtime, repository protocol, test runner,
or deployment authority.

## Inherited v0.8 contract

The following behavior is preserved without reinterpretation:

- one `applik8s dev` command starts the mutable application and a separately healthy development daemon;
- the portal remains usable when application source does not parse, compile, start, or serve routes;
- the generated application contains only an optional disposable development toolbar;
- element, text, and bounded-region selection resolves progressively through route/component provenance,
  captured source revision, application graph, authority, runtime evidence, traces, and `ApplicationPlan`;
- resolution is evidence-bearing and classified as `exact`, `candidate`, `stale`, `unresolved`, or
  `external`;
- conversation context consists of explicit immutable attachments and visible named referents rather than
  opaque provider memory;
- attachments can be inspected, redacted, detached, renamed, pinned, re-resolved, or deleted according to
  journal policy;
- source mutation uses a durable plan, reviewed diff, scoped approval, optimistic preconditions, validation,
  evidence, and conflict-aware undo;
- unrelated dirty-worktree state survives apply and undo byte-for-byte;
- the OpenCode server remains a loopback child/provider behind an Applik8s protocol, never a browser or
  application endpoint;
- command admission, source egress, secrets, origins, CSRF, replay, and prompt-injection remain enforced by
  the daemon; and
- portal, toolbar, provider, and development provenance are excluded from production artifacts by default.

The v0.9 refinement adds function-native `codeAgent()` composition, `journey()` impact selection, the
canonical application graph and plan contracts, normalized conversation events, reusable packaged UI,
and the Conversation/Plan/Changes/Preview/Evidence organization below. It does not delete the inherited
product-context or recovery experience.

This document is self-contained normative authority for those inherited guarantees. Implementations may
cite older design evidence, but no missing or unpublished v0.8 document is required to determine Builder's
protocol, state ownership, security, recovery, or acceptance behavior.

## Closed v0.9 preview slice

The v0.9 preview is one complete change journey, not a general browser IDE. Its required product boundary
is closed to:

```text
open project
  -> establish/read isolated workspace
  -> converse with one configured codeAgent
  -> inspect proposed source + graph + plan impact
  -> approve one bounded workspace mutation
  -> review source and semantic diffs
  -> run compiler-selected checks and journeys
  -> open/refresh one local preview
  -> apply to the working tree or discard
  -> undo an applied agent-owned change when preconditions still hold
```

The five Builder views—Conversation, Plan, Changes, Preview, and Evidence—are the complete primary
navigation for that journey. Home, Graph, Runtime, and Deployments remain read-oriented supporting views.
v0.9 does not add a terminal emulator, file-tree editor, issue tracker, multi-agent orchestration board,
production deployment console, generic low-code designer, or autonomous Git hosting workflow.

One visual-selection path is required because it is inherited v0.8 behavior, but visual design tooling is
not a separate workstream. The selection becomes a visible attachment to the same change journey.

Packaging is deliberately dense rather than fragmented:

- `@applik8s/dev` owns the daemon, protocol entrypoint, journal, local supervisor, and portal application;
- maintained `AgentHarness`, workspace, repository, and process implementations remain in their provider
  packages;
- reusable UI components stay internal to `@applik8s/dev` until a second independent product consumer
  justifies a public package;
- generated applications contain only `builder({ application, agent, journeys, policy? })`, product-owned
  journeys/tools/copy, and the disposable development toolbar.

Builder remains preview rather than a stable 1.0 contract. Shipping v0.9 still requires the complete closed
journey above; preview maturity permits API evolution, not a collection of disconnected screens or
unverifiable success states.

Builder is a committed, release-blocking v0.9 preview. The closed journey must pass against a real loopback
OpenCode process before v0.9 may ship. Protocol doubles remain useful component evidence but cannot qualify
the preview. Preview maturity permits compatibility evolution after v0.9; it does not permit removing,
hiding, relabeling, or partially shipping Builder to make the release pass. The separately qualified
distributed `codeAgent()` → Celld → OpenCode path is neither a prerequisite nor a substitute for this
independent Builder journey.

## Architecture

```text
Browser
  +-- generated application
  |     +-- disposable development toolbar
  |           +-- element/text/region selection
  |           +-- bounded provenance and portal bridge
  |
  +-- independent Builder portal
        +-- Home / Builder / Graph / Runtime / Deployments
        +-- Conversation / Plan / Changes / Preview / Evidence
                |
                v
Independent Applik8s development daemon
  +-- local supervisor and stable recovery API
  +-- workspace broker and change journal
  +-- visual/source/graph/trace/plan resolver
  +-- attachment and named-referent store
  +-- validation, evidence, and undo engine
  +-- provider-neutral AgentHarness adapter
          |
          +-- OpenCode or another managed provider

Mutable generated application
  +-- may compile, crash, restart, or disappear without taking Builder down
```

## Protocol and state authorities

The portal communicates only with the independent daemon through a versioned
`applik8s.builder/v1alpha1` protocol. Requests carry project, workspace, user-session, source revision,
origin, idempotency, and CSRF/replay identity. Server-streamed events carry monotonically ordered thread/run
positions and resumable cursors. Unknown protocol versions fail with an upgrade diagnostic; neither side
guesses compatibility.

The initial protocol resources are:

```text
projects
workspaces and leases
threads, runs, and normalized run events
attachments and referents
plans and scoped approvals
change journals and apply/undo receipts
preview sessions
validation/evidence bundles
health and recovery state
```

State ownership is singular:

| State | Canonical authority |
| --- | --- |
| Source and user-owned dirty changes | User repository/worktree |
| Agent overlay and inverse hunks | Builder mutation journal |
| Thread/run/attachment/referent history | Builder daemon store |
| Agent execution attempts | Selected `AgentHarness`, referenced by stable Builder run ID |
| Application graph and plan | Compiler-produced versioned artifacts |
| Journey/test results | Evidence bundle produced by the selected runner |
| Preview processes | Preview lease/supervisor |
| Deployment state | Normal Applik8s deployment authority, never Builder journal |

Provider memory, browser storage, OpenCode sessions, chat transcripts, Git commits, and the generated
application database are not substitute authorities for these records.

The ignored development journal has a versioned checksummed record schema and append/commit markers. On
restart, the daemon validates the longest complete prefix, reconstructs leases and process ownership,
marks uncertain mutations for review, and never automatically reapplies or undoes an uncommitted tail.
Schema migration is forward-only with an explicit backup/rollback copy; an unsupported journal version
opens recovery mode without mutating the repository.

## Product experience

The portal retains the v0.8 Home, Builder, Graph, Runtime, and Deployments surfaces. Inside the Builder
workspace, five linked views organize the change journey.

Builder has five primary views.

### Conversation

The default view is a focused conversation with the repository-aware code agent. It streams meaningful
run states, tool results, questions, and proposed outcomes. Operational token/tool noise remains available
in evidence, not mixed into the primary conversation.

### Plan

Before mutation, Builder shows:

- the interpreted goal;
- files and public contracts likely to change;
- affected application graph nodes;
- provider/infrastructure consequences from `applik8s plan`;
- impacted journeys and validation gates;
- required repository, process, network, secret, and deployment authority.

The user can refine the plan through conversation. A plan is not represented as completed work.

### Changes

Changes are shown as a structured file tree and diff with generated/source distinctions, diagnostics,
format/test state, and links back to the causative conversation step. The agent cannot hide edited files or
collapse a failing generated artifact into success.

### Preview

Builder starts or attaches to the application's declared development runtime and provides a live preview,
server/runtime status, relevant logs, and journey entry points. Local volume/watch behavior uses normal
Applik8s development aspects rather than a separate deployment path.

### Evidence

Evidence unifies journey results, typecheck/tests, graph/plan diff, runtime traces, provider diagnostics,
approval receipts, and undo state. It answers what was verified, what remains unverified, and how to return
to the last reviewed state.

## Visual product-context bridge

When the application is healthy, the disposable toolbar supports accessible inspect modes for one element,
an exact text range, or a bounded component region. It submits a project/run/origin/revision-bound selection
reference to the independent daemon. It does not submit arbitrary DOM, cookies, storage, form values,
screenshots, or user content by default.

The daemon resolves the selection progressively:

```text
visual selection
  -> route and development-only component provenance
  -> source module, component, and captured revision
  -> application feature/module
  -> typed model/query/operation/event/workflow/agent handles
  -> authority and provider dependencies
  -> matching runtime trace and health evidence
  -> semantic and physical ApplicationPlan nodes
```

Only compiler-known provenance and typed handle dependencies establish exact relationships. Text
similarity, component names, DOM attributes, CSS selectors, runtime coincidence, and model inference may
suggest bounded candidates but cannot claim exact provenance.

Resolution is explicit:

- `exact` — one current compiler-proven source/graph identity;
- `candidate` — several bounded possibilities requiring selection;
- `stale` — source/runtime revision changed after capture;
- `unresolved` — the attachment is retained without invented provenance; and
- `external` — third-party or browser-native UI outside compiler-owned provenance.

SSR and hydration resolve to the same source identity where Applik8s owns both render paths. Hot reload
preserves an unchanged identity or marks the selection stale; it never retargets whichever element later
occupies the same position.

The developer reviews resolved context before it reaches the coding provider and may remove selected text,
snapshots, source, traces, or plan nodes independently. Selected page content remains untrusted data and
cannot grant tools, expand approvals, or become instructions.

## Persistent attachments and named referents

Builder context is explicit and durable:

```ts
type BuilderContextAttachment =
  | VisualSelectionAttachment
  | VisualSnapshotAttachment
  | SourceAttachment
  | GraphNodeAttachment
  | OperationAttachment
  | RuntimeTraceAttachment
  | ApplicationPlanNodeAttachment
  | ValidationEvidenceAttachment;

interface BuilderReferent {
  id: string;
  label: string;
  attachmentIds: readonly string[];
  capturedAtRevision: string;
  resolution: "current" | "stale" | "partial" | "unresolved";
}
```

Attachments are immutable and digest-addressed in the development journal. A named referent such as
`@publish-control` groups them across turns. Re-resolution creates a new record and exposes drift; it does
not rewrite history.

Users can attach, detach, rename, replace, pin, or delete retained payloads according to policy. Builder
responses and plans list the referents they used. Ambiguous phrases such as “that” resolve only when one
unambiguous active referent exists; otherwise Builder asks instead of guessing. Attachment presence never
grants source, runtime, application, or deployment authority.

## At a glance

The generated Agentic Start development entrypoint remains configuration-light:

```ts title="src/builder.ts"
export const Builder = builder({
  agent: ProductBuilder,
  application,
  journeys: [CreateWorkspaceJourney, PublishDocumentJourney],
});
```

Most dependencies are inferred from the supplied application and agent. Explicit configuration exists for
policy and product choices, not framework wiring.

## User journey

1. Run `applik8s dev` from a generated or existing application.
2. Open Builder from the local development URL.
3. Ask: “Add organization-scoped document archiving and show it in settings.”
4. Builder explains the goal, locates models/routes/authority/journeys, and proposes a plan.
5. The developer approves repository mutation for the leased workspace.
6. The agent edits source and streams meaningful progress.
7. Builder shows source diff, graph/plan diff, targeted journey results, and live preview.
8. The developer requests revisions, accepts the workspace changes, or discards them.
9. Git commit/push/PR actions require separate explicit capabilities and approval.

A product-anchored journey begins from the running application:

1. Enable Inspect mode and select the “Publish” action.
2. Ask Builder to require a second reviewer for enterprise workspaces.
3. Inspect the exact/candidate source, operation, authority, workflow, runtime, and plan resolution.
4. Name the selection `@publish-control` and remove any context that should not reach the provider.
5. Review the cross-layer plan, code and graph diffs, affected journeys, and approval scope.
6. Apply, validate, preview, and retain evidence linked to the original referent.
7. Undo the agent-owned change or keep it; unrelated work remains untouched.

## Normative decisions

1. Builder is a development product surface, not a production application runtime.
2. Its portal and daemon remain independent from the mutable generated application and survive its failure.
3. Conversation, plan, changes, preview, and evidence are separate but linked views.
4. Visual selection, provenance, attachments, referents, journal recovery, and undo remain first-class.
5. The durable identity is the normal code agent plus workspace lease, not an OpenCode session.
6. The agent reads the repository, application graph, documentation, and generated contracts through typed
   capabilities.
7. Repository mutation, process execution, network, secrets, deployment, commit, push, and PR operations
   are separately authorized.
8. No mutation occurs merely because a prompt or visual selection was submitted; the configured workspace policy governs when
   approval is required.
9. Generated code is regenerated through canonical commands, not hand-edited silently.
10. The UI distinguishes proposed, edited, verified, applied, undone, and published states.
11. A passing test never implies an unrun target or journey passed.
12. The module is tree-shaken/excluded from production unless explicitly enabled as application behavior.
13. Provider adapters remain below `AgentHarness`, workspace, search, and source contracts.
14. Every applied or undone change has a causal run and evidence bundle.
15. Builder is assembled from the same composable implementation values as the rest of Applik8s. Agent,
    harness, repository, workspace, process, preview, and journey implementations may be inline or
    separately provided without leaking their private capabilities into generated applications.
16. **Builder** names only the independent repository-development daemon/portal and its change journey.
    Generated application administration for agents, knowledge, evaluations, or integrations uses a
    product-owned label such as **Agent Studio** or **Configure**; it must not reuse Builder for a distinct
    in-application authority surface.

## Architectural boundary

Applik8s owns the independent daemon/portal protocol, Builder's development-only composition,
provider-neutral conversation protocol, visual-provenance bridge, attachments/referents, mutation journal,
graph/plan/journey integration, workspace handoff, validation/undo, authority separation, and reusable UI
contracts. The code-agent and workspace providers own execution. Agentic Start owns its domain
configuration and product journeys. The user's repository and deployment authorities remain the final
mutation boundary.

## Repository awareness

The agent receives a compact, refreshable project context:

- repository structure and instructions;
- public package and module ownership;
- source dependency graph;
- semantic application graph;
- current graph/plan and proposed diff;
- relevant canonical docs/RFP disposition;
- impacted journeys and tests;
- dirty worktree ownership and protected files;
- configured development profile, concrete provider bindings, and physical-plan evidence.

Context is retrieved on demand rather than embedding the entire repository into every turn. Untrusted
repository content remains data, not system instruction.

## Workspace lifecycle

Builder uses an isolated leased workspace/worktree by default. The lease records base revision, user-owned
dirty state, agent changes, generated artifacts, process sessions, preview deployment, retention, and
cleanup.

Applying changes performs a three-way, conflict-aware handoff. It never overwrites unrelated user changes.
Discarding a workspace terminates owned processes and previews before deletion. A failed cleanup remains
visible and retryable.

An ignored local development journal durably records file digests, approved plans, patches, validation
receipts, attachments/referents, apply state, and inverse agent-owned hunks. It uses checksummed,
migration-aware recovery and preserves the last verified prefix after corruption. Undo applies only when
current file preconditions still match; otherwise Builder presents a conflict. Git may provide user-invoked
checkpoints, but automatic commits are not the sole recovery mechanism.

## Authority and secrets

Builder starts with read-only repository and graph access. Higher-risk actions use explicit scoped grants:

```text
edit workspace
run declared commands
access named environment values/secrets
use network destinations
start local/deployed preview
apply to working tree
commit
push
open pull request
```

Secrets are exposed only to the named process/provider capability, not injected into the model transcript,
diff, logs, or evidence. `.env` files may configure local or production deployments, but Builder does not
read their secret values to summarize or reason about configuration.

The toolbar bridge is short-lived and limited to portal discovery and selection submission. It cannot read
files, run diagnostics, call providers, apply patches, or deploy. The daemon rejects hostile origins,
cross-project identities, replay, stale revisions, oversized payloads, and capability reuse. Prompt
injection in repository files, selected DOM/text, logs, dependencies, artifacts, and provider output cannot
expand tools or approvals.

## Development deployment

The preview uses the ordinary application deployment graph plus development aspects for:

- source volume mounts;
- file watching and hot reload;
- local service endpoints;
- development identity fixtures;
- ephemeral provider substitutes where selected;
- bounded cleanup ownership.

Production `.env` deployment remains supported according to application configuration. Development aspects
do not redefine production dependency injection.

## Conversation protocol

Builder adopts a provider-neutral thread/run/event contract. AgentHarness-specific events normalize into:

- user/assistant messages;
- run state and progress;
- typed tool call/result summaries;
- questions and approvals;
- plan revisions;
- explicit attachments and named referents;
- artifact/diff/preview references;
- undo and recovery receipts;
- terminal result/error.

This enables OpenCode initially and another harness later without replacing the UI/domain model.

## Graph and plan integration

Before and after a proposed source change, Builder compiles the application in analysis mode. It displays
semantic additions/removals, authority changes, provider changes, destructive lifecycle effects, new
secrets/network access, capacity/cost hints, and maturity changes.

If compilation fails, Builder reports the source-attributed diagnostic and does not fabricate a graph diff.

## Verification strategy

Verification is selected from compiler-discovered impact plus application policy:

- formatting/typecheck/lint;
- focused unit and vertical tests;
- impacted journeys;
- generated-source cleanliness;
- local preview smoke;
- optional deployed-profile gates requiring separate authority.

Builder shows why each gate was selected, skipped, unavailable, passed, or failed.

## Agentic Start packaging

Agentic Start contains:

- thin application-owned Builder configuration;
- product-specific journeys and agent tools;
- optional navigation entry in development mode;
- the disposable product-context toolbar in development builds;
- reusable UI/runtime dependencies from maintained Applik8s packages.

Reusable thread protocol, plan/diff/evidence views, health checks, workspace client, and approval components
belong in shared packages. The generated application retains its domain model, shell composition, custom
tools, product copy, and visual overrides.

## Diagnostics

- `BUILDER_WORKSPACE_UNAVAILABLE`
- `BUILDER_REPOSITORY_DIRTY_CONFLICT`
- `BUILDER_ACTION_NOT_AUTHORIZED`
- `BUILDER_SECRET_SCOPE_UNAVAILABLE`
- `BUILDER_PREVIEW_FAILED`
- `BUILDER_GENERATED_SOURCE_DIRTY`
- `BUILDER_EVIDENCE_INCOMPLETE`
- `BUILDER_APPLY_CONFLICT`
- `BUILDER_CONTEXT_STALE`
- `BUILDER_CONTEXT_AMBIGUOUS`
- `BUILDER_JOURNAL_RECOVERY_REQUIRED`
- `BUILDER_UNDO_CONFLICT`

## Implementation increments

1. Freeze the closed v0.9 preview journey and `@applik8s/dev` package boundary; keep optional features out
   until the successful-change, broken-application, and safety-refusal scenarios have one executable shell.
2. Reconcile the existing v0.8 daemon, portal, journal, toolbar, provenance, referent, and undo contracts
   without creating a parallel state authority.
3. Normalize the provider-neutral conversation/run event protocol around `codeAgent()` and `AgentHarness`.
4. Connect repository, workspace, graph, plan, runtime evidence, and journey capabilities.
5. Organize the existing portal as Conversation, Plan, Changes, Preview, and Evidence while retaining Home,
   Graph, Runtime, and Deployments.
6. Add development aspects and live-preview lifecycle without weakening application-failure resilience.
7. Add conflict-safe apply/discard/undo. Commit/push/PR remain separately authorized optional capabilities,
   not required preview navigation.
8. Integrate thin Agentic Start configuration and toolbar without creating additional public packages.
9. Qualify visual selection, referents, accessibility, security, restart, journal recovery, cleanup, and
   provider replacement.

## Acceptance

- The complete closed journey passes from a clean packed `@applik8s/dev` consumer without workspace
  hoisting or unpublished source.
- The journey uses a real managed loopback OpenCode process; protocol/process doubles cannot satisfy the
  preview inclusion gate.
- A clean generated Agentic Start opens Builder through `applik8s dev`.
- A user can prompt a cross-layer feature and understand the proposed graph consequences before mutation.
- Diff, preview, targeted journeys, and evidence agree on actual state.
- Restarting the UI/harness does not lose the logical run or workspace.
- Daemon restart resumes the versioned event cursor and longest valid journal prefix without silently
  applying or undoing an uncertain tail.
- Syntax, compile, startup, and route failures leave the independent portal and recovery controls usable.
- Element, text, and region selection retain exact/candidate/stale/unresolved/external provenance.
- Named referents recover across turns and disclose exactly which attachments reached the provider.
- Unrelated dirty worktree changes are never overwritten.
- Apply and conflict-aware undo touch only agent-owned reviewed hunks.
- Secret values never enter model messages or persisted evidence.
- OpenCode can be replaced behind `AgentHarness` without changing Builder's domain model.
- Protocol-version mismatch enters an actionable recovery/upgrade state rather than guessing compatibility.
- Production builds omit Builder development integration and configuration by default.
- A bounded browser run visits every primary Builder view used by the closed journey, records navigation,
  console, request, streaming/reconnection, accessibility-smoke, screenshot, and runtime evidence, and
  never marks an unvisited page as passing.

Three product-level scenarios are mandatory:

1. **Successful bounded change:** add one model/operation/UI behavior, review source and graph/plan diffs,
   run impacted journeys, preview it, apply it, then undo only the agent-owned hunks.
2. **Broken application recovery:** introduce a parse, compile, startup, or route failure and prove the
   independent portal can explain, revise, validate, and recover while the application is unavailable.
3. **Safety refusal:** attempt to overwrite unrelated dirty work, read an undeclared Secret, run an
   undeclared command/network destination, or mutate without approval and receive an actionable refusal
   with no repository or capability side effect.

The scorecard reports these as end-to-end product journeys, not as the sum of isolated component tests.

## Non-goals

- autonomous unapproved repository publishing;
- replacing the user's editor or terminal;
- a production end-user CMS by default;
- a new agent, workspace, repository, test, or deployment runtime;
- making OpenCode a public Applik8s primitive;
- treating DOM, screenshots, selected text, or model inference as authority or exact provenance;
- hosting mutation or recovery inside the generated application backend;
- treating generated source or a test pass as proof of unverified behavior.

## Definition of done

The preview is ready when a new user can safely prompt or select the relevant running product context,
control resolved source/graph/trace/plan attachments and stable named referents, understand, review,
preview, verify, apply, and undo a real Applik8s feature while the independent portal survives application
failure and every mutation, capability, provider, lifecycle transition, and piece of evidence remains
explicit and replaceable. If that complete journey is unavailable, v0.9 is not ready.
