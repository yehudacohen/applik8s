# ImageJob Golden Path

The canonical tutorial source is `examples/imagejob.ts`. The product-story test in `examples/test/product-stories.character.test.ts` imports that same file, runs it through the local harness, compiles it, and verifies the generated artifact layout.

## Local Test

Run the executable product story with:

```sh
bun run test:imagejob
```

The local harness proves the handler records:

- finalizer add before side effects
- AWS SDK reads and writes against an S3-compatible endpoint through `fetch`
- ConfigMap creation through `job.k8s.ConfigMap({ data })` and apply through `job.apply(output)`
- status update
- Kubernetes Event
- finalizer cleanup and child delete during finalize with `job.delete(job.k8s.ConfigMap(...))`
- declared RBAC, CRD schema, and operator manifest metadata that are knowable without a cluster

The important authoring shape is intentionally small:

```ts
const output = job.k8s.ConfigMap({
  name: job.names.dnsSafe(`${job.metadata.name}-output`),
  namespace: job.metadata.namespace,
  data: { outputUrls: outputs.map((output) => output.url).join(',') },
});

job.apply(output);
```

That factory emits a normal Kubernetes `ConfigMap`; it is not a hidden client call. The handler still returns an operation plan, and the Rust runtime validates and applies the effect later.

## Compile

Compile the same source with the thin CLI:

```sh
bun run build:imagejob
```

Equivalent library call:

```ts
import { createCompilerPipeline } from '@applik8s/compiler';

await createCompilerPipeline().run({
  entrypoint: 'examples/imagejob.ts',
  outDir: 'dist/applik8s',
  runtimeVersionRange: '^0.1.0',
  handlerAbiVersion: 'applik8s.handler/v1alpha1',
  adapter: 'wasmComponent',
  portability: {
    deterministicBuild: true,
    allowEnvironmentAccess: false,
    allowFilesystemAccess: false,
    allowNetworkAccess: true,
    allowedHostImports: [],
    sourceMaps: { emit: true, includeSourceContent: false, redactPaths: false },
  },
});
```

## Generated Artifacts

The compiler emits:

- `operator-manifest.json`
- `contract/applik8s-handler.wit`
- `contract/runtime-contract.json`
- `wasm/handler.wasm`
- `bundle/handler.js`
- `bundle/handler.js.map`
- Kubernetes YAML under `kubernetes/`
- `Dockerfile.applik8s-runtime`
- `apply.sh`

See `docs/generated-artifacts.md` for the file-by-file walkthrough.

## Live Deploy

Live deployment is intentionally opt-in because it builds images and mutates the current Kubernetes context.

Use a pinned context:

```sh
APPLIK8S_E2E_LIVE=1 APPLIK8S_E2E_CONTEXT=orbstack bunx vitest run --config vitest.e2e.config.ts packages/e2e/test/live-reconcile.e2e.test.ts
```

For a manual deploy after compiling:

```sh
APPLIK8S_IMAGE=applik8s/image-pipeline-operator:dev dist/applik8s/apply.sh
kubectl apply --server-side --field-manager=applik8s-tutorial --filename - <<'YAML'
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

## Cleanup

```sh
kubectl delete imagejob hero-image --namespace media --ignore-not-found=true
kubectl delete --filename dist/applik8s/kubernetes --ignore-not-found=true
```

The finalize handler deletes the owned output ConfigMap before removing the `media.applik8s.dev/imagejob` finalizer. Output objects are application data and are not deleted by the example finalizer.
