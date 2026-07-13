import { createHash } from 'node:crypto';
import { serializeApplicationGraph, type ApplicationDurableStatusOwnershipContract, type ApplicationProviderCompatibilityMatrixContract, type ApplicationProviderInterfaceContract } from '@applik8s/core';
import { app, applicationGraphFor, type ApplicationModelBinding, type ApplicationModelCommandBinding, type ApplicationV03PressureTestContract, type KubernetesApplicationBuilder } from '@applik8s/applik8s';
import { command, entity, event, type } from '@applik8s/applik8s/dsl';
import * as k8s from '@kubernetes/client-node';

export interface TenantPlatformExampleOptions {
  readonly apiGroup?: string;
  readonly namespace?: string;
  readonly stackName?: string;
  readonly stackKind?: string;
  readonly databaseName?: string;
  readonly databaseClusterName?: string;
  readonly adminServerName?: string;
  readonly durableBehavior?: boolean;
}

const defaultOptions: Required<TenantPlatformExampleOptions> = {
  apiGroup: process.env.APPLIK8S_TENANT_PLATFORM_API_GROUP ?? 'platform.applik8s.dev',
  namespace: process.env.APPLIK8S_TENANT_PLATFORM_NAMESPACE ?? 'platform',
  stackName: process.env.APPLIK8S_TENANT_PLATFORM_STACK_NAME ?? 'tenant-platform',
  stackKind: process.env.APPLIK8S_TENANT_PLATFORM_STACK_KIND ?? 'TenantPlatform',
  databaseName: process.env.APPLIK8S_TENANT_PLATFORM_DATABASE ?? 'tenant_platform',
  databaseClusterName: process.env.APPLIK8S_TENANT_PLATFORM_DATABASE_CLUSTER ?? 'tenant-platform-db',
  adminServerName: process.env.APPLIK8S_TENANT_PLATFORM_ADMIN_SERVER ?? 'tenant-admin',
  durableBehavior: false,
};

export const TenantEntity = entity('Tenant', {
  spec: type({
    plan: "'free' | 'team' | 'enterprise'",
    namespace: 'string',
    ownerEmail: 'string',
  }),
  status: type({
    phase: "('Pending' | 'Provisioning' | 'Ready' | 'Failed')?",
    observedGeneration: 'number?',
    url: 'string?',
    message: 'string?',
  }),
});

export type TenantSpec = typeof TenantEntity.spec.infer;
export type TenantStatus = NonNullable<typeof TenantEntity.status>['infer'];

export const EnvironmentEntity = entity('Environment', {
  spec: type({
    tenant: 'string',
    name: 'string',
    cluster: 'string',
    namespace: 'string',
  }),
  status: type({
    phase: "('Pending' | 'Ready' | 'Failed')?",
    message: 'string?',
  }),
});

export type EnvironmentSpec = typeof EnvironmentEntity.spec.infer;
export type EnvironmentStatus = NonNullable<typeof EnvironmentEntity.status>['infer'];

export const AppInstallationEntity = entity('AppInstallation', {
  spec: type({
    tenant: 'string',
    environment: 'string',
    image: 'string',
    replicas: 'number = 1',
  }),
  status: type({
    phase: "('Pending' | 'Applying' | 'Ready' | 'Failed')?",
    url: 'string?',
    message: 'string?',
  }),
});

export type AppInstallationSpec = typeof AppInstallationEntity.spec.infer;
export type AppInstallationStatus = NonNullable<typeof AppInstallationEntity.status>['infer'];

export const MaintenanceWindowEntity = entity('MaintenanceWindow', {
  spec: type({
    tenant: 'string',
    cron: 'string',
    task: "'cleanup' | 'repair' | 'backfill'",
  }),
  status: type({
    lastRunAt: 'string?',
    phase: "('Idle' | 'Running' | 'Failed')?",
  }),
});

export type MaintenanceWindowSpec = typeof MaintenanceWindowEntity.spec.infer;
export type MaintenanceWindowStatus = NonNullable<typeof MaintenanceWindowEntity.status>['infer'];

export const AccountEntity = entity('Account', {
  spec: type({
    tenant: 'string',
    email: 'string',
    displayName: 'string',
    role: "'owner' | 'admin' | 'viewer'",
  }),
  status: type({ active: 'boolean?' }),
});


