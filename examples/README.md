# Examples

`guestbook-start/` is the smallest canonical v0.6 full-stack example. It teaches shared model facades,
app-native Kubernetes event handlers, authenticated SSR, live React queries, `ApplicationHost`,
`app.expose`, cert-manager, and ExternalDNS without a large domain.

`chirp-start/` is the realistic flagship. It is a Twitter-shaped application with native Drizzle models
and relations, direct model commands and views, PostgreSQL command authority, JetStream delivery,
resumable SSE invalidation, rebuildable ClickHouse analytical projections, a Hatchet
moderation workflow, a Kubernetes policy operator, immutable application hosting, and optional managed
TLS/DNS. Its build receipt verifies that the complete graph compiles and that relational-only web hosts
do not accidentally bundle the Kubernetes SDK.

The root examples are retained as focused historical and subsystem demonstrations:

- `guestbook.ts`: legacy v0.2 status-rendered control-plane showcase.
- `tenant-platform.ts`: v0.3–v0.5 application/provider/workflow substrate.
- `imagejob.ts`: minimal SDK/WASM operator closure.

Use GuestBook for the first ten minutes and Chirp for architectural evaluation or real-application
pressure testing.
