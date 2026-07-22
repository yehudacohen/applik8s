# RFP: Framework-Neutral Vite Applications, Callable Models, and TanStack Start

**Status:** Implemented and qualified release candidate; maintainer review pending

**Audience:** Applik8s maintainers and implementing agents

**Requested by:** The GuestBook flagship application and future full-stack Applik8s applications

**Revised:** 2026-07-16

**Target:** Applik8s v0.6 release; every child implementation gate and the complete GuestBook proof are
required before the release is tagged

## Implementation status

The framework-neutral architecture in this RFP is implemented on the v0.6 work branch:

- `@applik8s/vite` discovers the application graph, emits browser/server model facades, enforces the
  browser dependency zone, generates the Fetch gateway, and records immutable artifact metadata;
- `RequestIdentity` adapts application-owned authentication into principal, trusted context, and
  authorization-version admission;
- Kubernetes-backed models can declare authorized creation and bounded named views with
  list/resource-version/watch snapshot-resume semantics;
- direct callable operations and callable React mutation state are generated from graph metadata;
- `@applik8s/tanstack-start` is a thin Nitro/SSR adapter over those framework-neutral contracts;
- `ApplicationHost.kubernetes(...)` emits an OCI build context and inferred Kubernetes workload;
- the GuestBook is a real TanStack Start project whose operator owns moderation status while the UI owns
  rendering.

The executable local qualification lane and complete OrbStack GuestBook path described below pass. This
status does not declare v0.6 released or freeze the API before maintainer review.

## Executive summary

Applik8s v0.6 establishes the substrate for native Drizzle and Kubernetes models, durable commands,
authenticated queries, resumable invalidation, browser-safe clients, React integration, and TanStack Start
SSR hydration. The current `@applik8s/tanstack-start` package is intentionally smaller: it preloads query
snapshots for route loaders and hydrates a client. The current GuestBook still uses a generated
`app.server(...)` workload and stores a complete HTML document in Kubernetes status.

That is no longer the desired flagship developer experience.

This RFP makes a Vite project a native Applik8s application client and, when paired with a server-capable
host, an Applik8s application host. TanStack Start is the flagship first-party adapter rather than the
architectural boundary. Models, operators, routes, components, provider bindings, infrastructure, and
exposure may still be authored in one TypeScript project, but the authenticated gateway, operation
manifest, browser protocol, and React bindings remain framework-neutral.
The same promoted model value is imported by operator code, server loaders and actions, React components,
Drizzle queries, and tests. Ordinary application code invokes model capabilities directly:

```ts
await GuestBookEntry.create(input);
```

React code receives an awaitable callable mutation rather than a TanStack-shaped object that requires
`.mutate(...)`:

```ts
const createEntry = GuestBookEntry.create.useMutation();
await createEntry(input);
```

The common path does not require `GuestBookEntry.$model.command(...)`, a handwritten public gateway,
duplicated browser models, a deployment configuration DSL, or manually wired Kubernetes Deployments,
Services, RBAC, Secrets, endpoints, and readiness dependencies.

Dependency injection remains code. `app.provide(Interface, implementation)` binds a provider,
materializes its infrastructure as an application-graph side effect, exposes hydrateable outputs, and
installs the corresponding runtime capability into consumers. A new `ApplicationHost` capability binds
the current TanStack Start build to a Kubernetes implementation. The Applik8s Vite plugin produces a
server artifact and browser-safe model facade; `applik8s deploy` remains the only cluster mutation
authority.

The generic gateway consumes standard Web `Request` values and returns standard Web `Response` values.
`app.provide(RequestIdentity, implementation)` adapts an application-owned identity system into principal,
trusted-context, and authorization-version admission. Applik8s owns validation, scoping, cursor integrity,
and provider enforcement, but it does not own login, sessions, users, organizations, membership, or
application policy. TanStack Start mounts this gateway in-process and adds SSR/dehydration conveniences;
other Vite servers mount the same gateway, while static Vite clients target a separately deployed instance.

The GuestBook migrates to this shape. The operator owns domain state and status transitions, not HTML or
browser connections. The TanStack application server-renders an authoritative query snapshot, hydrates
without a duplicate request, subscribes to resumable SSE invalidations, requeries after the operator
publishes or rejects an entry, and rerenders React. The final live test must exercise the complete path
from browser command through durable processing and Kubernetes reconciliation to SSE invalidation and
client requery without manually inserting change records or public events.

## Normative decisions

The implementation must preserve these decisions unless a reviewed ADR demonstrates an equally simple
and safer design.

1. **The authored application graph is framework-neutral.** A TanStack Start project may contain the
   complete application, but no model, gateway, identity, authorization, cursor, or provider contract may
   require TanStack.
2. **One source-level model value is shared everywhere.** Operator, server, browser, Drizzle, test, and
   graph-authoring code import the same model contract. Build-time partitioning supplies environment-safe
   implementations without duplicating schemas.
3. **`$model` is not the ordinary API.** It may remain an internal or advanced compatibility facet, but
   normal creation, updates, actions, queries, references, and relations use direct model members.
4. **Conventional persistence actions are synthesized.** A writable model with declared creation access
   gains a typed `Model.create(...)` action. Update and delete follow the same rule when enabled. Missing
   authorization or persistence capability fails closed.
5. **Custom actions become direct methods.** Declaring an `approve` action produces
   `Invitation.approve(...)`, not a generic command lookup at the call site.
6. **React mutations are callable and awaitable.** `Model.create.useMutation()` returns a function object
   with reactive state properties. TanStack Query may implement the lifecycle internally, but its
   `.mutate(...)` invocation shape is not exposed.
7. **Queries are model-native.** Bounded model queries and named views are declared beside the shared
   model and invoked from TanStack loaders and components without a separately wired gateway contract.
8. **The framework-neutral client remains authoritative.** TanStack Query is an optional lifecycle/cache
   adapter. Applik8s continues to own protocol validation, cursor identity, snapshot/resume semantics,
   reset behavior, and subscription state.
9. **The Fetch gateway is the public boundary.** Generated query, command, progress, replay, and SSE
   endpoints use a framework-neutral `Request -> Response` runtime. The Start server mounts it by default;
   a standalone gateway and other Vite server adapters remain supported topologies.
10. **`provide()` is the dependency-injection mechanism.** A separate provider configuration language or
    `providers: { ... }` deployment registry is forbidden.
11. **Provider handles are hydrateable and usable.** A binding exposes graph-time resource/status outputs
    and environment-appropriate runtime operations. Browser facades omit server-only capabilities.
12. **The application host is a provider.** `ApplicationHost.kubernetes(...)` materializes the current
    immutable Vite server artifact as a Deployment, Service, ServiceAccount, RBAC bundle, health contract,
    and image. TanStack Start is the first qualified server artifact, not a provider-interface requirement.
13. **Provider consumption is inferred.** Models, views, actions, operators, and the host declare capability
    requirements. The nearest unambiguous `provide()` satisfies them without manually passing every
    provider handle through application code.
14. **Vite builds are side-effect free.** The Vite plugin partitions and builds artifacts; it never deploys
    or mutates Kubernetes. `applik8s deploy` composes and deploys the complete graph.
15. **Start project structure follows upstream.** The first-party example and generated fixtures begin
    from the official TanStack Start CLI/Nitro generator output. Applik8s adds application semantics
    through plugins and ordinary source files instead of maintaining a competing router/build scaffold.
