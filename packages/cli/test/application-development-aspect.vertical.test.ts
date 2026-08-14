import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ApplicationDeploymentGraph } from '@applik8s/deployment-contract';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applicationDevelopmentAspects,
  applicationDevelopmentGraph,
} from '../src/application-development-aspect.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe('Application development TypeKro aspect', () => {
  it('mounts only the public source allowlist and preserves secret isolation', async () => {
    const projectRoot = await mkdtemp(
      join(process.env.TMPDIR ?? '/tmp', 'applik8s-development-aspect-'),
    );
    temporaryDirectories.push(projectRoot);
    await mkdir(join(projectRoot, 'src'));
    await writeFile(join(projectRoot, 'src', 'app.ts'), 'export {};\n');
    await writeFile(join(projectRoot, 'package.json'), '{"scripts":{"dev":"vite"}}\n');
    await writeFile(join(projectRoot, '.env'), 'MUST_NOT_ENTER_POD=synthetic\n');

    const aspects = await applicationDevelopmentAspects(
      deploymentGraph(),
      projectRoot,
    );
    const encoded = JSON.stringify(aspects);
    expect(encoded).toContain(join(projectRoot, 'src'));
    expect(encoded).toContain(join(projectRoot, 'package.json'));
    expect(encoded).not.toContain(join(projectRoot, '.env'));
    expect(encoded).not.toContain('MUST_NOT_ENTER_POD');
    expect(encoded).toContain('developer-test-app');
    expect(encoded).toContain('application-host');
    expect(encoded).toContain('node:22.22.1-bookworm-slim');
    expect(encoded).toContain('npx --yes bun@1.3.13 install');
    expect(encoded).toContain('npm run dev');
    expect(encoded).toContain('TSR_TMP_DIR');
    expect(encoded).toContain('/src/.tanstack/tmp');
    expect(encoded).toContain('"memory":"2Gi"');
  });

  it('removes only the unused production ApplicationHost image artifact', () => {
    const graph = applicationDevelopmentGraph(deploymentGraph());

    expect(graph.nodes.map((node) => node.id)).toEqual([
      'artifact.processor',
      'kubernetes.application',
    ]);
    expect(graph.edges).toEqual([
      {
        from: 'artifact.processor',
        to: 'kubernetes.application',
        relationship: 'requiresOutput',
        output: 'immutableReference',
      },
    ]);
    expect(
      graph.nodes.find((node) => node.id === 'kubernetes.application')?.inputs,
    ).toEqual({
      'artifact.artifact.processor': {
        kind: 'output',
        nodeId: 'artifact.processor',
        output: 'immutableReference',
        persistence: 'state',
        sensitivity: 'public',
      },
    });
  });

  it('hydrates workspace dependencies without mounting the workspace root or .env', async () => {
    const workspaceRoot = await mkdtemp(
      join(process.env.TMPDIR ?? '/tmp', 'applik8s-development-workspace-'),
    );
    temporaryDirectories.push(workspaceRoot);
    const projectRoot = join(workspaceRoot, 'scratch', 'app');
    const sdkRoot = join(workspaceRoot, 'packages', 'sdk');
    const coreRoot = join(workspaceRoot, 'packages', 'core');
    await mkdir(join(projectRoot, 'src'), { recursive: true });
    await mkdir(join(sdkRoot, 'src'), { recursive: true });
    await mkdir(join(coreRoot, 'src'), { recursive: true });
    await writeFile(
      join(workspaceRoot, 'package.json'),
      JSON.stringify({ private: true, workspaces: ['packages/*'] }),
    );
    await writeFile(
      join(projectRoot, 'package.json'),
      JSON.stringify({
        scripts: { dev: 'vite' },
        dependencies: { '@example/sdk': 'workspace:*' },
        devDependencies: {
          nitro: 'npm:nitro-nightly@3.0.1-example',
        },
      }),
    );
    await writeFile(join(projectRoot, 'src', 'app.ts'), 'export {};\n');
    await writeFile(
      join(sdkRoot, 'package.json'),
      JSON.stringify({
        name: '@example/sdk',
        dependencies: {
          '@example/core': '0.7.0',
          esbuild: '^0.25.0',
        },
      }),
    );
    await writeFile(join(sdkRoot, 'src', 'index.ts'), 'export {};\n');
    await writeFile(
      join(coreRoot, 'package.json'),
      JSON.stringify({ name: '@example/core' }),
    );
    await writeFile(join(coreRoot, 'src', 'index.ts'), 'export {};\n');
    await writeFile(join(workspaceRoot, '.env'), 'ROOT_SECRET=synthetic\n');

    const aspects = await applicationDevelopmentAspects(
      deploymentGraph(),
      projectRoot,
    );
    const encoded = JSON.stringify(aspects);
    expect(encoded).toContain(sdkRoot);
    expect(encoded).toContain(coreRoot);
    expect(encoded).not.toContain(workspaceRoot + '","type":"Directory"');
    expect(encoded).not.toContain(join(workspaceRoot, '.env'));
    expect(encoded).not.toContain('ROOT_SECRET');
    expect(encoded).toContain('/applik8s-dev-root');
    expect(encoded).toContain('base64 -d > package.json');
    const encodedManifest = encoded.match(
      /printf '%s' '([A-Za-z0-9+/=]+)' \| base64 -d/u,
    )?.[1];
    expect(encodedManifest).toBeDefined();
    expect(
      JSON.parse(
        Buffer.from(encodedManifest ?? '', 'base64').toString('utf8'),
      ),
    ).toMatchObject({
      workspaces: ['app', 'packages/*'],
      dependencies: {
        '@example/core': 'workspace:*',
        '@example/sdk': 'workspace:*',
        esbuild: '^0.25.0',
        nitro: 'npm:nitro-nightly@3.0.1-example',
      },
    });
  });
});

