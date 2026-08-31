// typecast-file-boundary: Adversarial tests intentionally erase one opaque implementation to prove the public profile boundary rejects it.
import { describe, expect, it } from 'vitest';
import {
  app,
  ApplicationHost,
  AWS,
  Certificate,
  config,
  createApplicationAssemblyProfileCatalog,
  ContainerRegistry,
  Database as MaintainedDatabase,
  defineApplicationCapabilityImplementation,
  defineApplicationProvider,
  EventLog,
  FiniteExecutionHost,
  JobResultStore,
  JobRuntime,
  DnsPublication,
  HttpExposure,
  KubernetesCluster,
  profileFragment,
  ObjectStorage,
  Queue,
  Scheduler as MaintainedScheduler,
  Search as MaintainedSearch,
  secret,
  TransactionalDatabase,
} from '../src/index.js';

interface DatabaseImplementation {
  readonly kind: 'database';
  readonly endpoint: string;
}

interface SchedulerImplementation {
  readonly kind: 'scheduler';
}

interface OperatorImplementation {
  readonly kind: 'operator';
}

const Database = defineApplicationProvider<DatabaseImplementation>({
  interface: 'ProfileDatabase',
  version: 'v1',
  guarantees: ['transactions'],
  accepts: (value): value is DatabaseImplementation => Boolean(
    value && typeof value === 'object' && Reflect.get(value, 'kind') === 'database',
  ),
});
const Scheduler = defineApplicationProvider<SchedulerImplementation>({
  interface: 'ProfileScheduler',
  version: 'v1',
  guarantees: ['convergence'],
  accepts: (value): value is SchedulerImplementation => Boolean(
    value && typeof value === 'object' && Reflect.get(value, 'kind') === 'scheduler',
  ),
});
const Operator = defineApplicationProvider<OperatorImplementation>({
  interface: 'ProfileOperator',
  version: 'v1',
  guarantees: ['reconciliation'],
  accepts: (value): value is OperatorImplementation => Boolean(
    value && typeof value === 'object' && Reflect.get(value, 'kind') === 'operator',
  ),
});

function digest(character: string): string {
  return `sha256:${character.repeat(64)}`;
}

function database(endpoint: string) {
  return defineApplicationCapabilityImplementation(Database, {
    provider: { package: '@example/database', export: 'postgres', version: '1.0.0' },
    configurationDigest: digest(endpoint === 'local' ? 'a' : 'b'),
    configurationSources: [{ kind: 'config', reference: 'DATABASE_ENDPOINT', required: true }],
    runtimeAdapter: '@example/database/runtime',
    deploymentContributor: '@example/database/deployment',
    readiness: 'database.connection.v1',
    lifecycle: endpoint === 'local' ? 'application' : 'external',
    migration: 'database.migration.v1',
    evidence: ['database.conformance'],
    maturity: 'beta',
    value: { kind: 'database', endpoint },
  });
}

function scheduler() {
  return defineApplicationCapabilityImplementation(Scheduler, {
    provider: { package: '@example/scheduler', export: 'local', version: '1.0.0' },
    configurationDigest: digest('c'),
    runtimeAdapter: '@example/scheduler/runtime',
    readiness: 'scheduler.ready.v1',
    lifecycle: 'application',
    migration: 'scheduler.migration.v1',
    evidence: ['scheduler.conformance'],
    maturity: 'beta',
    value: { kind: 'scheduler' },
  });
}

