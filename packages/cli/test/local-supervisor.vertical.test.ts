// typecast-file-boundary: Supervisor fixtures preserve exact plan discriminants and inspect optional binding arrays after asserting their fixture shape.
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { LocalSupervisorPlan } from '@applik8s/deployment-contract';
import { describe, expect, it } from 'vitest';
import { readLocalApplicationHostFrameworkCredentials, readLocalRuntimeArtifacts, startLocalDevelopmentWatcher } from '../src/local-development-command.js';
import {
  type LocalSupervisorDriver,
  startLocalSupervisor,
} from '../src/local-supervisor.js';

describe('local supervisor', () => {
  it('watches authored source changes while ignoring generated build output', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'applik8s-local-watch-'));
    const sourceDirectory = join(root, 'src');
    const outDir = join(root, '.applik8s', 'local-build');
    await mkdir(sourceDirectory, { recursive: true });
    await mkdir(outDir, { recursive: true });
    const entrypoint = join(sourceDirectory, 'app.ts');
    const generated = join(outDir, 'runtime.mjs');
    await writeFile(entrypoint, 'export const version = 1;\n');
    await writeFile(join(root, 'package.json'), '{}\n');
    await writeFile(generated, 'export const generated = 1;\n');
    const observed: string[][] = [];
    const abort = new AbortController();
    const watcher = startLocalDevelopmentWatcher({
      projectRoot: root,
      applicationEntrypoint: entrypoint,
      outDir,
      signal: abort.signal,
      usePolling: true,
      async rebuild(changes) { observed.push([...changes]); },
      onError(error) { throw error; },
    });
    try {
      await once(watcher, 'ready');

      await writeFile(entrypoint, 'export const version = 2;\n');
      await expect.poll(() => new Set(observed.flat()).size).toBe(1);
      expect(new Set(observed.flat())).toEqual(new Set([entrypoint]));

      const rebuildCount = observed.length;
      await writeFile(generated, 'export const generated = 2;\n');
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
      expect(observed).toHaveLength(rebuildCount);
    } finally {
      abort.abort();
      await watcher.close();
    }
  });

  it('admits only digest-verified compiler runtime artifacts inside the build root', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'applik8s-local-artifacts-'));
    const artifactDirectory = join(root, 'processors', 'example');
    await mkdir(artifactDirectory, { recursive: true });
    const source = join(artifactDirectory, 'processor.mjs');
    const contents = 'export const ready = true;\n';
    await writeFile(source, contents);
    const digest = `sha256:${createHash('sha256').update(contents).digest('hex')}`;
    const manifest = join(root, 'typekro-composition.json');
    await writeFile(manifest, JSON.stringify({
      apiVersion: 'applik8s.dev/v1alpha1', kind: 'TypeKroCompositionBundle',
      spec: { processors: [{ name: 'example', nodeId: 'processor.example', source, digest }] },
    }));

    await expect(readLocalRuntimeArtifacts(manifest, root)).resolves.toEqual([{
      name: 'example', nodeId: 'processor.example', role: 'processor', source, digest,
    }]);
    await writeFile(source, 'export const ready = false;\n');
    await expect(readLocalRuntimeArtifacts(manifest, root)).rejects.toThrow(/digest mismatch/u);

    await writeFile(manifest, JSON.stringify({
      apiVersion: 'applik8s.dev/v1alpha1', kind: 'TypeKroCompositionBundle',
      spec: { processors: [{ name: 'escape', nodeId: 'processor.escape', source: join(root, '..', 'escape.mjs'), digest }] },
    }));
    await expect(readLocalRuntimeArtifacts(manifest, root)).rejects.toThrow(/escapes its build root/u);
  });

  it('loads generated finite Job controllers as first-class runtime artifacts', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'applik8s-local-jobs-'));
    const source = join(root, 'job-controller.mjs');
    const contents = 'export const controller = true;\n';
    await writeFile(source, contents);
    const digest = `sha256:${createHash('sha256').update(contents).digest('hex')}`;
    const manifest = join(root, 'typekro-composition.json');
    await writeFile(manifest, JSON.stringify({
      apiVersion: 'applik8s.dev/v1alpha1', kind: 'TypeKroCompositionBundle',
      spec: { jobs: [{ name: 'jobs', nodeId: 'provider.JobRuntime', source, digest }] },
    }));
    await expect(readLocalRuntimeArtifacts(manifest, root)).resolves.toEqual([{
      name: 'jobs', nodeId: 'provider.JobRuntime', role: 'job', source, digest,
    }]);
  });

  it('selects paired local artifacts only for local execution and rejects partial local variants', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'applik8s-local-variant-'));
    const artifactDirectory = join(root, 'lakehouse', 'example');
    await mkdir(artifactDirectory, { recursive: true });
    const cloudSource = join(artifactDirectory, 'publisher.mjs');
    const localSource = join(artifactDirectory, 'publisher.local.mjs');
    const cloudContent = 'export const provider = "s3";\n';
    const localContent = 'export const provider = "duckdb";\n';
    await writeFile(cloudSource, cloudContent);
    await writeFile(localSource, localContent);
    const cloudDigest = `sha256:${createHash('sha256').update(cloudContent).digest('hex')}`;
    const localDigest = `sha256:${createHash('sha256').update(localContent).digest('hex')}`;
    const manifest = join(root, 'typekro-composition.json');
    const bundle = (overrides: Record<string, unknown> = {}) => ({
      apiVersion: 'applik8s.dev/v1alpha1',
      kind: 'TypeKroCompositionBundle',
      spec: {
        lakehousePublishers: [{
          name: 'example', nodeId: 'lakehouse.example', source: cloudSource, digest: cloudDigest,
          localSource, localDigest, ...overrides,
        }],
      },
    });
    await writeFile(manifest, JSON.stringify(bundle()));

    await expect(readLocalRuntimeArtifacts(manifest, root, 'local')).resolves.toEqual([
      expect.objectContaining({ source: localSource, digest: localDigest, role: 'lakehouse' }),
    ]);
    await expect(readLocalRuntimeArtifacts(manifest, root, 'aws')).resolves.toEqual([
      expect.objectContaining({ source: cloudSource, digest: cloudDigest, role: 'lakehouse' }),
    ]);

    await writeFile(manifest, JSON.stringify(bundle({ localDigest: undefined })));
    await expect(readLocalRuntimeArtifacts(manifest, root, 'local')).rejects.toThrow(/localSource and localDigest together/u);
    await writeFile(manifest, JSON.stringify(bundle({ localDigest: 'sha256:not-a-digest' })));
    await expect(readLocalRuntimeArtifacts(manifest, root, 'local')).rejects.toThrow(/invalid local runtime artifact/u);
  });

  it('admits only closed, unique framework credential dependencies from compiler bundles', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'applik8s-runtime-credentials-'));
    const source = join(root, 'agent.mjs');
    const contents = 'export const ready = true;\n';
    await writeFile(source, contents);
    const digest = `sha256:${createHash('sha256').update(contents).digest('hex')}`;
    const manifest = join(root, 'typekro-composition.json');
    const bundle = (frameworkCredentials: unknown) => ({
      apiVersion: 'applik8s.dev/v1alpha1',
      kind: 'TypeKroCompositionBundle',
      spec: { agents: [{ name: 'assistant', nodeId: 'agent.assistant', source, digest, frameworkCredentials }] },
    });
    await writeFile(manifest, JSON.stringify(bundle([
      { kind: 'agent-query-context', environmentName: 'APPLIK8S_AGENT_QUERY_CONTEXT_SECRET' },
      { kind: 'internal-operation', environmentName: 'APPLIK8S_INTERNAL_OPERATION_SECRET' },
    ])));
    await expect(readLocalRuntimeArtifacts(manifest, root)).resolves.toEqual([
      expect.objectContaining({
        role: 'agent',
        frameworkCredentials: [
          { kind: 'agent-query-context', environmentName: 'APPLIK8S_AGENT_QUERY_CONTEXT_SECRET' },
          { kind: 'internal-operation', environmentName: 'APPLIK8S_INTERNAL_OPERATION_SECRET' },
        ],
      }),
    ]);

    await writeFile(manifest, JSON.stringify(bundle([
      { kind: 'ambient-root', environmentName: 'AWS_SECRET_ACCESS_KEY' },
    ])));
    await expect(readLocalRuntimeArtifacts(manifest, root)).rejects.toThrow(/frameworkCredentials\[0\].*invalid/u);

    await writeFile(manifest, JSON.stringify(bundle([
      { kind: 'internal-operation', environmentName: 'AWS_SECRET_ACCESS_KEY' },
    ])));
    await expect(readLocalRuntimeArtifacts(manifest, root)).rejects.toThrow(/noncanonical environment name/u);

    await writeFile(manifest, JSON.stringify(bundle([
      { kind: 'context', environmentName: 'APPLIK8S_CONTEXT_SECRET' },
      { kind: 'cursor', environmentName: 'APPLIK8S_CONTEXT_SECRET' },
    ])));
    await expect(readLocalRuntimeArtifacts(manifest, root)).rejects.toThrow(/repeats an environment name/u);
  });

  it('hydrates the application host credential contract independently of sibling runtimes', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'applik8s-host-credentials-'));
    const manifest = join(root, 'typekro-composition.json');
    await writeFile(manifest, JSON.stringify({
      apiVersion: 'applik8s.dev/v1alpha1',
      kind: 'TypeKroCompositionBundle',
      spec: {
        applicationHost: {
          nodeId: 'provider.ApplicationHost',
          frameworkCredentials: [
            { kind: 'cursor', environmentName: 'APPLIK8S_CURSOR_SECRET' },
            { kind: 'internal-operation', environmentName: 'APPLIK8S_INTERNAL_OPERATION_SECRET' },
          ],
        },
      },
    }));
    await expect(readLocalApplicationHostFrameworkCredentials(manifest)).resolves.toEqual([
      { kind: 'cursor', environmentName: 'APPLIK8S_CURSOR_SECRET' },
      { kind: 'internal-operation', environmentName: 'APPLIK8S_INTERNAL_OPERATION_SECRET' },
    ]);
  });

  it('admits and normalizes compiler-owned container recipes for target planning', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'applik8s-runtime-container-'));
    const artifactDirectory = join(root, 'processors', 'example');
    const context = join(artifactDirectory, 'container');
    await mkdir(context, { recursive: true });
    const source = join(artifactDirectory, 'processor.mjs');
    const contents = 'export const ready = true;\n';
    await writeFile(source, contents);
    await writeFile(join(context, 'Dockerfile'), 'FROM node:22.20.0-bookworm-slim\n');
    const digest = `sha256:${createHash('sha256').update(contents).digest('hex')}`;
    const manifest = join(root, 'typekro-composition.json');
    await writeFile(manifest, JSON.stringify({
      apiVersion: 'applik8s.dev/v1alpha1', kind: 'TypeKroCompositionBundle',
      spec: { processors: [{
        name: 'example', nodeId: 'processor.example', source, digest,
        container: {
          image: 'applik8s/example:generated', imageName: 'example', tag: 'generated', baseImage: 'node:22.20.0-bookworm-slim',
          contextPath: context, dockerfilePath: join(context, 'Dockerfile'), entrypoint: '/app/processor.mjs', command: ['node', '/app/processor.mjs'],
          sourceDigest: `sha256:${'b'.repeat(64)}`,
        },
      }] },
    }));

    await expect(readLocalRuntimeArtifacts(manifest, root)).resolves.toEqual([expect.objectContaining({
      nodeId: 'processor.example', role: 'processor', digest,
      container: expect.objectContaining({ contextPath: context, dockerfilePath: join(context, 'Dockerfile') }),
    })]);
  });

  it('admits digest-bound operator dispatchers and their manifests as one local authority artifact', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'applik8s-local-operator-'));
    const typekro = join(root, 'typekro');
    const operator = join(root, 'operators', 'example');
    await mkdir(typekro, { recursive: true });
    await mkdir(join(operator, 'bundle'), { recursive: true });
    const source = join(operator, 'bundle', 'handler.js');
    const contents = 'export async function handle() { return JSON.stringify({ operations: [] }); }\n';
    await writeFile(source, contents);
    const digest = `sha256:${createHash('sha256').update(contents).digest('hex')}`;
    const operatorManifest = join(operator, 'operator-manifest.json');
    await writeFile(operatorManifest, JSON.stringify({
      apiVersion: 'applik8s.operator/v1alpha1', kind: 'OperatorBundle',
      spec: { bundle: { artifacts: [{ kind: 'javascript-bundle', path: source, digest }] } },
    }));
    const manifest = join(typekro, 'typekro-composition.json');
    await writeFile(manifest, JSON.stringify({
      apiVersion: 'applik8s.dev/v1alpha1', kind: 'TypeKroCompositionBundle',
      spec: { operators: [{ name: 'example', manifest: operatorManifest, outDir: operator }] },
    }));

    await expect(readLocalRuntimeArtifacts(manifest, root)).resolves.toEqual([{
      name: 'example', nodeId: 'operator.example', role: 'operator', source, manifest: operatorManifest, digest,
    }]);
  });

  it('persists public evidence, isolates credentials, and rejects concurrent ownership', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'applik8s-local-supervisor-'));
    const events: string[] = [];
    const driver = fakeDriver(events);
    const io = { cwd: root, stdout: (message: string) => events.push(message), stderr: (message: string) => events.push(message) };
    const first = await startLocalSupervisor(plan(), io, { driver, stateRoot: join(root, 'state'), allocatePort: portBroker() });

    expect(first.state.resources).toEqual([
      { resourceId: 'database', runtimeId: 'runtime:database', kind: 'container' },
      { resourceId: 'web', runtimeId: 'runtime:web', kind: 'process', pid: 4242 },
    ]);
    expect(JSON.stringify(first.state)).not.toContain('generated-secret');
    const credentials = await readFile(join(root, 'state', 'credentials.json'), 'utf8');
    expect(credentials).toMatch(/credential:database:password/);
    expect(credentials).toContain('resolved-worker-token');
    expect(events).toContain('worker-token:resolved-worker-token');
    await expect(startLocalSupervisor(plan(), io, { driver, stateRoot: join(root, 'state'), allocatePort: portBroker() })).rejects.toThrow(/already active/);

    await first.stop();
    expect(events).toEqual(expect.arrayContaining(['healthy:database', 'healthy:web', 'stop:runtime:web', 'stop:runtime:database']));
    expect(events).toContain('schedule-state:web:schedules.json');
  });

  it('stops already-started resources when a later dependency fails health', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'applik8s-local-supervisor-failure-'));
    const events: string[] = [];
    const driver = fakeDriver(events, 'web');
    const io = { cwd: root, stdout: (message: string) => events.push(message), stderr: (message: string) => events.push(message) };

    await expect(startLocalSupervisor(plan(), io, { driver, stateRoot: join(root, 'state'), allocatePort: portBroker() })).rejects.toThrow('web failed health');
    expect(events).toEqual(expect.arrayContaining(['stop:runtime:web', 'stop:runtime:database']));
  });

  it('reloads only selected process groups while retaining provider containers and credentials', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'applik8s-local-reload-'));
    const events: string[] = [];
    const driver = fakeDriver(events);
    const io = { cwd: root, stdout: (message: string) => events.push(message), stderr: (message: string) => events.push(message) };
    const session = await startLocalSupervisor(plan(), io, { driver, stateRoot: join(root, 'state'), allocatePort: portBroker() });
    const credentialsBefore = await readFile(join(root, 'state', 'credentials.json'), 'utf8');
    events.length = 0;

    await session.reload(['web']);

    expect(events).toEqual(expect.arrayContaining(['stop:runtime:web', 'start:web', 'healthy:web', 'Reloaded local groups: web']));
    expect(events).not.toContain('stop:runtime:database');
    expect(events).not.toContain('start:database');
    expect(await readFile(join(root, 'state', 'credentials.json'), 'utf8')).toBe(credentialsBefore);
    await session.stop();
  });

  it('reconciles structural add, provider update, and removal in dependency order under one lease', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'applik8s-local-reconcile-'));
    const events: string[] = [];
    const driver = fakeDriver(events);
    const io = { cwd: root, stdout: (message: string) => events.push(message), stderr: (message: string) => events.push(message) };
    const original = plan();
    const session = await startLocalSupervisor(original, io, { driver, stateRoot: join(root, 'state'), allocatePort: portBroker() });
    const originalPort = session.state.bindings['port:web:http'];
    const worker = {
      id: 'worker', kind: 'process' as const, command: 'node', args: ['worker.mjs'], cwd: '.', environment: [],
      watch: ['src'], reloadGroup: 'worker', dependsOn: ['database'], lifecycle: { ownership: 'application' as const, retention: 'ephemeral' as const },
      health: { kind: 'process' as const, timeoutMs: 1_000 }, provenance: { graphNodeId: 'processor.worker' },
    };
    const withWorker: LocalSupervisorPlan = { ...original, resources: [...original.resources, worker] };
    events.length = 0;

    await session.reconcile(withWorker);
    expect(events).toEqual(expect.arrayContaining(['start:worker', 'healthy:worker']));
    expect(events).not.toContain('stop:runtime:database');
    expect(events).not.toContain('stop:runtime:web');

    const updated: LocalSupervisorPlan = {
      ...withWorker,
      resources: withWorker.resources.map((resource) => resource.id === 'database'
        ? { ...resource, image: 'postgres:18-alpine' }
        : resource),
    };
    events.length = 0;
    await session.reconcile(updated);
    expect(events.indexOf('stop:runtime:worker')).toBeLessThan(events.indexOf('stop:runtime:database'));
    expect(events.indexOf('stop:runtime:web')).toBeLessThan(events.indexOf('stop:runtime:database'));
    expect(events.indexOf('start:database')).toBeLessThan(events.indexOf('start:web'));
    expect(events.indexOf('start:database')).toBeLessThan(events.indexOf('start:worker'));
    expect(session.state.bindings['port:web:http']).toBe(originalPort);

    events.length = 0;
    await session.reconcile({ ...updated, resources: updated.resources.filter(({ id }) => id !== 'worker') });
    expect(events).toEqual(expect.arrayContaining(['stop:runtime:worker', 'remove:runtime:worker']));
    expect(events).not.toContain('stop:runtime:database');
    expect(events).not.toContain('stop:runtime:web');
    await session.stop();
  });

  it('restores the previous healthy process plan when structural reconciliation fails', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'applik8s-local-rollback-'));
    const events: string[] = [];
    const driver = fakeDriver(events, undefined, (resource) => resource.kind === 'process' && resource.args.includes('--broken'));
    const io = { cwd: root, stdout: (message: string) => events.push(message), stderr: (message: string) => events.push(message) };
    const original = plan();
    const session = await startLocalSupervisor(original, io, { driver, stateRoot: join(root, 'state'), allocatePort: portBroker() });
    const originalPlanDigest = session.state.planDigest;
    const broken: LocalSupervisorPlan = {
      ...original,
      resources: original.resources.map((resource) => resource.id === 'web' && resource.kind === 'process'
        ? { ...resource, args: [...resource.args, '--broken'] }
        : resource),
    };
    events.length = 0;

    await expect(session.reconcile(broken)).rejects.toThrow(/previous healthy plan was restored/u);

    expect(events.filter((event) => event === 'start:web')).toHaveLength(2);
    expect(session.state.planDigest).toBe(originalPlanDigest);
    expect(session.state.resources.some(({ resourceId }) => resourceId === 'web')).toBe(true);
    await session.stop();
  });

  it('recovers an unexpectedly exited process without restarting retained providers', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'applik8s-local-recovery-'));
    const events: string[] = [];
    const controlled = controlledExitDriver(events);
    const io = { cwd: root, stdout: (message: string) => events.push(message), stderr: (message: string) => events.push(message) };
    const session = await startLocalSupervisor(plan(), io, { driver: controlled.driver, stateRoot: join(root, 'state'), allocatePort: portBroker() });
    events.length = 0;

    controlled.exit('web');
    await expect.poll(() => events.filter((event) => event === 'start:web').length).toBe(1);

    expect(events).toEqual(expect.arrayContaining(['healthy:web', expect.stringMatching(/web exited unexpectedly and recovered/u)]));
    expect(events).not.toContain('start:database');
    expect(session.state.resources.find(({ resourceId }) => resourceId === 'web')?.runtimeId).toBe('runtime:web:2');
    await session.stop();
  });

  it('reloads, recovers, restarts, and resets a real supervised process under the persisted lease', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'applik8s-local-process-live-'));
    const stateRoot = join(root, 'state');
    const boots = join(root, 'boots.txt');
    const source = join(root, 'server.mjs');
    await writeFile(source, [
      "import { readFileSync, writeFileSync } from 'node:fs';",
      "import { createServer } from 'node:http';",
      `const path = ${JSON.stringify(boots)};`,
      "let count = 0; try { count = Number(readFileSync(path, 'utf8')); } catch {}",
      "writeFileSync(path, String(count + 1));",
      "const server = createServer((_request, response) => { response.statusCode = 200; response.end('ready'); });",
      "server.listen(Number(process.env.PORT), '127.0.0.1');",
      "process.on('SIGTERM', () => server.close(() => process.exit(0)));",
    ].join('\n'));
    const livePlan: LocalSupervisorPlan = {
      apiVersion: 'applik8s.localSupervisor/v1alpha1', application: 'live-process', target: 'local', profile: 'developer', projectDigest: 'sha256:live-process', diagnostics: [],
      bindings: [
        { id: 'port:web:http', owner: 'web', kind: 'port', sensitivity: 'public' },
        { id: 'endpoint:web:http', owner: 'web', kind: 'endpoint', sensitivity: 'public' },
      ],
      resources: [{
        id: 'web', kind: 'process', command: process.execPath, args: [source], cwd: root,
        environment: [{ name: 'PORT', binding: 'port:web:http' }], watch: ['src'], reloadGroup: 'web', dependsOn: [],
        lifecycle: { ownership: 'application', retention: 'ephemeral' },
        health: { kind: 'http', path: '/', portBinding: 'port:web:http', timeoutMs: 5_000 }, provenance: { graphNodeId: 'server.web' },
      }],
    };
    const messages: string[] = [];
    const io = { cwd: root, stdout: (message: string) => messages.push(message), stderr: (message: string) => messages.push(message) };
    const first = await startLocalSupervisor(livePlan, io, { stateRoot });
    const firstPort = first.state.bindings['port:web:http'];
    let second: Awaited<ReturnType<typeof startLocalSupervisor>> | undefined;
    try {
      await expect.poll(async () => Number(await readFile(boots, 'utf8'))).toBe(1);
      await first.reload(['web']);
      await expect.poll(async () => Number(await readFile(boots, 'utf8'))).toBe(2);
      const pid = first.state.resources.find(({ resourceId }) => resourceId === 'web')?.pid;
      expect(pid).toBeDefined();
      if (pid) process.kill(pid, 'SIGKILL');
      await expect.poll(async () => Number(await readFile(boots, 'utf8')), { timeout: 5_000 }).toBe(3);
      await first.stop();

      second = await startLocalSupervisor(livePlan, io, { stateRoot });
      await expect.poll(async () => Number(await readFile(boots, 'utf8'))).toBe(4);
      expect(second.state.bindings['port:web:http']).toBe(firstPort);
      await second.reset();
      expect(await access(stateRoot).then(() => true).catch(() => false)).toBe(false);
    } finally {
      await second?.stop();
      await first.stop();
    }
  });

  it('reclaims a stale supervisor lease, stops the orphaned child, and preserves its public endpoint', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'applik8s-local-supervisor-crash-'));
    const stateRoot = join(root, 'state');
    const source = join(root, 'server.mjs');
    await writeFile(source, [
      "import { createServer } from 'node:http';",
      "const server = createServer((_request, response) => { response.statusCode = 200; response.end('ready'); });",
      "server.listen(Number(process.env.PORT), '127.0.0.1');",
      "process.on('SIGTERM', () => server.close(() => process.exit(0)));",
    ].join('\n'));
    const livePlan: LocalSupervisorPlan = {
      apiVersion: 'applik8s.localSupervisor/v1alpha1', application: 'crash-recovery', target: 'local', profile: 'developer', projectDigest: 'sha256:crash-recovery', diagnostics: [],
      bindings: [
        { id: 'port:web:http', owner: 'web', kind: 'port', sensitivity: 'public' },
        { id: 'endpoint:web:http', owner: 'web', kind: 'endpoint', sensitivity: 'public' },
      ],
      resources: [{
        id: 'web', kind: 'process', command: process.execPath, args: [source], cwd: root,
        environment: [{ name: 'PORT', binding: 'port:web:http' }], watch: ['src'], reloadGroup: 'web', dependsOn: [],
        lifecycle: { ownership: 'application', retention: 'ephemeral' },
        health: { kind: 'http', path: '/', portBinding: 'port:web:http', timeoutMs: 5_000 }, provenance: { graphNodeId: 'server.web' },
      }],
    };
    const planPath = join(root, 'plan.json');
    await writeFile(planPath, JSON.stringify(livePlan));
    const owner = spawn(process.execPath, [
      resolve('packages/cli/test/fixtures/local-supervisor-owner.mjs'),
      resolve('packages/cli/src/local-supervisor.ts'),
      planPath,
      stateRoot,
    ], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let recovered: Awaited<ReturnType<typeof startLocalSupervisor>> | undefined;
    try {
      const ready = await readFirstJsonLine(owner.stdout);
      expect(ready).toMatchObject({ ready: true });
      const persisted = JSON.parse(await readFile(join(stateRoot, 'state.json'), 'utf8')) as { readonly bindings: Record<string, string | number>; readonly resources: readonly { readonly pid?: number }[] };
      const orphanPid = persisted.resources[0]?.pid;
      const retainedPort = persisted.bindings['port:web:http'];
      expect(orphanPid).toBeDefined();
      owner.kill('SIGKILL');
      await once(owner, 'exit');
      if (orphanPid) expect(processIsAliveForTest(orphanPid)).toBe(true);

      recovered = await startLocalSupervisor(livePlan, { cwd: root, stdout() {}, stderr() {} }, { stateRoot });
      expect(recovered.state.bindings['port:web:http']).toBe(retainedPort);
      if (orphanPid) expect(processIsAliveForTest(orphanPid)).toBe(false);
      await recovered.reset();
    } finally {
      if (owner.exitCode === null && owner.signalCode === null) owner.kill('SIGKILL');
      await recovered?.stop();
    }
  });

  it('forwards declared host credentials without leaking unrelated ambient variables or persisting values', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'applik8s-local-environment-'));
    const output = join(root, 'environment.json');
    const io = { cwd: root, stdout() {}, stderr() {} };
    const isolatedPlan = hostEnvironmentPlan(root, output);
    const hostEnvironment = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      DECLARED_CREDENTIAL: 'declared-value',
      UNDECLARED_CREDENTIAL: 'must-not-cross-boundary',
    };

    await expect(startLocalSupervisor(isolatedPlan, io, {
      stateRoot: join(root, 'missing-state'),
      hostEnvironment: { PATH: process.env.PATH, HOME: process.env.HOME },
    })).rejects.toThrow(/DECLARED_CREDENTIAL.*unavailable/u);

    const session = await startLocalSupervisor(isolatedPlan, io, {
      stateRoot: join(root, 'state'),
      hostEnvironment,
    });
    const observed = await readJsonEventually(output);
    expect(observed).toEqual({ declared: 'declared-value', pathPresent: true });
    expect(JSON.stringify(session.state)).not.toContain('declared-value');
    expect(JSON.stringify(session.state)).not.toContain('must-not-cross-boundary');
    const credentials = await readFile(join(root, 'state', 'credentials.json'), 'utf8');
    expect(credentials).not.toContain('declared-value');
    expect(credentials).not.toContain('must-not-cross-boundary');
    await session.stop();
  });
});

