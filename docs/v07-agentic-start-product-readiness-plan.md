# Agentic Start product-readiness plan

**Status:** Normative v0.7 release work
**Audience:** framework maintainers and generated-application contributors
**Purpose:** turn Agentic Start from a broad capability demonstration into an
exceptional, production-ready first experience for a new Applik8s builder.

This plan is intentionally about product quality, not additional platform
scope. Agentic Start already composes a substantial SaaS and agentic baseline.
The remaining problem is that a new user encounters that capability as a set of
routes and framework facts rather than as one reliable, coherent journey.

The page-by-page layout, visual hierarchy, route states, transitions, and
responsive behavior are normative in
[`v07-agentic-start-experience-spec.md`](./v07-agentic-start-experience-spec.md).

The v0.7 release is not ready merely because the application graph compiles,
deploys, and has evidence for individual capabilities. A generated application
must also:

- render every supported first-run route without a server error;
- explain blocked or unavailable capabilities without collapsing into a 500;
- guide a new builder to a meaningful product result before asking them to
  understand infrastructure;
- make the relationship between product behavior and Applik8s primitives
  visible at the moment it is useful;
- provide a cohesive, accessible, responsive visual system that a real product
  can keep and customize; and
- carry the same quality through local development, provider configuration,
  production planning, deployment, operations, and recovery.

## Product thesis

The first-run promise is:

> Start with a working product. Accomplish something useful. See how Applik8s
> made it work. Configure only the capabilities you choose. Deploy the same
> application graph with confidence.

Agentic Start teaches by doing. The default product should demonstrate this
causal chain visibly:

```text
authenticated human
  -> workspace-scoped product action
  -> typed agent/tool call
  -> authoritative model transaction
  -> durable event/invalidation
  -> live browser update
  -> inspectable operation and causal evidence
  -> explainable deployment graph
```

The user should not have to read a framework checklist before using the app.
The first useful loop is the tutorial.

### Audience contract

Agentic Start serves three audiences whose needs must not be collapsed into one
dashboard:

| Audience | Primary goal | Visible surface |
| --- | --- | --- |
| Product member | Accomplish work with the agent | Copilot, conversations, library, Inbox, account |
| Workspace owner | Operate the SaaS workspace | Member surface plus members, roles, usage, billing, workspace settings |
| Application operator | Build and operate the deployment | Explicitly authorized Launchpad, Setup, Operations, deployment and causal evidence |

The same person may hold all three roles during local development, but the UI
must still preserve their conceptual boundaries. Product members never see
deployment profiles, environment variables, TypeKro, Alchemy, `doctor`, or
`plan`. Workspace owners do not acquire infrastructure authority merely because
they can administer product membership or billing. Operator routes and links
are absent when authority is absent, not disabled decoration.

### Default product: a workspace copilot

Notes remain the smallest readable mutable document model, but the
generated product is a workspace copilot rather than a notes application with a
chat box. Its default product loop includes:

- persistent, resumable conversations;
- streaming responses with stop, retry, and reconnect behavior;
- typed tool execution that creates or updates workspace documents;
- a library that distinguishes mutable documents from immutable run artifacts;
- durable background work and an actionable signal Inbox;
- run history and redacted causal explanation;
- team collaboration, usage, billing, account, and security; and
- local deterministic providers that can be replaced deliberately.

This is the minimum product that explains why a builder would choose an
agentic application framework over a conventional CRUD starter with chat
added. It remains small enough that the first model, tool, view, workflow, and
authority declaration can be understood together.

## Current gaps

### 1. Route reliability and failure semantics

The running starter has routes that can surface server errors. The current
templates load identity, workspace, billing, and operations state close to the
route boundary, but do not yet provide one uniform contract for setup-required,
unauthenticated, forbidden, dependency-unavailable, and unexpected failures.
One missing migration, provider, selector, or deployment observation can
therefore become a generic SSR failure.

The route tree also needs complete direct-navigation evidence. Client-side
navigation alone does not prove that workspace selection, invitation
acceptance, session hydration, or provider readiness is available before a
loader executes.

### 2. The first-run surface is informational rather than experiential

`AgenticStartOnboarding` currently renders a static four-item checklist. It
does not know which tasks the user completed, does not establish prerequisites,
does not guide the user through the product, and does not connect actions to
their resulting models, events, workflows, or deployment graph.

