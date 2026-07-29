# Durable model operations

Promoted Drizzle models derive durable `Model.create`, `Model.update`, and `Model.delete` operations directly
from the table declaration. PostgreSQL owns idempotency, durable results, revisions, history, and the
transactional outbox. JetStream provides acknowledged at-least-once delivery; a broker acknowledgement is
not a completed operation result.

## Conventional lifecycle

Use the conventional operation for CRUD-shaped facts and attach transaction-authoritative validation or
derivation with `beforeCommit`. React to the committed fact with the corresponding typed lifecycle handler:

```ts
const Account = application.model(accounts, { name: 'Account', database: Database });

Account.create.beforeCommit({
  history: true,
  events: [AccountChanged],
}, async (account, input, context) => {
  if (context.principal?.id !== input.id) throw new Error('Account identity must match the principal.');
  account.patch({ spec: { joinedAt: context.now } });
  context.emit(AccountChanged, { accountId: account.id, changedAt: context.now });
});

Account.on.create('initialize-account', {
  processor: { replicas: 1, concurrency: 8 },
  retry: { maxAttempts: 5, deadLetter: true },
}, async (created, context) => {
  // created.value, created.identity, created.revision, and context are typed.
});
```

Create events contain the committed value; update events contain `previous` and `current`; delete events
contain the previous value and a typed tombstone. Lifecycle processing shares the same versioned event,
transactional outbox, replay, bounded processor, retry, and dead-letter machinery as explicit events.

The table remains the Drizzle table by identity. If a native table member collides with a convenience name
such as `create` or `on`, the Drizzle member wins and the complete model API remains available through the
symbol facet:

```ts
import { applicationModelFacet } from '@applik8s/applik8s';

const model = Account[applicationModelFacet].api;
await model.create(input);
model.on.create('initialize-account', options, handler);
```

## Ordering and missing targets

- Serial execution acquires an authoritative target-scoped PostgreSQL transaction lock before reading or
  changing the model.
- Concurrent execution uses an optimistic revision predicate. A conflict rolls the transaction back and
  reruns deterministic work under its bounded retry policy.
- Operations for different identities can overlap; serialization is target-scoped, not processor-wide.
- A rejected missing target produces a durable, replayable `targetMissing` result.
- An initializer creates a missing target inside the same transaction.
- A fallback route changes the effective target inside the same model; history and outboxes refer to that
  effective target.

Conventional CRUD operations select safe framework defaults. A genuinely exceptional operation can declare
different ordering or missing-target semantics explicitly.

## Exceptional domain operations

When CRUD, a task, or a workflow does not describe the behavior, declare one exceptional operation. The
single declaration derives both the callable method and its typed committed completion event:

```ts
const Account = application
  .model(accounts, { name: 'Account', database: Database })
  .action('rotateRecoveryCodes', RotateRecoveryCodes, {
    key: ({ accountId }) => accountId,
    ordering: 'serial',
    history: true,
  }, async (account, input, context) => {
    const result = await rotateCodesDeterministically(account, input, context);
    account.patch({ spec: { recoveryCodesRevision: result.revision } });
    return result;
  });

await Account.rotateRecoveryCodes(input);

Account.on.rotateRecoveryCodes('audit-recovery-code-rotation', processorOptions, async (completed) => {
  // completed.previous, completed.current, completed.result, identity, and revision are typed.
});
```

Do not introduce an `.actions({...})` registry or a second completion event. Ordinary domain code uses
direct lifecycle mutations or a named `Model.action(...)`. The lower-level `Model.on.command(...)` and
`Model.on.action(...)` registrars remain available for explicit protocol integration and framework
internals, but do not belong in golden-path examples.

## Transactional outboxes

Declare explicit domain events under `events` or `transaction.outbox`, and follow-up operations under
`transaction.commands`. Handlers use `context.emit(...)` and `context.send(...)`; undeclared contracts and
schema-invalid payloads fail before commit.

```ts
Post.create.beforeCommit({
  history: true,
  events: [PostPublished],
  transaction: { models: [Account], commands: [CreateNotification] },
}, async (post, input, context) => {
  context.emit(PostPublished, { postId: post.id, authorId: post.value.authorId });
  context.send(CreateNotification, notificationFor(post), {
    targetKey: post.id,
    idempotencyKey: context.id('publication-notification'),
  });
});
```

Event and command relays use stable message IDs. A crash after publish but before database acknowledgement
safely republishes the same ID.

## Processor runtime image

Inferred processors are bundled into content-addressed OCI images built from a multi-architecture,
digest-pinned Node runtime. Applications that mirror or harden their runtime can override the base through
processor options; handlers sharing an inferred processor must agree on the same base. The generated
manifest records the base, OCI recipe, source digest, and resolved workload image. Processor source is never
transported through an executable ConfigMap.

## Transaction effect boundary

Transactional hooks may use their target, declared transaction-scoped models, deterministic computation,
`context.now`, `context.id`, and declared outboxes. Generation rejects ambient I/O, wall-clock/random
globals, dynamic code, and Node-global escape routes. The runtime also installs an async-context membrane
over ambient network and process escape points. This is a supported callback contract, not a hostile-code
sandbox. External work belongs in durable tasks or follow-up operations outside the database transaction.

## Versioned providers

Provider packages can define new interfaces without editing the core provider union:

```ts
const WorkflowEngine = defineApplicationProvider<HatchetProvider>({
  interface: 'WorkflowEngine',
  version: 'v1alpha1',
  guarantees: ['durableTasks', 'durableWorkflows'],
  accepts: isHatchetProvider,
});

application.provide(WorkflowEngine, hatchetProvider);
```

The application graph records provider contract versions, requirements, guarantees, implementation
identity, and compatibility surface.
