# RFP: Applik8s v0.7 — MCP Transport and External Tools

**Status:** Proposed; maintainer review required

**Charter:** [`charter-v07-agentic-platform.md`](charter-v07-agentic-platform.md)

**Depends on:** Typed operation authority, canonical principal admission, the external identity/OAuth RFP,
HTTP hosting, profile DI, and optional Envoy AI Gateway

**Unblocks:** Protected application MCP, external tool consumption, agentic interoperability, and the
Agentic Start MCP operations experience

## Purpose

Expose existing Applik8s operations through MCP and consume external MCP servers without creating a
parallel handler, permission, principal, operation, or tool registry. MCP is a transport and external
capability boundary. It never becomes canonical application authority or AI workflow orchestration.

## Protocol baseline

The implementation pins and records an exact MCP protocol revision and SDK compatibility tuple. The
initial safe baseline is the published `2025-11-25` core. Before implementation freezes, maintainers
evaluate final status, Tier-1 SDK support, breaking changes, and interoperability evidence for
`2026-07-28` through a compatibility ADR.

The v0.7 server and client must declare which wire eras they serve, prefer, and negotiate. Conformance
and interoperability run against every enabled era; support is not inferred merely from using an SDK
that contains newer types.

Extensions are selected explicitly. Machine-to-machine client credentials use the reviewed client
credentials authorization extension rather than an implicit core guarantee. Protocol negotiation,
deprecation, extension support, SDK revision, and operation-catalog revision appear in manifests and
runtime diagnostics.

## Required developer experience

Expose existing operations:

```ts
application.mcp("research", {
  tools: [
    EvidenceSearch.search,
    Source.observe,
    Permission.create,
    Grant.request,
  ],
});
```

Consume an external server through a bounded provider capability:

```ts
const RetrievalTools = application.mcp.client("retrieval", {
  server: RetrievalServer,
  tools: ["fetch", "screenshot"],
  audience: "https://retrieval.example.com/mcp",
  credentials: RetrievalCredentials,
  timeout: "30s",
  concurrency: 8,
  maximumResponseBytes: 10_000_000,
});
```

MCP exposure reuses operation schemas, authority, target scope, idempotency, durable results, errors, and
audit. It does not wrap the operation in an MCP-only function.

The original operation retains its one executable closure and provider-native target. Exposing
`Source.observe` does not copy its handler, translate its relational/CRD target into an MCP model, or
register a second tool implementation. The MCP adapter validates and admits the transport, then invokes
that exact operation handle.

## Owned contracts

This RFP owns:

- MCP server discovery, initialization, transport, tools, cancellation, progress, and errors;
- MCP client connections, discovery policy, allowlists, session catalog/schema pinning, stateless
  versioned-name compatibility, and collision handling;
- HTTP authorization metadata and protocol negotiation;
- OAuth resource/audience binding, PKCE, refresh, revocation, and token-storage requirements at the MCP
  transport boundary;
- selected MCP authorization extensions;
- external MCP trust, schema, egress, credential, size, time, concurrency, and audit policy;
- optional Envoy `MCPRoute` lowering and defense-in-depth enforcement.

It does not own:

- canonical principals, permissions, grants, approvals, or outcomes;
- authentication-provider flows or OAuth server implementation;
- application operation handlers or schemas;
- AI orchestration;
- token passthrough.

## Principal and authority seam

The operation-authority RFP owns canonical `Principal` and `IdentityReference`. The identity/OAuth RFP
authenticates credentials and provider sessions. MCP admits the transport request into that same
principal contract and then invokes the existing operation-authority boundary.

An inbound MCP token never directly becomes a grant and never becomes a downstream provider token.
Authentication, transport admission, tool visibility, application authorization, and downstream
credential acquisition are distinct decisions.

## MCP server authorization

HTTP MCP servers implement:

- Protected Resource Metadata;
- `WWW-Authenticate` discovery;
- authorization-server metadata and OIDC discovery handling;
- canonical resource indicators in authorization and token requests;
- audience/resource validation;
- PKCE for public authorization-code clients;
- short-lived access tokens and refresh-token rotation where applicable;
- incremental-scope challenge behavior for the pinned protocol revision;
- revocation and stale-token rejection.

Token passthrough is forbidden. When an MCP operation calls another service, the workload obtains a
separate audience-bound credential through an explicitly declared provider capability.

The protected-resource endpoint, authorization-server metadata, client registration mode, extensions,
protocol revision, and operation-catalog revision appear in generated diagnostics.

## MCP catalog and schema pinning

Standard `tools/call` carries a tool name and arguments, not the schema or catalog revision a client saw
during `tools/list`. Input validation therefore cannot prove that a still-schema-valid call reflects the
client's cached semantics.

Every stateful MCP connection or transport session is pinned at initialization to one active
operation-catalog revision:

```text
MCP protocol/wire revision
MCP server definition revision
Applik8s operation-catalog revision
tool-name -> operation ID/version/schema-hash mapping
principal, audience, and authorization revision
session issue/expiry and draining policy
```

`tools/list` and every `tools/call` resolve through that pinned mapping. Catalog activation does not
reinterpret a live session. Compatible prior bindings remain executable while their pinned sessions
drain; incompatible retirement rejects the session with an actionable reinitialize/re-discover response.
`notifications/tools/list_changed` is a discovery signal, not proof that a client refreshed its schema,
and does not silently repin an existing session.

Catalog pinning does not pin an authorization decision. Every call revalidates the current principal,
grant, target, audience, and authority revision against the operation represented by the pinned mapping.
Revocation or scope change can filter tools, reject calls, or close the session without changing what a
tool name means.