The generated home page presents notes and an assistant, but neither is framed
as a deliberate golden journey. Account, workspace, billing, and operations
feel like adjacent examples rather than stages of one product.

### 3. No cohesive application shell or component system

The product template currently uses global element selectors, a small set of
hand-authored classes, and inline framework component styles. Navigation is a
row of links rather than a responsive product shell. Empty, loading, degraded,
error, destructive, and success states do not share a visual language.

The result looks like a capable example, not a starter a team would be excited
to adopt as the foundation of a product.

### 4. Configuration is described rather than guided

Starter, Developer, Dedicated, and External are sound platform concepts, but
the browser experience does not progressively explain which one is active,
what is available, what is simulated, what requires credentials, or how to
move forward.

`.env` remains a valid local or production input when the user deliberately
chooses it. The UI must never read or display secret values. It should show only
declared variable names, whether a required binding is satisfied, its safe
source category, and a copyable next action. Secret References and external
providers remain first-class production alternatives.

### 5. Product and framework evidence are disconnected

The operations control center exposes important truth, but it is a separate
destination. The first-run journey does not reveal why the note changed,
which agent/tool acted, what authority was admitted, which event invalidated
the view, or which generated resources make the behavior possible.

### 6. Remaining integration and release-integrity gaps

The product pass must retain and finish the already identified correctness
work rather than bury it beneath UI polish:

- first-time Stripe checkout must establish a canonical Stripe Customer before
  customer-scoped portal, meter, and subscription operations rely on it;
- billing mutations must derive provider subscription identity from the
  authoritative principal-scoped record, never browser input;
- live Stripe mutation belongs in an explicitly credentialed end-to-end lane,
  not a default vertical test;
- provider prerequisite discovery must use module/capability metadata rather
  than a source identifier convention such as a variable named `database`;
- webhook authentication, unsupported event, and invalid payload errors must
  remain distinguishable;
- causal attribution needs one authentic human-to-agent-to-task-to-workflow-to-
  processor-to-command/audit acceptance chain rather than separately seeded
  hops; and
- generated route reproduction, profile topology, exact-candidate receipts,
  and scorecard state must describe the same source tree.

### 7. Public acquisition, identity, and delivery are not yet one journey

The authenticated product has account/session contracts, but the product plan
does not yet own the public landing, sign-up, sign-in, verification, recovery,
MFA enrollment, invitation continuation, or intended-route resumption
experience. Identity-provider courier behavior also does not deliver ordinary
application invitations.

v0.7 requires a provider-neutral transactional notification-delivery seam for
application mail, backed by the existing outbox. Starter uses a deterministic
inspectable sink. Dedicated and External bind a production provider. Ory may
continue to own verification and recovery delivery through its qualified
courier; Applik8s does not become a campaign or template-management product.

### 8. Operator authority and Launchpad evidence lack canonical ownership

Application-operator authority must be a typed application grant with explicit
bootstrap, revocation, expiry, audit, and break-glass recovery. Workspace owner,
environment-variable email, local URL, and installation visibility are never
operator authority.

Launchpad consumes compiled public graph metadata, redacted exact-candidate CLI
and deployment receipts, and maintained operational observations. It never
loads kubeconfig, provider credentials, arbitrary Alchemy state, or cluster
mutation capability into the web application. Every imported receipt names its
application graph, source, candidate, installation, and observation time.

### 9. Generated ownership, update safety, and size budgets conflict

The accepted ownership model is:

- maintained packages own runtimes, provider clients, accessible behavior-heavy
  controllers, and redacted operational queries;
- generated applications own visual tokens, used UI primitives, shell, copy,
  product routes, and onboarding definitions; and
- domain-aware maintained UI accepts render slots or application tokens rather
  than introducing another theme.

The former total-file budget is replaced by categorized ownership, largest-file,
dependency-direction, and per-feature readability budgets. The generator must
not satisfy a small-file count by producing monoliths. After the cohesive
reference product is reviewed, its category inventory becomes the release
baseline; no category may grow more than 15% and no application file may exceed
400 nonblank lines without a reviewed ownership exception. v0.7 also includes a
read-only `applik8s start update --check` command so application-owned auth and
route code can discover compatibility and security-relevant template changes.

