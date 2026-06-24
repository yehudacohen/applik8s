import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildOperatorManifest, createCompilerPipeline } from '@applik8s/compiler';
import { testing } from '@applik8s/testing';
import { typeKro } from '@applik8s/typekro-adapter';
import { ImageJob, imagePipeline } from '../imagejob.js';

describe('ImageJob golden path product story', () => {
  it('tests the operator locally without mutating a cluster', async () => {
    const image = ImageJob({
      name: 'hero-image',
      namespace: 'media',
      spec: { sourceUrl: 's3://bucket/hero.png', formats: ['webp', 'avif'], priority: 'normal' },
    });

    const run = await testing
      .testOperator(imagePipeline)
      .given(image)
      .expectManifest({ operatorName: 'image-pipeline', ownedCrds: ['media.applik8s.dev/v1alpha1/ImageJob'] })
      .expectRbac({ apiGroups: [''], resources: ['configmaps'], verbs: ['get', 'patch', 'delete'] })
      .expectSchema('ImageJob', { structural: true, requiredFields: ['sourceUrl', 'formats', 'priority'] })
      .expectFinalizer('media.applik8s.dev/imagejob', 'add')
      .expectApply({ apiVersion: 'v1', kind: 'ConfigMap', name: 'hero-image-output', namespace: 'media' })
      .expectStatus({ phase: 'Processing', outputUrls: ['s3://processed/hero-image.webp', 's3://processed/hero-image.avif'] })
      .expectEvent('ImageJobAccepted')
      .expectRequeue(30)
      .run({ reconcile: { apiVersion: ImageJob.apiVersion, kind: ImageJob.kind, name: 'hero-image', namespace: 'media' } });

    expect(run.ok).toBe(true);
    if (run.ok) {
      expect(run.value.assertionFailures).toEqual([]);
      expect(run.value.normalizedPlan.operations.map((operation) => operation.kind)).toEqual(['finalizer', 'apply', 'status', 'event', 'requeue']);
      expect(run.value.normalizedPlan.operations).toContainEqual(expect.objectContaining({
        kind: 'apply',
        resource: expect.objectContaining({
          apiVersion: 'v1',
          kind: 'ConfigMap',
          data: { sourceUrl: 's3://bucket/hero.png', formats: 'webp,avif', priority: 'normal' },
        }),
      }));
    }
  });

  it('tests cleanup locally through the finalize handler', async () => {
    const image = {
      ...ImageJob({ name: 'hero-image', namespace: 'media', spec: { sourceUrl: 's3://bucket/hero.png', formats: ['webp'], priority: 'normal' } }),
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
      'const output = job.k8s.ConfigMap({',
      'job.apply(output);',
      'job.events.normal(\'ImageJobAccepted\'',
      'job.requeue({ afterSeconds: 30, reason: \'WaitingForResizeOutputs\' });',
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
          allowNetworkAccess: false,
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
      expect(compiled.value.artifacts.generatedDeploymentYamlPath).toContain('deployment-image-pipeline.yaml');
      expect(compiled.value.artifacts.generatedImageDockerfilePath).toContain('Dockerfile.applik8s-runtime');
      expect(compiled.value.artifacts.generatedApplyScriptPath).toContain('apply.sh');

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
      spec: { sourceUrl: 's3://bucket/hero.png', formats: ['webp'], priority: 'normal' },
    });

    expect(composition.value.crdFactories.ImageJob).toBeTypeOf('function');
    expect(composition.value.crdFactories.imageJob).toBeTypeOf('function');
    expect(composition.value.resources.some((resource) => resource.kind === 'Deployment')).toBe(true);
    expect(image.kind).toBe('ImageJob');
    expect(image.metadata.namespace).toBe('media-system');
  });

});
