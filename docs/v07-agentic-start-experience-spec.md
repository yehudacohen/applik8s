# Agentic Start experience specification

**Status:** Normative v0.7 product and interaction design
**Parent plan:**
[`v07-agentic-start-product-readiness-plan.md`](./v07-agentic-start-product-readiness-plan.md)

This document defines the views, information hierarchy, transitions, visual
language, and responsive behavior of the generated Agentic Start. It is the
implementation specification for the first-run journey; the parent plan owns
sequencing, framework boundaries, correctness work, and release gates.

## Experience principles

1. **Product before platform.** The primary screen is a useful product. The
   framework is revealed through contextual explanation after a successful
   action.
2. **One primary action per state.** Every onboarding stage has one obvious next
   action. Secondary paths remain available without competing for attention.
3. **Progressive disclosure.** Provider topology, deployment ownership, and
   runtime evidence appear when the user asks how something worked or prepares
   to deploy.
4. **Truthful degradation.** Missing identity, workspace, provider, migration,
   or runtime state produces a designed recovery view, never a blank page or
   generic server error.
5. **Real product continuity.** Onboarding is an overlay on ordinary product
   behavior. Completing or skipping it does not switch the user into a
   different application.
6. **Source ownership.** Generated design primitives and product composition
   are readable application source. Framework packages supply typed state and
   behavior without owning the visual identity.

## Audience and surface partition

The experience has four related surfaces, each protected by ordinary typed
Applik8s authority:

```text
Product experience
├── Copilot and persistent conversations
├── Document and artifact library
├── Inbox and durable decisions
└── Product-member onboarding

Workspace administration
├── Members and roles
├── Usage and billing
└── Workspace settings

Builder Launchpad
├── Source orientation
├── Provider and profile setup
├── Doctor and plan evidence
└── Explicit deployment guidance

Operations
├── Runtime health and recovery
├── Causal and authority evidence
└── Deployment graph and ownership
```

Product members see only the first surface. Workspace owners receive the first
two. Application operators receive Launchpad and Operations in addition to any
product roles they separately hold. The UI does not infer operator authority
from a local URL, workspace ownership, a Kubernetes namespace, or visibility of
an installation.

The product and owner journeys use application-owned onboarding definitions.
Launchpad and Operations are independently authorized maintained integrations.

## Visual direction

The generated default should feel calm, precise, and quietly technical. It is
not a neon developer dashboard and not a generic shadcn component gallery.

- **Canvas:** warm neutral background with elevated white/near-black surfaces.
- **Accent:** a restrained green-teal used for primary actions and active
  navigation, connecting to Applik8s without flooding the interface.
- **Status:** semantic green, amber, red, blue, and neutral states always paired
  with an icon and label.
- **Typography:** clean sans-serif UI; compact labels; expressive but bounded
  display type only on the welcome and first-success views.
- **Shape:** medium radii, thin borders, restrained shadows, strong grouping.
- **Density:** product pages are compact; onboarding moments receive more
  breathing room.
- **Motion:** short transitions that establish cause and effect. Respect
  reduced-motion preference and never animate operational status indefinitely.

## Global application shell

### Desktop

```text
┌──────────────────────────────────────────────────────────────────────────┐
│  applik8s-template      Workspace ▾     [role-shaped actions]  Avatar ▾ │
├───────────────┬──────────────────────────────────────────────────────────┤
│ Product       │ Breadcrumb / contextual status                          │
│  Copilot      │                                                          │
│  Library      │ Route content                                            │
│  Workspaces   │                                                          │
│  Inbox        │                                                          │
│               │                                                          │
│ Manage        │                                                          │
│  Usage        │                                                          │
│  Billing      │                                                          │
│  Account      │                                                          │
│               │                                                          │
│ Operator*     │ *group absent without application-operator authority     │
│  Launchpad    │                                                          │
│  Operations   │                                                          │
│               │                                                          │
│ Starter*      │ *environment badge exists only for application operators │
│ non-production│                                                          │
└───────────────┴──────────────────────────────────────────────────────────┘
```

- The top bar contains the application identity, workspace switcher,
  role-shaped actions, command palette trigger, and account menu. Product
  members may see pending Inbox work; only operators may see setup state.
