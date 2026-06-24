# applik8s

`applik8s` lets you build applications on the Kubernetes control plane with TypeScript.

You write typed Kubernetes APIs and event listeners. `applik8s` compiles them into a WASM component, packages that component with a Rust operator host, and emits the Kubernetes YAML needed to install the whole thing into a cluster.

The result is not a sidecar script or a long-running Node process. Your TypeScript becomes reconciler logic evaluated by Kubernetes events through a WASM component loaded by a Rust operator.

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

Handlers can be `async`. The compiler tree-shakes the TypeScript dependency graph, including the AWS SDK code reached by the handler closure, into the WASM component. The Rust host provides WASI HTTP, so SDK requests run through the component's `fetch` path. Kubernetes mutations still return through the operation plan, so the host can validate RBAC, ownership, status, finalizers, and ordering before effects are applied.

## Build The Operator Bundle

Synthesize an operator bundle from a TypeScript entrypoint:

```sh
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
