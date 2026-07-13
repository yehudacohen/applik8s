# Build Supply Chain

Applik8s has two distinct dependency boundaries:

- the generated operator image contains the Rust operator host and compiled handler artifacts; it does not contain the npm compiler or TypeKro dependency tree
- the authoring and compilation environment installs npm dependencies and must be treated as a build control plane

The second boundary matters even when a vulnerable package is absent from the runtime image. A compromised compiler can alter generated WASM, Kubernetes manifests, or image recipes.

## Audited Candidate Graph

`bun run check:package-audit` resolves the external production dependencies declared by every publishable `@applik8s/*` package in a clean temporary project and runs `npm audit --omit=dev`. The gate compares source advisories—not npm's propagated parent-package count—with `security/npm-audit-baseline.json`.

The gate fails when:

- a new advisory appears
- an advisory's dependency or severity changes
- a reviewed exception expires
- a baseline entry disappears and has not been deliberately removed

The baseline is an expiring review record, not a claim that known vulnerabilities are safe or fixed.

## v0.4.2 Review

The reviewed graph has seven source advisories that npm propagates into twelve package findings in the candidate graph and fifteen findings in a clean install of the v0.4.1 umbrella package.

The findings reduce to these upstream roots:

- TypeKro pins an affected `angular-expressions` release and an affected `js-yaml` release. Patched releases exist, so a TypeKro dependency refresh is required.
- TypeKro's `cel-js` parser chain pins Chevrotain 11 and an affected Lodash release. This needs an upstream CEL parser dependency update or replacement.
- ComponentizeJS depends on `@bytecodealliance/weval`, whose archive extraction chain reaches the affected `decompress` release. No patched ComponentizeJS release was available at review time.

Until those roots are removed:

- compile only trusted application source and TypeKro/CEL definitions
- run compilation in an ephemeral, least-privileged environment without production credentials
- keep npm lifecycle scripts disabled in clean-consumer and release-smoke installs
- review the lockfile and the audit baseline on every dependency update
- do not describe a green baseline check as a zero-vulnerability audit

The TypeKro pins are actionable dependency work. The ComponentizeJS finding remains an upstream containment item and must be re-reviewed before the baseline expiry date.
