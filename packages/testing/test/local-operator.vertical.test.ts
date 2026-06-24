import { describe, expect, it } from 'vitest';
import { type as arkType } from 'arktype';

import type { ExternalEffectRecord, JsonSchemaSource } from '@applik8s/core';
import { externalEffectRecord, sdk } from '@applik8s/sdk';
import { testing } from '../src/index.js';

interface ImageSpec {
  readonly sourceUrl: string;
  readonly formats: readonly string[];
}

interface ImageStatus {
  readonly phase?: 'Pending' | 'Processing' | 'Complete' | 'Failed';
  readonly outputUrls?: readonly string[];
  readonly effects?: readonly ExternalEffectRecord[];
}

const imageSpecSchema: JsonSchemaSource<ImageSpec> = {
  kind: 'jsonSchema',
  ref: { kind: 'jsonSchema', exportName: 'ImageSpec' },
  schema: {
    type: 'object',
    required: ['sourceUrl', 'formats'],
    additionalProperties: false,
    properties: {
      sourceUrl: { type: 'string' },
      formats: { type: 'array', items: { type: 'string' } },
    },
  },
};

const imageStatusSchema: JsonSchemaSource<ImageStatus> = {
  kind: 'jsonSchema',
  ref: { kind: 'jsonSchema', exportName: 'ImageStatus' },
  schema: {
    type: 'object',
    properties: {
      phase: { type: 'string' },
      outputUrls: { type: 'array', items: { type: 'string' } },
    },
  },
};

