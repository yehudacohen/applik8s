# RFP: Source-Owned Development Journeys

**Status:** Accepted for implementation; architecture frozen on 2026-08-30

**Audience:** Applik8s maintainers, application authors, Builder implementers, and testing-tool authors

**Requested by:** The v0.9 semantic-completion and 1.0-readiness program

**Revised:** 2026-08-30

**Target:** Applik8s v0.9 development/testing surface; may stabilize independently

## Executive summary

Applik8s applications span browser actions, operations, models, events, jobs, workflows, providers, and
infrastructure. Unit tests and deployment health checks do not express the user journeys that should remain
true as the graph changes. External scripts can test them, but then Builder cannot discover affected
journeys, the compiler cannot infer dependencies, and evidence cannot use the same typed application
handles.

This RFP introduces `journey()`: a source-owned, development/testing-only acceptance artifact. A journey
uses typed identity fixtures, calls the same public application handles as real users, and asserts results,
state, events, authority, plan, or UI behavior. It can run locally, against a deployed application, or
through a browser driver depending on declared requirements.

Journeys never ship as production orchestration and never bypass normal authority. They are isolated,
explicitly cleaned up, graph-discoverable, and suitable for Builder's impacted-test selection.

## Existing functionality that must not be duplicated

| Capability | Existing boundary to reuse |
| --- | --- |
| Test runner | Existing unit/integration/E2E runner integrations |
| Application invocation | Callable models, operations, jobs, workflows, queries, and clients |
| Identity/authority | Existing identity fixtures, trusted admission, roles/grants, resource checks |
| Deployment | Local and deployed profiles/provider bindings, plan/apply, physical resources, test namespaces |
| Browser execution | Existing application E2E/browser test adapters |
| Evidence | Application events, graph, plan, OTel, and runtime evidence stores |

Journey adds discovery, fixtures, dependency attribution, isolation, and a common assertion experience. It
must not become another workflow runtime or proprietary test framework.

## At a glance

```ts title="src/journeys/publish-post.journey.ts"
export const PublishPostJourney = journey(
  "post.publish.v1",
  async context => {
    const author = await context.identity({ roles: [Author] });
    const reviewer = await context.identity({ roles: [Reviewer] });

    const post = await context.as(author, () =>
      Post.create({ title: "Hello", body: "World" }),
    );

    await context.as(reviewer, () => post.approve());

    await context.expect(Post.get(post.id)).toMatch({ status: "published" });
    await context.expectEvent(
      application.events.of(Post.events.updated),
      event =>
        event.subject.id === post.id && event.detail.current.status === "published",
    );
  },
);
```

## Problem statement

The most important product behavior often crosses every architectural layer. Handwritten E2E tests know
URLs, pods, tables, brokers, and provider details rather than application semantics. They are hard to
select incrementally, difficult to run locally, and poor documentation of the intended programming model.

The framework needs a lightweight acceptance artifact that remains application-native without hiding the
real system under test.

## Normative decisions

1. `journey()` is development/testing only and is excluded from production runtime bundles.
2. Journeys invoke public typed application handles; they do not receive private provider clients by
   default.
3. Identities are explicit fixtures established by the framework, not roles passed directly as trusted
   principals.
4. `context.as(identity, closure)` uses normal admission and authorization.
5. Every run has an isolated scope, stable run ID, deterministic fixture seed, cleanup lease, and evidence
   bundle.
6. Cleanup is ownership-aware and fails visibly; it never deletes resources outside the run lease.
7. Local/deployed/browser modes share one journey declaration where their required semantics match.
8. The compiler discovers handle dependencies through the closure graph.
9. Builder may select impacted journeys from graph changes, but an explicit full suite remains available.
10. A journey is not a durable workflow and cannot become production state.

## Architectural boundary

Applik8s owns journey discovery, typed fixtures, isolation leases, semantic assertions, dependency
attribution, deployment adapters, and evidence bundles. Existing test/browser runners own execution
mechanics. Applications own product journeys and fixture intent; providers own deployment-specific setup
only behind the shared contract.

## Execution modes

### Local

Runs against local providers and generated gateways. Used for fast feedback and semantic conformance.

### Deployed

Runs through the real published application boundary against a concrete deployment/profile. It cannot
import server implementations directly.

### Browser

Adds browser interaction and visual/accessibility assertions while retaining the same fixture and evidence
identity. Browser steps are explicit so headless UI machinery does not enter non-UI journeys.

## Isolation and cleanup

A journey run receives a unique isolation contract:

- application environment/run scope;
- identity and resource fixture namespace;
- scoped idempotency keys and event cursors;
- owned resource labels/annotations or database scope;
- cleanup deadline and orphan policy.

Cleanup executes in reverse owned-dependency order and verifies absence. A failed cleanup retains evidence
and prints a bounded remediation command; it is not swallowed as test noise.

