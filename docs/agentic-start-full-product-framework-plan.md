# Agentic Start full product-framework plan

**Status:** Complete; the maintainer authorized the v0.7.0 release after the
required source, package, browser, and live qualification.
The credential-free Starter lane is mandatory. Credentialed OpenRouter and
Stripe lanes run only when the maintainer explicitly supplies their environment
bindings; absence is recorded, never converted into a synthetic pass.
**Scope:** Agentic Start maintained packages, generated product template, and
release acceptance
**Baseline reviewed:** the live generated Developer application on OrbStack,
the v0.7 experience specification, and the versioned Agentic product baseline.

Source placement follows the normative
[Agentic Start source ownership](./agentic-start-source-ownership.md) contract.

## Executive judgment

Applik8s has the execution substrate Agentic Start needs: typed callable models
and operations, durable workflows and signals, causal authority,
provider-qualified deployment, live queries, object intents, billing, identity,
and explainable TypeKro/Alchemy infrastructure. The maintained starter now
turns those primitives into a coherent Product / Builder / Administration /
Operator application rather than a framework-verification dashboard.

The original generated application was a capable architectural acceptance
fixture presented as a product. The baseline defects below are retained as
historical context; the closure ledger and exact-candidate section are the
authoritative present state:

- a Document is effectively one body string plus creation provenance;
- Copilot juxtaposes a manual-create form, an assistant panel, and conversation
  cards without one coherent work loop;
- Inbox exposes a synthetic "Example decision" creator whose purpose is to
  demonstrate framework mechanics;
- Library has no search, filtering, sorting, collaboration, revision, upload,
  or artifact-generation journey;
- workspace, administration, catalog, usage, and billing surfaces are useful
  read models but not complete management products;
- builder-facing agent, tool, prompt, knowledge, integration, evaluation, and
  release-management experiences are absent; and
- Launchpad and Operations are truthful, but still expose too much framework
  vocabulary before providing guided remediation and product-level diagnosis.

The implemented correction does not add more disconnected tabs. Agentic Start
uses a composable product kernel, maintained agentic modules, and deliberately
separate experiences:

1. an end-user agentic workspace;
2. an agent-builder studio;
3. SaaS and tenant administration; and
4. an operator control plane for configuring and operating it.

## Current implementation checkpoint

The maintained v0.7 surface now includes Documents, Agents, Knowledge,
Integrations, Evaluations, Conversations, Approvals, Artifacts, Usage,
Billing, Identity, and Operations modules. The generated product composes them
through ordinary Applik8s models, views, agents, workflows, and qualified
providers. The member journey now uses one assistant-to-Document loop,
first-class Documents and Artifacts destinations, real workflow decisions in
Inbox, workspace collaboration, and separate builder, administrator, and
operator navigation.

Completed corrective work includes:

- removal of synthetic member-facing verification controls;
- a maintained Document shape with search, revisions, provenance, review, and
  publication to immutable Artifacts;
- persistent conversations using TanStack's published server-authoritative
  persistence and AG-UI transport, with Applik8s-scoped canonical stores,
  bounded progress, stop/retry, durable results, and inline workflow decisions;
- knowledge ingestion with signed object intents and background indexing;
- draft/validate/publish agent management with a fail-closed deterministic
  runtime qualification boundary: the exact revision executes through the
  native agent loop and typed operation adapter against an isolated receipt
  sink, while definition checks alone cannot unlock publication;
- workspace integrations, tenant administration, versioned product catalog,
  Stripe-capable billing, entitlements, usage, and budgets;
- authority-shaped navigation groups for member, builder, administrator, and
  operator capabilities, pending the context separation specified below; and
- a guided Launchpad that distinguishes verified readiness, required repair,
  and explicit verification work without presenting missing evidence as
  runtime failure.

The public execution model does not need another redesign. The remaining work
is release qualification and independent review: prove valuable product
outcomes, cross-browser behavior, lifecycle convergence, and reviewable source
rather than merely proving that every subsystem can be reached.

## 2026-08-16 exact-candidate qualification

The exact generated Starter candidate passed the complete OrbStack lane on
2026-08-16 (receipt run `2e68d65d-ec29-47a6-8344-ae80f8396b40`):

- `applik8s doctor`: 8/8 prerequisite checks;
- one reproducible Drizzle baseline covering 41 application and maintained
  framework tables;
- official TanStack Start route generation, generated-project typecheck, and
  bounded client/SSR/Nitro production builds;