16. **Cluster selection is operational.** Kubernetes contexts and credentials do not enter application
    source or browser artifacts. The CLI selects the target context.
17. **Operators do not own browser SSE connections.** Operators update authoritative domain state or emit
    durable domain events. The application gateway converts safe change information into authenticated,
    resumable browser delivery.
18. **Invalidation precedes incremental patches.** A changed dependency invalidates a query and triggers an
    authoritative requery. The framework does not invent diffs for arbitrary SQL or Kubernetes reads.
19. **GuestBook status does not contain HTML.** Small domain status, counters, revisions, and reconciliation
    evidence are acceptable. Page markup belongs to TanStack/React.
20. **Build partitioning fails closed.** Drizzle implementations, Kubernetes clients, TypeKro objects,
    provider SDKs, secrets, operator closures, and server authorization code must never enter browser
    bundles.
21. **The complete live path is release evidence.** Infrastructure-only and manually seeded event tests do
    not satisfy this RFP.
22. **One public module specifier resolves to environment-specific facades.** Application code imports a
    model through the same authored module specifier in server and browser code. The build resolves that
    contract to server/operator or browser implementations without changing the source-level API.
23. **Awaited creation means authoritative persistence, not downstream convergence.**
    `await Model.create(input)` completes only after the durable command reaches a successful terminal
    result and returns the authoritative created model snapshot. Operator reconciliation, projections,
    dependent-query revalidation, and browser rendering remain separately observable.

## Existing functionality that must be reused

| Capability | Existing behavior to preserve |
| --- | --- |
| Application graph | Providers, models, queries, commands, subscriptions, resources, generated artifacts, dependencies, and authorities already have graph nodes and edges. |
| Provider DI | `app.defaults(...)` and `app.provide(...)` bind typed capability implementations and emit provider requirements/bindings. |
| Kubernetes resources | CRDs retain typed actions, reconcile registration, status, metadata, permissions, and watch behavior. |
| Native relational models | Promoted Drizzle tables remain native tables with derived schemas, relations, identity, revision, changes, and transaction semantics. |
| Durable commands | Idempotency, ordering, results, progress, retries, rejection, history, outboxes, and JetStream processing already exist. |
| Query gateway | Authenticated snapshots, cursors, bounded SSE invalidation, authorization-version reset, and retention reset already exist. |
| Framework-neutral client | Browser-safe query and command clients own transport-independent state and protocol validation. |
| React integration | Shared external-store integration remains the router-neutral base. |
| TanStack seam | Loader prefetch and hydration helpers already exist in `@applik8s/tanstack-start`. |
| Application servers | Applik8s already generates Services, Deployments, RBAC, config/secret mounts, health probes, routes, and provider runtime environment. |
| Exposure | `app.expose(...)`, `HttpExposure`, `Certificate`, and `DnsPublication` already lower public edge intent. |
| TypeKro | Application infrastructure is emitted and deployed through the existing TypeKro composition/factory path. |

This RFP must not create another provider registry, application graph, command processor, public protocol,
query cache authority, Kubernetes deployment engine, or frontend router.

## Problem statement

### The current TanStack package is an adapter seam

The released package can preload a query into a request-scoped client and serialize hydration state. It
does not discover a Start application, build it, materialize it as Kubernetes infrastructure, mount the
generated gateway, inject providers, partition shared models, manage same-origin browser transport, or
subscribe hydrated queries to invalidations.

### The current model surface leaks implementation structure

`Model.$model.command('create', ...)` exposes an implementation facet and asks application developers to
think in framework registration primitives at ordinary call sites. A browser or server action should be
able to call `Model.create(input)`. React should retain mutation lifecycle state without forcing
`mutation.mutate(input)`.

### Separate browser contracts create schema and relationship drift

Hand-authored frontend interfaces inevitably diverge from ArkType schemas, Drizzle tables, relations,
model identities, access policy, and command results. Importing the complete server/application module
into a browser is not a solution because it can pull server implementations and secrets across the trust
boundary.

The required outcome is one source-level contract with compiler-generated environment facades.

### Deployment configuration is not dependency injection

A standalone object such as `providers: { indexes: valkey(), events: jetstream() }` records choices but
does not embody the intended provider semantics. An Applik8s provider should be an infrastructure-producing
binding with hydrateable outputs and runtime behavior. Ordinary TypeScript `provide()` calls are more
composable, inspectable, and consistent with the existing framework.

### GuestBook currently renders in the wrong place

The current operator constructs and writes an entire HTML document into `GuestBook.status.renderedHtml`.
The generated server reads that field and serves it. This proves authoritative status and generated
servers, but it prevents the flagship example from demonstrating shared application models, SSR query
preload, browser hydration, callable mutations, authenticated SSE invalidation, React rerendering, and
transparent Start deployment.

## Target repository and application shape

The migrated example should be a normal TanStack Start project contained by the repository:

```text
examples/guestbook-start/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── src/
│   ├── app.ts
│   ├── application.ts
│   ├── models.ts
│   ├── routes/
│   │   ├── __root.tsx
│   │   ├── index.tsx
│   │   ├── healthz.tsx
│   │   └── readyz.tsx
│   └── styles.css
└── test/
    ├── guestbook.browser.test.ts
    ├── guestbook.ssr.test.ts
    └── guestbook.application.test.ts
```

Generated browser facades, server bootstrap modules, manifests, Dockerfiles, Kubernetes YAML, and TypeKro
artifacts belong under ignored build output. They are not source files the developer maintains.

## Developer experience by file

The following sketches are illustrative but intentionally complete enough to constrain implementation.
Names may be refined during the prototype gate; the absence of duplicate models, explicit gateway wiring,
provider configuration objects, `.mutate(...)`, and HTML-in-status is normative.

### `package.json`

The example is a real Start application and uses the workspace packages exactly as an external consumer
would use published packages.

```json
{
  "name": "@applik8s/example-guestbook",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "deploy:local": "applik8s deploy --context orbstack",
    "test": "vitest run"
  },
  "dependencies": {
    "@applik8s/applik8s": "workspace:*",
    "@applik8s/client": "workspace:*",
    "@applik8s/react": "workspace:*",
    "@applik8s/tanstack-start": "workspace:*",
    "@tanstack/react-query": "^5",
    "@tanstack/react-router": "^1",
    "@tanstack/react-start": "^1",
    "arktype": "^2",
    "react": "^19",
    "react-dom": "^19"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^latest",
    "vite": "^latest",
    "vitest": "^latest"
  }
}
```

The implementation should pin versions according to repository policy rather than literally publishing
`latest` ranges.

### `vite.config.ts`

The Applik8s plugin is a build adapter, not a deployment configuration language or cluster client.

```ts
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { applik8sStart } from '@applik8s/tanstack-start/vite';

export default defineConfig({
  plugins: [
    tanstackStart(),
    applik8sStart({ application: './src/application.ts' }),
    react(),
  ],
});
```

The conventional `src/application.ts` path may make the option unnecessary. An explicit override remains
useful for monorepos. The plugin must not accept provider, namespace, replica, exposure, Secret, or
Kubernetes-context configuration.

### `src/app.ts`

This module is the dependency root. It must not import models, operators, routes, or components.

```ts
import { app as defineApplication, RequestIdentity } from '@applik8s/applik8s';
import { authenticateGuestBookRequest } from './auth';

export const app = defineApplication('guestbook', { namespace: 'guestbook' });
app.provide(RequestIdentity, RequestIdentity.from(authenticateGuestBookRequest));
```