- The left navigation groups product use, workspace administration, and
  application operation. Workspace administration and the complete Operator
  group are authority-shaped and absent when unauthorized. “Launchpad” carries
  a count only when operator action is required.
- The active profile appears at the bottom only for application operators as a
  compact environment badge. Product members and workspace owners do not see
  deployment topology. The badge is never a profile selector unless the current
  application has a proven safe transition.
- Route content uses a consistent maximum readable width. Data-heavy operations
  views may use the full available width.

### Mobile

- Top bar retains application identity and account avatar. Product members may
  see Inbox state; only application operators may see setup status.
- Primary product destinations use a four-item bottom navigation: Copilot,
  Library, Inbox, and More.
- “More” opens an authority-shaped sheet. Members receive Workspaces and
  Account; owners also receive Usage and Billing; operators separately receive
  Launchpad and Operations.
- Side panels become full-width sheets; causal timelines become vertical.
- No feature relies on hover.

## View 1: Public acquisition and reliable arrival

**Routes:** `/`, `/sign-up`, `/sign-in`, `/verify`, `/recover`,
`/invitations/:invitationId`, and every authenticated route through `/app`

The public shell is a small application-owned acquisition surface, not an
operations dashboard. `/` explains the product outcome and offers sign-up and
sign-in. Admission routes support email verification, recovery, provider-aware
MFA, and return to the originally intended route. The public shell may offer a
bounded deterministic assistant preview only when its authority and retention
are explicitly public; it never exposes an authenticated workspace operation.

The generated application owns one typed brand source for product name,
description, mark, safe public metadata, support link, and application-supplied
privacy/terms destinations. Applik8s supplies no fake legal policy or opaque
framework branding configuration.

Identity-provider verification/recovery delivery and application invitation
delivery render honest sent, delayed, expired, and retry states. Application
mail uses the provider-neutral notification capability. Starter does not require
out-of-band verification for its deterministic local identity; its delivery
sink is visible only to application operators in Launchpad, and workspace
owners may copy a bounded invitation link without pretending an email was sent.

The shell renders before optional account enrichment or provider readiness.
The route content may be one of these classified states:

| State | Presentation | Primary action |
| --- | --- | --- |
| Authentication required | Focused sign-in card in the content region | Continue/sign in |
| Workspace required | Workspace creation/selection card | Create workspace |
| Setup required | Capability-specific product explanation, no secret values | Use available path or contact operator |
| Dependency unavailable | Last safe content when possible plus status banner | Retry |
| Forbidden | Explain missing permission and current context | Switch workspace or go home |
| Not found | Name the missing product resource | Return to parent |
| Unexpected | Correlation ID and safe support actions | Retry |

The global shell does not disappear for an expected setup or dependency state.
An unexpected root-session failure uses a minimal branded recovery shell.

## View 2: Welcome and first-run copilot

**Route:** `/app`
**Audience:** authenticated user with a usable workspace and incomplete journey

```text
┌───────────────────────────────────────────────────────────────────────┐
│ YOUR APP IS RUNNING                                      Step 1 of 4 │
│ Start your first workspace conversation                              │
│ This starter already has identity, live data, durable execution,      │
│ infrastructure, and operations. Start by using the product.           │
│                                                                       │
│ ┌──────────────────────────────────┐  ┌─────────────────────────────┐ │
│ │ Recent work                      │  │ Workspace copilot           │ │
│ │                                  │  │ Try: “Create a note about   │ │
│ │ No documents yet                 │  │ shipping our first version” │ │
│ │ Your assistant can create one.   │  │                             │ │
│ │                                  │  │ [ message field          ]  │ │
│ │ [+ Create manually]              │  │ [Create my first note]      │ │
│ └──────────────────────────────────┘  └─────────────────────────────┘ │
│                                                                       │
│ Skip tour                                          What will happen?  │
└───────────────────────────────────────────────────────────────────────┘
```

- A single compact journey header establishes progress without becoming a
  dashboard banner.
- Conversation, documents, immutable artifacts, and assistant remain the actual product, not a
  simulated tutorial. Notes are the first readable document type rather than
  the product's entire identity.
- The assistant offers two or three useful prompt chips only while empty.
- “What will happen?” previews the agent/tool/model/live-view chain in plain
  language without technical details.
- Manual creation remains available to demonstrate that both human and agent
  paths operate on the same model.