### 10. Product state, artifact state, and lifecycle need sharper semantics

Generated application source owns an ordinary `OnboardingProgress` model and
its principal/workspace scoping. Framework React packages provide stateless
controllers and readiness descriptors, not canonical product-user persistence.
Launchpad readiness derives from deployment evidence rather than the onboarding
table.

A mutable Note or Document is not an immutable Artifact. Documents retain
ordinary model revision and collaboration semantics. Artifacts require object
storage identity, digest, provenance, producing run, and retention. The Library
may present both, but the schemas and lifecycle remain distinct.

The product journey must expose bounded export/deletion and retention behavior
for account, workspace, conversation, document, memory, artifact, and audit
state. Workspace deletion and subscription cancellation name retained data,
asynchronous work, and recovery consequences before execution.

### 11. AI trust and production-go-live UX remain incomplete

Product members need a plain-language disclosure of the active logical model,
whether content leaves the installation, which tools may run, which effects
require approval, and whether a cancelled request has a known or uncertain
provider outcome. Workspace owners need usage/cost budgets and retention.
Operators need provider resolution, safety/redaction posture, and quarantine or
uncertain-completion evidence.

The go-live view additionally derives DNS/TLS, identity courier, migrations,
backup/restore, retention, rate limits, quotas, Stripe webhook, observability,
rollback, and destruction obligations from the graph. A static checklist is not
release evidence.

### 12. Profile-transition and product-performance claims need honesty

Selecting a profile for a fresh installation is distinct from migrating an
existing stateful installation. A transition is executable only when the plan
proves ownership and state migration; otherwise doctor/plan explains the
unsupported boundary and fails before mutation.

Qualification covers Chromium, Firefox, and WebKit; keyboard and screen-reader
smoke paths; slow-network and SSE reconnect; SSR first content; hydration and
route-transition latency; layout stability; mobile interaction; reduced motion;
and zero console/hydration errors. Framework microbenchmarks do not substitute
for these product budgets.

## Bounded contracts added by this correction

These requirements reuse existing Applik8s primitives. They do not authorize a
parallel runtime or configuration system.

### Transactional application notification delivery

Application code commits a typed `NotificationRequested` fact through the
ordinary transaction/outbox boundary. A maintained event handler renders an
application-owned template and calls the selected `NotificationDelivery`
provider outside the model transaction. Delivery produces a durable,
idempotent, redacted receipt with `queued`, `delivered`, `failed`, or `unknown`
provider observation; it never turns provider acknowledgement into proof that a
human read the message.

Starter does not require out-of-band mail for its deterministic local identity.
It binds an inspectable delivery sink visible only to application operators in
Launchpad, while workspace owners may copy a bounded invitation link directly.
Dedicated and External bind an explicit provider. Identity verification and recovery may continue through
the selected identity provider's courier because those are provider protocol
flows, not application notifications.

### Application-operator bootstrap

The generated application declares an `ApplicationOperator` role and grants it
typed Launchpad and Operations read operations. Starter's application-owned
bootstrap migration grants the deterministic local owner. Dedicated and
External require provider-verified subject references through a one-time,
audited bootstrap path; email strings are not identities.

The bootstrap authority becomes inert after the initial canonical grant exists.
Revocation and expiry use the normal grant operations. Break-glass is an
explicit cluster/deployment-owner CLI operation that creates a bounded audited
grant and cannot bypass the canonical authority store.

### Read-only Launchpad evidence

Static explanation comes from the compiled public application/deployment graph.
`doctor`, `plan`, deploy, status, and recovery commands emit redacted immutable
receipts bound to source digest, candidate artifact set, graph digest,
installation identity, cluster identity, and observation time. Launchpad reads
their authorized projection through the ordinary application gateway.

Alchemy remains deployment-state authority and TypeKro remains Kubernetes
lifecycle authority. A Launchpad receipt is evidence, not a second desired-state
store. Stale receipts are labeled stale; missing evidence is Unknown, never
Ready.

### Generated source update awareness

`.applik8s/start-lineage.json` records the original Start, generator, upstream
TanStack, and template revisions. `applik8s start update --check` renders old and
current templates in isolation and reports unchanged, application-modified,
added, removed, conflicting, compatibility-changing, and security-relevant
paths. It never mutates application source in v0.7.