### `src/application.ts`

This is the discovery and infrastructure-from-code entrypoint. The application context itself lives in a
small dependency-root module so model modules never import through a barrel that statically imports them.
The entrypoint imports every model and operator for registration, binds providers, and exposes the current
Start host.

```ts
import { Certificate, DnsPublication } from '@applik8s/applik8s';
import { app } from './app';
import { provideGuestBookInfrastructure } from './infrastructure';
import { GuestBook } from './models/guestbook';
import { GuestBookEntry } from './models/guestbook-entry';
import { GuestBookPageViewBucket } from './models/page-view-bucket';
import './operators/moderate-entry';

export const host = provideGuestBookInfrastructure(app);

if (process.env.APPLIK8S_PUBLIC_HOSTNAME) {
  app.provide(
    Certificate,
    Certificate.certManager({
      issuerRef: {
        name: process.env.APPLIK8S_CERTIFICATE_ISSUER ?? 'letsencrypt-prod',
        kind: 'ClusterIssuer',
      },
    }),
  );
  app.provide(DnsPublication, DnsPublication.externalDns());
}

app.expose('web', {
  service: host,
  hostnames: [process.env.APPLIK8S_PUBLIC_HOSTNAME ?? 'guestbook.localhost'],
  tls: { mode: process.env.APPLIK8S_PUBLIC_HOSTNAME ? 'managed' : 'disabled' },
  dns: { mode: process.env.APPLIK8S_PUBLIC_HOSTNAME ? 'managed' : 'disabled' },
});

export { app, GuestBook, GuestBookEntry, GuestBookPageViewBucket };
```

Environment branching is ordinary graph-authoring TypeScript evaluated by the compiler. It must be
recorded in artifact provenance. Kubernetes contexts and credentials are still CLI concerns.

### `src/infrastructure.ts`

Infrastructure is provided with code. The module may be replaced by another ordinary module for a
production entrypoint; it is not interpreted as a separate configuration DSL.

```ts
import {
  ApplicationHost,
  EventLog,
  IndexStore,
  type KubernetesApplicationBuilder,
} from '@applik8s/applik8s';

export function provideGuestBookInfrastructure(app: KubernetesApplicationBuilder) {
  const host = app.provide(
    ApplicationHost,
    ApplicationHost.kubernetes({
      namespace: process.env.APPLIK8S_NAMESPACE ?? 'guestbook',
      replicas: Number(process.env.APPLIK8S_WEB_REPLICAS ?? '1'),
      resources: {
        requests: { cpu: '100m', memory: '128Mi' },
        limits: { memory: '256Mi' },
      },
    }),
  );

  app.provide(
    IndexStore,
    IndexStore.valkey({
      persistence:
        process.env.APPLIK8S_INDEX_STORAGE === 'persistent'
          ? { size: '10Gi' }
          : 'ephemeral',
    }),
  );

  app.provide(
    EventLog,
    EventLog.jetstream({
      replicas: Number(process.env.APPLIK8S_EVENT_REPLICAS ?? '1'),
      storage: { size: process.env.APPLIK8S_EVENT_STORAGE ?? '2Gi' },
    }),
  );

  return host;
}
```

The provider calls must produce graph nodes and bindings. They must not open network connections while
the application module is discovered.

### `src/auth.ts`

TanStack Start hosts the public boundary, but Applik8s retains the admitted-context and authorization
contract.

```ts
import { RequestIdentity } from '@applik8s/applik8s';

export const guestBookIdentity = RequestIdentity.from(async (request) => {
  const session = await readApplicationSession(request);

  return {
    principal: {
      id: session?.subject ?? 'guestbook-demo',
    },
    authorizationVersion: session?.authorizationVersion ?? 'demo-v1',
    trustedContext: {
      guestbook: 'main',
      namespace: 'guestbook',
      role: session?.role ?? 'author',
    },
  };
});
```

`src/app.ts` installs this authority with `app.provide(RequestIdentity, guestBookIdentity)`. Authentication
is an application capability; the TanStack package only adapts Nitro's current request context to the
framework-neutral server runtime.

The demo may use a clearly labeled local identity implementation. Public mode must not silently grant
anonymous mutation permissions.

### `src/models.ts` — GuestBook

The promoted resource retains Kubernetes behavior and gains direct common-model methods.

```ts
import { entity } from '@applik8s/applik8s/dsl';
import { type } from 'arktype';
import { app } from './app';

const GuestBookEntity = entity('GuestBook', {
  spec: type({
    title: 'string',
    'description?': 'string',
  }),
  status: type({
    "phase?": "'Pending' | 'Ready' | 'Degraded'",
    'publishedCount?': 'number',
    'contentRevision?': 'string',
    'lastPublishedAt?': 'string',
    'message?': 'string',
  }),
});

export const GuestBook = app.crd(GuestBookEntity, {
  apiVersion: 'guestbook.applik8s.dev/v1alpha1',
});
```

There is deliberately no `renderedHtml` status property.

### `src/models.ts` — GuestBookEntry

Creation is conventional persistence, not a separately named command at the call site. Namespace and
resource name are server-owned placement/identity concerns rather than browser input.

```ts
import { entity } from '@applik8s/applik8s/dsl';
import { type } from 'arktype';
import { app } from './app';

const GuestBookEntryEntity = entity('GuestBookEntry', {
  spec: type({
    guestbook: 'string',
    author: 'string > 0 & string <= 80',
    message: 'string > 0 & string <= 500',
  }),
  status: type({
    "phase?": "'Pending' | 'Published' | 'Rejected'",
    'publishedAt?': 'string',
    'rejectedAt?': 'string',
    'reason?': 'string',
    'fingerprint?': 'string',
  }),
});

const GuestBookEntryResource = app.crd(GuestBookEntryEntity, {
  apiVersion: 'guestbook.applik8s.dev/v1alpha1',
  create: {
    place: ({ context, input }) => ({
      namespace: String(context.namespace),
      generateName: `${input.guestbook}-entry-`,
      labels: { 'guestbook.applik8s.dev/book': input.guestbook },
    }),
    authorize: ({ context, input }) =>
      context.role !== 'reader' && context.guestbook === input.guestbook,
  },
});

export const GuestBookEntry = GuestBookEntryResource.view('published', {
  input: type({ guestbook: 'string', 'limit?': '1 <= number.integer <= 50' }),
  output: type({
    id: 'string',
    author: 'string',
    message: 'string',
    publishedAt: 'string',
  }).array(),

  authorize: ({ context, input }) => context.guestbook === input.guestbook,

  query: ({ input }) =>
    GuestBookEntry.indexes.publishedByBookNewest
      .partition(input.guestbook)
      .limit(input.limit ?? 20)
      .select((entry) => ({
        id: entry.metadata.name,
        author: entry.spec.author,
        message: entry.spec.message,
        publishedAt: entry.status.publishedAt,
      })),
});
```

The precise ArkType length syntax should follow the version pinned by the implementation. The public
contract is that the create input and view output derive from the authoritative model declarations rather
than a manually duplicated frontend interface.

### `src/models/page-view-bucket.ts`

The page-view model remains a bounded control-plane demonstration. The browser does not write counters
directly; a generated server-side action performs a bucketed atomic increment.

