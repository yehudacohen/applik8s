// typecast-file-boundary: CLI fixtures provide narrow fake module/Kubernetes implementations and inspect their recorded dynamic calls.
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { app, applicationGraphFor } from '@applik8s/applik8s';
import {
  applicationGraphDeploymentSlice,
  applicationInstallationReadiness,
  readGeneratedApplicationGraph,
  resolveApplicationBuildPackage,
  resolveApplicationProjectRoot,
  resolveGeneratedApplicationDeleteTarget,
  resourceGraphDefinitionReadiness,
  runCli,
  stageExplicitApplicationInstance,
  waitForApplicationEndpoint,
} from '@applik8s/cli';
import { compileApplicationOperationCatalog } from '@applik8s/compiler';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { resolveApplicationInstallationValues } from '../../cli/src/application-installation-values.js';

const execFileAsync = promisify(execFile);

describe('applik8s CLI', () => {
  it('derives lifecycle state identity from the owning application package rather than invocation cwd', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-cli-project-root-'));
    try {
      const application = join(dir, 'apps', 'chirp');
      await mkdir(join(application, 'src'), { recursive: true });
      await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'workspace-root' }));
      await writeFile(join(application, 'package.json'), JSON.stringify({ name: '@example/chirp' }));
      const entrypoint = join(application, 'src', 'application.ts');
      await writeFile(entrypoint, 'export {}\n');

      await expect(resolveApplicationProjectRoot(entrypoint)).resolves.toBe(application);
      await expect(
        resolveApplicationProjectRoot(join(dir, 'apps', 'operator.ts')),
      ).resolves.toBe(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('uses the entrypoint directory as lifecycle state identity for package-less operators', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-cli-package-less-root-'));
    try {
      const application = join(dir, 'operator');
      await mkdir(application, { recursive: true });
      const entrypoint = join(application, 'application.ts');
      await writeFile(entrypoint, 'export {}\n');

      await expect(resolveApplicationProjectRoot(entrypoint)).resolves.toBe(application);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

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

  it('uses the shared TypeScript loader instead of a second bundled compiler runtime', async () => {
    const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    const runner = await readFile(join(workspaceRoot, 'packages', 'cli', 'src', 'node-build-runner.mjs'), 'utf8');
    const loader = await readFile(join(workspaceRoot, 'packages', 'cli', 'src', 'node-typescript-loader.mjs'), 'utf8');

    expect(runner).toContain("import './node-register-typescript.mjs'");
    expect(runner).toContain("join(workspaceRoot, 'packages/compiler/src/index.ts')");
    expect(runner).toContain('APPLIK8S_WORKSPACE_ROOT');
    expect(runner).not.toContain('.applik8s-tmp');
    expect(runner).not.toContain('workspaceSourcePlugin');
    expect(runner).not.toContain('await build({');
    expect(loader).toContain('resolveWorkspacePackageSource');
    expect(loader).toContain('resolveExportTarget(manifest.exports, subpath)');
  });

  it('uses one TypeScript-aware Node deployment host for deploy, status, and destroy', async () => {
    const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    const runner = await readFile(join(workspaceRoot, 'packages', 'cli', 'src', 'node-deploy-runner.mjs'), 'utf8');

    expect(runner).toContain("request.command === 'delete'");
    expect(runner).toContain("request.command === 'status'");
    expect(runner).toContain("'node-register-typescript.mjs'");
    expect(runner).toContain("? statusArgs");
    expect(runner).toContain("'delete'");
    expect(runner).toContain("'status'");
    expect(runner).toContain("APPLIK8S_DISABLE_NODE_DELETE_HANDOFF: '1'");
    expect(runner).toContain("APPLIK8S_DISABLE_NODE_DEPLOY_HANDOFF: '1'");
    expect(runner).toContain("APPLIK8S_DISABLE_NODE_STATUS_HANDOFF: '1'");
    expect(runner).toContain("options.allowBreakingChanges ? ['--allow-breaking-changes']");
    expect(runner).toContain("options.development ? ['--development']");
    expect(runner).not.toContain('kubectl');
  });

  it('prints help for the thin command surface', async () => {
    const output: string[] = [];

    const code = await runCli(['--help'], { cwd: process.cwd(), stdout: (message) => output.push(message), stderr: (message) => output.push(message) });

    expect(code).toBe(0);
    expect(output.join('\n')).toContain('build [options] <entrypoint>');
    expect(output.join('\n')).toContain('plan [options] [entrypoint]');
    expect(output.join('\n')).toContain('deploy [options] [entrypoint]');
    expect(output.join('\n')).toContain('status [options] [entrypoint]');
    expect(output.join('\n')).toContain('destroy [options] [entrypoint]');
    expect(output.join('\n')).toContain('delete [options] [entrypoint]');
    expect(output.join('\n')).toContain('replay');
  });

  it('prints nested replay help through Commander', async () => {
    const output: string[] = [];

    const code = await runCli(['replay', 'inspect', '--help'], { cwd: process.cwd(), stdout: (message) => output.push(message), stderr: (message) => output.push(message) });

    expect(code).toBe(0);
    expect(output.join('\n')).toContain('Usage: applik8s replay inspect [options] <artifact>');
    expect(output.join('\n')).toContain('--bundle-dir <dir>');
  });

  it('keeps deploy focused on graph-backed strategy and installation selection', async () => {
    const output: string[] = [];

    const code = await runCli(['deploy', '--help'], { cwd: process.cwd(), stdout: (message) => output.push(message), stderr: (message) => output.push(message) });

    expect(code).toBe(0);
    expect(output.join('\n')).toContain('--strategy <strategy>');
    expect(output.join('\n')).toContain('--allow-breaking-changes');
    expect(output.join('\n')).toContain('--development');
    expect(output.join('\n')).toContain('allowlisted local source mount');
    expect(output.join('\n')).toContain('for this deployment only');
    expect(output.join('\n')).not.toContain('migrate-kro-owned');
    expect(output.join('\n')).not.toContain('legacy');
  });

  it('fails closed when delete has no scoped deployment graph', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-cli-delete-without-graph-'));
    const output: string[] = [];
    const previousHandoff = process.env.APPLIK8S_DISABLE_NODE_DELETE_HANDOFF;
    process.env.APPLIK8S_DISABLE_NODE_DELETE_HANDOFF = '1';
    try {
      const code = await runCli(
        ['delete', 'src/application.ts', '--context', 'orbstack'],
        {
          cwd: dir,
          stdout: (message) => output.push(message),
          stderr: (message) => output.push(message),
        },
      );
      expect(code).toBe(1);
      expect(output.join('\n')).toContain('No deployment graph exists');
      expect(output.join('\n')).toContain('refuses to guess at ownership');
    } finally {
      if (previousHandoff === undefined) delete process.env.APPLIK8S_DISABLE_NODE_DELETE_HANDOFF;
      else process.env.APPLIK8S_DISABLE_NODE_DELETE_HANDOFF = previousHandoff;
      await rm(dir, { recursive: true, force: true });
    }
  }, 15_000);

  it('fails closed before compilation for an unknown deployment strategy', async () => {
    const output: string[] = [];

    const code = await runCli(
      ['deploy', 'src/application.ts', '--context', 'orbstack', '--strategy', 'other'],
      {
        cwd: process.cwd(),
        stdout: (message) => output.push(message),
        stderr: (message) => output.push(message),
      },
    );

    expect(code).toBe(1);
    expect(output.join('\n')).toContain('--strategy must be "direct" or "kro"');
  });

  it('resolves the lifecycle entrypoint from package configuration without using an ambient Kubernetes context', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-cli-project-config-'));
    const output: string[] = [];
    const previousContext = process.env.APPLIK8S_CONTEXT;
    try {
      await writeFile(join(dir, 'package.json'), JSON.stringify({
        applik8s: {
          entrypoint: 'src/application.ts',
          compositionName: 'application',
          instance: 'kubernetes/application.yaml',
        },
      }));
      process.env.APPLIK8S_CONTEXT = 'orbstack';
      const code = await runCli(
        ['deploy', '--strategy', 'other'],
        {
          cwd: dir,
          stdout: (message) => output.push(message),
          stderr: (message) => output.push(message),
        },
      );
      expect(code).toBe(1);
      expect(output.join('\n')).toContain(
        '--strategy must be "direct" or "kro"',
      );
      expect(output.join('\n')).not.toContain('No application entrypoint');
    } finally {
      if (previousContext === undefined) delete process.env.APPLIK8S_CONTEXT;
      else process.env.APPLIK8S_CONTEXT = previousContext;
      await rm(dir, { recursive: true, force: true });
    }
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
    expect(output.join('\n')).toContain('No application entrypoint');
  });

  it('explains an operation from the same normalized graph and catalog used by build', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'applik8s-cli-explain-operation-'));
    try {
      const sourceRows = pgTable('source_rows', {
        id: text('id').primaryKey(),
        value: text('value').notNull(),
      });
      const application = app('explain-source');
      const database = application.database.postgres('application', {
        schema: { sourceRows },
      });
      const Source = application.model(sourceRows, {
        name: 'Source',
        database,
      });
      void Source;
      const graph = applicationGraphFor(application.composition);
      if (!graph) throw new Error('Expected an application graph.');
      const catalog = compileApplicationOperationCatalog(graph);
      const outputDirectory = join(dir, '.applik8s', 'deploy', 'typekro');
      await mkdir(outputDirectory, { recursive: true });
      await writeFile(
        join(outputDirectory, 'application-graph.json'),
        JSON.stringify(graph),
      );
      await writeFile(
        join(outputDirectory, 'operation-catalog.json'),
        JSON.stringify(catalog),
      );
      await writeFile(
        join(outputDirectory, 'typekro-composition.json'),
        JSON.stringify({
          spec: {
            applicationGraph: {
              digest: `sha256:${'a'.repeat(64)}`,
            },
          },
        }),
      );
      const output: string[] = [];
      const code = await runCli(
        ['explain', 'Source.create', '--json'],
        {
          cwd: dir,
          stdout: (message) => output.push(message),
          stderr: (message) => output.push(message),
        },
      );
      expect(code).toBe(0);
      const explanation = JSON.parse(output.join('\n')) as {
        readonly apiVersion: string;
        readonly operation: { readonly id: string };
        readonly deployment: { readonly state: string };
      };
      expect(explanation).toMatchObject({
        apiVersion: 'applik8s.explanation/v1alpha1',
        operation: {
          id: 'applik8s://models/Source/operations/create',
        },
        deployment: { state: 'not-planned' },
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
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
  typekroArtifactBindings: {}
`);

      const staged = await stageExplicitApplicationInstance(
        join(dir, 'src', 'application.ts'),
        join(typeKroDir, 'typekro-composition.json'),
      );

      expect(staged).toMatchObject({ name: 'local', namespace: 'chirp-control', resourceGraphDefinitionName: 'chirp' });
      expect(staged.spec).toEqual({
        hostname: 'chirp.localhost',
        features: { analytics: true, media: false },
      });
      const stagedYaml = await readFile(staged.path, 'utf8');
      expect(stagedYaml).toContain('kind: ChirpInstallation');
      expect(stagedYaml).toContain('typekroArtifactBindings: {}');
      const prerequisiteFiles = await readdir(join(typeKroDir, 'instances'));
      expect(prerequisiteFiles).toContain('analytics-prerequisite.yaml');
      expect(prerequisiteFiles).not.toContain('media-prerequisite.yaml');
      const analyticsPrerequisite = await readFile(join(typeKroDir, 'instances', 'analytics-prerequisite.yaml'), 'utf8');
      expect(analyticsPrerequisite).toContain('typekro.io/singleton-spec-fingerprint');
      expect(analyticsPrerequisite).not.toContain('applik8s.dev/include-when');

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
  typekroArtifactBindings:
    r_user:
      o_image: registry.invalid/injected@sha256:deadbeef
`);
      await expect(stageExplicitApplicationInstance(
        join(dir, 'src', 'application.ts'),
        join(typeKroDir, 'typekro-composition.json'),
      )).rejects.toThrow('cannot supply provider-managed spec.typekroArtifactBindings');
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
metadata:
  name: clickhouse
  namespace: typekro-singletons
  labels:
    typekro.io/factory: clickhouse-operator-bootstrap
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
    const runner = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'cli', 'src', 'node-build-runner.mjs');
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
    const runner = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'cli', 'src', 'node-build-runner.mjs');
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
