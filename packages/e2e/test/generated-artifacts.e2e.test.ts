import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { compileTypeKroComposition, createCompilerPipeline } from '@applik8s/compiler';
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

describe('Tenant Platform generated artifact pressure test', () => {
  let tenantTempDir: string | undefined;

  afterAll(async () => {
    if (tenantTempDir) {
      await rm(tenantTempDir, { recursive: true, force: true });
    }
  });

  it('emits the v0.3 control-plane substrate through the compiler artifact path', async () => {
    tenantTempDir = await mkdtemp(join(tmpdir(), 'applik8s-e2e-tenant-platform-artifacts-'));
    const compiled = await compileTypeKroComposition({
      entrypoint: join(process.cwd(), 'examples/tenant-platform.ts'),
      compositionName: 'tenantPlatform',
      outDir: join(tenantTempDir, 'dist'),
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
      throw new Error(compiled.error.message);
    }

    // typecast: compiler artifacts are JSON Kubernetes resources emitted by the compiler under test and narrowed by resource assertions below.
    const resources = JSON.parse(await readFile(compiled.value.artifacts.resourcesJsonPath, 'utf8')) as readonly KubernetesResource[];
    const templates = artifactResources(resources);
    expect(templates.map(resourceKey)).toEqual(expect.arrayContaining([
      resourceKeyFor('postgresql.cnpg.io/v1', 'Cluster', 'tenant-platform-db', 'platform'),
      resourceKeyFor('batch/v1', 'Job', 'account-migration', 'platform'),
      resourceKeyFor('batch/v1', 'Job', 'audit-record-migration', 'platform'),
      resourceKeyFor('batch/v1', 'Job', 'invitation-migration', 'platform'),
      resourceKeyFor('batch/v1', 'Job', 'usage-sample-migration', 'platform'),
      resourceKeyFor('batch/v1', 'Job', 'tenant-platform-repair', 'platform'),
      resourceKeyFor('batch/v1', 'CronJob', 'tenant-platform-cleanup', 'platform'),
      resourceKeyFor('apps/v1', 'Deployment', 'tenant-admin', 'platform'),
      resourceKeyFor('apps/v1', 'Deployment', 'tenant-platform-status-reconciler', 'platform'),
      resourceKeyFor('v1', 'ConfigMap', 'account-migration-migration', 'platform'),
      resourceKeyFor('v1', 'ConfigMap', 'tenant-platform-status-reconciler-status', 'platform'),
    ]));

    const migration = templates.find((candidate) => candidate.kind === 'ConfigMap' && candidate.metadata.name === 'account-migration-migration');
    expect(migration?.data).toMatchObject({
      'preflight.sql': expect.stringContaining('applik8s-model-migration-preflight'),
      'migration.sql': expect.stringContaining('CREATE TABLE IF NOT EXISTS "applik8s_account"'),
    });
    expect(migration?.data?.['preflight.sql']).toContain('actual_history');
    expect(migration?.data?.['preflight.sql']).toContain('missingHistoryColumn');
    expect(migration?.data?.['preflight.sql']).toContain('pg_index');
    expect(migration?.data?.['preflight.sql']).toContain('pg_get_indexdef');
    expect(migration?.data?.['preflight.sql']).toContain('indisunique');
    expect(migration?.data?.['preflight.sql']).toContain('normalized_index_definition');
    expect(migration?.data?.['migration.sql']).not.toContain('DROP TABLE');
    expect(migration?.data?.['migration.sql']).not.toContain('DROP INDEX');
    const statusReconciler = templates.find((candidate) => candidate.kind === 'Deployment' && candidate.metadata.name === 'tenant-platform-status-reconciler');
    expect(statusReconciler?.spec?.template?.spec?.containers?.[0]?.env).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'APPLIK8S_NAMESPACE', value: 'platform' }),
    ]));
    const statusConfigMap = templates.find((candidate) => candidate.kind === 'ConfigMap' && candidate.metadata.name === 'tenant-platform-status-reconciler-status');
    expect(statusConfigMap?.data).toBeUndefined();
    expect(Reflect.get(statusConfigMap ?? {}, '__externalRef')).toBe(true);
    const tenantRgd = resources.find((candidate) => candidate.apiVersion === 'kro.run/v1alpha1' && candidate.kind === 'ResourceGraphDefinition' && candidate.metadata.name === 'tenant-platform');
    const rgdSpec = Reflect.get(tenantRgd ?? {}, 'spec');
    const jobsProjection = Reflect.get(Reflect.get(Reflect.get(rgdSpec ?? {}, 'schema') ?? {}, 'status')?.applik8s ?? {}, 'jobs');
    expect(jobsProjection).toEqual(expect.stringContaining('json.unmarshal(tenantPlatformStatusReconcilerDurableStatus.data["applik8s-jobs.json"])'));
    expect(Reflect.get(rgdSpec ?? {}, 'resources')).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'tenantPlatformStatusReconcilerDurableStatus', externalRef: expect.objectContaining({ apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'tenant-platform-status-reconciler-status', namespace: 'platform' } }) }),
    ]));
    const serverSource = templates.find((candidate) => candidate.kind === 'ConfigMap' && candidate.metadata.name === 'tenant-admin-source');
    const serverDeployment = templates.find((candidate) => candidate.kind === 'Deployment' && candidate.metadata.name === 'tenant-admin');
    expect(serverSource?.data).toMatchObject({
      'server.mjs': expect.stringContaining('applik8sServerRuntime'),
      'server.mjs.map': expect.any(String),
      'routes.manifest.json': expect.stringContaining('/tenants/:tenant/accounts'),
      'runtime.bundle.json': expect.stringContaining('"packageManagerAtStartup": false'),
    });
    expect(serverSource?.data?.['package.json']).toBeUndefined();
    expect(JSON.stringify(serverDeployment)).not.toContain('npm install');
    expect(JSON.stringify(serverDeployment)).toContain('/app/server.mjs');
    expect(JSON.stringify(serverSource?.data ?? {}).length).toBeLessThan(1_000_000);
    expect(compiled.value.artifacts.applicationGraphJsonPath).toBe(join(tenantTempDir, 'dist', 'typekro', 'application-graph.json'));
    // typecast: compiler emits the application graph as JSON; the test narrows only the node fields asserted below.
    const graph = JSON.parse(await readFile(compiled.value.artifacts.applicationGraphJsonPath ?? '', 'utf8')) as { readonly nodes?: readonly { readonly id?: string; readonly kind?: string; readonly name?: string }[] };
    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'provider.transactional-database', kind: 'provider', name: 'TransactionalDatabase' }),
      expect.objectContaining({ id: 'server.tenant-admin', kind: 'server' }),
      expect.objectContaining({ id: 'job.account-migration', kind: 'workloadJob' }),
      expect.objectContaining({ id: 'job.audit-record-migration', kind: 'workloadJob' }),
      expect.objectContaining({ id: 'job.invitation-migration', kind: 'workloadJob' }),
      expect.objectContaining({ id: 'job.usage-sample-migration', kind: 'workloadJob' }),
      expect.objectContaining({ id: 'job.tenant-platform-repair', kind: 'workloadJob' }),
      expect.objectContaining({ id: 'job.tenant-platform-cleanup', kind: 'workloadJob' }),
    ]));
    expect(compiled.value.artifacts.manifest.spec.applicationGraph).toMatchObject({
      apiVersion: 'applik8s.appGraph/v1alpha1',
      path: compiled.value.artifacts.applicationGraphJsonPath,
      digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
  }, 120_000);

  it('emits fail-closed graph diagnostics for unlowerable watch predicates', async () => {
    const watchTempDir = await mkdtemp(join(tmpdir(), 'applik8s-watch-scope-artifacts-'));
    try {
      const entrypoint = join(watchTempDir, 'watch-scope.ts');
      await writeFile(entrypoint, unsupportedWatchScopeSource());
      const compiled = await compileTypeKroComposition({
        entrypoint,
        outDir: join(watchTempDir, 'dist'),
        compositionName: 'watchScopePressureTest',
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
        throw new Error(compiled.error.message);
      }
      // typecast: generated artifact JSON is validated by the assertions below; this narrows the parsed graph shape used by the test.
      const graph = JSON.parse(await readFile(compiled.value.artifacts.applicationGraphJsonPath ?? '', 'utf8')) as { readonly nodes?: readonly { readonly kind?: string; readonly watchContracts?: readonly { readonly lowering?: string; readonly failurePolicy?: string; readonly permissions?: readonly unknown[]; readonly diagnostics?: readonly { readonly event?: string; readonly reason?: string; readonly retryable?: boolean }[] }[] }[] };
      const operator = graph.nodes?.find((node) => node.kind === 'operator');
      const unsupported = operator?.watchContracts?.find((contract) => contract.diagnostics?.some((diagnostic) => diagnostic.event === 'applik8s-watch-scope-unlowerable'));

      expect(unsupported).toMatchObject({ lowering: 'mixed', failurePolicy: 'failClosed', permissions: [] });
      expect(unsupported?.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({ event: 'applik8s-watch-scope-unlowerable', reason: 'UnsupportedLabelSelectorExpression', retryable: false }),
      ]));
    } finally {
      await rm(watchTempDir, { recursive: true, force: true });
    }
  }, 120_000);
});

