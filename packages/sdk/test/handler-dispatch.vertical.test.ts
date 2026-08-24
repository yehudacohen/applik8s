// typecast-file-boundary: host-protocol fixtures intentionally construct erased and malformed dispatch payloads to verify runtime validation boundaries.
import type { CapabilityDescriptor, GraphAdapter, JsonSchemaSource, OperationTarget } from '@applik8s/core';
import { describe, expect, it, vi } from 'vitest';
import { dispatchOperatorHandler, sdk } from '../src/index.js';

interface ImageSpec {
  readonly sourceUrl: string;
}

interface ImageStatus {
  readonly phase?: string;
}

const remoteConnectionCapability = sdk.kubernetes.connection.required({
  endpointPolicy: 'workload-cluster-apis',
  permissions: [{ apiGroups: [''], resources: ['configmaps'], verbs: ['get', 'list', 'patch', 'delete'], namespaces: ['media', 'demo'] }],
});

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
  it('infers Kubernetes connection aliases in operator-scoped handlers', () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1', kind: 'ImageJob', spec: specSchema, status: statusSchema,
    });
    const processor = sdk.external.http({ baseUrl: 'https://processor.example.test', auth: 'none' });
    const operator = sdk.operator({
      name: 'typed-connection-pipeline',
      resources: { ImageJob },
      capabilities: { destination: remoteConnectionCapability, processor },
      handlers: ({ resources }) => [
        resources.ImageJob.on.context.reconcile((_job, ctx) => {
          ctx.kubernetes.connection('destination');
          // @ts-expect-error HTTP capability aliases cannot select a Kubernetes connection.
          ctx.kubernetes.connection('processor');
          // @ts-expect-error undeclared aliases cannot select a Kubernetes connection.
          ctx.kubernetes.connection('missing');
          return ctx.noop();
        }),
      ],
    });

    expect(operator.definition.handlers).toHaveLength(1);
  });

  it('exposes typed built-in Kubernetes permission bundles', () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: specSchema,
      status: statusSchema,
    });

    expect(ImageJob.permissions.read()).toEqual({ apiGroups: ['media.applik8s.dev'], resources: ['imagejobs'], verbs: ['get', 'list'], scope: 'Namespaced' });
    expect(ImageJob.permissions.watch()).toEqual({ apiGroups: ['media.applik8s.dev'], resources: ['imagejobs'], verbs: ['get', 'list', 'watch'], scope: 'Namespaced' });
    expect(ImageJob.permissions.apply()).toEqual({ apiGroups: ['media.applik8s.dev'], resources: ['imagejobs'], verbs: ['create', 'update', 'patch'], scope: 'Namespaced' });
    expect(ImageJob.permissions.patch()).toEqual({ apiGroups: ['media.applik8s.dev'], resources: ['imagejobs'], verbs: ['patch'], scope: 'Namespaced' });
    expect(ImageJob.permissions.patchStatus()).toEqual({ apiGroups: ['media.applik8s.dev'], resources: ['imagejobs/status'], verbs: ['get', 'patch', 'update'], scope: 'Namespaced' });
    expect(ImageJob.permissions.delete()).toEqual({ apiGroups: ['media.applik8s.dev'], resources: ['imagejobs'], verbs: ['delete'], scope: 'Namespaced' });
    expect(ImageJob.permissions.finalize()).toEqual({ apiGroups: ['media.applik8s.dev'], resources: ['imagejobs/finalizers'], verbs: ['patch', 'update'], scope: 'Namespaced' });
    expect(ImageJob.permissions.manage()).toEqual([
      { apiGroups: ['media.applik8s.dev'], resources: ['imagejobs'], verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'], scope: 'Namespaced' },
      { apiGroups: ['media.applik8s.dev'], resources: ['imagejobs/status'], verbs: ['get', 'patch', 'update'], scope: 'Namespaced' },
      { apiGroups: ['media.applik8s.dev'], resources: ['imagejobs/finalizers'], verbs: ['patch', 'update'], scope: 'Namespaced' },
    ]);
    expect(sdk.permissions.k8s.ConfigMap.apply()).toEqual({ apiGroups: [''], resources: ['configmaps'], verbs: ['get', 'create', 'update', 'patch'], scope: 'Namespaced' });
    expect(sdk.permissions.k8s.Deployment.manage()).toEqual([
      { apiGroups: ['apps'], resources: ['deployments'], verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'], scope: 'Namespaced' },
      { apiGroups: ['apps'], resources: ['deployments/status'], verbs: ['get', 'patch', 'update'], scope: 'Namespaced' },
      { apiGroups: ['apps'], resources: ['deployments/finalizers'], verbs: ['patch', 'update'], scope: 'Namespaced' },
    ]);
    expect(sdk.permissions.k8s.Deployment.patchStatus()).toEqual({ apiGroups: ['apps'], resources: ['deployments/status'], verbs: ['get', 'patch', 'update'], scope: 'Namespaced' });
    expect(sdk.permissions.k8s.Deployment.finalize()).toEqual({ apiGroups: ['apps'], resources: ['deployments/finalizers'], verbs: ['patch', 'update'], scope: 'Namespaced' });
    expect(sdk.permissions.events.write()).toEqual({ apiGroups: [''], resources: ['events'], verbs: ['create', 'patch', 'update'], scope: 'Namespaced' });
  });

  it('preserves cluster scope in generated CRD permission bundles', () => {
    const GlobalPolicy = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'policy.applik8s.dev/v1alpha1',
      kind: 'GlobalPolicy',
      scope: 'Cluster',
      spec: specSchema,
      status: statusSchema,
    });

    expect(GlobalPolicy.permissions.read()).toEqual({
      apiGroups: ['policy.applik8s.dev'],
      resources: ['globalpolicies'],
      verbs: ['get', 'list'],
      scope: 'Cluster',
    });
    expect(GlobalPolicy.permissions.manage()).toEqual(expect.arrayContaining([
      expect.objectContaining({ resources: ['globalpolicies'], scope: 'Cluster' }),
      expect.objectContaining({ resources: ['globalpolicies/status'], scope: 'Cluster' }),
      expect.objectContaining({ resources: ['globalpolicies/finalizers'], scope: 'Cluster' }),
    ]));
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

  it('hydrates the private workflow gateway as an execution-scoped runtime', async () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: specSchema,
      status: statusSchema,
    });
    const workflowGateway = {
      name: 'applik8s-workflow-media',
      kind: 'http',
      endpoint: 'http://media-workflows.media.svc:8001',
      auth: { type: 'serviceAccount' },
      workflowGateway: {
        protocol: 'applik8s.workflow-gateway/v1alpha1',
        worker: 'media-workflows',
        contracts: ['media.process.v1'],
        caller: {
          operator: 'workflow-gateway-pipeline',
          namespace: 'media',
          serviceAccount: 'workflow-gateway-pipeline-controller',
        },
      },
      policy: {
        failureMode: 'rejectPromiseWithApplik8sError',
        idempotencyKeyRequired: true,
      },
    } satisfies CapabilityDescriptor;
    const operator = sdk.operator({
      name: 'workflow-gateway-pipeline',
      resources: { ImageJob },
      capabilities: { 'applik8s-workflow-media': workflowGateway },
      handlers: [
        ImageJob.on.reconcile(async (job) => {
          const resolver = Reflect.get(
            globalThis,
            Symbol.for('applik8s.workflowRuntimeResolver'),
          );
          if (typeof resolver !== 'function') {
            throw new Error('workflow runtime was not hydrated');
          }
          const runtime = resolver() as {
            start(
              contract: string,
              input: object,
              metadata: object,
            ): Promise<{
              observe(): Promise<{ readonly phase: string }>;
            }>;
          };
          const run = await runtime.start(
            'media.process.v1',
            { sourceUrl: job.spec.sourceUrl },
            { idempotencyKey: `${job.metadata.uid}:${job.metadata.generation}` },
          );
          job.status.phase = (await run.observe()).phase;
        }),
      ],
    });
    const requests: object[] = [];
    const output = await dispatchOperatorHandler(
      operator.definition,
      JSON.stringify({
        handlerId: 'ImageJob.reconcile.0',
        event: 'reconcile',
        object: {
          apiVersion: 'media.applik8s.dev/v1alpha1',
          kind: 'ImageJob',
          metadata: {
            name: 'hero',
            namespace: 'media',
            uid: 'uid-hero',
            generation: 2,
          },
          spec: { sourceUrl: 's3://bucket/hero.png' },
        },
        capabilities: { 'applik8s-workflow-media': workflowGateway },
        runtime: { reconcileId: 'ImageJob-hero' },
      }),
      {
        capabilityRequest(requestJson) {
          const request = JSON.parse(requestJson) as {
            readonly method: string;
            readonly path: string;
          };
          requests.push(request);
          return request.method === 'POST'
            ? JSON.stringify({
                ok: true,
                value: {
                  id: 'opaque-run-reference',
                  admittedAt: '2026-07-31T12:00:00.000Z',
                },
              })
            : JSON.stringify({
                ok: true,
                value: {
                  phase: 'Running',
                  admittedAt: '2026-07-31T12:00:00.000Z',
                },
              });
        },
      },
    );

    expect(requests).toMatchObject([
      {
        capabilityName: 'applik8s-workflow-media',
        method: 'POST',
        path: '/v1/workflows/media.process.v1/runs',
        options: { idempotencyKey: 'uid-hero:2' },
      },
      {
        capabilityName: 'applik8s-workflow-media',
        method: 'GET',
        path: '/v1/workflows/media.process.v1/runs/opaque-run-reference?admittedAt=2026-07-31T12%3A00%3A00.000Z',
      },
    ]);
    expect(JSON.parse(output)).toEqual({
      operations: [{ kind: 'status', status: { phase: 'Running' } }],
    });
    expect(
      Reflect.get(globalThis, Symbol.for('applik8s.workflowRuntimeResolver')),
    ).toBeUndefined();
  });

  it('adopts a status-tracked workflow admission before repeating the gateway start', async () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: specSchema,
      status: statusSchema,
    });
    const workflowGateway = {
      name: 'applik8s-workflow-media',
      kind: 'http',
      endpoint: 'http://media-workflows.media.svc:8001',
      auth: { type: 'serviceAccount' },
      workflowGateway: {
        protocol: 'applik8s.workflow-gateway/v1alpha1',
        worker: 'media-workflows',
        contracts: ['media.process.v1'],
        caller: {
          operator: 'workflow-gateway-adoption-pipeline',
          namespace: 'media',
          serviceAccount: 'workflow-gateway-adoption-pipeline-controller',
        },
      },
      policy: {
        failureMode: 'rejectPromiseWithApplik8sError',
        idempotencyKeyRequired: true,
      },
    } satisfies CapabilityDescriptor;
    const operator = sdk.operator({
      name: 'workflow-gateway-adoption-pipeline',
      resources: { ImageJob },
      capabilities: { 'applik8s-workflow-media': workflowGateway },
      handlers: [
        ImageJob.on.reconcile(async (job) => {
          const resolver = Reflect.get(
            globalThis,
            Symbol.for('applik8s.workflowRuntimeResolver'),
          );
          if (typeof resolver !== 'function') {
            throw new Error('workflow runtime was not hydrated');
          }
          const runtime = resolver() as {
            start(
              contract: string,
              input: object,
              metadata: object,
            ): Promise<{
              observe(): Promise<{ readonly phase: string }>;
            }>;
          };
          const run = await runtime.start(
            'media.process.v1',
            { sourceUrl: job.spec.sourceUrl },
            { idempotencyKey: 'proof-id' },
          );
          job.status.phase = (await run.observe()).phase;
        }),
      ],
    });
    const requests: Array<{ readonly method: string; readonly path: string }> = [];

    const output = await dispatchOperatorHandler(
      operator.definition,
      JSON.stringify({
        handlerId: 'ImageJob.reconcile.0',
        event: 'reconcile',
        object: {
          apiVersion: 'media.applik8s.dev/v1alpha1',
          kind: 'ImageJob',
          metadata: {
            name: 'hero',
            namespace: 'media',
            uid: 'uid-hero',
            generation: 2,
          },
          spec: { sourceUrl: 's3://bucket/hero.png' },
          status: {
            phase: 'Running',
            applik8s: {
              trackedExecutions: {
                process: {
                  resourceUid: 'uid-hero',
                  resourceGeneration: 2,
                  workflow: 'media.process.v1',
                  workflowRevision: 'v1',
                  run: 'opaque-existing-reference',
                  idempotencyKey: 'proof-id',
                  phase: 'Running',
                  admittedAt: '2026-07-31T12:00:00.000Z',
                  onGenerationChange: 'supersede',
                  onDelete: { action: 'detach' },
                },
              },
            },
          },
        },
        capabilities: { 'applik8s-workflow-media': workflowGateway },
        runtime: { reconcileId: 'ImageJob-hero' },
      }),
      {
        capabilityRequest(requestJson) {
          const request = JSON.parse(requestJson) as {
            readonly method: string;
            readonly path: string;
          };
          requests.push(request);
          if (request.method === 'POST') {
            throw new Error('tracked workflow adoption must not repeat admission');
          }
          return JSON.stringify({
            ok: true,
            value: {
              phase: 'Running',
              admittedAt: '2026-07-31T12:00:00.000Z',
            },
          });
        },
      },
    );

    expect(requests).toEqual([
      {
        capabilityName: 'applik8s-workflow-media',
        method: 'GET',
        options: {},
        path: '/v1/workflows/media.process.v1/runs/opaque-existing-reference?admittedAt=2026-07-31T12%3A00%3A00.000Z',
        reconcileId: 'ImageJob-hero',
      },
    ]);
    expect(JSON.parse(output)).toEqual({ operations: [] });
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

  it('threads one host-resolved connection through apply, patch, and delete operations', async () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: specSchema,
      status: statusSchema,
    });
    // typecast: preserves this fixture's Kubernetes reference literals for exact operation-plan comparison.
    const ref = { apiVersion: 'v1', kind: 'ConfigMap', name: 'remote-config', namespace: 'media' } as const;
    const operator = sdk.operator({
      name: 'connection-scoped-mutations',
      resources: { ImageJob },
      capabilities: { destination: remoteConnectionCapability },
      handlers: [
        ImageJob.on.reconcile((job) => {
          const destination = job.kubernetes.connection('destination');
          destination.resources.apply(job.k8s.ConfigMap({ name: 'remote-config', namespace: 'media' }), { ownership: { mode: 'none' }, authority: { mode: 'managed', identity: 'imagejob/hero/config', sourceUid: 'source-uid' } });
          destination.resources.patch(ref, [{ op: 'add', path: '/data', value: { ready: 'true' } }], { authority: { mode: 'existing', precondition: { uid: 'remote-uid', resourceVersion: '42' } } });
          destination.resources.delete(ref, { authority: { mode: 'existing', precondition: { uid: 'remote-uid', resourceVersion: '42' } } });
        }),
      ],
    });

    const output = await dispatchOperatorHandler(operator.definition, JSON.stringify({
      abiVersion: 'applik8s.handler/v1alpha1',
      handlerId: 'ImageJob.reconcile.0',
      event: 'reconcile',
      object: { apiVersion: 'media.applik8s.dev/v1alpha1', kind: 'ImageJob', metadata: { name: 'hero', namespace: 'media' }, spec: { sourceUrl: 's3://hero' } },
    }));

    expect(JSON.parse(output)).toEqual({ operations: [
      { kind: 'apply', resource: { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'remote-config', namespace: 'media' } }, ownership: { mode: 'none' }, connection: 'destination', authority: { mode: 'managed', identity: 'imagejob/hero/config', sourceUid: 'source-uid' } },
      { kind: 'patch', ref, patch: [{ op: 'add', path: '/data', value: { ready: 'true' } }], connection: 'destination', authority: { mode: 'existing', precondition: { uid: 'remote-uid', resourceVersion: '42' } } },
      { kind: 'delete', ref, connection: 'destination', authority: { mode: 'existing', precondition: { uid: 'remote-uid', resourceVersion: '42' } } },
    ] });
  });

  it('preserves recorded connection cleanup when a context finalizer returns noop', async () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: specSchema,
      status: statusSchema,
    });
    const operator = sdk.operator({
      name: 'connection-finalizer',
      resources: { ImageJob },
      capabilities: { destination: remoteConnectionCapability },
      handlers: [
        ImageJob.on.context.finalize((job, ctx) => {
          ctx.kubernetes.connection('destination').resources.delete(
            { apiVersion: 'v1', kind: 'ConfigMap', name: 'remote-config', namespace: 'media' },
            { authority: { mode: 'managed', identity: 'imagejob/hero/config', sourceUid: job.metadata.uid ?? '' } },
          );
          return ctx.noop();
        }, { finalizer: 'media.applik8s.dev/remote-cleanup' }),
      ],
    });

    const output = await dispatchOperatorHandler(operator.definition, JSON.stringify({
      abiVersion: 'applik8s.handler/v1alpha1',
      handlerId: 'ImageJob.finalize.0',
      event: 'finalize',
      object: { apiVersion: 'media.applik8s.dev/v1alpha1', kind: 'ImageJob', metadata: { name: 'hero', namespace: 'media', uid: 'source-uid', finalizers: ['media.applik8s.dev/remote-cleanup'], deletionTimestamp: '2026-07-14T00:00:00Z' }, spec: { sourceUrl: 's3://hero' } },
    }));

    expect(JSON.parse(output)).toEqual({ operations: [{
      kind: 'delete',
      ref: { apiVersion: 'v1', kind: 'ConfigMap', name: 'remote-config', namespace: 'media' },
      connection: 'destination',
      authority: { mode: 'managed', identity: 'imagejob/hero/config', sourceUid: 'source-uid' },
    }] });
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
      capabilities: { destination: remoteConnectionCapability },
      handlers: [
        GuestBook.on.reconcile(async (book) => {
          const entries = await book.kubernetes.connection('destination').read.resource(GuestBookEntry).list({
            namespace: book.metadata.namespace ?? 'default',
            labels: { 'guestbook.applik8s.dev/book': book.metadata.name },
            orderBy: 'metadata.creationTimestamp',
            limit: 100,
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
        const request = JSON.parse(requestJson) as { readonly protocol: string; readonly operation: string; readonly apiVersion: string; readonly kind: string; readonly connection: string; readonly query: object };
        expect(request).toMatchObject({
          operation: 'list',
          apiVersion: 'demo.applik8s.dev/v1alpha1',
          kind: 'GuestBookEntry',
          protocol: 'applik8s.kubernetes-connection/v1alpha1',
          connection: 'destination',
          query: { namespace: 'demo', labels: { 'guestbook.applik8s.dev/book': 'main' }, orderBy: 'metadata.creationTimestamp', limit: 100 },
        });
        expect(request.query).not.toHaveProperty('connection');
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

  it('registers declared external and arbitrary-GVK resources without treating them as owned CRDs', async () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: specSchema,
      status: statusSchema,
    });
    const Widget = sdk.kubernetes.resource<{ readonly color?: string }>({
      apiVersion: 'provider.example.io/v1beta1',
      kind: 'Widget',
      plural: 'widgets',
      namespaces: ['media'],
    });
    const operator = sdk.operator({
      name: 'external-read-pipeline',
      resources: { ImageJob },
      reads: { Deployment: sdk.kubernetes.Deployment, Widget },
      deployment: { namespace: 'media' },
      handlers: [
        ImageJob.on.context.reconcile(async (_job, ctx) => {
          const deployments = await ctx.read.kind('Deployment').list({ namespace: 'media', limit: 10, continueToken: 'next', fieldSelector: 'metadata.name=worker' });
          const widget = await ctx.read.resource(Widget).get({ namespace: 'media', name: 'primary' });
          return ctx.apply({ status: { phase: deployments.items.length === 1 && widget?.spec.color === 'blue' ? 'Processing' : 'Pending' } });
        }),
      ],
    });
    const requests: unknown[] = [];
    const output = await dispatchOperatorHandler(operator.definition, JSON.stringify({
      abiVersion: 'applik8s.handler/v1alpha1',
      handlerId: 'ImageJob.reconcile.0',
      event: 'reconcile',
      object: { apiVersion: 'media.applik8s.dev/v1alpha1', kind: 'ImageJob', metadata: { name: 'hero', namespace: 'media' }, spec: { sourceUrl: 's3://hero' } },
      runtime: { reconcileId: 'external-read' },
    }), {
      kubernetesRead(requestJson) {
        // typecast: the fixture inspects the declared read wire request before returning a matching Kubernetes object or list.
        const request = JSON.parse(requestJson) as { readonly operation: string; readonly kind: string };
        requests.push(request);
        return request.operation === 'list'
          ? JSON.stringify({ ok: true, value: { items: [{ apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: 'worker', namespace: 'media' }, spec: {} }], continueToken: 'after' } })
          : JSON.stringify({ ok: true, value: { apiVersion: 'provider.example.io/v1beta1', kind: 'Widget', metadata: { name: 'primary', namespace: 'media' }, spec: { color: 'blue' } } });
      },
    });

    expect(operator.definition.reads).toMatchObject({ Deployment: { scope: 'Namespaced' }, Widget: { plural: 'widgets', namespaces: ['media'] } });
    expect(requests).toEqual([
      expect.objectContaining({ operation: 'list', apiVersion: 'apps/v1', kind: 'Deployment', plural: 'deployments', scope: 'Namespaced', query: { namespace: 'media', limit: 10, continueToken: 'next', fieldSelector: 'metadata.name=worker' } }),
      expect.objectContaining({ operation: 'get', apiVersion: 'provider.example.io/v1beta1', kind: 'Widget', plural: 'widgets', scope: 'Namespaced', query: { namespace: 'media', name: 'primary' } }),
    ]);
    expect(JSON.parse(output)).toEqual({ operations: [{ kind: 'status', status: { phase: 'Processing' } }] });
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

  it('persists canonical workflow tracking in reserved status and schedules bounded recovery', async () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: specSchema,
      status: statusSchema,
    });
    const observation = {
      reference: {
        provider: 'workflow' as const,
        workflow: 'media.process.v1',
        run: 'run-1',
      },
      workflowRevision: 'v1',
      phase: 'Running' as const,
      admittedAt: '2026-07-31T12:00:00.000Z',
      startedAt: '2026-07-31T12:00:01.000Z',
      progress: { completed: 4, total: 10 },
    };
    const run = {
      id: 'run-1',
      reference: observation.reference,
      workflowRevision: 'v1',
      observe: vi.fn(async () => observation),
      cancel: vi.fn(async () => undefined),
    };
    const operator = sdk.operator({
      name: 'tracked-pipeline',
      resources: { ImageJob },
      handlers: [
        ImageJob.on.reconcile(async (job) => {
          const process = await job.track('process-image', run, {
            onDelete: {
              action: 'cancel',
              timeout: '2m',
              onTimeout: 'detach',
            },
            onGenerationChange: 'supersede',
            updates: { minInterval: '5s' },
          });
          job.status.phase = process.phase;
        }),
      ],
    });

    const output = await dispatchOperatorHandler(
      operator.definition,
      JSON.stringify({
        handlerId: 'ImageJob.reconcile.0',
        event: 'reconcile',
        object: {
          apiVersion: 'media.applik8s.dev/v1alpha1',
          kind: 'ImageJob',
          metadata: {
            name: 'hero',
            namespace: 'media',
            uid: 'uid-hero',
            generation: 3,
          },
          spec: { sourceUrl: 's3://bucket/hero.png' },
        },
        runtime: { reconcileId: 'ImageJob-hero' },
      }),
    );

    expect(run.observe).toHaveBeenCalledWith({ timeoutMs: 5_000 });
    expect(JSON.parse(output)).toEqual({
      operations: [
        {
          kind: 'finalizer',
          operation: 'add',
          finalizer: 'tracking.applik8s.dev/process-image',
        },
        {
          kind: 'status',
          status: {
            phase: 'Running',
            applik8s: {
              trackedExecutions: {
                'process-image': {
                  resourceUid: 'uid-hero',
                  resourceGeneration: 3,
                  workflow: 'media.process.v1',
                  workflowRevision: 'v1',
                  run: 'run-1',
                  phase: 'Running',
                  admittedAt: '2026-07-31T12:00:00.000Z',
                  startedAt: '2026-07-31T12:00:01.000Z',
                  progress: { completed: 4, total: 10 },
                  onGenerationChange: 'supersede',
                  onDelete: {
                    action: 'cancel',
                    timeoutMs: 120_000,
                    onTimeout: 'detach',
                  },
                },
              },
            },
          },
        },
        {
          kind: 'requeue',
          policy: {
            afterSeconds: 5,
            reason: 'bounded workflow tracking resync',
          },
        },
      ],
    });
  });

  it('does not rewrite semantically unchanged tracking status or an existing finalizer', async () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: specSchema,
      status: statusSchema,
    });
    const observation = {
      reference: {
        provider: 'workflow' as const,
        workflow: 'media.process.v1',
        run: 'run-1',
      },
      workflowRevision: 'v1',
      phase: 'Running' as const,
      admittedAt: '2026-07-31T12:00:00.000Z',
      startedAt: '2026-07-31T12:00:01.000Z',
      progress: { completed: 4, total: 10 },
    };
    const run = {
      id: 'run-1',
      reference: observation.reference,
      workflowRevision: 'v1',
      observe: vi.fn(async () => observation),
      cancel: vi.fn(async () => undefined),
    };
    const operator = sdk.operator({
      name: 'stable-tracked-pipeline',
      resources: { ImageJob },
      handlers: [
        ImageJob.on.reconcile(async (job) => {
          await job.track('process-image', run, {
            onDelete: {
              action: 'cancel',
              timeout: '2m',
              onTimeout: 'detach',
            },
            onGenerationChange: 'supersede',
            updates: { minInterval: '5s' },
          });
        }),
      ],
    });

    const output = await dispatchOperatorHandler(
      operator.definition,
      JSON.stringify({
        handlerId: 'ImageJob.reconcile.0',
        event: 'reconcile',
        object: {
          apiVersion: 'media.applik8s.dev/v1alpha1',
          kind: 'ImageJob',
          metadata: {
            name: 'hero',
            namespace: 'media',
            uid: 'uid-hero',
            generation: 3,
            finalizers: ['tracking.applik8s.dev/process-image'],
          },
          spec: { sourceUrl: 's3://bucket/hero.png' },
          // Kubernetes does not preserve authored object-key insertion order.
          // Keep this deliberately different from persistedObservation().
          status: {
            applik8s: {
              trackedExecutions: {
                'process-image': {
                  admittedAt: '2026-07-31T12:00:00.000Z',
                  onDelete: {
                    action: 'cancel',
                    onTimeout: 'detach',
                    timeoutMs: 120_000,
                  },
                  onGenerationChange: 'supersede',
                  phase: 'Running',
                  progress: { total: 10, completed: 4 },
                  resourceGeneration: 3,
                  resourceUid: 'uid-hero',
                  run: 'run-1',
                  startedAt: '2026-07-31T12:00:01.000Z',
                  workflow: 'media.process.v1',
                  workflowRevision: 'v1',
                },
              },
            },
          },
        },
        runtime: { reconcileId: 'ImageJob-hero' },
      }),
    );

    expect(JSON.parse(output)).toEqual({
      operations: [
        {
          kind: 'requeue',
          policy: {
            afterSeconds: 5,
            reason: 'bounded workflow tracking resync',
          },
        },
      ],
    });
  });

  it('cancels the canonical prior generation when replacement requests cancellation', async () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: specSchema,
      status: statusSchema,
    });
    const cancelReference = vi.fn(async () => undefined);
    const run = {
      id: 'run-2',
      reference: {
        provider: 'workflow' as const,
        workflow: 'media.process.v1',
        run: 'run-2',
      },
      workflowRevision: 'v2',
      observe: vi.fn(async () => ({
        reference: {
          provider: 'workflow' as const,
          workflow: 'media.process.v1',
          run: 'run-2',
        },
        workflowRevision: 'v2',
        phase: 'Admitted' as const,
        admittedAt: '2026-07-31T12:05:00.000Z',
      })),
      cancel: vi.fn(async () => undefined),
      __cancelReference: cancelReference,
    };
    const operator = sdk.operator({
      name: 'superseding-pipeline',
      resources: { ImageJob },
      handlers: [
        ImageJob.on.reconcile(async (job) => {
          await job.track('process-image', run, {
            onGenerationChange: 'cancel',
          });
        }),
      ],
    });

    await dispatchOperatorHandler(
      operator.definition,
      JSON.stringify({
        handlerId: 'ImageJob.reconcile.0',
        event: 'reconcile',
        object: {
          apiVersion: 'media.applik8s.dev/v1alpha1',
          kind: 'ImageJob',
          metadata: {
            name: 'hero',
            namespace: 'media',
            uid: 'uid-hero',
            generation: 4,
          },
          spec: { sourceUrl: 's3://bucket/hero.png' },
          status: {
            applik8s: {
              trackedExecutions: {
                'process-image': {
                  resourceUid: 'uid-hero',
                  resourceGeneration: 3,
                  workflow: 'media.process.v1',
                  workflowRevision: 'v1',
                  run: 'run-1',
                  phase: 'Running',
                  admittedAt: '2026-07-31T12:00:00.000Z',
                  onGenerationChange: 'cancel',
                  onDelete: { action: 'detach' },
                },
              },
            },
          },
        },
        runtime: { reconcileId: 'ImageJob-hero' },
      }),
    );

    expect(cancelReference).toHaveBeenCalledWith('run-1', {
      timeoutMs: 5_000,
    });
  });

  it('supersedes a prior generation without requiring provider cancellation', async () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: specSchema,
      status: statusSchema,
    });
    const run = {
      id: 'run-2',
      reference: {
        provider: 'workflow' as const,
        workflow: 'media.process.v1',
        run: 'run-2',
      },
      workflowRevision: 'v2',
      observe: vi.fn(async () => ({
        reference: {
          provider: 'workflow' as const,
          workflow: 'media.process.v1',
          run: 'run-2',
        },
        workflowRevision: 'v2',
        phase: 'Admitted' as const,
        admittedAt: '2026-07-31T12:05:00.000Z',
      })),
      cancel: vi.fn(async () => undefined),
    };
    const operator = sdk.operator({
      name: 'non-cancelling-superseding-pipeline',
      resources: { ImageJob },
      handlers: [
        ImageJob.on.reconcile(async (job) => {
          await job.track('process-image', run, {
            onGenerationChange: 'supersede',
          });
        }),
      ],
    });

    const output = await dispatchOperatorHandler(
      operator.definition,
      JSON.stringify({
        handlerId: 'ImageJob.reconcile.0',
        event: 'reconcile',
        object: {
          apiVersion: 'media.applik8s.dev/v1alpha1',
          kind: 'ImageJob',
          metadata: {
            name: 'hero',
            namespace: 'media',
            uid: 'uid-hero',
            generation: 4,
          },
          spec: { sourceUrl: 's3://bucket/hero.png' },
          status: {
            applik8s: {
              trackedExecutions: {
                'process-image': {
                  resourceUid: 'uid-hero',
                  resourceGeneration: 3,
                  workflow: 'media.process.v1',
                  workflowRevision: 'v1',
                  run: 'run-1',
                  phase: 'Running',
                  admittedAt: '2026-07-31T12:00:00.000Z',
                  onGenerationChange: 'supersede',
                  onDelete: { action: 'detach' },
                },
              },
            },
          },
        },
        runtime: { reconcileId: 'ImageJob-hero' },
      }),
    );
    const operations = JSON.parse(output).operations as readonly {
      readonly kind: string;
      readonly reason?: string;
      readonly status?: {
        readonly applik8s?: {
          readonly trackedExecutions?: Readonly<
            Record<string, { readonly superseded?: object }>
          >;
        };
      };
    }[];
    expect(operations).toContainEqual(
      expect.objectContaining({
        kind: 'event',
        reason: 'WorkflowGenerationSuperseded',
      }),
    );
    expect(
      operations.find((operation) => operation.kind === 'status')
        ?.status?.applik8s?.trackedExecutions?.['process-image']?.superseded,
    ).toMatchObject({
      resourceGeneration: 3,
      run: 'run-1',
      cancellationRequested: false,
    });
  });

  it('cancels a deleting resource run and removes only its scoped tracking finalizer', async () => {
    const ImageJob = sdk.crd<ImageSpec, ImageStatus>({
      apiVersion: 'media.applik8s.dev/v1alpha1',
      kind: 'ImageJob',
      spec: specSchema,
      status: statusSchema,
    });
    const reference = {
      provider: 'workflow' as const,
      workflow: 'media.process.v1',
      run: 'run-1',
    };
    const observe = vi
      .fn()
      .mockResolvedValueOnce({
        reference,
        workflowRevision: 'v1',
        phase: 'Running',
        admittedAt: '2026-07-31T12:00:00.000Z',
      })
      .mockResolvedValueOnce({
        reference,
        workflowRevision: 'v1',
        phase: 'Cancelled',
        admittedAt: '2026-07-31T12:00:00.000Z',
        finishedAt: '2026-07-31T12:05:00.000Z',
      });
    const cancel = vi.fn(async () => undefined);
    const operator = sdk.operator({
      name: 'deleting-tracked-pipeline',
      resources: { ImageJob },
      handlers: [
        ImageJob.on.reconcile(async (job) => {
          const observation = await job.track(
            'process-image',
            {
              id: 'run-1',
              reference,
              workflowRevision: 'v1',
              observe,
              cancel,
            },
            {
              onDelete: {
                action: 'cancel',
                timeout: '2m',
                onTimeout: 'block',
              },
            },
          );
          job.status.phase = observation.phase;
        }),
      ],
    });

    const output = await dispatchOperatorHandler(
      operator.definition,
      JSON.stringify({
        handlerId: 'ImageJob.reconcile.0',
        event: 'reconcile',
        object: {
          apiVersion: 'media.applik8s.dev/v1alpha1',
          kind: 'ImageJob',
          metadata: {
            name: 'hero',
            namespace: 'media',
            uid: 'uid-hero',
            generation: 3,
            deletionTimestamp: '2026-07-31T12:05:00.000Z',
            finalizers: [
              'tracking.applik8s.dev/process-image',
              'application.example.test/other',
            ],
          },
          spec: { sourceUrl: 's3://bucket/hero.png' },
          status: {
            applik8s: {
              trackedExecutions: {
                'process-image': {
                  resourceUid: 'uid-hero',
                  resourceGeneration: 3,
                  workflow: 'media.process.v1',
                  workflowRevision: 'v1',
                  run: 'run-1',
                  phase: 'Running',
                  admittedAt: '2026-07-31T12:00:00.000Z',
                  onGenerationChange: 'supersede',
                  onDelete: {
                    action: 'cancel',
                    timeoutMs: 120_000,
                    onTimeout: 'block',
                  },
                },
              },
            },
          },
        },
        runtime: { reconcileId: 'ImageJob-hero' },
      }),
    );

    expect(cancel).toHaveBeenCalledWith({ timeoutMs: 5_000 });
    const operations = JSON.parse(output).operations as readonly {
      readonly kind: string;
      readonly operation?: string;
      readonly finalizer?: string;
    }[];
    expect(operations).toContainEqual({
      kind: 'finalizer',
      operation: 'remove',
      finalizer: 'tracking.applik8s.dev/process-image',
    });
    expect(operations).not.toContainEqual({
      kind: 'finalizer',
      operation: 'add',
      finalizer: 'tracking.applik8s.dev/process-image',
    });
    expect(operations).not.toContainEqual(
      expect.objectContaining({ finalizer: 'application.example.test/other' }),
    );
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
