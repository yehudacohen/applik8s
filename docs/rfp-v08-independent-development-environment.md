# RFP: Applik8s v0.8 — Independent Development Environment and Coding Agent

**Status:** Proposed v0.8 developer-preview contract. This document authorizes design review and a
bounded OpenCode integration, not implementation or release.

**Manifesto:** [`manifesto-v08-portable-stateful-development.md`](manifesto-v08-portable-stateful-development.md)

**Foundation gate:** The stable `graph-provenance` gate must pass before visual/source/graph resolution
or semantic change review is considered trustworthy.

**Foundation dependencies:** The v0.7 Agentic Start, application graph, compiler diagnostics,
development aspects, typed runtime diagnostics, package catalog, security model, and the manifesto's
Phase 0 canonical identity and provenance records

**v0.8 contract integrations:** The local supervisor hosts the daemon's runtime view; the canonical plan,
runtime-access graph, and observability evidence enrich Builder context as they become available. The
independent portal, journal, mutation safety, and recovery foundation can be implemented before every
semantic enrichment surface is complete.

**Initial coding provider:** OpenCode v2 server protocol behind an Applik8s-owned adapter

**Target disposition:** The v0.8 development-agent vertical is local-only. AWS and Kubernetes deployment
of the daemon/portal are deferred and cannot be inferred from application target support.

## Purpose

Provide a resilient development environment in which a developer can inspect, run, change, verify, and
recover an Applik8s application through a browser. A coding agent may propose and apply changes using
version-matched Applik8s skills, but it must operate behind explicit plans, diffs, approvals, validation,
and rollback.

The development environment is not hosted by the generated application backend. Code changes can make
that application fail to compile, crash during startup, break its routes, or change its deployment graph.
The tool required to diagnose and repair those failures must survive them.

The development environment therefore consists of an independent frontend and development daemon. The
daemon hosts the package-owned local supervisor defined by the portable-runtime RFP and manages an
OpenCode server as a replaceable child/provider. Hosting does not transfer ownership of process identity,
leases, endpoint brokering, recovery, or teardown semantics to this RFP. The generated application may
show a small development toolbar that links to or embeds the portal, but neither the portal nor the
coding-agent session depends on the generated application remaining healthy.

When the application is healthy, the toolbar also makes the running product a first-class inspection
surface. A developer can point at an element, selected text, or a visual region and ask about that exact
product concept. The daemon resolves the bounded selection through source provenance, the semantic graph,
runtime evidence, and the canonical `ApplicationPlan`. The selected DOM is context—not authority, trusted
instructions, or permission to send arbitrary user content to the coding provider.

## Required developer experience

One command starts the complete local experience:

```sh
applik8s dev
```

The terminal reports stable endpoints:

```text
Application:       http://my-product.localhost:3010
Developer portal:  http://127.0.0.1:4388
Runtime status:    http://127.0.0.1:4388/runtime
```

The developer portal provides:

- application graph and provider explorer;
- source-aware runtime health and logs;
- schema, operation, workflow, actor, event, and authority inventory;
- deployment plans and target comparisons;
- a Builder conversation for requested changes;
- a durable plan/diff/approval/apply/verify/undo journey;
- recovery controls when the application does not compile or start.

A representative Builder interaction is:

```text
Developer
  “Add organization-scoped document sharing with approval before public publication.”

Builder
  1. Inspects models, roles, operations, signals, routes, and current providers.
  2. Proposes files and semantic graph changes.
  3. Explains the new grant, approval signal, projection, migration, and deployment effects.
  4. Presents code diff and graph diff.
  5. Waits for approval.
  6. Applies an optimistic patch against the reviewed file revisions.
  7. Formats, typechecks, tests, compiles, plans, and restarts affected processes.
  8. Shows evidence and offers undo.
```

The agent never reports success merely because it wrote files or produced a plausible explanation.

A second canonical interaction starts from the running product:

```text
Developer
  Enables Inspect mode in the generated application's development toolbar.
  Selects the "Publish" action on a Document.
  “Require a second reviewer for enterprise workspaces.”

Builder
  Resolves the selection to:
    Document detail route and publication controls
    source component and current revision
    Document.update and publication authority
    DecisionReview workflow and signal
    workspace billing entitlement
    affected provider and ApplicationPlan nodes

  Proposes:
    approval-policy and second-review state changes
    workflow, authority, and UI changes
    code, semantic-graph, and ApplicationPlan diffs

  Waits for scoped approval, applies the patch, validates the selected journey,
  and returns evidence attached to the original product selection.
```

