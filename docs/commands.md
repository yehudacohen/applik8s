# Durable model commands

`Model.on.command()` binds a versioned command to one authoritative model transaction. PostgreSQL owns idempotency, durable results, model revisions, history, transitions, and event/command outboxes. JetStream is acknowledged at-least-once transport; a broker acknowledgement is not a completed command result.

## Ordering

- `ordering: 'serial'` acquires an authoritative target-scoped PostgreSQL transaction lock before reading or changing the model.
- `ordering: 'concurrent'` allows handlers for the same target to overlap. The final update uses an optimistic revision predicate. A conflict rolls the whole transaction back and reruns the deterministic handler under its bounded retry policy.
- Commands for different keys can overlap in either mode; serialization is keyed, not processor-wide.

## Missing targets

- `missing: 'reject'` records and replays a durable `targetMissing` outcome.
- `missing: { initialize }` creates the submitted key inside the command transaction before invoking the handler.
- `missing: { route: 'fallback-key' }` routes a missing submitted key to that alternate key in the same model and transaction. Expected revisions, observations, history, emitted facts, and state-revision links refer to the effective alternate key.

## Transactional outboxes

Declare events under `transaction.outbox` and follow-up commands under `transaction.commands`. Handlers use `context.emit(...)` and `context.send(...)`; undeclared contracts and schema-invalid payloads fail before commit.

```ts
Account.on.command(RenameAccount, {
  key: ({ accountId }) => accountId,
  ordering: 'concurrent',
  missing: { route: 'default-account' },
  transaction: {
    history: [Account],
    outbox: [AccountChanged],
    commands: [ReindexAccount],
  },
}, async (account, input, context) => {
  account.patch({ spec: { displayName: input.displayName } });
  context.emit(AccountChanged, { accountId: account.id });
  context.send(ReindexAccount, { accountId: account.id }, {
    targetKey: account.id,
    idempotencyKey: input.requestId,
  });
  return { changed: true };
});
```

Event and command relays use stable message IDs. A crash after publish but before database acknowledgement safely republishes the same ID.

## Transaction effect boundary

Transactional handlers may use their target, declared transaction-scoped model participants, deterministic computation, `context.now`, `context.id`, and declared outboxes. Source analysis rejects direct external effects, while the Node runtime independently denies `fetch` reached through dynamic global access during handler execution. External work belongs in durable tasks or follow-up commands outside the transaction.

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

The application graph records the provider contract version, requirements, guarantees, implementation identity, and compatibility surface.
