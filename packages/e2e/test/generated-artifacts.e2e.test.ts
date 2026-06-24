import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createCompilerPipeline } from '@applik8s/compiler';
import { assertExpectedKubectlContext, describeGeneratedArtifacts, generatedManifestPaths, kubectl } from './live-e2e-helpers';

const namespace = process.env.APPLIK8S_E2E_NAMESPACE ?? `applik8s-artifacts-${process.pid}`;
const apiGroup = process.env.APPLIK8S_E2E_API_GROUP ?? `media-${process.pid}.applik8s.dev`;
let tempDir: string | undefined;
let artifactDir: string | undefined;
let samplePath: string | undefined;

describeGeneratedArtifacts('generated artifact Kubernetes acceptance', () => {
  beforeAll(async () => {
    await assertExpectedKubectlContext();

    await kubectl(['create', 'namespace', namespace]);
    tempDir = await mkdtemp(join(tmpdir(), 'applik8s-e2e-artifacts-'));
    const entrypoint = join(tempDir, 'image-pipeline.ts');
    await writeFile(entrypoint, imagePipelineSource(namespace));

    const compiled = await createCompilerPipeline().run({
      entrypoint,
      outDir: join(tempDir, 'dist'),
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

    if (!compiled.ok) {
      throw new Error(compiled.error.message);
    }

    artifactDir = join(tempDir, 'dist/kubernetes');
    samplePath = join(tempDir, 'hero-image.yaml');
    await writeFile(
      samplePath,
      `apiVersion: ${apiGroup}/v1alpha1
kind: ImageJob
metadata:
  name: hero-image
  namespace: ${namespace}
spec:
  sourceUrl: s3://bucket/hero.png
  formats:
    - webp
  priority: normal
`
    );
  }, 120_000);

  afterAll(async () => {
    if (process.env.APPLIK8S_E2E === '1') {
      await kubectl(['delete', 'namespace', namespace, '--ignore-not-found=true', '--wait=false']);
    }
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('applies generated CRD, RBAC, and Deployment for the derived runtime image', async () => {
    if (!artifactDir) {
      throw new Error('Artifact directory was not generated.');
    }

    for (const manifestPath of await generatedManifestPaths(artifactDir)) {
      await kubectl(['apply', '--server-side', '--field-manager=applik8s-e2e', '--filename', manifestPath]);
    }

    await kubectl(['wait', `crd/imagejobs.${apiGroup}`, '--for=condition=Established', '--timeout=60s']);

    expect((await kubectl(['get', 'deployment/image-pipeline', '--namespace', namespace, '--output=jsonpath={.spec.replicas}'])).stdout.trim()).toBe('0');
    expect((await kubectl(['get', 'deployment/image-pipeline', '--namespace', namespace, '--output=jsonpath={.spec.template.spec.containers[0].image}'])).stdout.trim()).toMatch(/^applik8s\/image-pipeline-operator:[a-f0-9]{12}$/);
  }, 120_000);

  it('accepts a sample custom resource for the generated CRD', async () => {
    if (!samplePath) {
      throw new Error('Sample resource was not generated.');
    }

    await kubectl(['apply', '--server-side', '--field-manager=applik8s-e2e', '--filename', samplePath]);

    expect((await kubectl(['get', `imagejobs.${apiGroup}/hero-image`, '--namespace', namespace, '--output=name'])).stdout.trim()).toBe(`imagejob.${apiGroup}/hero-image`);
  });
});

function imagePipelineSource(operatorNamespace: string): string {
  return `import { sdk } from ${JSON.stringify(join(process.cwd(), 'packages/sdk/src/index.ts'))};

interface ImageSpec { sourceUrl: string; formats: string[]; priority: 'low' | 'normal' | 'high' }
interface ImageStatus { phase?: 'Processing'; outputUrls?: string[] }

const spec = {
  kind: 'jsonSchema' as const,
  ref: { kind: 'jsonSchema' as const, exportName: 'ImageSpec' },
  schema: {
    type: 'object',
    required: ['sourceUrl', 'formats', 'priority'],
    additionalProperties: false,
    properties: {
      sourceUrl: { type: 'string' },
      formats: { type: 'array', items: { type: 'string' } },
      priority: { type: 'string', enum: ['low', 'normal', 'high'] },
    },
  },
};
const status = {
  kind: 'jsonSchema' as const,
  ref: { kind: 'jsonSchema' as const, exportName: 'ImageStatus' },
  schema: { type: 'object', properties: { phase: { type: 'string' }, outputUrls: { type: 'array', items: { type: 'string' } } } },
};

export const ImageJob = sdk.crd<ImageSpec, ImageStatus>({ apiVersion: ${JSON.stringify(`${apiGroup}/v1alpha1`)}, kind: 'ImageJob', spec, status });
export const imagePipeline = sdk.operator({
  name: 'image-pipeline',
  deployment: { namespace: ${JSON.stringify(operatorNamespace)}, replicas: 0 },
  resources: { ImageJob },
  handlers: [ImageJob.on.reconcile((job) => { job.status.phase = 'Processing'; job.status.outputUrls = []; })],
});
`;
}
