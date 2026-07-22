// typecast-file-boundary: CLI fixtures provide narrow fake module/Kubernetes implementations and inspect their recorded dynamic calls.
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import {
  applicationGraphDeploymentSlice,
  applicationHarborProjectDeletionTimeoutMs,
  applicationInstallationReadiness,
  collectApplicationRuntimeCursorSecrets,
  invalidateGeneratedDeploymentMaterialization,
  isTypeKroInstanceNotFound,
  loadGeneratedApplicationLifecycleComposition,
  purgeHarborProjectRepositoriesForDeletion,
  removeHarborProjectImmutableTagRulesForDeletion,
  readGeneratedApplicationGraph,
  readGeneratedResourceGraphDefinition,
  resolveApplicationBuildPackage,
  resolveGeneratedApplicationDeleteTarget,
  resourceGraphDefinitionReadiness,
  runCli,
  stageExplicitApplicationInstance,
  waitForApplicationEndpoint,
} from '../src/cli.js';
import { resolveApplicationInstallationValues } from '../src/application-installation-values.js';

const execFileAsync = promisify(execFile);

describe('applik8s CLI', () => {
  it('runs the application build from the package that owns a nested entrypoint', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-cli-app-package-'));
    try {
      const application = join(dir, 'apps', 'chirp');
      await mkdir(join(application, 'src'), { recursive: true });
      await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'workspace-root', scripts: {} }));
      await writeFile(join(application, 'package.json'), JSON.stringify({ name: '@example/chirp', scripts: { build: 'vite build' } }));
      const entrypoint = join(application, 'src', 'application.ts');
      await writeFile(entrypoint, 'export {}\n');

      await expect(resolveApplicationBuildPackage(entrypoint)).resolves.toEqual({
        directory: application,
        name: '@example/chirp',
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('fails closed when the owning application package has no production build', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-cli-app-build-missing-'));
    try {
      await mkdir(join(dir, 'src'), { recursive: true });
      await writeFile(join(dir, 'package.json'), JSON.stringify({ name: '@example/operator-only', scripts: {} }));
      const entrypoint = join(dir, 'src', 'application.ts');
      await writeFile(entrypoint, 'export {}\n');

      await expect(resolveApplicationBuildPackage(entrypoint)).rejects.toThrow(/has no non-empty build script.*--skip-app-build/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('gives asynchronous Harbor repository purges a bounded production-sized convergence window', () => {
    expect(applicationHarborProjectDeletionTimeoutMs()).toBe(300_000);
    expect(applicationHarborProjectDeletionTimeoutMs(75_000)).toBe(75_000);
  });

  it('removes Harbor immutable-tag guards before an explicitly confirmed repository purge', async () => {
    const calls: Array<{ readonly method: string; readonly path: string; readonly allowed?: readonly number[] }> = [];
    const output: string[] = [];
    const client = {
      async request(request: { readonly method: 'GET' | 'DELETE'; readonly path: string }, allowed?: readonly number[]) {
        calls.push({ ...request, ...(allowed ? { allowed } : {}) });
        if (request.method === 'GET') {
          return { status: 200, body: [{ id: 17 }, { id: '19' }] };
        }
        return { status: 200 };
      },
    };

    await removeHarborProjectImmutableTagRulesForDeletion(client, 'chirp/team', {
      stdout(message) { output.push(message); },
    });

    expect(calls).toEqual([
      { method: 'GET', path: '/projects/chirp%2Fteam/immutabletagrules', allowed: [200, 404] },
      { method: 'DELETE', path: '/projects/chirp%2Fteam/immutabletagrules/17', allowed: [200, 204, 404] },
      { method: 'DELETE', path: '/projects/chirp%2Fteam/immutabletagrules/19', allowed: [200, 204, 404] },
    ]);
    expect(output).toEqual(['Removing 2 immutable-tag rules before purging Harbor project chirp/team']);
  });

  it('fails closed on malformed Harbor immutable-tag lifecycle responses', async () => {
    const client = {
      async request() {
        return { status: 200, body: [{ disabled: false }] };
      },
    };

    await expect(removeHarborProjectImmutableTagRulesForDeletion(client, 'chirp')).rejects.toThrow(
      'did not contain a valid ID',
    );
  });

  it('double-encodes nested Harbor repository names and waits for bounded absence', async () => {
    const calls: Array<{ readonly method: string; readonly path: string; readonly allowed?: readonly number[] }> = [];
    let listings = 0;
    const client = {
      async request(request: { readonly method: 'GET' | 'DELETE'; readonly path: string }, allowed?: readonly number[]) {
        calls.push({ ...request, ...(allowed ? { allowed } : {}) });
        if (request.method === 'GET') {
          listings += 1;
          return listings === 1
            ? { status: 200, body: [{ name: 'chirp/applik8s/web' }] }
            : { status: 200, body: [] };
        }
        return { status: 202 };
      },
    };

    await purgeHarborProjectRepositoriesForDeletion(client, 'chirp', {
      timeoutMs: 1_000,
      pollIntervalMs: 0,
      sleep: async () => undefined,
    });

    expect(calls).toEqual([
      { method: 'GET', path: '/projects/chirp/repositories?page=1&page_size=100', allowed: [200, 404] },
      { method: 'DELETE', path: '/projects/chirp/repositories/applik8s%252Fweb', allowed: [200, 202, 404] },
      { method: 'GET', path: '/projects/chirp/repositories?page=1&page_size=100', allowed: [200, 404] },
    ]);
  });

  it('classifies the authoritative installation status without guessing from child resources', () => {
    expect(applicationInstallationReadiness({ metadata: { name: 'chirp' } })).toEqual({
      state: 'pending',
      summary: 'status has not been projected yet',
    });
    expect(applicationInstallationReadiness({ status: {
      ready: false,
      phase: 'Installing',
      providerStatus: { database: 'Ready', analytics: 'NotConfigured', eventLog: 'Pending', workloads: 'Pending' },
    } })).toEqual({ state: 'pending', summary: 'Installing; pending: eventLog, workloads' });
    expect(applicationInstallationReadiness({ status: {
      ready: false,
      phase: 'Installing',
      state: 'ACTIVE',
      providerStatus: { workflows: 'Pending', workloads: 'Pending' },
      rolloutStatus: 'Reconciling',
      conditions: [{ type: 'Ready', status: 'True', reason: 'Ready' }],
    } })).toEqual({ state: 'pending', summary: 'Installing; pending: rollout, workflows, workloads' });
    expect(applicationInstallationReadiness({ status: {
      ready: true,
      phase: 'Installing',
      providerStatus: { workflows: 'Ready' },
      rolloutStatus: 'Reconciling',
    } })).toEqual({ state: 'pending', summary: 'Installing; pending: rollout' });
    expect(applicationInstallationReadiness({ status: {
      ready: false,
      phase: 'Failed',
      conditions: [{ type: 'Failed', status: 'True', reason: 'MigrationFailed', message: 'schema rejected' }],
    } })).toEqual({ state: 'failed', summary: 'MigrationFailed: schema rejected' });
    expect(applicationInstallationReadiness({ status: {
      ready: true,
      phase: 'Ready',
      url: 'https://chirp.example.test',
      rolloutStatus: 'Current',
    } })).toEqual({ state: 'ready', summary: 'Ready', url: 'https://chirp.example.test' });
    expect(applicationInstallationReadiness({
      metadata: { generation: 3 },
      status: {
        ready: true,
        phase: 'Ready',
        conditions: [{ type: 'Ready', status: 'True', observedGeneration: 2 }],
      },
    })).toEqual({
      state: 'pending',
      summary: 'Ready condition observes generation 2; waiting for generation 3',
    });
    expect(applicationInstallationReadiness({ status: {
      state: 'ACTIVE',
      conditions: [{ type: 'Ready', status: 'True', reason: 'Ready' }],
    } })).toEqual({ state: 'ready', summary: 'Ready' });
    expect(applicationInstallationReadiness({ status: {
      state: 'ACTIVE',
      conditions: [{ type: 'Ready', status: 'Unknown', reason: 'UnderReconciliation', message: 'waiting for children' }],
    } })).toEqual({ state: 'pending', summary: 'UnderReconciliation: waiting for children' });
  });

  it('requires the exact applied ResourceGraphDefinition generation to be accepted', () => {
    expect(resourceGraphDefinitionReadiness({ metadata: { generation: 4 } })).toEqual({
      state: 'pending',
      summary: 'ResourceGraphDefinition status has not been projected yet',
    });
    expect(resourceGraphDefinitionReadiness({
      metadata: { generation: 4 },
      status: { conditions: [
        { type: 'GraphAccepted', status: 'True', observedGeneration: 3 },
        { type: 'Ready', status: 'True', observedGeneration: 3 },
      ] },
    })).toEqual({ state: 'pending', summary: 'waiting for generation 4' });
    expect(resourceGraphDefinitionReadiness({
      metadata: { generation: 4 },
      status: { conditions: [{
        type: 'GraphAccepted', status: 'False', observedGeneration: 4,
        reason: 'InvalidResourceGraph', message: 'container env expression is not a string',
      }] },
    })).toEqual({ state: 'failed', summary: 'InvalidResourceGraph: container env expression is not a string' });
    expect(resourceGraphDefinitionReadiness({
      metadata: { generation: 4 },
      status: { conditions: [
        { type: 'GraphAccepted', status: 'True', observedGeneration: 4 },
        { type: 'Ready', status: 'True', observedGeneration: 4 },
      ] },
    })).toEqual({ state: 'ready', summary: 'generation 4 accepted' });
  });

  it('verifies the public status URL from the deployer network boundary', async () => {
    const requests: string[] = [];
    let attempt = 0;
    await waitForApplicationEndpoint('http://127.0.0.1:30080', { stdout() {} }, {
      timeoutMs: 1_000,
      requestTimeoutMs: 100,
      pollIntervalMs: 1,
      fetch: async (input) => {
        requests.push(String(input));
        attempt += 1;
        return new Response('', { status: attempt === 1 ? 503 : 200 });
      },
    });

    expect(requests).toEqual(['http://127.0.0.1:30080/', 'http://127.0.0.1:30080/']);
    await expect(waitForApplicationEndpoint('file:///tmp/chirp', { stdout() {} })).rejects.toThrow(/must use http or https/);
  });

  it('invalidates stale image evidence as soon as a new composition has compiled', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-cli-image-evidence-'));
    try {
      const bundlePath = join(dir, 'typekro-composition.json');
      await writeFile(bundlePath, '{}\n');
      await writeFile(join(dir, 'application-image-evidence.json'), '{"artifactSetDigest":"old"}\n');
      await writeFile(join(dir, 'image-receipts.json'), '{"images":[]}\n');

      await invalidateGeneratedDeploymentMaterialization(bundlePath);

      await expect(readFile(join(dir, 'application-image-evidence.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(join(dir, 'image-receipts.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readFile(bundlePath, 'utf8')).toBe('{}\n');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('selects the exact generated root RGD used by provider ownership migration', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-cli-rgd-selection-'));
    try {
      const bundlePath = join(dir, 'typekro-composition.json');
      await writeFile(bundlePath, '{}\n');
      await writeFile(join(dir, 'resources.json'), `${JSON.stringify([
        { apiVersion: 'kro.run/v1alpha1', kind: 'ResourceGraphDefinition', metadata: { name: 'prerequisite' } },
        { apiVersion: 'kro.run/v1alpha1', kind: 'ResourceGraphDefinition', metadata: { name: 'chirp' }, spec: { resources: [] } },
      ])}\n`);

      await expect(readGeneratedResourceGraphDefinition(bundlePath, 'chirp')).resolves.toMatchObject({ metadata: { name: 'chirp' } });
      await expect(readGeneratedResourceGraphDefinition(bundlePath, 'missing')).rejects.toThrow(/do not contain ResourceGraphDefinition\/missing/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('keeps TypeKro package subpaths external to the Node build runner', async () => {
    const testDir = dirname(fileURLToPath(import.meta.url));
    const runner = await readFile(join(testDir, '..', 'src', 'node-build-runner.mjs'), 'utf8');

    expect(runner).toContain("'typekro/*'");
    expect(runner).toContain("join(workspaceRoot, 'packages/compiler/src/index.ts')");
  });

  it('ships a Node deletion runner that bundles TypeScript entrypoints and preserves TypeKro ownership', async () => {
    const testDir = dirname(fileURLToPath(import.meta.url));
    const runner = await readFile(join(testDir, '..', 'src', 'node-delete-runner.mjs'), 'utf8');

    expect(runner).toContain("bundle: true");
    expect(runner).toContain("platform: 'node'");
    expect(runner).toContain("'typekro/*'");
    expect(runner).toContain('__applik8sCreateRequire');
    expect(runner).toContain("'delete'");
    expect(runner).toContain("APPLIK8S_DISABLE_NODE_DELETE_HANDOFF: '1'");
    expect(runner).not.toContain('kubectl');
  });

  it('explicitly deletes owned direct Namespace preparations at TypeKro cluster scope', async () => {
    const testDir = dirname(fileURLToPath(import.meta.url));
    const cliSource = await readFile(join(testDir, '..', 'src', 'cli.ts'), 'utf8');

    expect(cliSource).toContain("factory.deleteInstance(receipt.instanceName, { scopes: ['cluster'] })");
    expect(cliSource).toContain('const absent = await waitForAbsence');
    expect(cliSource).toContain('is already absent; continuing idempotent cleanup');
    expect(cliSource).toContain('Managed ObjectBucketClaim $' + '{receipt.namespace}/$' + '{receipt.name} is already absent');
    expect(cliSource).toContain('Managed Hatchet admin Secret $' + '{receipt.namespace}/$' + '{receipt.name} is already absent');
    expect(cliSource).toContain('Application instance $' + '{target.instanceName} is already absent');
    expect(cliSource).toContain("input.artifact?.class === 'operator-host'");
    expect(cliSource).toContain('buildTimeoutMs: 15 * 60_000');
    expect(cliSource).toContain('timeout: input.buildTimeoutMs');
    expect(cliSource).toContain("'app.kubernetes.io/managed-by': 'typekro'");
    expect(cliSource).toContain('timeout: 5 * 60_000');
    expect(cliSource).toContain("ensureDirectNamespace(io, context, namespace, 'identity-infrastructure')");
    expect(cliSource).toContain('identityStackSpec, { targetScopes: [] }');
  });

  it('suppresses only TypeKro\'s explicit absent-instance cleanup signal', () => {
    expect(isTypeKroInstanceNotFound({ code: 'INSTANCE_NOT_FOUND' })).toBe(true);
    expect(isTypeKroInstanceNotFound(new Error('Instance not found'))).toBe(false);
    expect(isTypeKroInstanceNotFound({ code: 'HTTP_404' })).toBe(false);
  });

  it('rejects KRO-owned provider resources before comparing them for direct adoption', async () => {
    const testDir = dirname(fileURLToPath(import.meta.url));
    const cliSource = await readFile(join(testDir, '..', 'src', 'cli.ts'), 'utf8');
    const valkeyStart = cliSource.indexOf('async ensureValkeyCluster');
    const valkeyEnd = cliSource.indexOf('async deleteValkeyCluster', valkeyStart);
    const valkeyBody = cliSource.slice(valkeyStart, valkeyEnd);
    const postgresStart = cliSource.indexOf('async ensurePostgresCluster');
    const postgresEnd = cliSource.indexOf('async deletePostgresCluster', postgresStart);
    const postgresBody = cliSource.slice(postgresStart, postgresEnd);

    expect(valkeyBody.indexOf('if (kroOwned)')).toBeLessThan(valkeyBody.indexOf('assertValkeyClusterContract'));
    expect(postgresBody.indexOf('if (kroOwned)')).toBeLessThan(postgresBody.indexOf('assertJsonSubset'));
  });

  it('prints help for the thin command surface', async () => {
    const output: string[] = [];

    const code = await runCli(['--help'], { cwd: process.cwd(), stdout: (message) => output.push(message), stderr: (message) => output.push(message) });

    expect(code).toBe(0);
    expect(output.join('\n')).toContain('build [options] <entrypoint>');
    expect(output.join('\n')).toContain('deploy [options] <entrypoint>');
    expect(output.join('\n')).toContain('delete [options] <entrypoint>');
    expect(output.join('\n')).toContain('replay');
  });

  it('prints nested replay help through Commander', async () => {
    const output: string[] = [];

    const code = await runCli(['replay', 'inspect', '--help'], { cwd: process.cwd(), stdout: (message) => output.push(message), stderr: (message) => output.push(message) });

    expect(code).toBe(0);
    expect(output.join('\n')).toContain('Usage: applik8s replay inspect [options] <artifact>');
    expect(output.join('\n')).toContain('--bundle-dir <dir>');
  });

  it('makes destructive provider-data migration an explicit deploy option', async () => {
    const output: string[] = [];

    const code = await runCli(['deploy', '--help'], { cwd: process.cwd(), stdout: (message) => output.push(message), stderr: (message) => output.push(message) });

    expect(code).toBe(0);
    expect(output.join('\n')).toContain('--migrate-kro-owned-provider-data');
    expect(output.join('\n')).toContain('--confirm-legacy-typekro-node-fetch-manager');
  });

  it('explains diagnostic reasons through the shared taxonomy', async () => {
    const output: string[] = [];

    const code = await runCli(['explain', 'UndeclaredPermission'], { cwd: process.cwd(), stdout: (message) => output.push(message), stderr: (message) => output.push(message) });

    expect(code).toBe(0);
    expect(output.join('\n')).toContain('UndeclaredPermission (rbac)');
    expect(output.join('\n')).toContain('Effects: none');
  }, 15_000);

  it('fails closed for unknown diagnostic reasons', async () => {
    const output: string[] = [];

    const code = await runCli(['explain', 'NotAReason'], { cwd: process.cwd(), stdout: (message) => output.push(message), stderr: (message) => output.push(message) });

    expect(code).toBe(1);
    expect(output.join('\n')).toContain('No diagnostic advice is registered');
  });

  it('stages the one authored Application instance matching the root RGD', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-cli-instance-'));
    try {
      const typeKroDir = join(dir, '.applik8s', 'deploy', 'typekro');
      await mkdir(join(typeKroDir, 'instances'), { recursive: true });
      await mkdir(join(dir, 'kubernetes'), { recursive: true });
      await mkdir(join(dir, 'src'), { recursive: true });
      await writeFile(join(dir, 'package.json'), '{}\n');
      await writeFile(join(dir, 'src', 'application.ts'), 'export {};\n');
      await writeFile(join(typeKroDir, 'application-graph.json'), JSON.stringify({ metadata: { name: 'chirp' } }));
      await writeFile(join(typeKroDir, 'resources.json'), JSON.stringify([{
        apiVersion: 'kro.run/v1alpha1',
        kind: 'ResourceGraphDefinition',
        metadata: { name: 'chirp' },
        spec: { schema: { group: 'applications.chirp.dev', apiVersion: 'v1alpha1', kind: 'ChirpInstallation' } },
      }]));
      await writeFile(join(typeKroDir, 'typekro-composition.json'), JSON.stringify({
        spec: { applicationGraph: { path: join(typeKroDir, 'application-graph.json') } },
      }));
      const analyticsCondition = ['$', '{schema.spec.features.analytics}'].join('');
      const mediaCondition = ['$', '{schema.spec.features.media}'].join('');
      await writeFile(join(typeKroDir, 'instances', 'analytics-prerequisite.yaml'), JSON.stringify({
        apiVersion: 'kro.run/v1alpha1',
        kind: 'AnalyticsBootstrap',
        metadata: {
          name: 'analytics',
          namespace: 'typekro-singletons',
          annotations: {
            'typekro.io/singleton-spec-fingerprint': 'fnv64:0123456789abcdef',
            'applik8s.dev/include-when': JSON.stringify([analyticsCondition]),
          },
        },
        spec: {},
      }));
      await writeFile(join(typeKroDir, 'instances', 'media-prerequisite.yaml'), JSON.stringify({
        apiVersion: 'kro.run/v1alpha1',
        kind: 'MediaBootstrap',
        metadata: {
          name: 'media',
          namespace: 'typekro-singletons',
          annotations: { 'applik8s.dev/include-when': JSON.stringify([mediaCondition]) },
        },
        spec: {},
      }));
      await writeFile(join(dir, 'kubernetes', 'chirp.yaml'), `
apiVersion: applications.chirp.dev/v1alpha1
kind: ChirpInstallation
metadata:
  name: local
  namespace: chirp-control
spec:
  hostname: chirp.localhost
  features:
    analytics: true
    media: false
`);

      const staged = await stageExplicitApplicationInstance(
        join(dir, 'src', 'application.ts'),
        join(typeKroDir, 'typekro-composition.json'),
      );

      expect(staged).toMatchObject({ name: 'local', namespace: 'chirp-control', resourceGraphDefinitionName: 'chirp' });
      expect(await readFile(staged.path, 'utf8')).toContain('kind: ChirpInstallation');
      const prerequisiteFiles = await readdir(join(typeKroDir, 'instances'));
      expect(prerequisiteFiles).toContain('analytics-prerequisite.yaml');
      expect(prerequisiteFiles).not.toContain('media-prerequisite.yaml');
      const analyticsPrerequisite = await readFile(join(typeKroDir, 'instances', 'analytics-prerequisite.yaml'), 'utf8');
      expect(analyticsPrerequisite).toContain('typekro.io/singleton-spec-fingerprint');
      expect(analyticsPrerequisite).not.toContain('applik8s.dev/include-when');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('resolves compiler artifact paths from a nested project root', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-cli-artifact-path-'));
    try {
      const typeKroDir = join(dir, '.applik8s', 'deploy', 'typekro');
      const graphPath = join('.applik8s', 'deploy', 'typekro', 'application-graph.json');
      await mkdir(typeKroDir, { recursive: true });
      await writeFile(join(dir, graphPath), JSON.stringify({
        apiVersion: 'applik8s.appGraph/v1alpha1',
        kind: 'ApplicationGraph',
        metadata: { name: 'nested-project' },
        nodes: [],
        edges: [],
      }));
      const bundlePath = join(typeKroDir, 'typekro-composition.json');
      await writeFile(bundlePath, JSON.stringify({ spec: { applicationGraph: { path: graphPath } } }));

      const graph = await readGeneratedApplicationGraph(bundlePath, dir);

      expect(graph.metadata.name).toBe('nested-project');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('materializes only the graph contracts consumed by a deployment phase', () => {
    const graph = {
      apiVersion: 'applik8s.appGraph/v1alpha1',
      kind: 'ApplicationGraph',
      metadata: { name: 'chirp' },
      nodes: [
        {
          id: 'provider.registry',
          kind: 'provider',
          name: 'registry',
          interface: 'ContainerRegistry',
          provider: {
            kind: 'application-provider-selection',
            selector: 'schema.spec.profile',
            cases: {
              external: {
                kind: 'oci-container-registry',
                endpoint: { kind: 'origin', origin: '${schema.spec.providers.registry.origin}' },
              },
            },
            default: {
              kind: 'harbor-container-registry',
              endpoint: { kind: 'origin', origin: 'http://127.0.0.1:32080' },
              project: '${schema.spec.name}',
            },
          },
        },
        {
          id: 'provider.generation',
          kind: 'provider',
          name: 'generation',
          interface: 'StructuredGeneration',
          provider: { credentialsSecretName: '${schema.spec.providers.generation.credentialsSecretName}' },
        },
      ],
      edges: [{ from: 'provider.registry', to: 'provider.generation', kind: 'dependsOn' }],
      providerBindings: [{ interface: 'StructuredGeneration', provider: '${schema.spec.providers.generation.name}' }],
      providerRequirements: [{ interface: 'StructuredGeneration', requiredBy: ['processor.bot'] }],
      compatibility: { stablePublicApis: [], documentedInternalContracts: [], experimentalSurfaces: [], postV3Surfaces: [], labels: [] },
    } as unknown as Parameters<typeof applicationGraphDeploymentSlice>[0];

    const slice = applicationGraphDeploymentSlice(
      graph,
      (node) => node.kind === 'provider' && node.interface === 'ContainerRegistry',
    );
    const resolved = resolveApplicationInstallationValues(slice, { profile: 'starter', name: 'community' });

    expect(resolved.nodes).toHaveLength(1);
    expect(resolved.nodes[0]).toMatchObject({
      id: 'provider.registry',
      provider: { kind: 'harbor-container-registry', project: 'community' },
    });
    expect(resolved.edges).toEqual([]);
    expect(resolved.providerBindings).toEqual([]);
    expect(resolved.providerRequirements).toEqual([]);
    expect(resolved.metadata).toEqual({ name: 'chirp' });
  });

  it('discovers and deduplicates cursor Secrets for the host and every generated gateway', () => {
    const graph = {
      apiVersion: 'applik8s.appGraph/v1alpha1',
      kind: 'ApplicationGraph',
      metadata: { name: 'chirp' },
      nodes: [
        {
          id: 'gateway.account', kind: 'gateway', name: 'account', stability: 'stable',
          materialization: 'generatedDeployment',
          deployment: { namespace: 'chirp', image: 'gateway', replicas: 1, port: 8080 },
          cursorSecret: { apiVersion: 'v1', kind: 'Secret', name: 'chirp-gateway-cursor', key: 'key' },
        },
        {
          id: 'gateway.social', kind: 'gateway', name: 'social', stability: 'stable',
          materialization: 'generatedDeployment',
          deployment: { namespace: 'chirp', image: 'gateway', replicas: 1, port: 8080 },
          cursorSecret: { apiVersion: 'v1', kind: 'Secret', name: 'chirp-gateway-cursor', key: 'key' },
        },
        {
          id: 'gateway.tests', kind: 'gateway', name: 'tests', stability: 'stable',
          materialization: 'runtimeOnly',
        },
      ],
      edges: [],
      providers: [],
      providerRequirements: [],
      compatibility: { stablePublicApis: [], documentedInternalContracts: [], experimentalSurfaces: [], postV3Surfaces: [], labels: [] },
    } as unknown as Parameters<typeof collectApplicationRuntimeCursorSecrets>[0];

    expect(collectApplicationRuntimeCursorSecrets(graph, {
      metadata: { name: 'chirp-web' },
      spec: { namespace: 'chirp', cursorSecret: { name: 'chirp-web-cursor', key: 'key' } },
    })).toEqual([
      { namespace: 'chirp', name: 'chirp-gateway-cursor', key: 'key', consumerName: 'account' },
      { namespace: 'chirp', name: 'chirp-web-cursor', key: 'key', consumerName: 'chirp-web' },
    ]);
  });

  it('fails closed when generated gateways disagree about a shared cursor Secret key', () => {
    const graph = {
      nodes: [
        {
          id: 'gateway.one', kind: 'gateway', name: 'one', materialization: 'generatedDeployment',
          deployment: { namespace: 'app', image: 'gateway', replicas: 1, port: 8080 },
          cursorSecret: { name: 'cursor', key: 'first' },
        },
        {
          id: 'gateway.two', kind: 'gateway', name: 'two', materialization: 'generatedDeployment',
          deployment: { namespace: 'app', image: 'gateway', replicas: 1, port: 8080 },
          cursorSecret: { name: 'cursor', key: 'second' },
        },
      ],
    } as unknown as Parameters<typeof collectApplicationRuntimeCursorSecrets>[0];

    expect(() => collectApplicationRuntimeCursorSecrets(graph)).toThrow(/conflicting keys first and second/);
  });

  it('deletes the generated instance through the selected TypeKro factory', async () => {
    const output: string[] = [];
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-cli-delete-'));
    const callKey = `__applik8sDeleteCalls${Date.now()}`;
    try {
      const entrypoint = join(dir, 'application.mjs');
      const typeKroDir = join(dir, 'dist', 'typekro');
      await mkdir(join(typeKroDir, 'instances'), { recursive: true });
      await writeFile(join(typeKroDir, 'typekro-composition.json'), '{}\n');
      await writeFile(join(typeKroDir, 'instances', 'clickhouse-repository.yaml'), `
apiVersion: kro.run/v1alpha1
kind: ClickHouseHelmRepository
metadata:
  name: clickhouse-helm-repository
  namespace: typekro-singletons
spec: {}
`);
      await writeFile(join(typeKroDir, 'instances', 'chirp.yaml'), `
apiVersion: applications.chirp.dev/v1alpha1
kind: ChirpInstallation
metadata:
  name: local
  namespace: chirp-control
  labels:
    typekro.io/factory: chirp
    typekro.io/mode: kro
spec: {}
`);
      await writeFile(entrypoint, `
export const app = {
  factory(mode, options) {
    return {
      async deleteInstance(name) {
        globalThis[${JSON.stringify(callKey)}] = [{ mode, namespace: options.namespace, name }];
      },
    };
  },
};
`);

      const previousHandoff = process.env.APPLIK8S_DISABLE_NODE_DELETE_HANDOFF;
      process.env.APPLIK8S_DISABLE_NODE_DELETE_HANDOFF = '1';
      let code: number;
      try {
        code = await runCli([
          'delete', entrypoint,
          '--context', 'orbstack',
          '--out-dir', 'dist',
        ], { cwd: dir, stdout: (message) => output.push(message), stderr: (message) => output.push(message) });
      } finally {
        if (previousHandoff === undefined) delete process.env.APPLIK8S_DISABLE_NODE_DELETE_HANDOFF;
        else process.env.APPLIK8S_DISABLE_NODE_DELETE_HANDOFF = previousHandoff;
      }

      expect(code).toBe(0);
      expect(Reflect.get(globalThis, callKey)).toEqual([{ mode: 'kro', namespace: 'chirp-control', name: 'local' }]);
      expect(output.join('\n')).toContain('through TypeKro');
      expect(output.join('\n')).toContain('finalization completed');
    } finally {
      Reflect.deleteProperty(globalThis, callKey);
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('derives an unlabeled explicit root instance from the generated ApplicationGraph instead of singleton prerequisites', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-cli-delete-target-'));
    try {
      const typeKroDir = join(dir, 'typekro');
      await mkdir(join(typeKroDir, 'instances'), { recursive: true });
      const bundlePath = join(typeKroDir, 'typekro-composition.json');
      await writeFile(bundlePath, '{}\n');
      await writeFile(join(typeKroDir, 'application-graph.json'), JSON.stringify({ metadata: { name: 'chirp' } }));
      await writeFile(join(typeKroDir, 'resources.json'), JSON.stringify([{
        apiVersion: 'kro.run/v1alpha1', kind: 'ResourceGraphDefinition', metadata: { name: 'chirp' },
        spec: {
          schema: { group: 'applications.chirp.dev', apiVersion: 'v1alpha1', kind: 'ChirpInstallation' },
          resources: [
            { id: 'ownedConfig', template: { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'owned', namespace: '${schema.spec.name}' } } },
            { id: 'conditionalWorker', includeWhen: ['${schema.spec.enabled}'], template: { apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: 'worker', namespace: '${schema.spec.name}' } } },
            { id: 'externalSecret', externalRef: { apiVersion: 'v1', kind: 'Secret', metadata: { name: 'credentials', namespace: '${schema.spec.name}' } } },
          ],
        },
      }]));
      await writeFile(join(typeKroDir, 'instances', 'singleton.yaml'), `
apiVersion: kro.run/v1alpha1
kind: ClickHouseOperatorBootstrap
metadata: { name: clickhouse, namespace: typekro-singletons }
spec: {}
`);
      await writeFile(join(typeKroDir, 'instances', 'chirp.yaml'), `
apiVersion: applications.chirp.dev/v1alpha1
kind: ChirpInstallation
metadata: { name: community, namespace: chirp-control }
spec: {}
`);

      const target = await resolveGeneratedApplicationDeleteTarget(bundlePath, { context: 'orbstack' });
      expect(target).toEqual({
        apiVersion: 'applications.chirp.dev/v1alpha1',
        kind: 'ChirpInstallation',
        instanceName: 'community',
        controlPlaneNamespace: 'chirp-control',
        applicationInstance: true,
        resourceGraphDefinitionName: 'chirp',
      });
      const lifecycle = await loadGeneratedApplicationLifecycleComposition(
        bundlePath,
        target,
        join(dir, 'source-that-must-not-be-loaded.ts'),
        'app',
        { name: 'community', enabled: false },
      );
      const factory = lifecycle.factory('kro', { namespace: 'chirp-control' });
      expect(Object.keys(Reflect.get(factory, 'resources') as Record<string, unknown>).sort()).toEqual([
        'externalSecret', 'ownedConfig',
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('builds the documented ImageJob example through the CLI', async () => {
    const output: string[] = [];
    const outDir = join(process.cwd(), 'dist', 'test-cli-build');
    await rm(outDir, { recursive: true, force: true });

    const code = await runCli(['build', 'examples/imagejob.ts', '--out-dir', outDir], { cwd: process.cwd(), stdout: (message) => output.push(message), stderr: (message) => output.push(message) });

    expect(code).toBe(0);
    expect(output.join('\n')).toContain('Built image-pipeline');
    const manifest = JSON.parse(await readFile(join(outDir, 'operator-manifest.json'), 'utf8'));
    expect(manifest).toMatchObject({ metadata: { name: 'image-pipeline' } });

    await rm(outDir, { recursive: true, force: true });
  }, 120_000);

  it('builds the documented ImageJob through the isolated Node runner', async () => {
    const outDir = join(process.cwd(), 'dist', 'test-node-runner-build');
    await rm(outDir, { recursive: true, force: true });
    const runner = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'node-build-runner.mjs');
    const request = JSON.stringify({
      cwd: process.cwd(),
      entrypoint: 'examples/imagejob.ts',
      options: { outDir },
    });

    try {
      const { stdout } = await execFileAsync(process.execPath, [runner, request], { cwd: process.cwd() });
      expect(stdout).toContain('Built image-pipeline');
      await expect(readFile(join(outDir, 'operator-manifest.json'), 'utf8')).resolves.toContain('image-pipeline');
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  }, 120_000);

  it('keeps monorepo source resolution when the isolated Node runner starts in an app subdirectory', async () => {
    const outDir = join(process.cwd(), 'dist', 'test-node-runner-subdirectory-build');
    await rm(outDir, { recursive: true, force: true });
    const runner = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'node-build-runner.mjs');
    const request = JSON.stringify({
      cwd: join(process.cwd(), 'examples'),
      entrypoint: 'imagejob.ts',
      options: { outDir },
    });

    try {
      const { stdout } = await execFileAsync(process.execPath, [runner, request], { cwd: join(process.cwd(), 'examples') });
      expect(stdout).toContain('Built image-pipeline');
      const metafile = await readFile(join(outDir, 'bundle', 'handler.esbuild-meta.json'), 'utf8');
      expect(metafile).toContain('packages/sdk/src/schema-runtime.ts');
      expect(metafile).not.toContain('examples/packages/');
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  }, 120_000);

  it('builds an exported TypeKro composition through the CLI', async () => {
    const output: string[] = [];
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-cli-typekro-'));
    try {
      const entrypoint = join(dir, 'media-stack.mjs');
      const outDir = join(dir, 'dist');
      await writeFile(entrypoint, `
        import { type } from 'arktype';
        import { sdk, typeKro } from '@applik8s/applik8s';

        const imageSpecSchema = {
          kind: 'jsonSchema',
          ref: { kind: 'jsonSchema', exportName: 'ImageSpec' },
          schema: {
            type: 'object',
            required: ['sourceUrl', 'formats'],
            additionalProperties: false,
            properties: {
              sourceUrl: { type: 'string' },
              formats: { type: 'array', items: { type: 'string' } }
            }
          }
        };
        const imageStatusSchema = {
          kind: 'jsonSchema',
          ref: { kind: 'jsonSchema', exportName: 'ImageStatus' },
          schema: { type: 'object', properties: { phase: { type: 'string' } } }
        };

        export const ImageJob = sdk.crd({
          apiVersion: 'media.applik8s.dev/v1alpha1',
          kind: 'ImageJob',
          spec: imageSpecSchema,
          status: imageStatusSchema,
        });

        export const imagePipeline = sdk.operator({
          name: 'cli-image-pipeline',
          deployment: { namespace: 'media-system' },
          resources: { ImageJob },
          handlers: [],
        });

        export const mediaStack = typeKro.kubernetesComposition({
          name: 'cli-media-stack',
          apiVersion: 'media.applik8s.dev/v1alpha1',
          kind: 'CliMediaStack',
          spec: type({ namespace: 'string' }),
          status: type({ ready: 'boolean' }),
        }, (spec) => {
          const pipeline = imagePipeline({ namespace: spec.namespace, replicas: 1 });
          const image = pipeline.imageJob({
            name: 'hero',
            namespace: spec.namespace,
            spec: { sourceUrl: 's3://images/hero.png', formats: ['webp'] },
          });
          return { ready: image.status.phase === 'Complete' };
        });
      `);

      const code = await runCli(['build', entrypoint, '--typekro', '--composition-name', 'mediaStack', '--out-dir', outDir], { cwd: process.cwd(), stdout: (message) => output.push(message), stderr: (message) => output.push(message) });

      expect(code).toBe(0);
      expect(output.join('\n')).toContain('Built TypeKro composition mediaStack');
      expect(output.join('\n')).toContain('Apply:');
      expect(output.join('\n')).toContain('Operators: 1');

      const compositionManifest = JSON.parse(await readFile(join(outDir, 'typekro', 'typekro-composition.json'), 'utf8'));
      expect(compositionManifest).toMatchObject({ kind: 'TypeKroCompositionBundle', metadata: { name: 'mediaStack' } });
      expect(compositionManifest.spec.operators[0]).toMatchObject({ name: 'cli-image-pipeline' });

      const resourcesYaml = await readFile(join(outDir, 'typekro', 'resources.yaml'), 'utf8');
      expect(resourcesYaml).toContain('kind: Deployment');
      expect(resourcesYaml).toContain('kind: ImageJob');
      const staleResourcePath = join(outDir, 'typekro', 'resources', '99-stale-resource.yaml');
      await writeFile(staleResourcePath, 'kind: Stale\n');
      const rebuildCode = await runCli(['build', entrypoint, '--typekro', '--composition-name', 'mediaStack', '--out-dir', outDir], { cwd: process.cwd(), stdout: (message) => output.push(message), stderr: (message) => output.push(message) });
      expect(rebuildCode).toBe(0);
      await expect(readdir(join(outDir, 'typekro', 'resources'))).resolves.not.toContain('99-stale-resource.yaml');
      const applyScript = await readFile(join(outDir, 'typekro', 'apply.sh'), 'utf8');
      expect(applyScript).toContain('Applying TypeKro prerequisite CustomResourceDefinitions');
      expect(applyScript).toContain('Applying TypeKro ResourceGraphDefinitions');
      expect(applyScript).toContain('apply_with_retry');
      expect(applyScript).toContain('APPLIK8S_KUBE_CONTEXT');
      expect(applyScript).toContain('kubectl_run');
      const operatorManifest = JSON.parse(await readFile(join(outDir, 'operators', 'cli-image-pipeline', 'operator-manifest.json'), 'utf8'));
      expect(operatorManifest.metadata.name).toBe('cli-image-pipeline');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
