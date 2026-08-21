// typecast-file-boundary: profile conformance fixtures intentionally materialize schema-derived and invalid provider selections across erased branches.
import {
  type ApplicationAnalyticalDatabaseProvider,
  AnalyticalDatabase,
  Analytics,
  ApplicationHost,
  Authorization,
  app,
  applicationGraphFor,
  Certificate,
  ContainerRegistry,
  CounterStore,
  CredentialStore,
  Database,
  defineApplicationProvider,
  DnsPublication,
  EventLog,
  EventSource,
  event,
  HttpExposure,
  IndexStore,
  ObjectStorage,
  Queue,
  Secret,
  StructuredGeneration,
  TransactionalDatabase,
  WorkflowEngine,
} from '@applik8s/applik8s';
import {
  applicationClickHouseAnalyticalDatabaseImplementation,
  applicationEventLogImplementation,
  applicationWorkflowEngineImplementation,
} from '../src/application-providers';
import {
  type ApplicationProviderNode,
  validateApplicationGraph,
} from '@applik8s/core';
import { type } from 'arktype';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

const Installation = type({
  name: 'string',
  profile: "'starter' | 'dedicated' | 'external'",
});
const ProfileConnectionInstallation = type({
  name: 'string',
  profile: "'starter' | 'dedicated' | 'external'",
  providers: {
    database: {
      clusterName: 'string',
      namespace: 'string',
      database: 'string',
      connectionSecretName: 'string',
      connectionSecretKey: 'string',
    },
  },
});

function graphExpression(value: unknown): string {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Expected a graph-aware CEL expression.');
  }
  const expression = Reflect.get(value, 'expression');
  if (typeof expression !== 'string') {
    throw new TypeError('Expected a graph-aware CEL expression string.');
  }
  return expression;
}