- a fresh 49-resource application deployment containing 21 immutable build
  artifacts through `ApplicationDeploymentGraph -> Alchemy -> TypeKro`;
- stable authoritative readiness, an exact zero-change graph reapply, and a
  redacted Launchpad status observation;
- 46 applicable browser journeys passed across Chromium, Firefox, WebKit, and
  mobile; the one Developer/Stripe journey was explicitly skipped in the
  credential-free Starter profile;
- the browser lane proved all first-run routes without server or hydration
  failures, a substantive agent-created Document with causal human lineage,
  repeated durable decisions across reload, Document review and immutable
  Artifact publication, definition-validation honesty, bounded Knowledge,
  authenticated invitations, account/workspace lifecycle controls, keyboard
  semantics, automated accessibility, responsive layout, dark mode, reduced
  motion, SSR, and degraded-connection recovery; and
- graph-backed teardown removed all 49 resources and the owned Namespace
  through the normal Applik8s/Alchemy/TypeKro lifecycle.

The exact receipt contains 15 release assertions and retains 16 settled visual
captures. The current package-boundary candidate contains 116 generated files,
including 49 application-behavior files and 6,842 application-owned nonblank
lines; route, design-system, deployment, largest-file, category, and semantic
ownership ceilings hold. Because the persistence and package-boundary changes
postdate that live receipt, the complete packed-candidate lane must be rerun
before a release claim can reuse its evidence.
Focused generator, presentation, and Operations contracts pass 9/9.
Workspace typecheck and `git diff --check` are release gates, not prose claims.

The live run also closed three defects that browser-only route checks had not
found:

- function-native queries now receive the Drizzle transaction view associated
  with the exact postgres-js transaction, so a processor can read its own
  admitted model writes without escaping the transaction;
- processor schema initialization is single-flight for each store and durable
  dead letters preserve safe error names and payload diagnostics; and
- account lifecycle state uses SSE as the fast path with bounded polling as a
  recovery path, avoiding an indefinitely stale UI after an interrupted
  stream.

The exact evidence receipt records the final working-tree, source graph,
deployment graph, artifact set, cluster, installation, and run identities
without creating a self-referential digest in this tracked plan.

The explicit Developer lane is implemented. Its harness mechanically overlays
and restores a requested environment file without inspecting, logging,
rewriting, or deleting its values. Credentialed acceptance remains separate:
live OpenRouter -> typed `Document.create` -> reactive Document, plus live
Stripe checkout redirection and component restart/update recovery. External
credentials never weaken the mandatory Starter lane or become a synthetic
release pass.

## 2026-08-15 UI substrate and dependency decision

Agentic Start now standardizes generated product UI on a source-owned
shadcn/ui foundation instead of maintaining a competing component system. The
generator emits `components.json`, stable package import aliases, the canonical
`cn()` utility, CVA variants, Radix-backed controls, Lucide icons, Tailwind v4
animation utilities, and accessible Button, Card, Input, Textarea, Label,
Select, Checkbox, RadioGroup, Progress, Separator, Badge, and Skeleton source.
Application-specific composites such as `PageHeader`, `RouteState`, and live
query recovery remain thin product components built from those primitives.
Every template-owned form control and button now crosses that boundary.

The dependency audit deliberately added only libraries that remove mature,
generic machinery from Applik8s-owned source:

- `radix-ui`, `class-variance-authority`, `clsx`, `tailwind-merge`,
  `tw-animate-css`, and `lucide-react` form the shadcn substrate;
- `react-markdown` with `remark-gfm` replaces the hand-written Markdown parser
  while keeping raw HTML disabled; and
- `@axe-core/playwright` makes WCAG automation part of release qualification
  rather than relying on a small home-grown DOM checklist.

The audit explicitly defers `@tanstack/react-form`: adopting it is attractive
once Agentic Start exposes an ArkType/Standard-Schema form adapter, but adding
it now would leave every generated model schema paired with a second,
application-authored validation contract. It also defers Tiptap, Recharts,
TanStack Table, and Sonner until a real editor, analytical visualization,
high-density table, or centralized transient-notification contract requires
them. Durable model outcomes and inline recovery state remain authoritative;
toasts must not become the only evidence that consequential work completed.

