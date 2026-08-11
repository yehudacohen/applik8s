// typecast-file-boundary: vertical fixtures intentionally inspect erased command metadata after asserting its discriminators.
import { app, applicationGraphFor, command, defineApplicationProvider, EventLog, event, TransactionalDatabase } from '@applik8s/applik8s';
import { entity, type } from '@applik8s/applik8s/dsl';
import { canonicalApplicationCommandKey } from '@applik8s/applik8s/processor-runtime';
import { validateApplicationGraphStructure } from '@applik8s/core';
import { describe, expect, it } from 'vitest';
import { parseAllDocuments } from 'yaml';
import { applicationModelCommandRegistrar } from '../src/application-models.js';

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

  it('does not expose the retired command, operation, or action registries on schema-backed models', () => {
    const platform = app('direct-action-platform');
    platform.storage.postgres('action-db', { database: 'direct_actions' });
    const Account = platform.model(AccountEntity, { schema: { transactions: 'required' } });
    expect(Reflect.has(Account, 'command')).toBe(false);
    expect(Reflect.has(Account, 'operation')).toBe(false);
    expect(Reflect.has(Account, 'action')).toBe(false);
    expect(Reflect.has(Account.on, 'command')).toBe(false);
    expect(Reflect.has(Account.on, 'operation')).toBe(false);
    expect(Reflect.has(Account.on, 'action')).toBe(false);
  });

  it('records inert commands, committed events, handlers, transaction participants, and inferred processors', () => {
    const platform = app('command-platform', { namespace: 'platform' });
    platform.storage.postgres('command-db', { database: 'command_platform', migrations: 'generated-job' });
    const Account = platform.model(AccountEntity, { schema: { transactions: 'required' } });
    const Audit = platform.model(AuditEntity, { schema: { transactions: 'required' } });

    const binding = applicationModelCommandRegistrar(Account)!(RenameAccount, {
      key: ({ tenant, accountId }) => ({ tenant, accountId }),
      ordering: 'serial',
      processor: {
        image: 'registry.example.test/applik8s-processor@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        replicas: 3,
        concurrency: 4,
        resources: { requests: { cpu: '100m', memory: '192Mi' }, limits: { cpu: '2', memory: '768Mi' } },
        nodeSelector: { 'kubernetes.io/os': 'linux' },
      },
      idempotencyKey: ({ requestId }) => requestId,
      missing: 'reject',
      transaction: { models: [Audit], history: [Account], outbox: [AccountChanged] },
    }, async (account, input, context) => {
      if (input.displayName.length === 0) context.reject('accountNotFound', { accountId: input.accountId });
      await context.models.Audit?.create({ id: context.id('audit'), spec: { tenant: input.tenant, action: 'rename' } });
      context.emit(AccountChanged, { tenant: input.tenant, accountId: input.accountId, displayName: input.displayName });
      return { changed: account.spec.displayName !== input.displayName, displayName: input.displayName };
    });
    applicationModelCommandRegistrar(Account)!(ReindexAccount, {
      key: ({ accountId }) => accountId,
      processor: { image: 'registry.example.test/applik8s-processor@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    }, async () => ({ accepted: true }));

    expect(binding).toMatchObject({ kind: 'applicationModelCommand', model: 'Account', command: 'account.rename.v1', processor: 'Account-commands' });
    const graph = applicationGraphFor(platform.composition);
    expect(graph).toBeDefined();
    expect(graph?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'command', name: 'account.rename.v1', contract: expect.objectContaining({ name: 'account.rename', version: 'v1', input: expect.objectContaining({ jsonSchema: expect.objectContaining({ type: 'object', required: expect.arrayContaining(['accountId', 'displayName']) }) }), output: expect.objectContaining({ jsonSchema: expect.objectContaining({ type: 'object' }) }), errors: [expect.objectContaining({ name: 'accountNotFound', schema: expect.objectContaining({ jsonSchema: expect.objectContaining({ type: 'object' }) }) })] }) }),
      expect.objectContaining({ kind: 'event', name: 'account.changed.v1', contract: expect.objectContaining({ name: 'account.changed', version: 'v1', payload: expect.objectContaining({ jsonSchema: expect.objectContaining({ type: 'object' }) }) }) }),
      expect.objectContaining({ kind: 'commandHandler', ordering: 'serial', missing: 'reject', effectBoundary: 'transactionSafeOnly', effectEnforcement: { sourceAnalysis: 'closedStructuralAllowlist', runtimeMembrane: 'asyncContextAmbientIo', externalEffects: 'outboxOrTaskOnly' }, retention: { replayWindowSeconds: 604_800, auditWindowSeconds: 2_592_000, publishedOutboxWindowSeconds: 86_400, cleanupIntervalSeconds: 300, cleanupBatchSize: 1_000 }, projectionReadiness: { submissionAcknowledgement: 'transportOnly', durableResultAuthority: 'postgresCommandResults', duplicateRecovery: 'idempotentRedelivery', correlation: 'commandCorrelationCausation', resultRevisionAuthority: 'postgresCommandResults', stateRevisionAuthority: 'modelRevision', reconciliationLink: 'modelRevisionWhenPresent' }, transaction: expect.objectContaining({ models: expect.arrayContaining([{ nodeId: 'model.account' }, { nodeId: 'model.audit' }]), history: [{ nodeId: 'model.account' }], outbox: expect.arrayContaining([{ nodeId: 'event.account.changed.v1' }]) }) }),
      expect.objectContaining({ kind: 'processor', runtime: 'node', runtimeImage: 'registry.example.test/applik8s-processor@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', deployment: { replicas: 3, concurrency: 4, maxAckPending: 12, resources: { requests: { cpu: '100m', memory: '192Mi' }, limits: { cpu: '2', memory: '768Mi' } }, disruption: { maxUnavailable: 1 }, nodeSelector: { 'kubernetes.io/os': 'linux' } }, inference: 'generated', handlers: expect.arrayContaining([expect.objectContaining({ nodeId: expect.stringContaining('command-handler.') })]) }),
      expect.objectContaining({ kind: 'provider', interface: 'EventLog', implementation: 'nats-jetstream', contract: expect.objectContaining({ support: 'implemented', surface: 'stablePublicApi' }) }),
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
    expect(validateApplicationGraphStructure({
      ...graph,
      nodes: graph.nodes.map((node) => node === handlerNode
        // typecast: this negative fixture simulates an older handler without the executable enforcement contract.
        ? ({ ...node, effectEnforcement: undefined } as never)
        : node),
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.stringContaining('must retain structural source enforcement') }),
    ]));
  });

  it('co-locates compatible model commands in one explicitly named bounded processor', () => {
    const platform = app('grouped-command-platform', { namespace: 'platform' });
    platform.storage.postgres('command-db', { database: 'grouped_commands' });
    const Account = platform.model(AccountEntity, { schema: { transactions: 'required' } });
    const Audit = platform.model(AuditEntity, { schema: { transactions: 'required' } });
    const processor = { group: 'domain-commands', replicas: 1, concurrency: 16 } as const;
    applicationModelCommandRegistrar(Account)!(RenameAccount, { key: ({ accountId }) => accountId, processor }, async (_account, input) => ({ changed: false, displayName: input.displayName }));
    applicationModelCommandRegistrar(Audit)!(ReindexAccount, { key: ({ accountId }) => accountId, processor }, async () => ({ accepted: true }));

    const processors = applicationGraphFor(platform.composition)?.nodes.filter((node) => node.kind === 'processor');
    expect(processors).toEqual([
      expect.objectContaining({
        name: 'domain-commands',
        deployment: expect.objectContaining({ replicas: 1, concurrency: 16, maxAckPending: 16 }),
        handlers: expect.arrayContaining([
          { nodeId: 'command-handler.account-account.rename.v1' },
          { nodeId: 'command-handler.audit-account.reindex.v1' },
        ]),
      }),
    ]);
  });

  it('preserves typed installation capacity in the generated command processor contract', () => {
    const platform = app('profiled-command-platform', {
      apiVersion: 'applications.example.test/v1alpha1',
      kind: 'ProfiledCommandPlatform',
      spec: type({ profile: "'starter' | 'dedicated'" }),
      status: type({ ready: 'boolean' }),
      namespace: () => 'platform',
    });
    platform.storage.postgres('command-db', { database: 'profiled_commands' });
    const Account = platform.model(AccountEntity, { schema: { transactions: 'required' } });
    const replicas = platform.select(platform.installation.spec.profile, { starter: 1, dedicated: 3, default: 1 });
    const concurrency = platform.select(platform.installation.spec.profile, { starter: 8, dedicated: 32, default: 8 });
    const memory = platform.select(platform.installation.spec.profile, { starter: '128Mi', dedicated: '512Mi', default: '128Mi' });
    applicationModelCommandRegistrar(Account)!(RenameAccount, {
      key: ({ accountId }) => accountId,
      processor: { replicas, concurrency, resources: { requests: { memory } } },
    }, async (_account, input) => ({ changed: false, displayName: input.displayName }));

    const processor = applicationGraphFor(platform.composition)?.nodes.find((node) => node.kind === 'processor');
    expect(processor).toMatchObject({
      kind: 'processor',
      deployment: {
        replicas: expect.stringMatching(/^\$\{\(?schema\.spec\.profile\)?/),
        concurrency: expect.stringMatching(/^\$\{\(?schema\.spec\.profile\)?/),
        maxAckPending: expect.stringMatching(/^\$\{\(.+\) \* \(.+\)\}$/),
        resources: { requests: { memory: expect.stringMatching(/^\$\{\(?schema\.spec\.profile\)?/) } },
      },
    });
    expect(processor?.kind === 'processor' ? processor.deployment : undefined).toMatchObject({
      replicas: expect.stringMatching(/\? \(1\).*\? \(3\)/),
      concurrency: expect.stringMatching(/\? \(8\).*\? \(32\)/),
      resources: {
        requests: {
          memory: expect.stringMatching(/\? \(\"128Mi\"\).*\? \(\"512Mi\"\)/),
        },
      },
    });
  });

  it('enforces the versioned input schema before key calculation, broker publication, or database access', async () => {
    const platform = app('command-schema-platform');
    const Account = platform.model(AccountEntity, { schema: { transactions: 'required' } });
    const binding = applicationModelCommandRegistrar(Account)!(RenameAccount, { key: ({ accountId }) => accountId }, async (_account, input) => ({ changed: false, displayName: input.displayName }));

    // typecast: this adversarial fixture intentionally bypasses TypeScript to exercise the untrusted runtime input boundary.
    await expect(binding.execute({ accountId: 'account-1' } as never, { id: 'invalid-input', databaseUrl: 'postgres://unused' })).rejects.toThrow(/applik8s-message-schema-invalid.*displayName/);
    // typecast: broker publication must independently reject the same deliberately malformed input fixture.
    await expect(binding.send({ accountId: 'account-1' } as never, { id: 'invalid-input' })).rejects.toThrow(/applik8s-message-schema-invalid.*displayName/);
  });

  it('records complete concurrent, routed-target, and transactional command-outbox semantics', () => {
    const platform = app('complete-command-platform');
    const Account = platform.model(AccountEntity, { schema: { transactions: 'required' } });
    applicationModelCommandRegistrar(Account)!(RenameAccount, {
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
    applicationModelCommandRegistrar(ManagedAccount)!(RenameAccount, { key: ({ accountId }) => accountId }, async (account, input) => ({ changed: account.spec.displayName !== input.displayName, displayName: input.displayName }));
    const managedGraph = applicationGraphFor(managed.composition);
    expect(managedGraph?.nodes.find((node) => node.kind === 'processor')).toMatchObject({ generatedResources: expect.arrayContaining([
      expect.objectContaining({ role: 'policy', resource: expect.objectContaining({ kind: 'NetworkPolicy', name: 'account-commands' }) }),
      expect.objectContaining({ resource: expect.objectContaining({ kind: 'Stream', name: 'applik8s-events' }) }),
    ]) });
    expect(
      managedGraph?.nodes.find(
        (node) => node.kind === 'provider' && node.interface === 'EventLog',
      ),
    ).toMatchObject({
      config: {
        name: 'applik8s-events',
        provision: true,
        replicas: 1,
        storageSize: '8Gi',
        pvcRetentionPolicy: 'retain',
      },
    });
    const managedFactory = managed.composition.factory('kro');
    const managedDefinitions = parseAllDocuments(
      managedFactory.toYaml(),
    ).map((document) => document.toJSON()) as {
      readonly apiVersion?: string;
      readonly kind?: string;
      readonly metadata?: { readonly name?: string };
      readonly spec?: Record<string, unknown> & {
        readonly resources?: readonly {
          readonly template?: {
            readonly kind?: string;
            readonly metadata?: { readonly name?: string };
            readonly spec?: { readonly values?: unknown };
          };
        }[];
      };
    }[];
    const managedDefinition = managedDefinitions.find(
      (resource) =>
        resource.kind === 'ResourceGraphDefinition'
        && resource.metadata?.name === 'managed-stream-platform',
    ) as {
      readonly spec?: {
        readonly resources?: readonly {
          readonly template?: {
            readonly kind?: string;
            readonly metadata?: { readonly name?: string };
            readonly spec?: { readonly values?: unknown };
          };
        }[];
      };
    };
    expect(managedDefinition.spec?.resources?.some(
      (resource) =>
        resource.template?.kind === 'HelmRelease'
        && ['applik8s-events', 'nack'].includes(
          resource.template.metadata?.name ?? '',
        ),
    )).toBe(false);
    expect(
      parseAllDocuments(managedFactory.toYaml({}))
        .map((document) => document.toJSON())
        .some((document) => document.kind === 'NatsBootstrap'),
    ).toBe(false);

    const ephemeral = app('ephemeral-stream-platform');
    ephemeral.provide(EventLog, {
      kind: 'nats-jetstream',
      provision: true,
      pvcRetentionPolicy: 'delete',
    });
    const EphemeralAccount = ephemeral.model(AccountEntity, {
      schema: { transactions: 'required' },
    });
    applicationModelCommandRegistrar(EphemeralAccount)!(
      RenameAccount,
      { key: ({ accountId }) => accountId },
      async (account, input) => ({
        changed: account.spec.displayName !== input.displayName,
        displayName: input.displayName,
      }),
    );
    const ephemeralGraph = applicationGraphFor(ephemeral.composition);
    expect(
      ephemeralGraph?.nodes.find(
        (node) => node.kind === 'provider' && node.interface === 'EventLog',
      ),
    ).toMatchObject({
      config: {
        provision: true,
        pvcRetentionPolicy: 'delete',
      },
    });
    expect(
      parseAllDocuments(ephemeral.composition.factory('kro').toYaml({}))
        .map((document) => document.toJSON())
        .some((document) => document.kind === 'NatsBootstrap'),
    ).toBe(false);

    const external = app('external-stream-platform');
    external.provide(EventLog, { kind: 'nats-jetstream', name: 'external-events', provision: false, servers: ['nats://external-events.messaging.svc:4222'] });
    const ExternalAccount = external.model(AccountEntity, { schema: { transactions: 'required' } });
    applicationModelCommandRegistrar(ExternalAccount)!(RenameAccount, { key: ({ accountId }) => accountId }, async (account, input) => ({ changed: account.spec.displayName !== input.displayName, displayName: input.displayName }));
    const processor = applicationGraphFor(external.composition)?.nodes.find((node) => node.kind === 'processor');
    expect(processor?.kind === 'processor' ? processor.generatedResources?.some((resource) => resource.resource?.kind === 'Stream') : true).toBe(false);
  });

  it('rejects unversioned contracts, ambiguous handlers, nondeterministic keys, and cross-database transactions', () => {
    expect(() => command('account.rename', { input: type({ id: 'string' }), output: type({ ok: 'boolean' }) })).toThrow(/explicit version/);
    expect(() => event('account.changed', { payload: type({ id: 'string' }) })).toThrow(/explicit version/);

    const platform = app('invalid-command-platform');
    const Account = platform.model(AccountEntity, {
      database: TransactionalDatabase.postgres({ name: 'accounts', database: 'accounts' }),
      schema: { transactions: 'required' },
    });
    const Audit = platform.model(AuditEntity, {
      database: TransactionalDatabase.postgres({ name: 'audit', database: 'audit' }),
      schema: { transactions: 'required' },
    });
    const handler = async (_account: { readonly spec: { readonly displayName: string } }, input: { readonly displayName: string }) => ({ changed: true, displayName: input.displayName });

    expect(() => applicationModelCommandRegistrar(Account)!(RenameAccount, {
      key: ({ accountId }) => accountId,
      transaction: { models: [Audit] },
    }, handler)).toThrow(/multiple physical transaction domains/);

    applicationModelCommandRegistrar(Account)!(RenameAccount, { key: ({ accountId }) => accountId }, handler);
    expect(() => applicationModelCommandRegistrar(Account)!(RenameAccount, { key: ({ accountId }) => accountId }, handler)).toThrow(/already has a handler/);
    const OtherAccount = platform.model(entity('OtherAccount', { spec: AccountEntity.spec }), { schema: { transactions: 'required' } });
    expect(() => applicationModelCommandRegistrar(OtherAccount)!(RenameAccount, { key: ({ accountId }) => accountId }, handler)).toThrow(/exactly one owning handler/);

    const platformWithRandomKey = app('random-key-platform');
    const RandomAccount = platformWithRandomKey.model(AccountEntity, { schema: { transactions: 'required' } });
    expect(() => applicationModelCommandRegistrar(RandomAccount)!(RenameAccount, { key: () => Math.random() }, handler)).toThrow(/must be deterministic/);

    const platformWithInvalidRetention = app('invalid-retention-platform');
    const RetainedAccount = platformWithInvalidRetention.model(AccountEntity, { schema: { transactions: 'required' } });
    expect(() => applicationModelCommandRegistrar(RetainedAccount)!(RenameAccount, { key: ({ accountId }) => accountId, retention: { replayWindowSeconds: 3_600, auditWindowSeconds: 60 } }, handler)).toThrow(/auditWindowSeconds must be an integer >= replayWindowSeconds/);

    const platformWithInvalidProcessorImage = app('invalid-processor-image-platform');
    const InvalidProcessorAccount = platformWithInvalidProcessorImage.model(AccountEntity, { schema: { transactions: 'required' } });
    expect(() => applicationModelCommandRegistrar(InvalidProcessorAccount)!(RenameAccount, { key: ({ accountId }) => accountId, processor: { image: '   ' } }, handler)).toThrow(/processor.image must be a non-empty OCI image reference/);
    expect(() => applicationModelCommandRegistrar(InvalidProcessorAccount)!(ReindexAccount, { key: ({ accountId }) => accountId, processor: { group: 'Not Valid' } }, async () => ({ accepted: true }))).toThrow(/processor.group must be a valid lowercase Kubernetes name/);

    const platformWithInvalidCapacity = app('invalid-processor-capacity-platform');
    const InvalidCapacityAccount = platformWithInvalidCapacity.model(AccountEntity, { schema: { transactions: 'required' } });
    expect(() => applicationModelCommandRegistrar(InvalidCapacityAccount)!(RenameAccount, { key: ({ accountId }) => accountId, processor: { replicas: 2, concurrency: 8, maxAckPending: 8 } }, handler)).toThrow(/maxAckPending must be an integer between 16 and 65536/);

    const platformWithExternalEffect = app('external-effect-platform');
    const EffectAccount = platformWithExternalEffect.model(AccountEntity, { schema: { transactions: 'required' } });
    expect(() => applicationModelCommandRegistrar(EffectAccount)!(RenameAccount, { key: ({ accountId }) => accountId }, async (_account, input) => {
      await fetch(`https://example.test/${input.accountId}`);
      return { changed: false, displayName: input.displayName };
    })).toThrow(/forbidden while model locks are held/);
  });

  it('rejects structural ambient-I/O, wall-clock, and dynamic-code escape paths while ignoring inert text', () => {
    const cases: readonly { readonly name: string; readonly handler: (account: { readonly spec: { readonly displayName: string } }, input: { readonly displayName: string }) => Promise<{ readonly changed: boolean; readonly displayName: string }> }[] = [
      {
        name: 'computed-global-fetch',
        handler: async (_account, input) => {
          const method = 'fetch';
          await globalThis[method](`https://example.test/${input.displayName}`);
          return { changed: false, displayName: input.displayName };
        },
      },
      {
        name: 'node-builtin-loader',
        handler: async (_account, input) => {
          globalThis.process.getBuiltinModule('node:fs');
          return { changed: false, displayName: input.displayName };
        },
      },
      {
        name: 'wall-clock-construction',
        handler: async (_account, input) => {
          const observedAt = new Date();
          return { changed: observedAt.getTime() > 0, displayName: input.displayName };
        },
      },
      {
        name: 'constructor-escape',
        handler: async (_account, input) => {
          Object.constructor('return 1')();
          return { changed: false, displayName: input.displayName };
        },
      },
      {
        name: 'dynamic-import',
        handler: async (_account, input) => {
          // static-import-exception: this fixture proves transaction handlers reject dynamic imports.
          await import('node:fs');
          return { changed: false, displayName: input.displayName };
        },
      },
    ];

    for (const item of cases) {
      const platform = app(`unsafe-${item.name}`);
      const Account = platform.model(AccountEntity, { schema: { transactions: 'required' } });
      expect(() => applicationModelCommandRegistrar(Account)!(RenameAccount, { key: ({ accountId }) => accountId }, item.handler)).toThrow(/closed structural closures|forbidden while model locks are held|references module-scope identifier/);
    }

    const safe = app('safe-structural-text');
    const SafeAccount = safe.model(AccountEntity, { schema: { transactions: 'required' } });
    expect(() => applicationModelCommandRegistrar(SafeAccount)!(RenameAccount, { key: ({ accountId }) => accountId }, async (account, input, context) => {
      const documentation = 'fetch process globalThis Date.now constructor';
      return { changed: account.spec.displayName !== input.displayName && documentation.length > 0 && context.now.length > 0, displayName: input.displayName };
    })).not.toThrow();
  });
});
