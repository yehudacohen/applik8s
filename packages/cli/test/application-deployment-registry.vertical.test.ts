import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApplicationGraph } from '@applik8s/core';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveDeploymentContainerRegistry } from '../src/application-deployment-registry.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true })),
  );
});

describe('deployment registry profile resolution', () => {
  it('resolves only the unqualified default and never evaluates inactive named-provider metadata', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'applik8s-registry-'));
    temporaryDirectories.push(directory);
    const graphPath = join(directory, 'application-graph.json');
    const bundlePath = join(directory, 'bundle.json');
    const starter = {
      kind: 'oci-container-registry',
      endpoint: {
        kind: 'origin',
        origin: 'https://starter.registry.example.test',
      },
      repositoryPrefix: 'chirp',
    };
    const external = {
      kind: 'oci-container-registry',
      endpoint: {
        kind: 'origin',
        origin: '${schema.spec.providers.registry.origin}',
      },
      repositoryPrefix: '${schema.spec.providers.registry.repositoryPrefix}',
    };
    const graph: ApplicationGraph = {
      apiVersion: 'applik8s.appGraph/v1alpha1',
      kind: 'ApplicationGraph',
      metadata: { name: 'chirp' },
      nodes: [
        {
          id: 'provider.container-registry',
          kind: 'provider',
          name: 'ContainerRegistry',
          stability: 'stable',
          interface: 'ContainerRegistry',
          implementation: 'application-provider-selection',
          config: {
            bindingKind: 'provided',
            aliasOf: 'provider.container-registry.v1alpha1.images',
            containerRegistry: {
              kind: 'application-provider-selection',
              selector: 'schema.spec.profile',
              cases: { starter, external },
              default: starter,
            },
          },
        },
        {
          id: 'provider.container-registry.v1alpha1.images',
          kind: 'provider',
          name: 'ContainerRegistry',
          stability: 'stable',
          interface: 'ContainerRegistry',
          implementation: 'application-provider-selection',
          config: {
            bindingKind: 'provided',
            qualification: {
              apiVersion: 'applik8s.providerQualification/v1alpha1',
              capability: 'ContainerRegistry',
              compatibilityRevision: 'v1alpha1',
              key: 'ContainerRegistry@v1alpha1:images',
              name: 'images',
            },
            containerRegistry: {
              kind: 'application-provider-selection',
              selector: 'schema.spec.profile',
              cases: { starter, external },
              default: starter,
            },
            profile: {
              branches: [
                {
                  variant: 'external',
                  implementation: 'oci-container-registry',
                  config: external,
                },
              ],
            },
          },
        },
      ],
      edges: [],
      providerRequirements: [],
      providerBindings: [],
      compatibility: {
        stablePublicApis: [],
        documentedInternalContracts: [],
        experimentalSurfaces: [],
        postV3Surfaces: [],
        labels: [],
      },
    };
    await writeFile(graphPath, `${JSON.stringify(graph)}\n`);
    await writeFile(bundlePath, `${JSON.stringify({
      spec: {
        applicationGraph: { path: graphPath },
      },
    })}\n`);

    const resolved = await resolveDeploymentContainerRegistry(
      bundlePath,
      'unused',
      { profile: 'starter' },
      { cwd: directory, stdout() {} },
    );

    expect(resolved).toMatchObject({
      remote: true,
      origin: 'https://starter.registry.example.test',
      repositoryPrefix: 'chirp',
    });
  });
});
