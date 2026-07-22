# GuestBook TanStack Start application

This is the v0.6 application shape:

- one shared application/model declaration is imported by operators and routes;
- `ApplicationHost.kubernetes()` hosts the web artifact as part of the application graph;
- the browser receives a generated facade for the same `./application` module specifier;
- `GuestBookEntry.create.useMutation()` is callable and preserves transport, durable-result, and observation state separately;
- published entries use the framework query/SSE client rather than operator-rendered HTML;
- `app.expose()` targets the hydrated host Service and optionally adds cert-manager and ExternalDNS intent.

The project shape is generated from the official TanStack Start CLI and uses the official Nitro
deployment adapter through `applik8sStart()`. Vite builds are pure. Cluster mutation remains an
explicit step:

```sh
bun run deploy:local
```

That command builds the web artifact, compiles the complete TypeKro graph, builds generated
operator images in the local container engine, and applies the root instance to the explicitly named
`orbstack` context.

The prerelease lane runs the example with a unique `APPLIK8S_APPLICATION_NAME` and namespace, proves
publish and rejection behavior plus SSR/SSE/restart recovery, deletes the root through
`factory.deleteInstance()`, and only then removes the externally managed cursor Secret and disposable
namespace.
