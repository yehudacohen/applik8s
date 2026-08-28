// typecast-file-boundary: Runtime SDK fixtures use controlled structural casts
// to exercise generated proxy and schema behavior at the public boundary.
import type { JsonSchemaSource } from '@applik8s/core';
import { describe, expect, it } from 'vitest';
import { sdk } from '../src/index.js';

interface ImageSpec {
  readonly sourceUrl: string;
}

interface ImageStatus {
  readonly phase?: 'Processing';
}

const imageSpecSchema: JsonSchemaSource<ImageSpec> = {
  kind: 'jsonSchema',
  ref: { kind: 'jsonSchema', exportName: 'ImageSpec' },
  schema: {
    type: 'object',
    required: ['sourceUrl'],
    additionalProperties: false,
    properties: { sourceUrl: { type: 'string' } },
  },
};

const imageStatusSchema: JsonSchemaSource<ImageStatus> = {
  kind: 'jsonSchema',
  ref: { kind: 'jsonSchema', exportName: 'ImageStatus' },
  schema: {
    type: 'object',
    properties: { phase: { type: 'string' } },
  },
};

describe('SDK runtime API honesty', () => {
  it('attributes imported reconcile handlers to their declaring module rather than the SDK registrar', () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: imageSpecSchema,
      status: imageStatusSchema,
    });
    const registration = ImageJob.on.reconcile(async function reconcileImage() {});
    const metadata = Reflect.get(
      registration,
      Symbol.for('applik8s.handlerSourceModule'),
    ) as { readonly file?: unknown } | undefined;

    expect(metadata?.file).toContain('/packages/sdk/test/runtime.vertical.test.ts');
    expect(metadata?.file).not.toMatch(/packages\/sdk\/(?:src|dist)\/runtime\.(?:ts|js)$/u);
  });

  it('does not expose pre-compile install resources from callable operators', () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: imageSpecSchema,
      status: imageStatusSchema,
    });
    const imagePipeline = sdk.operator({
      name: 'image-pipeline',
      resources: { ImageJob },
      handlers: [],
    });

    const deployed = imagePipeline({ namespace: 'media' });

    expect('installResources' in deployed).toBe(false);
    expect(deployed.namespace).toBe('media');
    expect(deployed.ImageJob({ name: 'hero-image', spec: { sourceUrl: 's3://bucket/hero.png' } }).metadata.namespace).toBe('media');
  });

  it('does not expose multi-operator bundling before lifecycle semantics exist', () => {
    expect('operatorBundle' in sdk).toBe(false);
  });
});