export type AccountSpec = typeof AccountEntity.spec.infer;
export type AccountStatus = NonNullable<typeof AccountEntity.status>['infer'];

export const RenameTenantAccount = command('tenant-account.rename.v1', {
  input: type({ tenant: 'string', accountId: 'string', displayName: 'string', requestId: 'string' }),
  output: type({ changed: 'boolean', displayName: 'string' }),
  errors: { accountNotFound: type({ accountId: 'string' }) },
});

export const TenantAccountChanged = event('tenant-account.changed.v1', {
  payload: type({ tenant: 'string', accountId: 'string', displayName: 'string' }),
});

export type RenameTenantAccountInput = typeof RenameTenantAccount.input.infer;
export type RenameTenantAccountOutput = typeof RenameTenantAccount.output.infer;

export const AuditRecordEntity = entity('AuditRecord', {
  spec: type({
    tenant: 'string',
    actor: 'string',
    action: 'string',
    subject: 'string',
    createdAt: 'string',
  }),
  status: type({ archived: 'boolean?' }),
});

export type AuditRecordSpec = typeof AuditRecordEntity.spec.infer;
export type AuditRecordStatus = NonNullable<typeof AuditRecordEntity.status>['infer'];

export const InvitationEntity = entity('Invitation', {
  spec: type({
    tenant: 'string',
    email: 'string',
    role: "'admin' | 'viewer'",
    expiresAt: 'string',
  }),
  status: type({
    phase: "('Pending' | 'Accepted' | 'Expired')?",
    acceptedAt: 'string?',
  }),
});

export type InvitationSpec = typeof InvitationEntity.spec.infer;
export type InvitationStatus = NonNullable<typeof InvitationEntity.status>['infer'];

export const UsageSampleEntity = entity('UsageSample', {
  spec: type({
    tenant: 'string',
    metric: 'string',
    value: 'number',
    sampledAt: 'string',
  }),
  status: type({ processed: 'boolean?' }),
});

export type UsageSampleSpec = typeof UsageSampleEntity.spec.infer;
export type UsageSampleStatus = NonNullable<typeof UsageSampleEntity.status>['infer'];

export interface TenantPlatformExample {
  readonly composition: KubernetesApplicationBuilder['composition'];
  readonly models: {
    readonly Account: ApplicationModelBinding<AccountSpec, AccountStatus>;
    readonly AuditRecord: ApplicationModelBinding<AuditRecordSpec, AuditRecordStatus>;
    readonly Invitation: ApplicationModelBinding<InvitationSpec, InvitationStatus>;
    readonly UsageSample: ApplicationModelBinding<UsageSampleSpec, UsageSampleStatus>;
  };
  readonly commands?: {
    readonly renameAccount: ApplicationModelCommandBinding<RenameTenantAccountInput, RenameTenantAccountOutput, AccountSpec, AccountStatus>;
  };
}

