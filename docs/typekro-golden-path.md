# TypeKro Golden Path

## v0.7 deployment boundary

Applik8s v0.7 pins TypeKro `0.33.5`, Alchemy `2.0.0-beta.58`, and Effect
`4.0.0-beta.84` as one reviewed deployment cohort. Ordinary application
authors do not import any of them. The compiler lowers one portable
`ApplicationDeploymentGraph`; `@applik8s/deployment-typekro` turns its
Kubernetes nodes into one root composition plus explicit direct-only and
singleton declarations, and `@applik8s/deployment-alchemy` owns effects,
state, ordering, retries, and reverse-topological destruction.

Run the released-dependency qualification:

```sh
bun run check:v07:typekro
```

The gate imports the installed package exclusively through public exports and
proves the exact dependency cohort, semantic/artifact planning versions,
adapter-required provider surfaces, direct and KRO Alchemy declarations,
typed artifact-output preservation, RGD-before-instance ordering, and the
schema-stable nested artifact-binding map introduced in TypeKro 0.33. It is a
deterministic API/provider qualification, not a live-cluster claim. OrbStack
apply/update/recovery/destroy evidence is tracked separately by the v0.7
scorecard.

The focused adapter suite provides the graph-specific half of the contract:

```sh
TYPEKRO_LOG_LEVEL=fatal bunx vitest run \
  packages/deployment-typekro/test/deployment-typekro.vertical.test.ts \
  packages/deployment-alchemy/test/deployment-alchemy-backend.vertical.test.ts
```

That suite proves graph coverage, direct/KRO parity, artifact and generated
Secret bindings, retained singleton ownership, direct-only provider lowering,
canonical declaration identity, and Alchemy ordering without rewriting
TypeKro-owned dependency edges.

TypeKro `0.33.5` resolves the two released upstream seams discovered by the
External-profile and lifecycle matrices. Singleton-owner graphs now expose a
scheduling-only barrier without changing a consumer's canonical artifact
dependencies. Legacy artifact-binding migrations replace the complete
generated CRD with resource-version concurrency instead of sending an
incompatible merge-patch object through `KubernetesObjectApi`. The released
qualification gate exercises both contracts through public APIs. Exact
direct/KRO lifecycle and External-profile live evidence remains a separate
release-candidate gate; Applik8s still does not normalize TypeKro dependencies
or patch Kubernetes around it.

The rest of this document records the earlier operator/CRD integration path.
It remains useful background, but it is not the v0.7 deployment release
authority.

The TypeKro adapter and application composition path are the v0.2 proof for this vision phrase:

> Operators install like components. Their CRDs instantiate like resources. Their statuses compose like TypeKro resources.

The core adapter still consumes the same operator definition and compiled manifest that plain YAML uses. The flagship v0.2 application proof is `examples/guestbook.ts`.

## Executable Proof

Run the adapter vertical tests:

```sh
bunx vitest run packages/typekro-adapter/test/typekro-adapter.vertical.test.ts
```

The suite proves:

- the canonical `ImageJob` operator can become a TypeKro install composition
- CRD factories are exposed with `ImageJob` and `imageJob` aliases
- generated install resources include the operator Deployment
- generated install resources carry bundle, ABI, runtime, RBAC, capability, rollback, uninstall, and supply-chain posture annotations
- `typeKro.operationTarget()` and `typeKro.targetFactory()` produce values that handlers can pass directly to `ctx.apply()`, `ctx.delete()`, proxy `resource.apply()`, and proxy `resource.delete()`
- TypeKro graph deletes preserve reverse dependency ordering
- status projections can be mapped into handler status

Build and test the flagship TypeKro example:

```sh
bun run build:guestbook
```

For live validation against a local Kubernetes context:

```sh
APPLIK8S_E2E_LIVE=1 APPLIK8S_E2E_CONTEXT=orbstack bunx vitest run --config vitest.e2e.config.ts packages/e2e/test/typekro-guestbook.e2e.test.ts
```

The TypeKro-native tutorial proof is also live-validated:

```sh
APPLIK8S_E2E_LIVE=1 APPLIK8S_E2E_CONTEXT=orbstack bunx vitest run --config vitest.e2e.config.ts packages/e2e/test/typekro-native-tutorial.e2e.test.ts
```

That tutorial covers generated operator install through TypeKro artifacts, CRD factory-created `ImageJob` instances, a downstream `ConfigMap` driven by generated CRD status with `cel`, and a scoped external `Deployment` listener that ignores unwatched deployments.

The example is `examples/guestbook.ts`: an applik8s-wrapped TypeKro composition that installs the GuestBook operator, generated web server, cached indexer, standalone Valkey backend, aggregate workers, and seed `GuestBookEntry` CRDs. The rendered HTML comes from the cached typed `publishedGuestBookEntries` index, not from unbounded request-path Kubernetes lists. Each page load calls typed `GuestBookPageViewBucket.increment(...)`; the generated server buffers those increments and flushes them into per-minute bucket CRDs with inferred get/create/patch RBAC. The generated aggregate then projects page-view totals back into `GuestBook` status. Deployment mechanics remain generated artifacts and future applik8s deploy API work; the example itself stays focused on the DSL.

