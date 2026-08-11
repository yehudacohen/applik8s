# RFP: Applik8s v0.7 — External Identity and OAuth

**Status:** Accepted v0.7 contract; implementation evidence remains governed by the release scorecard

**Charter:** [`charter-v07-agentic-platform.md`](charter-v07-agentic-platform.md)

**Depends on:** Typed operation authority, profile DI, provider-neutral request identity, HTTP hosting,
TypeKro Ory infrastructure, and the canonical `Principal`/`IdentityReference` contract

**Unblocks:** Browser, service, workload, agent, and OAuth-client admission; protected MCP; the Agentic
Start account experience; and the agentic identity acceptance application

## Purpose

Define provider-neutral authentication, session, OAuth, client, consent, and admission contracts and
qualify Ory as the first dedicated implementation. Identity infrastructure authenticates and admits
principals; it does not become canonical application authority or define product user/tenant schemas.

Identity/OAuth must work independently of MCP. MCP consumes this contract through its own RFP and may use
another conforming identity/OAuth provider.

## Required developer experience

Select identity and OAuth by capability:

```ts
const PrimaryIdentity = IdentityProvider.named("primary");
const PrimaryOAuth = OAuthAuthorizationServer.named("primary");

deployment
  .provide(PrimaryIdentity)
  .starter(() => Identity.deterministic())
  .dedicated(() => Identity.ory())
  .external((spec) => Identity.external(spec.providers.identity))
  .exhaustive();

deployment
  .provide(PrimaryOAuth)
  .starter(() => OAuth.development())
  .dedicated(() => OAuth.oryHydra())
  .external((spec) => OAuth.external(spec.providers.oauth))
  .exhaustive();
```

Application code consumes admitted, provider-neutral principals:

```ts
application.http("account", (http) => {
  http.get("profile", "/profile", async (_request, context) => {
    return Account.read({ identity: context.principal.identity });
  });
});
```

This is the ordinary identity-integration path: closures receive `context.principal`, and protected
operation handles use the shared authority model. Application features do not call Ory, parse provider
sessions, or select an identity adapter. The profile provisions above are the advanced topology path for
choosing or replacing the authentication/OAuth implementation; they are not required in the beginner
tutorial. Framework-maintained login, recovery, consent, and session modules adapt provider flows
into this same admitted-principal contract.

Framework-neutral Vite/server and React packages expose account, session, recovery, consent, and client
administration seams. The Agentic Start contributes TanStack Start routes without making identity
TanStack-specific.

Identity adapters admit principals into ordinary executable route and operation closures. They do not
replace application handlers with provider configuration. Product accounts may be relational,
Kubernetes-backed, or another promoted model chosen by the application; Ory identity records and traits
are provider state, not a mandatory universal Applik8s user model.

## Owned contracts

This RFP owns:

- authentication, pre-authentication, and authenticated OAuth authorization-flow lifecycles;
- provider sessions, credentials, authentication-method evidence, and admission adapters;
- OAuth authorization-server capabilities, client lifecycle, consent, token, introspection, and
  revocation contracts;
- browser, service, workload, agent, OAuth-client, and MCP-client authentication;
- account, login, recovery, settings, MFA, consent, and client-administration module interfaces;
- Ory Kratos, Hydra, Keto, and Oathkeeper provider adapters and TypeKro qualification;
- provider projection frontier, readiness, outage, rotation, backup, restore, and upgrade behavior.

It does not own:

- canonical `Principal` or `IdentityReference` types;
- permissions, grants, delegation, approvals, outcomes, or operation authorization;
- product user, organization, tenant, membership, or entitlement schemas;
- MCP protocol transport or external tool trust;
- provider-specific shapes in domain or browser code.

## Identity and authority seam

The operation-authority RFP is the sole owner of canonical `Principal` and `IdentityReference` types used
by domain handlers, operation admission, durable receipts, and audit. Identity/OAuth owns authentication
flows, provider identity/session lifecycles, credential validation, and adapters that produce an admitted
`Principal`. MCP owns transport admission into the same contract. No adapter defines an alternate
principal shape.

`PreAuthenticationFlowPrincipal` and `OAuthAuthorizationFlowPrincipal` are constrained admitted variants
of that authority-owned canonical `Principal`; this RFP owns their flow state, evidence, transition, and
admission requirements, not a competing principal base type.

```text
IdentityProvider
  authentication, sessions, identity lifecycle

OAuthAuthorizationServer
  clients, consent, authorization codes, tokens, delegation protocol

RelationshipStore
  provider relationship projection

AccessGateway
  request admission and enforcement

AuthorizationAuthority
  canonical Applik8s permissions, grants, revisions, uses, outcomes, revocation
```

Ory identities normalize into admitted principals. Keto relationships and gateway policies may support
decisions and defense in depth, but they do not mint canonical application authority independently.

Provider projections carry source authority revision, projection frontier, readiness, and revocation
lag. When required projection freshness cannot be proven, protected requests fail closed.

## Admitted principal evidence

The adapter supplies the authority layer with:

```text
issuer and normalized identity reference
authentication method and assurance
session, OAuth client, workload, agent-run, pre-authentication-flow, or OAuth-authorization-flow reference
audience and resource
trusted-context digest
credential issue/expiry times
provider and application authorization revisions
```

Provider profiles, Ory traits, token claims, raw sessions, cookies, refresh tokens, client secrets, and
relationship-store responses do not enter domain models or browser facades.

Identity operations include:

```text
Identity.register
Identity.login
Identity.verify
Identity.recover
Identity.configureMfa
Identity.logout
OAuthClient.create
OAuthClient.rotate
OAuthClient.revoke
Consent.approve
Consent.reject
Session.revoke
```

Administrative operations use ordinary operation authority. OAuth scopes and token claims reference
compatible catalog artifacts or an explicitly narrower admission profile; authentication never creates
canonical grants implicitly.

The named identity operations above are ordinary authorizable operation handles. HTTP, MCP, workflow,
and UI adapters invoke those handles and therefore reuse their schemas, closures, authority,
idempotency, results, and audit. Provider adapters implement authentication-flow mechanics but do not
register parallel Ory-specific handlers for the same application behavior.

## Pre-authentication flow authority

`Identity.register`, `Identity.login`, `Identity.verify`, and `Identity.recover` are not anonymous public
operations and do not require an already authenticated principal. They execute through a constrained
`PreAuthenticationFlowPrincipal` backed by canonical `PreAuthenticationFlow` state:

```text
flow ID and kind: register | login | verify | recover
provider flow/session reference
browser/session binding and CSRF state
optional OAuth continuation binding: client, redirect URI, resource, audience, authorization request
issued, expires, consumed, cancelled, and superseded state
attempt, rate, abuse, and proof-progress counters
enumeration-safe public result
trusted provider-continuity evidence
```

The flow principal may invoke only the exact next transitions authorized by current flow state. It cannot
invoke application operations, grant itself permissions, change client/redirect/audience, or survive
expiration, consumption, cancellation, provider replacement, browser/session mismatch, or CSRF failure.
Flow IDs are high entropy, bounded lifetime, and single use at terminal transitions. Privilege or
assurance changes rotate the flow identity.

Public responses are enumeration resistant: status, timing class, recovery initiation, and errors do not
disclose whether an account, email, client, or recovery factor exists. Rate and abuse limits bind
network evidence, browser/session, client, normalized subject hints, provider state, and deployment
policy without exposing raw sensitive signals.

Redirect URI, resource, and audience are normalized and bound before provider redirection and revalidated
on every return. Provider cookies, CSRF tokens, raw flow payloads, and continuity artifacts remain
adapter-private. Losing continuity fails closed instead of silently starting an unbound replacement.

Applik8s does not claim a transaction spanning its flow store and a provider session. Successful
authentication uses idempotent choreography:

```text
provider completion returned
  -> validate authoritative provider completion and continuity
  -> derive stable provider completion/session identity
  -> transactionally consume local flow and commit one admission receipt
  -> return or reuse that receipt on callback retry
  -> reconcile or revoke an orphaned provider session if local admission cannot complete
```

The admission receipt binds flow, provider completion/session identity, admitted principal, assurance,
trusted-context digest, OAuth continuation where present, issue/expiry, and causal audit identity.
Duplicate callbacks return the same receipt and cannot create another local principal transition.
Provider completion followed by local failure remains recoverable from the stable provider identity; if
recovery cannot be proven, an orphan reconciler revokes or expires the provider session. Administrative
factor reset, session/client administration, suspension, and permission changes then use ordinary
application authority.

## OAuth authorization flow authority

Consent requires an authenticated resource owner. `Consent.approve` and `Consent.reject` execute through
an `OAuthAuthorizationFlowPrincipal`, not a `PreAuthenticationFlowPrincipal`:

```text
admitted authenticated human Principal and provider session/assurance
authorization request and flow ID
OAuth client identity and revision
exact redirect URI
requested and previously granted scopes
resource indicators and audience
PKCE and response-mode binding where applicable
issued, expires, consumed, denied, and superseded state
CSRF/browser/session binding and provider continuity
```

This flow principal may decide only its bound authorization request for the authenticated resource owner.
It cannot approve another client, redirect, scope, resource, or user; grant ordinary application
permissions; or survive logout, session replacement, assurance loss, expiration, consumption, or CSRF
failure. Provider or application policy may reuse a prior resource-owner decision only when its client,
scope, resource, audience, validity, and current authority constraints are still compatible. It may not
treat successful login alone as consent.

## OAuth lifecycle

The provider-neutral contract includes:

- authorization code with PKCE;
- reviewed machine/service authorization;
- refresh-token rotation and reuse detection;
- introspection and revocation;
- resource indicators and audience binding;
- client registration/provisioning modes;
- redirect-URI and client-type constraints;
- login, consent, logout, and error integration;
- key and signing-material rotation;
- security-event and audit emission.

Tokens authenticate and convey bounded protocol authority. Application operation authorization remains a
separate decision using the admitted principal and current authority revision.

## Ory qualification

### Kratos