describe('local operator vertical slice', () => {
  it('validates JSON Schema-backed CRD specs with the supported schema subset', () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: imageSpecSchema,
      status: imageStatusSchema,
    });

    expect(ImageJob.spec.validate({ sourceUrl: 's3://bucket/hero.png', formats: ['webp'] }).ok).toBe(true);
    expect(ImageJob.spec.validate({ formats: ['webp'] }).ok).toBe(false);
    expect(ImageJob.spec.validate({ sourceUrl: 's3://bucket/hero.png', formats: 'webp' }).ok).toBe(false);
    expect(ImageJob.spec.validate({ sourceUrl: 's3://bucket/hero.png', formats: ['webp'], extra: true }).ok).toBe(false);

    const openApi = ImageJob.spec.emitOpenApiSchema();
    expect(openApi.ok).toBe(true);
    if (openApi.ok) {
      expect(openApi.value.schema).toMatchObject({
        type: 'object',
        required: ['sourceUrl', 'formats'],
        additionalProperties: false,
      });
    }
  });

  it('fails closed when JSON Schema uses unsupported validation keywords', () => {
    const UnsupportedJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'UnsupportedJob',
      spec: {
        kind: 'jsonSchema',
        ref: { kind: 'jsonSchema', exportName: 'UnsupportedImageSpec' },
        schema: {
          type: 'object',
          oneOf: [imageSpecSchema.schema],
        },
      },
      status: imageStatusSchema,
    });

    const validation = UnsupportedJob.spec.validate({ sourceUrl: 's3://bucket/hero.png', formats: ['webp'] });
    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(validation.error.code).toBe('SCHEMA_UNSUPPORTED');
    }

    const openApi = UnsupportedJob.spec.emitOpenApiSchema();
    expect(openApi.ok).toBe(true);
    if (openApi.ok) {
      expect(openApi.value.diagnostics).toEqual([
        {
          severity: 'warning',
          code: 'SCHEMA_UNSUPPORTED',
          message: '$ uses composition keywords that this SDK slice does not validate.',
        },
      ]);
    }
  });

  it('reports JSON Schema keywords and shapes this SDK slice would otherwise ignore', () => {
    const PatternJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'PatternJob',
      spec: {
        kind: 'jsonSchema',
        ref: { kind: 'jsonSchema', exportName: 'PatternImageSpec' },
        schema: {
          type: 'object',
          required: ['sourceUrl'],
          properties: {
            sourceUrl: { type: 'string', pattern: '^s3://' },
          },
        },
      },
      status: imageStatusSchema,
    });

    const validation = PatternJob.spec.validate({ sourceUrl: 'https://example.com/image.png', formats: ['webp'] });
    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(validation.error.code).toBe('SCHEMA_UNSUPPORTED');
    }

    const openApi = PatternJob.spec.emitOpenApiSchema();
    expect(openApi.ok).toBe(true);
    if (openApi.ok) {
      expect(openApi.value.diagnostics).toContainEqual({
        severity: 'warning',
        code: 'SCHEMA_UNSUPPORTED',
        message: '$.sourceUrl uses unsupported JSON Schema keyword pattern.',
      });
    }

    const MalformedJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'MalformedJob',
      spec: {
        kind: 'jsonSchema',
        ref: { kind: 'jsonSchema', exportName: 'MalformedImageSpec' },
        schema: {
          type: ['object'],
          required: ['sourceUrl', 1],
        },
      },
      status: imageStatusSchema,
    });

    const malformed = MalformedJob.spec.emitJsonSchema();
    expect(malformed.ok).toBe(true);
    if (malformed.ok) {
      expect(malformed.value.diagnostics).toEqual([
        {
          severity: 'warning',
          code: 'SCHEMA_UNSUPPORTED',
          message: '$.type must be one of object, array, string, number, integer, or boolean.',
        },
        {
          severity: 'warning',
          code: 'SCHEMA_UNSUPPORTED',
          message: '$.required must be an array of strings.',
        },
      ]);
    }
  });

  it('supports structural ArkType schemas for runtime validation and OpenAPI emission', () => {
    const ArkJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ArkJob',
      spec: arkType({ sourceUrl: 'string', formats: 'string[]' }),
      status: imageStatusSchema,
    });

    const validation = ArkJob.spec.validate({ sourceUrl: 's3://bucket/hero.png', formats: ['webp'] });
    expect(validation.ok).toBe(true);

    const invalid = ArkJob.spec.validate({ sourceUrl: 42, formats: ['webp'] });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.error.code).toBe('SCHEMA_INVALID');
    }

    const openApi = ArkJob.spec.emitOpenApiSchema();
    expect(openApi.ok).toBe(true);
    if (openApi.ok) {
      expect(openApi.value.schema).toMatchObject({
        type: 'object',
        required: ['formats', 'sourceUrl'],
        properties: {
          sourceUrl: { type: 'string' },
          formats: { type: 'array', items: { type: 'string' } },
        },
      });
    }
  });

  it('defines a CRD, records proxy handler operations, and verifies them with testOperator', async () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: imageSpecSchema,
      status: imageStatusSchema,
    });

    const imagePipeline = sdk.operator({
      name: 'image-pipeline',
      resources: { ImageJob },
      handlers: [
        ImageJob.on.reconcile((job) => {
          job.status.phase = 'Processing';
          job.status.outputUrls = [];
          job.apply(
            job.batch.Job({
              name: job.names.dnsSafe(`${job.metadata.name}-proxy`),
              ...(job.metadata.namespace ? { namespace: job.metadata.namespace } : {}),
              image: 'ghcr.io/acme/image-resizer:v1',
              env: {
                SOURCE_URL: job.spec.sourceUrl,
                FORMATS: job.spec.formats.join(','),
              },
            })
          );
          job.events.normal('ImageJobAccepted', 'Image job accepted for processing');
          job.requeue({ afterSeconds: 30, reason: 'WaitingForImageOutput' });
        }),
      ],
    });

    const input = {
      name: 'hero-image',
      namespace: 'media',
      spec: {
        sourceUrl: 's3://bucket/hero.png',
        formats: ['webp', 'avif'],
      },
    };
    const imageJob = ImageJob(input);

    const run = await testing
      .testOperator(imagePipeline)
      .given(imageJob)
      .expectStatus({ phase: 'Processing', outputUrls: [] })
      .expectApply({ apiVersion: 'batch/v1', kind: 'Job', name: 'hero-image-proxy', namespace: 'media' })
      .expectEvent('ImageJobAccepted')
      .expectRequeue(30)
      .run({ reconcile: { apiVersion: ImageJob.apiVersion, kind: ImageJob.kind, name: input.name, namespace: input.namespace } });

    expect(run.ok).toBe(true);
    if (run.ok) {
      expect(run.value.assertionFailures).toEqual([]);
      expect(run.value.assertionsPassed).toBe(4);
      expect(run.value.normalizedPlan?.operations.map((operation) => operation.kind)).toEqual(['apply', 'status', 'event', 'requeue']);
    }
  });

  it('merges proxy-recorded status with explicit handler status objects', async () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: imageSpecSchema,
      status: imageStatusSchema,
    });

    const imagePipeline = sdk.operator({
      name: 'image-pipeline',
      resources: { ImageJob },
      handlers: [
        ImageJob.on.reconcile((job) => {
          job.status.phase = 'Pending';
          return { status: { phase: 'Processing', outputUrls: ['s3://bucket/hero.webp'] } };
        }),
      ],
    });

    const run = await testing
      .testOperator(imagePipeline)
      .given(ImageJob({ name: 'hero-image', namespace: 'media', spec: { sourceUrl: 's3://bucket/hero.png', formats: ['webp'] } }))
      .run({ reconcile: { apiVersion: ImageJob.apiVersion, kind: ImageJob.kind, name: 'hero-image', namespace: 'media' } });

    expect(run.ok).toBe(true);
    if (run.ok) {
      expect(run.value.handlerResult?.status).toEqual({ phase: 'Processing', outputUrls: ['s3://bucket/hero.webp'] });
      expect(run.value.normalizedPlan?.operations).toContainEqual({ kind: 'status', status: { phase: 'Processing', outputUrls: ['s3://bucket/hero.webp'] } });
    }
  });

  it('preserves malformed explicit status output for runtime validation', async () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: imageSpecSchema,
      status: imageStatusSchema,
    });

    const imagePipeline = sdk.operator({
      name: 'image-pipeline',
      resources: { ImageJob },
      handlers: [
        ImageJob.on.reconcile((job) => {
          job.status.phase = 'Pending';
          // typecast: this regression intentionally returns malformed explicit status so the local harness preserves it for runtime validation.
          return { status: 'not-a-json-object' } as never;
        }),
      ],
    });

    const run = await testing
      .testOperator(imagePipeline)
      .given(ImageJob({ name: 'hero-image', namespace: 'media', spec: { sourceUrl: 's3://bucket/hero.png', formats: ['webp'] } }))
      .run({ reconcile: { apiVersion: ImageJob.apiVersion, kind: ImageJob.kind, name: 'hero-image', namespace: 'media' } });

    expect(run.ok).toBe(true);
    if (run.ok) {
      expect(run.value.handlerResult?.status).toBe('not-a-json-object');
      expect(run.value.normalizedPlan?.operations).toContainEqual({ kind: 'status', status: 'not-a-json-object' });
    }
  });

  it('normalizes all operation kinds in canonical order through the local harness', async () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: imageSpecSchema,
      status: imageStatusSchema,
    });
    const childRef = { apiVersion: 'batch/v1', kind: 'Job', name: 'hero-webp', namespace: 'media' };

    const imagePipeline = sdk.operator({
      name: 'image-pipeline',
      resources: { ImageJob },
      handlers: [
        ImageJob.on.reconcile((job) => {
          job.events.normal('Accepted', 'Accepted');
          job.finalizers.add('media.applik8s.dev/imagejob');
          job.finalizers.remove('media.applik8s.dev/imagejob');
          job.status.phase = 'Processing';
          job.delete(childRef, { propagationPolicy: 'Foreground', gracePeriodSeconds: 5 });
          job.apply(job.batch.ConfigMap({ name: 'hero-config', namespace: 'media' }));
          job.patch(childRef, [{ op: 'replace', path: '/spec/suspend', value: true }]);
          job.requeue({ afterSeconds: 10, reason: 'Waiting' });
        }),
      ],
    });

    const run = await testing
      .testOperator(imagePipeline)
      .given(ImageJob({ name: 'hero-image', namespace: 'media', spec: { sourceUrl: 's3://bucket/hero.png', formats: ['webp'] } }))
      .expectFinalizer('media.applik8s.dev/imagejob', 'add')
      .expectApply({ apiVersion: 'v1', kind: 'ConfigMap', name: 'hero-config', namespace: 'media' })
      .expectPatch(childRef, [{ op: 'replace', path: '/spec/suspend', value: true }])
      .expectDelete(childRef)
      .expectStatus({ phase: 'Processing' })
      .expectEvent('Accepted')
      .expectFinalizer('media.applik8s.dev/imagejob', 'remove')
      .expectRequeue(10)
      .run({ reconcile: { apiVersion: ImageJob.apiVersion, kind: ImageJob.kind, name: 'hero-image', namespace: 'media' } });

    expect(run.ok).toBe(true);
    if (run.ok) {
      expect(run.value.assertionFailures).toEqual([]);
      expect(run.value.assertionsPassed).toBe(8);
      expect(run.value.normalizedPlan?.operations.map((operation) => operation.kind)).toEqual(['finalizer', 'apply', 'patch', 'delete', 'status', 'event', 'finalizer', 'requeue']);
      expect(run.value.normalizedPlan?.operations[0]).toEqual({ kind: 'finalizer', operation: 'add', finalizer: 'media.applik8s.dev/imagejob' });
      expect(run.value.normalizedPlan?.operations[3]).toEqual({ kind: 'delete', ref: childRef, options: { propagationPolicy: 'Foreground', gracePeriodSeconds: 5 } });
      expect(run.value.normalizedPlan?.operations[6]).toEqual({ kind: 'finalizer', operation: 'remove', finalizer: 'media.applik8s.dev/imagejob' });
    }
  });

  it('provides declared fake capabilities to context handlers', async () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: imageSpecSchema,
      status: imageStatusSchema,
    });

    const imagePipeline = sdk.operator({
      name: 'image-pipeline',
      resources: { ImageJob },
      capabilities: {
        processor: sdk.external.http({ baseUrl: 'https://processor.example.test', auth: 'none' }),
      },
      handlers: [
        ImageJob.on.context.reconcile(async (_job, ctx) => {
          const processor = ctx.capabilities.processor;
          if (!processor) {
            return { ok: false, error: { code: 'CAPABILITY_MISSING', message: 'Processor capability is missing.', severity: 'error', context: { capabilityName: 'processor' } } };
          }
          const response = await processor.post('/resize', { idempotencyKey: ctx.reconcileId });
          if (!response || typeof response !== 'object' || !('phase' in response) || response.phase !== 'Processing') {
            return { ok: false, error: { code: 'CAPABILITY_DENIED', message: 'Unexpected processor response.', severity: 'error', context: { capabilityName: 'processor' } } };
          }
          return ctx.apply({ status: { phase: response.phase } });
        }),
      ],
    });

    const run = await testing
      .testOperator(imagePipeline)
      .given(ImageJob({ name: 'hero-image', spec: { sourceUrl: 's3://bucket/hero.png', formats: ['webp'] } }))
      .givenCapability('processor', {
        responses: [{ method: 'POST', path: '/resize', response: { phase: 'Processing' } }],
      })
      .expectStatus({ phase: 'Processing' })
      .run();

    expect(run.ok).toBe(true);
    if (run.ok) {
      expect(run.value.assertionFailures).toEqual([]);
    }
  });

  it('rejects fake capabilities that are not declared by the operator', async () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: imageSpecSchema,
      status: imageStatusSchema,
    });

    const imagePipeline = sdk.operator({
      name: 'image-pipeline',
      resources: { ImageJob },
      handlers: [ImageJob.on.context.reconcile((_job, ctx) => ctx.noop())],
    });

    const run = await testing
      .testOperator(imagePipeline)
      .given(ImageJob({ name: 'hero-image', spec: { sourceUrl: 's3://bucket/hero.png', formats: ['webp'] } }))
      .givenCapability('processor', {
        responses: [{ method: 'POST', path: '/resize', response: { phase: 'Processing' } }],
      })
      .run();

    expect(run.ok).toBe(false);
    if (!run.ok) {
      expect(run.error.code).toBe('CAPABILITY_MISSING');
    }
  });

  it('asserts manifest metadata, declared RBAC, structural schemas, and external-effect status locally', async () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: imageSpecSchema,
      status: imageStatusSchema,
    });

    const effect = externalEffectRecord(
      {
        capabilityName: 'processor',
        phase: 'Succeeded',
        idempotencyKey: 'image/hero-image',
        requestDigest: `sha256:${'a'.repeat(64)}`,
        responseDigest: `sha256:${'b'.repeat(64)}`,
      },
      { now: '2026-01-01T00:00:00.000Z' }
    );

    const imagePipeline = sdk.operator({
      name: 'image-pipeline',
      resources: { ImageJob },
      permissions: [{ apiGroups: ['batch'], resources: ['jobs'], verbs: ['get', 'list', 'watch', 'create', 'patch'] }],
      handlers: [ImageJob.on.reconcile(() => ({ status: { phase: 'Processing', effects: [effect] } }))],
    });

    const run = await testing
      .testOperator(imagePipeline)
      .given(ImageJob({ name: 'hero-image', spec: { sourceUrl: 's3://bucket/hero.png', formats: ['webp'] } }))
      .expectManifest({ operatorName: 'image-pipeline' })
      .expectManifest({ ownedCrds: ['media.applik8s.dev/v1alpha1/ImageJob'] })
      .expectRbac({ apiGroups: ['batch'], resources: ['jobs'], verbs: ['get', 'patch'] })
      .expectSchema('ImageJob', { structural: true, requiredFields: ['sourceUrl', 'formats'] })
      .expectExternalEffect(effect)
      .run();

    expect(run.ok).toBe(true);
    if (run.ok) {
      expect(run.value.assertionsPassed).toBe(5);
      expect(run.value.assertionFailures).toEqual([]);
    }
  });

  it('fails explicitly when an expectation is still not implemented by the local harness', async () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: imageSpecSchema,
      status: imageStatusSchema,
    });

    const imagePipeline = sdk.operator({
      name: 'image-pipeline',
      resources: { ImageJob },
      handlers: [ImageJob.on.reconcile(() => undefined)],
    });

    const run = await testing
      .testOperator(imagePipeline)
      .given(ImageJob({ name: 'hero-image', spec: { sourceUrl: 's3://bucket/hero.png', formats: ['webp'] } }))
      .expectManagedBy({
        operatorName: 'image-pipeline',
        bundleDigest: `sha256:${'c'.repeat(64)}`,
        runtimeVersion: '0.1.0',
        handlerAbi: 'applik8s.handler/v1alpha1',
        operatorManifest: 'applik8s.operator/v1alpha1',
      })
      .run();

    expect(run.ok).toBe(true);
    if (run.ok) {
      expect(run.value.assertionsPassed).toBe(0);
      expect(run.value.assertionFailures).toEqual([{ expectation: 'managedBy', message: 'The local test harness does not implement managedBy assertions yet.' }]);
    }
  });
});
