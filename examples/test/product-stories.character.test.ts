import { createServer, type IncomingMessage } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';

import { buildOperatorManifest, createCompilerPipeline } from '@applik8s/compiler';
import { testing } from '@applik8s/testing';
import { typeKro } from '@applik8s/typekro-adapter';
import { ImageJob, imagePipeline } from '../imagejob.js';

describe('ImageJob golden path product story', () => {
  it('tests the operator locally without mutating a cluster', async () => {
    const s3 = await createS3Fixture({ 'images/hero.png': new TextEncoder().encode('hero-image-source') });
    const image = ImageJob({
      name: 'hero-image',
      namespace: 'media',
      spec: {
        endpoint: s3.endpoint,
        region: 'us-east-1',
        sourceBucket: 'images',
        sourceKey: 'hero.png',
        outputBucket: 'processed',
        formats: ['webp', 'avif'],
        priority: 'normal',
      },
    });

    try {
      const run = await testing
        .testOperator(imagePipeline)
        .given(image)
        .expectManifest({ operatorName: 'image-pipeline', ownedCrds: ['media.applik8s.dev/v1alpha1/ImageJob'] })
        .expectRbac({ apiGroups: [''], resources: ['configmaps'], verbs: ['get', 'patch', 'delete'] })
        .expectSchema('ImageJob', { structural: true, requiredFields: ['endpoint', 'region', 'sourceBucket', 'sourceKey', 'outputBucket', 'formats', 'priority'] })
        .expectFinalizer('media.applik8s.dev/imagejob', 'add')
        .expectApply({ apiVersion: 'v1', kind: 'ConfigMap', name: 'hero-image-output', namespace: 'media' })
        .expectStatus({
          phase: 'Complete',
          outputUrls: ['s3://processed/hero-image.webp', 's3://processed/hero-image.avif'],
          processedBytes: 88,
          message: 'Processed images/hero.png',
        })
        .expectEvent('ImageJobComplete')
        .run({ reconcile: { apiVersion: ImageJob.apiVersion, kind: ImageJob.kind, name: 'hero-image', namespace: 'media' } });

      expect(run.ok).toBe(true);
      if (run.ok) {
        expect(run.value.assertionFailures).toEqual([]);
        expect(run.value.normalizedPlan.operations.map((operation) => operation.kind)).toEqual(['finalizer', 'apply', 'status', 'event']);
        expect(run.value.normalizedPlan.operations).toContainEqual(expect.objectContaining({
          kind: 'apply',
          resource: expect.objectContaining({
            apiVersion: 'v1',
            kind: 'ConfigMap',
            data: {
              sourceUrl: 's3://images/hero.png',
              outputUrls: 's3://processed/hero-image.webp,s3://processed/hero-image.avif',
              formats: 'webp,avif',
              priority: 'normal',
            },
          }),
        }));
      }

      expect(new TextDecoder().decode(s3.object('processed/hero-image.webp'))).toBe('applik8s image format=webp\nhero-image-source');
      expect(new TextDecoder().decode(s3.object('processed/hero-image.avif'))).toBe('applik8s image format=avif\nhero-image-source');
    } finally {
      await s3.close();
    }
  });

  it('tests cleanup locally through the finalize handler', async () => {
    const image = {
      ...ImageJob({
        name: 'hero-image',
        namespace: 'media',
        spec: {
          endpoint: 'http://127.0.0.1:4566',
          region: 'us-east-1',
          sourceBucket: 'images',
          sourceKey: 'hero.png',
          outputBucket: 'processed',
          formats: ['webp'],
          priority: 'normal',
        },
      }),
      metadata: { name: 'hero-image', namespace: 'media', finalizers: ['media.applik8s.dev/imagejob'], deletionTimestamp: '2026-01-01T00:00:00.000Z' },
    };

    const run = await testing
      .testOperator(imagePipeline)
      .given(image)
      .expectDelete({ apiVersion: 'v1', kind: 'ConfigMap', name: 'hero-image-output', namespace: 'media' })
      .expectFinalizer('media.applik8s.dev/imagejob', 'remove')
      .run({ event: 'finalize', reconcile: { apiVersion: ImageJob.apiVersion, kind: ImageJob.kind, name: 'hero-image', namespace: 'media' } });

    expect(run.ok).toBe(true);
    if (run.ok) {
      expect(run.value.assertionFailures).toEqual([]);
      expect(run.value.normalizedPlan.operations.map((operation) => operation.kind)).toEqual(['delete', 'finalizer']);
    }
  });

  it('keeps the documented handler shape aligned with the canonical source', async () => {
    const source = await readFile(join(process.cwd(), 'examples/imagejob.ts'), 'utf8');
    const readme = await readFile(join(process.cwd(), 'README.md'), 'utf8');
    const requiredSnippets = [
      'import { GetObjectCommand, PutObjectCommand, S3Client } from \'@aws-sdk/client-s3\';',
      'ImageJob.on.reconcile(async (job) => {',
      'const source = await readSourceObject(job.spec);',
      'const outputs = await writeFormattedOutputs(job.metadata.name, job.spec, source);',
      'const output = job.k8s.ConfigMap({',
      'job.apply(output);',
      'job.events.normal(\'ImageJobComplete\'',
      'job.delete(job.k8s.ConfigMap({',
    ];

    for (const snippet of requiredSnippets) {
      expect(source).toContain(snippet);
      expect(readme).toContain(snippet);
    }
  });

  it('compiles the same source into generated artifacts and install walkthrough assets', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-imagejob-story-'));

    try {
      const compiled = await createCompilerPipeline().run({
        entrypoint: join(process.cwd(), 'examples/imagejob.ts'),
        outDir: join(dir, 'dist'),
        runtimeVersionRange: '^0.1.0',
        handlerAbiVersion: 'applik8s.handler/v1alpha1',
        adapter: 'wasmComponent',
        portability: {
          deterministicBuild: true,
          allowEnvironmentAccess: false,
          allowFilesystemAccess: false,
          allowNetworkAccess: true,
          allowedHostImports: [],
          sourceMaps: { emit: true, includeSourceContent: false, redactPaths: false },
        },
      });

      expect(compiled.ok).toBe(true);
      if (!compiled.ok) {
        return;
      }

      expect(compiled.value.manifest.spec.handlerArtifact.path).toContain('handler.wasm');
      expect(compiled.value.manifest.spec.ownedCrds[0]?.kind).toBe('ImageJob');
      expect(compiled.value.manifest.spec.permissions).toContainEqual({ apiGroups: ['media.applik8s.dev'], resources: ['imagejobs'], verbs: ['get', 'list', 'watch', 'patch'] });
      expect(compiled.value.manifest.spec.permissions).toContainEqual({ apiGroups: ['media.applik8s.dev'], resources: ['imagejobs/status'], verbs: ['get', 'patch', 'update'] });
      expect(compiled.value.manifest.spec.permissions).toContainEqual({ apiGroups: ['media.applik8s.dev'], resources: ['imagejobs/finalizers'], verbs: ['get', 'patch', 'update'] });
      expect(compiled.value.manifest.spec.permissions).toContainEqual({ apiGroups: [''], resources: ['events'], verbs: ['create', 'patch', 'update'] });
      expect(compiled.value.manifest.spec.permissions).toContainEqual({ apiGroups: [''], resources: ['configmaps'], verbs: ['get', 'create', 'update', 'patch', 'delete'] });
      expect(compiled.value.manifest.spec.security.portability.networkAccess).toBe('allowedByPolicy');
      expect(compiled.value.manifest.spec.adapterRequirements.hostImports).toEqual(expect.arrayContaining(['wasi:io', 'wasi:http']));
      expect(compiled.value.artifacts.generatedDeploymentYamlPath).toContain('deployment-image-pipeline.yaml');
      expect(compiled.value.artifacts.generatedImageDockerfilePath).toContain('Dockerfile.applik8s-runtime');
      expect(compiled.value.artifacts.generatedApplyScriptPath).toContain('apply.sh');

      const bundledHandler = await readFile(join(dir, 'dist/bundle/handler.js'), 'utf8');
      expect(bundledHandler).toContain('S3Client');
      expect(bundledHandler).toContain('GetObjectCommand');
      expect(bundledHandler).toContain('PutObjectCommand');
      expect(bundledHandler).toContain('FetchHttpHandler');

      const applyScript = await readFile(compiled.value.artifacts.generatedApplyScriptPath ?? '', 'utf8');
      expect(applyScript).toContain('APPLIK8S_IMAGE');
      expect(applyScript).toContain('kubernetes/*.yaml');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('installs the compiled operator shape as a TypeKro composition', () => {
    const manifest = buildOperatorManifest({
      operator: imagePipeline.definition,
      handlerArtifactPath: 'wasm/handler.wasm',
      handlerArtifactDigest: `sha256:${'a'.repeat(64)}`,
      runtimeContractPath: 'contract/runtime-contract.json',
      runtimeContractDigest: `sha256:${'b'.repeat(64)}`,
    });
    expect(manifest.ok).toBe(true);
    if (!manifest.ok) {
      return;
    }

    const composition = typeKro.composition(imagePipeline.definition, manifest.value, {
      compositionName: 'image-pipeline',
      defaultNamespace: 'media-system',
    });

    expect(composition.ok).toBe(true);
    if (!composition.ok) {
      return;
    }

    const installed = composition.value({ namespace: 'media', replicas: 1 });
    const image = installed.imageJob({
      name: 'hero-image',
      spec: {
        endpoint: 'http://ministack.media.svc.cluster.local:4566',
        region: 'us-east-1',
        sourceBucket: 'images',
        sourceKey: 'hero.png',
        outputBucket: 'processed',
        formats: ['webp'],
        priority: 'normal',
      },
    });

    expect(composition.value.crdFactories.ImageJob).toBeTypeOf('function');
    expect(composition.value.crdFactories.imageJob).toBeTypeOf('function');
    expect(composition.value.resources.some((resource) => resource.kind === 'Deployment')).toBe(true);
    expect(image.kind).toBe('ImageJob');
    expect(image.metadata.namespace).toBe('media-system');
  });

});

interface S3Fixture {
  readonly endpoint: string;
  object(key: string): Uint8Array;
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
    object(key) {
      const object = objects.get(key);
      if (!object) {
        throw new Error(`Missing fixture object ${key}.`);
      }
      return object;
    },
    close() {
      return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

function objectKey(request: IncomingMessage): string | undefined {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const [bucket, ...keyParts] = parts;
  if (!bucket || keyParts.length === 0) {
    return undefined;
  }
  return `${bucket}/${keyParts.join('/')}`;
}

async function readRequestBody(request: IncomingMessage): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk);
  }
  const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