### Claim-level release evidence

Every non-documentation scorecard item declares named executable assertions,
the command and environment that produce them, expected classified
observations, and the exact-candidate receipt that satisfies them. A path merely
existing is not evidence. Receipts bind the commit, complete authored worktree
digest, package/artifact set, cluster identity where applicable, and assertion
results.

The planning-consistency gate compares charter/RFP status, deferred decisions,
the function-native conformance matrix, the Stimp capability map, scorecard
state, and acceptance manifests. A capability cannot be Complete in one source
while Partial, absent, or unexercised in another.

### Added threat boundaries

- Notification recipients and rendered content are untrusted bounded inputs.
  Providers enforce sender policy, recipient normalization, size/rate ceilings,
  idempotency, header/template injection resistance, redacted receipts, and
  authenticated delivery webhooks. Public responses do not permit account or
  invitation enumeration.
- Operator bootstrap accepts provider-verified subject references, not email
  strings or client-authored roles. Break-glass grants are bounded, expiring,
  audited, and visibly exceptional.
- Launchpad rejects receipts whose source, graph, candidate, installation,
  cluster, signature/integrity proof, or schema revision does not match the
  current authorized context. Receipt content is rendered as data, never HTML.
- `start update --check` treats template paths and contents as untrusted data,
  refuses traversal/symlink escapes, performs no template code execution, and
  never reads application secrets.
- Brand metadata validates public URL and asset boundaries and cannot introduce
  executable HTML, unsafe redirects, or secret-bearing configuration.

## Experience architecture

Implementation must follow the complete view inventory and cross-view state
contract in the experience specification. The sections below define ownership
and the high-level journey rather than replacing that screen-level design.

### Generated application ownership

The generated application owns the parts a product team should customize:

```text
src/
  brand.ts              # application-owned product identity and safe public metadata
  components/
    ui/                 # source-owned shadcn-style primitives
    shell/              # product navigation and responsive layout
    onboarding/         # product-specific steps and previews
    states/             # empty, loading, degraded, error, success
  features/
    copilot/
    conversations/
    library/
    documents/           # mutable application-owned notes/documents
    artifacts/           # immutable object-backed run outputs
    inbox/
    workspaces/
    account/
    billing/
    operations/
    onboarding/
  routes/               # thin TanStack route adapters
  styles/
    globals.css
    tokens.css
```

The default visual foundation should use Tailwind CSS with source-owned,
shadcn-style components built on accessible primitives and Lucide icons. The
generator copies reviewable component source into the application so builders
can change it without overriding an opaque framework theme.

`brand.ts` is ordinary application source containing the product name,
description, safe logo/mark imports, public support/legal links, and semantic
accent choice. Public admission, authenticated shell, generated metadata, and
application notification templates consume the same values. It contains no
provider configuration or secret and is never overwritten by an update check.

This is a component ownership model, not a dependency on shadcn as a runtime.
Generated applications should not import generic `Button`, `Card`, or `Dialog`
components from an Applik8s package.

### Framework ownership

`@applik8s/start-agentic/react` owns stateless domain-aware, browser-safe integration:

- authenticated account/session behavior;
- typed onboarding/readiness controllers and completion-state contracts;
- safe configuration descriptors that never contain secret values;
- profile and capability explanations derived from the application graph;
- links between product activity and maintained operational evidence; and
- reusable controllers/hooks for guided actions.

It does not own a global visual theme, product navigation, product copy, or a
monolithic dashboard component. Domain-aware components accept class names or
render slots so generated source controls presentation.

`@applik8s/operations-ui` continues to own redacted operational queries and
domain-specific operations views. It should consume the same application-owned
design tokens and primitives through adapters or render slots rather than
introducing a second visual system.

### Design-system baseline

The generated source needs a compact but complete baseline:

- semantic color tokens for canvas, surface, text, border, accent, success,
  warning, danger, waiting, degraded, and unknown;
- typography, spacing, radius, elevation, focus, motion, and content-width
  tokens;
- light and dark themes with system preference and a persisted user choice;
- `Button`, `Input`, `Textarea`, `Select`, `Checkbox`, `Label`, `FormField`,
  `Card`, `Badge`, `Alert`, `Tabs`, `Dialog`, `Sheet`, `DropdownMenu`,
  `Tooltip`, `Progress`, `Skeleton`, `Separator`, and `Toast` primitives;
