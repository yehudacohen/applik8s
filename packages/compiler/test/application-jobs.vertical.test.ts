// typecast-file-boundary: this compiler test narrows optional emitted artifacts
// and decoded manifest metadata only after asserting their defining shape.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  app,
  applicationGraphFor,
  ContainerRegistry,
  Database,
  EventLog,
  FiniteExecutionHost,
  IdentityProvider,
  JobResultStore,
  JobRuntime,
  KubernetesCluster,
  Queue,
  Scheduler,
  TransactionalDatabase,
} from '@applik8s/applik8s';
import { type } from 'arktype';
import { describe, expect, test } from 'vitest';
import { emitGeneratedApplicationJobs } from '../src/application-jobs/index.js';
import { emitGeneratedApplicationHttpServers } from '../src/application-http/index.js';
import { emitGeneratedApplicationReactive } from '../src/application-reactive/index.js';

describe('generated Kubernetes finite Job controller', () => {
  test('bundles immutable definitions and emits controller, RBAC, service, and worker configuration', async () => {
    const application = app('finite-jobs', {
      namespace: 'finite-jobs',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    });
    const cluster = KubernetesCluster.current();
    const database = application.provide(TransactionalDatabase, Database.postgres({
      name: 'job-state',
      namespace: 'finite-jobs',
      database: 'jobs',
    }));
    const eventLog = application.provide(EventLog, {
      kind: 'nats-jetstream',
      name: 'job-events',
      namespace: 'finite-jobs',
    });
    const registry = application.provide(ContainerRegistry, ContainerRegistry.oci({
      endpoint: ContainerRegistry.origin('https://registry.example.test'),
      repositoryPrefix: 'finite-jobs',
    }));
    application.provide(JobRuntime, JobRuntime.kubernetes({
      cluster,
      namespace: 'finite-jobs',
      maximumConcurrency: 7,
      queue: Queue.jetStream({ eventLog }),
      executionHost: FiniteExecutionHost.kubernetes({ cluster, registry }),
      results: JobResultStore.postgres({ database }),
      scheduler: Scheduler.postgres({ database }),
      events: eventLog,
    }));
    application.provide(
      IdentityProvider,
      IdentityProvider.deterministic({
        mode: 'starter',
        application: 'finite-jobs',
        subject: 'alice',
        audience: ['finite-jobs'],
        catalogRevision: 'catalog-v1',
        authorityRevision: 'authority-v1',
      }),
    );
    const Double = application.job(
      'numbers.double.v1',
      {
        input: type({ value: 'number.integer' }),
        output: type({ doubled: 'number.integer' }),
        progress: type({ completed: 'number.integer' }),
      },
      { retries: 2, timeout: '5m', retention: { result: '2d', progress: '1h' } },
      async (input, execution) => {
        await execution.progress({ completed: 1 });
        return { doubled: input.value * 2 };
      },
    );
    application.events.of(Double.events.succeeded).onEvent(
      async function observeCompletedDouble(fact) {
        void fact.detail.output.doubled;
      },
    );
    application.http('job-api').post(
      'double-number',
      '/numbers/double',
      {
        input: type({ value: 'number.integer' }),
        output: type({ doubled: 'number.integer' }),
        __generatedCalls: [Double],
        __generatedBindings: { Double },
      },
      async ({ input }) => Double(input),
    ).public();
    const graph = applicationGraphFor(application.composition);
    expect(graph).toBeDefined();
    const outDir = await mkdtemp(join(tmpdir(), 'applik8s-jobs-'));
    try {
      const [artifact] = await emitGeneratedApplicationJobs({
        graph: graph!,
        outDir,
        entrypoint: import.meta.filename,
        executionTarget: 'kubernetes',
      });
      expect(artifact).toBeDefined();
      expect(artifact?.jobIds).toEqual(['job.numbers.double.v1']);
      expect(artifact?.frameworkCredentials).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'internal-operation' }),
      ]));
      expect(artifact?.resources.map(({ kind }) => kind)).toEqual([
        'ServiceAccount',
        'Role',
        'RoleBinding',
        'Service',
        'NetworkPolicy',
        'Deployment',
      ]);
      const role = artifact?.resources.find(({ kind }) => kind === 'Role');
      expect(role?.rules).toEqual([
        { apiGroups: ['batch'], resources: ['jobs'], verbs: ['create', 'get', 'delete'] },
      ]);
      const deployment = artifact?.resources.find(({ kind }) => kind === 'Deployment');
      expect(JSON.stringify(deployment)).toContain('job-state-app');
      expect(JSON.stringify(deployment)).toContain('APPLIK8S_JOB_IMAGE');
      const source = await readFile(artifact!.sourcePath, 'utf8');
      expect(source).toContain('applik8s-job-run');
      expect(source).toContain('batch/v1');
      expect(source).not.toContain('npm install');
      expect(artifact?.container.baseImage).toMatch(/@sha256:/);
      const [http] = await emitGeneratedApplicationHttpServers({
        graph: graph!,
        outDir: join(outDir, 'http'),
        entrypoint: import.meta.filename,
        executionTarget: 'kubernetes',
      });
      expect(http).toBeDefined();
      const httpSource = await readFile(http!.sourcePath, 'utf8');
      expect(httpSource).toContain('numbers.double.v1');
      expect(httpSource).toContain('finite-jobs-jobs.finite-jobs.svc:8091/v1/jobs');
      expect(httpSource).not.toContain('completed:1');
      const httpMetafile = JSON.parse(
        await readFile(http!.metafilePath, 'utf8'),
      ) as { readonly inputs?: Readonly<Record<string, unknown>> };
      expect(
        Object.keys(httpMetafile.inputs ?? {}).some((path) =>
          path.endsWith('/application-job-remote-runtime.ts')),
      ).toBe(true);
      expect(JSON.stringify(http?.resources)).toContain('APPLIK8S_INTERNAL_OPERATION_SECRET');
      expect(JSON.stringify(http?.resources)).toContain('job-state-app');
      const reactive = await emitGeneratedApplicationReactive({
        graph: graph!,
        outDir: join(outDir, 'reactive'),
        entrypoint: import.meta.filename,
        executionTarget: 'kubernetes',
      });
      const lifecycleProcessor = reactive.find((candidate) => candidate.kind === 'streamProcessorWorker');
      expect(lifecycleProcessor).toBeDefined();
      const lifecycleSource = await readFile(lifecycleProcessor!.sourcePath, 'utf8');
      expect(lifecycleSource).toContain('jobs.numbers.double.succeeded');
      expect(lifecycleSource).toContain('createPostgresApplicationCatalogStream');
      expect(JSON.stringify(lifecycleProcessor!.resources)).toContain('job-state-app');
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  }, 60_000);
});