The user may attach, name, detach, and revisit that selection throughout the conversation. Follow-up
phrases such as “only owners should do that” resolve to an explicit persisted referent rather than opaque
provider chat memory.

## Architecture

```text
Browser
  +-- generated application UI
  |     +-- optional disposable product-context toolbar
  |           +-- element/text/region selection
  |           +-- bounded browser metadata
  |
  +-- Applik8s developer portal (stable origin)
        |
        v
Applik8s development daemon
  +-- authenticated local API and event stream
  +-- workspace/file broker
  +-- change journal and rollback engine
  +-- compiler plan/explain adapter
  +-- visual selection and source/graph resolver
  +-- conversation attachment store
  +-- test/build/package runner
  +-- local runtime and deployment supervisor
  +-- logs, health, and evidence store
  +-- policy and approval engine
  +-- coding-agent provider adapter
          |
          +-- managed OpenCode server process

Mutable generated application
  +-- web/server process
  +-- workers
  +-- local dependencies
```

The portal is served by the development daemon from a package-owned artifact. It remains usable when the
application source is syntactically invalid.

## Owned contracts

This RFP owns:

- the independent development daemon and portal protocol;
- workspace identity, file snapshots, optimistic patching, and change journals;
- coding-agent provider abstraction and OpenCode adapter;
- Builder session, plan, approval, patch, validation, evidence, and undo contracts;
- versioned Applik8s coding skills and framework catalog retrieval;
- compiler/graph/deployment feedback supplied to the agent;
- command admission and sandbox policy;
- local authentication, origin, CSRF, and event-stream security;
- generated-app product-context toolbar integration;
- bounded visual selection, source resolution, graph/plan enrichment, and persistent conversation
  attachment contracts;
- crash recovery independent of application health;
- developer-preview packaging and exclusion from production artifacts.

This RFP does not own:

- the generated application's product assistant;
- production agent execution or application tool authority;
- an IDE replacement;
- autonomous unreviewed deployment;
- arbitrary machine administration;
- reading secret values merely because they exist in the project environment;
- mutation of the Applik8s framework repository from an ordinary generated application session;
- OpenCode's internal agent, model, or storage implementation.

## Separation from the product application

The development daemon has its own process, port, authentication state, persistence, and health. It does
not call a route in the generated backend to edit files or maintain the coding session.

The optional generated toolbar is a thin client that can:

- open the stable portal;
- enter accessible element, text, or visual-region inspection modes;
- report the current route and bounded selected-element metadata;
- resolve a source component through development-only provenance instrumentation;
- send a bounded selection reference to the daemon;
- open Builder with that selection attached;
- display current build/runtime status.

It cannot:

- host the OpenCode client or server;
- hold workspace mutation credentials;
- apply patches;
- become the canonical session store;
- decide source, graph, authority, or plan relationships;
- send arbitrary page DOM, form values, cookies, storage, screenshots, or user content by default;
- make recovery depend on the application's router or database.

Production builds omit the toolbar and development protocol by default. An explicit remote-development
workspace may include them under separate authentication and network policy; a production application
deployment may not silently expose them.

## Visual product-context bridge

The toolbar is the bridge between the running product and Builder. It supports three bounded modes:

- **Element mode** — select one rendered interactive or structural element;
- **Text mode** — select an exact text range after sensitive-content classification; and
- **Region mode** — select a visual component boundary, not an unbounded page screenshot.

The browser creates a candidate selection:

```ts
interface DevelopmentVisualSelection {
  id: string;
  capturedAtRevision: string;
  route: {
    pathname: string;
    searchKeys: readonly string[];
    routeId?: string;
  };
  element?: {
    role?: string;
    accessibleName?: string;
    boundedText?: string;
    componentInstanceId?: string;
  };
  text?: {
    boundedValue: string;
    redaction: "none" | "partial" | "withheld";
  };
  region?: {
    componentInstanceIds: readonly string[];
    boundingBox: { x: number; y: number; width: number; height: number };
  };
  sourceHints: readonly DevelopmentSourceHint[];
}
```

