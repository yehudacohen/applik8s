# GuestBook launch guide

The canonical v0.6 GuestBook is [`examples/guestbook-start`](../examples/guestbook-start). It is a real
TanStack Start application whose browser, server renderer, generated gateway, Kubernetes model, operator,
and infrastructure are derived from one application graph.

Suggested opening:

> Sign the GuestBook and the browser calls `GuestBookEntry.create(...)`. The generated same-origin gateway
> authenticates the request and creates a custom resource. An app-native `created`/`updated` controller
> publishes authoritative status. SSE invalidation then causes the React query to re-read Kubernetes state.

## What the example proves

- Models are declared once and imported unchanged by browser routes and control-plane code.
- Browser bundles receive generated operation facades, never provider SDKs, credentials, or Kubernetes clients.
- Client-side route loaders can preload through the generated same-origin authority before React mounts.
- SSR executes through the active authenticated Nitro request context; no anonymous loopback fallback exists.
- `app.on(GuestBookEntry, { created, updated })` makes non-HTTP lifecycle behavior visible in application code.
- `ApplicationHost.kubernetes(...)` places the immutable web artifact in the graph.
- `app.expose(...)` can bind local HTTP or explicit cert-manager and ExternalDNS providers for managed HTTPS.
- Loader snapshots hydrate before query subscribers mount, then resumable invalidations trigger authoritative requery.

## Run and inspect

```sh
cd examples/guestbook-start
bun install
bun run build
bun run dev
```

For a public graph:

```sh
APPLIK8S_PUBLIC_HOSTNAME=guestbook.example.com \
APPLIK8S_CERTIFICATE_ISSUER=letsencrypt-prod \
bun run build
```

The public profile declares namespaced Ingress, Certificate, TLS Secret intent, and ExternalDNS annotations.
It does not install or own cluster-wide cert-manager, the issuer, or ExternalDNS.

## Technical boundaries

The GuestBook intentionally uses CRDs so controller behavior is inspectable. High-volume rows, blobs, and
transactional data belong in database, object-storage, and event providers. Reconcile closures compile to
JavaScript-in-WASM components; the web host and gateway are Node workloads. TypeKro owns Kubernetes graph
composition. All emitted CRDs, RBAC, workloads, facades, manifests, JavaScript, and WASM remain inspectable.

## Launch checklist

- [ ] Production build and full Nitro gateway health smoke pass.
- [ ] Browser output passes the server-dependency-zone gate.
- [ ] SSR forwards authentication headers and cookies through the request-scoped query client.
- [ ] Create reaches Published or Rejected and an SSE invalidation causes authoritative requery.
- [ ] Managed HTTPS is tested only when cert-manager, issuer, and ExternalDNS prerequisites exist.
- [ ] Generated resources, graph, bundles, and WASM artifacts are linked to the deployed revision.
- [ ] Every launch claim matches the deployed code; accepted DNS intent is not described as propagated DNS.
