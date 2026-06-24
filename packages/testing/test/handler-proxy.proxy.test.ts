import { describe, expect, it } from 'vitest';

import type { ResourceDefinition, ResourceObject } from '@applik8s/core';
import { createHandlerProxyRecorder } from '../src/index.js';

interface ImageJobSpec {
  readonly sourceUrl: string;
  readonly formats: readonly string[];
}

interface ImageJobStatus {
  readonly phase?: 'Pending' | 'Processing' | 'Complete' | 'Failed';
  readonly outputUrls?: readonly string[];
  readonly progress?: {
    readonly completed: number;
    readonly total: number;
  };
}

const imageJob: ResourceObject<ImageJobSpec, ImageJobStatus> = {
  apiVersion: 'media.applik8s.dev/v1alpha1',
  kind: 'ImageJob',
  metadata: {
    name: 'hero',
    namespace: 'media',
    generation: 3,
  },
  spec: {
    sourceUrl: 's3://bucket/hero.png',
    formats: ['webp', 'avif'],
  },
  status: {
    phase: 'Pending',
    outputUrls: [],
    progress: {
      completed: 0,
      total: 2,
    },
  },
};

describe('applik8s handler proxy access semantics', () => {
  it('reads observed spec, metadata, object, event, and reconcile id', () => {
    const recorder = createHandlerProxyRecorder(imageJob, { event: 'created', reconcileId: 'reconcile-1' });

    expect(recorder.scope.spec.sourceUrl).toBe('s3://bucket/hero.png');
    expect(recorder.scope.spec.formats).toEqual(['webp', 'avif']);
    expect(recorder.scope.metadata.name).toBe('hero');
    expect(recorder.scope.metadata.namespace).toBe('media');
    expect(recorder.scope.object).toBe(imageJob);
    expect(recorder.scope.event).toBe('created');
    expect(recorder.scope.reconcileId).toBe('reconcile-1');
  });

  it('reads status from the observed object until a draft write occurs', () => {
    const recorder = createHandlerProxyRecorder(imageJob);

    expect(recorder.scope.status.phase).toBe('Pending');
    expect(recorder.scope.status.progress?.completed).toBe(0);
  });

  it('records status writes without mutating the observed object', () => {
    const recorder = createHandlerProxyRecorder(imageJob);

    recorder.scope.status.phase = 'Processing';
    recorder.scope.status.outputUrls = ['s3://bucket/hero.webp'];
    recorder.scope.status.progress = { completed: 1, total: 2 };

    expect(recorder.scope.status.phase).toBe('Processing');
    expect(recorder.scope.status.outputUrls).toEqual(['s3://bucket/hero.webp']);
    expect(recorder.scope.status.progress).toEqual({ completed: 1, total: 2 });
    expect(imageJob.status).toEqual({
      phase: 'Pending',
      outputUrls: [],
      progress: { completed: 0, total: 2 },
    });
    expect(recorder.result().status).toEqual({
      phase: 'Processing',
      outputUrls: ['s3://bucket/hero.webp'],
      progress: { completed: 1, total: 2 },
    });
  });

  it('records nested status writes and reads the draft value after write', () => {
    const recorder = createHandlerProxyRecorder(imageJob);
    const progress = recorder.scope.status.progress;

    expect(progress).toBeDefined();
    if (!progress) {
      throw new Error('expected progress draft to be present');
    }

    progress.completed = 2;

    expect(recorder.scope.status.progress?.completed).toBe(2);
    expect(imageJob.status?.progress?.completed).toBe(0);
    expect(recorder.result().status).toEqual({
      phase: 'Pending',
      outputUrls: [],
      progress: { completed: 2, total: 2 },
    });
  });

  it('records apply operations from Kubernetes factory helpers', () => {
    const recorder = createHandlerProxyRecorder(imageJob);

    recorder.scope.apply(
      recorder.scope.batch.Job({
        name: 'hero-webp',
        namespace: 'media',
        image: 'ghcr.io/acme/resizer:v1',
        env: {
          SOURCE_URL: recorder.scope.spec.sourceUrl,
          FORMAT: 'webp',
        },
      })
    );

    expect(recorder.result().apply).toEqual([
      {
        apiVersion: 'batch/v1',
        kind: 'Job',
        metadata: {
          name: 'hero-webp',
          namespace: 'media',
        },
        spec: {
          image: 'ghcr.io/acme/resizer:v1',
          env: {
            SOURCE_URL: 's3://bucket/hero.png',
            FORMAT: 'webp',
          },
        },
      },
    ]);
  });

  it('records delete, patch, event, finalizer, and requeue operations', () => {
    const recorder = createHandlerProxyRecorder(imageJob);
    const childRef = { apiVersion: 'batch/v1', kind: 'Job', name: 'hero-webp', namespace: 'media' };

    recorder.scope.delete(childRef, { propagationPolicy: 'Foreground', gracePeriodSeconds: 5 });
    recorder.scope.patch(childRef, [{ op: 'replace', path: '/spec/suspend', value: true }]);
    recorder.scope.events.normal('ImageAccepted', 'Image job accepted');
    recorder.scope.events.warning('ResizeSlow', 'Resize is slower than expected', childRef);
    recorder.scope.finalizers.add('media.applik8s.dev/imagejob');
    recorder.scope.requeue({ afterSeconds: 30, reason: 'WaitingForResize' });

    expect(recorder.result()).toMatchObject({
      delete: [{ kind: 'delete', ref: childRef, options: { propagationPolicy: 'Foreground', gracePeriodSeconds: 5 } }],
      patch: [{ kind: 'patch', ref: childRef, patch: [{ op: 'replace', path: '/spec/suspend', value: true }] }],
      events: [
        { kind: 'event', type: 'Normal', reason: 'ImageAccepted', message: 'Image job accepted' },
        { kind: 'event', type: 'Warning', reason: 'ResizeSlow', message: 'Resize is slower than expected', regarding: childRef },
      ],
      finalizers: [{ kind: 'finalizer', operation: 'add', finalizer: 'media.applik8s.dev/imagejob' }],
      requeue: { afterSeconds: 30, reason: 'WaitingForResize' },
    });
  });

  it('normalizes recorded operations in deterministic order', () => {
    const recorder = createHandlerProxyRecorder(imageJob);

    recorder.scope.status.phase = 'Processing';
    recorder.scope.apply(recorder.scope.batch.ConfigMap({ name: 'hero-config', namespace: 'media' }));
    recorder.scope.events.normal('Accepted', 'Accepted');
    recorder.scope.requeue({ afterSeconds: 10 });

    expect(recorder.normalizedPlan().operations).toEqual([
      {
        kind: 'apply',
        resource: {
          apiVersion: 'v1',
          kind: 'ConfigMap',
          metadata: { name: 'hero-config', namespace: 'media' },
        },
      },
      {
        kind: 'status',
        status: {
          phase: 'Processing',
          outputUrls: [],
          progress: { completed: 0, total: 2 },
        },
      },
      { kind: 'event', type: 'Normal', reason: 'Accepted', message: 'Accepted' },
      { kind: 'requeue', policy: { afterSeconds: 10 } },
    ]);
  });

  it('normalizes every operation kind in canonical runtime order', () => {
    const recorder = createHandlerProxyRecorder(imageJob);
    const childRef = { apiVersion: 'batch/v1', kind: 'Job', name: 'hero-webp', namespace: 'media' };
    const invoiceResource = { apiVersion: 'billing.applik8s.dev/v1alpha1', kind: 'Invoice' };

    recorder.scope.events.normal('Accepted', 'Accepted');
    recorder.scope.finalizers.add('media.applik8s.dev/imagejob');
    recorder.scope.finalizers.remove('media.applik8s.dev/imagejob');
    recorder.scope.status.phase = 'Processing';
    recorder.scope.delete(childRef, { propagationPolicy: 'Foreground', gracePeriodSeconds: 5 });
    recorder.scope.apply(recorder.scope.batch.ConfigMap({ name: 'hero-config', namespace: 'media' }));
    recorder.scope.patch(childRef, [{ op: 'replace', path: '/spec/suspend', value: true }]);
    // typecast: this ordering test only needs ResourceDefinition identity fields because setStatus records apiVersion/kind/name/namespace, not schema metadata.
    recorder.scope.setStatus(invoiceResource as ResourceDefinition<object, { phase: string }>, 'invoice-1', { phase: 'Charged' }, 'billing');
    recorder.scope.requeue({ afterSeconds: 10, reason: 'Waiting' });

    expect(recorder.normalizedPlan().operations).toEqual([
      { kind: 'finalizer', operation: 'add', finalizer: 'media.applik8s.dev/imagejob' },
      {
        kind: 'apply',
        resource: {
          apiVersion: 'v1',
          kind: 'ConfigMap',
          metadata: { name: 'hero-config', namespace: 'media' },
        },
      },
      { kind: 'patch', ref: childRef, patch: [{ op: 'replace', path: '/spec/suspend', value: true }] },
      { kind: 'delete', ref: childRef, options: { propagationPolicy: 'Foreground', gracePeriodSeconds: 5 } },
      {
        kind: 'status',
        status: {
          phase: 'Processing',
          outputUrls: [],
          progress: { completed: 0, total: 2 },
        },
      },
      {
        kind: 'status',
        ref: { apiVersion: 'billing.applik8s.dev/v1alpha1', kind: 'Invoice', name: 'invoice-1', namespace: 'billing' },
        status: { phase: 'Charged' },
      },
      { kind: 'event', type: 'Normal', reason: 'Accepted', message: 'Accepted' },
      { kind: 'finalizer', operation: 'remove', finalizer: 'media.applik8s.dev/imagejob' },
      { kind: 'requeue', policy: { afterSeconds: 10, reason: 'Waiting' } },
    ]);
  });

  it('preserves delete options in normalized operations', () => {
    const recorder = createHandlerProxyRecorder(imageJob);
    const childRef = { apiVersion: 'batch/v1', kind: 'Job', name: 'hero-webp', namespace: 'media' };

    recorder.scope.delete(childRef, { propagationPolicy: 'Foreground', gracePeriodSeconds: 5 });

    expect(recorder.normalizedPlan().operations).toEqual([
      { kind: 'delete', ref: childRef, options: { propagationPolicy: 'Foreground', gracePeriodSeconds: 5 } },
    ]);
  });

  it('preserves explicit apply ownership policy in normalized operations', () => {
    const recorder = createHandlerProxyRecorder(imageJob);
    const owner = { apiVersion: 'infra.applik8s.dev/v1alpha1', kind: 'MediaPipeline', name: 'pipeline', uid: 'pipeline-uid' };

    recorder.scope.resources.apply(recorder.scope.batch.ConfigMap({ name: 'hero-config', namespace: 'media' }), {
      fieldManager: 'image-pipeline',
      force: true,
      ownership: { mode: 'reference', ref: owner, blockOwnerDeletion: true },
    });
    recorder.scope.resources.apply(recorder.scope.batch.ConfigMap({ name: 'scratch-config', namespace: 'media' }), { ownership: { mode: 'none' } });

    expect(recorder.normalizedPlan().operations).toEqual([
      {
        kind: 'apply',
        fieldManager: 'image-pipeline',
        force: true,
        ownership: { mode: 'reference', ref: owner, blockOwnerDeletion: true },
        resource: {
          apiVersion: 'v1',
          kind: 'ConfigMap',
          metadata: { name: 'hero-config', namespace: 'media' },
        },
      },
      {
        kind: 'apply',
        ownership: { mode: 'none' },
        resource: {
          apiVersion: 'v1',
          kind: 'ConfigMap',
          metadata: { name: 'scratch-config', namespace: 'media' },
        },
      },
    ]);
  });

  it('records status for another resource through setStatus', () => {
    const recorder = createHandlerProxyRecorder(imageJob);
    const invoiceResource = { apiVersion: 'billing.applik8s.dev/v1alpha1', kind: 'Invoice' };

    // typecast: this proxy test only needs ResourceDefinition identity fields because setStatus records apiVersion/kind/name/namespace, not schema/event metadata.
    recorder.scope.setStatus(invoiceResource as ResourceDefinition<object, { phase: string }>, 'invoice-1', { phase: 'Charged' }, 'billing');

    expect(recorder.result().patch).toEqual([
      {
        kind: 'status',
        ref: {
          apiVersion: 'billing.applik8s.dev/v1alpha1',
          kind: 'Invoice',
          name: 'invoice-1',
          namespace: 'billing',
        },
        status: { phase: 'Charged' },
      },
    ]);
  });
});
