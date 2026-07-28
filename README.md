# applik8s

`applik8s` lets you build applications on the Kubernetes control plane with TypeScript.

You write typed Kubernetes APIs and event listeners. `applik8s` compiles them into a WASM component, packages that component with a Rust operator host, and emits the Kubernetes YAML needed to install the whole thing into a cluster.

Reconciliation TypeScript becomes WASM component logic evaluated by Kubernetes events through a Rust operator host. Application servers and durable command processors compile into separate, inspectable Node workloads when the application graph requires them.

## v0.6 Flagship: Native Models and Live Applications

v0.6 lets one Drizzle table remain the relational schema authority while gaining derived ArkType contracts and a common Applik8s model facet. Applications can declare trusted context, PostgreSQL RLS, bounded queries, durable replayable streams, ClickHouse projections, authenticated subscriptions, and browser stores from the same inspectable application graph. Generated migrations, gateways, projection workers, provider infrastructure, RBAC, and network policy remain explicit deployment artifacts.

The full-stack path is framework-neutral beneath its first TanStack Start adapter:
`@applik8s/vite` generates browser/server facades and a Fetch-compatible gateway,
`GuestBookEntry.create(...)` and named views share one authored model contract, and
`ApplicationHost.kubernetes(...)` builds the immutable web artifact into the TypeKro-managed
application. The operator updates domain status; React renders authoritative query results after
resumable SSE invalidation.

Start with [`examples/guestbook-start`](examples/guestbook-start) for the smallest complete application.
Then inspect [`examples/chirp-start`](examples/chirp-start), the realistic flagship: native relational
models and relations, direct commands/views, durable JetStream events, rebuildable ClickHouse facts and
hourly analytics, Hatchet moderation, a Kubernetes policy operator, SSR/SSE, hosting, and
optional managed TLS/DNS in one application graph.

```sh
bun run build:v06-generated-proof
bun run check:v06:chirp-build
bun run check:v06:prerelease:orbstack
```

The release claims provider-specific guarantees rather than a fictional universal consistency model: PostgreSQL is authoritative for relational state and RLS, query delivery is snapshot plus resumable invalidation, streams are bounded durable replay, and ClickHouse projections use idempotent application with durable checkpoints. See [`docs/native-models-and-live-queries.md`](docs/native-models-and-live-queries.md), [`docs/v0.6-foundation.md`](docs/v0.6-foundation.md), and [`docs/v0.6-scorecard.md`](docs/v0.6-scorecard.md).

## v0.5 Flagship: Durable Tenant Orchestration

v0.5 adds provider-neutral durable tasks and workflows with a pinned PostgreSQL-only Hatchet implementation. It also adds bounded, named Kubernetes connections: handlers can read and mutate an installation-authorized cluster without receiving kubeconfig material or ambient client authority. The Tenant Platform models tenant onboarding and decommissioning with retry-safe external-effect tasks, durable approval waits, cancellation, compensation, explicit operator intervention, canonical transitions committed through the v0.4 model transaction boundary, and stable-identity ExternalDNS publication through the operator runtime.

```sh
bun run build:tenant-platform-v05
bun run check:v05:prerelease:orbstack
```

See [`docs/workflows.md`](docs/workflows.md) for workflow semantics, [`docs/kubernetes-connections.md`](docs/kubernetes-connections.md) for the connection authority model, [`docs/dns-publication.md`](docs/dns-publication.md) for DNS ownership and observation semantics, and [`docs/v0.5-scorecard.md`](docs/v0.5-scorecard.md) for the executable release criteria.

## v0.4 Flagship: Durable Tenant Behavior

v0.4 added typed, durable application behavior to the v0.3 application substrate. The current model API derives `Model.create`, `Model.update`, `Model.delete`, and typed committed lifecycle handlers from a promoted Drizzle table; exceptional domain operations use one `Model.action(...)` declaration. These lower to PostgreSQL inbox/result/history/outbox semantics, generated processors, NATS JetStream resources, retry/dead-letter behavior, and TypeKro-owned lifecycle. The older Tenant Platform evidence retains its compatibility command spelling to reproduce the original v0.4 artifact.

PostgreSQL is authoritative for keyed serialization, idempotency, durable results, model revisions, history, and outboxes. JetStream is acknowledged at-least-once transport; a broker acknowledgement is not a completed command result. Command handlers cannot perform HTTP, object storage, workflow, or other external effects while model locks are held.

