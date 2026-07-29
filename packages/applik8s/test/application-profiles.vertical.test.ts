// typecast-file-boundary: profile conformance fixtures intentionally materialize schema-derived and invalid provider selections across erased branches.
import {
  AnalyticalDatabase,
  Analytics,
  Database,
  TransactionalDatabase,
  app,
  applicationGraphFor,
  event,
} from '@applik8s/applik8s';
import { validateApplicationGraph } from '@applik8s/core';
import { type } from 'arktype';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

const Installation = type({
  name: 'string',
  profile: "'starter' | 'dedicated' | 'external'",
});

describe('application deployment profiles', () => {
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
      .starter((spec) =>
        TransactionalDatabase.postgres({
          database: `${String(spec.name)}-starter`,
        }),
      )
      .dedicated(() =>
        TransactionalDatabase.postgres({
          database: 'dedicated',
          instances: 3,
        }),
      )
      .external(() =>
        TransactionalDatabase.postgres({
          database: 'external',
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
    expect(application.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'Role',
          metadata: expect.objectContaining({
            labels: expect.objectContaining({
              'applik8s.dev/profile-variant': 'dedicated',
            }),
          }),
        }),
        expect.objectContaining({
          kind: 'Role',
          metadata: expect.objectContaining({
            labels: expect.objectContaining({
              'applik8s.dev/profile-variant': 'starter',
            }),
          }),
        }),
      ]),
    );
    const kroYaml = application.composition.factory('kro').toYaml();
    expect(kroYaml).toContain(
      '${schema.spec.profile == "dedicated"}',
    );
    expect(kroYaml).toContain(
      '${schema.spec.profile == "starter"}',
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
      variant: 'starter' | 'dedicated' | 'external',
    ) =>
      TransactionalDatabase.postgres({
        name: `${role}-${variant}`,
        database: `${role}_${variant}`,
        provision: false,
        cluster: {
          apiVersion: 'postgresql.cnpg.io/v1',
          kind: 'Cluster',
          name: `${role}-${variant}`,
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
    ).toMatchObject({
      implementation: 'postgres',
      config: {
        bindingKind: 'frameworkDefault',
        provider: 'postgres',
      },
    });
    expect(
      graph?.nodes.find(
        (node) => node.id === 'provider.transactional-database',
      ),
    ).not.toHaveProperty('config.profile');
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
    expect(kroYaml).toContain('schema.spec.profile == "dedicated"');
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
