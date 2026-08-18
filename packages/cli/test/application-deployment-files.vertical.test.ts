import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveGeneratedApplicationDeleteTarget } from '../src/application-deployment-files.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })),
  );
});

describe('generated Application deletion identity', () => {
  it('recovers the owned root from persisted Alchemy state after instance YAML is regenerated', async () => {
    const root = await mkdtemp(join(tmpdir(), 'applik8s-delete-identity-'));
    temporaryDirectories.push(root);
    const directory = join(root, 'typekro');
    await mkdir(join(directory, 'instances'), { recursive: true });
    const bundlePath = join(directory, 'typekro-composition.json');
    await writeFile(bundlePath, '{}\n');
    await writeFile(
      join(directory, 'application-graph.json'),
      JSON.stringify({ metadata: { name: 'documents' } }),
    );
    await writeFile(
      join(directory, 'resources.json'),
      JSON.stringify([
        {
          apiVersion: 'kro.run/v1alpha1',
          kind: 'ResourceGraphDefinition',
          metadata: { name: 'documents' },
          spec: {
            schema: {
              group: 'documents.applik8s.dev',
              apiVersion: 'v1alpha1',
              kind: 'Documents',
            },
          },
        },
      ]),
    );
    await writeFile(
      join(directory, 'application-deployment-graph.json'),
      JSON.stringify({
        metadata: {
          identity: {
            instance: 'documents-starter',
            controlPlaneNamespace: 'documents-control',
          },
        },
      }),
    );
    await writeFile(
      join(directory, 'instances', 'singleton.yaml'),
      [
        'apiVersion: platform.applik8s.dev/v1alpha1',
        'kind: SharedRuntime',
        'metadata:',
        '  name: shared-runtime',
        '  namespace: platform-system',
        '',
      ].join('\n'),
    );

    await expect(
      resolveGeneratedApplicationDeleteTarget(bundlePath, {}),
    ).resolves.toEqual({
      apiVersion: 'documents.applik8s.dev/v1alpha1',
      kind: 'Documents',
      instanceName: 'documents-starter',
      controlPlaneNamespace: 'documents-control',
      applicationInstance: true,
      resourceGraphDefinitionName: 'documents',
    });
  });
});