When a transport is stateless or cannot prove session pinning, incompatible operation revisions use
versioned public tool names and coexist for the declared compatibility window. A negotiated extension may
carry catalog revision explicitly, but the core path must remain safe without that extension. An
unversioned stateless call is accepted only when its tool name has one unambiguous compatible meaning
across every served catalog revision.

## MCP operation mapping

Each exposed tool records:

- stable MCP public name;
- stable Applik8s operation ID and version;
- the existing operation input/output schemas;
- declared errors;
- target and transport constraints;
- approval behavior;
- deprecation/replacement metadata.

Name collisions fail the build or require explicit aliases. Compatibility is enforced through the
pinned session mapping, retained compatible handlers, versioned tool names for incompatible stateless
coexistence, or an explicitly negotiated catalog-revision extension. The server must not claim to detect
a cached schema revision from name-and-arguments validation alone.

The MCP server adapter owns protocol dispatch only. Operation execution remains in the runtime placement
already declared by the operation graph; MCP cannot move a transaction closure into an HTTP process or
move an external-effect task into a model transaction.

MCP progress and cancellation map to the operation where supported. Cancellation does not claim to undo
a committed command or external effect.

Resources, prompts, and MCP Apps are not inferred from operations. When enabled, they are separate typed
graph nodes with explicit identity, authorization, browser trust, content-security, size, and lifecycle
contracts. Tool completion cannot inject an unreviewed MCP App into a privileged administration surface.

## External MCP trust boundary

Consuming external tools requires:

- explicit server identity and canonical audience;
- tool allowlist or pinned typed discovery contract;
- credential source and rotation policy;
- request and response validation;
- egress declaration;
- timeout, retry, response-size, concurrency, and cost budgets;
- prompt-injection classification for retrieved content;
- audit of server, tool, arguments digest, result digest, and run causation;
- no secret interpolation into model-visible tool descriptions.

Discovered tools are data until admitted by policy. Discovery neither makes a tool available to every
agent nor grants authority to use it.

External tools are typed provider capabilities. Generated or pinned schemas may improve developer typing,
but invocation validates the negotiated live schema/revision. Incompatible discovery changes quarantine
the tool rather than silently accepting a broader contract.

Making an external tool available to an agent records both availability and the workload
credential/egress policy used to call it. It does not transfer the initiating user's token.

## Envoy MCP routing

When enabled, the MCP provider lowers routes through the qualified Envoy AI Gateway installation. It may
aggregate servers, filter or rename tools, validate JWTs, forward reviewed claims, enforce additional
rate/size policy, and expose protected-resource metadata.

Envoy policy is defense in depth. It does not replace Applik8s operation authorization, mint canonical
grants, or authorize external tool use because a route advertises the tool. The AI RFP owns the shared
gateway installation and AI routes; this RFP owns `MCPRoute` semantics and authorization. Both consume
one released TypeKro integration.

## Implementation increments

1. Pin the protocol/SDK revisions, enabled wire eras, extensions, and compatibility policy.
2. Define MCP server/client graph nodes, direct operation mapping, session catalog pinning, retained
   compatibility bindings, and stateless versioned-name behavior.
3. Implement deterministic in-process and HTTP transport fixtures.
4. Implement protected-resource metadata, discovery, PKCE, resource indicators, and revocation.
5. Implement external client trust, allowlist, schema, egress, credential, and audit boundaries.
6. Integrate optional Envoy `MCPRoute` without transferring canonical authority.
7. Run per-era conformance, client interoperability, and adversarial acceptance matrices.

## Required gates

- MCP works through any conforming identity/OAuth provider and does not redefine its principal contract.
- The generated MCP schema is the existing operation schema.
- The generated MCP handler invokes the existing operation closure and contains no copied or
  independently configurable domain implementation.
- Relational, CRD/resource, query, search, and workflow operations expose through the same MCP mapping
  only when their transport/result capabilities are compatible.
- MCP exposure does not broaden another transport's grant.
- Wrong wire era, resource, audience, target, client, tool, operation version, or authorization revision
  fails safely.
- Token passthrough is detected and rejected.
- Public clients use PKCE and secure redirect constraints.
- Client credentials are enabled only through the selected reviewed extension/profile.
- Tool discovery collisions and incompatible schema changes fail safely.
- `tools/call` is resolved against a session-pinned catalog, an explicitly negotiated revision, or an
  unambiguous versioned tool name; ordinary name-and-arguments validation never claims to reveal the
  client's cached schema.
- Catalog activation does not reinterpret a live MCP session; compatible bindings drain, incompatible
  sessions reinitialize, and stateless incompatible revisions coexist under versioned names.
- External responses exceeding size/time limits are terminated and audited.
- Prompt-injection fixtures cannot broaden tool availability or authority.
- MCP client authorization completes through a real provider-backed browser flow and revocation
  terminates subsequent invocation.
- External MCP invocation uses a separately acquired audience-bound credential.
- Enabled MCP wire eras pass the selected SDK conformance and interoperability matrix.
- Optional Envoy routing does not change canonical operation authorization outcomes.

## Open questions

1. Is final `2026-07-28` interoperability sufficient to replace the `2025-11-25` default before v0.7 RC,
   or should v0.7 negotiate both eras?
2. Which MCP Apps capabilities, if any, belong in the first Agentic Start operations UI?
3. Which external server discovery changes may be accepted automatically versus requiring reviewed
   schema replacement?

## Definition of done

This RFP is complete when a protected MCP client can discover, authenticate, invoke, observe, and lose
access to an existing Applik8s operation through a pinned interoperable protocol; external MCP tools
remain bounded provider capabilities; inbound credentials never pass through to downstream servers; and
session catalog pinning or versioned stateless names prevent stale schema assumptions from being
reinterpreted; and optional Envoy routing remains defense in depth rather than alternate authority.
Completion does not authorize v0.7.