The production-package audit has two upstream follow-ups rather than another
application dependency to add. TypeKro must publish a patch that moves
`js-yaml` to at least 4.3.1 and `angular-expressions` past 1.5.1; that change is
prepared and verified against TypeKro's focused and full typecheck gates. The
remaining `decompress` advisories have no patched ComponentizeJS/weval path,
so they retain an explicit short-lived baseline limited to isolated,
trusted-source compiler builds. They are not present in generated runtime
images and must be removed when Bytecode Alliance publishes a repaired chain.

## 2026-08-16 live product re-evaluation

A persistent-browser review against the exact OrbStack candidate found that the
individual routes are substantially improved, but the generated product has not
yet earned the release-readiness claims above. The following findings are now
normative completion work rather than post-release polish:

1. Workspace selection must be atomic with workspace creation and route entry.
   A stale selector must preserve the authenticated identity and offer a safe
   workspace recovery path; it must never collapse the shell into an anonymous
   sign-in state.
2. Every browser journey must be repeatable against non-pristine state. A newly
   created workspace, query scope, signal subscription, durable review record,
   and persisted result must all use the same admitted workspace context.
3. Launchpad must derive its summary, counts, recommendation, deployment card,
   and obligation cards from one canonical evidence reducer. It must not say
   that all evidence is fresh while separately reporting that deployment
   evidence needs verification.
4. Agent activity must use operation-owned presentation metadata. Generated UI
   must not parse internal protocol names or hashes into user-facing labels.
5. A successful first turn must produce a useful conversation title and a
   substantive, structured Document with human-readable provenance.
6. Provider-neutral persistence, protocol, query, billing, artifact,
   operational-health, and lifecycle mechanics belong in maintained packages.
   Generated code deliberately retains Documents, Inbox/reviews, tenancy,
   product policy, brand, typed contributions, routes, shell, and product
   experiences; those are application meaning, not copied framework plumbing.
7. Builder flows must be task-oriented rather than CRUD-oriented: configure,
   ground, grant, test, compare, publish, and observe one exact agent revision.
8. Provider state must distinguish configured, reachable, verified, degraded,
   and not yet verified; `Unknown` is not an acceptable terminal product state.
9. Release evidence must include repeated persistent-state browser runs, live
   provider paths when credentials are supplied, bounded failure/recovery,
   accessibility and visual review, and infrastructure lifecycle evidence.

The reviewed generated ownership budget for the default product is at most 52
application-behavior files and 7,000 application-owned nonblank lines. The
budget inventories source-owned shadcn primitives and required TanStack
file-route declarations separately: those files remain reviewable generated
source, but they must not hide copied framework controllers or runtime policy.
A justified behavior exception must name the application-specific policy or
composition that cannot live in a maintained module. Passing the older
aggregate 110-file ceiling is not sufficient.

## 2026-08-16 closure ledger

This ledger is the executable remainder for v0.7. A checked item requires both
source evidence and the named acceptance evidence; prose completion claims are
not substitutes.

- [x] Preserve authenticated identity while recovering a stale workspace
  selector. The public session exposes only `none | admitted`, the server
  loader clears a rejected selector, and browser qualification proves that a
  stale cookie cannot strand queries in a 403/reconnect loop.
- [x] Use one canonical Launchpad evidence reducer for recommendation, counts,
  deployment state, and obligation cards.
- [x] Carry operation-owned presentation metadata into AI tools and render
  useful first-turn conversation titles.
- [x] Run the durable decision journey twice against retained browser and
  database state.
- [x] Finish maintained query and validation extraction for Documents, Agents,
  Knowledge, Integrations, and Evaluations. Workspaces remain deliberately
  application-owned because Applik8s does not own tenancy. Default product
  views remain source-owned customization surfaces; their generic operation
  and evidence controllers live in maintained packages.
- [x] Finish maintained presentation-controller
  extraction where a view still duplicates runtime state/recovery semantics;
  generated modules must otherwise contain application policy, composition,
  deliberate product UI, and thin bindings.
- [x] Replace raw aggregate source counting with a checked ownership inventory
  that separately budgets application behavior, TanStack route declarations,
  source-owned shadcn primitives, and deployment scaffolding.
- [x] Make the Agent studio's primary path revision-centered and contiguous:
  configure -> ground -> grant -> test -> evaluate -> publish.
- [x] Add explicit client and server chunk and aggregate ceilings to the exact
  generated production build and fail qualification on a regression.
- [x] Retain desktop and mobile captures for the flagship member, builder,
  administration, and operator journeys, with a review receipt tied to the
  exact generated lineage.
