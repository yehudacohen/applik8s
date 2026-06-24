import { type as arkType } from 'arktype';

import { sdk } from '@applik8s/sdk';

export const imageSpecSchema = arkType({
  sourceUrl: 'string',
  formats: 'string[]',
  priority: "'low' | 'normal' | 'high'",
});
export type ImageSpec = typeof imageSpecSchema.infer;

export const imageStatusSchema = arkType({
  'phase?': "'Pending' | 'Processing' | 'Complete' | 'Failed'",
  'outputUrls?': 'string[]',
  'message?': 'string',
});
export type ImageStatus = typeof imageStatusSchema.infer;

export const ImageJob = sdk.crd({
  apiVersion: 'media.applik8s.dev/v1alpha1',
  kind: 'ImageJob',
  spec: imageSpecSchema,
  status: imageStatusSchema,
});

export const imagePipeline = sdk.operator({
  name: 'image-pipeline',
  deployment: { namespace: 'media', replicas: 1 },
  resources: { ImageJob },
  permissions: [{ apiGroups: [''], resources: ['configmaps'], verbs: ['get', 'create', 'update', 'patch', 'delete'] }],
  handlers: [
    ImageJob.on.reconcile((job) => {
      job.finalizers.add('media.applik8s.dev/imagejob');
      job.status.phase = 'Processing';
      job.status.outputUrls = job.spec.formats.map((format) => `s3://processed/${job.metadata.name}.${format}`);
      const output = job.k8s.ConfigMap({
        name: job.names.dnsSafe(`${job.metadata.name}-output`),
        ...(job.metadata.namespace ? { namespace: job.metadata.namespace } : {}),
        data: {
          sourceUrl: job.spec.sourceUrl,
          formats: job.spec.formats.join(','),
          priority: job.spec.priority,
        },
      });
      job.apply(output);
      job.events.normal('ImageJobAccepted', 'Image job accepted for processing');
      job.requeue({ afterSeconds: 30, reason: 'WaitingForResizeOutputs' });
    }),
    ImageJob.on.finalize((job) => {
      job.delete(job.k8s.ConfigMap({
        name: job.names.dnsSafe(`${job.metadata.name}-output`),
        ...(job.metadata.namespace ? { namespace: job.metadata.namespace } : {}),
      }));
      job.finalizers.remove('media.applik8s.dev/imagejob');
    }, { finalizer: 'media.applik8s.dev/imagejob' }),
  ],
});
