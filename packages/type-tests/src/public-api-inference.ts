import type {
  CapabilityClient,
  CapabilityClientSet,
  GraphAdapter,
  HandlerContext,
  GeneratedJobContract,
  GeneratedJobDurableStatusUpdaterContract,
  GeneratedJobPhaseStatusContract,
  ApplicationMigrationDriftCheckContract,
  ApplicationDurableStatusOwnershipContract,
  ApplicationModelStoreSemanticsContract,
  ApplicationOperationTargetContract,
  ApplicationRuntimeModuleContract,
  ApplicationRuntimeModuleInterfaceContract,
  ApplicationV03PressureTestContract,
  ApplicationWatchScopeLoweringContract,
  OperationTarget,
  OperatorManifest,
  ApplicationModelStoreGuaranteesContract,
} from '@applik8s/core';
import type {
  Applik8sSdk,
  AnyCrdInstanceFactory,
  CrdInstanceInput,
  DeployedOperator,
  SchemaInput,
} from '@applik8s/sdk';
import type { Applik8sTestingApi } from '@applik8s/testing';
import type { Applik8sTypeKroAdapterApi, TypeKroGraph } from '@applik8s/typekro-adapter';
import type { Applik8sTypeKroAdapterApi as TopLevelTypeKroAdapterApi } from '@applik8s/applik8s';
import { Certificate, command, CounterStore, CredentialStore, DnsPublication, event, EventSource, HttpExposure, IndexStore, ModelStore, ObjectStorage, Queue, Secret, sdk as appSdk, type ApplicationConfigBinding, type ApplicationExposureBinding, type ApplicationJobBinding, type ApplicationModelBinding, type ApplicationModelObject, type ApplicationModelStoreProvider, type ApplicationSecretBinding } from '@applik8s/applik8s';
import { entity as appEntity, type as appSchemaType } from '@applik8s/applik8s/dsl';
import { operationTarget as handlerOperationTargetFactory, targetFactory as handlerTargetFactory } from '@applik8s/typekro-adapter/targets';

interface ImageSpec {
  sourceUrl: string;
  formats: string[];
  priority: 'low' | 'normal' | 'high';
}

interface ImageStatus {
  phase: 'Pending' | 'Processing' | 'Complete' | 'Failed';
  outputUrls: string[];
  message?: string;
}

interface AppGraphSpec {
  namespace: string;
  sourceUrl: string;
}

interface AppGraph {
  readonly graphName: 'media-app';
}

interface TenantGraphSpec {
  namespace: string;
  plan?: 'free' | 'pro';
}

interface TenantGraphStatus {
  ready: boolean;
  endpoint: string;
}

interface ChargeRequest {
  amountCents: number;
  currency: 'USD';
}

interface ChargeResponse {
  chargeId: string;
}

interface AccountSpec {
  readonly email: string;
  readonly displayName: string;
}

interface AccountStatus {
  readonly phase?: string;
}

declare const sdk: Applik8sSdk;
declare const testing: Applik8sTestingApi;
declare const typeKro: Applik8sTypeKroAdapterApi;
declare const topLevelTypeKro: TopLevelTypeKroAdapterApi;
declare const imageSpecSchema: SchemaInput<ImageSpec>;
declare const imageStatusSchema: SchemaInput<ImageStatus>;
declare const appGraph: AppGraph;
declare const appGraphAdapter: GraphAdapter<AppGraph, ImageStatus, AppGraphSpec>;
declare const handlerOperationTarget: OperationTarget<ImageStatus>;
declare const imageManifest: OperatorManifest;
declare const tenantGraph: TypeKroGraph<TenantGraphSpec, TenantGraphStatus>;
declare const billing: CapabilityClient<ChargeResponse>;
declare const expectTypeUsage: (...values: readonly unknown[]) => void;

const ImageJob = sdk.crd({
  apiVersion: 'media.applik8s.dev/v1alpha1',
  kind: 'ImageJob',
  spec: imageSpecSchema,
  status: imageStatusSchema,
});

const AccountEntity = appEntity('Account', {
  spec: appSchemaType({ email: 'string', displayName: 'string' }),
  status: appSchemaType({ phase: 'string?' }),
});

const RenameAccount = command('account.rename.v1', {
  input: appSchemaType({ email: 'string', displayName: 'string', requestId: 'string' }),
  output: appSchemaType({ changed: 'boolean', displayName: 'string' }),
  errors: { accountNotFound: appSchemaType({ email: 'string' }) },
});

const AccountChanged = event('account.changed.v1', {
  payload: appSchemaType({ email: 'string', displayName: 'string' }),
});

const accountModelStore = ModelStore.postgres({
  name: 'accounts-db',
  namespace: 'accounts',
  database: 'accounts',
  migrations: ModelStore.migrations.generatedJob({ jobName: 'accounts-model-migration' }),
});

const accountModelStoreProvider: ApplicationModelStoreProvider = accountModelStore;

const modelStoreGuarantees = {
  identity: 'stableId',
  uniqueness: 'databaseConstraint',
  indexes: 'declaredSecondaryIndexes',
  transactions: 'required',
  retention: 'retain',
  migrationOwnership: 'generatedJob',
} satisfies ApplicationModelStoreGuaranteesContract;