```ts
import { sdk } from '@applik8s/applik8s';
import { type } from 'arktype';
import { app } from '../app';

const PageViewBucketResource = sdk.crd({
  apiVersion: 'guestbook.applik8s.dev/v1alpha1',
  kind: 'GuestBookPageViewBucket',
  spec: type({
    guestbook: 'string',
    windowStart: 'string',
    count: 'number.integer >= 0',
  }),
  status: type({
    'observedCount?': 'number.integer >= 0',
    'observedAt?': 'string',
  }),
});

export const GuestBookPageViewBucket = app.model(PageViewBucketResource, {
  access: {
    read: ({ context, value }) =>
      context.guestbook === value.spec.guestbook && context.role === 'moderator',
  },

  actions: {
    recordView: {
      input: type({ guestbook: 'string' }),
      authorize: ({ context, input }) => context.guestbook === input.guestbook,
      run: async ({ input, clock }) => {
        const windowStart = minuteWindow(clock.now());
        await GuestBookPageViewBucket.increment({
          id: `${input.guestbook}-${compactWindow(windowStart)}`,
          create: { guestbook: input.guestbook, windowStart, count: 0 },
          field: 'spec.count',
          by: 1,
        });
      },
    },
  },
});
```

The implementation should reuse the existing counter/increment provider requirement. The action's call to
`increment(...)` is what declares consumption; the application should not manually pass a counter provider.

### `src/operators/moderate-entry.ts`

The operator imports the same model value and owns domain transitions. It does not render HTML or open
SSE connections.

```ts
import { GuestBook } from '../models/guestbook';
import { GuestBookEntry } from '../models/guestbook-entry';

GuestBookEntry.on.reconcile(async (entry) => {
  const normalized = entry.spec.message.trim().replace(/\s+/g, ' ');

  if (/https?:\/\//i.test(normalized)) {
    entry.status.phase = 'Rejected';
    entry.status.rejectedAt = new Date().toISOString();
    entry.status.reason = 'Links are disabled for this GuestBook.';
    return;
  }

  entry.status.phase = 'Published';
  entry.status.publishedAt = new Date().toISOString();
  entry.status.fingerprint = stableEntryFingerprint({
    guestbook: entry.spec.guestbook,
    author: entry.spec.author,
    message: normalized,
  });

  await GuestBook.patchStatus(
    {
      id: entry.spec.guestbook,
      namespace: entry.metadata.namespace,
    },
    {
      phase: 'Ready',
      contentRevision: entry.metadata.resourceVersion,
      lastPublishedAt: entry.status.publishedAt,
    },
  );
});
```

If status increments require atomic counters, the example must use the existing counter/increment
primitive rather than a read-modify-write race.

### `src/routes/__root.tsx`

The root installs the generated Applik8s hydration boundary. It does not create provider clients manually.

```tsx
import { Outlet, createRootRoute } from '@tanstack/react-router';
import { Applik8sProvider } from '@applik8s/react';

export const Route = createRootRoute({
  component: () => (
    <Applik8sProvider>
      <Outlet />
    </Applik8sProvider>
  ),
});
```

The Vite plugin supplies the browser transport, dehydrated snapshots, same-origin base path, and
subscription bootstrap to this provider.

### `src/routes/index.tsx`

The query is used in the TanStack project. The route loader and component share the same stable operation
and cache identity.

```tsx
import { createFileRoute } from '@tanstack/react-router';
import { GuestBookEntry } from '../models/guestbook-entry';
import { GuestBookPage } from '../components/GuestBookPage';

const publishedEntries = GuestBookEntry.published({
  guestbook: 'main',
  limit: 20,
});

export const Route = createFileRoute('/')({
  loader: () => publishedEntries.preload(),
  component: () => {
    const entries = publishedEntries.useSuspenseQuery();
    return <GuestBookPage entries={entries.data} />;
  },
});
```

After hydration, `useSuspenseQuery()` subscribes to the query's resumable invalidation channel. An
invalidation triggers an authoritative refetch. The loader snapshot is not fetched twice.

### `src/components/GuestBookPage.tsx`

The component renders ordinary React from query data.

```tsx
import { GuestBookForm } from './GuestBookForm';
import { EntryList } from './EntryList';

export function GuestBookPage({ entries }: {
  readonly entries: readonly {
    readonly id: string;
    readonly author: string;
    readonly message: string;
    readonly publishedAt: string;
  }[];
}) {
  return (
    <main>
      <h1>This UI reacts to the Kubernetes control plane.</h1>
      <p>
        The initial list was server-rendered. Published entry changes arrive as
        resumable invalidations and requery authoritative state.
      </p>
      <GuestBookForm guestbook="main" />
      <EntryList entries={entries} />
    </main>
  );
}
```

### `src/components/EntryList.tsx`

The list is intentionally ordinary React and has no Kubernetes or transport knowledge.

```tsx
export function EntryList({ entries }: {
  readonly entries: readonly {
    readonly id: string;
    readonly author: string;
    readonly message: string;
    readonly publishedAt: string;
  }[];
}) {
  return (
    <ol aria-live="polite">
      {entries.map((entry) => (
        <li key={entry.id}>
          <strong>{entry.author}</strong>
          <time dateTime={entry.publishedAt}>{entry.publishedAt}</time>
          <p>{entry.message}</p>
        </li>
      ))}
    </ol>
  );
}
```

### `src/components/GuestBookForm.tsx`

The mutation is callable and awaitable. It retains lifecycle state as properties on the function object.

```tsx
import { useState } from 'react';
import { GuestBookEntry } from '../models/guestbook-entry';

export function GuestBookForm({ guestbook }: { readonly guestbook: string }) {
  const [author, setAuthor] = useState('');
  const [message, setMessage] = useState('');
  const createEntry = GuestBookEntry.create.useMutation();

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        await createEntry({ guestbook, author, message });
        setMessage('');
      }}
    >
      <input
        value={author}
        onChange={(event) => setAuthor(event.target.value)}
        disabled={createEntry.pending}
      />
      <textarea
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        disabled={createEntry.pending}
      />
      <button disabled={createEntry.pending}>
        {createEntry.pending ? 'Submitting…' : 'Sign the GuestBook'}
      </button>
      {createEntry.error ? <p role="alert">{createEntry.error.message}</p> : null}
    </form>
  );
}
```

The command result may initially report durable command acceptance before reconciliation publishes the
entry. The subsequent query invalidation is what makes the published card appear. Command progress and
reconciliation progress remain distinct.

### `src/routes/entries.$name.tsx`

Server and browser reads use the same model while enforcing admitted context:

```tsx
import { createFileRoute } from '@tanstack/react-router';
import { GuestBookEntry } from '../models/guestbook-entry';

export const Route = createFileRoute('/entries/$name')({
  loader: ({ params }) => GuestBookEntry.get.preload({ id: params.name }),
  component: () => {
    const entry = GuestBookEntry.get.useSuspenseQuery({
      id: Route.useParams().name,
    });
    return <pre>{JSON.stringify(entry.data, null, 2)}</pre>;
  },
});
```

The client facade cannot choose a namespace, Kubernetes connection, database, or provider credential.
Placement and trusted context are server-owned.

### `test/guestbook.application.test.ts`

The application test proves the normalized graph and dependency injection without deploying a cluster:

```ts
import { describe, expect, test } from 'vitest';
import { applicationGraphFor } from '@applik8s/applik8s';
import { app, host } from '../src/application';

describe('GuestBook application graph', () => {
  test('binds the Start host and inferred dependencies', () => {
    const graph = applicationGraphFor(app.composition);

    expect(host.kind).toBe('applicationHost');
    expect(graph?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'provider', interface: 'ApplicationHost' }),
      expect.objectContaining({ kind: 'query', name: 'GuestBookEntry.published' }),
    ]));
    expect(graph?.providerRequirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ interface: 'IndexStore', purpose: 'queryInvalidation' }),
    ]));
  });
});
```

Assertions inspect the real normalized graph API rather than a framework-specific testing facade or YAML
text fragments.

### `test/guestbook.ssr.test.ts`

The SSR test proves one authoritative request, safe dehydration, hydration reuse, and subscription start:

```ts
import { expect, test } from 'vitest';
import { hydrateApplicationQueries, preloadApplicationQuery } from '@applik8s/client';

test('SSR snapshot hydrates without a duplicate fetch', async () => {
  const server = createGuestBookQueryClient({
    published: [{ id: 'ada', author: 'Ada', message: 'Hello', publishedAt: now }],
  });
  const initial = await preloadApplicationQuery(server, 'GuestBookEntry.published', {
    guestbook: 'main',
  });

  const browser = createGuestBookQueryClient();
  hydrateApplicationQueries(browser, initial);
  expect(browser.query('GuestBookEntry.published', { guestbook: 'main' }).getSnapshot().data)
    .toEqual(initial.applik8s[0]?.value);

  // Mounting the route under <Applik8sProvider queryClient={browser}> now
  // reuses the hydrated snapshot and starts the resumable subscription.
});
```

### `test/guestbook.browser.test.ts`

The browser test exercises the authored UI. The repository live suite owns deployment setup and teardown;
this fixture receives its URL.

```ts
import { expect, test } from '@playwright/test';

test('created entries appear after operator publication and SSE invalidation', async ({ page }) => {
  await page.goto(process.env.GUESTBOOK_BASE_URL!);
  await expect(page.getByText('Ada')).toBeVisible();

  await page.getByLabel('Your name').fill('Lin');
  await page.getByLabel('Message').fill('The model is shared end to end.');
  await page.getByRole('button', { name: 'Sign the GuestBook' }).click();

  await expect(page.getByText('Submitting…')).toBeVisible();
  await expect(page.getByText('Lin')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText('The model is shared end to end.')).toBeVisible();
});
```

The live harness separately proves the Kubernetes resource, command progress, operator status, SSE cursor,
requery, restart behavior, and TypeKro lifecycle rather than relying only on the final DOM assertion.

## Callable operation contract

### Direct invocation

Every model operation is a typed callable value:

```ts
export interface ApplicationOperation<TInput, TOutput> {
  (input: TInput): Promise<TOutput>;
  readonly id: string;
  readonly input: RuntimeSchema<TInput>;
  readonly output: RuntimeSchema<TOutput>;
}
```

The implementation dispatches according to the active environment:

| Environment | Direct operation behavior |
| --- | --- |
| Browser | Sends a same-origin typed command/query request. |
| TanStack loader/action | Uses the admitted request-scoped server runtime. |
| Operator handler | Uses the handler capability runtime and declared permissions. |
| Durable command processor | Uses the transaction-scoped model runtime. |
| Test | Uses the injected deterministic test runtime. |
| Graph discovery | Records/validates metadata; opening provider connections is forbidden. |

Calling a runtime operation when no appropriate runtime is active fails with an actionable diagnostic.

For a conventional create operation:

```ts
const entry = await GuestBookEntry.create(input);
```

The resolved promise proves:

- transport submission either succeeded directly in a trusted server runtime or was recovered through
  the durable command protocol
- authorization and input validation succeeded
- the durable result reached a terminal successful state
- the authoritative provider persisted the model
- `entry` is the authoritative created model snapshot, including identity and revision when available

It does not prove:

- an operator observed or reconciled the model
- status reached a domain-ready state
- a workflow, projection, or external effect completed
- dependent queries revalidated
- every subscribed client rendered the result

Downstream observation remains explicit:

```ts
const entry = await GuestBookEntry.create(input);

await GuestBookEntry
  .observe(entry.identity)
  .when((current) => current.status.phase !== 'Pending');
```

The exact observation API may change during implementation, but plain snapshots remain serializable data;
they do not acquire hidden network connections or mutable observation behavior.

### Callable mutation hook

```ts
export interface ApplicationMutation<TInput, TOutput> {
  (input: TInput): Promise<TOutput>;
  readonly pending: boolean;
  readonly paused: boolean;
  readonly data: TOutput | undefined;
  readonly error: Error | undefined;
  readonly submittedAt: number | undefined;
  readonly transport:
    | 'idle'
    | 'submitting'
    | 'acknowledged'
    | 'failed';
  readonly durableResult:
    | 'unknown'
    | 'pending'
    | 'succeeded'
    | 'rejected'
    | 'failed';
  readonly observation:
    | { readonly state: 'notDeclared' }
    | { readonly state: 'pending'; readonly identity: unknown }
    | { readonly state: 'matched'; readonly snapshot: unknown }
    | { readonly state: 'failed'; readonly error: Error };
  reset(): void;
}

export interface ApplicationMutationOperation<TInput, TOutput>
  extends ApplicationOperation<TInput, TOutput> {
  useMutation(options?: ApplicationMutationOptions<TInput, TOutput>):
    ApplicationMutation<TInput, TOutput>;
}
```

The adapter may use TanStack Query's mutation observer internally. The returned callable invokes the
promise-returning mutation path so `await mutation(input)` has normal exception semantics. Hook callbacks,
optimistic state, serialization scope, retry policy, command cursor/progress, and reset behavior remain
available through typed options and properties without exposing `.mutate` or `.mutateAsync`.

`rejected` is a declared domain outcome with its typed rejection payload. `failed` is a terminal processing
outcome recorded only after bounded retries are exhausted; clients receive the redacted
`processing_failed` contract rather than worker, database, or provider error detail. Both are durable and
stop cursor polling. A transport failure remains distinct because it does not prove whether the command
committed.

`observation` is `notDeclared` unless the operation explicitly declares one authoritative downstream
condition. The framework must not invent one generic reconciliation phase for actions with multiple or no
downstream controllers.

### Conventional persistence actions

`create`, `update`, and `delete` exist only when all required contracts are present:

- the provider supports the operation
- a runtime input schema can be derived or is declared
- placement/identity is deterministic or explicitly generated
- authorization is declared
- server-owned fields are excluded from browser input
- idempotency and command result semantics are available
- the action can participate in the existing authoritative transaction/command kernel

The compiler fails closed rather than generating an unsafe method. Custom actions are declared under the
model and materialized as direct named operations.

## Shared model and build-partition contract

The phrase "same model" means one source declaration and one TypeScript contract, not one identical
runtime object copied into every bundle.

The public invariant is stronger than source-level similarity:

> Importing a model from application code uses the same authored module specifier in server and browser
> source. Build resolution supplies environment-specific facades while preserving the same public type and
> stable operation identities.

The implementation may use Vite conditional resolution, generated modules, or a compiler rewrite. The
selected mechanism must be documented by the prototype ADR, preserve source maps and editor navigation,
and fail when it cannot prove the partition. A universal runtime object plus hoped-for tree shaking is
forbidden.

### Server/authoring representation

The server representation may include:

- the native Drizzle table and relations
- Kubernetes resource definition and reconcile registration
- provider binding metadata
- runtime schemas
- action and view implementations
- graph identities and dependencies
- server-only authorization functions