export function createTenantPlatformExample(options: TenantPlatformExampleOptions = {}): TenantPlatformExample {
  const config = { ...defaultOptions, ...options };

  const tenantPlatform = app(config.stackName, {
    namespace: config.namespace,
    apiVersion: `${config.apiGroup}/v1alpha1`,
    kind: config.stackKind,
    spec: type({}),
    status: type({ ready: 'boolean', phase: 'string?' }),
  });

  const Tenant = tenantPlatform.resource('Tenant', {
    spec: TenantEntity.spec,
    status: TenantEntity.status,
  });
  tenantPlatform.resource('Environment', {
    spec: EnvironmentEntity.spec,
    status: EnvironmentEntity.status,
  });
  tenantPlatform.resource('AppInstallation', {
    spec: AppInstallationEntity.spec,
    status: AppInstallationEntity.status,
  });
  tenantPlatform.resource('MaintenanceWindow', {
    spec: MaintenanceWindowEntity.spec,
    status: MaintenanceWindowEntity.status,
  });

  tenantPlatform.storage.postgres(config.databaseClusterName, {
    database: config.databaseName,
    migrations: 'generated-job',
  });

  tenantPlatform.defaults({ indexes: 'valkey' });

  const Account = tenantPlatform.model(AccountEntity, {
    schema: {
      identity: ['id'],
      constraints: [{ name: 'account-tenant-email-unique', kind: 'unique', fields: ['tenant', 'email'] }],
      indexes: [
        { name: 'accounts-by-tenant', partitionBy: 'tenant', orderBy: ['email'] },
        { name: 'accounts-by-email', partitionBy: 'email', unique: true },
      ],
      transactions: 'required',
      retention: { mode: 'retain' },
    },
  });
  const AuditRecord = tenantPlatform.model(AuditRecordEntity, {
    schema: {
      identity: ['id'],
      indexes: [{ name: 'audit-by-tenant-time', partitionBy: 'tenant', orderBy: ['createdAt'] }],
      transactions: 'supported',
      retention: { mode: 'ttl', ttlSeconds: 60 * 60 * 24 * 90 },
    },
  });
  const Invitation = tenantPlatform.model(InvitationEntity, {
    schema: {
      identity: ['id'],
      constraints: [{ name: 'invitation-tenant-email-unique', kind: 'unique', fields: ['tenant', 'email'] }],
      indexes: [{ name: 'invitations-by-tenant', partitionBy: 'tenant', orderBy: ['expiresAt'] }],
      transactions: 'required',
      retention: { mode: 'ttl', ttlSeconds: 60 * 60 * 24 * 30 },
    },
  });
  const UsageSample = tenantPlatform.model(UsageSampleEntity, {
    schema: {
      identity: ['id'],
      indexes: [{ name: 'usage-by-tenant-metric', partitionBy: 'tenant', orderBy: ['sampledAt'] }],
      transactions: 'supported',
      retention: { mode: 'ttl', ttlSeconds: 60 * 60 * 24 * 14 },
    },
  });
  const renameAccount = config.durableBehavior ? Account.on.command(RenameTenantAccount, {
    key: ({ accountId }) => accountId,
    ordering: 'serial',
    processor: { replicas: 2, concurrency: 4 },
    idempotencyKey: ({ requestId }) => requestId,
    missing: 'reject',
    transaction: { history: [Account], outbox: [TenantAccountChanged] },
  }, async (account, input, context) => {
    const changed = account.spec.displayName !== input.displayName;
    account.patch({ spec: { displayName: input.displayName } });
    context.emit(TenantAccountChanged, { tenant: input.tenant, accountId: input.accountId, displayName: input.displayName });
    return { changed, displayName: input.displayName };
  }) : undefined;
  tenantPlatform.http(config.adminServerName, {
    service: { port: 80 },
    env: { TENANT_PLATFORM_NAMESPACE: config.namespace },
  }, (http) => {
    http.post('/tenants/:tenant/accounts', async ({ params, form }) => Account.create({
      tenant: params.tenant ?? 'default',
      email: form.string('email').trim().toLowerCase(),
      displayName: form.string('displayName'),
      role: form.enum('role', ['owner', 'admin', 'viewer']),
    }));
    http.get('/tenants/:tenant/accounts', async ({ params }) => Account.index('accounts-by-tenant', { partitionBy: 'tenant', orderBy: ['email'] }).query(params.tenant ?? 'default', { limit: 50 }));
    http.get('/tenants/:tenant/audit', async ({ params, query }) => AuditRecord.index('audit-by-tenant-time', { partitionBy: 'tenant', orderBy: ['createdAt'] }).query(params.tenant ?? 'default', { limit: 100, cursor: query.cursor }));
    http.post('/tenants/:tenant/invitations', async ({ params, form }) => {
      const tenant = params.tenant ?? 'default';
      const email = form.string('email').trim().toLowerCase();
      const role = form.enum('role', ['admin', 'viewer']);
      const invitation = await Invitation.create({ tenant, email, role, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() });
      await AuditRecord.create({ tenant, actor: 'tenant-admin-api', action: 'invitation.created', subject: invitation.id, createdAt: new Date().toISOString() });
      return invitation;
    });
    http.get('/tenants/:tenant/invitations', async ({ params }) => Invitation.index('invitations-by-tenant', { partitionBy: 'tenant', orderBy: ['expiresAt'] }).query(params.tenant ?? 'default', { limit: 50 }));
    http.get('/tenants/:tenant/usage', async ({ params, query }) => UsageSample.index('usage-by-tenant-metric', { partitionBy: 'tenant', orderBy: ['sampledAt'] }).query(params.tenant ?? 'default', { limit: 100, cursor: query.cursor }));
  });

  tenantPlatform.reconcile(Tenant, config.durableBehavior ? async (tenant) => {
    const kubeConfig = new k8s.KubeConfig();
    kubeConfig.loadFromOptions({
      clusters: [{ name: 'cluster', server: 'https://kubernetes.default.svc' }],
      users: [{ name: 'runtime' }],
      contexts: [{ name: 'runtime', cluster: 'cluster', user: 'runtime' }],
      currentContext: 'runtime',
    });
    const namespaces = await kubeConfig.makeApiClient(k8s.CoreV1Api).listNamespace({ limit: 1 });
    tenant.status.phase = 'Ready';
    tenant.status.observedGeneration = tenant.metadata.generation ?? 0;
    tenant.status.url = `https://${tenant.metadata.name}.${tenant.spec.namespace}.example.test`;
    tenant.status.message = `Kubernetes SDK observed ${namespaces.items.length} namespace`;
  } : async (tenant) => {
    tenant.status.phase = 'Ready';
    tenant.status.observedGeneration = tenant.metadata.generation ?? 0;
    tenant.status.url = `https://${tenant.metadata.name}.${tenant.spec.namespace}.example.test`;
  }, config.durableBehavior ? {
    scope: 'Cluster',
    permissions: [{ apiGroups: [''], resources: ['namespaces'], verbs: ['get', 'list'] }],
  } : {});

  tenantPlatform.job('tenant-platform-repair', { taskKind: 'repair', image: 'postgres:16-alpine', command: ['sh', '-c'], args: ['echo repair tenant platform status'] });
  tenantPlatform.schedule('tenant-platform-cleanup', { taskKind: 'cleanup', cron: '*/15 * * * *', image: 'postgres:16-alpine', concurrencyPolicy: 'forbid', missedRunPolicy: 'failClosed' });

  return { composition: tenantPlatform.composition, models: { Account, AuditRecord, Invitation, UsageSample }, ...(renameAccount ? { commands: { renameAccount } } : {}) };
}

