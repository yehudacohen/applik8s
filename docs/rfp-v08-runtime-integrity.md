# RFP: Canonical Runtime Integrity

**Status:** Accepted v0.8 implementation contract

**Target:** Applik8s v0.8.0

**Manifesto:** [`manifesto-v08-portable-stateful-development.md`](manifesto-v08-portable-stateful-development.md)

**Foundation gate:** The stable `graph-provenance` gate must pass before
Runtime Integrity can freeze graph, operation, provider, or execution-boundary
identities into canonical bytes or admission records.

**Foundation dependencies:** Canonical application identities, operation
authority, JSON value contracts, and source provenance

**v0.8 contract integrations:** HTTP and reactive gateways, workflows, schedules,
actors, search, object storage, lakehouse, compiler artifacts, TypeKro adapters,
and maintained target runtimes adopt the shared contracts incrementally. The
canonical algebra and wire contracts must freeze before their persisted v1
formats are emitted.

## Problem

Applik8s currently contains multiple implementations of canonical JSON, HMAC
envelopes, base64url parsing, cursor expiry, and admission validation. Each local
implementation is understandable, but together they permit digest drift,
cross-purpose token confusion, inconsistent expiry/error behavior, and authority
differences between execution families and providers.

v0.8 adds more targets and durable state. It must not make these accidental
differences permanent.

## Contract

Runtime Integrity consists of three versioned foundations:

1. Canonical JSON v1 defines deterministic bytes through named domain policies.
2. Signed Envelope v1 signs one typed, purpose-separated payload over those
   canonical bytes.
3. Admission Context v1 carries one validated principal, authority, trusted
   context, causation, deadline, cancellation, and trace context into managed
   execution.

These are framework integrity contracts. They do not replace application
authorization, provider-specific continuation state, or execution-family input
schemas.

## Canonical JSON v1

The core algebra must specify:

- object-key ordering and string escaping;
- `undefined` behavior for object properties, array entries, and roots;
- root `null`, JSON root scalars, finite numbers, and negative zero;
- rejection of cycles, unsupported values, and non-finite numbers;
- byte/string conversion boundaries; and
- deterministic diagnostics identifying the rejected path and active policy.

Domains select a named, versioned policy. They may not copy and modify the
algorithm. TypeKro/CEL references are encoded through explicit compiler or
deployment adapters and cannot enter the platform-neutral core by duck typing.

## Signed Envelope v1

Every envelope includes:

- format version;
- purpose/audience;
- algorithm;
- key identity;
- issued-at and optional expiry;
- typed payload; and
- signature over the canonical protected body.

Verification must enforce purpose before payload use, bound encoded size before
parsing, validate payload shape, compare signatures without data-dependent early
success, and return structured non-secret diagnostics. A decoder never tries a
different purpose after failure.

Commands, queries, subscriptions, tasks, object intents, search, celld tickets,
and lakehouse cursors define separate payload schemas. Provider implementations
contribute only provider-specific continuation state.

## Admission Context v1

The canonical context contains:

- authenticated principal and authority revision;
- trusted-context values and digest;
- authorization receipt where the operation requires one;
- operation identity and transport;
- correlation and causal lineage;
- deadline and cancellation; and
- trace context.

Every external or internal ingress constructs this context through an explicit
adapter:

| Ingress | Admission source |
| --- | --- |
| Human HTTP and browser/SSE | Authenticated request identity plus server-admitted trusted context |
| Webhook or provider callback | Verified provider identity plus callback delivery identity |
| Broker delivery | Verified consumer identity plus immutable delivery envelope |
| Workflow or task | Workflow-engine delivery plus persisted framework invocation metadata |
| Schedule occurrence | Scheduler service principal plus admitted occurrence receipt |
| Actor call or alarm | Exact actor operation receipt or persisted admitted alarm authority |
| Framework service | Named service principal with exact operation scope |

Adapters may add verified delivery provenance. They may not fabricate a human
principal, reuse the principal that configured a later schedule, or weaken an
operation receipt. Execution families consume typed narrowed views of the same
validated context.

## Rolling migration

Every persisted format is assigned a lifetime class before migration:

- request-local: no compatibility decoder;
- resumable/expiring: decode only until the maximum issued lifetime expires;
- durable persisted: use a multi-release migration with observed-read evidence.

The default durable rollout is:

1. Release A reads legacy and v1 but continues writing legacy.
2. Release B reads legacy and v1 and writes v1.
3. Release C reads v1 only after retained-state and maximum-lifetime evidence
   proves legacy input is absent.

Where a shorter sequence is safe, the migration record must name why old and new
readers cannot coexist. Mixed-version workers must never receive a format they
cannot decode during rolling deployment.

## Package ownership

[`adr-v08-runtime-integrity-package-ownership.md`](adr-v08-runtime-integrity-package-ownership.md)
is normative for dependency direction. No new public package is created for this
work unless that ADR is amended.

## Evidence

The `runtime-integrity` acceptance gate requires:

- identical fixed vectors across Node, browser, worker, WASM-safe core, compiler,
  and provider test lanes;
- cross-purpose substitution, tampering, truncation, malformed input, wrong-key,
  expiry, oversize, and ambiguity rejection;
- deterministic/PostgreSQL/OpenSearch search cursor parity;
- mixed-version rolling migration evidence for every durable format;
- admission parity across every ingress row above; and
- a source inventory proving maintained gateways/providers do not contain a
  private signing or canonicalization implementation.

## Completion

This RFP is complete when every maintained runtime uses the canonical contracts,
the source inventory is clean, rolling migration evidence is recorded, and
`bun run check:v08:runtime-integrity` passes. Contract tests alone do not mark
live migration or provider evidence complete.