const generatedJobContract = {
  id: 'job.accounts-model-migration',
  kind: 'job',
  name: 'accounts-model-migration',
  stability: 'stable',
  task: { taskKind: 'migration' },
  phase: { initialPhase: 'Pending', terminalPhases: ['Complete', 'Failed'], conditions: ['Progressing', 'Ready', 'Failed'] },
  resources: [],
  retry: { mode: 'boundedExponentialBackoff', maxAttempts: 3, initialDelayMs: 1000, maxDelayMs: 30000 },
  observability: {
    health: { mode: 'kubernetesJobStatus' },
    logs: { format: 'json', component: 'applik8s-job-runner', failureEvents: ['applik8s-job-terminal-failure'] },
    metrics: { mode: 'declaredHooks', names: ['applik8s_generated_job_observations_total'] },
    events: ['applik8s-job-terminal-failure'],
    sourceMaps: 'notApplicable',
    replayArtifacts: [{ kind: 'jobDiagnostics', path: 'jobs/accounts-model-migration/diagnostics.json' }],
    diagnosticsArtifact: { kind: 'jobDiagnostics', path: 'jobs/accounts-model-migration/diagnostics.json' },
  },
  runtime: {
    materialization: 'kubernetes-job',
    idempotency: { keySource: 'metadata.generation', conflictPolicy: 'skipCompleted' },
    phaseStatus: { resource: { apiVersion: 'platform.applik8s.dev/v1alpha1', kind: 'AccountsPlatform' }, statusPath: 'status.applik8s.jobs.accounts-model-migration' },
    permissions: [],
  },
} satisfies GeneratedJobContract;

const generatedJobPhaseStatusContract = {
  phase: generatedJobContract.phase,
  idempotency: generatedJobContract.runtime.idempotency,
  statusTarget: generatedJobContract.runtime.phaseStatus,
  statusShape: {
    phase: 'Pending',
    observedGeneration: 1,
    idempotencyKey: 'accounts-schema-v1',
    retryCount: 0,
    conditions: [{ type: 'Progressing', status: 'True', reason: 'JobCreated', message: 'Migration job created.', observedGeneration: 1 }],
  },
} satisfies GeneratedJobPhaseStatusContract;

const generatedJobStatusUpdaterContract = {
  runtimeModule: { kind: 'jobRunnerRuntime', name: 'generated-job-status-updater' },
  observes: [{ apiVersion: 'batch/v1', kind: 'Job', name: 'accounts-model-migration' }],
  writes: generatedJobContract.runtime.phaseStatus,
  statusShape: generatedJobPhaseStatusContract.statusShape,
  failurePolicy: 'failClosed',
  idempotency: generatedJobContract.runtime.idempotency,
  diagnostics: [{ event: 'applik8s-job-terminal-failure', severity: 'error', subject: { nodeId: 'job.accounts-model-migration' }, reason: 'GeneratedJobFailed', message: 'Migration job failed.', retryable: true }],
} satisfies GeneratedJobDurableStatusUpdaterContract;

const generatedRuntimeModuleContract = {
  apiVersion: 'applik8s.runtime/v1alpha1',
  kind: 'jobRunnerRuntime',
  name: 'generated-job-status-updater',
  artifact: { kind: 'runtimeModule', path: 'runtime/job-runner.mjs' },
  entrypoint: 'createJobStatusUpdater',
  exports: [{ name: 'createJobStatusUpdater', kind: 'function', stability: 'stable' }],
  imports: [{ kind: 'kubernetesClient', name: 'kubernetes' }, { kind: 'diagnostics', name: 'diagnostics' }],
} satisfies ApplicationRuntimeModuleContract;

const operationTargetContract = {
  id: 'operation-target.accounts-stack',
  target: { nodeId: 'typeKroResource.accounts-stack' },
  operations: ['apply', 'delete'],
  execution: { contexts: ['handler', 'generatedServer', 'generatedJob', 'typeKro'], ordering: 'dependencyAware', runtimeValidation: 'beforeEffects', failurePolicy: 'failClosed' },
  dryRun: { supported: true, artifact: { kind: 'typeKroResource', path: 'plans/accounts-stack.json' }, failurePolicy: 'failClosed' },
  ownership: { ownerReferences: 'required', orphanPolicy: 'retain' },
  finalizers: { required: true, finalizer: 'platform.applik8s.dev/accounts-stack', cleanupOperation: 'deleteTarget' },
  permissions: [{ apiGroups: ['platform.applik8s.dev'], resources: ['accountsstacks'], verbs: ['create', 'patch', 'delete'] }],
  diagnostics: [{ event: 'applik8s-operation-target-invalid', severity: 'error', subject: { nodeId: 'typeKroResource.accounts-stack' }, reason: 'OperationTargetNotLowerable', message: 'Operation target must lower before effects.', retryable: false }],
} satisfies ApplicationOperationTargetContract;

const operationTargetLoweringArtifacts = handlerOperationTarget.operationTargetArtifacts;

const watchScopeLoweringContract = {
  scope: { kind: 'labelSelector', apiVersion: 'apps/v1', resourceKind: 'Deployment', namespace: 'accounts', labels: { 'app.kubernetes.io/part-of': 'accounts' } },
  lowering: 'labelSelector',
  permissions: [{ apiGroups: ['apps'], resources: ['deployments'], verbs: ['list', 'watch'] }],
  failurePolicy: 'failClosed',
  diagnostics: [],
} satisfies ApplicationWatchScopeLoweringContract;

const unlowerableWatchScopeContract = {
  scope: { kind: 'labelSelector', apiVersion: 'apps/v1', resourceKind: 'Deployment', namespace: 'accounts', labels: {} },
  lowering: 'labelSelector',
  permissions: [],
  failurePolicy: 'failClosed',
  diagnostics: [{ event: 'applik8s-watch-scope-unlowerable', severity: 'error', subject: { apiVersion: 'apps/v1', kind: 'Deployment', namespace: 'accounts' }, reason: 'UnsupportedLabelSelectorExpression', message: 'Unsupported watch predicate fails closed instead of broadening runtime watches.', retryable: false }],
} satisfies ApplicationWatchScopeLoweringContract;

