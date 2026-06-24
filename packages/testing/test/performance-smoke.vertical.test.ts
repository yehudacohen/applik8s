import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';

import { ImageJob, imagePipeline } from '../../../examples/imagejob.js';
import { testing } from '../src/index.js';

describe('local performance smoke', () => {
  it('reconciles multiple ImageJob objects without shared-state drift', async () => {
    const s3 = await createS3Fixture(Object.fromEntries(Array.from({ length: 25 }, (_, index) => [`images/hero-${index}.png`, new TextEncoder().encode(`hero-${index}`)])));
    try {
      const runs = await Promise.all(Array.from({ length: 25 }, async (_, index) => {
        const image = ImageJob({
          name: `hero-image-${index}`,
          namespace: 'media',
          spec: {
            endpoint: s3.endpoint,
            region: 'us-east-1',
            sourceBucket: 'images',
            sourceKey: `hero-${index}.png`,
            outputBucket: 'processed',
            formats: ['webp', 'avif'],
            priority: 'normal',
          },
        });

        return testing
          .testOperator(imagePipeline)
          .given(image)
          .expectApply({ apiVersion: 'v1', kind: 'ConfigMap', name: `hero-image-${index}-output`, namespace: 'media' })
          .expectStatus({ phase: 'Complete', outputUrls: [`s3://processed/hero-image-${index}.webp`, `s3://processed/hero-image-${index}.avif`] })
          .run({ reconcile: { apiVersion: ImageJob.apiVersion, kind: ImageJob.kind, name: `hero-image-${index}`, namespace: 'media' } });
      }));

      expect(runs.every((run) => run.ok)).toBe(true);
      for (const run of runs) {
        if (run.ok) {
          expect(run.value.assertionFailures).toEqual([]);
          expect(run.value.normalizedPlan).toBeDefined();
          if (!run.value.normalizedPlan) {
            continue;
          }
          expect(run.value.normalizedPlan.operations.map((operation) => operation.kind)).toEqual(['finalizer', 'apply', 'status', 'event']);
        }
      }
    } finally {
      await s3.close();
    }
  });
});

interface S3Fixture {
  readonly endpoint: string;
  close(): Promise<void>;
}

async function createS3Fixture(initialObjects: Readonly<Record<string, Uint8Array>>): Promise<S3Fixture> {
  const objects = new Map(Object.entries(initialObjects));
  const server = createServer(async (request, response) => {
    const key = objectKey(request);
    if (!key) {
      response.writeHead(400).end('Expected path-style /bucket/key request.');
      return;
    }
    if (request.method === 'GET') {
      const object = objects.get(key);
      if (!object) {
        response.writeHead(404).end('NoSuchKey');
        return;
      }
      response.writeHead(200, { 'Content-Length': String(object.byteLength) }).end(object);
      return;
    }
    if (request.method === 'PUT') {
      objects.set(key, await readRequestBody(request));
      response.writeHead(200).end();
      return;
    }
    response.writeHead(405).end('MethodNotAllowed');
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  // typecast: the fixture server listens on a TCP host/port, so Node returns AddressInfo rather than a pipe name.
  const address = server.address() as AddressInfo;
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

function objectKey(request: IncomingMessage): string | undefined {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const [bucket, ...keyParts] = parts;
  return bucket && keyParts.length > 0 ? `${bucket}/${keyParts.join('/')}` : undefined;
}

async function readRequestBody(request: IncomingMessage): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk);
  }
  const body = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
