import { describe, expect, it } from 'vitest';
import { type as arkType } from 'arktype';

import type { JsonSchemaSource } from '@applik8s/core';
import { toRuntimeSchema } from '../src/schema-runtime.js';

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

  it('fails closed for ArkType unions that cannot be represented by the supported structural subset', () => {
    const mixedUnion = toRuntimeSchema({
      kind: 'arktype',
      ref: { kind: 'arktype', exportName: 'MixedUnionArkSpec' },
      arktype: arkType({ value: 'string | number' }),
    });

    const validation = mixedUnion.validate({ value: 'hero' });

    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(validation.error.code).toBe('SCHEMA_UNSUPPORTED');
      expect(validation.error.message).toContain('composition keywords');
    }
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

  it('fails closed for unsupported composition inside map schemas', () => {
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

    const result = schema.validate({ labels: { env: 'prod' } });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('SCHEMA_UNSUPPORTED');
      expect(result.error.message).toContain('composition keywords');
    }
  });
});