- The conversation receives a stable URL and persists across reload. Streaming,
  stop, retry, and reconnect are visible interaction states rather than hidden
  transport behavior.

### Loading and empty behavior

- Notes render skeleton rows during the initial query.
- The assistant input remains usable only after its connection is ready.
- If live AI is not selected, Starter presents its deterministic assistant as a
  real local capability, clearly labeled “Local assistant.”
- If the assistant is unavailable, manual notes remain usable and the journey
  offers an explicit retry; the route does not fail.

## View 3: First-success moment

**Route:** `/app`, immediately after the assistant creates the document

The new document enters the list with a short highlighted edge and an “Added by
NotesAssistant for you” provenance line. A compact success panel replaces the
journey header:

```text
┌───────────────────────────────────────────────────────────────────────┐
│ ✓ Your first agentic action completed                                │
│ The assistant used a typed tool, committed one note, and this list    │
│ updated without a refresh.                                            │
│ [See how this worked]                           [Continue exploring]   │
└───────────────────────────────────────────────────────────────────────┘
```

The UI does not claim success until the authoritative query contains the
committed document. A streamed assistant response alone is insufficient.

## View 4: “How this worked” evidence drawer

**Entry:** first-success panel, activity provenance, or Operations deep link

Desktop uses a right-side sheet; mobile uses a full-screen sheet.

```text
How this worked

● You asked NotesAssistant                         10:42:13
│ Authenticated as Yehuda · workspace Acme
│
● CreateNote was authorized                        10:42:13
│ Agent execution received only Note.create
│
● Note.create committed                            10:42:14
│ PostgreSQL · idempotent operation op_…
│
● NoteList invalidated and re-queried               10:42:14
│ Browser cursor resumed · 1 row changed

[Open full operation]  [View source map]
```

- Default text names product concepts first.
- Expanding a row reveals the stable operation identity, authority receipt,
  causal principal, execution principal, model/event, runtime, and correlation
  identifier through the redacted operations contract.
- “View source map” shows generated source filenames and exported symbols, not
  a copied code tutorial or raw server path.
- The drawer never exposes model content, tokens, secrets, raw provider
  payloads, unrestricted headers, or private prompts through operations data.

## View 5: Product journey center

**Route:** `/app` compact progress; full detail available from “Continue setup”

After first success, the welcome panel collapses into a resumable journey card:

```text
Make this app yours                                      1 of 4 complete
━━━━━━━━━━━━━━╺━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✓ Create something with the assistant
○ Review the document the agent created  About 1 minute
○ Approve a durable decision             About 2 minutes
○ Resume your conversation after reload  About 1 minute

[Continue: review your document]                         [Dismiss]
```

- Steps are product outcomes, not framework component names.
- Each step opens the real destination with a contextual coach mark.
- The center supports continue, skip current step, dismiss, reset, and review
  completed steps.
- Completion is principal/application scoped and survives reload.

## View 6: Normal copilot workspace

**Routes:** `/app` and `/app/conversations/:conversationId`

After product activation, the home route contains no permanent tutorial hero.
It becomes a useful work surface:

```text
┌───────────────────────────────┬──────────────────────────────────────┐
│ Continue working              │ Workspace copilot                    │
│                               │                                      │
│ Launch planning               │ Conversation history                 │
│ Updated 12 minutes ago        │ streamed response                    │
│                               │ tool: Update launch plan ✓           │
│ Customer research             │ artifact: Launch plan v3             │
│ Waiting for approval          │                                      │
│                               │ [Ask, create, analyze, or update…]    │
│ Recent library items          │ [Send] [Stop while streaming]         │
└───────────────────────────────┴──────────────────────────────────────┘
```

- The left side prioritizes recent conversations, documents, immutable run artifacts, and pending
  decisions rather than vanity metrics.
- A conversation has a stable URL, title, last activity, current durable work,
  and archive/rename actions.
- Tool calls appear as compact product actions with pending, completed, failed,
  or approval-required state. Raw function arguments are not the default UI.
- Document cards open mutable authoritative model revisions. Artifact cards
  open immutable object-backed outputs with digest, producing run, provenance,
  retention, and related conversation.
- Streaming can be stopped; interrupted streams can retry safely; reload and
  reconnect restore the conversation and durable work without duplication.