- application-level `AppShell`, `Sidebar`, `MobileNavigation`, `PageHeader`,
  `EmptyState`, `ErrorState`, `SetupRequired`, `ProviderStatus`, `StepCard`,
  `CommandCopy`, and `EvidenceTimeline` compositions; and
- consistent pending, disabled, optimistic, success, retry, and destructive
  interaction behavior.

The shell should feel like an intentional contemporary SaaS product, not a
generic grid of dark cards. Density should be compact, hierarchy strong, and
framework detail progressively disclosed.

## Three connected journeys

### Journey A: Product-member activation

This is the default first-run experience and the only journey an ordinary
member sees.

1. **Reliable arrival.** Render the product shell despite optional-provider
   degradation. Establish identity and a valid workspace before route loaders
   consume workspace context.
2. **First conversation.** Start or resume a real persistent conversation with
   useful prompt suggestions. The assistant is labeled Local only when the
   deterministic Starter provider is active.
3. **First useful document.** A typed tool creates the first note/document. The
   authoritative library updates without refresh and records causal-human
   ownership plus agent execution provenance.
4. **Understand the result.** “How this worked” explains the product-level
   causal chain. Technical authority, transaction, event, and runtime evidence
   appears only on expansion and only when authorized.
5. **Durable collaboration.** The user receives and resolves a safe example
   decision in Inbox, then returns to the originating conversation or artifact.

After completion, the home route becomes the normal copilot workspace: continue
recent conversations, review recent documents and immutable artifacts, and handle pending decisions.
Tutorial furniture disappears. The journey may be skipped, resumed, reset, or
deleted from generated source without changing product or framework behavior.

### Journey B: Workspace-owner activation

This journey appears only to a workspace owner and never blocks member product
use.

1. Confirm workspace identity and application-owned policy.
2. Invite a teammate and explain the selected role in product language.
3. Review usage and the current entitlement/plan.
4. Exercise Starter billing without Stripe, or enter live checkout only when a
   billing-capable application explicitly selects Stripe.
5. Review workspace settings and account-security capabilities supported by the
   active identity provider.

Workspace administration does not expose infrastructure providers, deployment
profiles, environment variables, or cluster operations.

### Journey C: Application-operator Launchpad

Launchpad is an operator-authorized builder experience. During local generation
the bootstrap owner may also hold this authority, but production members and
workspace owners do not receive it implicitly.

1. **Orient:** map generated product features to their readable source symbols
   and inferred dependencies.
2. **Verify:** surface the safe result of `bun run doctor` and explain any
   prerequisite without reading or returning secret values.
3. **Configure:** derive capability requirements from module/provider metadata
   and the selected deployment graph. Show safe source category and variable
   names only.
4. **Preview:** present the imported `bun run plan` result grouped by product
   capability and ownership, with exact graph/manifest details available on
   demand.
5. **Deploy explicitly:** provide copyable commands; do not move cluster
   mutation into the browser or Vite.
6. **Operate:** follow readiness, causal evidence, workflows, events, signals,
   providers, and ownership through the separately authorized Operations
   surface.

Stripe appears only when billing is included and live Stripe is selected.
OpenRouter appears only when a live AI provider is selected. `.env` remains a
valid deliberate development or production source, but Launchpad never reads or
displays its values. `dev:cluster` remains credential-free; `dev:live` requires
only providers actually selected by the application.

### Journey ownership and removal

Product-member and workspace-owner onboarding definitions and their canonical
`OnboardingProgress` model live in generated, application-owned
`src/features/onboarding/` source. The framework supplies stateless readiness
descriptors and guided-action controllers. Removing that feature removes the
tutorial and its progress data but not identity, models, conversations,
documents, artifacts, Inbox, billing, operations, or deployment.

Launchpad and Operations are maintained integrations with explicit authority.
They can be excluded from a production application's browser build while their
CLI and runtime contracts remain available. No generated product feature may
depend on a tutorial component to function.

## Route reliability program

### Route inventory

Before visual restructuring, generate and maintain a route manifest covering:

- `/`, `/sign-up`, `/sign-in`, `/verify`, and `/recover` in the public shell;
- `/app` for the authenticated copilot home;
- `/app/conversations/:conversationId`;
- `/app/library`, `/app/documents/:documentId`, and `/app/artifacts/:artifactId`;
- `/app/inbox`;
- `/app/workspaces`;
- `/app/workspaces/:workspaceId`;
- `/invitations/:invitationId`;
- `/app/account`;
- `/app/usage`;
- `/app/billing`;
- `/app/setup` and `/app/setup/deploy` when operator-authorized; and
- `/app/operations`.

Every route is exercised in each applicable state:

- anonymous, authenticated, expired, and revoked session;
- no workspace, selected workspace, inaccessible selector, and accepted
  invitation;
- Starter, Developer, Dedicated, and External profile;
- provider ready, optional provider absent, setup required, degraded, and
  temporarily unavailable;
- server-rendered direct navigation, hard reload, client navigation, and
  browser back/forward; and
- desktop and mobile viewport.

### Typed route failure contract

Route loaders and maintained server functions return or throw classified
application errors:

- `AUTHENTICATION_REQUIRED`;
- `AUTHORIZATION_DENIED`;
- `CONTEXT_SELECTION_REQUIRED`;
- `SETUP_REQUIRED`;
- `DEPENDENCY_UNAVAILABLE`;
- `RESOURCE_NOT_FOUND`;
- `CONFLICT`; and
- `INTERNAL_ERROR` with a correlation identifier.

TanStack route error boundaries map these to intentional screens and recovery
actions. Expected first-run states are not logged as internal failures and do
not return a 5xx. Unexpected errors are correlated with server logs and expose
no secret or unrestricted diagnostic detail.

The root session loader must not make the entire route tree unavailable when
account enrichment, MFA capability discovery, or an optional identity feature
is down. It should preserve the last safely authenticated shell state where
possible and report degraded capability separately.

### Reliability evidence

A route-contract test starts the generated production server and visits the
full matrix. It records response status, hydration completion, page errors, and
server log correlation. Release gates require:

- zero unexpected 5xx responses;
- zero unhandled browser errors or rejected promises;
- zero hydration mismatches;
- no route that remains indefinitely in loading state;
- deterministic recovery action for each expected failure; and
- no secrets, provider payloads, or unrestricted diagnostics in HTML or logs.

## Implementation phases

### Current implementation checkpoint

The generated product has completed the non-authority portions of Phases 1–3:

- anonymous and authenticated shells do not mount protected route queries
  before admission;
- workspace-scoped Inbox query and SSE hooks mount only after the selected
  workspace boundary is installed;
- a fresh product exposes the durable signal issuance, reload, typed action,
  framework-derived actor, and receipt-backed persistence path described by
  the function-native RFP;
- generated light, dark, and system themes, route states, product navigation,
  onboarding, conversations, document/artifact Library, usage, billing,
  account security, and bounded data lifecycle controls share one source-owned
  component system;
- AI trust disclosure names the logical model, resolved-provider boundary,
  declared tools, causal authority, data-sharing boundary, and uncertain
  completion behavior;
- Vite serve installs deterministic framework-owned local defaults before
  Nitro can import the generated gateway, preserves explicit `.env` values,
  and leaves build/deploy side effects to the CLI; and
- the exact-candidate browser suite owns direct-navigation status/console
  checks and a reload-surviving durable-decision journey.

This checkpoint does not declare release completion. Canonical
`ApplicationOperator` bootstrap/revocation/break-glass authority and
digest-bound Launchpad evidence remain a single deliberate security boundary;
they must not be substituted with workspace ownership, local URL trust, or an
environment-variable shortcut. Exact OrbStack, cross-browser, accessibility,
degraded-network, and packed-candidate evidence remains in Phases 5–6.

### Phase 0: Close planning authority and substrate contracts

1. Keep the accepted charter/RFP decisions, conformance matrix, capability map,
   scorecard, and executable acceptance manifests under the planning-
   consistency gate.
2. Qualify the generated live frozen-batch path; the distinct one-shot
   `Model.query` surface is complete.
3. Make Chirp exercise every signal, batch, and resource/workflow-tracking
   behavior attributed to it.
4. Implement the bounded `NotificationDelivery` capability, deterministic
   Starter sink, SMTP Dedicated adapter, and External binding contract.