### Browser representation

The generated browser facade includes only:

- stable model, view, and action identifiers
- input/output runtime schemas safe for the browser
- query-key construction
- same-origin transport calls
- React/TanStack adapters
- public relation and display metadata explicitly approved for client use

It excludes:

- Drizzle drivers and SQL implementations
- Kubernetes clients, schemas used only for controllers, and credentials
- TypeKro objects
- Node-only modules
- provider SDKs
- Secret values and Secret references not intended for the browser
- operator and command handler closures
- server authorization code

The browser build must fail when a client module captures an unsupported server value. Tree shaking is not
accepted as the sole security boundary.

## Provider and hydration contract

`app.provide(token, implementation)` returns an `ApplicationProviderBinding` whose public type is the
intersection of provider-neutral binding facts, graph-time hydrated outputs, and environment-appropriate
runtime methods.

```ts
const events = app.provide(EventLog, EventLog.jetstream());

events.status.ready; // graph/status projection
events.endpoint;     // hydrated endpoint reference

await events.publish(message); // server/operator runtime only
```

Provider implementation construction must remain pure during discovery. Infrastructure side effects are
graph nodes lowered by TypeKro. Runtime clients are created by generated bootstraps using injected Secret,
ConfigMap, service-discovery, and downward-API values.

Provider requirements are inferred from model/view/action/host behavior. If zero providers satisfy a
required interface, compilation reports the consumer and requirement. If multiple unqualified providers
satisfy it, compilation reports the ambiguity. Scoped or qualified providers are a future-compatible
extension and must not silently choose by registration order.

## `ApplicationHost` capability

`ApplicationHost` describes how one immutable application artifact becomes a running workload. It does
not build during application execution, deploy during Vite build, or expose arbitrary imperative cluster
access.

The Vite plugin implicitly declares that the current application requires an `ApplicationHost`. The
Kubernetes implementation accepts deployment policy but receives the built web artifact from the
compiler rather than an authored image string.

```ts
const host = app.provide(
  ApplicationHost,
  ApplicationHost.kubernetes({
    namespace: 'guestbook',
    replicas: 2,
    resources: { requests: { cpu: '100m', memory: '128Mi' } },
  }),
);
```

The graph-time binding exposes service facts and an honest pending-build state. The compiler's web artifact
manifest and generated workload carry the resolved image/artifact digests:

```ts
host.service.name;
host.service.port;
host.status.ready;
host.image.state; // 'pendingBuild' during graph authoring
host.url.internal;
```

The Kubernetes implementation generates:

- immutable image reference/digest and complete build provenance
- Deployment with rollout/readiness semantics
- Service
- ServiceAccount and least-privilege RBAC
- standard health, readiness, and graceful-shutdown behavior
- provider ConfigMap and Secret mounts
- inferred environment variables and endpoints
- generated gateway/protocol mounting
- runtime provider connections
- NetworkPolicy resources or explicit unsupported-enforcement evidence
- graph edges to migrations, providers, CRDs, indexes, and gateway authorities
- application-graph ownership, teardown metadata, and root status projection

The host must not become ready before required migrations, provider infrastructure, CRDs, and server
Secrets are usable. Optional or asynchronously converging dependencies must be represented honestly.

## Start server integration

The plugin mounts versioned same-origin endpoints under a reserved prefix, initially:

```text
/__applik8s/v1/queries/:query/snapshot
/__applik8s/v1/queries/:query/subscribe
/__applik8s/v1/commands/:command/submit
/__applik8s/v1/commands/:command/progress
/__applik8s/v1/streams/:subscription/replay
/__applik8s/v1/streams/:subscription/subscribe
/__applik8s/v1/healthz
/__applik8s/v1/readyz
```

The implementation reuses the existing gateway handlers and protocols rather than translating them into
a second Start-specific protocol. Authentication and admitted context are installed once per request and
shared by loaders, actions, model operations, command submission, query snapshots, and subscriptions.

SSR requests use a request-scoped client/store. Hydration serializes only safe ready snapshots and cursors.
The browser installs them before React hydration, then subscribes using the same query/context identity.

## Kubernetes snapshot/watch query authority

CRD-backed queries implement the common snapshot/resume contract through an explicit Kubernetes provider
authority. Raw Kubernetes watch events never become the browser protocol.

The first implementation must:

1. Execute an authorized Kubernetes list using bounded pagination.
2. Preserve one consistent list snapshot across pages and capture the authoritative list
   `metadata.resourceVersion`.
3. Return the projected query value plus an opaque cursor bound to model/query/input/principal/context,
   authorization version, resource version, and expiry.
4. Start a Kubernetes watch from the captured resource version.
5. Treat relevant add, modify, and delete events as query invalidations after canonical model-dependency
   classification.
6. Use watch bookmarks, when enabled and supported, only to advance the internal provider frontier.
7. Never expose raw objects, Kubernetes event types, resource versions, or watch credentials as the public
   browser event contract.
8. Translate watch expiry, HTTP `410 Gone`, provider compaction, an irrecoverable continuation mismatch,
   or an unprovable snapshot/watch boundary into `providerReset`.
9. Respond to reset with a fresh authorized snapshot and a new watch rather than assuming an expired
   resource version is replayable.
10. Bound reconnect, list pages, watch duration, buffered invalidations, memory, and handler deadlines.
11. Keep Kubernetes RBAC and Applik8s application authorization separate: both must succeed.

When the Kubernetes API/provider cannot prove a consistent paginated snapshot plus watch frontier, the
capability is `resetOnly`, not `resumableInvalidation`. Tests must force events between list pages, between
list completion and watch establishment, after bookmarks, and after a synthetic `410 Gone`.

## GuestBook reactive lifecycle

The intended live sequence is:

1. The Start loader requests `GuestBookEntry.published` under admitted context.
2. The server obtains an authoritative bounded snapshot and resume cursor.
3. The rendered HTML contains the query result and safe dehydration state.
4. The browser hydrates without repeating the initial snapshot request.
5. The browser subscribes to the query's invalidation SSE channel.
6. The user calls the callable `GuestBookEntry.create` mutation.
7. The Start server validates input, authentication, trusted context, authorization, and idempotency.
8. Durable command processing creates the Kubernetes resource using server-owned placement.
9. The operator publishes or rejects the entry by updating authoritative status.
10. Kubernetes watch/index processing records the relevant canonical model change.
11. The query subscription emits an invalidation cursor, not guessed result patches.
12. The browser requeries and React rerenders the published entry.

The mutation's accepted/succeeded state does not falsely mean the operator has published the entry. The UI
may display both command progress and reconciliation state when useful.

## Compiler and runtime implementation approach

### Discovery

1. Load the configured/conventional application module in a server-only discovery bundle.
2. Normalize providers, models, conventional actions, custom actions, views, operators, access policy,
   exposure, and host requirements into the existing application graph.
3. Assign stable versioned operation identities independent of minification and file-system paths.
4. Reject unresolved closures, provider ambiguity, unsafe browser exports, and unsupported model actions.

### Partition and generation

1. Emit a browser contract manifest containing safe model/view/action metadata and schemas.
2. Generate browser facade modules consumed by normal application imports or a deterministic compiler
   rewrite. The prototype ADR must choose one strategy and prove source maps and editor types.
3. Generate the Start server bootstrap that installs authentication, request-scoped runtimes, gateway
   handlers, provider adapters, and health behavior.
