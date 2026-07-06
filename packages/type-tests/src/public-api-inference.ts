import type {
  CapabilityClient,
  CapabilityClientSet,
  GraphAdapter,
  HandlerContext,
  GeneratedJobContract,
  GeneratedJobDurableStatusUpdaterContract,
  GeneratedJobPhaseStatusContract,
  ApplicationMigrationDriftCheckContract,
  ApplicationOperationTargetContract,
  ApplicationRuntimeModuleContract,
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
import { CounterStore, IndexStore, ModelStore, Secret, sdk as appSdk, type ApplicationJobBinding, type ApplicationModelBinding, type ApplicationModelObject, type ApplicationModelStoreProvider } from '@applik8s/applik8s';
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

const accountModelStore = {
  kind: 'postgres',
  name: 'accounts-db',
  namespace: 'accounts',
  database: 'accounts',
  migrations: { strategy: 'generatedJob', compatibility: 'requiresExplicitMigration', apply: 'generatedJob', jobName: 'accounts-model-migration' },
} satisfies ApplicationModelStoreProvider;

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
  dryRun: { supported: true, artifact: { kind: 'typeKroResource', path: 'plans/accounts-stack.json' }, failurePolicy: 'failClosed' },
  ownership: { ownerReferences: 'required', orphanPolicy: 'retain' },
  finalizers: { required: true, finalizer: 'platform.applik8s.dev/accounts-stack', cleanupOperation: 'deleteTarget' },
  permissions: [{ apiGroups: ['platform.applik8s.dev'], resources: ['accountsstacks'], verbs: ['create', 'patch', 'delete'] }],
  diagnostics: [{ event: 'applik8s-operation-target-invalid', severity: 'error', subject: { nodeId: 'typeKroResource.accounts-stack' }, reason: 'OperationTargetNotLowerable', message: 'Operation target must lower before effects.', retryable: false }],
} satisfies ApplicationOperationTargetContract;

const operationTargetLoweringArtifacts = handlerOperationTarget.__applik8sOperationTargetArtifacts;

const watchScopeLoweringContract = {
  scope: { kind: 'labelSelector', apiVersion: 'apps/v1', resourceKind: 'Deployment', namespace: 'accounts', labels: { 'app.kubernetes.io/part-of': 'accounts' } },
  lowering: 'labelSelector',
  permissions: [{ apiGroups: ['apps'], resources: ['deployments'], verbs: ['list', 'watch'] }],
  failurePolicy: 'failClosed',
  diagnostics: [],
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

const v03PressureTestContract = {
  name: 'accounts-platform-pressure-test',
  graph: { apiVersion: 'applik8s.appGraph/v1alpha1', path: 'application-graph.json', digest: 'sha256:accounts' },
  requiredNodes: ['crd', 'model', 'server', 'job', 'provider', 'permission', 'typeKroResource'],
  requiredProviders: ['ModelStore', 'IndexStore', 'Secret', 'HttpExposure', 'CredentialStore'],
  requiredRuntimeModules: ['serverRuntime', 'modelRuntime', 'jobRunnerRuntime', 'kubernetesClient', 'diagnostics', 'providerAdapter'],
  requiredOperationTargets: [operationTargetContract],
  requiredWatchScopes: [watchScopeLoweringContract],
  requiredMigrationDriftChecks: [migrationDriftCheckContract],
  liveValidation: { contextEnv: 'APPLIK8S_E2E_CONTEXT', requiredResources: [{ apiVersion: 'batch/v1', kind: 'Job', name: 'accounts-model-migration' }], requiredAssertions: ['server becomes ready', 'job status is patched'] },
} satisfies ApplicationV03PressureTestContract;

expectTypeUsage(modelStoreGuarantees, generatedJobContract, generatedJobPhaseStatusContract, generatedJobStatusUpdaterContract, generatedRuntimeModuleContract, operationTargetContract, operationTargetLoweringArtifacts, watchScopeLoweringContract, migrationDriftCheckContract, v03PressureTestContract);

// @ts-expect-error ModelStore providers must use the typed provider object, not a string alias.
const invalidStringModelStoreProvider: ApplicationModelStoreProvider = 'postgres';

// @ts-expect-error ModelStore providers must declare the supported provider kind.
const invalidMissingKindModelStoreProvider: ApplicationModelStoreProvider = { name: 'accounts-db' };

// @ts-expect-error only the typed Postgres ModelStore provider is supported for the v0.3 substrate contract.
const invalidProviderKindModelStoreProvider: ApplicationModelStoreProvider = { kind: 'mysql', name: 'accounts-db' };

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
  accountModelForScriptExecution = accountModelBinding;
  expectTypeUsage(modelDefaults, maintenanceJob, maintenanceSchedule);

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
  const counterProvider = app.provide(CounterStore, { kind: 'counter-store-placeholder' });
  const secretProvider = app.provide(Secret, { kind: 'secret-store-placeholder' });
  expectTypeUsage(counterProvider, secretProvider);

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
imageHandlerContext.apply(ergonomicStack);
imageHandlerContext.delete(ergonomicStack);
imageHandlerContext.plan(ergonomicStack);
imageHandlerContext.apply(lightweightStack);
imageHandlerContext.delete(lightweightStack);
imageHandlerContext.plan(lightweightStack);
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