5. Implement canonical application-operator bootstrap/revocation/break-glass,
   digest-bound read-only deployment receipts, and `start update --check`.
6. Expand the threat model for public admission, notification delivery,
   operator authority, Launchpad evidence, update checking, and safe brand data.

**Exit:** the public/runtime contracts needed by the new routes and journeys
compile from packed packages, have focused adversarial evidence, and introduce
no second authority or deployment path. UI implementation does not begin on a
provisional security or persistence model.

### Phase 1: Stabilize the running product

1. Reproduce and inventory every currently failing page against the exact
   generated Starter and the user's active local deployment.
2. Add production-server request/error correlation and browser console capture.
3. Introduce the typed route failure contract and root/route error boundaries.
4. Fix workspace selection before loader execution and invitation transitions.
5. Make optional or unavailable account, billing, and operations capabilities
   render honest setup/degraded states.
6. Add the route matrix and a zero-unexpected-5xx release gate.

**Exit:** every route is reliable through SSR, reload, and navigation before
the visual rewrite begins.

### Phase 2: Establish the generated design system and shell

1. Add Tailwind and source-owned shadcn-style primitives to the official
   generator overlay.
2. Build the responsive application shell, navigation, page headers, state
   components, forms, notifications, and theme behavior.
3. Replace inline styles in maintained Agentic Start UI with renderable,
   application-themed domain components.
4. Adapt account and operations surfaces to the same tokens and interaction
   patterns.
5. Split product routes and feature UI into reviewable modules; keep routes
   thin and template budgets explicit.

**Exit:** the generated product is visually cohesive, customizable, responsive,
and has no second hidden framework theme.

### Phase 3: Build the guided product journey

1. Replace the static checklist with the three separately authorized journeys.
2. Build the persistent copilot, conversation, first document, assistant tool,
   causal explanation, and Inbox stages for product members.
3. Build owner-only team, role, usage, billing, and workspace stages without
   leaking deployment authority.
4. Build the operator-only Launchpad over graph-derived safe descriptors,
   imported CLI evidence, Setup, and Operations.
5. Keep the usable product visible; do not render the entire control center
   beneath a tutorial or trap users in a wizard.
6. Add skip, resume, reset, completion, and clean tutorial-removal behavior.

**Exit:** an unfamiliar builder can complete the golden path without external
documentation and can explain the key Applik8s primitives it just exercised.

### Phase 4: Make setup and deployment exceptional

1. Derive readiness and prerequisites from module/provider metadata and the
   deployment graph.
2. Build the safe setup center for profiles, `.env` variable names, Secret
   references, provider bindings, and next actions.
3. Ensure Starter and `dev:cluster` are credential-free and `dev:live` requires
   only providers actually selected by the application.
4. Integrate `doctor`, `plan`, deploy, status, and recovery explanations into
   one progressive journey without moving side effects into Vite.
5. Explain local-source mount compatibility and fail before graph mutation on
   unsupported remote clusters.

**Exit:** local through production is one comprehensible path with explicit
authority and no credential leakage.

### Phase 5: Close correctness and integration gaps

1. Complete the canonical Stripe Customer mapping and tenant-safe subscription
   operations.
2. Move live Stripe mutations to the opt-in end-to-end lane.
3. Replace syntax-based provider prerequisite inference with declared metadata.
4. Preserve webhook error taxonomy end to end.
5. Execute the complete causal chain through real generated boundaries.
6. Reconcile route trees, topology, RFP status, scorecard state, and candidate
   receipts.
7. Close live frozen-batch qualification and every
   Chirp capability claimed by the conformance matrix.
8. Add transactional application notification delivery, operator bootstrap,
   read-only Launchpad receipt ingestion, and `start update --check`.

**Exit:** the polished experience is backed by the real security, billing,
causal, and deployment contracts it claims to demonstrate.

### Phase 6: Product qualification

1. Run component accessibility tests and keyboard-only journeys.
2. Capture reviewed visual baselines at desktop, tablet, and mobile sizes in
   light and dark themes.
3. Run the complete onboarding golden path against Starter, then the
   provider/configuration path against Developer, Dedicated, and External.
4. Test slow providers, restarts, revoked sessions, expired invitations,
   invalid workspace selection, missing credentials, and network interruption.
