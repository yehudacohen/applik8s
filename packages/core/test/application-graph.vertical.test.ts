import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  type ApplicationCrdSchemaCompatibilityContract,
  type ApplicationDiagnosticContract,
  type ApplicationDurableStatusOwnershipContract,
  type ApplicationGeneratedResourceContract,
  type ApplicationGraph,
  type ApplicationJobRuntimeContract,
  type ApplicationJobStatusLifecycleContract,
  type ApplicationMigrationContract,
  type ApplicationMigrationDriftCheckContract,
  type ApplicationMigrationPlanContract,
  type ApplicationModelMaterializationContract,
  type ApplicationTransactionalDatabaseGuaranteesContract,
  type ApplicationTransactionalDatabaseSemanticsContract,
  type ApplicationObservabilityContract,
  type ApplicationOperationTargetContract,
  type ApplicationPhaseStatus,
  type ApplicationProviderBindingContract,
  type ApplicationProviderCompatibilityMatrixContract,
  type ApplicationProviderInterfaceContract,
  type ApplicationProviderInterfaceKind,
  type ApplicationProviderNode,
  type ApplicationProviderRequirement,
  type ApplicationRuntimeModuleContract,
  type ApplicationRuntimeModuleInterfaceContract,
  type ApplicationRuntimeModuleManifestContract,
  type ApplicationScheduleContract,
  type ApplicationV03PressureTestContract,
  type ApplicationWatchScopeLoweringContract,
  applicationGraphNodeKinds,
  applicationProviderInterfaceKinds,
  applicationV03ProviderInterfaceKinds,
  type GeneratedJobContract,
  type GeneratedJobDurableStatusUpdaterContract,
  type GeneratedJobPhaseStatusContract,
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
  validateApplicationTransactionalDatabaseSemanticsContract,
  validateApplicationOperationTargetContract,
  validateApplicationProviderCompatibilityMatrixContract,
  validateApplicationProviderInterfaceContract,
  validateApplicationRuntimeModuleInterfaceContract,
  validateApplicationRuntimeModuleManifestContract,
  validateApplicationV03PressureTestContract,
  validateApplicationWatchScopeLoweringContract,
} from '../src/index.js';

