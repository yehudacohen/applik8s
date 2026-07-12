import { validateApplicationGraphStructure } from '@applik8s/core';
import { app, applicationGraphFor, command, defineApplicationProvider, event, EventLog, ModelStore } from '@applik8s/applik8s';
import { entity, type } from '@applik8s/applik8s/dsl';
import { canonicalApplicationCommandKey } from '@applik8s/applik8s/processor-runtime';
import { describe, expect, it } from 'vitest';

const AccountEntity = entity('Account', {
  spec: type({ tenant: 'string', email: 'string', displayName: 'string' }),
  status: type({ phase: 'string?' }),
});

const AuditEntity = entity('Audit', {
  spec: type({ tenant: 'string', action: 'string' }),
});

const RenameAccount = command('account.rename.v1', {
  input: type({ tenant: 'string', accountId: 'string', displayName: 'string', requestId: 'string' }),
  output: type({ changed: 'boolean', displayName: 'string' }),
  errors: { accountNotFound: type({ accountId: 'string' }) },
});

const AccountChanged = event('account.changed.v1', {
  payload: type({ tenant: 'string', accountId: 'string', displayName: 'string' }),
});

const ReindexAccount = command('account.reindex.v1', {
  input: type({ accountId: 'string' }),
  output: type({ accepted: 'boolean' }),
});