## Shape

The public spelling is `typeKro.composition(...)`: compile once, then install the operator like a component and instantiate its CRDs through generated factories.

```ts
import { typeKro } from '@applik8s/applik8s';
import { buildOperatorManifest } from '@applik8s/compiler';
import { imagePipeline } from './imagejob.ts';

const manifest = buildOperatorManifest({
  operator: imagePipeline.definition,
  handlerArtifactPath: 'wasm/handler.wasm',
  handlerArtifactDigest: 'sha256:...',
  runtimeContractPath: 'contract/runtime-contract.json',
  runtimeContractDigest: 'sha256:...',
});

if (!manifest.ok) {
  throw new Error(manifest.error.message);
}

const composition = typeKro.composition(imagePipeline.definition, manifest.value, {
  compositionName: 'image-pipeline',
  defaultNamespace: 'media-system',
});

if (!composition.ok) {
  throw new Error(composition.error.message);
}

const installed = composition.value({ namespace: 'media', replicas: 1 });

const image = installed.imageJob({
  name: 'hero-image',
  spec: {
    endpoint: 'http://ministack.media.svc.cluster.local:4566',
    region: 'us-east-1',
    sourceBucket: 'images',
    sourceKey: 'hero.png',
    outputBucket: 'processed',
    formats: ['webp'],
    priority: 'normal',
  },
});
```

From there, `image.status.phase`, runtime-authored `Ready` conditions, and domain status fields are normal TypeKro-visible status values. The adapter should stay out of the user's mental model: the operator installs, the CRD instantiates, and status composes.

For v0.2 application compositions, prefer the app-scoped spelling:

```ts
export const guestBookStack = sdk.kubernetesComposition({
  name: 'guestbook-stack',
  apiVersion: 'guestbook.applik8s.dev/v1alpha1',
  kind: 'GuestBookStack',
  spec: type({}),
  status: type({ ready: 'boolean' }),
}, (_spec, app) => {
  const install = guestBookRenderer({ namespace: 'guestbook' });
  app.defaults({ indexes: 'valkey' });

  app.server('web', {
    namespace: 'guestbook',
    cache: [publishedGuestBookEntries],
  }, (server) => {
    server.get('/', async () => {
      const page = await publishedGuestBookEntries.query('main', { namespace: 'guestbook', limit: 5 });
      return { json: { entries: page.items } };
    });
  });

  const book = install.guestBook({ name: 'main', namespace: 'guestbook', spec: { title: 'GuestBook' } });
  return { ready: book.status?.phase === 'Rendered' };
});
```

This keeps `app(...)` as the inference boundary. Direct callable operator installs contribute operator resources, `app.aggregate(...)` contributes source indexes, and `app.server(...)` infers referenced resource/index bindings from route source when unambiguous. `app.operator(...)` remains available as an explicit spelling for libraries and custom boundaries. Explicit `resources`, `indexes`, `cache`, `indexBackend`, and `permissions` remain available for overrides.

Generated server source ConfigMaps include route modules, `routes.manifest.json`, route IDs, source locations, and bundle inputs. Route failures log that metadata and return the route ID, so generated app servers remain diagnosable without relying on hidden global route registration.

Schema-first `entity(...)` definitions can already be materialized as CRDs with `app.crd(entity, { apiVersion, ... })`. `app.model(entity)` remains fail-closed until v0.3 storage-backed model semantics, migrations, and diagnostics are real.

## v0.2 Boundary

TypeKro install synthesis is manifest-aware. The plain SDK callable operator does not expose pre-compile `installResources`, because real install resources require compiled bundle metadata, handler artifact digests, runtime image metadata, RBAC posture, and compatibility annotations.

Use these paths instead:

- plain Kubernetes YAML from `applik8s build`
- integrated TypeKro composition artifacts from `applik8s build <entrypoint> --typekro --composition-name <export>`; use the generated `typekro/apply.sh` so generated CRDs, KRO graphs, and graph instances are applied in a safe order
- TypeKro install composition from `typeKro.composition(operator.definition, manifest, options)`

Lower-level aliases such as `asComposition()`, `toOperationTarget()`, and `asOperationTargetFactory()` remain available for integration authors, but the golden path uses the ergonomic `typeKro.*` names.

TypeKro-backed listeners use resource instances, not factory-level handlers:

```ts
const Deployment = typeKro.resource(simple.Deployment, deploymentOptions);
const app = Deployment({ name: 'app', namespace: 'apps', spec: { replicas: 2 } });

app.on.updated((deployment) => {
  deployment.events.normal('DeploymentUpdated', 'Deployment changed');
});
```

Inside `typeKro.kubernetesComposition(...)`, instance listeners default into `composition.listenerOperator(...)`. Passing an operator as the first listener argument, for example `app.on.updated(platformOperator, handler)`, overrides that grouping explicitly.

Scoped listener groups are explicit Kubernetes watch scopes, not hidden JavaScript object subscriptions:

```ts
const api = Deployment({ name: 'api', namespace: 'apps', spec: { replicas: 2 } });
const worker = Deployment({ name: 'worker', namespace: 'apps', spec: { replicas: 1 } });
const service = Service({ name: 'api', namespace: 'apps', spec: { selector: { app: 'api' } } });

Deployment.instances([api, worker]).on.updated((deployment) => {
  deployment.events.normal('DeploymentUpdated', 'A watched Deployment changed');
});

Deployment.where({ namespace: 'apps', labels: { 'app.kubernetes.io/part-of': 'platform' } }).on.updated(platformOperator, (deployment) => {
  deployment.events.normal('PlatformDeploymentUpdated', 'A selected Deployment changed');
});

typeKro.resources([api, worker, service]).on.deleted(platformOperator, (resource) => {
  resource.events.normal('PlatformResourceDeleted', 'A watched platform resource was deleted');
});
```

These forms lower to manifest watch scopes, generated RBAC, handler exports, and runtime routing rules. Unsupported predicates or unattached listeners fail before artifact emission.

Status from generated CRDs can drive downstream TypeKro resources. For string fields, use the integrated `cel` export so TypeKro preserves the status reference instead of serializing the proxy value:

```ts
import { cel, sdk, typeKro } from '@applik8s/applik8s';
import { ConfigMap } from '@applik8s/applik8s/factories/simple';

const image = pipeline.imageJob({ name: 'hero', spec });
const imageStatus = image.status;
if (!imageStatus) {
  throw new Error('ImageJob status projection is missing.');
}

ConfigMap({
  name: 'status-consumer',
  data: { phase: cel`${imageStatus.phase}` },
});
```

When deploying through KRO, generated applik8s CRDs must be established before a ResourceGraphDefinition that contains their custom resources is accepted by KRO's schema validation. The generated TypeKro `apply.sh` handles this for build artifacts by applying CRDs first, applying `ResourceGraphDefinition` objects next, skipping RGD-owned template resources, applying ordinary remaining resources, and then applying generated KRO instances so KRO renders status-composed resources.

Programmatic `factory('kro').deploy(...)` uses TypeKro's public `kroPrerequisites.resources` support after `composition.resolveOperatorInstalls(...)`, so generated applik8s CRDs are installed before the KRO `ResourceGraphDefinition` without relying on private TypeKro internals.

Inside WASM handler entrypoints, import operation-target helpers from `@applik8s/typekro-adapter/targets` so the handler bundle stays focused on operation-plan rendering instead of TypeKro install/deployment tooling.

Handlers captured from TypeKro compositions are statically serialized into the nested operator dispatcher. The compiler follows reachable top-level helpers and imports across local modules while preserving module scope and import aliases. Factory-local runtime state must still be a concrete recoverable constructor argument; opaque heap closures fail closed before WASM generation, with the handler and unresolved identifier named.

Generated server routes are stricter and more capable than WASM handler serialization. Source-backed `app.server(...)` route handlers can use module-scope and imported helpers when they are resolvable by the route bundler. Unresolved heap closures are still rejected; pass those values through explicit captures, resources, indexes, or ordinary module imports.

Typed live reads in handlers should use the resource object rather than a stringly typed kind lookup when the resource is in scope:

```ts
GuestBookEntry.on.reconcile(async (entry) => {
  const duplicates = await entry.read.resource(GuestBookEntry).list({
    namespace: entry.metadata.namespace,
    labels: {
      'guestbook.applik8s.dev/book': entry.spec.guestbook,
      'guestbook.applik8s.dev/fingerprint': entry.status?.fingerprint ?? '',
    },
  });

  entry.status.phase = duplicates.items.length > 1 ? 'Rejected' : 'Published';
});
```

The generated runtime routes these reads through the `kubernetes-read` host import. The host validates that the resource is declared by the operator, that generated RBAC includes the required `get` or `list` verb, and that namespace/scope and selectors are lowerable before it touches the Kubernetes API.

Resource permission bundles are ordinary generated RBAC rules. Use `Resource.permissions.read()`, `watch()`, `apply()`, `patch()`, `patchStatus()`, `delete()`, `finalize()`, and `manage()` when a permission boundary should be explicit; the compiler and runtime still validate that the generated manifest allows each planned effect before touching Kubernetes.

Generated `app.server(...)` routes use resource-centric CRUD helpers such as `Resource.create(...)`, `Resource.get(...)`, `Resource.query(...)`, `Resource.patch(...)`, `Resource.delete(...)`, and `Resource.increment(...)`. Server RBAC is inferred from those direct method calls and emitted as ordinary Kubernetes Role rules. Computed client access such as `Resource['create'](...)` is rejected; unsupported dynamic usage must be made explicit through `permissions`.

Request-path index reads must stay bounded. Partitioned cached indexes such as `publishedGuestBookEntries.query(bookName, { namespace, limit })` are the preferred spelling. Unpartitioned or unfiltered list-like request paths fail closed during generation.

Do not treat the adapter as a separate deployment model. It consumes the same operator manifest and schema gates as plain YAML generation.