This is a conceptual contract, not permission to expose raw CSS selectors or DOM trees as stable public
API. Exact schemas remain versioned daemon/toolbar protocol types.

### Resolution pipeline

The daemon resolves a selection progressively:

```text
visual selection
  -> route and development-only component provenance
  -> source module, component, and captured revision
  -> feature/application module
  -> operations, queries, views, and model handles used by the component
  -> authority and provider dependencies
  -> runtime traces and health for the selected revision
  -> semantic and physical ApplicationPlan nodes
```

The compiler/Vite integration emits opaque development-only component/provenance IDs and a separate
source map. It does not put workspace paths, graph internals, or mutation credentials into production
markup. The daemon validates every ID against the current project and revision before enrichment.

The protocol is Vite/framework-neutral. React/TanStack Start, other supported renderers, and package-
owned UI components may contribute adapters, but the public selection contract does not expose React
Fiber or another renderer's private object model. Unsupported or third-party renderers retain bounded
DOM/route context and an explicit partial/external disposition.

Only compiler-known typed operation, query, view, model, and capability handles create semantic graph
edges. Raw `fetch`, dynamic reflection, text similarity, or runtime coincidence may produce a diagnostic
candidate but never a proven operation/provider relationship.

Resolution is evidence-bearing and partial by design:

- `exact` means compiler provenance identifies one current source/graph node;
- `candidate` names multiple bounded possibilities and asks the developer to choose;
- `stale` means source or runtime revision changed after capture;
- `unresolved` preserves the visual attachment without inventing source relationships; and
- `external` identifies third-party or browser-native UI outside compiler provenance.

Text similarity, component names, and CSS selectors may suggest candidates but cannot independently claim
an exact semantic relationship. Runtime traces may strengthen a relationship only when trace/source/graph
identities match the selected revision.

The development router grants the toolbar a short-lived, project/run/origin-bound bridge capability
limited to portal discovery and selection submission. The toolbar cannot reuse that capability for file
reads, diagnostics, commands, patches, provider sessions, or deployment. The daemon rejects unexpected
origins, project identities, revisions, replayed submissions, and oversized selection payloads.

SSR and hydration must resolve to the same source identity where the framework owns both render paths.
Hot reload either preserves the selection against an unchanged source identity or marks it stale; it may
not silently retarget the referent to whichever DOM node now occupies the same position.

### Interaction behavior

Inspect mode provides a visible overlay, keyboard traversal, accessible announcements, escape/cancel, and
clear selected-state feedback. It must not break ordinary clicks, text selection, focus, forms, scrolling,
or application hot reload when disabled.

The portal shows the resolved context before sending it to the coding provider. The developer can remove
selected text, runtime evidence, source files, or plan nodes independently. “Ask Builder” sends only the
approved attachment classes under the current source-egress policy.

For visual-design questions, the toolbar may prepare a tightly cropped selection snapshot and bounded
computed-style/accessibility summary locally. Those remain preview-only until the developer explicitly
attaches them; the daemon applies sensitive-region redaction and source-egress policy before provider
delivery. Region mode never implies permission to capture the whole page.

A selection may begin an `explain` turn or a `change` turn. An explain turn can answer questions such as
“why is Upgrade disabled?” by distinguishing product state, application authority, runtime access,
provider health, and UI implementation. It performs no mutation and may use only runtime diagnostics the
development daemon is separately authorized to read. It never infers a current user's authority solely
from button state or DOM attributes. A change turn enters the normal plan/diff/approval pipeline.

Visual inspection is additive. When the app fails to compile or start, the independent portal, source
attachments, graph nodes, plans, logs, and recovery controls remain available.

## Persistent context attachments and referents

A Builder conversation owns explicit attachments rather than relying on transient prompt text:

```ts
type DevelopmentContextAttachment =
  | VisualSelectionAttachment
  | VisualSnapshotAttachment
  | SourceAttachment
  | GraphNodeAttachment
  | OperationAttachment
  | RuntimeTraceAttachment
  | ApplicationPlanNodeAttachment
  | ValidationEvidenceAttachment;

interface DevelopmentConversationReferent {
  id: string;
  label: string;
  attachmentIds: readonly string[];
  capturedAtRevision: string;
  resolution: "current" | "stale" | "partial" | "unresolved";
}
```