describe('application graph substrate contract', () => {
  it('names the v0.3 substrate node and provider interfaces explicitly', () => {
    expect(applicationGraphNodeKinds).toEqual([
      'installation',
      'crd',
      'model',
      'server',
      'operator',
      'index',
      'aggregate',
      'counter',
      'command',
      'event',
      'commandHandler',
      'processor',
      'task',
      'taskHandler',
      'workflow',
      'workflowHandler',
      'workflowWorker',
      'query',
      'gateway',
      'stream',
      'streamProcessor',
      'subscription',
      'projection',
      'objectStore',
      'job',
      'config',
      'secret',
      'exposure',
      'provider',
      'permission',
      'authorityManifest',
      'typeKroResource',
    ]);
    expect(applicationProviderInterfaceKinds).toEqual([
      'TransactionalDatabase',
      'IndexStore',
      'CounterStore',
      'EventSource',
      'EventLog',
      'Secret',
      'Queue',
      'ObjectStorage',
      'HttpExposure',
      'Certificate',
      'DnsPublication',
      'CredentialStore',
      'WorkflowEngine',
      'AnalyticalDatabase',
      'ApplicationHost',
      'ContainerRegistry',
      'RequestIdentity',
      'Authorization',
      'StructuredGeneration',
    ]);
    expect(isApplicationGraphNodeKind('job')).toBe(true);
    expect(isApplicationGraphNodeKind('workflow')).toBe(true);
    expect(isApplicationProviderInterfaceKind('TransactionalDatabase')).toBe(true);
    expect(isApplicationProviderInterfaceKind('AnalyticalDatabase')).toBe(true);
    expect(isApplicationProviderInterfaceKind('analytical-database')).toBe(false);
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
    expect(statusContract.statusTarget.statusPath).toBe('status.applik8s.jobs.entryMigration');
    expect(statusContract.statusShape.conditions[0]?.type).toBe('Progressing');
  });

  it('records TransactionalDatabase guarantees on model schema contracts', () => {
    const graph = guestBookSubstrateGraph();
    const model = graph.nodes.find((node) => node.id === 'model.entry' && node.kind === 'model');
    if (model?.kind !== 'model') {
      throw new Error('test fixture missing model.entry');
    }
    const guarantees: ApplicationTransactionalDatabaseGuaranteesContract = model.schema.guarantees ?? {
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
      semantics: transactionalDatabaseSemantics(),
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
      'provider.transactional-database.postgres',
      'server.web',
    ]);
    expect(normalizeApplicationGraph(reordered).edges.map((edge) => `${edge.from.nodeId}:${edge.relationship}:${edge.to.nodeId}`)).toEqual([
      'job.entry-migration:dependsOn:model.entry',
      'permission.web:writes:server.web',
      'provider.transactional-database.postgres:provides:model.entry',
      'server.web:dependsOn:model.entry',
    ]);
    expect(serializeApplicationGraph(reordered)).toBe(serializeApplicationGraph(graph));
    expect(serializeApplicationGraph(graph)).toContain('"apiVersion":"applik8s.appGraph/v1alpha1"');
  });

  it('preserves opaque installation references across the durable graph boundary', () => {
    const namespace = new Proxy({}, {
      get(_target, property) {
        if (property === Symbol.for('TypeKro.KubernetesRef')) return true;
        if (property === 'resourceId') return '__schema__';
        if (property === 'fieldPath') return 'spec.name';
        return undefined;
      },
    });
    const endpoint = { expression: '"http://" + string(schema.spec.hostname)', __isTemplate: true };
    const base = guestBookSubstrateGraph();
    const graph: ApplicationGraph = {
      ...base,
      nodes: base.nodes.map((node) => node.id === 'provider.transactional-database.postgres'
        ? { ...node, config: { namespace, endpoint } }
        : node),
    };

    const serialized = JSON.parse(serializeApplicationGraph(graph));
    const provider = serialized.nodes.find((node: { id: string }) => node.id === 'provider.transactional-database.postgres');
    expect(provider.config).toEqual({
      endpoint: ['$', '{"http://" + string(schema.spec.hostname)}'].join(''),
      namespace: ['$', '{schema.spec.name}'].join(''),
    });
  });

  it('keeps provider requirements and bindings as first-class graph contracts', () => {
    const graph = guestBookSubstrateGraph();

    expect(graph.providerRequirements).toEqual([
      expect.objectContaining({ id: 'requirement.model.entry.database', interface: 'TransactionalDatabase', consumer: { nodeId: 'model.entry' } }),
    ]);
    expect(graph.providerBindings).toEqual([
      expect.objectContaining({
        requirement: 'requirement.model.entry.database',
        provider: { interface: 'TransactionalDatabase', nodeId: 'provider.transactional-database.postgres' },
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
      observability: expect.objectContaining({ health: { mode: 'http', readinessPath: '/-/healthz', livenessPath: '/-/healthz' }, sourceMaps: 'required' }),
      generatedResources: expect.arrayContaining([
        expect.objectContaining({ role: 'runtimeBundle', graphNode: { nodeId: 'server.web' }, artifact: expect.objectContaining({ kind: 'runtimeBundle' }) }),
        expect.objectContaining({ role: 'rbac', graphNode: { nodeId: 'server.web' }, artifact: expect.objectContaining({ kind: 'rbacManifest' }) }),
      ]),
    });
    expect(graph.providerBindings[0]?.metadataLinks).toEqual(expect.arrayContaining([
      expect.objectContaining({ purpose: 'providerDependency', graphNode: { nodeId: 'provider.transactional-database.postgres' } }),
    ]));
    expect(validateApplicationGraphStructure({
      ...graph,
      nodes: graph.nodes.map((node) => node.id === 'server.web'
        // typecast: negative fixture deliberately removes required observability metadata.
        ? ({ ...node, observability: undefined } as never)
        : node),
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application server node server.web must declare generated observability metadata.' }),
    ]));
  });

  it('defines generated runtime module boundaries and diagnostic taxonomy before runtime extraction', () => {
    const modules: readonly ApplicationRuntimeModuleContract[] = [
      { apiVersion: 'applik8s.runtime/v1alpha1', kind: 'serverRuntime', name: 'web', artifact: { kind: 'runtimeModule', path: 'runtime/server/web.mjs' }, interface: runtimeModuleInterface([{ kind: 'modelRuntime', name: 'postgres-models' }, { kind: 'diagnostics', name: 'diagnostics' }], [{ name: 'createServerRuntime', kind: 'function', stability: 'stable' }], 'required'), entrypoint: 'createServerRuntime', exports: [{ name: 'createServerRuntime', kind: 'function', stability: 'stable' }], imports: [{ kind: 'modelRuntime', name: 'postgres-models' }, { kind: 'diagnostics', name: 'diagnostics' }] },
      { apiVersion: 'applik8s.runtime/v1alpha1', kind: 'modelRuntime', name: 'postgres-models', artifact: { kind: 'runtimeModule', path: 'runtime/model/postgres.mjs' }, interface: runtimeModuleInterface([{ kind: 'providerAdapter', name: 'postgres' }, { kind: 'diagnostics', name: 'diagnostics' }], [{ name: 'createModelRuntime', kind: 'function', stability: 'stable' }], 'required'), entrypoint: 'createModelRuntime', exports: [{ name: 'createModelRuntime', kind: 'function', stability: 'stable' }], imports: [{ kind: 'providerAdapter', name: 'postgres' }, { kind: 'diagnostics', name: 'diagnostics' }] },
      { apiVersion: 'applik8s.runtime/v1alpha1', kind: 'jobRunnerRuntime', name: 'migration-job', artifact: { kind: 'runtimeModule', path: 'runtime/jobs/migration.mjs' }, interface: runtimeModuleInterface([{ kind: 'kubernetesClient', name: 'kubernetes' }, { kind: 'diagnostics', name: 'diagnostics' }], [{ name: 'createJobStatusUpdater', kind: 'function', stability: 'stable' }], 'required'), entrypoint: 'createJobStatusUpdater', exports: [{ name: 'createJobStatusUpdater', kind: 'function', stability: 'stable' }], imports: [{ kind: 'kubernetesClient', name: 'kubernetes' }, { kind: 'diagnostics', name: 'diagnostics' }] },
      { apiVersion: 'applik8s.runtime/v1alpha1', kind: 'kubernetesClient', name: 'kubernetes', artifact: { kind: 'runtimeModule', path: 'runtime/kubernetes-client.mjs' }, interface: runtimeModuleInterface([], [{ name: 'createKubernetesClient', kind: 'function', stability: 'stable' }], 'required'), entrypoint: 'createKubernetesClient', exports: [{ name: 'createKubernetesClient', kind: 'function', stability: 'stable' }], imports: [] },
      { apiVersion: 'applik8s.runtime/v1alpha1', kind: 'diagnostics', name: 'diagnostics', artifact: { kind: 'runtimeModule', path: 'runtime/diagnostics.mjs' }, interface: runtimeModuleInterface([], [{ name: 'diagnosticEvent', kind: 'function', stability: 'stable' }], 'notApplicable'), exports: [{ name: 'diagnosticEvent', kind: 'function', stability: 'stable' }] },
      { apiVersion: 'applik8s.runtime/v1alpha1', kind: 'providerAdapter', name: 'postgres', artifact: { kind: 'runtimeModule', path: 'runtime/providers/postgres.mjs' }, interface: runtimeModuleInterface([{ kind: 'diagnostics', name: 'diagnostics' }], [{ name: 'createPostgresProvider', kind: 'function', stability: 'stable' }], 'required'), exports: [{ name: 'createPostgresProvider', kind: 'function', stability: 'stable' }], imports: [{ kind: 'diagnostics', name: 'diagnostics' }] },
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

    expect(modules.map((module) => module.kind)).toEqual(['serverRuntime', 'modelRuntime', 'jobRunnerRuntime', 'kubernetesClient', 'diagnostics', 'providerAdapter']);
    expect(modules[0]?.imports).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'modelRuntime' })]));
    expect(modules[2]?.entrypoint).toBe('createJobStatusUpdater');
    expect(modules[2]?.exports).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'createJobStatusUpdater', stability: 'stable' })]));
    expect(modules.flatMap((module) => module.interface ? validateApplicationRuntimeModuleInterfaceContract(module.interface) : [])).toEqual([]);
    expect(validateApplicationRuntimeModuleInterfaceContract({ apiVersion: 'applik8s.runtime/v1alpha1', imports: [], exports: [], diagnostics: 'structured', sourceMaps: 'required', failurePolicy: 'failClosed' })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application runtime module interface must declare at least one export.' }),
    ]));
    const manifest: ApplicationRuntimeModuleManifestContract = {
      apiVersion: 'applik8s.runtime/v1alpha1',
      kind: 'GeneratedRuntimeModuleManifest',
      modules: modules.map((module) => ({
        apiVersion: module.apiVersion ?? 'applik8s.runtime/v1alpha1',
        kind: module.kind,
        name: module.name,
        artifact: module.artifact,
        path: module.artifact.path ?? `${module.name}.mjs`,
        entrypoint: module.entrypoint ?? module.exports?.[0]?.name ?? 'createRuntimeModule',
        imports: module.imports ?? [],
        exports: module.exports ?? [],
        interface: module.interface ?? runtimeModuleInterface([], module.exports ?? [], 'required'),
      })),
    };
    expect(validateApplicationRuntimeModuleManifestContract(manifest)).toEqual([]);
    expect(validateApplicationRuntimeModuleManifestContract({ ...manifest, modules: manifest.modules.map((module) => module.kind === 'serverRuntime' ? { ...module, artifact: { ...module.artifact, path: 'runtime/server-drift.mjs' } } : module) })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application runtime module serverRuntime artifact path must match its manifest path.' }),
    ]));
    expect(validateApplicationRuntimeModuleManifestContract({ ...manifest, modules: manifest.modules.map((module) => module.kind === 'serverRuntime' ? { ...module, interface: { ...module.interface, imports: [] } } : module) })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application runtime module serverRuntime interface imports must match manifest imports.' }),
    ]));
    expect(duplicateKey).toMatchObject({ event: 'applik8s-model-duplicate-key', retryable: false });
  });

  it('freezes TransactionalDatabase semantic contracts for generated and script runtimes before broad implementation', () => {
    const semantics = transactionalDatabaseSemantics();

    expect(semantics).toMatchObject({ generatedRuntimeParity: 'required', scriptRuntimeParity: 'required' });
    expect(semantics.query).toEqual({ defaultLimit: 50, maxLimit: 500, cursor: 'offset', unsupportedFilters: 'failClosed' });
    expect(semantics.indexes).toEqual({ partitionRequired: true, uniqueEnforcedBy: 'databaseConstraint', orderBy: 'declaredIndexFieldsOnly', unsupportedOrderBy: 'failClosed' });
    expect(semantics.constraints.duplicateKeyDiagnostic).toBe('applik8s-model-duplicate-key');
    expect(semantics.migrationHistory.tableName).toBe('applik8s_model_migrations');
    expect(semantics.transactions).toEqual({ declaration: 'supported', singleOperationAtomicity: 'databaseStatement', multiOperationApi: 'implemented', multiOperationBehavior: 'runtimeTransaction' });
    expect(semantics.retention).toEqual({ mode: 'retain', deletionPolicy: 'explicitOnly', enforcement: 'runtimeEnforced' });
    expect(validateApplicationTransactionalDatabaseSemanticsContract(semantics)).toEqual([]);
    expect(validateApplicationTransactionalDatabaseSemanticsContract({ ...semantics, transactions: { ...semantics.transactions, declaration: 'unsupported', multiOperationBehavior: 'failClosed' } })).toEqual([]);
    // typecast: negative fixture deliberately violates the public transaction enum to prove fail-closed validation.
    expect(validateApplicationTransactionalDatabaseSemanticsContract({ ...semantics, transactions: { ...semantics.transactions, singleOperationAtomicity: 'none' as never } })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application TransactionalDatabase transaction semantics must declare database statement atomicity for single operations.' }),
    ]));
    expect(validateApplicationTransactionalDatabaseSemanticsContract({ ...semantics, transactions: { ...semantics.transactions, declaration: 'unsupported' } })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application TransactionalDatabase unsupported transaction declarations must fail closed when the public transaction API is present.' }),
    ]));
    // typecast: negative fixture deliberately mismatches implemented transaction API with absent-method behavior.
    expect(validateApplicationTransactionalDatabaseSemanticsContract({ ...semantics, transactions: { ...semantics.transactions, multiOperationBehavior: 'methodAbsent' as never } })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application TransactionalDatabase implemented transaction API must declare runtime transaction behavior.' }),
    ]));
    // typecast: negative fixture deliberately violates the public index ordering enum to prove fail-closed validation.
    expect(validateApplicationTransactionalDatabaseSemanticsContract({ ...semantics, query: { ...semantics.query, defaultLimit: 0, maxLimit: 0 }, indexes: { ...semantics.indexes, partitionRequired: false, orderBy: 'anyField' as never }, constraints: { ...semantics.constraints, duplicateKeyDiagnostic: 'applik8s-model-migration-missing' } })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application TransactionalDatabase query semantics require maxLimit >= defaultLimit >= 1.' }),
      expect.objectContaining({ message: 'Application TransactionalDatabase index semantics must require explicit partitions for v0.3.' }),
      expect.objectContaining({ message: 'Application TransactionalDatabase index ordering must be limited to declared index fields.' }),
      expect.objectContaining({ message: 'Application TransactionalDatabase duplicate constraint semantics must use applik8s-model-duplicate-key diagnostics.' }),
    ]));
  });

  it('labels provider interfaces as implemented or fail-closed reserved for the v0.3 boundary', () => {
    const contracts: readonly ApplicationProviderInterfaceContract[] = applicationProviderInterfaceKinds.map((providerInterface) => providerInterface === 'TransactionalDatabase'
      ? { interface: providerInterface, surface: 'stablePublicApi', support: 'implemented', diagnostics: [] }
      : { interface: providerInterface, surface: 'stablePublicApi', support: 'failClosedReserved', diagnostics: [{ event: 'applik8s-provider-requirement-missing', severity: 'error', subject: { nodeId: `provider.${providerInterface}` }, reason: 'ProviderInterfaceReserved', message: `${providerInterface} is a stable v0.3 provider interface but has no generated adapter in the current slice.`, retryable: false }] });

    expect(contracts.map((contract) => `${contract.interface}:${contract.support}`)).toEqual([
      'TransactionalDatabase:implemented',
      'IndexStore:failClosedReserved',
      'CounterStore:failClosedReserved',
      'EventSource:failClosedReserved',
      'EventLog:failClosedReserved',
      'Secret:failClosedReserved',
      'Queue:failClosedReserved',
      'ObjectStorage:failClosedReserved',
      'HttpExposure:failClosedReserved',
      'Certificate:failClosedReserved',
      'DnsPublication:failClosedReserved',
      'CredentialStore:failClosedReserved',
      'WorkflowEngine:failClosedReserved',
      'AnalyticalDatabase:failClosedReserved',
      'ApplicationHost:failClosedReserved',
      'ContainerRegistry:failClosedReserved',
      'RequestIdentity:failClosedReserved',
      'Authorization:failClosedReserved',
      'StructuredGeneration:failClosedReserved',
    ]);
    expect(contracts.flatMap(validateApplicationProviderInterfaceContract)).toEqual([]);
    expect(validateApplicationProviderInterfaceContract({ interface: 'Queue', surface: 'stablePublicApi', support: 'failClosedReserved', diagnostics: [] })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application provider interface Queue is stable but fail-closed reserved without diagnostics.' }),
      expect.objectContaining({ message: 'Application provider interface Queue fail-closed reservation must use provider requirement diagnostics.' }),
    ]));
  });

  it('freezes the v0.3 provider compatibility matrix across every provider interface', () => {
    const matrix = providerCompatibilityMatrix();

    expect(matrix.providers.map((provider) => provider.interface)).toEqual([...new Set([...applicationProviderInterfaceKinds, ...applicationV03ProviderInterfaceKinds])]);
    expect(matrix.requiredForV03).toEqual(expect.arrayContaining(['TransactionalDatabase', 'CredentialStore', 'HttpExposure']));
    expect(validateApplicationProviderCompatibilityMatrixContract(matrix)).toEqual([]);
    expect(validateApplicationProviderCompatibilityMatrixContract({
      ...matrix,
      // typecast: deliberately bypass the public literal type to exercise runtime validation of malformed evidence.
      apiVersion: 'wrong' as never,
      providers: [...matrix.providers.filter((provider) => provider.interface !== 'Queue'), matrix.providers[0]].filter((provider): provider is ApplicationProviderInterfaceContract => !!provider),
      requiredForV03: ['TransactionalDatabase'],
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application provider compatibility matrix must declare apiVersion applik8s.providerCompatibility/v1alpha1.' }),
      expect.objectContaining({ message: 'Application provider compatibility matrix declares TransactionalDatabase more than once.' }),
      expect.objectContaining({ message: 'Application provider compatibility matrix must label Queue.' }),
      expect.objectContaining({ message: 'Application provider compatibility matrix must mark CredentialStore required for v0.3.' }),
      expect.objectContaining({ message: 'Application provider compatibility matrix must mark HttpExposure required for v0.3.' }),
    ]));
  });

  it('accepts versioned provider-package interfaces without extending the core built-in registry', () => {
    const matrix = providerCompatibilityMatrix();
    const analyticalDatabase: ApplicationProviderInterfaceContract = {
      apiVersion: 'applik8s.provider/v1alpha1',
      interface: 'VectorStore',
      version: 'v1alpha1',
      requirements: ['atomicProjectionCheckpoint'],
      guarantees: ['replaySafeProjectionWrites'],
      implementation: { name: 'external-projection-package' },
      surface: 'experimentalSurface',
      support: 'implemented',
      diagnostics: [],
    };
    expect(applicationProviderInterfaceKinds).not.toContain('VectorStore');
    expect(validateApplicationProviderCompatibilityMatrixContract({ ...matrix, providers: [...matrix.providers, analyticalDatabase] })).toEqual([]);
  });

  it('defines provider requirement contracts for every v0.3 capability interface', () => {
    const purposes: Record<ApplicationProviderInterfaceKind, ApplicationProviderRequirement['purpose']> = {
      TransactionalDatabase: 'transactionalDatabase',
      AnalyticalDatabase: 'analyticalDatabase',
      IndexStore: 'indexStore',
      CounterStore: 'counterStore',
      EventSource: 'eventSource',
      EventLog: 'eventLog',
      Secret: 'secret',
      Queue: 'queue',
      ObjectStorage: 'objectStorage',
      HttpExposure: 'httpExposure',
      Certificate: 'certificate',
      DnsPublication: 'dnsPublication',
      CredentialStore: 'credentialStore',
      WorkflowEngine: 'workflowEngine',
      ApplicationHost: 'applicationHost',
      ContainerRegistry: 'containerRegistry',
      RequestIdentity: 'requestIdentity',
      Authorization: 'authorization',
      StructuredGeneration: 'taskCapability',
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

    expect(requirements.map((requirement) => requirement.purpose)).toEqual(['transactionalDatabase', 'indexStore', 'counterStore', 'eventSource', 'eventLog', 'secret', 'queue', 'objectStorage', 'httpExposure', 'certificate', 'dnsPublication', 'credentialStore', 'workflowEngine', 'analyticalDatabase', 'applicationHost', 'containerRegistry', 'requestIdentity', 'authorization', 'taskCapability']);
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
      observability: jobObservability('jobs/compact-accounts-hourly/diagnostics.json'),
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
        durableAuthority: 'generatedStatusConfigMap',
        releasePolicy: 'v0.3StableGeneratedStatusConfigMapFallback',
        applicationStatusProjection: 'bestEffortNonAuthoritative',
        fallback: 'generatedStatusConfigMap',
        appStatusSchema: 'bestEffort',
        appStatusWrite: appStatusWritePolicy(),
        appStatusSchemaContract: appStatusSchemaContract(),
        durableStore: { apiVersion: 'v1', kind: 'ConfigMap', name: 'accounts-platform-status-reconciler-status' },
        fallbackStore: generatedStatusConfigMapContract(),
        concurrency: generatedStatusConcurrencyContract(),
        observability: generatedStatusObservabilityContract(),
        conflictPolicy: 'mergePatch',
        diagnostics: [{ event: 'applik8s-status-schema-pruned', severity: 'warning', subject: { nodeId: 'job.compact-accounts-hourly' }, reason: 'ApplicationStatusSchemaMayPruneCustomFields', message: 'Persist generated status in a ConfigMap when app CRD status pruning prevents status.applik8s from being durable.', retryable: false }],
      },
      statusShape: statusContract.statusShape,
      failurePolicy: 'failClosed',
      idempotency: scheduledJob.runtime.idempotency,
      diagnostics: [{ event: 'applik8s-job-terminal-failure', severity: 'error', subject: { nodeId: 'job.compact-accounts-hourly' }, reason: 'GeneratedJobFailed', message: 'Generated job reached a terminal failure.', retryable: true }],
    };

    expect(scheduledJob.schedule).toMatchObject({ cron: '0 * * * *', concurrencyPolicy: 'forbid', missedRunPolicy: 'failClosed' });
    expect(scheduledJob.observability).toMatchObject({ health: { mode: 'kubernetesJobStatus' }, sourceMaps: 'notApplicable', diagnosticsArtifact: { kind: 'jobDiagnostics' } });
    expect(scheduledJob.retry).toMatchObject({ mode: 'boundedExponentialBackoff', maxAttempts: 4 });
    expect(scheduledJob.runtime.phaseStatus.statusPath).toBe('status.applik8s.jobs.compactAccountsHourly');
    expect(scheduledJob.runtime.statusLifecycle?.multiJob).toBe('appLevelReconciler');
    expect(scheduledJob.runtime.statusLifecycle?.cronJob).toBe('latestRunAndHistory');
    expect(scheduledJob.runtime.statusLifecycle?.conflictResolution).toEqual({ staleObservedGeneration: 'reject', completedIdempotencyKey: 'retainCompleted', diagnosticsStore: 'conflicts.json' });
    expect(scheduledJob.runtime.statusLifecycle?.terminalFailure).toEqual({ condition: 'Failed', partialEffects: 'required', diagnostics: 'required', history: 'retain' });
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
    expect(validateApplicationGraphStructure({
      ...guestBookSubstrateGraph(),
      nodes: [
        ...guestBookSubstrateGraph().nodes.filter((node) => node.id !== 'job.entry-migration'),
        // typecast: negative fixture deliberately violates the observability metrics contract.
        { ...scheduledJob, observability: { ...scheduledJob.observability, metrics: { mode: 'declaredHooks', names: [] } } as never },
      ],
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application job node job.compact-accounts-hourly observability metrics declaredHooks mode must name emitted hooks.' }),
    ]));
  });

  it('validates durable status ownership so app-status pruning has an explicit fallback contract', () => {
    const ownership: ApplicationDurableStatusOwnershipContract = {
      primary: 'applicationStatus',
      durableAuthority: 'generatedStatusConfigMap',
      releasePolicy: 'v0.3StableGeneratedStatusConfigMapFallback',
      applicationStatusProjection: 'bestEffortNonAuthoritative',
      fallback: 'generatedStatusConfigMap',
      appStatusSchema: 'bestEffort',
      appStatusWrite: appStatusWritePolicy(),
      appStatusSchemaContract: appStatusSchemaContract(),
      durableStore: { apiVersion: 'v1', kind: 'ConfigMap', name: 'accounts-status-reconciler-status' },
      fallbackStore: generatedStatusConfigMapContract(),
      concurrency: generatedStatusConcurrencyContract(),
      observability: generatedStatusObservabilityContract(),
      conflictPolicy: 'mergePatch',
      diagnostics: [{ event: 'applik8s-status-schema-pruned', severity: 'warning', subject: { nodeId: 'job.accounts-model-migration' }, reason: 'ApplicationStatusSchemaMayPruneCustomFields', message: 'KRO-generated app CRDs may prune status.applik8s; use the generated status ConfigMap as durable storage.', retryable: false }],
    };

    expect(validateApplicationDurableStatusOwnershipContract(ownership)).toEqual([]);
    expect(validateApplicationDurableStatusOwnershipContract({ ...ownership, durableAuthority: 'applicationStatus' })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application durable status ownership with bestEffort app status must use generatedStatusConfigMap as the durable authority.' }),
    ]));
    expect(validateApplicationDurableStatusOwnershipContract({ ...ownership, releasePolicy: 'appStatusSchemaRequired' })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application durable status ownership with bestEffort app status must declare the v0.3 stable generatedStatusConfigMap fallback policy.' }),
    ]));
    expect(validateApplicationDurableStatusOwnershipContract({ ...ownership, applicationStatusProjection: 'requiredAuthoritative' })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application durable status ownership with bestEffort app status must declare applicationStatusProjection as bestEffortNonAuthoritative.' }),
    ]));
    expect(validateApplicationDurableStatusOwnershipContract({ ...ownership, appStatusSchema: 'required', durableAuthority: 'generatedStatusConfigMap', releasePolicy: 'v0.3StableGeneratedStatusConfigMapFallback', applicationStatusProjection: 'bestEffortNonAuthoritative' })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application durable status ownership with required app status schema must use applicationStatus as the durable authority.' }),
      expect.objectContaining({ message: 'Application durable status ownership with required app status schema must declare appStatusSchemaRequired release policy.' }),
      expect.objectContaining({ message: 'Application durable status ownership with required app status schema must declare applicationStatusProjection as requiredAuthoritative.' }),
    ]));
    expect(validateApplicationDurableStatusOwnershipContract({ ...ownership, appStatusSchema: 'required', durableAuthority: 'applicationStatus', releasePolicy: 'appStatusSchemaRequired', applicationStatusProjection: 'requiredAuthoritative', appStatusWrite: { mode: 'requiredPatch', failureBehavior: 'failClosed', failureDiagnostic: 'applik8s-job-status-reconciler-app-status-error', durableFallback: 'none' }, appStatusSchemaContract: { ...appStatusSchemaContract(), ownership: 'runtimePatchRequired', pruningBehavior: 'failClosed' } })).toEqual([]);
    const { fallback: _fallback, ...withoutFallback } = ownership;
    expect(validateApplicationDurableStatusOwnershipContract(withoutFallback)).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application durable status ownership with bestEffort app status must declare generatedStatusConfigMap fallback.' }),
    ]));
    const { durableStore: _durableStore, ...withoutDurableStore } = ownership;
    expect(validateApplicationDurableStatusOwnershipContract(withoutDurableStore)).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application durable status ownership with bestEffort app status must name the generatedStatusConfigMap durableStore.' }),
    ]));
    expect(validateApplicationDurableStatusOwnershipContract({ ...withoutDurableStore, primary: 'generatedStatusConfigMap' })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application durable status ownership using a generatedStatusConfigMap primary must declare durableStore.' }),
      expect.objectContaining({ message: 'Application durable status ownership with bestEffort app status must name the generatedStatusConfigMap durableStore.' }),
    ]));
    const { appStatusSchemaContract: _appStatusSchemaContract, ...withoutAppStatusSchemaContract } = ownership;
    expect(validateApplicationDurableStatusOwnershipContract(withoutAppStatusSchemaContract)).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application durable status ownership using application status must declare appStatusSchemaContract.' }),
    ]));
    const { appStatusWrite: _appStatusWrite, ...withoutAppStatusWrite } = ownership;
    expect(validateApplicationDurableStatusOwnershipContract(withoutAppStatusWrite)).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application durable status ownership using application status must declare appStatusWrite policy.' }),
    ]));
    expect(validateApplicationDurableStatusOwnershipContract({ ...ownership, appStatusWrite: { ...appStatusWritePolicy(), failureBehavior: 'failClosed' } })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application durable status ownership with bestEffort app status must diagnose and continue with durable fallback on app status patch failure.' }),
      expect.objectContaining({ message: 'Application app status write bestEffortPatch mode must diagnose and continue with durable fallback.' }),
    ]));
    const { fallbackStore: _fallbackStore, ...withoutFallbackStore } = ownership;
    expect(validateApplicationDurableStatusOwnershipContract(withoutFallbackStore)).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application durable status ownership using generatedStatusConfigMap must declare fallbackStore data ownership.' }),
    ]));
    const { concurrency: _concurrency, ...withoutConcurrency } = ownership;
    expect(validateApplicationDurableStatusOwnershipContract(withoutConcurrency)).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application durable status ownership using generatedStatusConfigMap as durable authority must declare concurrency policy.' }),
    ]));
    expect(validateApplicationDurableStatusOwnershipContract({ ...ownership, concurrency: { ...generatedStatusConcurrencyContract(), maxAttempts: 1 } })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application durable status concurrency requires maxAttempts >= 2.' }),
    ]));
    // typecast: negative fixture deliberately violates the retry exhaustion diagnostic literal contract.
    expect(validateApplicationDurableStatusOwnershipContract({ ...ownership, concurrency: { ...generatedStatusConcurrencyContract(), retryExhaustedDiagnostic: 'applik8s-job-status-reconciler-status-store-conflict-retry' as never } })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application durable status concurrency retryExhaustedDiagnostic must match the generated status store conflict exhaustion event.' }),
    ]));
    const { observability: _observability, ...withoutObservability } = ownership;
    expect(validateApplicationDurableStatusOwnershipContract(withoutObservability)).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application durable status ownership using generatedStatusConfigMap as durable authority must declare observability policy.' }),
    ]));
    expect(validateApplicationDurableStatusOwnershipContract({ ...ownership, observability: { ...generatedStatusObservabilityContract(), metrics: ['acceptedUpdates', 'rejectedUpdates', 'conflictUpdates', 'observedJobs'] } })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application durable status observability must declare merge metric retainedJobs.' }),
    ]));
    expect(validateApplicationDurableStatusOwnershipContract({ ...ownership, fallbackStore: { ...generatedStatusConfigMapContract(), dataKeys: ['status.json', 'applik8s-jobs.json', 'history.json', 'updatedAt'] } })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application generated status ConfigMap fallback must declare runtime-owned data key conflicts.json.' }),
    ]));
    expect(validateApplicationDurableStatusOwnershipContract({ ...ownership, conflictPolicy: 'failClosed', diagnostics: [] })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application durable status ownership with failClosed conflict policy must declare diagnostics.' }),
    ]));
  });

  it('keeps generated job lifecycle conflict policy aligned with durable status ownership', () => {
    const lifecycle: ApplicationJobStatusLifecycleContract = jobStatusLifecycle('job.accounts-model-migration', 'accounts-status-reconciler-status', 'latestRunAndHistory');

    expect(validateApplicationJobStatusLifecycleContract(lifecycle)).toEqual([]);
    expect(validateApplicationJobStatusLifecycleContract({ ...lifecycle, conflictPolicy: 'failClosed' })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application job status lifecycle conflictPolicy must match durable status ownership conflictPolicy.' }),
    ]));
    expect(validateApplicationJobStatusLifecycleContract({ ...lifecycle, historyRetention: { ...lifecycle.historyRetention, maxEntries: 0 } })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application job status lifecycle history retention requires maxEntries >= 1.' }),
    ]));
    expect(validateApplicationJobStatusLifecycleContract({ ...lifecycle, ownership: { ...lifecycle.ownership, fallbackStore: { ...generatedStatusConfigMapContract(), history: { ...generatedStatusConfigMapContract().history, maxEntries: 10 } } } })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application job status lifecycle history retention must match generated status ConfigMap history maxEntries.' }),
    ]));
    // typecast: negative fixture deliberately violates the public lifecycle enum to prove fail-closed validation.
    expect(validateApplicationJobStatusLifecycleContract({ ...lifecycle, conflictResolution: { ...lifecycle.conflictResolution, completedIdempotencyKey: 'replaceFailed' as never } })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application job status lifecycle must retain completed status for the same idempotency key.' }),
    ]));
    // typecast: negative fixture deliberately violates the public terminal-failure enum to prove fail-closed validation.
    expect(validateApplicationJobStatusLifecycleContract({ ...lifecycle, terminalFailure: { ...lifecycle.terminalFailure, partialEffects: 'optional' as never } })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application job status lifecycle terminal failures must include partial effects.' }),
    ]));
  });

  it('labels compatibility surfaces explicitly for the v0.3 freeze boundary', () => {
    const graph = guestBookSubstrateGraph();

    expect(graph.compatibility.labels).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'app.model', surface: 'stablePublicApi', since: 'v0.3' }),
      expect.objectContaining({ name: 'app.config', surface: 'stablePublicApi', since: 'v0.3' }),
      expect.objectContaining({ name: 'app.secret', surface: 'stablePublicApi', since: 'v0.3' }),
      expect.objectContaining({ name: 'app.expose', surface: 'stablePublicApi', since: 'v0.3' }),
      expect.objectContaining({ name: 'ApplicationGraph', surface: 'documentedInternalContract', since: 'v0.3' }),
      expect.objectContaining({ name: 'provider.postgres', surface: 'stablePublicApi', since: 'v0.3' }),
      expect.objectContaining({ name: 'provider.Queue', surface: 'stablePublicApi', since: 'v0.3', implementation: 'failClosedReserved' }),
      expect.objectContaining({ name: 'workload-movement-operator', surface: 'postV3Surface' }),
    ]));
  });

  it('rejects stable public API compatibility policy drift', () => {
    const graph = guestBookSubstrateGraph();
    const completeGraph: ApplicationGraph = graph;
    expect(validateApplicationGraphCompatibilityPolicy(completeGraph)).toEqual([]);

    const unlabeled: ApplicationGraph = { ...completeGraph, compatibility: { ...completeGraph.compatibility, stablePublicApis: [...completeGraph.compatibility.stablePublicApis, 'provider.Secret'] } };
    expect(validateApplicationGraphCompatibilityPolicy(unlabeled)).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application graph stable public API provider.Secret must have a stablePublicApi compatibility label.' }),
    ]));

    const missingFailClosed: ApplicationGraph = {
      ...completeGraph,
      compatibility: {
        ...completeGraph.compatibility,
        labels: completeGraph.compatibility.labels.map((label) => label.name === 'provider.Queue'
          ? { name: 'provider.Queue', surface: 'stablePublicApi', since: 'v0.3', rationale: 'Reserved provider API not implemented yet.', implementation: 'failClosedReserved' }
          : label),
      },
    };
    expect(validateApplicationGraphCompatibilityPolicy(missingFailClosed)).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application graph stable public API provider.Queue describes missing implementation without documented fail-closed behavior.' }),
      expect.objectContaining({ message: 'Application graph stable public API provider.Queue is fail-closed reserved but has no release-facing diagnostics.' }),
    ]));

    const missingImplementation: ApplicationGraph = {
      ...completeGraph,
      compatibility: {
        ...completeGraph.compatibility,
        stablePublicApis: [...completeGraph.compatibility.stablePublicApis, 'provider.Secret'],
        labels: [...completeGraph.compatibility.labels, { name: 'provider.Secret', surface: 'stablePublicApi', since: 'v0.3', rationale: 'Secret provider implementation.' }],
      },
    };
    expect(validateApplicationGraphCompatibilityPolicy(missingImplementation)).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application graph stable public API provider.Secret must declare implementation support.' }),
    ]));

    const unstableStableApiNode: ApplicationGraph = {
      ...completeGraph,
      nodes: completeGraph.nodes.map((node) => node.id === 'model.entry' ? { ...node, stability: 'experimental' } : node),
    };
    expect(validateApplicationGraphCompatibilityPolicy(unstableStableApiNode)).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application graph node model.entry is emitted by stable public API app.model but has experimental stability.' }),
    ]));

    const firstLabel = completeGraph.compatibility.labels[0];
    if (!firstLabel) {
      throw new Error('test fixture missing compatibility label');
    }
    expect(validateApplicationGraphCompatibilityPolicy({
      ...completeGraph,
      compatibility: { ...completeGraph.compatibility, labels: [...completeGraph.compatibility.labels, firstLabel] },
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: `Application graph compatibility label ${firstLabel.name} is declared more than once.` }),
    ]));

    expect(validateApplicationGraphCompatibilityPolicy({
      ...completeGraph,
      compatibility: { ...completeGraph.compatibility, experimentalSurfaces: ['app.graph'] },
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application graph experimental surface app.graph must have a experimentalSurface compatibility label.' }),
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

  it('keeps generated server and generated job operation-target dry-run honest at the freeze boundary', () => {
    const generatedRuntimeTarget: ApplicationOperationTargetContract = {
      id: 'operation-target.generated-runtime-tenant-stack',
      target: { nodeId: 'typeKroResource.tenant-stack' },
      operations: ['apply', 'delete'],
      execution: { contexts: ['generatedServer', 'generatedJob'], ordering: 'dependencyAware', runtimeValidation: 'beforeEffects', failurePolicy: 'failClosed' },
      lowering: { mode: 'typeKroResource', artifact: { kind: 'typeKroResource', path: 'plans/tenant-stack.apply.json' }, failurePolicy: 'failClosed' },
      dryRun: { supported: true, artifact: { kind: 'typeKroResource', path: 'plans/tenant-stack.dry-run.json' }, failurePolicy: 'failClosed' },
      ownership: { ownerReferences: 'required', orphanPolicy: 'retain' },
      finalizers: { required: false, cleanupOperation: 'deleteTarget' },
      permissions: [{ apiGroups: ['platform.applik8s.dev'], resources: ['tenantstacks'], verbs: ['create', 'patch', 'delete'] }],
      diagnostics: [],
    };
    const missingGeneratedRuntimeDryRun: ApplicationOperationTargetContract = {
      ...generatedRuntimeTarget,
      dryRun: { supported: true, failurePolicy: 'failClosed' },
      diagnostics: [{ event: 'applik8s-operation-target-invalid', severity: 'error', subject: { nodeId: 'typeKroResource.tenant-stack' }, reason: 'OperationTargetDryRunArtifactMissing', message: 'Generated server/job dry-run planning requires a dry-run artifact and fails closed when absent.', retryable: false }],
    };

    expect(validateApplicationOperationTargetContract(generatedRuntimeTarget)).toEqual([]);
    expect(generatedRuntimeTarget.execution?.contexts).toEqual(['generatedServer', 'generatedJob']);
    expect(generatedRuntimeTarget.dryRun.artifact?.path).toBe('plans/tenant-stack.dry-run.json');
    expect(validateApplicationOperationTargetContract(missingGeneratedRuntimeDryRun)).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application operation target operation-target.generated-runtime-tenant-stack supports dry-run but does not declare a dry-run artifact.' }),
      expect.objectContaining({ message: 'Application operation target operation-target.generated-runtime-tenant-stack used by generated server/job contexts must declare an artifact-backed dry-run plan.' }),
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
      provider: { interface: 'TransactionalDatabase', nodeId: 'provider.transactional-database' },
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
      requiredProviders: [...applicationV03ProviderInterfaceKinds],
      requiredRuntimeModules: ['serverRuntime', 'modelRuntime', 'jobRunnerRuntime', 'kubernetesClient', 'diagnostics', 'providerAdapter'],
      requiredOperationTargets: [{ id: 'operation-target.tenant-stack', target: { nodeId: 'typeKroResource.tenant-stack' }, operations: ['apply', 'delete'], execution: { contexts: ['handler', 'generatedJob', 'generatedServer', 'typeKro'], ordering: 'dependencyAware', runtimeValidation: 'beforeEffects', failurePolicy: 'failClosed' }, lowering: { mode: 'typeKroResource', artifact: { kind: 'typeKroResource', path: 'plans/tenant-stack.apply.json' }, failurePolicy: 'failClosed' }, dryRun: { supported: true, artifact: { kind: 'typeKroResource', path: 'plans/tenant-stack.dry-run.json' }, failurePolicy: 'failClosed' }, ownership: { ownerReferences: 'required', orphanPolicy: 'retain' }, finalizers: { required: true, finalizer: 'platform.applik8s.dev/tenant-stack', cleanupOperation: 'deleteTarget' }, permissions: [{ apiGroups: ['platform.applik8s.dev'], resources: ['tenantstacks'], verbs: ['create', 'patch', 'delete'] }], diagnostics: [] }],
      requiredWatchScopes: [
        { scope: { kind: 'labelSelector', apiVersion: 'apps/v1', resourceKind: 'Deployment', labels: { 'tenant.applik8s.dev/name': 'tenant-a' } }, lowering: 'labelSelector', runtime: { mode: 'sharedInformer', resyncPolicy: 'bounded', cancellation: 'onScopeRemoved' }, permissions: [{ apiGroups: ['apps'], resources: ['deployments'], verbs: ['list', 'watch'] }], failurePolicy: 'failClosed', diagnostics: [] },
        { scope: { kind: 'labelSelector', apiVersion: 'apps/v1', resourceKind: 'Deployment', labels: {} }, lowering: 'labelSelector', permissions: [], failurePolicy: 'failClosed', diagnostics: [{ event: 'applik8s-watch-scope-unlowerable', severity: 'error', subject: { apiVersion: 'apps/v1', kind: 'Deployment' }, reason: 'UnsupportedLabelSelectorExpression', message: 'Unsupported watch predicate fails closed instead of broadening runtime watches.', retryable: false }] },
      ],
      requiredMigrationDriftChecks: [{ model: { nodeId: 'model.account' }, provider: { interface: 'TransactionalDatabase', nodeId: 'provider.transactional-database' }, observedSchemaSource: { apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster', name: 'accounts-db' }, expectedRevision: 'sha256:accounts-schema-v1', policy: { mode: 'explicitPlanRequired', destructiveChangePolicy: 'reject', driftPolicy: 'failClosed' }, enforcement: { stage: 'preMigration', historyTable: 'applik8s_model_migrations', lock: 'providerNative', failurePolicy: 'failClosed' }, failureModes: ['incompatibleIndex', 'destructiveChange'], diagnostics: [{ event: 'applik8s-model-migration-drift-detected', severity: 'error', subject: { nodeId: 'model.account' }, reason: 'SchemaDriftDetected', message: 'Schema drift blocks migration.', retryable: false }] }],
      requiredTransactionalDatabaseSemantics: [transactionalDatabaseSemantics()],
      requiredRuntimeModuleInterfaces: [runtimeModuleInterface([{ kind: 'modelRuntime', name: 'postgres-models' }, { kind: 'diagnostics', name: 'diagnostics' }], [{ name: 'createServerRuntime', kind: 'function', stability: 'stable' }], 'required')],
      requiredProviderInterfaces: [...new Set([...applicationProviderInterfaceKinds, ...applicationV03ProviderInterfaceKinds])].map((provider) => ({ interface: provider, surface: 'stablePublicApi', support: 'implemented', diagnostics: [] })),
      providerCompatibility: providerCompatibilityMatrix(),
      requiredStatusOwnership: [{ primary: 'applicationStatus', durableAuthority: 'generatedStatusConfigMap', releasePolicy: 'kroStatusProjectionRequired', applicationStatusProjection: 'requiredAuthoritative', appStatusSchema: 'required', appStatusSchemaContract: { statusRoot: 'status.applik8s', jobsPath: 'status.applik8s.jobs', schema: 'generatedJobStatusMap', ownership: 'kroStatusProjection', pruningBehavior: 'failClosed' }, durableStore: { apiVersion: 'v1', kind: 'ConfigMap', name: 'tenant-platform-pressure-test-status-reconciler-status' }, fallbackStore: { ...generatedStatusConfigMapContract(), objectOwnership: 'runtimeCreatedResource' }, concurrency: generatedStatusConcurrencyContract(), observability: generatedStatusObservabilityContract(), conflictPolicy: 'mergePatch', diagnostics: [{ event: 'applik8s-status-projection-unavailable', severity: 'error', subject: { nodeId: 'job.accounts-model-migration' }, reason: 'KroStatusProjectionRequired', message: 'KRO-owned status hydration is required.', retryable: false }] }],
      requiredStatusEvidence: statusEvidence(),
      requiredTransactionalDatabaseEvidence: transactionalDatabaseEvidence(),
      requiredOperationTargetEvidence: operationTargetEvidence(),
      requiredWatchScopeEvidence: watchScopeEvidence(),
      runtimeReleasePolicy: runtimeReleasePolicy(),
      liveValidation: { contextEnv: 'APPLIK8S_E2E_CONTEXT', requiredResources: [{ apiVersion: 'batch/v1', kind: 'Job', name: 'accounts-model-migration' }, { apiVersion: 'apps/v1', kind: 'Deployment', name: 'admin' }, { apiVersion: 'v1', kind: 'ConfigMap', name: 'tenant-platform-status-reconciler-status' }], requiredAssertions: ['migration job completes', 'server becomes ready', 'model create/query works', 'duplicate key returns 409', 'durable job status is persisted', 'migration drift fails closed', 'operation-target dry-run is artifact-backed', 'scoped listener routes watched objects', 'unsupported watch predicates fail closed'] },
    };

    expect(pressureTest.graph.digest).toBe(graphDigest);
    expect(pressureTest.requiredNodes).toEqual(expect.arrayContaining(['model', 'server', 'job', 'provider']));
    expect(pressureTest.requiredRuntimeModules).toContain('jobRunnerRuntime');
    expect(pressureTest.liveValidation?.requiredAssertions).toContain('durable job status is persisted');
    expect(validateApplicationV03PressureTestContract(pressureTest)).toEqual([]);
    // typecast: deliberately bypass literal evidence contracts to prove malformed v0.3 release evidence is rejected at runtime.
    expect(validateApplicationV03PressureTestContract({ ...pressureTest, graph: { ...pressureTest.graph, digest: '' }, requiredRuntimeModules: ['serverRuntime'], requiredProviders: ['TransactionalDatabase'], requiredTransactionalDatabaseSemantics: [], requiredRuntimeModuleInterfaces: [], requiredStatusOwnership: [], requiredStatusEvidence: { ...pressureTest.requiredStatusEvidence, multiJobCronJobCoverage: 'missing' as never }, requiredTransactionalDatabaseEvidence: { ...pressureTest.requiredTransactionalDatabaseEvidence, migrationDriftCoverage: 'missing' as never }, requiredOperationTargetEvidence: { ...pressureTest.requiredOperationTargetEvidence, contexts: ['handler'] }, requiredWatchScopeEvidence: { ...pressureTest.requiredWatchScopeEvidence, broadWatchFallback: 'allowed' as never }, runtimeReleasePolicy: { ...pressureTest.runtimeReleasePolicy, startupPackageManager: true as never }, liveValidation: { contextEnv: '', requiredResources: [], requiredAssertions: ['migration job completes'] } })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application v0.3 pressure test tenant-platform-pressure-test must reference an emitted application graph artifact path and digest.' }),
      expect.objectContaining({ message: 'Application v0.3 pressure test tenant-platform-pressure-test must require CredentialStore.' }),
      expect.objectContaining({ message: 'Application v0.3 pressure test tenant-platform-pressure-test must require modelRuntime.' }),
      expect.objectContaining({ message: 'Application v0.3 pressure test tenant-platform-pressure-test must require TransactionalDatabase semantic conformance.' }),
      expect.objectContaining({ message: 'Application v0.3 pressure test tenant-platform-pressure-test must require runtime module interface contracts.' }),
      expect.objectContaining({ message: 'Application v0.3 pressure test tenant-platform-pressure-test must require durable generated-job status ownership.' }),
      expect.objectContaining({ message: 'Application v0.3 pressure test tenant-platform-pressure-test live validation must name the context environment variable.' }),
      expect.objectContaining({ message: 'Application v0.3 pressure test tenant-platform-pressure-test live validation must require Kubernetes resources.' }),
      expect.objectContaining({ message: 'Application v0.3 pressure test tenant-platform-pressure-test live validation must assert model create/query works.' }),
      expect.objectContaining({ message: 'Application v0.3 pressure test tenant-platform-pressure-test live validation must assert unsupported watch predicates fail closed.' }),
      expect.objectContaining({ message: 'Application v0.3 pressure test tenant-platform-pressure-test durable status evidence must require multi-job and CronJob coverage.' }),
      expect.objectContaining({ message: 'Application v0.3 pressure test tenant-platform-pressure-test TransactionalDatabase evidence must require migration drift coverage.' }),
      expect.objectContaining({ message: 'Application v0.3 pressure test tenant-platform-pressure-test operation-target evidence must cover generatedServer.' }),
      expect.objectContaining({ message: 'Application v0.3 pressure test tenant-platform-pressure-test watch-scope evidence must forbid broad-watch fallback.' }),
      expect.objectContaining({ message: 'Application v0.3 pressure test tenant-platform-pressure-test runtime release policy must forbid startup package managers.' }),
    ]));
    expect(validateApplicationV03PressureTestContract({ ...pressureTest, requiredWatchScopes: pressureTest.requiredWatchScopes.filter((scope) => scope.diagnostics.length === 0) })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application v0.3 pressure test tenant-platform-pressure-test must include fail-closed evidence for unlowerable watch scopes.' }),
    ]));
    expect(validateApplicationV03PressureTestContract({ ...pressureTest, requiredStatusEvidence: { ...pressureTest.requiredStatusEvidence, authoritativeStore: 'generatedStatusConfigMap' } })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application v0.3 pressure test tenant-platform-pressure-test authoritative status evidence must match the primary status read surface.' }),
    ]));
    expect(validateApplicationV03PressureTestContract({ ...pressureTest, requiredTransactionalDatabaseSemantics: [{ ...transactionalDatabaseSemantics(), scriptRuntimeParity: 'notSupported' }] })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application v0.3 pressure test tenant-platform-pressure-test TransactionalDatabase evidence requires script-runtime parity but no TransactionalDatabase semantics require it.' }),
    ]));
    expect(validateApplicationV03PressureTestContract({ ...pressureTest, requiredTransactionalDatabaseSemantics: [{ ...transactionalDatabaseSemantics(), transactions: { ...transactionalDatabaseSemantics().transactions, multiOperationApi: 'absentFromPublicApi', multiOperationBehavior: 'methodAbsent' } }] })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application v0.3 pressure test tenant-platform-pressure-test TransactionalDatabase evidence requires transaction coverage but no TransactionalDatabase semantics declare runtime transactions.' }),
    ]));
    expect(validateApplicationV03PressureTestContract({ ...pressureTest, requiredOperationTargets: pressureTest.requiredOperationTargets.map(({ execution: _execution, ...target }) => target) })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application v0.3 pressure test tenant-platform-pressure-test must include operation-target execution contract for handler.' }),
      expect.objectContaining({ message: 'Application v0.3 pressure test tenant-platform-pressure-test must include operation-target execution contract for generatedServer.' }),
    ]));
  });

  it('defines provider requirement and binding contracts before provider implementation', () => {
    const requirement: ApplicationProviderRequirement<'TransactionalDatabase'> = {
      id: 'requirement.model.entry.database',
      interface: 'TransactionalDatabase',
      consumer: { nodeId: 'model.entry' },
      required: true,
      purpose: 'transactionalDatabase',
      diagnostics: {
        missing: 'Model GuestBookEntry requires a TransactionalDatabase provider. Bind one with app.provide(TransactionalDatabase, ...) or app.defaults({ database: ... }).',
        ambiguous: 'Model GuestBookEntry has multiple TransactionalDatabase providers. Bind the model to one provider explicitly.',
      },
    };
    const binding: ApplicationProviderBindingContract<'TransactionalDatabase'> = {
      requirement: requirement.id,
      provider: { interface: 'TransactionalDatabase', nodeId: 'provider.transactional-database.postgres' },
      generatedResources: [{ apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster', name: 'guestbook-db' }],
      runtime: {
        env: { APPLIK8S_MODEL_PROVIDER: 'postgres' },
        secretRefs: [{ apiVersion: 'v1', kind: 'Secret', name: 'guestbook-db-app' }],
        permissions: [{ apiGroups: [''], resources: ['secrets'], verbs: ['get'], resourceNames: ['guestbook-db-app'] }],
      },
    };

    expect(requirement.interface).toBe('TransactionalDatabase');
    expect(requirement.diagnostics.missing).toContain('app.provide(TransactionalDatabase');
    expect(binding.generatedResources[0]).toMatchObject({ kind: 'Cluster', name: 'guestbook-db' });
    expect(binding.runtime.permissions?.[0]?.resources).toEqual(['secrets']);
  });

  it('validates provider bindings from the graph contract before lowering', () => {
    const graph = guestBookSubstrateGraph();
    expect(validateApplicationGraphProviderBindings(graph)).toEqual([]);

    const missingProvider: ApplicationGraph = {
      ...graph,
      nodes: graph.nodes.filter((node) => node.id !== 'provider.transactional-database.postgres'),
    };
    expect(validateApplicationGraphProviderBindings(missingProvider)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'error',
        code: 'COMPATIBILITY_FAILED',
        message: expect.stringContaining('requires TransactionalDatabase provider provider.transactional-database.postgres'),
      }),
    ]));

    const mismatchedProvider: ApplicationGraph = {
      ...graph,
      nodes: graph.nodes.map((node) => node.id === 'provider.transactional-database.postgres' ? { ...node, interface: 'IndexStore' } : node),
    };
    expect(validateApplicationGraphProviderBindings(mismatchedProvider)).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.stringContaining('but the provider node implements IndexStore') }),
    ]));
  });

  it('validates provider node release contracts before lowering', () => {
    const graph = guestBookSubstrateGraph();
    const provider = graph.nodes.find((node): node is ApplicationProviderNode => node.kind === 'provider' && node.id === 'provider.transactional-database.postgres');
    if (!provider) {
      throw new Error('test fixture missing provider.transactional-database.postgres');
    }
    if (!provider.contract) {
      throw new Error('test fixture missing provider.transactional-database.postgres contract');
    }

    expect(validateApplicationGraphStructure(graph)).toEqual([]);
    expect(validateApplicationGraphStructure({
      ...graph,
      nodes: graph.nodes.map((node) => node.id === provider.id
        // typecast: malformed fixture intentionally bypasses generic provider contract typing to prove graph validation rejects interface drift.
        ? { ...provider, contract: { ...provider.contract, interface: 'IndexStore' } as never }
        : node),
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application provider node provider.transactional-database.postgres contract interface IndexStore must match provider interface TransactionalDatabase.' }),
    ]));
    expect(validateApplicationGraphStructure({
      ...graph,
      nodes: graph.nodes.map((node) => node.id === provider.id
        // typecast: malformed fixture intentionally bypasses generic provider contract typing to prove graph validation rejects reserved-contract drift.
        ? { ...provider, contract: { interface: 'Queue', surface: 'stablePublicApi', support: 'failClosedReserved', diagnostics: [] } as never }
        : node),
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application provider node provider.transactional-database.postgres contract interface Queue must match provider interface TransactionalDatabase.' }),
      expect.objectContaining({ message: 'Application provider interface Queue is stable but fail-closed reserved without diagnostics.' }),
    ]));
  });

  it('keeps generated job status paths aligned with declared app status ownership', () => {
    const graph = guestBookSubstrateGraph();
    const job = graph.nodes.find((node): node is GeneratedJobContract => node.kind === 'job' && node.id === 'job.entry-migration');
    if (!job) {
      throw new Error('test fixture missing job.entry-migration');
    }

    expect(validateApplicationGraphStructure(graph)).toEqual([]);
    expect(validateApplicationGraphStructure({
      ...graph,
      nodes: graph.nodes.map((node) => node.id === job.id && node.kind === 'job'
        ? { ...node, runtime: { ...node.runtime, phaseStatus: { ...node.runtime.phaseStatus, statusPath: 'status.jobs.entryMigration' } } }
        : node),
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application job node job.entry-migration phaseStatus.statusPath must be nested under status.applik8s.jobs.' }),
    ]));
    expect(validateApplicationGraphStructure({
      ...graph,
      nodes: graph.nodes.map((node) => node.id === job.id && node.kind === 'job'
        ? { ...node, runtime: { ...node.runtime, durableStatusUpdater: { runtimeModule: { kind: 'jobRunnerRuntime', name: 'generated-job-status-updater' }, observes: [{ apiVersion: 'batch/v1', kind: 'Job', name: 'entry-migration' }], writes: { ...node.runtime.phaseStatus, statusPath: 'status.applik8s.jobs.other' }, statusShape: { phase: 'Pending', observedGeneration: 0, idempotencyKey: 'entry-migration', retryCount: 0, conditions: [] }, failurePolicy: 'failClosed', idempotency: node.runtime.idempotency, diagnostics: [] } } }
        : node),
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application job node job.entry-migration durable status updater must write the same statusPath as runtime.phaseStatus.' }),
    ]));
  });

  it('validates generated server route/action diagnostics before lowering', () => {
    const graph = guestBookSubstrateGraph();
    const server = graph.nodes.find((node) => node.kind === 'server' && node.id === 'server.web');
    if (server?.kind !== 'server') {
      throw new Error('test fixture missing server.web');
    }

    expect(validateApplicationGraphStructure(graph)).toEqual([]);
    expect(validateApplicationGraphStructure({
      ...graph,
      nodes: graph.nodes.map((node) => node.id === server.id && node.kind === 'server'
        ? { ...node, routes: node.routes.map((route) => {
          const { diagnostics: _diagnostics, ...withoutDiagnostics } = route;
          return withoutDiagnostics;
        }) }
        : node),
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application server route server.web.get-index-0 must declare route diagnostics.' }),
    ]));
    expect(validateApplicationGraphStructure({
      ...graph,
      nodes: graph.nodes.map((node) => node.id === server.id && node.kind === 'server'
        ? { ...node, routes: node.routes.map((route) => ({ ...route, diagnostics: { ...routeDiagnosticsContract(), includes: ['routeId', 'method', 'path'] } })) }
        : node),
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application route diagnostics server.web.get-index-0 must include action.' }),
      expect.objectContaining({ message: 'Application route diagnostics server.web.get-index-0 must include stack.' }),
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
          database: { interface: 'TransactionalDatabase', nodeId: 'provider.transactional-database.postgres' },
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
            provider: { interface: 'TransactionalDatabase', nodeId: 'provider.transactional-database.postgres-replica' },
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
          observability: jobObservability('jobs/bad-retry/diagnostics.json'),
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
          observability: jobObservability('jobs/bad-schedule/diagnostics.json'),
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
          observability: jobObservability('jobs/missing-schedule/diagnostics.json'),
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
      expect.objectContaining({ message: 'Application model node model.ttl-entry has inconsistent TransactionalDatabase refs between database and materialization.provider.' }),
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
      nodes: guestBookSubstrateGraph().nodes.filter((node) => node.id !== 'provider.transactional-database.postgres'),
      edges: [
        ...guestBookSubstrateGraph().edges,
        { from: { nodeId: 'job.missing' }, to: { nodeId: 'model.entry' }, relationship: 'dependsOn' },
      ],
    };

    expect(validateApplicationGraph(graph)).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Application graph edge job.missing:dependsOn:model.entry references missing source node job.missing.' }),
      expect.objectContaining({ message: expect.stringContaining('Application graph node model.entry requires TransactionalDatabase provider provider.transactional-database.postgres') }),
    ]));
  });

  it('validates explicit provider requirements and requirement consumers before lowering', () => {
    const graph = guestBookSubstrateGraph();
    const explicitRequirement: ApplicationProviderRequirement<'TransactionalDatabase'> = {
      id: 'requirement.model.entry.database',
      interface: 'TransactionalDatabase',
      consumer: { nodeId: 'model.entry' },
      provider: { interface: 'TransactionalDatabase', nodeId: 'provider.transactional-database.postgres' },
      required: true,
      purpose: 'transactionalDatabase',
      diagnostics: {
        missing: 'Model GuestBookEntry requires a TransactionalDatabase provider.',
        ambiguous: 'Model GuestBookEntry has multiple TransactionalDatabase providers.',
      },
    };

    expect(validateApplicationGraphProviderBindings(graph, [explicitRequirement])).toEqual([]);

    expect(validateApplicationGraphProviderBindings(graph, [{
      ...explicitRequirement,
      provider: { interface: 'TransactionalDatabase', nodeId: 'provider.transactional-database.missing' },
    }])).toEqual([
      expect.objectContaining({ message: 'Application provider requirement requirement.model.entry.database requires TransactionalDatabase provider provider.transactional-database.missing, but that provider node is missing.' }),
    ]);

    expect(validateApplicationGraphProviderBindings(graph, [{
      ...explicitRequirement,
      consumer: { nodeId: 'model.missing' },
    }])).toEqual([
      expect.objectContaining({ message: 'Application provider requirement requirement.model.entry.database references missing consumer model.missing.' }),
    ]);
  });

  it('validates missing and ambiguous provider requirements from graph providers', () => {
    const requirement: ApplicationProviderRequirement<'TransactionalDatabase'> = {
      id: 'requirement.model.entry.database',
      interface: 'TransactionalDatabase',
      consumer: { nodeId: 'model.entry' },
      required: true,
      purpose: 'transactionalDatabase',
      diagnostics: {
        missing: 'Model GuestBookEntry requires a TransactionalDatabase provider.',
        ambiguous: 'Model GuestBookEntry has multiple TransactionalDatabase providers.',
      },
    };
    const graph = guestBookSubstrateGraph();

    expect(validateApplicationGraphProviderBindings({ ...graph, nodes: graph.nodes.filter((node) => node.kind !== 'provider'), providerRequirements: [], providerBindings: [] }, [requirement])).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Model GuestBookEntry requires a TransactionalDatabase provider.' }),
    ]));
    expect(validateApplicationGraphProviderBindings({
      ...graph,
      providerRequirements: [],
      providerBindings: [],
      nodes: [
        ...graph.nodes,
        { id: 'provider.transactional-database.postgres-replica', kind: 'provider', name: 'postgres-replica', stability: 'stable', interface: 'TransactionalDatabase', implementation: 'postgres' },
      ],
    }, [requirement])).toEqual([
      expect.objectContaining({ message: 'Model GuestBookEntry has multiple TransactionalDatabase providers.' }),
    ]);
  });

  it('resolves provider requirements explicitly and by interface before adapters exist', () => {
    const graph = guestBookSubstrateGraph();
    const requirement = transactionalDatabaseRequirement();

    expect(resolveApplicationGraphProviderRequirement(graph, requirement)).toMatchObject({
      status: 'resolved',
      provider: { id: 'provider.transactional-database.postgres', interface: 'TransactionalDatabase', implementation: 'postgres' },
      diagnostics: [],
    });
    expect(resolveApplicationGraphProviderRequirement(graph, {
      ...requirement,
      provider: { interface: 'TransactionalDatabase', nodeId: 'provider.transactional-database.postgres' },
    })).toMatchObject({
      status: 'resolved',
      provider: { id: 'provider.transactional-database.postgres' },
      diagnostics: [],
    });
  });

  it('fails provider resolution closed for missing, ambiguous, invalid consumer, and invalid explicit provider cases', () => {
    const graph = guestBookSubstrateGraph();
    const requirement = transactionalDatabaseRequirement();
    const replicaProvider: ApplicationProviderNode<'TransactionalDatabase'> = {
      id: 'provider.transactional-database.postgres-replica',
      kind: 'provider',
      name: 'postgres-replica',
      stability: 'stable',
      interface: 'TransactionalDatabase',
      implementation: 'postgres',
    };
    const missing = resolveApplicationGraphProviderRequirement({ ...graph, nodes: graph.nodes.filter((node) => node.kind !== 'provider') }, requirement);
    const ambiguous = resolveApplicationGraphProviderRequirement({ ...graph, nodes: [...graph.nodes, replicaProvider] }, requirement);
    const invalidConsumer = resolveApplicationGraphProviderRequirement(graph, { ...requirement, consumer: { nodeId: 'model.missing' } });
    const invalidProvider = resolveApplicationGraphProviderRequirement(graph, { ...requirement, provider: { interface: 'TransactionalDatabase', nodeId: 'provider.transactional-database.missing' } });
    const invalidProviderInterface = resolveApplicationGraphProviderRequirement(graph, {
      ...requirement,
      // typecast: this malformed requirement simulates corrupted serialized graph input that bypasses TypeScript.
      provider: { interface: 'IndexStore', nodeId: 'provider.transactional-database.postgres' } as never,
    });

    expect(missing).toMatchObject({ status: 'missing', candidates: [], diagnostics: [expect.objectContaining({ message: 'Model GuestBookEntry requires a TransactionalDatabase provider.' })] });
    expect(ambiguous).toMatchObject({ status: 'ambiguous', candidates: [expect.objectContaining({ id: 'provider.transactional-database.postgres' }), expect.objectContaining({ id: 'provider.transactional-database.postgres-replica' })] });
    expect(invalidConsumer).toMatchObject({ status: 'invalidConsumer', candidates: [], diagnostics: [expect.objectContaining({ message: 'Application provider requirement requirement.model.entry.database references missing consumer model.missing.' })] });
    expect(invalidProvider).toMatchObject({ status: 'invalidProvider', candidates: [], diagnostics: [expect.objectContaining({ message: 'Application provider requirement requirement.model.entry.database requires TransactionalDatabase provider provider.transactional-database.missing, but that provider node is missing.' })] });
    expect(invalidProviderInterface).toMatchObject({
      status: 'invalidProvider',
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ message: 'Application provider requirement requirement.model.entry.database requires TransactionalDatabase, but its explicit provider ref is for IndexStore.' }),
        expect.objectContaining({ message: 'Application provider requirement requirement.model.entry.database requires IndexStore provider provider.transactional-database.postgres, but the provider node implements TransactionalDatabase.' }),
      ]),
    });
  });

  it('defines model materialization and generated job runtime contracts before implementation', () => {
    const modelMaterialization: ApplicationModelMaterializationContract = {
      mode: 'providerBacked',
      provider: { interface: 'TransactionalDatabase', nodeId: 'provider.transactional-database.postgres' },
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

function transactionalDatabaseRequirement(): ApplicationProviderRequirement<'TransactionalDatabase'> {
  return {
    id: 'requirement.model.entry.database',
    interface: 'TransactionalDatabase',
    consumer: { nodeId: 'model.entry' },
    required: true,
    purpose: 'transactionalDatabase',
    diagnostics: {
      missing: 'Model GuestBookEntry requires a TransactionalDatabase provider.',
      ambiguous: 'Model GuestBookEntry has multiple TransactionalDatabase providers.',
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

function providerCompatibilityMatrix(): ApplicationProviderCompatibilityMatrixContract {
  const providers = [...new Set([...applicationProviderInterfaceKinds, ...applicationV03ProviderInterfaceKinds])];
  return {
    apiVersion: 'applik8s.providerCompatibility/v1alpha1',
    requiredForV03: applicationV03ProviderInterfaceKinds,
    providers: providers.map((provider) => ({ interface: provider, surface: 'stablePublicApi', support: 'implemented', diagnostics: [] })),
  };
}

function transactionalDatabaseSemantics(): ApplicationTransactionalDatabaseSemanticsContract {
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

function statusEvidence(): ApplicationV03PressureTestContract['requiredStatusEvidence'] {
  return {
    authoritativeStore: 'applicationStatus',
    appStatusProjection: 'requiredAuthoritative',
    history: 'boundedRetained',
    conflictBehavior: 'resourceVersionRetryAndExhaustionDiagnostics',
    restartSafety: 'required',
    multiJobCronJobCoverage: 'required',
    metrics: ['acceptedUpdates', 'rejectedUpdates', 'conflictUpdates', 'observedJobs', 'retainedJobs'],
    liveGate: 'requiredBeforeAnnouncement',
    failurePolicy: 'failClosed',
  };
}

function transactionalDatabaseEvidence(): ApplicationV03PressureTestContract['requiredTransactionalDatabaseEvidence'] {
  return {
    generatedRuntimeParity: 'localGeneratedArtifactGate',
    scriptRuntimeParity: 'localAndOptInLiveGate',
    liveGate: 'requiredBeforeAnnouncement',
    queryIndexConstraintCoverage: 'required',
    transactionCoverage: 'required',
    migrationDriftCoverage: 'required',
    unsupportedSemantics: 'failClosed',
  };
}

function operationTargetEvidence(): ApplicationV03PressureTestContract['requiredOperationTargetEvidence'] {
  return {
    contexts: ['handler', 'generatedServer', 'generatedJob', 'typeKro'],
    dryRunPlans: 'artifactBackedRequired',
    generatedServerJobExecution: 'required',
    typeKroExecution: 'required',
    rbacAndFinalizerCoverage: 'required',
    failurePolicy: 'failClosed',
  };
}

function watchScopeEvidence(): ApplicationV03PressureTestContract['requiredWatchScopeEvidence'] {
  return {
    lowerings: ['exact', 'finite', 'labelSelector', 'fieldSelector', 'mixed'],
    unsupportedPredicateDiagnostics: 'generatedArtifactAndLiveGateRequired',
    runtimeRouting: 'required',
    broadWatchFallback: 'forbidden',
    failurePolicy: 'failClosed',
  };
}

function runtimeReleasePolicy(): ApplicationV03PressureTestContract['runtimeReleasePolicy'] {
  return {
    startupPackageManager: false,
    dependencyInstallation: 'buildTimeOnly',
    runtimeImage: 'explicitImageOrGeneratedRecipe',
    supplyChain: 'metadataOnlyUntilSignedArtifacts',
    signedArtifacts: 'postV03',
    failurePolicy: 'failClosed',
  };
}

function appStatusSchemaContract(): NonNullable<ApplicationDurableStatusOwnershipContract['appStatusSchemaContract']> {
  return {
    statusRoot: 'status.applik8s',
    jobsPath: 'status.applik8s.jobs',
    schema: 'generatedJobStatusMap',
    ownership: 'runtimePatchBestEffort',
    pruningBehavior: 'fallbackToGeneratedStatusConfigMap',
  };
}

function appStatusWritePolicy(): NonNullable<ApplicationDurableStatusOwnershipContract['appStatusWrite']> {
  return {
    mode: 'bestEffortPatch',
    failureBehavior: 'diagnoseAndContinueWithDurableFallback',
    failureDiagnostic: 'applik8s-job-status-reconciler-app-status-error',
    durableFallback: 'generatedStatusConfigMap',
  };
}

function generatedStatusConfigMapContract(): NonNullable<ApplicationDurableStatusOwnershipContract['fallbackStore']> {
  return {
    objectOwnership: 'generatedResource',
    dataOwnership: 'runtime',
    dataKeys: ['status.json', 'applik8s-jobs.json', 'history.json', 'conflicts.json', 'updatedAt'],
    updateStrategy: 'resourceVersionMergePatch',
    history: { key: 'history.json', maxEntries: 20, terminalRetention: 'retain' },
    conflicts: { key: 'conflicts.json', maxEntries: 20 },
  };
}

function generatedStatusConcurrencyContract(): NonNullable<ApplicationDurableStatusOwnershipContract['concurrency']> {
  return {
    updateStrategy: 'resourceVersionRetry',
    maxAttempts: 5,
    retryDiagnostic: 'applik8s-job-status-reconciler-status-store-conflict-retry',
    retryExhaustedDiagnostic: 'applik8s-job-status-reconciler-status-store-conflict-exhausted',
    failurePolicy: 'failClosed',
  };
}

function generatedStatusObservabilityContract(): NonNullable<ApplicationDurableStatusOwnershipContract['observability']> {
  return {
    mergeEvent: 'applik8s-job-status-reconciler-status-store-merged',
    conflictRetryEvent: 'applik8s-job-status-reconciler-status-store-conflict-retry',
    metrics: ['acceptedUpdates', 'rejectedUpdates', 'conflictUpdates', 'observedJobs', 'retainedJobs'],
  };
}

function jobStatusLifecycle(nodeId: string, configMapName: string, cronJob: ApplicationJobStatusLifecycleContract['cronJob']): ApplicationJobStatusLifecycleContract {
  return {
    ownership: {
      primary: 'applicationStatus',
      durableAuthority: 'generatedStatusConfigMap',
      releasePolicy: 'v0.3StableGeneratedStatusConfigMapFallback',
      applicationStatusProjection: 'bestEffortNonAuthoritative',
      fallback: 'generatedStatusConfigMap',
      appStatusSchema: 'bestEffort',
      appStatusWrite: appStatusWritePolicy(),
      appStatusSchemaContract: appStatusSchemaContract(),
      durableStore: { apiVersion: 'v1', kind: 'ConfigMap', name: configMapName },
      fallbackStore: generatedStatusConfigMapContract(),
      concurrency: generatedStatusConcurrencyContract(),
      observability: generatedStatusObservabilityContract(),
      conflictPolicy: 'mergePatch',
      diagnostics: [{ event: 'applik8s-status-schema-pruned', severity: 'warning', subject: { nodeId }, reason: 'ApplicationStatusSchemaMayPruneCustomFields', message: 'Generated job status falls back to ConfigMap when app status pruning applies.', retryable: false }],
    },
    conflictPolicy: 'mergePatch',
    conflictResolution: { staleObservedGeneration: 'reject', completedIdempotencyKey: 'retainCompleted', diagnosticsStore: 'conflicts.json' },
    historyRetention: { maxEntries: 20, terminalRetention: 'retain' },
    terminalFailure: { condition: 'Failed', partialEffects: 'required', diagnostics: 'required', history: 'retain' },
    multiJob: 'appLevelReconciler',
    cronJob,
    fallback: 'generatedStatusConfigMap',
  };
}

function serverObservability(diagnosticsPath: string): ApplicationObservabilityContract {
  return {
    health: { mode: 'http', readinessPath: '/-/healthz', livenessPath: '/-/healthz' },
    logs: { format: 'json', component: 'applik8s-server', failureEvents: ['applik8s-server-route-failure', 'applik8s-server-request-failure'] },
    metrics: { mode: 'declaredHooks', names: ['applik8s_server_requests_total', 'applik8s_server_route_failures_total'] },
    events: ['applik8s-server-route-failure', 'applik8s-server-request-failure'],
    sourceMaps: 'required',
    replayArtifacts: [{ kind: 'routeDiagnostics', path: diagnosticsPath }],
    diagnosticsArtifact: { kind: 'routeDiagnostics', path: diagnosticsPath },
  };
}

function jobObservability(diagnosticsPath: string): ApplicationObservabilityContract {
  return {
    health: { mode: 'kubernetesJobStatus' },
    logs: { format: 'json', component: 'applik8s-job-runner', failureEvents: ['applik8s-job-terminal-failure'] },
    metrics: { mode: 'declaredHooks', names: ['applik8s_generated_job_observations_total', 'applik8s_generated_job_failures_total'] },
    events: ['applik8s-job-terminal-failure'],
    sourceMaps: 'notApplicable',
    replayArtifacts: [{ kind: 'jobDiagnostics', path: diagnosticsPath }],
    diagnosticsArtifact: { kind: 'jobDiagnostics', path: diagnosticsPath },
  };
}

function routeDiagnosticsContract() {
  // typecast: preserve literal diagnostic field names for graph validation fixtures.
  return {
    routeFailureEvent: 'applik8s-server-route-failure',
    actionFailureEvent: 'applik8s-route-action-failure',
    failurePolicy: 'failClosed',
    partialEffects: 'unknownAfterActionStarted',
    sourceMaps: 'required',
    includes: ['routeId', 'method', 'path', 'module', 'sourceLocation', 'bundleInputs', 'action', 'diagnostic', 'stack'],
  } as const;
}

function guestBookSubstrateGraph(): ApplicationGraph {
  return {
    apiVersion: 'applik8s.appGraph/v1alpha1',
    kind: 'ApplicationGraph',
    metadata: { name: 'guestbook' },
    nodes: [
      {
        id: 'provider.transactional-database.postgres',
        kind: 'provider',
        name: 'postgres',
        stability: 'stable',
        interface: 'TransactionalDatabase',
        implementation: 'postgres',
        contract: { interface: 'TransactionalDatabase', surface: 'stablePublicApi', support: 'implemented', diagnostics: [] },
        config: { database: 'guestbook' },
      },
      {
        id: 'model.entry',
        kind: 'model',
        name: 'GuestBookEntry',
        stability: 'stable',
        entity: { name: 'GuestBookEntry' },
        database: { interface: 'TransactionalDatabase', nodeId: 'provider.transactional-database.postgres' },
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
            semantics: transactionalDatabaseSemantics(),
          },
        },
        materialization: {
          mode: 'providerBacked',
          provider: { interface: 'TransactionalDatabase', nodeId: 'provider.transactional-database.postgres' },
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
        observability: jobObservability('jobs/entry-migration/diagnostics.json'),
        runtime: {
          materialization: 'kubernetes-job',
          idempotency: { keySource: 'metadata.generation', conflictPolicy: 'skipCompleted' },
          phaseStatus: { resource: { apiVersion: 'guestbook.applik8s.dev/v1alpha1', kind: 'GuestBook' }, statusPath: 'status.applik8s.jobs.entryMigration' },
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
        routes: [{ id: 'get-index-0', method: 'GET', path: '/', diagnostics: routeDiagnosticsContract() }],
        resources: [],
        indexes: [{ nodeId: 'model.entry' }],
        observability: serverObservability('servers/web/routes.manifest.json'),
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
      { from: { nodeId: 'provider.transactional-database.postgres' }, to: { nodeId: 'model.entry' }, relationship: 'provides' },
      { from: { nodeId: 'job.entry-migration' }, to: { nodeId: 'model.entry' }, relationship: 'dependsOn' },
      { from: { nodeId: 'server.web' }, to: { nodeId: 'model.entry' }, relationship: 'dependsOn' },
      { from: { nodeId: 'permission.web' }, to: { nodeId: 'server.web' }, relationship: 'writes' },
    ],
    providerRequirements: [transactionalDatabaseRequirement()],
    providerBindings: [
      {
        requirement: 'requirement.model.entry.database',
        provider: { interface: 'TransactionalDatabase', nodeId: 'provider.transactional-database.postgres' },
        generatedResources: [{ apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster', name: 'guestbook-db' }],
        runtime: {
          env: { DATABASE_URL_SECRET: 'guestbook-db-app' },
          secretRefs: [{ apiVersion: 'v1', kind: 'Secret', name: 'guestbook-db-app' }],
          readiness: { dependencies: [{ apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster', name: 'guestbook-db' }], condition: 'Ready', timeoutSeconds: 300 },
        },
        metadataLinks: [
          { graphNode: { nodeId: 'provider.transactional-database.postgres' }, artifact: { kind: 'providerContract', path: 'providers/transactional-database/postgres.json' }, purpose: 'providerDependency' },
        ],
      },
    ],
    compatibility: {
      stablePublicApis: ['app', 'app.model', 'app.crd', 'app.job', 'app.schedule', 'app.defaults', 'app.provide', 'app.config', 'app.secret', 'app.expose', 'provider.TransactionalDatabase', 'provider.postgres', 'provider.Queue'],
      documentedInternalContracts: ['ApplicationGraph'],
      experimentalSurfaces: [],
      postV3Surfaces: ['workload-movement-operator', 'generic-workflow-orchestration'],
      labels: [
        { name: 'app', surface: 'stablePublicApi', since: 'v0.3', rationale: 'Application authoring context implementation.', implementation: 'implemented' },
        { name: 'app.crd', surface: 'stablePublicApi', since: 'v0.3', rationale: 'CRD materialization implementation.', implementation: 'implemented' },
        { name: 'app.job', surface: 'stablePublicApi', since: 'v0.3', rationale: 'Generated Kubernetes Job implementation.', implementation: 'implemented' },
        { name: 'app.schedule', surface: 'stablePublicApi', since: 'v0.3', rationale: 'Generated Kubernetes CronJob implementation.', implementation: 'implemented' },
        { name: 'app.defaults', surface: 'stablePublicApi', since: 'v0.3', rationale: 'Provider defaults fail-closed when unsupported provider interfaces are requested.', implementation: 'implemented' },
        { name: 'app.provide', surface: 'stablePublicApi', since: 'v0.3', rationale: 'Provider binding fails closed when unsupported provider interfaces are requested.', implementation: 'implemented' },
        { name: 'app.model', surface: 'stablePublicApi', since: 'v0.3', rationale: 'Stable app-data materialization entrypoint.', implementation: 'implemented' },
        { name: 'app.config', surface: 'stablePublicApi', since: 'v0.3', rationale: 'ConfigMap-backed configuration binding implementation.', implementation: 'implemented' },
        { name: 'app.secret', surface: 'stablePublicApi', since: 'v0.3', rationale: 'Secret-backed binding implementation with redaction metadata.', implementation: 'implemented' },
        { name: 'app.expose', surface: 'stablePublicApi', since: 'v0.3', rationale: 'Ingress-backed exposure implementation; unsupported TLS/Gateway semantics fail closed.', implementation: 'implemented' },
        { name: 'ApplicationGraph', surface: 'documentedInternalContract', since: 'v0.3', rationale: 'Stable app IR before lowering.', implementation: 'implemented' },
        { name: 'provider.TransactionalDatabase', surface: 'stablePublicApi', since: 'v0.3', rationale: 'Typed model storage provider interface implemented by the Postgres provider slice.', implementation: 'implemented' },
        { name: 'provider.postgres', surface: 'stablePublicApi', since: 'v0.3', rationale: 'First TransactionalDatabase implementation target.', implementation: 'implemented' },
        {
          name: 'provider.Queue',
          surface: 'stablePublicApi',
          since: 'v0.3',
          rationale: 'Queue is a stable v0.3 provider interface reserved for app-scoped dependency injection; generated adapters fail closed until a concrete provider is implemented.',
          implementation: 'failClosedReserved',
          diagnostics: [{ event: 'applik8s-provider-requirement-missing', severity: 'error', subject: { nodeId: 'provider.Queue' }, reason: 'ProviderInterfaceReserved', message: 'Queue is reserved until a concrete generated adapter exists.', retryable: false }],
        },
        { name: 'workload-movement-operator', surface: 'postV3Surface', rationale: 'Built after v0.3 substrate freeze.', implementation: 'postV3' },
        { name: 'generic-workflow-orchestration', surface: 'postV3Surface', rationale: 'Generic workflow orchestration remains beyond the v0.3 generated-job substrate.', implementation: 'postV3' },
      ],
    },
  };
}
