# Maintainer Policy

## Public API Acceptance Rule

Every new public API promise must include:

- implementation
- tests covering success and failure behavior
- docs explaining supported and unsupported semantics
- compatibility notes when generated artifacts, manifests, runtime ABI, or host imports are affected
- release-note coverage

Throwing placeholders are not acceptable public APIs unless the throw is the documented fail-closed behavior for a specific unsupported input.

## v0.1 Change Policy

Before `v1.0`, TypeScript authoring APIs and generated manifests may change.

Runtime and bundle compatibility must remain explicit through:

- operator manifest apiVersion
- handler ABI version
- runtime version requirement
- declared host imports
- generated runtime contract digests

Unsupported combinations must fail closed.

## Review Checklist

For public API changes, reviewers should ask:

- Does this broaden v0.1 scope?
- Does unsupported behavior fail closed?
- Are generated artifacts still inspectable?
- Does TypeKro behavior remain adapter-local?
- Are docs and release notes updated?
- Are tests user-recognizable rather than only implementation-specific?

## Roadmap Discipline

When work lands, update `BACKLOG.md` in the same change. Roadmap tags should reflect current implementation reality, not aspiration.
