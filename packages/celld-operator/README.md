# `@applik8s/celld-operator`

`@applik8s/celld-operator` is the independently consumable Kubernetes control
plane for Celld fleets. It can be used with Applik8s actor applications, with
TypeKro as an installation layer, or directly by platforms that want a typed,
continuously reconciled Celld runtime on Kubernetes.

The operator owns fleet workloads. TypeKro, Alchemy, or GitOps owns only the
singleton operator installation, its CRD and RBAC, application dependencies,
and each `CelldFleet` custom resource. The operator exclusively reconciles the
fleet's StatefulSet, Services, deployment Job, NetworkPolicy,
PodDisruptionBudget, optional ServiceAccount, authoritative status, and
restart-safe finalizer.

## Package boundaries

- `@applik8s/celld-operator` exports the `CelldFleet` CRD contract, operator
  definition, exact Secret contracts, and deterministic child rendering.
- `@applik8s/celld-operator/typekro` exports singleton bootstrap and
  per-application fleet compositions. Omitting `namespace` creates and owns the
  default `applik8s-celld-system` namespace; passing a namespace treats it as
  externally owned.
- `@applik8s/celld-operator/testing` exports conformance fixtures and handler
  proxy recording for provider and lifecycle tests.

## TypeKro installation

```ts
import {
  makeCelldFleetInstallation,
  makeCelldOperatorBootstrap,
} from '@applik8s/celld-operator/typekro';

const controlPlane = makeCelldOperatorBootstrap();
const fleet = makeCelldFleetInstallation('my-application');

await controlPlane.factory('direct').deploy({
  image: 'ghcr.io/example/celld-operator@sha256:<digest>',
  replicas: 2,
});

await fleet.factory('direct').deploy({
  name: 'actors',
  fleet: {
    artifact: {
      image: 'ghcr.io/example/celld-worker@sha256:<digest>',
      manifestDigest: 'sha256:<digest>',
      workerVersion: '0.8.0',
      celldVersion: '0.2.1',
    },
    replicas: 3,
    applicationEndpoint: 'http://application.my-application.svc.cluster.local:8080',
    runtimeSecretRef: {
      name: 'actors-runtime',
      contract: 'applik8s.celld-runtime/v1',
    },
    objectStore: {
      dialect: 's3',
      bucket: 'actors',
      prefix: 'my-application/actors',
      endpoint: 'https://object-storage.example.test',
      region: 'us-east-1',
      credentials: {
        type: 'secret',
        secretRef: {
          name: 'actors-object-store',
          contract: 'applik8s.object-store.s3-credentials/v1',
        },
      },
    },
    rollout: {
      strategy: 'Rolling',
      drainDeadlineSeconds: 300,
      restoreDeadlineSeconds: 600,
      progressDeadlineSeconds: 900,
    },
    deletion: { dataPolicy: 'Retain', drainTimeoutPolicy: 'Block' },
  },
});
```

Applik8s applications normally do not write this installation code. Selecting
the Celld actor provider causes the compiler and deployment graph to install the
shared control plane, publish the generated immutable Worker, create the fleet,
and wait for current-generation status. The explicit surface exists for
platform teams and non-Applik8s Celld users.

## Safety contract

- Every child has one controller owner reference leased to the live
  `CelldFleet` UID. Existing foreign children are never adopted.
- Readiness requires the desired generation, immutable container image ID, and
  the digest-bound runtime manifest reported by every ready replica.
- `artifact.image` accepts a published `repository@sha256:...` reference or a
  digest-only local-engine image ID. Mutable tags are rejected in both forms.
- Rollouts advance only after each partition is ready and free of restore or
  eviction work.
- A completed deployment Job is an artifact-scoped execution receipt, not
  permanent proof that its artifact remains active after a later deployment.
  Returning to an older immutable artifact replays its historical Job before
  the StatefulSet rolls back; runtime pods never advance ahead of a successful
  activation receipt.
- v0.8 permits rolling updates only when the observed Celld version is
  unchanged. The operator automatically promotes every Celld-version
  transition to `Recreate`; application authors cannot accidentally create an
  unqualified mixed-version fleet. Future rolling compatibility entries
  require their own evidence.
- Deletion quiesces new admissions, waits for in-flight work, removes workload
  children, retains external object data, and only then removes the finalizer.
- The operator is cluster-shared. Removing one application fleet never removes
  the singleton operator or CRD used by another fleet.
