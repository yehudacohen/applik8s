# RFP: Public Contract and Compatibility Freeze

**Status:** Accepted; architecture frozen; release-blocking

**Audience:** Applik8s maintainers, package owners, provider authors, release engineers, and documentation authors

**Requested by:** The v0.9 semantic-completion and 1.0-readiness program

**Revised:** 2026-08-30

**Target:** Applik8s v0.9 contract freeze and `1.0.0-rc.1` admission

**Depends on:** The exact released v0.8 evidence baseline, ApplicationPlan and Deployment-State Migration,
and every stable v0.9 semantic/provider contract

## Executive summary

Applik8s now spans public TypeScript APIs, package exports, compiler artifacts, runtime protocols, generated
clients, graph and plan schemas, CLI behavior, provider contracts, diagnostics, examples, and deployment
lifecycles. A source-level API review alone cannot make that system ready for 1.0.

This RFP defines one machine-readable public-contract inventory and a deliberate freeze process. Every
surface is assigned an owner, canonical name, maturity, compatibility class, replacement/deprecation
policy, documentation, and evidence. The release gates test authoring, artifact, runtime, generated-source,
provider, and lifecycle compatibility independently.

v0.9 remains the final cheap opportunity to simplify names, remove stale aliases, consolidate packages, and
reject ambiguous concepts. `1.0.0-rc.1` freezes the candidate model; it does not redefine scope to pass a
failing gate.

## Existing functionality that must not be duplicated

| Capability | Existing boundary to reuse |
| --- | --- |
| Package truth | Workspace package manifests and export maps |
| API truth | TypeScript declarations, public entrypoints, generated client contracts |
| Semantic truth | Application graph and `ApplicationPlan` schemas |
| Runtime truth | Versioned protocols, codecs, manifests, WASM/host contracts |
| Provider truth | Capability declarations, maturity, compatibility, and conformance evidence |
| Release truth | Changesets/changelog, npm, OCI images, Git tags/releases, CI gates |
| Documentation | Versioned website, migration guides, diagnostics, package catalog |

The inventory indexes these authorities. It must not become a hand-maintained duplicate of them.

## At a glance

```json title="docs/public-contract.json"
{
  "symbol": "Application.job",
  "kind": "typescript-instance-method",
  "package": "@applik8s/applik8s",
  "entrypoint": ".",
  "maturity": "stable-1.0-candidate",
  "since": "0.9.0",
  "owner": "finite-execution",
  "compatibility": "authoring",
  "stability": "stable",
  "docs": "/distributed-behavior/jobs",
  "evidence": ["job-provider-conformance"]
}
```

## Problem statement

Pre-1.0 projects can change quickly, but implicit change creates accidental consumers, dead exports,
duplicated vocabulary, and artifacts that cannot survive runtime upgrades. Package version equality does
not prove that a generated operator, stored workflow run, KRO resource, event cursor, or browser client can
still be interpreted.

The framework needs to know exactly what it promises before declaring 1.0 compatibility.

## Normative decisions

1. Every public contract has one canonical owner and machine-readable inventory entry.
2. Maturity is one of stable-1.0-candidate, beta, preview, experimental, deprecated, or internal.
3. Stable package versions move as one coordinated release train where their protocols require it.
4. Authoring, artifact, runtime, generated-source, provider, and lifecycle compatibility are tested
   independently.
5. A stable alias requires a migration purpose and removal policy; synonyms are not kept for comfort.
6. Internal symbols cannot be reachable through supported export maps.
7. Provider maturity is evidence-derived and can be lower than the semantic interface.
8. Stable diagnostic envelopes and explicitly classified plan/graph fields are public machine contracts;
   incidental serialized fields are not promoted merely by appearing in JSON.
9. Public generated source has explicit compatibility ownership.
10. `1.0.0-rc.1` freezes the candidate contract; changes afterward require an explicit RC reset.
11. Provider implementations separate semantic/runtime behavior from an optional deployment contributor;
    external bindings are first-class and do not imply infrastructure ownership.
12. Semantic graph requirements and physical deployment nodes have separate stability ownership.
13. Provider replacement is a migration unless a compatibility receipt proves it implementation-only.
14. Public runtime imports do not eagerly load compiler, Kubernetes, TypeKro, Alchemy, cloud SDK, Helm, or
    unrelated provider dependencies.