- [x] Re-run the complete packed-candidate OrbStack lifecycle after the final
  source change and publish a valid evidence receipt. The exact candidate
  passed 47 applicable browser journeys across Chromium, Firefox, WebKit, and
  the maintained mobile viewport, retained 16 settled captures, reapplied
  with zero graph changes, and removed all 51 resources through Alchemy and
  TypeKro. The live Developer Stripe lane was the sole credential-dependent
  skip and is not represented as a pass.
- [ ] When credentials are explicitly supplied, prove live OpenRouter and
  Stripe paths without reading, logging, rewriting, or deleting the user's
  environment file. Credential absence is an explicit environment-dependent
  remainder, never a synthetic pass.

## 2026-08-15 generated-product audit

### Evidence reviewed

This revision is grounded in four different kinds of evidence:

- the generated Document open at
  `/app/documents/8e386db2-a3a3-47d7-8fd0-2320376f3f4c`;
- the current generated Product template rather than only the running stale
  bundle;
- the Starter browser qualification and its assertions; and
- the Agentic product baseline onboarding, workspace, workflow, administration, billing, and
  provider-setup experience.

The live generated Document exposed the difference between framework proof and
product quality. It was named "OrbStack verification document", its body only
repeated that label, its primary live state remained on "Reconnecting…", and
its most prominent context was a raw principal identifier. That is useful test
evidence, but it is not a useful work product or a persuasive starter journey.

The current template is materially ahead of that stale page: it has Document
states, revisions, review, publication, Artifacts, related conversations,
agents, knowledge, integrations, evaluations, billing, tenant administration,
and Launchpad. It is still not the finished destination:

- the document editor is a large Markdown textarea rather than a polished work
  surface;
- revision history has no diff, restore, author summary, or review discussion;
- the starter has no comments or collaborative review threads despite the
  maintained Document contract promising them;
- the deterministic assistant is allowed to create the one-line body
  `Starter tool-created document.`, so the golden path proves authority but not
  usefulness;
- the Home page, conversation page, Documents, Inbox, and Artifacts are linked
  mechanically, but do not yet feel like one continuous work session;
- Agents, Knowledge, Integrations, and Evaluations are capable CRUD surfaces,
  not yet an opinionated agent-building studio;
- the generic Integration request form asks users to type capability and scope
  strings instead of choosing a typed application contribution;
- tenant, catalog, usage, and billing screens expose the right records, but
  remain operational panels rather than a coherent SaaS management journey;
- Launchpad explains the graph accurately, but leads with implementation
  vocabulary and CLI snippets instead of an environment goal, readiness story,
  and one recommended next action;
- an all-authority local developer sees Product, Build, Manage, Admin, and
  Operator navigation at once, which makes the first run feel like a control
  surface rather than a product;
- the generated candidate currently contains 110 files, including maintained
  framework views and controllers that every application should not have to
  own; and
- qualification accepts route headings, one-line work products, and mechanical
  state transitions. It does not yet retain a visual journey, judge output
  quality, or prove that the handed-off server is current and remains alive.

### Honest scorecard

| Dimension | Current | Release target | Diagnosis |
| --- | ---: | ---: | --- |
| Applik8s substrate leverage | 9/10 | 9/10 | The product uses typed models, operations, signals, workflows, live queries, authority, providers, Alchemy, and TypeKro rather than rebuilding them. |
| Member journey coherence | 6/10 | 9/10 | The nouns exist, but the user still has to infer the path from intent to durable result. |
| Work-product quality | 5/10 | 9/10 | The model is credible; the editor, collaboration, and generated content are not. |
| Agent-builder experience | 6/10 | 9/10 | The data model is strong, while configuration and evaluation remain disconnected forms. |
| SaaS administration | 6.5/10 | 8.5/10 | Identity, tenancy, plans, usage, and Stripe seams exist but need coherent task flows and human-readable presentation. |
| Operator experience | 6/10 | 8.5/10 | Truthful and safe, but too framework-first and insufficiently guided. |
| Visual and interaction system | 7/10 | 9/10 | The design language is coherent; hierarchy, information density, and deep-page workflows need refinement. |
| Generated-app maintainability | 5.5/10 | 9/10 | Ninety-six generated files make framework maintenance look application-owned. |
| Product-level qualification | 6/10 | 9/10 | Mechanical coverage is broad, but useful output, cross-surface continuity, visual review, and handoff freshness are weakly asserted. |

### Root diagnosis

Agentic Start currently organizes the experience around framework nouns. The
finished product must organize it around three jobs:

1. **Do work:** ask, observe, refine, review, and publish.
2. **Build the worker:** configure an agent, ground it, connect it, evaluate it,
   and publish it.
3. **Operate the product:** manage customers and billing, configure an
   environment, deploy it, and repair exceptions.

Those jobs may share models and authority, but they should not share one flat
navigation hierarchy. The default local-developer identity has every authority
and therefore magnifies this problem; it needs an explicit Product / Builder /
Operator context switch rather than a seventeen-link sidebar.

## Target experience architecture

### Product workspace: one durable work loop

The default authenticated destination is **Home**, not a framework dashboard.
It contains one outcome composer, a small attention rail, and recent work. The
user selects an agent only when more than one is published, attaches Knowledge
or files inline, and starts a persistent conversation.

The primary loop is visible everywhere:

```text
intent -> agent run -> typed actions -> durable Document -> review -> Artifact
            |               |                |             |
         progress        receipts         revisions      publication
```

The conversation does not claim success until the authoritative result is
linked. The Document links back to the exact conversation and run. Review is
the same durable decision in the conversation and Inbox. Publishing creates an
immutable Artifact whose provenance links back to the approved revision.

### Builder studio: one agent lifecycle

Authorized workspace builders enter a separate **Builder** context with four
destinations:

- **Agents:** catalog and agent studio;
- **Knowledge:** collections, sources, indexing, and citations;
- **Connections:** application-contributed integrations and their safe status;
- **Evaluations:** datasets, runs, comparisons, and promotion gates.

The studio is centered on an agent revision. Instructions, tools, knowledge,
policies, model intent, budgets, test conversation, evaluation evidence, and
publication status appear in one place. A builder should not move through four
unrelated pages to understand whether an agent is ready.

### Product administration: customers and commercial policy

Workspace administration remains close to the product: People, roles, usage,
budgets, plan, invoices, and subscription lifecycle. Application
administration is a distinct authority context for tenants, catalog versions,
aggregate usage, support access, and billing reconciliation.

### Operator center: environments, not framework records

Launchpad and Operations form a separate **Operator** context. Launchpad begins
with the target environment and answers:

1. What profile is this environment using?
2. Is the deployed graph current?
3. Which product journeys are proven?
4. What is the single safest next action?

The implementation graph, source map, receipts, and CLI commands remain
available as drill-down evidence. Operations is exception-first and defaults to
product names, affected users/workspaces, causal history, and remediation.

## Page-level completion blueprint

### Home

- One prominent "What should we accomplish?" composer with agent, attachment,
  Knowledge, and output controls revealed progressively.
- Suggested outcomes are application-owned examples, not framework tests.
- An attention rail contains pending reviews, failed runs, and expiring
  connections; it is absent when empty.
- Recent work combines conversations and Documents by work session rather than
  presenting two unrelated lists.
- First-run guidance advances only on authoritative outcomes and can expand
  into a short explanation of the underlying Applik8s source.

### Conversation / run

- Center: messages and rich typed action cards for tool calls, decisions,
  Documents, Artifacts, and failures.
- Side rail: run progress, durable results, sources, cost/budget, and the small
  set of actions relevant to the current state.
- Bounded progress names the current activity, last durable checkpoint, elapsed
  time, stop semantics, and recovery path.
- Reload resumes the same run and never collapses a durable workflow to a
  generic spinner.
- Retry explicitly distinguishes retrying inference, retrying a failed tool,
  and starting a new branch.

### Document

- A focused editor/reader with title, outline, content, autosave state, and
  explicit revision boundaries; Markdown remains an interchange format, not
  the whole editing experience.
- A lifecycle header contains state, review, publish/export, share, and more
  actions without forcing the user to decode an aside.
- Context tabs or a compact rail expose comments, review thread, revision diff
  and restore, citations, related conversation/run, attachments, and humanized
  provenance.
- Raw principal IDs are available only in an audit detail; ordinary UI shows a
  person/agent name and role.
- A generated first document contains a useful multi-section deliverable with
  an objective, assumptions/sources, concrete recommendations, owner/checklist,
  and next action.

### Documents and Artifacts

- Documents supports search, state/tag/author filters, sorting, saved views,
  archive, and clear empty states.
- Artifacts is an immutable output vault, not a second document library. Each
  item shows format, size, retention, source revision, run, download/export
  action, and integrity state.
- The distinction is explained once in context: Documents are collaborative;
  Artifacts are published outputs.

### Inbox