const migrationDriftCheckContract = {
  model: { nodeId: 'model.account' },
  provider: { interface: 'ModelStore', nodeId: 'provider.model-store' },
  observedSchemaSource: { apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster', name: 'accounts-db' },
  expectedRevision: 'sha256:accounts-schema-v1',
  policy: { mode: 'explicitPlanRequired', destructiveChangePolicy: 'reject', driftPolicy: 'failClosed', dataBackfillPolicy: 'generatedJob' },
  failureModes: ['missingHistoryTable', 'incompatibleIndex', 'destructiveChange'],
  diagnostics: [{ event: 'applik8s-model-migration-drift-detected', severity: 'error', subject: { nodeId: 'model.account' }, reason: 'SchemaDriftDetected', message: 'Schema drift detected.', retryable: false }],
} satisfies ApplicationMigrationDriftCheckContract;

const modelStoreSemanticsContract = {
  generatedRuntimeParity: 'required',
  scriptRuntimeParity: 'required',
  query: { defaultLimit: 50, maxLimit: 500, cursor: 'offset', unsupportedFilters: 'failClosed' },
  indexes: { partitionRequired: true, uniqueEnforcedBy: 'databaseConstraint', orderBy: 'declaredIndexFieldsOnly', unsupportedOrderBy: 'failClosed' },
  constraints: { duplicateKeyDiagnostic: 'applik8s-model-duplicate-key', enforcement: 'databaseConstraint' },
  migrationHistory: { tableName: 'applik8s_model_migrations', revisionColumn: 'revision', appliedAtColumn: 'applied_at' },
  transactions: { declaration: 'supported', singleOperationAtomicity: 'databaseStatement', multiOperationApi: 'implemented', multiOperationBehavior: 'runtimeTransaction' },
  retention: { mode: 'retain', deletionPolicy: 'explicitOnly', enforcement: 'runtimeEnforced' },
} satisfies ApplicationModelStoreSemanticsContract;

const runtimeModuleInterfaceContract = {
  apiVersion: 'applik8s.runtime/v1alpha1',
  imports: [{ kind: 'modelRuntime', name: 'postgres-models' }, { kind: 'diagnostics', name: 'diagnostics' }],
  exports: [{ name: 'createServerRuntime', kind: 'function', stability: 'stable' }],
  diagnostics: 'structured',
  sourceMaps: 'required',
  failurePolicy: 'failClosed',
} satisfies ApplicationRuntimeModuleInterfaceContract;

const durableStatusOwnershipContract = {
  primary: 'applicationStatus',
  durableAuthority: 'generatedStatusConfigMap',
  releasePolicy: 'kroStatusProjectionRequired',
  applicationStatusProjection: 'requiredAuthoritative',
  appStatusSchema: 'required',
  appStatusSchemaContract: { statusRoot: 'status.applik8s', jobsPath: 'status.applik8s.jobs', schema: 'generatedJobStatusMap', ownership: 'kroStatusProjection', pruningBehavior: 'failClosed' },
  durableStore: { apiVersion: 'v1', kind: 'ConfigMap', name: 'accounts-platform-status-reconciler-status', namespace: 'accounts' },
  fallbackStore: { objectOwnership: 'runtimeCreatedResource', dataOwnership: 'runtime', dataKeys: ['status.json', 'applik8s-jobs.json', 'history.json', 'conflicts.json', 'updatedAt'], updateStrategy: 'resourceVersionMergePatch', history: { key: 'history.json', maxEntries: 20, terminalRetention: 'retain' }, conflicts: { key: 'conflicts.json', maxEntries: 20 } },
  concurrency: { updateStrategy: 'resourceVersionRetry', maxAttempts: 5, retryDiagnostic: 'applik8s-job-status-reconciler-status-store-conflict-retry', retryExhaustedDiagnostic: 'applik8s-job-status-reconciler-status-store-conflict-exhausted', failurePolicy: 'failClosed' },
  observability: { mergeEvent: 'applik8s-job-status-reconciler-status-store-merged', conflictRetryEvent: 'applik8s-job-status-reconciler-status-store-conflict-retry', metrics: ['acceptedUpdates', 'rejectedUpdates', 'conflictUpdates', 'observedJobs', 'retainedJobs'] },
  conflictPolicy: 'mergePatch',
  diagnostics: [{ event: 'applik8s-status-projection-unavailable', severity: 'error', subject: { nodeId: 'job.accounts-model-migration' }, reason: 'KroStatusProjectionRequired', message: 'KRO-owned status.applik8s.jobs hydration is required.', retryable: false }],
} satisfies ApplicationDurableStatusOwnershipContract;

const v03ProviderInterfaces = [
  { interface: 'ModelStore', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
  { interface: 'IndexStore', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
  { interface: 'CounterStore', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
  { interface: 'EventSource', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
  { interface: 'Secret', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
  { interface: 'Queue', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
  { interface: 'ObjectStorage', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
  { interface: 'HttpExposure', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
  { interface: 'Certificate', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
  { interface: 'DnsPublication', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
  { interface: 'CredentialStore', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
] satisfies ApplicationV03PressureTestContract['requiredProviderInterfaces'];

const v03ProviderCompatibility = {
  apiVersion: 'applik8s.providerCompatibility/v1alpha1',
  providers: v03ProviderInterfaces,
  requiredForV03: ['ModelStore', 'IndexStore', 'CounterStore', 'EventSource', 'Secret', 'Queue', 'ObjectStorage', 'HttpExposure', 'CredentialStore'],
} satisfies ApplicationV03PressureTestContract['providerCompatibility'];

const v03StatusEvidence = {
  authoritativeStore: 'applicationStatus',
  appStatusProjection: 'requiredAuthoritative',
  history: 'boundedRetained',
  conflictBehavior: 'resourceVersionRetryAndExhaustionDiagnostics',
  restartSafety: 'required',
  multiJobCronJobCoverage: 'required',
  metrics: ['acceptedUpdates', 'rejectedUpdates', 'conflictUpdates', 'observedJobs', 'retainedJobs'],
  liveGate: 'requiredBeforeAnnouncement',
  failurePolicy: 'failClosed',
} satisfies ApplicationV03PressureTestContract['requiredStatusEvidence'];

const v03ModelStoreEvidence = {
  generatedRuntimeParity: 'localGeneratedArtifactGate',
  scriptRuntimeParity: 'localAndOptInLiveGate',
  liveGate: 'requiredBeforeAnnouncement',
  queryIndexConstraintCoverage: 'required',
  transactionCoverage: 'required',
  migrationDriftCoverage: 'required',
  unsupportedSemantics: 'failClosed',
} satisfies ApplicationV03PressureTestContract['requiredModelStoreEvidence'];

const v03OperationTargetEvidence = {
  contexts: ['handler', 'generatedServer', 'generatedJob', 'typeKro'],
  dryRunPlans: 'artifactBackedRequired',
  generatedServerJobExecution: 'required',
  typeKroExecution: 'required',
  rbacAndFinalizerCoverage: 'required',
  failurePolicy: 'failClosed',
} satisfies ApplicationV03PressureTestContract['requiredOperationTargetEvidence'];

const v03WatchScopeEvidence = {
  lowerings: ['exact', 'finite', 'labelSelector', 'fieldSelector', 'mixed'],
  unsupportedPredicateDiagnostics: 'generatedArtifactAndLiveGateRequired',
  runtimeRouting: 'required',
  broadWatchFallback: 'forbidden',
  failurePolicy: 'failClosed',
} satisfies ApplicationV03PressureTestContract['requiredWatchScopeEvidence'];

const v03RuntimeReleasePolicy = {
  startupPackageManager: false,
  dependencyInstallation: 'buildTimeOnly',
  runtimeImage: 'explicitImageOrGeneratedRecipe',
  supplyChain: 'metadataOnlyUntilSignedArtifacts',
  signedArtifacts: 'postV03',
  failurePolicy: 'failClosed',
} satisfies ApplicationV03PressureTestContract['runtimeReleasePolicy'];

const v03PressureTestContract = {
  name: 'accounts-platform-pressure-test',
  graph: { apiVersion: 'applik8s.appGraph/v1alpha1', path: 'application-graph.json', digest: 'sha256:accounts' },
  requiredNodes: ['crd', 'model', 'server', 'job', 'provider', 'permission', 'typeKroResource'],
  requiredProviders: ['ModelStore', 'IndexStore', 'Secret', 'HttpExposure', 'CredentialStore'],
  requiredRuntimeModules: ['serverRuntime', 'modelRuntime', 'jobRunnerRuntime', 'kubernetesClient', 'diagnostics', 'providerAdapter'],
  requiredOperationTargets: [operationTargetContract],
  requiredWatchScopes: [watchScopeLoweringContract, unlowerableWatchScopeContract],
  requiredMigrationDriftChecks: [migrationDriftCheckContract],
  requiredModelStoreSemantics: [modelStoreSemanticsContract],
  requiredRuntimeModuleInterfaces: [runtimeModuleInterfaceContract],
  requiredProviderInterfaces: v03ProviderInterfaces,
  providerCompatibility: v03ProviderCompatibility,
  requiredStatusOwnership: [durableStatusOwnershipContract],
  requiredStatusEvidence: v03StatusEvidence,
  requiredModelStoreEvidence: v03ModelStoreEvidence,
  requiredOperationTargetEvidence: v03OperationTargetEvidence,
  requiredWatchScopeEvidence: v03WatchScopeEvidence,
  runtimeReleasePolicy: v03RuntimeReleasePolicy,
  liveValidation: { contextEnv: 'APPLIK8S_E2E_CONTEXT', requiredResources: [{ apiVersion: 'batch/v1', kind: 'Job', name: 'accounts-model-migration', namespace: 'accounts' }, { apiVersion: 'apps/v1', kind: 'Deployment', name: 'accounts-web', namespace: 'accounts' }, { apiVersion: 'v1', kind: 'ConfigMap', name: 'accounts-platform-status-reconciler-status', namespace: 'accounts' }], requiredAssertions: ['migration job completes', 'server becomes ready', 'model create/query works', 'duplicate key returns 409', 'durable job status is persisted', 'migration drift fails closed', 'operation-target dry-run is artifact-backed', 'scoped listener routes watched objects', 'unsupported watch predicates fail closed'] },
} satisfies ApplicationV03PressureTestContract;

// @ts-expect-error v0.3 pressure-test contracts must include release evidence fields, not only graph shape.
const _invalidPartialV03PressureTestContract: ApplicationV03PressureTestContract = {
  name: 'partial-accounts-platform-pressure-test',
  graph: { apiVersion: 'applik8s.appGraph/v1alpha1', path: 'application-graph.json', digest: 'sha256:accounts' },
  requiredNodes: ['model', 'server', 'job', 'provider'],
  requiredProviders: ['ModelStore', 'CredentialStore', 'HttpExposure'],
  requiredRuntimeModules: ['serverRuntime', 'modelRuntime', 'jobRunnerRuntime', 'kubernetesClient', 'diagnostics', 'providerAdapter'],
  requiredOperationTargets: [operationTargetContract],
  requiredWatchScopes: [watchScopeLoweringContract, unlowerableWatchScopeContract],
  requiredMigrationDriftChecks: [migrationDriftCheckContract],
};

expectTypeUsage(accountModelStoreProvider, modelStoreGuarantees, generatedJobContract, generatedJobPhaseStatusContract, generatedJobStatusUpdaterContract, generatedRuntimeModuleContract, operationTargetContract, operationTargetLoweringArtifacts, watchScopeLoweringContract, unlowerableWatchScopeContract, migrationDriftCheckContract, v03PressureTestContract);

// @ts-expect-error ModelStore providers must use the typed provider object, not a string alias.
const _invalidStringModelStoreProvider: ApplicationModelStoreProvider = 'postgres';

// @ts-expect-error ModelStore providers must declare the supported provider kind.
const _invalidMissingKindModelStoreProvider: ApplicationModelStoreProvider = { name: 'accounts-db' };

// @ts-expect-error only the typed Postgres ModelStore provider is supported for the v0.3 substrate contract.
const _invalidProviderKindModelStoreProvider: ApplicationModelStoreProvider = { kind: 'mysql', name: 'accounts-db' };

let accountModelForScriptExecution: ApplicationModelBinding<AccountSpec, AccountStatus> | undefined;

appSdk.kubernetesComposition({
  name: 'accounts-platform',
  apiVersion: 'platform.applik8s.dev/v1alpha1',
  kind: 'AccountsPlatform',
  spec: appSchemaType({ namespace: 'string' }),
  status: appSchemaType({ ready: 'boolean' }),
}, (spec, app) => {
  const store = app.provide(ModelStore, accountModelStore);
  const modelDefaults = app.defaults({ models: accountModelStore });
  const maintenanceJob: ApplicationJobBinding = app.job('compact-accounts', { taskKind: 'maintenance', image: 'busybox:1.36', command: ['sh', '-c'], args: ['echo compact'] });
  const maintenanceSchedule: ApplicationJobBinding = app.schedule('compact-accounts-hourly', { taskKind: 'maintenance', cron: '0 * * * *', concurrencyPolicy: 'forbid', missedRunPolicy: 'failClosed' });
  const maintenanceJobStatusPath: string = maintenanceJob.statusPath;
  const maintenanceScheduleDiagnostics: string = maintenanceSchedule.diagnosticsConfigMapName;
  const maintenanceJobDryRun = maintenanceJob.plan(handlerOperationTarget, { dryRun: true });
  const maintenanceSchedulePlan = maintenanceSchedule.plan(handlerOperationTarget);
  const Account = app.model(AccountEntity, {
    store,
    schema: {
      identity: ['id'],
      constraints: [{ name: 'account-email-unique', kind: 'unique', fields: ['email'] }],
      indexes: [{ name: 'accounts-by-email', partitionBy: 'email', unique: true }],
      transactions: 'required',
      retention: { mode: 'retain' },
    },
  });
  const accountModelBinding: ApplicationModelBinding<AccountSpec, AccountStatus> = Account;
  const renameBinding = Account.on.command(RenameAccount, {
    key: ({ email }) => email,
    idempotencyKey: ({ requestId }) => requestId,
    transaction: { history: [Account], outbox: [AccountChanged] },
  }, async (account, input, context) => {
    const priorDisplayName: string = account.spec.displayName;
    context.emit(AccountChanged, { email: input.email, displayName: input.displayName });
    expectTypeUsage(priorDisplayName, context.commandId, context.now);
    return { changed: priorDisplayName !== input.displayName, displayName: input.displayName };
  });
  void (async () => {
    const acknowledgement = await renameBinding.send({ email: 'ada@example.com', displayName: 'Ada Lovelace', requestId: 'request-1' }, { id: 'command-1', expectedRevision: 'revision-1' });
    const phase: 'transportAcknowledged' = acknowledgement.phase;
    const commandId: string = acknowledgement.commandId;
    const correlationId: string = acknowledgement.correlationId;
    expectTypeUsage(phase, commandId, correlationId);
  });
  accountModelForScriptExecution = accountModelBinding;
  expectTypeUsage(modelDefaults, maintenanceJob, maintenanceSchedule, maintenanceJobStatusPath, maintenanceScheduleDiagnostics, maintenanceJobDryRun, maintenanceSchedulePlan, renameBinding);

  app.server('accounts-web', { namespace: spec.namespace }, (server) => {
    server.post('/accounts', async () => {
      const created = await Account.create({ spec: { email: 'ada@example.com', displayName: 'Ada' } });
      const createdObject: ApplicationModelObject<AccountSpec, AccountStatus> = created;
      const email: string = created.spec.email;
      expectTypeUsage(createdObject, email);
      return created;
    });
    server.get('/accounts', async (request) => {
      const page = await Account.index('accounts-by-email', { partitionBy: 'email', unique: true }).query(request.query.email ?? '', { limit: 10 });
      const first: ApplicationModelObject<AccountSpec, AccountStatus> | undefined = page.items[0];
      expectTypeUsage(first);
      return page;
    });
  });
  const web = app.server('accounts-admin', { namespace: spec.namespace, models: { Account } }, (server) => {
    server.get('/accounts/:id', async (request) => Account.get({ id: request.query.id ?? '' }));
  });
  const webUrl: string = web.url;
  const webDryRun = web.plan(handlerOperationTarget, { dryRun: true });
  expectTypeUsage(webUrl, webDryRun);

  return { ready: true };
});

appSdk.kubernetesComposition({
  name: 'invalid-model-provider-contracts',
  apiVersion: 'platform.applik8s.dev/v1alpha1',
  kind: 'InvalidModelProviderContracts',
  spec: appSchemaType({}),
  status: appSchemaType({ ready: 'boolean' }),
}, (_spec, app) => {
  // @ts-expect-error ModelStore does not accept string provider aliases.
  app.provide(ModelStore, 'postgres');
  // @ts-expect-error app.defaults({ models }) must receive a typed ModelStore provider or provider binding.
  app.defaults({ models: 'postgres' });
  // @ts-expect-error app.model store must be a typed ModelStore provider or ModelStore provider binding.
  app.model(AccountEntity, { store: { kind: 'mysql' } });
  const indexStoreBinding = app.provide(IndexStore, 'valkey');
  // @ts-expect-error Model defaults cannot receive a provider binding for a different provider token.
  app.defaults({ models: indexStoreBinding });
  // @ts-expect-error Model defaults must receive the typed Postgres ModelStore provider declaration.
  app.defaults({ models: { kind: 'mysql' } });

  return { ready: true };
});

appSdk.kubernetesComposition({
  name: 'reserved-provider-token-contracts',
  apiVersion: 'platform.applik8s.dev/v1alpha1',
  kind: 'ReservedProviderTokenContracts',
  spec: appSchemaType({}),
  status: appSchemaType({ ready: 'boolean' }),
}, (_spec, app) => {
  const counterProvider = app.provide(CounterStore, { kind: 'kubernetes-resource-counter' });
  const secretProvider = app.provide(Secret, { kind: 'kubernetes-secret' });
  const eventProvider = app.provide(EventSource, { kind: 'kubernetes-watch' });
  const queueProvider = app.provide(Queue, { kind: 'kubernetes-configmap-queue' });
  const objectStorageProvider = app.provide(ObjectStorage, { kind: 'kubernetes-configmap-objects' });
  const httpExposureProvider = app.provide(HttpExposure, { kind: 'ingress' });
  const certificateProvider = app.provide(Certificate, Certificate.certManager({ issuerRef: { name: 'letsencrypt', kind: 'Issuer' } }));
  const dnsProvider = app.provide(DnsPublication, DnsPublication.externalDns());
  const credentialProvider = app.provide(CredentialStore, { kind: 'kubernetes-secret-credentials' });
  expectTypeUsage(counterProvider, secretProvider, eventProvider, queueProvider, objectStorageProvider, httpExposureProvider, certificateProvider, dnsProvider, credentialProvider);

  const databaseConfig: ApplicationConfigBinding = app.config('database-url', { env: 'DATABASE_URL' });
  const databaseSecret: ApplicationSecretBinding = app.secret('database-url', { secretName: 'db-app', key: 'uri', redaction: 'required' });
  const generatedSecret: ApplicationSecretBinding = app.secret('session-key', { ownership: 'generated' });
  const webExposure: ApplicationExposureBinding = app.expose('web', { service: 'accounts-web', hostnames: ['app.example.test'], tls: { mode: 'managed' }, dns: { mode: 'managed', ttlSeconds: 120 } });
  expectTypeUsage(databaseConfig, databaseSecret, generatedSecret, webExposure);

  return { ready: true };
});

async function useAccountModelDuringScriptExecution(model: ApplicationModelBinding<AccountSpec, AccountStatus>) {
  const created = await model.create({ spec: { email: 'grace@example.com', displayName: 'Grace' } });
  const found = await model.get({ id: created.id });
  const page = await model.query({ where: { email: 'grace@example.com' }, limit: 1 });
  const patched = await model.patch({ id: created.id }, { status: { phase: 'Active' } });
  await model.delete({ id: created.id });
  const phase: string | undefined = patched.status?.phase;
  expectTypeUsage(found, page, phase);

  const transactionResult: string = await model.transaction(async (tx) => {
    const inTransaction = await tx.create({ spec: { email: 'transaction@example.com', displayName: 'Transaction' } });
    await tx.patch({ id: inTransaction.id }, { status: { phase: 'Active' } });
    return inTransaction.id;
  });
  expectTypeUsage(transactionResult);
  // @ts-expect-error retention cleanup is generated/provider-owned, not a direct model method in the v0.3 public API.
  await model.expire({ id: created.id });
}

if (accountModelForScriptExecution) {
  void useAccountModelDuringScriptExecution(accountModelForScriptExecution);
}

type ImageJobInput = Parameters<typeof ImageJob>[0];

const imageJobInput: ImageJobInput = {
  name: 'hero-image',
  spec: {
    sourceUrl: 's3://bucket/hero.png',
    formats: ['webp', 'avif'],
    priority: 'normal',
  },
};

const imagePipeline = sdk.operator({
  name: 'image-pipeline',
  resources: { ImageJob },
  effects: { mode: 'planned', replayable: true },
  handlers: [
    ImageJob.on.reconcile(async (job) => {
      const sourceUrl: string = job.spec.sourceUrl;
      const objectName: string = job.metadata.name;

      job.status.phase = 'Processing';
      job.status.outputUrls = [];
      const output = job.k8s.ConfigMap({
        name: job.names.dnsSafe(`${objectName}-output`),
        data: { sourceUrl, priority: job.spec.priority },
      });

      job.resources.apply(
        job.batch.Job({
          name: job.names.dnsSafe(`${objectName}-proxy`),
          image: 'ghcr.io/acme/image-resizer:v1',
          env: {
            SOURCE_URL: sourceUrl,
          },
        })
      );
      job.apply(output);
      job.delete(output);

      job.apply(handlerOperationTarget);
      job.events.normal('ImageJobAccepted', 'Image job accepted through proxy handler');
      job.requeue({ afterSeconds: 30, reason: 'WaitingForProxyHandlerOutput' });
    }),

    ImageJob.on.context.created(async (job, ctx) => {
      const sourceUrl: string = job.spec.sourceUrl;
      const formats: string[] = job.spec.formats;
      const priority: ImageSpec['priority'] = job.spec.priority;

      expectTypeUsage(sourceUrl, formats, priority);

      const graphResult = ctx.applyGraph({
        graph: appGraph,
        spec: { namespace: 'media', sourceUrl: job.spec.sourceUrl },
        adapter: appGraphAdapter,
      });

      if (!graphResult.ok) {
        return graphResult;
      }

      return ctx.apply({
        applyTargets: [
          {
            target: handlerOperationTarget,
            options: { fieldManager: 'applik8s-test', force: true },
          },
        ],
        resources: [
          ImageJob({
            name: ctx.names.dnsSafe(`${job.metadata.name}-copy`),
            spec: job.spec,
          }),
        ],
        events: [
          ctx.recordEvent({
            kind: 'event',
            type: 'Normal',
            reason: 'ImageJobAccepted',
            message: 'Image job accepted for processing',
          }),
        ],
        finalizers: [{ kind: 'finalizer', operation: 'add', finalizer: 'media.applik8s.dev/image-job' }],
        status: {
          phase: 'Processing',
          outputUrls: [],
        },
      });
    }),
  ],
});

const pipeline = imagePipeline({ namespace: 'media', replicas: 2 });
const lowerCamelImage = pipeline.imageJob(imageJobInput);
const pascalImage = pipeline.ImageJob(imageJobInput);
const resourceImage = pipeline.resource('imageJob', imageJobInput);

const lowerCamelSpec: ImageSpec = lowerCamelImage.spec;
const pascalSpec: ImageSpec = pascalImage.spec;
const resourceSpec: ImageSpec = resourceImage.spec;
const lowerCamelStatus: ImageStatus | undefined = lowerCamelImage.status;

expectTypeUsage(lowerCamelSpec, pascalSpec, resourceSpec, lowerCamelStatus);

interface NamedErasedSpec {
  value: string;
}

declare const erasedOperator: DeployedOperator<
  CapabilityClientSet,
  { readonly anyKind: AnyCrdInstanceFactory }
>;

const erasedInput: CrdInstanceInput<NamedErasedSpec> = {
  name: 'erased-resource',
  spec: { value: 'named-interface-without-index-signature' },
};

const erasedDirect = erasedOperator.anyKind(erasedInput);
const erasedViaHelper = erasedOperator.resource('anyKind', erasedInput);

const erasedDirectSpec: object | undefined = erasedDirect.spec;
const erasedHelperSpec: object | undefined = erasedViaHelper.spec;

expectTypeUsage(erasedDirectSpec, erasedHelperSpec);

testing
  .testOperator(imagePipeline)
  .given(ImageJob(imageJobInput))
  .expectApply(ImageJob(imageJobInput))
  .run({ reconcile: { apiVersion: ImageJob.apiVersion, kind: ImageJob.kind, name: imageJobInput.name } });

const typeKroResult = typeKro.asComposition(imagePipeline.definition, imageManifest, {
  compositionName: 'image-pipeline',
});

if (typeKroResult.ok) {
  const imageOperator = typeKroResult.value;
  const installedPipeline = imageOperator({ namespace: 'media', replicas: 2 });
  const enhancedLowerCamel = installedPipeline.imageJob(imageJobInput);
  const enhancedPascal = installedPipeline.ImageJob(imageJobInput);
  const imageReady: boolean = enhancedLowerCamel.status.phase === 'Complete';
  const imageFailed: boolean = enhancedPascal.status.phase === 'Failed';

  expectTypeUsage(imageReady, imageFailed);
}

const topLevelTypeKroResult = topLevelTypeKro.asComposition(imagePipeline.definition, imageManifest, {
  compositionName: 'image-pipeline-top-level',
});
const ergonomicTypeKroResult = typeKro.composition(imagePipeline.definition, imageManifest, {
  compositionName: 'image-pipeline-ergonomic',
});

if (topLevelTypeKroResult.ok) {
  const installedPipeline = topLevelTypeKroResult.value({ namespace: 'media' });
  const enhancedImage = installedPipeline.imageJob(imageJobInput);
  const enhancedImageSpec: ImageSpec = enhancedImage.spec;

  expectTypeUsage(enhancedImageSpec);
}

if (ergonomicTypeKroResult.ok) {
  const installedPipeline = ergonomicTypeKroResult.value({ namespace: 'media' });
  const enhancedImage = installedPipeline.imageJob(imageJobInput);
  const enhancedImageSpec: ImageSpec = enhancedImage.spec;

  expectTypeUsage(enhancedImageSpec);
}

const sameStatusTypeKroAdapter = typeKro.createGraphAdapter<TenantGraphSpec, TenantGraphStatus>();
const sameStatusTypeKroGraphAdapter = typeKro.graphAdapter<TenantGraphSpec, TenantGraphStatus>();
const mappedTypeKroAdapter = typeKro.createGraphAdapter<
  TenantGraphSpec,
  TenantGraphStatus,
  ImageStatus
>({
  statusMapper: (status) => ({
    phase: status.ready ? 'Complete' : 'Processing',
    outputUrls: status.endpoint ? [status.endpoint] : [],
  }),
});

declare const imageHandlerContext: HandlerContext<ImageSpec, ImageStatus>;

imageHandlerContext.applyGraph({
  graph: tenantGraph,
  spec: { namespace: 'media' },
  adapter: mappedTypeKroAdapter,
});

const contextConfigMap = imageHandlerContext.k8s.ConfigMap({
  name: 'context-output',
  namespace: 'media',
  data: { sourceUrl: 's3://bucket/hero.png' },
});
imageHandlerContext.apply(contextConfigMap);
imageHandlerContext.delete(contextConfigMap);

sameStatusTypeKroAdapter.renderStatus(tenantGraph, { namespace: 'media' });
sameStatusTypeKroGraphAdapter.renderStatus(tenantGraph, { namespace: 'media' });

const mappedTarget = typeKro.toOperationTarget<TenantGraphSpec, TenantGraphStatus, ImageStatus>(
  tenantGraph,
  { namespace: 'media' },
  {
    statusMapper: (status) => ({
      phase: status.ready ? 'Complete' : 'Processing',
      outputUrls: status.endpoint ? [status.endpoint] : [],
    }),
  }
);

const ergonomicMappedTarget = typeKro.operationTarget<TenantGraphSpec, TenantGraphStatus, ImageStatus>(
  tenantGraph,
  { namespace: 'media' },
  {
    statusMapper: (status) => ({
      phase: status.ready ? 'Complete' : 'Processing',
      outputUrls: status.endpoint ? [status.endpoint] : [],
    }),
  }
);
const lightweightMappedTarget = handlerOperationTargetFactory<TenantGraphSpec, TenantGraphStatus, ImageStatus>(
  tenantGraph,
  { namespace: 'media' },
  {
    statusMapper: (status) => ({
      phase: status.ready ? 'Complete' : 'Processing',
      outputUrls: status.endpoint ? [status.endpoint] : [],
    }),
  }
);

imageHandlerContext.apply(mappedTarget);
imageHandlerContext.delete(mappedTarget);
imageHandlerContext.apply(ergonomicMappedTarget);
imageHandlerContext.delete(ergonomicMappedTarget);
imageHandlerContext.apply(lightweightMappedTarget);
imageHandlerContext.delete(lightweightMappedTarget);

const tenantStack = typeKro.asOperationTargetFactory<
  TenantGraphSpec,
  TenantGraphStatus,
  ImageStatus
>(tenantGraph, {
  statusMapper: (status) => ({
    phase: status.ready ? 'Complete' : 'Processing',
    outputUrls: status.endpoint ? [status.endpoint] : [],
  }),
});

const ergonomicTenantStack = typeKro.targetFactory<
  TenantGraphSpec,
  TenantGraphStatus,
  ImageStatus
>(tenantGraph, {
  statusMapper: (status) => ({
    phase: status.ready ? 'Complete' : 'Processing',
    outputUrls: status.endpoint ? [status.endpoint] : [],
  }),
});
const lightweightTenantStack = handlerTargetFactory<
  TenantGraphSpec,
  TenantGraphStatus,
  ImageStatus
>(tenantGraph, {
  statusMapper: (status) => ({
    phase: status.ready ? 'Complete' : 'Processing',
    outputUrls: status.endpoint ? [status.endpoint] : [],
  }),
});

const stack = tenantStack({ namespace: 'media' });
const ergonomicStack = ergonomicTenantStack({ namespace: 'media' });
const lightweightStack = lightweightTenantStack({ namespace: 'media' });
const composableStack = tenantStack({ namespace: 'media', plan: undefined });
const composableTarget = typeKro.toOperationTarget<TenantGraphSpec, TenantGraphStatus, ImageStatus>(
  tenantGraph,
  { namespace: 'media', plan: undefined },
  {
    statusMapper: (status) => ({
      phase: status.ready ? 'Complete' : 'Processing',
      outputUrls: status.endpoint ? [status.endpoint] : [],
    }),
  }
);

const composableSpec = composableStack.spec;
const composableTargetSpec = composableTarget.spec;

expectTypeUsage(composableSpec, composableTargetSpec);

imageHandlerContext.apply(stack);
imageHandlerContext.delete(stack);
imageHandlerContext.plan(stack);
imageHandlerContext.plan(stack, { dryRun: true, fieldManager: 'tenant-platform' });
imageHandlerContext.apply(ergonomicStack);
imageHandlerContext.delete(ergonomicStack);
imageHandlerContext.plan(ergonomicStack);
imageHandlerContext.plan(ergonomicStack, { dryRun: true });
imageHandlerContext.apply(lightweightStack);
imageHandlerContext.delete(lightweightStack);
imageHandlerContext.plan(lightweightStack);
imageHandlerContext.plan(lightweightStack, { dryRun: true });
imageHandlerContext.apply([stack, composableStack], {
  status: { phase: 'Processing', outputUrls: [] },
  events: [
    imageHandlerContext.recordEvent({
      kind: 'event',
      type: 'Normal',
      reason: 'TenantStackApplyRequested',
      message: 'Tenant stack apply requested',
    }),
  ],
});
imageHandlerContext.delete([stack], {
  deleteTargets: [{ target: composableStack, options: { propagationPolicy: 'Foreground' } }],
  status: { phase: 'Pending', outputUrls: [] },
});

// @ts-expect-error statusMapper is required when graph status differs from handler status.
typeKro.createGraphAdapter<TenantGraphSpec, TenantGraphStatus, ImageStatus>();

// @ts-expect-error statusMapper is required when graph status differs from handler status.
typeKro.graphAdapter<TenantGraphSpec, TenantGraphStatus, ImageStatus>();

// @ts-expect-error statusMapper is required for TypeKro operation targets with different handler status.
typeKro.toOperationTarget<TenantGraphSpec, TenantGraphStatus, ImageStatus>(tenantGraph, {
  namespace: 'media',
});

// @ts-expect-error statusMapper is required for TypeKro operation targets with different handler status.
typeKro.operationTarget<TenantGraphSpec, TenantGraphStatus, ImageStatus>(tenantGraph, {
  namespace: 'media',
});

// @ts-expect-error statusMapper is required for target factories with different handler status.
typeKro.asOperationTargetFactory<TenantGraphSpec, TenantGraphStatus, ImageStatus>(tenantGraph);

// @ts-expect-error statusMapper is required for target factories with different handler status.
typeKro.targetFactory<TenantGraphSpec, TenantGraphStatus, ImageStatus>(tenantGraph);

async function useNamedCapabilityPayloads() {
  const charge = await billing.post<ChargeRequest>('/charges', {
    amountCents: 2500,
    currency: 'USD',
  });

  const chargeId: string = charge.chargeId;

  return chargeId;
}

expectTypeUsage(useNamedCapabilityPayloads);
