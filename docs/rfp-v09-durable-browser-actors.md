# RFP: Durable Browser Actors and Standard Browser Automation

**Status:** Proposed v0.9 preview; revised standard-protocol architecture; implementation and acceptance
remain incomplete

**Audience:** Applik8s maintainers, application authors, provider authors, Agentic Start maintainers, and
browser-client integration authors

**Requested by:** The v0.9 specialized-agent and semantic-completion program

**Revised:** 2026-09-02

**Target:** A small provider-neutral `browserActor()` experience, pooled Moli/Celld execution,
standards-based TypeScript automation through WebdriverIO, and JavaScript-rendered source retrieval

## Executive summary

Applik8s can retrieve server-returned HTML and text, but it cannot currently render a JavaScript
application, maintain a durable authenticated browser profile, or expose a safe browser session to an
agent. Playwright usage in tests is not an application browser capability.

This RFP introduces `browserActor()` as a maintained composition over the existing actor runtime. One
logical browser actor represents one durable, identity-addressed browser session. `BrowserPool` supplies
physical capacity for browser actors; it does not own their logical identities or durable state.

Applik8s must not create another browser automation API. Browser automation already has standardized and
widely implemented protocols. The framework owns durable session identity, capability admission, pooling,
policy, profile/checkpoint state, evidence, recovery, and lifecycle. An authorized caller receives a
short-lived connection lease and uses an existing browser client:

- [WebDriver BiDi](https://www.w3.org/TR/webdriver-bidi/) is the canonical standards-based automation
  protocol for new TypeScript application code;
- [WebDriver Classic](https://www.w3.org/TR/webdriver2/) remains a compatibility protocol where required;
- CDP is an explicitly engine-specific compatibility surface for consumer-selected Chromium-oriented
  clients.

The maintained TypeScript integration uses WebdriverIO and returns its real client types. Applik8s does not
wrap `url()`, `$()`, `click()`, `setValue()`, script execution, tabs, frames, downloads, or screenshots in a
parallel facade. Other clients may attach through an authorized standard-protocol lease, but their agent
loops, tool servers, task models, and application semantics remain consumer concerns.

The first maintained browser provider uses Moli inside a dedicated Celld browser worker/cell class. Moli
already exposes CDP, WebDriver Classic, and WebDriver BiDi from one endpoint. Moli remains an implementation,
not application semantics. Other engines may implement the same pool and protocol-conformance contracts.

Research agents continue to depend only on `SourceRetriever`. A browser-backed retriever may use an
internal ephemeral browser actor to render dynamic pages and returns the same normalized source/evidence
contract as bounded HTTP retrieval. Application authors declare `browserActor()` directly only when
authenticated profile state, navigation, forms, downloads, or multi-page session identity are genuinely
part of application behavior.

## Scope boundary

Applik8s owns policy-neutral browser mechanics: durable identity, pooling, leases, authority enforcement,
profile/checkpoint lifecycle, artifacts, operational evidence, recovery, and teardown. It does not own:

- source discovery or research strategy;
- learning private API routes from browser traffic;
- OpenAPI, Overlay, or Arazzo synthesis;
- detector, mutator, connector, or acquisition-template semantics;
- robots, terms, distribution-rights, or public/private knowledge classification;
- consequential-action approval or semantic verification;
- selection or orchestration of Browser Use, Skyvern, Unbrowse, or another agentic browser product; or
- a marketplace, route catalog, browser-agent loop, or domain-specific evidence model.

Those capabilities belong to consuming applications or independently justified packages. Standard
protocol leases are the interoperability seam; Applik8s does not need a first-party integration for every
client that can consume them.

## Why the previous facade is rejected

An earlier draft proposed Applik8s-specific page, locator, interaction, extraction, popup, download, and
artifact methods. That approach is rejected for the initial design because it would duplicate mature
browser-client APIs and types, lag ecosystem support, complicate interoperability, and make Applik8s
responsible for browser semantics indefinitely.

The thinner design deliberately gives up a framework-specific high-level action vocabulary. Applik8s can
record protocol commands, browser epochs, artifacts, causal receipts, and unknown outcomes, but it does not
change standard client return types to insert its own receipt object. Durable browser ownership is novel
framework work. Reimplementing browser automation is not.

## Current baseline and gap

The current v0.9 tree has:

- `application.actor(...)`, durable actor references, commands, messages, connections, broadcasts, alarms,
  authority, state migration, and Celld execution;
- `SourceRetriever`, with deterministic fixtures and bounded HTTP retrieval;
- object storage and artifact references suitable for downloads, screenshots, PDFs, traces, and exports;
- code and research agent compositions with separately declared browser authority;
- browser-driven acceptance testing through development-only journey adapters.

It does not have:

- a `BrowserPool` capability;
- a durable browser session composition;
- capability-scoped WebDriver BiDi, WebDriver Classic, and CDP leases;
- a maintained WebdriverIO adapter;
- JavaScript-rendered source retrieval;
- browser profile checkpoint/recovery semantics;
- a maintained browser engine provider;
- browser-specific authority, unknown-outcome, capacity, and teardown qualification.

## Existing functionality that must not be duplicated

| Capability | Existing boundary to reuse |
| --- | --- |
| Durable identity and serialized turns | `application.actor(...)` and `ActorRuntime` |
| References and browser hydration | Existing actor reference/client machinery |
| Identity and authority | Canonical principal, causal principal, resource authority, and receipts |
| Durable orchestration | `workflow()` when a multi-step business process is required |
| Artifacts | Application object storage and artifact references |
| Events | `application.events`; operational browser frames are not application facts by default |
| Infrastructure | Application graph, TypeKro, Alchemy, Celld operator/fleet, and deployment profiles |
| Research retrieval | Existing `SourceRetriever` normalized output and evidence contract |
| Acceptance | `journey()` plus existing deployed/browser adapters |
| Browser commands | Standard WebDriver BiDi, WebDriver Classic, and CDP clients |
| Optional browser agents and tools | Consumer-selected clients attached through standard-protocol leases |

`browserActor()` adds durable browser ownership and authorized protocol access. It must not invent another
durable runtime, workflow engine, artifact store, event system, authorization layer, browser-command API,
agent loop, or test framework.

## Normative decisions

1. `browserActor()` is a maintained actor-backed composition, not a new foundational runtime alongside
   `actor()`.
2. A browser actor is one logical durable browser session. It owns a profile and zero or more browser
   contexts/pages through the provider.
3. A `BrowserPool` hosts browser-actor instances and manages capacity; it is not the source of truth for
   session identity or application state.
4. Applik8s exposes standard browser protocols rather than a proprietary page or locator facade.
5. WebDriver BiDi is the canonical protocol for maintained TypeScript automation. WebDriver Classic is
   supported where BiDi or client coverage requires it.
6. CDP is a first-class compatibility lease, but not the portable application contract. Its availability
   and supported domains are provider-version capabilities visible in `ApplicationPlan`.
7. The maintained TypeScript adapter returns real WebdriverIO types and behavior. It may configure,
   authorize, instrument, and scope the connection; it must not fork or imitate WebdriverIO's API.
8. Moli is the sole maintained first-party browser engine for the initial preview. The provider boundary
   remains open to future first-party and third-party implementations.
9. The maintained local and distributed paths use the same Moli browser implementation. A stock Moli
   process may be used for feasibility, but it does not qualify the final Celld-native preview.
10. Moli runs only in a dedicated browser cell/worker class. Selecting Celld for an unrelated actor never
   grants browser, network, filesystem, profile, or Secret authority.
11. The browser actor owns process lifecycle. Protocol clients cannot terminate, replace, reconfigure, or
   escape the actor-owned browser through browser-level lifecycle commands.
12. Connection leases are short-lived, audience-bound, revocable, non-exportable by default, and fenced to
   one browser actor epoch. The durable actor reference is serializable; a live WebSocket/client object is
   not.
13. Browser mutations are externally observable effects and cannot be claimed exactly-once. Unknown
    outcomes fail closed and require observation, an application decision, or an explicitly safe retry.
14. Large outputs are artifact references. Screenshots, PDFs, downloads, traces, HAR-like records, and
    oversized DOM snapshots do not travel through actor state or command receipts as raw bytes.
15. Browser profile persistence is explicit. Cookies, local storage, IndexedDB, OPFS, HTTP cache, and
    downloads have separate retention and visibility policies.
16. Arbitrary page JavaScript and unrestricted protocol commands are separately granted capabilities.
    Basic navigation or observation does not imply browser administration or host authority.
17. Every top-level request, redirect, iframe, subresource, WebSocket, worker, service worker, and download
    is subject to the effective network policy.
18. Stateless rendered retrieval does not require an application-visible durable session. A retriever may
    allocate an internal actor with ephemeral retention and release it after committing its result.
19. Research code continues to use `SourceRetriever`; browser rendering is selected by provider/profile
    composition, not by branching on Moli in a research handler.
20. Existing Playwright tests, bounded HTTP retrieval, and a stock-Moli process are useful
    evidence but do not independently satisfy the durable Moli/Celld contract.

## Developer experience

### Declaration

The application declares the durable behavior and injects capacity by capability:

```ts title="src/browser.ts"
const ResearchBrowsers = BrowserPool.named("research");

export const ResearchBrowser = application.include(
  browserActor("research-browser.v1", {
    actor: { key: ResearchSessionId },
    pool: ResearchBrowsers,
    artifacts: ResearchArtifacts,
    authority: {
      origins: ResearchOrigins,
      downloads: "artifacts",
      scripts: "automation",
    },
    session: {
      idleTimeout: "10m",
      maximumAge: "2h",
      retainProfile: "until-run-completes",
    },
  }),
);
```

The selected profile supplies the implementation. Most application authors do not write this wiring:

```ts title="src/providers.ts"
import { MoliBrowserPool } from "@applik8s/browser-moli";

application.provide(
  BrowserPool.named("research"),
  MoliBrowserPool.celld({
    mode: "interactive",
    capacity: {
      minimumWarm: 1,
      maximumSessions: 100,
      maximumSessionsPerWorker: 8,
    },
  }),
);
```

`mode: "interactive"` enables the provider's qualified layout/input surfaces. Exact Moli flags remain
provider internals. Starter defaults may infer bounded capacity. Production profiles must make capacity,
retention, egress, protocol exposure, and artifact costs visible in `ApplicationPlan`.

### Canonical TypeScript automation

The maintained adapter scopes a real WebdriverIO client to an actor-owned lease:

```ts title="src/research/inspect-product.ts"
import { WebdriverIO } from "@applik8s/browser-webdriverio";

export async function inspectProduct(runId: string, url: string) {
  return ResearchBrowser(runId).using(WebdriverIO, async browser => {
    await browser.url(url);

    const search = await browser.$("aria/Search");
    await search.setValue("durable actors");
    await browser.$("aria/Search button").click();

    const heading = await browser.$("aria/Results");
    await heading.waitForDisplayed();

    return {
      url: await browser.getUrl(),
      title: await browser.getTitle(),
      heading: await heading.getText(),
    };
  });
}
```

`using()` is an Applik8s lease boundary, not a browser-command DSL. Its callback receives the upstream
WebdriverIO client type. The adapter selects the qualified BiDi/Classic connection, installs authorization
and tracing, releases the connection deterministically, and preserves cancellation. It does not translate
selectors or return values into Applik8s-specific equivalents.

The durable handle remains callable and serializable:

```ts
const browser = ResearchBrowser(researchRunId);
const sameBrowser = ResearchBrowser.hydrate(browser.reference);
```

Hydration re-establishes an address, not authority. Every `using()` or `connect()` call is admitted against
the current principal, causal chain, actor epoch, and session policy.

### Explicit standard-protocol connection

Integration authors may request a bounded protocol lease directly:

```ts
const lease = await ResearchBrowser(runId).connect({
  protocol: "cdp",
  audience: "account-automation",
  expiresIn: "5m",
});

try {
  await runConsumerSelectedBrowserClient(lease.reference);
} finally {
  await lease.release();
}
```

Ordinary application code should prefer a maintained typed adapter. Direct connections exist for client
interoperability and provider development. Protocol, audience, and requested permissions are validated
against the selected provider's advertised capability set and the caller's authority.

### Consumer-selected clients

An application may connect Browser Use, Skyvern, Playwright, Puppeteer, an MCP server, or another browser
client when the selected provider advertises the required standard or compatibility surface. The consumer
owns that dependency, its agent loop or task semantics, and its qualification for the application's use
case. Applik8s owns only lease admission, connection fencing, bounded operational evidence, and lifecycle
containment.

The v0.9 preview does not ship or qualify first-party Browser Use, Skyvern, Unbrowse, or MCP integrations.
A future focused package requires reusable implementation code, a second concrete consumer, and evidence
that a documented standard-protocol connection is insufficient.

### Workflows and agents

Browser actors are ordinary handles inside managed closures:

```ts
export const InspectAccount = workflow("inspect-account.v1", InspectAccountInput, async input => {
  return AccountBrowser(input.accountId).using(WebdriverIO, async browser => {
    await browser.url(input.url);
    await browser.$("aria/Email").setValue(AccountCredentials.email);
    await browser.$("aria/Password").setValue(AccountCredentials.password);
    await browser.$("aria/Sign in").click();

    return {
      url: await browser.getUrl(),
      title: await browser.getTitle(),
    };
  });
});
```

The workflow owns multi-step business durability. The browser actor owns serialized browser-session state.
The client owns only the current connection. None duplicates the other.

## Public browser surface

The Applik8s surface is intentionally small.

### Session methods

| Method | Meaning |
| --- | --- |
| `Browser(key)` | Hydrate a typed logical session handle without starting capacity |
| `browser.using(adapter, callback)` | Admit a connection, run with a real typed client, and release it |
| `browser.connect(options)` | Issue a short-lived capability-scoped standard-protocol lease |
| `browser.status()` | Observe bounded session, epoch, profile, capacity, and recovery state |
| `browser.checkpoint(options?)` | Commit an authorized profile/session checkpoint |
| `browser.close(options?)` | Quiesce and finalize the logical session |
| `browser.reference` | Serializable actor/session reference |

`browser.close()` closes the logical actor session. Client APIs such as WebdriverIO `deleteSession()` or a
CDP browser-close command only release or are denied at the protocol boundary; they cannot silently destroy
actor-owned durable state.

### Connection lease

The connection lease contains stable lease/session identities, protocol capabilities, actor revision and
browser epoch, audience, admitted permissions, endpoint plus sealed credential materialization, expiry and
revocation state, an evidence cursor, and a redacted serializable reference. Only the admitted client
process may resolve endpoint credentials while the lease is active.

A WebDriver protocol session created through a lease is subordinate and disposable. It is not the durable
logical browser session represented by the actor. Ending a protocol session releases that attachment; only
the browser actor lifecycle may finalize the durable session and its profile.

### Protocol support model

| Surface | Role | Portability promise | Initial maintained client |
| --- | --- | --- | --- |
| WebDriver BiDi | Canonical eventful browser automation | Standards-based subset advertised by provider | WebdriverIO |
| WebDriver Classic | Compatibility and client fallback | W3C command subset advertised by provider | WebdriverIO |
| CDP | Engine-specific compatibility | No cross-provider portability promise | Consumer-selected |

Protocol negotiation fails closed. A provider does not claim `webdriver-bidi` merely because it accepts a
WebSocket, and does not claim complete CDP compatibility merely because it exposes some CDP domains. The
plan records exact protocol versions, supported command families, required layout/resource mode, and known
exclusions. Qualification of a consumer-selected client belongs to that consumer unless Applik8s later
adopts a focused maintained adapter.

### Deliberately absent browser facade

Applik8s does not define its own `Page`, `Locator`, element, selector, click, fill, wait, navigation,
evaluation, popup, frame, or download API. Those belong to the selected standard client. Portable
application libraries stay within WebDriver-standard behavior; client- or engine-specific features are
allowed only when explicitly accepted as such.

## Protocol gateway and evidence

Every connection passes through an actor-owned protocol gateway or equivalent in-cell enforcement boundary.
The gateway authenticates and fences the lease, filters commands by admitted permissions, prevents
browser-process lifecycle escape, enforces connection/mutation policy, propagates cancellation and
deadlines, records bounded evidence, redacts sensitive traffic, and revokes connections during drain,
recovery, expiry, or finalization.

Raw WebDriver/CDP commands do not carry Applik8s idempotency keys and cannot generally be made exactly-once.
The gateway assigns command identities for evidence and recovery accounting, but never retries an ambiguous
mutation solely because the client disconnected.

The durable evidence stream records protocol, method/domain, actor epoch, command sequence, timestamps,
redacted input/output digests, provider error, artifacts, and causal/authorization receipts. Higher-level
clients may add semantic action evidence, but Applik8s does not infer a stable user-level `click` from
arbitrary protocol traffic.

## Actor lowering

`browserActor()` expands into an ordinary actor protocol. The exact generated member names are internal,
but the semantic members include:

- initialize, restore, checkpoint, quiesce, and finalize session;
- issue, renew, revoke, and release connection leases;
- attach/detach protocol clients;
- observe provider/session/page inventory and browser epoch;
- commit artifact/evidence references and classify unknown commands;
- alarm-driven idle and maximum-age expiry.

The compiler generates the durable handle and connection-admission surface. It does not generate a page or
locator facade. Provider authors implement `BrowserPool` and protocol conformance rather than replacing
actor semantics.

## BrowserPool semantics

`BrowserPool` is a qualified provider capability that binds browser actors to physical capacity. It owns:

- worker/cell-class deployment and readiness;
- admission queues and overload behavior;
- minimum warm and maximum active capacity;
- per-worker session density and resource budgets;
- placement, anti-affinity, tenant isolation, and draining;
- browser-engine artifact/version rollout;
- supported protocol/version capability advertisement;
- health, metrics, crash-loop detection, and capacity evidence.

It does not own:

- logical session keys;
- caller authority;
- browser actor state or receipts;
- application events;
- workflow progress;
- profile retention decisions.

Actors are virtual and created lazily. A pool of capacity is not a set of eagerly created browser actors.
One worker may host multiple isolated browser cells when the provider proves isolation and resource bounds.

Admission overload returns an explicit retryable `BROWSER_POOL_CAPACITY_EXHAUSTED` result with a bounded
retry hint. It never silently creates unbounded processes or queues indefinitely.

## Durability and recovery

Browser memory is not ordinary actor state. Raw DOM nodes, JavaScript heap pointers, sockets, pending client
promises, protocol IDs, and provider handles are never serialized into the application actor record.

The durable session record contains:

- actor/session identity and revision;
- engine, adapter, and protocol compatibility versions;
- browser epoch;
- profile checkpoint reference and digest;
- last committed browser-context/page inventory and recovery policies;
- active connection leases and revocation state;
- in-flight protocol-command evidence and unknown outcomes;
- artifact/evidence references;
- retention, expiry, and finalization phase.

The Moli/Celld provider attaches browser profile storage to the durable cell lifecycle. Until a safe
heap/realm snapshot is proven, recovery creates a new browser epoch, restores the profile, and recreates or
reloads only state whose declared recovery policy permits it. Client element handles, target IDs, execution
contexts, and protocol sessions become invalid across epochs. A reload that could repeat an unsafe external
mutation is never automatic.

### Unknown outcomes

Browser commands can trigger payments, form submissions, messages, or other external effects. Actor commit
and website commit cannot generally be atomic. Therefore:

- failure before dispatch is retryable;
- an observed postcondition may produce a committed receipt;
- transport or process loss after dispatch produces `unknown` unless the provider can prove the outcome;
- the framework never retries an unknown mutation merely because an idempotency key exists locally;
- applications may provide a typed observation/confirmation operation or request a human decision;
- navigation and read-only observation may have narrower automatic retry policies than mutations.

## Moli provider architecture

Moli is a standalone Rust browser kernel with JavaScript, DOM, networking, profile-scoped storage,
structure-first extraction, optional on-demand layout/rendering, and CDP/WebDriver/BiDi control surfaces.
Those capabilities make it a strong initial provider, but its engine architecture and release cadence are
not public Applik8s contracts. See the [Moli repository](https://github.com/lexmount/moli).

Moli's default mock geometry is not sufficient evidence for interactive coordinate-based agents. The
maintained interactive pool enables and qualifies on-demand layout. Resource-family loading is explicit and
bounded; it is not enabled globally merely because one client can request a screenshot.

The integration is maintained with explicit provenance:

```text
Moli upstream pinned commit/release
  + small reviewed portability patch series
  + moli-celld adapter and protocol gateway
  + standard-client, browserActor, and selected upstream/WPT differential evidence
  = qualified Applik8s Moli browser provider
```

Generic embeddability seams should be proposed upstream where useful. Celld-specific storage, worker-loader,
and deployment machinery remains downstream. Every downstream patch records purpose, upstream status,
rebase risk, affected crates, compatibility constraints, and conformance evidence.

### Integration phases

1. **Protocol feasibility:** drive a pinned stock Moli process with WebdriverIO over BiDi/Classic and exercise
   the explicitly advertised CDP subset with protocol conformance fixtures. This is spike evidence only.
2. **Authorized gateway:** issue capability-scoped protocol leases, enforce command/lifecycle policy, and
   record evidence without modifying upstream client types.
3. **Embeddable kernel:** expose or consume a bounded in-process browser-kernel lifecycle with injectable
   network, storage, clock, scheduling, randomness, and profile backends.
4. **Celld-native provider:** load the Moli integration in the dedicated browser cell/worker class, attach
   durable profile/checkpoint storage, and remove the separate browser-service hop.
5. **Shared-runtime optimization:** investigate sharing host V8/platform machinery only after correctness,
   isolation, and lifecycle are qualified. Duplicate V8 runtimes are acceptable for feasibility; a shared
   V8 realm is not required to freeze the public API.

Only phase 4 qualifies the maintained preview. Phase 5 is an optimization and must not block correctness.

### Package boundary

- `@applik8s/browser` owns `browserActor()`, `BrowserPool`, durable handles, connection-lease contracts,
  authority, diagnostics, and `/testing`.
- `@applik8s/browser-webdriverio` owns the maintained WebdriverIO adapter, exact supported upstream
  versions, and BiDi/Classic selection.
- `@applik8s/browser-moli` owns Moli provenance, native artifacts, Celld adapter, protocol-gateway provider,
  deployment/profile binding, compatibility matrix, and provider conformance.
- the generic Celld actor runtime and operator remain in their existing packages;
- Agentic Start and applications own configuration, product journeys, and policy choices.

The separate Moli package is justified because it carries a native engine, licensing notices, independent
upgrade cadence, and deployment weight. Consumers that do not need browser automation must not install or
bundle Moli or WebdriverIO. Importing `@applik8s/browser` must not bundle any browser engine or client.

## Rendered SourceRetriever

Browser rendering integrates below the existing research-agent contract:

```ts
application.provide(
  SourceRetriever.named("research"),
  RenderedSourceRetriever.using(BrowserPool.named("research"), {
    session: "ephemeral",
    completion: { selector: "body", settle: "network-quiet", timeout: "15s" },
    output: "markdown",
    maximumBytes: 2_000_000,
  }),
);
```

The normal research declaration remains unchanged:

```ts
export const Researcher = application.include(
  researchAgent("research.v1", {
    search: WebSearch.named("research"),
    retrieve: SourceRetriever.named("research"),
    // ...
  }),
);
```

The rendered retriever:

- allocates an internal browser actor with ephemeral retention using the stable retrieval identity;
- attaches through the maintained internal standard-client adapter;
- navigates under retrieval-specific egress and resource policy;
- waits under a bounded completion strategy;
- extracts normalized text/title/canonical URL;
- records browser epoch, final URL, content generation/digest, engine evidence, and connection evidence;
- optionally stores a DOM/semantic/screenshot artifact according to evidence policy;
- returns `ApplicationRetrievedSource` without leaking a browser handle or Moli payload.

An authenticated or continuity-sensitive retriever may instead be composed with an explicitly declared
browser actor and application-owned profile policy. Stateless source retrieval does not create that public
authoring obligation.

Profiles may compose bounded HTTP and rendered retrieval adaptively, but escalation to a browser must be
declared in the plan with capacity, egress, cost, and evidence implications. The adaptive provider may
render when deterministic shell detection indicates that server HTML is incomplete; it may not silently
render every page or infer that a login/challenge page is useful content.

## Authority and security

The browser plan separately declares:

- allowed top-level origins and allowed subresource origin policy;
- DNS/address, port, redirect, proxy, and private-network policy;
- permitted standard protocols, audiences, and protocol-command classes;
- script extraction, automation, and unrestricted evaluation authority;
- form, upload, download, clipboard, notification, popup, and credential authority;
- profile/storage visibility and retention;
- Secret references and permitted injection destinations;
- artifact stores and visibility;
- per-session CPU, memory, network, byte, page/context, connection, and time budgets;
- tenant isolation, pool placement, and administrative access.

Security requirements include:

- DNS resolution is pinned or revalidated; private, loopback, link-local, metadata, and disallowed addresses
  fail closed on every navigation and subrequest unless explicitly authorized;
- redirects, iframes, workers, service workers, WebSockets, Fetch/XHR, fonts, images, media, and downloads
  cannot escape the effective egress policy;
- browser content remains untrusted data and cannot become instructions or capability grants;
- page JavaScript cannot access host filesystem, environment, Celld control APIs, provider credentials, or
  unrelated actor state;
- Secret-backed inputs are resolved only inside the admitted browser/client cell and are redacted from
  traces, screenshots where policy requires, logs, receipts, protocol evidence, and model context;
- downloads are bounded, content-typed, optionally scanned, and committed to object storage before use;
- cross-tenant profiles, caches, cookies, storage, pages, downloads, and traces cannot collide;
- raw provider endpoints are never exposed directly; all connections are actor-issued and revocable;
- browser/process close, target administration, unrestricted CDP domains, and provider admin operations are
  denied or separately authorized;
- provider admin operations use separate audited authority.

Consumer-selected browser agents, MCP servers, and automation workers are untrusted client processes.
Their filesystem, environment, model, network, and Secret authority is declared independently from
browser-session authority.

## Events, streaming, and UI

Browser connection state, navigation progress, console messages, network activity, document generations,
screenshots, and heartbeats are operational streams. They may be observed through authorized actor
connections and the operations UI, but they do not become application events automatically.

Applications may explicitly promote stable facts such as `ResearchSourceRendered`, `DocumentDownloaded`,
or `ReviewEvidenceCaptured` through ordinary application events after validating the relevant receipt.

Agentic Start may expose:

- active browser sessions, clients, protocols, and capacity;
- current page URL/title and bounded semantic observation;
- protocol/agent action timeline and unknown outcomes;
- screenshots/artifacts when authorized;
- egress, protocol, script, and Secret grants plus denial explanations;
- recovery epoch, profile retention, and cleanup state.

It must not expose raw provider endpoints, lease credentials, unrestricted protocol consoles, or Secrets.

## ApplicationPlan and explainability

`applik8s explain` shows:

- each browser actor and its key/retention policy;
- selected `BrowserPool`, Moli version/artifact, and dedicated Celld worker class;
- supported/exposed protocols, client adapters, versions, and capability limitations;
- capacity bounds and overload policy;
- network, protocol-command, script, Secret, artifact, and profile authority;
- research retrievers that may escalate from HTTP to rendering;
- storage/checkpoint ownership;
- readiness, upgrade, drain, and teardown order;
- estimated warm/maximum capacity and cost inputs.

No opaque `browser platform` node may hide these dependencies. CDP availability is never inferred merely
from selecting Moli; it appears as an explicit provider capability and admitted-client requirement.

## Lifecycle and upgrades

Creation order is infrastructure dependencies, Celld browser worker class, pool readiness, actor admission,
then connection issuance. Deletion order is connection revocation, admission quiescence, active-command
settlement or explicit unknown outcome, checkpoint/retain decision, logical session close, actor
finalization, pool drain, and infrastructure cleanup.

Pool deletion must not remove shared capacity while foreign application sessions remain. Application
deletion honors explicit retained-profile policy and never claims retained browser memory. Forced orphan or
destructive cleanup requires explicit authority and produces an audit receipt.

Upgrades declare compatibility across:

- browser actor protocol/schema version;
- connection-lease format and gateway version;
- WebDriver BiDi/Classic/CDP versions and supported commands/domains;
- maintained WebdriverIO adapter version;
- Moli engine and patch generation;
- Celld/workerd/V8 compatibility;
- profile/checkpoint schema;
- provider artifact digest;
- page recovery policy.

Rolling upgrade drains connections and cells or migrates them through a proven checkpoint path. Readiness
uses observed engine, worker, gateway, and protocol versions, never desired values copied into status.
Incompatible profiles fail closed with a recoverable/exportable state when possible.

## Diagnostics

- `BROWSER_POOL_CAPACITY_EXHAUSTED`
- `BROWSER_SESSION_NOT_AUTHORIZED`
- `BROWSER_SESSION_EXPIRED`
- `BROWSER_SESSION_RECOVERY_BLOCKED`
- `BROWSER_PROFILE_INCOMPATIBLE`
- `BROWSER_CONNECTION_NOT_AUTHORIZED`
- `BROWSER_CONNECTION_EXPIRED`
- `BROWSER_CONNECTION_STALE_EPOCH`
- `BROWSER_CONNECTION_AUDIENCE_MISMATCH`
- `BROWSER_PROTOCOL_UNSUPPORTED`
- `BROWSER_PROTOCOL_COMMAND_NOT_AUTHORIZED`
- `BROWSER_PROTOCOL_LIFECYCLE_DENIED`
- `BROWSER_NAVIGATION_REJECTED`
- `BROWSER_NETWORK_NOT_AUTHORIZED`
- `BROWSER_PAGE_SCRIPT_NOT_AUTHORIZED`
- `BROWSER_COMMAND_OUTCOME_UNKNOWN`
- `BROWSER_DOWNLOAD_REJECTED`
- `BROWSER_ARTIFACT_COMMIT_UNKNOWN`
- `BROWSER_CLIENT_INCOMPATIBLE`
- `BROWSER_PROVIDER_INCOMPATIBLE`
- `BROWSER_PROVIDER_VERSION_SKEW`
- `BROWSER_TEARDOWN_BLOCKED`

Diagnostics name the session, lease, epoch, protocol, and bounded remediation without exposing content,
connection credentials, or Secrets.

## Implementation increments

1. Freeze browser actor, pool, lease, protocol capability, profile/checkpoint, evidence, authority, and
   diagnostic contracts. Explicitly delete the proprietary page/locator API from the accepted design.
2. Implement deterministic actor/pool/lease testing fixtures and protocol-gateway state-machine tests.
3. Build `@applik8s/browser-webdriverio` against exact upstream versions and prove callbacks receive
   unmodified WebdriverIO public types.
4. Run a pinned stock-Moli feasibility matrix: WebdriverIO over BiDi/Classic plus conformance fixtures for
   the explicitly advertised CDP subset, including authenticated connection and
   disconnect-without-process-destruction.
5. Implement the authorized protocol gateway, command filtering, redaction, evidence, cancellation,
   lifecycle interception, and stale-epoch behavior.
6. Add `@applik8s/browser-moli`, provenance/patch ledger, interactive layout profile, and selected Moli,
   WebDriver, CDP, and WPT differential evidence.
7. Implement the dedicated Celld browser worker class and durable profile/checkpoint integration.
8. Implement real local and distributed `BrowserPool` lifecycle, capacity, drain, upgrade, and cleanup.
9. Implement `RenderedSourceRetriever` and optional bounded HTTP-to-rendered composition.
10. Complete adversarial security, unknown-outcome, recovery, compatibility, load, and lifecycle
    qualification.

## Acceptance

### Public developer experience

- Browser declaration, handle hydration, WebdriverIO `using()`, direct connection, checkpoint, status, and
  finalization typecheck as documented.
- The `using(WebdriverIO, ...)` callback receives the real maintained WebdriverIO client types; ordinary
  browser code follows upstream documentation.
- Applik8s exports no competing page, locator, element, click, fill, wait, or navigation abstraction.
- Ordinary application source does not name Moli, Celld routes, provider endpoints, or connection secrets.
- A serialized browser reference can be hydrated elsewhere, but every connection still requires current
  authority. A live client or endpoint credential cannot be serialized as durable state.
- Consumers importing only `@applik8s/browser` do not install or bundle Moli, WebdriverIO, or any
  consumer-selected browser-agent or MCP runtime dependencies.

### Protocol and client interoperability

- The same real Moli-backed actor is driven successfully by WebdriverIO over the maintained WebDriver
  BiDi/Classic path and by generic conformance clients over every advertised CDP command family.
- A consumer-selected client can attach using a sealed connection reference, disconnect, and leave the
  actor-owned browser/session alive until Applik8s finalization.
- Client or protocol incompatibility fails at plan/admission with exact supported versions/capabilities.

### Real browser behavior

- A real Moli-backed actor renders a JavaScript-only application and extracts meaningful post-JavaScript
  content.
- Standard-client navigation, accessibility/CSS location, form interaction, tabs/popups, frames,
  download/upload, script execution, screenshot, PDF, cookies/storage, and semantic observation work to the
  extent advertised by the provider.
- Interactive tests use qualified on-demand layout and prove coordinate/hit-testing behavior separately
  from structure-only operation.
- Unsupported engine or protocol behavior fails explicitly rather than fabricating success.
- Outputs and artifacts preserve canonical URL, document generation, content digest, engine evidence, and
  causal receipts.

### Durability and lifecycle

- The same provider implementation passes local Celld and distributed Celld qualification.
- Session/profile identity survives cell suspension, restoration, worker crash/replacement, and allowed
  relocation without silently repeating unsafe mutations.
- Browser epoch changes invalidate old connections, element handles, target IDs, and protocol sessions.
- Lost responses before dispatch, after dispatch, after observed mutation, and after receipt commit produce
  the specified retry/unknown/replay behavior.
- WebdriverIO and generic conformance clients reconnect through a fresh lease after allowed actor recovery;
  they never reuse stale endpoint authority.
- Pool scaling, saturation, queuing, drain, engine/client upgrade, incompatible-profile failure, retained-profile
  deletion, and ordered teardown are exercised end to end.
- Cleanup proves absence of owned sessions, connections, cells, processes, volumes/checkpoints, network
  grants, Secrets, and temporary artifacts while preserving explicitly retained data.

### Security

- SSRF and egress tests cover redirects, alternate DNS answers, IPv4/IPv6, subresources, iframes,
  WebSockets, workers/service workers, downloads, and proxy paths.
- Tenant isolation covers profiles, storage, caches, contexts/pages, leases, artifacts, capacity accounting, and debug
  surfaces.
- Protocol clients cannot terminate/reconfigure the actor-owned browser, attach to another actor, reuse a
  stale lease, or escalate from observation to evaluation/admin commands.
- Page code cannot reach host or provider authority; extraction/evaluate permissions fail closed.
- Secret injection is reference-based, destination-scoped, redacted, revocable, and absent from evidence
  artifacts unless explicitly authorized.
- Consumer-selected automation processes receive only declared filesystem, model, network, environment,
  and Secret capabilities.
- CPU, memory, contexts/pages, connections, network bytes, artifact bytes, and deadlines are bounded under
  adversarial content.

### Research integration

- The unchanged provider-neutral research-agent source retrieves and cites a JavaScript-rendered source.
- HTTP and rendered retrievers produce the same normalized source/evidence shape.
- Adaptive escalation is deterministic, plan-visible, bounded, and evidenced; it does not mistake empty
  shells, login walls, or challenges for completed retrieval.
- Research cancellation and retry do not leak browser sessions or duplicate committed evidence.
- Deterministic rendered retrieval does not require an agentic browser product or a second agent loop.

### Provider discipline

- Exact Moli and WebdriverIO adapter versions are recorded with supported protocol capabilities and known
  limitations.
- Moli source/version, downstream patches, license notices, Celld/V8 compatibility, and build artifact
  digest are reproducible.
- Every patch passes selected upstream tests plus browserActor conformance; upgrades include differential
  compatibility and performance evidence.
- A stock-Moli process, Chromium fallback, consumer browser-agent run, or mocked protocol server cannot be
  cited as Celld-native Moli qualification.

## Non-goals

- defining an Applik8s page, locator, element, selector, or browser-action DSL;
- treating CDP as a portable standard or promising every Chrome-specific domain on every provider;
- making WebdriverIO, Browser Use, Skyvern, Unbrowse, Playwright, Puppeteer, or an MCP server the durable
  session owner;
- shipping or qualifying an agentic browser product merely because it can consume a standard-protocol
  lease;
- learning, ranking, publishing, or replaying private API routes;
- compiling OpenAPI, Overlay, or Arazzo procedures;
- general desktop/GUI automation;
- pixel-perfect Chrome compatibility, GPU rendering, media playback, or anti-bot evasion guarantees;
- pretending website mutations are transactionally exactly-once;
- granting unrestricted protocol commands, page evaluation, network, downloads, filesystem, or credentials
  by default;
- making every `SourceRetriever` use a browser;
- building a second workflow/runtime, browser control plane, agent loop, or proprietary browser engine;
- permanently forking Moli or browser-client integrations without provenance and an upstreaming strategy.

## Definition of done

The preview is complete when an application can declare a browser actor in a few lines, profiles can supply
bounded Moli/Celld capacity without leaking infrastructure into domain code, TypeScript authors can use a
real WebdriverIO client over an actor-authorized standard connection, consumer-selected clients have a
documented capability-scoped protocol seam, and the research agent can faithfully retrieve a
JavaScript-rendered source through the unchanged `SourceRetriever` contract.

It must survive real interruption and upgrade, fail honestly around externally visible browser mutations,
enforce egress/Secret/tenant/resource boundaries, expose complete plan and operational evidence, and clean
up in dependency order. Until those conditions pass with the real Moli/Celld provider and pinned standard
clients, v0.9 must not claim durable browser actors or rendered-web research support.

## References

- [W3C WebDriver BiDi](https://www.w3.org/TR/webdriver-bidi/)
- [W3C WebDriver](https://www.w3.org/TR/webdriver2/)
- [WebdriverIO API](https://webdriver.io/docs/api/)
- [Moli](https://github.com/lexmount/moli)