- Contains only real decisions and assigned tasks.
- Groups by urgency and work session, with Pending / Resolved / Mine filters.
- Each decision previews the affected change, actor, scope, deadline, policy,
  and authoritative receipt before approval.
- Resolving inline updates the originating conversation and Document without a
  manual refresh.

### Agent studio

- Catalog cards show published version, owner, last evaluation, usage, and
  health.
- Agent detail uses Overview, Instructions, Tools, Knowledge, Guardrails,
  Evaluations, and Releases tabs around one selected revision.
- Tool and Integration grants come from typed contributions; no unvalidated
  name/capability/scope text entry is exposed.
- A test console runs the draft revision with an explicit environment and
  bounded budget.
- Evaluation comparison and publish are adjacent; publish cannot race stale
  evidence.

### Knowledge and Connections

- Knowledge is collection-first. Sources show extraction/indexing progress,
  access scope, citation preview, failure remediation, and agent usage.
- Connections starts from an application-contributed catalog. A typed
  connection wizard asks only questions relevant to that contribution and
  never accepts arbitrary capability strings.
- Workspace users see safe connection state and reconnection actions; operators
  see provider evidence and secret-reference obligations separately.

### Evaluations

- Default view answers "Can I publish this agent revision?"
- Builder flow is dataset -> cases -> scorer -> run -> comparison -> promotion.
- Results show regressions, cost, latency, tool behavior, and representative
  failures rather than only a pass percentage.
- Dataset/scorer administration is a secondary advanced surface, not the first
  form on the page.

### Workspaces, account, billing, and administration

- Workspace detail centers People, invitations, roles, service identities, and
  activity with human-readable names.
- Account presents identity methods, sessions, MFA/recovery, exports, and data
  lifecycle as separate, legible sections.
- Billing uses customer language and normal currency units; it covers checkout
  return, portal, invoices, payment problems, plan changes, cancel/resume, and
  entitlement consequences.
- Usage connects consumption to agents, work sessions, tools, storage, and
  budgets. Internal microunits remain audit detail.
- Tenant administration adds plan/entitlement preview, bounded support access,
  audit, suspension effects, and billing-reconciliation state.

### Launchpad and Operations

- Launchpad presents a profile/environment summary and one recommended action,
  then capability cards with Configure / Verify / Repair states.
- Every card explains product impact, authority, provider ownership, evidence
  freshness, and the exact safe command or configuration change.
- Operations leads with exceptions, affected product objects, and recovery;
  raw graph records are drill-down evidence.
- A source map links visible behavior to the authored model, operation,
  workflow, provider binding, and resulting graph without exposing secrets.

## Framework boundary required to deliver the experience

The full product must not require every generated application to maintain the
same views, controllers, state machines, and error semantics. Before release:

1. Move reusable Product, Builder, Administration, and Operator controllers and
   default views into maintained Agentic Start packages.
2. Keep application-owned models, agents, policy, brand, typed contributions,
   and route-level overrides in generated source.
3. Introduce a typed contribution contract for navigation, agent tools,
   Knowledge source kinds, Connections, evaluation scorers, billing policy,
   onboarding outcomes, and operator obligations.
4. Let an application replace a maintained view or component without forking
   the rest of the module.
5. Reduce the default generated surface from 110 files to a reviewable product
   skeleton; use optional generated feature examples only when the user asks
   to own that code.
6. Keep provider selection in `provide()` and environment profiles. Product
   routes and models must not import provider adapters.

This is a framework boundary, not a configuration-driven low-code product. The
generated application still owns ordinary TypeScript models, closures, policy,
and composition. The maintained package owns repetitive product mechanics.

## Revised completion sequence

### Milestone A — make qualification honest

1. Replace verification-themed project names and seed content in the release
   candidate with a credible product scenario.
2. Make deterministic Starter inference produce the same useful structured
   outcome shape as live inference, not a one-line placeholder.
3. Add assertions for minimum substantive content, expected sections, linked
   conversation/run, humanized provenance, and the full
   Document-review-Artifact chain.
4. Fail browser qualification on a bounded state that remains Loading or
   Reconnecting, not only on HTTP 500 or missing headings.
5. Persist desktop/mobile visual captures for the core journey and require a
   maintainer sign-off receipt.
6. Add a handoff gate that proves the served bundle matches the generated
   commit/lineage and remains healthy after the qualification process exits.
7. Add stale-selector recovery, newly-created-workspace selection, and repeated
   persistent-state tests. Run the durable review journey twice without
   resetting the database or browser storage.
