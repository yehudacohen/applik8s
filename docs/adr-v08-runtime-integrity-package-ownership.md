# ADR: Runtime Integrity package ownership

**Status:** Accepted for v0.8 implementation

## Decision

Runtime Integrity uses existing packages and strict dependency direction:

```text
@applik8s/core
  canonical JSON algebra and named policies
  envelope/admission wire contracts and validators
  no crypto, Node, browser, TypeKro, or provider dependency
           |
           v
@applik8s/runtime
  portable asynchronous sign/verify codec
  WebCrypto/SubtleCrypto implementation and key-provider interface
  structured runtime errors
           |
           v
execution and provider packages
  typed payload schemas and provider continuation state only

compiler / deployment-typekro boundary
  explicit TypeKro/CEL canonical-value adapters
```

## Detailed ownership

### `@applik8s/core`

Owns:

- `CanonicalJsonV1` values, policies, byte generation, and diagnostics;
- `SignedEnvelopeV1` protected-body and wire shapes;
- purpose and version validation;
- `ApplicationAdmissionContextV1` and narrowed-view contracts; and
- environment-independent fixed vectors.

It must not import `node:crypto`, WebCrypto globals, TypeKro, CEL, Kubernetes,
Alchemy, or provider SDKs.

### `@applik8s/runtime`

Owns:

- asynchronous signing and verification orchestration;
- the portable key-provider interface;
- the maintained SubtleCrypto implementation used by modern Node, browser, and
  worker hosts; and
- runtime error normalization and key rotation.

Node compatibility code may adapt keys or existing synchronous callers during
migration. It cannot define different envelope bytes or verification semantics.
WASM guests that do not possess signing authority use core validation types and a
host capability; they do not receive signing keys.

### Execution packages

Command, query, stream, task, storage, search, actor, schedule, and lakehouse
packages own their payload schemas, purpose identifiers, and semantic validation.
They call the runtime codec and cannot implement HMAC, base64url, canonical JSON,
or expiry independently.

An integration may implement cryptography required by an external wire protocol
such as webhook verification only when the protocol cannot use the framework
envelope. The implementation must carry a reviewed
`runtime-integrity: external-protocol-crypto` marker, identify the protocol and
official test vectors, remain unavailable to framework envelope callers, and be
listed in the Runtime Integrity source inventory. The marker is not a general
allowlist for provider-owned cursors or tokens.

Search providers own only continuation state. The framework-owned search cursor
schema and codec wrap that state uniformly.

### Compiler and TypeKro integration

Compiler and deployment adapters translate explicit TypeKro/CEL reference values
into a named Canonical JSON policy input. Core never detects references through
proxy behavior, property names, or undocumented marker shapes.

## Admission construction

Core validates the canonical context. Runtime and ingress packages construct it
from verified transport-specific evidence. No gateway defines a competing
principal-plus-trusted-context record.

## Consequences

- No new public package is required.
- Existing package boundaries remain prunable.
- Signing APIs become asynchronous where necessary.
- Mixed-version adapters are temporary and carry a removal condition.
- Source-level checks can enforce the dependency boundary mechanically.

## Amendment rule

Creating a new package, allowing provider packages to sign independently, or
moving TypeKro reference knowledge into core requires a new ADR and maintainer
approval.
