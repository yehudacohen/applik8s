# First Run

This is the fastest way to see the v0.1 promise end to end: tiny TypeScript, generated Kubernetes artifacts, WASM handler code, and a Rust operator runtime.

## 1. Install Dependencies

```sh
bun install
```

## 2. Read The App

The canonical source is `examples/imagejob.ts`.

The core handler shape is deliberately small:

```ts
ImageJob.on.reconcile((job) => {
  job.finalizers.add('media.applik8s.dev/imagejob');
  job.status.phase = 'Processing';

  const output = job.k8s.ConfigMap({
    name: job.names.dnsSafe(`${job.metadata.name}-output`),
    ...(job.metadata.namespace ? { namespace: job.metadata.namespace } : {}),
    data: { sourceUrl: job.spec.sourceUrl },
  });

  job.apply(output);
  job.events.normal('ImageJobAccepted', 'Image job accepted for processing');
  job.requeue({ afterSeconds: 30, reason: 'WaitingForResizeOutputs' });
});
```

That code does not mutate Kubernetes directly. It records an operation plan that the Rust runtime validates before applying effects.

## 3. Prove It Locally

```sh
bun run test:imagejob
```

This tests the same source without a cluster. It asserts the CRD schema, RBAC, finalizers, ConfigMap apply/delete, status, Event, requeue policy, generated artifacts, and TypeKro composition shape.

## 4. Build The Operator Bundle

```sh
bun run build:imagejob
```

Inspect the generated output:

```sh
ls dist/applik8s
ls dist/applik8s/kubernetes
```

The bundle contains `operator-manifest.json`, WASM, WIT/runtime contract files, source maps, Kubernetes YAML, a Dockerfile, and an apply script.

## 5. Optional Live Proof

Use only a disposable local cluster context. The live test builds the runtime image, installs the generated operator, creates an `ImageJob`, waits for status/events/log evidence, finalizes cleanup, and removes test resources.

```sh
APPLIK8S_E2E_CONTEXT=orbstack bun run test:readme-live
```

## 6. What You Just Proved

- TypeScript schemas became a real Kubernetes CRD.
- Proxy handler assignments became an explicit operation plan.
- The compiler emitted a WASM component and inspectable Kubernetes YAML.
- The Rust host loaded the WASM handler and applied Kubernetes effects.
- Runtime status, Events, structured logs, finalizers, and cleanup were all exercised by executable tests.

Next: read `docs/generated-artifacts.md` to map each handler line to the emitted artifact and runtime behavior.
