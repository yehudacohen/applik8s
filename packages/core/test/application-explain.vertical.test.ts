import { describe, expect, it } from 'vitest';
import type { ApplicationGraph, ApplicationOperationCatalog } from '../src/index.js';
import { explainApplicationGraph } from '../src/index.js';

describe('application graph explain projection', () => {
  it('projects graph dependencies, provider resolution, and operation authority without rediscovery', () => {
    const graph: ApplicationGraph = {
      apiVersion: 'applik8s.appGraph/v1alpha1',
      kind: 'ApplicationGraph',
      metadata: { name: 'chirp', namespace: 'chirp' },
      nodes: [
        { id: 'provider.database', kind: 'provider', name: 'database', stability: 'stable', interface: 'TransactionalDatabase', implementation: 'postgres', config: {} },
        {
          id: 'model.post',
          kind: 'model',
          name: 'Post',
          stability: 'stable',
          entity: { name: 'Post' },
          database: { interface: 'TransactionalDatabase', nodeId: 'provider.database' },
          schema: { identity: ['id'], constraints: [], indexes: [], migrations: { strategy: 'none', compatibility: 'schemaCompatibleOnly' }, transactions: 'required' },
          materialization: {
            mode: 'providerBacked',
            provider: { interface: 'TransactionalDatabase', nodeId: 'provider.database' },
            backingResources: [],
            connection: {},
            runtimeBoundary: { serializedCallbacks: 'generatedRuntimeClient', scriptExecution: 'scriptRuntimeClient' },
            reconciliation: { ownership: 'application', schemaDrift: 'failClosed', deletionPolicy: 'retain' },
          },
        },
      ],
      edges: [{ from: { nodeId: 'model.post' }, to: { nodeId: 'provider.database' }, relationship: 'dependsOn' }],
      providerRequirements: [{
        id: 'requirement.model.post.database',
        interface: 'TransactionalDatabase',
        consumer: { nodeId: 'model.post' },
        provider: { interface: 'TransactionalDatabase', nodeId: 'provider.database' },
        required: true,
        purpose: 'transactionalDatabase',
        diagnostics: { missing: 'missing', ambiguous: 'ambiguous' },
      }],
      providerBindings: [{
        requirement: 'requirement.model.post.database',
        provider: { interface: 'TransactionalDatabase', nodeId: 'provider.database' },
        generatedResources: [],
        runtime: {},
      }],
      compatibility: { stablePublicApis: [], documentedInternalContracts: [], experimentalSurfaces: [], postV3Surfaces: [], labels: [] },
    };
    const catalog: ApplicationOperationCatalog = {
      apiVersion: 'applik8s.operationCatalog/v1alpha1',
      application: 'chirp',
      revision: 'r1',
      digest: 'sha256:catalog',
      state: 'active',
      operations: [{
        apiVersion: 'applik8s.operation/v1alpha1',
        id: 'applik8s://models/Post/operations/create',
        version: 'v1',
        name: 'create',
        kind: 'model.create',
        input: { digest: 'sha256:input', schema: {} },
        output: { digest: 'sha256:output', schema: {} },
        errors: {},
        authority: { classification: 'assigned', grantable: false, delegable: false, checks: ['execution'], defaultScope: { kind: 'all' } },
        transports: [],
        placement: { nodeId: 'model.post', runtime: 'command-processor' },
      }],
    };

    expect(explainApplicationGraph(graph, { catalog })).toMatchObject({
      application: 'chirp',
      graph: { nodeCount: 2, edgeCount: 1 },
      nodes: expect.arrayContaining([
        expect.objectContaining({
          id: 'model.post',
          outgoing: [{ nodeId: 'provider.database', relationship: 'dependsOn' }],
          providerRequirements: [expect.objectContaining({ provider: 'provider.database' })],
        }),
      ]),
      operations: [expect.objectContaining({
        id: 'applik8s://models/Post/operations/create',
        classification: 'assigned',
      })],
    });
  });
});
