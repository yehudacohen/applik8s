# Connection-scoped Kubernetes operations

Connection-scoped Kubernetes execution lets one Applik8s reconciliation read or mutate resources
through an installation-authorized Kubernetes connection. It is a bounded execution capability, not a
cluster registry or multi-cluster workflow engine.

## Portable declaration

An operator declares a logical alias and its permission envelope. It does not declare a Secret or API
endpoint:

```ts
const Deployment = sdk.kubernetes.resource({
  apiVersion: 'apps/v1', kind: 'Deployment', plural: 'deployments',
  namespaces: ['payments'], access: 'connection',
});

const operator = sdk.operator({
  // ...
  reads: { Deployment },
  capabilities: {
    destination: sdk.kubernetes.connection.required({
      endpointPolicy: 'workload-cluster-apis',
      permissions: [{
        apiGroups: ['apps'],
        resources: ['deployments'],
        // Managed apply performs a guarded get followed by create or patch.
        verbs: ['get', 'list', 'create', 'patch', 'delete'],
        namespaces: ['payments'],
      }],
    }),
  },
});
```

Connection-capable bundles require host protocol `>=0.1.1, <0.2.0`. This protocol version is
independent of the Applik8s package release version, so existing `^0.1.0` bundles remain compatible.
Older hosts reject the bundle before handler invocation.

## Handler API

Handlers bind a scope once and use it for typed reads and planned mutations:

```ts
const destination = ctx.kubernetes.connection('destination');
const deployment = await destination.read.resource(Deployment).get({
  namespace: 'payments',
  name: 'api',
});

destination.resources.patch(
  { apiVersion: 'apps/v1', kind: 'Deployment', namespace: 'payments', name: 'api' },
  patch,
  {
    authority: {
      mode: 'existing',
      precondition: {
        uid: deployment.metadata.uid!,
        resourceVersion: deployment.metadata.resourceVersion!,
      },
    },
  },
);
```

Remote lists must specify `limit` from 1 through 500. They return a continuation token for the next
page. Status, events, finalizers, watches, and reconciliation ownership remain local.

## Installation binding

Portable compilation emits only the requirement. An installation build accepts a JSON alias map via
`applik8s build --connection-bindings ./connections.json`; the compiler binds it before emitting the
manifest, RBAC, plain Kubernetes YAML, or TypeKro artifacts. The lower-level equivalent is
`bindKubernetesConnections(...)`:

```ts
const installedManifest = bindKubernetesConnections(bundleManifest, {
  destination: {
    kubeconfigSecretRef: {
      name: 'destination-kubeconfig',
      namespace: 'operator-system',
      key: 'kubeconfig',
    },
    context: 'destination',
    endpointPolicy: {
      name: 'workload-cluster-apis',
      version: '1',
      scheme: 'https',
      hosts: ['api.destination.example'],
      ports: [6443],
      tlsServerNames: ['api.destination.example'],
      redirects: 'deny',
    },
  },
});
```

The binding set must exactly match the declared Kubernetes aliases. The binding helper adds an exact
`secrets/get` rule using `resourceNames`. In v1, the connection Secret must be in the operator
namespace.

## Accepted kubeconfig profile

The Secret type is `applik8s.dev/kubeconfig`. Its selected kubeconfig must contain exactly one context,
one cluster, and one user. It must use HTTPS, inline CA data, and either an inline bearer token or an
inline client certificate/key pair.

The host rejects exec and auth-provider plugins, file references, proxies, insecure TLS, username and
password authentication, impersonation, TLS server-name overrides, redirects, unrelated entries,
extensions, and unknown fields. It never writes a temporary kubeconfig.

## Mutation authority

Remote Kubernetes owner references are forbidden. Mutation authority is separate:

- `managed` creates resources with stable Applik8s management identity. Existing same-name resources
  are updated or deleted only after that identity is proven. The host requires `sourceUid` to equal
  the reconciled object's UID and scopes the stored identity by operator and connection alias.
- `existing` preserves external lifecycle ownership and requires UID and resource-version evidence.
  Patch and delete fail if the object was changed or replaced.

A v1 mutation plan may target at most one remote connection. Local status, events, finalizers, and
requeue operations may coexist with that remote scope. All connection and permission checks complete
before any mutation starts; no cross-cluster atomicity is implied.

## Lease and rotation behavior

The host resolves a connection once per handler invocation. Reads and writes use the same pinned
Secret UID, Secret resource version, context, endpoint policy, and compiled binding revision. Before
executing a plan, the host reloads the Secret and compares it with the pinned lease. A Secret change
returns `CONNECTION_BINDING_CHANGED` and performs no mutation. The next invocation uses the rotated
credential without rebuilding or restarting the operator. Changing the installation binding itself
requires regenerating and deploying the installation artifacts.

Credential bytes never enter handler input, operation plans, WASM artifacts, replay payloads, domain
status, events, or telemetry.