export function createTenantPlatformV04Example(options: TenantPlatformExampleOptions = {}): TenantPlatformExample {
  return createTenantPlatformExample({ ...options, durableBehavior: true });
}

export function createTenantPlatformPressureTestContract(example = createTenantPlatformExample()): ApplicationV03PressureTestContract {
  const graph = applicationGraphFor(example.composition);
  if (!graph) {
    throw new Error('tenant platform pressure-test graph is missing');
  }
  const digest = `sha256:${createHash('sha256').update(serializeApplicationGraph(graph)).digest('hex')}`;
  return {
    name: 'tenant-platform-control-plane-pressure-test',
    graph: { apiVersion: graph.apiVersion, path: 'application-graph.json', digest },
    requiredNodes: [...new Set(graph.nodes.map((node) => node.kind))],
    requiredProviders: ['ModelStore', 'IndexStore', 'CounterStore', 'Secret', 'HttpExposure', 'CredentialStore', 'Queue', 'ObjectStorage', 'EventSource'],
    requiredRuntimeModules: ['serverRuntime', 'modelRuntime', 'jobRunnerRuntime', 'kubernetesClient', 'diagnostics', 'providerAdapter'],
    requiredOperationTargets: [{ id: 'operation-target.tenant-stack', target: { nodeId: 'typeKroResource.tenant-stack' }, operations: ['apply', 'delete'], execution: { contexts: ['handler', 'generatedServer', 'generatedJob', 'typeKro'], ordering: 'dependencyAware', runtimeValidation: 'beforeEffects', failurePolicy: 'failClosed' }, lowering: { mode: 'typeKroResource', artifact: { kind: 'typeKroResource', path: 'plans/tenant-stack.apply.json' }, failurePolicy: 'failClosed' }, dryRun: { supported: true, artifact: { kind: 'typeKroResource', path: 'plans/tenant-stack.dry-run.json' }, failurePolicy: 'failClosed' }, ownership: { ownerReferences: 'required', orphanPolicy: 'retain' }, finalizers: { required: true, finalizer: 'platform.applik8s.dev/tenant-stack', cleanupOperation: 'deleteTarget' }, permissions: [{ apiGroups: ['platform.applik8s.dev'], resources: ['tenantstacks'], verbs: ['create', 'patch', 'delete'] }], diagnostics: [] }],
    requiredWatchScopes: [
      { scope: { kind: 'labelSelector', apiVersion: 'apps/v1', resourceKind: 'Deployment', namespace: defaultOptions.namespace, labels: { 'platform.applik8s.dev/tenant': 'tenant-a' } }, lowering: 'labelSelector', runtime: { mode: 'sharedInformer', resyncPolicy: 'bounded', cancellation: 'onScopeRemoved' }, permissions: [{ apiGroups: ['apps'], resources: ['deployments'], verbs: ['list', 'watch'] }], failurePolicy: 'failClosed', diagnostics: [] },
      { scope: { kind: 'labelSelector', apiVersion: 'apps/v1', resourceKind: 'Deployment', namespace: defaultOptions.namespace, labels: {} }, lowering: 'labelSelector', permissions: [], failurePolicy: 'failClosed', diagnostics: [{ event: 'applik8s-watch-scope-unlowerable', severity: 'error', subject: { apiVersion: 'apps/v1', kind: 'Deployment', namespace: defaultOptions.namespace }, reason: 'UnsupportedLabelSelectorExpression', message: 'Unsupported watch predicate fails closed instead of broadening tenant platform watches.', retryable: false }] },
    ],
    requiredMigrationDriftChecks: [{ model: { nodeId: 'model.account' }, provider: { interface: 'ModelStore', nodeId: 'provider.model-store' }, observedSchemaSource: { apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster', name: defaultOptions.databaseClusterName, namespace: defaultOptions.namespace }, expectedRevision: 'sha256:tenant-platform-schema-v1', policy: { mode: 'explicitPlanRequired', destructiveChangePolicy: 'reject', driftPolicy: 'failClosed', dataBackfillPolicy: 'generatedJob' }, enforcement: { stage: 'preMigration', historyTable: 'applik8s_model_migrations', lock: 'providerNative', failurePolicy: 'failClosed' }, failureModes: ['missingHistoryTable', 'incompatibleIndex', 'destructiveChange'], diagnostics: [{ event: 'applik8s-model-migration-drift-detected', severity: 'error', subject: { nodeId: 'model.account' }, reason: 'SchemaDriftDetected', message: 'Tenant platform schema drift must fail closed before applying migrations.', retryable: false }] }],
    requiredModelStoreSemantics: [tenantPlatformModelStoreSemantics()],
    requiredRuntimeModuleInterfaces: [tenantPlatformRuntimeModuleInterface([{ kind: 'modelRuntime', name: 'tenant-platform-models' }, { kind: 'diagnostics', name: 'diagnostics' }], [{ name: 'createServerRuntime', kind: 'function', stability: 'stable' }], 'required')],
    requiredProviderInterfaces: tenantPlatformProviderInterfaces(),
    providerCompatibility: tenantPlatformProviderCompatibilityMatrix(),
    requiredStatusOwnership: [{ primary: 'applicationStatus', durableAuthority: 'generatedStatusConfigMap', releasePolicy: 'kroStatusProjectionRequired', applicationStatusProjection: 'requiredAuthoritative', appStatusSchema: 'required', appStatusSchemaContract: tenantPlatformAppStatusSchemaContract(), durableStore: { apiVersion: 'v1', kind: 'ConfigMap', name: `${defaultOptions.stackName}-status-reconciler-status`, namespace: defaultOptions.namespace }, fallbackStore: tenantPlatformGeneratedStatusConfigMapContract(), concurrency: tenantPlatformGeneratedStatusConcurrencyContract(), observability: tenantPlatformGeneratedStatusObservabilityContract(), conflictPolicy: 'mergePatch', diagnostics: [{ event: 'applik8s-status-projection-unavailable', severity: 'error', subject: { nodeId: 'job.tenant-platform-model-migration' }, reason: 'KroStatusProjectionRequired', message: 'KRO-owned status.applik8s.jobs hydration is required for the Tenant Platform app resource.', retryable: false }] }],
    requiredStatusEvidence: tenantPlatformStatusEvidence(),
    requiredModelStoreEvidence: tenantPlatformModelStoreEvidence(),
    requiredOperationTargetEvidence: tenantPlatformOperationTargetEvidence(),
    requiredWatchScopeEvidence: tenantPlatformWatchScopeEvidence(),
    runtimeReleasePolicy: tenantPlatformRuntimeReleasePolicy(),
    liveValidation: { contextEnv: 'APPLIK8S_E2E_CONTEXT', requiredResources: [{ apiVersion: 'batch/v1', kind: 'Job', name: 'tenant-platform-model-migration', namespace: defaultOptions.namespace }, { apiVersion: 'apps/v1', kind: 'Deployment', name: defaultOptions.adminServerName, namespace: defaultOptions.namespace }, { apiVersion: 'v1', kind: 'ConfigMap', name: `${defaultOptions.stackName}-status-reconciler-status`, namespace: defaultOptions.namespace }], requiredAssertions: ['migration job completes', 'server becomes ready', 'model create/query works', 'duplicate key returns 409', 'durable job status is persisted', 'migration drift fails closed', 'operation-target dry-run is artifact-backed', 'scoped listener routes watched objects', 'unsupported watch predicates fail closed'], additionalAssertions: ['generated job status history is retained', 'tenant stack operation target dry-run is inspectable'] },
  };
}

function tenantPlatformProviderInterfaces(): readonly ApplicationProviderInterfaceContract[] {
  return [
      { interface: 'ModelStore', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
      { interface: 'HttpExposure', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
      { interface: 'IndexStore', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
      { interface: 'CounterStore', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
      { interface: 'Secret', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
      { interface: 'CredentialStore', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
      { interface: 'Queue', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
      { interface: 'ObjectStorage', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
      { interface: 'EventSource', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
      { interface: 'EventLog', surface: 'experimentalSurface', support: 'implemented', diagnostics: [] },
      { interface: 'Certificate', surface: 'experimentalSurface', support: 'implemented', diagnostics: [] },
      { interface: 'DnsPublication', surface: 'experimentalSurface', support: 'implemented', diagnostics: [] },
    ];
}

function tenantPlatformProviderCompatibilityMatrix(): ApplicationProviderCompatibilityMatrixContract {
  return { apiVersion: 'applik8s.providerCompatibility/v1alpha1', providers: tenantPlatformProviderInterfaces(), requiredForV03: ['ModelStore', 'IndexStore', 'CounterStore', 'EventSource', 'Secret', 'Queue', 'ObjectStorage', 'HttpExposure', 'CredentialStore'] };
}

function tenantPlatformModelStoreSemantics(): NonNullable<ApplicationV03PressureTestContract['requiredModelStoreSemantics']>[number] {
  return {
    generatedRuntimeParity: 'required',
    scriptRuntimeParity: 'required',
    query: { defaultLimit: 50, maxLimit: 500, cursor: 'offset', unsupportedFilters: 'failClosed' },
    indexes: { partitionRequired: true, uniqueEnforcedBy: 'databaseConstraint', orderBy: 'declaredIndexFieldsOnly', unsupportedOrderBy: 'failClosed' },
    constraints: { duplicateKeyDiagnostic: 'applik8s-model-duplicate-key', enforcement: 'databaseConstraint' },
    migrationHistory: { tableName: 'applik8s_model_migrations', revisionColumn: 'revision', appliedAtColumn: 'applied_at' },
    transactions: { declaration: 'supported', singleOperationAtomicity: 'databaseStatement', multiOperationApi: 'implemented', multiOperationBehavior: 'runtimeTransaction' },
    retention: { mode: 'retain', deletionPolicy: 'explicitOnly', enforcement: 'runtimeEnforced' },
  };
}

function tenantPlatformRuntimeModuleInterface(imports: NonNullable<ApplicationV03PressureTestContract['requiredRuntimeModuleInterfaces']>[number]['imports'], exports: NonNullable<ApplicationV03PressureTestContract['requiredRuntimeModuleInterfaces']>[number]['exports'], sourceMaps: NonNullable<ApplicationV03PressureTestContract['requiredRuntimeModuleInterfaces']>[number]['sourceMaps']): NonNullable<ApplicationV03PressureTestContract['requiredRuntimeModuleInterfaces']>[number] {
  return { apiVersion: 'applik8s.runtime/v1alpha1', imports, exports, diagnostics: 'structured', sourceMaps, failurePolicy: 'failClosed' };
}

function tenantPlatformStatusEvidence(): ApplicationV03PressureTestContract['requiredStatusEvidence'] {
  return { authoritativeStore: 'applicationStatus', appStatusProjection: 'requiredAuthoritative', history: 'boundedRetained', conflictBehavior: 'resourceVersionRetryAndExhaustionDiagnostics', restartSafety: 'required', multiJobCronJobCoverage: 'required', metrics: ['acceptedUpdates', 'rejectedUpdates', 'conflictUpdates', 'observedJobs', 'retainedJobs'], liveGate: 'requiredBeforeAnnouncement', failurePolicy: 'failClosed' };
}

function tenantPlatformModelStoreEvidence(): ApplicationV03PressureTestContract['requiredModelStoreEvidence'] {
  return { generatedRuntimeParity: 'localGeneratedArtifactGate', scriptRuntimeParity: 'localAndOptInLiveGate', liveGate: 'requiredBeforeAnnouncement', queryIndexConstraintCoverage: 'required', transactionCoverage: 'required', migrationDriftCoverage: 'required', unsupportedSemantics: 'failClosed' };
}

function tenantPlatformOperationTargetEvidence(): ApplicationV03PressureTestContract['requiredOperationTargetEvidence'] {
  return { contexts: ['handler', 'generatedServer', 'generatedJob', 'typeKro'], dryRunPlans: 'artifactBackedRequired', generatedServerJobExecution: 'required', typeKroExecution: 'required', rbacAndFinalizerCoverage: 'required', failurePolicy: 'failClosed' };
}

function tenantPlatformWatchScopeEvidence(): ApplicationV03PressureTestContract['requiredWatchScopeEvidence'] {
  return { lowerings: ['exact', 'finite', 'labelSelector', 'fieldSelector', 'mixed'], unsupportedPredicateDiagnostics: 'generatedArtifactAndLiveGateRequired', runtimeRouting: 'required', broadWatchFallback: 'forbidden', failurePolicy: 'failClosed' };
}

function tenantPlatformRuntimeReleasePolicy(): ApplicationV03PressureTestContract['runtimeReleasePolicy'] {
  return { startupPackageManager: false, dependencyInstallation: 'buildTimeOnly', runtimeImage: 'explicitImageOrGeneratedRecipe', supplyChain: 'metadataOnlyUntilSignedArtifacts', signedArtifacts: 'postV03', failurePolicy: 'failClosed' };
}

function tenantPlatformAppStatusSchemaContract(): NonNullable<ApplicationDurableStatusOwnershipContract['appStatusSchemaContract']> {
  return { statusRoot: 'status.applik8s', jobsPath: 'status.applik8s.jobs', schema: 'generatedJobStatusMap', ownership: 'kroStatusProjection', pruningBehavior: 'failClosed' };
}

function tenantPlatformGeneratedStatusConfigMapContract(): NonNullable<ApplicationDurableStatusOwnershipContract['fallbackStore']> {
  return { objectOwnership: 'runtimeCreatedResource', dataOwnership: 'runtime', dataKeys: ['status.json', 'applik8s-jobs.json', 'history.json', 'conflicts.json', 'updatedAt'], updateStrategy: 'resourceVersionMergePatch', history: { key: 'history.json', maxEntries: 20, terminalRetention: 'retain' }, conflicts: { key: 'conflicts.json', maxEntries: 20 } };
}

function tenantPlatformGeneratedStatusConcurrencyContract(): NonNullable<ApplicationDurableStatusOwnershipContract['concurrency']> {
  return { updateStrategy: 'resourceVersionRetry', maxAttempts: 5, retryDiagnostic: 'applik8s-job-status-reconciler-status-store-conflict-retry', retryExhaustedDiagnostic: 'applik8s-job-status-reconciler-status-store-conflict-exhausted', failurePolicy: 'failClosed' };
}

function tenantPlatformGeneratedStatusObservabilityContract(): NonNullable<ApplicationDurableStatusOwnershipContract['observability']> {
  return { mergeEvent: 'applik8s-job-status-reconciler-status-store-merged', conflictRetryEvent: 'applik8s-job-status-reconciler-status-store-conflict-retry', metrics: ['acceptedUpdates', 'rejectedUpdates', 'conflictUpdates', 'observedJobs', 'retainedJobs'] };
}

export const tenantPlatform = createTenantPlatformExample().composition;
export const tenantPlatformV04 = createTenantPlatformV04Example().composition;