4. Ask Vite/TanStack Start to build the application using the generated modules.
5. Build an OCI image from the resulting server/client artifact using repository release policy.
6. Bind the image digest to `ApplicationHost` and lower the complete graph through TypeKro.

### Runtime injection

Server request context should use `AsyncLocalStorage` or an equally concurrency-safe request-scoped
mechanism. Browser context uses the installed Applik8s provider/store. Operator and WASM handlers use their
existing explicit host capability context. No process-global mutable request identity is permitted.

## Correctness prerequisites

The following existing findings are prerequisites for calling the migrated GuestBook production evidence:

1. Durable command-result scope includes admitted `contextDigest` on submission, processing, and lookup.
2. Snapshot/resume no longer treats PostgreSQL sequence allocation order as commit order; an adversarial
   concurrent-transaction test proves the committed frontier.
3. Relationship invalidation resolves canonical logical model identities rather than physical table names,
   and compiler lowering includes related-model dependencies.
4. The generated live test no longer manually inserts database change rows or public events.
5. The nested model update result is simplified before public API freeze.
6. RFP examples and implementation agree on the direct/common model surface; `$model` drift is removed
   from ordinary documentation.

These items may be implemented in an earlier release, but this RFP's golden-path evidence depends on them.

## Security requirements

1. Client bundles contain no server provider implementation or credential material.
2. Same-origin endpoints still require explicit authentication and application-owned authorization.
3. Trusted context is server-admitted, schema-validated, digest-bound, cursor-bound, and nontransferable.
4. Browser inputs cannot choose Kubernetes namespace, connection, field manager, database, tenant setting,
   provider endpoint, or Secret reference.
5. Conventional create/update inputs exclude identity, revision, status, ownership, and other server-owned
   fields unless a model explicitly and safely delegates one.
6. Direct model querying is bounded by declared indexes/views, field allowlists, maximum page sizes, cost
   policy, and provider enforcement. An unrestricted browser ORM endpoint is forbidden.
7. Mutation idempotency scope includes principal/admitted context as required by the command contract.
8. SSR dehydration includes only public query results and opaque cursors.
9. Provider hydration metadata is not automatically public. Browser-safe outputs require explicit marking.
10. Public mode fails closed when authentication, cursor secrets, certificate providers, DNS providers, or
    required access enforcement are absent.

## Observability requirements

The generated host and adapters expose structured evidence for:

- Start build and image digest
- application graph and provider bindings
- request authentication/admission failures
- query snapshot and subscription latency
- active subscriptions and resets
- command submission/progress latency
- operator reconciliation latency
- change observation to browser invalidation latency
- authoritative requery latency
- provider readiness and migration dependencies
- dropped, retried, or failed invalidations
- browser reconnect/resume/reset counts without leaking principal or context values

The GuestBook UI should visibly distinguish command acceptance, operator publication, and current query
revision in its demonstration/diagnostic panel.

## Package changes

Expected package surface:

| Package | Responsibility |
| --- | --- |
| `@applik8s/core` | Provider-neutral `ApplicationHost`, callable operation metadata, and graph contracts. |
| `@applik8s/applik8s` | Direct model enhancement, conventional action synthesis, provider bindings, Kubernetes host implementation, and TypeKro lowering. |
| `@applik8s/client` | Framework-neutral callable operation transport, command progress, query store, cursor/reset semantics. |
| `@applik8s/react` | Router-neutral subscription/query hooks and callable mutation lifecycle contract. |
| `@applik8s/tanstack-start` | Start request scope, loader/hydration integration, same-origin gateway adapter, and public convenience exports. |
| `@applik8s/tanstack-start/vite` | Client/server partitioning, facade generation, bootstrap generation, artifact manifest, dependency-zone enforcement. |
| `@applik8s/compiler` | Discovery, stable operation identity, graph validation, artifact/image planning, host/provider dependency lowering. |

The package-consumer gate must prove that published exports contain JavaScript and declarations, declare
all runtime dependencies, and work without workspace dependency hoisting.

## Acceptance tests

### Type and model evidence

- A promoted Drizzle model remains assignable anywhere its original Drizzle table is accepted.
- A promoted Kubernetes model retains resource actions, permissions, reconciliation, status, and metadata.
- Both expose direct conventional and custom operations with derived input/output types.
- Browser and server imports present the same source-level model API.
- Browser types omit server-only provider operations and unsafe fields.
- `GuestBookEntry.create.useMutation()` returns a callable awaitable with reactive state properties.

### Provider and host evidence

- `provide()` returns hydrateable outputs and records the correct application graph binding.
- Model/view/action requirements connect to the correct provider without manual handles.
- Missing and ambiguous providers fail with consumer-specific diagnostics.
- The Start image, Deployment, Service, RBAC, probes, config, Secrets, and dependencies are inferred.
- Vite build performs no Kubernetes mutation.
- `applik8s deploy --context orbstack` deploys the complete TypeKro instance.

### Build-partition evidence

- Client chunks contain no Drizzle driver, Kubernetes client, TypeKro, provider SDK, Secret value, operator
  closure, command handler implementation, or server authentication implementation.
- Unsupported client capture fails compilation rather than relying on tree shaking.
- Source maps and editor types point to authored model/route code rather than generated facade internals.
- A clean packed consumer can build and deploy the example.

### SSR and reactive evidence

- The loader obtains one authoritative snapshot.
- Hydration performs no duplicate initial fetch.
- A change committed between snapshot and subscription is not lost.
- SSE reconnect resumes from the opaque cursor.
- Authorization-version change and retention gap produce explicit reset behavior.
- Related-model changes invalidate joined queries using logical model identity.
- Multiple admitted contexts cannot share cache, cursor, idempotency, or result scope.

### Complete GuestBook browser evidence

The required browser test performs all of the following against OrbStack:

1. Deploy through the TypeKro factory path.
2. Open the real TanStack Start page.
3. Confirm SSR content and hydration without duplicate fetch.
4. Submit the form through `GuestBookEntry.create`.
5. Observe durable command progress.
6. Observe the resulting Kubernetes `GuestBookEntry`.
7. Observe operator publication status.
8. Receive an SSE invalidation.
9. Requery and render the new entry without navigation or manual refresh.
10. Restart the Start server and reconnect without losing the current snapshot.
11. Restart the operator and prove later changes still arrive.
12. Exercise a rejected entry and show that it does not enter the published query.
13. Delete the instance with `factory.deleteInstance()` and verify complete cleanup.

The test must not manually write application rows, change-log rows, event outbox rows, public events, CRD
status, or SSE payloads.

## Performance and scale requirements

The implementation records durable benchmark history and enforces both absolute ceilings and regression
limits. The initial v0.6 budgets are deliberately generous:

| Metric | Initial v0.6 gate |
| --- | --- |
| Minimal generated browser facade | at most 35 KiB gzip |
| Marginal browser facade growth | at most 4 KiB gzip per additional model with one view and one action |
| GuestBook application JavaScript | at most 250 KiB gzip across initial route chunks |
| Warm local SSR snapshot | p95 at most 750 ms |
| Operator-status-to-browser-render | p95 at most 5 seconds on the OrbStack qualification cluster |
| Idle SSE memory growth | at most 128 KiB RSS per connection over a 1,000-connection sample |
| Warm host readiness | p95 at most 60 seconds with required images already present |
| Reconnect or reset recovery | p95 at most 5 seconds after connectivity returns |
| Concurrent SSR pool | 100 concurrent requests complete without starvation, context leakage, or pool exhaustion |

