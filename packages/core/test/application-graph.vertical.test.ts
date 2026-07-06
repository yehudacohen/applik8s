import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  applicationGraphNodeKinds,
  applicationProviderInterfaceKinds,
  isApplicationGraphNodeKind,
  isApplicationProviderInterfaceKind,
  normalizeApplicationGraph,
  resolveApplicationGraphProviderRequirement,
  serializeApplicationGraph,
  validateApplicationCrdSchemaCompatibilityContract,
  validateApplicationDurableStatusOwnershipContract,
  validateApplicationGraph,
  validateApplicationGraphCompatibilityPolicy,
  validateApplicationGraphProviderBindings,
  validateApplicationGraphStructure,
  validateApplicationJobStatusLifecycleContract,
  validateApplicationMigrationDriftCheckContract,
  validateApplicationModelStoreSemanticsContract,
  validateApplicationOperationTargetContract,
  validateApplicationProviderInterfaceContract,
  validateApplicationRuntimeModuleInterfaceContract,
  validateApplicationV03PressureTestContract,
  validateApplicationWatchScopeLoweringContract,
  type ApplicationGraph,
  type ApplicationDurableStatusOwnershipContract,
  type ApplicationGeneratedResourceContract,
  type ApplicationModelStoreGuaranteesContract,
  type ApplicationModelStoreSemanticsContract,
  type ApplicationJobRuntimeContract,
  type ApplicationJobStatusLifecycleContract,
  type ApplicationDiagnosticContract,
  type ApplicationCrdSchemaCompatibilityContract,
  type ApplicationMigrationDriftCheckContract,
  type ApplicationMigrationContract,
  type ApplicationMigrationPlanContract,
  type ApplicationModelMaterializationContract,
  type ApplicationOperationTargetContract,
  type ApplicationPhaseStatus,
  type ApplicationProviderBindingContract,
  type ApplicationProviderInterfaceKind,
  type ApplicationProviderInterfaceContract,
  type ApplicationProviderNode,
  type ApplicationProviderRequirement,
  type ApplicationRuntimeModuleContract,
  type ApplicationRuntimeModuleInterfaceContract,
  type ApplicationScheduleContract,
  type ApplicationV03PressureTestContract,
  type ApplicationWatchScopeLoweringContract,
  type GeneratedJobContract,
  type GeneratedJobDurableStatusUpdaterContract,
  type GeneratedJobPhaseStatusContract,
} from '../src/index.js';

