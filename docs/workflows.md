# Durable workflows and managed closures

v0.7 has one public durability declaration: `workflow(...)`. Ordinary
closures become managed retryable steps when a workflow calls them. There is
no public task catalog, alias map, or `context.task(...)` indirection.

A named optionless workflow uses `workflow(id, contract, handler)`. Add the
options argument only when the workflow or compiler-owned step needs retry,
timeout, provider, authority, or idempotency metadata. Handles provide direct
invocation, `start`, schedules, result observation, cancellation, and typed
signals.

Hatchet is the first `WorkflowEngine` implementation. Applik8s provisions its pinned chart with an external CNPG database in PostgreSQL-only mode, with RabbitMQ disabled. Hatchet owns operational workflow history. PostgreSQL models and v0.4 command transactions remain canonical application state.

## Effect boundary

Durable orchestration may coordinate captured managed closures and child
workflows, sleep durably, emit or await typed signals, read its history-backed
clock, and observe cancellation. It may not perform external effects directly.
The compiler follows captured module-local helpers and lowers direct operation,
query, provider, and child-workflow calls into retryable steps. Hidden ambient
`fetch`, filesystem, wall-clock, randomness, or timer effects fail compilation.

Managed effects are at-least-once and must be retry-safe. Declare an
idempotency key the external system can honor. Canonical application state
still commits through an authorized model operation or application transaction;
workflow history is not a substitute for that commit.

```ts
platform.provide(WorkflowEngine, WorkflowEngine.hatchet({
  name: 'hatchet',
  namespace: 'platform',
  adminCredentialsSecret: { apiVersion: 'v1', kind: 'Secret', name: 'hatchet-admin', namespace: 'platform' },
  database: { clusterName: 'hatchet-db', database: 'hatchet', storageSize: '8Gi' },
}));

const ReviewTenant = platform.workflow.signal('tenant.review.v1', {
  input: type({ tenantId: 'string' }),
  actions: {
    approve: type({ 'comment?': 'string' }),
    reject: type({ reason: 'string' }),
  },
});
const TenantReviewer = platform.role('tenant-reviewer');
TenantReviewer.can(
  ReviewTenant.read,
  ReviewTenant.approve,
  ReviewTenant.reject,
);
const TenantReviewers = { role: 'tenant-reviewer' } as const;

const provision = platform.workflow(
  'tenant.provision.v1',
  {
    input: type({ tenantId: 'string', requestId: 'string' }),
    output: type({ endpoint: 'string' }),
  },
  {
    retries: 5,
    idempotencyKey: input => input.requestId,
  },
  async (input, context) =>
    provisionTenant(input, context.idempotencyKey, context.signal),
);

const onboard = platform.workflow(
  'tenant.onboard.v1',
  {
    input: type({ tenantId: 'string', requestId: 'string' }),
    output: type({ phase: "'Ready' | 'Rejected'", endpoint: 'string | null' }),
  },
  async (input) => {
    const provisioned = await provision(input, {
      idempotencyKey: input.requestId,
    });
    const review = await platform.workflow.emitSignal(ReviewTenant, {
      input: { tenantId: input.tenantId },
      target: { tenantId: input.tenantId },
      expiresIn: '24h',
      authorize: [TenantReviewers],
    });
    return (await review()).match({
      approve: async () => ({ phase: 'Ready', endpoint: provisioned.endpoint }),
      reject: async () => ({ phase: 'Rejected', endpoint: null }),
      expired: async () => ({ phase: 'Rejected', endpoint: null }),
    });
  },
);

const run = await onboard.start({ tenantId: 'tenant-a', requestId: 'request-1' });
const controller = new AbortController();
const result = await run.result({ signal: controller.signal, timeoutMs: 30_000 });
```

Child calls, signal contracts, action payloads, and durable outcomes are
inferred from direct handles. Generated workers validate payloads before
recording them. Result observation is abortable and deadline-bounded, and
repeated provider read failures terminate with a structured observation error.
Generated durable coordinators receive a one-year orchestration ceiling so
they can remain suspended on signals without inheriting Hatchet's short task
default. Retryable effect steps retain their own independently bounded
execution timeouts; an HTTP or client observation timeout never shortens the
durable run.

## Canonical state access

A managed closure does not receive database, JetStream, gateway, or
identity-provider credentials. It directly calls the smallest canonical
operations and bounded views it needs. The compiler discovers those handles,
derives a bounded execution principal, and rejects hidden or ambiguous
authority.

```ts
const executeAutomation = chirp.workflow('automation.execute.v1', {
  input: ExecuteAutomationInput,
  output: AutomationResult,
}, {
  authority: [
    AutomationRun.create.all(),
    Post.create.all(),
    AutomationRun.update.all(),
  ],
  principal: (input) => ({
    id: input.accountId,
    roles: ['automation-worker'],
    attributes: { automationId: input.automationId },
    authorizationVersion: 'automation-v1',
  }),
}, async (input, context) => {
  const safety = await AutomationControl.current();
  if (!safety.enabled) throw new Error('Automated publication is disabled.');
  const recent = await Post.homeTimeline({ limit: 20 });
  const run = await AutomationRun.create({
    id: context.invocationId,
    automationId: input.automationId,
  });
  // Generate and moderate from bounded `recent`, then call Post.create.
  return { runId: run.identity };
});
```

