import type { CapabilityDescriptor, GraphAdapter, JsonSchemaSource, OperationTarget } from '@applik8s/core';
import { describe, expect, it } from 'vitest';
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
  it('exposes typed built-in Kubernetes permission bundles', () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: specSchema,
      status: statusSchema,
    });

    expect(ImageJob.permissions.read()).toEqual({ apiGroups: ['media.applik8s.dev'], resources: ['imagejobs'], verbs: ['get', 'list'] });
    expect(ImageJob.permissions.watch()).toEqual({ apiGroups: ['media.applik8s.dev'], resources: ['imagejobs'], verbs: ['get', 'list', 'watch'] });
    expect(ImageJob.permissions.apply()).toEqual({ apiGroups: ['media.applik8s.dev'], resources: ['imagejobs'], verbs: ['create', 'update', 'patch'] });
    expect(ImageJob.permissions.patch()).toEqual({ apiGroups: ['media.applik8s.dev'], resources: ['imagejobs'], verbs: ['patch'] });
    expect(ImageJob.permissions.patchStatus()).toEqual({ apiGroups: ['media.applik8s.dev'], resources: ['imagejobs/status'], verbs: ['get', 'patch', 'update'] });
    expect(ImageJob.permissions.delete()).toEqual({ apiGroups: ['media.applik8s.dev'], resources: ['imagejobs'], verbs: ['delete'] });
    expect(ImageJob.permissions.finalize()).toEqual({ apiGroups: ['media.applik8s.dev'], resources: ['imagejobs/finalizers'], verbs: ['patch', 'update'] });
    expect(ImageJob.permissions.manage()).toEqual([
      { apiGroups: ['media.applik8s.dev'], resources: ['imagejobs'], verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'] },
      { apiGroups: ['media.applik8s.dev'], resources: ['imagejobs/status'], verbs: ['get', 'patch', 'update'] },
      { apiGroups: ['media.applik8s.dev'], resources: ['imagejobs/finalizers'], verbs: ['patch', 'update'] },
    ]);
    expect(sdk.permissions.k8s.ConfigMap.apply()).toEqual({ apiGroups: [''], resources: ['configmaps'], verbs: ['get', 'create', 'update', 'patch'] });
    expect(sdk.permissions.k8s.Deployment.manage()).toEqual([
      { apiGroups: ['apps'], resources: ['deployments'], verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'] },
      { apiGroups: ['apps'], resources: ['deployments/status'], verbs: ['get', 'patch', 'update'] },
      { apiGroups: ['apps'], resources: ['deployments/finalizers'], verbs: ['patch', 'update'] },
    ]);
    expect(sdk.permissions.k8s.Deployment.patchStatus()).toEqual({ apiGroups: ['apps'], resources: ['deployments/status'], verbs: ['get', 'patch', 'update'] });
    expect(sdk.permissions.k8s.Deployment.finalize()).toEqual({ apiGroups: ['apps'], resources: ['deployments/finalizers'], verbs: ['patch', 'update'] });
    expect(sdk.permissions.events.write()).toEqual({ apiGroups: [''], resources: ['events'], verbs: ['create', 'patch', 'update'] });
  });

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

  it('lowers operation-target apply through operationTargetArtifacts only', async () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: specSchema,
      status: statusSchema,
    });
    const target = artifactOnlyOperationTarget();
    const operator = sdk.operator({
      name: 'artifact-target-apply-pipeline',
      resources: { ImageJob },
      handlers: [
        ImageJob.on.context.reconcile(async (_job, ctx) => ctx.apply(target, { fieldManager: 'artifact-manager' })),
      ],
    });

    const output = await dispatchOperatorHandler(operator.definition, JSON.stringify({
      abiVersion: 'applik8s.handler/v1alpha1',
      handlerId: 'ImageJob.reconcile.0',
      event: 'reconcile',
      object: { apiVersion: 'media.applik8s.dev/v1alpha1', kind: 'ImageJob', metadata: { name: 'hero', namespace: 'media' }, spec: { sourceUrl: 's3://bucket/hero.png' } },
    }));

    expect(Object.hasOwn(target, '__applik8sApplyResources')).toBe(false);
    expect(Object.hasOwn(target, '__applik8sDeleteRefs')).toBe(false);
    expect(JSON.parse(output)).toEqual({
      operations: [{ kind: 'apply', resource: { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'artifact-target', namespace: 'media' } }, fieldManager: 'artifact-manager' }],
    });
  });

  it('lowers operation-target delete through operationTargetArtifacts only', async () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: specSchema,
      status: statusSchema,
    });
    const target = artifactOnlyOperationTarget();
    const operator = sdk.operator({
      name: 'artifact-target-delete-pipeline',
      resources: { ImageJob },
      handlers: [
        ImageJob.on.context.reconcile(async (_job, ctx) => ctx.delete(target, { propagationPolicy: 'Foreground' })),
      ],
    });

    const output = await dispatchOperatorHandler(operator.definition, JSON.stringify({
      abiVersion: 'applik8s.handler/v1alpha1',
      handlerId: 'ImageJob.reconcile.0',
      event: 'reconcile',
      object: { apiVersion: 'media.applik8s.dev/v1alpha1', kind: 'ImageJob', metadata: { name: 'hero', namespace: 'media' }, spec: { sourceUrl: 's3://bucket/hero.png' } },
    }));

    expect(JSON.parse(output)).toEqual({
      operations: [{ kind: 'delete', ref: { apiVersion: 'v1', kind: 'ConfigMap', name: 'artifact-target', namespace: 'media' }, options: { propagationPolicy: 'Foreground' } }],
    });
  });

  it('lowers operation-target dry-run plans through operationTargetArtifacts only', async () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: specSchema,
      status: statusSchema,
    });
    const target = artifactOnlyOperationTarget();
    const operator = sdk.operator({
      name: 'artifact-target-dry-run-pipeline',
      resources: { ImageJob },
      handlers: [
        ImageJob.on.context.reconcile(async (_job, ctx) => {
          const plan = ctx.plan(target, { dryRun: true, fieldManager: 'dry-run-manager' });
          if (!plan.ok) {
            return plan;
          }
          const operation = plan.value.operations[0];
          if (operation?.kind !== 'apply') {
            throw new Error('Expected dry-run plan to contain one apply operation.');
          }
          return { ok: true, value: { events: [{ kind: 'event', type: 'Normal', reason: 'DryRunPlanned', message: operation.resource.metadata.name }] } };
        }),
      ],
    });

    const output = await dispatchOperatorHandler(operator.definition, JSON.stringify({
      abiVersion: 'applik8s.handler/v1alpha1',
      handlerId: 'ImageJob.reconcile.0',
      event: 'reconcile',
      object: { apiVersion: 'media.applik8s.dev/v1alpha1', kind: 'ImageJob', metadata: { name: 'hero', namespace: 'media' }, spec: { sourceUrl: 's3://bucket/hero.png' } },
    }));

    expect(JSON.parse(output)).toEqual({
      operations: [{ kind: 'event', type: 'Normal', reason: 'DryRunPlanned', message: 'artifact-target-dry-run' }],
    });
  });

  it('fails operation-target dry-run planning closed when the artifact is missing', async () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: specSchema,
      status: statusSchema,
    });
    const target = artifactOnlyOperationTarget({ dryRun: false });
    const operator = sdk.operator({
      name: 'artifact-target-missing-dry-run-pipeline',
      resources: { ImageJob },
      handlers: [
        ImageJob.on.context.reconcile(async (_job, ctx) => {
          const plan = ctx.plan(target, { dryRun: true });
          if (!plan.ok) {
            return { ok: false, error: plan.error };
          }
          return { ok: true, value: {} };
        }),
      ],
    });

    await expect(dispatchOperatorHandler(operator.definition, JSON.stringify({
      abiVersion: 'applik8s.handler/v1alpha1',
      handlerId: 'ImageJob.reconcile.0',
      event: 'reconcile',
      object: { apiVersion: 'media.applik8s.dev/v1alpha1', kind: 'ImageJob', metadata: { name: 'hero', namespace: 'media' }, spec: { sourceUrl: 's3://bucket/hero.png' } },
    }))).rejects.toThrow('Operation target dry-run artifact is missing; dry-run planning fails closed.');
  });

  it('routes typed Kubernetes reads through a supplied host import', async () => {
    interface GuestBookSpec { readonly title: string }
    interface GuestBookStatus { readonly entryCount?: number }
    interface EntrySpec { readonly guestbook: string; readonly author: string; readonly message: string }
    interface EntryStatus { readonly accepted?: boolean }
    const GuestBook = sdk.crd<GuestBookSpec, GuestBookStatus>({
      apiVersion: 'demo.applik8s.dev/v1alpha1',
      kind: 'GuestBook',
      spec: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'GuestBookSpec' }, schema: { type: 'object', required: ['title'], properties: { title: { type: 'string' } } } },
      status: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'GuestBookStatus' }, schema: { type: 'object', properties: { entryCount: { type: 'number' } } } },
    });
    const GuestBookEntry = sdk.crd<EntrySpec, EntryStatus>({
      apiVersion: 'demo.applik8s.dev/v1alpha1',
      kind: 'GuestBookEntry',
      spec: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'EntrySpec' }, schema: { type: 'object', required: ['guestbook', 'author', 'message'], properties: { guestbook: { type: 'string' }, author: { type: 'string' }, message: { type: 'string' } } } },
      status: { kind: 'jsonSchema', ref: { kind: 'jsonSchema', exportName: 'EntryStatus' }, schema: { type: 'object', properties: { accepted: { type: 'boolean' } } } },
    });
    const operator = sdk.operator({
      name: 'guestbook',
      resources: { GuestBook, GuestBookEntry },
      handlers: [
        GuestBook.on.reconcile(async (book) => {
          const entries = await book.read.resource(GuestBookEntry).list({
            namespace: book.metadata.namespace ?? 'default',
            labels: { 'guestbook.applik8s.dev/book': book.metadata.name },
            orderBy: 'metadata.creationTimestamp',
          });
          if (!entries.items.some((entry) => entry.spec.author === 'Ada')) {
            throw new Error('typed GuestBookEntry read result missing Ada');
          }
          book.status.entryCount = entries.items.length;
        }),
      ],
    });

    const output = await dispatchOperatorHandler(operator.definition, JSON.stringify({
      abiVersion: 'applik8s.handler/v1alpha1',
      handlerId: 'GuestBook.reconcile.0',
      event: 'reconcile',
      object: {
        apiVersion: 'demo.applik8s.dev/v1alpha1',
        kind: 'GuestBook',
        metadata: { name: 'main', namespace: 'demo' },
        spec: { title: 'Demo' },
      },
      runtime: { reconcileId: 'GuestBook-main' },
    }), {
      kubernetesRead(requestJson) {
        // typecast: test-only request inspection narrows parsed JSON to the expected host-read request envelope.
        const request = JSON.parse(requestJson) as { readonly operation: string; readonly apiVersion: string; readonly kind: string; readonly query: object };
        expect(request).toMatchObject({
          operation: 'list',
          apiVersion: 'demo.applik8s.dev/v1alpha1',
          kind: 'GuestBookEntry',
          query: { namespace: 'demo', labels: { 'guestbook.applik8s.dev/book': 'main' }, orderBy: 'metadata.creationTimestamp' },
        });
        return JSON.stringify({
          ok: true,
          value: {
            items: [
              { apiVersion: 'demo.applik8s.dev/v1alpha1', kind: 'GuestBookEntry', metadata: { name: 'one', namespace: 'demo' }, spec: { guestbook: 'main', author: 'Ada', message: 'Hello' } },
              { apiVersion: 'demo.applik8s.dev/v1alpha1', kind: 'GuestBookEntry', metadata: { name: 'two', namespace: 'demo' }, spec: { guestbook: 'main', author: 'Grace', message: 'Ship it' } },
            ],
          },
        });
      },
    });

    expect(JSON.parse(output)).toEqual({ operations: [{ kind: 'status', status: { entryCount: 2 } }] });
  });

  it('fails explicitly when typed Kubernetes reads have no host import', async () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: specSchema,
      status: statusSchema,
    });
    const operator = sdk.operator({
      name: 'read-pipeline',
      resources: { ImageJob },
      handlers: [
        ImageJob.on.reconcile(async (job) => {
          await job.read.resource(ImageJob).get({ name: job.metadata.name, namespace: job.metadata.namespace ?? 'default' });
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
    }))).rejects.toThrow('Typed Kubernetes reads require the kubernetes-read host import');
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

function artifactOnlyOperationTarget(options: { readonly dryRun?: boolean } = {}): OperationTarget<ImageStatus> {
  return {
    targetKind: 'operationTarget',
    // typecast: dispatcher regression exercises precomputed operationTargetArtifacts and does not invoke adapter methods.
    adapter: {} as OperationTarget<ImageStatus>['adapter'],
    operationTargetArtifacts: {
      applyPlan: { operations: [{ kind: 'apply', resource: { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'artifact-target', namespace: 'media' } } }] },
      deletePlan: { operations: [{ kind: 'delete', ref: { apiVersion: 'v1', kind: 'ConfigMap', name: 'artifact-target', namespace: 'media' } }] },
      ...(options.dryRun === false ? {} : { dryRunPlan: { operations: [{ kind: 'apply', resource: { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'artifact-target-dry-run', namespace: 'media' } } }] } }),
    },
  };
}

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