describe('application graph substrate contract', () => {
  it('names the v0.3 substrate node and provider interfaces explicitly', () => {
    expect(applicationGraphNodeKinds).toEqual([
      'crd',
      'model',
      'server',
      'operator',
      'index',
      'aggregate',
      'counter',
      'job',
      'provider',
      'permission',
      'typeKroResource',
    ]);
    expect(applicationProviderInterfaceKinds).toEqual([
      'ModelStore',
      'IndexStore',
      'CounterStore',
      'EventSource',
      'Secret',
      'Queue',
      'ObjectStorage',
      'HttpExposure',
      'CredentialStore',
    ]);
    expect(isApplicationGraphNodeKind('job')).toBe(true);
    expect(isApplicationGraphNodeKind('workflow')).toBe(false);
    expect(isApplicationProviderInterfaceKind('ModelStore')).toBe(true);
    expect(isApplicationProviderInterfaceKind('Database')).toBe(false);
  });

  it('represents an app as graph nodes before Kubernetes or TypeKro emission', () => {
    const graph = guestBookSubstrateGraph();

    expect(graph.apiVersion).toBe('applik8s.appGraph/v1alpha1');
    expect(graph.nodes.map((node) => node.kind)).toEqual(['provider', 'model', 'job', 'server', 'permission']);
    expect(graph.edges.map((edge) => edge.relationship)).toEqual(['provides', 'dependsOn', 'dependsOn', 'writes']);
    expect(graph.compatibility.stablePublicApis).toContain('app.model');
    expect(graph.compatibility.postV3Surfaces).toContain('workload-movement-operator');
  });

  it('captures durable phase status separately from any one generated job runtime', () => {
    const status: ApplicationPhaseStatus = {
      phase: 'Migrating',
      observedGeneration: 7,
      currentStep: 'apply-schema',
      lastSuccessfulStep: 'preflight',
      idempotencyKey: 'guestbook-schema-v2',
      retryCount: 1,
      conditions: [{ type: 'Progressing', status: 'True', reason: 'StepRunning', message: 'Applying schema migration.', observedGeneration: 7 }],
    };

    expect(status.phase).toBe('Migrating');
    expect(status.conditions[0]?.type).toBe('Progressing');
  });

  it('captures durable terminal job status and partial effects as an app-level interface fixture', () => {
    const status: ApplicationPhaseStatus = {
      phase: 'Failed',
      observedGeneration: 9,
      currentStep: 'apply-constraint',
      lastSuccessfulStep: 'create-table',
      idempotencyKey: 'guestbook-schema-v3',
      retryCount: 3,
      terminalFailure: {
        reason: 'MigrationConstraintFailed',
        message: 'Unique constraint account-email-unique failed while applying migration.',
        failedStep: 'apply-constraint',
        partialEffects: [
          { operation: 'create-table', ref: { apiVersion: 'postgres.applik8s.dev/v1alpha1', kind: 'ModelTable', name: 'account' }, status: 'visible' },
          { operation: 'create-unique-index', ref: { apiVersion: 'postgres.applik8s.dev/v1alpha1', kind: 'ModelIndex', name: 'account-email-unique' }, status: 'unknown' },
        ],
      },
      conditions: [
        { type: 'Ready', status: 'False', reason: 'TerminalFailure', message: 'Migration failed.', observedGeneration: 9 },
        { type: 'Failed', status: 'True', reason: 'MigrationConstraintFailed', message: 'Unique constraint failed.', observedGeneration: 9 },
      ],
    };

    expect(status.terminalFailure?.partialEffects?.map((effect) => effect.status)).toEqual(['visible', 'unknown']);
    expect(status.conditions.map((condition) => condition.type)).toEqual(['Ready', 'Failed']);
  });

  it('exports generated job and phase-status contracts as stable public shapes', () => {
    const graph = guestBookSubstrateGraph();
    const job = graph.nodes.find((node): node is GeneratedJobContract => node.id === 'job.entry-migration' && node.kind === 'job');
    if (!job) {
      throw new Error('test fixture missing generated migration job');
    }
    const statusContract: GeneratedJobPhaseStatusContract = {
      phase: job.phase,
      idempotency: job.runtime.idempotency,
      statusTarget: job.runtime.phaseStatus,
      statusShape: {
        phase: 'Pending',
        observedGeneration: 1,
        idempotencyKey: 'guestbook-schema-v2',
        retryCount: 0,
        conditions: [{ type: 'Progressing', status: 'True', reason: 'JobCreated', message: 'Migration job created.', observedGeneration: 1 }],
      },
    };

    expect(job.runtime.idempotency).toEqual({ keySource: 'metadata.generation', conflictPolicy: 'skipCompleted' });
    expect(statusContract.statusTarget.statusPath).toBe('status.jobs.entryMigration');
    expect(statusContract.statusShape.conditions[0]?.type).toBe('Progressing');
  });

  it('records ModelStore guarantees on model schema contracts', () => {
    const graph = guestBookSubstrateGraph();
    const model = graph.nodes.find((node) => node.id === 'model.entry' && node.kind === 'model');
    if (model?.kind !== 'model') {
      throw new Error('test fixture missing model.entry');
    }
    const guarantees: ApplicationModelStoreGuaranteesContract = model.schema.guarantees ?? {
      identity: 'stableId',
      uniqueness: 'databaseConstraint',
      indexes: 'declaredSecondaryIndexes',
      transactions: 'supported',
      retention: 'retain',
      migrationOwnership: 'generatedJob',
    };

    expect(model.schema.guarantees).toEqual(guarantees);
    expect(guarantees).toEqual({
      identity: 'stableId',
      uniqueness: 'databaseConstraint',
      indexes: 'declaredSecondaryIndexes',
      transactions: 'supported',
      retention: 'retain',
      migrationOwnership: 'generatedJob',
      semantics: modelStoreSemantics(),
    });
  });

  it('defines migration compatibility policies before generated migration implementation', () => {
    const generated: ApplicationMigrationContract = {
      strategy: 'generatedJob',
      compatibility: 'requiresExplicitMigration',
    };
    const external: ApplicationMigrationContract = {
      strategy: 'external',
      compatibility: 'requiresExplicitMigration',
    };
    const schemaCompatibleOnly: ApplicationMigrationContract = {
      strategy: 'none',
      compatibility: 'schemaCompatibleOnly',
    };

    expect(generated).toMatchObject({ strategy: 'generatedJob', compatibility: 'requiresExplicitMigration' });
    expect(external.strategy).toBe('external');
    expect(schemaCompatibleOnly.compatibility).toBe('schemaCompatibleOnly');
  });

  it('defines executable migration plans, checks, history, and destructive-change policy before implementation', () => {
    const plan: ApplicationMigrationPlanContract = {
      id: 'account-schema-v2',
      model: { nodeId: 'model.account' },
      fromRevision: 'sha256:v1',
      toRevision: 'sha256:v2',
      checks: [
        {
          id: 'detect-drift',
          kind: 'schemaDrift',
          failurePolicy: 'block',
          diagnostic: diagnostic('applik8s-model-migration-failed', 'model.account', 'SchemaDriftDetected', 'Database schema drift blocks generated migration.'),
        },
        {
          id: 'reject-destructive-change',
          kind: 'destructiveChange',
          failurePolicy: 'block',
          diagnostic: diagnostic('applik8s-model-migration-failed', 'model.account', 'DestructiveChangeRejected', 'Dropping model data requires an explicit migration plan.'),
        },
      ],
      steps: [
        { id: 'create-table', kind: 'createTable', idempotent: true, sqlDigest: 'sha256:create-table', diagnostic: diagnostic('applik8s-model-migration-failed', 'model.account', 'CreateTableFailed', 'Could not create model table.') },
        { id: 'add-email-index', kind: 'addIndex', idempotent: true, sqlDigest: 'sha256:add-email-index', dependsOn: ['create-table'], diagnostic: diagnostic('applik8s-model-migration-failed', 'model.account', 'CreateIndexFailed', 'Could not create email index.') },
      ],
    };
    const migration: ApplicationMigrationContract = {
      strategy: 'generatedJob',
      compatibility: 'requiresExplicitMigration',
      compatibilityPolicy: {
        mode: 'explicitPlanRequired',
        destructiveChangePolicy: 'reject',
        driftPolicy: 'failClosed',
        dataBackfillPolicy: 'generatedJob',
      },
      plan,
      history: { tableName: 'applik8s_model_migrations', revisionColumn: 'revision', appliedAtColumn: 'applied_at' },
    };

    expect(migration.compatibilityPolicy).toMatchObject({ destructiveChangePolicy: 'reject', driftPolicy: 'failClosed' });
    expect(migration.plan?.checks.map((check) => check.kind)).toEqual(['schemaDrift', 'destructiveChange']);
    expect(migration.plan?.steps.every((step) => step.idempotent)).toBe(true);
    expect(migration.history?.tableName).toBe('applik8s_model_migrations');
  });

  it('normalizes and serializes graph contracts deterministically', () => {
    const graph = guestBookSubstrateGraph();
    const reordered: ApplicationGraph = {
      ...graph,
      nodes: [...graph.nodes].reverse(),
      edges: [...graph.edges].reverse(),
      compatibility: {
        stablePublicApis: [...graph.compatibility.stablePublicApis].reverse(),
        documentedInternalContracts: [...graph.compatibility.documentedInternalContracts].reverse(),
        experimentalSurfaces: [...graph.compatibility.experimentalSurfaces].reverse(),
        postV3Surfaces: [...graph.compatibility.postV3Surfaces].reverse(),
        labels: [...graph.compatibility.labels].reverse(),
      },
    };

    expect(normalizeApplicationGraph(reordered).nodes.map((node) => node.id)).toEqual([
      'job.entry-migration',
      'model.entry',
      'permission.web',
      'provider.model.postgres',
      'server.web',
    ]);
    expect(normalizeApplicationGraph(reordered).edges.map((edge) => `${edge.from.nodeId}:${edge.relationship}:${edge.to.nodeId}`)).toEqual([
      'job.entry-migration:dependsOn:model.entry',
      'permission.web:writes:server.web',
      'provider.model.postgres:provides:model.entry',
      'server.web:dependsOn:model.entry',
    ]);
    expect(serializeApplicationGraph(reordered)).toBe(serializeApplicationGraph(graph));
    expect(serializeApplicationGraph(graph)).toContain('"apiVersion":"applik8s.appGraph/v1alpha1"');
  });

  it('keeps provider requirements and bindings as first-class graph contracts', () => {
    const graph = guestBookSubstrateGraph();

    expect(graph.providerRequirements).toEqual([
      expect.objectContaining({ id: 'requirement.model.entry.store', interface: 'ModelStore', consumer: { nodeId: 'model.entry' } }),
    ]);
    expect(graph.providerBindings).toEqual([
      expect.objectContaining({
        requirement: 'requirement.model.entry.store',
        provider: { interface: 'ModelStore', nodeId: 'provider.model.postgres' },
        generatedResources: expect.arrayContaining([expect.objectContaining({ kind: 'Cluster', name: 'guestbook-db' })]),
      }),
    ]);
    expect(validateApplicationGraphProviderBindings(graph)).toEqual([]);
    const binding = graph.providerBindings[0];
    if (!binding) {
      throw new Error('test fixture missing provider binding');
    }
    expect(validateApplicationGraphProviderBindings({
      ...graph,
      providerBindings: [{ ...binding, requirement: 'requirement.model.missing' }],
    })).toEqual([
      expect.objectContaining({ message: 'Application provider binding requirement.model.missing references a missing provider requirement.' }),
    ]);
  });

  it('links generated artifacts, runtime metadata, RBAC, diagnostics, and provider dependencies back to graph nodes', () => {
    const generated: ApplicationGeneratedResourceContract = {
      role: 'runtimeBundle',
      graphNode: { nodeId: 'server.web' },
      artifact: { kind: 'runtimeBundle', path: 'servers/web/server.mjs', digest: 'sha256:abc' },
      metadataLinks: [
        { graphNode: { nodeId: 'server.web' }, artifact: { kind: 'routeDiagnostics', path: 'servers/web/routes.manifest.json' }, purpose: 'routeDiagnostics' },
      ],
    };
    const graph = guestBookSubstrateGraph();
    const server = graph.nodes.find((node) => node.id === 'server.web');

    expect(generated.metadataLinks?.[0]).toMatchObject({ purpose: 'routeDiagnostics', graphNode: { nodeId: 'server.web' } });
    expect(server).toMatchObject({
      kind: 'server',
      generatedResources: expect.arrayContaining([
        expect.objectContaining({ role: 'runtimeBundle', graphNode: { nodeId: 'server.web' }, artifact: expect.objectContaining({ kind: 'runtimeBundle' }) }),
        expect.objectContaining({ role: 'rbac', graphNode: { nodeId: 'server.web' }, artifact: expect.objectContaining({ kind: 'rbacManifest' }) }),
      ]),
    });
    expect(graph.providerBindings[0]?.metadataLinks).toEqual(expect.arrayContaining([
      expect.objectContaining({ purpose: 'providerDependency', graphNode: { nodeId: 'provider.model.postgres' } }),
    ]));
  });

  it('defines generated runtime module boundaries and diagnostic taxonomy before runtime extraction', () => {
    const modules: readonly ApplicationRuntimeModuleContract[] = [
      { apiVersion: 'applik8s.runtime/v1alpha1', kind: 'serverRuntime', name: 'web', artifact: { kind: 'runtimeModule', path: 'runtime/server/web.mjs' }, interface: runtimeModuleInterface([{ kind: 'modelRuntime', name: 'postgres-models' }, { kind: 'diagnostics', name: 'diagnostics' }], [{ name: 'createServerRuntime', kind: 'function', stability: 'stable' }], 'required'), entrypoint: 'createServerRuntime', exports: [{ name: 'createServerRuntime', kind: 'function', stability: 'stable' }], imports: [{ kind: 'modelRuntime', name: 'postgres-models' }, { kind: 'diagnostics', name: 'diagnostics' }] },
      { apiVersion: 'applik8s.runtime/v1alpha1', kind: 'modelRuntime', name: 'postgres-models', artifact: { kind: 'runtimeModule', path: 'runtime/model/postgres.mjs' }, interface: runtimeModuleInterface([{ kind: 'providerAdapter', name: 'postgres' }, { kind: 'diagnostics', name: 'diagnostics' }], [{ name: 'createModelRuntime', kind: 'function', stability: 'stable' }], 'required'), entrypoint: 'createModelRuntime', exports: [{ name: 'createModelRuntime', kind: 'function', stability: 'stable' }], imports: [{ kind: 'providerAdapter', name: 'postgres' }, { kind: 'diagnostics', name: 'diagnostics' }] },
      { apiVersion: 'applik8s.runtime/v1alpha1', kind: 'jobRunnerRuntime', name: 'migration-job', artifact: { kind: 'runtimeModule', path: 'runtime/jobs/migration.mjs' }, interface: runtimeModuleInterface([{ kind: 'kubernetesClient', name: 'kubernetes' }, { kind: 'diagnostics', name: 'diagnostics' }], [{ name: 'createJobStatusUpdater', kind: 'function', stability: 'stable' }], 'required'), entrypoint: 'createJobStatusUpdater', exports: [{ name: 'createJobStatusUpdater', kind: 'function', stability: 'stable' }], imports: [{ kind: 'kubernetesClient', name: 'kubernetes' }, { kind: 'diagnostics', name: 'diagnostics' }] },
      { apiVersion: 'applik8s.runtime/v1alpha1', kind: 'diagnostics', name: 'diagnostics', artifact: { kind: 'runtimeModule', path: 'runtime/diagnostics.mjs' }, interface: runtimeModuleInterface([], [{ name: 'diagnosticEvent', kind: 'function', stability: 'stable' }], 'notApplicable'), exports: [{ name: 'diagnosticEvent', kind: 'function', stability: 'stable' }] },
      { apiVersion: 'applik8s.runtime/v1alpha1', kind: 'providerAdapter', name: 'postgres', artifact: { kind: 'runtimeModule', path: 'runtime/providers/postgres.mjs' }, interface: runtimeModuleInterface([{ kind: 'diagnostics', name: 'diagnostics' }], [{ name: 'createPostgresProvider', kind: 'function', stability: 'stable' }], 'required'), exports: [{ name: 'createPostgresProvider', kind: 'function', stability: 'stable' }] },
    ];
    const duplicateKey: ApplicationDiagnosticContract = {
      event: 'applik8s-model-duplicate-key',
      severity: 'error',
      subject: { nodeId: 'model.account' },
      reason: 'UniqueConstraintViolation',
      message: 'Model Account violates unique constraint account-email-unique.',
      likelyFix: 'Change the unique field value or query the existing object before creating a duplicate.',
      retryable: false,
    };

    expect(modules.map((module) => module.kind)).toEqual(['serverRuntime', 'modelRuntime', 'jobRunnerRuntime', 'diagnostics', 'providerAdapter']);
    expect(modules[0]?.imports).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'modelRuntime' })]));
    expect(modules[2]?.entrypoint).toBe('createJobStatusUpdater');
    expect(modules[2]?.exports).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'createJobStatusUpdater', stability: 'stable' })]));
    expect(modules.flatMap((module) => module.interface ? validateApplicationRuntimeModuleInterfaceContract(module.interface) : [])).toEqual([]);
    expect(validateApplicationRuntimeModuleInterfaceContract({ apiVersion: 'applik8s.runtime/v1alpha1', imports: [], exports: [], diagnostics: 'structured', sourceMaps: 'required', failurePolicy: 'failClosed' })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application runtime module interface must declare at least one export.' }),
    ]));
    expect(duplicateKey).toMatchObject({ event: 'applik8s-model-duplicate-key', retryable: false });
  });

  it('freezes ModelStore semantic contracts for generated and script runtimes before broad implementation', () => {
    const semantics = modelStoreSemantics();

    expect(semantics).toMatchObject({ generatedRuntimeParity: 'required', scriptRuntimeParity: 'required' });
    expect(semantics.query).toEqual({ defaultLimit: 50, maxLimit: 500, cursor: 'offset', unsupportedFilters: 'failClosed' });
    expect(semantics.indexes).toMatchObject({ partitionRequired: true, uniqueEnforcedBy: 'databaseConstraint' });
    expect(semantics.constraints.duplicateKeyDiagnostic).toBe('applik8s-model-duplicate-key');
    expect(semantics.migrationHistory.tableName).toBe('applik8s_model_migrations');
    expect(semantics.retention).toEqual({ mode: 'retain', deletionPolicy: 'explicitOnly' });
    expect(validateApplicationModelStoreSemanticsContract(semantics)).toEqual([]);
    expect(validateApplicationModelStoreSemanticsContract({ ...semantics, query: { ...semantics.query, defaultLimit: 0, maxLimit: 0 }, indexes: { ...semantics.indexes, partitionRequired: false }, constraints: { ...semantics.constraints, duplicateKeyDiagnostic: 'applik8s-model-migration-missing' } })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application ModelStore query semantics require maxLimit >= defaultLimit >= 1.' }),
      expect.objectContaining({ message: 'Application ModelStore index semantics must require explicit partitions for v0.3.' }),
      expect.objectContaining({ message: 'Application ModelStore duplicate constraint semantics must use applik8s-model-duplicate-key diagnostics.' }),
    ]));
  });

  it('labels provider interfaces as implemented or fail-closed reserved for the v0.3 boundary', () => {
    const contracts: readonly ApplicationProviderInterfaceContract[] = applicationProviderInterfaceKinds.map((providerInterface) => providerInterface === 'ModelStore'
      ? { interface: providerInterface, surface: 'stablePublicApi', support: 'implemented', diagnostics: [] }
      : { interface: providerInterface, surface: 'stablePublicApi', support: 'failClosedReserved', diagnostics: [{ event: 'applik8s-provider-requirement-missing', severity: 'error', subject: { nodeId: `provider.${providerInterface}` }, reason: 'ProviderInterfaceReserved', message: `${providerInterface} is a stable v0.3 provider interface but has no generated adapter in the current slice.`, retryable: false }] });

    expect(contracts.map((contract) => `${contract.interface}:${contract.support}`)).toEqual([
      'ModelStore:implemented',
      'IndexStore:failClosedReserved',
      'CounterStore:failClosedReserved',
      'EventSource:failClosedReserved',
      'Secret:failClosedReserved',
      'Queue:failClosedReserved',
      'ObjectStorage:failClosedReserved',
      'HttpExposure:failClosedReserved',
      'CredentialStore:failClosedReserved',
    ]);
    expect(contracts.flatMap(validateApplicationProviderInterfaceContract)).toEqual([]);
    expect(validateApplicationProviderInterfaceContract({ interface: 'Queue', surface: 'stablePublicApi', support: 'failClosedReserved', diagnostics: [] })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application provider interface Queue is stable but fail-closed reserved without diagnostics.' }),
      expect.objectContaining({ message: 'Application provider interface Queue fail-closed reservation must use provider requirement diagnostics.' }),
    ]));
  });

  it('defines provider requirement contracts for every v0.3 capability interface', () => {
    const purposes: Record<ApplicationProviderInterfaceKind, ApplicationProviderRequirement['purpose']> = {
      ModelStore: 'modelStore',
      IndexStore: 'indexStore',
      CounterStore: 'counterStore',
      EventSource: 'eventSource',
      Secret: 'secret',
      Queue: 'queue',
      ObjectStorage: 'objectStorage',
      HttpExposure: 'httpExposure',
      CredentialStore: 'credentialStore',
    };
    const requirements = applicationProviderInterfaceKinds.map((providerInterface) => ({
      id: `requirement.${providerInterface}`,
      interface: providerInterface,
      consumer: { nodeId: 'server.web' },
      required: true,
      purpose: purposes[providerInterface],
      diagnostics: {
        missing: `${providerInterface} provider is required.`,
        ambiguous: `${providerInterface} provider is ambiguous.`,
      },
    }) satisfies ApplicationProviderRequirement);

    expect(requirements.map((requirement) => requirement.purpose)).toEqual(['modelStore', 'indexStore', 'counterStore', 'eventSource', 'secret', 'queue', 'objectStorage', 'httpExposure', 'credentialStore']);
    for (const requirement of requirements) {
      expect(requirement.diagnostics.missing).toContain(requirement.interface);
    }
  });

  it('freezes generalized generated job graph contracts for scheduling, retry, permissions, diagnostics, resources, and status targets', () => {
    const scheduledJob: GeneratedJobContract = {
      id: 'job.compact-accounts-hourly',
      kind: 'job',
      name: 'compact-accounts-hourly',
      stability: 'stable',
      task: { taskKind: 'maintenance', image: 'postgres:16-alpine', command: ['sh', '-ec'], args: ['psql "$DATABASE_URL" -c "vacuum analyze"'] },
      schedule: { cron: '0 * * * *', timezone: 'UTC', concurrencyPolicy: 'forbid', missedRunPolicy: 'failClosed', startingDeadlineSeconds: 300 },
      phase: { initialPhase: 'Pending', terminalPhases: ['Complete', 'Failed'], conditions: ['Blocked', 'Progressing', 'Ready', 'Finalized', 'Failed'] },
      resources: [{ apiVersion: 'batch/v1', kind: 'CronJob', name: 'compact-accounts-hourly' }],
      retry: { mode: 'boundedExponentialBackoff', maxAttempts: 4, initialDelayMs: 1000, maxDelayMs: 30000 },
      runtime: {
        materialization: 'kubernetes-cronjob',
        idempotency: { keySource: 'metadata.generation', conflictPolicy: 'skipCompleted' },
        phaseStatus: { resource: { apiVersion: 'platform.applik8s.dev/v1alpha1', kind: 'AccountsPlatform' }, statusPath: 'status.applik8s.jobs.compactAccountsHourly' },
        statusLifecycle: jobStatusLifecycle('job.compact-accounts-hourly', 'accounts-platform-status-reconciler-status', 'latestRunAndHistory'),
        permissions: [
          { apiGroups: ['batch'], resources: ['cronjobs'], verbs: ['create', 'get', 'list', 'watch', 'patch'] },
          { apiGroups: [''], resources: ['secrets'], verbs: ['get'], resourceNames: ['accounts-db-app'] },
        ],
        environment: { secretRefs: [{ apiVersion: 'v1', kind: 'Secret', name: 'accounts-db-app' }] },
        metadataLinks: [{ graphNode: { nodeId: 'job.compact-accounts-hourly' }, artifact: { kind: 'jobDiagnostics', path: 'jobs/compact-accounts-hourly/diagnostics.json' }, purpose: 'jobDiagnostics' }],
      },
      generatedResources: [
        { role: 'workload', graphNode: { nodeId: 'job.compact-accounts-hourly' }, resource: { apiVersion: 'batch/v1', kind: 'CronJob', name: 'compact-accounts-hourly' }, artifact: { kind: 'kubernetesManifest', path: 'jobs/compact-accounts-hourly.yaml' } },
        { role: 'jobDiagnostics', graphNode: { nodeId: 'job.compact-accounts-hourly' }, artifact: { kind: 'jobDiagnostics', path: 'jobs/compact-accounts-hourly/diagnostics.json' }, metadataLinks: [{ graphNode: { nodeId: 'job.compact-accounts-hourly' }, artifact: { kind: 'jobDiagnostics', path: 'jobs/compact-accounts-hourly/diagnostics.json' }, purpose: 'jobDiagnostics' }] },
      ],
    };
    const statusContract: GeneratedJobPhaseStatusContract = {
      phase: scheduledJob.phase,
      idempotency: scheduledJob.runtime.idempotency,
      statusTarget: scheduledJob.runtime.phaseStatus,
      statusShape: {
        phase: 'Blocked',
        observedGeneration: 12,
        currentStep: 'provider-readiness',
        lastSuccessfulStep: 'render-cronjob',
        idempotencyKey: 'compact-accounts-hourly-generation-12',
        retryCount: 2,
        terminalFailure: { reason: 'ProviderUnavailable', message: 'Postgres credentials are not readable.', failedStep: 'provider-readiness', partialEffects: [{ operation: 'create-cronjob', ref: { apiVersion: 'batch/v1', kind: 'CronJob', name: 'compact-accounts-hourly' }, status: 'visible' }] },
        conditions: [
          { type: 'Blocked', status: 'True', reason: 'ProviderUnavailable', message: 'Waiting for database credentials.', observedGeneration: 12 },
          { type: 'Ready', status: 'False', reason: 'Blocked', message: 'Job cannot run yet.', observedGeneration: 12 },
        ],
      },
    };
    const statusUpdater: GeneratedJobDurableStatusUpdaterContract = {
      runtimeModule: { kind: 'jobRunnerRuntime', name: 'generated-job-status-updater' },
      observes: [{ apiVersion: 'batch/v1', kind: 'CronJob', name: 'compact-accounts-hourly' }],
      writes: scheduledJob.runtime.phaseStatus,
      statusOwnership: {
        primary: 'applicationStatus',
        fallback: 'generatedStatusConfigMap',
        appStatusSchema: 'bestEffort',
        durableStore: { apiVersion: 'v1', kind: 'ConfigMap', name: 'accounts-platform-status-reconciler-status' },
        conflictPolicy: 'mergePatch',
        diagnostics: [{ event: 'applik8s-status-schema-pruned', severity: 'warning', subject: { nodeId: 'job.compact-accounts-hourly' }, reason: 'ApplicationStatusSchemaMayPruneCustomFields', message: 'Persist generated status in a ConfigMap when app CRD status pruning prevents status.applik8s from being durable.', retryable: false }],
      },
      statusShape: statusContract.statusShape,
      failurePolicy: 'failClosed',
      idempotency: scheduledJob.runtime.idempotency,
      diagnostics: [{ event: 'applik8s-job-terminal-failure', severity: 'error', subject: { nodeId: 'job.compact-accounts-hourly' }, reason: 'GeneratedJobFailed', message: 'Generated job reached a terminal failure.', retryable: true }],
    };

    expect(scheduledJob.schedule).toMatchObject({ cron: '0 * * * *', concurrencyPolicy: 'forbid', missedRunPolicy: 'failClosed' });
    expect(scheduledJob.retry).toMatchObject({ mode: 'boundedExponentialBackoff', maxAttempts: 4 });
    expect(scheduledJob.runtime.phaseStatus.statusPath).toBe('status.applik8s.jobs.compactAccountsHourly');
    expect(scheduledJob.runtime.statusLifecycle?.multiJob).toBe('appLevelReconciler');
    expect(scheduledJob.runtime.statusLifecycle?.cronJob).toBe('latestRunAndHistory');
    expect(scheduledJob.runtime.statusLifecycle ? validateApplicationJobStatusLifecycleContract(scheduledJob.runtime.statusLifecycle) : []).toEqual([]);
    expect(scheduledJob.runtime.permissions).toEqual(expect.arrayContaining([expect.objectContaining({ resources: ['cronjobs'] })]));
    expect(scheduledJob.generatedResources).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'jobDiagnostics' })]));
    expect(statusContract.statusShape.terminalFailure?.partialEffects?.[0]?.status).toBe('visible');
    expect(statusUpdater.runtimeModule).toEqual({ kind: 'jobRunnerRuntime', name: 'generated-job-status-updater' });
    expect(statusUpdater.writes.statusPath).toBe('status.applik8s.jobs.compactAccountsHourly');
    expect(statusUpdater.statusOwnership?.fallback).toBe('generatedStatusConfigMap');
    if (!statusUpdater.statusOwnership) {
      throw new Error('expected status ownership contract');
    }
    expect(validateApplicationDurableStatusOwnershipContract(statusUpdater.statusOwnership)).toEqual([]);
  });

  it('validates durable status ownership so app-status pruning has an explicit fallback contract', () => {
    const ownership: ApplicationDurableStatusOwnershipContract = {
      primary: 'applicationStatus',
      fallback: 'generatedStatusConfigMap',
      appStatusSchema: 'bestEffort',
      durableStore: { apiVersion: 'v1', kind: 'ConfigMap', name: 'accounts-status-reconciler-status' },
      conflictPolicy: 'mergePatch',
      diagnostics: [{ event: 'applik8s-status-schema-pruned', severity: 'warning', subject: { nodeId: 'job.accounts-model-migration' }, reason: 'ApplicationStatusSchemaMayPruneCustomFields', message: 'KRO-generated app CRDs may prune status.applik8s; use the generated status ConfigMap as durable storage.', retryable: false }],
    };

    expect(validateApplicationDurableStatusOwnershipContract(ownership)).toEqual([]);
    const { fallback: _fallback, ...withoutFallback } = ownership;
    expect(validateApplicationDurableStatusOwnershipContract(withoutFallback)).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application durable status ownership with bestEffort app status must declare generatedStatusConfigMap fallback.' }),
    ]));
    const { durableStore: _durableStore, ...withoutDurableStore } = ownership;
    expect(validateApplicationDurableStatusOwnershipContract({ ...withoutDurableStore, primary: 'generatedStatusConfigMap' })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application durable status ownership using a generatedStatusConfigMap primary must declare durableStore.' }),
    ]));
  });

  it('labels compatibility surfaces explicitly for the v0.3 freeze boundary', () => {
    const graph = guestBookSubstrateGraph();

    expect(graph.compatibility.labels).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'app.model', surface: 'stablePublicApi', since: 'v0.3' }),
      expect.objectContaining({ name: 'ApplicationGraph', surface: 'documentedInternalContract', since: 'v0.3' }),
      expect.objectContaining({ name: 'provider.postgres', surface: 'stablePublicApi', since: 'v0.3' }),
      expect.objectContaining({ name: 'workload-movement-operator', surface: 'postV3Surface' }),
    ]));
  });

  it('rejects stable public API compatibility policy drift', () => {
    const graph = guestBookSubstrateGraph();
    const completeGraph: ApplicationGraph = {
      ...graph,
      compatibility: {
        ...graph.compatibility,
        labels: [
          ...graph.compatibility.labels,
          { name: 'app', surface: 'stablePublicApi', since: 'v0.3', rationale: 'Application authoring context implementation.' },
          { name: 'app.crd', surface: 'stablePublicApi', since: 'v0.3', rationale: 'CRD materialization implementation.' },
          { name: 'app.job', surface: 'stablePublicApi', since: 'v0.3', rationale: 'Generated Kubernetes Job implementation.' },
          { name: 'app.schedule', surface: 'stablePublicApi', since: 'v0.3', rationale: 'Generated Kubernetes CronJob implementation.' },
          { name: 'app.defaults', surface: 'stablePublicApi', since: 'v0.3', rationale: 'Provider defaults fail-closed when unsupported provider interfaces are requested.' },
          { name: 'app.provide', surface: 'stablePublicApi', since: 'v0.3', rationale: 'Provider binding fails closed when unsupported provider interfaces are requested.' },
          { name: 'provider.ModelStore', surface: 'stablePublicApi', since: 'v0.3', rationale: 'ModelStore provider interface implemented by the Postgres provider slice.' },
        ],
      },
    };
    expect(validateApplicationGraphCompatibilityPolicy(completeGraph)).toEqual([]);

    const unlabeled: ApplicationGraph = { ...completeGraph, compatibility: { ...completeGraph.compatibility, stablePublicApis: [...completeGraph.compatibility.stablePublicApis, 'provider.Secret'] } };
    expect(validateApplicationGraphCompatibilityPolicy(unlabeled)).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application graph stable public API provider.Secret must have a stablePublicApi compatibility label.' }),
    ]));

    const missingFailClosed: ApplicationGraph = {
      ...completeGraph,
      compatibility: {
        ...completeGraph.compatibility,
        stablePublicApis: [...completeGraph.compatibility.stablePublicApis, 'provider.Queue'],
        labels: [...completeGraph.compatibility.labels, { name: 'provider.Queue', surface: 'stablePublicApi', since: 'v0.3', rationale: 'Reserved provider API not implemented yet.' }],
      },
    };
    expect(validateApplicationGraphCompatibilityPolicy(missingFailClosed)).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application graph stable public API provider.Queue describes missing implementation without documented fail-closed behavior.' }),
    ]));
  });

  it('freezes v0.3 CRD schema compatibility fixtures without conversion webhook promises', () => {
    const compatibility: ApplicationCrdSchemaCompatibilityContract = {
      resource: { apiVersion: 'platform.applik8s.dev/v1alpha1', kind: 'Tenant', plural: 'tenants', scope: 'Namespaced' },
      currentVersion: 'v1alpha1',
      nextVersion: 'v1alpha1',
      policy: {
        mode: 'additiveOnly',
        conversionWebhook: 'postV3Required',
        storedVersionMigration: 'postV3Required',
        unknownFieldPolicy: 'rejectNewUnknownFields',
        failurePolicy: 'failClosed',
      },
      allowedChanges: ['addOptionalField', 'widenType', 'addEnumValue'],
      rejectedChanges: ['addRequiredField', 'removeField', 'renameField', 'narrowType', 'removeEnumValue'],
      postV3Requirements: ['conversionWebhook', 'storedVersionMigration', 'multiVersionStorage'],
      diagnostics: [{ event: 'applik8s-crd-schema-incompatible', severity: 'error', subject: { apiVersion: 'platform.applik8s.dev/v1alpha1', kind: 'Tenant' }, reason: 'CrdSchemaCompatibilityViolation', message: 'v0.3 domain CRD schema changes must be additive unless an explicit compatibility authority is declared.', retryable: false }],
    };

    expect(validateApplicationCrdSchemaCompatibilityContract(compatibility)).toEqual([]);
    expect(validateApplicationCrdSchemaCompatibilityContract({ ...compatibility, allowedChanges: [...compatibility.allowedChanges, 'removeField'], diagnostics: [], postV3Requirements: ['multiVersionStorage'] })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application CRD schema compatibility for Tenant additiveOnly policy must not allow removeField.' }),
      expect.objectContaining({ message: 'Application CRD schema compatibility for Tenant defers conversion webhooks but does not list conversionWebhook as a post-v0.3 requirement.' }),
      expect.objectContaining({ message: 'Application CRD schema compatibility for Tenant defers stored-version migration but does not list storedVersionMigration as a post-v0.3 requirement.' }),
      expect.objectContaining({ message: 'Application CRD schema compatibility for Tenant fails closed but has no diagnostic.' }),
    ]));
  });

  it('freezes operation-target contracts for apply/delete planning before workload movement depends on them', () => {
    const target: ApplicationOperationTargetContract = {
      id: 'operation-target.tenant-stack',
      target: { nodeId: 'typeKroResource.tenant-stack' },
      operations: ['apply', 'delete', 'status'],
      execution: { contexts: ['handler', 'generatedJob', 'generatedServer', 'typeKro'], ordering: 'dependencyAware', runtimeValidation: 'beforeEffects', failurePolicy: 'failClosed' },
      lowering: { mode: 'typeKroResource', artifact: { kind: 'typeKroResource', path: 'plans/tenant-stack.apply.json' }, failurePolicy: 'failClosed' },
      dryRun: { supported: true, artifact: { kind: 'typeKroResource', path: 'plans/tenant-stack.dry-run.json' }, failurePolicy: 'failClosed' },
      ownership: { ownerReferences: 'required', orphanPolicy: 'retain' },
      finalizers: { required: true, finalizer: 'platform.applik8s.dev/tenant-stack', cleanupOperation: 'deleteTarget' },
      permissions: [
        { apiGroups: ['kro.run'], resources: ['resourcegraphdefinitions'], verbs: ['get', 'list', 'watch'] },
        { apiGroups: ['platform.applik8s.dev'], resources: ['tenantstacks'], verbs: ['create', 'patch', 'delete'] },
      ],
      diagnostics: [{ event: 'applik8s-operation-target-invalid', severity: 'error', subject: { nodeId: 'typeKroResource.tenant-stack' }, reason: 'OperationTargetNotLowerable', message: 'TypeKro operation target must lower to an explicit plan before effects.', likelyFix: 'Use a concrete TypeKro resource or provide an explicit operation target adapter.', retryable: false }],
    };

    expect(target.dryRun.failurePolicy).toBe('failClosed');
    expect(target.ownership.ownerReferences).toBe('required');
    expect(target.finalizers.cleanupOperation).toBe('deleteTarget');
    expect(target.permissions).toEqual(expect.arrayContaining([expect.objectContaining({ verbs: expect.arrayContaining(['delete']) })]));
    expect(target.execution).toEqual(expect.objectContaining({ contexts: expect.arrayContaining(['generatedJob', 'generatedServer']), runtimeValidation: 'beforeEffects' }));
    expect(target.lowering?.artifact?.path).toBe('plans/tenant-stack.apply.json');
    expect(target.dryRun.artifact?.path).toBe('plans/tenant-stack.dry-run.json');
    expect(target.permissions.flatMap((rule) => rule.verbs)).toEqual(expect.arrayContaining(['create', 'patch', 'delete']));
    expect(validateApplicationOperationTargetContract(target)).toEqual([]);
    expect(validateApplicationOperationTargetContract({ ...target, operations: [], permissions: [], diagnostics: [], dryRun: { supported: true, failurePolicy: 'failClosed' }, ownership: { ownerReferences: 'required', orphanPolicy: 'delete' }, finalizers: { required: true, cleanupOperation: 'deleteTarget' } })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application operation target operation-target.tenant-stack must declare at least one operation.' }),
      expect.objectContaining({ message: 'Application operation target operation-target.tenant-stack supports dry-run but does not declare a dry-run artifact.' }),
      expect.objectContaining({ message: 'Application operation target operation-target.tenant-stack cannot require ownerReferences while deleting orphans implicitly.' }),
      expect.objectContaining({ message: 'Application operation target operation-target.tenant-stack requires a finalizer but does not name one.' }),
      expect.objectContaining({ message: 'Application operation target operation-target.tenant-stack must declare permissions or a fail-closed diagnostic.' }),
    ]));
  });

  it('freezes watch-scope lowering contracts for exact, finite, selector, field-selector, and mixed scopes', () => {
    const watchScopes: readonly ApplicationWatchScopeLoweringContract[] = [
      { scope: { kind: 'exact', ref: { apiVersion: 'apps/v1', kind: 'Deployment', name: 'web', namespace: 'source' } }, lowering: 'exact', runtime: { mode: 'directWatch', resyncPolicy: 'none', cancellation: 'onShutdown' }, permissions: [{ apiGroups: ['apps'], resources: ['deployments'], verbs: ['get', 'watch'] }], failurePolicy: 'failClosed', diagnostics: [] },
      { scope: { kind: 'finite', refs: [{ apiVersion: 'v1', kind: 'Service', name: 'web', namespace: 'source' }] }, lowering: 'finite', runtime: { mode: 'sharedInformer', resyncPolicy: 'bounded', cancellation: 'onShutdown' }, permissions: [{ apiGroups: [''], resources: ['services'], verbs: ['get', 'watch'] }], failurePolicy: 'failClosed', diagnostics: [] },
      { scope: { kind: 'labelSelector', apiVersion: 'apps/v1', resourceKind: 'Deployment', namespace: 'source', labels: { 'app.kubernetes.io/part-of': 'tenant-a' } }, lowering: 'labelSelector', runtime: { mode: 'sharedInformer', resyncPolicy: 'bounded', cancellation: 'onScopeRemoved' }, permissions: [{ apiGroups: ['apps'], resources: ['deployments'], verbs: ['list', 'watch'] }], failurePolicy: 'failClosed', diagnostics: [] },
      { scope: { kind: 'fieldSelector', apiVersion: 'v1', resourceKind: 'Pod', namespace: 'source', fieldSelector: 'spec.nodeName=node-a' }, lowering: 'fieldSelector', runtime: { mode: 'sharedInformer', resyncPolicy: 'bounded', cancellation: 'onScopeRemoved' }, permissions: [{ apiGroups: [''], resources: ['pods'], verbs: ['list', 'watch'] }], failurePolicy: 'failClosed', diagnostics: [] },
      { scope: { kind: 'mixed', scopes: [{ kind: 'exact', ref: { apiVersion: 'v1', kind: 'ConfigMap', name: 'settings', namespace: 'source' } }, { kind: 'labelSelector', apiVersion: 'apps/v1', resourceKind: 'Deployment', namespace: 'source', labels: { tier: 'frontend' } }] }, lowering: 'mixed', runtime: { mode: 'sharedInformer', resyncPolicy: 'bounded', cancellation: 'onScopeRemoved' }, permissions: [{ apiGroups: [''], resources: ['configmaps'], verbs: ['get', 'watch'] }, { apiGroups: ['apps'], resources: ['deployments'], verbs: ['list', 'watch'] }], failurePolicy: 'failClosed', diagnostics: [] },
    ];
    const unlowerable: ApplicationWatchScopeLoweringContract = {
      scope: { kind: 'labelSelector', apiVersion: 'apps/v1', resourceKind: 'Deployment', labels: {} },
      lowering: 'labelSelector',
      permissions: [],
      failurePolicy: 'failClosed',
      diagnostics: [{ event: 'applik8s-watch-scope-unlowerable', severity: 'error', subject: { apiVersion: 'apps/v1', kind: 'Deployment' }, reason: 'EmptySelectorRejected', message: 'Watch scope selectors must be explicit before runtime emission.', likelyFix: 'Provide exact refs, a finite set, labels, or a field selector.', retryable: false }],
    };

    expect(watchScopes.map((scope) => scope.lowering)).toEqual(['exact', 'finite', 'labelSelector', 'fieldSelector', 'mixed']);
    expect(watchScopes.every((scope) => scope.failurePolicy === 'failClosed')).toBe(true);
    expect(watchScopes.flatMap(validateApplicationWatchScopeLoweringContract)).toEqual([]);
    expect(unlowerable.diagnostics[0]?.event).toBe('applik8s-watch-scope-unlowerable');
    expect(validateApplicationWatchScopeLoweringContract(unlowerable)).toEqual([]);
    expect(validateApplicationWatchScopeLoweringContract({ ...unlowerable, diagnostics: [], permissions: [] })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application watch scope labelSelector must declare permissions or a fail-closed diagnostic.' }),
      expect.objectContaining({ message: 'Application label-selector watch scope must not use an empty selector.' }),
    ]));
  });

  it('freezes migration drift-check contracts before implementing live schema enforcement', () => {
    const driftCheck: ApplicationMigrationDriftCheckContract = {
      model: { nodeId: 'model.account' },
      provider: { interface: 'ModelStore', nodeId: 'provider.model-store' },
      observedSchemaSource: { apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster', name: 'accounts-db' },
      expectedRevision: 'sha256:accounts-schema-v1',
      policy: { mode: 'explicitPlanRequired', destructiveChangePolicy: 'reject', driftPolicy: 'failClosed', dataBackfillPolicy: 'generatedJob' },
      enforcement: { stage: 'preMigration', historyTable: 'applik8s_model_migrations', lock: 'providerNative', failurePolicy: 'failClosed' },
      failureModes: ['missingHistoryTable', 'incompatibleColumn', 'incompatibleIndex', 'destructiveChange', 'unknownExistingObject'],
      diagnostics: [{ event: 'applik8s-model-migration-drift-detected', severity: 'error', subject: { nodeId: 'model.account' }, reason: 'SchemaDriftDetected', message: 'Existing database schema does not match the generated migration plan.', likelyFix: 'Repair schema drift or provide an explicit migration plan.', retryable: false }],
    };

    expect(driftCheck.policy.driftPolicy).toBe('failClosed');
    expect(driftCheck.failureModes).toContain('destructiveChange');
    expect(driftCheck.diagnostics[0]?.event).toBe('applik8s-model-migration-drift-detected');
    expect(validateApplicationMigrationDriftCheckContract(driftCheck)).toEqual([]);
    expect(validateApplicationMigrationDriftCheckContract({ ...driftCheck, expectedRevision: '', failureModes: ['incompatibleIndex'], diagnostics: [] })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application migration drift check for model.account must declare an expected revision.' }),
      expect.objectContaining({ message: 'Application migration drift check for model.account fails closed but has no diagnostic.' }),
      expect.objectContaining({ message: 'Application migration drift check for model.account rejects destructive changes but does not list destructiveChange as a failure mode.' }),
    ]));
  });

  it('defines the v0.3 pressure-test contract from a concrete app graph fixture', () => {
    const graph = guestBookSubstrateGraph();
    const graphDigest = `sha256:${createHash('sha256').update(serializeApplicationGraph(graph)).digest('hex')}`;
    const graphNodeKinds = [...new Set(graph.nodes.map((node) => node.kind))];
    const pressureTest: ApplicationV03PressureTestContract = {
      name: 'tenant-platform-pressure-test',
      graph: { apiVersion: graph.apiVersion, path: 'application-graph.json', digest: graphDigest },
      requiredNodes: graphNodeKinds,
      requiredProviders: ['ModelStore', 'IndexStore', 'Secret', 'HttpExposure', 'CredentialStore'],
      requiredRuntimeModules: ['serverRuntime', 'modelRuntime', 'jobRunnerRuntime', 'kubernetesClient', 'diagnostics', 'providerAdapter'],
      requiredOperationTargets: [{ id: 'operation-target.tenant-stack', target: { nodeId: 'typeKroResource.tenant-stack' }, operations: ['apply', 'delete'], execution: { contexts: ['handler', 'generatedJob', 'generatedServer', 'typeKro'], ordering: 'dependencyAware', runtimeValidation: 'beforeEffects', failurePolicy: 'failClosed' }, lowering: { mode: 'typeKroResource', artifact: { kind: 'typeKroResource', path: 'plans/tenant-stack.apply.json' }, failurePolicy: 'failClosed' }, dryRun: { supported: true, artifact: { kind: 'typeKroResource', path: 'plans/tenant-stack.dry-run.json' }, failurePolicy: 'failClosed' }, ownership: { ownerReferences: 'required', orphanPolicy: 'retain' }, finalizers: { required: true, finalizer: 'platform.applik8s.dev/tenant-stack', cleanupOperation: 'deleteTarget' }, permissions: [{ apiGroups: ['platform.applik8s.dev'], resources: ['tenantstacks'], verbs: ['create', 'patch', 'delete'] }], diagnostics: [] }],
      requiredWatchScopes: [{ scope: { kind: 'labelSelector', apiVersion: 'apps/v1', resourceKind: 'Deployment', labels: { 'tenant.applik8s.dev/name': 'tenant-a' } }, lowering: 'labelSelector', runtime: { mode: 'sharedInformer', resyncPolicy: 'bounded', cancellation: 'onScopeRemoved' }, permissions: [{ apiGroups: ['apps'], resources: ['deployments'], verbs: ['list', 'watch'] }], failurePolicy: 'failClosed', diagnostics: [] }],
      requiredMigrationDriftChecks: [{ model: { nodeId: 'model.account' }, provider: { interface: 'ModelStore', nodeId: 'provider.model-store' }, observedSchemaSource: { apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster', name: 'accounts-db' }, expectedRevision: 'sha256:accounts-schema-v1', policy: { mode: 'explicitPlanRequired', destructiveChangePolicy: 'reject', driftPolicy: 'failClosed' }, enforcement: { stage: 'preMigration', historyTable: 'applik8s_model_migrations', lock: 'providerNative', failurePolicy: 'failClosed' }, failureModes: ['incompatibleIndex', 'destructiveChange'], diagnostics: [{ event: 'applik8s-model-migration-drift-detected', severity: 'error', subject: { nodeId: 'model.account' }, reason: 'SchemaDriftDetected', message: 'Schema drift blocks migration.', retryable: false }] }],
      requiredModelStoreSemantics: [modelStoreSemantics()],
      requiredRuntimeModuleInterfaces: [runtimeModuleInterface([{ kind: 'modelRuntime', name: 'postgres-models' }, { kind: 'diagnostics', name: 'diagnostics' }], [{ name: 'createServerRuntime', kind: 'function', stability: 'stable' }], 'required')],
      requiredProviderInterfaces: [{ interface: 'ModelStore', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] }, { interface: 'IndexStore', surface: 'stablePublicApi', support: 'failClosedReserved', diagnostics: [{ event: 'applik8s-provider-requirement-missing', severity: 'error', subject: { nodeId: 'provider.IndexStore' }, reason: 'ProviderInterfaceReserved', message: 'IndexStore is stable but fail-closed until the generated adapter lands.', retryable: false }] }],
      requiredStatusOwnership: [{ primary: 'applicationStatus', fallback: 'generatedStatusConfigMap', appStatusSchema: 'bestEffort', durableStore: { apiVersion: 'v1', kind: 'ConfigMap', name: 'tenant-platform-pressure-test-status-reconciler-status' }, conflictPolicy: 'mergePatch', diagnostics: [{ event: 'applik8s-status-schema-pruned', severity: 'warning', subject: { nodeId: 'job.accounts-model-migration' }, reason: 'ApplicationStatusSchemaMayPruneCustomFields', message: 'Durable job status falls back to ConfigMap when app status pruning applies.', retryable: false }] }],
      liveValidation: { contextEnv: 'APPLIK8S_E2E_CONTEXT', requiredResources: [{ apiVersion: 'batch/v1', kind: 'Job', name: 'accounts-model-migration' }], requiredAssertions: ['migration job completes', 'server becomes ready', 'duplicate key returns 409', 'job status is patched'] },
    };

    expect(pressureTest.graph.digest).toBe(graphDigest);
    expect(pressureTest.requiredNodes).toEqual(expect.arrayContaining(['model', 'server', 'job', 'provider']));
    expect(pressureTest.requiredRuntimeModules).toContain('jobRunnerRuntime');
    expect(pressureTest.liveValidation?.requiredAssertions).toContain('job status is patched');
    expect(validateApplicationV03PressureTestContract(pressureTest)).toEqual([]);
    expect(validateApplicationV03PressureTestContract({ ...pressureTest, graph: { ...pressureTest.graph, digest: '' }, requiredRuntimeModules: ['serverRuntime'], requiredProviders: ['ModelStore'] })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application v0.3 pressure test tenant-platform-pressure-test must reference an emitted application graph artifact path and digest.' }),
      expect.objectContaining({ message: 'Application v0.3 pressure test tenant-platform-pressure-test must require CredentialStore.' }),
      expect.objectContaining({ message: 'Application v0.3 pressure test tenant-platform-pressure-test must require modelRuntime.' }),
    ]));
  });

  it('defines provider requirement and binding contracts before provider implementation', () => {
    const requirement: ApplicationProviderRequirement<'ModelStore'> = {
      id: 'requirement.model.entry.store',
      interface: 'ModelStore',
      consumer: { nodeId: 'model.entry' },
      required: true,
      purpose: 'modelStore',
      diagnostics: {
        missing: 'Model GuestBookEntry requires a ModelStore provider. Bind one with app.provide(ModelStore, ...) or app.defaults({ models: ... }).',
        ambiguous: 'Model GuestBookEntry has multiple ModelStore providers. Bind the model to one provider explicitly.',
      },
    };
    const binding: ApplicationProviderBindingContract<'ModelStore'> = {
      requirement: requirement.id,
      provider: { interface: 'ModelStore', nodeId: 'provider.model.postgres' },
      generatedResources: [{ apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster', name: 'guestbook-db' }],
      runtime: {
        env: { APPLIK8S_MODEL_PROVIDER: 'postgres' },
        secretRefs: [{ apiVersion: 'v1', kind: 'Secret', name: 'guestbook-db-app' }],
        permissions: [{ apiGroups: [''], resources: ['secrets'], verbs: ['get'], resourceNames: ['guestbook-db-app'] }],
      },
    };

    expect(requirement.interface).toBe('ModelStore');
    expect(requirement.diagnostics.missing).toContain('app.provide(ModelStore');
    expect(binding.generatedResources[0]).toMatchObject({ kind: 'Cluster', name: 'guestbook-db' });
    expect(binding.runtime.permissions?.[0]?.resources).toEqual(['secrets']);
  });

  it('validates provider bindings from the graph contract before lowering', () => {
    const graph = guestBookSubstrateGraph();
    expect(validateApplicationGraphProviderBindings(graph)).toEqual([]);

    const missingProvider: ApplicationGraph = {
      ...graph,
      nodes: graph.nodes.filter((node) => node.id !== 'provider.model.postgres'),
    };
    expect(validateApplicationGraphProviderBindings(missingProvider)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'error',
        code: 'COMPATIBILITY_FAILED',
        message: expect.stringContaining('requires ModelStore provider provider.model.postgres'),
      }),
    ]));

    const mismatchedProvider: ApplicationGraph = {
      ...graph,
      nodes: graph.nodes.map((node) => node.id === 'provider.model.postgres' ? { ...node, interface: 'IndexStore' } : node),
    };
    expect(validateApplicationGraphProviderBindings(mismatchedProvider)).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.stringContaining('but the provider node implements IndexStore') }),
    ]));
  });

  it('validates structural graph invariants before lowering', () => {
    const graph = guestBookSubstrateGraph();
    const entryModel = graph.nodes.find((node) => node.id === 'model.entry');
    if (!entryModel) {
      throw new Error('test fixture missing model.entry');
    }
    const malformed: ApplicationGraph = {
      ...graph,
      nodes: [
        ...graph.nodes,
        { ...entryModel, name: 'DuplicateGuestBookEntry' },
        {
          id: 'model.ttl-entry',
          kind: 'model',
          name: 'TtlEntry',
          stability: 'experimental',
          entity: { name: 'TtlEntry' },
          store: { interface: 'ModelStore', nodeId: 'provider.model.postgres' },
          schema: {
            identity: ['id'],
            constraints: [],
            indexes: [],
            migrations: { strategy: 'generatedJob', compatibility: 'requiresExplicitMigration' },
            transactions: 'supported',
            retention: { mode: 'ttl' },
          },
          materialization: {
            mode: 'providerBacked',
            provider: { interface: 'ModelStore', nodeId: 'provider.model.postgres-replica' },
            backingResources: [],
            connection: {},
            runtimeBoundary: { serializedCallbacks: 'generatedRuntimeClient', scriptExecution: 'scriptRuntimeClient' },
            reconciliation: { ownership: 'application', schemaDrift: 'failClosed', deletionPolicy: 'retain' },
          },
        },
        {
          id: 'job.bad-retry',
          kind: 'job',
          name: 'bad-retry',
          stability: 'experimental',
          task: { taskKind: 'migration' },
          phase: { initialPhase: 'Failed', terminalPhases: ['Failed'], conditions: ['Failed'] },
          resources: [],
          retry: { mode: 'boundedExponentialBackoff', maxAttempts: 0, initialDelayMs: 5000, maxDelayMs: 1000 },
          runtime: {
            materialization: 'kubernetes-job',
            idempotency: { keySource: 'explicit', conflictPolicy: 'failClosed' },
            phaseStatus: { resource: { apiVersion: 'guestbook.applik8s.dev/v1alpha1', kind: 'GuestBook' }, statusPath: 'status.jobs.badRetry' },
            permissions: [],
          },
        },
        {
          id: 'job.bad-schedule',
          kind: 'job',
          name: 'bad-schedule',
          stability: 'experimental',
          task: { taskKind: 'cleanup' },
          schedule: { cron: '0 * * * *', startingDeadlineSeconds: -1 },
          phase: { initialPhase: 'Pending', terminalPhases: ['Complete', 'Failed'], conditions: ['Progressing', 'Ready', 'Failed'] },
          resources: [],
          retry: { mode: 'never' },
          runtime: {
            materialization: 'kubernetes-job',
            idempotency: { keySource: 'explicit', conflictPolicy: 'failClosed' },
            phaseStatus: { resource: { apiVersion: 'guestbook.applik8s.dev/v1alpha1', kind: 'GuestBook' }, statusPath: 'status.jobs.badSchedule' },
            permissions: [],
          },
        },
        {
          id: 'job.missing-schedule',
          kind: 'job',
          name: 'missing-schedule',
          stability: 'experimental',
          task: { taskKind: 'maintenance' },
          phase: { initialPhase: 'Pending', terminalPhases: ['Complete', 'Failed'], conditions: ['Progressing', 'Ready', 'Failed'] },
          resources: [],
          retry: { mode: 'never' },
          runtime: {
            materialization: 'kubernetes-cronjob',
            idempotency: { keySource: 'explicit', conflictPolicy: 'failClosed' },
            phaseStatus: { resource: { apiVersion: 'guestbook.applik8s.dev/v1alpha1', kind: 'GuestBook' }, statusPath: 'status.jobs.missingSchedule' },
            permissions: [],
          },
        },
      ],
      edges: [
        ...graph.edges,
        { from: { nodeId: 'server.missing' }, to: { nodeId: 'model.missing' }, relationship: 'dependsOn' },
      ],
    };

    expect(validateApplicationGraphStructure(malformed)).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application graph contains duplicate node id model.entry.' }),
      expect.objectContaining({ message: 'Application graph edge server.missing:dependsOn:model.missing references missing source node server.missing.' }),
      expect.objectContaining({ message: 'Application graph edge server.missing:dependsOn:model.missing references missing target node model.missing.' }),
      expect.objectContaining({ message: 'Application model node model.ttl-entry has inconsistent ModelStore refs between store and materialization.provider.' }),
      expect.objectContaining({ message: 'Application model node model.ttl-entry declares generatedJob migrations but no migration job depends on it.' }),
      expect.objectContaining({ message: 'Application model node model.ttl-entry uses ttl retention without ttlSeconds.' }),
      expect.objectContaining({ message: 'Application job node job.bad-retry initial phase must not be terminal.' }),
      expect.objectContaining({ message: 'Application job node job.bad-retry bounded retry policy requires maxAttempts >= 1.' }),
      expect.objectContaining({ message: 'Application job node job.bad-retry bounded retry policy requires maxDelayMs >= initialDelayMs.' }),
      expect.objectContaining({ message: 'Application job node job.bad-schedule declares a schedule but is not materialized as kubernetes-cronjob.' }),
      expect.objectContaining({ message: 'Application job node job.bad-schedule schedule startingDeadlineSeconds must be >= 0.' }),
      expect.objectContaining({ message: 'Application job node job.missing-schedule uses kubernetes-cronjob runtime without a schedule contract.' }),
    ]));
  });

  it('combines structural and provider validation for the lowering gate', () => {
    const graph: ApplicationGraph = {
      ...guestBookSubstrateGraph(),
      nodes: guestBookSubstrateGraph().nodes.filter((node) => node.id !== 'provider.model.postgres'),
      edges: [
        ...guestBookSubstrateGraph().edges,
        { from: { nodeId: 'job.missing' }, to: { nodeId: 'model.entry' }, relationship: 'dependsOn' },
      ],
    };

    expect(validateApplicationGraph(graph)).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application graph edge job.missing:dependsOn:model.entry references missing source node job.missing.' }),
      expect.objectContaining({ message: expect.stringContaining('Application graph node model.entry requires ModelStore provider provider.model.postgres') }),
    ]));
  });

  it('validates explicit provider requirements and requirement consumers before lowering', () => {
    const graph = guestBookSubstrateGraph();
    const explicitRequirement: ApplicationProviderRequirement<'ModelStore'> = {
      id: 'requirement.model.entry.store',
      interface: 'ModelStore',
      consumer: { nodeId: 'model.entry' },
      provider: { interface: 'ModelStore', nodeId: 'provider.model.postgres' },
      required: true,
      purpose: 'modelStore',
      diagnostics: {
        missing: 'Model GuestBookEntry requires a ModelStore provider.',
        ambiguous: 'Model GuestBookEntry has multiple ModelStore providers.',
      },
    };

    expect(validateApplicationGraphProviderBindings(graph, [explicitRequirement])).toEqual([]);

    expect(validateApplicationGraphProviderBindings(graph, [{
      ...explicitRequirement,
      provider: { interface: 'ModelStore', nodeId: 'provider.model.missing' },
    }])).toEqual([
      expect.objectContaining({ message: 'Application provider requirement requirement.model.entry.store requires ModelStore provider provider.model.missing, but that provider node is missing.' }),
    ]);

    expect(validateApplicationGraphProviderBindings(graph, [{
      ...explicitRequirement,
      consumer: { nodeId: 'model.missing' },
    }])).toEqual([
      expect.objectContaining({ message: 'Application provider requirement requirement.model.entry.store references missing consumer model.missing.' }),
    ]);
  });

  it('validates missing and ambiguous provider requirements from graph providers', () => {
    const requirement: ApplicationProviderRequirement<'ModelStore'> = {
      id: 'requirement.model.entry.store',
      interface: 'ModelStore',
      consumer: { nodeId: 'model.entry' },
      required: true,
      purpose: 'modelStore',
      diagnostics: {
        missing: 'Model GuestBookEntry requires a ModelStore provider.',
        ambiguous: 'Model GuestBookEntry has multiple ModelStore providers.',
      },
    };
    const graph = guestBookSubstrateGraph();

    expect(validateApplicationGraphProviderBindings({ ...graph, nodes: graph.nodes.filter((node) => node.kind !== 'provider'), providerRequirements: [], providerBindings: [] }, [requirement])).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Model GuestBookEntry requires a ModelStore provider.' }),
    ]));
    expect(validateApplicationGraphProviderBindings({
      ...graph,
      providerRequirements: [],
      providerBindings: [],
      nodes: [
        ...graph.nodes,
        { id: 'provider.model.postgres-replica', kind: 'provider', name: 'postgres-replica', stability: 'stable', interface: 'ModelStore', implementation: 'postgres' },
      ],
    }, [requirement])).toEqual([
      expect.objectContaining({ message: 'Model GuestBookEntry has multiple ModelStore providers.' }),
    ]);
  });

  it('resolves provider requirements explicitly and by interface before adapters exist', () => {
    const graph = guestBookSubstrateGraph();
    const requirement = modelStoreRequirement();

    expect(resolveApplicationGraphProviderRequirement(graph, requirement)).toMatchObject({
      status: 'resolved',
      provider: { id: 'provider.model.postgres', interface: 'ModelStore', implementation: 'postgres' },
      diagnostics: [],
    });
    expect(resolveApplicationGraphProviderRequirement(graph, {
      ...requirement,
      provider: { interface: 'ModelStore', nodeId: 'provider.model.postgres' },
    })).toMatchObject({
      status: 'resolved',
      provider: { id: 'provider.model.postgres' },
      diagnostics: [],
    });
  });

  it('fails provider resolution closed for missing, ambiguous, invalid consumer, and invalid explicit provider cases', () => {
    const graph = guestBookSubstrateGraph();
    const requirement = modelStoreRequirement();
    const replicaProvider: ApplicationProviderNode<'ModelStore'> = {
      id: 'provider.model.postgres-replica',
      kind: 'provider',
      name: 'postgres-replica',
      stability: 'stable',
      interface: 'ModelStore',
      implementation: 'postgres',
    };
    const missing = resolveApplicationGraphProviderRequirement({ ...graph, nodes: graph.nodes.filter((node) => node.kind !== 'provider') }, requirement);
    const ambiguous = resolveApplicationGraphProviderRequirement({ ...graph, nodes: [...graph.nodes, replicaProvider] }, requirement);
    const invalidConsumer = resolveApplicationGraphProviderRequirement(graph, { ...requirement, consumer: { nodeId: 'model.missing' } });
    const invalidProvider = resolveApplicationGraphProviderRequirement(graph, { ...requirement, provider: { interface: 'ModelStore', nodeId: 'provider.model.missing' } });
    const invalidProviderInterface = resolveApplicationGraphProviderRequirement(graph, {
      ...requirement,
      // typecast: this malformed requirement simulates corrupted serialized graph input that bypasses TypeScript.
      provider: { interface: 'IndexStore', nodeId: 'provider.model.postgres' } as never,
    });

    expect(missing).toMatchObject({ status: 'missing', candidates: [], diagnostics: [expect.objectContaining({ message: 'Model GuestBookEntry requires a ModelStore provider.' })] });
    expect(ambiguous).toMatchObject({ status: 'ambiguous', candidates: [expect.objectContaining({ id: 'provider.model.postgres' }), expect.objectContaining({ id: 'provider.model.postgres-replica' })] });
    expect(invalidConsumer).toMatchObject({ status: 'invalidConsumer', candidates: [], diagnostics: [expect.objectContaining({ message: 'Application provider requirement requirement.model.entry.store references missing consumer model.missing.' })] });
    expect(invalidProvider).toMatchObject({ status: 'invalidProvider', candidates: [], diagnostics: [expect.objectContaining({ message: 'Application provider requirement requirement.model.entry.store requires ModelStore provider provider.model.missing, but that provider node is missing.' })] });
    expect(invalidProviderInterface).toMatchObject({
      status: 'invalidProvider',
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ message: 'Application provider requirement requirement.model.entry.store requires ModelStore, but its explicit provider ref is for IndexStore.' }),
        expect.objectContaining({ message: 'Application provider requirement requirement.model.entry.store requires IndexStore provider provider.model.postgres, but the provider node implements ModelStore.' }),
      ]),
    });
  });

  it('defines model materialization and generated job runtime contracts before implementation', () => {
    const modelMaterialization: ApplicationModelMaterializationContract = {
      mode: 'providerBacked',
      provider: { interface: 'ModelStore', nodeId: 'provider.model.postgres' },
      backingResources: [{ apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster', name: 'guestbook-db' }],
      connection: {
        env: { DATABASE_URL_SECRET: 'guestbook-db-app' },
        secretRefs: [{ apiVersion: 'v1', kind: 'Secret', name: 'guestbook-db-app' }],
        permissions: [{ apiGroups: [''], resources: ['secrets'], verbs: ['get'], resourceNames: ['guestbook-db-app'] }],
      },
      runtimeBoundary: { serializedCallbacks: 'generatedRuntimeClient', scriptExecution: 'scriptRuntimeClient' },
      reconciliation: { ownership: 'application', schemaDrift: 'failClosed', deletionPolicy: 'retain' },
    };
    const jobRuntime: ApplicationJobRuntimeContract = {
      materialization: 'kubernetes-job',
      idempotency: { keySource: 'metadata.generation', conflictPolicy: 'skipCompleted' },
      phaseStatus: { resource: { apiVersion: 'guestbook.applik8s.dev/v1alpha1', kind: 'GuestBook' }, statusPath: 'status.jobs.entryMigration' },
      permissions: [{ apiGroups: ['batch'], resources: ['jobs'], verbs: ['create', 'get', 'list', 'watch'] }],
      environment: modelMaterialization.connection,
    };
    const schedule: ApplicationScheduleContract = {
      cron: '0 * * * *',
      timezone: 'UTC',
      concurrencyPolicy: 'forbid',
      missedRunPolicy: 'failClosed',
      startingDeadlineSeconds: 300,
    };

    expect(modelMaterialization.reconciliation.schemaDrift).toBe('failClosed');
    expect(modelMaterialization.runtimeBoundary).toEqual({ serializedCallbacks: 'generatedRuntimeClient', scriptExecution: 'scriptRuntimeClient' });
    expect(modelMaterialization.connection.secretRefs?.[0]?.kind).toBe('Secret');
    expect(jobRuntime.idempotency.conflictPolicy).toBe('skipCompleted');
    expect(jobRuntime.phaseStatus.statusPath).toBe('status.jobs.entryMigration');
    expect(schedule.concurrencyPolicy).toBe('forbid');
  });
});

