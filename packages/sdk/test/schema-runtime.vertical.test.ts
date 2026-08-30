// typecast-file-boundary: Schema-runtime tests use deliberately partial ArkType-like objects to exercise the guarded structural adapter boundary.
import { describe, expect, it } from 'vitest';
import { type as arkType } from 'arktype';

import type { JsonSchemaSource } from '@applik8s/core';
import {
  emitArkTypeStructuralJsonSchema,
  toRuntimeSchema,
} from '../src/schema-runtime.js';

interface MapSpec {
  readonly labels: Readonly<Record<string, string>>;
  readonly settings?: Readonly<Record<string, { readonly enabled: boolean; readonly weight?: number | null }>>;
}

const mapSpecSchema: JsonSchemaSource<MapSpec> = {
  kind: 'jsonSchema',
  ref: { kind: 'jsonSchema', exportName: 'MapSpec' },
  schema: {
    type: 'object',
    required: ['labels'],
    additionalProperties: false,
    properties: {
      labels: { type: 'object', additionalProperties: { type: 'string' } },
      settings: {
        type: 'object',
        additionalProperties: {
          type: 'object',
          required: ['enabled'],
          additionalProperties: false,
          properties: {
            enabled: { type: 'boolean' },
            weight: { type: 'integer', nullable: true },
          },
        },
      },
    },
  },
};

