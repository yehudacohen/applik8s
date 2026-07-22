// typecast-file-boundary: provider-preparation fixtures preserve literal receipt discriminators and inspect normalized graph data.
import { app, applicationGraphFor, IndexStore, ModelStore, ObjectStorage, ProjectionStore, RequestIdentity, task, WorkflowEngine } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import { describe, expect, it, vi } from 'vitest';

import {
  applicationValkeyIndexStoreFromGraph,
  applicationIdentityInfrastructureFromGraph,
  applicationS3ObjectStorageFromGraph,
  applicationPostgresModelStoreFromGraph,
  deleteApplicationProviderPrerequisites,
  prepareApplicationProviderPrerequisites,
  retainedApplicationProviderNamespaces,
} from '../src/application-provider-preparation.js';
import { applicationPostgresClusterSpec } from '../src/application-providers.js';
import { resolveApplicationInstallationValues } from '../src/application-installation-values.js';

function requiredApplicationGraph(application: { readonly composition: Parameters<typeof applicationGraphFor>[0] }) {
  const graph = applicationGraphFor(application.composition);
  if (!graph) throw new Error('Expected the application composition to carry an ApplicationGraph.');
  return graph;
}

describe('application provider preparation', () => {
  it('concretizes profile-selected object-storage ownership before direct preparation', async () => {
    const application = app('profiled-objects', {
      apiVersion: 'applications.example.test/v1alpha1',
      kind: 'ProfiledObjects',
      spec: type({
        profile: "'managed' | 'external'",
        name: 'string',
        'external?': { bucket: 'string', endpoint: 'string', credentialsSecretName: 'string' },
      }),
      status: type({ ready: 'boolean' }),
      namespace: (spec) => spec.name,
    });
    const external = application.installation.spec.external!;
    application.provide(ObjectStorage, ObjectStorage.s3({
      enabled: true,
      bucket: application.select(application.installation.spec.profile, { external: external.bucket, default: 'managed-media' }),
      endpoint: application.select(application.installation.spec.profile, { external: external.endpoint, default: 'http://rook-ceph-rgw.example.svc:80' }),
      region: 'us-east-1',
      credentialsSecret: {
        apiVersion: 'v1', kind: 'Secret', namespace: application.installation.spec.name,
        name: application.select(application.installation.spec.profile, { external: external.credentialsSecretName, default: 'managed-media' }),
      },
      ownership: application.select(application.installation.spec.profile, { external: 'external', default: 'direct-provisioned' }),
      provisioning: {
        enabled: application.select(application.installation.spec.profile, { external: false, default: true }),
        storageClassName: 'rook-ceph-bucket',
      },
    }));
    const runtime = {
      ensureValkeyOperator: vi.fn(), ensureValkeyCluster: vi.fn(), deleteValkeyCluster: vi.fn(), ensurePostgresCluster: vi.fn(), deletePostgresCluster: vi.fn(),
      ensureClickHouseOperatorNamespace: vi.fn(), ensureObjectStorageClaim: vi.fn(async () => ({ provider: 'rook-obc' as const, ownership: 'managed' as const, name: 'managed-media', namespace: 'managed', bucket: 'managed-media', storageClassName: 'rook-ceph-bucket', credentialsSecretName: 'managed-media', endpointConfigMapName: 'managed-media', ready: true as const })), deleteObjectStorageClaim: vi.fn(), ensureWorkflowAdminCredentials: vi.fn(), deleteWorkflowAdminCredentials: vi.fn(),
    };

    const managed = resolveApplicationInstallationValues(requiredApplicationGraph(application), { profile: 'managed', name: 'managed' });
    await prepareApplicationProviderPrerequisites(managed, 'orbstack', runtime);
    expect(runtime.ensureObjectStorageClaim).toHaveBeenCalledWith('orbstack', expect.objectContaining({ namespace: 'managed', bucket: 'managed-media' }));

    runtime.ensureObjectStorageClaim.mockClear();
    const externallyOwned = resolveApplicationInstallationValues(requiredApplicationGraph(application), {
      profile: 'external', name: 'external', external: { bucket: 'external-media', endpoint: 'https://objects.example.test', credentialsSecretName: 'external-s3' },
    });
    await prepareApplicationProviderPrerequisites(externallyOwned, 'production', runtime);
    expect(runtime.ensureObjectStorageClaim).not.toHaveBeenCalled();
    expect(applicationS3ObjectStorageFromGraph(externallyOwned)).toMatchObject({
      ownership: 'external', bucket: 'external-media', endpoint: 'https://objects.example.test',
      credentialsSecret: { name: 'external-s3', namespace: 'external' },
      provisioning: { enabled: false },
    });
  });

  it('materializes profile-selected PostgreSQL lifecycle before direct preparation', async () => {
    const graph = {
      apiVersion: 'applik8s.appGraph/v1alpha1', kind: 'ApplicationGraph', metadata: { name: 'chirp', namespace: '${schema.spec.name}' },
      nodes: [{
        id: 'provider.model-store', kind: 'provider', name: 'ModelStore', stability: 'stable', interface: 'ModelStore', implementation: 'postgres',
        config: { modelStore: {
          kind: 'postgres', name: 'chirp', namespace: '${schema.spec.name}', database: '${schema.spec.profile == "external" ? schema.spec.providers.database.database : ("chirp")}',
          ownership: '${schema.spec.profile == "external" ? "external" : ("direct-provisioned")}',
          provision: '${schema.spec.profile == "external" ? false : (true)}', lifecycle: { deletionPolicy: '${schema.spec.lifecycle.databaseDeletion}' },
          connectionSecret: { apiVersion: 'v1', kind: 'Secret', name: '${schema.spec.profile == "external" ? schema.spec.providers.database.connectionSecretName : ("chirp-app")}', namespace: '${schema.spec.name}' },
        } },
      }], edges: [], providerRequirements: [], providerBindings: [], compatibility: { stablePublicApis: [], documentedInternalContracts: [], experimentalSurfaces: [], postV3Surfaces: [], labels: [] },
    } as const;
    const ensurePostgresCluster = vi.fn(async () => ({ provider: 'cloudnative-pg' as const, ownership: 'managed' as const, name: 'chirp', namespace: 'community', database: 'chirp', deletionPolicy: 'retain' as const, ready: true as const }));
    const runtime = {
      ensureValkeyOperator: vi.fn(), ensureValkeyCluster: vi.fn(), deleteValkeyCluster: vi.fn(), ensurePostgresCluster, deletePostgresCluster: vi.fn(),
      ensureClickHouseOperatorNamespace: vi.fn(), ensureObjectStorageClaim: vi.fn(), deleteObjectStorageClaim: vi.fn(), ensureWorkflowAdminCredentials: vi.fn(), deleteWorkflowAdminCredentials: vi.fn(),
    };
    const managed = resolveApplicationInstallationValues(graph, { name: 'community', profile: 'starter', lifecycle: { databaseDeletion: 'retain' } });
    await prepareApplicationProviderPrerequisites(managed, 'orbstack', runtime);
    expect(ensurePostgresCluster).toHaveBeenCalledWith('orbstack', expect.objectContaining({ name: 'chirp', namespace: 'community', database: 'chirp', deletionPolicy: 'retain' }));

    ensurePostgresCluster.mockClear();
    const external = resolveApplicationInstallationValues(graph, { name: 'enterprise', profile: 'external', lifecycle: { databaseDeletion: 'retain' }, providers: { database: { database: 'tenant_chirp', connectionSecretName: 'external-postgres' } } });
    await prepareApplicationProviderPrerequisites(external, 'production', runtime);
    expect(ensurePostgresCluster).not.toHaveBeenCalled();
    expect(applicationPostgresModelStoreFromGraph(external)).toMatchObject({ ownership: 'external', provision: false, database: 'tenant_chirp', connectionSecret: { name: 'external-postgres' } });
  });

  it('prepares retained PostgreSQL outside the KRO owner and never deletes it implicitly', async () => {
    const application = app('retained-database', { namespace: 'retained-database' });
    const provider = ModelStore.postgres({
      name: 'authoritative',
      namespace: 'retained-database',
      database: 'chirp',
      ownership: 'direct-provisioned',
      lifecycle: { deletionPolicy: 'retain', preparationTimeoutMs: 420_000 },
      instances: 3,
      storage: { size: '100Gi', storageClassName: 'durable' },
    });
    application.provide(ModelStore, provider);
    const graph = requiredApplicationGraph(application);
    expect(applicationPostgresModelStoreFromGraph(graph)).toEqual(provider);
    const postgresReceipt = {
      provider: 'cloudnative-pg' as const,
      ownership: 'managed' as const,
      name: 'authoritative',
      namespace: 'retained-database',
      database: 'chirp',
      deletionPolicy: 'retain' as const,
      ready: true as const,
    };
    const runtime = {
      ensureValkeyOperator: vi.fn(), ensureValkeyCluster: vi.fn(), deleteValkeyCluster: vi.fn(),
      ensurePostgresCluster: vi.fn(async () => postgresReceipt), deletePostgresCluster: vi.fn(),
      ensureClickHouseOperatorNamespace: vi.fn(), ensureObjectStorageClaim: vi.fn(), deleteObjectStorageClaim: vi.fn(),
      ensureWorkflowAdminCredentials: vi.fn(), deleteWorkflowAdminCredentials: vi.fn(),
    };

    const receipt = await prepareApplicationProviderPrerequisites(graph, 'orbstack', runtime);
    expect(runtime.ensurePostgresCluster).toHaveBeenCalledWith('orbstack', {
      name: 'authoritative', namespace: 'retained-database', database: 'chirp', deletionPolicy: 'retain', timeoutMs: 420_000,
      spec: {
        instances: 3,
        storage: { size: '100Gi', storageClass: 'durable' },
        bootstrap: { initdb: { database: 'chirp', owner: 'app' } },
      },
    });
    expect(receipt.postgres).toEqual(postgresReceipt);
    expect(retainedApplicationProviderNamespaces(receipt)).toEqual(['retained-database']);
    const objectStorageReceipt = {
      provider: 'rook-obc' as const,
      ownership: 'managed' as const,
      name: 'database-backups',
      namespace: 'retained-database',
      bucket: 'database-backups',
      storageClassName: 'rook-retain',
      ready: true as const,
    };
    await deleteApplicationProviderPrerequisites({ ...receipt, objectStorage: objectStorageReceipt }, 'orbstack', runtime);
    expect(runtime.deletePostgresCluster).not.toHaveBeenCalled();
    expect(runtime.deleteObjectStorageClaim).not.toHaveBeenCalled();
    const disposable = { ...postgresReceipt, deletionPolicy: 'delete' as const };
    expect(retainedApplicationProviderNamespaces({ ...receipt, postgres: disposable })).toEqual([]);
    await deleteApplicationProviderPrerequisites({ ...receipt, postgres: disposable, objectStorage: objectStorageReceipt }, 'orbstack', runtime);
    expect(runtime.deletePostgresCluster).toHaveBeenCalledWith('orbstack', disposable);
    expect(runtime.deleteObjectStorageClaim).toHaveBeenCalledWith('orbstack', objectStorageReceipt);
  });

  it('rejects a retained PostgreSQL cluster owned by the Application graph', () => {
    expect(() => ModelStore.postgres({ lifecycle: { deletionPolicy: 'retain' } })).toThrow(/graph ownership cannot retain/);
  });

  it('requires direct PostgreSQL lifecycle intent at authoring time', () => {
    expect(() => ModelStore.postgres({ ownership: 'direct-provisioned' })).toThrow(/requires lifecycle\.deletionPolicy/);
    expect(() => ModelStore.postgres({ ownership: 'unbounded' as never })).toThrow(/ownership must be/);
    expect(() => ModelStore.postgres({ provision: 'sometimes' as never })).toThrow(/provision must be/);
  });

  it('lowers one typed backup intent into the direct and graph CNPG contract', () => {
    const provider = ModelStore.postgres({
      ownership: 'direct-provisioned',
      lifecycle: { deletionPolicy: 'retain' },
      backup: {
        schedule: '0 0 2 * * *',
        retentionPolicy: '14d',
        destination: {
          kind: 's3',
          destinationPath: 's3://chirp-media/database-backups',
          endpoint: 'http://rook-ceph-rgw.example.svc:80',
          credentialsSecret: { apiVersion: 'v1', kind: 'Secret', name: 'chirp-media', namespace: 'chirp' },
          regionKey: 'AWS_REGION',
        },
      },
    });
    expect(applicationPostgresClusterSpec(provider, 'chirp')).toMatchObject({
      bootstrap: { initdb: { database: 'chirp', owner: 'app' } },
      backup: {
        retentionPolicy: '14d',
        target: 'prefer-standby',
        barmanObjectStore: {
          destinationPath: 's3://chirp-media/database-backups',
          endpointURL: 'http://rook-ceph-rgw.example.svc:80',
          s3Credentials: {
            accessKeyId: { name: 'chirp-media', key: 'AWS_ACCESS_KEY_ID' },
            secretAccessKey: { name: 'chirp-media', key: 'AWS_SECRET_ACCESS_KEY' },
            region: { name: 'chirp-media', key: 'AWS_REGION' },
          },
        },
      },
    });
    expect(() => ModelStore.postgres({
      backup: {
        schedule: '', retentionPolicy: 'forever',
        destination: { kind: 'volume-snapshot' },
      },
    })).toThrow(/backup\.schedule/);
  });

  it('observes a direct-lifecycle Hyperspike Valkey cluster without leaking KRO ApplySet ownership', () => {
    const application = app('provider-preparation', { namespace: 'provider-preparation' });
    const provider = IndexStore.valkey({
      provisioner: 'hyperspike',
      name: 'online-index',
      namespace: 'provider-preparation',
      operator: { name: 'shared-valkey', namespace: 'valkey-system', version: '0.0.59' },
      topology: { shards: 2, replicas: 1 },
      authentication: { mode: 'anonymous' },
      storage: { size: '5Gi', storageClassName: 'local-path' },
    });
    application.provide(IndexStore, provider);

    const graph = requiredApplicationGraph(application);
    expect(applicationValkeyIndexStoreFromGraph(graph)).toEqual(provider);
    const resource = application.composition.resources.find((candidate) => candidate.kind === 'Valkey');
    expect(resource).toMatchObject({
      apiVersion: 'hyperspike.io/v1',
      kind: 'Valkey',
      metadata: { name: 'online-index', namespace: 'provider-preparation' },
    });
    expect(Reflect.get(resource ?? {}, '__externalRef')).toBe(true);
  });

  it('prepares the operator once and records credential-free readiness evidence', async () => {
    const application = app('provider-preparation-plan', { namespace: 'provider-preparation-plan' });
    application.provide(IndexStore, IndexStore.valkey({
      provisioner: 'hyperspike',
      operator: { name: 'shared-valkey', namespace: 'valkey-system' },
    }));
    const graph = requiredApplicationGraph(application);
    const ensureValkeyOperator = vi.fn(async () => ({
      provider: 'valkey' as const,
      ownership: 'external' as const,
      name: 'shared-valkey',
      namespace: 'valkey-system',
      ready: true as const,
    }));
    const ensureValkeyCluster = vi.fn(async () => ({
      provider: 'hyperspike-valkey' as const,
      ownership: 'managed' as const,
      name: 'provider-preparation-plan-index',
      namespace: 'provider-preparation-plan',
      endpoint: 'provider-preparation-plan-index.provider-preparation-plan.svc.cluster.local',
      port: 6379,
      topology: { shards: 1, replicas: 0 },
      ready: true as const,
    }));

    await expect(prepareApplicationProviderPrerequisites(graph, 'orbstack', {
      ensureValkeyOperator,
      ensureValkeyCluster,
      deleteValkeyCluster: vi.fn(),
      ensurePostgresCluster: vi.fn(),
      deletePostgresCluster: vi.fn(),
      ensureClickHouseOperatorNamespace: vi.fn(),
      ensureObjectStorageClaim: vi.fn(),
      deleteObjectStorageClaim: vi.fn(),
      ensureWorkflowAdminCredentials: vi.fn(),
      deleteWorkflowAdminCredentials: vi.fn(),
    })).resolves.toEqual({
      apiVersion: 'applik8s.deployment/v1alpha1',
      kind: 'ApplicationProviderPreparationReceipt',
      valkey: {
        provider: 'valkey',
        ownership: 'external',
        name: 'shared-valkey',
        namespace: 'valkey-system',
        ready: true,
      },
      valkeyCluster: {
        provider: 'hyperspike-valkey',
        ownership: 'managed',
        name: 'provider-preparation-plan-index',
        namespace: 'provider-preparation-plan',
        endpoint: 'provider-preparation-plan-index.provider-preparation-plan.svc.cluster.local',
        port: 6379,
        topology: { shards: 1, replicas: 0 },
        ready: true,
      },
    });
    expect(ensureValkeyOperator).toHaveBeenCalledWith('orbstack', {
      kind: 'valkey',
      name: 'shared-valkey',
      namespace: 'valkey-system',
    });
    expect(ensureValkeyCluster).toHaveBeenCalledWith('orbstack', {
      name: 'provider-preparation-plan-index',
      namespace: 'provider-preparation-plan',
      spec: { shards: 1, replicas: 0, anonymousAuth: true },
      topology: { shards: 1, replicas: 0 },
      timeoutMs: 300_000,
    });
  });

  it('does not provision external or standalone index stores', async () => {
    const application = app('external-index', { namespace: 'external-index' });
    application.provide(IndexStore, IndexStore.valkey({ host: 'valkey.example.test', provision: false }));
    const ensureValkeyOperator = vi.fn();

    await expect(prepareApplicationProviderPrerequisites(
      requiredApplicationGraph(application),
      'production',
      { ensureValkeyOperator, ensureValkeyCluster: vi.fn(), deleteValkeyCluster: vi.fn(),
      ensurePostgresCluster: vi.fn(),
      deletePostgresCluster: vi.fn(), ensureClickHouseOperatorNamespace: vi.fn(), ensureObjectStorageClaim: vi.fn(), deleteObjectStorageClaim: vi.fn(), ensureWorkflowAdminCredentials: vi.fn(), deleteWorkflowAdminCredentials: vi.fn() },
    )).resolves.toEqual({
      apiVersion: 'applik8s.deployment/v1alpha1',
      kind: 'ApplicationProviderPreparationReceipt',
    });
    expect(ensureValkeyOperator).not.toHaveBeenCalled();
  });

  it('prepares the shared ClickHouse operator namespace before KRO singleton reconciliation', async () => {
    const application = app('projection-preparation', { namespace: 'projection-preparation' });
    application.provide(ProjectionStore, ProjectionStore.clickhouse({ name: 'analytics', namespace: 'projection-preparation' }));
    const clickhouseReceipt = {
      apiVersion: 'applik8s.deployment/v1alpha1' as const,
      kind: 'DirectNamespacePreparation' as const,
      namespace: 'clickhouse-system',
      instanceName: 'clickhouse-system',
      ownership: 'managed' as const,
      purpose: 'provider-control-plane' as const,
    };
    const ensureClickHouseOperatorNamespace = vi.fn(async () => clickhouseReceipt);

    const receipt = await prepareApplicationProviderPrerequisites(
      requiredApplicationGraph(application),
      'orbstack',
      {
        ensureValkeyOperator: vi.fn(),
        ensureValkeyCluster: vi.fn(),
        deleteValkeyCluster: vi.fn(),
      ensurePostgresCluster: vi.fn(),
      deletePostgresCluster: vi.fn(),
        ensureClickHouseOperatorNamespace,
        ensureObjectStorageClaim: vi.fn(),
        deleteObjectStorageClaim: vi.fn(),
        ensureWorkflowAdminCredentials: vi.fn(),
        deleteWorkflowAdminCredentials: vi.fn(),
      },
    );
    expect(ensureClickHouseOperatorNamespace).toHaveBeenCalledWith('orbstack', 'clickhouse-system');
    expect(receipt.clickhouseOperatorNamespace).toEqual(clickhouseReceipt);
  });

  it('performs no direct provider side effects for capabilities disabled by concrete installation state', async () => {
    const application = app('disabled-provider-preparation', { namespace: 'disabled-provider-preparation' });
    application.provide(ObjectStorage, ObjectStorage.s3({
      enabled: false,
      bucket: 'media',
      region: 'us-east-1',
      credentialsSecret: { apiVersion: 'v1', kind: 'Secret', name: 'media', namespace: 'disabled-provider-preparation' },
      ownership: 'direct-provisioned',
      provisioning: { storageClassName: 'rook-ceph-bucket' },
    }));
    application.provide(ProjectionStore, ProjectionStore.clickhouse({ enabled: false, namespace: 'disabled-provider-preparation' }));
    application.provide(WorkflowEngine, WorkflowEngine.hatchet({ enabled: false, namespace: 'disabled-provider-preparation' }));
    const probe = task('disabled-provider-preparation.probe.v1', { input: type({ id: 'string' }), output: type({ id: 'string' }) });
    application.task(probe, { idempotencyKey: (input) => input.id }, async (input) => input);
    const runtime = {
      ensureValkeyOperator: vi.fn(),
      ensureValkeyCluster: vi.fn(),
      deleteValkeyCluster: vi.fn(),
      ensurePostgresCluster: vi.fn(),
      deletePostgresCluster: vi.fn(),
      ensureClickHouseOperatorNamespace: vi.fn(),
      ensureObjectStorageClaim: vi.fn(),
      deleteObjectStorageClaim: vi.fn(),
      ensureWorkflowAdminCredentials: vi.fn(),
      deleteWorkflowAdminCredentials: vi.fn(),
    };

    await expect(prepareApplicationProviderPrerequisites(
      requiredApplicationGraph(application),
      'orbstack',
      runtime,
    )).resolves.toEqual({
      apiVersion: 'applik8s.deployment/v1alpha1',
      kind: 'ApplicationProviderPreparationReceipt',
    });
    expect(runtime.ensureClickHouseOperatorNamespace).not.toHaveBeenCalled();
    expect(runtime.ensureObjectStorageClaim).not.toHaveBeenCalled();
    expect(runtime.ensureWorkflowAdminCredentials).not.toHaveBeenCalled();
  });

  it('uses a separate desired-state switch for external S3 without disabling the capability', async () => {
    const application = app('external-object-preparation', { namespace: 'external-object-preparation' });
    application.provide(ObjectStorage, ObjectStorage.s3({
      enabled: true,
      bucket: 'external-media',
      region: 'us-east-1',
      endpoint: 'https://objects.example.test',
      credentialsSecret: { apiVersion: 'v1', kind: 'Secret', name: 'external-media', namespace: 'external-object-preparation' },
      ownership: 'direct-provisioned',
      provisioning: { enabled: false, storageClassName: 'unused-for-external-profile' },
    }));
    const ensureObjectStorageClaim = vi.fn();

    await prepareApplicationProviderPrerequisites(requiredApplicationGraph(application), 'production', {
      ensureValkeyOperator: vi.fn(),
      ensureValkeyCluster: vi.fn(),
      deleteValkeyCluster: vi.fn(),
      ensurePostgresCluster: vi.fn(),
      deletePostgresCluster: vi.fn(),
      ensureClickHouseOperatorNamespace: vi.fn(),
      ensureObjectStorageClaim,
      deleteObjectStorageClaim: vi.fn(),
      ensureWorkflowAdminCredentials: vi.fn(),
      deleteWorkflowAdminCredentials: vi.fn(),
    });

    expect(ensureObjectStorageClaim).not.toHaveBeenCalled();
  });

  it('prepares and deletes an app-owned Rook claim through one recorded direct lifecycle', async () => {
    const application = app('object-preparation', { namespace: 'object-preparation' });
    application.provide(ObjectStorage, ObjectStorage.s3({
      name: 'media',
      bucket: 'media',
      region: 'us-east-1',
      credentialsSecret: { apiVersion: 'v1', kind: 'Secret', name: 'media', namespace: 'object-preparation' },
      ownership: 'direct-provisioned',
      provisioning: { storageClassName: 'rook-ceph-bucket' },
    }));
    const graph = requiredApplicationGraph(application);
    const objectReceipt = {
      provider: 'rook-obc' as const,
      ownership: 'managed' as const,
      name: 'media',
      namespace: 'object-preparation',
      bucket: 'media',
      storageClassName: 'rook-ceph-bucket',
      ready: true as const,
    };
    const runtime = {
      ensureValkeyOperator: vi.fn(),
      ensureValkeyCluster: vi.fn(),
      deleteValkeyCluster: vi.fn(),
      ensurePostgresCluster: vi.fn(),
      deletePostgresCluster: vi.fn(),
      ensureClickHouseOperatorNamespace: vi.fn(),
      ensureObjectStorageClaim: vi.fn(async () => objectReceipt),
      deleteObjectStorageClaim: vi.fn(async () => undefined),
      ensureWorkflowAdminCredentials: vi.fn(),
      deleteWorkflowAdminCredentials: vi.fn(),
    };
    const receipt = await prepareApplicationProviderPrerequisites(graph, 'orbstack', runtime);
    expect(receipt.objectStorage).toEqual(objectReceipt);
    expect(runtime.ensureObjectStorageClaim).toHaveBeenCalledWith('orbstack', {
      name: 'media', namespace: 'object-preparation', bucket: 'media', storageClassName: 'rook-ceph-bucket', timeoutMs: 300_000,
    });
    await deleteApplicationProviderPrerequisites(receipt, 'orbstack', runtime);
    expect(runtime.deleteObjectStorageClaim).toHaveBeenCalledWith('orbstack', objectReceipt);
  });

  it('prepares default Hatchet bootstrap credentials without persisting their values in the receipt', async () => {
    const application = app('workflow-preparation', { namespace: 'workflow-preparation' });
    application.provide(WorkflowEngine, WorkflowEngine.hatchet({
      name: 'workflow-engine',
      namespace: 'workflow-preparation',
    }));
    const probe = task('workflow-preparation.probe.v1', { input: type({ id: 'string' }), output: type({ id: 'string' }) });
    application.task(probe, { idempotencyKey: (input) => input.id }, async (input) => input);
    const workflowReceipt = {
      provider: 'hatchet-admin' as const,
      ownership: 'managed' as const,
      name: 'workflow-engine-admin',
      namespace: 'workflow-preparation',
      managedWorkerTokenSecret: { name: 'hatchet-client-config' as const, namespace: 'workflow-preparation' },
      ready: true as const,
    };
    const runtime = {
      ensureValkeyOperator: vi.fn(),
      ensureValkeyCluster: vi.fn(),
      deleteValkeyCluster: vi.fn(),
      ensurePostgresCluster: vi.fn(),
      deletePostgresCluster: vi.fn(),
      ensureClickHouseOperatorNamespace: vi.fn(),
      ensureObjectStorageClaim: vi.fn(),
      deleteObjectStorageClaim: vi.fn(),
      ensureWorkflowAdminCredentials: vi.fn(async () => workflowReceipt),
      deleteWorkflowAdminCredentials: vi.fn(async () => undefined),
    };

    const receipt = await prepareApplicationProviderPrerequisites(
      requiredApplicationGraph(application),
      'orbstack',
      runtime,
    );
    expect(runtime.ensureWorkflowAdminCredentials).toHaveBeenCalledWith('orbstack', {
      name: 'workflow-engine-admin',
      namespace: 'workflow-preparation',
      createIfMissing: true,
      managedWorkerTokenSecret: { name: 'hatchet-client-config', namespace: 'workflow-preparation' },
    });
    expect(receipt.workflowAdmin).toEqual(workflowReceipt);
    expect(JSON.stringify(receipt)).not.toContain('password');

    await deleteApplicationProviderPrerequisites(receipt, 'orbstack', runtime);
    expect(runtime.deleteWorkflowAdminCredentials).toHaveBeenCalledWith('orbstack', workflowReceipt);
  });

  it('requires explicitly declared Hatchet credentials to exist instead of silently adopting them', async () => {
    const application = app('workflow-external-secret', { namespace: 'workflow-external-secret' });
    application.provide(WorkflowEngine, WorkflowEngine.hatchet({
      namespace: 'workflow-external-secret',
      adminCredentialsSecret: {
        apiVersion: 'v1',
        kind: 'Secret',
        name: 'operator-managed-admin',
        namespace: 'workflow-external-secret',
      },
    }));
    const probe = task('workflow-external-secret.probe.v1', { input: type({ id: 'string' }), output: type({ id: 'string' }) });
    application.task(probe, { idempotencyKey: (input) => input.id }, async (input) => input);
    const ensureWorkflowAdminCredentials = vi.fn(async () => ({
      provider: 'hatchet-admin' as const,
      ownership: 'external' as const,
      name: 'operator-managed-admin',
      namespace: 'workflow-external-secret',
      ready: true as const,
    }));

    await prepareApplicationProviderPrerequisites(requiredApplicationGraph(application), 'production', {
      ensureValkeyOperator: vi.fn(),
      ensureValkeyCluster: vi.fn(),
      deleteValkeyCluster: vi.fn(),
      ensurePostgresCluster: vi.fn(),
      deletePostgresCluster: vi.fn(),
      ensureClickHouseOperatorNamespace: vi.fn(),
      ensureObjectStorageClaim: vi.fn(),
      deleteObjectStorageClaim: vi.fn(),
      ensureWorkflowAdminCredentials,
      deleteWorkflowAdminCredentials: vi.fn(),
    });
    expect(ensureWorkflowAdminCredentials).toHaveBeenCalledWith('production', {
      name: 'operator-managed-admin',
      namespace: 'workflow-external-secret',
      createIfMissing: false,
      managedWorkerTokenSecret: { name: 'hatchet-client-config', namespace: 'workflow-external-secret' },
    });
  });

  it('prepares and deletes explicitly owned Ory infrastructure through its TypeKro lifecycle', async () => {
    const application = app('identity-preparation', { namespace: 'identity-preparation' });
    const infrastructure = {
      kind: 'ory' as const,
      stack: 'platform' as const,
      spec: {
        name: 'identity',
        namespace: 'identity-preparation-ory',
        managed: { databases: true, secrets: true, routes: false, sampleUpstream: false },
      },
      deletionPolicy: 'delete' as const,
      timeoutMs: 600_000,
    };
    application.provide(RequestIdentity, RequestIdentity.from(async () => ({
      principal: { id: 'account-1' },
      trustedContext: { issuer: 'https://identity.example.test', subject: 'subject-1' },
      authorizationVersion: 'policy-v1',
    }), { infrastructure }));
    const graph = requiredApplicationGraph(application);
    expect(applicationIdentityInfrastructureFromGraph(graph)).toEqual(infrastructure);
    const identityReceipt = {
      provider: 'ory' as const,
      stack: 'platform' as const,
      ownership: 'managed' as const,
      name: 'identity',
      namespace: 'identity-preparation-ory',
      deletionPolicy: 'delete' as const,
      ready: true as const,
    };
    const runtime = {
      ensureValkeyOperator: vi.fn(), ensureValkeyCluster: vi.fn(), deleteValkeyCluster: vi.fn(),
      ensurePostgresCluster: vi.fn(), deletePostgresCluster: vi.fn(), ensureClickHouseOperatorNamespace: vi.fn(),
      ensureObjectStorageClaim: vi.fn(), deleteObjectStorageClaim: vi.fn(), ensureWorkflowAdminCredentials: vi.fn(), deleteWorkflowAdminCredentials: vi.fn(),
      ensureIdentityInfrastructure: vi.fn(async () => identityReceipt),
      deleteIdentityInfrastructure: vi.fn(async () => undefined),
    };

    const receipt = await prepareApplicationProviderPrerequisites(graph, 'orbstack', runtime);
    expect(runtime.ensureIdentityInfrastructure).toHaveBeenCalledWith('orbstack', infrastructure);
    expect(receipt.identity).toEqual(identityReceipt);
    await deleteApplicationProviderPrerequisites(receipt, 'orbstack', runtime);
    expect(runtime.deleteIdentityInfrastructure).toHaveBeenCalledWith('orbstack', identityReceipt);
  });
});
