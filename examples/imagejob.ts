import { type as arkType } from 'arktype';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { sdk } from '@applik8s/sdk';

export const imageSpecSchema = arkType({
  endpoint: 'string',
  region: 'string',
  sourceBucket: 'string',
  sourceKey: 'string',
  outputBucket: 'string',
  formats: 'string[]',
  priority: "'low' | 'normal' | 'high'",
});
export type ImageSpec = typeof imageSpecSchema.infer;

export const imageStatusSchema = arkType({
  'phase?': "'Pending' | 'Processing' | 'Complete' | 'Failed'",
  'outputUrls?': 'string[]',
  'processedBytes?': 'number',
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
    ImageJob.on.reconcile(async (job) => {
      job.finalizers.add('media.applik8s.dev/imagejob');
      job.status.phase = 'Processing';
      const source = await readSourceObject(job.spec);
      const outputs = await writeFormattedOutputs(job.metadata.name, job.spec, source);
      job.status.phase = 'Complete';
      job.status.outputUrls = outputs.map((output) => output.url);
      job.status.processedBytes = outputs.reduce((total, output) => total + output.bytes, 0);
      job.status.message = `Processed ${job.spec.sourceBucket}/${job.spec.sourceKey}`;
      const output = job.k8s.ConfigMap({
        name: job.names.dnsSafe(`${job.metadata.name}-output`),
        ...(job.metadata.namespace ? { namespace: job.metadata.namespace } : {}),
        data: {
          sourceUrl: s3Url(job.spec.sourceBucket, job.spec.sourceKey),
          outputUrls: outputs.map((output) => output.url).join(','),
          formats: job.spec.formats.join(','),
          priority: job.spec.priority,
        },
      });
      job.apply(output);
      job.events.normal('ImageJobComplete', `Wrote ${outputs.length} image output object(s)`);
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

interface ImageOutput {
  readonly url: string;
  readonly bytes: number;
}

function s3Client(spec: ImageSpec): S3Client {
  return new S3Client({
    endpoint: spec.endpoint,
    region: spec.region,
    forcePathStyle: true,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  });
}

async function readSourceObject(spec: ImageSpec): Promise<Uint8Array> {
  const response = await s3Client(spec).send(new GetObjectCommand({ Bucket: spec.sourceBucket, Key: spec.sourceKey }));
  if (!response.Body) {
    throw new Error(`S3 object ${spec.sourceBucket}/${spec.sourceKey} had no body.`);
  }
  return response.Body.transformToByteArray();
}

async function writeFormattedOutputs(jobName: string, spec: ImageSpec, source: Uint8Array): Promise<readonly ImageOutput[]> {
  const client = s3Client(spec);
  const outputs: ImageOutput[] = [];
  for (const format of spec.formats) {
    const key = `${jobName}.${format}`;
    const body = renderDemoImage(format, source);
    await client.send(new PutObjectCommand({
      Bucket: spec.outputBucket,
      Key: key,
      Body: body,
      ContentType: `image/${format}`,
      Metadata: {
        sourceBucket: spec.sourceBucket,
        sourceKey: spec.sourceKey,
        applik8sImageJob: jobName,
      },
    }));
    outputs.push({ url: s3Url(spec.outputBucket, key), bytes: body.byteLength });
  }
  return outputs;
}

function renderDemoImage(format: string, source: Uint8Array): Uint8Array {
  const prefix = new TextEncoder().encode(`applik8s image format=${format}\n`);
  const output = new Uint8Array(prefix.byteLength + source.byteLength);
  output.set(prefix, 0);
  output.set(source, prefix.byteLength);
  return output;
}

function s3Url(bucket: string, key: string): string {
  return `s3://${bucket}/${key}`;
}
