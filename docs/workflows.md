# Durable Tasks and Workflows

v0.5 adds provider-neutral durable `task()` and `workflow()` contracts. Definitions are inert until bound inside `app(...)`; app-bound handles provide `run`, `start`, `schedule`, `signal`, result observation, and cancellation.

Hatchet is the first `WorkflowEngine` implementation. Applik8s provisions its pinned chart with an external CNPG database in PostgreSQL-only mode, with RabbitMQ disabled. Hatchet owns operational workflow history. PostgreSQL models and v0.4 command transactions remain canonical application state.

## Effect boundary

External effects belong in tasks. A workflow may coordinate declared tasks and child workflows, sleep durably, wait for declared events, read the workflow clock, and observe cancellation. It may not call `fetch`, databases, Kubernetes clients, the filesystem, wall-clock globals, randomness, or ambient timers directly. The compiler follows captured module-scope helpers and rejects forbidden effects there as well.

Tasks are at-least-once and must be retry-safe. Declare an idempotency key that the external system can honor, and propagate correlation/causation metadata when a workflow calls a task. A completed workflow may call a task that commits canonical state through a v0.4 command or model-transaction API; workflow-engine state is not a substitute for that commit.

```ts
const Provision = task('tenant.provision.v1', {
  input: type({ tenantId: 'string', requestId: 'string' }),
  output: type({ endpoint: 'string' }),
});

const Onboard = workflow('tenant.onboard.v1', {
  input: type({ tenantId: 'string', requestId: 'string' }),
  output: type({ phase: "'Ready' | 'Compensated' | 'NeedsIntervention'" }),
  errors: { rejected: type({ reason: 'string' }) },
  signals: { approval: type({ approved: 'boolean' }) },
});

platform.provide(WorkflowEngine, WorkflowEngine.hatchet({
  name: 'hatchet',
  namespace: 'platform',
  adminCredentialsSecret: { apiVersion: 'v1', kind: 'Secret', name: 'hatchet-admin', namespace: 'platform' },
  database: { clusterName: 'hatchet-db', database: 'hatchet', storageSize: '8Gi' },
}));

const provision = platform.task(Provision, {
  retries: 5,
  idempotencyKey: (input) => input.requestId,
}, async (input, context) => {
  // The external system must treat this key idempotently.
  return provisionTenant(input, context.idempotencyKey, context.signal);
});

const onboard = platform.workflow(Onboard, { tasks: { provision } }, async (input, context) => {
  await context.task('provision', input, { idempotencyKey: input.requestId });
  const approval = await context.waitFor('approval', { lookback: '24h' });
  if (!approval.approved) context.fail('rejected', { reason: 'approval denied' });
  return { phase: 'Ready' };
});

const run = await onboard.start({ tenantId: 'tenant-a', requestId: 'request-1' });
const controller = new AbortController();
const result = await run.result({ signal: controller.signal, timeoutMs: 30_000 });
```

Task aliases, child-workflow aliases, signal names, signal payloads, and named durable errors are inferred from the declarations supplied to `app.workflow`. Generated workers validate named error payloads before recording them; callers receive an `ApplicationDurableError` with a typed `{ name, payload }` descriptor. Result observation is always abortable and deadline-bounded, and repeated provider read failures terminate with a structured observation error.

## Generated runtime and infrastructure

Each worker group lowers to a self-contained, minified Node bundle stored as gzip `ConfigMap.binaryData`, an init container that unpacks it, a Deployment with health and graceful drain behavior, a disruption budget, and a NetworkPolicy. There is no startup package installation. The pinned Hatchet SDK is bundled; its heartbeat is adapted to an in-process implementation so the single-file bundle does not depend on sibling worker files.

Task workers allow outbound egress by default because tasks are the external-effect boundary. Set `worker.egress: 'sameNamespace'` only when every effect endpoint is deliberately namespace-local. Ingress remains restricted to the worker health port.

Provisioned Hatchet uses the chart-owned `<name>-client-config` worker token. Users supply a separate external admin Secret with `adminEmail` and `adminPassword`. An external Hatchet installation may instead declare `workerTokenSecret`, `hostPort`, and `apiUrl` with `provision: false`.

## Supported v0.5 lifecycle

- bounded retries and exponential backoff
- task and workflow `run`, `start`, and schedule operations
- durable sleep and external-event waits
- child task and child workflow calls
- cancellation and graceful worker drain
- correlation, causation, and trace metadata propagation
- fixed replicas
- compensation in declared tasks and explicit `NeedsIntervention` outcomes

The release does not promise exactly-once effects, cross-provider transactions, or canonical state stored only in Hatchet. The OrbStack gate is `bun run check:v05:prerelease:orbstack`.

KEDA Hatchet task-stat scaling and multi-replica Hatchet/CNPG topology are an experimental manifest-lowering surface in v0.5. Their generated contracts have local coverage, but automatic scaling behavior and control-plane/database failover are not production claims until dedicated live evidence is added. Manual worker replicas and bounded per-replica slots are the supported v0.5 scaling path.
