# RFP: Documentation Website and Product Legibility

**Status:** Accepted; architecture frozen; release-blocking for v0.9 and 1.0 RC

**Audience:** Applik8s maintainers, documentation authors, design implementers, and release reviewers

**Requested by:** The v0.9 semantic-completion and 1.0-readiness program

**Revised:** 2026-08-30

**Target:** Applik8s v0.9 documentation website and continuing 1.0 release gate

## Executive summary

Applik8s has accumulated a broad, coherent programming model, but much of its intelligibility still depends
on repository history, RFPs, examples, or a maintainer explaining the system. That is not sufficient for a
1.0 framework. The documentation website must become a versioned product surface that teaches the smallest
useful application first, progressively reveals distributed semantics, and exposes exact reference and
provider truth when users need it.

This RFP defines the website's information architecture, editorial system, visual language, page templates,
example policy, generated reference, versioning, search, accessibility, performance, and release gates.

The intended writing and interaction rhythm takes inspiration from the official [OpenCode
documentation](https://opencode.ai/docs/) and [SST documentation](https://sst.dev/docs/): state the useful
idea directly, show the smallest real example immediately, keep pages focused, reveal configuration after
the happy path, and link to lower-level machinery instead of front-loading it. Applik8s retains its own
vocabulary, visual identity, depth, and semantic honesty; this is not a visual or textual clone.

## Existing functionality that must not be duplicated

| Capability | Existing boundary to reuse |
| --- | --- |
| Canonical contracts | Manifestos, accepted RFPs, package APIs, graph schemas, diagnostics, provider evidence |
| Learning applications | GuestBook, Chirp, and Agentic Start |
| Inspectability | `applik8s explain`, `applik8s plan`, graph and plan artifacts |
| API extraction | TypeScript declarations, package exports, schemas, CLI metadata |
| Release data | Package versions, maturity classifications, compatibility matrices, changelog |
| Verification | Typecheck, package-consumer tests, journeys, live deployment gates |

The website consumes these sources. It must not become a second hand-maintained API catalog or another
terminology authority.

## Product goal

A technically sophisticated TypeScript developer should be able to answer within ten minutes:

1. What is Applik8s?
2. What can I build with it?
3. What does ordinary application code look like?
4. How does the same code become distributed infrastructure?
5. Which guarantees are portable, provider-qualified, beta, or preview?
6. How do I run, explain, plan, deploy, observe, and debug it?

The website should make Applik8s feel simpler than the system it builds without concealing that system's
real guarantees.

## Reference qualities

The strongest OpenCode/SST documentation qualities to adopt are:

- a direct one-sentence page definition;
- the first useful code example above the fold;
- short paragraphs and concrete headings;
- one primary concept or task per page;
- real filenames on examples;
- explicit file locations, precedence, defaults, and escape hatches;
- progressive disclosure from normal use to configuration to internals;
- compact tables for decisions, not paragraphs rewritten as tables;
- warnings only where a user could create a semantic, security, or lifecycle hazard;
- nearby links to the next likely task.

Applik8s adds requirements those references do not need to emphasize as strongly: maturity labels,
provider-guarantee truth, authority boundaries, graph/plan explanation, lifecycle/deletion behavior, and
compatibility evidence.

## Normative decisions

1. The website leads with the application programming model, not Kubernetes, TypeKro, Alchemy, or package
   topology.
2. Every conceptual page opens with a plain-language definition and minimal working example.
3. Every task page produces a visible outcome before explaining alternatives.
4. Canonical examples compile or execute against the exact documented version.
5. Stable, beta, preview, experimental, deprecated, and internal maturity are visibly distinct.
6. Provider support is generated from evidence and never promoted by prose alone.
7. Reference is generated from public contracts but curated with human explanations and examples.
8. RFPs and manifestos remain design records, not the ordinary user manual.
9. Search prefers canonical current APIs and demotes historical/superseded vocabulary.
10. Documentation is version-matched, accessible, fast, and useful without client-heavy diagrams.
11. Repeated documentation difficulty triggers API simplification before 1.0 freeze.
12. The website is tested as a release artifact.
13. Provider-author documentation teaches one deployment boundary: TypeKro authors every Kubernetes API
    resource and deploys it through Alchemy; native Alchemy resources author non-Kubernetes managed
    infrastructure; external bindings contribute no infrastructure. Ordinary application tutorials do not
    expose or classify this implementation choice.

## Architectural boundary

The documentation system owns information architecture, editorial and visual primitives, versioning,
search, generated reference assembly, code verification, and website acceptance. Public contract owners
remain authoritative for semantics, maturity, provider evidence, and migration policy. The website renders
those sources; it cannot redefine them through prose.

## Initial implementation architecture

The first maintained site uses Astro with Starlight as the static documentation shell. This is an
implementation choice, not a public Applik8s API. The repository owns theme tokens/components, information
architecture, content schemas, generated reference assembly, and acceptance tests; replacing the renderer
must preserve URLs, accessibility, versioning, search, and build contracts.

The production artifact is static HTML/CSS with bounded progressive JavaScript. Pagefind supplies the
initial same-origin search index so source code and queries are not sent to a third party. A hosted search
provider may replace it only after privacy, version-ranking, availability, and export/rollback review.

Each stable minor release produces an immutable version snapshot from the release tag and contract
catalog. `/docs/current/` resolves to the latest stable snapshot; preview documentation lives under an
explicit preview path and cannot overwrite stable content. The build fails when one version combines
packages, examples, CLI reference, or provider evidence from different release trains.

The initial deployment is a normal versioned static-site artifact published by release automation. Hosting
configuration is operational policy and may use GitHub Pages or another static host, but no host becomes
content or version authority. Pull requests publish isolated preview artifacts with robots exclusion.

Analytics are disabled by default. If enabled later, the only accepted initial events are page/navigation,
search-result outcome, version selection, and documented journey completion with coarse anonymous session
identity. Query text, code, diagnostics containing application values, credentials, and authenticated user
identity are never collected.

## Information architecture

The top-level navigation is:

```text
Home
Start Here
Build Applications
Events & Reactive Systems
Distributed Behavior
Data & Analytics
AI & Agents
Security
Infrastructure & Providers
Understand & Operate
Examples & Starts
Reference
Upgrade & Migrate
```

Each section has a short landing page that answers “why is this section useful?” and recommends no more
than three starting paths.

The canonical pedagogical split is:

- **Build Applications:** models, operations, events, queries and views, modules, and HTTP/UI integration;
- **Distributed Behavior:** finite jobs, query batching, workflows and signals, Sagas, actors, scheduling,
  consistency, idempotency, and retries.

Ordinary query authoring remains under Build Applications. `Query.onBatch(...)` belongs to Distributed
Behavior because its durable windows, retries, progress, and execution provider are distributed execution
semantics rather than ordinary query construction.

## Homepage

The homepage is a product explanation, not a changelog or component gallery.

### Hero

One sentence describes the category:

> Build distributed TypeScript applications as one typed application graph—from models and events to jobs,
> agents, infrastructure, and operations.

The hero contains:

- a concise primary example;
- “Start building” and “See how it works” actions;
- current stable version and maturity state;
- no infrastructure vendor logos above the conceptual explanation.

### Primary example

The first code sample should show a model, one typed action, one event reaction, and one provided capability
in roughly 20–30 lines. It must be real, runnable, and linked to the complete GuestBook source.

### Explanation sequence

1. **Write application semantics** — callable models, operations, events, jobs, workflows, and agents.
2. **Compose dependencies in code** — provider-neutral capabilities and profiles.
3. **Compile the graph** — generated runtime boundaries, permissions, workloads, and infrastructure.
4. **Explain before deploying** — application graph and plan.
5. **Run anywhere supported** — local and maintained provider-backed deployments with explicit guarantees.

### Proof

Use three bounded application cards:

- GuestBook: smallest complete teaching application;
- Chirp: complex distributed product and scale/composition proof;
- Agentic Start: batteries-included agentic SaaS foundation.

The homepage does not enumerate every package or experimental provider.

## Page types

### Concept page

Use for a semantic noun such as model, event, job, workflow, projection, capability, or authority.

Required order:

1. one-sentence definition;
2. minimal example;
3. when to use it;
4. how it composes;
5. guarantees and failure semantics;
6. provider/profile and implementation-guarantee notes;
7. next tasks;
8. reference links.

### Task page

Use for “create a job,” “deploy to Kubernetes,” or “subscribe from React.”

Required order:

1. outcome;
2. prerequisites;
3. smallest successful steps;
4. verify the outcome;
5. common variation;
6. failure/remediation;
7. cleanup or rollback where relevant.

### Tutorial

A tutorial builds one coherent product feature across several concepts. It is not a disconnected tour of
APIs. Each checkpoint runs and produces a visible change.

### Reference page

Reference is exhaustive and compact: signatures, defaults, constraints, availability, maturity, source
package, diagnostics, and links back to conceptual guidance.

### Troubleshooting page

Starts from a symptom or stable diagnostic code, explains why it happens, gives a minimal confirmation
step, and provides safe remediation and rollback.

### Provider page

Separates:

- application semantics supported;
- native versus emulated guarantees;
- maturity and evidence;
- infrastructure prerequisites;
- configuration;
- lifecycle/upgrade/deletion behavior;
- known limitations and cost/capacity considerations.

## Page template

Canonical Markdown pages use a small frontmatter contract:

```yaml
title: Finite jobs
description: Run bounded work that can outlive its caller.
section: Distributed Behavior
maturity: stable
since: 0.9.0
sourcePackages:
  - "@applik8s/applik8s"
relatedDiagnostics:
  - JOB_PROVIDER_UNSUPPORTED
```

The rendered page places metadata quietly near the title. Maturity is visible but not visually louder than
the task itself.

## Code examples

Examples follow these rules:

- use TypeScript unless a lower-level format is the subject;
- label blocks with realistic filenames;
- show imports when they clarify package ownership;
- prefer one complete, copyable example over several fragments;
- avoid undefined placeholders and unexplained helpers;
- use canonical direct callable APIs rather than internal facets;
- hide generated/provider code until the page specifically explains it;
- link to a complete runnable example;
- typecheck every stable example in CI.

Tabs are reserved for genuine profile/provider or framework alternatives, not used to compress unrelated
ideas.

## Editorial voice

The voice is confident, compact, and concrete:

- lead with what the user can do;
- prefer active verbs and plain nouns;
- make one claim per sentence when semantics are subtle;
- say “fails” or “is unsupported” instead of “may not work”;
- name the owner of a guarantee;
- distinguish application code, generated code, runtime, and provider;
- avoid marketing adjectives when a runnable example can prove the point;
- never apologize for necessary distributed constraints; explain them clearly.

Avoid framework-history narration, internal project codenames, future-consumer references, implementation
agent language, and comparison-driven positioning in canonical task docs.

## Controlled vocabulary

Canonical documentation uses these terms consistently:

| Term | Exact meaning |
| --- | --- |
| **profile** | Optional application assembly policy that selects and configures a coherent set of concrete provider implementations |
| **provider implementation** | Typed implementation value satisfying one capability, including its runtime adapter and optional deployment contributor |
| **deployment** | One operational application instance and its persisted plan/state; it is not an authoring selector |
| **environment** | Configuration-source and runtime-context label such as local, preview, or production; it does not choose infrastructure independently of a profile |
| **execution host** | Physical runtime that executes admitted work, such as a Kubernetes worker, ECS task, process, actor, or workflow worker |
| **binding** | Connection between a capability and a concrete provider implementation; an external binding owns no infrastructure |

`target`, `placement`, `substrate`, and application-authored `installation` are legacy migration terms when
they refer to assembly. They must not appear as new public selectors. Domain-specific uses such as an HTTP
target, event target, placement constraint inside a concrete provider, or a provider-owned installation CR
remain valid when the page names that narrower meaning.

The docs generator and prose checks should flag unqualified legacy assembly terminology in current pages.
Migration pages may use it only while mapping the old term to the canonical v0.9 contract.

## Progressive disclosure

Every major primitive has three linked layers:

1. **Use it** — canonical syntax and useful outcome.
2. **Understand it** — lifecycle, consistency, authority, and composition.
3. **Extend it** — provider interfaces, generated graph, and lower-level escape seams.

The normal page does not force users through layer three. Advanced pages remain precise enough for provider
authors.

## Visual system

The website should feel like a serious developer tool: restrained, crisp, fast, and code-forward.

### Layout

- readable content column around 720–800px;
- persistent section navigation on desktop;
- compact in-page table of contents for long semantic pages;
- generous whitespace without oversized marketing sections;
- mobile navigation that preserves search and version access.

### Typography

- highly legible text face;
- distinct but restrained display face if desired;
- code typeface optimized for TypeScript punctuation;
- 16px minimum body text and comfortable line height;
- no low-contrast muted text for normative details.

### Components

Use a small documented set:

- code block with filename/copy/source link;
- semantic maturity badge;
- note, warning, danger, and provider-limitation callouts;
- decision table;
- step list;
- package/API signature reference;
- plan/explain output block;
- compatibility matrix;
- “next” links.

Decorative cards do not replace content hierarchy. Diagrams are used only when a relationship is harder to
understand linearly.

## Search and discovery

Search indexes title, description, headings, API symbols, diagnostic codes, packages, and providers.

Ranking prefers:

1. current stable canonical API;
2. current conceptual/task docs;
3. current reference;
4. migration/deprecation pages;
5. older version docs.

Deprecated aliases redirect or display a migration result. Searching `app.job` should lead to the workload
migration and canonical `application.job()` docs, which may demonstrate
`const job = application.job` for concise module authoring; it must not normalize semantic and workload
Jobs as equivalent.

## Generated reference

Public package exports, API signatures, graph schemas, plan schema, diagnostic catalog, provider catalog,
maturity, and compatibility data are generated from machine-readable sources.

Generation fails when:

- a public export lacks ownership or maturity;
- a stable diagnostic lacks documentation;
- a provider claim lacks evidence;
- two packages claim the same canonical symbol;
- generated reference differs from checked-in output.

Human-authored introductions and examples sit above generated detail. Raw TypeDoc output alone is not an
acceptable reference experience.

## Versioning

The default site documents the latest stable Applik8s train. Version selection changes all API, CLI,
provider, migration, and example content together.

Preview docs are visibly marked and cannot outrank stable pages. Removed APIs remain available in their
historical version and migration guide. Search results show version mismatches before navigation.

## Explain and plan integration

Concept pages include representative `applik8s explain` or `applik8s plan` output where it materially
teaches hidden consequences. Output is generated from runnable fixtures so field names cannot drift.

The site may offer small interactive graph views, but the same facts remain available as accessible text.

## Accessibility and performance

Release gates require:

- WCAG 2.2 AA for canonical flows;
- complete keyboard navigation and visible focus;
- semantic headings and landmarks;
- accessible code-copy and tab controls;
- reduced-motion support;
- readable light/dark themes;
- no color-only maturity or warning semantics;
- fast static rendering and bounded client JavaScript;
- useful pages with scripts unavailable where practical.

## Content implementation sequence

### Phase 1 — foundation

- visual tokens and components;
- page/frontmatter schema;
- navigation, versioning, search, code verification;
- generated public contract catalog.

### Phase 2 — ten-minute path

- homepage;
- What Applik8s is;
- install/create/run/change/explain/plan/deploy path;
- GuestBook tutorial.

### Phase 3 — semantic core

- models, operations, queries/views, events/streams/projections;
- jobs, query batching, workflows/signals/Sagas;
- capabilities, profiles, concrete provider configuration, and authority;
- composing higher-level implementations from typed implementation values or separately bound capability
  references, including private versus explicitly exposed dependencies;
- managed versus external capability ownership and Secret/config sources;
- named Kubernetes-cluster configuration/injection versus the physical resources produced by providers.

### Phase 4 — breadth and operations

- data/analytics, AI/agents, infrastructure/providers;
- runtime evidence, lifecycle, debugging, upgrades;
- Chirp and Agentic Start guides.

### Phase 5 — qualification

- clean-context usability study;
- search audit;
- accessibility/performance audit;
- link/example/reference/version consistency gate.

## Documentation workflow

Every feature change answers in the same pull request:

- Which concept/task/reference pages change?
- Which maturity/provider claims change?
- Which runnable examples prove the new contract?
- Does the quickstart or decision guide change?
- Is a migration or diagnostic page required?

Documentation can block an API: if the canonical behavior cannot be explained simply, the API returns to
design review before the 1.0 freeze.

## Acceptance journeys

The website owns automated journeys for:

- a new user going from homepage to running GuestBook;
- finding the correct primitive from the decision guide;
- finding and fixing a stable diagnostic;
- comparing provider guarantees;
- locating the migration for a deprecated API;
- navigating solely by keyboard;
- switching versions without mixing content;
- copying and running a canonical example.
- building and searching the static site with scripts disabled where the page contract promises it.
- producing an immutable version snapshot whose package, CLI, examples, and provider evidence come from
  one release train.

Clean-context reviewers must complete the ten-minute path without repository history or maintainer help.

## Metrics

Metrics inform design but do not replace qualitative review:

- quickstart completion and failure points;
- searches with no useful result;
- repeated diagnostic searches;
- stale/broken example rate;
- time to canonical API page;
- accessibility/performance regressions;
- pages most often reached from migration aliases.

No analytics may record source code, secret values, query payloads, or identity-sensitive content.

## Non-goals

- copying another project's design or prose;
- making RFPs the primary user documentation;
- leading with implementation substrates;
- documenting unsupported future features as current;
- replacing precise semantics with marketing copy;
- requiring interactive diagrams to understand core contracts.

## Definition of done

The documentation website is release-ready when a clean-context TypeScript developer can understand the
product, build and run the smallest application, choose among core primitives, inspect a plan, find exact
reference and provider guarantees, diagnose common failures, and upgrade safely—using version-matched,
tested, accessible pages whose claims are generated from the same contract and evidence sources as the
release.

The provider guide must include one integrated-versus-assembled runtime example, one shared-dependency
example, one capability-reference example, and one plan view that makes private dependency edges and
lifecycle ownership visible without implying callback authority.

It must also present the normative `production-aws` and `production-kubernetes` profiles side by side,
show Chirp's unchanged semantic application source, link every constructor to its provider contract, and
explain which parity is guaranteed versus deliberately out of scope.