function deploymentGraph(): ApplicationDeploymentGraph {
  return {
    apiVersion: 'applik8s.deploymentGraph/v1alpha1',
    kind: 'ApplicationDeploymentGraph',
    metadata: {
      identity: {
        connection: {
          provider: 'kubernetes',
          cluster: 'orbstack',
          digest: `sha256:${'a'.repeat(64)}`,
        },
        application: 'developer-test',
        controlPlaneNamespace: 'default',
        instance: 'developer-test',
        profile: 'developer',
      },
      mode: 'fresh',
      strategy: 'kro',
      sourceGraphDigest: `sha256:${'b'.repeat(64)}`,
      compilerVersion: 'test',
    },
    nodes: [
      {
        id: 'artifact.application-host.web',
        kind: 'artifact',
        contractVersion: 1,
        source: { semanticNodeId: 'provider.application-host' },
        provider: {
          interface: 'Artifact',
          implementation: 'typekro-oci',
          version: '1',
        },
        scope: {
          connectionDigest: `sha256:${'a'.repeat(64)}`,
        },
        capabilities: { strategies: ['direct', 'kro'], alchemy: true },
        configurationDigest: `sha256:${'d'.repeat(64)}`,
        inputs: {},
        outputs: [
          {
            name: 'immutableReference',
            type: 'artifactReference',
            sensitivity: 'public',
            persistence: 'state',
          },
        ],
        lifecycle: {
          ownership: 'application',
          deletion: 'retain',
          adoption: 'createOrAdoptExact',
        },
        spec: {
          artifactType: 'containerImage',
          sourceDescriptor: { name: 'application-host' },
        },
      },
      {
        id: 'artifact.processor',
        kind: 'artifact',
        contractVersion: 1,
        source: { semanticNodeId: 'processor.test' },
        provider: {
          interface: 'Artifact',
          implementation: 'typekro-oci',
          version: '1',
        },
        scope: {
          connectionDigest: `sha256:${'a'.repeat(64)}`,
        },
        capabilities: { strategies: ['direct', 'kro'], alchemy: true },
        configurationDigest: `sha256:${'e'.repeat(64)}`,
        inputs: {},
        outputs: [
          {
            name: 'immutableReference',
            type: 'artifactReference',
            sensitivity: 'public',
            persistence: 'state',
          },
        ],
        lifecycle: {
          ownership: 'application',
          deletion: 'retain',
          adoption: 'createOrAdoptExact',
        },
        spec: {
          artifactType: 'containerImage',
          sourceDescriptor: { name: 'processor' },
        },
      },
      {
        id: 'kubernetes.application',
        kind: 'kubernetesComposition',
        contractVersion: 1,
        source: {},
        provider: {
          interface: 'Kubernetes',
          implementation: 'typekro',
          version: 'test',
        },
        scope: {
          connectionDigest: `sha256:${'a'.repeat(64)}`,
        },
        capabilities: { strategies: ['direct', 'kro'], alchemy: true },
        configurationDigest: `sha256:${'c'.repeat(64)}`,
        inputs: {
          'artifact.artifact.application-host.web': {
            kind: 'output',
            nodeId: 'artifact.application-host.web',
            output: 'immutableReference',
            persistence: 'state',
            sensitivity: 'public',
          },
          'artifact.artifact.processor': {
            kind: 'output',
            nodeId: 'artifact.processor',
            output: 'immutableReference',
            persistence: 'state',
            sensitivity: 'public',
          },
        },
        outputs: [],
        lifecycle: {
          ownership: 'application',
          deletion: 'delete',
          adoption: 'createOrAdoptExact',
        },
        spec: {
          compositionId: 'developer-test',
          fragmentIds: [],
          installationSpec: { profile: 'developer' },
          materialized: {
            resources: [
              {
                id: 'applicationHost',
                template: {
                  apiVersion: 'apps/v1',
                  kind: 'Deployment',
                  metadata: {
                    name: 'developer-test-app',
                    labels: {
                      'app.kubernetes.io/component': 'application-host',
                    },
                  },
                  spec: {
                    template: {
                      spec: {
                        containers: [
                          {
                            name: 'application',
                            image: 'immutable-image',
                            env: [
                              {
                                name: 'STRIPE_SECRET_KEY',
                                valueFrom: {
                                  secretKeyRef: {
                                    name: 'payments',
                                    key: 'apiKey',
                                  },
                                },
                              },
                            ],
                            ports: [{ name: 'http', containerPort: 3000 }],
                          },
                        ],
                      },
                    },
                  },
                },
              },
            ],
            status: { ready: 'boolean' },
          },
        },
      },
    ],
    edges: [
      {
        from: 'artifact.application-host.web',
        to: 'kubernetes.application',
        relationship: 'requiresOutput',
        output: 'immutableReference',
      },
      {
        from: 'artifact.processor',
        to: 'kubernetes.application',
        relationship: 'requiresOutput',
        output: 'immutableReference',
      },
    ],
  };
}