Framework-created fixtures register ownership automatically. Application or external effects register an
explicit cleanup receipt:

```ts
const customer = await Billing.createTestCustomer(...);
context.owns(customer, {
  cleanup: () => Billing.deleteTestCustomer(customer.id),
  verifyAbsent: () => Billing.customerExists(customer.id).then(Boolean).then(exists => !exists),
});
```

`context.owns(...)` records authority, identity, dependencies, timeout, retry, and orphan policy before the
effect is considered a usable fixture. An unregistered external effect is visible as unowned evidence and
cannot be claimed as automatically cleaned.

Parallel runs may not share mutable fixtures unless the journey explicitly declares a read-only fixture.

## Assertions

The initial surface supports:

- typed result/error matching;
- authoritative model/query state;
- application event occurrence or absence;
- job/workflow/Saga terminal evidence;
- authority allow/deny and redacted explanation;
- graph and plan assertions;
- browser DOM/accessibility behavior;
- bounded eventual assertions with source-attributed timeouts.

Assertions operate on semantic handles. Physical provider assertions require an explicit advanced adapter
and do not appear in ordinary product journeys.

## Identity fixtures

`context.identity(...)` asks the application's configured identity test capability to create a real fixture
principal with requested application traits. Roles or memberships are fixture inputs, not proof of
authority. The resulting identity enters through the same admission adapter as production requests.

Secrets and credentials are scoped to the run and redacted from evidence.

## Dependency discovery and Builder

The compiler records models, operations, event handles, jobs, workflows, providers, pages, and assertions
used by each journey. Builder can then explain:

```text
Changed: Post.events.updated
Impacted journeys:
  post.publish.v1
  moderation.reject.v1
Reason: direct event assertion
```

Dynamic dependencies that cannot be proven statically require an explicit broad declaration; they never
silently disappear from impact analysis.

## Graph and evidence

Journey declarations appear in a development graph separate from production deployment state. A run
produces a portable evidence bundle containing contract/version, source revision, deployment/profile,
provider and physical-resource receipts, fixture identities, steps, assertions, application events, traces, plan
digest, cleanup outcome, and redacted
diagnostics.

Every run returns a versioned `JourneyResult` with journey/run/source/deployment identities and provider/
physical-resource receipts, deterministic fixture seed, step and assertion outcomes, selected dependencies,
evidence references, cleanup disposition, and terminal status
`passed | failed | blocked | cleanupFailed`. Provider-native logs remain linked evidence rather than being
copied into this stable schema.

## Deployment and provider adapters

Local mode may call generated in-process clients only when those clients traverse the same admission and
authority boundary as production. Deployed mode uses the published HTTP/event/application protocols and
cannot import server implementations. Browser mode is a deployed/local application client plus an
explicit browser-driver capability; DOM selectors and screenshots do not become semantic application
handles.

An assertion unsupported by the selected profile/provider combination is `blocked` with
`JOURNEY_PROVIDER_INCOMPATIBLE`; it is never skipped as passing. One journey may declare mode-specific
presentation steps around a shared semantic core, but provider choreography cannot leak into the normal
journey declaration.

## Diagnostics

- `JOURNEY_FIXTURE_UNAVAILABLE`
- `JOURNEY_AUTHORITY_SETUP_FAILED`
- `JOURNEY_DEPENDENCY_UNRESOLVED`
- `JOURNEY_ASSERTION_TIMEOUT`
- `JOURNEY_CLEANUP_INCOMPLETE`
- `JOURNEY_PROVIDER_INCOMPATIBLE`

## Implementation increments

1. Freeze declaration, identity fixture, isolation, and assertion contracts.
2. Implement local mode over existing application clients.
3. Add compiler dependency discovery and Builder impact selection.
4. Add deployed mode and portable evidence bundles.
5. Add optional browser adapter and accessibility/visual assertions.
6. Qualify cleanup, parallel isolation, and failure recovery.

## Acceptance

- GuestBook, Chirp, and Agentic Start each own meaningful journeys in source.
- The same semantic journey runs locally and against one maintained profile/provider deployment where
  applicable.
- Identity fixtures pass through real admission and authority.
- Parallel runs cannot see or delete each other's state.
- External fixtures are explicitly registered with cleanup and absence verification before use.
- Builder correctly selects and explains impacted journeys.
- Failed cleanup is actionable and never hidden.
- Local, deployed, and browser adapters return one versioned result/evidence contract and never mark an
  unsupported assertion as passing.
- Journey code reads as product behavior rather than infrastructure choreography.

## Non-goals

- production workflow/orchestration;
- replacing the underlying test runner;
- automatically generating every test;
- hiding provider-specific qualification suites;
- granting test identities production authority.

## Definition of done

`journey()` is ready when it expresses source-owned product behavior succinctly, runs through real public
boundaries, preserves normal authority, isolates and cleans up reliably, and gives Builder trustworthy
dependency and evidence data.
