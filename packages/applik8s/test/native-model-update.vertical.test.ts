import { describe, expect, it } from 'vitest';
import { clear, type ApplicationModelUpdatePatch, type ApplicationRuntimeModelContract } from '../src/application-builder.js';
import {
  applicationNativeModelMutableColumns,
  applyApplicationModelUpdatePatch,
} from '../src/native-model-update.js';

describe('native model partial-update semantics', () => {
  it('admits clear only for nullable or optional model properties at the public type boundary', () => {
    const nullable: ApplicationModelUpdatePatch<{
      readonly title: string;
      readonly metadata: object | null;
      readonly optional?: string;
    }> = { metadata: clear(), optional: clear() };
    expect(nullable.metadata).toBeDefined();
    // @ts-expect-error Required non-null properties cannot be cleared.
    const invalid: ApplicationModelUpdatePatch<{ readonly title: string }> = { title: clear() };
    expect(invalid).toBeDefined();
  });

  it('keeps omission, JSON null, and explicit database NULL as separate intents', () => {
    const model = nativeModel();
    const before = {
      id: 'row-1',
      title: 'before',
      metadata: null,
      revision: 'r1',
    };

    const omittedClears = new Set<string>();
    const omitted = applyApplicationModelUpdatePatch(
      model,
      before,
      { title: 'after' },
      omittedClears,
    );
    expect(omitted).toEqual({ ...before, title: 'after' });
    expect([...omittedClears]).toEqual([]);
    expect(applicationNativeModelMutableColumns(
      model,
      before,
      { ...omitted, revision: 'r2' },
      omittedClears,
    ).map(({ property }) => property)).toEqual(['title', 'revision']);

    const jsonNullClears = new Set<string>();
    const jsonBefore: {
      id: string;
      title: string;
      metadata: { readonly retained: boolean } | null;
      revision: string;
    } = { ...before, metadata: { retained: true } };
    const jsonNull = applyApplicationModelUpdatePatch(
      model,
      jsonBefore,
      { metadata: null },
      jsonNullClears,
    );
    expect(jsonNull.metadata).toBeNull();
    expect([...jsonNullClears]).toEqual([]);

    const databaseNullClears = new Set<string>();
    const databaseNull = applyApplicationModelUpdatePatch(
      model,
      before,
      { metadata: clear() },
      databaseNullClears,
    );
    expect(databaseNull.metadata).toBeNull();
    expect([...databaseNullClears]).toEqual(['metadata']);
    expect(applicationNativeModelMutableColumns(
      model,
      before,
      { ...databaseNull, revision: 'r2' },
      databaseNullClears,
    ).map(({ property }) => property)).toEqual(['metadata', 'revision']);
  });

  it('fails before SQL when clear targets a required or unknown native field', () => {
    const model = nativeModel();
    expect(() => applyApplicationModelUpdatePatch(
      model,
      { id: 'row-1', title: 'before', metadata: null, revision: 'r1' },
      // typecast: deliberately bypass the public type gate to verify runtime rejection.
      { title: clear() } as never,
      new Set(),
    )).toThrow('applik8s-model-clear-field-required');
    expect(() => applyApplicationModelUpdatePatch(
      model,
      { id: 'row-1', title: 'before', metadata: null, revision: 'r1' },
      // typecast: deliberately bypass the public type gate to verify unknown-field rejection.
      { missing: clear() } as never,
      new Set(),
    )).toThrow('applik8s-model-clear-field-unknown');
  });

  it('removes a clear-intent property from JSON-envelope models', () => {
    const cleared = new Set<string>();
    const { nativeRelational: _nativeRelational, ...envelopeModel } = nativeModel();
    const result = applyApplicationModelUpdatePatch(
      { ...envelopeModel, storageShape: 'jsonb-envelope' },
      // typecast: the optional fixture shape narrows the generic model value for this assertion.
      { title: 'kept', optional: 'remove-me' } as {
        title: string;
        optional?: string;
      },
      { optional: clear() },
      cleared,
    );
    expect(result).toEqual({ title: 'kept' });
    expect([...cleared]).toEqual([]);
  });
});

function nativeModel(): ApplicationRuntimeModelContract {
  return {
    name: 'Document',
    tableName: 'documents',
    provider: 'postgres',
    database: 'application',
    clusterName: 'application',
    secretName: 'application-app',
    secretKey: 'uri',
    connectionEnvName: 'APPLICATION_DATABASE_URL',
    constraints: [],
    indexes: [],
    retention: { mode: 'retain' },
    storageShape: 'native-relational',
    nativeRelational: {
      identity: { property: 'id', column: 'id' },
      revision: { property: 'revision', column: 'revision' },
      columns: [
        { property: 'id', column: 'id', logicalType: 'string', nullable: false },
        { property: 'title', column: 'title', logicalType: 'string', nullable: false },
        { property: 'metadata', column: 'metadata', logicalType: 'json', nullable: true },
        { property: 'revision', column: 'revision', logicalType: 'string', nullable: false },
      ],
    },
  };
}