describe('application deployment profiles', () => {
  it('composes profile and target provider selection without source casts or duplicate registration', () => {
    const application = app('profile-target-matrix', {
      spec: Installation,
      status: type({ ready: 'boolean' }),
    });
    const DatabaseProvider = TransactionalDatabase.named('primary');
    const AnalyticsProvider = AnalyticalDatabase.named('primary');
    const deployment = application.profile(application.installation.spec, 'profile');
    deployment
      .provide(DatabaseProvider)
      .starter(() => TransactionalDatabase.postgres({ name: 'app', namespace: 'app', database: 'app' }))
      .dedicated(() => TransactionalDatabase.postgres({ name: 'app', namespace: 'app', database: 'app' }))
      .external(() => TransactionalDatabase.postgres({ name: 'app', namespace: 'app', database: 'app' }))
      .exhaustive();
    const database = application.inject(DatabaseProvider);
    const targetAnalytics = () => application.selectTarget<ApplicationAnalyticalDatabaseProvider>({
      local: () => Analytics.clickHouse({ name: 'analytics' }),
      aws: () => Analytics.postgres({ database, schema: 'analytics' }),
      kubernetes: () => Analytics.clickHouse({ name: 'analytics' }),
    });
    deployment
      .provide(AnalyticsProvider)
      .starter(targetAnalytics)
      .dedicated(targetAnalytics)
      .external(targetAnalytics)
      .exhaustive();
    const clickHouse = applicationClickHouseAnalyticalDatabaseImplementation(
      application.inject(AnalyticsProvider),
    );

    const provider = applicationGraphFor(application.composition)?.nodes.find(
      (node) => node.id === 'provider.analytical-database.v1alpha1.primary',
    );
    expect(provider).toMatchObject({
      implementation: 'application-provider-selection',
      config: {
        profile: {
          branches: expect.arrayContaining([
            expect.objectContaining({
              variant: 'starter',
              implementation: 'application-target-provider-selection',
              config: expect.objectContaining({
                kind: 'application-target-provider-selection',
                targets: expect.objectContaining({
                  local: expect.objectContaining({ kind: 'clickhouse' }),
                  aws: expect.objectContaining({ kind: 'postgres-analytics' }),
                }),
              }),
            }),
          ]),
        },
      },
    });
    expect(clickHouse).toMatchObject({
      kind: 'clickhouse',
      name: 'analytics',
    });
    expect(clickHouse?.enabled).not.toBe(false);
    expect(clickHouse?.provision).not.toBe(false);
  });

  it('qualifies extension providers through the same exhaustive profile API', () => {
    const application = app('profile-structured-generation', {
      spec: Installation,
      status: type({ ready: 'boolean' }),
    });
    const ContentGeneration = StructuredGeneration.named('content');

    application
      .profile(application.installation.spec, 'profile')
      .provide(ContentGeneration)
      .starter(() =>
        StructuredGeneration.deterministic({
          output: { body: 'starter' },
        }),
      )
      .dedicated(() =>
        StructuredGeneration.http({
          endpoint: 'https://generation.example.test/v1',
        }),
      )
      .external(() =>
        StructuredGeneration.http({
          endpoint: 'https://external-generation.example.test/v1',
        }),
      )
      .exhaustive();

    const generation = application.inject(ContentGeneration);
    application.provide(StructuredGeneration, generation);

    const provider = applicationGraphFor(application.composition)?.nodes.find(
      (node) =>
        node.id === 'provider.structured-generation.v1alpha1.content',
    );
    expect(provider).toMatchObject({
      id: 'provider.structured-generation.v1alpha1.content',
      implementation: 'application-provider-selection',
      config: {
        qualification: {
          capability: 'StructuredGeneration',
          name: 'content',
        },
        profile: {
          selectedBy: 'schema.spec.profile',
          branches: expect.arrayContaining([
            expect.objectContaining({
              variant: 'starter',
              implementation: 'structured-generation-deterministic',
            }),
            expect.objectContaining({
              variant: 'dedicated',
              implementation: 'structured-generation-http',
            }),
            expect.objectContaining({
              variant: 'external',
              implementation: 'structured-generation-http',
            }),
          ]),
        },
      },
    });
  });

  it('preserves nested branch topology and reference coordinates without retaining raw secrets or shifting arrays', () => {
    const PortableInstallation = type({
      name: 'string',
      profile: "'starter' | 'dedicated' | 'external'",
      providers: {
        objects: {
          deviceStorageClassName: 'string',
        },
      },
    });
    interface FixtureProvider {
      readonly kind: 'fixture';
      readonly topology: {
        readonly zones: readonly string[];
        readonly entries: readonly unknown[];
        readonly deviceStorageClassName: string;
      };
      readonly credentials: {
        readonly password: string;
        readonly token: string;
        readonly secret: string;
        readonly apiKey: string;
        readonly privateKey: string;
        readonly clientSecret: string;
        readonly accessKeyId: string;
        readonly secretAccessKey: string;
        readonly credentialsSecret: string;
        readonly passwordKey: string;
        readonly credentialKey: string;
      };
    }
    const Fixture = defineApplicationProvider<FixtureProvider>({
      interface: 'FixtureProvider',
      version: 'v1alpha1',
      accepts: (candidate): candidate is FixtureProvider =>
        candidate !== null
        && typeof candidate === 'object'
        && Reflect.get(candidate, 'kind') === 'fixture',
    }).named('primary');
    const application = app('profile-portable-config', {
      spec: PortableInstallation,
      status: type({ ready: 'boolean' }),
    });
    const implementation = (
      zone: string,
      deviceStorageClassName: string,
    ): FixtureProvider => ({
      kind: 'fixture',
      topology: {
        zones: [zone, `${zone}-secondary`],
        entries: ['first', () => 'runtime-only', 'third'],
        deviceStorageClassName,
      },
      credentials: {
        password: 'raw-password',
        token: 'raw-token',
        secret: 'raw-secret',
        apiKey: 'raw-api-key',
        privateKey: 'raw-private-key',
        clientSecret: 'raw-client-secret',
        accessKeyId: 'raw-access-key',
        secretAccessKey: 'raw-secret-access-key',
        credentialsSecret: `${zone}-credentials`,
        passwordKey: 'password',
        credentialKey: 'uri',
      },
    });

    application
      .profile(application.installation.spec, 'profile')
      .provide(Fixture)
      .starter(() => implementation('starter', 'starter-block'))
      .dedicated((spec) =>
        implementation(
          'dedicated',
          spec.providers.objects.deviceStorageClassName,
        ),
      )
      .external(() => implementation('external', 'external-block'))
      .exhaustive();

    const provider = applicationGraphFor(application.composition)?.nodes.find(
      (node) =>
        node.kind === 'provider'
        && node.interface === 'FixtureProvider',
    );
    if (!provider || provider.kind !== 'provider') {
      throw new Error('Expected the qualified FixtureProvider graph node.');
    }
    const branches =
      provider.config?.profile
      && typeof provider.config.profile === 'object'
      && Array.isArray(Reflect.get(provider.config.profile, 'branches'))
        ? Reflect.get(provider.config.profile, 'branches') as readonly unknown[]
        : [];
    const dedicated = branches.find(
      (branch) =>
        branch !== null
        && typeof branch === 'object'
        && Reflect.get(branch, 'variant') === 'dedicated',
    );

    expect(dedicated).toMatchObject({
      config: {
        topology: {
          zones: ['dedicated', 'dedicated-secondary'],
          entries: ['first', null, 'third'],
          deviceStorageClassName:
            '${schema.spec.providers.objects.deviceStorageClassName}',
        },
        credentials: {
          credentialsSecret: 'dedicated-credentials',
          passwordKey: 'password',
          credentialKey: 'uri',
        },
      },
    });
    const serialized = JSON.stringify(dedicated);
    for (const rawSecret of [
      'raw-password',
      'raw-token',
      'raw-secret',
      'raw-api-key',
      'raw-private-key',
      'raw-client-secret',
      'raw-access-key',
      'raw-secret-access-key',
    ]) {
      expect(serialized).not.toContain(rawSecret);
    }
  });

  it('qualifies every infrastructure capability used by exhaustive Start profiles', () => {
    const qualified = [
      IndexStore.named('search-cache'),
      EventSource.named('events'),
      EventLog.named('events'),
      Secret.named('application-secrets'),
      Queue.named('work'),
      ObjectStorage.named('artifacts'),
      HttpExposure.named('public-http'),
      Certificate.named('public-tls'),
      DnsPublication.named('public-dns'),
      WorkflowEngine.named('workflows'),
      ContainerRegistry.named('images'),
      ApplicationHost.named('web'),
      Authorization.named('authority-projection'),
      CounterStore.named('usage-counters'),
      CredentialStore.named('provider-credentials'),
    ];

    expect(
      qualified.map((token) => token.qualification.key),
    ).toEqual([
      'IndexStore@v1alpha1:search-cache',
      'EventSource@v1alpha1:events',
      'EventLog@v1alpha1:events',
      'Secret@v1alpha1:application-secrets',
      'Queue@v1alpha1:work',
      'ObjectStorage@v1alpha1:artifacts',
      'HttpExposure@v1alpha1:public-http',
      'Certificate@v1alpha1:public-tls',
      'DnsPublication@v1alpha1:public-dns',
      'WorkflowEngine@v1alpha1:workflows',
      'ContainerRegistry@v1alpha1:images',
      'ApplicationHost@v1alpha1:web',
      'Authorization@v1alpha1:authority-projection',
      'CounterStore@v1alpha1:usage-counters',
      'CredentialStore@v1alpha1:provider-credentials',
    ]);
  });

  it('preserves direct EventLog and WorkflowEngine deployment configuration', () => {
    const application = app('direct-runtime-providers');
    application.provide(EventLog, {
      kind: 'nats-jetstream',
      name: 'runtime-events',
      namespace: 'runtime-system',
      provision: true,
      replicas: 2,
      storageSize: '4Gi',
      storageClassName: 'fast-block',
      pvcRetentionPolicy: 'delete',
    });
    application.provide(
      WorkflowEngine,
      WorkflowEngine.hatchet({
        name: 'runtime-workflows',
        namespace: 'runtime-system',
        provision: true,
        mode: 'stack',
        apiUrl: 'http://runtime-workflows-api.runtime-system.svc:8080',
        tokenKey: 'HATCHET_CLIENT_TOKEN',
        dashboard: 'internal',
      }),
    );

    const graph = applicationGraphFor(application.composition);
    const eventLog = graph?.nodes.find(
      (node): node is ApplicationProviderNode<'EventLog'> =>
        node.kind === 'provider' && node.interface === 'EventLog',
    );
    const workflows = graph?.nodes.find(
      (node): node is ApplicationProviderNode<'WorkflowEngine'> =>
        node.kind === 'provider' && node.interface === 'WorkflowEngine',
    );

    expect(eventLog?.config).toMatchObject({
      kind: 'nats-jetstream',
      name: 'runtime-events',
      namespace: 'runtime-system',
      provision: true,
      replicas: 2,
      storageSize: '4Gi',
      storageClassName: 'fast-block',
      pvcRetentionPolicy: 'delete',
    });
    expect(workflows?.config).toMatchObject({
      kind: 'hatchet',
      name: 'runtime-workflows',
      namespace: 'runtime-system',
      provision: true,
      mode: 'stack',
      apiUrl: 'http://runtime-workflows-api.runtime-system.svc:8080',
      tokenKey: 'HATCHET_CLIENT_TOKEN',
      dashboard: 'internal',
    });
  });

  it('normalizes optional workflow booleans before composing profile CEL', () => {
    const workflows = applicationWorkflowEngineImplementation({
      defaults: {},
      providers: {
        extensions: {
          'WorkflowEngine@v1alpha1': {
            kind: 'application-provider-selection',
            selector: 'schema.spec.profile',
            cases: {
              starter: WorkflowEngine.hatchet({
                name: 'starter-workflows',
                namespace: 'workflow-system',
              }),
              dedicated: WorkflowEngine.hatchet({
                name: 'dedicated-workflows',
                namespace: 'workflow-system',
              }),
              external: WorkflowEngine.hatchet({
                name: 'external-workflows',
                namespace: 'workflow-system',
                provision: false,
                tls: true,
              }),
            },
            default: WorkflowEngine.hatchet({
              name: 'starter-workflows',
              namespace: 'workflow-system',
            }),
          },
        },
      },
    });
    const tlsExpression = graphExpression(workflows.tls);
    expect(tlsExpression).toContain('true');
    expect(tlsExpression).toContain('false');
    expect(tlsExpression).not.toContain('omit()');
    const hostExpression = graphExpression(workflows.hostPort);
    const apiExpression = graphExpression(workflows.apiUrl);
    expect(hostExpression).toContain('hatchet-engine.');
    expect(hostExpression).not.toContain('__KUBERNETES_REF_');
    expect(apiExpression).toContain('http://hatchet-api.');
    expect(apiExpression).not.toContain('__KUBERNETES_REF_');
  });

  it('composes default event endpoints without embedding schema markers in CEL string literals', () => {
    const namespace = { expression: 'schema.spec.name' };
    const events = applicationEventLogImplementation({
      kind: 'application-provider-selection',
      selector: 'schema.spec.profile',
      cases: {
        starter: {
          kind: 'nats-jetstream',
          namespace,
        },
        dedicated: {
          kind: 'nats-jetstream',
          namespace,
        },
        external: {
          kind: 'nats-jetstream',
          namespace: 'external-events',
          servers: ['nats://events.example.test:4222'],
          provision: false,
        },
      },
      default: {
        kind: 'nats-jetstream',
        namespace,
      },
    });
    const endpointExpression = graphExpression(events?.servers?.[0]);
    expect(endpointExpression).toContain('string(schema.spec.name)');
    expect(endpointExpression).not.toContain('__KUBERNETES_REF_');
  });

  it('constructs provider-neutral database and analytics capabilities without leaking infrastructure ownership', () => {
    const primary = Database.postgres({
      name: 'primary',
      database: 'application',
      instances: 1,
      migrations: Database.migrations.generatedJob({
        jobName: 'application-migration',
      }),
    });
    const externalPrimary = Database.externalPostgres({
      name: 'external-primary',
      database: 'application',
      connection: {
        secretName: 'external-primary-app',
        key: 'uri',
        namespace: 'data',
      },
    });
    const starterAnalytics = Analytics.postgres({
      database: primary,
      schema: 'analytics',
    });
    const dedicatedAnalytics = Analytics.clickHouse({
      name: 'dedicated-analytics',
      provision: true,
    });
    const externalAnalytics = Analytics.externalClickHouse({
      name: 'external-analytics',
      connection: {
        endpoint: 'https://clickhouse.example.test',
        database: 'application',
        credentialsSecretName: 'clickhouse-client',
        credentialsSecretNamespace: 'data',
      },
    });

    expect(primary).toMatchObject({
      kind: 'postgres',
      database: 'application',
      migrations: {
        strategy: 'generatedJob',
        apply: 'generatedJob',
      },
    });
    expect(externalPrimary).toEqual({
      kind: 'postgres',
      name: 'external-primary',
      database: 'application',
      ownership: 'external',
      provision: false,
      connectionSecret: {
        apiVersion: 'v1',
        kind: 'Secret',
        name: 'external-primary-app',
        namespace: 'data',
      },
      connectionSecretKey: 'uri',
    });
    expect(starterAnalytics).toEqual({
      kind: 'postgres-analytics',
      database: primary,
      schema: 'analytics',
    });
    expect(dedicatedAnalytics).toEqual({
      kind: 'clickhouse',
      name: 'dedicated-analytics',
      provision: true,
    });
    expect(externalAnalytics).toEqual({
      kind: 'clickhouse',
      name: 'external-analytics',
      provision: false,
      endpoint: 'https://clickhouse.example.test',
      database: 'application',
      credentialsSecret: {
        apiVersion: 'v1',
        kind: 'Secret',
        name: 'clickhouse-client',
        namespace: 'data',
      },
    });
    expect(() => Database.externalPostgres({ database: 'application' })).toThrow(
      /connection or an external CNPG cluster reference/,
    );
    expect(() =>
      Analytics.externalClickHouse({
        endpoint: ' ',
      }),
    ).toThrow(/non-empty endpoint/);
  });

  it('derives literal variants and records one exhaustive qualified provider selection', () => {
    const application = app('profile-contract', {
      namespace: 'profile-contract',
      spec: Installation,
      status: type({ ready: 'boolean' }),
    });
    const PrimaryDatabase = TransactionalDatabase.named('primary');
    const deployment = application.profile(
      application.installation.spec,
      'profile',
    );

    deployment
      .provide(PrimaryDatabase)
      .starter(() =>
        TransactionalDatabase.postgres({
          clusterName: 'primary-db',
          connectionSecret: {
            apiVersion: 'v1',
            kind: 'Secret',
            name: 'primary-db-app',
          },
          database: 'application',
        }),
      )
      .dedicated(() =>
        TransactionalDatabase.postgres({
          clusterName: 'primary-db',
          connectionSecret: {
            apiVersion: 'v1',
            kind: 'Secret',
            name: 'primary-db-app',
          },
          database: 'application',
          instances: 3,
        }),
      )
      .external(() =>
        TransactionalDatabase.postgres({
          clusterName: 'primary-db',
          connectionSecret: {
            apiVersion: 'v1',
            kind: 'Secret',
            name: 'primary-db-app',
          },
          database: 'application',
          provision: false,
          cluster: {
            apiVersion: 'postgresql.cnpg.io/v1',
            kind: 'Cluster',
            name: 'shared',
            namespace: 'data',
          },
        }),
      )
      .exhaustive();

    const database = application.inject(PrimaryDatabase);
    application.model('ProfileEntry', {
      spec: type({ id: 'string', body: 'string' }),
      database,
    });
    expect(database).toMatchObject({
      kind: 'applicationProvider',
      qualification: {
        capability: 'TransactionalDatabase',
        name: 'primary',
        compatibilityRevision: 'v1alpha1',
      },
      profile: {
        profileId: 'profile:profile-contract:profile',
        selectedBy: 'schema.spec.profile',
        inactiveBranches: 'plan-only',
        branches: [
          { variant: 'dedicated', provenance: 'application' },
          { variant: 'external', provenance: 'application' },
          { variant: 'starter', provenance: 'application' },
        ],
        transitions: expect.arrayContaining([
          expect.objectContaining({
            from: 'starter',
            to: 'external',
            kind: 'unsupported',
          }),
        ]),
      },
    });

    const provider = applicationGraphFor(application.composition)?.nodes.find(
      (node) =>
        node.kind === 'provider'
        && node.interface === 'TransactionalDatabase'
        && node.config?.qualification
        && typeof node.config.qualification === 'object'
        && Reflect.get(node.config.qualification, 'name') === 'primary',
    );
    expect(provider).toMatchObject({
      implementation: 'application-provider-selection',
      config: {
        qualification: {
          capability: 'TransactionalDatabase',
          name: 'primary',
        },
        profile: {
          profileId: 'profile:profile-contract:profile',
          inactiveBranches: 'plan-only',
        },
        transactionalDatabase: {
          kind: 'application-provider-selection',
          selector: 'schema.spec.profile',
          cases: {
            dedicated: { kind: 'postgres' },
            external: { kind: 'postgres' },
            starter: { kind: 'postgres' },
          },
        },
      },
    });
    expect(application.resources.filter(
      (resource) =>
        resource !== null
        && typeof resource === 'object'
        && Reflect.get(resource, 'kind') === 'Cluster',
    )).toHaveLength(2);
    expect(application.resources).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'Role',
          metadata: expect.objectContaining({
            name: expect.stringContaining('transactional-database'),
          }),
        }),
      ]),
    );
    const kroYaml = application.composition.factory('kro').toYaml();
    expect(kroYaml).toContain(
      'schema.spec.profile == "dedicated"',
    );
    expect(kroYaml).toContain(
      'schema.spec.profile == "starter"',
    );
  });

  it('records the selected qualified provider as the authority behind a non-primary application default', () => {
    const application = app('profile-default-alias', {
      namespace: 'profile-default-alias',
      spec: Installation,
      status: type({ ready: 'boolean' }),
    });
    const MediaObjects = ObjectStorage.named('media');
    const objects = () =>
      ObjectStorage.s3({
        name: 'media',
        bucket: 'media',
        region: 'us-east-1',
        credentialsSecret: {
          apiVersion: 'v1',
          kind: 'Secret',
          name: 'media',
          namespace: 'profile-default-alias',
        },
        ownership: 'external',
      });
    application
      .profile(application.installation.spec, 'profile')
      .provide(MediaObjects)
      .starter(objects)
      .dedicated(objects)
      .external(objects)
      .exhaustive();

    application.defaults({ objects: application.inject(MediaObjects) });

    const provider = applicationGraphFor(application.composition)?.nodes.find(
      (node) =>
        node.kind === 'provider'
        && node.id === 'provider.object-storage',
    );
    expect(provider).toMatchObject({
      config: {
        aliasOf: 'provider.object-storage.v1alpha1.media',
      },
    });
  });

  it('treats a qualified provider and its application-default alias as one authority', () => {
    const application = app('profile-default-consumer', {
      namespace: 'profile-default-consumer',
      spec: Installation,
      status: type({ ready: 'boolean' }),
    });
    const PrimaryEvents = EventLog.named('primary');
    const primaryEvents = application.provide(PrimaryEvents, {
      kind: 'nats-jetstream', name: 'primary-events', provision: true,
      stream: 'PRIMARY_EVENTS', subjectPrefix: 'primary',
    });
    application.defaults({ eventLog: primaryEvents });
    const activity = application.actor('workspace-activity.v1', {
      key: type('string'),
      state: type({ revision: 'number.integer >= 0' }),
      protocol: {},
    });
    activity.on.initialize(() => ({ revision: 0 }));

    const graph = applicationGraphFor(application.composition);
    expect(graph).toBeDefined();
    expect(validateApplicationGraph(graph as NonNullable<typeof graph>)).toEqual([]);
  });

  it('preserves profile-selected generated workload database connections', () => {
    const application = app('unstable-database-profile', {
      namespace: 'unstable-database-profile',
      spec: Installation,
      status: type({ ready: 'boolean' }),
    });
    const PrimaryDatabase = TransactionalDatabase.named('primary');
    application
      .profile(application.installation.spec, 'profile')
      .provide(PrimaryDatabase)
      .starter(() =>
        TransactionalDatabase.postgres({
          clusterName: 'starter-db',
          database: 'application',
        }),
      )
      .dedicated(() =>
        TransactionalDatabase.postgres({
          clusterName: 'dedicated-db',
          database: 'application',
        }),
      )
      .external(() =>
        TransactionalDatabase.postgres({
          clusterName: 'external-db',
          database: 'application',
          provision: false,
          cluster: {
            apiVersion: 'postgresql.cnpg.io/v1',
            kind: 'Cluster',
            name: 'external-db',
            namespace: 'data',
          },
        }),
      )
      .exhaustive();

    application.model('ProfileEntry', {
      spec: type({ id: 'string' }),
      database: application.inject(PrimaryDatabase),
    });
    const model = applicationGraphFor(application.composition)?.nodes.find(
      (node) => node.kind === 'model' && node.name === 'ProfileEntry',
    );
    const materialization = JSON.stringify(
      model?.kind === 'model' ? model.materialization : undefined,
    );
    expect(materialization).toContain('starter-db');
    expect(materialization).toContain('dedicated-db');
    expect(materialization).toContain('external-db');
  });

  it('binds a native Drizzle schema to one qualified profile database without provisioning a duplicate default', () => {
    const records = pgTable('profile_records', {
      id: text('id').primaryKey(),
      body: text('body').notNull(),
    });
    const application = app('profile-native-database', {
      namespace: 'profile-native-database',
      spec: Installation,
      status: type({ ready: 'boolean' }),
    });
    const PrimaryDatabase = TransactionalDatabase.named('primary');
    const deployment = application.profile(
      application.installation.spec,
      'profile',
    );
    deployment
      .provide(PrimaryDatabase)
      .starter(() =>
        TransactionalDatabase.postgres({
          name: 'primary',
          clusterName: 'primary-db',
          connectionSecret: {
            apiVersion: 'v1',
            kind: 'Secret',
            name: 'primary-db-app',
          },
          database: 'application',
        }),
      )
      .dedicated(() =>
        TransactionalDatabase.postgres({
          name: 'primary',
          clusterName: 'primary-db',
          connectionSecret: {
            apiVersion: 'v1',
            kind: 'Secret',
            name: 'primary-db-app',
          },
          database: 'application',
          instances: 3,
        }),
      )
      .external(() =>
        TransactionalDatabase.postgres({
          name: 'primary',
          clusterName: 'primary-db',
          connectionSecret: {
            apiVersion: 'v1',
            kind: 'Secret',
            name: 'primary-db-app',
          },
          database: 'application',
          provision: false,
          cluster: {
            apiVersion: 'postgresql.cnpg.io/v1',
            kind: 'Cluster',
            name: 'primary-db',
            namespace: 'data',
          },
        }),
      )
      .exhaustive();

    const database = application.database.bind('application', {
      provider: application.inject(PrimaryDatabase),
      schema: { records },
      migrations: { path: './drizzle' },
    });
    application.model(records, { name: 'Record', database });

    expect(database).toMatchObject({
      kind: 'applicationDatabase',
      name: 'application',
      qualification: {
        capability: 'TransactionalDatabase',
        name: 'primary',
      },
      provider: {
        kind: 'postgres',
        database: 'application',
      },
      migrations: { path: './drizzle' },
    });
    const providers = applicationGraphFor(application.composition)?.nodes.filter(
      (node): node is ApplicationProviderNode =>
        node.kind === 'provider'
        && node.interface === 'TransactionalDatabase'
        && 'config' in node,
    );
    const provided = providers?.filter(
      (node) => node.config?.bindingKind === 'provided',
    );
    expect(provided).toHaveLength(1);
    expect(
      providers?.some((node) => node.config?.bindingKind === 'default'),
    ).toBe(false);
    expect(provided?.[0]).toMatchObject({
      implementation: 'application-provider-selection',
      config: {
        bindingKind: 'provided',
        qualification: {
          capability: 'TransactionalDatabase',
          name: 'primary',
        },
      },
    });
    expect(
      provided?.[0],
    ).toMatchObject({
      id: 'provider.transactional-database.v1alpha1.primary',
      implementation: 'application-provider-selection',
      config: {
        transactionalDatabase: {
          kind: 'application-provider-selection',
          selector: 'schema.spec.profile',
        },
      },
    });
    const model = applicationGraphFor(application.composition)?.nodes.find(
      (node) => node.kind === 'model' && node.name === 'Record',
    );
    expect(model).toMatchObject({
      database: {
        interface: 'TransactionalDatabase',
        nodeId: 'provider.transactional-database.v1alpha1.primary',
      },
    });
    expect(
      providers?.some(
        (node) => node.id === 'provider.transactional-database',
      ),
    ).toBe(false);
    expect(application.composition.factory('kro').toYaml()).toContain(
      'schema.spec.profile',
    );
  });

  it('preserves managed and external connection Secrets across profile-selected databases', () => {
    const records = pgTable('profile_secret_records', {
      id: text('id').primaryKey(),
      body: text('body').notNull(),
    });
    const application = app('profile-secret-database', {
      namespace: 'profile-secret-system',
      spec: ProfileConnectionInstallation,
      status: type({ ready: 'boolean' }),
    });
    const PrimaryDatabase = TransactionalDatabase.named('primary');
    application
      .profile(application.installation.spec, 'profile')
      .provide(PrimaryDatabase)
      .starter(() =>
        TransactionalDatabase.postgres({
          name: 'primary',
          clusterName: 'starter-db',
          namespace: 'profile-secret-system',
          database: 'application',
        }),
      )
      .dedicated(() =>
        TransactionalDatabase.postgres({
          name: 'primary',
          clusterName: 'dedicated-db',
          namespace: 'profile-secret-system',
          database: 'application',
          instances: 3,
        }),
      )
      .external(() =>
        TransactionalDatabase.postgres({
          clusterName: application.installation.spec.providers.database.clusterName,
          namespace: application.installation.spec.providers.database.namespace,
          database: application.installation.spec.providers.database.database,
          ownership: 'external',
          provision: false,
          connectionSecret: {
            apiVersion: 'v1',
            kind: 'Secret',
            name: application.installation.spec.providers.database.connectionSecretName,
            namespace: 'profile-secret-system',
          },
          connectionSecretKey:
            application.installation.spec.providers.database.connectionSecretKey,
        }),
      )
      .exhaustive();
    const database = application.database.bind('application', {
      provider: application.inject(PrimaryDatabase),
      schema: { records },
      migrations: { path: './drizzle' },
    });
    application.model(records, { name: 'Record', database });

    const model = applicationGraphFor(application.composition)?.nodes.find(
      (node) => node.kind === 'model' && node.name === 'Record',
    );
    if (!model || model.kind !== 'model' || !model.runtime) {
      throw new Error('Expected Record model runtime.');
    }
    expect(model.runtime.secretName).toContain(
      '(schema.spec.profile) == "starter" ? ("starter-db-app")',
    );
    expect(model.runtime.secretName).toContain(
      '(schema.spec.profile) == "dedicated" ? ("dedicated-db-app")',
    );
    expect(model.runtime.secretName).toContain(
      'schema.spec.providers.database.connectionSecretName',
    );
    expect(model.runtime.secretNamespace).toBe('profile-secret-system');
    expect(model.runtime.secretKey).toContain(
      '(schema.spec.profile) == "starter" ? ("uri")',
    );
  });

  it('allows an override before injection and rejects one after capture', () => {
    const application = app('profile-overrides', {
      spec: Installation,
      status: type({ ready: 'boolean' }),
    });
    const PrimaryDatabase = TransactionalDatabase.named('primary');
    const deployment = application.profile(
      application.installation.spec,
      'profile',
    );
    deployment
      .provide(PrimaryDatabase)
      .starter(() => TransactionalDatabase.postgres({ database: 'starter' }))
      .dedicated(() =>
        TransactionalDatabase.postgres({ database: 'dedicated' }),
      )
      .external(() =>
        TransactionalDatabase.postgres({
          database: 'external',
          provision: false,
          cluster: {
            apiVersion: 'postgresql.cnpg.io/v1',
            kind: 'Cluster',
            name: 'shared',
          },
        }),
      )
      .exhaustive();

    deployment.dedicated.override(
      PrimaryDatabase,
      TransactionalDatabase.postgres({
        database: 'larger-dedicated',
        instances: 5,
      }),
    );
    expect(application.inject(PrimaryDatabase).profile.branches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          variant: 'dedicated',
          provenance: 'application-override',
        }),
      ]),
    );
    expect(() =>
      deployment.starter.override(
        PrimaryDatabase,
        TransactionalDatabase.postgres({ database: 'too-late' }),
      ),
    ).toThrow(/after application\.inject/);
  });

  it('keeps multiple qualifications of one capability disjoint and binds each model explicitly', () => {
    const application = app('profile-qualifications', {
      spec: Installation,
      status: type({ ready: 'boolean' }),
    });
    const deployment = application.profile(
      application.installation.spec,
      'profile',
    );
    const PrimaryDatabase = TransactionalDatabase.named('primary');
    const AuditDatabase = TransactionalDatabase.named('audit');
    const database = (
      role: 'primary' | 'audit',
      _variant: 'starter' | 'dedicated' | 'external',
    ) =>
      TransactionalDatabase.postgres({
        name: role,
        clusterName: `${role}-db`,
        connectionSecret: {
          apiVersion: 'v1',
          kind: 'Secret',
          name: `${role}-db-app`,
        },
        database: role,
        provision: false,
        cluster: {
          apiVersion: 'postgresql.cnpg.io/v1',
          kind: 'Cluster',
          name: `${role}-db`,
          namespace: 'data',
        },
      });

    deployment
      .provide(PrimaryDatabase)
      .starter(() => database('primary', 'starter'))
      .dedicated(() => database('primary', 'dedicated'))
      .external(() => database('primary', 'external'))
      .exhaustive();
    deployment
      .provide(AuditDatabase)
      .starter(() => database('audit', 'starter'))
      .dedicated(() => database('audit', 'dedicated'))
      .external(() => database('audit', 'external'))
      .exhaustive();

    application.model('PrimaryRecord', {
      spec: type({ id: 'string' }),
      database: application.inject(PrimaryDatabase),
    });
    application.model('AuditRecord', {
      spec: type({ id: 'string' }),
      database: application.inject(AuditDatabase),
    });

    const graph = applicationGraphFor(application.composition);
    const providers = graph?.nodes.filter(
      (node) =>
        node.kind === 'provider'
        && node.interface === 'TransactionalDatabase'
        && node.config?.qualification,
    );
    expect(providers).toHaveLength(2);
    expect(providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'provider.transactional-database.v1alpha1.primary',
          config: expect.objectContaining({
            qualification: expect.objectContaining({ name: 'primary' }),
          }),
        }),
        expect.objectContaining({
          id: 'provider.transactional-database.v1alpha1.audit',
          config: expect.objectContaining({
            qualification: expect.objectContaining({ name: 'audit' }),
          }),
        }),
      ]),
    );
    expect(
      graph?.nodes.find(
        (node) => node.kind === 'model' && node.name === 'PrimaryRecord',
      ),
    ).toMatchObject({
      database: {
        interface: 'TransactionalDatabase',
        nodeId: 'provider.transactional-database.v1alpha1.primary',
      },
    });
    expect(
      graph?.nodes.find(
        (node) => node.kind === 'model' && node.name === 'AuditRecord',
      ),
    ).toMatchObject({
      database: {
        interface: 'TransactionalDatabase',
        nodeId: 'provider.transactional-database.v1alpha1.audit',
      },
    });
    expect(
      graph?.nodes.find(
        (node) => node.id === 'provider.transactional-database',
      ),
    ).toBeUndefined();
  });

  it('binds analytical projections to an injected qualified capability', () => {
    const application = app('profile-analytics', {
      namespace: 'profile-analytics',
      spec: Installation,
      status: type({ ready: 'boolean' }),
    });
    const deployment = application.profile(
      application.installation.spec,
      'profile',
    );
    const AnalyticsDatabase = AnalyticalDatabase.named('analytics');
    const starterDatabase = Database.externalPostgres({
      database: 'application',
      connection: { secretName: 'starter-postgres-app' },
    });
    deployment
      .provide(AnalyticsDatabase)
      .starter(() =>
        Analytics.postgres({
          database: starterDatabase,
          schema: 'analytics',
        }),
      )
      .dedicated(() =>
        Analytics.clickHouse({
          name: 'profile-analytics',
          provision: true,
          storageSize: application.select(application.installation.spec.profile, {
            starter: '16Gi',
            dedicated: '250Gi',
            external: '16Gi',
            default: '16Gi',
          }),
        }),
      )
      .external(() =>
        Analytics.externalClickHouse({
          name: 'profile-analytics',
          connection: {
            endpoint: 'http://external.example.test:8123',
          },
        }),
      )
      .exhaustive();
    const database = application.database.postgres('events', { schema: {} });
    const Changed = event('profile.analytics.changed.v1', {
      payload: type({ accountId: 'string', amount: 'number' }),
    });
    const changes = application.stream(Changed, {
      database,
      retention: { maxAgeSeconds: 86_400 },
      partitionBy: (payload) => payload.accountId,
      authorize: () => true,
    });
    changes.project('usage', {
      provider: application.inject(AnalyticsDatabase),
      output: type({ accountId: 'string', amount: 'number' }),
      project: (payload) => payload,
    });
    const usageFacts = pgTable('profile_usage_facts', {
      id: text('id').primaryKey(),
      accountId: text('account_id').notNull(),
    });
    const UsageFact = application.model(usageFacts, {
      database: application.inject(AnalyticsDatabase),
    });
    expect(UsageFact.$model).toMatchObject({
      provider: 'analytical-database',
      capabilities: {
        reads: 'declaredQueries',
        ingestion: 'projectionOwned',
        checkpoint: 'idempotent',
        rebuild: 'fullReplay',
      },
    });
    expect('create' in UsageFact).toBe(false);
    expect('update' in UsageFact).toBe(false);
    expect('delete' in UsageFact).toBe(false);

    const graph = applicationGraphFor(application.composition);
    expect(
      graph?.nodes.find(
        (node) =>
          node.kind === 'provider'
          && node.id === 'provider.analytical-database.v1alpha1.analytics',
      ),
    ).toMatchObject({
      implementation: 'application-provider-selection',
      config: {
        qualification: {
          capability: 'AnalyticalDatabase',
          name: 'analytics',
        },
        profile: {
          profileId: 'profile:profile-analytics:profile',
          inactiveBranches: 'plan-only',
        },
        analyticalDatabase: {
          kind: 'application-provider-selection',
          selector: 'schema.spec.profile',
          cases: {
            dedicated: { kind: 'clickhouse' },
            external: { kind: 'clickhouse' },
            starter: { kind: 'postgres-analytics' },
          },
        },
      },
    });
    expect(
      graph?.nodes.find(
        (node) => node.kind === 'projection' && node.name === 'usage',
      ),
    ).toMatchObject({
      provider: {
        interface: 'AnalyticalDatabase',
        nodeId: 'provider.analytical-database.v1alpha1.analytics',
      },
    });
    expect(
      graph?.nodes.find(
        (node) => node.kind === 'model' && node.name === UsageFact.$model.name,
      ),
    ).toMatchObject({
      database: {
        interface: 'AnalyticalDatabase',
        nodeId: 'provider.analytical-database.v1alpha1.analytics',
      },
      native: {
        authority: 'analytical-database',
        schemaAuthority: 'drizzle',
      },
      common: {
        changes: {
          authority: 'analytical-checkpoint',
        },
        operations: [],
      },
      schema: {
        transactions: 'unsupported',
      },
    });
    expect(graph?.providerRequirements).toContainEqual(
      expect.objectContaining({
        id: 'analytical-database.usage',
        provider: {
          interface: 'AnalyticalDatabase',
          nodeId: 'provider.analytical-database.v1alpha1.analytics',
        },
      }),
    );
    const kroYaml = application.composition.factory('kro').toYaml();
    expect(kroYaml).toContain('ClickHouseInstallation');
    expect(kroYaml).toContain('(schema.spec.profile) == "dedicated"');
    expect(kroYaml).toContain(
      '? ((schema.spec.profile) == "starter" ? ("16Gi")',
    );
    if (!graph) throw new Error('Expected qualified analytical graph.');
    expect(validateApplicationGraph(graph)).toEqual([]);
  });

  it('fails closed for mismatched explicit variants and duplicate profiles', () => {
    const application = app('profile-validation', {
      spec: Installation,
      status: type({ ready: 'boolean' }),
    });
    expect(() =>
      application.profile(application.installation.spec, 'profile', {
        variants: ['starter', 'external'] as const,
      }),
    ).toThrow(/do not match its ArkType discriminator/);

    application.profile(application.installation.spec, 'profile');
    expect(() =>
      application.profile(application.installation.spec, 'profile'),
    ).toThrow(/already declares profile/);
  });

  it('derives variants from a discriminated installation union with branch-specific providers', () => {
    const Common = type({
      name: 'string',
    });
    const DiscriminatedInstallation = Common.and(
      type({
        profile: "'starter'",
      }).or({
        profile: "'dedicated'",
        providers: {
          inference: {
            endpoint: 'string',
          },
        },
      }).or({
        profile: "'external'",
        providers: {
          database: {
            connectionSecretName: 'string',
          },
        },
      }),
    );
    const application = app('discriminated-profile', {
      spec: DiscriminatedInstallation,
      status: type({ ready: 'boolean' }),
    });
    const PrimaryDatabase = TransactionalDatabase.named('primary');
    const binding = application
      .profile(application.installation.spec, 'profile')
      .provide(PrimaryDatabase)
      .starter(() =>
        TransactionalDatabase.postgres({ database: 'starter' }),
      )
      .dedicated((spec) =>
        TransactionalDatabase.postgres({
          database: spec.providers.inference.endpoint,
        }),
      )
      .external((spec) =>
        TransactionalDatabase.postgres({
          database: spec.providers.database.connectionSecretName,
        }),
      )
      .exhaustive();

    expect(binding.profile.descriptor.variants).toEqual([
      'dedicated',
      'external',
      'starter',
    ]);
    expect(
      DiscriminatedInstallation({
        name: 'missing-provider-contract',
        profile: 'external',
      }),
    ).toBeInstanceOf(type.errors);
  });

  it('rejects side-effectful asynchronous branch construction', () => {
    const application = app('profile-sync-only', {
      spec: Installation,
      status: type({ ready: 'boolean' }),
    });
    const PrimaryDatabase = TransactionalDatabase.named('primary');
    const deployment = application.profile(
      application.installation.spec,
      'profile',
    );
    expect(() =>
      deployment
        .provide(PrimaryDatabase)
        .starter(
          (() =>
            Promise.resolve(
              TransactionalDatabase.postgres({ database: 'starter' }),
            )) as never,
        ),
    ).toThrow(/side-effect-free and synchronous/);
  });

  it('fails closed when a destructive transition omits its acknowledgement', () => {
    const application = app('profile-transitions', {
      spec: Installation,
      status: type({ ready: 'boolean' }),
    });
    const PrimaryDatabase = TransactionalDatabase.named('primary');
    const deployment = application.profile(
      application.installation.spec,
      'profile',
    );
    expect(() =>
      deployment
        .provide(PrimaryDatabase)
        .starter(
          () => TransactionalDatabase.postgres({ database: 'starter' }),
          {
            transitions: [{
              from: 'starter',
              to: 'dedicated',
              kind: 'replace',
              destructive: true,
              authority: 'source-until-cutover',
              drainDependents: true,
              rollback: 'manual',
            }],
          },
        )
        .dedicated(() =>
          TransactionalDatabase.postgres({ database: 'dedicated' }),
        )
        .external(() =>
          TransactionalDatabase.postgres({ database: 'external' }),
        )
        .exhaustive(),
    ).toThrow(/requires an installation-scoped acknowledgement/);
  });
});