interface KubernetesResource {
  readonly apiVersion: string;
  readonly kind: string;
  readonly metadata: {
    readonly name: string;
    readonly namespace?: string;
  };
  readonly data?: Record<string, string>;
  readonly spec?: {
    readonly resources?: readonly { readonly template?: KubernetesResource }[];
    readonly template?: {
      readonly spec?: {
        readonly containers?: readonly { readonly env?: readonly Record<string, unknown>[] }[];
      };
    };
  };
}

function artifactResources(resources: readonly KubernetesResource[]): readonly KubernetesResource[] {
  return resources.flatMap((resource) => [resource, ...(resource.spec?.resources ?? []).flatMap((entry) => entry.template ? [entry.template] : [])]);
}

function resourceKey(resource: KubernetesResource): string {
  return resourceKeyFor(resource.apiVersion, resource.kind, resource.metadata.name, resource.metadata.namespace);
}

function resourceKeyFor(apiVersion: string, kind: string, name: string, namespace = ''): string {
  return `${apiVersion}/${kind}/${namespace}/${name}`;
}

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

function unsupportedWatchScopeSource(): string {
  return `import { type } from 'arktype';
import { sdk } from ${JSON.stringify(join(process.cwd(), 'packages/applik8s/src/application.ts'))};

const Note = sdk.crd({
  apiVersion: 'notes.applik8s.dev/v1alpha1',
  kind: 'Note',
  spec: type({ message: 'string' }),
  status: type({ phase: 'string?' }),
});

const watchedOperator = Object.assign((_options: object) => ({}), {
  definition: {
    name: 'watched-notes-controller',
    resources: { Note },
    handlers: [
      { id: 'Note.reconcile.unsupported', event: 'reconcile', resource: Note, watch: { namespace: 'notes', labelSelector: { matchExpressions: [{ key: 'app', operator: 'Exists' }] } } },
    ],
  },
});

export const watchScopePressureTest = sdk.kubernetesComposition({
  name: 'watch-scope-pressure-test',
  apiVersion: 'notes.applik8s.dev/v1alpha1',
  kind: 'WatchScopePressureTest',
  spec: type({}),
  status: type({ ready: 'boolean' }),
}, (_spec, app) => {
  app.operator(watchedOperator, { namespace: 'notes' });
  return { ready: true };
});
`;
}
