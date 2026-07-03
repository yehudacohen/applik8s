import { describe, expect, it } from 'vitest';
import {
  applicationGraphNodeKinds,
  applicationProviderInterfaceKinds,
  isApplicationGraphNodeKind,
  isApplicationProviderInterfaceKind,
  normalizeApplicationGraph,
  serializeApplicationGraph,
  validateApplicationGraphProviderBindings,
  type ApplicationGraph,
  type ApplicationJobRuntimeContract,
  type ApplicationModelMaterializationContract,
  type ApplicationPhaseStatus,
  type ApplicationProviderBindingContract,
  type ApplicationProviderRequirement,
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
    expect(validateApplicationGraphProviderBindings(missingProvider)).toEqual([
      expect.objectContaining({
        severity: 'error',
        code: 'COMPATIBILITY_FAILED',
        message: expect.stringContaining('requires ModelStore provider provider.model.postgres'),
      }),
    ]);

    const mismatchedProvider: ApplicationGraph = {
      ...graph,
      nodes: graph.nodes.map((node) => node.id === 'provider.model.postgres' ? { ...node, interface: 'IndexStore' } : node),
    };
    expect(validateApplicationGraphProviderBindings(mismatchedProvider)).toEqual([
      expect.objectContaining({ message: expect.stringContaining('but the provider node implements IndexStore') }),
    ]);
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

    expect(validateApplicationGraphProviderBindings({ ...graph, nodes: graph.nodes.filter((node) => node.kind !== 'provider') }, [requirement])).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Model GuestBookEntry requires a ModelStore provider.' }),
    ]));
    expect(validateApplicationGraphProviderBindings({
      ...graph,
      nodes: [
        ...graph.nodes,
        { id: 'provider.model.postgres-replica', kind: 'provider', name: 'postgres-replica', stability: 'stable', interface: 'ModelStore', implementation: 'postgres' },
      ],
    }, [requirement])).toEqual([
      expect.objectContaining({ message: 'Model GuestBookEntry has multiple ModelStore providers.' }),
    ]);
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
      reconciliation: { ownership: 'application', schemaDrift: 'failClosed', deletionPolicy: 'retain' },
    };
    const jobRuntime: ApplicationJobRuntimeContract = {
      materialization: 'kubernetes-job',
      idempotency: { keySource: 'metadata.generation', conflictPolicy: 'skipCompleted' },
      phaseStatus: { resource: { apiVersion: 'guestbook.applik8s.dev/v1alpha1', kind: 'GuestBook' }, statusPath: 'status.jobs.entryMigration' },
      permissions: [{ apiGroups: ['batch'], resources: ['jobs'], verbs: ['create', 'get', 'list', 'watch'] }],
      environment: modelMaterialization.connection,
    };

    expect(modelMaterialization.reconciliation.schemaDrift).toBe('failClosed');
    expect(modelMaterialization.connection.secretRefs?.[0]?.kind).toBe('Secret');
    expect(jobRuntime.idempotency.conflictPolicy).toBe('skipCompleted');
    expect(jobRuntime.phaseStatus.statusPath).toBe('status.jobs.entryMigration');
  });
});

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
        },
        materialization: {
          mode: 'providerBacked',
          provider: { interface: 'ModelStore', nodeId: 'provider.model.postgres' },
          backingResources: [{ apiVersion: 'postgresql.cnpg.io/v1', kind: 'Cluster', name: 'guestbook-db' }],
          connection: {
            env: { DATABASE_URL_SECRET: 'guestbook-db-app' },
            secretRefs: [{ apiVersion: 'v1', kind: 'Secret', name: 'guestbook-db-app' }],
          },
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
          permissions: [{ apiGroups: ['batch'], resources: ['jobs'], verbs: ['create', 'get', 'list', 'watch'] }],
        },
      },
      {
        id: 'server.web',
        kind: 'server',
        name: 'web',
        stability: 'stable',
        routes: [{ id: 'get-index-0', method: 'GET', path: '/' }],
        resources: [],
        indexes: [{ nodeId: 'model.entry' }],
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
    compatibility: {
      stablePublicApis: ['app', 'app.model', 'app.crd', 'app.job'],
      documentedInternalContracts: ['ApplicationGraph'],
      experimentalSurfaces: ['provider.postgres'],
      postV3Surfaces: ['workload-movement-operator', 'generic-workflow-orchestration'],
    },
  };
}