function modelStoreRequirement(): ApplicationProviderRequirement<'ModelStore'> {
  return {
    id: 'requirement.model.entry.store',
    interface: 'ModelStore',
    consumer: { nodeId: 'model.entry' },
    required: true,
    purpose: 'modelStore',
    diagnostics: {
      missing: 'Model GuestBookEntry requires a ModelStore provider.',
      ambiguous: 'Model GuestBookEntry has multiple ModelStore providers.',
    },
  };
}

function diagnostic(event: ApplicationDiagnosticContract['event'], nodeId: string, reason: string, message: string): ApplicationDiagnosticContract {
  return {
    event,
    severity: 'error',
    subject: { nodeId },
    reason,
    message,
    retryable: false,
  };
}

function modelStoreSemantics(): ApplicationModelStoreSemanticsContract {
  return {
    generatedRuntimeParity: 'required',
    scriptRuntimeParity: 'required',
    query: { defaultLimit: 50, maxLimit: 500, cursor: 'offset', unsupportedFilters: 'failClosed' },
    indexes: { partitionRequired: true, uniqueEnforcedBy: 'databaseConstraint', unsupportedOrderBy: 'failClosed' },
    constraints: { duplicateKeyDiagnostic: 'applik8s-model-duplicate-key', enforcement: 'databaseConstraint' },
    migrationHistory: { tableName: 'applik8s_model_migrations', revisionColumn: 'revision', appliedAtColumn: 'applied_at' },
    retention: { mode: 'retain', deletionPolicy: 'explicitOnly' },
  };
}