- “How this worked” is available from completed actions, but ordinary members
  receive only product-level provenance unless separately authorized for
  operational evidence.

## View 7: Document and artifact library

**Routes:** `/app/library`, `/app/documents/:documentId`, and
`/app/artifacts/:artifactId`

The library is not a file-system metaphor and does not collapse mutable product
state into immutable evidence. Documents are ordinary application-owned models
with revisions and collaboration semantics. Artifacts are object-backed outputs
with digest, producing run, provenance, and retention.

- Library header provides a bounded type filter, sort, and create action.
- Cards/rows show title, kind, updated/created time, human owner, agent provenance, and
  workflow/approval state.
- Detail shows current content, revision history, related conversation,
  approvals, and safe causal summary.
- Agent document updates are optimistic only when the authoritative model contract
  supports it; otherwise the UI shows durable work progress until commit.
- Empty state begins a conversation or creates the first document manually.
- Binary object access uses signed object intents and never exposes store
  credentials or raw object keys.

## View 8: Workspaces

### Workspace index

**Route:** `/app/workspaces`

- Page header: “Workspaces” with “New workspace” as the primary action.
- Workspace cards show name, current role, member count, last activity, and
  selected state.
- One explanatory empty state appears only when there are no workspaces.
- Selecting a workspace commits the server-understood selector before
  navigation and displays a bounded progress indicator.
- Inaccessible stale selections are cleared and explained, not retried in a
  loop.

### Workspace detail and team

**Route:** `/app/workspaces/:workspaceId`

Header shows workspace name, role badge, and selected status. Tabs:

1. **Overview:** activity, product usage, and member summary.
2. **Members:** member table, roles, pending invitations, and invite action.
3. **Settings:** name and application-owned workspace settings.

The invite dialog asks for email and typed role. It previews exactly what that
role can do in product language. Destructive role removal uses confirmation
with the affected member and workspace named.

### Invitation acceptance

**Route:** `/invitations/:invitationId`

- Shows inviter, workspace, role, and expiration before acceptance.
- Accepting commits membership and workspace selection atomically from the
  user's perspective.
- “Open workspace” never navigates before selection is available to the loader.
- Expired, revoked, already accepted, wrong-account, and temporarily unavailable
  invitations each have distinct recovery states.

## View 9: Inbox and durable decisions

**Route:** `/app/inbox`

The inbox is the product-facing home for actionable signal issuance events.

- Tabs: Needs attention, Resolved, All.
- Each item shows application reason, issuing workflow, age, expiration, and
  authorized actions.
- Opening a review shows immutable context and typed action forms.
- Approve/reject sends only application input; principal and receipt are
  framework-derived.
- A losing concurrent action receives the redacted terminal summary permitted
  by the signal contract.
- SSE reconnect and browser reload restore exact issuance state without
  duplicate resolution.

The onboarding decision step creates or points to one safe example review, then
guides the user here. The inbox is useful after onboarding is dismissed.

## View 10: Account and security

**Route:** `/app/account`

Sections use a vertical settings layout:

1. Profile and verified identities.
2. Authentication methods.
3. MFA, only when the active provider supports it.
4. Active sessions, only when listing/revocation is supported.
5. Connected OAuth applications when supported.
6. Data export and deletion, with retention consequences named before action.

Provider capabilities are explicit typed data. Unsupported controls are absent
or presented as an explanatory upgrade/setup row; they are never rendered as
buttons that fail when clicked. Sensitive changes require recent
authentication when the provider contract requires it.

## View 11: Usage and billing

### Usage

**Route:** `/app/usage`

- Current period summary, bounded trend, and breakdown by product feature.
- Starter labels usage as local/simulated where applicable.
- Every number names its source and freshness without exposing provider detail.

### Billing

**Route:** `/app/billing`

```text
Billing
Current plan       Starter                         Active
Usage this period  1,240 units                     View breakdown

Upgrade when you need live capacity
┌───────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ Starter       │ │ Team            │ │ Scale           │
│ Current       │ │ [Choose Team]   │ │ [Contact/choose]│
└───────────────┘ └─────────────────┘ └─────────────────┘
```

- Plans and entitlement policy are application-owned.
- Starter billing is useful without Stripe and explicitly identified as
  simulated/local.