Direct operations still publish the ordinary versioned command envelope, await
its durable PostgreSQL result, and retain context-scoped idempotency. Direct
queries still pass through the generated query gateway with schema validation,
authorization, snapshot semantics, and budgets. The compiler-owned internal
admission is bound to the exact operation, input, audience, execution principal,
and catalog revision; no credential is exposed to application code.

Recurring schedules are desired state, not an ambient Hatchet client call. A committed event processor receives only its declared schedule aliases and reconciles one deterministic identity with a revision:

```ts
AutomationScheduleChanged.process('reconcile-automation-schedules', {
  schedules: { execute: executeAutomation },
  retry: { maxAttempts: 12, initialDelayMs: 500, maxDelayMs: 60_000 },
  budgets: { timeoutMs: 30_000, maxInputBytes: 64 * 1024 },
}, async (changed, context) => {
  await context.schedules.execute.reconcile({
    id: `automation-${changed.automationId}`,
    expression: changed.schedule,
    revision: String(context.event.sequence),
    enabled: changed.state === 'active',
    input: { automationId: changed.automationId },
  });
});
```

The provider adapter converges create, unchanged, replacement, suspension/deletion, and retry behavior under the processor deadline. Application code names no Hatchet API.

## Authoritative online-projection rebuilds

A generation-scoped online projection may name a promoted PostgreSQL model as its canonical rebuild source.
The model mapper produces the same typed stream payload consumed by the ordinary projection mapper, so
recovery does not introduce a second row schema or a provider-specific bulk-load API:

```ts
const HomeTimeline = PostTimelineChanged
  .project(TimelinePost, (change, output) =>
    change.operation === 'remove'
      ? output.remove({ partition: change.authorId, key: change.postId })
      : output.upsert({
          partition: change.authorId,
          key: change.postId,
          score: Date.parse(change.publishedAt),
          value: change,
        }),
  )
  .rebuildFrom(Post, (post, rebuild) =>
    post.deletedAt === null
      ? rebuild.source({
          operation: 'upsert',
          postId: post.id,
          authorId: post.authorId,
          publishedAt: post.publishedAt,
        })
      : rebuild.skip(),
  )
  .retain({ maxItemsPerPartition: 2_000, maxAge: '30d' });

const buildGeneration = workflow(
  'timeline.rebuild.v1',
  { input: type({ generation: 'string' }), output: RebuildResult },
  { idempotencyKey: input => input.generation },
  async input => HomeTimeline.rebuild(input),
);
```

The generated worker reads the promoted model and committed public-stream watermark from one bounded
PostgreSQL `REPEATABLE READ READ ONLY` MVCC snapshot. Model commands serialize stream-sequence allocation
with commit, so a command excluded from that snapshot is guaranteed to appear after the captured watermark;
the potentially long scan does not hold the commit lock or stall foreground publishing. The worker writes
checksummed immutable segments and a manifest to the declared object store, loads an inactive Valkey
generation, catches up retained events after the captured watermark, and atomically publishes only when the
candidate reaches the active projection checkpoint. The compiler infers the projection effect from
`HomeTimeline.rebuild(...)`; Applik8s owns the immutable evidence store and bounded rebuild defaults.
Advanced configuration remains available without making those mechanics part of ordinary workflow code.

The generation id is an immutable recovery identity. A retry validates the manifest scope, definition
digest, segment references, SHA-256 checksums, counts, and partitions before resuming; it does not rescan
authority after a complete manifest exists. Repeating an already-published generation returns the validated
result without rewriting the projection. A changed mapper or bound must use a new generation, partial
artifacts with different content fail closed, and a retention gap never publishes a partial candidate.
The previous generation and its evidence remain until an explicit retirement operation, providing a bounded
rollback window rather than an implicit garbage-collection promise.

## Generated runtime and infrastructure

Each worker group lowers to a self-contained, minified Node bundle in an immutable OCI build context, a Deployment with health and graceful drain behavior, a disruption budget, and a NetworkPolicy. TypeKro's `container()` boundary builds the content-tagged image before deployment. There is no source ConfigMap, unpack init container, or startup package installation. The pinned Hatchet SDK is bundled; its heartbeat is adapted to an in-process implementation so the single-file bundle does not depend on sibling worker files.

Task workers allow outbound egress by default because tasks are the external-effect boundary. Set `worker.egress: 'sameNamespace'` only when every effect endpoint is deliberately namespace-local. Ingress remains restricted to the worker health port.

Provisioned Hatchet uses the chart-owned `hatchet-client-config` worker token. Users supply a separate external admin Secret with `adminEmail` and `adminPassword`. An external Hatchet installation may instead declare `workerTokenSecret`, `hostPort`, and `apiUrl` with `provision: false`.

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
