// typecast-file-boundary: Adversarial fixtures intentionally cross erased JSON and template-literal identity boundaries to exercise fail-closed validation.
import { describe, expect, it } from 'vitest';
import {
  type ApplicationGraph,
  type ApplicationGuestHostIdentityEnvelope,
  type ApplicationRuntimeAccessRequirement,
  applicationCanonicalIdentity,
  applicationExecutionBoundaryIdentity,
  applicationGraphNodeIdentity,
  applicationOperationIdentity,
  normalizeApplicationGraph,
  sourceProvenance,
  validateApplicationGraph,
  validateApplicationFoundation,
} from '../src/index.js';

const application = applicationCanonicalIdentity({
  application: 'notes',
  kind: 'application',
  semanticKey: 'notes',
});
const handler = applicationGraphNodeIdentity({
  application: 'notes',
  nodeKind: 'processor',
  nodeId: 'index-note',
  parentId: application.id,
});
const execution = applicationExecutionBoundaryIdentity({
  application: 'notes',
  boundaryKind: 'processor',
  ownerNodeId: 'index-note',
  parentId: handler.id,
});
const operation = applicationOperationIdentity({
  application: 'notes',
  operationId: 'applik8s://events/NoteCreated/operations/consume',
  parentId: handler.id,
});
const artifact = applicationCanonicalIdentity({
  application: 'notes',
  kind: 'artifact',
  semanticKey: 'worker:index-note',
  parentId: execution.id,
});
const provenance = sourceProvenance({
  origin: 'captured-helper',
  module: 'src/notes.ts',
  symbol: 'indexNote',
  helperPath: ['onNoteCreated', 'indexNote'],
  location: { file: 'src/notes.ts', line: 14, column: 3 },
  causedBy: handler.id,
});

function access(scope: ApplicationRuntimeAccessRequirement['target']['scope']): ApplicationRuntimeAccessRequirement {
  return {
    apiVersion: 'applik8s.runtimeAccess/v1alpha1',
    id: 'access:index-note:search.write',
    consumer: { nodeId: 'processor.index-note', executionIdentity: execution.id, artifactId: artifact.id },
    target: { capabilityId: 'Search:primary', operation: 'search.write', scope },
    origin: 'inferred',
    provenance: [provenance],
    sensitivity: 'internal',
    enforcement: 'required',
  };
}

function envelope(): ApplicationGuestHostIdentityEnvelope {
  return {
    apiVersion: 'applik8s.guestHostIdentity/v1alpha1',
    application: application.id,
    operation: operation.id,
    execution: execution.id,
    artifact: artifact.id,
    attempt: 'attempt-1',
    runtimeAccess: {
      version: 'v1alpha1',
      digest: `sha256:${'a'.repeat(64)}`,
      requirementIds: ['access:index-note:search.write'],
    },
    capabilityIds: ['Search:primary'],
    effectIds: ['search.write'],
    causalPrincipalId: 'principal:user-1',
    authorizationReceiptIds: ['receipt-1'],
  };
}

describe('v0.8 canonical foundation', () => {
  it('keeps semantic identity stable when source provenance moves', () => {
    const moved = sourceProvenance({
      ...provenance,
      module: 'src/search/index-note.ts',
      location: { file: 'src/search/index-note.ts', line: 4, column: 1 },
    });
    expect(handler.id).toBe('applik8s://applications/notes/graph-nodes/9%3Aprocessor%7C10%3Aindex-note');
    expect(moved.id).not.toBe(provenance.id);
    expect(applicationGraphNodeIdentity({
      application: 'notes',
      nodeKind: 'processor',
      nodeId: 'index-note',
      parentId: application.id,
    }).id).toBe(handler.id);
  });

  it('accepts source-attributed per-execution access and a bounded guest/host envelope', () => {
    expect(validateApplicationFoundation({
      identities: [application, handler, execution, operation, artifact],
      provenance: [provenance],
      runtimeAccess: [access({ kind: 'resource', resourceId: 'SearchIndex:notes' })],
      guestHostEnvelopes: [envelope()],
    })).toEqual([]);
  });

  it('fails closed on wildcard access, unknown execution identities, and machine-absolute provenance', () => {
    const unknownExecution = {
      ...access({ kind: 'prefix', resourceId: 'SearchIndex:notes', prefix: '*' }),
      consumer: {
        nodeId: 'processor.index-note',
        executionIdentity: 'applik8s://applications/notes/execution-boundaries/missing' as const,
      },
    };
    const absolute = {
      ...provenance,
      location: { file: '/Users/example/private/notes.ts', line: 1, column: 1 },
    };
    expect(validateApplicationFoundation({
      identities: [application, handler, execution, operation, artifact],
      provenance: [absolute],
      runtimeAccess: [unknownExecution],
    }).map(({ code }) => code)).toEqual([
      'FOUNDATION_PROVENANCE_INVALID',
      'FOUNDATION_RUNTIME_ACCESS_INVALID',
    ]);
  });

  it('rejects absolute paths at the provenance construction boundary', () => {
    expect(() => sourceProvenance({
      origin: 'authored',
      module: '/tmp/private.ts',
      symbol: 'privateHandler',
    })).toThrow(/workspace-relative/);
  });

  it('retains foundation analysis in the one canonical ApplicationGraph and validates its consumer boundary', () => {
    const requirement = access({ kind: 'resource', resourceId: 'SearchIndex:notes' });
    const foundation = {
      identities: [execution, handler, application],
      provenance: [provenance],
      runtimeAccess: [requirement],
    } as const;
    const graph: ApplicationGraph = {
      apiVersion: 'applik8s.appGraph/v1alpha1',
      kind: 'ApplicationGraph',
      metadata: { name: 'notes' },
      nodes: [{
        id: 'processor.index-note',
        kind: 'provider',
        name: 'Search',
        stability: 'stable',
        interface: 'Search',
        implementation: 'deterministic-search',
      }],
      edges: [],
      providerRequirements: [],
      providerBindings: [],
      compatibility: {
        stablePublicApis: [],
        documentedInternalContracts: [],
        experimentalSurfaces: [],
        postV3Surfaces: [],
        labels: [],
      },
      foundation,
    };
    expect(validateApplicationGraph(graph)).toEqual([]);
    expect(normalizeApplicationGraph(graph).foundation?.identities.map(({ id }) => id)).toEqual(
      [application.id, execution.id, handler.id].sort(),
    );
    expect(validateApplicationGraph({
      ...graph,
      foundation: {
        ...foundation,
        runtimeAccess: [{
          ...requirement,
          consumer: { ...requirement.consumer, nodeId: 'missing' },
        }],
      },
    }).map(({ message }) => message)).toContain(
      'Application runtime-access requirement access:index-note:search.write references missing consumer node missing.',
    );
  });
});