After the first accepted baseline, CI also fails any comparable metric that regresses by more than 20%
unless the budget and explanation are reviewed in the same change.

The measured history includes:

- Start cold start and readiness
- SSR snapshot latency
- browser hydration overhead
- subscription connection memory and concurrency
- invalidation fan-out
- authoritative requery latency
- command submission and progress latency
- operator-change-to-browser-render latency
- client and server bundle sizes
- generated model facade size as model count grows
- provider connection-pool behavior across concurrent SSR requests

One shared model must not pull every model schema, operator, provider, or action implementation into every
client chunk. Live measurements record environment, architecture, cluster state, image cache state,
sample size, percentiles, and known limitations.

## Child implementation specifications

This document is the umbrella architecture and release contract. Implementation proceeds through reviewed
child specifications so one agent or pull request is not expected to invent all underlying systems:

1. **Direct Model Operations and Environment Facades**
   - conventional and custom callable model operations
   - exact await/result semantics
   - same-specifier browser/server partition
   - update-result simplification
2. **Hydrateable Providers and ApplicationHost**
   - provider binding/runtime handle contract
   - immutable artifact lifecycle
   - Kubernetes host resources, readiness, ownership, and teardown
3. **TanStack Start and Vite Runtime Integration**
   - request-scoped runtime
   - same-origin gateway mounting
   - SSR/dehydration/hydration
   - callable React mutations and resumable subscriptions
4. **Kubernetes Snapshot/Watch Query Authority**
   - list/resource-version/watch frontier
   - bookmarks, compaction, `410 Gone`, reset, and bounded resource use
5. **GuestBook Golden Path and v0.6 Qualification**
   - example migration
   - complete browser/command/operator/SSE proof
   - restart, cleanup, bundle, security, and performance gates

Each child specification inherits this RFP's normative decisions. A child may refine implementation detail
but cannot weaken the umbrella safety or developer-experience contract.

## Delivery phases

### Phase 0: Correctness and prototype ADR

- fix context-scoped idempotency, committed snapshot frontier, and canonical relationship invalidation
- prototype direct model enhancement without breaking Drizzle or Kubernetes native identity
- choose and document browser facade generation/rewrite strategy
- prototype callable mutations and request-scoped dispatch
- decide the exact `ApplicationHost` provider boundary

### Phase 1: Direct model operations

- synthesize safe conventional actions
- materialize custom actions as direct methods
- add model-native named views and bounded query handles
- implement framework-neutral callable operations
- simplify update result shape and align model documentation

### Phase 2: Provider hydration and application host

- make provider bindings return hydrateable/runtime-capable handles
- add `ApplicationHost` contracts and Kubernetes implementation
- infer host provider consumption, RBAC, config, Secrets, readiness, and graph edges
- integrate immutable Start image artifacts

### Phase 3: TanStack/Vite integration

- generate browser-safe facades
- mount the existing gateway protocols into Start
- install authenticated request-scoped runtimes
- add SSR preload, dehydration, hydration, subscription, reset, and callable mutation adapters
- enforce client/server dependency zones

### Phase 4: GuestBook migration

- move the example into a real Start project
- remove HTML from status
- retain operator-owned moderation and authoritative status evidence
- render query data in React
- deploy the Start application through `ApplicationHost`
- add local HTTP and managed TLS/DNS exposure paths through `provide()` and `app.expose()`

### Phase 5: Golden path and hardening

- implement the complete OrbStack browser test
- add concurrency, restart, reconnect, reset, cleanup, bundle, and benchmark evidence
- run isolated architecture and security review
- update vision, roadmap, package docs, scorecard, and migration guidance
- complete every child implementation specification and live gate before tagging v0.6

## Backward compatibility

- Existing `app.server(...)` remains supported for generated lightweight HTTP workloads.
- Existing explicit `app.gateway(...)` remains supported for standalone or non-Start topologies.
- Existing `@applik8s/tanstack-start` loader/hydration helpers remain available or receive a documented
  mechanical migration.
- Existing `$model` code remains compatible during the transition but is removed from ordinary examples.
- Existing JSONB and native Drizzle model paths are not silently reinterpreted.
- Existing GuestBook CRD names and persisted domain fields should remain compatible where practical;
  `renderedHtml` is deprecated and then removed from the example contract before public freeze.

## Non-goals

- Reimplement TanStack Router, Start, Query, React, Vite, or Nitro.
- Make TanStack Start mandatory for Applik8s applications.
- Replace the framework-neutral client and React packages with TanStack-specific state.
- Expose arbitrary Drizzle or Kubernetes queries directly to browsers.
- Infer authorization from model shape.
- Own authentication, tenancy, organization membership, or domain roles.
- Stream raw Kubernetes events to browsers as a public application protocol.
- Have operators maintain browser connections or render frontend markup.
- Deploy as a side effect of `vite build` or `vite dev`.
- Store Kubernetes contexts or credentials in source.
- Treat provider acceptance as proof of DNS propagation, certificate issuance, or application readiness.
- Solve multi-region hosting, edge rendering, RSC portability, offline-first mutation replication, or
  arbitrary incremental SQL view maintenance in the first implementation.

## Required documentation

The implementation must publish:

- a single-file minimal Start application walkthrough
- the complete GuestBook walkthrough
- direct model action and view semantics
- callable mutation lifecycle and error behavior
- provider binding, hydration, and runtime-dispatch semantics
- `ApplicationHost` lifecycle and image provenance
- browser/server dependency-zone rules
- SSR snapshot/resume and reset behavior
- authentication, trusted-context, and authorization boundaries
- local development and explicit cluster deployment workflow
- migration from `app.server(...)` GuestBook and explicit TanStack loader helpers
- troubleshooting for missing providers, unsafe browser captures, readiness, SSE reconnect, and teardown

## Definition of done

This RFP is complete when:

1. The GuestBook is a real TanStack Start application deployed as part of its Applik8s graph.
2. Its models are declared once and imported by operators, loaders, components, tests, and resource code.
3. `GuestBookEntry.create(input)` returns an authoritative created snapshot only after the durable result
   succeeds; it does not conflate later reconciliation or query convergence.
4. `GuestBookEntry.create.useMutation()` invokes the same named action through the browser protocol and
   exposes transport, durable-result, optional declared observation, error, and returned-snapshot state
   without bundling the server implementation.
5. Queries preload during SSR, hydrate without duplication, subscribe, invalidate, requery, and rerender.
6. The operator owns domain status but no HTML or SSE connection.
7. `provide()` binds infrastructure, exposes hydrated outputs, and installs runtime capability without a
   provider configuration DSL.
8. `ApplicationHost.kubernetes()` builds and runs the Start application with inferred dependencies.
9. Browser bundles contain only approved model contracts and client behavior.
10. The complete browser-to-command-to-Kubernetes-to-operator-to-SSE-to-React path passes on OrbStack.
11. The correctness prerequisites and adversarial concurrency tests pass.
12. Deployment and cleanup use the supported TypeKro factory lifecycle.
13. Published-package, bundle-size, performance, security, and isolated-review gates pass.
14. Kubernetes list/resourceVersion/watch, bookmark, compaction, `410 Gone`, and reset behavior pass
    adversarial provider tests.
15. Every child implementation specification is complete and linked from the v0.6 scorecard.
