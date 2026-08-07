# applik8s-template-project

This is an Applik8s Agentic Start application built on the official TanStack
Start file-router scaffold. The code in `src/` is ordinary application-owned
TypeScript: edit it freely. The maintained `@applik8s/*` packages provide the
identity, database, workflow, event, object, AI, authority, deployment, and
operations contracts without copying their implementation into this project.

## First working loop

The Starter profile is credential-free and deliberately non-production. It
still uses the same typed provider contracts as Dedicated and External.

```sh
bun run check
bun run deploy       # requires package.json applik8s.context or --context
bun run dev           # web-only process; useful for UI-only work
bun run dev:cluster   # live providers + in-cluster Vite hot reload
bun run status
bun run destroy
```

`bun run dev:cluster` selects `kubernetes/application.developer.yaml`, resolves
OpenRouter and Stripe credentials from the operation host, and applies a
TypeKro aspect that runs Vite in the graph-owned ApplicationHost. Only an
allowlist of source and build files is mounted; `.env`, Git data, and deployment
state never enter the pod. A local Vite process is web-only because routes that
open authenticated database sessions require the cluster services.

Environment-backed credentials are not limited to development. A Dedicated
installation may explicitly set `credentialSource.kind: hostEnvironment` and
use the same `.env`-to-Kubernetes-Secret flow without enabling the hot-reload
aspect. Choose `existingSecret` when credentials are managed outside Applik8s.
In both cases, secret values stay out of YAML, the deployment graph, and Alchemy
state.

The CLI never adopts kubectl's ambient context. Generate with
`--context <name>`, add `applik8s.context` to `package.json`, or pass
`--context <name>` to deployment commands.

## Profiles

- **Starter** is a local, credential-free, non-production system.
- **Developer** keeps Starter-sized stateful services while using live
  OpenRouter and Stripe providers supplied through operation-host bindings.
- **Dedicated** owns production-grade dependencies in the application graph.
- **External** binds explicitly external services and never silently adopts
  their lifecycle.

Profile choice is installation data in `kubernetes/application.yaml`, not an
environment switch. Copyable Dedicated and External examples live beside it.
Provider-specific Ory, Hatchet, Envoy, OpenSearch, Rook, NATS, CNPG, and
ClickHouse settings stay at this installation boundary.

## Where to build

- `src/app.ts` declares the application and installation contract.
- `src/providers.ts` includes the maintained profiles and typed overrides.
- `src/features/**/schema.ts` declares Drizzle-native models once.
- `src/features/**/model.ts` contains views, callbacks, workflows, tools, and
  explicit typed authority.
- `src/routes/` is ordinary TanStack Start UI.
- `src/application.ts` is the compiler-discovered public application facade.
- `kubernetes/` contains editable installation inputs.
- `.applik8s/` and generated Drizzle/route artifacts are inspectable build
  output; do not hand-edit them.

Add a model with `model(...)`, a one-time read with `Model.query(...)` or a
reactive read with `Model.view(...)`, a durable function with `workflow(...)`,
an agent with `application.agent(...)`, and a tool by passing a typed callable
directly. Grant authority explicitly with `Role.can(...)`; reachability never
creates permission.

## Verification and deployment

```sh
bun run typecheck
bun run test
bun run lint
bun run check         # types, graph build, migrations, and focused tests
bun run plan          # inspect .applik8s/deploy before applying
bun run deploy
bun run status
bun run destroy
```

Starter lineage: `agentic@0.7.0`;
generator `@applik8s/start-agentic@0.7.0`;
TanStack CLI `0.70.1`;
TanStack Start `1.168.28`.