function runtimeModuleInterface(imports: ApplicationRuntimeModuleContract['imports'], exports: NonNullable<ApplicationRuntimeModuleContract['exports']>, sourceMaps: ApplicationRuntimeModuleInterfaceContract['sourceMaps']): ApplicationRuntimeModuleInterfaceContract {
  return {
    apiVersion: 'applik8s.runtime/v1alpha1',
    imports: imports ?? [],
    exports,
    diagnostics: 'structured',
    sourceMaps,
    failurePolicy: 'failClosed',
  };
}

function jobStatusLifecycle(nodeId: string, configMapName: string, cronJob: ApplicationJobStatusLifecycleContract['cronJob']): ApplicationJobStatusLifecycleContract {
  return {
    ownership: {
      primary: 'applicationStatus',
      fallback: 'generatedStatusConfigMap',
      appStatusSchema: 'bestEffort',
      durableStore: { apiVersion: 'v1', kind: 'ConfigMap', name: configMapName },
      conflictPolicy: 'mergePatch',
      diagnostics: [{ event: 'applik8s-status-schema-pruned', severity: 'warning', subject: { nodeId }, reason: 'ApplicationStatusSchemaMayPruneCustomFields', message: 'Generated job status falls back to ConfigMap when app status pruning applies.', retryable: false }],
    },
    conflictPolicy: 'mergePatch',
    historyRetention: { maxEntries: 20, terminalRetention: 'retain' },
    multiJob: 'appLevelReconciler',
    cronJob,
    fallback: 'generatedStatusConfigMap',
  };
}