5. Generate a fresh application from packed packages and prove source
   readability, route determinism, application tests, production build, live
   deployment, no-op redeploy, restart, and graph-backed teardown.
6. Refresh exact-candidate release receipts only after the final visual and
   behavioral source changes.
7. Exercise the public acquisition/identity journey, notification delivery,
   AI trust controls, data deletion/export, go-live obligations, and unsupported
   profile-transition diagnostics.
8. Run Chromium, Firefox, and WebKit product budgets in addition to component
   accessibility and framework microbenchmarks.

**Exit:** independent review can treat the generated application as both a
credible product baseline and the clearest introduction to Applik8s.

## Acceptance journeys

The final browser suite is organized around people and outcomes rather than
routes:

1. **First success:** a fresh user reaches a working copilot, starts a
   persistent conversation, creates a mutable note/document through the assistant,
   sees the library update live, and opens the causal explanation.
2. **Workspace collaboration:** owner creates a workspace, invites a member,
   the member accepts through a direct URL, and both see appropriately scoped
   state and actions.
3. **Durable decision:** a workflow emits an approval signal, an authorized
   user receives it over SSE, resolves it, and the originating UI survives
   reload/reconnect.
4. **Account security:** supported account/session operations work; unsupported
   provider capabilities are accurately absent or explained.
5. **Billing:** Starter is useful without Stripe; Developer can opt into a real
   Stripe customer/checkout/webhook/portal/meter path with tenant isolation.
6. **Operate:** a user follows a product action into redacted causal and
   provider evidence, then recovers from one deliberately degraded dependency.
7. **Ship:** an explicitly authorized application operator uses Launchpad to
   verify requirements, preview the graph, select a profile, deploy explicitly,
   observe readiness, perform a no-op reapply, and destroy through
   Alchemy/TypeKro. A workspace owner cannot enter this path without operator
   authority.

## Quality bar

Agentic Start is complete for v0.7 only when all of these are true:

- the route matrix has no unexpected server error;
- every expected blocked state is useful, truthful, and recoverable;
- the first useful result is achievable in minutes without credentials;
- the onboarding journey is resumable, skippable, and grounded in the real
  product;
- product-member, workspace-owner, and application-operator navigation is
  authority-shaped and never conflated;
- the generated product is a credible workspace copilot with conversations,
  artifacts, typed tools, durable decisions, and provenance rather than a chat
  box attached to CRUD;
- removing application-owned onboarding source leaves the complete product and
  deployment graph functional;
- the UI is cohesive, accessible to WCAG 2.2 AA expectations, keyboard usable,
  responsive, and visually reviewed;
- generated UI source is readable and product-owned;
- domain-aware framework components remain provider-neutral and theme-neutral;
- all secret material stays server-side and every configuration display is
  value-free;
- authority, tenant isolation, idempotency, causal attribution, and provider
  identity survive the browser-to-runtime golden paths;
- setup and profile requirements come from the real graph, not a duplicated
  checklist;
- the production build and packed consumer reproduce the tracked routes and
  visual source exactly; and
- fresh exact-candidate receipts prove deployment, restart, no-op, recovery,
  and complete graph-backed teardown.

## Deliberate non-goals

- Do not add unrelated v0.7 platform capabilities to make the starter look
  richer.
- Do not copy STIMP's component implementation, monolithic onboarding class,
  or inline-style architecture.
- Do not make Vite an implicit deployment engine.
- Do not hide TypeKro/Alchemy ownership or provider decisions behind an opaque
  `agenticStart(...)` constructor.
- Do not put application tenancy, plans, branding, or product navigation in
  the core framework.
- Do not require Stripe, OpenRouter, Ory, or any external credential for the
  default first success.
- Do not make onboarding a permanent dashboard banner or render every advanced
  control at once.

## Priority

The highest-impact work is the intersection of reliability and journey:

1. route/server failure reproduction and typed recovery;
2. first useful agentic loop with real causal evidence;
3. cohesive shell and source-owned component system;
4. guided configuration derived from the graph;
5. correctness closure for Stripe, provider metadata, webhook taxonomy, and
   causal propagation; and
6. visual, accessibility, packed-consumer, and live release qualification.

This is the v0.7 stabilization path. New capability work resumes only after the
starter proves that the capabilities already present form an excellent product
and builder experience.
