# applik8s

`applik8s` lets you build applications on the Kubernetes control plane with TypeScript.

You write typed Kubernetes APIs and event listeners. `applik8s` compiles them into a WASM component, packages that component with a Rust operator host, and emits the Kubernetes YAML needed to install the whole thing into a cluster.

The result is not a sidecar script or a long-running Node process. Your TypeScript becomes reconciler logic evaluated by Kubernetes events through a WASM component loaded by a Rust operator.

## A Kubernetes App In TypeScript

This is the shape of the canonical example in `examples/imagejob.ts`: an `ImageJob` API where users ask for image formats and the control plane drives the work.

```ts
import { type as arkType } from 'arktype';
import { sdk } from '@applik8s/sdk';


const imageSpecSchema = arkType({
  sourceUrl: 'string',
  formats: 'string[]',
  priority: "'low' | 'normal' | 'high'",
});
type ImageSpec = typeof imageSpecSchema.infer;

const imageStatusSchema = arkType({
  'phase?': "'Pending' | 'Processing' | 'Complete' | 'Failed'",
  'outputUrls?': 'string[]',
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
  sourceUrl: s3://bucket/hero.png
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
    ImageJob.on.reconcile((job) => {
      job.finalizers.add('media.applik8s.dev/imagejob');
      job.status.phase = 'Processing';
      job.status.outputUrls = job.spec.formats.map((format) => `s3://processed/${job.metadata.name}.${format}`);

      const output = job.k8s.ConfigMap({
        name: job.names.dnsSafe(`${job.metadata.name}-output`),
        ...(job.metadata.namespace ? { namespace: job.metadata.namespace } : {}),
        data: {
          sourceUrl: job.spec.sourceUrl,
          formats: job.spec.formats.join(','),
          priority: job.spec.priority,
        },
      });
      job.apply(output);

      job.events.normal('ImageJobAccepted', 'Image job accepted for processing');
      job.requeue({ afterSeconds: 30, reason: 'WaitingForResizeOutputs' });
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

The listener reads like application code, but it is control-plane code:

- `job.spec` is the typed Kubernetes custom resource spec.
- `job.status.phase = 'Processing'` becomes a status update.
- `job.finalizers.add(...)` keeps deletion safe until cleanup runs.
- `job.k8s.ConfigMap(...)` builds a typed Kubernetes child object and `job.apply(...)` declares it for server-side apply.
- `job.events.normal(...)` records a Kubernetes Event.
- `job.requeue(...)` asks the controller to evaluate the object again later.
- `ImageJob.on.finalize(...)` handles deletion by removing owned resources before the finalizer is removed.

## Build The Operator Bundle

Build the example:

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

## Documentation

- `docs/imagejob-golden-path.md`
- `docs/first-run.md`
- `docs/typekro-golden-path.md`
- `docs/generated-artifacts.md`
- `docs/runtime-diagnostics.md`
- `docs/api-reference.md`
- `docs/troubleshooting.md`
- `docs/kubernetes-compatibility.md`
- `docs/release-evidence-v0.1.md`
- `RECONCILIATION_CONTRACT.md`
- `TESTING.md`
- `RELEASE_NOTES.md`