15. Every deployment contributor exposes its actual implementation identity and physical resources.
    Compiler validation enforces TypeKro for Kubernetes API resources, native/focused Alchemy for
    non-Kubernetes infrastructure, and no contributor for external implementations without a duplicate
    public classification enum.
16. Profiles are the sole optional user-facing assembly-policy selector. Provider implementations accept
    concrete typed configuration directly and produce actual runtime/physical plan nodes. Target,
    placement, substrate, and application-authored installation are not independent public selectors.
17. Higher-level provider implementations declare typed recursive implementation dependencies. The
    catalog preserves dependency identity, visibility, guarantees, provider-internal authority, lifecycle,
    readiness, migration, and every consumer edge; nested dependencies do not grant callback authority.
18. Active v0.8 deployment state migrates only through the versioned ApplicationPlan and deployment-state
    migration protocol. A read-only legacy decoder is not adoption evidence.
19. Effect guarantee classifications, identities, receipts, fencing tokens, and unknown-outcome envelopes
    are versioned public runtime contracts wherever a stable execution surface exposes them. A provider
    may strengthen a guarantee only through recorded evidence and may never silently weaken it.

## Architectural boundary

The contract program owns inventory, classification, compatibility policy, release gates, and cross-source
consistency. Package, compiler, runtime, provider, documentation, example, and release owners retain the
authoritative implementation data from which the inventory is derived. The catalog reports those
contracts; it cannot manufacture compatibility or maturity.

## Inventory scope

The inventory includes:

- npm packages and supported entrypoints;
- TypeScript values, types, interfaces, namespaces, and augmentation points;
- CLI commands, options, exit codes, and machine output;
- configuration files and environment variables;
- graph, plan, manifest, artifact, envelope, cursor, and receipt schemas;
- deployment-state migration proposals, checkpoints, authority-transfer receipts, and terminal records;
- effect guarantee, fencing, cancellation, retry, and unknown-outcome envelopes;
- browser/server gateway protocols;
- generated source and public filenames;
- runtime/host/WASM/provider protocols;
- diagnostics and troubleshooting URLs;
- provider interfaces, implementations, maturity, and prerequisites;
- deployment-contributor identity, actual physical resources, and lifecycle owner;
- application CRDs and upgrade/deletion contracts;
- official examples, starters, and templates.

Schema entries are path/subtree-specific. Listing `ApplicationPlan` or the application graph does not make
every current property a stable contract.

Test-only helpers, internal compiler IR, implementation filenames, and unexported provider machinery remain
internal unless explicitly promoted.

## Canonical vocabulary review

Every concept answers:

- Is this a distinct semantic boundary?
- Is this the final noun and spelling?
- Is its package/namespace where autocomplete should find it?
- Does an overlapping alias remain?
- Does ordinary application code avoid provider and compiler vocabulary?
- Can a new user choose it from one sentence and one example?
- Does generated source teach the same convention?

Focused v0.9 decisions include:

- application-scoped `application.job()` (and a local bound `job` alias) versus low-level
  `application.workload.job()`;
- `application.events` versus explicit `stream(...)`;
- `Model.events.updated` versus callable model mutations;
- `Query.onBatch()` versus `Stream.onBatch()`;
- `workflow()` versus `application.transaction.saga()`;
- `AI.model()` versus `ML.model()`;
- `agent()` versus `actor()` and specialized compositions;
- **Builder** as the independent repository-development daemon/portal, distinct from product-owned agent
  administration such as **Agent Studio** or **Configure** inside a generated application;
- profile, concrete provider configuration, physical-resource, execution-host, provider, and
  implementation vocabulary; target/placement/substrate are not independent selectors.

The inventory also classifies every authoring value as one of:

- an `application.*` registrar that immediately owns a graph/assembly declaration;
- a context-free contract, token, or module factory that requires an explicit `provide`, `include`, use,
  or development-discovery edge;
- an ordinary TypeScript value with no framework registration semantics.

No semantic noun may expose both an ambient global registrar and an application registrar. Local aliases
such as `const workflow = application.workflow` are ordinary lexical bindings, not public synonyms.

## Compatibility dimensions

### Authoring compatibility

Can existing supported source compile and preserve its documented meaning? The gate uses clean package
consumers and representative applications, not workspace hoisting.

### Artifact compatibility

Can a new runtime interpret previously generated application graphs, plans, manifests, closure bundles,
WASM components, cursor/envelope data, and stored provider state?

### Runtime compatibility

Can supported compiler/runtime/host versions communicate? Every protocol has an explicit version handshake
and fails closed with remediation when incompatible.

