// typecast-file-boundary: catalog fixtures deliberately assemble erased operation artifacts to test activation and compatibility validation.
import { describe, expect, it } from 'vitest';
import type {
  ApplicationOperationCatalog,
  ApplicationOperationDescriptor,
  ApplicationOperationId,
  ApplicationSchemaDescriptor,
} from '@applik8s/core';
import {
  ApplicationCatalogError,
  ApplicationOperationCatalogManager,
  InMemoryApplicationOperationCatalogRepository,
  compareApplicationOperationCatalogs,
} from '../src/index.js';

const schema = {
  digest: 'sha256:schema',
  schema: { type: 'object', additionalProperties: false },
} as const;

function operation(
  id: ApplicationOperationId = 'applik8s://models/Post/operations/create',
  input: ApplicationSchemaDescriptor = schema,
  replaces?: ApplicationOperationDescriptor['replaces'],
): ApplicationOperationDescriptor {
  return {
    apiVersion: 'applik8s.operation/v1alpha1',
    id,
    version: '1',
    name: 'create',
    kind: 'model.create',
    input,
    output: schema,
    errors: {},
    authority: {
      classification: 'assigned',
      grantable: true,
      delegable: false,
      checks: ['execution', 'pre-commit'],
      defaultScope: { kind: 'all' },
    },
    transports: [],
    placement: { nodeId: 'command-handler.post-create', runtime: 'command-processor' },
    ...(replaces ? { replaces } : {}),
  };
}

function catalog(
  revision: string,
  operations: readonly ApplicationOperationDescriptor[],
  predecessor?: string,
): ApplicationOperationCatalog {
  return {
    apiVersion: 'applik8s.operationCatalog/v1alpha1',
    application: 'chirp',
    revision,
    digest: `sha256:${revision}`,
    state: 'proposed',
    operations,
    ...(predecessor ? { predecessor } : {}),
  };
}

describe('operation catalog lifecycle', () => {
  it('stages, activates, drains, and retires compatible revisions', async () => {
    const repository = new InMemoryApplicationOperationCatalogRepository();
    const manager = new ApplicationOperationCatalogManager(repository, {
      now: () => '2026-07-29T00:00:00.000Z',
    });
    await manager.stage(catalog('r1', [operation()]));
    await manager.activate('chirp', 'r1');
    await manager.stage(catalog('r2', [
      operation(),
      operation('applik8s://queries/Timeline/operations/read'),
    ], 'r1'));
    await manager.activate('chirp', 'r2');

    expect((await repository.get('chirp', 'r1'))?.state).toBe('draining');
    expect((await repository.get('chirp', 'r2'))?.state).toBe('active');
    expect((await manager.resolve('chirp', operation().id)).id).toBe(operation().id);

    repository.setReferences('chirp', 'r1', {
      grantIds: ['grant-1'],
      envelopeIds: [],
      workflowIds: [],
      sessionIds: [],
    });
    await expect(manager.retire('chirp', 'r1')).rejects.toMatchObject({
      code: 'CATALOG_REFERENCED',
    } satisfies Partial<ApplicationCatalogError>);
    repository.setReferences('chirp', 'r1', {
      grantIds: [],
      envelopeIds: [],
      workflowIds: [],
      sessionIds: [],
    });
    expect((await manager.retire('chirp', 'r1')).state).toBe('retired');
  });

  it('fails closed when a rolling catalog changes operation schemas', async () => {
    const repository = new InMemoryApplicationOperationCatalogRepository();
    const manager = new ApplicationOperationCatalogManager(repository);
    const first = catalog('r1', [operation()]);
    const next = catalog('r2', [operation(operation().id, {
      ...schema,
      digest: 'sha256:breaking-input',
    })], 'r1');
    await manager.stage(first);
    await manager.activate('chirp', 'r1');
    const transition = await manager.stage(next);

    expect(transition.compatibility?.compatible).toBe(false);
    await repository.putReference('chirp', 'r1', 'envelope', 'command:r1');
    await expect(manager.activate('chirp', 'r2')).rejects.toMatchObject({
      code: 'CATALOG_INCOMPATIBLE',
    } satisfies Partial<ApplicationCatalogError>);
    await repository.removeReference('chirp', 'r1', 'envelope', 'command:r1');
    await expect(manager.activate('chirp', 'r2')).resolves.toMatchObject({
      catalog: { state: 'active', revision: 'r2' },
    });
    expect(compareApplicationOperationCatalogs(
      { ...first, state: 'active' },
      next,
    ).changes).toContainEqual(expect.objectContaining({
      operationId: operation().id,
      kind: 'incompatible',
    }));
  });

  it('blocks only durable references that carry an incompatible operation', async () => {
    const repository = new InMemoryApplicationOperationCatalogRepository();
    const manager = new ApplicationOperationCatalogManager(repository);
    const createId = operation().id;
    const readId = 'applik8s://queries/Timeline/operations/read' as const;
    await manager.stage(catalog('r1', [operation(createId), operation(readId)]));
    await manager.activate('chirp', 'r1');
    await manager.stage(catalog('r2', [
      operation(createId, { ...schema, digest: 'sha256:breaking-input' }),
      operation(readId),
    ], 'r1'));
    await repository.putReference('chirp', 'r1', 'envelope', 'read-command', [readId]);

    await expect(manager.activate('chirp', 'r2')).resolves.toMatchObject({
      catalog: { state: 'active', revision: 'r2' },
    });
  });

  it('recognizes replacement metadata on the successor operation', () => {
    const priorId = operation().id;
    const successorId = 'applik8s://models/Post/operations/publish' as ApplicationOperationId;
    const report = compareApplicationOperationCatalogs(
      { ...catalog('r1', [operation(priorId)]), state: 'active' },
      catalog('r2', [
        operation(successorId, schema, {
          operationId: priorId,
          compatible: true,
          migration: 'post.create-to-publish.v1',
        }),
      ], 'r1'),
    );

    expect(report.compatible).toBe(true);
    expect(report.changes).toContainEqual({
      operationId: priorId,
      kind: 'replaced',
      message: `Operation ${priorId} is replaced by ${successorId}.`,
      replacement: {
        operationId: successorId,
        compatible: true,
        migration: 'post.create-to-publish.v1',
      },
    });
    expect(report.changes).not.toContainEqual(expect.objectContaining({
      operationId: successorId,
      kind: 'added',
    }));
  });
});