- Live checkout first establishes or reuses the authoritative principal-to-
  Stripe-Customer mapping.
- Change, cancel, resume, portal, and meter actions derive provider IDs from
  server-side principal-scoped records; browser input carries product intent
  only.
- Return from checkout shows a reconciling state until the authenticated
  webhook projection is authoritative.
- Missing live configuration produces a setup card rather than a route error.

## View 12: Builder Launchpad and setup center

**Route:** `/app/setup`

This is an application-operator surface, not workspace administration and not a
form that writes an opaque framework config file. Its navigation and routes are
absent without application-operator authority.

Application-operator authority is a canonical typed application grant with an
audited bootstrap, revocation, expiry, and break-glass path. A workspace-owner
role, environment-variable email allowlist, local URL, or installation
visibility never grants access. The root server resolves this authority before
rendering navigation so unauthorized users do not receive a client-side flash
of operator routes.

### Header

- Requested profile and observed profile.
- Overall state: Ready, Action required, Deploying, Degraded, or Unknown.
- Primary next action, such as “Add OpenRouter credential” or “Run plan.”

### Capability list

Grouped by application need rather than vendor:

- Identity
- AI generation
- Database
- Workflows
- Events
- Object storage
- Search
- Billing
- Hosting and exposure

Each row shows:

```text
AI generation       OpenRouter                 Action required
Required by         NotesAssistant
Accepted sources    .env · Secret reference
Missing             OPENROUTER_API_KEY
[Copy .env name] [Configure Secret reference] [Why is this needed?]
```

No credential value enters loader output or HTML. The page receives only safe
compiled graph descriptors, redacted exact-candidate CLI/deployment receipts,
and verified operational observations. Every receipt binds the source,
candidate, application graph, installation, and observation time. The web
application receives neither kubeconfig nor mutation-capable Alchemy state.

### Profile comparison

Profile comparison appears only when requested. It focuses on ownership and
operational consequences rather than a giant feature matrix:

- Starter: credential-free, deterministic, non-production.
- Developer: local infrastructure plus explicitly selected live providers and
  local-source hot reload.
- Dedicated: application-owned production-capable providers.
- External: separately owned provider bindings and survival guarantees.

### Go-live obligations

The setup center derives production obligations from the selected graph:

- DNS and TLS;
- identity courier and application notification delivery;
- schema migration and rollback;
- backup, restore, and retained-data ownership;
- rate limits, quotas, and AI usage/cost budgets;
- Stripe webhooks and entitlement convergence when billing is included;
- observability and alert routing; and
- destruction and disaster-recovery consequences.

An obligation is ready only when its declared evidence exists. Static checkmarks
or Starter fixtures do not satisfy Dedicated/External readiness.

## View 13: Plan and deployment

**Route:** `/app/setup/deploy` or a Setup subview

The browser remains read-only. It presents copyable commands and imported plan
evidence produced by the CLI:

1. **Check:** `bun run doctor` with prerequisite summary.
2. **Preview:** `bun run plan` with node count, ownership summary, provider
   changes, and warnings.
3. **Deploy:** explicit profile command.
4. **Observe:** readiness progression linked to Operations.

The graph preview groups resources by application capability and owner. It does
not lead with a raw Kubernetes manifest. Advanced users can expand to exact
TypeKro/Alchemy nodes and manifests.

Local-source development clearly states the filesystem-sharing requirement.
Unsupported remote clusters fail during doctor/plan, before mutation.

## View 14: AI trust, Operations, and data lifecycle

**Route:** `/app/operations`

This separately authorized application-operator surface defaults to an
exception-first operational overview:

- needs attention;
- active workflows and signals;
- recent application activity;
- provider and dependency health; and
- deployment status.

It distinguishes canonical application state, delivery state, provider
observation, and inferred topology visually and textually. Unknown is never
rendered as healthy.

Drill-down views:

1. Activity and causal timelines.
2. Workflows and durable steps.
3. Events, batches, lag, retries, and checkpoints.
4. Signals and pending actions.
5. Providers and readiness.
6. Deployment graph and ownership.
7. Authority decisions and redacted receipts.

AI execution views additionally show the logical model, resolved provider,
whether content leaves the installation, declared tool capabilities, approval
boundaries, budget consumption, safety/redaction state, and whether cancellation
ended in known or uncertain completion. Unsafe outputs may be quarantined and
must not appear as ordinary completed artifacts.