describe('v0.4 application behavior contracts', () => {
  it('canonicalizes scalar keys to persisted model ids and structured keys deterministically', () => {
    expect(canonicalApplicationCommandKey('account-1')).toBe('account-1');
    expect(canonicalApplicationCommandKey(42)).toBe('42');
    expect(canonicalApplicationCommandKey({ tenant: 'tenant-a', accountId: 'account-1' })).toBe('accountId=account-1&tenant=tenant-a');
  });

  it('records inert commands, committed events, handlers, transaction participants, and inferred processors', () => {
    const platform = app('command-platform', { namespace: 'platform' });
    platform.storage.postgres('command-db', { database: 'command_platform', migrations: 'generated-job' });
    const Account = platform.model(AccountEntity, { schema: { transactions: 'required' } });
    const Audit = platform.model(AuditEntity, { schema: { transactions: 'required' } });

    const binding = Account.on.command(RenameAccount, {
      key: ({ tenant, accountId }) => ({ tenant, accountId }),
      ordering: 'serial',
      processor: { image: 'registry.example.test/applik8s-processor@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      idempotencyKey: ({ requestId }) => requestId,
      missing: 'reject',
      transaction: { models: [Audit], history: [Account], outbox: [AccountChanged] },
    }, async (account, input, context) => {
      if (input.displayName.length === 0) context.reject('accountNotFound', { accountId: input.accountId });
      await context.models.Audit?.create({ id: context.id('audit'), spec: { tenant: input.tenant, action: 'rename' } });
      context.emit(AccountChanged, { tenant: input.tenant, accountId: input.accountId, displayName: input.displayName });
      return { changed: account.spec.displayName !== input.displayName, displayName: input.displayName };
    });

    expect(binding).toMatchObject({ kind: 'applicationModelCommand', model: 'Account', command: 'account.rename.v1', processor: 'Account-commands' });
    const graph = applicationGraphFor(platform.composition);
    expect(graph).toBeDefined();
    expect(graph?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'command', name: 'account.rename.v1', contract: expect.objectContaining({ name: 'account.rename', version: 'v1', input: expect.objectContaining({ jsonSchema: expect.objectContaining({ type: 'object', required: expect.arrayContaining(['accountId', 'displayName']) }) }), output: expect.objectContaining({ jsonSchema: expect.objectContaining({ type: 'object' }) }), errors: [expect.objectContaining({ name: 'accountNotFound', schema: expect.objectContaining({ jsonSchema: expect.objectContaining({ type: 'object' }) }) })] }) }),
      expect.objectContaining({ kind: 'event', name: 'account.changed.v1', contract: expect.objectContaining({ name: 'account.changed', version: 'v1', payload: expect.objectContaining({ jsonSchema: expect.objectContaining({ type: 'object' }) }) }) }),
      expect.objectContaining({ kind: 'commandHandler', ordering: 'serial', missing: 'reject', effectBoundary: 'transactionSafeOnly', retention: { replayWindowSeconds: 604_800, auditWindowSeconds: 2_592_000, publishedOutboxWindowSeconds: 86_400, cleanupIntervalSeconds: 300, cleanupBatchSize: 1_000 }, projectionReadiness: { submissionAcknowledgement: 'transportOnly', durableResultAuthority: 'postgresCommandResults', duplicateRecovery: 'idempotentRedelivery', correlation: 'commandCorrelationCausation', resultRevisionAuthority: 'postgresCommandResults', stateRevisionAuthority: 'modelRevision', reconciliationLink: 'modelRevisionWhenPresent' }, transaction: expect.objectContaining({ models: expect.arrayContaining([{ nodeId: 'model.account' }, { nodeId: 'model.audit' }]), history: [{ nodeId: 'model.account' }], outbox: [{ nodeId: 'event.account.changed.v1' }] }) }),
      expect.objectContaining({ kind: 'processor', runtime: 'node', runtimeImage: 'registry.example.test/applik8s-processor@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', inference: 'generated', handlers: [expect.objectContaining({ nodeId: expect.stringContaining('command-handler.') })] }),
      expect.objectContaining({ kind: 'provider', interface: 'EventLog', implementation: 'nats-jetstream', contract: expect.objectContaining({ support: 'implemented', surface: 'experimentalSurface' }) }),
    ]));
    expect(graph?.providerRequirements).toEqual(expect.arrayContaining([expect.objectContaining({ interface: 'EventLog', purpose: 'eventLog', consumer: { nodeId: 'processor.account-commands' } })]));
    if (!graph) {
      throw new Error('Expected the command platform to materialize an application graph.');
    }
    expect(validateApplicationGraphStructure(graph)).toEqual([]);
    const handlerNode = graph.nodes.find((node) => node.kind === 'commandHandler');
    expect(validateApplicationGraphStructure({
      ...graph,
      nodes: graph.nodes.map((node) => node === handlerNode
        // typecast: this negative fixture simulates an older or malformed serialized command handler.
        ? ({ ...node, projectionReadiness: undefined } as never)
        : node),
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.stringContaining('must retain the v0.4 projection-readiness authority contract') }),
    ]));
  });

  it('enforces the versioned input schema before key calculation, broker publication, or database access', async () => {
    const platform = app('command-schema-platform');
    const Account = platform.model(AccountEntity, { schema: { transactions: 'required' } });
    const binding = Account.on.command(RenameAccount, { key: ({ accountId }) => accountId }, async (_account, input) => ({ changed: false, displayName: input.displayName }));

    // typecast: this adversarial fixture intentionally bypasses TypeScript to exercise the untrusted runtime input boundary.
    await expect(binding.execute({ accountId: 'account-1' } as never, { id: 'invalid-input', databaseUrl: 'postgres://unused' })).rejects.toThrow(/applik8s-message-schema-invalid.*displayName/);
    // typecast: broker publication must independently reject the same deliberately malformed input fixture.
    await expect(binding.send({ accountId: 'account-1' } as never, { id: 'invalid-input' })).rejects.toThrow(/applik8s-message-schema-invalid.*displayName/);
  });

  it('records complete concurrent, routed-target, and transactional command-outbox semantics', () => {
    const platform = app('complete-command-platform');
    const Account = platform.model(AccountEntity, { schema: { transactions: 'required' } });
    Account.on.command(RenameAccount, {
      key: ({ accountId }) => accountId,
      ordering: 'concurrent',
      missing: { route: 'account-fallback' },
      transaction: { commands: [ReindexAccount] },
    }, async (account, input, context) => {
      context.send(ReindexAccount, { accountId: input.accountId }, { targetKey: input.accountId, idempotencyKey: input.requestId });
      return { changed: account.spec.displayName !== input.displayName, displayName: input.displayName };
    });

    const graph = applicationGraphFor(platform.composition);
    expect(graph?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'command', name: 'account.reindex.v1' }),
      expect.objectContaining({
        kind: 'commandHandler',
        ordering: 'concurrent',
        missing: 'route',
        missingRoute: 'account-fallback',
        transaction: expect.objectContaining({ commands: [{ nodeId: 'command.account.reindex.v1' }] }),
        commandBindings: [{ identifier: 'ReindexAccount', command: { nodeId: 'command.account.reindex.v1' } }],
      }),
    ]));
    expect(graph && validateApplicationGraphStructure(graph)).toEqual([]);
  });

  it('accepts versioned external provider contracts without extending the core provider union', () => {
    const WorkflowEngine = defineApplicationProvider<{ readonly kind: 'hatchet'; readonly endpoint: string }>({
      interface: 'WorkflowEngine',
      version: 'v1alpha1',
      guarantees: ['durableTasks', 'durableWorkflows'],
      accepts: (value): value is { readonly kind: 'hatchet'; readonly endpoint: string } => Boolean(value && typeof value === 'object' && Reflect.get(value, 'kind') === 'hatchet' && typeof Reflect.get(value, 'endpoint') === 'string'),
    });
    const platform = app('provider-extension-platform');
    platform.provide(WorkflowEngine, { kind: 'hatchet', endpoint: 'http://hatchet.internal' });
    const graph = applicationGraphFor(platform.composition);
    expect(graph?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'provider', interface: 'WorkflowEngine', implementation: 'hatchet', contract: expect.objectContaining({ apiVersion: 'applik8s.provider/v1alpha1', version: 'v1alpha1', guarantees: ['durableTasks', 'durableWorkflows'] }) }),
    ]));
    // typecast: malformed provider fixture deliberately bypasses the public implementation type to exercise runtime validation.
    expect(() => platform.provide(WorkflowEngine, { kind: 'hatchet' } as never)).toThrow(/does not satisfy versioned provider contract/);
  });

  it('emits one managed Stream requirement unless EventLog infrastructure is explicitly external', () => {
    const managed = app('managed-stream-platform');
    const ManagedAccount = managed.model(AccountEntity, { schema: { transactions: 'required' } });
    ManagedAccount.on.command(RenameAccount, { key: ({ accountId }) => accountId }, async (account, input) => ({ changed: account.spec.displayName !== input.displayName, displayName: input.displayName }));
    const managedGraph = applicationGraphFor(managed.composition);
    expect(managedGraph?.nodes.find((node) => node.kind === 'processor')).toMatchObject({ generatedResources: expect.arrayContaining([
      expect.objectContaining({ role: 'policy', resource: expect.objectContaining({ kind: 'NetworkPolicy', name: 'account-commands' }) }),
      expect.objectContaining({ resource: expect.objectContaining({ kind: 'Stream', name: 'applik8s-events' }) }),
    ]) });

    const external = app('external-stream-platform');
    external.provide(EventLog, { kind: 'nats-jetstream', name: 'external-events', provision: false, servers: ['nats://external-events.messaging.svc:4222'] });
    const ExternalAccount = external.model(AccountEntity, { schema: { transactions: 'required' } });
    ExternalAccount.on.command(RenameAccount, { key: ({ accountId }) => accountId }, async (account, input) => ({ changed: account.spec.displayName !== input.displayName, displayName: input.displayName }));
    const processor = applicationGraphFor(external.composition)?.nodes.find((node) => node.kind === 'processor');
    expect(processor?.kind === 'processor' ? processor.generatedResources?.some((resource) => resource.resource?.kind === 'Stream') : true).toBe(false);
  });

  it('rejects unversioned contracts, ambiguous handlers, nondeterministic keys, and cross-database transactions', () => {
    expect(() => command('account.rename', { input: type({ id: 'string' }), output: type({ ok: 'boolean' }) })).toThrow(/explicit version/);
    expect(() => event('account.changed', { payload: type({ id: 'string' }) })).toThrow(/explicit version/);

    const platform = app('invalid-command-platform');
    const Account = platform.model(AccountEntity, {
      store: ModelStore.postgres({ name: 'accounts', database: 'accounts' }),
      schema: { transactions: 'required' },
    });
    const Audit = platform.model(AuditEntity, {
      store: ModelStore.postgres({ name: 'audit', database: 'audit' }),
      schema: { transactions: 'required' },
    });
    const handler = async (_account: { readonly spec: { readonly displayName: string } }, input: { readonly displayName: string }) => ({ changed: true, displayName: input.displayName });

    expect(() => Account.on.command(RenameAccount, {
      key: ({ accountId }) => accountId,
      transaction: { models: [Audit] },
    }, handler)).toThrow(/multiple physical transaction domains/);

    Account.on.command(RenameAccount, { key: ({ accountId }) => accountId }, handler);
    expect(() => Account.on.command(RenameAccount, { key: ({ accountId }) => accountId }, handler)).toThrow(/already has a handler/);
    const OtherAccount = platform.model(entity('OtherAccount', { spec: AccountEntity.spec }), { schema: { transactions: 'required' } });
    expect(() => OtherAccount.on.command(RenameAccount, { key: ({ accountId }) => accountId }, handler)).toThrow(/exactly one owning handler/);

    const platformWithRandomKey = app('random-key-platform');
    const RandomAccount = platformWithRandomKey.model(AccountEntity, { schema: { transactions: 'required' } });
    expect(() => RandomAccount.on.command(RenameAccount, { key: () => Math.random() }, handler)).toThrow(/must be deterministic/);

    const platformWithInvalidRetention = app('invalid-retention-platform');
    const RetainedAccount = platformWithInvalidRetention.model(AccountEntity, { schema: { transactions: 'required' } });
    expect(() => RetainedAccount.on.command(RenameAccount, { key: ({ accountId }) => accountId, retention: { replayWindowSeconds: 3_600, auditWindowSeconds: 60 } }, handler)).toThrow(/auditWindowSeconds must be an integer >= replayWindowSeconds/);

    const platformWithInvalidProcessorImage = app('invalid-processor-image-platform');
    const InvalidProcessorAccount = platformWithInvalidProcessorImage.model(AccountEntity, { schema: { transactions: 'required' } });
    expect(() => InvalidProcessorAccount.on.command(RenameAccount, { key: ({ accountId }) => accountId, processor: { image: '   ' } }, handler)).toThrow(/processor.image must be a non-empty OCI image reference/);

    const platformWithExternalEffect = app('external-effect-platform');
    const EffectAccount = platformWithExternalEffect.model(AccountEntity, { schema: { transactions: 'required' } });
    expect(() => EffectAccount.on.command(RenameAccount, { key: ({ accountId }) => accountId }, async (_account, input) => {
      await fetch(`https://example.test/${input.accountId}`);
      return { changed: false, displayName: input.displayName };
    })).toThrow(/forbidden while model locks are held/);
  });
});