8. At a 390px viewport, reject any visible navigation whose internal content
   overflows, require exactly Home/Documents/Inbox/More, prove the More sheet is
   authority-shaped, and verify main-content clearance above fixed navigation.
9. Replace independent Launchpad calculations with one canonical evidence
   reducer whose output drives the recommendation, deployment state, counts,
   obligation cards, and Operations links.
10. Carry typed operation presentation metadata through AI tool adaptation,
   persistence, hydration, and rendering; derive a useful first-turn title.

**Exit:** a green receipt cannot describe the stale, disconnected, one-line
Document observed in this audit.

### Milestone B — finish the flagship work loop

1. Implement the completed Home, Conversation, Document, Inbox, and Artifact
   blueprints as one vertical slice.
2. Add comments/review threads, revision diff/restore, citations, and
   humanized provenance to the maintained Document module.
3. Add typed activity/result cards and durable reconnect/retry semantics to the
   agent workspace.
4. Make published Artifact creation and presentation format-aware.
5. Verify the entire loop with Starter and live Developer inference.

**Exit:** a new member can request useful work, understand progress, refine it,
obtain approval, publish it, and resume the same context after reload without
encountering framework vocabulary.

### Milestone C — turn CRUD pages into an agent builder

1. Build the revision-centered Agent studio.
2. Make Knowledge collection-first and connect retrieval/citations to test
   conversations and evaluation evidence.
3. Replace arbitrary Integration strings with typed contribution wizards.
4. Make evaluation comparison and promotion one contiguous workflow.
5. Add schedule/event trigger configuration only through typed authored
   contributions already declared by the application.

**Exit:** a builder can create a draft, ground it, grant tools, connect a
service, test it, compare evaluations, and publish the exact winning revision.

### Milestone D — complete the SaaS and operator journeys

1. Finish the customer billing lifecycle, workspace administration, tenant
   operations, catalog versioning, usage attribution, budgets, and audit.
2. Split Product / Builder / Administration / Operator contexts in navigation.
3. Rebuild Launchpad around environment goals and recommended actions.
4. Rebuild Operations around product impact and exception recovery.
5. Verify authority-driven visibility with member, owner, builder,
   administrator, support, and operator personas.

### Milestone E — establish the maintained framework boundary

1. Move reusable controllers/views into maintained packages.
2. Add typed contribution and override seams.
3. Shrink and document the generated source.
4. Add generator update/conflict tests and an example custom vertical slice.
5. Re-run source budgets, packed-consumer generation, and lineage checks.
6. Enforce the default-product budget of at most 50 generated source files and
   3,000 generated application-owned lines, with an allowlisted and reviewed
   explanation for every exception.

Milestone E is a horizontal constraint, not a cleanup postponed until after the
screens are built. Every slice in Milestones B through D must land in its
maintained module first and leave only application-owned composition and
overrides in the generated project. This prevents implementing the same
experience in templates and then migrating it later.

### Milestone F — release qualification

1. Run Starter, Developer, Dedicated, and External-profile evidence appropriate
   to available credentials and infrastructure.
2. Prove fresh deploy, no-op reapply, update, restart, recovery, and
   graph-backed destroy.
3. Run cross-browser, mobile, accessibility, performance, failure-injection,
   and visual review gates against the exact packed candidate.
4. Retain the useful generated Document, conversation, review, Artifact,
   screenshots, graph digest, and redacted receipts as reviewable release
   artifacts.
5. Repeat the complete flagship loop against retained browser and database
   state, then repeat it after an application component restart.
6. Exercise the real OpenRouter and Stripe boundaries when explicitly supplied
   credentials are present, without reading, logging, rewriting, or deleting
   the user's environment file.
7. Run the available single-cluster security, accessibility, dependency,
   concurrency, and performance gates. Record multi-cluster qualification as
   the only permitted environment-dependent remainder.

No new public execution primitive is required for these milestones. The work is
product architecture, maintained module extraction, and stronger acceptance of
the capabilities v0.7 already exposes.

The dependency order is therefore:

```text
honest qualification -> flagship work loop -> builder + SaaS/operator journeys
                              |                         |
                              +-- maintained modules --+
                                                        -> release qualification
```

## Maintained module deliverables

Agentic Start should assemble maintained modules rather than reproduce their
runtime in every generated application.

### 1. `@applik8s/documents`

Own a reusable document contract with:

- title, structured/Markdown content, summary, status, tags, and content type;
- workspace ownership and application-defined visibility;
- revision history with optimistic concurrency and restore;
- human and execution authorship, causal provenance, and related run;
- comments or review threads;
- attachments and immutable published artifacts;
- search/index projection and live list/detail views; and
- typed create, edit, publish, archive, restore, and attach operations.

The application may extend fields and policy without remapping the maintained
shape. A body-only example is insufficient release evidence.

### 2. `@applik8s/agent-workspace`

Compose conversations, messages, runs, tools, approvals, documents, artifacts,
memory, and usage into one coherent member experience:

- persistent thread list and stable URLs;
- streaming text plus typed product-action cards;
- durable step state that survives reload;
- attachment and knowledge selection;
- stop, retry, branch, rename, archive, and continue;
- inline approval interrupts backed by the same Inbox signal;
- authoritative-result reconciliation; and
- a reusable "How this worked" causal summary.

Routes should consume a maintained controller/view model while remaining
application-owned and styleable.

### 3. `@applik8s/agents`

Provide an application-facing agent definition and management model:

- agent identity, description, instructions, prompt version, logical model,
  tools, knowledge collections, memory policy, output contract, and limits;
- draft/published/retired lifecycle;
- typed tool grants and approval requirements;
- schedules and event triggers;
- test invocation and evaluation binding; and
- provider-neutral runtime resolution.

Application code should still read like ordinary values:

```ts
export const ResearchAssistant = agent({
  instructions: ResearchPrompt,
  model: StructuredGeneration.named('quality'),
  tools: [SearchKnowledge, DraftDocument, RequestReview],
  knowledge: [WorkspaceKnowledge],
  output: ResearchResult,
});
```

The management UI edits application-owned configuration records; it does not
mutate provider-specific clients or invent untyped tools.

### 4. `@applik8s/knowledge`

Add provider-neutral source ingestion and retrieval:

- collections, sources, files, URLs, and connector references;
- object upload intents and malware/content-type policy;
- extraction, chunking, embedding, indexing, and failure state;
- workspace/document/agent access scopes;
- citations and source provenance; and
- PostgreSQL Starter plus maintained production search/vector adapters.

This must reuse object storage, workflows, events, search, and typed authority
rather than introduce a second ingestion runtime.

### 5. `@applik8s/integrations`

Define provider-neutral connection records and credential boundaries for OAuth,
API keys, webhooks, MCP servers, and application connectors. Secret material
remains in deployment/provider authority; browser models contain only safe
status, scopes, expiry, and reconnection instructions.

The v0.7 generated product intentionally stops at a durable, truthful operator
setup request and safe binding status. Adapter-owned browser OAuth completion
is a subsequent integration capability; the request UI must never imply that a
connection is complete merely because its intent record was created.

### 6. `@applik8s/evals-ui`

Complete the existing evaluation substrate with builder workflows for datasets,
cases, scorers, runs, comparisons, regression thresholds, and agent/prompt
promotion gates. Evaluation records must correlate logical model, prompt,
tools, knowledge snapshot, and provider resolution without retaining unsafe raw
content by default.

### 7. Maintained administration extensions

Extend existing identity, billing, usage, and operations modules with complete
management operations and presentation controllers rather than read-only cards.
Tenancy and product policy remain application-owned; modules provide reusable
mechanics and typed extension points.

Provider-facing billing actions must first resolve an active plan from the
application-owned catalog. Provider identifiers are bindings of that catalog,
never arbitrary browser strings.

## Release quality bars

- no generic 500 page for an expected product or provider state;
- no spinner without bounded progress and cancellation semantics;
- no synthetic framework-verification control on member routes;
- no provider imports in application models, agents, routes, or workflows;
- no duplicated schema or string operation identity;
- no client-supplied principal, tenant, role, provider ID, receipt, or secret;
- no unbounded operational table masquerading as current health;
- accessibility, keyboard, mobile, dark mode, and reduced-motion evidence;
- deterministic Starter plus live Developer evidence;
- fresh deployment, no-op reapply, update, restart, and graph-backed destroy;
- packed-consumer generation/build and source-lineage reproducibility; and
- immutable release receipts bound to the exact commit and graph digest.

## Execution constraint

The hardest work is not additional CSS. It is defining maintained module
contracts that stay application-owned where policy differs, reuse the existing
execution substrate, and avoid turning the starter into a proprietary low-code
configuration system. UI polish should proceed with each vertical slice, but
must not mask incomplete authoritative behavior.