- registration, login, verification, recovery, settings, MFA, session, and logout;
- framework-neutral account modules and TanStack Start route integration;
- courier/email profiles;
- key/Secret rotation;
- backup/restore and upgrade.

### Hydra

- authorization code with PKCE;
- reviewed machine authorization;
- refresh, introspection, and revocation;
- login/consent integration;
- typed OAuth client lifecycle;
- resource/audience behavior required by browser, service, and MCP clients.

### Keto and Oathkeeper

- typed namespace and relationship projection;
- version/frontier-aware decisions;
- protected upstream enforcement;
- revocation propagation and fail-closed outage behavior.

Ory terminology remains confined to provider packages. Ory Enterprise-only capabilities are not required
by the open-source Start.

### TypeKro lifecycle

The released TypeKro integration must support:

- explicitly owned or externally managed Ory dependencies;
- Kratos, Hydra, Keto, Oathkeeper, Maester, required migrations, and database wiring;
- typed OAuth clients, rules, Secrets, exposure, TLS, DNS, courier, and UI endpoints;
- starter/development and production-safe dedicated configurations;
- complete hydrated public status in direct and KRO modes;
- key/Secret rotation, backup/restore, upgrade, and failure recovery;
- deletion without namespace/finalizer deadlock or undocumented canonical-data loss.

Applik8s consumes released TypeKro compositions and their Alchemy lifecycle. It does not copy Helm values,
run migrations through handwritten deployment code, or delete instances with ad hoc `kubectl`.

## Implementation increments

1. Define the exact authority-owned principal/admission boundary.
2. Implement pre-authentication flow principal/state, CSRF/session/redirect binding,
   enumeration-resistant results, rate/abuse policy, provider continuity, idempotent admission receipts,
   and orphaned-provider-session reconciliation.
3. Define normalized identity admission, authenticated `OAuthAuthorizationFlowPrincipal`, and OAuth
   capability contracts.
4. Implement deterministic starter providers and framework-neutral UI seams.
5. Complete Ory TypeKro lifecycle and provider adapters.
6. Implement account, login, recovery, settings, MFA, consent, session, and client administration.
7. Qualify rotation, revocation, backup/restore, upgrade, outage, and projection-frontier behavior.

## Required gates

- Identity/OAuth qualification passes with MCP disabled.
- Every adapter produces the authority RFP's canonical `Principal`/`IdentityReference`.
- Ordinary feature closures consume `context.principal` and shared protected operation handles without
  importing provider SDKs or understanding profile selection.
- Authentication never grants an application operation implicitly.
- Registration, login, verification, and recovery require a bounded `PreAuthenticationFlowPrincipal`;
  that principal cannot approve OAuth consent.
- Consent requires an authenticated `OAuthAuthorizationFlowPrincipal` bound to the exact resource owner,
  session, client, redirect URI, scopes, resource, audience, and authorization request.
- CSRF/session/redirect/audience mismatch, expired/reused flows, lost provider continuity, and
  enumeration/rate-limit adversarial fixtures fail safely.
- Provider completion and local flow consumption are idempotently choreographed: callback retry reuses
  one admission receipt, and an orphaned provider session is reconciled or revoked after local failure.
- Kratos registration/login/recovery/MFA/session/logout and Hydra
  authorization/client/refresh/revocation pass through provider-neutral contracts.
- Required Keto/Oathkeeper projections report frontier and fail closed when stale.
- Public clients use PKCE and secure redirect constraints.
- Account and consent modules work through framework-neutral server/React seams and maintained
  TanStack Start routes.
- Provider-native application account models retain their original Drizzle, CRD/resource, or entity
  definitions; identity integration does not require a second framework user schema.
- Generated account and flow routes contain ordinary executable closures or direct operation adapters,
  not handler-free provider configuration.
- Ory direct and KRO install, update, rotation, backup/restore, and deletion pass through TypeKro/Alchemy.
- Browser artifacts contain no raw provider session, credential, Secret, provider SDK, or authority
  implementation.

## Closed v0.7 decisions

1. Client ID metadata documents are the preferred dynamic-client path. RFC 7591 is an explicit
   compatibility capability rather than an inferred default.
2. PostgreSQL remains canonical for application grants and relationships. Keto is an optional qualified
   projection and never admission authority by itself.
3. The provider-neutral v0.7 vocabulary distinguishes authenticated, verified-email, multi-factor, and
   phishing-resistant assurance, with password, passkey/WebAuthn, TOTP, recovery code, and provider
   methods where supported. Unsupported methods remain absent rather than simulated.

## Definition of done

This RFP is complete when browser, service, workload, agent, OAuth-client, and MCP-client credentials can
authenticate through provider-neutral contracts and become the same canonical admitted principal;
pre-authentication flows resist CSRF, replay, enumeration, redirect substitution, abuse, and continuity
loss; OAuth consent is bound to an authenticated resource owner; provider/local partial failure is
recoverable without duplicate admission; and Ory registration, recovery, session, consent, client,
rotation, revocation, recovery, and lifecycle behavior pass without provider shapes becoming domain
authority. Completion does not authorize v0.7.