The same release proves tree-shaken `@kubernetes/client-node` Core, Apps, and Custom Objects calls inside WASM reconciliation closures. Kubernetes endpoint, bearer identity, and CA trust remain host-owned and bound to declared origins.

Run the complete v0.4 release gate against OrbStack:

```sh
bun run check:v04:prerelease:orbstack
```

Build the v0.4 Tenant Platform artifacts without a cluster:

```sh
bun run build:tenant-platform-v04
```

See [`docs/commands.md`](docs/commands.md) for the durable-command contract and [`docs/release-evidence-v0.4.md`](docs/release-evidence-v0.4.md) for captured evidence and maturity boundaries.

For a clean consumer install outside this workspace, start with [`docs/npm-first-run.md`](docs/npm-first-run.md). The executable scorecard is documented in [`docs/v0.4-scorecard.md`](docs/v0.4-scorecard.md).

v0.4.1 adds a measured manual scaling contract for inferred processors: replicas, per-pod concurrency, aggregate acknowledgement windows, resources, topology spreading, node selection, and disruption budgets. Run `bun run benchmark:v041:live` for the reproducible PostgreSQL/JetStream benchmark or `bun run check:v041:performance` for the fast regression gate. See [`docs/release-evidence-v0.4.1.md`](docs/release-evidence-v0.4.1.md).

## v0.3 Flagship: Tenant Platform App

v0.3 is the developer-experience and substrate-freeze release. `examples/tenant-platform.ts` is the flagship proof: one TypeScript app declares resources, storage-backed models, HTTP routes, reconciliation, repair/cleanup jobs, and generated Kubernetes artifacts without starting from provider wiring or graph terminology.

The golden path is intentionally app-shaped:

```ts
import { app } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';

const tenantPlatform = app('tenant-platform', {
  namespace: 'platform',
  apiVersion: 'platform.applik8s.dev/v1alpha1',
  kind: 'TenantPlatform',
});

const Tenant = tenantPlatform.resource('Tenant', {
  spec: type({ plan: "'free' | 'team' | 'enterprise'", ownerEmail: 'string' }),
  status: type({ phase: "('Pending' | 'Ready' | 'Failed')?", url: 'string?' }),
});

tenantPlatform.storage.postgres('tenant-platform-db', {
  database: 'tenant_platform',
  migrations: 'generated-job',
});

const Account = tenantPlatform.model('Account', {
  spec: type({ tenant: 'string', email: 'string', role: "'owner' | 'admin' | 'viewer'" }),
  indexes: { byTenant: ['tenant', 'email'] },
});

tenantPlatform.http('tenant-admin', (http) => {
  http.post('/tenants/:tenant/accounts', async ({ params, form }) => Account.create({
    tenant: params.tenant ?? 'default',
    email: form.string('email'),
    role: form.enum('role', ['owner', 'admin', 'viewer']),
  }));
});

tenantPlatform.reconcile(Tenant, async (tenant) => {
  tenant.status.phase = 'Ready';
});

export const tenantPlatformComposition = tenantPlatform.composition;
```

Behind that app-shaped surface, applik8s still emits a real TypeKro-backed control plane: CRDs, Postgres/CNPG resources, migration/repair/cleanup Jobs, durable generated-job status, generated server runtime modules, provider compatibility contracts, operation-target dry-run planning, scoped watch contracts, RBAC, and inspectable application graph metadata.

Build the v0.3 flagship artifacts:

```sh
bun run applik8s build examples/tenant-platform.ts --typekro --composition-name tenantPlatform --out-dir dist/examples/tenant-platform
```

For a guided first pass through those artifacts, see [`docs/v0.3-first-run.md`](docs/v0.3-first-run.md).

Run the full v0.3 prerelease gate against an explicit local Kubernetes context:

```sh
bun run check:v03:prerelease:orbstack
```

The important v0.3 boundary is honesty: the app-level path is stable, generated artifacts remain inspectable, and every native provider interface has a bounded Kubernetes-native default. Additional cloud-scale adapters remain optional. Generated-job state is durably stored in the runtime-created status ConfigMap and authoritatively projected by KRO into the root app's `status.applik8s.jobs`; KRO is the sole app-status writer. Supply-chain verification remains metadata-only until signed/SBOM/provenance artifacts are real.