Lifecycle views expose retention and bounded export/deletion for conversations,
documents, memory, immutable artifacts, workspace/account state, and audit
evidence. Workspace deletion and billing cancellation identify asynchronous
work and retained data before the operation is admitted.

The first-success evidence drawer deep-links to the relevant operation here.

## Navigation and journey transitions

```text
Arrival
  ├─ authentication required -> Account admission -> resume intended route
  ├─ workspace required -> Create/select workspace -> resume intended route
  ├─ product capability unavailable -> usable fallback or contact operator
  └─ ready -> First-run copilot
                 -> Persistent conversation
                 -> Assistant creates document
                 -> First-success state
                 -> Evidence drawer
                 -> Product journey center
                      -> Document detail and immutable Artifact output
                      -> Durable decision / Inbox
                      -> Conversation reload

Workspace-owner authority
  -> Team and invitation journey
  -> Usage and billing journey

Application-operator authority
  -> Launchpad / Setup
  -> Plan and deploy guidance
  -> Operations
```

Every transition retains an intended destination and uses server-validated
context. No component mutates workspace cookies during render or waits until
after the destination loader executes.

## Cross-view state specifications

Every view must define:

- initial SSR state;
- hydrated state;
- loading and mutation-pending state;
- empty state;
- setup-required state;
- degraded and retry state;
- forbidden and not-found state;
- unexpected error state with correlation ID;
- optimistic behavior, if any;
- reconnect and stale-data behavior;
- mobile layout; and
- keyboard/focus return behavior after dialog or sheet actions.

Shared rules:

- skeletons preserve final layout and never replace meaningful stale data;
- a spinner without a bounded explanation is not an error strategy;
- toasts confirm secondary actions, while durable state changes remain visible
  in the page;
- destructive actions name the affected resource and consequence;
- form errors appear at the field and summary levels;
- focus moves to the new page heading after navigation and returns to the
  trigger after sheets/dialogs close; and
- reduced-motion users receive immediate state changes without loss of causal
  clarity.

## Browser acceptance sequence

The principal golden-path test follows this exact order:

1. Open `/` by direct navigation with no prior browser state.
2. Complete sign-up/sign-in, deterministic Starter delivery, verification or
   recovery where applicable, and intended-route resumption.
3. Create/select the first workspace before `/app` resumes.
4. Ask the assistant to create the suggested document.
5. Observe the authoritative document in the existing live list without refresh.
6. Open “How this worked” and verify the redacted causal chain.
7. Invite a second user and accept through the direct invitation URL.
8. Receive and resolve a durable decision through Inbox, including reload.
9. Review usage and Starter billing without Stripe.
10. Verify a workspace owner cannot see Launchpad or Operations by default.
11. Admit a distinct application-operator role, open Launchpad, and verify
    graph-derived readiness with no credential values.
12. Open Operations and follow the document action to its full evidence,
    including AI provider/data/tool/budget and known/uncertain outcome state.
13. Remove the generated onboarding feature and prove the product routes,
    application graph, build, and deployment remain unchanged.
14. Export/delete bounded product data and verify retention consequences.
15. Prove an unsupported stateful profile transition fails during doctor/plan
    before mutation.
16. Repeat critical navigation in Chromium, Firefox, and WebKit, at mobile
    width, with keyboard-only input, and under slow-network/SSE interruption.

Separate credentialed evidence covers real OpenRouter and Stripe behavior. The
default journey must remain fully useful when those providers are not selected.

## Definition of visual completion

The experience is visually complete only after reviewed screenshots exist for:

- welcome/empty home;
- normal post-onboarding copilot and persistent conversation;
- assistant streaming and first success;
- document and immutable artifact library/detail;
- evidence drawer;
- workspace list/detail/invitation;
- inbox review and resolved decision;
- account with supported and unsupported provider capabilities;
- Starter and live-provider billing;
- ready, action-required, and degraded Setup;
- operations exception and causal-detail views;
- each classified route error;
- member, workspace-owner, and application-operator navigation variants;
- desktop light/dark and mobile light/dark; and
- loading, empty, success, warning, danger, degraded, and unknown semantic
  states.

Screenshot approval complements behavioral and accessibility tests; it does
not replace them.