### Generated-source compatibility

Are generated filenames, imports, route trees, clients, operation handles, and extension seams stable or
regenerated deterministically? Checked-in generated source must remain clean after the canonical command.

### Provider compatibility

Does a semantic contract retain meaning while providers evolve? Provider upgrades document capability,
prerequisite, schema, data, and lifecycle changes separately from application API changes.

### Lifecycle compatibility

Can existing installations upgrade, roll back where promised, and delete completely without orphaning
state or violating retention? Live gates begin from the previous released artifacts.

## Machine-schema stability classes

Every documented graph, plan, diagnostic, envelope, receipt, and artifact field or subtree is classified:

| Class | Compatibility promise |
| --- | --- |
| `stable` | Name, shape, and documented meaning follow normal semantic-versioning rules. |
| `additive` | Existing meaning is stable; new optional members may appear and consumers must ignore unknown members. |
| `informational` | Intended for human display and troubleshooting, not automation; shape may evolve within a compatible release train. |
| `experimental` | No compatibility promise until separately promoted. |
| `opaque` | Consumers may retain, compare, or round-trip the value only as documented; internal structure is not public. |

Semantic node identities, documented discriminants, stable diagnostic codes, protocol versions, references,
and fields used by supported automation are classified individually. Debug snapshots, provider-native
payloads, explanatory prose fragments, and compiler-internal topology can remain informational or opaque.

Builder and CI consume stable/additive machine views. They must not parse informational text or undocumented
JSON. Promoting a field requires owner, docs, evidence, and a compatibility review; merely serializing it
does not promote it.

## Package boundary review

The package audit classifies each workspace package as:

- independently useful public package;
- optional public integration/provider package;
- implementation package required only by another public package;
- internal package that should not be published;
- candidate for consolidation.

Many packages are acceptable when they provide real pruning and ownership value. Package count alone is
not a defect. A boundary is rejected when it has no independent consumer, stable contract, or dependency
benefit and merely moves files.

Umbrella packages must not eagerly pull compiler/provider/tooling dependencies into runtime consumers.
Every public package passes a clean-install, declared-dependency, import-zone, bundle, and security audit.

Runtime, authoring, provider-runtime, and deployment-contributor subpaths are independently importable.
Selecting an external PostgreSQL or ClickHouse binding must not load TypeKro/Alchemy. Declaring one
Kubernetes cluster capability must not pull Kubernetes clients into unrelated callbacks. Package tests
inspect transitive module graphs and generated bundles, not only package manifests.

## Provider implementation and external-binding contract

Every provider implementation inventories these separable parts:

```text
semantic implementation
typed implementation dependencies
runtime adapter
optional deployment contributor
readiness observer
lifecycle classification
migration reader/writer
provider-internal authority requirements
```

A managed implementation contributes actual TypeKro compositions for Kubernetes API resources or actual
native/focused Alchemy resources for non-Kubernetes managed infrastructure. An external implementation
supplies validated connection/Secret bindings and readiness but contributes no owned infrastructure. Both
satisfy the same semantic provider token and generated client contract.

External bindings are machine-visible as `external`, with deletion `none`, explicit Secret/config source,
readiness behavior, migration ownership, and runtime access. They are not smuggled in as arbitrary provider
configuration or treated as adopted resources.

The contract catalog inspects actual contributor/resource identity and rejects direct Alchemy Kubernetes
objects, TypeKro-authored non-Kubernetes cloud resources, or external bindings with owned contributors.
This is a semantic plan error, not an implementation warning.

The catalog also records each dependency slot's required capability, guarantees, visibility, selected
implementation identity, consumer edges, and provider-internal authority. It rejects hidden dependencies,
unresolved capability references, cycles, guarantee mismatches, ambiguous implementation identity, and
duplicate physical ownership. Reusing one implementation value must remain one node across every
consumer; equal-looking configuration from separate constructor calls must remain separate unless an
explicit stable provider identity says otherwise.

## Lifecycle classifications

Every physical node has exactly one public lifecycle classification:

- application owned;
- deployment owned;
- shared singleton;
- externally owned;
- retained data; or
- ephemeral execution artifact.

Each classification defines create/adopt/update/replace/finalize/delete behavior and interruption retry
state. Target garbage collection is implementation detail. Lifecycle compatibility tests prove admission
quiescence, managed-execution drain/cancel, finalization, dependent-first teardown, retention, absence or
documented survival, and actionable blocker diagnostics.

