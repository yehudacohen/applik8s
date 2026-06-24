import { describe, expect, it } from 'vitest';

import type { CapabilityDescriptor, GraphAdapter, JsonSchemaSource } from '@applik8s/core';
import { dispatchOperatorHandler, sdk } from '../src/index.js';

interface ImageSpec {
  readonly sourceUrl: string;
}

interface ImageStatus {
  readonly phase?: string;
}

const specSchema = {
  kind: 'jsonSchema',
  ref: { kind: 'jsonSchema', exportName: 'ImageSpec' },
  schema: {
    type: 'object',
    required: ['sourceUrl'],
    additionalProperties: false,
    properties: { sourceUrl: { type: 'string' } },
  },
} satisfies JsonSchemaSource<ImageSpec>;

const statusSchema = {
  kind: 'jsonSchema',
  ref: { kind: 'jsonSchema', exportName: 'ImageStatus' },
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: { phase: { type: 'string' } },
  },
} satisfies JsonSchemaSource<ImageStatus>;

describe('generated handler dispatcher', () => {
  it('exposes declared capabilities but denies live capability execution without a host import', async () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: specSchema,
      status: statusSchema,
    });
    const processor = sdk.external.http({ baseUrl: 'https://processor.example.test', auth: 'none' });
    const operator = sdk.operator({
      name: 'capability-pipeline',
      resources: { ImageJob },
      capabilities: { processor },
      handlers: [
        ImageJob.on.context.reconcile(async (_job, ctx) => {
          const client = ctx.capabilities.processor;
          if (!client) {
            throw new Error('processor capability missing');
          }
          await client.get('/healthz');
          return ctx.noop();
        }),
      ],
    });

    await expect(dispatchOperatorHandler(operator.definition, JSON.stringify({
      abiVersion: 'applik8s.handler/v1alpha1',
      handlerId: 'ImageJob.reconcile.0',
      event: 'reconcile',
      object: {
        apiVersion: 'media.applik8s.dev/v1alpha1',
        kind: 'ImageJob',
        metadata: { name: 'hero', namespace: 'media' },
        spec: { sourceUrl: 's3://bucket/hero.png' },
      },
      capabilities: { processor },
      runtime: { reconcileId: 'ImageJob-hero' },
    }))).rejects.toThrow('Capability processor is declared but live capability execution is not implemented');
  });

  it('routes declared capability calls through a supplied host import', async () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: specSchema,
      status: statusSchema,
    });
    const processor = sdk.external.http({ baseUrl: 'https://processor.example.test', auth: 'none' });
    const operator = sdk.operator({
      name: 'capability-pipeline',
      resources: { ImageJob },
      capabilities: { processor },
      handlers: [
        ImageJob.on.context.reconcile(async (_job, ctx) => {
          const client = ctx.capabilities.processor;
          if (!client) {
            throw new Error('processor capability missing');
          }
          const response = await client.get('/healthz');
          if (!response || typeof response !== 'object' || Reflect.get(response, 'ready') !== true) {
            throw new Error('unexpected capability response');
          }
          return ctx.apply({ status: { phase: 'Checked' } });
        }),
      ],
    });

    const output = await dispatchOperatorHandler(operator.definition, JSON.stringify({
      abiVersion: 'applik8s.handler/v1alpha1',
      handlerId: 'ImageJob.reconcile.0',
      event: 'reconcile',
      object: {
        apiVersion: 'media.applik8s.dev/v1alpha1',
        kind: 'ImageJob',
        metadata: { name: 'hero', namespace: 'media' },
        spec: { sourceUrl: 's3://bucket/hero.png' },
      },
      capabilities: { processor },
      runtime: { reconcileId: 'ImageJob-hero' },
    }), {
      capabilityRequest(requestJson) {
        // typecast: the test host import receives the runtime capability request wire JSON and asserts the expected subset.
        const request = JSON.parse(requestJson) as { readonly capabilityName: string; readonly method: string; readonly path: string };
        expect(request).toMatchObject({ capabilityName: 'processor', method: 'GET', path: '/healthz', reconcileId: 'ImageJob-hero' });
        return JSON.stringify({ ok: true, value: { ready: true } });
      },
    });

    expect(JSON.parse(output)).toEqual({ operations: [{ kind: 'status', status: { phase: 'Checked' } }] });
  });

  it('requires idempotency keys for mutation capability calls when declared by policy', async () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: specSchema,
      status: statusSchema,
    });
    const processor = retrySafeCapability('processor');
    const operator = sdk.operator({
      name: 'capability-pipeline',
      resources: { ImageJob },
      capabilities: { processor },
      handlers: [
        ImageJob.on.context.reconcile(async (_job, ctx) => {
          const client = ctx.capabilities.processor;
          if (!client) {
            throw new Error('processor capability missing');
          }
          await client.post('/jobs', { name: 'hero' });
          return ctx.noop();
        }),
      ],
    });

    await expect(dispatchOperatorHandler(operator.definition, JSON.stringify({
      abiVersion: 'applik8s.handler/v1alpha1',
      handlerId: 'ImageJob.reconcile.0',
      event: 'reconcile',
      object: {
        apiVersion: 'media.applik8s.dev/v1alpha1',
        kind: 'ImageJob',
        metadata: { name: 'hero', namespace: 'media' },
        spec: { sourceUrl: 's3://bucket/hero.png' },
      },
      capabilities: { processor },
      runtime: { reconcileId: 'ImageJob-hero' },
    }), {
      capabilityRequest() {
        throw new Error('host import must not receive non-idempotent mutation');
      },
    })).rejects.toThrow('requires options.idempotencyKey');
  });

  it('propagates idempotency and reconcile metadata for mutation capability calls', async () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: specSchema,
      status: statusSchema,
    });
    const processor = retrySafeCapability('processor');
    const operator = sdk.operator({
      name: 'capability-pipeline',
      resources: { ImageJob },
      capabilities: { processor },
      handlers: [
        ImageJob.on.context.reconcile(async (_job, ctx) => {
          const client = ctx.capabilities.processor;
          if (!client) {
            throw new Error('processor capability missing');
          }
          await client.post('/jobs', { name: 'hero' }, { idempotencyKey: `${ctx.reconcileId}:submit` });
          return ctx.apply({ status: { phase: 'Checked' } });
        }),
      ],
    });

    const output = await dispatchOperatorHandler(operator.definition, JSON.stringify({
      abiVersion: 'applik8s.handler/v1alpha1',
      handlerId: 'ImageJob.reconcile.0',
      event: 'reconcile',
      object: {
        apiVersion: 'media.applik8s.dev/v1alpha1',
        kind: 'ImageJob',
        metadata: { name: 'hero', namespace: 'media' },
        spec: { sourceUrl: 's3://bucket/hero.png' },
      },
      capabilities: { processor },
      runtime: { reconcileId: 'ImageJob-hero' },
    }), {
      capabilityRequest(requestJson) {
        // typecast: the test host import asserts the exact capability request wire shape for this scenario.
        const request = JSON.parse(requestJson) as { readonly capabilityName: string; readonly method: string; readonly path: string; readonly body: object; readonly options: { readonly idempotencyKey: string }; readonly reconcileId: string };
        expect(request).toMatchObject({
          capabilityName: 'processor',
          method: 'POST',
          path: '/jobs',
          body: { name: 'hero' },
          options: { idempotencyKey: 'ImageJob-hero:submit' },
          reconcileId: 'ImageJob-hero',
        });
        return JSON.stringify({ ok: true, value: { accepted: true } });
      },
    });

    expect(JSON.parse(output)).toEqual({ operations: [{ kind: 'status', status: { phase: 'Checked' } }] });
  });

  it('rejects malformed successful capability host responses', async () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: specSchema,
      status: statusSchema,
    });
    const processor = sdk.external.http({ baseUrl: 'https://processor.example.test', auth: 'none' });
    const operator = sdk.operator({
      name: 'capability-pipeline',
      resources: { ImageJob },
      capabilities: { processor },
      handlers: [
        ImageJob.on.context.reconcile(async (_job, ctx) => {
          const client = ctx.capabilities.processor;
          if (!client) {
            throw new Error('processor capability missing');
          }
          await client.get('/healthz');
          return ctx.noop();
        }),
      ],
    });

    await expect(dispatchOperatorHandler(operator.definition, JSON.stringify({
      abiVersion: 'applik8s.handler/v1alpha1',
      handlerId: 'ImageJob.reconcile.0',
      event: 'reconcile',
      object: {
        apiVersion: 'media.applik8s.dev/v1alpha1',
        kind: 'ImageJob',
        metadata: { name: 'hero', namespace: 'media' },
        spec: { sourceUrl: 's3://bucket/hero.png' },
      },
      capabilities: { processor },
      runtime: { reconcileId: 'ImageJob-hero' },
    }), {
      capabilityRequest() {
        return JSON.stringify({ ok: true });
      },
    })).rejects.toThrow('Capability host returned an invalid response payload');
  });

  it('preserves handler stack frames in dispatcher failures', async () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: specSchema,
      status: statusSchema,
    });
    function failFromApplicationHelper(): never {
      throw new Error('image processor exploded');
    }
    const operator = sdk.operator({
      name: 'failing-pipeline',
      resources: { ImageJob },
      handlers: [
        ImageJob.on.reconcile(() => {
          failFromApplicationHelper();
        }),
      ],
    });

    await expect(dispatchOperatorHandler(operator.definition, JSON.stringify({
      abiVersion: 'applik8s.handler/v1alpha1',
      handlerId: 'ImageJob.reconcile.0',
      event: 'reconcile',
      object: {
        apiVersion: 'media.applik8s.dev/v1alpha1',
        kind: 'ImageJob',
        metadata: { name: 'hero', namespace: 'media' },
        spec: { sourceUrl: 's3://bucket/hero.png' },
      },
      runtime: { reconcileId: 'ImageJob-hero' },
    }))).rejects.toThrow(/image processor exploded[\s\S]*failFromApplicationHelper/);
  });

  it('applies graph adapter plans through proxy handlers in the canonical dispatcher', async () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: specSchema,
      status: statusSchema,
    });
    const graphAdapter: GraphAdapter<{ readonly name: string }, ImageStatus, { readonly namespace: string }> = {
      render(graph, spec) {
        return {
          ok: true,
          value: {
            operations: [
              {
                kind: 'apply',
                resource: {
                  apiVersion: 'v1',
                  kind: 'ConfigMap',
                  metadata: { name: graph.name, namespace: spec.namespace },
                  data: { source: 'graph' },
                },
              },
              { kind: 'status', status: { phase: 'GraphApplied' } },
            ],
          },
        };
      },
      inferRbac() {
        return { ok: true, value: [] };
      },
      renderStatus() {
        return { ok: true, value: {} };
      },
    };
    const operator = sdk.operator({
      name: 'graph-pipeline',
      resources: { ImageJob },
      handlers: [
        ImageJob.on.reconcile((job) => {
          job.applyGraph({ graph: { name: 'hero-config' }, spec: { namespace: 'media' }, adapter: graphAdapter });
        }),
      ],
    });

    const output = await dispatchOperatorHandler(operator.definition, JSON.stringify({
      abiVersion: 'applik8s.handler/v1alpha1',
      handlerId: 'ImageJob.reconcile.0',
      event: 'reconcile',
      object: {
        apiVersion: 'media.applik8s.dev/v1alpha1',
        kind: 'ImageJob',
        metadata: { name: 'hero', namespace: 'media' },
        spec: { sourceUrl: 's3://bucket/hero.png' },
      },
      runtime: { reconcileId: 'ImageJob-hero' },
    }));

    expect(JSON.parse(output)).toEqual({
      operations: [
        {
          kind: 'apply',
          resource: {
            apiVersion: 'v1',
            kind: 'ConfigMap',
            metadata: { name: 'hero-config', namespace: 'media' },
            data: { source: 'graph' },
          },
        },
        { kind: 'status', status: { phase: 'GraphApplied' } },
      ],
    });
  });

  it('returns graph adapter errors through context handlers in the canonical dispatcher', async () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: specSchema,
      status: statusSchema,
    });
    const graphAdapter: GraphAdapter<object, ImageStatus, object> = {
      render() {
        return { ok: false, error: { code: 'HANDLER_OUTPUT_INVALID', message: 'graph render failed', severity: 'error', context: {} } };
      },
      inferRbac() {
        return { ok: true, value: [] };
      },
      renderStatus() {
        return { ok: true, value: {} };
      },
    };
    const operator = sdk.operator({
      name: 'graph-pipeline',
      resources: { ImageJob },
      handlers: [
        ImageJob.on.context.reconcile((_job, ctx) => ctx.applyGraph({ graph: {}, spec: {}, adapter: graphAdapter })),
      ],
    });

    await expect(dispatchOperatorHandler(operator.definition, JSON.stringify({
      abiVersion: 'applik8s.handler/v1alpha1',
      handlerId: 'ImageJob.reconcile.0',
      event: 'reconcile',
      object: {
        apiVersion: 'media.applik8s.dev/v1alpha1',
        kind: 'ImageJob',
        metadata: { name: 'hero', namespace: 'media' },
        spec: { sourceUrl: 's3://bucket/hero.png' },
      },
      runtime: { reconcileId: 'ImageJob-hero' },
    }))).rejects.toThrow('graph render failed');
  });
});

function retrySafeCapability(name: string): CapabilityDescriptor {
  return {
    name,
    kind: 'http',
    endpoint: 'https://processor.example.test',
    auth: { type: 'none' },
    policy: { failureMode: 'rejectPromiseWithApplik8sError', idempotencyKeyRequired: true },
    execution: {
      liveExecution: 'hostProtocol',
      protocol: 'applik8s.capability/v1alpha1',
      audit: { recordRequests: true, recordResponses: true, includePayloads: false },
      redaction: { requestBody: 'redacted', responseBody: 'redacted', headers: 'redacted', errors: 'publicMessageOnly' },
      idempotency: { requiredForMutations: true, keySource: 'handlerProvided' },
    },
  };
}