Attachments are immutable, digest-addressed records in the development journal. A referent such as
`@publish-control` groups attachments and remains stable across turns. The daemon may re-resolve it against
new revisions, but it never rewrites the captured snapshot; it records a new resolution and exposes drift.

The user can attach, detach, rename, replace, or pin referents. Builder responses and change plans name
which referents they used. Ambiguous phrases such as “that” resolve only when the conversation has one
unambiguous active referent; otherwise Builder asks for selection rather than guessing.

Attachment presence is not authority. A selected button does not grant its operation, a trace does not
grant production access, and a plan node does not authorize deployment. Mutation, diagnostics, source
egress, runtime access, and deployment retain their existing independent approvals.

### Attachment lifecycle

- Browser capture is ephemeral until the daemon admits it.
- Journal admission records project, route, revision, provenance, redaction, and developer identity.
- Raw user-visible text has the shortest configurable retention and may be withheld while source/graph
  references remain usable.
- Detaching removes the attachment from future provider context but preserves a redacted audit receipt.
- Conversation deletion removes retained attachment payloads subject to the declared journal policy.
- Undoing a code change does not falsify or delete the historical context that motivated it.
- Stale source and plan attachments remain visibly stale until re-resolved or replaced.

## Development daemon

The daemon starts before the mutable application and composes the local runtime supervisor defined and
owned by the portable-runtime RFP. It exposes a versioned loopback API to the portal.

Daemon responsibilities:

- discover and lease one project workspace;
- start and monitor the coding provider;
- expose project metadata without leaking secrets;
- stream file, build, runtime, plan, and validation events;
- admit and resolve bounded visual selections against current source, graph, trace, and plan evidence;
- persist conversation attachments and explicit referents independently from provider chat memory;
- serialize conflicting mutations;
- persist Builder sessions and agent-owned change journals;
- recover after daemon restart;
- remain responsive through application rebuilds;
- stop child processes with bounded cleanup;
- diagnose rather than conceal partial failure.

The daemon is not a general shell server. Every command belongs to a declared command class with a
policy, working directory, environment allowlist, timeout, output budget, and mutation classification.

## Coding-agent provider contract

The provider-neutral interface covers:

```ts
interface DevelopmentAgentProvider {
  startSession(input: StartDevelopmentSession): Promise<DevelopmentSession>;
  inspect(input: InspectDevelopmentWorkspace): AsyncIterable<DevelopmentEvent>;
  propose(input: ProposeDevelopmentChange): AsyncIterable<DevelopmentEvent>;
  continue(input: ContinueDevelopmentSession): AsyncIterable<DevelopmentEvent>;
  cancel(input: CancelDevelopmentTurn): Promise<DevelopmentCancellation>;
  close(input: CloseDevelopmentSession): Promise<void>;
}
```

Provider output is advisory until the daemon validates and records a concrete plan or patch. The provider
does not receive direct browser credentials, production deployment credentials, or an unrestricted host
filesystem.

### OpenCode adapter