## Semantic and physical plan contracts

The semantic graph records authored application meaning and requirements. `ApplicationPlan` resolves
provider implementations and explains physical deployment contributors without mutating that semantic
authority. Physical Deployment, HelmRelease, Lambda, database, queue, or endpoint nodes carry provenance
to the semantic requirement that caused them.

Stable plan consumers may depend on authored identity, semantic requirement, selected implementation,
guarantees, lifecycle owner, runtime/Secret/network requirements, maturity/evidence, migration
classification, and provenance references. Provider-native properties and explanatory topology remain
informational or opaque unless separately promoted.

Plans report rejected compatible-looking implementations and their missing guarantees. Installing a
package never selects its provider implicitly.

Provider compatibility evidence includes an integrated implementation and an assembled implementation of
at least one higher-level runtime—`OperatorRuntime` is the canonical v0.9 case. The same semantic
reconciler must run with a Kubernetes-cluster dependency and with database-plus-scheduler dependencies.
The compiled plans must prove identical semantic ownership, distinct physical implementation graphs,
private nested authority, stable shared-dependency identity, and safe dependent-first teardown.

## Deprecation and removal

Before 1.0, stale APIs should usually be removed with a targeted migration rather than preserved
indefinitely. After RC freeze:

- deprecations name the canonical replacement;
- compiler diagnostics include source-attributed fixes where safe;
- docs/search route old terms to migration pages;
- aliases have an explicit last supported version;
- stored artifacts retain compatibility for their declared support window.

No compatibility shim may silently reinterpret semantics.

## Machine-readable contract catalog

The build derives a catalog from export maps, declarations, schemas, diagnostics, providers, and docs
frontmatter. CI fails when:

- an exported symbol lacks owner/maturity/docs;
- a documented machine field/subtree lacks a stability class;
- a stable catalog item has no evidence gate;
- an internal symbol leaks through an export;
- package docs and exports disagree;
- a diagnostic lacks machine shape or remediation page;
- a provider's claimed maturity exceeds its evidence;
- a public provider constructor has an undeclared implementation dependency or erases a nested
  implementation's identity, lifecycle, readiness, migration, or authority contract;
- a provider preset cannot explain the ordinary implementation graph it assembled;
- generated catalog output is dirty.

The documentation website and release notes consume the same catalog.

## Upgrade qualification

The v0.9 gate upgrades from one exact released v0.8 baseline identified by package versions, Git tag,
application artifact schema, `ApplicationPlan` schema, provider catalog digest, runtime/host protocol
versions, and release-evidence manifest. “Latest source” or a candidate worktree is not a migration
baseline. Qualification uses:

- clean npm consumers;
- GuestBook, Chirp, and Agentic Start source;
- previously generated application artifacts;
- persisted jobs/workflows/actors/signals/events/cursors where applicable;
- live local and maintained profile/provider deployments;
- native Alchemy resources, TypeKro compositions deployed through Alchemy, and application CRDs;
- browser clients and generated routes.

Tests cover forward upgrade, supported rollback, interrupted migration, provider replacement, deletion, and
reinstall. A clean install alone is insufficient.

The
[ApplicationPlan and Deployment-State Migration RFP](./rfp-v09-application-plan-and-deployment-state-migration.md)
owns active Alchemy/TypeKro state adoption, physical identity preservation, lifecycle-authority transfer,
rollback frontiers, interruption recovery, and GitOps migration. This RFP owns the support window and
release admission decision.

The 1.0 candidate support floor is explicit:

- authoring compatibility is tested from the latest released v0.8 and every v0.9 minor to the RC;
- persisted stable artifacts and runtime protocols support at least the immediately preceding stable minor
  and every published RC in the active RC series;
- provider state upgrades start from the immediately preceding maintained provider release;
- live deployment upgrades start from the exact qualified v0.8 release and latest v0.9 release;
- rollback is promised only where the provider/lifecycle catalog marks it supported;
- beta/preview state has only the window stated by its own catalog entry.

Longer windows may be declared per contract. Shorter windows require explicit maturity and migration
disposition; “pre-1.0” is not permission to corrupt or silently orphan persisted state.

## Release train

The coordinated release gate verifies:

1. package versions and dependency ranges;
2. clean npm packing and consumer installation;
3. trusted npm publishing configuration;
4. operator/runtime OCI images and immutable references;
5. generated docs/reference and version selection;
6. signed provenance/SBOM where supported;
7. Git tag, release notes, migration guide, and package availability;
8. published-package and published-image smoke deployment.

