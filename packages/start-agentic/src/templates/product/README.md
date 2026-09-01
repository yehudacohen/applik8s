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
bun run doctor       # read-only project, environment-name, and cluster checks
bun run deploy       # requires package.json applik8s.context or --context
bun run dev           # web-only process; useful for UI-only work
bun run dev:cluster   # credential-free Starter + in-cluster Vite hot reload
bun run dev:live      # OpenRouter + Stripe + the same in-cluster hot reload
bun run status
bun run destroy
```

`bun run dev:cluster` selects the credential-free Starter installation and
applies a TypeKro aspect that runs Vite in the graph-owned ApplicationHost.
`bun run dev:live` selects `kubernetes/application.developer.yaml` and resolves
OpenRouter and Stripe test-mode credentials from the operation host. Remove the
optional `providers.payments` block to keep simulated billing while exercising
live inference. Only an allowlist of source and build files is mounted; `.env`,
Git data, and deployment state never enter the pod. A local Vite process is
web-only because routes that open authenticated database sessions require the
cluster services.

Local source mounting requires a cluster whose nodes share the host filesystem.
Applik8s recognizes OrbStack, Docker Desktop, and Rancher Desktop automatically
and fails before deployment on other contexts. Set
`APPLIK8S_DEVELOPMENT_SHARED_FILESYSTEM=1` only when a different local cluster
provides the same guarantee.

Environment-backed credentials are not limited to development. A Dedicated
installation may explicitly set `credentialSource.kind: hostEnvironment` and
use the same `.env`-to-Kubernetes-Secret flow without enabling the hot-reload
aspect. Choose `existingSecret` when credentials are managed outside Applik8s.
`applik8s deploy` loads application-root `.env` and optional `.env.local` files
in its Node operation host. `.env.local` overrides `.env`; values explicitly
exported by the invoking process take precedence over both. In all cases,
secret values stay out of YAML, the deployment graph, and Alchemy state.

The CLI never adopts kubectl's ambient context. Generate with
`--context <name>`, add `applik8s.context` to `package.json`, or pass
`--context <name>` to deployment commands.

The generated commands also select the `developer` **assembly profile**. That
profile chooses the concrete Kubernetes implementation graph (host, database,
queue, workflows, and other providers). It is independent of the
`spec.profile` **product profile** below, which chooses Starter, Developer,
Dedicated, or External product behavior. The distinction is intentional: the
same product installation can be planned for a different infrastructure
assembly without changing application code or silently guessing a provider.

## Profiles

- **Starter** is a local, credential-free, non-production system.
- **Developer** keeps Starter-sized stateful services while using live
  OpenRouter inference supplied through an operation-host binding. The checked
  in Developer example also selects Stripe test mode; deleting that optional
  payment provider keeps billing simulated.
- **Dedicated** owns production-grade dependencies in the application graph.
- **External** binds explicitly external services and never silently adopts
  their lifecycle.

Billing follows the same profile contract without entering feature code:
Starter is visibly simulated; Developer is simulated unless the optional
payment block selects Stripe test mode; Dedicated requires a live adapter; and
External binds an externally operated payment system. Stripe is the maintained
live adapter, not the application interface. Replace it with
`agenticProfilesWith({ dedicatedPayments, externalPayments })` and keep the
same billing models, views, checkout, plan-change, cancellation, metering, and
entitlement code.

Profile choice is installation data in `kubernetes/application.yaml`, not an
environment switch. Copyable Dedicated and External examples live beside it.
Provider-specific Ory, Hatchet, Envoy, OpenSearch, Rook, NATS, CNPG, and
ClickHouse settings stay at this installation boundary.

## Where to build

- `src/app.ts` declares the application and installation contract.
- `src/providers.ts` includes the maintained profiles and their reviewed
  capacity. Advanced host/provider overrides remain typed and explicit.
- `src/features/**/schema.ts` declares Drizzle-native models once.
- `src/features/**/model.ts` contains views, callbacks, workflows, tools, and
  explicit typed authority.
- `src/routes/` is ordinary TanStack Start UI.
- `src/components/ui/`, `src/lib/utils.ts`, and `components.json` are the
  source-owned shadcn/ui foundation. Extend it with
  `bunx shadcn add <component>` instead of inventing parallel form,
  overlay, menu, or accessibility primitives. Product-specific bounded-state
  components remain in `src/components/ui.tsx`.
- `src/application.ts` is the compiler-discovered public application facade.
- `src/modules.ts` installs provider-neutral conversations, approvals,
  artifacts, evaluations, billing, usage, object storage, and the operations
  control center. Remove a maintained module when the product does not use it;
  feature code never changes providers to do so.
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
bun run doctor        # check prerequisites without reading .env values
bun run plan          # inspect .applik8s/deploy before applying
bun run deploy
bun run status
bun run destroy
```

`test/application.test.ts` is application-owned evidence: it validates model
input and the shape of the credential-free deterministic AI/tool fixture,
inspects the discovered model/view/agent graph, and proves that inferred
transport did not create anonymous authority. The maintained product browser
gate exercises the assistant and tool path end to end.

Starter lineage: `agentic@0.8.0`, tracked in `.applik8s-start.json` for
deterministic three-way update reporting;
generator `@applik8s/start-agentic@0.7.0`;
TanStack CLI `0.70.1`;
TanStack Start `1.168.28`.