function guestBookSubstrateGraph(): ApplicationGraph {
  return {
    apiVersion: 'applik8s.appGraph/v1alpha1',
    kind: 'ApplicationGraph',
    metadata: { name: 'guestbook' },
    nodes: [
      {
        id: 'provider.model.postgres',
        kind: 'provider',
        name: 'postgres',
        stability: 'stable',
        interface: 'ModelStore',
        implementation: 'postgres',
        contract: { interface: 'ModelStore', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
        config: { database: 'guestbook' },
      },
      {
        id: 'model.entry',
        kind: 'model',
        name: 'GuestBookEntry',
        stability: 'stable',
        entity: { name: 'GuestBookEntry' },
        store: { interface: 'ModelStore', nodeId: 'provider.model.postgres' },
        schema: {
          identity: ['id'],
          constraints: [{ name: 'entry-author-message', kind: 'unique', fields: ['guestbook', 'author', 'message'] }],
          indexes: [{ name: 'publishedByBookNewest', fields: ['guestbook', 'publishedAt'] }],
          migrations: { strategy: 'generatedJob', compatibility: 'requiresExplicitMigration' },
          transactions: 'supported',
          retention: { mode: 'retain' },
          guarantees: {
            identity: 'stableId',
            uniqueness: 'databaseConstraint',
            indexes: 'declaredSecondaryIndexes',
            transactions: 'supported',
            retention: 'retain',
            migrationOwnership: 'generatedJob',
            semantics: modelStoreSemantics(),
          },
        },
        materialization: {
          mode: 'providerBacked',
          provider: { interface: 'ModelStore', nodeId: 'provider.model.postgres' },
          backingResources: [{ apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster', name: 'guestbook-db' }],
          connection: {
            env: { DATABASE_URL_SECRET: 'guestbook-db-app' },
            secretRefs: [{ apiVersion: 'v1', kind: 'Secret', name: 'guestbook-db-app' }],
          },
          runtimeBoundary: { serializedCallbacks: 'generatedRuntimeClient', scriptExecution: 'scriptRuntimeClient' },
          reconciliation: { ownership: 'application', schemaDrift: 'failClosed', deletionPolicy: 'retain' },
        },
      },
      {
        id: 'job.entry-migration',
        kind: 'job',
        name: 'entry-migration',
        stability: 'stable',
        task: { taskKind: 'migration', image: 'node:22-alpine' },
        phase: { initialPhase: 'Pending', terminalPhases: ['Complete', 'Failed'], conditions: ['Blocked', 'Progressing', 'Ready', 'Failed'] },
        resources: [],
        retry: { mode: 'boundedExponentialBackoff', maxAttempts: 5, initialDelayMs: 1000, maxDelayMs: 30000 },
        runtime: {
          materialization: 'kubernetes-job',
          idempotency: { keySource: 'metadata.generation', conflictPolicy: 'skipCompleted' },
          phaseStatus: { resource: { apiVersion: 'guestbook.applik8s.dev/v1alpha1', kind: 'GuestBook' }, statusPath: 'status.jobs.entryMigration' },
          statusLifecycle: jobStatusLifecycle('job.entry-migration', 'guestbook-status-reconciler-status', 'unsupported'),
          permissions: [{ apiGroups: ['batch'], resources: ['jobs'], verbs: ['create', 'get', 'list', 'watch'] }],
          metadataLinks: [
            { graphNode: { nodeId: 'job.entry-migration' }, artifact: { kind: 'jobDiagnostics', path: 'jobs/entry-migration/diagnostics.json' }, purpose: 'jobDiagnostics' },
          ],
        },
        generatedResources: [
          { role: 'migration', graphNode: { nodeId: 'job.entry-migration' }, resource: { apiVersion: 'batch/v1', kind: 'Job', name: 'entry-migration' }, artifact: { kind: 'kubernetesManifest', path: 'jobs/entry-migration.yaml' } },
          { role: 'jobDiagnostics', graphNode: { nodeId: 'job.entry-migration' }, artifact: { kind: 'jobDiagnostics', path: 'jobs/entry-migration/diagnostics.json' } },
        ],
      },
      {
        id: 'server.web',
        kind: 'server',
        name: 'web',
        stability: 'stable',
        routes: [{ id: 'get-index-0', method: 'GET', path: '/' }],
        resources: [],
        indexes: [{ nodeId: 'model.entry' }],
        generatedResources: [
          { role: 'workload', graphNode: { nodeId: 'server.web' }, resource: { apiVersion: 'apps/v1', kind: 'Deployment', name: 'web' }, artifact: { kind: 'kubernetesManifest', path: 'servers/web/deployment.yaml' } },
          { role: 'runtimeBundle', graphNode: { nodeId: 'server.web' }, artifact: { kind: 'runtimeBundle', path: 'servers/web/server.mjs' } },
          { role: 'rbac', graphNode: { nodeId: 'server.web' }, resource: { apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'Role', name: 'web' }, artifact: { kind: 'rbacManifest', path: 'servers/web/rbac.yaml' } },
          { role: 'routeDiagnostics', graphNode: { nodeId: 'server.web' }, artifact: { kind: 'routeDiagnostics', path: 'servers/web/routes.manifest.json' } },
        ],
      },
      {
        id: 'permission.web',
        kind: 'permission',
        name: 'web-model-read',
        stability: 'stable',
        owner: { nodeId: 'server.web' },
        mode: 'inferred',
        rules: [{ apiGroups: ['guestbook.applik8s.dev'], resources: ['guestbookentries'], verbs: ['get', 'list'] }],
      },
    ],
    edges: [
      { from: { nodeId: 'provider.model.postgres' }, to: { nodeId: 'model.entry' }, relationship: 'provides' },
      { from: { nodeId: 'job.entry-migration' }, to: { nodeId: 'model.entry' }, relationship: 'dependsOn' },
      { from: { nodeId: 'server.web' }, to: { nodeId: 'model.entry' }, relationship: 'dependsOn' },
      { from: { nodeId: 'permission.web' }, to: { nodeId: 'server.web' }, relationship: 'writes' },
    ],
    providerRequirements: [modelStoreRequirement()],
    providerBindings: [
      {
        requirement: 'requirement.model.entry.store',
        provider: { interface: 'ModelStore', nodeId: 'provider.model.postgres' },
        generatedResources: [{ apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster', name: 'guestbook-db' }],
        runtime: {
          env: { DATABASE_URL_SECRET: 'guestbook-db-app' },
          secretRefs: [{ apiVersion: 'v1', kind: 'Secret', name: 'guestbook-db-app' }],
          readiness: { dependencies: [{ apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster', name: 'guestbook-db' }], condition: 'Ready', timeoutSeconds: 300 },
        },
        metadataLinks: [
          { graphNode: { nodeId: 'provider.model.postgres' }, artifact: { kind: 'providerContract', path: 'providers/model-store/postgres.json' }, purpose: 'providerDependency' },
        ],
      },
    ],
    compatibility: {
      stablePublicApis: ['app', 'app.model', 'app.crd', 'app.job', 'app.schedule', 'app.defaults', 'app.provide', 'provider.ModelStore', 'provider.postgres'],
      documentedInternalContracts: ['ApplicationGraph'],
      experimentalSurfaces: [],
      postV3Surfaces: ['workload-movement-operator', 'generic-workflow-orchestration'],
      labels: [
        { name: 'app.model', surface: 'stablePublicApi', since: 'v0.3', rationale: 'Stable app-data materialization entrypoint.' },
        { name: 'ApplicationGraph', surface: 'documentedInternalContract', since: 'v0.3', rationale: 'Stable app IR before lowering.' },
        { name: 'provider.postgres', surface: 'stablePublicApi', since: 'v0.3', rationale: 'First ModelStore implementation target.' },
        { name: 'workload-movement-operator', surface: 'postV3Surface', rationale: 'Built after v0.3 substrate freeze.' },
      ],
    },
  };
}