Release automation must fail rather than publish a partial protocol train.

After `1.0.0-rc.1`, any change to a stable candidate symbol, semantic meaning, stable schema field,
protocol, generated-source contract, lifecycle guarantee, or compatibility window resets the RC series to
the next numbered RC and reruns every affected prior-artifact/live-upgrade lane. Additive fixes classified
in advance as `additive` may advance the RC without resetting unrelated evidence, but still produce a new
RC. Editorial corrections and informational fields do not reset the contract freeze.

The machine-readable v0.9 scorecard lists every RFP/workstream, maturity, blocking status, required
evidence, current disposition, and canonical contract owner. Release checks derive blockers from that
file. Maturity controls post-release compatibility promises; it does not make an accepted v0.9 beta or
preview optional. `codeAgent()`, Builder, Saga, and the maintained profile capabilities named by the v0.9
program must satisfy their evidence before release and may not be removed, hidden, or relabeled to make the
scorecard pass.

## Diagnostics

- `PUBLIC_CONTRACT_UNOWNED`
- `PUBLIC_CONTRACT_MATURITY_MISSING`
- `PUBLIC_ALIAS_AMBIGUOUS`
- `ARTIFACT_VERSION_UNSUPPORTED`
- `RUNTIME_PROTOCOL_INCOMPATIBLE`
- `GENERATED_SOURCE_DIRTY`
- `PROVIDER_EVIDENCE_INSUFFICIENT`
- `UPGRADE_PATH_UNQUALIFIED`
- `PACKAGE_DEPENDENCY_UNDECLARED`
- `MACHINE_SCHEMA_STABILITY_UNCLASSIFIED`

## Implementation increments

1. Define the inventory and field/subtree stability schemas and derive the first complete catalog.
2. Review vocabulary, package boundaries, export maps, and maturity.
3. Build independent compatibility lanes and previous-release fixtures.
4. Remove/rename/deprecate stale v0.x contracts with migrations.
5. Generate docs/reference/provider matrices from the catalog.
6. Run clean-context and external-consumer RC qualification.
7. Freeze `1.0.0-rc.1` only after every blocking item is dispositioned.

## Acceptance

- Every public export, protocol, diagnostic, provider, and generated contract is inventoried.
- Every supported graph/plan/diagnostic automation path has an explicit stability class.
- Informational and opaque fields are absent from supported machine-consumer dependencies.
- No stable item lacks docs, ownership, maturity, and evidence.
- Previous-release source and persisted artifacts pass their declared upgrade lanes.
- The exact v0.8 baseline passes active-state migration, interruption, rollback-before-commit,
  forward-recovery-after-commit, and deletion qualification.
- Official examples use only canonical vocabulary.
- Clean package consumers expose no undeclared dependency or eager tooling leak.
- External capability bindings use the same semantic provider contracts while producing no deployment
  contributor or owned-resource lifecycle.
- Kubernetes-cluster capability consumers receive exact declared authority without contaminating
  unrelated bundles.
- Integrated and assembled `OperatorRuntime` implementations pass one semantic reconciliation suite; the
  assembled path proves shared-dependency identity, private nested authority, cycle rejection, and
  dependent-first teardown.
- Every maintained compact provider preset expands to the same cataloged implementation graph as its
  explicit assembly and cannot hide a separately lifecycle-owned service.
- The frozen provider catalog exposes one canonical constructor spelling for every implementation used by
  the normative AWS and Kubernetes profiles; provider namespaces do not retain competing aliases.
- Chirp's `production-aws` and `production-kubernetes` profiles pass the same semantic journeys and minimum
  capability set through packed packages and live deployment evidence.
- Provider replacement and schedule/reconcile runtime replacement are classified and qualified as
  migrations where state or ownership changes.
- Search and compiler diagnostics guide deprecated vocabulary to one replacement.
- A clean-context reviewer can explain the stable/beta/preview boundary accurately.

## Non-goals

- promising compatibility for internal compiler implementation details;
- preserving every pre-1.0 alias;
- promoting providers without evidence;
- treating package version equality as full compatibility;
- redefining release scope to make a failing gate pass.

## Definition of done

The freeze is complete when the machine-readable catalog, documentation website, clean consumers, prior
artifacts, live upgrades, provider evidence, diagnostics, and official examples all agree on one canonical
candidate contract. Only then may `1.0.0-rc.1` freeze the model.