## v0.2 Flagship: TypeKro-Native GuestBook

v0.2 adds the integrated application-composition path. `examples/guestbook.ts` is the flagship proof: one TypeScript program defines CRDs, installs an operator through a wrapped TypeKro composition, generates an HTTP server, serves cached indexed CRD data, buffers page-view counters, aggregates status, emits inspectable YAML/RBAC, and passes live local-cluster validation.

Build the flagship artifacts:

```sh
bun run build:guestbook
```

The default profile serves the complete responsive GuestBook UI at `http://guestbook.localhost` and
does not require a cluster-wide certificate or DNS controller. The public profile keeps the same
application code while making the edge intent explicit:

```sh
APPLIK8S_GUESTBOOK_PROFILE=public \
APPLIK8S_GUESTBOOK_DOMAIN=guestbook.example.com \
APPLIK8S_GUESTBOOK_ISSUER_NAME=letsencrypt-prod \
APPLIK8S_GUESTBOOK_ISSUER_KIND=ClusterIssuer \
bun run build:guestbook
```

That profile's `app.expose("web", ...)` declaration emits an Ingress, a namespaced cert-manager
`Certificate`, ExternalDNS intent, and an HTTPS public URL in the `ApplicationGraph`. cert-manager,
the selected Issuer/ClusterIssuer, and ExternalDNS remain explicitly platform-owned prerequisites;
the example never represents accepted intent as completed certificate issuance or DNS propagation.

Run the live GuestBook proof against an explicit local Kubernetes context:

```sh
APPLIK8S_E2E_LIVE=1 APPLIK8S_E2E_CONTEXT=orbstack bunx vitest run --config vitest.e2e.config.ts packages/e2e/test/typekro-guestbook.e2e.test.ts
```

The important v0.2 boundary is honesty: GuestBook is Kubernetes-native application state, not a claim that CRDs are a general-purpose database. High-volume product data belongs in explicit storage-backed models such as the v0.3 Postgres `ModelStore` slice.

For v0.6 generated query gateways, the same exposure API accepts the gateway binding directly:
`app.expose("public", { service: gateway, ... })`. Applik8s derives the generated Service identity,
namespace, and port, so applications do not need to repeat compiler naming conventions.

## A Kubernetes App In TypeScript

This is the shape of the canonical example in `examples/imagejob.ts`: an `ImageJob` API where users point at an S3-compatible object store, ask for image formats, and the control plane drives the work.

```ts
import { type as arkType } from 'arktype';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { sdk } from '@applik8s/sdk';


const imageSpecSchema = arkType({
  endpoint: 'string',
  region: 'string',
  sourceBucket: 'string',
  sourceKey: 'string',
  outputBucket: 'string',
  formats: 'string[]',
  priority: "'low' | 'normal' | 'high'",
});
type ImageSpec = typeof imageSpecSchema.infer;

const imageStatusSchema = arkType({
  'phase?': "'Pending' | 'Processing' | 'Complete' | 'Failed'",
  'outputUrls?': 'string[]',
  'processedBytes?': 'number',
  'message?': 'string',
});
type ImageStatus = typeof imageStatusSchema.infer;

export const ImageJob = sdk.crd({
  apiVersion: 'media.applik8s.dev/v1alpha1',
  kind: 'ImageJob',
  spec: imageSpecSchema,
  status: imageStatusSchema,
});
```

ArkType is the single source of truth here: `typeof imageSpecSchema.infer` gives the TypeScript type used by handlers, and the same schema emits the Kubernetes structural OpenAPI schema used in the generated CRD.

That creates a real Kubernetes API:

```yaml
apiVersion: media.applik8s.dev/v1alpha1
kind: ImageJob
metadata:
  name: hero-image
  namespace: media
spec:
  endpoint: http://ministack.media.svc.cluster.local:4566
  region: us-east-1
  sourceBucket: images
  sourceKey: hero.png
  outputBucket: processed
  formats: [webp, avif]
  priority: normal
```

Now attach TypeScript listeners to the lifecycle of that API:

```ts
export const imagePipeline = sdk.operator({
  name: 'image-pipeline',
  deployment: { namespace: 'media', replicas: 1 },
  resources: { ImageJob },
  permissions: [{ apiGroups: [''], resources: ['configmaps'], verbs: ['get', 'create', 'update', 'patch', 'delete'] }],
  handlers: [
    ImageJob.on.reconcile(async (job) => {
      job.finalizers.add('media.applik8s.dev/imagejob');
      job.status.phase = 'Processing';

      const source = await readSourceObject(job.spec);
      const outputs = await writeFormattedOutputs(job.metadata.name, job.spec, source);

      job.status.phase = 'Complete';
      job.status.outputUrls = outputs.map((output) => output.url);
      job.status.processedBytes = outputs.reduce((total, output) => total + output.bytes, 0);
      job.status.message = `Processed ${job.spec.sourceBucket}/${job.spec.sourceKey}`;

      const output = job.k8s.ConfigMap({
        name: job.names.dnsSafe(`${job.metadata.name}-output`),
        ...(job.metadata.namespace ? { namespace: job.metadata.namespace } : {}),
        data: {
          sourceUrl: s3Url(job.spec.sourceBucket, job.spec.sourceKey),
          outputUrls: outputs.map((output) => output.url).join(','),
          formats: job.spec.formats.join(','),
          priority: job.spec.priority,
        },
      });
      job.apply(output);

      job.events.normal('ImageJobComplete', `Wrote ${outputs.length} image output object(s)`);
    }),

    ImageJob.on.finalize((job) => {
      job.delete(job.k8s.ConfigMap({
        name: job.names.dnsSafe(`${job.metadata.name}-output`),
        ...(job.metadata.namespace ? { namespace: job.metadata.namespace } : {}),
      }));
      job.finalizers.remove('media.applik8s.dev/imagejob');
    }, { finalizer: 'media.applik8s.dev/imagejob' }),
  ],
});
```

The full source includes the helper functions. They create an AWS SDK `S3Client`, read the source object with `GetObjectCommand`, and write each output object with `PutObjectCommand`. The canonical live test runs the handler against a Ministack S3-compatible endpoint using local `test` credentials.

The listener reads like application code, but it is control-plane code:

- `job.spec` is the typed Kubernetes custom resource spec.
- `await readSourceObject(job.spec)` runs ordinary SDK-backed application I/O inside the WASM handler through WASI HTTP.
- `job.status.phase = 'Complete'` becomes a status update.
- `job.finalizers.add(...)` keeps deletion safe until cleanup runs.
- `job.k8s.ConfigMap(...)` builds a typed Kubernetes child object and `job.apply(...)` declares it for server-side apply.
- `job.events.normal(...)` records a Kubernetes Event.
- `ImageJob.on.finalize(...)` handles deletion by removing owned resources before the finalizer is removed.
- Declaring `{ finalizer: '...' }` is operational: the host installs a missing finalizer before normal reconciliation and requeues the object. After a successful terminal finalize plan, it removes the declared finalizer automatically; a finalize plan that requeues retains it. An explicit `job.finalizers.remove(...)` remains supported and idempotent at the plan level.

Handlers can be `async`. The compiler tree-shakes the TypeScript dependency graph, including the AWS SDK code reached by the handler closure, into the WASM component. The Rust host provides WASI HTTP, so SDK requests run through the component's `fetch` path. Kubernetes mutations still return through the operation plan, so the host can validate RBAC, ownership, status, finalizers, and ordering before effects are applied.

## Build The Operator Bundle

Synthesize an operator bundle from a TypeScript entrypoint:

```sh
bun add --dev @applik8s/cli
bunx applik8s build ./src/operator.ts --out-dir dist/applik8s
```

This repository also includes a shortcut for the canonical example:

```sh
bun run build:imagejob
```

The generated bundle contains the whole bridge from TypeScript to Kubernetes:

- `operator-manifest.json`: the runtime source of truth for owned APIs, permissions, ABI, bundle digest, replay settings, and runtime requirements.
- `contract/runtime-contract.json`: the host/runtime contract schema.
- `contract/applik8s-handler.wit`: the WASM component interface used between the host and handler.
- `wasm/handler.wasm`: the compiled TypeScript listener component.
- `bundle/handler.js`: the generated JavaScript dispatcher used to build the component and inspect replay/debug paths.
- `bundle/handler.js.map`: source maps for TypeScript diagnostics.
- `bundle/handler.esbuild-meta.json`: dependency graph metadata.
- `kubernetes/*.yaml`: CRD, RBAC, ServiceAccount, Deployment, and runtime resources.
- `Dockerfile.applik8s-runtime`: image recipe that packages the Rust operator host with the manifest, WASM component, and diagnostics assets.
- `apply.sh`: a local build/apply script for the generated Kubernetes YAML.

