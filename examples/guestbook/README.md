# applik8s GuestBook

This is the full launch showcase. For the programming model without launch hardening, start with the [110-line minimal example](../guestbook-minimal.ts).

The precise flow is:

1. The generated server accepts a bounded form post and creates a `GuestBookEntry` custom resource.
2. An applik8s-generated TypeScript controller publishes or rejects the entry.
3. The controller renders the latest bounded snapshot into `GuestBook.status.renderedHtml`.
4. The generated server serves that snapshot; a typed Valkey index pages older entries.

The standard Kubernetes control-plane binaries do not render HTML. A custom controller extends Kubernetes with that reconciliation behavior. The example intentionally makes the control-loop model visible; it is not advice to use etcd as a high-write application database.

## Source map

- [app.ts](./app.ts) — assembly entrypoint.
- [config.ts](./config.ts) — one validated local/public profile boundary.
- [resources.ts](./resources.ts) — CRDs and typed index exports.
- [operator.ts](./operator.ts) — controller export.
- [server.ts](./server.ts) — generated-server read model.
- [../guestbook.ts](../guestbook.ts) — canonical complete program and closure-local runtime implementation.

The exported renderer supports host-side previews. Its runtime equivalent remains closure-local intentionally: WASM handlers have no ambient Node module scope. The two implementations are held to the same bounded/escaped contract until imported helper capture is supported. The compiler now parses handler JavaScript with the TypeScript AST, so embedded HTML/CSS/client JavaScript is data and genuine unsupported captures receive an actionable error.

## Local profile

```sh
bun install
bun run build:guestbook
kubectl create namespace guestbook --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f dist/examples/guestbook/typekro/resources.yaml
```

The local profile uses `guestbook.localhost`, HTTP, no DNS provider, and no ACME dependency. Use your local Ingress setup or port-forward the generated Service. It requires no cloud credentials.

## Public profile

cert-manager, external-dns, an Ingress controller, and the referenced issuer are platform prerequisites. Application code does not install them or contain DNS credentials.

```sh
export APPLIK8S_GUESTBOOK_PROFILE=public
export APPLIK8S_GUESTBOOK_DOMAIN=guestbook.example.com
export APPLIK8S_GUESTBOOK_INGRESS_CLASS=nginx
export APPLIK8S_GUESTBOOK_ISSUER_NAME=letsencrypt-prod
export APPLIK8S_GUESTBOOK_ISSUER_KIND=ClusterIssuer
bun run build:guestbook
```

This emits an explicit-host Ingress, cert-manager `Certificate`, external-dns intent, provider nodes/edges, and the derived HTTPS URL in `ApplicationGraph`. DNS status means intent applied; propagation is deliberately reported as unverified.

## Safety and limits

- 4 KiB request-body ceiling and eight mutations per remote address/path/minute.
- 80-character author and 500-character message limits.
- HTML escaping, link rejection, safe generated names, duplicate suppression, and idempotent terminal reconciliation.
- Renderer reads at most 100 entries and writes at most 20 into status; index pages are bounded.
- The inspect endpoint returns a fixed sanitized shape, never a generic Kubernetes proxy.
- Operators should reset or moderate by deleting rejected/old `GuestBookEntry` objects with a reviewed retention policy. Automated TTL deletion is intentionally not claimed by this example yet.

Generated CRDs, RBAC, workloads, Ingress, Certificate, application graph, TypeKro resources, JS bundles, and WASM components are under `dist/examples/guestbook/` after compilation.

See [the launch guide](../../docs/guestbook-show-hn.md) for the technical FAQ, founder comment, and launch checklist.
