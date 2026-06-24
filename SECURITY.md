# Security Policy

## Supported Versions

Before v1.0, only the latest published v0.x release is supported for security fixes.

## Reporting A Vulnerability

Please report suspected vulnerabilities privately to the maintainers before opening public issues. If no dedicated security contact is configured yet, open a minimal public issue requesting private security coordination without disclosing exploit details.

## v0.1 Security Boundary

Handlers run as WASM components inside the Rust operator host. The host owns Kubernetes API access, operation-plan validation, status lifecycle writes, logs, metrics, replay artifacts, and declared host imports.

v0.1 denies by default:

- ambient filesystem access
- Node/raw network access outside direct WASI HTTP `fetch`
- ambient environment access
- dynamic module loading
- undeclared host imports
- unsupported external capability protocols
- embedded obvious local credential captures where detected by compiler checks

The WASM boundary does not prove handler logic is correct or idempotent. Handlers must reconcile from durable Kubernetes state.

Replay artifacts, source maps, logs, status messages, and generated bundles can contain sensitive metadata. Full-payload replay capture must be treated as sensitive.

See `docs/security-model.md` for the full current security model.