describe('application assembly profiles', () => {
  it('authors and resolves target-free profiles from the canonical application builder', () => {
    const application = app('profiled-application');
    const definition = application.profile('production', profile => {
      profile.provide(Database, database('external'));
      profile.provide(Scheduler, scheduler());
    });

    expect(definition.name).toBe('production');
    expect(application.assemblyProfiles.list().map(profile => profile.name)).toEqual([
      'production',
    ]);
    expect(application.implementationPlan('production')).toEqual(definition.plan());
    expect(application.implementationPlan('production').profile.id).toBe('production');
  });

  it('authors a target-free profile and resolves deterministic implementation identity', () => {
    const catalog = createApplicationAssemblyProfileCatalog('chirp');
    const safety = profileFragment('production-safety', profile => {
      profile.defaults({ retention: 'retain', deletionApproval: 'required' });
      profile.qualify({ id: 'production-evidence' });
    });
    const postgres = database('external');
    const profile = catalog.profile('production', builder => {
      builder.include(safety);
      builder.provide(Database, postgres);
      builder.provide(Scheduler, scheduler());
    });

    const plan = profile.plan();
    expect(plan.profile.id).toBe('production');
    expect(profile.fragments).toEqual(['production-safety']);
    expect(profile.defaults).toEqual({ retention: 'retain', deletionApproval: 'required' });
    expect(plan.bindings).toHaveLength(2);
    expect(plan.implementations).toHaveLength(2);
    expect(plan.implementations.every(({ identity }) => identity.source === 'binding')).toBe(true);
    expect(JSON.stringify(plan)).not.toContain('"endpoint"');
    expect(JSON.stringify(plan)).not.toContain('DATABASE_ENDPOINT=');
  });

  it('preserves explicit identity across profile names without renaming provider resources', () => {
    const firstCatalog = createApplicationAssemblyProfileCatalog('chirp');
    const secondCatalog = createApplicationAssemblyProfileCatalog('chirp');
    const implementation = database('external').identified('control-database.v1');
    const first = firstCatalog.profile('production', profile => {
      profile.provide(Database, implementation);
    }).plan();
    const second = secondCatalog.profile('renamed-production', profile => {
      profile.provide(Database, implementation);
    }).plan();

    expect(second.implementations[0]?.id).toBe(first.implementations[0]?.id);
    expect(second.implementations[0]?.identity.explicitName).toBe('control-database.v1');
  });

  it('retains reusable and inline dependency topology without exposing private authority', () => {
    const postgres = database('external');
    const schedule = scheduler();
    const operator = defineApplicationCapabilityImplementation(Operator, {
      provider: { package: '@example/operator', export: 'distributed', version: '1.0.0' },
      configurationDigest: digest('d'),
      runtimeAdapter: '@example/operator/runtime',
      deploymentContributor: '@example/operator/deployment',
      readiness: 'operator.ready.v1',
      lifecycle: 'application',
      migration: 'operator.migration.v1',
      evidence: ['operator.conformance'],
      maturity: 'beta',
      dependencies: [
        {
          slot: 'database',
          requirement: Database,
          requiredGuarantees: ['transactions'],
          operations: ['transaction.use'],
          input: postgres,
        },
        {
          slot: 'scheduler',
          requirement: Scheduler,
          requiredGuarantees: ['convergence'],
          operations: ['schedule.configure'],
          input: schedule,
        },
      ],
      value: { kind: 'operator' },
    });
    const catalog = createApplicationAssemblyProfileCatalog('chirp');
    const plan = catalog.profile('production', profile => {
      profile.provide(Database, postgres);
      profile.provide(Operator, operator);
    }).plan();

    expect(plan.implementations).toHaveLength(3);
    const databaseNode = plan.implementations.find(({ identity }) => identity.provider.export === 'postgres');
    expect(plan.dependencies.filter(({ dependency }) => dependency === databaseNode?.id)).toHaveLength(1);
    expect(plan.dependencies.every(({ visibility }) => visibility === 'private')).toBe(true);
    expect(plan.bindings.some(({ implementation }) => implementation === databaseNode?.id)).toBe(true);
  });

  it('fails closed for opaque implementations, duplicate authorities, and missing profiles', () => {
    const catalog = createApplicationAssemblyProfileCatalog('chirp');
    expect(() => catalog.profile('opaque', profile => {
      profile.provide(Database, { kind: 'database', endpoint: 'opaque' } as never);
    })).toThrow(/not an inspectable capability implementation/u);
    expect(() => catalog.profile('duplicate', profile => {
      profile.provide(Database, database('local'));
      profile.provide(Database, database('external'));
    })).toThrow(/binds .* more than once/u);
    expect(() => catalog.plan('missing')).toThrow(/Available profiles/u);
  });

  it('accepts maintained constructors without exposing implementation-plan ceremony', () => {
    const application = app('maintained-providers');
    const database = MaintainedDatabase.postgres({
      name: 'primary',
      storage: { size: '20Gi' },
    }).identified('primary-database.v1');

    application.profile('production', profile => {
      profile.provide(TransactionalDatabase, database);
      profile.provide(MaintainedSearch, MaintainedSearch.postgres({ database }));
      profile.provide(MaintainedScheduler, MaintainedScheduler.cronJob({
        namespace: 'application-system',
      }));
    });

    const plan = application.implementationPlan('production');
    expect(plan.implementations.map(({ identity }) => identity.provider.export).sort()).toEqual([
      'Database.postgres',
      'Scheduler.cronJob',
      'Search.postgres',
    ]);
    expect(plan.implementations.find(({ identity }) =>
      identity.provider.export === 'Database.postgres')?.identity.explicitName)
      .toBe('primary-database.v1');
    expect(plan.implementations.every(({ configurationSources }) =>
      configurationSources.length === 0)).toBe(true);
    expect(plan.dependencies).toHaveLength(1);
    expect(plan.dependencies[0]).toMatchObject({
      slot: 'database',
      resolution: 'implementation',
      visibility: 'private',
    });
  });

  it('resolves the complete finite Job implementation graph while reusing shared authorities', () => {
    const application = app('finite-job-provider-graph');
    const database = MaintainedDatabase.postgres({
      name: 'jobs',
      database: 'jobs',
    }).identified('jobs-database.v1');
    const eventLog = defineApplicationCapabilityImplementation(EventLog, {
      provider: { package: '@example/event-log', export: 'jetstream', version: '1.0.0' },
      configurationDigest: digest('f'),
      runtimeAdapter: '@example/event-log/runtime',
      deploymentContributor: '@example/event-log/deployment',
      readiness: 'event-log.ready.v1',
      lifecycle: 'application',
      migration: 'event-log.migration.v1',
      evidence: ['event-log.conformance'],
      maturity: 'beta',
      value: { kind: 'nats-jetstream', name: 'jobs-events' },
    }).identified('jobs-events.v1');
    const registry = defineApplicationCapabilityImplementation(ContainerRegistry, {
      provider: { package: '@example/registry', export: 'oci', version: '1.0.0' },
      configurationDigest: digest('1'),
      runtimeAdapter: '@example/registry/runtime',
      readiness: 'registry.ready.v1',
      lifecycle: 'external',
      migration: 'registry.migration.v1',
      evidence: ['registry.conformance'],
      maturity: 'external',
      value: {
        kind: 'oci-container-registry',
        endpoint: ContainerRegistry.origin('https://registry.example.test'),
      },
    }).identified('jobs-registry.v1');
    const cluster = KubernetesCluster.current({ namespace: 'application-jobs' });
    const queue = Queue.jetStream({ eventLog });
    const executionHost = FiniteExecutionHost.kubernetes({ cluster, registry });
    const results = JobResultStore.postgres({ database });
    const schedule = MaintainedScheduler.postgres({ database });
    const runtime = JobRuntime.kubernetes({
      cluster,
      queue,
      executionHost,
      results,
      scheduler: schedule,
      events: eventLog,
      maximumConcurrency: 32,
    });

    application.profile('production-kubernetes', profile => {
      profile.provide(TransactionalDatabase, database);
      profile.provide(EventLog, eventLog);
      profile.provide(ContainerRegistry, registry);
      profile.provide(JobRuntime, runtime);
    });

    const plan = application.implementationPlan('production-kubernetes');
    expect(plan.implementations.map(({ identity }) => identity.provider.export).sort()).toEqual([
      'Database.postgres',
      'FiniteExecutionHost.kubernetes',
      'JobResultStore.postgres',
      'JobRuntime.kubernetes',
      'Queue.jetStream',
      'Scheduler.postgres',
      'jetstream',
      'oci',
    ]);
    expect(plan.dependencies).toHaveLength(9);
    expect(plan.dependencies.filter(({ slot }) => slot === 'database')).toHaveLength(2);
    expect(plan.dependencies.filter(({ slot }) => slot === 'event-log')).toHaveLength(1);
    expect(plan.dependencies.filter(({ slot }) => slot === 'events')).toHaveLength(1);
    expect(plan.dependencies.every(({ visibility }) => visibility === 'private')).toBe(true);
    expect(plan.bindings).toHaveLength(4);
  });

  it('assembles the frozen AWS hosting profile from recursive typed implementations', () => {
    const application = app('aws-hosting-profile');
    const account = AWS.account({
      accountId: config.env('AWS_ACCOUNT_ID'),
      region: config.env('AWS_REGION'),
      credentials: secret.env('AWS_CREDENTIALS'),
    });
    const registry = ContainerRegistry.ecr({ account });
    const host = ApplicationHost.aws({ account, registry });
    const certificate = Certificate.acm({ account, domain: config.env('APPLICATION_DOMAIN') });
    const dns = DnsPublication.route53({
      account,
      zone: config.env('ROUTE53_ZONE'),
      hostname: config.env('APPLICATION_DOMAIN'),
    });
    const exposure = HttpExposure.aws({ account, host, certificate, dns });
    const attachments = ObjectStorage.s3({
      account,
      retention: 'retain',
    });

    application.profile('production-aws', profile => {
      profile.provide(ContainerRegistry, registry);
      profile.provide(ApplicationHost, host);
      profile.provide(Certificate, certificate);
      profile.provide(DnsPublication, dns);
      profile.provide(HttpExposure, exposure);
      profile.provide(ObjectStorage, attachments);
    });

    const plan = application.implementationPlan('production-aws');
    expect(plan.implementations.map(({ identity }) => identity.provider.export).sort()).toEqual([
      'ApplicationHost.aws',
      'Certificate.acm',
      'ContainerRegistry.ecr',
      'DnsPublication.route53',
      'HttpExposure.aws',
      'ObjectStorage.s3',
    ]);
    expect(plan.dependencies.map(({ slot }) => slot).sort()).toEqual([
      'certificate',
      'dns',
      'host',
      'registry',
    ]);
    expect(plan.implementations.find(({ identity }) => identity.provider.export === 'ObjectStorage.s3'))
      .toMatchObject({ lifecycle: 'retained' });
    expect(plan.implementations.every(({ configurationSources }) => configurationSources.length > 0)).toBe(true);
  });

  it('records typed config and Secret provenance without resolving or serializing values', () => {
    interface ExternalDatabaseImplementation extends DatabaseImplementation {
      readonly credential: ReturnType<typeof secret.env>;
      readonly port: ReturnType<typeof config.env.integer>;
    }
    const ExternalDatabase = defineApplicationProvider<ExternalDatabaseImplementation>({
      interface: 'ExternalProfileDatabase',
      version: 'v1',
      guarantees: ['transactions'],
      accepts: (value): value is ExternalDatabaseImplementation => Boolean(
        value && typeof value === 'object' && Reflect.get(value, 'kind') === 'database',
      ),
    });
    const implementation = defineApplicationCapabilityImplementation(ExternalDatabase, {
      provider: { package: '@example/database', export: 'external', version: '1.0.0' },
      configurationDigest: digest('e'),
      configurationSources: [
        { kind: 'config', reference: 'DATABASE_PORT', required: false },
        { kind: 'secret', reference: 'DATABASE_CREDENTIAL', required: true },
      ],
      runtimeAdapter: '@example/database/runtime',
      readiness: 'database.connection.v1',
      lifecycle: 'external',
      migration: 'database.external-migration.v1',
      maturity: 'external',
      value: {
        kind: 'database',
        endpoint: 'external',
        credential: secret.env('DATABASE_CREDENTIAL', {
          contract: { version: 'v1', keys: ['url'] },
        }),
        port: config.env.integer('DATABASE_PORT', { default: 5432 }),
      },
    });
    const plan = createApplicationAssemblyProfileCatalog('secret-safe')
      .profile('production', profile => profile.provide(ExternalDatabase, implementation))
      .plan();

    expect(plan.implementations[0]?.configurationSources).toEqual([
      { kind: 'config', reference: 'DATABASE_PORT', required: false },
      { kind: 'secret', reference: 'DATABASE_CREDENTIAL', required: true },
    ]);
    expect(JSON.stringify(plan)).not.toContain('DATABASE_CREDENTIAL=');
    expect(() => secret.env('not-a-valid-env-name')).toThrow(/valid variable name/u);
  });
});