The first adapter manages `opencode serve` as a loopback child process. OpenCode exposes a headless HTTP
server and OpenAPI protocol; the adapter uses the supported v2 client protocol rather than importing
private embedded SDK internals. Upstream references are the
[OpenCode server documentation](https://dev.opencode.ai/docs/server/),
[v2 client documentation](https://opencode.ai/v2/docs/build/client), and
[v2 SDK status](https://opencode.ai/v2/docs/build/sdk).

The daemon:

- selects an available loopback port;
- generates a per-session server password;
- does not expose the OpenCode server directly to the browser;
- checks protocol compatibility at startup;
- restarts or diagnoses the provider independently of the application;
- normalizes provider events into the Applik8s development protocol;
- treats the adapter as replaceable.

## Workspace and mutation model

The daemon works against an explicit project root. It resolves symlinks and rejects paths outside the
allowed root unless the developer enters a separately labeled maintainer mode.

Each inspected or mutated file has a content digest. A proposed patch names the exact base digest. Apply
fails closed when the file changed after review.

The change journal stores:

- session and turn identity;
- developer request;
- provider/model identity;
- inspected file digests;
- admitted context attachments, referents, redaction, and resolution evidence;
- proposed plan and risks;
- proposed patch;
- approval identity and time;
- applied before/after digests;
- dependency and lockfile changes;
- validation commands and results;
- resulting graph diff and runtime outcome;
- undo disposition.

The canonical journal is `.applik8s/dev/journal.sqlite`, ignored local state scoped by project-root
identity. It uses WAL, checksummed records, explicit schema migrations, append-only turn/evidence records,
and bounded compaction snapshots. The daemon fsyncs the admission, approval, and apply boundaries needed
for recovery and rebuilds its in-memory session index from the journal after restart.

The journal stores digests, redacted output, receipts, and patches—not secret values, inherited shell
environments, provider credentials, or unbounded command output. Corruption fails closed, preserves the
last verified prefix, and offers an explicit repair/export path rather than silently discarding history.

The daemon does not require a clean Git worktree and does not reset, discard, commit, or overwrite
unrelated developer changes. Undo applies the inverse of agent-owned hunks only when current file
preconditions still match. Otherwise it presents a conflict and requires manual resolution.

Git may provide evidence and user-invoked checkpoints, but automatic commits are not the sole recovery
mechanism.

## Builder plan contract

Before mutation, the agent produces a structured plan:

```ts
interface DevelopmentChangePlan {
  summary: string;
  requestedOutcome: string;
  contextReferents: readonly string[];
  files: readonly PlannedFileChange[];
  graphChanges: readonly PlannedGraphChange[];
  schemaChanges: readonly PlannedSchemaChange[];
  authorityChanges: readonly PlannedAuthorityChange[];
  infrastructureChanges: readonly PlannedInfrastructureChange[];
  dependencies: readonly PlannedDependencyChange[];
  risks: readonly DevelopmentRisk[];
  validation: readonly PlannedValidation[];
  rollbackBoundary: DevelopmentRollbackBoundary;
}
```

The portal renders semantic changes, not just file names. It shows the admitted visual/source context and
the pre-change/post-change canonical `ApplicationPlan` diff. A new operation grant, database migration,
public route, actor protocol member, AWS resource, secret requirement, or destructive lifecycle change
receives a distinct warning and approval scope.

Plan approval does not authorize arbitrary follow-on edits. Material expansion requires a revised plan.

## Apply and validation pipeline

An approved turn proceeds through:

```text
precondition check
  -> patch application
  -> formatting
  -> dependency/lockfile validation
  -> typecheck
  -> focused tests
  -> generated artifact/route checks
  -> Applik8s compile
  -> semantic graph diff
  -> deployment plan without writes
  -> affected local process convergence
  -> route/operation smoke evidence when applicable
  -> terminal evidence or rollback offer
```

The pipeline may stop early after a failure, but the portal remains available and shows the failing
source, command, logs, diagnostics, and safe next actions.

The agent may propose a repair in the same session. A repair is another reviewed patch, not an invisible
continuation.

## Applik8s skills and framework knowledge

The development environment ships a versioned skill bundle matched to the installed Applik8s release.
It covers:

- models, relations, operations, transactions, and events;
- queries, views, projections, batches, and rebuilds;
- workflows, signals, schedules, actors, and causal identity;
- roles, grants, authorization, identity, AI, and MCP;
- application modules and Agentic Start conventions;
- profiles, provider requirements, local/AWS/Kubernetes targets;
- TypeKro and Alchemy ownership boundaries;
- testing, generated artifacts, package boundaries, and migrations;
- security and lifecycle failure modes.

Skills are not prose injected without verification. Each version points to machine-readable public API,
compiler diagnostics, canonical examples, and conformance checks. The agent receives the installed
version's catalog, not documentation for `latest`.

The agent should prefer compiler introspection over guessing. Useful daemon tools include:

- `application.explain`;
- graph inventory and provider requirements;
- operation and authority catalog;
- source-to-node provenance;
- target compatibility and deployment plan;
- generated route inventory;
- package/module catalog;
- migration and schema diagnostics;
- focused test selection.

## User interface

The portal is a development product, not a chat page with terminal output appended.

### Home

- application health and last successful revision;
- active target and providers;
- changed files and unverified changes;
- recent Builder sessions;
- direct recovery actions;
- links to application, graph, logs, and deployment plan.

### Builder

- conversation with explicit visual, source, graph, operation, trace, plan, and evidence attachments;
- inspect-mode selection preview, resolution confidence, redaction, staleness, and attach/detach controls;
- persistent named referents used visibly by plans and responses;
- structured plan;
- code and semantic graph diff;
- risk and authority review;
- apply/cancel controls;
- live validation timeline;
- result evidence and undo.

### Graph

- models, operations, events, workflows, actors, resources, providers, and routes;
- source ownership and dependencies;
- profile and target comparison;
- readiness and runtime evidence.

### Runtime

- process/container/service health;
- logs and traces;
- rebuild/restart controls;
- local dependency state;
- current compile failure even when the application is down.

### Deployments

- local, AWS-local, AWS, and Kubernetes target plans;
- infrastructure, cost-class, secret, migration, and destructive changes;
- explicit deploy authority outside the default Builder mutation grant.

## Approval policy

v0.8 supports two modes:

- `suggest`: inspection, plan, and diff only;
- `reviewed-apply`: patch and bounded validation after explicit approval.

There is no unrestricted autonomous mode in v0.8.

Separate approvals are required for:

- adding or executing a new command class;
- dependency installation or lockfile change;
- schema/data migration;
- secret declaration or access-scope change;
- public exposure, DNS, certificate, or authorization change;
- infrastructure write;
- destructive reset or deletion;
- path expansion beyond the generated project;
- maintainer-mode framework edits.

Approval UI displays the exact scope and remains usable without the generated application.

## Secrets and sensitive data

The daemon may enumerate declared environment variable names and whether they are present. It does not
send values to the coding provider.

Default exclusions include:

- `.env` and non-example secret files;
- deployment credentials;
- Kubernetes Secrets;
- AWS secret values and session tokens;
- production database contents;
- private keys;
- downloaded user artifacts unless deliberately attached.

Commands receive the minimum environment required for validation. Output passes through secret-canary
and known-value redaction before storage or model context.

If a developer explicitly grants exact secret access for a narrow diagnostic, the receipt names the
secret, purpose, provider, expiry, and whether its value may reach the coding model. Blanket inheritance
of the developer shell environment is prohibited.

### Coding-provider data governance

Before a coding provider receives source or diagnostics, the portal discloses:

- provider/model identity and whether processing is local or remote;
- source, log, attachment, and generated-artifact classes that may leave the machine;
- provider retention/training policy as configured and known to the adapter;
- repository classification and any policy that prohibits remote source egress;
- the exact user-approved attachments and bounded diagnostic excerpts;
- session expiry, deletion, and locally retained journal evidence.

Remote source egress requires explicit consent at provider/session setup and again when scope materially
expands. Selecting a file for inspection is not consent to send the whole repository. Downloaded user
artifacts, database samples, browser contents, and deployment logs remain separate attachment classes and
are excluded until explicitly attached under policy.

## Prompt-injection boundary

Repository files, application pages, logs, test output, dependency documentation, downloaded artifacts,
MCP results, and generated model output are untrusted data. They cannot grant tools, expand workspace
scope, bypass approval, or alter system policy.

Selected DOM text, accessible names, route content, data attributes, source comments, trace fields, and
plan labels remain untrusted even when deliberately attached. Development provenance IDs establish a
relationship to current source; they do not make selected content an instruction.

The provider may recommend actions based on that data. The daemon admits only actions represented by its
own typed protocol and current policy.

## Runtime and deployment integration

The Builder can ask the local supervisor to restart or converge affected nodes after validation. It
cannot use the application backend as the control channel.

Infrastructure planning is read-only by default. Deployment requires a separate explicit action and
uses the existing Alchemy/TypeKro target owners. The coding provider never talks directly to cloud or
Kubernetes control planes.

The portal correlates source changes with graph and runtime effects:

```text
src/features/documents/model.ts
  -> Document model schema revision
  -> PostgreSQL migration
  -> DocumentChanged event contract
  -> Search projection rebuild requirement
  -> affected worker restart
```

For visual selections it also explains the evidence chain and uncertainty:

```text
Publish button on /app/documents/:id
  -> DocumentPublishControls (exact compiler provenance)
  -> Document.publish (captured handle dependency)
  -> publisher role grant (authority graph)
  -> publication-review workflow (semantic graph)
  -> workflow processor and Hatchet provider (ApplicationPlan)
  -> trace 7f... for current revision (runtime evidence)
```

## Remote development

Remote development is deferred from v0.8 implementation and release acceptance. The protocol must avoid
architectural assumptions that make a later secured remote workspace impossible, but no remote daemon,
network exposure, or production-hosted portal is promised in this release.

A future remote mode would require:

- explicit non-loopback configuration;
- TLS and strong authentication;
- workspace-scoped authorization;
- origin and CSRF enforcement;
- network isolation from production control planes unless separately granted;
- session expiry and audit;
- no assumption that the generated application shares the portal origin.

Remote development does not justify embedding the daemon in the application deployment.

## Packaging

v0.8 starts with one public `@applik8s/dev` package and explicit subpath exports:

- `@applik8s/dev/server` — daemon protocol, workspace broker, journal, and validation orchestration;
- `@applik8s/dev/ui` — package-owned portal frontend;
- `@applik8s/dev/agent` — provider-neutral coding-agent contracts;
- `@applik8s/dev/agent/opencode` — OpenCode server adapter;
- `@applik8s/dev/skills` — versioned Applik8s skill/catalog bundle.

Existing CLI/Vite packages own command and generated-toolbar integration. A subpath becomes a separate
package only after it is independently replaceable, versionable, useful without the rest, and costly to
ship together. Internal code boundaries remain testable without turning each boundary into an npm
package. Generated applications do not copy their implementation source.

## Implementation increments

### Increment 1 — Stable daemon and recovery UI

- Serve a portal independent of the application.
- Show compile/runtime failure, logs, graph inventory, and recovery controls.
- Integrate the v0.8 local supervisor.

### Increment 2 — Change journal and manual patches

- Add file digests, reviewed diffs, optimistic apply, validation pipeline, and undo.
- Prove dirty-worktree preservation and conflict handling.

### Increment 3 — OpenCode provider

- Complete a bounded protocol, cancellation, recovery, and source-governance spike before freezing the
  provider adapter.
- Manage a loopback OpenCode server.
- Normalize sessions/events and enforce workspace/tool boundaries.
- Produce structured plans and patches through the daemon.

### Increment 4 — Applik8s semantic intelligence

- Ship versioned skills and compiler catalog.
- Add graph diff, authority review, migration review, target plan, and focused validation.

### Increment 5 — Visual product context

- Add development-only component provenance and the disposable inspect toolbar.
- Implement element, text, and region selection with accessible overlays and bounded capture.
- Add daemon-side source/graph/trace/plan resolution, confidence, staleness, and partial-failure behavior.
- Add persistent attachments, named referents, redaction, detach/delete, and journal recovery.

### Increment 6 — Agentic Start integration

- Add the disposable developer toolbar.
- Prove generated-app mutations, failures, repair, reload, and undo.
- Publish the feature as developer preview.

## Required gates

### Resilience

- Syntax error, type error, route crash, server startup crash, and worker crash leave the portal usable.
- Daemon and OpenCode restart recover session and journal state.
- Journal WAL recovery, migration, compaction, checksum failure, and last-verified-prefix repair are tested.
- App restart does not cancel an active reviewed change or validation record.
- Conversation attachments and referents recover with their captured revisions and stale/current state.

### Mutation safety

- Changed-after-review files fail optimistic apply.
- Dirty unrelated files survive apply and undo byte-for-byte.
- Symlink/path traversal cannot escape the workspace.
- Undo removes only agent-owned changes or reports a conflict.
- Cancellation leaves a terminal journal disposition.

### Validation truthfulness

- A change cannot display `complete` before required gates finish.
- Failed compile, test, graph validation, deployment plan, or smoke check remains visibly failed.
- Generated route and artifact cleanliness are checked.
- Evidence links to exact command, revision, output digest, and runtime result.

### Security

- The OpenCode server is unreachable directly from the browser/network by default.
- CSRF, origin, session fixation, websocket/SSE authorization, and replay are tested.
- Secret canaries never reach provider context, journal, logs, or UI.
- Remote-provider fixtures prove repository classification, disclosure, consent, attachment boundaries,
  retention metadata, and source-egress denial.
- Prompt-injection fixtures cannot expand tool or approval scope.
- Selected DOM/text fixtures cannot smuggle instructions, secrets, cookies, form values, storage, or
  unapproved screenshots into provider context.
- Development provenance is absent from production artifacts and cannot resolve across project identity.
- The toolbar bridge rejects hostile origins, replay, cross-project IDs, stale revisions, oversized
  payloads, and attempts to use its selection-only capability for mutation or diagnostics.
- Production builds contain neither portal server nor toolbar unless explicitly requested.

### Product experience

- A new user can request, understand, review, apply, verify, and undo a representative feature.
- The portal explains application-native concepts instead of dumping internal compiler objects.
- Failure states always offer a concrete next action.
- A user can select an element, text range, or component region, inspect the resolved source/graph/plan
  context, remove sensitive attachments, and start a correctly anchored Builder conversation.
- Exact, candidate, stale, unresolved, and external selections remain visually distinguishable.
- Follow-up turns use visible named referents rather than hidden provider memory.
- SSR/hydration, hot reload, route changes, and component removal preserve or explicitly stale selections
  without silently retargeting them.
- Keyboard, accessibility, responsive layout, and long-running progress are browser tested.

### Generated application acceptance

- Add a model field and migration.
- Add a typed operation and role grant.
- Add an event projection.
- Add a workflow or actor call.
- Add a provider requirement.
- Select a running product control and implement a cross-cutting UI, operation, authority, workflow, and
  ApplicationPlan change from that context.
- Select a disabled action and explain whether the cause is application authority, runtime access,
  provider health, or product state without mutating source.
- Break and repair the application while the portal remains available.
- Compare local and AWS deployment plans without infrastructure writes.

## Non-goals

- An autonomous production operator.
- A replacement for VS Code, GitHub, or a full terminal.
- Pixel-perfect visual design generation or a general browser automation product.
- Treating arbitrary DOM, screenshots, runtime content, or text similarity as authoritative source
  provenance.
- Hosting the development agent in the generated backend.
- Automatically editing Applik8s framework internals from an ordinary app session.
- Reading all `.env` values or production data.
- Silent dependency upgrades, migrations, deployments, or destructive actions.
- Depending permanently on one coding-agent provider.
- Claiming model-generated code is correct without executable evidence.
- Shipping remote development in v0.8.

## Closed v0.8 decisions

- The portal and daemon survive independently of the generated application.
- The OpenCode server is a backend child/provider, not a browser endpoint or application route.
- The generated application contains only an optional disposable development toolbar.
- The toolbar is a bounded product-context bridge; the daemon owns resolution, attachments, referents,
  source egress, and mutation authority.
- Visual selections resolve progressively to source, graph, runtime, and `ApplicationPlan` evidence and
  preserve exact/candidate/stale/unresolved/external dispositions.
- Builder conversations use explicit persistent attachments and named referents, not opaque provider
  memory.
- Changes use plan, diff, approval, optimistic apply, validation, evidence, and undo.
- The daemon preserves unrelated dirty-worktree state.
- Secret values are excluded from coding context by default.
- Applik8s skills and catalogs are version matched.
- The canonical journal is ignored SQLite state with WAL, checksums, migrations, and bounded compaction.
- Coding-provider source egress is disclosed, classified, consented, and attachment bounded.
- v0.8 uses one `@applik8s/dev` package with subpath exports; package splitting requires independent value.
- Remote development is architecturally preserved but implementation-deferred.
- v0.8 exposes `suggest` and `reviewed-apply`, not unrestricted autonomy.
- The development agent ships as opt-in developer preview.

## Definition of done

This RFP is complete when a developer can start one independent Applik8s development environment,
continue using it while the generated app is broken, ask an OpenCode-backed agent for an Applik8s-native
change either textually or by selecting the relevant running product surface, inspect and control the
resolved visual/source/graph/trace/plan attachments, use stable visible referents across turns, review
both code and semantic effects, apply it safely, observe truthful validation and runtime evidence, and
undo it without losing unrelated work or exposing secrets.