describe('schema runtime', () => {
  it('emits narrowed predicates as their structural base while retaining runtime validation', () => {
    const structural = arkType({
      objectiveId: 'string',
      generation: 'number.integer >= 1',
    });
    const narrowed = structural.narrow((value) =>
      value.objectiveId.startsWith('objective_'),
    );

    expect(emitArkTypeStructuralJsonSchema(narrowed)).toEqual(
      structural.toJsonSchema(),
    );
    const runtime = toRuntimeSchema({
      kind: 'arktype',
      ref: { kind: 'arktype', exportName: 'NarrowedObjective' },
      arktype: narrowed,
    });
    expect(runtime.emitJsonSchema()).toMatchObject({
      ok: true,
      value: {
        schema: {
          type: 'object',
          required: ['generation', 'objectiveId'],
        },
      },
    });
    expect(
      runtime.validate({ objectiveId: 'objective_1', generation: 1 }).ok,
    ).toBe(true);
    expect(
      runtime.validate({ objectiveId: 'other_1', generation: 1 }).ok,
    ).toBe(false);
  });

  it('does not broaden structural emission beyond predicates', () => {
    const morphed = arkType({ value: 'string' }).pipe((value) => ({
      value: value.value.trim(),
    }));
    expect(() => emitArkTypeStructuralJsonSchema(morphed)).toThrow();
  });

  it('recursively lowers draft-2020 definitions into the supported Draft-7 subset', () => {
    const arktypeLike = {
      toJsonSchema: () => ({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        $defs: {
          State: {
            type: 'object',
            properties: {
              phase: { const: 'ready' },
              detail: {
                anyOf: [{ type: 'string' }, { type: 'null' }],
              },
            },
          },
        },
        properties: {
          state: { $ref: '#/$defs/State' },
        },
      }),
    } as never;
    const runtime = toRuntimeSchema({
      kind: 'arktype',
      ref: { kind: 'arktype', exportName: 'DefinitionFixture' },
      arktype: arktypeLike,
    });

    expect(runtime.emitJsonSchema()).toMatchObject({
      ok: true,
      value: {
        schema: {
          $defs: {
            State: {
              properties: {
                phase: { enum: ['ready'] },
                detail: { type: 'string', nullable: true },
              },
            },
          },
        },
      },
    });
  });

  it('validates recursive local references, composed null, escaped pointers, and explicit undefined', () => {
    const schema = toRuntimeSchema<{ readonly payload: unknown; readonly maybeCount: number | null; readonly label: string }>({
      kind: 'jsonSchema',
      ref: { kind: 'jsonSchema', exportName: 'RecursiveJsonValue' },
      schema: {
        $ref: '#/$defs/root',
        $defs: {
          root: {
            type: 'object',
            required: ['label', 'maybeCount', 'payload'],
            properties: {
              label: { $ref: '#/$defs/a~1b~0c', minLength: 3 },
              maybeCount: { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] },
              payload: { $ref: '#/$defs/json' },
            },
          },
          'a/b~c': { type: 'string' },
          json: {
            anyOf: [
              { type: 'null' },
              { type: 'boolean' },
              { type: 'number' },
              { type: 'string' },
              { type: 'array', items: { $ref: '#/$defs/json' } },
              { type: 'object', additionalProperties: { $ref: '#/$defs/json' } },
            ],
          },
        },
      },
    });

    expect(schema.validate({
      label: 'valid',
      maybeCount: null,
      payload: [1, { nested: ['value', null] }],
    }).ok).toBe(true);
    expect(schema.validate({ label: 'no', maybeCount: 1, payload: [] }).ok).toBe(false);
    expect(schema.validate({ label: 'valid', maybeCount: -1, payload: [] }).ok).toBe(false);
    expect(schema.validate({ label: 'valid', maybeCount: 1, payload: [undefined] } as never).ok).toBe(false);
    expect(schema.validate({ label: 'valid', maybeCount: 1, payload: [new Date()] } as never).ok).toBe(false);

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(schema.validate({ label: 'valid', maybeCount: 1, payload: cyclic } as never).ok).toBe(false);
    const emitted = schema.emitJsonSchema();
    expect(emitted.ok).toBe(true);
    if (emitted.ok) expect(emitted.value.diagnostics).toEqual([]);
  });

  it('fails closed for unresolved and non-descending circular local references', () => {
    const unresolved = toRuntimeSchema<{ readonly value: string }>({
      kind: 'jsonSchema',
      ref: { kind: 'jsonSchema', exportName: 'UnresolvedReference' },
      schema: { type: 'object', properties: { value: { $ref: '#/$defs/missing' } } },
    });
    const unresolvedResult = unresolved.validate({ value: 'hello' });
    expect(unresolvedResult.ok).toBe(false);
    if (!unresolvedResult.ok) expect(unresolvedResult.error.code).toBe('SCHEMA_UNSUPPORTED');

    const circular = toRuntimeSchema<{ readonly value: string }>({
      kind: 'jsonSchema',
      ref: { kind: 'jsonSchema', exportName: 'CircularReference' },
      schema: {
        $ref: '#/$defs/loop',
        $defs: { loop: { $ref: '#/$defs/loop' } },
      },
    });
    const circularResult = circular.validate({ value: 'hello' });
    expect(circularResult.ok).toBe(false);
    if (!circularResult.ok) {
      expect(circularResult.error.message).toContain('circular JSON Schema reference');
    }
  });
  it('validates supported ArkType optional, enum, nullable, literal, array, map, and nested object shapes', () => {
    const schema = toRuntimeSchema({
      kind: 'arktype',
      ref: { kind: 'arktype', exportName: 'ArkParitySpec' },
      arktype: arkType({
        sourceUrl: 'string',
        priority: "'low' | 'normal' | 'high'",
        enabled: 'true',
        weight: 'number | null',
        message: 'string?',
        formats: 'string[]',
        labels: 'Record<string, string>',
        settings: {
          enabled: 'boolean',
          weight: 'number?',
        },
      }),
    });

    expect(
      schema.validate({
        sourceUrl: 's3://bucket/hero.png',
        priority: 'normal',
        enabled: true,
        weight: null,
        formats: ['webp'],
        labels: { env: 'prod' },
        settings: { enabled: true },
      }).ok
    ).toBe(true);

    const invalidEnum = schema.validate({
      sourceUrl: 's3://bucket/hero.png',
      priority: 'urgent',
      enabled: true,
      weight: 2,
      formats: ['webp'],
      labels: { env: 'prod' },
      settings: { enabled: true },
    });
    expect(invalidEnum.ok).toBe(false);
    if (!invalidEnum.ok) {
      expect(invalidEnum.error.code).toBe('SCHEMA_INVALID');
    }

    const openApi = schema.emitOpenApiSchema();
    expect(openApi.ok).toBe(true);
    if (openApi.ok) {
      expect(openApi.value.schema).toMatchObject({
        type: 'object',
        required: ['enabled', 'formats', 'labels', 'priority', 'settings', 'sourceUrl', 'weight'],
        properties: {
          priority: { enum: ['high', 'low', 'normal'] },
          enabled: { type: 'boolean', enum: [true] },
          weight: { type: 'number', nullable: true },
          formats: { type: 'array', items: { type: 'string' } },
          labels: { type: 'object', additionalProperties: { type: 'string' } },
          settings: {
            type: 'object',
            required: ['enabled'],
            properties: {
              enabled: { type: 'boolean' },
              weight: { type: 'number' },
            },
          },
        },
      });
      expect(openApi.value.diagnostics).toEqual([]);
    }
  });

  it('validates ArkType unions through the same structural runtime boundary', () => {
    const mixedUnion = toRuntimeSchema({
      kind: 'arktype',
      ref: { kind: 'arktype', exportName: 'MixedUnionArkSpec' },
      arktype: arkType({ value: 'string | number' }),
    });

    expect(mixedUnion.validate({ value: 'hero' }).ok).toBe(true);
    expect(mixedUnion.validate({ value: 42 }).ok).toBe(true);
    expect(mixedUnion.validate({ value: false }).ok).toBe(false);
  });

  it('does not erase malformed ArkType-emitted property schemas before diagnostics', () => {
    const schema = toRuntimeSchema({
      kind: 'arktype',
      ref: { kind: 'arktype', exportName: 'MalformedArkSpec' },
      // typecast: this fixture intentionally simulates a malformed ArkType emitter that cannot be expressed by the public Type type.
      arktype: {
        toJsonSchema: () => ({
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          type: 'object',
          properties: {
            name: true,
          },
        }),
      } as never,
    });

    const validation = schema.validate({ name: 'hero' });

    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(validation.error.code).toBe('SCHEMA_UNSUPPORTED');
      expect(validation.error.message).toContain('$.properties must be an object whose values are schemas');
    }
  });

  it('fails closed instead of calling non-callable ArkType adapters during validation', () => {
    const schema = toRuntimeSchema({
      kind: 'arktype',
      ref: { kind: 'arktype', exportName: 'EmitterOnlyArkSpec' },
      // typecast: this fixture intentionally simulates a JSON-Schema-only ArkType-like object to prove validation does not call it.
      arktype: {
        toJsonSchema: () => ({
          type: 'object',
          properties: {
            name: { type: 'string' },
          },
          required: ['name'],
        }),
      } as never,
    });

    const validation = schema.validate({ name: 'hero' });

    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(validation.error.code).toBe('SCHEMA_UNSUPPORTED');
      expect(validation.error.message).toContain('runtime validation');
    }
  });

  it('validates schema-valued additionalProperties as maps', () => {
    const schema = toRuntimeSchema(mapSpecSchema);

    expect(schema.validate({ labels: { env: 'prod' }, settings: { primary: { enabled: true, weight: null } } }).ok).toBe(true);

    const invalidLabel = schema.validate({ labels: { env: 1 } });
    expect(invalidLabel.ok).toBe(false);
    if (!invalidLabel.ok) {
      expect(invalidLabel.error.message).toContain('$.labels.env must be string');
    }

    const invalidSetting = schema.validate({ labels: { env: 'prod' }, settings: { primary: { enabled: true, extra: 'nope' } } });
    expect(invalidSetting.ok).toBe(false);
    if (!invalidSetting.ok) {
      expect(invalidSetting.error.message).toContain('$.settings.primary.extra is not allowed');
    }
  });

  it('preserves ArkType string refinements when normalized JSON Schema is dispatched at runtime', () => {
    const schema = toRuntimeSchema<{ readonly id: string }>({
      kind: 'jsonSchema',
      ref: { kind: 'jsonSchema', exportName: 'UuidRow' },
      schema: {
        type: 'object',
        properties: { id: { type: 'string', pattern: '^[\\da-f]{8}(?:-[\\da-f]{4}){3}-[\\da-f]{12}$' } },
        required: ['id'],
      },
    });

    expect(schema.validate({ id: '10000000-0000-0000-0000-000000000001' }).ok).toBe(true);
    const invalid = schema.validate({ id: 'not-a-uuid' });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error.message).toContain('must match pattern');
  });

  it('validates compiler-emitted UUID and RFC 3339 formats through nested JSON Schema branches', () => {
    const schema = toRuntimeSchema<{
      readonly requestId: string;
      readonly metadata: { readonly admittedAt: string };
    }>({
      kind: 'jsonSchema',
      ref: { kind: 'jsonSchema', exportName: 'FormattedWorkflowAdmission' },
      schema: {
        type: 'object',
        required: ['metadata', 'requestId'],
        properties: {
          requestId: {
            description: 'a UUID',
            format: 'uuid',
            anyOf: [
              { type: 'string', format: 'uuid', pattern: '[\\da-f]{8}-[\\da-f]{4}-[1-8][\\da-f]{3}-[89ab][\\da-f]{3}-[\\da-f]{12}' },
              { type: 'string', format: 'uuid', enum: ['00000000-0000-0000-0000-000000000000'] },
              { type: 'string', format: 'uuid', enum: ['ffffffff-ffff-ffff-ffff-ffffffffffff'] },
            ],
          },
          metadata: {
            type: 'object',
            required: ['admittedAt'],
            properties: {
              admittedAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    });

    expect(schema.validate({
      requestId: '6430855f-9bdd-4a38-aaf9-5be6c9c0bc2e',
      metadata: { admittedAt: '2026-08-30T06:00:37.384Z' },
    }).ok).toBe(true);
    expect(schema.validate({
      requestId: 'not-a-uuid',
      metadata: { admittedAt: '2026-08-30T06:00:37.384Z' },
    }).ok).toBe(false);
    expect(schema.validate({
      requestId: '6430855f-9bdd-4a38-aaf9-5be6c9c0bc2e',
      metadata: { admittedAt: '2026-02-31T06:00:37Z' },
    }).ok).toBe(false);
  });

  it('fails closed on JSON Schema formats without a runtime-equivalent validator', () => {
    const schema = toRuntimeSchema<{ readonly value: string }>({
      kind: 'jsonSchema',
      ref: { kind: 'jsonSchema', exportName: 'UnsupportedFormat' },
      schema: {
        type: 'object',
        required: ['value'],
        properties: { value: { type: 'string', format: 'custom-identifier' } },
      },
    });

    const result = schema.validate({ value: 'apparently-valid' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('SCHEMA_UNSUPPORTED');
      expect(result.error.message).toContain('custom-identifier');
    }
  });

  it('normalizes compiler-emitted nullable shapes and enforces scalar and collection bounds', () => {
    const schema = toRuntimeSchema<{ readonly limit: number; readonly label: string; readonly tags: readonly string[]; readonly optional: string | null }>({
      kind: 'jsonSchema',
      ref: { kind: 'jsonSchema', exportName: 'GeneratedBoundedQuery' },
      schema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        required: ['label', 'limit', 'optional', 'tags'],
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          label: { type: 'string', minLength: 2, maxLength: 8 },
          tags: { type: 'array', minItems: 1, maxItems: 2, uniqueItems: true, items: { type: 'string' } },
          optional: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        },
      },
    });

    expect(schema.validate({ limit: 20, label: 'chirp', tags: ['live'], optional: null }).ok).toBe(true);
    for (const value of [
      { limit: 0, label: 'chirp', tags: ['live'], optional: null },
      { limit: 20, label: 'x', tags: ['live'], optional: null },
      { limit: 20, label: 'chirp', tags: ['live', 'live'], optional: null },
    ]) expect(schema.validate(value).ok).toBe(false);

    const emitted = schema.emitJsonSchema();
    expect(emitted.ok).toBe(true);
    if (emitted.ok) expect(emitted.value.schema).toMatchObject({
      properties: { optional: { type: 'string', nullable: true } },
    });
  });

  it('validates composition recursively inside maps and preserves exact oneOf semantics', () => {
    const schema = toRuntimeSchema<MapSpec>({
      kind: 'jsonSchema',
      ref: { kind: 'jsonSchema', exportName: 'ComposedMapSpec' },
      schema: {
        type: 'object',
        properties: {
          labels: {
            type: 'object',
            additionalProperties: {
              oneOf: [{ type: 'string' }, { type: 'integer' }],
            },
          },
        },
      },
    });

    expect(schema.validate({ labels: { env: 'prod', replicas: 3 } }).ok).toBe(true);
    expect(schema.validate({ labels: { enabled: true } }).ok).toBe(false);
  });

  it('validates discriminated anyOf results plus allOf and not constraints', () => {
    const schema = toRuntimeSchema({
      kind: 'jsonSchema',
      ref: { kind: 'jsonSchema', exportName: 'DiscriminatedResult' },
      schema: {
        anyOf: [
          {
            type: 'object',
            required: ['registered', 'id', 'handle'],
            properties: {
              registered: { enum: [true] },
              id: { type: 'string' },
              handle: { type: 'string' },
            },
          },
          {
            type: 'object',
            required: ['registered', 'id'],
            properties: {
              registered: { enum: [false] },
              id: { type: 'string' },
            },
          },
        ],
        allOf: [{ not: { type: 'object', required: ['secret'] } }],
      },
    });

    expect(schema.validate({ registered: true, id: 'account-1', handle: 'ada' }).ok).toBe(true);
    expect(schema.validate({ registered: false, id: 'account-2' }).ok).toBe(true);
    expect(schema.validate({ registered: true, id: 'account-3' }).ok).toBe(false);
    expect(schema.validate({ registered: false, id: 'account-4', secret: 'hidden' }).ok).toBe(false);
  });
});