## Deploy To Kubernetes

For a local Docker-backed Kubernetes context where the cluster can see locally built images, run the generated apply script:

```sh
dist/applik8s/apply.sh
```

For a remote cluster, publish the runtime image to a registry the cluster can pull from:

```sh
APPLIK8S_IMAGE=registry.example.com/team/image-pipeline:dev \
APPLIK8S_PUSH_IMAGE=1 \
dist/applik8s/apply.sh
```

The script builds `Dockerfile.applik8s-runtime`, optionally pushes `APPLIK8S_IMAGE`, applies `dist/applik8s/kubernetes/*.yaml` with server-side apply, and patches the generated Deployment to the chosen image tag when `APPLIK8S_IMAGE` is set.

After the operator is installed, create normal Kubernetes custom resources for the API you defined:

```sh
kubectl apply --server-side --field-manager=applik8s-demo --filename - <<'YAML'
apiVersion: media.applik8s.dev/v1alpha1
kind: ImageJob
metadata:
  name: hero-image
  namespace: media
spec:
  endpoint: http://ministack.media.svc.cluster.local:4566
  region: us-east-1
  sourceBucket: images
  sourceKey: hero.png
  outputBucket: processed
  formats: [webp, avif]
  priority: normal
YAML

kubectl get imagejob hero-image --namespace media --output yaml
```

The same flow works for your own APIs: define `sdk.crd(...)`, export an `sdk.operator(...)`, run `applik8s build`, install the generated bundle, then apply instances of the CRD your TypeScript declared.

## What Runs In The Cluster

When the bundle is installed, Kubernetes becomes the event source and state machine:

1. The API server accepts an `ImageJob` object because the generated CRD is installed.
2. The Rust operator host watches `ImageJob` events through Kubernetes controller primitives.
3. For each reconcile or finalize event, the host builds a JSON invocation payload from the live object and `operator-manifest.json`.
4. The host loads `wasm/handler.wasm` and calls the WIT `handle(inputJson)` function.
5. The WASM component runs the TypeScript listener and returns an operation plan.
6. The Rust host validates the plan against the manifest, declared permissions, runtime contract, and fail-closed safety rules.
7. The host applies Kubernetes effects: server-side apply, status patch, Events, finalizers, deletes, and requeue.
8. Kubernetes persists the new desired state, emits more watch events, and the loop continues.

That is the core idea: TypeScript listeners define the application, Kubernetes stores and schedules the application state, WASM carries the user code, and the Rust operator host performs the privileged control-plane work.

## Try It Locally

Run the executable product story without mutating a cluster:

```sh
bun run test:imagejob
```

Build and inspect generated output:

```sh
bun run build:imagejob
ls dist/applik8s
```

Run the local checks:

```sh
bun run check:local
```

Live Kubernetes suites are opt-in because they mutate the selected context:

```sh
APPLIK8S_E2E=1 APPLIK8S_E2E_CONTEXT=orbstack bun run test:e2e
```

For the README live test, Ministack is installed from Docker Hub inside the test namespace and exposed at `http://ministack.media.svc.cluster.local:4566`.

For a v0.4 release-candidate pass, run the durable-behavior, Kubernetes-WASM, packaging, and live lifecycle gates:

```sh
bun run check:v04:prerelease:orbstack
```

## Documentation

- `docs/imagejob-golden-path.md`
- `docs/first-run.md`
- `docs/npm-first-run.md`
- `docs/typekro-golden-path.md`
- `docs/generated-artifacts.md`
- `docs/commands.md`
- `docs/dns-publication.md`
- `docs/kubernetes-connections.md`
- `docs/workflows.md`
- `docs/v0.5-scorecard.md`
- `docs/v0.4-scorecard.md`
- `docs/release-evidence-v0.4.md`
- `docs/release-evidence-v0.4.1.md`
- `docs/release-evidence-v0.3.md`
- `docs/release-evidence-v0.2.md`
- `docs/runtime-diagnostics.md`
- `docs/api-reference.md`
- `docs/troubleshooting.md`
- `docs/kubernetes-compatibility.md`
- `RECONCILIATION_CONTRACT.md`
- `TESTING.md`
- `RELEASE_NOTES.md`