async function readJsonEventually(path: string): Promise<unknown> {
  let last: unknown;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return JSON.parse(await readFile(path, 'utf8'));
    } catch (cause) {
      last = cause;
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
  }
  throw last;
}

async function readFirstJsonLine(stream: NodeJS.ReadableStream): Promise<unknown> {
  return new Promise((resolveLine, reject) => {
    let buffered = '';
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for the local supervisor owner.')), 10_000);
    stream.on('data', (chunk: Buffer) => {
      buffered += chunk.toString('utf8');
      const newline = buffered.indexOf('\n');
      if (newline < 0) return;
      clearTimeout(timeout);
      resolveLine(JSON.parse(buffered.slice(0, newline)));
    });
    stream.on('error', (cause) => { clearTimeout(timeout); reject(cause); });
  });
}

function processIsAliveForTest(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function hostEnvironmentPlan(root: string, output: string): LocalSupervisorPlan {
  return {
    apiVersion: 'applik8s.localSupervisor/v1alpha1',
    application: 'environment-isolation',
    target: 'local',
    profile: 'developer',
    projectDigest: 'sha256:environment-isolation',
    diagnostics: [],
    bindings: [{
      id: 'host-environment:declared',
      owner: 'authority:host-environment',
      kind: 'hostEnvironment',
      sensitivity: 'sensitive',
      sourceEnvironment: 'DECLARED_CREDENTIAL',
    }],
    resources: [
      {
        id: 'authority:host-environment', kind: 'external', provider: 'operation-host-environment', responsibility: 'test authority',
        dependsOn: [], lifecycle: { ownership: 'external', retention: 'external' }, health: { kind: 'external', timeoutMs: 100 },
        provenance: { graphNodeId: 'framework.hostEnvironment' },
      },
      {
        id: 'probe', kind: 'process', command: process.execPath,
        args: ['-e', `require('node:fs').writeFileSync(process.argv[1], JSON.stringify({ declared: process.env.DECLARED, leaked: process.env.UNDECLARED_CREDENTIAL, pathPresent: Boolean(process.env.PATH) })); setInterval(() => {}, 1000);`, output],
        cwd: root,
        environment: [{ name: 'DECLARED', binding: 'host-environment:declared' }],
        watch: [], reloadGroup: 'probe', dependsOn: [], lifecycle: { ownership: 'application', retention: 'ephemeral' },
        health: { kind: 'process', timeoutMs: 1_000 }, provenance: { graphNodeId: 'probe' },
      },
    ],
  };
}

function fakeDriver(
  events: string[],
  failHealth?: string,
  failHealthWhen?: (resource: Parameters<LocalSupervisorDriver['waitHealthy']>[0]) => boolean,
): LocalSupervisorDriver {
  return {
    async startContainer(resource) { events.push(`start:${resource.id}`); return { resourceId: resource.id, runtimeId: `runtime:${resource.id}`, kind: 'container' }; },
    async startProcess(resource, environment) {
      events.push(`start:${resource.id}`);
      if (environment.APPLIK8S_SCHEDULE_STATE_PATH) events.push(`schedule-state:${resource.id}:${environment.APPLIK8S_SCHEDULE_STATE_PATH.split('/').at(-1)}`);
      if (environment.WORKER_TOKEN) events.push(`worker-token:${environment.WORKER_TOKEN}`);
      return { resourceId: resource.id, runtimeId: `runtime:${resource.id}`, kind: 'process', pid: 4242 };
    },
    async waitHealthy(resource) {
      if (resource.id === failHealth || failHealthWhen?.(resource)) throw new Error(`${resource.id} failed health`);
      events.push(`healthy:${resource.id}`);
    },
    async stop(resource) { events.push(`stop:${resource.runtimeId}`); },
    async remove(resource) { events.push(`remove:${resource.runtimeId}`); },
    async resolveBindings(resource) {
      return resource.readyOutputs?.length ? { [resource.readyOutputs[0]!.binding]: 'resolved-worker-token' } : {};
    },
  };
}

function controlledExitDriver(events: string[]): {
  readonly driver: LocalSupervisorDriver;
  exit(resourceId: string): void;
} {
  const exits = new Map<string, () => void>();
  const counts = new Map<string, number>();
  return {
    driver: {
      async startContainer(resource) {
        const count = (counts.get(resource.id) ?? 0) + 1;
        counts.set(resource.id, count);
        events.push(`start:${resource.id}`);
        return { resourceId: resource.id, runtimeId: `runtime:${resource.id}:${count}`, kind: 'container' };
      },
      async startProcess(resource) {
        const count = (counts.get(resource.id) ?? 0) + 1;
        counts.set(resource.id, count);
        events.push(`start:${resource.id}`);
        return { resourceId: resource.id, runtimeId: `runtime:${resource.id}:${count}`, kind: 'process', pid: 4_242 + count };
      },
      async waitHealthy(resource) { events.push(`healthy:${resource.id}`); },
      async stop(resource) {
        events.push(`stop:${resource.runtimeId}`);
        exits.get(resource.runtimeId)?.();
      },
      async remove(resource) { events.push(`remove:${resource.runtimeId}`); },
      async resolveBindings(resource) {
        return resource.readyOutputs?.length ? { [resource.readyOutputs[0]!.binding]: 'resolved-worker-token' } : {};
      },
      waitForExit(resource) {
        return new Promise<void>((resolveExit) => exits.set(resource.runtimeId, resolveExit));
      },
    },
    exit(resourceId) {
      const count = counts.get(resourceId);
      const runtimeId = count ? `runtime:${resourceId}:${count}` : undefined;
      if (!runtimeId || !exits.get(runtimeId)) throw new Error(`No monitored runtime for ${resourceId}.`);
      exits.get(runtimeId)!();
    },
  };
}

function portBroker(): () => Promise<number> {
  let port = 41_000;
  return async () => port++;
}

function plan(): LocalSupervisorPlan {
  return {
    apiVersion: 'applik8s.localSupervisor/v1alpha1', application: 'demo', target: 'local', profile: 'starter', projectDigest: 'sha256:demo', diagnostics: [],
    bindings: [
      { id: 'credential:database:password', owner: 'database', kind: 'credential', sensitivity: 'sensitive' },
      { id: 'endpoint:database:postgres', owner: 'database', kind: 'endpoint', sensitivity: 'public' },
      { id: 'workflow:database:worker-token', owner: 'database', kind: 'targetOutput', sensitivity: 'sensitive' },
      { id: 'port:web:http', owner: 'web', kind: 'port', sensitivity: 'public' },
      { id: 'endpoint:web:http', owner: 'web', kind: 'endpoint', sensitivity: 'public' },
    ],
    resources: [
      {
        id: 'web', kind: 'process', command: 'bun', args: ['run', 'dev'], cwd: '.', environment: [{ name: 'DATABASE_URL', binding: 'endpoint:database:postgres' }, { name: 'WORKER_TOKEN', binding: 'workflow:database:worker-token' }, { name: 'PORT', binding: 'port:web:http' }], watch: ['src'], reloadGroup: 'web', dependsOn: ['database'], lifecycle: { ownership: 'application', retention: 'ephemeral' }, health: { kind: 'http', portBinding: 'port:web:http', path: '/healthz', timeoutMs: 1_000 }, provenance: { graphNodeId: 'server.web' },
      },
      {
        id: 'database', kind: 'container', image: 'postgres:17-alpine', ports: [{ name: 'postgres', containerPort: 5432, protocol: 'tcp' }], environment: [{ name: 'POSTGRES_PASSWORD', binding: 'credential:database:password' }], volumes: [], readyOutputs: [{ binding: 'workflow:database:worker-token', command: ['token', 'create'], encoding: 'trimmed-stdout' }], dependsOn: [], lifecycle: { ownership: 'application', retention: 'retained' }, health: { kind: 'tcp', portBinding: 'endpoint:database:postgres', timeoutMs: 1_000 }, provenance: { graphNodeId: 'provider.database' },
      },
    ],
  };
}
